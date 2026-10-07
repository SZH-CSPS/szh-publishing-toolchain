# Développer Pronto

Cette page dit comment travailler sur le code de Pronto : les environnements, les tests, le
banc de rendu, l'instance de développement, le gabarit d'article, la publication d'une
version et les pièges à connaître. Lisez d'abord [`ARCHITECTURE.md`](ARCHITECTURE.md). Le
détail des bancs et des contrôles est dans [`test/README.md`](../test/README.md).

---

## Les environnements

### Python : seulement dans la WSL

Tout Python tourne dans la distribution WSL `SZH-Publishing`, avec le Python 3.13 de Debian.

| Environnement | Où | Pour quoi |
|---|---|---|
| `python3` du système | l'image | les scripts du pipeline, les tests Python |
| `/opt/weasyprint` | l'image | WeasyPrint, pypdf, fontTools ; le seul qui importe `weasyprint` |
| `/opt/portraits` | l'image | le détourage des portraits (rembg, onnxruntime) |
| `~/pdfvenv` | créé par `outils-dev/venv-dev.sh` | le développement : pypdfium2 et Pillow pour le rendu PNG, PyYAML pour la porte de release |

On ne lance pas Python sous Windows : `python3` y est souvent un raccourci du Microsoft Store,
qui bloque le processus. Seules exceptions : `windows/icone.py` et `windows/icone-pronto.py`,
qui pilotent Edge pour dessiner les icônes.

Créer ou mettre à jour le venv de développement, une fois par poste, depuis PowerShell :

```powershell
wsl.exe -d SZH-Publishing -- bash /mnt/c/<dépôt>/outils-dev/venv-dev.sh
```

### Lancer une commande dans la WSL

Depuis PowerShell : `wsl.exe -d SZH-Publishing -- bash <script>`. Pas depuis Git Bash, qui
réécrit les chemins `/mnt/c` et casse l'appel.

Chaque `wsl.exe` coûte environ 45 ms. Quand un traitement lance Python des dizaines de fois,
on regroupe les appels dans un seul processus (dans les tests : `pythonGroupe()`).

### Deux pandoc

| Où | Version | Rôle |
|---|---|---|
| WSL `SZH-Publishing` | 3.7.0.2 | celui qui compile ; la CI épingle la même version |
| Windows | 3.9 | utilisé par certains tests sur le poste |

Un défaut d'import peut donc ne se voir que d'un côté. Pandoc reste à 3.7.0.2 parce qu'à
partir de 3.8 le lecteur docx sort le contenu d'une zone de texte avant le paragraphe qui
l'ancre (voir le commentaire de `PANDOC_SHA256` dans `image/Containerfile`).

### Node

Les tests se lancent avec le Node du poste (`node --test`). Les outils que le cockpit lance
lui-même tournent avec le Node intégré à VSCodium (`ELECTRON_RUN_AS_NODE=1`).

---

## Les tests

```powershell
node --test test/js/*.test.js > <scratchpad>\sortie.txt 2>&1
```

Écrivez la sortie dans un fichier, puis lisez-le : un `| tail` coupe ce qui compte.

Les tests qui demandent Python passent par `python()` ou `pythonGroupe()` de
`test/js/gardes.js`. Sous Windows, ces fonctions appellent
`wsl.exe -d SZH-Publishing -- python3`, traduisent les chemins `C:\…` en `/mnt/c/…` et
transmettent les variables par `WSLENV`. Ailleurs, elles prennent le `python3` du système.
`pythonGroupe()` fait passer tous les appels d'un fichier de test par un seul processus.

### La suite exigeante

Avant tout commit d'un lot, sur le poste de développement :

```bash
SZH_WSL_OBLIGATOIRE=1 SZH_PS_OBLIGATOIRE=1 SZH_PANDOC_OBLIGATOIRE=1 SZH_PYTHON_OBLIGATOIRE=1 \
  node --test --test-timeout=300000 test/js/*.test.js test/filtres-pandoc.test.js test/filtres-import.test.js > <scratchpad>/suite.txt 2>&1
```

