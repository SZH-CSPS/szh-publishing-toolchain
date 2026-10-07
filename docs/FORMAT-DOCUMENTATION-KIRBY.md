# Format de la Documentation

La Documentation est la rubrique « Actualité et ressources » de la Revue et « News &
Ressourcen » de la Zeitschrift : tour d'horizon, recherches, interventions parlementaires,
livres, films, agenda. Chaque entrée est une **fiche de la Documentation** (à ne pas confondre
avec la fiche de métadonnées d'un article).

Les fiches des deux revues vivent dans une seule bibliothèque, `_NewsUndActu\Fiches\`, écrite
directement au format de contenu du CMS Kirby. Publier sur le site revient à copier ce dossier.
Cette page décrit ce format.

## Le contrat des champs

Les types de fiche, leurs champs et les listes de valeurs sont définis à un seul endroit :
`pipeline/kirby/champs-documentation.json`. Tous les lecteurs le suivent :

| Lecteur | Rôle |
|---|---|
| `vscodium-extension/szh-cockpit/lib/kirby-contenu.js` | lit et écrit les fiches (formulaire, vues, propositions) |
| `pipeline/documentation-kirby.py` | convertit les fiches d'un numéro en Markdown pour le PDF |
| `pipeline/filters/szh-rubrique.lua`, `szh-ressource.lua` | mettent la Documentation en page dans le PDF |
| `kirby/generer-blueprints.js` | génère les blueprints du site Kirby ([`kirby/LISEZMOI.md`](../kirby/LISEZMOI.md)) |
| les moissonneurs | lisent le contrat pour remplir leurs propositions ([`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md)) |

Un champ s'ajoute, se renomme ou change de liste dans ce JSON, puis on régénère les blueprints.

## Arborescence

```
<racine>\_NewsUndActu\
├── Fiches\                         la bibliothèque, copiée telle quelle vers le site
│   ├── rundschau\  forschung\  vorstoesse\  buecher\  filme\  revueblick\  weiterbildung\
│   └── buecher\<slug>\             un dossier par type, puis un dossier par fiche
│       ├── livre.fr.txt            le fichier de la Revue (facultatif)
│       ├── livre.de.txt            le fichier de la Zeitschrift (facultatif)
│       └── <image>                 couverture ou affiche, commune aux deux langues
└── _Statuts\
    ├── fr\<uuid>.txt               décision de la Revue sur une fiche allemande
    └── de\<uuid>.txt               décision de la Zeitschrift sur une fiche française
```

- `<racine>` est la racine active, de test ou de production ; le reste de l'arborescence est
  dans [`EMPLACEMENTS.md`](EMPLACEMENTS.md).
- Le cockpit retrouve `<racine>` depuis un numéro en remontant les dossiers et en reconnaissant
  leurs noms (`Revue`, `Zeitschrift`, `_Archive`, `_NewsUndActu`), sans compter les niveaux : un
  numéro archivé est un niveau plus bas qu'un numéro en cours (`racineArbre` de
  `lib/kirby-contenu.js`).
- Langue et revue vont ensemble : `fr` = Revue, `de` = Zeitschrift (clé `revues` du contrat).
- `_NewsUndActu\_Moissons\` appartient aux moissonneurs ([`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md)).

## Le numéro

- `ausgabe.yaml` porte un `id` de 16 caractères `[A-Za-z0-9]`. Il est posé à l'ouverture du
  numéro s'il manque, puis ne change plus, ni au renommage ni à l'archivage.
- Si deux numéros portent le même `id` (un dossier copié à la main), le cockpit avertit à
  l'ouverture ; il ne change rien de lui-même.
- L'article Documentation du numéro (`articles/NN-<slug>/`, `type: documentation` dans sa fiche
  de métadonnées) ne contient que `<slug>.meta.yaml` et `documentation.<lang>.txt` : le titre,
  l'Uuid et les rubriques. Les rubriques restent dans le numéro et ne vont pas sur le site.
- Un numéro contient les fiches dont le fichier de sa langue porte `Ausgabe: <son id>`.

## Une fiche

