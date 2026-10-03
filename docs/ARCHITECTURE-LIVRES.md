# Le moteur livre

Comment Pronto fabrique un livre : le dossier, la chaîne de compilation, les sorties, les deux
maquettes et ce que le cockpit en montre. Il se lit avec [`ARCHITECTURE.md`](ARCHITECTURE.md),
qui situe le livre parmi les trois produits, et [`SORTIES.md`](SORTIES.md), qui décrit la pile
de feuilles de style. Ce qui reste à faire est dans [`TODO/livres.md`](TODO/livres.md).

---

## 1. Un livre, pour la chaîne

Un livre et un numéro de revue sont le même objet : un dossier qui porte un fichier de
configuration, une suite ordonnée d'unités de texte, chacune avec sa fiche, ses images et
ses tableaux, et un dossier de sorties. La maquette et le vocabulaire diffèrent, la
mécanique non : l'import Word, le gestionnaire de médias, l'éditeur de tableaux, la
typographie maison, les portraits, la co-édition, les verrous, les copies en conflit et
l'accessibilité PDF/UA ne savent pas si le texte est un article ou un chapitre.

D'où la seule règle du moteur : **un chapitre se compile comme un article**. Même `cd` dans
son dossier, même socle de filtres, même `--embed-resources`. Seul le gabarit diffère : un
chapitre sort un fragment HTML, que `livre-assembler.py` colle ensuite dans le livre.

Un dossier est un livre parce qu'il porte `buch.yaml`, et pour aucune autre raison :
`pipeline/Makefile` inclut alors `pipeline/profils/livre.mk`, et le cockpit choisit le
profil `livre`. Les deux côtés tranchent pour le livre si un dossier porte les deux fichiers.

## 2. Ce que le livre partage, ce qu'il ajoute

| | Partagé avec la revue | Propre au livre |
|---|---|---|
| Filtres | le socle de `filtres.mk`, dans le même ordre | `szh-livre-titre`, `szh-sauts-uniques`, `szh-livre-sous-titre` (deux fois, avant et après la typographie), `szh-livre-entete-image`, `szh-livre-auteurs`, `szh-livre-entete`, `szh-qr` |
| Filtres absents | — | `szh-maquette`, `szh-titre-lignes`, `szh-auteurs`, `szh-ressource`, `szh-rubrique` |
| Filtres lus autrement | `szh-niveaux` laisse le `<h1>` du chapitre en place ; `szh-numerotation` numérote en continu sur le volume (`SZH_COMPTEURS`) ; `szh-sections` préfixe par le numéro du chapitre | |
| Recettes | l'import Word (`UNITES_DIR`, `WORD_DIR`), `define weasy_ua`, la porte PDF/UA | `profils/livre.mk`, `define contexte_chapitre` |
| Python | `szh_commun.py`, l'import | `livre-assembler.py`, `livre-epub-prepare.py`, `livre-scinder.py`, `livre-migrer-meta.py`, `couverture.py`, `cmjn.py`, `liens-courts.py` |
| Styles | `socle.css`, `partage-filtres.css`, la couleur annuelle | `styles/livre/` : `base.css`, `normal.css`, `falc.css`, `imprimeur.css`, `couverture.css`, `web.css`, `epub.css` |
| Gabarits | — | `szh-livre.html`, `szh-livre-chapitre.html`, `szh-livre-liminaire.html`, `szh-couverture.html` |

L'en-tête de `pipeline/filtres.mk` donne la raison de chaque écart de chaîne. Une règle de
composant émise par un filtre partagé vit dans `partage-filtres.css`, jamais dans une feuille
propre au livre.

---

## 3. Le dossier d'un livre

```
2026-B330-Canonica-Teilhabe/
  buch.yaml                       métadonnées de l'ouvrage
  BIENVENUE.md
  chapitres/
    01-einleitung/
      01-einleitung.md            le corps, sans titre
      01-einleitung.meta.yaml     la fiche : titre, sous-titre, auteur·e·s, résumé
      media/                      images, comme un article
      tables/                     tableaux extraits, comme un article
  chapitres-word/                 dépôt des .docx à convertir
  liminaires/
    avant-propos.md               pièces liminaires et pièces de fin écrites à la main
    media/                        leurs images (portraits des notices)
  parties/                        illustrations des parties (facultatif)
  impressum/                      logos de l'impressum (facultatif)
  couverture/
    illustration.jpg
    quatrieme.md                  texte de 4e de couverture
  styles/
    livre.css                     surcharge propre au livre, facultative (PDF et imprimeur)
  out/
    <livre>.pdf                   PDF numérique (RVB, PDF/UA-1, signets)
    <livre>-imprimeur.pdf         PDF imprimeur (fond perdu, traits de coupe, CMJN si profil)
    <livre>-couverture-impression.pdf  couverture à plat 4e + dos + 1re (PDF/X-4, CMJN)
    <livre>-couverture.pdf        1re puis 4e, pour l'écran (RVB, PDF/UA-1)
    <livre>-couverture-1.png      1re de couverture, 300 dpi (aussi l'image de l'EPUB)
    <livre>-couverture-4.png      4e de couverture, 300 dpi
    <livre>-dos.json              le dos : pages lues, mm, grammage, source du chiffre
    <livre>.epub                  EPUB 3
    chapitres/<slug>.pdf          un chapitre seul
    chapitres/<slug>.apercu.html  l'aperçu cliquable d'un chapitre
    web/<livre>.html              HTML pour l'écran
```

