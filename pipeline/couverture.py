#!/usr/bin/env python3
# couverture.py — compose la couverture d'un livre, en deux versions tirées du même gabarit :
#   * impression : UNE page à plat, 4e + dos + 1re, CMJN exact, fond perdu, traits de coupe
#     et de pli — ce que l'imprimeur massicote (PDF/X-4) ;
#   * écran : deux pages, 1re puis 4e, RGB exact, sans dos ni fond perdu (PDF/UA-1, PNG).
#
#   couverture.py --mode impression|ecran|dos --meta buch.yaml --pdf-interieur out/<livre>.pdf \
#                 --sortie <fichier> [--quatrieme frag.html] [--illustration img] \
#                 [--gabarit szh-couverture.html] [--css f.css]... [--icc-dir /opt/icc]
#   couverture.py --imprimer <impression.html> <sortie.pdf> --meta buch.yaml [--icc-dir …]
#
# --mode dos écrit out/<livre>-dos.json. --imprimer compose le PDF/X-4 par l'API de
# WeasyPrint (il faut donc le python de l'image, /opt/weasyprint/bin/python) : c'est le seul
# moyen de poser une BleedBox à la valeur du fond perdu, WeasyPrint la fixant à 10 pt.
#
# Couleurs : SEULE source, styles/couleurs-reference.json. L'impression prend son CMJN, les
# sorties RGB son RGB ; jamais l'un n'est converti en l'autre. Seule l'illustration
# matricielle passe par un profil ICC (sRGB -> profil d'impression), pour l'impression.
#
# Ce script n'invente aucune métadonnée : une collection ou un tome absents laissent le
# bloc vide, une couleur-impression hors de la liste arrête la compilation.

import base64
import html
import importlib.util
import io
import json
import os
import re
import sys
import zlib

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))

sys.path.insert(0, PIPELINE_DIR)
import szh_commun

lire_yaml = szh_commun.lire_yaml

REFERENCE_COULEURS = os.path.join(PIPELINE_DIR, 'styles', 'couleurs-reference.json')
LOGOS_DIR = os.path.join(PIPELINE_DIR, 'media', 'logos')


def _importer(nom_module, nom_fichier):
    """Importe un module frère par son CHEMIN : livre-assembler.py porte un tiret,
    imprononçable pour `import`. Aucun effet de bord au chargement."""
    chemin = os.path.join(PIPELINE_DIR, nom_fichier)
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# _auteurs_ligne() et _remplacer_jetons() restent dans livre-assembler.py : les recopier
# ici diverguerait à la première modification de l'une des deux copies.
_assembleur = _importer('szh_livre_assembler', 'livre-assembler.py')
_auteurs_ligne = _assembleur._auteurs_ligne
_remplacer_jetons = _assembleur._remplacer_jetons
apca = _importer('szh_apca', 'apca.py')


# ──────────────────────────────────────────────────────────────────────────────────────
# 1. Compte de pages d'un PDF, SANS dépendance externe.
# ──────────────────────────────────────────────────────────────────────────────────────
# Écrit du temps où ce script tournait sous le python3 du système, sans pypdf ; il tourne
# désormais dans celui de WeasyPrint, mais le compte de pages reste lisible sans lui (le
# test du dos l'importe sous n'importe quel python3). Ce lecteur est écrit à la main, et il
# faut le dire : ce n'est pas un analyseur PDF général, c'est un lecteur ciblé sur ce que
# WeasyPrint 69 écrit réellement — mesuré ici sur les deux livres de banc :
#   * table de références sous forme de flux compressé (/Type /XRef), pas la table `xref`
#     classique en texte clair ;
#   * les objets eux-mêmes (Catalog, Pages…) vivent dans des flux d'objets compressés
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
    # dernier fait foi — c'est lui que rend `finditer` en dernière position.
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
        # Une entrée plus ancienne (table /Prev) ne doit jamais écraser une entrée déjà lue
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
# 2. Le dos : la formule du tableur de l'imprimeur (docs/ARCHITECTURE-LIVRES.md, « Calcul
#    du dos »), et rien de plus.
# ──────────────────────────────────────────────────────────────────────────────────────

