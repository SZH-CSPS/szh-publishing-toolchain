#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Vérification de la bibliographie APA 7 : croisement citations-références, DOI, mise en
# forme. Voir docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
# Le module ne connaît ni Word ni OpenDocument. Il reçoit du texte déjà extrait (paragraphes
# {'texte', 'source'}, comme le Contexte de manuscrit_regles.py) et rend des alertes au format
# du nettoyeur : rule, severity, action, para, span, found, suggested, message.
#
# Le réseau est facultatif et limité à Crossref ; seules des métadonnées de référence y
# partent (auteur, année, titre, DOI), jamais le texte de l'article. `_requete()` est le seul
# point d'accès au réseau, et les tests le remplacent. Le délai court (4 s par défaut) évite
# qu'un Crossref lent bloque le nettoyage.
#
# Fonctions reprises de pronto_modele (normaliser, aplatir, lire_titres_bib,
# titre_est_biblio) et de heritage_meta.py (nettoyer_doi, RE_DOI, langue_du_doi,
# decouper_prenom_nom, nom_plausible). Bibliothèque standard seule.

import difflib
import json
import os
import re
import sys
import urllib.error
import urllib.parse

_ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _ICI)
import pronto_modele
import szh_commun


import heritage_meta as hm

# ---------------------------------------------------------------------------------
# Contact du User-Agent Crossref, que leur documentation demande identifiable : l'adresse
# publique de la rédaction.
CONTACT_DEPOT = 'redaction@csps.ch'
USER_AGENT = 'SZH-Publishing-manuscrit-biblio/1.0 (mailto:%s)' % CONTACT_DEPOT

CROSSREF_BASE = 'https://api.crossref.org'
DELAI_RESEAU_DEFAUT = 4

SEUIL_TITRE_VERIFICATION = 0.8   # resoudre_crossref() : le DOI donné pointe-t-il la bonne ref
SEUIL_TITRE_RETROUVE = 0.9       # retrouver_doi() : plus strict, on va PROPOSER un DOI absent


# ---------------------------------------------------------------------------------
# Normalisation de nom pour apparier une citation à une référence. Les particules de tête
# sont retirées, car le corps les omet souvent (« Chambrier, 2020 » pour « de Chambrier,
# A.-F. »). Les suffixes générationnels de fin aussi (« Bullough Jr, R. V. » en
# bibliographie, « Bullough et al. » dans le texte) ; en tête, « Jr » serait un nom.
SUFFIXES_GENERATIONNELS = {'jr', 'sr', 'ii', 'iii', 'iv'}


def _normaliser_nom(nom):
    mots = (nom or '').split()
    while mots and mots[0].strip('.,').lower() in hm.PARTICULES:
        mots.pop(0)
    while mots and mots[-1].strip('.,').lower() in SUFFIXES_GENERATIONNELS:
        mots.pop()
    reste = ' '.join(mots) or (nom or '')
    return pronto_modele.aplatir(reste)


def _cle_tri(nom, langue):
    """Clé de tri alphabétique d'un nom (_normaliser_nom() sert à apparier, pas à trier).
    Les deux consignes s'opposent sur la particule :
      - Revue : la particule compte (« Le Prévost » se classe en L) ;
      - Zeitschrift : la particule est ignorée (« von Arx » se classe en A)."""
    n = nom or ''
    if langue == 'de':
        mots = n.split()
        while mots and mots[0].strip('.,').lower() in hm.PARTICULES:
            mots.pop(0)
        n = ' '.join(mots) or (nom or '')
    return pronto_modele.aplatir(n)


def _ressemble_initiales(segment):
    """« I. », « I.-F. », « AB », « M » : ni un nom (que des majuscules), ni trop long."""
    s = (segment or '').strip()
    if not s or len(s) > 12:
        return False
    coeur = s.replace('.', '').replace('-', '').replace(' ', '').replace('’', '')
    return bool(coeur) and coeur.isalpha() and coeur.isupper()


# ---------------------------------------------------------------------------------
# Langue de la référence citée, distincte de `_langue` (celle du produit). Elle décide de
# l'espace avant le « : » d'un titre et du marqueur d'éditeur (« (Ed.) », « (Eds.) »,
# « (Hrsg.) »). `_langue` décide de ce qui suit le style de l'article citant (espacement
# volume/numéro, « pp. » ou « S. »). Détection par mots-outils : anglais, puis allemand,
# sinon la langue du document.
_MOTS_OUTILS_ANGLAIS = ('the', 'of', 'and', 'for', 'in')
_MOTS_OUTILS_ALLEMAND = ('der', 'die', 'das', 'und', 'für')
RE_MOTS_OUTILS_ANGLAIS = re.compile(
    r'\b(?:' + '|'.join(_MOTS_OUTILS_ANGLAIS) + r')\b', re.IGNORECASE)
RE_MOTS_OUTILS_ALLEMAND = re.compile(
    r'\b(?:' + '|'.join(_MOTS_OUTILS_ALLEMAND) + r')\b', re.IGNORECASE)


def _detecter_langue_reference(titre, conteneur, langue_doc):
    zone = (titre or '') + ' ' + (conteneur or '')
    if RE_MOTS_OUTILS_ANGLAIS.search(zone):
        return 'en'
    if RE_MOTS_OUTILS_ALLEMAND.search(zone):
        return 'de'
    return langue_doc or 'fr'


# Séparateur « : » dans un titre cité : espace insécable devant en français, pas d'espace en
# allemand ni en anglais. Le filtre typographique ne connaît que fr et de, et poserait à tort
# une insécable dans un titre anglais d'une bibliographie française. La casse qui suit n'est
# pas touchée.
_RE_SEPARATEUR_TITRE = re.compile(r'[   ]*:[   ]*')


def _composer_separateur_titre(titre, langue_ref):
    if not titre or ':' not in titre:
        return titre
    avant = ' ' if langue_ref == 'fr' else ''
    return _RE_SEPARATEUR_TITRE.sub(avant + ': ', titre)


# ---------------------------------------------------------------------------------
# Garde-fou : une forme mise en forme qui a perdu un nom propre, une année, un nombre ou un
# mot du titre de l'original n'est pas proposée comme révision, quelle que soit la cause de
# la perte.
RE_JETON_SIGNIFICATIF = re.compile(r"[\wÀ-ÿ]+")

# Mots que la mise en forme remplace exprès, et dont l'absence n'est pas une perte : « Dans »
# devient « In », et les marqueurs d'éditeur changent de forme (« (Ed.) », « (Eds.) »,
# « (Hrsg.) », « (dir.) »).
_JETONS_STRUCTURELS_IGNORES = {'dans', 'in', 'ed', 'eds', 'hrsg', 'dir'}


def _jetons_significatifs(texte):
    """Les mots à majuscule initiale et les nombres (années, volume, pages, DOI), sans
    initiale isolée ni mot de _JETONS_STRUCTURELS_IGNORES. Liste sans doublon, dans l'ordre
    d'apparition, pour que le jeton signalé ne dépende pas de PYTHONHASHSEED."""
    jetons = {}
    for t in RE_JETON_SIGNIFICATIF.findall(texte or ''):
        if len(t) < 2:
            continue
        if t[:1].isupper() or t.isdigit():
            aplati = pronto_modele.aplatir(t)
            if aplati in _JETONS_STRUCTURELS_IGNORES:
                continue
            jetons[aplati] = None
    return list(jetons)


def _jeton_manquant(original, rendu):
    """Le premier jeton significatif de `original` absent de `rendu` (comparaison aplatie —
    accents et casse ignorés), ou None si tous y sont."""
    rendu_aplati = pronto_modele.aplatir(rendu or '')
    for jeton in _jetons_significatifs(original):
        if jeton and jeton not in rendu_aplati:
            return jeton
    return None


def _texte_suggere_sans_italique(suggested):
    """`suggested` sans les astérisques *…*, pour le texte brut du rapport HTML."""
    if not suggested or '*' not in suggested:
        return suggested
    return re.sub(r'\*([^*]+)\*', r'\1', suggested)


# ---------------------------------------------------------------------------------
# 1. analyser_reference() — découpe une entrée APA 7 (fr et de) en champs structurés.

MARQUEUR_EDITEUR_RE = re.compile(
    r'\(\s*(?:[EÉ]d\.?s?\.?|[Ee]ds?\.?|dir\.?|coord\.?|Hrsg\.?|Übers\.?|trad\.?|adapt\.?)\s*\)',
    re.UNICODE)

RE_ANNEE = re.compile(r'\((\d{4})([a-z]?)[^)]*\)')
# « en préparation », « sous presse », « in press » et « im Erscheinen » valent « pas encore
# d'année », une forme prévue par les deux consignes.
RE_SANS_DATE = re.compile(
    r'\((?:s\.?\s?d\.?|n\.?d\.?|o\.?\s?[jJ]\.?|sans\s+date|ohne\s+Jahr|'
    r'en\s+pr[ée]paration|sous\s+presse|in\s+press|im\s+Erscheinen)\)', re.IGNORECASE)

RE_ET_AL_FIN = re.compile(r'\bet\s*al\.?\s*$', re.IGNORECASE)
RE_CONNECTEUR_SANS_VIRGULE = re.compile(r'([A-ZÀ-ÞŒ]\.?)\s+(?:&|et|und)\s+')

# Une URL sans schéma (« www.zeitschriftfürumweltfragen.ch ») en est une aussi ; sinon elle
# finirait dans le titre.
RE_URL = re.compile(r'(?:https?://\S+|\bwww\.[^\s,;]+)')
# Le titre finit sur '.', '?' ou '!' (« Quelle inclusion ? Revue X, 12(3), 45-67. »). ':'
# ne sert qu'en repli, si les trois autres échouent : un titre à sous-titre porte lui-même
# un ':', et la recherche non gourmande couperait dessus. Le repli couvre une référence sans
# ponctuation entre le titre et la revue (« … adapté : La nouvelle revue, 97(1), 203-221. »).
_SEP_TITRE = r'[.?!]'
_SEP_TITRE_REPLI = r'[.?!:]'
RE_CHAPITRE = re.compile(_SEP_TITRE + r'\s+(?:Dans|In)\s+(.+)$', re.S)
RE_CHAPITRE_REPLI = re.compile(_SEP_TITRE_REPLI + r'\s+(?:Dans|In)\s+(.+)$', re.S)
# Le marqueur de pages peut suivre une mention d'édition dans la même parenthèse
# (« (2e éd., pp. 307-328) ») : « pp. », « p. » ou « S. » n'a pas à ouvrir la parenthèse.
RE_PAGES_PARENTHESE = re.compile(
    r'\((?:[^()]*,\s*)?(?:pp?\.|S\.)\s*([\d–‒\-]+(?:\s*[–‒\-]\s*\d+)?)\s*\)')
