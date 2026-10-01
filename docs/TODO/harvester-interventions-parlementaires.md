# Harvester des interventions parlementaires — méthode et configuration

Veille des objets et décisions parlementaires des 26 cantons et de la Confédération,
filtrés sur le champ du CSPS : pédagogie spécialisée, scolarisation des élèves à besoins
éducatifs particuliers, handicap au sens large, droits qui s'y rattachent. Sortie visée :
une liste mensuelle, reprise en synthèse trimestrielle, destinée à publication.

Étude de faisabilité du 18.09.2026. Tous les chiffres de ce document ont été mesurés à
cette date, pas estimés. Rien n'est implémenté.

---

## Décision de fond : ne pas construire de moissonneur

`api.openparldata.ch` (opendata.ch + Fondation Mercator + Glue AG, en production depuis
février 2026) couvre déjà **les 26 cantons, la Confédération, le Liechtenstein et une
cinquantaine de villes** — 89 corps au total, 323 983 affaires, 547 471 interventions.
Le texte des PDF y est **déjà extrait**, et les PDF sont miroités chez eux.

Construire 26 connecteurs reviendrait à refaire, moins bien, un travail existant, ouvert
et sous licence CC BY 4.0. Le travail propre au CSPS commence au-dessus : c'est le filtre
thématique, que personne d'autre ne fera.

Courriel envoyé à `info@openparldata.ch` le 18.09.2026 pour clarifier le `robots.txt`
(voir « Statut juridique » plus bas). **Ne rien mettre en production avant leur réponse.**

---

## La source

Base : `https://api.openparldata.ch/v1`
Documentation : `/documentation` (Swagger), spec brute `/openapi.json` (159 chemins)
Licence : **CC BY 4.0**, attribution imposée « Source: OpenParlData.ch »
Code : GitLab `opendata.ch/openparldatach` — Apache Hop (ETL) + PostgreSQL + FastAPI

### Endpoints utiles

| Endpoint | Usage |
|---|---|
| `/affairs/` | liste et recherche, c'est l'entrée principale |
| `/affairs/{id}/docs` | **les documents avec leur texte extrait** |
| `/affairs/{id}/votings` | résultats de vote (oui/non/abstention/absent) |
| `/affairs/{id}/contributors` | auteur·e, parti, rôle (premier signataire / cosignataire) |
| `/affairs/{id}/texts` | rend 0 partout dans mes sondages — **ne pas s'en servir** |
| `/affairs/group_by/body_key` | couverture par corps |
| `/affairs/group_by/types_harmonized` | 18 types harmonisés |
| `/affairs/group_by/states_harmonized` | états harmonisés — quasi vide, voir plus bas |

### Paramètres de `/affairs/`

`offset`, `limit`, `sort_by` (préfixe `-` = descendant), `fields`, `expand`,
`search`, `search_mode` (`partial` par défaut / `exact` / `natural` / `boolean`),
`search_language` (`de` `fr` `it` `rm` `en`),
`search_scope` (`metadata` / `docs` / `texts` / `speeches` / `all`, ou combinaisons),
`body_key`, `lang`, `lang_fallback`, `hide_null`, `exclude_null`,
`output_format` (`json` ou `excel`).

### Champs d'un document (`/affairs/{id}/docs`)

`id`, `body_key`, `parent_type`, `external_id`, `name`, `url` (source cantonale),
`url_oparl` (**copie miroir chez eux — préférer celle-ci**), `date`, `size`,
`category_harmonized`, `format`, `language`, **`text`** (texte extrait), `affair_id`,
`category`.

---

## Méthode de récolte

### Clé d'incrémentalité

**`sort_by=-updated_at`**, et on pagine jusqu'à repasser sous son propre repère (watermark).
Vérifié : le pipeline d'OpenParlData tourne la nuit, les premières lignes portaient
`2026-09-18T03:37:51`.

⚠ **Ne pas filtrer par date.** Voir le piège n° 1 : les filtres de type `__gte` sont
silencieusement ignorés.

### Cadence

