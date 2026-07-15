# PLAN — Import simplifié + extension « szh-cockpit »

> Spec d'implémentation auto-porteuse. Décisions D35–D36 actées le 2026-07-15 (Robin Morand).
> Conçue pour être exécutée tranche par tranche par un agent/développeur **sans autre contexte
> que ce fichier et le dépôt**. Cocher les cases au fur et à mesure ; toute déviation se consigne ici.
> Conventions du dépôt à respecter impérativement : voir « Garde-fous » en fin de fichier.

---

## 1. Résumé

Deux chantiers liés :

1. **Import docx simplifié** : remplacer la chaîne d'import actuelle (D27–D30 : heuristiques Lua,
   AnyStyle, citations liées, rapports) par une conversion Pandoc nue + un filtre unique qui
   remplace chaque tableau par un placeholder `{{TABELLE XY}}`. Les heuristiques reviendront
   plus tard (les fichiers restent dans le dépôt, débranchés).
2. **Extension VSCodium « szh-cockpit »** : barre latérale « Revue » (liste des articles, Word en
   attente) + commande « Importer des Word » guidée (sélecteur de fichiers → conversion →
   notification). Livrée par le canal existant (CI → VSIX → vsix.lock → update.ps1).

## 2. Périmètre

**Objectif** : un rédacteur gère sa revue (voir les articles, importer un Word, ouvrir le PDF)
depuis une barre latérale, sans explorateur de fichiers ni terminal, et sans jamais se demander
« où en est la conversion ».

**Critères de succès (observables)**
- Depuis un dossier de revue vierge : bouton Importer → choisir 2 `.docx` → les articles
  apparaissent dans la barre latérale et compilent en PDF, sans toucher à l'explorateur.
- Un `.docx` contenant 3 tableaux produit un `.md` contenant exactement `{{TABELLE 01}}`,
  `{{TABELLE 02}}`, `{{TABELLE 03}}` aux positions des tableaux, et aucun élément `Table`.
- Les 6 articles réels de 2026-01 se convertissent sans erreur avec le nouvel import.
- `update.ps1` installe le VSIX cockpit sur un poste pilote sans intervention admin.

**Hors périmètre (explicitement)**
- Rapports de conversion (D30) et diagnostics VS Code — **plus tard**.
- Heuristiques d'import D27 (titres gras, listes manuelles, figures), AnyStyle/.bib (D28),
  liaison citations (D29) — **débranchés, pas supprimés**.
- Gestion des tableaux (HTML ou autre) — **plus tard** ; le placeholder est un rappel manuel.
- Palette de styles `:::` visuelle et formulaire de métadonnées — phases ultérieures (§7).
- `.odt` : l'import simplifié n'accepte **que `.docx`** (un seul chemin, demande explicite).

**Contraintes et hypothèses**
- Aucun ajout au rootfs (pandoc suffit). AnyStyle/Ruby restent dans l'image pour l'instant
  (retrait = optimisation ultérieure, nécessiterait un rebuild rootfs).
- Extension : JavaScript pur, zéro dépendance npm, API VS Code ^1.75 — même posture que szh-apercu.
- ~~Hypothèse à valider en S1~~ **Validée (2026-07-15), avec correctif** : `--extract-media=media`
  doublait le dossier (`media/media/…`, pandoc crée lui-même un sous-dossier `media`) →
  remplacé par `--extract-media=.` : fichiers dans `media/`, chemins `./media/…` corrects.

