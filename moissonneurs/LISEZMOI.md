# Moissonneurs de Pronto

Les moissonneurs cherchent chaque mois des nouveautés pour la Documentation et les déposent comme
propositions, que la rédaction trie dans la vue Propositions du cockpit.

| Moissonneur | Dossier | Sources |
|---|---|---|
| interventions parlementaires | `parlement/` | OpenParlData.ch (CC BY 4.0) : Confédération, 26 cantons, grandes villes |
| projets de recherche | `recherche/` | sites des hautes écoles, SKBF, et l'export du FNS importé à la main |

`moisson.py` est le point d'entrée commun. Il prend le créneau, contrôle le budget du mois,
lance chaque moissonneur l'un après l'autre et traduit leur sortie en évènements
`pronto-moisson/1`. Le cockpit et `console.py` affichent ces évènements.

Les formats sont décrits à part :

- les lots, les décisions et `etat.json` : [`docs/FORMAT-PROPOSITIONS.md`](../docs/FORMAT-PROPOSITIONS.md) ;
- l'état partagé entre postes (socle, journaux, compteurs) : [`docs/FORMAT-MOISSONS.md`](../docs/FORMAT-MOISSONS.md).

Pour désactiver les moissonneurs sur les postes, voir [`docs/MAINTENANCE.md`](../docs/MAINTENANCE.md).

## Lancer une passe

### Depuis le cockpit

Accueil > Paramètres > Moissonnage :

- **« Lancer la moisson mensuelle »** estime la durée, demande confirmation, puis lance
  `moisson.py mensuelle`. La passe continue si on ferme le panneau, pas si on ferme l'éditeur.
- **« Arrêter »** demande l'arrêt : le moissonneur dépose ce qu'il a déjà trouvé et s'arrête
  avant sa requête suivante.
- Sur la racine de test, le bouton devient « Lancer la moisson (test : sans requête réseau) » :
  la passe tourne avec `--hors-ligne`.
- **« Importer les données FNS… »** (groupe « Données FNS ») ouvre le choix du fichier CSV, puis
  lance `moisson.py import-fns`.