Mesuré : **2 191 affaires sur 30 jours**, 3 805 sur 90 jours, 18 862 sur un an, tous corps
confondus. Une récolte mensuelle représente donc moins de 3 000 requêtes (liste paginée à
`limit=500`, puis `/docs` par affaire). À une requête par seconde, c'est moins d'une heure,
une fois par mois. C'est le chiffre annoncé dans le courriel — s'y tenir.

### Stockage

Garder **la charge utile brute et son empreinte**, jamais écrasée. Le remappage doit
pouvoir se rejouer sans re-moissonner. Conserver systématiquement `url_external` /
`url` (la source cantonale) comme filet de sécurité si l'agrégateur change de forme ou
disparaît.

Clé d'identité : `body_key` + `external_id`. `number` seul ne suffit pas — la numérotation
repart par législature dans plusieurs cantons.

### Volumétrie et place sur disque

Ce que pèse la base entière :

| Entité | Enregistrements |
|---|---:|
| Affaires | 323 983 |
| Documents | 904 795 |
| Interventions (`speeches`) | 547 471 |
| Contributions (auteur·e·s) | 1 384 155 |
| **Votes individuels** | **70 667 935** |

Texte des documents, mesuré sur 200 : **médiane 2 639 caractères, moyenne 88 673, maximum
3 173 529**. Déciles : 10 % à zéro · 25 % à zéro · 50 % à 3 k · 75 % à 9 k · 90 % à 31 k.
**27 % des documents ont un texte vide.** Une poignée de monstres — protocoles de séance,
rapports annuels — écrase la moyenne ; la masse des documents est petite.

| | Contenu | Brut | Compressé | Requêtes | Durée à 1 req/s |
|---|---|---:|---:|---:|---|
| 1 | Métadonnées seules, tout le corpus | ~1,5 Go | ~0,4 Go | ~2 000 | 35 min |
| **2** | **Métadonnées + texte des candidats thématiques** | **~3,5 Go** | ~1 Go | ~22 000 | **6 h** |
| 3 | Tout le texte de tous les documents | ~85 Go | ~20 Go | ~905 000 | **10,5 jours** |

**Le scénario 3 est exclu**, et pas pour une raison de disque : dix jours de sollicitation
continue de leur serveur, après leur avoir annoncé moins de 3 000 requêtes par mois. Ce serait
renier le courriel du 18.09.2026.

**Ne pas récolter les votes** : 70 millions d'enregistrements, ~7 Go, aucun usage pour la veille.

#### Pourquoi le scénario 2 tient

Le piège apparent : filtrer sur le texte supposerait de tout télécharger. **Mais leur API fait
la recherche plein texte côté serveur.** On l'interroge avec le lexique, on récupère les
identifiants des candidats, on ne télécharge que ceux-là — ~2,2 % du corpus, soit ~7 000
affaires et ~20 000 documents, ~1,8 Go de texte.

**Marche à suivre :** récolter **toutes les métadonnées** d'abord (1,5 Go, 35 minutes, une fois
pour toutes), puis le texte des seuls candidats. Les métadonnées complètes permettent de
retrier, redater et retyper sans jamais re-solliciter leur serveur.

**La limite à connaître :** déléguer la recherche à leur API signifie qu'un nouveau terme de
lexique exige de les réinterroger — quelques requêtes par terme, donc peu cher, mais impossible
de rejouer un criblage entièrement hors ligne. Cette liberté-là coûterait le scénario 3, donc
leur accord explicite et un étalement sur plusieurs semaines.

⚠ Chiffres fondés sur un échantillon de 200 documents pour une distribution très dispersée :
ordre de grandeur, pas devis.

---

## Ce qui est harmonisé, et ce qui ne l'est pas

### Les types : deux champs, pas un

OpenParlData **ne remplace pas** la nomenclature cantonale, il **ajoute une couche** par-dessus.
Chaque affaire porte les deux :

- `type_name` — le libellé cantonal brut, jamais écrasé
- `type_harmonized_id` + `type_harmonized_wikidata_id` — la catégorie uniformisée, avec ses
  libellés en de / fr / it / rm / en

Rapport de réduction mesuré : **464 libellés cantonaux distincts → 18 types harmonisés.**

