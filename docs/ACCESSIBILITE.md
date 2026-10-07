# Accessibilité

Cette page dit quelles normes d'accessibilité Pronto vise, ce que la chaîne fait pour les
tenir, comment on le vérifie et quelles règles suivre en modifiant la maquette. Les défauts
connus sont dans [`LIMITES-ACCESSIBILITE.md`](LIMITES-ACCESSIBILITE.md).

Un PDF publié par les éditions engage l'accessibilité : la vérification PDF/UA bloque
l'export, mais pas l'épreuve.

## Les normes visées

| Sortie | Norme |
|---|---|
| PDF (article, livre numérique, couverture d'écran) | PDF/UA-1 (ISO 14289-1) |
| HTML (galley HTML, sortie web du livre, EPUB) | WCAG 2.2 niveau AA, RGAA |
| Couleurs | contraste APCA pour le texte ; 3:1 (WCAG 1.4.11) pour les éléments non textuels |
| Livres FALC | règles du « facile à lire et à comprendre » : une phrase par ligne, fer à gauche, sans césure |

La couverture d'impression d'un livre (PDF/X-4, CMJN) n'est pas soumise à PDF/UA : c'est un
fichier pour l'imprimeur, contrôlé par `pipeline/couverture.py`.

## Comment on vérifie

### La vérification PDF/UA

`pipeline/verifier-ua.sh` passe chaque PDF à veraPDF (`--flavour ua1`), et
`pipeline/rapport-ua.py` traduit le verdict en français et en allemand. Codes de sortie :

| Code | Sens |
|---|---|
| 0 | tous les PDF sont conformes |
| 1 | au moins un PDF non conforme |
| 2 | panne d'outillage (veraPDF absent, fichier illisible, `JAVA_HOME` faux) |

Le code 2 n'est jamais un succès. Un `JAVA_HOME` faux ferait sortir veraPDF en 1, comme un
PDF non conforme : le script vérifie donc Java avant d'appeler veraPDF.

La vérification tourne à trois endroits :

- `make verifier-ua`, appelée par les cibles `docx` et `tout-exporter` (`pipeline/Makefile`),
  et non par `all` ni `pdf` : la rédaction peut toujours sortir l'épreuve d'un article
  imparfait ;
- en CI, dans le job `pdf-ua` de `.github/workflows/ci.yml`, sur le banc `test/` ;
- dans le cockpit, en arrière-plan après chaque compilation réussie
  (`lib/pdfua-hote.js`). Le verdict s'affiche en badge « PDF/UA » dans la barre d'état, et
  un PDF non conforme apparaît en erreur dans les Contrôles.

Le verdict se lit sur l'absence de FAIL dans le rapport de veraPDF, pas sur la présence d'un
PASS.

### Ce que veraPDF ne voit pas

veraPDF ne teste que les conditions vérifiables par machine. La pertinence d'un texte
alternatif, l'ordre de lecture réel, la langue d'un passage, la voix ou la navigation
demandent un essai avec un lecteur d'écran (NVDA, par exemple). Sans cet essai, on écrit
« non vérifié », et non « accessible ».

### Les autres contrôles

| Contrôle | Ce qu'il vérifie |
|---|---|
| `test/accessibilite/` | un numéro d'essai fr et de : tableaux sans en-tête, bibliographie à diacritiques polonais, turcs et serbes, sauts de niveau de titre, paire de traductions à numérotation divergente. Sa vérification PDF/UA doit rendre 0. |
| `test/polices-check.py` | refuse un PDF qui embarque une police absente de `pipeline/fonts/` (une police de repli rend des caractères illisibles au copier-coller) |
| `test/apca-check.py` | contraste APCA de la palette (`pipeline/styles/couleurs.css`) et des couleurs de `print.css`, paire par paire, avec `pipeline/apca.py` |
| `test/epub-check.py` | structure de l'EPUB d'un livre |
| `test/weasyprint-patch-check.py` | ce que chaque correctif de WeasyPrint doit produire |
| `test/build-render.sh` | le banc de rendu ; il enchaîne la vérification PDF/UA, `polices-check.py` et `test/accessibilite/` |

## Ce qui est en place

### Le balisage du PDF

- **Repli de WeasyPrint.** `define weasy_ua` (`pipeline/Makefile`) tente PDF/UA-1, puis un
  PDF balisé simple, puis un PDF sans balises. Chaque repli écrit une ligne au journal de
  compilation (« PDF/UA-1 indisponible -> PDF balisé simple ») : un PDF qui perd ses balises
  ne passe pas en silence.
- **Tableaux.** `szh-tableau-boite.lua` met chaque tableau dans une boîte qui ne se coupe
  pas entre deux pages : une `<caption>` séparée de sa table fait tomber le balisage.
  `szh-tabelle-scope.lua` pose `scope` sur les en-têtes (RGAA 5.7). Une description longue
  (`data-alt`) devient un élément `.szh-description` masqué visuellement, relié au tableau
  par `aria-describedby` (`szh-numerotation.lua`).
- **Tableaux complexes.** L'éditeur de tableaux du cockpit admet au plus deux rangées ou
  deux colonnes d'en-tête, contiguës depuis le bord. Un titre de section fusionné porte
  `scope="rowgroup"` et sert d'en-tête, colonne par colonne, aux rangées qui le suivent
  jusqu'au titre suivant. Le lien entre une cellule et ses en-têtes passe par `headers=`
  (WCAG H43, RGAA 5.7), et non par plusieurs `<tbody>`, qui casseraient les sélecteurs de
  `print.css` (total, zébrage). Code : `lib/table-model.js` et `media/table-editor.js` du
  cockpit.
- **Images.** Une image à `alt=""` est décorative : elle sort en fond CSS, donc hors de
  l'arbre de structure (`en_decor()` dans `szh-numerotation.lua`). Le portrait d'un auteur
  est aussi un fond CSS. Une `<img alt="" role="presentation">` qui resterait sort en
  artefact grâce au correctif WeasyPrint `15-images-decoratives`.
- **Exergue.** `szh-exergue.lua` met l'exergue en `aria-hidden` dans le HTML publié,
  puisqu'elle répète le texte. WeasyPrint ignore `aria-hidden` : dans le PDF, elle reste
  lue. L'aperçu ne passe pas par ce filtre.
- **Liens sans texte.** Le QR et l'icône ORCID sont des `<a>` vides avec un `aria-label`,
  l'image passant en fond CSS. Un `<svg>` ou un bloc dans un `<a>` casse PDF/UA.
- **Liens dans un conteneur flex.** WeasyPrint ne crée pas d'annotation `/Link` pour un `<a>`
  enfant direct d'un conteneur flex. Un `<span>` intermédiaire porte le lien : DOI et
  licence de la couverture (`pipeline/templates/szh-article.html`), entrées du sommaire FALC
  (`pipeline/livre-assembler.py`).
- **Listes.** Les puces et numéros sont des `::marker` (`print.css`), que WeasyPrint balise
  en `LI > Lbl + LBody`.
- **Langue.** `szh-contexte.lua` décide la langue de l'article. Elle est posée sur
  `<html lang>`, donc sur le `/Lang` du document, et sur chaque passage dans une autre
  langue. Les webviews du cockpit prennent la langue de l'interface.
- **Signets et titre.** Le signet d'un article lit le titre à plat (`data-signet`,
  `bookmark-label` dans `print.css`). `/Info /Title` reçoit le même titre.
