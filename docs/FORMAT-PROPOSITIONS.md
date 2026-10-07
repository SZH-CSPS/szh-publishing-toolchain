# Format des propositions

Un moissonneur cherche des nouveautés pour la Documentation (interventions parlementaires,
projets de recherche). Il ne crée pas de fiche : il dépose des **propositions**. La rédaction
les accepte ou les refuse dans la vue Propositions du cockpit, et seul le cockpit écrit la fiche
(`lib/kirby-contenu.js`).

Cette page décrit les fichiers échangés entre les moissonneurs et le cockpit. Elle vaut pour
tous les moissonneurs, présents et à venir.

| Côté | Code |
|---|---|
| moissonneurs | `moissonneurs/commun.py`, puis `parlement/` et `recherche/` ([`LISEZMOI.md`](../moissonneurs/LISEZMOI.md)) |
| cockpit | `vscodium-extension/szh-cockpit/lib/propositions.js`, `lib/resumes.js` |

Les champs d'une fiche, leurs types et leurs listes de valeurs viennent du contrat
`pipeline/kirby/champs-documentation.json` ([`FORMAT-DOCUMENTATION-KIRBY.md`](FORMAT-DOCUMENTATION-KIRBY.md)).
Un moissonneur le lit, comme la bibliothèque `Fiches\`, sans jamais y écrire. L'état que les
moissonneurs gardent entre deux passes est décrit à part, dans [`FORMAT-MOISSONS.md`](FORMAT-MOISSONS.md).

## Arborescence

```
<racine>\_NewsUndActu\
├── Fiches\                          la bibliothèque : un moissonneur la lit, n'y écrit pas
└── _Moissons\
    ├── <moissonneur>\               un dossier par moissonneur, nom court en minuscules
    │   ├── AAAA-MM-JJ-<n>.jsonl     un lot par exécution qui a trouvé quelque chose
    │   ├── etat.json                l'état de la dernière exécution
    │   └── demandes\<id>.json       les demandes sur le lexique (écrites par le cockpit)
    ├── _Decisions\<empreinte>.txt   une décision de la rédaction par proposition (cockpit)
    ├── _Resumes\<langue>\<empreinte>.json   un résumé généré par Mistral (cockpit)
    └── _Reglages\<langue>.json      le réglage partagé de la finesse du tri (cockpit)
