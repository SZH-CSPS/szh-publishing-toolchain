# Moissonneurs de Pronto

`moisson.py` est le point d'entrée commun des moissonneurs (`parlement/`, `recherche/`). Il prend le créneau de
moisson, contrôle le budget du mois, lance chaque moissonneur l'un après l'autre et traduit leur sortie en
événements `pronto-moisson/1`. Le cockpit et `console.py` sont deux rendus de ces événements, et rien d'autre.

Tout se lance depuis ce dossier, avec `python3 -B` (pas de `__pycache__` dans le toolkit), dans la WSL.

## Ligne de commande

```
python3 -B moisson.py mensuelle --racine <_NewsUndActu> --poste <nom> --compte <nom>
                                [--seulement parlement|recherche] [--hors-ligne] [--a-blanc]
python3 -B moisson.py tout <m>  --racine … --poste … --compte … [--hors-ligne] [--a-blanc]
python3 -B moisson.py estimer <m> --racine … --poste … --compte …
```

Options communes :

| Option | Valeur |
|---|---|
| `--racine` | le dossier `_NewsUndActu` actif (production ou racine de test), obligatoire. Un chemin `C:\…` devient `/mnt/c/…` |
| `--poste`, `--compte` | le nom de machine Windows et le compte, obligatoires. Ils nomment l'annonce de créneau et le compteur du mois |
| `--declencheur` | `cockpit`, `raccourci` ou `cli` (défaut). `raccourci` fait attendre Entrée à la fin, en console |
| `--evenements` | `json` ou `console`. Défaut : `console` si stdout est un terminal, `json` sinon |
| `--attente-creneau` | secondes entre l'écriture de l'annonce et sa relecture (90 par défaut) |
| `--racine-test` | drapeau posé par l'appelant quand la racine est celle de test ; recopié dans `debut.racine_test`. `moisson.py` ne devine pas, et c'est l'appelant qui choisit `--hors-ligne` |

`estimer <m>` ne prend pas de créneau : en `json`, il recopie la ligne d'estimation du moissonneur telle quelle ;
en `console`, il la résume.

`python3 -B console.py [--pause] < evenements.jsonl` rejoue une passe enregistrée.

## Ce que `moisson.py` lit et écrit

```
<racine>/                               le dossier _NewsUndActu actif
  Fiches/                               bibliothèque, lue par les moissonneurs
  _Moissons/                            sans lui : refus racine-absente
    _Creneau/<poste>__<compte>.json     l'annonce d'une passe en cours (un fichier par poste, réécrit en place)
    _Decisions/                         lu par les moissonneurs
    <m>/AAAA-MM-JJ-n.jsonl              les lots, écrits par le moissonneur
    <m>/_partage/socle.json             l'état publié depuis le poste de développement ; sans lui : refus etat-absent
    <m>/_partage/journal/…              ce que la passe a appris, écrit par le moissonneur (partage.py)
    <m>/_partage/requetes/<AAAA-MM>/<poste>__<compte>.json   le compteur du mois de CE poste
/tmp/pronto-moisson/<id-passe>/         local et jetable, effacé en fin de passe
  arret                                 la demande d'arrêt
  cache/                                le cache HTTP de la passe
/tmp/pronto-moisson/journaux/           stderr de chaque moissonneur, un fichier par passe et par moissonneur
```

`<poste>__<compte>` est normalisé : minuscules sans accents, tout autre signe que lettre, chiffre, `.` ou `_`
devient `-`.

## Ligne de commande d'un moissonneur

```
python3 -B -m <m> tout    --racine R --poste P --compte C --arret F --cache D [--plafond N] [--hors-ligne] [--a-blanc]
python3 -B -m <m> estimer --racine R --poste P --compte C --cache D
```

- stdout : une ligne JSON par événement, au format propre du moissonneur (`progression`, `attente`, `resume`) ;
  `moisson.py` les traduit. Le reste va sur stderr.
- `estimer` : une ligne `{"type":"estimation", "requetes" ou "requetes_prevues", "delai_s", "budget", "avertissements"}`.
  `budget` est le budget du MOIS.
- `--plafond N` : le moissonneur s'arrête net à N requêtes (`interrompu: "budget"`, code 3).
- `--arret F` : si le fichier existe, la couche réseau s'arrête avant sa requête suivante, écrit son lot partiel, et
  sort en 3 avec `interrompu: "arret"`.
