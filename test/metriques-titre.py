#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Génère la table de largeurs du titre de couverture — l'entrée de L3 (effet d'escalier).

    python test/metriques-titre.py              -> réécrit la table et le dit
    python test/metriques-titre.py --verifier   -> ne réécrit rien ; sortie 1 si la table
                                                   ne correspond plus à la police livrée

La règle L3 demande que la première ligne du titre soit plus courte que la deuxième. Pour
la tenir, `pipeline/filters/szh-titre-lignes.lua` doit savoir OÙ le titre passera à la
ligne, donc mesurer du texte — ce qu'un filtre pandoc ne peut pas faire seul. Ce script
extrait les largeurs d'avance de la face qui compose le titre et les dépose dans une table
Lua que le filtre lit. La mesure est ainsi faite une fois, versionnée et relisible, plutôt
qu'estimée à chaque compilation.

⚠ Sans dépendance : ni fontTools ni WeasyPrint. Les deux outils du dépôt qui lisent les
polices (test/polices-check.py, pipeline/fonts/glyphes-manquants.py) demandent fontTools,
absent de la machine de rédaction ; ce script-ci doit pouvoir se relancer partout, puisque
c'est lui qui garantit que la table suit la police. Il ne lit donc que trois tables du
format TrueType — head, hhea/hmtx et cmap —, ce qui tient en soixante lignes de `struct`.

Ce qui n'est PAS modélisé, et l'erreur que cela laisse :
  * le crénage (GPOS/kern) — Open Sans crène « Ta », « Vo », « Wa » de quelques millièmes
    de cadratin ; sur une ligne de titre l'écart cumulé reste sous 0,5 %, et L3 garde une
    marge de sécurité bien plus large ;
  * les ligatures optionnelles, que WeasyPrint n'active pas sur ce titre ;
  * la substitution de police : un caractère absent de la face est signalé ici même, et
    test/polices-check.py est la porte qui interdit qu'il arrive jusqu'au PDF.
"""

import os
import struct
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# La face du titre : .szh-title est en font-weight 600, et socle.css §1 relie ce poids à
# cette face-là. La changer ici sans la changer dans socle.css ferait mesurer la mauvaise.
POLICE = os.path.join(RACINE, 'pipeline', 'fonts', 'OpenSans-SemiCondensed-SemiBold.ttf')
SORTIE = os.path.join(RACINE, 'pipeline', 'filters', 'szh-titre-metriques.lua')

# Ce qu'un titre de la revue peut contenir : l'ASCII imprimable, tout le supplément
# Latin-1, et les signes que la typographie maison pose elle-même (chevrons, apostrophe
# courbe, demi-cadratin, ligatures, insécables, pour mille, euro).
# 0x7F à 0x9F sont les codes de contrôle : aucune police ne leur donne de glyphe, et les
# lister ferait crier le contrôle des manquants à chaque relance.
CODES = list(range(0x20, 0x7F)) + list(range(0xA0, 0x100)) + [
    0x0152, 0x0153,                          # Œ œ
    0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026,
    0x2039, 0x203A, 0x2030, 0x20AC,
    0x2009, 0x202F, 0x00A0, 0x00AD, 0x2010, 0x2011,
]


def tables(donnees):
    """Répertoire des tables : tag -> (offset, longueur)."""
    nombre = struct.unpack('>H', donnees[4:6])[0]
    sortie = {}
    for i in range(nombre):
        base = 12 + i * 16
        tag, _, offset, longueur = struct.unpack('>4sLLL', donnees[base:base + 16])
        sortie[tag.decode('latin-1')] = (offset, longueur)
    return sortie


def avances(donnees, rep):
    """Largeurs d'avance par index de glyphe, en unités de police."""
    debut_hhea = rep['hhea'][0]
    nombre = struct.unpack('>H', donnees[debut_hhea + 34:debut_hhea + 36])[0]
    debut = rep['hmtx'][0]
    sortie = []
    for i in range(nombre):
        sortie.append(struct.unpack('>H', donnees[debut + i * 4:debut + i * 4 + 2])[0])
    return sortie


