#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Contrôle de complétude de l'import d'un Word : compare ce que la chaîne a lu dans le
# document à ce qu'elle a écrit dans l'article, et remet ce qui manque plutôt que de le
# perdre.
#
#   docx-controle-import.py --avant-medias <fichier.docx> <slug> <dossier-article> <etat>
#   docx-controle-import.py --apres-medias <slug> <dossier-article> <etat> [<stats-medias>]
#
# Deux passes, appelées par import-docx.sh, car import-medias.py renomme les images
# (media/image3.png -> <slug>-fig-01.png) et supprime celles que le texte ne cite pas :
#
# 1. --avant-medias, juste après pandoc :
#    a. Valeurs. Chaque légende, texte alternatif, crédit et source d'un bloc figure ou
#       tableau du gabarit (lignes FI, FG, FT de $SZH_META, écrites par pronto-lire.py) doit
#       se retrouver dans le .md ou dans tables/*.html. Sinon elle est remise dans le texte
#       sous son étiquette (« Légende : … »), avant sa figure si on la trouve, en fin
#       d'article sinon, avec l'avertissement bloc-valeur-non-reprise.
#    b. Images. Chaque image du corps du Word doit être citée par le .md ou un
#       tables/*.html. Exclues : celles des tableaux consommés (lignes T, photos des
#       auteurs), le logo de licence de tête (ligne G de docx-meta.py) et le contenu des
#       mc:Fallback (doublons). Une image absente dont le fichier est dans media/ est
#       remise en fin d'article, ce qui la protège de la suppression.
#    c. Texte des tableaux. Les cellules non vides de chaque tableau de premier niveau
#       doivent se retrouver dans le .md ou tables/*.html. Pour un tableau consommé
#       (lignes T), on cherche leurs mots dans la fiche, les instructions du lecteur et
#       l'appariement des photos, sans les étiquettes « SZH Cle » et « SZH Aide ». Les
#       tableaux sont recomptés comme dans docx-tables.py (un tableau dans un contrôle de
#       contenu Word compte). Un texte manquant n'est pas remis, mais signalé
#       (tableau-texte-perdu).
#    Les images remises sont notées dans <etat> (JSON) pour la seconde passe.
#
# 2. --apres-medias, sur les noms définitifs :
#    a. Les images remises sont signalées (image-absente-import) sous leur nom final, lu
#       dans les statistiques d'import-medias.py (<stats-medias>).
#    b. Toute image d'un bloc `::: {.szh-grille}` sans alt= est signalée
#       (figure-alt-a-completer) : dans un groupe, seule la première a une légende, et une
#       image sans alt serait décorative, muette pour un lecteur d'écran.
#
# Non bloquant : code 0 même sur une erreur de lecture (dite sur stderr). Le .md est relu
# par pandoc en JSON ; sans pandoc, la recherche se fait dans le texte brut.

import json
import os
import re
import subprocess
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun
import ooxml_lecture
import pronto_modele
from ooxml_lecture import W, A, WP, R, V, MC, ASVG

PREFIXE = '[import-avertissement]'

# Étiquettes des valeurs remises dans le texte : celles du gabarit
# (manuscrit_gabarit.CHAMPS_BLOC, pronto_modele.CANON_FIGURE).
CHAMPS = (('legende', 'Légende'), ('alt', 'Texte alternatif'), ('credit', 'Copyright'),
          ('source', 'Source'), ('note', 'Note'))
NOMS_DE = {'legende': 'Legende', 'alt': 'Alternativtext', 'credit': 'Copyright',
           'source': 'Quelle', 'note': 'Notiz'}

# Numéro manuel que szh-legendes.lua (nettoyer_figure) retire de la légende : « Figure 2 :
# Vue » devient « Vue » dans l'article.
RE_NUMERO_FIGURE = re.compile(
    r'^(?:figure|fig\.?|abb\.?|abbildung|illustration|grafik|tableau|tabelle|table)\s*\d+'
    r'[a-z]?\s*[:.\-–—]?\s*', re.I)
