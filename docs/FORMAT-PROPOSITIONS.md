# Format des propositions : le contrat des moissonneurs

Ce document vaut pour tous les moissonneurs (recherches, interventions parlementaires, et
ceux qui viendront). Un moissonneur ne fabrique jamais de fiche. Il dépose des
**propositions** ; la rédaction les accepte ou les refuse dans le cockpit, et seul le cockpit
écrit la fiche, par `lib/kirby-contenu.js`. Le code qui lit ce format est
`vscodium-extension/szh-cockpit/lib/propositions.js`.

Le contrat des champs reste `pipeline/kirby/champs-documentation.json`
([`FORMAT-DOCUMENTATION-KIRBY.md`](FORMAT-DOCUMENTATION-KIRBY.md)). Un moissonneur le lit, en
lecture seule, comme la bibliothèque `Fiches\`.

## Arborescence

```
<racine>\_NewsUndActu\
├── Fiches\                         la bibliothèque : jamais écrite par un moissonneur
└── _Moissons\
    ├── <moissonneur>\              un dossier par moissonneur, nom court en minuscules
    │   ├── AAAA-MM-JJ-<n>.jsonl    un lot par exécution qui a trouvé quelque chose
    │   └── etat.json               l'état de la dernière exécution
    └── _Decisions\
        └── <empreinte>.txt         une décision de la rédaction par proposition