`chapitres/<slug>/<slug>.md` est volontairement homonyme d'`articles/<slug>/<slug>.md` :
c'est ce qui rend les médias, l'éditeur de tableaux, l'import et les filtres utilisables
sans une ligne de plus. Le nom du dossier d'un livre ne doit pas contenir d'espace : les
fonctions de chemin de make découpent sur les blancs, et un garde-fou refuse le cas.

### `buch.yaml`

```yaml
titre: "Berufliche Teilhabe von Erwachsenen mit dem Asperger-Syndrom"
sous-titre: "Strategien von Arbeitnehmer:innen und Arbeitgeber:innen"
ouvrage: monographie       # monographie | collectif : décide où vivent les auteur·e·s
lang: de                   # langue du texte, lue par szh-contexte.lua
maquette: normal           # normal | falc
format: standard           # standard (155 × 225) | a4 (210 × 297, FALC seulement)
collection: "Sonderpädagogische Forschung in der Schweiz"
tome: "6"
annee: 2025
isbn-print: "978-3-905890-96-9"
isbn-ebook: "978-3-905890-95-2"
doi: "10.57161/b327"
licence: cc-by-nc-nd-4.0
couleur: "#5F9FBC"          # couleur numérique (PDF écran, EPUB, web)
couleur-impression: bleu-acier  # clé de styles/couleurs-reference.json : couverture
couverture:
  modele: classique        # falc | classique | recherche | prospectrum ; vide : selon la maquette
  fond: bleu-acier         # clé de couleurs-reference.json ; vide : celle du modèle
  fond-teinte: 9           # % de cette couleur ; vide : celle du modèle
  illustration-plein:      # classique : true = illustration plein cadre en bas de la 1re
  titre-2:                 # prospectrum : titre dans la langue voisine (fr ↔ de)
  sous-titre-2:
  illustration-x-mm: 0     # décalage de couverture/illustration.*, + vers la droite
  illustration-y-mm: 0     # + vers le bas ; coupé au fond perdu du plat de 1re
auteurs: []                # monographie : ici ; collectif : dans chaque chapitre
editeurs: []               # collectif : « Prénom Nom, … (Hrsg.) » sur le demi-titre et la page de titre
ordre-chapitres: []        # vide : l'ordre des dossiers
liminaires: [demi-titre, impressum, page-titre, dedicace, sommaire, avant-propos.md]
dedicace: "Für A, B, C,//D und E"   # le jeton dedicace des liminaires ; « // » = saut de ligne
parties:                   # maquette normal ; absent : pas de parties
- titre: "Grundlagen"      # « // » = saut de ligne
  numero: "1"              # texte libre ("1", "III"), ou absent
  chapitres: [01-a, 02-b]  # une suite contiguë de l'ordre des chapitres
  page-seule: oui          # oui (défaut) : page de partie sur un recto, verso blanc ;
                           # non : le titre ouvre la page du premier chapitre
  numeroter: oui           # avec numeros-chapitres: partie, « 1.1 », « 1.2 »… (défaut non)
  illustration: parties/x.png   # page seule seulement ; illustration-alt facultatif
pieces-fin: [autorinnen.md]  # .md de liminaires/, après le dernier chapitre, au sommaire
impressum:                 # maquette normal, chaque sous-clé facultative
  logo-soutien: impressum/fondation.svg
  logo-soutien-alt: "Logo de la fondation"   # sans -alt : image décorative
  logo-soutien-hauteur-mm: 8.7   # hauteur du logo, de 4 à 30 mm ; absente : 15,6 mm
  soutien: "Avec le soutien de …"
  credits: "Layout: …//Lektorat: …"
  responsabilite: oui      # la phrase standard de la langue
  reserve: "…"
  imprimeur: "…"
  logos-imprimeur: [impressum/a.svg, impressum/b.svg]   # logos-imprimeur-alt : liste
mise-en-page:              # maquette normal : voir § 5.1
  sommaire-page: verso
impression:
  grammage: 90             # g/m² du papier intérieur
  main: 1.27               # volume du papier intérieur
  couverture-volume: 1.3
  couverture-grammage:     # vide : 250 sous 20 mm de dos, 300 au-delà
  colle-mm: 0
  dos-mm:                  # imposé par l'imprimeur : gagne toujours
  fond-perdu-mm: 3
  traits-de-coupe: true
  profil-cmjn: "PSOuncoated_v3_FOGRA52.icc"   # dans /opt/icc/ de l'image
locked: false
archived: false
version-toolkit: ""
```

**Monographie ou ouvrage collectif.** La clé s'appelle `ouvrage` et non `type` : `type` est
la rubrique d'un article, et pandoc fusionne les métadonnées en laissant gagner la dernière ;
le `type: article` d'un chapitre importé aurait effacé celui du livre. En monographie, les
auteur·e·s sont dans `buch.yaml` et s'impriment sur la couverture et la page de titre. En
collectif, chaque fiche porte les siens (clé `author`, le schéma d'auteur à sept champs des
articles), imprimés sous le titre du chapitre. Un chapitre n'hérite jamais des `auteurs` du
livre : le filtre ne lit que `author`.

