# Plan — Migration de la maquette définitive dans le toolchain

Spec autoporteuse (skill `senior-software-engineer`), 4 tranches verticales (M1→M4),
un commit par tranche, puis un **bilan listant TOUTES les adaptations réalisées et leur
raison** (exigence de Robin). Français partout.

## Source de vérité
- **Maquette** : `tmp/base-finale-source.jsx` (code React de référence — LE fichier à traduire).
- `tmp/Pages export.html` : tokens `:root`, géométrie page (A4 794×1123 px, `@page{size:794px 1123px;margin:0}`),
  et le système de jetons pilotés par la couleur annuelle.
- `tmp/SZH · Pages export.pdf` : rendu de référence (comparer visuellement).
- **Base sur la PREMIÈRE couverture** (`BFCover`, étiquette de dossier), la variante « Varia »
  n'est que la logique d'étiquette (ci-dessous). Ignorer les variantes de tableau T1–T6
  (les tableaux sont gérés par la refonte tableau, PLAN-TABLEAU-STYLES.md).

## Cible technique
Toolchain actuel : Markdown → pandoc `--to=html5` → WeasyPrint. Le Makefile (l.107) laisse
justement un placeholder « REMPLACER par le template HTML/filtres finaux de la maquette ».
Il faut donc créer :
- **Un template pandoc HTML** `pipeline/templates/szh-article.html` : couverture (hero) + `$body$`,
  peuplé depuis les métadonnées.
- **print.css étendu** : géométrie `@page` (couverture pleine-marge + pages courantes avec
  en-tête/pied courants via *margin boxes*), polices `@font-face`, tokens `:root`, et TOUS les
  éléments (titres H1–H4, listes, encadrés, résumé/mots-clés, accents de tableau hérités de la refonte).
- **`pipeline/fonts/`** : Open Sans, Source Serif 4, IBM Plex Mono (OFL) empaquetées + `@font-face`.
- **`accent-css.py` étendu** : précalcule TOUS les jetons dérivés de la couleur annuelle
  (les `color-mix()` et le contraste APCA du JS `applyTweaks`, que WeasyPrint ne sait pas faire).
- **Filtre(s) Lua** au besoin (étiquette de dossier selon le type ; mappage des divs → encadrés ;
  numérotation des titres si non faite en CSS).
- Ne PAS toucher : lot D34, `Feature.docx`. Coordonner avec la refonte tableau (mêmes accents annuels).

## Décisions
- **D69 — Géométrie & pleine-marge.** `@page{size:A4;margin:0}` pour la **couverture** (`:first`) →
  le **hero déborde jusqu'au bord** (exigence Robin : la bande ne s'arrête plus à la marge).
  Pages courantes : `@page` avec marges (haut/bas réservés à l'en-tête/pied courants).
- **D70 — Hero bleu nuit PERMANENT.** Fond du hero = `#252B46` (`--c-nuit`) en toutes circonstances.
  **Tout le reste en « bleu acier » de la maquette est de la COULEUR ANNUELLE** (filet sous le hero,
  bordure du résumé, fond des mots-clés, encadrés, citation/hervorhebung, accents de tableau).
  Les **marqueurs de liste et les numéros de titre restent NOIRS** (fidèle à la maquette).
- **D71 — Étiquette de dossier (selon le type d'article).** 6 types en 2 groupes :
  - **Liés au dossier** — `article`, `editorial`, `interview` → afficher le **titre du dossier
    thématique** (métadonnée du numéro) à l'emplacement « Psychische Gesundheit ».
  - **Hors dossier** — `varia`, `tribune-libre`, `documentation` → afficher le **libellé du type**
    localisé (« Varia » / « Tribune libre » / « Documentation »).
  - **Même logique** pour l'en-tête courant des pages intérieures (ligne de gauche).
  - Libellés localisés de/fr/it via un filtre Lua (map `type` → libellé) + langue de l'article ;
    libellés exacts À VALIDER par Robin. La liste du menu « Type d'article » (côté extension) doit
    proposer ces 6 valeurs → petit alignement extension à faire APRÈS l'agent tableau (il édite
    `i18n.js`) ; côté pipeline, gérer les 6 valeurs dès maintenant.
- **D72 — Couleur annuelle unifiée.** `accent-css.py` émet UN bloc de jetons canonique consommé
  à la fois par les tableaux (`--szh-accent*`) ET la maquette (`--c-annual*` — pont/alias pour
  limiter le code). Repli gris si aucune couleur (numéro sans couleur = rendu neutre cohérent).
- **D73 — Polices empaquetées.** `pipeline/fonts/` + `@font-face` (OFL, fetch par l'agent ; repli
  install WSL documenté si pas de réseau). `font-stretch:87.5%` : si non supporté par WeasyPrint,
  repli sur la fonte statique la plus proche (documenté).
- **D74 — Revue = choix fermé (radio) qui fixe nom + ISSN + langue par défaut.** L'éditeur du
  numéro remplace le champ libre « Nom de la revue » par un **radio à 2 valeurs** :
  - `Schweizerische Zeitschrift für Heilpädagogik` → **ISSN 2813-4907**, langue défaut **de** ;
  - `Revue suisse de pédagogie spécialisée` → **ISSN 2813-4915**, langue défaut **fr**.
  Un seul champ canonique dans ausgabe.yaml (ex. `revue: zeitschrift|revue`) dont on DÉRIVE nom,
  ISSN et langue par défaut (plus d'ISSN saisi à la main). Cette **langue par défaut** pilote :
  (a) la langue de compilation/couverture/césure + libellés localisés (D71) ; (b) **l'ordre des
  champs traductibles dans les formulaires** — langue défaut EN PREMIER (« Titre (DE) »), traductions
  en dessous ; ordre inverse si l'autre revue. *Implémentation côté extension (éditeurs
  metadata-issue / metadata-articles + i18n) → lot extension APRÈS l'agent tableau (collision
  `i18n.js`) ; côté pipeline, consommer `revue` → {nom, issn, lang} dès la maquette.*

