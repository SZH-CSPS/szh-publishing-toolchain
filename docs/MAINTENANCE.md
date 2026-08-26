# Guide d'exploitation

Ce que le mainteneur doit surveiller pour que la chaîne continue de fonctionner, ce
qu'il faut regarder, à quelle fréquence, et quoi faire quand ça casse.

Le principe qui rend tout le reste supportable : **aucune donnée de revue ne vit dans
la chaîne**. Les articles sont sur OneDrive, le reste est du code versionné et
redéployable. Une distro cassée, un poste réinstallé, un toolkit corrompu se
réparent sans rien perdre.

---

## Le geste de contrôle universel

Avant et après toute intervention, compiler un article de test :

```powershell
wsl -d SZH-Publishing -- bash -lc "cd /mnt/c/<chemin>/szh-publishing-toolchain/test && make -f ../pipeline/Makefile out/contenu-long/contenu-long.pdf"
```

Un PDF produit sans erreur, la chaîne est saine. Le contrôle complet, qui vérifie en
plus les allers-retours du cockpit et les valeurs recopiées d'un fichier à l'autre :

```powershell
node --test "test/js/*.test.js"        # tout le harnais, aucune dépendance
python3 test/apca-check.py             # contrastes de la palette
bash test/build-render.sh              # build + capture PNG de chaque page
```

Sur un poste de rédaction, l'équivalent est : ouvrir une revue, `Ctrl+S`, voir
l'aperçu se mettre à jour.

---

## Calendrier

| Quand | Geste | Durée |
|---|---|---|
| **À chaque release** | test de fumée + les trois contrôles ci-dessus ; vérifier que `version` a bien été incrémentée dans les deux `package.json` d'extension | 15 min |
| **Avant chaque numéro** (≈ 4×/an) | compiler le numéro précédent pour confirmer que rien n'a bougé ; vérifier que les dossiers de revue sont « toujours conservés sur cet appareil » côté OneDrive | 10 min |
| **Après une mise à jour majeure de Windows** | test de fumée sur un poste ; `wsl --version` et `wsl -l -v` | 15 min |
| **Après un changement de politique antivirus ou Intune** | re-vérifier les exclusions WSL (elles ne sont pas posées automatiquement, voir § Poste) | 10 min |
| **Sur un poste installé avant août 2026** | une fois, en administrateur : `Set-SzhTacheMaj` pour passer le déclencheur de « quotidien 11 h » à « mardi 14 h ». Le rythme, lui, est déjà hebdomadaire sans ce geste (voir § Poste) | 2 min |
| **2×/an** | compacter le `.vhdx` des postes ; reconstruire le rootfs (correctifs Debian, Pandoc, WeasyPrint) et le tester avant release | ½ journée |
| **1×/an** | vérifier la fin de support de la base Debian ; relire `windows/vsix.lock` et décider des bumps ; vérifier que les huit extensions épinglées sont toujours publiées sur Open VSX | 2 h |
| **1×/an** | vérifier que la version de VSCodium des postes est toujours compatible avec le pack de langue allemand épinglé | 15 min |

---

## 1. WSL et Windows

### Le disque WSL grossit et ne se réduit jamais

**Symptôme.** Le disque du poste sature ; personne ne comprend pourquoi.
Le `ext4.vhdx` (`C:\ProgramData\SZH\WSL\*.vhdx`) croît à chaque compilation et ne se
compacte jamais tout seul.

**À observer.** La taille du `.vhdx` dans l'Explorateur ; `wsl --system df -h` pour
l'usage interne. **Deux fois par an**, ou dès que le disque du poste passe sous 15 Go.

**Manœuvre.** `wsl --shutdown`, puis compacter : `Optimize-VHD` (si Hyper-V est
présent) ou `diskpart` (`select vdisk file="…"` / `attach vdisk readonly` /
`compact vdisk` / `detach vdisk`).

### Une mise à jour du moteur WSL change le comportement

**Symptôme.** Après un Windows Update, `Ctrl+S` ne produit plus de PDF, ou la
compilation se bloque sans message. Les causes déjà vues ailleurs : montage `/mnt/c`
modifié, systemd activé ou désactivé, réseau de la VM changé.

**À observer.** `wsl --version` et `wsl --status` — noter la version qui marche, dans
ce fichier, à chaque fois qu'on la constate saine. **Après chaque mise à jour notable
de Windows**, faire le test de fumée.

**Manœuvre.** `wsl --shutdown` d'abord : il règle la majorité des blocages
transitoires (horloge décalée après veille, montage figé). Si la régression persiste,
`wsl --update --rollback`, puis geler la version le temps de corriger.

### La distro ne démarre pas

**Symptôme.** « Aucune distribution installée », ou un démarrage qui n'aboutit pas.

**À observer.** `wsl -l -v` : la distro `SZH-Publishing` doit être là, en version 2.
Sinon : la virtualisation est-elle activée dans le BIOS ? Les fonctionnalités Windows
« Plateforme de machine virtuelle » et « Sous-système Windows pour Linux » ?

**Manœuvre.** Réactiver les fonctionnalités Windows, redémarrer. En dernier recours,
relancer `windows/bootstrap.ps1` en administrateur.

### La distro est corrompue

**Symptôme.** Erreurs d'entrée-sortie, paquets cassés, compilation impossible après
une coupure brutale ou un disque plein.

**Manœuvre.** `wsl --unregister SZH-Publishing` puis réimporter le rootfs — le
mécanisme de mise à jour le refait tout seul, ou à la main :
`wsl --import SZH-Publishing C:\ProgramData\SZH\WSL <rootfs.tar.gz>`. Aucune donnée
de revue n'est dans la distro : il n'y a rien à sauver avant.

### Contraintes à ne pas oublier

- `inotify` ne traverse pas `/mnt/c` : ne jamais bâtir une fonction sur un watcher
  qui lirait `/mnt/c` depuis Linux — il ne se déclenchera pas.
- `/mnt/c` est lent, et c'est normal : les fichiers sont sur OneDrive.
- Ne jamais faire un `apt install` ou un `pip install` directement dans la distro :
  le poste diverge des autres et le rendu cesse d'être reproductible. Toute évolution
  passe par `image/` et une release. Un poste bricolé se répare en le réimportant.

---

## 2. Le rootfs et ses outils

Le rootfs est figé au moment de sa construction : deux postes produisent exactement le
même PDF. La contrepartie est que les correctifs amont ne s'appliquent pas tant qu'on
ne reconstruit pas l'image.

