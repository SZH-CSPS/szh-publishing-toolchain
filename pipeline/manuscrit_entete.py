#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Reconnaît l'en-tête d'un manuscrit (titre, sous-titre, auteurs, résumé, mots-clés, DOI,
# ligne de revue), avant le classement des titres du corps. Voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
# Le module ne connaît ni Word ni OpenDocument : il travaille sur le Document du modèle riche.
# De manuscrit_modele.py, il n'importe que les classes et les convertisseurs JSON
# (document_depuis_json, document_vers_json), pas classer_titres() ni ses fonctions internes.
#
# Les motifs et fonctions de lecture viennent de pipeline/heritage_meta.py, déjà utilisé par
# l'import Word : RE_RESUME, LANG_RESUME, RE_KEYWORDS, RE_DOI_LIGNE, RE_DOI, RE_JOURNAL,
# langue_resume(), nettoyer_doi(), decouper_keywords(), scinder_titre(), CONNECTEURS,
# nom_plausible(), sans_titres_academiques(), RE_EMAIL, RE_ORCID. Ce module les applique à
# des paragraphes libres, là où docx-meta.py lit le tableau des auteurs du gabarit.
# L'attribution prénom/nom revient à pipeline/manuscrit_noms.py.
#
# Bibliothèque standard seule.

import json
import os
import re
import sys
import unicodedata

_ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _ICI)
import szh_commun
import manuscrit_modele as mm
import pronto_modele
# manuscrit_noms décide qui est le prénom et qui est le nom. Ce module recueille les jetons
# et les indices, puis appelle mn.trancher_groupe() et mn.repartir().
import manuscrit_noms as mn


import heritage_meta as hm


# ---------------------------------------------------------------------------------
# Seuils et lexiques.

# Longueur, en signes, au-delà de laquelle un paragraphe qui n'est pas un résumé marque le
# début du corps. Les paragraphes de corps de la Revue font 768 à 1525 signes ; un résumé
# (400 à 700) peut dépasser le seuil, d'où l'exception pour un paragraphe qui porte un
# marqueur reconnu (résumé, mots-clés, DOI, revue).
SEUIL_CORPS_ENTETE = 300

# Intertitres qui ferment la zone d'en-tête. Liste courte exprès : un faux positif coupe
# l'en-tête trop tôt, alors qu'un oubli est presque toujours rattrapé par le seuil de
# longueur ci-dessus.
RE_INTERTITRE_CONNU = re.compile(
    r'^(?:introduction|einleitung|einf[üu]hrung|\d+[.\)]\s)', re.I)

# Mots qui trahissent une ligne d'affiliation même quand aucun nom n'y est reconnu (une
# institution seule sur sa propre ligne, sous le nom de l'autrice ou l'auteur).
RE_INSTITUTION = re.compile(
    r'\b(HEP|Universit[ée]|Haute\s+[ée]cole|Hochschule|Universit[äa]t|Institut|Centre|'
    r'Fondation|Stiftung|Verein|Association|PH\b'
    # Formes juridiques, sensibles à la casse : le possessif « sa » (« sa fonction ») n'est
    # pas une société anonyme.
    r'|(?-i:\b(?:AG|GmbH|SA|Sàrl|e\.\s?V\.)(?!\w)))', re.I)

RE_PONCTUATION_FINALE = re.compile(r'[.!?:;]\s*$')

# Plafonds de la capture d'un résumé. Sans eux, faute de titre pour la borner, la capture
# peut courir jusqu'à la fin du document. Un résumé fait 400 à 700 signes : 1500 laisse de la
# marge, et 4 paragraphes couvrent un résumé coupé en morceaux.
PLAFOND_RESUME_SIGNES = 1500
PLAFOND_RESUME_PARAGRAPHES = 4

# Un paragraphe court et entièrement gras, pendant la capture d'un résumé, est un
# pseudo-titre que classer_titres() (qui tourne après ce module) n'a pas encore traité. Un
# intertitre de la Revue fait 17 à 19 mots.
SEUIL_PSEUDO_TITRE_COURT = 120

# Lettre de langue isolée après le marqueur de résumé (« Résumé F », « Zusammenfassung D »),
# séparée du texte par un saut de ligne (w:br). Retirée seulement devant ce saut de ligne,
# pas devant une espace : « À l'école… » garde son « À ».
RE_LETTRE_LANGUE_ISOLEE = re.compile(r'^[A-Za-zÀ-ÿ]\n\s*')

# Numéro de téléphone (« +41 79 507 58 10 »), reconnu pour être écarté : EnTete.auteurs n'a
# pas de champ téléphone, et il ne doit devenir ni fonction ni institution.
RE_TELEPHONE = re.compile(r'^\+?[\d][\d .\-/]{5,}\d$')

# Bloc final « Informations sur les autrices et auteurs » (nom, fonction, institution,
# e-mail), que la Revue demande en fin de manuscrit. Sans lui, ces paragraphes tomberaient
# dans la bibliographie et y produiraient de fausses alertes APA.
RE_INTERTITRE_AUTEURS_FINAL = re.compile(
    r'^(?:informations?\s+sur\s+les\s+(?:autrices?|auteur[^\s:]*)(?:\s*(?:et|,)\s*auteurs?)?'
    r'|angaben\s+zu\s+den\s+autor)\W*$', re.I)

# Libellés allemands qui accompagnent parfois le bloc sans l'introduire : ignorés, pour ne
# pas devenir fonction ou institution. Forme pas encore rencontrée dans un manuscrit réel.
RE_LIBELLE_AUTEUR_FINAL_DE = re.compile(
    r'^(?:autorinnen\s+und\s+autoren|kontakt)\s*:?\s*$', re.I)

