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

Sans argument, le script appelle `Start-SzhAccueil` (`windows/szh-shell.ps1`), comme
« Pronto » en production : les tâches de démarrage (ancrage, rapports en attente, check-in,
épinglage, dossiers de test, secrets), puis VSCodium en `-n` sans dossier, où le cockpit
ouvre l'Accueil. Un lien `szh://`, `-Produit` ou `-Versions` passent à
`windows/open-revue.ps1`. Rien ne se rouvre au démarrage : `window.restoreWindows` vaut
`none` dans les réglages de la maison.

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
windows moissonneurs`. Le script recrée le fichier `VERSION` (`0.0.0-dev+<sha court>`), gitignoré.
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

## La moisson mensuelle hors du cockpit

La moisson mensuelle est une seule commande, `moissonneurs/moisson.py` (contrat dans
[`../moissonneurs/LISEZMOI.md`](../moissonneurs/LISEZMOI.md)). Le bouton de Paramètres >
Moissonnage la lance sur tout poste ; la console la rend sur le poste de développement, par un
raccourci Bureau ou à la main. Le raccourci n'est posé par aucun script du dépôt, ni
`update.ps1` ni `bootstrap.ps1` : la rédaction ne le reçoit jamais. Sur le poste de
développement, une fois, dans PowerShell :

```powershell
$racine = '<racine de production>\_NewsUndActu'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Moisson mensuelle (Pronto).lnk'))
$lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wsl.exe'
$lnk.Arguments = '-d SZH-Publishing -e python3 -B /mnt/c/ProgramData/SZH/toolkit/moissonneurs/moisson.py mensuelle --racine "' + $racine + '" --poste ' + $env:COMPUTERNAME + ' --compte ' + $env:USERNAME + ' --declencheur raccourci --evenements console'
$lnk.IconLocation = 'C:\ProgramData\SZH\toolkit\windows\pronto.ico'
$lnk.Save()
```

- `-e`, et non `--` : wsl.exe passe alors chaque argument tel quel, et la racine OneDrive porte
  des espaces.
- `--declencheur raccourci` fait attendre Entrée à la fin, pour que la fenêtre reste ouverte. Le
  premier Ctrl+C demande l'arrêt ; le second coupe net.
- Le chemin du toolkit est écrit en dur : si `C:\ProgramData\SZH\toolkit` change, on refait le
  raccourci.
- En ligne de commande, la même ligne, précédée de `wsl.exe`, sans `--declencheur`.

Le cockpit passe la racine active. Sur Revues-TESTING, il ajoute `--hors-ligne --racine-test` :
une passe de test ne fait aucune requête réseau.

---

## Faire évoluer le gabarit d'article

Le gabarit « Pronto – modèle d'article » existe en quatre fichiers, dans `revue-template/` :
`Pronto - modele d'article_FR.docx` (Revue), `_DE.docx` (Zeitschrift), et leurs `.odt`. Deux
programmes en dépendent : l'import (`pronto-lire.py`, qui lit un Word rempli) et le nettoyeur
de manuscrit (`manuscrit-nettoyer.py`, qui écrit sa sortie **dans une copie du gabarit**). Le
toolkit déployé en emporte une copie : un nouveau gabarit n'arrive sur les postes qu'avec une
release. Il ne part plus dans les numéros neufs.

### La clé cachée

Un document est reconnu « au gabarit » par une **propriété personnalisée** du fichier,
`SZH-Gabarit`, qui vaut aujourd'hui `pronto-article-4`. Elle se voit dans Word par Fichier →
Informations → Propriétés → Propriétés avancées → Personnalisation, et dans LibreOffice par
Fichier → Propriétés → Propriétés personnalisées. Dans le fichier : `docProps/custom.xml`
pour un `.docx`, `meta.xml` (`meta:user-defined`) pour un `.odt`. Word et LibreOffice la
gardent à l'enregistrement, et elle passe la conversion `.odt` → `.docx` de l'import.

- **Qui la pose** : `outils-dev/marquer-gabarit.py`, et lui seul. Il la remplace si elle
  existe déjà, et recopie le reste du fichier à l'octet. Personne ne la tape à la main.
