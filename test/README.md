# Tests et bancs d'essai

Ce dossier contient les tests de Pronto : les tests Node du cockpit et du pipeline, un banc de
rendu (une mini-revue et des livres de test), des corpus de mesure et des scripts de contrôle.
Comment lancer la suite, ce que fait la CI et comment comparer un rendu avant/après :
[`docs/DEVELOPPEMENT.md`](../docs/DEVELOPPEMENT.md).

Tout Python se lance dans la WSL `SZH-Publishing`, depuis PowerShell :
`wsl.exe -d SZH-Publishing -- bash -lc "cd /mnt/c/<dépôt> && …"`. Les tests Node le font
d'eux-mêmes, par `python()` et `pythonGroupe()` de `test/js/gardes.js`.

## Commandes

| Commande | Ce qu'elle fait |
|---|---|
| `node --test test/js/*.test.js` | les tests du cockpit et du pipeline (voir la [suite exigeante](../docs/DEVELOPPEMENT.md#la-suite-exigeante)) |
| `node --test test/filtres-pandoc.test.js test/filtres-import.test.js test/filtres-note-credits.test.js` | les filtres Lua, avec un vrai pandoc |
| `bash test/build-render.sh [slug]` | le banc de rendu complet, ou un seul article |
| `python3 test/typo-check.py [--corriger]` | la typographie des textes visibles, fr et de |
| `python3 test/typo-articles.py [-v]` | le filtre de typographie des articles |
| `python3 test/apca-check.py` | les contrastes de la palette |
| `python3 test/palette-html.py` | régénère `docs/palette.html` |
| `~/pdfvenv/bin/python test/render.py <pdf> <png> [page] [échelle]` | rend une seule page en PNG |

## Les tests Node (`test/js/`)

Un fichier `*.test.js` par sujet. Les outils communs :

| Fichier | Rôle |
|---|---|
| `gardes.js` | lance Python (dans la WSL sous Windows), détecte les outils présents, et fournit les assistants `sauter.*` qui écrivent un motif de saut reconnu |
| `motifs-saut.js` | les motifs de saut admis, par environnement (`poste`, `ubuntu`, `windows`) |
| `verifier-tap.js` | relit la sortie TAP d'une suite et refuse un échec, un test annulé, plus de la moitié des tests sautés, ou un saut sans motif admis |
| `porte-release.js` | rejoue en local les contrôles de la CI avant une release |
| `hote-factice.js` | active `extension.js` avec un faux `vscode`, sur une revue temporaire |
| `dom-minimal.js` | un DOM réduit pour exécuter le script d'une webview hors de l'éditeur et compter ce qu'il construit |
| `pilote-python.js`, `../pilote-python.py` | font passer tous les appels Python d'un fichier de test par un seul processus |
| `figures-fabrique.js` | fabrique des documents Word de test |
| `fixtures/` | petites données de test versionnées |

Les tests Python `couverture-*.test.py` et `livre-assembler.test.py` sont lancés par des tests
Node (`couverture-livre.test.js`, `livre-assembleur-py.test.js`). `documentation-kirby.test.py`,
`liens-courts.test.py` et `livre-migrer-meta.test.py` se lancent à la main, dans la WSL
(`python3 test/<nom>.test.py`).

Les fichiers `test/filtres-*.test.js` et `test/documentation-kirby.test.js`, à la racine de
`test/`, demandent un vrai pandoc. En CI, les trois `filtres-*` tournent dans le job `pdf-ua`.

## Le banc de rendu

`test/build-render.sh` se lance dans la WSL :

```sh
bash outils-dev/venv-dev.sh            # crée ~/pdfvenv, une fois par poste
bash test/build-render.sh              # tout le banc
bash test/build-render.sh contenu-long # un seul article de la mini-revue
```

Dans l'ordre, il :

1. compile chaque article de la mini-revue, rend ses pages en PNG et lance `figures-check.py` ;
2. vérifie le PDF/UA-1 de la mini-revue (`make verifier-ua`) ;
3. compile le corpus d'accessibilité, vérifie son PDF/UA-1, et vérifie que
   `make verifier-numerotation` y trouve bien l'écart attendu ;
4. compile les livres `livre-normal` et `livre-falc` (PDF, PDF imprimeur, couverture, HTML,
   EPUB), refuse un PDF sorti non balisé, vérifie le PDF/UA-1 et lance
   `livre-sorties-check.py` ;
5. compile le PDF imprimeur d'une copie de `livre-normal` avec un profil CMJN et lance
   `cmjn-check.py` (sauté si le profil ICC manque) ;
6. compile les modèles de couverture `recherche` et `prospectrum` sur des copies de
   `livre-normal` ;
7. compile `livre-collectif` et vérifie les cotes de la maquette (`livre-cotes-check.py`) ;
8. contrôle les EPUB (`epub-check.py`) ;
9. contrôle les polices (`polices-check.py`, `glyphes-manquants.py --verifier`,
   `metriques-titre.py --verifier`).

Les étapes 2 à 9 sont sautées quand on passe un seul article. Le script sort en échec (code 1)
si un verdict est rouge.

Les PDF et les PNG (une image par page) sont écrits dans `test/out/<slug>/` et
`test/<livre>/out/`, ignorés par git.

| Variable | Défaut | Rôle |
|---|---|---|
| `SZH_RENDER` | `~/pdfvenv/bin/python` | l'interpréteur qui rend les PNG ; sans lui, le banc compile sans rendre d'image |
| `SZH_FONTTOOLS` | `/opt/weasyprint/bin/python` | l'interpréteur des contrôles qui importent WeasyPrint ou fontTools |
| `VERAPDF`, `VERAPDF_JAVA` | `/opt/verapdf-cli/verapdf`, `/opt/jre-min` | veraPDF |
| `SZH_ICC_DIR`, `SZH_ICC_NOM` | `/opt/icc`, `PSOuncoated_v3_FOGRA52.icc` | le profil CMJN de l'étape 5 |

Un PDF sorti non balisé est une vraie panne : quand le baliseur de WeasyPrint échoue (un
tableau mal placé suffit), le Makefile sort un PDF sans balises, sans message visible. Voir
`pipeline/filters/szh-tableau-boite.lua`.

## La mini-revue (`test/`)

`test/ausgabe.yaml` et `test/articles/` forment un numéro de test, qui éprouve la maquette. Il
n'est pas fait pour être publié.

| Article | Ce qu'il éprouve |
|---|---|
| `contenu-long` | un article de plus de six pages : titres de niveau 1 à 4, listes, citation, encadrés, deux tableaux, notes de bas de page ; les coupures de page difficiles et le dimensionnement des tableaux |
| `couverture-stress` | la couverture sous contrainte : douze auteurs, dix mots-clés, titre et sous-titre longs |
| `figures` | les cas d'image : figure numérotée, image hors numérotation avec et sans crédits, image décorative (`alt=""`), image de trop faible résolution (qui ne doit pas être agrandie), la même image insérée deux fois, deux grilles d'images |
| `lecteur-ecran` | l'encadré « ce qu'un lecteur d'écran reçoit » de l'aperçu (`szh-apercu-lecteur-ecran.lua`) ; à regarder dans l'aperçu, pas dans le PDF |
| `documentation` | la page Documentation, en allemand pour exercer les libellés allemands |

La couverture se compose par défaut en en-tête compact (clé `entete-condensee` absente). Pour
voir l'autre allure, ajouter `entete-condensee: false` à `test/ausgabe.yaml`, recompiler,
comparer les PNG, puis retirer la ligne.

### La page Documentation et ses fiches (`news-racine/`)

L'article `documentation` ne porte que `documentation.de.txt` (deux rubriques de texte) et
`documentation.meta.yaml`. Ses fiches vivent dans une bibliothèque de test,
`test/news-racine/_NewsUndActu/Fiches/<type>/<slug>/`, qui imite la bibliothèque partagée
des deux revues ([`docs/FORMAT-DOCUMENTATION-KIRBY.md`](../docs/FORMAT-DOCUMENTATION-KIRBY.md)).
Les fiches du numéro portent `Ausgabe: wj7f0dcw97qk3p2s`, l'`id` de `test/ausgabe.yaml`.

Ce que la page doit montrer :

- une fiche livre (`soziale-emotionale-entwicklung`) plus haute qu'une page, qui commence sur
  une page et continue sur la suivante, sans page blanche entre les deux ;
- une rubrique (`Dossier_references`) dont les titres ne sont pas numérotés et se placent sous
  le titre de la rubrique ;
- un descriptif d'agenda (`fulle-und-grenzen`) qui commence par « 13. » et doit s'imprimer en
  paragraphe, pas en liste numérotée à partir de 1 (WeasyPrint ignore l'attribut `start` d'un
  `<ol>`) ;
- trois interventions : deux de Zurich et une de la Confédération, qui sort en premier ; l'une
  des deux zurichoises a un suivi sur deux lignes, l'autre n'a pas de descriptif ;
- deux fiches de tour d'horizon : l'une internationale (pas de canton affiché), l'autre
  régionale (canton BE affiché) ;
- une date partielle sur la fiche de recherche (`2020`, puis `2026-03` affiché « 03.2026 ») ;
- un libellé de lien rempli sur une fiche, vide sur une autre (qui prend le libellé par défaut
  du type).

La bibliothèque contient aussi trois cas qui ne s'impriment pas dans la mini-revue, lus par
`documentation-kirby.test.py` et `.test.js` : une fiche bilingue rattachée à deux numéros
(`rencontre-partagee`), une fiche sans numéro (`orpheline-sans-numero`) et un fichier de statut
(`_Statuts/`) qui ne doit pas être lu comme une fiche.

`test/` n'est pas rangé sous `Revue\` ni `Zeitschrift\` : sa bibliothèque ne se trouve pas
toute seule. `build-render.sh` exporte donc `SZH_NEWS_RACINE`. Pour compiler la page à la
main, depuis `test/` :

```sh
export SZH_NEWS_RACINE="$(pwd)/news-racine"
make -f ../pipeline/Makefile out/documentation/documentation.pdf
```

Les tests passent la racine explicitement au convertisseur (`--racine-news`).

## Les livres

Le moteur livre a son propre banc : la numérotation qui court d'un chapitre à l'autre, le
sommaire paginé, l'ouverture de chapitre sur une belle page et la conformité PDF/UA d'un
document de plusieurs chapitres.

| Dossier | Ce qu'il éprouve |
|---|---|
| `livre-normal/` | une monographie allemande, maquette « normal » : numérotation continue des figures, note de bas de page, chapitre plus court qu'une page, pièces liminaires, bibliographie détachée, tableau avec description longue (`data-alt`, jamais imprimée), image décorative, grille d'images |
| `livre-falc/` | un ouvrage collectif français, maquette FALC (facile à lire et à comprendre) : une phrase par ligne, texte au fer à gauche sans césure, pastille de chapitre, encadré de résumé, auteurs propres à chaque chapitre (dont la clé `auteurs:`, alias de `author:`) |
| `livre-collectif/` | un ouvrage collectif allemand, maquette « normal », chaque réglage de mise en page à une valeur autre que le défaut : auteurs de chapitre, numérotation qui repart à chaque chapitre, parties romaines et arabes, notices en grille de portraits, impressum complet |

Compiler un livre à la main, dans la WSL, depuis son dossier :

```sh
make -f ../../pipeline/Makefile livre        # le PDF
make -f ../../pipeline/Makefile livre-epub   # l'EPUB 3
```

Voir [`docs/ARCHITECTURE-LIVRES.md`](../docs/ARCHITECTURE-LIVRES.md).

## Le corpus d'accessibilité (`accessibilite/`)

Un second numéro de test, séparé de la mini-revue. La vérification PDF/UA prend le numéro
entier : un article fautif dans `test/articles/` ferait échouer tout le banc.

Il exerce : un tableau sans rangée d'en-tête et un tableau sans légende, une bibliographie à
noms polonais, turcs et serbes, des sauts de niveau de titre, un article français dans un
numéro de la Zeitschrift, et une paire d'articles français et allemand (`participation-fr`,
`teilhabe-de`) dont les numéros de figure diffèrent volontairement.

Attendus : la vérification PDF/UA rend 0, car aucun article n'y est non conforme ;
`make verifier-numerotation` rend 1, sans quoi ce contrôle ne pourrait jamais échouer. Le
détail est dans la note de tête de `accessibilite/ausgabe.yaml`.

## Le corpus de composition (`composition/`)

Huit articles réellement publiés (quatre de la Revue, quatre de la Zeitschrift, sous licence
CC BY 4.0), en deux numéros. Ils servent à mesurer la composition : césures, suites de lignes
coupées, coupures en bas de page, blancs de justification, nombre de pages.

```sh
/opt/weasyprint/bin/python test/composition-check.py <numéro> [--reference test/composition/reference.json]
```

Il ne tourne ni dans le banc ni en CI. On le lance à chaque montée de WeasyPrint ou de pandoc,
et avant de toucher aux réglages de césure de `print.css` : le banc est trop court pour juger
ces réglages. Mode d'emploi et attributions : [`composition/LISEZMOI.md`](composition/LISEZMOI.md).

## Les corpus hors dépôt

Le dépôt est public : aucun manuscrit réel n'y entre. Quelques tests lisent des corpus rangés
dans `tmp/`, qui n'est pas suivi par git et peut être vidé :

| Dossier | Lu par |
|---|---|
| `tmp/corpus-relecture/` | les tests du nettoyeur de manuscrit (`manuscrit-*.test.js`) |
| `tmp/lexique-sources/` | `lexique-noms-publics.test.js` |
| `tmp/docx-dev/` | `lexique-noms.test.js` |

Absents, ces tests sautent sous le motif « corpus hors dépôt absent ».

## Les scripts de contrôle

| Script | Ce qu'il vérifie | Lancé par |
|---|---|---|
| `apca-check.py` | le contraste APCA de chaque paire texte/fond de `couleurs.css`, des couleurs d'accent et de `print.css` | CI ; à relancer après toute retouche de couleur |
| `palette-html.py` | régénère `docs/palette.html`, la planche de la palette | à la main, après toute retouche de `couleurs.css` |
| `typo-check.py` | la typographie des textes visibles (i18n, `package.nls*.json`, `$SzhTextes`, messages des filtres…), par langue | CI ; `--corriger` applique les corrections sûres, `--liste` montre les règles |
| `typo-articles.py` | le filtre `szh-typographie.lua`, sur des fragments Markdown passés par un vrai pandoc ; échoue si pandoc manque | à la main |
| `figures-check.py` | aucune légende de figure ne reste seule sur sa page | banc, CI |
| `polices-check.py` | les caractères écrits par la maquette sont dans les polices livrées, et aucun PDF n'embarque de police de repli du système | banc, CI |
| `../pipeline/fonts/glyphes-manquants.py --verifier` | les caractères que la maquette écrit d'elle-même existent dans les polices | banc, CI |
| `metriques-titre.py --verifier` | la table de largeurs de `szh-titre-lignes.lua` correspond à la police du titre | banc, CI |
| `cmjn-check.py` | le PDF imprimeur : texte en noir seul (K), couleurs de la maison, aucun RVB | banc |
| `livre-sorties-check.py` | les sorties d'un livre : folios, métadonnées, couverture, EPUB | banc |
| `livre-cotes-check.py` | les cotes de la maquette « normal », à 0,25 mm près | banc |
| `epub-check.py` | la structure d'un EPUB (mimetype, OPF, manifeste, liens internes, sommaire) | banc |
| `weasyprint-patch-check.py` | chaque correctif WeasyPrint posé tient (veraPDF et arbre de structure) | CI ; à la main avec `/opt/weasyprint/bin/python3` |
| `tableaux-largeurs-check.py` | la largeur des colonnes de tableau | CI |
| `composition-check.py` | la composition du corpus de composition | à la main |

Les contrôles qui lisent des PDF rendent leur verdict par l'absence de ligne `FAIL`.
