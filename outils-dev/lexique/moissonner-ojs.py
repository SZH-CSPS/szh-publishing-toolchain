#!/usr/bin/env python3
# Moissonne les articles publiés d'ojs.szh.ch (Revue et Zeitschrift) sur les deux dernières
# années, pour constituer un corpus de texte (lexique, Vale). Inventaire par OAI-PMH
# (oai_dc) et téléchargement des galleys (DOCX, sinon PDF), sans analyse. Bibliothèque
# standard seule ; se lance dans la WSL SZH-Publishing.
#
# `&from=` de ListRecords filtre la date de dernière modification en base, pas la date de
# publication : un article de 2018 peut avoir été modifié en 2022. Aucun `from` n'est donc
# envoyé ; tout est moissonné et filtré localement sur dc:date (comme
# commandeNumerosOjs de lib/secretariat.js).
#
# Le téléchargement d'une galley n'annonce pas de Content-Length (transfert par blocs) : un
# fichier en cache est gardé s'il dépasse SEUIL_FICHIER_VALIDE.
import argparse
import csv
import hashlib
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

HOTE_AUTORISE = 'ojs.szh.ch'
USER_AGENT = 'SZH-Publishing-lexique-ojs/1.0 (+depot szh-publishing-toolchain; redaction@csps.ch)'
PAUSE_DEFAUT_S = 1.0
ESSAIS_RESEAU = 5
DELAI_TOTAL_S = 60
# Un fichier en cache plus petit est retéléchargé : un vrai .docx ou .pdf d'article dépasse
# 1 Ko, un fichier plus petit vient d'une coupure.
SEUIL_FICHIER_VALIDE = 1024

NS = {
    'oai': 'http://www.openarchives.org/OAI/2.0/',
    'oai_dc': 'http://www.openarchives.org/OAI/2.0/oai_dc/',
    'dc': 'http://purl.org/dc/elements/1.1/',
    'xml': 'http://www.w3.org/XML/1998/namespace',
}

# Produit -> base OAI. Les deux revues d'une seule instance OJS (voir lib/secretariat.js,
# BASES_OAI) ; le préfixe de locale (fr/de) est celui que le serveur impose par redirection,
# fixé ici pour éviter un aller-retour 302 par page.
PRODUITS = {
    'Revue': 'https://ojs.szh.ch/index.php/revue/fr/oai',
    'Zeitschrift': 'https://ojs.szh.ch/index.php/zeitschrift/de/oai',
}

# Forme des DOI de la maison (voir vscodium-extension/szh-cockpit/lib/export-ojs.js,
# LETTRE_DOI) : lettre de revue, année, numéro à deux chiffres, rang dans le numéro.
DOI_RE = re.compile(r'^10\.57161/([rz])(\d{4})-(\d{2})-(\d{2})$')

# dc:source, tolérant fr/de : « Vol. 14 No 03 (2024): Titre; 32-43 » ou
# « Bd. 14 Nr. 03 (2024): Titre; 32-43 » (voir lib/secretariat.js, analyserSourceOjs).
SOURCE_RE = re.compile(
    r'(?:Bd\.|Vol\.)\s*(\d+)\s*,?\s*(?:Nr\.|No\.?)\s*(\d+)\s*(?:\((\d{4})\))?\s*:\s*(.*)$'
)
ISSN_RE = re.compile(r'\b(\d{4}-\d{3}[\dXx])\b')

FORMATS_GALLEY = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/pdf': 'pdf',
}


# ---- Réseau : une porte d'entrée unique, hôte restreint, pause imposée -------------------

