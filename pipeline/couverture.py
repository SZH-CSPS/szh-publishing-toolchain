#!/usr/bin/env python3
# couverture.py — compose la couverture à plat d'un livre : 4e de couverture, dos, 1re de
# couverture, sur UNE page, celle que l'imprimeur massicote.
#
#   python3 couverture.py --meta buch.yaml --pdf-interieur out/<livre>.pdf \
#                         --quatrieme out/couverture/quatrieme.html \
#                         [--illustration couverture/illustration.jpg] \
#                         --gabarit szh-couverture.html --sortie out/couverture/<livre>.html \
#                         [--css feuille.css]...
#
# Ce que ce script fait, et rien d'autre :
#   1. lit buch.yaml (lire_yaml(), importé de livre-assembler.py — pas recopié) ;
#   2. calcule l'épaisseur du dos, SAUF si impression.dos-mm porte une valeur : c'est
#      l'imprimeur qui a le dernier mot, et rien ici ne doit contredire son chiffre ;
#   3. si le dos se calcule, LIT le nombre de pages dans le PDF intérieur déjà compilé —
#      jamais saisi, jamais périmé. Un dos calculé sur un compte de pages obsolète est le
#      défaut le plus cher du métier (voir docs/ARCHITECTURE-LIVRES.md §3) ;
#   4. assemble le gabarit avec les trois largeurs exactes (4e, dos, 1re) et écrit le HTML
#      que WeasyPrint composera en PDF à plat, fond perdu et traits de coupe compris (posés
#      par styles/livre/couverture.css, pas par ce script).
#
# ⚠ Ce script n'invente aucune métadonnée, au même titre que livre-assembler.py : une
#   collection ou un tome absents de buch.yaml laissent le bloc correspondant vide plutôt
#   que d'écrire un texte plausible.

import base64
import html
import importlib.util
import os
import re
import sys
import zlib

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))


def _importer(nom_module, nom_fichier):
    """Importe un module frère par son CHEMIN, pas par son nom : les deux scripts qu'on
    réutilise ici (livre-assembler.py, apca.py) ne forment pas un paquet Python, et
    livre-assembler.py porte un tiret, imprononçable pour `import`. Le fichier n'a aucun
    effet de bord au chargement (son `main()` est sous `if __name__ == '__main__'`)."""
    chemin = os.path.join(PIPELINE_DIR, nom_fichier)
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# Réutilisés tels quels — voir l'avertissement en tête de chaque fichier sur ce qu'ils
# n'inventent pas. Ne pas recopier lire_yaml() ni _auteurs_ligne() : une divergence entre
# les deux lecteurs YAML serait un livre dont la couverture et l'intérieur se contredisent.
_assembleur = _importer('szh_livre_assembler', 'livre-assembler.py')
lire_yaml = _assembleur.lire_yaml
_auteurs_ligne = _assembleur._auteurs_ligne
apca = _importer('szh_apca', 'apca.py')


# ──────────────────────────────────────────────────────────────────────────────────────
# 1. Compte de pages d'un PDF, SANS dépendance externe.
# ──────────────────────────────────────────────────────────────────────────────────────
# pypdf n'est pas dans l'image WSL (vérifié : `python3 -c "import pypdf"` -> ModuleNotFound,
# de même pour PyPDF2, pdfminer, fitz/pymupdf). Ce lecteur est donc écrit à la main, et il
# faut le dire : ce n'est PAS un analyseur PDF général, c'est un lecteur ciblé sur ce que
# WeasyPrint 69 écrit réellement — mesuré ici sur les deux livres de banc :
#   * table de références sous forme de FLUX COMPRESSÉ (/Type /XRef), pas la table `xref`
#     classique en texte clair ;
#   * les objets eux-mêmes (Catalog, Pages…) vivent DANS des flux d'objets compressés
#     (/Type /ObjStm), pas comme des objets indirects lisibles tels quels.
# C'est précisément pourquoi compter les occurrences de « /Type /Page » dans les octets
# bruts est fragile (l'avertissement de la mission) : ces octets n'existent nulle part en
# clair dans un PDF WeasyPrint, ils sont dans un flux zlib. La bonne donnée, elle, est
# toujours lisible sans tout décompresser : /Root -> /Pages -> /Count, un entier que la
# norme PDF garantit égal au nombre de pages FEUILLES de tout l'arbre, quelle que soit sa
# profondeur — inutile donc de descendre dans /Kids.
#
# Une table `xref` classique (PDF antérieur à 1.5, ou réécrit par un autre outil) est prise
# en charge en repli, par simplicité et parce que le coût est faible ; elle ne connaît pas
# les objets compressés, donc pas d'étape ObjStm dans cette branche.