GUILLEMETS = '"\'«»“”‘’„‚‹›'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE, code, ['article « %s »' % os.getenv('SZH_SLUG', '')] + champs,
                       fr, de)


def sans_barre(t):
    return str(t or '').replace('|', '/')


def cle(t):
    """Forme de comparaison qui ignore ce que pandoc (smart) ou la typographie changent :
    NFC, casse, espaces spéciales et blancs regroupés, tirets et points de suspension
    unifiés, guillemets retirés."""
    t = unicodedata.normalize('NFC', str(t or '')).casefold()
    for a in (' ', ' ', ' ', ' '):
        t = t.replace(a, ' ')
    t = re.sub(r'[‐-―-]+', '-', t).replace('…', '...')
    t = ''.join(c for c in t if c not in GUILLEMETS)
    return ' '.join(t.split())


# ---------------------------------------------------------------------------------
# Lecture des instructions du lecteur ($SZH_META).

def lire_instructions(chemin):
    blocs, t_ordinaux, logos = [], set(), 0
    if not chemin or not os.path.exists(chemin):
        return blocs, t_ordinaux, logos
    with open(chemin, encoding='utf-8') as f:
        for ligne in f:
            ligne = ligne.rstrip('\n')
            champs = ligne.split('\t')
            lettre = champs[0]
            if lettre in ('FI', 'FG', 'FT') and len(champs) >= 2:
                champs += [''] * (7 - len(champs))
                blocs.append({'lettre': lettre, 'cible': champs[1],
                              'valeurs': {c: champs[2 + i].strip()
                                          for i, (c, _) in enumerate(CHAMPS)}})
            elif lettre == 'T' and len(champs) == 2:
                try:
                    t_ordinaux.add(int(champs[1]))
                except ValueError:
                    pass
            elif lettre == 'G' and len(champs) == 2:
                try:
                    logos = int(champs[1])
                except ValueError:
                    pass
    return blocs, t_ordinaux, logos


# ---------------------------------------------------------------------------------
# Ce que contient l'article : le .md relu par pandoc, et tables/*.html.

def _inlines_texte(inlines, sortie):
    for x in inlines or []:
        t = x.get('t')
        c = x.get('c')
        if t == 'Str':
            sortie.append(c)
        elif t in ('Space', 'SoftBreak', 'LineBreak'):
            sortie.append(' ')
        elif t in ('Code', 'Math', 'RawInline'):
            sortie.append(c[1] if isinstance(c, list) else '')
        elif t == 'Image' or t == 'Link':
            attr, contenu, cible = c
            _inlines_texte(contenu, sortie)
            sortie.append(' ')
            for k, v in attr[2]:
                sortie.append(' ' + v + ' ')
            if t == 'Image':
                sortie.append(' ' + cible[0] + ' ')
        elif t == 'Note':
            _blocs_texte(c, sortie)
        elif t in ('Quoted', 'Cite'):
            _inlines_texte(c[1] if t == 'Quoted' else c[1], sortie)
        elif t == 'Span':
            _inlines_texte(c[1], sortie)
        elif isinstance(c, list):
            # Emph, Strong, Underline, Strikeout, Superscript, Subscript, SmallCaps
            _inlines_texte(c, sortie)


def _blocs_texte(blocs, sortie):
    for b in blocs or []:
        t = b.get('t')
        c = b.get('c')
        if t in ('Para', 'Plain', 'Header'):
            _inlines_texte(c[2] if t == 'Header' else c, sortie)
        elif t == 'Div':
            for k, v in c[0][2]:
                sortie.append(' ' + v + ' ')
            _blocs_texte(c[1], sortie)
        elif t == 'Figure':
            _blocs_texte(c[1][1], sortie)
            _blocs_texte(c[2], sortie)
        elif t == 'BlockQuote':
            _blocs_texte(c, sortie)
        elif t in ('BulletList',):
            for item in c:
                _blocs_texte(item, sortie)
        elif t == 'OrderedList':
            for item in c[1]:
                _blocs_texte(item, sortie)
        elif t == 'LineBlock':
            for ligne in c:
                _inlines_texte(ligne, sortie)
        elif t in ('RawBlock', 'CodeBlock'):
            sortie.append(c[1])
        sortie.append('\n')


