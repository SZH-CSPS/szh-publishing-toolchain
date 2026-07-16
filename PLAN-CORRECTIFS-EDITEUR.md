# Correctifs éditeur de tableau — notes d'exécution (lot en cours)

Suite aux tests de Robin. **Bloqué momentanément** par une indisponibilité du
classifieur Bash (surcharge serveur) + 529 sur les agents → reprendre dès que
`git`/WSL/agents répondent. Diagnostics faits (lecture seule). Structure post-refactor :
webview = `media/table-editor.{js,css,html}`, modèle = `lib/table-model.js`, i18n =
`lib/i18n.js`, hôte = `extension.js`, pipeline = `accent-css.py`/`print.css`/`couleurs.css`.

## F5 — Couleurs éditables — **ÉCRIT, à committer**
- `pipeline/styles/couleurs.css` (nouveau) : 6 couleurs × 3 variations (`--c-<nom>-normal/-clair/-fonce`), valeurs WCAG (clair↔#000 ≥4.5:1, fonce↔#fff ≥4.5:1).
- `pipeline/accent-css.py` : réécrit pour LIRE `couleurs.css` (map hex→nom), repli calcul si absent.
- **À faire** : `python3 -m py_compile accent-css.py` ; `python3 accent-css.py <ausgabe>` pour #D31932/#51A66D/#A98899 (doit ressortir les vars de couleurs.css) + sans couleur (commentaire) ; `cp -r pipeline/. /c/ProgramData/SZH/toolkit/pipeline/` ; commit « fix(pipeline): couleurs de tableau éditables… ».

## F1 — Annuler ne fait rien (`media/table-editor.js`)
Cause : `op()` (l.193) appelle `capturer()`, mais `dernierValide === modele` courant (réinitialisé par `charger` l.283 après chaque op) → `snap === dernierValide` → **rien empilé** → `annuler` vide.
Fix : dans `op()`, empiler `clone(modele)` (état PRÉ-op) sur `annuler` + vider `retablir` AVANT le postMessage ; **supprimer** `dernierValide=clone(modele)` du `charger` sans i18n (l.283) ; capturer aussi les éditions de texte (blur de cellule). `annulerAction`/`retablirAction` : pousser courant→autre pile puis `restaurer(pop)`. Ctrl+Z déjà câblé (l.272). L'hôte gère déjà `restaurer` (extension.js ~l.1405).

## F2 — Cellule fusionnée non éditable (`media/table-editor.js`)
Cause : `plage()` (l.36) = vrai si le rectangle couvre >1 case ; une cellule **fusionnée** sélectionnée = plage → `majEditable()` (l.94) met `contentEditable=false`.
Fix : `plage()` = **nombre de cellules DISTINCTES >1** (compter via `occ2` sur le rectangle). Une cellule fusionnée seule → pas une plage → éditable.

## F3 — « Retirer l'en-tête » enlève ligne ET colonne
Cause : bouton envoie `op('enteteRetirer',{})` **sans sens** (l.225) → l'hôte/modèle retire les deux.
Fix : `onRetirerEntete()` qui déduit le sens de la sélection (même logique que `onDefinirEntete` l.213-217) → `op('enteteRetirer',{sens})` ; l'hôte + le modèle (`appliquerOperationTable`) honorent `sens` (enlève `enteteLignes` OU `enteteColonnes`, pas les deux).

## F4 — En-têtes en gras trompeur dans l'éditeur
Cause : cellules d'en-tête = `<th>` → **gras par défaut du navigateur** (aucune règle ne l'annule ; `styleEnt` n'applique le gras que pour gras/fond/negatif).
Fix : `media/table-editor.css` → `table.grille th.cell { font-weight: 400; }` + **pictogramme** d'en-tête (ex. « ★ » via `::before` ou un `<span>`), indépendant du style choisi.

## F7 — Overlay de préparation au démarrage (`extension.js` `activate()`)
Fix : envelopper l'init lente dans `vscode.window.withProgress({location: Notification, title:'Préparation de l'outil Revue…'})` : « Démarrage de l'environnement… » = `await` un `wsl -d SZH-Publishing -- true` (réveil WSL, le vrai coût), puis « Chargement de la revue… » (arbre) ; + item de barre d'état `$(sync~spin) SZH…` pendant, retiré ensuite. Seulement quand une revue est ouverte (`estRevue`), au démarrage. (Bonus : voile « préparation… » dans les webviews tant que les données ne sont pas arrivées.)

## Gates (chaque correctif)
`node --check` (extension.js + lib/*.js) ; harnais round-trip tableau + parité i18n via `_pur` ; F3 testable par le modèle ; `py_compile` + test fonctionnel pour F5. Recopie du **dossier complet** de l'extension dans la copie dev + re-sync pipeline→toolkit pour F5/print.css. Un commit par correctif (ou groupe). Ne pas toucher : lot D34, szh-apercu, szh-tabelle-inclure.lua, Feature.docx. `git status` avant chaque commit.
