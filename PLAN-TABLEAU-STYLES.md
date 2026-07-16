# Plan — Refonte des styles de l'éditeur de tableau (+ markup accessible AX1)

Spec autoporteuse (skill `senior-software-engineer`), 2 tranches verticales
démontrables. Français partout. **Fusionne** la refonte demandée par Robin avec
**AX1** (markup accessible, ex-PLAN-ACCESSIBILITE-IMPORT.md) car même fichiers.
AX2/AX3/AX4 (import Word + PDF/UA) restent un lot ultérieur.

Fichiers : modèle `lib/table-model.js` ; webview `media/table-editor.{html,js,css}` ;
rendu `pipeline/styles/print.css` (+ `couleurs.css`) ; i18n `lib/i18n.js` ; hôte
`extension.js` (handlers). Ne PAS toucher : lot D34, `Feature.docx`, szh-apercu,
la palette markdown Ctrl+Alt+S (sans rapport). NB : le « remplissage par cellule »
concerné est celui de **l'éditeur de tableau**, pas la palette markdown.

## Décisions
- **D64 — Styles au NIVEAU tableau** (attributs `data-*` sur `<table>`), remplaçant le
  remplissage par cellule. Absents ⇒ tableau nu (rétrocompatible avec les tableaux existants).
- **D65 — Ligne de total = dernière ligne (auto)**, stylée seulement si un style total est actif.
- **D66 — Remplissage structuré uniquement.** On RETIRE de l'éditeur de tableau le remplissage
  par cellule (fond/négatif/couleur). On CONSERVE par cellule le formatage **texte** : gras,
  italique, souligné, alignement.
- **D67 — Mappage des remplissages** (contrastes WCAG déjà garantis par `couleurs.css`) :
  - **Négatif** = fond `--szh-accent-fonce` + texte **blanc** (≥4.5:1).
  - **Couleur annuelle** = fond `--szh-accent-clair` + texte **noir** (≥4.5:1).
  - **Gris** = fond gris clair neutre + texte **noir** (≥4.5:1) — indépendant de la couleur annuelle.
  - **Aucun** = pas de remplissage.
- **D68 (AX1) — Markup accessible** : tableau simple (≤1 ligne ET ≤1 colonne d'en-tête) → `scope` ;
  tableau complexe (2 lignes OU 2 colonnes d'en-tête, ou en-tête fusionné) → `<thead>/<tbody>` +
  `id` sur en-têtes + `headers="…"` sur les cellules + `scope="colgroup/rowgroup"` si fusion.
  Dérivé du modèle → régénéré → round-trip stable.

## Modèle d'attributs (déterministe, sur `<table class="szh-tableau">`)
- Existants : `data-entete-lignes`, `data-entete-colonnes`.
- En-têtes / total (fond ∈ `aucun|negatif|couleur|gris`) :
  `data-el-gras`, `data-el-fond` (en-têtes de **lignes** = `th[scope=row]`) ;
  `data-ec-gras`, `data-ec-fond` (en-têtes de **colonnes** = `th[scope=col]`) ;
  `data-total-gras`, `data-total-fond` (total ; `data-total-fond=aucun` **et** pas de gras ⇒ pas de total).
- Tableau : `data-bordure-haute`, `data-bordure-basse` (0/1) ;
  `data-zebre-col` (`aucun|paires|impaires`), `data-zebre-col-entetes` (0/1) ;
  `data-zebre-lig` (`aucun|paires|impaires`), `data-zebre-lig-entetes` (0/1).
- **Valeurs booléennes** émises seulement si vraies ; enums émis seulement si ≠ défaut → sortie
  minimale, round-trip stable. `analyserTable` lit ces attributs dans `attrs`, `serialiserTable`
  les réémet ; défauts = tableau nu.

## Formulaire webview — 3 zones (remplace la barre de style par cellule)
- **# Preset** — radios `Modèle 1 / 2 / 3 / 4`, **désactivés** (placeholder, « à implémenter »).
- **# Styles des en-têtes** — 3 sous-blocs (En-têtes de lignes / En-têtes de colonnes / Ligne de
  total), chacun : case **Gras** + radio **Aucun / Négatif / Couleur annuelle / Gris**.
- **# Styles du tableau** — cases **Bordure haute** / **Bordure basse** ; **Zébrage colonnes**
  (radio Aucun/Paires/Impaires + case « inclure les en-têtes ») ; **Zébrage lignes** (idem).
- Tout changement → `postMessage` → l'hôte met à jour le modèle (`.meta`/table) → **aperçu live**.
- **Menu contextuel** : ajouter **« Définir comme en-tête »** et **« Retirer l'en-tête »** (avec
  le `sens` déduit de la sélection, cf. F3) ; **supprimer les boutons** correspondants de la barre.

