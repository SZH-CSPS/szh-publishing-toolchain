"""Dates d'un projet : saisie `date_partielle` du contrat (AAAA, AAAA-MM ou AAAA-MM-JJ), suggestion pour une autre forme,
fin ouverte, durée « début – fin » coupée en deux."""
import datetime
import re
import unicodedata

RE_PARTIELLE = re.compile(r'^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$')

_MOIS = {
    'januar': 1, 'jan': 1, 'janvier': 1, 'january': 1, 'februar': 2, 'feb': 2, 'fevrier': 2, 'february': 2,
    'marz': 3, 'maerz': 3, 'mars': 3, 'march': 3, 'april': 4, 'avril': 4, 'mai': 5, 'may': 5, 'juni': 6, 'juin': 6,
    'june': 6, 'juli': 7, 'juillet': 7, 'july': 7, 'august': 8, 'aug': 8, 'aout': 8, 'september': 9, 'sept': 9,
    'septembre': 9, 'oktober': 10, 'okt': 10, 'octobre': 10, 'october': 10, 'november': 11, 'nov': 11, 'novembre': 11,
    'dezember': 12, 'dez': 12, 'decembre': 12, 'december': 12,
}
_OUVERTES = {'', 'offen', 'laufend', 'fortlaufend', 'unbefristet', 'heute', 'en cours', 'ouvert', 'ouverte', 'ongoing',
             'open', 'present', 'today', '…', '...', '?'}


def _plat(texte):
    s = unicodedata.normalize('NFD', str(texte or '').lower())
    return ''.join(c for c in s if not unicodedata.combining(c))


def _iso(annee, mois, jour=None):
    try:
        d = datetime.date(int(annee), int(mois), int(jour or 1))
    except ValueError:
        return ''
    return d.isoformat() if jour else d.isoformat()[:7]


def valide(valeur):
    """Vrai si `valeur` respecte la saisie date_partielle, calendrier compris."""
    m = RE_PARTIELLE.match(str(valeur or ''))
    if not m:
        return False
    if m.group(2) is None:
        return True
    return bool(_iso(m.group(1), m.group(2), m.group(3)))


def _suggestion(brut):
    s = _plat(' '.join(str(brut or '').split()))
    m = re.match(r'^(\d{4}-\d{2}-\d{2})[t ]', s)
    if m and valide(m.group(1)):
        return m.group(1)
    m = re.match(r'^(\d{1,2})\.?\s*([a-z]+)\.?\s+(\d{4})$', s)
    if m and m.group(2) in _MOIS:
        return _iso(m.group(3), _MOIS[m.group(2)], m.group(1))
    m = re.match(r'^([a-z]+)\.?\s+(\d{4})$', s)
    if m and m.group(1) in _MOIS:
        return _iso(m.group(2), _MOIS[m.group(1)])
    m = re.match(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})$', s)
    if m:
        return _iso(m.group(3), m.group(2), m.group(1))
    m = re.match(r'^(\d{1,2})[./](\d{4})$', s)
    if m:
        return _iso(m.group(2), m.group(1))
    return ''


def lire_date_partielle(brut):
    """(valeur conforme | '', suggestion | '') : une valeur n'est rendue que si elle respecte la saisie ; sinon une
    suggestion conforme quand la forme lue se ramène sûrement à une date (« September 2024 » donne 2024-09)."""
    s = str(brut or '').strip()
    if valide(s):
        return s, ''
    return '', _suggestion(s)


def fin_ouverte(brut):
    """Vrai pour une fin absente ou ouverte (« offen », « en cours »…) : `fin` reste vide, sans doute."""
    return _plat(str(brut or '').strip()).strip(' .') in _OUVERTES


def couper_duree(texte):
    """(début, fin) d'une durée « début – fin » telle que lue ; « seit 2024 » donne ('2024', '')."""
    t = ' '.join(str(texte or '').split())
    if not t:
        return '', ''
    m = re.match(r'^(?:seit|ab|dès|des|depuis|since|from)\s+(.+)$', t, re.I)
    if m:
        return m.group(1), ''
    m = re.match(r'^(\d{4})-(\d{4})$', t)
    if m:
        return m.group(1), m.group(2)
    morceaux = re.split(r'\s*[–—]\s*|\s+-\s+|\s+bis\s+|\s+au\s+|(?<=\d{4})-(?=[A-Za-zÄÖÜ])', t, maxsplit=1)
    return morceaux[0].strip(), (morceaux[1].strip() if len(morceaux) > 1 else '')
