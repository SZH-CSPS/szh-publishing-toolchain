#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_biblio.py — vérification de bibliographie APA 7 (contrôle, DOI, mise en forme).
# Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §7 bis.
#
# Module PUR : ne sait rien de Word ni d'OpenDocument. Il reçoit du texte déjà extrait
# (paragraphes de corps et de bibliographie, sous la forme {'texte':.., 'source':..} — le même
# schéma que la Contexte de manuscrit_regles.py) et rend des alertes au même format que le
# reste du nettoyeur : rule, severity, action, para, span, found, suggested, message.
#
# Le réseau est FACULTATIF et borné à Crossref, et seules des métadonnées de référence y
# partent (auteur, année, titre, DOI) — jamais le texte de l'article. `_requete()` est le seul
# point qui touche réellement le réseau : les tests l'injectent pour ne jamais appeler
# api.crossref.org.
#
# Réutilisé, jamais recopié : pronto_modele.normaliser()/aplatir()/lire_titres_bib()/
# _titre_est_biblio() ; docx-meta.py (chargé par chemin, il porte un tiret) pour
# nettoyer_doi()/RE_DOI/langue_du_doi()/decouper_prenom_nom()/nom_plausible().
#
# stdlib seule : re, json, difflib, urllib.request. Délai réseau court (défaut 4 s) — un
# Crossref lent ne doit jamais bloquer le nettoyage d'un manuscrit.

import difflib
import importlib.util
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

_ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _ICI)
import pronto_modele


def _charger_module_a_tiret(nom_fichier, nom_module):
    """docx-meta.py porte un tiret : pas un module importable par son nom (convention du
    dépôt, §3 du contrat). Chargé par chemin, comme le font déjà les tests
    (test/js/docx-meta-titre.test.js)."""
    chemin = os.path.join(_ICI, nom_fichier)
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dm = _charger_module_a_tiret('docx-meta.py', 'szh_docx_meta_pour_biblio')

# ---------------------------------------------------------------------------------
# Contact générique du dépôt pour le User-Agent Crossref (poli et identifiable, comme le
# demande leur documentation). Ni lib/export-ojs.js ni secretariat.js n'en portent un : repli
# sur l'adresse de rédaction commune, déjà publique (guide Revue, §"Envoi").
CONTACT_DEPOT = 'redaction@csps.ch'
USER_AGENT = 'SZH-Publishing-manuscrit-biblio/1.0 (mailto:%s)' % CONTACT_DEPOT

CROSSREF_BASE = 'https://api.crossref.org'
DELAI_RESEAU_DEFAUT = 4

SEUIL_TITRE_VERIFICATION = 0.8   # resoudre_crossref() : le DOI donné pointe-t-il la bonne ref
SEUIL_TITRE_RETROUVE = 0.9       # retrouver_doi() : plus strict, on va PROPOSER un DOI absent


# ---------------------------------------------------------------------------------
# Normalisation de nom — tolérante aux particules (« de », « van der »...), pour apparier une
# citation du corps (qui omet souvent la particule : « Chambrier, 2020 ») à une entrée de
# bibliographie qui la porte (« de Chambrier, A.-F. »). PARTICULES vient de docx-meta.py : une
# seule liste pour tout le dépôt.
#
# Même tolérance pour un suffixe générationnel (« Jr », « Jr. », « Sr », « II », « III » —
# mesuré sur un manuscrit réel : « Bullough Jr, R. V. (2002) » en bibliographie contre
# « Bullough et al., 2002 » dans le texte, qui n'a jamais de raison de le répéter). Il se
# retire à la fin du nom, jamais en tête — un « Jr » de tête ne serait qu'un nom de famille
# comme un autre.
SUFFIXES_GENERATIONNELS = {'jr', 'sr', 'ii', 'iii', 'iv'}


def _normaliser_nom(nom):
    mots = (nom or '').split()
    while mots and mots[0].strip('.,').lower() in dm.PARTICULES:
        mots.pop(0)
    while mots and mots[-1].strip('.,').lower() in SUFFIXES_GENERATIONNELS:
        mots.pop()
    reste = ' '.join(mots) or (nom or '')
    return pronto_modele.aplatir(reste)


def _cle_tri(nom, langue):
    """Clé d'ALPHABÉTISATION d'un nom — DIFFÉRENTE de _normaliser_nom() (celle-ci sert à
    APPARIER une citation, pas à trier). Les deux guides donnent une règle opposée pour la
    particule :
      - Revue, §3.2.1 : « Les noms avec particule sont ordonnés avec la première lettre de
        la particule écrite en majuscule » — la particule COMPTE dans le tri
        (« Le Prévost » se classe en L, avant « Leroux », jamais en P) ;
      - Zeitschrift, Literaturverzeichnis/Anordnung : « Namen mit Namenszusatz werden unter
        dem ersten Buchstaben des Namens eingeordnet » — la particule est IGNORÉE, seul le
        nom qui suit compte (convention des bibliothèques allemandes : « von Arx » se classe
        en A).
    aplatir() ne retire ni espace ni particule : le nom entier, particule comprise, devient
    la clé pour le français ; seule la version allemande la retire d'abord."""
    n = nom or ''
    if langue == 'de':
        mots = n.split()
        while mots and mots[0].strip('.,').lower() in dm.PARTICULES:
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
# Langue DE LA RÉFÉRENCE — distincte de `_langue` (la langue du PRODUIT, qui pilote le reste
# de la mise en forme APA : espacement volume/numéro, « (Éd.) »/« (Hrsg.) »). Un titre
# anglais cité dans une bibliographie française ne prend jamais l'insécable française devant
# son propre « : » interne. Détection par mots-outils, jamais un détecteur de langue général
# (stdlib seule, §2 du contrat) : anglais d'abord, allemand ensuite, sinon la langue du
# document — le seul repli qui ait un sens pour un titre sans aucun mot-outil reconnu.
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


