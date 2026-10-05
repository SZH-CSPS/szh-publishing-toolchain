# Format de l'état partagé des moissons

Ce document décrit ce que les moissonneurs (`moissonneurs/`) gardent entre deux passes, dans le
dossier partagé, pour qu'une passe mensuelle parte de n'importe quel poste. Le code qui l'écrit et
le lit est `moissonneurs/partage.py` ; le cockpit lit les mêmes fichiers. Le format des lots reste
celui de [`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md).

## Arborescence

```
<racine>\_NewsUndActu\_Moissons\
├── _Creneau\<poste>__<compte>.json        l'annonce d'une passe en cours (moissonneurs/LISEZMOI.md)
└── <moissonneur>\
    └── _partage\
        ├── socle.json                      l'état publié par le poste de développement
        ├── journal\<poste>__<compte>.jsonl  ce qu'un poste a appris depuis le socle
        └── requetes\<AAAA-MM>\<poste>__<compte>.json   les requêtes de ce poste ce mois-là
```

- Chaque fichier n'a qu'un écrivain. Le socle s'écrit au poste de développement, sous son créneau ;
  un journal ou un compteur, par son seul poste. OneDrive ne voit donc jamais deux postes écrire le
  même fichier.
- Toute écriture est atomique : un fichier `….tmp`, puis un renommage.
- `<poste>__<compte>` est normalisé : minuscules sans accents, et tout signe autre qu'une lettre, un
  chiffre, `.` ou `_` devient `-`.
- Rien n'est en SQLite dans le partage. La base SQLite ne vit qu'en mémoire, le temps d'une passe,
  ou sur le disque du poste de développement.

## Le socle : `socle.json`

```json
{ "format": "pronto-socle/1", "moissonneur": "parlement", "publie_le": "2026-11-02T08:00:00Z",
  "poste": "…", "compte": "…", "absorbes": { "<poste>__<compte>": 41 },
  "tables": { "<table>": [ { …une ligne… } ] } }
```

| Champ | Règle |
|---|---|
| `format` | `pronto-socle/1` ; un autre format fait ignorer le fichier |
| `publie_le` | ISO 8601 en UTC. Une copie en conflit (`socle-<poste>.json`) est lue aussi : le `publie_le` le plus récent fait foi |
| `absorbes` | pour chaque journal, le plus grand numéro de ligne déjà repris dans ce socle |
| `tables` | les lignes de chaque table du moissonneur, au format de sa base |

- **Une passe mensuelle ne l'écrit jamais.** `moisson.py` pose la variable `PRONTO_MOISSON_PASSE`
  pour chaque moissonneur qu'il lance, et `partage.publier_socle` refuse alors l'écriture. Elle la
  refuse aussi sans l'annonce de créneau du même poste.
- Sans socle, il n'y a pas de passe mensuelle : `moisson.py` refuse avec `etat-absent`.

## Les journaux : `journal\<poste>__<compte>.jsonl`

La première ligne est un en-tête, `{"format": "pronto-journal/1", "moissonneur", "poste"}`. Chaque
ligne suivante est un évènement :

```json
{"n": 42, "maj": "2026-11-03T10:00:00Z", "t": "affaires", "k": ["ZH", "123"], "r": { …la ligne… }}
```

- `n` numérote les lignes du journal, sans trou, et ne recule jamais.
- `t` nomme la table, et `k` donne la clé de la ligne, en liste de textes.
- `r` porte la ligne. `r: null` est un retrait.
- Le poste réécrit son journal d'un coup, après chaque corps ou source achevés, puis en fin de passe.
  Il en retire au passage les lignes que le socle a déjà absorbées.
- Une ligne illisible est sautée, jamais le journal.

## La fusion à la lecture

L'état d'une passe vaut le socle, plus les lignes de chaque journal dont `n` dépasse `absorbes`.
Chaque table déclare sa clé et sa règle :

| Règle | Pour une même clé |
|---|---|
| `rang` (défaut) | on garde l'évènement le plus fort, comparé dans cet ordre : le rang de la ligne (`rang`), puis une ligne de journal plutôt que le socle, puis `maj`, puis le nom du journal et `n`, puis le texte de la ligne. Un retrait a le rang `rang_retrait` (0 par défaut) |
| `max` | champ par champ, la plus grande valeur (les repères) |
| `union` | champ par champ ; un objet ou une liste se réunissent (les identifiants connus) |

- Le rang se déclare en données : `{"champ": "statut", "valeurs": {"propose": 1}, "defaut": 0}`. La
  valeur du champ se compare en texte.
- Le résultat ne dépend ni de l'ordre de lecture des journaux, ni d'une ligne lue deux fois. Un statut
  fort l'emporte sur un « vu ».
- Une ligne de journal non absorbée l'emporte sur le socle à rang égal. Un socle publié sans avoir lu
  la dernière ligne d'un journal ne l'efface donc pas.

La fixture `moissonneurs/tests/fixtures/partage-exemple/` donne un schéma (`schema.json`), un socle,
deux journaux et des compteurs, avec le résultat attendu (`attendu.json`). Les tests Python la lisent,
et un test du cockpit doit rendre le même résultat.

## Le compteur du mois : `requetes\<AAAA-MM>\<poste>__<compte>.json`

`{"format": "pronto-requetes/1", "mois": "2026-11", "requetes": 120, "maj": "…"}`.

- Le budget du mois est la somme des compteurs de tous les postes. Un compteur illisible ne compte pas.
- Seul `moisson.py` écrit le compteur de son poste, après chaque étape et en fin de moissonneur.
- `creneau.MARGE_REQUETES` borne ce qu'un autre poste a pu dépenser sans être encore visible : on
  refuse la passe à `somme ≥ budget − marge`, et `--plafond` vaut `budget − marge − somme`.

## Le parlement

Les tables partagées sont celles de la base du moissonneur (`parlement/stockage.py`). Le socle n'en
garde que ce qu'une passe mensuelle lit :

| Table | Ce qui part | Règle |
|---|---|---|
| `corps` | tous les corps, avec leur repère | `max` |
| `connues` | par corps, `{external_id: date de dépôt}` de toutes les affaires connues. Le repère de dépôt (la plus grande date) et les affaires déjà vues en viennent | `union` |
| `affaires`, `bruts`, `textes_recuperes`, `verdicts` | seulement les affaires qu'un prochain lot peut proposer (exportables, ni décidées ni déjà proposées telles quelles), et les candidates pas encore classées. La charge brute est réduite au titre et aux dates, avec les extraits de recherche pour une affaire à classer | `rang` |
| `candidats` | les candidates pas encore classées | `rang` |
| `figees` | pour une affaire en attente : type corrigé, langue du document, note de finesse et texte déposé, calculés là où sont ses documents | `rang` |
| `finesse` | pour toute affaire exportable : note, langues, mois, termes. Les crans et `etat.termes` en viennent | `rang` |
| `propositions`, `criblages` | toutes les lignes | `rang`, `max` |
| `decisions` | toutes les lignes ; une décision purgée l'emporte sur un retrait | `rang` |
| `figes` | ce que seul le poste de développement calcule sur toute sa base : `crans` (du trimestre), `noms` (listes blanches du contrôle des noms), `refs` (fiches de référence appariées) | `rang` |

Une passe mensuelle charge cet état dans une base en mémoire, au même schéma, et le code du
moissonneur y tourne tel quel :
- une affaire figée garde son verdict, et l'export reprend ce qui a été figé, si bien que le lot sort
  identique à celui du poste de développement ;
- le contrôle des noms réunit les listes figées et celles des titres en mémoire ; les deux ne font
  que grandir avec les titres ;
- une passe ne recalibre pas les crans : un trimestre passé le signale dans `etapes_en_echec`.

En fin de passe, le journal reçoit :
- les identifiants nouveaux ;
- les affaires qui restent en attente, figées pendant que leurs documents sont en mémoire ;
- les propositions écrites, les verdicts, les décisions et les criblages ;
- un retrait pour chaque affaire que le lot a emportée.

Les documents ne quittent jamais le poste.

Le poste de développement :
- relit les journaux avant toute opération lourde (`python3 -B -m parlement absorber --base …`). Un
  retrait d'une table légère (`affaires`, `bruts`, `candidats`, `textes_recuperes`, `verdicts`,
  `figees`) veut seulement dire « plus besoin dans le partage » : sa base garde la ligne ;
- republie le socle sous créneau (`publier`), en refigeant ce dont il a les documents.

## Ce que la passe mensuelle ne voit pas

- Les changements d'état d'une affaire déjà connue, et une affaire enregistrée en retard avec un
  dépôt antérieur au repère : le prochain import par les exports, au poste de développement, les
  reprend.
- Une candidate déjà classée au poste de développement sans texte récupéré : la passe ne va pas
  chercher son texte.
- Une affaire connue que la recherche de la Confédération relit le jour du repère est traitée
  comme nouvelle : au pire, une requête de documents de plus.