class _PdfIllisible(Exception):
    """Le PDF n'a pas la forme attendue : mieux vaut le dire clairement que de deviner."""


def _trouver_stream(data, debut_dict):
    """À partir de la position qui suit un dictionnaire d'objet, rend (contenu_decompresse,
    position_apres_endstream). `debut_dict` pointe juste après le dictionnaire ('>>')."""
    i = data.find(b'stream', debut_dict)
    if i < 0:
        raise _PdfIllisible('mot-clé stream introuvable')
    j = i + len(b'stream')
    # Le flux commence juste après l'EOL qui suit "stream" (CR LF, ou LF seul — la norme
    # interdit CR seul ici, ce que WeasyPrint respecte).
    if data[j:j + 2] == b'\r\n':
        j += 2
    elif data[j:j + 1] == b'\n':
        j += 1
    k = data.find(b'endstream', j)
    if k < 0:
        raise _PdfIllisible('mot-clé endstream introuvable')
    return data[j:k], k + len(b'endstream')


def _dict_brut(data, pos):
    """Le texte entre le PREMIER « << » à partir de `pos` et son « >> » de fermeture,
    profondeur comptée — un dictionnaire de couverture (Names, Dests…) en contient
    d'imbriqués, une recherche non gourmande s'arrêterait au premier. Rend (texte, fin)."""
    i = data.find(b'<<', pos)
    if i < 0:
        raise _PdfIllisible('dictionnaire introuvable')
    profondeur = 0
    j = i
    while j < len(data):
        if data[j:j + 2] == b'<<':
            profondeur += 1
            j += 2
        elif data[j:j + 2] == b'>>':
            profondeur -= 1
            j += 2
            if profondeur == 0:
                return data[i + 2:j - 2], j
        else:
            j += 1
    raise _PdfIllisible('dictionnaire non refermé')


def _entiers(motif, texte, n=1):
    m = re.search(motif, texte)
    if not m:
        return None
    return tuple(int(x) for x in m.groups()) if n > 1 else int(m.group(1))


def _lire_xref_stream(data, offset):
    """Une section de référence PDF 1.5+ : un objet flux /Type /XRef. Rend (entrees,
    dict_racine) où `entrees[n] = (type, f2, f3)` et `dict_racine` est le texte du
    dictionnaire (pour y lire /Root et un éventuel /Prev)."""
    m = re.match(rb'\s*(\d+)\s+(\d+)\s+obj', data[offset:offset + 40])
    if not m:
        raise _PdfIllisible('pas un objet à cet offset de startxref')
    debut_dict = offset + m.end()
    entete, fin_dict = _dict_brut(data, debut_dict)
    w = _entiers(rb'/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]', entete, 3)
    taille = _entiers(rb'/Size\s+(\d+)', entete)
    if not w or taille is None:
        raise _PdfIllisible('/W ou /Size absent du flux XRef')
    m_index = re.search(rb'/Index\s*\[\s*([\d\s]+)\]', entete)
    if m_index:
        paires = [int(x) for x in m_index.group(1).split()]
        plages = list(zip(paires[0::2], paires[1::2]))
    else:
        plages = [(0, taille)]
    brut, _ = _trouver_stream(data, fin_dict)
    contenu = zlib.decompress(brut)
    largeur = sum(w)
    entrees = {}
    pos = 0
    for depart, compte in plages:
        for k in range(compte):
            rec = contenu[pos:pos + largeur]
            pos += largeur
            c = 0
            champs = []
            for taille_champ in w:
                if taille_champ == 0:
                    champs.append(None)   # défaut de la norme : type=1 si /W[0]==0
                    continue
                champs.append(int.from_bytes(rec[c:c + taille_champ], 'big'))
                c += taille_champ
            t = champs[0] if champs[0] is not None else 1
            entrees[depart + k] = (t, champs[1], champs[2])
    return entrees, entete