class HoteRestreint(urllib.request.HTTPRedirectHandler):
    """N'autorise les redirections que vers ojs.szh.ch en https, comme resoudreRedirection()
    de lib/oai-pmh.js : un autre hôte (portail captif, DNS détourné) ne reçoit rien."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        cible = urlparse(newurl)
        if cible.hostname != HOTE_AUTORISE:
            raise urllib.error.URLError('redirection hors hôte refusée : ' + str(cible.hostname))
        if cible.scheme != 'https':
            raise urllib.error.URLError('redirection hors https refusée : ' + newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(HoteRestreint)
_DERNIERE_REQUETE = [0.0]


def _attendre_son_tour(pause_s):
    ecoule = time.monotonic() - _DERNIERE_REQUETE[0]
    if ecoule < pause_s:
        time.sleep(pause_s - ecoule)


def ouvrir(url, pause_s):
    """Une requête à la fois : attend son tour, refuse un hôte hors ojs.szh.ch (HoteRestreint
    ne couvre que les redirections), retente sur un 503 ou une panne réseau (ESSAIS_RESEAU
    essais, délai croissant)."""
    depart = urlparse(url)
    if depart.hostname != HOTE_AUTORISE:
        raise RuntimeError('hôte de départ refusé (pas ' + HOTE_AUTORISE + ') : ' + url)
    dernier_err = None
    for essai in range(ESSAIS_RESEAU):
        _attendre_son_tour(pause_s)
        _DERNIERE_REQUETE[0] = time.monotonic()
        req = urllib.request.Request(url, headers={
            'User-Agent': USER_AGENT,
            'Accept': 'text/xml, application/xml, */*',
        })
        try:
            return _OPENER.open(req, timeout=DELAI_TOTAL_S)
        except urllib.error.HTTPError as e:
            dernier_err = e
            if e.code == 503 and essai < ESSAIS_RESEAU - 1:
                time.sleep(2 * (essai + 1))
                continue
            raise RuntimeError('HTTP ' + str(e.code) + ' sur ' + url) from e
        except urllib.error.URLError as e:
            dernier_err = e
            if essai < ESSAIS_RESEAU - 1:
                time.sleep(2 * (essai + 1))
                continue
    raise RuntimeError('échec réseau après ' + str(ESSAIS_RESEAU) + ' essais sur ' + url + ' : ' + str(dernier_err))


# ---- Moisson OAI-PMH (oai_dc), pagination complète, aucun `from` -------------------------

def moissonner_oai(base_url, pause_s, emettre):
    """Toutes les notices d'une revue, sans `from` (voir l'en-tête). Rend une liste
    d'éléments <record> (ElementTree)."""
    enregistrements = []
    url = base_url + '?verb=ListRecords&metadataPrefix=oai_dc'
    jetons_vus = set()
    page = 0
    PAGES_MAX = 200
    while True:
        page += 1
        if page > PAGES_MAX:
            raise RuntimeError('pagination OAI interrompue après ' + str(PAGES_MAX) + ' pages sur ' + base_url)
        emettre('page {} : {}'.format(page, url))
        with ouvrir(url, pause_s) as resp:
            brut = resp.read()
        racine = ET.fromstring(brut)
        erreur = racine.find('oai:error', NS)
        if erreur is not None:
            if erreur.get('code') == 'noRecordsMatch':
                break
            raise RuntimeError('OAI ' + str(erreur.get('code')) + ' sur ' + base_url + ' : ' + (erreur.text or ''))
        liste = racine.find('oai:ListRecords', NS)
        if liste is None:
            break
        for rec in liste.findall('oai:record', NS):
            enregistrements.append(rec)
        emettre('  {} notice(s) cumulée(s)'.format(len(enregistrements)))
        jeton_el = liste.find('oai:resumptionToken', NS)
        jeton = (jeton_el.text or '').strip() if jeton_el is not None else ''
        if jeton == '':
            break
        if jeton in jetons_vus:
            raise RuntimeError('resumptionToken répété sur ' + base_url)
        jetons_vus.add(jeton)
        url = base_url + '?verb=ListRecords&resumptionToken=' + _quote(jeton)
    return enregistrements


def _quote(s):
    from urllib.parse import quote
    return quote(s, safe='')


# ---- Décodage d'une notice oai_dc ---------------------------------------------------------

def _textes_lang(dc_el, balise):
    """{lang: texte} pour une balise répétée avec xml:lang ; '' si l'attribut est absent.
    Première occurrence gardée par langue, comme partout ailleurs dans le cockpit."""
    sortie = {}
    for el in dc_el.findall('dc:' + balise, NS):
        lang = el.get('{http://www.w3.org/XML/1998/namespace}lang', '')
        if lang and lang not in sortie:
            sortie[lang] = (el.text or '').strip()
    return sortie


def _textes_bruts(dc_el, balise):
    return [(el.text or '').strip() for el in dc_el.findall('dc:' + balise, NS)]


