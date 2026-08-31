# Reprise du chantier « livres »

Écrit le 30 août 2026, à la fin d'une session, pour qu'un agent reparte d'un autre poste
sans rien redécouvrir. Ce fichier dit **où en est le code**, **ce qui reste**, et **comment
le vérifier**. Il ne raconte pas ce qui est déjà fait : pour la conception, lire
[ARCHITECTURE-LIVRES.md](ARCHITECTURE-LIVRES.md), qui reste la référence.

Quand une tâche est terminée et constatée, la supprimer d'ici.

---

## 1. Où en est le dépôt

- Branche `main`, la branche `livres` y est fusionnée. Dernière étiquette : `v2026.08.66`.
- Les livres sont **visibles pour tout le monde** : aucun drapeau de configuration ne les
  cache. Un dossier est un livre s'il porte `buch.yaml`, un numéro s'il porte
  `ausgabe.yaml` — c'est la seule règle, et elle est tenue des deux côtés
  (`vscodium-extension/szh-cockpit/lib/profil.js` et `pipeline/Makefile`).
- 610 tests JS au vert : `node --test "test/js/*.test.js"` depuis la racine.
- Banc de rendu au vert : `test/build-render.sh` compile les deux livres d'essai
  (`test/livre-normal`, `test/livre-falc`), cinq sorties chacun, et refuse un PDF non
  conforme PDF/UA-1.
- La CI (`.github/workflows/ci.yml`) exécute désormais aussi `test/typo-check.py`,
  `test/apca-check.py` et la compilation puis la validation PDF/UA des deux livres d'essai.

### Ce qui n'est pas à moi

Quatre fichiers étaient modifiés et non commités par **une autre session travaillant dans
le même arbre** : `pipeline/filters/szh-grille.lua`, `pipeline/styles/print.css`,
`test/figures-check.py`, `userdoc.md`. Ils n'ont volontairement pas été commités. Il faut
trancher leur sort avant de continuer, sinon ils suivront le premier `git commit -a` venu.

Les branches, elles, sont toutes fusionnées : `git branch -a --no-merged main` ne rend plus
rien. Les cinq arbres de travail d'agents et les sept branches obsolètes ont été supprimés.
Seule `origin/livres` subsiste sur le distant, entièrement fusionnée — inoffensive.

---

## 2. Ce qui reste, par ordre d'urgence

### 2.1 Parité cockpit revue / livre

C'est le plus gros morceau, et il est **mesuré**, pas supposé. Onze commandes sont
réservées à la revue par `REVUE_SEULEMENT` dans
[lib/panneaux.js](../vscodium-extension/szh-cockpit/lib/panneaux.js#L128) et par les
`when: szh.estRevue` du `commandPalette` de `package.json`. Neuf le sont à juste titre :
un livre n'a ni OJS, ni suivi de traduction, ni cycle de vie de numéro. **Deux ne le sont
pas.**

**a) `szh.metadonnees` : il n'existe aucun formulaire pour `buch.yaml`.** Les métadonnées
d'un livre (titre, ISBN papier et numérique, année, collection, grammage, nombre de pages
pour le dos) ne se saisissent aujourd'hui qu'en éditant le YAML à la main. Il faut un
formulaire, sur le modèle de `media/metadata-issue.*` et de `media/_numero.{css,js}` ; ce
dernier est déjà partagé entre deux vues, donc conçu pour être réutilisé. C'est le travail
naturel à déléguer.

**b) Réordonnancement des chapitres — ✅ FAIT le 30 août.** Ne pas refaire.

Le socle de persistance est routé : `cheminConfig(racine)` rend `ausgabe.yaml` ou
`buch.yaml` selon le profil, `cleOrdre()` rend `ordre-articles` ou `ordre-chapitres`, et
les six appels de co-édition passent par le premier. `articlesSansDoi()` rend un jeu vide
sur un livre — un chapitre n'a pas de DOI, donc pas de « frontière DOI » à franchir.
`ordre-chapitres` est entrée dans `CLES_METADONNEES` et `CLES_LISTES` de `lib/yaml.js` :
elle en était absente, et `analyserAusgabe` la laissait tomber **en silence**.

