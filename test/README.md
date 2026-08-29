# Banc d'essai

Trois choses vivent ici : une mini-revue qui éprouve le rendu PDF de la maquette, les
contrôles de contraste de la palette, et les contrats du cockpit.

`test/js/` porte deux familles. `contrats.test.js` contrôle ce qui se recopie d'un fichier
à l'autre et les aller-retours des sérialiseurs. `webviews.test.js` **exécute** les
formulaires : `dom-minimal.js` fournit juste assez de DOM pour charger le script assemblé
d'une webview, lui envoyer le message de l'hôte et compter ce qu'elle a construit. Sans
cela, une erreur au rendu ne se voyait pas — la page gardait son titre et son bouton, les
cartes n'arrivaient jamais, et rien ne le disait. C'est arrivé deux fois.

```sh
node --test "test/js/*.test.js"  # contrats du cockpit, et rendu réel des webviews
python3 test/apca-check.py      # contrastes : palette, couverture, pages courantes
python3 test/typo-check.py      # typographie des textes visibles, fr et de
python3 test/typo-articles.py   # typographie du texte des articles, par pandoc
python3 test/palette-html.py    # régénère docs/palette.html
bash test/build-render.sh       # dans WSL : build PDF + PNG de chaque page, figures-check.py compris
python test/render.py <pdf> <png> [page] [échelle]   # côté Windows : une seule page
```

Les trois premiers ne demandent rien de particulier ; les deux derniers rendent des PNG,
et c'est là qu'il faut choisir son camp. `build-render.sh` a besoin d'un venv Python avec
`pypdfium2` et `Pillow` **dans la distro** (voir plus bas) ; s'il n'y est pas, le script
compile mais ne rend aucune image. La voie courte, quand on veut juste comparer une page
avant et après une retouche de maquette : compiler dans WSL, puis appeler `render.py`
côté Windows, où ces deux paquets sont déjà là.

## La mini-revue

Elle sert à éprouver le rendu (couverture, coupures de page, veuves et orphelines,
styles éditoriaux, redimensionnement des tableaux). Elle n'est pas destinée à la
publication.

## Contenu
- `ausgabe.yaml` — numéro de test (revue « Revue suisse… », couleur bleu acier).
- `articles/contenu-long/` — article ≥ 6 pages : titres H1–H4, listes, citation,
  hervorhebung, question, encadré « wichtig », **2 tableaux** (inclus `.szh-tabelle`
  + tableau pipe) et **notes de bas de page**. Conçu pour provoquer des coupures
  difficiles (veuves/orphelines) et stresser l'auto-dimensionnement des tableaux.
- `articles/couverture-stress/` — couverture sous contrainte : **12 auteurs**,
  10 mots-clés, titre/sous-titre longs (hauteur de hero fixe, méta ancrée en bas).
