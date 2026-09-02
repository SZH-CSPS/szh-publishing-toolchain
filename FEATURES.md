# Chantier du 23 août 2026 — spécification et plan

Ce qui a été demandé, comment c'est découpé, et à quoi on reconnaît que c'est fait. Le journal
des tâches ordinaires reste `TODORMO.md` ; ce fichier ne décrit qu'une campagne.

Origine : deux revues adverses. La première portait sur le travail de rédaction (ce qui manque à
une rédactrice), la seconde sur la conformité éditoriale (26 constats, neuf vérifiés par la
mesure). Les décisions ci-dessous sont celles du propriétaire, prises constat par constat.

---

## I. Fonctionnalités

### F1 — Réimporter un article

Aujourd'hui l'auteur renvoie son Word corrigé et il n'existe aucun chemin : l'original a été
supprimé à l'import, le même nom donne « déjà converti — ignoré », un autre nom crée un deuxième
article. Il faut un « Réimporter cet article » qui reconvertit le corps **en gardant** la fiche,
les médias, les portraits et les traductions.

### F2 — Vue « Articles », et l'envoi de la version finale

Un clic sur « Articles » ouvre une vue d'ensemble, sur le modèle des vues « Traductions » et
« Word en attente » déjà en place. Elle porte :

- **une liste de tâches par article**, paramétrable, distincte pour la Revue et pour la
  Zeitschrift, à intitulés traduisibles dans les deux langues. Jeu de départ : « version
  finale », « traductions terminées », « contraste et texte alternatif », « envoi de la version
  finale aux autrices et auteurs » ;
- **le réordonnancement des articles** (voir F4) ;
- **un bouton « envoyer à l'auteur » par article** : compile le PDF, prépare un modèle de
  courriel et la pièce jointe. **La voie reste à trancher**, et c'est le seul point de cette
  campagne qui n'a pas de solution sûre : `mailto:` ne sait pas porter de pièce jointe, et
  l'automatisation COM d'Outlook — qui, elle, le sait — a été retirée le 23.08.2026 parce
  qu'elle ne fonctionne pas avec le nouveau client. Restent trois voies, à éprouver sur un
  poste réel avant de choisir :
  1. un fichier `.eml` déposé sur le disque puis ouvert : porte la pièce jointe et un corps
     HTML, mais le nouvel Outlook le gère mal, parfois en lecture seule ;
  2. `mailto:` pour le texte, plus l'ouverture du dossier contenant le PDF : le rédacteur fait
     glisser la pièce jointe lui-même. Sans magie, mais sans surprise ;
  3. le presse-papiers : corps du message copié, PDF copié comme fichier, un seul collage dans
     le brouillon. À vérifier, Windows sait copier un fichier dans le presse-papiers.
  Ne rien promettre au rédacteur que le client de messagerie ne tienne : mieux vaut la voie 2,
  explicite, qu'une voie 1 qui échoue une fois sur deux selon le poste ;
- **l'édition de toutes les métadonnées du numéro**, en réutilisant le code du formulaire
  existant : mêmes champs, même sauvegarde, aucune duplication ;
- **les réglages de couverture** (voir F5).

Le tout à sauvegarde automatique, bilingue, dans la présentation des autres formulaires.

### F3 — Les articles portent leur titre

L'interface les désigne par leur slug tronqué à 39 caractères. Le titre vit dans la fiche : il
devient le libellé, le slug passe en description. **Un préfixe à deux chiffres est conservé** pour
qu'on voie d'un coup d'œil où l'article se situe dans le numéro.

### F4 — L'ordre du numéro est modifiable

Il vient aujourd'hui du tri des noms de fichiers ; déplacer un article oblige à renommer dossier
et `.md` dans l'Explorateur, ce qui casse `out/`. Le réordonnancement se fait dans la vue F2 et
pilote l'ordre de l'arborescence.

### F5 — Réglages de couverture au niveau du numéro

`couverture.jpg`, qu'attend l'export OJS, n'est nommé dans aucune interface ni documentation :
tous les numéros partent sans couverture. Ses réglages rejoignent le formulaire F2.

*Hors demande :* sommaire, pagination continue et PDF complet du numéro faisaient partie du même
constat mais n'ont pas été retenus. La pagination est reportée dans `TODORMO.md`.

---

## II. Corrections demandées

### La mauvaise langue

Deux défauts distincts sous le même toit.

`derive_revue()` de `szh-maquette.lua` impose la langue de la **revue** à `<html lang>`, aux
libellés *Figure / Abbildung* et au `/Lang` du PDF ; le champ `lang` n'existe qu'au niveau du
numéro. Aucun article ne peut déclarer sa langue. Mesuré : `test/articles/contenu-long/` est
entièrement en prose allemande et son PDF de référence porte `/Lang (fr)`.

Et le repli `{ lang, 'de', 'fr', 'it' }` fait qu'un article dont le titre allemand est vide
**imprime le titre français** sous `lang="de"`, sans un mot.

Décision : un champ `lang` par article ; un champ porteur vide dans la langue de l'article
**arrête la compilation** avec un message qui nomme l'article, le champ et le geste de correction.

### Les avertissements de la chaîne n'arrivent jamais à l'écran

`tasks.json` porte `reveal: "silent"`, `problemMatcher: []`, `clear: true`. Or la chaîne détecte
déjà « appel sans référence », « appel ambigu », « référence jamais appelée », « balisage PDF
indisponible », « image manquante » : tout part sur stderr, dans un terminal que rien n'ouvre.
C'est le point le plus rentable de la liste — le remonter débloque une dizaine de silences déjà
instrumentés. À faire avec une relecture de **tous** les messages : compréhensibles par une
rédactrice, pas par un développeur.

### Le mode développeur

`lireModeDeveloppeur()` vaut `true` par défaut et `Get-SzhBaseRevuesPour` choisit sur cette base la
**racine** des dossiers de revues. Les revues réelles vivent donc dans la racine `dev`, et
désactiver le réglage par curiosité pointerait le lanceur sur une racine `prod` probablement vide.
À corriger, puis à résumer noir sur blanc : quoi vit où.