# Longueur maximale d'une ligne du bloc d'auteurs final reconnu sans intertitre. Une ligne de
# fonction, d'adresse ou d'e-mail fait 15 à 50 signes, une référence le plus souvent bien plus.
# Mais des références courtes passent sous le seuil (« Morin, E. (2005). Introduction à la
# pensée complexe. Points éditions du Seuil. », 78 signes) : la seconde garde,
# _ressemble_reference_biblio_pour_repli(), arrête le repli sur la forme d'une référence.
# Un intitulé comme « Bibliographie » est écarté par lire_titres_bib().
SEUIL_LIGNE_AUTEUR_FINAL = 120


# ---------------------------------------------------------------------------------
# EnTete : un champ que rien n'a rempli vaut '', [] ou {}.

class EnTete:
    """`auteurs` : liste de dicts prenom/nom/fonction/institution/email/orcid/texte_source.
    `resumes_autres` : dict langue (ou 'abstract' si le marqueur ne dit pas laquelle) ->
    texte, pour un résumé dans une autre langue que celle du produit. `langue_produit` : la
    langue passée à extraire_entete(), celle du produit et non document.langue ;
    manuscrit_gabarit.ecrire() la lit."""

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


# Champs d'une fiche d'auteur. Les champs qui suivent `texte_source` sont ajoutés en fin de
# tuple, pour ne pas décaler un lecteur qui itérerait par position.
#  - `ordre_confiance` : une valeur de mn.CONFIANCE.
#  - `ordre_motif` : la phrase qui la justifie (mn.trancher() ou trancher_groupe() ; pour
#    _tenter_nom_virgule_avec_info(), le motif structurel propre à ce module).
#  - `ordre_conflit` : le `conflit` de mn.trancher(). C'est lui qui distingue un `defaut`
#    par conflit d'un `defaut` faute d'indice ; le texte du motif peut être reformulé.
#  - `ordre` : mn.ORDRE_DIRECT, mn.ORDRE_INVERSE ou None. Il permet à
#    _propager_ordre_document() de lire l'ordre d'une fiche tranchée et de retrouver ses
#    jetons d'origine.
#  - `ror` et `a_verifier` : jamais lus dans le manuscrit ;
#    manuscrit_identifiants.enrichir_auteurs() les remplit (`a_verifier` : champs trouvés par
#    recherche, que le gabarit écrit en révision suivie).
# manuscrit_gabarit._remplir_fiche_auteur() ne lit que les champs de _CHAMPS_AUTEUR_GABARIT
# et ignore les autres.
#
# `ordre` vaut None, et la fiche ne vote pas pour l'ordre du document, quand l'ordre vient de
# la forme « Nom, Prénom » (_tenter_nom_virgule_avec_info). La virgule dit l'ordre de ce
# segment, pas la convention du document : une byline « Guilley, Edith » peut côtoyer
# « Edith Guilley » dans le texte.
CHAMPS_AUTEUR_ENTETE = ('prenom', 'nom', 'fonction', 'institution', 'email', 'orcid',
                         'texte_source', 'ordre_confiance', 'ordre_motif', 'ordre_conflit',
                         'ordre', 'ror', 'a_verifier')


def _nouvel_auteur(prenom, nom, texte_source, ordre_confiance='defaut', ordre_motif='',
                    ordre_conflit=False, ordre=None):
    return {'prenom': prenom, 'nom': nom, 'fonction': '', 'institution': '',
            'email': '', 'orcid': '', 'texte_source': texte_source,
            'ordre_confiance': ordre_confiance, 'ordre_motif': ordre_motif,
            'ordre_conflit': bool(ordre_conflit), 'ordre': ordre,
            'ror': '', 'a_verifier': []}


# ---------------------------------------------------------------------------------
# Titre et sous-titre : deux lignes consécutives de même signature, la première finissant
# par « : » ou sans ponctuation finale. Sinon scinder_titre() coupe une seule ligne sur son
# deux-points.

def _forme_reference(paragraphe):
    """La forme effective (cascade des styles comprise) du premier fragment qui porte du
    texte. Sert seulement à comparer deux paragraphes voisins."""
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
    """True si tous les fragments non vides sont gras en forme effective. Un pseudo-titre en
    gras arrête la capture d'un résumé dans un document sans style de titre fiable."""
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
    """(titre, sous_titre, consomme_bloc2). bloc2 n'est pas un sous-titre, même de même
    signature, s'il ressemble à une ligne d'auteurs, porte un marqueur connu (résumé,
    mots-clés, DOI, revue), est l'intertitre qui ferme l'en-tête ou est trop long. Sinon une
    byline « Jean Dupont, Marie Martin » ou un « Introduction » sous un titre sans point
    final passerait pour un sous-titre."""
    if (bloc2 is not None and texte2 and len(texte2) < SEUIL_CORPS_ENTETE
            and _meme_signature(bloc1, bloc2)
            and (texte1.endswith(':') or not RE_PONCTUATION_FINALE.search(texte1))
            and not _est_ligne_auteur(texte2) and not _est_marqueur_connu(texte2)
            and not RE_INTERTITRE_CONNU.match(texte2)):
        return texte1.rstrip(' :').strip(), texte2.strip(), True
    titre, sous_titre = hm.scinder_titre(texte1)
    return titre, sous_titre, False


# ---------------------------------------------------------------------------------
# Auteurs : une ligne « Prénom Nom[, Prénom Nom…] » ouvre une ou plusieurs fiches ; une ligne
# d'info qui suit (e-mail, ORCID, institution, fonction) se rattache à la dernière fiche
# ouverte seulement. Voir extraire_entete().