- `articles/figures/` — six cas d'images, un par défaut déjà constaté : figure numérotée
  (légende avant l'image, crédits en queue), **image hors numérotation avec crédits**
  (`.szh-hors-figure` : ni numéro ni légende, mais une `<figure>` dont la `<figcaption>`
  ne porte que le crédit, **après** l'image), **image hors numérotation sans crédits**
  (pas de `<figure>` du tout — le cas qui débordait de la page avant que `print.css` ne
  contraigne toute image), vectoriel décoratif (`alt=""`), résolution insuffisante
  (320 px, qui ne doit pas être agrandie), **deux insertions de la même image** (deux
  numéros, un seul jeu de crédits), et **deux grilles d'images** — quatre images en 2 × 2
  avec les crédits des quatre rassemblés dans une seule légende, puis deux bandeaux sans
  attribut `disposition`, que le mode automatique doit empiler plutôt que mettre côte à
  côte. Les images sont des bandes de couleur générées, de quelques kilooctets.

> **En-tête condensé** — le banc compose la couverture par défaut, à hauteur fixe.
> Pour éprouver l'autre allure, ajouter une ligne `entete-condensee: true` à
> `test/ausgabe.yaml`, rebâtir, comparer les PNG, puis **retirer la ligne** (le banc doit
> rester sur le défaut). Le cas le plus parlant n'est pas ici : c'est une couverture
> **courte** (titre de deux lignes, un seul auteur, pas de sous-titre), celle où le mode
> par défaut laisse un grand blanc.
- `apca-check.py` — vérificateur de **contraste APCA** : lit les hex de
  `pipeline/styles/couleurs.css`, les jetons émis par `pipeline/accent-css.py` et, depuis
  le 23.08.2026, les couleurs de `pipeline/styles/print.css` — celles du hero de
  couverture, de l'en-tête courant et du pied. Il mesure toutes les paires texte/fond
  réellement utilisées et sort en erreur si l'une échoue. 155 paires aujourd'hui.
  Aucune dépendance, aucun build :
  ```sh
  python3 test/apca-check.py
  ```
  **À relancer après toute modification de `couleurs.css` ou de `print.css`** (les niveaux
  sont calculés au plus juste : marges de contraste serrées). Les couleurs de `print.css`
  sont cherchées sélecteur par sélecteur, renvois `var()` suivis : renommer une règle fait
  échouer le script au lieu de le rendre aveugle.
- `typo-articles.py`  – contrôle du **filtre de typographie des articles**,
  `pipeline/filters/szh-typographie.lua`. Chaque cas est un fragment Markdown, une langue
  d’article et le texte attendu en sortie ; le rendu passe par un vrai pandoc, en
  `plain`, pour que l’attendu se lise comme du texte. Les insécables y sont écrites
  `[nb]` : sans cela un attendu faux serait indiscernable d’un attendu juste.
  ```sh
  python3 test/typo-articles.py        # sortie 1 au premier écart
  python3 test/typo-articles.py -v     # montre aussi les cas qui passent
  ```
  Les cas couvrent autant ce qui doit CHANGER que ce qui doit rester **immobile** : une
  URL, une heure, une date ISO, un DOI, un `COVID-19`, un bloc de code, et la fine
  insécable que `szh-numerotation.lua` a posée. ⚠ Sans pandoc, le script ne prétend pas
  passer : il le dit et sort en échec.
- `typo-check.py`  – contrôle de **typographie** des chaînes visibles, dans les deux
  langues. Les règles viennent du *Guide du typographe* pour le français et du Duden pour
  l’allemand suisse, et chacune a été confrontée aux 421 galleys publiées sur ojs.szh.ch
  (voir `docs/TYPOGRAPHIE.md`). Français et allemand ont des règles **opposées** sur
  l’espacement : le contrôle est donc par langue, jamais global.
  ```sh
  python3 test/typo-check.py              # rapport, sortie 1 au premier écart
  python3 test/typo-check.py --corriger   # applique les corrections sûres
  python3 test/typo-check.py --liste      # les règles, sans rien lire
  ```
  **À relancer après toute retouche de `lib/i18n.js`, de `package.nls*.json`, de la table
  `$SzhTextes` ou d’un message de filtre Lua.** Il ne lit que les surfaces listées dans
  `SURFACES` : les commentaires de code gardent leur convention, et les clés d’OJS ne
  doivent surtout pas bouger.
- `palette-html.py` — régénère `docs/palette.html`, la planche de la palette : les 11 crans de
  chaque couleur, dont celui qui porte la couleur de charte elle-même. Chaque cran montre son Lc
  et le texte qu'il a le droit de recevoir : corps de texte, gros titre seulement, ou rien.
  Page autonome (polices de la maquette embarquées), à ouvrir dans un navigateur :
  ```sh
  python3 test/palette-html.py
  ```
  **À relancer aussi après toute modification de `couleurs.css`** — une planche périmée est
  pire que pas de planche.

## Build + capture PNG
Depuis WSL (distro `SZH-Publishing`), avec un venv Python contenant `pypdfium2`
et `Pillow` :

```sh
python3 -m venv ~/pdfvenv
curl -sS https://bootstrap.pypa.io/get-pip.py | ~/pdfvenv/bin/python   # si pip absent
~/pdfvenv/bin/python -m pip install pypdfium2 Pillow

bash test/build-render.sh              # tous les articles
bash test/build-render.sh contenu-long # un seul
```

Les PDF et les PNG (une image par page) sont écrits dans `test/out/<slug>/`
(ignoré par git). `SZH_RENDER` permet de pointer un autre interpréteur.

`build-render.sh` branche aussi `figures-check.py` après le rendu PNG de chaque slug :
aucune légende de figure ne doit rester seule sur sa page, coupée de l'image qu'elle
légende — un défaut que le PDF ne signale pas et que la porte PDF/UA laisse passer, seul
l'œil sur un PNG l'attrapait jusqu'ici. Il tient le plafond de hauteur des images
(`--plafond-figure`, `pipeline/styles/socle.css`) : ce qui le casse, c'est une valeur trop
généreuse, une marge de figure qui grossit, ou une légende de six lignes de crédits.
Utilise `/opt/weasyprint/bin/python3` (`$SZH_FONTTOOLS`), seul interpréteur de la distro
qui importe `weasyprint` ; ignoré s'il est introuvable.