| Élément | Règle |
|---|---|
| Dossier | `Fiches\<dossier du type>\<slug>\`. Le dossier du type est `types[].dossier` du contrat, un mot allemand en minuscules ASCII, qui ne se renomme pas. Changer le type d'une fiche la déplace |
| Slug | tiré du titre à la création (`lib/slug.js`), avec `-2`, `-3` en cas de collision dans le dossier du type. Il ne change plus ensuite, et ne porte pas de numéro d'ordre : un numéro ne peut pas imposer son rang à un dossier que l'autre langue partage |
| Fichiers | un par langue, `<type>.<lang>.txt`, le même type pour les deux |
| `Uuid` | 16 caractères, le même dans les deux fichiers, posé à la création |
| Champs traduisibles | ceux qui portent `"traduire": true` (`title`, `descriptif`, `lien_libelle`, et `libelle` d'une ligne de suivi) : propres à chaque fichier de langue |
| Champs communs | tous les autres (listes, dates, numéro, `curia`, liens, image, auteurs, éditeur…) : écrits à l'identique dans chaque fichier existant. Enregistrer un fichier les recopie dans l'autre. Dans le `suivi`, dates, genres et liens sont communs, le libellé de chaque ligne est propre à la langue (lignes appariées par leur rang) |

Une fiche traduite est donc un seul dossier avec deux fichiers de langue, pas une copie.

Dans `Fiches\`, un sous-dossier inconnu est ignoré avec un avertissement. Un fichier
`<type>.<lang>.txt` rangé sous le dossier d'un autre type est une erreur signalée.

### Les champs système

Écrits par Pronto dans chaque fichier de langue, jamais saisis (`champsSysteme` du contrat) :

| Champ | Sens |
|---|---|
| `Ausgabe` | l'`id` du numéro de cette langue. Vide : la fiche est **orpheline** (rattachée à aucun numéro). Toujours écrit, même vide |
| `Ordre` | le rang d'impression dans ce numéro (1 à N), recalculé à chaque enregistrement d'une fiche du numéro. Absent pour une orpheline |
| `Origine` | l'Uuid d'une fiche archivée, posé une fois par « Reprendre dans ce numéro » (onglet Archive). Absent pour une fiche née autrement |

Retirer une fiche d'un numéro vide son `Ausgabe` : elle devient orpheline. Seule une orpheline
se supprime : on ôte le fichier de sa langue, et s'il n'en reste aucun, le dossier entier part,
image comprise.

## Les statuts de traduction

`_NewsUndActu\_Statuts\<langue cible>\<uuid>.txt` : un fichier par décision, pour que deux postes
n'écrivent jamais le même fichier OneDrive.

```
Statut: a-traduire

----

Date: 2026-09-23
```

`Statut` vaut `a-traduire` ou `ignore`.

Les statuts vivent hors de `Fiches\`. Écrit dans le fichier de l'autre langue, un statut
créerait une copie en conflit si une collègue édite la fiche au même moment. Un faux fichier de
langue ferait aussi afficher par Kirby le texte de l'autre langue. Quand le fichier de la langue
cible existe, la fiche est traduite et son statut ne compte plus.

## Les vues du cockpit

Pour une revue de langue L et le numéro ouvert N :

| Vue | Contenu | Gestes |
|---|---|---|
| Traductions à faire | les fiches qui ont un fichier dans l'autre langue, pas de fichier L, et le statut L `a-traduire` | « Traduire dans ce numéro » crée le fichier L : champs communs recopiés, champs traduisibles repris du texte source pour être réécrits, `Ausgabe` = N |
| Réservoir | (a) les fiches de l'autre langue rattachées à un de ses numéros, sans fichier L ni statut L, filtrables par numéro de l'autre revue ; (b) les orphelines de L | (a) « à traduire » ou « ignorer », en sélection multiple ; un interrupteur montre les ignorées. (b) « Tirer dans ce numéro » |
| Documentation du numéro | les rubriques, et les fiches dont `Ausgabe` = N | |
| Archive | toute la bibliothèque, en lecture seule, lue sur la racine de production même en mode test (ancrage SharePoint de `resoudreAncrage`, `lib/rapport-erreur.js`). Recherche plein texte, filtres type, revue, numéro, année | « Reprendre dans ce numéro » crée une fiche neuve dans la bibliothèque active (nouvel Uuid, nouveau dossier), dans la langue du numéro, préremplie depuis la fiche archivée, avec `Origine` = son Uuid. La fiche archivée ne change pas |

## La syntaxe d'un fichier `.txt`

C'est le format de contenu de Kirby, lu et écrit par `lireTxt` et son sérialiseur dans
`lib/kirby-contenu.js`.

```
Title: Lernen ohne Barrieren

----

Uuid: 4fK9qL2mXa7Bc3Dz

----

Ausgabe: 8hT2kW9pQr4Ls6Nv

----

Ordre: 3

----

Categorie: manuel

----

Descriptif:

Premier paragraphe.