**Le titre et les auteur·e·s d'un chapitre sont dans sa fiche, pas dans son `.md`.**
`<slug>.meta.yaml` porte `title` et `subtitle` (une entrée par langue) et `author`.
`szh-livre-titre.lua`, en tête de chaîne, pose le `<h1>` comme si le rédacteur avait écrit
`# Titre` ; `szh-livre-sous-titre.lua` et `szh-livre-auteurs.lua` posent la suite, dans
l'ordre titre, sous-titre, auteur·e·s, encadré `falc-header`. Un `.md` qui porte encore son
`# Titre` le garde, sans doublon. `livre-migrer-meta.py <livre> [--simuler]` range titre et
auteur·e·s d'un ancien chapitre dans sa fiche, sans jamais écraser une valeur ; l'import Word
d'un chapitre et `livre-scinder.py` font de même.

**Clés de fiche propres au chapitre :**

- `sommaire: non` retire le chapitre du sommaire : ni pastille numérotée, ni marque de
  tranche, ni entrée. Il compile à sa place (pagination, compteurs, rang inchangés) ; les
  autres chapitres se numérotent sans trou, et l'index à pouce se repartage entre eux
  (`profils/livre.mk`, § « Index à pouce »).
- `picto-entete: ecouter` pose un picto de lecture audio au coin extérieur de chaque page du
  chapitre, par le même running element que l'onglet de tranche (`szh-livre-chapitre.html`,
  `styles/livre/base.css`).

**Blocs écrits dans le `.md` d'un chapitre :**

- **`falc-header`** : l'encadré « cette histoire existe aussi en audio », sur la première
  page du chapitre, sous le titre et les auteur·e·s, où qu'il soit écrit dans le fichier.

  ```
  :::: falc-header
  Diese Geschichte gibt es auch zum Hören.

  1. Scannen Sie den QR-Code.
  2. Hören Sie zu.

  ![Ein weisses Schnecken-Haus](media/escargot.jpg)

  ::: qr-link
  https://link.szh-csps.ch/BuchLS_03_audio
  :::
  ::::
  ```

  Texte facultatif (chaque ligne écrite est une ligne imprimée). Étapes facultatives : une
  liste numérotée devient un `<ol>` dont chaque numéro s'imprime en blanc dans une pastille
  ronde, au cran 800 de la couleur du chapitre (`PALETTE_CHAPITRE_FONCE`, `profils/livre.mk`),
  et le texte qui la précède devient son intitulé, en demi-gras, après le picto d'écoute.
  Image facultative dont
  l'alternative est obligatoire (sans elle, l'image est omise avec un avertissement), bloc
  `qr-link` facultatif. Filtre : `szh-livre-entete.lua`. Un bloc vide n'imprime rien ; de deux
  `falc-header`, seul le premier compte. Les deux cas sont signalés.

- **`qr-link`** : un QR cliquable, seul ou dans un `falc-header`.

  ```
  ::: {.qr-link tracked=false background=transparent color=#000000 size=25mm title="…"}
  https://exemple.ch/page
  :::
  ```

  `tracked` (défaut `true`) encode le lien court Shlink tiré du cache `liens-courts.yaml`,
  résolu avant la compilation par `liens-courts.py` quand `SZH_SHLINK_URL` et `SZH_SHLINK_CLE`
  sont posées ; sans elles, l'URL d'origine passe telle quelle, avec un avertissement par
  livre. `background`, `color` et `size` règlent le dessin ; `title` est le nom accessible
  (défaut « Lien vers : url »). La forme courte `[texte](url){.qr}` reste acceptée.
  Avertissements : contraste sous 3:1 entre `color` et `background`, couleur non noire dans le
  PDF imprimeur. Filtres : `szh-qr.lua`, construction dans `szh-qr-commun.lua`.

### Calcul du dos

La formule est celle du tableur de l'imprimeur (`Buchrueckenberechnung_2022_250_300_gm21.xlsx`,
feuille « Buchrückenberechnung Softcover ») :

```
dos (mm) = 4 × g_couv/2000 × vol_couv  +  pages × g_int/2000 × vol_int  +  colle
```

- `pages` est lu dans le PDF intérieur juste avant de composer la couverture, jamais saisi :
  un dos calculé sur un compte de pages périmé est le défaut le plus cher du métier ;
- `g_int`, `vol_int` : le papier intérieur, par défaut celui du tableur (90 g/m², volume 1,27) ;
- `g_couv`, `vol_couv` : la couverture, volume 1,3, en 250 ou 300 g/m² ;
- `colle` : l'épaisseur de colle au dos, 0 par défaut.

