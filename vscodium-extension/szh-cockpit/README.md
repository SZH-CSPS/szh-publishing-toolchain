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

La barre « Revue SZH » gère l'import Word, la compilation/aperçu, les métadonnées (numéro
et articles), les tableaux et les images — sans quitter l'éditeur. Détail des gestes : le
`BIENVENUE.md` d'une revue et la documentation du dépôt (`docs/`, `PLANIFICATION.md`).

Construite et publiée par la CI du dépôt (`release.yml`), installée sur les postes par
`update.ps1` via le `manifest.json` de la Release — même canal que les extensions épinglées.

## Structure du code (refactor R1–R6, sans build)

L'extension reste chargée telle quelle (`main: ./extension.js`), **sans aucune étape de
build** : uniquement du CommonJS `require` (résolu à l'exécution) et des fichiers statiques.

```
extension.js            activate/deactivate + câblage des commandes + _pur (contrat headless)
lib/
  i18n.js               TEXTES_COCKPIT, T(clé[,args]), langueCockpit
  yaml.js               (dé)sérialiseurs ausgabe/frontmatter/meta, titreNumero, écriture atomique
  table-model.js        parseur/sérialiseur/opérations PURS du tableau
  slug.js               slugifier (miroir du slug Makefile)
  wsl.js                dormeur WSL (N1)
  formatting.js         mise en forme markdown (toggles + commandes szh.fmt.* + palette)
  webviews/util.js      construireHtml/lireMedia : lit media/, inline (nonce + CSP stricte)
media/
  table-editor.{html,css,js}      éditeur de tableau
  metadata-issue.{html,css,js}    métadonnées du numéro
  metadata-articles.{html,css,js} métadonnées des articles
  settings.{html,css,js}          réglages SZH
  apercu.{css,js}                 fragment injecté dans l'aperçu HTML
```

**Empaquetage (RR4).** `vsce package` (via `release.yml`) empaquète **tout le dossier** ;
`lib/` et `media/` en font partie et **doivent** être présents dans le VSIX (voir
`.vscodeignore`, qui ne les exclut jamais). Le rendu des webviews est conservé à l'identique :
les webviews n'injectent aucune **donnée** dans le HTML (elles arrivent par `postMessage`) ;
les libellés i18n sont des marqueurs `%%SZH:clé%%` résolus par `T()` à l'assemblage.

**Déploiement dev.** Copier **tout le dossier** de l'extension (pas seulement `extension.js`)
vers `%UserProfile%\.vscode-oss\extensions\szh-csps.szh-cockpit-<version>\`, puis redémarrer
VSCodium. (Ancien réflexe « copier `extension.js` » désormais insuffisant : il manquerait
`lib/` et `media/`.)
