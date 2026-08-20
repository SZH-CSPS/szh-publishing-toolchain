# SZH/CSPS — Toolchain de publication (VSCodium + WSL)

Chaîne `.md → Pandoc → WeasyPrint → PDF` pour rédacteurs **non‑techniques**, sous **Windows**,
fichiers sur **OneDrive/SharePoint**, toolchain isolée dans **WSL** (reproductible), **rootfs et
outillage construits par GitHub Actions** et **auto‑déployés en silence** sur les postes.

> Ce dépôt contient l'**outillage** — **pas les revues**, qui vivent sur OneDrive.
> La distro WSL s'appelle **`SZH-Publishing`** (une seule distro‑toolchain, réutilisable).
>
> **Documentation** : vue globale [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · maintenance WSL
> [`docs/MAINTENANCE-WSL.md`](docs/MAINTENANCE-WSL.md) · sécurité & flotte [`docs/SECURITE.md`](docs/SECURITE.md).
> Décisions & plan : [`PLANIFICATION.md`](PLANIFICATION.md).

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
│   ├── new-revue.ps1         # crée une revue + raccourci « Ouvrir la revue » + estampille de version
│   ├── open-revue.ps1        # lanceur (menu Démarrer) — 2 listes, version du logiciel,
│                             #   -Produit revue|zeitschrift (D124), liens szh:// (D123)
│   ├── archive-revue.ps1     # déplace une revue « en cours » <-> archives (D116) ; seul détenteur des chemins
│   ├── szh-common.ps1        # socle commun (manifest, téléchargement, UI, e-mail support)
│   ├── hidden.vbs            # lance une commande sans fenêtre
│   └── vsix.lock             # extensions épinglées (id + version + sha256)
├── vscodium-user/            # → %APPDATA%\VSCodium\User\  (seedé par update.ps1)
│   ├── settings.json · keybindings.json · tasks.json
│   └── snippets/markdown.json # blocs de style :::
├── vscodium-extension/       # extensions maison — VSIX packagés par la CI, sha256 -> manifest.json
│   ├── szh-apercu/           #   (D24) aperçu PDF auto en vue scindée après compilation
│   └── szh-cockpit/          #   (D36) barre latérale « Revue SZH » (articles, Word, PDF, méta-données,
│                             #         images, suivi des traductions D113)
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
→ copie le template, **estampille `version-toolkit`** (D120), crée « Ouvrir la revue.lnk » dans le
dossier, enregistre la revue pour le lanceur « Revues SZH » du menu Démarrer. Puis, dans OneDrive :
clic droit sur le dossier → **« Toujours conserver sur cet appareil »**.

**Emplacements des revues (D116/D119)** — connus d'un seul endroit, `Get-SzhEmplacements`
(`windows/szh-common.ps1`) ; l'extension n'en calcule aucun (elle délègue à `archive-revue.ps1`).
Base de production `%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte`, base de test
`%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING` (les deux surchargeables par `config.json`,
clé `basesRevues`) ; **mêmes sous-dossiers** dans les deux cas :

| | Revue (fr) | Zeitschrift (de) |
|---|---|---|
| en cours | `52_Revue\RV02_Redaction` | `53_Zeitschrift\ZS02_Redaktion` |
| archives | `52_Revue\RV99_Archives` | `53_Zeitschrift\ZS99_Archives` |

Le **mode développeur** (`devMode` dans `config.json`, **vrai par défaut**, bascule dans
« Réglages SZH ») choisit la base ; l'arborescence de test est créée à la demande par le lanceur,
celle de production jamais (elle vient de SharePoint).

### C bis. Cycle de vie d'un numéro (D116/D117)
`locked` et `archived` dans `ausgabe.yaml` sont la **source de vérité** ; tout le reste en découle.
Le panneau d'export (`Ctrl+Alt+D`) porte les trois gestes — *Archiver et verrouiller*,
*Déverrouiller*, *Désarchiver*. Verrouillé : `files.readonlyInclude` au scope workspace
(`<revue>/.vscode/settings.json`, supprimé au déverrouillage) + toutes les commandes d'écriture
refusées. Archivé (ou verrouillé) : **plus aucune compilation automatique**, l'export se demande
(*Exporter cet article*, *Recompiler toute la revue*). L'archivage supprime `out/` (gain chiffré
dans la confirmation) puis `archive-revue.ps1` déplace le dossier, réécrit le `.lnk` et rouvre
l'éditeur.

