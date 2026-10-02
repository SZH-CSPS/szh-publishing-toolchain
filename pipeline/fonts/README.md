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
| `OpenSans-SemiCondensed-SemiBoldItalic.ttf` | Open Sans | 600 italique | googlefonts/opensans |
| `OpenSans-SemiCondensed-BoldItalic.ttf` | Open Sans | 700 italique | googlefonts/opensans |
| `OpenSans-SemiCondensed-Light.ttf`    | Open Sans | 300 (couverture seule) | googlefonts/opensans |
| `OpenSans-SemiCondensed-Medium.ttf`   | Open Sans | 500 (couverture seule) | googlefonts/opensans |
| `OpenSans-SemiCondensed-ExtraBold.ttf` | Open Sans | 800 (couverture seule) | googlefonts/opensans |
| `SZHCouverture-Light.ttf` | SZH Couverture | 300 | googlefonts/opensans (statique, renommée) |
| `SZHCouverture-Regular.ttf` | SZH Couverture | 400 | googlefonts/opensans (statique, renommée) |
| `SZHCouverture-Italic.ttf` | SZH Couverture | 400 italique | googlefonts/opensans (statique, renommée) |
| `SZHCouverture-SemiBold.ttf` | SZH Couverture | 600 | googlefonts/opensans (statique, renommée) |
| `SZHCouverture-Bold.ttf` | SZH Couverture | 700 | googlefonts/opensans (statique, renommée) |
| `IBMPlexMono-Regular.ttf`             | IBM Plex Mono | 400 | IBM/plex |
| `IBMPlexMono-Medium.ttf`              | IBM Plex Mono | 500 | IBM/plex |
| `SourceSerif4-Regular.ttf`            | aucune — hors maquette | 400 | adobe-fonts/source-serif |

Source Serif 4 ne fait plus partie de la maquette : `print.css` ne la déclare plus.
Seul `SourceSerif4-Regular.ttf` reste livré, pour `test/palette-html.py` ; la face
italique a été retirée.

Licences : `OFL-OpenSans.txt`, `OFL-SourceSerif4.txt`, `OFL-IBMPlexMono.txt`.

## Glyphes ajoutés aux faces Open Sans

Six caractères que la maquette écrit d'elle-même **ne sont pas dans Open Sans** en amont.
Sans eux, fontconfig comblait les trous au moment du build avec ce qu'il trouvait sur la
machine — DejaVu et Noto sur l'image WSL, autre chose ailleurs, rien du tout sur un
troisième poste. Le PDF n'était donc pas le même d'un poste à l'autre, contrairement à ce
que promet `../../docs/MAINTENANCE.md` §2 ; et un caractère rendu par une police de repli
perd son identité dans la couche texte du PDF : la fine insécable de « Source : »
ressortait en espace ordinaire d'un copier-coller — mesuré.

| Caractère | Écrit par | Ajouté comment |
|---|---|---|
| U+202F fine insécable | `filters/szh-numerotation.lua` (« Source : ») | lié au glyphe de la fine sécable U+2009 |
| U+2010 trait d'union | WeasyPrint, à chaque coupure de mot (`hyphens: auto`) | lié au glyphe d'U+002D |
| U+2011 trait d'union insécable | les rédactions, dans les noms propres et les sigles | lié au glyphe d'U+002D |
| U+25B8 ▸ triangle | `../styles/print.css`, la puce de toutes les listes | dessiné, côté 0,498 em, centré sur la mi-hauteur d'x |
| U+21A9 ↩ retour de note | pandoc, l'appel de retour d'une note | repris d'IBM Plex Mono, mis à l'échelle du cadratin |
| U+FE0E sélecteur 15 | pandoc, collé derrière le ↩ | glyphe vide d'avance nulle |

Recette, idempotente et à **rejouer après toute reprise depuis le master variable** (celui
d'amont n'a pas ces glyphes) :