def cmap_format4(donnees, debut):
    """Sous-table cmap format 4 -> dict point de code -> index de glyphe."""
    segments_x2 = struct.unpack('>H', donnees[debut + 6:debut + 8])[0]
    segments = segments_x2 // 2
    fins = debut + 14
    departs = fins + segments_x2 + 2
    deltas = departs + segments_x2
    plages = deltas + segments_x2
    sortie = {}
    for i in range(segments):
        fin = struct.unpack('>H', donnees[fins + i * 2:fins + i * 2 + 2])[0]
        depart = struct.unpack('>H', donnees[departs + i * 2:departs + i * 2 + 2])[0]
        delta = struct.unpack('>h', donnees[deltas + i * 2:deltas + i * 2 + 2])[0]
        plage = struct.unpack('>H', donnees[plages + i * 2:plages + i * 2 + 2])[0]
        if depart > fin or fin == 0xFFFF and depart == 0xFFFF:
            continue
        for cp in range(depart, fin + 1):
            if plage == 0:
                gid = (cp + delta) & 0xFFFF
            else:
                adresse = plages + i * 2 + plage + (cp - depart) * 2
                gid = struct.unpack('>H', donnees[adresse:adresse + 2])[0]
                if gid != 0:
                    gid = (gid + delta) & 0xFFFF
            if gid != 0:
                sortie[cp] = gid
    return sortie


def cmap(donnees, rep):
    """La sous-table Unicode BMP. Windows/Unicode (3,1) d'abord, Unicode (0,3) ensuite."""
    debut = rep['cmap'][0]
    nombre = struct.unpack('>H', donnees[debut + 2:debut + 4])[0]
    candidats = {}
    for i in range(nombre):
        base = debut + 4 + i * 8
        plateforme, encodage, decalage = struct.unpack('>HHL', donnees[base:base + 8])
        candidats[(plateforme, encodage)] = debut + decalage
    for cle in ((3, 1), (0, 3), (0, 4), (3, 0)):
        if cle in candidats:
            sous = candidats[cle]
            if struct.unpack('>H', donnees[sous:sous + 2])[0] == 4:
                return cmap_format4(donnees, sous)
    raise SystemExit('cmap format 4 introuvable dans ' + POLICE)


def construire():
    with open(POLICE, 'rb') as fh:
        donnees = fh.read()
    rep = tables(donnees)
    debut_head = rep['head'][0]
    upem = struct.unpack('>H', donnees[debut_head + 18:debut_head + 20])[0]
    larg = avances(donnees, rep)
    table = cmap(donnees, rep)

    lignes, manquants = [], []
    for cp in sorted(set(CODES)):
        gid = table.get(cp)
        if gid is None:
            manquants.append(cp)
            continue
        avance = larg[gid] if gid < len(larg) else larg[-1]
        lignes.append((cp, avance))
    return upem, lignes, manquants, len(donnees)


def rendre(upem, lignes, taille):
    entrees = []
    for i in range(0, len(lignes), 6):
        morceau = ' '.join('[%d] = %d,' % (cp, a) for cp, a in lignes[i:i + 6])
        entrees.append('  ' + morceau)
    return '\n'.join([
        '-- Largeurs d’avance de la face qui compose le titre de couverture, en unités de',
        '-- police. Table ENGENDRÉE : ne pas éditer à la main, relancer',
        '-- `python test/metriques-titre.py` (et `--verifier` pour contrôler qu’elle suit',
        '-- toujours la police livrée).',
        '--',
        '-- Police  : pipeline/fonts/%s (%d octets)' % (os.path.basename(POLICE), taille),
        '-- Poids   : 600, celui de .szh-title — voir socle.css §1',
        '-- Lecteur : test/metriques-titre.py, qui dit aussi ce qui n’est pas modélisé',
        '--           (crénage, ligatures optionnelles).',
        '',
        'return {',
        '  upem = %d,' % upem,
        '  -- Repli pour un caractère absent de la table : l’avance du « x ». Un titre qui',
        '  -- en contient trop est déclaré non mesurable par le filtre, qui s’abstient alors',
        '  -- plutôt que de couper au hasard.',
        '  defaut = %d,' % dict(lignes).get(ord('x'), upem // 2),
        '  avance = {',
        '\n'.join('  ' + e for e in entrees),
        '  },',
        '}',
        '',
    ])


def main(argv):
    verifier = '--verifier' in argv
    if not os.path.exists(POLICE):
        print('police introuvable : ' + POLICE)
        return 1
    upem, lignes, manquants, taille = construire()
    texte = rendre(upem, lignes, taille)

    if manquants:
        print('caractères absents de la face (%d) : %s'
              % (len(manquants), ' '.join('U+%04X' % c for c in manquants)))

    ancien = ''
    if os.path.exists(SORTIE):
        with open(SORTIE, encoding='utf-8') as fh:
            ancien = fh.read()
    if ancien == texte:
        print('table à jour : %d caractères, upem %d.' % (len(lignes), upem))
        return 0
    if verifier:
        print('la table ne correspond plus à la police livrée.')
        print('relancer : python test/metriques-titre.py')
        return 1
    with open(SORTIE, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(texte)
    print('table écrite : %d caractères, upem %d -> %s'
          % (len(lignes), upem, os.path.relpath(SORTIE, RACINE)))
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main(sys.argv[1:]))
