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
node --test test/js/*.test.js          # 15 contrôles, aucune dépendance
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

### La tâche planifiée de mise à jour ne tourne plus

**Symptôme.** Un poste reste sur une vieille version ; l'écart se voit dans la barre
d'état du cockpit, qui compare la version du toolkit à celle qui a créé le numéro.

**À observer.** Le Planificateur de tâches (tâche « SZH - Mise a jour »), et le
journal de mise à jour sous `C:\ProgramData\SZH`. **Avant chaque numéro**, la barre
d'état suffit.

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