PAGES = r'[\d–‒\-]+(?:\s*[–‒\-]\s*\d+)?'


def _regles_article(sep):
    # Les pages peuvent être suivies d'un reste, par exemple un éditeur ajouté à tort
    # (« …, 95, 91-109. Editions Inshea ») ; sans le groupe `extra`, l'article passerait pour
    # un ouvrage.
    avec_vol = re.compile(
        r'^(?P<titre>.+?)' + sep + r'\s+(?P<conteneur>[^,]+?),\s*(?:[Nn]°\s*)?(?P<vol>\d+)\s*'
        r'\((?P<num>[^)]+)\)\s*,\s*'
        r'(?P<pages>' + PAGES + r')\.?\s*(?:(?P<extra>\S.*))?$')
    # Un seul nombre avant les pages : entre parenthèses, « (3) » est un numéro ; nu, c'est en
    # général un volume, qu'on laisse sans parenthèses pour ne pas réécrire une entrée
    # conforme (« Revue X, 22, 64-72 »).
    sans_vol = re.compile(
        r'^(?P<titre>.+?)' + sep + r'\s+(?P<conteneur>[^,]+?),\s*(?:[Nn]°\s*)?(?:'
        r'\((?P<num_paren>\d+[a-zA-Z]?)\)|(?P<num_nu>\d+[a-zA-Z]?)'
        r')\s*,\s*(?P<pages>' + PAGES + r')\.?\s*(?:(?P<extra>\S.*))?$')
    return avec_vol, sans_vol


RE_ARTICLE_AVEC_VOL, RE_ARTICLE_SANS_VOL = _regles_article(_SEP_TITRE)
RE_ARTICLE_AVEC_VOL_REPLI, RE_ARTICLE_SANS_VOL_REPLI = _regles_article(_SEP_TITRE_REPLI)
RE_GENRE_ENTRE_CROCHETS = re.compile(
    r'\[([^\]]*(?:th[eè]se|m[ée]moire|rapport|masterarbeit|dissertation|arbeit|'
    r'habilitation)[^\]]*)\]', re.IGNORECASE)


def _preparer_entete_auteurs(entete_brute):
    """Rend (en-tête d'auteurs préparé, et_al). Un « et al. » final est retiré et signalé.
    Un connecteur (« & », « et », « und ») sans virgule devant (« M. et Rebetez ») en
    reçoit une, pour que le découpage sur la virgule traite tous les cas de la même façon."""
    e = (entete_brute or '').strip()
    et_al = False
    m = RE_ET_AL_FIN.search(e)
    if m:
        et_al = True
        e = e[:m.start()].rstrip(' ,&.')
    e = RE_CONNECTEUR_SANS_VIRGULE.sub(lambda mo: mo.group(1) + ', ', e)
    # Un point final ne se retire que pour un auteur institutionnel à un seul segment
    # (« American Psychological Association. » -> sans le point) : sur plusieurs auteurs, ce
    # point clôt les initiales du dernier (« … & Untel, B. ») et doit rester.
    if ',' not in e:
        e = e.rstrip('.').strip()
    return e, et_al


def _decouper_initiales_et_particule(segment):
    """« A.-F. de », « H. van der » : particule écrite après les initiales (convention APA
    pour « Berg, A. van der »). Rend (initiales, particule), ou (None, None)."""
    mots = segment.split()
    particule = []
    while mots and mots[-1].strip('.,').lower() in hm.PARTICULES:
        # Ponctuation retirée du mot gardé, sinon le point final (« … A.-F. de. ») se
        # retrouverait au milieu du nom reconstruit.
        particule.insert(0, mots.pop().strip('.,'))
    reste = ' '.join(mots)
    if particule and _ressemble_initiales(reste):
        return reste, ' '.join(particule)
    return None, None


def _parser_auteurs(entete_brute):
    """Rend ([{nom, initiales}], et_al) : découpage en paires (Nom, Initiales) sur la virgule.
    Un auteur institutionnel (« OCDE », « Ministère de l'Éducation nationale & DEPP ») ne
    porte pas d'initiales : le segment entier devient son nom."""
    entete, et_al = _preparer_entete_auteurs(entete_brute)
    if not entete:
        return [], et_al
    segments = [s.strip() for s in entete.split(',') if s.strip()]
    auteurs = []
    i = 0
    while i < len(segments):
        seg = segments[i]
        nom = re.sub(r'^(?:&|et|und)\s+', '', seg, flags=re.IGNORECASE).strip()
        suivant = segments[i + 1] if i + 1 < len(segments) else None
        if suivant is not None and _ressemble_initiales(suivant):
            auteurs.append({'nom': nom, 'initiales': suivant.strip()})
            i += 2
            continue
        if suivant is not None:
            initiales_dec, particule_dec = _decouper_initiales_et_particule(suivant)
            if initiales_dec is not None:
                auteurs.append({'nom': (particule_dec + ' ' + nom).strip(),
                                 'initiales': initiales_dec})
                i += 2
                continue
        if nom:
            auteurs.append({'nom': nom, 'initiales': ''})
        i += 1
    return auteurs, et_al


def _trouver_annee(texte):
    """(annee ou None, suffixe, debut, fin) du premier « (AAAA[x]…) », ou à défaut de
    « (s.d.) » ou « (n.d.) ». Même logique que annee_de_reference() de szh-citations.lua."""
    m = RE_ANNEE.search(texte)
    if m:
        return int(m.group(1)), m.group(2) or '', m.start(), m.end()
    m = RE_SANS_DATE.search(texte)
    if m:
        return None, '', m.start(), m.end()
    return None, '', None, None


def _segmenter_hors_parentheses(texte, sep):
    """Découpe `texte` sur `sep` (',' ou '.') suivi d'une espace ou de la fin, hors des
    parenthèses, pour ne pas couper « (p. 396) » ou « (2e éd., pp. 307-328) »."""
    segments = []
    debut = 0
    profondeur = 0
    n = len(texte)
    i = 0
    while i < n:
        c = texte[i]
        if c == '(':
            profondeur += 1
        elif c == ')':
            profondeur = max(0, profondeur - 1)
        elif c == sep and profondeur == 0 and (i + 1 == n or texte[i + 1].isspace()):
            segments.append(texte[debut:i])
            i += 1
            while i < n and texte[i].isspace():
                i += 1
            debut = i
            continue
        i += 1
    segments.append(texte[debut:])
    return segments


# Un éditeur d'ouvrage collectif, dans « In … (Ed.), », s'écrit initiales puis nom, à
# l'inverse de la bibliographie (« In E. E. Editor (Ed.), Titre du livre… »). Un segment peut
# porter deux éditeurs joints sans virgule par « & », « et » ou « und » (« In C. Delorme &
# K. Millon-Fauré (Ed.), … », « E. Guyton et J. Ranier »).
RE_EDITEUR_INITIALES_NOM = re.compile(
    r"^(?:[A-ZÀ-ÞŒ]\.-?){1,3}\s+[A-ZÀ-ÞŒ][\w'’\-]*"
    r"(?:\s*(?:&|et|und)\s*(?:[A-ZÀ-ÞŒ]\.-?){1,3}\s+[A-ZÀ-ÞŒ][\w'’\-]*)?$")

# Nombre d'éditeurs dans `editeurs_ouvrage` : on compte les « Initiales Nom », pas les
# connecteurs, qui sous-estimeraient « A, B, & C ».
RE_UN_EDITEUR = re.compile(r"(?:[A-ZÀ-ÞŒ]\.-?){1,3}\s+[A-ZÀ-ÞŒ][\w'’\-]*")


def _compter_editeurs(texte):
    return len(RE_UN_EDITEUR.findall(texte or ''))


def _consommer_editeurs_de_tete(apres):
    """Rend (segments, n) : les segments de `apres` (découpés sur la virgule, hors
    parenthèses) et le nombre de segments de tête qui listent les éditeurs. Le reste donne le
    titre de l'ouvrage, les pages et l'éditeur commercial. Sans ce retrait, le dernier
    éditeur de « G. Pelgrims, T. Assude, & J.-M. Perez » passerait pour le titre."""
    segments = _segmenter_hors_parentheses(apres, ',')
    i = 0
    while i < len(segments):
        seg = re.sub(r'^(?:&|et|und)\s+', '', segments[i].strip(), flags=re.IGNORECASE)
        if not RE_EDITEUR_INITIALES_NOM.match(seg):
            break
        i += 1
    return segments, i


def _nettoyer_titre(t):
    return pronto_modele.normaliser(t or '').strip(' .').strip()


def _nettoyer_pages(t):
    """Espaces compactés, demi-cadratin conservé : en allemand, une plage de pages le
    demande (« 152–160 »), alors que pronto_modele.normaliser() le changerait en trait
    d'union. Le cadratin et le tiret numérique deviennent des demi-cadratins."""
    t = re.sub(r'[‒—]', '–', t or '').replace('‑', '-')
    return ' '.join(t.replace(' ', ' ').replace(' ', ' ').replace(' ', ' ')
                    .split())


# Un titre, un conteneur ou un éditeur est plausible s'il contient au moins une lettre. Un
# découpage raté peut y mettre une plage de pages : dans « United Nations, 2016. General
# Comment No. 4 (2016), Article 24… », la seconde parenthèse à quatre chiffres donne
# l'« éditeur » `1-24`.
RE_CONTIENT_LETTRE = re.compile(r'[^\W\d_]', re.UNICODE)


def _champ_plausible(valeur):
    return bool(RE_CONTIENT_LETTRE.search(valeur or ''))


def _calculer_confiance(champs, annee, auteurs, entete_brute):
    if annee is None:
        return 'basse'
    if not auteurs and not (entete_brute or '').strip():
        return 'basse'
    t = champs['type']
    titre_ok = _champ_plausible(champs['titre'])
    conteneur_ok = _champ_plausible(champs['conteneur'])
    editeur_ok = _champ_plausible(champs['editeur'])
    if t == 'article' and titre_ok and conteneur_ok:
        return 'haute'
    if t == 'chapitre' and titre_ok and conteneur_ok:
        return 'haute'
    if t == 'ouvrage' and titre_ok and editeur_ok:
        return 'haute'
    if t in ('rapport', 'web') and titre_ok and editeur_ok:
        return 'haute'
    if t in ('rapport', 'web') and titre_ok:
        return 'moyenne'
    if t == 'inconnu':
        return 'basse'
    return 'moyenne' if titre_ok else 'basse'