def _lire_xref_table(data, offset):
    """Table `xref` classique, en texte : sous-sections « depart compte », puis `compte`
    lignes de 20 octets, puis `trailer` et son dictionnaire. Pas d'objets compressés
    possibles dans ce format — /Prev, s'il existe, chaîne vers une AUTRE table classique."""
    m = re.match(rb'\s*xref\s*\r?\n', data[offset:offset + 20])
    if not m:
        raise _PdfIllisible('pas une table xref à cet offset')
    pos = offset + m.end()
    entrees = {}
    while True:
        m_sec = re.match(rb'(\d+)\s+(\d+)\s*\r?\n', data[pos:pos + 40])
        if not m_sec:
            break
        depart, compte = int(m_sec.group(1)), int(m_sec.group(2))
        pos += m_sec.end()
        for k in range(compte):
            ligne = data[pos:pos + 20]
            pos += 20
            if ligne[17:18] == b'n':
                entrees[depart + k] = (1, int(ligne[0:10]), 0)
    m_tr = re.search(rb'trailer', data[pos:pos + 200])
    if not m_tr:
        raise _PdfIllisible('mot-clé trailer introuvable après la table xref')
    entete, _ = _dict_brut(data, pos + m_tr.end())
    return entrees, entete


def _resoudre_objet(data, entrees, num, _vus=None):
    """Les octets du CONTENU d'un objet (après « N G obj », dictionnaire compris), qu'il
    soit direct (type 1, à un offset) ou compressé dans un flux d'objets (type 2). `_vus`
    coupe une boucle de renvois malformée plutôt que de partir en récursion infinie."""
    _vus = _vus or set()
    if num in _vus:
        raise _PdfIllisible('renvoi circulaire sur l\'objet %d' % num)
    _vus.add(num)
    if num not in entrees:
        raise _PdfIllisible('objet %d absent de la table de références' % num)
    t, f2, f3 = entrees[num]
    if t == 1:
        m = re.match(rb'\s*\d+\s+\d+\s+obj', data[f2:f2 + 40])
        if not m:
            raise _PdfIllisible('objet %d : pas de « obj » à son offset déclaré' % num)
        return data[f2 + m.end():f2 + m.end() + 20000]  # fenêtre large, pas tout le fichier
    if t == 2:
        # f2 = numéro du flux d'objets porteur, f3 = son rang dans ce flux.
        t_flux, off_flux, _ = entrees[f2]
        if t_flux != 1:
            raise _PdfIllisible('flux d\'objets %d lui-même compressé : non géré' % f2)
        m = re.match(rb'\s*\d+\s+\d+\s+obj', data[off_flux:off_flux + 40])
        entete, fin_dict = _dict_brut(data, off_flux + m.end())
        premier = _entiers(rb'/First\s+(\d+)', entete)
        brut, _ = _trouver_stream(data, fin_dict)
        corps = zlib.decompress(brut)
        paires = [int(x) for x in corps[:premier].split()]
        objs_du_flux = list(zip(paires[0::2], paires[1::2]))
        for idx, (onum, ooff) in enumerate(objs_du_flux):
            if onum != num:
                continue
            fin = (premier + objs_du_flux[idx + 1][1] if idx + 1 < len(objs_du_flux)
                   else len(corps))
            return corps[premier + ooff:fin]
        raise _PdfIllisible('objet %d annoncé dans le flux %d mais introuvable' % (num, f2))
    raise _PdfIllisible('objet %d : type d\'entrée %r inconnu' % (num, t))