Résultat attendu : 0 échec (`fail`), 0 annulé (`cancelled`), et seulement des sauts dont le
motif est admis.

- Une variable `SZH_*_OBLIGATOIRE` transforme en échec l'absence de l'outil correspondant
  (WSL, PowerShell, pandoc, Python) : sur ce poste, ils doivent tous être là.
- Les motifs de saut admis sont dans `test/js/motifs-saut.js`, par environnement (`poste`,
  `ubuntu`, `windows`). Sur le poste, il reste seulement : les accents mal pliés par le
  pandoc de Windows, les corpus hors dépôt absents, les tests qui demandent un processus non
  élevé, Vale absent, et un correctif WeasyPrint pas encore présent dans l'image.
- Un test saute par un assistant `sauter.*` de `gardes.js`, qui écrit un motif reconnu. Le
  crochet `pre-push` signale un `t.skip()` écrit sans assistant.

### Les tests sous Linux

La CI fait tourner les tests sous Ubuntu. Un test doit donc :

- construire ses chemins attendus avec `path.join` ;
- s'il compare un chemin Windows normalisé (SharePoint, Bureau, lettre de lecteur,
  `C:\ProgramData`), porter dès son écriture :
  `{ skip: process.platform !== 'win32' ? 'chemins Windows — joué par le job contrats-windows' : false }`.
  Un `skip` booléen est refusé par la CI.

La porte `node test/js/porte-release.js --runner ubuntu` simule les sauts d'Ubuntu, mais
tourne sous Windows : elle ne voit ni `path.sep`, ni la casse des noms de fichier, ni
l'absence de `C:`.

### La typographie des textes visibles

Tout texte visible ajouté (i18n en fr et en de, `szh-textes.ps1`, gabarits, `userdoc.md`,
`nouveautes.json`) passe `test/typo-check.py`, dans la WSL, et se corrige par l'option
`--corriger` :

```powershell
wsl.exe -d SZH-Publishing -- bash -lc "cd /mnt/c/<dépôt> && python3 test/typo-check.py --corriger"
```

Les règles sont dans [`TYPOGRAPHIE.md`](TYPOGRAPHIE.md).

### Ce que fait la CI

`.github/workflows/ci.yml` tourne à chaque push sur `main` et à chaque pull request.

| Job | Machine | Ce qu'il vérifie |
|---|---|---|
| `contrats` | Ubuntu, Python 3.13 du runner | `test/js/*.test.js`, contrastes (`apca-check.py`), typographie (`typo-check.py`) |
| `contrats-windows` | Windows | `test/js/*.test.js` avec PowerShell ; les tests Python y sautent |
| `pdf-ua` | Ubuntu, pandoc 3.7.0.2 et WeasyPrint patché | compilation du banc, PDF/UA-1 par veraPDF, corpus d'accessibilité, livres, polices, correctifs WeasyPrint, largeur des tableaux, tests des filtres pandoc |

Pour les deux premiers jobs, `test/js/verifier-tap.js` relit la sortie des tests et refuse :
un échec, un test annulé, plus de la moitié des tests sautés, ou un saut dont le motif n'est
pas admis sur ce runner. La CI n'a pas de WSL. Le rendu PNG n'est pas fait en CI : une page
se juge à l'œil.

---

## Le banc de rendu et ses empreintes

`test/build-render.sh` compile la mini-revue `test/`, le corpus `test/accessibilite/` et les
livres du banc, applique la vérification PDF/UA, puis rend chaque page en PNG. Le détail de
ce qu'il compile et contrôle est dans [`test/README.md`](../test/README.md#le-banc-de-rendu).

Un changement qui ne doit pas modifier le rendu se prouve par comparaison avec le commit
d'avant :

1. Créer un arbre de référence au commit d'avant :
   `git worktree add --detach <scratchpad>/ref HEAD`.
2. Lancer le banc dans les deux arbres, depuis PowerShell :
   `wsl.exe -d SZH-Publishing -- bash /mnt/c/<arbre>/test/build-render.sh`.