⚠ **Cette promesse a une condition, et elle n'est pas dans le rootfs : les polices.**
WeasyPrint ne trouve dans `pipeline/fonts/` que ce qui y est livré ; tout caractère
qu'aucune face livrée ne couvre est comblé par **fontconfig**, au moment du rendu, avec
ce qu'il trouve sur la machine. Le PDF dépend alors de la machine, et non du dépôt. Le
cas était réel et mesuré : aucune face ne portait U+25B8 (la puce de toutes les listes)
ni U+2010 (le trait d'union de chaque coupure de mot), et les PDF du banc embarquaient
DejaVu et Noto. La fine insécable de « Source : », rendue par la police de repli,
ressortait même en espace ordinaire d'un copier-coller. Les six caractères manquants ont
été ajoutés aux faces Open Sans (voir `pipeline/fonts/README.md`), et le contrôle qui
garde la promesse est **`python test/polices-check.py`** : il refuse tout PDF embarquant
une police absente de `pipeline/fonts/`. `test/build-render.sh` l'appelle. Une police
ajoutée à la maquette, ou un caractère nouveau écrit par un filtre, se signale là.

Versions actuellement épinglées, à lire dans les fichiers :

| Élément | Où | Valeur |
|---|---|---|
| Base Debian | `image/Containerfile` (`DEBIAN_TAG`) | `13-slim` |
| Pandoc | `image/Containerfile` (`PANDOC_VERSION`) | 3.5 |
| WeasyPrint et ses dépendances | `image/requirements.txt` | weasyprint 69.0, 12 pins transitifs |
| Modèles de détourage des portraits | `image/Containerfile` | deux `.onnx` vérifiés par sha256 |
| veraPDF, le validateur PDF/UA | `image/Containerfile` (`VERAPDF_VERSION`, `VERAPDF_URL`, `VERAPDF_SHA256`) | 1.30.2, installeur vérifié par sha256 |

veraPDF est un outil Java, et l'image n'embarque **pas** de JRE : une étape de build
jetable taille un runtime au `jlink` (56 Mio, sept modules — `java.desktop` et
`java.management` sont mesurés indispensables) et le rootfs n'en reçoit que le résultat.
Le JDK et `binutils` qui servent à le fabriquer, 292 Mio à eux deux, restent dans
l'étape jetable. Coût total dans le rootfs : **72 Mio**, dont 16 pour le pack CLI.
L'URL du zip est **versionnée** et non l'alias « dernière version » : le sha256 sans
l'URL versionnée ne suffit pas, l'alias suivrait le prochain amont et ferait mentir
l'empreinte.

**Tout est épinglé.** Le rootfs n'a plus de composant libre : AnyStyle, seul élément
non épinglé, a quitté l'image avec la bibliographie BibTeX — les références ne sont plus
converties, elles restent le texte de la rédaction et un filtre Lua les relie aux appels.
Deux reconstructions du rootfs à partir du même dépôt donnent donc le même rendu.

**Symptôme d'un bump raté.** Le PDF change d'aspect sans qu'aucun contenu ait bougé :
césures différentes (Pyphen), rendu de tableau modifié (WeasyPrint), titres numérotés
autrement (Pandoc).

**À observer.** Après toute reconstruction : `bash test/build-render.sh`, puis
comparer les PNG page à page avec ceux d'avant. C'est le seul contrôle qui voie une
régression de mise en page. Le même script enchaîne trois verdicts d'ensemble, et
chacun doit rester vert : la porte PDF/UA-1 du banc, le contrôle des polices
(`test/polices-check.py`) et le corpus d'accessibilité (`test/accessibilite/`, un second
dossier de numéro — sa porte PDF/UA doit rendre 0, et l'écart de numérotation voulu entre
ses deux versions linguistiques doit rester signalé).

**Quand.** Reconstruire **deux fois par an**, ou tout de suite en cas de faille de
sécurité Debian, ou quand un correctif amont dont on a besoin est publié.

**Manœuvre.** Modifier `image/Containerfile` et `image/requirements.txt`, laisser la
CI reconstruire (le rootfs n'est rebâti que si `image/` a changé ; sinon forcer par
Actions → release → *Run workflow* → case `force_rootfs`), tester sur le banc d'essai,
puis publier. Les postes récupèrent le nouveau rootfs en silence.

### Fin de support de la base Debian

**À observer.** La version dans `image/Containerfile` et le calendrier de support de
Debian (support standard environ trois ans après la sortie, puis LTS). **Une fois par
an.**

**Manœuvre.** Monter d'une version majeure dans le `Containerfile`, reconstruire,
tester. C'est l'opération lourde et rare : prévoir une demi-journée à une journée, et
la faire **entre deux numéros**, jamais pendant un bouclage.

---

## 3. VSCodium et les extensions

### Une montée de version de VSCodium casse une extension maison

**Symptôme.** La barre « Revue SZH » ne s'affiche plus, ou une commande répond par une
erreur dans la console de l'hôte d'extensions.

**Ce qui protège aujourd'hui.** Les postes sont figés : `vscodium-user/settings.json`
pose `update.mode: manual` et `extensions.autoUpdate: false`. Une montée de version
est donc toujours une décision.

**Ce qui expose.** Les deux extensions déclarent `engines.vscode: ^1.75.0`, sans borne
haute : rien n'empêche une version future de les charger et de les casser. Les points
les plus fragiles, par ordre de probabilité :

1. `document.execCommand` dans l'éditeur de tableau (`media/table-editor.js`) : c'est
   une API dépréciée de Chromium. Le gras et l'italique dans les cellules cesseront de
   fonctionner un jour, sans message d'erreur.
2. La commande interne `workbench.action.closeWindow`, appelée à la fin de
   l'archivage : si elle disparaît, le numéro est archivé mais la fenêtre ne se ferme
   pas et le déplacement du dossier échoue.
3. `vscode.tasks.fetchTasks()` doit retrouver les tâches **utilisateur** de
   `%APPDATA%\VSCodium\User\tasks.json`. C'est un comportement historiquement instable
   selon les versions ; s'il change, plus aucun build ne part.

**À observer.** Avant de faire monter le parc : installer la nouvelle version sur un
seul poste, ouvrir une revue, et faire le parcours complet — cliquer un article,
`Ctrl+S`, basculer l'aperçu, éditer un tableau, verrouiller puis déverrouiller le
numéro, archiver puis désarchiver. **À chaque montée de version, donc au plus une ou
deux fois par an.**

### Le pack de langue allemand refuse de s'installer

**Symptôme.** L'interface reste en anglais sur un poste germanophone.

