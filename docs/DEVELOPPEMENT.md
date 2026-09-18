# Instance de développement

Modifier `windows/szh-shell.ps1` ou `vscodium-extension/szh-cockpit/lib/citations.js`
puis vérifier l'effet exigeait jusqu'ici une release complète : tag, VSIX, toolkit
zippé, poste réinstallé ou mis à jour. `outils-dev/pronto-dev.ps1` court-circuite ce
détour pour le travail courant. Il pose une instance de Pronto qui lit l'arbre de
travail du dépôt directement, par jonctions NTFS — pas de zip, pas de VSIX construit,
pas de tag. On édite un `.ps1` et on relance le script ; on édite un `.js` de
l'extension et « Developer: Reload Window » dans la fenêtre de dev suffit, sans
même relancer le script.

Elle vit sous `C:\ProgramData\SZH-dev` par défaut, à côté de l'installation de
production sous `C:\ProgramData\SZH`, jamais dedans.

---

## Lancer l'instance

### Le raccourci du menu Démarrer

Le script pose lui-même une entrée « Pronto (dev) » au menu Démarrer, au premier
lancement réel — jamais `update.ps1` ni `bootstrap.ps1` ne la posent, voir plus bas.
Une fois posée, il suffit de cliquer l'entrée comme n'importe quel raccourci.

### En ligne de commande

```powershell
powershell -ExecutionPolicy Bypass -File outils-dev\pronto-dev.ps1
```

Trois paramètres, tous optionnels. `-BaseDev <dossier>` change la racine de
l'instance (`C:\ProgramData\SZH-dev` par défaut) : utile pour faire tourner deux
instances de dev en parallèle, ou pour un banc de test qui veut une arborescence
jetable. `-Simuler` ne touche rien : il calcule le plan complet — jonctions,
fichiers, variables, raccourci — et l'écrit en JSON sur la sortie standard ; c'est
ce que le harnais de tests utilise pour éprouver le script sans jamais écrire sur
le disque. `-Menu <dossier>` détourne l'endroit où le raccourci « Pronto (dev) »
est posé ; vide ou absent, c'est le vrai menu Démarrer du compte. Tout argument
restant est transmis tel quel à `windows/open-revue.ps1` — un lien `szh://…`,
`-Produit`, `-Versions`.

---

## Ce qui est séparé de la production, et ce qui est partagé

| Élément | Sous la production | Sous l'instance de dev |
|---|---|---|
| Base | `C:\ProgramData\SZH` | `C:\ProgramData\SZH-dev` (`-BaseDev`) |
| Toolkit | copie posée par `update.ps1` | jonction vers la racine du dépôt |
| Profil et extensions VSCodium | `%APPDATA%\VSCodium` | `<baseDev>\codium`, via `SZH_CODIUM_PROFIL` |
| Tâches de compilation | `%APPDATA%\VSCodium\User\tasks.json` | réécrites à chaque lancement sous `<baseDev>\codium\data\User` |
| Emplacement des revues | choix du compte (`config.json`) | forcé sur `test`, jamais `production` |

`SZH_CODIUM_PROFIL` est la clé de voûte de cette séparation : lue par
`Start-SzhCodium` dans `windows/szh-shell.ps1`, elle devient `--user-data-dir` et
`--extensions-dir` passés à VSCodium. Sans elle, l'instance de dev ouvrirait le
profil de production tel quel, et tout ce que `pronto-dev.ps1` sème sous
`<baseDev>\codium` ne servirait jamais à rien.

Une chose n'est pas séparée, et c'est un choix assumé plutôt qu'un oubli : la
distribution WSL `SZH-Publishing`. L'instance de dev compile dans la même distro
que la production, avec le même Pandoc et le même WeasyPrint. Un second rootfs
dédié au développement coûterait environ 3 Go de disque pour un cas qui reste rare
— faire tourner en parallèle une compilation de dev et une compilation de
production sur le même poste.

---

## Ce que ça ne remplace pas

L'instance de développement n'exerce jamais `bootstrap.ps1`, `update.ps1`, la
construction des VSIX, les tâches planifiées de mise à jour, ni le gestionnaire de
protocole `szh://`. Ce dernier point a une conséquence concrète : un lien `szh://…`
cliqué dans un e-mail pendant une session de dev ouvre l'instance de **production**,
parce que l'association de protocole est une clé de registre du compte, posée par
`update.ps1`, et que rien dans `pronto-dev.ps1` n'y touche. Valider qu'un
déploiement fonctionne — l'auto-update, un raccourci posé par `update.ps1`, le
comportement d'un lien `szh://` — demande toujours une release réelle et un poste
qui la reçoit ; l'instance de dev ne se prononce pas là-dessus.

---

## Pourquoi une jonction vers la racine du dépôt suffit

Le toolkit livré aux postes n'est pas un artefact séparé : `.github/workflows/release.yml`
le construit par `cp -r pipeline vscodium-user revue-template livre-template windows toolkit/`,
puis zippe ce dossier tel quel. Le dépôt, à sa racine, contient donc déjà
tout ce qu'un toolkit installé contient — à l'exception du fichier `VERSION`, que la
release écrit après coup et que `pronto-dev.ps1` recrée à sa manière (voir plus bas).
Une jonction `<baseDev>\toolkit` → racine du dépôt donne donc un toolkit valide sans
rien copier, et une modification du dépôt s'y reflète sans reconstruire quoi que ce
soit.

Le script pose trois jonctions de ce genre : `<baseDev>\toolkit` vers la racine,
`<baseDev>\codium\extensions\szh-cockpit` vers `vscodium-extension\szh-cockpit`, et de
même pour `szh-apercu`. Si l'une d'elles existe déjà comme un vrai dossier — pas une
jonction —, le script refuse bruyamment plutôt que d'écraser un contenu réel.

