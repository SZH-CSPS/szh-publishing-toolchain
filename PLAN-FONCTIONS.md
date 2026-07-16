# Plan — Nouvelles fonctionnalités du cockpit (lot unique pour Opus)

Spec auto-porteuse, à exécuter **tranche par tranche** par un agent (skill
`senior-software-engineer`), sur le modèle de `PLAN-GESTION.md` (G1–G5). Chaque
tranche = un commit `N<n>: …` avec preuves. Décisions **D42–D48**, tranches
**N1–N7**. Français partout.

Sept demandes de Robin (lettres a–h ; **c et e sont la même** → fusionnées) :

| Lettre | Fonction | Tranche | Taille | Où |
|---|---|---|---|---|
| a | WSL démarrée + maintenue en vie à l'ouverture | **N1** | S | extension |
| d | Titre de la vue = métadonnées du numéro, à la volée | **N2** | S | extension |
| c=e | Bouton « Tout exporter » (rebuild forcé) | **N3** | S | Makefile + tasks.json + extension |
| f | Supprimer le `media/media` en trop | **N4** | S–M | pipeline |
| b | Clic = aperçu direct (retrait des boutons 👁 et ▷) | **N5** | M | extension |
| h | Tableaux = fichiers HTML (lister/remplacer/ouvrir) | **N6** | L | pipeline + extension |
| g | Éditeur de métadonnées de tous les articles | **N7** | L | extension |

**Ordre d'exécution : N1 → N2 → N3 → N4 → N5 → N6 → N7.** Gains rapides et
isolés d'abord ; les deux gros risqués (h, g) en dernier, chacun ouvert par un
mini-spike de faisabilité. Si le lot doit s'arrêter, le maximum de valeur est déjà
en banque.

---

## État vérifié du code (reconnaissance faite le 2026-07-16)

- `import-docx.sh` utilise `pandoc … --extract-media=.` (ligne 29) avec un
  commentaire avertissant que `=media` doublerait en `media/media/`. **Donc soit le
  `media/media` observé vient d'un ancien toolkit, soit d'un comportement pandoc à
  confirmer** (N4 = spike + migration idempotente, couvre les deux cas).
- `filters/szh-tabelle-platzhalter.lua` **jette le contenu** du tableau (renvoie
  seulement `{{TABELLE NN}}` en gras) → aujourd'hui les tableaux sont **perdus** à
  l'import. N6 doit les **préserver** en HTML.
- Les articles importés **n'ont pas de frontmatter** (pandoc nu, sans `-s`). N7 doit
  donc **créer** le frontmatter s'il manque.
- La tâche de build (`vscodium-user/tasks.json`, label **`Aperçu / Export PDF`**) =
  `wsl.exe -d SZH-Publishing --cd ${workspaceFolder} -- make -f …/Makefile all`
  (incrémental). Distro = **`SZH-Publishing`**.
- Règle HTML du Makefile (l.65-76) : `cd articles/<slug>` puis `pandoc … --metadata-file=ausgabe.yaml --standalone --embed-resources --css=…` ; ligne 77 : « REMPLACER par le template final » (la présentation des métadonnées reste hors périmètre).
- Extension : `_itemsAssets(slug)` liste déjà les images de `media/` (récursif) ;
  `analyserAusgabe(contenu)` parse déjà les clés plates ; `ouvrirApercuPdf`,
  `lancerBuild`, `buildEnCours`, `fermerOngletsSous` réutilisables.

---

## Décisions (à recopier dans PLANIFICATION.md par Robin, avec le lot D34)

- **D42 (a)** — Le **maintien en vie de WSL** est piloté par l'extension : à
  l'ouverture d'une revue, elle lance un **processus dormant** dans la distro
  `SZH-Publishing` (`wsl.exe -d SZH-Publishing -- sh -c 'exec sleep infinity'`) qui
  empêche l'arrêt de la VM ; il est **tué** à la fermeture (deactivate) ou quand on
  quitte la revue. Pas de tâche planifiée supplémentaire, pas de `.wslconfig`
  (celui-ci appartient au lot D34, **ne pas y toucher**).

