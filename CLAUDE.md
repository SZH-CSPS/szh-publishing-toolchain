# CLAUDE.md — Pronto (szh-publishing-toolchain)
 
Le socle commun (`~/.claude/CLAUDE.md`) dit comment on travaille ; ce fichier dit ce qui est
propre à Pronto. Ce que fait le produit et comment il est construit se trouve dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) et dans l'index [`docs/README.md`](docs/README.md).
Les deux se lisent avant toute modification qui dépasse une ligne.
 
Pronto fabrique la Revue suisse de pédagogie spécialisée (fr), la Schweizerische Zeitschrift
für Heilpädagogik (de) et des livres. Le dépôt est **public** (SZH-CSPS/szh-publishing-toolchain) :
aucun manuscrit réel ne s'y verse, ni dans un test.
 
## 1. Environnements
 
| Besoin | Où et avec quoi |
|---|---|
| Tout Python, production, tests et outils | **Dans la WSL `SZH-Publishing`**, Python 3.13 de Debian. Venvs : `/opt/weasyprint` (WeasyPrint patché, pypdf, fontTools), `/opt/portraits` (détourage), et `~/pdfvenv` pour le rendu PNG en développement (`outils-dev/venv-dev.sh`) |
| Python **sous Windows** | **Jamais.** `python3` y est un raccourci du Microsoft Store qui fige. Les tests lancent Python par `python()` / `pythonGroupe()` de `test/js/gardes.js`. Seule exception : `windows/icone*.py`, qui a besoin d'Edge |
| pandoc | Deux sur le poste : 3.9 sous Windows, **3.7.0.2 dans la WSL**. C'est celui de la WSL qui compile, et un défaut d'import peut rester invisible côté Windows |
| Lancer la WSL | Depuis l'outil **PowerShell** : `wsl.exe -d SZH-Publishing -- bash /mnt/c/…/script.sh`, le script vivant dans le scratchpad. Jamais depuis Git Bash, qui casse les chemins `/mnt/c` |
| Node | Celui du poste, pour `node --test`. Celui de VSCodium (`ELECTRON_RUN_AS_NODE=1`) pour les outils que lance le lanceur |
| CI | Pas de WSL. ubuntu exécute le Python 3.13 du runner (`setup-python`) ; windows-latest saute les tests Python sous un motif admis |
 
Un `wsl.exe` coûte environ 45 ms de passage Windows → WSL, alors que Python y démarre plus
vite que sous Windows : quand un fichier multiplie les appels Python, on les regroupe dans un
seul processus (`pythonGroupe()`). Docker n'apporte rien sous Windows, il tourne dans la même
VM WSL2 ([`docs/MULTIPLATEFORME.md`](docs/MULTIPLATEFORME.md)).
 
## 2. Patrons en place
 
Le détail est dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Les patrons qui tiennent
le dépôt, et où chacun vit :
 