---

## Les pièges

### `SZH_CONFIG` dans `tasks.json`

`pipeline/filters/szh-citations.lua` lit le chemin des configurations en dur,
`/mnt/c/ProgramData/SZH/config.json` — c'est le fichier qui porte, entre autres, le
titre de la bibliographie à composer. `wsl.exe` ne transmet pas l'environnement de
Windows à la distribution sans passer par `WSLENV`, une variable que le cockpit ne
pose pas ; il n'y a donc aucun moyen de faire lire un autre fichier au filtre par une
simple variable d'environnement Windows. `pronto-dev.ps1` réécrit à la place chaque
commande `bash -c` de `tasks.json` pour lui préfixer `SZH_CONFIG=<chemin WSL du
config.json de dev> `, que le filtre relit via `os.getenv('SZH_CONFIG')` avant de
retomber sur son chemin en dur. Sans ce préfixe, une compilation lancée depuis
l'instance de dev lirait silencieusement les titres de bibliographie de la
production — le commentaire en tête de `szh-citations.lua` détaille ce choix.

### Jamais de `setx`

Les quatre variables que le script pose (`SZH_BASE`, `SZH_TOOLKIT`,
`SZH_COCKPIT_DOSSIER`, `SZH_CODIUM_PROFIL`) ne valent que pour le processus
PowerShell lancé, jamais pour le compte ni pour la machine. Une variable qui
fuiterait au niveau utilisateur ou machine ferait tourner le VSCodium de production
sur la configuration de développement, en silence — jusqu'à ce que quelqu'un se
demande pourquoi une compilation de production a lu `test` comme emplacement des
revues.

### Le fichier `VERSION`

`pronto-dev.ps1` écrit à la racine du dépôt un fichier `VERSION` gitignoré, de la
forme `0.0.0-dev+<sha court>`. Sans lui, `Get-SzhVersionInstallee`
(`windows/szh-common.ps1`) ne trouverait rien à afficher et un numéro compilé en dev
porterait une version vide dans ses métadonnées. Le second usage est le rapport
d'erreur du cockpit : `rapport-erreur.js` lit ce même fichier pour nommer la version
du toolkit installé, ce qui revient, en dev, à nommer le commit exact qui a produit
l'erreur.

### Le raccourci ne part jamais sur les postes de rédaction

`Set-SzhRaccourciDev`, la fonction qui pose « Pronto (dev).lnk », n'existe que dans
`outils-dev/pronto-dev.ps1` et n'est appelée que par lui. `update.ps1` ne la connaît
pas, et `Get-SzhRaccourcisMenu` (`windows/szh-shell.ps1`) reste à exactement deux
entrées — celles de la production. Un test du harnais compte ces deux entrées en
appelant directement la fonction plutôt qu'en devinant sur le disque, précisément
pour qu'une régression future ne fasse pas apparaître ce raccourci sur le poste
d'une rédactrice à la prochaine mise à jour.

### Le paramètre `-Menu`, et l'erreur qu'on a failli refaire

Sans `-Menu`, une suite de tests qui lance `pronto-dev.ps1` plusieurs fois écrirait
« Pronto (dev).lnk » dans le vrai menu Démarrer du poste qui fait tourner les tests.
Une première correction avait détourné `APPDATA` dans le harnais plutôt que d'ajouter
un paramètre au script — mais le contrôle censé mesurer que la production n'est
jamais touchée lisait alors, lui aussi, ce même `APPDATA` détourné : il devenait vrai
par construction, quel que soit le comportement réel du script. `-Menu` sépare les
deux : il détourne uniquement l'endroit où le raccourci est posé, `APPDATA` reste
celui du poste, et le test qui compare au vrai menu Démarrer redevient une mesure au
lieu d'une tautologie. C'est le genre d'erreur qu'on a une tendance naturelle à
refaire dès qu'un test gêne — la garder en mémoire ici sert à ne pas la refaire une
troisième fois.

### La barre des tâches

La fenêtre de l'instance de dev déclare le même AppUserModelID que la production,
`SZH.Publishing.Suite` (`windows/szh-shell.ps1`), parce qu'elle passe par le même
`windows/open-revue.ps1`. Les deux fenêtres se groupent donc sous le même bouton
dans la barre des tâches. C'est cosmétique et assumé : distinguer les deux
demanderait une seconde identité, pour un gain qui ne vaut pas la complication.

---

## Défaire l'instance

Retirer `C:\ProgramData\SZH-dev` (ou le dossier passé à `-BaseDev`) et l'entrée
« Pronto (dev) » du menu Démarrer suffit ; rien d'autre sur le poste n'a été touché.

Un point à connaître avant de le faire : mesuré sur ce poste, PowerShell 5.1
build 26100, `Remove-Item -Recurse -Force` sur `C:\ProgramData\SZH-dev` ne suit
**pas** la jonction `codium\extensions\szh-cockpit` — ni sur la jonction elle-même,
ni sur son dossier parent. Il retire le point de jonction, jamais la cible qu'il
désigne : le dépôt et ses extensions survivent intacts dans tous les cas, il n'y a
donc aucun risque à supprimer le dossier sans précaution particulière.

`Get-SzhRaccourcisObsoletes` (`windows/szh-shell.ps1`) nomme « Pronto (dev) » parmi
les anciens raccourcis à retirer. `windows/uninstall.ps1`, qui construit son plan de
désinstallation à partir de cette liste, retire donc ce raccourci comme n'importe
quel autre — une désinstallation complète du poste l'emporte sans geste
supplémentaire.