def _segments_plausibles(texte):
    """Découpe la ligne comme docx-meta.auteurs_depuis_byline(), puis classe chaque segment.
    « Marie Dupont, Université de Genève » donne ainsi un nom et une info.

    Chaque segment, sans obèle (†), devient :
    - une info s'il correspond à RE_INSTITUTION, hm.RE_EMAIL, hm.RE_ORCID ou RE_TELEPHONE ;
    - sinon un nom s'il passe hm.nom_plausible(hm.sans_titres_academiques(segment)) (sans le
      retrait des titres, « Dr. phil. Romain Lanners » échouerait) ;
    - sinon la ligne n'introduit pas de noms : None. Un segment libre qu'on ne reconnaît
      pas disqualifie toute la ligne.

    Un jeton sans lettre (symbole, ponctuation, emoji) est retiré avant ces tests :
    « Marie Dupont 🎓 » échouerait sinon dans hm.nom_plausible(), qui sert aussi
    hm.auteurs_depuis_byline() et n'est donc pas modifié.

    Rend (noms, infos) : `noms`, segments sans titre académique, prêts à découper ; `infos`,
    segments bruts. None si aucun nom n'est reconnu ou si un segment n'est ni nom ni info.
    Ainsi « Université de Genève » seule sur sa ligne passe à _est_ligne_auteur(), qui la
    rattache comme institution à l'auteur ouvert."""
    noms, infos = [], []
    for part in hm.CONNECTEURS.split(texte):
        part = (part or '').strip().strip(',;').replace('†', '').strip()
        if not part:
            continue
        part_filtre = ' '.join(j for j in part.split() if any(c.isalpha() for c in j))
        if not part_filtre:
            continue
        if (RE_INSTITUTION.search(part_filtre) or hm.RE_EMAIL.search(part_filtre)
                or hm.RE_ORCID.search(part_filtre) or RE_TELEPHONE.match(part_filtre)):
            infos.append(part_filtre)
            continue
        sans_titres = hm.sans_titres_academiques(part_filtre)
        if hm.nom_plausible(sans_titres):
            noms.append(sans_titres)
            continue
        return None
    if not noms:
        return None
    return noms, infos


# ---------------------------------------------------------------------------------
# Appel de manuscrit_noms. mn.trancher_groupe() rend la décision seule (ordre, confiance,
# motif, conflit) ; la répartition en prénom et nom se demande ensuite à mn.repartir(). Ne
# pas recopier cet algorithme ici.
def _forme_effective_du_fragment(f):
    """La forme effective d'un fragment, ou sa forme directe si `effectif` est vide (même
    repli que _forme_reference())."""
    effectif = f.effectif or {}
    if any(v is not None for v in effectif.values()):
        return effectif
    return f.forme or {}


def _mots_casse_paragraphe(paragraphe):
    """[(mot, majuscules, petites_capitales)] pour chaque mot du paragraphe, d'après la
    forme effective de son fragment. On suppose qu'un mot tient dans un seul fragment (Word
    coupe rarement un run au milieu d'un mot de byline). Si un mot chevauche deux fragments,
    la liste ne correspond plus à paragraphe.texte().split() et l'on rend [] plutôt qu'une
    position fausse. Ne sert qu'à la casse mise en forme : mn._signal_casse() lit
    directement la casse tapée dans les jetons."""
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
    """Liste parallèle à `segments_jetons` de dicts {'majuscules': set(...),
    'petites_capitales': set(...)}, positions locales à chaque segment, comme les lit
    mn._jetons_marques_majuscule(). Dict vide pour un segment qu'on n'a pas pu situer dans le
    paragraphe. `paragraphe` vaut None pour le bloc d'auteurs final, lu en lignes séparées
    sur '\\n' : la casse mise en forme y est perdue, la casse tapée reste lue."""
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
    """None si la ligne n'introduit pas de nom. Sinon (entrees, infos).
    `entrees`, une par nom : prenom, nom, ordre_confiance, ordre_motif, ordre_conflit, ordre
    (pour _nouvel_auteur()), plus `jetons` et `indices`, que l'appelant garde pour rejuger
    l'ordre si un e-mail arrive plus tard ; ces deux-là ne vont pas dans la fiche.
    `infos` : les autres segments de la ligne (institution, e-mail…), que l'appelant
    rattache seulement s'il y a un seul nom sur la ligne.

    mn.trancher_groupe() est appelé une fois pour toute la ligne, ce qui permet la
    propagation entre les noms d'une même byline."""
    resultat = _segments_plausibles(texte)
    if resultat is None:
        return None
    noms, infos = resultat
    segments_jetons = [n.split() for n in noms if len(n.split()) >= 1]
    cartes_casse = _indices_casse_segments(paragraphe, segments_jetons)

    # E-mail de la même ligne, utilisé seulement avec un seul nom et un seul e-mail : sinon on
    # ne sait pas à qui il appartient.
    email_ligne = None
    if len(noms) == 1:
        emails = [hm.RE_EMAIL.search(info) for info in infos]
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
    if hm.RE_EMAIL.search(texte) or hm.RE_ORCID.search(texte):
        return True
    if RE_INSTITUTION.search(texte):
        return True
    if _segments_plausibles(texte) is not None:
        return True
    return _tenter_nom_virgule_avec_info(texte) is not None


# Étiquette d'un e-mail ou d'un ORCID en texte libre (« ORCID 0000-… », « e-mail : … »),
# retirée pour ne pas finir dans la fonction ou l'institution.
RE_ETIQUETTE_RESIDUELLE = re.compile(r'\b(orcid|e-?mail|courriel)\s*:?\s*', re.I)


