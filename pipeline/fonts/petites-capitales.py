#!/usr/bin/env python3
# Donne aux faces Open Sans livrées des petites capitales (fonctionnalité OpenType 'smcp').
#
#   /opt/weasyprint/bin/python pipeline/fonts/petites-capitales.py [--verifier]
#
# Open Sans n'a pas de petites capitales, et WeasyPrint ne les simule pas : il traduit
# `font-variant: small-caps` en 'smcp', sans repli. Sans 'smcp' dans la face,
# `[Piaget]{.smallcaps}` sort en bas de casse, sans avertissement (WeasyPrint 70, Pango
# 1.56).
#
# Pour chaque minuscule dont la capitale existe, on ajoute un glyphe « <nom>.sc » (la
# capitale réduite à ECHELLE) et une substitution minuscule -> petite capitale sous 'smcp'.
# La capitale vient de la face de graisse supérieure (SOURCES) : réduite, une capitale de
# même graisse aurait des fûts trop maigres à côté des minuscules.
#
# Limites : ß n'a pas de capitale en un caractère et reste en bas de casse. Les ligatures
# fi/fl passent avant 'smcp' : socle.css les coupe là où il appelle les petites capitales.
#
# La couche texte du PDF garde « Piaget » en bas de casse (copier-coller, lecteur d'écran),
# contrairement à `text-transform: uppercase`.
#
# Idempotent. À relancer, comme glyphes-manquants.py, après toute régénération des faces.
# `--verifier` n'écrit rien et sort 1 si une face n'a pas ses petites capitales.
#
# Licence : Open Sans est sous OFL 1.1 sans Reserved Font Name (OFL-OpenSans.txt) ; les
# glyphes ajoutés sont dérivés des faces Open Sans elles-mêmes.

import sys
import unicodedata
from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.otlLib.builder import buildLookup, buildSingleSubstSubtable
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables

DOSSIER = Path(__file__).resolve().parent

# Face à compléter -> face d'où tirer les capitales, d'une graisse au-dessus. Le gras, sans
# face plus grasse, prend les siennes.
SOURCES = {
    'OpenSans-SemiCondensed-Regular.ttf':        'OpenSans-SemiCondensed-SemiBold.ttf',
    'OpenSans-SemiCondensed-SemiBold.ttf':       'OpenSans-SemiCondensed-Bold.ttf',
    'OpenSans-SemiCondensed-Bold.ttf':           'OpenSans-SemiCondensed-Bold.ttf',
    'OpenSans-SemiCondensed-Italic.ttf':         'OpenSans-SemiCondensed-SemiBoldItalic.ttf',
    'OpenSans-SemiCondensed-SemiBoldItalic.ttf': 'OpenSans-SemiCondensed-BoldItalic.ttf',
    'OpenSans-SemiCondensed-BoldItalic.ttf':     'OpenSans-SemiCondensed-BoldItalic.ttf',
}

# Hauteur de la petite capitale en fraction de la capitale : 1170 unités sur 2048 (capitale
# 1462, hauteur d'x 1096), un peu au-dessus de l'x. Réduction uniforme, pour garder l'angle
# de l'italique.
ECHELLE = 0.80

FONCTIONNALITE = 'smcp'


def cmap_unicode(font):
    return font.getBestCmap()


def a_smcp(font):
    gsub = font['GSUB'].table
    return any(fr.FeatureTag == FONCTIONNALITE for fr in gsub.FeatureList.FeatureRecord)


def paires(cible, source):
    """(nom minuscule dans la cible, nom capitale dans la source) pour chaque lettre."""
    cm_c, cm_s = cmap_unicode(cible), cmap_unicode(source)
    for cp, nom in sorted(cm_c.items()):
        c = chr(cp)
        if unicodedata.category(c) != 'Ll':
            continue
        haut = c.upper()
        if len(haut) != 1 or haut == c or ord(haut) not in cm_s:
            continue
        yield nom, cm_s[ord(haut)]


