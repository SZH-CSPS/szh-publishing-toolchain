# Plan — Accessibilité des tableaux + qualité de l'import Word

Spec autoporteuse (skill `senior-software-engineer`), tranche par tranche
(AX1 → AX4), un commit par tranche. **À lancer APRÈS l'agent aperçu (A1/A2/A3) en
cours** (évite les collisions sur `extension.js`/`media/`). Français partout.
Structure post-refactor : modèle tableau = `lib/table-model.js` ; import = `pipeline/
import-docx.sh` + `pipeline/docx-tables.py` + filtres `pipeline/filters/*.lua`
(anciennes heuristiques D27–D30 dans `pipeline/attic/` — à consulter/raviver) ;
rendu = `pipeline/styles/print.css` + `pipeline/Makefile`.

## Décisions
- **D61 — Markup de tableau accessible (WCAG H43).** Tableaux **simples** (≤1 ligne ET
  ≤1 colonne d'en-tête) : `scope="col"/"row"` (suffisant). Tableaux **complexes** (2 lignes
  OU 2 colonnes d'en-tête, ou en-tête fusionné) : `<thead>/<tbody>` + **`id` sur chaque
  en-tête** + **`headers="…"` sur chaque cellule de données** (ids des en-têtes de colonne
  de tous les niveaux + en-têtes de ligne) + `scope="colgroup"/"rowgroup"` sur un en-tête
  qui fusionne un groupe. Dérivé du modèle → **régénéré** à la sérialisation → round-trip stable.
- **D62 — PDF balisé (PDF/UA).** WeasyPrint 69 produit un PDF balisé (option `--pdf-variant
  pdf/ua-1`, à confirmer au spike) : le markup accessible sert alors vraiment dans le PDF.
  `lang` du `<html>` déjà fourni (metadata). Ne doit pas casser le build (repli si strict).
- **D63 — Heuristique de titres à l'import.** Quand le `.docx` n'utilise PAS les styles de
  titre (Heading 1/2…), déduire les titres à partir de la mise en forme : paragraphe **isolé
  sur sa ligne**, court, sans style de titre, dont les runs sont **gras ET/OU d'une police
  plus grande** que le corps (voire différente) → promouvoir en titre markdown (`#`/`##`),
  niveau selon la taille. **Conservateur** (éviter les faux positifs). pandoc perd la taille
  de police → l'analyse taille se fait sur `word/document.xml` (comme `docx-tables.py`).

## Tranches

### AX1 · Markup accessible des tableaux de l'éditeur — *lib/table-model.js ; headless*
> **DÉPLACÉ** vers `PLAN-TABLEAU-STYLES.md` (D68/T1) : fusionné avec la refonte des
> styles de tableau car mêmes fichiers. Reste ici pour mémoire ; ne pas dédupliquer.
- [ ] `serialiserTable` : tableaux simples inchangés (`scope`). Tableaux complexes →
  `<thead>` (les `enteteLignes` premières rangées) + `<tbody>` ; `id` unique par cellule
  d'en-tête (ex. `id="h-c<col>-<niv>"` / `id="h-r<row>-<niv>"`) ; `headers="…"` sur chaque
  `<td>` (+ sur les en-têtes de niveau inférieur pointant le niveau supérieur) ;
  `scope="colgroup"/"rowgroup"` si l'en-tête a un colspan/rowspan de groupe.
- [ ] `analyserTable` : ignore/dépouille `id`/`headers`/`thead`/`tbody` (déjà le cas pour
  thead) → le modèle est inchangé → round-trip stable.
- **Gate (headless)** : pour un tableau à 2 lignes d'en-tête, la sortie contient `<thead>`,
  des `id` d'en-tête et des `headers` corrects (une cellule de données référence bien ses 2
  en-têtes de colonne + son en-tête de ligne) ; **round-trip `analyser∘serialiser∘analyser`
  identique** (les attributs dérivés ne cassent pas le modèle) ; tableau simple → toujours `scope`.

