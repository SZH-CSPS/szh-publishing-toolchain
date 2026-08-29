#!/usr/bin/env python3
# livre-assembler.py — assemble les fragments HTML des chapitres, les liminaires et le
# sommaire en UN document, celui que WeasyPrint paginera.
#
#   python3 livre-assembler.py --meta buch.yaml --gabarit <g.html> --sortie <out.html>
#                              [--css <feuille>]... <fragment>...
#
# Pourquoi un assembleur, et pas une seule invocation de pandoc sur tous les chapitres.
# La règle de compilation fait `cd chapitres/<slug>` avant pandoc, pour que `media/` tombe
# juste — c'est ce qui permet à un chapitre d'être compilé EXACTEMENT comme un article de
# revue, avec la même suite de filtres et le même gestionnaire de médias. Douze chapitres,
# ce sont douze dossiers courants différents : une seule invocation ne peut pas les avoir
# tous. On compile donc chapitre par chapitre, avec --embed-resources, et l'assemblage
# devient une opération de TEXTE : chaque fragment est déjà autonome, images comprises en
# data: URI. Mesuré sur le banc : zéro chemin relatif survivant dans un fragment.
#
# Ce que ce script fait, et rien d'autre :
#   1. lit buch.yaml (analyseur plat maison — l'image WSL n'a pas PyYAML) ;
#   2. compose les liminaires que la machine sait écrire : demi-titre, impressum,
#      page de titre, sommaire ;
#   3. relève les titres des fragments pour bâtir le sommaire, avec des liens internes —
#      les numéros de page sont posés par WeasyPrint (target-counter), jamais ici ;
#   4. remplit le gabarit et écrit la sortie.
#
# ⚠ Ce script n'invente aucune métadonnée. Une clé absente de buch.yaml laisse le bloc
#   correspondant vide plutôt que d'écrire une valeur plausible : un ISBN inventé
#   s'imprimerait.

import html
import os
import re
import sys

# --------------------------------------------------------------------------------------
# Analyseur YAML plat, du même modèle que celui de szh-common.ps1 et de lib/yaml.js : une
# clé par ligne, listes en tirets, sous-blocs indentés d'un niveau. Il ne prétend pas lire
# YAML ; il lit LE fichier que le cockpit écrit.
# --------------------------------------------------------------------------------------

def _valeur(brut):
    v = brut.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        v = v[1:-1]
    if v in ('true', 'True'):
        return True
    if v in ('false', 'False'):
        return False
    return v


def lire_yaml(chemin):
    """Rend un dict. Une passe, trois formes, et rien d'autre :

        cle: valeur              -> chaîne, booléen
        cle: [a, b]              -> liste sur une ligne
        cle:                     -> bloc, suivi soit de « - item » (liste), soit de
          sous-cle: valeur          lignes indentées (dict)

    Ce n'est pas un analyseur YAML et cela n'essaie pas de l'être : c'est le lecteur du
    fichier que le cockpit écrit. Une construction qu'il ne connaît pas est ignorée en
    silence plutôt qu'inventée.
    """
    racine = {}
    try:
        lignes = open(chemin, encoding='utf-8-sig').read().splitlines()
    except OSError:
        return racine
    cle = None          # la clé de premier niveau en cours de remplissage
    conteneur = None    # la liste ou le dict qu'elle porte, quand elle en porte un
    for ligne in lignes:
        if not ligne.strip() or ligne.lstrip().startswith('#'):
            continue
        indent = len(ligne) - len(ligne.lstrip())
        nu = ligne.strip()

        # ⚠ Un item de liste s'écrit AU FER À GAUCHE dans les fiches de la maison —
        # `auteurs:` puis `- prenom: …` en colonne 0, comme dans les <slug>.meta.yaml de
        # la revue. Le tiret se teste donc AVANT l'indentation, sans quoi « - prenom »
        # passerait pour une clé de premier niveau et la liste des auteur·e·s se perdrait.
        if indent == 0 and not nu.startswith('- '):
            if ':' not in nu:
                continue
            c, _, v = nu.partition(':')
            cle, v = c.strip(), v.strip()
            conteneur = None
            if v == '':
                racine[cle] = None          # bloc : la ligne suivante dira lequel
            elif v.startswith('[') and v.endswith(']'):
                racine[cle] = [_valeur(x) for x in v[1:-1].split(',') if x.strip()]
            else:
                racine[cle] = _valeur(v)
            continue

        if cle is None:
            continue

        if nu.startswith('- '):
            if not isinstance(conteneur, list):
                conteneur = []
                racine[cle] = conteneur
            item = nu[2:]
            if ':' in item:
                c, _, v = item.partition(':')
                conteneur.append({c.strip(): _valeur(v)})
            else:
                conteneur.append(_valeur(item))
            continue

        if ':' in nu:
            c, _, v = nu.partition(':')
            # Ligne indentée sous un tiret : elle complète le dernier item de la liste.
            if isinstance(conteneur, list) and conteneur and isinstance(conteneur[-1], dict):
                conteneur[-1][c.strip()] = _valeur(v)
                continue
            if not isinstance(conteneur, dict):
                conteneur = {}
                racine[cle] = conteneur
            conteneur[c.strip()] = _valeur(v)
    return racine


