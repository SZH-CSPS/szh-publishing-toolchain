# Pronto sous Linux et macOS : les enjeux

Ce qu'il faudrait refaire, morceau par morceau, pour que Pronto tourne ailleurs que sous
Windows. Ce sont des enjeux et des ordres de grandeur, pas un plan : aucun de ces travaux
n'est engagé.

**En bref.** Le cœur est déjà portable : le pipeline (make, pandoc, Lua, Python), l'image
OCI, et l'essentiel du cockpit (≈ 50 000 lignes de JavaScript, dont ≈ 35 000 dans `lib/`).
Ce qui ne l'est pas : ≈ 14 400 lignes de `windows/*.ps1` et une dizaine de modules du
cockpit qui appellent Windows. Le chantier consisterait à faire passer le lanceur et le
déploiement du côté de Node et de VSCodium. Le moteur de compilation, lui, ne changerait pas.

## 1. Le lanceur

- **Déjà portable.** La logique lourde tourne en Node (`outils/secretariat-cli.js`,
  `outils/rendre-gabarit.js`, `outils/auteurs-cli.js`, `lib/gabarits.js`) ; le PowerShell ne
  fait que l'appeler. `lib/accueil-hote.js` montre déjà une page d'accueil dans VSCodium.
- **Ce qui bloque.**
  - WinForms : `open-produit.ps1`, `lanceur-secretariat.ps1`, `lanceur-preproc.ps1` ;
  - `szh-produits.ps1` (listes, racines), `szh-textes.ps1`, `new-revue.ps1` et
    `new-livre.ps1` ;
  - l'ancrage SharePoint, résolu en PowerShell seulement (`lib/auteurs-corpus.js` l'appelle
    par `powershell.exe`).
- **Option : une vue de szh-cockpit plutôt qu'une extension à part.**
  - Une WebviewView dans un conteneur de la barre d'activité, visible quand aucun dossier
    n'est ouvert (`viewsWelcome`).
  - Sections Produits, Nouveau, Secrétariat (par `require` direct), Préprocessing (par le
    moteur), Réglages, Journal (un OutputChannel) ; ouverture par `vscode.openFolder`.
  - Une extension séparée doublerait l'i18n, les réglages et les chemins.
- **Gain.** Une bonne part des jumeaux PowerShell/JavaScript disparaît avec le lanceur, et
  leurs tests de parité avec eux. Pas tous : la mise à jour (`update.ps1`) tourne quand Node
  ou VSCodium manquent, et doit garder en PowerShell son rapport d'erreur, l'ancrage
  SharePoint et le repli du courriel de support.
- **Coût.** 3 à 5 semaines. Risque moyen : mode simulé, mutex, sélecteur de version.

## 2. Le moteur (WSL et make)

- **Déjà portable.** L'image OCI (GHCR), le pipeline, pur Linux, que la CI fait déjà
  tourner sur un Ubuntu nu.
- **Ce qui bloque.**
  - `wsl.exe` écrit en dur dans `vscodium-user/tasks.json` (8 tâches), dans `extension.js`
    et dans `lib/cmyk.js`, `lib/portraits.js`, `lib/wsl.js`, et par lui
    `lib/pagination-hote.js` et `lib/pdfua-hote.js` ;
  - la conversion en `/mnt/c` de `lib/poste.js` ;
  - le `Makefile` désigné par `/mnt/c/ProgramData/SZH/…`.
- **Option : un `lib/moteur.js` unique** (exécuter, réveiller, traduire un chemin), avec
  trois implémentations.
  - **Windows** : la WSL reste. Docker Desktop tourne dans la même VM WSL2 : aucun gain, et
    des droits d'administrateur en plus.
  - **Linux** : Podman sans racine (ou toolbox, distrobox) sur la même image, épinglée par
    digest. Un conteneur de longue durée et `podman exec` coûtent ≈ 50 à 100 ms par appel,
    comparables aux ≈ 45 ms du passage par WSL ; un `podman run` par appel coûterait 0,3 à
    0,8 s.
  - **macOS** : Podman machine ou Colima, donc une VM, des montages virtiofs plus lents et un
    démarrage à froid de plusieurs secondes.
- **Chemins fixes dans le moteur** : `/opt/szh/toolkit` et le dossier de travail monté. Les
  tâches seraient générées par le cockpit (`ProcessExecution`), ou porteraient des variantes
  `windows`, `linux` et `osx`.
- **Écartés.** AppImage (≈ 1 Go, Linux seul) ; Nix (droits d'administrateur sur macOS,
  apprentissage, réempaquetage du WeasyPrint patché, de veraPDF et des modèles).
