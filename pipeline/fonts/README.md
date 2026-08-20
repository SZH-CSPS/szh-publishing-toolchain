# Polices empaquetées (maquette SZH/CSPS)

Polices libres (licence SIL Open Font License 1.1) empaquetées ici pour un rendu
reproductible : `../styles/print.css` les charge par `@font-face` en chemins relatifs
`url("../fonts/…")`. Pandoc les inline en base64 dans le HTML autonome
(`--embed-resources`) ; WeasyPrint les sous-ensemble dans le PDF.

## Fichiers et provenance

| Fichier | Famille `@font-face` | Poids / style | Source (OFL) |
|---|---|---|---|
| `OpenSans-SemiCondensed-Regular.ttf`  | Open Sans | 400 | googlefonts/opensans |
| `OpenSans-SemiCondensed-SemiBold.ttf` | Open Sans | 600 | googlefonts/opensans |
| `OpenSans-SemiCondensed-Bold.ttf`     | Open Sans | 700 | googlefonts/opensans |
| `OpenSans-SemiCondensed-Italic.ttf`   | Open Sans | 400 italique | googlefonts/opensans |
| `IBMPlexMono-Regular.ttf`             | IBM Plex Mono | 400 | IBM/plex |
| `IBMPlexMono-Medium.ttf`              | IBM Plex Mono | 500 | IBM/plex |
| `SourceSerif4-Regular.ttf`            | aucune — hors maquette | 400 | adobe-fonts/source-serif |

Source Serif 4 ne fait plus partie de la maquette : `print.css` ne la déclare plus.
Seul `SourceSerif4-Regular.ttf` reste livré, pour `test/palette-html.py` ; la face
italique a été retirée.

Licences : `OFL-OpenSans.txt`, `OFL-SourceSerif4.txt`, `OFL-IBMPlexMono.txt`.

## Semi-condensé (largeur 87,5 %)

Il n'y a pas de `font-stretch` dans `print.css` : les faces Open Sans sont **figées
(instanciées) à `wdth=87.5`** depuis la police variable, une par poids. WeasyPrint 69
n'accepte pas les intervalles de poids (`font-weight: 300 800`) dans `@font-face` et son
support des axes variables au rendu est partiel ; figer les faces évite de dépendre de
`font-variation-settings`.

Recette (fontTools, via le venv WeasyPrint) — à rejouer si l'on veut d'autres poids :

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
f = TTFont("OpenSans[wdth,wght].ttf")          # master variable (googlefonts/opensans)
instancer.instantiateVariableFont(f, {"wght": 400, "wdth": 87.5}, inplace=True)
f.save("OpenSans-SemiCondensed-Regular.ttf")
```

IBM Plex Mono est distribuée en statique (Regular et Medium repris tels quels).
