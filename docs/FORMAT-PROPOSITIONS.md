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
| `langue` | `fr` ou `de`, toujours renseignée (voir « Une proposition, une langue »), sauf sur une ligne multilingue, qui porte `langues` à la place |
| `langues`, `titres` | une ligne multilingue seulement : voir « Une proposition pour les deux revues » |
| `recolte` | date et heure de la lecture, ISO 8601 en UTC |
| `lien_source` | la page d’origine, que la rédaction ouvre pour juger |
| `valeurs` | les clés des champs du type, avec les jetons de Pronto (`canton: "CH"`). Une valeur n’y entre que si elle respecte la saisie du contrat ; sinon le champ reste vide et un doute le dit. Une clé vide s’omet. Une `liste_multiple` est un tableau de jetons ; un `suivi` est un tableau d’objets |
| `doutes` | ce que le moissonneur sait avoir deviné ou n’a pas pu lire, champ par champ : `{ champ, code, detail, suggestion? }`. `detail` explique, il ne répète pas la valeur lue. `suggestion`, facultative, est une valeur conforme que la rédaction applique d’un clic |
| `brut` | les valeurs telles que lues, avant normalisation (voir plus bas) |
| `pertinence` | facultative : `{ verdict, raison }`, `verdict` valant `retenu` ou `a-relire`. Un objet `ecarte` ne s’exporte jamais. `score`, `categorie` et `termes` s’y ajoutent pour la finesse du tri (voir plus bas) |
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

### Une proposition pour les deux revues

Une affaire fédérale (CH) donne une seule proposition, visible des deux rédactions. Les cantons
bilingues (BE, FR, VS) suivent la même règle quand ils fournissent les deux titres ; sinon,
la langue de leur titre. Une proposition n’est multilingue que si `titres` porte fr et de.

- `langues: ["fr", "de"]` remplace `langue`. Une ligne porte l’un ou l’autre, jamais les deux,
  et chaque langue est une langue du contrat, une seule fois. Une ligne qui enfreint cette règle
  est signalée (`langues-invalides`) et ignorée.
- `titres: { fr, de, it? }` contient les titres officiels, un titre non vide pour chaque langue
  de `langues`. `valeurs.title` est omis : il n’y a qu’une source du titre. Le cockpit pose
  `title` = `titres[langue de la vue]` ; `it` n’est qu’informatif.
- La `cle` ne change pas : une seule décision vaut pour les deux vues.
- Aucun doute `langue-devinee` sur une telle ligne.
- Finesse du tri : la proposition compte dans les déciles de chaque langue qu’elle porte.

À l’acceptation, la fiche nait dans la langue de la vue (le numéro ouvert). La case « Proposer
aussi à l’autre revue » n’est cochée d’office que pour CH ; pour un canton bilingue, elle reste
décochée. Quand elle est cochée :
- si aucun champ `traduire: true` autre que le titre n’est rempli, les deux fichiers de langue
  naissent d’un coup, avec le même Uuid : celui de la vue rattaché au numéro (ou orphelin pour
  « Garder au réservoir »), celui de l’autre langue orphelin, avec son titre officiel et les
  champs communs ;
- sinon, un seul fichier nait, et l’autre langue reçoit le statut `a-traduire`. « Traduire dans
  ce numéro » prend alors le titre officiel gardé dans la décision (champ `Titres`).

Annuler l’acceptation retire les deux fichiers tant que celui de l’autre langue n’est dans aucun
numéro ; sinon, seul le fichier de la vue part, et la vue le dit.

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
| `Titres` | acceptation d’une proposition multilingue seulement : ses `titres`, en JSON sur une ligne. La décision se retrouve par l’Uuid de sa fiche |
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
ne lit que ceux-ci, et ceux de la finesse du tri, plus bas.

## La finesse du tri : champs facultatifs

La rédaction règle la finesse du tri par un curseur à dix crans, de « Large » (cran 1, tout est
visible) à « Strict » (cran 10). Tous les champs de cette section sont facultatifs, et le format
reste `pronto-proposition/1`. Un moissonneur qui ne les remplit pas reste conforme : la vue
cache alors le curseur, la vue Termes et le « Pourquoi » détaillé pour ses types, et tout ce
qu’il propose est visible.