def ajouter_glyphe(font, nom, glyphe, avance):
    ordre = list(font.getGlyphOrder())
    font.setGlyphOrder(ordre + [nom])
    font['glyf'].glyphOrder = font.getGlyphOrder()
    font['glyf'].glyphs[nom] = glyphe
    glyphe.recalcBounds(font['glyf'])
    # En TrueType, l'approche gauche vaut le xMin du contour.
    font['hmtx'].metrics[nom] = (avance, getattr(glyphe, 'xMin', 0))


def inserer_fonctionnalite(gsub, index_lookup):
    """Ajoute 'smcp' à la FeatureList (triée par étiquette) et à tous les LangSys."""
    if getattr(gsub, 'FeatureVariations', None):
        raise SystemExit('GSUB porte des FeatureVariations : face non instanciée ?')
    enregistrements = gsub.FeatureList.FeatureRecord
    rang = 0
    while rang < len(enregistrements) and enregistrements[rang].FeatureTag < FONCTIONNALITE:
        rang += 1
    fr = otTables.FeatureRecord()
    fr.FeatureTag = FONCTIONNALITE
    fr.Feature = otTables.Feature()
    fr.Feature.FeatureParams = None
    fr.Feature.LookupListIndex = [index_lookup]
    fr.Feature.LookupCount = 1
    enregistrements.insert(rang, fr)
    gsub.FeatureList.FeatureCount = len(enregistrements)

    def decaler(ls):
        if ls is None:
            return
        ls.FeatureIndex = sorted([i + 1 if i >= rang else i for i in ls.FeatureIndex] + [rang])
        ls.FeatureCount = len(ls.FeatureIndex)
        if ls.ReqFeatureIndex != 0xFFFF and ls.ReqFeatureIndex >= rang:
            ls.ReqFeatureIndex += 1

    for sr in gsub.ScriptList.ScriptRecord:
        decaler(sr.Script.DefaultLangSys)
        for lsr in sr.Script.LangSysRecord:
            decaler(lsr.LangSys)


def completer(chemin, chemin_source, verifier_seulement):
    font = TTFont(chemin)
    if a_smcp(font):
        if not verifier_seulement:
            print('%-44s deja pourvue' % chemin.name)
        return True
    if verifier_seulement:
        return False
    source = font if chemin_source == chemin else TTFont(chemin_source)
    if source['head'].unitsPerEm != font['head'].unitsPerEm:
        raise SystemExit('cadratins differents : %s / %s' % (chemin.name, chemin_source.name))
    jeu = source.getGlyphSet()
    table = {}
    for minuscule, capitale in paires(font, source):
        # Décomposé : les capitales accentuées sont des composites, dont les composants ne
        # peuvent pas être réduits séparément.
        trace = DecomposingRecordingPen(jeu)
        jeu[capitale].draw(trace)
        pen = TTGlyphPen(None)
        trace.replay(TransformPen(pen, Transform(ECHELLE, 0, 0, ECHELLE, 0, 0)))
        nom = minuscule + '.sc'
        if nom in font.getGlyphOrder():
            raise SystemExit('%s existe deja dans %s' % (nom, chemin.name))
        ajouter_glyphe(font, nom, pen.glyph(), round(source['hmtx'][capitale][0] * ECHELLE))
        table[minuscule] = nom

    gsub = font['GSUB'].table
    lookup = buildLookup([buildSingleSubstSubtable(table)])
    gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)
    inserer_fonctionnalite(gsub, len(gsub.LookupList.Lookup) - 1)

    font.save(chemin)
    print('%-44s + %d petites capitales (capitales de %s)'
          % (chemin.name, len(table), chemin_source.name))
    return True


def main():
    verifier = '--verifier' in sys.argv[1:]
    manquantes = [face for face, source in SOURCES.items()
                  if not completer(DOSSIER / face, DOSSIER / source, verifier)]
    if verifier:
        for face in manquantes:
            print('%-44s SANS petites capitales (smcp)' % face)
        if manquantes:
            return 1
        print('Les %d faces Open Sans portent leurs petites capitales.' % len(SOURCES))
    return 0


if __name__ == '__main__':
    sys.exit(main())
