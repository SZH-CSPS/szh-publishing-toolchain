# Format de l'état partagé des moissons

Un moissonneur doit savoir ce qu'il a déjà vu : les affaires connues, les propositions déjà
faites, les décisions de la rédaction. Cet état vit dans le dossier partagé, pour que la passe
mensuelle parte de n'importe quel poste. Cette page décrit ces fichiers.

| Côté | Code |
|---|---|
| écriture et lecture | `moissonneurs/partage.py` |
| lecture seule, pour l'affichage | `vscodium-extension/szh-cockpit/lib/moisson.js` |

Le format des lots, des décisions et de `etat.json` est dans
[`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md). Le lancement d'une passe, le créneau et le
budget sont dans [`moissonneurs/LISEZMOI.md`](../moissonneurs/LISEZMOI.md).

## Deux sortes de postes

- **Le poste de développement** garde la base complète de chaque moissonneur, en SQLite sur son
  disque (`--base`). Il fait les opérations lourdes (import initial, reclassement) et publie
  l'état partagé, appelé **socle**.
- **Les autres postes** lancent la passe mensuelle depuis le cockpit. La passe charge le socle et
  les journaux dans une base SQLite en mémoire, y fait tourner le code du moissonneur tel quel,
  puis écrit ce qu'elle a appris dans le journal de son poste.

Aucune base SQLite n'est dans le dossier partagé.

## Arborescence

```
<racine>\_NewsUndActu\_Moissons\
├── _Creneau\<poste>__<compte>.json        l'annonce d'une passe en cours
└── <moissonneur>\
    └── _partage\
        ├── socle.json                      l'état publié par le poste de développement
        ├── journal\<poste>__<compte>.jsonl  ce qu'un poste a appris depuis le socle
        ├── requetes\<AAAA-MM>\<poste>__<compte>.json   les requêtes de ce poste ce mois-là
        ├── passes\<AAAA-MM>\<poste>__<compte>-<AAAAMMJJTHHMMSSZ>.json   le bilan de chaque passe
        └── imports-fns\<AAAA-MM-JJ>-<poste>__<compte>.json   la note de chaque import FNS (recherche)
```

- Chaque fichier n'a qu'un écrivain : le socle, le poste de développement ; un journal ou un
  compteur, son seul poste. OneDrive ne voit donc jamais deux postes écrire le même fichier.
- Toute écriture passe par un fichier `….tmp`, puis un renommage.
- `<poste>__<compte>` est normalisé : minuscules sans accents ; tout signe autre qu'une lettre, un
  chiffre, `.` ou `_` devient `-` (`partage.cle_poste`).

## Le socle : `socle.json`

```json
{ "format": "pronto-socle/1", "moissonneur": "parlement", "publie_le": "2026-11-02T08:00:00Z",
  "poste": "…", "compte": "…", "absorbes": { "<poste>__<compte>": 41 },
  "tables": { "<table>": [ { "…": "une ligne" } ] } }
```

| Champ | Règle |
|---|---|
| `format` | `pronto-socle/1`. Un autre format fait ignorer le fichier |
| `publie_le` | ISO 8601 en UTC. Une copie en conflit de OneDrive (`socle-<poste>.json`) est lue aussi : le `publie_le` le plus récent l'emporte |
| `absorbes` | pour chaque journal, le plus grand numéro de ligne déjà repris dans ce socle |
| `tables` | les lignes de chaque table du moissonneur, au format de sa base |

- Une passe mensuelle n'écrit pas le socle. `moisson.py` pose la variable
  `PRONTO_MOISSON_PASSE` pour chaque moissonneur qu'il lance, et `partage.publier_socle` refuse
  alors l'écriture. Il la refuse aussi sans annonce de créneau du même poste.
- Sans socle, il n'y a pas de passe mensuelle : `moisson.py` refuse avec `etat-absent`.

## Les journaux : `journal\<poste>__<compte>.jsonl`

La première ligne est un en-tête :
`{"format": "pronto-journal/1", "moissonneur": "…", "poste": "…"}`. Chaque ligne suivante est
un évènement :

```json
{"n": 42, "maj": "2026-11-03T10:00:00Z", "t": "affaires", "k": ["ZH", "123"], "r": {"…": "la ligne"}}
```

| Champ | Sens |
|---|---|
| `n` | numéro de la ligne dans ce journal, sans trou, qui ne recule jamais |
| `maj` | heure de l'évènement, ISO 8601 en UTC |
| `t` | la table |
| `k` | la clé de la ligne, en liste de textes |
| `r` | la ligne ; `null` pour un retrait |

- Le poste réécrit son journal d'un coup, après chaque corps (parlement) ou source (recherche)
  achevés, puis en fin de passe. Il en retire au passage les lignes que le socle a déjà
  absorbées.
- Une ligne illisible est sautée, pas le journal.

## La fusion à la lecture

L'état vaut le socle, plus les lignes de chaque journal dont `n` dépasse la valeur de `absorbes`
pour ce journal. Chaque table déclare sa clé et sa règle de fusion (le `SCHEMA` de
`parlement/etat.py` ou `recherche/etat.py`) :

| Règle | Pour une même clé |
|---|---|
| `rang` (défaut) | on garde l'évènement le plus fort. On compare, dans l'ordre : le rang de la ligne, puis une ligne de journal plutôt que le socle, puis `maj`, puis le nom du journal et `n`, puis le texte de la ligne. Un retrait a le rang `rang_retrait` (0 par défaut) |
| `max` | champ par champ, la plus grande valeur (les repères) |
| `union` | champ par champ ; un objet ou une liste se réunissent (les identifiants connus) |

- Le rang se déclare en données : `{"champ": "statut", "valeurs": {"propose": 1}, "defaut": 0}`.
  La valeur du champ se compare en texte.
- Le résultat ne dépend ni de l'ordre de lecture des journaux, ni d'une ligne lue deux fois. Un
  statut fort l'emporte sur un « vu ».
- À rang égal, une ligne de journal non absorbée l'emporte sur le socle. Un socle publié sans
  avoir lu la dernière ligne d'un journal ne l'efface donc pas.

La fixture `moissonneurs/tests/fixtures/partage-exemple/` donne un schéma (`schema.json`), un
socle, deux journaux et des compteurs, avec le résultat attendu (`attendu.json`). Les tests
Python la lisent.

## Le compteur du mois : `requetes\<AAAA-MM>\<poste>__<compte>.json`

```json
{"format": "pronto-requetes/1", "mois": "2026-11", "requetes": 120, "maj": "…"}
```

- Le budget du mois se compare à la somme des compteurs de tous les postes. Un compteur
  illisible ne compte pas.
- Seul `moisson.py` écrit le compteur de son poste, après chaque étape et en fin de moissonneur.
- `creneau.MARGE_REQUETES` (120) couvre ce qu'un autre poste a pu dépenser sans que ce soit encore
  visible. La passe est refusée quand `somme ≥ budget − marge`, et le plafond de la passe vaut
  `budget − marge − somme`.
- Pendant la passe, le moissonneur relit les compteurs des autres postes toutes les 50 requêtes,
  et s'arrête dès que la somme atteint `budget − marge`.

## Le bilan d'une passe : `passes\<AAAA-MM>\<poste>__<compte>-<AAAAMMJJTHHMMSSZ>.json`

```json
{ "format": "pronto-passe/1", "moissonneur": "parlement", "poste": "…", "compte": "…",
  "declencheur": "cockpit", "debut": "2026-11-02T08:00:00Z", "fin": "2026-11-02T08:31:12Z",
  "requetes": 412, "code": 0, "interrompu": null, "lot": "parlement/2026-11-02-1.jsonl",
  "propositions": 17, "hors_ligne": false, "a_blanc": false }
```

- Un fichier par passe et par moissonneur, écrit par `moisson.py` quand le moissonneur a fini.
  L'heure du nom est celle de `debut`, sans séparateurs.
- `lot` vaut `null` quand rien n'a été déposé. Une passe à blanc ou hors ligne écrit aussi son
  bilan ; le cockpit qui cherche « la dernière passe » écarte celles où `a_blanc` est vrai.

## La note d'import FNS : `recherche\_partage\imports-fns\<AAAA-MM-JJ>-<poste>__<compte>.json`

```json
{ "format": "pronto-import-fns/1", "date": "2026-11-28", "heure": "2026-11-28T09:12:00Z",
  "poste": "…", "compte": "…",
  "fichier": { "taille": 430395693, "mtime": "2026-11-27T16:02:11Z", "lignes": 91297, "illisibles": 0,
               "max_call_end": "2026-04", "appels": { "2025-10": 349, "2026-04": 412 } },
  "appels_nouveaux": ["2026-04"], "nouvelles": 14, "lot": "recherche/2026-11-28-1.jsonl" }
```

- Écrite par `moisson.py import-fns`, seulement si l'import a abouti. Un second import du même
  poste le même jour la remplace.
- `mtime` est la date du téléchargement, pas celle des données : l'export du FNS n'est pas daté.
  La fraîcheur se lit dans `max_call_end`, le mois de la dernière clôture d'appel
  (`CallEndDate`).
- `appels` compte les subsides par mois de clôture d'appel. `appels_nouveaux` liste les mois qui
  manquaient à l'import précédent (vide au premier import) : on mesure ainsi le délai réel de
  publication du FNS.
- `nouvelles` : le nombre de propositions du lot ; `lot` : son chemin relatif à `_Moissons`, ou
  `null`.
- Le cockpit lit la note dont `heure` est la plus récente.

## Ce que le cockpit lit

Paramètres > Moissonnage (`lib/moisson.js`) lit ces fichiers sans lancer Python, pour dire avant
tout lancement pourquoi le bouton est désactivé :

- les annonces de `_Creneau\`, avec la même péremption que `creneau.py` ;
- la somme du mois de chaque moissonneur, comparée au budget que rend `estimer` ;
- la présence d'un `socle*.json` ;
- le plus récent des bilans `_partage\passes\`, hors passes à blanc, pour la date et le poste de
  la dernière passe ; à défaut, `etat.json` ;
- la plus récente des notes `imports-fns\`, par `heure`, à défaut par `date`.

`PERIME_S`, `ATTENTE_S` et `MARGE_REQUETES` sont recopiés de `creneau.py` dans `lib/moisson.js` ;
`test/js/moisson.test.js` vérifie qu'ils sont égaux. `moisson.py` reste seul juge : le cockpit ne
fait que prévenir.

## Les tables du parlement

Les tables partagées sont celles de la base du moissonneur (`parlement/stockage.py`). Le socle ne
garde que ce qu'une passe mensuelle lit :

| Table | Ce qui part dans le socle | Fusion |
|---|---|---|
| `corps` | tous les corps (Confédération, cantons, villes), avec leur repère | `max` |
| `connues` | par corps, `{external_id: date de dépôt}` de toutes les affaires connues. Le repère de dépôt (la plus grande date) en vient | `union` |
| `affaires`, `bruts`, `textes_recuperes`, `verdicts` | seulement les affaires qu'un prochain lot peut proposer (exportables, ni décidées ni déjà proposées telles quelles), et les candidates pas encore classées. La charge brute est réduite au titre et aux dates, plus les extraits de recherche pour une affaire à classer | `rang` |
| `candidats` | les candidates pas encore classées | `rang` |
| `figees` | pour une affaire en attente : type corrigé, langue du document, note de finesse et texte déposé, calculés là où sont ses documents | `rang` |
| `finesse` | pour toute affaire exportable : note, langues, mois, termes. Les crans et `etat.termes` en viennent | `rang` |
| `propositions` | toutes les lignes | `rang` |
| `criblages` | toutes les lignes | `max` |
| `decisions` | toutes les lignes ; une décision purgée l'emporte sur un retrait | `rang` |
| `figes` | ce que seul le poste de développement calcule sur toute sa base : `crans` (du trimestre), `noms` (listes du contrôle des noms), `refs` (fiches de référence appariées) | `rang` |

La passe mensuelle charge cet état dans une base en mémoire, au même schéma :

- une affaire figée garde son verdict, et l'export reprend ce qui a été figé : le lot sort
  identique à celui que ferait le poste de développement ;
- le contrôle des noms réunit les listes figées et celles des titres en mémoire ;
- la passe ne recalcule pas les crans. Quand un trimestre est passé, elle le signale dans
  `etapes_en_echec`.

En fin de passe, le journal reçoit :

- les identifiants nouveaux ;
- les affaires qui restent en attente, figées pendant que leurs documents sont en mémoire ;
- les propositions écrites, les verdicts, les décisions et les criblages ;
- un retrait pour chaque affaire que le lot a emportée.

Les documents des affaires restent sur le poste qui les a lus.

Le poste de développement :

- relit les journaux avant toute opération lourde : `python3 -B -m parlement absorber --base …`.
  Un retrait d'une table légère (`affaires`, `bruts`, `candidats`, `textes_recuperes`,
  `verdicts`, `figees`) veut seulement dire « plus besoin dans le partage » : sa base garde la
  ligne ;
- republie le socle sous créneau (`publier`), en refigeant ce dont il a les documents.

### Ce que la passe mensuelle ne voit pas

- Les changements d'état d'une affaire déjà connue, et une affaire enregistrée en retard avec un
  dépôt antérieur au repère. Le prochain import par les exports, au poste de développement, les
  reprend.
- Une candidate déjà classée au poste de développement sans texte récupéré : la passe ne va pas
  chercher son texte.
- Une affaire connue que la recherche de la Confédération relit le jour du repère est traitée
  comme nouvelle : au pire, une requête de documents de plus.

## Les tables de la recherche

| Table | Clé | Fusion |
|---|---|---|
| `projets` | `source`, `source_id` | `rang` : un statut fort (`propose`, `doublon`, `existant`, `ignore`, `exporte`) l'emporte sur les autres |
| `decisions` | `cle` | `rang` : une décision purgée l'emporte sur un retrait |
| `sources` | `source` | `rang` |
| `urls_refusees` | `url` | `rang` |

Le socle porte ces quatre tables, triées par clé, `projets` sans `derniere_vue`. Sans changement,
il garde son `publie_le` et sort identique à l'octet.