| Affaires | Corps | de / fr / it | Wikidata |
|---:|---:|---|---|
| 55 197 | 73 | Anfrage / Question / Interrogazione | Q2052854 |
| 52 971 | 77 | Interpellation / Interpellation / Interpellanza | Q1505023 |
| 37 014 | 83 | Motion / Motion / Mozione | Q1949668 |
| 33 777 | 53 | Regierungsgeschäft / Affaires gouvernementales | — |
| 33 451 | 74 | Postulat / Postulat / Postulato | Q2106323 |
| 18 874 | 13 | Fragestunde / Heure des questions | Q1286157 |
| 8 938 | 44 | Wahl / Élection | Q40231 |
| 5 747 | 32 | Parlamentarische Initiative / Initiative parlementaire | Q2052859 |
| 4 040 | 26 | Bericht / Rapport | — |
| 3 701 | 28 | Vernehmlassung / Consultation | Q1591788 |
| 2 514 | 17 | Informationsdokument / document d'information | — |
| 2 044 | 23 | Petition / Pétition | Q697279 |
| 1 914 | 31 | Volksinitiative / initiative populaire | Q335918 |
| 1 430 | 13 | Diverses / Divers | — |
| 1 251 | 20 | Parlamentarischer Genehmigungsbeschluss | — |
| 229 | 6 | Einbürgerung / Naturalisation | — |
| 171 | 4 | Ergänzungsantrag / Amendement | — |
| **60 720** | 72 | **(aucun type harmonisé)** | — |

**Confronté à notre typologie maison**, sept catégories sur huit tombent juste : Motion,
Postulat, Interpellation, Anfrage, Fragestunde, Initiative parlementaire, Pétition.

⚠ **La huitième, non.** `Standesinitiative` existe comme libellé brut (702 affaires, niveau
fédéral, libellée « Initiative déposée par un canton » / « Iniziativa cantonale ») mais son
**`type_harmonized_id` vaut NULL** — vérifié. Un tri sur le seul type harmonisé **ferait
disparaître silencieusement les initiatives cantonales** de la liste. Prévoir une règle sur
`type_name` pour les rattraper.

**Les libellés bruts cantonaux sont souvent monolingues.** Au fédéral on reçoit `{de, fr, it}`,
mais Bâle-Ville ne rend que `{"de":"Petition"}`. **Pour publier en français, c'est la couche
harmonisée qui fournit le libellé** : s'appuyer sur elle en premier et sur `type_name` en
secours, jamais l'inverse.

### Où tombent les 18,7 % non harmonisés

Le chiffre global est trompeur : le déficit n'est pas réparti, il est **concentré**.

| Corps | Total | Sans type harmonisé | % |
|---|---:|---:|---:|
| **GE** | 18 731 | **18 243** | **97,4 %** |
| UR | 1 322 | 569 | 43,0 % |
| BS | 21 597 | 8 771 | 40,6 % |
| NE | 4 530 | 1 598 | 35,3 % |
| TI | 19 646 | 6 232 | 31,7 % |
| VD | 8 159 | 2 352 | 28,8 % |
| FR | 5 310 | 1 416 | 26,7 % |
| SZ · SH · SO · VS · LU | — | 320 à 1 236 chacun | 14 à 17 % |
| TG · JU | — | 230 · 597 | 8 % |
| CHE | 68 930 | 1 744 | 2,5 % |
| BE · BL · AG · SG · AI · ZH · GR | — | 1 à 89 chacun | ≤ 1,1 % |
| **ZG · OW · NW · GL · AR** | — | **0** | **0,0 %** |

**Genève représente à elle seule 30 % de tout le déficit.**

### Genève : le type n'est pas perdu, il est dans le numéro

Les affaires genevoises sans libellé portent leur type **en préfixe du champ `number`**. Mesuré
sur 776 affaires historiques, **aucune sans préfixe** : `PL` 200, `E` 153, `M` 100, `QUE` 98,
`RD` 75, `IUE` 46, `P` 39, `Q` 30, `R` 24, `IN` 5, `GR` 5, `I` 1. C'est la typologie officielle
du Grand Conseil genevois (14 valeurs : IN, PL, M, R, PO, Q, QUE, P, RD, GR, IU, IUE, E, C).