### Dans une proposition, sous `pertinence`

| Champ | Contenu |
|---|---|
| `score` | nombre de 0 à 100, propre au moissonneur ; par bandes chez le parlement (une catégorie = une plage) |
| `categorie` | jeton de l’explication, documenté par le moissonneur (parlement : `titre`, `texte-dense`, `signal-faible`, `ecole`, `theme`) |
| `termes` | liste complète, sans plafond, de `{ terme, langue: fr\|de\|it, role: ancrage\|ambigu\|ecole\|theme, ou: titre\|texte\|extrait, note_sans }` ; un terme une seule fois, à son emplacement le plus fort |

`note_sans` est le score qu’aurait la proposition sans ce terme, tous les autres en place. Le
cockpit en tire « seul à ramener » au cran courant : la proposition est visible, et ne le serait
plus sans ce terme.

Au cran k, une proposition est visible si son `score` atteint le seuil du cran k de sa langue.
Les crans sont emboîtés : une proposition visible au cran k l’est à tous les crans plus larges.
Sans `score`, ou sans crans pour sa langue, elle est visible à tous les crans.

### Dans `etat.json`

| Champ | Contenu |
|---|---|
| `crans` | `{ fr: [...], de: [...] }`, 10 entrées par langue : `{ cran: 1..10, seuil, par_mois, rappel, rappel_sur, identique_au_cran_precedent }` ; le cran 1 a le seuil 0 (Large), le cran 10 est Strict |
| `crans_calcules_le` | date AAAA-MM-JJ, recalcul trimestriel |
| `note_calibree` | facultatif, `true` quand la note a été calibrée sur des jugements humains ; sinon la vue dit que le curseur coupe surtout par volume |
| `crans_source` | `{ fr: "langue" \| "commun", de: … }` : une langue qui a moins de 200 propositions sur 12 mois, ou plus de 3 crans identiques, prend les déciles communs, et le champ le dit |
| `crans_fenetre` | `{ du, au }`, la fenêtre du `par_mois` |
| `termes` | `[{ terme, langue, role, ref, ref_seul }]`, avec `rappel_sur` à côté |
| `demandes` | `[{ id, statut, effet: { rappel_avant, rappel_apres, par_mois_avant, par_mois_apres, complet }, fiches_perdues: [titres], mesure_le }]` ; `complet` vaut false tant qu’un ajout n’a pas été cherché sur le serveur |
| `demandes_ignorees` | `[{ fichier, raison }]` : une demande dont l’`id` n’est pas un nom sûr (64 caractères au plus, `[A-Za-z0-9_-]`) ou ne correspond pas à son fichier |

- Les seuils sont les déciles de la distribution des scores du moissonneur, dans chaque langue :
  un même cran garde ainsi un sens comparable d’un moissonneur à l’autre.
- Il y a toujours 10 crans. Un cran identique au précédent garde son seuil et porte
  `identique_au_cran_precedent: true` ; la vue le montre tel quel et le dit.
- Il n’y a pas de clé `it` dans `crans` : les objets tessinois sont exportés en fr et comptent
  dans les déciles fr.
- Le cockpit ignore une langue dont la liste n’a pas exactement 10 crans numérotés de 1 à 10 avec
  un `seuil` numérique.

Statuts d’une demande :
- `en-attente` ;
- `applique` ;
- `applique-partiel` : un ajout pas encore cherché sur le serveur ;
- `refuse-perte` : une exclusion qui ferait perdre au moins une fiche de référence ;
- `refuse-bruit` : un ajout qui donnerait plus de 20 « à relire » de plus par mois ;
- `doublon` ;
- `a-confirmer` ;
- `retrait-en-attente`.

### Écrits par le cockpit, dans `_Moissons\`

```
_Moissons\
├── _Reglages\
│   ├── fr.json                     le réglage partagé de la rédaction de la Revue
│   └── de.json                     celui de la Zeitschrift
└── <moissonneur>\
    └── demandes\
        └── <id>.json               une demande sur le lexique
```