# Séparateur titre/sous-titre ':' À L'INTÉRIEUR d'un titre cité : insécable devant en
# français (même convention que le pont typographique, §6 du contrat), AUCUNE espace devant
# en allemand ET en anglais. Le filtre Lua ne connaît que fr/de (`-M lang=` ne vaut jamais
# 'en') : un titre anglais cité dans une bibliographie française ou allemande n'est donc
# JAMAIS couvert par lui — mesuré : il pose au contraire une insécable À TORT devant ce
# ':'-là, puisqu'il traite tout le document comme français (voir le rapport de chantier,
# « ce que fait le pont typographique sur les paragraphes de bibliographie »). La CASSE qui
# suit le séparateur n'est jamais forcée ici : un titre cité garde sa casse d'origine, seul
# l'espacement du signe est composé.
_RE_SEPARATEUR_TITRE = re.compile(r'[   ]*:[   ]*')


def _composer_separateur_titre(titre, langue_ref):
    if not titre or ':' not in titre:
        return titre
    avant = ' ' if langue_ref == 'fr' else ''
    return _RE_SEPARATEUR_TITRE.sub(avant + ': ', titre)


def _texte_suggere_sans_italique(suggested):
    """`suggested` sans le marquage *…* — pour un usage en TEXTE PLAT (rapport HTML, §7 du
    contrat point 4) : des astérisques littéraux n'y signifient rien pour une relectrice, ils
    y sont lus comme des astérisques, pas comme de l'italique."""
    if not suggested or '*' not in suggested:
        return suggested
    return re.sub(r'\*([^*]+)\*', r'\1', suggested)


# ---------------------------------------------------------------------------------
# 1. analyser_reference() — découpe une entrée APA 7 (fr et de) en champs structurés.

MARQUEUR_EDITEUR_RE = re.compile(
    r'\(\s*(?:[EÉ]d\.?s?\.?|[Ee]ds?\.?|dir\.?|coord\.?|Hrsg\.?|Übers\.?|trad\.?|adapt\.?)\s*\)',
    re.UNICODE)

RE_ANNEE = re.compile(r'\((\d{4})([a-z]?)[^)]*\)')
# « en préparation »/« sous presse »/« in press » (Revue, §3.2.2.4/.3.2.3.3) et « im
# Erscheinen » (Zeitschrift, Spezialfälle) valent « pas encore d'année » — pas un échec de
# lecture, une forme prévue par les deux guides.
RE_SANS_DATE = re.compile(
    r'\((?:s\.?\s?d\.?|n\.?d\.?|o\.?\s?[jJ]\.?|sans\s+date|ohne\s+Jahr|'
    r'en\s+pr[ée]paration|sous\s+presse|in\s+press|im\s+Erscheinen)\)', re.IGNORECASE)

RE_ET_AL_FIN = re.compile(r'\bet\s*al\.?\s*$', re.IGNORECASE)
RE_CONNECTEUR_SANS_VIRGULE = re.compile(r'([A-ZÀ-ÞŒ]\.?)\s+(?:&|et|und)\s+')

# La forme sans schéma (« www.zeitschriftfürumweltfragen.ch », exemple du guide allemand)
# est aussi une URL : la reconnaître évite qu'elle échoue dans le titre faute de schéma.
RE_URL = re.compile(r'(?:https?://\S+|\bwww\.[^\s,;]+)')
# Le titre finit sur '.', mais aussi sur '?' ou '!' — fréquent en français (« Quelle
# inclusion ? Revue X, 12(3), 45-67. »). ':' n'est PAS dans ce jeu principal : un titre à
# sous-titre (très fréquent ici, « Titre : sous-titre ? Revue, 12(3), 45-67. ») porte
# lui-même un ':', et comme .+? est non gourmand, le premier ':' rencontré l'emporterait à
# tort sur le VRAI séparateur qui suit (mesuré : « Hétérogénéité […] différences : Vers
# quelle égalité des élèves ? Nouvelle revue de … » coupait sur le ':' et avalait le
# sous-titre entier dans le conteneur). ':' ne sert qu'en REPLI, seulement si .?! échouent
# partout — c'est le cas, plus rare, d'une revue qui a oublié toute ponctuation entre le
# titre et le nom de la revue (vu sur le corpus : «… adapté : La nouvelle revue - Éducation
# et société inclusives, 97(1), 203-221. »).
_SEP_TITRE = r'[.?!]'
_SEP_TITRE_REPLI = r'[.?!:]'
RE_CHAPITRE = re.compile(_SEP_TITRE + r'\s+(?:Dans|In)\s+(.+)$', re.S)
RE_CHAPITRE_REPLI = re.compile(_SEP_TITRE_REPLI + r'\s+(?:Dans|In)\s+(.+)$', re.S)
# Le marqueur de pages peut porter une mention d'édition devant lui DANS la même parenthèse
# (« (2e éd., pp. 307-328) », exemple du guide Revue lui-même) : le motif n'exige donc plus
# que « pp. »/« p. »/« S. » ouvre la parenthèse, seulement qu'il s'y trouve.
RE_PAGES_PARENTHESE = re.compile(
    r'\((?:[^()]*,\s*)?(?:pp?\.|S\.)\s*([\d–‒\-]+(?:\s*[–‒\-]\s*\d+)?)\s*\)')
