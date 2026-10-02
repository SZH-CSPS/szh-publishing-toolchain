# CLAUDE.md — Pronto (szh-publishing-toolchain)

Ce fichier dit comment travailler dans ce dépôt. Ce que fait le produit, et comment il est
construit, se trouve dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) et dans l'index
[`docs/README.md`](docs/README.md). Les deux se lisent avant toute modification qui dépasse
une ligne.

Pronto fabrique la Revue suisse de pédagogie spécialisée (fr), la Schweizerische
Zeitschrift für Heilpädagogik (de) et des livres. Le dépôt est **public**
(SZH-CSPS/szh-publishing-toolchain) : aucun manuscrit réel, aucun secret, aucune donnée
personnelle ne s'y verse, ni dans un test.

## 1. Posture : superviser et déléguer

- **Planifier, déléguer, vérifier.** Sur un chantier de plus de quelques fichiers, la session
  principale planifie, découpe, délègue à des agents, puis vérifie elle-même ce qu'ils
  rendent : elle relance les tests, relit les diffs et regarde les captures. Un rapport
  d'agent se juge sur la pièce, jamais sur sa parole.
- **Une revue adverse avant d'implémenter.** On relit sa propre conception et on en écrit
  les trous, les bugs du brouillon et les écarts assumés par rapport à la demande. On les
  soumet à Robin quand ils changent la décision.
- **Les décisions de produit reviennent à Robin.** Une question se présente avec une
  recommandation chiffrée, pas comme un menu neutre. Ce qu'on peut trancher par le code ou
  par l'usage établi, on le tranche, et on le dit.
- **Ne pas surcorriger.** Ce qui est bien construit se garde. Les surcorrections déjà
  écartées sont listées au §8.
- **Dire ce qui est vérifié, et seulement ça.** Un test rouge se dit avec sa sortie. Une
  étape non faite se dit non faite. « Accessible », « conforme » ou « identique »
  s'écrivent seulement avec la mesure qui le prouve.

## 2. Environnements

| Besoin | Où et avec quoi |
|---|---|
| Tout Python, production, tests et outils | **Dans la WSL `SZH-Publishing`**, Python 3.13 de Debian. Venvs : `/opt/weasyprint` (WeasyPrint patché, pypdf, fontTools), `/opt/portraits` (détourage), et `~/pdfvenv` pour le rendu PNG en développement (`outils-dev/venv-dev.sh`) |
| Python **sous Windows** | **Jamais.** `python3` y est un raccourci du Microsoft Store qui fige. Les tests lancent Python par `python()` / `pythonGroupe()` de `test/js/gardes.js`. Seule exception : `windows/icone*.py`, qui a besoin d'Edge |
| pandoc | Deux sur le poste : 3.9 sous Windows, **3.7.0.2 dans la WSL**. C'est celui de la WSL qui compile, et un défaut d'import peut rester invisible côté Windows |
| Lancer la WSL | Depuis l'outil **PowerShell** : `wsl.exe -d SZH-Publishing -- bash /mnt/c/…/script.sh`, le script vivant dans le scratchpad. Jamais depuis Git Bash, qui casse les chemins `/mnt/c` |
| Node | Celui du poste, pour `node --test`. Celui de VSCodium (`ELECTRON_RUN_AS_NODE=1`) pour les outils que lance le lanceur |
| CI | Pas de WSL. ubuntu exécute le Python 3.13 du runner (`setup-python`) ; windows-latest saute les tests Python sous un motif admis |

- **Le coût d'un appel à la WSL.** Un `wsl.exe` coûte environ 45 ms de passage Windows →
  WSL, alors que Python lui-même y démarre plus vite que sous Windows. Quand un fichier
  multiplie les appels Python, on les regroupe dans un seul processus (`pythonGroupe()`).
- **Docker n'apporte aucun gain sous Windows** : il tourne dans la même VM WSL2. Voir
  [`docs/MULTIPLATEFORME.md`](docs/MULTIPLATEFORME.md).

