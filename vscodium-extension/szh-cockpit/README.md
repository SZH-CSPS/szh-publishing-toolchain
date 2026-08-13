# SZH — Revue (cockpit)

Extension interne SZH/CSPS. Ajoute une barre latérale **« Revue SZH »** qui, dans un
dossier de revue (repéré par `ausgabe.yaml`), liste en **lecture seule** :

- **Articles** — un par dossier `articles/<slug>/<slug>.md` (tri alphabétique) ;
  clic = ouvrir le `.md`.
- **Word en attente** — les `.docx` déposés dans `articles-word/` (hors `_convertis/`),
  avec un **badge** de compte sur l'icône de la barre.

La vue n'apparaît que si le dossier ouvert est une revue (présence d'`ausgabe.yaml`) ;
un dossier quelconque ne montre aucune icône. La liste se rafraîchit automatiquement
quand des fichiers changent (dépôt/retrait d'un Word, nouvel article) ; un bouton
**Rafraîchir** est disponible en tête de vue.

Cette tranche (S2) est **purement passive** : elle n'écrit jamais dans le dossier de
revue. L'import guidé et les actions PDF/Compiler arrivent dans les tranches suivantes
(voir `PLAN-COCKPIT.md`).

Construite et publiée par la CI du dépôt (`release.yml`), installée sur les postes par
`update.ps1` via le `manifest.json` de la Release — même canal que les extensions épinglées.
