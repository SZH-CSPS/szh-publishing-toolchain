# Corpus de composition

Huit articles publiés (quatre de la Revue, quatre de la Zeitschrift), importés par la chaîne
de Pronto. Ils servent à mesurer la composition sur du texte long : césures, suites de
lignes coupées, blancs de justification, pagination.

On s'en sert quand on change de version de WeasyPrint ou de pandoc, ou un réglage de
`pipeline/styles/print.css` : on recompile, on mesure, on compare à la référence.

## Recompiler et mesurer

1. Dans la WSL `SZH-Publishing`, compiler chaque numéro :

   ```bash
   cd test/composition/revue       && make -f ../../../pipeline/Makefile all
   cd test/composition/zeitschrift && make -f ../../../pipeline/Makefile all
   ```

2. Depuis la racine du dépôt, mesurer et comparer :

   ```bash
   /opt/weasyprint/bin/python test/composition-check.py \
     test/composition/revue test/composition/zeitschrift \
     --reference test/composition/reference.json
   ```

   Le script nomme chaque écart et sort en code 1 s'il y en a.

3. Après un changement voulu, réécrire la référence avec `--json test/composition/reference.json`,
   et dire pourquoi dans le message de commit.

[`reference.json`](reference.json) correspond à pandoc 3.7.0.2, WeasyPrint 70.0 et
`hyphenate-limit-zone: 10%` (`print.css`).

Le contrôle PDF/UA se lance à part, dans chaque dossier de numéro :
`make -f ../../../pipeline/Makefile verifier-ua`. Les huit PDF sont conformes PDF/UA-1.

`out/` n'est pas versionné et se refait par `make all`.

## Ce qu'on attend des mesures

- Une URL longue en fin de ligne de bibliographie est coupée par la césure et laisse de
  grands blancs sur la ligne justifiée (`02-till` et `09-lanners`, dernière page). C'est un
  défaut connu.
- Les avertissements suivants viennent du contenu réel et restent tels quels :
  - des tableaux sans rangée d'en-tête (pas de style d'en-tête dans le Word d'origine) ;
  - des appels de citation sans référence, et des références jamais appelées ;
  - un « ß » et des guillemets droits dans `03-schindler` ;
  - quatre appels ambigus dans `09-lanners` (même auteur, même année) ;
  - `figure-sans-alt` sur deux figures de `09-lanners`.

## Retouches faites après l'import

Un nouvel import des mêmes Word ne redonne pas exactement ces fichiers. Toutes les fiches
ont reçu :

- `doi:`, repris d'OJS (le Word publié ne le contient pas) ;
- `licence: cc-by-4.0` ;
- `email: ""` et `photo: ""`, et pas de dossier `portraits/` : le dépôt est public.

Retouches propres à un article :

| Article | Retouche |
|---|---|
| `02-duret` | Marion Duret : fonction et affiliation recomposées (un saut de ligne dans un même paragraphe Word les avait coupées au mauvais endroit). Isabelle Carchon : adresse retirée de l'affiliation. |
| `03-bolkensteyn` | `type: tribune-libre` (rubrique publiée) |
| `03-martin` | `type: varia` ; l'italique d'un titre cité sortie du lien (`*[titre](url)*` au lieu de `[*titre*](url)`), qui sinon casse PDF/UA-1 |
| `09-lanners` | un saut de paragraphe inséré entre deux images et leur légende (« Abbildung 3 », « Abbildung 6 »), pour que `szh-legendes.lua` les reconnaisse |
| `03-schindler` | Daniela Berger : fonction et affiliation remises en place (le titre « lic. phil. hist. » avait décalé les champs ; il n'a pas de champ dans la fiche). Texte alternatif ajouté aux cinq pictogrammes des tableaux 1 à 5 (`tables/table-0N.html`), repris des légendes publiées. |

`01-ferlazzo`, `02-schneiter` et `02-till` n'ont rien d'autre.

## Attribution CC BY 4.0

Les huit articles sont republiés sous licence Creative Commons Attribution 4.0
International, vérifiée pour chacun sur sa page OJS.

### Revue suisse de pédagogie spécialisée

- **01-ferlazzo** — Lucio Ferlazzo (2024). « Soutien à l'emploi pour les personnes ayant un
  TSA : Défis, enjeux et bonnes pratiques ». *Revue suisse de pédagogie spécialisée*,
  Vol. 14, N° 01/2024. DOI : <https://doi.org/10.57161/r2024-01-06>. Licence CC BY 4.0.
- **02-duret** — Marion Duret, Isabelle Carchon (2025). « Les caractéristiques des enfants
  des classes régionales de la pédagogie spécialisée lors d'une activité collaborative ».
  *Revue suisse de pédagogie spécialisée*, Vol. 15, N° 02/2025.
  DOI : <https://doi.org/10.57161/r2025-02-03>. Licence CC BY 4.0.
- **03-bolkensteyn** — Arun Bolkensteyn (2025). « Directive de la Commission suisse de
  maturité sur les mesures de compensation des désavantages au gymnase : Une harmonisation
  par le bas ? ». *Revue suisse de pédagogie spécialisée*, Vol. 15, N° 03/2025.
  DOI : <https://doi.org/10.57161/r2025-03-07>. Licence CC BY 4.0.
- **03-martin** — Murielle Martin, Sophie Serry, Sylvie Ray-Kaeser, Nevena Dimitrova (2025).
  « Vers un enseignement supérieur inclusif : Explorer les perceptions, pratiques et
  besoins des enseignantes et enseignants en matière de pédagogie inclusive ». *Revue
  suisse de pédagogie spécialisée*, Vol. 15, N° 03/2025.
  DOI : <https://doi.org/10.57161/r2025-03-08>. Licence CC BY 4.0.

### Schweizerische Zeitschrift für Heilpädagogik

- **09-lanners** — Romain Lanners (2024). « Integration vor Separation im Spiegel unserer
  Statistik ». *Schweizerische Zeitschrift für Heilpädagogik*, Jg. 30, Nr. 09/2024.
  DOI : <https://doi.org/10.57161/z2024-09-01>. Licence CC BY 4.0.
- **03-schindler** — André Schindler, Evelyn Krauß, Daniela Berger, Denise Geiser, Susanne
  Enggist, Anita Holzer, Julia Hänni (2025). « Herausforderungen im Unterricht begegnen :
  Kreislauf zur Bearbeitung von herausfordernden Unterrichtssituationen ».
  *Schweizerische Zeitschrift für Heilpädagogik*, Jg. 31, Nr. 03/2025.
  DOI : <https://doi.org/10.57161/z2025-03-03>. Licence CC BY 4.0.
- **02-schneiter** — Salomé Calina Schneiter (2026). « You «C» Cards : visuelle Struktur
  und Partizipation für mehr Inklusion im Musikunterricht ».
  *Schweizerische Zeitschrift für Heilpädagogik*, Jg. 32, Nr. 02/2026.
  DOI : <https://doi.org/10.57161/z2026-02-06>. Licence CC BY 4.0.
- **02-till** — Christoph Till (2025). « Sprachunterstützende
  Massnahmen im Teamteaching : Kooperative Praktiken von Regellehrpersonen, Schulischen
  Heilpädagog:innen und Logopäd:innen ». *Schweizerische Zeitschrift für Heilpädagogik*,
  Jg. 31, Nr. 02/2025. DOI : <https://doi.org/10.57161/z2025-02-03>. Licence CC BY 4.0.
