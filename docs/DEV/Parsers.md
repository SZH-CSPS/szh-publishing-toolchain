# Parseurs du moissonneur de recherches

État au 02.10.2026. Le moissonneur vit dans le dépôt frère
`C:\Users\robin\Documents\Prog\szh-harvest-research\` : Python, bibliothèque standard seulement,
rien de commité. Son mode d'emploi est dans `LISEZMOI.md` et son contrat interne dans
`CONTRAT.md`, tous deux dans ce dépôt frère. Les points ouverts sont dans
[../TODO/news-und-actu.md](../TODO/news-und-actu.md).

Il lit trois sources (le FNS, la SKBF et les sites des hautes écoles) et écrit des fiches
« Recherches en cours » (`forschung\<slug>\recherche.<lang>.txt`) au format de Pronto.

## Vue d'ensemble : qui fait quoi

```
 sources/snf.py ─┐
 sources/skbf.py ├─► Projet (modele.py) ─► cli.py moissonner ─► filtre.py ─► db.py (SQLite)
 sources/sites.py┘        │                                                     │
   (_commun.py)           │                cli.py amorcer ◄── kirby.py (lecture) ◄── Fiches\forschung\
                          │                cli.py exporter ──► kirby.py (écriture) ──► sortie\forschung\
```

| Fichier | Rôle |
|---|---|
| `harvest/modele.py` | la forme commune, `Projet` : ce que toute source rend |
| `harvest/sources/*.py` | les **parseurs** : chacun lit une source et rend des `Projet` |
| `harvest/sources/_commun.py` | outils HTML partagés par skbf.py et sites.py |
| `harvest/filtre.py` | décide si un projet est pertinent |
| `harvest/db.py` | base SQLite, normalisation des titres et des liens, rapprochement |
| `harvest/kirby.py` | **lecture et écriture du format de fiche** Pronto, et rien d'autre |
| `harvest/cli.py` | **la colle** : orchestre sources, filtre, base et fiches |
| `harvest/reseau.py` | requêtes polies : robots.txt, délai, cache, reprise sur 429 |

## La colle entre les parseurs et les fiches réelles : c'est `cli.py`, pas `kirby.py`

`kirby.py` ne connaît ni les sources, ni la base, ni le filtre. Il fait trois choses :
1. **lire** un fichier de fiche (`lire_txt`), et lister les fiches existantes d'une bibliothèque
   (`fiches_existantes`) ;
2. **écrire** une fiche neuve (`ecrire_fiche`, `ecrire_txt`), sans jamais écraser ;
3. **reproduire les règles de Pronto** : slug borné à 48 caractères, suffixe `-2`, `-3` en cas de
   collision, Uuid de 16 caractères [A-Za-z0-9], `Ausgabe:` toujours écrit même vide, ordre
   des champs du contrat, dates invalides vidées.

C'est une réécriture en Python de `lireTxt`, `ecrireTxt` et `slugFicheUnique` de
`lib/kirby-contenu.js`. L'ordre des champs y est **copié en dur** : `CHAMPS = ['institutions',
'debut', 'fin', 'lien', 'lien_libelle', 'descriptif']`. Il n'est pas lu dans
`pipeline/kirby/champs-documentation.json` : si le contrat du type `recherche` change, il faut
corriger ce fichier à la main.

La colle, c'est `cli.py`, en trois commandes :
- **`moissonner`** appelle chaque source, passe chaque `Projet` à `filtre.py`, pose le statut
  (`nouveau`, `hors-sujet`, `termine` si la date de fin est passée), puis l'enregistre par
  `db.py`.
- **`amorcer`** lit la bibliothèque réelle par `kirby.fiches_existantes()` et cherche chaque
  projet `nouveau` parmi les fiches : d'abord par le lien (normalisé), puis par le titre
  (`db.rapprocher_titres`). Un rapprochement sûr passe le projet en `existant` ; un rapprochement
  probable est seulement affiché.
- **`exporter`** regroupe les projets de même titre normalisé et revérifie la bibliothèque. Il
  fusionne ensuite les sources : la page de l'école est préférée au FNS, et les champs vides se
  complètent. Il appelle enfin `kirby.ecrire_fiche()`.

## Ce qu'un parseur rend : `Projet`

| Champ | Contenu | Devient dans la fiche |
|---|---|---|
| `source` | `snf`, `skbf`, `site:hfh`… | — |
| `source_id` | identifiant stable : n° de subside, n° SKBF, URL | — |
| `url` | page publique du projet | `Lien` |
| `title` | titre | `Title` |
| `langue` | `de`, `fr`, `en` ou vide | langue du fichier (`de` par défaut si `en` ou vide) |
| `institutions` | « A, B, C » | `Institutions` |
| `debut`, `fin` | `AAAA`, `AAAA-MM` ou `AAAA-MM-JJ` | `Debut`, `Fin` (vidés s'ils ne respectent pas ce format) |
| `descriptif` | texte brut, paragraphes séparés par une ligne vide | `Descriptif` |
| `date_source` | dernière modification connue côté source | — |
| `extra` | tout le reste, dont `manques` : ce que le parseur n'a pas trouvé | — |

Règle commune : un parseur rend tout ce qu'il voit de neuf, pertinent ou non. C'est `cli.py`
qui filtre. Un parseur ne retélécharge jamais un élément déjà en base (`connus`).

## 1. Fonds national suisse : `sources/snf.py`

**Entrée.** L'export ouvert `grants_with_abstracts.csv` (≈430 Mo, séparateur `;`, UTF-8 avec
BOM). Il contient les colonnes de `grants.csv` et les résumés (`Abstract`, `LaySummary_De/En/Fr/It`).
Le robots.txt de data.snf.ch interdit tout robot : le fichier se télécharge à la main, et
`fichier_local` (config.toml) en donne le chemin.

**Fonctionnement.**
1. Le fichier est lu ligne à ligne, jamais chargé en entier en mémoire.
2. Une ligne qui commence avant `depuis` (2024-01-01) est sautée.
3. Champs :
   - titre : `Title` ;
   - institution : `ResearchInstitution`, sans le sigle final (« … – PHZH ») ;
   - dates : `EffectiveGrantStartDate` et `EffectiveGrantEndDate` ;
   - lien : `https://data.snf.ch/grants/grant/<n°>`.
4. Langue devinée sur le titre par des mots vides (de, fr, it). Elle vaut `en` quand
   `TitleEnglish` est identique au titre **ou vide** : un titre allemand sans traduction
   anglaise (SWING) passe donc pour anglais.
5. Descriptif : le résumé vulgarisé dans la langue du titre, sinon de, en, fr, it, sinon le
   résumé scientifique. Les paragraphes que le FNS colle (« verbessern.Die ») sont rouverts.
6. Pré-filtre, vu le volume : le résumé n'est lu que si le domaine principal est dans
   `disciplines` (éducation, psychologie, sociologie, travail social), ou si
   `AllDisciplines` contient un code `105` (sciences de l'éducation). Ailleurs, seul le titre
   compte, et seulement pour les mots sûrs.

**Limites.** Le FNS ne nomme que l'institution requérante : Tea2C y est porté par la PH Luzern.
La langue devinée se trompe quand `TitleEnglish` est vide (voir point 4). La fiche sort quand
même dans la langue par défaut, `de`, et le résumé allemand est souvent choisi faute de résumé
anglais.

## 2. Base SKBF-CSRE : `sources/skbf.py`

**Entrée.** Les pages HTML de skbf-csre.ch : une liste de résultats, puis une page de détail
par projet.

**Fonctionnement.**
1. **Liste.**
   - La recherche du site est un OU de mots. Le parseur y envoie tous les mots du filtre et les
     institutions toujours retenues : 103 mots.
   - Les résultats sont triés par numéro décroissant. Le paramètre `limit` est un décalage, pas
     une taille de page : 25 résultats par page.
   - Chaque ligne « `25:084` | titre | lien `_id` » est lue par une expression régulière.
2. **Arrêt.** Dès qu'un numéro a une année plus ancienne que `depuis` (`23:…` < 2024).
   Garde-fou : 80 pages au maximum.
3. **Détail.**
   - Les commentaires HTML sont retirés d'abord : ils contiennent des lignes en double.
   - La page est découpée sur ses titres `<h2>`, les seuls repères fiables : les `<table>`
     mélangent parfois deux sections.
   - On en tire :
     - le titre ;
     - les institutions (les liens de la section « Forschende Institution(en) ») ;
     - les dates (« Beginn / Début », « Ende / Fin ») ;
     - le résumé (« Zusammenfassung »).
4. **Lien.** Si le résumé pointe vers la page du projet sur le site d'une école, ce lien
   devient `url` ; le lien SKBF passe dans `extra`.
5. **Langue.** Laissée vide : la page est bilingue, et la langue d'origine ne se devine pas.

**Limites.**
- La SKBF enregistre des années après le début du projet : sur 40 projets pertinents, 39
  étaient terminés.
- 309 pages lues pour une moisson complète, en 9 minutes environ.

## 3. Hautes écoles : `sources/sites.py`

Un descripteur par école, dans la table `SITES` :
- `decouverte` : `sitemap` ou `cascade_html` ;
- `sitemap_url` ;
- `motif_url` : l'expression régulière qui reconnaît une page projet ;
- `analyser` : la fonction qui lit une page ;
- `actif`, et pour une école désactivée, la `raison` mesurée.

### Découverte des pages

- **Plan du site** (HfH, PHBern, PHSG, EHB, PH FHNW) :
  - `sitemap.xml` est lu ; s'il renvoie à d'autres plans (index), le parseur les suit ;
  - seules les URL qui correspondent à `motif_url` sont gardées ;
  - une page dont la date de modification (`lastmod`) précède `depuis` n'est pas téléchargée ;
  - une page sans date est gardée.
- **Cascade HTML** (HEP Vaud) : page « projets et expertises », puis une page par unité de
  recherche, puis une page par projet. Rien n'y est daté : `depuis` ne s'applique pas.

### Analyse d'une page

Toutes les analyses lisent le titre dans `<h1>` et la langue dans `<html lang>`. Elles
remplissent `manques` avec ce qu'elles n'ont pas trouvé.

| École | Dates | Institutions | Descriptif |
|---|---|---|---|
| HfH | champs `field-start-date` / `field-end-date` (« 11.2024 » → `2024-11`) | HfH + partenaires du bloc `cooperations` | bloc `field-lead-paragraph`. Une page réservée aux personnes connectées est repérée (titre « Anmelden ») et rendue vide |
| PHBern | `<time datetime>` du champ « Laufzeit » | PHBern + institutions du champ « Kooperationen » (affiliations brutes, terrains compris) | bloc d'accroche `text-large` |
| PHSG | champ « Laufzeit » (« 2025 bis 2029 », « 03.2025 bis … ») | PHSG seule | premier bloc `field--name-field-text` de plus de 150 caractères, sans le titre ni la légende d'image répétés |
| EHB | deux `<time datetime>` du champ « Datum », par deux motifs distincts | EHB seule | bloc `field-project-description` |
| PH FHNW | champ « Laufzeit » : « 2021 – 2024 » ou « 1. Juli 2021 – 30. Juni 2024 » (mois allemands) | PH FHNW + champ « Partner » | premier paragraphe de `page__section-content` |
| HEP Vaud | aucune sur ce gabarit | HEP Vaud seule | accroche `standard-text-lead` + blocs `prose` |
| PHZH (désactivée) | « Steckbrief » de la page | écrit et testé | écrit et testé ; seule la découverte manque |

Les blocs imbriqués se lisent par `capturer_div` (`_commun.py`), qui suit les `<div>`
ouvrants et fermants jusqu'à la fermeture équilibrée. Une simple expression régulière
s'arrêterait au premier `</div>` imbriqué.

### Écoles désactivées (raison mesurée le 24.09.2026)

| École | Raison |
|---|---|
| PHZH | liste générée en JavaScript (SignalR), aucun paramètre GET, pas de plan du site des projets |
| PHLU | liste alimentée par une base Firebase qui répond 401 sans jeton |
| HEP-BEJUNE | recherche publiée par personne, aucune page projet dans le plan du site |
| HEP Fribourg | certificat TLS invalide, puis 503 |

### Défauts connus

- **PH FHNW** : quand la durée a une autre forme (« September 2024 – … », « 1.4.2020 – … »), le
  texte brut part tel quel dans `debut`. `kirby.ecrire_fiche` le vide à l'écriture, la fiche
  sort donc sans date. À corriger dans `_analyser_phfhnw`.
- **PHSG et HEP Vaud** : dates souvent vides.
- **PHBern** : 558 pages sur 567 sont datées d'après 2024, donc `depuis` ne filtre presque rien.
  La première moisson dure 29 minutes à 3 s par page.

## 4. Fiches existantes : `kirby.py`, en lecture

`lire_txt(texte)` découpe un fichier sur les séparateurs `\n\n----\n\n`. Chaque morceau
« `Nom: valeur` » donne un champ, avec sa clé en minuscules. Une valeur de plusieurs lignes
commence à la ligne qui suit « `Nom:` » vide, et une ligne « `\----` » rend un `----` littéral.

`fiches_existantes(racine)` parcourt `<racine>\forschung\<slug>\recherche.<lang>.txt` et rend
`(slug, langue, champs)` pour chaque fichier. Le moissonneur ne lit que le dossier `forschung\` ;
les autres types ne le concernent pas.

## 5. Le rapprochement, dans `db.py`

- **`normaliser_url`** : retire le schéma, `www.`, la requête, l'ancre et la barre finale.
- **`normaliser_cle`** : met le titre en minuscules, retire les accents, et remplace toute
  ponctuation par une espace.
- **`rapprocher_titres(a, b)`** rend :

  | Verdict | Condition |
  |---|---|
  | `sur` | titres normalisés identiques |
  | `sur` | l'un contient l'autre, chacun ayant au moins 8 caractères |
  | `sur` | au moins 70 % des mots du plus court sont aussi dans l'autre |
  | `probable` | de 40 à 70 % des mots en commun |
  | aucun | sinon, ou si l'un des titres n'a qu'un mot |

Mesure du 24.09.2026 : 9 rapprochements sûrs, tous justes, ont reconnu 7 des 9 fiches de 2025.
Les 4 probables étaient tous faux et n'ont pas été promus.

**Écart connu.** `amorcer` compare par ressemblance des titres, mais `exporter` ne regroupe les
sources que sur un titre normalisé **identique**. Un même projet vu par le FNS et par son école
sous deux titres différents sort donc en deux fiches. SWING et FluSS sont dans ce cas dans la
liste du 24.09.2026. Le correctif consiste à regrouper dans `exporter` avec
`rapprocher_titres(...) == 'sur'`.

## Tests

`python -m unittest discover -s tests` dans le dépôt frère : 39 tests hors réseau, verts au
24.09.2026.
- Les parseurs SKBF et hautes écoles sont éprouvés sur des pages réelles enregistrées dans
  `tests/fixtures/`.
- `kirby.py` est éprouvé par un aller-retour écriture-lecture.
- `cli.py` est éprouvé sur une bibliothèque factice : idempotence, fusion de deux sources,
  `amorcer`, jamais d'écrasement.