def compter_pages_pdf(chemin):
    """Le nombre de pages du PDF à `chemin`, lu par /Root -> /Pages -> /Count. Lève
    _PdfIllisible avec un message clair plutôt que de renvoyer un nombre plausible : un dos
    calculé sur un compte inventé serait le défaut que ce script existe pour éviter."""
    data = open(chemin, 'rb').read()
    # Plusieurs « startxref » sont possibles après des mises à jour incrémentales ; seul le
    # DERNIER fait foi — c'est lui que rend `finditer` en dernière position.
    toutes = list(re.finditer(rb'startxref\s+(\d+)', data))
    if not toutes:
        raise _PdfIllisible('mot-clé startxref introuvable — ce n\'est pas un PDF valide '
                            'ou il est tronqué')
    offset = int(toutes[-1].group(1))

    entrees = {}
    racine_dict = None
    vus_offsets = set()
    while offset is not None:
        if offset in vus_offsets:
            break   # chaîne /Prev bouclée : on s'arrête sur ce qu'on a déjà
        vus_offsets.add(offset)
        debut = data[offset:offset + 20].lstrip()
        if debut.startswith(b'xref'):
            nouvelles, entete = _lire_xref_table(data, offset)
        else:
            nouvelles, entete = _lire_xref_stream(data, offset)
        # Une entrée plus ANCIENNE (table /Prev) ne doit jamais écraser une entrée déjà lue
        # depuis une table plus récente.
        for k, v in nouvelles.items():
            entrees.setdefault(k, v)
        if racine_dict is None:
            racine_dict = entete
        prev = _entiers(rb'/Prev\s+(\d+)', entete)
        offset = prev

    racine_ref = _entiers(rb'/Root\s+(\d+)\s+\d+\s+R', racine_dict)
    if racine_ref is None:
        raise _PdfIllisible('/Root introuvable dans le dictionnaire de références')
    catalogue = _resoudre_objet(data, entrees, racine_ref)
    pages_ref = _entiers(rb'/Pages\s+(\d+)\s+\d+\s+R', catalogue)
    if pages_ref is None:
        raise _PdfIllisible('/Pages introuvable dans le Catalog')
    pages_obj = _resoudre_objet(data, entrees, pages_ref)
    compte = _entiers(rb'/Count\s+(\d+)', pages_obj)
    if compte is None:
        raise _PdfIllisible('/Count introuvable dans l\'objet Pages')
    return compte


# ──────────────────────────────────────────────────────────────────────────────────────
# 2. Le dos : la formule de docs/ARCHITECTURE-LIVRES.md §3, et rien de plus.
# ──────────────────────────────────────────────────────────────────────────────────────

# Valeur de DÉPART citée dans ARCHITECTURE-LIVRES.md §3 aux côtés du grammage (90 g/m²) et
# de la main (1,22) — PAS une mesure sur un livre réel, contrairement à ces deux-là. La
# vérification faite dans ce même document (FALC A4, dos mesuré 8,26 mm, 134 pages) ne
# distingue d'ailleurs pas ce terme de l'épaisseur de feuille : (134/2)×0,123 = 8,241 mm
# colle déjà à 0,26 mm près sans lui. Elle reste dans la formule parce que la formule la
# porte, mais ne prétend pas être calibrée sur un livre précis. Ajustable par
# `impression.couverture-mm` dans buch.yaml, comme `dos-mm` : une valeur de l'imprimeur y
# gagne toujours sur ce repli.
COUVERTURE_MM_DEPART = 0.3

FORMATS_MM = {'standard': (155.0, 225.0), 'a4': (210.0, 297.0)}


