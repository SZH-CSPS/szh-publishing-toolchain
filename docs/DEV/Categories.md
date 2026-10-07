# Catégories des fiches de la Documentation

État au 02.10.2026. Les catégories **en place** sont celles du contrat
`pipeline/kirby/champs-documentation.json` (section `listes`). Les catégories **proposées** ne
sont pas implémentées ; leurs jetons et leurs libellés allemands sont des propositions à valider.
L'étude et les mesures sont dans [../TODO/news-und-actu-rapport-veille.md](../TODO/news-und-actu-rapport-veille.md)
(§3), les points ouverts dans [../TODO/news-und-actu.md](../TODO/news-und-actu.md).

Décisions de Robin du 24.09.2026, déjà reportées ici : pas de « vieillesse » ; « enfants » et
« adolescent·es » réunis ; pas d'âge de lecture ; pas de thème « inclusion scolaire ».

## Quels groupes pour quels types

| Groupe | Livre | Film | Recherche | Agenda | Tour d'horizon | Interventions | Revue à revue |
|---|---|---|---|---|---|---|---|
| 1. Forme | ✅ en place | ✅ en place | | ✅ en place | | ✅ en place | |
| 2. Portée et lieu | | ✅ en place (pays) | | | ✅ en place | ✅ en place (canton) | |
| 3. Thème | facultatif | facultatif | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4. Degré ou étape de vie | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5. Besoins et handicap | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6. Public | ✅ | ✅ | | ✅ | | | |
| 7. Accessibilité et format | ✅ | ✅ | | ✅ | | | |
| 8. Autres | ISBN | | financement | | type d'acteur | | |

Les groupes 3 à 7 seraient des sélections multiples (`liste_multiple` du contrat, `multiselect`
dans Kirby). Ils donneraient les filtres du futur site. Seule la forme est imprimée aujourd'hui,
en pastille sur les livres et les films ; ce qui s'imprime demain reste à trancher.

## 1. Forme (en place)

### Livre (`categorie_livre`), une valeur, imprimée en pastille

| Jeton | fr | de | Fiches 2025 |
|---|---|---|---|
| `manuel` | Manuel | Fachbuch | 62 |
| `recit` | Récit | Erzählung | 15 |
| `jeunesse` | Jeunesse | Kinder- und Jugendbuch | 0 |
| `biographie` | Biographie | Biografie | 0 |
| `autobiographie` | Autobiographie | Autobiografie | 3 |
| `essai` | Essai | Essay | 3 |
| `temoignage` | Témoignage | Erfahrungsbericht | 1 |

- 62 livres sur 84 sont des manuels : la pastille dit peu de chose.
- `jeunesse` est un public, pas une forme. Je propose de le retirer d'ici : le public
  « enfants et jeunes » (groupe 6) le remplace.

### Film (`categorie_film`), une valeur, imprimée en pastille

| Jeton | fr | de | Fichiers 2025 |
|---|---|---|---|
| `documentaire` | Documentaire | Dokumentarfilm | 24 |
| `court-metrage` | Court métrage | Kurzfilm | 0 |
| `long-metrage` | Long métrage | Spielfilm | 10 |

*The Holdovers* est classé `documentaire`, alors que c'est une fiction : la fiche est à corriger.

### Genre de film (`genre_film`), plusieurs valeurs, facultatif

| Jeton | fr | de |
|---|---|---|
| `drame` | Drame | Drama |
| `comedie` | Comédie | Komödie |
| `comedie-dramatique` | Comédie dramatique | Tragikomödie |
| `biographique` | Film biographique | Filmbiografie |
| `historique` | Film historique | Historienfilm |
| `romance` | Romance | Liebesfilm |
| `familial` | Film familial | Familienfilm |
| `jeunesse` | Jeunesse | Kinder- und Jugendfilm |
| `animation` | Animation | Animationsfilm |

`jeunesse` fait ici aussi doublon avec le public « enfants et jeunes ».

### Agenda (`evenement`), une valeur