- **Table de vérité unique.** Chaque fait se décide à un endroit, les autres le lisent :
  - revue ou livre, et ce qui existe dans chacun : `PROFILS` dans `lib/profil.js`
    (capacités → `szh.peut.*` → les `when` de `package.json`) ;
  - langue, produit et unité d'un document : `pipeline/filters/szh-contexte.lua`
    (fr, de, it ; **jamais d'anglais**) ;
  - chaînes de filtres : `pipeline/filtres.mk` ;
  - cascade WeasyPrint : `define weasy_ua` (`pipeline/Makefile`) ;
  - produits du lanceur : `$SzhProduits` (`windows/szh-produits.ps1`) ;
  - libellés par profil : `TP()` (`lib/i18n.js`).
- **Un moteur par fonction.** Gabarits Twig : `lib/gabarits.js`, et lui seul, y compris pour
  le lanceur via `Invoke-SzhNodeCockpit`. Typographie : `szh-typographie.lua`. Pas de
  second moteur dans un autre langage, même gardé par un test de parité.
- **Hôtes par zone (cockpit).** `extension.js` ne fait que câbler. Chaque zone vit dans un
  `lib/<zone>-hote.js` qui expose `configurer()` et des rappels `ctx` aux défauts
  inoffensifs ; il requiert directement les modules de `lib/` dont il a besoin, sans relais
  par lambda. L'état de la zone est privé au module, l'état partagé vit dans
  `lib/session.js`. Les panneaux passent par `panneauUnique` (`lib/webviews/panneau.js`).
  Aucun `createWebviewPanel` ni `panneauUnique(` dans `extension.js` : un test le refuse.
  Aucun cycle de `require` dans `lib/`.
- **Table de messages.** Les messages hôte ↔ webview passent par `MSG` (`lib/messages.js`),
  jamais par un littéral.
- **Webviews sans framework.** Jetons de `_design.css`, éléments et composés de
  `media/_commun.js` (le design atomique, sans le nom), un seul `<script>` à nonce sous CSP
  stricte.
- **Un chapitre se compile comme un article.** Les fonctions Lua communes et l'émetteur de
  constats `constat()` vivent dans `szh-commun.lua` ; côté Python, dans `szh_commun.py`. Le
  format de message `[source-ton] code | champ | … | fr | [de] de` est un contrat
  (`docs/ARCHITECTURE.md`).
- **Socle en étoile (lanceur).** `szh-common.ps1` est chargé par tous. Chaque onglet qui
  n'est pas un produit vit dans `lanceur-*.ps1`. Le mode simulé `SZH_LANCEUR_SIMULE` est la
  couture de test.
- **CSS Paged Media tel que WeasyPrint le documente** : `@page`, éléments courants,
  `string-set`, `target-counter`, `bookmark-label`, `bleed`/`marks`, `float: footnote`. On
  mesure avant de supposer (`vh` vaut la zone de contenu, `break-after` est inerte…).
- **Patcher WeasyPrint : en dernier recours, avec la validation de Robin.** On épuise
  d'abord le CSS, le HTML produit et les options officielles. Un fichier par fonctionnalité
  dans `image/patches/weasyprint-<version>/`, applicable seul à `--fuzz=0` ; un cas par
  patch dans `test/weasyprint-patch-check.py` ; un dossier amont par patch dans
  `image/patches/amont/` (rapport, démo, texte d'issue). Rien ne se publie chez WeasyPrint
  sans Robin. Un patch n'arrive sur les postes qu'à la reconstruction de l'image.
## 3. Patrons refusés
 
- Deux programmes, extensions ou dépôts pour la revue et le livre ; des classes
  `ProfilRevue` / `ProfilLivre` ; un cadre à greffons ; un bus d'événements à la place de
  `configurer` ; des ports et adaptateurs autour de `vscode` (le faux vscode de
  `test/js/hote-factice.js` en tient lieu).
- Un Makefile unique paramétré revue/livre ; fusionner `print.css` et `styles/livre/*.css` ;
  un moteur générique de règles typographiques.
- React, Vue, Svelte, un bundler, TypeScript, des Web Components ; i18next ou zod ; découper
  `i18n.js` par langue.
- Un package `szh/` ; fusionner `manuscrit_modele` et `pronto_modele` ; fusionner
  `docx-meta` (qui devine) avec Pronto (qui refuse ce qu'il ne reconnaît pas).
- Générer WinForms depuis du JSON ; remplacer WSL par Docker sous Windows ; Nix, AppImage
  ou une application Electron à part.
## 4. Texte et formats
 
- **Documentation et commentaires** : selon [`docs/ECRIRE-LA-DOC.md`](docs/ECRIRE-LA-DOC.md),
  à relire avant d'en écrire. Dire ce que fait le code, simplement, en français ; ni
  historique, ni provenance des décisions, ni majuscules d'insistance. Un changement de
  comportement met à jour, dans le même commit, la doc qui le décrit ; une tâche ouverte va
  dans `docs/A-FAIRE.md`.
- Une clé i18n s'ajoute en fr **et** en de. fr et de s'opposent sur l'épicène.
- Toute surface de texte passe `python3 test/typo-check.py`, dans la WSL, et se corrige par
  `--corriger`. Les règles maison : [`docs/TYPOGRAPHIE.md`](docs/TYPOGRAPHIE.md).
- `.ps1` en CRLF, BOM UTF-8 et `\n` final, contrôlés par `git ls-files --eol`. Tout le reste
  en LF. Un `.ps1` se parse par `[Parser]::ParseFile()` avec un chemin en barres inverses.
- Exemple de deux mots pour deux notions : « verrou » désigne le numéro gelé, pas un bail de
  co-édition.
## 5. Vérification
 
- **La suite exigeante**, avant tout commit de lot :
```
  SZH_WSL_OBLIGATOIRE=1 SZH_PS_OBLIGATOIRE=1 SZH_PANDOC_OBLIGATOIRE=1 SZH_PYTHON_OBLIGATOIRE=1 \
    node --test --test-timeout=300000 test/js/*.test.js test/filtres-pandoc.test.js test/filtres-import.test.js > <scratchpad>/suite.txt 2>&1
```
  Attendu : 0 échec, 0 annulé, et seulement des sauts dont le motif est admis par
  `test/js/motifs-saut.js`.
- **Les tests tournent aussi sous Linux** (job `contrats`, ubuntu). La porte
  `--runner ubuntu` ne simule que ses sauts et tourne sous Windows : elle ne voit ni
  `path.sep`, ni la casse des fichiers, ni l'absence de `C:`. Donc : un test construit ses
  chemins attendus avec `path.join` ; un test qui compare un chemin normalisé en Windows
  (ancrage SharePoint, Bureau, lettre de lecteur, `C:\ProgramData`) porte
  `{ skip: process.platform !== 'win32' ? 'chemins Windows — joué par le job
  contrats-windows' : false }` dès qu'il est écrit, un `skip` booléen étant refusé par la
  CI ; un `release:` dont la CI est rouge ne pose pas de tag, on corrige et on pousse un
  nouveau commit `release:`.
- **Le banc de rendu** (`test/build-render.sh`) se compare à un worktree détaché du commit
  d'avant. Empreintes : md5 des HTML autonomes d'article, HTML de livre sans les lignes
  `<link`, pixels de chaque page par pypdfium2. Tout changement de CSS se compare **au
  pixel** : l'égalité des règles ne suffit pas, l'ordre de la cascade compte. Méthode dans
  [`docs/DEVELOPPEMENT.md`](docs/DEVELOPPEMENT.md).
- **PDF/UA.** veraPDF `--flavour ua1` : le verdict se lit sur l'**absence** de FAIL, jamais
  sur la présence d'un PASS. veraPDF ne teste que l'automatisable ; ce qui touche la voix ou
  la navigation demande un lecteur d'écran réel, ou se dit « non vérifié ».
- **L'arbre isolé** avant de tagger : `git worktree add --detach` du commit, suite et
  typo-check rejoués, puis `git worktree remove --force`.
## 6. Accessibilité
 
Normes visées et état des lieux : [`docs/ACCESSIBILITE.md`](docs/ACCESSIBILITE.md) (PDF/UA-1,
WCAG 2.2 AA et RGAA pour le HTML, contraste APCA, FALC pour les livres FALC). Limites connues
par format : [`docs/LIMITES-ACCESSIBILITE.md`](docs/LIMITES-ACCESSIBILITE.md).
 
- **Toute correction se prouve** par un HTML minimal avant/après, puis veraPDF, puis la
  comparaison au pixel.
- **Liens.** Pas de `<svg>` ni de bloc dans un `<a>` : le QR et ORCID sont des `<a>` vides à
  `aria-label`, l'image passant en fond. Pas d'`<a>` enfant direct d'un conteneur flex.
- **Images et tableaux.** Une image a un texte alternatif ou une légende, ou bien `alt=""`
  volontaire si elle est décorative. Un tableau a sa rangée d'en-tête en `<th scope>`, et
  une description longue s'il le faut.
- **Structure et lecture.** Les puces et numéros passent par `::marker`, pour obtenir
  `LI > Lbl`. Pas d'ordre de lecture cassé par du positionnement. Toute langue étrangère est
  déclarée (`lang`), même là où WeasyPrint ne la reporte pas encore.
- **Couleurs.** Contrastes vérifiés par `test/apca-check.py` ; pas d'information portée par
  la seule couleur.
- **Métadonnées.** Les signets et `/Info /Title` portent le titre à plat (`bookmark-label`,
  `<title>` en `/nowrap`). `dc:language` est posé par WeasyPrint lui-même (patch 40).
  `xmp:CreatorTool` vaut « Pronto, open-source publishing software by SZH/CSPS » ;
  `dc:creator` porte les auteurs, au format « Nom, Prénom ».
## 7. Agents : compléments propres au dépôt
 
- Après toute écriture dans `extension.js`, les ancres `function activate(` et `_pur:`
  doivent être présentes, puis `node --check`.
- Python seulement dans la WSL, y compris pour les scripts de transformation d'un agent.
- `tmp/` est un bac à sable non suivi ; seuls `tmp/corpus-relecture/` et
  `tmp/lexique-sources/` sont lus par des tests.
- Les incidents qui ont fondé ces règles sont racontés dans
  [`docs/DEVELOPPEMENT.md`](docs/DEVELOPPEMENT.md), pas ici.
## 8. Publier
 
La procédure est dans [`docs/DEVELOPPEMENT.md`](docs/DEVELOPPEMENT.md) :
 
1. `git fetch` ;
2. `node test/js/porte-release.js --runner tous --version X.Y.Z` ;
3. la section `## X.Y.Z` de `CHANGELOG.md` ;
4. le bump de `vscodium-extension/<ext>/package.json` dès que son dossier a changé ;
5. un commit dont le sujet est `release: X.Y.Z résumé sans accent` ;
6. `git push origin HEAD:main`.
C'est la CI qui pose le tag `vX.Y.Z`. La majeure se monte si un numéro déjà compilé
sortirait différent, la medium s'il faut le dire à quelqu'un, la mineure sinon. Un
changement de `image/` reconstruit le rootfs : c'est la release « lourde ».
 