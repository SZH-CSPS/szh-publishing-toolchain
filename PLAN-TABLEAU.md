# Plan — Éditeur de tableau maison (webview) — spec pour Opus

Spec autoporteuse (skill `senior-software-engineer`), à exécuter **tranche par
tranche** (T1 → T2 → T3), un commit `T<n>: …` par tranche. Français partout.
**Solution A retenue** (revue WeasyPrint vs Paged.js, échange précédent) : éditeur
**maison, JS pur, zéro dépendance**, dans une **webview** — pas de bibliothèque tierce,
pas de programme externe.

## Contexte & dépendances (déjà en place)

- Les tableaux sont des **fichiers HTML** `articles/<slug>/tables/table-NN.html`
  (un `<table>` par fichier, fusions `colspan`/`rowspan` préservées — M2/D50), listés
  comme assets sous l'article, avec **« Remplacer »** (choisir un `.html`) et le clic =
  ouverture du HTML (M6/N6). L'inclusion à la compilation se fait par
  `filters/szh-tabelle-inclure.lua` (**ne pas toucher**).
- `ausgabe.yaml` porte une **`couleur`** de numéro (hex, M7/D56), aujourd'hui **stockée
  mais pas encore consommée** par la maquette (« étape template ultérieure »). **T3 la
  consomme** enfin, comme **couleur d'accent** des tableaux.
- Extension `szh-cockpit` : webviews CSP stricte + DOM (patrons M1/M4/M5), écriture
  atomique YAML/fichiers, i18n `T()`/`package.nls` fr/de, copie de fichier (G5).

## Décision

- **D57 — Éditeur de tableau WYSIWYG maison** — Un bouton **« Éditer »** sur l'asset
  tableau ouvre une **webview** qui rend `table-NN.html` en **grille éditable** et le
  réécrit (écriture atomique). Le style est encodé en **classes + attributs `data-*`**
  sur `<table>`/`<th>`/`<tr>` (HTML lisible, round-trip sûr), **rendu par `print.css`**.
  **Couleur d'accent = « gris » (neutre fixe) OU « couleur annuelle »** (`ausgabe.yaml`,
  exposée en variable CSS `--szh-accent` à la compilation). Aucune dépendance externe.

## Modèle de données (encodage HTML — le cœur du round-trip)

