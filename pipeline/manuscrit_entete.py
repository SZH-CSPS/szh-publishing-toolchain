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
# scinder_titre(), CONNECTEURS, nom_plausible(), decouper_prenom_nom(), RE_EMAIL, RE_ORCID.
# C'est le parser de l'import Word déjà en service (et son harnais,
# test/js/auteurs-corpus.test.js) : rien de tout cela n'est recopié — seulement importé et
# recombiné pour lire des PARAGRAPHES LIBRES plutôt que des cellules d'un tableau déjà
# rempli (docx-meta.py ne lit que le tableau des auteurs du gabarit ; ici le manuscrit n'a
# encore AUCUNE structure de gabarit).
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

# Seuil du repli SANS intertitre (§ ci-dessous) : les 117 références réelles de lot-A
# (manuscrit_biblio.py, même corpus) font toutes plus de 120 signes ; une ligne de fonction,
# d'adresse ou d'e-mail du bloc auteurs en fait 15 à 50. Un intitulé court non reconnu comme
# marqueur (« Bibliographie », « Références ») reste exclu par ailleurs (lire_titres_bib()).
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


CHAMPS_AUTEUR_ENTETE = ('prenom', 'nom', 'fonction', 'institution', 'email', 'orcid',
                         'texte_source')


def _nouvel_auteur(prenom, nom, texte_source):
    return {'prenom': prenom, 'nom': nom, 'fonction': '', 'institution': '',
            'email': '', 'orcid': '', 'texte_source': texte_source}


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
    """Découpe comme docx-meta.auteurs_depuis_byline(), mais dit si CHAQUE segment ressemble
    à un nom — condition pour traiter la ligne comme une INTRODUCTION de nom(s), jamais comme
    une ligne d'info. None si un seul segment échoue (byline.auteurs_depuis_byline(), lui, a
    un repli qui accepte tout — inutilisable ici pour distinguer les deux cas)."""
    segments = []
    for part in dm.CONNECTEURS.split(texte):
        part = (part or '').strip().strip(',;').replace('†', '').strip()
        if part:
            segments.append(part)
    if not segments or not all(dm.nom_plausible(s) for s in segments):
        return None
    return segments


def _tenter_noms(texte):
    segments = _segments_plausibles(texte)
    if segments is None:
        return None
    return [dict(zip(('prenom', 'nom'), dm.decouper_prenom_nom(s))) for s in segments]


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