## Contrat de métadonnées — RÉUTILISER l'existant (ne PAS inventer de clés)
La plupart des champs existent déjà via les éditeurs du cockpit. **L'agent DOIT lire les clés YAML
exactes** dans les sérialiseurs de l'extension (`analyser/serialiserAusgabe`, `analyser/serialiserMeta`
dans `extension.js`/`lib`) et les consommer telles quelles dans le template.
- **ausgabe.yaml** (éditeur « Métadonnées du numéro ») : **titre du dossier thématique**, **revue**
  (radio D74 → nom + **ISSN** + langue par défaut, plus de champ libre ni d'ISSN saisi), **volume**,
  **numéro**, **date/année**, **couleur** (rouge/capucine/moutarde/poireau/bleuacier/mountbatten).
  La **langue par défaut** vient du choix de revue (D74), pas d'un champ séparé.
- **meta.yaml** (éditeur « Métadonnées des articles », cf. N7) : `type`, `title`/`subtitle`
  (traductibles fr/de/it), `resume` (fr/de/it), `keywords` (fr/de/it), `author` (structuré
  prenom/nom/fonction/affiliation), `doi` si présent.
- **À réconcilier** (adaptation à documenter) : l'`ausgabe.yaml` d'exemple met `title:` = nom de la
  revue, alors que l'éditeur distingue « Titre du dossier » et « Nom de la revue ». Aligner l'exemple
  + le template sur le modèle de l'éditeur (source de vérité = les sérialiseurs).
- Champs manquants → dégradation propre (pas d'échec ; section masquée si vide).

## Tranches (verticales, chaque tranche = un build qui montre le résultat)

### M1 · Fondations — géométrie, polices, tokens, en-tête/pied courants
- [ ] `@page` : A4, couverture `:first` marge 0 (hero pleine-marge) ; pages courantes avec marges +
  **margin boxes** `@top-*`/`@bottom-*` : en-tête courant (dossier · Vol/numéro/année) et pied
  (ISSN · **folio = `counter(page)`**), filets. Chaîne du dossier via `string-set` ou injection template.
- [ ] `pipeline/fonts/` + `@font-face` (3 familles) ; `:root` tokens (couleurs, `--body-size`,
  `--leading`, polices, `--c-nuit`, `--c-rule`, etc.).
- **Démontrable** : un article minimal compile → cadre de page correct, en-tête/pied répétés,
  folio juste, polices appliquées.

### M2 · Couverture (template pandoc)
- [ ] `pipeline/templates/szh-article.html` (`--template`) : hero bleu nuit (D70) — nom de revue,
  étiquette de dossier (D71), Vol·numéro/année à droite, filigrane « livre » SVG (BOOK_PATH, opacité
  0.07, bas-droite), titre + sous-titre, auteurs, lien DOI (flèche), licence CC-BY (flèche) ; filet
  6 px couleur annuelle sous le hero ; puis **résumés** de/fr (`NewAbstract` : fond `#f3f3f4`, bordure
  gauche annuelle, label, **mots-clés** en puces teintées annuel) ; peuplé depuis les métadonnées.
- [ ] Câbler `--template` dans le Makefile (remplacer le placeholder l.107), pour la sortie HTML/PDF.
- **Démontrable** : `make` d'un article → couverture fidèle depuis ausgabe.yaml + meta.yaml
  (comparer au PDF de référence).

### M3 · Éléments de corps
- [ ] **Titres H1–H4** : `#`..`####` → h1..h4, numérotation hiérarchique (`1`, `1.1`, `1.1.1`,
  `1.1.1.1`) **via compteurs CSS**, numéro en NOIR, style maquette (sans, semi-condensé, gras,
  tailles décroissantes). *(Adaptation : la maquette ne montrait que 2 niveaux visuels → étendu à 4
  comme demandé « Titre 1 à 4 ».)*
- [ ] **Listes** : puce = **triangle `▸` NOIR** (gras, ~1.2 em) via `li::before` ; liste **numérotée**
  « 1. » NOIR gras via compteur CSS. Texte justifié + césure (`hyphens:auto`, `lang`).
- [ ] **Citation** = blockquote `>` → **italique**, justifié, sans bordure ni retrait (BFZitat).
- [ ] **Hervorhebung** = `::: {.hervorhebung}` (alias `.highlight`) → **barre latérale gauche couleur
  annuelle** + texte agrandi (~1.42 em, poids 500) (BFPull « bar »).
- [ ] **Wichtig box** = `::: {.important}` (titre via `data-titre`, défaut « Information ») → fond
  teinté annuel doux + **bordure gauche 4 px annuelle** + titre capitales noir + corps (BFInfoBox).
- **Démontrable** : un article de démo (titres, 2 listes, citation, hervorhebung, wichtig box) rend
  tous les éléments conformes à la maquette.

### M4 · Couleur annuelle (précalcul WeasyPrint) + cohérence
- [ ] `accent-css.py` : précalculer et émettre TOUS les jetons dérivés (remplacent les `color-mix()`
  et le contraste APCA du JS) : `--c-annual`, `--c-annual-deep`, `--c-annual-text` (texte annuel sur
  blanc, APCA-safe), `--c-annual-ui` (filets/barres ; **cas moutarde `#C7CF1C` → quasi-noir**),
  `--c-on-annual` (texte sur aplat annuel : blanc, ou **noir sur moutarde**), `--c-abstract-border`,
  `--c-kw-bg` (≈annuel 22 % sur blanc), `--annual-soft` (≈12 %), `--annual-tint` (≈13 %). Unifier
  avec les `--szh-accent*` de la refonte tableau (D72). Repli gris si pas de couleur.
- [ ] Vérifier que **changer `couleur:` dans ausgabe.yaml repeint tous les accents** et que le **hero
  reste bleu nuit** ; contrastes respectés (texte lisible sur chaque aplat, ≥ WCAG/APCA visé).
- **Démontrable** : 2 builds (ex. bleu acier vs moutarde) → tous les accents changent, hero inchangé,
  aucun texte illisible ; un build sans couleur → repli gris neutre.

## Adaptations attendues (WeasyPrint) — l'agent complète et JUSTIFIE chacune dans le bilan
- `color-mix()` → **précalcul** en CSS vars (M4). Raison : non supporté par WeasyPrint.
- Contraste APCA calculé en JS (`applyTweaks`) → **précalcul** (luminance/contraste) dans accent-css.py.
- Pages discrètes React (chaque `.pg` = une page absolue) → **modèle de flux paginé** : couverture =
  1er bloc ; en-tête/pied = *margin boxes* répétées ; folio = `counter(page)`. Raison : l'article a
  une longueur variable, WeasyPrint pagine.
- `font-stretch:87.5%` variable → repli statique si non rendu. `text-wrap:balance/pretty` → ignorés
  (sans effet, inoffensif). Fetch polices → repli install WSL si pas de réseau.
- Numérotation manuelle des titres (maquette) → **compteurs CSS** (le rédacteur n'écrit pas les numéros).

## Risques
- **Polices** (provisionnement/réseau) : fetch OFL, sinon install WSL, sinon repli système — documenté.
- **Margin boxes / `@page:first` / `string()`** sous WeasyPrint : vérifier par un build réel (spike).
- **Hero pleine-marge** : valider que le débordement atteint bien le bord (marge 0 sur `:first`).
- **Deux invocations pandoc** (HTML `markdown` vs aperçu `commonmark_x`) : la maquette cible la sortie
  **PDF** ; l'aperçu réutilise print.css mais **peut** ne pas rendre la couverture (chrome). À noter,
  pas bloquant.
- **Coordination refonte tableau** : les accents annuels doivent rester cohérents (D72) ; lancer CE
  lot APRÈS l'agent tableau (il édite print.css + accent-css.py/couleurs.css).

## Garde-fous & gates
- Idiomatique d'abord (CSS Paged Media natif, compteurs, `@font-face`, template pandoc) ; à défaut,
  solution simple minimisant le code (exigence Robin). Pas de JS au rendu (WeasyPrint statique).
- **Gate par tranche** : un `make` réel (spike WSL) produit un PDF **sans erreur** et conforme
  (comparer visuellement au PDF de référence) ; `py_compile` accent-css.py ; Makefile TAB+LF, aucun
  `/mnt/c` en dur. Consigner la commande + le résultat de chaque build.
- `git status` avant chaque commit ; ne stager que les fichiers de la tranche (les PLAN-*.md sont
  committés à part). Recopie dossier extension inutile ici (pipeline seulement) ; re-sync
  `pipeline/` → `/c/ProgramData/SZH/toolkit/pipeline/` après les tranches.
- **Bilan final** : liste EXHAUSTIVE des adaptations + raison ; fichiers créés (template, fonts,
  filtres, print.css, accent-css.py) ; scénarios de vérification (build couverture, corps, 2 couleurs) ;
  `git diff --stat` + `git status` final (ne doit rester que le lot D34 + Feature.docx).

## À valider par Robin (après coup)
- Les libellés localisés « Varia » / « Tribune libre » / « Documentation » (de/fr).
- Réglages fins (corps 12 px, interlignage 1.55, marges) — ajustables dans `:root`.
- (Résolu D74 : revue = 2 choix fermés + ISSN 2813-4907 / 2813-4915 + langue par défaut.)
