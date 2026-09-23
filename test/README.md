# Banc d'essai

Trois choses vivent ici : une mini-revue qui éprouve le rendu PDF de la maquette, les
contrôles de contraste de la palette, et les contrats du cockpit.

`test/js/` porte deux familles. `contrats.test.js` contrôle ce qui se recopie d'un fichier
à l'autre et les aller-retours des sérialiseurs. `webviews.test.js` **exécute** les
formulaires : `dom-minimal.js` fournit juste assez de DOM pour charger le script assemblé
d'une webview, lui envoyer le message de l'hôte et compter ce qu'elle a construit. Sans
cela, une erreur au rendu ne se voyait pas — la page gardait son titre et son bouton, les
cartes n'arrivaient jamais, et rien ne le disait. C'est arrivé deux fois.

`pdfua.test.js` éprouve la validation PDF/UA en arrière-plan (`lib/pdfua-hote.js`) : badge par
article, cache par empreinte de PDF, un seul travail en vol par numéro, résultat jeté si une
compilation démarre pendant la validation — sept cas, un hôte réellement activé, le lancement
réel du validateur remplacé par un `lancerValidateur` factice.

Quatre fichiers de plus, pour les modèles de courriel et le mode test : `gabarits.test.js`
(le moteur de gabarits Twig, `lib/gabarits.js`, un cas par construction reconnue) ;
`courriel.test.js` (les gabarits du cockpit, `lib/courriel.js` — chaque `.twig` compile, rend un
sujet et un corps non vides, et retrouve au caractère près les quatre anciens textes de
`lib/i18n.js`) ; `courriel-support.test.js` (le gabarit de support du lanceur Windows, rendu par
DEUX moteurs qui ne se parlent jamais — `lib/gabarits.js` en JS et `Get-SzhCourriel` en
PowerShell — comparés côte à côte, Windows seulement) ; `mode-test.test.js` (le badge « Dossier
de test » de la barre d'état du cockpit, contre les quatre scénarios d'emplacement). Et des cas
ajoutés à des fichiers existants : `filtres-pandoc.test.js` et `journal-codes.test.js` pour le
constat `figure-sans-alt` de `szh-numerotation.lua` (une image sans texte alternatif ni légende,
à la passe d'aperçu seulement) ; `controles.test.js` pour sa carte dans la vue Contrôles et son
bouton « Décrire les images » ; `carte-article.test.js` et `webviews.test.js` pour la forme et
l'unicité d'un DOI manuel ; `export-ojs.test.js` pour le refus d'un DOI en double à l'export ;
`lanceur.test.js` pour `emplacement`/`modeTest` dans le JSON simulé du lanceur.

`docx-meta-titre.test.js` éprouve la coupe du titre à deux-points (`pipeline/docx-meta.py`) : la fonction seule sur ce qui doit et ne doit pas se scinder (heures, URL, titres numérotés), puis l'import réel sur trois `.docx` fabriqués par le test — dont un qui porte déjà un sous-titre stylé et ne doit donc RIEN changer — et enfin le constat `sous-titre-deduit` tel qu'il arrive à l'écran, dans les deux langues.

`desinstallation.test.js` éprouve le désinstalleur de poste (`windows/uninstall.ps1`,
`windows/szh-desinstallation.ps1`) : les contrats de source, vérifiés partout — jamais de
`wsl --unregister`, garde `Assert-SzhCibleMachineAutorisee` réappliquée à chaque suppression
d'un fichier-machine — puis, Windows seulement, la construction et l'application du plan sur
une arborescence `$SZH_BASE` jetable, et le mode simulé `-Simuler -Json`.

```sh
node --test "test/js/*.test.js"  # contrats du cockpit, et rendu réel des webviews
python3 test/apca-check.py      # contrastes : palette, couverture, pages courantes
python3 test/typo-check.py      # typographie des textes visibles, fr et de
python3 test/typo-articles.py   # typographie du texte des articles, par pandoc
python3 test/palette-html.py    # régénère docs/palette.html
bash test/build-render.sh       # dans WSL : build PDF + PNG de chaque page, figures-check.py compris
python test/render.py <pdf> <png> [page] [échelle]   # côté Windows : une seule page
```

Les trois premiers ne demandent rien de particulier ; les deux derniers rendent des PNG,
et c'est là qu'il faut choisir son camp. `build-render.sh` a besoin d'un venv Python avec
`pypdfium2` et `Pillow` **dans la distro** (voir plus bas) ; s'il n'y est pas, le script
compile mais ne rend aucune image. La voie courte, quand on veut juste comparer une page
avant et après une retouche de maquette : compiler dans WSL, puis appeler `render.py`
côté Windows, où ces deux paquets sont déjà là.

## La mini-revue

Elle sert à éprouver le rendu (couverture, coupures de page, veuves et orphelines,
styles éditoriaux, redimensionnement des tableaux). Elle n'est pas destinée à la
publication.

## Contenu
- `ausgabe.yaml` — numéro de test (revue « Revue suisse… », couleur bleu acier).
- `articles/contenu-long/` — article ≥ 6 pages : titres H1–H4, listes, citation,
  hervorhebung, question, encadré « wichtig », **2 tableaux** (inclus `.szh-tabelle`
  + tableau pipe) et **notes de bas de page**. Conçu pour provoquer des coupures
  difficiles (veuves/orphelines) et stresser l'auto-dimensionnement des tableaux.
- `articles/couverture-stress/` — couverture sous contrainte : **12 auteurs**,
  10 mots-clés, titre/sous-titre longs (hauteur de hero fixe, méta ancrée en bas).
- `articles/figures/` — six cas d'images, un par défaut déjà constaté : figure numérotée
  (légende avant l'image, crédits en queue), **image hors numérotation avec crédits**
  (`.szh-hors-figure` : ni numéro ni légende, mais une `<figure>` dont la `<figcaption>`
  ne porte que le crédit, **après** l'image), **image hors numérotation sans crédits**
  (pas de `<figure>` du tout — le cas qui débordait de la page avant que `print.css` ne
  contraigne toute image), vectoriel décoratif (`alt=""`), résolution insuffisante
  (320 px, qui ne doit pas être agrandie), **deux insertions de la même image** (deux
  numéros, un seul jeu de crédits), et **deux grilles d'images** — quatre images en 2 × 2
  avec les crédits des quatre rassemblés dans une seule légende, puis deux bandeaux sans
  attribut `disposition`, que le mode automatique doit empiler plutôt que mettre côte à
  côte. Les images sont des bandes de couleur générées, de quelques kilooctets.
- `articles/lecteur-ecran/` — n'existe que pour l'encadré « ce qu'un lecteur d'écran
  reçoit » de l'aperçu du cockpit (`szh-apercu-lecteur-ecran.lua`), invisible dans le
  PDF : quatre cas d'image (texte alternatif distinct de la légende, alt vide repris de
  la légende, décorative `alt=""`, ni alt ni légende — le seul cas rouge) et deux
  tableaux (description longue, puis ni description ni en-tête). À regarder dans
  l'aperçu, pas dans le PDF.
- `articles/documentation/` — la page de Documentation (« News & Ressourcen »), le seul
  article du banc dont le contenu n'est pas de la prose suivie. Depuis que les fiches ont
  quitté le numéro pour la bibliothèque partagée `_NewsUndActu\Fiches\`
  (docs/FORMAT-DOCUMENTATION-KIRBY.md, 23.09.2026), l'article ne porte plus que
  `documentation.de.txt` (deux rubriques de texte riche) et `documentation.meta.yaml`. Les
  dix fiches vivent dans `test/news-racine/_NewsUndActu/Fiches/<dossier du type>/<slug>/`
  (un dossier de type par cas, `types[].dossier` du contrat), toutes rattachées au numéro de
  test via `Ausgabe: wj7f0dcw97qk3p2s`
  (l'`id` de `test/ausgabe.yaml`) — `documentation-kirby.py` les y retrouve, les convertit
  en markdown intermédiaire, que `szh-rubrique.lua` et `szh-ressource.lua` composent
  ensuite, exactement comme avant. **`test/` n'est pas sous `Revue\` ni `Zeitschrift\`**, donc
  sa racine ne se découvre pas toute seule : compiler depuis `test/` exige
  `SZH_NEWS_RACINE` (choix documenté plus bas, « Compiler la mini-revue »). **En allemand à
  dessein** : les titres de rubrique et les libellés de lien se déduisent de la langue de
  l'article, et la moitié allemande de ces tables n'était rendue nulle part ailleurs. Ce
  qu'il garde, et qui a tout cassé une fois :
  - une fiche livre (`soziale-emotionale-entwicklung/`) **plus haute qu'une page**. Avec le
    corps de fiche en `display: flex`, WeasyPrint 69 ne savait pas la couper : elle laissait
    une page entière de fond de carte, titre seul, avant de reprendre à la suivante. La page
    qui la porte doit montrer la fiche qui commence et se poursuit à la page suivante, sans
    page blanche entre les deux.
  - une rubrique (`Dossier_references`) dont le contenu porte des titres. Ils ne doivent
    **pas** être numérotés, et doivent descendre sous le `h2` de la rubrique.
    Il n'y a plus de section numérotée « hors rubrique » dans ce banc : dans
    l'arborescence Kirby, TOUT le contenu d'un article Documentation vient de
    documentation-kirby.py sous forme de rubriques ou de fiches — il n'existe plus de
    champ pour du markdown libre hors de ces deux régimes. La contre-épreuve (un `h2`
    numéroté par `szh-sections.lua`) reste couverte, mais par n'importe quel autre article
    du banc, pas par celui-ci.
  - un descriptif d'agenda (`fulle-und-grenzen/`) qui commence par « 13\. » : il doit
    s'imprimer « 13. » en paragraphe et non « 1. » en liste (WeasyPrint 69 n'honore pas
    l'attribut `start` d'un `<ol>`).
  - deux fiches d'intervention du même canton (ZH), une troisième de la Confédération
    (`triPremier`, elle doit sortir en premier) ; l'une des deux ZH porte un suivi à deux
    lignes (une avec lien et libellé, l'autre sans les deux) et l'autre aucun descriptif.
  - deux fiches de tour d'horizon : portée internationale (pas de canton affiché) et
    portée régionale (canton BE affiché, en code) — la contre-épreuve du champ `canton`,
    affiché seulement si `portee = regional`.
  - une date partielle sur la fiche de recherche (`2020`, puis `2026-03` → « 03.2026 »).
  - `lien_libelle` rempli sur une fiche (le tour d'horizon régional) et vide sur une autre
    (le tour d'horizon international, qui retombe donc sur le gabarit `libelleLien` du
    type).

### La bibliothèque de fiches (`news-racine/`)

`test/news-racine/_NewsUndActu/` simule la racine `<racine>\_NewsUndActu\` partagée par les
deux revues (docs/FORMAT-DOCUMENTATION-KIRBY.md). `Fiches/` y porte les dix fiches ci-dessus
(chacune `Ausgabe: wj7f0dcw97qk3p2s`, l'`id` de `test/ausgabe.yaml`, et un `Ordre` 1..10),
plus trois cas que le banc de la mini-revue ne montre PAS (ils ne sont rattachés à aucun de
ses numéros, donc absents de son PDF — c'est `test/documentation-kirby.test.py` et
`.test.js` qui les interrogent, avec leur propre `--racine-news`) : une fiche bilingue
(`rencontre-partagee/`, `horizon.fr.txt` et `horizon.de.txt` rattachés chacun à un numéro
différent — Ausgabe diffère par langue), une orpheline (`orpheline-sans-numero/`, `Ausgabe:`
vide) et un fichier de statut (`_Statuts/de/<uuid>.txt`) qui ne doit jamais être lu comme une
fiche.

**Choix de racine pour ce banc** : `test/` n'est pas rangé sous `Revue\<num>` ni
`Zeitschrift\<num>` (c'est un dossier de test, pas un vrai numéro), donc
`trouver_racine_news()` ne la découvre pas toute seule — surcharge obligatoire par
`SZH_NEWS_RACINE`, préférée à `--racine-news` ici parce qu'elle traverse `make` sans toucher
au Makefile générique (une variable d'environnement exportée avant `make` est héritée par la
recette, y compris par le `python3 documentation-kirby.py` qu'elle lance) :

```sh
export SZH_NEWS_RACINE="$(pwd)/news-racine"   # depuis test/
make -f ../pipeline/Makefile out/documentation/documentation.pdf
```

`test/build-render.sh` l'exporte déjà pour toute la mini-revue (voir sa tête de fichier) ;
les tests JS/Python passent `--racine-news` explicitement à chaque appel du convertisseur
(déterministe, indépendant de l'environnement du poste qui lance les tests).

## Les deux livres

Le moteur livre a son propre banc, à part de la mini-revue : ce qu'un livre peut casser,
un article ne le peut pas — la numérotation qui court d'un chapitre à l'autre, un sommaire
dont les numéros de page sont posés à la pagination, l'ouverture de chapitre sur une belle
page, et surtout la conformité PDF/UA d'un document de plusieurs chapitres.

- `livre-normal/` — **monographie** allemande, maquette « normal » (155 × 225 mm), trois
  chapitres. Elle porte les deux figures et le tableau qui éprouvent la numérotation
  continue (« Abbildung 1 » et « Abbildung 2 » sont toutes deux au chapitre 2, parce que
  le chapitre 1 n'en a aucune), une note de bas de page, un chapitre plus court qu'une
  page, et cinq pièces liminaires dont un avant-propos écrit à la main. Le chapitre 2
  porte aussi une bibliographie détachée (`02-konzepte.biblio.md`, deux appels dans le
  texte), un tableau extrait avec description longue (`data-alt`, qui ne doit jamais
  s'imprimer), une image décorative (`alt=""`, quelques kilooctets) et une grille de deux
  images — ce que `partage-filtres.css` (styles communs à la revue et au livre) doit
  habiller sans que print.css soit chargé. Chaque chapitre porte désormais son propre
  `<slug>.meta.yaml`.
- `livre-falc/` — **ouvrage collectif** français, maquette FALC. Il éprouve ce que la
  charte FALC a de particulier : une phrase par ligne (donc le lecteur pandoc en
  `hard_line_breaks`, et un texte au fer à gauche sans césure), la pastille ronde de
  chapitre à sa couleur, l'encadré gris de résumé, et la ligne d'auteur·e·s propre à
  chaque chapitre — qu'une monographie ne doit PAS avoir. Le chapitre 2 déclare ses deux
  auteures sous la clé `auteurs:` (l'alias français de `author:`, que szh-livre-auteurs.lua
  accepte aussi).

```sh
wsl -d SZH-Publishing -- bash -lc "cd /mnt/c/<chemin>/test/livre-normal && make -f ../../pipeline/Makefile livre"
```

`make -f ../../pipeline/Makefile livre-epub` (même répertoire) sort l'EPUB 3 ; `python3 test/epub-check.py <chemin>/out/<nom>.epub` en contrôle la structure (mimetype, OPF, manifeste, liens internes, sommaire) sans dépendance — voir docs/ARCHITECTURE-LIVRES.md §4.5.

`build-render.sh` les compile tous les deux et **refuse de rendre 0 si l'un des PDF sort
non balisé**. Ce contrôle-là n'est pas décoratif : un tableau qui tombe au mauvais endroit
fait lâcher le baliseur de WeasyPrint, le Makefile rattrape en sortant un PDF sans balises,
et rien — ni erreur rouge, ni PNG — ne le montre. Le livre part alors chez l'imprimeur en
ayant perdu son accessibilité. Voir `pipeline/filters/szh-tableau-boite.lua`.

`build-render.sh` compile aussi `livre-imprimeur` sur une copie temporaire de `livre-normal`
avec un profil CMJN posé, puis lance `cmjn-check.py` (texte K seul, couleurs de la maison,
aucun RVB résiduel) — sauté si Ghostscript ou le profil ICC de l'image manquent.

## Corpus de composition

`test/composition/` : huit articles réellement publiés (quatre Revue, quatre Zeitschrift, CC BY
4.0), en deux dossiers de numéro. Il ne sert pas à la maquette mais à la **mesure** : césures,
suites de lignes coupées, coupures en bas de page, blancs de justification, pages.
`test/composition-check.py` les compte et se compare à `test/composition/reference.json`.
Hors du banc rapide et de la CI : il se lance à chaque montée de WeasyPrint ou de pandoc, et
avant de toucher aux réglages de césure de `print.css` — le banc, trop court, avait donné un
réglage que le texte réel a démenti. Mode d'emploi et attributions :
`test/composition/LISEZMOI.md`.

## Corpus d'accessibilité

Un second dossier de numéro, `test/accessibilite/`, séparé du banc de maquette ci-dessus :
la porte PDF/UA (`make verifier-ua`) est bloquante et prend le numéro entier, donc un
article volontairement fautif glissé dans `test/articles/` ferait échouer le banc en
permanence. Le corpus a sa propre porte — voir la note de tête de
`test/accessibilite/ausgabe.yaml` pour le détail de ce qu'il exerce (tableaux sans en-tête
ni légende, bibliographie à diacritiques polonais/turcs/serbes, sauts de niveau de titre,
article français dans un numéro de la Zeitschrift) — et une paire d'articles français /
allemand du même texte (`participation-fr` / `teilhabe-de`) dont les numéros de figure
divergent à dessein.

`test/build-render.sh` le construit et le vérifie automatiquement (sauf en mode un seul
slug) : sa porte PDF/UA doit rendre 0, aucun article n'y étant volontairement non
conforme ; `verifier-numerotation` entre les deux articles doit au contraire rendre 1 —
sans quoi ce contrôle ne pourrait plus jamais échouer.

> **En-tête condensé** — depuis le 09.09.2026, le banc compose la couverture par défaut en
> mode **compact** (clé `entete-condensee` absente de `test/ausgabe.yaml` : c'est le nouveau
> défaut). Pour éprouver l'autre allure, ajouter une ligne `entete-condensee: false` à
> `test/ausgabe.yaml`, rebâtir, comparer les PNG, puis **retirer la ligne** (le banc doit
> rester sur le défaut). Le cas le plus parlant n'est plus une couverture courte — le
> compact y est désormais la norme, sans rien de spécial à surveiller — mais
> `articles/couverture-stress` (douze auteur·e·s, titre et sous-titre longs) : en compact,
> le plafond de hauteur du bloc titre tombe, donc un titre trop long agrandit le hero au
> lieu d'être rogné. Vérifié le 09.09.2026 (render.py + lecture du PNG) : il tient, sans
> déborder ni chevaucher ce qui suit.
- `apca-check.py` — vérificateur de **contraste APCA** : lit les hex de
  `pipeline/styles/couleurs.css`, les jetons émis par `pipeline/accent-css.py` et, depuis
  le 23.08.2026, les couleurs de `pipeline/styles/print.css` — celles du hero de
  couverture, de l'en-tête courant et du pied. Il mesure toutes les paires texte/fond
  réellement utilisées et sort en erreur si l'une échoue. 155 paires aujourd'hui.
  Aucune dépendance, aucun build :
  ```sh
  python3 test/apca-check.py
  ```
  **À relancer après toute modification de `couleurs.css` ou de `print.css`** (les niveaux
  sont calculés au plus juste : marges de contraste serrées). Les couleurs de `print.css`
  sont cherchées sélecteur par sélecteur, renvois `var()` suivis : renommer une règle fait
  échouer le script au lieu de le rendre aveugle.
- `typo-articles.py`  – contrôle du **filtre de typographie des articles**,
  `pipeline/filters/szh-typographie.lua`. Chaque cas est un fragment Markdown, une langue
  d’article et le texte attendu en sortie ; le rendu passe par un vrai pandoc, en
  `plain`, pour que l’attendu se lise comme du texte. Les insécables y sont écrites
  `[nb]` : sans cela un attendu faux serait indiscernable d’un attendu juste.
  ```sh
  python3 test/typo-articles.py        # sortie 1 au premier écart
  python3 test/typo-articles.py -v     # montre aussi les cas qui passent
  ```
  Les cas couvrent autant ce qui doit CHANGER que ce qui doit rester **immobile** : une
  URL, une heure, une date ISO, un DOI, un `COVID-19`, un bloc de code, et la fine
  insécable que `szh-numerotation.lua` a posée. ⚠ Sans pandoc, le script ne prétend pas
  passer : il le dit et sort en échec.
- `typo-check.py`  – contrôle de **typographie** des chaînes visibles, dans les deux
  langues. Les règles viennent du *Guide du typographe* pour le français et du Duden pour
  l’allemand suisse, et chacune a été confrontée aux 421 galleys publiées sur ojs.szh.ch
  (voir `docs/TYPOGRAPHIE.md`). Français et allemand ont des règles **opposées** sur
  l’espacement : le contrôle est donc par langue, jamais global.
  ```sh
  python3 test/typo-check.py              # rapport, sortie 1 au premier écart
  python3 test/typo-check.py --corriger   # applique les corrections sûres
  python3 test/typo-check.py --liste      # les règles, sans rien lire
  ```
  **À relancer après toute retouche de `lib/i18n.js`, de `package.nls*.json`, de la table
  `$SzhTextes` ou d’un message de filtre Lua.** Il ne lit que les surfaces listées dans
  `SURFACES` : les commentaires de code gardent leur convention, et les clés d’OJS ne
  doivent surtout pas bouger.
- `palette-html.py` — régénère `docs/palette.html`, la planche de la palette : les 11 crans de
  chaque couleur, dont celui qui porte la couleur de charte elle-même. Chaque cran montre son Lc
  et le texte qu'il a le droit de recevoir : corps de texte, gros titre seulement, ou rien.
  Page autonome (polices de la maquette embarquées), à ouvrir dans un navigateur :
  ```sh
  python3 test/palette-html.py
  ```
  **À relancer aussi après toute modification de `couleurs.css`** — une planche périmée est
  pire que pas de planche.

## Build + capture PNG
Depuis WSL (distro `SZH-Publishing`), avec un venv Python contenant `pypdfium2`
et `Pillow` :

```sh
python3 -m venv ~/pdfvenv
curl -sS https://bootstrap.pypa.io/get-pip.py | ~/pdfvenv/bin/python   # si pip absent
~/pdfvenv/bin/python -m pip install pypdfium2 Pillow

bash test/build-render.sh              # tous les articles
bash test/build-render.sh contenu-long # un seul
```

Les PDF et les PNG (une image par page) sont écrits dans `test/out/<slug>/`
(ignoré par git). `SZH_RENDER` permet de pointer un autre interpréteur.

`build-render.sh` branche aussi `figures-check.py` après le rendu PNG de chaque slug :
aucune légende de figure ne doit rester seule sur sa page, coupée de l'image qu'elle
légende — un défaut que le PDF ne signale pas et que la porte PDF/UA laisse passer, seul
l'œil sur un PNG l'attrapait jusqu'ici. Il tient le plafond de hauteur des images
(`--plafond-figure`, `pipeline/styles/socle.css`) : ce qui le casse, c'est une valeur trop
généreuse, une marge de figure qui grossit, ou une légende de six lignes de crédits.
Utilise `/opt/weasyprint/bin/python3` (`$SZH_FONTTOOLS`), seul interpréteur de la distro
qui importe `weasyprint` ; ignoré s'il est introuvable.

Sa section « Polices » appelle, dans l'ordre, `polices-check.py`, puis
`pipeline/fonts/glyphes-manquants.py --verifier` (les six caractères que la maquette
écrit d'elle-même sont-ils toujours dans les faces livrées) et `metriques-titre.py
--verifier` (la table de largeurs de `szh-titre-lignes.lua` correspond-elle encore à la
police du titre) — les deux `--verifier` existaient sans être appelés par rien
d'automatique avant le 17 septembre 2026. `metriques-titre.py` n'a besoin que de `python3` (pas de
fontTools), les deux autres du même interprète que `figures-check.py`.

Les jobs `contrats` et `contrats-windows` de `ci.yml` ne jugent plus la suite Node sur un
plancher de tests réussis : `test/js/verifier-tap.js` relit le TAP du run et exige `# fail`
et `# cancelled` à zéro, moins de la moitié des tests sautés, et pour chaque `# SKIP` un
motif admis sur ce runner (PowerShell absent sur ubuntu, WSL ou pandoc absents partout,
corpus hors dépôt…) — un saut sans motif ou pour une raison inconnue fait échouer le job.
`test/js/gardes.js` centralise ces motifs, et `SZH_PS_OBLIGATOIRE`, `SZH_PYTHON_OBLIGATOIRE`,
`SZH_PANDOC_OBLIGATOIRE`, `SZH_WSL_OBLIGATOIRE` transforment un saut en échec là où l'outil
est dû (sur ce poste : les quatre à la fois, avant un tag). `compter-gardes.js` compte les
gardes déclaratives à titre indicatif.

Depuis le 17 septembre 2026, `.github/workflows/ci.yml` (job `pdf-ua`) rejoue une partie de
`build-render.sh` à chaque push/PR — pas le script en entier (il reconstruirait deux
fois le même banc), mais ses briques qui tiennent sans rendu PNG : les figures du banc,
le corpus `accessibilite/` (sa porte `verifier-numerotation` DOIT échouer, voir sa note
de tête), la reproductibilité des polices, et les deux `--verifier` ci-dessus. Le rendu
PNG lui-même reste hors CI : un PNG se juge à l'œil, jamais par une porte automatique.