def _fusionner_info(auteur, texte):
    """Rattache e-mail, ORCID, institution ou fonction à `auteur`. Un champ déjà rempli est
    gardé : la première valeur vue dans le document l'emporte."""
    reste = texte
    m = hm.RE_EMAIL.search(reste)
    if m and not auteur['email']:
        auteur['email'] = m.group(1)
        reste = reste.replace(m.group(0), ' ')
    m = hm.RE_ORCID.search(reste)
    if m and not auteur['orcid']:
        auteur['orcid'] = m.group(1)
        reste = reste.replace(m.group(0), ' ')
    reste = RE_ETIQUETTE_RESIDUELLE.sub(' ', reste)
    reste = re.sub(r'\s+', ' ', reste).strip(' ,;').strip()
    if not reste:
        return
    if RE_INSTITUTION.search(reste) and not auteur['institution']:
        auteur['institution'] = reste
    elif (RE_INSTITUTION.search(reste) and auteur['fonction']
          and not RE_INSTITUTION.search(auteur['institution'])):
        # L'institution retenue n'avait pas de mot d'institution : c'était une fonction de
        # plus, et la vraie institution arrive (plusieurs lignes de fonction avant
        # « Active Communication AG »).
        auteur['fonction'] = auteur['fonction'] + ', ' + auteur['institution']
        auteur['institution'] = reste
    elif not auteur['fonction']:
        auteur['fonction'] = reste
    elif not auteur['institution']:
        auteur['institution'] = reste
    else:
        auteur['institution'] = (auteur['institution'] + ', ' + reste).strip(', ')


def _tenter_nom_virgule_avec_info(texte):
    """« Nom, Prénom[, institution, téléphone, e-mail…] » : une seule fiche, par exemple
    « Protti, Delphine, HEP-VD, +41 79 507 58 10, delphine.protti@edu-vd.ch ». Reconnue
    seulement si les deux premiers segments sont chacun un seul mot capitalisé ; une byline
    « Prénom Nom, Prénom Nom » a plusieurs mots par segment, et _tenter_noms() est essayé
    avant. Rend (prenom, nom, segments_info), ou None."""
    segments = []
    for part in hm.CONNECTEURS.split(texte):
        part = (part or '').strip().strip(',;').replace('†', '').strip()
        if part:
            segments.append(part)
    if len(segments) < 2:
        return None
    nom, prenom = segments[0], segments[1]
    if len(nom.split()) != 1 or len(prenom.split()) != 1:
        return None
    if not hm.nom_plausible(nom + ' ' + prenom):
        return None
    return prenom, nom, segments[2:]


# ---------------------------------------------------------------------------------
# Extraction, en un passage, dans l'ordre du document.

def _est_marqueur_connu(texte):
    return bool(hm.RE_RESUME.match(texte) or hm.RE_KEYWORDS.match(texte)
                or (hm.RE_DOI_LIGNE.match(texte) and hm.RE_DOI.search(texte))
                or hm.RE_JOURNAL.match(texte))