## 3. Organisation du code

Le détail est dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Les règles qui le tiennent :

- **Une seule source de vérité par fait, et on décide une fois.**
  - Revue ou livre, et ce qui existe dans chacun : la table `PROFILS` de
    `lib/profil.js` (capacités → `szh.peut.*` → les `when` de `package.json`).
  - Langue, produit et unité d'un document : `pipeline/filters/szh-contexte.lua`
    (fr, de, it ; **jamais d'anglais**).
  - Chaînes de filtres : `pipeline/filtres.mk`.
  - Cascade WeasyPrint : `define weasy_ua` (`pipeline/Makefile`).
  - Produits du lanceur : `$SzhProduits` (`windows/szh-produits.ps1`).
  - Libellés par profil : `TP()` (`lib/i18n.js`).
- **Un seul moteur par fonction.** Gabarits Twig : `lib/gabarits.js`, et lui seul, y compris
  pour le lanceur via `Invoke-SzhNodeCockpit`. Typographie : `szh-typographie.lua`. Pas de
  second moteur dans un autre langage, même gardé par un test de parité.
- **Le cockpit**
  - `extension.js` ne fait que câbler. Chaque zone vit dans un `lib/<zone>-hote.js` :
    - `configurer()` et des rappels `ctx` aux défauts inoffensifs ;
    - les modules de `lib/` dont la zone a besoin sont requis directement, sans relais par
      lambda ;
    - l'état de la zone est privé au module, l'état partagé vit dans `lib/session.js` ;
    - les panneaux passent par `panneauUnique` (`lib/webviews/panneau.js`).
  - Aucun `createWebviewPanel` ni `panneauUnique(` dans `extension.js` : un test le refuse.
  - Aucun cycle de `require` dans `lib/`.
  - Les messages hôte ↔ webview passent par la table `MSG` (`lib/messages.js`), jamais par
    un littéral.
- **Les webviews.** Elles n'ont pas de framework ni de bundler : jetons de `_design.css`,
  éléments et composés de `media/_commun.js` (le design atomique, sans le nom), un seul
  `<script>` à nonce sous CSP stricte.
- **La chaîne**
  - Un chapitre se compile comme un article.
  - Les fonctions Lua communes et l'émetteur de constats `constat()` vivent dans
    `szh-commun.lua` ; côté Python, dans `szh_commun.py`.
  - Le format de message `[source-ton] code | champ | … | fr | [de] de` est un contrat
    (`docs/ARCHITECTURE.md`).
- **Le lanceur.** Le socle `szh-common.ps1` est chargé en étoile. Chaque onglet qui n'est pas
  un produit vit dans `lanceur-*.ps1`, et le mode simulé `SZH_LANCEUR_SIMULE` sert de
  couture de test.
- **Rester idiomatique**, dans chaque langage, plutôt qu'inventer une manière maison :
  - Node et l'API VS Code ;
  - Lua et l'AST pandoc ;
  - Python stdlib ;
  - PowerShell 5.1 ;
  - GNU Make ;
  - CSS Paged Media tel que WeasyPrint le documente : `@page`, éléments courants,
    `string-set`, `target-counter`, `bookmark-label`, `bleed`/`marks`, `float: footnote`.
  
  Une exception maison se justifie en une phrase, à l'endroit où elle vit. Avec WeasyPrint,
  on mesure avant de supposer (`vh` vaut la zone de contenu, `break-after` est inerte…).
- **Patcher WeasyPrint : en dernier recours, et seulement avec la validation de Robin.**
  - On épuise d'abord le CSS, le HTML produit et les options officielles.
  - Un fichier par fonctionnalité dans `image/patches/weasyprint-<version>/`, chacun
    applicable seul à `--fuzz=0`.
  - Un cas par patch dans `test/weasyprint-patch-check.py`.
  - Un dossier amont par patch dans `image/patches/amont/` : rapport, démo, texte d'issue.
  - Rien ne se publie chez WeasyPrint sans Robin.
  - Un patch n'arrive sur les postes qu'à la reconstruction de l'image.

## 4. Règles de code et de texte

- **Commentaires**
  - En français, courts. Ils disent ce que fait le bloc, et le pourquoi seulement quand un
    mainteneur risquerait de défaire le choix sans le savoir.
  - Pas de récit de ce qui a été essayé, pas d'identifiant de lot ou de tâche (D47, U3,
    X6…), pas de mot entier en majuscules pour insister.
  - Les en-têtes de fichier tiennent en une à trois lignes.
