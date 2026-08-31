# Planification — lot du 31 août 2026 (A1–A9, B1–B3, C1)

Lot demandé par Robin le 31.08.2026, en plus de ce qui reste dans
[docs/REPRISE-LIVRES.md](docs/REPRISE-LIVRES.md). Ce fichier est le pilotage : il dit dans
quel ordre les items sont pris, **pourquoi cet ordre**, et ce qui bloque quoi. Le protocole
et les contraintes transverses de [PLANIFICATION.md](PLANIFICATION.md) restent en vigueur
et s'appliquent à chaque lot ci-dessous.

La numérotation de Robin (A1, A7.2, B1, C1…) est conservée telle quelle : c'est la langue
commune de la discussion, la renuméroter ferait perdre le fil.

⚠ **Haiku est indisponible jusqu'au 01.09 09h** (limite hebdomadaire atteinte le 31.08 en
début de session). Les quatre premières enquêtes déléguées ont échoué sans rien rendre. Le
code délégué attend cette réouverture ; les décisions, elles, n'attendent pas.

---

## 1. Regroupement par surface, et non par numéro

L'ordre donné par Robin mélange des items qui ne touchent pas les mêmes fichiers. Les
regrouper par **surface partagée** est ce qui décide du parallélisme : deux agents sur un
même fichier produisent un conflit, deux agents sur deux surfaces disjointes ne se voient
pas.

| Groupe | Surface | Items |
|---|---|---|
| **G1 — Vue d'ensemble des articles** | `media/_fiches.{js,css}`, panneau hôte | A7, A7.1, A7.2, A7.3, A7.4, A7.5 |
| **G2 — Gestes du cockpit** | `extension.js`, `lib/panneaux.js` | A1, A3 |
| **G3 — Chaîne de rendu, sans décision** | filtres Lua, `print.css` | A4, A8, A9 |
| **G4 — Liens de références** | `szh-*.lua`, réglages, `print.css` | A2, A5, A6 |
| **G5 — Formulaires de saisie** | nouvelle webview sur patron médias | `buch.yaml` (REPRISE 2.1a), C1 |
| **G6 — Décisions et mesures** | aucun code | B1, B2, B3 |
| **G7 — Reste du chantier livres** | voir REPRISE-LIVRES | 2.2 (blanc de pied), 2.3, 2.4, 2.5 |

---

## 2. Ordre d'exécution proposé

Le principe : **ce qui n'a pas de réponse ne se code pas**, puis du plus confiné au plus
transverse, et on finit par ce qui ne se valide qu'à l'œil sur un vrai livre.

### Vague 0 — Décisions et mesures (aucun code) — *en cours*

Cinq des treize items dépendent d'une réponse qu'on n'a pas encore. Les coder avant serait
les coder deux fois.

- **A2** — comprendre comment le lien appel ↔ référence est réellement fabriqué. L'intuition
  de Robin (« c'est du Lua, il n'y a aucun markup dans le texte ») est très probablement
  juste : toute la numérotation et la liaison du projet se font à la compilation. À établir
  avant de juger si « Lier un appel à une référence » est cassé ou n'a simplement **jamais
  eu** le rôle qu'on lui prête. Bloque A5 et A6.
- **B1** — le préfixe numérique des dossiers d'articles est-il encore porteur ? Élément déjà
  au dossier : `lib/yaml.js:30-36` écrit noir sur blanc que l'ordre vit dans
  `ordre-articles` et que « déplacer un article ne doit renommer ni dossier ni `.md`, sans
  quoi tout `out/` serait à recompiler et les liens du numéro tomberaient ». Le numéro dans
  le nom de dossier **n'est donc déjà plus la source de vérité de l'ordre** — il est
  décoratif, et il ment dès le premier déplacement. Cela plaide pour l'avis de Robin. Reste
  à inventorier ce qui le lit encore (slugs, DOI, tri d'affichage, chemins `out/`, export
  OJS) avant de trancher.
- **B2** — existe-t-il une API edudoc.ch pour la liste des mots clés ? Recherche.
- **B3** — mesurer sur la Zeitschrift combien de mots clés et de caractères tiennent pour
  que **les deux résumés et les mots clés restent sur la première page**. Livrable : deux
  seuils chiffrés, à câbler ensuite en garde de formulaire.

### Vague 1 — G1 + G2 : la vue d'ensemble et les gestes (code confiné)

Le lot le plus sûr et le plus visible : aucun effet sur le rendu PDF. **Un seul agent,
séquentiel**, parce que A7 à A7.5 se marchent tous sur `media/_fiches.js`.

A7.4 et A7.5 sont la vraie correction du défaut de A7 : sortir les avertissements et le
compteur de tâches du corps de la carte règle la hauteur inégale des boutons, le
réordonnancement (Ouvrir, Monter, Descendre, puis le reste) finit le travail.

A1 et A3 suivent dans le même lot : même geste utilisateur, même code hôte. A1 hérite
directement de la **décision B** du lot d'août (« pas d'aperçu auto ») — c'est la même
mécanique `sansApercu`, étendue au clic sur l'édition de métadonnées et de médias, plus le
focus donné à l'article ou au chapitre.

### Vague 2 — G3 : la chaîne de rendu, ce qui ne demande pas d'arbitrage

A4, A8, A9. Impact réel : les quatre PDF du banc, la conformité PDF/UA-1, et des tests de
contrat qui figent du HTML **au octet** (posés au lot des grilles). A9 en particulier n'est
pas un déplacement CSS — il change l'ordre du HTML, donc l'ordre de lecture d'un lecteur
d'écran, donc l'arbre de structure du PDF.

Deux pièges à annoncer à l'agent :
- **A8** : trier des mots clés en Lua trie par octets — « École » partirait après « Zurich ».
  Il faut une collation FR/DE, et le tri est **par langue**, indépendamment d'une langue à
  l'autre (Robin l'a explicitement autorisé).
- **A9** : `<figcaption>` avant `<img>` est du HTML valide, mais les tests de contrat des
  grilles vont tomber. Ils doivent être **mis à jour sciemment**, pas contournés.

### Vague 3 — G4 : les liens de références, après réponse d'A2