- **Métadonnées XMP.** `dc:language` est écrit par le correctif WeasyPrint
  `40-xmp-dc-language`. `xmp:CreatorTool` vaut « Pronto, open-source publishing software by
  SZH/CSPS » ; `dc:creator` porte les auteurs au format « Nom, Prénom ».
- **Transparence.** Une `opacity` inférieure à 1 fait dessiner l'élément par WeasyPrint dans
  un groupe de transparence, où son contenu sort de l'arbre de structure (PDF/UA-1,
  règle 7.1-3). Les teintes claires de la couverture (point médian entre auteurs, filigrane)
  sont donc des couleurs pré-mélangées, avec `opacity: 1`.

### Les correctifs de WeasyPrint

WeasyPrint 70.0 est patché dans l'image WSL (`image/patches/weasyprint-70.0/`). Ceux qui
touchent l'accessibilité :

| Correctif | Effet |
|---|---|
| `10-tableaux-entetes` | `/Headers` justes sous un `th` fusionné (`colspan`, `rowspan`) |
| `15-images-decoratives` | `<img alt="" role="presentation">` en artefact, et non en `/Figure` sans alternative |
| `20-cesure-trait` | le trait de césure n'est pas copié comme un vrai caractère |
| `25-espace-fin-de-ligne` | l'espace de fin de ligne est dans la couche texte (n'agit qu'avec le 20) |
| `30-marges-artefact` | en-têtes, pieds et folios en artefacts de pagination |
| `40-xmp-dc-language` | `dc:language` dans le XMP |

