#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Conversion CMJN du flux de contenu PDF — étape 1 de 2 vers l'imprimerie.

Prend un PDF de WeasyPrint (RVB uniquement : opérateurs rg/RG, pas de k/K)
et remplace ses opérateurs de couleur dans le flux de contenu selon trois règles :

a) Noir du texte : un `rg` (RVB) immédiatement suivi de `BT` (début texte) dont
   la couleur est un neutre sombre → `0 0 0 1 k` (noir K seul, DeviceCMYK).
   ⚠ N'APPLIQUE JAMAIS cette règle à un `rg` suivi d'un tracé (re, m, c…) —
   un aplat noir n'est pas du texte.

b) Sept couleurs de maison remplacées par leurs CMJN OFFICIELS (pas ICC) :
   - Rouge SZH-CSPS (#D31932)         → 0.16 0.90 0.64 0
   - Nuit (#252B46)                   → 0.65 0.45 0 0.60
   - Capucine (#EB5E51)               → 0 0.74 0.64 0
   - Moutarde (#C7CF1C)               → 0.30 0.04 0.95 0
   - Poireau (#51A66D)                → 0.70 0.10 0.70 0
   - Bleu acier (#5F9FBC)             → 0.65 0.25 0.20 0
   - Mountbatten (#A98899)            → 0.40 0.50 0.30 0

   Ces hex viennent de pipeline/styles/socle.css et couleurs.css. Toute divergence
   est un défaut (vérifiée par test/). Les CMJN viennent du graphiste.

c) Blanc `1 1 1 rg` → `0 0 0 0 k` (papier, pas d'encre).

Le reste reste en RVB : Ghostscript s'en charge par conversion ICC.

Entrées : PDF de WeasyPrint, optionnellement profil ICC pour Ghostscript.
Sortie : PDF avec les flux de contenu modifiés.

Étape 2 : Ghostscript reçoit ce PDF :
  gs -dNOPAUSE -dBATCH -dQUIET -sDEVICE=pdfwrite \
     -dProcessColorModel=/DeviceCMYK -sColorConversionStrategy=CMYK \
     -sOutputICCProfile=<profil>.icc -o sortie.pdf entree.pdf
"""

import os
import subprocess
import sys
import re
import zlib

import pypdf
from pypdf.generic import StreamObject


def hex_to_rgb(hexc):
    """Convertit #RRGGBB en tuple (R, G, B) normalisés à [0, 1]."""
    hexc = hexc.lstrip('#')
    r = int(hexc[0:2], 16) / 255.0
    g = int(hexc[2:4], 16) / 255.0
    b = int(hexc[4:6], 16) / 255.0
    return (r, g, b)


def is_dark_neutral(r, g, b, tolerance=0.05):
    """
    Vrai si (r, g, b) est un neutre sombre (les trois composantes proches et faibles).
    Utilisé pour identifier le texte noir avant BT.

    Sombre : max < 0.35  (encre de la maison #16161F = 0.086, 0.086, 0.122)
    Neutre : écart max < tolerance
    """
    max_val = max(r, g, b)
    min_val = min(r, g, b)
    spread = max_val - min_val
    return max_val < 0.35 and spread < tolerance


def format_cmyk(c, m, y, k):
    """Formate un quadruplet CMYK pour PDF (avec espace décimal raisonnable)."""
    def fmt(v):
        # Arrondir et éviter -0.0
        v = round(v, 6)
        if v == 0.0:
            return "0"
        return str(v).rstrip('0').rstrip('.')

    return f"{fmt(c)} {fmt(m)} {fmt(y)} {fmt(k)}"


class CMYKConverter:
    """Convertisseur des opérateurs de couleur d'un flux PDF."""

    def __init__(self):
        # Table des sept couleurs de maison : hex → CMYK (normalisés)
        # Les CMJN viennent du graphiste, en pourcentages — conversion en [0, 1]
        self.house_colors = {
            hex_to_rgb('#D31932'): (0.16, 0.90, 0.64, 0.0),  # Rouge SZH-CSPS
            hex_to_rgb('#252B46'): (0.65, 0.45, 0.0, 0.60),   # Nuit
            hex_to_rgb('#EB5E51'): (0.0, 0.74, 0.64, 0.0),    # Capucine
            hex_to_rgb('#C7CF1C'): (0.30, 0.04, 0.95, 0.0),   # Moutarde
            hex_to_rgb('#51A66D'): (0.70, 0.10, 0.70, 0.0),   # Poireau
            hex_to_rgb('#5F9FBC'): (0.65, 0.25, 0.20, 0.0),   # Bleu acier
            hex_to_rgb('#A98899'): (0.40, 0.50, 0.30, 0.0),   # Mountbatten
        }

    def is_house_color(self, r, g, b):
        """Cherche (r, g, b) dans la table ; tolère l'arrondi PDF."""
        for house_rgb, cmyk in self.house_colors.items():
            dr = abs(r - house_rgb[0])
            dg = abs(g - house_rgb[1])
            db = abs(b - house_rgb[2])
            # Tolérance : PDF peut arrondir à 1/255 ou 1/256
            if dr < 0.005 and dg < 0.005 and db < 0.005:
                return cmyk
        return None

    def convert_stream(self, stream_bytes):
        """
        Parcourt le flux et remplace les opérateurs de couleur selon les trois règles.

        Retourne les données modifiées et une liste de (avant, après).
        """
        try:
            # Décompresser si nécessaire
            text = stream_bytes.decode('latin-1', errors='ignore')
        except Exception:
            return stream_bytes, []

        changes = []

        # Regex pour trouver les opérateurs rg/RG avec paires BT/ET
        # Stratégie : scanner les lignes et chercher les patterns
        lines = text.split('\n')
        output = []

        i = 0
        while i < len(lines):
            line = lines[i]

            # Règle a) : noir du texte avant BT
            # Chercher un `rg` sur cette ligne suivi immédiatement de BT
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                match = re.match(r'^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\s*$', line.strip())

                if match and next_line == 'BT':
                    try:
                        r, g, b = float(match.group(1)), float(match.group(2)), float(match.group(3))

                        # C'est un neutre sombre avant BT → noir K seul
                        if is_dark_neutral(r, g, b):
                            before = line.strip()
                            after = "0 0 0 1 k"
                            output.append(after)
                            changes.append((before, after))
                            i += 1
                            continue
                    except ValueError:
                        pass

            # Règle b) et c) : chercher et remplacer les opérateurs rg et RG
            # Pattern : `R G B rg` ou `R G B RG` (fini par le caractère ou un espace)
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

                    # Règle c) : blanc → pas d'encre
                    if abs(r - 1.0) < 0.01 and abs(g - 1.0) < 0.01 and abs(b - 1.0) < 0.01:
                        before = f"{r} {g} {b} {op}"
                        after = "0 0 0 0 k"
                        new_line = new_line[:abs_start] + after + new_line[abs_end:]
                        changes.append((before, after))
                        pos = abs_start + len(after)
                        continue

                    # Règle b) : couleur de maison → CMJN officiel
                    house_cmyk = self.is_house_color(r, g, b)
                    if house_cmyk:
                        c, m, y, k = house_cmyk
                        before = f"{r} {g} {b} {op}"
                        after = f"{format_cmyk(c, m, y, k)} k"
                        new_line = new_line[:abs_start] + after + new_line[abs_end:]
                        changes.append((before, after))
                        pos = abs_start + len(after)
                        continue

                    # Pas de remplacement, avancer
                    pos = abs_end

                except ValueError:
                    pos = match.end()

            output.append(new_line)
            i += 1

        result = '\n'.join(output)
        return result.encode('latin-1', errors='ignore'), changes


def convert_pdf(input_path, output_path):
    """
    Lit un PDF, remplace les opérateurs de couleur, et l'écrit en sortie.

    Retourne True/False et une liste des (avant, après).
    """
    try:
        reader = pypdf.PdfReader(input_path)
    except Exception as e:
        print(f"[cmjn] Erreur à l'ouverture du PDF : {e}", file=sys.stderr)
        return False, []

    converter = CMYKConverter()
    total_changes = []

    try:
        # Modifier directement le lecteur
        for page_num in range(len(reader.pages)):
            page = reader.pages[page_num]

            # Accéder au flux de contenu
            if "/Contents" in page:
                contents_ref = page["/Contents"]

                try:
                    # Le contenu peut être un seul objet ou un tableau
                    if isinstance(contents_ref, list):
                        content_refs = contents_ref
                    else:
                        content_refs = [contents_ref]

                    for stream_ref in content_refs:
                        try:
                            # Récupérer l'objet flux
                            stream_obj = stream_ref.get_object()
                            if not stream_obj:
                                continue

                            # Récupérer les données décompressées
                            stream_bytes = stream_obj.get_data()

                            # Convertir les couleurs
                            modified_bytes, changes = converter.convert_stream(stream_bytes)
                            total_changes.extend(changes)

                            # Modifier le flux dans le lecteur en place
                            # Désactiver le filtre de compression pour voir les changements clairement
                            if "/Filter" in stream_obj:
                                del stream_obj["/Filter"]
                            stream_obj._data = modified_bytes

                        except Exception as e:
                            # Ignorer les flux illisibles
                            pass

                except Exception as e:
                    pass

        # Écrire le lecteur modifié en sortie
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
# Étape 2 : Ghostscript convertit ce qui reste — les images, et les teintes dérivées dont
# le graphiste n'a pas donné de CMJN.
#
# ⚠ Le fait qui rend la recette possible, et qui a été MESURÉ : avec
#   `-sColorConversionStrategy=CMYK`, Ghostscript LAISSE INTACT ce qui est déjà en
#   DeviceCMYK. Le `0 0 0 1 k` posé à l'étape 1 traverse donc la passe sans être retouché.
#   Sans cette propriété, tout ce fichier serait inutile : gs reconvertirait le noir K seul
#   en noir quadri, et le texte de labeur franerait à l'impression.
#
# ⚠ Si gs manque, on ÉCHOUE. Un PDF resté en RVB qu'on livrerait comme CMJN est pire
#   qu'une absence de fichier : personne ne le vérifie avant la facture de l'imprimeur.
#   C'est la règle de la porte PDF/UA du Makefile, appliquée ici.

GS = os.environ.get('SZH_GS', 'gs')


def passe_ghostscript(entree, sortie, profil_icc):
    """Rend (True, '') ou (False, raison). Le profil ICC est obligatoire : convertir sans
    profil revient à laisser Ghostscript choisir un CMJN générique, ce qui n'est pas
    l'espace de l'imprimeur et ne se voit qu'une fois imprimé."""
    if not profil_icc or not os.path.exists(profil_icc):
        return False, ('profil ICC introuvable : %s' % profil_icc)
    cmd = [GS, '-dNOPAUSE', '-dBATCH', '-dQUIET', '-sDEVICE=pdfwrite',
           '-dProcessColorModel=/DeviceCMYK', '-sColorConversionStrategy=CMYK',
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
    if len(sys.argv) < 3:
        print('usage: cmjn.py <entree.pdf> <sortie.pdf> [profil.icc]', file=sys.stderr)
        return 2

    entree, sortie = sys.argv[1], sys.argv[2]
    profil = sys.argv[3] if len(sys.argv) > 3 else ''

    # Étape 1 : les couleurs qu'on connaît, dans un temporaire quand une étape 2 suit.
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