### Les références dans l'export OJS

`<citations>` est omis avec un commentaire assumé (« pas de source fiable »). La prémisse a changé.
Décision : les envoyer **en texte brut**, récupérés au dernier moment depuis le `.md` de l'article.

---

## III. Les vingt-six constats, décision par décision

| Réf. | Constat | Décision |
|---|---|---|
| P1 | Langue d'article inexprimable | corriger |
| P2 | `/Figure` sans `/Alt` dans un PDF PDF/UA | corriger |
| P3 | PDF/UA revendiqué, jamais vérifié, dégradation muette | corriger |
| P4 | Langue des passages absente du PDF | **constat à revoir** — voir §VII |
| P5 | CC-BY affirmé en dur pour tout | **fait** — champ `licence` par article, CC-BY 4.0 par défaut, six licences CC 4.0 + droits réservés |
| P6 | Contrastes de couverture et d'en-tête sous le seuil | corriger les couleurs |
| P7 | « TO BE TRANSLATED » imprimable | message d'erreur nommant le champ et l'article |
| P8 | Collision de slug, article perdu, sortie 0 | corriger |
| P9 | Tableau importé sans `<th>` | avertissement nommant l'article et le tableau |
| P10 | Description longue de tableau absente du PDF et du Word | non retenu |
| P11 | Export OJS calé sur une seule revue | corriger, et rendre les rubriques paramétrables dans l'interface |
| P12 | `date_published` toujours omis | **fait** — l'export bloque, le lanceur n'invente plus |
| P13 | ORCID, `<pages>`, `<citations>`, DOI | ORCID et citations : corriger. DOI : reporté |
| P14 | Aucun article paginable | reporté |
| P15 | Ancrages de citation divergents | corriger |
| P16 | Appel orphelin sans marque ni rapport | non retenu |
| P17 | Repérage de bibliographie trop large | non retenu |
| P18 | Espace fine perdue, polices non épinglées | corriger |
| P19 | Sauts de niveau de titre | corriger |
| P20 | Aucune normalisation typographique | reporté |
| P21 | Sans fiche, l'article compile quand même | corriger |
| P22 | Tableau manquant imprimé en encadré rouge | non retenu |
| P23 | Couverture qui rogne en silence | non retenu |
| P24 | Numéros de section absents du DOCX | corriger |
| P25 | Portrait recadré et légendé sans confirmation | non retenu |
| P26 | Le harnais ne peut pas voir un défaut de production | corriger |

Reportés dans `TODORMO.md` : P13 (DOI), P14, P20.

---

## IV. Découpage en vagues

Les chantiers sont regroupés par **territoire de fichiers**, pas par constat : deux agents qui
écrivent dans le même fichier se détruisent. Une vague ne démarre que lorsque la précédente est
vérifiée.

### Vague 1 — le socle

| Chantier | Constats | Territoire |
|---|---|---|
| Langue d'article | P1, mauvaise langue, P7 | `lib/yaml.js`, `lib/i18n.js`, `extension.js`, `media/metadata-issue.*`, `szh-maquette.lua`, `szh-numerotation.lua` |
| Contrastes | P6 | `pipeline/print.css`, `test/apca-check.py` |
| Ancrages | P15 | `szh-citations.lua`, `lib/citations.js`, `test/js/contrats.test.js` |
| Import | P8, P21, P9 | `pipeline/Makefile`, `lib/slug.js`, `import-docx.sh`, `docx-*.py` |

Plus une recherche sans écriture : les intitulés exacts des rubriques sur `ojs.szh.ch`, nécessaires
à P11.

### Vague 2 — le PDF tient ce qu'il promet

P2, P3, P4 et veraPDF d'abord ; puis P18, P19 et P24, qui touchent les mêmes filtres et doivent
donc suivre, pas accompagner.

### Vague 3 — export et hôte

P5 (licence) d'abord, parce qu'il ajoute un champ que l'export doit connaître ; puis P11, P12,
P13 ; puis le mode développeur.

### Vague 4 — la vue « Articles »

F2, F3, F4, F5, F1. Le plus gros morceau, et le seul qui crée des fichiers. Ensuite, et seulement
ensuite, la remontée des avertissements à l'écran : elle a besoin des messages produits par toutes
les vagues précédentes.

### Vague 5 — le harnais

