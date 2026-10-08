#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Contrôle du PDF imprimeur : le texte de labeur doit sortir en noir K seul.

    python3 test/cmjn-check.py <pdf-imprimeur.pdf> [autre.pdf …]
    python3 test/cmjn-check.py --python /opt/weasyprint/bin/python <pdf…>   (relance sous ce venv)

pypdf n'existe que dans le venv WeasyPrint de l'image. Sans lui, le script se relance sous
--python, sinon $SZH_CMJN_PYTHON, sinon /opt/weasyprint/bin/python (même règle que
CMJN_PYTHON dans pipeline/profils/livre.mk).

Trois défauts recherchés, ceux que pipeline/cmjn.py doit empêcher :

1. Un opérateur `rg`/`RG` (RVB) dans un flux de contenu de page : ni pipeline/cmjn.py ni
   Ghostscript ne l'a converti.

2. Un texte de labeur qui n'est pas en noir K seul (`0 0 0 1 k`). On lit le dernier
   opérateur de couleur de remplissage avant chaque `BT` (début de bloc texte) : s'il est
   presque noir sans être K seul, Ghostscript a reconverti le noir en quadrichromie, ou en
   C+M+J sans plaque noire (voir docs/ARCHITECTURE-LIVRES.md).

3. Une image restée en DeviceRGB ou dans un espace dérivé (ICCBased à 3 composantes,
   CalRGB) : Ghostscript ne l'a pas convertie.

Sortie : 0 si tout est en ordre, 1 si un défaut est trouvé, 2 en cas d'erreur d'usage ou
d'environnement (pypdf introuvable, PDF illisible). Un bilan par page est imprimé.
"""

import os
import re
import sys


def _extraire_python_relance(argv):
    """(chemin interprète ou None, arguments restants). Enlève --python <chemin> de argv."""
    reste = list(argv)
    if '--python' in reste:
        i = reste.index('--python')
        if i + 1 >= len(reste):
            print('[cmjn-check] --python attend un chemin', file=sys.stderr)
            sys.exit(2)
        chemin = reste[i + 1]
        del reste[i:i + 2]
        return chemin, reste
    return None, reste


def _assurer_pypdf(argv):
    """Relance ce script sous un interprète qui porte pypdf, si l'actuel ne l'a pas."""
    try:
        import pypdf  # noqa: F401
        return
    except ImportError:
        pass
    candidat, reste = _extraire_python_relance(argv)
    if not candidat:
        candidat = os.environ.get('SZH_CMJN_PYTHON', '/opt/weasyprint/bin/python')
    if candidat and os.path.exists(candidat) \
            and os.path.abspath(candidat) != os.path.abspath(sys.executable):
        os.execv(candidat, [candidat, os.path.abspath(__file__)] + reste[1:])
    print("[cmjn-check] pypdf introuvable sous %s, et aucun interprète de secours "
          "utilisable (cherché : %s). Relancez avec --python /opt/weasyprint/bin/python."
          % (sys.executable, candidat), file=sys.stderr)
    print("[cmjn-check] [de] pypdf fehlt unter %s, kein Ersatz-Interpreter gefunden (%s)."
          % (sys.executable, candidat), file=sys.stderr)
    sys.exit(2)


_assurer_pypdf(sys.argv)

import pypdf  # noqa: E402  (après la relance éventuelle)


# Même seuil de noirceur que pipeline/cmjn.py::is_dark_neutral, sans son critère de
# neutralité : un noir quadri ou C+M+J sorti de Ghostscript (par exemple
# 0.89/0.784/0.616/0.969) n'est pas un gris neutre une fois ramené en RVB. Les couleurs de
# la maison restent au-dessus du seuil (« Nuit », la plus sombre, vers 0,40).
SEUIL_SOMBRE = 0.35
TOLERANCE_K_SEUL = 0.005

RE_RG = re.compile(r'(?<![A-Za-z])[\d.]+\s+[\d.]+\s+[\d.]+\s+(rg|RG)(?![A-Za-z])')
# Couleur de remplissage posée par k/K (4 nombres) ou par scn sous un espace CMJN.
RE_COULEUR_CMJN = re.compile(
    r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(k|K|scn)(?![A-Za-z])')
RE_BT = re.compile(r'(?<![A-Za-z])BT(?![A-Za-z])')
RE_ET = re.compile(r'(?<![A-Za-z])ET(?![A-Za-z])')


def _semble_noir(c, m, y, k):
    """Vrai si la couleur, ramenée en RVB approché ((1-x)(1-k), sans profil), passe sous
    SEUIL_SOMBRE."""
    r, g, b = (1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)
    return max(r, g, b) < SEUIL_SOMBRE


def _est_k_seul(c, m, y, k):
    return (abs(c) < TOLERANCE_K_SEUL and abs(m) < TOLERANCE_K_SEUL
            and abs(y) < TOLERANCE_K_SEUL and abs(k - 1.0) < TOLERANCE_K_SEUL)


def _flux_page(page):
    """Flux de contenu d'une page, décompressé, en latin-1 comme dans
    pipeline/cmjn.py::convert_stream."""
    contenu = page.get_contents()
    if contenu is None:
        return ''
    try:
        return contenu.get_data().decode('latin-1', errors='ignore')
    except Exception:
        return ''


def _texte_avant_bt_defauts(donnees):
    """Défauts « texte noir pas en K seul ». Pour chaque BT, le dernier opérateur de couleur
    CMJN depuis le ET précédent doit, s'il semble noir, être exactement K seul. Ghostscript
    glisse parfois q/cm entre la couleur et BT : on prend le dernier opérateur avant BT,
    pas forcément l'opérateur adjacent."""
    defauts = []
    debut_segment = 0
    for m_bt in RE_BT.finditer(donnees):
        segment = donnees[debut_segment:m_bt.start()]
        dernier = None
        for m_c in RE_COULEUR_CMJN.finditer(segment):
            dernier = m_c
        if dernier:
            c, mm, y, k = (float(dernier.group(i)) for i in (1, 2, 3, 4))
            if _semble_noir(c, mm, y, k) and not _est_k_seul(c, mm, y, k):
                defauts.append(dernier.group(0).strip())
        # Segment suivant : à partir du ET qui ferme ce BT.
        m_et = RE_ET.search(donnees, m_bt.end())
        debut_segment = m_et.end() if m_et else m_bt.end()
    return defauts