```bash
/opt/weasyprint/bin/python pipeline/fonts/glyphes-manquants.py
```

`glyphes-manquants.py --verifier` ne réécrit rien et sort 1 s'il manque quelque chose.
Le contrôle qui compte est ailleurs : `test/polices-check.py` vérifie qu'**aucune police
hors de ce dossier n'est embarquée** dans les PDF produits — c'est lui qui prouve la
reproductibilité, la couverture des glyphes n'en étant que le moyen.

Licences : Open Sans est sous OFL 1.1 **sans Reserved Font Name** (voir la ligne de
copyright d'`OFL-OpenSans.txt`), la modification et la rediffusion sous le même nom sont
donc permises — c'est déjà ce que fait l'instanciation semi-condensée ci-dessous. La
flèche ↩ vient d'IBM Plex Mono, également OFL 1.1, dont le nom réservé « Plex » n'est pas
employé par la face dérivée ; sa licence est livrée ici.

Restent non couverts, et donc encore servis par une police de repli **si un article les
emploie** : → U+2192, ↑ U+2191, ▶ U+25B6 et les émojis. Aucun article de la revue n'en
écrit dans son corps aujourd'hui (`revue-template/BIENVENUE.md` en contient, mais ce
fichier ne passe pas par la chaîne d'impression). `test/polices-check.py` les signalerait
en nommant le PDF fautif.

## Petites capitales ajoutées aux faces Open Sans

Open Sans n'a pas de petites capitales, et WeasyPrint ne les simule pas : il traduit
`font-variant: small-caps` en fonctionnalité OpenType `smcp` et s'arrête là. Sans `smcp`
dans la face, `[Piaget]{.smallcaps}` sortait en bas de casse ordinaire, sans avertissement
(mesuré le 29.09.2026, WeasyPrint 70, Pango 1.56). `petites-capitales.py` ajoute aux six
faces Open Sans une petite capitale par minuscule (352 par face) : la capitale de la face
**d'une graisse au-dessus**, réduite à 80 %, pour que le fût ne maigrisse pas. `ß` reste en
bas de casse (sa capitale est « SS », deux caractères). La couche texte du PDF garde le
bas de casse d'origine. La règle qui l'appelle est dans `../styles/socle.css`.

```bash
/opt/weasyprint/bin/python pipeline/fonts/petites-capitales.py   # après glyphes-manquants.py
```

Idempotent ; `--verifier` sort 1 si une face n'a pas ses petites capitales.

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

Les italiques partent du master italique `OpenSans-Italic[wdth,wght].ttf`. Les deux faces
italiques grasses (600 et 700) ont été instanciées ainsi le 29.09.2026, depuis
`https://raw.githubusercontent.com/googlefonts/opensans/main/fonts/variable/OpenSans-Italic%5Bwdth,wght%5D.ttf`
(Version 3.003, sha256 `fe269381e992f32e135801740998544d6235061e37c93ec067ad2be3edd5b17b`).
Même master que les faces déjà livrées : l'italique 400 et le gras 700 réinstanciés de ces
masters retombent au contour près sur les fichiers d'ici (seuls diffèrent les glyphes
ajoutés par `glyphes-manquants.py`).

Les faces 300, 500 et 800 (02.10.2026, modèles de couverture classique, recherche et
prospectrum) sont instanciées ainsi depuis le master droit
`https://raw.githubusercontent.com/googlefonts/opensans/main/fonts/variable/OpenSans%5Bwdth,wght%5D.ttf`
(Version 3.003, sha256 `36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878`),
puis complétées par `glyphes-manquants.py`, sans petites capitales. Même master que les faces
livrées : le 400 réinstancié retombe au contour près sur `OpenSans-SemiCondensed-Regular.ttf`
(0 glyphe différent sur 1 150). Seule `../styles/livre/couverture.css` les déclare : la revue
demande déjà 500 et 800 (`print.css`), qui y retombent aujourd'hui sur 400 et 700, et
changerait de rendu si `socle.css` les déclarait.