P26 : un article de test « accessibilité » (tableau sans en-tête, image sans alt, bibliographie à
noms polonais et turcs, corps dans l'autre langue que la revue), un test qui appelle réellement
`genererExportOjs()`, et veraPDF en intégration continue.

---

## V. Points de contrôle transverses

À vérifier à chaque fin de vague, sans exception :

1. `node --test "test/js/*.test.js"` — 54 contrôles à la ligne de base, jamais moins.
2. Chaque message vu par un utilisateur existe en français **et** en allemand, en orthographe
   suisse (`ss`, jamais `ß`).
3. Aucun composant dupliqué : le propriétaire refuse d'avoir à modifier la même chose à deux
   endroits.
4. Aucun formulaire sans sauvegarde automatique.
5. Un rendu réel avant / après, pas une lecture de source, pour tout ce qui touche la maquette.

---

## VI. Reports entre chantiers

Ce qu'un chantier a trouvé mais laissé à un autre, faute de territoire. Rien ici n'est
facultatif : c'est la dette de coordination du découpage en vagues. Barrer au fur et à mesure.

### Repris dans la vague 2 (maquette et filtres)

- [ ] **Un module `pipeline/filters/szh-langue.lua`.** La lecture de `lang:` est aujourd'hui
  dupliquée dans `szh-maquette.lua` et `szh-numerotation.lua` — quinze lignes, commentées des
  deux côtés. La duplication est assumée parce que `szh-numerotation` tourne aussi dans la
  chaîne d'aperçu, où `szh-maquette` n'est pas branché ; passer la valeur par `meta` n'aurait
  couvert que la chaîne PDF. Contraire à la règle « une seule fois, un seul endroit ».
- [x] **`SZH_LANGUE` exporté par le `Makefile`** — **sans objet, réglé autrement.**
  `szh-maquette.lua` n'a plus de langue à choisir : il écrit les deux sur la ligne, avec un code
  stable, et c'est le cockpit qui décide laquelle afficher. La dépendance à `SZH_LANGUE` a
  disparu du filtre.

### Repris dans la vague 4 (vue « Articles » et remontée des messages)

- [ ] **Le badge « déjà converti » mentira.** `extension.js` (lignes 396 et 2194) appelle encore
  `slugifierArticle` ; un Word en attente dont le slug de base est pris est désormais importé
  avec un suffixe, pas ignoré. `slugifierArticleUnique` est exportée pour ce raccordement.
- [x] **Les lignes `[import-avertissement]` arrivent à l'écran** — fait le 23.08.2026. Format retenu par le
  pipeline : `[import-avertissement] <code> | article « <slug> » | … | <phrase fr> | [de] <Satz>`.
  Le code est stable (`tableau-sans-entete`, `titre-manquant`, `meta-illisible`,
  `homonymes-epuises`) ; l'interface doit l'ancrer sur `^\[import-avertissement\] (\S+)`, lui
  donner un ton neutre — et non « danger », comme le fait `lireRapportImport` pour tout `⚠` —
  puis afficher **une seule** langue depuis `lib/i18n.js` au lieu de la prose du pipeline.
- [ ] **Le bouton « Changer la langue de l'article »** de `media/metadata-articles.html` n'a plus
  d'objet : la langue est désormais sur chaque carte. Son message a été réécrit pour renvoyer
  vers la carte, faute de pouvoir retirer le bouton hors territoire.
- [ ] **Le formulaire du numéro propose encore `en`** comme langue de numéro, alors que
  `langueDefaut()` la ramène à `fr` sans rien dire. Pré-existant, mais devenu visible depuis que
  l'article, lui, refuse une langue hors fr/de/it.

### Repris dans la vague 5 (harnais)

- [ ] **Deux contrôles de miroir manquent à `contrats.test.js`** : que `LANGUES_ARTICLE` de
  `lib/yaml.js`, `LANGUES_CHOIX` de `media/_commun.js` et la table `LANGUES` de
  `szh-maquette.lua` restent la même liste ; et que le brouillon de traduction garde son
  destinataire et sa langue par produit. Les deux vivent provisoirement dans
  `test/js/langue.test.js`.
- [ ] **Le scénario « toolkit plus ancien que l'extension »** n'est couvert par aucun test : il
  faudrait un faux `C:\ProgramData`. C'est pourtant le cas qui s'est produit cette semaine.
- [ ] **Le générateur de la table de repli** (`REPLI_BLOCS`, 656 entrées) vit dans `tmp/`, hors
  git. Une table que personne ne sait régénérer est une dette : soit le verser, soit décrire sa
  fabrication dans le filtre.

### Sans vague assignée

- [ ] **`volume: "44"` du gabarit est faux, et rien ne le dit.** Trouvé en corrigeant la date :
  c'est exactement le même piège, une valeur plausible, fausse et invisible. Tout numéro créé
  garde `44`, alors que le relevé du 23.08.2026 sur `ojs.szh.ch` donne **Vol. 16** pour la revue
  française et **Bd. 32** pour la Zeitschrift : le gabarit se trompe donc pour les deux. Et
  `export-ojs.js:377` n'avertit que si le volume est **absent**, jamais s'il est faux. Le volume
  se déduit de l'année et de la revue ; à trancher comme la date — laisser vide et exiger la
  saisie, ou calculer. Hors mandat de la campagne, aucun propriétaire.
- [x] **`source:` est porté par `extension.js`, le pont est parti.** `nettoyerCarte()` porte
  désormais `source` et `licence`, et `ecrireCartesArticles()` relit du fichier ce que la carte
  de la webview n'apporte pas — `source`, qu'aucun formulaire n'affiche. Le pont par
  `_inconnues` de `lib/yaml.js` a été retiré avec le chantier de la licence (P5), et
  `test/js/licence.test.js` garde l'aller-retour complet par l'hôte réellement activé.

- [ ] **L'avertissement `nonempty <title>` de la cible aperçu** subsiste : l'aperçu passe par
  `commonmark_x` sans gabarit ni `szh-maquette`, donc sans `pagetitle`. HTML interne au cockpit,
  jamais publié.
- [ ] **`docx-titres.py` et `import-medias.py`** gardent leur `|| true`, documentés comme non
  bloquants. À réexaminer une fois que les avertissements arrivent à l'écran.
- [ ] **Les galleys s'affichent dans l'ordre DOCX, HTML, PDF** sur le site, alors que
  `FORMATS_GALLEY` les émet PDF, HTML, DOCX — OJS respecte l'ordre d'import. À trancher : le PDF
  devrait probablement venir en premier.

---

## VII. Ce que la validation PDF/UA a corrigé au constat

Une étude de faisabilité a installé veraPDF 1.30.2 dans la distribution, validé les trois PDF du
banc, isolé chaque cause par un cas minimal, et **atteint la conformité complète** sur une copie
du pipeline. Elle corrige la revue adverse sur plusieurs points ; ce qui suit remplace ce que
disaient P2, P3 et P4.

### Ce qui allait déjà bien, contrairement au constat

Les trois PDF portent `/Lang` au catalogue, `/MarkInfo /Marked true`,
`/ViewerPreferences /DisplayDocTitle true`, un `dc:title` XMP non vide, `pdfuaid:part 1`, et
**tous les `/Table` ont des `/TH`**. Sur les six `/Figure` de `figures.pdf`, cinq portent bien un
`/Alt`.

**P4 est à revoir.** L'absence de `/Lang` sur les éléments de structure n'est **pas** en soi une
non-conformité PDF/UA-1 : la règle 7.2 ne l'exige que là où la langue change. Le corpus du banc
étant entièrement francophone, l'étude n'a pas pu déclencher la règle. Le cas qui compte — un
résumé dans l'autre langue sur la couverture — reste donc à établir, et c'est une tâche de la
vague 2. Ce que la revue affirmait comme une violation mesurée est en réalité une question
ouverte. La gêne pour un lecteur d'écran, elle, existe indépendamment de la norme.

### Les trois défauts réels, et leur cause exacte

| Règle | Cause | Coupables |
|---|---|---|
| `7.1-3` contenu non balisé | toute `opacity` CSS < 1 fait dessiner l'élément dans un Form XObject où le `/MCID` devient orphelin | `.szh-book { opacity: .07 }` et `.szh-authors li + li::before { opacity: .5 }` |
| `7.18.5-1` liens mal balisés | un `<a>` qui **contient un élément** produit une annotation par boîte descendante ; une seule est rattachée à un `/Link` | les ancres DOI, licence et ORCID du gabarit ; l'appel de note que pandoc écrit `<a><sup>n</sup></a>` |
| `7.3-1` figure sans alt | WeasyPrint 69 balise `/Figure` même pour une image décorative ; `role="presentation"` et `aria-hidden` **n'y changent rien** | l'image `alt=""` de `test/articles/figures/` — le cas décoratif voulu |

Correctifs mesurés conformes : pré-mélanger les couleurs au lieu d'une `opacity`, sortir la flèche
et le logo du `<a>`, réordonner l'appel de note en `<sup><a>…</a></sup>`, et passer l'image
décorative en `background-image` CSS avec une hauteur explicite. La fidélité visuelle de ces
quatre correctifs n'était **pas** prouvée par l'étude : c'est un point de contrôle de la vague 2.

### La validation, et son prix

veraPDF exige la JVM. Mesuré : un JRE Debian complet coûte 200 Mio, un runtime taillé au `jlink`
55 Mio, le pack CLI seul 16 Mio — soit **72 Mio sur un rootfs de 1,32 Gio**, à comparer aux
903 Mio du venv des portraits. Une voie légère en Python (`pypdf`, 3 Mio) reproduit exactement
les comptes de veraPDF sur les sept règles qui nous concernent, mais laisse passer les
quatre-vingt-dix-neuf autres et ne peut jamais *prouver* la conformité — au mieux dire « contrôles
d'accessibilité SZH », jamais « PDF/UA-1 conforme ».

Décision : veraPDF, aux deux bouts. Chez le rédacteur, parce que la conformité doit pouvoir
échouer au moment où il compile ; et en intégration continue, parce que c'est ce qui attrape une
régression de maquette ou une montée de WeasyPrint. Deux corrections d'énoncé au passage :
`test/out/*.pdf` **n'est pas versionné**, la CI doit donc recompiler le banc ; et il n'existe
aujourd'hui **aucune intégration continue par commit** — `release.yml` ne se déclenche que sur un
tag `v*`, c'est-à-dire trop tard.

Ordre impératif : **les correctifs d'abord, la porte dure ensuite.** L'inverse ferait échouer tous
les numéros.

Codes de sortie de veraPDF, mesurés : `0` conforme, `1` non conforme, `4` fichier introuvable,
`7` fichier illisible. Séparer le verdict de la panne, sinon un veraPDF absent se lira comme un
PDF conforme.

---

## VIII. Demandes du 24 août 2026, en file

Toutes bloquées par un territoire de fichiers, pas par une décision. À lancer dès que
`extension.js`, `lib/i18n.js`, `pipeline/Makefile` et `pipeline/styles/print.css` se libèrent.

### F6 — La vue « Articles » montre et mène

- [ ] **A. Les métadonnées complètes, en aperçu non éditable**, sur la carte de l'article.
  « Le plus compact possible mais lisible » : c'est une contrainte de conception, pas une
  formule. Titre, sous-titre, résumés, mots-clés, DOI, langue, licence, auteur·e·s — sans
  formulaire, sans champ, sans risque de modifier par inadvertance.
- [ ] **B. Un bouton « Éditer les métadonnées »** qui ouvre le formulaire correspondant.
- [ ] **C. Un bouton « Éditer les médias de l'article »**, de même.
- [ ] **D. Un compteur d'images**, hors photos d'auteur·e·s, et pour chacune :
  - si la case « l'image apporte une information » est cochée, signaler un **texte
    alternatif vide** ;
  - signaler une **légende vide**, dans tous les cas.

### F7 — La légende par défaut disparaît

- [ ] À l'insertion d'une image, la légende est aujourd'hui pré-remplie avec le mot
  « Légende » (`fmt.figure.legende`), posé par `extension.js:5031` et
  `lib/formatting.js:170`. Le propriétaire le refuse, avec raison : **un texte par défaut
  se prend pour un texte rempli**, et l'image part sans légende en ayant l'air d'en avoir une.
  La légende naît donc **vide**.

  **Attention à un couplage** : `lib/export-ojs.js` construit `LEGENDES_PAR_DEFAUT` depuis
  cette même clé, précisément pour reconnaître la légende oubliée et le dire. Si la valeur
  par défaut devient vide, c'est le **vide** qu'il faut désormais détecter — et il faut
  garder la reconnaissance de l'ancien mot pour les articles déjà écrits, sinon leur
  légende oubliée redevient invisible.

- [ ] **Ne rien changer aux images importées** : la légende et le texte alternatif venus du
  Word sont repris comme aujourd'hui. C'est explicitement demandé.

### F8 — L'aperçu HTML montre ce que seul un lecteur d'écran voit

- [ ] Sous chaque image et chaque tableau de l'**aperçu HTML uniquement**, un encadré
  pointillé portant `ALT=`, `DESCRIPTION=` et ce qui s'applique. Le but : rendre visible à
  l'œil ce qui n'existe que pour un lecteur d'écran, donc relisable par une rédactrice.

  **Jamais dans le PDF**, qui est le document publié. Le mécanisme existe déjà :
  `szh-citations.lua` ne pose ses marques d'appel douteux que sous `SZH_APERCU=1`
  (vers la ligne 655), et c'est exactement le bon patron.

  Point d'attention : l'aperçu partage `pipeline/styles/print.css` avec le PDF. Le style de
  l'encadré doit donc être portable par le seul chemin de l'aperçu — soit une règle que
  seul l'aperçu atteint, soit une feuille propre à l'aperçu. À trancher, en disant pourquoi.

### F9 — Les dossiers de revue, paramétrables dans les Réglages

- [ ] Demandé : « rends le dossier de la Revue et de la Zeitschrift paramétrable, avec des
  gros warning ! Attention ne changez cela que si vous êtes certain de ce que vous faites. »

  Aujourd'hui les deux racines sont **en dur** dans `Get-SzhEmplacements` de
  `windows/szh-common.ps1`, et seul le choix entre elles est réglable
  (`emplacementRevues`, voir `docs/EMPLACEMENTS.md`). Les rendre saisissables est un cran
  au-dessus en danger : une racine fausse ne casse rien, elle **fait disparaître le
  travail**, et c'est exactement le sinistre que la campagne d'hier a évité de justesse.

  L'avertissement demandé n'est donc pas décoratif. Trois garde-fous à prévoir, au-delà du
  texte : refuser un chemin qui n'existe pas ; dire **combien de numéros** la nouvelle
  racine contient avant de valider — une racine vide se voit alors avant, pas après ; et
  garder la précédente pour pouvoir revenir. `Set-SzhRaccourcisMenu` montre le patron d'une
  écriture jamais bloquante qui rend un bilan.

  Bloqué par `media/settings.*`, `extension.js` et `lib/i18n.js`.

### F10 — Le DOI, calculé, et l'ordre gelé par l'archivage

- [ ] **Le DOI est un simple calcul**, sans mémoire ni gel. Forme demandée, qui est
  exactement celle relevée sur `ojs.szh.ch` : `10.57161/z2026-06-00` — `z` Zeitschrift ou
  `r` Revue, l'année, le numéro sur deux chiffres, l'ordre de l'article sur deux chiffres.
  Préfixe commun aux deux revues, seule la lettre les distingue.

  J'avais proposé de figer le DOI dans la fiche, par crainte qu'un réordonnancement ne
  déplace des identifiants déjà déposés. **Le propriétaire a tranché plus simplement, et
  mieux** : c'est l'*ordre* qu'on gèle, pas le DOI. Toute la mécanique de gel disparaît.

- [ ] **Un numéro archivé ne peut plus être réordonné. Et c'est l'archivage seul qui gèle
  l'ordre** — pas le verrou.

  Le modèle est plus fin qu'il n'y paraît, et il correspond à un vrai geste éditorial : un
  numéro `locked` a ses **textes** figés, mais sa **séquence** peut encore se décider. Un
  numéro `archived` est terminé, plus rien ne bouge.

  État du code : le gestionnaire de réordonnancement (`extension.js`, vers la ligne 3304)
  appelle `refuserSiVerrouille()`, dont la condition est `archivee || verrouillee`
  (ligne 148). Il refuse donc aujourd'hui sur **les deux** drapeaux. À changer pour ne
  lire que `archivee` — `etatRevue()` de `lib/yaml.js` l'expose déjà séparément, et
  `etatNumero.archivee` est tenu à jour par l'hôte : rien à construire, une condition à
  écrire.

  Cela crée une **exception explicite au verrou**, et elle doit être commentée sur place :
  sans la phrase qui dit pourquoi, quelqu'un « réparera » l'incohérence en remettant le
  garde complet, et l'ordre redeviendra figé trop tôt.

  Noter que désarchiver ne déverrouille pas (`archived: 'false'` seul, ligne 1178) : un
  numéro sorti des archives redevient donc réordonnable tout en restant verrouillé, ce qui
  est exactement le comportement voulu.

- [ ] **Aucun test ne couvre ce refus.** La protection tiendra par une seule condition que
  rien ne garde — précisément le genre de ligne qu'un remaniement retire en croyant
  simplifier. Un contrôle qui archive un numéro, tente un déplacement et vérifie que
  l'ordre n'a pas bougé ; un second qui verrouille sans archiver et vérifie que le
  déplacement **passe**.

- [ ] **Une case « pas de DOI » par article**, et les articles sans DOI sont déplacés
  **automatiquement en fin de numéro**.

  L'idée est élégante : les articles porteurs de DOI occupent alors les premières positions
  de façon contiguë, donc le compteur reste `00`, `01`, `02`… quoi qu'on fasse du reste. Et
  cela colle à l'instance réelle, où la rubrique Documentation n'a pas de DOI et se trouve
  en fin de sommaire. L'éditorial, lui, porte `00`.

  **Conséquence à ne pas ignorer** : « déplacés automatiquement à la fin » agit sur l'ordre
  lui-même, donc les boutons monter/descendre doivent respecter la règle. On ne doit pas
  pouvoir remonter un article sans DOI au-dessus d'un article qui en a un — sinon la règle
  se contredit d'un clic et le compteur redevient instable. Soit les boutons refusent au
  bord, comme ils le font déjà en tête et en queue de liste, soit le tri se réapplique après
  chaque déplacement. À trancher, pas à ignorer.

  L'export refuse déjà un DOI absent : il devra accepter l'absence **voulue**, sans la
  confondre avec un oubli.

  Bloqué par `extension.js`, `lib/yaml.js`, `lib/articles.js`, `lib/export-ojs.js` et
  `lib/i18n.js`.

---

## IX. Lot du 1er septembre 2026 — la Documentation d'une revue, en section à part

> ⚠ **Trois décisions de ce lot ont été révisées le 02.09.2026** — voir la section X :
> la page de Documentation ne se liste plus dans l'arbre (F11), les deux formulaires
> n'en font plus qu'un (F12), et l'agenda a quitté les rubriques de prose pour devenir
> une fiche structurée (F12). Ce qui suit décrit l'état du 01.09.2026, conservé pour la
> trace du raisonnement.

La rubrique « Documentation » / « Dokumentation » d'un numéro (section OJS `DC` / `DK`)
mélangeait deux régimes de contenu que rien ne distinguait dans l'arbre : des fiches
structurées (livre, film, intervention, recherche) et des blocs de prose (bibliographies,
listes de liens, brèves). Trois chantiers du même lot, parce qu'ils partagent le même
territoire de fichiers (`extension.js`, `lib/i18n.js`, `lib/ressources.js`,
`pipeline/filters/szh-ressource.lua`, `pipeline/Makefile`, `package.json`).

### F11 — La section « Actualité », sœur d'Articles et de Traductions

Décision : une section de premier niveau à part dans l'arbre `szhCockpitVue`, « ACTUALITÉ » /
« NEWS », entre « ARTICLES » et « TRADUCTIONS » — **revue seulement**, un livre n'a pas de
Documentation. Elle liste les articles dont la fiche porte `type: documentation`
(`extension.js` : `TYPE_ACTUALITE`, `_itemsActualite`, `estActualite`, `sectionDeSlug`,
`_repartirUnites`), et ces articles disparaissent de la section Articles.

Aucun nouveau dossier sur le disque, aucun nouveau `FileSystemWatcher` : ce sont les mêmes
`articles/<slug>/` qu'aujourd'hui, seulement présentées ailleurs. `listerArticles()` continue
de tout renvoyer — l'ordre du numéro, les DOI, les traductions et l'export OJS ne changent
pas ; un article de Documentation garde son rang global (celui du numéro entier, pas celui de
la sous-liste) et se traduit comme les autres. Changer le type dans la fiche suffit à faire
changer l'article de section, sans déplacement de fichier.

### F12 — Rubriques de texte riche, et la cinquième fiche « D'une revue à l'autre »

Les fiches structurées existantes (`lib/ressources.js` : `livre`, `film`, `intervention`,
`recherche`) ne couvrent que la moitié du contenu de la Documentation. L'autre moitié —
bibliographies, listes de liens, brèves — n'a pas de champs isolables ; les forcer dans un
formulaire n'aurait rien apporté. Décision : un nouveau bloc `.szh-rubrique`
(`lib/rubriques.js`), un seul champ de texte riche par bloc (markdown ordinaire, déjà parsé
par pandoc), six types fermés, dans l'ordre d'affichage du formulaire : références du dossier,
sites en lien avec le dossier, tour d'horizon, ressources, documentaires et podcasts, agenda et
formation continue. Le titre imprimé n'est jamais écrit dans le `.md` : il se déduit du type
et de la langue de l'article au rendu, même parti que le libellé de lien d'une fiche de
ressource.

Formulaire propre (commande `szh.rubriquesArticle`, `lib/rubriques.js`,
`media/rubriques-article.js`) plutôt qu'une section de plus dans celui des ressources : saisir
une fiche (champ par champ) et saisir une rubrique (un seul bloc de prose) sont deux gestes
trop différents pour un même panneau. Barre d'outils Gras / Italique / Lien / Liste, avec
`Ctrl+B` / `Ctrl+I` au clavier.

Le filtre `pipeline/filters/szh-rubrique.lua` s'insère juste après `szh-citations.lua`, avant
`szh-notes.lua`, dans les deux règles du `Makefile` (`%.html` et `%.apercu.html`) — ordre non
négociable, vérifié à la main : `szh-sections.lua`, déjà passé, numérote les `h2` du corps dans
le texte (un titre de rubrique inséré avant lui sortirait « 1 Références du dossier ») ; et
`szh-citations.lua` reconnaît le titre de la bibliographie sur son texte (« Références »,
« Literatur ») — un `h2` de rubrique posé avant son passage aurait pu s'y faire prendre.

Une cinquième fiche de ressource complète la table de `lib/ressources.js` : `reprise`
(« D'une revue à l'autre » / « Blick in die Revue »), champs `auteurs`, `revue`, `reference`,
`doi`, sans image (`SANS_IMAGE`). Recopiée à l'identique dans
`pipeline/filters/szh-ressource.lua` ; gardée par `test/js/ressources.test.js`, qui refuse que
les deux tables divergent.

### F13 — La réserve : mettre une fiche de côté, l'échanger entre les deux revues

Besoin : détacher une fiche structurée du numéro courant sans la perdre, et en envoyer une
copie vers l'autre revue pour traduction. `lib/reserve.js` pose le magasin à
`<parent du numéro>/_reserve/<revue|zeitschrift>/` — hors du numéro (survit à son archivage),
au niveau où vivent les dossiers de numéro voisins dans l'arborescence OneDrive/SharePoint
commune aux deux rédactions (donc déjà partagée entre collègues, sans geste de plus). Deux
gestes sur une seule mécanique d'écriture :

- **Détacher** : le bloc quitte le `.md` de l'article, atterrit dans la réserve de la revue
  courante, `a-traduire: false`.
- **Envoyer vers l'autre revue** : une COPIE atterrit dans la réserve de l'AUTRE revue,
  `a-traduire: true`, `origine` = la revue courante ; le bloc reste dans l'article.

L'image d'une fiche, si elle en a une, est copiée à côté du `.md` dans la réserve, et le
chemin du bloc est réécrit en conséquence. Deux boutons sur chaque fiche déjà enregistrée du
formulaire des ressources (`media/ressources-article.js`, visibles seulement une fois la
fiche persistée, jamais sur une fiche encore en brouillon). L'entrée « Réserve » de la section
Actualité (toujours présente, même sans article de Documentation dans le numéro) ouvre un
`QuickPick` en deux temps — la liste des fiches en attente, puis l'action nommée en toutes
lettres (`szh.reserve`, `ouvrirReserve`) — plutôt qu'un bouton par ligne, pour qu'un clic mal
placé ne supprime rien.

### Invariants tenus

- i18n : chaque clé ajoutée dans `lib/i18n.js` existe en fr **et** en de, avec les mêmes
  repères `{0}`, `{1}` — vérifié par `test/js/contrats.test.js`.
- Tables recopiées : `lib/rubriques.js` <-> `szh-rubrique.lua` (nouveau test de
  non-divergence, même discipline que `lib/ressources.js` <-> `szh-ressource.lua`).
- Aucun formulaire sans sauvegarde automatique (rubriques comme ressources).
- Suite de tests : `node --test "test/js/*.test.js"` depuis la racine du dépôt —
  `rubriques.test.js`, `reserve.test.js`, `ressources.test.js`, `ressources-hote.test.js` et
  `actualite.test.js` passent (182 tests, 0 échec, vérifié le 01.09.2026).

## X. Lot du 2 septembre 2026 — la Documentation en une page et un formulaire

Le lot précédent avait posé la Documentation en section d'arbre et en deux formulaires.
Robin l'a essayée, et six demandes en sont sorties le même jour. Elles portent toutes le
même reproche : **trop de gestes pour une page qui n'est qu'un magasin de blocs**.

### F14 — Une page, ouverte d'un clic, sans .md à manipuler

Décision : « Supprime le fichier .md de la documentation, il n'est pas nécessaire. Lorsque
l'on clique sur "Actualité" affiche directement la liste des rubriques. »

Le `.md` ne disparaît pas — c'est lui que la chaîne compile, et l'ordre du numéro se lit sur
les dossiers d'`articles/`. Ce qui disparaît, c'est son STATUT DE PIÈCE À MONTER : la page de
Documentation ne se liste plus dans l'arbre, son texte ne s'ouvre plus jamais dans l'éditeur,
et personne n'a plus à lui régler un type d'article. Cliquer l'en-tête « ACTUALITÉ » ouvre son
formulaire (`szh.documentation`, `ouvrirPageDocumentation`) et la CRÉE si le numéro n'en a pas
encore : dossier, `.md` vide, fiche `type: documentation` avec son titre imprimé dans la
langue du numéro (`creerPageDocumentation`, `SLUG_DOCUMENTATION`).

C'est le seul en-tête de section qui ouvre un formulaire plutôt qu'une vue d'ensemble. Une
liste d'un seul élément n'aurait été qu'un détour — il n'y a qu'une page de Documentation par
numéro. La section ne porte donc plus que l'entrée « Réserve », et le badge de l'en-tête
compte désormais les BLOCS de la page (fiches et rubriques réunies) et non les articles.

La création seule est refusée sur un numéro verrouillé ; la consultation, non — on doit
pouvoir relire la Documentation d'un numéro bouclé. D'où une commande hors `cmdEcriture`,
avec le garde-fou posé à l'intérieur.

### F15 — Un seul formulaire pour les deux familles, tout pliable, avec un sommaire

Décision : « fais un seul formulaire avec rubriques et les ressources » ; « rend toutes les
rubriques et les ressources pliables en accordéon » ; « rajoute une table des matières à
droite du formulaire (sticky) permettant de visualiser la structure ».

`media/documentation.{html,css,js}` remplace `ressources-article.*` et `rubriques-article.*`,
tous deux supprimés. Un seul panneau (`szhDocumentation`), une seule commande
(`szh.ressourcesArticle` conservée pour les articles ordinaires, `szh.documentation` pour la
page du numéro), une seule table de panneaux — laquelle, au passage, répare un oubli du lot
précédent : `fermerFormulairesEcriture()` ne connaissait pas `panneauxRubriques`, et un
verrouillage de numéro laissait donc ce formulaire ouvert.

Trois choix de mise en page :

- **une rubrique EST son accordéon**. Elle n'a qu'un bloc de prose : son titre imprimé sert
  d'en-tête, il n'y a ni intertitre ni carte à distinguer. Une catégorie de fiches, elle,
  garde son intertitre et une carte pliable par fiche.
- **un seul accordéon ouvert dans toute la page**, rubriques comprises. La page fait une
  douzaine d'entrées ; deux blocs ouverts en même temps rendraient le sommaire inutile.
  Recliquer sur le bloc ouvert le referme : l'état « tout replié » doit rester atteignable.
- **le sommaire est collant** (`position: sticky` dans `.corps`, le conteneur défilant), avec
  le nombre de fiches par catégorie et la mention « vide » sur une rubrique qui ne
  s'imprimera pas. C'est le seul endroit d'où l'on voit, sans rien déplier, ce qu'il reste à
  écrire.

Les rubriques n'ont plus de bouton « Ajouter un bloc » : « laisse toujours un bloc actif /
éditable dans chaque rubrique et ne permet pas d'en ajouter plus ». Chaque type a son bloc
unique, toujours présent. La corbeille ne retire donc pas la carte — elle vide le texte, ce
qui ôte le bloc du `.md` et fait disparaître la rubrique du PDF ; la remplir la fait revenir.
`lib/rubriques.js` n'a pas changé pour autant : un `.md` écrit à la main qui porterait deux
blocs du même type se lit et se rend encore. C'est une règle de formulaire, pas de format.

### F16 — Une fiche incomplète s'enregistre, et le dit par une pastille

Décision : « À compléter avant l'enregistrement : Descriptif. => supprime ainsi, permet
enregistrement, rajoute un badge "non complet" dans le titre de l'accordéon. »

Le refus d'écrire une fiche incomplète faisait perdre la saisie à qui quittait le formulaire.
`ressourceComplete()` ne commande donc plus l'écriture : c'est `ressourceEcrivable()`
(`lib/ressources.js`) qui la commande, et il ne refuse que deux choses — un type inconnu, et
une carte à laquelle personne n'a rien saisi (celle qu'un clic sur « Ajouter » vient de
créer). La complétude ne pilote plus que la pastille « non complet » de l'en-tête, dont
l'info-bulle nomme ce qui manque.