**Une table de correspondance de quatorze lignes récupère 30 % du déficit total.** Ce n'est pas
de la donnée manquante, c'est de la donnée non extraite par leur pipeline.

### BS et TI : hors périmètre plutôt que déficients

Leur masse non harmonisée est faite de `Regierungsratsbeschluss` (8 874 à Bâle) et de `Messaggio`
(5 863 au Tessin) — **des décisions et messages du gouvernement, pas des interventions
parlementaires**. Hors de notre périmètre de toute façon.

Reste, après ces trois cas, environ 6 000 affaires sur 324 000 réellement problématiques
(UR, NE, VD, FR).

### Les types retenus pour la veille CSPS

#### ⚠ Comment mesurer la pertinence d'un type — et l'erreur à ne pas refaire

Première mesure, fausse : la « densité thématique » en plein texte (`search_scope=all`). Elle
donnait `Bericht` 9,5 % et `Vernehmlassung` 9,3 %, donc deux types jumeaux. **Cette mesure
compte la longueur des documents autant que leur pertinence** : un rapport annuel de 300 pages
mentionne la pédagogie spécialisée parce qu'il mentionne tout.

Le bon indicateur est le **ratio entre une occurrence dans le titre et une dans le texte
entier**. Mesuré sur « Sonderpädagogik » :

| Type | Titre seul | Texte entier | Ratio |
|---|---:|---:|---:|
| Bericht / Rapport | 1 | 176 | **176×** |
| Regierungsgeschäft | 10 | 763 | **76×** |
| Motion | 3 | 148 | 49× |
| Interpellation | 6 | 182 | 30× |
| Postulat | 5 | 101 | 20× |
| Anfrage | 13 | 212 | 16× |
| **Vernehmlassung** | 8 | 77 | **10×** |

Ratio élevé = le mot apparaît en passant. Les deux types que la densité brute rendait jumeaux
sont en réalité aux deux extrêmes : `Vernehmlassung` a le meilleur rapport signal/bruit de tout
le corpus (une consultation porte sur un objet unique et court), `Bericht` le pire.

#### A — Publiés (11 types)

| id | Type | Origine | Corpus | Thém. | Ratio |
|---:|---|---|---:|---:|---:|
| 8 | **Interpellationen** | député·e | 52 971 | 849 | 30× |
| 12 | **Anfragen** | député·e | 55 197 | 802 | 16× |
| 3 | **Postulate** | député·e | 33 451 | 763 | 20× |
| 2 | **Motionen** | député·e | 37 014 | 656 | 49× |
| 10 | **Fragestunde** | député·e | 18 874 | 354 | — |
| 4 | **Parlamentarische Initiativen** | député·e | 5 747 | 72 | — |
| 11 | **Petitionen** | société civile | 2 044 | 43 | — |
| — | **Standesinitiativen** (via `type_name`, harmonisé NULL) | canton | 702 | — | — |
| 5 | Vernehmlassung / Consultation | gouvernement | 3 701 | 343 | **10×** |
| 9 | Regierungsgeschäft ⚠ règle ci-dessous | gouvernement | 33 777 | 2 050 | 76× |
| 17 | Genehmigungsbeschluss / Décision d'approbation | parlement | 1 251 | 12 | — |

**En gras : les huit types déjà publiés par la Zeitschrift, tous conservés.** Trois ajouts
seulement — consultation, affaires gouvernementales, décision d'approbation.

⚠ **Règle de second niveau sur `Regierungsgeschäft`**, indispensable : sans elle les budgets et
rapports de gestion noient le reste. Filtrer sur le `type_name` brut —

- **garder** : `Gesetz`, `Gesetzgebungsgeschäft`, `Botschaften`, `Vorlage`, `Bericht und Antrag`,
  `Weisung` — c'est là que vivent les lois scolaires et les messages du gouvernement
- **jeter** : `Jahresrechnung`, `Geschäftsbericht`, `Globalbudget`, `Kreditgeschäft`,
  `Sachgeschäft`