# Valeurs du tableur Buchrueckenberechnung_2022 : Mondi DNS Premium 90 g vol. 1,27,
# couverture Offset blanc mat vol. 1,3, pas de colle.
DOS_DEFAUTS = {'grammage': 90.0, 'main': 1.27, 'couverture-volume': 1.3, 'colle-mm': 0.0}
# Au-delà, le 250 g casse au pli : la couverture passe en 300 g et le dos se recalcule.
DOS_SEUIL_300_MM = 20.0

FORMATS_MM = {'standard': (155.0, 225.0), 'a4': (210.0, 297.0)}


def _nombre(valeur, defaut):
    return defaut if valeur in (None, '') else float(valeur)


def calculer_dos(nb_pages, impression):
    """{'dos_mm', 'grammage_couverture'} pour `nb_pages` pages intérieures.
    dos = 4 × g_couv/2000 × vol_couv + pages × g_int/2000 × vol_int + colle.
    impression.dos-mm, imposé par l'imprimeur, gagne toujours ; couverture-grammage
    impose le papier de couverture, sinon 250 g sous 20 mm et 300 g au-delà."""
    imp = impression if isinstance(impression, dict) else {}
    g_int = _nombre(imp.get('grammage'), DOS_DEFAUTS['grammage'])
    v_int = _nombre(imp.get('main'), DOS_DEFAUTS['main'])
    v_couv = _nombre(imp.get('couverture-volume'), DOS_DEFAUTS['couverture-volume'])
    colle = _nombre(imp.get('colle-mm'), DOS_DEFAUTS['colle-mm'])

    def dos(g_couv):
        return 4 * g_couv / 2000 * v_couv + nb_pages * g_int / 2000 * v_int + colle

    g_impose = imp.get('couverture-grammage')
    g_impose = None if g_impose in (None, '') else int(float(g_impose))
    if imp.get('dos-mm') not in (None, ''):
        d = float(imp['dos-mm'])
        g = g_impose or (250 if d < DOS_SEUIL_300_MM else 300)
        return {'dos_mm': d, 'grammage_couverture': g}
    if g_impose:
        return {'dos_mm': dos(g_impose), 'grammage_couverture': g_impose}
    d = dos(250)
    if d < DOS_SEUIL_300_MM:
        return {'dos_mm': d, 'grammage_couverture': 250}
    return {'dos_mm': dos(300), 'grammage_couverture': 300}


def source_dos(nb_pages, impression, resultat, nom_pdf):
    """Une ligne lisible pour dos.json et le journal : d'où vient le chiffre."""
    imp = impression if isinstance(impression, dict) else {}
    if imp.get('dos-mm') not in (None, ''):
        return 'imposé par buch.yaml (impression.dos-mm)'
    return ('calculé : 4 × %d/2000 × %g + %d pages (%s) × %g/2000 × %g + %g'
            % (resultat['grammage_couverture'],
               _nombre(imp.get('couverture-volume'), DOS_DEFAUTS['couverture-volume']),
               nb_pages, nom_pdf,
               _nombre(imp.get('grammage'), DOS_DEFAUTS['grammage']),
               _nombre(imp.get('main'), DOS_DEFAUTS['main']),
               _nombre(imp.get('colle-mm'), DOS_DEFAUTS['colle-mm'])))


# ──────────────────────────────────────────────────────────────────────────────────────
# 3. Couleurs : la table de référence, rien d'autre.
# ──────────────────────────────────────────────────────────────────────────────────────

class ErreurCouverture(Exception):
    """Une donnée de buch.yaml empêche de composer : le message dit laquelle."""


def charger_reference():
    with open(REFERENCE_COULEURS, encoding='utf-8') as f:
        return json.load(f)


def _cle_couverture(buch):
    """Le bloc `couverture:` de buch.yaml. SEUL point de lecture de ses clés (fond,
    fond-teinte, illustration-x-mm, illustration-y-mm) : ces noms sont provisoires."""
    couv = buch.get('couverture')
    return couv if isinstance(couv, dict) else {}