**Cause.** Un pack de langue déclare `engines ^1.<minor>.0` : il exige une version de
VSCodium **au moins** égale à la sienne. `windows/vsix.lock` épingle donc `1.108.0`,
compatible avec le poste de référence en 1.109 et au-delà — la dernière version
publiée serait refusée.

**À observer.** Après toute montée de VSCodium, que le pack s'installe encore.
**Une fois par an**, ou à chaque montée.

### Une extension tierce disparaît d'Open VSX

**Symptôme.** La CI échoue au téléchargement d'un VSIX, ou une extension n'est plus
installée sur les nouveaux postes.

**Ce n'est pas théorique** : `csholmq.excel-to-markdown-table` a déjà été retirée.

**À observer.** Ouvrir les huit URL de `windows/vsix.lock` une fois par an. La CI le
fait de fait à chaque release : une release qui échoue à cette étape, c'est ce
symptôme.

**Manœuvre.** Chercher un remplaçant, ou vendoriser le `.vsix` dans le dépôt. Les cinq
`.vsix` présents dans `deploy/vsix/` ne sont référencés par aucun script : ce sont des
copies locales, pas une solution de repli — ne pas compter dessus.

### Les réglages faits par le rédacteur sont écrasés à la prochaine mise à jour

**C'est un défaut présent, pas un risque futur.** Le formulaire « Réglages » du
cockpit écrit thème, zoom, taille de police et langue dans
`%APPDATA%\VSCodium\User\settings.json` ; or `update.ps1` recopie ce fichier depuis le
toolkit à chaque mise à jour. Tout choix personnel est donc perdu à la mise à jour
suivante.

**Manœuvre.** À corriger dans `update.ps1` : fusionner au lieu de recopier, ou déplacer
les réglages du cockpit vers un fichier qui ne soit pas écrasé.

---

## 4. Le poste Windows

### Les exclusions antivirus ne sont pas posées automatiquement

**Attention** : `bootstrap.ps1` **affiche** la liste des exclusions à poser, il ne les
pose pas. Si personne ne les a saisies, l'antivirus inspecte le `.vhdx` et les
processus de la VM à chaque compilation.

**Symptôme.** Les builds prennent plusieurs dizaines de secondes au lieu de quelques
secondes ; parfois un fichier reste verrouillé.

**À observer.** Que les exclusions existent bien : `C:\ProgramData\SZH\WSL\*.vhdx`,
`C:\ProgramData\SZH\staging\*`, et les processus `vmcompute.exe`, `vmmem.exe`,
`wsl.exe`, `wslservice.exe`. **Après tout changement de politique de sécurité
centrale**, une politique Intune pouvant les réécraser.

### Le double-clic sur un `.md` n'ouvre plus la revue

