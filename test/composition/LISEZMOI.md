# Corpus de composition

Huit articles réellement publiés (quatre Revue, quatre Zeitschrift), importés par la vraie
chaîne .docx → .md → pandoc → HTML → WeasyPrint, pour mesurer la composition — césures,
suites de lignes coupées, blancs de justification, pagination — sur du texte long et réel
plutôt que sur les articles courts du banc rapide. Sert quand on change de version de
WeasyPrint ou de pandoc, ou de réglage de `pipeline/styles/print.css` : on recompile, on
mesure, on compare au JSON de référence de la dernière mesure connue.

## Recompiler et mesurer

Depuis la WSL `SZH-Publishing`, pour chaque numéro :

```
cd test/composition/revue      && make -f ../../../pipeline/Makefile all
cd test/composition/zeitschrift && make -f ../../../pipeline/Makefile all
```

Puis, depuis la racine du dépôt :

```
/opt/weasyprint/bin/python test/composition-check.py test/composition/revue test/composition/zeitschrift
```

`reference.json`, à côté de ce fichier, est la dernière mesure connue : pandoc 3.7.0.2,
WeasyPrint 70.0, `hyphenate-limit-zone: 10%` (image WSL du 23.09.2026). Pour s'y comparer :
`--reference test/composition/reference.json` ; le script nomme chaque écart et rend 1.
Après une montée d'outil ou un réglage voulus, réécrire la référence avec `--json` et
dire pourquoi dans le message de commit.

Ce que la mesure a déjà tranché : sur ce corpus, WeasyPrint 70 sans réglage enchaînait
neuf fois quatre lignes coupées ou plus et coupait huit fois en bas de page, deux fautes
contre le Guide que 69 ne commettait pas. La zone de césure de `print.css` en vient.

Défaut connu, présent sous 69 comme sous 70 : une URL longue en fin de ligne de
bibliographie est coupée par la césure et laisse jusqu'à 77 px par espace sur la ligne
justifiée (02-till, 09-lanners, dernière page).

La porte PDF/UA (bloquante, hors de `all`) se lance séparément dans chaque dossier de
numéro : `make -f ../../../pipeline/Makefile verifier-ua`.

`out/` n'est pas versionné (ignoré par `test/.gitignore`) : il se régénère par `make all`.

## Attribution CC BY 4.0

Les huit articles sont republiés ici sous licence Creative Commons Attribution 4.0
International, telle que vérifiée article par article lors de la constitution du corpus
(page OJS, mention de licence et `oai_dc_rights`). Citation complète de chacun :

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

## Retouches faites après import

Toutes les fiches ont reçu, systématiquement : `doi:` (absent de l'import — l'objet publié
ne porte pas son DOI dans le corps du .docx, seul OJS le connaît, repris ici depuis la
vérité de référence du corpus) ; `licence: cc-by-4.0` (rendue explicite, déjà le défaut
implicite du gabarit) ; e-mail et photo d'auteur·e vidés (`email: ""`, `photo: ""`) et les
dossiers `portraits/` supprimés — le dépôt sera public, ces données personnelles n'y ont
pas leur place. Au-delà de ce socle commun :

- **01-ferlazzo** — rien d'autre.
- **02-duret** — deux champs auteur corrigés à la main, un défaut d'import confirmé sur le
  .docx source (retiré après import, vérifié depuis la copie de travail) :
  - Marion Duret : la fonction « Psychomotricienne MIP (Master International de
    Psychomotricité) » était un seul paragraphe Word coupé par un simple retour à la ligne
    interne (`<w:br/>`), que l'import a pris pour une frontière de champ. Elle sortait donc
    fonction = « Psychomotricienne MIP (Master » et affiliation = « International de
    Psychomotricité), Service de Psychologie Scolaire Lausanne ». Recomposé en
    fonction = « Psychomotricienne MIP (Master International de Psychomotricité) »,
    affiliation = « Service de Psychologie Scolaire Lausanne ».
  - Isabelle Carchon : l'affiliation portait en plus une adresse e-mail parasite
    (« École Pratique des Hautes Études Paris, isabelle.carchon@polesante.eu »), happée
    depuis un second paragraphe d'e-mail du même auteur que l'import a mal réparti.
    Affiliation corrigée en « École Pratique des Hautes Études Paris » (l'e-mail est de
    toute façon retiré, voir plus haut).
- **03-bolkensteyn** — `type:` corrigé de `article` (défaut de l'import, aucun signal
  détecté) à `tribune-libre`, d'après la rubrique du manifeste (« Tribune libre »).