| Jeton | fr | de |
|---|---|---|
| `colloque` | Colloque | Tagung |
| `congres` | Congrès | Kongress |
| `journee` | Journée d'étude | Fachtagung |
| `cours` | Cours | Kurs |
| `webinaire` | Webinaire | Webinar |
| `formation` | Formation continue | Weiterbildung |

### Interventions (`instrument`), une valeur

Liste retenue par Robin (02.10.2026, a priori) : huit types, au lieu des vingt du contrat
actuel. Non implémenté.

| Jeton | fr | de | Code Curia |
|---|---|---|---|
| `motion` | Motion | Motion | 5 |
| `postulat` | Postulat | Postulat | 6 |
| `interpellation` | Interpellation | Interpellation | 8, 9 |
| `question` | Question | Anfrage | 12, 13, 18, 19 |
| `question-heure` | Heure des questions | Fragestunde | 14 |
| `initiative-parlementaire` | Initiative parlementaire | Parlamentarische Initiative | 4 |
| `initiative-cantonale` | Initiative cantonale | Standesinitiative | 3 |
| `petition` | Pétition | Petition | 10 |

Ce que deviennent les douze autres valeurs du contrat actuel, regroupées par leur code Curia.
La dernière colonne compte les fiches de la bibliothèque (79 interventions au total).

| Valeur actuelle | Devient | Fiches |
|---|---|---|
| `interpellation-urgente` (VS) | `interpellation` | 0 |
| `question-urgente` | `question` | 0 |
| `question-ordinaire` (SG) | `question` | 1 |
| `question-ordinaire-urgente` | `question` | 0 |
| `schriftliche-anfrage` (AR, BS) | `question` | 7 |
| `kleine-anfrage` (SH) | `question` | 0 |
| `auskunftsbegehren` (NW) | `question` | 1 |
| `anzug` (BS) | `postulat` (même code Curia, 6) | 3 |
| `auftrag` (GR) | `motion` (même code Curia, 5) | 1 |
| `objet-gouvernement` | **à trancher** : ce n'est pas une intervention | 3 |
| `objet-parlement` | **à trancher** | 0 |
| `recommandation` | **à trancher** | 0 |

Ce que coûte le regroupement :
- Le nom local de l'instrument se perd : une Anzug bâloise s'imprimerait « Postulat », une
  Schriftliche Anfrage « Anfrage ». Le numéro et le lien de la fiche restent justes.
- Les 3 fiches « Objet du gouvernement » n'ont pas de case. Il faut les supprimer, les
  rattacher à `motion` ou à `postulat` selon l'objet, ou garder ce neuvième type.

Les interventions portent aussi un état (`etat`, 9 valeurs) et une source (`source` : Curia
Vista, IDES, saisie manuelle). Ce sont des données de suivi, pas des catégories de lecture.

## 2. Portée et lieu (en place)

### Tour d'horizon (`portee`), une valeur

| Jeton | fr | de | Fiches 2025 |
|---|---|---|---|
| `international` | International | International | 16 |
| `national` | National | National | 59 |
| `intercantonal` | Intercantonal | Interkantonal | 12 |
| `regional` | Régional | Kantonal | 25 |
| `varia` | Varia | Varia | 24 |

`regional` ouvre le choix du canton.

### Canton (`canton`)

