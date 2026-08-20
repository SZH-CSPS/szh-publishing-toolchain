# Banc d'essai

Trois choses vivent ici : une mini-revue qui éprouve le rendu PDF de la maquette, les
contrôles de contraste de la palette, et les contrats du cockpit.

```sh
node --test test/js/*.test.js   # contrats du cockpit : aller-retours et valeurs jumelles
python3 test/apca-check.py      # contrastes de la palette
python3 test/palette-html.py    # régénère docs/palette.html
bash test/build-render.sh       # dans WSL : build PDF + PNG de chaque page
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

> **En-tête condensé** — le banc compose la couverture par défaut, à hauteur fixe.
> Pour éprouver l'autre allure, ajouter une ligne `entete-condensee: true` à
> `test/ausgabe.yaml`, rebâtir, comparer les PNG, puis **retirer la ligne** (le banc doit
> rester sur le défaut). Le cas le plus parlant n'est pas ici : c'est une couverture
> **courte** (titre de deux lignes, un seul auteur, pas de sous-titre), celle où le mode
> par défaut laisse un grand blanc. Les figures ne sont pas couvertes par le banc (aucune
> image dans le corpus) : l'ordre légende/image se vérifie sur un article réel.
- `apca-check.py` — vérificateur de **contraste APCA** de la palette : lit les hex de
  `pipeline/styles/couleurs.css` et les jetons émis par `pipeline/accent-css.py`, mesure
  toutes les paires texte/fond réellement utilisées et sort en erreur si l'une échoue.
  Aucune dépendance, aucun build :
  ```sh
  python3 test/apca-check.py
  ```
  **À relancer après toute modification de `couleurs.css`** (les niveaux sont calculés au
  plus juste : marges de contraste serrées).
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