3. Comparer les empreintes :

   | Sortie | Empreinte |
   |---|---|
   | article | md5 du HTML autonome `test/out/<slug>/<slug>.html`, identique à l'octet |
   | livre | HTML du livre dans `test/<livre>/out/`, sans les lignes `<link` (elles portent le chemin absolu de l'arbre) |
   | tout PDF | pixels de chaque page, rendus par pypdfium2 (`page-*.png`) |

4. Retirer l'arbre de référence : `git worktree remove --force <scratchpad>/ref`.

Le résultat attendu est zéro différence, hors changement voulu et listé. Tout changement de
CSS se compare au pixel, sur toutes les pages : deux feuilles aux règles identiques peuvent
rendre autrement, car l'ordre de la cascade compte.

Pour juger une seule page : `~/pdfvenv/bin/python test/render.py <pdf> <png> [page] [échelle]`.

### Vérifier l'accessibilité

Une correction d'accessibilité se prouve par un HTML minimal avant/après, puis veraPDF, puis la
comparaison au pixel. Le verdict de veraPDF (`--flavour ua1`) se lit sur l'absence de ligne
`FAIL`, pas sur la présence de `PASS`. Les normes visées sont dans
[`ACCESSIBILITE.md`](ACCESSIBILITE.md).

---

## L'instance de développement

`outils-dev/pronto-dev.ps1` installe une instance de Pronto qui lit l'arbre de travail du
dépôt par des jonctions NTFS (des liens de dossier), sans archive ni release. On modifie un
`.ps1` et on relance le script ; on modifie un `.js` du cockpit et la commande
« Developer: Reload Window » suffit.

```powershell
powershell -ExecutionPolicy Bypass -File outils-dev\pronto-dev.ps1
```

Au premier lancement, le script pose une entrée « Pronto (dev) » au menu Démarrer et active le
crochet git du dépôt (`core.hooksPath .githooks`). Sans argument, il démarre comme « Pronto »
en production (`Start-SzhAccueil`) : tâches de démarrage, puis VSCodium sur l'Accueil du
cockpit. Un lien `szh://`, `-Produit` ou `-Versions` sont transmis à
`windows/open-revue.ps1`.

| Paramètre | Effet |
|---|---|
| `-BaseDev <dossier>` | une autre racine que `C:\ProgramData\SZH-dev` (deux instances, ou un banc jetable) |
| `-Simuler` | affiche le plan complet en JSON, sans rien écrire |
| `-Menu <dossier>` | le dossier où poser le raccourci, au lieu du menu Démarrer |

| Élément | Production | Instance de développement |
|---|---|---|
| Base | `C:\ProgramData\SZH` | `C:\ProgramData\SZH-dev` |
| Toolkit | copie posée par `update.ps1` | jonction vers la racine du dépôt |
| Profil et extensions VSCodium | `%APPDATA%\VSCodium` | `<base>\codium`, désigné par `SZH_CODIUM_PROFIL` |
| Tâches de compilation | `%APPDATA%\VSCodium\User\tasks.json` | réécrites à chaque lancement sous `<base>\codium\data\User` |
| Emplacement des publications | réglage du poste | toujours `test` |
| Distribution WSL | `SZH-Publishing` | la même |
| Version affichée | numéro de la release | `0.0.0-dev+<sha court>`, écrit dans `VERSION` (ignoré par git) |

Une jonction suffit parce que le toolkit publié est une copie de dossiers du dépôt
(`release.yml` copie `pipeline`, `vscodium-user`, `revue-template`, `livre-template`,
`windows` et `moissonneurs`).

L'instance n'exerce ni `bootstrap.ps1`, ni `update.ps1`, ni les tâches planifiées, ni le
protocole `szh://` : un lien `szh://` ouvre la production. Valider un déploiement demande une
vraie release.

À savoir :

- **`SZH_CONFIG`.** `szh-citations.lua` lit la configuration du poste. `pronto-dev.ps1`
  préfixe donc chaque commande de `tasks.json` par `SZH_CONFIG=<config de dev>`.
- **Pas de `setx`.** Les variables du script (`SZH_BASE`, `SZH_TOOLKIT`,
  `SZH_COCKPIT_DOSSIER`, `SZH_CODIUM_PROFIL`) valent pour son seul processus. Posées au niveau
  du compte, elles feraient tourner la production sur la configuration de dev.
- **Le raccourci « Pronto (dev) » ne part pas sur les postes.** Seul `pronto-dev.ps1` le
  pose, et la désinstallation le compte parmi les raccourcis à retirer.
- **Provoquer un échec de compilation.** Introduire l'erreur dans un fichier du dépôt (la
  jonction la rend visible), jamais dans le toolkit de production, puis l'annuler. Vérifier
  avant que la jonction `C:\ProgramData\SZH-dev\toolkit` pointe sur l'arbre voulu, et non sur
  un worktree.