def fond_couverture(buch):
    """(clé de référence, teinte en %) du fond de toute la couverture."""
    couv = _cle_couverture(buch)
    cle = str(couv.get('fond') or 'poireau').strip()
    teinte = _nombre(couv.get('fond-teinte'), 9.0)
    return cle, teinte


def decalage_illustration(buch):
    """(x, y) en mm du décalage de l'illustration dans sa zone, + vers la droite et le bas."""
    couv = _cle_couverture(buch)
    return (_nombre(couv.get('illustration-x-mm'), 0.0),
            _nombre(couv.get('illustration-y-mm'), 0.0))


def variables_illustration(buch):
    """Les propriétés CSS du décalage, posées sur <html> à l'identique pour les quatre
    sorties (couverture.css les applique par translate)."""
    x, y = decalage_illustration(buch)
    return '--szh-couv-illus-x: %gmm; --szh-couv-illus-y: %gmm;' % (round(x, 3), round(y, 3))


def _cmjn_css(cmjn):
    return 'device-cmyk(%s)' % ' '.join('%g' % round(v, 4) for v in cmjn)


def _rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))


def teinte_rgb(hexa, pourcent):
    """Mélange arithmétique avec le blanc : round(255 − t × (255 − c))."""
    t = pourcent / 100.0
    return '#%02X%02X%02X' % tuple(int(round(255 - t * (255 - c))) for c in _rgb(hexa))


def teinte_cmjn(cmjn, pourcent):
    """La teinte d'un ton direct se tramerait : t % de chaque encre."""
    return [v * pourcent / 100.0 for v in cmjn]


def palette(buch, ref, mode):
    """Les couleurs de la couverture, toutes en CSS, pour `mode` (impression | ecran)."""
    cle = str(buch.get('couleur-impression') or '').strip()
    if cle not in ref:
        raise ErreurCouverture(
            'couleur-impression « %s » absente ou hors de la liste (%s)'
            % (cle, ', '.join(ref)))
    fond_cle, fond_t = fond_couverture(buch)
    if fond_cle not in ref:
        raise ErreurCouverture('couverture.fond « %s » hors de la liste (%s)'
                               % (fond_cle, ', '.join(ref)))
    accent = ref[cle]
    # Texte sur le bandeau (maquette normal) : noir ou blanc par contraste APCA, jugé sur le
    # RGB de référence ; le CMJN ne sert qu'à l'encre, pas au jugement.
    sur_accent_blanc = apca.meilleure_polarite(accent['rgb'])[0] == apca.BLANC
    if mode == 'impression':
        p = {'encre': _cmjn_css([0, 0, 0, 1]), 'papier': _cmjn_css([0, 0, 0, 0]),
             'accent': _cmjn_css(accent['cmjn']),
             'fond': _cmjn_css(teinte_cmjn(ref[fond_cle]['cmjn'], fond_t))}
    else:
        p = {'encre': '#000000', 'papier': '#FFFFFF', 'accent': accent['rgb'].upper(),
             'fond': teinte_rgb(ref[fond_cle]['rgb'], fond_t)}
    p['sur-accent'] = p['papier'] if sur_accent_blanc else p['encre']
    p['cle'] = cle
    return p


# ──────────────────────────────────────────────────────────────────────────────────────
# 4. Images : illustration et logos.
# ──────────────────────────────────────────────────────────────────────────────────────

_MIME_ILLUSTRATION = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                      '.svg': 'image/svg+xml', '.webp': 'image/webp'}


def _data_uri(mime, brut):
    return 'data:%s;base64,%s' % (mime, base64.b64encode(brut).decode('ascii'))