Une fiche DÉJÀ dans le `.md` est toujours réécrite, même vidée : sans cela, effacer un champ
ne s'enregistrerait jamais et l'ancienne valeur reviendrait au rechargement. Une rubrique
vidée, à l'inverse, SORT du `.md` — un titre de rubrique sans rien dessous ne veut rien dire
dans le PDF.

Deux autres suppressions du même esprit : la note « Le texte du lien est composé
automatiquement… » et son pendant sur le titre des rubriques. Et une correction de fond du
même lot : le champ **Lien**, la zone d'image et l'état de la fiche vivaient HORS du corps
pliable, et restaient donc visibles sous un en-tête replié — l'accordéon ne repliait presque
rien. Tout est passé dans le corps.

### F17 — Le canton en liste fermée, imprimé en abréviation

Décision : « Canton = liste déroulante, par ordre alphabétique, nom complet + abréviation
entre parenthèses ; le rendu met juste l'abréviation. »

`lib/cantons.js` porte les 26 cantons et la Confédération (`CH` — la rubrique des
interventions relève aussi des objets fédéraux). Trois rôles séparés :

| ce qui | où | forme |
|---|---|---|
| s'affiche à la saisie | `optionsCanton()` | « Bâle-Campagne (BL) », rangé par nom |
| s'écrit dans le `.md` | attribut `canton` | `BL` |
| s'imprime | `szh-ressource.lua`, tel quel | `BL` |