### AX2 · Markup accessible des tableaux importés de Word — *pipeline/docx-tables.py*
- [ ] Utiliser l'info d'en-tête de Word si présente : `<w:tblHeader>` (rangée d'en-tête
  répétée) → ces rangées vont dans `<thead>` avec `<th scope="col">` (+ id/headers si 2 niveaux).
- [ ] **Sinon, heuristique** : si la **1ʳᵉ rangée** est entièrement en **gras** (tous les runs
  `w:b`) → la traiter comme en-tête (`<thead>` + `<th scope="col">`). Sinon, pas d'en-tête (statu quo).
- [ ] Émettre le même style de markup accessible que AX1 (simple → scope ; complexe → id/headers).
- **Gate** : docx forgé — (a) avec `tblHeader` → `<thead>`+scope ; (b) 1ʳᵉ rangée gras, sans
  tblHeader → en-tête déduit ; (c) 1ʳᵉ rangée normale → pas d'en-tête. `py_compile`.

### AX3 · PDF balisé (PDF/UA) — *pipeline/Makefile*
- [ ] Activer la sortie **balisée** de WeasyPrint (spike : `--pdf-variant pdf/ua-1` ou l'option
  de tagged PDF de la 69 ; confirmer le nom exact). Vérifier que `lang` est bien posé sur `<html>`
  (metadata pandoc). Le build ne doit **pas échouer** ; si le mode strict rejette, se rabattre
  sur le tagged-PDF simple. TABULATIONS+LF, aucun /mnt/c en dur.
- **Gate (spike consigné)** : un PDF compilé est balisé (vérifier via `weasyprint`/inspection :
  présence de la structure/tags ; au minimum aucune régression de rendu, build vert).

### AX4 · Heuristique de titres à l'import — *pipeline (Lua + éventuel pré-pass Python) ; consulter attic/*
- [ ] Consulter `pipeline/attic/` (heuristiques D27 « titres » débranchées) → raviver/adapter.
- [ ] **Détection** (conservatrice) : un paragraphe est un titre présumé si TOUT est vrai —
  pas de style Heading, **une seule ligne courte** (≤ ~12 mots), pas dans une liste/tableau,
  ne se termine pas par une ponctuation de phrase, ET (**gras** sur tout le texte **OU** police
  sensiblement **plus grande** que le corps). La taille de police se lit dans `word/document.xml`
  (pandoc la perd) → pré-pass Python (réutiliser la lecture XML de `docx-tables.py`) qui produit
  soit un markdown transformé, soit des indices consommés par un filtre Lua.
- [ ] **Niveau** : par paliers de taille (plus grand = `#`, ensuite `##`…), sinon tout en `##`.
- [ ] **Sécurité** : ne promouvoir que les cas nets ; en cas de doute, ne rien changer (un
  faux titre est pire qu'un titre manqué). Journaliser le nombre de titres déduits (`[import] N titres déduits`).
- **Gate** : docx forgé sans styles de titre — un paragraphe gras isolé court → `#`/`##` ;
  un paragraphe de corps normal → inchangé ; une phrase en gras longue → inchangée (pas de faux positif).

## Garde-fous
- Round-trip tableau PRÉSERVÉ (AX1). `id`/`headers` **déterministes** depuis le modèle.
- Pipeline : Makefile TABULATIONS+LF, aucun `/mnt/c` en dur ; scripts Python stdlib only.
- Ne pas toucher : `szh-apercu`, `szh-tabelle-inclure.lua` (sauf si AX nécessite l'inclusion —
  alors avec soin), le lot D34, `Feature.docx`. `git status` avant chaque commit.
- Gates headless (via Electron/`_pur` pour AX1) + spikes WSL consignés (AX2/AX3/AX4).
  Recopie du dossier complet dev + re-sync pipeline→toolkit après les tranches pipeline.

## À valider par Robin (après coup)
- Seuils de l'heuristique AX4 (longueur max, « police plus grande » = combien de %).
- Le niveau des titres déduits (tout en `##` vs paliers de taille).
