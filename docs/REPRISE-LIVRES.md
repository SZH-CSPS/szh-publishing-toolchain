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
- [ ] **Ce qui reste, si on veut aller plus loin** — aucune de ces pistes n'est chiffrée :
      les pages produites laissent en moyenne plus de blanc en pied que l'original, ce qui
      vient probablement des `break-inside: avoid` (figures, encadrés `.falc-*`) qui
      renvoient un bloc entier à la page suivante. À départager avant de toucher à quoi que
      ce soit : mesurer le blanc de pied page à page plutôt qu'en moyenne.
      L'outil de comparaison visuelle est `python3 tmp/falc-apercu.py <page orig> <page
      produite>`.
- [x] **Banc revérifié** : `livre-normal` et `livre-falc` recompilés de zéro, 2 PASS et
      0 FAIL chacun. La maquette « normal » n'a pas bougé.

⚠ Défaut de contenu repéré au passage, **non corrigé** : le dossier `liminaires/media/` du
livre B329 est VIDE alors que `impressum-du-livre.md` référence sept images
(`./media/2025-prospectrumfalc-fr-vf-fig-0N.png`). WeasyPrint les signale une à une et la
page sort sans elles. À trancher : soit les images doivent être copiées là par l'import,
soit le liminaire ne devrait pas les citer.

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
- **Lire le verdict veraPDF sur l'ABSENCE de `FAIL`**, jamais sur la présence de `PASS` :
  un PDF sans arbre de structure ne produit ni l'un ni l'autre, et passerait pour conforme.