- **D43 (d)** — Le **titre de la vue** (`TreeView.title`) reflète le numéro, lu dans
  `ausgabe.yaml`, **rafraîchi à la volée** : `{Z|R}{AAAA}-{numero} | {title}` où
  `Z` si `lang: de`, sinon `R` ; `AAAA` = année extraite de `date` ; repli gracieux
  si une clé manque (voir N2). Le `name` package.json (« Revue SZH ») reste le
  libellé par défaut hors revue.

- **D44 (c=e)** — **« Tout exporter » = rebuild FORCÉ** de tous les articles (ignore
  les dates de fichier) : nouvelle cible Makefile `tout-exporter` (= `clean` puis
  `all`), nouvelle tâche `Tout exporter`, bouton en tête de vue. Distinct du build
  incrémental de `Ctrl+S`.

- **D45 (f)** — Les médias vivent à **un seul niveau** : `articles/<slug>/media/`.
  Normalisation dans `import-docx.sh` (nouveaux imports) **et** migration idempotente
  dans la cible `import` du Makefile (revues existantes) : si `media/media/` existe,
  fusionner vers `media/`, réécrire les liens `media/media/ → media/` dans le `.md`,
  supprimer le dossier en trop.

- **D46 (b)** — **Clic sur un article** = ouvre le `.md` (colonne 1) **+ compile s'il
  est obsolète** (`.md` plus récent que le PDF, ou PDF absent) **+ affiche l'aperçu**
  (colonne 2) **+ ferme l'aperçu de l'article précédent**. Les boutons inline **👁
  Ouvrir le PDF** et **▷ Compiler** sont **supprimés** (commandes + menus). L'extension
  **szh-apercu est conservée telle quelle** (rafraîchissement après `Ctrl+S`).

- **D47 (h)** — Chaque **tableau** devient **1 fichier HTML** dans
  `articles/<slug>/tables/` à l'import ; le `.md` garde une **référence** (bloc
  `::: {.szh-tabelle src="tables/table-NN.html"}`), résolue **à la compilation** par
  un filtre Lua qui ré-injecte le HTML. Les tableaux sont **listés comme des assets**
  sous l'article, avec **clic/Ouvrir** (édition directe du HTML) et **Remplacer**
  (par un fichier `.html` choisi). L'ancien placeholder `{{TABELLE}}` est **abandonné**
  comme mécanisme final. **Éditeur WYSIWYG = plus tard (hors lot).**

- **D48 (g)** — Les **métadonnées d'article** vivent dans le **frontmatter YAML** du
  `<slug>.md` (créé s'il manque). Champs : `title`, `subtitle`, `author` (**liste
  structurée** : `name`, `affiliation`, `orcid`), `doi`, `keywords` (liste). Un
  **formulaire webview** affiche tous les articles en tableau éditable ; « Enregistrer »
  réécrit le frontmatter de chaque article **modifié** en préservant le **corps** et
  les **clés inconnues**.

---

## Garde-fous (repris de PLAN-GESTION / PLAN-COCKPIT — non négociables)