A5 (flèche sur les liens de la liste des références + flèche retour vers la première
occurrence de l'appel) et A6 (réglage global « désactiver les liens des références »).
Robin a lui-même vu le conflit potentiel avec A2 : si le geste « Lier un appel à une
référence » écrit quelque chose dans le texte, un réglage qui coupe tous les liens doit
épargner ce quelque chose — c'est d'ailleurs ce que A6 demande déjà pour les liens posés à
la main.

### Vague 4 — G5 : les formulaires de saisie

`buch.yaml` **d'abord** : il est déjà cadré (REPRISE 2.1a), il comble un manque de parité
mesuré, et il sert de patron. C1 (livres et films de la Documentation) ensuite, sur le même
modèle — carte de saisie + gros bouton « ajouter » toujours visible, pensé pour enchaîner
plusieurs entrées.

C1 porte en plus une **demande d'analyse** : parcourir « News & Ressourcen » (Zeitschrift)
et « Actualité et ressources » (Revue) pour proposer d'autres sections méritant le même
traitement. Le but énoncé par Robin est de pouvoir **récupérer ces données
rétroactivement** — bibliothèque de livres, de films, d'interventions parlementaires. Cela
oriente la conception : ce que le formulaire écrit dans le `.md` doit être **relisible par
une machine**, donc un bloc structuré et non de la prose libre. C'est la même leçon que les
grilles d'images.

### Vague 5 — G7 : le reste du chantier livres

Dans l'ordre de REPRISE-LIVRES : blanc de pied FALC (2.2, à mesurer avant de toucher aux
`break-inside`), extraction `lib/medias.js` (2.3, à refaire à neuf), production des deux
livres (2.4), défauts connus (2.5).

---

## 3. Points à trancher avec Robin

1. **A3 est ambigu.** « Enregistrement des métadonnées ou des media relance la compilation
   de l'article » se lit dans les deux sens : un constat de défaut (ça relance, et ça ne
   devrait pas) ou une demande (ça doit relancer pour que l'aperçu soit à jour). L'un ajoute
   du code, l'autre en retire. À lever avant la vague 1.
2. **A2 et A6** : Robin a demandé à en discuter avant tout code. La vague 0 rapporte les
   faits ; la décision reste la sienne.
3. **B1** : retirer les numéros des dossiers est une opération de renommage sur des numéros
   déjà publiés. À décider en connaissance de ce qui le lit encore, et de ce qu'il faut
   recompiler.

## 4. Definition of Done

Celle de [PLANIFICATION.md](PLANIFICATION.md), inchangée : code et i18n FR/DE complets,
`node --test "test/js/*.test.js"` vert, vérification d'impact par un agent distinct, diff
relu par le chef d'orchestre, **aucun commit sans accord de Robin**. Pour tout item de G3 et
G4, ajouter : banc de rendu rejoué et verdict veraPDF lu sur l'**absence de FAIL**.

---

## 5. Vague 0 — constats

### A2 — établi le 31.08 (lecture du code, non encore vérifié à l'exécution)

L'intuition de Robin est juste sur le fond : **les liens appel ↔ référence sont fabriqués
par Lua à la compilation, en mémoire, et rien n'est jamais réécrit dans le `.md`**.
`pipeline/filters/szh-citations.lua` pose les ancres (`Div.szh-reference`, id
`ref-nom-annee`, l. 1011-1025) et les liens des appels (`lien()`, l. 876-880, classe
`szh-appel`, posés par `poser()`, l. 842-874).

Le geste manuel, lui, **écrit bel et bien dans le fichier** : `fmtLierReference()`
(`lib/formatting.js:540-603`) insère littéralement `[texte-de-l-appel](#id-de-la-référence)`,
un lien markdown ordinaire.

**Cause de la panne, trouvée.** `fmtLierReference()` n'appelle que
`citations.referencesDuTexte(doc.getText())`, qui cherche les entrées de bibliographie dans
le texte visible de l'article. Depuis que l'import détache la bibliographie dans
`<slug>.biblio.md`, le `.md` ne porte plus que le marqueur `::: {.szh-biblio src="…"}` : la
fonction ne trouve aucun titre reconnu, rend `[]`, et le geste s'arrête sur « Aucune liste
de références trouvée ». **Tout article au format courant est concerné** — le geste échoue
donc systématiquement, ce qui correspond exactement au symptôme.

Le repli manquant existe déjà ailleurs : `lib/export-ojs.js:409-421` essaie
`referencesDuFichier()` **d'abord** (il lit le `.biblio.md`) et ne retombe sur
`referencesDuTexte()` qu'à défaut. Le correctif est de reproduire ce repli. C'est petit, et
c'est de la réutilisation, pas du code neuf.

**Le cas d'usage du geste est légitime** : `apparier()` (l. 737-802) échoue dans deux cas —
aucun candidat (`appel-sans-reference`, l. 1237) ou plusieurs non départagés
(`appel-ambigu`, l. 1242). Le geste manuel est le rattrapage de ces deux cas, et non un
doublon du lien automatique.

### A6 — le conflit redouté n'existe pas

Les deux mécaniques ne partagent aucun support : l'automatique vit en mémoire le temps de la
compilation, le manuel vit en markdown dans le fichier source. Couper l'étape Lua désactive
tous les liens automatiques et **laisse intacts** les `[texte](#ref-id)` écrits à la main,
qui ne sont que du markdown. C'est mot pour mot le comportement demandé par A6 (« les liens
insérés à la main ne sont pas concernés »). Aucun arbitrage n'est nécessaire ; A6 peut être
codé sans attendre A2.

### A5 — un écart entre le constat et le code, à trancher sur un PDF réel

Robin constate que les hyperliens de la liste des références ne portent pas la flèche. La
lecture du code dit l'inverse : il n'existe **aucune** règle `.szh-reference a[href]` dans
`print.css`, ces liens tombent donc sous la règle générale `a[href]::after` (l. 91-94) et
devraient recevoir la flèche ; seuls `a.szh-appel` et les ancres internes sont exemptés
(l. 108). Deux hypothèses restent ouvertes : les liens observés sont des ancres internes, ou
un autre sélecteur les exempte. **À vérifier sur un PDF compilé avant d'écrire la moindre
ligne de A5.** La « flèche retour » vers la première occurrence de l'appel, elle, est un
ajout franc : elle demande que `poser()` retienne la position du premier appel de chaque
référence, information qu'il a déjà sous la main.

### B1 — le préfixe numérique des dossiers : inventaire du 31.08

