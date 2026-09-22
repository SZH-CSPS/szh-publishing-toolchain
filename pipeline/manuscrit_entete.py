#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_entete.py — reconnaissance de l'en-tête d'un manuscrit (titre, sous-titre,
# auteurs, résumé, mots-clés, DOI, ligne de revue) AVANT le classement des titres du corps.
# Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §5.5.
#
# Module PUR, comme manuscrit_modele.py et manuscrit_biblio.py : ne sait rien de Word ni
# d'OpenDocument. Il travaille sur le Document du modèle riche (manuscrit_modele.py, §4) —
# n'importe de ce module que les CLASSES et les convertisseurs JSON (document_depuis_json/
# document_vers_json), jamais classer_titres()/nettoyer_mise_en_forme() ni leurs fonctions
# privées : un autre chantier refond classer_titres() en ce moment, ce fichier-ci ne doit
# dépendre d'aucune de ses pièces internes.
#
# Réutilisé depuis pipeline/docx-meta.py (chargé par chemin : le nom porte un tiret,
# `import docx-meta` est syntaxiquement impossible — patron déjà suivi par
# manuscrit_biblio.py pour ce même fichier) : RE_RESUME, LANG_RESUME, RE_KEYWORDS,
# RE_DOI_LIGNE, RE_DOI, RE_JOURNAL, langue_resume(), nettoyer_doi(), decouper_keywords(),
# scinder_titre(), CONNECTEURS, nom_plausible(), sans_titres_academiques(), RE_EMAIL,
# RE_ORCID. C'est le parser de l'import Word déjà en service (et son harnais,
# test/js/auteurs-corpus.test.js) : rien de tout cela n'est recopié — seulement importé et
# recombiné pour lire des PARAGRAPHES LIBRES plutôt que des cellules d'un tableau déjà
# rempli (docx-meta.py ne lit que le tableau des auteurs du gabarit ; ici le manuscrit n'a
# encore AUCUNE structure de gabarit). `decouper_prenom_nom()` (« premier jeton = prénom »,
# une convention posée qui ne consultait aucun indice) N'EST PLUS APPELÉ depuis le 22.09.2026
# (lot B, CONTRAT-noms.md) : c'est pipeline/manuscrit_noms.py qui possède désormais la
# question « qui est le prénom, qui est le nom » — voir plus bas, import manuscrit_noms.
#
# stdlib seule.

import importlib.util
import json
import os
import re
import sys
import unicodedata

_ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _ICI)
import manuscrit_modele as mm
import pronto_modele
# manuscrit_noms.py porte un tiret BAS (comme docx-meta.py en porte un — voir la convention
# du §3 du contrat) : import ordinaire, comme pour un module frère (§4.2 du contrat de lot).
# Ce module possède la question « qui est le prénom, qui est le nom » (b) et lui seul ; celui-
# ci ne recueille que les jetons et les indices, jamais la répartition ou la décision elles-
# mêmes : elles se demandent à mn.trancher_groupe() puis à mn.repartir().
import manuscrit_noms as mn


def _charger_module_a_tiret(nom_fichier, nom_module):
    """docx-meta.py porte un tiret : pas un module importable par son nom (convention du
    dépôt). Chargé par chemin, comme manuscrit_biblio.py le fait déjà pour ce même fichier."""
    chemin = os.path.join(_ICI, nom_fichier)
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dm = _charger_module_a_tiret('docx-meta.py', 'szh_docx_meta_pour_entete')


# ---------------------------------------------------------------------------------
# Seuils et lexiques — nommés (§11 du contrat : « tout seuil est une constante nommée »).

# Longueur, en signes, au-delà de laquelle un paragraphe qui n'est PAS un résumé (marqueur
# ou suite d'un résumé déjà commencé) est jugé être le début du corps de l'article — mesuré
# (§5.1 du contrat) : les paragraphes de corps de la Revue font 768 à 1525 signes, très
# au-delà de ce seuil ; un résumé (400 à 600 signes au gabarit, jusqu'à 700 en Zeitschrift)
# reste en-dessous ou tout près, d'où l'exception explicite pour un paragraphe qui PORTE un
# marqueur reconnu (résumé/mots-clés/DOI/revue), même long.
SEUIL_CORPS_ENTETE = 300

# Le premier intertitre connu qui clôt la zone d'en-tête (§5.5) — liste FERMÉE et
# volontairement courte : un faux positif ici coupe l'en-tête trop tôt (résumé ou auteurs
# jamais atteints) ; un faux négatif la laisse simplement trop longue, rattrapée presque
# toujours par le seuil de longueur ci-dessus dès le premier vrai paragraphe de corps.
RE_INTERTITRE_CONNU = re.compile(
    r'^(?:introduction|einleitung|einf[üu]hrung|\d+[.\)]\s)', re.I)

# Mots qui trahissent une ligne d'affiliation même quand aucun nom n'y est reconnu (une
# institution seule sur sa propre ligne, sous le nom de l'autrice ou l'auteur).
RE_INSTITUTION = re.compile(
    r'\b(HEP|Universit[ée]|Haute\s+[ée]cole|Hochschule|Universit[äa]t|Institut|Centre|'
    r'Fondation|PH\b)', re.I)

RE_PONCTUATION_FINALE = re.compile(r'[.!?:;]\s*$')

# Un résumé doit s'arrêter DUR (superviseur, 21.09.2026, mesuré sur
# 3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx : sans plafond, la capture s'enchaînait
# jusqu'à la fin du document, faute de titre promu pour la borner). 400-600 signes au
# gabarit (700 en Zeitschrift, §5.1 du contrat) : 1500 laisse une marge large sans laisser
# filer un résumé sur tout un article ; 4 paragraphes couvre un résumé coupé en plusieurs
# morceaux par une autrice sans jamais suivre tout le corps qui suit.
PLAFOND_RESUME_SIGNES = 1500
PLAFOND_RESUME_PARAGRAPHES = 4

# Un paragraphe COURT et ENTIÈREMENT gras, rencontré PENDANT une capture de résumé, est un
# pseudo-titre que classer_titres() (qui tourne APRÈS ce module) n'a pas encore eu la
# chance de voir — jamais du texte de résumé. « Court » : bien en-deçà d'une phrase de
# résumé réelle (mesuré : 17-19 mots pour un intertitre de la Revue, §5.1 du contrat).
SEUIL_PSEUDO_TITRE_COURT = 120

# Une lettre de langue isolée immédiatement après le marqueur de résumé (« Résumé F »,
# « Zusammenfassung D ») — mesurée sur 2-fin-de-document_Article_RSPS.docx : un w:br pose
# un VRAI saut de ligne entre la lettre et le texte (Fragment '\n', §4 du contrat). Retirée
# avant capture seulement devant ce saut de ligne littéral — jamais devant une simple espace
# (« À l'école... » ne doit jamais perdre son « À »).
RE_LETTRE_LANGUE_ISOLEE = re.compile(r'^[A-Za-zÀ-ÿ]\n\s*')

# Un numéro de téléphone en tête de ligne (mesuré : « +41 79 507 58 10 ») — reconnu pour
# être ÉCARTÉ (aucun champ téléphone dans le schéma EnTete.auteurs), jamais confondu avec
# un ORCID (qui a sa propre forme, RE_ORCID) ni gardé comme fonction/institution.
RE_TELEPHONE = re.compile(r'^\+?[\d][\d .\-/]{5,}\d$')

# Bloc final « Informations sur les autrices et auteurs » (décision de Robin, 21.09.2026) :
# la Revue le demande en FIN de manuscrit (nom, fonction, institution, e-mail) — jamais
# confondu avec la zone d'en-tête ci-dessus, qui a son propre repérage depuis le DÉBUT du
# document. Sans reconnaissance, ces paragraphes tombaient dans l'étendue de bibliographie
# de la CLI (leurs coordonnées ressortant en APA.OrdreBiblio / APA.CitationAbsente /
# confiance basse — mesuré sur 2-clairseme_Article_CSPS_C.Pedrosa.docx et
# 2-fin-de-document_Article_RSPS.docx).
RE_INTERTITRE_AUTEURS_FINAL = re.compile(
    r'^(?:informations?\s+sur\s+les\s+(?:autrices?|auteur[^\s:]*)(?:\s*(?:et|,)\s*auteurs?)?'
    r'|angaben\s+zu\s+den\s+autor)\W*$', re.I)

# Libellés allemands qui accompagnent parfois le bloc SANS l'introduire eux-mêmes (un intitulé
# de champ, jamais un nom ni une info) — reconnus pour être ignorés, jamais attribués comme
# fonction/institution par erreur. Aucun manuscrit réel allemand n'a encore validé cette forme
# (§1 du contrat : conservateur tant que non éprouvé) — sans effet si elle n'apparaît jamais.
RE_LIBELLE_AUTEUR_FINAL_DE = re.compile(
    r'^(?:autorinnen\s+und\s+autoren|kontakt)\s*:?\s*$', re.I)

# Seuil du repli SANS intertitre (§ ci-dessous) : la plupart des références bibliographiques
# dépassent largement ce seuil ; une ligne de fonction, d'adresse ou d'e-mail du bloc auteurs
# en fait 15 à 50. MAIS ce seuil seul ne suffit pas : trois références réelles, mesurées sur
# tmp/docx-cleaner-error/1408_Alves.docx (lot correctifs septembre 2026), restent EN DESSOUS
# et se faisaient avaler avec le bloc d'autrices voisin — « Morin, E. (2005). Introduction à
# la pensée complexe. Points éditions du Seuil. » (78 signes), « UNESCO, 2017. A Guide for
# Ensuring Inclusion and Equity in Education. UNESCO, Paris » (83) et « Walton, E. (2025). The
# knowledge of inclusive education: An ecological approach. Routledge. » (91). D'où la seconde
# garde, _ressemble_reference_biblio_pour_repli() ci-dessous, qui arrête le repli sur la
# SILHOUETTE d'une référence (année de publication) indépendamment de sa longueur. Un intitulé
# court non reconnu comme marqueur (« Bibliographie », « Références ») reste exclu par
# ailleurs (lire_titres_bib()).
SEUIL_LIGNE_AUTEUR_FINAL = 120


