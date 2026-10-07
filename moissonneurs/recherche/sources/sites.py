"""Source « hautes écoles » : énumération des pages projet (plan du site ou liste HTML) et analyse de chacune. Chaque
site est décrit dans SITES ; un site infaisable proprement y reste, `actif=False`, avec sa `raison` constatée."""
import gzip
import html as _html
import re
import sys
import urllib.error
import xml.etree.ElementTree as ET

from .. import institutions
from ..dates import couper_duree, fin_ouverte
from ..modele import Projet
from ..reseau import ErreurReseau, Refus403Page, RobotsInterdit
from ._commun import texte_simple, texte_paragraphes, capturer, capturer_div, capturer_div_tous

# Échecs réseau attendus (une page individuelle en défaut ne doit pas arrêter toute la moisson) :
ECHECS_AVANT_ABANDON = 5

# ErreurReseau/RobotsInterdit viennent de reseau.py ; HTTPError/URLError par prudence
# si l'implémentation de reseau change.
_ECHEC_RESEAU = (ErreurReseau, RobotsInterdit, urllib.error.URLError)

NS_SITEMAP = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}


# ---------------------------------------------------------------------------
# Découverte par sitemap.xml (générique : suit un sitemapindex jusqu'aux urlset)
# ---------------------------------------------------------------------------

def _xml_depuis_bytes(bruts):
    if bruts[:2] == b'\x1f\x8b':
        bruts = gzip.decompress(bruts)
    return ET.fromstring(bruts)


def _urls_sitemap(reseau, url, profondeur=0):
    """[(loc, lastmod)] en suivant récursivement un sitemapindex jusqu'aux urlset."""
    racine = _xml_depuis_bytes(reseau.get(url))
    tag = racine.tag.rsplit('}', 1)[-1]
    sortie = []
    if tag == 'sitemapindex':
        if profondeur > 2:
            return sortie
        for sm in racine.findall('s:sitemap', NS_SITEMAP):
            loc = sm.findtext('s:loc', default='', namespaces=NS_SITEMAP)
            if loc:
                sortie.extend(_urls_sitemap(reseau, loc, profondeur + 1))
    else:
        for u in racine.findall('s:url', NS_SITEMAP):
            loc = u.findtext('s:loc', default='', namespaces=NS_SITEMAP)
            lastmod = u.findtext('s:lastmod', default='', namespaces=NS_SITEMAP)
            if loc:
                sortie.append((loc, lastmod or ''))
    return sortie


def _decouvrir_par_sitemap(site, reseau, depuis):
    """[(url, lastmod)] : lastmod (peut être '') est reporté tel quel dans date_source."""
    urls = _urls_sitemap(reseau, site['sitemap_url'])
    motif = site['motif_url']
    sortie = []
    for loc, lastmod in urls:
        if not motif.match(loc):
            continue
        # pas de lastmod : on ne peut pas prouver que la page n'a pas changé -> on la garde.
        if lastmod and lastmod[:10] < depuis:
            continue
        sortie.append((loc, lastmod))
    return sortie


# ---------------------------------------------------------------------------
# Découverte HEP Vaud (hepl.ch) : pas de sitemap utilisable, page en cascade
# (projets-et-expertises -> une page par unité -> une page par projet), tout en HTML statique.
# ---------------------------------------------------------------------------

def _decouvrir_hepvd(site, reseau, depuis):
    racine = 'https://www.hepl.ch'
    page = reseau.get_texte(site['sitemap_url'])  # ici : la page « projets-et-expertises »
    unites = sorted(set(re.findall(
        r'href="(/accueil/[^"]*/projets-de-recherche(?:/tous-les-projets-de-recherche)?\.html)"',
        page)))
    sortie = []
    for chemin in unites:
        page_unite = reseau.get_texte(racine + chemin)
        base = chemin.rsplit('/projets-de-recherche', 1)[0] + '/projets-de-recherche/'
        for m in re.finditer(r'href="(' + re.escape(base) + r'[^"/]+\.html)"', page_unite):
            sortie.append(racine + m.group(1))
    # Ces pages de liste ne portent pas de date : pas de filtrage `depuis` (contrairement aux
    # sites à sitemap), et pas de lastmod pour date_source.
    return [(url, '') for url in sorted(set(sortie))]