C'est le CODE qui est stocké : deux caractères stables, identiques dans les deux langues, que
le filtre Lua n'a donc aucune table à traduire. Conséquence assumée sur le tri des
interventions (`CLE_TRI`) : elles se rangent par code, c'est-à-dire dans l'ordre officiel des
cantons, celui de tous les documents fédéraux. L'ordre alphabétique demandé ne vaut que pour
la SAISIE, où l'on cherche « Genève » et non « GE ». Une valeur inconnue de la liste — bloc
écrit à la main — est ajoutée à la liste plutôt que perdue.

Le formulaire est resté générique : `typesRessourceConfig()` peut joindre à un champ une
liste fermée (`options`) ou un mode de saisie (`saisie: 'date'`), et `media/documentation.js`
rend un `<select>` ou un `<input type="date">` sans connaître un seul nom de champ.

### F18 — L'agenda devient une fiche structurée

Décision : « Agenda et formation doit devenir un champ structuré (date / plage de date / type
d'événement, etc.) — parcours nos éléments dans cette rubrique et détermine les champs
pertinents. »

**Ce que l'enquête a trouvé** (02.09.2026, trois numéros contrôlés — Revue 16/02-2026,
Revue 15/02-2025, Zeitschrift 09/2025) : la rubrique IMPRIMÉE ne contient qu'un LIEN vers
`csps.ch` / `szh.ch`. Aucune entrée détaillée n'est publiée dans la revue. Les vraies entrées
vivent sur le site, et c'est son formulaire d'annonce — « Annoncer une formation continue ou
une manifestation » / « Kurse und Veranstaltungen melden », identique pour les cours et les
manifestations — qui donne la structure de référence : titre, début, fin, lieu, adresse de
contact, adresse Internet, plus un champ « Message » libre. Relevé sur 22 entrées réelles des
pages « Congrès, colloques » et « Kurse » : date unique 10 fois, plage contiguë 11 fois, une
formation modulaire de 22 mois une fois, aucune mention « sur demande ». N'existent nulle
part et n'ont donc pas de champ : prix, langue, public cible, nombre de places, délai
d'inscription, intervenant·e distinct de l'organisateur.