# --------------------------------------------------------------------------------------
# Sommaire : relevé des titres dans les fragments.
# --------------------------------------------------------------------------------------

RE_TITRE = re.compile(
    r'<h(?P<n>[1-3])\b[^>]*\bid="(?P<id>[^"]+)"[^>]*>(?P<txt>.*?)</h(?P=n)>',
    re.S | re.I)
RE_BALISE = re.compile(r'<[^>]+>')


def titres_du_fragment(fragment):
    """Rend [(niveau, ancre, texte)] pour h1..h3. Le texte est dépouillé de ses balises :
    « <span class="szh-num-section">2</span> Teilhabe » donne « 2 Teilhabe »."""
    trouves = []
    for m in RE_TITRE.finditer(fragment):
        txt = RE_BALISE.sub('', m.group('txt'))
        txt = re.sub(r'\s+', ' ', html.unescape(txt).strip())
        if txt:
            trouves.append((int(m.group('n')), m.group('id'), txt))
    return trouves


def sommaire_html(entrees, titre):
    """Le sommaire est une <ol> de liens internes. Le numéro de page est posé par
    target-counter() dans base.css : rien ici ne connaît la pagination, et c'est bien —
    un numéro écrit ici serait faux au premier paragraphe ajouté."""
    lignes = ['<section class="szh-sommaire" id="szh-sommaire">',
              '<h1>' + html.escape(titre) + '</h1>', '<ol>']
    for niveau, ancre, txt in entrees:
        lignes.append('<li class="niveau-%d"><a href="#%s">%s</a></li>'
                      % (niveau, html.escape(ancre, quote=True), html.escape(txt)))
    lignes += ['</ol>', '</section>']
    return '\n'.join(lignes)


# --------------------------------------------------------------------------------------
# Liminaires composés par la machine.
# --------------------------------------------------------------------------------------

def _auteurs_ligne(meta):
    """« Prénom Nom, Prénom Nom et Prénom Nom ». Rien de plus : le bloc auteurs détaillé
    (fonction, affiliation, ORCID) est l'affaire des chapitres."""
    noms = []
    for a in (meta.get('auteurs') or []):
        if isinstance(a, dict):
            n = ' '.join(x for x in (a.get('prenom'), a.get('nom')) if x)
            if n:
                noms.append(n)
        elif a:
            noms.append(str(a))
    if not noms:
        return ''
    if len(noms) == 1:
        return noms[0]
    return ', '.join(noms[:-1]) + ' et ' + noms[-1]