**Journal S1 (gate du 2026-07-15)** — S1 implémentée (commit `86964cd`), revue et validée :
placeholders 01…12 OK (0 tableau = intact, padding OK), non-écrasement OK (`make import` →
« déjà converti »), slug avec accents OK. Déviations acceptées : 4ᵉ arg `lang` retiré de
l'appel `import-docx.sh` (mort depuis D35) ; commentaires Makefile mis à jour ; flags writer
`-…-grid_tables` conservés verbatim. Correctifs post-commit : `--extract-media=.` (ci-dessus)
et réparation du fichier `import-docx.sh` sur disque (≈1 Ko d'octets NUL ajoutés en fin après
le commit — artefact d'écriture ; contenu committé intact, restauré depuis HEAD).
Restent à vérifier sur poste réel (pandoc/WeasyPrint du rootfs) : les 6 articles 2026-01 et la
compilation PDF — commande : déposer les docx dans `articles-word/` puis Ctrl+S.

## 3. Approche technique

**Options considérées**
- *A. Étendre szh-apercu en un seul plugin* : un seul VSIX, mais on re-risque une extension
  éprouvée à chaque itération cockpit.
- *B. Nouvelle extension `szh-cockpit`, szh-apercu inchangée* ✅ : isolation des risques, CI
  identique (2ᵉ VSIX, même job), fusion possible plus tard.
- *C. Webview complète (mini-app)* : plus joli, mais 10× le code et l'entretien — écarté (V1).

**ADR-D35 (import)** : contexte — la chaîne D27–D30 est puissante mais lourde à faire évoluer
pendant qu'on construit l'UX ; décision — `make import` appelle une conversion pandoc nue +
filtre placeholder tableaux ; conséquences — plus de `.bib` généré (citeproc dans la règle html
reste conditionnel : il ne se déclenche simplement plus), références = texte brut, D33 suspendue
(plus aucun tableau ne traverse l'import), retour arrière = re-brancher `import-docx.sh` (git).

**Points d'intégration** : `pipeline/Makefile` (cible `import`), `pipeline/filters/` (nouveau
filtre), tâches user existantes (`tasks.json` : labels de build/import réutilisés par l'extension),
`release.yml` + `windows/vsix.lock` (2ᵉ VSIX), `update.ps1` (aucun changement : il lit vsix.lock).

## 4. Découpage — tranches verticales, dans l'ordre

### S1 — Pipeline : import simplifié `{{TABELLE XY}}` *(taille S ; fondation)*
- [x] Nouveau `pipeline/filters/szh-tabelle-platzhalter.lua` : remplace chaque `Table` par
      `pandoc.Para{pandoc.Strong{pandoc.Str("{{TABELLE NN}}")}}`, numérotation séquentielle
      par document, zéro-paddée à 2 chiffres.
- [x] `pipeline/import-docx.sh` réécrit (~15 lignes) : `cd articles/<slug> && pandoc <docx>
      --from=docx --to=markdown-simple_tables-multiline_tables-grid_tables --track-changes=accept
      --extract-media=media --lua-filter=<pipeline>/filters/szh-tabelle-platzhalter.lua
      --wrap=none -o <slug>.md`. Plus d'appel aux filtres D27–D29, AnyStyle ni `rapport.py`.
- [x] Makefile : cible `import` conservée telle quelle (migration structure, slug, non-écrasement,
      `_convertis/`) sauf le message « + rapport … » retiré ; ne prendre que `*.docx` (retirer `*.odt`).
- [x] `szh-import.lua`, `szh-citations.lua`, `rapport.py` : déplacés dans `pipeline/attic/`
      avec un README d'une ligne (« débranchés par D35, réactivables »).
- **Acceptation** : docx de test à 3 tableaux → `.md` avec les 3 placeholders dans l'ordre, images
  extraites dans `media/`, compilation PDF OK ; les 6 articles 2026-01 convertissent sans erreur ;
  un article existant n'est jamais écrasé (re-dépôt du même docx → « déjà converti »).

### S2 — Extension : squelette + barre latérale lecture seule *(taille M)*
- [x] `vscodium-extension/szh-cockpit/` : `package.json` (publisher `szh-csps`, engines ^1.75,
      `onStartupFinished`), `extension.js`, LICENSE, README — calqués sur szh-apercu.
- [x] `viewsContainers.activitybar` « Revue SZH » (icône SVG sobre) + TreeView à 2 sections :
      **Articles** (scan `articles/*/<slug>.md` ; clic = ouvrir le .md) et **Word en attente**
      (`articles-word/*.docx`, hors `_convertis/`) avec badge de compte sur l'icône.
- [x] Activation seulement si `ausgabe.yaml` existe à la racine du workspace (sinon vue masquée —
      `"when"` contexte). FileSystemWatcher sur `articles/**` et `articles-word/*` → refresh.
- **Acceptation** : ouvrir la revue 2026-01 → les articles listés, tri alphabétique ; déposer un
  docx à la main → il apparaît sous « Word en attente » ≤ 2 s ; dossier non-revue → pas d'icône.

**Journal S2 (gate du 2026-07-15)** — S2 implémentée (commit `61abe86`), revue et validée
(code lecture seule, cas limites couverts, syntaxe/JSON vérifiés). Déviations acceptées :
bouton Rafraîchir (couvert par la table des risques) et items « Aucun … pour l'instant ».
**Correctif de plan S2.1** : la flotte masque la barre d'activité
(`workbench.activityBar.location: "hidden"`, UI « 0 technique ») → la vue est déplacée dans
le conteneur **Explorateur** (`views.explorer`, nom « Revue SZH ») ; `viewsContainers` et
l'icône de conteneur retirés. Conséquence : le badge TreeView n'est plus visible (il
s'affichait sur l'icône de conteneur) — le retour visuel « Word en attente » reste assuré
par la section elle-même ; à réévaluer en S4. Le plan (§4 S2, 2ᵉ puce) est amendé en ce sens.
Nit pour S3 : watchers réinstallés accumulés dans `context.subscriptions` (double-dispose
inoffensif) — à nettoyer en S3. Lectures périmées du montage (« troncatures ») élucidées :
artefact de cache côté session distante, fichiers réels sains — vérifier `git diff --stat`
avant chaque commit reste la règle.

### S3 — Import guidé de bout en bout *(taille S ; dépend S1+S2)*
- [x] Commande `szh.importerWord` (bouton en tête de vue) : `showOpenDialog` (multi, filtre
      `.docx`) → copie dans `articles-word/` → exécute la tâche user existante d'import
      (`vscode.tasks.fetchTasks` par label, même mécanique que szh-apercu écoute les tâches)
      → à la fin : refresh + `showInformationMessage` « N article(s) importé(s) » (compte tiré
      du diff de la liste, pas du parsing de sortie).
- [x] Si le `.md` cible existe déjà : l'item « Word en attente » porte un tooltip « déjà converti —
      renommez le fichier si c'est une nouvelle version ».
- **Acceptation** : depuis la barre latérale uniquement — importer 2 docx, voir la notification,
  les articles apparaître, et `articles-word/` ne contenir que `_convertis/`.

### S4 — Actions d'article *(taille S ; dépend S2)*
- [ ] Items article : boutons inline « Ouvrir le PDF » (`out/<slug>/<slug>.pdf` via `pdf.preview`,
      colonne Beside — réutiliser le code szh-apercu) et « Compiler » (tâche build existante).
      PDF absent → l'action lance la compilation d'abord (même tâche, message discret).
- **Acceptation** : clic PDF sur article compilé → aperçu à droite ; sur article jamais compilé →
  build puis aperçu ; jamais de vol de focus de l'éditeur.

### S5 — Livraison flotte *(taille S ; dépend S2–S4)*
- [ ] `release.yml` : packager `szh-cockpit` comme szh-apercu (vsce/ovsx package) ; entrée dans
      `windows/vsix.lock` (id, version, sha256) ; VSIX en asset de release.
- [ ] `userdoc.md` : section « La barre Revue » (3 captures max) ; README : arborescence + tableau
      raccourcis mis à jour ; PLANIFICATION.md : cocher D35/D36.
- **Acceptation (bout en bout, poste pilote)** : tag de release → le poste se met à jour seul →
  scénario complet « revue vierge → 2 docx importés → 2 PDF ouverts » réalisé par un tiers
  non technicien, chrono < 5 min, zéro question posée.

## 5. Definition of Done (chaque tranche)
- Testé sur la revue réelle 2026-01 (pas seulement sur fixture) ; S1 : les 6 articles.
- Aucun nouveau binaire dans le rootfs ; aucune dépendance npm ; PS 5.1 propre.
- Docs à jour (README/PLANIFICATION/userdoc quand la tranche les touche).
- Commit par tranche, message `S<n>: …` ; cases cochées ici (= suivi de progression).
- Vérification de bout en bout de la tranche démontrée (pas « ça devrait marcher »).

## 6. Risques
| Risque | Prob. | Impact | Mitigation |
|---|---|---|---|
| Chemins `--extract-media` incorrects dans le .md (S1) | M | M | Valider en premier ; repli : `sed` existant du Makefile |
| Watcher TreeView peu fiable sur OneDrive | M | F | Refresh aussi après chaque tâche + bouton refresh manuel |
| Détection fin de tâche d'import fragile (S3) | F | M | Même API `onDidEndTaskProcess` que szh-apercu (éprouvée) |
| Régression pour les revues déjà convties (bib existants) | F | M | `import` ne touche jamais un `.md` existant (inchangé) ; citeproc conditionnel conservé |
| Placeholders oubliés dans le PDF final | M | M | Rendu en **gras** + (plus tard) compteur dans la barre latérale ; à terme, retour des rapports |

## 7. Plus tard (hors plan, mémo)
Rapports + diagnostics cliquables ; gestion des tableaux (HTML ou autre — remplacera les
placeholders) ; palette visuelle des styles `:::` ; formulaire métadonnées `ausgabe.yaml` ;
retrait AnyStyle/Ruby du rootfs ; fusion cockpit+apercu.

## 8. Garde-fous pour l'implémentation (rappels du dépôt)
- Makefile : **tabulations**, LF, aucun `/mnt/c` en dur, quotes simples pour `~$…`.
- PowerShell : compatible **5.1** — proscrire `?.`, `??`, `?:`, `&&`/`||`.
- Ne jamais exclure `out/` de `files.watcherExclude` (D21) ; `.md` existants jamais écrasés (D12).
- Extensions : épinglées + sha256 dans `vsix.lock` (D11) ; zéro dépendance (posture szh-apercu).
- Toute décision nouvelle → ligne D<n> dans PLANIFICATION.md.