```

- `<racine>` est la racine active : la production, ou `Revues-TESTING` en mode test
  ([`EMPLACEMENTS.md`](EMPLACEMENTS.md)).
- Un dossier dont le nom commence par `_` n'est pas un moissonneur.
- Un moissonneur n'écrit que dans son propre dossier. Il lit `_Decisions\` sans y écrire.
- Tous les fichiers s'écrivent d'un coup : sous un nom temporaire, puis renommés.

## Le lot

| Règle | Détail |
|---|---|
| Nom | `AAAA-MM-JJ-<n>.jsonl` : la date de l'exécution, puis 1, 2, 3… dans la journée. Le cockpit trie par date, puis par `<n>` lu comme un nombre (`-10` après `-2`). Un `.jsonl` à un autre nom est signalé et ignoré |
| Contenu | une proposition par ligne, en JSON sur une ligne, UTF-8, fin de ligne `\n` |
| Écriture | sous un nom qui ne finit pas par `.jsonl` (`….jsonl.tmp`), puis renommé. Un lot n'est jamais modifié ensuite |
| Lot vide | il n'existe pas : une exécution qui n'a rien trouvé n'écrit pas de lot |

Une erreur reste locale :

- une ligne illisible est écartée, pas le lot ;
- un lot illisible est signalé et ignoré, les autres sont lus ;
- une ligne d'un format, d'un type ou d'une langue inconnus est signalée et ignorée.

Une même `cle` qui revient dans un lot plus récent remplace l'ancienne. Dans un même lot, la
dernière ligne l'emporte. Une `cle` déjà décidée n'est pas reproposée, et le cockpit la masque
de toute façon.

## Une proposition : `pronto-proposition/1`

```json
{
  "format": "pronto-proposition/1",
  "cle": "parlement:openparldata:CHE:2026-0412",
  "moissonneur": "parlement",
  "type": "intervention",
  "langue": "de",
  "recolte": "2026-10-02T14:12:00Z",
  "lien_source": "https://parlement.exemple.ch/affaire/2026-0412",
  "valeurs": { "title": "…", "canton": "CH", "categorie": "postulat", "numero": "26.412",
               "lien": "https://parlement.exemple.ch/affaire/2026-0412", "source": "openparldata" },
  "doutes": [
    { "champ": "date", "code": "date-illisible", "detail": "jour et mois en toutes lettres",
      "suggestion": "2026-03-04" }
  ],
  "brut": { "date": "4. März", "categorie": "Postulat" },
  "pertinence": { "verdict": "a-relire", "raison": "ancrage faible dans le titre seul" },
  "doublon": null
}
```

| Champ | Règle |
|---|---|
| `format` | `pronto-proposition/1`. Une autre valeur fait ignorer la ligne |
| `cle` | `<moissonneur>:<source>:<identifiant stable>`. C'est l'identité de la proposition, pour toujours : une décision s'y rattache. L'identifiant est celui de la source (`CHE` par exemple), pas un jeton de Pronto |
| `moissonneur` | le nom de son dossier sous `_Moissons\` |
| `type` | un type du contrat (`intervention`, `recherche`…). Il choisit l'onglet de la vue |
| `langue` | `fr` ou `de`. Toujours présent, sauf sur une ligne multilingue, qui porte `langues` à la place (voir [Les langues](#les-langues)) |
| `langues`, `titres` | une ligne multilingue seulement |
| `recolte` | date et heure de la lecture, ISO 8601 en UTC |
| `lien_source` | la page d'origine, que la rédaction ouvre pour juger |
| `valeurs` | les champs du type, avec les jetons de Pronto (`canton: "CH"`). Une valeur n'y entre que si elle respecte la saisie du contrat ; sinon le champ reste vide et un doute le dit. Une clé vide s'omet. Une `liste_multiple` est un tableau de jetons ; un `suivi` est un tableau d'objets |
| `doutes` | ce que le moissonneur a deviné ou n'a pas pu lire, champ par champ : `{ champ, code, detail, suggestion? }`. `detail` explique sans répéter la valeur lue. `suggestion`, facultative, est une valeur conforme que la rédaction applique d'un clic |
| `brut` | les valeurs telles que lues, avant normalisation (voir [La règle de `brut`](#la-règle-de-brut)) |
| `pertinence` | facultatif : `{ verdict, raison }`, avec `verdict` = `retenu` ou `a-relire`. Un objet écarté n'est jamais exporté. `score`, `categorie` et `termes` s'y ajoutent pour la finesse du tri |
| `doublon` | facultatif : `{ uuid, slug, certitude: "probable" }`, une fiche existante qui semble la même. Un doublon sûr n'est pas exporté |
| `texte_depose` | facultatif, intervention seulement : le texte déposé, d'où le cockpit tire un résumé (voir [Le texte déposé](#le-texte-déposé)) |

Formats de date, comme dans le contrat : `date` en `AAAA-MM-JJ`, `date_partielle` en `AAAA`,
`AAAA-MM` ou `AAAA-MM-JJ`, `annee` en `AAAA`.

Un nom de personne n'entre dans un lot que dans les champs du contrat qui en portent
(`auteurs`, `realisateur`). Le `descriptif` fait exception : il est repris tel que la source le
publie, dans `valeurs` comme dans `brut`, noms compris, sans doute `personne-nommee`. La
rédaction le reformule.

### Codes de doute

La liste est fermée (`CODES_DOUTE` dans `lib/propositions.js`). Un nouveau code s'ajoute ici et
dans le cockpit avant qu'un moissonneur s'en serve.

| Code | Sens |
|---|---|
| `date-illisible` | une date lue qui ne se ramène pas sûrement au format du champ |
| `langue-devinee` | la langue de la proposition a été devinée ; `champ` vaut `langue` |
| `correspondance-incertaine` | la valeur de la source ne correspond qu'approximativement à un jeton |
| `valeur-hors-liste` | la valeur lue n'a aucun jeton dans la liste du champ |
| `champ-introuvable` | la source ne donne pas ce champ |
| `texte-tronque` | le texte a été coupé (titre ou descriptif trop long, page incomplète) |
| `personne-nommee` | un nom de personne possible dans un champ texte (`title`, `descriptif`…, désigné par `champ`), qui n'est ni l'auteur ni un signataire. `detail` le donne masqué (« F\*\*\* K\*\*\* »). Ce doute signale sans bloquer l'acceptation |

### La règle de `brut`

- Une clé de `brut` qui porte le nom d'un champ du contrat (`date`, `categorie`, `numero`…) se
  rapporte à ce champ : le cockpit affiche la valeur lue à côté du champ.
- Un champ introuvable n'a rien dans `brut`.
- Les autres clés sont libres. `brut` se limite à ce qui sert à juger, jamais la page entière.

### Le texte déposé

`texte_depose` porte le texte de l'intervention, en clair. Le moissonneur du parlement le
remplit (`moissonneurs/parlement/texte.py`) :

- il prend le document qui porte l'intervention elle-même, choisi sur son nom (texte déposé,
  motion, interpellation…), jamais une décision ou un débat. Pour la Confédération : le texte
  déposé, puis le développement ;
- plusieurs documents se suivent, chacun annoncé par une ligne `[Document : <nom>]` ; la réponse
  de l'exécutif vient en dernier s'il y en a une ;
- le texte est nettoyé : sans balisage HTML, CSS, entités ni images, les lignes coupées en milieu
  de phrase recollées. L'en-tête part, ainsi que l'adresse, la date, le numéro, le titre et tout
  paragraphe du début qui nomme un auteur ou un signataire ;
- il est plafonné à 20 000 caractères : au-delà, coupé à la dernière fin de phrase et suivi de
  « […] » ;
- le champ est absent quand aucun document n'a de texte utile.

Un nom cité plus loin dans le corps reste : le texte est celui que la source a publié. Il ne sert
que d'entrée au résumé, dont le prompt exclut tout nom de personne.

## Les langues

Chaque objet va vers une seule revue, et un moissonneur ne produit jamais deux propositions pour
un même objet :

| Origine | Langue |
|---|---|
| canton romand | `fr` (Revue) |
| canton alémanique | `de` (Zeitschrift) |
| Tessin | `fr`, titre gardé en italien |
| Confédération, cantons bilingues (BE, FR, VS, GR) | la langue du texte déposé, ou une proposition multilingue (ci-dessous) |
| recherche | la langue de la page, ou celle du titre |

Quand la langue n'est pas sûre, le moissonneur choisit quand même et pose le doute
`langue-devinee`.

L'autre revue reçoit l'objet à l'acceptation, par la case « Proposer aussi à l'autre revue ».

### Une proposition pour les deux revues

Une affaire fédérale (CH) donne une seule proposition, visible des deux rédactions. Un canton
bilingue (BE, FR, VS) suit la même règle quand il fournit les deux titres ; sinon, la langue de
son titre. Une proposition est multilingue seulement si `titres` porte fr et de.

- `langues: ["fr", "de"]` remplace `langue`. Une ligne porte l'un ou l'autre, jamais les deux.
  Chaque langue est une langue du contrat, une seule fois. Sinon la ligne est signalée
  (`langues-invalides`) et ignorée.
- `titres: { fr, de, it? }` contient les titres officiels, un titre non vide par langue de
  `langues`. `valeurs.title` est omis. Le cockpit pose `title` = `titres[langue de la vue]` ;
  `it` est seulement informatif.
- La `cle` est la même pour les deux vues : une seule décision vaut pour les deux.
- Une telle ligne ne porte pas de doute `langue-devinee`.
- Pour la finesse du tri, elle compte dans chaque langue qu'elle porte.

## Accepter et refuser

### Cas A et cas B

Le cockpit classe chaque proposition en la revalidant contre le contrat du moment. Elle est
**à vérifier** (cas B) dès que :

1. elle porte au moins un doute ;
2. un champ requis est vide, une date est hors format, ou un jeton manque à sa liste ;
3. `doublon` est renseigné.

Sinon elle est **prête** (cas A). Si le contrat change, une proposition ancienne passe d'elle-même
en cas B. La pertinence est un autre axe : elle ne change pas le cas.

À l'acceptation :

- un champ en doute bloque tant que la rédaction ne l'a pas touché ;
- une valeur hors format ou hors liste bloque ;
- un champ requis vide n'empêche pas d'accepter : la fiche le signale ensuite, comme toute fiche
  incomplète ;
- en lot, une proposition s'accepte telle quelle, et un cas B jamais.

### Ce que fait l'acceptation

La fiche nait dans la langue de la vue, c'est-à-dire celle du numéro ouvert. Les étapes, dans
l'ordre (`accepter()` de `lib/propositions.js`) :

1. le cockpit tire l'Uuid de la future fiche ;
2. il écrit la décision, avec cet Uuid ;
3. il crée la fiche avec ce même Uuid ;
4. si la case « Proposer aussi à l'autre revue » est cochée, il prépare l'autre langue.

Si la création de la fiche échoue, la décision désigne une fiche introuvable, et le cockpit le
dit. On n'obtient jamais deux fiches pour une même proposition.

La case « Proposer aussi à l'autre revue » est cochée d'office pour CH seulement. Cochée, elle
fait l'une de ces deux choses, jamais les deux :

- **proposition multilingue dont seul le titre se traduit** (aucun autre champ `traduire: true`
  n'est rempli) : le fichier de l'autre langue nait tout de suite, avec le même Uuid, orphelin,
  avec son titre officiel et les champs communs ;
- **sinon** : un seul fichier nait, et l'autre langue reçoit le statut `a-traduire` dans
  `_Statuts\<autre langue>\<uuid>.txt`. « Traduire dans ce numéro » prend alors le titre officiel
  gardé dans la décision (champ `Titres`).

La raison : un statut `a-traduire` posé à côté d'un fichier de langue existant serait ignoré.

### Annuler

- Annuler un refus supprime la décision.
- Annuler une acceptation supprime, dans l'ordre : le fichier de langue de la fiche (et son
  dossier s'il n'en reste aucun), le statut `a-traduire` posé avec elle, puis la décision.
- Pour une proposition multilingue, le fichier de l'autre langue part aussi, sauf s'il est déjà
  dans un numéro ; la vue le dit.
- Depuis la vue, une fiche déjà rattachée à un numéro, ou à un numéro archivé, ne se retire pas.
- La vue montre les acceptations des 30 derniers jours (`JOURS_ACCEPTEES`).

## Les décisions

Un fichier par proposition décidée : `_Moissons\_Decisions\<empreinte>.txt`.

L'**empreinte** est faite des 16 premiers caractères hexadécimaux du SHA-256 de la `cle`
(UTF-8). Une `cle` contient des `:`, interdits dans un nom de fichier Windows. La `cle` est
écrite en clair dans le fichier, au format d'un fichier Kirby (champs séparés par une ligne
`----` entourée de lignes vides) :

```
Cle: parlement:openparldata:CHE:2026-0412

