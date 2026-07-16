# Plan — Refactor de l'extension szh-cockpit (sans build)

Spec autoporteuse (skill `senior-software-engineer`), **tranche par tranche**
(R1 → R7), un commit `R<n>: …` par tranche. Objectif : casser le monolithe
`vscodium-extension/szh-cockpit/extension.js` (~3900 lignes) en **modules CommonJS**
et **externaliser le HTML/CSS/JS des webviews** en fichiers réels — **sans aucune
étape de build** (ni npm, ni bundler), à **comportement identique**.

## Contraintes NON négociables
- **Aucun build** : l'extension est chargée telle quelle (`main: ./extension.js`),
  empaquetée par `vsce` (zip). Uniquement du **CommonJS `require`** (résolu à
  l'exécution) et des **fichiers statiques**. Pas de TypeScript/webpack/esbuild.
- **Comportement identique** : aucune régression fonctionnelle ni de rendu.
- **Surface de test préservée** : `extension.js` continue d'exporter
  `module.exports = { activate, deactivate, _pur: { … } }` avec **exactement les mêmes
  fonctions dans `_pur`** (ré-agrégées depuis les modules) → les **harnais headless
  existants passent sans modification**.
- Webviews : **CSP stricte conservée** (nonce, `localResourceRoots: []`, tout inline,
  zéro requête externe) — on lit les fichiers à l'exécution et on les **inline**.
- **Ne pas toucher** : `szh-apercu`, `szh-tabelle-inclure.lua`, le lot D34
  (`PLANIFICATION.md`, `windows/update.ps1`, `windows/user.wslconfig`), `Feature.docx`.
  `git status` avant chaque commit.

## Cible (arborescence)
```
vscodium-extension/szh-cockpit/
  extension.js            # activate/deactivate + câblage des commandes (mince) + _pur ré-agrégé
  package.json, package.nls*.json
  lib/
    i18n.js               # TEXTES_COCKPIT, T, langueCockpit
    yaml.js               # decouperValeurYaml/Flow, (analyser|serialiser)Ausgabe, frontmatter,
                          #   (analyser|serialiser)Meta, écriture atomique, citer…
    slug.js               # slugifier
    table-model.js        # lireAttributsHtml, canoniserInline, analyser/serialiserTable,
                          #   matriceOccupation, etendre/compacterGrille, normaliser/finaliserModele,
                          #   disposition, ajouter/supprimer Ligne/Colonne, fusionner, scinder,
                          #   appliquerOperationTable, inferer*, enumOu, lignePos
    etat.js               # état mutable partagé (buildEnCours, importEnCours) via getters/setters
    wsl.js                # dormeur WSL (N1)
    tasks.js              # lancerTache/lancerBuild/executerImport/lancerConversion/toutExporter/compiler
    preview.js            # ouvrirApercuPdf, aperçu HTML (host), basculerApercu, ouvrirArticle
    tree.js               # FournisseurRevue (+ constructeurs d'items)
    formatting.js         # basculer*/enroberBloc/squeletteTableau/fmt*/palette + enregistrerCommandes
    webviews/
      metadata-issue.js metadata-articles.js settings.js table-editor.js   # hôtes (createWebviewPanel + messages)
  media/
    metadata-issue.{html,css,js}  metadata-articles.{html,css,js}
    settings.{html,css,js}  table-editor.{html,css,js}  apercu.{html,css,js}?
    webview-util.js         # helper commun : lire+inliner (html+css+js) avec nonce, CSP
```

## Chargement des webviews (patron, sans build)
Un helper unique (`lib/webviews/util.js` ou `media/webview-util`) :
`construireHtml(nomBase, nonce, valeursInitialesNon)` → lit `media/<nomBase>.html`,
`.css`, `.js` avec `fs.readFileSync(path.join(__dirname, …))`, remplace le marqueur
`__NONCE__`, assemble : `<!DOCTYPE html>…<meta CSP nonce>…<style>${css}</style>…<body>${html}<script nonce="${nonce}">${js}</script>`. **Aucune** valeur de données injectée dans le HTML (elles arrivent toujours par `postMessage`, comme aujourd'hui) → pas d'échappement. Le `.js` ne contient jamais `</script>`.

## Tranches (chacune : node --check + harnais verts + recopie dev, un commit)

- [ ] **R1 · i18n** → `lib/i18n.js` (TEXTES_COCKPIT, T, langueCockpit). `extension.js` (et
  les futurs modules) `require('./lib/i18n')`. **Gate** : harnais parité i18n (fr=de) + tout
  charge.
- [ ] **R2 · sérialiseurs YAML** → `lib/yaml.js` (ausgabe + frontmatter + meta + écriture
  atomique). **Gate** : harnais round-trip meta + ausgabe (les charger via `require('./lib/yaml')`
  OU via `_pur` ré-agrégé — au choix, mais les harnais existants doivent passer).
- [ ] **R3 · modèle de tableau** → `lib/table-model.js` (toutes les fonctions pures du tableau).
  **Gate** : harnais round-trip tableau (analyser/serialiser/fusion/scission…).
- [ ] **R4 · externaliser la webview ÉDITEUR de tableau** → `media/table-editor.{html,css,js}`
  (le gros gabarit-chaîne actuel), chargée via le helper + nonce. **Gate** : node --check ;
  GUI (l'éditeur s'ouvre, édition/fusion/menu contextuel/styles/enregistrer OK).
- [ ] **R5 · externaliser les AUTRES webviews** (métadonnées numéro, métadonnées articles,
  réglages, aperçu HTML) → `media/*.{html,css,js}`. **Gate** : node --check ; GUI de chaque
  formulaire (valeurs relues, enregistrement).
- [ ] **R6 · modules impératifs** → `lib/{slug,wsl,tasks,preview,tree,formatting,etat}.js` et
  `lib/webviews/*.js`. `extension.js` devient mince (activate + registerCommand). **État partagé**
  (buildEnCours/importEnCours) centralisé dans `lib/etat.js` (getters/setters) — **jamais dupliqué**.
  Les singletons de panneau restent internes à chaque module de webview. **Gate** : tous les
  harnais + node --check + GUI complet.
- [ ] **R7 · empaquetage & process** : vérifier qu'aucun `.vscodeignore` n'exclut `lib/`/`media/` ;
  que `release.yml` (vsce) empaquète bien tout ; **adapter les scripts de sync dev/toolkit** pour
  copier **tout le dossier** de l'extension (plus seulement `extension.js`). Documenter dans
  `README`/`PLAN-COCKPIT` la nouvelle structure. **Gate** : `vsce ls`/inspection de l'arbre
  empaqueté (ou revue manuelle du contenu) ; note pour Robin sur la copie dev multi-fichiers.

## Gates transverses (à chaque tranche)
- `node --check` sur chaque fichier `.js` modifié/créé (via Electron `ELECTRON_RUN_AS_NODE`).
- **Tous les harnais headless existants restent verts** : round-trip tableau, meta, ausgabe,
  parité i18n, titreNumero (ils chargent le vrai `extension.js`/modules via `Module._load`).
  Recréer les harnais dans `scratchpad` si besoin ; le **contrat `_pur` est immuable**.
- Recopie de **tout le dossier** de l'extension dans
  `%UserProfile%\.vscode-oss\extensions\szh-csps.szh-cockpit-0.1.0\` après chaque tranche.
- GUI décrite pour Robin (les webviews/interactions ne sont pas testables en headless).

## Risques
| # | Risque | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| **RR1** | État mutable partagé (buildEnCours…) dupliqué/désynchronisé après split | Moy | Élevé | `lib/etat.js` unique (getters/setters) ; jamais de copie locale ; R6 en dernier |
| **RR2** | Régression de rendu/CSP à l'externalisation des webviews | Moy | Élevé | Helper d'inline + nonce identique à l'inline actuel ; `localResourceRoots: []` conservé ; GUI par webview |
| **RR3** | `_pur` casse → harnais rouges | Faible | Élevé | Contrat `_pur` **immuable**, ré-agrégé depuis les modules ; gate à chaque tranche |
| **RR4** | Fichiers non empaquetés (lib/media absents du VSIX) → extension cassée en prod | Faible | Élevé | R7 : inspection de l'arbre vsce ; pas de `.vscodeignore` excluant lib/media |
| **RR5** | Chemins `require`/`readFileSync` relatifs erronés | Moy | Moyen | `path.join(__dirname, …)` partout ; node --check + chargement réel au test |

## À faire par Robin ensuite
- Après R7 : **re-synchroniser le dossier complet** de l'extension (dev + toolkit) et prévoir
  que la **release** embarque `lib/` + `media/`.
- Le refactor **ne change aucune décision D** ni le comportement — rien à transcrire dans
  `PLANIFICATION.md` (hors mention éventuelle de la nouvelle structure).
- **Ensuite seulement** : lancer l'**éditeur v2** (`PLAN-EDITEUR-V2.md`) sur la base propre.