def extraire_entete(document, langue, base_noms=None, noms_biblio=None):
    """(EnTete, indices_consommes, trace).

    `langue` : 'fr' ou 'de', la langue du produit choisie par la CLI (pas document.langue).
    Elle décide si un marqueur de résumé alimente le résumé principal ou `resumes_autres`
    (un « Abstract » sous un article français), et remplit `EnTete.langue_produit`.

    `base_noms` : une manuscrit_noms.BaseNoms, ou None. Ce module ne la charge pas, c'est la
    CLI qui le fait. Sans base, seul le signal lexique se tait.

    `noms_biblio` : jetons pliés que la bibliographie du manuscrit certifie noms de famille,
    remplis par la CLI et transmis tels quels dans les indices de chaque segment.

    `indices_consommes` : {indice dans document.blocs: rôle}, rôle parmi 'titre',
    'sous_titre', 'resume', 'resume_autre', 'mots_cles', 'doi', 'ligne_revue', 'auteurs'.
    La CLI retire ces indices de `document.blocs` et transmet les rôles au moteur de règles
    (manuscrit_regles.py), sauf 'doi' et 'ligne_revue', qui ne font qu'écarter ces
    paragraphes du corps.

    Zone d'en-tête : du début du document jusqu'au premier paragraphe de corps, c'est-à-dire
    le premier paragraphe d'au moins SEUIL_CORPS_ENTETE signes sans marqueur reconnu, ou le
    premier intertitre connu (RE_INTERTITRE_CONNU). Rien n'est examiné au-delà : un document
    qui commence par un intertitre ne consomme rien."""
    entete = EnTete(langue_produit=langue)
    indices = {}
    trace = []

    blocs = document.blocs
    n = len(blocs)
    titre_trouve = False
    cible_resume = None        # None | 'principal' | ('autre', code_langue)
    n_paras_resume = 0         # paragraphes déjà absorbés par la capture en cours
    cible_courante = None      # dict auteur en cours de complément, ou None
    ambigu_courant = False
    # Jetons et indices de chaque fiche encore rejugeable (confiance 'defaut' ou
    # 'propagee'), propres à cette fonction et absents de la fiche. Clé : id(auteur).
    # Sert à _rejuger_apres_email_tardif().
    etat_ordre = {}

    def _rejuger_apres_email_tardif(auteur):
        """Un e-mail lu sur une ligne suivante peut trancher une fiche incertaine : le
        signal e-mail, de force certaine, l'emporte sur la convention ou la propagation.
        Rien à faire pour une fiche 'certaine' ou 'probable', ou jamais passée par
        mn.trancher()."""
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

        # Capture d'un résumé en cours : prioritaire, jusqu'au marqueur suivant ou au premier
        # intertitre. Elle s'arrête aussi au premier paragraphe court entièrement gras (un
        # pseudo-titre que classer_titres(), qui tourne après, n'a pas vu), et au-delà de
        # PLAFOND_RESUME_SIGNES signes ou PLAFOND_RESUME_PARAGRAPHES paragraphes. Sans ces
        # bornes, un document sans vrai titre perdrait tout son corps dans le résumé.
        if cible_resume is not None:
            if RE_INTERTITRE_CONNU.match(texte):
                break                              # fin de l'en-tête, non consommé
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
                # Non consommé : classé normalement ci-dessous. Un pseudo-titre gras reste
                # au corps, et classer_titres() décidera s'il devient un titre.
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

        # Fin de la zone d'en-tête, sauf pour un paragraphe qui porte un marqueur reconnu
        # (un résumé de 500 signes ne se coupe pas lui-même).
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

        m = hm.RE_RESUME.match(texte)
        if m:
            declencheur = m.group(1)
            lang = hm.langue_resume(declencheur) or langue
            reste = hm.RE_RESUME.sub('', texte, count=1).strip()
            # Lettre de langue isolée après le marqueur (« Résumé F ») : voir
            # RE_LETTRE_LANGUE_ISOLEE.
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

        if hm.RE_KEYWORDS.match(texte):
            brut = hm.RE_KEYWORDS.sub('', texte, count=1).strip()
            par_langue = hm.decouper_keywords(brut, langue)
            entete.mots_cles = par_langue.get(langue) or next(iter(par_langue.values()), [])
            indices[i] = 'mots_cles'
            trace.append({'source': bloc.source, 'decision': 'mots_cles',
                          'motif': '%d mot(s)-clé(s)' % len(entete.mots_cles)})
            i += 1
            continue

        if hm.RE_DOI_LIGNE.match(texte) and hm.RE_DOI.search(texte):
            entete.doi = hm.nettoyer_doi(texte)
            indices[i] = 'doi'
            trace.append({'source': bloc.source, 'decision': 'doi', 'motif': entete.doi})
            i += 1
            continue

        if hm.RE_JOURNAL.match(texte):
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
            # Les infos de la même ligne ne sont rattachées que s'il y a un seul nom : sinon on
            # ne sait pas à qui elles appartiennent.
            if len(entrees) == 1:
                cible_courante = entete.auteurs[-1]
                ambigu_courant = False
                # L'e-mail de cette ligne a déjà servi de signal dans _tenter_noms(). Seul un
                # e-mail lu plus tard (branche _est_ligne_auteur()) fait rejuger l'ordre.
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
            # Ordre certain : la virgule le donne. Pas de passage par mn, donc rien à rejuger
            # si un e-mail arrive ensuite.
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
            if ambigu_courant or cible_courante is None:
                # Une ligne qu'aucune fiche ne reçoit reste dans le corps : retirée, elle
                # serait perdue. Une institution de trop en tête d'article vaut mieux qu'un
                # paragraphe du texte disparu (par exemple après une byline de quatre noms).
                trace.append({'source': bloc.source, 'decision': 'auteur_info_non_attribuee',
                              'motif': "ligne de la zone auteurs, mais non attribuée : "
                                       "plusieurs noms déclarés ensemble juste avant, ou "
                                       "aucun auteur connu pour la recevoir — conservée "
                                       "telle quelle dans le texte"})
            else:
                indices[i] = 'auteurs'
                email_avant = cible_courante['email']
                _fusionner_info(cible_courante, texte)
                if not email_avant and cible_courante['email']:
                    # E-mail lu sur une ligne suivante : l'ordre est rejugé une fois, ici.
                    _rejuger_apres_email_tardif(cible_courante)
                trace.append({'source': bloc.source, 'decision': 'auteur_info',
                              'motif': 'complément rattaché à %s %s'
                                       % (cible_courante['prenom'], cible_courante['nom'])})
            i += 1
            continue

        # Rien de reconnu : le paragraphe reste, non consommé, et la zone d'en-tête continue.
        # Seul un intertitre connu ou un paragraphe long marque le début du corps.
        trace.append({'source': bloc.source, 'decision': 'non_reconnu',
                      'motif': "paragraphe court, dans la zone d'en-tête, mais aucun motif "
                               "ne le rattache à un rôle connu : conservé tel quel"})
        i += 1

    return entete, indices, trace


# ---------------------------------------------------------------------------------
# Bloc final « Informations sur les autrices et auteurs », lu après extraire_entete() sur
# le document encore complet (mêmes indices que `indices_consommes`). Ce qu'il trouve est
# fusionné dans l'EnTete déjà construite.

def _cle_nom(texte):
    """Normalisation grossière d'un nom pour la fusion ci-dessous : casse et accents retirés,
    espaces multiples réduits — « Isabel Valarino » == « ISABEL   VALARINO »."""
    t = unicodedata.normalize('NFKD', texte or '')
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', t).strip().casefold()


def _ensemble_jetons_nom(auteur):
    """Ensemble des mots pliés du prénom et du nom (voir _cle_nom). Permet d'apparier
    « Guilley Edith » (en tête) et « Edith Guilley » (bloc final) malgré l'ordre."""
    mots = (auteur.get('prenom') or '').split() + (auteur.get('nom') or '').split()
    return frozenset(_cle_nom(m) for m in mots if _cle_nom(m))


# Rang de confiance : plus petit = plus sûr (mn.CONFIANCE va du plus sûr au moins sûr).
_RANG_CONFIANCE = {c: i for i, c in enumerate(mn.CONFIANCE)}