- Extension : **JavaScript pur, zéro dépendance npm, API VS Code `^1.75`**, français
  (UI, commentaires, messages). Webview : **CSP stricte, tout inline**, thème via
  variables `--vscode-*` (clair **et** sombre), valeurs par `postMessage` (pas
  d'injection HTML), script à `nonce`, `localResourceRoots: []`.
- Sérialisation YAML (ausgabe.yaml **et** frontmatter) : **sérialiseur maison**,
  **préserver** les clés/commentaires/corps non gérés, échapper les valeurs, **écriture
  atomique** (tmp `~$…` + rename, préfixe ignoré par OneDrive).
- Pipeline : **aucun chemin `/mnt/c` codé en dur** dans le Makefile ; **TABULATIONS +
  LF** ; `import-docx.sh` reste POSIX/bash. Filtres Lua : compatibles avec la version
  de pandoc du rootfs (**vérifier `pandoc --version` au spike**).
- **Lecture seule sauf** ce que le plan autorise : écrire le frontmatter (N7), écrire
  `tables/*.html` (N6), aplatir `media/` (N4), supprimer/écraser sur **confirmation**.
- **Ne pas toucher** : `szh-apercu` (D46 la conserve), le `.wslconfig`/`update.ps1`/
  `PLANIFICATION.md` (**lot D34**, non commités — vérifier `git status` avant chaque
  commit, ne stager que les fichiers de la tranche).
- Outillage sans node/npm : `node --check` et harnais **via le runtime Node d'Electron**
  (`ELECTRON_RUN_AS_NODE=1 VSCodium.exe …`) ; écrire les résultats sur disque
  (`fs.appendFileSync`) + `process.exitCode` (jamais `process.exit()`). Après chaque
  tranche extension, **recopier** dans
  `%UserProfile%\.vscode-oss\extensions\szh-csps.szh-cockpit-0.1.0\`.
- Livraison : `update.ps1 --install-extension … --force` réinstalle dès que le sha256
  du manifest change → **pas besoin de bumper la version** (mais bump conseillé en fin
  de lot, hygiène).

---

## Tranches

### N1 · WSL démarrée + maintenue en vie (a) — *taille S ; extension ; indépendant*

- [x] Constante `DISTRO = 'SZH-Publishing'` (aligne `tasks.json` / `szh-common.ps1`).
- [x] `child_process.spawn` d'un dormant quand une revue est ouverte (dans
  `majContexte`, quand `racine` devient non nul) :
  `spawn('wsl.exe', ['-d', DISTRO, '--', 'sh', '-c', 'exec sleep infinity'], { windowsHide: true, stdio: 'ignore' })`.
  Repli du chemin : `wsl.exe` sur PATH, sinon `%WINDIR%\System32\wsl.exe`.
- [x] **Un seul** dormant à la fois : garder le handle ; ne pas en relancer si vivant ;
  le **tuer** (`proc.kill()`) quand `racine` redevient nul **et** dans `deactivate`
  et via `context.subscriptions.push({ dispose })`.
- [x] Robustesse : `proc.on('error', …)` avale l'échec (distro absente = poste non
  bootstrappé) sans notification bruyante ; aucun blocage de l'activation.
- **Vérif** : `node --check` OK ; harnais headless qui stub `child_process.spawn`,
  appelle le hook d'activation avec une racine simulée puis une racine nulle, et
  vérifie **1 spawn** avec les bons arguments **et 1 kill**. GUI (Robin) : ouvrir une
  revue, `wsl.exe -l --running` montre `SZH-Publishing` ; la 1ʳᵉ compilation est
  immédiate (pas de démarrage à froid).

### N2 · Titre de vue dynamique (d) — *taille S ; extension ; indépendant*

- [x] Fonction `titreNumero(racine)` : lit `ausgabe.yaml` via `analyserAusgabe`,
  construit `{Z|R}{AAAA}-{numero} | {title}` :
  - préfixe `Z` si `lang` commence par `de`, sinon `R` ;
  - `AAAA` = première séquence de 4 chiffres de `date` (ex. `2026` depuis `"2026"` ou
    `"2026-07-15"`) ; omise si absente ;
  - `-{numero}` omis si `numero` vide ; ` | {title}` omis si `title` vide ;
  - **repli** : si tout est vide → nom du dossier de la revue ; jamais de chaîne vide.
- [x] `vue.title = titreNumero(racine)` dans `majContexte`, et **rafraîchi à la volée**
  quand `ausgabe.yaml` change → ajouter `ausgabe.yaml` aux motifs surveillés
  (`reinstallerWatchers`) et rappeler la mise à jour du titre dans le debounce ; le
  formulaire N7/G1 qui enregistre `ausgabe.yaml` doit aussi déclencher le rafraîchissement.
- **Vérif** : harnais headless sur `titreNumero` avec ≥6 cas (complet ; `date` année
  seule ; sans `numero` ; sans `title` ; `lang: de` → `Z` ; tout vide → nom de dossier).
  GUI : modifier le numéro via ⚙, le titre de la vue se met à jour sans recharger.

### N3 · « Tout exporter » = rebuild forcé (c=e) — *taille S ; Makefile + tasks.json + extension*

- [x] `pipeline/Makefile` : cible `.PHONY: tout-exporter` qui force le rebuild complet
  — `$(MAKE) --no-print-directory -f $(THIS) clean` **puis**
  `$(MAKE) --no-print-directory -f $(THIS) all` (TABULATIONS, pas d'espaces).
- [x] `vscodium-user/tasks.json` : nouvelle tâche `type:process`, label **`Tout exporter`**,
  `command: wsl.exe`, args `-d SZH-Publishing --cd ${workspaceFolder} -- make -f /mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile tout-exporter`, `presentation.reveal: silent`.
- [x] Extension : commande `szh.toutExporter` + bouton en tête de vue (`view/title`,
  `$(export)`, après ⚙). Ferme les aperçus PDF ouverts **avant** (le `clean` supprime
  `out/` — un PDF verrouillé ferait échouer la suppression sous Windows), lance la
  tâche `Tout exporter` (mécanique `lancerBuild`/`onDidEndTaskProcess`), garde
  `buildEnCours`, notifie « N article(s) exporté(s) » (compte = nb d'articles) ou
  l'échec (« ouvrez le panneau Tout exporter »).
- **Vérif** : `make -n tout-exporter` (ou lecture) montre `clean` puis `all` ;
  `node --check`. GUI : bouton → tous les PDF regénérés même à jour, notification.

### N4 · Un seul dossier `media/` (f) — *taille S–M ; pipeline ; indépendant*

- [x] **Spike (obligatoire, à consigner)** : dans une revue de test, importer un `.docx`
  contenant une image et constater où atterrissent les médias (`media/` vs `media/media/`)
  avec le `import-docx.sh` actuel. Consigner le résultat dans le journal de tranche.
  **Consigné (2026-07-16, pandoc 3.5 rootfs)** : import frais → `media/rId20.png` à UN
  niveau, lien HTML `src="./media/rId20.png"` — le `media/media` observé vient des revues
  importées avec l'ANCIEN toolkit (bug `--extract-media=media` d'avant le correctif S1
  `f2febae`). La migration Makefile couvre ces revues ; la normalisation import-docx.sh
  est une ceinture (no-op aujourd'hui).
- [x] `import-docx.sh` : après pandoc, **normaliser** (idempotent) — si
  `media/media/` existe, `cp -r media/media/. media/`, `rm -rf media/media`, et
  `sed -i 's|media/media/|media/|g' "$SLUG.md"`. (No-op si déjà simple.)
- [x] `Makefile` cible `import`, dans la boucle de migration des articles existants :
  pour chaque `articles/<slug>/`, même normalisation idempotente (revues déjà importées
  avec l'ancien toolkit). **Ne perd aucune image** (copie puis suppression).
- **Vérif** : `bash -n import-docx.sh` ; test bash reproduisant un faux
  `media/media/x.png` + un `.md` liant `media/media/x.png` → après la cible, fichier en
  `media/x.png`, lien réécrit `media/x.png`, `media/media` disparu, **rejouable sans
  effet** (idempotence). GUI : une revue au `media/media` legacy est nettoyée au
  prochain `Ctrl+S`, le PDF reste correct.

### N5 · Clic = aperçu direct (b) — *taille M ; extension ; après N1 pour la réactivité*

- [ ] **Supprimer** les commandes `szh.ouvrirPdf` et `szh.compiler` (package.json
  `commands` + `menus view/item/context`) et leurs boutons inline. Conserver les
  fonctions internes utiles (`ouvrirApercuPdf`, `lancerBuild`) réutilisées ci-dessous.
- [ ] Nouveau handler de **clic d'article** (remplace le `command: vscode.open` de
  `_itemsArticles`) : commande `szh.ouvrirArticle(item)` qui, en séquence :
  1. ouvre `<slug>.md` en colonne 1 ;
  2. si `out/<slug>/<slug>.pdf` **absent** ou **plus ancien** que `<slug>.md`
     (comparer `fs.statSync(...).mtimeMs`) → lance le build (tâche `Aperçu / Export PDF`,
     incrémental — make ne recompilera que l'obsolète), sous garde `buildEnCours` ;
  3. **ferme l'aperçu PDF précédemment ouvert par le cockpit** (suivre l'URI courant
     dans une variable module ; fermer son onglet via `tabGroups` avant d'ouvrir le
     nouveau) ;
  4. ouvre l'aperçu du PDF en colonne 2 (`ouvrirApercuPdf`), met à jour l'URI courant.
- [ ] Robustesse : clics rapprochés ne doivent pas empiler les builds (garde
  `buildEnCours` + ignorer si déjà en cours) ; si la compilation échoue, ouvrir quand
  même le `.md`, message d'erreur, pas d'aperçu obsolète trompeur ; colonnes **fixes**
  (1 = md, 2 = PDF), jamais de 3ᵉ colonne.
- **Vérif** : `node --check` ; harnais headless (stub `vscode`) : clic sur article au
  PDF frais → **pas** de build, 1 aperçu ; clic sur article obsolète → 1 build puis
  aperçu ; clic sur un 2ᵉ article → l'onglet PDF du 1ᵉʳ est fermé, 1 seul aperçu ;
  clics rapprochés → 1 seul build. GUI (Robin) : cohabitation avec szh-apercu (Ctrl+S
  rafraîchit l'aperçu courant, pas de doublon), pas de scission en 3/4 colonnes.

### N6 · Tableaux gérés en fichiers HTML (h) — *taille L ; pipeline + extension ; après N4*

- [ ] **Spike (obligatoire)** : vérifier `pandoc --version` du rootfs et que
  `pandoc.write(pandoc.Pandoc({tbl}), 'html')` est disponible (≥ 2.17). Sinon, repli
  `pandoc.utils`/`pandoc.pipe`. Consigner.
- [ ] **Import** — nouveau filtre `filters/szh-tabelle-extraire.lua` (remplace
  `szh-tabelle-platzhalter.lua` dans `import-docx.sh`) : pour chaque `Table`,
  incrémente `NN`, écrit `tables/table-NN.html` (rendu HTML du tableau seul, `io.open`
  relatif au cwd = dossier article), et **remplace** le tableau par
  `pandoc.Div({}, pandoc.Attr('', {'szh-tabelle'}, {{'src', 'tables/table-'..NN..'.html'}}))`
  (sérialisé en `::: {.szh-tabelle src="tables/table-NN.html"} … :::`).
  `import-docx.sh` fait `mkdir -p tables` avant pandoc.
- [ ] **Compilation** — nouveau filtre `filters/szh-tabelle-inclure.lua` ajouté à la
  règle HTML du Makefile (`--lua-filter=$(PIPELINE_DIR)/filters/szh-tabelle-inclure.lua`) :
  handler `Div` avec classe `szh-tabelle` → lit le fichier `src` (relatif au cwd =
  dossier article), renvoie `pandoc.RawBlock('html', contenu)` ; fichier manquant →
  bloc d'avertissement visible (pas d'échec silencieux).
- [ ] **Dépendance de rebuild** — la règle `$(OUT)/%.html` gagne
  `$$(wildcard articles/$$(notdir $$*)/tables/*.html)` en prérequis (SECONDEXPANSION
  déjà activé) → éditer un tableau déclenche la recompilation.
- [ ] **Extension** — `_itemsAssets(slug)` (ou un nœud dédié) liste aussi
  `articles/<slug>/tables/*.html` : items `contextValue: 'table'`, clic = **ouvrir le
  .html** en colonne 1 (édition/copier-coller direct), bouton inline **« Remplacer »**
  (`szh.remplacerTable`) = `showOpenDialog` filtre `.html` → écrase en gardant le nom
  (confirmation modale) puis `rafraichirTout`. Icône `$(table)`.
- **Vérif** : `bash -n import-docx.sh` ; spike documenté ; test bout-en-bout dans une
  revue de test : un `.docx` à tableau → `tables/table-01.html` créé, `.md` contient
  le bloc `.szh-tabelle`, la compilation régénère un PDF **contenant le tableau** ;
  modifier `table-01.html` + Ctrl+S → PDF à jour ; `node --check` extension. GUI :
  tableau listé sous l'article, Ouvrir/Remplacer fonctionnent.

### N7 · Éditeur de métadonnées de tous les articles (g) — *taille L ; extension ; en dernier (risque n°1)*

- [ ] **Sérialiseur de frontmatter** (le point dur) — dans un module de fonctions
  pures testable :
  - `separerFrontmatter(texte)` → `{ avant, fm, corps }` : le frontmatter n'existe que
    si le fichier **commence** (ligne 1) par `---` ; il se termine à la 1ʳᵉ ligne
    `---` ou `...`. Sinon `fm = null`, tout est `corps`. Un `---` **dans le corps** ne
    doit jamais être pris pour une borne.
  - `analyserFrontmatter(fm)` → valeurs des clés gérées (`title`, `subtitle`, `doi`
    scalaires ; `author` = liste d'objets `{name, affiliation, orcid}` ; `keywords` =
    liste de chaînes) ; **best effort** sur l'existant.
  - `serialiserFrontmatter(fmExistant, corps, modifies)` → réécrit **uniquement** les
    clés gérées présentes dans `modifies` (scalaires cités ; `author` en séquence de
    mappings ; `keywords` en séquence), **préserve** les lignes de clés inconnues et le
    **corps verbatim**, ré-encadre par `---` ; crée le bloc s'il manque (préfixé au
    corps). BOM/CRLF/écriture atomique comme G1.
- [ ] **Commande + bouton** `szh.apercuMetadonnees` en tête de vue (`$(list-flat)` ou
  `$(preview)`), après ⚙.
- [ ] **Webview** (CSP stricte, thème) : une **carte par article** (slug en titre) avec
  champs `title`, `subtitle`, `doi` ; sous-liste **auteurs** répétable (ajouter /
  retirer, chaque auteur = `name`, `affiliation`, `orcid`) ; `keywords` (saisie type
  tags / séparés par virgule). Valeurs chargées par `postMessage` (l'hôte lit chaque
  `<slug>.md`). **Dirty-tracking par article** : « Enregistrer » ne réécrit que les
  articles modifiés.
- [ ] **Hôte** : à l'enregistrement, pour chaque article modifié, lit le `.md`,
  `serialiserFrontmatter`, écriture atomique ; renvoie un accusé au webview ; rafraîchit.
  Clé pandoc = `author` (liste), `keywords` (liste), `doi` (clé libre) — alimente
  Pandoc via le frontmatter (présentation = template final, hors périmètre).
- **Vérif (GATE)** : harnais headless **round-trip** (comme R1 de G1), ≥10 cas :
  article **sans** frontmatter → création propre ; frontmatter existant → mise à jour ;
  **corps contenant `---`** (règle horizontale) préservé ; clé inconnue préservée ;
  ajout/retrait d'auteur ; `keywords` liste ↔ relecture ; caractères spéciaux
  (deux-points, guillemets, accents) ; **idempotence** (g→parse→g stable). `node --check`.
  GUI : éditer 2 articles, n'écrire que les modifiés, rouvrir → valeurs relues, corps
  et clés inconnues intacts, le PDF se régénère.

---

## Risques & mitigations

| # | Risque | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| **R1** | **Frontmatter (g)** : listes imbriquées (auteurs), corps ou clés inconnues corrompus | Moy | Élevé | Frontmatter = bloc de tête seulement ; corps verbatim ; clés gérées régénérées ; **tests round-trip GATE** ; écriture atomique |
| **R2** | **Tableaux (h)** : extraction/ré-injection cassée, version pandoc | Moy | Élevé | **Spike pandoc** ; filtre `Div` robuste + bloc d'avertissement si fichier manquant ; dépendance Makefile pour le rebuild ; test bout-en-bout PDF |
| **R3** | **Clic = aperçu (b)** : recompilations/relayout à chaque clic | Moy | Moyen | Compiler **seulement si obsolète** (mtime) ; garde `buildEnCours` ; colonnes fixes ; fermer l'aperçu précédent |
| **R4** | **Keepalive WSL (a)** : dormant orphelin si crash | Faible | Faible | Handle unique, kill au deactivate/racine-nulle ; `sleep` bénin, nettoyé au `wsl --shutdown`/reboot |
| **R5** | **Migration media (f)** : perte d'image / lien cassé | Faible | Élevé | Idempotent, **copie puis** suppression, réécriture des liens, test bash |
| **R6** | **Tout exporter (D44)** : `clean` échoue si un PDF est ouvert (verrou Windows) | Moy | Moyen | Fermer les onglets d'aperçu avant ; `rm -rf` tolérant |
| **R7** | Cohabitation **b × szh-apercu** : deux gestionnaires d'aperçu | Faible | Faible | pdf.preview mono-instance (même URI = même onglet) ; « fermer précédent » côté cockpit uniquement ; vérif GUI |

---

## Points d'intégration (fichiers touchés)

- `vscodium-extension/szh-cockpit/extension.js` — N1, N2, N3(bouton), N5, N6(liste),
  N7. `package.json` — commandes/menus (retrait `ouvrirPdf`/`compiler` ; ajout
  `toutExporter`, `apercuMetadonnees`, `remplacerTable` ; nouveau clic `ouvrirArticle`).
- `pipeline/Makefile` — N3 (`tout-exporter`), N4 (migration media), N6 (filtre inclure
  + dépendance `tables/*.html`).
- `pipeline/import-docx.sh` — N4 (normalisation media), N6 (`mkdir tables`, filtre
  extraire).
- `pipeline/filters/` — N6 : `szh-tabelle-extraire.lua` (nouveau), `szh-tabelle-inclure.lua`
  (nouveau) ; `szh-tabelle-platzhalter.lua` retiré de l'usage (le garder dans l'attic
  ou le supprimer — au choix, documenter).
- `vscodium-user/tasks.json` — N3 (tâche `Tout exporter`).
- `userdoc.md`, `README.md` — documenter les nouveaux gestes en fin de lot.
- **Ne pas toucher** : `szh-apercu`, lot D34.

## Definition of Done (par tranche + lot)

- Critères d'acceptation de la tranche cochés, **preuve montrée** (commande + sortie).
- `node --check` sur l'extension ; harnais headless verts pour N1, N2, N4, N5, N7
  (round-trip GATE), spike consigné pour N4 et N6, test bout-en-bout PDF pour N6.
- Scénarios GUI rédigés pour Robin (regroupés en fin de lot) — l'IHM VSCodium /
  WSL / pandoc réels ne sont pas testables en headless.
- `git status` avant chaque commit : **aucun fichier du lot D34** stagé ; un commit
  `N<n>: …` par tranche ; cases cochées dans ce fichier.
- Fin de lot : bump conseillé `package.json` version (hygiène) + correction de la
  description « (lecture seule) » devenue fausse.

## Défauts assumés (modifiables avant lancement)

- **d** : format `R2026-2 | Titre` (préfixe R/Z, année depuis `date`, `numero` **non**
  re-formaté, séparateur ` | `). Repli = nom de dossier.
- **g** : clés pandoc `author`/`keywords`/`doi`/`subtitle`/`title` dans le frontmatter
  de l'article (le `title` d'article **prime** sur celui d'`ausgabe.yaml` côté pandoc).
- **h** : tableaux dans `articles/<slug>/tables/table-NN.html` ; référence
  `::: {.szh-tabelle src="…"}`. « Éditer » (WYSIWYG) **hors lot**.
- **a** : keepalive actif **seulement dans une revue ouverte** (pas dans une fenêtre
  VSCodium quelconque).

## Questions ouvertes

- Aucune bloquante. Les 4 décisions pivots ont été tranchées (auteurs structurés ;
  h = lister/remplacer/ouvrir ; b = tout au clic ; Tout exporter = forcé).
