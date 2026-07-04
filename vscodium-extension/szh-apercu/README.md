# SZH — Aperçu automatique

Extension interne SZH/CSPS. Après chaque compilation réussie (tâche « Aperçu / Export PDF »),
ouvre l'aperçu PDF de l'article actif (`out/<article>/<article>.pdf`) en **vue scindée à droite**,
sans voler le focus, et seulement s'il n'est pas déjà ouvert — le rechargement continu est
ensuite assuré par tomoki1207.pdf.

Réglage : `szh.apercuAuto` (défaut `true`).

Construite et publiée par la CI du dépôt (`release.yml`), installée sur les postes par
`update.ps1` via le `manifest.json` de la Release — même canal que les extensions épinglées.