def _fusionner_auteurs(entete, auteurs_nouveaux):
    """Fusionne chaque auteur du bloc final dans `entete.auteurs`.

    1. D'abord par l'e-mail, quand les deux fiches en ont un : même e-mail, même personne,
       quels que soient les noms.
    2. Sinon par l'ensemble des mots du nom (_ensemble_jetons_nom). Si l'ordre diffère, celui
       de la fiche de meilleure confiance (mn.CONFIANCE) l'emporte, et la trace le dit.

    Une fiche appariée voit ses champs vides complétés (un champ rempli est gardé, comme
    dans _fusionner_info) ; sinon une fiche est ajoutée en fin de liste. Rend (n_fusionnes,
    n_ajoutes, notes_ordre), `notes_ordre` étant une phrase par ordre repris du bloc final,
    que l'appelant verse dans la trace."""
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
    """Propagation de l'ordre prénom-nom à tout le document : un article écrit tous ses noms
    dans le même ordre. mn.trancher_groupe() ne propage qu'au sein d'une ligne, et
    _fusionner_auteurs() ne rapproche que les fiches d'une même personne ; cette fonction
    relie la byline et le bloc final. Elle s'appelle après _fusionner_auteurs(), quand
    `entete.auteurs` réunit les deux zones.

    Même règle que mn.trancher_groupe() : les fiches tranchées ('certaine' ou 'probable')
    qui ont un `ordre` votent ; si elles s'accordent, chaque fiche en 'defaut' sans conflit
    prend cet ordre, en 'propagee'. Si elles se contredisent, rien ne change.

    Rend une phrase par fiche retournée, pour la trace."""
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
        # Jetons d'origine reconstitués. mn.repartir() coupe la liste sans la réordonner :
        # recoller prénom et nom dans le sens de `ordre` rend la liste d'origine. Une fiche en
        # 'defaut' a été répartie en ordre direct, la convention.
        if a.get('ordre') == mn.ORDRE_INVERSE:
            jetons = (a.get('nom') or '').split() + (a.get('prenom') or '').split()
        else:
            jetons = (a.get('prenom') or '').split() + (a.get('nom') or '').split()
        if len(jetons) < 2:
            continue          # un seul jeton : aucun ordre à propager
        prenom, nom = mn.repartir(jetons, ordre)
        if (prenom, nom) == (a.get('prenom'), a.get('nom')):
            # L'ordre du document confirme la convention : seule la confiance change.
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


def _analyser_bloc_auteurs(lignes, base_noms=None, noms_biblio=None, noms_attendus=None):
    """`lignes` : [(source, texte), ...], des lignes logiques, éventuellement issues d'un
    même paragraphe coupé sur '\\n' (Word met souvent tout le bloc en un paragraphe à sauts
    de ligne manuels). Rend des dicts auteur (schéma de _nouvel_auteur), dans l'ordre
    d'apparition, avec les mêmes reconnaissances que l'en-tête (_tenter_noms,
    _tenter_nom_virgule_avec_info, _fusionner_info). Un libellé allemand isolé
    (RE_LIBELLE_AUTEUR_FINAL_DE) est ignoré sans interrompre l'attribution.

    `base_noms`, `noms_biblio` : comme pour extraire_entete(). _tenter_noms() reçoit
    `paragraphe=None` : la casse mise en forme est perdue, la casse tapée reste lue. L'ordre
    n'est pas rejugé après un e-mail tardif dans ce bloc.

    `noms_attendus` (voie des tableaux, _tableaux_auteurs) : ensemble de
    _ensemble_jetons_nom(). Une ligne n'ouvre une fiche que si elle nomme l'une de ces
    personnes, sinon c'est une info de la fiche ouverte : « Fachkraft Unterstützte
    Kommunikation » ne devient pas une personne."""
    def _attendu(prenom, nom):
        return (noms_attendus is None
                or _ensemble_jetons_nom({'prenom': prenom, 'nom': nom}) in noms_attendus)

    auteurs = []
    cible_courante = None
    ambigu_courant = False
    for _source, texte in lignes:
        texte = (texte or '').strip()
        if not texte or RE_LIBELLE_AUTEUR_FINAL_DE.match(texte):
            continue
        resultat_noms = _tenter_noms(texte, None, base_noms, noms_biblio)
        if resultat_noms and not any(_attendu(a['prenom'], a['nom']) for a in resultat_noms[0]):
            resultat_noms = None
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
        if resultat_virgule and not _attendu(resultat_virgule[0], resultat_virgule[1]):
            resultat_virgule = None
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
        # Sinon la ligne n'est pas attribuable et reste sans suite.
    return auteurs


# Forme d'une entrée bibliographique (son intitulé relève de pronto_modele.titre_est_biblio),
# seconde garde du repli : une année entre parenthèses (« Walton, E. (2025). »), ou précédée
# d'une virgule et suivie d'un point (« UNESCO, 2017. », « …, Martins, J.L., 2007. »), avec
# au plus une lettre APA (« 2020a. »).
#
# Une année seule ne suffit pas : une ligne d'info d'autrice peut dire « depuis 2018 ». La
# ponctuation qui encadre l'année est celle d'une référence, pas d'une phrase. DOI et URL ne
# sont pas pris en compte : aucun cas rencontré ne l'a demandé.
RE_ANNEE_REFERENCE_BIBLIO = re.compile(r'\((?:19|20)\d{2}[a-z]?\)|,\s*(?:19|20)\d{2}[a-z]?\.')


