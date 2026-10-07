# Guide d'exploitation

Ce guide s'adresse à la personne qui maintient les postes de rédaction : installer un poste,
le garder à jour, mettre à jour l'environnement Linux, dépanner, surveiller, et faire les
gestes qui reviennent chaque année. Publier une version de Pronto est décrit dans
[`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#publier-une-version).

Aucune donnée de revue ne vit dans la chaîne. Les articles, les images et les PDF sont sur
SharePoint (OneDrive) ; tout le reste est du code versionné, qu'on peut redéployer. Une
distribution WSL cassée, un toolkit abîmé ou un poste réinstallé se réparent sans rien
perdre.

Les mots propres à Pronto (toolkit, image, numéro, cockpit, Accueil…) sont définis dans le
[vocabulaire](ARCHITECTURE.md#vocabulaire).

## Sommaire

1. [En bref](#en-bref)
2. [Installer, passer en production, désinstaller](#installer-passer-en-production-désinstaller)
3. [Comment un poste se met à jour](#comment-un-poste-se-met-à-jour)
4. [Mettre à jour la WSL (l'image)](#mettre-à-jour-la-wsl-limage)
5. [Dépannage](#dépannage)
6. [Surveiller](#surveiller)
7. [Les moissonneurs](#les-moissonneurs)
8. [Gestes récurrents](#gestes-récurrents)
9. [Réglages de l'éditeur et langue de l'interface](#réglages-de-léditeur-et-langue-de-linterface)
10. [Si tout casse : la reprise minimale](#si-tout-casse--la-reprise-minimale)

---

## En bref

### Ce qui tourne où

Le schéma d'ensemble est dans [`ARCHITECTURE.md`](ARCHITECTURE.md#vue-densemble). Pour le
dépannage, il faut surtout savoir ce qui appartient au poste et ce qui appartient à chaque
compte Windows :

| Niveau | Ce qu'on y trouve |
|---|---|
| Le poste (`C:\ProgramData\SZH`) | `toolkit\` (l'outillage), `staging\` (téléchargements), `logs\`, `config.json` (réglages du poste), `state.json`, `settings-protected.json`, `WSL\<SID>\` (le disque Linux de chaque compte) ; VSCodium et SumatraPDF, installés pour toute la machine ; les tâches planifiées |
| Chaque compte | l'enregistrement de la distribution WSL `SZH-Publishing`, les extensions et réglages de VSCodium (`%APPDATA%\VSCodium\User`), `%LOCALAPPDATA%\SZH` (`etat-utilisateur.json`, `maj-auto.json`, files d'attente des rapports et compteurs), `%USERPROFILE%\.wslconfig`, les raccourcis du menu Démarrer, l'association `.md` et le protocole `szh:` |
| SharePoint | les numéros, les livres, la Documentation (`_NewsUndActu`) et `_Systeme` (rapports, inventaire, compteurs). Voir [`EMPLACEMENTS.md`](EMPLACEMENTS.md) |

Comme l'essentiel s'installe par compte, un poste peut être à jour et pourtant inutilisable
pour la personne qui s'en sert. C'est le premier point à vérifier.

### Le contrôle rapide

Avant et après toute intervention :

1. **Diagnostic du compte.** Dans la session de la personne concernée, sans élévation :

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\ProgramData\SZH\toolkit\windows\diagnostic.ps1
   ```

   Le script ne modifie rien. Il affiche, par sections (comptes, poste, ce compte, réglages
   de la rédaction, langue de l'interface, mises à jour), ce qui est en place et ce qui
   manque, avec le geste qui répare. Code de sortie 0 si tout est en place pour ce compte,
   1 sinon.

2. **Une compilation.** Ouvrir un numéro dans Pronto, ouvrir un article, `Ctrl+S`.
   L'aperçu et le PDF doivent se mettre à jour, et le badge « PDF/UA » de la barre d'état
   doit afficher un verdict.

3. **Depuis un clone du dépôt** (poste de développement), compiler l'article de test :

   ```powershell
   wsl -d SZH-Publishing -- bash -lc "cd /mnt/c/<chemin>/szh-publishing-toolchain/test && make -f ../pipeline/Makefile out/contenu-long/contenu-long.pdf"
   ```

   Un PDF produit sans erreur : la chaîne est saine.

---

## Installer, passer en production, désinstaller

### Installer un poste

Une fois par poste, en administrateur.

1. Récupérer un clone frais du dépôt (ou une archive `toolkit-<version>.zip` téléchargée
   depuis GitHub et vérifiée par son sha256). On ne lance jamais un script élevé depuis
   `C:\ProgramData\SZH\toolkit` : ce dossier est modifiable par tous les utilisateurs du
   poste, et un administrateur exécuterait aussi ce qu'un compte standard y aurait déposé.

   ```powershell
   git clone https://github.com/SZH-CSPS/szh-publishing-toolchain.git
   powershell -ExecutionPolicy Bypass -File .\szh-publishing-toolchain\windows\bootstrap.ps1
   ```

   Le double-clic sur `windows\Installer le poste SZH.cmd` fait la même chose.

2. Le script :
   - active la WSL si elle manque. Il faut alors redémarrer le poste et relancer le script ;
   - installe VSCodium et SumatraPDF pour toute la machine, dans les versions de
     `windows/apps.lock`, après vérification du sha256 et de la signature
     ([`windows/APPS.md`](../windows/APPS.md)) ;
   - donne au groupe Utilisateurs le droit de modifier `C:\ProgramData\SZH`, ce qui permet
     ensuite les mises à jour sans administrateur ;
   - pose le toolkit, les raccourcis du menu Démarrer, et deux tâches planifiées :
     `SZH - Mise a jour` et `SZH - Prechauffage WSL` (démarre la WSL à l'ouverture de
     session, pour que la première compilation soit rapide) ;
   - lance la première mise à jour, qui pose tout ce qui est par compte ;
   - affiche à la fin la liste des exclusions antivirus et la commande de diagnostic.

   Le journal est dans `C:\ProgramData\SZH\logs\bootstrap-<horodatage>.log`.

3. **Le piège de l'élévation.** Si l'élévation se fait avec un compte de support depuis la
   session d'un rédacteur, le script tourne sous le compte de support : extensions,
   réglages, raccourcis et distribution WSL iraient dans le profil du support. Le script le
   détecte, l'écrit au journal et ne lance pas la première mise à jour. Le rédacteur reçoit
   tout à sa prochaine ouverture de session, par la tâche planifiée. Pour ne pas attendre :
   dans la session du rédacteur, sans élévation, menu Démarrer → « Pronto (Updater) ».

4. **Poser les exclusions antivirus.** Le script les affiche mais ne les pose pas. Sans
   elles, l'antivirus inspecte le disque Linux à chaque compilation, qui prend alors
   plusieurs dizaines de secondes au lieu de quelques-unes :
   - dossiers : `C:\ProgramData\SZH\WSL\` (tous les sous-dossiers, `*.vhdx`) et
     `C:\ProgramData\SZH\staging\*` ;
   - processus : `vmcompute.exe`, `vmmem.exe`, `wsl.exe`, `wslservice.exe`.

5. **Vérifier les accès réseau.** Les postes doivent joindre `github.com`,
   `api.github.com` et `objects.githubusercontent.com` (mises à jour), et
   `www.sumatrapdfreader.org` (installation). La liste et les autres points à voir avec le
   prestataire informatique sont dans [`SECURITE.md`](SECURITE.md).

6. Passer le poste en production (section suivante), puis faire le
   [contrôle rapide](#le-contrôle-rapide) dans la session de chaque rédacteur.

### Passer un poste neuf du mode test à la production

`bootstrap.ps1` crée un `config.json` neuf réglé sur les dossiers de test (`devMode = $true`).
Un poste neuf cherche donc les numéros dans `%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING`.
Sur un poste de rédaction, il faut le basculer après l'installation :

1. Vérifier que la bibliothèque SharePoint `Daten_Allgemein - General` est synchronisée par
   OneDrive sur le poste : la racine de production en dépend
   (`…\Daten_Allgemein - General\2_Produkte\54_Pronto`).
2. Ouvrir Pronto, Accueil → **Paramètres** → « Mode développeur (dossiers de test) » →
   **Désactivé**. Le réglage vaut pour tout le poste. À la main, c'est la clé
   `"emplacementRevues": "production"` de `C:\ProgramData\SZH\config.json` (l'ancienne clé
   `devMode` est encore lue quand `emplacementRevues` manque).
3. Vérifier : la bannière « Mode test » de l'Accueil disparaît, les numéros de production
   s'affichent, et un numéro ouvert ne porte plus le badge « Dossier de test ». Le journal
   du mois (`C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log`) note
   `revues : emplacement "…" -> <chemin>`.

La bascule ne déplace aucun fichier. Les numéros créés en mode test restent dans
`Revues-TESTING` ; pour les garder, on les déplace à la main vers `…\54_Pronto\Revue` (ou
`Zeitschrift`). Le détail des deux racines est dans [`EMPLACEMENTS.md`](EMPLACEMENTS.md).

### Désinstaller

Avant de sortir un poste du parc ou de le réaffecter, ou pour retirer un compte qui n'utilise
plus Pronto. Comme l'installation, on lance le script depuis un clone frais, jamais depuis
`C:\ProgramData\SZH\toolkit` sous élévation.

```powershell
powershell -ExecutionPolicy Bypass -File .\szh-publishing-toolchain\windows\uninstall.ps1 -Simuler
powershell -ExecutionPolicy Bypass -File .\szh-publishing-toolchain\windows\uninstall.ps1
```

On commence toujours par `-Simuler`, qui affiche le plan sans rien toucher et sans exiger
d'administrateur. Le double-clic sur `windows\Désinstaller le poste SZH.cmd` fait la même
chose.

| Option | Effet |
|---|---|
| `-Simuler` | affiche le plan, ne touche à rien |
| `-Json` | avec `-Simuler` : le plan en JSON |
| `-ProfilSeulement` | sans administrateur : ne retire que ce qui appartient au compte courant |
| `-TousLesProfils` | retire aussi les fichiers de profil des autres comptes (pas leur registre : chacun le retire depuis sa session avec `-ProfilSeulement`) |
| `-Applications` | désinstalle aussi VSCodium et SumatraPDF |
| `-SansConfirmation` | n'attend pas que l'on tape « oui » |

Le script retire les tâches planifiées, les extensions et réglages VSCodium, les raccourcis,
les clés de registre du compte, puis le contenu de `C:\ProgramData\SZH`. Il garde toujours
la distribution WSL et son disque (`C:\ProgramData\SZH\WSL\`), `.wslconfig`,
`%APPDATA%\VSCodium\argv.json` et, bien sûr, les revues.

Code de sortie : 0 si tout s'est bien passé, 1 si des suppressions ont échoué, 2 en cas de
refus (pas administrateur, VSCodium ouvert, mise à jour en cours, lancé depuis le toolkit
sous élévation, confirmation refusée). Le journal est dans
`%TEMP%\szh-desinstallation-<horodatage>.log`.

Pour retirer aussi la distribution, chaque compte du poste lance dans sa session :

```powershell
wsl --unregister SZH-Publishing
```

---

## Comment un poste se met à jour

Une version de Pronto est publiée par GitHub Actions
([`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#publier-une-version)). Elle comprend un
`manifest.json` (versions et empreintes sha256), le toolkit (`toolkit-<version>.zip`), les
extensions VSCodium (`.vsix`) et, seulement quand `image/` a changé, l'image WSL
(`szh-publishing-rootfs-<version>.tar.gz`, environ 600 Mo).

### Le déroulement

1. **La tâche planifiée** `SZH - Mise a jour` part à chaque ouverture de session et chaque
   mardi à 14 h. Elle lance `update-launcher.ps1` sans fenêtre.
2. **La passe silencieuse** remet d'aplomb les raccourcis du menu Démarrer et la tâche
   planifiée, puis, au plus une fois par semaine (depuis le dernier mardi 14 h), lit le
   `manifest.json` de la dernière version sur GitHub. Une seule passe tourne à la fois sur
   le poste.
3. **S'il y a du neuf**, elle met d'abord le toolkit à niveau, puis lance `update.ps1` dans
   une fenêtre visible. Si le compte a choisi « En silence » (Accueil → Paramètres → « Mise à
   jour de l'outil »), la fenêtre n'apparaît pas ; les journaux sont les mêmes.
4. **`update.ps1`** fait cinq étapes. Une étape en échec n'empêche pas les suivantes.

| Étape | Ce qu'elle fait |
|---|---|
| 1/5 toolkit | télécharge l'archive, vérifie le sha256, remplace `C:\ProgramData\SZH\toolkit` d'un bloc et retire les fichiers que la nouvelle version ne contient plus |
| 2/5 image WSL | seulement si la version de l'image change, ou si la distribution manque pour ce compte : télécharge, vérifie le sha256, exige 5 Go libres, puis remplace la distribution (`--unregister`, `--import`) et vérifie qu'elle démarre |
| 3/5 extensions | installe chaque extension dont la version diffère de celle du manifest |
| 4/5 réglages | `settings.json` seulement s'il manque ; `keybindings.json` et `tasks.json` remplacés ; `settings-protected.json` ; `.wslconfig` (l'original est gardé une fois dans `.wslconfig.szh-avant`) ; association `.md` et protocole `szh:` |
| 5/5 nettoyage | garde deux images et deux toolkits dans `staging\` (pour revenir en arrière), cinq manifests, supprime les `.vsix` |

### Ce qui retient une mise à jour

Toolkit, extensions et réglages s'installent même si l'éditeur est ouvert. Remplacer
l'image WSL, non : il faut désenregistrer la distribution. Dans ce cas seulement, la mise à
jour renonce si VSCodium est ouvert ou si une compilation tourne. Elle le note au journal
(`check : renoncement, …`) et réessaie au déclenchement suivant, le plus souvent à
l'ouverture de session du lendemain, avant que l'éditeur soit ouvert.

Au bout de 28 jours de blocage, la mise à jour s'installe même sous l'éditeur ouvert (jamais
pendant une compilation) et ouvre une fenêtre visible, même en mode silencieux, au plus une
fois par semaine. L'état de ces renoncements est dans `%LOCALAPPDATA%\SZH\maj-auto.json`,
propre à chaque compte (`derniereVerif`, `bloqueDepuis`, `bloqueFois`, `bloqueRaison`,
`alerteLe`).

Selon l'état du poste :

- **verrouillé** : la mise à jour tourne, la session reste ouverte ;
- **éteint ou en veille** : rien ne tourne, et la tâche ne réveille pas le poste. Le
  rendez-vous manqué est rattrapé au retour, ou à la prochaine ouverture de session ;
- **sur batterie** : la mise à jour tourne ;
- **allumé sans personne de connecté** : rien ne tourne. La mise à jour pose des éléments
  dans le profil de l'utilisateur, il faut une session ouverte.

### Forcer une mise à jour

Dans la session de la personne, sans élévation : menu Démarrer → **« Pronto (Updater) »**.
En ligne de commande :

```powershell
powershell -ExecutionPolicy Bypass -File C:\ProgramData\SZH\toolkit\windows\update.ps1
```

Si cette mise à jour remplace `update.ps1` lui-même, la passe en cours continue avec
l'ancien script : on la relance une fois.

### Revenir à une version précédente

Accueil → onglet **Produits** → **« Changer de version… »** (le même bouton apparaît dans
l'avertissement du cockpit quand le toolkit et l'extension ne sont pas de la même version).
La fenêtre liste les versions publiées. En ligne de commande :

```powershell
powershell -ExecutionPolicy Bypass -File C:\ProgramData\SZH\toolkit\windows\update.ps1 -Version 3.10.4
```

L'opération remplace l'image et les extensions : il faut fermer VSCodium, puis le rouvrir.

### Les journaux

| Fichier | Contenu |
|---|---|
| `C:\ProgramData\SZH\logs\update-<AAAAMMJJ-HHmmss>.log` | transcription complète de chaque mise à jour ; les dix dernières sont gardées |
| `C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log` | journal du mois : passes silencieuses, renoncements, raccourcis, emplacement actif ; trois mois gardés |
| `C:\ProgramData\SZH\logs\bootstrap-<horodatage>.log` | installation |

L'onglet **Log** de l'Accueil liste les dix dernières mises à jour avec leur date et leur
issue (réussie, échouée, inconnue). Son bouton « Signaler un problème… » enregistre un
rapport avec le journal affiché, puis ouvre le dossier des journaux et un brouillon de
courriel au support.

---

## Mettre à jour la WSL (l'image)

L'image WSL ne se met jamais à jour sur un poste. On la reconstruit à partir de `image/`, on
la teste, on la publie dans une version, et chaque poste la réimporte à sa mise à jour
suivante. Chaque construction prend les correctifs Debian du jour (`apt-get upgrade`), alors
que les outils qui décident du rendu restent épinglés.

Rien ne déclenche cette reconstruction automatiquement : c'est un geste humain. On la fait
au moins deux fois par an, tout de suite en cas de faille de sécurité dans Debian ou Pillow,
et quand on a besoin d'un correctif d'un outil. On la fait entre deux numéros, jamais pendant
un bouclage.

### Où sont épinglées les versions

| Élément | Fichier | Version actuelle |
|---|---|---|
| Base Debian | `image/Containerfile`, `DEBIAN_TAG` | `13-slim` |
| pandoc | `image/Containerfile`, `PANDOC_VERSION` et `PANDOC_SHA256` ; aussi `image/build-rootfs.sh` (même valeur) | 3.7.0.2 |
| WeasyPrint et ses dépendances | `image/requirements.txt` | weasyprint 70.0, pillow 12.3.0, pypdf 6.19.0 |
| Correctifs de WeasyPrint | `image/patches/weasyprint-70.0/` | 8 correctifs |
| Détourage des portraits | `image/requirements-portraits.txt` ; modèles `.onnx` dans `image/Containerfile` (sha256) | — |
| veraPDF (contrôle PDF/UA) | `image/Containerfile`, `VERAPDF_VERSION`, URL versionnée et sha256 | 1.30.2 |
| Vale (nettoyeur de manuscrit) | `image/Containerfile`, `VALE_VERSION` et sha256 | 3.22.0 |
| Profil de couleur FOGRA52 | `image/Containerfile` (sha256) | — |

pandoc reste à 3.7.0.2 : à partir de 3.8, le lecteur Word sort le contenu d'une zone de
texte avant son paragraphe d'ancrage, et beaucoup de manuscrits réels ont des zones de texte.

### Ce qu'on ne fait jamais

- **Pas d'`apt install` ni de `pip install` dans la distribution d'un poste.** Le poste
  divergerait des autres et produirait d'autres PDF. Un poste modifié à la main se réimporte.
- **Pas de mise à jour automatique dans la distribution** (`unattended-upgrades`). Pango et
  HarfBuzz mettent le texte en page : une nouvelle version change les coupures de ligne,
  donc la pagination. Appliquée à des dates différentes sur des postes différents, elle
  ferait sortir deux PDF différents du même numéro.
- **Pas d'URL « dernière version »** dans le `Containerfile` : une empreinte sha256 ne vaut
  qu'avec une URL versionnée.

### La procédure

1. **Revoir les dépendances Python.** Dans la WSL, créer un environnement propre, y
   installer les versions voulues, puis recopier le `pip freeze` dans
   `image/requirements.txt` (WeasyPrint) ou `image/requirements-portraits.txt`. La commande
   exacte est en tête de chaque fichier. C'est là que se corrigent les failles de Pillow.
2. **Monter au besoin une ligne `ARG` du `Containerfile`** (Debian, pandoc, veraPDF, Vale),
   avec la nouvelle empreinte sha256 et une URL versionnée. Pour pandoc, changer aussi
   `PANDOC_VERSION` dans `image/build-rootfs.sh`.
3. **Si WeasyPrint change de version**, rejuger les correctifs (voir plus bas).
4. **Construire l'image en local**, dans la WSL de développement (podman) :

   ```sh
   bash image/build-rootfs.sh <version>
   ```

   Le script produit `szh-publishing-rootfs-<version>.tar.gz` et son `.sha256`.
5. **L'éprouver.** L'importer dans une distribution d'essai, y lancer
   `bash test/build-render.sh`, et comparer les PNG page à page avec ceux de la version
   précédente (méthode dans [`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#le-banc-de-rendu-et-ses-empreintes)).
   Le script enchaîne trois contrôles qui doivent rester verts : le contrôle PDF/UA-1 du
   banc, `test/polices-check.py` (aucune police de secours prise sur la machine) et le
   corpus `test/accessibilite/`. La CI ne remplace pas cette étape : elle installe pandoc,
   WeasyPrint et veraPDF directement sur son serveur Ubuntu, hors de l'image, et ne compare
   aucun PNG.
6. **Publier** une version (« release lourde »). La CI reconstruit l'image dès que `image/`
   a changé depuis la version précédente (`image/patches/amont/` mis à part). Pour la
   reconstruire sans rien changer dans `image/`, par exemple pour prendre les seuls
   correctifs Debian : GitHub → Actions → `release` → *Run workflow*, avec la nouvelle
   version et la case `force_rootfs` cochée.
7. **Les postes** reçoivent l'image à leur mise à jour suivante
   ([étape 2/5](#le-déroulement)).

### Les correctifs de WeasyPrint

WeasyPrint est corrigé par huit petits correctifs, un par fonctionnalité, dans
`image/patches/weasyprint-70.0/` : en-têtes de tableau, images décoratives, césure, espace en
fin de ligne, marges en artefact, `dc:language`, notes en double, notes reportées. Chacun a
son dossier dans `image/patches/amont/` (description du défaut, démonstration) et son cas
dans `test/weasyprint-patch-check.py`.

À chaque nouvelle version de WeasyPrint :

1. créer `image/patches/weasyprint-<nouvelle version>/` : sans lui, `image/patch-weasyprint.sh`
   refuse de construire ;
2. pour chaque correctif, vérifier si WeasyPrint a corrigé le défaut lui-même. Retirer ceux
   qui ne servent plus (ou les renommer en `.patch.off`) ;
3. chaque correctif restant doit s'appliquer seul, sans décalage (`--fuzz=0`) ;
4. lancer `test/weasyprint-patch-check.py` dans la WSL ;
5. après la construction, compiler et vérifier que le journal ne dit pas
   « PDF/UA-1 indisponible → PDF balisé simple » ;
6. vérifier si WeasyPrint sait enfin poser la langue d'un passage (`/Lang` sur un élément) :

   ```sh
   grep -rn Lang /opt/weasyprint/lib/python3*/site-packages/weasyprint/pdf/
   ```

   Aujourd'hui, `/Lang` n'est posé que sur le document entier. Voir
   [`LIMITES-ACCESSIBILITE.md`](LIMITES-ACCESSIBILITE.md).

Après une montée de veraPDF ou de son Java, vérifier que la porte PDF/UA distingue toujours
ses trois issues : 0 conforme, 1 non conforme, 2 panne d'outillage (validateur absent, Java
cassé, PDF illisible).

### Fin de support de Debian

Une fois par an, comparer `DEBIAN_TAG` au calendrier de Debian (support standard environ
trois ans, puis LTS). Debian 13 est sortie en août 2025. Changer de version majeure se fait
en modifiant `DEBIAN_TAG`, puis en suivant toute la procédure ci-dessus ; compter une demi-
journée à une journée.

### Réparer la distribution d'un compte

La distribution est enregistrée par compte, et chaque compte a son disque dans
`C:\ProgramData\SZH\WSL\<SID>\SZH-Publishing`. Tout se fait dans la session du compte
concerné, sans élévation.

1. Commencer par `wsl --shutdown`. Cela règle la plupart des blocages passagers (horloge
   décalée après une veille, montage figé).
2. Si la distribution est corrompue (erreurs d'entrée-sortie après une coupure ou un disque
   plein), la supprimer puis la faire réinstaller par la mise à jour, qui réimporte
   l'image quand la distribution manque :

   ```powershell
   wsl --unregister SZH-Publishing
   ```

   puis menu Démarrer → « Pronto (Updater) », éditeur fermé.
3. À la main, sans réseau, depuis l'image gardée dans `staging\` :

   ```powershell
   $tar = (Get-ChildItem 'C:\ProgramData\SZH\staging\szh-publishing-rootfs-*.tar.gz' | Sort-Object Name -Descending)[0].FullName
   $sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
   wsl --import SZH-Publishing "C:\ProgramData\SZH\WSL\$sid\SZH-Publishing" $tar --version 2
   wsl --terminate SZH-Publishing
   wsl -d SZH-Publishing --exec /bin/true      # doit finir sans rien afficher
   ```

Il n'y a rien à sauvegarder avant : aucune donnée de revue n'est dans la distribution.

**Taille du disque.** `.wslconfig` active `sparseVhd`, qui rend la place libérée, et chaque
nouvelle image arrive sur un disque neuf. Si un `ext4.vhdx` reste très gros (disque du
poste sous 15 Go) : `wsl --shutdown`, puis compacter le fichier par `Optimize-VHD` (si
Hyper-V est installé) ou par `diskpart` (`select vdisk file="…"`, `attach vdisk readonly`,
`compact vdisk`, `detach vdisk`).

---

## Dépannage

Une entrée par symptôme. Dans tous les cas, commencer par le
[contrôle rapide](#le-contrôle-rapide), dans la session de la personne.

### Poste et WSL

**Le rédacteur n'a ni extensions, ni raccourcis, ni PDF, alors que le poste est « à jour ».**
- Cause probable : l'installation a été faite avec un compte de support élevé ; tout a été
  posé pour ce compte-là.
- Que faire : dans la session du rédacteur, sans élévation, « Pronto (Updater) ». Puis
  `diagnostic.ps1`.

**`Ctrl+S` ne produit plus rien, ou la compilation reste bloquée.**
- Cause probable : WSL figée (souvent après une veille).
- Que faire : `wsl --shutdown`, puis recompiler.

**Après une mise à jour de Windows, plus aucun PDF.**
- Cause probable : le moteur WSL a changé (montage de `/mnt/c`, réseau de la machine
  virtuelle).
- Que faire : `wsl --shutdown` ; noter `wsl --version` ; si le défaut persiste,
  `wsl --update --rollback`, et garder cette version le temps de corriger.

**« Aucune distribution installée », ou la distribution ne démarre pas.**
- Causes probables : la distribution n'est pas enregistrée pour ce compte ; la
  virtualisation est désactivée dans le firmware ; les fonctionnalités Windows
  « Plateforme de machine virtuelle » et « Sous-système Windows pour Linux » sont coupées.
- Que faire : `wsl -l -v` doit montrer `SZH-Publishing` en version 2. Sinon,
  « Pronto (Updater) » dans la session du compte. Si la mise à jour dit que
  l'environnement « refuse de démarrer », faire activer la virtualisation par
  l'informatique. En dernier recours, relancer `bootstrap.ps1` en administrateur depuis
  un clone frais.

**La mise à jour dit « son dossier est déjà pris sur ce poste ».**
- Cause probable : un reste d'installation interrompue dans `C:\ProgramData\SZH\WSL\<SID>\`.
- Que faire : relancer la mise à jour, qui écarte ce reste. Si le message revient,
  redémarrer le poste puis relancer.

**La mise à jour dit qu'il ne reste que quelques Go libres.**
- Cause : il faut 5 Go libres sur `C:` pour remplacer l'image.
- Que faire : libérer de la place (voir « Taille du disque » ci-dessus), relancer.

**La mise à jour dit qu'un fichier téléchargé « est arrivé abîmé ».**
- Cause : le sha256 ne correspond pas, souvent une connexion coupée en route.
- Que faire : relancer ; si cela se répète, regarder le réseau ou le proxy.

**Les compilations prennent plusieurs dizaines de secondes, ou un fichier reste verrouillé.**
- Cause probable : exclusions antivirus absentes, ou effacées par une politique centrale.
- Que faire : les poser (liste dans [Installer un poste](#installer-un-poste)).

**Le disque du poste se remplit.**
- Cause probable : le `ext4.vhdx` d'un compte, ou de vieux comptes.
- Que faire : voir « Taille du disque » ci-dessus ; supprimer les distributions des comptes
  qui ne servent plus.

### Mise à jour

**Un poste ne se met plus à jour.**
- Causes probables : renoncements répétés (éditeur toujours ouvert au moment de remplacer
  l'image), réseau, poste toujours éteint le mardi et jamais redémarré.
- Que faire : lire `szh-<AAAA-MM>.log`, le dernier `update-*.log` et
  `%LOCALAPPDATA%\SZH\maj-auto.json` du compte (`bloqueFois` élevé et `bloqueDepuis` ancien :
  le poste décroche). Lancer « Pronto (Updater) », éditeur fermé.

**Le journal dit « tâche planifiée refusee » ou « non corrigée (Access is denied.) ».**
- Cause : la tâche planifiée diffère de la forme voulue (par exemple un ancien déclencheur
  quotidien), et seul un administrateur peut la réécrire. La cadence hebdomadaire s'applique
  quand même.
- Que faire : une fois, en administrateur, depuis un clone frais :

  ```powershell
  . '.\szh-publishing-toolchain\windows\szh-common.ps1'
  . '.\szh-publishing-toolchain\windows\szh-taches.ps1'
  Set-SzhTacheMaj
  ```

  Le bilan vaut `conforme`, `corrigee`, `creee`, `refusee` ou `illisible`. Relancer
  `bootstrap.ps1` fait la même chose.

**Les postes échouent tous au téléchargement.**
- Cause probable : le dépôt est devenu privé, ou GitHub limite les appels. La mise à jour
  sans jeton exige un dépôt public.
- Que faire : vérifier la visibilité du dépôt et la page des versions sur GitHub.

**Une version est publiée mais une extension n'est pas réinstallée.**
- Cause : la mise à jour compare la `version` du `package.json` de l'extension. La CI refuse
  une version dont le dossier d'une extension a changé sans que sa `version` monte ; ce cas
  ne devrait donc plus arriver.
- Que faire : `node test/js/porte-release.js --version X.Y.Z` avant le commit de version.

**« Lier un appel à une référence » refuse de s'ouvrir, ou le cockpit signale deux versions
différentes.**
- Cause : le toolkit et l'extension cockpit ne sont pas de la même version.
- Que faire : « Pronto (Updater) », ou « Changer de version… » vers une version cohérente.

**Un rapport `ACCUEIL-COCKPIT-ABSENT` arrive dans `_Systeme`.**
- Cause : le cockpit manque sur ce compte, ou est trop ancien pour l'Accueil.
- Que faire : « Pronto (Updater) » dans la session du compte.

### Windows : raccourcis, fichiers, liens

**Une entrée manque au menu Démarrer (souvent « Pronto (Updater) »).**
- Cause probable : une stratégie de groupe interdit l'écriture dans le menu Démarrer du
  compte. Le journal du mois porte `raccourci du menu Démarrer non posé -> …`.
- Que faire : en général rien, la passe silencieuse les repose à chaque ouverture de
  session. Si la stratégie est définitive, faire déployer le raccourci par l'informatique
  dans le menu « Tous les utilisateurs ». Le sous-dossier `SZH\` du menu appartient à un
  autre produit : on n'y touche pas. Un raccourci épinglé à la barre des tâches est une
  copie : le désépingler et le réépingler à la main après un changement.

**Le double-clic sur un `.md` n'ouvre plus Pronto.**
- Cause probable : une autre application a repris l'association.
- Que faire : relancer « Pronto (Updater) » ; l'utilisateur choisit ensuite une fois
  « Toujours utiliser cette application » dans « Ouvrir avec ».

**Un lien `szh://` reçu par courriel ne fait rien.**
- Causes probables : le protocole n'est pas déclaré « de confiance » pour Office (la clé
  `HKCU\…\Trusted Protocols\All Applications\szh:` est posée par la mise à jour), ou la
  personne utilise le nouvel Outlook, qui ne connaît pas ce protocole.
- Que faire : relancer la mise à jour ; avec le nouvel Outlook, suivre la ligne de repli
  écrite dans le courriel (menu Démarrer → …).

**Le raccourci « Ouvrir la revue » d'un numéro ne fait rien.**
- Cause probable : un raccourci ancien, qui contient un chemin `C:\Users\…` d'un autre poste.
  Un raccourci correct vise `wscript.exe` et finit par `szh://ouvrir/…`.
- Que faire : ouvrir le numéro depuis l'Accueil, puis l'archiver et le désarchiver, ce qui
  réécrit le raccourci.

**Le brouillon de courriel (traduction, support) ne s'ouvre pas.**
- Cause : il passe par `mailto:`, donc par le client de messagerie par défaut de Windows.
- Que faire : vérifier ce réglage de Windows. Le lien de traduction est aussi copié dans le
  presse-papiers.

### OneDrive et données

**L'Accueil n'affiche plus aucun numéro.**
- Causes probables : le poste est passé du mauvais côté (`emplacementRevues`), ou la
  bibliothèque SharePoint n'est plus trouvée sur le disque.
- Que faire : regarder la bannière « Mode test » de l'Accueil et la ligne
  `revues : emplacement "…" -> <chemin>` du journal du mois. La reprise pas à pas est dans
  [`EMPLACEMENTS.md`](EMPLACEMENTS.md).

**La compilation échoue ou reste bloquée sur un numéro.**
- Cause probable : le dossier est « en ligne seulement » sur OneDrive (icône de nuage) ;
  la WSL lit alors des fichiers absents.
- Que faire : clic droit → « Toujours conserver sur cet appareil », attendre la
  synchronisation. Pronto épingle de lui-même, à chaque ouverture, les numéros et livres en
  cours et la bibliothèque `_NewsUndActu` (sauf si `"epinglageHorsLigne": false` est posé
  dans `config.json`).

**Un fichier reste verrouillé pendant un export ou un archivage.**
- Cause : un PDF ouvert hors de l'éditeur (SumatraPDF, Acrobat).
- Que faire : fermer ce lecteur et relancer « Tout recompiler ».

**Deux personnes ont modifié le même numéro.**
- Ce qui se passe : un formulaire réserve pendant deux minutes le fichier qu'il modifie ;
  pour le reste, OneDrive crée une copie en conflit, que le cockpit détecte et fait résoudre.
- Règle de travail : un article, une personne à la fois.

### Contenu et compilation

**Un Word ne se convertit pas : il reste dans `articles-word/`.**
- Causes probables : un `.doc` ancien (seuls `.docx` et `.odt` sont lus), un fichier encore
  ouvert dans Word, des styles qu'aucune règle ne reconnaît.
- Que faire : fermer Word ; réenregistrer en `.docx` ; appliquer les styles du gabarit
  (« Pronto – modèle d'article »).

**Le titre a été coupé en titre et sous-titre, ou aurait dû l'être.**
- Cause : sans style de sous-titre dans le Word, l'import coupe au premier deux-points suivi
  d'une espace. Le journal d'import porte le code `sous-titre-deduit`.
- Que faire : corriger dans « Métadonnées des articles », champ titre.

**La fiche n'a que les noms des auteurs : ni fonction, ni courriel, ni portrait.**
- Cause : le tableau des auteurs en fin de Word n'a pas pu être lu (une cellule illisible
  suffit). Code `tableau-auteurs-non-lu`. Une notice biographique en prose ne se lit jamais :
  le tableau reste alors dans le texte, c'est voulu.
- Que faire : compléter la fiche à la main, ou remettre une personne par cellule dans le
  Word puis « Réimporter cet article ». Le code `credit-photo-non-repris` cite un crédit de
  photo à reporter à la main.

**Un appel de citation n'est pas relié à sa référence.**
- Cause : codes `appel-sans-reference` (nom ou année sans entrée correspondante) ou
  `appel-ambigu` (deux entrées possibles) ; l'appel est souligné en pointillé dans l'aperçu.
  `ancrage-inconnu` : la référence a changé depuis la pose du lien. `caractere-sans-repli` :
  un nom en alphabet non latin.
- Que faire : curseur dans l'appel, panneau Édition (`Ctrl+Alt+S`) → « Lier un appel à une
  référence ». `reference-orpheline` signale une entrée que le texte ne cite pas.

**La bibliographie reste dans le texte, ou un encadré rouge remplace la liste.**
- `biblio-non-detachee`, `biblio-dans-le-corps` : les références n'ont pas le style de
  bibliographie dans le Word ; elles restent dans le corps et ne partiront pas comme
  références vers OJS. Appliquer le style dans le Word, puis réimporter.
- `biblio-introuvable` (encadré rouge) : le fichier `<slug>.biblio.md` a été supprimé ou
  renommé. Réimporter l'article, ou retirer le bloc `::: {.szh-biblio …}` du texte.
- `biblio-references-restees`, `biblio-incomplete` : quelques références n'ont pas le style ;
  les styler dans le Word, puis réimporter.
- `biblio-conflit` après un réimport : le Word et la rédaction ont tous deux changé la liste ;
  la version de la rédaction est gardée sous `.szh-avant-reimport/`, ou « Annuler le
  réimport ».

**Un encadré rouge « tableau introuvable ».**
- Cause : le fichier `tables/table-NN.html` a été supprimé ou renommé.
- Que faire : rouvrir le tableau depuis la barre « Pronto » et l'enregistrer, ou retirer la
  référence du texte.

**Le journal dit « PDF/UA-1 indisponible → PDF balisé simple ».**
- Cause : WeasyPrint n'a pas pu produire le PDF/UA ; le PDF est produit quand même, moins
  accessible.
- Que faire : relancer WeasyPrint à la main sur le HTML, sans masquer la sortie d'erreur,
  pour voir la cause. Arrive surtout après une montée de WeasyPrint.

**Le badge PDF/UA montre un point d'interrogation, ou la porte PDF/UA sort en code 2.**
- Cause : panne d'outillage (veraPDF absent, Java cassé, PDF illisible), et non un PDF non
  conforme.
- Que faire : lire la sortie d'erreur de veraPDF, recopiée telle quelle par
  `pipeline/verifier-ua.sh`. Les chemins viennent de `VERAPDF` (par défaut
  `/opt/verapdf-cli/verapdf`) et `VERAPDF_JAVA` (par défaut `/opt/jre-min`). Si l'image est
  abîmée, réparer la distribution.

**Un résumé en langue étrangère est lu avec la voix de la langue de l'article.**
- Cause : limite connue de WeasyPrint, que veraPDF ne détecte pas. Voir
  [`LIMITES-ACCESSIBILITE.md`](LIMITES-ACCESSIBILITE.md).

### GitHub et CI

**La CI devient rouge sans qu'une ligne du dépôt ait changé.**
- Cause probable : un outil tiré du réseau a bougé (`vsce`, image des serveurs GitHub,
  Open VSX indisponible).
- Que faire : lire le journal de l'étape ; figer la version qui marchait dans
  `.github/workflows/release.yml`. Une extension retirée d'Open VSX se remplace, ou son
  `.vsix` se place dans le dépôt ([`windows/VSIX.md`](../windows/VSIX.md)).

**Le pack de langue allemand refuse de s'installer.**
- Cause : un pack de langue exige une version de VSCodium au moins égale à la sienne.
- Que faire : garder dans `windows/vsix.lock` un pack dont la version ne dépasse pas celle
  de VSCodium (`windows/apps.lock`).

---

## Surveiller

| Quoi | Où | Quand | Ce qu'on cherche |
|---|---|---|---|
| Rapports d'erreur | `<SharePoint>\2_Produkte\54_Pronto\_Systeme\rapports\` | chaque semaine | un code qui revient, un poste qui revient. Format et codes : [`RAPPORTS-ERREUR.md`](RAPPORTS-ERREUR.md) |
| Inventaire des postes | `_Systeme\inventaire\<POSTE>.csv`, une ligne par mois et par compte (versions du toolkit, du cockpit, de l'éditeur, de l'image, emplacement, place libre…) | chaque mois | un poste absent du mois (éteint ou cassé), une version en retard, un poste en mode test, peu de place libre |
| Compteurs d'usage (import, nettoyeur) | `_Systeme\compteurs\` | chaque trimestre | l'usage réel ; purger les fichiers de plus de 24 mois |
| Résultat des versions publiées | GitHub → Actions | à chaque version | `ci` et `release` verts |
| Journaux d'un poste | `C:\ProgramData\SZH\logs\`, onglet Log de l'Accueil | sur incident | |
| Barre d'état du cockpit | dans un numéro ouvert | avant chaque numéro | la version du toolkit, comparée à celle qui a créé le numéro |

L'inventaire est écrit à chaque ouverture de Pronto, seulement si la bibliothèque SharePoint
est trouvée sur le poste. Les rapports et compteurs écrits hors ligne attendent dans
`%LOCALAPPDATA%\SZH\` et partent à l'ouverture suivante.

La synthèse des compteurs se fait avec le Node de VSCodium, depuis un clone du dépôt :

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& "$env:ProgramFiles\VSCodium\VSCodium.exe" vscodium-extension\szh-cockpit\outils\compteurs-synthese.js --depuis 2026-07-01
```

Les options (`--jusqua`, `--contexte prod|dev|tous`, `--sortie`, `--purger`) sont décrites
dans [`RAPPORTS-ERREUR.md`](RAPPORTS-ERREUR.md).

Une fois par an, vérifier aussi : la fin de support de Debian, que les extensions de
`windows/vsix.lock` sont toujours publiées sur Open VSX, et que le pack de langue allemand
reste compatible avec la version de VSCodium.

---

## Les moissonneurs

Les moissonneurs cherchent des nouveautés pour la rubrique Documentation. Ils déposent des
propositions, que la rédaction accepte ou refuse dans la vue « Propositions » du cockpit ;
ils ne créent jamais de fiche. Le fonctionnement complet est dans
[`moissonneurs/LISEZMOI.md`](../moissonneurs/LISEZMOI.md),
[`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md) et [`FORMAT-MOISSONS.md`](FORMAT-MOISSONS.md).

### Lesquels

| Moissonneur | Ce qu'il cherche | Sources |
|---|---|---|
| `parlement` | interventions parlementaires | API OpenParlData.ch : Confédération, 26 cantons, quelques villes |
| `recherche` | projets de recherche | `skbf` (CSRE), `sites` (sites de hautes écoles : hfh, phbern, phsg, ehb, phzh, phfhnw, phlu, hepvd, hepbejune, hepfr), `snf` (export du FNS, importé à la main) |

Ils sont écrits en Python et tournent dans la WSL du poste qui les lance. Ils sont livrés dans
le toolkit (`C:\ProgramData\SZH\toolkit\moissonneurs\`).

### Qui les lance

Personne automatiquement : aucune tâche planifiée, aucun serveur, aucune CI ne les lance.
Une personne de la rédaction les lance depuis le cockpit :

- Accueil → **Paramètres** → **Moissonnage** → « Lancer la moisson mensuelle ». Le cockpit
  estime la durée, prend le créneau (une seule moisson à la fois, tous postes confondus),
  puis lance les deux moissonneurs l'un après l'autre. En mode test, la moisson tourne sans
  requête réseau ;
- au même endroit, « Données FNS » → « Importer les données FNS… » : le FNS interdit les
  robots, on télécharge l'export « Grants with abstracts (CSV) » sur data.snf.ch puis on
  l'importe. Fréquence conseillée : tous les six mois, fin mai et fin novembre.

« Mensuelle » désigne le budget de requêtes, compté par mois et pour tous les postes ensemble
(800 requêtes pour `parlement`, 3000 pour `recherche`). Ce n'est pas un calendrier.

On peut aussi les lancer en ligne de commande, dans la WSL ; la commande est dans
[`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#la-moisson-mensuelle-hors-du-cockpit).

### Où sont leurs réglages

| Fichier | Contenu |
|---|---|
| `moissonneurs/parlement/reglages.toml` | `[reseau]` (adresse, délai), `[moisson]` (cantons, date de départ), `[villes]`, filtres, `[mensuelle]` (`active`, `budget`), `[export]` (`depose_depuis` : date avant laquelle une affaire ne part pas en proposition) |
| `moissonneurs/recherche/reglages.toml` | `delai`, `budget`, `[filtre]`, `[sources.snf]`, `[sources.skbf]`, `[sources.sites]` (`actif`, `liste`) |
| `moissonneurs/recherche/sources/sites.py` | la description de chaque site ; quatre sont coupés dans le code (`actif=False`, avec leur raison) : phzh, phlu, hepbejune, hepfr |
| `_NewsUndActu\_Moissons\_Reglages\` (SharePoint) | la finesse du tri des propositions, réglée depuis Accueil → Paramètres → Moissonnage |

Ces fichiers font partie du toolkit, qui est remplacé à chaque mise à jour. Une modification
faite sur un poste disparaît donc à la mise à jour suivante : un changement durable passe par
le dépôt et une nouvelle version. Il n'existe aucun réglage du cockpit, aucune clé de
`config.json` et aucune variable d'environnement pour les moissonneurs.

### Désactiver un moissonneur ou une source

| Pour… | Comment | Portée |
|---|---|---|
| couper une source de `recherche` | `actif = false` dans `[sources.snf]`, `[sources.skbf]` ou `[sources.sites]` de `recherche/reglages.toml` | tous les postes, après une nouvelle version |
| couper un site | le retirer de `liste` dans `[sources.sites]`, ou `actif=False` dans `recherche/sources/sites.py` | tous les postes, après une nouvelle version |
| couper les requêtes de `parlement` | `[mensuelle] active = false` dans `parlement/reglages.toml` : la passe mensuelle n'interroge plus l'API | tous les postes, après une nouvelle version |
| ne lancer qu'un seul moissonneur, une fois | en ligne de commande : `python3 -B moisson.py mensuelle … --seulement parlement` (ou `recherche`). Le cockpit ne propose pas ce choix | cette passe |
| arrêter une passe en cours | bouton « Arrêter » du cockpit : le lot partiel est déposé | cette passe |
| couper un moissonneur partout, sans nouvelle version | retirer son état partagé, `_NewsUndActu\_Moissons\<moissonneur>\_partage\socle.json`. La moisson le saute (« état partagé absent ») ; si aucun n'a d'état partagé, le bouton est grisé. Le socle se republie depuis le poste de développement | tous les postes, immédiatement |

Les moissonneurs s'arrêtent aussi d'eux-mêmes : quand le budget du mois est épuisé (ils
sont alors sautés jusqu'au mois suivant), et, pour `recherche`, quand une source répond
« accès refusé » (403) deux passes de suite. Une source ainsi coupée se réactive au poste de
développement par `python3 -B -m recherche reactiver <source> --base …`.

### Ajouter un moissonneur

C'est un travail de développement. Il faut, dans le dépôt : un paquet
`moissonneurs/<nom>/` avec son `__main__.py` et les commandes `tout` et `estimer` ; le nom
dans `MOISSONNEURS` (`moissonneurs/evenements.py`) et une table de traduction dans
`evenements.TABLES` ; le libellé `doc.prop.moissonneur.<nom>` en français et en allemand dans
`lib/i18n.js` ; des tests ; puis publier son socle dans `_Moissons\<nom>\_partage\` depuis le
poste de développement, et une nouvelle version. Le contrat des lots et des commandes est
dans [`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md) et
[`moissonneurs/LISEZMOI.md`](../moissonneurs/LISEZMOI.md).

### Pannes connues

| Ce qu'on voit | Cause | Que faire |
|---|---|---|
| « Le dossier _Moissons est introuvable » | `_NewsUndActu\_Moissons` manque à la racine active ; rien ne le crée | vérifier la racine active (mode test ?), ou créer le dossier |
| « L'état partagé est absent » | pas de `socle.json` pour ce moissonneur | publier le socle depuis le poste de développement |
| « Le budget de requêtes du mois est épuisé » | les passes du mois ont consommé le budget, tous postes confondus | attendre le mois suivant |
| « Une moisson tourne déjà depuis le poste … » | une autre passe a pris le créneau. Une passe tuée laisse son annonce environ 15 minutes ; la latence de OneDrive peut laisser deux passes se chevaucher | attendre l'heure de fin affichée |
| « Ce fichier n'est pas l'export FNS attendu » | fichier de moins de 50 Mo ou de 10 000 lignes, colonnes manquantes (souvent l'export sans résumés), plus de 1 % de lignes illisibles | télécharger « Grants with abstracts (CSV) » |
| `parlement` s'arrête sur « accès refusé (403) » | OpenParlData refuse l'accès ; toute la moisson `parlement` s'arrête, le lot partiel est déposé | vérifier la page de l'API ; ne pas insister |
| des requêtes ralentissent (429, 503) | le serveur demande d'attendre. Les moissonneurs espacent seuls leurs requêtes ; `parlement` abandonne un corps (un canton) après cinq échecs de suite | rien, sauf si cela se répète d'un mois à l'autre |
| peu de propositions d'un canton | certains cantons publient leurs textes avec des mois de retard, ou partiellement (Vaud, Schaffhouse) ; un zéro récent n'est pas une absence | rien |
| peu de projets en Suisse romande, dates manquantes | quatre sites sont coupés ; certains sites ne donnent pas de date ; la CSRE enregistre ses projets avec retard | rien, limite connue |

---

## Gestes récurrents

### Avant chaque numéro

- Recompiler le numéro précédent : le PDF ne doit pas avoir changé.
- Vérifier que les dossiers du numéro sont « toujours conservés sur cet appareil » (rond
  vert plein dans OneDrive).
- Regarder la version du toolkit dans la barre d'état du cockpit.

### Nouveau numéro, nouveau livre

Accueil → onglet **Nouveau**. Le dossier est créé dans les numéros « en cours » de la racine
active (attention au mode test). `new-revue.ps1` (ou `new-livre.ps1`) copie le modèle (pour une
revue, sans article d'exemple), écrit l'année, le numéro, le volume, la version du toolkit,
et pose le raccourci « Ouvrir la revue » (« Ouvrir le livre »). Un numéro qui reprend un
volume et un numéro existants est refusé.

### Verrouiller et archiver

Panneau Export (`Ctrl+Alt+D`) : « Archiver et verrouiller le numéro », « Déverrouiller le
numéro », « Désarchiver le numéro ». Les clés `locked` et `archived` de `ausgabe.yaml` (ou
`buch.yaml`) font foi. Un numéro verrouillé est en lecture seule et ne se recompile plus.
L'archivage supprime `out/`, puis déplace le dossier vers `_Archive\` (`archive-revue.ps1`).

### Nouvelle année

Rien à faire. La couleur de l'année et le numéro de volume se calculent depuis l'année :

- couleur : elle avance d'un cran par an dans la liste des six teintes (bleu acier, capucine,
  Mountbatten, moutarde, poireau, rouge), à partir de bleu acier pour la Zeitschrift et de
  poireau pour la Revue en 2026. Une couleur peut être imposée pour un numéro par la clé
  `couleur` de son `ausgabe.yaml` ;
- volume : année − 1994 pour la Zeitschrift, année − 2010 pour la Revue.

### Bascule test / production

La clé `emplacementRevues` (`test` ou `production`) de `C:\ProgramData\SZH\config.json` vaut
pour tout le poste. Elle se change dans Accueil → Paramètres → « Mode développeur (dossiers
de test) ». Elle ne déplace aucun fichier. Voir
[Passer un poste neuf en production](#passer-un-poste-neuf-du-mode-test-à-la-production) et
[`EMPLACEMENTS.md`](EMPLACEMENTS.md).

### Sauvegardes

Le dépôt n'a pas de mécanisme de sauvegarde propre. Les données sont sur SharePoint, qui
garde l'historique des versions de chaque fichier et une corbeille, selon les réglages de la
bibliothèque. Un fichier écrasé ou supprimé se récupère donc depuis SharePoint (« Historique
des versions », « Corbeille »). La chaîne elle-même se réinstalle depuis GitHub.

Ne sont pas transférables d'un poste à l'autre : les clés d'API (OJS, Shlink, Mistral),
gardées chiffrées par compte. Il faut les ressaisir sur un nouveau poste (Accueil →
Paramètres → Services en ligne).

### Monter VSCodium, SumatraPDF ou une extension

Ces versions sont épinglées : `windows/apps.lock` pour les applications
([`windows/APPS.md`](../windows/APPS.md)), `windows/vsix.lock` pour les extensions
([`windows/VSIX.md`](../windows/VSIX.md)). Les postes ne se mettent pas à jour seuls
(`update.mode: manual`, `extensions.autoUpdate: false`).

Avant de monter VSCodium sur tous les postes, faire le parcours complet sur un seul : ouvrir
un numéro, cliquer un article, `Ctrl+S`, basculer l'aperçu, éditer un tableau (gras et
italique dans une cellule), verrouiller puis déverrouiller, archiver puis désarchiver. Ce
sont les points les plus fragiles. Vérifier aussi que le pack de langue allemand s'installe.

### Le gabarit Word

Le gabarit « Pronto – modèle d'article » est livré avec le toolkit. Le modifier est décrit
dans [`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#faire-évoluer-le-gabarit-darticle).

---

## Réglages de l'éditeur et langue de l'interface

### Réglages de l'éditeur

`vscodium-user/settings.json` est la source des réglages que la maison impose à tous les
postes. La mise à jour ne le copie que sur un compte qui n'en a pas : ce que la personne
choisit ensuite (thème, zoom, taille de police, langue, mode d'aperçu) survit aux mises à
jour. `keybindings.json` et `tasks.json`, eux, sont remplacés à chaque mise à jour. Les
raccourcis clavier sont décrits dans [`userdoc.md`](../userdoc.md).

### Les réglages protégés

Trois blocs décrivent la chaîne de publication plutôt que le confort d'une personne : la
configuration de l'export OJS, les titres de bibliographie et les tâches éditoriales par
article. Ils viennent de `windows/settings-protected.json`, copié dans
`C:\ProgramData\SZH\settings-protected.json` à chaque mise à jour, et sont en lecture seule
dans « Réglages Pronto ». Un bloc absent de ce fichier laisse le réglage du poste intact.

Une personne peut les déverrouiller sur son poste ; sa modification vaut jusqu'à la mise à
jour suivante. `diagnostic.ps1` signale cet écart (section « Réglages de la rédaction »).
Pour la rendre durable, on la reporte dans `windows/settings-protected.json` et on publie une
version.

### La langue de l'interface

Deux sources indépendantes, d'où parfois un écran mi-français mi-allemand :

- les menus de VSCodium et les titres de commandes suivent la langue de VSCodium
  (`%APPDATA%\VSCodium\argv.json`, clé `locale`, et le pack de langue allemand). Il n'y a
  pas de pack français : des menus en anglais sont normaux pour un poste francophone ;
- tout le reste du cockpit suit, dans cet ordre : le réglage « Langue de l'interface » de
  « Réglages Pronto » (`szh.langue`), la clé `langue` de `config.json`, la clé `langue` de
  `state.json`, la langue de VSCodium, la langue de Windows, puis le français.

Quand les deux divergent, `diagnostic.ps1` (section « Langue de l'interface ») affiche toutes
les sources côte à côte.

---

## Si tout casse : la reprise minimale

1. `wsl --shutdown`, puis recompiler. Cela règle la plupart des blocages.
2. Toujours en échec : `wsl --unregister SZH-Publishing`, puis « Pronto (Updater) »
   (ou réimport à la main, voir [Réparer la distribution](#réparer-la-distribution-dun-compte)).
3. Toujours en échec : relancer `bootstrap.ps1` en administrateur, depuis un clone frais du
   dépôt.
4. En dernier recours : revenir à la version précédente (« Changer de version… » ou
   `update.ps1 -Version <X>`).

Aucune de ces étapes ne touche aux revues : le contenu est sur SharePoint.