Le fichier reste un `<table>` autonome. **Structure** : fusions via `colspan`/`rowspan` ;
en-têtes via `<th>` (sinon `<td>`) ; contenu de cellule = inline simple (`texte`,
`<strong>`, `<em>`, `<br>`). **Style** encodé ainsi (noms indicatifs, à figer par
l'implémenteur mais à documenter) :

```html
<table class="szh-tableau"
  data-entete-lignes="1"          <!-- 0 | 1 | 2  : lignes d'en-tête en haut -->
  data-entete-colonnes="0"        <!-- 0 | 1 | 2  : colonnes d'en-tête à gauche -->
  data-entete-ligne-style="fond"  <!-- gras | negatif | fond | normal (en-tête de LIGNE) -->
  data-entete-colonne-style="gras"<!-- gras | negatif | fond | normal (en-tête de COLONNE) -->
  data-zebre="lignes"             <!-- lignes | colonnes | non -->
  data-zebre-teinte="gris"        <!-- gris | couleur -->
  data-separateurs="gris"         <!-- gris | couleur | non  (filets entre lignes) -->
  data-bordure-haute="oui"        <!-- filet épais sous la zone d'en-tête -->
  data-bordure-basse="oui">       <!-- filet épais sous la dernière ligne -->
  <tr><th scope="col">…</th> …</tr>
  <tr><th scope="row">…</th><td colspan="2">…</td> …</tr>
  …
  <tr class="szh-total" data-teinte="couleur" data-gras="oui">…</tr> <!-- ligne de total -->
</table>
```

- **Teinte** : `gris` = gris neutre fixe (défini dans `print.css`) ; `couleur` =
  `var(--szh-accent)` (la couleur annuelle). Les en-têtes `negatif`/`fond` utilisent
  l'accent ; `negatif` = fond accent **foncé** + texte clair, `fond` = fond accent
  **clair** + texte normal, `gras` = gras sans fond, `normal` = rien.
- **Robustesse round-trip** : l'analyseur doit **préserver** un `<table>` qui n'a pas
  ces attributs (import M2) → l'ouvrir en mode « neutre » sans rien casser ; réécrire un
  HTML **propre et stable** (analyser → sérialiser → analyser = identique).

## Fonctionnalités

**Base (nécessaire à tout éditeur — inclus) :** éditer le **texte** des cellules
(contenteditable ; gras/italique intra-cellule) ; **ajouter/supprimer** une ligne / une
colonne ; **sélection** de cellules (clic, Maj+clic = plage rectangulaire ; clic sur la
poignée de ligne/colonne = ligne/colonne entière).

**Demandées :**
1. **Fusionner** une plage rectangulaire sélectionnée → une cellule (`colspan`/`rowspan`) ;
   **Scinder** une cellule fusionnée (inverse).
2. Série de réglages (barre d'outils) :
   - **2a** « Définir comme en-tête » — selon la sélection : **ligne(s)** en haut → en-têtes
     de ligne, ou **colonne(s)** à gauche → en-têtes de colonne. **1 ou 2** lignes / colonnes
     (en-tête à deux niveaux). Cellules d'en-tête = `<th>` + `scope`.
   - **2b** Style d'**en-tête de colonne** : **gras / négatif / fond de couleur / normal**.
   - **2c** Style d'**en-tête de ligne** : idem.
   - **2d** **Zébrage** lignes **ou** colonnes : teinte **couleur** ou **gris**.
   - **2e** **Bordure haute** : filet épais **sous la zone d'en-tête** (ligne ou colonne).
   - **2f** **Bordure basse** : filet épais sous la **dernière ligne**.
   - **2g** **Séparateurs de lignes** : filets entre lignes, **gris** ou **couleur**.
   - **2h** **Ligne de total** (la sélection désigne la ligne) : **fond couleur / gris**,
     **gras**, et **combinaisons** (gras+gris, gras+couleur).
- **Accent du tableau** : sélecteur **gris | couleur annuelle** (quand une teinte
  « couleur » est demandée, c'est la couleur annuelle d'`ausgabe.yaml`).

Chaque réglage = un bouton/segment de la barre d'outils, **localisé FR/DE**, avec un
**aperçu live** dans la grille (les styles de `print.css` sont approximés dans la webview
via des variables de thème + `--szh-accent` transmis du hôte). **« Enregistrer »** réécrit
`table-NN.html` (atomique) ; **recompiler** montre le rendu final (WeasyPrint).

## Tranches

### T1 · Éditeur de base + fusion/scission (round-trip) — *taille L ; extension*

- [ ] Bouton **« Éditer »** (`szh.editerTable`, icône `$(edit)`) sur l'asset `viewItem == table`
  (à côté de « Remplacer ») ; ouvre une **webview** en colonne 1 (ou active), titre = nom du fichier.
- [ ] **Parseur/sérialiseur HTML de tableau** (fonctions pures, exportées `_pur`) :
  `analyserTable(html)` → modèle `{ lignes:[[{contenu, colspan, rowspan, th, scope}]], attrs:{…} }`
  (tolère un `<table>` nu de M2) ; `serialiserTable(modele)` → `<table>…</table>` propre.
  **GATE : round-trip** analyser→sérialiser→analyser identique, sur un tableau nu M2 **et**
  un tableau stylé (≥10 cas dont fusions colspan/rowspan, cellule vide, inline `<strong>`/`<em>`/`<br>`).
- [ ] **Grille éditable** (webview, DOM, CSP) : cellules `contenteditable` (texte + gras/italique
  Ctrl+B/I intra-cellule → `<strong>`/`<em>`) ; **sélection** (clic, Maj+clic = plage rectangulaire,
  poignées ligne/colonne) ; **ajouter/supprimer ligne/colonne**.
- [ ] **Fusion** (plage rectangulaire contiguë → `colspan`/`rowspan`, contenus concaténés) et
  **Scission** (rétablit la grille). Gérer proprement l'occupation de grille (cellules absorbées).
- **Vérif** : `node --check` ; harnais round-trip (GATE) ; scénario GUI (fusion/scission, édition,
  add/del) décrit pour Robin. Aucune régression sur « Remplacer » / l'inclusion à la compilation.

### T2 · En-têtes + styles (encodage) — *taille L ; extension*

- [ ] **2a** « Définir comme en-tête » : selon la sélection, marque 1–2 lignes (haut) OU 1–2
  colonnes (gauche) comme en-têtes → `<th scope>` + `data-entete-lignes/colonnes`.
- [ ] **2b/2c** Style d'en-tête ligne/colonne : `gras | negatif | fond | normal`
  (`data-entete-ligne-style` / `data-entete-colonne-style`).
- [ ] **2d** Zébrage : `data-zebre` (lignes|colonnes|non) + `data-zebre-teinte` (gris|couleur).
- [ ] **2e/2f** Bordure haute / basse : `data-bordure-haute` / `data-bordure-basse` (oui/non).
- [ ] **2g** Séparateurs de lignes : `data-separateurs` (gris|couleur|non).
- [ ] **2h** Ligne de total : `<tr class="szh-total" data-teinte="gris|couleur" data-gras="oui|non">`
  (combinaisons gras±teinte).
- [ ] **Accent du tableau** : sélecteur gris | couleur annuelle (le hôte transmet la couleur
  d'`ausgabe.yaml` à la webview pour l'aperçu).
- [ ] Barre d'outils **localisée FR/DE** (clés `table.*` dans `TEXTES_COCKPIT` + `package.nls` si
  besoin) ; **aperçu live** dans la grille.
- **Vérif** : `node --check` ; harnais (chaque réglage → attribut/classe attendu, et round-trip stable
  après application) ; GUI décrit.

### T3 · Maquette `print.css` + couleur d'accent — *taille M ; pipeline*

- [ ] **`--szh-accent`** exposé à la compilation depuis `ausgabe.yaml` (`couleur`) : la règle HTML
  du Makefile injecte `:root { --szh-accent: <hex>; }` (ex. via `--include-in-header` d'un petit
  fichier généré, ou un filtre Lua `Meta`) avec **repli gris** si `couleur` absente. **Le PDF sans
  couleur reste identique** ; n'affecte que les tableaux qui utilisent la teinte « couleur ».
- [ ] **Règles `print.css`** pour `.szh-tableau[...]` : en-têtes (gras/negatif/fond/normal, `scope`),
  zébrage (nth-child, teinte gris|`var(--szh-accent)`), séparateurs, bordure haute/basse, ligne de
  total (`.szh-total`), teintes gris (neutre fixe) vs couleur (`var(--szh-accent, <gris>)`). Contraste
  lisible en négatif (texte clair sur fond foncé).
- [ ] **Spike WeasyPrint (consigné)** : compiler un article avec un tableau stylé couvrant tous les
  réglages → vérifier le rendu PDF (fusions + en-têtes + zébrage + bordures + total + accent). Ajuster
  la CSS au besoin.
- **Vérif** : spike PDF consigné ; `make -n` OK ; TABULATIONS/LF du Makefile préservés.

## Garde-fous

- Extension : **JS pur, zéro dépendance npm**, API `^1.75` ; webview **CSP stricte + DOM**
  (aucune injection HTML, valeurs par `postMessage`, nonce) ; **écriture atomique** de
  `table-NN.html` (tmp `~$…` + rename). i18n via `TEXTES_COCKPIT`/`package.nls`.
- Pipeline : Makefile **TABULATIONS + LF**, aucun `/mnt/c` codé en dur ; **ne pas toucher**
  `szh-tabelle-inclure.lua`.
- **Ne pas toucher** : le lot D34 ; `szh-apercu`. `git status` avant chaque commit (ne stager que
  les fichiers de la tranche ; ne jamais committer D34 ni `Feature.docx`).
- Outillage headless via Electron (`ELECTRON_RUN_AS_NODE`), fonctions pures via `_pur`, résultats
  sur disque + `process.exitCode`. Recopie dev après chaque tranche extension.

## Risques

| # | Risque | Prob. | Impact | Mitigation |
|---|---|---|---|---|
| **RT1** | Fusion/scission : occupation de grille incohérente (colspan+rowspan qui se chevauchent) | Moy | Élevé | Modèle de grille explicite (matrice d'occupation) ; **GATE round-trip** ; refuser une sélection non rectangulaire |
| **RT2** | Round-trip HTML instable (attributs perdus / réordonnés) | Moy | Moyen | Sérialiseur déterministe ; préserver un `<table>` nu M2 ; tests ≥10 cas |
| **RT3** | Sélection multi-cellules dans un contenteditable (UX délicate) | Moy | Moyen | Sélection maison (clic/Maj+clic + poignées), pas la sélection navigateur ; désactiver l'édition pendant la sélection de plage |
| **RT4** | `--szh-accent` mal injecté → couleur absente ou PDF modifié sans couleur | Faible | Moyen | Repli gris ; n'agit que sur teinte « couleur » ; spike PDF |
| **RT5** | WeasyPrint ne rend pas un style CSS utilisé | Faible | Moyen | Spike T3 sur la vraie `print.css` ; s'en tenir à des propriétés supportées (nth-child, border, background, color) |

## Points d'intégration

- `vscodium-extension/szh-cockpit/extension.js` (T1/T2 : parseur/sérialiseur `_pur`, webview éditeur,
  commande `szh.editerTable`) + `package.json` (commande + item `view/item/context` `viewItem == table`)
  + `package.nls*.json` / `TEXTES_COCKPIT` (libellés).
- `pipeline/Makefile` + `pipeline/styles/print.css` (T3 : `--szh-accent` + règles `.szh-tableau`).
- `userdoc.md` / `README.md` (gestes de l'éditeur).
- **Ne pas toucher** : `szh-tabelle-inclure.lua`, `szh-apercu`, lot D34.

## À valider par Robin (n'empêche pas de démarrer)

- **Noms d'attributs** `data-*` (indicatifs ci-dessus) et **classes** — à figer/documenter.
- **Nuances de gris** et **variantes clair/foncé** de la couleur annuelle (negatif vs fond) — un
  premier jet CSS sera proposé (contraste à valider).
- Faut-il **conserver l'édition du HTML brut** (clic actuel) en plus de « Éditer » WYSIWYG ? (défaut
  proposé : oui, « Éditer » devient le geste principal, l'ouverture brute reste pour dépannage.)
- Le **total** : la sélection d'une ligne suffit-elle, ou faut-il aussi une colonne de total ?
  (défaut : ligne uniquement, comme demandé.)
