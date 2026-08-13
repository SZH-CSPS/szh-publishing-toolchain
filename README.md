# SZH/CSPS — Toolchain de publication (VSCodium + WSL)

Chaîne `.md → Pandoc → WeasyPrint → PDF` pour rédacteurs **non‑techniques**, sous **Windows**,
fichiers sur **OneDrive/SharePoint**, toolchain isolée dans **WSL** (reproductible), **rootfs et
outillage construits par GitHub Actions** et **auto‑déployés en silence** sur les postes.

> Ce dépôt contient l'**outillage** — **pas les revues**, qui vivent sur OneDrive.
> La distro WSL s'appelle **`SZH-Publishing`** (une seule distro‑toolchain, réutilisable).
> Décisions d'architecture et plan : voir [`PLANIFICATION.md`](PLANIFICATION.md).

## Principes

- **Une source de vérité par élément, zéro copie par revue.** Le pipeline (Makefile, styles) et la
  config éditeur vivent dans le *toolkit* (`C:\ProgramData\SZH\toolkit`), pas dans les dossiers de revue.
  Corriger un style ou un bug = **une release**, pas N dossiers à retoucher.
- **Mise à jour silencieuse, sans administrateur.** Une tâche planifiée vérifie chaque jour un petit
  `manifest.json` (~1 Ko) ; elle ne télécharge que ce qui a changé et n'affiche une fenêtre que s'il y a
  vraiment une mise à jour. Le gros rootfs (centaines de Mo, en `.tar.gz`) n'est retiré que lors d'un
  changement de toolchain — jamais pour une simple retouche de maquette.
- **Dossier de revue épuré.** Le rédacteur ne voit que son contenu (articles, métadonnées, PDF).
- **Reproductible et épinglé.** Rootfs vérifié par sha256, dépendances Python figées (pins transitifs),
  extensions VSCodium épinglées + empreintes vérifiées (anti‑GlassWorm).

## Arborescence du dépôt

```
szh-publishing-toolchain/
├── .github/workflows/
│   └── release.yml           # CI : toolkit.zip + manifest.json à chaque tag ;
│                             #      rootfs reconstruit seulement si image/ a changé ; push GHCR
├── image/                    # rootfs WSL — change rarement
│   ├── Containerfile         # Debian + Pandoc + WeasyPrint (venv, pins transitifs) — base bootc future
│   ├── requirements.txt      # environnement WeasyPrint figé (pip freeze)
│   ├── wsl.conf              # /etc/wsl.conf baked (user par défaut, montage /mnt/c)
│   └── build-rootfs.sh       # build (podman en local / docker en CI) -> .tar.gz + sha256
├── pipeline/                 # → C:\ProgramData\SZH\toolkit\pipeline\  (consommé par WSL)
│   ├── Makefile              # source de vérité du pipeline (cibles all / pdf / import / clean)
│   └── styles/print.css      # maquette (CSS Paged Media) + classes des blocs :::
├── windows/                  # → C:\ProgramData\SZH\toolkit\windows\
│   ├── bootstrap.ps1         # ADMIN, 1× par poste (WSL, winget, ACL, tâches planifiées)
│   ├── update-launcher.ps1   # check silencieux (tâche planifiée) — s'auto‑met à jour
│   ├── update.ps1            # mise à jour visible et rassurante, sans admin
│   ├── new-revue.ps1         # crée une revue + raccourci « Ouvrir la revue »
│   ├── open-revue.ps1        # lanceur « Revues SZH » (menu Démarrer)
│   ├── szh-common.ps1        # socle commun (manifest, téléchargement, UI, e-mail support)
│   ├── hidden.vbs            # lance une commande sans fenêtre
│   └── vsix.lock             # extensions épinglées (id + version + sha256)
├── vscodium-user/            # → %APPDATA%\VSCodium\User\  (seedé par update.ps1)
│   ├── settings.json · keybindings.json · tasks.json
│   └── snippets/markdown.json # blocs de style :::
├── vscodium-extension/       # extensions maison — VSIX packagés par la CI, sha256 -> manifest.json
│   ├── szh-apercu/           #   (D24) aperçu PDF auto en vue scindée après compilation
│   └── szh-cockpit/          #   (D36) barre latérale « Revue SZH » (articles, Word, PDF)
└── revue-template/           # copié dans le dossier OneDrive de CHAQUE revue (contenu seul)
    ├── BIENVENUE.md · ausgabe.yaml
    ├── articles/             # les .md de la revue
    └── articles-word/        # dépôt des Word/LibreOffice à convertir
```