Défaire l'instance : supprimer `C:\ProgramData\SZH-dev` et l'entrée « Pronto (dev) ».
`Remove-Item -Recurse` retire les jonctions sans toucher à leur cible : le dépôt ne risque rien.

---

## La moisson mensuelle hors du cockpit

La moisson mensuelle est une commande, `moissonneurs/moisson.py` (voir
[`moissonneurs/LISEZMOI.md`](../moissonneurs/LISEZMOI.md)). Le cockpit la lance depuis
Paramètres > Moissonnage. Sur le poste de développement, on peut aussi la lancer en console
par un raccourci Bureau, qu'aucun script du dépôt ne pose. Pour le créer, une fois, dans
PowerShell :

```powershell
$racine = '<racine de production>\_NewsUndActu'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Moisson mensuelle (Pronto).lnk'))
$lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wsl.exe'
$lnk.Arguments = '-d SZH-Publishing -e python3 -B /mnt/c/ProgramData/SZH/toolkit/moissonneurs/moisson.py mensuelle --racine "' + $racine + '" --poste ' + $env:COMPUTERNAME + ' --compte ' + $env:USERNAME + ' --declencheur raccourci --evenements console'
$lnk.IconLocation = 'C:\ProgramData\SZH\toolkit\windows\pronto.ico'
$lnk.Save()
```

- `-e`, et non `--` : `wsl.exe` passe chaque argument tel quel, et la racine OneDrive contient
  des espaces.
- `--declencheur raccourci` attend Entrée à la fin, pour garder la fenêtre ouverte. Un premier
  Ctrl+C demande l'arrêt ; un second coupe net.
- Le chemin du toolkit est écrit dans le raccourci : s'il change, on refait le raccourci.

---

## Faire évoluer le gabarit d'article

Le gabarit « Pronto – modèle d'article » est le modèle Word que remplissent les autrices et
auteurs. Il existe en quatre fichiers, dans `revue-template/` :

| Fichier | Produit |
|---|---|
| `Pronto - modele d'article_FR.docx` et `_FR.odt` | Revue (français) |
| `Pronto - modele d'article_DE.docx` et `_DE.odt` | Zeitschrift (allemand) |

Deux programmes en dépendent :

- l'import (`pipeline/pronto-lire.py`), qui lit un document rempli ;
- le nettoyeur de manuscrit (`pipeline/manuscrit-nettoyer.py`), qui écrit sa sortie dans une
  copie du gabarit.

Le gabarit n'est pas copié dans les numéros neufs. Il arrive sur les postes avec le toolkit,
donc seulement par une release.

### La clé du gabarit

Un document est reconnu « au gabarit » par une propriété personnalisée du fichier,
`SZH-Gabarit`, qui vaut aujourd'hui `pronto-article-4`. Dans le fichier, elle est dans
`docProps/custom.xml` (`.docx`) ou dans `meta.xml`, élément `meta:user-defined` (`.odt`).
Dans Word, elle se voit sous Fichier → Informations → Propriétés → Propriétés avancées →
Personnalisation.

- **Qui la pose** : `outils-dev/marquer-gabarit.py`, et lui seul. Il remplace une clé
  existante et recopie le reste du fichier à l'octet.