def demi_titre(meta):
    return ('<section class="szh-liminaire szh-demi-titre">'
            '<p class="szh-auteurs">%s</p>'
            '<p class="szh-titre">%s</p>'
            '<p class="szh-sous-titre">%s</p></section>'
            % (html.escape(_auteurs_ligne(meta)),
               html.escape(str(meta.get('titre') or '')),
               html.escape(str(meta.get('sous-titre') or ''))))


def page_titre(meta):
    return ('<section class="szh-liminaire szh-page-titre">'
            '<p class="szh-auteurs">%s</p>'
            '<p class="szh-titre">%s</p>'
            '<p class="szh-sous-titre">%s</p></section>'
            % (html.escape(_auteurs_ligne(meta)),
               html.escape(str(meta.get('titre') or '')),
               html.escape(str(meta.get('sous-titre') or ''))))


# Les quatre raisons sociales de la fondation, dans l'ordre des livres publiés. Elles ne
# sont pas une métadonnée du livre : elles ne changent pas d'un ouvrage à l'autre.
FONDATION = [
    'Stiftung Schweizer Zentrum für Heil- und Sonderpädagogik (SZH) Bern',
    'Fondation Centre suisse de pédagogie spécialisée (CSPS) Berne',
    'Fondazione Centro svizzero di pedagogia specializzata (CSPS) Berna',
    'Fundaziun Center svizzer da pedagogia speciala (CSPS) Berna',
]

LICENCES = {
    'cc-by-nc-nd-4.0': 'Creative Commons CC BY-NC-ND 4.0 International',
    'cc-by-4.0':       'Creative Commons CC BY 4.0 International',
    'cc-by-sa-4.0':    'Creative Commons CC BY-SA 4.0 International',
    'cc-by-nc-4.0':    'Creative Commons CC BY-NC 4.0 International',
}

PHRASE_LICENCE = {
    'de': 'Dieses Werk ist lizenziert unter einer %s.',
    'fr': 'Cette œuvre est diffusée sous licence %s.',
    'it': "Quest'opera è distribuita con licenza %s.",
}

ETIQUETTES_ISBN = (('isbn-print', 'ISBN Print on demand'), ('isbn-ebook', 'ISBN E-Book'))

TITRES_SOMMAIRE = {'de': 'Inhaltsverzeichnis', 'fr': 'Sommaire', 'it': 'Indice'}


def impressum(meta):
    """L'ordre est celui des livres publiés : année et éditeur, la fondation, les ISBN, le
    DOI, la licence. Chaque ligne absente de buch.yaml disparaît — on n'imprime pas un ISBN
    qu'on n'a pas."""
    blocs = []
    if meta.get('annee'):
        blocs.append('© ' + html.escape(str(meta['annee'])))
    blocs.append('Edition SZH/CSPS')
    blocs.append('<br>'.join(html.escape(x) for x in FONDATION))
    for cle, etiquette in ETIQUETTES_ISBN:
        if meta.get(cle):
            blocs.append('%s: %s' % (etiquette, html.escape(str(meta[cle]))))
    if meta.get('doi'):
        blocs.append('https://doi.org/' + html.escape(str(meta['doi'])))
    lic = LICENCES.get(str(meta.get('licence') or ''))
    if lic:
        phrase = PHRASE_LICENCE.get(str(meta.get('lang')), PHRASE_LICENCE['fr'])
        blocs.append(phrase % html.escape(lic))
    corps = '\n'.join('<p>' + x + '</p>' for x in blocs)
    return '<section class="szh-liminaire szh-impressum">' + corps + '</section>'


# --------------------------------------------------------------------------------------