D'où `TYPES.agenda = { evenement, debut, fin, lieu, organisateur }`, plus les champs communs
(titre, descriptif, lien) — le descriptif tenant le rôle du champ « Message », où le site
lui-même précise en clair les dates disjointes d'une formation modulaire.

Deux mécaniques nouvelles, chacune tirée du corpus :

- **les dates sont stockées en ISO** (`SAISIE`), parce que c'est la seule forme qui se trie :
  l'agenda se range par date de début (`CLE_TRI`), donc dans l'ordre où les manifestations
  auront lieu. L'ISO ne sort jamais dans le PDF — `szh-ressource.lua` la remet en forme
  suisse et fond les deux dates en UNE mention, aussi compacte que le corpus l'écrit :
  `05.–06.01.2026` (même mois), `29.06.–02.07.2026` (même année), `10.09.2026–04.07.2028`
  (deux années), `08.09.2026` (un seul jour).
- **le type d'événement est un jeton**, jamais un libellé : `colloque`, `congres`, `journee`,
  `cours`, `webinaire`, `formation` (vocabulaire relevé dans le corpus). Le libellé de saisie
  vient de `lib/i18n.js`, le libellé imprimé de la table `EVENEMENTS` de
  `szh-ressource.lua` — un « Colloque » saisi côté français ressort « Tagung » côté allemand
  sans ressaisie, exactement comme le libellé de lien d'une fiche. Un test refuse que les
  jetons des deux tables divergent.