**Règle 250/300 g.** Le dos se calcule d'abord en 250 g ; s'il atteint 20 mm, la couverture
passe en 300 g et le dos se recalcule (un 300 g casse au pli d'un dos étroit). Quand
l'imprimeur impose le dos, `impression.dos-mm` gagne, et le grammage suit la même règle sauf
`couverture-grammage` explicite. `out/<livre>-dos.json` écrit le résultat et sa source. Le
code est `calculer_dos()` de `pipeline/couverture.py`, éprouvé par
`test/couverture-dos.test.py`. Recoupé sur le FALC A4 de 2026 : 134 pages, dos mesuré
8,26 mm, calculé 8,31 mm.

Le tableur écrit le volume intérieur 1,25 en dur dans son bloc 300 g, là où le bloc 250 g lit
1,27 dans sa table des papiers : on retient 1,27 dans les deux cas.

---

## 4. La chaîne de compilation

### 4.1 L'assemblage par fragments

Un filtre Lua ne peut pas réunir les chapitres : il travaille sur l'arbre d'une seule
invocation de pandoc, qui n'a qu'un dossier courant, alors que chaque chapitre a ses `media/`
et ses `tables/` (non préfixés par le slug : `table-01.html` partout). Le moteur procède donc
en trois temps :

1. chaque chapitre est compilé comme un article, `--standalone --embed-resources`, avec un
   gabarit qui ne sort que le corps : le fragment est autonome, aucun chemin relatif ne
   survit ;
2. `livre-assembler.py` relève les titres des fragments, compose les liminaires que la
   machine sait écrire (demi-titre, impressum, page de titre, dédicace, sommaire), pose les
   parties et les pièces de fin, bâtit le sommaire en liens internes et remplit l'enveloppe
   `szh-livre.html` ;
3. WeasyPrint pagine le tout, par `define weasy_ua`.

La compilation reste incrémentale par chapitre. `out/.szh-ordre-chapitres` rend l'ordre
explicite, pour qu'un chapitre retiré recompile les suivants ; `out/.szh-compteurs/` reporte
la numérotation des figures et des tableaux d'un chapitre au suivant, un jeu par sortie.
`ordre-chapitres` de `buch.yaml` place les slugs nommés en tête, les autres suivent par ordre
alphabétique ; un dossier préfixé « `_` » est une pièce de travail, jamais imprimée.

### 4.2 Les sorties

| Cible | Produit | Comment |
|---|---|---|
| `livre` (`Ctrl+S`) | PDF numérique et aperçus de chapitre | `livre-pdf` plus les `.apercu.html` |
| `livre-pdf` | PDF numérique | RVB, PDF/UA-1, signets, liens vivants, sans fond perdu ; seul PDF du livre jugé par la porte PDF/UA |
| `livre-imprimeur` | PDF imprimeur | `imprimeur.css` en plus (`bleed`, traits de coupe), puis conversion CMJN (§4.3) |
| `livre-couverture` | couverture | à plat `2 × largeur + dos` en PDF/X-4 CMJN ; 1re et 4e en PDF/UA-1 et PNG ; `-dos.json` |
| `livre-html-web` | HTML pour l'écran | `web.css`, feuilles incorporées |
| `livre-epub` | EPUB 3 | §4.5 |
| `livre-chapitre-pdf CHAPITRE=<slug>` | un chapitre seul | même chaîne, même rang, même couleur ; sans liminaires ; folios depuis 1 |

Un chapitre seul garde la numérotation des figures du dernier build complet : les autres
chapitres ne sont pas recompilés. Codes de sortie de `livre-chapitre-pdf` : 0 écrit,
1 compilation en échec, 2 `CHAPITRE` absent ou inconnu. Les tâches VSCodium « Livre : … »
(`vscodium-user/tasks.json`) et le panneau Export du cockpit appellent ces cibles.

### 4.3 Le CMJN

**La couverture** est composée en CMJN exact par `couverture.py`, sans Ghostscript ni
`cmjn.py` :

- le HTML d'impression ne porte que des `device-cmyk()` tirés de `couleurs-reference.json`
  (le CMJN du graphiste ; une teinte vaut t % de chaque encre), la version écran que leurs
  RVB ; jamais l'un n'est converti en l'autre ;
- WeasyPrint écrit le CMJN qu'on lui donne, y compris dans un SVG, et `device-cmyk(0 0 0 1)`
  est un noir K seul. Avec `--pdf-variant pdf/x-4` et un `@color-profile` (dont `components`
  est obligatoire), il pose un OutputIntent `/GTS_PDFX` ;
- les traits de coupe et de pli sont des éléments CSS en `device-cmyk(1 1 1 1)`, posés hors
  du fond perdu, et non `marks: crop`, que WeasyPrint trace en RVB ;
- l'illustration matricielle passe en JPEG CMJN par Pillow ImageCms (sRGB vers le profil
  d'impression, relatif colorimétrique, compensation du point noir) ;
- WeasyPrint borne la `BleedBox` à 10 pt : `couverture.py` la remet au fond perdu de
  `buch.yaml`, et refuse de livrer s'il reste un opérateur RVB ou une image RVB ;
- les PNG sortent de Ghostscript (`png16m`, 300 dpi), qui garde un RVB au pixel près ;
- une illustration transparente est aplatie après sa conversion, sur le CMJN exact du fond :
  aplatie sur le RVB, son fond converti sortait en rectangle visible sur l'aplat ;
- les bandeaux translucides du modèle recherche sont des `device-cmyk(… / α)` : WeasyPrint
  pose un `/ca` et, pour un groupe, un `/CS` ICCBased du profil d'impression, permis en
  PDF/X-4 (mesuré, aucun RVB).

**Les modèles de couverture.** `couverture.modele` choisit la mise en page de la couverture,
indépendamment de la maquette de l'intérieur, qui n'en décide que par défaut (`falc` pour un
livre FALC, `classique` sinon). Chacun est calqué sur une référence InDesign, mesurée en mm
depuis le coin du rogné de chaque plat :

| Modèle | Référence | Ce qui le distingue |
|---|---|---|
| `falc` | Créer ensemble… (FALC), 2025 | picto, bandeau à la couleur d'impression, chasse normale |
| `classique` | Teil- und Reintegration als Einzelfall?, 2026 | aplat pâle, titre et filet à la couleur d'impression, dos et bandes rouges, illustration détourée (ou plein cadre, `illustration-plein`, d'après Pelgrims 2021) |
| `recherche` | Menschen mit Lernschwierigkeiten auf Partnersuche (Sonderpädagogische Forschung in der Schweiz), 2023 | illustration plein cadre, bandeau de titre à la couleur d'impression à 68 %, bandeau de collection capucine à 85 %, collection en petites capitales |
| `prospectrum` | Die BRK in der Schweiz / La CDPH en Suisse, 2024 | fond arc-en-ciel (`pipeline/media/fonds/prospectrum.jpg`), panneaux à la couleur d'impression (`sapin`), titre second dans la langue voisine |