def texte_du_md(chemin_md):
    """(texte relu par pandoc, texte brut), le premier vide si pandoc échoue."""
    try:
        with open(chemin_md, encoding='utf-8') as f:
            brut = f.read()
    except OSError:
        return '', ''
    relu = ''
    try:
        sortie = subprocess.run(['pandoc', '-f', 'markdown', '-t', 'json', chemin_md],
                                capture_output=True, timeout=120)
        if sortie.returncode == 0:
            doc = json.loads(sortie.stdout.decode('utf-8'))
            morceaux = []
            _blocs_texte(doc.get('blocks'), morceaux)
            relu = ''.join(morceaux)
    except (OSError, ValueError, subprocess.SubprocessError):
        relu = ''
    return relu, brut


class _TexteHtml(HTMLParser):
    """`avec_images` : le src et l'alt d'un <img> comptent comme du texte. Utile pour
    retrouver une valeur de bloc (un alt), pas pour une cellule : mêlés à son texte, ils la
    rendraient introuvable."""

    def __init__(self, avec_images=False):
        super().__init__(convert_charrefs=True)
        self.morceaux = []
        self.avec_images = avec_images

    def handle_starttag(self, tag, attrs):
        if tag == 'img' and not self.avec_images:
            return
        for k, v in attrs:
            if v and (k.startswith('data-') or k in ('alt', 'src')):
                self.morceaux.append(' ' + v + ' ')

    def handle_data(self, data):
        self.morceaux.append(data)


def texte_des_tables(dossier, avec_images=False):
    tables = os.path.join(dossier, 'tables')
    morceaux = []
    if os.path.isdir(tables):
        for nom in sorted(os.listdir(tables)):
            if nom.endswith('.html'):
                try:
                    with open(os.path.join(tables, nom), encoding='utf-8') as f:
                        p = _TexteHtml(avec_images)
                        p.feed(f.read())
                        morceaux.append(''.join(p.morceaux))
                except OSError:
                    pass
    return '\n'.join(morceaux)


def valeur_presente(valeur, reference):
    k = cle(valeur)
    if not k:
        return True
    if k in reference:
        return True
    sans_numero = cle(RE_NUMERO_FIGURE.sub('', valeur, count=1))
    return bool(sans_numero) and sans_numero in reference


# ---------------------------------------------------------------------------------
# Remise d'un texte dans le .md.

RE_ECHAPPER = re.compile(r'([\\`*_{}\[\]<>#$@^~|])')


def echapper_md(texte):
    return RE_ECHAPPER.sub(r'\\\1', ' '.join(str(texte).split()))


def _debut_de_bloc(lignes, i):
    """Remonte de la ligne `i` au début de son bloc markdown (après la ligne vide qui le
    précède)."""
    while i > 0 and lignes[i - 1].strip() != '':
        i -= 1
    return i


def _fin_du_corps(lignes):
    """Où placer ce qu'on ne sait pas situer : avant le bloc de bibliographie, qui reste en
    dernier, sinon tout à la fin."""
    for i, l in enumerate(lignes):
        if l.startswith('::: {.szh-biblio'):
            return i
    return len(lignes)


def inserer_paragraphes(lignes, position, paragraphes):
    bloc = []
    for p in paragraphes:
        bloc += [p, '']
    if position > 0 and lignes[position - 1].strip() != '':
        bloc = [''] + bloc
    lignes[position:position] = bloc