# ---------------------------------------------------------------------------------
# EnTete — jamais un champ inventé : '' / [] / {} quand rien n'a pu être attribué.

class EnTete:
    """`auteurs` : liste de dicts prenom/nom/fonction/institution/email/orcid/texte_source.
    `resumes_autres` : dict langue (ou 'abstract' si le marqueur ne dit pas laquelle) ->
    texte, pour un résumé en langue étrangère au produit (§5.5). `langue_produit` : la
    langue passée à extraire_entete() (celle du PRODUIT, jamais document.langue, §8 du
    contrat) — c'est elle que manuscrit_gabarit.ecrire() lit pour remplir le champ « Langue
    de l'article »."""

    __slots__ = ('titre', 'sous_titre', 'auteurs', 'resume', 'langue_resume',
                 'resumes_autres', 'mots_cles', 'doi', 'ligne_revue', 'langue_produit')

    def __init__(self, titre='', sous_titre='', auteurs=None, resume='', langue_resume='',
                 resumes_autres=None, mots_cles=None, doi='', ligne_revue='',
                 langue_produit=''):
        self.titre = titre or ''
        self.sous_titre = sous_titre or ''
        self.auteurs = auteurs if auteurs is not None else []
        self.resume = resume or ''
        self.langue_resume = langue_resume or ''
        self.resumes_autres = resumes_autres if resumes_autres is not None else {}
        self.mots_cles = mots_cles if mots_cles is not None else []
        self.doi = doi or ''
        self.ligne_revue = ligne_revue or ''
        self.langue_produit = langue_produit or ''

    def __repr__(self):
        return 'EnTete(titre=%r, %d auteur(s), resume=%d car.)' % (
            self.titre, len(self.auteurs), len(self.resume))


# §4.4 du contrat de lot : trois champs ajoutés à LA FIN — jamais insérés ailleurs, pour ne
# rien décaler chez un lecteur qui itérerait sur les valeurs par position plutôt que par clé.
# `ordre_confiance` : une valeur de mn.CONFIANCE ('certaine'|'probable'|'propagee'|'defaut').
# `ordre_motif` : la phrase française qui la justifie (mn.trancher()/trancher_groupe(), ou —
# pour une fiche issue de _tenter_nom_virgule_avec_info() — le motif structurel propre à ce
# module, l'ordre y étant certain par construction, jamais par un signal de mn).
# `ordre_conflit` : booléen, ajouté par le superviseur le 22.09.2026 — reprend TEL QUEL le
# `conflit` que mn.trancher() rend déjà. Sans lui, distinguer un `defaut` PAR CONFLIT (deux
# signaux contraires à poids égal) d'un `defaut` FAUTE D'INDICE (aucun signal) obligeait le
# lot D à chercher un préfixe de phrase dans `ordre_motif` — fragile dans un dépôt où les
# messages sont reformulés souvent, sans qu'aucun test ne devienne rouge pour le signaler.
# Un état voyage comme une donnée, jamais comme une sous-chaîne de prose.
# `manuscrit_gabarit._remplir_fiche_auteur()` (vérifié en lisant le fichier avant d'écrire
# cette ligne) ne lit QUE les champs d'une liste blanche fermée (_CHAMPS_AUTEUR_GABARIT :
# prenom/nom/fonction/institution/orcid/email) — ces trois champs de plus dans le dict ne le
# perturbent en rien, ils sont simplement ignorés par ce lecteur-là.
# `ordre` : un QUATRIÈME champ, ajouté à la fin comme les trois précédents et pour la même
# raison de compatibilité — mn.ORDRE_DIRECT, mn.ORDRE_INVERSE, ou None. Ajouté le 22.09.2026
# par le lot « lexique élargi » (§3 bis de son brief) : sans lui, `ordre_confiance` dit à quel
# point on est sûr SANS dire de quoi, et la propagation à l'échelle du DOCUMENT
# (_propager_ordre_document() plus bas) ne peut ni lire l'ordre d'une fiche déjà tranchée ni
# reconstituer les jetons d'origine d'une fiche à rejuger — mn.repartir() n'est inversible
# qu'une fois l'ordre connu. Même précaution que pour les trois autres : un état voyage comme
# une donnée, jamais comme une sous-chaîne de prose.
#
# `ordre` vaut None — et la fiche ne vote alors JAMAIS pour l'ordre du document — quand
# l'ordre a été établi autrement que par un signal de manuscrit_noms : c'est le cas de la
# forme « Nom, Prénom » (_tenter_nom_virgule_avec_info), où la virgule dit l'ordre DE CE
# SEGMENT sans rien dire de la convention du document. Un document peut parfaitement écrire
# sa byline « Guilley, Edith » et sa prose « Edith Guilley » : laisser cette virgule voter
# retournerait tout l'article sur la foi d'une ponctuation locale, exactement l'accident que
# la propagation doit éviter. Choix du lot, pas du brief — signalé comme tel au rapport.
CHAMPS_AUTEUR_ENTETE = ('prenom', 'nom', 'fonction', 'institution', 'email', 'orcid',
                         'texte_source', 'ordre_confiance', 'ordre_motif', 'ordre_conflit',
                         'ordre')


def _nouvel_auteur(prenom, nom, texte_source, ordre_confiance='defaut', ordre_motif='',
                    ordre_conflit=False, ordre=None):
    return {'prenom': prenom, 'nom': nom, 'fonction': '', 'institution': '',
            'email': '', 'orcid': '', 'texte_source': texte_source,
            'ordre_confiance': ordre_confiance, 'ordre_motif': ordre_motif,
            'ordre_conflit': bool(ordre_conflit), 'ordre': ordre}


# ---------------------------------------------------------------------------------
# Titre / sous-titre — §5.5 : deux lignes consécutives de même signature, dont la première
# finit par « : » ou ne porte aucune ponctuation finale, valent titre + sous-titre ; sinon
# on retombe sur scinder_titre() (le deux-points au sein d'une seule ligne, déjà éprouvé par
# l'import Word).

def _forme_reference(paragraphe):
    """La forme EFFECTIVE (cascade des styles, §4 du contrat) du premier fragment porteur de
    texte — sert UNIQUEMENT à comparer deux paragraphes voisins ici, jamais à classer tout un
    document (ce n'est pas manuscrit_modele._signature, privée et sous refonte concurrente)."""
    for f in paragraphe.fragments:
        if not f.texte:
            continue
        effectif = f.effectif or {}
        if any(v is not None for v in effectif.values()):
            return effectif
        return f.forme or {}
    return {}


def _meme_signature(p1, p2):
    f1, f2 = _forme_reference(p1), _forme_reference(p2)
    return ((f1.get('taille'), bool(f1.get('gras')), bool(f1.get('italique'))) ==
            (f2.get('taille'), bool(f2.get('gras')), bool(f2.get('italique'))))


def _tout_gras_effectif(paragraphe):
    """True si TOUS les fragments non vides du paragraphe sont EFFECTIVEMENT gras (directe,
    sinon cascade des styles, §4 du contrat) — un paragraphe à moitié gras n'est jamais un
    pseudo-titre à lui seul. Sert à borner la capture d'un résumé (§5.5, révision du
    21.09.2026) : un pseudo-titre en gras, sur un document sans style de titre fiable, doit
    l'arrêter net."""
    fragments = [f for f in paragraphe.fragments if f.texte]
    if not fragments:
        return False
    for f in fragments:
        effectif = f.effectif or {}
        eff = effectif if any(v is not None for v in effectif.values()) else (f.forme or {})
        if not eff.get('gras'):
            return False
    return True


def _titre_et_sous_titre(bloc1, texte1, bloc2, texte2):
    """(titre, sous_titre, consomme_bloc2). Un bloc2 qui ressemble à une ligne d'auteurs, qui
    porte un marqueur connu (résumé, mots-clés, DOI, revue), qui EST l'intertitre qui clôt la
    zone d'en-tête, ou qui est trop long pour un sous-titre, n'est JAMAIS pris pour un
    sous-titre, même de même signature — mesuré : sans ces gardes, une byline « Jean Dupont,
    Marie Martin » directement sous un titre sans ponctuation finale (les deux paragraphes
    partageant alors la même mise en forme par défaut) était avalée comme sous-titre, et de
    même pour le premier « Introduction » d'un document dont le titre ne finit pas non plus
    par un point."""
    if (bloc2 is not None and texte2 and len(texte2) < SEUIL_CORPS_ENTETE
            and _meme_signature(bloc1, bloc2)
            and (texte1.endswith(':') or not RE_PONCTUATION_FINALE.search(texte1))
            and not _est_ligne_auteur(texte2) and not _est_marqueur_connu(texte2)
            and not RE_INTERTITRE_CONNU.match(texte2)):
        return texte1.rstrip(' :').strip(), texte2.strip(), True
    titre, sous_titre = dm.scinder_titre(texte1)
    return titre, sous_titre, False


# ---------------------------------------------------------------------------------
# Auteurs — une ligne « Prénom Nom[, Prénom Nom…] » ouvre une ou plusieurs fiches ; une ligne
# d'info qui suit (e-mail, ORCID, institution, fonction) se rattache à la DERNIÈRE fiche
# ouverte SEULE (jamais à plusieurs à la fois, faute de pouvoir départager) — voir
# extraire_entete() pour l'enchaînement exact.

