# Le vérificateur de traduction, et le mode « Trad »

Deux modes du cockpit, INDÉPENDANTS l'un de l'autre — chacun peut être allumé sans l'autre,
et les deux en même temps ne posent aucun problème :

- **le vérificateur de traduction** (`verifTraduction`) laisse quiconque relit un ARTICLE
  **proposer** un autre texte pour l'un de ses quatre champs traduisibles, sans jamais
  pouvoir **écrire** dans sa fiche ;
- **le mode « Trad »** (`modeTrad`) fait la même chose pour les textes de l'OUTIL lui-même —
  boutons, formulaires, messages — plus de mille libellés qu'aucune pastille ne pourrait
  couvrir un par un.

Les deux écrivent des suggestions par le même module (`lib/suggestion-traduction.js`) et
ouvrent le même formulaire (`media/suggestion.js`), mais ne vont pas au même endroit : voir
« Deux cibles » plus bas. Aucun des deux ne cohabite mal avec le panneau « Traductions »
existant (`lib/traduction.js`, `.traduction.yaml`) qui, lui, édite pour de bon le texte
publié — les trois gestes ne se gênent pas, mais il ne faut pas les confondre : deux
proposent, un seul publie.

## Le réglage : `verifTraduction`

Rangé dans `C:\ProgramData\SZH\config.json`, clé `verifTraduction` (`CLE_VERIF_TRADUCTION`,
`lib/archivage.js` ~l. 271) — pas dans les réglages de VSCodium. Deux raisons, dites dans le
code (`lib/archivage.js`, juste avant `CLE_VERIF_TRADUCTION`) : trois panneaux le lisent
(fiches, vérification de l'import, traduction), et la mise à jour du poste réécrit en entier
les réglages de l'éditeur — le mode s'y éteindrait à chaque mise à jour.

Le mode « Trad » (`modeTrad`, section dédiée plus bas) est rangé juste à côté dans le même
fichier, pour les deux mêmes raisons, et par les mêmes fonctions jumelles
(`CLE_MODE_TRAD`, `lireModeTrad`, `ecrireModeTrad`, `lib/archivage.js` ~l. 304-323). Les deux
clés sont lues et écrites indépendamment : `resoudreModeTrad` ne regarde jamais
`verifTraduction`, et réciproquement — le test `lireModeTrad rend faux par défaut, et lit un
JSON écrit à la main` (`test/js/mode-trad.test.js` ~l. 130) le vérifie explicitement, avec le
commentaire « les deux modes sont indépendants : allumer l'un n'allume pas l'autre ».

- Lecture : `lireVerifTraduction()` → `resoudreVerifTraduction(lireConfigPoste())`. Tolère
  `true`, `"true"` ou `1` (`normaliserBooleenConfig`, même normalisation que
  `emplacementRevues`) ; absent, illisible ou faux ⇒ **éteint**, le défaut assumé.
- Écriture : `ecrireVerifTraduction(actif)` → `configAvecVerifTraduction`, toujours réécrit en
  booléen propre. Une config illisible n'est **pas** écrasée (`extension.js`, branche
  `msg.cle === 'verifTrad'`, ~l. 5297) : elle emporterait avec elle l'emplacement des revues et
  la configuration OJS.
- Interface : panneau **Réglages SZH** (`media/settings.js`, groupe `verifTrad`), un radio
  **Activé** / **Désactivé** (`regl.verifTrad.actif` / `.inactif`, `lib/i18n.js`) qui poste
  `{ type: 'regler', cle: 'verifTrad', valeur: 'actif' | 'inactif' }`.

## Les champs concernés

