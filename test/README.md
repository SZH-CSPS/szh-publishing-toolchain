# Modèles de test de la maquette

Mini-revue servant à éprouver le rendu PDF de la maquette (couverture, coupures de
page, veuves/orphelines, styles éditoriaux, redimensionnement des tableaux). **Non
destinée à la publication** — c'est un banc d'essai réutilisable.

## Contenu
- `ausgabe.yaml` — numéro de test (revue « Revue suisse… », couleur bleu acier).
- `articles/contenu-long/` — article ≥ 6 pages : titres H1–H4, listes, citation,
  hervorhebung, question, encadré « wichtig », **2 tableaux** (inclus `.szh-tabelle`
  + tableau pipe) et **notes de bas de page**. Conçu pour provoquer des coupures
  difficiles (veuves/orphelines) et stresser l'auto-dimensionnement des tableaux.
- `articles/couverture-stress/` — couverture sous contrainte : **12 auteurs**,
  10 mots-clés, titre/sous-titre longs (hauteur de hero fixe, méta ancrée en bas).

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