def _segments_plausibles(texte):
    """Découpe comme docx-meta.auteurs_depuis_byline(), mais PARTITIONNE chaque segment au
    lieu de se contenter de tester s'il ressemble à un nom (§4.1 du contrat de lot —
    correction du superviseur, 22.09.2026 : la première rédaction disait de rendre None dès
    qu'un segment matchait RE_INSTITUTION, ce qui aurait donné ZÉRO auteur sur
    « Marie Dupont, Université de Genève » — vérifié en relisant le flux : le motif Nom-
    virgule refuse ensuite « Marie Dupont » (deux mots), puis _est_ligne_auteur() retombe
    avec cible_courante=None, pire qu'aujourd'hui un bon + un fantôme).

    Chaque segment (après retrait de l'obèle †, comme avant) devient :
    - une INFO s'il matche RE_INSTITUTION, dm.RE_EMAIL, dm.RE_ORCID ou RE_TELEPHONE ;
    - sinon un NOM s'il passe dm.nom_plausible(dm.sans_titres_academiques(segment)) — c'est
      le retrait des titres académiques qui manquait ici (§4.1, deuxième défaut du §0:
      « Dr. phil. Romain Lanners » ne passait pas nom_plausible() sans lui, contrairement à
      dm.auteurs_depuis_byline(), qui l'appelle déjà) ;
    - sinon la ligne entière n'introduit pas des noms : None (§2 de la maison, « en cas de
      doute, rien » — un segment en texte libre, non reconnaissable, disqualifie tout, on ne
      devine jamais à qui il appartient).

    Un jeton fait UNIQUEMENT de symboles/ponctuation/emoji (aucune lettre) est retiré du
    segment AVANT ces tests, jamais compté comme un jeton (§4.1, troisième défaut du §0,
    mesuré : « Marie Dupont 🎓 » — un jeton non capitalisé disqualifiait toute la ligne dans
    dm.nom_plausible(), qui n'a pourtant rien à voir avec un emoji). Retiré ICI et pas dans
    docx-meta.nom_plausible() : cette fonction sert un AUTRE appelant (dm.auteurs_depuis_
    byline(), lot A), et docx-meta.py n'est pas un fichier de ce lot.

    Rend (noms, infos) — `noms` : liste de segments NETTOYÉS (sans titre académique, prêts à
    être tokenisés) ; `infos` : liste de segments bruts (filtrés de l'emoji) — ou None si
    aucun nom n'a été reconnu OU si un segment n'a été reconnu ni comme nom ni comme info.
    Aucun nom trouvé -> None : ce n'est pas une ligne d'introduction de noms — c'est ce qui
    fait qu'« Université de Genève » seule sur sa ligne retombe correctement sur
    _est_ligne_auteur(), qui la rattache comme institution à l'auteur ouvert juste avant."""
    noms, infos = [], []
    for part in dm.CONNECTEURS.split(texte):
        part = (part or '').strip().strip(',;').replace('†', '').strip()
        if not part:
            continue
        part_filtre = ' '.join(j for j in part.split() if any(c.isalpha() for c in j))
        if not part_filtre:
            continue
        if (RE_INSTITUTION.search(part_filtre) or dm.RE_EMAIL.search(part_filtre)
                or dm.RE_ORCID.search(part_filtre) or RE_TELEPHONE.match(part_filtre)):
            infos.append(part_filtre)
            continue
        sans_titres = dm.sans_titres_academiques(part_filtre)
        if dm.nom_plausible(sans_titres):
            noms.append(sans_titres)
            continue
        return None
    if not noms:
        return None
    return noms, infos


# ---------------------------------------------------------------------------------
# Le branchement de manuscrit_noms (§4.2 du contrat de lot). mn.trancher_groupe() rend
# volontairement la DÉCISION seule (ordre, confiance, motif, conflit) et jamais la
# répartition, pour que la propagation (§3.5) reste testable indépendamment du découpage :
# la répartition se demande ensuite à mn.repartir(), la fonction PUBLIQUE de manuscrit_noms.
#
# ⚠ Ce fichier a porté un temps sa PROPRE copie de cet algorithme (_repartir_jetons /
# _absorber_prenom_compose), au motif que la fonction d'origine était privée. Mesuré le
# 22.09.2026 : les deux copies avaient déjà divergé au moment du contrôle — celle-ci ignorait
# les initiales pointées (« Bernard N. Schumacher » -> prénom « Bernard », nom
# « N. Schumacher ») et renversait naïvement la liste en ordre inverse (« Burkhardt Susan
# C. A. » -> prénom « A. », nom « Burkhardt Susan C. »). Les deux fichiers de test étaient
# verts : aucun ne croisait les deux modules sur une initiale. D'où l'alias public
# mn.repartir() et la suppression de la copie. Une décision, un seul propriétaire (§3 du
# contrat d'architecture) — c'est ce que ce fichier applique déjà pour la typographie et pour
# les titres académiques, et la duplication d'un algorithme de décision n'y fait pas
# exception, si petit soit-il.
def _forme_effective_du_fragment(f):
    """La forme EFFECTIVE d'UN SEUL fragment (cascade des styles, §4 du contrat), repli sur
    `forme` clé par clé si `effectif` n'a rien de propre — même repli que _forme_reference()
    ci-dessus, réduit à un seul fragment plutôt qu'« au premier fragment porteur de texte »."""
    effectif = f.effectif or {}
    if any(v is not None for v in effectif.values()):
        return effectif
    return f.forme or {}


def _mots_casse_paragraphe(paragraphe):
    """Pour chaque MOT du texte du paragraphe, dans l'ordre : sa forme EFFECTIVE majuscules/
    petites_capitales (§4.2 du contrat de lot : « les indices de casse viennent du modèle
    riche »). Construit fragment par fragment (chaque mot appartient, en pratique, à UN SEUL
    fragment — Word coupe rarement un w:r au milieu d'un mot pour une ligne de byline),
    jamais caractère par caractère : plus simple, et suffisant ici. Garde-fou : si un mot
    chevauche malgré tout deux fragments de mise en forme différente, la liste reconstruite
    fragment par fragment ne correspond plus MOT À MOT à paragraphe.texte().split() — rend
    alors [] plutôt qu'une position fausse (§2 de la maison : en cas de doute, rien). La
    casse TAPÉE (texte en capitales) n'a de toute façon pas besoin de cette carte : mn.
    _signal_casse() la lit directement dans le texte des jetons, sans indices — cette carte
    ne sert qu'à la casse MISE EN FORME (petites capitales sur un texte tapé normalement)."""
    mots, maj, petcap = [], [], []
    for f in paragraphe.fragments:
        if not f.texte:
            continue
        eff = _forme_effective_du_fragment(f)
        est_maj = bool(eff.get('majuscules'))
        est_pc = bool(eff.get('petites_capitales'))
        for mot in f.texte.split():
            mots.append(mot)
            maj.append(est_maj)
            petcap.append(est_pc)
    if mots != paragraphe.texte().split():
        return []
    return list(zip(mots, maj, petcap))


def _indices_casse_segments(paragraphe, segments_jetons):
    """Une liste PARALLÈLE à `segments_jetons` de dicts {'majuscules': set(...),
    'petites_capitales': set(...)} (positions LOCALES à chaque segment, §3.3 du contrat de
    lot A — mn._jetons_marques_majuscule() les lit ainsi) — dict vide pour un segment dont la
    correspondance mot à mot avec le paragraphe n'a pas pu être établie (silence, jamais une
    position devinée). `paragraphe` : None si l'appelant n'a pas de Paragraphe du modèle
    riche sous la main (le bloc final d'autrices/auteurs, §5.5 bis, travaille sur des LIGNES
    scindées sur '\\n' d'un paragraphe déjà éclaté — aucune correspondance fragment/ligne n'y
    survit, la casse mise en forme n'y est donc jamais disponible ; la casse TAPÉE, elle,
    continue de fonctionner sans cette carte)."""
    vide = [{} for _ in segments_jetons]
    if paragraphe is None:
        return vide
    mots = _mots_casse_paragraphe(paragraphe)
    if not mots:
        return vide
    resultat = []
    curseur = 0
    for jetons in segments_jetons:
        n = len(jetons)
        trouve = None
        fin = min(curseur + 4, len(mots) - n + 1) if n <= len(mots) else curseur
        for depart in range(curseur, max(fin, curseur)):
            if [m[0] for m in mots[depart:depart + n]] == jetons:
                trouve = depart
                break
        if trouve is None:
            resultat.append({})
            continue
        maj = {i for i in range(n) if mots[trouve + i][1]}
        pc = {i for i in range(n) if mots[trouve + i][2]}
        resultat.append({'majuscules': maj, 'petites_capitales': pc})
        curseur = trouve + n
    return resultat


