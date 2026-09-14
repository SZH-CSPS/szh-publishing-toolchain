# Le vérificateur de traduction

Un mode du cockpit qui laisse quiconque relit une traduction **proposer** un autre texte,
sans jamais pouvoir **écrire** dans la fiche de l'article. Il cohabite avec le panneau
« Traductions » existant (`lib/traduction.js`, `.traduction.yaml`) qui, lui, édite pour de bon
le texte publié — les deux gestes ne se gênent pas, mais il ne faut pas les confondre : l'un
propose, l'autre publie.

## Le réglage : `verifTraduction`

Rangé dans `C:\ProgramData\SZH\config.json`, clé `verifTraduction` (`CLE_VERIF_TRADUCTION`,
`lib/archivage.js`) — pas dans les réglages de VSCodium. Deux raisons, dites dans le code
(`lib/archivage.js`, juste avant `CLE_VERIF_TRADUCTION`) : trois panneaux le lisent (fiches,
vérification de l'import, traduction), et la mise à jour du poste réécrit en entier les
réglages de l'éditeur — le mode s'y éteindrait à chaque mise à jour.

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
2. **L'hôte** (`ouvrirSuggestionTraduction`, `extension.js` ~l. 4666) vérifie `champ` et
   `langue` contre `suggestionTraduction.champValide` / `langueValide` — un message de
   webview n'est jamais réputé sûr — puis ouvre (ou recharge) un panneau webview
   `szhSuggestionTraduction`, à côté (`ViewColumn.Beside`) : un seul panneau à la fois, une
   seconde pastille le recharge sur son champ plutôt que d'ouvrir un second onglet.
3. **Le formulaire** (`media/suggestion.js` + `suggestion.html`) affiche l'article, le champ
   et la langue visés, le texte actuel en lecture seule, une zone **« Traduction proposée »**
   pré-remplie du texte actuel (on corrige plus souvent qu'on ne réécrit), et un commentaire
   libre. **« Enregistrer la suggestion »** poste `{ type: MSG.ENREGISTRER, slug, champ,
   langue, actuel, propose, commentaire }` ; **« Annuler »** ferme sans rien écrire. Une
   proposition identique au texte actuel et sans commentaire est refusée côté webview
   d'abord, puis — c'est lui qui fait foi — côté hôte (`estVide()`).
4. **L'écriture** (`enregistrerSuggestion()`, `extension.js` ~l. 4635, via
   `lib/suggestion-traduction.js#ecrireSuggestion`) dépose **un fichier JSON par suggestion**
   dans `<racine-du-numéro>/traduction/` — jamais un fichier commun : ces dossiers sont
   synchronisés par OneDrive, et deux personnes qui écriraient tour à tour le même fichier
   produiraient une copie en conflit, où l'une des deux suggestions se perdrait. Le panneau se
   ferme tout seul 1,2 s après confirmation.

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
  suggestions aujourd'hui, seul `test/js/suggestion-traduction.test.js` l'éprouve. Une
  suggestion déposée attend donc d'être ouverte à la main (explorateur de fichiers, ou un
  futur panneau de relecture) — c'est un pense-bête, pas encore un tableau de bord.

## Limite connue : un panneau déjà ouvert ne se met pas à jour tout seul

Activer ou désactiver le réglage ne touche à aucun panneau déjà affiché : chaque webview reçoit
`verifTrad` dans le message `valeurs` que l'hôte lui envoie, et ce n'est qu'à ce moment que les
cartes sont reconstruites avec ou sans pastille. Ce message ne repart pas tout seul quand le
réglage change ; il faut un nouvel événement qui force l'hôte à le renvoyer :

- **« Toutes les fiches »** (`ouvrirApercuMetadonnees`, `lib/metadonnees-hote.js` ~l. 1046) :
  au changement de filtre (`appliquerFiltre`), à un rechargement forcé (fiche périmée), ou à la
  réouverture du panneau (`reveal`) ;
- **« Vérification de l'import »** (`ouvrirImportVerif`, `extension.js` ~l. 4812) : à sa
  réouverture, ou après un enregistrement qui force un rechargement (`res.recharger`) ;
- **Panneau de traduction** (`envoyerValeursTraduction`, `extension.js` ~l. 4290) : au
  changement d'article affiché, ou à un rechargement.

Concrètement : un panneau resté ouvert à l'écran au moment du basculement ne montre (ou ne
cache) les pastilles qu'à son prochain changement d'article, de filtre, ou à sa réouverture —
jamais tout seul, jamais en direct sur les cartes déjà affichées.

## Fichiers en jeu

| Fichier | Rôle |
|---|---|
| `lib/suggestion-traduction.js` | Module pur : noms de fichier, schéma JSON, `LISEZ-MOI.txt`, `ecrireSuggestion`, `listerSuggestions`, `champValide`/`langueValide`. Ni `vscode`, ni réglage d'éditeur. |
| `lib/archivage.js` | `CLE_VERIF_TRADUCTION`, `resoudreVerifTraduction`, `lireVerifTraduction`, `configAvecVerifTraduction`, `ecrireVerifTraduction`. |
| `lib/traduction.js` | `CHAMPS_TRADUISIBLES`, la référence que `suggestion-traduction.js` réutilise pour valider un champ. |
| `extension.js` | Câblage : lecture du réglage dans les trois messages `valeurs`, écriture du réglage (branche `verifTrad`), ouverture/fermeture du panneau `szhSuggestionTraduction`, écriture de la suggestion. |
| `media/_fiches.js` | `pastilleTraduction()`, posée sur les trois champs simples et, séparément, sur les mots-clés par langue. |
| `media/traduction.js` | Sa propre pose de pastilles sur le panneau de traduction (même mécanisme, panneau distinct). |
| `media/suggestion.js`, `media/suggestion.html`, `media/suggestion.css` | Le formulaire de proposition. |
| `test/js/suggestion-traduction.test.js` | Éprouve le module `lib/suggestion-traduction.js` : aller-retour écriture/lecture, dossier frère de `articles/`, `LISEZ-MOI` posé une fois, lecture tolérante, réglage éteint par défaut et tolérant à un `config.json` écrit à la main. |