def illustration_cmjn(chemin, profil_icc, fond_rgb):
    """L'illustration RGB en JPEG CMJN, par le profil d'impression : intention relative
    colorimétrique et compensation du point noir. Une transparence est aplatie sur le fond
    RGB de la couverture, faute d'alpha en CMJN."""
    from PIL import Image, ImageCms
    im = Image.open(chemin)
    source = None
    if im.info.get('icc_profile'):
        source = ImageCms.ImageCmsProfile(io.BytesIO(im.info['icc_profile']))
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        plat = Image.new('RGB', im.size, _rgb(fond_rgb))
        plat.paste(im, mask=im.split()[-1])
        im = plat
    elif im.mode == 'CMYK':   # déjà séparée : on n'y touche pas
        tampon = io.BytesIO()
        im.save(tampon, 'JPEG', quality=95, subsampling=0)
        return _data_uri('image/jpeg', tampon.getvalue())
    else:
        im = im.convert('RGB')
    cmjn = ImageCms.profileToProfile(
        im, source or ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')), profil_icc,
        renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC, outputMode='CMYK',
        flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
    tampon = io.BytesIO()
    cmjn.save(tampon, 'JPEG', quality=95, subsampling=0)
    return _data_uri('image/jpeg', tampon.getvalue())


def illustration_uri(chemin, mode, profil_icc, fond_rgb):
    """data: URI de l'illustration (facultative), ou None."""
    if not chemin:
        return None
    ext = os.path.splitext(chemin)[1].lower()
    mime = _MIME_ILLUSTRATION.get(ext)
    if not mime:
        print('[couverture] illustration ignorée, extension non reconnue : %s' % chemin,
              file=sys.stderr)
        return None
    if mode == 'impression' and ext != '.svg':
        return illustration_cmjn(chemin, profil_icc, fond_rgb)
    if mode == 'impression':
        print('[couverture] ⚠ illustration SVG : ses couleurs passent telles quelles dans le '
              'PDF d\'impression, sans conversion CMJN.', file=sys.stderr)
    return _data_uri(mime, open(chemin, 'rb').read())


def logo_uri(nom, encre, papier):
    """Un logo de media/logos/, noir passé à `encre`, blanc à `papier` (device-cmyk pour
    l'impression, hex pour l'écran), en data: URI pour un <img>."""
    with open(os.path.join(LOGOS_DIR, nom), encoding='utf-8') as f:
        svg = f.read()
    svg = svg.replace('#000000', encre).replace('#FFFFFF', papier)
    return _data_uri('image/svg+xml', svg.encode('utf-8'))


# ──────────────────────────────────────────────────────────────────────────────────────
# 5. Libellés et blocs de la maquette.
# ──────────────────────────────────────────────────────────────────────────────────────

MENTION_EDITEURS = {'fr': 'éd.', 'de': 'Hrsg.', 'it': 'a cura di'}
MOT_LIVRE = {'fr': 'Livre', 'de': 'Buch', 'it': 'Libro'}
MOT_TOME = {'fr': 'Tome', 'de': 'Band', 'it': 'Volume'}
ALT_PICTO = {'fr': 'Logo Facile à lire et à comprendre', 'de': 'Logo Leichte Sprache',
             'it': 'Logo Lingua facile'}
ALT_EDITION = 'EDITION SZH/CSPS'


def responsables(buch, lang):
    """Les auteur·e·s ; à défaut, les éditeur·rice·s suivi·e·s de leur mention entre
    parenthèses (« Prénom Nom et Prénom Nom (Éditrices) »)."""
    ligne = _auteurs_ligne(buch, lang)
    if ligne:
        return ligne
    ligne = _auteurs_ligne({'auteurs': buch.get('editeurs')}, lang)
    if not ligne:
        return ''
    mention = str(buch.get('mention-editeurs') or '').strip() or \
        MENTION_EDITEURS.get(lang, MENTION_EDITEURS['fr'])
    return '%s (%s)' % (ligne, mention)


def _img(classe, uri, alt):
    return '<img class="%s" src="%s" alt="%s" />' % (
        classe, html.escape(uri, quote=True), html.escape(alt, quote=True))


def blocs_maquette(buch, lang, maquette, couleurs, titre, resp):
    """(pied de 1re, contenu du dos) selon la maquette. FALC : picto, collection et logo
    en pied, tome/titre/responsables/symbole au dos. Normal : collection et mention texte
    en pied, titre et responsables sur une ligne au dos."""
    collection = html.escape(str(buch.get('collection') or ''))
    tome = html.escape(str(buch.get('tome') or ''))
    # Le dos se lit de bas en haut : la ligne commence par les responsables, qui tombent
    # ainsi sous le titre une fois tournée.
    ligne_dos = ('<div class="szh-couv-dos-texte"><span class="szh-couv-dos-auteurs">%s</span>'
                 '<span class="szh-couv-dos-titre">%s</span></div>' % (resp, titre))
    if maquette == 'falc':
        lignes = [x for x in (collection, (MOT_LIVRE.get(lang, MOT_LIVRE['fr']) + ' ' + tome)
                              if tome else '') if x]
        pied = '\n'.join([
            # Picto plein : son blanc est une réserve dans l'encre, donc la couleur du fond.
            _img('szh-couv-picto', logo_uri('leichte-sprache.svg', couleurs['accent'],
                                            couleurs['fond']),
                 ALT_PICTO.get(lang, ALT_PICTO['fr'])),
            '<p class="szh-couv-1re-collection">%s</p>' % '<br />'.join(lignes),
            _img('szh-couv-logo', logo_uri('edition-szh-csps.svg', couleurs['accent'],
                                           couleurs['papier']), ALT_EDITION)])
        dos = '\n'.join([
            '<p class="szh-couv-dos-tome">%s</p>' % tome if tome else '',
            ligne_dos,
            _img('szh-couv-dos-symbole', logo_uri('edition-szh-csps-symbole.svg',
                                                  couleurs['accent'], couleurs['papier']),
                 ALT_EDITION)])
        return pied, dos
    bloc = ''
    if collection:
        bloc = '%s%s' % (collection, (' — %s %s' % (MOT_TOME.get(lang, MOT_TOME['fr']), tome))
                         if tome else '')
    pied = ('<div class="szh-couv-1re-collection">%s</div>\n'
            '<p class="szh-couv-1re-edition">Edition SZH/CSPS</p>' % bloc)
    return pied, ligne_dos


# Traits de coupe et de pli, hors du fond perdu : à TRAIT_ECART du bord peint, longs de
# TRAIT_LONGUEUR. Tracés en éléments CSS et non par `marks: crop` : WeasyPrint dessine ses
# traits en RGB (`0 0 0 rg`), interdit en PDF/X-4.
TRAIT_ECART_MM = 1.0
TRAIT_LONGUEUR_MM = 5.0
TRAIT_EPAISSEUR_MM = 0.25 * 25.4 / 72      # 0,25 pt
MARGE_TRAITS_MM = TRAIT_ECART_MM + TRAIT_LONGUEUR_MM + 1.0


def traits(largeur, dos, hauteur, fp):
    """Les divs des traits, en mm depuis le coin haut-gauche du rogné : coupe aux quatre
    coins, pli aux deux bords du dos, en haut et en bas."""
    e = TRAIT_EPAISSEUR_MM
    a, b = fp + TRAIT_ECART_MM, fp + TRAIT_ECART_MM + TRAIT_LONGUEUR_MM
    total = 2 * largeur + dos
    rects = []
    for x in (0.0, total):
        sx = -1 if x == 0 else 1
        for y in (0.0, hauteur):
            sy = -1 if y == 0 else 1
            rects.append(('coupe', min(x + sx * a, x + sx * b), y - e / 2, b - a, e))
            rects.append(('coupe', x - e / 2, min(y + sy * a, y + sy * b), e, b - a))
    for x in (largeur, largeur + dos):
        rects.append(('pli', x - e / 2, -b, e, b - a))
        rects.append(('pli', x - e / 2, hauteur + a, e, b - a))
    return '\n'.join(
        '<div class="szh-couv-trait szh-couv-trait-%s" style="left: %.3fmm; top: %.3fmm; '
        'width: %.3fmm; height: %.3fmm"></div>' % r for r in rects)


# ──────────────────────────────────────────────────────────────────────────────────────
# 6. Assemblage du gabarit et composition.
# ──────────────────────────────────────────────────────────────────────────────────────

def profil_icc(buch, icc_dir):
    """Chemin du profil CMJN d'impression.profil-cmjn (un seul profil pour tout)."""
    imp = buch.get('impression') if isinstance(buch.get('impression'), dict) else {}
    nom = str(imp.get('profil-cmjn') or 'PSOuncoated_v3_FOGRA52.icc').strip()
    for c in (os.path.join(icc_dir or '', nom), nom):
        if os.path.isfile(c):
            return os.path.abspath(c)
    raise ErreurCouverture('profil CMJN introuvable : « %s » (cherché dans %s/ puis tel quel)'
                           % (nom, icc_dir))


def fond_perdu_mm(buch):
    imp = buch.get('impression') if isinstance(buch.get('impression'), dict) else {}
    return _nombre(imp.get('fond-perdu-mm'), 3.0)


def mesures(buch, pdf_interieur):
    imp = buch.get('impression') if isinstance(buch.get('impression'), dict) else {}
    fmt = str(buch.get('format') or 'standard')
    if fmt not in FORMATS_MM:
        print('[couverture] format inconnu dans buch.yaml : « %s » — repli « standard ».'
              % fmt, file=sys.stderr)
        fmt = 'standard'
    nb_pages = compter_pages_pdf(pdf_interieur)
    r = calculer_dos(nb_pages, imp)
    r.update(nb_pages=nb_pages, format=fmt, largeur_mm=FORMATS_MM[fmt][0],
             hauteur_mm=FORMATS_MM[fmt][1],
             source=source_dos(nb_pages, imp, r, os.path.basename(pdf_interieur)))
    return r


def composer(opts, buch, mode):
    lang = str(buch.get('lang') or 'fr')
    maquette = 'falc' if str(buch.get('maquette') or '') == 'falc' else 'normal'
    ref = charger_reference()
    m = mesures(buch, opts['pdf-interieur'])
    L, H, D = m['largeur_mm'], m['hauteur_mm'], m['dos_mm']
    couleurs = palette(buch, ref, mode)
    impression = mode == 'impression'
    fp = fond_perdu_mm(buch) if impression else 0.0
    icc = profil_icc(buch, opts.get('icc-dir')) if impression else None

    fond_cle, fond_t = fond_couverture(buch)
    illus = illustration_uri(opts.get('illustration'), mode, icc,
                             teinte_rgb(ref[fond_cle]['rgb'], fond_t))
    # « // » : saut de ligne en 1re de couverture, espace simple au dos et dans <title>.
    titre = html.escape(szh_commun.titre_plat(buch.get('titre')))
    titre_bloc = '<br />'.join(html.escape(x) for x in szh_commun.titre_lignes(buch.get('titre')))
    sous_titre_bloc = '<br />'.join(
        html.escape(x) for x in szh_commun.titre_lignes(buch.get('sous-titre')))
    resp = html.escape(responsables(buch, lang))
    pied, dos = blocs_maquette(buch, lang, maquette, couleurs, titre, resp)

    if impression:
        page = ('@color-profile --szh-cmjn { src: url("file://%s"); '
                'components: cyan, magenta, yellow, black; }\n'
                '@page { size: %.3fmm %.3fmm; margin: 0; bleed: %.3fmm; }'
                % (icc, 2 * L + D, H, fp + MARGE_TRAITS_MM))
        imp = buch.get('impression') if isinstance(buch.get('impression'), dict) else {}
        les_traits = '' if imp.get('traits-de-coupe') is False else traits(L, D, H, fp)
    else:
        page = '@page { size: %.3fmm %.3fmm; margin: 0; }' % (L, H)
        les_traits = ''

    variables = ('--szh-couv-largeur: %.3fmm; --szh-couv-dos: %.3fmm; --szh-couv-hauteur: '
                 '%.3fmm; --szh-couv-fp: %.3fmm; --c-couv-encre: %s; --c-couv-papier: %s; '
                 '--c-couv-accent: %s; --c-couv-fond: %s; --c-couv-sur-accent: %s;'
                 % (L, D, H, fp, couleurs['encre'], couleurs['papier'], couleurs['accent'],
                    couleurs['fond'], couleurs['sur-accent'])) + ' ' + variables_illustration(buch)
    classes = 'szh-couv-%s szh-couv-%s szh-couv-%s' % (
        'impression' if impression else 'ecran', maquette, m['format'])

    quatrieme = open(opts['quatrieme'], encoding='utf-8').read()
    gabarit = open(opts['gabarit'], encoding='utf-8').read()
    liens = '\n'.join('  <link rel="stylesheet" href="%s" />' % html.escape(c, quote=True)
                      for c in opts['css'])
    remplacements = {
        '$lang$': html.escape(lang),
        '$classes$': classes,
        '$variables$': variables,
        '$css$': liens,
        '$style-page$': page,
        '$titre$': titre,
        '$titre-bloc$': titre_bloc,
        '$sous-titre-bloc$': sous_titre_bloc,
        '$responsables$': resp,
        '$quatrieme$': quatrieme,
        '$illustration$': ('<div class="szh-couv-1re-cadre"><div class="szh-couv-1re-illustration" '
                           'style="background-image: url(%s)"></div></div>' % illus)
                          if illus else '',
        '$pied$': pied,
        '$dos$': dos,
        '$traits$': les_traits,
    }
    return _remplacer_jetons(gabarit, remplacements), m


def ecrire_dos(opts, buch):
    m = mesures(buch, opts['pdf-interieur'])
    donnees = {'nb_pages': m['nb_pages'], 'dos_mm': round(m['dos_mm'], 4),
               'grammage_couverture': m['grammage_couverture'], 'source': m['source']}
    with open(opts['sortie'], 'w', encoding='utf-8', newline='\n') as f:
        json.dump(donnees, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('[couverture] dos = %.2f mm, couverture %d g (%s)'
          % (m['dos_mm'], m['grammage_couverture'], m['source']), file=sys.stderr)


def _couleurs_rgb(chemin):
    """Opérateurs rg/RG et images RGB restés dans un PDF, Form XObjects compris."""
    import pypdf
    r = pypdf.PdfReader(chemin)
    vus, trouves = set(), []

    def flux(data):
        trouves.extend(re.findall(r'(?<![\w.])[\d.]+ [\d.]+ [\d.]+ (?:rg|RG)\b',
                                  data.decode('latin1')))

    def ressources(res):
        res = res.get_object() if res else None
        for x in ((res or {}).get('/XObject') or {}).values():
            o = x.get_object()
            if id(o) in vus:
                continue
            vus.add(id(o))
            if o.get('/Subtype') == '/Form':
                flux(o.get_data())
                ressources(o.get('/Resources'))
            elif 'RGB' in str(o.get('/ColorSpace')):
                trouves.append('image ' + str(o.get('/ColorSpace')))

    for p in r.pages:
        c = p.get_contents()
        if c is not None:
            flux(c.get_data())
        ressources(p.get('/Resources'))
    return trouves


def imprimer(source_html, sortie_pdf, buch):
    """HTML d'impression -> PDF/X-4, OutputIntent du profil, BleedBox = fond perdu. Échoue
    (code 1) s'il reste du RGB : un PDF d'impression faux ne part jamais."""
    import logging
    import pydyf
    import weasyprint
    logging.basicConfig(level=logging.WARNING, format='[weasyprint] %(message)s')
    marge = fond_perdu_mm(buch) * 72 / 25.4

    def poser_bleedbox(_document, pdf):
        # WeasyPrint fixe la BleedBox à min(bleed, 10 pt) du rogné ; le fond perdu réel est
        # celui de buch.yaml, le reste du bleed CSS ne sert qu'aux traits.
        for obj in pdf.objects:
            if isinstance(obj, dict) and 'TrimBox' in obj:
                x0, y0, x1, y1 = (float(v) for v in obj['TrimBox'])
                obj['BleedBox'] = pydyf.Array([x0 - marge, y0 - marge, x1 + marge, y1 + marge])

    tmp = sortie_pdf + '.tmp'
    weasyprint.HTML(source_html).write_pdf(tmp, pdf_variant='pdf/x-4',
                                           output_intent='--szh-cmjn', finisher=poser_bleedbox)
    restes = _couleurs_rgb(tmp)
    if restes:
        os.remove(tmp)
        raise ErreurCouverture('%d couleur(s) RGB dans le PDF d\'impression, ex. %s'
                               % (len(restes), restes[:3]))
    os.replace(tmp, sortie_pdf)


def main(argv):
    try:  # console Windows en cp1252 : un accent combinant (nom venu du partage) y plante.
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    opts = {'css': [], 'icc-dir': '/opt/icc'}
    i = 1
    cles = ('mode', 'meta', 'pdf-interieur', 'quatrieme', 'illustration', 'gabarit',
            'sortie', 'icc-dir')
    while i < len(argv):
        a = argv[i]
        if a == '--css' and i + 1 < len(argv):
            opts['css'].append(argv[i + 1]); i += 2
        elif a == '--imprimer' and i + 2 < len(argv):
            opts['imprimer'] = (argv[i + 1], argv[i + 2]); i += 3
        elif a.startswith('--') and a[2:] in cles and i + 1 < len(argv):
            opts[a[2:]] = argv[i + 1]; i += 2
        else:
            print('[couverture] option inconnue ou incomplète : ' + a, file=sys.stderr)
            return 2

    buch = lire_yaml(opts.get('meta', ''))
    if not buch:
        print('[couverture] buch.yaml illisible ou vide : %s' % opts.get('meta'),
              file=sys.stderr)
        return 1
    try:
        if 'imprimer' in opts:
            imprimer(opts['imprimer'][0], opts['imprimer'][1], buch)
            return 0
        mode = opts.get('mode')
        requis = {'dos': ('pdf-interieur', 'sortie'),
                  'impression': ('pdf-interieur', 'quatrieme', 'gabarit', 'sortie'),
                  'ecran': ('pdf-interieur', 'quatrieme', 'gabarit', 'sortie')}
        if mode not in requis or any(c not in opts for c in requis[mode]):
            print('usage: couverture.py --mode dos|impression|ecran --meta buch.yaml '
                  '--pdf-interieur out/livre.pdf --sortie f [--quatrieme frag.html '
                  '--gabarit g.html] [--illustration img] [--css f.css]... [--icc-dir d]\n'
                  '       couverture.py --imprimer impression.html sortie.pdf --meta buch.yaml',
                  file=sys.stderr)
            return 2
        if mode == 'dos':
            ecrire_dos(opts, buch)
            return 0
        sortie, m = composer(opts, buch, mode)
    except _PdfIllisible as e:
        print('[couverture] ✗ impossible de déterminer le dos : %s' % e, file=sys.stderr)
        print('[couverture]   Le PDF intérieur doit être compilé avant la couverture — '
              'ce script le lit, il ne le produit pas.', file=sys.stderr)
        print('[couverture] [de] ✗ Der Buchrücken konnte nicht bestimmt werden: %s' % e,
              file=sys.stderr)
        return 1
    except (ErreurCouverture, OSError, ValueError) as e:
        print('[couverture] ✗ %s' % e, file=sys.stderr)
        print('[couverture] [de] ✗ Umschlag nicht erstellt: %s' % e, file=sys.stderr)
        return 1

    dossier = os.path.dirname(os.path.abspath(opts['sortie']))
    os.makedirs(dossier, exist_ok=True)
    with open(opts['sortie'], 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(sortie)
    if mode == 'impression':
        print('[couverture] à plat (rogné) : %.1f x %.1f mm (%.1f + %.2f + %.1f)'
              % (2 * m['largeur_mm'] + m['dos_mm'], m['hauteur_mm'], m['largeur_mm'],
                 m['dos_mm'], m['largeur_mm']), file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