def _tenter_noms(texte, paragraphe=None, base_noms=None, noms_biblio=None):
    """None si la ligne n'introduit pas de nom(s) (§4.1). Sinon (entrees, infos) :
    `entrees` — une par nom reconnu — porte prenom/nom/ordre_confiance/ordre_motif/
    ordre_conflit (prêts pour _nouvel_auteur()) PLUS jetons/indices (consommés par
    l'appelant pour, le cas échéant, rejuger l'ordre après un e-mail tardif, §4.2 : « à
    rejuger si sa confiance était defaut ou propagee ») — jamais exposés au-delà, à retirer
    avant d'écrire la fiche définitive. `infos` — les segments non-nom de LA MÊME ligne
    (institution, e-mail…), non encore rattachés : c'est l'appelant qui les rattache,
    seulement s'il y a exactement un nom sur la ligne (§4.1 : « le ambigu_courant déjà en
    place s'applique » sinon).

    mn.trancher_groupe() est appelé UNE SEULE FOIS pour toute la ligne (§4.2 : « _tenter_
    noms() cesse d'appeler dm.decouper_prenom_nom() segment par segment ») — c'est ce qui
    permet la propagation (§3.5 du contrat de lot A) entre plusieurs noms d'une même byline."""
    resultat = _segments_plausibles(texte)
    if resultat is None:
        return None
    noms, infos = resultat
    segments_jetons = [n.split() for n in noms if len(n.split()) >= 1]
    cartes_casse = _indices_casse_segments(paragraphe, segments_jetons)

    # L'e-mail de la MÊME ligne (§4.2) : seulement si la ligne porte exactement UN nom et
    # UNE info d'e-mail — sinon, comme pour le rattachement plus bas, on ne devine pas à qui
    # il appartient (plusieurs noms déclarés ensemble, ou plusieurs infos ambiguës).
    email_ligne = None
    if len(noms) == 1:
        emails = [dm.RE_EMAIL.search(info) for info in infos]
        emails = [m for m in emails if m]
        if len(emails) == 1:
            email_ligne = emails[0].group(1)

    segments_mn = []
    for jetons, carte in zip(segments_jetons, cartes_casse):
        indices = dict(carte)
        if noms_biblio:
            indices['noms_biblio'] = noms_biblio
        if email_ligne:
            indices['email'] = email_ligne
        segments_mn.append({'jetons': jetons, 'indices': indices})

    decisions = mn.trancher_groupe(segments_mn, base_noms)
    entrees = []
    for jetons, seg_mn, decision in zip(segments_jetons, segments_mn, decisions):
        prenom, nom = mn.repartir(jetons, decision['ordre'])
        entrees.append({'prenom': prenom, 'nom': nom,
                         'ordre_confiance': decision['confiance'],
                         'ordre_motif': decision['motif'],
                         'ordre_conflit': decision['conflit'],
                         'ordre': decision['ordre'],
                         'jetons': jetons, 'indices': seg_mn['indices']})
    return entrees, infos


def _est_ligne_auteur(texte):
    if dm.RE_EMAIL.search(texte) or dm.RE_ORCID.search(texte):
        return True
    if RE_INSTITUTION.search(texte):
        return True
    if _segments_plausibles(texte) is not None:
        return True
    return _tenter_nom_virgule_avec_info(texte) is not None


# Étiquette qui accompagne parfois un e-mail/ORCID en texte libre (« ORCID 0000-... »,
# « e-mail : … ») — retirée après coup, jamais laissée dans la fonction/institution : elle ne
# porte aucune information, seul le champ structuré (email/orcid) doit la porter.
RE_ETIQUETTE_RESIDUELLE = re.compile(r'\b(orcid|e-?mail|courriel)\s*:?\s*', re.I)


def _fusionner_info(auteur, texte):
    """Rattache e-mail/ORCID/institution/fonction à `auteur`, jamais en écrasant un champ
    déjà rempli (une ligne d'info se lit dans l'ordre du document ; la première valeur vue
    l'emporte, jamais une seconde qui la contredirait en silence)."""
    reste = texte
    m = dm.RE_EMAIL.search(reste)
    if m and not auteur['email']:
        auteur['email'] = m.group(1)
        reste = reste.replace(m.group(0), ' ')
    m = dm.RE_ORCID.search(reste)
    if m and not auteur['orcid']:
        auteur['orcid'] = m.group(1)
        reste = reste.replace(m.group(0), ' ')
    reste = RE_ETIQUETTE_RESIDUELLE.sub(' ', reste)
    reste = re.sub(r'\s+', ' ', reste).strip(' ,;').strip()
    if not reste:
        return
    if RE_INSTITUTION.search(reste) and not auteur['institution']:
        auteur['institution'] = reste
    elif not auteur['fonction']:
        auteur['fonction'] = reste
    elif not auteur['institution']:
        auteur['institution'] = reste
    else:
        auteur['institution'] = (auteur['institution'] + ', ' + reste).strip(', ')


def _tenter_nom_virgule_avec_info(texte):
    """« Nom, Prénom[, institution, téléphone, e-mail…] » — UNE fiche, jamais une byline :
    seulement quand les DEUX PREMIERS segments (virgule) sont chacun un mot UNIQUE capitalisé
    (une byline « Prénom Nom, Prénom Nom » a toujours 2+ mots par segment — _tenter_noms() la
    reconnaît déjà, et cette fonction n'est tentée qu'après son échec). Mesuré (superviseur,
    21.09.2026) sur 1_Résumé-article-revue-CSPS.docx : « Protti, Delphine, HEP-VD, +41 79 507
    58 10, delphine.protti@edu-vd.ch » — nom et prénom portés PAR LA VIRGULE, dans cet ordre
    (Nom, Prénom), le reste de la ligne étant l'info de CETTE seule personne. Rend (prenom,
    nom, segments_info) ou None si le motif ne tient pas."""
    segments = []
    for part in dm.CONNECTEURS.split(texte):
        part = (part or '').strip().strip(',;').replace('†', '').strip()
        if part:
            segments.append(part)
    if len(segments) < 2:
        return None
    nom, prenom = segments[0], segments[1]
    if len(nom.split()) != 1 or len(prenom.split()) != 1:
        return None
    if not dm.nom_plausible(nom + ' ' + prenom):
        return None
    return prenom, nom, segments[2:]


# ---------------------------------------------------------------------------------
# L'extraction — un seul passage, dans l'ordre du document (§5.5).

def _est_marqueur_connu(texte):
    return bool(dm.RE_RESUME.match(texte) or dm.RE_KEYWORDS.match(texte)
                or (dm.RE_DOI_LIGNE.match(texte) and dm.RE_DOI.search(texte))
                or dm.RE_JOURNAL.match(texte))