PAGES = r'[\d–‒\-]+(?:\s*[–‒\-]\s*\d+)?'


def _regles_article(sep):
    # Le nombre après la revue peut être suivi d'AUTRE CHOSE que la fin de la chaîne — un
    # éditeur commercial oublié après les pages, vu sur le corpus réel (« …, 95, 91-109.
    # Editions Inshea » : sans ce groupe optionnel, la référence entière était rejetée comme
    # article et retombait en « ouvrage », titre et conteneur confondus).
    avec_vol = re.compile(
        r'^(?P<titre>.+?)' + sep + r'\s+(?P<conteneur>[^,]+?),\s*(?:[Nn]°\s*)?(?P<vol>\d+)\s*'
        r'\((?P<num>[^)]+)\)\s*,\s*'
        r'(?P<pages>' + PAGES + r')\.?\s*(?:(?P<extra>\S.*))?$')
    # Un seul nombre avant les pages : « (3) » entre parenthèses dans le texte d'origine EST
    # un numéro (sans volume, forme que les deux guides montrent) ; un nombre NU, sans
    # parenthèses dans l'original, est le plus souvent un volume SEUL — le garder bare (pas de
    # parenthèses ajoutées) évite de reformuler une entrée déjà conforme (mesuré : « Revue X,
    # 22, 64-72 » devenait à tort « Revue X, *(22)*, 64-72 »).
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
    """(entête préparée pour le découpage, et_al) : « et al. » de tête est ôté et signalé
    (rare en bibliographie, mais vu sur des manuscrits mal formatés) ; un connecteur
    (« & »/« et »/« und ») posé sans virgule devant (« M. et Rebetez ») en reçoit une, pour
    que le découpage sur la virgule, plus bas, traite tous les cas pareil."""
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
    """« A.-F. de », « H. van der » : la particule d'un nom composé écrite APRÈS les
    initiales (convention APA de classement des noms néerlandais/allemands — « Van der Berg »
    classé sous B, cité « Berg, A. van der »). (initiales, particule) ou (None, None) si le
    segment ne s'y prête pas."""
    mots = segment.split()
    particule = []
    while mots and mots[-1].strip('.,').lower() in dm.PARTICULES:
        # strip('.,') RETIRÉ du mot gardé, pas seulement testé : sinon le point final d'une
        # référence (« … A.-F. de. ») se retrouve collé au milieu du nom reconstruit.
        particule.insert(0, mots.pop().strip('.,'))
    reste = ' '.join(mots)
    if particule and _ressemble_initiales(reste):
        return reste, ' '.join(particule)
    return None, None


def _parser_auteurs(entete_brute):
    """[{nom, initiales}], et_al — découpage par paires (Nom, Initiales) sur la virgule.
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
    """(annee|None, suffixe, debut, fin) du PREMIER « (YYYY[x]…) » ou repli « (s.d.) »/« (n.d.) »
    — même logique que annee_de_reference() de szh-citations.lua, réécrite ici (elle est en
    Lua, pas partageable telle quelle)."""
    m = RE_ANNEE.search(texte)
    if m:
        return int(m.group(1)), m.group(2) or '', m.start(), m.end()
    m = RE_SANS_DATE.search(texte)
    if m:
        return None, '', m.start(), m.end()
    return None, '', None, None


def _segmenter_hors_parentheses(texte, sep):
    """Découpe `texte` sur le caractère `sep` (',' ou '.') suivi d'une espace ou de la fin de
    la chaîne, JAMAIS à l'intérieur d'une parenthèse — sinon « (p. 396) » ou « (2e éd., pp.
    307-328) » se scindent sur leur propre ponctuation interne. Mesuré : cassait un titre
    d'ouvrage juste avant sa mention de page (« […] la recherche [RERS 2006] (p » / «. 396). »
    au lieu d'un seul segment)."""
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


# Un éditeur d'ouvrage collectif, dans la clause « In … (Éd.), » : écrit INITIALES puis NOM
# (l'ordre INVERSE de la bibliographie elle-même, qui écrit NOM, INITIALES) — c'est ce que
# montrent les deux guides dans leur propre exemple de chapitre (« In E. E. Editor (Ed.),
# Titre du livre… »). Jusqu'à deux éditeurs joints par « & » DANS le même segment (pas de
# virgule avant un « & » à deux éditeurs, mesuré sur le corpus : « In C. Delorme & K.
# Millon-Fauré (Ed.), … »).
RE_EDITEUR_INITIALES_NOM = re.compile(
    r"^(?:[A-ZÀ-ÞŒ]\.-?){1,3}\s+[A-ZÀ-ÞŒ][\w'’\-]*"
    r"(?:\s*&\s*(?:[A-ZÀ-ÞŒ]\.-?){1,3}\s+[A-ZÀ-ÞŒ][\w'’\-]*)?$")


def _consommer_editeurs_de_tete(apres):
    """Le nombre de segments (virgule, hors parenthèses) de tête qui listent les éditeurs
    d'un ouvrage collectif — jamais leurs noms eux-mêmes, seulement COMBIEN en retirer pour
    atteindre ce qui reste : le titre de l'ouvrage, ses pages, son éditeur commercial. Mesuré
    sans cette consommation : une liste de 3 éditeurs (« G. Pelgrims, T. Assude, & J.-M.
    Perez ») faisait prendre le TROISIÈME NOM D'ÉDITEUR pour le titre du livre, perdant à la
    fois les vrais éditeurs et le vrai titre."""
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
    return pronto_modele.normaliser(t or '').strip()