### C quater. Liens de traduction et second lanceur (D123/D124)
« Envoyer pour traduction » (panneau de traduction, et section « Traductions » de la barre) copie
un lien `szh://traduction/<produit>/<numero>[/<article>]` et ouvre un brouillon d'e-mail. Le schéma
`szh:` est enregistré dans **HKCU** par `update.ps1` (sans admin) et pointe sur
`open-revue.ps1 "%1"` via `hidden.vbs`. Le lanceur **revalide** la grammaire (`Get-SzhLien`),
retrouve le dossier dans les seuls emplacements connus, dépose une **intention à usage unique**
(`%LOCALAPPDATA%\SZH\intention.json`, périmée à 5 min) et ouvre la revue ; le cockpit consomme
l'intention à l'activation et ouvre le panneau. Le lien ne contient jamais de chemin.

Le menu Démarrer porte deux entrées : **« Revues SZH »** (tout) et **« Zeitschriften SZH »**
(`-Produit zeitschrift`) — le même script, filtré sur le jeton `revue:` d'`ausgabe.yaml`.

### C ter. Réinstaller une version précédente (D120)
`update.ps1 -Version X` fait déjà tout (l'archive N‑1 est en staging). Le geste est atteignable
sans ligne de commande : lanceur **« Revues SZH » → « Version du logiciel… »**, ou le bouton
**« Changer de version… »** de l'avertissement de divergence du cockpit — les deux ouvrent le même
sélecteur (`open-revue.ps1 -Versions`). Volontairement **manuel et visible** : l'opération remplace
le rootfs WSL et les extensions, et demande un redémarrage de l'éditeur.

### D. Mises à jour de la toolchain
Bumper la version → pousser le tag → la CI republie la Release. Les postes détectent le nouveau
`manifest.json` et appliquent ce qui a changé, en silence. Revenir en arrière sur un poste :
`update.ps1 -Version <X>` (l'archive N‑1 est conservée en staging).

## Flux rédacteur (0 technique)
1. Déposer les articles Word/LibreOffice **finalisés** dans le dossier **`articles-word`**.
2. Ouvrir la revue (**« Ouvrir la revue »** dans le dossier, ou **« Revues SZH »** dans le menu Démarrer).
3. Les Word sont convertis en Markdown dans **`articles`** (images récupérées, métadonnées
   pré-détectées, Word source retiré une fois converti — D39).
4. Écrire, puis **Ctrl + S** → chaque article est régénéré dans `out/<article>/` (PDF + HTML),
   en intégrant au passage tout nouveau Word déposé.

La barre latérale **« Revue SZH »** (extension `szh-cockpit`, titre = numéro en cours, D43)
rassemble ces gestes sans explorateur : **un clic sur un article** ouvre le texte, compile
si besoin et affiche l'aperçu (D46) ; sections *Articles* / *Word en attente (n)* /
*Traductions (finalisés/total)* ; en barre
de titre, **trois boutons = trois panneaux** (QuickPick) : **🚀 Commande** (`Ctrl+Alt+A` —
➕ Importer des Word, ▶▶ Convertir les Word en attente, ⚙ Méta-données du numéro : formulaire
→ `ausgabe.yaml`, ☰ Métadonnées des articles : fiche cachée `<slug>.meta.yaml`, D49/D51 —
type traduit, titre/sous-titre/mots-clés FR/DE + IT à la demande, auteurs structurés, DOI —
🌐 Traductions, D113, et ⚙ Réglages SZH : thème, zoom, police, **aperçu par défaut HTML/PDF**, langue),
**✏ Édition** (`Ctrl+Alt+S` — bascule d'aperçu `Ctrl+Alt+P` + palette de mise en forme) et
**⬆ Export** (`Ctrl+Alt+D` — rebuild forcé, D44 ; **export XML natif OJS**, D93 : un seul
fichier avec galleys PDF+HTML+DOCX en base64, prêt pour l'import OJS ; **cycle de vie du
numéro**, D116/D117 : *Archiver et verrouiller* / *Déverrouiller* / *Désarchiver*, et
*Exporter cet article* quand le numéro est gelé). Le
bouton ⟳ Rafraîchir a quitté la barre (la vue se rafraîchit seule ; la commande reste via
Ctrl+Maj+P). Les `.docx` peuvent être **glissés-déposés directement sur la vue** (D94) ;
après conversion, le panneau **« Vérification de l'import »** s'ouvre : métadonnées
détectées à relire (badges), **photos d'auteur·e·s** (traitement local WSL : recadrage
visage + détourage + N&B 400×400, D91) et remplacement des images par leurs originaux.
Le formulaire auteurs porte prénom, nom, fonction, affiliation, ORCID, e-mail et photo
(D95) ; le PDF/HTML gagne un bloc « À propos des auteur·e·s » (D92). Au survol d'un
article : **🗑 Supprimer
l'article** (confirmation) ; par article déplié : **images** (dimensions + poids) et
**tableaux** (`tables/*.html`, rendus par `docx-tables.py` à l'import — **fusions
colspan/rowspan préservées**, D50 — et ré-injectés à la compilation, D47), chacun avec
**Remplacer** à nom conservé. Après conversion réussie, le `.docx` source
est **supprimé** d'`articles-word/` (D39) ; un « déjà converti » y reste (⚠). Les médias
vivent à un seul niveau `media/` (D45). La VM WSL est maintenue prête tant qu'une revue est
ouverte (D42). « **Nouvelle revue…** » se crée depuis le lanceur **Revues SZH** du menu
Démarrer (D38).

La section **Traductions** (D113) donne le coup d'œil : un article par ligne, dépliable sur ses
**champs bilingues** (titre, sous-titre, résumé, mots-clés × langue cible), chacun annoncé
*traduit / à traduire* et porteur d'un état — **pas prêt → prêt pour traduction → prêt pour
relecture → traduction finalisée**. Le bouton ✓✓ de la section lance la campagne sur toute la
revue (sans jamais faire reculer un champ déjà avancé). Un clic ouvre le **panneau de
traduction** : texte source à gauche en lecture seule (bouton *Copier*), traduction à saisir,
état, un bouton par état pour **tout l'article en un clic**, et une zone **« Question /
commentaire »** (💬 dans l'arbre) — avec l'aperçu de l'article en colonne 2. Les traductions
sont enregistrées dans `<slug>.meta.yaml` et partent telles quelles vers OJS ; les états et le
commentaire vivent dans un sidecar `<slug>.traduction.yaml`, **jamais publié**, invisible du
pipeline. Voir [`userdoc.md`](userdoc.md).

### Raccourcis clavier (déployés par `vscodium-user/keybindings.json` + extensions épinglées)

| Raccourci | Effet | Fourni par |
|---|---|---|
| `Ctrl+S` | Enregistrer → import des Word déposés + régénération des PDF (`make all`) | triggertaskonsave + tâche user |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Gras / italique / souligné (aussi **clic droit → « Mise en forme »**) | szh-cockpit (M6, D55) |
| `Ctrl+Alt+1` / `Ctrl+Alt+2` / `Ctrl+Alt+3` | Titre 1 / 2 / 3 | szh-cockpit (M6, D55) |
| `Ctrl+Alt+W` / `Ctrl+Alt+H` / `Ctrl+Alt+Q` | Bloc Important / Mise en évidence / Question | szh-cockpit (M6, D55) |
| `Ctrl+Alt+C` | Citation (blockquote) | szh-cockpit (M6, D55) |
| `Ctrl+Alt+F` / `Ctrl+Alt+T` | Insérer une figure / un tableau | szh-cockpit (M6, D55) |
| `Entrée` (dans une liste) | Continuation automatique de la liste | markdown-all-in-one |
| `Tab` / `Maj+Tab` (dans un tableau) | Cellule suivante/précédente + formatage auto | markdowntable |
| `Ctrl+Alt+V` | Coller un tableau depuis Excel/Word (**fusions préservées**) | szh-cockpit (D81) |
| `Ctrl+Alt+Entrée` | Insérer un saut de page (**PDF seulement**) | szh-cockpit (D86) |
| `Ctrl+Alt+A` | Panneau de **commande** (import, conversion, métadonnées, réglages) | szh-cockpit |
| `Ctrl+Alt+S` | Panneau d'**édition** (bascule d'aperçu + toute la mise en forme) | szh-cockpit |
| `Ctrl+Alt+D` | Panneau d'**export** (rebuild complet ; export XML natif OJS ; archiver / verrouiller / désarchiver ; exporter un article) | szh-cockpit |
| `Ctrl+Alt+P` | Basculer l'aperçu HTML ⇄ PDF | szh-cockpit |
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
- **Un dossier de revue ne peut pas se déplacer lui-même** : Windows refuse de renommer un dossier
  qu'une application tient ouvert. L'archivage passe donc par `archive-revue.ps1`, lancé **détaché**
  juste avant que la fenêtre ne se ferme (retentatives 120 s), qui réécrit ensuite
  « Ouvrir la revue.lnk » — il porte le chemin **absolu**.
- **`<revue>/.vscode/settings.json`** est la SEULE entorse à D8, et seulement sur un numéro
  verrouillé : c'est ce qui fait voyager la lecture seule avec le dossier et survivre à
  `update.ps1` (qui réécrit `settings.json` au niveau utilisateur). Masqué par `files.exclude`,
  supprimé au déverrouillage.
- **L'avertissement de version s'accroche à `onDidStartTask`**, pas aux fonctions du cockpit : le
  chemin de compilation le plus fréquent (`Ctrl+S` → `triggerTaskOnSave`, extension tierce) ne
  passe pas par nous.
- **Un lien `szh://` vient de l'extérieur** : il ne porte aucun chemin, sa grammaire est revalidée
  côté lanceur, et le dossier n'est cherché que dans les emplacements connus du poste. Ne jamais
  construire un chemin sur un segment reçu sans repasser par `Get-SzhLien` / `Find-SzhRevue`.
- **`hidden.vbs` requote chacun de ses arguments** : vérifié, `powershell.exe -File script.ps1
  "-Produit" "zeitschrift"` et un `"%1"` requoté se lient correctement (paramètre nommé, switch et
  positionnel). C'est ce qui permet aux deux raccourcis et au protocole de passer par lui.
- **`inotify` ne traverse pas `/mnt/c`** : ne jamais bâtir une amélioration sur `pandoc --watch` lisant `/mnt/c`.
- **Scripts `.ps1` compatibles Windows PowerShell 5.1** : proscrire `?.`, `??`, `?:`, `&&`/`||`.
- **Polices** : `fonts-noto` est le plus gros poste du rootfs ; cible = embarquer Open Sans (D7, `PLANIFICATION.md` §6).
- **macOS** : ~80 % du système est agnostique (image OCI poussée sur GHCR, pipeline, config) ;
  portage estimé 2–4 j si des Mac entrent dans la flotte (`PLANIFICATION.md` §6).
- **Migration Silverblue** : `Makefile`, config et `Containerfile` ne bougent pas ; on remplacera WSL par l'OS natif.
