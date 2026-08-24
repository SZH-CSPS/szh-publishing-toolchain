# SZH/CSPS — chaîne de publication (VSCodium + WSL)

Chaîne `.md → Pandoc → WeasyPrint → PDF` pour des rédacteurs non techniciens, sous Windows,
avec les fichiers sur OneDrive et la toolchain isolée dans WSL. Le rootfs et l'outillage sont
construits par GitHub Actions et déployés en silence sur les postes.

Ce dépôt contient l'**outillage**, pas les revues : celles-ci vivent sur OneDrive. La distro
WSL s'appelle `SZH-Publishing`.

**Documentation** — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (vue d'ensemble) ·
[`docs/EMPLACEMENTS.md`](docs/EMPLACEMENTS.md) (où vivent les revues, poste par poste) ·
[`docs/MAINTENANCE.md`](docs/MAINTENANCE.md) (ce qu'il faut surveiller et quand) ·
[`docs/SECURITE.md`](docs/SECURITE.md) (déploiement flotte) ·
[`userdoc.md`](userdoc.md) (côté rédacteur).

## Principes

- **Une source de vérité par élément, zéro copie par revue.** Le pipeline et la configuration de
  l'éditeur vivent dans le toolkit (`C:\ProgramData\SZH\toolkit`), pas dans les dossiers de revue.
  Corriger un style ou un bug, c'est une release, pas N dossiers à retoucher.
- **Mise à jour silencieuse, sans administrateur.** Une tâche planifiée lit chaque jour un
  `manifest.json` d'un kilooctet et ne télécharge que ce qui a changé. Le rootfs, lourd, n'est
  retiré que lors d'un changement de toolchain.
- **Dossier de revue épuré.** Le rédacteur ne voit que son contenu : articles, métadonnées, PDF.
- **Reproductible et épinglé.** Rootfs vérifié par sha256, dépendances Python figées, extensions
  VSCodium épinglées avec leurs empreintes.

## Arborescence

```
szh-publishing-toolchain/
├── .github/workflows/release.yml   CI : toolkit.zip + manifest.json à chaque tag ;
│                                   rootfs reconstruit seulement si image/ a changé
├── image/                          rootfs WSL — change rarement
│   ├── Containerfile               Debian + Pandoc + WeasyPrint
│   ├── requirements*.txt           environnements Python figés
│   ├── wsl.conf                    utilisateur par défaut, montage /mnt/c
│   └── build-rootfs.sh             construction locale ou CI -> .tar.gz + sha256
├── pipeline/                       → C:\ProgramData\SZH\toolkit\pipeline
│   ├── Makefile                    source de vérité de la compilation
│   ├── filters/*.lua               transformations Pandoc (import et rendu)
│   ├── docx-*.py                   extraction Word : métadonnées, tableaux, titres
│   ├── import-docx.sh              chaîne d'import d'un Word en article
│   ├── import-medias.py            fin d'import : photos rangées, images ôtées, médias renommés
│   ├── cmyk-rgb.py                 JPEG livrés en CMJN -> RVB (Pillow, venv des portraits)
│   ├── accent-css.py, apca.py      couleur annuelle et contrôle de contraste
│   ├── portraits.py                recadrage et détourage des photos d'auteurs
│   ├── styles/                     print.css (maquette) et couleurs.css (palette)
│   └── templates/                  gabarit HTML de la couverture
├── windows/                        → C:\ProgramData\SZH\toolkit\windows
│   ├── bootstrap.ps1               administrateur, une fois par poste
│   ├── update-launcher.ps1         tâche planifiée : vérification silencieuse
│   ├── update.ps1                  mise à jour visible, sans administrateur
│   ├── new-revue.ps1               création d'un numéro
│   ├── open-revue.ps1              lanceur du menu Démarrer, un par produit
│   ├── open-md.ps1                 ouverture d'un .md par double-clic
│   ├── archive-revue.ps1           déplacement en cours ⇄ archives
│   ├── szh-common.ps1              socle commun : manifest, téléchargement, textes
│   ├── icone.py                    fabrique les deux .ico livrés à côté
│   └── vsix.lock                   extensions tierces épinglées (version + sha256)
├── vscodium-user/                  → %APPDATA%\VSCodium\User
├── vscodium-extension/
│   ├── szh-apercu/                 aperçu PDF automatique après compilation
│   └── szh-cockpit/                barre latérale « Revue SZH »
├── revue-template/                 copié dans le dossier OneDrive de chaque revue
└── test/                           banc d'essai : articles témoins, contrôles
```

## Runbook

### Publier une version

Pousser un tag déclenche [`release.yml`](.github/workflows/release.yml) :

```bash
git tag v2026.07.0 && git push origin v2026.07.0
```

La CI vérifie les contrats du cockpit (`node --test test/js/*.test.js`), construit les VSIX,
assemble le toolkit et publie une Release avec `manifest.json`. Le rootfs n'est reconstruit que
si `image/` a changé ; une retouche de maquette produit donc une release de quelques kilooctets.
Reconstruction forcée : Actions → release → *Run workflow*, case `force_rootfs`.

⚠ **Incrémenter la `version` dans le `package.json` de chaque extension modifiée.** `update.ps1`
compare les numéros de version, pas les empreintes : sans bump, le VSIX reconstruit n'est jamais
réinstallé sur les postes.

### Préparer un poste — une fois, en administrateur

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\bootstrap.ps1
```

Active le moteur WSL, installe VSCodium et SumatraPDF par winget, donne aux Utilisateurs le droit
d'écrire dans `C:\ProgramData\SZH`, crée les tâches planifiées (mise à jour à la connexion et à
11 h, préchauffage WSL) et lance la première mise à jour. Si WSL était absent, redémarrer puis
relancer le script.

Puis, **à la main** : poser les exclusions antivirus sur `…\SZH\WSL\*.vhdx`, `…\SZH\staging` et
les processus `vmcompute.exe`, `vmmem.exe`, `wsl.exe`, `wslservice.exe`. Le script les affiche
mais ne les pose pas.

Ensuite, plus besoin d'administrateur. Seule la montée de VSCodium ou de SumatraPDF reste manuelle.

### Créer une revue

Depuis le menu Démarrer : **Revues SZH** (ou **Zeitschriften SZH**) → *Nouvelle revue…*. Le
numéro est créé dans le dossier « en cours » du produit ; il n'y a rien à choisir. `new-revue.ps1`
copie le gabarit, écrit le jeton de produit, déduit l'année et le numéro du nom du dossier, vide
le titre d'exemple, estampille la version du toolkit et crée « Ouvrir la revue.lnk ».

Dans OneDrive : clic droit sur le dossier → **Toujours conserver sur cet appareil**.

### Où vivent les revues

Cartographie complète, chemins réels et manœuvre de reprise :
[`docs/EMPLACEMENTS.md`](docs/EMPLACEMENTS.md).

Un seul endroit du code connaît les chemins : `Get-SzhEmplacements`, dans
`windows/szh-common.ps1`. Base de production
`%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte`, base de test
`%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING` — les deux surchargeables par la clé
`basesRevues` de `C:\ProgramData\SZH\config.json`. Mêmes sous-dossiers dans les deux cas :

| | Revue (fr) | Zeitschrift (de) |
|---|---|---|
| en cours | `52_Revue\RV02_Redaction` | `53_Zeitschrift\ZS02_Redaktion` |
| archives | `52_Revue\RV99_Archives` | `53_Zeitschrift\ZS99_Archives` |

La clé **`emplacementRevues`** de `config.json` choisit la base : `"test"` ou
`"production"`. Elle remplace `devMode`, qui reste lu (`true` = test) et que la bascule des
réglages du cockpit continue d'écrire en parallèle. Un poste qui ne porte ni l'une ni l'autre
se voit écrire la clé en clair au premier lancement, la valeur suivant le disque : jamais
`production` si la racine de test porte des numéros. L'emplacement actif est nommé dans le
titre du lanceur (`Revues SZH — dossier de test (Revues-TESTING)`) et dans le journal. Le
lanceur ne liste que cette arborescence ; les revues restées ailleurs sont comptées et
signalées, pas listées.

### Cycle de vie d'un numéro

`locked` et `archived` dans `ausgabe.yaml` font foi ; tout le reste en découle. Le panneau
d'export (`Ctrl+Alt+D`) porte les trois gestes : *Archiver et verrouiller*, *Déverrouiller*,
*Désarchiver*. Un numéro verrouillé passe en lecture seule et refuse toute commande d'écriture.
Un numéro verrouillé ou archivé ne se recompile plus tout seul : l'export se demande
explicitement. L'archivage supprime `out/` — le gain de place est chiffré dans la confirmation —
puis déplace le dossier et rouvre l'éditeur dessus.

### Liens de traduction

« Envoyer pour traduction » copie un lien `szh://traduction/<produit>/<numéro>[/<article>]` et
ouvre un brouillon d'e-mail. Le schéma `szh:` est enregistré dans HKCU par `update.ps1`. Le lien
ne contient aucun chemin : le lanceur revalide sa grammaire, retrouve le dossier dans les seuls
emplacements connus du poste, dépose une intention à usage unique périmée en cinq minutes, et
ouvre la revue ; le cockpit consomme l'intention et ouvre le panneau.

Le brouillon part par `mailto:`, et seulement par là : le lien y arrive en texte brut, le corps
explique comment le coller, et le lien est aussi mis dans le presse-papiers. Un brouillon à vrai
hyperlien exigerait l'automatisation COM d'Outlook, qui n'existe pas pour le nouveau client :
cette voie a été retirée le 23.08.2026 plutôt que maintenue pour un seul client. L'adresse de
destination se surcharge par `"mailsTraduction"` dans `config.json`.

### Revenir à une version précédente

`update.ps1 -Version <X>` : l'archive précédente est conservée en regard de la courante. Sans
ligne de commande : lanceur → *Version du logiciel…*, ou le bouton *Changer de version…* de
l'avertissement de divergence du cockpit. Volontairement manuel et visible — l'opération remplace
le rootfs et les extensions, et demande un redémarrage de l'éditeur.

## Le flux rédacteur

1. Déposer les Word finalisés dans `articles-word`.
2. Ouvrir la revue : « Ouvrir la revue » dans le dossier, ou le menu Démarrer.
3. Les Word sont convertis en Markdown dans `articles`, images et métadonnées récupérées ;
   l'original est supprimé une fois la conversion réussie.
4. Écrire, puis **Ctrl+S** : chaque article est régénéré dans `out/<article>/`, en PDF et en HTML.

Tout se fait depuis la barre latérale « Revue SZH », sans explorateur de fichiers : import,
compilation, aperçu, métadonnées du numéro et des articles, éditeur de tableau, gestion des
médias, portraits d'auteurs, suivi des traductions, export OJS, cycle de vie du numéro. Le détail des
gestes est dans [`userdoc.md`](userdoc.md).

### Raccourcis

| Raccourci | Effet | Fourni par |
|---|---|---|
| `Ctrl+S` | Enregistrer : import des Word déposés puis régénération | triggertaskonsave |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Gras / italique / souligné | szh-cockpit |
| `Ctrl+Alt+1` / `2` / `3` | Titre de niveau 1 / 2 / 3 | szh-cockpit |
| `Ctrl+Alt+W` / `H` / `Q` | Bloc Important / Mise en évidence / Question | szh-cockpit |
| `Ctrl+Alt+C` | Citation | szh-cockpit |
| `Ctrl+Alt+F` / `Ctrl+Alt+T` | Insérer une figure / un tableau | szh-cockpit |
| `Ctrl+Alt+V` | Coller un tableau depuis Excel ou Word, fusions comprises | szh-cockpit |
| `Ctrl+Alt+Entrée` | Saut de page, dans le PDF seulement | szh-cockpit |
| `Ctrl+Alt+A` | Panneau de commande | szh-cockpit |
| `Ctrl+Alt+S` | Panneau d'édition | szh-cockpit |
| `Ctrl+Alt+D` | Panneau d'export | szh-cockpit |
| `Ctrl+Alt+P` | Basculer l'aperçu HTML ⇄ PDF | szh-cockpit |
| `Ctrl+Alt+I` | Importer les Word à la demande | tâche utilisateur |
| `Ctrl+E` / `Ctrl+Maj+B` | Relancer la compilation | tâche utilisateur |
| `Ctrl+Alt+R` | Recharger la fenêtre, si l'aperçu se fige | keybindings |
| `Ctrl+Espace` | Suggestions de blocs `:::` | VS Code, réactivé en Markdown |
| `Entrée` dans une liste | Continuation automatique | markdown-all-in-one |
| `Tab` dans un tableau | Cellule suivante, formatage automatique | markdowntable |

## Pièges à connaître avant de toucher au code

- **`ELECTRON_RUN_AS_NODE=1` est hérité de l'hôte d'extensions.** Tout processus lancé par le
  cockpit le reçoit, et `VSCodium.exe "<dossier>"` se met alors à chercher un script Node : il
  meurt sur « Cannot find module », sans fenêtre et sans erreur visible. `szh-common.ps1` purge la
  variable au dot-source, et `Start-SzhCodium` est le seul point de lancement de l'éditeur.
- **Ne jamais lancer un script PowerShell avec `detached: true` depuis l'extension.** Sous
  Windows, `powershell.exe` démarre alors sans console et ressort aussitôt avec le code 0, sans
  exécuter une ligne. Passer par `wscript.exe //B hidden.vbs`.
- **Un `update.ps1` lancé à la main est en retard d'une passe.** PowerShell lit tout le fichier
  avant de l'exécuter : la passe qui extrait le nouveau toolkit continue avec l'ancien code. La
  tâche planifiée fait ce qu'il faut ; après un `update.ps1` manuel qui modifie `update.ps1`,
  le relancer une fois.
- **`<revue>/.vscode/settings.json`** est le seul fichier technique toléré dans une revue, et
  seulement sur un numéro verrouillé. Il est écrit par `fs`, jamais par l'API de configuration :
  le verrou couvrant son propre fichier, l'API se voyait refuser l'écriture au déverrouillage et
  la clé survivait.
- **Un lien `szh://` vient de l'extérieur.** Il ne porte aucun chemin, sa grammaire est revalidée
  côté lanceur, et le dossier n'est cherché que dans les emplacements connus. Ne jamais construire
  un chemin sur un segment reçu sans repasser par `Get-SzhLien` et `Find-SzhRevue`.
- **`inotify` ne traverse pas `/mnt/c`.** Aucune fonction ne peut reposer sur un watcher Linux
  lisant les fichiers Windows.
- **Les scripts `.ps1` doivent tourner sous Windows PowerShell 5.1** : pas de `?.`, `??`, `?:`,
  ni `&&` / `||`.
- **Workspace Trust est désactivé** sur les postes, pour que la compilation à l'enregistrement
  parte sans fenêtre de confirmation. Compromis assumé sur des machines dédiées.

## Portabilité

Environ 80 % du système est indépendant de Windows : l'image OCI, le pipeline, la configuration
de l'éditeur. Un passage à macOS ou à un poste Linux ne toucherait ni le Makefile, ni le
`Containerfile` ; il faudrait remplacer la couche WSL et les scripts `windows/`.