def _calculer_confiance(champs, annee, auteurs, entete_brute):
    if annee is None:
        return 'basse'
    if not auteurs and not (entete_brute or '').strip():
        return 'basse'
    t = champs['type']
    if t == 'article' and champs['titre'] and champs['conteneur']:
        return 'haute'
    if t == 'chapitre' and champs['titre'] and champs['conteneur']:
        return 'haute'
    if t == 'ouvrage' and champs['titre'] and champs['editeur']:
        return 'haute'
    if t in ('rapport', 'web') and champs['titre'] and champs['editeur']:
        return 'haute'
    if t in ('rapport', 'web') and champs['titre']:
        return 'moyenne'
    if t == 'inconnu':
        return 'basse'
    return 'moyenne' if champs['titre'] else 'basse'


def analyser_reference(texte, langue_doc='fr'):
    """Découpe une entrée APA 7 (fr/de) en dict structuré — voir l'en-tête du module pour les
    champs. Jamais d'exception : une entrée illisible rend une confiance 'basse', pas un
    plantage — le rapport doit pouvoir lister TOUTES les références, même ratées.

    `langue_doc` : langue du PRODUIT (jamais document.langue, §8 du contrat) — sert
    uniquement de REPLI à la détection de `langue_ref` (voir _detecter_langue_reference) quand
    le titre ne porte aucun mot-outil reconnu ; elle ne pilote rien d'autre ici."""
    brut = texte or ''
    texte_n = pronto_modele.normaliser(brut)
    champs = {'auteurs': [], 'nb_auteurs': 0, 'annee': None, 'suffixe': '', 'titre': '',
              'conteneur': '', 'volume': '', 'numero': '', 'pages': '', 'editeur': '',
              'genre': '', 'editeurs_ouvrage': '', 'doi': '', 'url': '', 'type': 'inconnu',
              'confiance': 'basse', 'langue_ref': ''}
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
            # Aucune année ni forme « s.d. » repérable (référence tronquée, ou un cas que ce
            # module ne couvre pas — un acte législatif, par exemple) : pas de frontière
            # fiable pour découper les auteurs. Se limiter au premier segment évite de
            # fabriquer une liste d'« auteurs » absurde à partir de 120 caractères de prose.
            entete_brute = texte_n.split(',', 1)[0]
            reste = ''

        entete_sans_marque = MARQUEUR_EDITEUR_RE.sub('', entete_brute).strip()
        auteurs, _et_al_entete = _parser_auteurs(entete_sans_marque)
        champs['auteurs'] = auteurs
        champs['nb_auteurs'] = len(auteurs)

        # DOI d'abord : sinon ses chiffres se font happer par un motif de pages ou d'année.
        m_doi = dm.RE_DOI.search(reste)
        if m_doi:
            champs['doi'] = 'https://doi.org/' + dm.nettoyer_doi(reste)
            reste = (reste[:m_doi.start()] + reste[m_doi.end():])
            # Ce qui précède le DOI (« doi: », « DOI :», « dx.doi.org/ »…) est du bruit,
            # déjà repris dans le champ 'doi' ci-dessus : on l'ôte du texte restant.
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
            # La liste des éditeurs (« G. Pelgrims, T. Assude, & J.-M. Perez ») se retire de
            # tête AVANT de chercher le titre de l'ouvrage : sans ça, son dernier nom se
            # faisait prendre pour le titre (voir _consommer_editeurs_de_tete()).
            segments_apres, n_editeurs = _consommer_editeurs_de_tete(apres)
            apres_editeurs = ', '.join(segments_apres[n_editeurs:]).strip(' ,')
            if n_editeurs:
                champs['editeurs_ouvrage'] = _nettoyer_titre(
                    ', '.join(segments_apres[:n_editeurs]))
            m_pages = RE_PAGES_PARENTHESE.search(apres_editeurs)
            if m_pages:
                champs['pages'] = _nettoyer_pages(m_pages.group(1))
                avant, apres_pages = apres_editeurs[:m_pages.start()], apres_editeurs[m_pages.end():]
            else:
                # Pages données SANS « (pp. x-x) » — juste « …, 151-167. Éditeur. » : forme
                # non prescrite par les guides mais vue sur le corpus réel. Repli sur la
                # première virgule suivie d'un nombre de pages plausible.
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
                # Un numéro déjà entre parenthèses dans l'original (« (3) ») reste un numéro ;
                # un nombre NU (« , 22, » sans volume distinct) est le plus souvent un simple
                # volume — la forme d'origine décide, jamais un ajout de parenthèses qui
                # reformaterait une entrée déjà conforme (voir _regles_article()).
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
                        # Rien après le crochet : l'institution est DEDANS
                        # (« [Thèse de doctorat, Université de Reims] ») — le genre lui-même
                        # (avant la première virgule) n'est pas un éditeur, le reste l'est.
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
                    # Le DERNIER segment est l'éditeur commercial (toujours en fin de
                    # référence APA) ; tout ce qui précède — titre ET sous-titre écrit avec un
                    # point plutôt qu'un ':' — reste ensemble, italicisé comme un seul titre
                    # (mesuré : « Titre. Sous-titre. Éditeur. » perdait le sous-titre, pris à
                    # tort pour l'éditeur).
                    morceaux = _segmenter_hors_parentheses(reste, '.')
                    if len(morceaux) > 1:
                        champs['titre'] = _nettoyer_titre('. '.join(morceaux[:-1]))
                        champs['editeur'] = _nettoyer_titre(morceaux[-1])
                    else:
                        champs['titre'] = _nettoyer_titre(reste)
                else:
                    champs['type'] = 'inconnu'

        # Langue DE LA RÉFÉRENCE et séparateur titre/sous-titre composé en conséquence
        # (point 1 du lot du 21.09.2026) : après que titre/conteneur sont fixés, quel que soit
        # le type de référence — un titre anglais cité dans une bibliographie française ne
        # doit jamais porter l'insécable française devant son ':' interne.
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
# Deux formes, jamais confondues : narrative (« Tremblay (2023b) », le nom est HORS
# parenthèse) et parenthétique (« (Bacharach et al., 2010) », « (Bullough et al., 2003 ;
# Wenzlaff, 2002) »). Une fois qu'un appel narratif a consommé son « (année) », le passage en
# parenthèse n'est plus repris comme une citation supplémentaire.