Ce que contient un `Regierungsgeschäft`, mesuré sur 200 affaires récentes : `Regierungsratsbeschluss`
65, `Vorlage` 22, `Kreditgeschäft` 18, `Bericht und Antrag` 15, `Geschäft des Bundesrates` 15,
`Weisung` 14, `Sachgeschäft` 9, `Antrag` 6, `Verwaltungsgeschäft` 4, `Gesetz` 3, `Botschaften` 2.
C'est l'ordre du jour du gouvernement, par opposition aux interventions des député·e·s.

#### B — Récoltés mais non publiés (3 types)

| id | Type | Corpus | Thém. | Motif |
|---:|---|---:|---:|---|
| 16 | Bericht / Rapport | 4 040 | 385 | ratio 176×, signal trop dilué |
| 7 | Volksinitiative / Initiative populaire | 1 914 | 33 | visibles par d'autres canaux |
| 1 | Diverses / Divers | 1 430 | 8 | fourre-tout : ne pas jeter sans regarder |

#### C — Écartés (4 types)

| id | Type | Corpus | Thém. |
|---:|---|---:|---:|
| 6 | Wahl / Élection | 8 938 | 28 |
| 15 | Informationsdokument | 2 514 | 56 |
| 14 | Einbürgerung / Naturalisation | 229 | 0 |
| 13 | Ergänzungsantrag / Amendement | 171 | 6 |

`Ergänzungsantrag` est écarté malgré une densité apparente de 3,5 % : c'est un fragment
procédural rattaché à un objet parent, capté par ailleurs.

#### Bilan

- corpus récolté : **252 113 affaires**, soit 77,8 %
- signal thématique capté : **6 370 / 7 034**, soit **90,6 %**
- signal publié : 5 944, soit 84,5 %
- perdu par les quatre types écartés : 90 affaires, soit **1,3 %**

**Mise en perspective :** les 574 affaires thématiques **non typées** — l'essentiel genevois —
pèsent 8 %, soit six fois plus que tout ce qu'on écarte volontairement. La table des préfixes
genevois ci-dessous vaut donc davantage que tous les arbitrages de type réunis.

⚠ **Ne pas filtrer par type avant le filtre thématique.** Le type sert à présenter et à écarter
du bruit, pas à découvrir.

### Genève : correspondance des préfixes

Pour les 18 243 affaires genevoises sans type harmonisé, le préfixe du champ `number` donne
le type. Correspondance à établir (les trois dernières restent à vérifier) :

| Préfixe | Genève | → type harmonisé |
|---|---|---|
| `M` | Motion | Motion (2) |
| `PO` | Postulat | Postulat (3) |
| `IU` / `IUE` | Interpellation (urgente écrite) | Interpellation (8) |
| `Q` / `QUE` | Question (écrite urgente) | Anfrage / Question (12) |
| `PL` | Projet de loi | Regierungsgeschäft (9) |
| `RD` | Rapport divers | Bericht / Rapport (16) |
| `P` | Pétition | Petition (11) |
| `IN` | Initiative | Volksinitiative (7) |
| `R` | Résolution | à vérifier |
| `E` | Élection | Wahl (6) — écarté |
| `GR` | Grâce | écarté |
| `C` | ? | **à identifier** |

**Les états : pas harmonisés du tout.** 323 706 affaires sur 323 983 sans état harmonisé.
Le suivi d'avancement — déposé, renvoyé, accepté, classé — **reste à construire nous-mêmes**,
canton par canton, à partir de `state_external_id` / `state_name`. C'est la couture la plus
coûteuse du projet. À décider : est-ce qu'une liste de publication a vraiment besoin du
statut, ou le type et la date suffisent-ils pour un premier jet ?

---

## Couverture du texte intégral — inégale, mesurée

Sur les 12 affaires les plus récentes de chaque canton :

| Couverture | Cantons |
|---|---|
| 12/12 | BS, TI, ZH, JU, SG, FR, NE, ZG, UR, AR, AI |
| 8–11/12 | BE, SO, GR, GL, AG, SZ, OW |
| 6–7/12 | VS, SH |
| 0–2/12 | VD, LU, NW, TG, GE, BL |