# ---------------------------------------------------------------------------
# Analyse d'une page projet HfH (www.hfh.ch)
# ---------------------------------------------------------------------------

def _mmyyyy_vers_iso(brut):
    m = re.match(r'^(\d{1,2})\.(\d{4})$', (brut or '').strip())
    if m:
        return f'{m.group(2)}-{int(m.group(1)):02d}'
    return (brut or '').strip()


def _noms_entity_label(fragment):
    return [texte_simple(m) for m in re.findall(r'entity-label"><span>(.*?)</span>', fragment, re.S)]


def _analyser_hfh(page, url):
    manques = []
    titre = texte_simple(capturer(page, r'<h1[^>]*>(.*?)</h1>', dotall=True) or '')
    if not titre or titre == 'Anmelden':
        manques.append("aucun contenu de projet (page protégée par connexion, redirection vers /user/login ?)")
        return dict(title='', langue='', institutions='', debut='', fin='', descriptif='', manques=manques)
    lang = capturer(page, r'<html[^>]*\blang="([a-z]{2})"') or 'de'
    lead = capturer_div(page, r'field--name-field-lead-paragraph.*?<div class="field-content">')
    descriptif = texte_paragraphes(lead) if lead else ''
    if not lead:
        manques.append('champ lead-paragraph (Ausgangslage und Ziele) absent')
    debut = _mmyyyy_vers_iso(capturer(page, r'field--name-field-start-date[^>]*>([^<]*)</div>'))
    fin = _mmyyyy_vers_iso(capturer(page, r'field--name-field-end-date[^>]*>([^<]*)</div>'))
    coop = capturer_div(page, r'<div class="cooperations">')
    partenaires = _noms_entity_label(coop) if coop else []
    institutions = ', '.join(['Interkantonale Hochschule für Heilpädagogik, HfH'] + partenaires)
    return dict(title=titre, langue=lang, institutions=institutions, debut=debut, fin=fin,
                descriptif=descriptif, manques=manques)


# ---------------------------------------------------------------------------
# Analyse d'une page projet PHBern (www.phbern.ch)
# ---------------------------------------------------------------------------

def _analyser_phbern(page, url):
    manques = []
    titre = texte_simple(capturer(page, r'<h1[^>]*>(.*?)</h1>', dotall=True) or '')
    lang = capturer(page, r'<html[^>]*\blang="([a-z]{2})"') or 'de'
    lead = capturer_div(page, r'class="grid__item lg-w-9/10 text-large">')
    descriptif = texte_paragraphes(lead) if lead else ''
    if not descriptif:
        manques.append('dossier__lead vide sur cette page (aucun résumé publié actuellement)')
    laufzeit = capturer(
        page,
        r'double-field__item--first">\s*Laufzeit\s*</div>\s*<div class="double-field__item double-field__item--second">(.*?)</div>\s*</div>',
        dotall=True)
    debut = fin = ''
    if laufzeit:
        dates = re.findall(r'datetime="(\d{4}-\d{2}-\d{2})', laufzeit)
        if dates:
            debut = dates[0]
        if len(dates) > 1:
            fin = dates[1]
    else:
        manques.append('champ Laufzeit absent')
    coop = capturer(
        page,
        r'double-field__item--first">\s*Kooperationen\s*</div>\s*<div class="double-field__item double-field__item--second[^"]*">(.*?)</div>\s*</div>\s*</div>',
        dotall=True)
    # Kooperationen : « personne, institution ; … ». Seule l'institution reconnue est gardée, la chaîne brute jamais.
    partenaires, retirees = institutions.depuis_couples(texte_simple(coop).split(';') if coop else [])
    vus = []
    for nom in ['Pädagogische Hochschule Bern'] + partenaires:
        if nom not in vus:
            vus.append(nom)
    return dict(title=titre, langue=lang, institutions=', '.join(vus), debut=debut, fin=fin,
                descriptif=descriptif, manques=manques, institutions_retirees=len(retirees))