def _genre_colorspace(cs, profondeur=0):
    """'RGB' | 'CMYK' | 'Gray' | 'Lab' | 'Indexed:<base>' | 'Inconnu(...)'."""
    if profondeur > 4 or cs is None:
        return 'Inconnu(vide)'
    obj = cs.get_object() if hasattr(cs, 'get_object') else cs
    if isinstance(obj, (str,)) or hasattr(obj, 'startswith'):
        nom = str(obj)
        if 'DeviceRGB' in nom:
            return 'RGB'
        if 'DeviceCMYK' in nom:
            return 'CMYK'
        if 'DeviceGray' in nom:
            return 'Gray'
        return 'Inconnu(%s)' % nom
    try:
        elements = list(obj)
    except TypeError:
        return 'Inconnu(%r)' % (obj,)
    if not elements:
        return 'Inconnu(vide)'
    tete = str(elements[0].get_object() if hasattr(elements[0], 'get_object') else elements[0])
    if tete == '/ICCBased':
        flux = elements[1].get_object()
        n = flux.get('/N')
        return {1: 'Gray', 3: 'RGB', 4: 'CMYK'}.get(int(n) if n is not None else -1,
                                                     'Inconnu(ICCBased N=%s)' % n)
    if tete == '/CalRGB':
        return 'RGB'
    if tete == '/CalGray':
        return 'Gray'
    if tete == '/Lab':
        return 'Lab'
    if tete == '/Indexed' and len(elements) > 1:
        return 'Indexed:' + _genre_colorspace(elements[1], profondeur + 1)
    if tete in ('/Separation', '/DeviceN') and len(elements) > 2:
        return _genre_colorspace(elements[2], profondeur + 1)
    return 'Inconnu(%s)' % tete