_PARTICULE_ALTERNATIVE = '|'.join(sorted(dm.PARTICULES, key=len, reverse=True))

# Le contenu de la parenthèse est capturé EN ENTIER (pas juste une année) : une citation
# narrative peut porter plusieurs années pour le même auteur (« Pelgrims (2001, 2006) »),
# exactement comme en bibliographie — chaque année de `contenu` devient sa propre citation,
# voir citations_du_corps(). Le préfixe de particule est comparé sans égard à la casse
# ((?i:...) scopé, pas re.IGNORECASE global) : « De Chambrier (2020) » en tête de phrase
# ne doit pas perdre son « D » majuscule.
#  \b devant la particule : sans lui, un mot ORDINAIRE finissant par une des lettres seules
# de PARTICULES (« e », « a », « y » — portugais/espagnol : « Silva e Costa ») déclenchait un
# faux départ de nom AU MILIEU du mot qui précède (« comme le montre Tremblay » a été vu
# amorcer un nom sur le « e » de « montre »). \b n'existe qu'entre un caractère de mot et un
# non-mot : impossible entre deux lettres d'un même mot.
# ⚠ Le contenu de la parenthèse DOIT COMMENCER par l'année (espaces mis à part), pas
# n'importe où la contenir : mesuré sur le corpus réel, « … du MPA (Booms et al., 2023) »
# faisait passer l'acronyme « MPA » (une majuscule, suivie d'une parenthèse à année) pour le
# nom cité, alors que la parenthèse est sa PROPRE citation parenthétique, sans rapport avec
# le mot qui la précède. Un contenu qui commence par un nom (« Booms et al., 2023 ») n'est
# JAMAIS narratif : il est laissé à la passe B (parenthétique), qui lit le bon premier auteur.
RE_NARRATIF = re.compile(
    r'(\b(?:(?i:' + _PARTICULE_ALTERNATIVE + r')\s+)?'
    r'[A-ZÀ-ÞŒ][\w\'’\-]*(?:\s+et\s*al\.?)?'
    r'(?:\s*(?:&|,|et|und)\s*[A-ZÀ-ÞŒ][\w\'’\-]*)*)'
    r'\s*\(\s*((?:19|20)\d{2}[^()]*)\)')

# Petits mots qui ouvrent une parenthèse de citation sans en faire partie (« voir »,
# « cf. », l'allemand « vgl. »/« siehe ») — un sous-ensemble minimal d'OUVREURS de
# szh-citations.lua, suffisant pour ne pas prendre un nombre en prose (« voir tableau 2020 »)
# pour une citation : le nom qui suit doit de toute façon commencer par une majuscule.
_OUVREURS_LOCAUX = ('voir', 'cf', 'vgl', 'siehe', 'selon', 'nach', 'gemäss')
RE_OUVREUR = re.compile(r'^\s*(?:' + '|'.join(_OUVREURS_LOCAUX) + r')\.?\s+', re.IGNORECASE)


def _premier_auteur(zone):
    """Le premier nom d'une zone d'auteurs (« Bullough et al. », « de Chambrier & Nom »),
    particule comprise. Vide si la zone ne commence pas par une majuscule (donc pas un nom) —
    exclut « voir tableau », « en 2010 », etc."""
    z = re.sub(r'\bet\s*al\.?', '', zone or '', flags=re.IGNORECASE).strip(' ,;&')
    if not z:
        return ''
    m = re.match(r'^(\b(?:(?i:' + _PARTICULE_ALTERNATIVE + r')\s+)?[A-ZÀ-ÞŒ][\w\'’\-]*)', z)
    return m.group(1) if m else ''


