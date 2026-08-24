#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Contrôle de reproductibilité des polices — la porte qui rend le PDF portable.

    python test/polices-check.py [dossier de sorties…]

Sans argument, il regarde `test/out/`. On peut lui passer le `out/` d'un vrai numéro :
    python test/polices-check.py "/mnt/c/…/Revue 2026-03/out"

Deux contrôles, dans cet ordre :

1. **Couverture des faces livrées.** Les caractères que la maquette écrit d'elle-même
   — la fine insécable de « Source : », le triangle des puces, le trait d'union des
   coupures de mot, la flèche de retour de note — doivent être portés par les faces de
   `pipeline/fonts/`. Le tableau est imprimé en entier, à lire d'un coup d'œil.
   `pipeline/fonts/glyphes-manquants.py` les y ajoute, et sait se relancer.

2. **Aucune police étrangère embarquée.** C'est le contrôle qui compte : si une face de
   `pipeline/fonts/` ne couvre pas un caractère, fontconfig comble le trou au moment du
   build avec ce qu'il trouve sur la machine — DejaVu ici, Noto ailleurs, rien du tout
   sur un troisième poste. Le PDF cesse alors d'être le même d'un poste à l'autre, et
   `docs/MAINTENANCE.md` §2 promet exactement le contraire. Un caractère rendu par une
   police de repli perd en outre son identité dans la couche texte : l'espace fine
   insécable ressortait en espace ordinaire d'un copier-coller — mesuré.