def analyser_reference(texte, langue_doc='fr'):
    """Découpe une entrée APA 7 (fr ou de) en dict de champs. Ne lève pas : une entrée
    illisible rend la confiance 'basse', pour que le rapport liste toutes les références.

    `langue_doc` : langue du produit, qui ne sert que de repli à la détection de
    `langue_ref` (voir _detecter_langue_reference)."""
    brut = texte or ''
    # Le demi-cadratin échappe à la normalisation (le cadratin et le tiret numérique y sont
    # ramenés) : sinon la mise en forme APA proposerait « 152-160 » ou « titre - suite ».
    texte_n = pronto_modele.normaliser(
        re.sub(r'[‒–—]', '\x00', brut)).replace('\x00', '–')
    champs = {'auteurs': [], 'nb_auteurs': 0, 'annee': None, 'suffixe': '', 'titre': '',
              'conteneur': '', 'volume': '', 'numero': '', 'pages': '', 'editeur': '',
              'genre': '', 'editeurs_ouvrage': '', 'nb_editeurs_ouvrage': 0, 'doi': '',
              'url': '', 'type': 'inconnu', 'confiance': 'basse', 'langue_ref': ''}
    if not texte_n.strip():
        return champs

    try:
        annee, suffixe, deb, fin = _trouver_annee(texte_n)
        champs['annee'] = annee
        champs['suffixe'] = suffixe
        if deb is not None:
            entete_brute = texte_n[:deb]
            reste = texte_n[fin:].strip()
        else:
            # Sans année ni « s.d. » (référence tronquée, acte législatif…), rien ne borne
            # les auteurs : on se limite au premier segment.
            entete_brute = texte_n.split(',', 1)[0]
            reste = ''

        entete_sans_marque = MARQUEUR_EDITEUR_RE.sub('', entete_brute).strip()
        auteurs, _et_al_entete = _parser_auteurs(entete_sans_marque)
        champs['auteurs'] = auteurs
        champs['nb_auteurs'] = len(auteurs)

        # DOI d'abord : sinon ses chiffres se font happer par un motif de pages ou d'année.
        m_doi = hm.RE_DOI.search(reste)
        if m_doi:
            champs['doi'] = 'https://doi.org/' + hm.nettoyer_doi(reste)
            reste = (reste[:m_doi.start()] + reste[m_doi.end():])
            # Retire le préfixe du DOI (« doi: », « DOI : », « dx.doi.org/ »…).
            reste = re.sub(
                r'(?:https?://(?:dx\.)?doi\.org/|doi\s*:?\s*)?\s*$', '', reste,
                flags=re.IGNORECASE).strip()
            reste = re.sub(r'\s*(?:https?://(?:dx\.)?doi\.org/|doi\s*:)\s*$', '', reste,
                            flags=re.IGNORECASE).strip()

        m_url = RE_URL.search(reste)
        if m_url:
            champs['url'] = m_url.group(0).rstrip('.,;)»')
            reste = (reste[:m_url.start()] + reste[m_url.end():]).strip()

        reste = reste.strip().strip('.').strip()

        m_chap = RE_CHAPITRE.search(reste) or RE_CHAPITRE_REPLI.search(reste)
        if m_chap:
            champs['type'] = 'chapitre'
            champs['titre'] = _nettoyer_titre(reste[:m_chap.start() + 1])
            apres = MARQUEUR_EDITEUR_RE.sub('', m_chap.group(1))
            # La liste des éditeurs se retire avant de chercher le titre de l'ouvrage (voir
            # _consommer_editeurs_de_tete()).
            segments_apres, n_editeurs = _consommer_editeurs_de_tete(apres)
            apres_editeurs = ', '.join(segments_apres[n_editeurs:]).strip(' ,')
            if n_editeurs:
                editeurs_bruts = _nettoyer_titre(', '.join(segments_apres[:n_editeurs]))
                # « & » entre deux éditeurs, comme dans les exemples des deux consignes
                # (« T. Meier & H. Schneider (Hrsg.) »), quel que soit le mot tapé.
                champs['editeurs_ouvrage'] = re.sub(r'\s+(?:et|und)\s+', ' & ', editeurs_bruts)
                champs['nb_editeurs_ouvrage'] = _compter_editeurs(champs['editeurs_ouvrage'])
            m_pages = RE_PAGES_PARENTHESE.search(apres_editeurs)
            if m_pages:
                champs['pages'] = _nettoyer_pages(m_pages.group(1))
                avant, apres_pages = apres_editeurs[:m_pages.start()], apres_editeurs[m_pages.end():]
            else:
                # Pages sans « (pp. x-x) » (« …, 151-167. Éditeur. ») : forme non prescrite
                # mais rencontrée. On prend la première virgule suivie d'une plage de pages.
                m_pages_nues = re.search(
                    r',\s*(' + PAGES + r')\s*\.?\s*(.*)$', apres_editeurs, re.S)
                if m_pages_nues:
                    champs['pages'] = _nettoyer_pages(m_pages_nues.group(1))
                    avant = apres_editeurs[:m_pages_nues.start()]
                    apres_pages = m_pages_nues.group(2)
                else:
                    avant, apres_pages = apres_editeurs, ''
            segments_avant = [s.strip() for s in _segmenter_hors_parentheses(avant, ',')
                               if s.strip()]
            champs['conteneur'] = _nettoyer_titre(segments_avant[-1]) if segments_avant else ''
            champs['editeur'] = _nettoyer_titre(apres_pages)
        else:
            m_art = (RE_ARTICLE_AVEC_VOL.match(reste) or RE_ARTICLE_SANS_VOL.match(reste)
                     or RE_ARTICLE_AVEC_VOL_REPLI.match(reste)
                     or RE_ARTICLE_SANS_VOL_REPLI.match(reste))
            if m_art:
                gd = m_art.groupdict()
                champs['type'] = 'article'
                champs['titre'] = _nettoyer_titre(gd['titre'])
                champs['conteneur'] = _nettoyer_titre(gd['conteneur'])
                champs['volume'] = gd.get('vol') or ''
                # « (3) » reste un numéro, un nombre nu un volume (voir _regles_article()).
                if gd.get('num') is not None:
                    champs['numero'] = gd['num']
                elif gd.get('num_paren') is not None:
                    champs['numero'] = gd['num_paren']
                elif gd.get('num_nu') is not None:
                    champs['volume'] = champs['volume'] or gd['num_nu']
                champs['pages'] = _nettoyer_pages(gd['pages'])
                if gd.get('extra'):
                    champs['editeur'] = _nettoyer_titre(gd['extra'])
            else:
                m_genre = RE_GENRE_ENTRE_CROCHETS.search(reste)
                if m_genre:
                    champs['type'] = 'rapport'
                    champs['titre'] = _nettoyer_titre(reste[:m_genre.start()])
                    apres_crochet = _nettoyer_titre(reste[m_genre.end():])
                    if apres_crochet:
                        champs['genre'] = _nettoyer_titre(m_genre.group(1))
                        champs['editeur'] = apres_crochet
                    else:
                        # Rien après le crochet : l'institution est dedans
                        # (« [Thèse de doctorat, Université de Reims] »). Avant la première
                        # virgule, le genre ; après, l'éditeur.
                        morceaux_genre = m_genre.group(1).split(',', 1)
                        champs['genre'] = _nettoyer_titre(morceaux_genre[0])
                        if len(morceaux_genre) == 2:
                            champs['editeur'] = _nettoyer_titre(morceaux_genre[1])
                elif champs['url'] and not champs['doi']:
                    champs['type'] = 'web'
                    morceaux = _segmenter_hors_parentheses(reste, '.')
                    champs['titre'] = _nettoyer_titre(
                        '. '.join(morceaux[:-1]) if len(morceaux) > 1 else morceaux[0])
                    if len(morceaux) > 1:
                        champs['editeur'] = _nettoyer_titre(morceaux[-1])
                elif reste:
                    champs['type'] = 'ouvrage'
                    # Le dernier segment est l'éditeur commercial. Tout ce qui précède forme
                    # le titre, sous-titre compris quand il suit un point
                    # (« Titre. Sous-titre. Éditeur. »).
                    morceaux = _segmenter_hors_parentheses(reste, '.')
                    if len(morceaux) > 1:
                        champs['titre'] = _nettoyer_titre('. '.join(morceaux[:-1]))
                        champs['editeur'] = _nettoyer_titre(morceaux[-1])
                    else:
                        champs['titre'] = _nettoyer_titre(reste)
                else:
                    champs['type'] = 'inconnu'

        # Langue de la référence, puis séparateur « : » du titre selon cette langue.
        champs['langue_ref'] = _detecter_langue_reference(
            champs['titre'], champs['conteneur'], langue_doc)
        champs['titre'] = _composer_separateur_titre(champs['titre'], champs['langue_ref'])

        champs['confiance'] = _calculer_confiance(champs, annee, auteurs, entete_brute)
    except Exception:
        # Une entrée qu'on ne sait pas lire reste visible dans le rapport, en confiance
        # basse, plutôt que de faire tomber toute l'analyse de la bibliographie.
        champs['confiance'] = 'basse'
    return champs


# ---------------------------------------------------------------------------------
# 2. citations_du_corps() — chaque appel de citation dans le texte.
#
# Deux formes : narrative (« Tremblay (2023b) », nom hors de la parenthèse) et
# parenthétique (« (Bacharach et al., 2010) », « (Bullough et al., 2003 ; Wenzlaff, 2002) »).
# La parenthèse d'un appel narratif n'est pas relue comme une citation de plus.

_PARTICULE_ALTERNATIVE = '|'.join(sorted(hm.PARTICULES, key=len, reverse=True))

# Citation narrative.
#  - La parenthèse est capturée en entier, car elle peut porter plusieurs années
#    (« Pelgrims (2001, 2006) ») ; chacune devient une citation (citations_du_corps()).
#  - La particule se compare sans égard à la casse par un (?i:...) local, pour garder la
#    majuscule de « De Chambrier (2020) ».
#  - \b devant la particule empêche de lancer un nom au milieu d'un mot : les particules
#    d'une lettre (« e », « a », « y ») se trouvent à la fin de mots ordinaires (« montre »).
#  - La parenthèse doit commencer par l'année. Sinon « … du MPA (Booms et al., 2023) »
#    ferait de « MPA » le nom cité ; une parenthèse qui commence par un nom relève de la
#    passe parenthétique.
RE_NARRATIF = re.compile(
    r'(\b(?:(?i:' + _PARTICULE_ALTERNATIVE + r')\s+)?'
    r'[A-ZÀ-ÞŒ][\w\'’\-]*(?:\s+et\s*al\.?)?'
    r'(?:\s*(?:&|,|et|und)\s*[A-ZÀ-ÞŒ][\w\'’\-]*)*)'
    r'\s*\(\s*((?:19|20)\d{2}[^()]*)\)')