# ---------------------------------------------------------------------------
# Analyse d'une page projet EHB (www.ehb.swiss)
# ---------------------------------------------------------------------------

def _analyser_ehb(page, url):
    manques = []
    titre = texte_simple(capturer(page, r'<h1[^>]*>(.*?)</h1>', dotall=True) or '')
    lang = capturer(page, r'<html[^>]*\blang="([a-z]{2})"') or 'de'
    debut = fin = ''
    # Deux motifs distincts : un 2e <time> optionnel dans la même regex serait sauté par le
    # quantificateur paresseux, qui réussit sans le chercher.
    m = re.search(r'field-label">Datum</div>\s*<div class="field-value">\s*'
                  r'<time datetime="(\d{4}-\d{2}-\d{2})[^"]*">.*?'
                  r'<time datetime="(\d{4}-\d{2}-\d{2})[^"]*">', page, re.S)
    if m:
        debut, fin = m.group(1), m.group(2)
    else:
        m1 = re.search(r'field-label">Datum</div>\s*<div class="field-value">\s*'
                        r'<time datetime="(\d{4}-\d{2}-\d{2})[^"]*">', page, re.S)
        if m1:
            debut = m1.group(1)
        else:
            manques.append('champ Datum absent')
    desc = capturer_div(page, r'field-project-description field-value">')
    descriptif = texte_paragraphes(desc) if desc else ''
    if not descriptif:
        manques.append('champ field-project-description absent')
    institutions = 'Eidgenössische Hochschule für Berufsbildung, EHB'
    return dict(title=titre, langue=lang, institutions=institutions, debut=debut, fin=fin,
                descriptif=descriptif, manques=manques)


# ---------------------------------------------------------------------------
# Analyse d'une page projet PHSG (www.phsg.ch)
# ---------------------------------------------------------------------------

def _analyser_phsg(page, url):
    manques = []
    titre = texte_simple(capturer(page, r'<h1[^>]*>(.*?)</h1>', dotall=True) or '')
    lang = capturer(page, r'<html[^>]*\blang="([a-z]{2})"') or 'de'
    laufzeit = capturer(page, r'<td[^>]*>Laufzeit</td>\s*<td[^>]*>([^<]*)</td>')
    debut = fin = ''
    if laufzeit:
        m = re.match(r'\s*(\d{1,2}\.\d{4}|\d{4})\s*bis\s*(\d{1,2}\.\d{4}|\d{4})', laufzeit)
        if m:
            debut = _mmyyyy_vers_iso(m.group(1)) if '.' in m.group(1) else m.group(1)
            fin = _mmyyyy_vers_iso(m.group(2)) if '.' in m.group(2) else m.group(2)
    else:
        manques.append('champ Laufzeit absent')
    # Corps de texte : blocs "field--name-field-text" (paragraphes), gabarit partagé avec d'autres
    # pages (image, teaser, tableau de contact...) : ne garder que les blocs assez longs pour être
    # du texte de présentation, pas une légende d'image ou une puce de menu.
    blocs = capturer_div_tous(page, r'clearfix text-formatted field field--name-field-text[^"]*field__item">')
    retenus = [texte_paragraphes(b) for b in blocs if len(texte_simple(b)) > 150]
    # le premier bloc assez long est le corps de page (Ausgangslage/Kurzbeschreibung...) ; les
    # suivants sont la barre latérale « Auf einen Blick » et le pied de page, pas le descriptif.
    descriptif = retenus[0] if retenus else ''
    # un bloc « hero » répète parfois le titre puis une légende d'image avant le vrai texte.
    paragraphes = descriptif.split('\n\n')
    while paragraphes and paragraphes[0].strip() in (titre.strip(), 'Bild', ''):
        paragraphes.pop(0)
    descriptif = '\n\n'.join(paragraphes)
    if not descriptif:
        manques.append('aucun bloc field--name-field-text assez long trouvé (corps de page vide ou gabarit différent)')
    institutions = 'Pädagogische Hochschule St. Gallen'
    return dict(title=titre, langue=lang, institutions=institutions, debut=debut, fin=fin,
                descriptif=descriptif, manques=manques)