Le geste existe : **« Monter d'un rang » / « Descendre d'un rang »** au menu contextuel
d'une unité dans l'arbre, pour les deux profils (`szh.monterUnite`, `szh.descendreUnite`).
Ils réutilisent `deplacerUnite()`, extraite du gestionnaire de la vue en cartes pour que
les deux chemins n'écrivent pas deux ordres différents.

Il subsiste **8 littéraux `'ausgabe.yaml'`** dans `extension.js` : tous lisent des clés qui
n'existent que pour un numéro — `revue`, `couleur`, `articles-sans-doi`. Ils sont à leur
place ; ne pas les remplacer en masse.

Reste, si on le juge utile : donner à `szh.apercuMetadonnees` une vue de chapitres. Moins
urgent depuis que l'arbre réordonne.

**c) Écarts mineurs, même famille.** Pas de formulaire de couverture : le dos est bien
calculé par la chaîne à partir du grammage et du nombre de pages réel, mais rien dans
l'interface ne saisit ces variables. Pas de pastille `word-deja` sur les chapitres déjà
importés.

### 2.2 Maquette FALC — rapprocher le rendu de l'original

Objectif : que le PDF produit par la chaîne ressemble à l'original composé, **sans viser le
pixel**. La référence des valeurs est le **Word**, pas le PDF : c'est lui qui porte les
styles nommés avec leurs corps, interlignes et espacements. Le PDF sert ensuite au réglage
fin, à l'œil.

Les trois pièces :

| Rôle | Chemin |
|---|---|
| Word source (styles) | `tmp/book/FALC/2025-ProspectrumFalc_FR_VF.docx` |
| PDF d'origine (référence visuelle) | `tmp/book/FALC/2025-Prospectrum_FALC_FR_ebook (1).pdf` |
| PDF produit par la chaîne | `…/BU02_Redaktion/2025-B329-CSPS_ProspectrumFALC_FR/out/2025-B329-CSPS_ProspectrumFALC_FR.pdf` |

La feuille à régler est `pipeline/styles/livre/falc.css` (le socle géométrique commun est
dans `livre/base.css` — n'y toucher que si l'écart vient vraiment de là).

- [x] **Relever les styles du Word.** Fait. Relevé complet dans `tmp/falc-styles-word.md`
      (hors dépôt). Les valeurs qui comptent, vérifiées à la main dans `word/styles.xml` :
      style `Normal` = 13,0 pt, `w:after=360` → **18,0 pt** entre paragraphes,
      `w:line=288 lineRule=auto` → 1,2 × l'interligne simple de la police ; titres
      **18 / 16 / 14 pt** ; retrait de liste **6,3 mm** ; page **155 × 225 mm**, marges
      **15 mm sur les quatre côtés**.
- [x] **Mesurer les deux PDF.** Fait.
      ⚠ Le fichier `2025-ProspectrumFalc_FR_VF.pdf` **n'est pas l'original** : c'est une
      planche d'imposition unique, 328 × 240 mm avec traits de coupe. La référence est
      `2025-Prospectrum_FALC_FR_ebook (1).pdf`, 46 pages, 155 × 225 mm.
      Mesures constatées (PyMuPDF, distance entre lignes de base successives dans un même
      paragraphe) : **original 21,1 à 21,4 pt pour un corps de 13 pt**, soit un rapport de
      **1,64**. La valeur `--interligne: 1,64` de `falc.css` est donc **juste** : ne pas la
      « corriger » d'après le 1,2 du Word, qui compte en multiples de l'interligne simple
      de la police et non en rapport au corps.
      Outil de comparaison visuelle prêt : `python3 tmp/falc-apercu.py <page orig> <page
      produite>` accole les deux pages à la même hauteur.