- **Qui la lit** : `pronto_modele.est_gabarit()`, la même règle pour l'import et le nettoyeur.
  Seul le **préfixe** `pronto-article` compte ; le numéro qui suit dit la version du gabarit
  et ne décide de rien. Un document rempli dans un gabarit plus ancien reste donc reconnu.
- **Sans clé** (document parti d'un gabarit antérieur au 01.10.2026), le repli est la
  présence des deux styles `SZH Cle` **et** `SZH Aide` dans `styles.xml`.

### Ce qu'il faut faire quand le gabarit change

1. **Remplacer le `.docx`** dans `revue-template/`, sous le même nom. Le dépôt versionne ;
   pas de « V5 » dans le nom.
2. **Régénérer le `.odt`** depuis le `.docx`, dans la WSL :
   `soffice --headless --convert-to odt --outdir revue-template "revue-template/Pronto - modele d'article_FR.docx"`.
   Un `.docx` modifié sans son `.odt` est exactement ce que `pronto-gabarits.test.js` détecte.
3. **Monter la version de la clé** dans `pronto_modele.py` (`CLE_GABARIT_VALEUR`,
   `pronto-article-5`…), puis **marquer les quatre fichiers**, dans la WSL :
   `python3 outils-dev/marquer-gabarit.py revue-template/*.docx revue-template/*.odt`.
   Un fichier venu de Word ou réenregistré par quelqu'un a pu la perdre : on remarque les
   quatre à chaque fois.
4. **Garder lisibles les documents déjà remplis.** C'est le point qui casse en silence : un
   article rempli dans l'ancien gabarit arrive encore des mois plus tard.
   - Une **étiquette renommée** (métadonnées, autrices et auteurs, blocs figure et tableau)
     garde son ancienne forme comme alias dans `CANON_METADONNEES`, `CANON_AUTEUR` ou
     `CANON_FIGURE` (`pronto_modele.py`) ; ajoutée à `FORMES_EXACTES_ANCIENNES` si elle était
     tapée juste, pour ne pas avertir. Sans alias, l'import **refuse** l'article (étiquette
     inconnue). Exemple : « Crédit », devenu « Copyright » le 30.09.2026.
   - Une **étiquette retirée** reste reconnue sans destination (voir `langue` dans
     `CANON_METADONNEES`), pour avertir au lieu de bloquer.
   - Une **étiquette ajoutée** n'est lue nulle part tant qu'elle n'a pas sa clé dans les
     tables `CANON_*` et sa branche dans le lecteur.
5. **Un style renommé ou ajouté** se reporte partout où un nom de style est attendu :
   `STYLES_GABARIT` (les deux styles du repli de reconnaissance, `pronto_modele.py`),
   `_REPLI_STYLES_MAISON` (`manuscrit_gabarit.py`), `STYLES_BLOCS` (`docx-styles-corps.py`,
   tenu en miroir dans `szh-styles-corps.lua`). Les titres et le corps se résolvent par leur
   `w:name` (`heading 1`, `Body Text`), jamais par leur `styleId` : un Word allemand renomme
   les `styleId`, pas les `w:name`.
6. **Rejouer les contrôles du gabarit**, dans la suite exigeante : `pronto-gabarits.test.js`
   (même fiche du `.docx` et du `.odt`), `cle-gabarit.test.js` (la clé sur les quatre
   fichiers, et dans la sortie du nettoyeur), `manuscrit-gabarit.test.js` (le nettoyeur écrit
   dans le nouveau gabarit et se relit), `styles-corps.test.js` et `import-odt.test.js`.
7. **Passer un vrai document** rempli à la main dans le nouveau gabarit par l'import et par
   le nettoyeur : un gabarit rempli par script ne dit rien de ce qu'une autrice saura remplir
   ([`TODO/parser-v2.md`](TODO/parser-v2.md)).
8. **Publier**, en medium : la rédaction doit savoir qu'il y a un nouveau gabarit. La copie
   envoyée aux autrices et auteurs vit hors du dépôt ; c'est le `.docx` marqué du dépôt
   qu'on leur transmet, jamais une copie retouchée à part, qui n'aurait pas la clé.

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
