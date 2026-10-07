# Polices de la maquette

Ce dossier contient toutes les polices des PDF de Pronto. Toutes sont sous licence SIL Open
Font License 1.1 (`OFL-OpenSans.txt`, `OFL-IBMPlexMono.txt`, `OFL-SourceSerif4.txt`).

Les feuilles de style les chargent par `@font-face`, en chemins relatifs. Pandoc les intègre
au HTML autonome (`--embed-resources`) et WeasyPrint n'en garde dans le PDF que les glyphes
utilisés. Comme aucune police du système n'est utilisée, un PDF est le même sur tous les
postes. [`test/polices-check.py`](../../test/polices-check.py) le vérifie : il échoue si un
PDF contient une police qui ne vient pas de ce dossier.

## Fichiers

| Fichiers | Famille CSS | Graisses | Déclarée par | Usage |
|---|---|---|---|---|
| `OpenSans-SemiCondensed-{Regular,SemiBold,Bold,Italic,SemiBoldItalic,BoldItalic}.ttf` | Open Sans | 400, 600, 700, droites et italiques | `../styles/socle.css` | texte de la revue et des livres |
| `OpenSans-SemiCondensed-{Light,Medium,ExtraBold}.ttf` | Open Sans | 300, 500, 800 | `../styles/livre/normal.css`, `../styles/livre/couverture.css` | livres et couvertures |
| `SZHCondensed-{Regular,Bold}.ttf` | SZH Condensed | 400, 700 | `../styles/livre/normal.css`, `../styles/livre/couverture.css` | sommaire hiérarchique d'un livre, dos de la couverture « recherche » |
| `SZHCouverture-{Light,Regular,Italic,SemiBold,Bold}.ttf` | SZH Couverture | 300, 400, 400 italique, 600, 700 | `../styles/livre/couverture.css` | couverture FALC |
| `IBMPlexMono-{Regular,Medium}.ttf` | IBM Plex Mono | 400, 500 | `../styles/socle.css` | texte à chasse fixe |
| `SourceSerif4-Regular.ttf` | aucune | 400 | | seulement pour `test/palette-html.py` |

La revue ne déclare pas les graisses 500 et 800 d'Open Sans : une règle qui les demande
retombe sur 400 et 700. Les ajouter à `socle.css` changerait le rendu de la revue.

## Comment les faces sont faites

Toutes les faces Open Sans viennent de googlefonts/opensans, version 3.003, sans nom réservé
par la licence : on peut les modifier et les rediffuser.

| Faces | Origine | Traitement |
|---|---|---|
| `OpenSans-SemiCondensed-*` (droites) | master variable [`OpenSans[wdth,wght].ttf`](https://raw.githubusercontent.com/googlefonts/opensans/main/fonts/variable/OpenSans%5Bwdth,wght%5D.ttf), sha256 `36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878` | figées à `wdth=87.5`, une face par graisse |
| `OpenSans-SemiCondensed-*Italic` | master variable [`OpenSans-Italic[wdth,wght].ttf`](https://raw.githubusercontent.com/googlefonts/opensans/main/fonts/variable/OpenSans-Italic%5Bwdth,wght%5D.ttf), sha256 `fe269381e992f32e135801740998544d6235061e37c93ec067ad2be3edd5b17b` | figées à `wdth=87.5` |
| `SZHCondensed-*` | même master droit | figées à `wdth=75`, puis renommées |
| `SZHCouverture-*` | statiques `fonts/ttf/OpenSans-<Graisse>.ttf` du commit `bd7e37632246368c60fdcbd374dbf9bad11969b6` | renommées |
| `IBMPlexMono-*` | statiques IBM/plex | aucun |

On fige la largeur plutôt que d'utiliser `font-stretch` ou `font-variation-settings`, parce
que WeasyPrint gère mal les axes des polices variables et refuse un intervalle de graisses
dans `@font-face`.

### Figer une face

Avec fontTools, dans la WSL (`/opt/weasyprint/bin/python`) :

```python
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
f = TTFont("OpenSans[wdth,wght].ttf")
instancer.instantiateVariableFont(f, {"wght": 400, "wdth": 87.5}, inplace=True)
f.save("OpenSans-SemiCondensed-Regular.ttf")
```

Après toute face refaite depuis un master, relancer les deux scripts ci-dessous.

### Renommer (SZH Condensed, SZH Couverture)

Sous le nom « Open Sans », fontconfig servirait ces faces à toute demande d'Open Sans dans
une feuille qui les déclare, à la place des semi-condensées. Leur table `name` est donc
réécrite avec fontTools : famille (ids 1 et 16), style (2 et 17), nom complet (4), nom
PostScript `SZHCondensed-<Graisse>` ou `SZHCouverture-<Graisse>` (6), identifiant (3) ;
ids 18, 21, 22 et 25 supprimés. Copyright et marque (0 et 7) restent.

### Ajouter les glyphes manquants

Open Sans n'a pas six caractères que la maquette écrit. Sans eux, fontconfig prendrait une
police du système, et le caractère perdrait aussi son identité dans la couche texte du PDF
(la fine insécable deviendrait une espace ordinaire au copier-coller).

| Caractère | Écrit par | Glyphe ajouté |
|---|---|---|
| U+202F fine insécable | `filters/szh-numerotation.lua` (« Source : ») | celui de la fine U+2009 |
| U+2010 trait d'union | WeasyPrint, à chaque coupure de mot | celui de U+002D |
| U+2011 trait d'union insécable | les rédactions (noms propres, sigles) | celui de U+002D |
| U+25B8 ▸ | `../styles/print.css`, puce des listes | dessiné |
| U+21A9 ↩ | pandoc, retour de note | repris d'IBM Plex Mono |
| U+FE0E sélecteur de variante 15 | pandoc, derrière le ↩ | glyphe vide, sans chasse |

```bash
/opt/weasyprint/bin/python pipeline/fonts/glyphes-manquants.py
```

Le script traite toutes les faces sauf IBM Plex Mono et Source Serif 4. Il peut se relancer
sans dommage. `--verifier` ne modifie rien et sort en code 1 s'il manque un caractère.

Les flèches → (U+2192), ↑ (U+2191), ▶ (U+25B6) et les émojis ne sont pas couverts. Si un
article en contient, `test/polices-check.py` nomme le PDF concerné.

### Ajouter les petites capitales

Open Sans n'a pas de petites capitales, et WeasyPrint ne les simule pas :
`font-variant: small-caps` demande seulement la fonctionnalité OpenType `smcp`.
`petites-capitales.py` l'ajoute aux six faces `OpenSans-SemiCondensed` de 400 à 700 : chaque
minuscule reçoit la capitale de la graisse au-dessus, réduite à 80 %. `ß` reste en bas de
casse. Le texte extrait du PDF garde les minuscules d'origine. La règle CSS est dans
`../styles/socle.css`.

```bash
/opt/weasyprint/bin/python pipeline/fonts/petites-capitales.py   # après glyphes-manquants.py
```

Le script peut se relancer sans dommage. `--verifier` sort en code 1 si une face n'a pas ses
petites capitales.
