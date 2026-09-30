# Limites d'accessibilité connues

Ce que les sorties de Pronto ne garantissent **pas** encore, format par format. Un `PASS`
de veraPDF ne dit pas qu'un PDF est accessible : il dit que les conditions vérifiables par
machine de PDF/UA-1 sont tenues. Ce document tient la liste du reste — ce qui est connu,
mesuré ou non, et qui en décide.

État au 30.09.2026, branche `a11y-corrections` (sur la version 2.6.1).

## Comment lire ce document

Chaque point porte :

- **Norme** — la clause ou le critère en cause : PDF/UA-1 (ISO 14289-1), le protocole
  Matterhorn 1.1 (les conditions d'échec de PDF/UA-1), WCAG 2.2, EPUB Accessibility 1.1.
- **Gravité** — *majeure* (une information n'atteint pas un lecteur d'écran, ou lui arrive
  fausse), *moyenne* (elle arrive, mais mal placée ou mal annoncée), *mineure* (gêne,
  métadonnée, confort).
- **Origine** — WeasyPrint, pandoc, la maquette de Pronto, ou le contenu (le texte déposé).
- **Statut** — *accepté* (décision prise de vivre avec), *en attente de l'amont* (seul un
  correctif de WeasyPrint ou de pandoc le lèvera), *à corriger* (dans Pronto).
- **Preuve** — la mesure, ou « non mesuré ».

Les mesures viennent du corpus d'audit (`szh-revue-layout-leger/audit-a11y/`, sept articles :
deux articles réels du numéro 4/2017 et cinq articles d'essai) compilé par la chaîne réelle,
dans la WSL `SZH-Publishing` (pandoc 3.7.0.2, WeasyPrint 70.0, veraPDF). Les sept PDF sont
conformes au profil PDF/UA-1 de veraPDF. Les outils : `arbre.py` (arbre de structure et texte
de chaque MCID), `document.py` (catalogue, XMP, signets, annotations), `contraste.py`
(contraste APCA mesuré dans le PDF rendu).

**Correctifs WeasyPrint en cours de déploiement.** La version 2.6.0 livre trois correctifs
(`image/patches/weasyprint-70.0/`) : 10 (tableaux et images décoratives), 20 (césure et fin
de ligne), 30 (en-têtes et pieds de page en artefact). Ils ne sont pas encore sur tous les
postes. Les mesures ci-dessous sont celles du WeasyPrint installé (correctif 10 seul) ; les
corrections du 30.09.2026 ont été revérifiées avec les trois, sur une copie patchée : mêmes
résultats.

---

## 1. PDF d'article (revue)

La sortie `out/<slug>/<slug>.pdf`, balisée PDF/UA-1 par WeasyPrint, galley PDF de l'export
OJS.

### 1.1 Les notes de bas de page ne sont pas des notes

- **Constat.** Le texte d'une note est balisé à l'endroit de son appel, au milieu de la
  phrase : un lecteur d'écran lit la note entière entre deux mots du paragraphe, et coupe la
  phrase en deux. Aucun élément `/Note`.
- **Norme.** PDF/UA-1 §7.9 ; Matterhorn, point de contrôle 19 (notes et références).
- **Gravité.** Majeure.
- **Origine.** WeasyPrint (`float: footnote` ne produit pas de `/Note`), maquette (les notes
  sont des `float: footnote`).
- **Statut.** Accepté, décision de Robin (30.09.2026) : pas de patch.
- **Preuve.** `/Note` : 0 dans les sept PDF ; les notes de l'article 09 sont toutes lues dans
  leur paragraphe.

### 1.2 Aucune langue d'élément

- **Constat.** Un résumé allemand dans un article français, une citation `lang=de`, un mot
  `[inclusive education]{lang=en}` : le HTML porte la langue, le PDF la perd. Seul le
  catalogue a un `/Lang`. Un lecteur d'écran lit tout avec la voix de l'article.
