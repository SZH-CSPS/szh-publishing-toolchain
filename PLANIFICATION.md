# Planification — lot de corrections A–H (2026-08-25)

Pilotage du lot demandé le 25.08.2026. Chaque lot suit le même protocole :

1. **Implémentation** par un agent dédié (posture senior-software-engineer) : code + tests, suite `node --test` verte.
2. **Vérification d'impact** par un second agent : relecture du diff, contrats transverses, effets de bord sur le reste du programme.
3. **Validation** par le chef d'orchestre : re-lecture, re-exécution des tests, arbitrage des constats.

Aucun commit n'est fait sans accord explicite de Robin ; à la fin, un découpage de commits par lot sera proposé.

## Décisions actées avec Robin (25.08.2026)

- **A** : au changement de langue, les contenus sont **permutés** entre l'ancienne et la nouvelle langue (rien n'est perdu).
- **B** : « cacher l'aperçu » = ne plus ouvrir automatiquement l'aperçu compilé en colonne 2 quand on ouvre un article **depuis la vue d'ensemble Articles** (le .md s'ouvre seul ; Ctrl+Alt+P reste disponible).
- **D** : le réglage ne touche que les seuils de résolution d'images ; le comportement CMYK (conversion silencieuse) reste inchangé.
- **H** : accès **OAI-PMH public** (pas de token API). Conséquence assumée : seuls les **noms** d'auteur·e·s sont disponibles — pas d'email, fonction ni lieu de travail. L'autocomplétion ne préremplira que prénom/nom. Piste d'évolution notée : clé API OJS plus tard pour enrichir.
- **H bis** : usage = **autocomplétion** dans la modale d'édition d'un auteur.
- **G bis** : l'arbre latéral **reste un TreeView natif** (pas de webview) — on garde le drag & drop et les menus contextuels ; mise en évidence dans les limites de l'API.

## Contraintes transverses (à rappeler à chaque agent)

- Pas de build, pas de bundler, **aucune dépendance npm nouvelle**. JS brut, `require` à l'exécution.
- **i18n obligatoire FR + DE** dans `lib/i18n.js` (deux entrées par clé, sinon repli silencieux).
- Webviews : données par `postMessage` uniquement, DOM construit à la main, **pas d'innerHTML**.
- Écritures **atomiques** (`ecrireAtomique`) — OneDrive/SharePoint.
- Trois miroirs revue/langue à garder synchrones : `lib/yaml.js`, `media/_numero.js`, `pipeline/filters/szh-maquette.lua`.
- `serialiserMeta` (lib/yaml.js) doit rester aligné sur `pipeline/docx-meta.py` (ordre des clés, jetons nus `lang`/`licence`).
- Tests : `test/js/*.test.js`, exécution `node --test test/js/`.
- Un seul calcul d'ordre/rang DOI : `lib/articles.js` (ne pas en réintroduire un second).

## Ordre d'exécution et suivi

| # | Lot | Taille | Statut |
|---|-----|--------|--------|
| 1 | F — aide description de tableau | XS | **fait, vérifié** (RAS ; bonus : 2e clé i18n fantôme `table.preset.note` retirée) |
| 2 | D — réglage « réduire les warnings d'impression » | S | **fait, vérifié** (RAS ; suite 355/355) |
| 3 | B — pas d'aperçu auto depuis la vue Articles | S | **fait, vérifié** (impact contrôlé par le chef d'orchestre ; compilation d'obsolescence sautée aussi, documenté) |
| 4 | C — blocs `:::` : sauts de ligne + remplacement | M | **fait, vérifié** (RAS ; note : sélection à cheval sur un bloc = défaut préexistant, hors lot) |
| 5 | E — perte de focus en fin de compilation | M | **fait, vérifié** (RAS ; notes : course résiduelle sur gestes enchaînés, avertirEchecCompilation hors garde — toast sans vol de focus) |
| 6 | G1 — DOI verrouillé, seul le calculé fait foi | M | **fait, vérifié** (bloquant PDF-sans-DOI détecté à la vérif d'impact et corrigé : fichier dérivé `dois-calcules.yaml` + repli Lua, preuve par compilation WSL ; **2 décisions à confirmer par Robin** : DOI manuel prioritaire à l'export ; carte affichant le calculé avec constat quand un manuel diverge) |
| 7 | G2 — arbre latéral : sections + ordre + séparation | S | **fait, vérifié** (impact contrôlé par le chef d'orchestre ; note : l'état plié/déplié mémorisé des sections se réinitialise une fois, la casse des libellés ayant changé) |
| 8 | A — langue de l'article pilote les champs | L | **fait, vérifié** (aucun bloquant ; preuve compilée `<html lang="it">` ; échec muet des statuts corrigé en avertissement ; notes pour Robin : lang invalide écrit à la main = permutation de statuts sans contenus ; trou de verrou préexistant des panneaux restés ouverts) |
| 9 | H — liste d'auteurs OAI-PMH + autocomplétion | L | **fait, vérifié** (endpoints réels découverts : `/index.php/revue/fr/oai` et `/index.php/zeitschrift/de/oai` ; client durci : redirections même-hôte, réponses bornées 20 Mo, délai total 60 s) |