## Rendu (print.css + CSS éditeur, aperçu fidèle)
- En-têtes : `.szh-tableau[data-el-fond=negatif] th[scope=row] {…}` etc. (fonds D67, gras via `data-*-gras`).
- Total : `.szh-tableau[data-total-fond=…] tbody tr:last-child > * {…}`.
- Bordures : `data-bordure-haute` → filet haut du tableau ; `data-bordure-basse` → filet bas.
- Zébrage : `data-zebre-lig=paires` → `tbody tr:nth-child(even)` (impaires = odd) ; idem colonnes via
  `td:nth-child` ; `…-entetes` étend/n'étend pas aux rangées/colonnes d'en-tête.
- Ajouter à `couleurs.css` une variable **gris** éditable (`--szh-gris-clair` + texte noir ≥4.5:1)
  et une teinte **zébrage** neutre (`--szh-zebre`), documentées.
- L'aperçu de l'éditeur (webview) doit refléter les mêmes styles (réutiliser/synchroniser les règles).

## Tranches (verticales, démontrables)

### T1 · Modèle + rendu + accessibilité — *table-model.js, print.css, couleurs.css, CSS éditeur ; headless + spike*
- [ ] `analyser/serialiserTable` : lire/écrire tous les `data-*` ci-dessus (défauts = nu) ; AX1 (D68).
- [ ] print.css + CSS éditeur : rendre fonds/total/bordures/zébrage ; vars gris/zébrage dans couleurs.css.
- **Démontrable** : un `<table>` forgé avec ces attributs rend correctement (fonds, total dernière
  ligne, bordures, zébrage col/lig ± en-têtes) ET porte le markup accessible attendu.
- **Gate (headless via `_pur`)** : round-trip `analyser∘serialiser∘analyser` **stable** avec les
  nouveaux attributs (idempotent, sortie minimale) ; tableau 2 lignes d'en-tête → `<thead>` + `id` +
  `headers` corrects ; tableau simple → `scope`. + spike WeasyPrint : un PDF compile sans régression.

### T2 · Formulaire webview + menu contextuel + i18n — *table-editor.{html,js}, i18n.js, extension.js ; headless i18n + GUI*
- [ ] Les 3 zones (Preset désactivé / Styles en-têtes / Styles tableau) câblées au modèle + aperçu live.
- [ ] Retirer le remplissage **par cellule** (fond/négatif/couleur) de l'éditeur ; conserver gras/
  italique/souligné/alignement par cellule.
- [ ] Déplacer « Définir/Retirer l'en-tête » en menu contextuel ; supprimer les boutons.
- [ ] i18n : nouveaux libellés **fr = de** (Preset, Modèle N, En-têtes de lignes/colonnes, Ligne de
  total, Gras, Aucun/Négatif/Couleur annuelle/Gris, Bordure haute/basse, Zébrage colonnes/lignes,
  Paires/Impaires, inclure les en-têtes).
- **Démontrable (GUI)** : cocher/choisir dans les zones change le tableau en direct ; En-têtes via
  clic droit ; plus de bouton de remplissage par cellule ; formatage texte par cellule intact.
- **Gate** : `node --check` (extension.js + lib) ; parité i18n fr=de **verte** ; round-trip **vert** ;
  scénarios GUI listés.

## Garde-fous
- Round-trip tableau PRÉSERVÉ ; attributs déterministes ; tableaux existants (sans `data-*`) inchangés.
- CSP stricte, DOM only, zéro dépendance, sans build. `git status` avant chaque commit ; un commit/tranche.
- Recopie du **dossier complet** de l'extension (extension.js + lib/ + media/) dans la copie dev ;
  re-sync `pipeline/` → toolkit pour print.css/couleurs.css.
- Aperçu HTML (A1/A2/A3), overlay F7, couleurs F5 : **ne pas régresser**.

## À valider par Robin (après coup)
- Défauts des zones (ex. en-têtes → Couleur annuelle + gras cochés par défaut ? ou tout Aucun ?).
- Teinte exacte du **gris** et du **zébrage** (ajustables dans `couleurs.css`).
- Zébrage colonnes ET lignes simultané autorisé (inhabituel visuellement) — laissé possible.