**Ce que le préfixe ne fait pas**, contrairement à ce qu'on pourrait croire :
- L'affichage « 01 · », « 02 · » vient de l'**index dans `ordre-articles`**
  (`lib/articles.js:155-188`, `prefixeOrdre`/`libelleArticle`), jamais du nom de dossier.
- Le **DOI ne contient pas le slug** : `doiCalcule` (`lib/export-ojs.js:137-147`) le fabrique
  à partir d'année + numéro + rang, et `rangDoi` (`lib/articles.js:129-140`) lit la position
  dans `ordre-articles`. **Aucun DOI émis ne casserait.**
- Pas d'ordre de concaténation à casser pour une revue : chaque article compile
  séparément vers `out/<slug>/<slug>.pdf`. Pour un livre, c'est `ordre-chapitres` qui
  assemble.

**Ce que le préfixe fait encore, et c'est tout** : il sert de **repli de tri quand un article
n'est pas encore dans `ordre-articles`** (`extension.js:1554-1566`, tri `localeCompare`) —
un cas transitoire, à l'import. Le Makefile trie aussi lexicographiquement
(`pipeline/Makefile:116`), sans conséquence d'ordre.

**Où il est fabriqué** : `lib/slug.js:42-53` complète à deux chiffres le nombre de tête du
Word, explicitement « pour que le tri alphabétique fonctionne au-delà de 9 articles ». Règle
**dupliquée en shell** dans `pipeline/Makefile:480-525`, avec commentaire de synchronisation.
`livre-scinder.py:357-358` fait de même pour les chapitres.

**Constat qui tranche le débat de principe** : `test/articles/{contenu-long,figures,
lecteur-ecran}` n'ont **aucun préfixe**. La convention n'est donc pas universelle même ici.

**Avis du chef d'orchestre — retirer pour les nouveaux numéros, ne rien faire de rétroactif.**
Le seul trou à combler est le repli de tri : décider ce qui range un article pas encore
inscrit dans `ordre-articles` (ordre d'arrivée, ou alphabétique du titre). Le rétroactif,
lui, demande de renommer dossier + `.md` + `.meta.yaml`, réécrire `ordre-articles`,
recompiler tout `out/<slug>`, republier vers OJS, et corriger quatre fichiers de tests
(`articles`, `contrats`, `import`, `copies-conflit`) plus les deux règles dupliquées.
⚠ Sur un numéro **archivé**, `dois-calcules.yaml` ne se régénère plus (garde `archivee`,
`extension.js:3612`) : il resterait périmé sans script de migration dédié.

### B2 — mots clés edudoc : une porte ouverte, et c'est celle qu'on connaît déjà

**L'OAI-PMH d'edudoc.ch existe et répond, sans authentification** : `https://edudoc.ch/oai2d`
(`Identify`, `ListSets`, `ListRecords` vérifiés). Instance Invenio/TIND. **Les deux revues de
la maison y sont des sets dédiés** (« Revue suisse de pédagogie spécialisée » et
« Schweizerische Zeitschrift für Heilpädagogik »).

Le point de mécanique : `oai_dc` ne porte **aucun** champ sujet. Mais
`metadataPrefix=marcxml` expose le **champ MARC 690 en paires bilingues DE/FR**, une par
descripteur : `$a Sonderpädagogik / $b pédagogie spécialisée`,
`$a Sonderschulwesen / $b enseignement spécialisé`. C'est le thésaurus edudoc réel, tel
qu'appliqué article par article. Aucune liste exhaustive n'est publiée par ailleurs : elle
se **reconstitue par moissonnage et dédoublonnage**. Pas d'italien dans ce champ.

**Avis — moissonner les deux sets en marcxml.** Le projet sait déjà faire de l'OAI-PMH
(`lib/auteurs-ojs.js`, lot H) : c'est la même infrastructure, le même cache atomique, le même
rafraîchissement hebdomadaire silencieux. Et le vocabulaire obtenu est celui **réellement
utilisé sur nos articles**, déjà bilingue — pas un thésaurus théorique à mapper.

Plan B écarté : **TESE** (Eurydice) offre une API REST ouverte
(`https://vocabularyserver.com/eurydice/{fr|it|en|es|pt}/services.php`, FR et IT vérifiés en
direct), mais **l'allemand y est absent** (404 sur ce miroir) et l'export SKOS natif est
désactivé. Sans allemand, c'est inutilisable pour la Zeitschrift.

### B3 — seuils résumé et mots clés : chiffres obtenus, mais fondés sur la maquette seule

Budget **mesuré** dans `print.css` : `.szh-hero` 380 px (l. 189-196), filet 6 px (l. 295),
paddings de `.szh-cover-body` 30 + 40 px (l. 300), marge de 30 px entre les deux blocs
(l. 311-315) ; bas de la page 1 à 1044,5 px. Reste **558,5 px pour les deux résumés**, soit
environ **9 lignes chacun** (texte 14 px, interligne 1,55 → 21,7 px/ligne, socle.css l. 60-61 ;
colonne de 609,7 px).

**Seuils proposés : 600 caractères par résumé (espaces compris), 6 mots clés par langue.**
Ils gardent ~13 % de marge sous le plafond le plus pessimiste (691 caractères, à 95 car./ligne).

⚠ **Deux réserves qui interdisent de figer ces chiffres tels quels.**
1. **Aucun article publié de la Zeitschrift n'est dans le dépôt.** Les seuls résumés
   mesurables sont des fixtures de banc (84 à 251 caractères, médiane 164), volontairement
   courtes : elles ne représentent aucun contenu éditorial. L'estimation de 87 à 95
   caractères par ligne n'a **pas** été validée par un rendu WeasyPrint réel.
2. **Un vrai résumé académique fait 900 à 1200 caractères.** 600 est donc une contrainte
   éditoriale forte, pas un simple garde-fou technique. C'est une décision de Robin, non
   une conséquence du code : soit les résumés raccourcissent, soit la maquette de la page de
   titre doit céder de la place.

⚠ **Défaut trouvé au passage, non corrigé** : le commentaire de
`templates/szh-article.html:71` affirme que `.szh-cover` porte un `break-after: page`.
**Cette règle est absente de `print.css`** (recherche négative). Rien ne force donc le corps
de l'article sur la page 2. Un commentaire qui décrit une règle qui n'existe pas : la même
famille d'échec muet que le projet traque ailleurs.

---

## 6. Décisions de Robin, 31.08

| Item | Décision |
|---|---|
| **A3** | C'est la **fonctionnalité voulue** : l'enregistrement d'une fiche ou d'un média relance la compilation. |
| **A2** | Feu vert : corriger le repli `referencesDuFichier()` manquant. |
| **A6** | Le geste manuel « Lier un appel à une référence » **reste disponible** quand le réglage coupe les liens automatiques. |
| **B1** | Retrait des préfixes numériques pour les **nouveaux numéros seulement**. Aucun rétroactif. |
| **B2** | Feu vert : moissonnage edudoc en marcxml, **sur le modèle du lot H**. |
| **B3** | **Mesurer sur un vrai article de la Zeitschrift** avant de figer un seuil. En attente d'un fichier de Robin. |

## 7. Vague 1 et 2 — code livré, non commité

### Environnement : Node.js installé le 31.08

`node` était **absent du poste** (PATH Windows, PATH PowerShell, quatre distributions WSL).
Installé sur décision de Robin : **Node.js LTS 24.19.0**, via
`winget install OpenJS.NodeJS.LTS`. La suite s'exécute désormais depuis la racine.

⚠ Note de méthode, à l'usage des sessions suivantes : `node` n'est **pas** visible depuis Git
Bash ni depuis une session PowerShell ouverte avant l'installation. Rafraîchir le PATH :
`$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
[System.Environment]::GetEnvironmentVariable("Path","User")`.

⚠ Note de méthode, plus importante : le chef d'orchestre a accusé à tort un agent d'avoir
fabriqué son résultat de tests, faute d'avoir trouvé `node` sur le poste. La suite, exécutée
après installation, a rendu **615 tests, 614 pass, 0 fail, 1 skip** — exactement le chiffre
rapporté. L'agent était fiable ; la vérification était en défaut. **Un outil qu'on ne trouve
pas n'est pas la preuve qu'un résultat est faux.**

### G3 — A4, A8, A9 (chaîne de rendu)

- **A4** : cause côté CSS, non côté Lua. `.szh-abstract-label` portait un
  `text-transform: uppercase` (`print.css`) ; retiré. Les libellés étaient déjà correctement
  casés dans `szh-maquette.lua` (`LABELS_RESUME`). ⚠ Le `letter-spacing: 0.14em` a été laissé
  en place : il avait été réglé pour des capitales et peut paraître lâche en casse mixte —
  **à juger à l'œil sur un PDF**.
- **A8** : tri ajouté dans `szh-maquette.lua`, une fois par langue, donc déjà indépendant
  entre fr/de/it comme Robin l'autorisait. Collation par table `PLIAGE_ACCENTS` (à/â/ä→a,
  é/è/ê/ë→e, ö→o, ü→u, ç→c, œ/æ, ß→ss), clé pliée puis `table.sort`, repli sur la chaîne
  d'origine à égalité. Vérifié en compilation réelle : les deux pièges annoncés
  (École/Zurich, Ökonomie/Zürich) sont fermés. Aucune dépendance ajoutée.