Quand le bouton est désactivé, la section en dit la raison (voir [Dépannage](#dépannage)).

### En ligne de commande

Tout se lance dans la WSL, depuis ce dossier, avec `python3 -B` (pas de `__pycache__` dans le
toolkit). Les moissonneurs n'utilisent que la bibliothèque standard de Python. Sur un poste, le
dossier est `/mnt/c/ProgramData/SZH/toolkit/moissonneurs`.

Depuis PowerShell :

```powershell
wsl.exe -d SZH-Publishing -- bash -lc "cd /mnt/c/ProgramData/SZH/toolkit/moissonneurs && python3 -B moisson.py mensuelle --racine '<chemin de _NewsUndActu>' --poste $env:COMPUTERNAME --compte $env:USERNAME"
```

Les quatre commandes :

```
python3 -B moisson.py mensuelle --racine <_NewsUndActu> --poste <nom> --compte <nom>
                                [--seulement parlement|recherche] [--hors-ligne] [--a-blanc]
python3 -B moisson.py tout <m>  --racine … --poste … --compte … [--hors-ligne] [--a-blanc]
python3 -B moisson.py estimer <m> --racine … --poste … --compte …
python3 -B moisson.py import-fns --fichier <export FNS .csv> --racine … --poste … --compte …
```

- `mensuelle` lance tous les moissonneurs, ou un seul avec `--seulement` ; `tout <m>` en lance un.
- `estimer <m>` ne prend pas de créneau et ne fait aucune requête : il dit combien de requêtes et
  de temps la passe prendrait.
- `--hors-ligne` : aucune requête réseau ; le moissonneur refait seulement le lot, la purge et
  `etat.json`.
- `--a-blanc` : tout, sauf écrire le lot, `etat.json` et le journal, et purger. Un avertissement
  dit ce qui aurait été déposé.

En console, `Ctrl+C` demande l'arrêt (voir [L'arrêt](#larrêt)).
`python3 -B console.py [--pause] < evenements.jsonl` rejoue une passe enregistrée en JSON.

### Options

| Option | Valeur |
|---|---|
| `--racine` | le dossier `_NewsUndActu` actif (production ou racine de test). Obligatoire. Un chemin `C:\…` devient `/mnt/c/…` |
| `--poste`, `--compte` | le nom de la machine Windows et le compte. Obligatoires. Ils nomment l'annonce de créneau et le compteur du mois |
| `--declencheur` | `cockpit`, `raccourci` ou `cli` (défaut). `raccourci` fait attendre Entrée à la fin, en console |
| `--evenements` | `json` ou `console`. Défaut : `console` si la sortie est un terminal, `json` sinon |
| `--arret` | le fichier de demande d'arrêt, choisi par l'appelant (chemin WSL ou `C:\…`). Défaut : `/tmp/pronto-moisson/<id-passe>/arret`. Un fichier déjà présent au lancement est effacé |
| `--attente-creneau` | secondes entre l'écriture de l'annonce de créneau et sa relecture (90 par défaut) |
| `--racine-test` | posé par l'appelant quand la racine est celle de test ; recopié dans `debut.racine_test`. C'est l'appelant qui choisit aussi `--hors-ligne` |

### Ce que `moisson.py` lit et écrit

```
<racine>/                               le dossier _NewsUndActu actif
  Fiches/                               la bibliothèque, lue par les moissonneurs
  _Moissons/                            absent : refus racine-absente
    _Creneau/<poste>__<compte>.json     l'annonce d'une passe en cours
    _Decisions/                         lu par les moissonneurs
    <m>/AAAA-MM-JJ-n.jsonl              les lots
    <m>/_partage/socle.json             l'état publié par le poste de développement ; absent : refus etat-absent
    <m>/_partage/journal/…              ce que la passe a appris
    <m>/_partage/requetes/<AAAA-MM>/<poste>__<compte>.json   le compteur du mois de ce poste
    <m>/_partage/passes/<AAAA-MM>/…     le bilan de chaque passe
    recherche/_partage/imports-fns/…    la note de chaque import FNS
/tmp/pronto-moisson/<id-passe>/         dans la WSL, effacé en fin de passe
  arret                                 la demande d'arrêt
  cache/                                le cache HTTP de la passe
/tmp/pronto-moisson/journaux/           la sortie d'erreur de chaque moissonneur, un fichier par passe et par moissonneur
```

## Comment une passe se déroule

### Le créneau

Le créneau évite que deux postes moissonnent en même temps. C'est une courtoisie entre postes,
sans garantie d'exclusion (`creneau.py`).

1. `moisson.py` liste `_Creneau/` et ignore les annonces périmées : pas de battement depuis plus
   de 15 minutes, ou échéance dépassée (évènement `creneau` `repris-perime`).
2. Une annonce vivante d'un autre poste, ou du même `poste__compte`, fait refuser la passe
   (`creneau` `refuse`, puis `refus` `deja-en-cours`, code 4).
3. Sinon, il écrit sa propre annonce : `{"format": "pronto-creneau/1", "poste", "compte",
   "debut", "echeance", "battement", "declencheur", "moissonneurs"}`. L'échéance vaut 1,5 fois la
   durée estimée, entre 30 minutes et 6 heures ; 6 heures sans estimation.
4. Il attend `--attente-creneau` secondes, puis relit. Si une autre annonce vivante est apparue,
   la plus ancienne (`debut`) gagne ; à égalité, l'ordre des noms de fichier départage. Le perdant
   retire son annonce et refuse.
5. Pendant la passe, un battement réécrit l'annonce toutes les 60 secondes. L'annonce est retirée
   en fin de passe, même en cas d'erreur (`creneau` `retire`).

Limites :

- si OneDrive synchronise plus lentement que l'attente, ou si un poste est hors ligne, deux passes
  peuvent se croiser. Les lots et l'état le supportent ; le seul vrai risque est de dépasser le
  budget, et la marge le borne ;
- une passe tuée brutalement (VSCodium fermé, coupure de courant) laisse son annonce. Elle bloque
  tous les postes, y compris le sien, jusqu'à sa péremption : au plus 15 minutes après son
  dernier battement ;
- la péremption compare des heures UTC prises sur des postes différents.

### Le budget du mois

Chaque moissonneur a un budget de requêtes par mois, tous postes confondus :

| Moissonneur | Budget | Délai entre deux requêtes | Réglage |
|---|---|---|---|
| `parlement` | 800 | 2 s | `parlement/reglages.toml`, section `[mensuelle]` |
| `recherche` | 3 000 | 3 s par site | `recherche/reglages.toml` |

- `somme` : le total des compteurs `<m>/_partage/requetes/<mois>/*.json` de tous les postes. Un
  compteur illisible ne compte pas. Le mois est celui de l'heure UTC au début de la passe.
- Un moissonneur est épuisé si `somme ≥ budget − 120`. La marge de 120 requêtes
  (`MARGE_REQUETES` de `creneau.py`) couvre ce qu'un autre poste dépense pendant environ
  4 minutes de retard de synchronisation OneDrive, à 2 secondes la requête.
- Tous épuisés : refus `budget-epuise`, code 4, avant de prendre le créneau. Un seul épuisé parmi
  d'autres : il est sauté avec un avertissement.
- Le plafond de la passe, `budget − marge − somme`, est passé au moissonneur par `--plafond`.
- Pendant la passe, le moissonneur relit les compteurs des autres postes toutes les 50 requêtes
  (`partage.BudgetPartage`) et s'arrête (`interrompu: "budget"`, code 3) dès que la somme atteint
  `budget − marge`.
- Seul `moisson.py` écrit le compteur de son poste : après chaque étape qui a fait des requêtes,
  puis à la fin de chaque moissonneur, même interrompu.
- Avec `--hors-ligne` : ni contrôle, ni plafond, ni compteur.

### L'arrêt

L'arrêt est local au poste qui moissonne : c'est la présence du fichier `--arret`.

- Le bouton « Arrêter » du cockpit crée ce fichier. Le cockpit ne tue jamais le processus.
- En console, le premier `Ctrl+C` crée le fichier et affiche « arrêt demandé… ». Le second tue le
  moissonneur et clôt la passe en code 3, le créneau rendu.
- Le moissonneur lit le fichier avant chaque requête. Il écrit alors son lot partiel et sort en
  code 3 (`interrompu: "arret"`).
- Après un arrêt, les moissonneurs suivants ne sont pas lancés.
- Le moissonneur tourne dans sa propre session : le `Ctrl+C` du terminal n'atteint que
  `moisson.py`.

### L'état partagé

Une passe mensuelle part de l'état publié par le poste de développement (le socle), plus ce que
les autres postes ont appris depuis (leurs journaux). Le format est dans
[`docs/FORMAT-MOISSONS.md`](../docs/FORMAT-MOISSONS.md). Les fonctions de `partage.py` :

| Fonction | Rôle |
|---|---|
| `etat_present(racine, m)` | un socle existe. Sans socle pour aucun des moissonneurs demandés : refus `etat-absent` (code 2) ; sinon, le moissonneur sans socle est sauté avec un avertissement |
| `charger_etat(racine, m, schema)` | le socle et les journaux fusionnés, `{table: [lignes]}`. Le moissonneur les charge dans une base SQLite en mémoire |
| `publier_journal(…)` | ajoute ce que la passe a appris au journal de son poste, après chaque source ou corps et à la fin |
| `publier_socle(…)` | au poste de développement seulement, sous créneau. Refusé quand la variable `PRONTO_MOISSON_PASSE` est posée, ce que fait `moisson.py` |
| `somme_mois`, `ecrire_requetes`, `BudgetPartage` | le budget du mois, sommé sur tous les postes |
| `ecrire_bilan_passe` | le bilan `pronto-passe/1` de chaque passe |
| `cle_poste(poste, compte)` | le nom `poste__compte` des fichiers qu'un seul poste écrit |

Sans socle, `charger_etat` et `publier_journal` lèvent `EtatAbsent` : la passe s'arrête en code 2
sans rien écrire.

`commun.py` regroupe ce que les deux moissonneurs partagent : écriture atomique, nom et écriture
d'un lot (le numéro suit le plus grand du jour, sur le disque ou en base), `etat.json`, lecture
des fichiers Kirby et des décisions, purge à six mois, masque des noms.

## Le poste de développement

Le poste de développement garde la base complète de chaque moissonneur, un fichier SQLite local
passé par `--base`. Avec `--base`, un moissonneur travaille sur cette base au lieu de l'état
partagé.

L'ordre de travail :

1. relire les journaux des postes dans la base : `python3 -B -m <m> absorber --base <base> --racine <_NewsUndActu>` ;
2. faire les opérations lourdes (ci-dessous) ;
3. publier le socle : `python3 -B -m <m> publier --base <base> --racine <_NewsUndActu> --poste <nom> --compte <nom>`.

`publier` prend le créneau du poste (code 4 s'il est tenu), relit les journaux comme `absorber`,
écrit `_Moissons/<m>/_partage/socle.json`, puis rend le créneau. Sans changement, le socle sort
identique à l'octet. Sous `PRONTO_MOISSON_PASSE`, il est refusé en code 2 avant le créneau, et la
base reste intacte. Il rend sur la sortie standard une ligne
`{"type": "socle", "chemin", "octets", "inchange", "tables"}`.

`absorber` reprend les lignes de journaux que la base n'a pas encore lues (table locale
`partage_absorbes`). Un projet ou une affaire déjà en base garde son identifiant.

## Le moissonneur de recherches (`recherche/`)

- Réglages dans `recherche/reglages.toml`, sans chemin : les chemins viennent de `--racine`,
  `--cache`, et au poste de développement de `--base` et `--fichier-snf`.
- Sources : les sites des hautes écoles (`sources/sites.py`, liste dans `[sources.sites]`), SKBF
  (`sources/skbf.py`), et le FNS (`sources/snf.py`), lu seulement depuis un export.
- User-Agent identifié, robots.txt respecté, délai par hôte. Les en-têtes envoyés sont figés par un
  test.
- Une attente de plus de 10 secondes demandée par un site (réponse 429) s'annonce par un
  évènement `attente`.
- Un 403 sur une page de détail saute la page ; elle est retentée à la passe suivante, puis notée
  refusée.
- Un 403 sur un point d'entrée (robots.txt, plan du site, liste) arrête la source pour la passe.
  Plus de la moitié des pages de détail refusées (trois au moins) compte de même. Deux passes de
  suite ainsi désactivent la source.
- Une proposition dont ni la page ni le titre ne disent sûrement la langue prend
  `langue_par_defaut` (`de`) avec le doute `langue-devinee`.

### L'export du FNS : `import-fns`

Le robots.txt de data.snf.ch interdit les robots. L'export « Grants with abstracts (CSV) » se
télécharge donc à la main, puis `import-fns --fichier <chemin>` le lit sur place, en flux, sans
le copier et sans aucune requête réseau.

1. **Contrôles, avant le créneau** (`sources/snf.py`) :
   - taille d'au moins 50 Mo ;
   - en-tête : séparateur `;`, BOM facultatif, colonnes de `COLONNES_EXIGEES` (dont `Abstract` et
     `LaySummary_De`, `_Fr`, `_En`) ;
   - lecture complète : au moins 10 000 lignes, au plus 1 % de lignes illisibles (mauvais nombre
     de champs, sans `GrantNumber`, octet invalide).

   Un échec donne `refus` `fichier-invalide` (code 2), avec un détail lisible (« c'est l'export
   sans résumés (grants.csv) », « colonnes manquantes : … »). Sans socle : `refus`
   `etat-absent`.
2. **Sous créneau**, les mêmes évènements qu'une passe, avec `debut.declencheur` = `import-fns`,
   `debut.moissonneurs` = `["recherche"]` et `debut.budget_mois` = `{}`. Le moissonneur de
   recherche tourne sur la seule source `snf`, avec `--plafond 0`. Aucun compteur du mois n'est
   écrit.
3. **Dédoublonnage et filtre** comme dans une passe : la clé `recherche:snf:<GrantNumber>` contre
   l'état partagé, puis le filtre de `recherche/reglages.toml`. Le lot est un lot ordinaire.
4. **La note d'import** est écrite si le moissonneur finit en code 0 ou 1 sans échec de la source
   `snf` ([`FORMAT-MOISSONS.md`](../docs/FORMAT-MOISSONS.md)). Un fichier plus ancien que celui du
   dernier import donne un avertissement, pas un refus.

Seules les colonnes de `COLONNES_LUES` sont lues : `ResponsibleApplicantName` n'y est pas, et les
noms de personne possibles sont retirés de `Institute`.

Au poste de développement, `--sources snf --fichier-snf <chemin> --base …` lit aussi l'export.

## Le moissonneur des interventions parlementaires (`parlement/`)

Les affaires d'OpenParlData.ch, filtrées sur le handicap et les besoins éducatifs particuliers.
Réglages dans `parlement/reglages.toml`, sans chemin. Lexiques dans `parlement/lexique/`, des
termes seulement, en fr, de et it :

| Fichier | Rôle |
|---|---|
| `ancrage.toml` | les termes dont la présence est nécessaire pour retenir une affaire |
| `thematiques.toml` | les thèmes de la Revue, qui élargissent le périmètre (toujours « à relire ») |
| `domaines.toml` | les domaines de la CDPH, qui classent une affaire retenue (l'éducation en tête) sans jamais la retenir |
| `exclusions.toml` | ce qui écarte une affaire : faux amis neutralisés (« handicap fiscal », « Verkehrsbehinderung »), types d'affaires du gouvernement à jeter (budgets, comptes, rapports de gestion) |

### La passe mensuelle

`tout`, sans `--base`, part de l'état partagé. C'est la seule commande qui interroge l'API
`/v1/` :

- requêtes anonymes (sans User-Agent maison), 2 secondes entre deux requêtes, dans le plafond que
  `moisson.py` tire du budget du mois (800) ;
- pour chaque corps, du plus petit au plus gros (nombre d'affaires en base), des pages de 50
  affaires triées par date de dépôt décroissante (`sort_by=-begin_date`), jusqu'à la première
  affaire déposée strictement avant le repère de dépôt. Les affaires du jour du repère sont
  relues ;
- puis la recherche des termes pour la Confédération, et les documents des nouvelles candidates ;
- elle n'importe rien, ne fait ni liste ni sauvegarde, et ne recalcule pas les crans.

Un corps sans repère (jamais importé) n'est pas moissonné par l'API.

### Au poste de développement

Avec `--base`, `tout` n'appelle jamais l'API. Les opérations lourdes :

| Commande | Rôle |
|---|---|
| `importer` | importe les exports en lot de `files.openparldata.ch` (fichiers statiques, 5 s entre deux fichiers), sans requête à l'API |
| `classer` | reclasse toutes les candidates |
| `lister` | liste Markdown, par mois de dépôt (`--mois AAAA-MM`) |
| `sauvegarder` | sauvegarde compressée de la base |
| `absorber`, `publier` | voir [Le poste de développement](#le-poste-de-développement) |

`publier` ne refige que ce qui a changé. Chaque note et chaque texte figés sont notés dans la
table locale `reprise_figee`, avec l'empreinte de tout ce que leur calcul a lu : la version
`etat.VERSION_FIGER`, le code des modules de `etat.MODULES_FIGER`, les fichiers du lexique, les
réglages, la ligne de l'affaire, ses bruts et ses documents. Une empreinte inchangée reprend le
résultat tel quel ; un lexique, un réglage ou un module changé refige tout.

### Types d'affaires

Le type d'une affaire devient le jeton `instrument` du contrat (`correspondances.py`). Un type
sans jeton rend `None`, et l'export le signale.

- Le type vient d'abord du type harmonisé de l'API (`TYPES_HARMONISES`).
- Une `Standesinitiative` n'a pas de type harmonisé : elle se reconnait à son libellé cantonal
  (`type_name`) et devient `initiative-cantonale`.
- Genève porte son type en préfixe du numéro (`PREFIXES_GE` : `M`, `PO`, `IU`, `Q`, `PL`,
  `C`…). Lucerne et Vaud, quand l'API ne donne pas le type, le portent dans le numéro
  (`PREFIXES_LU`, `PREFIXES_VD`).
- À Bâle-Campagne, une « Vorlage » se reclasse d'après la ligne `Geschäftstyp:` de son document.
- Certains types ne sont retenus que sur un ancrage fort dans le titre (`HARM_RESTREINTS`,
  `PREFIXES_GE_RESTREINTS`).
- Une affaire du gouvernement (`Regierungsgeschäft`) est gardée ou jetée selon son libellé
  cantonal : lois et messages gardés, budgets, comptes et rapports de gestion jetés
  (`[regierungsgeschaeft]` de `lexique/exclusions.toml`).
- Une affaire s'identifie par `body_key` et `external_id` : le numéro seul ne suffit pas.

### Noms de personne et texte déposé

- Un titre ne porte aucun nom de personne : auteurs, signataires et « primo firmatario » sont
  coupés. Le contrôle des noms tourne à chaque export : un défaut retient la ligne, un nom
  possible pose le doute `personne-nommee`.
- `texte_depose` porte le texte déposé, nettoyé et plafonné
  ([`FORMAT-PROPOSITIONS.md`](../docs/FORMAT-PROPOSITIONS.md#le-texte-déposé)).

## Référence

### La ligne de commande d'un moissonneur

`moisson.py` lance chaque moissonneur ainsi :

```
python3 -B -m <m> tout    --racine R --poste P --compte C --arret F --cache D [--plafond N] [--hors-ligne] [--a-blanc]
python3 -B -m <m> estimer --racine R --poste P --compte C --cache D
```

- Sortie standard : une ligne JSON par évènement, au format propre du moissonneur (`progression`,
  `attente`, `resume`…). Le reste va sur la sortie d'erreur.
- `estimer` rend une ligne `{"type": "estimation", …}` avec `requetes` ou `requetes_prevues`,
  `delai_s`, `budget` (celui du mois) et `avertissements`.
- `--plafond N` : arrêt à N requêtes (`interrompu: "budget"`, code 3).
- `--arret F` : arrêt avant la requête suivante si le fichier existe (`interrompu: "arret"`,
  code 3).
- Codes : 0 tout est bon ; 1 terminé avec des échecs signalés ; 2 configuration invalide ;
  3 interrompu (budget, arrêt, ou toutes les sources en 403). Un plantage sort aussi en 1, mais
  sans `resume`.

### Les évènements `pronto-moisson/1`

En mode `json`, une ligne JSON par évènement sur la sortie standard, et rien d'autre. Chaque
évènement porte `"format": "pronto-moisson/1"` et `"type"`. Un champ hors de ce tableau est
refusé par `evenements.valider()`.

| Type | Champs |
|---|---|
| `creneau` | `etat` (`pris`, `refuse`, `repris-perime`, `retire`), `poste`, `compte`, `debut` (ISO UTC). Pour `pris` et `retire`, notre annonce ; pour `refuse` et `repris-perime`, celle de l'autre poste |
| `debut` | `moissonneurs[]`, `estimation{<m>: {requetes, delai_s, budget}}`, `declencheur` (`cockpit`, `raccourci`, `cli`, `import-fns`), `heure` (ISO UTC), `budget_mois{<m>: {budget, marge, somme, plafond}}`, `racine_test` (booléen) |
| `etape` | `moissonneur`, `etape` (un corps, une source ou une étape), `requetes` (de cette passe), `budget` (le plafond de la passe, ou `null`), `reste_s` (entier ou `null`), `fraction` (0 à 1, ou `null`) |
| `attente` | `moissonneur`, `etape` (la source), `secondes`, `motif` (ou `null`), `hote` (ou `null`) : un site demande d'attendre ; la passe continue |
| `avertissement` | `moissonneur` (`null` pour la passe entière), `message` (en français) |
| `lot` | `moissonneur`, `chemin` (relatif à `_Moissons`, par exemple `parlement/2026-11-01-1.jsonl`), `propositions` |
| `moissonneur_fin` | `moissonneur`, `code` (0 à 3), `interrompu` (`null`, `budget`, `403`, `arret`), `sources_en_echec[{source, raison}]`, `purge{lots, decisions}` (des nombres), `sources_desactivees[]`, `plantage` (booléen : code 1 sans `resume`) |
| `fin` | `code` (le plus grave de la passe), `duree_s` |
| `refus` | `raison` (`deja-en-cours`, `budget-epuise`, `etat-absent`, `racine-absente`, `config-invalide`, `fichier-invalide`), `detail` (en français) |

Ordre des évènements :

1. `creneau` (`repris-perime` s'il y en a, puis `pris`) ;
2. `debut`, puis les avertissements de préparation ;
3. pour chaque moissonneur : ses `etape`, `attente`, `avertissement` et `lot`, puis son
   `moissonneur_fin` ;
4. `creneau` `retire` ;
5. `fin`.

Un `refus` vient toujours avant `debut`, et aucun `fin` ne le suit. Seul `deja-en-cours` est
précédé d'un `creneau` `refuse`.

`reste_s` est une borne, pas une promesse : il part de l'estimation et du délai entre requêtes,
puis suit la vitesse mesurée. Quand l'estimation est dépassée, la borne devient le plafond de la
passe.

### La traduction des lignes d'un moissonneur

`evenements.TABLES` dit, pour chaque moissonneur, quelles lignes il reconnaît. Une ligne inconnue
n'est pas perdue : elle devient un `avertissement` qui la cite, coupée à 200 caractères.

| Ligne du moissonneur | Évènement |
|---|---|
| `progression` de statut `ok`, `budget`, `plafond` ou `arret` | `etape`, nommée par `corps` ou `source` (`site:x` → `x`), sinon par l'étape |
| `progression` de statut `echec` | `avertissement`. Une source en 403 : « x a refusé l'accès (403) », sauf pour la recherche, qui l'annonce elle-même |
| `progression` avec `detail` (restauration) | `avertissement` |
| `attente` (recherche) | `attente` |
| `avertissement` (recherche : 403, page refusée, source désactivée) | `avertissement`, avec son `message` |
| `compteur`, `mensuelle`, `import` (parlement) | `etape` |
| `resume` | `lot` (ou un avertissement à blanc), plus un avertissement si `erreur` ou `interrompu: "configuration"` ; il nourrit `moissonneur_fin` |

### Codes de sortie de `moisson.py`

| Code | Sens |
|---|---|
| 0 | tout est bon |
| 1 | terminé, avec des échecs signalés |
| 2 | configuration invalide : commande incomplète, racine ou socle absents, export FNS refusé |
| 3 | au moins un moissonneur interrompu |
| 4 | refusé par le créneau : une passe tourne déjà, ou le budget du mois est épuisé pour tous |
| 5 | erreur inattendue : un moissonneur a planté, ou `moisson.py` lui-même |

Pour « le plus grave » de la passe, l'ordre est 0 < 1 < 3 < 2 < 5. Le code 4 ne vient que du
créneau, avant toute passe.

## Dépannage

**Le bouton est désactivé : « L'état partagé est absent ».**
Aucun socle n'a été publié pour ce moissonneur sur cette racine. Au poste de développement,
lancer `publier` (voir [Le poste de développement](#le-poste-de-développement)) sur la même
racine.

**Le bouton est désactivé : une passe est annoncée par un autre poste, ou par celui-ci.**
Une passe tourne, ou une passe interrompue brutalement a laissé son annonce dans `_Creneau/`.
Attendre : l'annonce est périmée 15 minutes après son dernier battement. Ne pas effacer le
fichier d'un poste qui moissonne encore.

**Le bouton est désactivé : « Le budget de requêtes du mois est épuisé ».**
La somme des compteurs du mois atteint `budget − 120`. La passe suivante repart au début du mois
prochain (heure UTC).

**« Le dossier _Moissons est introuvable à la racine active. »**
La racine active (test ou production) n'a pas de `_NewsUndActu\_Moissons\`. Vérifier l'emplacement
des revues dans les Paramètres, et que OneDrive a bien synchronisé le dossier.

**L'import FNS est refusé (`fichier-invalide`).**
Le détail dit pourquoi. Le cas le plus courant : le fichier téléchargé est l'export sans résumés
(`grants.csv`) au lieu de « Grants with abstracts (CSV) ».

**Une source de recherche ne donne plus rien.**
Après deux passes de suite en 403, elle est désactivée (`sources_desactivees` dans
`moissonneur_fin`). Au poste de développement, après `absorber` :
`python3 -B -m recherche reactiver <source> --base <base> --racine <_NewsUndActu>` (par exemple
`site:phsg` ou `skbf` ; une adresse rétablit une page refusée), puis `publier`.

**Un moissonneur a planté (code 5, `plantage: true`).**
Sa sortie d'erreur est dans la WSL, sous `/tmp/pronto-moisson/journaux/`, un fichier par passe et
par moissonneur.

## Tests

Dans la WSL, depuis ce dossier :

```
python3 -B -m unittest discover -s . -t .
```

Ou depuis le dépôt, sous Windows : `node --test test/js/moissonneurs.test.js`, qui lance la même
commande dans la WSL et vérifie qu'aucun `__pycache__` n'apparait.

- Les tests tournent hors réseau, contre de faux moissonneurs écrits dans un dossier jetable, et
  pour la recherche sur des pages fictives (`recherche/tests/fixtures/`).
- Les pages réelles restent hors dépôt : `test_corpus_reel` les lit dans
  `tmp/corpus-moissons/recherche/` s'il existe, et se saute sinon.
- `tests/test_publication.py` refuse dans tout ce dossier une adresse, un chemin personnel ou un
  identifiant de lot.
- La fixture `tests/fixtures/passe-exemple.jsonl` est produite par une passe factice et partagée
  avec les tests du cockpit. Pour la régénérer :
  `PRONTO_FIXTURE_ECRIRE=1 python3 -B -m unittest tests.test_fixture`.
