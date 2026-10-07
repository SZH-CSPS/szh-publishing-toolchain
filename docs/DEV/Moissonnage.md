# Moissonnage : des moissonneurs indépendants, une seule file de propositions

Proposition du 02.10.2026, rien d'implémenté côté Pronto. Elle part de
[Parsers.md](Parsers.md) (le moissonneur de recherches), du brief de `szh-harvest-parlement`
et de [Categories.md](Categories.md). Les décisions de Robin du 02.10.2026 sont reportées au
§9 ; l'interface est décrite au §11.

## 1. Le principe

Un moissonneur ne fabrique jamais de fiche. Il dépose des **propositions** dans un format
unique ; le cockpit les montre, la rédaction les accepte ou les refuse, et seul le cockpit
écrit la fiche, par `lib/kirby-contenu.js`.

```
 szh-harvest-research ──┐                      _NewsUndActu\_Moissons\          Documentation, vue « Propositions »
 szh-harvest-parlement ─┼─► propositions ─────► <moissonneur>\<lot>.jsonl ─────► un onglet par type de fiche
 (demain : agenda, ISBN)┘   (format §3)         _Decisions\<empreinte>.txt        accepter ─► kirby-contenu.js ─► Fiches\<type>\<slug>\
                              ▲                                                  refuser  ─► décision écrite
                              └──────────── le moissonneur relit les décisions ◄─┘
```

Trois raisons :
- **Un seul écrivain de fiches.** Aujourd'hui `harvest/kirby.py` recopie en Python `ecrireTxt`
  et `slugFicheUnique`, avec l'ordre des champs en dur ; le brief parlementaire prévoyait un
  deuxième `export_kirby.py`. Ce serait trois moteurs pour une seule fonction (CLAUDE.md §3).
