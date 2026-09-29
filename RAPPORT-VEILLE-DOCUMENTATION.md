# Veille de la Documentation : sources, moissonneur de recherches, catégories

Rapport du 24.09.2026. Trois questions : d'où tirer les métadonnées des sources de la
Documentation 2025, comment moissonner les projets de recherche, quelles catégories manquent
aux fiches. Ce qui reste à trancher est repris dans TODO-NewsUndActu.md.

## 1. Revues, institutions, éditeurs : pas de source unique

Mesuré sur Crossref et OpenAlex (les deux grandes bases ouvertes d'articles) pour les 13 revues
et périodiques citées en 2025 :

| Couverture | Titres |
|---|---|
| À l'article, avec DOI (Crossref, API gratuite) | *La nouvelle revue* (Cairn), *Délibérée* (Cairn), *ALTER* (OpenEdition, 56 DOI depuis 2025) |
| Rien à l'article | *A.N.A.E.* (dans OpenAlex jusqu'en 2020 seulement, pas de DOI), *Résonances*, *Éducateur*, *Pages romandes*, *Tactuel*, *Ombres & Lumière*, *Édurevue*, *Enjeux pédagogiques*, *ARTISET*, *Édubref* |

Recommandation : une bibliothèque de groupe **Zotero** comme réservoir. La saisie se fait en un
clic depuis Cairn, OpenEdition, un DOI ou une page qui porte ses métadonnées, et le reste se
saisit à la main une seule fois. Zotero a une API, ce qui permettra plus tard de préremplir une
fiche Kirby.

Pour savoir ce qui paraît : flux RSS (trouvés chez *A.N.A.E.*, *Pages romandes*, Coraasp, CFHE,
*Ombres & Lumière*, centre LEARN de l'EPFL, HEP-BEJUNE, plus un flux par revue chez Cairn et
OpenEdition) ; surveillance de page pour les sites sans flux (FIRAH, FSS, RADIX, ARTISET, CDIP,
Canton de Vaud, UCBA, Drees, Agefiph) ; lettres d'information sur une boîte dédiée.

## 2. Projets de recherche : moissonneur `szh-harvest-research`

### Où se trouvent les 9 fiches de 2025

| Projet | FNS | SKBF | Site de l'école |
|---|---|---|---|
| ZEPPELIN Follow-up 15–16 (HfH) | ✅ 229643 | volet précédent seulement (25:084) | page réservée aux personnes connectées |
| Tea2C | ✅ 10002617, mais c'est la PH Luzern qui porte la requête | ❌ | tea2c.ch, hors des sites moissonnés |
| MOSAIK (PHZH) | ✅ 10003198 | ❌ | liste de la PHZH illisible sans JavaScript |
| Beurteilung und Wohlbefinden (PHSG) | ✅ 228543 | ❌ | ✅ |
| Schul-Connect (PHBern) | ❌ | ❌ | ✅ (résumé vide sur le site actuel) |
| Go Offline (HfH) | ❌ | ❌ | ✅ |
| Inklusive Hochschule (HfH) | ❌ | ❌ | ✅ |
| Transformation integrative Schule (HfH) | ❌ | ❌ | ✅ (identique à la fiche) |
| Inklusiv-digitale Bildung (EHB) | ❌ | ❌ | ✅ |

Aucune source ne suffit seule. Combinées, elles couvrent 8 des 9 projets ; il ne manque que
Tea2C, que le filtre écarte (voir 2.3).

### Ce que fait l'outil