- [x] **Deux défauts muets corrigés**, qui expliquent l'essentiel de l'écart :
      les sauts de ligne étaient **doublés** (`\` de l'import Word **plus**
      `hard_line_breaks`) — 282 des 570 sauts — et le nom des styles Word s'imprimait en
      toutes lettres (`{#… .Titre-2-(small)}`). Voir `szh-sauts-uniques.lua` et
      `szh-attributs-sains.lua`.
      **Résultat : 64 pages → 49**, contre 46 à l'original. veraPDF ua1 : PASS.
- [x] **Quatre écarts de maquette refermés**, chacun sur mesure et non à l'appréciation :
      marge basse 20 → **15 mm** (le bloc de texte ne faisait que 176 mm contre 198 mm) ;
      retrait de liste 8 → **6,3 mm** ; interligne de liste 27,0 → **19,2 pt**, sans blanc
      entre items ; titres **en noir** et non en bleu nuit.
      Le bleu nuit `#252B46` était présenté en commentaire comme « la couleur des styles
      Word » : il ne figure **ni** dans le `.docx` — `Titre1..3` ne déclarent aucune
      couleur — **ni** dans le PDF d'origine, qui les imprime en `#000000`. Il avait été
      supposé. Il reste comme repli de l'accent d'ouvrage (`--c-falc-accent-defaut`).
      Enfin, `@page :blank` : une page de passage au recto ne porte plus son folio.
      **Résultat : 47 pages contre 46 à l'original.** Corps, interlignes, pas des puces et
      couleur des titres concordent désormais.
- [x] **Blanc de pied — MESURÉ le 01.09.2026, et l'hypothèse est INFIRMÉE.** Ne pas toucher
      aux `break-inside: avoid` : la mesure les innocente.

      Ce paragraphe affirmait que « les pages produites laissent en moyenne plus de blanc en
      pied que l'original, ce qui vient **probablement** des `break-inside: avoid` (figures,
      encadrés `.falc-*`) ». Les deux moitiés de la phrase sont fausses.

      Mesure PyMuPDF page par page, blanc de pied = 210 mm (225 − marge basse de 15 mm) moins
      le bas du dernier bloc de contenu, chrome exclu :
      **produit** moyenne 37,9 mm, médiane 20,3 mm, 24 pages creuses sur 43 ;
      **original** moyenne 44,3 mm, médiane 26,9 mm, 34 pages creuses sur 41.
      **Le produit est donc MOINS creux que l'original**, sur les deux indicateurs.

      Causes réelles des 24 pages creuses, chacune confrontée au premier bloc de la page
      suivante : **8** liminaires et versos d'encart — blanc voulu ; **5** précèdent une
      ouverture de chapitre (`break-before: recto`), convention de mise en page ; **7**
      précèdent un titre, donc l'évitement d'orphelin porté par les **titres** dans
      `base.css` ; **4** sans cause identifiée, le bloc suivant étant un simple paragraphe.
      ⚠ **Aucune page creuse n'est suivie d'un encadré FALC**, et une seule d'une image (un
      pictogramme QR en liminaire) : l'hypothèse des figures et des `.falc-*` ne tient pas.

      **L'écart d'une page (47 contre 46) ne vient pas du blanc** : le produit en cumule
      moins tout en faisant une page de plus. Il vient du nombre de pages de **contenu**,
      43 contre 41 — un texte qui occupe deux pages de plus. Cause non établie, à chercher
      ailleurs si le point mérite un jour d'être repris.

      ⚠ **Le PDF d'origine a été retrouvé** — il n'est plus dans `tmp/`, vidé depuis, mais
      dans `C:\Users\robin\OneDrive - SZH CSPS\60 - RESSOURCES IA\PRO_EditionSZH-CSPS_Workflow\models\FALC\2025-Prospectrum_FALC_FR_ebook.pdf`
      (46 pages, 155 × 225 mm). Le Word source est dans le même dossier. `tmp/falc-apercu.py`,
      lui, reste introuvable.
- [x] **Banc revérifié** : `livre-normal` et `livre-falc` recompilés de zéro, 2 PASS et
      0 FAIL chacun. La maquette « normal » n'a pas bougé.

