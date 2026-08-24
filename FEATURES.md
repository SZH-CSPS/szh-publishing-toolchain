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

`lireModeDeveloppeur()` vaut `true` par défaut et `Get-SzhBaseRevues` choisit sur cette base la
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