**Distinction faite, elle est décisive :** LU, BL, NW et TG remontent à 11–12/12 sur les
affaires plus anciennes — c'est un **retard d'ingestion de quelques mois**, pas une absence.
**Vaud est le seul trou structurel** : 0/12 en récent, 3/12 encore en 2020, ce qui colle au
terrain (VD n'a pas de base d'objets, seulement des listes statiques et des PDF nommés par
convention). SH plafonne à 6–7/12 partout, même cause.

**Conséquence pour la veille :** la liste mensuelle sera en léger différé sur six cantons.
Soit on l'assume et on republie les rattrapages le mois suivant, soit on récolte Vaud à
part. À trancher.

### Profondeur et fraîcheur par canton

BS 21 597 (dès 1973) · TI 19 646 (1985) · ZH 19 313 (1987) · GE 18 731 (2000) ·
VS 8 683 (2003) · BE 8 185 (2006) · VD 8 159 (1950) · JU 7 648 (1979) · SG 6 908 (1993) ·
BL 6 527 (1983) · AG 5 629 (2009) · FR 5 310 (2005) · SO 4 962 (2007) · NE 4 530 (2007) ·
LU 3 835 · TG 2 689 (2008) · SZ 2 510 (2007) · SH 2 000 (2004) · GR 1 885 (1995) ·
ZG 1 799 (2015) · UR 1 322 (2008) · OW 1 285 (2010) · NW 1 276 (2010) · GL 1 008 (2001) ·
AR 725 (2000) · AI 366 (2016)

Vingt cantons avaient des affaires de la semaine au moment de la mesure. Taux de dates
manquantes mesuré sur sept cantons : entre 0,0 % et 0,2 %.

---

## Le filtre thématique — c'est là qu'est le travail

### Étage 1 — criblage lexical large

Amorce déjà disponible : le thésaurus edudoc moissonné par
`vscodium-extension/szh-cockpit/lib/mots-cles-edudoc.js`, caché dans
`C:\ProgramData\SZH\mots-cles.json` — **922 paires de descripteurs DE/FR**, 917 complètes.
Confronté au champ : 17 descripteurs handicap, 58 école, 104 formation, 6 intégration.

Rendements mesurés (`search_scope=all`, tous corps) : Behinderung 7 034 · droit de vote
6 143 · intégration 5 675 · handicap 4 164 · Sonderschulung 2 744 · Sonderpädagogik 2 065 ·
école spécialisée 1 680 · Inklusion 1 448 · Beistandschaft 1 051 · pédagogie spécialisée
675 · Autismus 595 · Nachteilsausgleich 275 · Blindheit 66.

**Trois trous nommés, à combler à la main :**

1. **Aucun terme de droits civiques.** `Stimmrecht`, `droit de vote`, `suffrage`,
   `curatelle`, `capacité de discernement` → **zéro descripteur edudoc**. C'est un
   vocabulaire pédagogique, pas juridique. Or c'est un de nos thèmes.
2. **Aucun italien.** edudoc est bilingue DE/FR. Le Tessin est le **deuxième** corps
   cantonal du corpus (19 646 affaires) et resterait un angle mort. `disabilità` ne rend
   que 375 contre 7 034 pour `Behinderung`.
3. **`Integration` est un faux ami.** En langue politique suisse il désigne
   l'intégration des migrants neuf fois sur dix — 19 283 occurrences allemandes qui
   noieraient le signal. Préférer `Inklusion` (1 448) et `schulische Integration`.

### Étage 2 — classification des candidats

Le criblage lexical seul sera inutilisable en précision. Classer les candidats retenus
(LLM ou classifieur entraîné) dans la taxonomie CSPS. Trop coûteux à l'échelle du corpus
entier, d'où les deux étages.

### Mesure de qualité — non négociable

**200 à 300 objets annotés à la main**, pour connaître la précision et le rappel. Sans ce
jeu de référence on ne saura jamais ce que le filtre rate en silence, et c'est exactement
le genre de projet où un filtre trop strict passe pour un filtre qui marche.