⚠ **Images manquantes du B329 — diagnostiqué le 31.08. Ce n'était pas un défaut, c'en était
deux, et la question « l'import ou le liminaire » avait une troisième réponse : les deux.**

Le dossier `liminaires/media/` est vide alors que `impressum-du-livre.md` référence sept
images (`./media/2025-prospectrumfalc-fr-vf-fig-0N.png`) ; WeasyPrint les signale une à une
et la page sort sans elles. Ce qui a été établi :

- **Le Word source existe et porte bien ses images.** ⚠ Pas au chemin consigné plus haut —
  `tmp/` a été vidé. Retrouvé dans
  `OneDrive - SZH CSPS\60 - RESSOURCES IA\PRO_EditionSZH-CSPS_Workflow\models\FALC\2025-Prospectrum_FALC_FR_ebook.docx`
  (951 497 octets, 21.01.2026). Son `word/media/` contient **44 fichiers**, png et svg.
- **L'étape amont a réussi** : `pipeline/import-medias.py::renommer()` (l. 356-411) a renommé
  et réécrit les figures, et les sept numéros s'enchaînent sans trou.
- **Défaut 1, le grave — un échec muet suivi d'une destruction irréversible.** Dans
  `pipeline/livre-scinder.py`, `copier_ressource()` (l. 159-179) échoue avec un
  `⚠ Image introuvable` **sur stderr, non bloquant**, puis `shutil.rmtree()` (l. 365) supprime
  le dossier source. Les neuf chapitres sont sortis sans aucun `media/`, personne n'a rien vu,
  et **la source a été détruite avant tout diagnostic** : on ne sait donc toujours pas
  pourquoi les fichiers manquaient déjà à la scission. C'est ce défaut qui a rendu l'affaire
  indiagnosticable, et il frappera le FALC allemand comme le Hagmann-von Arx.
- **Défaut 2 — le liminaire est capturé puis jeté en silence.** `lire_chapitre()` (l. 82-137)
  sépare `liminaire_texte` des `sections` ; `main()` **l. 253 l'assigne et ne s'en sert
  jamais**. `copier_ressource()` n'est appelé que pour les `sections` (boucle l. 288). Un
  `grep` sur tout `pipeline/` pour `liminaires/media` ne renvoie **rien** : aucun code
  n'alimente ce dossier.
- **Le `.svg` est innocent** : Word embarque nativement des icônes vectorielles en SVG
  (`viewBox 30×30`, avec repli PNG). Aucune conversion de la chaîne n'est en cause.
- `impressum-du-livre.md` a été **écrit à la main** (mtime antérieur à la scission), conforme
  à `pipeline/profils/livre.mk:88` (« pièces liminaires écrites à la main ») : quelqu'un a
  recopié du texte du manuscrit importé, syntaxe d'image comprise, sans copier les fichiers.

**Décidé avec Robin le 31.08** : (1) corriger d'abord l'échec muet et la destruction — une
copie qui échoue interdit l'effacement de la source, et le constat doit remonter comme les
autres constats nommés du projet ; (2) la chaîne doit **copier les médias que les liminaires
citent**, symétriquement aux chapitres, pour qu'un liminaire écrit à la main trouve ses
images.

⚠ **Reste à faire, indépendant des correctifs** : extraire les sept images du Word retrouvé
et les déposer dans `liminaires/media/` du B329, pour que ce livre-ci sorte complet.

⚠ Ne pas régler la maquette FALC en modifiant `socle.css` ou `livre/base.css` : ces deux
feuilles servent aussi la maquette « normal » et la revue.

### 2.3 Extraction de `lib/medias.js`

À **refaire à neuf depuis `main`**. Une tentative précédente a produit un `extension.js`
divergent de 1333 lignes ; ne pas essayer de la réconcilier, elle est abandonnée
volontairement. Repartir du fichier tel qu'il est aujourd'hui.

### 2.4 Livres à produire