## Bilan (25.08.2026, fin de chantier)

**9 lots implémentés et vérifiés, aucun commit.** Suite : **412 tests, 411 verts, 1 skip préexistant, 0 échec** (départ : 352). Chaque lot a été vérifié par un agent d'impact distinct (ou contrôle direct du chef d'orchestre pour les petites surfaces), avec 2 bloquants attrapés et corrigés avant validation (PDF sans bandeau DOI ; minuteur unref laissant une promesse pendante).

### Décisions confirmées par Robin (25.08.2026)
1. **DOI manuel prioritaire à l'export OJS** (lot 6) — confirmé tel quel ; « pas de DOI » l'emporte toujours.
2. **La carte affiche le DOI manuel quand il est défini**, étiqueté « manuel »/« manuell » (symétrique de l'étiquette « calculé ») — implémenté ; sans manuel, calculé inchangé.
3. **Commits par lot, push, tag et release** — approuvés.

## Lot I — arbre latéral : accordéon, clic-titre, marqueur d'article ouvert (26.08.2026)

Demandé par Robin le 26.08.2026, dans la continuité de G2/G bis (TreeView natif). **Fait, suite 417 tests : 416 verts, 1 skip préexistant, 0 échec.** Pas de commit.

1. **Accordéon des sections** : une seule section dépliée à la fois (« Articles » au départ) ; l'état vit dans le fournisseur (`sectionDeployee`) et l'`id` des en-têtes l'encode (`section:<cat>:ouvert|ferme`) pour passer outre la mémoire de pli de VS Code. Le chevron participe (`onDidExpandElement`/`onDidCollapseElement`).
2. **Clic sur un en-tête = déplier sa section** (`szh.basculerSection`), recliquer replie tout. Conséquence assumée : la vue d'ensemble n'est plus sur le clic de l'en-tête — elle passe sur un **bouton inline** `$(dashboard)` au bout de la ligne, et reste au clic droit.
3. **Marqueur « article ouvert »** : `FileDecorationProvider`, point `●` + couleur `list.highlightForeground` sur le .md de l'article auquel appartient le fichier actif (bibliographie et tableaux compris) ; suit `onDidChangeActiveTextEditor`, s'éteint hors des articles, reste quand le focus va à un aperçu/panneau.
4. **Resélection après reconstruction** (le « premier clic qui ne tient pas », diagnostiqué : l'id flippé recréait l'élément sélectionné) : `getParent()` + `reveal(select, focus:false)` après le rafraîchissement du clic ; id désormais posé sur tous les articles. `sansTexte` (panneau Traductions) ne touche pas à l'arbre.

Notes : tests hôte enrichis (accordéon commande + chevron, reveal, décoration) ; hôte factice appris `registerFileDecorationProvider`, événements d'expansion, enregistreur de `reveal`, éditeur actif déclenchable. Suggestion complémentaire hors code (déploiement) : `workbench.colorCustomizations.list.inactiveSelectionBackground` pour une sélection native plus soutenue.

### Lot J — le tableau des auteurs ne tombe plus en silence (v2026.08.51)

Parti d'un Word déposé par Robin le 26.08.2026 : à la conversion, les quatre autrices et auteurs
n'avaient ni fonction, ni e-mail, ni portrait. Cause unique — `TITRES_ACAD` connaissait `em`, la
forme allemande d'*émérite*, pas `ém`, la française. L'épluchage des titres s'arrête au premier
jeton inconnu, la cellule `r1c0` devenait illisible, et le jugement tout-ou-rien de
`analyser_table_auteurs()` emportait les trois cellules parfaitement lisibles avec elle. Le repli
sur la ligne d'auteurs sous le titre ne portait **aucun avertissement** : c'est ce silence, et non
la liste de titres, qui est le vrai défaut.

**Passe sur tout le corpus** (486 Word : les 421 galleys d'`tmp/corpus-ojs`, les 64 de
`tmp/docx-dev`, le fichier déposé), harnais dans `tmp/` — `scan-auteurs.py`, `scan-auteurs2.py`,
`scan-avertis.py`, `comparer-auteurs.py`. Tableaux lus **404 → 421**, replis byline 35 → 18,
e-mails 784 → 833, fonctions 794 → 844, portraits appariés 738 → 779, **0 régression** (la
comparaison est faite fiche par fiche, ligne à ligne, entre les deux versions du parser).

Cinq règles, aucune n'assouplissant le jugement d'une cellule de prose — c'est lui qui protège les
encadrés de contenu :

1. `_est_titre_academique()` découpe le jeton sur le point et le tiret : `Univ.-Prof.`,
   `Dipl.-Psych.`, `Dr.in` tiennent sans allonger la liste à chaque graphie. Suffixe féminin
   autrichien (`SUFFIXES_TITRE`) et liants d'une chaîne d'honneur (`Dr. Dr. et Prof. h. c.`) ont
   leur règle propre ; `, M. A.`, écrit lettre par lettre, se lit collé.
2. Une première ligne qui ne porte **que** des titres est sautée, le nom étant à la suivante
   (`Prof. Dr. phil.` puis `Angelika Schöllhorn`). Uniquement dans ce cas : chercher un nom plus
   loin dans n'importe quelle cellule ferait passer un encadré pour un bloc auteurs.
3. La remontée des tableaux de fin fait `continue` et non `break` sur un refus. Un encadré de
   contenu placé **après** le bloc auteurs le masquait entièrement — 4 articles, dont
   `1624_Des-temoignages` qui annonçait `"source": "tableau"` avec 2 auteurs sur 5 : il avait
   l'air d'une réussite. Le garde-fou de position (40 % du document) reste le seul arrêt.
4. Une cellule-photo tolère son crédit (`© Franca Pedrazetti`, `@ ARC Sieber`). Le schéma d'auteur
   n'a pas de champ crédit : le texte part avec le tableau, donc `credit-photo-non-repris` le cite
   mot pour mot.
5. `tableau-auteurs-non-lu` — le correctif qui compte. Il ne se lève que si un tableau refusé en
   fin de document porte un **e-mail** : c'est ce signal qui distingue un bloc auteurs illisible
   d'un encadré qu'on a eu raison de laisser. 9 articles du corpus le déclenchent.

Effet de bord réparé au passage : `Dr.in` pris pour un prénom donnait le slug
`portraits/dr.original.png` pour *deux* personnes, la seconde perdant sa photo sous un
`photo-homonyme-ignoree` incompréhensible. Six prénoms remis d'aplomb, huit faux
`byline-differente-du-tableau` disparus.

Assumé, et c'est le bon comportement : 12 notices biographiques en prose libre restent illisibles
— le schéma n'a pas de champ biographie, le tableau reste dans le corps et s'imprime. Plus 3 vrais
encadrés de contenu et 3 Word sans bloc auteurs. Suite **420 tests, 420 verts** (3 neufs).
`docs/MAINTENANCE.md` gagne « La fiche n'a que les noms », et `TODORMO.md` une forme de plus dans
la chasse aux échecs muets : *un repli légitime qui ne dit pas qu'il a eu lieu.*

⚠ Les numéros déjà importés ne profitent pas de la correction : la fiche est écrite à l'import.
Sur un article dont le bloc auteurs manque, il faut *Réimporter cet article*.

### Retouche lot I bis (v2026.08.50, cockpit 0.26.2)

Constat de Robin : recliquer l'en-tête de la section déjà dépliée la repliait — la section active doit rester ouverte. Le clic-titre ne replie plus jamais : il déplie si besoin (accordéon) et ouvre la vue d'ensemble ; sur une section déjà ouverte, il n'ouvre que la vue. Le repli reste au chevron (seul chemin vers l'état « tout fermé »). La commande est renommée `szh.basculerSection` → `szh.ouvrirSection` (elle ne bascule plus).

