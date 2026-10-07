# SZH — Aperçu automatique

Petite extension VSCodium qui ouvre le PDF de l'article actif après chaque compilation
réussie.

Quand la tâche « Aperçu / Export PDF » se termine sans erreur, l'extension ouvre
`out/<slug>/<slug>.pdf` dans une colonne à droite, sans prendre le focus. Elle ne fait rien
dans ces cas :

- le fichier actif n'est pas `articles/<slug>/<slug>.md` ou `chapitres/<slug>/<slug>.md` ;
- le PDF n'existe pas ;
- le PDF est déjà ouvert (l'extension `tomoki1207.pdf` le recharge alors seule).

Le nom de la tâche est écrit dans [`extension.js`](extension.js). Il doit rester identique
au `label` de la tâche dans [`vscodium-user/tasks.json`](../../vscodium-user/tasks.json).

## Réglages

| Réglage | Défaut | Effet |
|---|---|---|
| `szh.apercuAuto` | `true` | active l'ouverture automatique |
| `szh.apercuMode` (déclaré par le cockpit) | `html` | l'extension n'agit qu'en mode `pdf` ; en mode `html`, la colonne de droite revient à l'aperçu HTML du cockpit |

## Construction et installation

La CI ([`release.yml`](../../.github/workflows/release.yml)) construit le `.vsix` et l'inscrit
au `manifest.json` de la version publiée. `windows/update.ps1` l'installe sur les postes,
avec les extensions épinglées ([`windows/VSIX.md`](../../windows/VSIX.md)).
