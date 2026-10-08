#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Conversion en CMJN d'un PDF de WeasyPrint pour l'imprimerie, en deux étapes.

Usage : cmjn.py <entree.pdf> <sortie.pdf> [profil.icc]

Étape 1 : dans les flux de contenu (WeasyPrint n'écrit que du RVB, rg/RG), trois règles :

a) Texte noir : un `rg` neutre sombre suivi immédiatement de `BT` (début de texte) devient
   `0 0 0 1 k` (noir seul). Un `rg` suivi d'un tracé (re, m, c…) n'est pas concerné : un
   aplat noir n'est pas du texte.

b) Les couleurs de la maison prennent leur CMJN officiel, lu dans
   pipeline/styles/couleurs-reference.json (table partagée avec couverture.py, vérifiée
   par test/js/cmjn-couleurs.test.js).

c) Blanc `1 1 1 rg` -> `0 0 0 0 k` (pas d'encre).

Étape 2 : Ghostscript convertit le reste par le profil ICC (voir passe_ghostscript).
"""

import os
import subprocess
import sys
import re
import json

import pypdf
from pypdf.generic import StreamObject

REFERENCE_COULEURS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  'styles', 'couleurs-reference.json')


def lire_reference():
    """La table de référence des couleurs de maison : {clé: {nom, rgb, cmjn}}."""
    with open(REFERENCE_COULEURS, encoding='utf-8') as f:
        return json.load(f)


def hex_to_rgb(hexc):
    """Convertit #RRGGBB en tuple (R, G, B) normalisés à [0, 1]."""
    hexc = hexc.lstrip('#')
    r = int(hexc[0:2], 16) / 255.0
    g = int(hexc[2:4], 16) / 255.0
    b = int(hexc[4:6], 16) / 255.0
    return (r, g, b)


def is_dark_neutral(r, g, b, tolerance=0.05):
    """
    Vrai si (r, g, b) est un neutre sombre : max < 0.35 (l'encre de la maison #16161F
    vaut 0.086, 0.086, 0.122) et écart entre composantes < tolerance.
    """
    max_val = max(r, g, b)
    min_val = min(r, g, b)
    spread = max_val - min_val
    return max_val < 0.35 and spread < tolerance


def format_cmyk(c, m, y, k):
    """Formate un quadruplet CMJN pour le PDF."""
    def fmt(v):
        # Arrondi, sans -0.0
        v = round(v, 6)
        if v == 0.0:
            return "0"
        return str(v).rstrip('0').rstrip('.')

    return f"{fmt(c)} {fmt(m)} {fmt(y)} {fmt(k)}"


class CMYKConverter:
    """Convertisseur des opérateurs de couleur d'un flux PDF."""

    def __init__(self):
        # Les couleurs de maison : RGB normalisé -> CMJN du graphiste, en [0, 1].
        self.house_colors = {hex_to_rgb(c['rgb']): tuple(float(v) for v in c['cmjn'])
                             for c in lire_reference().values()}

    def is_house_color(self, r, g, b):
        """Cherche (r, g, b) dans la table ; tolère l'arrondi PDF."""
        for house_rgb, cmyk in self.house_colors.items():
            dr = abs(r - house_rgb[0])
            dg = abs(g - house_rgb[1])
            db = abs(b - house_rgb[2])
            # Le PDF peut arrondir à 1/255 ou 1/256
            if dr < 0.005 and dg < 0.005 and db < 0.005:
                return cmyk
        return None

    def convert_stream(self, stream_bytes):
        """
        Parcourt le flux et remplace les opérateurs de couleur selon les trois règles.

        Retourne les données modifiées et une liste de (avant, après).
        """
        try:
            text = stream_bytes.decode('latin-1', errors='ignore')
        except Exception:
            return stream_bytes, []

        changes = []

        # Parcours ligne à ligne ; la règle a) regarde aussi la ligne suivante.
        lines = text.split('\n')
        output = []

        i = 0
        while i < len(lines):
            line = lines[i]

            # Règle a) : `rg` neutre sombre suivi de BT
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                match = re.match(r'^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\s*$', line.strip())

                if match and next_line == 'BT':
                    try:
                        r, g, b = float(match.group(1)), float(match.group(2)), float(match.group(3))

                        if is_dark_neutral(r, g, b):
                            before = line.strip()
                            after = "0 0 0 1 k"
                            output.append(after)
                            changes.append((before, after))
                            i += 1
                            continue
                    except ValueError:
                        pass

            # Règles b) et c) : chaque `R G B rg` ou `R G B RG` de la ligne
            new_line = line
            pos = 0
            while True:
                match = re.search(r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(rg|RG)(?=\s|$)', new_line[pos:])
                if not match:
                    break

                try:
                    r, g, b = float(match.group(1)), float(match.group(2)), float(match.group(3))
                    op = match.group(4)
                    abs_start = pos + match.start()
                    abs_end = pos + match.end()

                    # Règle c) : blanc -> pas d'encre
                    if abs(r - 1.0) < 0.01 and abs(g - 1.0) < 0.01 and abs(b - 1.0) < 0.01:
                        before = f"{r} {g} {b} {op}"
                        after = "0 0 0 0 k"
                        new_line = new_line[:abs_start] + after + new_line[abs_end:]
                        changes.append((before, after))
                        pos = abs_start + len(after)
                        continue

                    # Règle b) : couleur de la maison -> CMJN officiel
                    house_cmyk = self.is_house_color(r, g, b)
                    if house_cmyk:
                        c, m, y, k = house_cmyk
                        before = f"{r} {g} {b} {op}"
                        after = f"{format_cmyk(c, m, y, k)} k"
                        new_line = new_line[:abs_start] + after + new_line[abs_end:]
                        changes.append((before, after))
                        pos = abs_start + len(after)
                        continue

                    pos = abs_end

                except ValueError:
                    pos = match.end()

            output.append(new_line)
            i += 1

        result = '\n'.join(output)
        return result.encode('latin-1', errors='ignore'), changes


def convert_pdf(input_path, output_path):
    """
    Étape 1 sur tout le PDF. Rend (succès, liste des (avant, après)).
    """
    try:
        reader = pypdf.PdfReader(input_path)
    except Exception as e:
        print(f"[cmjn] Erreur à l'ouverture du PDF : {e}", file=sys.stderr)
        return False, []

    converter = CMYKConverter()
    total_changes = []

    try:
        # Les flux sont modifiés en place dans le lecteur.
        for page_num in range(len(reader.pages)):
            page = reader.pages[page_num]

            if "/Contents" in page:
                contents_ref = page["/Contents"]

                try:
                    # Un seul flux ou un tableau de flux
                    if isinstance(contents_ref, list):
                        content_refs = contents_ref
                    else:
                        content_refs = [contents_ref]

                    for stream_ref in content_refs:
                        try:
                            stream_obj = stream_ref.get_object()
                            if not stream_obj:
                                continue

                            # Données décompressées
                            stream_bytes = stream_obj.get_data()

                            modified_bytes, changes = converter.convert_stream(stream_bytes)
                            total_changes.extend(changes)

                            # set_data() recompresse un flux FlateDecode et garde /Filter.
                            # Un autre filtre lève PdfReadError : le flux reste alors intact.
                            stream_obj.set_data(modified_bytes)

                        except Exception as e:
                            # Flux illisible : laissé tel quel
                            pass

                except Exception as e:
                    pass

        writer = pypdf.PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        with open(output_path, 'wb') as f:
            writer.write(f)

        return True, total_changes

    except Exception as e:
        print(f"[cmjn] Erreur lors de la conversion : {e}", file=sys.stderr)
        return False, []


# --------------------------------------------------------------------------------------
# Étape 2 : Ghostscript convertit le reste (images, teintes sans CMJN officiel).
# Avec `-sColorConversionStrategy=CMYK`, Ghostscript laisse intact ce qui est déjà en
# DeviceCMYK : le `0 0 0 1 k` de l'étape 1 reste un noir seul, sans passer en noir quadri.
# Sans Ghostscript, on échoue : un PDF resté en RVB ne doit pas passer pour du CMJN.

GS = os.environ.get('SZH_GS', 'gs')


def passe_ghostscript(entree, sortie, profil_icc):
    """Rend (True, '') ou (False, raison). Le profil ICC est obligatoire : sans lui,
    Ghostscript prendrait un CMJN générique, qui n'est pas celui de l'imprimeur."""
    if not profil_icc or not os.path.exists(profil_icc):
        return False, ('profil ICC introuvable : %s' % profil_icc)
    # --permit-file-read : en mode SAFER (défaut), gs refuse de lire /opt/icc/*.icc et
    # échoue sur « Error: /undefined in --runpdf-- », sans nommer le profil.
    cmd = [GS, '-dNOPAUSE', '-dBATCH', '-dQUIET', '-sDEVICE=pdfwrite',
           '-dProcessColorModel=/DeviceCMYK', '-sColorConversionStrategy=CMYK',
           '--permit-file-read=' + profil_icc,
           '-sOutputICCProfile=' + profil_icc,
           '-o', sortie, entree]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        return False, ("Ghostscript introuvable (« %s »). Le PDF imprimeur ne peut pas "
                       "passer en CMJN ; il resterait en RVB sans que rien ne le dise."
                       % GS)
    if r.returncode != 0:
        return False, ('Ghostscript a échoué (code %d) : %s'
                       % (r.returncode, (r.stderr or '').strip()[:400]))
    if not os.path.exists(sortie):
        return False, "Ghostscript n'a produit aucun fichier"
    return True, ''


def main():
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) < 3:
        print('usage: cmjn.py <entree.pdf> <sortie.pdf> [profil.icc]', file=sys.stderr)
        return 2

    entree, sortie = sys.argv[1], sys.argv[2]
    profil = sys.argv[3] if len(sys.argv) > 3 else ''

    # Étape 1, dans un fichier intermédiaire si l'étape 2 suit.
    intermediaire = sortie + '.rvb' if profil else sortie
    ok, changements = convert_pdf(entree, intermediaire)
    if not ok:
        return 1
    print('[cmjn] %d opérateur(s) remplacé(s) par la table de la maison' % len(changements))
    for avant, apres in changements[:6]:
        print('[cmjn]   %-30s -> %s' % (avant, apres))
    if len(changements) > 6:
        print('[cmjn]   … et %d autre(s)' % (len(changements) - 6))

    if not profil:
        print("[cmjn] aucun profil ICC : le fichier reste en RVB pour ce qui n'etait pas "
              "dans la table. Ce n'est PAS un PDF CMJN.", file=sys.stderr)
        return 0

    ok, raison = passe_ghostscript(intermediaire, sortie, profil)
    try:
        os.remove(intermediaire)
    except OSError:
        pass
    if not ok:
        print('[cmjn] ✗ ' + raison, file=sys.stderr)
        print("[cmjn]   Rien n'a ete livre : mieux vaut pas de PDF imprimeur qu'un PDF "
              "RVB qu'on croirait CMJN.", file=sys.stderr)
        return 1
    print('[cmjn] CMJN par %s' % os.path.basename(profil))
    return 0


if __name__ == '__main__':
    sys.exit(main())