# Mots qui ouvrent une parenthèse de citation sans en faire partie (« voir », « cf. »,
# « vgl. », « z. B. »…), repris des OUVREURS de szh-citations.lua. Ce sont des fragments de
# regex, car « z. B. », « e. g. » ou « p. ex. » s'écrivent avec ou sans espace. RE_OUVREUR
# les retire tous à la suite (« vgl. z. B. ») ; sinon « (z. B. Kristen, 2005) » ne
# commencerait pas par une majuscule et la citation serait perdue.
_OUVREURS_LOCAUX = ('voir', 'cf', 'vgl', 'siehe', 'selon', 'nach', 'gemäss', 'see',
                    'auch', 'aussi', 'also', 'notamment', 'insbesondere', 'etwa',
                    'beispielsweise', 'bspw', r'z\.\s?B', 'zB', r'zum\s+Beispiel',
                    r'e\.\s?g', r'p\.\s?ex', r'par\s+ex(?:emple)?', r'i\.\s?e', r'u\.\s?a')
RE_OUVREUR = re.compile(r'^\s*(?:(?:' + '|'.join(_OUVREURS_LOCAUX) + r')\.?,?\s+)+',
                        re.IGNORECASE)


def _premier_auteur(zone):
    """Le premier nom d'une zone d'auteurs (« Bullough et al. », « de Chambrier & Nom »),
    particule comprise. Vide si la zone ne commence pas par une majuscule (« voir tableau »,
    « en 2010 »)."""
    z = re.sub(r'\bet\s*al\.?', '', zone or '', flags=re.IGNORECASE).strip(' ,;&')
    if not z:
        return ''
    m = re.match(r'^(\b(?:(?i:' + _PARTICULE_ALTERNATIVE + r')\s+)?[A-ZÀ-ÞŒ][\w\'’\-]*)', z)
    return m.group(1) if m else ''


def _citations_du_fragment(frag, source, decalage_absolu):
    """Une citation parenthétique peut porter plusieurs années pour le même auteur
    (« Pelgrims, 2001, 2006 ») : chaque année devient sa propre citation, même premier
    auteur. Un fragment sans nom reconnaissable (pas de majuscule en tête) est ignoré."""
    out = []
    m_ouv = RE_OUVREUR.match(frag)
    decalage_ouvreur = m_ouv.end() if m_ouv else 0
    travail = frag[decalage_ouvreur:]
    et_al = bool(re.search(r'\bet\s*al\.?', travail, re.IGNORECASE))
    annees = list(re.finditer(r'(?:19|20)\d{2}([a-z]?)', travail))
    if not annees:
        return out
    zone_brute = travail[:annees[0].start()].strip(' ,;')
    premier = _premier_auteur(zone_brute)
    if not premier:
        return out
    # `span` couvre exactement `texte` (frag.strip(), le `found` de l'alerte), pas seulement
    # l'année : sinon manuscrit_annoter._localizar() refuse le span et cherche `found`, ce qui
    # échoue quand la même citation figure deux fois dans le paragraphe.
    texte = frag.strip()
    debut_texte = decalage_absolu + (len(frag) - len(frag.lstrip()))
    span_texte = [debut_texte, debut_texte + len(texte)]
    for am in annees:
        out.append({'nom_premier_auteur': premier, 'annee': int(am.group(0)[:4]),
                     'suffixe': am.group(1) or '', 'para': source, 'span': span_texte,
                     'et_al': et_al, 'texte': texte, 'nom_brut': zone_brute})
    return out


def _noms_a_gauche(avant):
    """Les mots à majuscule juste avant un nom narratif, trois au plus, dans l'ordre du
    texte. RE_NARRATIF ne capture qu'un mot (« Lozano » dans « Sahli Lozano et al.
    (2021) ») ; croiser() s'en sert pour retrouver un nom composé que la bibliographie
    connaît. « Nach Sahli » ne s'apparie à rien, « Sahli Lozano » oui."""
    mots = []
    for mot in reversed(avant.split()):
        if len(mots) == 3 or not re.match(r"^[A-ZÀ-ÞŒ][\w'’\-]*$", mot):
            break
        mots.append(mot)
    return list(reversed(mots))


def citations_du_corps(paragraphes):
    citations = []
    for p in paragraphes or []:
        texte = p.get('texte') or ''
        source = p.get('source')
        occupes = []
        for m in RE_NARRATIF.finditer(texte):
            nom_brut, contenu = m.group(1), m.group(2)
            et_al = bool(re.search(r'\bet\s*al\.?', nom_brut, re.IGNORECASE))
            premier = _premier_auteur(nom_brut)
            if not premier:
                continue
            trouve = False
            # `span` couvre tout le match, comme `texte` (voir _citations_du_fragment()).
            span_texte = [m.start(), m.end()]
            gauche = _noms_a_gauche(texte[:m.start(1)])
            for am in re.finditer(r'(?:19|20)\d{2}([a-z]?)', contenu):
                trouve = True
                citations.append({
                    'nom_premier_auteur': premier, 'annee': int(am.group(0)[:4]),
                    'suffixe': am.group(1) or '', 'para': source,
                    'span': span_texte,
                    'et_al': et_al, 'texte': m.group(0), 'nom_brut': nom_brut,
                    'noms_gauche': gauche})
            if trouve:
                occupes.append((m.start(), m.end()))
        for m in re.finditer(r'\(([^()]*(?:19|20)\d{2}[^()]*)\)', texte):
            if any(a <= m.start() and m.end() <= b for a, b in occupes):
                continue
            contenu_debut = m.start(1)
            for fm in re.finditer(r'[^;]+', m.group(1)):
                citations.extend(
                    _citations_du_fragment(fm.group(0), source, contenu_debut + fm.start()))
    return citations


# ---------------------------------------------------------------------------------
# 3. croiser() — citations vs bibliographie.
#
# `references` : des résultats de analyser_reference() auxquels analyser_bibliographie() a
# ajouté 'para' (le Paragraphe.source de l'entrée).

def _cle(nom, annee):
    return (_normaliser_nom(nom), annee)


RE_ET_AL_MILIEU = re.compile(r'\bet\s*al\.?', re.IGNORECASE)


RE_CONNECTEUR_AUTEURS = re.compile(r'\s*(?:[,;&]|\b(?:et|und|and)\b|\bu\.\s?a\.)\s*', re.IGNORECASE)


def _noms_candidats(c):
    """Les noms de premier auteur à essayer contre la bibliographie, du plus précis au plus
    court. `nom_premier_auteur` n'est qu'un mot, et un nom composé (« Sahli Lozano, C. »)
    ne s'apparierait pas. Dans l'ordre :
      - les mots à majuscule qui précèdent un nom narratif, suivis du premier segment
        (« Sahli » + « Lozano ») ;
      - le premier segment de la zone d'auteurs, jusqu'au premier « , », « & », « et » ou
        « und » (« Sahli Lozano » dans « Sahli Lozano & Crameri ») ;
      - le premier mot ;
      - la zone entière sans « et al. » (auteur institutionnel).
    Seul un nom que la bibliographie connaît s'apparie : un mauvais candidat ne produit
    rien."""
    brut = RE_ET_AL_MILIEU.sub('', c.get('nom_brut') or '').strip(' ,;&')
    premier = c['nom_premier_auteur']
    segment = RE_CONNECTEUR_AUTEURS.split(brut, maxsplit=1)[0].strip() if brut else ''
    candidats = []
    gauche = c.get('noms_gauche') or []
    for k in range(1, len(gauche) + 1):
        candidats.append(' '.join(gauche[-k:] + [segment or premier]))
    for nom in (segment, premier, brut):
        if nom and nom not in candidats:
            candidats.append(nom)
    return candidats


def _trouver_references(c, refs_par_cle):
    """(cle, correspondances) : la première clé (nom, année) candidate que la bibliographie
    porte ; sinon la clé du premier mot, sans correspondance."""
    candidats = _noms_candidats(c)
    for nom in candidats:
        cle = _cle(nom, c['annee'])
        if refs_par_cle.get(cle):
            return cle, refs_par_cle[cle]
    return _cle(c['nom_premier_auteur'], c['annee']), None


def _indexer_sans_annee(references):
    """Les références dont l'année n'a pas été lue (texte juridique, entrée non-APA : « Bundesgesetz
    über … vom 13. Dezember 2002, SR 151.3 ») : (mots normalisés du texte, années écrites)."""
    index = []
    for r in references or []:
        if r.get('annee') is not None or not r.get('texte'):
            continue
        texte = r['texte']
        mots = {_normaliser_nom(m) for m in re.findall(r"[\w'’\-]+", texte)}
        annees = {int(a) for a in re.findall(r'(?<!\d)(?:19|20)\d{2}(?!\d)', texte)}
        index.append((mots, annees))
    return index


def _appariee_sans_annee(c, index):
    """Vrai si une citation sans correspondance se retrouve dans une référence sans année
    lue : son premier mot figure dans le texte de la référence, et son année aussi. Sert aux
    textes juridiques cités par leur sigle (« Behindertengleichstellungsgesetz [BehiG],
    2002 » pour « Bundesgesetz … (Behindertengleichstellungsgesetz, BehiG) vom 13. Dezember
    2002 »). L'appariement n'est pas sûr : il est signalé à part (voir
    signaler_references_non_verifiees())."""
    nom = _normaliser_nom(c['nom_premier_auteur'])
    return any(nom in mots and c['annee'] in annees for mots, annees in index)


# ---------------------------------------------------------------------------------
# Catalogue des messages : identifiant → {'fr': ..., 'de': ...}. Tout message de ce module
# passe par _msg(), dans la langue du produit (pas celle de l'ouvrage cité) ; une langue
# inconnue donne le français. « Regle.Variante » est une variante de message d'une règle.