- **A9 — le vrai défaut n'était pas celui qu'on croyait.** Le filtre
  `szh-legende-avant.lua` **existait déjà**, câblé dans le Makefile pour les deux chaînes et
  dans `livre.mk` — et **n'a jamais rien fait**. Sa garde s'écrivait
  `if not FORMAT:match('^(html|epub)') then return {} end` : les motifs Lua **ne connaissent
  pas l'alternance `|`**, le motif ne correspondait donc jamais, `not` était toujours vrai, et
  le filtre se désactivait pour tous les formats depuis toujours. Corrigé en deux tests
  séparés. Vérifié : les figures numérotées portent désormais `<figcaption>` avant `<img>`,
  le cas crédit-seul restant après, comme prévu.
  L'avertissement du chef d'orchestre sur les tests de contrat des grilles était **infondé** :
  recherche exhaustive faite, aucun test ne figeait l'ancien ordre. Le corpus documentait
  l'ordre correct sans jamais l'obtenir.

⚠⚠ **Effet de bord à vérifier avant de clore A9.** La correction réactive le filtre pour les
**livres** (`livre.mk`), où il était tout aussi inopérant. `livre-normal` et `livre-falc`
portent de vraies figures : leurs légendes passent au-dessus de l'image **pour la première
fois**. La maquette FALC venait d'être alignée à 47 pages contre 46 à l'original, au prix
d'un travail de mesure long (voir REPRISE-LIVRES 2.2). Banc de rendu et `figures-check.py`
restent verts, PDF/UA-1 conforme sur les 4 PDF plus les livres, mais **la pagination peut
avoir bougé** : re-mesure lancée.

⚠ Encore un commentaire menteur : `livre.mk` affirme que le filtre « s'applique DÉSORMAIS » à
l'epub3. C'était faux jusqu'à cette correction. Signalé, non touché.

### G1 — A7 à A7.5 (vue d'ensemble des articles)

⚠ **Le périmètre annoncé par le chef d'orchestre était faux.** J'avais désigné
`media/_fiches.js` ; les symptômes décrits par Robin (« Pas de DOI », « 01 · Titre », tâches
cochables, Monter/Descendre) appartiennent tous à la webview **« Articles »**
(`media/articles.js`, hôte `chargeArticles()`). L'agent l'a établi en partant des libellés
exacts et a implémenté au bon endroit plutôt que de produire des changements sans effet
visible. **Bon réflexe : le brief était à corriger, pas à suivre.**

**A7.3 était déjà implémenté** — bouton `#traductions` dans la barre du haut de
`_fiches.js`/`metadata-articles.html`. À confirmer avec Robin que c'est bien la vue qu'il
visait.

Fichiers touchés : `extension.js` (`chargeArticles`, `pastillesCarte` allégée, nouvelle
`resumeTachesLigne`, `meta: slug` retiré comme redondant, `actions` réordonnées),
`lib/i18n.js` (`art.taches.entete` — « À faire » / « Zu erledigen »), `media/_commun.js`
(`listeCartes`), `media/articles.js` (`decorerTete`), `media/_design.css`, `_liste.css`,
`articles.css`, plus `test/js/articles.test.js` et `carte-article.test.js` (5 tests ajoutés).

Points tranchés : le **slug** passe en infobulle du titre (`title` HTML) au lieu d'être
affiché en clair ; le « 01 · » vient de `prefixeOrdre(index)` calculé sur `ordre-articles`,
**indépendant du nom de dossier** — ce qui confirme au passage l'inventaire B1.