def analyser_source(texte):
    m = SOURCE_RE.search(texte)
    if not m:
        return None
    volume, numero, annee, reste = m.group(1), m.group(2), m.group(3) or '', m.group(4).strip()
    return {'volume': volume, 'numero': numero, 'annee': annee, 'titre': reste}


def deux_chiffres(valeur):
    chiffres = re.sub(r'\D+', '', str(valeur))
    if chiffres == '':
        return ''
    return chiffres if len(chiffres) > 2 else chiffres.zfill(2)


def decoder_record(record_el, produit):
    header = record_el.find('oai:header', NS)
    supprime = header.get('status') == 'deleted'
    identifiant = (header.findtext('oai:identifier', default='', namespaces=NS) or '').strip()
    article_id = identifiant.rsplit('/', 1)[-1] if '/' in identifiant else identifiant
    if supprime:
        return {'supprime': True, 'article_id': article_id}

    metadata = record_el.find('oai:metadata', NS)
    dc = metadata.find('oai_dc:dc', NS) if metadata is not None else None
    if dc is None:
        return {'supprime': True, 'article_id': article_id}  # notice sans métadonnées : rien à en tirer

    titres = _textes_lang(dc, 'title')
    langue = (dc.findtext('dc:language', default='', namespaces=NS) or '').strip().lower()[:2]
    date_pub = (dc.findtext('dc:date', default='', namespaces=NS) or '').strip()

    identifiers = _textes_bruts(dc, 'identifier')
    doi = ''
    for v in identifiers:
        nu = re.sub(r'^https?://(dx\.)?doi\.org/', '', v, flags=re.I)
        if re.match(r'^10\.\d{4,9}/', nu):
            doi = nu
            break

    sources = _textes_bruts(dc, 'source')
    issn = ''
    source = None
    for s in sources:
        m = ISSN_RE.search(s)
        if m and not issn:
            issn = m.group(1)
        parsed = analyser_source(s)
        if parsed and not source:
            source = parsed

    formats = _textes_bruts(dc, 'format')
    relations = _textes_bruts(dc, 'relation')
    galleys = {}  # 'docx'|'pdf' -> url, premier trouvé gardé (même règle que decoderRecordOai)
    for url, fmt in zip(relations, formats):
        ext = FORMATS_GALLEY.get(fmt)
        if ext and ext not in galleys:
            galleys[ext] = url

    # Auteurs : ceux de la langue de l'article, car l'OAI répète les noms dans chaque langue
    # de métadonnées ; à défaut, la première langue rencontrée.
    creators_par_lang = {}
    for el in dc.findall('dc:creator', NS):
        lang = el.get('{http://www.w3.org/XML/1998/namespace}lang', '')
        creators_par_lang.setdefault(lang, []).append((el.text or '').strip())
    if langue in creators_par_lang:
        auteurs = creators_par_lang[langue]
    elif creators_par_lang:
        auteurs = next(iter(creators_par_lang.values()))
    else:
        auteurs = []

    mDoi = DOI_RE.match(doi)
    annee = (source and source['annee']) or ''
    numero = deux_chiffres(source['numero']) if source else ''
    revue_lettre = ''
    if mDoi:
        revue_lettre = mDoi.group(1)
        annee = mDoi.group(2)
        numero = mDoi.group(3)
    # Un DOI non substitué (« 10.57161/r2026-03-%x ») et un dc:source sans année peuvent
    # coexister : l'année vient alors de dc:date plutôt que de valoir « 0000 ».
    if not annee and date_pub:
        m_annee_date = re.match(r'^(\d{4})', date_pub)
        if m_annee_date:
            annee = m_annee_date.group(1)

    titre = titres.get(langue) or (next(iter(titres.values())) if titres else '') or article_id

    return {
        'supprime': False, 'article_id': article_id, 'produit': produit,
        'titre': titre, 'langue': langue, 'date_pub': date_pub, 'doi': doi,
        'annee': annee, 'numero': numero, 'issn': issn, 'auteurs': auteurs,
        'galleys': galleys, 'revue_lettre': revue_lettre,
        'url_source': 'https://ojs.szh.ch/index.php/' + ('revue' if produit == 'Revue' else 'zeitschrift') +
                       '/article/view/' + article_id,
    }


# ---- Fenêtre de dates, sans le `from` de l'OAI (voir l'en-tête) --------------------------