- **Rien de non validé dans `Fiches\`.** Cette bibliothèque part telle quelle vers le site ;
  une proposition n'a rien à y faire tant qu'une personne ne l'a pas acceptée.
- **Le moissonnage et le tri se séparent.** On moissonne sur un seul poste, en WSL. On trie sur
  n'importe quel poste, sans Python et sans le dépôt du moissonneur : les propositions sont
  sur SharePoint.

## 2. Ce qui rend un moissonneur atomique

- **Un dépôt, une base, des tests à lui.** Pronto n'importe jamais le code d'un moissonneur, et
  un moissonneur ne lit de Pronto que le contrat des champs et la bibliothèque, en lecture seule.
- **Deux coutures seulement** : les fichiers de `_Moissons\` (format §3) et deux commandes à
  sortie JSON, `estimer` et `tout` (brief parlementaire §10), dont le contrat passera dans
  `docs/FORMAT-PROPOSITIONS.md` pour valoir pour tous.
- **Les pannes restent locales.**
  - Une source qui tombe n'arrête pas les autres sources du même moissonneur : c'est déjà le
    cas dans les deux dépôts.
  - Un moissonneur qui tombe n'écrit pas de lot ; les autres onglets restent intacts.
  - Un lot illisible est signalé et ignoré, une ligne illisible écarte la ligne et pas le lot.
- **Un état par moissonneur** : `_Moissons\<moissonneur>\etat.json` (dernière moisson, durée,
  requêtes, propositions écrites, sources en échec avec leur raison). La vue l'affiche en
  tête de l'onglet.
- **Pas de cadre commun.** Les deux dépôts ont chacun leur `reseau.py` : c'est un doublon
  accepté. Un paquet partagé ou un système de greffons coûterait plus que ces 150 lignes (§8 de
  CLAUDE.md).

## 3. Le format d'une proposition

Une ligne JSON par proposition, dans un lot écrit d'un coup (nom temporaire puis renommage) et
jamais modifié ensuite : `_Moissons\<moissonneur>\AAAA-MM-JJ-<n>.jsonl`.

```json
{
  "format": "pronto-proposition/1",
  "cle": "parlement:openparldata:ZH:2026-0412",
  "moissonneur": "parlement",
  "type": "intervention",
  "langue": "de",
  "recolte": "2026-10-02T14:12:00Z",
  "lien_source": "https://www.kantonsrat.zh.ch/geschaefte/geschaeft/?id=…",
  "valeurs": { "title": "…", "canton": "ZH", "categorie": "postulat", "numero": "KR-Nr. 41/2026",
               "lien": "https://…", "source": "openparldata" },
  "doutes": [
    { "champ": "categorie", "code": "correspondance-incertaine", "detail": "type harmonisé « Anzug »" },
    { "champ": "date", "code": "date-illisible", "detail": "« 4. März »", "suggestion": "2026-03-04" }
  ],
  "brut": { "type_harmonise": "Anzug", "date_depot": "4. März", "titre": "…" },
  "pertinence": { "verdict": "a-relire", "raison": "ancrage « Integration » seul" },
  "doublon": null
}
```

| Champ | Règle |
|---|---|
| `cle` | `<moissonneur>:<source>:<identifiant stable>`. Identité de la proposition pour toujours ; une décision s'y rattache |
| `type` | un type du contrat (`intervention`, `recherche`…). Il choisit l'onglet |
| `langue` | `fr` ou `de`, toujours renseignée (§4) |
| `valeurs` | les clés du contrat du type. Une valeur n'y entre que si elle respecte la saisie du contrat ; sinon le champ reste vide et un doute le dit |
| `doutes` | ce que le moissonneur sait avoir deviné ou n'a pas pu lire, champ par champ. `suggestion`, facultative, est une valeur conforme que la rédaction applique d'un clic |
| `brut` | les valeurs telles que lues, avant normalisation, réduites à ce qui sert à juger. Pas la page entière |
| `pertinence` | facultatif : `retenu` ou `a-relire`, avec sa raison lisible. `ecarte` ne s'exporte jamais |
| `doublon` | facultatif : `{ uuid, slug, certitude: "probable" }`, une fiche existante qui semble la même. Un doublon sûr ne s'exporte pas |

Codes de doute, liste fermée et documentée : `date-illisible`, `langue-devinee`,
`correspondance-incertaine`, `valeur-hors-liste`, `champ-introuvable`, `texte-tronque`. Un
moissonneur qui a besoin d'un nouveau code le fait ajouter au document, il ne l'invente pas.

Une même `cle` qui revient dans un lot plus récent, avant toute décision, remplace l'ancienne :
le cockpit garde la ligne du lot le plus récent.

Ce que deviennent les champs actuels : le `extra.manques` de `Projet` devient des doutes
`champ-introuvable` ; la date PH FHNW « September 2024 – … », vidée en silence aujourd'hui,
devient un doute `date-illisible`, avec la valeur brute sous les yeux de la rédaction et la
suggestion `2024-09`.

## 4. Une proposition, une langue

Le moissonneur oriente chaque objet vers une seule revue, et ne produit jamais deux
propositions pour un même objet :
- canton romand → `fr` (Revue) ; canton alémanique → `de` (Zeitschrift) ; Tessin → `fr`, le
  titre gardé en italien ;
- Confédération et cantons bilingues (BE, FR, VS, GR) → la langue du texte déposé ;
- recherche : la langue de la page, ou celle du titre devinée par le moissonneur ;
- quand la langue n'est pas sûre, le moissonneur choisit quand même et pose un doute
  `langue-devinee`.

L'autre revue reçoit l'objet par le chemin qui existe déjà : à l'acceptation, la case
« Proposer aussi à la Zeitschrift » (ou « à la Revue ») écrit le statut `a-traduire` dans
`_Statuts\<autre langue>\<uuid>.txt`. La fiche apparait alors dans « Traductions à faire » de
l'autre revue, qu'elle soit rattachée à un numéro ou orpheline : `listerTraductionsATraire` ne
regarde pas `Ausgabe` (vérifié dans `kirby-contenu.js`). Une seule fiche, deux langues.

## 5. Cas A et cas B : c'est le cockpit qui décide

Une proposition est en **cas B** (« à vérifier », pastille orange) dès qu'une de ces
conditions est vraie :
1. le moissonneur a déclaré au moins un doute ;
2. le cockpit, en revalidant `valeurs` contre le contrat, trouve un champ requis vide
   (`champsManquants`), une date hors format (`dateValide`, `datePartielleValide`,
   `anneeValide`) ou un jeton absent de sa liste ;
3. `doublon` est renseigné.

Sinon, elle est en **cas A** (« prête »).

La revalidation du point 2 est la garantie. Si le contrat change (la liste `instrument` qui
passe de vingt à huit jetons, par exemple), les propositions anciennes passent d'elles-mêmes en
cas B, sans que le moissonneur ait à le savoir. Le moissonneur, lui, apporte ce que le contrat
ne peut pas voir : une langue devinée, une correspondance de type approximative.

La pertinence (`retenu` / `a-relire`) est un autre axe, qui ne colore pas la pastille : c'est
une colonne et un filtre. « Doute » désigne un champ, « pertinence » le sujet ; les deux mots
ne se croisent pas.

## 6. La vue « Propositions » dans la Documentation

Une vue de plus du panneau Documentation, à côté de Traductions à faire, Réservoir et Archive
(décision de Robin) :
- une entrée « Propositions » dans l'arbre, sous Actualité, avec son compte, comme les trois
  autres (`_itemsActualite` d'`extension.js`) ;
- `panel-propositions` dans `media/documentation.html`, le code de la vue dans un composé à
  part, `media/_propositions.js`, pour ne pas grossir `documentation.js` (1 606 lignes) ;
- un onglet par type de fiche, sur le modèle de la barre des catégories de la Documentation du
  numéro (`construireBarreCategories`) ;
- côté hôte, `documentation-hote.js` câble les messages ; la logique (lots, décisions, cas A/B)
  vit dans `lib/propositions.js`.

La vue ne montre que les propositions de la langue du numéro ouvert. Le détail de l'interface
est au §11.

## 7. Accepter et refuser, sur le disque

- **Trois gestes** :
  - **Accepter dans ce numéro** (premier bouton) : la fiche est créée, `Ausgabe` = le numéro
    ouvert, puis l'ordre du numéro est recalculé, comme pour « Tirer dans ce numéro » ;
  - **Garder au réservoir** (second bouton) : la fiche est créée orpheline, elle apparait dans
    « Mes orphelines » du Réservoir ;
  - **Refuser**, avec un motif facultatif : `hors-sujet`, `doublon` ou `autre`. Ces motifs
    mesurent la précision des filtres (brief parlementaire §5.6).
- **Décisions** : un fichier par proposition, `_Moissons\_Decisions\<empreinte>.txt`, au
  format des statuts de traduction. L'empreinte est les 16 premiers caractères hexadécimaux du
  SHA-256 de la `cle`, parce qu'une `cle` contient des `:`, interdits dans un nom de fichier
  Windows. La `cle` est écrite en clair dans le fichier.
  ```
  Cle: parlement:openparldata:ZH:2026-0412
  ----
  Decision: accepte          (ou : refuse)
  ----
  Motif: hors-sujet
  ----
  Fiche: <Uuid>
  ----
  Date: 2026-10-02
  ```
- **Ordre d'écriture de l'acceptation** : l'Uuid est tiré d'abord, la décision écrite avec lui,
  puis la fiche est créée avec ce même Uuid, puis le statut `a-traduire` de l'autre langue si la
  case est cochée. Si la création échoue, la décision désigne une fiche introuvable : la vue le
  dit et offre de la recréer. On n'obtient jamais deux fiches pour une même proposition.
- **Numéro gelé** : « Accepter dans ce numéro » est refusé (`refuserSiVerrouille`) ; « Garder
  au réservoir » reste possible.
- **Annuler** : juste après un geste, un bandeau « Acceptée · Annuler » reste quelques
  secondes. Annuler une acceptation supprime la fiche créée et la décision ; annuler un refus
  supprime la décision. Plus tard, une refusée se retrouve par « Afficher les refusées » ; une
  acceptée se supprime dans la Documentation comme toute fiche, et sa décision reste.
- **Le moissonneur relit les décisions** à chaque moisson : une `cle` décidée n'est jamais
  reproposée. La vue masque de toute façon une proposition déjà décidée.

## 8. Revue adverse de la conception

Bugs du premier brouillon, corrigés ci-dessus :
- **Nom du fichier de décision** : `<cle-en-nom-de-fichier>` aurait contenu des `:`. D'où
  l'empreinte.
- **« Création exclusive »** d'une décision : `wx` n'est exclusif que sur un poste, pas entre
  deux postes OneDrive. Avec une proposition par langue, un seul poste trie normalement une
  proposition donnée ; une collision donnerait une copie de conflit, que `copies-conflit.js`
  doit voir dans `_Moissons\` (à vérifier, non mesuré).
- **Un doute qui s'éteint dès que le champ est touché** : un clic distrait l'aurait effacé sans
  correction. Un doute reste affiché jusqu'au geste ; c'est l'acceptation, formulaire ouvert,
  qui vaut confirmation de tous les champs.
- **La langue vide** comme quatrième cas B disparait : la langue est toujours choisie (§4).
- **Une `cle` présente dans deux lots** n'avait pas de règle : le lot le plus récent l'emporte.

Risques encore ouverts :
- **Saisie non enregistrée dans le numéro.** « Accepter dans ce numéro » recharge la page
  (`charger`), comme « Tirer dans ce numéro ». Si une carte du numéro a une modification non
  enregistrée, le rechargement pourrait la perdre. Le comportement actuel de « Tirer » est à
  mesurer avant le lot P1, et la vue propositions doit enregistrer d'abord ou refuser.
- **Coût de l'arbre.** Le compte de l'entrée « Propositions » lit tous les lots et toutes les
  décisions à chaque rafraichissement de l'arbre, sur OneDrive, où un fichier « en ligne
  seulement » se télécharge à la première lecture. Il faut un cache par date de modification,
  comme pour la bibliothèque, puis mesurer.
- **Mode test.** Le moissonneur écrit sous la racine de production ; en mode test, la racine
  active est `Revues-TESTING`, où il n'y aura pas de lot. Proposé : la vue lit toujours
  `_Moissons\` à la racine active, et un lot factice est déposé dans `Revues-TESTING` pour
  essayer.
- **Contrat plus récent que le moissonneur** : couvert par la revalidation (§5), au prix de
  faux cas B tant que le moissonneur n'est pas mis à jour.
- **Proposition périmée** : une intervention change d'état après son acceptation. Ce système ne
  met jamais à jour une fiche existante ; le suivi est un autre chantier.

Écarts assumés par rapport à la demande :
- Le cas B couvre aussi un champ requis vide et un doublon probable, en plus des formats
  douteux.
- L'acceptation en lot est réservée aux cas A.
- Pas de brouillon : une saisie dans le formulaire s'écrit au geste, ou se perd à la fermeture.
- Un onglet par type de fiche et non par moissonneur.

## 9. Décisions de Robin (02.10.2026)

1. Propositions hors de `Fiches\`, cockpit seul écrivain : **oui**. Le moissonneur
   parlementaire a reçu la consigne (étape 8 : propositions au lieu de fiches).
2. **« Accepter dans ce numéro »** en premier bouton, **« Garder au réservoir »** en second.
3. **Une vue de plus dans la Documentation**, pas un panneau à part.
4. Une proposition, une langue ; la traduction passe par le statut `a-traduire` (§4).

Encore ouvert :
- **Purge.** Un lot dont toutes les propositions sont décidées ne sert plus à rien, mais reste
  lu à chaque ouverture. Proposé : aucune purge au début. On compte quelques centaines de lignes
  par mois, et on mesure le temps de lecture après six mois ; on purge seulement si ce temps
  devient sensible. Les décisions, elles, ne s'effacent jamais.
- **Case « Proposer aussi à l'autre revue »** : proposé cochée par défaut pour la
  Confédération, décochée ailleurs.

## 10. Découpage en lots

| Lot | Contenu | Dépend de |
|---|---|---|
| P0 | `docs/FORMAT-PROPOSITIONS.md` (format, codes de doute, décisions, `estimer`/`tout`, `etat.json`), lots factices synthétiques dans `test/`, `lib/propositions.js` : lecture des lots, décisions, classement A/B par le contrat. Tests d'abord | interface validée |
| P1 | Vue « Propositions » : entrée d'arbre, `panel-propositions`, `media/_propositions.js`, tableau, pastilles, gestes en lot, MSG, clés i18n fr et de | P0 |
| P2 | Formulaire de détail. Les constructeurs de champs de `documentation.js` passent dans un composé partagé (`media/_fiche-doc.js`), capture avant/après de la Documentation | P1 |
| P3 | `szh-harvest-parlement` : `export_propositions.py`, `decisions.py`, `etat.json` (en cours, session 17) | — |
| P4 | `szh-harvest-research` : `exporter` écrit des propositions, relit les décisions ; `kirby.py` ne garde que la lecture | P0 |
| P5 | Plus tard : lancer un moissonneur depuis la vue (`estimer` puis `tout`), sur le seul poste qui moissonne | P1 |

## 11. Consignes d'interface

Le but : trier une moisson mensuelle de 30 à 100 propositions en quelques minutes, sans perdre
de vue ce qui est douteux. On compte les clics.

### Être vu
- L'entrée « Propositions » de l'arbre porte le nombre en attente, et une icône d'avertissement
  orange (`ThemeIcon('warning', ThemeColor('list.warningForeground'))`) quand il y a au moins un
  cas B. L'infobulle donne les deux nombres : « 14 propositions, dont 3 à vérifier ».
- Chaque onglet de type porte son compte. S'il a des cas B, il porte en plus une pastille orange
  avec un nombre.
- Un onglet sans proposition en attente n'apparait pas. Sans aucune proposition, la vue dit
  quand chaque moissonneur est passé pour la dernière fois, et ce qui a échoué.

### Le tableau
- Une ligne par proposition, sur une seule ligne de hauteur. Les cas B en tête, puis l'ordre
  `tri` du contrat.
- Les colonnes :
  - case à cocher ;
  - état : une icône et un mot, « à vérifier » ou rien. La couleur n'est jamais la seule
    marque ;
  - titre, qui ouvre le détail ;
  - les clés de `tri` du type ;
  - la pertinence ;
  - la source ;
  - la date de récolte.
- Les actions sur chaque ligne sont toujours visibles, et pas seulement au survol :
  - ligne A : **Accepter dans ce numéro** (un clic), **Garder au réservoir**, **Refuser** ;
  - ligne B : **Vérifier**, qui ouvre le détail, et **Refuser**. On ne peut pas l'accepter sans
    l'ouvrir.
- Le refus se fait en un clic, sans motif. Les motifs sont dans un petit menu attaché au
  bouton.
- **La sélection multiple** fait apparaitre une barre fixe : « 5 sélectionnées : Accepter dans
  ce numéro · Garder au réservoir · Refuser ». Si la sélection contient des cas B, les deux
  premiers gestes ne s'appliquent qu'aux cas A, et la barre le dit : « 2 à vérifier d'abord ».
  Une case en tête de colonne coche tout l'onglet.
- Aucune boîte de confirmation. Chaque geste s'annule par le bandeau « Annuler » (§7).

### Le détail
- Il s'ouvre à droite du tableau, qui reste visible et garde la ligne courante en surbrillance.
  Pas de fenêtre modale, pas de nouvel onglet.
- **En haut** :
  - titre et source ;
  - « Ouvrir la source ↗ », qui ouvre l'original dans le navigateur ;
  - les trois gestes ;
  - la case « Proposer aussi à la Zeitschrift ».
- **Les champs** viennent du contrat et sont préremplis. Un champ en doute a :
  - une bordure orange et une icône ;
  - le texte du doute sous le champ ;
  - **la valeur brute juste à côté**, en petit et grisée, pour qu'on n'aille pas la chercher
    ailleurs ;
  - si le doute a une suggestion, un bouton « Appliquer 2024-09 ».
- **Le reste des données brutes** est dans un bloc replié, en bas.
- **Doublon probable** : la fiche existante est montrée en regard, avec un bouton
  « C'est la même : refuser comme doublon ».
- **Après un geste**, le détail passe à la proposition suivante de l'onglet. Trier une série de
  cas B, c'est donc corriger, accepter, corriger, accepter, sans revenir au tableau.
- Les boutons d'acceptation sont grisés tant qu'un champ requis manque ou qu'une date est hors
  format. Une infobulle dit lequel.

### Clavier
- ↑ et ↓ changent de ligne, Entrée ouvre le détail, Échap le ferme.
- Les gestes ont des raccourcis affichés dans leur infobulle. Aucun raccourci n'agit pendant
  qu'on tape dans un champ.

### Règles de la maison
- Les jetons de `_design.css` et les éléments et composés de `media/_commun.js`. Pas de
  couleur en dur ; contrastes vérifiés par `test/apca-check.py`.
- Clés i18n en fr et en de, textes passés par `typo-check.py`. Les mots « proposition »,
  « doute », « pertinence », « réservoir » ne désignent chacun qu'une chose.
- Rôles ARIA du tableau et des onglets. Un `aria-label` sur chaque bouton qui n'est qu'une
  icône. L'ordre de tabulation suit l'ordre visuel.

## 12. Revue adverse du prototype d'interface (v1, 02.10.2026)

Prototype : `proto-propositions\proto.html` dans le scratchpad de la session, avec 9 captures.
Les clics ont été mesurés dans Edge par un script : accepter un cas A, 1 clic ; corriger et
accepter un cas B avec suggestion, 3 ; refuser 5 propositions, 6 (3 avec Maj+clic) ; trier un
onglet de 12 propositions dont 4 cas B, 8 clics et une saisie.

Ce qui gêne la décision :
1. **Les titres sont tronqués à environ 30 caractères** dans toutes les captures. Or le titre
   est ce sur quoi on décide. Les trois gestes en toutes lettres prennent environ 390 px par
   ligne, et Source et Récolte n'aident pas à décider : la récolte a la même date sur toutes les
   lignes, et la source est déjà dans la ligne d'état. Proposé :
   - le titre passe sur deux lignes au plus ;
   - les gestes deviennent « Accepter » et « Réservoir », en libellés courts ;
   - on retire Source et Récolte, et on ajoute le type (`categorie`), comme le demande l'agent.
2. **Une recherche se juge sur son descriptif**, qui n'apparait que dans le détail. Proposé :
   une deuxième ligne grise sous le titre, avec le début du descriptif ou les institutions.
3. **Un panneau étroit** (1 000 px, fréquent dans VSCodium) : le détail écrase le tableau, et
   la barre de gestes collée en haut cache le premier champ (capture 08). Proposé : sous
   1 200 px, le détail prend toute la largeur, avec « ← Liste » et « Suivante ».
4. **Un champ requis vide bloque l'acceptation.** Cela contredit la règle de la Documentation,
   « rien d'incomplet n'est refusé, une pastille dit ce qui manque ». Cela rend aussi
   inacceptable une recherche sans date de fin (`recherche.fin` est requis) ou un livre sans
   couverture. Proposé : bloquer seulement une valeur hors format ; un champ requis vide se
   laisse accepter, et la pastille de la Documentation le suit.
5. **Une suggestion n'est pas préremplie** : le champ reste vide jusqu'au clic « Appliquer ».
   Proposé : la préremplir, en gardant le champ orange et la valeur lue à côté, tant que le geste
   n'est pas fait. On gagne un clic par cas B. Le risque est d'accepter sans regarder ; c'est
   à Robin d'en juger.
6. **L'envoi à l'autre revue est invisible depuis le tableau.** Une intervention fédérale
   acceptée en un clic part aussi à la Zeitschrift, sans que la ligne le montre. Proposé : une
   petite marque « + de » sur la ligne, qu'un clic retire.

Défauts mineurs :
- Le doute « champ introuvable » affiche « lu : « … » » : il doit dire « absent de la source ».
- La ligne d'état nomme le moissonneur par son identifiant (« parlement ») : il faut un
  libellé, « Interventions (OpenParlData) ».
- Les boutons grisés sont pâles : leur contraste est à mesurer par `apca-check.py`.
- La touche A sur un cas B ne fait rien, sans le dire : il faut un message « à vérifier
  d'abord ».
- La barre Enregistrer / Aperçu du PDF / Retour à l'article reste affichée alors qu'elle ne
  concerne pas cette vue. Les autres vues font de même ; ce point est à revoir pour toutes.
- La légende du clavier occupe une ligne entière : elle peut passer dans une infobulle « ? ».
- L'entrée de l'arbre est placée après Archive. Proposé : juste après « Documentation du
  numéro », parce que c'est là qu'arrive le neuf.

Non vérifié :
- l'APCA ;
- `typo-check` ;
- un lecteur d'écran ;
- le rendu dans une vraie webview VSCodium ;
- l'allemand, que le prototype n'a pas.

### Avis de la supervision (session 00, 02.10.2026), à confirmer par Robin

- Les points 1, 2, 3, 4 et 6 sont acceptés, ainsi que tous les défauts mineurs.
- Point 5 : **pas de préremplissage**. Un cas B est un doute, c'est précisément là qu'il faut
  regarder ; « Appliquer » reste un seul geste.
- Trois ajouts :
  - le bouton de suggestion montre la date telle qu'elle sera imprimée (« Appliquer
    04.03.2026 »), formée par `lib/date-apercu.js` ;
  - en panneau étroit, les gestes réduits à une icône ont un `aria-label` et une infobulle,
    en fr et en de ;
  - « Vérifier » n'a pas la même teinte qu'« Accepter dans ce numéro », pour qu'on distingue
    d'un coup d'œil un cas A d'un cas B. L'icône et le mot restent : la teinte ne fait que
    les doubler.

### Décisions de Robin du 03.10.2026

- La revue du prototype v1 est acceptée entière : points 1, 2, 3, 4 et 6, pas de
  préremplissage (point 5), avec les trois ajouts de la supervision.
- La supervision décide désormais des détails d'interface de ce chantier, sans repasser par
  Robin.
- « Proposer aussi à l'autre revue » est cochée d'office pour CH, décochée ailleurs.
- La purge sera automatique : Robin ne veut rien qui s'accumule et qu'il faudrait penser à
  nettoyer. Il propose de garder 6 mois de données moissonnées ; la supervision tranche la
  forme.
- Pour la v2 : la colonne du titre se redimensionne, et des colonnes peuvent se masquer
  (menu « Colonnes »). Les deux réglages sont mémorisés par type de fiche et par poste.

### Décisions de la supervision (session 1c, 03.10.2026)

- **Purge à 6 mois**, faite par chaque moissonneur à la fin de `tout` :
  - elle efface les lots de plus de 6 mois, décidés ou non ;
  - elle efface les décisions de plus de 6 mois, une fois reportées dans sa base SQLite ;
  - `etat.json` dit ce qui a été purgé.

  Garde-fous :
  - l'âge se lit sur la date du lot, jamais sur le mtime ;
  - la purge ne touche que le dossier de ce moissonneur et ses propres décisions, avec un
    contrôle du chemin résolu avant chaque suppression ;
  - elle ne touche jamais à `Fiches\` ;
  - les tests se jouent sur une arborescence jetable.
- **Colonnes** :
  - les largeurs et les colonnes masquées sont gardées dans le `globalState` de l'hôte (par
    poste, jamais partagé), par un message de la table `MSG` ;
  - la poignée se manie au clavier (`role="separator"`, `aria-valuenow`) ;
  - le menu Colonnes porte un geste « Rétablir les largeurs » ;
  - sous 1 200 px, le détail en pleine largeur l'emporte sur les largeurs mémorisées.

## 13. Interface figée : prototype v2 (validé par la supervision le 03.10.2026)

Le prototype v2 (`proto-propositions-v2\` dans le scratchpad de la session, 12 captures) fait
foi pour P1 et P2, avec ces corrections :
1. **Champ en doute.** Il bloque « Accepter » tant qu'il n'a pas été touché, par Appliquer ou
   par une saisie. Un champ requis vide sans doute ne bloque pas. Le bouton désactivé dit
   pourquoi : « Vérifiez d'abord : Date », en fr et en de.
2. **Doublon probable.** Le focus va sur « C'est la même : refuser comme doublon ».
3. **Seuil du détail en pleine largeur.** Il se mesure sur la largeur de la webview
   (`ResizeObserver` sur le conteneur), et sa valeur se fixe au P1, dans une vraie fenêtre
   VSCodium.
4. **Détail ouvert.** Pertinence se masque d'elle-même avant que Type ne se tronque.
5. **Menu Colonnes.** Titre et Gestes y figurent en cases désactivées, avec l'infobulle
   « toujours affichée ».
6. **Marque de l'autre revue.** Elle nomme la langue cible : « + de » dans la Revue, « + fr »
   dans la Zeitschrift.
7. **Contrastes.** Au P1, `test/apca-check.py` mesure le cerne ambre de « Vérifier », la
   marque « + de » et la poignée de redimensionnement.

### Nommage (supervision, 03.10.2026)

- En français, « proposition » désigne un objet moissonné. Le vérificateur de traduction et le
  nettoyeur disent « suggestion » ; la phrase d'aide du vérificateur (`sugg.aide`) est
  retouchée en ce sens.
- En allemand, un objet moissonné est un **« Treffer »** (« 14 Treffer, davon 3 zu prüfen »).
  « Vorschlag » reste au vérificateur et au nettoyeur.
- Les autres mots de la vue : « doute » (Unsicherheit) pour un champ, « pertinence » (Relevanz)
  pour le sujet, « réservoir » (Reserve) pour les fiches sans numéro.

## 14. Finesse du tri et filtres dans l'interface (demande de Robin, 03.10.2026)

Demande : « dans les réglages, un curseur de finesse / bruit, et/ou une manière de paramétrer
les filtres directement dans l'interface ». Conception de départ de la supervision, puis sa
revue adverse ; rien n'est codé avant validation du prototype.

### Revue adverse de la conception de départ

1. **Un score 0–100 commun ne se compare pas d'un moissonneur à l'autre.** Le parlement
   calcule son score avec l'ancrage et les domaines de la CDPH, la recherche avec des mots du
   filtre et des institutions. Un même seuil couperait l'un trop et l'autre pas assez.
   Proposé : chaque proposition porte un **cran de 1 (sûr) à 5 (très large)**. Chaque
   moissonneur définit et documente ses crans ; ils sont emboîtés, et le curseur montre les
   crans 1 à k.
2. **Un curseur sans chiffres est un réglage à l'aveugle.** Proposé : chaque moissonneur écrit
   dans `etat.json`, pour chaque cran, le volume par mois et le rappel sur son jeu de
   référence (les 79 interventions de 2025). Sous le curseur, la vue affiche par exemple
   « Large : environ 68 par mois, 73 interventions de 2025 sur 79 retrouvées ».
3. **Un réglage commun à toute la rédaction mélange les deux langues.** La Revue et la
   Zeitschrift trient chacune leurs propositions. Proposé : un réglage **par langue et par
   type de fiche**, dans `_Moissons\_Reglages\<langue>.json`. Il est partagé par la rédaction
   de cette langue, pas par poste. La vue dit qui l'a changé et quand.
4. **Les comptes doivent suivre le réglage.** L'arbre, les onglets et les pastilles ne comptent
   que ce qui est visible. Une ligne « 120 masquées par le réglage · les voir » garde
   l'accès aux autres. Masquer n'efface rien, et la purge à 6 mois s'applique aux masquées
   comme aux autres.
5. **Exclure un terme d'un clic peut faire chuter le rappel sans qu'on le voie.** Proposé :
   - le geste n'écrit qu'une **demande** (`_Moissons\<moissonneur>\demandes.json`) ;
   - le moissonneur la mesure à sa passe suivante, sur sa base locale et contre son jeu de
     référence ;
   - il l'applique, ou la refuse au-delà d'une perte fixée, puis répond dans `etat.json` avec
     l'effet mesuré (rappel et volume, avant et après) ;
   - Réglages > Moissonnage liste les demandes avec leur statut, et une demande appliquée se
     retire de la même façon.
6. **« Pourquoi » exige des raisons structurées.** Chaque proposition porte `pertinence.termes`
   et `pertinence.theme`, en plus de la phrase `raison`. Ce sont des champs facultatifs ; le
   format reste `pronto-proposition/1`.
7. **Pas d'édition libre du lexique** : d'accord avec la supervision. Le lexique se mesure par
   le rappel, et une édition libre contournerait la mesure.

### Où vivent les réglages

- **Le curseur** :
  - dans la vue, en tête de chaque onglet de type, à côté du filtre de pertinence ;
  - dans Réglages > Moissonnage, avec ses chiffres par cran et l'historique (qui, quand).
- **Les termes** :
  - « Pourquoi » s'affiche dans le détail, et un clic sur un terme propose de ne plus le
    proposer ;
  - « Ajouter un terme » et la liste des demandes sont dans Réglages > Moissonnage.

### Réponses du moissonneur parlementaire (session 17, 03.10.2026)

- **Les crans du parlement**, emboîtés :
  - 1 : terme du handicap dans le titre ;
  - 2 : texte dense en termes du handicap ;
  - 3 : signal faible ;
  - 4 : école ordinaire sans mention du handicap ;
  - 5 : thème de la Revue lié à l'enfance ou à l'école.
- **Correspondance avec le verdict** : retenu = crans 1 et 2, à relire = crans 3 à 5. Les
  Fragestunde ne dépassent jamais le cran 3.
- **Rappel sur 79, en cumul** : environ 40 pour les crans 1-2, 48 pour 1-3, 68 pour 1-4, 73
  pour 1-5. Par mois : environ 13 pour les crans 1-2, environ 81 pour 1-5. Ce rappel est
  optimiste, puisqu'il est mesuré sur les fiches qui ont servi à écrire le vocabulaire : la
  vue le dit.
- **Champs facultatifs**, sans changement de version de format :
  - `pertinence.cran`, `.termes`, `.theme`, `.ou` (titre, texte ou extrait) ;
  - `etat.crans` (`cran`, `par_mois`, `rappel`, `rappel_sur`, avec la fenêtre écrite) ;
  - `etat.demandes` et `demandes.json`.
  Un moissonneur qui ne les remplit pas reste conforme ; la vue cache alors le curseur.
- **Les demandes** :
  - les termes appliqués vivent dans une surcouche, jamais dans le lexique versionné, où ils
    n'entrent que par un commit humain ;
  - une exclusion est refusée dès qu'elle ferait perdre une seule fiche de référence (X = 0),
    et la vue liste les fiches perdues ;
  - un ajout est refusé au-delà de 20 « à relire » de plus par mois ;
  - un ajout est « appliqué en partie » tant que le nouveau terme n'a pas été cherché sur le
    serveur ;
  - rien n'est rétroactif.
- **La rédaction ne voit plus que le cran.** Le verdict retenu / à relire reste interne :
  export et dédoublonnage.
- **Coût côté moissonneur** : environ 4 à 4,5 jours d'agent.

### 10 crans (précision de Robin, 03.10.2026)

Le curseur a 10 crans. Seuls les deux bouts sont nommés : « Large » (1, tout visible) et
« Strict » (10). À côté du curseur, la vue affiche en direct « Cran 6 : 142 visibles, 120
masquées ». Les crans se manient au clavier, avec `aria-valuetext`.

Le calcul :
- chaque proposition porte un score continu de 0 à 100 (`pertinence.score`) ;
- les 10 seuils sont les déciles de la distribution des scores de chaque moissonneur, et non
  un pas fixe, sinon plusieurs crans ne changent rien ;
- le moissonneur écrit ses seuils, son volume par mois et son rappel par cran dans `etat.json` ;
- les cinq catégories du parlement restent comme explication, dans « Pourquoi ».

Les déciles se calculent dans chaque moissonneur. Un même cran garde donc un sens comparable
d'un moissonneur à l'autre : c'est la réponse à la première objection de la revue adverse
ci-dessus.

### Décisions de la supervision sur le prototype (03.10.2026)

Le prototype est validé sans v2.
1. Dans la vue, le curseur n'est qu'un aperçu propre au poste. Le bouton « Garder ce cran pour
   la rédaction » n'apparait que si l'aperçu diffère du réglage partagé, qui fait foi et se
   règle aussi dans les Réglages.
2. Le curseur tient sur une seule ligne ; le reste va dans l'infobulle « ? » et dans les
   Réglages.
3. La colonne Cran est masquée par défaut.
4. Dans la vue Termes, « Ne plus proposer » est une icône, avec `aria-label` et infobulle. Elle
   est marquée quand `ref_seul` est supérieur à 0.
5. Les moissonneurs fournissent `note_sans` pour chaque terme, et des déciles par moissonneur
   et par langue.
6. On garde 10 crans. Les ex aequo se départagent par de vraies modulations. Un cran identique
   au précédent se montre tel quel et l'infobulle le dit. Réduire le nombre de crans repasse
   par la supervision.
7. « Appliquer quand même » se confirme par le demandeur, après qu'il a vu les fiches perdues.
   La demande garde qui l'a faite et quand, et tout le monde la voit.

Calendrier : d'abord les rapports sur les catégories et les mots-clés du moissonneur, puis le
score, `note_sans` et les déciles sur le vrai premier lot. Les lots du cockpit partent ensuite.
Le lot « curseur et comptes » se prépare dès maintenant sur des données factices, au format
figé du §15.

## 15. Format figé de la finesse (ajouts facultatifs à `pronto-proposition/1`)

Tous ces champs sont facultatifs. Un moissonneur qui ne les remplit pas reste conforme, et la
vue cache alors le curseur, la vue Termes et « Pourquoi » détaillé pour ses types.

Dans une proposition, sous `pertinence` :

| Champ | Contenu |
|---|---|
| `score` | nombre de 0 à 100, propre au moissonneur ; par bandes chez le parlement (une catégorie = une plage) |
| `categorie` | jeton de l'explication, documenté par le moissonneur (parlement : `titre`, `texte-dense`, `signal-faible`, `ecole`, `theme`) |
| `termes` | liste complète, sans plafond, de `{ terme, langue: fr\|de\|it, role: ancrage\|ambigu\|ecole\|theme, ou: titre\|texte\|extrait, note_sans }` ; un terme une seule fois, à son emplacement le plus fort |

`note_sans` est le score qu'aurait la proposition sans ce terme, tous les autres en place.
Le cockpit en tire « seul à ramener » au cran courant : la proposition est visible, et ne le
serait plus sans ce terme.

Dans `etat.json` :

| Champ | Contenu |
|---|---|
| `crans` | `{ fr: [...], de: [...] }`, 10 entrées par langue : `{ cran: 1..10, seuil, par_mois, rappel, rappel_sur, identique_au_cran_precedent }` ; le cran 1 a le seuil 0 (Large), le cran 10 est Strict |
| `crans_calcules_le` | date AAAA-MM-JJ, recalcul trimestriel |
| `note_calibree` | facultatif, `true` quand la note a été calibrée sur des jugements humains ; sinon l'infobulle du curseur dit « la note n'est pas encore calibrée : le curseur coupe surtout par volume » (supervision, 03.10.2026 : cran 1 par défaut au lancement, calibrage après un mois d'usage réel) |
| `crans[langue][].egalites` | facultatif, `{ objets, groupes, plus_grand }` : les ex aequo qui restent à ce cran, pour suivre la finesse réelle de la note |
| `crans_source` | `{ fr: "langue" | "commun", de: … }` : une langue qui a moins de 200 propositions sur 12 mois, ou plus de 3 crans identiques, prend les déciles communs, et le champ le dit |
| `crans_fenetre` | `{ du, au }`, la fenêtre du `par_mois` |
| `termes` | `[{ terme, langue, role, ref, ref_seul }]`, avec `rappel_sur` à côté |
| `demandes` | `[{ id, statut, effet: { rappel_avant, rappel_apres, par_mois_avant, par_mois_apres, complet }, fiches_perdues: [titres], mesure_le }]` ; `complet` vaut false tant qu'un ajout n'a pas été cherché sur le serveur |
| `demandes_ignorees` | `[{ fichier, raison }]` : une demande dont l'`id` n'est pas un nom sûr (64 caractères au plus, `[A-Za-z0-9_-]`) ou ne correspond pas à son fichier |

Statuts d'une demande :
- `en-attente` ;
- `applique` ;
- `applique-partiel` : un ajout pas encore cherché sur le serveur ;
- `refuse-perte` : une exclusion qui ferait perdre au moins une fiche de référence ;
- `refuse-bruit` : un ajout qui donnerait plus de 20 « à relire » de plus par mois ;
- `doublon` ;
- `a-confirmer` ;
- `retrait-en-attente`.

Écrits par le cockpit, dans `_Moissons\` :
- `_Reglages\<langue>.json` contient `{ "<moissonneur>": { "<type>": { cran, par, le } } }`.
  C'est le réglage partagé de la rédaction de cette langue. L'aperçu propre au poste vit dans
  le `globalState` de l'hôte.
- `<moissonneur>\demandes\<id>.json` contient, pour une demande, `{ id, terme, langue, sens:
  ajout|exclusion|retrait, par, le, confirme_par?, confirme_le? }`. Il y a un fichier par
  demande, comme pour les décisions, pour que deux postes n'écrivent jamais le même fichier.
  Le terme est validé : 60 caractères au plus, lettres, espaces, tirets et apostrophes, jamais
  interprété comme une expression régulière.

Le moissonneur ne lit ni ne garde `par` et `confirme_par` : la vue relit l'auteur dans le fichier de la demande. Il n'y a pas de clé `it` dans `crans` : les objets tessinois sont exportés en fr et comptent dans les déciles fr.

### Propositions multilingues (décision de la supervision, 03.10.2026)

Toute affaire fédérale (CH) donne UNE proposition visible des deux rédactions. Les cantons
bilingues (BE, FR, VS, GR) suivent la même règle quand ils fournissent les deux titres ; sinon,
la langue de leur titre.

- `langues: ["fr", "de"]` à la place de `langue`. Une ligne porte l'un ou l'autre, jamais les
  deux. Chaque langue est une langue du contrat.
- `titres: { fr, de, it? }` contient les titres officiels. `valeurs.title` est omis : il n'y a
  qu'une source du titre. Le cockpit pose `title` = `titres[langue de la vue]`, et `it` n'est
  qu'informatif.
- La `cle` ne change pas (`parlement:openparldata:CHE:<id>`). Une seule décision vaut pour les
  deux vues.
- Aucun doute `langue-devinee` sur une telle ligne.
- Finesse : la proposition compte dans les déciles de chaque langue qu'elle porte.
- À l'acceptation, la fiche naît dans la langue de la vue. La coche « + de » ou « + fr » n'est
  cochée d'office que pour CH (décision de Robin). Pour un canton bilingue, la proposition
  apparait dans les deux vues, mais la coche reste décochée : celle qui accepte coche si elle
  le veut. Quand la coche est mise, ce qu'elle crée dépend des champs remplis (décision de la
  supervision) :
  - si seul le titre est à traduire, les deux fichiers de langue naissent d'un coup, avec le
    même Uuid. Celui de la vue est rattaché au numéro, ou orphelin pour « Garder ». Celui de
    l'autre langue est orphelin, avec son titre officiel et les champs communs : il est prêt à
    « Tirer » ;
  - si un champ `traduire: true` autre que le titre est rempli, un seul fichier naît, et
    l'autre langue reçoit le statut « à traduire ». Un statut posé à côté d'un fichier existant
    serait ignoré par `listerTraductionsATraire` : on ne fait jamais les deux. « Traduire dans
    ce numéro » préremplit alors le titre par le titre officiel, gardé dans la décision
    (champ `Titres`) ;
  - si la coche est décochée, un seul fichier naît, comme pour une proposition monolingue.
- Annuler une acceptation retire les deux fichiers tant qu'aucun n'a de numéro. Si l'autre
  langue est déjà dans un numéro, seul le fichier de la vue part, et un message le dit.
- Une proposition n'est multilingue que si fr ET de sont présents dans les titres : CH, BE, FR
  et VS (décision de la supervision). Sinon, `langue` est la langue du seul titre ; it seul
  donne fr, comme le Tessin, et GR reste en de.

### Crans « très large » et cran par défaut (décision de Robin, 03.10.2026)

On garde 10 crans, répartis ainsi :
- cran 1 « Très large » : environ 77/79, environ 80 propositions par mois ;
- cran 2 « Large » : le réglage normal, environ 74/79, et le réglage PAR DÉFAUT de la rédaction ;
- crans 3 à 10 : les déciles du réglage normal, jusqu'à environ 20/79 au cran 10 (« Strict »).

Format, arrêté avec le moissonneur :
- `etat.json` porte `cran_defaut` (entier de 1 à 10, 1 s'il est absent) ;
- le cran 1 a le seuil 0 ;
- chez le parlement, le vivier élargi a `pertinence.categorie: "texte-large"` et une bande de
  note à lui (0 à 4,99, sous la bande thème). Aucun autre drapeau.

La vue :
- sans réglage partagé, elle se place sur `cran_defaut` ;
- les deux bouts du curseur sont « Très large » (cran 1) et « Strict » (cran 10) ;
- le cran par défaut se nomme « Large » ;
- l'infobulle d'un cran sous `cran_defaut` dit qu'il ajoute des propositions plus incertaines
  que le réglage normal.

Cela remplace « cran 1 par défaut au lancement ».
