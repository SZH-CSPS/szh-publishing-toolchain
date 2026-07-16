# Plan — Corrections du lot N1–N7 (lot unique pour Opus)

Corrections décidées après tests de Robin. À exécuter **tranche par tranche**
(skill `senior-software-engineer`), un commit `M<n>: …` par tranche. **Ce plan
SUPERSEDE deux points de `PLAN-FONCTIONS.md`** : le stockage frontmatter de N7
(→ fichier caché `.meta.yaml`) et l'extraction Lua des tableaux de N6
(→ extracteur Python fidèle). Lire d'abord `PLAN-FONCTIONS.md` (N6, N7) puis ce
fichier. Décisions **D49–D54**, tranches **M1–M5**. Français partout.

## Contexte (vérifié le 2026-07-16)

- **Le toolkit déployé (`C:\ProgramData\SZH\toolkit\pipeline\`) est très ancien**
  (`--extract-media=media` → c'est la source du `media/media` ; filtres
  `szh-import.lua`/`szh-citations.lua` ; Makefile sans N3/N6). Les tests d'import
  de Robin ont donc tourné sur l'ANCIEN pipeline : « tableaux en `.md` natif » et
  `media/media` ne sont **pas** des bugs de N4/N6 — ces tranches ne sont simplement
  **pas déployées**. ⚠ **Les tranches pipeline (N4, N6, M2, et D35/D39) ne sont
  testables qu'après mise à jour du toolkit** (release, ou sync manuel de `pipeline/`
  → toolkit pour test). Les tranches extension (dont M1) sont testables via la copie
  dev.
- Environnement rootfs confirmé : **Python 3.13, pandoc 3.5**.
- Décisions de Robin : métadonnées en **fichier caché** ; tableaux via **Python**
  (fusions préservées) ; langues traductibles **FR + DE**, **IT activable à la
  demande** (~1 article/an), **pas d'EN**.

## Décisions

- **D49 (supersede D48)** — Les métadonnées d'article vivent dans un fichier
  **`articles/<slug>/<slug>.meta.yaml`**, **masqué** (`files.exclude`), **édité
  UNIQUEMENT par le formulaire** N7. Le `.md` ne contient **que le texte** (plus de
  frontmatter). Lu par Pandoc à la compilation via `--metadata-file` (en plus
  d'`ausgabe.yaml`, l'article surchargeant le numéro). Fichier « form-owned » :
  régénéré à chaque enregistrement (clés inconnues préservées par prudence) →
  **dissout le risque R1** (plus de corps d'article à préserver).

- **D50 (supersede l'extraction N6)** — Les tableaux Word sont extraits par un
  **script Python** `pipeline/docx-tables.py` (stdlib `zipfile`+`xml`, zéro nouvelle
  dépendance) qui lit `word/document.xml` et rend chaque `<w:tbl>` en HTML **en
  préservant les fusions** (`w:gridSpan` → `colspan`, `w:vMerge` → `rowspan`). Le
  placement de la **référence** `::: {.szh-tabelle src="tables/table-NN.html"}` dans
  le `.md` reste fait par un filtre Lua (ordre du document) ; le filtre d'**inclusion**
  à la compilation (`szh-tabelle-inclure.lua`) est **conservé tel quel**. Corrige
  l'aplatissement des cellules par pandoc (D33).

- **D51** — Schéma unifié des métadonnées d'article (`<slug>.meta.yaml`) :
  ```yaml
  type: article              # jeton canonique ; libellé TRADUIT selon lang d'ausgabe.yaml
  doi: "10.xxxx/yyyy"
  title:    { fr: "…", de: "…" }        # map langue→texte ; it ajouté à la demande
  subtitle: { fr: "…", de: "…" }
  keywords: { fr: ["…","…"], de: ["…"] }# map langue→liste
  author:
    - prenom: "…"
      nom: "…"
      fonction: "…"
      affiliation: "…"
      orcid: "…"
  ```
  `type` ∈ { `varia`, `documentation`, `article`, `interview`, `tribune-libre`,
  `editorial` }. Langues traductibles : **fr + de** affichées par défaut, **it**
  activable par article ; **pas d'en**. Exemple `01-exemple` mis à ce schéma.

- **D52 (b)** — Un **menu de réglages « SZH »** (bouton en tête de vue + commande)
  ouvre un formulaire (webview) qui écrit les réglages **au niveau utilisateur** via
  l'API `workspace.getConfiguration().update(…, ConfigurationTarget.Global)` (jamais
  d'édition manuelle de `settings.json`) :
  - **Thème** : Système / Clair / Sombre — **uniquement** *Default Light Modern* /
    *Default Dark Modern* (thèmes intégrés). Système = `window.autoDetectColorScheme:true`
    + `workbench.preferredLightColorTheme`/`preferredDarkColorTheme` ; Clair/Sombre =
    `autoDetectColorScheme:false` + `workbench.colorTheme`.
  - **Taille de police de l'interface** : `window.zoomLevel` (paliers).
  - **Taille de police des `.md` (affichage seulement)** :
    `"[markdown]": { "editor.fontSize": N }` — ne modifie **pas** le contenu.
  - **Langue de l'interface FR/DE** : pilote les **chaînes du cockpit** (nouvelle
    couche i18n de l'extension). La langue **native complète de VSCodium** nécessite le
    **pack DE déployé** (`vsix.lock` + release) + `locale` dans `argv.json` + redémarrage
    → dépendance déploiement notée. **N'influence aucun YAML.**

- **D53 (a) — Aperçu commutable HTML↔PDF** — Un **bascule global** (élément de barre
  d'état + bouton en tête de vue, + bandeau en tête de l'aperçu HTML) fait passer **tous
  les aperçus** entre deux modes, **persistant** (`szh.apercuMode`, **défaut : html**) :
  - **HTML** (défaut) : la colonne 2 affiche `out/<slug>/<slug>.html` dans une **webview
    maison** — **survol = surligner l'élément**, **clic = `revealRange`** sur la ligne
    source du `.md` (colonne 1).
  - **PDF** : la colonne 2 affiche le PDF (`tomoki1207.pdf`), **sans clic**.
  La **position source** est portée dans le HTML par pandoc (spike M5 : `commonmark_x+sourcepos`
  unifié si le PDF reste identique, sinon rendu preview séparé) ; l'attribut de position est
  **ignoré par WeasyPrint** → **le PDF reste inchangé** (on reste sur WeasyPrint, aucun
  Chromium — cf. revue comparative WeasyPrint vs Paged.js).

- **D54 — `szh-apercu` conscient du mode** — La colonne 2 n'a **qu'un seul** gestionnaire à
  la fois. `szh-apercu` est **conservé** mais **modifié a minima** : il n'ouvre/rafraîchit le
  PDF après compilation **qu'en mode `pdf`**, en lisant le réglage **partagé** `szh.apercuMode`
  (`workspace.getConfiguration('szh')`). En mode `html`, il ne fait rien (le cockpit possède la
  colonne 2 avec la webview HTML). Pas de refonte de szh-apercu — juste cette garde.

## Garde-fous (en plus de ceux de PLAN-FONCTIONS §Garde-fous)

- `docx-tables.py` : **Python 3 stdlib uniquement** (`zipfile`, `xml.etree`), aucun
  `pip install` ; robuste (docx sans tableau → n'écrit rien, ne plante pas) ;
  déterministe (ordre du document).
- `<slug>.meta.yaml` : sérialiseur maison (comme ausgabe.yaml), valeurs **échappées/
  citées**, écriture **atomique** (`~$…` + rename), UTF-8. Préserver les clés
  inconnues de haut niveau.
- **Ne pas toucher** : le lot D34 ; `szh-tabelle-inclure.lua`. (`szh-apercu` : **touche minimale
  autorisée** en M5/D54 — garde de mode uniquement, pas de refonte.) `git status` avant chaque commit.

## Tranches

### M1 · Métadonnées en fichier caché `.meta.yaml` (D49, D51) — *taille L ; extension + Makefile + settings.json*

- [ ] **Sérialiseur `.meta.yaml`** (fonctions pures, exportées via `_pur`) :
  - `analyserMeta(texte)` → `{ type, doi, title:{}, subtitle:{}, keywords:{}, author:[{prenom,nom,fonction,affiliation,orcid}] }` (best effort ; maps par langue ; listes).
  - `serialiserMeta(valeurs)` → YAML (régénère le fichier ; ordre D51 ; clés inconnues de haut niveau restituées ; valeurs vides omises ; langues sans contenu omises ; auteur entièrement vide ignoré).
- [ ] **Makefile** — règle HTML : ajouter `--metadata-file="$$slug.meta.yaml"` **si le
  fichier existe** (après `ausgabe.yaml`, pour que l'article surcharge le numéro) et
  ajouter `$$(wildcard articles/$$(notdir $$*)/$$(notdir $$*).meta.yaml)` aux prérequis
  (éditer les métadonnées déclenche la recompilation). TABULATIONS + LF.
- [ ] **settings.json** — `files.exclude` += `"**/*.meta.yaml": true` (masqué à l'explorateur).
- [ ] **Webview « Métadonnées des articles »** (remplace le stockage frontmatter de N7 ;
  garder la structure carte/article, CSP stricte, DOM, dirty par article) :
  - `type` : menu déroulant `<select>` ; options = les 6 types ; **libellés traduits**
    selon la langue de la revue (table i18n fournie par l'hôte) ; valeur canonique stockée.
  - **Auteurs** : 5 champs par ligne — Prénom, Nom, Fonction, Affiliation, ORCID —
    répétables (ajouter/retirer).
  - **Titre / sous-titre / mots-clés traductibles** : champs **FR** et **DE** toujours
    visibles ; case **« + Italien »** par carte qui révèle les champs IT. Mots-clés
    saisis séparés par des virgules, par langue.
- [ ] **Hôte** : lit `articles/<slug>/<slug>.meta.yaml` (plus le frontmatter) ; à
  l'enregistrement, `serialiserMeta` + écriture atomique par article modifié ;
  transmet au webview la **langue de la revue** (pour les libellés de `type`) ;
  valide le slug contre la liste réelle.
- [ ] **N5 (obsolescence)** : inclure `<slug>.meta.yaml` dans le calcul mtime (comme
  `tables/*.html`) — modifier les métadonnées rend le PDF obsolète.
- [ ] **Migration défensive (idempotente)** : si un `<slug>.md` porte encore un
  frontmatter avec des clés gérées (issu de N7 non déployé), le déplacer vers
  `<slug>.meta.yaml` puis retirer le frontmatter du `.md`. Sans objet si rien n'existe.
- [ ] **Table i18n des types** (à VALIDER par Robin pour DE/IT) :
  `article`→{fr:Article, de:Artikel, it:Articolo} ; `varia`→{Varia,Varia,Varia} ;
  `documentation`→{Documentation, Dokumentation, Documentazione} ;
  `interview`→{Interview, Interview, Intervista} ;
  `tribune-libre`→{Tribune libre, Freie Tribüne, Tribuna libera} ;
  `editorial`→{Éditorial, Editorial, Editoriale}.
- **Vérif (GATE)** : harnais headless round-trip `.meta.yaml` (≥10 cas) : création ;
  `type` jeton relu ; auteur 5 champs ; `title`/`subtitle` maps fr/de/it ; `keywords`
  maps ↔ listes ; clé inconnue préservée ; caractères spéciaux ; langue sans contenu
  omise ; auteur vide ignoré ; **idempotence**. `node --check`. GUI : éditer 2
  articles, n'écrire que les ● ; le `.meta.yaml` n'apparaît pas dans l'explorateur ;
  rouvrir → valeurs relues.

### M2 · Extracteur Python de tableaux, fusions préservées (D50) — *taille L ; pipeline ; après N6*

- [ ] **`pipeline/docx-tables.py`** : `python3 docx-tables.py <docx> <outdir>` — pour
  chaque `<w:tbl>` (ordre du document) écrit `<outdir>/table-NN.html` (NN sur 2
  chiffres) :
  - `<table>`/`<tr>`/`<td>` ; **`colspan`** depuis `w:gridSpan` ; **`rowspan`** depuis
    `w:vMerge` (`restart` = début, absence de valeur/`continue` = cellule fusionnée à
    ne pas ré-émettre) ;
  - contenu de cellule : paragraphes → `<br>`, **gras** `w:b`→`<strong>`, *italique*
    `w:i`→`<em>` ; texte échappé HTML. (Formatage riche au-delà = extensible plus tard.)
  - aucun tableau → n'écrit rien, sort 0.
- [ ] **Filtre Lua `szh-tabelle-reference.lua`** (remplace `szh-tabelle-extraire.lua`,
  déplacé en `attic/`) : `Table` → incrémente NN, renvoie la référence
  `::: {.szh-tabelle src="tables/table-NN.html"}`, **n'écrit aucun fichier**.
- [ ] **`import-docx.sh`** : `mkdir -p tables` ; lancer
  `python3 "$PIPE/docx-tables.py" "$DOCX_ABS" tables` **puis** pandoc avec le filtre
  `szh-tabelle-reference.lua` ; `rmdir tables` si vide ; conserver la normalisation
  media (N4).
- [ ] **`szh-tabelle-inclure.lua`** (compilation) : **inchangé** (lit `src`, `RawBlock`,
  bloc ⚠ visible si fichier manquant).
- **Vérif (SPIKE obligatoire, consigné)** : dans une revue de test (toolkit synchronisé),
  importer un `.docx` avec un tableau à **cellules fusionnées** →
  `tables/table-01.html` contient `colspan`/`rowspan` ; **le nombre de références dans
  le `.md` = le nombre de fichiers `table-*.html`** (alignement de numérotation) ;
  compiler → **le PDF affiche le tableau fusionné** (pas un ⚠, pas de cellules
  aplaties). `python3 -m py_compile docx-tables.py`.

### M3 · Uniformisation de l'exemple + docs (D51) — *taille S ; template + docs*

- [ ] `revue-template/articles/01-exemple/01-exemple.md` : **retirer le frontmatter**
  (ne garder que le corps).
- [ ] Créer `revue-template/articles/01-exemple/01-exemple.meta.yaml` au schéma D51
  (fr + de remplis, it absent, un auteur d'exemple, un `type`).
- [ ] `userdoc.md` / `README.md` : documenter le formulaire « Métadonnées des articles »
  (champs traductibles FR/DE + IT à la demande, `type` traduit), le fichier `.meta.yaml`
  masqué (édition par formulaire seulement), et la fidélité des tableaux (fusions).
  Ajuster `BIENVENUE.md` s'il évoque l'édition directe des métadonnées.
- **Vérif** : l'exemple se compile (une fois le toolkit synchronisé) ; relecture docs.

### M4 · Menu de réglages « SZH » : thème, polices, langue (D52) — *taille L ; extension*

- [ ] Commande `szh.reglages` + bouton en tête de vue (`$(settings-gear)`), après
  « Métadonnées des articles ».
- [ ] **Webview « Réglages SZH »** (CSP stricte, DOM, thème) — valeurs initiales lues
  des réglages actuels (postMessage) :
  - **Thème** : radio Système / Clair / Sombre.
  - **Police de l'interface** : paliers (ex. Normal / Grand / Très grand → `window.zoomLevel` 0 / 1 / 2).
  - **Police des `.md`** : paliers (ex. 14 / 16 / 18 px).
  - **Langue** : FR / DE.
- [ ] Écriture via `getConfiguration().update(clé, valeur, vscode.ConfigurationTarget.Global)` :
  `window.autoDetectColorScheme`, `workbench.colorTheme`,
  `workbench.preferredLightColorTheme` = `"Default Light Modern"`,
  `workbench.preferredDarkColorTheme` = `"Default Dark Modern"`, `window.zoomLevel`,
  et `editor.fontSize` **scopé** `[markdown]` (via `update` avec `overrideInLanguage`
  ou en écrivant l'objet `[markdown]`).
- [ ] **Couche i18n du cockpit** : helper `T(clé[, args])` + tables `fr`/`de` couvrant
  **toutes** les chaînes visibles (titres de commandes `package.json` via `%clé%` +
  `package.nls.json`/`package.nls.de.json`, messages, modales, libellés des webviews).
  Langue = réglage `szh.langue` si défini, sinon `vscode.env.language` (`de`→de, sinon fr).
  **Traductions DE à valider par Robin.**
- [ ] **Langue native VSCodium** : écrire `locale` (`fr`/`de`) dans
  `%APPDATA%\VSCodium\argv.json` + `showInformationMessage` invitant au redémarrage.
  **Dépendance déploiement** (à consigner, hors commit ici) : ajouter
  `MS-CEINTL.vscode-language-pack-de` à `windows/vsix.lock` + release, sinon les menus
  natifs restent en anglais (les chaînes SZH, elles, suivent déjà `szh.langue`).
- **Vérif** : `node --check` ; harnais i18n (aucune clé manquante entre `fr` et `de` ;
  `T` rend la bonne langue + repli). GUI : thème appliqué immédiatement ; zoom + police
  `.md` visibles ; bascule FR/DE des chaînes du cockpit ; invite au redémarrage pour la
  langue native.

### M5 · Bascule d'aperçu HTML↔PDF, HTML cliquable par défaut (D53, D54) — *taille L ; pipeline + extension ; en dernier*

- [ ] **Spike sourcepos (court, consigné)** : `--from=commonmark_x+sourcepos` garde-t-il le
  rendu PDF **identique** (surtout blocs `:::` et snippets) ? Si oui → build unifié avec
  positions ; sinon → **rendu preview séparé** en `commonmark_x+sourcepos` (le build PDF reste
  en `markdown`). Décider et consigner.
- [ ] **Pipeline** : la sortie HTML servant à l'aperçu porte une **position source par bloc**
  (`data-pos`/`data-line`). Vérifier que le **PDF WeasyPrint est inchangé** (attribut ignoré).
- [ ] **Webview d'aperçu HTML** (colonne 2) : charge `out/<slug>/<slug>.html` (déjà autonome —
  CSS/images en base64) ; CSP stricte (`img-src data:`, `style-src 'unsafe-inline'`,
  `script-src 'nonce-…'`) + script injecté à nonce ; **survol → contour** de l'élément ;
  **clic → `postMessage(ligne)`** → l'hôte fait `revealRange` dans le `.md` (colonne 1) ;
  **rechargement** quand `out/<slug>/*.html` change (watcher).
- [ ] **Bascule globale** : commande `szh.basculerApercu` + **élément de barre d'état**
  « Aperçu : HTML ⇄ PDF » + bouton en tête de vue (+ bonus : bouton dans le bandeau de la
  webview HTML) ; état **persistant** `szh.apercuMode` (défaut `html`) ; clé de contexte pour l'icône.
- [ ] **Intégration au clic (N5)** : le clic d'article ouvre l'aperçu **du mode courant** ;
  **basculer** échange l'aperçu de l'article courant (ferme l'un, ouvre l'autre) ; colonnes
  fixes (1 = texte, 2 = aperçu), jamais de 3ᵉ colonne.
- [ ] **`szh-apercu` conscient du mode** (D54) : il ne doit ouvrir/rafraîchir le PDF **qu'en
  mode `pdf`** — lit le réglage partagé `szh.apercuMode` et ne fait rien en mode `html`. Touche
  minimale, szh-apercu reste déployé (packaging CI inchangé).
- **Vérif** : `node --check` ; harnais (la bascule persiste le mode ; le clic ouvre le bon
  type ; mapping clic→ligne sur un HTML de test porteur de `data-pos`). Spike consigné. GUI :
  défaut = aperçu HTML cliquable ; toggle → PDF ; `Ctrl+S` rafraîchit dans les deux modes ;
  jamais deux aperçus concurrents ; pas de 3ᵉ colonne.

## Risques

| # | Risque | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| **RM1** | Sérialiseur `.meta.yaml` (maps + listes + auteurs) : round-trip instable | Moy | Moyen | Fichier form-owned régénéré ; **GATE round-trip** ; écriture atomique |
| **RM2** | Numérotation Lua (référence) ≠ Python (fichiers) → tableau mal associé | Moy | Élevé | Ordre du document des deux côtés ; **spike vérifie l'égalité des comptes** ; `inclure` affiche ⚠ visible si `src` manquant (jamais de perte silencieuse) |
| **RM3** | `docx-tables.py` : `vMerge`/`gridSpan` mal interprétés (tableaux complexes) | Moy | Moyen | Spike sur un vrai docx fusionné ; portée = fusions + gras/italique/paragraphes ; reste extensible |
| **RM4** | Non déployé → non testable | Certain | — | Sync `pipeline/` → toolkit pour test, ou release ; **documenté** |
| **RM5** | M4 langue : i18n incomplet / pack DE non déployé → menus natifs en anglais | Moy | Moyen | Couche i18n couvre les chaînes SZH ; défaut = `vscode.env.language` ; pack DE = dépendance déploiement notée |
| **RM6** | M5 : précision du mapping clic→source / changer le reader casse le rendu PDF | Moy | Moyen | Spike ; `commonmark_x+sourcepos` **seulement si PDF identique**, sinon rendu preview séparé ; `data-*` ignoré par WeasyPrint ; précision au **bloc** (suffisant pour naviguer) |
| **RM7** | Deux gestionnaires d'aperçu (cockpit vs szh-apercu) → aperçu en **double** en colonne 2 | Moy | Moyen | **D54** : retrait de szh-apercu (ou mode-aware) → **propriétaire unique** |

## Points d'intégration

- `vscodium-extension/szh-cockpit/extension.js` (M1 : sérialiseur meta + webview + hôte + N5), `package.json` (inchangé côté commandes).
- `vscodium-user/settings.json` (M1 : `files.exclude`).
- `pipeline/Makefile` (M1 : `--metadata-file` + prérequis meta.yaml).
- `pipeline/docx-tables.py` (M2, nouveau), `pipeline/filters/szh-tabelle-reference.lua` (M2, remplace extraire → attic), `pipeline/import-docx.sh` (M2).
- `revue-template/articles/01-exemple/` (M3), `userdoc.md`/`README.md`/`BIENVENUE.md` (M3).
- `extension.js` + `package.json` + `package.nls*.json` (M4 : réglages + i18n), `settings.json`/`argv.json` écrits à l'exécution (M4).
- `extension.js` + `package.json` (M5 : webview HTML cliquable + bascule + barre d'état + réglage `szh.apercuMode`) ; `pipeline/` (position source dans le HTML) ; `szh-apercu/extension.js` (garde de mode, D54).
- **Ne pas toucher** : `szh-tabelle-inclure.lua`, lot D34. (`szh-apercu` : garde de mode seulement, pas de refonte.)

## À valider par Robin (n'empêche pas de démarrer)

- Libellés **DE/IT** des 6 types d'article (table i18n M1).
- Clés d'auteur en français (`prenom`/`nom`/`fonction`/`affiliation`/`orcid`) — retenu ;
  bascule possible vers `given`/`family` (CSL) si des citations d'articles sont prévues.
- **Traduction DE de toutes les chaînes du cockpit** (M4 i18n).
- Résultat du **spike sourcepos** (M5) : reader unifié `commonmark_x+sourcepos` si le PDF
  reste identique, sinon rendu preview séparé.