---

## Pièges mesurés

### 1. Les paramètres inconnus sont silencieusement ignorés

Vérifié : `?parametre_invente_xyz=42` rend **200 et le total complet** (323 983). De même
`updated_at__gte=2026-09-01` → 323 983, c'est-à-dire **aucun filtrage**, sans la moindre
erreur. En revanche un paramètre connu avec une valeur invalide se comporte bien
(`body_key=XX` → 0).

**Règle :** un filtre n'est réputé appliqué que s'il **change le compte**. Vérifier chaque
paramètre contre un total connu avant de s'en servir en production.

### 2. `search_scope=docs` retombe sur `title_long`

Quand un canton n'a pas de documents ingérés, une recherche `scope=docs` rend quand même
des résultats — en appariant le titre long, pas un corps de document. Le total donne alors
une **fausse impression de couverture**. Vérifier objet par objet via `/docs`, jamais se
fier au `total_records` d'une recherche seule.

### 3. L'UTF-8 mutilé en ligne de commande

Sous Git Bash, `curl --data-urlencode` a rendu `Sonderpädagogik` → 8 résultats au lieu de
2 065, et `pédagogie spécialisée` → 0 au lieu de 675. **Aucune erreur levée** : ça rend
presque zéro, silencieusement. Encoder explicitement (`encodeURIComponent` côté Node).

Contrôle à garder dans les tests : un terme accentué doit rendre **plus** qu'un terme
non accentué équivalent.

### 4. `exclude_null` ne voit pas les objets vides, et `search` est ignoré sur `group_by`

Deux variantes du piège n° 1, rencontrées pour de vrai :

- `?body_key=GE&exclude_null=type_name` rend **18 731 sur 18 731**, donc « tout va bien » — alors
  que 17 745 de ces affaires ont un `type_name` valant **`{}`**, un objet vide. Le filtre teste
  la nullité, pas la vacuité. Tester `Object.keys(x).length === 0`, jamais `x == null` seul.
- `group_by/types_harmonized?search=…` **ignore le paramètre `search`** : le total revient à
  323 983, identique à la requête sans recherche. Le croisement type × thème doit passer par
  `/affairs/?type_harmonized_id=<n>&search=…`, où le filtre est bien appliqué (vérifié).

**Règle générale** : cette API rend volontiers un résultat rassurant et faux, par des chemins
différents. Ne jamais accepter un compte qui confirme ce qu'on espère sans l'avoir croisé avec
une autre mesure.

### 5. Récence contre absence structurelle

Un zéro mesuré n'est pas un zéro réel tant qu'on n'a pas éliminé l'effet de récence.
Une conclusion « les motions de NW n'ont structurellement pas de texte » s'est révélée
fausse : hors de la fenêtre de retard, Motion 8/8 et Postulat 8/8. **Toujours contrôler
récence ET type d'objet avant de conclure à un trou.**

---

## Statut juridique

Le `robots.txt` de `api.openparldata.ch` porte :

```
# Block all API data endpoints (not for SEO)
Disallow: /v1/
```