Second paragraphe.
```

| Règle | Détail |
|---|---|
| Séparateur | une ligne `----` entourée de lignes vides, entre deux champs |
| Champ | `Clé: valeur` sur une ligne. Une valeur sur plusieurs lignes : `Clé:`, une ligne vide, puis la valeur |
| Clés | `a-z0-9_`, écrites avec l'initiale en majuscule (`Title`, `Lien_libelle`, `Dossier_references`), lues sans tenir compte de la casse. Le champ `title` du contrat est le champ Kirby `Title` |
| Ligne `----` dans une valeur | s'écrit `\----`, et se relit sans le `\` |
| Ordre d'écriture | `Title`, `Uuid`, `Ausgabe`, `Ordre`, `Origine`, puis les champs dans l'ordre du contrat. Un champ vide ne s'écrit pas, sauf `Ausgabe` |
| Fin de fichier | un `\n` |

Selon la saisie du champ (`saisie` dans le contrat) :

| Saisie | Écriture |
|---|---|
| `date` | `AAAA-MM-JJ` |
| `date_partielle` | `AAAA`, `AAAA-MM` ou `AAAA-MM-JJ` |
| `annee` | `AAAA` |
| `derive` (`curia`) | calculé par Pronto à chaque écriture, depuis `instruments[categorie].curia` ; jamais saisi |
| `fichier` (`couverture`) | `Couverture:`, une ligne vide, puis `- <nom-du-fichier>` |
| `liste_multiple` (genre et pays d'un film) | plusieurs jetons de la même liste sur une ligne : `Genre: drame, comedie` (virgule et espace, comme le champ `multiselect` de Kirby), dans l'ordre de saisie, sans doublon. Les pays sont des codes ISO 3166-1 alpha-2 (`FR`, `US`, `CH`) |
| `structure` (`suivi`) | `Suivi:`, une ligne vide, puis une liste YAML (ci-dessous) |

```
Suivi:

-
  date: "2026-08-20"
  genre: "prise-position"
  libelle: "Antwort des Regierungsrates"
  lien: "https://…"
```

En écriture, chaque valeur du suivi est une chaîne JSON et une clé vide est omise. En lecture,
les valeurs sans guillemets ou entre apostrophes (ce qu'écrit le Panel de Kirby) sont acceptées.

Les dates s'impriment en forme suisse, la même en fr et en de : `05.01.2026`, `03.2026`,
`29.06.–02.07.2026` (fonctions de `szh-commun.lua`). Le formulaire du cockpit montre cette forme
sous chaque champ de date (`szh-date-apercu.lua`).

## Les types et leurs listes de valeurs

Les valeurs de liste sont des jetons, jamais des libellés. Le libellé fr et de de chaque jeton
est dans le contrat (`listes`). Ce tableau situe les listes ; le JSON fait foi pour les valeurs.

| Type | Dossier | Listes utilisées |
|---|---|---|
| `horizon` | `rundschau` | `portee` (5 : international, national, intercantonal, régional, varia), `canton` (27 : CH et les 26 cantons) |
| `recherche` | `forschung` | aucune |
| `intervention` | `vorstoesse` | `canton`, `instrument` (20), `etat` (9), `source` (4) ; dans le `suivi`, `genre_suivi` (4) |
| `livre` | `buecher` | `categorie_livre` (7) |
| `film` | `filme` | `categorie_film` (3), `genre_film` (9), `pays` (250) |
| `reprise` | `revueblick` | `revue` (2) |
| `agenda` | `weiterbildung` | `evenement` (6) |

- `instrument` porte, pour chaque jeton, son type Curia (`curia`, 1 à 19) et les cantons où
  l'instrument existe (`cantons`), qui passent en tête du menu quand ce canton est choisi. Un
  instrument `local` montre ses cantons entre parenthèses dans le menu (« Anzug (BS) ») ; la
  valeur stockée reste le jeton.
- Livres et films portent une pastille de catégorie (`pastille` du type).

## Les rubriques

Les rubriques sont les textes libres de la Documentation d'un numéro, dans
`documentation.<lang>.txt` : `Dossier_references`, `Dossier_liens`, `Ressources`, `Podcasts`.
Leur contenu est du Markdown simple : paragraphes, *italique*, **gras**, liens `[texte](url)`,
listes, intertitres `##` et `###`. `Ressources` n'existe que pour la Revue (`rubriques[].revues`).

## L'ordre d'impression (`Ordre`)

Dans un numéro, les types se suivent dans l'ordre de `ordreTypes`. Dans un type, l'ordre suit
`tri` :