# ---------------------------------------------------------------------------
# Analyse d'une page projet PH FHNW (www.fhnw.ch/de/ph/...)
# ---------------------------------------------------------------------------

_MOIS_DE = {
    'januar': 1, 'februar': 2, 'märz': 3, 'april': 4, 'mai': 5, 'juni': 6,
    'juli': 7, 'august': 8, 'september': 9, 'oktober': 10, 'november': 11, 'dezember': 12,
}


def _date_textuelle_de(brut):
    """« 1. Juli 2021 » -> « 2021-07-01 » ; None si non reconnu."""
    m = re.match(r'(\d{1,2})\.\s*([A-Za-zäöü]+)\s*(\d{4})', (brut or '').strip())
    if not m:
        return None
    mois = _MOIS_DE.get(m.group(2).lower())
    if not mois:
        return None
    return f'{m.group(3)}-{mois:02d}-{int(m.group(1)):02d}'


def _analyser_phfhnw(page, url):
    manques = []
    titre_brut = capturer(page, r'<h1[^>]*>(.*?)</h1>', dotall=True) or ''
    # le <h1> répète parfois « , Pädagogische Hochschule FHNW » dans un <small> : le retirer.
    titre_brut = re.sub(r'<small[^>]*>.*?</small>', '', titre_brut, flags=re.S)
    titre = texte_simple(titre_brut)
    lang = capturer(page, r'<html[^>]*\blang="([a-z]{2})"') or 'de'
    champs = {}
    for m in re.finditer(r'info__key">([^<]*)</dt><dd class="info__value"><div>(.*?)</div></dd>', page, re.S):
        champs[texte_simple(m.group(1))] = texte_simple(m.group(2))
    # Laufzeit : « 2021 – 2024 » ou « 1. Juli 2021 – 30. Juni 2024 » se lisent ; toute autre forme d'un côté
    # (« September 2022 », « 1.4.2020 ») reste vide et part en *_brut, que l'export signale avec une suggestion.
    laufzeit = champs.get('Laufzeit', '')
    debut_brut, fin_brut = couper_duree(laufzeit)
    debut, debut_brut = _cote_phfhnw(debut_brut)
    fin, fin_brut = _cote_phfhnw(fin_brut)
    if not laufzeit:
        manques.append('champ Laufzeit absent')
    elif debut_brut or fin_brut:
        manques.append('Laufzeit d\'une autre forme : gardée dans debut_brut / fin_brut')
    ecole = 'Pädagogische Hochschule FHNW'
    # Partner : « personne, institution / … », ou un morceau seul : seule une institution reconnue est gardée.
    partenaires, retirees = institutions.depuis_couples(champs.get('Partner', '').split('/'))
    vus = []
    for nom in [ecole] + partenaires:
        if nom not in vus:
            vus.append(nom)
    contenu = capturer(page, r'page__section-content">\s*<p>(.*?)</p>', dotall=True)
    descriptif = texte_paragraphes(contenu) if contenu else ''
    if not descriptif:
        manques.append('aucun paragraphe trouvé dans page__section-content')
    return dict(title=titre, langue=lang, institutions=', '.join(vus), debut=debut, fin=fin,
                descriptif=descriptif, manques=manques, institutions_retirees=len(retirees),
                debut_brut=debut_brut, fin_brut=fin_brut)


def _cote_phfhnw(brut):
    """(valeur, brut gardé) pour un côté d'une durée PH FHNW : une année ou une date allemande en toutes lettres se
    lisent ; une fin ouverte reste vide sans brut ; toute autre forme reste vide, son texte gardé."""
    brut = (brut or '').strip()
    if re.fullmatch(r'\d{4}', brut):
        return brut, ''
    d = _date_textuelle_de(brut)
    if d:
        return d, ''
    if fin_ouverte(brut):
        return '', ''
    return '', brut