Les 26 cantons, plus CH. Il sert aux interventions (CH d'abord dans le tri) et au tour d'horizon
régional.

### Pays d'un film (`pays`)

250 pays selon ISO 3166, plusieurs valeurs possibles.

## 3. Thème (proposé)

Ce sont les dossiers de premier niveau 21 à 28 de `1_Themen` sur le SharePoint.

| Jeton | fr | de | Dossier |
|---|---|---|---|
| `formation-professionnels` | Formation des professionnel·les | Ausbildung der Fachpersonen | 21_Ausbildung_FP |
| `droit-structures` | Droit et structures | Recht und Strukturen | 22_Recht_Strukturen |
| `statistique` | Statistique | Statistik | 23_Statistik |
| `financement` | Financement | Finanzierung | 24_Finanzierung |
| `qualite` | Qualité | Qualität | 25_Qualitaet |
| `international` | International | Internationales | 26_Internationales |
| `numerique` | Numérique et inclusion numérique | Digitalisierung und digitale Inklusion | 27_ICT_Digitale Inklusion |
| `conception-universelle` | Conception universelle (UD, UDL) | Universal Design (UD, UDL) | 28_UD |

Deux candidats, à trancher. Ils viennent de sous-dossiers et ne sont pas des thèmes de la maison :

| Jeton | fr | de | Dossiers d'origine |
|---|---|---|---|
| `compensation-desavantages` | Compensation des désavantages | Nachteilsausgleich | 22_Recht_Strukturen\Nachteilsausgleich ; 13_Obli_BS\NA.Dokumentation |
| `transition` | Transition | Übergänge | 14_Nachobli_BS\Transition (un seul dossier, candidat faible) |

Ce qui n'est pas un thème :
- 12, 13 et 14 sont des degrés (groupe 4) ;
- 11_Allgemeines, 29_Literatur et 00_Pictures ;
- l'inclusion scolaire (décision de Robin).

27 et 28 se recoupent en partie : 28_UD contient `digitale Barrierefreiheit`.

## 4. Degré ou étape de vie (proposé)

| Jeton | fr | de | Origine |
|---|---|---|---|
| `petite-enfance` | Petite enfance et préscolaire | Frühe Kindheit und Vorschulbereich | 12_Vorobli_BS |
| `scolarite-obligatoire` | Scolarité obligatoire | Obligatorische Schule | 13_Obli_BS |
| `postobligatoire` | Postobligatoire (secondaire II, formation professionnelle, tertiaire) | Nachobligatorischer Bereich (Sek II, Berufsbildung, Tertiärstufe) | 14_Nachobli_BS |
| `age-adulte` | Âge adulte (travail, logement) | Erwachsenenalter (Arbeit, Wohnen) | ajout, absent de `1_Themen` |

## 5. Besoins et handicap (proposé)

Absent de `1_Themen`. Libellés à caler sur `11_Allgemeines\Terminologie SZH` (glossaire SZH D-F,
terminologie CDIP) et sur le vocabulaire du handicap de la Revue.

| Jeton | fr | de |
|---|---|---|
| `non-specifique` | Non spécifique | Nicht spezifisch |
| `autisme` | Autisme | Autismus |
| `tdah` | TDAH | ADHS |
| `troubles-apprentissages` | Troubles des apprentissages (dys) | Lernstörungen (Legasthenie, Dyskalkulie…) |
| `deficience-intellectuelle` | Déficience intellectuelle | Kognitive Beeinträchtigung |
| `handicap-physique` | Handicap physique | Körperliche Beeinträchtigung |
| `surdite` | Surdité et malentendance | Hörbeeinträchtigung |
| `cecite` | Cécité et malvoyance | Sehbeeinträchtigung |
| `troubles-langage` | Troubles du langage | Sprach- und Sprechstörungen |
| `troubles-comportement` | Troubles du comportement | Verhaltensauffälligkeiten |
| `sante-psychique` | Santé psychique | Psychische Gesundheit |
| `polyhandicap` | Polyhandicap | Mehrfachbehinderung |
| `maladies-chroniques` | Maladies chroniques ou rares | Chronische und seltene Krankheiten |
| `haut-potentiel` | Haut potentiel | Hochbegabung |

Mesuré sur la bibliothèque : un handicap est nommé dans 42 livres sur 84 et dans 26 films sur 34.

## 6. Public (proposé)

### Livre

| Jeton | fr | de |
|---|---|---|
| `professionnels` | Professionnel·les | Fachpersonen |
| `parents-proches` | Parents et proches | Eltern und Angehörige |
| `personnes-concernees` | Personnes concernées | Betroffene |
| `enfants-jeunes` | Enfants et jeunes | Kinder und Jugendliche |
| `grand-public` | Grand public | Breites Publikum |

### Film

| Jeton | fr | de |
|---|---|---|
| `enfants-jeunes` | Enfants et jeunes | Kinder und Jugendliche |
| `adultes` | Adultes | Erwachsene |
| `famille` | Famille | Familie |

**Âge minimal**, une valeur : 0 · 6 · 12 · 16 · 18. Il se saisit à la main. Mesure du 24.09.2026 :
1 film sur 28 seulement porte une classification sur Wikidata. TMDB n'a pas été testé, faute de
clé, et la classification qui fait foi en Suisse reste à choisir.

### Agenda

| Jeton | fr | de |
|---|---|---|
| `professionnels` | Professionnel·les | Fachpersonen |
| `parents-proches` | Parents et proches | Eltern und Angehörige |
| `personnes-concernees` | Personnes concernées | Betroffene |
| `tout-public` | Tout public | Alle |

## 7. Accessibilité et format (proposé)

### Livre

| Jeton | fr | de |
|---|---|---|
| `falc` | FALC | Leichte Sprache |
| `gros-caracteres` | Gros caractères | Grossdruck |
| `braille` | Braille | Braille |
| `livre-audio` | Livre audio | Hörbuch |
| `daisy` | DAISY | DAISY |

### Film

| Jeton | fr | de |
|---|---|---|
| `audiodescription` | Audiodescription | Audiodeskription |
| `sous-titres-sourds` | Sous-titres pour personnes sourdes | Untertitel für Hörbeeinträchtigte |
| `langue-signes` | Langue des signes | Gebärdensprache |

### Agenda

| Groupe | Jeton | fr | de |
|---|---|---|---|
| Format | `presentiel` | Présentiel | Präsenz |
| | `en-ligne` | En ligne | Online |
| | `hybride` | Hybride | Hybrid |
| Accessibilité | `interpretation-ls` | Interprétation en langue des signes | Gebärdensprachdolmetschen |
| | `falc` | FALC | Leichte Sprache |
| Coût | `gratuit` | Gratuit | Kostenlos |
| | `payant` | Payant | Kostenpflichtig |

La langue de la manifestation se dirait avec les jetons de langue du contrat (fr, de, it).

## 8. Autres (proposé)

| Type | Champ | Valeurs |
|---|---|---|
| Livre | ISBN | identifiant ; il permet de préremplir langue, pages, éditeur et sujet depuis la DNB et la BnF |
| Recherche | Financement | `fns` FNS / SNF · `innosuisse` Innosuisse · `canton` Canton / Kanton · `fonds-propres` Fonds propres / Eigenmittel |
| Tour d'horizon | Type d'acteur | `autorite` Autorité / Behörde · `association` Association / Verband · `haute-ecole` Haute école / Hochschule · `office-federal` Office fédéral / Bundesamt |

## Ce qui peut se remplir automatiquement

| Catégorie | Automatique ? | Source |
|---|---|---|
| Langue, pages, éditeur, année d'un livre | Oui, avec l'ISBN | DNB, BnF (interface SRU) |
| Sujet d'un livre vers « besoins et handicap » | Assez fiable chez les éditeurs allemands et français, faible chez les petits éditeurs romands | vedettes-matière GND et RAMEAU |
| Financement d'une recherche | Oui | source du moissonneur (FNS) |
| Thèmes d'une reprise | Oui | mots-clés des articles sur OJS |
| Thèmes d'une intervention fédérale | Oui pour la Confédération, non pour les cantons | descripteurs de Curia Vista |
| Âge minimal d'un film | Non (1 film sur 28 sur Wikidata) | TMDB à tester |
| Besoins et handicap, degré | En suggestion seulement | mots-clés : fiable quand le handicap est nommé, muet sinon |
| Thème, public, accessibilité d'un film | Non | jugement de la rédaction |

Principe : l'automatique suggère et la rédaction valide, comme dans le vérificateur de traduction.