Le rouge du dos et le capucine du bandeau de collection sont fixés par le modèle ; tout vient
de `couleurs-reference.json`. Le sapin (90/60/65/53) y a été ajouté pour ProSpectrum : son CMJN
est celui de la référence, son RVB la conversion FOGRA52 → sRGB, faute de valeur du graphiste.
Le fond ProSpectrum est un maillage vectoriel dans la référence : il est livré en JPEG CMJN
300 dpi, rendu par Ghostscript (`tiff32nc`) depuis la source vectorielle, et passé en sRGB
par le profil pour les sorties écran. Un intertitre de 4e s'écrit au niveau 1 (`# Zum Buch`) :
un `##` sans `#` avant lui fait tomber le PDF écran en PDF/UA (règle 7.4.2-1).

**Précision du placement.** Les cotes de `couverture.css` sont relevées par extraction (boîtes
de glyphes, objets image, balayage du rendu) sur les références, et recalées jusqu'à 0,5 mm
au plus sur Buholzer, Hofer et ProSpectrum. Le dos de recherche est en SZH Condensed, comme
sa référence ; l'étirement à 105 % des titres ProSpectrum est rendu par l'approche ; le logo
d'édition est dimensionné sur son encre, dont son cadre SVG déborde de 0,7 mm ; les petites
capitales de collection sont composées à 70 % par `petites_capitales()`. Écarts assumés :
Pelgrims (2021) est en Frutiger et Celeste, non livrées, et ouvre sa 4e plus bas que
Buholzer ; les références divergent entre elles (symbole du dos, logo réduit de Hofer).

**L'intérieur** (`livre-imprimeur`) reste en hex dans ses feuilles, et `pipeline/cmjn.py` le
convertit en deux temps :

1. une passe sur le flux de contenu : le texte de labeur (un `rg` neutre et sombre suivi de
   `BT`) devient `0 0 0 1 k`, les couleurs de la maison leur CMJN chiffré, le blanc
   `0 0 0 0 k` ;
2. Ghostscript convertit le reste vers le profil (`-sColorConversionStrategy=CMYK`, qui laisse
   intact ce qui est déjà en `DeviceCMYK`). `--permit-file-read=<profil>.icc` est
   indispensable : en mode SAFER, Ghostscript refuse de lire le profil et échoue par un
   message (« /undefined in --runpdf-- ») qui ressemble à un PDF corrompu.

Sans la passe 1, le noir du texte sortirait en quadrichromie (`0.89 0.655 0.325 0.824 k`), et
aucune imprimerie n'accepte un texte de 10 pt en quatre couleurs : au moindre défaut de
repérage, les lettres frangent. `test/cmjn-check.py` vérifie texte K seul, couleurs de la
maison et absence de RVB ; `test/build-render.sh` le lance sur une copie du banc avec un
profil posé, et le saute si Ghostscript ou le profil manquent.

Ce que la passe ne garantit pas : une couleur qui n'est ni un neutre sombre de texte, ni une
couleur de la maison, ni le blanc, passe par la conversion ICC générique, sans CMJN chiffré ;
et le mécanisme n'a été mesuré qu'avec PSO Uncoated v3 (FOGRA52), le profil épinglé dans
`image/Containerfile`. Le profil ICC est une décision d'imprimeur, pas de logiciel : il reste
à reconfirmer avec l'imprimerie. Sans `profil-cmjn`, le PDF imprimeur sort en RVB, avec fond
perdu et traits de coupe ; avec un profil absent de l'image, la cible s'arrête plutôt que de
livrer un RVB qu'on croirait CMJN.

### 4.4 Le tableau qui décroche le balisage

Un `<table>` porteur d'une `<caption>` est mis en page dans une boîte enveloppe anonyme ;
quand elle se coupe entre légende et table, le baliseur de WeasyPrint s'arrête
(`ValueError: Table wrapper without a table`) et la cascade de `define weasy_ua` livre un PDF
non balisé. La condition tient à quelques millimètres, aucun test de contenu ne l'attrape.
`szh-tableau-boite.lua` enveloppe chaque tableau dans un vrai `Div`, et
`.szh-tableau-boite { break-inside: avoid; }`, dans `partage-filtres.css`, retire la
condition, pour la revue comme pour le livre. `epub.css` et `web.css` gardent leur propre
règle (défilement horizontal) : ce sont des sorties sans pagination. `test/build-render.sh`
refuse un PDF du banc livre sorti non balisé.

### 4.5 L'EPUB

