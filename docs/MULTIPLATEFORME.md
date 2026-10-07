# Pronto sous Linux et macOS

Pronto ne tourne aujourd'hui que sous Windows. Cette page dit, partie par partie, ce qui
suppose Windows et ce qu'il faudrait refaire pour Linux et macOS. Les durées sont des ordres
de grandeur pour une personne.

## Ce qui est déjà portable

- **La compilation.** `pipeline/` (make, pandoc, Lua, Python) est du pur Linux. Le Makefile
  ne contient aucun chemin Windows, et la CI le fait tourner sur un Ubuntu nu.
- **L'image.** L'environnement Linux est une image OCI construite par `image/` et publiée
  sur GHCR ; elle donne les mêmes PDF partout.
- **L'essentiel du cockpit.** La plupart des 93 modules de `lib/` n'appellent pas Windows.
- **Deux points d'entrée uniques.** Tous les lancements de la WSL passent par
  `lib/moteur.js`, et tous les chemins propres au poste Windows par `lib/poste.js`.
- **Les liens.** Le cockpit accepte les liens `vscodium://szh-csps.szh-cockpit/…` à côté de
  `szh://` (`registerUriHandler` dans `extension.js`). VSCodium enregistre son protocole sur
  les trois systèmes.
- **Les compteurs d'usage** n'ont qu'un écrivain, le cockpit (`lib/compteurs.js`).

## Ce qui suppose Windows

`windows/` compte environ 10 000 lignes de PowerShell.

| Partie | Ce qui suppose Windows | Ce qu'il faudrait faire | Durée |
|---|---|---|---|
| Moteur | `lib/moteur.js` ne connaît que la WSL ; les 8 tâches de `vscodium-user/tasks.json` écrivent `wsl.exe` et `/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile` en dur | une seconde implémentation de `moteur.js` : Podman sans droits d'administrateur, un conteneur de longue durée sur la même image épinglée par digest, et `podman exec` à chaque appel ; des tâches générées par le cockpit, ou des variantes `linux` et `osx` dans `tasks.json` | 1 à 2 semaines ; 1 de plus pour macOS |
| Démarrage et création | `open-revue.ps1` (le raccourci « Pronto » et les tâches de démarrage), `szh-produits.ps1`, `szh-textes.ps1`, `new-revue.ps1` et `new-livre.ps1` (appelés par `lib/accueil-nouveau.js`), `szh-versions.ps1` (la fenêtre « Changer de version… », en WinForms) | porter ces scripts en JavaScript dans le cockpit, qui porte déjà l'Accueil | 2 à 3 semaines |
| Déploiement et mises à jour | `bootstrap.ps1`, `update.ps1`, `update-launcher.ps1`, la tâche planifiée (`szh-taches.ps1`), les droits sur `C:\ProgramData`, `wsl --import`, `apps.lock` | la mise à jour pilotée par le cockpit à l'ouverture : lecture de `manifest.json`, toolkit dans un dossier de l'utilisateur, contrôle sha256, `codium --install-extension`, `podman pull` par digest | 2 à 3 semaines ; c'est la partie la plus risquée |
| Raccourcis et identité | les `.lnk` créés par `wscript.exe` et `hidden.vbs`, le protocole `szh://` dans `HKCU\Software\Classes\szh`, l'AppUserModelID (`szh-shell.ps1`) | émettre des liens `vscodium://` ; un `BIENVENUE.md` à la place du `.lnk` de chaque numéro ; l'AppUserModelID n'a pas d'équivalent à porter | 3 à 5 jours |
| OneDrive et SharePoint | l'ancrage (`szh-ancrage.ps1`, appelé par `lib/auteurs-corpus.js`), l'épinglage hors ligne (`szh-epinglage.ps1`) | les racines possibles de chaque système dans un seul module ; sous macOS, `~/Library/CloudStorage/OneDrive-…` et l'épinglage par `fileproviderctl` ; sous Linux, il n'existe pas de client OneDrive officiel, donc ni fichiers à la demande ni co-édition garantie | 1 à 2 semaines |
| Cockpit | `lib/archivage.js` (`wscript.exe`), `lib/auteurs-corpus.js` et `lib/accueil-nouveau.js` (`powershell.exe`), `lib/formatting.js` (presse-papiers HTML par WinForms), `lib/vue-articles-hote.js` (`Set-Clipboard` pour joindre un PDF), `lib/codes-erreur.js` et `lib/rapport-erreur.js` (`C:\ProgramData`, `%USERPROFILE%`), des textes de `lib/i18n.js` qui nomment l'Explorateur | l'archivage par `fs.rename` ; le presse-papiers HTML par l'événement `paste` d'une webview ; « joindre le PDF » remplacé par « ouvrir le dossier » ; le masquage des chemins étendu à `~`, `/home/…` et `/Users/…` | 1 à 2 semaines |
| Rapports d'erreur et inventaire | `szh-rapport.ps1` (écrivain PowerShell des rapports), `szh-checkin.ps1` (inventaire des postes : registre, `COMPUTERNAME`) | le cockpit seul écrivain ; l'inventaire en JavaScript (`os.hostname`, `os.userInfo`) | 1 semaine |
| Tests et CI | une cinquantaine de fichiers de `test/js/` font appel à PowerShell ; la CI n'a pas de job macOS | une matrice ubuntu, windows, macos pour les tests JavaScript, et un test de fumée du moteur Podman sur l'image GHCR | 3 à 5 jours |

La mise à jour, l'ancrage, les rapports d'erreur et l'inventaire doivent garder une version
PowerShell tant que Windows est servi : ils tournent quand Node ou VSCodium manquent, et
l'inventaire décrit justement les postes en panne.

## Ordre de travail

1. **Podman sous Linux** : seconde implémentation de `moteur.js`, image par digest, test de
   fumée en CI, mise à jour pilotée par le cockpit.
2. **Le reste du poste** : démarrage, raccourcis, OneDrive, modules du cockpit.
3. **macOS**, seulement s'il y a un poste à servir. Podman y tourne dans une VM (Podman
   machine ou Colima) : démarrage à froid de plusieurs secondes et montages plus lents.

## Ce qu'on ne fait pas

- Remplacer la WSL par Docker ou Podman sous Windows : Docker Desktop tourne dans la même VM
  WSL2, sans gain, et demande des droits d'administrateur.
- Nix, AppImage, ou une installation native sur macOS.
- Une extension « lanceur » séparée, ou une application Electron ou Tauri.
- Porter l'AppUserModelID, ou recréer les tâches planifiées sur chaque système.
