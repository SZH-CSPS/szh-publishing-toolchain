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

### 4.3 Le CMJN : mécanisme mesuré, texte en K seul confirmé

**Mesuré, pas supposé.** WeasyPrint 69 honore `bleed` et `marks: crop cross` : un essai sur
ce poste sort un `MediaBox` agrandi du fond perdu, un `TrimBox` juste, et des traits de
coupe et repères de montage dessinés. Les traits de coupe **ne demandent donc aucun outil
supplémentaire**.

Le CMJN, si. WeasyPrint écrit en `DeviceRGB` et n'a pas de mode CMJN. `pipeline/cmjn.py`
fait la conversion en deux étapes :

1. **Une passe sur le flux de contenu**, avant Ghostscript : le texte de labeur (un `rg`
   neutre et sombre immédiatement suivi de `BT`) devient `0 0 0 1 k` — noir K seul —, les
   sept couleurs de la maison deviennent leur CMJN chiffré par le graphiste (table dans
   `cmjn.py`), et le blanc `1 1 1 rg` devient `0 0 0 0 k` (papier, pas d'encre). Tout le
   reste — images, teintes non chiffrées — reste en RVB à ce stade.
2. **Ghostscript** convertit ce qui reste :
   ```
   gs -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -dProcessColorModel=/DeviceCMYK \
      -sColorConversionStrategy=CMYK --permit-file-read=<profil>.icc \
      -sOutputICCProfile=<profil>.icc -o sortie.pdf entree.pdf
   ```
   `-sColorConversionStrategy=CMYK` laisse intact ce qui est déjà en `DeviceCMYK` : le
   `0 0 0 1 k` posé à l'étape 1 traverse donc la passe sans être retouché.

**`--permit-file-read` n'est pas cosmétique : sans lui, la passe échoue TOUJOURS, sur
n'importe quel PDF.** Mesuré sur ce poste, Ghostscript 10.05.1 tourne par défaut en bac à
sable SAFER, qui refuse de lire un fichier hors de ses répertoires connus — le profil ICC
de `/opt/icc/`, y compris. L'échec ne dit rien de tel : `gs` s'arrête sur « Error: /undefined
in --runpdf-- » puis, tout en bas de la pile, « Last OS error: Permission denied » — un
message qui ressemble à un PDF corrompu, sur un fichier qui ne l'est pas. Reproduit à
l'identique sur le PDF WeasyPrint le plus neuf, balisé PDF/UA-1 ou non : ce n'est pas un
défaut du contenu, c'est Ghostscript qui refuse le profil. C'était, avant ce constat, ce qui
faisait échouer `make livre-imprimeur` dès qu'un `profil-cmjn` réel était posé.

Sans cette option, et sans la passe 1 de `cmjn.py` — une conversion Ghostscript nue, sur un
PDF WeasyPrint tout juste sorti (texte noir en `0 0 0 rg`), avec le profil PSO Uncoated
v3/FOGRA52 épinglé dans `image/Containerfile` :

| Texte du PDF | Ce que devient le noir |
|---|---|
| `0 0 0 rg` (WeasyPrint, avant toute passe) | `0.89 0.655 0.325 0.824 k` — noir quadri |

Aucune imprimerie n'accepte un texte de labeur de 10 pt composé en quadrichromie : au
moindre défaut de repérage, les lettres frangent. C'est exactement ce que la passe 1 de
`cmjn.py` empêche, en posant le noir K seul AVANT que Ghostscript n'y touche.

**Ce que la passe garantit, mesuré bout en bout sur les 16 pages du banc `test/livre-normal`
(profil PSO Uncoated v3/FOGRA52, `test/cmjn-check.py`) :**
* le texte de labeur sort en `0 0 0 1 k`, sans exception, sur les pages de texte, de
  tableau et d'image contrôlées ;
* les sept couleurs de la maison sortent en leur CMJN chiffré, jamais reconverties par
  Ghostscript (elles sont déjà `k` avant qu'il n'intervienne) ;
* aucun XObject image ne reste en `DeviceRGB` : les images du chapitre 2 (dont une en
  grille et celles d'un tableau) sortent en `DeviceCMYK` ;
* aucun opérateur `rg`/`RG` ne survit dans les 16 flux de contenu.

**Ce qu'elle ne garantit pas :**
* une couleur qui n'est ni un neutre sombre avant `BT`, ni l'une des sept couleurs de la
  table, ni du blanc pur — un dégradé, une teinte décorative — passe par la conversion ICC
  générique de Ghostscript, sans CMJN chiffré par le graphiste. Mesuré sur le banc : un
  fond de bandeau `0.788 0.776 0.745 rg` (gris chaud, ni texte ni couleur de la maison)
  ressort en `0.176 0.133 0.165 0.016 k` — correct pour une décoration, mais ce n'est pas
  une teinte qu'un imprimeur pourrait reproduire à l'identique d'un tirage à l'autre ;
* le mécanisme n'a été mesuré qu'avec le profil PSO Uncoated v3/FOGRA52 épinglé dans
  `image/Containerfile` — pas avec un profil fourni par un autre imprimeur ;
* `test/cmjn-check.py` contrôle le résultat (texte K seul, couleurs de la maison, aucun RVB
  résiduel) mais ne tourne pas sur le banc committé : `test/livre-normal/buch.yaml` garde
  `profil-cmjn: ""`, et `test/build-render.sh` ne pose le profil que sur une copie
  temporaire, sautée si Ghostscript ou le profil ICC manquent — le cas de la CI.

⚠ Le profil ICC est de toute façon une décision d'imprimeur, pas de logiciel. `ISO Coated v2`
n'est pas librement redistribuable ; les profils ECI le sont sous licence d'usage.

**Sans `profil-cmjn` dans `buch.yaml`, le PDF imprimeur sort en RVB, avec fond perdu et
traits de coupe** — ce que beaucoup d'imprimeries acceptent, et qui est de toute façon
meilleur qu'un CMJN faux. La clé n'est plus un chantier ouvert : le mécanisme est écrit et
mesuré ; ce qui reste est la publication dans un rootfs (voir L7b, §8).

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
`break-inside: avoid` sur lui retire la condition. **Ce filtre est désormais branché aussi
pour la revue** (`pipeline/Makefile`, même ordre que dans `profils/livre.mk`) : le même
défaut y est possible.

Sa règle CSS l'a maintenant suivi. `.szh-tableau-boite { break-inside: avoid; }` vit dans
`styles/partage-filtres.css`, chargée après la maquette dans les deux profils (le Makefile
de la revue et `profils/livre.mk`, §4) : la revue est donc protégée au même titre que le
livre. `styles/livre/base.css` ne la duplique plus. La règle générale que ce constat
illustre : **une règle de composant émise par un filtre partagé entre la revue et le livre
vit dans `partage-filtres.css`**, pas dans une feuille propre au livre. `epub.css` et
`web.css` gardent chacune leur propre règle pour `.szh-tableau-boite` (défilement
horizontal, pas coupure de page) : ce sont des sorties hors pagination, qui refont déjà
tout ce qu'il faut à leur medium — voir l'en-tête de ces deux feuilles, et celui de
`partage-filtres.css` pour la liste des sorties qui la chargent.

### 4.5 EPUB : mesuré sur `livre-epub`, deux défauts trouvés et corrigés

La route retenue est un assembleur maison, pas une invocation pandoc unique sur tous les
`.md` : `profils/livre.mk` compile chaque chapitre une seconde fois, en fragments EPUB
(`%.epub-frag.html` — même suite de filtres que le PDF, moins `szh-notes.lua` : pandoc fait
de vraies notes de fin en EPUB, mieux que nos notes flottantes en CSS).
`livre-assembler.py` les colle en un seul HTML (`--metadonnees-epub` écrit au passage le
fichier de métadonnées que pandoc attend), et `livre-epub-prepare.py` prépare ce HTML pour
`pandoc --to=epub3 --split-level=1` : retirer les `<section class="szh-chapitre">`
(indispensables au PDF pour l'ouverture sur belle page, la couleur et l'onglet de tranche —
invisibles pour un writer qui découpe aux `<h1>` non imbriqués).

**Ce que l'archive produite contient, relevé sur `test/livre-normal` et `test/livre-falc`
(décompression du fichier, un vrai zip) :**

* le tableau du chapitre 2 (`tables/table-01.html`) est présent dans son XHTML, avec sa
  description longue (`aria-describedby` vers un `<div>` masqué visuellement) et les
  `scope` d'en-tête — ceux-ci sont écrits en dur dans le fichier source, pas posés par
  `szh-tabelle-scope.lua` (qui ne voit que les tableaux markdown, pas le HTML brut
  réinjecté par `szh-tabelle-inclure.lua`) ;
* la bibliographie et ses ancres survivent au passage par pandoc : les identifiants qui
  commencent par un chiffre (`02-konzepte-ref-bovey-2022`) sont renommés `id_…` par le
  writer XHTML, et toutes les références internes (appel → référence, retour-appel) sont
  renommées à l'identique — vérifié lien par lien, aucun lien mort ;
* la grille de deux images sort en deux vrais `<img>`, extraits dans `EPUB/media/` et
  référencés par leur chemin — rien à corriger ;
* le sommaire (`nav.xhtml`) porte un lien par chapitre, vers l'ancre préfixée par le slug du
  chapitre (`#id_02-konzepte-…`) — vérifié sur les deux livres ;
* `szh-legende-avant.lua` s'applique bien à `epub3` (sa garde `FORMAT:match` accepte
  `'^epub'` depuis le correctif du défaut A9) : la légende précède l'image dans le XHTML,
  vérifié sur les figures numérotées du banc ;
* les métadonnées OPF portent le titre, la langue, un `dc:identifier` (l'ISBN e-book —
  `isbn-print` n'y entre pas, comme prévu), et l'auteur·e de la monographie (aucun pour
  l'ouvrage collectif, où l'auteur·e appartient au chapitre, pas au volume) — mais **pas le
  DOI** : `metadonnees_epub()` (`livre-assembler.py`) ne l'écrit pas, seul l'ISBN e-book
  entre dans `identifier:`. Hors des fichiers autorisés pour cette passe, non corrigé ;
* `epub.css` est bien la seule feuille embarquée dans l'archive (`styles/stylesheet1.css`).

**Deux défauts réels trouvés, tous deux corrigés dans `livre-epub-prepare.py` — aucun autre
fichier touché :**

1. **L'image décorative disparaissait entièrement, sans un mot.** `szh-numerotation.lua`
   pose le fond d'une image décorative en CSS (`<span class="szh-decor…">`, jamais un
   `<img>`, pour qu'un lecteur d'écran n'annonce rien) : le fond vit dans un `<style>`
   ajouté en fin de chapitre. Pandoc, à l'écriture de l'EPUB, retrouve ce `<style>` de
   corps et le remonte dans le `<head>` du XHTML — mais VIDE, son contenu perdu (reproduit
   sur un HTML minimal ne portant que ce `<style>`). Ni `<img>`, ni fond CSS : l'image
   sortait absente de l'EPUB, sans erreur ni avertissement. Corrigé en basculant les
   règles en attributs `style=` sur les deux `<span>` concernés, dans les bornes de
   chaque chapitre (les classes `szh-decor-N` ne sont, elles non plus, pas préfixées par
   chapitre — même compteur Lua remis à 1 à chaque invocation pandoc, il fallait donc
   apparier chaque règle à la bonne image sans sortir des bornes de sa section). Le
   fichier image n'entre plus dans l'archive comme entrée séparée : il vit en `data:` URI
   dans l'attribut `style=`, déjà résolu par `--embed-resources` à la compilation du
   fragment, avant que `livre-epub-prepare.py` ne s'exécute.
2. **Un chapitre sur deux gagnait un fichier XHTML fantôme, absent du sommaire.** Le
   `<div class="szh-onglet">` que le gabarit de chapitre écrit en tout premier enfant de
   la section (avant `$body$`, donc avant le `<h1>` une fois la section retirée) est mort
   pour l'EPUB (`epub.css` : `display:none`, l'onglet de tranche n'existe qu'en
   pagination). Laissé en place, ce `<div>` vide traîne juste avant chaque `<h1>` de
   chapitre, et `pandoc --split-level=1` le range dans le fichier du chapitre PRÉCÉDENT
   (tout ce qui précède un `<h1>` appartient au découpage d'avant) : un fichier XHTML
   quasi vide s'intercalait entre les liminaires et le premier chapitre (`ch004.xhtml`
   sur le banc `livre-normal`), et le `<div>` du dernier chapitre traînait à la fin de
   l'avant-dernier. Rien n'était perdu (le `<div>` est vide, `aria-hidden`), mais un
   fichier fantôme absent de `nav.xhtml` — exactement ce que `test/epub-check.py` (point
   8 ci-dessous) attrape. Corrigé en retirant ce `<div>` avant la conversion EPUB.

**Un doublon d'identifiant théorique, pas observé en pratique.** `szh-tabelle-desc-N`
(l'id visé par l'`aria-describedby` d'un tableau à description longue) compte par
invocation pandoc, donc par chapitre — comme `szh-decor-N`. Deux chapitres portant chacun
un tel tableau produiraient le même id une fois fusionnés par `livre-assembler.py`, AVANT
que pandoc ne découpe le document en fichiers EPUB. Éprouvé en ajoutant temporairement un
second chapitre à tableau dans une copie de banc (`livre-normal-preuve`, hors dépôt) :
**le doublon ne survit pas au découpage** — chaque chapitre atterrit dans son propre
XHTML, et un id dupliqué entre deux documents XML distincts n'est pas un défaut (l'unicité
d'un id est une contrainte par document, pas par livre). `livre-epub-prepare.py` préfixe
quand même l'id par le slug du chapitre, par précaution : le défaut 2 ci-dessus prouve que
du contenu sans `<h1>` propre PEUT se retrouver mélangé au chapitre voisin — un liminaire à
tableau ferait le même doublon pour de vrai. Cas qui ne s'est pas encore présenté sur ce
banc, corrigé préventivement puisque cela ne coûte rien.

**`test/epub-check.py`** contrôle la structure (`zipfile` + `xml.etree`, aucune dépendance
externe) : mimetype en tête non compressé, `container.xml` → OPF, manifeste ↔ archive dans
les deux sens, chaque XHTML bien formé, liens internes et images résolus, titre/langue/
identifiant posés, et chaque document du *spine* atteint par un lien de `nav.xhtml` — ce
dernier point est ce qui aurait attrapé le défaut 2 à lui seul (vérifié en désactivant la
correction puis en relançant le contrôle : échec, qui nomme exactement le fichier fantôme).
`epubcheck` (Java) n'est pas dans la distro SZH-Publishing ; ce script ne le remplace pas,
il tient la porte en attendant. Les deux livres du banc le passent (6/6).

**L'EPUB n'est donc plus un lot différé : `livre-epub` sort une archive conforme sur les
deux livres du banc, deux défauts réels fermés.**

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

Les deux frictions que les `when` ne réglaient pas à eux seuls sont closes :
* **la catégorie des commandes** est désormais `"category": "SZH/CSPS"`, neutre pour les
  deux produits — plus de mention « Revue SZH » en dur.
* **la vue latérale** garde un seul bloc `views`, un seul id (`szhCockpitVue`), mais son
  `name` vaut lui aussi « SZH/CSPS » et son `when` est `szh.estRevue || szh.estLivre` : elle
  apparaît pour les deux profils.
* **la palette de commandes** porte 87 entrées dans `contributes.menus.commandPalette`, dont
  57 gardées par `szh.estRevue`, `szh.estLivre` ou `szh.estRevue || szh.estLivre` — ce que
  §10.5 relevait comme un trou (deux entrées seulement, sans rapport avec le profil) est
  refermé.

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
| Courriels (auteur, traduction) | `lib/courriel.js` — **fait** | — |
| Cycle de vie (verrou, archive, version) | `lib/cycle-vie.js` | ~370 |
| Compilation et contrôles | `lib/compilation.js` | ~440 |
| Résolution des conflits bloc à bloc | `lib/conflits-hote.js` | ~300 |

`lib/courriel.js` a été extrait pour un autre motif que celui de ce plan – les modèles de
courriel en fichiers Twig plutôt qu'en dur dans `lib/i18n.js` – mais il couvre exactement ce que
cette ligne visait : `adressesAuteurs`, `brouillonAuteur`, `brouillonTraduction`, `uriMailto` ont
quitté `extension.js`.

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
| **L6b** | EPUB 3 — assembleur propre, contrôle structurel | **fort** (§4.5) | **fait et mesuré** : `livre-epub` sort une archive conforme sur les deux livres du banc (`test/epub-check.py`, 6/6). Deux défauts réels trouvés et corrigés dans `livre-epub-prepare.py` — image décorative perdue (pandoc vide le `<style>` de corps à l'écriture de l'EPUB), fichier XHTML fantôme absent du sommaire (`<div class="szh-onglet">` avant chaque `<h1>`, mal réparti par `--split-level=1`). DOI absent des métadonnées OPF (seul l'ISBN e-book y entre) — hors fichiers autorisés pour cette passe, non corrigé |
| **L7** | Fond perdu et traits de coupe | faible — natif WeasyPrint | **fait** |
| **L7b** | CMJN à noir préservé | **mécanisme mesuré, publication restante** (§4.3) | `cmjn.py` préserve le noir du texte en K seul et convertit les couleurs de la maison ; Ghostscript termine par le profil PSO Uncoated v3/FOGRA52, épinglé et vérifié dans `image/Containerfile`. **Mesuré bout en bout** sur `test/livre-normal` — `--permit-file-read` sur le profil ICC était le maillon manquant : sans lui Ghostscript refuse de le lire, et le dit par un message qui ne parle pas de permission. `test/cmjn-check.py` vérifie automatiquement texte K seul, couleurs de la maison et absence de RVB résiduel. **Reste non publié** : aucun poste de rédaction n'en bénéficie tant que le rootfs n'a pas été reconstruit par une release |
| **L1** | Extraction d'`extension.js` en modules | moyen — voir les deux avertissements du §6 | **fait partiellement** : six modules extraits (`session.js`, `cycle-vie.js`, `apercu.js`, `import-hote.js`, `medias-hote.js`, `documentation-hote.js`), `extension.js` réduit à environ 6 700 lignes |
| **L2** | `lib/profil.js` + routage des chemins par le profil | moyen | **fait** : `chemins()` a des appelants dans `extension.js`, `session.js`, `cycle-vie.js`, `apercu.js`, `import-hote.js`, `medias-hote.js` et `media/_commun.js` |
| **L8** | Lanceur « Books SZH-CSPS », `new-livre.ps1`, gabarit, icône, identité, raccourci | moyen | **fait** — racine SharePoint à confirmer |
| **L9** | Cockpit côté livre : arbre des chapitres, formulaire d'ouvrage, de couverture | moyen | **fait partiellement** : formulaire de métadonnées de l'ouvrage fait, les quatre tâches de sortie faites, aperçu HTML par chapitre fait ; formulaire de couverture (grammage, main, fond perdu, profil CMJN, dos en lecture seule) pas encore fait |

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

---

## 10. Le cockpit côté livre — le plan, corrigé par sa revue adverse

Le principe qui tient tout : **le cockpit ne devient pas deux logiciels**. Le même arbre, les
mêmes formulaires, la même mécanique d'écriture — avec un profil qui dit les noms, les
chemins et les sections.

⚠ **Ce qui suit est la deuxième rédaction.** La première a été relue de façon adverse, et
elle s'est trompée sur cinq points vérifiables. Les corrections sont dans le texte, et les
erreurs sont nommées : un plan qu'on corrige en silence se retrompe de la même façon.

**État au 7 septembre 2026 — ce que ce plan tenait pour manquant et qui est fait, vérifié
dans le code.** Le remède de la correction n° 1 est posé : chaque module qui tient des
panneaux expose `fermerPanneauxDe`, et `cycle-vie.js` les appelle en boucle
(`ctx.fermerPanneauxDe`). La section « Traductions » de l'arbre (correction n° 5,
`getChildren`) est devenue conditionnelle à `profilCourant().cle === 'revue'`, de même que
la section « Actualité » ; `sectionDeployee` s'initialise sur `categorieUnites()` et non
plus sur le littéral `'articles'`. `profils.chemins()` (correction n° 5) a maintenant des
appelants — `extension.js`, `session.js`, `cycle-vie.js`, `apercu.js`, `import-hote.js`,
`medias-hote.js`, `media/_commun.js`. Le formulaire de métadonnées de l'ouvrage (§10.4)
existe (`media/metadata-book.*`). La palette de commandes (§10.5) porte désormais des
`when` par profil (voir §6). Le badge « déjà converti » sur un dépôt Word répété
(correction n° 8, §10.6) est générique : `_itemsWord()` lit `profilCourant().depot` et pose
`word-deja` pour un chapitre comme pour un article. Ce qui reste ouvert, par sous-section,
est signalé plus bas ; [`REPRISE-LIVRES.md`](REPRISE-LIVRES.md) tient la liste vivante.

### 10.1 Le préalable : dégonfler `extension.js`

7 524 lignes, 52 bandeaux `// ---- Titre -> lib/xxx.js ----`, une vingtaine déjà exécutés.

**Correction n° 1 — les lots A et C sont COUPLÉS, et le plan les séparait.**
`extension.js:1804-1817`, dans `fermerFormulairesEcriture()` — section « Archiver,
verrouiller, désarchiver », donc lot C — itère directement sur `panneauxMedias`, la Map
interne du futur `lib/medias.js` (lot A), et en supprime des entrées :

```js
for (const table of [panneauxMedias, panneauxTable]) {
  for (const [cle, panneau] of Array.from(table.entries())) { panneau.dispose(); table.delete(cle); }
}
```

Ce n'est pas le risque que le plan anticipait (« `lib/` rappelle `extension.js` ») : c'est
l'inverse, du code qui reste fouille l'état privé d'un module extrait. **Le remède** : chaque
module qui tient des panneaux expose `fermerPanneauxDe(dossier)`, et le cycle de vie les
appelle en boucle. Sans cela, ni A ni C ne s'extrait « à comportement constant ».

Trois autres traversées de frontière, dans le même lot A : `buildEnCours` (l.1611) lu quatre
fois, `panneauxTable` (l.6285) lu en l.3161, `apercuCourantSlug` (l.2000) lu en l.6774.
Cette dernière est un état de session partagé par huit sections : ni un rappel ni un
paramètre ne la capturent. Elle mérite son propre petit module avant qu'on touche au lot A.

**Correction n° 2 — l'ordre par couverture de test ne tient pas pour le lot B.**
`webviews.test.js` n'exerce réellement que **quatre** des neuf webviews
(`metadata-articles`, `import-verif`, `table-editor`, `medias-article`) ; `metadata-issue`,
`vue-ensemble`, `articles`, `traduction` et `settings` n'y apparaissent jamais. Le lot B
perd donc son rang.

**Correction n° 3 — le lot B ne pesait pas ce que le plan disait.** Les neuf constructeurs
`html*` font **75 lignes** au total : chacun n'est qu'un appel à `construireHtml()`. Les
~2 000 lignes annoncées sont en réalité les **gestionnaires de messages** des neuf
formulaires — le code métier, pas les gabarits. Le lot est donc plus lourd qu'annoncé, pas
plus léger, et son étiquette mentait sur sa nature.

| Lot | Contenu réel | Ce qui le garde | Rang |
|---|---|---|---|
| **A+C** | Médias, assets, cycle de vie, co-édition, conflits — **ensemble**, ils partagent leur état | `hote.test.js`, `coedition.test.js`, `conflits-*.test.js` — mais **`comparerConflit` n'a aucun test**, ni direct ni transitif : à écrire avant | 1 |
| **B** | Les neuf formulaires : gabarits **et** gestionnaires de messages | 4 webviews sur 9 | 2 |
| **D** | Aperçu, import guidé, réimport | **rien** — tests à écrire avant | 3 |

**Correction n° 4 — `contrats.test.js` ne lit PAS `_pur`.** Il lit `extension.js` comme du
texte, et le dit lui-même. Les vrais lecteurs sont `articles.test.js`,
`carte-article.test.js`, `coedition-hote.test.js` et `conflits-hote.test.js`. `_pur` compte
110 noms, dont 58 ne sont nommés par aucun test — surtout des ré-exports inertes de modules
déjà extraits, dont la perte serait un silence. La garantie « les tests attraperont un nom
manquant » n'est donc vraie que pour la moitié.

### 10.2 L'arbre — et les trois quarts du travail qui sont ailleurs

**Correction n° 5, la plus lourde.** Le plan disait « cinq endroits où `articles/` est codé
en dur dans `FournisseurRevue`, qui passent par `profils.chemins()` ». Trois choses fausses :

1. Ce sont **onze** occurrences, dans dix méthodes (l.1150, 1187, 1193, 1207, 1244, 1297,
   1314, 1328, 1470, 1488, 1494).
2. `extension.js` en compte **43 au total** : les 32 autres sont hors de l'arbre — médias,
   réimport, marqueur de fichier ouvert, éditeur de tableau, portraits, formulaire de
   fiches. Corriger la classe rend la NAVIGATION possible, pas les gestes.
3. **`profils.chemins()` n'a aujourd'hui aucun appelant.** Le module est écrit, il est juste
   mort. « Passe par `profils.chemins()` » décrivait un branchement qui n'existe nulle part.

Et l'arbre a des hypothèses qui ne sont pas des chemins, que `chemins()` ne corrigera donc
jamais :

* `getParent()` (l.1204-1210) suppose que le parent d'un nœud `article` est la section
  `'articles'` — c'est ce qui fait marcher `reveal()` ;
* la section **Traductions** est construite **inconditionnellement** (l.1188). L'affirmation
  « pas de section Traductions pour un livre » reste juste — une revue paraît en deux
  langues, un livre est écrit dans une, et sa traduction est un autre livre avec son ISBN —
  mais elle demande une condition explicite que le plan ne nommait pas comme du travail ;
* `sectionDeployee` est initialisé à `'articles'` (l.1150) : pour un livre, l'accordéon
  s'ouvrirait sur une section qui n'existe pas.

### 10.3 Réordonner les chapitres

**Ce qui est fait** : le moteur honore déjà `ordre-chapitres` — `profils/livre.mk` le lit,
place les slugs nommés en tête, met les autres derrière par tri alphabétique, et signale un
slug listé dont le dossier a disparu. Le plan le donnait comme travail à venir ; il ne
l'était plus.

**Correction n° 6 — « rien à inventer » ne valait que pour le calcul.** Seule
`deplacerArticle` — une quinzaine de lignes pures — se réutilise telle quelle. Tout le
chemin d'écriture est câblé sur la revue :

* `CLE_ORDRE` est le littéral `'ordre-articles'` (`lib/articles.js:26`), sans lien avec
  `PROFILS.livre.unites.ordre` (`lib/profil.js:43`) — deux constantes qui ne se parlent pas ;
* `ecrireClesAusgabe()` (l.236-248) code `path.join(racine, 'ausgabe.yaml')`, et le bail de
  co-édition est posé sur ce même nom (l.4689). **18 occurrences** du littéral dans le
  fichier.

Il faut donc généraliser l'écriture par le profil **avant** le formulaire de couverture du
§10.4, qui en dépendra aussi.

### 10.4 Les deux formulaires nouveaux

* **Métadonnées de l'ouvrage** (`buch.yaml`) — frère de « Métadonnées du numéro ». Le bloc
  auteur·e·s n'apparaît **qu'en monographie** : en collectif il vit dans la fiche de chaque
  chapitre, et l'offrir aux deux endroits inviterait à saisir deux fois la même chose pour
  qu'elles divergent.
* **Couverture** — grammage, main, fond perdu, profil CMJN, et le **dos en lecture seule**,
  calculé sous les yeux de la rédaction depuis le dernier PDF compilé, avec la date de ce
  PDF. Une case pour le forcer quand l'imprimeur a dicté sa valeur.

### 10.5 Le `package.json` — le nom n'était pas le vrai problème

Le plan traitait la **catégorie** des commandes et passait sous silence leur **visibilité**.

**Correction n° 7.** Les 52 commandes portent `"category": "Revue SZH"`, et aucun test n'en
dépend : le renommage en « SZH/CSPS » est sûr. Mais `contributes.menus.commandPalette` ne
contient que **deux** entrées, toutes deux `"when": "false"`, sans rapport avec le profil.
Les familles `szh.estRevue` / `szh.estLivre` du plan n'existent que sur les menus de l'arbre
et de la barre de titre — **jamais sur la palette**. Concrètement : sur un livre, `Ctrl+Shift+P`
offre aujourd'hui les 52 commandes, « Envoyer pour traduction » et l'export OJS compris.
Aucune ne plante — elles ouvrent un panneau vide — mais aucune ne devrait être là.

C'est donc une cinquantaine d'entrées `commandPalette` à écrire, pas un renommage.

Et la marque vit ailleurs que dans `category` : au moins six messages de `lib/i18n.js`
nomment « la barre « Revue SZH » » pour dire au rédacteur où cliquer. Donner sa propre vue au
livre les rendrait faux pour lui.

### 10.6 Ce que le plan refuse, et le trou que ce refus laisse

* **L'export OJS d'un livre.** OJS publie des revues.
* **Le suivi de traduction.** Voir §10.2.
* **Le réimport d'un chapitre corrigé.** `reimporter.py` code `articles/` en dur à dix
  endroits et bascule un dossier par deux renommages atomiques, avec réconciliation des
  tableaux par empreinte. On n'étend pas cette mécanique-là en passant. Le refus tient.

**Correction n° 8 — mais le refus laisse un trou, et il faut le boucher.** L'import simple
**ignore silencieusement** un `.docx` dont le slug existe déjà. Côté revue, l'interface le
rattrape : `_itemsWord()` (l.1383-1391) pose un `contextValue = 'word-deja'` et une icône
d'avertissement, qui mène au réimport. Un livre a un `chapitres-word/` permanent, donc des
dépôts répétés — et un ouvrage collectif en relecture en aura. Sans réimport **et** sans ce
badge, un rédacteur qui redépose un chapitre corrigé ne verra rien du tout : le fichier
reste là, rien ne se passe, rien ne le dit.

**Le badge doit donc être porté au profil livre même sans le réimport** : l'absence de
mécanisme doit se VOIR, pas se deviner.