def extraire_entete(document, langue, base_noms=None, noms_biblio=None):
    """(EnTete, indices_consommes, trace).

    `langue` : 'fr'|'de', la langue du PRODUIT déjà tranchée par la CLI (§8 du contrat) —
    jamais `document.langue`. Sert à décider si un marqueur de résumé alimente le résumé
    PRINCIPAL ou `resumes_autres` (un « Abstract » anglais sous un article français, par
    exemple), et à remplir `EnTete.langue_produit`.

    `base_noms` : une manuscrit_noms.BaseNoms, ou None (§4.2 du contrat de lot). None ne
    déclenche PAS mn.BaseNoms.charger() ici — c'est la CLI (lot D) qui décide quand la base
    est chargée, un module PUR ne va jamais chercher un fichier de production tout seul (même
    principe que manuscrit_noms.py lui-même, §3.2 de son contrat). Sans base, les signaux
    locaux (casse, e-mail, biblio) jouent quand même — seul le signal lexique se tait.

    `noms_biblio` : un set de jetons pliés certifiés noms de famille par la bibliographie du
    manuscrit (§4.2), transmis TEL QUEL dans les indices de chaque segment — la CLI le
    remplit (§6.1 de son contrat), ce module ne sait pas lire une bibliographie.

    `indices_consommes` : {indice dans document.blocs: rôle}, rôle parmi 'titre',
    'sous_titre', 'resume', 'resume_autre', 'mots_cles', 'doi', 'ligne_revue', 'auteurs'.
    L'appelant (la CLI) retire ces indices de `document.blocs` et transmet les cinq premiers
    rôles au moteur de règles (manuscrit_regles.py) — 'doi'/'ligne_revue' n'appartiennent pas
    à son vocabulaire de rôle, ils ne servent qu'à exclure ces deux paragraphes du corps.

    Zone d'en-tête (§5.5) : du début du document jusqu'au premier paragraphe « de corps » —
    premier paragraphe long (>= SEUIL_CORPS_ENTETE signes) qui ne porte pas un marqueur
    reconnu, ou premier intertitre connu (RE_INTERTITRE_CONNU). Rien en dehors de cette zone
    n'est jamais examiné : un document qui commence directement par un intertitre ne
    consomme RIEN (`indices_consommes` vide, `EnTete` entièrement vide)."""
    entete = EnTete(langue_produit=langue)
    indices = {}
    trace = []

    blocs = document.blocs
    n = len(blocs)
    titre_trouve = False
    cible_resume = None        # None | 'principal' | ('autre', code_langue)
    n_paras_resume = 0         # paragraphes déjà absorbés par LA capture en cours
    cible_courante = None      # dict auteur en cours de complément, ou None
    ambigu_courant = False
    # jetons/indices bruts de CHAQUE fiche encore rejugeable (confiance 'defaut' ou
    # 'propagee'), le temps de cette fonction seulement — jamais exposé sur la fiche
    # elle-même (§4.4 : seuls trois champs de plus, ordre_confiance/ordre_motif/
    # ordre_conflit). Clé : id(auteur), l'objet reste vivant tant qu'il est dans
    # entete.auteurs. Sert à _rejuger_apres_email_tardif() ci-dessous (§4.2 : « rejuger
    # alors l'ordre de cette fiche seule si sa confiance était defaut ou propagee »).
    etat_ordre = {}

    def _rejuger_apres_email_tardif(auteur):
        """Un e-mail qui arrive sur une ligne SUIVANTE (pas celle du nom) peut faire basculer
        une fiche encore incertaine : le signal e-mail est de force CERTAINE (§3.3 du contrat
        de lot A), il l'emporte sur une simple convention par défaut ou une propagation. Sans
        état à rejuger (fiche déjà 'certaine'/'probable', ou jamais passée par mn.trancher())
        : rien à faire, silencieusement."""
        etat = etat_ordre.get(id(auteur))
        if etat is None or auteur['ordre_confiance'] not in ('defaut', 'propagee'):
            return
        jetons, anciens_indices = etat
        nouveaux_indices = dict(anciens_indices, email=auteur['email'])
        decision = mn.trancher(jetons, nouveaux_indices, base_noms)
        prenom, nom = mn.repartir(jetons, decision['ordre'])
        auteur['prenom'], auteur['nom'] = prenom, nom
        auteur['ordre_confiance'] = decision['confiance']
        auteur['ordre_motif'] = decision['motif']
        auteur['ordre_conflit'] = decision['conflit']
        auteur['ordre'] = decision['ordre']
        etat_ordre[id(auteur)] = (jetons, nouveaux_indices)

    def _longueur_resume_courant():
        if cible_resume == 'principal':
            return len(entete.resume)
        return len(entete.resumes_autres.get(cible_resume[1], ''))

    i = 0
    while i < n:
        bloc = blocs[i]
        if isinstance(bloc, mm.Tableau):
            break
        texte = bloc.texte().strip()
        if not texte:
            i += 1
            continue

        # Capture d'un résumé en cours : priorité sur toute autre classification, jusqu'au
        # marqueur suivant ou au premier intertitre (§5.5) — mais un résumé doit s'arrêter
        # DUR, jamais avaler le document : au premier paragraphe court entièrement en gras
        # (un pseudo-titre que classer_titres() n'a pas encore vu — cette extraction tourne
        # AVANT lui), et de toute façon au-delà de PLAFOND_RESUME_SIGNES signes ou
        # PLAFOND_RESUME_PARAGRAPHES paragraphes. Mesuré (superviseur, 21.09.2026) sur
        # `3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx`, qui ne promeut aucun titre (ses
        # intertitres sont des pseudo-titres en gras non détectés) : sans ce plafond, la
        # capture s'enchaînait du paragraphe 3 jusqu'à la fin du document (63 -> 29
        # paragraphes de corps).
        if cible_resume is not None:
            if RE_INTERTITRE_CONNU.match(texte):
                break                              # fin de l'en-tête, PAS consommé
            pseudo_titre = (len(texte) < SEUIL_PSEUDO_TITRE_COURT
                             and _tout_gras_effectif(bloc))
            plafond_atteint = (n_paras_resume >= PLAFOND_RESUME_PARAGRAPHES
                                or _longueur_resume_courant() + len(texte) > PLAFOND_RESUME_SIGNES)
            if pseudo_titre or plafond_atteint:
                if plafond_atteint:
                    trace.append({'portee': 'document', 'source': None,
                                  'decision': 'resume_interrompu',
                                  'motif': 'résumé interrompu : longueur inhabituelle '
                                           '(déjà %d signe(s) sur %d paragraphe(s)), '
                                           'vérifiez' % (_longueur_resume_courant(),
                                                          n_paras_resume)})
                cible_resume = None
                n_paras_resume = 0
                # PAS consommé : reclassé normalement ci-dessous (un pseudo-titre gras ne
                # matche aucun marqueur, il reste "non_reconnu", laissé au corps — c'est
                # classer_titres(), pas ce module, qui tranchera s'il devient un titre).
            elif not _est_marqueur_connu(texte):
                if cible_resume == 'principal':
                    entete.resume = (entete.resume + ' ' + texte).strip()
                    indices[i] = 'resume'
                else:
                    code = cible_resume[1]
                    entete.resumes_autres[code] = (
                        entete.resumes_autres.get(code, '') + ' ' + texte).strip()
                    indices[i] = 'resume_autre'
                n_paras_resume += 1
                trace.append({'source': bloc.source, 'decision': 'resume_suite',
                              'motif': 'paragraphe rattaché au résumé en cours (%s)'
                                       % (cible_resume if cible_resume == 'principal'
                                          else 'langue étrangère ' + cible_resume[1])})
                i += 1
                continue
            else:
                cible_resume = None   # nouveau marqueur : classé normalement ci-dessous
                n_paras_resume = 0

        # Coupure de la zone d'en-tête (§5.5), sauf sur un paragraphe qui porte lui-même un
        # marqueur reconnu (un résumé de 500 signes ne doit pas se couper lui-même).
        if RE_INTERTITRE_CONNU.match(texte):
            break
        if len(texte) >= SEUIL_CORPS_ENTETE and not _est_marqueur_connu(texte):
            break

        if not titre_trouve:
            j = i + 1
            while j < n and isinstance(blocs[j], mm.Paragraphe) and not blocs[j].texte().strip():
                j += 1
            bloc2 = blocs[j] if j < n and isinstance(blocs[j], mm.Paragraphe) else None
            texte2 = bloc2.texte().strip() if bloc2 is not None else ''
            titre, sous_titre, consomme2 = _titre_et_sous_titre(bloc, texte, bloc2, texte2)
            entete.titre = titre
            indices[i] = 'titre'
            trace.append({'source': bloc.source, 'decision': 'titre',
                          'motif': 'premier paragraphe non vide du document'})
            if consomme2:
                entete.sous_titre = sous_titre
                indices[j] = 'sous_titre'
                trace.append({'source': bloc2.source, 'decision': 'sous_titre',
                              'motif': 'même signature que le titre, deuxième ligne (%s)'
                                       % ('finit par « : »' if texte.endswith(':')
                                          else 'sans ponctuation finale')})
                i = j + 1
            else:
                if sous_titre:
                    entete.sous_titre = sous_titre
                    trace.append({'source': bloc.source, 'decision': 'sous_titre',
                                  'motif': 'scindé sur le deux-points de la même ligne'})
                i += 1
            titre_trouve = True
            continue

        m = dm.RE_RESUME.match(texte)
        if m:
            declencheur = m.group(1)
            lang = dm.langue_resume(declencheur) or langue
            reste = dm.RE_RESUME.sub('', texte, count=1).strip()
            # Marqueur suivi d'une lettre de langue isolée (« Résumé F », « Zusammenfassung
            # D ») — mesuré sur 2-fin-de-document_Article_RSPS.docx : sans ce retrait, le
            # résumé capturé commençait par « F\n... ».
            reste = RE_LETTRE_LANGUE_ISOLEE.sub('', reste, count=1)
            n_paras_resume = 1
            if lang == langue and not entete.resume:
                cible_resume = 'principal'
                entete.langue_resume = lang
                indices[i] = 'resume'
                if reste:
                    entete.resume = reste
            else:
                cible_resume = ('autre', lang)
                indices[i] = 'resume_autre'
                if reste:
                    entete.resumes_autres[lang] = reste
            trace.append({'source': bloc.source, 'decision': 'resume_marqueur',
                          'motif': 'marqueur « %s » reconnu (%s)'
                                   % (declencheur,
                                      'résumé principal' if cible_resume == 'principal'
                                      else 'langue étrangère ' + lang)})
            i += 1
            continue

        if dm.RE_KEYWORDS.match(texte):
            brut = dm.RE_KEYWORDS.sub('', texte, count=1).strip()
            par_langue = dm.decouper_keywords(brut, langue)
            entete.mots_cles = par_langue.get(langue) or next(iter(par_langue.values()), [])
            indices[i] = 'mots_cles'
            trace.append({'source': bloc.source, 'decision': 'mots_cles',
                          'motif': '%d mot(s)-clé(s)' % len(entete.mots_cles)})
            i += 1
            continue

        if dm.RE_DOI_LIGNE.match(texte) and dm.RE_DOI.search(texte):
            entete.doi = dm.nettoyer_doi(texte)
            indices[i] = 'doi'
            trace.append({'source': bloc.source, 'decision': 'doi', 'motif': entete.doi})
            i += 1
            continue

        if dm.RE_JOURNAL.match(texte):
            entete.ligne_revue = texte
            indices[i] = 'ligne_revue'
            trace.append({'source': bloc.source, 'decision': 'ligne_revue', 'motif': texte})
            i += 1
            continue

        resultat_noms = _tenter_noms(texte, bloc, base_noms, noms_biblio)
        if resultat_noms:
            entrees, infos_meme_ligne = resultat_noms
            for a in entrees:
                auteur = _nouvel_auteur(a['prenom'], a['nom'], texte, a['ordre_confiance'],
                                         a['ordre_motif'], a['ordre_conflit'], a['ordre'])
                entete.auteurs.append(auteur)
                etat_ordre[id(auteur)] = (a['jetons'], a['indices'])
            # Les infos de la MÊME ligne (§4.1) ne sont rattachées que s'il y a EXACTEMENT un
            # nom sur cette ligne — sinon on ne devine pas à qui elles appartiennent, tout
            # comme une info sur une ligne suivante avec plusieurs noms ouverts ensemble.
            if len(entrees) == 1:
                cible_courante = entete.auteurs[-1]
                ambigu_courant = False
                # L'e-mail de CETTE ligne, s'il y en a un, a déjà joué comme signal dans
                # _tenter_noms() (passé à mn.trancher_groupe() AVANT la décision, §4.2) —
                # jamais besoin de le rejuger ici, seul un e-mail qui arrive plus tard
                # (branche _est_ligne_auteur() ci-dessous) déclenche un nouveau jugement.
                for info in infos_meme_ligne:
                    _fusionner_info(cible_courante, info)
            else:
                cible_courante = None
                ambigu_courant = True
            indices[i] = 'auteurs'
            trace.append({'source': bloc.source, 'decision': 'auteur',
                          'motif': '%d nom(s) reconnu(s) sur cette ligne, ordre par '
                                   'manuscrit_noms (%s)'
                                   % (len(entrees),
                                      ', '.join(a['ordre_confiance'] for a in entrees))})
            i += 1
            continue

        resultat_virgule = _tenter_nom_virgule_avec_info(texte)
        if resultat_virgule:
            prenom, nom, segments_info = resultat_virgule
            # Ordre CERTAIN par construction (la virgule le porte, jamais un signal de
            # mn.trancher() à consulter) : cette fonction ne passe jamais par mn, l'ordre ne
            # peut donc jamais être « rejugé » plus tard par un e-mail tardif (§4.2) — il n'y
            # a rien à rejuger, la virgule ne ment pas.
            auteur = _nouvel_auteur(prenom, nom, texte, 'certaine',
                                     'ordre porté par la virgule « Nom, Prénom » (motif '
                                     'structurel, pas un signal de manuscrit_noms)')
            n_telephones = 0
            for seg in segments_info:
                if RE_TELEPHONE.match(seg):
                    n_telephones += 1
                    continue
                _fusionner_info(auteur, seg)
            entete.auteurs.append(auteur)
            cible_courante = auteur
            ambigu_courant = False
            indices[i] = 'auteurs'
            trace.append({'source': bloc.source, 'decision': 'auteur_virgule',
                          'motif': 'nom « %s, %s » reconnu (virgule, deux mots), %d info(s) '
                                   'rattachée(s) sur la même ligne%s'
                                   % (nom, prenom, len(segments_info) - n_telephones,
                                      (' (%d téléphone(s) écarté(s), aucun champ ne le '
                                       'porte)' % n_telephones) if n_telephones else '')})
            i += 1
            continue

        if _est_ligne_auteur(texte):
            indices[i] = 'auteurs'
            if ambigu_courant or cible_courante is None:
                trace.append({'source': bloc.source, 'decision': 'auteur_info_non_attribuee',
                              'motif': "ligne de la zone auteurs, mais non attribuée : "
                                       "plusieurs noms déclarés ensemble juste avant, ou "
                                       "aucun auteur connu pour la recevoir"})
            else:
                email_avant = cible_courante['email']
                _fusionner_info(cible_courante, texte)
                if not email_avant and cible_courante['email']:
                    # E-mail arrivé sur une ligne SUIVANTE (§4.2) : le signal e-mail (force
                    # certaine, §3.3 du contrat de lot A) peut faire mieux qu'une convention
                    # par défaut ou une propagation — rejugé une seule fois, ici.
                    _rejuger_apres_email_tardif(cible_courante)
                trace.append({'source': bloc.source, 'decision': 'auteur_info',
                              'motif': 'complément rattaché à %s %s'
                                       % (cible_courante['prenom'], cible_courante['nom'])})
            i += 1
            continue

        # Rien de reconnu : jamais inventer un rôle. Le paragraphe reste dans la zone
        # d'en-tête sans être consommé — un paragraphe court isolé n'est pas, à lui seul, la
        # preuve que le corps a commencé (§5.5 : la coupure est un intertitre connu ou un
        # paragraphe LONG, pas un paragraphe non reconnu).
        trace.append({'source': bloc.source, 'decision': 'non_reconnu',
                      'motif': "paragraphe court, dans la zone d'en-tête, mais aucun motif "
                               "ne le rattache à un rôle connu : conservé tel quel"})
        i += 1

    return entete, indices, trace