def ancre_du_bloc(lignes, bloc, numeros_tables):
    """Indice de la ligne avant laquelle remettre les valeurs d'un bloc : sa figure (FI) ou
    la référence de son tableau (FT). None si introuvable."""
    cibles = []
    if bloc['lettre'] == 'FI':
        for entree in bloc['cible'].split(';'):
            cibles += ['media/' + n for n in entree.split('|') if n]
    elif bloc['lettre'] == 'FT':
        try:
            n = numeros_tables.get(int(bloc['cible']))
        except ValueError:
            n = None
        if n:
            cibles.append('tables/table-%02d.html' % n)
    for i, l in enumerate(lignes):
        if any(c in l for c in cibles):
            return _debut_de_bloc(lignes, i)
    return None


# ---------------------------------------------------------------------------------
# Images du Word.

def images_du_word(chemin_docx, t_ordinaux):
    """[{'noms': [...], 'nom_word': str, 'avant_texte': bool}] : une entrée par image du
    corps, dans l'ordre, hors tableaux consommés (lignes T) et hors mc:Fallback."""
    with zipfile.ZipFile(chemin_docx) as z:
        racine = ET.fromstring(z.read('word/document.xml'))
        rels = ooxml_lecture.charger_rels_images(z, sans_externes=True)
    corps = racine.find(W + 'body')
    if corps is None:
        return []
    images = []
    # `texte_vu` : du texte a-t-il déjà été rencontré ? Une image vue avant est en tête de
    # document, seule place d'où le logo de licence (ligne G) est retiré.
    etat = {'texte_vu': False}

    def noter(element):
        noms = []
        for blip in element.iter(A + 'blip'):
            for attr in (R + 'embed',):
                if blip.get(attr) in rels:
                    noms.append(rels[blip.get(attr)])
        for svg in element.iter(ASVG + 'svgBlip'):
            if svg.get(R + 'embed') in rels:
                noms.append(rels[svg.get(R + 'embed')])
        for imd in element.iter(V + 'imagedata'):
            if imd.get(R + 'id') in rels:
                noms.append(rels[imd.get(R + 'id')])
        if not noms:
            return
        nom_word = ''
        doc_pr = element.find('.//' + WP + 'docPr')
        if doc_pr is not None:
            nom_word = (doc_pr.get('descr') or doc_pr.get('name') or '').strip()
        images.append({'noms': noms, 'nom_word': nom_word or noms[0],
                       'avant_texte': not etat['texte_vu']})

    def parcourir(element, dans_table_consommee):
        for enfant in element:
            if enfant.tag == MC + 'Fallback':
                continue                       # même image que le mc:Choice voisin
            if enfant.tag in (W + 'drawing', W + 'pict'):
                if not dans_table_consommee:
                    noter(enfant)
                continue
            if enfant.tag == W + 't' and (enfant.text or '').strip():
                etat['texte_vu'] = True
            parcourir(enfant, dans_table_consommee)

    # Tableaux consommés (lignes T), reconnus à leur rang compté comme dans docx-tables.py.
    consommes = {id(tbl) for ordinal, tbl in tableaux_de_la_racine(racine) if ordinal in t_ordinaux}

    def premier_niveau(element):
        for enfant in element:
            if enfant.tag == W + 'tbl':
                parcourir(enfant, id(enfant) in consommes)
            elif enfant.tag in (W + 'drawing', W + 'pict'):
                noter(enfant)
            elif enfant.tag == MC + 'Fallback':
                continue
            else:
                if enfant.tag == W + 't' and (enfant.text or '').strip():
                    etat['texte_vu'] = True
                premier_niveau(enfant)

    premier_niveau(corps)
    return images


# ---------------------------------------------------------------------------------
# Texte des tableaux du Word.

RE_STYLE_ETIQUETTE = re.compile(r'^szh(cle|aide)(?!abb)', re.I)


def _texte_paragraphe(p):
    morceaux = []

    def marche(e):
        for enfant in e:
            if enfant.tag == MC + 'Fallback':
                continue
            if enfant.tag == W + 't':
                morceaux.append(enfant.text or '')
            elif enfant.tag in (W + 'tab', W + 'br', W + 'cr'):
                morceaux.append(' ')
            elif enfant.tag == W + 'noBreakHyphen':
                morceaux.append('-')
            else:
                marche(enfant)

    marche(p)
    return ''.join(morceaux)