MESSAGES = {
    'APA.CitationAbsente': {
        'fr': 'Cette citation ne correspond à aucune référence de la '
              'bibliographie\u00a0: «\u00a0%s\u00a0».',
        'de': 'Diese Quellenangabe entspricht keinem Eintrag im Literaturverzeichnis: «%s».',
    },
    'APA.CitationAbsente.AnneeDifferente': {
        'fr': ' La bibliographie porte « %s » avec l\'année %s : vérifier l\'année.',
        'de': ' Das Literaturverzeichnis enthält «%s» mit dem Jahr %s: bitte das Jahr prüfen.',
    },
    'APA.Suffixe.Citation': {
        'fr': 'Le suffixe «\u00a0%s\u00a0» de cette citation ne correspond à aucune '
              'référence du même auteur et de la même année.',
        'de': 'Der Buchstabe «%s» dieser Quellenangabe passt zu keinem Eintrag mit denselben '
              'Autor:innen und demselben Jahr.',
    },
    'APA.EtAl.Manque': {
        'fr': 'Cette référence compte %d auteurs\u00a0: la citation doit porter '
              '«\u00a0et al.\u00a0» («\u00a0%s\u00a0»).',
        'de': 'Dieser Eintrag hat %d Autor:innen: Die Quellenangabe muss «et al.» enthalten («%s»).',
    },
    'APA.EtAl.Trop': {
        'fr': 'Cette référence ne compte que %d auteur(s)\u00a0: «\u00a0et al.\u00a0» est de '
              'trop («\u00a0%s\u00a0»).',
        'de': 'Dieser Eintrag hat nur %d Autor:innen: «et al.» ist hier überflüssig («%s»).',
    },
    'APA.EtAl.Trop.Singulier': {
        'fr': 'Cette référence ne compte que %d auteur(s)\u00a0: «\u00a0et al.\u00a0» est de '
              'trop («\u00a0%s\u00a0»).',
        'de': 'Dieser Eintrag hat nur %d Autor:in: «et al.» ist hier überflüssig («%s»).',
    },
    'APA.ReferenceNonCitee': {
        'fr': 'Cette référence ne semble jamais citée dans le texte.',
        'de': 'Dieser Eintrag scheint im Text nie zitiert zu werden.',
    },
    'APA.ReferenceNonVerifiee': {
        'fr': ('La référence «\u00a0%s\u00a0» n’a pas pu être vérifiée automatiquement\u00a0: son '
               'format n’a pas été reconnu. Contrôlez l’entrée correspondante dans la liste des '
               'références, puis corrigez cet appel si nécessaire.'),
        'de': ('Die Quellenangabe «%s» konnte nicht automatisch überprüft werden: Ihr Format '
               'wurde nicht erkannt. Kontrollieren Sie den entsprechenden Eintrag im '
               'Literaturverzeichnis und korrigieren Sie diese Quellenangabe bei Bedarf.'),
    },
    'APA.OrdreBiblio': {
        'fr': 'Référence mal classée\u00a0: l’ordre alphabétique puis '
              'chronologique n’est pas respecté.',
        'de': 'Eintrag falsch eingeordnet: Die alphabetische, danach chronologische Reihenfolge '
              'ist nicht eingehalten.',
    },
    'APA.Suffixe.Biblio': {
        'fr': 'Plusieurs références du même auteur et de la même année '
              '(%d) ne sont pas distinguées par a/b/c.',
        'de': 'Mehrere Einträge mit denselben Autor:innen im selben Jahr (%d) sind nicht durch '
              'a/b/c unterschieden.',
    },
    'APA.DoiForme': {
        'fr': 'Le DOI n’est pas écrit sous sa forme normalisée «\u00a0%s\u00a0».',
        'de': 'Der DOI ist nicht in der normierten Form geschrieben. Normierte Form: «%s».',
    },
    'APA.DoiDivergent': {
        'fr': 'Le DOI renvoie à une autre publication (%s).',
        'de': 'Der DOI verweist auf eine andere Publikation (%s).',
    },
    'APA.DoiDivergent.SansChamp': {
        'fr': 'Le DOI renvoie à une autre publication.',
        'de': 'Der DOI verweist auf eine andere Publikation.',
    },
    'APA.DoiRetrouve': {
        'fr': 'Un DOI correspondant a été trouvé pour cette référence\u00a0: %s '
              '(à confirmer avant de l’accepter).',
        'de': 'Für diesen Eintrag wurde ein passender DOI gefunden: %s '
              '(vor der Übernahme bitte bestätigen).',
    },
    'APA.MiseEnForme': {
        'fr': 'La mise en forme APA 7 de cette référence diffère de '
              'l’original\u00a0– révision proposée.',
        'de': 'Die APA-7-Formatierung dieses Eintrags weicht vom Original ab – '
              'Änderung vorgeschlagen.',
    },
    'APA.MiseEnForme.DoiAjoute': {
        'fr': ' DOI ajouté : un DOI correspondant a été trouvé (%s), à '
              'confirmer avant d\'accepter cette révision.',
        'de': ' DOI ergänzt: Es wurde ein passender DOI gefunden (%s); bitte vor der Übernahme '
              'dieser Änderung bestätigen.',
    },
}

# Les champs que Crossref contredit, nommés dans APA.DoiDivergent.
CHAMPS_DIVERGENTS = {
    'auteur': {'fr': 'auteur', 'de': 'Autor:innen'},
    'annee': {'fr': 'annee', 'de': 'Jahr'},
    'titre': {'fr': 'titre', 'de': 'Titel'},
}


def _langue_message(langue):
    return 'de' if langue == 'de' else 'fr'


def _msg(identifiant, langue, *args):
    """Le message `identifiant` dans la langue du produit, `args` insérés par %."""
    gabarit = MESSAGES[identifiant][_langue_message(langue)]
    return gabarit % args if args else gabarit


def croiser(citations, references, langue='fr'):
    alertes = []
    refs_par_cle = {}
    for r in references or []:
        if not r.get('auteurs') or r.get('annee') is None:
            continue
        cle = _cle(r['auteurs'][0]['nom'], r['annee'])
        refs_par_cle.setdefault(cle, []).append(r)

    sans_annee = _indexer_sans_annee(references)
    citees = set()
    for c in citations or []:
        cle, correspondances = _trouver_references(c, refs_par_cle)
        if not correspondances and c.get('nom_brut'):
            # Auteur institutionnel de plusieurs mots (« Ministère de l'Éducation nationale &
            # DEPP ») : la référence porte le nom entier. Essayé seulement après la clé courte.
            nom_large = RE_ET_AL_MILIEU.sub('', c['nom_brut']).strip(' ,;&')
            cle_large = _cle(nom_large, c['annee'])
            if cle_large != cle:
                correspondances = refs_par_cle.get(cle_large)
                if correspondances:
                    cle = cle_large
        if not correspondances and _appariee_sans_annee(c, sans_annee):
            c['appariee_sans_annee'] = True
            continue
        if not correspondances:
            message = _msg('APA.CitationAbsente', langue, c.get('texte'))
            # Même nom, autre année : presque toujours une coquille d'année, que le message
            # signale (« Beukelman & Mirenda, 1993 » pour une référence de 2013).
            nom_indice, annees_meme_nom = c['nom_premier_auteur'], []
            for nom in _noms_candidats(c):
                annees_meme_nom = sorted({a for (n, a) in refs_par_cle
                                          if n == _normaliser_nom(nom)})
                if annees_meme_nom:
                    nom_indice = nom
                    break
            if annees_meme_nom:
                message += _msg('APA.CitationAbsente.AnneeDifferente', langue, nom_indice,
                                ', '.join(str(a) for a in annees_meme_nom))
            alertes.append({
                'rule': 'APA.CitationAbsente', 'severity': 'error', 'action': 'comment',
                'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
                'suggested': None,
                'message': message,
            })
            continue
        citees.add(cle)
        # Suffixe incohérent : la citation porte une lettre (2020a) qu'aucune référence de
        # ce nom/cette année ne porte, alors qu'au moins une référence existe.
        suffixes_refs = {r.get('suffixe') or '' for r in correspondances}
        if c.get('suffixe') and c['suffixe'] not in suffixes_refs:
            alertes.append({
                'rule': 'APA.Suffixe', 'severity': 'warning', 'action': 'comment',
                'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
                'suggested': None,
                'message': _msg('APA.Suffixe.Citation', langue, c['suffixe']),
            })
        # « et al. » : manquant dès trois auteurs, posé à tort pour un ou deux.
        ref = correspondances[0]
        nb = ref.get('nb_auteurs') or 0
        # Le nom de la référence (« Sahli Lozano »), pas le premier mot de la citation.
        nom_affiche = ref['auteurs'][0]['nom'] if ref.get('auteurs') else c['nom_premier_auteur']
        if nb >= 3 and not c.get('et_al'):
            suggere = '%s et al. (%d%s)' % (nom_affiche, c['annee'],
                                             c.get('suffixe') or '')
            alertes.append({
                'rule': 'APA.EtAl', 'severity': 'warning', 'action': 'fix',
                'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
                'suggested': suggere,
                'message': _msg('APA.EtAl.Manque', langue, nb, suggere),
            })
        elif 1 <= nb <= 2 and c.get('et_al'):
            if nb == 2 and len(ref.get('auteurs') or []) == 2:
                second = ref['auteurs'][1]['nom']
                suggere = '%s & %s (%d%s)' % (nom_affiche, second, c['annee'],
                                               c.get('suffixe') or '')
            else:
                suggere = '%s (%d%s)' % (nom_affiche, c['annee'],
                                          c.get('suffixe') or '')
            alertes.append({
                'rule': 'APA.EtAl', 'severity': 'warning', 'action': 'fix',
                'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
                'suggested': suggere,
                'message': _msg('APA.EtAl.Trop' if nb > 1 else 'APA.EtAl.Trop.Singulier',
                                langue, nb, suggere),
            })

    for cle, lot in refs_par_cle.items():
        if cle in citees:
            continue
        for r in lot:
            alertes.append({
                'rule': 'APA.ReferenceNonCitee', 'severity': 'warning', 'action': 'comment',
                'para': r.get('para'), 'span': None,
                'found': r.get('texte') or (r['auteurs'][0]['nom'] if r.get('auteurs') else None),
                'suggested': None,
                'message': _msg('APA.ReferenceNonCitee', langue),
            })
    return alertes


# ---------------------------------------------------------------------------------
# 3 bis. signaler_references_non_verifiees() : signale, dans le corps, l'appel d'une
# référence de confiance non haute.
#
# mise_en_forme_apa() ne réécrit pas une telle référence. Mais la relectrice lit le texte,
# pas la liste des références : le signal va donc sur l'appel.
#
# Retrouver l'appel demande peu (un nom et une année), réécrire l'entrée demande l'analyse
# complète que mesure _calculer_confiance(). croiser() ignore les références sans année lue,
# par exemple une année écrite sans parenthèses. _extraire_repli_appariement() est donc un
# second chemin, plus lâche, qui sert seulement à retrouver un appel pour le signaler : il
# ne remplit jamais les champs de analyser_reference() et n'alimente pas
# mise_en_forme_apa().

RE_ANNEE_REPLI = re.compile(r'(?:19|20)\d{2}')


def _extraire_repli_appariement(texte_brut):
    """(nom, annee) lus largement : la première année plausible (quatre chiffres, avec ou
    sans parenthèses, à la différence de _trouver_annee()), et ce qui la précède comme nom du
    premier auteur, sans « et al. » ni connecteur de tête. (None, None) sans année.
    Réservée à l'appariement (voir l'en-tête de section)."""
    t = pronto_modele.normaliser(texte_brut or '')
    m = RE_ANNEE_REPLI.search(t)
    if not m:
        return None, None
    entete = t[:m.start()].strip().strip(',.').strip()
    entete = RE_ET_AL_FIN.sub('', entete).strip().strip(',.').strip()
    premier_segment = entete.split(',')[0].strip()
    nom = re.sub(r'^(?:&|et|und)\s+', '', premier_segment, flags=re.IGNORECASE).strip()
    if not nom:
        return None, None
    return nom, int(m.group(0))


