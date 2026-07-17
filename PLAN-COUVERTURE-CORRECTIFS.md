# Correctifs de couverture (retours de Robin sur le 1er rendu maquette)

Diagnostic FAIT (lecture seule). **À appliquer APRÈS l'agent import** (il peut toucher
`print.css`/`Makefile`). Tout est dans `pipeline/styles/print.css` (+ vérif Makefile pour C1,
+ éventuel ajustement `pipeline/templates/szh-article.html` pour C3). Gate = **rebuild réel**
(`make` sur revue-template via WSL) + inspection du HTML/PDF. Ne pas régresser T1/T2, aperçu.

## C4 — Blanc au-dessus/autour du hero (le plus simple)
- **Cause** : `body` n'a pas de `margin:0` (print.css ~l.118) → WeasyPrint applique sa marge UA (~8 px).
- **Fix** : `html, body { margin: 0; padding: 0; }`.

## C2 — Le corps doit couler sous les résumés sur la PAGE 1 (pas de saut forcé)
- **Cause** : `.szh-cover { break-after: page; }` (l.140) force le corps en page 2 ; et
  `@page:first { margin:0 }` (l.89) empêche des marges pour du texte sur la 1re page.
- **Fix (technique du full-bleed par marges négatives)** :
  - `@page` : GARDER `margin: 74px 64px 66px 64px` pour TOUTES les pages (y compris la 1re).
  - `.szh-hero { margin: -74px -64px 0 -64px; }` → déborde jusqu'aux bords haut/gauche/droite
    tout en laissant le reste du contenu dans les marges.
  - `.szh-filet { margin: 0 -64px; }` → filet pleine largeur.
  - `.szh-cover-body` : retirer le padding horizontal (56px) → s'aligne sur les marges @page ;
    garder un padding-top (espace après le filet).
  - **RETIRER** `.szh-cover { break-after: page; }` → `$body$` coule juste après les résumés.
  - `@page :first { margin: 74px 64px 66px 64px; @top-center { content: none; } }` → pas d'en-tête
    courant sur la couverture (le hero le remplace), mais **marges + pied conservés** (ISSN + folio 1).
- **Vérif** : p.1 = hero pleine-marge + résumés + début du corps ; pas d'en-tête courant en p.1 ;
  le corps continue en p.2 avec en-tête/pied ; folio correct.

## C3 — Auteur / DOI / licence à hauteur FIXE (indépendante du titre/sous-titre)
- **Cause** : `.szh-hero-meta { margin-top: 20px }` (l.165) suit le sous-titre (position variable).
- **Fix** : `.szh-hero { display:flex; flex-direction:column; min-height: 300px }` (ou hauteur fixe) ;
  `.szh-hero-main { flex: 1; display:flex; flex-direction:column }` ; `.szh-hero-meta { margin-top: auto }`
  → le bloc auteur/DOI/licence est ancré en bas du hero, même baseline quel que soit le titre.
  (Garder `.szh-hero-top` en haut.)

## C1 — Couleur d'accent dynamique depuis ausgabe.yaml — ✅ RÉSOLU (Robin : « Couleur OK »)
Rien à coder : c'était opérationnel (couleur à choisir + rebuild). La chaîne dynamique fonctionne.
- **État vérifié** : la chaîne EST dynamique — l'éditeur écrit un HEX (`couleur: "#…"`), le Makefile
  régénère `out/.szh-accent.css` via `accent-css.py ausgabe.yaml` (dep sur ausgabe.yaml), chargé APRÈS
  `print.css` → `--c-annual` passe du gris défaut (#8f8f95) au hex du numéro (démo : #5F9FBC confirmé
  dans le HTML compilé). Filet/bordure résumé/mots-clés = `var(--c-annual)`.
- **À faire (vérification définitive)** : après l'import, CHANGER `couleur:` de la démo (ex. #D31932),
  `make` propre, et CONFIRMER que filet + bordures des résumés + fond des mots-clés changent. Si un
  vrai bug (build périmé) : rendre la régénération de `.szh-accent.css` robuste (ex. cible `.PHONY`
  ou régénération systématique sur `tout-exporter`). Sinon, c'est opérationnel : `couleur:` doit être
  choisi dans « Métadonnées du numéro » ET rebuild (Tout exporter) après changement.

## Ordre d'application
C4 (trivial) → C2 (restructuration page) → C3 (flex hero) → C1 (vérif + éventuel durcissement).
Un commit « fix(pipeline): couverture — … » (ou groupé). Rebuild réel après. Re-sync toolkit.
Ne pas toucher : lot D34, Feature.docx, TODORMO.md, 99-demo, T1/T2, aperçu.
