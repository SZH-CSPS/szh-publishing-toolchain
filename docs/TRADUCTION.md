# Le vérificateur de traduction et le mode « Trad »

Le cockpit offre deux façons de **proposer** une meilleure traduction sans rien modifier :

| Mode | Réglage | Pour quoi | Où vont les suggestions |
|---|---|---|---|
| vérificateur de traduction | `verifTraduction` | les quatre champs traduisibles d'un article | `<numéro>/traduction/` |
| mode « Trad » | `modeTrad` | les textes de l'outil lui-même : boutons, formulaires, messages | `%LOCALAPPDATA%\SZH\suggestions-interface\` sur le poste |

Les deux modes sont indépendants : chacun s'allume sans l'autre, et les deux peuvent être allumés
ensemble. Ils écrivent par le même module (`lib/suggestion-traduction.js`) et ouvrent le même
formulaire (`media/suggestion.js`).

Ils ne se confondent pas avec le panneau « Traductions » (`lib/traduction.js`,
`lib/traduction-hote.js`, fichier `.traduction.yaml`), qui modifie pour de bon le texte publié.
Les deux modes proposent ; seul le panneau publie.

Un troisième outil complète le mode « Trad » : le [fichier de langue exporté](#le-fichier-de-langue-exporté),
qui donne à relire tous les libellés d'un coup.

## Les réglages

Les deux réglages sont rangés dans `C:\ProgramData\SZH\config.json`, sous les clés
`verifTraduction` et `modeTrad`, et non dans les réglages de VSCodium. Plusieurs panneaux les
lisent, et la mise à jour du poste réécrit les réglages de l'éditeur : un mode rangé là
s'éteindrait à chaque mise à jour.

| Fonction (`lib/archivage.js`) | Rôle |
|---|---|
| `lireVerifTraduction()`, `lireModeTrad()` | lisent le réglage. `true`, `"true"` et `1` valent allumé (`normaliserBooleenConfig`). Absent, illisible ou faux : éteint |
| `configAvecVerifTraduction()`, `configAvecModeTrad()` | rendent la configuration modifiée, avec un booléen propre |
| `CLE_VERIF_TRADUCTION`, `CLE_MODE_TRAD` | les noms des clés |

Les deux se règlent dans Accueil > Paramètres, groupe « Traduction » : un choix Activé / Désactivé
pour chacun (`media/accueil.js`, message `{ type: 'regler', cle: 'verifTrad' | 'modeTrad',
valeur: 'actif' | 'inactif' }`, traité par `lib/reglages-hote.js`). Un `config.json` illisible
n'est pas écrasé : il porte aussi l'emplacement des revues et la configuration OJS.

## Le vérificateur de traduction

### Les champs concernés

Les quatre champs traduisibles d'un article (`CHAMPS_TRADUISIBLES` de `lib/traduction.js`) :
`title`, `subtitle`, `resume` et `keywords`, chacun par langue (`fr`, `de`, et `it` quand la carte
l'active). Ils vivent dans `articles/<slug>/<slug>.meta.yaml`. `ausgabe.yaml` et le profil livre
n'en ont pas.

Une **pastille** se pose sur chaque champ et chaque langue. Pour `keywords`, il y a une pastille
par langue, pas une par mot-clé : le champ traduisible est la liste entière. Elle capte tous les
mots-clés de la langue, un par ligne.

Les pastilles apparaissent dans trois panneaux : « Toutes les fiches », « Vérification de
l'import » et le panneau « Traductions ».

### Le trajet d'une suggestion

1. **La pastille** (`pastilleTraduction()`, `media/_fiches.js` ; le panneau « Traductions » pose
   les siennes dans `media/traduction.js`) n'apparait que si le réglage est allumé et que le champ
   a une langue. Au clic, elle lit la valeur du champ à cet instant, frappe en cours comprise, et
   envoie `{ type: MSG.SUGGERER_TRADUCTION, slug, champ, langue, valeur }`.
2. **L'hôte** (`ouvrirSuggestionTraduction()`, `lib/traduction-hote.js`) vérifie `champ` et
   `langue` (`champValide`, `langueValide`) : un message de page n'est jamais réputé sûr. Il ouvre
   le formulaire à côté de l'éditeur. Un seul formulaire est ouvert à la fois : une seconde
   pastille le recharge sur son champ.
3. **Le formulaire** (`media/suggestion.js`, `suggestion.html`) montre l'article, le champ, la
   langue et le texte actuel en lecture seule. La zone « Traduction proposée » est préremplie du
   texte actuel, car on corrige plus souvent qu'on ne réécrit. Un commentaire libre s'ajoute.
4. **L'écriture** (`enregistrerSuggestion()`, `lib/traduction-hote.js`, puis `ecrireSuggestion()`)
   dépose un fichier JSON par suggestion dans `<numéro>/traduction/`. Le formulaire se ferme seul
   1,2 seconde après la confirmation.

Le formulaire offre deux gestes :

| Geste | Comment | `propose` |
|---|---|---|
| `remplacer` (par défaut) | « Enregistrer la suggestion » | le texte de la zone « Traduction proposée » |
| `supprimer` | « Proposer de supprimer ce texte » arme le geste : la zone disparait, un bandeau dit « Sera enregistré : ce texte ne devrait pas exister… ». « Enregistrer la suggestion » envoie. Un second clic sur le bouton désarme le geste (`aria-pressed`) | toujours `''` |

« Annuler » ferme sans rien écrire.

Une suggestion `remplacer` identique au texte actuel et sans commentaire est refusée, d'abord par
le formulaire, puis par l'hôte (`estVide()`), qui fait foi. Une suppression échappe à ce refus :
elle porte à elle seule tout son propos.

### Le dossier `traduction/`

- Il est à côté de `articles/`, jamais dedans (`dossierSuggestions()`) : les recensements
  d'articles du cockpit listent les sous-dossiers de `articles/`, et y prendraient ce dossier pour
  un article.
- Un fichier par suggestion, jamais un fichier commun : le dossier est synchronisé par OneDrive, et
  deux personnes qui écriraient tour à tour le même fichier produiraient une copie en conflit.
- Nom : `<AAAAMMJJ-HHMMSS>-<article>-<champ>-<langue>.json`, en heure locale. Un suffixe `-2`,
  `-3` (`nomLibre()`) évite d'écraser une suggestion faite dans la même seconde.
- `LISEZ-MOI.txt`, bilingue (fr puis `[de]`), en CRLF, est posé à la création du dossier
  (`poserLisezMoi()`) et jamais réécrit : quelqu'un a pu l'annoter.
- Rien dans le cockpit ne relit encore ces suggestions : on les ouvre à la main, dans
  l'Explorateur. `listerSuggestions()` existe et est testé.

### Le format d'une suggestion : `szh-suggestion-traduction/1`

```json
{
  "schema": "szh-suggestion-traduction/1",
  "horodatage": "2026-10-07T14:03:12+02:00",
  "auteur": "Anne",
  "cible": "article",
  "produit": "revue",
  "numero": "2026-04",
  "article": "03-inclusion-scolaire",
  "champ": "resume",
  "langue": "de",
  "geste": "remplacer",
  "actuel": "…",
  "propose": "…",
  "commentaire": "…"
}
```

| Champ | Règle |
|---|---|
| `schema` | `szh-suggestion-traduction/1` |
| `cible` | `article` ou `interface`. Absent, il se lit `article` (`normaliserCible`) |
| `geste` | `remplacer` ou `supprimer`. Toute valeur autre que `supprimer` se lit `remplacer` (`normaliserGeste`) |
| `horodatage` | ISO 8601 en heure locale, décalage compris : l'heure que la personne avait sous les yeux |
| `auteur` | le réglage `szh.nomUtilisateur`, sinon le compte Windows ; 80 caractères au plus |
| `produit`, `numero`, `article`, `champ` | cible `article` seulement |
| `cle`, `cles` | cible `interface` seulement : la clé du libellé retrouvée (ou `null`), et les candidates |
| `langue` | la langue du texte visé |
| `actuel`, `propose`, `commentaire` | le texte actuel, la proposition, le commentaire |

`cible` et `geste` ont été ajoutés sans changer la version du schéma ; leurs valeurs par défaut
gardent lisibles les fichiers qui ne les portent pas.

`listerSuggestions()` saute un fichier illisible ou mal formé (synchronisation en cours, édition
à la main ratée), trie du plus récent au plus ancien, et départage les égalités par le nom de
fichier.

### Limite : un panneau ouvert ne se met pas à jour

Changer le réglage `verifTraduction` ne touche pas les panneaux déjà ouverts. Chaque panneau
reçoit le réglage avec ses valeurs, et ne pose ou n'ôte les pastilles qu'à son prochain envoi :

| Panneau | Ce qui renvoie les valeurs |
|---|---|
| « Toutes les fiches » (`lib/metadonnees-hote.js`) | un changement de filtre, un rechargement, la réouverture du panneau |
| « Vérification de l'import » (`lib/import-verif-hote.js`) | la réouverture, ou un enregistrement qui recharge |
| « Traductions » (`lib/traduction-hote.js`) | un changement d'article, un rechargement |

Le mode « Trad », lui, est diffusé tout de suite à tous les panneaux ouverts.

## Le mode « Trad »

Les textes de l'interface sont plus de 2 000 par langue (`TEXTES_COCKPIT`, `lib/i18n.js`), créés
à des centaines d'endroits du code. Plutôt que de poser une pastille sur chacun, le mode « Trad »
détourne le clic partout à la fois.

Allumé, un clic sur un texte d'un panneau du cockpit n'exécute plus l'action : il ouvre le
formulaire de suggestion sur ce texte, avec `cible: 'interface'`.

### Retrouver la clé d'un texte

Une page ne reçoit que des textes déjà traduits : la clé qui a produit un texte (`T('regl.titre')`)
est perdue. Le mode la retrouve par un index.

- **L'index** (`lib/index-textes.js`) est construit par l'hôte depuis la table de la langue
  courante (`construireIndex(TEXTES_COCKPIT[langue])`, `indexTradCourant()`), gardé en cache et
  refait si la langue change. Il n'est envoyé qu'aux panneaux qui le demandent, mode allumé.
- **Recherche exacte d'abord** (`index.exact`) : un texte normalisé donne une ou plusieurs clés.
  Les espaces qui varient entre la table et la page (insécables, retours à la ligne d'un gabarit)
  sont réduits avant de comparer (`normaliser()`).
- **Puis par motif** (`index.motifs`), pour les textes à trou comme « Volume {0} ». Un trou vaut au
  moins un caractère (`motifColle()`) : « Volume {0} » ne reconnaît pas « Volume », qui est un
  autre libellé. Un motif dont la partie fixe fait moins de 8 caractères (`MIN_FIXE`, par exemple
  `{0} : {1}`) n'entre pas dans l'index : il reconnaîtrait n'importe quoi.
- **Plusieurs clés** pour un même texte : le formulaire les propose dans une liste, et la personne
  choisit.
- **Aucune clé** : le formulaire s'ouvre quand même, avec `cle: null` et `cles: []`. C'est
  justement le texte qu'un mainteneur veut voir.
- La recherche existe deux fois : dans `lib/index-textes.js` côté hôte, et dans
  `trouverClesTrad()` de `media/_commun.js` côté page. `test/js/mode-trad.test.js` vérifie
  qu'elles rendent la même chose.

### Le clic détourné, côté page

Tout est dans `media/_commun.js`, et vaut pour toutes les pages :

- un seul écouteur `click`, posé sur `document.body` en phase de capture, appelle `surClicTrad()`.
  Le clic est bloqué (`preventDefault`, `stopPropagation`) avant même de chercher le texte : sinon
  un clic dans la marge d'un bouton ferait l'action pendant que le bandeau annonce le contraire ;
- le texte visé est celui de l'élément le plus proche qui en porte un, en remontant depuis la
  cible du clic (`texteCliquable()`) : un pictogramme dans un bouton donne le texte du bouton ;
- la valeur tapée dans un champ de saisie n'est jamais captée. Seuls `placeholder`, `title` et
  `aria-label` le sont : un rédacteur qui clique dans son texte ne l'envoie pas en suggestion ;
- le message envoyé à l'hôte : `{ type: MSG.SUGGERER_INTERFACE, texte, cles }`.

### Toujours pouvoir sortir

Un mode qui détourne tous les clics pourrait s'enfermer lui-même : la page aurait l'air normale,
et ne répondrait plus. Trois règles l'empêchent :

1. **Le formulaire de suggestion ne détourne pas ses propres clics.** Il appelle
   `SZH.modeTradJamais()` en tête de son script et ne demande pas l'index.
2. **Les réglages restent cliquables.** Dans l'Accueil, la barre d'onglets et l'onglet Paramètres
   portent `data-trad-exempt` (`exempteTrad()`) : on peut toujours éteindre le mode là où on l'a
   allumé.
3. **Le mode se voit et s'éteint partout.** Chaque panneau qui détourne affiche un bandeau en tête
   (`.szh-trad-bandeau`, `poserBandeau()`) qui dit ce que fait un clic et comment sortir. Le bouton
   du bandeau et la touche Échap éteignent le mode (`eteindreTrad()`) : la page redevient
   cliquable tout de suite, puis l'hôte écrit le réglage et le diffuse à tous les panneaux
   ouverts (`diffuserModeTrad()`).

### Côté hôte

- `repondreModeTrad(panneau, msg)` (`lib/traduction-hote.js`) traite les messages du mode et rend
  vrai quand il les a pris en charge.
- Un panneau créé par `panneauUnique` (`lib/webviews/panneau.js`) passe l'option
  `modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg)` ; la fabrique l'appelle avant
  tout autre traitement.
- Un gestionnaire `webview.onDidReceiveMessage(` écrit à la main commence par
  `if (repondreModeTrad(panneau, msg)) { return; }`.
- Les modules de `lib/` reçoivent ce rappel par `configurer(ctx)`. Leur valeur par défaut est
  `require('./traduction-hote').repondreModeTrad` : même un module mal configuré détourne les
  clics.
- Deux panneaux ne détournent pas, et sont nommés avec leur raison dans
  `PANNEAUX_SANS_MODE_TRAD` (`test/js/mode-trad.test.js`) : le formulaire de suggestion
  (`montrerPanneauSuggestion`) et « Quoi de neuf » (`montrerNouveautes`), dont le texte ne vient
  pas de `lib/i18n.js`.

`test/js/mode-trad.test.js` lit les sources de `extension.js` et de `lib/*.js`, retrouve chaque
`webview.onDidReceiveMessage(` et chaque `panneauUnique({`, et exige la garde. Un panneau neuf
sans garde fait échouer le test. Une dispense dont la fonction n'existe plus le fait échouer
aussi.

### Ce que le mode ne peut pas atteindre

Seulement ce qui est dans une page du cockpit. Les éléments propres à VSCodium (notifications,
boîtes de saisie, noms de commandes de la palette, arborescence de fichiers, barre d'état) ne
passent pas par `media/_commun.js`. Le fichier de langue exporté les couvre.

### Les suggestions d'interface

- `ecrireSuggestionInterface()` les écrit dans `%LOCALAPPDATA%\SZH\suggestions-interface\`
  (`dossierSuggestionsInterface()`), un fichier JSON par suggestion, nommé
  `<horodatage>-<clé ou sans-cle>-<langue>.json`. Un libellé de l'outil ne concerne aucun numéro.
- Le dossier reçoit son propre `LISEZ-MOI.txt` (`TEXTE_LISEZ_MOI_INTERFACE`), qui demande de
  transmettre le dossier à la personne qui gère l'outil.
- `ouvrirSuggestionInterface()` (`lib/traduction-hote.js`) ne garde que les clés proposées par la
  page qui existent dans la table de langue courante. S'il n'en reste aucune, l'hôte refait la
  recherche par motif lui-même.
- Accueil > Paramètres > Traduction affiche le nombre de suggestions
  (`compterSuggestionsInterface()`) et un bouton « Ouvrir le dossier », qui crée le dossier s'il
  manque puis l'ouvre dans l'Explorateur.

## Le fichier de langue exporté

`lib/export-langue.js` produit une copie lisible de tous les libellés du cockpit, à envoyer à qui
relit.

- **Deux sources** : `cockpit`, la table `TEXTES_COCKPIT` (`lib/i18n.js`), dans la langue du
  cockpit ; et `commandes`, `package.nls.json` et `package.nls.de.json`, que VSCodium affiche dans
  sa propre langue (titres de commandes, tutoriel). Sans la seconde, la moitié des menus
  échapperait à la relecture (`nlsCommandes()`, `lib/reglages-hote.js`).
- **Le champ `_lire`**, en fr et en de : JSON n'a pas de commentaires, ce champ dit que le fichier
  est une copie et que le corriger ne change rien à l'interface.
- **Schéma `szh-langue/1`** : `schema`, `_lire`, `genere` (ISO en heure locale), `extension`,
  `version`, `langues`, puis `entrees`, une par clé et par source, triées par source puis par clé.
  Une langue qui n'a pas la clé vaut `null` : c'est le trou qu'on veut voir.
- **Module pur** (`construire()`, `serialiser()`), sans `vscode` ni `fs` : les tables et les
  phrases d'avertissement lui sont passées par `telechargerFichierLangue()`
  (`lib/reglages-hote.js`).
- **Le bouton** « Télécharger (JSON) », dans Accueil > Paramètres > Traduction, rangée « Fichier
  de langue de l'interface », envoie `{ type: MSG.EXPORTER_LANGUE }`. L'hôte ouvre une boîte
  d'enregistrement, écrit le fichier, puis le montre dans l'Explorateur.

## Fichiers en jeu

| Fichier | Rôle |
|---|---|
| `lib/suggestion-traduction.js` | module pur : noms de fichier, schéma, `LISEZ-MOI.txt` (deux variantes), `geste` et `cible`, écriture et lecture des suggestions, `champValide`, `langueValide` |
| `lib/archivage.js` | les deux réglages dans `config.json` |
| `lib/traduction.js` | `CHAMPS_TRADUISIBLES`, qui valide un champ d'article |
| `lib/traduction-hote.js` | côté hôte : formulaire de suggestion, `repondreModeTrad()`, index du mode, écriture des suggestions |
| `lib/reglages-hote.js` | écriture des réglages, compte et dossier des suggestions d'interface, export du fichier de langue |
| `lib/index-textes.js` | module pur : `construireIndex(table)` → `{ exact, motifs }`, `trouverCles(index, texte)` |
| `lib/export-langue.js` | module pur : le fichier de langue exporté |
| `media/_fiches.js`, `media/traduction.js` | la pose des pastilles |
| `media/_commun.js` | le mode « Trad » côté page : clic détourné, recherche de clé, bandeau, sortie, `SZH.modeTradJamais()` |
| `media/accueil.js` | le groupe « Traduction » des Paramètres |
| `media/suggestion.js`, `.html`, `.css` | le formulaire, commun aux deux cibles |
| `test/js/suggestion-traduction.test.js` | le module de suggestions et le réglage du vérificateur |
| `test/js/mode-trad.test.js` | l'index, les suggestions d'interface, le réglage `modeTrad`, l'interception dans les vraies pages, et le contrôle de la garde dans tout panneau |