### Retouche lot I (v2026.08.49, cockpit 0.26.1)

Constat de Robin après essai : le clic sur un en-tête dépliait bien (accordéon) mais n'ouvrait plus la vue d'ensemble. Retouche : le clic-titre **et** le dépliage au chevron ouvrent la vue d'ensemble de la section, en plus de l'accordéon. Garde-fou décision B : seuls les changements d'état comptent — le dépliage programmé (clic d'article → reveal) arrive avec `sectionDeployee` déjà posé et n'ouvre rien ; replier n'ouvre rien non plus. Test dédié (compte de messages du panneau Articles inchangé au dépliage du reveal).

### Incident v2026.08.47 → correctif v2026.08.48 (26.08.2026)

La mise à jour 2026.08.47 s'est coupée à l'étape 3/5 sur les postes : le CLI du nouveau VSCodium (Node 22) écrit un `DeprecationWarning` (DEP0169, `url.parse`) sur stderr, et sous `$ErrorActionPreference = 'Stop'` le `2>&1` de PowerShell 5.1 en fait une erreur fatale. Correctif : l'appel `codium --install-extension` passe par `Invoke-SzhNatif` (update.ps1), la garde maison déjà utilisée pour wsl.exe — reproduit et vérifié dans un vrai PowerShell 5.1. Release **v2026.08.48**. Sur un poste déjà touché : la première mise à jour pose le toolkit corrigé puis échoue encore (le script en cours est l'ancien), la suivante — ou la tâche planifiée — termine (cockpit 0.26.0 compris).

