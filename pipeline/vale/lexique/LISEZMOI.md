# Le lexique maison — pour la rédaction

Ce dossier contient le vocabulaire réellement employé dans les numéros publiés de la Revue
suisse de pédagogie spécialisée et de la Schweizerische Zeitschrift für Heilpädagogik, mesuré
sur 286 articles (92 fr, 194 de, 2 it ignorés) parus depuis septembre 2024 sur ojs.szh.ch.
Deux fichiers, un par langue — `lexique-fr.csv` et `lexique-de.csv` — sont la SOURCE DE
VÉRITÉ : ce que vous éditez ici finit, après régénération, dans le correcteur Vale du
nettoyeur de manuscrit.

## Lire et éditer le CSV

Ouvrez `lexique-fr.csv` ou `lexique-de.csv` dans un tableur (Excel, LibreOffice Calc) en
précisant le séparateur `;` et l'encodage UTF-8. Douze colonnes :

| colonne | sens |
|---|---|
| `terme` | la forme telle que rencontrée dans le corpus |
| `categorie` | `handicap`, `ecole`, `institution`, `methode`, `sigle` ou `autre` — classement automatique par racines, à corriger au besoin |
| `forme_privilegiee` | la forme à préférer (souvent identique à `terme`) |
| `variantes` | les autres formes rencontrées, séparées par `\|` |
| `frequence` / `documents` | nombre d'occurrences et nombre d'articles où le terme apparaît |
| `sigle_developpement` | pour un sigle, son développement trouvé dans le corpus |
| `statut` | `privilegie`, `deconseille`, `neutre` ou `a_trancher` — voir plus bas |
| `source_normative` | quel document ou quelle règle Vale fonde `privilegie`/`deconseille` |
| `exemple_1` / `exemple_2` | deux phrases réelles du corpus |
| `note` | remarque libre |

**Le statut** décide ce que Vale fera du terme :
- `privilegie` + `variantes` non vide → une variante sera automatiquement suggérée en
  faveur de la forme privilégiée (règle `Coherence.yml`, voir plus bas).
- `deconseille` → le terme recoupe une règle déjà existante (`CSPS.Vocabulaire.Handicap` ou
  `SZH.Vokabular.Behinderung`) que l'usage publié contredit — à netteyer là-bas, pas ici.
- `neutre` → mesuré, mais rien à trancher automatiquement.
- `a_trancher` → la rédaction doit choisir (par exemple un singulier/pluriel comme
  « élève »/« élèves », volontairement JAMAIS transformé en substitution automatique : la
  grammaire décide, pas le lexique).

**Ne mettez `privilegie` ou `deconseille` que si une ligne directrice ou une règle Vale
existante le fonde** — sinon laissez `neutre` ou `a_trancher`. C'est la même règle que pour
les règles Vale « à la main » (voir `pipeline/vale/LISEZMOI.md`).

## Régénérer les exports

```
python3 outils-dev/lexique/generer-lexique.py
```

(stdlib Python 3 seule — pas de dépendance à installer ; fonctionne aussi bien côté Windows
que dans la WSL, mais le lexique lui-même n'est mesuré que dans la WSL, voir plus bas).

Ceci écrit :
- `tmp/lexique/lexique-fr.xlsx` et `lexique-de.xlsx` — un classeur par langue, filtre
  automatique, pour la rédaction (hors git : à régénérer après un clonage ou après chaque
  édition du CSV, ce n'est jamais un fichier à envoyer par courriel puis réédité à la main).
- `tmp/lexique/lexique.tbx` — TermBase eXchange (TBX-Basic, ISO 30042), pour un outil de
  terminologie ou de TAO libre (par exemple OmegaT). Un terme français et un terme allemand
  partagent un même `termEntry` seulement quand ils partagent le même `sigle_developpement`
  ou le même texte de `terme` — la plupart des lignes n'ont pas d'équivalent dans l'autre
  langue, c'est normal.
- `pipeline/vale/styles/CSPS/Lexique/Coherence.yml` et `.../SZH/Lexique/Coherence.yml` —
  règle de substitution : une variante listée avec un statut `privilegie` est suggérée en
  faveur de la forme privilégiée.
- `pipeline/vale/styles/CSPS/Lexique/Sigle.yml` et `.../SZH/Lexique/Sigle.yml` — un sigle
  dont `sigle_developpement` est rempli doit être développé au moins une fois dans l'article
  (motif générique « Mots (SIGLE) »), sinon suggestion de vérification. Un sigle SANS
  développement connu n'entre jamais dans cette règle (rien à vérifier).
- `tmp/lexique/accept-fr.txt` et `accept-de.txt` — la liste des termes et sigles du lexique,
  pour un futur vocabulaire Vale accepté (voir « Ce qui n'est pas encore branché » ci-dessous).

Ces trois `.yml` sont marqués « généré, ne pas éditer » en tête de fichier : toute correction
se fait dans le CSV, puis on relance la commande ci-dessus. Le script est idempotent : la
même entrée produit toujours exactement les mêmes octets.

**Les règles `Coherence.yml` et `Sigle.yml` sont DÉJÀ actives**, sans toucher à `.vale.ini` :
`Lexique` est un sous-dossier de `CSPS` et de `SZH` au même titre que `Epicene` ou
`Vocabulaire`, et `.vale.ini` charge déjà tout le style `CSPS`/`SZH` (`BasedOnStyles`). Elles
apparaissent dans le rapport sous les noms `CSPS.Lexique.Coherence`, `CSPS.Lexique.Sigle`,
`SZH.Lexique.Coherence`, `SZH.Lexique.Sigle`.

## Ce qui n'est pas encore branché : `accept-*.txt`

Le vocabulaire accepté (`tmp/lexique/accept-fr.txt`/`accept-de.txt`) sert à empêcher un futur
correcteur orthographique Vale de signaler les termes et sigles maison. Le vrai mécanisme
`Vocab` de Vale exige un fichier à un emplacement précis, HORS de `styles/` (par exemple
`pipeline/vale/Vocab/Lexique/accept.txt`), déclaré par une ligne de configuration — ce que ce
chantier n'a pas le droit de poser lui-même (voir le rapport de livraison). Tant que cette
ligne n'est pas ajoutée par quelqu'un d'habilité à toucher `.vale.ini`, ces deux fichiers
restent générés dans `tmp/lexique/` (hors git), à titre de brouillon prêt à copier.

## D'où viennent les chiffres

`outils-dev/lexique/analyser-corpus.py` fait l'analyse (fréquences, sigles, variantes,
vocabulaire du handicap, faux positifs Vale) sur `tmp/corpus-ojs/` et écrit un lexique
CANDIDAT dans `tmp/lexique/candidat-lexique-{fr,de}.csv`, dans le même schéma que ce dossier.
`lexique-fr.csv`/`lexique-de.csv` en sont une copie initiale, décidée par l'agent qui a
constitué ce lexique (Robin absent au moment de la livraison) — la rédaction est libre de la
corriger ensuite sans jamais relancer l'analyseur. Relancer l'analyseur écrase seulement les
brouillons dans `tmp/lexique/`, jamais ce dossier.