**Suite : 615 tests, 614 pass, 0 fail, 1 skip** (skip préexistant, sans rapport), vérifié par
le chef d'orchestre. Départ : 610. **Vérification d'impact indépendante en cours**, portant en
priorité sur `media/_commun.js`, surface partagée entre webviews.

### G1 — vérification d'impact : **livrable en l'état**

Faite par un agent distinct, qui a commencé par **vérifier lui-même** la disponibilité de Node
plutôt que de croire le chef d'orchestre — et a exécuté la suite pour de bon : **615 / 614
pass / 0 fail / 1 skip** sur l'ensemble, **51/51** sur `articles.test.js` +
`carte-article.test.js`, les cinq tests neufs listés nommément.

**Aucun bloquant.**

**Le risque n°1 est écarté par vérification, non par confiance** : `SZH.listeCartes`
(`media/_commun.js:685`) n'a que deux appelants, `articles.js` et `vue-ensemble.js`. Or
`vue-ensemble.js` (Traductions, Word en attente) ne renseigne jamais `l.taches` et n'appelle
jamais `majPastilles` ; la signature à trois arguments (`_commun.js:734`, `tachesResume`
optionnel, gardé par `!== undefined`) ne l'affecte donc pas. `medias-article.js` et
`_numero.js` ont leurs propres `majPastilles` locales, indépendantes.

**Deux retouches demandées, faites dans un lot séparé :**
1. `.szh-bouton` a reçu `white-space: nowrap; flex-shrink: 0` dans `media/_design.css:227`.
   Le comportement est voulu, mais **cette classe sert toutes les webviews** : un bouton ne
   peut plus se comprimer nulle part. Trois conteneurs flex de boutons n'ont pas de
   `flex-wrap` et peuvent déborder sur fenêtre étroite — `articles.css:106` (`.taches-pied`),
   `_auteurs.css:92` (`.boutons-modale`), `_auteurs.css:37` (`.auteur-boutons`). Corrigé côté
   conteneurs ; le `nowrap` global reste.
2. `test/js/articles.test.js:274,280` — le fixture envoyait encore `meta: '01-a'`, champ que
   l'hôte ne pose plus et que `decorerTete` efface en silence. Retiré, pour ne pas laisser
   croire que le cas est couvert.

**A7.3 confirmé déjà implémenté avant ce lot** : `metadata-articles.html:5` porte le bouton
global `#traductions` dans `.szh-barre`, câblé par `metadata-articles.js:39` sur
`_fiches.js:601-615` (`traductionsVisibles`). ⚠ À confirmer avec Robin que c'est bien la vue
qu'il visait.

Contrôles de conformité passés : aucun `innerHTML` introduit, aucune dépendance npm
(`git diff` vide sur les `package.json`), clé `art.taches.entete` présente en FR
(`lib/i18n.js:309`) **et** en DE (`lib/i18n.js:1273`).

### A2 — correctif livré

`fmtLierReference()` (`lib/formatting.js`, ~540-566) calcule le slug une fois, puis essaie
`citations.referencesDuFichier(racine, slug)` — le `<slug>.biblio.md` détaché — et ne retombe
sur `citations.referencesDuTexte(doc.getText())` que si ce fichier n'existe pas
(`referencesDuFichier` rend `null`). C'est le repli éprouvé de `lecteurReferences()`
(`lib/export-ojs.js`), réutilisé tel quel : **aucun second lecteur de bibliographie n'a été
écrit**. Le reste du geste — QuickPick, `lienVersReference`, pannes `absent`/`discordant` —
est inchangé. Aucune clé i18n nécessaire : le correctif ne change aucun texte visible.

Test dans un fichier neuf, `test/js/lier-reference.test.js` — et non dans `ancrages.test.js`,
parce que `hote-factice.js` n'admet qu'un seul `activerHote()` par processus. Il pose un
article à bibliographie détachée, joue `szh.lierReference` sur un appel `(Dupont, 2024)` et
vérifie les deux entrées proposées et le lien écrit. **Vérifié dans les deux sens : il échoue
sans le correctif, il passe avec.** C'est ce qui en fait une preuve et non une décoration.

Suite : **616 tests, 615 pass, 0 fail, 1 skip**.

---

## 8. Incident de déploiement — le toolkit de production avait 10 commits de retard

Découvert en re-mesurant la pagination FALC : toute recompilation fraîche du livre B329
sortait à **62 pages** au lieu des 47 archivées le 30.08. La cause n'était pas le lot en
cours, mais le toolkit déployé.

**Mesuré**, dépôt (`v2026.08.66`) contre `C:\ProgramData\SZH\toolkit` (`2026.08.63`) :

- **Deux filtres du dépôt absents du toolkit** : `szh-sauts-uniques.lua` et
  `szh-attributs-sains.lua` — précisément les deux correctifs qui avaient fait passer le
  livre FALC de 64 à 49 pages. Leur absence explique le 62 à elle seule.
- **Huit fichiers présents des deux côtés mais différents** : `szh-grille.lua`,
  `szh-legende-avant.lua`, `szh-listes-serrees.lua`, `szh-maquette.lua`, `profils/livre.mk`,
  `styles/livre/base.css`, `styles/livre/falc.css`, `styles/print.css`.
  ⚠ **Tout le travail d'alignement de la maquette FALC du 30.08 n'avait donc jamais atteint
  la production.**
- **Neuf fichiers supprimés du dépôt qui survivent dans le toolkit** :
  `filters/szh-import.lua`, `filters/szh-tabelle-extraire.lua`,
  `filters/szh-tabelle-platzhalter.lua`, `rapport.py`, plus cinq dans `attic/`.

Les tags `v2026.08.64`, `.65` et `.66` **sont poussés sur le distant** : la chaîne de release
est intacte, c'est la mise à jour du poste qui n'avait jamais été lancée depuis le 30.08.
(Non confirmé : que les releases soient effectivement publiées — `gh` n'est pas authentifié
sur ce poste.)

**Décidé par Robin** : mise à jour immédiate en `.66`, pour débloquer la production des
livres (REPRISE 2.4) sans attendre le lot en cours. Lancée par
`powershell.exe -ExecutionPolicy Bypass -File windows\update.ps1` — en PowerShell **5.1**,
pour lequel le script est écrit, et non en 7.
⚠ Le toolkit `.66` porte encore `szh-legende-avant.lua` **avec le bug de l'alternance `|`** :
le correctif A9 n'atteindra la production qu'à la version suivante.

