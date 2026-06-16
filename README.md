# SZH/CSPS — Toolchain de publication (VSCodium + WSL, Option A)

Chaîne `.md → Pandoc → WeasyPrint → PDF` pour rédacteurs **non‑techniques**, sous **Windows**,
fichiers sur **OneDrive/SharePoint**, toolchain isolée dans **WSL** (reproductible), **rootfs construit par GitHub Actions**.
Décision et justification : voir `01-strategie-choix-option-A.md` et `02-option-A-fonctionnement.md`.

> Dépôt : `SZH-CSPS/szh-publishing-toolchain`. Il contient l'**outillage** (Containerfile, déploiement,
> config éditeur, template) — **pas les revues**, qui restent sur OneDrive.
> La distro WSL s'appelle **`SZH-Publishing`** (une seule distro‑toolchain, réutilisable pour d'autres
> sorties Pandoc/WeasyPrint) ; le dossier `revue-template/` est un *consommateur* de cette toolchain.

## Arborescence

```
szh-publishing-toolchain/
├── .github/workflows/
│   └── build-rootfs.yml        # CI : build du rootfs -> Release GitHub
├── deploy/                     # outillage
│   ├── Containerfile           # construit le rootfs WSL (= future base bootc)
│   ├── wsl.conf                # /etc/wsl.conf baked (user par défaut, montage /mnt/c)
│   ├── build-rootfs.sh         # build (podman en local / docker en CI) -> .tar + sha256
│   ├── deploy.ps1              # déploiement idempotent par poste (À LANCER EN ADMIN)
│   ├── requirements.txt        # WeasyPrint épinglé
│   └── vsix/VENDOR.md          # quels VSIX vendoriser (anti-GlassWorm)
├── vscodium-user/              # config seedée dans %APPDATA%\VSCodium\User\
│   ├── settings.json           # interface épurée + sécurité + correcteur
│   └── keybindings.json        # Ctrl+E (export), Ctrl+Alt+R (secours aperçu)
└── revue-template/             # copié dans le dossier OneDrive de CHAQUE revue
    ├── revue.code-workspace    # point d'entrée du rédacteur
    ├── .vscode/                # tasks (wsl->make) · settings (build on save) · cspell
    ├── Makefile                # source de vérité du pipeline (LF + tabs)
    ├── dossier.yaml · articles/ · styles/print.css · BIENVENUE.md
    └── .editorconfig
```

## Runbook

### A. Fabriquer la toolchain — automatique via GitHub Actions
Pousser un tag `vX` déclenche `.github/workflows/build-rootfs.yml` : build du `Containerfile`,
export du rootfs, publication en **Release GitHub** (tar + sha256).

```bash
git tag v2026.06.1 && git push origin v2026.06.1
```
(ou onglet **Actions → build-rootfs → Run workflow**, avec la version en entrée.)
Build local éventuel : `cd deploy && ./build-rootfs.sh 2026.06.1`.

### B. Préparer un poste (admin)
1. Dans `deploy/deploy.ps1` : ajuster `$TargetVersion` (= tag sans le `v`) et `$Repo` si besoin.
2. Déposer les `.vsix` dans `deploy/vsix/` (voir `VENDOR.md`).
3. Activer le moteur WSL si absent : `wsl --install --no-distribution` (puis redémarrer).
4. Lancer :
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\deploy\deploy.ps1 -NewRevue "$env:OneDrive\Revues\2026-01"
   ```
   → tire le rootfs depuis la **Release GitHub** (vérif sha256), importe la distro `SZH-Publishing`,
   installe/configure VSCodium, scaffolde la revue, crée le raccourci bureau.
   *Dépôt privé ?* ajouter `-GhToken <PAT lecture>`.
5. Exclusions antivirus : `…\WSL\SZH-Publishing\*.vhdx`, le dossier de staging, et les processus
   `vmcompute.exe`, `vmmem.exe`, `wsl.exe`, `wslservice.exe`.
6. Dans OneDrive : clic droit sur le dossier de la revue → **« Toujours conserver sur cet appareil »**.

### C. Mises à jour de la toolchain
Bumper la version → pousser le tag (`git tag v2026.07.0 && git push --tags`) → Actions republie la Release.
Sur les postes : bumper `$TargetVersion` dans `deploy.ps1`, relancer → `deploy.ps1` détecte le décalage
de `/etc/szh-publishing-version` et **détruit + réimporte** la distro — sans risque, **aucune donnée n'y vit**.

## Flux rédacteur (0 technique)
Double‑clic sur **« Revue SZH »** → écrit → **Ctrl+S** → le PDF se régénère à droite. Rien d'autre.

## Options & décisions
- **Langue de l'interface** : anglais par défaut (seule option à jour/propre sur VSCodium ; quasi invisible
  vu l'UI épurée). FR figé (mai 2021) : vendoriser `MS-CEINTL.vscode-language-pack-fr` + `"locale": "fr"`
  dans `%APPDATA%\VSCodium\argv.json`. FR à jour : reconstruire `vscode-loc` (MIT) en interne.
- **Correction FR/DE/EN** : pleinement supportée ; bascule par suffixe de fichier (`.de.md`, `.fr.md`).
- **Aperçu PDF natif** (tomoki1207.pdf 1.2.2) : à valider à l'usage ; secours `Ctrl+Alt+R`. Repli : SumatraPDF.
- **Workspace Trust désactivé** (machine dédiée) pour permettre le build auto sans pop‑up — compromis assumé.

## Points de vigilance
- **Aperçu** : la génération du PDF est fiable ; seul le *rafraîchissement auto du volet* peut être capricieux.
- **Dossier projet léger** : éviter d'y entasser des binaires (scan via 9P au build).
- **`inotify` ne traverse pas `/mnt/c`** : ne jamais bâtir une amélioration sur `pandoc --watch` lisant `/mnt/c`.
- **Migration Silverblue** : `Makefile`, config et `Containerfile` ne bougent pas ; on remplacera WSL par l'OS natif.
