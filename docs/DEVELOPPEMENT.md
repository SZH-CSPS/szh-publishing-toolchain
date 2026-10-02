# Développer Pronto

Les environnements, les tests, le banc de rendu, l'instance de développement, la publication
d'une version et les pièges à connaître avant de toucher au code. L'architecture est dans
[`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Les environnements

### Tout Python dans la WSL

Tout Python tourne dans la distribution WSL `SZH-Publishing`, sur un seul interprète : le
Python 3.13 de Debian.

| Environnement | Où | Pour quoi |
|---|---|---|
| `python3` du système | la distro | les scripts du pipeline, les tests Python |
| `/opt/weasyprint` | l'image | WeasyPrint, pypdf, fontTools ; le seul qui importe `weasyprint` |
| `/opt/portraits` | l'image | détourage des portraits (rembg, onnxruntime) |
| `~/pdfvenv` | créé par `outils-dev/venv-dev.sh` | le venv de développement : pypdfium2 et Pillow pour le rendu PNG, PyYAML pour la porte de release, versions épinglées |

Jamais `python` ni `python3` sous Windows : `python3` y est souvent le raccourci du Microsoft
Store, qui fige le processus. Seules exceptions : `windows/icone.py` et
`windows/icone-pronto.py`, qui pilotent Edge pour dessiner les icônes. La CI n'a pas de WSL :
elle prend le Python 3.13 de son runner.

Créer ou mettre à jour le venv de développement, une fois par poste :

```powershell
wsl.exe -d SZH-Publishing -- bash /mnt/c/<dépôt>/outils-dev/venv-dev.sh
```

### Lancer la WSL

Depuis l'outil PowerShell : `wsl.exe -d SZH-Publishing -- bash <script>`. Jamais depuis
Git Bash, qui réécrit les chemins `/mnt/c` et casse l'appel. Un `wsl.exe` coûte environ
45 ms de passage : quand un traitement lance Python des dizaines de fois, on regroupe les
appels dans un même processus WSL.

### Deux pandoc

Pandoc 3.9 est installé sous Windows, 3.7.0.2 dans la WSL. C'est celui de la WSL qui compile,
et celui que la CI épingle : un défaut d'import peut ne se voir que d'un côté. Pandoc reste à
3.7.0.2 parce qu'à partir de 3.8 le lecteur docx sort le contenu d'une zone de texte avant le
paragraphe qui l'ancre (voir le commentaire de `PANDOC_SHA256` dans `image/Containerfile`).

---

## Les tests

```powershell
node --test test/js/*.test.js > sortie.txt 2>&1
```

Écrire la sortie dans un fichier, puis le lire : un `| tail` coupe ce qui compte. Les tests
Python passent par la fonction `python()` de `test/js/gardes.js`, qui lance
`wsl.exe -d SZH-Publishing -- python3` sous Windows (chemins `C:\…` traduits en `/mnt/c/…`,
variables transmises par `WSLENV`) et le `python3` du runner ailleurs. `pythonGroupe()` fait
passer tous les appels d'un fichier par un seul processus WSL (`test/js/pilote-python.js`,
`test/pilote-python.py`).

### La suite exigeante

Sur le poste de développement, avant un commit qui touche le code :

```bash
SZH_WSL_OBLIGATOIRE=1 SZH_PS_OBLIGATOIRE=1 SZH_PANDOC_OBLIGATOIRE=1 SZH_PYTHON_OBLIGATOIRE=1 \
  node --test --test-timeout=120000 test/js/*.test.js test/filtres-pandoc.test.js test/filtres-import.test.js
```

Attendu : 0 fail, 0 cancelled. Les variables `SZH_*_OBLIGATOIRE` changent en échec le saut
d'un test dont l'outil devrait être là. Les seuls sauts admis sont les motifs de
`test/js/motifs-saut.js` ; en CI, `test/js/verifier-tap.js` relit le TAP et refuse un saut
sans motif admis sur ce runner.

### La typographie des textes visibles

Tout texte visible ajouté (i18n en fr et en de, `szh-textes.ps1`, gabarits, `userdoc.md`,
`nouveautes.json`) passe par `test/typo-check.py`, lancé dans la WSL, et se corrige par
`--corriger`, jamais à la main :

```powershell
wsl.exe -d SZH-Publishing -- python3 /mnt/c/<dépôt>/test/typo-check.py --corriger
```

Les autres scripts de `test/` (contraste, polices, typographie des articles, EPUB…) sont
décrits dans [`../test/README.md`](../test/README.md).

---

## Le banc de rendu et ses empreintes

`test/build-render.sh` compile la mini-revue `test/`, le corpus `test/accessibilite/` et les
deux livres `test/livre-normal` et `test/livre-falc`, passe la porte PDF/UA et rend chaque
page en PNG par `test/render-all.py` (pypdfium2, venv de développement). Il refuse un PDF du
banc sorti non balisé.

Un changement de code qui ne doit pas changer le rendu se prouve par trois empreintes,
comparées à un worktree détaché du commit d'avant
(`git worktree add --detach <scratchpad>/ref HEAD`) :

| Sortie | Empreinte |
|---|---|
| article | md5 du HTML autonome `out/<slug>/<slug>.html` : identique à l'octet |
| livre | HTML du livre, lignes `<link` retirées (les chemins absolus des feuilles diffèrent entre deux arbres) |
| tout PDF | pixels de chaque page, rendus par pypdfium2 |

Zéro différence attendue, hors changement voulu et listé. Tout changement de feuille CSS se
compare au pixel sur toutes les pages : l'égalité des règles ne suffit pas, l'ordre de la
cascade compte. La boucle avant/après est décrite dans [`../test/README.md`](../test/README.md).

---

## L'instance de développement

`outils-dev/pronto-dev.ps1` pose une instance de Pronto qui lit l'arbre de travail du dépôt
par jonctions NTFS, sans zip, sans VSIX ni tag. On édite un `.ps1` et on relance le script ;
on édite un `.js` du cockpit et « Developer: Reload Window » suffit.

```powershell
powershell -ExecutionPolicy Bypass -File outils-dev\pronto-dev.ps1
```

Elle vit sous `C:\ProgramData\SZH-dev`, à côté de la production, jamais dedans. Le script
pose au premier lancement une entrée « Pronto (dev) » au menu Démarrer. Paramètres :
`-BaseDev <dossier>` (une autre racine, pour deux instances ou un banc jetable), `-Simuler`
(le plan complet en JSON, sans rien écrire), `-Menu <dossier>` (où poser le raccourci).

Sans argument, le script ouvre VSCodium sans dossier, en `--new-window`, sur le lanceur du
cockpit. Il fait d'abord les tâches de démarrage d'`open-produit.ps1` (ancrage, rapports en
attente, check-in, épinglage, dossiers de test) et pose les secrets. `SZH_ACCUEIL=1` ne vit
que dans l'environnement de VSCodium. `-Lanceur`, un lien `szh://`, `-Produit` ou
`-Versions` passent à `windows/open-revue.ps1`, donc au lanceur WinForms. VSCodium ne
rouvre pas le dernier numéro : en `--new-window` sans dossier, il ne restaure la session
que si `window.restoreWindows` vaut `preserve`.

| Élément | Production | Instance de dev |
|---|---|---|
| Base | `C:\ProgramData\SZH` | `C:\ProgramData\SZH-dev` |
| Toolkit | copie posée par `update.ps1` | jonction vers la racine du dépôt |
| Profil et extensions VSCodium | `%APPDATA%\VSCodium` | `<baseDev>\codium`, par `SZH_CODIUM_PROFIL` |
| Tâches de compilation | `%APPDATA%\VSCodium\User\tasks.json` | réécrites à chaque lancement sous `<baseDev>\codium\data\User` |
| Emplacement des publications | choix du poste | toujours `test` |
| Distribution WSL | `SZH-Publishing` | la même |

Une jonction vers la racine suffit parce que le toolkit livré est le dépôt lui-même :
`release.yml` le construit par `cp -r pipeline vscodium-user revue-template livre-template
windows`. Le script recrée le fichier `VERSION` (`0.0.0-dev+<sha court>`), gitignoré.
L'instance n'exerce ni `bootstrap.ps1`, ni `update.ps1`, ni les tâches planifiées, ni le
protocole `szh://` : un lien `szh://` ouvre la production. Valider un déploiement demande
une vraie release.

Pièges :

- **`SZH_CONFIG`.** `szh-citations.lua` lit `/mnt/c/ProgramData/SZH/config.json` (titres de
  bibliographie) ; `pronto-dev.ps1` préfixe donc chaque commande de `tasks.json` par
  `SZH_CONFIG=<config de dev>`. `Start-SzhCodium` ne transmet par `WSLENV` que les réglages
  Shlink et OJS, jamais `SZH_CONFIG`.
- **Jamais de `setx`.** Les variables du script (`SZH_BASE`, `SZH_TOOLKIT`,
  `SZH_COCKPIT_DOSSIER`, `SZH_CODIUM_PROFIL`) ne valent que pour son processus : au niveau du
  compte, elles feraient tourner la production sur la configuration de dev.
- **`-Menu` et les tests.** Le harnais passe `-Menu` plutôt que de détourner `APPDATA` : le
  contrôle « la production n'est pas touchée » doit lire le vrai menu Démarrer, sinon il
  devient vrai par construction.
- **Le raccourci ne part jamais sur les postes.** `Set-SzhRaccourciDev` n'existe que dans
  `pronto-dev.ps1`, et `Get-SzhRaccourcisObsoletes` le compte parmi les raccourcis à retirer :
  une désinstallation l'emporte.

Défaire l'instance : supprimer `C:\ProgramData\SZH-dev` et l'entrée « Pronto (dev) ».
`Remove-Item -Recurse` retire les jonctions sans suivre leur cible : le dépôt ne risque rien.

---

## Publier une version

### Numéroter

Les versions sont en `majeure.medium.mineure`. Trois questions, dans l'ordre :

| Question | Niveau |
|---|---|
| Un numéro ou un livre déjà compilé sortirait-il différent ? | majeure |
| Faut-il le dire à quelqu'un ? | medium |
| Ni l'un ni l'autre | mineure |

En cas d'hésitation, c'est une mineure. Le sélecteur de version du lanceur ne propose qu'une
ligne par medium, et l'avertissement de maquette du cockpit ne se déclenche que sur un écart
de majeure entre la version qui a créé le numéro (`version-toolkit:`) et celle du poste.
`update.ps1 -Version <X>` revient à n'importe quelle version en ligne de commande.

Chaque release a sa section `## X.Y.Z` dans [`../CHANGELOG.md`](../CHANGELOG.md), dont
`release.yml` tire les notes publiées. La version d'une extension suit son propre compte :
toute extension dont le dossier a changé depuis la release précédente doit voir la `version`
de son `package.json` incrémentée, sinon `update.ps1`, qui compare les versions, ne la
réinstalle jamais.

### La note d'un medium

Un medium, et lui seul, demande une note dans [`../nouveautes.json`](../nouveautes.json), la
fenêtre « Quoi de neuf » que le cockpit ouvre après la mise à jour. `CHANGELOG.md` nomme des
fonctions pour qui tient le code ; `nouveautes.json` parle de gestes à qui fabrique un numéro,
en fr et en de, trois à cinq points d'une phrase, sans nom de fichier ni numéro de version. La
clé est le medium (`"1.1"`). `test/js/nouveautes.test.js` refuse une note qui manque dans une
langue ou dont les deux langues n'ont pas le même nombre de points.

### La porte et le commit de release

```bash
node test/js/porte-release.js --runner tous --version X.Y.Z
git commit -m "release: X.Y.Z <résumé en une ligne>" && git push
```

`porte-release.js` rejoue en local ce que la CI jugera : sans `--runner`, le poste ;
`--runner tous`, le poste puis ubuntu et windows simulés (`SZH_SIMULER_RUNNER`) ; `--rapide`,
les seuls contrôles rapides (YAML des workflows, typographie, bump, CHANGELOG).

Le commit part sur `main` comme un autre. Quand `ci` conclut en succès sur un commit dont le
sujet suit `release: X.Y.Z …`, `release.yml` (déclenché par `workflow_run`) pose le tag
annoté `vX.Y.Z` et publie. Un commit `release:` dont `ci` échoue ne pose aucun tag. Le rootfs
n'est reconstruit que si `image/` a changé ; une repose manuelle passe par Actions → release
→ *Run workflow*, avec `force_rootfs` au besoin. Pas de push ni de release sans l'accord de
Robin.

Le crochet `.githooks/pre-push` rejoue la partie rapide de la porte et un balayage des
`t.skip()` qui ne passent pas par un assistant `sauter.*`. Activation, une fois par clone :
`git config core.hooksPath .githooks` (posé par `pronto-dev.ps1`). `SZH_SANS_PORTE=1 git push`
le contourne, en disant pourquoi.

---

## Pièges à connaître avant de toucher au code

- **`ELECTRON_RUN_AS_NODE=1` est hérité de l'hôte d'extensions.** Tout processus lancé par le
  cockpit le reçoit, et `VSCodium.exe "<dossier>"` cherche alors un script Node et meurt sans
  fenêtre. `szh-common.ps1` purge la variable au dot-source, et `Start-SzhCodium` est le seul
  point de lancement de l'éditeur.
- **Pas de `detached: true` pour un script PowerShell lancé par l'extension.** Sous Windows,
  `powershell.exe` démarre sans console et ressort aussitôt avec le code 0. Passer par
  `wscript.exe //B hidden.vbs`.
- **Un `update.ps1` lancé à la main est en retard d'une passe.** PowerShell lit le fichier
  entier avant de l'exécuter : la passe qui extrait le nouveau toolkit continue avec l'ancien
  code. Après un `update.ps1` manuel qui modifie `update.ps1`, le relancer une fois.
- **`<numéro>/.vscode/settings.json`** est le seul fichier technique toléré dans un numéro,
  et seulement verrouillé. Il s'écrit par `fs`, jamais par l'API de configuration, que le
  verrou empêcherait d'écrire au déverrouillage.
- **Un lien `szh://` vient de l'extérieur.** Il ne porte aucun chemin ; ne jamais construire
  un chemin sur un segment reçu sans repasser par `Get-SzhLien` puis `Find-SzhRevue` ou
  `Find-SzhProduitOuvrir`.
- **`inotify` ne traverse pas `/mnt/c`.** Aucune fonction ne peut reposer sur un observateur
  Linux qui lirait les fichiers Windows.
- **PowerShell 5.1.** Pas de `?.`, `??`, `?:`, `&&` ni `||` ; les `.ps1` restent en CRLF, BOM
  UTF-8 et `\n` final (`git ls-files --eol windows/` doit montrer `i/crlf`).
- **Workspace Trust est désactivé** sur les postes, pour que la compilation à
  l'enregistrement parte sans confirmation : compromis assumé sur des machines dédiées.
- **Un fichier supprimé du dépôt reste sur les postes** : `update.ps1` extrait le toolkit par
  `Expand-Archive -Force`, qui écrase sans jamais supprimer.