def _citations_du_fragment(frag, source, decalage_absolu):
    """Une citation parenthétique peut porter PLUSIEURS années pour le même auteur
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
    for am in annees:
        deb = decalage_absolu + decalage_ouvreur + am.start()
        fin = decalage_absolu + decalage_ouvreur + am.end()
        out.append({'nom_premier_auteur': premier, 'annee': int(am.group(0)[:4]),
                     'suffixe': am.group(1) or '', 'para': source, 'span': [deb, fin],
                     'et_al': et_al, 'texte': frag.strip(), 'nom_brut': zone_brute})
    return out


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
            contenu_debut = m.start(2)
            trouve = False
            for am in re.finditer(r'(?:19|20)\d{2}([a-z]?)', contenu):
                trouve = True
                citations.append({
                    'nom_premier_auteur': premier, 'annee': int(am.group(0)[:4]),
                    'suffixe': am.group(1) or '', 'para': source,
                    'span': [contenu_debut + am.start(), contenu_debut + am.end()],
                    'et_al': et_al, 'texte': m.group(0), 'nom_brut': nom_brut})
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
# `references` : une liste de dicts, chacun le résultat de analyser_reference() AUGMENTÉ d'un
# champ 'para' (le Paragraphe.source de l'entrée) — c'est analyser_bibliographie() qui fait
# cet ajout, cette fonction-ci reste générale.

def _cle(nom, annee):
    return (_normaliser_nom(nom), annee)


RE_ET_AL_MILIEU = re.compile(r'\bet\s*al\.?', re.IGNORECASE)


def croiser(citations, references):
    alertes = []
    refs_par_cle = {}
    for r in references or []:
        if not r.get('auteurs') or r.get('annee') is None:
            continue
        cle = _cle(r['auteurs'][0]['nom'], r['annee'])
        refs_par_cle.setdefault(cle, []).append(r)

    citees = set()
    for c in citations or []:
        cle = _cle(c['nom_premier_auteur'], c['annee'])
        correspondances = refs_par_cle.get(cle)
        if not correspondances and c.get('nom_brut'):
            # Repli pour un auteur institutionnel multi-mots (« Ministère de l'Éducation
            # nationale & DEPP ») : le premier mot seul ('Ministère') ne suffit pas à
            # retrouver la référence, qui porte le nom ENTIER (aucune virgule interne ne le
            # découpe en « auteurs » côté bibliographie). Essayé seulement si la clé courte a
            # échoué, jamais à sa place : un nom de personne, lui, EST son premier mot.
            nom_large = RE_ET_AL_MILIEU.sub('', c['nom_brut']).strip(' ,;&')
            cle_large = _cle(nom_large, c['annee'])
            if cle_large != cle:
                correspondances = refs_par_cle.get(cle_large)
                if correspondances:
                    cle = cle_large
        if not correspondances:
            alertes.append({
                'rule': 'APA.CitationAbsente', 'severity': 'error', 'action': 'comment',
                'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
                'suggested': None,
                'message': 'Cette citation ne correspond à aucune référence de la '
                           'bibliographie : « %s ».' % c.get('texte'),
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
                'message': 'Le suffixe « %s » de cette citation ne correspond à aucune '
                           'référence du même auteur et de la même année.' % c['suffixe'],
            })
        # « et al. » : manquant dès trois auteurs, posé à tort pour un ou deux.
        ref = correspondances[0]
        nb = ref.get('nb_auteurs') or 0
        if nb >= 3 and not c.get('et_al'):
            suggere = '%s et al. (%d%s)' % (c['nom_premier_auteur'], c['annee'],
                                             c.get('suffixe') or '')
            alertes.append({
                'rule': 'APA.EtAl', 'severity': 'warning', 'action': 'fix',
                'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
                'suggested': suggere,
                'message': 'Cette référence compte %d auteurs : la citation doit porter '
                           '« et al. » (« %s »).' % (nb, suggere),
            })
        elif 1 <= nb <= 2 and c.get('et_al'):
            if nb == 2 and len(ref.get('auteurs') or []) == 2:
                second = ref['auteurs'][1]['nom']
                suggere = '%s & %s (%d%s)' % (c['nom_premier_auteur'], second, c['annee'],
                                               c.get('suffixe') or '')
            else:
                suggere = '%s (%d%s)' % (c['nom_premier_auteur'], c['annee'],
                                          c.get('suffixe') or '')
            alertes.append({
                'rule': 'APA.EtAl', 'severity': 'warning', 'action': 'fix',
                'para': c.get('para'), 'span': c.get('span'), 'found': c.get('texte'),
                'suggested': suggere,
                'message': 'Cette référence ne compte que %d auteur(s) : « et al. » est de '
                           'trop (« %s »).' % (nb, suggere),
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
                'message': 'Cette référence ne semble jamais citée dans le texte.',
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

    # Une alerte par ENTRÉE déplacée, pas par voisinage — et pas non plus une comparaison
    # POSITION PAR POSITION entre l'ordre lu et l'ordre trié : comparer les positions absolues
    # fait qu'UNE SEULE entrée mal rangée décale la position attendue de TOUTES celles qui la
    # suivent, et déclenche une alerte en cascade sur un bloc entier déjà correctement trié
    # ENTRE LUI (mesuré : une entrée isolée, annee=None, glissée au milieu d'une liste de 25
    # références par ailleurs impeccables, en faisait signaler 25 — au lieu d'1). La bonne
    # question n'est pas « cette entrée est-elle à la bonne position ? » mais « existe-t-il un
    # sous-ensemble déjà dans le bon ordre, aussi long que possible, qui la contient ? » —
    # c'est la plus longue sous-suite croissante (LIS) : toute entrée qui n'en fait pas partie
    # est celle qu'il faut déplacer, les autres sont déjà bien rangées ENTRE ELLES.
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
                'message': 'Référence mal classée : l\'ordre alphabétique puis '
                           'chronologique n\'est pas respecté.',
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
                    'message': 'Plusieurs références du même auteur et de la même année '
                               '(%d) ne sont pas distinguées par a/b/c.' % annee,
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
    numero = dm.nettoyer_doi(m.group(1))
    canonique = 'https://doi.org/' + numero
    if FORME_CANONIQUE.match(trouve):
        return alertes
    alertes.append({
        'rule': 'APA.DoiForme', 'severity': 'warning', 'action': 'fix',
        'para': ref.get('para'), 'span': None, 'found': trouve, 'suggested': canonique,
        'message': 'Le DOI n\'est pas écrit sous sa forme normalisée « %s ».' % canonique,
    })
    return alertes


# ---------------------------------------------------------------------------------
# 6. resoudre_crossref() / retrouver_doi() — le seul endroit qui touche le réseau.
#
# `_requete` est le point d'injection : les tests le remplacent, jamais un vrai appel.

def _requete(url, delai):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=delai) as reponse:
        return reponse.read()


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
    try:
        brut = _requete(url, delai)
    except Exception:
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
    """(doi, score) pour une référence SANS DOI (article/chapitre), ou None. N'accepte que si
    titre très proche (>= 0.9) ET auteur ET année concordent — un DOI deviné à tort est pire
    qu'aucun DOI, ce module ne l'insère de toute façon jamais tout seul (action='comment')."""
    if ref.get('doi') or ref.get('type') not in ('article', 'chapitre'):
        return None
    if not ref.get('titre') or not ref.get('auteurs') or ref.get('annee') is None:
        return None
    requete = '%s %s %s' % (ref['titre'], ref['auteurs'][0]['nom'], ref['annee'])
    url = CROSSREF_BASE + '/works?' + urllib.parse.urlencode(
        {'query.bibliographic': requete, 'rows': 3})
    try:
        brut = _requete(url, delai)
    except Exception:
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
# Différences relevées dans les deux PDF Redaktionsrichtlinien (extraits par pypdf, faute de
# pdftotext dans la WSL — voir le rapport de chantier) :
#   - volume(numéro) : collé en français « 12(3) », espacé en allemand « 12 (3) » ;
#   - éditeur d'ouvrage collectif : « (Éd.) »/« (Éds.) » en français, « (Hrsg.) » en allemand ;
#   - le chapitre s'introduit par « In » dans les DEUX langues (bien que le corps du texte
#     français reste rédigé en français — c'est ce que les Lignes directrices Revue montrent
#     dans leurs propres exemples, page 13).
# Rendue seulement si la confiance est haute ou si Crossref a confirmé — une référence
# 'moyenne'/'basse' n'est jamais reformulée à la place de la rédaction.

# Même règle T2 que le pont typographique (szh-typographie.lua, §6 du contrat) — mais
# SEULEMENT dans le contexte « pp. » qui la rend sûre (un chapitre, ici : un article APA 7 ne
# préfixe jamais ses pages, la règle ne s'applique donc jamais à lui, voir le rapport de
# chantier — « la plage de pages ne prend le demi-cadratin que dans ce contexte »). Trait
# d'union en français, demi-cadratin en allemand : même sens que le filtre (mesuré ligne 269
# de szh-typographie.lua, « depuis, vers = ... ; if not COLLEE then ... »).
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
        # APA 7 : seul le VOLUME est en italique, jamais le numéro entre parenthèses qui le
        # suit — « *37*(3) », pas « *37(3)* » (défaut réel mesuré : la forme précédente
        # italicisait les deux ensemble).
        volnum = ('*%s*' % volume if volume else '') + numero_paren
        conteneur = '*%s*' % ref['conteneur'] if ref.get('conteneur') else ''
        # Un article APA ne préfixe jamais ses pages de « p./pp. » : le T2 du pont
        # typographique ne s'applique donc jamais ici (voir _t2_plage_pages_chapitre) — les
        # pages restent telles que l'entrée les porte, trait d'union compris.
        queue = ', '.join(x for x in (conteneur, volnum, ref.get('pages') or '') if x)
        corps = '%s. %s.' % (titre, queue) if queue else '%s.' % titre
    elif t == 'chapitre':
        marqueur_editeur = '(Hrsg.)' if langue == 'de' else '(Éd.)'
        # Les noms des éditeurs de l'ouvrage collectif (« In E. E. Editor (Ed.), … ») ne sont
        # repris que si _consommer_editeurs_de_tete() a pu les isoler à la lecture — sinon on
        # ne les invente pas, on garde la forme sans eux plutôt qu'une fausse liste vide.
        editeurs_ouvrage = ('%s ' % ref['editeurs_ouvrage']) if ref.get('editeurs_ouvrage') else ''
        pages = (' (pp. %s)' % _t2_plage_pages_chapitre(ref['pages'], langue)
                 if ref.get('pages') else '')
        # Un titre de chapitre garde son « ? »/« ! » d'origine (voir plus haut, m_chap) : ne
        # pas lui rajouter un point qui produirait « … ?. In … », une double ponctuation que
        # personne n'a écrite.
        fin_titre = titre if titre[-1:] in '?!' else titre + '.'
        corps = '%s In %s%s, *%s*%s. %s.' % (
            fin_titre, editeurs_ouvrage, marqueur_editeur, ref.get('conteneur') or '', pages,
            ref.get('editeur') or '')
    elif t == 'rapport':
        # Le genre entre crochets (« [Thèse de doctorat] », « [Mémoire de Master] »…) fait
        # partie de la forme APA prescrite par les deux guides — le perdre a été mesuré comme
        # un défaut réel (une thèse rendue comme un ouvrage ordinaire).
        genre = ' [%s]' % ref['genre'] if ref.get('genre') else ''
        corps = ('*%s*%s. %s.' % (titre, genre, ref['editeur']) if ref.get('editeur')
                  else '*%s*%s.' % (titre, genre))
    elif t in ('ouvrage', 'web'):
        corps = '*%s*. %s.' % (titre, ref['editeur']) if ref.get('editeur') else '*%s*.' % titre
    else:
        corps = '%s.' % titre if titre else ''
    # rstrip de toute la ponctuation de fin, pas seulement le point : un éditeur qui finit par
    # ':' (repli web, « Vu le … sur : ») produisait « sur :. https://... », un « :. » que
    # personne n'a écrit.
    if ref.get('doi'):
        corps = corps.rstrip(' .:,;') + '. ' + ref['doi']
    elif ref.get('url'):
        corps = corps.rstrip(' .:,;') + '. ' + ref['url']
    rendu = ' '.join(x for x in morceaux if x) + ' ' + corps
    return re.sub(r'\s+', ' ', rendu).strip()


# Ancrage d'une INSERTION du DOI retrouvé (action='track', demande du 21.09.2026) : jamais
# toute la référence, une pure addition en fin de ligne — le dernier segment localisable,
# ses pages telles qu'écrites dans le texte d'origine (trait d'union ou demi-cadratin
# tolérés) si elles s'y retrouvent, sinon le point final seul.
def _segment_fin_reference(ref):
    texte = ref.get('texte') or ''
    pages = ref.get('pages') or ''
    if pages:
        for c in (pages, pages.replace('-', '–'), pages.replace('–', '-')):
            if c and texte.count(c) == 1:
                return c
    if texte.endswith('.'):
        return '.'
    return None


# ---------------------------------------------------------------------------------
# 8. analyser_bibliographie() — enchaîne tout.

def analyser_bibliographie(paragraphes_corps, paragraphes_biblio, langue, reseau=True):
    alertes = []
    stats = {'references': 0, 'analysees_haute': 0, 'analysees_moyenne': 0,
             'analysees_basse': 0, 'citations': 0, 'citees_absentes': 0, 'non_citees': 0,
             'doi_normalises': 0, 'doi_retrouves': 0,
             'crossref': {'consultes': 0, 'confirmes': 0, 'divergents': 0, 'indisponible': not reseau}}

    references = []
    for p in paragraphes_biblio or []:
        r = analyser_reference(p.get('texte') or '', langue_doc=langue)
        r['para'] = p.get('source')
        r['texte'] = (p.get('texte') or '').strip()
        r['_langue'] = langue
        references.append(r)
        stats['references'] += 1
        stats['analysees_' + r['confiance']] += 1

    citations = citations_du_corps(paragraphes_corps or [])
    stats['citations'] = len(citations)

    alertes_croisement = croiser(citations, references)
    alertes.extend(alertes_croisement)
    stats['citees_absentes'] = sum(1 for a in alertes_croisement if a['rule'] == 'APA.CitationAbsente')
    stats['non_citees'] = sum(1 for a in alertes_croisement if a['rule'] == 'APA.ReferenceNonCitee')

    alertes.extend(verifier_ordre(references, langue))

    for r in references:
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
                    'message': 'Le DOI renvoie à une autre publication (%s).'
                               % ', '.join(champs_divergents) if champs_divergents else
                               'Le DOI renvoie à une autre publication.',
                })
        elif reseau and not r.get('doi'):
            trouve = retrouver_doi(r)
            if trouve:
                doi, score = trouve
                stats['doi_retrouves'] += 1
                message = ('Un DOI correspondant a été trouvé pour cette référence : %s '
                            '(à confirmer avant de l\'ajouter).' % doi)
                segment = _segment_fin_reference(r)
                if segment:
                    # Insertion pure (§7 bis, demande du 21.09.2026) : jamais une réécriture
                    # de la référence, seulement le DOI ajouté après son dernier segment sûr.
                    alertes.append({
                        'rule': 'APA.DoiRetrouve', 'severity': 'suggestion', 'action': 'track',
                        'para': r.get('para'), 'span': None, 'found': segment,
                        'suggested': segment + ' ' + doi, 'message': message,
                    })
                else:
                    # Rien de fiable à ancrer (pages absentes/introuvables telles quelles, et
                    # la référence ne finit pas sur un point) : repli commentaire, jamais une
                    # insertion à l'aveugle.
                    alertes.append({
                        'rule': 'APA.DoiRetrouve', 'severity': 'suggestion', 'action': 'comment',
                        'para': r.get('para'), 'span': None, 'found': None, 'suggested': doi,
                        'message': message,
                    })

        rendu = mise_en_forme_apa(r, meta_crossref)
        if rendu:
            # Retirer l'astérisque D'ABORD, séparément du tassement des espaces : le
            # remplacer par une espace (comme le ferait un seul passage [\s*]+ -> ' ')
            # introduit une espace parasite juste avant la virgule qui le suit souvent
            # (« *Revue X*, » -> « Revue X , » à tort).
            attendu = re.sub(r'\s+', ' ', rendu.replace('*', '')).strip()
            original = re.sub(r'\s+', ' ', (r.get('texte') or '').replace('*', '')).strip()
            if attendu and original and attendu != original:
                alertes.append({
                    'rule': 'APA.MiseEnForme', 'severity': 'warning', 'action': 'track',
                    'para': r.get('para'), 'span': None, 'found': r.get('texte'),
                    'suggested': rendu,
                    # Sans marquage *…* (point 4 du lot du 21.09.2026) : pour un usage en
                    # texte plat (rapport HTML) — `suggested` garde ses astérisques pour
                    # l'annotation Word, qui sait les traduire en italique réel.
                    'suggested_texte': _texte_suggere_sans_italique(rendu),
                    'message': 'La mise en forme APA 7 de cette référence diffère de '
                               'l\'original — révision proposée.',
                })

    return alertes, stats


# ---------------------------------------------------------------------------------
# 9. CLI d'essai — manuscrit_biblio.py <fichier.docx> --langue fr [--sans-reseau]
#
# Import de manuscrit_docx/manuscrit_modele fait ICI, pas en tête de module : les fonctions
# pures ci-dessus s'importent et se testent sans lecteur .docx (consigne du chantier).

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
        if t and pronto_modele._titre_est_biblio(t, lexique):
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