- **Qui la lit** : `est_gabarit()` de `pipeline/pronto_modele.py`, pour l'import comme pour
  le nettoyeur. Seul le préfixe `pronto-article` compte : un document rempli dans un gabarit
  plus ancien reste reconnu.
- **Sans clé**, le document est reconnu s'il porte les deux styles `SZH Cle` et `SZH Aide`
  (`STYLES_GABARIT`).

### Modifier le gabarit, pas à pas

Toutes les commandes `python3` et `soffice` se lancent dans la WSL, depuis la racine du dépôt :
`wsl.exe -d SZH-Publishing -- bash -lc "cd /mnt/c/<dépôt> && …"`.

1. **Remplacer les deux `.docx`** dans `revue-template/`, sous le même nom. Le numéro de
   version ne va pas dans le nom : git versionne.
2. **Régénérer les deux `.odt`** depuis les `.docx` :

   ```bash
   soffice --headless --convert-to odt --outdir revue-template revue-template/Pronto*.docx
   ```

   `test/js/pronto-gabarits.test.js` échoue si un `.odt` ne donne pas la même fiche que son
   `.docx`.
3. **Monter la version de la clé** :
   - `CLE_GABARIT_VALEUR` dans `pipeline/pronto_modele.py` (par exemple `pronto-article-5`) ;
   - les deux valeurs attendues `'pronto-article-4'` de `test/js/cle-gabarit.test.js` (le
     fichier marqué, et la sortie du nettoyeur), à remplacer par la nouvelle valeur.
4. **Marquer les quatre fichiers** :

   ```bash
   python3 outils-dev/marquer-gabarit.py revue-template/*.docx revue-template/*.odt
   ```

   On marque les quatre à chaque fois : un fichier réenregistré a pu perdre sa clé.
5. **Garder lisibles les documents déjà remplis.** Un article rempli dans l'ancien gabarit peut
   arriver des mois plus tard. Les tables d'étiquettes sont dans `pipeline/pronto_modele.py` :
   `CANON_METADONNEES` (tableau des métadonnées), `CANON_AUTEUR` (autrices et auteurs),
   `CANON_FIGURE` (blocs figure et tableau).
   - **Étiquette renommée** : garder l'ancienne forme comme alias dans la table. Si
     l'ancienne forme était tapée exactement, l'ajouter aussi à `FORMES_EXACTES_ANCIENNES`
     pour qu'elle passe sans avertissement (exemple : « Crédit », devenu « Copyright »).
     Sans alias, un document rempli dans l'ancien gabarit est refusé à l'import.
   - **Étiquette retirée** : la garder dans la table, sans destination, avec un
     avertissement (exemple : `langue`, qui produit `langue-du-document-ignoree`).
   - **Étiquette ajoutée** : lui donner une entrée dans la table et une branche dans le
     lecteur qui range sa valeur. Sans cela, un document où elle est remplie est refusé à
     l'import (`etiquette-metadonnees-inconnue`, `auteur-etiquette-inconnue` ou
     `bloc-etiquette-inconnue`) : rien n'est créé et le Word reste en attente. Une étiquette
     laissée vide est ignorée.
6. **Reporter un style renommé ou ajouté** partout où un nom de style est attendu :
   - `STYLES_GABARIT` (`pipeline/pronto_modele.py`) ;
   - `_REPLI_STYLES_MAISON` (`pipeline/manuscrit_gabarit.py`) ;
   - `STYLES_BLOCS` (`pipeline/docx-styles-corps.py`) et sa copie dans
     `pipeline/filters/szh-styles-corps.lua`.

   Les titres et le corps se trouvent par leur nom (`w:name` : `heading 1`, `Body Text`), pas
   par leur identifiant (`styleId`) : un Word allemand traduit les identifiants, pas les noms.