def _cellule_texte(tc, sans_etiquettes):
    """Texte d'une cellule, paragraphes séparés par une espace. `sans_etiquettes` écarte
    les paragraphes de style « SZH Cle » et « SZH Aide » (étiquettes et aide du gabarit)."""
    pars = []
    for p in tc.iter(W + 'p'):
        if sans_etiquettes:
            style = p.find(W + 'pPr/' + W + 'pStyle')
            # Nom normalisé comme pour le gabarit : « SZH-Cle » vaut « SZHCle ».
            if style is not None and RE_STYLE_ETIQUETTE.match(
                    pronto_modele.normaliser_nom_style(style.get(W + 'val'))):
                continue
        pars.append(_texte_paragraphe(p))
    return ' '.join(pars)


def tableaux_de_la_racine(racine):
    """[(rang, tbl)] des tableaux de premier niveau, comptés par la fonction même de
    docx-tables.py, dont viennent les rangs des lignes T et FG."""
    docx_tables = szh_commun.charger_module_a_tiret('docx-tables.py')
    return [(ordinal, tbl) for ordinal, (tbl, _) in
            enumerate(docx_tables.tableaux_de_premier_niveau(racine), start=1)]


def tableaux_du_word(chemin_docx):
    """[(rang, tbl)], voir tableaux_de_la_racine."""
    with zipfile.ZipFile(chemin_docx) as z:
        racine = ET.fromstring(z.read('word/document.xml'))
    return tableaux_de_la_racine(racine)


def sans_blancs(t):
    """cle() sans aucune espace : le HTML de tables/ colle les paragraphes d'une cellule,
    le Word les sépare."""
    return cle(t).replace(' ', '')


def cellules_a_chercher(tbl, sans_etiquettes):
    vues, cellules = set(), []
    for tc in tbl.iter(W + 'tc'):
        texte = ' '.join(_cellule_texte(tc, sans_etiquettes).split())
        forme = sans_blancs(texte)
        if forme and any(c.isalnum() for c in forme) and forme not in vues:
            vues.add(forme)
            cellules.append((texte, forme))
    return cellules


def mots(texte):
    return re.findall(r'[^\W_]+', cle(texte))


def tableaux_perdus(chemin_docx, t_ordinaux, ignores, reference, mots_fiche):
    """[(rang, [textes introuvables])], voir 1.c de l'en-tête. `reference` : .md et
    tables/, sans blancs. `mots_fiche` : les mots de la fiche, des instructions du lecteur
    et de l'appariement des photos.
    Un tableau consommé est passé dans la fiche champ par champ : on y cherche les mots de
    chaque cellule. Une cellule est perdue si moins de la moitié de ses mots (de trois
    lettres ou plus, sinon tous) sont dans `mots_fiche`. Le corps de l'article n'est pas
    utilisé : un résumé perdu dont le sujet revient dans le texte serait masqué."""
    perdus = []
    for ordinal, tbl in tableaux_du_word(chemin_docx):
        if ordinal in ignores:
            continue
        if ordinal in t_ordinaux:
            manquantes = []
            for texte, _ in cellules_a_chercher(tbl, True):
                tous = mots(texte)
                longs = [m for m in tous if len(m) >= 3] or tous
                if longs and sum(1 for m in longs if m in mots_fiche) * 2 < len(longs):
                    manquantes.append(texte)
        else:
            manquantes = [t for t, f in cellules_a_chercher(tbl, False) if f not in reference]
        if manquantes:
            perdus.append((ordinal, manquantes))
    return perdus


def lire_texte(chemin):
    if not chemin or not os.path.isfile(chemin):
        return ''
    try:
        with open(chemin, encoding='utf-8', errors='replace') as f:
            return f.read()
    except OSError:
        return ''