- **Textes visibles**
  - Une clé i18n s'ajoute en fr **et** en de.
  - Toute surface de texte passe `python3 test/typo-check.py`, dans la WSL, et se corrige
    par `--corriger`, jamais à la main.
  - Les règles maison : [`docs/TYPOGRAPHIE.md`](docs/TYPOGRAPHIE.md). Orthographe rectifiée.
  - fr et de s'opposent sur l'épicène.
- **Formats**
  - `.ps1` en CRLF, BOM UTF-8 et `\n` final : le contrôler par `git ls-files --eol`.
  - Tout le reste en LF.
  - Un `.ps1` se parse par `[Parser]::ParseFile()` avec un chemin en barres inverses.
- **Nommage.** Deux notions voisines portent deux mots disjoints, dans le code comme dans
  l'interface. Exemple : « verrou » désigne le numéro gelé, pas un bail de co-édition.

## 5. Vérification

- **Tests d'abord, et rouges.** Pour un correctif de comportement, on écrit le test, on le
  montre rouge sur le code actuel, puis vert. On ajoute une **sonde de mutation** : on
  sabote la production, le test doit rougir, puis on annule par une édition inverse (jamais
  par `git checkout`).
- **Suite exigeante** avant tout commit de lot, avec la sortie dans un fichier (jamais
  `| tail`) :
  ```
  SZH_WSL_OBLIGATOIRE=1 SZH_PS_OBLIGATOIRE=1 SZH_PANDOC_OBLIGATOIRE=1 SZH_PYTHON_OBLIGATOIRE=1 \
    node --test --test-timeout=300000 test/js/*.test.js test/filtres-pandoc.test.js test/filtres-import.test.js > <scratchpad>/suite.txt 2>&1
  ```
  Attendu : 0 échec, 0 annulé, et seulement des sauts dont le motif est admis par
  `test/js/motifs-saut.js`. Pas de `t.skip('…')` libre.