7. **Lancer la [suite exigeante](#la-suite-exigeante).** Les tests du gabarit sont
   `pronto-gabarits.test.js`, `cle-gabarit.test.js`, `manuscrit-gabarit.test.js`,
   `styles-corps.test.js` et `import-odt.test.js`.
8. **Essayer un vrai document** rempli à la main dans le nouveau gabarit, par l'import et par
   le nettoyeur. Un gabarit rempli par script prouve que rien ne se perd, pas qu'une personne
   saura le remplir. Un fichier fabriqué par script n'a pas non plus de numéros de page
   (`w:lastRenderedPageBreak`).
9. **Publier en medium** : la rédaction doit savoir qu'il y a un nouveau gabarit. On transmet
   aux autrices et auteurs le `.docx` marqué du dépôt, pas une copie retouchée à part, qui
   n'aurait pas la clé.

---

## Publier une version

### Numéroter

Les versions s'écrivent `majeure.medium.mineure`. On se pose trois questions, dans l'ordre :

| Question | Niveau |
|---|---|
| Un numéro ou un livre déjà compilé sortirait-il différent ? | majeure |
| Faut-il le dire à quelqu'un ? | medium |
| Ni l'un ni l'autre | mineure |

En cas de doute, c'est une mineure. Le cockpit avertit quand la majeure du poste diffère de
celle qui a créé le numéro (`version-toolkit:` de `ausgabe.yaml`). Le sélecteur de versions
propose une ligne par medium. `update.ps1 -Version X.Y.Z` installe n'importe quelle version.

Un changement de `image/` reconstruit l'image WSL : c'est la release « lourde ». La procédure
de l'image est dans [`MAINTENANCE.md`](MAINTENANCE.md).

### Étapes

1. `git fetch`, pour partir de l'état réel de `main`.
2. Lancer la porte de release :

   ```bash
   node test/js/porte-release.js --runner tous --version X.Y.Z
   ```

   Elle rejoue en local ce que la CI jugera. Sans `--runner`, elle juge le poste ;
   `--runner tous` juge le poste puis Ubuntu et Windows simulés ; `--rapide` ne fait que les
   contrôles rapides (YAML des workflows, typographie, versions des extensions, CHANGELOG).
3. Écrire la section `## X.Y.Z` de [`CHANGELOG.md`](../CHANGELOG.md). `release.yml` en tire les
   notes publiées.
4. Pour un medium seulement : ajouter la note de [`nouveautes.json`](../nouveautes.json), la
   fenêtre « Quoi de neuf » que le cockpit ouvre après la mise à jour. Elle s'adresse à la
   rédaction : en fr et en de, trois à cinq points d'une phrase, sans nom de fichier ni
   numéro de version. La clé est le medium (`"3.10"`). `test/js/nouveautes.test.js` refuse
   une note absente dans une langue, ou dont les deux langues n'ont pas le même nombre de
   points.
5. Monter la `version` du `package.json` de chaque extension (`vscodium-extension/<ext>/`)
   dont le dossier a changé depuis la release précédente. Sinon `update.ps1`, qui compare les
   versions, ne la réinstalle pas.
6. Committer avec le sujet `release: X.Y.Z résumé sans accent`.
7. `git push origin HEAD:main`.

C'est la CI qui pose le tag. Quand `ci` réussit sur un commit dont le sujet commence par
`release: X.Y.Z`, `release.yml` pose le tag annoté `vX.Y.Z` et publie. Si `ci` échoue, aucun
tag n'est posé : on corrige et on pousse un nouveau commit `release:`.

L'image WSL n'est reconstruite que si `image/` a changé depuis la release précédente
(`image/patches/amont/` mis à part). Pour republier à la main : Actions → release →
*Run workflow*, avec `force_rootfs` au besoin.

Avant de publier, on peut rejouer la suite et `typo-check.py` dans un arbre isolé du commit :
`git worktree add --detach <scratchpad>/verif HEAD`, puis
`git worktree remove --force <scratchpad>/verif`.

### Le crochet pre-push

`.githooks/pre-push` lance la partie rapide de la porte avant chaque push. Il s'active une
fois par clone par `git config core.hooksPath .githooks` (`pronto-dev.ps1` le fait).
`SZH_SANS_PORTE=1 git push` le contourne.

---

## Patcher WeasyPrint

On ne patche WeasyPrint qu'en dernier recours, et seulement avec l'accord du responsable du dépôt (Robin Morand). On
essaie d'abord le CSS, le HTML produit par la chaîne et les options officielles.

| Quoi | Où |
|---|---|
| un patch par fonctionnalité | `image/patches/weasyprint-<version>/NN-nom.patch` |
| le script qui les applique | `image/patch-weasyprint.sh`, appelé par `image/Containerfile` et par la CI |
| un cas de test par patch | `test/weasyprint-patch-check.py` |
| le dossier pour l'équipe de WeasyPrint (rapport, démo, texte d'issue) | `image/patches/amont/<NN-nom>/`, résumé dans [`image/patches/amont/README.md`](../image/patches/amont/README.md) |