def image_citee(noms, texte):
    return any(('media/' + n) in texte or ('media%2F' + n) in texte for n in noms)


# ---------------------------------------------------------------------------------
# Passe 1.

def avant_medias(chemin_docx, slug, dossier, chemin_etat):
    chemin_md = os.path.join(dossier, slug + '.md')
    blocs, t_ordinaux, logos = lire_instructions(os.getenv('SZH_META'))
    relu, brut = texte_du_md(chemin_md)
    tables = texte_des_tables(dossier, avec_images=True)
    reference = cle((relu or brut) + '\n' + tables)
    try:
        with open(chemin_md, encoding='utf-8') as f:
            lignes = f.read().split('\n')
    except OSError:
        print('[controle-import] %s illisible : contrôle sauté' % chemin_md, file=sys.stderr)
        return 0

    # Numéro de tables/table-NN.html de chaque rang : docx-tables.py saute les T et les FG.
    sautes = set(t_ordinaux) | {int(b['cible']) for b in blocs
                                if b['lettre'] == 'FG' and b['cible'].isdigit()}
    numeros_tables, n = {}, 0
    for ordinal in range(1, 1 + max([0] + [int(b['cible']) for b in blocs
                                           if b['cible'].isdigit()])):
        if ordinal not in sautes:
            n += 1
            numeros_tables[ordinal] = n

    remises_valeurs = 0
    a_la_fin = []
    for bloc in blocs:
        manquantes = [(c, lab, bloc['valeurs'][c]) for c, lab in CHAMPS
                      if bloc['valeurs'][c] and not valeur_presente(bloc['valeurs'][c], reference)]
        if not manquantes:
            continue
        paragraphes = ['%s : %s' % (lab, echapper_md(v)) for _, lab, v in manquantes]
        ancre = ancre_du_bloc(lignes, bloc, numeros_tables)
        if ancre is None:
            a_la_fin += paragraphes
        else:
            inserer_paragraphes(lignes, ancre, paragraphes)
        remises_valeurs += len(manquantes)
        for c, lab, v in manquantes:
            avertir('bloc-valeur-non-reprise', ['valeur « %s »' % sans_barre(v)],
                    'La valeur « %s » (%s), lue dans le Word, ne se retrouvait nulle part dans '
                    'l’article : elle a été remise dans le texte, %s. Reportez-la dans '
                    '« Médias de l’article », puis retirez ce paragraphe du texte.'
                    % (v, lab.lower(),
                       'près de sa figure' if ancre is not None else 'en fin d’article'),
                    'Der Wert „%s“ (%s) aus dem Word fand sich nirgends im Artikel: er wurde '
                    'wieder in den Text gesetzt, %s. Übertragen Sie ihn unter «Medien des '
                    'Artikels» und entfernen Sie danach diesen Absatz aus dem Text.'
                    % (v, NOMS_DE[c], 'neben seiner Abbildung' if ancre is not None
                       else 'am Ende des Artikels'))

    # Texte des tableaux (1.c). Les groupes d'images (FG) sont contrôlés plus haut.
    try:
        fiche = lire_texte(os.path.join(dossier, slug + '.meta.yaml'))
        fiche += lire_texte(os.getenv('SZH_META')) + lire_texte(os.getenv('SZH_PHOTOS'))
        perdus = tableaux_perdus(
            chemin_docx, t_ordinaux,
            {int(b['cible']) for b in blocs if b['lettre'] == 'FG' and b['cible'].isdigit()},
            sans_blancs((relu or brut) + '\n' + texte_des_tables(dossier)),
            set(mots(fiche)))
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as e:
        print('[controle-import] tableaux du Word illisibles : %s' % e, file=sys.stderr)
        perdus = []
    for ordinal, textes in perdus:
        extrait = ' ; '.join(' '.join(t.split())[:60] for t in textes[:3])
        avertir('tableau-texte-perdu', ['tableau %d du Word' % ordinal,
                                        'cellules « %s »' % sans_barre(extrait)],
                'Le texte du tableau %d du Word (%s) ne se retrouve nulle part dans l’article '
                '(%d cellule(s) introuvable(s)). Vérifiez le tableau dans le Word, puis '
                'reprenez-le à la main dans l’article.' % (ordinal, extrait, len(textes)),
                'Der Text der Tabelle %d im Word (%s) fehlt im Artikel (%d Zelle(n) nicht '
                'gefunden). Prüfen Sie die Tabelle im Word und übernehmen Sie sie von Hand in '
                'den Artikel.' % (ordinal, extrait, len(textes)))

    # Images (1.b) : chaque image du corps du Word doit être citée.
    remises_images = []
    try:
        images = images_du_word(chemin_docx, t_ordinaux)
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as e:
        print('[controle-import] images du Word illisibles : %s' % e, file=sys.stderr)
        images = []
    texte_citations = '\n'.join(lignes) + '\n' + texte_brut_des_tables(dossier)
    # Images retirées volontairement par szh-meta.lua (logo de licence, ligne G), notées
    # dans $SZH_RETRAITS. Sans ce fichier (appel hors import-docx.sh) : les G premières
    # images vues avant tout texte.
    retraits = None
    chemin_retraits = os.getenv('SZH_RETRAITS')
    if chemin_retraits and os.path.exists(chemin_retraits):
        with open(chemin_retraits, encoding='utf-8') as f:
            retraits = {l.strip() for l in f if l.strip()}
    logos_restants = logos
    manquantes_img = []
    for img in images:
        if image_citee(img['noms'], texte_citations):
            continue
        if retraits is not None:
            if any(n in retraits for n in img['noms']):
                continue                      # retirée volontairement
        elif logos_restants > 0 and img['avant_texte']:
            logos_restants -= 1
            continue
        manquantes_img.append(img)
    for img in manquantes_img:
        fichier = next((n for n in reversed(img['noms'])
                        if os.path.isfile(os.path.join(dossier, 'media', n))), None)
        if fichier:
            a_la_fin.append('![](media/%s)' % fichier)
        remises_images.append({'nom_word': img['nom_word'], 'fichier': fichier,
                               'noms': img['noms']})

    if a_la_fin:
        inserer_paragraphes(lignes, _fin_du_corps(lignes), a_la_fin)
    if remises_valeurs or any(r['fichier'] for r in remises_images):
        with open(chemin_md, 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lignes))

    with open(chemin_etat, 'w', encoding='utf-8') as f:
        json.dump({'images': remises_images}, f, ensure_ascii=False)
    print('[controle-import] %d valeur(s) de bloc et %d image(s) remise(s) dans le texte'
          % (remises_valeurs, sum(1 for r in remises_images if r['fichier'])),
          file=sys.stderr)
    return 0


