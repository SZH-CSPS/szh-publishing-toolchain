# Polices empaquetées (maquette SZH/CSPS)

Trois familles libres (licence SIL Open Font License 1.1), empaquetées ici pour un
rendu reproductible : WeasyPrint et Pandoc les chargent via `@font-face` dans
`../styles/print.css` (chemins relatifs `url("../fonts/…")`). Pandoc les inline en
base64 dans le HTML autonome (`--embed-resources`) ; WeasyPrint les sous-ensemble
dans le PDF.

## Fichiers et provenance

| Fichier | Famille `@font-face` | Poids / style | Source (OFL) |
|---|---|---|---|
| `OpenSans-SemiCondensed-Regular.ttf`  | Open Sans | 400 | googlefonts/opensans |
| `OpenSans-SemiCondensed-SemiBold.ttf` | Open Sans | 600 | googlefonts/opensans |
| `OpenSans-SemiCondensed-Bold.ttf`     | Open Sans | 700 | googlefonts/opensans |
| `OpenSans-SemiCondensed-Italic.ttf`   | Open Sans | 400 italique | googlefonts/opensans |
| `SourceSerif4-Regular.ttf`            | Source Serif 4 | 400 | adobe-fonts/source-serif |
| `SourceSerif4-Italic.ttf`             | Source Serif 4 | 400 italique | adobe-fonts/source-serif |
| `IBMPlexMono-Regular.ttf`             | IBM Plex Mono | 400 | IBM/plex |
| `IBMPlexMono-Medium.ttf`              | IBM Plex Mono | 500 | IBM/plex |

Licences : `OFL-OpenSans.txt`, `OFL-SourceSerif4.txt`, `OFL-IBMPlexMono.txt`.

## Semi-condensé (largeur 87,5 %)

La maquette applique `font-stretch: 87.5%` à Open Sans. WeasyPrint 69 n'accepte pas
les intervalles de poids (`font-weight: 300 800`) dans `@font-face` et son support
des axes variables au rendu est partiel. Pour un résultat fiable et fidèle, les
faces Open Sans sont **figées (instanciées) à `wdth=87.5`** depuis la police
variable, une par poids. Ainsi le corps utilise directement la largeur voulue sans
dépendre de `font-variation-settings`.

Recette (fontTools, via le venv WeasyPrint) — à rejouer si l'on veut d'autres poids :

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
f = TTFont("OpenSans[wdth,wght].ttf")          # master variable (googlefonts/opensans)
instancer.instantiateVariableFont(f, {"wght": 400, "wdth": 87.5}, inplace=True)
f.save("OpenSans-SemiCondensed-Regular.ttf")
```

Source Serif 4 a été figée à `wght=400, opsz=11` (roman + italique). IBM Plex Mono
est distribuée en statique (Regular/Medium repris tels quels).