| Type | Tri |
|---|---|
| `intervention` | Confédération (`CH`) d'abord (`triPremier`), puis les cantons par code alphabétique, puis le titre |
| `horizon` | `portee` (dans l'ordre de sa liste), puis canton, puis titre |
| `agenda` | date de début, puis titre |
| les autres | titre |

Les textes se comparent par `localeCompare` dans la langue du numéro, avec
`sensitivity: 'base'` et `numeric: true`. Une même fiche a deux `Ordre`, un par langue, puisqu'elle
appartient à un numéro de chaque revue.

## Les sections du PDF

Les sections se suivent dans l'ordre de `ordreSections` : les quatre rubriques, puis les sept
types. Une section vide ne s'imprime pas. Son titre est `rubriques[].titre` ou
`types[].libelle` dans la langue du numéro, sans numéro.

## Le site Kirby

Le site lit la bibliothèque telle que Pronto l'écrit. Pour qu'il dise la même chose que le PDF,
il suit ces règles.

**Arborescence.** La bibliothèque est copiée sous `content/actualites/`. Chaque dossier de type
(`rundschau`, `forschung`…) y devient une page dossier, parente des fiches de ce type. Le
gabarit de la page dossier porte le nom du dossier (`buecher`), celui d'une fiche porte le nom du
type (`livre`). Pronto n'écrit pas le fichier de contenu des pages dossier
(`<dossier>.fr.txt`, `<dossier>.de.txt`, avec `Title: <types[].libelle>`) : la copie vers le
site doit le créer s'il manque. `_Statuts\` et les rubriques des numéros ne partent pas sur le
site.

**Rattachement et ordre.** Une page de numéro liste les fiches dont le fichier de sa langue
porte `Ausgabe: <id du numéro>`, triées par `Ordre`. Les fiches sont des petits-enfants de
`actualites` : `$actualites->children()->children()`, pas `children()`. Les dossiers de fiche
n'ont pas de préfixe numérique : ce sont des pages non listées au sens de Kirby, qu'il ne faut
pas filtrer par `listed()`. Le tri manuel du Panel est désactivé (`sortable: false`) : un
glisser-déposer casserait l'ordre du PDF, et la copie suivante le déferait.

**Une fiche dans une seule langue.** Pronto écrit une fiche dans la langue de la revue qui la
porte, et seulement celle-là. La documentation de Kirby demande pourtant qu'un fichier de la
langue par défaut existe toujours. Avec Kirby 5.6 et le français comme langue par défaut :

- une fiche en `.de.txt` seul s'affiche sous `/de/` ; sous `/fr/`, la page répond avec des champs
  vides ;
- une fiche en `.fr.txt` seul s'affiche en français sous `/de/`, sans avertissement. Elle
  n'entre dans aucun numéro allemand, mais une page qui liste toute la bibliothèque la
  montrerait ;
- `$page->translation('fr')->exists()` répond vrai même sans fichier : il faut tester la présence
  du fichier sur le disque.

Le nom des fichiers de langue (`{template}.{langue}.txt`) est réglé dans `kirby.fichierContenu`
du contrat.

**Affichage.**

- Un lien sans `lien_libelle` s'intitule d'après le type et le titre (« En savoir plus sur le
  livre … », « Mehr zum Buch … »). Les formules sont dans `types[].libelleLien` : le site les
  lit, il ne les recopie pas.
- Livres et films portent la pastille de leur catégorie, libellé pris dans le contrat.
- Les dates s'affichent en forme suisse, y compris les dates partielles des recherches et les
  plages de l'agenda (`05.–06.01.2026`).
- Le suivi d'une intervention s'imprime avec la formule de son genre (`suiviImprime` du
  contrat : « {genre} du {date} : {libelle} »).
- Le canton d'un tour d'horizon ne s'affiche que si `portee` vaut `regional`.
- `curia` et `source` sont des données de travail : ils ne s'affichent pas.
- La couverture d'un livre ou l'affiche d'un film est décorative : `alt=""`, pas de légende.
  L'image double le titre, qu'un lecteur d'écran lit déjà. Le champ s'appelle `couverture`, car
  `image` est une méthode réservée de Kirby.
- Les règles typographiques de Pronto ([`TYPOGRAPHIE.md`](TYPOGRAPHIE.md)) s'appliquent à la
  compilation du PDF, pas au texte des fiches : le site affiche le texte tel qu'il est saisi.

**`curia` dans le Panel.** `curia` se déduit de `categorie` et ne se saisit pas : le blueprint en
fait un champ caché. Une catégorie changée dans le Panel laisse donc un `curia` périmé tant
qu'aucun hook ne le recalcule.

**Markdown du descriptif.** Le `descriptif` d'une fiche passe par pandoc dans le PDF
(`documentation-kirby.py` le transmet tel quel) et par KirbyText sur le site. Deux syntaxes s'y
rendent différemment : les attributs et notes de pandoc (`{.classe}`, `^[…]`), et un texte entre
parenthèses que KirbyText prend pour une balise (`(link: …)`, `(date: …)`).

**Blueprints.** Les blueprints du site sont générés depuis le contrat et déployés tels quels
([`kirby/LISEZMOI.md`](../kirby/LISEZMOI.md)). Un blueprint retouché sur le site divergerait en
silence du formulaire du cockpit et du PDF.