def _ressemble_reference_biblio_pour_repli(texte):
    """Vrai si `texte` a la forme d'une référence (voir RE_ANNEE_REFERENCE_BIBLIO). Pendant
    le repli, elle marque la fin du bloc d'auteurs : l'appelant s'arrête (`break`) au lieu
    de la sauter."""
    return bool(RE_ANNEE_REFERENCE_BIBLIO.search(texte))


def _est_cle_de_figure(paragraphe):
    """Vrai pour une clé de figure ou de tableau (« Légende : … », « Copyright : © … »,
    « Source : … », reconnue comme à l'import par pronto_modele.identifier_cle) ou un
    paragraphe au style « SZH Cle Abb/Tab ». Ce n'est pas une info d'autrice, même avec un
    nom (« Copyright : © Jeanne Test »)."""
    if (pronto_modele.normaliser_nom_style(paragraphe.style)
            == pronto_modele.NOM_STYLE_CLE_BLOC):
        return True
    texte = paragraphe.texte().strip()
    if ':' not in texte:
        return False
    resultat = pronto_modele.identifier_cle(texte.partition(':')[0].strip(),
                                            pronto_modele.CANON_FIGURE)
    return resultat is not None and resultat[0] != '__ambigu__'


def _lignes_du_tableau(tableau):
    """Les lignes logiques d'un tableau, cellule par cellule dans l'ordre de lecture, chaque
    paragraphe coupé sur '\\n', tableaux imbriqués compris. Une image ne donne aucune ligne."""
    lignes = []
    for rangee in tableau.rangees:
        for cellule in rangee:
            for sous in cellule.blocs:
                if isinstance(sous, mm.Tableau):
                    lignes.extend(_lignes_du_tableau(sous))
                elif isinstance(sous, mm.Paragraphe):
                    for ligne in sous.texte().split('\n'):
                        if ligne.strip():
                            lignes.append(ligne.strip())
    return lignes


# Au-delà, un tableau n'est plus une fiche d'autrices : c'est un tableau de données.
MAX_LIGNES_TABLEAU_AUTEURS = 30


def _tableaux_auteurs(document, entete, indices_entete, base_noms=None, noms_biblio=None):
    """Fiche d'autrice posée dans un tableau (photo dans une cellule, nom, fonctions,
    institution et e-mail dans l'autre), pas forcément en fin de document. Les deux autres
    voies s'arrêtent à tout tableau.

    Un tableau n'est retenu que s'il nomme une personne déjà reconnue dans la byline (même
    e-mail, ou mêmes mots du nom) et porte au moins un e-mail, un ORCID ou une institution.
    Sans byline, rien n'est retenu : un tableau de données qui cite un nom (« Tabelle 1:
    Müller, 2020 ») doit rester. Ses lignes doivent aussi être courtes
    (SEUIL_LIGNE_AUTEUR_FINAL) et peu nombreuses (MAX_LIGNES_TABLEAU_AUTEURS).

    Rend (indices, auteurs, trace) ; le tableau retenu est consommé en entier (photo
    comprise), les fiches sont fusionnées par l'appelant."""
    if not entete.auteurs:
        return {}, [], []
    cles_tete = {_ensemble_jetons_nom(a) for a in entete.auteurs}
    emails_tete = {(a.get('email') or '').strip().lower() for a in entete.auteurs} - {''}
    fin_entete = max(indices_entete) if indices_entete else -1
    indices, auteurs, trace = {}, [], []
    for i, bloc in enumerate(document.blocs):
        if i <= fin_entete or not isinstance(bloc, mm.Tableau):
            continue
        lignes = _lignes_du_tableau(bloc)
        if (not lignes or len(lignes) > MAX_LIGNES_TABLEAU_AUTEURS
                or any(len(l) >= SEUIL_LIGNE_AUTEUR_FINAL for l in lignes)):
            continue
        if not any(hm.RE_EMAIL.search(l) or hm.RE_ORCID.search(l) or RE_INSTITUTION.search(l)
                   for l in lignes):
            continue
        trouves = _analyser_bloc_auteurs([(bloc.source, l) for l in lignes],
                                         base_noms, noms_biblio, noms_attendus=cles_tete)
        ancre = any(_ensemble_jetons_nom(a) in cles_tete
                    or (a.get('email') or '').strip().lower() in emails_tete
                    for a in trouves)
        if not ancre:
            continue
        indices[i] = 'auteurs'
        auteurs.extend(trouves)
        trace.append({'source': bloc.source, 'decision': 'bloc_auteurs_final_tableau',
                      'motif': "tableau reconnu comme fiche d'autrices/auteurs (%s) : nom "
                               "déjà présent dans la byline, %d ligne(s)"
                               % (', '.join(' '.join(x for x in (a['prenom'], a['nom']) if x)
                                            for a in trouves), len(lignes))})
    return indices, auteurs, trace


def extraire_bloc_auteurs_final(document, entete, langue, indices_entete=None,
                                 base_noms=None, noms_biblio=None):
    """Réunit les trois voies. Les fiches en tableau (_tableaux_auteurs) sont fusionnées
    d'abord, pour que la propagation d'ordre des voies en paragraphes
    (_bloc_auteurs_final_paragraphes) voie le document entier. Même retour que
    _bloc_auteurs_final_paragraphes() ; « bloc_auteurs_final_absent » n'est pas tracé quand
    un tableau a été retenu."""
    indices_tab, auteurs_tab, trace_tab = _tableaux_auteurs(
        document, entete, indices_entete or {}, base_noms, noms_biblio)
    if auteurs_tab:
        n_fusionnes, n_ajoutes, notes_ordre = _fusionner_auteurs(entete, auteurs_tab)
        trace_tab[-1]['motif'] += ' — %d fiche(s) fusionnée(s), %d ajoutée(s)' % (
            n_fusionnes, n_ajoutes)
        trace_tab += [{'portee': 'document', 'source': None,
                       'decision': 'ordre_repris_bloc_final', 'motif': note}
                      for note in notes_ordre]
    exclus = dict(indices_entete or {})
    exclus.update(indices_tab)
    indices, trace = _bloc_auteurs_final_paragraphes(
        document, entete, langue, exclus, base_noms, noms_biblio)
    if indices_tab:
        trace = [t for t in trace if t.get('decision') != 'bloc_auteurs_final_absent']
    indices = dict(indices)
    indices.update(indices_tab)
    return indices, trace_tab + trace