## Runbook

### A. Fabriquer / publier une version — GitHub Actions
Pousser un tag `vX` déclenche [`release.yml`](.github/workflows/release.yml) :

```bash
git tag v2026.07.0 && git push origin v2026.07.0
```

La CI publie une **Release** avec `manifest.json`, `toolkit-X.zip` et les VSIX épinglés. Le **rootfs**
n'est reconstruit **que si `image/` a changé** depuis la release précédente (sinon le manifest réutilise
le rootfs existant) — une retouche de styles produit donc une release de quelques Ko. Reconstruction
forcée : onglet **Actions → release → Run workflow**, case *force_rootfs*.

### B. Préparer un poste — une seule fois, en administrateur
1. Cloner ce dépôt (ou récupérer le dossier `windows/`).
2. Déposer les `.vsix` listés dans [`windows/vsix.lock`](windows/vsix.lock) — ou laisser la CI les publier.
3. Lancer :
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\windows\bootstrap.ps1
   ```
   → active le moteur WSL, installe VSCodium + SumatraPDF (winget), donne aux Utilisateurs le droit
   d'écrire dans `C:\ProgramData\SZH` (pour les MAJ sans admin), crée les tâches planifiées
   (**mise à jour** à la connexion + 11h00, **préchauffage WSL** à la connexion) et lance la première
   mise à jour. Si WSL était absent : **redémarrer** puis relancer `bootstrap.ps1`.
4. Exclusions antivirus : `…\SZH\WSL\*.vhdx`, le dossier `…\SZH\staging`, et les processus
   `vmcompute.exe`, `vmmem.exe`, `wsl.exe`, `wslservice.exe`.

Ensuite, **plus besoin d'administrateur** : les postes se mettent à jour seuls. (Seul le bump de
VSCodium/SumatraPDF reste manuel — voir V2 dans `PLANIFICATION.md`.)

### C. Créer une revue
```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\SZH\toolkit\windows\new-revue.ps1" -Dossier "$env:OneDrive\Revues\2026-01"
```
→ copie le template, crée « Ouvrir la revue.lnk » dans le dossier, enregistre la revue pour le lanceur
« Revues SZH » du menu Démarrer. Puis, dans OneDrive : clic droit sur le dossier →
**« Toujours conserver sur cet appareil »**.

### D. Mises à jour de la toolchain
Bumper la version → pousser le tag → la CI republie la Release. Les postes détectent le nouveau
`manifest.json` et appliquent ce qui a changé, en silence. Revenir en arrière sur un poste :
`update.ps1 -Version <X>` (l'archive N‑1 est conservée en staging).

## Flux rédacteur (0 technique)
1. Déposer les articles Word/LibreOffice **finalisés** dans le dossier **`articles-word`**.
2. Ouvrir la revue (**« Ouvrir la revue »** dans le dossier, ou **« Revues SZH »** dans le menu Démarrer).
3. Les Word sont convertis en Markdown dans **`articles`** (images récupérées, originaux archivés).
4. Écrire, puis **Ctrl + S** → chaque article est régénéré dans `out/<article>/` (PDF + HTML),
   en intégrant au passage tout nouveau Word déposé.

La barre latérale **« Revue SZH »** (extension `szh-cockpit`) rassemble ces gestes sans
explorateur : sections *Articles* / *Word en attente (n)*, boutons **➕ Importer**,
**▶▶ Convertir les Word en attente**, **👁 Ouvrir le PDF**, **▷ Compiler**. Voir
[`userdoc.md`](userdoc.md).

### Raccourcis clavier (déployés par `vscodium-user/keybindings.json` + extensions épinglées)

| Raccourci | Effet | Fourni par |
|---|---|---|
| `Ctrl+S` | Enregistrer → import des Word déposés + régénération des PDF (`make all`) | triggertaskonsave + tâche user |
| `Ctrl+B` / `Ctrl+I` | Gras / italique (fichiers markdown) | markdown-all-in-one |
| `Entrée` (dans une liste) | Continuation automatique de la liste | markdown-all-in-one |
| `Tab` / `Maj+Tab` (dans un tableau) | Cellule suivante/précédente + formatage auto | markdowntable |
| `Maj+Alt+V` | Coller un tableau copié depuis Excel/Word | excel-to-markdown-table |
| `Ctrl+Alt+S` | Insérer un bloc de style `:::` (snippets de la maquette) | keybindings + snippets |
| `Ctrl+Espace` | Suggestions (snippets `:::`) | VS Code (réactivé scope markdown) |
| `Ctrl+Alt+I` | Importer les Word à la demande (`make import`) | keybindings + tâche user |
| `Ctrl+E` / `Ctrl+Maj+B` | Relancer la compilation | keybindings / build par défaut |
| `Ctrl+Alt+R` | Secours : recharger la fenêtre (aperçu figé) | keybindings |

## Options & décisions
- **Langue de l'interface** : anglais par défaut (seule option à jour/propre sur VSCodium ; quasi invisible
  vu l'UI épurée). FR figé (mai 2021) : vendoriser `MS-CEINTL.vscode-language-pack-fr` + `"locale": "fr"`
  dans `%APPDATA%\VSCodium\argv.json`. FR à jour : reconstruire `vscode-loc` (MIT) en interne.
- **Correction FR/DE/EN** : bascule par suffixe de fichier (`.de.md`, `.fr.md`, `.en.md`).
- **Aperçu PDF** (tomoki1207.pdf) : reload auto natif ; secours `Ctrl+Alt+R`. Repli : **SumatraPDF**
  (open source, ne verrouille pas le PDF, recharge auto), installé par `bootstrap.ps1`.
- **Workspace Trust désactivé** (machine dédiée) pour permettre le build auto sans pop‑up — compromis assumé.

## Points de vigilance
- **Config au niveau utilisateur (V1)** : les tâches, réglages et snippets sont déployés dans
  `%APPDATA%\VSCodium\User\`. Le build à la sauvegarde couvre aussi l'import des Word (`make all`), donc
  l'ouverture d'une revue n'a pas besoin de `runOn:folderOpen`. Si un poste montrait un souci de tâche
  utilisateur, repli documenté : un mini `.vscode/tasks.json` dans le template, masqué via `files.exclude`.
- **`deploy.ps1` supprimé** : remplacé par `bootstrap.ps1` / `update.ps1` / `new-revue.ps1`.
- **`inotify` ne traverse pas `/mnt/c`** : ne jamais bâtir une amélioration sur `pandoc --watch` lisant `/mnt/c`.
- **Scripts `.ps1` compatibles Windows PowerShell 5.1** : proscrire `?.`, `??`, `?:`, `&&`/`||`.
- **Polices** : `fonts-noto` est le plus gros poste du rootfs ; cible = embarquer Open Sans (D7, `PLANIFICATION.md` §6).
- **macOS** : ~80 % du système est agnostique (image OCI poussée sur GHCR, pipeline, config) ;
  portage estimé 2–4 j si des Mac entrent dans la flotte (`PLANIFICATION.md` §6).
- **Migration Silverblue** : `Makefile`, config et `Containerfile` ne bougent pas ; on remplacera WSL par l'OS natif.