**Analyse déléguée en parallèle** : `update.ps1` synchronise-t-il vraiment, ou empile-t-il ?
Si des fichiers morts survivent à chaque mise à jour, c'est un défaut du déploiement et non
un accident de ce poste.

**Vérifié par le chef d'orchestre après mise à jour** : le livre B329 recompilé de zéro avec
le toolkit `.66` sort à **47 pages** (contre 62 avant), **0** occurrence de `<br/><br/>` dans
le HTML intermédiaire, et PDF/UA-1 **conforme** — `isCompliant="true"`, 106 règles passées /
0 échouée, 88 836 contrôles / 0 échoué, `jobEndStatus="normal"` : un vrai verdict et non une
absence de verdict. **La production des livres est rétablie.**

⚠ **Défaut d'images confirmé et chiffré** : `liminaires/media/` vide, aucun
`chapitres/*/media/`, sept fichiers introuvables (`fig-01` à `fig-07`), dont `fig-02.svg`
réutilisé dans **huit** chapitres. Sept `ERROR: Failed to load image` de WeasyPrint, sans
échec du build. Diagnostic délégué — l'axe retenu : le nom
`2025-prospectrumfalc-fr-vf-fig-0N.png` est fabriqué par l'import (slug du Word + compteur),
donc **l'import a su nommer les images et écrire les références sans que les fichiers
arrivent**. Encore un échec muet, à confirmer.

### G2 — A1 et A3 (gestes du cockpit)

- **A1** : `focaliserUnite(fournisseur, slug)` ajoutée dans `extension.js`, juste après
  `reselectionnerArticle`. Elle reprend le suivi d'arbre de `ouvrirArticle` (déplie les
  assets, ouvre la section « Articles »/« Chapitres », resélectionne par
  `reveal({select:true, focus:false})`) **sans ouvrir ni le `.md` ni l'aperçu**. Appelée en
  tête de `ouvrirMetadonneesArticle` et `ouvrirGestionMedias`, avant leur
  `fermerTousLesApercus()` déjà présent.