`profils/livre.mk` compile chaque chapitre une seconde fois en fragment EPUB
(`CHAINE_CHAPITRE_EPUB`, le socle moins `szh-notes.lua` : le writer `epub3` de pandoc fait de
vraies notes de fin, liées, là où une note flottante en CSS se lirait au milieu de la
phrase). `livre-assembler.py` colle les fragments et écrit les métadonnées (`--metadonnees-epub`) ;
`livre-epub-prepare.py` prépare le HTML pour `pandoc --to=epub3 --split-level=1` :

- il retire les `<section class="szh-chapitre">`, utiles au PDF, invisibles pour un writer
  qui découpe aux `<h1>` ;
- il retire le `<div class="szh-onglet">` de tête de chapitre, que `--split-level=1` rangeait
  dans le fichier du chapitre précédent, créant un XHTML fantôme absent du sommaire ;
- il bascule en attributs `style=` le fond d'une image décorative, posé dans un `<style>` de
  corps que pandoc remonte vide dans le `<head>` : sans cela, l'image disparaissait ;
- il préfixe par le slug l'identifiant des descriptions longues de tableau, compté par
  chapitre, pour qu'un liminaire à tableau ne le duplique pas ;
- il retire de même les `<section class="szh-partie">` : le titre d'une partie devient un
  document de l'archive ;
- il passe sous le `<h1>` la ligne d'auteur·e·s posée au-dessus (`auteurs-chapitre: dessus`),
  qui serait sinon tombée dans le fichier du chapitre précédent.