### Pistes consignées (hors périmètre, non bloquantes)
- Sélection à cheval sur un bloc `:::` → markup imbriqué (défaut préexistant au lot 4).
- Fenêtre de course résiduelle sur gestes enchaînés (rejeu du refresh entre deux QuickPick, lot 5) ; `avertirEchecCompilation` hors garde (toast sans vol de focus).
- Mode PDF : le rechargement du viewer tiers reste hors de portée de la garde (extension séparée).
- `lang` invalide écrit à la main → permutation de statuts sans contenus (lot 8, marginal — bloqué par ailleurs à la compilation).
- Trou de verrou préexistant : le message `enregistrer` d'un panneau resté ouvert traverse le verrou (les médias ont une garde explicite, les fiches non).
- Le suivi de traduction prend toujours la langue de la revue comme source, pas celle de l'article (préexistant).
- Rafraîchissement auteurs abouti pendant qu'un panneau est ouvert : la liste arrive au prochain envoi (pas de poussée à chaud).
- Artefacts compilés committés périmés dans `revue-template/out/` (anciens DOI d'exemple).

Séquentiel (les lots partagent `extension.js` et `lib/i18n.js`) ; du plus petit au plus structurant.

---

## Lot 1 — F : texte d'aide « description de tableau »

**Objectif** : expliquer à quoi sert la description de tableau : permettre à un·e utilisateur·trice de synthèse vocale de se faire un aperçu mental global du tableau avant la lecture ligne par ligne — ce qu'un regard décode d'un coup d'œil. Avec un exemple concret (« trois parties : adaptations, aménagements, mesures les plus populaires »).

**Constat clé** : `extension.js:5057` demande déjà la clé `table.alt.aide`, qui n'existe dans aucune table i18n (elle revient donc brute) et que la webview ne rend pas.

**Implémentation**
- `lib/i18n.js` : créer `table.alt.aide` FR et DE (texte pédagogique + exemple).
- `media/table-editor.js` (~:281) : rendre ce texte d'aide sous le champ `alt` (élément DOM discret, style existant des aides).
- Vérifier `textesTable()` (`extension.js:5040-5079`) transmet bien la clé.

**Tests** : test de complétude i18n si existant (contrats.test.js) ; test webview (webviews.test.js) que le texte est rendu.

**Acceptation** : ouvrir l'éditeur de tableau → le champ « Description du tableau » porte le texte d'aide, en FR et en DE.

---

## Lot 2 — D : réglage « réduire les warnings d'impression »

**Objectif** : un réglage d'application qui, activé, supprime le palier « conseillé » des warnings de résolution : ne reste que le minimum. Portraits : garder « 400 px min », taire « 1000 px conseillé ». Figures : garder « 1000 px min », taire « 2000 px conseillé ». CMYK inchangé.

**Implémentation**
- `vscodium-extension/szh-cockpit/package.json` : propriété `szh.reduireWarningsImpression` (boolean, défaut `false`) + libellés `package.nls.json` / `package.nls.de.json`.
- `lib/qualite-image.js` : `qualiteImage()` accepte une option (p.ex. `{ reduit: true }`) → le niveau `juste` devient `ok` ; `insuffisant` inchangé.
- `extension.js` : passer le réglage aux 3 appels (`:5344`, `:5428`, `:5594`).
- Panneau « Réglages SZH » : nouveau groupe dans `GROUPES` (`media/settings.js:7-16`), clés `regl.*` FR/DE, lecture dans `lireReglagesActuels()`, branche d'écriture (`extension.js:4961-5003`).

**Tests** : unités `qualite-image` (réduit/normal, les deux familles, SVG intact) ; réglage lu/écrit.

**Acceptation** : réglage actif → une image portrait de 600 px n'affiche plus rien ; une de 300 px affiche toujours le minimum.

---

## Lot 3 — B : pas d'aperçu auto depuis la vue Articles

**Objectif** : ouvrir un article depuis la **vue d'ensemble Articles** n'ouvre plus l'aperçu compilé en colonne 2 ; seul le `.md` s'ouvre. Le clic dans l'arbre latéral et Ctrl+Alt+P sont inchangés.

**Implémentation**
- `ouvrirArticle(fournisseur, slug, opts)` (`extension.js:1592-1675`) : nouvelle option `opts.sansApercu` → sauter l'étape 5 (ouverture aperçu). La compilation d'obsolescence peut aussi être sautée (pas d'aperçu à alimenter) — à trancher à l'implémentation, en privilégiant le moindre étonnement.
- Le gestionnaire de la vue (`extension.js:3695-3700`) passe l'option via `szh.ouvrirArticle`.
- Attention : le panneau d'aperçu déjà ouvert continue de se rafraîchir par le watcher — comportement voulu.

**Tests** : difficile à couvrir en unité ; relecture ciblée + vérif des autres appelants de `szh.ouvrirArticle` (arbre `:681-684`, Contrôles `:3147-3149`, démarrage `:1584`) qui ne doivent pas changer.

**Acceptation** : clic sur « Ouvrir » dans la vue Articles → .md seul ; clic dans l'arbre → comportement historique (md + aperçu).

---

## Lot 4 — C : blocs `:::` — sauts de ligne et remplacement

**Objectif** : (1) toute insertion `:::` par le panneau édition est entourée des lignes vides nécessaires ; (2) insérer un bloc `:::` sur un bloc `:::` existant **remplace** le markup (pas d'imbrication) et normalise les lignes vides (jamais 2-3 vides inutiles).

**Constat clé** : `enroberBloc()` (`lib/formatting.js:77-82`, utilisé par important/highlight/question) ne gère ni lignes vides ni détection d'existant ; `blocReferenceTable`/`blocSautPage` (`:325-339`) font déjà les sauts correctement ; les regex de détection existent (`lib/references.js:73-83`).

**Implémentation**
- Généraliser la logique `avant`/`apres` de `blocReferenceTable` à `enroberBloc` (démarrage colonne 0, `\n\n` de part et d'autre si voisins non vides, sans doubler des vides déjà là).
- Détection : si la sélection/le curseur est dans un fenced div (ouverture `/^\s*:::+\s*\{([^}]*)\}\s*$/`, fermeture `/^\s*:::+\s*$/`) → réécrire la ligne d'ouverture avec la nouvelle classe/titre, conserver le contenu, ajuster les lignes vides. Factoriser avec `lib/references.js` plutôt que dupliquer les regex.
- Couvrir les trois entrées : `fmtImportant`, `szh.fmt.highlight`, `szh.fmt.question` (et vérifier que tableau/saut de page restent corrects).

**Tests** : unités formatting : insertion en milieu de ligne, en début, collée à un paragraphe, sur bloc existant (même classe, autre classe), lignes vides excédentaires réduites.

**Acceptation** : Ctrl+Alt+W deux fois sur le même texte ne produit qu'un seul bloc, à jour, proprement espacé.

---

## Lot 5 — E : perte de focus en fin de compilation

**Objectif** : un QuickPick ouvert (Ctrl+Alt+A/S/D, choix de titre, etc.) ne se ferme plus quand une compilation se termine.

**Diagnostic posé** : le refresh HTML réassigne `webview.html` du panneau d'aperçu (watcher `out/**` debouncé 300 ms, `extension.js:5713-5740`, `:1528`) — suspect principal ; la notification de fin (`relireJournal`, `:3097-3104`) est secondaire.

**Implémentation**
- Garde d'interaction : compteur global « QuickPick ouvert » posé autour de tous les `showQuickPick`/`showInputBox` du cockpit (`lib/panneaux.js:32-37`, `lib/formatting.js` pour `choisirTitreImportant`, autres occurrences à inventorier par grep).
- `rafraichirBientot`/`rechargerApercuHtmlSiChange` : si garde active, différer et rejouer à la fermeture (onDidHide / finally).
- Différer aussi la notification de `relireJournal` si garde active (la jouer après).
- Audit `preserveFocus` : les `reveal()`/`createWebviewPanel()` déclenchés par une **commande utilisateur** gardent leur comportement ; seul ce qui peut se déclencher en tâche de fond est corrigé.

**Tests** : extraire la logique de déferrement dans une petite unité testable (file d'actions différées) ; le reste en relecture + scénario manuel documenté.

**Acceptation** : ouvrir Ctrl+Alt+S pendant une compilation ; à la fin de celle-ci, le panneau reste ouvert et le clavier y répond ; l'aperçu se rafraîchit dès la fermeture du panneau.

---

## Lot 6 — G1 : DOI verrouillé — seul le calculé fait foi

**Objectif** : plus d'édition libre du DOI ; les DOI des Word importés ne sont plus repris ; le champ affiche le DOI calculé. Une case « Définir manuellement le DOI » (avec avertissement) reste l'échappatoire pour qui sait ce qu'il fait.

**Implémentation**
- `media/_fiches.js:222` : champ `doi` en lecture seule affichant le **DOI calculé** (l'hôte l'envoie : réutiliser `doiCalcule`/`rangDoi` — même mécanique que `apercuDoi`, `extension.js:3388-3408`) ; case à cocher « Définir manuellement le DOI ».
- Cocher la case → avertissement modal via l'hôte (`showWarningMessage` modal), texte du type : « Les DOI sont calculés automatiquement à partir du numéro et de la position de l'article. Ne définissez un DOI à la main que si vous savez exactement pourquoi. » (FR + DE) ; confirmation → champ éditable.
- `media/import-verif.js:35` : `doi` ne compte plus dans les champs vides ; champ verrouillé pareil.
- `pipeline/docx-meta.py` : ne plus écrire `doi:` dans le `.meta.yaml` (`:677-678`) ; **conserver** les dérivations `langue_du_doi()` et `detecter_type()` (éditorial si `-00`).
- Export : si un DOI manuel est posé sur la fiche, **il part dans OJS à la place du calculé** (c'est le sens de l'échappatoire) ; sinon comportement aa14e66 (calculé). Les avertissements `ojs.avert.doi.*` restent.
- Corriger le commentaire obsolète `extension.js:3386-3387`.
- i18n FR/DE pour la case, l'avertissement, l'infobulle.

**Tests** : `doi-ojs.test.js`, `export-ojs.test.js` (manuel prioritaire sur calculé), `carte-article.test.js`, webviews (champ verrouillé par défaut).

**Acceptation** : fiche neuve → DOI affiché = calculé, non éditable ; import Word avec « DOI: 10.xxxx » → fiche sans `doi:` ; case cochée + confirmation → édition possible et export du DOI manuel.

**Risque** : sémantique du DOI manuel à l'export (calculé vs manuel) — décision ci-dessus à faire valider par Robin à la revue du lot.

---

## Lot 7 — G2 : arbre latéral — mise en évidence et ordre

**Objectif** : sections « Articles / Traductions / Word en attente » plus saillantes, dans cet ordre ; articles mieux séparés visuellement — dans les limites du TreeView natif (pas de gras/bordure/taille possibles).

**Implémentation**
- `extension.js:602-614` : réordonner le tableau racine → articles, traductions, word.
- Sections : libellés i18n en **MAJUSCULES** (`arbre.articles` & co, FR/DE), icônes `ThemeIcon` avec `ThemeColor` distinctes (p.ex. `charts.blue/green/orange`), garder compteurs en `description`.
- Articles : renforcer la distinction entre items — icône de statut colorée systématique (réutiliser `ICONES_STATUT`/`COULEURS_STATUT`, `extension.js:2671-2689`), description normalisée `slug · n/m tâches`. Pas de faux items « séparateurs » (bruit cliquable).
- Attention : VS Code mémorise l'état plié/déplié (ruse d'`id`, `:666-669`) — ne pas casser ; « Traductions » reste replié par défaut mais remonte en 2ᵉ position.

**Tests** : si l'arbre est couvert (contrats/webviews), adapter ; sinon relecture + capture avant/après.

**Acceptation** : ordre Articles / Traductions / Word ; sections immédiatement repérables ; aucun régression drag & drop ni menus contextuels.

---

## Lot 8 — A : la langue de l'article pilote les champs

**Objectif** :
1. Changer la langue d'un article **permute** les contenus (title/subtitle/resume/keywords) entre l'ancienne et la nouvelle langue.
2. Les champs affichés par défaut = **langue de l'article** (en premier) + **langue par défaut de la revue** (FR pour la Revue, DE pour la Zeitschrift) comme langue de traduction.
3. La case « + Italien » devient dynamique : une case par langue **manquante** de {fr, de, it} (p.ex. article IT dans la Revue → case « + Allemand (champs DE) » ; article DE dans la Zeitschrift → deux cases « + FR » et « + IT »).
4. À la compilation, la langue de l'article est la langue par défaut du document et les documents sont taggés correctement.

**Constat clé** : le point 4 est **déjà implémenté** (`szh-maquette.lua` : cascade lang_art > lang_num, `<html lang>`, résumés taggés) — à vérifier par test, pas à recoder. Le chantier est le formulaire.

**Implémentation**
- `media/_fiches.js` : ordre des colonnes = langue de l'article d'abord (`:195-209` à inverser de « langue du numéro d'abord ») ; au changement du sélecteur de langue (`:174-181`), permuter les contenus entre ancienne et nouvelle langue dans l'état du formulaire + `editeurMots.reconstruire` ; généraliser `case-it`/`champ-it`/`avec-it` (`:250-264`, `media/_fiches.css:41-44`) en mécanique par langue (`champ-<lang>`, `avec-<lang>`).
- i18n : clés génériques « + {langue} (champs {LANG}) » FR/DE pour les trois langues.
- Hôte : `ecrireCartesArticles`/`nettoyerCarte` (`extension.js:2505-2532`, `:2617-2670`) — vérifier que les trois langues passent déjà (boucles `LANGUES_META`) ; la permutation est faite côté webview, l'hôte n'écrit que le résultat.
- Ne pas toucher : `lang:` en jeton nu (contrat szh-maquette.lua), ordre de sérialisation, `LANGUE_MAIL_TRADUCTION` (logique croisée d'email, hors périmètre).
- Point de vigilance : `<slug>.traduction.yaml` (statuts par champ×langue) — décider à l'implémentation si les statuts sont permutés aussi (probablement oui, sinon ils pointent sur la mauvaise langue) ; constat à remonter.

**Tests** : `carte-article.test.js`/`webviews.test.js` (permutation, ordre des colonnes, cases dynamiques), `yaml` (rien ne change à la sérialisation), test pipeline existant sur la cascade de langue (vérifier qu'il couvre article IT dans revue FR).

**Acceptation** : article DE passé en IT → les textes DE se retrouvent sous IT (et inversement), les champs IT s'affichent en premier, la case propose la langue manquante ; compilation d'un article IT dans la Revue → `<html lang="it">`.

---

## Lot 9 — H : liste d'auteurs OAI-PMH + autocomplétion

**Objectif** : construire et maintenir localement la liste des auteur·e·s publiés (Revue + Zeitschrift) via l'interface OAI-PMH publique d'ojs.szh.ch ; dédupliquée ; rafraîchie au plus 1×/semaine, incrémentalement (depuis la date du dernier fetch) ; branchée en autocomplétion dans la modale auteur.

**Limitation actée** : OAI-PMH (oai_dc) n'expose que `dc:creator` (noms) — pas d'email/fonction/lieu. L'autocomplétion ne préremplit que prénom/nom. La règle « conserver la plus récente » s'applique au **nom** (datestamp le plus récent). Évolution possible plus tard avec une clé API OJS.

**Implémentation**
- Nouveau module `lib/auteurs-ojs.js` :
  - `https` natif de Node (aucune dépendance) ; endpoints OAI configurables dans `config.json` (clé `oai`, défauts à relever sur ojs.szh.ch — forme `https://ojs.szh.ch/index.php/<chemin-revue>/oai`) ;
  - `ListRecords` `metadataPrefix=oai_dc` + `from=<dernier fetch>` + suivi des `resumptionToken` ; parseur XML minimal ciblé (dc:creator, datestamp), tolérant ;
  - normalisation « Nom, Prénom » → `{prenom, nom}` ; déduplication par nom normalisé (casse/accents), datestamp le plus récent conservé ;
  - fusion avec la liste existante (ajouts/mises à jour), jamais de suppression silencieuse.
- Cache : **fichier séparé** `C:\ProgramData\SZH\auteurs.json` (modèle `state.json`, écriture atomique — pas dans `config.json` qui est réécrit en entier à chaque réglage) : `{ dateFetch, auteurs: [...] }`.
- Déclenchement : à l'activation de l'extension, si `dateFetch` > 7 jours → rafraîchissement **en tâche de fond, silencieux en cas d'échec réseau** (hors ligne = normal).
- Autocomplétion : modale de `media/_auteurs.js` — à la frappe dans nom/prénom, liste de suggestions (DOM main, pas d'innerHTML) ; sélection → préremplit prénom + nom. L'hôte envoie la liste avec les textes de la modale.
- i18n FR/DE (libellés de suggestion, éventuel statut « liste mise à jour le … » dans les réglages).

**Tests** : parseur OAI sur fixtures XML (avec resumptionToken, réponses partielles, XML hostile), normalisation/déduplication, fusion incrémentale, lecture/écriture du cache — **aucun réseau dans les tests**.

**Acceptation** : premier lancement en ligne → `auteurs.json` peuplé des deux revues ; relance dans la semaine → aucun appel ; taper « Mor » dans la modale → suggestions ; hors ligne → aucune erreur visible.

**Risques** : chemins OAI des deux revues à confirmer (relevé sur l'instance en début de lot) ; volumétrie du premier moissonnage (pagination) ; qualité des `dc:creator` (formes variées de noms).

---

## Definition of Done (chaque lot)

- Code + i18n FR/DE complets, aucun texte en dur.
- `node --test test/js/` vert, tests du lot ajoutés.
- Vérification d'impact faite par un agent distinct, constats traités.
- Diff relu et validé par le chef d'orchestre ; statut mis à jour dans ce fichier.
- Pas de commit sans accord de Robin.