Ce n'est ni une serrure (l'API répond 200 sans authentification), ni un contrat
(vérifié : `/terms`, `/nutzungsbedingungen`, `/impressum`, `/legal` rendent tous le même
fichier de 5 138 octets que la page d'accueil — ce sont des replis d'application monopage,
**ces pages n'existent pas**), ni une loi. La seule déclaration écrite sur la réutilisation
dit l'inverse : CC BY 4.0, dans leur propre spec OpenAPI.

Le commentaire `(not for SEO)` indique une mesure d'hygiène de référencement. Pas de
protection d'accès contournée, donc art. 143bis CP hors de cause ; les documents
sous-jacents sont des actes officiels d'autorités publiques, exclus de la protection par
l'art. 5 LDA. Le risque est opérationnel et relationnel, pas pénal.

**Courriel envoyé le 18.09.2026. Attendre la réponse avant toute mise en production.**

Autres contraintes relevées ailleurs : `gr.be.ch` impose `Crawl-delay: 10` ; le
`robots.txt` du Tessin interdit explicitement sa recherche d'atti et le téléchargement de
ses PDF.

---

## Sources directes, en secours

Si OpenParlData change de forme, tombe, ou refuse :

- **Confédération** — `ws.parlament.ch/odata.svc` (Curia Vista, OData v2, 44 entités,
  `$format=json`, de/fr/it/en). L'entité `Transcript` porte le texte intégral. Vérifié 200.
- **Opendatasoft cantonaux**, tous CC BY, JSON et export en masse :
  BS `data.bs.ch` datasets 100086 / 100311 / 100313 / 100314 · BL `data.bl.ch` 13090 /
  13120 / 13130 · SG `daten.sg.ch` `geschafte-im-kantonsrat-st-gallen` ·
  TG `data.tg.ch` `sk-stat-75`
- **Berne** — JSON brut sur `ogd.parl.apps.be.ch`
- **Zurich, API CMI directe**, avec texte intégral dans la réponse XML :
  ```
  parlzhcdws.cmicloud.ch/parlzh5/cdws/Index/GESCHAEFT/searchdetails
    ?q=krnr any * sortBy beginn_start/sort.descending&l=de-CH&s=1&m=1
  → 200, numHits="18972", balise <Fulltext> en ligne
  ```

**CMI couvre 22 cantons sur 26.** Le protocole CQL transfère : AR (`ar.ch/api/cdws`) et GR
(`cdws-staka-gr.gr.ch/cdws`) **parsent** la requête ci-dessus mais la rejettent sur
`unknown Field 'krnr'`. Seuls les noms de champs sont propres à chaque canton, à lire dans
le JS du frontend. Travail borné, pas un mur.

Cas fermés à la source : Jura (aucune base par objet, compilations PDF par plage),
Schaffhouse (pages annuelles rendues en JS), Vaud (listes statiques).

---

## À faire

- [ ] Attendre la réponse d'OpenParlData sur le `robots.txt` — **bloquant**
- [ ] Décider où vit le projet : dans ce dépôt, ou dans un dépôt séparé ?
- [ ] Lexicaliser les droits civiques (droit de vote, curatelle, capacité de discernement,
      accessibilité, autodétermination) — absent du thésaurus edudoc
- [ ] Construire un lexique italien pour le Tessin, 2ᵉ corps cantonal du corpus
- [ ] Écarter ou qualifier `Integration` / `intégration` dans le criblage
- [ ] Prototyper l'étage 1 sur un mois de données, sans rien stocker
- [ ] Annoter 200–300 objets à la main pour mesurer précision et rappel
- [ ] Rattraper les `Standesinitiative` par une règle sur `type_name` — leur type harmonisé
      est NULL, un tri sur le seul type harmonisé les perdrait en silence
- [ ] Écrire la table de correspondance des préfixes genevois (14 lignes) — récupère à elle
      seule 30 % du déficit de typage ; identifier ce que vaut le préfixe `C`
- [ ] Trancher le sort de `Fragestunde` (18 874 affaires, 354 thématiques, mais des questions
      orales d'une ligne), `Informationsdokument` et `Diverses`
- [ ] Trancher : construit-on la table d'états par canton, ou s'en passe-t-on ?
- [ ] Trancher : que fait-on de Vaud, et du différé sur LU / BL / NW / TG / GE ?
- [ ] Définir le gabarit de la liste mensuelle et de la synthèse trimestrielle
      (réutiliser `lib/gabarits.js` plutôt qu'un moteur de plus)
- [ ] Vérifier que chaque publication porte « Source : OpenParlData.ch »

## Questions ouvertes

- La veille couvre-t-elle aussi les **villes** (une cinquantaine dans le corpus, dont
  Genève 9 580 et Zurich 9 573) ou seulement cantons et Confédération ?
- La synthèse trimestrielle est-elle une simple agrégation des trois listes mensuelles,
  ou un texte rédigé par-dessus ?
- Faut-il conserver les PDF localement, ou se contenter des liens `url_oparl` ?
- Quelle profondeur au chargement initial : tout l'historique (323 983 affaires), ou les
  cinq dernières années ?