L'archive contient les tableaux avec leur description longue et leurs `scope`, la
bibliographie et ses ancres (renommées `id_…` à l'identique par le writer XHTML), les images
extraites dans `EPUB/media/`, un `nav.xhtml` qui atteint chaque chapitre, et l'OPF avec
titre, langue et identifiant (l'ISBN e-book). L'archive embarque, dans l'ordre, le socle sans ses
`@font-face` (`out/.szh-socle-epub.css`, les polices n'étant pas dans l'archive), `epub.css` et
l'accent annuel : chaque `var(--x)` y a sa définition (`test/js/epub-jetons.test.js`). `test/epub-check.py`
contrôle la structure sans dépendance (mimetype, `container.xml`, manifeste, XHTML bien formés,
liens et images résolus, chaque document du *spine* atteint par `nav.xhtml`) ; il ne
remplace pas `epubcheck`, absent de l'image.

---

## 5. Les deux maquettes

### 5.1 « Normal »

Relevé sur deux livres imprimés, l'un de l'Edition SZH (Hofer/Buholzer, 2026), l'autre d'une
collection d'une haute école (HfH-Reihe, 2024) ; les défauts sont ceux de l'Edition SZH :

- 155 × 225 mm, pages en vis-à-vis ; justification de 115 mm (marges de 20 mm à l'intérieur
  et à l'extérieur) ; grille de 13,5 pt, première ligne de base à 20 mm du haut, dernière à
  201 mm, 39 lignes ;
- Open Sans SemiCondensed 10/13,5, la police de la revue, sans approche (la valeur qui
  apparie le plus de lignes avec les deux références, mesurée de 0 à 0,01 em) ; notes 8/10, légendes 10 pt,
  citations 8,5/12,25, impressum 7/9,6 ;
- texte justifié, césure active (au moins 2 lettres avant le tiret et 3 après), alinéa sauf
  après un titre ;
- un intertitre ou une figure en tête de page perd sa marge du dessus, même après une coupure
  forcée (`margin-break: discard`) ; le texte qui suit une citation reprend 9,5 mm sous sa
  dernière ligne, sur la grille pour une citation de 4 lignes ;
- légende : le crédit (« (© X | source) ») sur sa propre ligne, au corps et à l'encre de la
  légende ; un indice ou un exposant n'écarte pas l'interligne ; une figure à filets reprend le
  texte environ 9,6 mm sous son filet bas, un tableau zébré a des rangées de 6,45 mm ;
- page de titre : le titre à 48,6 mm, que les éditeurs tiennent sur une ligne ou sur deux ;
  impressum calé sur le bas de la page, son dernier bloc finissant à 185,6 mm ;
- pas de titre courant : le folio seul, Bold 8, ligne de base à 10 mm du bas, en pied de
  page extérieur ;
- chapitres ouverts sur la belle page ;
- liminaires : demi-titre, impressum, page de titre, dédicace, sommaire, pièces écrites.

**Le bloc `mise-en-page:`.** Ce qui distingue deux collections se règle dans `buch.yaml`. Les
clés, leurs valeurs, leurs défauts et les refus vivent dans un seul fichier,
`pipeline/livre/mise-en-page.json`, que lisent `livre-assembler.py` (validation, attributs
`data-*` et propriétés de `<html>`) et `szh-commun.lua` (`mise_en_page()`, pour
`szh-sections`, `szh-numerotation` et `szh-livre-auteurs`). Les règles CSS sont dans
`normal.css`, sous `html[data-<clé>="<valeur>"]`. Une clé ou une valeur inconnue arrête le
livre, en français et en allemand ; une maquette `falc` ignore le bloc entier. La table
ci-dessous le résume, le JSON fait foi.

| Clé | Valeurs (défaut en gras) | Effet |
|---|---|---|
| `folio` | **`sur-total`**, `seul` | « Seite 12 von 15 » ou « 12 » |
| `alinea-mm` | **4**, de 0 à 15 | alinéa des paragraphes |
| `liste-retrait-mm` | **4**, de 0 à 15 | position de la puce depuis la marge |
| `titre-chapitre` | **`grand`**, `courant` | Bold 16/21 ou Bold 10 en haut de page |
| `auteurs-chapitre` | **`dessus`**, `dessous` | auteur·e·s du chapitre avant ou après le titre, dans le DOM |
| `numeros-chapitres` | **`aucun`**, `continu`, `partie` | sans numéro, « 1 », ou « 1.1 » par partie |
| `numeros-sections` | **`aucun`**, `chapitre` | sans numéro, ou « 2.1 » |
| `intertitres` | **`gras`**, `demi-gras` | hiérarchie des h2 à h4 |
| `citation` | **`italique`**, `romain` | style des citations détachées |
| `legende` | **`dessus`**, `dessous` | place de la légende des figures, dans le DOM |
| `numeros-figures` | **`volume`**, `chapitre`, `aucun` | numérotation des figures et des tableaux |
| `cadre-figure` | **`aucun`**, `filets` | filets et aplat gris autour de l'image |
| `tableaux` | **`editeur`**, `zebre` | réglages de l'éditeur, ou tête bleue et rangées en alternance |
| `sommaire` | **`plat`**, `hierarchique` | graisses seules, ou retraits, numéros et auteur·e·s |
| `sommaire-page` | **`recto`**, `verso` | le sommaire s'ouvre en page impaire ou paire |
| `sommaire-niveaux` | **`1`**, `2` | chapitres seuls, ou aussi leurs intertitres de rang 2 |
| `titre-partie` | **`intercalaire`**, `titre` | ExtraBold 20 sans numéro, ou Bold 16/23 numéroté |
| `logo-page-titre` | **`oui`**, `non` | logo de l'éditeur en bas de la page de titre |

En maquette normal, le séparateur de légende est le deux-points (« Abbildung 1: Titel »).

**La structure.**

- *Parties* (`parties:`) : une `<section class="szh-partie">` sœur des chapitres, son titre
  un `<h1>` ; ses chapitres portent `data-partie` et passent au niveau 2 des signets.
  `page-seule: oui` pose la partie sur un recto suivi d'un verso blanc ; `non` la met en tête
  de la page de son premier chapitre, et le texte d'un chapitre sans titre la suit (un
  chapitre sans `title` n'a ni numéro ni entrée au sommaire). Les chapitres d'une partie se
  suivent dans l'ordre du livre, sans quoi le livre est refusé. Le numéro « 1.1 » est
  calculé une fois par `livre-assembler.py --numeros-chapitres`, que `profils/livre.mk`
  appelle et passe à chaque chapitre en `SZH_NUMERO_CHAPITRE` ; `szh-sections.lua` l'écrit.
- *Sommaire* : la partie au niveau 0, les chapitres au niveau 1, leurs intertitres au niveau
  2 avec `sommaire-niveaux: 2` ; la bibliographie n'y entre jamais ; un liminaire écrit qui
  suit le sommaire et chaque pièce de fin y entrent, sans numéro.
- *Pièces de fin* (`pieces-fin:`) : compilées comme les liminaires, chacune sur un recto.
  Deux mises en page de notices s'écrivent dans le `.md` : `::: notices` (un paragraphe par
  notice, le nom en `**Nom Prénom (Dr.):**`) et `::: {.notices .portraits}` (des `##` de
  groupe, puis des blocs `::: notice` : `![](media/x.png){.szh-hors-figure alt="…"}`, le nom
  en gras, la fonction, le courriel) en grille de trois colonnes. Une partie de notices
  s'écrit aussi comme un chapitre sans titre dans une partie (`page-seule: non`).
- *Dédicace* (`dedicace:` et le jeton `dedicace`) : centrée, sur un recto ; avant le sommaire
  elle n'a pas de folio, comme tout liminaire qui le précède.
- *Demi-titre* : en maquette normal, le titre y court d'un trait, ses « // » ne coupent que
  la page de titre ; le sous-titre se coupe au même endroit sur les deux pages.
- *Impressum* (`impressum:`) : l'ordre est fixe ; `logo-soutien-hauteur-mm` règle la hauteur
  du logo de soutien (refusée hors de 4 à 30 mm) ; une image sans `<clé>-alt` est décorative,
  rendue en fond CSS (une `/Figure` sans `/Alt` n'est pas conforme PDF/UA), comme le logo
  de l'éditeur sur la page de titre, dont le nom est déjà écrit à l'impressum. Sous la
  phrase de `licence:`, le bouton Creative Commons officiel (`media/logos/cc-*.svg`, 12,6 mm
  de haut, provenance dans `media/logos/README.md`) se pose de lui-même ; une licence connue
  sans bouton livré est refusée (`licence-badge-absent`). Pas de bouton en FALC. Le bouton est
  un lien vide vers l'acte de la licence (`ACTES_LICENCE`), à `aria-label`, et la phrase
  imprime l'adresse de cet acte sans « https:// », en normal comme en FALC : c'est l'URI que
  la *Trademark Policy* de Creative Commons exige à côté du bouton.
- *Éditeurs* : en ouvrage collectif, demi-titre et page de titre portent les `editeurs`
  suivis de « (Hrsg.) », « (éd.) » ou « (a cura di) », ou de `mention-editeurs` ; c'est la
  ligne de la couverture (`couverture.responsables`).

Une feuille `styles/livre.css` dans le dossier du livre, si elle existe, s'empile après
`normal.css` et `partage-filtres.css`, avant l'accent, dans le PDF numérique et le PDF
imprimeur : la voie des blocs propres à un livre (sections à saut de page, encadrés teintés).
Le HTML web et l'EPUB ne la lisent pas.

La fidélité est approchée : la charte varie d'un livre à l'autre, et ce qui varie (bandeaux de
personnages en marge, par exemple) n'est pas traité. Feuilles : `base.css` puis `normal.css`.

Limite connue de WeasyPrint 70, sans parade en CSS : quand la ligne qui respecte `orphans`
ne tient qu'en chassant une note déjà posée, il reporte la note à la page suivante, loin de
son appel ; et si la page de l'appel est refaite à une repagination (sommaire, renvois), la
note reportée peut sortir une seconde fois plus loin. Le remède est un correctif de
WeasyPrint.

### 5.2 FALC

Le modèle est le Prospectrum FALC (155 × 225 mm, Open Sans) ; le manuscrit Word « Créer
ensemble » donne le vocabulaire de styles.

| | FALC standard | FALC A4 |
|---|---|---|
| Format | 155 × 225 mm | 210 × 297 mm |
| Marges | 15 mm | 25 mm |
| En-tête, pied | 10 mm | 10 mm |
| Corps | 13 pt | 14 pt |
| Interligne | 1,2 | 1,3 |
| Espace après un paragraphe | 18 pt | 18 pt |
| Encre des titres | `#252B46` | `#252B46` |

Traits de charte : numéro de chapitre en pastille ronde à la couleur du chapitre ; onglet de
couleur en bord extérieur, qui descend de chapitre en chapitre (index à pouce) ; encadré gris
de résumé en tête de chapitre ; sommaire à filets avec la pastille de chaque chapitre ; une
phrase par ligne, donc le lecteur pandoc en `hard_line_breaks`, un texte au fer à gauche et
sans césure ; gras sur les mots-clés, listes numérotées courtes.

| Style Word | Écriture dans le `.md` | Rendu |
|---|---|---|
| `Titre1..4` | `title` de la fiche ; `##`, `###`, `####` dans le `.md` | titres, pastille sur celui du chapitre |
| `InfoBox` | `::: {.falc-resume}` | encadré gris de tête de chapitre |
| `InfoBox2` | `::: {.falc-encadre}` | encadré à filet |
| `Mis en évidence` | `::: {.falc-cle}` | paragraphe gras détaché |
| `Légende_Photo` | légende de figure | `szh-numerotation.lua` |
| `Liste étapes` | `::: {.falc-etapes}` | liste numérotée espacée |
| `Nom auteurs` | `author:` de la fiche, rangé par `livre-migrer-meta.py` | ligne d'auteur·e·s sous le titre |
| `Soustitre Projet` | `## …` + `{.falc-projet}` | sous-titre de projet |

Feuilles : `base.css` puis `falc.css`.

---

## 6. Le livre dans le cockpit et le lanceur

Le cockpit reste une seule extension. Le profil `livre` de `lib/profil.js` nomme `buch.yaml`,
`chapitres/`, `chapitres-word/`, la clé `ordre-chapitres`, la vue `szh.vueChapitres` et la
cible `livre`. Ses capacités propres sont `horsSommaire` (la case « hors sommaire » d'un
chapitre), `titreEnLignes` (le « // » d'un titre montré en lignes), `sortiesLivre` (imprimeur,
couverture, EPUB, web) et `paletteLivre` (en-tête FALC et QR dans la mise en forme) ; il n'a
pas les capacités de la revue (DOI, OJS, traductions, Documentation, pagination, réimport,
envoi à l'auteur…). Les libellés passent par `TP()`, qui prend la variante `.livre` d'une clé.

Ce qui existe côté livre : l'arbre des chapitres, le formulaire de l'ouvrage
(`media/metadata-book.*`, `buch.yaml`), les fiches de chapitre, l'aperçu HTML par chapitre, le
PDF d'un chapitre au clic, les quatre tâches de sortie dans le panneau Export, la palette
FALC et QR, le badge « déjà converti » sur un Word redéposé. Le formulaire des réglages
d'impression (grammage, main, fond perdu, profil CMJN, dos en lecture seule) n'existe pas
encore : ces clés se corrigent dans `buch.yaml`.

Dans le lanceur, le livre est l'onglet « Book » : entrée `livre` de `$SzhProduits`,
création par `new-livre.ps1`, dossiers `Books\` et `_Archive\Books\`
([`EMPLACEMENTS.md`](EMPLACEMENTS.md)).

## 7. Ce que le moteur refuse

- **MOBI.** Le format est mort (Amazon ne l'accepte plus, KindleGen n'est plus distribué) ;
  l'EPUB 3 suffit, et un `.azw3` se fabrique depuis lui hors chaîne.
- **Un éditeur visuel de couverture.** La couverture se compose en CSS depuis `couverture/`
  et se relit en PDF.
- **L'export OJS et le suivi de traduction d'un livre.** OJS publie des revues ; la
  traduction d'un livre est un autre livre, avec son ISBN.
- **Le réimport d'un chapitre corrigé.** `reimporter.py` reste propre aux articles ; le badge
  « déjà converti » rend visible un Word redéposé qui ne sera pas relu.
- **Un Makefile unique paramétré revue/livre**, ou la fusion de `print.css` et des feuilles
  du livre : le partage se fait par le socle et par `filtres.mk`, pas par le haut.