Dossier `C:\Users\robin\Documents\Prog\szh-harvest-research\` (dépôt git local, rien de commité).
Python, bibliothèque standard seulement, tourne sous Windows. Mode d'emploi : `LISEZMOI.md` ;
contrat interne : `CONTRAT.md`.

- **Trois sources.** Le FNS (export ouvert avec résumés) ; les plans du site de six hautes écoles
  (HfH, PHBern, PHSG, EHB, PH FHNW, HEP Vaud) ; la base SKBF-CSRE.
- **Base locale SQLite** (`donnees\harvest.sqlite`). Chaque élément vu y est gardé une fois pour
  toutes avec un statut : `nouveau`, `hors-sujet`, `termine` (fin passée), `existant` (déjà en
  fiche), `exporte`, `ignore`, `doublon`. Une deuxième moisson ne relit que ce qui est neuf et ne
  change jamais un statut posé.
- **`amorcer`** compare la base à la bibliothèque `_NewsUndActu\Fiches\forschung\` (lecture
  seule), par lien puis par titre. Seuls les rapprochements sûrs passent en `existant` ; les
  probables sont listés à part. Mesuré : les 4 fiches présentes au FNS sont reconnues comme
  sûres, et un projet voisin sur la biodiversité est resté dans les probables.
- **`exporter`** écrit `forschung\<slug>\recherche.<lang>.txt` au format exact de Pronto :
  `Ausgabe:` vide (la fiche arrive au Réservoir du cockpit), slug et Uuid selon les règles du
  cockpit, jamais d'écrasement. Un même projet vu par deux sources donne une seule fiche, avec
  le lien de l'école de préférence à celui du FNS. `Lien_libelle` reste vide et le descriptif
  est le résumé de la source : ces deux champs sont à rédiger. L'export écrit aussi un rapport
  daté.
- **Politesse réseau.** L'outil respecte robots.txt, attend 3 s entre deux requêtes vers un même
  site, ralentit sur un refus « 429 » et abandonne un site après 5 échecs de suite. Il n'aborde
  plus un site de front : la première moisson complète avait reçu 27 refus de la PHBern.
- **39 tests** hors réseau, tous au vert.

### 2.3 Mesures et réglages

- **Filtre en deux listes.** Une seule liste de mots retenait 1126 subsides FNS depuis 2024, dont
  un tiers à cause de mots courants : « accessible », « double-blind », « impair » en biologie.
  Désormais, les mots sûrs (autisme, Heilpädagogik, TDAH…) sont cherchés dans le titre et le
  résumé. Les mots courants (inclusion, Wohlbefinden, accessib…) ne sont cherchés que dans le
  titre, et pour le FNS seulement en éducation, psychologie, sociologie et travail social.
  Résultat : **92 subsides**. Un tirage de 25 montre encore du bruit sur « well-being » (santé,
  travail), vite trié.
- **Tea2C disparaît** avec ce réglage : aucun mot du filtre ne le touche. Seule la règle
  « toute la psychologie passe » le retenait, et elle ramenait les 1126.
- **SKBF.** 311 projets numérotés depuis 2024, dont 40 pertinents. Mais la SKBF enregistre
  tard : des numéros 2026 ont commencé entre 2015 et 2023. Le statut `termine` écarte ceux
  dont la fin est passée.
- **Sites désactivés**, pour une raison mesurée à chaque fois (détail dans
  `harvest\sources\sites.py`) : PHZH (liste générée en JavaScript), PHLU (base Firebase fermée),
  HEP-BEJUNE (recherche publiée par personne, pas par projet), HEP Fribourg (certificat TLS
  invalide). La Suisse romande est donc mal couverte : seule la HEP Vaud l'est, au mieux.
- **Le FNS interdit tout robot** dans son robots.txt, y compris pour ses données ouvertes.
  L'outil ne contourne pas cette interdiction : l'export (430 Mo) se télécharge à la main.

- **Codes de discipline du FNS.** Un projet interdisciplinaire comme MOSAIK a pour domaine
  principal « SSH + LS » ; son code sciences de l'éducation (105) n'apparaît que dans la liste
  complète des disciplines. Le filtre lit aussi cette liste, sinon MOSAIK était perdu.

### 2.4 Première moisson complète (24.09.2026)

| Source | Pages ou subsides vus | Pertinents en cours | Terminés | Déjà en fiche | Durée |
|---|---|---|---|---|---|
| FNS (depuis 2024) | export complet | 60 | 32 | 3 | 5 s (export local) |
| SKBF (numéros depuis 2024) | 309 | 1 | 39 | 0 | ≈9 min |
| HfH | 118 | 37 | 77 | 4 | 6 min |
| PHBern | 558 | 7 | 18 | 1 | 29 min |
| PHSG | 137 | 3 | 0 | 1 | 7 min |
| PH FHNW | 220 | 7 | 2 | 0 | 11 min |
| EHB | 130 | 0 | 4 | 0 | 7 min |
| HEP Vaud | 30 | 6 | 0 | 0 | 2 min |

- **Au total, 121 fiches à trier.** L'essai d'export, fait dans un dossier jetable et jamais dans
  la bibliothèque, a produit 121 fiches au bon format. La base a ensuite été remise à l'état
  « nouveau ».
- **`amorcer` a reconnu 7 des 9 fiches existantes**, par 9 rapprochements sûrs : ZEPPELIN et
  le projet de la PHSG sont vus chacun par deux sources. Il a aussi signalé 4 rapprochements
  probables, tous faux, et il a eu raison de ne pas les promouvoir.
- **Les deux fiches manquantes :**
  - Inklusiv-digitale Bildung (EHB) a fini le 1ᵉʳ juin 2026 : le moissonneur la classe
    `termine`, ce qui est juste.
  - Tea2C n'est trouvé par aucune source avec le filtre actuel (voir 2.3).
- **Une moisson suivante** ne relit que les pages nouvelles ou modifiées : quelques minutes.
- **Premier export FNS :** le FNS colle ses paragraphes sans espace (« verbessern.Die »).
  Corrigé, avec un test.

## 3. Catégories supplémentaires (proposition, rien d'implémenté)

### Constat

- Les fiches livre et film n'ont qu'une catégorie de forme : manuel, récit, jeunesse… pour les
  livres ; documentaire, court ou long métrage pour les films. Rien ne dit **de quoi** parle
  l'objet ni **pour qui** il est fait.
- Mesuré sur les 84 livres et 34 films de la bibliothèque, par mots-clés : un type de handicap
  est nommé dans le titre ou le descriptif de **42 livres sur 84** et de **26 films sur 34**.
  Pour l'autre moitié des livres (inclusion, école, droits, direction d'établissement), un axe
  « type de handicap » ne suffit pas : il faut aussi un axe « thème ».
- `jeunesse` mélange la forme et le public (c'est aussi un genre de film). Aucun des 84 livres
  n'y est classé. Il faudrait le sortir
  de la catégorie et le rendre au public cible.

### Trois axes communs à tous les types

Les trois axes auraient un seul vocabulaire bilingue fr/de, dans
`pipeline/kirby/champs-documentation.json` (`listes`), en sélection multiple. C'est le type
`multiselect` de Kirby, ce qui donne les filtres du futur site sans rien inventer.

1. **Thème.** Les thèmes de la maison sont les dossiers de premier niveau de `1_Themen` :

   | Dossier | Thème |
   |---|---|
   | 21_Ausbildung_FP | formation des professionnel·les |
   | 22_Recht_Strukturen | droit et structures |
   | 23_Statistik | statistique |
   | 24_Finanzierung | financement |
   | 25_Qualitaet | qualité |
   | 26_Internationales | international |
   | 27_ICT_Digitale Inklusion | numérique et inclusion numérique |
   | 28_UD | conception universelle (UD, UDL) |

   Les dossiers 12, 13 et 14 sont des degrés, pas des thèmes : ils forment l'axe 2.
   11_Allgemeines, 29_Literatur et 00_Pictures ne sont pas des thèmes.

   *Ajouts possibles, qui sont ma proposition et non des thèmes de la maison* (inclusion
   scolaire écartée par Robin le 24.09.2026) :
   - **compensation des désavantages** : `22_Recht_Strukturen\Nachteilsausgleich` et
     `13_Obli_BS\NA.Dokumentation` ;
   - **transition** : `14_Nachobli_BS\Transition`, un seul dossier, candidat faible.

   D'autres sous-dossiers (éducation sexuelle, langue des signes, comportement, participation)
   sont des événements ou des dossiers ponctuels ; ils ne justifient pas un thème sans décision
   de la rédaction.
2. **Degré ou étape de vie**, qui reprend 12, 13 et 14 de `1_Themen` : petite enfance et
   préscolaire · scolarité obligatoire · postobligatoire (secondaire II, formation
   professionnelle, tertiaire) · âge adulte (travail, logement). La vieillesse est écartée
   (Robin, 24.09.2026).
3. **Besoins et handicap** : non spécifique · autisme · TDAH · troubles des apprentissages (dys)
   · déficience intellectuelle · handicap physique · surdité et malentendance · cécité et
   malvoyance · troubles du langage · troubles du comportement · santé psychique ·
   polyhandicap · maladies chroniques ou rares · haut potentiel. Les libellés sont à caler sur
   la terminologie de la maison (`11_Allgemeines\Terminologie SZH`, glossaire SZH D-F,
   terminologie CDIP) et sur le vocabulaire du handicap de la Revue.

### Propre à chaque type

| Type | Catégories proposées |
|---|---|
| Film | **âge minimal** (0, 6, 12, 16, 18) · **public** (enfants, jeunes, adultes, famille) · **accessibilité** (audiodescription, sous-titres pour personnes sourdes, langue des signes) · durée |
| Livre | **public cible** (professionnel·les, parents et proches, personnes concernées, enfants et jeunes, grand public) · **format accessible** (FALC / Leichte Sprache, gros caractères, braille, livre audio, DAISY) · **ISBN** |
| Recherche | financement (FNS, Innosuisse, canton, fonds propres) · les trois axes |
| Agenda | public cible · format (présentiel, en ligne, hybride) · langue(s) · accessibilité (interprétation en langue des signes, FALC) · gratuit ou payant |
| Tour d'horizon | les trois axes · type d'acteur (autorité, association, haute école, office fédéral) |
| Interventions | les trois axes |
| D'une revue à l'autre | les trois axes |

### Ce qui peut se catégoriser automatiquement de façon fiable

| Catégorie | Automatique ? | Comment |
|---|---|---|
| Âge minimal d'un film | **Non**, d'après la mesure du 24.09.2026 | Wikidata : 12 des 28 films de la bibliothèque y figurent, **1 seul** porte une classification FSK (*The Holdovers*). TMDB n'a pas été testé (clé requise). La plupart de nos films sont des documentaires ou sortent en streaming, souvent sans classification officielle. Champ à saisir, prérempli seulement quand une classification existe |
| Durée d'un film | Probablement, non mesuré | TMDB |
| Langue, pages, éditeur, année d'un livre | **Oui**, à condition d'avoir l'ISBN | catalogues de la DNB et de la BnF (interface SRU) : c'est ce qui justifie le champ ISBN |
| Sujet d'un livre (vers le type de handicap) | **Assez fiable** pour les éditeurs allemands et français | vedettes-matière GND (DNB) et RAMEAU (BnF), à faire correspondre une fois au vocabulaire. Faible pour les petits éditeurs romands |
| Financement d'une recherche | **Oui** | vient de la source du moissonneur (FNS) |
| Thèmes d'une reprise de la Revue | **Oui** | mots-clés des articles sur OJS |
| Thèmes d'une intervention fédérale | **Oui pour la Confédération**, non pour les cantons | descripteurs de Curia Vista ; rien d'équivalent chez OpenParlData |
| Type de handicap (tous types) | **En suggestion seulement** | fiable quand le handicap est nommé (la moitié des livres) ; muet sinon. Des faux positifs repérés (« âges » pris pour la vieillesse) |
| Degré ou étape de vie | En suggestion | mots-clés, précision moyenne |
| Thème SZH, public cible, accessibilité d'un film | **Non** | jugement de rédaction. La disponibilité de l'audiodescription ou des sous-titres change d'une plateforme à l'autre |

Principe proposé : l'automatique **suggère** et la rédaction valide, comme le vérificateur de
traduction. Un classement par modèle de langue contre le vocabulaire fermé ferait mieux que les
mots-clés pour le thème et le public, mais resterait une suggestion.
