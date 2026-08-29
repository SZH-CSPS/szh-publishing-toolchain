# Éditeur de livres — architecture partagée

Ce document est la proposition de refactorisation qui permet à un **éditeur de livres**
(« Books SZH/CSPS ») de naître du cockpit de revue existant sans le dupliquer. Il porte la
décision, ses raisons, et ce qu'elle refuse de faire.

Il se lit avec [ARCHITECTURE.md](ARCHITECTURE.md) (la chaîne telle qu'elle est) et
[SORTIES.md](SORTIES.md) (ce que la chaîne produit aujourd'hui).

---

## 1. Le constat de départ

Un livre et un numéro de revue sont, pour la chaîne, **le même objet** : un dossier qui
porte un fichier de configuration, une suite ordonnée d'unités de texte — chacune avec ses
métadonnées, ses images et ses tableaux — et un dossier de sorties.

Le relevé le confirme, chiffres à l'appui :

| Couche | Réutilisable tel quel | À adapter | Spécifique revue |
|---|---|---|---|
| Filtres Lua (19) | 15 | 3 (`szh-niveaux`, `szh-sections`, `szh-numerotation`) | 1 (`szh-maquette`) |
| Modules `lib/` (24) | 8 | 12 | 4 |
| Webviews (9) | 3 | 4 | 2 |
| Styles CSS | `socle.css` entier | — | `print.css` |
| Windows / WSL / déploiement | tout le socle | 3 lanceurs à décliner | — |

Autrement dit : **la maquette et le vocabulaire diffèrent, la mécanique non**. Tout ce qui
fait le prix du cockpit — l'import Word, le gestionnaire de médias par figure, l'éditeur de
tableaux, la typographie maison, les portraits, la co-édition, les verrous, la détection
des copies en conflit, l'accessibilité PDF/UA — est indifférent au fait que le texte soit
un article ou un chapitre.

Le toolkit sait d'ailleurs **déjà** gérer deux produits : `revue` et `zeitschrift`
partagent tout et ne diffèrent que par un jeton, deux icônes, deux identités de barre des
tâches et deux racines SharePoint (`windows/szh-common.ps1`, `$SzhSousDossiers` et
`$SzhAppIds`). Le livre est un troisième produit — plus éloigné, mais du même patron.

---

## 2. Le principe de la refactorisation

**Une seule abstraction nouvelle : le _profil d'ouvrage_.** Pas de cadre à greffons, pas
d'inversion de contrôle, pas de couche d'indirection générale. Un objet descriptif, lu là
où le code demandait jusqu'ici « où est `ausgabe.yaml` » et « comment s'appelle le dossier
des articles ».

```js
// vscodium-extension/szh-cockpit/lib/profil.js
const PROFILS = {
  revue: {
    config: 'ausgabe.yaml',
    unites: { dossier: 'articles',  mot: 'article',  ordre: 'ordre-articles'  },
    depot:  'articles-word',
    cible:  'all',
  },
  livre: {
    config: 'buch.yaml',
    unites: { dossier: 'chapitres', mot: 'chapitre', ordre: 'ordre-chapitres' },
    depot:  'chapitres-word',
    cible:  'livre',
  },
};
```

Ce que ce choix achète : chaque hypothèse « revue » du code devient **nommée et testable**.
Ce qu'il refuse : généraliser ce qui n'a qu'un cas d'usage. Un profil n'est pas un moteur
de règles ; c'est une table de vérité de six lignes.

### Trois règles de conduite

1. **Aucune règle de revue ne bouge.** Les cibles `pdf`, `html`, `apercu`, `docx`,
   `import`, `verifier-ua` du `Makefile` restent au caractère près. Le moteur livre
   s'ajoute par un `include` conditionnel, jamais par un déplacement.
2. **Le partage se fait par le bas, pas par le haut.** `socle.css` porte les jetons ; les
   feuilles de sortie les consomment. Les filtres Lua ne connaissent ni revue ni livre :
   ils connaissent des figures, des tableaux, des notes, une langue.
3. **Un seul VSIX.** Voir §6.

---

## 3. Le dossier d'un livre

```
2026-B330-Canonica-Teilhabe/
  buch.yaml                       métadonnées de l'ouvrage
  BIENVENUE.md
  chapitres/
    01-einleitung/
      01-einleitung.md
      01-einleitung.meta.yaml     ouvrage collectif : auteurs, résumé, DOI du chapitre
      media/                      images, comme un article
      tables/                     tableaux extraits, comme un article
  chapitres-word/                 dépôt des .docx à convertir
  liminaires/
    avant-propos.md               les pièces liminaires écrites à la main
  couverture/
    illustration.jpg
    quatrieme.md                  texte de 4e de couverture
  styles/                         surcharges locales facultatives
  out/
    <slug>.pdf                    PDF numérique (RVB, PDF/UA-1, signets)
    <slug>-imprimeur.pdf          PDF imprimeur (CMJN, fond perdu, traits de coupe)
    <slug>-couverture.pdf         couverture à plat (4e + dos + 1re)
    <slug>.epub                   EPUB 3
    web/                          HTML responsive
```

`chapitres/<slug>/<slug>.md` est **volontairement homonyme** de
`articles/<slug>/<slug>.md` : c'est ce qui rend le gestionnaire de médias, l'éditeur de
tableaux, l'import Word et les filtres Lua utilisables sans une ligne de changement.

### `buch.yaml`

```yaml
titre: "Berufliche Teilhabe von Erwachsenen mit dem Asperger-Syndrom"
sous-titre: "Strategien von Arbeitnehmer:innen und Arbeitgeber:innen"
ouvrage: monographie       # monographie | collectif — décide où vivent les auteurs
lang: de                   # même clé que dans ausgabe.yaml : les filtres la lisent
maquette: normal           # normal | falc
format: standard           # standard (155x225) | a4 (210x297, FALC seulement)
collection: "Sonderpädagogische Forschung in der Schweiz"
tome: "6"
annee: 2025
isbn-print: "978-3-905890-96-9"
isbn-ebook: "978-3-905890-95-2"
doi: "10.57161/b327"
licence: cc-by-nc-nd-4.0
couleur: "#5F9FBC"
auteurs: []                # monographie : ici. Collectif : dans chaque chapitre.
ordre-chapitres: []
liminaires: [demi-titre, colophon, sommaire, avant-propos.md]
impression:
  grammage: 90             # g/m²
  main: 1.22               # volume spécifique du papier (cm³/g)
  dos-mm:                  # vide = calculé ; une valeur ici gagne
  fond-perdu-mm: 3
  traits-de-coupe: true
  profil-cmjn: ""          # vide = conversion par défaut
locked: false
archived: false
version-toolkit: ""
```

**Monographie ou ouvrage collectif.** Une seule clé décide : `ouvrage`. Et elle ne s'appelle pas `type`, parce que `type` est déjà la RUBRIQUE d'un article dans les fiches de la revue : pandoc fusionne les fichiers de métadonnées, le dernier gagnant, et le `type: article` d'un chapitre importé de Word aurait effacé le `type: collectif` du livre sans un mot. En monographie, les
auteur·e·s sont dans `buch.yaml` et s'impriment sur la couverture et la page de titre ; les
chapitres n'ont pas de bloc auteurs. En ouvrage collectif, chaque `<slug>.meta.yaml` porte
ses auteur·e·s, imprimés sous le titre du chapitre — c'est exactement le schéma d'auteur à
sept champs déjà utilisé par les articles, `szh-auteurs.lua` compris.

### Le calcul du dos

```
épaisseur d'une feuille (mm) = grammage (g/m²) × main (cm³/g) / 1000
dos (mm) = (pages / 2) × épaisseur de feuille + 2 × épaisseur de la couverture
```

Vérifié sur deux couvertures réelles : le FALC A4 de 2026 (134 pages, dos mesuré 8,26 mm
au `TrimBox`) donne 0,123 mm par feuille — cohérent avec un couché 100 g/m² de main 1,23.
Le Thaler 2019 était livré sous le nom `UG_7,5mm`, dos de 7,5 mm.

Les valeurs de départ (90 g/m², main 1,22, couverture 0,3 mm) sont **des variables
cohérentes, pas une vérité** : le papier se choisit livre par livre, et l'imprimeur donne
sa main. La clé `dos-mm` permet de forcer la valeur qu'il aura dictée. Le nombre de pages,
lui, n'est pas saisi : il est **lu dans le PDF intérieur** juste avant de composer la
couverture — un dos calculé sur un compte de pages périmé est le défaut le plus cher de
tout le métier.

---

## 4. La chaîne de compilation

### Ce qui ne change pas

Les 17 filtres Lua génériques, `socle.css`, les scripts Python d'import, les cibles revue
du `Makefile`, la porte PDF/UA, l'image WSL (à une exception, §4.3).

### Ce qui s'ajoute

```
pipeline/
  profils/
    livre.mk                     règles du moteur livre, incluses si buch.yaml est là
  livre-assembler.py             colle les fragments, compose les liminaires et le sommaire
  filters/
    szh-tableau-boite.lua        enveloppe chaque tableau (défaut PDF/UA, voir §4.4)
    szh-livre-auteurs.lua        le bloc auteurs d'un chapitre, après son titre
    szh-livre-couverture.lua     4e + dos + 1re, une page à plat
  styles/livre/
    base.css                     géométrie, folios, liminaires, sommaire, coupures
    normal.css                   la charte courante (155x225, Open Sans SemiCondensed 10 pt)
    falc.css                     la charte FALC (pastilles, onglets, InfoBox, une phrase par ligne)
    imprimeur.css                fond perdu, traits de coupe, repères
    couverture.css               la page à plat
    web.css                      HTML responsive
    epub.css                     EPUB 3
  templates/
    szh-livre.html               enveloppe du livre (rempli par l'assembleur, pas par pandoc)
    szh-livre-chapitre.html      gabarit de FRAGMENT d'un chapitre
    szh-livre-liminaire.html     gabarit de fragment d'une pièce liminaire
    szh-couverture.html          gabarit de la couverture
```

### L'assemblage : par fragments, pas par une invocation unique

**C'est le point où la première rédaction de ce document se trompait**, et la correction est
structurante. Elle proposait un filtre Lua `szh-livre-assembler.lua` qui aurait réuni les
chapitres en un document. C'est impossible : un filtre Lua travaille sur l'arbre d'**une**
invocation pandoc, et une invocation n'a **qu'un dossier courant**. Or la règle de
compilation fait `cd chapitres/<slug>` précisément pour que `media/` et `tables/` tombent
juste — `szh-tabelle-inclure.lua` ouvre `tables/table-NN.html` en relatif, tel quel. Douze
chapitres, ce sont douze dossiers courants. Et les tableaux extraits ne sont pas préfixés
par leur slug (`table-01.html` partout) : une résolution par `--resource-path` prendrait
silencieusement le fichier d'un autre chapitre.

Le dispositif retenu, **mesuré sur le banc** :

1. chaque chapitre est compilé **comme un article** — même `cd`, même suite de filtres,
   `--standalone --embed-resources` — avec un gabarit qui ne sort que le corps. Le
   fragment obtenu est autonome : images en `data:` URI, **zéro chemin relatif survivant** ;
2. `livre-assembler.py` relève les titres des fragments, compose les liminaires que la
   machine sait écrire, bâtit le sommaire en liens internes, et remplit l'enveloppe ;
3. WeasyPrint pagine le tout.

Ce que cela achète, et qui n'est pas un effet de bord : la compilation reste **incrémentale
par chapitre**, et l'aperçu du cockpit sur un chapitre est, littéralement, l'aperçu d'un
article.

Le `Makefile` actuel route déjà `profil: book` vers un message d'attente
(`profil-differe`). Cette branche devient l'`include` de `profils/livre.mk`, et la valeur
acceptée devient `livre` — `book` restant toléré en synonyme, des dossiers portant déjà la
clé.

### Les six sorties

| Cible | Produit | Comment |
|---|---|---|
| `livre-pdf` | PDF numérique | WeasyPrint, RVB, PDF/UA-1, signets, liens vivants, sans fond perdu |
| `livre-imprimeur` | PDF imprimeur | WeasyPrint + `bleed`/`marks`, puis conversion CMJN |
| `livre-couverture` | Couverture à plat | page unique `(2 × largeur + dos)`, fond perdu, traits de coupe, CMJN |
| `livre-html` | HTML responsive | pandoc + `web.css`, autonome |
| `livre-epub` | EPUB 3 | **pas résolu — voir §4.5** |
| `livre-mobi` | *(refusé, voir §7)* | |

### 4.3 Le seul vrai manque de l'outillage : le CMJN

**Mesuré, pas supposé.** WeasyPrint 69 honore `bleed` et `marks: crop cross` : un essai sur
ce poste sort un `MediaBox` agrandi du fond perdu, un `TrimBox` juste, et des traits de
coupe et repères de montage dessinés. Les traits de coupe **ne demandent donc aucun outil
supplémentaire**.

Le CMJN, si. WeasyPrint écrit en `DeviceRGB` et n'a pas de mode CMJN. Il faut une passe de
conversion, et le seul outil crédible est **Ghostscript** :

```
gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite \
   -sColorConversionStrategy=CMYK -dProcessColorModel=/DeviceCMYK \
   -sOutputICCProfile=<profil>.icc -o sortie.pdf entree.pdf
```

C'est une modification de `image/Containerfile`, donc **un nouveau rootfs** — une release
lourde (le `.tar.gz` repart) et non une simple mise à jour de toolkit. C'est le seul point
du chantier qui touche l'image.

**Et cette commande ne marche pas.** Éprouvée sur ce poste, Ghostscript 10.05.1, sur un PDF
réellement produit par WeasyPrint (texte noir en `0 0 0 rg`), avec un vrai profil
`CoatedFOGRA39.icc` :

| Variante | Ce que devient le noir du texte |
|---|---|
| conversion CMJN nue | `0.722 0.675 0.671 0.882 k` — noir quadri |
| avec `-sOutputICCProfile=CoatedFOGRA39.icc` | `0.89 0.784 0.616 0.969 k` — pire |
| avec `-dUseFastColor=true` | `1 1 1 0 k` — C+M+J à 100 %, **sans plaque noire** |

Aucune imprimerie n'accepte un texte de labeur de 10 pt composé en quadrichromie : au
moindre défaut de repérage, les lettres frangent. **Le CMJN n'est donc pas un réglage, c'est
un chantier** : il faut préserver le noir du texte en K seul, ce qu'aucune option unique de
Ghostscript ne fait. Les pistes à instruire, dans l'ordre du moins cher au plus cher :

1. séparer le noir avant la passe couleur — convertir les images seules en CMJN, et laisser
   le texte et les filets en noir K ;
2. un profil de sortie à séparation noire dédiée (`GCR` maximal), fourni ou validé par
   l'imprimeur ;
3. la voie Pillow/littleCMS, déjà présente dans le toolkit pour l'opération inverse
   (`pipeline/cmyk-rgb.py`, `lib/cmyk.js`), qui donne un contrôle par objet.

⚠ Le profil ICC est de toute façon une décision d'imprimeur, pas de logiciel. `ISO Coated v2`
n'est pas librement redistribuable ; les profils ECI le sont sous licence d'usage.

**En attendant, le PDF imprimeur sort en RVB, avec fond perdu et traits de coupe** — ce que
beaucoup d'imprimeries acceptent, et qui est de toute façon meilleur qu'un CMJN faux. La
clé `profil-cmjn` reste prévue pour le jour où la séparation sera juste.

### 4.4 Le défaut qui a coûté le plus cher : le tableau qui décroche le balisage

Trouvé au premier livre du banc. Un `<table>` porteur d'une `<caption>` est mis en page dans
une **boîte enveloppe anonyme**, qu'aucun sélecteur CSS n'atteint. Quand elle se coupe entre
sa légende et sa table, le baliseur de WeasyPrint 69 s'arrête net :

```
File ".../weasyprint/formatting_structure/boxes.py", line 407, in get_wrapped_table
ValueError: Table wrapper without a table
```

Le vrai piège n'est pas le plantage : c'est que le `Makefile` le rattrape et sort un PDF
**non balisé**. Le rédacteur voit un PDF correct, aucune erreur rouge, et le fichier a perdu
sa conformité PDF/UA sans un mot. La condition est une affaire de millimètres — le tableau
seul passe, précédé de deux figures il échoue — donc aucun test de contenu ne peut
l'attraper.

`szh-tableau-boite.lua` enveloppe chaque tableau dans un vrai `Div`, atteignable en CSS, et
`break-inside: avoid` sur lui retire la condition. **Ce filtre vaut aussi pour la revue**,
où le même défaut est possible et n'a simplement jamais été rencontré : c'est de la chance,
pas une garantie.

### 4.5 EPUB : la seule sortie qui ne peut pas réutiliser l'assemblage

Le writer `epub3` de pandoc construit lui-même le manifeste OPF, le *spine* et la navigation
**à partir d'une seule invocation** portant tous les chapitres. Le contournement du §4 —
compiler chapitre par chapitre et recoller du texte — ne s'y applique donc pas : recoller
des fragments ne produit pas un EPUB.

Deux voies, aucune gratuite :

* **une invocation pandoc sur tous les `.md`**, avec `--resource-path` listant chaque dossier
  de chapitre. Elle bute sur la collision des noms de tableaux extraits (`table-01.html` dans
  chaque chapitre) : il faudrait les préfixer par le slug, ce qui touche `docx-tables.py`,
  `szh-tabelle-reference.lua` et les dossiers déjà écrits ;
* **un assembleur d'EPUB maison** (OPF, nav, zip) nourri des fragments, sur le modèle de
  `livre-assembler.py`.

À quoi s'ajoute un détail réel : `szh-legende-avant.lua` se garde par `FORMAT:match('^html')`
et ne s'applique donc pas à `epub3` — en EPUB, la légende resterait **après** l'image, ce que
toute la chaîne s'emploie à corriger ailleurs. Un caractère à changer, mais il faut le savoir.

**L'EPUB n'est donc pas « faible » : c'est un lot à part entière.**

---

## 5. Les deux maquettes

### 5.1 « Normal » — relevé sur les livres réels

Mesures prises sur `2025_Canonica_Berufliche Teilhabe.pdf` et sur l'IDML
`Thaler-Battistini_Alice_Inhalt.idml` :

* format **155 × 225 mm**, pages en vis-à-vis ;
* marges **20 mm intérieur/extérieur, 24 mm haut/bas** (IDML), folio à 9 mm du pied ;
* corps **Open Sans SemiCondensed Regular 10 pt** — la police est **déjà dans le toolkit**
  (`pipeline/fonts/`), c'est celle de la revue ;
* notes et légendes 8,5 pt, mentions légales 7 pt ;
* texte **justifié**, césure active, alinéa de première ligne sauf après un titre ;
* pas de titre courant, seulement le folio, en gras, en pied de page extérieur ;
* chapitres numérotés `1`, `2`, `2.1`, ouverture sur belle page (recto) ;
* liminaires dans l'ordre : couverture, demi-titre, colophon, page de titre, sommaire.

La fidélité est **volontairement approchée** ici : la charte varie d'un livre à l'autre et
les IDML de référence arriveront plus tard. Rien de ce qui varie — bandeaux de personnages
en marge gauche, par exemple — n'est traité.

### 5.2 FALC — la charte à reproduire fidèlement

Le modèle est le **Prospectrum FALC** (155 × 225 mm, Open Sans), pas le manuscrit Word
« Créer ensemble » resté en Calibri sans mise en page. Le second donne en revanche le
**vocabulaire de styles**, qui devient le jeu de blocs pandoc.

Relevé sur les `.docx` :

| | FALC standard | FALC A4 |
|---|---|---|
| Format | 155 × 225 mm | 210 × 297 mm |
| Marges | 15 mm | 25 mm |
| En-tête / pied | 10 mm | 10 mm |
| Corps | 13 pt | 14 pt |
| Interligne | 1,2 | 1,3 |
| Espace après ¶ | 18 pt | 18 pt |
| Encre des titres | `#252B46` | `#252B46` |

Traits de charte visibles au rendu, à reproduire :

* **un numéro de chapitre en pastille ronde**, en haut à droite, à la couleur du chapitre ;
* **un onglet de couleur en bord extérieur**, un par chapitre, qui descend de chapitre en
  chapitre — un index à pouce ;
* **encadré gris de résumé** (`InfoBox`) en tête de chapitre : « Ces 3 personnes ont parlé
  de : » ;
* **sommaire à filets**, avec la pastille de couleur de chaque chapitre en regard ;
* **une phrase par ligne** — la règle FALC cardinale : le retour à la ligne est du sens, pas
  de la justification. Le texte est donc **au fer à gauche, sans césure**, et les retours du
  `.md` sont significatifs ;
* gras sur les mots-clés, listes numérotées courtes.

Correspondances de styles Word → blocs pandoc :

| Style Word | Écriture dans le `.md` | Rendu |
|---|---|---|
| `Titre1..4` | `#`, `##`, `###`, `####` | titres, avec pastille sur `#` |
| `InfoBox` | `::: {.falc-resume}` | encadré gris de tête de chapitre |
| `InfoBox2` | `::: {.falc-encadre}` | encadré à filet |
| `Mis en évidence` | `::: {.falc-cle}` | paragraphe gras détaché |
| `Légende_Photo` | légende de figure | inchangé (`szh-numerotation`) |
| `Liste étapes` | `::: {.falc-etapes}` | liste numérotée espacée |
| `Nom auteurs` | `auteurs:` du `.meta.yaml` | bloc auteurs (`szh-auteurs`) |
| `Soustitre Projet` | `## …` + `{.falc-projet}` | sous-titre de projet |

---

## 6. Un seul VSIX, deux profils

**Décision : le cockpit reste une seule extension**, qui reconnaît le dossier qu'on lui
ouvre et se présente en conséquence.

Pourquoi :

* c'est la demande — partager le code au maximum ;
* deux VSIX, ce serait deux `i18n.js` de 178 Ko à tenir en phase, deux jeux de webviews,
  deux harnais de tests, deux entrées de `vsix.lock`, et la certitude qu'une correction
  n'atterrira que d'un côté ;
* l'activation de VSCodium est déjà conditionnelle (`szh.estRevue`) : la clé devient
  `szh.profil` ∈ {`revue`, `livre`}, et les `when` du `package.json` s'y accrochent.
  `activationEvents` vaut `onStartupFinished`, indifférent au profil : rien à y changer.

⚠ Deux frictions que les `when` ne règlent pas, et qui sont du travail réel :
* **la catégorie des commandes.** Les ~60 commandes portent `"category": "Revue SZH"` en
  dur. VS Code n'a pas de catégorie conditionnelle : dans un livre, la palette annoncerait
  toujours « Revue SZH ». Il faut soit une catégorie neutre pour les deux produits — le
  moins cher, et sans doute le mieux : « SZH/CSPS » —, soit deux jeux de déclarations.
* **la vue latérale.** Un seul bloc `views`, un seul id (`szhCockpitVue`), gardé par
  `szh.estRevue`, et son `name` n'est même pas passé par l'i18n. Un profil livre veut sa
  vue, son icône et ses ~15 entrées de menu contextuel en parallèle.

Ce que cela coûte, et comment on le paie : un défaut du moteur livre peut faire tomber
l'extension d'une rédaction de revue. Le prix se paie en tests — les 578 contrats existants
restent verts et deviennent la définition du profil `revue`, et le profil `livre` reçoit
les siens.

### Le préalable : dégonfler `extension.js`

7 495 lignes, dont 52 sections annotées par leur auteur `// ---- Titre -> lib/xxx.js ----`.
**Le plan d'extraction est écrit dans le fichier, et il a déjà été exécuté une vingtaine de
fois** : 16 de ces marqueurs désignent des modules `lib/` qui existent (`i18n`, `yaml`,
`citations`, `archivage`, `table-model`, `formatting`, `coedition`, `export-ojs`…). C'est un
argument POUR la manœuvre, pas contre : le motif est rodé.

Extraction proposée :

| Sections | Nouveau module | Lignes |
|---|---|---|
| Aperçu HTML/PDF, défilement synchronisé | `lib/apercu.js` | ~490 |
| Import guidé, réimport, annulation | `lib/import.js` | ~420 |
| Assets, remplacement, gestionnaire de médias | `lib/medias.js` | ~1 130 |
| Gabarits de webview (9 constructeurs `html*`) | `lib/vues/*.js` | ~1 500 |
| Courriels (auteur, traduction) | `lib/courriel.js` | ~500 |
| Cycle de vie (verrou, archive, version) | `lib/cycle-vie.js` | ~370 |
| Compilation et contrôles | `lib/compilation.js` | ~440 |
| Résolution des conflits bloc à bloc | `lib/conflits-hote.js` | ~300 |

Le tableau ci-dessus **sous-compte** : environ 800 lignes de plus (co-édition, articles,
suivi de traduction, auteur·e·s publiés, photos) portent un intitulé qui a déjà un module
`lib/` du même nom mais dont le code est resté en place. `extension.js` retombe donc vers
2 300 à 3 000 lignes selon la rigueur du passage. **C'est le préalable, pas un bonus** : sans
lui, le profil livre ajoute deux mille lignes à un fichier qui n'en supporte plus.

⚠ Deux avertissements sur le mot « mécanique ».
* **Le filet de tests ne couvre pas également.** `test/js/hote.test.js` active réellement
  l'extension et couvre bien l'arbre, les panneaux et le remplacement de médias. Il ne
  couvre **ni l'aperçu commutable HTML/PDF ni le geste d'import par la commande** — les deux
  premières lignes du tableau, donc les plus exposées. Elles se travaillent avec un test
  écrit AVANT le déplacement, pas après.
* **Le risque de cycle est réel.** Tant qu'un module extrait ne fait qu'importer, tout va
  bien. Dès qu'il doit rappeler `extension.js` — rafraîchir l'arbre, repeindre le marqueur
  de fichier —, il faut un découpage par rappel ou par événement. C'est de la conception,
  pas du copier-coller, et `module.exports._pur` (une centaine de fonctions pures exposées
  aux tests) doit continuer de les exporter après le déménagement.

---

## 7. Ce que la proposition refuse

* **MOBI.** Le format est mort : Amazon ne l'accepte plus au dépôt depuis 2022 et KindleGen
  n'est plus distribué. Le produire demanderait Calibre — plusieurs centaines de Mo dans le
  rootfs — pour un fichier que personne ne réclame. **Proposition : EPUB 3 seul**, que le
  KDP accepte et que tous les liseurs lisent. Si un partenaire exige un `.azw3`, il se
  fabrique en une commande depuis l'EPUB, hors chaîne.
* **Un éditeur visuel de couverture.** La couverture se compose en CSS depuis `couverture/`
  et se relit en PDF. Un éditeur WYSIWYG serait un second logiciel.
* **Le déplacement des règles revue du `Makefile`.** Le gain serait cosmétique, le risque
  porte sur la seule chaîne qui tourne en production.
* **Un cadre à greffons.** Deux profils ne justifient pas une architecture d'extension.

---

## 8. Ordre des travaux

Deux voies indépendantes, qui n'ont pas besoin l'une de l'autre : la **chaîne** (L3 à L7) ne
demande rien au cockpit, et le **cockpit** (L1, L2, L9) ne demande rien à la chaîne. Elles
se rejoignent au lanceur.

| Lot | Contenu | Risque | État |
|---|---|---|---|
| **L3** | `profils/livre.mk`, assembleur, gabarits, `base.css` + `normal.css` — PDF numérique | moyen | **fait**, PDF/UA-1 validé |
| **L4** | Maquette FALC (pastilles, onglet de tranche, encadrés, une phrase par ligne) | faible | **fait** |
| **L4b** | Numérotation continue et numéro de chapitre | **fort** — filtres partagés avec la revue | **fait**, ordre de compilation garanti |
| **L5** | Couverture à plat, dos calculé sur les pages lues dans le PDF intérieur | moyen | **fait** |
| **L6** | HTML responsive | faible | **fait** |
| **L6b** | EPUB 3 — assembleur propre, préfixe de slug sur les tableaux | **fort** (§4.5) | à faire |
| **L7** | Fond perdu et traits de coupe | faible — natif WeasyPrint | **fait** |
| **L7b** | CMJN à noir préservé | **fort, non résolu** (§4.3) | à instruire |
| **L1** | Extraction d'`extension.js` en modules | moyen — voir les deux avertissements du §6 | à faire |
| **L2** | `lib/profil.js` + routage des chemins par le profil | moyen | **amorcé** : la table et la détection sont là, les chemins pas encore routés |
| **L8** | Lanceur « Books SZH-CSPS », `new-livre.ps1`, gabarit, icône, identité, raccourci | moyen | **fait** — racine SharePoint à confirmer |
| **L9** | Cockpit côté livre : arbre des chapitres, formulaire d'ouvrage, de couverture | moyen | à faire |

---

## 9. Ce qui reste à décider avec la rédaction

1. **La racine SharePoint des livres.** Posée par HYPOTHÈSE à `54_Buch\BU02_Redaktion`
   (en cours) et `54_Buch\BU01_Auflagen finale` (archives). Seul le second nom est
   confirmé — il vient du dossier de référence livré ; les deux autres étendent le patron
   `52_Revue` / `53_Zeitschrift`. Configurable par `config.json`, clé `sousDossiersLivre`.
2. **Le nom du produit.** « Books SZH/CSPS » a été demandé, mais un nom de fichier `.lnk`
   ne peut pas porter de barre oblique — et c'est ce nom qui s'affiche dans le menu
   Démarrer. L'entrée s'appelle donc « Books SZH-CSPS ». À trancher : garder le trait
   d'union, ou suivre le patron des deux autres entrées — « Revues SZH » et
   « Zeitschriften SZH » —, qui ne portent pas de sigle double.
3. **Le profil CMJN** exigé par l'imprimerie (Edubook / Ediprim). C'est lui qui décidera
   de la voie à prendre sur le noir (§4.3).
4. **Le papier de référence** (grammage et main) des collections courantes.
5. **La collection et la numérotation de tome** : `Sonderpädagogische Forschung in der
   Schweiz` est une collection numérotée ; y en a-t-il d'autres, et qui tient le compte ?
6. **L'import Word d'un chapitre** n'est pas branché sur la route livre du `Makefile` :
   `chapitres-word/` existe et est documenté, mais la cible `import` n'est appelée que par
   la route article. Travail de chaîne, à faire avant que la rédaction ne dépose son
   premier `.docx` de chapitre.
