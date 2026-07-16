# Plan — Éditeur de tableau v2 (UX) — spec pour Opus

Spec autoporteuse (skill `senior-software-engineer`), tranche par tranche
(V2a → V2b → V2c → V2d), un commit `V2x: …` par tranche. Français partout.
Étend l'éditeur maison (webview) de D57/T1–T3. **Solution A conservée : JS pur, zéro
dépendance, tout en webview.** Les fonctions PURES du modèle (`analyserTable`,
`serialiserTable`, `fusionner`, `scinder`, `ajouter/supprimerLigne/Colonne`,
`appliquerOperationTable`, exportées `_pur`) restent la source de vérité — on les
**réutilise/étend**, on ne les casse pas (gate round-trip inchangé).

> ⚠ **Ordre recommandé** : implémenter ce lot **APRÈS le refactor** (externalisation
> de la webview de l'éditeur en fichiers réels `.js/.css/.html`). ~90 % de v2 est du
> code de webview ; l'écrire dans les gabarits-chaînes actuels puis le déplacer au
> refactor = double travail. Voir la note de fin.

## Décisions

- **D58 — Largeurs/hauteurs 100 % automatiques (CSS).** Les tableaux du rendu final
  utilisent l'**auto-layout** : `table-layout: auto` + `width: 100%` dans `print.css`,
  cellules qui reviennent à la ligne (`overflow-wrap: anywhere`, `hyphens: auto` selon la
  langue). **Aucune largeur/hauteur fixe** n'est émise par l'éditeur ni stockée dans le
  `<table>`. Le redimensionnement manuel de colonne est **abandonné** au profit de
  l'auto-distribution. La hauteur mini de l'éditeur (webview) reste **cosmétique d'édition**
  et n'affecte pas le PDF.
- **D59 — Alignement du texte** par cellule et par colonne : encodé sur la cellule
  (`data-align="left|center|right"`, défaut left), appliqué en bloc à une colonne via la
  sélection. Rendu par `print.css` + reflété dans l'aperçu de l'éditeur.
- **D60 — Historique d'édition** (annuler/rétablir) dans la webview : pile d'états du
  **modèle** (structure sérialisable), bornée (ex. 100 pas). N'affecte pas le fichier tant
  qu'on n'enregistre pas.

## Garde-fous

- Webview : **CSP stricte + construction DOM** (aucune injection HTML ; valeurs par
  `postMessage` ; nonce). JS pur, zéro dépendance, API `^1.75`. i18n via
  `TEXTES_COCKPIT`/`package.nls` (**parité fr/de obligatoire**).
- **Round-trip préservé** : toute opération passe par le modèle et
  `analyser→serialiser→analyser` reste stable (harnais headless).
- **Ne pas toucher** : `szh-tabelle-inclure.lua`, `szh-apercu`, le lot D34
  (`PLANIFICATION.md`, `windows/update.ps1`, `windows/user.wslconfig`) ni `Feature.docx`.
  `git status` avant chaque commit ; ne stager que les fichiers de la tranche.
- Outillage headless via Electron (`ELECTRON_RUN_AS_NODE`), `_pur`, résultats sur disque +
  `process.exitCode`. Recopie dev après chaque tranche.

## Tranches

### V2a · Navigation & historique — *webview + boutons*
- [ ] **Annuler / Rétablir** (`Ctrl+Z` / `Ctrl+Y` **dans la webview**) : pile d'états du
  modèle (D60), boutons optionnels dans la barre.
- [ ] **Navigation clavier** entre cellules : `Tab`/`Maj+Tab` (suivante/précédente, passe à
  la ligne suivante en fin de rangée), `Entrée` (descendre), flèches quand on n'édite pas le
  texte. Respecte les fusions (saut de cellule).
- [ ] **Sélection par glisser** (drag) en plus de Maj+clic (plage rectangulaire).
- [ ] **Vider la cellule / effacer la mise en forme** de la sélection (contenu et/ou inline).
- [ ] **Boutons barre d'outils** : **« Enregistrer »** (conservé) + **« Retour à l'article »**
  (`postMessage` → l'hôte ouvre `articles/<slug>/<slug>.md` en colonne 1 et referme/positionne
  l'éditeur ; garde « non-enregistré » de V2d respectée).
- **Vérif** : `node --check` ; harnais (undo/redo = suite d'états cohérente, round-trip stable
  après chaque op) ; GUI (nav clavier, drag, retour article).

### V2b · Données : coller depuis Excel + alignement — *webview + modèle + print.css*
- [ ] **Coller un tableau** : sur `paste` (Ctrl+V) dans la grille, lire `clipboardData`
  (`text/html` → table, sinon `text/plain` → TSV lignes/onglets) et **construire le modèle**
  (remplacer la sélection ou insérer). Contenu inline réduit à `<strong>/<em>/<br>` (canonisé,
  jamais d'injection). Très utile : les rédacteurs préparent souvent le tableau dans Excel.
- [ ] **Alignement du texte** (D59) : gauche / centre / droite, par **cellule** et par
  **colonne** (via la sélection de colonne) ; contrôle dans la barre ou le menu contextuel ;
  `data-align` sur la cellule ; `print.css` applique `text-align`.
- **Vérif** : harnais (TSV « a\tb\nc\td » → 2×2 ; HTML `<table>` collé → modèle ; `data-align`
  round-trip) ; spike `print.css` alignement dans le PDF ; GUI collage Excel réel.

### V2c · Structure & confort — *webview*
- [ ] **Boutons « ＋ » au survol** entre lignes et entre colonnes (insertion rapide), en
  complément du menu contextuel (déjà là).
- [ ] **Glisser pour réordonner** lignes/colonnes (via les en-têtes A/B/C — 1/2/3) : opération
  de modèle « déplacer ligne/colonne » (nouvelle op pure + gate round-trip).
- [ ] **Info-bulles** (`title`) sur les contrôles de la barre (négatif vs fond, teintes, total…),
  localisées.
- **Vérif** : `node --check` ; harnais (op « déplacer » : round-trip + occupation cohérente
  avec fusions) ; GUI (survol ＋, réordonner, info-bulles).

### V2d · Rendu fidèle & sécurité + auto-layout — *webview + host + print.css*
- [ ] **Aperçu fidèle dans l'éditeur** : ombrage des en-têtes (gras/négatif/fond), zébrage,
  séparateurs, bordures, ligne de total et **accent (gris/couleur annuelle)** rendus dans la
  grille **comme le PDF** (mêmes teintes que `print.css`/`--szh-accent`). Vrai WYSIWYG → moins
  d'allers-retours de compilation.
- [ ] **En-tête figé (sticky)** au défilement de la grille (grands tableaux).
- [ ] **Garde « non-enregistré »** : indicateur ● quand le modèle diffère du fichier ;
  **confirmation** modale si on ferme/quitte avec des modifications non enregistrées (ou
  auto-enregistrement — au choix, documenté).
- [ ] **Confirmation de suppression** de ligne/colonne **si elle contient du texte**
  (sinon suppression directe).
- [ ] **Auto-layout (D58)** : `print.css` → `.szh-tableau { table-layout: auto; width: 100%; }`
  + retour à la ligne des cellules ; **vérifier qu'aucune largeur fixe** n'est produite/stockée ;
  le PDF distribue les colonnes automatiquement selon le contenu.
- **Vérif** : `node --check` ; **spike WeasyPrint** (auto-layout + alignement + aperçu fidèle
  cohérent avec le rendu) consigné ; GUI (sticky, garde non-enregistré, confirmation suppression).

## Risques

| # | Risque | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| **RV1** | Undo/redo incohérent avec l'état de la webview (sélection, édition en cours) | Moy | Moyen | Historique = états du **modèle** (pas du DOM) ; re-render complet après undo ; borne la pile |
| **RV2** | Collage Excel : HTML/TSV mal formé, cellules fusionnées du presse-papier | Moy | Moyen | Canoniser l'inline ; `colspan`/`rowspan` du HTML collé mappés au modèle ; fallback TSV ; jamais d'injection |
| **RV3** | Aperçu éditeur ≠ PDF (deux moteurs de style) | Moy | Faible | Réutiliser les mêmes teintes/variables que `print.css` ; « aperçu indicatif », le PDF reste la référence |
| **RV4** | Auto-layout : colonne à contenu long trop large / débordement | Faible | Moyen | `overflow-wrap: anywhere` + `hyphens` ; spike sur tableaux réels ; `width:100%` borne la largeur totale |
| **RV5** | « Déplacer ligne/colonne » avec fusions (rowspan/colspan traversants) | Moy | Moyen | Op pure sur la matrice d'occupation ; refuser/adapter si une fusion serait coupée ; gate round-trip |

## Points d'intégration
- `vscodium-extension/szh-cockpit/extension.js` (webview éditeur : script + HTML/CSS ; host :
  message « retour article », garde non-enregistré) **ou, après refactor, les fichiers webview
  externalisés** ; `TEXTES_COCKPIT`/`package.nls` (libellés + info-bulles).
- `pipeline/styles/print.css` (D58 auto-layout, D59 alignement, teintes de l'aperçu fidèle).
- `userdoc.md` (gestes de l'éditeur v2).
- **Ne pas toucher** : `szh-tabelle-inclure.lua`, `szh-apercu`, lot D34.

## À valider par Robin
- Garde « non-enregistré » : **confirmation à la fermeture** (retenu) vs auto-enregistrement.
- Alignement : par **cellule ET colonne** (retenu) ; alignement vertical (haut/milieu/bas) — utile ?
- Collage Excel : conserver les **fusions** du presse-papier (mieux) ou aplatir ?

## Note d'ordre (refactor d'abord — recommandé)
Ce lot touche massivement la webview de l'éditeur. Si le **refactor** (externalisation de la
webview en `media/table-editor.{html,css,js}` + découpage de `extension.js` en modules
CommonJS, sans build) est fait **avant**, V2 s'écrit dans de **vrais fichiers** (coloration,
lint, pas d'échappement de chaînes) et se relit bien plus facilement. Faire V2 d'abord =
écrire dans les gabarits-chaînes puis tout redéplacer. **Reco : refactor → V2.**