# ---------------------------------------------------------------------------------
# Bloc final « Informations sur les autrices et auteurs » — appelé APRÈS extraire_entete(),
# sur le document encore complet (mêmes indices que `indices_consommes` ci-dessus, même
# convention pour l'appelant). Fusionne ce qu'il trouve dans l'EnTete déjà construite par la
# tête du manuscrit, ne crée jamais un second EnTete.

def _cle_nom(texte):
    """Normalisation grossière d'un nom pour la fusion ci-dessous : casse et accents retirés,
    espaces multiples réduits — « Isabel Valarino » == « ISABEL   VALARINO »."""
    t = unicodedata.normalize('NFKD', texte or '')
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', t).strip().casefold()


def _ensemble_jetons_nom(auteur):
    """Ensemble de jetons pliés (prénom + nom, casse/accents retirés par _cle_nom, chacun
    éventuellement composé de plusieurs mots) — §4.3 du contrat de lot, deuxième correctif :
    apparier « Guilley Edith » (tête, ordre inverse) et « Edith Guilley » (bloc final, ordre
    direct) malgré l'ordre différent, là où la chaîne ordonnée échouait — défaut documenté au
    §5.5 bis du contrat d'architecture, mesuré sur 2-fin-de-document_Article_RSPS.docx."""
    mots = (auteur.get('prenom') or '').split() + (auteur.get('nom') or '').split()
    return frozenset(_cle_nom(m) for m in mots if _cle_nom(m))


# Rang de confiance (§4.3) : plus PETIT = meilleur (mn.CONFIANCE va du plus sûr au moins
# sûr, dans cet ordre précisément — voir son commentaire dans manuscrit_noms.py).
_RANG_CONFIANCE = {c: i for i, c in enumerate(mn.CONFIANCE)}


def _fusionner_auteurs(entete, auteurs_nouveaux):
    """Fusionne chaque auteur du bloc final dans `entete.auteurs`. Deux correctifs du §4.3 du
    contrat de lot (§5.5 bis du contrat d'architecture documentait ce défaut sans le
    corriger — hors de son périmètre à l'époque) :

    1. Apparier D'ABORD sur l'e-mail quand les deux fiches en portent un : identique -> même
       personne, quels que soient les noms (l'e-mail ne ment jamais, contrairement à l'ordre
       prénom/nom d'une byline).
    2. À défaut, comparer l'ENSEMBLE des jetons pliés plutôt que la chaîne ordonnée
       (_ensemble_jetons_nom ci-dessus) — en cas d'égalité d'ensembles avec un ORDRE
       différent (même personne, tête et bloc final ne s'accordent pas sur qui est le
       prénom), l'ordre de la fiche à la MEILLEURE confiance (mn.CONFIANCE) l'emporte, la
       trace le dit.

    Dans les deux cas -> complète les champs VIDES de la fiche déjà ouverte (jamais un champ
    déjà rempli écrasé, même règle que _fusionner_info) ; aucune correspondance -> nouvelle
    fiche, ajoutée à la fin, jamais une fiche dupliquée pour la même personne. Rend
    (n_fusionnes, n_ajoutes, notes_ordre) — `notes_ordre` : une phrase française par ordre
    repris du bloc final (§4.3 : « et le dire dans la trace »), pour que l'appelant les verse
    dans la trace RENDUE (une liste de dicts, §5.5 bis du contrat d'architecture), jamais
    cachées dans un champ de la fiche elle-même."""
    n_fusionnes = n_ajoutes = 0
    notes_ordre = []
    for nouveau in auteurs_nouveaux:
        cible = None
        email_nouveau = (nouveau.get('email') or '').strip().lower()
        if email_nouveau:
            for a in entete.auteurs:
                if (a.get('email') or '').strip().lower() == email_nouveau:
                    cible = a
                    break
        if cible is None:
            ens_nouveau = _ensemble_jetons_nom(nouveau)
            if ens_nouveau:
                for a in entete.auteurs:
                    if _ensemble_jetons_nom(a) == ens_nouveau:
                        cible = a
                        break
        if cible is not None:
            if ((cible['prenom'], cible['nom']) != (nouveau['prenom'], nouveau['nom'])
                    and _RANG_CONFIANCE.get(nouveau.get('ordre_confiance', 'defaut'), 99)
                        < _RANG_CONFIANCE.get(cible.get('ordre_confiance', 'defaut'), 99)):
                notes_ordre.append(
                    'ordre repris du bloc final pour « %s » : « %s %s » (confiance %s) '
                    'plutôt que « %s %s » (confiance %s), §4.3 du contrat de lot'
                    % (email_nouveau or ' '.join(_ensemble_jetons_nom(nouveau)),
                       nouveau['prenom'], nouveau['nom'], nouveau['ordre_confiance'],
                       cible['prenom'], cible['nom'], cible.get('ordre_confiance', 'defaut')))
                cible['prenom'], cible['nom'] = nouveau['prenom'], nouveau['nom']
                cible['ordre_confiance'] = nouveau['ordre_confiance']
                cible['ordre_motif'] = nouveau['ordre_motif']
                cible['ordre_conflit'] = nouveau['ordre_conflit']
                cible['ordre'] = nouveau.get('ordre')
            for champ in ('fonction', 'institution', 'email', 'orcid'):
                if not cible[champ] and nouveau[champ]:
                    cible[champ] = nouveau[champ]
            n_fusionnes += 1
        else:
            entete.auteurs.append(nouveau)
            n_ajoutes += 1
    return n_fusionnes, n_ajoutes, notes_ordre