# ---------------------------------------------------------------------------
# Analyse d'une page projet PHZH (phzh.ch) — la découverte est indisponible (voir SITES),
# mais l'analyse d'une page déjà connue fonctionne et est testée.
# ---------------------------------------------------------------------------

def _analyser_phzh(page, url):
    manques = []
    titre = texte_simple(capturer(page, r'<h1 class="phzh-page-header__title[^"]*">(.*?)</h1>', dotall=True) or '')
    if not titre:
        manques.append('titre introuvable (h1 phzh-page-header__title absent)')
    lang = capturer(page, r'<html[^>]*\blang="([a-z]{2})"') or 'de'
    steckbrief = capturer(page, r'<h2>Steckbrief</h2>\s*<dl[^>]*>(.*?)</dl>', dotall=True) or ''
    champs = {}
    for m in re.finditer(r'phzh-char-list__term">([^<]*)</dt>\s*<dd class="phzh-char-list__description">(.*?)</dd>',
                          steckbrief, re.S):
        champs[texte_simple(m.group(1))] = texte_simple(m.group(2))
    debut = fin = ''
    phase = champs.get('Projektphase', '')
    m = re.search(r'(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})', phase)
    if m:
        debut = f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}'
        fin = f'{m.group(6)}-{int(m.group(5)):02d}-{int(m.group(4)):02d}'
    elif phase:
        manques.append(f"Projektphase non reconnue: {phase!r}")
    else:
        manques.append('champ Projektphase absent')
    partenaires = [p.strip() for p in champs.get('Beteiligte Institutionen', '').split(';') if p.strip()]
    vus = []
    for nom in ['Pädagogische Hochschule Zürich'] + partenaires:
        if nom not in vus:
            vus.append(nom)
    beschreibung = capturer(page, r'<h2>Beschreibung</h2>\s*<p>(.*?)</p>\s*(?:<h2>|$)', dotall=True)
    descriptif = texte_paragraphes(beschreibung) if beschreibung else ''
    if not descriptif:
        manques.append('section Beschreibung absente')
    return dict(title=titre, langue=lang, institutions=', '.join(vus), debut=debut, fin=fin,
                descriptif=descriptif, manques=manques)


# ---------------------------------------------------------------------------
# Analyse d'une page projet HEP Vaud (www.hepl.ch) — gabarit sans champ de dates/partenaires
# structuré repéré ; au mieux, résumé + corps de texte.
# ---------------------------------------------------------------------------

def _analyser_hepvd(page, url):
    manques = ['aucun champ de dates ni de partenaires repéré sur ce gabarit : institutions = école '
               'propriétaire seule, dates vides']
    titre = texte_simple(capturer(page, r'<h1[^>]*>(.*?)</h1>', dotall=True) or '')
    lang = capturer(page, r'<html[^>]*\blang="([a-z]{2})"') or 'fr'
    lead = capturer(page, r'standard-text-lead">(.*?)</div>', dotall=True)
    prose = re.findall(r'class="prose">(.*?)</div>', page, re.S)
    morceaux = ([lead] if lead else []) + prose
    descriptif = texte_paragraphes('\n\n'.join(morceaux)) if morceaux else ''
    if not descriptif:
        manques.append('aucun texte (standard-text-lead / prose) trouvé')
    return dict(title=titre, langue=lang, institutions='Haute école pédagogique du canton de Vaud, HEP Vaud',
                debut='', fin='', descriptif=descriptif, manques=manques)


# ---------------------------------------------------------------------------
# Table des sites
# ---------------------------------------------------------------------------