def extraire_entete(document, langue):
    """(EnTete, indices_consommes, trace).

    `langue` : 'fr'|'de', la langue du PRODUIT déjà tranchée par la CLI (§8 du contrat) —
    jamais `document.langue`. Sert à décider si un marqueur de résumé alimente le résumé
    PRINCIPAL ou `resumes_autres` (un « Abstract » anglais sous un article français, par
    exemple), et à remplir `EnTete.langue_produit`.

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

        noms = _tenter_noms(texte)
        if noms:
            for a in noms:
                entete.auteurs.append(_nouvel_auteur(a['prenom'], a['nom'], texte))
            cible_courante = entete.auteurs[-1] if len(noms) == 1 else None
            ambigu_courant = len(noms) > 1
            indices[i] = 'auteurs'
            trace.append({'source': bloc.source, 'decision': 'auteur',
                          'motif': '%d nom(s) reconnu(s) sur cette ligne' % len(noms)})
            i += 1
            continue

        resultat_virgule = _tenter_nom_virgule_avec_info(texte)
        if resultat_virgule:
            prenom, nom, segments_info = resultat_virgule
            auteur = _nouvel_auteur(prenom, nom, texte)
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
                _fusionner_info(cible_courante, texte)
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


def _fusionner_auteurs(entete, auteurs_nouveaux):
    """Fusionne chaque auteur du bloc final dans `entete.auteurs` : MÊME NOM (prénom+nom,
    comparaison insensible à la casse et aux accents) -> complète les champs VIDES de la
    fiche déjà ouverte par la tête du manuscrit (jamais un champ déjà rempli écrasé, même
    règle que _fusionner_info ci-dessus) ; nom absent ou inconnu -> nouvelle fiche, ajoutée à
    la fin, jamais une fiche dupliquée pour la même personne. Rend (n_fusionnes, n_ajoutes)."""
    n_fusionnes = n_ajoutes = 0
    for nouveau in auteurs_nouveaux:
        cle_nouveau = (_cle_nom(nouveau['prenom']), _cle_nom(nouveau['nom']))
        cible = None
        if cle_nouveau != ('', ''):
            for a in entete.auteurs:
                if (_cle_nom(a['prenom']), _cle_nom(a['nom'])) == cle_nouveau:
                    cible = a
                    break
        if cible is not None:
            for champ in ('fonction', 'institution', 'email', 'orcid'):
                if not cible[champ] and nouveau[champ]:
                    cible[champ] = nouveau[champ]
            n_fusionnes += 1
        else:
            entete.auteurs.append(nouveau)
            n_ajoutes += 1
    return n_fusionnes, n_ajoutes


def _analyser_bloc_auteurs(lignes):
    """`lignes` : [(source, texte), ...] — une ligne LOGIQUE, éventuellement une parmi
    plusieurs issues d'un même paragraphe scindé sur '\\n' (Word pose souvent tout le bloc
    « informations sur les autrices » en UN SEUL paragraphe, séparé par des sauts de ligne
    manuels, §4 du contrat : Fragment '\\n' pour w:br). Rend une liste de dicts auteur (même
    schéma que _nouvel_auteur), dans l'ordre de première apparition — réutilise EXACTEMENT
    les mêmes reconnaissances que la zone d'en-tête (_tenter_noms / _tenter_nom_virgule_avec_
    info / _fusionner_info) : un nom, un « Nom, Prénom », une ligne d'info rattachée au
    dernier auteur ouvert. Un libellé allemand isolé (RE_LIBELLE_AUTEUR_FINAL_DE) n'est ni un
    nom ni une info : ignoré, sans rompre l'attribution en cours."""
    auteurs = []
    cible_courante = None
    ambigu_courant = False
    for _source, texte in lignes:
        texte = (texte or '').strip()
        if not texte or RE_LIBELLE_AUTEUR_FINAL_DE.match(texte):
            continue
        noms = _tenter_noms(texte)
        if noms:
            for a in noms:
                auteurs.append(_nouvel_auteur(a['prenom'], a['nom'], texte))
            cible_courante = auteurs[-1] if len(noms) == 1 else None
            ambigu_courant = len(noms) > 1
            continue
        resultat_virgule = _tenter_nom_virgule_avec_info(texte)
        if resultat_virgule:
            prenom, nom, segments_info = resultat_virgule
            auteur = _nouvel_auteur(prenom, nom, texte)
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


def extraire_bloc_auteurs_final(document, entete, langue, indices_entete=None):
    """(indices_consommes, trace) — même convention que extraire_entete() : l'appelant retire
    ces indices de `document.blocs`. Appelée APRÈS extraire_entete(), sur le document encore
    COMPLET (les indices sont donc dans le même espace que ceux d'extraire_entete()).

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
       reconnu (jamais avalé) — consommé SEULEMENT s'il porte au moins un nom plausible
       (sinon rien, §1 du contrat : « en cas de doute, rien, et on le dit »)."""
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
        auteurs = _analyser_bloc_auteurs(lignes)
        n_fusionnes, n_ajoutes = _fusionner_auteurs(entete, auteurs)
        trace = [{'source': blocs[indice_marqueur].source,
                  'decision': 'bloc_auteurs_final_marqueur',
                  'motif': "intertitre « %s » reconnu : %d fiche(s) fusionnée(s), %d "
                           "ajoutée(s)" % (blocs[indice_marqueur].texte().strip(),
                                           n_fusionnes, n_ajoutes)}]
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
    auteurs = _analyser_bloc_auteurs(lignes)
    if not auteurs:
        return {}, [{'portee': 'document', 'source': None,
                     'decision': 'bloc_auteurs_final_absent',
                     'motif': "aucun bloc d'informations sur les autrices et auteurs reconnu "
                              "en fin de document"}]
    n_fusionnes, n_ajoutes = _fusionner_auteurs(entete, auteurs)
    trace = [{'source': blocs[indices_candidats[0]].source,
              'decision': 'bloc_auteurs_final_heuristique',
              'motif': "%d paragraphe(s) court(s) en fin de document reconnus comme "
                       "informations d'autrices/auteurs (aucun intertitre) : %d fiche(s) "
                       "fusionnée(s), %d ajoutée(s)"
                       % (len(indices_candidats), n_fusionnes, n_ajoutes)}]
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