def _propager_ordre_document(entete):
    """Propagation à l'échelle du DOCUMENT — §3 bis du brief « lexique élargi », principe posé
    par Robin le 22.09.2026 : **un article est écrit dans UN seul ordre prénom/nom, du début à
    la fin**. Une autrice ne signe pas « Edith Guilley » dans la byline pour redevenir
    « Sermier Dessemontet Rachel » dans le bloc final.

    Ce qui existait avant ce lot, et ne suffisait pas : mn.trancher_groupe() propage déjà,
    mais seulement au sein d'UN groupe de segments passé ensemble — et _tenter_noms() l'appelle
    UNE FOIS PAR LIGNE. La portée réelle était donc la LIGNE, pas le document : deux noms sur
    la même ligne de byline se votaient l'un l'autre, la byline et le bloc final non. Le seul
    pont entre les deux zones était _fusionner_auteurs(), qui ne rapproche que les fiches
    reconnues comme LA MÊME PERSONNE (e-mail identique, ou même ensemble de jetons) : une
    autrice présente dans les deux endroits pouvait donc y corriger son propre ordre, mais
    n'apprenait rien à ses coautrices. Défaut mesuré et corrigé ici (test
    `propagation.document.byline.et.bloc.final`).

    Appelée APRÈS _fusionner_auteurs(), quand `entete.auteurs` porte enfin les deux zones :
    c'est le seul moment du traitement où « le document » existe comme un tout.

    La règle est celle de mn.trancher_groupe(), transposée : les fiches TRANCHÉES ('certaine'
    ou 'probable') qui portent un `ordre` votent ; si elles votent toutes le même, chaque fiche
    restée en 'defaut' SANS CONFLIT adopte cet ordre en 'propagee'. Deux fiches tranchées qui
    se contredisent -> AUCUNE propagation, rien n'est touché : sans consensus, le document ne
    dit rien, et « en cas de doute, rien » (§2 de la maison).

    Rend [note, ...] — une phrase française par fiche retournée, pour la trace. Jamais une
    exception, jamais une fiche perdue."""
    tranchees = [a for a in entete.auteurs
                 if a.get('ordre_confiance') in ('certaine', 'probable') and a.get('ordre')]
    ordres = {a['ordre'] for a in tranchees}
    if len(ordres) != 1:
        return []
    ordre = ordres.pop()
    donneur = tranchees[0]
    libelle_donneur = ' '.join(x for x in (donneur.get('prenom'), donneur.get('nom')) if x)

    notes = []
    for a in entete.auteurs:
        if a.get('ordre_confiance') != 'defaut' or a.get('ordre_conflit'):
            continue
        # Les jetons d'origine, reconstitués. mn.repartir() PARTITIONNE la liste sans jamais
        # en changer l'ordre : en ordre direct le prénom est la tête et le nom la queue, en
        # ordre inverse l'inverse — recoller les deux champs dans le bon sens rend donc
        # exactement la liste reçue à l'époque. Une fiche en 'defaut' a toujours été répartie
        # par la CONVENTION, c'est-à-dire en ordre direct (mn.trancher() rend ORDRE_DIRECT
        # dans toutes ses branches par défaut) ; le `ordre` stocké le confirme quand il est là.
        if a.get('ordre') == mn.ORDRE_INVERSE:
            jetons = (a.get('nom') or '').split() + (a.get('prenom') or '').split()
        else:
            jetons = (a.get('prenom') or '').split() + (a.get('nom') or '').split()
        if len(jetons) < 2:
            continue          # un seul jeton : aucun ordre à propager, comme dans mn.
        prenom, nom = mn.repartir(jetons, ordre)
        if (prenom, nom) == (a.get('prenom'), a.get('nom')):
            # L'ordre du document confirme la convention déjà appliquée : on note la
            # confiance gagnée, sans prétendre avoir corrigé quoi que ce soit.
            a['ordre_confiance'] = 'propagee'
            a['ordre'] = ordre
            a['ordre_motif'] = ('ordre confirmé par le reste du document, depuis « %s » (%s)'
                                % (libelle_donneur, donneur.get('ordre_motif') or ''))
            continue
        ancien = '%s %s' % (a.get('prenom') or '', a.get('nom') or '')
        a['prenom'], a['nom'] = prenom, nom
        a['ordre_confiance'] = 'propagee'
        a['ordre'] = ordre
        a['ordre_motif'] = ('ordre propagé à l\'échelle du document depuis « %s » (%s)'
                            % (libelle_donneur, donneur.get('ordre_motif') or ''))
        notes.append('ordre repris du document pour « %s » : « %s %s » plutôt que « %s » '
                     '(le document écrit ses noms dans l\'ordre « %s », d\'après « %s »)'
                     % (ancien.strip(), prenom, nom, ancien.strip(), ordre, libelle_donneur))
    return notes


def _analyser_bloc_auteurs(lignes, base_noms=None, noms_biblio=None):
    """`lignes` : [(source, texte), ...] — une ligne LOGIQUE, éventuellement une parmi
    plusieurs issues d'un même paragraphe scindé sur '\\n' (Word pose souvent tout le bloc
    « informations sur les autrices » en UN SEUL paragraphe, séparé par des sauts de ligne
    manuels, §4 du contrat : Fragment '\\n' pour w:br). Rend une liste de dicts auteur (même
    schéma que _nouvel_auteur), dans l'ordre de première apparition — réutilise EXACTEMENT
    les mêmes reconnaissances que la zone d'en-tête (_tenter_noms / _tenter_nom_virgule_avec_
    info / _fusionner_info) : un nom, un « Nom, Prénom », une ligne d'info rattachée au
    dernier auteur ouvert. Un libellé allemand isolé (RE_LIBELLE_AUTEUR_FINAL_DE) n'est ni un
    nom ni une info : ignoré, sans rompre l'attribution en cours.

    `base_noms`/`noms_biblio` : mêmes paramètres qu'extraire_entete() (§4.2 du contrat de
    lot), transmis à _tenter_noms() pour que le bloc final bénéficie des mêmes signaux que la
    tête. Aucun Paragraphe du modèle riche n'est disponible ici (une ligne LOGIQUE peut
    provenir d'un paragraphe éclaté sur '\\n') : _tenter_noms() reçoit `paragraphe=None`, la
    casse MISE EN FORME (petites capitales) n'y joue donc jamais — la casse TAPÉE, elle,
    continue de fonctionner (mn._signal_casse() la lit dans le texte des jetons lui-même).
    Pas de rejugement après un e-mail tardif ici (§4.2) : ce raffinement, décrit pour la
    tête du manuscrit, n'est pas repris pour ce bloc plus simple, généralement complet en
    quelques lignes contiguës — signalé dans le rapport de livraison comme une portée
    volontairement restreinte, jamais requise par les tests du contrat."""
    auteurs = []
    cible_courante = None
    ambigu_courant = False
    for _source, texte in lignes:
        texte = (texte or '').strip()
        if not texte or RE_LIBELLE_AUTEUR_FINAL_DE.match(texte):
            continue
        resultat_noms = _tenter_noms(texte, None, base_noms, noms_biblio)
        if resultat_noms:
            entrees, infos_meme_ligne = resultat_noms
            for a in entrees:
                auteurs.append(_nouvel_auteur(a['prenom'], a['nom'], texte,
                                               a['ordre_confiance'], a['ordre_motif'],
                                               a['ordre_conflit'], a['ordre']))
            if len(entrees) == 1:
                cible_courante = auteurs[-1]
                ambigu_courant = False
                for info in infos_meme_ligne:
                    _fusionner_info(cible_courante, info)
            else:
                cible_courante = None
                ambigu_courant = True
            continue
        resultat_virgule = _tenter_nom_virgule_avec_info(texte)
        if resultat_virgule:
            prenom, nom, segments_info = resultat_virgule
            auteur = _nouvel_auteur(prenom, nom, texte, 'certaine',
                                     'ordre porté par la virgule « Nom, Prénom » (motif '
                                     'structurel, pas un signal de manuscrit_noms)')
            for seg in segments_info:
                if not RE_TELEPHONE.match(seg):
                    _fusionner_info(auteur, seg)
            auteurs.append(auteur)
            cible_courante = auteur
            ambigu_courant = False
            continue
        if RE_TELEPHONE.match(texte):
            continue
        if cible_courante is not None and not ambigu_courant:
            _fusionner_info(cible_courante, texte)
        # sinon : ligne non attribuable — jamais inventé (même principe que
        # 'auteur_info_non_attribuee' dans extraire_entete()).
    return auteurs


def _est_titre_biblio_pour_repli(texte, lexique):
    """Même reconnaissance que _construire_bibliographie() de manuscrit-nettoyer.py — jamais
    une seconde liste de titres, seule la petite comparaison est réécrite ici (ce module ne
    peut pas importer un fichier qui porte un tiret dans son nom sans le charger par chemin,
    et la CLI, elle, ne peut pas être importée du tout : convention du dépôt, §3 du contrat)."""
    plat = pronto_modele.RE_NUM_TITRE_BIBLIO.sub('', pronto_modele.aplatir(texte))
    if plat in lexique:
        return True
    for prefixe in pronto_modele.PREFIXES_TITRE_BIBLIO:
        if plat.startswith(prefixe) and plat[len(prefixe):] in lexique:
            return True
    return False


# Silhouette d'une ENTRÉE bibliographique (pas son intitulé, reconnu ci-dessus) : deuxième
# garde du repli, symétrique à _est_titre_biblio_pour_repli — une année de publication, entre
# parenthèses (« Walton, E. (2025). ») ou non (« UNESCO, 2017. » — autrice institutionnelle
# sans initiale ; « Marques, M.M., Valente-Rosa, M.J., Martins, J.L., 2007. » — plusieurs
# autrices), immédiatement encadrée par la ponctuation d'une référence : une parenthèse
# fermante juste après les 4 chiffres, ou un point juste après (avec au plus une lettre de
# désambiguïsation APA, « 2020a. », entre les deux). Les quatre formes réelles mesurées sur
# 1408_Alves.docx (voir le commentaire de SEUIL_LIGNE_AUTEUR_FINAL) passent toutes ce motif.
#
# Volontairement PAS une simple recherche de « 4 chiffres 19xx/20xx n'importe où dans le
# texte » : une ligne d'info d'autrice pourrait en théorie mentionner une date en prose
# (« depuis 2018 »), jamais accolée à une virgule AVANT et un point (ou une parenthèse fermante)
# JUSTE APRÈS — c'est la forme d'une référence, jamais celle d'une phrase ; aucune des lignes
# de nom/fonction/institution/e-mail/ORCID/téléphone du corpus mesuré ne porte une année de
# publication, ce qui rend cette garde négative sûre (voir le contrat, §5.5 bis). Ni DOI ni
# URL ici : aucune des quatre occurrences mesurées n'en porte, et rien dans le corpus ne
# permet encore de juger le risque de faux positif sur une ligne d'info — à réévaluer si un
# manuscrit réel l'exige (ne pas ajouter cette extension sans un cas mesuré, §1 du contrat).
RE_ANNEE_REFERENCE_BIBLIO = re.compile(r'\((?:19|20)\d{2}[a-z]?\)|,\s*(?:19|20)\d{2}[a-z]?\.')