- Le **deuxième livre FALC**, l'allemand, dans
  `C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING\54_Buch\BU02_Redaktion`, par le
  lanceur et l'interface, pas à la main.

  ⚠ **Cette exigence n'est pas tenable en l'état, constaté le 31.08** :
  `pipeline/livre-scinder.py` **n'est branché à rien** — ni `pipeline/Makefile`, ni
  `pipeline/profils/livre.mk`, ni le cockpit (recherche faite sur les trois). Il s'invoque à la
  main, et c'est ainsi que le B329 a été scindé. Produire un livre « par le lanceur et
  l'interface » suppose donc d'abord de **brancher la scission**, ce qui est un lot à part
  entière et n'existe nulle part aujourd'hui. À décider avant de lancer l'allemand : soit on
  branche la scission, soit on assume l'appel à la main et on retire cette exigence d'ici.
- **Hagmann-von Arx, « Diagnostische Reisen »**, depuis l'export docx Adobe rangé dans
  `tmp/book/BU01_Auflagen finale/Buecher_2025/2025-B330-Hagmann-von Arx/Ebook`. La
  couverture ne sera pas juste, c'est attendu ; le reste doit l'être, et se vérifie contre
  le PDF d'origine.

⚠ Le nom du dossier d'un livre **ne doit pas contenir d'espace** : les fonctions de chemin
de make découpent sur les blancs. Un garde-fou refuse déjà le cas, mais il faut le savoir
en nommant.

### 2.5 Défauts connus, non corrigés

- **Onglets du sommaire tous bleu nuit.** `PALETTE_CHAPITRE`, dans
  `pipeline/profils/livre.mk`, atteint bien la page de chapitre, mais pas les entrées du
  sommaire, qui prennent toutes la couleur par défaut.
- **`--fond-perdu` n'est pas branché.** Dans `pipeline/styles/livre/imprimeur.css`, c'est
  une valeur par défaut figée ; elle devrait venir de `impression.fond-perdu-mm` de
  `buch.yaml`.
- **Numérotation automatique des titres Word, non vérifiée de bout en bout.** Le modèle
  `livre-template/Modele-chapitre-SZH.docx` numérote les titres (1., 1.1, 1.1.1). Il a été
  affirmé que pandoc retire cette numérotation à l'import, puisqu'elle est portée par le
  style et non par le texte, mais **personne ne l'a constaté sur un vrai aller-retour**.
  Test : importer le modèle comme chapitre, puis vérifier qu'aucun titre du `.md` ne
  commence par un numéro littéral.

### 2.6 CMJN, bloqué sur l’image WSL

`pipeline/cmjn.py` est écrit et sa recette est mesurée : substitution du noir de texte en
`0 0 0 1 k` et des sept couleurs de la maison en CMJN officiel, **puis** Ghostscript vers
ISO Coated v2 (FOGRA39). Dans cet ordre, parce que Ghostscript laisse intact ce qui est
déjà en DeviceCMYK.

Il ne peut pas tourner sur un poste tant que l'image ne fournit pas Ghostscript, `pypdf` et
le profil ICC ECI. Dans `image/Containerfile`, le `sha256` du profil ICC est **laissé vide
volontairement** : il faut le renseigner, reconstruire le rootfs et le publier avant que la
sortie imprimeur soit utilisable ailleurs qu'en développement.

---

## 3. Comment vérifier

```
node --test "test/js/*.test.js"      # 610 tests, depuis la racine du dépôt
test/build-render.sh                 # banc complet : compile les livres, exige PDF/UA-1
python3 test/typo-check.py           # typographie des textes visibles
python3 test/apca-check.py           # contrastes de la palette
```

Deux pièges qui ont déjà coûté du temps :