def _cle_appariement_repli(ref):
    """(nom, annee) d'une référence de confiance non haute, pour l'apparier à un appel : la
    clé stricte (`auteurs[0].nom`, `annee`) si analyser_reference() a pu les lire (la
    confiance peut tomber pour d'autres champs), sinon _extraire_repli_appariement().
    (None, None) si rien n'est lu."""
    if ref.get('auteurs') and ref.get('annee') is not None:
        return ref['auteurs'][0]['nom'], ref['annee']
    return _extraire_repli_appariement(ref.get('texte') or '')


def _appels_en_ordre_texte(citations):
    """`citations` dans l'ordre du texte. citations_du_corps() rend, pour chaque paragraphe,
    les narratives puis les parenthétiques : on retrie donc l'intérieur de chaque paragraphe
    sur `span[0]`, sans déplacer les paragraphes. Ainsi « le premier appel » est bien le
    premier du texte."""
    groupes = []
    for c in citations or []:
        if groupes and groupes[-1][0] == c.get('para'):
            groupes[-1][1].append(c)
        else:
            groupes.append((c.get('para'), [c]))
    out = []
    for _para, lot in groupes:
        out.extend(sorted(lot, key=lambda c: c['span'][0] if c.get('span') else 0))
    return out


def signaler_references_non_verifiees(citations, references, langue):
    """Alertes `APA.ReferenceNonVerifiee` : une référence de confiance non haute dont
    l'appel est retrouvé (voir _cle_appariement_repli()) reçoit un commentaire sur cet appel.
      - Citée plusieurs fois : seul le premier appel est commenté, pour qu'une référence ne
        consomme pas à elle seule les 5 commentaires par règle de manuscrit_annoter.py.
      - Jamais citée : rien ici, APA.ReferenceNonCitee (croiser()) le dit déjà."""
    alertes = []
    signales = set()
    premier_appel_par_cle = {}
    for c in _appels_en_ordre_texte(citations):
        cle = _cle(c['nom_premier_auteur'], c['annee'])
        premier_appel_par_cle.setdefault(cle, c)

    for r in references or []:
        if r.get('confiance') == 'haute':
            continue
        nom, annee = _cle_appariement_repli(r)
        if nom is None or annee is None:
            continue
        appel = premier_appel_par_cle.get(_cle(nom, annee))
        if appel is None:
            continue  # jamais citée : APA.ReferenceNonCitee s'en charge
        signales.add(_cle(nom, annee))
        alertes.append({
            'rule': 'APA.ReferenceNonVerifiee', 'severity': 'warning', 'action': 'comment',
            'para': appel.get('para'), 'span': appel.get('span'), 'found': appel.get('texte'),
            'suggested': None,
            'message': _msg('APA.ReferenceNonVerifiee', langue, '%s, %d' % (nom, annee)),
        })

    # Un appel que croiser() n'a retrouvé que dans une référence sans année lue (texte
    # juridique cité par son sigle) : même commentaire, sur le premier appel de chaque clé.
    for c in _appels_en_ordre_texte(citations):
        cle = _cle(c['nom_premier_auteur'], c['annee'])
        if not c.get('appariee_sans_annee') or cle in signales:
            continue
        signales.add(cle)
        alertes.append({
            'rule': 'APA.ReferenceNonVerifiee', 'severity': 'warning', 'action': 'comment',
            'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
            'suggested': None,
            'message': _msg(
                'APA.ReferenceNonVerifiee', langue, '%s, %d' % (c['nom_premier_auteur'], c['annee'])),
        })
    return alertes


# ---------------------------------------------------------------------------------
# 4. verifier_ordre() — alphabétique puis chronologique, suffixes a/b requis.

def verifier_ordre(references, langue='fr'):
    alertes = []
    avec_cle = []
    for r in references or []:
        if not r.get('auteurs'):
            continue
        nom = _cle_tri(r['auteurs'][0]['nom'], langue)
        annee = r.get('annee') if r.get('annee') is not None else 9999
        avec_cle.append((nom, annee, r.get('suffixe') or '', r))

    # Une alerte par entrée à déplacer. Comparer les positions lues aux positions triées
    # ferait signaler toutes les entrées qui suivent une seule entrée mal rangée. On calcule
    # donc la plus longue sous-suite croissante : les entrées qui n'en font pas partie sont
    # celles à déplacer.
    cles = [t[:3] for t in avec_cle]
    n = len(cles)
    longueur = [1] * n
    precedent = [-1] * n
    for i in range(n):
        for j in range(i):
            if cles[j] <= cles[i] and longueur[j] + 1 > longueur[i]:
                longueur[i] = longueur[j] + 1
                precedent[i] = j
    dans_lis = set()
    if n:
        fin = max(range(n), key=lambda i: longueur[i])
        i = fin
        while i != -1:
            dans_lis.add(i)
            i = precedent[i]

    for i in range(n):
        if i not in dans_lis:
            r = avec_cle[i][3]
            alertes.append({
                'rule': 'APA.OrdreBiblio', 'severity': 'warning', 'action': 'report',
                'para': r.get('para'), 'span': None,
                'found': r.get('texte') or r.get('titre'), 'suggested': None,
                'message': _msg('APA.OrdreBiblio', langue),
            })

    # Même auteur, même année, plusieurs entrées : les suffixes a/b/c doivent les distinguer.
    par_auteur_annee = {}
    for nom, annee, suffixe, r in avec_cle:
        par_auteur_annee.setdefault((nom, annee), []).append((suffixe, r))
    for (nom, annee), lot in par_auteur_annee.items():
        if len(lot) < 2 or annee == 9999:
            continue
        suffixes = [s for s, _ in lot]
        attendus = [chr(ord('a') + i) for i in range(len(lot))]
        if sorted(suffixes) != attendus:
            for s, r in lot:
                alertes.append({
                    'rule': 'APA.Suffixe', 'severity': 'warning', 'action': 'fix',
                    'para': r.get('para'), 'span': None,
                    'found': r.get('texte') or r.get('titre'), 'suggested': None,
                    'message': _msg('APA.Suffixe.Biblio', langue, annee),
                })
    return alertes


# ---------------------------------------------------------------------------------
# 5. doi_normaliser() — toute forme de DOI ramenée à https://doi.org/10....

RE_DOI_ECRIT = re.compile(
    r'(?:doi\s*:?\s*|(?:https?:)?//(?:dx\.)?doi\.org/|(?:https?:)?//doi\.org/)?'
    r'(10\.\d{4,9}/[^\s<>"\')\]]+)', re.IGNORECASE)
FORME_CANONIQUE = re.compile(r'^https://doi\.org/10\.\d{4,9}/\S+$')


def doi_normaliser(ref):
    """Alertes 'fix' pour un DOI dont l'écriture n'est pas la forme canonique
    'https://doi.org/10....' — 'doi:', 'DOI :', 'dx.doi.org/', 'http://doi.org/'."""
    alertes = []
    texte = ref.get('texte') or ''
    m = RE_DOI_ECRIT.search(texte)
    if not m:
        return alertes
    trouve = m.group(0).strip().rstrip('.,;)')
    numero = hm.nettoyer_doi(m.group(1))
    canonique = 'https://doi.org/' + numero
    if FORME_CANONIQUE.match(trouve):
        return alertes
    alertes.append({
        'rule': 'APA.DoiForme', 'severity': 'warning', 'action': 'fix',
        'para': ref.get('para'), 'span': None, 'found': trouve, 'suggested': canonique,
        'message': _msg('APA.DoiForme', ref.get('_langue'), canonique),
    })
    return alertes


# ---------------------------------------------------------------------------------
# 6. resoudre_crossref() et retrouver_doi() : accès au réseau. Les tests remplacent
# `_requete`.

# Crossref hors service (pas de connexion, délai dépassé) : plus aucune requête jusqu'à la fin
# de l'analyse. Sans cela, un service muet coûte le délai à chaque référence. Un code HTTP
# (404 d'un DOI inconnu) n'est pas une panne.
_hors_service = False


def _interroger(url, delai):
    global _hors_service
    if _hors_service:
        return None
    try:
        return _requete(url, delai)
    except urllib.error.HTTPError:
        return None
    except Exception:
        _hors_service = True
        return None


def _requete(url, delai):
    return szh_commun.requete_http(url, delai, USER_AGENT)


def _annee_crossref(message):
    for champ in ('published-print', 'published-online', 'issued', 'published'):
        d = message.get(champ)
        if d and d.get('date-parts') and d['date-parts'][0]:
            annee = d['date-parts'][0][0]
            if annee:
                return int(annee)
    return None


def _similarite_titre(a, b):
    na = pronto_modele.aplatir(a or '')
    nb = pronto_modele.aplatir(b or '')
    if not na or not nb:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


def resoudre_crossref(ref, delai=DELAI_RESEAU_DEFAUT):
    """Contrôle de cohérence entre le DOI d'une référence et ses métadonnées Crossref :
    (dict de constat) ou None si le DOI est absent ou la requête a échoué. Ne lève jamais."""
    doi = (ref.get('doi') or '').strip()
    if not doi:
        return None
    numero = re.sub(r'^https?://(?:dx\.)?doi\.org/', '', doi, flags=re.IGNORECASE)
    url = CROSSREF_BASE + '/works/' + urllib.parse.quote(numero, safe='/')
    brut = _interroger(url, delai)
    if brut is None:
        return None
    try:
        message = json.loads(brut)['message']
    except Exception:
        return None

    auteurs_cr = message.get('author') or []
    premier_cr = auteurs_cr[0].get('family', '') if auteurs_cr else \
        (message.get('container-title', [''])[0] if not auteurs_cr else '')
    annee_cr = _annee_crossref(message)
    titre_cr = (message.get('title') or [''])[0]

    auteur_ok = None
    if ref.get('auteurs') and premier_cr:
        auteur_ok = _normaliser_nom(ref['auteurs'][0]['nom']) == _normaliser_nom(premier_cr)
    annee_ok = None
    if ref.get('annee') is not None and annee_cr is not None:
        annee_ok = abs(ref['annee'] - annee_cr) <= 1   # ±1 admis (online-first)
    ratio_titre = _similarite_titre(ref.get('titre'), titre_cr) if titre_cr else 0.0
    titre_ok = ratio_titre >= SEUIL_TITRE_VERIFICATION if titre_cr else None

    confirme = (auteur_ok is not False) and (annee_ok is not False) and (titre_ok is not False)
    return {
        'auteur_ok': auteur_ok, 'annee_ok': annee_ok, 'titre_ok': titre_ok,
        'ratio_titre': ratio_titre, 'crossref_auteur': premier_cr,
        'crossref_annee': annee_cr, 'crossref_titre': titre_cr, 'confirme': confirme,
    }