def date_pub_comparable(art):
    """Une date comparable pour le filtre de fenêtre, ou None. Sans dc:date, l'année seule
    (source ou DOI) vaut 1er janvier : l'année entière entre dans la fenêtre, et
    marquer_dans_fenetre le signale si cela change le verdict."""
    if art['date_pub']:
        m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', art['date_pub'])
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3))), True
            except ValueError:
                pass
        m2 = re.match(r'^(\d{4})$', art['date_pub'])
        if m2:
            return date(int(m2.group(1)), 1, 1), False
    if art['annee'] and re.match(r'^\d{4}$', art['annee']):
        return date(int(art['annee']), 1, 1), False
    return None, False


def dans_fenetre(art, depuis, jusqua, avertir):
    d, precise = date_pub_comparable(art)
    if d is None:
        avertir(art['produit'] + '/' + art['article_id'] + ' : aucune date exploitable (ni dc:date, ni source, ni DOI), écarté')
        return False
    if not precise:
        avertir(art['produit'] + '/' + art['article_id'] +
                 " : date réduite au 1er janvier de l'année (dc:date absent ou non conforme), fenêtre approximative")
    return depuis <= d <= jusqua


# ---- Nom de fichier -----------------------------------------------------------------------

def ascii_slug(texte, longueur_max=60):
    t = unicodedata.normalize('NFD', texte)
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    t = re.sub(r'[^A-Za-z0-9]+', '-', t).strip('-').lower()
    return (t[:longueur_max].rstrip('-')) or 'sans-titre'


# ---- Téléchargement d'une galley -----------------------------------------------------------

def telecharger_galley(url, dest, pause_s):
    """Rend (octets, sha256) ; lève sur échec. Écrit en flux, sans charger tout le fichier
    en mémoire, comme recupererHttps (lib/oai-pmh.js)."""
    OCTETS_MAX = 200 * 1024 * 1024
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name('~$' + dest.name)
    hach = hashlib.sha256()
    total = 0
    with ouvrir(url, pause_s) as resp:
        with open(tmp, 'wb') as f:
            while True:
                morceau = resp.read(1 << 16)
                if not morceau:
                    break
                total += len(morceau)
                if total > OCTETS_MAX:
                    raise RuntimeError('galley démesurée (> ' + str(OCTETS_MAX) + ' octets) : ' + url)
                hach.update(morceau)
                f.write(morceau)
    tmp.replace(dest)
    return total, hach.hexdigest()


def galley_en_cache(dest):
    return dest.exists() and dest.stat().st_size >= SEUIL_FICHIER_VALIDE


