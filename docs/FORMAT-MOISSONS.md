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
        ├── requetes\<AAAA-MM>\<poste>__<compte>.json   les requêtes de ce poste ce mois-là
        ├── passes\<AAAA-MM>\<poste>__<compte>-<heure>.json   le bilan de chaque passe
        └── imports-fns\<AAAA-MM-JJ>-<poste>__<compte>.json   la note de chaque import FNS (recherche)
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
- `creneau.MARGE_REQUETES` (120) borne ce qu'un autre poste a pu dépenser sans être encore visible : on
  refuse la passe à `somme ≥ budget − marge`, et `--plafond` vaut `budget − marge − somme`.
- Pendant la passe, le moissonneur relit les compteurs des autres postes toutes les 50 requêtes et
  s'arrête net dès que la somme atteint `budget − marge`.

## Le bilan d'une passe : `passes\<AAAA-MM>\<poste>__<compte>-<AAAAMMJJTHHMMSSZ>.json`

```json
{ "format": "pronto-passe/1", "moissonneur": "parlement", "poste": "…", "compte": "…",
  "declencheur": "cockpit", "debut": "2026-11-02T08:00:00Z", "fin": "2026-11-02T08:31:12Z",
  "requetes": 412, "code": 0, "interrompu": null, "lot": "parlement/2026-11-02-1.jsonl",
  "propositions": 17, "hors_ligne": false, "a_blanc": false }
```

- Un fichier par passe et par moissonneur, écrit par `moisson.py` à la fin du moissonneur. L'heure du
  nom est celle de `debut`, sans séparateurs.
- `lot` vaut `null` quand rien n'a été déposé. Une passe à blanc ou hors ligne écrit aussi son bilan ;
  le cockpit qui cherche « la dernière passe » écarte celles où `a_blanc` est vrai.

## La note d'import FNS : `recherche\_partage\imports-fns\<AAAA-MM-JJ>-<poste>__<compte>.json`

```json
{ "format": "pronto-import-fns/1", "date": "2026-11-28", "heure": "2026-11-28T09:12:00Z",
  "poste": "…", "compte": "…",
  "fichier": { "taille": 430395693, "mtime": "2026-11-27T16:02:11Z", "lignes": 91297, "illisibles": 0,
               "max_call_end": "2026-04", "appels": { "2025-10": 349, "2026-04": 412 } },
  "appels_nouveaux": ["2026-04"], "nouvelles": 14, "lot": "recherche/2026-11-28-1.jsonl" }
```

- Écrite par `moisson.py import-fns`, seulement si l'import a abouti. Un second import du même poste le
  même jour la remplace.
- `mtime` est la date du téléchargement, pas celle des données : l'export n'est pas daté. L'indice de
  fraîcheur est `max_call_end`, le mois de la dernière clôture d'appel (`CallEndDate`).
- `appels` compte les subsides par mois de clôture d'appel ; `appels_nouveaux` dit ceux qui manquaient
  au fichier de l'import précédent (vide au premier import), pour mesurer le délai réel de publication.
- `nouvelles` : les propositions du lot ; `lot` : son chemin relatif à `_Moissons`, ou `null`.
- Le cockpit lit la note dont `heure` est la plus récente.

## Ce que le cockpit lit

Paramètres > Moissonnage (`lib/moisson.js`) lit ces fichiers sans passer par le moteur, pour dire
avant tout lancement pourquoi le bouton est désactivé :
- les annonces de `_Creneau\`, avec la même péremption que `creneau.py` ;
- la somme du mois de chaque moissonneur, comparée au budget qu'`estimer` rend ;
- la présence d'un `socle*.json` ;
- le plus récent des bilans `_partage\passes\` (`pronto-passe/1`), hors passes à blanc, pour la
  dernière passe et son poste ; à défaut, `etat.json` ;
- la plus récente des notes `recherche\_partage\imports-fns\*.json` (`pronto-import-fns/1`), par
  `heure`, puis par `date` (le jour seul) à défaut.

Arrêter crée le fichier que le cockpit a passé par `--arret`, un fichier temporaire du poste ; il
n'est actif qu'après l'événement `debut`.

`PERIME_S`, `ATTENTE_S` et `MARGE_REQUETES` sont recopiés dans `lib/moisson.js` ;
`test/js/moisson.test.js` les compare à `creneau.py`. `moisson.py` reste seul juge : le cockpit
ne fait que prévenir.

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