def retrouver_doi(ref, delai=DELAI_RESEAU_DEFAUT):
    """(doi, score) pour un article ou un chapitre sans DOI, ou None. Retenu seulement si le
    titre est très proche (0,9 au moins) et que l'auteur et l'année concordent : un faux DOI
    est pire qu'aucun. Le DOI trouvé reste à confirmer par la rédaction."""
    if ref.get('doi') or ref.get('type') not in ('article', 'chapitre'):
        return None
    if not ref.get('titre') or not ref.get('auteurs') or ref.get('annee') is None:
        return None
    requete = '%s %s %s' % (ref['titre'], ref['auteurs'][0]['nom'], ref['annee'])
    url = CROSSREF_BASE + '/works?' + urllib.parse.urlencode(
        {'query.bibliographic': requete, 'rows': 3})
    brut = _interroger(url, delai)
    if brut is None:
        return None
    try:
        items = json.loads(brut)['message']['items']
    except Exception:
        return None

    for item in items:
        titre_cr = (item.get('title') or [''])[0]
        ratio = _similarite_titre(ref['titre'], titre_cr)
        if ratio < SEUIL_TITRE_RETROUVE:
            continue
        auteurs_cr = item.get('author') or []
        if not auteurs_cr:
            continue
        if _normaliser_nom(ref['auteurs'][0]['nom']) != _normaliser_nom(auteurs_cr[0].get('family', '')):
            continue
        annee_cr = _annee_crossref(item)
        if annee_cr is None or abs(ref['annee'] - annee_cr) > 1:
            continue
        doi = item.get('DOI')
        if not doi:
            continue
        return 'https://doi.org/' + doi, ratio
    return None


# ---------------------------------------------------------------------------------
# 7. mise_en_forme_apa() — la chaîne APA 7 canonique, fr et de.
#
# Différences entre les consignes de rédaction des deux revues :
#   - volume(numéro) : collé en français « 12(3) », espacé en allemand « 12 (3) » ;
#   - éditeur d'ouvrage collectif : « (Ed.) » ou « (Eds.) » (sans accent, pas « (dir.) »)
#     pour un ouvrage en anglais ou en français, « (Hrsg.) » pour un ouvrage en allemand. La
#     langue de l'ouvrage cité (`langue_ref`) décide, pas celle du produit ;
#   - pages d'un chapitre : « pp. » (Revue) ou « S. » (Zeitschrift), selon la langue du
#     produit. Un article ne préfixe pas ses pages ;
#   - un chapitre s'introduit par « In » dans les deux langues, jamais « Dans ».
# Rendue seulement si la confiance est haute ou si Crossref a confirmé la référence.

# Règle T2 du filtre typographique (szh-typographie.lua) appliquée aux plages de pages :
# trait d'union en français, demi-cadratin en allemand.
def _t2_plage_pages_chapitre(pages, langue):
    if not pages:
        return pages
    if langue == 'de':
        return re.sub(r'(?<=\d)-(?=\d)', '–', pages)
    return pages.replace('–', '-')


def _auteurs_en_chaine(auteurs, langue):
    if not auteurs:
        return ''
    parties = ['%s, %s' % (a['nom'], a['initiales']) if a['initiales'] else a['nom']
               for a in auteurs]
    if len(parties) == 1:
        return parties[0]
    dernier = parties[-1]
    reste = parties[:-1]
    return ', '.join(reste) + ', & ' + dernier


def mise_en_forme_apa(ref, metadonnees_crossref=None):
    confirme_crossref = bool(metadonnees_crossref and metadonnees_crossref.get('confirme'))
    if ref.get('confiance') != 'haute' and not confirme_crossref:
        return None
    langue = ref.get('_langue') or 'fr'
    auteurs = _auteurs_en_chaine(ref.get('auteurs') or [], langue)
    annee_texte = str(ref['annee']) + (ref.get('suffixe') or '') if ref.get('annee') else 's. d.'
    morceaux = [auteurs, '(%s).' % annee_texte if auteurs else '(%s)' % annee_texte]
    titre = ref.get('titre') or ''
    t = ref.get('type')
    if t == 'article':
        volume = ref.get('volume') or ''
        numero_paren = ''
        if ref.get('numero'):
            numero_paren = (' (' if langue == 'de' else '(') + ref['numero'] + ')'
        # APA 7 : seul le volume est en italique, pas le numéro (« *37*(3) »).
        volnum = ('*%s*' % volume if volume else '') + numero_paren
        conteneur = '*%s*' % ref['conteneur'] if ref.get('conteneur') else ''
        # Pages d'un article sans « p. » ni « pp. ». En français, telles que l'entrée les
        # porte (la Revue admet « 1-35 » et « 119–141 ») ; en allemand, demi-cadratin
        # (« 27 (3), 56–78 »).
        pages_article = ref.get('pages') or ''
        if langue == 'de':
            pages_article = _t2_plage_pages_chapitre(pages_article, 'de')
        queue = ', '.join(x for x in (conteneur, volnum, pages_article) if x)
        corps = '%s. %s.' % (titre, queue) if queue else '%s.' % titre
    elif t == 'chapitre':
        # Marqueur d'éditeur selon la langue de l'ouvrage cité (voir l'en-tête de section) :
        # « (Hrsg.) » en allemand ; sinon « (Ed.) » pour un éditeur, « (Eds.) » dès deux
        # (`nb_editeurs_ouvrage`). Les noms et le marqueur ne s'écrivent que si
        # _consommer_editeurs_de_tete() a isolé les éditeurs : « In (Ed.), … » sans nom serait
        # faux.
        sait_editeurs = bool(ref.get('editeurs_ouvrage'))
        if not sait_editeurs:
            marqueur_editeur = ''
        else:
            langue_marqueur = ref.get('langue_ref') or langue
            if langue_marqueur == 'de':
                marqueur_editeur = '(Hrsg.)'
            else:
                marqueur_editeur = ('(Eds.)' if (ref.get('nb_editeurs_ouvrage') or 0) >= 2
                                     else '(Ed.)')
        editeurs_ouvrage = ('%s ' % ref['editeurs_ouvrage']) if sait_editeurs else ''
        intro_editeurs = (editeurs_ouvrage + marqueur_editeur + ', ') if marqueur_editeur else ''
        # « pp. » (Revue) ou « S. » (Zeitschrift) : style de l'article citant, donc langue du
        # produit. Un chapitre anglais cité dans la Zeitschrift prend « S. ».
        etiquette_pages = 'S.' if langue == 'de' else 'pp.'
        pages = (' (%s %s)' % (etiquette_pages, _t2_plage_pages_chapitre(ref['pages'], langue))
                 if ref.get('pages') else '')
        # Pas de point après un « ? » ou un « ! » final (« … ?. In … »).
        fin_titre = titre if titre[-1:] in '?!' else titre + '.'
        corps = '%s In %s*%s*%s. %s.' % (
            fin_titre, intro_editeurs, ref.get('conteneur') or '', pages,
            ref.get('editeur') or '')
    elif t == 'rapport':
        # Le genre entre crochets (« [Thèse de doctorat] », « [Mémoire de Master] ») fait
        # partie de la forme APA prescrite.
        genre = ' [%s]' % ref['genre'] if ref.get('genre') else ''
        corps = ('*%s*%s. %s.' % (titre, genre, ref['editeur']) if ref.get('editeur')
                  else '*%s*%s.' % (titre, genre))
    elif t in ('ouvrage', 'web'):
        corps = '*%s*. %s.' % (titre, ref['editeur']) if ref.get('editeur') else '*%s*.' % titre
    else:
        corps = '%s.' % titre if titre else ''
    # Toute la ponctuation de fin est retirée, pas seulement le point : un éditeur qui finit
    # par ':' (« Vu le … sur : ») donnerait « sur :. https://... ».
    if ref.get('doi'):
        corps = corps.rstrip(' .:,;') + '. ' + ref['doi']
    elif ref.get('url'):
        corps = corps.rstrip(' .:,;') + '. ' + ref['url']
    rendu = ' '.join(x for x in morceaux if x) + ' ' + corps
    return re.sub(r'\s+', ' ', rendu).strip()


# Ancrage de l'insertion d'un DOI retrouvé (action 'track') : une addition en fin de
# référence, après le plus court suffixe de mots entiers qui n'apparaît qu'une fois dans la
# référence. Le point final seul ne convient pas : on ne saurait pas lequel des points viser.
def _segment_fin_reference(ref):
    texte = (ref.get('texte') or '').rstrip()
    mots = texte.split(' ')
    for n in range(1, min(len(mots), 6) + 1):
        segment = ' '.join(mots[-n:])
        if len(segment) >= 4 and texte.count(segment) == 1:
            return segment
    return None


def _message_doi_retrouve(doi, langue):
    return _msg('APA.DoiRetrouve', langue, doi)


def _alerte_insertion_doi(ref, doi):
    """Insertion du DOI après le dernier segment sûr de la référence, sans réécriture. None
    si aucun segment n'est ancrable."""
    segment = _segment_fin_reference(ref)
    if not segment:
        return None
    return {'rule': 'APA.DoiRetrouve', 'severity': 'suggestion', 'action': 'track',
            'para': ref.get('para'), 'span': None, 'found': segment,
            'suggested': segment + (' ' if segment.endswith('.') else '. ') + doi,
            'message': _message_doi_retrouve(doi, ref.get('_langue'))}


# ---------------------------------------------------------------------------------
# 8. analyser_bibliographie() — enchaîne tout.

# Référence coupée sur plusieurs paragraphes (copier-coller d'un PDF : une ligne par
# paragraphe). Lus séparément, les morceaux fausseraient l'analyse et l'ordre alphabétique.
# Un paragraphe prolonge le précédent s'il ne porte pas d'année entre parenthèses au début
# (toute référence APA en a une, même « (s. d.) ») et ne commence pas une entrée : il commence
# par une minuscule ou un chiffre, ou le précédent finit par un tiret, un deux-points, une
# virgule, une esperluette ou un mot en minuscules (« and »).
RE_DEBUT_ANNEE = re.compile(r'\(\s*(?:(?:19|20)\d{2}[a-z]?\b|s\.?\s?d\.?\)|n\.?d\.?\)|o\.?\s?J\.?\)|'
                            r'en\s+pr[ée]paration|sous\s+presse|in\s+press|im\s+Erscheinen)',
                            re.IGNORECASE)
_FRAGMENT_LIAISON = '–—-:,;&'


def _prolonge_la_precedente(texte, precedent):
    t = texte.strip()
    if not t or not precedent or RE_DEBUT_ANNEE.search(t[:250]):
        return False
    if t[0] in '[(':
        return False
    if not t[0].isupper():
        return True
    mots = precedent.split()
    if not mots:
        return False
    return mots[-1][-1] in _FRAGMENT_LIAISON or (mots[-1].isalpha() and mots[-1].islower())