- **Norme.** PDF/UA-1 §7.2 ; Matterhorn, point de contrôle 11 ; WCAG 3.1.2 (langue d'un passage). veraPDF ne peut pas le voir :
  un `/Lang` de catalogue satisfait sa règle (voir [MAINTENANCE.md](MAINTENANCE.md), « Un
  passage en langue seconde n'est pas annoncé comme tel »).
- **Gravité.** Majeure.
- **Origine.** WeasyPrint : `pdf/tags.py` n'écrit jamais `/Lang` ; les deux seules
  occurrences du paquet posent celle du catalogue. Aucun attribut HTML ni aucune propriété
  CSS ne l'atteint : il n'existe pas de voie sans patch (cherché le 30.09.2026).
- **Statut.** En attente de l'amont ; patch écarté par Robin.
- **Preuve.** Éléments de structure avec `/Lang` : 0 dans les sept PDF, pour 2 à 5 attributs
  `lang` internes dans chaque HTML.

### 1.3 Légende hors de la figure, boîte en pixels CSS

- **Constat.** La légende d'une figure est un `/Caption` voisin de la `/Figure`, et non son
  enfant ; la `/BBox` de la figure est en pixels CSS, pas en points.
- **Norme.** PDF/UA-1 §7.3 ; Matterhorn, point de contrôle 13 ; ISO 32000-1, attribut `BBox`
  (unités de l'espace utilisateur).
- **Gravité.** Moyenne.
- **Origine.** WeasyPrint.
- **Statut.** En attente de l'amont, décision de Robin.
- **Preuve.** 13 `/Caption` hors `/Figure` ou `/Table` dans les sept PDF ; 17 `/Figure`, toutes
  avec une `/BBox`.

### 1.4 Un paragraphe coupé par la page devient deux paragraphes

- **Constat.** WeasyPrint bâtit l'arbre de structure page par page : un paragraphe à cheval
  sur deux pages donne deux `/P`. La lecture continue, mais la navigation par paragraphe
  s'arrête au milieu d'une phrase.
- **Norme.** PDF/UA-1 §7.1 (structure logique fidèle au document).
- **Gravité.** Mineure.
- **Origine.** WeasyPrint (`pdf/tags.py`, un arbre par page).
- **Statut.** Accepté. Pas corrigeable dans Pronto : seul `break-inside: avoid` sur les
  paragraphes l'éviterait, au prix de toute la mise en page.
- **Preuve.** Estimation (dernier `/P` d'une page sans ponctuation finale, suivi d'un `/P` à
  la page suivante) : environ 13 cas dans les sept PDF.

### 1.5 Un lien qui passe à la ligne devient deux liens

- **Constat.** Une adresse ou un appel de citation coupé en fin de ligne produit deux
  annotations et deux éléments `/Link` : « (Plaisance, Belmont, Verillon, & » puis
  « Schneider, 2007) ». Le lecteur d'écran annonce deux liens.
- **Norme.** PDF/UA-1 §7.18 ; Matterhorn, point de contrôle 28 ; WCAG 2.4.4.
- **Gravité.** Mineure.
- **Origine.** WeasyPrint (une annotation par boîte de ligne).
- **Statut.** En attente de l'amont.
- **Preuve.** 9 paires dans les sept PDF.

### 1.6 Le texte de remplacement d'un lien interne est son identifiant

- **Constat.** Le `/Contents` d'un lien est son adresse : pour un lien interne, l'identifiant
  du fragment (« ref-plaisance-2007 », « appel-ref-rey-2016 »). Ni `aria-label` ni `title`
  ne sont lus. Le texte du lien, lui, est bien dans l'élément `/Link` et c'est lui que les
  lecteurs d'écran annoncent d'abord.
- **Norme.** PDF/UA-1 §7.18.5 (la présence de `/Contents` est tenue, pas sa pertinence) ;
  WCAG 2.4.4.
- **Gravité.** Mineure.
- **Origine.** WeasyPrint : `pdf/anchors.py`, `add_links`, écrit `Contents = link_target`
  sans regarder l'élément. Un patch lirait `aria-label`, puis `title`, puis le texte de
  l'élément `<a>` (`box.element`) avant de retomber sur la cible.
- **Statut.** En attente d'une décision (patch non écrit).
- **Preuve.** Les 36 liens internes de l'article 09 ; essai minimal : `title` et
  `aria-label` donnent tous deux `/Contents` = « cible ».

### 1.7 L'exergue est lue deux fois

- **Constat.** La citation mise en exergue est lue à sa place dans le texte et une seconde
  fois dans l'exergue.
- **Norme.** WCAG 1.3.2 (ordre de lecture pertinent).
- **Gravité.** Mineure.
- **Origine.** Maquette.
- **Statut.** Accepté, décision du 23.09.2026.
- **Preuve.** Voir la décision ; non remesuré ici.

### 1.8 Une figure de données déclarée décorative se tait sans avertissement

- **Constat.** `![légende](media/…){alt=""}` fait de l'image un décor : un fond CSS, donc un
  artefact, hors de l'arbre. La légende « Figure 1 — … » reste, l'image se tait. C'est la
  convention du cockpit (« image purement décorative ») ; un outil d'extraction qui écrit
  `alt=""` partout la détourne, et aucun contrôle ne le dit.
- **Norme.** WCAG 1.1.1 ; PDF/UA-1 §7.3.
- **Gravité.** Majeure pour le contenu touché.
- **Origine.** Contenu (articles 05 et 09 du 4/2017, extraits par
  `szh-old-journals-parser`) et règle de Pronto.
- **Statut.** À corriger : règle proposée, non implémentée (voir le rapport de la branche) —
  une figure **numérotée** (légende non vide) et `alt=""` est contradictoire, et devrait
  lever un avertissement dans les Contrôles.
- **Preuve.** Articles 05 et 09 : la figure est un `span.szh-decor`, aucune `/Figure` dans le
  PDF, aucun constat au journal.

### 1.9 Métadonnées XMP : pas de `dc:language`

- **Constat.** La langue du document est dans le catalogue (`/Lang`), pas dans le XMP.
- **Norme.** Aucune exigence de PDF/UA-1 ; bonne pratique Dublin Core.
- **Gravité.** Mineure.
- **Origine.** WeasyPrint (`pdf/metadata.py` n'écrit pas la langue qu'il connaît).
- **Statut.** En attente de l'amont. L'option `--xmp-metadata` a été essayée : veraPDF
  passe, mais elle ajoute un second `rdf:RDF` à côté du premier, ce que la norme XMP
  interdit ; pypdf ne lit pas la langue ainsi posée. Non retenue.
- **Preuve.** `dc:language` absent des sept XMP.

### 1.10 Ce qu'une machine ne sait pas juger

- **Constat.** Pertinence des textes alternatifs, ordre de lecture réel, titres qui
  décrivent leur section, sens porté par la seule couleur, lisibilité d'un tableau complexe
  lu cellule par cellule : les conditions de Matterhorn à contrôle humain n'ont pas été
  passées. Aucun essai avec un lecteur d'écran réel (NVDA, JAWS, VoiceOver).
- **Norme.** Matterhorn 1.1, conditions « human ».
- **Gravité.** Inconnue.
- **Statut.** À faire.
- **Preuve.** Non mesuré.

### 1.11 Détails restants, mineurs

- La puce d'une liste est un vrai `/Lbl` depuis le 30.09.2026 ; elle contient le caractère
  ▸, qu'un lecteur d'écran peut prononcer (« triangle… ») au lieu de « puce ». Un
  `/ActualText` l'éviterait, et WeasyPrint n'en écrit pas. Accepté.
- La description longue d'un tableau (`data-alt`) est dans l'arbre depuis le 30.09.2026,
  en `/Div` juste après le `/Table` : elle se lit comme un paragraphe qui suit, sans lien
  avec le tableau. `/Summary` ou `/Alt` sur un `/Table` : WeasyPrint n'en écrit jamais.
  En attente de l'amont.
- Le « N° » et le point médian de la ligne « VOL. 7 · N° 4/2017 » de la couverture sont du
  texte, lu tel quel. Mineur, accepté.
- Profils plus stricts que PDF/UA-1 (PDF/UA-2, WTPDF) : non visés. veraPDF y relève
  notamment des `/Span` enfants directs de `/Document` et de `/Sect`, et les `/Caption`
  du §1.3.

### Corrigé le 30.09.2026 (branche `a11y-corrections`)

Liens DOI et licence de la couverture non cliquables ; signets et `/Title` du titre en
escalier (mots collés, retour à la ligne) ; listes sans `/Lbl` ; description longue des
tableaux absente ; point médian entre auteur·e·s lu comme du texte ; appel de note à Lc 87
dans un encadré ; espaces françaises dans un passage allemand (règles typographiques par
langue de passage). Le détail et les mesures sont dans les messages de commit.

---

## 2. HTML autonome (galley HTML de l'export OJS)

La sortie `out/<slug>/<slug>.html` : source de WeasyPrint, et galley HTML de l'export OJS.
Mesuré en lisant le balisage des sept articles (script d'analyse HTML), sans navigateur
d'aide technique.

**Ce qui tient, mesuré.** `lang` sur `<html>` (7/7) ; `<title>` non vide (7/7) ; toutes les
`<img>` ont un `alt` non vide (17 images) ; les images décoratives sont des fonds CSS ; un
seul `<h1>` et aucun saut de niveau de titre ; tous les `<th>` ont un `scope` ; le tableau à
description longue porte `aria-describedby` ; tous les liens ont un nom (les liens de retour
sans texte portent un `aria-label`) ; les passages en autre langue gardent leur `lang`.

### 2.1 Les notes sont au fil du texte

- **Constat.** Une note est un `<span class="szh-note">` à l'endroit de l'appel, sans rôle ni
  lien : lue au milieu de la phrase, comme dans le PDF (§1.1).
- **Norme.** WCAG 1.3.1.
- **Gravité.** Majeure.
- **Origine.** Maquette (le balisage des notes sert d'abord le `float: footnote` du PDF).
- **Statut.** À corriger quand la sortie web propre existera (docs/SORTIES.md, « Demain »).
- **Preuve.** Balisage lu ; non essayé avec un lecteur d'écran.

### 2.2 Figure de données déclarée décorative

Même constat qu'au §1.8 : la figure des articles 05 et 09 est un fond CSS, sans texte
alternatif. Gravité majeure pour ce contenu ; à corriger (le galley Word, lui, la rend
depuis le 30.09.2026, §3).

### 2.3 Non mesuré

Rendu et contraste à l'écran (la feuille est `print.css`, pensée pour la page A4), zoom et
redistribution à 400 % (WCAG 1.4.10), navigation au clavier, validateurs automatiques (axe,
WAVE, Nu Html Checker), lecteur d'écran réel. Pas de repère `<main>` : sans objet tant que le
site injecte le contenu dans sa propre page (docs/SORTIES.md), à revoir sinon.

---

## 3. DOCX (galley Word de l'export OJS)

La sortie `out/<slug>/<slug>.docx` (cible `docx`), tirée du HTML autonome par pandoc et
`szh-galley-docx.lua`. Pronto ne produit pas de galley ODT : l'ODT n'est qu'un format
d'entrée et de gabarit.

**Ce qui tient, mesuré** (XML des huit DOCX du corpus d'audit et de l'article d'essai
`galee-essai` : notes multiples, tableau importé à `colspan`/`rowspan`, figure légendée à
`alt=""`, décor ; relus aussi convertis en PDF par LibreOffice). Langue sur les passages
(`w:lang` fr, de, en) ; titres en styles `Title` et `Heading 1-5` ; titre du document dans
les propriétés ; liens actifs ; toutes les images ont une description (`descr`).

### Corrigé le 30.09.2026

- **Notes.** Chaque note du HTML (`span.szh-note`, pour `float: footnote`) redevient une vraie
  note de bas de page Word, à l'endroit de l'appel, italique et liens compris, y compris
  dans une légende et dans une cellule de tableau. Notes Word : 0 → 23 sur le corpus, autant
  que de notes dans les `.md`, texte identique ; plus aucun texte de note dans le corps
  (23 → 0).
- **Figures légendées.** Une figure qui a une légende n'est plus un décor dans le galley :
  elle retrouve son image, décrite par sa légende (« Figure 1 — … », sans les notes qu'elle
  porte). Articles 05, 09 et `galee-essai` : 0 → 1 image. Le PDF n'est pas concerné.
- **En-têtes de tableau** — rien à corriger. Les 6 tableaux Word sans `w:tblHeader` ont été
  recoupés un par un avec leur source : 5 sont des tableaux de mise en page que pandoc écrit
  pour une figure (style `FigureTable` ; 2 ont disparu avec le point précédent), le 6ᵉ est
  `lecteur-ecran/tables/table-02.html`, sans rangée d'en-tête dans la source, à dessein.
  Tous les tableaux de données à `<thead>` ont leur ligne d'en-tête répétée ; un en-tête
  importé sur deux rangées, avec `colspan` et `rowspan`, garde ses deux lignes d'en-tête et
  ses fusions (`w:gridSpan`, `w:vMerge`).

### 3.1 Une note de plusieurs paragraphes arrive en un seul

- **Constat.** `szh-notes.lua` joint les paragraphes d'une note par une espace dans le HTML
  (la zone `@footnote` du PDF n'en compose qu'un) ; le galley ne peut pas retrouver une
  coupure que le HTML ne porte plus.
- **Norme.** WCAG 1.3.1.
- **Gravité.** Mineure.
- **Origine.** Chaîne (le galley est tiré du HTML final, pas du `.md`).
- **Statut.** Accepté.
- **Preuve.** `galee-essai`, note 3 : deux paragraphes dans le `.md`, un dans le Word.

### 3.2 Les vrais décors restent absents

- **Constat.** Une image sans légende déclarée décorative (`alt=""`) n'est pas dans le Word.
  pandoc ne sait pas écrire la marque « décorative » de Word (extension `adec:decorative`),
  et une image insérée sans description serait signalée par le vérificateur de Word.
- **Norme.** WCAG 1.1.1 (un décor n'a pas à être perçu).
- **Gravité.** Mineure (aucune information perdue par construction).
- **Origine.** pandoc.
- **Statut.** Accepté.
- **Preuve.** Les 3 décors sans légende du corpus (`figures`, `lecteur-ecran`,
  `galee-essai`) : absents, un paragraphe vide à leur place.

### 3.3 Non mesuré

Vérificateur d'accessibilité de Word, ordre de lecture dans Word, texte alternatif des
tableaux.

---

## 4. Livre

Sorties du profil livre (docs/SORTIES.md, « Ce que produit un livre »), mesurées sur
`test/livre-normal`.

### 4.1 PDF numérique

Conforme au profil PDF/UA-1 de veraPDF. Les limites 1.1 à 1.7, 1.9 et 1.10 du PDF d'article
valent aussi : même moteur. Les listes du livre ont leurs marqueurs natifs, déjà en `/Lbl`.
En plus :

- les entrées du sommaire sont des `/LI` sans `/Lbl`, et chacune contient un `/Link` imbriqué
  dans un autre (le titre, puis le folio). Mineur, origine maquette et WeasyPrint ; à
  examiner.

### 4.2 PDF imprimeur

Pas un livrable d'accessibilité (fichier d'impression). Observé le 30.09.2026 : sur
`test/livre-normal`, WeasyPrint échoue (`AssertionError` dans `resolve_math`, un `calc()`
de largeur), déjà sur la version 2.6.1 sans les changements de cette branche. À instruire à
part.

### 4.3 Couverture à plat

Conforme au profil PDF/UA-1 de veraPDF. Rien d'autre de mesuré.

### 4.4 EPUB 3

- **Mesuré.** `dc:language` = de ; les neuf documents XHTML portent `lang` ; images avec
  `alt` (4/4) ; métadonnées d'accessibilité présentes (`accessMode`,
  `accessModeSufficient`, `accessibilityFeature`, `accessibilityHazard`).
- **Manque.** Aucune déclaration de conformité (`dcterms:conformsTo`, EPUB Accessibility
  1.1, déclaration de conformité), pas de `accessibilitySummary`, pas de liste des pages (`page-list`), alors qu'une
  édition imprimée existe (EPUB Accessibility 1.1, repères de pagination). Gravité mineure à
  moyenne ; origine chaîne EPUB du livre ; à corriger.
- **Non mesuré.** EPUBCheck et Ace (DAISY) ne sont pas dans l'image WSL.

### 4.5 HTML web du livre

- **Mesuré.** `lang`, `<title>`, `alt` de toutes les images, aucun saut de niveau de titre,
  `scope` sur tous les `<th>`, liens nommés. Un `<h1>` par chapitre (5) dans une seule page.
- **Non mesuré.** Comme au §2.3.

---

## 5. Hors périmètre

L'aperçu du cockpit (`*.apercu.html`) n'est jamais publié. Les exports de métadonnées (OJS,
secrétariat, Kirby) ne sont pas des documents de lecture.
