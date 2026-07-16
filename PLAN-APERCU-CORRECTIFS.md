# Plan — Correctifs aperçu HTML (suite A1/A2), retours de Robin

Petit lot (skill `senior-software-engineer`), 2 points. **À lancer APRÈS l'agent
« refonte tableau » (touche `extension.js`)** pour éviter les collisions + pouvoir
BUILDER un article de démo avec tableau et inspecter le DOM réel. Français partout.
Fichiers : `media/apercu.js` (webview aperçu), `extension.js` (hôte : listener
`onDidChangeTextEditorVisibleRanges`, `revelerPos`/`revelerLigneSource`), et pour G1
peut-être `pipeline/filters/szh-tabelle-inclure.lua` + build aperçu (szh-apercu).

## G1 — Clic sur un mot cassé après un tableau inclus
- **Cause (à confirmer sur build).** `szh-tabelle-inclure.lua:30` remplace le `Div`
  positionné (`.szh-tabelle`, qui a un `data-pos`) par un `pandoc.RawBlock('html')`
  **sans `data-pos`**. Dans l'aperçu compilé, le tableau inclus n'a donc aucune position ;
  `e.target.closest('[data-pos]')` (apercu.js) ne résout plus correctement le tableau NI,
  semble-t-il, les blocs qui le suivent → le clic ne déplace plus le curseur.
- **Étape 1 (grounding).** BUILDER un article de démo contenant un tableau inclus
  (`make` sur l'article) et inspecter `*.apercu.html` : le tableau a-t-il un `data-pos` ?
  les `<p>` suivants sont-ils imbriqués dans le `<table>` (mauvais nesting HTML) ? leurs
  `data-pos` sont-ils monotones/corrects ?
- **Fix (selon constat).** Option A (préférée) : **donner un `data-pos` au tableau inclus** —
  propager la position du `Div` d'origine (`div.attr`/ligne source) sur un `Div` enrobant
  le `RawBlock`, ou émettre un attribut de position, pour que le tableau participe à la
  structure des blocs comme les autres. Option B (repli, côté webview) : rendre la
  résolution robuste — si `closest('[data-pos]')` échoue ou tombe sur le tableau, viser le
  bloc positionné **le plus proche dans l'ordre du DOM** (frère précédent/suivant), et ne
  jamais « perdre » les blocs après un tableau. Ne PAS régresser le clic→mot hors tableau.
- **Gate.** Sur le build de démo : cliquer un mot AVANT, DANS (repli propre) et APRÈS le
  tableau → le curseur va au bon endroit dans le `.md`. `node --check`. Fonctions pures
  (résolution de bloc) testées headless si extraites.

## G2 — Défilement synchronisé plus fidèle / réactif (A1)
- **Cause.** `scrollVersLigne` (apercu.js) **cale au début du bloc** dont la ligne ≤ cible :
  dans un bloc long (paragraphe multi-lignes = un seul `data-pos`) l'aperçu ne bouge pas
  tant qu'on n'entre pas dans le bloc suivant → « suit après plusieurs lignes ». Débounce
  hôte + webview (60/70 ms) ajoute de la latence.
- **Fix.** **Interpolation intra-bloc** : trouver le bloc courant `blocs[i]` et le suivant
  `blocs[i+1]`, calculer la fraction `(ligne - blocs[i].ligne) / (blocs[i+1].ligne - blocs[i].ligne)`
  et positionner l'aperçu **proportionnellement** entre `top(blocs[i])` et `top(blocs[i+1])`
  → suivi continu, pas par sauts. Réduire les débounces (~30–40 ms) et/ou poster la ligne du
  haut plus finement. Conserver la garde anti-boucle (`defilementProgrammatique` /
  `defilementProgrammatiqueHote`) — la latence de relâche doit rester ≥ à la durée du scroll
  programmatique pour ne pas ré-armer une boucle.
- **Gate.** GUI : défiler l'éditeur ligne à ligne → l'aperçu suit **en continu** (pas de
  palier de plusieurs lignes) et sans tremblement/boucle ; sens inverse toujours OK.
  `node --check`. Non-régression round-trip + i18n.

## G3 — Sens inverse : curseur/clic dans le .md → surlignage côté aperçu HTML
- **But.** Complément de l'A2 (aperçu→source). Quand le curseur bouge (ou clic) dans
  l'éditeur `.md` de l'article courant, **mettre en évidence** le bloc correspondant dans
  l'aperçu HTML, et l'amener en vue **seulement s'il est hors écran** (pas de saut si déjà visible).
- **Approche.** Hôte : `vscode.window.onDidChangeTextEditorSelection` sur l'éditeur de
  l'article courant (`editeurArticleCourant`) → ligne (+ colonne) du curseur → `postMessage`
  `{type:'surligner', ligne, mot}` (mot = jeton sous le curseur, via un helper source ; peut
  être vide). Débounce léger. Webview : trouver le bloc `[data-pos]` dont la plage contient
  `ligne` (réutiliser l'index `blocs`), retirer le surlignage précédent, ajouter une classe
  (ex. `szh-actif` : filet/fond d'accent discret) ; `scrollIntoView({block:'nearest'})` si hors
  écran, **sous la garde `defilementProgrammatique`** (ne pas ré-déclencher le sync inverse).
- **Niveau mot (au mieux).** Si `mot` non vide, surligner sa **1ʳᵉ occurrence** dans le texte
  rendu du bloc (envelopper dans un `<span class="szh-mot-actif">`, nettoyé au changement) ;
  sinon surlignage du bloc seul. Même contrat « au mieux » que l'A2 (mot répété → 1ʳᵉ occ).
- **Gate.** GUI : déplacer le curseur dans le `.md` → le bloc (et le mot si possible) est
  surligné dans l'aperçu, mis en vue si nécessaire, **sans boucle** avec A1/A2. `node --check`.
  Helper source (jeton sous le curseur) pur → testable headless.

## Garde-fous
- Ne pas régresser : clic→bloc/mot existant, l'aperçu PDF, la bascule barre d'état, le
  round-trip tableau. CSP stricte, DOM only, zéro dépendance, sans build (extension).
- Pipeline (si G1 option A) : Lua idempotent, aucun `/mnt/c` en dur. `git status` avant
  chaque commit ; un commit par point. Recopie dossier complet dev + re-sync pipeline→toolkit
  si le filtre change. Ne pas toucher : lot D34, `Feature.docx`.