def _images_rvb(page):
    """[(nom, genre)] des XObjects image dont l'espace colorimétrique est RVB (ou dérivé)."""
    defauts = []
    try:
        ressources = page.get('/Resources')
        xobjects = ressources.get('/XObject') if ressources else None
    except Exception:
        return defauts
    if not xobjects:
        return defauts
    for nom, ref in xobjects.items():
        try:
            obj = ref.get_object()
        except Exception:
            continue
        if obj.get('/Subtype') != '/Image':
            continue
        genre = _genre_colorspace(obj.get('/ColorSpace'))
        if genre == 'RGB' or genre.startswith('Indexed:RGB'):
            defauts.append((nom, genre))
    return defauts


def controler_pdf(chemin):
    """(ok: bool, lignes du bilan)."""
    lignes = []
    try:
        lecteur = pypdf.PdfReader(chemin)
    except Exception as e:
        return False, ['[cmjn-check] ✗ %s : PDF illisible (%s)' % (chemin, e)]

    ok_global = True
    n_pages = len(lecteur.pages)
    lignes.append('[cmjn-check] %s — %d page(s)' % (chemin, n_pages))
    total_rg = total_noir_faux = total_rvb = 0

    for i, page in enumerate(lecteur.pages):
        donnees = _flux_page(page)
        rg_trouves = RE_RG.findall(donnees)
        noir_faux = _texte_avant_bt_defauts(donnees)
        images_rvb = _images_rvb(page)

        etat = 'ok'
        details = []
        if rg_trouves:
            etat = 'FAIL'
            total_rg += len(rg_trouves)
            details.append('%d opérateur(s) rg/RG' % len(rg_trouves))
        if noir_faux:
            etat = 'FAIL'
            total_noir_faux += len(noir_faux)
            details.append('texte noir pas K seul : %s' % '; '.join(noir_faux[:3]))
        if images_rvb:
            etat = 'FAIL'
            total_rvb += len(images_rvb)
            details.append('image(s) RVB : %s'
                           % ', '.join('%s(%s)' % (n, g) for n, g in images_rvb))

        marque = '✓' if etat == 'ok' else '✗'
        ligne = '  %s page %2d' % (marque, i)
        if details:
            ligne += ' — ' + ' | '.join(details)
        lignes.append(ligne)
        if etat == 'FAIL':
            ok_global = False

    lignes.append('[cmjn-check] bilan %s : %d rg/RG, %d texte(s) noir hors K seul, '
                  '%d image(s) RVB.' % (chemin, total_rg, total_noir_faux, total_rvb))
    if ok_global:
        lignes.append('[cmjn-check] ✓ %s : noir de labeur en K seul, images en CMJN, '
                      'aucun RVB résiduel.' % chemin)
        lignes.append('[cmjn-check] [de] ✓ %s: Schwarz nur über K, Bilder in CMYK, '
                      'kein RGB übrig.' % chemin)
    else:
        lignes.append('[cmjn-check] ✗ %s : ce PDF ne peut pas partir chez l\'imprimeur tel '
                      'quel — un texte de labeur en quadrichromie franerait au moindre '
                      'défaut de repérage.' % chemin)
        lignes.append('[cmjn-check] [de] ✗ %s: dieses PDF kann so nicht zur Druckerei — '
                      'vierfarbig gesetzter Fliesstext würde bei kleinstem Passerfehler '
                      'ausfransen.' % chemin)
    return ok_global, lignes


def main(argv):
    _, chemins = _extraire_python_relance(argv[1:])
    if not chemins:
        print(__doc__, file=sys.stderr)
        return 2
    ok = True
    for chemin in chemins:
        bien, lignes = controler_pdf(chemin)
        print('\n'.join(lignes))
        ok = ok and bien
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