- Codes : 0 tout est bon ; 1 terminé avec des échecs signalés dans le résumé ; 2 configuration invalide ;
  3 interrompu (budget, arrêt, ou toutes les sources en 403). Un plantage sort aussi en 1, mais sans `resume`.

## Le créneau de moisson

Une courtoisie entre postes, sans garantie d’exclusion.

1. Lister `_Creneau/` et ignorer les annonces périmées : battement de plus de 15 min, ou échéance dépassée
   (événement `creneau` `repris-perime`).
2. Une annonce vivante d'un autre poste, ou du même `poste__compte` : refus (`creneau` `refuse`, puis
   `refus` `deja-en-cours`, code 4).
3. Sinon, écrire la sienne (`.tmp` puis renommage) : `{"format":"pronto-creneau/1", "poste", "compte", "debut",
   "echeance", "battement", "declencheur", "moissonneurs"}`. L'échéance vaut 1,5 fois la durée estimée, entre
   30 min et 6 h ; 6 h si l'estimation manque.
4. Attendre `--attente-creneau`, relire. Si une autre annonce vivante est apparue, le `debut` le plus ancien gagne ;
   à égalité, l'ordre des noms de fichier départage. Le perdant retire son annonce et refuse.
5. Pendant la passe, un battement toutes les 60 s réécrit l'annonce EN PLACE. Elle est retirée dans un `finally`
   (événement `creneau` `retire`).

**Limites.**
- Si la synchronisation entre postes prend plus que l'attente, ou si un poste est hors ligne, deux passes peuvent
  se croiser. Les lots et l'état sont idempotents ; le seul vrai risque est le budget, borné par la marge.
- Une passe tuée sans `finally` (VSCodium fermé, coupure) laisse son annonce : elle bloque le même poste comme les
  autres jusqu'à sa péremption, au plus 15 min après son dernier battement.
- La péremption compare des heures UTC prises sur des postes différents.

## Le budget du mois

- `somme` : le total des compteurs `<m>/_partage/requetes/<mois>/*.json` de tous les postes ; un compteur illisible
  ne compte pas. Le mois est celui de l'heure UTC au début de la passe.
- Un moissonneur est épuisé si `somme ≥ budget − MARGE_REQUETES` (`creneau.py`, valeur provisoire) : à l'égalité, le
  plafond de la passe vaudrait déjà 0. Tous épuisés :
  refus `budget-epuise`, code 4, avant toute prise de créneau. Un seul parmi d'autres : il est sauté avec un
  avertissement.
- Le plafond local `budget − marge − somme` est passé par `--plafond`.
- Seul `moisson.py` écrit le compteur de son poste : après chaque `etape` qui fait avancer les requêtes, puis dans le
  `finally` de chaque moissonneur, pour qu'une passe interrompue compte ses requêtes réelles.
- `--hors-ligne` : ni contrôle, ni plafond, ni compteur.

## L'arrêt

L'arrêt est local au poste qui moissonne : le fichier `arret` du dossier de passe.
- Le bouton Arrêter du cockpit le crée.
- En console, le premier Ctrl+C le crée et annonce « arrêt demandé… » ; le moissonneur le lit avant sa requête
  suivante. Le second Ctrl+C tue le moissonneur et clôt la passe en code 3, le créneau rendu.
- Le moissonneur tourne dans sa propre session : le Ctrl+C du terminal n'atteint que `moisson.py`.
- Après un arrêt, les moissonneurs suivants ne sont pas lancés (avertissement, code 3).

## L'état partagé (`partage.py`)

Le format est dans [`docs/FORMAT-MOISSONS.md`](../docs/FORMAT-MOISSONS.md) : un socle, un journal par poste, un
compteur par poste et par mois, fusionnés à la lecture.
- `etat_present(racine, m)` : un socle existe. `moisson.py` le demande avant le créneau ; sans socle pour aucun des
  moissonneurs demandés, refus `etat-absent` (code 2), sinon le moissonneur sans socle est sauté avec un avertissement ;
- `charger_etat(racine, m, schema)` : `{table: [lignes]}`, le socle et les journaux fusionnés. Le moissonneur les
  charge dans une base SQLite en mémoire et y fait tourner son code tel quel ;
- `publier_journal(racine, m, poste, delta, schema)` : le moissonneur ajoute ce qu'il a appris au seul journal de son
  poste, après chaque source ou corps et à la fin ;
- `publier_socle(…)` : seulement depuis le poste de développement, sous son créneau. Une passe lancée par
  `moisson.py` porte `PRONTO_MOISSON_PASSE` et ne peut pas l'écrire ;
