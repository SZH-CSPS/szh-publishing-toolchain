# Reprise du chantier « livres »

Écrit le 30 août 2026, à la fin d'une session, pour qu'un agent reparte d'un autre poste
sans rien redécouvrir. Ce fichier dit **où en est le code**, **ce qui reste**, et **comment
le vérifier**. Il ne raconte pas ce qui est déjà fait : pour la conception, lire
[ARCHITECTURE-LIVRES.md](ARCHITECTURE-LIVRES.md), qui reste la référence.

Quand une tâche est terminée et constatée, la supprimer d'ici.

---

## 1. Où en est le dépôt

- Branche `main`, la branche `livres` y est fusionnée. Dernière étiquette : `v2026.08.63`.
- Les livres sont **visibles pour tout le monde** : aucun drapeau de configuration ne les
  cache. Un dossier est un livre s'il porte `buch.yaml`, un numéro s'il porte
  `ausgabe.yaml` — c'est la seule règle, et elle est tenue des deux côtés
  (`vscodium-extension/szh-cockpit/lib/profil.js` et `pipeline/Makefile`).
- 607 tests JS au vert : `node --test "test/js/*.test.js"` depuis la racine.
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

Il traîne aussi cinq arbres de travail d'agents sous `.claude/worktrees/` et leurs branches
`worktree-agent-*`. Leur contenu est déjà sur `main` (vérifié : `git diff main <branche>`
est vide). `git worktree prune` puis suppression des branches, quand ce sera commode.

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

**b) `szh.apercuMetadonnees` : on ne peut pas réordonner les chapitres.** Tu l'avais
explicitement demandé (« possibilité de réordonner les chapitres comme les articles »). Ce
n'est pas qu'une question d'affichage : la **persistance est écrite en dur pour la revue**.

**Déjà fait** (commit du 30 août, à ne pas refaire) : le socle de persistance est routé.
`cheminConfig(racine)` rend `ausgabe.yaml` ou `buch.yaml` selon le profil ;
`ecrireClesAusgabe()` et `valeurOrdreArticles()` passent par lui, cette dernière lisant en
plus la clé `profil.unites.ordre`. Et `ordre-chapitres` est entrée dans `CLES_METADONNEES`
et `CLES_LISTES` de `lib/yaml.js` : elle en était absente, donc `analyserAusgabe` la
laissait tomber **en silence** — un livre pouvait porter un ordre parfaitement écrit dans
`buch.yaml` que le cockpit lisait vide.

**Ce qui reste sur ce point :**

- Il subsiste **15 littéraux `'ausgabe.yaml'`** dans `extension.js`
  (`grep -c "'ausgabe.yaml'" extension.js`). La plupart lisent des clés qui n'existent que
  pour un numéro — `revue`, `couleur`, les DOI — et peuvent légitimement rester. À vérifier
  une par une plutôt qu'à remplacer en masse.
- `refusCoedition()` reçoit encore `path.join(racine, 'ausgabe.yaml')` en dur, vers les
  lignes 4704 et 4746, sur le chemin même du déplacement. **À router avant d'exposer le
  moindre bouton de réordonnancement**, sans quoi le bail de co-édition sera posé sur un
  fichier qui n'existe pas.
- Le déplacement passe par `refusDeplacement()`, `articlesSansDoi()` et `trierParDoi()`,
  aux alentours de `extension.js:4732-4750`. Ce sont des **règles de DOI** : un article
  sans DOI ne peut pas franchir la frontière de ceux qui en ont un. **Un livre n'a pas de
  DOI par chapitre** : cette règle ne doit pas s'appliquer, sans quoi le déplacement sera
  refusé sans raison compréhensible.
- Reste enfin à retirer `szh.apercuMetadonnees` de `REVUE_SEULEMENT` et à lui donner une
  vue de chapitres — ou une vue propre au livre.

Ordre de travail conseillé : finir la persistance **d'abord**, parce que c'est la partie
partagée et risquée, celle qui touche la revue ; la faire soi-même, avec les tests. Puis
déléguer les deux formulaires.

**c) Écarts mineurs, même famille.** Pas de formulaire de couverture : le dos est bien
calculé par la chaîne à partir du grammage et du nombre de pages réel, mais rien dans
l'interface ne saisit ces variables. Pas de pastille `word-deja` sur les chapitres déjà
importés.

### 2.2 Extraction de `lib/medias.js`

À **refaire à neuf depuis `main`**. Une tentative précédente a produit un `extension.js`
divergent de 1333 lignes ; ne pas essayer de la réconcilier, elle est abandonnée
volontairement. Repartir du fichier tel qu'il est aujourd'hui.

### 2.3 Livres à produire

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

### 2.4 Défauts connus, non corrigés

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

### 2.5 CMJN, bloqué sur l'image WSL

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
node --test "test/js/*.test.js"      # 607 tests, depuis la racine du dépôt
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