SITES = {
    'hfh': dict(
        libelle='HfH',
        actif=True,
        decouverte='sitemap',
        sitemap_url='https://www.hfh.ch/sitemap.xml',
        motif_url=re.compile(r'^https://www\.hfh\.ch/projekt/[^/]+/?$'),
        analyser=_analyser_hfh,
    ),
    'phbern': dict(
        libelle='PHBern',
        actif=True,
        decouverte='sitemap',
        sitemap_url='https://www.phbern.ch/sitemap.xml',
        motif_url=re.compile(r'^https?://(www\.)?phbern\.ch/forschung/projekte/[^/]+/?$'),
        analyser=_analyser_phbern,
    ),
    'phsg': dict(
        libelle='PH St. Gallen',
        actif=True,
        decouverte='sitemap',
        sitemap_url='https://www.phsg.ch/de/sitemap.xml',
        motif_url=re.compile(r'^https://www\.phsg\.ch/de/forschung-entwicklung/projekte/[^/]+/?$'),
        analyser=_analyser_phsg,
    ),
    'ehb': dict(
        libelle='EHB',
        actif=True,
        decouverte='sitemap',
        sitemap_url='https://www.ehb.swiss/sitemap.xml',
        motif_url=re.compile(r'^https://www\.ehb\.swiss/forschung/projekte/[^/]+/?$'),
        analyser=_analyser_ehb,
    ),
    'phzh': dict(
        libelle='PH Zürich',
        actif=False,
        raison=("la page de liste (.../themen-und-taetigkeiten/projekte/ et "
                ".../forschungsprojekte/) est un widget Angular/Blazor Server piloté par "
                "SignalR (data-ng-controller sur phlu, data-component=\"PhzhControl\"/PhzhSelect "
                "sans attribut name sur phzh) : la recherche affiche « 0 Treffer » sans "
                "JavaScript, aucun paramètre GET ne renvoie de résultats, et le site n'a ni "
                "sitemap.xml ni flux RSS, ni point d'accès JSON (constaté le 24.09.2026). La page de "
                "détail, elle, est un HTML statique normal : "
                "l'analyseur est écrit et testé (voir tests), seule l'énumération manque."),
        decouverte='indisponible',
        analyser=_analyser_phzh,
    ),
    'phfhnw': dict(
        libelle='PH FHNW',
        actif=True,
        decouverte='sitemap',
        sitemap_url='https://www.fhnw.ch/sitemap-index.xml',
        motif_url=re.compile(r'^https://www\.fhnw\.ch/de/ph/forschung-entwicklung/forschung/projekte/[^/]+/?$'),
        analyser=_analyser_phfhnw,
    ),
    'phlu': dict(
        libelle='PH Luzern',
        actif=False,
        raison=("le sitemap ne référence qu'une page d'index (/forschung/projekte.html), pas de "
                "pages de détail par projet ; cette page liste les projets via un template "
                "AngularJS (data-ng-app=\"PhluCorporateApp\", contrôleur PpdbCtrl) alimenté par "
                "Firebase Realtime Database (https://phlu-neos-002.firebaseio.com), qui répond "
                "401 Unauthorized sans jeton valide. Mesuré le 24.09.2026. Aucune énumération "
                "HTTP simple possible sans reproduire l'authentification de cette base."),
        decouverte='indisponible',
        analyser=None,
    ),
    'hepvd': dict(
        libelle='HEP Vaud',
        actif=True,
        decouverte='cascade_html',
        sitemap_url='https://www.hepl.ch/accueil/recherche/activites-de-recherche/projets-et-expertises.html',
        analyser=_analyser_hepvd,
        note=("Le domaine réel de « HEP Vaud » est hepl.ch (hepvd.ch et hep-vd.ch ne résolvent "
              "pas). Pas de sitemap exploitable (sitemap.txt existe mais est vide, "
              "Content-Length: 0, mesuré le 24.09.2026). Découverte : la page "
              "projets-et-expertises.html renvoie vers une page de liste par unité "
              "d'enseignement et de recherche (ex. pedagogie-specialisee-ps), qui elle liste "
              "les pages projet individuelles — tout en HTML statique, sans JavaScript. Pas de "
              "date de modification disponible : le filtre `depuis` ne s'applique pas ici."),
    ),
    'hepbejune': dict(
        libelle='HEP-BEJUNE',
        actif=False,
        raison=("le sitemap (Sitemap: référencé dans robots.txt) ne contient aucune page de type "
                "« projet » : la recherche y est publiée par personne "
                "(/Personnel-academique/<nom>/Activites-de-recherche/), sans page dédiée par "
                "projet. Mesuré le 24.09.2026 sur le sitemap complet en français."),
        decouverte='indisponible',
        analyser=None,
    ),
    'hepfr': dict(
        libelle='HEP Fribourg',
        actif=False,
        raison=("www.hepfr.ch présente un certificat TLS invalide pour ce domaine "
                "(CN=preview.infomaniak.website au lieu de www.hepfr.ch) et répond 503 Service "
                "unavailable même sans vérification TLS ; pas de domaine de repli trouvé "
                "(hep-fr.ch ne résout pas). Mesuré le 24.09.2026. Contourner la vérification "
                "TLS pour un usage régulier serait imprudent : site laissé désactivé."),
        decouverte='indisponible',
        analyser=None,
    ),
}