- **A3 — la moitié du travail n'était pas à faire, et c'est le bon constat.** Pour les
  **médias**, rien n'a été ajouté : `vscodium-user/settings.json` déclare déjà
  `triggerTaskOnSave.tasks` sur `**/*.md`, et les médias écrivent le `.md` via `doc.save()` —
  ils étaient donc **déjà recompilés**. Un second appel aurait lancé la même tâche deux fois
  en parallèle. Les **métadonnées**, elles, écrivent `.meta.yaml`, **hors de ce filtre** :
  c'est là qu'était le vrai manque, et c'est là qu'il a été comblé (`ecrireCartesArticles`
  rend `res.ecrits`, et `relancerCompilationCartes` recompile chaque slug réellement écrit,
  aux deux points d'enregistrement de `ouvrirApercuMetadonnees`).
- **Un seul chemin de compilation, comme exigé** : `compilerPuisAfficher`/`relancerCompilation`
  gagnent `opts.sansAffichage` ; la compilation passe par `lancerBuild()` sous la garde
  `buildEnCours` inchangée, et s'arrête après le succès, avant tout `ouvrirApercuHtml`/
  `ouvrirApercuPdf`. Aucun second déclencheur créé.
- **Garde anti-vol de focus vérifiée** : `sansAffichage` retourne **avant** tout code touchant
  `panneauApercuHtml` ou une webview — il n'y a donc rien à différer sur ce chemin. Le test
  le prouve par témoin : avec le drapeau, un aperçu déjà ouvert n'est ni recréé ni réassigné
  (nonce inchangé) ; sans lui, le nonce change.
- **Les deux profils testés** : revue (`01-essai`) et livre (`livreDEssai`, chapitres
  `01-ouverture`/`02-suite`) — focus et fermeture d'aperçu identiques.

Fichiers : `extension.js`, `test/js/hote-factice.js` (extension **additive** :
`executeTask`/`finirTache` partagent désormais la même `TaskExecution`),
`test/js/focus-recompilation.test.js`, `focus-recompilation-livre.test.js`. 10 tests ajoutés.
`lib/panneaux.js` et `lib/i18n.js` non touchés — aucun texte visible nouveau.

### B2 — module de moissonnage des mots clés edudoc

Fichier neuf `lib/mots-cles-edudoc.js` + `test/js/mots-cles-edudoc.test.js`, plus une entrée
dans `vscodium-extension/szh-cockpit/README.md` pour satisfaire le contrat déjà testé par
`contrats.test.js` (« le README cite tous ses modules »).

**Sets relevés** sur `https://edudoc.ch/oai2d`, identifiants exacts, espaces compris :
`Revue suisse de pédagogie spécialisée` et `Schweizerische Zeitschrift für Heilpädagogik`.

**Deux découvertes de terrain, que l'enquête préalable n'avait pas vues :**
1. **edudoc namespace tout son MARC** (`<marc:record><marc:datafield tag="690">
   <marc:subfield code="a">`), contrairement au marcxml d'OJS qui ne l'est pas. Les
   expressions du module tolèrent donc un préfixe `(?:[\w.-]+:)?` — sans quoi elles ne
   matcheraient **rien** sur les vraies réponses. Corollaire heureux : pas de collision sur la
   balise `<record>`, celle d'OAI étant nue et le MARC préfixé.
2. **Repli 503 constaté en direct** : après quelques requêtes rapprochées, l'instance répond
   `503 Retry after 1 seconds` puis se rétablit seule (pare-feu applicatif, la CSP cite
   `awswaf.com`). `lib/auteurs-ojs.js` n'a pas cette tolérance, le cas ne s'étant jamais
   présenté côté OJS. `recupererAvecRepli` (3 essais, délais croissants, réglables en test) a
   donc été ajouté **dans le nouveau module**, au-dessus de `recupererHttps` réutilisé tel
   quel.

**Réutilisation stricte** : `recupererHttps`, `erreurOai`, `extraireResumptionToken`,
`decoderTexteXml` et `plierNom` sont exportés par `auteurs-ojs.js` et importés tels quels.
Seuls sont neufs l'extraction du champ 690, la fusion des descripteurs, la pagination par
`set=` et le repli 503. **Piste notée** : un module OAI-PMH commun (client, parseur, repli)
serait plus propre — le repli 503 servirait probablement aussi aux auteurs.

**Cache** : `C:\ProgramData\SZH\mots-cles.json`, forme
`{ dateFetch, motsCles: [{de, fr, manque}] }` avec `manque` ∈ {`'de'`, `'fr'`, `null`},
écriture atomique, chemin surchargeable en test par `SZH_MOTS_CLES_CACHE`.

**Moissonnage réel, une fois, hors tests** : 456 notices (Revue) + 2385 (Zeitschrift) = 2841
notices, **10 975 paires 690 brutes**, **925 descripteurs distincts** après dédoublonnage
casse/accents. **10 paires incomplètes** rencontrées (2 sans allemand, 8 sans français) — la
tolérance n'était donc pas théorique. Échantillon : `Sonderschulwesen / enseignement
spécialisé`, `Schulische Integration / intégration scolaire`, `Schulangst / phobie scolaire`,
`Lehreraustausch / échange d'enseignants`, `Didaktik / didactique`.

**925 descripteurs bilingues : le vocabulaire est exploitable pour une autocomplétion.**
32 tests neufs, **aucun accès réseau dans les tests**.

**Suite après B2 et G2 : 658 tests, 657 pass, 0 fail, 1 skip** — confirmé par le chef
d'orchestre. Le compte se recoupe : 615 + 1 (A2) + 32 (edudoc) + 10 (G2) = 658.

### A6 — réglage « désactiver les liens des références »

**Le véhicule, et pourquoi celui-là.** Deux candidats écartés avec raison : `dois-calcules.yaml`
est un fichier **dérivé et par-numéro**, alors que la demande est « une option globale, au
niveau de l'app » ; et les variables du Makefile ne passent pas, parce que **le cockpit lance
`wsl.exe` sans `WSLENV`** — rien de l'environnement Windows ne traverse la frontière. Ce
constat vaut d'être retenu pour tout futur réglage devant atteindre la chaîne.

Retenu : `CONFIG_POSTE` (`C:\ProgramData\SZH\config.json`), que `szh-citations.lua` lit
**déjà** par `lire_config_poste()` pour le titre de bibliographie. Fichier de poste, monté
depuis WSL comme depuis VSCodium : le bon support pour un réglage d'application.
`lib/citations.js::configAvecLiensDesactives(cfg, desactiver)` est une fonction pure calquée
sur `configAvecTitresBiblio` ; l'écriture est branchée sur `msg.cle === 'liensReferences'` et
la valeur part **à la fois** dans le réglage VSCodium `szh.desactiverLiensReferences`
(palette, panneau) et dans `config.json` — seul ce dernier étant lu par la compilation.

**Le point subtil des ancres, traité comme il fallait.** L'étape qui pose le `Div` ancré
(`id=ref-nom-annee`) reste **inconditionnelle** : elle n'a pas été touchée. Seule la pose du
`Link` sur un appel apparié passe sous `if not LIENS_DESACTIVES`. Et l'appariement
(`appelees[id] = true`) reste inconditionnel, si bien que le bilan et les constats
`appel-sans-reference`, `appel-ambigu` et `reference-orpheline` fonctionnent à l'identique.
Conséquence voulue : **un lien manuel `[…](#ref-dupont-2024)` continue de trouver son ancre**,
la bibliographie s'imprime, et seul le `<a>` automatique disparaît.

**Preuve par compilation, dans les deux états** (article de banc temporaire, retiré après
usage, portant un appel automatique et un lien manuel vers la même entrée) :
- réglage inactif → `<a href="#ref-dupont-2024" class="szh-appel">(2024)</a>` posé, lien
  manuel et ancre présents ;
- réglage actif → `Dupont et Martin (2024)` en **prose nue**, aucun `<a class="szh-appel">`,
  **lien manuel et ancre intacts**, texte de la référence imprimé, et bilan
  `[citations-info]` identique dans les deux journaux (« 1 référence(s), 1 appel(s) :
  1 lié(s) ») ;
- veraPDF `--flavour ua1` conforme dans les deux cas, `grep -c 'status="FAIL"'` = **0** sur
  les deux XML.

Fichiers : `pipeline/filters/szh-citations.lua`, `extension.js`, `lib/citations.js`,
`lib/i18n.js`, `media/settings.js`, `package.json`, `package.nls.json`,
`package.nls.de.json`, `test/js/contrats.test.js`, `test/js/biblio.test.js`.

**Suite : 660 tests, 659 pass, 0 fail, 1 skip.**

⚠ **A5 reste en attente de Robin** : il faut constater sur un PDF compilé si les liens de la
liste des références portent ou non la flèche, le code disant qu'ils devraient. La « flèche
retour » vers la première occurrence de l'appel, elle, demandera que `poser()` retienne cette
position — information qu'il a déjà sous la main.

---

## 9. Correctif `livre-scinder.py` — l'échec muet et la destruction

Décidé par Robin le 31.08 après le diagnostic des images du B329 (voir REPRISE-LIVRES 2.2).

**Volet 1 — échec franc ET conservation de la source, les deux.** L'agent a d'abord établi
**qui appelle ce script : personne.** Ni `pipeline/Makefile`, ni `pipeline/profils/livre.mk`,
ni le cockpit. Il s'invoque à la main, et aucun lanceur ne teste son code de sortie — sortir
non nul ne peut donc rien casser, et c'est le seul signal qu'un humain ne peut pas ignorer.
Les deux leviers sont posés : **toute ressource manquante interdit le `shutil.rmtree()`** du
dossier d'origine, **et** `main()` sort en `sys.exit(1)` en fin de parcours, même sans
exception. Le dossier en double qui en résulte (ancien plus nouveaux chapitres) est un défaut
**visible** et nommé dans le constat — infiniment préférable à un effacement silencieux.

**Le constat suit la forme déjà en usage** dans `docx-meta.py`, `docx-tables.py` et
`reimporter.py` : `avertir(code, champs, fr, de)`, préfixe `[scission-avertissement]`, écrit
sur stderr **et** dans `SZH_IMPORT_LOG` s'il est posé. Six codes : `image-introuvable`,
`tableau-introuvable`, `source-non-supprimee`, `liminaire-media-introuvable`,
`liminaire-texte-non-repris`, `liminaire-texte-media-introuvable`.

**Volet 2 — `liminaires/media/` enfin alimenté.** `copier_medias_references()` parcourt
chaque `liminaires/*.md` **existant**, cherche ce qu'il cite et le copie depuis le `media/` du
chapitre en cours de scission — même mécanisme que pour les sections. Un manque ici ne bloque
pas la suppression, et le raisonnement est juste : un liminaire peut citer l'image d'un tout
autre chapitre déjà scindé, sans rapport avec la scission en cours. Le manque se dit
(`liminaire-media-introuvable`) sans nuire aux scissions suivantes.

**Et la décision sur `liminaire_texte` est la bonne.** Il n'est **pas** écrit dans
`liminaires/` : ce serait contraire à `pipeline/profils/livre.mk:88` (« pièces liminaires
écrites à la main », donc relues) et ferait passer un texte non revu pour une pièce
éditoriale. Il est sauvé dans `chapitres/_scission-<slug>-liminaire-non-repris.md` — ignoré
par `TOUS_CHAPITRES`, vérifié —, ses images sont récupérées, et le fait est dit
(`liminaire-texte-non-repris`). **Rien n'est perdu, rien n'usurpe une décision éditoriale, et
le silence a disparu.**

**Tests, avec une distinction honnête entre ce qui est prouvé et ce qui ne l'est pas.** Aucune
suite Python n'existait pour ce script (`test/*.py` sont des vérificateurs de rendu, pas des
tests unitaires) ; la convention de `test/js/reimport.test.js`, qui exécute réellement un
script Python, a été suivie. Quatre tests dans `test/js/livre-scinder.test.js` : le scénario
B329 (image absente → **source préservée**, `exit 1`, constat visible), le cas nominal
(`exit 0`, source supprimée), la symétrie des liminaires, le sauvetage du texte de tête.
⚠ `test/build-render.sh` passe (aucun `FAIL`, `livre-normal` et `livre-falc` PDF/UA-1
conformes) **mais n'invoque jamais `livre-scinder.py`** : le banc prouve l'absence de
régression sur la chaîne de build, **pas** l'exercice du correctif. D'où les tests dédiés,
plus une inspection directe sur disque d'une fixture jetable.