def texte_brut_des_tables(dossier):
    tables = os.path.join(dossier, 'tables')
    morceaux = []
    if os.path.isdir(tables):
        for nom in sorted(os.listdir(tables)):
            if nom.endswith('.html'):
                try:
                    with open(os.path.join(tables, nom), encoding='utf-8') as f:
                        morceaux.append(f.read())
                except OSError:
                    pass
    return '\n'.join(morceaux)


# ---------------------------------------------------------------------------------
# Passe 2.

def _images_des_grilles(blocs, dans_grille, sortie):
    for b in blocs or []:
        t, c = b.get('t'), b.get('c')
        if t == 'Div':
            est = dans_grille or 'szh-grille' in c[0][1]
            _images_des_grilles(c[1], est, sortie)
        elif t in ('Para', 'Plain') and dans_grille:
            for x in c:
                if x.get('t') == 'Image':
                    attr, _, cible = x['c']
                    sortie.append((cible[0], dict(attr[2])))
        elif t == 'Figure':
            _images_des_grilles(c[2], dans_grille, sortie)


def apres_medias(slug, dossier, chemin_etat, stats_medias):
    chemin_md = os.path.join(dossier, slug + '.md')
    renommees = {}
    try:
        for couple in (json.loads(stats_medias or '{}').get('images_renommees') or []):
            ancien, _, nouveau = couple.partition(' -> ')
            renommees[ancien] = nouveau
    except ValueError:
        pass
    try:
        with open(chemin_etat, encoding='utf-8') as f:
            etat = json.load(f)
    except (OSError, ValueError):
        etat = {'images': []}

    for r in etat.get('images') or []:
        if r.get('fichier'):
            final = 'media/' + renommees.get(r['fichier'], r['fichier'])
            avertir('image-absente-import', ['image « %s »' % sans_barre(final)],
                    'L’image « %s » du Word ne se retrouvait nulle part dans l’article : elle '
                    'a été remise en fin d’article (%s), pour ne pas être perdue. Déplacez-la '
                    'à sa place, puis légendez-la dans « Médias de l’article ».'
                    % (r['nom_word'], final),
                    'Das Bild „%s“ aus dem Word fand sich nirgends im Artikel: es wurde am '
                    'Ende des Artikels wieder eingesetzt (%s), damit es nicht verloren geht. '
                    'Verschieben Sie es an seinen Platz und beschriften Sie es unter «Medien '
                    'des Artikels».' % (r['nom_word'], final))
        else:
            avertir('image-absente-import', ['image « %s »' % sans_barre(r['nom_word'])],
                    'L’image « %s » du Word ne se retrouve pas dans l’article, et son fichier '
                    'n’a pas pu être extrait : insérez-la à nouveau depuis le Word, dans '
                    '« Médias de l’article ».' % r['nom_word'],
                    'Das Bild „%s“ aus dem Word fehlt im Artikel, und seine Datei konnte '
                    'nicht extrahiert werden: fügen Sie es unter «Medien des Artikels» erneut '
                    'aus dem Word ein.' % r['nom_word'])

    # Texte alternatif des groupes d'images.
    try:
        sortie = subprocess.run(['pandoc', '-f', 'markdown', '-t', 'json', chemin_md],
                                capture_output=True, timeout=120)
        doc = json.loads(sortie.stdout.decode('utf-8')) if sortie.returncode == 0 else {}
    except (OSError, ValueError, subprocess.SubprocessError):
        doc = {}
    images = []
    _images_des_grilles(doc.get('blocks'), False, images)
    vues = set()
    for cible, attrs in images:
        if 'alt' in attrs or cible in vues:
            continue
        vues.add(cible)
        nom = re.sub(r'^\./', '', cible)
        avertir('figure-alt-a-completer', ['image « %s »' % sans_barre(nom)],
                'L’image %s fait partie d’une figure à plusieurs images mais n’a pas de texte '
                'alternatif : un lecteur d’écran n’en dirait rien. Décrivez-la dans « Médias '
                'de l’article ».' % os.path.basename(nom),
                'Das Bild %s gehört zu einer Abbildung mit mehreren Bildern, hat aber keinen '
                'Alternativtext: ein Screenreader würde nichts dazu sagen. Beschreiben Sie es '
                'unter «Medien des Artikels».' % os.path.basename(nom))
    return 0


def principal(argv):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    try:
        if len(argv) == 6 and argv[1] == '--avant-medias':
            return avant_medias(argv[2], argv[3], argv[4], argv[5])
        if len(argv) in (5, 6) and argv[1] == '--apres-medias':
            return apres_medias(argv[2], argv[3], argv[4], argv[5] if len(argv) == 6 else '')
    except Exception as e:                     # non bloquant : signalé, code 0
        print('[controle-import] contrôle interrompu : %s' % e, file=sys.stderr)
        return 0
    print('usage : docx-controle-import.py --avant-medias <docx> <slug> <dossier> <etat>\n'
          '        docx-controle-import.py --apres-medias <slug> <dossier> <etat> '
          '[<stats-medias>]', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