Règles :

- Chaque patch s'applique seul, au caractère près (`--fuzz=0`). Le script échoue si un patch
  ne s'applique pas, ou s'il n'existe pas de dossier pour la version installée.
- Pour désactiver un patch, le renommer en `.patch.off`.
- Le cas de test doit échouer sur WeasyPrint sans patch et passer sur l'image patchée.
- Preuves avant de fusionner : démo minimale avant/après, empreintes et pixels du banc,
  veraPDF sans `FAIL`.
- Rien ne se publie chez WeasyPrint sans l'accord du responsable du dépôt.
- Un patch n'arrive sur les postes qu'à la reconstruction de l'image. D'ici là, les tests
  qui en dépendent sautent sous le motif « correctif WeasyPrint absent ».
- À chaque montée de WeasyPrint, on vérifie d'abord si l'amont a corrigé chaque défaut, et on
  retire le patch devenu inutile.

---

## Pièges à connaître

- **`ELECTRON_RUN_AS_NODE=1` est hérité du cockpit.** Tout processus lancé par le cockpit le
  reçoit, et `VSCodium.exe "<dossier>"` démarre alors comme Node, sans fenêtre.
  `szh-common.ps1` retire la variable au chargement, et `Start-SzhCodium` est le seul point
  de lancement de l'éditeur.
- **Pas de `detached: true` pour lancer un script PowerShell depuis le cockpit.** Sous
  Windows, `powershell.exe` démarre alors sans console et rend la main sans rien exécuter. On
  passe par `wscript.exe //B hidden.vbs`.
- **Un `update.ps1` lancé à la main a une passe de retard.** PowerShell lit le script entier
  avant de l'exécuter : la passe qui installe un nouveau `update.ps1` continue avec l'ancien.
  On le relance une fois.
- **`<numéro>/.vscode/settings.json`** est le seul fichier technique admis dans un numéro. Il
  s'écrit par `fs`, pas par l'API de configuration de VSCodium, que le verrou empêcherait
  d'écrire.
- **Un lien `szh://` vient de l'extérieur.** On ne construit pas de chemin sur un segment reçu
  sans passer par `Get-SzhLien`, puis `Find-SzhRevue` ou `Find-SzhProduitOuvrir`.
- **`inotify` ne traverse pas `/mnt/c`.** Un observateur de fichiers Linux ne voit pas les
  changements des fichiers Windows.
- **PowerShell 5.1.** Pas de `?.`, `??`, `?:`, `&&` ni `||`. Les `.ps1` sont en CRLF, avec BOM
  UTF-8 et `\n` final (`git ls-files --eol windows/` doit montrer `i/crlf`). Tout le reste est
  en LF. Un `.ps1` se vérifie par `[Parser]::ParseFile()` avec un chemin en barres inverses.
- **Après une écriture dans `extension.js`**, les ancres `function activate(` et `_pur:`
  doivent être présentes, puis `node --check` doit passer.
- **Workspace Trust est désactivé** sur les postes, pour que la compilation à l'enregistrement
  parte sans confirmation.
- **`tmp/` est un bac à sable non suivi** et peut être vidé. Certains tests y lisent des corpus
  hors dépôt (`tmp/corpus-relecture/`, `tmp/lexique-sources/`, `tmp/docx-dev/`) et sautent
  s'ils manquent. Aucun manuscrit réel ne va dans le dépôt, qui est public.