- **Les tests tournent aussi sous Linux** (job `contrats` de la CI, ubuntu). La porte
  `--runner ubuntu` ne simule que ses sauts, elle tourne sous Windows : elle ne voit ni
  `path.sep`, ni la casse des fichiers, ni l'absence de `C:`. D'où trois règles :
  - un test construit ses chemins attendus avec `path.join`, jamais avec `\\` en dur ;
  - un test qui compare un chemin normalisé en Windows (ancrage SharePoint, Bureau, lettre de
    lecteur, `C:\ProgramData`) porte `{ skip: process.platform !== 'win32' ? 'chemins
    Windows — joué par le job contrats-windows' : false }` dès qu'il est écrit. Un `skip`
    booléen (`skip: process.platform !== 'win32'`) n'a pas de motif : la CI le refuse ;
  - un `release:` dont la CI est rouge ne pose pas de tag : on corrige, puis on pousse un
    nouveau commit `release:` (la 3.2.0 l'a appris).
- **Le rendu ne doit pas bouger sans le vouloir.**
  - On compare au banc (`test/build-render.sh`) contre un worktree détaché du commit
    d'avant.
  - Les empreintes : md5 des HTML autonomes d'article, HTML de livre sans les lignes
    `<link`, pixels de chaque page par pypdfium2.
  - Zéro différence attendue, hors changement voulu et listé.
  - Tout changement de CSS se compare **au pixel** : l'égalité des règles ne suffit pas,
    car l'ordre de la cascade compte.
  - Méthode détaillée : [`docs/DEVELOPPEMENT.md`](docs/DEVELOPPEMENT.md).
- **PDF/UA.**
  - veraPDF `--flavour ua1` : le verdict se lit sur l'**absence** de FAIL, jamais sur la
    présence d'un PASS.
  - veraPDF ne teste que l'automatisable : ce qui touche la voix ou la navigation demande un
    lecteur d'écran réel, ou se dit « non vérifié ».
- **Un arbre isolé avant de tagger**, si une autre session a travaillé dans le dépôt : un
  `git worktree add --detach` du commit, où l'on rejoue la suite et typo-check. On le
  retire ensuite par `git worktree remove --force`.

## 6. Accessibilité

Les normes visées et ce qui est en place sont dans
[`docs/ACCESSIBILITE.md`](docs/ACCESSIBILITE.md) : PDF/UA-1, WCAG 2.2 AA et RGAA pour le HTML,
contraste APCA, FALC pour les livres FALC. Les limites connues, format par format, sont dans
[`docs/LIMITES-ACCESSIBILITE.md`](docs/LIMITES-ACCESSIBILITE.md). Règles de travail :

- **Toute correction se prouve** par un HTML minimal avant/après, puis veraPDF, puis la
  comparaison au pixel.
- **Liens**
  - Pas de `<svg>` ni de bloc dans un `<a>` : le QR et ORCID sont des `<a>` vides à
    `aria-label`, l'image passant en fond.
  - Pas d'`<a>` enfant direct d'un conteneur flex.
- **Images et tableaux**
  - Une image a un texte alternatif ou une légende, ou bien `alt=""` volontaire si elle est
    décorative.
  - Un tableau a sa rangée d'en-tête en `<th scope>`, et une description longue s'il le
    faut.
- **Structure et lecture**
  - Les puces et numéros de liste passent par `::marker`, pour obtenir `LI > Lbl`.
  - Pas d'ordre de lecture cassé par du positionnement.
  - Toute langue étrangère est déclarée (`lang`), même là où WeasyPrint ne la reporte pas
    encore.
- **Couleurs** : contrastes vérifiés par `test/apca-check.py`, et pas d'information portée
  par la seule couleur.
- **Métadonnées**
  - Les signets et `/Info /Title` portent le titre à plat (`bookmark-label`, `<title>` en
    `/nowrap`).
  - `dc:language` est posé par WeasyPrint lui-même (patch 40).
  - `xmp:CreatorTool` vaut « Pronto, open-source publishing software by SZH/CSPS » ;
    `dc:creator` porte les auteurs, au format « Nom, Prénom ».

## 7. Consignes pour les agents délégués

Chaque brief d'agent reprend ces règles, avec la liste explicite des fichiers **autorisés**
et des fichiers **interdits**.

1. **Interdits sur l'arbre partagé** :
   - `git stash`, `git checkout -- <fichier>`, `git restore`, `git reset` ;
   - `git commit` (c'est le superviseur qui commite) ;
   - toute restauration depuis git ou depuis une sauvegarde ;
   - toute réécriture complète d'un fichier existant ;
   - les fichiers `.bak`.
2. **Éditer par remplacements ciblés courts**, en relisant la zone juste avant chaque
   édition : un autre agent a pu la toucher.
3. **Un seul agent à la fois pour DÉPLACER un bloc dans un même fichier.**
   - Chaque ancre est vérifiée présente et unique avant de couper : jamais un `indexOf` qui
     peut valoir -1 sans contrôle.
   - Après chaque écriture, on vérifie que la fin du fichier est intacte (pour
     `extension.js` : `function activate(` et `_pur:`), puis `node --check`.
   - Cette règle vient d'une troncature de 2 200 lignes, le 02.10.2026.
4. **S'arrêter et le signaler** si un fichier hors liste doit changer, ou si un test décrit
   l'ancienne structure. Ne jamais contourner : ni test affaibli, ni fonction recopiée dans
   un test, ni motif de saut inventé.
5. **Noter son compte de tests de départ.** D'autres agents travaillent en même temps : on
   ne juge que ses propres échecs, et on dit lesquels ne sont pas de soi.
6. **Python seulement dans la WSL**, y compris pour les scripts de transformation d'un
   agent.
7. **Le rapport** : les fichiers touchés, les tests rouges puis verts, les comptes, ce qui
   n'est pas fait et pourquoi. La preuve, pas l'affirmation.
8. **Les modèles.** Haiku est bon pour le mécanique, quand on lui fournit les valeurs. Sa
   sortie se relit à la main, sémantique des gardes et signatures de test comprises
   (`test(nom, {skip}, {skip}, fn)` passe à vide). Les déplacements et les décisions de
   structure se confient à Opus ou Sonnet.
9. **Sessions concurrentes.** D'autres sessions Claude travaillent parfois dans ce dépôt,
   sur leur branche et dans un worktree.
   - On se coordonne par message avant de toucher leur zone.
   - On ne commite jamais un lot indexé par une autre session sans l'accord de Robin.
   - `.claude/worktrees/` ne se touche pas.
10. **Le bac à sable.** Le scratchpad de session pour tout fichier temporaire. `tmp/` est un
    bac à sable non suivi, dont seuls `tmp/corpus-relecture/` et `tmp/lexique-sources/`
    sont lus par des tests.

## 8. Surcorrection à refuser

- **Architecture** :
  - deux programmes, extensions ou dépôts pour la revue et le livre ;
  - un cadre à greffons ;
  - des classes `ProfilRevue` / `ProfilLivre` (patron Strategy) ;
  - un conteneur d'injection de dépendances, ou un bus d'événements à la place de
    `configurer` ;
  - des ports et adaptateurs autour de `vscode` (le faux vscode de `test/js/hote-factice.js`
    en tient lieu).
- **Chaîne de rendu** :
  - un Makefile unique paramétré revue/livre ;
  - fusionner `print.css` et `styles/livre/*.css` ;
  - un moteur générique de règles typographiques.
- **Interface** :
  - React, Vue, Svelte, un bundler, TypeScript, des Web Components ;
  - i18next ou zod ;
  - découper `i18n.js` par langue.
- **Python** :
  - un package `szh/` ;
  - fusionner `manuscrit_modele` et `pronto_modele` ;
  - fusionner `docx-meta` (qui devine) avec Pronto (qui refuse ce qu'il ne reconnaît pas).
- **Lanceur et plateformes** :
  - générer WinForms depuis du JSON ;
  - remplacer WSL par Docker sous Windows ;
  - Nix, AppImage ou une application Electron à part.

## 9. Publier

La procédure est dans [`docs/DEVELOPPEMENT.md`](docs/DEVELOPPEMENT.md) :
1. `git fetch` ;
2. `node test/js/porte-release.js --runner tous --version X.Y.Z` ;
3. la section `## X.Y.Z` de `CHANGELOG.md` ;
4. le bump de `vscodium-extension/<ext>/package.json` dès que son dossier a changé ;
5. un commit dont le sujet est `release: X.Y.Z résumé sans accent` ;
6. `git push origin HEAD:main`.

C'est la CI qui pose le tag `vX.Y.Z`. La majeure se monte si un numéro déjà compilé
sortirait différent, la medium s'il faut le dire à quelqu'un, la mineure sinon. Un
changement de `image/` reconstruit le rootfs : c'est la release « lourde ». On ne pousse
ni ne publie sans que Robin l'ait demandé.