def main(argv):
    """Les feuilles de style sont LIÉES, pas incorporées : le fichier reste lisible pour
    qui débogue une coupure de page, et WeasyPrint lit un chemin absolu sans difficulté.
    Les images, elles, sont déjà en data: URI dans chaque fragment."""
    meta_p = gabarit_p = sortie_p = None
    feuilles, fragments = [], []
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == '--meta' and i + 1 < len(argv):
            meta_p = argv[i + 1]
            i += 2
        elif a == '--gabarit' and i + 1 < len(argv):
            gabarit_p = argv[i + 1]
            i += 2
        elif a == '--sortie' and i + 1 < len(argv):
            sortie_p = argv[i + 1]
            i += 2
        elif a == '--css' and i + 1 < len(argv):
            feuilles.append(argv[i + 1])
            i += 2
        elif a.startswith('--'):
            print('[livre] option inconnue : ' + a, file=sys.stderr)
            return 2
        else:
            fragments.append(a)
            i += 1
    if not (meta_p and gabarit_p and sortie_p):
        print('usage: livre-assembler.py --meta buch.yaml --gabarit g.html '
              '--sortie out.html [--css f.css]... <fragment>...', file=sys.stderr)
        return 2

    meta = lire_yaml(meta_p)
    racine = os.path.dirname(os.path.abspath(meta_p))
    langue = str(meta.get('lang') or 'fr')

    corps, entrees = [], []
    for f in fragments:
        try:
            frag = open(f, encoding='utf-8').read()
        except OSError as e:
            print('[livre] fragment illisible : %s (%s)' % (f, e), file=sys.stderr)
            return 1
        entrees.extend(titres_du_fragment(frag))
        corps.append(frag)

    # Les liminaires, dans l'ordre déclaré. Un nom de fichier .md renvoie à la pièce écrite
    # à la main, compilée comme un chapitre ; les autres sont des mots-clés que la machine
    # compose à partir de buch.yaml.
    composeurs = {
        'demi-titre': lambda: demi_titre(meta),
        'colophon':   lambda: impressum(meta),
        'impressum':  lambda: impressum(meta),
        'page-titre': lambda: page_titre(meta),
        'sommaire':   lambda: sommaire_html(entrees,
                                            TITRES_SOMMAIRE.get(langue, 'Sommaire')),
    }
    tete = []
    for piece in (meta.get('liminaires') or []):
        piece = str(piece)
        if piece in composeurs:
            tete.append(composeurs[piece]())
        elif piece.endswith('.md'):
            f = os.path.join(racine, 'out', 'liminaires', piece[:-3] + '.html')
            if os.path.exists(f):
                tete.append('<section class="szh-liminaire szh-romain">'
                            + open(f, encoding='utf-8').read() + '</section>')
            else:
                print('[livre] liminaire annonce mais non compile : ' + piece,
                      file=sys.stderr)
        else:
            print('[livre] liminaire inconnu, ignore : ' + piece, file=sys.stderr)

    try:
        gabarit = open(gabarit_p, encoding='utf-8').read()
    except OSError as e:
        print('[livre] gabarit illisible : %s (%s)' % (gabarit_p, e), file=sys.stderr)
        return 1

    liens = '\n'.join('  <link rel="stylesheet" href="%s" />' % html.escape(c, quote=True)
                      for c in feuilles)
    remplacements = {
        '$lang$':          langue,
        '$titre$':         html.escape(str(meta.get('titre') or '')),
        '$sous-titre$':    html.escape(str(meta.get('sous-titre') or '')),
        '$auteurs$':       html.escape(_auteurs_ligne(meta)),
        '$classe-format$': 'szh-a4' if str(meta.get('format')) == 'a4' else '',
        '$css$':           liens,
        '$liminaires$':    '\n'.join(tete),
        '$corps$':         '\n'.join(corps),
    }
    sortie = gabarit
    for cle, val in remplacements.items():
        sortie = sortie.replace(cle, val)

    dossier = os.path.dirname(os.path.abspath(sortie_p))
    if dossier:
        os.makedirs(dossier, exist_ok=True)
    with open(sortie_p, 'w', encoding='utf-8') as fh:
        fh.write(sortie)
    print('[livre] %d chapitre(s), %d liminaire(s), %d entree(s) de sommaire'
          % (len(fragments), len(tete), len(entrees)), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