- **Droits.** Rien ne change sous Windows ; Linux et macOS demandent d'installer Podman une
  fois, puis tout se fait sans droits.
- **Coût.** 1 à 2 semaines pour l'abstraction et Linux, une semaine de plus pour macOS.
  Risque moyen : montages, File Provider.

## 3. Déploiement et mises à jour

- **Déjà portable.** `manifest.json`, les sha256, les VSIX épinglés, `release.yml` (Ubuntu),
  l'image sur GHCR.
- **Ce qui bloque.** `bootstrap.ps1`, `update.ps1`, les tâches planifiées, les ACL de
  `C:\ProgramData`, `wsl --import` par SID, `apps.lock`.
- **Option : la mise à jour devient une fonction du cockpit.**
  - À l'activation, hors compilation : lecture du manifest, toolkit dans un dossier
    utilisateur propre à chaque OS, contrôle sha256, `codium --install-extension`,
    rechargement.
  - Hors Windows, `podman pull …@sha256:`.
  - Les tâches planifiées deviennent facultatives : un timer systemd utilisateur ou un agent
    launchd.
  - La portée par utilisateur règle au passage le risque du toolkit commun inscriptible
    décrit dans [`SECURITE.md`](SECURITE.md).
- **Coût.** 2 à 3 semaines. Risque élevé : c'est le chemin critique de la flotte.

## 4. Raccourcis, `szh://` et identité de barre des tâches

- **Ce qui bloque.** Presque tout ce morceau est Windows : `.lnk` par `wscript.exe` et `hidden.vbs`,
  `HKCU\Software\Classes\szh`, pont COM de l'AppUserModelID.
- **Option.**
  - `vscodium://szh-csps.szh-cockpit/ouvrir?…` par `vscode.window.registerUriHandler` :
    VSCodium enregistre déjà son protocole sur les trois OS. La grammaire de `lib/liens.js` se
    garde, et le fichier d'intention disparaît.
  - Un `BIENVENUE.md` ou un `.url` remplace le `.lnk` de chaque numéro.
  - L'AppUserModelID devient sans objet.
- **Coût.** 3 à 5 jours, risque faible. Les liens `szh://` déjà envoyés par courriel restent
  servis sous Windows pendant la transition.

## 5. OneDrive et SharePoint

- **Déjà portable.** La règle « reconnaître des noms, ne jamais compter des crans »,
  l'ancrage côté JavaScript de `lib/rapport-erreur.js`, `lib/copies-conflit.js` et
  `lib/coedition.js`.
- **Ce qui bloque.**
  - Il n'y a pas de client OneDrive officiel sous Linux (abraunegg/onedrive et rclone, sans
    Files On-Demand, avec leur propre nommage des conflits) ;
  - sous macOS, les racines sont sous `~/Library/CloudStorage/OneDrive-…` (File Provider) ;
  - l'épinglage hors ligne (attributs Windows) et l'inventaire des postes (registre OneDrive).
- **Option.** Les racines candidates de chaque OS dans un seul module d'ancrage ;
  l'épinglage par `fileproviderctl` sur macOS, rien sur Linux ; mesurer le nommage des
  conflits de chaque client ; la co-édition « sans garantie » sous Linux.
- **Coût.** 1 à 2 semaines. Risque élevé sous Linux.

## 6. Le cockpit

- **Ce qui suppose Windows** (une dizaine de modules sur 73) :
  - `lib/wsl.js`, `lib/poste.js`, et les lancements de `wsl.exe` ;
  - `lib/archivage.js` (`wscript.exe`, `archive-revue.ps1`) ;
  - `lib/auteurs-corpus.js` (`powershell.exe`) ;
  - `lib/formatting.js` (presse-papiers HTML par WinForms) ;
  - `lib/vue-articles-hote.js` (`Set-Clipboard`) ;
  - `lib/codes-erreur.js` et `lib/rapport-erreur.js` (`C:\ProgramData`, `USERPROFILE`) ;
  - des textes de `lib/i18n.js` qui nomment l'Explorateur.
- **Option.** Un module des chemins du poste par OS ; l'archivage par `fs.rename` hors
  Windows ; le presse-papiers HTML par l'événement `paste` d'une webview (repli `xclip`,
  `wl-paste`, `osascript`) ; la pièce jointe dégradée en « ouvrir le dossier ».
- **Coût.** 1 à 2 semaines.

## 7. Tests et CI

- **Ce qui bloque.** Trente-cinq fichiers de test lancent PowerShell (jumeaux,
  ancrage, inventaire, épinglage, lanceur), et il n'y a aucun job macOS.
- **Option.** Une matrice ubuntu, windows, macos pour les tests JavaScript, et une fumée
  « moteur Podman » sur l'image GHCR. Les tests jumeaux disparaissent avec les `.ps1` portés.