IBM Plex Mono est distribuée en statique (Regular et Medium repris tels quels).

## SZH Couverture : Open Sans de chasse normale, renommée (couverture FALC)

La référence de couverture FALC est en Open Sans de chasse normale. Les cinq faces
`SZHCouverture-{Light,Regular,Italic,SemiBold,Bold}.ttf` en sont les statiques d'amont,
déclarées par `../styles/livre/couverture.css` seule, pour la maquette FALC ; la
couverture « normal », l'intérieur des livres et la revue restent en semi-condensé.

Provenance : téléchargées le 01.10.2026 depuis
`https://raw.githubusercontent.com/googlefonts/opensans/bd7e37632246368c60fdcbd374dbf9bad11969b6/fonts/ttf/OpenSans-<Graisse>.ttf`
(Version 3.003, OFL 1.1 identique à `OFL-OpenSans.txt`, sans Reserved Font Name).

| Fichier livré | Fichier d'amont | sha256 d'amont | sha256 livré |
|---|---|---|---|
| `SZHCouverture-Light.ttf`    | `OpenSans-Light.ttf`    | `3472097ec4d9e57228cbfad3c9911e53923664d3df86568d0b05d674399e034e` | `ffcc49a64a1fbe38d00f7d11eed887842422be925f1fab5ebd4e17b64957185d` |
| `SZHCouverture-Regular.ttf`  | `OpenSans-Regular.ttf`  | `c53aceea2dcf5b4098099c0c4d0a061d17e178a049317b42a422b1a9f7f8eb59` | `50f3ff5a4cf210ad923b5430cd25058d977321b9cbd8ffc9d41fe38857cc90f1` |
| `SZHCouverture-Italic.ttf`   | `OpenSans-Italic.ttf`   | `93bc1bb6abf4e6b7c75d7131714061d5b57cc478abcabe4cb3519bb38fb917aa` | `bfd643e1f4ee98e6d526d3f311ca51ad03a7296290a00b86bc7683a12be49333` |
| `SZHCouverture-SemiBold.ttf` | `OpenSans-SemiBold.ttf` | `4a413711684a9dd564ef0f1c10cb62b5d9f7eb6df2cff962f5341a6ecd5f64ae` | `2e2905601f410f5fb2f2aad7a518034360462d92fcb95f9192b9d1463f0023bf` |
| `SZHCouverture-Bold.ttf`     | `OpenSans-Bold.ttf`     | `27da758f4dcac9a65abe914c13b463b42982b9909bc65713424099f4810bd1e6` | `bbfeb0de0467df576035a9a064ea78b70feb4dad472f9e101959ef6db0536f6c` |

Deux retouches, dans cet ordre :
1. `glyphes-manquants.py` (elles sont dans sa table) leur ajoute les six caractères de la
   maquette ;
2. renommage, fichiers ET table `name` (fontTools, venv `/opt/weasyprint`) : famille
   « SZH Couverture » (ids 1, 16), style (2, 17), nom complet (4), PostScript
   `SZHCouverture-<Graisse>` (6), identifiant (3) ; ids 18, 21, 22, 25 retirés. Plus aucun
   « Open Sans » dans ces champs ; copyright et marque (0, 7) inchangés.

Pourquoi renommer, alors que l'OFL d'Open Sans ne réserve aucun nom : restées « Open Sans »
dans leur table, fontconfig les servait à TOUTE demande « Open Sans » d'une feuille qui les
déclare — mesuré, la couverture « normal », en `var(--font-sans)`, sortait en chasse
normale. Pas de petites capitales (`petites-capitales.py` ne les liste pas) : la couverture
n'en compose pas. `test/polices-check.py` ne contrôle la couverture des six caractères que
pour les faces `OpenSans-*` ; pour celles-ci, c'est `glyphes-manquants.py --verifier`.