Les quatre champs traduisibles de `lib/traduction.js` (`CHAMPS_TRADUISIBLES`) : `title`,
`subtitle`, `resume`, `keywords`, chacun décliné par langue (`LANGUES_META`, `lib/yaml.js` =
`fr`, `de`, `it` — l'italien s'active par carte). Ils vivent dans
`articles/<slug>/<slug>.meta.yaml`. Ni `ausgabe.yaml` (numéro d'une revue), ni le profil livre
n'en portent : rien à y proposer.

Pour `title`, `subtitle` et `resume`, une pastille par champ-langue (`champTexte()`,
`media/_fiches.js`). Pour `keywords`, **une pastille par langue et non par mot** : le champ
traduisible est la liste entière, et une pastille par mot-clé en donnerait quinze sur une
carte à cinq mots-clés (commentaire à l'appel de `pastilleTraduction()` pour les mots-clés,
`media/_fiches.js` ~l. 802). Elle capte alors tous les mots-clés de la langue, joints par des
retours à la ligne.

## Le mécanisme, bout en bout

1. **La pastille** (`pastilleTraduction()`, `media/_fiches.js`, réutilisée par les fiches, la
   vérification de l'import et le panneau de traduction) ne se pose que si `VERIF_TRAD` est
   vrai et que le champ porte une langue. Au clic, elle lit la valeur **au moment du clic**
   (frappe en cours comprise) et poste `{ type: SZH.MSG.SUGGERER_TRADUCTION, slug, champ,
   langue, valeur }`.
2. **L'hôte** (`ouvrirSuggestionTraduction`, `extension.js` ~l. 4829) vérifie `champ` et
   `langue` contre `suggestionTraduction.champValide` / `langueValide` — un message de
   webview n'est jamais réputé sûr — puis ouvre (ou recharge) un panneau webview
   `szhSuggestionTraduction`, à côté (`ViewColumn.Beside`) : un seul panneau à la fois, une
   seconde pastille le recharge sur son champ plutôt que d'ouvrir un second onglet.
3. **Le formulaire** (`media/suggestion.js` + `suggestion.html`) affiche l'article, le champ
   et la langue visés, le texte actuel en lecture seule, une zone **« Traduction proposée »**
   pré-remplie du texte actuel (on corrige plus souvent qu'on ne réécrit), et un commentaire
   libre. Deux GESTES sont possibles (voir « Le champ `geste` » plus bas) : par défaut,
   **« Enregistrer la suggestion »** poste `{ type: MSG.ENREGISTRER, slug, champ, langue,
   geste: 'remplacer', actuel, propose, commentaire }`. Le bouton **« Proposer de supprimer ce
   texte »** n'envoie rien : il ARME le second geste — la zone « Traduction proposée »
   disparaît, un bandeau dit « Sera enregistré : ce texte ne devrait pas exister… », et c'est
   alors le même bouton **« Enregistrer la suggestion »** qui envoie, avec `geste:
   'supprimer'` et `propose: ''`. Un second clic sur « Proposer de supprimer » désarme le
   geste (c'est un interrupteur, `aria-pressed`, pas un second envoi). **« Annuler »** ferme
   sans rien écrire. Une proposition de remplacement identique au texte actuel et sans
   commentaire est refusée côté webview d'abord, puis — c'est lui qui fait foi — côté hôte
   (`estVide()`) ; une suppression, elle, n'a jamais de texte proposé et échappe à ce refus
   (voir plus bas).
4. **L'écriture** (`enregistrerSuggestion()`, `extension.js` ~l. 4784, via
   `lib/suggestion-traduction.js#ecrireSuggestion`) dépose **un fichier JSON par suggestion**
   dans `<racine-du-numéro>/traduction/` — jamais un fichier commun : ces dossiers sont
   synchronisés par OneDrive, et deux personnes qui écriraient tour à tour le même fichier
   produiraient une copie en conflit, où l'une des deux suggestions se perdrait. Le panneau se
   ferme tout seul 1,2 s après confirmation.

### Deux cibles : `cible` (`article` / `interface`)

Le même formulaire et le même module écrivent pour deux relectures différentes, distinguées
par le champ `cible` :

- `article` (le geste d'origine, ci-dessus) : un champ traduisible d'un article, ouvert par
  la pastille. La suggestion porte `produit`, `numero`, `article`, `champ`, `langue`, et va
  dans `<racine-du-numéro>/traduction/`.
- `interface` : un libellé de l'OUTIL, ouvert par le mode « Trad » (section dédiée plus bas).
  La suggestion ne porte ni `produit`, ni `numero`, ni `article`, ni `champ` — elle porte à la
  place `cle` (la clé retrouvée, ou `null`) et `cles` (les candidates), et va dans
  `%LOCALAPPDATA%\SZH\suggestions-interface\`, sur le poste — aucune suggestion sur un
  libellé de l'outil ne concerne un numéro en particulier.

⚠ RÈGLE DU CHAMP AJOUTÉ, même mécanique que `geste` ci-dessous : `cible` est apparu APRÈS les
premiers fichiers de suggestion, et le schéma reste `szh-suggestion-traduction/1`. Un fichier
qui n'en porte pas se relit `article` (`normaliserCible`, `lib/suggestion-traduction.js`
~l. 85) — c'était sa seule cible possible avant que le mode « Trad » n'existe.

### Le champ `geste` : `remplacer` / `supprimer`

`remplacer` (le geste ordinaire, par défaut) dit comment le texte devrait être dit.
`supprimer` dit que ce texte ne devrait pas exister — ce qu'une proposition de remplacement ne
sait pas exprimer : laisser la zone de saisie vide serait ambigu, personne ne saurait si
c'est un oubli.

- `normaliserGeste` (`lib/suggestion-traduction.js` ~l. 68) : toute valeur qui n'est pas
  exactement `'supprimer'` (après `trim()`) se lit `'remplacer'`.
- `construireSuggestion` / `construireSuggestionInterface` écrivent `propose: ''` quand le
  geste est `supprimer`, quelle que soit la valeur reçue — laisser passer le contenu de la
  zone de saisie donnerait à relire une proposition de remplacement là où personne n'en a
  fait.
- `estVide()` (~l. 279) traite une suppression à part : le refus « rien à proposer, ni
  changement ni commentaire » ne s'applique qu'à un `remplacer` — comparer une suppression à
  son texte actuel la déclarerait toujours vide alors qu'elle porte à elle seule tout son
  propos.
- ⚠ MÊME RÈGLE DU CHAMP AJOUTÉ que `cible` : apparu après les premiers fichiers, absent d'un
  ancien fichier ⇒ `'remplacer'`, et le schéma reste `/1`.

### Le dossier `traduction/`

⚠ **Emplacement provisoire** : le propriétaire du dépôt a indiqué qu'il serait déplacé — ce
n'est pas encore acté dans le code, seulement annoncé.

- **Frère de `articles/`, jamais dedans** (`dossierSuggestions()`) : les deux recensements
  d'articles du dépôt (`FournisseurRevue._sousDossiersAvecMd` dans `extension.js`,
  `listerSlugs` dans `lib/export-ojs.js`) listent les sous-dossiers de `articles/` — un
  dossier de suggestions posé là serait examiné comme un article.
- **Nom de fichier** : `<AAAAMMJJ-HHMMSS>-<article>-<champ>-<langue>.json`, en heure locale ;
  un suffixe `-2`, `-3` (`nomLibre()`) lève l'égalité de la même seconde — cliquer, corriger,
  recliquer ne doit pas écraser la première suggestion.
- **`LISEZ-MOI.txt`** bilingue (fr puis `[de]`), posé **une seule fois** à la création du
  dossier (`poserLisezMoi()`) et jamais réécrit ensuite : quelqu'un a pu l'annoter, une
  réécriture systématique l'effacerait en silence. Écrit en CRLF, comme
  `.szh-avant-reimport` (`pipeline/reimporter.py`).
- **Schéma** `szh-suggestion-traduction/1` : `schema`, `horodatage` (ISO **local**, décalage
  inclus — contrairement au schéma des rapports d'erreur qui fige l'UTC, ici c'est l'heure que
  la personne avait sous les yeux qui compte), `auteur` (réglage `szh.nomUtilisateur`, sinon
  le compte Windows, plafonné à 80 caractères), `produit`, `numero`, `article`, `champ`,
  `langue`, `actuel`, `propose`, `commentaire`.
- **Lecture tolérante** : `listerSuggestions()` saute un fichier illisible ou mal formé
  (synchronisation en cours, édition à la main ratée) plutôt que de lever — une mauvaise pièce
  ne doit pas emporter la lecture du dossier entier. Tri du plus récent au plus ancien,
  égalité d'horodatage tranchée par le nom de fichier.
- **Rien n'appelle encore `listerSuggestions()` côté interface** : aucun panneau ne relit ces
  suggestions **d'article** aujourd'hui, seul `test/js/suggestion-traduction.test.js` l'éprouve.
  Une suggestion déposée attend donc d'être ouverte à la main (explorateur de fichiers, ou un
  futur panneau de relecture) — c'est un pense-bête, pas encore un tableau de bord. Sa jumelle
  `listerSuggestionsInterface()`, elle, EST appelée : c'est elle qui alimente le compte affiché
  dans **Réglages SZH** (`compterSuggestionsInterface()`, `extension.js` ~l. 4689) — voir
  « Les suggestions d'interface » plus bas.

## Limite connue : un panneau déjà ouvert ne se met pas à jour tout seul

Activer ou désactiver le réglage ne touche à aucun panneau déjà affiché : chaque webview reçoit
`verifTrad` dans le message `valeurs` que l'hôte lui envoie, et ce n'est qu'à ce moment que les
cartes sont reconstruites avec ou sans pastille. Ce message ne repart pas tout seul quand le
réglage change ; il faut un nouvel événement qui force l'hôte à le renvoyer :

- **« Toutes les fiches »** (`ouvrirApercuMetadonnees`, `lib/metadonnees-hote.js` ~l. 1052) :
  au changement de filtre (`appliquerFiltre`), à un rechargement forcé (fiche périmée), ou à la
  réouverture du panneau (`reveal`) ;
- **« Vérification de l'import »** (`ouvrirImportVerif`, `extension.js` ~l. 5005) : à sa
  réouverture, ou après un enregistrement qui force un rechargement (`res.recharger`) ;
- **Panneau de traduction** (`envoyerValeursTraduction`, `extension.js` ~l. 4310) : au
  changement d'article affiché, ou à un rechargement.

Concrètement : un panneau resté ouvert à l'écran au moment du basculement ne montre (ou ne
cache) les pastilles qu'à son prochain changement d'article, de filtre, ou à sa réouverture —
jamais tout seul, jamais en direct sur les cartes déjà affichées.

## Le mode « Trad » : relire les textes de l'outil

### Pourquoi il existe à côté de la pastille

La pastille ci-dessus sert les **quatre champs traduisibles d'un ARTICLE** (`title`,
`subtitle`, `resume`, `keywords`), posés à des endroits connus, par une seule fonction
(`pastilleTraduction()`, `media/_fiches.js`). Les textes de l'INTERFACE — boutons,
libellés de formulaire, messages — sont plus de 1200, créés à des centaines d'endroits du
code (`TEXTES_COCKPIT`, `lib/i18n.js`). Y poser une pastille un par un serait intenable, et
le prochain bouton ajouté oublierait la sienne. Le mode « Trad » détourne le clic partout à
la fois, une bonne fois, plutôt que d'instrumenter chaque bouton.

Allumé (réglage `modeTrad`, même `config.json` que `verifTraduction`, voir plus haut), un
clic sur un texte d'un panneau du cockpit n'exécute plus l'action normale : il ouvre le
formulaire de suggestion sur CE texte, avec `cible: 'interface'`.

### Comment la clé est retrouvée

Une webview ne reçoit que des chaînes déjà résolues : au moment où un bouton s'affiche,
la clé qui a produit son texte (`T('regl.titre')` par exemple) est perdue. Pour qu'une
suggestion d'interface serve à quelque chose, il faut la retrouver.

- **L'index** (`lib/index-textes.js`) est construit UNE FOIS par l'hôte, depuis la table de
  la langue courante (`construireIndex(TEXTES_COCKPIT[langue])`, `indexTradCourant()` dans
  `extension.js` ~l. 4631, mis en cache et refait seulement si la langue change), et envoyé
  aux panneaux **seulement quand le mode est allumé** — la table pèse plusieurs dizaines de
  kilo-octets et éteint il n'y a rien à chercher.
- **Recherche EXACTE d'abord** (`index.exact`, un texte normalisé → une ou plusieurs clés) :
  les espaces qui varient entre la table et le DOM (insécable, retours à la ligne
  d'indentation d'un gabarit) sont réduits avant comparaison (`normaliser()`).
- **Puis par MOTIF** (`index.motifs`) pour les textes à trou du genre « Volume {0} » : le
  gabarit est découpé en morceaux littéraux (`morceaux()`), et `motifColle()` exige qu'un
  trou vaille au moins un caractère — sans quoi « Volume {0} » reconnaîtrait « Volume », qui
  est un autre libellé. Un motif dont la part fixe est trop courte (moins de `MIN_FIXE` = 8
  caractères, ex. `{0} : {1}`) n'entre pas du tout dans l'index : il attraperait n'importe
  quelle ligne de la forme.
- **Plusieurs clés possibles** pour un même texte (deux libellés qui valent tous les deux
  « Titre », par exemple) : l'index les rend toutes, le formulaire propose un `<select>`, et
  c'est la personne devant l'écran qui tranche — l'outil ne choisit pas à sa place.
- **Un texte non retrouvé ouvre quand même le formulaire**, sans clé (`cle: null`,
  `cles: []`) : une suggestion sur un texte non identifié vaut mieux que rien, et c'est
  justement celui-là qu'un mainteneur veut voir.
- La recherche existe en **double**, volontairement : `lib/index-textes.js` côté hôte
  (module pur, testé seul), et sa copie `trouverClesTrad()` dans `media/_commun.js`
  (~l. 680-721) côté page, qui consulte l'index reçu à chaque clic. Les deux DOIVENT rendre
  exactement la même chose ; `test/js/mode-trad.test.js` compare les deux réponses sur un
  même texte pour s'en assurer — deux implémentations qui divergeraient seraient invisibles
  à l'écran.

### Le clic détourné, côté page (`media/_commun.js`)

L'interception est écrite UNE FOIS dans le socle partagé, et vaut pour toutes les pages :

- Un seul écouteur `click` réel, posé sur `document.body` **en capture** (avant tout
  gestionnaire posé sur un descendant), qui appelle `surClicTrad()`. Le clic est bloqué
  (`preventDefault` + `stopPropagation`) **avant** de savoir si un texte a été trouvé : sinon
  un clic dans la marge d'un bouton ferait l'action normale pendant que le bandeau annonce le
  contraire.
- **Le texte visé** est celui de l'élément le plus proche qui en porte un, en remontant le
  DOM depuis la cible du clic (`texteCliquable()`) — cliquer un pictogramme dans un bouton
  rend le texte du bouton, pas celui de toute la page.
- **Ce qui n'est PAS un libellé de l'outil** : la valeur tapée dans un champ de saisie
  (`<input type="text">`) n'est jamais captée comme texte cliqué — seuls `placeholder`,
  `title` et `aria-label` le sont. Un rédacteur qui clique dans son propre texte ne verra
  jamais ce texte partir en suggestion.
- Le message posté à l'hôte : `{ type: SZH.MSG.SUGGERER_INTERFACE, texte, cles }`.

### LES DEUX GARDE-FOUS

Un mode qui détourne TOUS les clics peut s'enfermer lui-même — c'est le défaut à empêcher
avant tout autre, et il ne se voit sur aucune capture d'écran : la page a l'air normale, elle
ne répond simplement plus.

1. **On doit toujours pouvoir l'éteindre.** La page des **réglages** et le **formulaire de
   suggestion** ne détournent JAMAIS leurs propres clics : chacun appelle
   `SZH.modeTradJamais()` en tête de son script (`media/settings.js` ~l. 6,
   `media/suggestion.js` ~l. 52) et ne demande même pas l'index à l'hôte. Sans cette
   exclusion, allumer le mode rendrait « Enregistrer la suggestion » et les boutons radio des
   réglages inatteignables — on ne pourrait plus l'éteindre. Deux sorties existent en plus,
   **depuis n'importe quel autre panneau** : le bouton du bandeau, et la touche **Échap**
   (`eteindreTrad()`, `media/_commun.js` ~l. 823 : la page redevient cliquable tout de suite,
   puis prévient l'hôte, qui écrit le réglage et le redit à tous les panneaux ouverts via
   `diffuserModeTrad()`, `extension.js` ~l. 4699).
2. **Le mode se VOIT.** Un outil dont plus aucun bouton ne répond, sans un mot, passe pour
   cassé. Tout panneau qui détourne pose un bandeau en tête de page (`.szh-trad-bandeau`,
   `poserBandeau()`) qui dit ce qu'un clic va faire et comment sortir ; il disparaît dès que
   le mode s'éteint.

Côté hôte, chaque gestionnaire de messages de panneau appelle
`if (repondreModeTrad(panneau, msg)) { return; }` en tête (`extension.js` ~l. 4654), **sauf
les deux gardiens du mode** — `ouvrirReglages` et `montrerPanneauSuggestion` — nommés
explicitement, avec leur raison, dans `PANNEAUX_SANS_MODE_TRAD`
(`test/js/mode-trad.test.js` ~l. 601). Les modules de `lib/` qui créent un panneau
(`metadonnees-hote.js`, `documentation-hote.js`, `medias-hote.js`, `apercu.js`) ne voient pas
`extension.js` directement : ils reçoivent le rappel `repondreModeTrad` par leur fonction
`configurer(ctx)`, avec un défaut `() => false` — un module non configuré ne détourne rien,
plutôt que de planter ou de détourner par accident.

### Ce que le mode « Trad » ne peut PAS atteindre

Uniquement ce qui vit dans une page web du cockpit. Les surfaces de **VSCodium lui-même** —
notifications (`showInformationMessage`…), boîtes de saisie, noms de commandes de la palette,
arborescence de fichiers, barre d'état — n'en sont pas : ce sont des éléments natifs de
l'éditeur, pas des webviews, et aucun clic dessus ne passe par `media/_commun.js`. C'est
exactement ce que couvre le **fichier de langue exporté** (section suivante), et c'est
pourquoi les deux fonctionnalités sont livrées ensemble : l'une relit ce qui s'affiche dans
une page, l'autre donne à relire tout le reste.

### Le test statique : `test/js/mode-trad.test.js`

Un test de comportement peut être vert alors qu'un panneau entier a été oublié — rien ne
casse, il répond simplement normalement, mode allumé, et la personne croit le mode en panne.
Le dernier test du fichier (`« mode trad : tout panneau détourne ses clics… »`, ~l. 648)
lit donc les SOURCES de l'hôte (`extension.js` et `lib/*.js`), retrouve tout gestionnaire
`webview.onDidReceiveMessage(`, et exige la garde dans ses six premières lignes — sauf les
deux exclus de `PANNEAUX_SANS_MODE_TRAD`, vérifiés eux aussi (une dispense dont la fonction
n'existe plus plante le test, pour ne pas protéger un panneau imaginaire). Un panneau neuf
entre donc dans la liste tout seul, et ce test échoue tant que sa garde n'est pas posée —
c'est lui qui empêchera le prochain panneau d'être oublié.

## Les suggestions d'interface (`cible: 'interface'`)

Une suggestion d'interface ne concerne **aucun numéro** : elle est écrite par
`ecrireSuggestionInterface()` dans `%LOCALAPPDATA%\SZH\suggestions-interface\`
(`dossierSuggestionsInterface()`, `lib/suggestion-traduction.js` ~l. 141), un fichier JSON
par suggestion, nommé `<horodatage>-<clé ou « sans-cle »>-<langue>.json`.

- **Le mode d'emploi** (`TEXTE_LISEZ_MOI_INTERFACE`) est une variante bilingue de celui du
  dossier `traduction/`, adaptée : pas de `meta.yaml` ici, mais « transmettez ce dossier à la
  personne qui gère l'outil ».
- **Ouverte par `ouvrirSuggestionInterface(msg)`** (`extension.js` ~l. 4854) : les clés que la
  page a proposées sont filtrées contre la table de langue courante (une clé que la webview
  invente n'a aucun sens) ; si aucune ne reste, l'hôte refait lui-même la recherche par motif
  (`indexTradCourant()`) plutôt que de laisser un texte candidat sans clé alors que la table
  en connaît une.
- **Les réglages affichent leur compte** (`compterSuggestionsInterface()`, `extension.js`
  ~l. 4689, via `listerSuggestionsInterface()`) et un bouton **« Ouvrir le dossier »**
  (`media/settings.js` ~l. 109-122) qui crée le dossier s'il n'existe pas encore et l'ouvre
  dans l'Explorateur (`vscode.env.openExternal`) — un bouton qui ne ferait rien la première
  fois passerait pour cassé.

## Le fichier de langue exporté (`lib/export-langue.js`)

Le pendant, pour l'interface elle-même, de `lib/suggestion-traduction.js` : une copie
lisible de tous les libellés du cockpit, à envoyer à qui relit — celui-ci ne propose rien
fichier par fichier, il exporte tout d'un coup.

- **Deux sources**, parce que les libellés visibles viennent de deux mécanismes
  indépendants : `cockpit` pour `TEXTES_COCKPIT` (`lib/i18n.js`, résolu par `T()` selon la
  langue du cockpit), et `commandes` pour `package.nls.json` / `package.nls.de.json`
  (résolus par VSCodium selon SA propre langue d'affichage — titres de commandes, tutoriel).
  N'exporter que l'une des deux laisserait la moitié des menus hors de la relecture
  (`nlsCommandes()`, `extension.js` ~l. 5319).
- **Le champ `_lire`**, bilingue (`fr` et `de` côte à côte) : la seule façon de mettre un
  avertissement dans un fichier JSON, qui ne supporte pas les commentaires. Il dit que le
  fichier est une COPIE, et que le corriger ne change rien à l'interface.
- **Schéma `szh-langue/1`** : `schema`, `_lire`, `genere` (horodatage ISO local, même
  convention que les suggestions), `extension`, `version`, `langues`, puis `entrees` — une
  par clé et par source, triée par source puis par clé, avec `null` pour une langue qui ne
  porte pas cette clé (jamais escamoté : c'est justement le trou qu'on veut voir signalé).
- **Module pur** (`construire()`, `serialiser()`) : ni `vscode`, ni `fs` ; les tables et les
  deux phrases d'avertissement lui sont passées par l'appelant
  (`telechargerFichierLangue()`, `extension.js` ~l. 5335).
- **Le bouton « Télécharger (JSON) »**, dans **Réglages SZH → Fichier de langue de
  l'interface** (`media/settings.js` ~l. 92-104) : poste `{ type: MSG.EXPORTER_LANGUE }` ;
  l'hôte ouvre une boîte d'enregistrement (une webview ne voit pas le disque), écrit le
  fichier, puis le révèle dans l'Explorateur — même geste que « Télécharger les réglages
  protégés ».

## Fichiers en jeu

| Fichier | Rôle |
|---|---|
| `lib/suggestion-traduction.js` | Module pur : noms de fichier, schéma JSON, `LISEZ-MOI.txt` (deux variantes), `geste`/`cible` et leur normalisation, `ecrireSuggestion`/`ecrireSuggestionInterface`, `listerSuggestions`/`listerSuggestionsInterface`, `champValide`/`langueValide`. Ni `vscode`, ni réglage d'éditeur. |
| `lib/archivage.js` | `CLE_VERIF_TRADUCTION` et `CLE_MODE_TRAD`, jumelles : `resoudre*`, `lire*`, `configAvec*`, `ecrire*`. Deux réglages indépendants, même `config.json`. |
| `lib/traduction.js` | `CHAMPS_TRADUISIBLES`, la référence que `suggestion-traduction.js` réutilise pour valider un champ d'article. |
| `lib/index-textes.js` | Module pur : `construireIndex(table)` → `{ exact, motifs }`, `trouverCles(index, texte)`. L'index du mode « Trad », construit par l'hôte et envoyé aux panneaux. |
| `lib/export-langue.js` | Module pur : `construire()`/`serialiser()` du fichier de langue exporté (schéma `szh-langue/1`, `_lire` bilingue, sources `cockpit` + `commandes`). |
| `extension.js` | Câblage des deux modes : lecture/écriture de `verifTrad` et `modeTrad` dans les réglages, `repondreModeTrad()` et les deux panneaux exclus, `indexTradCourant()`, `ouvrirSuggestionTraduction()` / `ouvrirSuggestionInterface()`, `enregistrerSuggestion()` (aiguille sur `cible`), `telechargerFichierLangue()`, ouverture/fermeture du panneau `szhSuggestionTraduction`. |
| `media/_fiches.js` | `pastilleTraduction()`, posée sur les trois champs simples et, séparément, sur les mots-clés par langue. |
| `media/traduction.js` | Sa propre pose de pastilles sur le panneau de traduction (même mécanisme, panneau distinct). |
| `media/_commun.js` | Socle partagé : l'écoute d'hôte chaînée (`ecouterHote`), et tout le mode « Trad » côté page — interception du clic (`surClicTrad`, capture sur `document.body`), recherche de clé (`trouverClesTrad`, copie de `lib/index-textes.js`), bandeau et sortie (`poserBandeau`, `eteindreTrad`), `SZH.modeTradJamais()`. |
| `media/settings.js` | Les groupes « Vérificateur de traduction » et « Mode « Trad » » (radios `verifTrad`/`modeTrad`), le bouton d'export du fichier de langue, le compte et le bouton des suggestions d'interface. `SZH.modeTradJamais()` en tête. |
| `media/suggestion.js`, `media/suggestion.html`, `media/suggestion.css` | Le formulaire de proposition, commun aux deux cibles (`article`/`interface`) : les deux gestes (`remplacer`/`supprimer`, bouton-interrupteur), le `<select>` des clés candidates. `SZH.modeTradJamais()` en tête. |
| `test/js/suggestion-traduction.test.js` | Éprouve le module `lib/suggestion-traduction.js` : aller-retour écriture/lecture, dossier frère de `articles/`, `LISEZ-MOI` posé une fois, lecture tolérante, réglage éteint par défaut et tolérant à un `config.json` écrit à la main. |
| `test/js/mode-trad.test.js` | Éprouve l'index, les suggestions d'interface, le réglage `modeTrad`, l'interception dans les vraies pages (clic détourné, bandeau, sorties), et surtout le contrôle statique qui exige la garde dans tout gestionnaire de panneau — voir « Le test statique » plus haut. |