- `somme_mois`, `ecrire_requetes` : le budget du mois, sommé sur tous les postes ;
- `cle_poste(poste, compte)` : le nom `poste__compte` des fichiers qu'un seul poste écrit.

Sans socle, `charger_etat` et `publier_journal` lèvent `EtatAbsent` : une passe s'arrête en code 2 sans rien écrire.

Coutures de `moisson.py` qu'un test remplace : `chemins_passe(args)`, `prendre_creneau(…)`, `lancer_enfant(…)`.

## Le moissonneur de recherches (`recherche/`)

- Réglages dans `recherche/reglages.toml`, sans aucun chemin : les chemins viennent de `--racine`, `--cache` et,
  sur le poste de développement, de `--base` (une base SQLite locale) et `--fichier-snf`.
- Le FNS n'entre pas dans la passe mensuelle : son export se télécharge à la main (le robots.txt de data.snf.ch
  interdit les robots). `--sources snf` le lit, sur le poste de développement.
- User-Agent identifié, robots.txt respecté, délai par hôte ; les en-têtes envoyés sont figés par un test.
- Un 403 sur une page de détail saute la page ; elle est retentée à la passe suivante, puis notée refusée.
- Un 403 sur un point d'entrée (robots.txt, plan du site, liste) arrête la source pour la passe ; plus de la moitié
  des pages de détail refusées (trois au moins) compte de même. Deux passes de suite ainsi désactivent la source,
  que `python3 -B -m recherche reactiver <source> --base …` rétablit.
- Une attente de plus de 10 s demandée par un site (429) s'annonce par une ligne `attente`.

## Le moissonneur des interventions parlementaires (`parlement/`)

Les affaires d'OpenParlData.ch (CC BY 4.0) : Confédération, cantons et grandes villes, filtrées sur le handicap et
les besoins éducatifs particuliers. Réglages dans `parlement/reglages.toml`, sans aucun chemin ; lexiques dans
`parlement/lexique/`, des termes seulement.

- **La passe mensuelle** (`tout`, sans `--base`) part de l'état partagé. Elle est la seule à interroger l'API `/v1/`,
  par des requêtes anonymes (aucun User-Agent maison), 2 s entre deux requêtes, dans le plafond que `moisson.py` tire
  du budget du mois (800). Pour chaque corps, du plus petit au plus gros, des pages de 50 triées par `-begin_date`,
  jusqu'au premier dépôt strictement antérieur au repère de dépôt ; le jour du repère est relu. Puis la recherche des
  termes pour la Confédération, et les documents des nouvelles candidates. Elle n'importe rien, ne fait ni liste ni
  sauvegarde, et ne recalibre pas les crans.
- **Le poste de développement** garde la base complète (`--base`) et les opérations lourdes : `importer` (les exports
  de `files.openparldata.ch`, aucune requête à l'API), `classer`, `lister`, `absorber` (relire les journaux avant
  toute opération lourde), `publier` (refiger et publier le socle, sous créneau). Avec `--base`, `tout` n'appelle
  jamais l'API : seule la passe mensuelle compte son budget.
- **Aucun nom de personne** dans un titre : auteurs, signataires et « primo firmatario » sont coupés ; le contrôle
  indépendant des noms tourne à chaque export (un défaut retient la ligne, un nom possible pose le doute
  `personne-nommee`).
- **`texte_depose`** : le texte déposé, nettoyé et plafonné (voir docs/FORMAT-PROPOSITIONS.md).
- Un lot prend le numéro qui suit le plus grand du jour, sur le disque ou en base.

## Le contrat `pronto-moisson/1`

Une ligne JSON par événement sur stdout en mode `json`, et rien d'autre. Chaque événement porte
`"format":"pronto-moisson/1"` et `"type"`. Aucun champ hors de cette table : `evenements.valider()` le refuse.