Le rapport, la démo et l'état chez les développeurs de WeasyPrint de chaque correctif sont
dans [`image/patches/amont/`](../image/patches/amont/README.md). Un correctif n'arrive sur
un poste qu'à la reconstruction de l'image WSL. La CI n'utilise pas l'image : les tests qui
dépendent d'un correctif y sautent avec le motif « correctif WeasyPrint absent ».

### Les contrôles de saisie

- Dans l'aperçu, le message `figure-sans-alt` signale une image qui n'a ni texte
  alternatif ni légende. Un `alt=""` voulu n'est pas signalé. L'export OJS refuse ces
  images.
- Le bouton « Décrire les images » de la vue Contrôles ouvre le gestionnaire des médias.
- Sous chaque image et chaque tableau de l'aperçu, un encadré montre ce qu'un lecteur
  d'écran reçoit (`szh-apercu-lecteur-ecran.lua`).

### Les couleurs

`test/apca-check.py` contrôle toute la palette. Les couleurs de chapitre d'un livre sont
choisies à au moins 3:1 contre le blanc. Un QR dont le contraste avec son fond est sous 3:1
lève le message `qr-contraste-insuffisant` (`szh-qr-commun.lua`).

## Règles de travail

- Une correction se prouve par un HTML minimal avant et après, puis veraPDF, puis la
  comparaison au pixel du banc ([`DEVELOPPEMENT.md`](DEVELOPPEMENT.md)).
- Pas de `<svg>` ni de bloc dans un `<a>`.
- Pas d'`<a>` enfant direct d'un conteneur flex : mettre un `<span>` entre les deux.
- Un lien a un texte visible ou un `aria-label` explicite.
- Les puces et numéros de liste passent par `::marker`.
- Une image a un texte alternatif ou une légende, ou bien `alt=""` si elle est décorative.
- Un tableau a sa rangée d'en-tête en `<th scope>`, et une description longue s'il le faut.
- Pas de positionnement qui casse l'ordre de lecture.
- Tout passage dans une autre langue porte `lang`, même si le PDF ne le reporte pas encore.
- Pas d'`opacity` inférieure à 1 dans `print.css` : on pré-mélange la couleur.
- Les contrastes se vérifient par `test/apca-check.py`. Aucune information n'est portée par
  la seule couleur.
- On ne patche WeasyPrint qu'en dernier recours, après avoir épuisé le CSS, le HTML produit
  et les options officielles, et avec l'accord du responsable du dépôt. Un fichier par
  fonctionnalité dans `image/patches/weasyprint-<version>/`, un cas dans
  `test/weasyprint-patch-check.py`, un dossier dans `image/patches/amont/`.