def calculer_couverture(buch, chemin_pdf_interieur):
    """Rend un dict de mesures : dos_mm, source_dos (pour le journal de compilation),
    nb_pages (None si non lu, parce que dos-mm gagnait), largeur_mm, hauteur_mm.
    N'invente rien : une clé absente de buch.yaml prend le repli documenté ci-dessus,
    jamais une valeur plausible non sourcée.

    ⚠ impression.fond-perdu-mm n'intervient PAS ici : cette clé règle le fond perdu de
    l'IMPRESSION DU CORPS (livre-imprimeur, pas encore construit). Le fond perdu de LA
    COUVERTURE est un choix distinct, indépendant du livre, posé une seule fois dans
    styles/livre/couverture.css (--szh-couv-bleed) — voir son en-tête pour le pourquoi
    (mesuré : la place que WeasyPrint laisse à ses propres traits de coupe et mires, pas
    l'aplomb du papier)."""
    imp = buch.get('impression')
    imp = imp if isinstance(imp, dict) else {}

    fmt = str(buch.get('format') or 'standard')
    if fmt not in FORMATS_MM:
        print('[couverture] format inconnu dans buch.yaml : « %s » — repli « standard ».'
              % fmt, file=sys.stderr)
        fmt = 'standard'
    largeur_mm, hauteur_mm = FORMATS_MM[fmt]

    dos_force = imp.get('dos-mm')
    nb_pages = None
    if dos_force not in (None, ''):
        # L'imprimeur a le dernier mot : sa valeur gagne, le PDF intérieur n'a même pas
        # besoin d'être lu pour ce calcul-là.
        dos_mm = float(dos_force)
        source_dos = 'imposé par buch.yaml (impression.dos-mm)'
    else:
        nb_pages = compter_pages_pdf(chemin_pdf_interieur)
        grammage = float(imp.get('grammage') or 90)
        main_papier = float(imp.get('main') or 1.22)
        couverture_mm = float(imp.get('couverture-mm') or COUVERTURE_MM_DEPART)
        epaisseur_feuille = grammage * main_papier / 1000.0
        dos_mm = (nb_pages / 2.0) * epaisseur_feuille + 2 * couverture_mm
        source_dos = ('calculé : %d pages lues dans %s, %.4g mm/feuille (%.0f g/m², main %.3g)'
                      % (nb_pages, os.path.basename(chemin_pdf_interieur),
                         epaisseur_feuille, grammage, main_papier))

    return {
        'dos_mm': dos_mm, 'source_dos': source_dos, 'nb_pages': nb_pages,
        'largeur_mm': largeur_mm, 'hauteur_mm': hauteur_mm,
    }


# ──────────────────────────────────────────────────────────────────────────────────────
# 3. Assemblage du gabarit.
# ──────────────────────────────────────────────────────────────────────────────────────

_MIME_ILLUSTRATION = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                      '.svg': 'image/svg+xml', '.webp': 'image/webp'}


def _illustration_data_uri(chemin):
    """L'illustration en data: URI, comme les images des chapitres (--embed-resources) :
    la couverture est un fichier HTML isolé, sans dossier media/ à côté une fois sorti de
    out/couverture/. None si aucune illustration n'est fournie — elle est FACULTATIVE."""
    if not chemin:
        return None
    ext = os.path.splitext(chemin)[1].lower()
    mime = _MIME_ILLUSTRATION.get(ext)
    if not mime:
        print('[couverture] illustration ignorée, extension non reconnue : %s' % chemin,
              file=sys.stderr)
        return None
    with open(chemin, 'rb') as f:
        brut = f.read()
    return 'data:%s;base64,%s' % (mime, base64.b64encode(brut).decode('ascii'))


