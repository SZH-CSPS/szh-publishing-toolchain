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
- **Gain.** Les jumeaux PowerShell/JavaScript disparaissent (ancrage, rapports, compteurs,
  courriel, liens), avec leurs tests de parité.
- **Coût.** 3 à 5 semaines. Risque moyen : mode simulé, mutex, sélecteur de version.

## 2. Le moteur (WSL et make)

- **Déjà portable.** L'image OCI (GHCR), le pipeline, pur Linux, que la CI fait déjà
  tourner sur un Ubuntu nu.
- **Ce qui bloque.**
  - `wsl.exe` écrit en dur dans `vscodium-user/tasks.json` (8 tâches), dans `extension.js`
    et dans `lib/cmyk.js`, `lib/portraits.js`, `lib/wsl.js`, et par lui
    `lib/pagination-hote.js` et `lib/pdfua-hote.js` ;
  - la conversion en `/mnt/c` de `lib/chemins-poste.js` ;
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
  - `lib/wsl.js`, `lib/chemins-poste.js`, et les lancements de `wsl.exe` ;
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

- **Ce qui bloque.** Les écrivains PowerShell jumeaux (`szh-rapport.ps1`,
  `szh-compteurs.ps1`), l'inventaire en PowerShell seul (registre, `COMPUTERNAME`, mutex), le
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

1. **Abstraire sans rien changer sous Windows** : chemins du poste et `moteur.js` (WSL
   seulement), tâches générées par le cockpit, `registerUriHandler` à côté de `szh://`,
   ancrage et inventaire en JavaScript. Cette étape vaut d'être faite même si le projet
   s'arrête là.
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