Sortie : 0 si tout est en ordre, 1 sinon. Les messages sont en français puis en allemand
(orthographe suisse), comme tout ce que lit un utilisateur.
"""

import glob
import os
import re
import sys
import zlib

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOSSIER_POLICES = os.path.join(RACINE, 'pipeline', 'fonts')

# Ce que la maquette écrit et qu'aucune face de repli ne doit avoir à combler. À garder
# aligné sur ATTENDUS de pipeline/fonts/glyphes-manquants.py.
ATTENDUS = (0x202F, 0x2010, 0x2011, 0x25B8, 0x21A9, 0xFE0E)
# Libellés du tableau : le nom Unicode est en anglais et trop long pour une colonne.
LIBELLES = {0x202F: 'fine insécable', 0x2010: "trait d'union", 0x2011: "t. d'union inséc.",
            0x25B8: 'puce triangle', 0x21A9: 'retour de note', 0xFE0E: 'sélecteur 15'}
# Les faces qui portent le texte : le corps de la revue est en Open Sans, et c'est donc
# elle qui doit tout couvrir. IBM Plex Mono ne sert qu'au code, Source Serif 4 n'est plus
# déclarée dans print.css (elle reste livrée pour test/palette-html.py).
FACES_DU_CORPS = 'OpenSans-'


def _normaliser(nom):
    """« Open-Sans-Bold-Semi-Condensed » -> « opensansboldsemicondensed »."""
    return re.sub(r'[^a-z0-9]', '', nom.lower())


def familles_livrees():
    """Préfixes normalisés des familles de pipeline/fonts/, lus dans les fichiers mêmes.

    Le nom qu'écrit WeasyPrint dans /BaseFont ne vient pas de la table `name` mais de la
    description fontconfig (« Open-Sans-Bold-Semi-Condensed » là où la table dit « Open
    Sans Regular ») : on ne peut donc comparer que des préfixes de famille. Un nom
    embarqué est accepté s'il commence par l'un d'eux.
    """
    from fontTools.ttLib import TTFont
    brut = set()
    for chemin in sorted(glob.glob(os.path.join(DOSSIER_POLICES, '*.ttf'))
                         + glob.glob(os.path.join(DOSSIER_POLICES, '*.otf'))):
        table = TTFont(chemin, lazy=True)['name']
        for identifiant in (16, 1):
            for entree in table.names:
                if entree.nameID != identifiant:
                    continue
                try:
                    brut.add(_normaliser(entree.toUnicode()))
                except Exception:
                    pass
    # « ibmplexmonomedm » est un sur-nom d'« ibmplexmono » : on garde le plus court, sinon
    # le préfixe le plus long ne servirait jamais.
    return {n for n in brut if n and not any(a != n and n.startswith(a) for a in brut)}


def couverture_des_faces():
    """(tableau imprimable, liste des manques sur les faces du corps)."""
    from fontTools.ttLib import TTFont
    lignes, manques = [], []
    entetes = ['U+%04X %s' % (cp, LIBELLES.get(cp, '?')) for cp in ATTENDUS]
    lignes.append('  %-40s %s' % ('face', ' '.join('%-24s' % e for e in entetes)))
    for chemin in sorted(glob.glob(os.path.join(DOSSIER_POLICES, '*.ttf'))
                         + glob.glob(os.path.join(DOSSIER_POLICES, '*.otf'))):
        nom = os.path.basename(chemin)
        couvert = set()
        for sous in TTFont(chemin, lazy=True)['cmap'].tables:
            couvert |= set(sous.cmap.keys())
        cases = ['%-24s' % ('oui' if cp in couvert else 'NON') for cp in ATTENDUS]
        lignes.append('  %-40s %s' % (nom, ' '.join(cases)))
        if nom.startswith(FACES_DU_CORPS):
            absents = [cp for cp in ATTENDUS if cp not in couvert]
            if absents:
                manques.append((nom, absents))
    return lignes, manques


def polices_embarquees(chemin_pdf):
    """Noms de /BaseFont du PDF, préfixe de sous-ensemble retiré.

    Les dictionnaires de WeasyPrint vivent dans des flux d'objets compressés : il faut
    décompresser chaque flux avant de chercher, un grep brut ne voit rien.
    """
    brut = open(chemin_pdf, 'rb').read()
    tout = bytearray(brut)
    for m in re.finditer(rb'stream\r?\n', brut):
        fin = brut.find(b'endstream', m.end())
        if fin < 0:
            continue
        try:
            tout += zlib.decompress(brut[m.end():fin])
        except Exception:
            pass
    return sorted({f.decode('latin-1').split('+')[-1]
                   for f in re.findall(rb'/BaseFont\s*/([A-Za-z0-9+\-]+)', bytes(tout))})


def main(argv):
    dossiers = argv[1:] or [os.path.join(RACINE, 'test', 'out')]
    echecs = []

    print('[polices] Couverture des faces de pipeline/fonts/ — seules les faces Open Sans,')
    print('[polices] qui portent le corps de texte, doivent tout couvrir :')
    lignes, manques = couverture_des_faces()
    for ligne in lignes:
        print(ligne)
    if manques:
        for nom, absents in manques:
            echecs.append('%s ne porte pas %s'
                          % (nom, ' '.join('U+%04X' % c for c in absents)))
        print('[polices] ✗ Des faces du corps de texte ne couvrent pas ce que la maquette écrit.')
        print("[polices]   À faire : /opt/weasyprint/bin/python pipeline/fonts/glyphes-manquants.py")
        print('[polices] [de] ✗ Schriftschnitte des Textkörpers deckten nicht ab, was das Layout schreibt.')
        print('[polices] [de]   Zu tun: /opt/weasyprint/bin/python pipeline/fonts/glyphes-manquants.py')
    else:
        print('[polices] ✓ Les faces du corps portent les %d caractères de la maquette.'
              % len(ATTENDUS))

    autorisees = familles_livrees()
    pdfs = []
    for dossier in dossiers:
        pdfs += sorted(glob.glob(os.path.join(dossier, '*', '*.pdf')))
        pdfs += sorted(glob.glob(os.path.join(dossier, '*.pdf')))
    pdfs = sorted(set(pdfs))
    if not pdfs:
        print('[polices] ✗ Aucun PDF à contrôler dans : %s' % ', '.join(dossiers))
        print('[polices] [de] ✗ Keine PDF zum Prüfen in: %s' % ', '.join(dossiers))
        return 1

    print('[polices] Polices embarquées (%d PDF) — familles livrées : %s'
          % (len(pdfs), ', '.join(sorted(autorisees))))
    for chemin in pdfs:
        noms = polices_embarquees(chemin)
        etrangeres = [n for n in noms
                      if not any(_normaliser(n).startswith(a) for a in autorisees)]
        marque = '✗' if etrangeres else '✓'
        print('  %s %-26s %s' % (marque, os.path.basename(chemin), ', '.join(noms) or '(aucune)'))
        for nom in etrangeres:
            echecs.append('%s embarque %s, qui n\'est pas dans pipeline/fonts/'
                          % (os.path.basename(chemin), nom))

    print()
    if echecs:
        print('[polices] ✗ %d écart(s) : le PDF dépend de ce que la machine a installé, il '
              'ne sera pas le même sur un autre poste.' % len(echecs))
        for e in echecs:
            print('[polices]   - %s' % e)
        print('[polices]   Pourquoi cela compte : docs/MAINTENANCE.md §2 promet que deux '
              'postes produisent le même PDF. Une police de repli rompt cette promesse, '
              "et le caractère qu'elle rend perd son identité dans la couche texte.")
        print('[polices] [de] ✗ %d Abweichung(en): das PDF hängt davon ab, was auf dem '
              'Rechner installiert ist, und fällt auf einem anderen Arbeitsplatz anders aus.'
              % len(echecs))
        print('[polices] [de]   Warum das zählt: docs/MAINTENANCE.md §2 verspricht, dass '
              'zwei Arbeitsplätze dasselbe PDF erzeugen. Eine Ersatzschrift bricht dieses '
              'Versprechen, und das damit gesetzte Zeichen verliert seine Identität in der '
              'Textebene.')
        return 1

    print('[polices] ✓ %d PDF, aucune police hors pipeline/fonts/ : le rendu ne dépend '
          'pas de la machine.' % len(pdfs))
    print('[polices] [de] ✓ %d PDF, keine Schrift ausserhalb von pipeline/fonts/: die '
          'Ausgabe hängt nicht vom Rechner ab.' % len(pdfs))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