- **03-martin** — `type:` corrigé de `article` à `varia`, d'après la rubrique du manifeste
  (« Varia »). Retouche du `.md` : la référence à l'ouvrage cité en fin d'article portait
  l'italique **à l'intérieur** du lien (`[*titre*](url)`), ce qui balise l'ancre PDF avec
  un élément interne (`<em>`) — défaut d'import qui casse PDF/UA-1 (zone cliquable
  dédoublée par boîte de texte, ISO 14289-1 7.18.5-1, documenté dans
  `pipeline/templates/szh-article.html`). L'italique a été déplacée hors du lien
  (`*[titre](url)*`) ; le texte du titre n'a pas changé.
- **09-lanners** — Retouche du `.md` : deux légendes (« Abbildung 3 », « Abbildung 6 »)
  étaient collées sans saut de paragraphe directement après leur image — artefact d'une
  image en zone de texte flottante dans le Word source (l'import laissait même filtrer des
  métadonnées d'ancrage brutes juste avant, nettoyées par ailleurs). Sans saut de
  paragraphe, `szh-legendes.lua` ne reconnaît pas de légende voisine et l'image reste sans
  alt ni légende. Un saut de paragraphe a été inséré entre l'image et son texte de légende
  ; le texte de la légende n'a pas changé. Les deux figures restent signalées par
  `[numerotation-avertissement] figure-sans-alt` (avertissement, pas un blocage PDF/UA :
  l'image sort en décor faute de description).
- **03-schindler** — Un champ auteur corrigé, même défaut de décalage que Duret mais côté
  nom : « Daniela Berger, lic. phil. hist. » est UN SEUL paragraphe Word (nom + titre
  académique après une virgule) ; l'import a pris « hist. » pour le début du champ fonction
  suivant, décalant tout d'un cran (fonction = « hist. », affiliation = « Schulische
  Heilpädagogin, Dozentin, Supervisorin BSO, PHBern »). Corrigé en
  fonction = « Schulische Heilpädagogin », affiliation = « Dozentin, Supervisorin BSO,
  PHBern » (le titre académique « lic. phil. hist. » n'a pas de champ dans le schéma à
  sept clés et n'est repris nulle part, comme le « Dr. phil. » d'autres auteur·e·s du même
  article).
  Texte alternatif posé sur les cinq pictogrammes des tableaux 1 à 5
  (`tables/table-0N.html`), qui sortaient en `alt=""` : « Piktogramm des Schritts
  «Informationen zur Situation»», et ainsi de suite. Le nom de l'étape est repris mot pour
  mot de la légende publiée juste au-dessus (« Abbildung 2: Informationen zur Situation »),
  rien n'est inventé. Sans lui, l'article ne pouvait pas passer PDF/UA : WeasyPrint balise
  tout `<img>` en `/Figure`, même en `alt=""`, et une `/Figure` sans `/Alt` est refusée.
- **02-schneiter** — rien d'autre.
- **02-till** — rien d'autre.

## Verdict PDF/UA-1

**Les huit PDF sont conformes PDF/UA-1 sous WeasyPrint 70**, la version de l'image livrée
depuis le 23.09.2026. Sous WeasyPrint 69, deux articles échouaient, et c'est une trouvaille
de ce corpus : leurs tableaux sont bien formés (grille de même largeur sur chaque ligne,
vérifié), mais 69 balisait mal les cellules fusionnées.

- **02-duret** : six tableaux dont deux sous-lignes partagent une cellule en `rowspan="2"` —
  ISO 14289-1 7.2-43 sous 69.
- **02-till** : un en-tête groupé en `colspan="3"` — ISO 14289-1 7.2-42 sous 69.

Un article de ce genre aurait donc bloqué l'export d'un vrai numéro sous 69 ; il passe sous
70 sans retouche.

Avertissements restants (non bloquants, propres au contenu réel du corpus, à ne pas
« corriger » silencieusement) : plusieurs tableaux « sans en-tête » détectés (première
ligne ou colonne non stylée comme en-tête dans le Word source — motif que le corpus
d'accessibilité teste déjà volontairement) ; quelques appels de citation sans référence ou
références jamais appelées (bibliographies réelles, incohérences de l'auteur·e) ; un « ß »
et des guillemets droits résiduels dans 03-schindler (avertissements typographiques, à
trancher à la relecture, le filtre n'y touche pas) ; quatre appels ambigus dans 09-lanners
(plusieurs références du même auteur la même année).

## Taille

`test/composition/` hors `out/` : environ 3,2 Mo (huit articles, texte + tableaux HTML +
médias). Bien en dessous du seuil de 15 Mo — aucun média à alléger. Le plus gros fichier
est `zeitschrift/articles/02-schneiter/media/02-schneiter-fig-01.png` (environ 1,6 Mo).