----

Decision: refuse

----

Motif: hors-sujet

----

Date: 2026-10-02
```

| Champ | Règle |
|---|---|
| `Cle` | la `cle` de la proposition |
| `Decision` | `accepte` ou `refuse` |
| `Motif` | refus seulement, facultatif : `hors-sujet`, `doublon` ou `autre`. Ces motifs mesurent la précision des filtres |
| `Fiche` | acceptation seulement : l'Uuid de la fiche créée |
| `Titres` | acceptation d'une proposition multilingue seulement : ses `titres`, en JSON sur une ligne |
| `Date` | `AAAA-MM-JJ`, le jour de la décision |

- Le cockpit n'écrase jamais une décision présente : on l'annule d'abord.
- Le moissonneur relit les décisions à chaque exécution. Un fichier illisible, sans `Cle` ou à
  décision inconnue est ignoré sans gêner les autres. Un motif inconnu se lit `autre`.

## `etat.json`

`_Moissons\<moissonneur>\etat.json` est réécrit à la fin de chaque exécution de `tout`, même en
échec. La vue l'affiche en tête de l'onglet : il dit quand le moissonneur est passé, même quand
il n'y a rien à trier.

| Champ | Règle |
|---|---|
| `format` | `pronto-etat/1`. Une autre valeur fait ignorer le fichier |
| `moissonneur` | son nom court |
| `contrat` | la version de ce contrat que le moissonneur suit (1) |
| `derniere_moisson` | date et heure de la fin d'exécution, ISO 8601 en UTC |
| `duree_s` | durée de l'exécution, en secondes |
| `requetes` | requêtes réellement émises |
| `propositions_ecrites`, `lot` | ce que l'exécution a déposé : `0` et `""` sans lot |
| `sources_en_echec` | `[{ source, raison }]`. Une source en échec n'arrête pas les autres |
| `interrompu` | `null`, `"budget"`, `"403"`, `"arret"` ou `"configuration"` |
| `erreur` | ce qui a bloqué, quand `interrompu` vaut `"configuration"` |
| `purge` | `{ lots: [noms], decisions: [empreintes] }` : ce que la purge a effacé |

Un moissonneur peut ajouter ses propres champs (`nouvelles_affaires`, `retenues`,
`etapes_en_echec`…). Le cockpit ne lit que ceux de ce tableau et ceux de la finesse du tri.

## La finesse du tri

La rédaction règle la finesse du tri par un curseur à dix crans, de « Très large » (cran 1, tout
est visible) à « Strict » (cran 10). Tous les champs de cette section sont facultatifs. Un
moissonneur qui ne les remplit pas reste conforme : la vue cache alors le curseur, la vue Termes
et le « Pourquoi » détaillé pour ses types, et tout ce qu'il propose est visible. C'est le cas du
moissonneur `recherche`, qui ne calcule pas de note.

### Dans une proposition, sous `pertinence`

| Champ | Contenu |
|---|---|
| `score` | nombre de 0 à 100, propre au moissonneur |
| `categorie` | jeton qui explique la note, documenté par le moissonneur |
| `termes` | liste complète de `{ terme, langue: fr\|de\|it, role: ancrage\|ambigu\|ecole\|theme, ou: titre\|texte\|extrait, note_sans }`. Un terme y figure une fois, à son emplacement le plus fort |

`note_sans` est le score qu'aurait la proposition sans ce terme, les autres en place.

Au cran k, une proposition est visible si son `score` atteint le seuil du cran k de sa langue.
Les crans sont emboîtés : visible au cran k, elle l'est à tous les crans plus larges. Sans
`score`, ou sans crans pour sa langue, elle est visible à tous les crans.

### Dans `etat.json`

| Champ | Contenu |
|---|---|
| `crans` | `{ fr: [...], de: [...] }`, 10 entrées par langue : `{ cran: 1..10, seuil, par_mois, rappel, rappel_sur, identique_au_cran_precedent }`. Le cran 1 a le seuil 0 |
| `cran_defaut` | entier de 1 à 10 : le cran que la vue regarde tant que la rédaction n'a pas de réglage partagé pour le type. Absent ou invalide, il vaut 1 |
| `crans_calcules_le` | date `AAAA-MM-JJ` du dernier calcul des crans |
| `crans_source` | `{ fr: "langue" \| "commun", de: … }` : une langue qui a moins de 200 propositions sur 12 mois, ou plus de 3 crans identiques, prend les crans communs aux deux langues |
| `crans_fenetre` | `{ du, au }`, la fenêtre sur laquelle `par_mois` est compté |
| `note_calibree` | `true` quand la note a été calibrée sur des jugements humains. Absent, la vue dit que le curseur coupe surtout par volume |
| `termes`, `rappel_sur` | `[{ terme, langue, role, ref, ref_seul }]`, et le nombre de fiches de référence. À défaut de `rappel_sur`, le cockpit prend celui du premier cran |
| `demandes` | `[{ id, statut, effet: { rappel_avant, rappel_apres, par_mois_avant, par_mois_apres, complet }, fiches_perdues: [titres], mesure_le }]`. `complet` vaut `false` tant qu'un ajout n'a pas été cherché sur le serveur |
| `demandes_ignorees` | `[{ fichier, raison }]` : une demande dont l'`id` n'est pas un nom sûr ou ne correspond pas à son fichier |

Règles du cockpit :

- il y a toujours 10 crans par langue. Une langue dont la liste n'a pas exactement 10 crans
  numérotés de 1 à 10, chacun avec un `seuil` numérique, est ignorée ;
- un cran identique au précédent porte `identique_au_cran_precedent: true` ; la vue le montre
  et le dit ;
- `crans` n'a pas de clé `it` : les objets tessinois sont exportés en fr et comptent en fr ;
- le réglage effectif d'un type est le réglage partagé de la rédaction, sinon `cran_defaut`.

### Les crans du moissonneur `parlement`

Le calcul est dans `moissonneurs/parlement/finesse.py`, refait chaque trimestre au poste de
développement :

| Cran | Seuil |
|---|---|
| 1 « Très large » | 0 : tout, y compris le vivier élargi |
| 2 « Large » | le plus bas score du réglage normal. C'est le `cran_defaut` (2) |
| 3 à 9 | des seuils choisis pour que le volume visible baisse par pas réguliers entre le cran 2 et le cran 10 (`[finesse] profil`) |
| 10 « Strict » | le plus bas score qui laisse au plus 20 fiches de référence de la langue (`[finesse] rappel_strict`). Une langue sans assez de fiches de référence prend le seuil de `de` |

La note se lit par bandes, une par `categorie` :

| `categorie` | Note |
|---|---|
| `titre` | 80 à 100 |
| `texte-dense` | 60 à 79 |
| `signal-faible` | 40 à 59 |
| `ecole` | 20 à 39 |
| `theme` | 5 à 19 |
| `texte-large` | 0 à 4,99 : le vivier élargi, visible au cran 1 seulement |

Le moissonneur `parlement` n'écrit ni `note_calibree` ni `demandes` : ses demandes restent
« en attente » dans la vue.

### Les fichiers écrits par le cockpit

**Le réglage partagé**, `_Moissons\_Reglages\<langue>.json` :

```json
{ "parlement": { "intervention": { "cran": 2, "par": "Anne", "le": "2026-10-02" } } }
```

- Un fichier par langue : `fr.json` pour la rédaction de la Revue, `de.json` pour celle de la
  Zeitschrift.
- `cran` de 1 à 10 ; `par`, le nom d'affichage du poste qui l'a posé (celui que la co-édition
  montre, « – » à défaut) ; `le`, la date `AAAA-MM-JJ`.
- Un fichier illisible vaut « pas de réglage ».
- Dans la vue Propositions, le curseur n'est qu'un aperçu propre au poste, jamais partagé.
  « Garder ce cran pour la rédaction » l'écrit ici, comme les Paramètres de l'Accueil. Ce bouton
  n'apparait que si l'aperçu diffère du réglage effectif.
- Plusieurs moissonneurs sur un même type : chaque proposition se juge sur les crans de son
  moissonneur, au même numéro de cran, et « Garder ce cran » écrit le réglage de chacun.

**Une demande sur le lexique**, `_Moissons\<moissonneur>\demandes\<id>.json` :

```json
{ "id": "20261002-141200-3fa94c1e", "terme": "Sonderschule", "langue": "de", "sens": "ajout",
  "par": "Anne", "le": "2026-10-02" }