def _ressemble_reference_biblio_pour_repli(texte):
    """Silhouette d'une entrée bibliographique (jamais son intitulé, voir la fonction
    précédente) : rencontrée pendant le repli, elle marque la FIN du bloc d'autrices/auteurs
    — ce n'est pas un trou à sauter, l'appelant doit s'arrêter net (`break`), jamais continuer
    la marche arrière au-delà en se contentant de l'exclure elle."""
    return bool(RE_ANNEE_REFERENCE_BIBLIO.search(texte))


def extraire_bloc_auteurs_final(document, entete, langue, indices_entete=None,
                                 base_noms=None, noms_biblio=None):
    """(indices_consommes, trace) — même convention que extraire_entete() : l'appelant retire
    ces indices de `document.blocs`. Appelée APRÈS extraire_entete(), sur le document encore
    COMPLET (les indices sont donc dans le même espace que ceux d'extraire_entete()).

    `base_noms`/`noms_biblio` : mêmes paramètres qu'extraire_entete() (§4.2 du contrat de
    lot), transmis tels quels à _analyser_bloc_auteurs().

    `indices_entete` : les indices déjà consommés par extraire_entete() (la ZONE D'EN-TÊTE,
    §5.5) — jamais revisités ici, ni comme marqueur ni comme repli. Sans cette frontière, un
    document COURT où toutes les lignes sont brèves (un des cas de ce fichier de test) se fait
    reparcourir en entier par le repli ci-dessous, qui réattribue à tort une ligne de la TÊTE
    (par exemple l'intertitre qui clôt la zone d'en-tête) comme complément d'un auteur déjà
    ouvert plus haut — mesuré, corrigé par cette frontière.

    Deux voies de reconnaissance, dans cet ordre :
    1. un intertitre connu (RE_INTERTITRE_AUTEURS_FINAL, le DERNIER du document s'il y en a
       plusieurs) : tout, du marqueur jusqu'à la fin du document ou jusqu'à un Tableau, est le
       bloc ;
    2. à défaut, un repli : le plus long groupe de paragraphes COURTS (< SEUIL_LIGNE_AUTEUR_
       FINAL signes) en fin de document, en s'arrêtant net sur un intitulé de bibliographie
       reconnu (jamais avalé) OU sur la SILHOUETTE d'une entrée de bibliographie (une année de
       publication, _ressemble_reference_biblio_pour_repli — une référence courte n'est pas un
       trou à sauter, c'est la fin du bloc, même sous SEUIL_LIGNE_AUTEUR_FINAL) — consommé
       SEULEMENT s'il porte au moins un nom plausible (sinon rien, §1 du contrat : « en cas de
       doute, rien, et on le dit »)."""
    blocs = document.blocs
    n = len(blocs)
    indices_entete = indices_entete or {}
    lexique_biblio = pronto_modele.lire_titres_bib()

    indice_marqueur = None
    for i, bloc in enumerate(blocs):
        if i in indices_entete or isinstance(bloc, mm.Tableau):
            continue
        texte = bloc.texte().strip()
        if texte and RE_INTERTITRE_AUTEURS_FINAL.match(texte):
            indice_marqueur = i

    if indice_marqueur is not None:
        indices = {}
        lignes = []
        for i in range(indice_marqueur, n):
            bloc = blocs[i]
            if isinstance(bloc, mm.Tableau):
                break
            indices[i] = 'auteurs'
            if i == indice_marqueur:
                continue
            for ligne in bloc.texte().strip().split('\n'):
                lignes.append((bloc.source, ligne))
        auteurs = _analyser_bloc_auteurs(lignes, base_noms, noms_biblio)
        n_fusionnes, n_ajoutes, notes_ordre = _fusionner_auteurs(entete, auteurs)
        trace = [{'source': blocs[indice_marqueur].source,
                  'decision': 'bloc_auteurs_final_marqueur',
                  'motif': "intertitre « %s » reconnu : %d fiche(s) fusionnée(s), %d "
                           "ajoutée(s)" % (blocs[indice_marqueur].texte().strip(),
                                           n_fusionnes, n_ajoutes)}]
        trace += [{'portee': 'document', 'source': None, 'decision': 'ordre_repris_bloc_final',
                   'motif': note} for note in notes_ordre]
        trace += [{'portee': 'document', 'source': None, 'decision': 'ordre_propage_document',
                   'motif': note} for note in _propager_ordre_document(entete)]
        return indices, trace

    i = n - 1
    indices_candidats = []
    while i >= 0:
        if i in indices_entete:
            break
        bloc = blocs[i]
        if isinstance(bloc, mm.Tableau):
            break
        texte = bloc.texte().strip()
        if texte:
            if _est_titre_biblio_pour_repli(texte, lexique_biblio):
                break
            if _ressemble_reference_biblio_pour_repli(texte):
                break
            if len(texte) >= SEUIL_LIGNE_AUTEUR_FINAL:
                break
        indices_candidats.append(i)
        i -= 1
    indices_candidats.reverse()

    lignes = []
    for idx in indices_candidats:
        texte = blocs[idx].texte().strip()
        if texte:
            for ligne in texte.split('\n'):
                lignes.append((blocs[idx].source, ligne))
    auteurs = _analyser_bloc_auteurs(lignes, base_noms, noms_biblio)
    if not auteurs:
        # Aucun bloc final : la byline reste à elle seule « le document », et ses lignes ont
        # été jugées SÉPARÉMENT (un appel à mn.trancher_groupe() par ligne). Une byline sur
        # deux lignes a donc encore besoin de cette passe.
        trace = [{'portee': 'document', 'source': None,
                  'decision': 'bloc_auteurs_final_absent',
                  'motif': "aucun bloc d'informations sur les autrices et auteurs reconnu "
                           "en fin de document"}]
        trace += [{'portee': 'document', 'source': None, 'decision': 'ordre_propage_document',
                   'motif': note} for note in _propager_ordre_document(entete)]
        return {}, trace
    n_fusionnes, n_ajoutes, notes_ordre = _fusionner_auteurs(entete, auteurs)
    trace = [{'source': blocs[indices_candidats[0]].source,
              'decision': 'bloc_auteurs_final_heuristique',
              'motif': "%d paragraphe(s) court(s) en fin de document reconnus comme "
                       "informations d'autrices/auteurs (aucun intertitre) : %d fiche(s) "
                       "fusionnée(s), %d ajoutée(s)"
                       % (len(indices_candidats), n_fusionnes, n_ajoutes)}]
    trace += [{'portee': 'document', 'source': None, 'decision': 'ordre_repris_bloc_final',
               'motif': note} for note in notes_ordre]
    trace += [{'portee': 'document', 'source': None, 'decision': 'ordre_propage_document',
               'motif': note} for note in _propager_ordre_document(entete)]
    return {i: 'auteurs' for i in indices_candidats}, trace


# ---------------------------------------------------------------------------------
# JSON — même schéma d'esprit que manuscrit_modele.py : `document_depuis_json`/
# `document_vers_json` sont réutilisés tels quels (importés, jamais recopiés) pour le
# Document ; seule EnTete a besoin de sa propre conversion.

def entete_vers_json(entete):
    return {'titre': entete.titre, 'sous_titre': entete.sous_titre,
            'auteurs': [dict(a) for a in entete.auteurs], 'resume': entete.resume,
            'langue_resume': entete.langue_resume,
            'resumes_autres': dict(entete.resumes_autres),
            'mots_cles': list(entete.mots_cles), 'doi': entete.doi,
            'ligne_revue': entete.ligne_revue, 'langue_produit': entete.langue_produit}


# ---------------------------------------------------------------------------------
# Mode diagnostic — patron de manuscrit_modele.py : {"langue": "fr"|"de", "document": {...}}
# sur stdin (le Document JSON déjà documenté en tête de manuscrit_modele.py), une ligne JSON
# sur stdout. `document` en sortie porte l'état APRÈS retrait des indices consommés — c'est
# ainsi que la CLI l'utilise (§8), et c'est ce qu'un test doit relire pour vérifier que
# l'en-tête a bien quitté le corps.

def principal(argv):
    if '--diagnostic' not in argv[1:]:
        print('usage : manuscrit_entete.py --diagnostic   '
              '({"langue": "fr"|"de", "document": {...}} JSON sur stdin)', file=sys.stderr)
        return 2

    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    try:
        donnees = json.loads(sys.stdin.read())
    except Exception as e:
        print('[manuscrit_entete] JSON d\'entrée illisible : %s' % e, file=sys.stderr)
        return 1

    document = mm.document_depuis_json(donnees.get('document') or {})
    langue = donnees.get('langue') or 'fr'
    entete, indices, trace = extraire_entete(document, langue)
    indices_final, trace_final = extraire_bloc_auteurs_final(document, entete, langue, indices)
    indices.update(indices_final)
    trace = trace + trace_final
    document.blocs = [b for idx, b in enumerate(document.blocs) if idx not in indices]

    resultat = {
        'entete': entete_vers_json(entete),
        'indices_consommes': {str(k): v for k, v in indices.items()},
        'trace': trace,
        'document': mm.document_vers_json(document),
    }
    print(json.dumps(resultat, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