- **Le toolkit déployé n'est pas le dépôt.** Il vit dans `C:\ProgramData\SZH\toolkit`. Une
  correction de la chaîne ou d'un filtre n'a aucun effet sur un vrai livre tant qu'elle
  n'est pas redéployée, et un fichier périmé y survit à sa suppression du dépôt.

  ⚠ **Ce piège s'est refermé le 31.08, et il a coûté une fausse alerte.** Le toolkit était
  resté en `2026.08.63` quand le dépôt était en `v2026.08.66` — dix commits de retard. Il lui
  manquait `szh-sauts-uniques.lua` et `szh-attributs-sains.lua`, et sa `styles/livre/falc.css`
  était celle d'avant l'alignement : **tout le travail de maquette FALC du 30.08 n'avait
  jamais atteint la production**, et le livre B329 se recompilait à 62 pages au lieu de 47.
  Les tags `.64`, `.65` et `.66` étaient pourtant bien poussés : c'est la mise à jour du poste
  qui n'avait pas été lancée. Corrigé le 31.08 par
  `powershell.exe -ExecutionPolicy Bypass -File windows\update.ps1` (PowerShell **5.1**, pour
  lequel le script est écrit). **Avant de mesurer quoi que ce soit sur un vrai livre, vérifier
  `cat C:\ProgramData\SZH\toolkit\VERSION` contre `git describe --tags`.**

  ⚠ **Défaut du déploiement, confirmé par l'expérience et non corrigé** : une mise à jour
  complète n'efface aucun fichier disparu du dépôt. Neuf y survivaient avant la mise à jour
  en `.66`, et **les neuf y sont encore après** — `filters/szh-import.lua`,
  `filters/szh-tabelle-extraire.lua`, `filters/szh-tabelle-platzhalter.lua`, `rapport.py`, et
  cinq dans `attic/`. Ce n'est donc pas un accident de ce poste : **tous les postes de
  l'équipe accumulent ces fichiers.**

  La cause est précise : `update.ps1:201-209` fait `Expand-Archive -Force`, qui écrase ce que
  l'archive contient mais ne supprime jamais ce qu'elle ne contient pas ; l'étape 5/5
  « Nettoyage » (l. 476-495) ne purge que `$SzhStaging`, jamais `$SzhToolkit`. `bootstrap.ps1`
  a le même manque (l. 74 et 268) : un poste neuf n'est propre que parce qu'il part d'un
  dossier vide.

  **Vérifié : ces neuf fichiers sont inertes.** Aucune occurrence dans le `Makefile` du
  toolkit ni dans `profils/livre.mk`. Le seul nom voisin encore invoqué — `szh-citations.lua`,
  Makefile l. 355 et 400 — désigne le fichier courant de `filters/`, pas la copie périmée
  d'`attic/`. Octets morts, donc, et non bombe à retardement : la correction n'est pas
  urgente.

  Correction proposée si on la fait un jour, **dans un lot dédié et pas au milieu d'un
  autre** : le zip de release (`release.yml:157`) ne contient que `pipeline/`,
  `vscodium-user/`, `revue-template/`, `livre-template/`, `windows/` et `VERSION` — rien
  d'autre n'a de raison d'être dans `$SzhToolkit`, une vraie synchronisation est donc sans
  collatéral. Mais **par bascule atomique** : extraire dans un dossier temporaire de
  `$SzhStaging`, vérifier, puis renommer (`toolkit`→`toolkit.old`, temp→`toolkit`, purge du
  `.old`), jamais un `Remove-Item` direct — sinon une extraction interrompue laisse le poste
  sans pipeline. ⚠ **Ne jamais toucher** ce qui vit hors `$SzhToolkit` : `state.json`,
  `config.json`, `$SzhStaging`, `$SzhLogs`, `comptes\<sid>\etat-utilisateur.json`.
  ⚠ Observé sur ce poste : un dossier `pipeline.bak-avant-sync` qu'**aucun script du dépôt ne
  produit** — geste manuel d'une session antérieure. À élucider avant d'automatiser un sync,
  il pourrait expliquer comment les deux filtres FALC ont disparu du toolkit.
- **Lire le verdict veraPDF sur l'ABSENCE de `FAIL`**, jamais sur la présence de `PASS` :
  un PDF sans arbre de structure ne produit ni l'un ni l'autre, et passerait pour conforme.
