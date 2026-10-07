"""Source SKBF-CSRE (bildungsforschung/datenbank) : pages de liste par numéro décroissant, puis détail des seuls numéros
inconnus. Les contraintes du site sont notées près des constantes."""
import html as _html
import re
import urllib.parse

from ..modele import Projet
from ..reseau import Refus403Page
from ._commun import texte_simple, texte_paragraphes, capturer

# Ce que le site impose :
# - `searchterm` est un OU de mots ; `sort=4` trie par numéro décroissant ;
# - `limit` est un décalage, pas une taille : 25 résultats par page, toujours ;
# - la page est en UTF-8 ; <html> n'a pas de lang et le détail est bilingue de/fr : la langue reste vide ;
# - un lien vers la page de l'école dans le résumé devient `url`, et le lien SKBF reste dans extra.
BASE = 'https://www.skbf-csre.ch'
URL_LISTE = BASE + '/bildungsforschung/datenbank/projektliste/'
URL_DETAIL = BASE + '/bildungsforschung/datenbank/projektdetail/'
TAILLE_PAGE = 25
MAX_PAGES = 80  # garde-fou (~2000 résultats) : évite une boucle infinie si le tri change

_LIGNE = re.compile(
    r'<tr><td valign="top" >(\d{2}:\d{3})</td>'
    r'<td valign="top" >(.*?)</td>'
    r'<td valign="top" ><a class="morelink" href="[^"]*[?&]_id=(\d+)[^"]*">',
    re.S)


def _termes_recherche(config):
    """Mots + institutions toujours pertinentes, dédoublonnés, comme pool OU."""
    global_ = config.get('_global', {})
    filtre = global_.get('filtre', {})
    pool = list(filtre.get('institutions_toujours', [])) + list(filtre.get('mots', []))
    vus = []
    for terme in pool:
        for mot in terme.split():
            if mot and mot not in vus:
                vus.append(mot)
    return vus


def _url_liste(termes, decalage):
    q = urllib.parse.urlencode({
        'no_cache': 1, 'searchmethod': 2, 'status': 'search', 'sort': 4,
        'searchterm': ' '.join(termes), 'limit': decalage,
    })
    return f'{URL_LISTE}?{q}'


def _parse_liste(page_html):
    """[(numero, id, titre)] dans l'ordre d'affichage (décroissant par numéro)."""
    texte = _html.unescape(page_html)
    return [(numero, id_, texte_simple(titre)) for numero, titre, id_ in _LIGNE.findall(texte)]


def _sections(texte):
    """{titre_h2_normalisé: contenu_html jusqu'au <h2> suivant}.

    Les <table> de cette page ne s'alignent pas de façon fiable sur les sections (parfois
    titre et contenu partagent une <table>, parfois pas) : découper sur les <h2> eux-mêmes,
    quelle que soit l'imbrication de tables, est la seule méthode robuste mesurée.
    """
    morceaux = re.split(r'<h2>(.*?)</h2>', texte, flags=re.S)
    sections = {}
    for i in range(1, len(morceaux), 2):
        titre = texte_simple(morceaux[i])
        sections[titre] = morceaux[i + 1] if i + 1 < len(morceaux) else ''
    return sections


def _champ_table(texte, libelle):
    """Valeur d'une ligne « libelle</span></b></td><td>valeur</td> » du bandeau du haut."""
    v = capturer(texte, re.escape(libelle) + r'</span></b></td><td>([^<]*)</td>')
    return (v or '').strip()


def _noms_liens(fragment):
    return [texte_simple(m) for m in re.findall(r'<a[^>]*>(.*?)</a>', fragment, re.S) if texte_simple(m)]


def _premier_lien_externe(fragment):
    for url in re.findall(r'href="(https?://[^"]+)"', fragment):
        if 'skbf-csre.ch' not in url:
            return url
    return ''


def _projet_depuis_detail(numero, id_, titre_liste, detail_html):
    texte = _html.unescape(detail_html)
    # des <tr> entiers sont parfois laissés en commentaire HTML (doublons de lien) : les retirer
    # avant toute extraction, sinon ils réapparaissent dans les institutions.
    texte = re.sub(r'<!--.*?-->', '', texte, flags=re.S)
    debut = _champ_table(texte, 'Beginn / Début')
    fin = _champ_table(texte, 'Ende / Fin')
    sections = _sections(texte)
    titre = texte_simple(sections.get('Titel, Thema / Titre, thématique', '')) or titre_liste
    institutions = ', '.join(_noms_liens(sections.get('Forschende Institution(en) / Institution(s) de recherche', '')))
    zusammenfassung = sections.get('Zusammenfassung', '')
    descriptif = texte_paragraphes(zusammenfassung)
    url_detail = f'{URL_DETAIL}?no_cache=1&_id={id_}'
    url_externe = _premier_lien_externe(zusammenfassung)
    extra = {'id_skbf': id_}
    if url_externe:
        url = url_externe
        extra['lien_skbf'] = url_detail
    else:
        url = url_detail
    if not institutions:
        extra.setdefault('manques', []).append('aucune institution de recherche listée')
    return Projet(
        source='skbf', source_id=numero, url=url, title=titre, langue='',
        institutions=institutions, debut=debut, fin=fin, descriptif=descriptif,
        date_source='', extra=extra,
    )


def moissonner(config, reseau, connus):
    depuis = config.get('depuis', '2024-01-01')
    seuil_aa = int(depuis[:4]) % 100
    termes = _termes_recherche(config)
    for page in range(MAX_PAGES):
        decalage = page * TAILLE_PAGE
        page_html = reseau.get_texte(_url_liste(termes, decalage))
        lignes = _parse_liste(page_html)
        if not lignes:
            break
        arret = False
        for numero, id_, titre in lignes:
            annee = int(numero.split(':')[0])
            if annee < seuil_aa:
                arret = True
                break
            if numero in connus:
                continue
            try:
                detail_html = reseau.get_texte(f'{URL_DETAIL}?no_cache=1&_id={id_}', detail=True)
            except Refus403Page:
                continue        # page refusée : sautée, tout la signale
            yield _projet_depuis_detail(numero, id_, titre, detail_html)
        if arret:
            break