def sha256_fichier(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        while True:
            morceau = f.read(1 << 16)
            if not morceau:
                break
            h.update(morceau)
    return h.hexdigest()


# ---- Programme principal -------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Moissonne les articles publiés d'ojs.szh.ch pour le corpus du lexique.")
    p.add_argument('--depuis', default='2024-09-01', help='date de départ AAAA-MM-JJ (défaut 2024-09-01)')
    p.add_argument('--vers', default='tmp/corpus-ojs', help='dossier de sortie (défaut tmp/corpus-ojs)')
    p.add_argument('--pause', type=float, default=PAUSE_DEFAUT_S, help='pause en secondes entre deux requêtes (défaut 1.0)')
    p.add_argument('--limite', type=int, default=0, help='limite le nombre d’articles téléchargés par revue (0 = illimité ; pour un essai rapide)')
    args = p.parse_args()

    try:
        depuis = datetime.strptime(args.depuis, '%Y-%m-%d').date()
    except ValueError:
        print('--depuis attend AAAA-MM-JJ, reçu : ' + args.depuis, file=sys.stderr)
        return 2
    jusqua = date.today()

    racine = Path(args.vers)
    racine.mkdir(parents=True, exist_ok=True)

    def emettre(msg):
        print(msg, flush=True)

    def avertir(msg):
        print('AVERT : ' + msg, flush=True)

    debut = time.monotonic()
    lignes_inventaire = []
    compte = {p_: {'articles': 0, 'docx': 0, 'pdf': 0, 'illisibles': 0, 'sans_galley': 0, 'annees': {}} for p_ in PRODUITS}

    for produit, base in PRODUITS.items():
        emettre('=== {} : moisson OAI ({}) ==='.format(produit, base))
        try:
            records = moissonner_oai(base, args.pause, emettre)
        except RuntimeError as e:
            avertir(produit + ' : moisson OAI interrompue (' + str(e) + '), produit incomplet')
            continue
        emettre('{} : {} notice(s) totale(s) (toutes années)'.format(produit, len(records)))

        articles = []
        for rec in records:
            try:
                art = decoder_record(rec, produit)
            except ET.ParseError as e:
                avertir(produit + ' : notice illisible (XML), ignorée (' + str(e) + ')')
                continue
            if art.get('supprime'):
                continue
            articles.append(art)

        retenus = [a for a in articles if dans_fenetre(a, depuis, jusqua, avertir)]
        emettre('{} : {} article(s) dans la fenêtre {} -> {}'.format(produit, len(retenus), depuis, jusqua))

        if args.limite > 0:
            retenus = retenus[:args.limite]

        for art in retenus:
            annee = art['annee'] or '0000'
            numero = art['numero'] or '00'
            compte[produit]['articles'] += 1
            compte[produit]['annees'].setdefault(annee, 0)
            compte[produit]['annees'][annee] += 1

            type_galley = 'docx' if 'docx' in art['galleys'] else ('pdf' if 'pdf' in art['galleys'] else '')
            fichier_rel = ''
            octets = ''
            sha = ''
            if type_galley == '':
                compte[produit]['sans_galley'] += 1
                avertir(produit + '/' + art['article_id'] + " : aucune galley DOCX ni PDF, article ignoré pour le corpus")
            else:
                url_galley = art['galleys'][type_galley]
                slug = ascii_slug(art['titre']) + '-' + art['article_id']
                dest = racine / produit / annee / numero / (slug + '.' + type_galley)
                fichier_rel = str(dest.relative_to(racine)).replace('\\', '/')
                try:
                    if galley_en_cache(dest):
                        octets = dest.stat().st_size
                        sha = sha256_fichier(dest)
                        emettre('  (cache) ' + fichier_rel)
                    else:
                        emettre('  téléchargement : ' + fichier_rel)
                        octets, sha = telecharger_galley(url_galley, dest, args.pause)
                    # Un .docx commence par PK\x03\x04, un .pdf par %PDF. Sinon le fichier est
                    # compté « illisible » et gardé sur disque pour examen.
                    with open(dest, 'rb') as f:
                        entete = f.read(5)
                    valide = (entete[:4] == b'PK\x03\x04') if type_galley == 'docx' else (entete[:4] == b'%PDF')
                    if not valide:
                        compte[produit]['illisibles'] += 1
                        avertir(produit + '/' + art['article_id'] + ' : ' + type_galley +
                                ' téléchargé mais signature invalide (fichier gardé pour examen)')
                        type_galley = type_galley + ' (illisible)'
                    else:
                        compte[produit][type_galley] += 1
                except RuntimeError as e:
                    compte[produit]['illisibles'] += 1
                    avertir(produit + '/' + art['article_id'] + ' : échec du téléchargement (' + str(e) + ')')
                    type_galley = 'echec'
                    fichier_rel = ''

            lignes_inventaire.append({
                'produit': produit, 'annee': annee, 'numero': numero, 'article_id': art['article_id'],
                'titre': art['titre'], 'langue': art['langue'], 'auteurs': ' ; '.join(art['auteurs']),
                'type_galley': type_galley, 'fichier': fichier_rel, 'octets': octets, 'sha256': sha,
                'url_source': art['url_source'],
            })

    duree_s = time.monotonic() - debut

    chemin_csv = racine / 'inventaire.csv'
    with open(chemin_csv, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=[
            'produit', 'annee', 'numero', 'article_id', 'titre', 'langue', 'auteurs',
            'type_galley', 'fichier', 'octets', 'sha256', 'url_source'])
        w.writeheader()
        for ligne in sorted(lignes_inventaire, key=lambda l: (l['produit'], l['annee'], l['numero'], l['article_id'])):
            w.writerow(ligne)
    emettre('écrit : ' + str(chemin_csv) + ' (' + str(len(lignes_inventaire)) + ' ligne(s))')

    ecrire_lisezmoi(racine, compte, depuis, jusqua, duree_s, args)
    return 0


def ecrire_lisezmoi(racine, compte, depuis, jusqua, duree_s, args):
    lignes = []
    lignes.append('# Corpus OJS pour le lexique maison (Vale)')
    lignes.append('')
    lignes.append('Moissonné le {} par `outils-dev/lexique/moissonner-ojs.py`, fenêtre {} -> {}.'.format(
        datetime.now().strftime('%Y-%m-%d %H:%M'), depuis, jusqua))
    lignes.append('')
    lignes.append('## Comment refaire la moisson')
    lignes.append('')
    lignes.append('```')
    lignes.append('wsl -d SZH-Publishing -- python3 outils-dev/lexique/moissonner-ojs.py --depuis {} --vers {}'.format(
        args.depuis, args.vers))
    lignes.append('```')
    lignes.append('')
    lignes.append("Relançable telle quelle : les galleys déjà présentes (fichier non vide, >= {} octets) ne sont pas "
                   "retéléchargées. `--depuis` fixe le début de la fenêtre ; la fin est toujours "
                   "aujourd'hui (fenêtre glissante). `--limite N` restreint à N articles par revue, pour un essai "
                   "rapide sans tout retélécharger.".format(SEUIL_FICHIER_VALIDE))
    lignes.append('')
    lignes.append('## Chiffres')
    lignes.append('')
    lignes.append('| Produit | Articles retenus | DOCX | PDF | Sans galley | Illisibles |')
    lignes.append('|---|---|---|---|---|---|')
    total = {'articles': 0, 'docx': 0, 'pdf': 0, 'sans_galley': 0, 'illisibles': 0}
    for produit, c in compte.items():
        lignes.append('| {} | {} | {} | {} | {} | {} |'.format(
            produit, c['articles'], c['docx'], c['pdf'], c['sans_galley'], c['illisibles']))
        for k in total:
            total[k] += c[k]
    lignes.append('| **Total** | **{}** | **{}** | **{}** | **{}** | **{}** |'.format(
        total['articles'], total['docx'], total['pdf'], total['sans_galley'], total['illisibles']))
    lignes.append('')
    lignes.append('Par année :')
    lignes.append('')
    for produit, c in compte.items():
        detail = ', '.join('{}: {}'.format(a, n) for a, n in sorted(c['annees'].items()))
        lignes.append('- {} — {}'.format(produit, detail or '(aucun)'))
    lignes.append('')
    lignes.append('Durée de la moisson : {:.0f} s.'.format(duree_s))
    lignes.append('')
    lignes.append('## Comparaison au chiffre de référence de la mémoire')
    lignes.append('')
    lignes.append('`corpus-ojs-et-audit-biblio.md` (21.08.2026) rapportait 421 galleys DOCX sur une fenêtre plus '
                   'large et plus ancienne (Revue 2024-01 -> 2026-02, Zeitschrift 2023-01 -> 2026-06, 43 numéros). '
                   'Cette moisson-ci couvre une fenêtre différente (deux ans, jusqu’à aujourd’hui) et compte aussi '
                   'les PDF : les deux chiffres ne sont pas directement comparables. Voir le compte par année '
                   'ci-dessus pour juger de la cohérence.')
    lignes.append('')
    lignes.append('## Ce que l’API ne donne pas')
    lignes.append('')
    lignes.append('- Le texte lui-même : seuls le DOCX et le PDF sont téléchargés, aucune extraction de texte ici '
                   '— `tu ne fais pas l’analyse` (voir le brief).')
    lignes.append('- `dc:language` porte une seule langue par article ; un article sans cette balise (aucun cas '
                   'vu le 21.09.2026) retombe sur la première langue de `dc:creator` rencontrée, sans heuristique '
                   'lexicale sur le corps du texte (hors périmètre : ce serait déjà de l’analyse).')
    lignes.append('- Aucune authentification : les articles non publiés, en révision, ou retirés ne sont jamais vus.')
    lignes.append('- Pas de Content-Length sur les téléchargements de galley (transfert chunké) : le cache local se '
                   'fie à la présence d’un fichier non vide, pas à une taille annoncée par le serveur.')
    (racine / 'LISEZMOI.md').write_text('\n'.join(lignes) + '\n', encoding='utf-8')


if __name__ == '__main__':
    sys.exit(main())