**Cause probable.** Windows scelle le choix d'application par défaut dans une clé
signée : une autre installation (ou l'utilisateur) a repris l'association.

**À observer.** Que `HKCU\Software\Classes\.md\OpenWithProgids` contient toujours
`SZH.Markdown`, et que « Ouvrir avec » propose « Revue SZH ».

**Manœuvre.** Relancer `update.ps1` ; le geste « Toujours utiliser cette application »
reste à faire par l'utilisateur, une fois.

### Les liens `szh://` ne font rien depuis un e-mail

**Deux causes possibles**, toutes deux déjà rencontrées.
1. Le schéma n'est pas déclaré protocole de confiance Office : Outlook avertit puis
   n'ouvre rien. La clé est posée par `update.ps1` sous
   `HKCU\…\Trusted Protocols\All Applications\szh:`.
2. Le destinataire est sur le **nouvel** Outlook, qui ne connaît pas ce protocole. Le
   corps de l'e-mail porte pour cette raison une ligne de repli « menu Démarrer → … ».

### La mise à jour automatique : ce qui la déclenche, et ce qui la retient

La tâche planifiée **« SZH - Mise a jour »** porte deux déclencheurs, et les deux comptent :

| Déclencheur | Rôle |
|---|---|
| **hebdomadaire, mardi 14 h** | le rythme demandé : une mise à jour par semaine |
| **à l'ouverture de session** | le rattrapage, et le seul bon moment de la journée (voir plus bas) |

La cadence, elle, **n'est pas dans les déclencheurs** : elle est dans
`windows/szh-taches.ps1`, que `Test-SzhFenetreMaj` applique à chaque passage. La tâche ouvre
des occasions ; le script décide s'il en profite. Deux raisons à ce partage.

1. Le déclencheur d'ouverture de session revient **chaque matin**. Sans garde, « une fois par
   semaine » serait un vœu.
2. `bootstrap.ps1` ne tourne qu'à l'installation, et la tâche vit dans la **racine du
   planificateur**, que seul un administrateur peut réécrire — or une mise à jour ne demande
   jamais l'élévation. Mesuré : `Set-ScheduledTask` comme `Register-ScheduledTask` rendent
   *Access is denied* pour un compte non élevé, y compris membre du groupe Administrateurs
   mais sans élévation. Un poste installé avant août 2026 garderait donc son déclencheur
   quotidien de 11 h **pour toujours**. Le script, lui, est remplacé sur chaque poste à la
   mise à jour suivante, sans intervention : c'est par lui que le rythme change partout.

La conséquence à connaître : sur un poste déjà installé, le déclencheur reste quotidien
jusqu'à ce qu'un administrateur passe, mais **le rythme effectif est déjà hebdomadaire**. Le
journal le dit à chaque passage :

```
check : tâche planifiée refusee — écarts : déclencheur quotidien à retirer ; …
check : tâche planifiée non corrigée (Access is denied.) — un administrateur doit…
```

**Manœuvre**, une seule fois par poste, dans un PowerShell **en administrateur** :

```powershell
. 'C:\ProgramData\SZH\toolkit\windows\szh-common.ps1'
. 'C:\ProgramData\SZH\toolkit\windows\szh-taches.ps1'
Set-SzhTacheMaj
```

Le bilan rendu vaut `conforme` (rien à faire, rien écrit), `corrigee` (elle différait),
`creee` (elle manquait), `refusee` (pas assez de droits) ou `illisible` (le planificateur n'a
pas répondu). Une tâche déjà juste **n'est pas recréée** : la réécrire lui remettrait son
historique à zéro. Relancer `bootstrap.ps1` fait la même chose, en plus du reste.

### Les quatre états du poste : verrouillé, éteint, en veille, personne connecté

La question revient : *si l'ordinateur est éteint, en veille ou verrouillé, il n'y a pas de
mise à jour ?* Réponse état par état, avec ce sur quoi elle s'appuie.

| État du poste | Ça tourne ? | Ce qui se passe | Appui |
|---|---|---|---|
| **Verrouillé** (session ouverte, écran verrouillé) | **Oui** | Verrouiller n'est pas se déconnecter : la session reste ouverte, et c'est tout ce que la tâche exige. | `quser` rend l'état `Active` pour une session de console verrouillée ; et le planificateur traite le verrouillage comme un *changement d'état de session* (`SessionStateChangeTrigger`, états `SessionLock` / `SessionUnlock`), type de déclencheur **distinct** de l'ouverture de session — s'il fallait les confondre, ces deux types n'existeraient pas. |
| **Éteint** | Non — rien ne tourne sur un poste éteint | Mais la fenêtre manquée est **rattrapée** : `StartWhenAvailable` est posé, la tâche part à la première occasion après le retour, avec un délai par défaut de **10 minutes**. Et l'ouverture de session la rattrape de toute façon, souvent plus tôt. | XML de la tâche (`<StartWhenAvailable>true</StartWhenAvailable>`) et la documentation Microsoft de `TaskSettings.StartWhenAvailable` : « *they are started after a delay. The default delay is 10 minutes* ». |
| **En veille** | Non, et **volontairement** : la tâche ne réveille pas le poste | Elle part au réveil, par le même rattrapage. Sur le poste de référence, la veille arrive après 4 h d'inactivité sur secteur (10 min sur batterie) : un mardi de travail, le poste est éveillé à 14 h. | XML (`WakeToRun` absent, donc `false`) ; `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` mesuré : `0x3840` = 4 h sur secteur, `0x258` = 10 min sur batterie. |
| **Allumé, personne connecté** | Non | La tâche tourne dans la session d'un utilisateur connecté. Sans session, rien. Ce n'est pas un défaut : la mise à jour installe des extensions et des réglages **dans le profil** de l'utilisateur, et il n'y a pas de profil sans session. | XML : `<GroupId>S-1-5-32-545</GroupId>` (groupe Utilisateurs) sans `<LogonType>Password</LogonType>`, c'est-à-dire « exécuter seulement si l'utilisateur est connecté ». |

**Le cinquième état, celui qu'on n'avait pas vu : sur batterie.**
`DisallowStartIfOnBatteries` vaut `true` par défaut, et il l'était sur la tâche installée. Un
portable jamais branché ne se mettait donc **jamais** à jour — ni le mardi, ni à l'ouverture
de session. Le passage du quotidien à l'hebdomadaire aurait aggravé le cas, de sept occasions
par semaine à une. `New-SzhTacheMajReglages` pose désormais `-AllowStartIfOnBatteries` ;
`-DontStopIfGoingOnBatteries` reste, donc une mise à jour commencée sur secteur n'est pas
coupée par un débranchement.

**Pourquoi pas `-WakeToRun`.** Il existe, il réveillerait le poste à 14 h, et il a été
écarté :

- il dépend du réglage « autoriser les minuteurs de réveil » du plan d'alimentation, qui
  n'est pas le même sur secteur et sur batterie — mesuré sur le poste de référence :
  `Enable` sur secteur, `Disable` sur batterie. Une stratégie centrale peut le désactiver
  partout, et la tâche paraîtrait alors réglée sans jamais réveiller personne ;
- il se comporte autrement sur les machines à veille moderne (S0 Low Power Idle) que sur les
  machines à veille S3 ;
- réveiller un poste à 14 h pour télécharger **574 Mo** d'image WSL est intrusif, et le
  rédacteur n'a rien demandé ;
- surtout il est **inutile** : `StartWhenAvailable` rattrape la fenêtre manquée, et
  l'ouverture de session la rattrape encore mieux — c'est même le seul moment de la journée
  où l'éditeur n'est pas ouvert.

Un réveil serait la bonne réponse s'il fallait absolument que la mise à jour tombe à une
heure précise. Ce n'est pas le cas : ce qui compte est qu'elle tombe une fois par semaine.

### La mise à jour silencieuse renonce, et repasse plus tard

14 h tombe en pleine après-midi de travail, et une mise à jour peut remplacer l'**image WSL**
— 574 Mo à la dernière release. L'installation doit alors désenregistrer la distribution, ce
qu'elle ne peut pas faire pendant qu'une compilation s'en sert : c'est exactement ce que dit
`err.wsl`, qui demande de fermer l'éditeur.

`update-launcher.ps1` mesure donc le moment, mais **seulement quand l'environnement de
fabrication change** : un toolkit, des extensions et des réglages s'installent très bien sous
l'éditeur ouvert, et renoncer là retarderait des corrections pour rien.

| Ce qui est mesuré | Comment | Conséquence |
|---|---|---|
| Une compilation en vol | un client `wsl.exe` dont la ligne de commande porte le `Makefile` de la chaîne — la forme que prend `Ctrl+S`, voir `vscodium-user/tasks.json` — **et** les processus lus dans `/proc` à l'intérieur de la distro : l'image n'embarque pas `procps`, donc ni `ps` ni `pgrep` | **Renoncement sans appel** : la couper détruit du travail |
| L'éditeur est ouvert | un processus `VSCodium` | Renoncement, réversible (voir le délai de politesse) |
| La distribution tourne | `wsl -l --running -q`, qui rend des noms de distributions sans la colonne d'état, laquelle est traduite selon la langue de WSL | Renoncement, réversible |

Un renoncement **ne consomme pas la fenêtre de la semaine** : le prochain déclenchement
réessaie, et l'ouverture de session du lendemain est justement un bon moment. C'est la raison
profonde de garder ce déclencheur.

Il laisse une ligne de journal, et jamais rien à l'écran :

```
check : renoncement, l'éditeur est ouvert (fois 1) -> nouvel essai au prochain déclenchement
```

plus un état dans `C:\ProgramData\SZH\maj-auto.json` (`derniereVerif`, `bloqueDepuis`,
`bloqueFois`, `bloqueRaison`, `alerteLe`). Fichier séparé de `state.json`, que `update.ps1`
réécrit entièrement à chaque succès et qui effacerait la cadence.

**Et si ça dure ?** Un poste qui ne se met plus à jour depuis six semaines ne doit pas
l'apprendre par un journal que personne ne lit. Au bout de **28 jours** de blocage
(`$SzhMajPolitesse`) — quatre fenêtres hebdomadaires et une vingtaine d'ouvertures de session
gâchées : ce n'est plus un mauvais moment, c'est un blocage —, la passe cesse d'être polie :

- les gênes réversibles cèdent : elle installe même sous l'éditeur ouvert, et si cela échoue,
  la fenêtre visible affiche `err.wsl`, qui dit quoi fermer ;
- une compilation en vol, elle, ne cède jamais ;
- si c'est le contrôle lui-même qui échoue (réseau, empreinte), la **fenêtre visible est
  ouverte quand même**, pour que l'échec se voie : c'est elle qui parlera, avec le journal et
  l'e-mail au support à portée de clic. La passe silencieuse, elle, reste muette ;
- une alerte visible par semaine au plus (`alerteLe`), sinon la passe muette deviendrait la
  plus bavarde de la chaîne.

**À observer.** `C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log` et
`C:\ProgramData\SZH\maj-auto.json` : un `bloqueFois` à deux chiffres avec un
`bloqueDepuis` ancien est un poste qui décroche. **Avant chaque numéro**, la barre d'état du
cockpit, qui compare la version du toolkit à celle qui a créé le numéro, suffit.

### L'e-mail de traduction ne part pas

**Cause.** Le brouillon passe par `mailto:`, donc par le client de messagerie déclaré
par défaut dans Windows. S'il ne s'ouvre pas, c'est ce réglage-là qu'il faut regarder,
pas le toolkit. Le lien de traduction est de toute façon copié dans le presse-papiers :
un collage dans un message écrit à la main donne le même résultat.

**À observer.** Rarement. L'ancienne voie par automatisation COM d'Outlook, qui seule
donnait un lien cliquable, a été retirée le 23.08.2026 : elle ne fonctionnait pas avec
le nouveau client Outlook.

---

## 5. GitHub et la livraison

### Une release passe mais n'arrive jamais sur les postes

**C'est le piège le plus silencieux de toute la chaîne.** `update.ps1` compare la
version **déclarée dans le `package.json`** de chaque extension à celle qui est
installée. Si le code d'une extension change sans que sa `version` soit incrémentée,
le VSIX est bien reconstruit et publié, mais **jamais réinstallé**.

**À observer.** À chaque release : que `vscodium-extension/szh-cockpit/package.json` et
`szh-apercu/package.json` portent une version supérieure à celle de la release
précédente. Rien ne le vérifie automatiquement aujourd'hui — c'est le premier contrôle
à automatiser.

### Un raccourci du menu Démarrer ne se pose pas

**Symptôme.** Une entrée manque au menu Démarrer d'un poste — le plus souvent
« Mise à jour de l'outil Revue » — alors que la mise à jour s'est terminée sans erreur.

**À observer.** `C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log` : chaque entrée non posée y
laisse une ligne `raccourci du menu Démarrer non posé -> …`, et une ligne d'ensemble quand
le dossier entier se refuse. Puis le dossier lui-même,
`%APPDATA%\Microsoft\Windows\Start Menu\Programs` : est-il inscriptible pour cet
utilisateur ?

**Pourquoi ce n'est jamais fatal.** Même posture que la ruche de classes : un menu Démarrer
tenu par une stratégie de groupe ne doit pas faire échouer une mise à jour par ailleurs
réussie. La mise à jour reste atteignable par le bouton *Changer de version…* du lanceur et
par la tâche planifiée qui la déclenche.

**Manœuvre.** Rien, d'ordinaire : `update-launcher.ps1` repose les quatre entrées à chaque
ouverture de session, avant même de regarder s'il y a du neuf. Si la stratégie de groupe est
définitive, il faut passer par le menu « Tous les utilisateurs »
(`%ProgramData%\Microsoft\Windows\Start Menu\Programs`) — à faire déployer par
l'informatique, et **pas** depuis ces scripts : les deux menus se superposent, et l'entrée
apparaîtrait deux fois sur les postes qui ont déjà la sienne.

**Attention.** Le sous-dossier `SZH\` du menu Démarrer (`SZH Updater`, `SZH AppLauncher`)
appartient à l'AppLauncher interne, pas à cette chaîne. Le nettoyage des anciens raccourcis
ne parcourt que le premier niveau du menu, exprès.

### Un fichier supprimé du dépôt reste sur les postes déjà déployés

`update.ps1` extrait le toolkit par `Expand-Archive -Force` : il écrase ce qui a changé,
mais **ne supprime jamais** ce qui a disparu du zip. Un filtre Lua, un script ou un
dossier retiré du dépôt continue donc de vivre dans
`C:\ProgramData\SZH\toolkit\` sur tous les postes existants — inoffensif tant que rien ne
l'appelle, trompeur pour qui inspecte un poste.

**À observer.** Après une release qui supprime des fichiers, comparer le contenu de
`C:\ProgramData\SZH\toolkit\pipeline` à celui du dépôt sur un poste.

**Manœuvre.** Les retirer à la main, ou ne rien faire : ils ne coûtent que de la place.
Le nettoyage complet passe par une réinstallation du toolkit.

### Deux workflows, et ils ne gardent pas la même porte

`release.yml` ne se déclenche que sur un tag `v*` : il **publie**. `ci.yml` se
déclenche à chaque push sur `main` et à chaque pull request : il **vérifie** — contrats
du cockpit (`node --test test/js/*.test.js`), banc `test/` recompilé de zéro, puis
`make verifier-ua`. Une porte qui ne se ferme qu'au moment de publier se ferme trop
tard, d'où le second.

`ci.yml` installe lui-même pandoc 3.5, WeasyPrint depuis `image/requirements.txt` et
veraPDF 1.30.2, tous épinglés et vérifiés par sha256 — sans quoi son verdict ne serait
pas celui de la flotte. Il n'installe pas `requirements-portraits.txt` : la chaîne PDF
ne s'en sert pas. `test/out/` n'étant pas versionné, tout est recompilé, rien n'est
repris d'un artefact.

**À observer.** Un rouge de `ci.yml` sur un commit qui ne touche ni le pipeline ni le
banc : c'est le signe d'un outil tiré du réseau qui a bougé, pas d'une régression.

### La CI se casse sans qu'une ligne du dépôt ait changé

**Cause.** Les outils tirés du réseau au moment du build. `vsce` est désormais borné à
sa version majeure, mais reste résolu à chaud ; l'image des runners GitHub change ; le
registre npm et Open VSX sont des services tiers.

**À observer.** Le résultat de chaque release. **Manœuvre** : figer la version exacte
qui marchait dans `.github/workflows/release.yml`.

### Le dépôt redevient privé, ou l'API GitHub limite les appels

**Symptôme.** Les postes ne se mettent plus à jour, avec une erreur de téléchargement.

**Rappel.** L'auto-update sans jeton exige un dépôt public. La racine de confiance de
tout le système est **le droit de publier une release** : c'est le contrôle de
sécurité le plus important, à garder restreint et protégé par une double
authentification.

---

## 6. OneDrive et les données

### Un dossier de revue n'est pas téléchargé localement

**Symptôme.** La compilation échoue ou reste bloquée : WSL lit des fichiers fantômes à
travers `/mnt/c`.

**À observer.** L'icône OneDrive du dossier de revue doit être un rond vert plein, pas
un nuage. **Avant chaque numéro**, et sur tout poste nouvellement configuré.

**Manœuvre.** Clic droit → « Toujours conserver sur cet appareil », attendre la fin de
la synchronisation avant de compiler.

### Un fichier reste verrouillé pendant l'export

**Cause.** Un PDF ouvert dans un lecteur est verrouillé côté Windows ; le cockpit
ferme donc les onglets d'aperçu avant tout `clean` ou toute suppression. Un PDF ouvert
**hors** de l'éditeur (SumatraPDF, Acrobat) échappe à cette précaution.

**Manœuvre.** Fermer le lecteur externe et relancer « Tout exporter ».

### Deux personnes ouvrent le même numéro

Rien ne l'empêche. OneDrive crée alors un fichier en conflit
(`ausgabe-<machine>.yaml`) que la chaîne ignore, et les modifications de l'un écrasent
celles de l'autre. **La règle de travail reste : un numéro, une personne à la fois.**

### Le lanceur n'affiche plus aucune revue

**Cause la plus probable.** L'interrupteur `emplacementRevues` de
`C:\ProgramData\SZH\config.json` a changé de côté. Il déplace la racine où le lanceur
cherche les numéros, sans déplacer un seul fichier : les revues sont toujours là, le
lanceur regarde ailleurs.

**À observer.** Le **titre de la fenêtre du lanceur** nomme la racine active —
`Revues SZH — dossier de test (Revues-TESTING)` ou
`… — dossier de production (2_Produkte)`. Le journal du mois porte la même chose :
`revues : emplacement "…" -> <chemin>`.

**Manœuvre.** [`docs/EMPLACEMENTS.md`](EMPLACEMENTS.md) §8 — la cartographie complète des
deux racines, ce que chacune contient, et la reprise pas à pas.

---

## 7. Le contenu

### Un Word ne se convertit plus

**Symptôme.** Le fichier reste dans `articles-word/` et le panneau signale un échec.

**À observer.** Le journal de la tâche d'import dans le terminal de l'éditeur. Les
causes déjà vues : un `.doc` ancien (non pris en charge, seuls `.docx` et `.odt` le
sont), un fichier encore ouvert dans Word, un document dont les styles ne portent
aucun nom reconnu.

**Manœuvre.** Réenregistrer le document en `.docx` depuis Word, ou appliquer les
styles attendus. Le corpus de mise au point est dans `tmp/docx-dev/` (hors dépôt) :
c'est là qu'on rejoue un cas qui échoue.

### La fiche n'a que les noms : ni fonction, ni e-mail, ni portrait

**Symptôme.** Après l'import, « Métadonnées des articles » montre les autrices et auteurs
avec leur seul prénom et nom, le tableau du Word s'imprime tel quel en fin d'article au
lieu d'être composé en bloc auteurs, et `portraits/` est vide. La ligne
`[import-meta]` du journal le dit en un mot : `"source": "byline"`.

**Le mécanisme.** `docx-meta.py` lit d'abord le tableau de fin du Word — une cellule par
personne, nom, fonction, affiliation, e-mail, portrait. Le jugement est **strict** : une
seule cellule qu'il ne sait pas lire et le tableau entier reste dans le corps, la fiche se
rabattant sur la ligne d'auteurs sous le titre, qui ne porte que des noms. C'est voulu —
un encadré de contenu en fin d'article ne doit pas se faire prendre pour un bloc auteurs —
mais le prix d'une cellule illisible est élevé.

**À observer.** Le code `tableau-auteurs-non-lu` du journal d'import. Il ne se lève que
lorsqu'un tableau refusé en fin de document porte un **e-mail** : c'est ce signal qui
distingue un bloc auteurs qu'on n'a pas su lire d'un encadré qu'on a eu raison de laisser.
Sans ce code, le repli était muet — il a laissé passer dix-sept articles du corpus.

**Causes déjà vues, et ce que la chaîne sait désormais lire.** Un titre académique inconnu
en tête de cellule (« Prof. ém. Dre », « Dr. theol. », « Dipl.-Psych. », « Dr.in »,
« Univ.-Prof. em. Dr. Dr. et Prof. h. c. ») ; une première ligne qui ne porte que des
titres, le nom étant à la ligne suivante ; un crédit de photo posé dans la cellule du
portrait (« © Franca Pedrazetti ») ; un encadré de contenu placé **après** le bloc auteurs,
qui le masquait entièrement. Ces quatre cas sont lus depuis le 26.08.2026, mesurés sur les
486 Word du corpus de mise au point : 404 tableaux lus deviennent 421, sans régression.

**Reste illisible, et c'est assumé.** La notice biographique en prose libre
(« Monica Induni-Pianezzi est autrice et formatrice, ainsi que… »). Le schéma d'auteur n'a
pas de champ pour une biographie ; le tableau reste donc dans le corps et s'imprime, ce
qui est le bon comportement. Huit articles du corpus sont dans ce cas.

**Manœuvre.** Compléter la fiche à la main dans « Métadonnées des articles » — c'est le
plus court quand l'article est déjà importé. Ou remettre chaque personne dans sa propre
cellule du Word (nom, puis fonction, puis e-mail), puis *Réimporter cet article*.

**Voisin.** Le code `credit-photo-non-repris` : le tableau des auteurs portait un crédit de
photo, il part avec le tableau et ne s'imprimera plus, le schéma n'ayant pas de champ pour
lui. Le message cite le crédit mot pour mot, à reporter où il doit paraître.

### Le portrait d'un auteur n'a pas de texte alternatif, et n'est pas dans le Word

**Ce n'est pas un défaut, c'est une décision** du 24.08.2026. Le portrait est une image
décorative : le nom de la personne est écrit juste à côté, dans le bloc « À propos des
auteur·e·s ». Un texte alternatif qui répète ce nom est du bruit ; un qui se trompe — photo
appariée à la mauvaise personne, logo, photo de groupe — affirme une identité fausse à un
lecteur d'écran.

**Pourquoi ce n'est pas un `<img>`.** WeasyPrint 69 balise **tout** `<img>` en `/Figure`,
même avec `role="presentation"`, même avec `aria-hidden="true"` — mesuré par cas minimal. Et
une `/Figure` sans `/Alt` viole PDF/UA-1 §7.3, donc la porte `verifier-ua` la refuserait. Le
portrait est donc un `<span>` vide à fond CSS, dont l'URL passe par un `<style>` du `<head>`
du gabarit : c'est le seul endroit où `--embed-resources` réécrit les `url()`, et le seul où
les règles ne réapparaissent pas en texte clair dans le galley DOCX.

Mesuré : les `/Figure` de portrait passent de 4 à 0 sur un article à quatre auteur·e·s, les
images restent dans le PDF (le compte d'objets image ne bouge pas), et le rendu est
identique **au pixel** sur quinze pages.

**Conséquence connue.** Le portrait n'existe pas dans le galley DOCX : un fond CSS ne
traverse pas le writer docx de pandoc, qui lit le HTML sans son CSS. Le galley Word passe de
724 Ko à 28 Ko sur un article à quatre portraits. Le texte du bloc auteurs est intact. Si
OJS doit recevoir les portraits en Word, il faudra un second passage qui les réinjecte côté
docx — le HTML devant rester sans `<img>`.

### Un appel de citation n'est pas lié à sa référence

**Symptôme.** Le journal de compilation porte une ligne
`[citations-avertissement] appel-sans-reference | article « 01-inclusion » | appel « (Shaw et al., 2023) » | …`,
ou le même avec le code `appel-ambigu`. Dans l'aperçu du cockpit, l'appel est souligné en
pointillé. Le deuxième champ est le code stable, et c'est lui qu'on cherche : les phrases
qui suivent (française, puis allemande après `[de]`) ne sont qu'un repli d'affichage et
peuvent être reformulées.

**Causes.** Le nom de l'appel ne correspond à aucune entrée de la liste — coquille dans le
texte, référence absente de la liste, parenthèse déséquilibrée dans le Word — ou deux
références partagent le même premier auteur et la même année, et l'appel ne dit pas
laquelle.

**Manœuvre.** Curseur dans l'appel, `Ctrl+Alt+S`, « Lier un appel à une référence », choisir
l'entrée. Le `.md` reçoit un lien markdown que la compilation respecte ensuite. Le code
`reference-orpheline` signale l'inverse : une entrée que le texte ne cite pas, à vérifier
côté rédaction.

**Symptôme voisin.** Le code `ancrage-inconnu` : le texte de la référence a changé depuis la
pose du lien, donc son identifiant aussi. Refaire l'opération.

### « Lier un appel à une référence » refuse de s'ouvrir

**Cause.** Depuis le 23.08.2026, le cockpit ne calcule plus lui-même les identifiants
d'ancrage : il lit la table de repli dans `pipeline/filters/szh-citations.lua` du toolkit
installé, pour que les deux moitiés ne puissent plus diverger. Si le toolkit et le cockpit
ne sont pas de la même version, la table n'a pas la forme attendue et la commande refuse
plutôt que de proposer des ancres que la compilation ne posera pas.

**À observer dans le journal de l'hôte :**
`[citations] table REPLI_BLOCS absente de <chemin> : format de filtre incompatible avec ce cockpit.`
`[citations] REPLI_BLOCS de <chemin> ne porte que N jetons sur 656 attendus.`

**Manœuvre.** Lancer la mise à jour du toolkit, ou choisir une version cohérente par le
bouton que la notification propose. Le rédacteur, lui, ne voit qu'une phrase : les deux
moitiés du logiciel ne sont pas de la même version, et la mise à jour règle le cas.

**Symptôme voisin.** Le code `caractere-sans-repli` : un nom d'auteur porte une
lettre dont l'identifiant d'ancrage ne sait rien faire, et qui est donc retirée. Le repli
couvre tout le latin, diacritiques et lettres barrées comprises ; le grec, le cyrillique et
l'arabe, non. Un auteur nommé en cyrillique donne un identifiant vide, d'où un lien qui ne
tient pas. Manœuvre : lier l'appel à la main, ou translittérer le nom dans la liste de
références. Une ligne par caractère, pas par occurrence.

### La bibliographie d'un article ne se comporte pas comme prévu

**Le mécanisme, en une phrase.** Depuis le 24.08.2026 la bibliographie est une donnée, comme
un tableau : `docx-meta.py` lit son étendue dans les **styles** du `.docx`,
`szh-biblio-detacher.lua` l'écrit dans `articles/<slug>/<slug>.biblio.md` — les références
seules, sans titre — et laisse une référence `::: {.szh-biblio src=…}` à sa place dans le
corps. La compilation (`szh-citations.lua`) résout la référence, pose le titre dans la langue
de l'article et ancre chaque entrée. Trois pannes propres en découlent, et un code stable
chacune.

**1. La bibliographie n'est pas détectée : la liste reste dans le corps.**
Codes `biblio-non-detachee` (à l'import) et `biblio-dans-le-corps` (à chaque compilation).
L'article est **entier** — rien n'est perdu, la liste est simplement dans le texte, et
l'export vers la plateforme partira sans liste de références. Cause : les références ne
portent pas le style de bibliographie dans le Word ; le document annonce sa liste par un
titre seul. Le style est le seul signal fiable, mesuré sur les 421 galleys publiés — un
découpage deviné dans le corps se trompait sur les entrées à cheval sur deux paragraphes.
**Manœuvre :** appliquer le style de bibliographie aux références dans le Word, puis
*Réimporter cet article*.

**2. Un encadré rouge « Bibliographie introuvable » à la place de la liste.**
Code `biblio-introuvable`. Le corps porte encore sa référence, et le fichier
`<slug>.biblio.md` a été supprimé ou renommé — l'encadré rouge est le même que celui d'un
tableau introuvable, règle `.szh-tabelle-manquante, .szh-biblio-manquante` de `print.css`.
**Manœuvre :** *Réimporter cet article*, ou retirer le bloc `::: {.szh-biblio …}` du texte
si l'article ne doit plus avoir de liste.

**3. Des références restent hors de la liste.** Codes `biblio-references-restees` (des
paragraphes suivent la liste sans porter son style) et `biblio-incomplete` (des paragraphes
de l'étendue n'ont pas suivi). Elles restent dans le texte, juste après la liste : rien n'est
perdu, mais elles ne seront ni ancrées ni exportées comme des entrées. **Manœuvre :** leur
donner le style de bibliographie dans le Word, puis réimporter. Sur le corpus des 421
galleys, un seul article était concerné, et c'était un intertitre promu en titre.

**4. Une référence ajoutée à la main a disparu après un réimport.** L'arborescence du cockpit
ouvre `<slug>.biblio.md` d'un clic, ce fichier se corrige donc ici aussi — et le réimport
l'arbitre comme un tableau, sur les empreintes de `.szh-import.empreintes` : le Word livre
les mêmes références qu'à l'import → la version d'ici est **gardée** ; le Word en livre
d'autres et personne n'avait touché → il **remplace** ; les deux ont bougé → le Word gagne,
parce que le texte corrigé cite ses références, et le conflit est **nommé** (`biblio-conflit`)
avec le chemin de la version d'avant, sous `.szh-avant-reimport/`. Deux voisins : `biblio-retiree`
(ce Word ne détache plus de bibliographie, le fichier s'en va avec) et `biblio-origine-inconnue`
(article importé avant que la chaîne ne note cette empreinte — toute différence est alors
signalée par prudence). **Manœuvre :** ouvrir la version d'avant que le message nomme et
recopier ce qui doit revenir ; ou *Annuler le réimport*, qui remet l'article entier.

**À observer.** Après un import, les codes `biblio-non-detachee` et `biblio-dans-le-corps` du
journal : ils disent qu'un article n'a pas de `<slug>.biblio.md` alors qu'il a bien une liste
de références. Le PDF, lui, ne montre rien — c'est l'export vers la plateforme qui partirait
sans liste.

### Le PDF n'est plus balisé PDF/UA

**Symptôme.** Le message « PDF/UA-1 indisponible → PDF balisé simple » apparaît dans
le journal de compilation. L'accessibilité du PDF est dégradée, mais le build réussit —
c'est délibéré : le balisage ne doit jamais faire échouer une publication.

**À observer.** Ce message, après toute montée de WeasyPrint. **À chaque
reconstruction du rootfs.**

**Manœuvre.** Relancer WeasyPrint à la main sur le HTML produit, sans rediriger la
sortie d'erreur, pour voir la vraie cause.

### La porte PDF/UA refuse l'export

**Où elle est.** `make verifier-ua`, appelée par `docx` et `tout-exporter`, jamais par
`all` ni `pdf` : le rédacteur doit pouvoir sortir l'épreuve d'un article encore
imparfait. Elle garde ce qui part chez l'imprimeur et dans OJS, là où la conformité est
une promesse publique.

**Comment lire le verdict.** `pipeline/rapport-ua.py` traduit le XML de veraPDF en
français puis en allemand : une ligne par règle, avec ce qui est en cause et le geste de
correction. Trois codes de sortie, et ils ne disent pas la même chose : **0** conforme,
**1** non conforme, **2 panne d'outillage**. Cette troisième valeur est le cœur du
dispositif : un validateur absent, un runtime Java cassé, un PDF illisible ne doivent
jamais se lire comme un succès.

**Le piège du runtime, qui a failli passer inaperçu.** Un `JAVA_HOME` qui ne pointe sur
rien fait sortir le lanceur veraPDF en code **1** — le code réservé au « PDF non
conforme ». La porte accuserait alors des PDF parfaits, et le message serait
parfaitement crédible. D'où deux garde-fous : `$VERAPDF_JAVA/bin/java` est vérifié avant
l'appel, et dès que le rapport est inexploitable la sortie d'erreur du validateur est
recrachée telle quelle — seul endroit où la vraie cause se lit.

**Chemins.** `VERAPDF` (défaut `/opt/verapdf-cli/verapdf`) et `VERAPDF_JAVA` (défaut
`/opt/jre-min`), surchargeables depuis l'environnement : c'est ainsi que `ci.yml` les
fait pointer sur son installation à lui.

**À observer.** Que les cinq cas se comportent encore comme prévu après toute montée de
veraPDF ou du runtime : témoin conforme, validateur absent, runtime cassé, PDF tronqué,
PDF non conforme. **À chaque reconstruction du rootfs.**

### Un passage en langue seconde n'est pas annoncé comme tel

**Non-conformité connue, et elle passe la porte.** Un article français porte un
`Zusammenfassung` allemand ; le gabarit pose bien `<div class="szh-abstract" lang="de">`,
et le PDF n'en garde rien. Mesuré sur `test/out/figures/figures.pdf` : `/Lang` du
document = `fr`, et **aucun** élément de l'arbre de structure ne porte de `/Lang`. Un
lecteur d'écran lira donc le résumé allemand avec une voix française.

**Cause, en amont.** WeasyPrint 69 n'écrit `/Lang` qu'à un seul endroit, le catalogue du
document (`weasyprint/pdf/__init__.py`) ; `weasyprint/pdf/tags.py`, qui construit les
éléments de structure, n'en pose aucun. Trois occurrences de `Lang` dans tout le paquet,
toutes sur le catalogue. **Rien côté HTML ne peut donc corriger ce défaut** : l'attribut
`lang` est simplement perdu.

**Pourquoi veraPDF passe quand même.** Sa règle de clause 7.2 sur le texte du contenu de
page se lit `gContainsCatalogLang == true || Lang != null` : un `/Lang` dans le catalogue
la satisfait, où que la langue change ensuite. Aucune machine ne sait deviner qu'un
paragraphe est allemand ; le contrôle est dégénéré par construction, et un `PASS ua1` ne
dit donc rien sur ce point. Le banc **contient** le cas — l'article `figures` est en `fr`
avec un résumé `de` — et rend `PASS`.

**À observer.** Cette limite à chaque montée de WeasyPrint :
`grep -rn Lang /opt/weasyprint/lib/python3*/site-packages/weasyprint/pdf/`. Le jour où
une quatrième occurrence apparaît sur un élément de structure, le défaut devient
corrigeable. D'ici là, ne pas l'écrire comme réglé.

### Un tableau disparaît du PDF

**Cause.** Le fichier `tables/table-NN.html` référencé par l'article a été supprimé ou
renommé. L'article affiche alors un encadré rouge « tableau introuvable » à sa place.

**Manœuvre.** Rouvrir le tableau depuis la barre « Revue SZH » et le réenregistrer, ou
retirer la référence du texte.

---

## Si tout casse : la reprise minimale

1. `wsl --shutdown`, puis test de fumée. Cela règle la plupart des blocages.
2. Toujours en échec : `wsl --unregister SZH-Publishing`, puis réimporter le dernier
   rootfs.
3. Toujours en échec : relancer `windows/bootstrap.ps1` en administrateur — il
   réinstalle proprement.
4. En dernier recours : `update.ps1 -Version <X>` revient à la version précédente du
   toolkit, conservée en regard de la courante.

Aucune de ces étapes ne touche aux revues. Le contenu est sur OneDrive, il est
toujours là.