| Type | Champs |
|---|---|
| `creneau` | `etat` (`pris` \| `refuse` \| `repris-perime` \| `retire`), `poste`, `compte`, `debut` (ISO UTC) ; de NOTRE annonce pour `pris` et `retire`, de l'AUTRE pour `refuse` et `repris-perime` |
| `debut` | `moissonneurs[]`, `estimation{<m>:{requetes, delai_s, budget}}`, `declencheur`, `heure` (ISO UTC), `budget_mois{<m>:{budget, marge, somme, plafond}}`, `racine_test` (booléen) |
| `etape` | `moissonneur`, `etape` (un corps, une source, ou une étape), `requetes` (de cette passe), `budget` (le plafond de la passe, ou null), `reste_s` (entier ou null), `fraction` (0 à 1, ou null) |
| `attente` | `moissonneur`, `etape` (la source), `secondes`, `motif` (ou null), `hote` (ou null) : un site demande d'attendre ; la passe n'est pas bloquée |
| `avertissement` | `moissonneur` (null pour la passe entière), `message` (fr) |
| `lot` | `moissonneur`, `chemin` (relatif à `_Moissons`, par exemple `parlement/2026-11-01-1.jsonl`), `propositions` |
| `moissonneur_fin` | `moissonneur`, `code` (0 à 3), `interrompu` (null \| `budget` \| `403` \| `arret`), `sources_en_echec[{source, raison}]`, `purge{lots, decisions}` (des nombres), `sources_desactivees[]`, `plantage` (booléen : code 1 sans `resume`) |
| `fin` | `code` (le plus grave de la passe), `duree_s` |
| `refus` | `raison` (`deja-en-cours` \| `budget-epuise` \| `etat-absent` \| `racine-absente` \| `config-invalide`), `detail` (fr) |

Ordre : `creneau` (`repris-perime`*, puis `pris`) ; `debut` ; les avertissements de préparation ; pour chaque
moissonneur ses `etape`, `attente`, `avertissement` et `lot`, puis son `moissonneur_fin` ; `creneau` `retire` ;
`fin`. Un `refus` précède toujours `debut` et n'est suivi d'aucun `fin` ; seul `deja-en-cours` le fait précéder
d'un `creneau` `refuse`.

`reste_s` est une borne, pas une promesse : il part de l'estimation et du délai de politesse, puis suit la vitesse
mesurée. Quand l'estimation est dépassée, la borne devient le plafond de la passe. `null` s'il n'est pas calculable.

À blanc (`--a-blanc`), aucun `lot` : un avertissement dit ce qui aurait été déposé.

### La traduction

`evenements.TABLES` dit, pour chaque moissonneur, quelles lignes il reconnaît. Une ligne inconnue n'est jamais
perdue : elle devient un `avertissement` qui la cite, tronquée à 200 caractères.

| Ligne du moissonneur | Événement |
|---|---|
| `progression` à `statut` `ok`, `budget`, `plafond` ou `arret` | `etape`, nommée par `corps` ou `source` (`site:x` → `x`), sinon par l'étape |
| `progression` à `statut` `echec` | `avertissement` ; une source en 403 : « x a refusé l’accès (403) », sauf pour la recherche, qui l'annonce elle-même |
| `progression` avec `detail` (restauration) | `avertissement` |
| `attente` (recherche) | `attente` |
| `avertissement` (recherche : 403, page refusée, source désactivée) | `avertissement`, avec son `message` |
| `compteur`, `mensuelle`, `import` (sous-commandes du parlement) | `etape` |
| `resume` | `lot` (ou avertissement à blanc), et un avertissement si `erreur` ou `interrompu: "configuration"` ; il nourrit `moissonneur_fin` |

## Codes de sortie de `moisson.py`

| Code | Sens |
|---|---|
| 0 | tout est bon |
| 1 | terminé, avec des échecs signalés |
| 2 | configuration invalide (commande incomplète, racine ou état absents) |
| 3 | au moins un moissonneur interrompu |
| 4 | refusé par le créneau : une passe tourne déjà, ou le budget du mois est épuisé pour tous |
| 5 | erreur inattendue : un moissonneur a planté, ou `moisson.py` lui-même |

Gravité pour « le plus grave » : 0 < 1 < 3 < 2 < 5. Le code 4 ne vient que du créneau, avant toute passe.

## Tests

```
python3 -B -m unittest discover -s . -t .
```

Hors réseau, contre de faux moissonneurs écrits par les tests dans un dossier jetable, et pour la recherche sur des
pages fictives (`recherche/tests/fixtures/`). Les pages réelles restent hors dépôt : `test_corpus_reel` les lit dans
`tmp/corpus-moissons/recherche/` s'il existe, et saute sinon. `tests/test_publication.py` refuse dans tout ce
dossier une adresse, un chemin personnel ou un identifiant de lot. La fixture
`tests/fixtures/passe-exemple.jsonl` est produite par une passe factice et partagée avec le cockpit ; pour la
régénérer : `PRONTO_FIXTURE_ECRIRE=1 python3 -B -m unittest tests.test_fixture`.