def _fusionner_continuations(paragraphes_biblio):
    """[{'source', 'texte', 'fragments': [paragraphe, ...]}] : les paragraphes de bibliographie,
    réunis quand l'un prolonge l'autre. `source` est celui du premier morceau ; `texte` joint les
    morceaux (sans espace après un trait d'union ou un tiret collé au mot qui précède : « 1189-
    » + « 1204 » -> « 1189-1204 »)."""
    entrees = []
    for p in paragraphes_biblio or []:
        texte = p.get('texte') or ''
        if entrees and _prolonge_la_precedente(texte, entrees[-1]['texte']):
            precedent = entrees[-1]['texte'].rstrip()
            colle = (precedent[-1:] in '-–—' and len(precedent) > 1
                     and not precedent[-2].isspace())
            entrees[-1]['texte'] = precedent + ('' if colle else ' ') + texte.strip()
            entrees[-1]['fragments'].append(p)
        else:
            entrees.append({'source': p.get('source'), 'texte': texte, 'fragments': [p]})
    return entrees


def analyser_bibliographie(paragraphes_corps, paragraphes_biblio, langue, reseau=True):
    alertes = []
    stats = {'references': 0, 'analysees_haute': 0, 'analysees_moyenne': 0,
             'analysees_basse': 0, 'citations': 0, 'citees_absentes': 0, 'non_citees': 0,
             'doi_normalises': 0, 'doi_retrouves': 0, 'non_proposees': [],
             'crossref': {'consultes': 0, 'confirmes': 0, 'divergents': 0, 'indisponible': not reseau}}
    global _hors_service
    _hors_service = False

    # `references` : une entrée par référence (morceaux réunis), pour le croisement, les appels
    # non vérifiés et l'ordre. `par_paragraphe` : une entrée par paragraphe, seule ancre
    # possible d'une révision (DOI, mise en forme).
    references, par_paragraphe = [], []
    morceaux_de = {}
    for e in _fusionner_continuations(paragraphes_biblio):
        r = analyser_reference(e['texte'], langue_doc=langue)
        r['para'] = e['source']
        r['texte'] = e['texte'].strip()
        r['_langue'] = langue
        references.append(r)
        stats['references'] += 1
        stats['analysees_' + r['confiance']] += 1
        if len(e['fragments']) == 1:
            par_paragraphe.append(r)
            continue
        morceaux_de[r['texte']] = (e['fragments'][0].get('texte') or '').strip()
        for p in e['fragments']:
            m = analyser_reference(p.get('texte') or '', langue_doc=langue)
            m['para'] = p.get('source')
            m['texte'] = (p.get('texte') or '').strip()
            m['_langue'] = langue
            par_paragraphe.append(m)

    citations = citations_du_corps(paragraphes_corps or [])
    stats['citations'] = len(citations)

    alertes_croisement = croiser(citations, references, langue)
    alertes.extend(alertes_croisement)
    stats['citees_absentes'] = sum(1 for a in alertes_croisement if a['rule'] == 'APA.CitationAbsente')
    stats['non_citees'] = sum(1 for a in alertes_croisement if a['rule'] == 'APA.ReferenceNonCitee')

    alertes_non_verifiees = signaler_references_non_verifiees(citations, references, langue)
    alertes.extend(alertes_non_verifiees)
    stats['non_verifiees'] = len(alertes_non_verifiees)

    alertes.extend(verifier_ordre(references, langue))

    # Une alerte posée sur une référence réunie porte le texte de son premier morceau :
    # `found` doit se retrouver dans le paragraphe que désigne `para`.
    for a in alertes:
        if a.get('found') in morceaux_de:
            a['found'] = morceaux_de[a['found']]

    for r in par_paragraphe:
        alertes_doi = doi_normaliser(r)
        alertes.extend(alertes_doi)
        stats['doi_normalises'] += len(alertes_doi)

        meta_crossref = None
        if reseau and r.get('doi'):
            stats['crossref']['consultes'] += 1
            meta_crossref = resoudre_crossref(r)
            if meta_crossref is None:
                stats['crossref']['indisponible'] = True
            elif meta_crossref['confirme']:
                stats['crossref']['confirmes'] += 1
            else:
                stats['crossref']['divergents'] += 1
                champs_divergents = [c for c in ('auteur', 'annee', 'titre')
                                      if meta_crossref.get(c + '_ok') is False]
                alertes.append({
                    'rule': 'APA.DoiDivergent', 'severity': 'warning', 'action': 'comment',
                    'para': r.get('para'), 'span': None, 'found': r.get('doi'),
                    'suggested': None,
                    'message': _msg('APA.DoiDivergent', langue, ', '.join(
                        CHAMPS_DIVERGENTS[c][_langue_message(langue)]
                        for c in champs_divergents)) if champs_divergents else
                        _msg('APA.DoiDivergent.SansChamp', langue),
                })
        doi_retrouve = None
        if reseau and not r.get('doi'):
            trouve = retrouver_doi(r)
            if trouve:
                doi_retrouve, score = trouve
                stats['doi_retrouves'] += 1
                # Posé avant mise_en_forme_apa(), pour que la révision APA.MiseEnForme porte
                # le DOI. Sinon une alerte APA.DoiRetrouve séparée, moins sévère, perdrait le
                # chevauchement contre la mise en forme et finirait en commentaire.
                r['doi'] = doi_retrouve

        rendu = mise_en_forme_apa(r, meta_crossref)
        mef_emise = False
        if rendu:
            # Astérisques retirés avant de tasser les espaces : un seul passage [\s*]+ -> ' '
            # donnerait « Revue X , » pour « *Revue X*, ».
            attendu = re.sub(r'\s+', ' ', rendu.replace('*', '')).strip()
            original = re.sub(r'\s+', ' ', (r.get('texte') or '').replace('*', '')).strip()
            if attendu and original and attendu != original:
                jeton_manquant = _jeton_manquant(r.get('texte') or '', rendu)
                if jeton_manquant:
                    # Garde-fou : une forme qui a perdu un nom propre, une année ou un nombre
                    # de l'original n'est pas proposée.
                    stats['non_proposees'].append({
                        'para': r.get('para'), 'raison': 'jeton_manquant',
                        'jeton': jeton_manquant, 'found': r.get('texte'),
                    })
                else:
                    message = _msg('APA.MiseEnForme', langue)
                    if doi_retrouve:
                        message += _msg('APA.MiseEnForme.DoiAjoute', langue, doi_retrouve)
                    mef = {
                        'rule': 'APA.MiseEnForme', 'severity': 'warning', 'action': 'track',
                        'para': r.get('para'), 'span': None, 'found': r.get('texte'),
                        'suggested': rendu,
                        # Sans astérisques, pour le rapport HTML. `suggested` les garde pour
                        # l'annotation Word, qui en fait de l'italique.
                        'suggested_texte': _texte_suggere_sans_italique(rendu),
                        'message': message,
                    }
                    alertes.append(mef)
                    mef_emise = True
                    # Le DOI retrouvé doit arriver en révision. Si la mise en forme devient
                    # un commentaire (chevauchement avec une révision plus sévère, ou lien),
                    # son repli, une simple insertion du DOI en fin de référence, prend sa
                    # place. manuscrit_annoter.py écarte le repli quand la mise en forme
                    # passe en révision, puisqu'elle porte déjà le DOI.
                    repli = _alerte_insertion_doi(r, doi_retrouve) if doi_retrouve else None
                    if repli is not None:
                        groupe = 'doi:%s' % (r.get('para'),)
                        mef['groupe'] = groupe
                        mef['role_groupe'] = 'principal'
                        repli['groupe'] = groupe
                        repli['role_groupe'] = 'repli'
                        alertes.append(repli)

        if doi_retrouve and not mef_emise:
            # Pas de APA.MiseEnForme pour cette référence (confiance insuffisante, ou rendu
            # identique à l'original) : le DOI retrouvé est une insertion `track` seule.
            insertion = _alerte_insertion_doi(r, doi_retrouve)
            if insertion is not None:
                alertes.append(insertion)
            else:
                # Aucun segment de fin unique où ancrer l'insertion : un commentaire.
                alertes.append({
                    'rule': 'APA.DoiRetrouve', 'severity': 'suggestion', 'action': 'comment',
                    'para': r.get('para'), 'span': None, 'found': None, 'suggested': doi_retrouve,
                    'message': _message_doi_retrouve(doi_retrouve, langue),
                })

    return alertes, stats


# ---------------------------------------------------------------------------------
# 9. CLI d'essai : manuscrit_biblio.py <fichier.docx> --langue fr [--sans-reseau]
#
# manuscrit_docx et manuscrit_modele s'importent ici, et non en tête : le reste du module
# s'importe et se teste sans lecteur .docx.

def _extraire_paragraphes(chemin):
    import manuscrit_docx as md
    import manuscrit_modele as mm

    document = md.lire(chemin)
    mm.classer_titres(document)
    lexique = pronto_modele.lire_titres_bib()

    indice_titre = None
    for i, bloc in enumerate(document.blocs):
        if not isinstance(bloc, mm.Paragraphe) or bloc.niveau_retenu not in (1, 2, 3):
            continue
        t = bloc.texte().strip()
        if t and pronto_modele.titre_est_biblio(t, lexique):
            indice_titre = i

    corps, biblio = [], []
    limite = indice_titre if indice_titre is not None else len(document.blocs)
    for i, bloc in enumerate(document.blocs):
        if not isinstance(bloc, mm.Paragraphe):
            continue
        t = bloc.texte()
        if not t.strip():
            continue
        if i < limite:
            corps.append({'source': bloc.source, 'texte': t})
        elif indice_titre is not None and i > indice_titre:
            if isinstance(document.blocs[i], mm.Tableau):
                break
            biblio.append({'source': bloc.source, 'texte': t})
    return corps, biblio


def principal(argv):
    args = argv[1:]
    if not args or args[0].startswith('--'):
        print('usage : manuscrit_biblio.py <fichier.docx> --langue fr|de [--sans-reseau]',
              file=sys.stderr)
        return 2
    chemin = args[0]
    langue = 'fr'
    reseau = True
    i = 1
    while i < len(args):
        if args[i] == '--langue' and i + 1 < len(args):
            langue = args[i + 1]
            i += 2
        elif args[i] == '--sans-reseau':
            reseau = False
            i += 1
        else:
            i += 1

    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    corps, biblio = _extraire_paragraphes(chemin)
    alertes, stats = analyser_bibliographie(corps, biblio, langue, reseau=reseau)
    print(json.dumps({'alertes': alertes, 'stats': stats}, ensure_ascii=True, default=str))
    return 1 if any(a['severity'] == 'error' for a in alertes) else 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