- `_Reglages\<langue>.json` contient `{ "<moissonneur>": { "<type>": { cran, par, le } } }`.
  C’est le réglage partagé de la rédaction de cette langue : `cran` de 1 à 10, `par` le nom
  d’affichage du poste qui l’a posé (celui que la co-édition montre, « – » à défaut), `le` la
  date AAAA-MM-JJ. Le cockpit l’écrit d’un coup (nom temporaire, puis renommage). Un fichier
  illisible vaut « pas de réglage » : cran 1, tout est visible. Dans la vue Propositions, le
  curseur n’est qu’un aperçu propre au poste, gardé dans l’éditeur et jamais partagé ; « Garder
  ce cran pour la rédaction » l’écrit ici, comme les Paramètres de l’Accueil.
- `<moissonneur>\demandes\<id>.json` contient, pour une demande, `{ id, terme, langue, sens:
  ajout|exclusion|retrait, par, le, confirme_par?, confirme_le? }`. Il y a un fichier par
  demande, comme pour les décisions, pour que deux postes n’écrivent jamais le même fichier. Le
  terme est validé : 60 caractères au plus, lettres, espaces, tirets et apostrophes, jamais
  interprété comme une expression régulière.

Le moissonneur ne lit ni ne garde `par` et `confirme_par` : la vue relit l’auteur dans le fichier
de la demande.

### Les termes et les demandes, côté cockpit

- **`rappel_sur`** des termes est une clé de `etat.json`, au même niveau que `termes` ; à défaut,
  le cockpit prend le `rappel_sur` du premier cran. Un terme absent de `etat.termes` a « – » pour
  réf. et réf. seul.
- **« Seul à ramener »** se compte au cran que la vue regarde pour le type de la proposition :
  l’aperçu du poste, sinon le réglage partagé de son moissonneur. Une proposition y compte si elle
  est visible et ne le serait plus avec `note_sans` pour score. Sans `note_sans`, seule une
  proposition à un seul terme compte, et la vue marque le nombre d’un « ≈ ».
- **Plusieurs moissonneurs sur un même type** : chaque proposition se juge sur les crans de son
  moissonneur, au même numéro de cran (les crans sont les déciles de chacun) ; les comptes les
  additionnent, et « Garder ce cran pour la rédaction » écrit le réglage de chacun.
- **L’`id`** d’une demande vaut `AAAAMMJJ-HHMMSS-<8 chiffres hexadécimaux>` : un nom sûr, unique
  d’un poste à l’autre. Le fichier s’écrit d’un coup (nom temporaire, puis renommage).
- **Le terme** est gardé normalisé (NFC, sans blancs autour). La page reçoit la règle de saisie de
  l’hôte (`regleTerme` : longueur et caractères interdits) pour signaler l’erreur pendant la
  frappe ; l’hôte la revérifie à l’écriture.
- **Un doublon** (même terme sans tenir compte de la casse, même langue, même sens, encore en
  attente) est refusé, et la vue nomme la demande qui attend déjà.
- **Sans réponse** dans `etat.demandes`, une demande est `en-attente`. Une demande appliquée dont un
  retrait attend sa mesure se montre `retrait-en-attente`, même si le moissonneur ne l’écrit pas.
- **« Appliquer quand même »** n’est offert que pour `refuse-perte` ou `a-confirmer`, sous les
  fiches perdues dépliées, et seulement à la personne qui a fait la demande (`par` égal au nom du
  poste, jamais « – ») : le cockpit pose alors `confirme_par` et `confirme_le` dans le même
  fichier. Tout le monde voit qui a confirmé et quand.
- **Retirer** une demande en attente, refusée ou en doublon supprime son fichier. Retirer une
  demande appliquée, même en partie, écrit une nouvelle demande de sens `retrait`, sur le même
  terme et la même langue ; le moissonneur la mesure comme les autres. « Annuler », juste après,
  remet le fichier retiré tel quel, ou retire la demande de retrait.
- **`demandes_ignorees`**, et un fichier de demande illisible ou dont l’`id` ne correspond pas à son
  nom, remontent comme avertissements dans Réglages > Moissonnage.

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