```

| Champ | Règle |
|---|---|
| `id` | `AAAAMMJJ-HHMMSS-<8 chiffres hexadécimaux>` : unique d'un poste à l'autre. Un nom sûr fait au plus 64 caractères `[A-Za-z0-9_-]` |
| `terme` | normalisé (NFC, sans blancs autour), 60 caractères au plus : lettres, espaces, tirets et apostrophes. Jamais lu comme une expression régulière |
| `sens` | `ajout`, `exclusion` ou `retrait` |
| `par`, `le` | qui l'a demandée, et quand |
| `confirme_par`, `confirme_le` | facultatifs : posés par « Appliquer quand même » |

Un fichier par demande, pour que deux postes n'écrivent jamais le même fichier. Le moissonneur
ne lit ni ne garde `par` et `confirme_par`.

Statuts d'une demande, dans `etat.demandes` :

| Statut | Sens |
|---|---|
| `en-attente` | pas encore mesurée. C'est aussi le statut d'une demande absente de `etat.demandes` |
| `applique` | appliquée |
| `applique-partiel` | un ajout pas encore cherché sur le serveur |
| `refuse-perte` | une exclusion qui ferait perdre au moins une fiche de référence |
| `refuse-bruit` | un ajout qui donnerait plus de 20 « à relire » de plus par mois |
| `doublon` | la même demande existe déjà |
| `a-confirmer` | l'effet doit être confirmé par la personne qui a demandé |
| `retrait-en-attente` | une demande appliquée dont le retrait attend sa mesure. Le cockpit le déduit seul |

Dans la vue :

- **« Seul à ramener »** compte, au cran que la vue regarde, les propositions visibles qui ne le
  seraient plus avec `note_sans` pour score. Sans `note_sans`, seule une proposition à un terme
  compte, et le nombre porte « ≈ ».
- **Un doublon** (même terme sans tenir compte de la casse, même langue, même sens, encore en
  attente) est refusé ; la vue nomme la demande qui attend déjà.
- **« Appliquer quand même »** n'est offert que pour `refuse-perte` ou `a-confirmer`, et
  seulement à la personne qui a fait la demande (`par` égal au nom du poste, jamais « – »). Il
  pose `confirme_par` et `confirme_le` dans le même fichier.
- **Retirer** une demande en attente, refusée ou en doublon supprime son fichier. Retirer une
  demande appliquée, même en partie, écrit une nouvelle demande de sens `retrait`. « Annuler »,
  juste après, remet les choses comme avant.
- `demandes_ignorees`, un fichier de demande illisible, ou dont l'`id` ne correspond pas au nom,
  s'affichent comme avertissements dans Paramètres > Moissonnage.

## Les résumés générés

Le bouton « Raccourcir les résumés » (Paramètres de l'Accueil, Moissonnage) fait écrire par
Mistral le descriptif des propositions en attente, dans la langue active :

| Type | Mode | Source | Longueur visée |
|---|---|---|---|
| `recherche` | `raccourcir` | un `descriptif` de plus de 1 000 caractères | 700 à 1 000 caractères (cible 850), au plus 150 mots en fr, 135 en de |
| `intervention` | `creer` | `texte_depose` | 400 à 700 caractères (cible 550), au plus 80 mots en fr, 70 en de |

- Les prompts, le modèle et ces longueurs sont dans
  `vscodium-extension/szh-cockpit/prompts/resume-descriptif.json` (version `v6`). Changer un
  texte, c'est monter la version.
- Seuls les textes publics d'une proposition partent chez Mistral, jamais un manuscrit ni un
  fichier de revue. La source est coupée à 20 000 caractères.
- Un jet trop long (caractères ou mots) est relancé deux fois au plus ; s'il l'est encore, le
  doute `longueur-hors-plage` le dit.
- Le résumé doit être relu. La vue l'affiche par défaut, marqué « Résumé généré (Mistral), à
  relire », à côté de l'original. L'acceptation écrit dans la fiche le texte affiché.

Un fichier par proposition et par langue : `_Moissons\_Resumes\<langue>\<empreinte>.json`
(l'empreinte des décisions). Une régénération l'écrase. Exemple :
`test/js/fixtures/resume-exemple.json`.

| Champ | Règle |
|---|---|
| `format` | `pronto-resume/1`. Une autre valeur fait ignorer le fichier |
| `cle`, `langue` | la proposition et la langue du résumé |
| `texte` | le résumé, un seul paragraphe de texte brut |
| `modele`, `prompt` | le modèle Mistral et la version du prompt |
| `date`, `poste` | ISO 8601 en UTC, et le nom du poste qui l'a demandé |
| `source_empreinte`, `source_car` | le SHA-256 (hexadécimal) et la longueur du texte envoyé |
| `mode` | `raccourcir` ou `creer` |
| `relance`, `jetons` | si un premier jet trop long a été relancé, et les jetons consommés |
| `doutes` | `[{ code, detail }]`, codes ci-dessous |

| Code | Sens |
|---|---|
| `nombre-hors-source` | un nombre de la sortie qui ne se trouve pas, comme nombre entier, dans la source ou la fiche (« 20 » ne se lit pas dans « 2020 ») |
| `longueur-hors-plage` | le résumé reste trop long après deux relances |
| `source-tronquee` | la source a été coupée, par le cockpit ou déjà par le moissonneur (le texte déposé finit alors par « […] ») |

Un résumé est périmé quand `source_empreinte` ne correspond plus au texte de la proposition, ou
quand il dépasse la plage actuelle. La vue ne l'affiche plus, et la passe suivante le régénère.
Un résumé valide est sauté.

## Les commandes `estimer` et `tout`

Chaque moissonneur offre ces deux commandes, que `moissonneurs/moisson.py` lance de la même façon
pour tous. Sur la sortie standard : une ligne JSON par évènement (UTF-8, `\n`, vidée à chaque
ligne), et rien d'autre. Chaque objet porte `type`. Les messages pour une personne et les traces
vont sur la sortie d'erreur.

- **`estimer`** ne fait aucune requête et n'écrit rien. Il rend un seul objet
  `type: "estimation"` : `moissonneur`, `contrat`, `pret` (faux si une condition bloque le
  lancement), `etapes` avec leurs `requetes_prevues`, `requetes_prevues` au total, `budget`,
  `depasse_le_budget`, `delai_s`, `duree_estimee_s`, `chemins`, et `avertissements` (des phrases
  pour la personne qui confirme le lancement).
- **`tout`** moissonne, dépose le lot, écrit `etat.json` et purge. Il rend des objets
  `type: "progression"` (`etape`, `statut` : `ok`, `echec`, `budget`…), puis, en dernière ligne,
  un objet `type: "resume"` qui reprend les champs de `etat.json`.

| Code de sortie | Sens |
|---|---|
| 0 | tout est bon |
| 1 | terminé, avec des échecs signalés dans le résumé |
| 2 | configuration invalide : rien n'est parti |
| 3 | interrompu : budget épuisé, demande d'arrêt, ou accès refusé par la source (403) |

Si le dossier de `etat.json` est lui-même inaccessible, l'échec part sur la sortie d'erreur avec
le code 2.

Les options, les évènements que `moisson.py` en tire et ses propres codes sont dans
[`moissonneurs/LISEZMOI.md`](../moissonneurs/LISEZMOI.md).

## La purge

Chaque moissonneur purge à la fin de `tout` (`commun.py`, `MOIS = 6`) :

- les lots de plus de 6 mois, décidés ou non ;
- les décisions de plus de 6 mois, une fois reportées dans sa propre base ;
- `etat.json` dit ce qui a été purgé (`purge`).

Garde-fous :

- l'âge se lit sur la date du nom du lot et sur le champ `Date` de la décision, jamais sur la
  date de modification du fichier, que la synchronisation OneDrive change ;
- la purge ne touche que le dossier de ce moissonneur, et seulement les décisions dont la `Cle`
  commence par `<moissonneur>:`. Le chemin résolu est contrôlé avant chaque suppression ;
- elle ne touche pas à `Fiches\` ;
- ses tests se jouent sur une arborescence jetable.