def _decouvrir(nom, site, reseau, depuis):
    if site['decouverte'] == 'sitemap':
        return _decouvrir_par_sitemap(site, reseau, depuis)
    if site['decouverte'] == 'cascade_html':
        return _decouvrir_hepvd(site, reseau, depuis)
    return []


def _projet_depuis_page(nom, url, page, site, lastmod):
    champs = site['analyser'](page, url)
    manques = champs.pop('manques', [])
    extra = {}
    if manques:
        extra['manques'] = manques
    # durée d'une autre forme et nombre de partenaires retirés (jamais leurs noms) : lus par l'export.
    for cle in ('debut_brut', 'fin_brut', 'institutions_retirees'):
        valeur = champs.pop(cle, None)
        if valeur:
            extra[cle] = valeur
    return Projet(
        source=f'site:{nom}', source_id=url, url=url,
        title=champs['title'], langue=champs['langue'], institutions=champs['institutions'],
        debut=champs['debut'], fin=champs['fin'], descriptif=champs['descriptif'],
        date_source=lastmod, extra=extra,
    )


def moissonner(config, reseau, connus):
    demandes = list(config.get('liste', []))
    site_unique = config.get('site')
    if site_unique:
        demandes = [site_unique]
    depuis = config.get('depuis', '2024-01-01')
    for nom in demandes:
        site = SITES.get(nom)
        if site is None:
            print(f"sites: site inconnu ignoré : {nom}", file=sys.stderr)
            continue
        if not site.get('actif', False):
            print(f"sites: {nom} désactivé — {site.get('raison', 'raison non précisée')}", file=sys.stderr)
            continue
        try:
            urls = _decouvrir(nom, site, reseau, depuis)
        except (_ECHEC_RESEAU, ET.ParseError) as exc:
            print(f"sites: découverte de {nom} en échec ({exc}) — site ignoré pour cette moisson", file=sys.stderr)
            continue
        echecs_de_suite = 0
        for url, lastmod in urls:
            if url in connus:
                continue
            try:
                page = _html.unescape(reseau.get_texte(url, detail=True))
                echecs_de_suite = 0
                yield _projet_depuis_page(nom, url, page, site, lastmod)
            except Refus403Page:
                continue        # page refusée : sautée, tout la signale
            except _ECHEC_RESEAU as exc:
                print(f"sites: {nom} : échec sur {url} ({exc})", file=sys.stderr)
                # Un site en panne (429 persistant, erreurs réseau) n'est pas martelé : on le quitte et
                # la prochaine moisson reprend là, les pages échouées n'étant pas en base.
                echecs_de_suite += 1
                if echecs_de_suite >= ECHECS_AVANT_ABANDON:
                    print(f"sites: {nom} abandonné pour cette moisson après {echecs_de_suite} échecs de suite", file=sys.stderr)
                    break
                continue