- **Coût.** 3 à 5 jours.

## 8. Rapports d'erreur, compteurs, inventaire

- **Ce qui bloque.** L'écrivain PowerShell jumeau des rapports (`szh-rapport.ps1` ; celui des
  compteurs est déjà porté par `outils/compteurs-cli.js`), l'inventaire en PowerShell seul (registre, `COMPUTERNAME`, mutex), le
  masquage par `%USERPROFILE%`.
- **Option.** Le cockpit devient le seul écrivain. L'inventaire passe en JavaScript
  (`os.hostname`, `os.userInfo`), et le masquage reconnaît `~`, `/home/…` et `/Users/…`.
- **Coût.** 1 semaine.

## Vue d'ensemble

| Morceau | Portable | Ce qui bloque d'abord | Option | Coût |
|---|---|---|---|---|
| Lanceur | ≈ 35 % | WinForms, `szh-produits.ps1` | WebviewView du cockpit | 3 à 5 sem. |
| Moteur | ≈ 80 % | `wsl.exe`, `/mnt/c` en dur | `moteur.js` : WSL ou `podman exec` | 2 à 3 sem. |
| Déploiement | ≈ 40 % | PowerShell, tâches planifiées, `ProgramData` | mise à jour pilotée par le cockpit, pull par digest | 2 à 3 sem. |
| Raccourcis, protocole | ≈ 5 % | `.lnk`, registre, COM | `registerUriHandler` (`vscodium://`) | 3 à 5 j |
| OneDrive | ≈ 60 % | pas de client Linux, racines macOS | racines par OS ; Linux sans garantie | 1 à 2 sem. |
| Cockpit | ≈ 85 % | une dizaine de modules | chemins par OS, presse-papiers par webview | 1 à 2 sem. |
| Tests, CI | ≈ 70 % | tests jumeaux PowerShell | matrice à trois OS, fumée Podman | 3 à 5 j |
| Rapports, inventaire | ≈ 70 % | écrivains PowerShell, registre | JavaScript seul écrivain | 1 sem. |

Total grossier : 3 à 4 mois pour une personne, dont la moitié pour le lanceur et le
déploiement.

## Ordre recommandé

1. **Abstraire sans rien changer sous Windows** : `poste.js` pour les chemins du poste,
   `moteur.js` (WSL seulement) pour tous les lancements, `registerUriHandler` à côté de
   `szh://`, et les compteurs d'usage écrits par le seul cockpit. Cette étape vaut d'être
   faite même si le projet s'arrête là.
   - Elle n'allège le PowerShell que d'environ 2 % (`szh-compteurs.ps1`). L'ancrage, les
     rapports d'erreur, le courriel et les liens gardent leur version PowerShell, parce que la
     mise à jour et l'entrée par `szh://` tournent sans Node.
   - L'inventaire du poste reste en PowerShell : il doit justement décrire les postes en
     panne.
   - La génération des tâches de compilation par le cockpit est reportée à l'étape 3 : la
     tâche par défaut (Ctrl+E), l'import à l'ouverture et le `tasks.json` copié sur chaque
     poste en dépendent, et rien n'y gagne sous Windows.
2. **Faire entrer le lanceur dans le cockpit**, onglet par onglet : Secrétariat et Journal,
   puis Produits et Nouveau, puis Préprocessing et Réglages. WinForms reste en secours pendant
   la transition.
3. **Podman et Linux** : image par digest, fumée en CI, mise à jour pilotée par le cockpit.
4. **macOS**, seulement s'il y a un vrai poste à servir.

## Ce qu'il ne faut pas faire

- Remplacer la WSL par Docker ou Podman sous Windows.
- Nix, AppImage, ou des installations natives sur macOS.
- Une extension « lanceur » séparée, ou une application Electron ou Tauri.
- Promettre une co-édition OneDrive garantie sous Linux.
- Des tâches planifiées équivalentes sur chaque OS.
- Porter l'AppUserModelID.
- Tout faire d'un bloc.

## Au-delà du poste : les autres architectures envisagées

Examinées le 01.10.2026 avec Robin. Les coûts sont des ordres de grandeur pour une
personne, pas des devis.

### Ce que l'on perd en quittant Windows

On ne perd rien sur le fond : la compilation reste la même image, donc des PDF identiques
et la même conformité PDF/UA, et le cockpit garde toutes ses fonctions. Ce qui se perd tient
au « produit Windows » autour de l'éditeur :

- **l'application distincte**, le lanceur avec son icône et ses entrées de menu, qui
  devient une vue dans VSCodium ;