```

- `<racine>` est la racine active : la production, ou `Revues-TESTING` en mode test.
- Un nom de dossier qui commence par `_` n’est pas un moissonneur.
- Un moissonneur n’écrit que dans son propre dossier. Il lit `_Decisions\` sans y écrire.

## Le lot

- Nom : `AAAA-MM-JJ-<n>.jsonl`. La date est celle de l’exécution ; `<n>` vaut 1, 2, 3… dans
  la journée. Le cockpit range les lots par date, puis par `<n>` lu comme un nombre : `-10`
  vient après `-2`. Un `.jsonl` qui ne suit pas ce nom est signalé et ignoré.
- Une proposition par ligne, en JSON sur une seule ligne, UTF-8, fin de ligne `\n`.
- Écriture atomique : le lot s’écrit sous un nom temporaire qui ne finit pas par `.jsonl`
  (`….jsonl.tmp`), puis il est renommé. Il n’est jamais modifié ensuite.
- Pas de lot vide. Une exécution qui n’a rien trouvé n’écrit pas de lot.

Les pannes restent locales :
- une ligne illisible écarte la ligne, pas le lot ;
- un lot illisible est signalé et ignoré, les autres lots sont lus ;
- une ligne d’un format inconnu, d’un type inconnu du contrat ou d’une langue inconnue est
  signalée et ignorée.

## Une proposition : `pronto-proposition/1`

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
| `format` | toujours `pronto-proposition/1`. Une autre valeur fait ignorer la ligne |
| `cle` | `<moissonneur>:<source>:<identifiant stable>`, sur une ligne. L’identité de la proposition, pour toujours : une décision s’y rattache. L’identifiant est celui de la source (`CHE`, par exemple), pas un jeton de Pronto |
| `moissonneur` | le nom de son dossier sous `_Moissons\` |
| `type` | un type du contrat (`intervention`, `recherche`…). Il choisit l’onglet de la vue |
| `langue` | `fr` ou `de`, toujours renseignée (voir « Une proposition, une langue ») |
| `recolte` | date et heure de la lecture, ISO 8601 en UTC |
| `lien_source` | la page d’origine, que la rédaction ouvre pour juger |
| `valeurs` | les clés des champs du type, avec les jetons de Pronto (`canton: "CH"`). Une valeur n’y entre que si elle respecte la saisie du contrat ; sinon le champ reste vide et un doute le dit. Une clé vide s’omet. Une `liste_multiple` est un tableau de jetons ; un `suivi` est un tableau d’objets |
| `doutes` | ce que le moissonneur sait avoir deviné ou n’a pas pu lire, champ par champ : `{ champ, code, detail, suggestion? }`. `detail` explique, il ne répète pas la valeur lue. `suggestion`, facultative, est une valeur conforme que la rédaction applique d’un clic |
| `brut` | les valeurs telles que lues, avant normalisation (voir plus bas) |
| `pertinence` | facultative : `{ verdict, raison }`, `verdict` valant `retenu` ou `a-relire`. Un objet `ecarte` ne s’exporte jamais |
| `doublon` | facultatif : `{ uuid, slug, certitude: "probable" }`, une fiche existante qui semble la même. Un doublon sûr ne s’exporte pas |

Les dates suivent la saisie du contrat : `date` en `AAAA-MM-JJ`, `date_partielle` en `AAAA`,
`AAAA-MM` ou `AAAA-MM-JJ`, `annee` en `AAAA`.

Aucun nom de personne n’entre dans un lot hors des champs du contrat qui le demandent
(`auteurs`, `realisateur`).

### Codes de doute

La liste est fermée. Un moissonneur qui a besoin d’un nouveau code le fait ajouter ici ; il ne
l’invente pas.

| Code | Sens |
|---|---|
| `date-illisible` | une date lue qui ne se ramène pas sûrement au format du champ |
| `langue-devinee` | la langue de la proposition a été devinée ; `champ` vaut `langue` |
| `correspondance-incertaine` | la valeur de la source ne correspond qu’approximativement à un jeton |
| `valeur-hors-liste` | la valeur lue n’a aucun jeton dans la liste du champ |
| `champ-introuvable` | la source ne donne pas ce champ |
| `texte-tronque` | le texte a été coupé (titre ou descriptif trop long, page incomplète) |

### La règle de `brut`

- Une clé de `brut` qui porte le nom d’un champ du contrat (`date`, `categorie`, `numero`…)
  se rapporte à ce champ : le cockpit affiche cette valeur lue à côté du champ.
- Un champ introuvable n’a rien dans `brut`.
- Les autres clés sont libres. `brut` se réduit à ce qui sert à juger : jamais la page
  entière.

## Une proposition, une langue

Le moissonneur oriente chaque objet vers une seule revue et ne produit jamais deux
propositions pour un même objet :
- canton romand → `fr` (Revue) ; canton alémanique → `de` (Zeitschrift) ; Tessin → `fr`,
  avec le titre gardé en italien ;
- Confédération et cantons bilingues (BE, FR, VS, GR) → la langue du texte déposé ;
- recherche : la langue de la page, ou celle du titre ;
- quand la langue n’est pas sûre, le moissonneur choisit quand même et pose le doute
  `langue-devinee`.

L’autre revue reçoit l’objet à l’acceptation : la case « Proposer aussi à l’autre revue »
écrit le statut `a-traduire` dans `_Statuts\<autre langue>\<uuid>.txt`.

## Une cle répétée

Une même `cle` qui revient dans un lot plus récent remplace l’ancienne : le cockpit garde la
ligne du lot le plus récent. Dans un même lot, la dernière ligne l’emporte. Une `cle` décidée
n’est jamais reproposée, et le cockpit la masque de toute façon.

## Cas A et cas B

C’est le cockpit qui classe, en revalidant chaque proposition contre le contrat du moment. Une
proposition est « à vérifier » (cas B) dès que :
1. elle porte au moins un doute ;
2. un champ requis est vide, une date est hors format, ou un jeton manque à sa liste ;
3. `doublon` est renseigné.

Sinon elle est « prête » (cas A). Une proposition ancienne passe d’elle-même en cas B si le
contrat change, sans que le moissonneur ait à le savoir. La pertinence est un autre axe : elle
ne change pas le cas.

À l’acceptation, un champ en doute bloque tant que la rédaction ne l’a pas touché, et une
valeur hors format ou hors liste bloque. Un champ requis vide se laisse accepter : la fiche le
signale ensuite, comme toute fiche incomplète.

## Les décisions

Un fichier par proposition décidée : `_Moissons\_Decisions\<empreinte>.txt`. L’empreinte est
faite des 16 premiers caractères hexadécimaux du SHA-256 de la `cle` (UTF-8), parce qu’une
`cle` contient des `:`, interdits dans un nom de fichier Windows. La `cle` est écrite en clair
dans le fichier, au format des statuts de traduction :

```
Cle: parlement:openparldata:CHE:2026-0412
----
Decision: refuse
----
Motif: hors-sujet
----
Date: 2026-10-02
```

Les champs sont séparés par une ligne `----` entourée de lignes vides, comme dans un fichier
Kirby.

| Champ | Règle |
|---|---|
| `Cle` | la `cle` de la proposition |
| `Decision` | `accepte` ou `refuse` |
| `Motif` | refus seulement, facultatif : `hors-sujet`, `doublon` ou `autre`. Ces motifs mesurent la précision des filtres |
| `Fiche` | acceptation seulement : l’Uuid de la fiche créée |
| `Date` | `AAAA-MM-JJ`, le jour de la décision |

- Le cockpit écrit le fichier d’un coup (nom temporaire, puis renommage). Il n’écrase jamais
  une décision présente : on l’annule d’abord.
- Ordre de l’acceptation : l’Uuid est tiré d’abord, la décision est écrite avec lui, puis la
  fiche est créée avec ce même Uuid, puis le statut `a-traduire` de l’autre langue si la case
  est cochée. Si la création échoue, la décision désigne une fiche introuvable, et le cockpit
  le dit. On n’obtient jamais deux fiches pour une même proposition.
- Annuler une acceptation supprime la fiche créée (le fichier de sa langue, et le dossier s’il
  n’en reste aucun), le statut `a-traduire` posé avec elle, puis la décision. Annuler un refus
  supprime la décision.
- Le moissonneur relit les décisions à chaque exécution. Un fichier illisible, sans `Cle` ou à
  décision inconnue est ignoré sans casser les autres ; un motif inconnu se lit `autre`.

## `etat.json`

À côté des lots, `_Moissons\<moissonneur>\etat.json`, réécrit d’un coup à la fin de chaque
exécution de `tout`, même en échec. La vue l’affiche en tête de l’onglet, et il dit quand
chaque moissonneur est passé quand il n’y a rien à trier.

| Champ | Règle |
|---|---|
| `format` | toujours `pronto-etat/1` ; une autre valeur fait ignorer le fichier |
| `moissonneur` | son nom court |
| `contrat` | la version de ce contrat que le moissonneur suit (1) |
| `derniere_moisson` | date et heure de la fin d’exécution, ISO 8601 en UTC |
| `duree_s` | durée de l’exécution, en secondes |
| `requetes` | requêtes réellement émises |
| `propositions_ecrites`, `lot` | ce que l’exécution a déposé : `0` et `""` sans lot |
| `sources_en_echec` | `[{ source, raison }]` : une source en échec n’arrête jamais les autres |
| `interrompu` | `null`, `"budget"`, `"403"` ou `"configuration"` |
| `erreur` | ce qui a bloqué, quand `interrompu` vaut `"configuration"` |
| `purge` | `{ lots: [noms], decisions: [empreintes] }` : ce que la purge a effacé |

Un moissonneur peut ajouter ses propres champs (`nouvelles_affaires`, `retenues`…). Le cockpit
ne lit que ceux-ci.

## Les commandes `estimer` et `tout`

Un moissonneur offre ces deux commandes, que le cockpit pourra lancer de la même façon pour
tous. Sur la sortie standard, une ligne JSON par évènement (UTF-8, `\n`, vidée à chaque
ligne), et rien d’autre ; les messages pour une personne et les traces vont sur la sortie
d’erreur. Chaque objet porte `type`.

- **`estimer`** ne fait aucune requête et n’écrit rien. Il rend un seul objet
  `type: "estimation"` : `moissonneur`, `contrat`, `pret` (faux si une condition bloque le
  lancement), `etapes` avec leurs `requetes_prevues`, `requetes_prevues` au total, `budget`,
  `depasse_le_budget`, `delai_s`, `duree_estimee_s`, `chemins` (`propositions`, `decisions`,
  et ce qui est propre au moissonneur), et `avertissements`, des phrases pour la personne qui
  confirme le lancement.
- **`tout`** moissonne, dépose le lot, écrit `etat.json` et purge. Il rend des objets
  `type: "progression"` (`etape`, `statut` : `ok`, `echec` ou `budget`), puis, en dernière
  ligne, un objet `type: "resume"` qui reprend les champs de `etat.json`.

Codes de sortie :

| Code | Sens |
|---|---|
| 0 | tout est bon |
| 1 | terminé, avec des échecs signalés dans le résumé |
| 2 | configuration invalide : rien n’est parti |
| 3 | interrompu : budget épuisé, ou accès refusé par la source (403) |

Si le dossier de `etat.json` est lui-même inaccessible, l’échec part sur la sortie d’erreur
avec le code 2 : le cockpit n’a alors que le code.

## La purge

Rien ne s’accumule. Chaque moissonneur purge à la fin de `tout` :
- les lots de plus de 6 mois, décidés ou non ;
- les décisions de plus de 6 mois, une fois reportées dans sa propre base ;
- `etat.json` dit ce qui a été purgé (`purge`).

Garde-fous :
- l’âge se lit sur la date du nom du lot et sur le champ `Date` de la décision, jamais sur la
  date de modification du fichier, que la synchronisation change ;
- la purge ne touche que le dossier de ce moissonneur, et seulement les décisions dont la
  `Cle` commence par `<moissonneur>:` ; le chemin résolu est contrôlé avant chaque
  suppression ;
- elle ne touche jamais à `Fiches\` ;
- ses tests se jouent sur une arborescence jetable.