def main(argv):
    opts = {'css': []}
    i = 1
    cles_simples = ('meta', 'pdf-interieur', 'quatrieme', 'illustration', 'gabarit', 'sortie')
    while i < len(argv):
        a = argv[i]
        if a == '--css' and i + 1 < len(argv):
            opts['css'].append(argv[i + 1]); i += 2
        elif a.startswith('--') and a[2:] in cles_simples and i + 1 < len(argv):
            opts[a[2:]] = argv[i + 1]; i += 2
        else:
            print('[couverture] option inconnue ou incomplète : ' + a, file=sys.stderr)
            return 2
    manquants = [c for c in ('meta', 'pdf-interieur', 'quatrieme', 'gabarit', 'sortie')
                if c not in opts]
    if manquants:
        print('usage: couverture.py --meta buch.yaml --pdf-interieur out/livre.pdf '
              '--quatrieme frag.html --gabarit g.html --sortie out.html '
              '[--illustration img] [--css f.css]...', file=sys.stderr)
        print('[couverture] option(s) manquante(s) : ' + ', '.join(manquants), file=sys.stderr)
        return 2

    buch = lire_yaml(opts['meta'])
    if not buch:
        print('[couverture] buch.yaml illisible ou vide : ' + opts['meta'], file=sys.stderr)
        return 1

    try:
        mesures = calculer_couverture(buch, opts['pdf-interieur'])
    except (_PdfIllisible, OSError, ValueError) as e:
        print('[couverture] ✗ impossible de déterminer le dos : %s' % e, file=sys.stderr)
        print('[couverture]   Le PDF intérieur doit être compilé avant la couverture — '
              'ce script le lit, il ne le produit pas.', file=sys.stderr)
        print('[couverture] [de] ✗ Der Buchrücken konnte nicht bestimmt werden: %s' % e,
              file=sys.stderr)
        return 1

    largeur, hauteur = mesures['largeur_mm'], mesures['hauteur_mm']
    dos = mesures['dos_mm']
    largeur_totale = 2 * largeur + dos

    try:
        quatrieme_html = open(opts['quatrieme'], encoding='utf-8').read()
    except OSError as e:
        print('[couverture] fragment de 4e de couverture illisible : %s (%s)'
              % (opts['quatrieme'], e), file=sys.stderr)
        return 1

    illustration_uri = _illustration_data_uri(opts.get('illustration'))

    # Couleur de l'ouvrage : buch.yaml, pas l'accent de la revue (accent-css.py restreint
    # aux six teintes de charte de la REVUE — une couleur de livre hors de cette liste
    # sortirait grise sans un mot, un défaut pire ici que sur un tableau interne). Un texte
    # noir ou blanc est choisi par contraste APCA plutôt que codé en dur : la charte varie
    # d'un livre à l'autre (§5.1 de l'architecture), pas la lisibilité qu'elle doit garder.
    couleur = str(buch.get('couleur') or '').strip()
    if not re.match(r'^#[0-9A-Fa-f]{6}$', couleur):
        couleur = '#8f8f95'   # repli neutre : le gris de --c-annual dans socle.css
    texte_sur_couleur, _ = apca.meilleure_polarite(couleur)
    fond_clair = apca.echelle(couleur)['50']   # même teinte, cran 50 : fond de la 4e/du dos

    try:
        gabarit = open(opts['gabarit'], encoding='utf-8').read()
    except OSError as e:
        print('[couverture] gabarit illisible : %s (%s)' % (opts['gabarit'], e),
              file=sys.stderr)
        return 1

    liens = '\n'.join('  <link rel="stylesheet" href="%s" />' % html.escape(c, quote=True)
                      for c in opts['css'])

    collection = html.escape(str(buch.get('collection') or ''))
    tome = html.escape(str(buch.get('tome') or ''))
    bloc_collection = ''
    if collection:
        bloc_collection = ('<p class="szh-couv-collection">%s%s</p>'
                           % (collection, ' — Tome ' + tome if tome else ''))

    remplacements = {
        '$lang$':            html.escape(str(buch.get('lang') or 'fr')),
        '$largeur-mm$':      '%.3f' % largeur,
        '$hauteur-mm$':      '%.3f' % hauteur,
        '$dos-mm$':          '%.3f' % dos,
        '$largeur-totale-mm$': '%.3f' % largeur_totale,
        '$couleur$':         couleur,
        '$couleur-fond$':    fond_clair,
        '$couleur-texte$':   texte_sur_couleur,
        '$css$':             liens,
        '$titre$':           html.escape(str(buch.get('titre') or '')),
        '$sous-titre$':      html.escape(str(buch.get('sous-titre') or '')),
        '$auteurs$':         html.escape(_auteurs_ligne(buch)),
        '$quatrieme$':       quatrieme_html,
        '$collection$':      bloc_collection,
        '$illustration$':    ('<img src="%s" alt="" />' % html.escape(illustration_uri, quote=True)
                              if illustration_uri else ''),
    }
    sortie = gabarit
    for cle, val in remplacements.items():
        sortie = sortie.replace(cle, val)

    dossier = os.path.dirname(os.path.abspath(opts['sortie']))
    if dossier:
        os.makedirs(dossier, exist_ok=True)
    with open(opts['sortie'], 'w', encoding='utf-8') as fh:
        fh.write(sortie)

    print('[couverture] dos = %.2f mm (%s)' % (dos, mesures['source_dos']), file=sys.stderr)
    print('[couverture] à plat (rogné) : %.1f x %.1f mm (%.1f + %.2f + %.1f)'
          % (largeur_totale, hauteur, largeur, dos, largeur), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