- **les liens `szh://` déjà envoyés**, servis sous Windows pendant une transition ;
- **la mise à jour silencieuse par tâche planifiée**, qui devient une vérification à
  l'ouverture ;
- **l'installation commune** dans `C:\ProgramData`, qui devient une installation par
  utilisateur ;
- **le geste « joindre le PDF »** ;
- **sous Linux, OneDrive** : pas de client officiel, donc pas de fichiers à la demande ni
  de co-édition garantie.

À cela s'ajoutent la double maintenance pendant la transition et, hors Windows,
l'installation de Podman.

### VS Code dans le navigateur

- **vscode.dev ou github.dev, l'extension tournant dans le navigateur : non.** 47 des 73
  modules du cockpit lisent ou écrivent des fichiers, 10 lancent des processus, et la
  chaîne (pandoc, WeasyPrint, make, veraPDF) ne tourne pas dans un navigateur.
- **code-server ou openvscode-server sur un serveur : faisable.** Le cockpit et la chaîne
  tournent sur le serveur, à partir de la même image OCI, et le poste n'a qu'un
  navigateur. Les préalables sont les étapes 1 et 2 de ce document.

Les choix examinés pour un serveur au bureau :

| Sujet | Choix | Conditions |
|---|---|---|
| Stockage | fichiers sur le serveur, sauvegarde ailleurs (restic ou borg, versionnée et chiffrée, vers un NAS ou un stockage en Suisse) | essai de restauration planifié ; export ou accès pour ceux qui lisent aujourd'hui SharePoint (secrétariat, `_NewsUndActu`, archives, `_Systeme`) |
| Identité | un compte par personne, propre à la plateforme (un conteneur code-server par rédacteur, derrière Caddy ou Authelia) | un compte partagé rendrait la co-édition et les rapports aveugles |
| Hébergement | Docker sur Debian ou Ubuntu LTS minimal, `unattended-upgrades` | HTTPS obligatoire même en réseau local, faute de quoi les webviews ne fonctionnent pas ; un VPN si l'on veut le télétravail |
| Mises à jour | correctifs de l'OS automatiques ; code-server épinglé, monté volontairement deux à trois fois par an ; notre image tirée à chaque release | un responsable désigné, et une procédure écrite et essayée pour remonter le serveur |

### Comparaison des maintenances

| | Flotte Windows (aujourd'hui) | Serveur au bureau |
|---|---|---|
| Code d'infrastructure | ≈ 14 400 lignes de PowerShell, plus les doublons PS/JS et leurs tests | un `docker-compose`, un proxy, des scripts de sauvegarde |
| Travail récurrent | continu, piloté par les incidents de poste (WSL, OneDrive, mises à jour) | quelques heures par trimestre, surtout planifiées |
| Une release | appliquée en silence sur chaque poste, avec un risque par poste | un `docker pull`, avec un retour en arrière immédiat |
| Si l'équipe grandit | le coût monte | le coût est à peu près stable |
| Risque principal | dérive des postes, OneDrive | point unique de panne, sauvegarde |

La flotte coûte plus au quotidien. Le serveur coûte cher une fois, à la transition, puis
peu, à condition qu'il ait un responsable.

### Les options, de la plus légère à la plus lourde

| Option | Principe | Coût | Avis |
|---|---|---|---|
| A. Statu quo amélioré | l'étape 1 seule | 2 à 3 sem. | aucun risque, allège déjà la maintenance |
| B. Client lourd et serveur de compilation | VSCodium reste sur les postes ; la compilation part vers un serveur du bureau (une API devant l'image Docker) au lieu de la WSL | 1 à 2 mois | **meilleur rapport gain/risque** : plus de WSL sur les postes, rien ne change pour la rédaction |
| C. code-server au bureau | tout tourne sur le serveur | 2,5 à 4 mois | plus de flotte du tout ; B en est une marche naturelle |
| D. Webapp sur mesure | un éditeur Markdown (CodeMirror ou Monaco), les formulaires actuels, `lib/` en serveur Node | 6 à 10 mois | seulement si l'interface de VS Code freine la rédaction ; c'est un projet produit, et l'on devient mainteneur d'un éditeur |
| E. Plateforme existante | Kotahi et Ketida (Coko Foundation, Paged.js), Fidus Writer | plusieurs mois | non recommandé : on perd la chaîne (typographie, contrôles, PDF/UA patché, FALC) |
| F. Application Electron ou Tauri | — | — | écartée |

Le capital réutilisable dans tous les cas :

- la chaîne de compilation (image, filtres, maquettes, patchs) ;
- le code métier de `lib/` ;
- les formulaires de `media/`.

La question qui départage les options : est-ce l'interface de VS Code qui gêne la
rédaction (D), ou la maintenance des postes qui pèse (B puis C) ?