`agenda` a donc QUITTÉ `TYPES_RUBRIQUE` et la table `TITRES` de `szh-rubrique.lua`. Un ancien
bloc `::: {.szh-rubrique type="agenda"}` laissé dans un `.md` sort sans titre mais avec son
contenu intact : la dégradation propre du cas « type inconnu », déjà prévue.

### Invariants tenus

- i18n : chaque clé ajoutée existe en fr **et** en de, avec les mêmes repères `{0}` —
  `test/js/contrats.test.js` ; aucun eszett dans l'allemand.
- Typographie française : `python test/typo-check.py` — conforme sur les 42 surfaces.
- Tables recopiées : `lib/ressources.js` <-> `szh-ressource.lua` pour `TYPES` **et** pour la
  liste fermée `evenement` ; `lib/rubriques.js` <-> `szh-rubrique.lua`.
- Le formulaire est RÉELLEMENT EXÉCUTÉ en test (`test/js/webviews.test.js`, onze contrôles) :
  rendu replié, lien et image dans le corps pliable, pastilles, `<select>` du canton, valeur
  hors liste conservée, sommaire et ses comptes, accordéon exclusif, vidage d'une rubrique,
  fiche neuve ouverte d'office.
- Suite de tests : `node --test "test/js/*.test.js"` — 889 tests, 881 passent, 1 ignoré, et
  7 échecs PRÉEXISTANTS au lot (`reimport-biblio.test.js` ×6, `reimport.test.js` ×1),
  vérifiés sur un `git worktree` de HEAD le 01.09.2026.