**Suite : 664 tests, 663 pass, 0 fail, 1 skip.**

⚠ **Manque révélé par ce lot, consigné dans REPRISE-LIVRES 2.4** : puisque
`livre-scinder.py` n'est branché à rien, l'exigence « produire le livre allemand par le
lanceur et l'interface, pas à la main » **n'est pas tenable** sans brancher d'abord la
scission. Lot à part entière, à décider avant de lancer ce livre.

---

## 10. B1 — ⚠ ÉTAT INCOMPLET, NON COMMITTABLE EN L'ÉTAT

**Fait, dans le périmètre :**
- `lib/slug.js` : `slugifierArticle()` ne complète plus à deux chiffres mais **retire** le
  numéro de tête (« 4_Titre » → `titre`). Nouvelle fonction exportée
  `numeroOrdreArticle(nomFichier)` qui **capte** ce nombre avant qu'il ne disparaisse (`null`
  si le nom n'en porte pas).
- `pipeline/Makefile` (règle dupliquée, ~l. 457-467 et 524-528) : le `sed` de complément est
  remplacé par `sed -E 's/^[0-9]+-//'`, JS et shell restant synchronisés (commentaire de
  synchronisation conservé, ~l. 484).

**⚠ CE QUI MANQUE, ET C'EST CE QUI DÉCIDE DE TOUT.** Le numéro **ne migre pas** encore vers
`ordre-articles` : l'outil de capture existe, **rien ne l'appelle**. Dans l'arbre de travail
actuel, un import retire donc le préfixe **et** retombe sur le repli alphabétique de
`_sousDossiersAvecMd` (`extension.js:1566-1578`) — **l'ordre du rédacteur se perd en
silence**, précisément le défaut que la conception devait empêcher. **Ne pas committer B1 sans
le câblage ci-dessous.**

**Câblage à faire** (hors périmètre de l'agent, `extension.js` étant occupé par le lot
`buch.yaml`) :
1. **`extension.js:2595-2610`, `lancerConversion`** : ⚠ **avant** `lancerTache(NOM_TACHE_IMPORT)`
   (l. 2601), lire `fournisseur._docxEnAttente(...)` (comme l. 4012) et appeler
   `numeroOrdreArticle` sur chaque nom — **`make import` supprime les `.docx`**, après quoi le
   nombre est définitivement perdu. Puis, après le calcul de `nouveaux` (l. 2608-2610), trier
   ces slugs par le nombre capté et écrire la clé par
   `ecrireClesAusgabe(racine, { [cleOrdre()]: ... })`, le mécanisme que `deplacerUnite` utilise
   déjà (l. 4851-4855).
2. **`extension.js:1450`** : commentaire devenu faux (« 4_Titre.docx → 04-titre »), à corriger.

⚠ **Second trou, structurel** : un import lancé **en CLI pur** (`make import`, sans le
cockpit) n'écrit `ordre-articles` nulle part — rien dans le pipeline ne le fait. Le câblage
cockpit ne le couvrira pas. À trancher : soit le pipeline écrit lui aussi l'ordre initial,
soit l'import CLI est déclaré non supporté pour un numéro neuf.

**Tests mis à jour sciemment** : `contrats.test.js:170-176` (`04-titre`/`10-…` →
`titre`/`actualite-et-ressources`), `import.test.js:56-62` (mêmes fixtures).
`copies-conflit.test.js:94` **non modifié** à juste titre — `'01-exemple.md'` n'appelle pas
`slugifierArticle`, et les dossiers préfixés existants restent valides puisque le retrait
n'est pas rétroactif.

⚠ **Nuance sur le test « ordre du rédacteur »** ajouté par l'agent : il est vert, mais il
éprouve `numeroOrdreArticle` **et un tri**, non le chemin réel de l'import. Il prouve que
l'outil fonctionne, **pas** que le chemin est branché. À ne pas lire comme une garantie tant
que le câblage n'existe pas.

**Résultat partiel** (suite complète non relancée, `buch.yaml` modifiant `extension.js`,
`media/` et `lib/yaml.js` au même moment) :
`node --test test/js/import.test.js test/js/contrats.test.js test/js/copies-conflit.test.js`
→ **96 tests, 96 pass, 0 fail, 0 skipped**.