def _bloc_auteurs_final_paragraphes(document, entete, langue, indices_entete=None,
                                    base_noms=None, noms_biblio=None):
    """Rend (indices_consommes, trace), comme extraire_entete() : l'appelant retire ces
    indices de `document.blocs`. Appelée après extraire_entete(), sur le document complet,
    donc avec les mêmes indices.

    `base_noms`, `noms_biblio` : transmis tels quels à _analyser_bloc_auteurs().

    `indices_entete` : indices déjà consommés par l'en-tête, jamais revisités. Sinon, dans
    un document court à lignes brèves, le repli remonterait jusqu'à l'en-tête et y
    rattacherait une ligne (l'intertitre qui le ferme, par exemple) à un auteur.

    Deux voies, dans cet ordre :
    1. un intertitre connu (RE_INTERTITRE_AUTEURS_FINAL, le dernier du document) : le bloc va
       de lui à la fin du document ou au premier tableau ;
    2. sinon, le plus long groupe de paragraphes courts (moins de SEUIL_LIGNE_AUTEUR_FINAL
       signes) en fin de document. La remontée s'arrête sur un intitulé de bibliographie ou
       sur une référence (_ressemble_reference_biblio_pour_repli), même courte. Le groupe
       n'est consommé que s'il porte au moins un nom plausible."""
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
    arret_sur_contenu = False
    while i >= 0:
        if i in indices_entete:
            break
        bloc = blocs[i]
        if isinstance(bloc, mm.Tableau):
            arret_sur_contenu = True
            break
        # Dans un manuscrit court sans bibliographie, tous les paragraphes peuvent être
        # courts : sans ces arrêts, la remontée avalerait le corps entier, images comprises.
        # Trois arrêts, qui ne sont jamais des infos d'autrice : un intertitre déclaré, un
        # paragraphe qui porte une image, une clé de figure ou de tableau.
        if (bloc.niveau_declare or bloc.niveau_retenu
                or any(f.image is not None for f in bloc.fragments)
                or _est_cle_de_figure(bloc)):
            arret_sur_contenu = True
            break
        texte = bloc.texte().strip()
        if texte:
            if pronto_modele.titre_est_biblio(texte, lexique_biblio, tolerer_complement=True):
                arret_sur_contenu = True
                break
            if _ressemble_reference_biblio_pour_repli(texte):
                arret_sur_contenu = True
                break
            if len(texte) >= SEUIL_LIGNE_AUTEUR_FINAL:
                arret_sur_contenu = True
                break
        indices_candidats.append(i)
        i -= 1
    indices_candidats.reverse()
    # Un groupe qui remonte jusqu'à l'en-tête sans qu'aucun contenu l'arrête est le corps
    # lui-même, pas un bloc final : un bloc d'auteurs suit toujours un article. Rien n'est
    # retiré.
    if indices_candidats and not arret_sur_contenu:
        trace = [{'portee': 'document', 'source': None,
                  'decision': 'bloc_auteurs_final_refuse',
                  'motif': "les %d paragraphe(s) courts de fin de document remontent jusqu'à "
                           "l'en-tête sans aucun contenu devant eux : c'est le corps de "
                           "l'article, pas un bloc d'autrices et auteurs — rien n'est retiré"
                           % len(indices_candidats)}]
        trace += [{'portee': 'document', 'source': None, 'decision': 'ordre_propage_document',
                   'motif': note} for note in _propager_ordre_document(entete)]
        return {}, trace

    lignes = []
    for idx in indices_candidats:
        texte = blocs[idx].texte().strip()
        if texte:
            for ligne in texte.split('\n'):
                lignes.append((blocs[idx].source, ligne))
    auteurs = _analyser_bloc_auteurs(lignes, base_noms, noms_biblio)
    if not auteurs:
        # Pas de bloc final, mais la propagation sert encore : chaque ligne de la byline a été
        # jugée à part, et une byline peut tenir sur deux lignes.
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
# JSON : le Document passe par document_depuis_json et document_vers_json de
# manuscrit_modele.py ; EnTete a sa propre conversion.

def entete_vers_json(entete):
    return {'titre': entete.titre, 'sous_titre': entete.sous_titre,
            'auteurs': [dict(a) for a in entete.auteurs], 'resume': entete.resume,
            'langue_resume': entete.langue_resume,
            'resumes_autres': dict(entete.resumes_autres),
            'mots_cles': list(entete.mots_cles), 'doi': entete.doi,
            'ligne_revue': entete.ligne_revue, 'langue_produit': entete.langue_produit}


# ---------------------------------------------------------------------------------
# Mode diagnostic, comme manuscrit_modele.py : {"langue": "fr"|"de", "document": {...}} sur
# stdin (Document JSON décrit en tête de manuscrit_modele.py), une ligne JSON sur stdout.
# `document` en sortie est l'état après retrait des indices consommés, comme la CLI
# l'utilise : un test y vérifie que l'en-tête a quitté le corps.

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
