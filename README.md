# SZH/CSPS — chaîne de publication (VSCodium + WSL)

Chaîne `.md → Pandoc → WeasyPrint → PDF` pour des rédacteurs non techniciens, sous Windows,
avec les fichiers sur OneDrive et la toolchain isolée dans WSL. Le rootfs et l'outillage sont
construits par GitHub Actions et déployés en silence sur les postes.

Ce dépôt contient l'**outillage**, pas les revues : celles-ci vivent sur OneDrive. La distro
WSL s'appelle `SZH-Publishing`.

**Documentation** — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (vue d'ensemble) ·
[`docs/SORTIES.md`](docs/SORTIES.md) (ce que produit une compilation, et le contrat de balisage) ·
[`docs/EMPLACEMENTS.md`](docs/EMPLACEMENTS.md) (où vivent les revues, poste par poste) ·
[`docs/MAINTENANCE.md`](docs/MAINTENANCE.md) (ce qu'il faut surveiller et quand) ·
[`docs/SECURITE.md`](docs/SECURITE.md) (déploiement flotte) ·
[`userdoc.md`](userdoc.md) (côté rédacteur).

## Principes

- **Une source de vérité par élément, zéro copie par revue.** Le pipeline et la configuration de
  l'éditeur vivent dans le toolkit (`C:\ProgramData\SZH\toolkit`), pas dans les dossiers de revue.
  Corriger un style ou un bug, c'est une release, pas N dossiers à retoucher.
- **Mise à jour silencieuse, sans administrateur.** Une tâche planifiée lit une fois par
  semaine — le mardi à 14 h, et à chaque ouverture de session — un `manifest.json` d'un
  kilooctet, et ne télécharge que ce qui a changé. Le rootfs, lourd, n'est retiré que lors
  d'un changement de toolchain, et la passe silencieuse **renonce** plutôt que de le remplacer
  sous une compilation en cours.
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
│   │   ├── szh-commun.lua          fonctions partagées entre filtres (slug, langue, classe),
│   │   │                           chargée par dofile
│   │   └── szh-lire-config.lua     lit une clé d'un YAML par le lecteur pandoc lui-même
│   │                               (`pandoc lua`) ; remplace le sed/grep du Makefile et de livre.mk
│   ├── docx-*.py                   extraction Word : métadonnées, tableaux, titres
│   ├── szh_commun.py               fonctions partagées entre les scripts Python (avertir,
│   │                               lire_yaml, slugifier, écriture atomique)
│   ├── import-docx.sh              chaîne d'import d'un Word en article
│   ├── import-medias.py            fin d'import : photos rangées, images ôtées, médias renommés
│   ├── cmyk-rgb.py                 JPEG livrés en CMJN -> RVB (Pillow, venv des portraits)
│   ├── accent-css.py, apca.py      couleur annuelle et contrôle de contraste
│   ├── portraits.py                recadrage et détourage des photos d'auteurs
│   ├── styles/                     socle.css (polices et jetons, partagé), print.css
│   │                               (mise en page du PDF), couleurs.css (palette APCA),
│   │                               partage-filtres.css (balisage posé par les filtres Lua
│   │                               communs à la revue et au moteur livre)
│   └── templates/                  gabarit HTML de la couverture
├── windows/                        → C:\ProgramData\SZH\toolkit\windows
│   ├── bootstrap.ps1               administrateur, une fois par poste
│   ├── update-launcher.ps1         tâche planifiée : vérification silencieuse
│   ├── update.ps1                  mise à jour visible, sans administrateur
│   ├── new-revue.ps1, new-livre.ps1 création d'un numéro ou d'un livre
│   ├── open-produit.ps1            lanceur du menu Démarrer, table des produits (revue,
│   │                               zeitschrift, livre) ; open-revue.ps1 et open-livre.ps1
│   │                               en sont des enveloppes de quelques lignes
│   ├── open-md.ps1                 ouverture d'un .md par double-clic
│   ├── archive-revue.ps1           déplacement en cours ⇄ archives, revue ou livre
│   ├── szh-common.ps1              socle : manifest, téléchargement, mutex, remplacement
│   │                               atomique du toolkit ; dot-source les trois suivants
│   ├── szh-textes.ps1              table des textes fr/de/en de tous les scripts
│   ├── szh-produits.ps1            table des produits, emplacements, identité d'un
│   │                               numéro ou d'un livre
│   ├── szh-shell.ps1               identité de barre des tâches, raccourcis, lancement
│   │                               de VSCodium
│   ├── szh-taches.ps1              tâche planifiée, cadence hebdomadaire, choix du moment
│   ├── icone.py                    fabrique les quatre .ico livrés à côté
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

`release.yml` rejoue d'abord entièrement `ci.yml` (contrats du cockpit, contraste APCA,
typographie, compilation et validation PDF/UA des bancs) avant de publier quoi que ce soit :
une régression qui n'aurait dû se voir qu'au prochain push sur `main` s'arrête ici. Il vérifie
ensuite qu'une extension modifiée depuis le tag précédent porte bien une version supérieure —
sinon la release échoue avec le nom du `package.json` en cause, avant de construire les VSIX.
Une fois ces deux portes passées : construction des VSIX, assemblage du toolkit, publication
d'une Release avec `manifest.json`. Le rootfs n'est reconstruit que si `image/` a changé ; une
retouche de maquette produit donc une release de quelques kilooctets. Reconstruction forcée :
Actions → release → *Run workflow*, case `force_rootfs`.

⚠ **Incrémenter la `version` dans le `package.json` de chaque extension modifiée** reste le
geste attendu de qui prépare la release — la CI le refuse sinon, elle ne le fait pas à sa
place. `update.ps1` compare les numéros de version, pas les empreintes : sans bump, le VSIX
reconstruit n'est jamais réinstallé sur les postes.

### Préparer un poste — une fois, en administrateur

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\bootstrap.ps1
```

Active le moteur WSL, installe VSCodium et SumatraPDF **au niveau machine, dans les versions
figées par `windows/apps.lock`** (téléchargement direct, `sha256` et signature vérifiés —
winget n'est plus dans la chaîne, voir [`windows/APPS.md`](windows/APPS.md)), donne aux
Utilisateurs le droit d'écrire dans `C:\ProgramData\SZH`, pose les raccourcis du menu
Démarrer, crée les tâches planifiées (mise à jour à la connexion et le mardi à 14 h,
préchauffage WSL) et lance la première mise à jour. Si WSL était absent, redémarrer puis
relancer le script.

`windows\Installer le poste SZH.cmd` fait la même chose à double-clic, sans passer par
PowerShell.

**À savoir avant d'installer.** Ce script pose aussi, *pour le compte qui l'exécute*, tout ce
qui est par utilisateur : extensions, réglages, raccourcis, environnement WSL. Élevé avec un
compte de support depuis la session d'un rédacteur, il ne peut donc pas servir ce rédacteur —
il le dit à l'écran et laisse la tâche planifiée le faire à sa prochaine ouverture de session.
Pour vérifier l'état d'un poste, **dans la session de la personne concernée et sans
élévation** :

```powershell
powershell -ExecutionPolicy Bypass -File C:\ProgramData\SZH\toolkit\windows\diagnostic.ps1
```

Le rythme de la mise à jour et les quatre états du poste — verrouillé, éteint, en veille,
personne connecté — sont traités dans `docs/MAINTENANCE.md`. Un point à connaître : sur un
poste **déjà installé**, seul un passage en administrateur peut changer le déclencheur de la
tâche, mais le rythme hebdomadaire s'applique quand même, parce qu'il vit dans
`szh-taches.ps1` et non dans le déclencheur.

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

Sujet et corps de ce courriel, et de celui d'« Envoyer à l'auteur », viennent chacun d'un gabarit
Twig, un fichier par nom et par langue, dans `vscodium-extension/szh-cockpit/mail-templates/`
(`envoi-auteur.fr.twig`, `traduction.de.twig`, …) : `lib/gabarits.js` en lit un sous-ensemble
(variables, filtres, `if`/`for`/`set`, blocs, commentaires), `lib/courriel.js` les rend
(`rendreCourriel`), avec repli sur le français si la langue manque. Changer un texte se fait dans
le `.twig`, sans toucher au code. Le lanceur Windows a les siens, dans `windows/mail-templates/`,
rendus par `Get-SzhCourriel` (`windows/szh-common.ps1`), qui ne comprend que variables, blocs et
commentaires.

### Les raccourcis du menu Démarrer

Cinq entrées, au niveau utilisateur, posées par `Set-SzhRaccourcisMenu` (`szh-shell.ps1`) :
« Revues SZH », « Zeitschriften SZH » et « Books SZH-CSPS » (un lanceur par produit, sans
console, par `wscript.exe //B hidden.vbs`), puis « Mise à jour de l'outil Revue » et
« Aktualisierung des Redaktionstools », qui visent `powershell.exe -File update.ps1 -Langue
fr|de` — **fenêtre visible**, parce qu'une mise à jour télécharge, prend du temps et peut
échouer.

Deux entrées de mise à jour plutôt qu'une renommée : le nom d'un `.lnk` est figé alors que la
langue de l'interface bouge (env, `state.json`, langue de Windows). Un poste neuf résout
« en » — la seule langue qu'aucune équipe n'emploie —, la préférence bascule dès qu'un collègue
ouvre l'autre lanceur, et un renommage casse l'épinglage. `$SzhLanguesRaccourci` décide quelles
langues reçoivent une entrée.

Les trois chemins les posent, et c'est voulu : `bootstrap.ps1` (poste neuf, y compris quand la
Release est injoignable), `update.ps1` (étape 4/5) et `update-launcher.ps1` **à chaque ouverture
de session, avant le test de version** — sans quoi un poste déjà à la dernière version
n'obtiendrait jamais une entrée ajoutée après coup. Jamais bloquant : un menu tenu par une
stratégie de groupe est journalisé, pas fatal. Un `.lnk` du premier niveau qui pilote un de nos
scripts sans porter l'un des noms voulus est retiré — le sous-dossier `SZH\` du menu appartient
à un autre produit et n'est jamais touché.

### Revenir à une version précédente

`update.ps1 -Version <X>` : l'archive précédente est conservée en regard de la courante. Sans
ligne de commande : lanceur → *Version du logiciel…*, ou le bouton *Changer de version…* de
l'avertissement de divergence du cockpit. Volontairement manuel et visible — l'opération remplace
le rootfs et les extensions, et demande un redémarrage de l'éditeur.

### Les réglages de l'éditeur, et pourquoi la mise à jour n'y touche plus

Le gabarit commenté `vscodium-user/settings.json` est la **source unique** de ce que la
maison impose à tous les postes. Il est recopié tel quel dans
`contributes.configurationDefaults` du cockpit (`package.json`) — deux fichiers, une seule
vérité, et `test/js/reglages-flotte.test.js` refuse qu'ils divergent en affichant le bloc à
recoller.

Un **défaut d'extension** vit *sous* le fichier du rédacteur au lieu de le remplacer. C'est
tout le correctif : `update.ps1` ne recopie plus `settings.json` que sur un poste **qui n'en
a pas**, et ce que le rédacteur choisit dans « Réglages SZH » — thème, zoom, taille de
police, langue, mode d'aperçu — ne disparaît plus à chaque mise à jour. `keybindings.json`
et `tasks.json`, eux, restent écrasés : personne ne les édite.

⚠ L'éditeur **refuse certains défauts d'extension, en silence**. Son point d'extension
filtre sur la portée du réglage : mesuré sur VSCodium 1.121, `update.mode`,
`extensions.autoUpdate`, `extensions.autoCheckUpdates`, `window.commandCenter` et
`window.menuBarVisibility` (portée « application ») sont retirés de la contribution avec un
simple avertissement. Le cockpit les pose donc lui-même, par
`getConfiguration().update(…, Global)` — la seule écriture qui retouche `settings.json`
chirurgicalement, commentaires et clés voisines conservés.

Ce partage **n'est pas écrit en dur** : `poserReglagesMaison` (extension.js) relit le défaut
effectif de chaque clé au démarrage et pose celles qui n'ont pas pris. Une clé refusée par
une version future de l'éditeur se rattrape donc seule. Et l'écriture n'a lieu **qu'une fois
par valeur voulue** — l'empreinte du gabarit est mémorisée : sans cette garde, un rédacteur
qui a délibérément changé un de ces réglages se le verrait réimposer à chaque ouverture.

### Les réglages protégés

Deux blocs de « Réglages SZH » ne décrivent pas le confort d'une personne mais la **chaîne de
publication** : la configuration de l'export OJS et les titres de bibliographie. Une rubrique
OJS renommée sur un seul poste fait atterrir ses articles dans la mauvaise section de la
revue. Ils sont donc **en lecture seule**, et déployés depuis
`windows/settings-protected.json` vers `C:\ProgramData\SZH\settings-protected.json` —
écrasé à chaque mise à jour, c'est le sens du fichier.

Le cockpit relaie ensuite ces blocs dans `config.json`, **seul fichier que
`pipeline/filters/szh-citations.lua` sache lire depuis la machine virtuelle** : ni le filtre
ni `lib/export-ojs.js` ne changent de source. Le relais n'a lieu que **quand la référence a
changé**, jamais à chaque démarrage — sinon une modification locale disparaîtrait le
lendemain matin.

⚠ Un bloc **absent** du fichier déployé laisse celui du poste intact ; seul un bloc présent
prend la main. Le fichier part vide : s'il effaçait ce qu'il ne nomme pas, la première mise à
jour emporterait la configuration OJS des postes qui en avaient déjà une.

Le rédacteur peut déverrouiller — case à cocher, question modale qui dit ce que cela engage.
Sa modification vaut alors **tout de suite sur son poste**, et jusqu'à la prochaine mise à
jour seulement. Le formulaire affiche alors un bandeau « ce poste ne porte plus les valeurs
de la rédaction », le bouton **« Télécharger les réglages protégés »** produit le fichier à
transmettre, et `windows/diagnostic.ps1` (§ *Réglages de la rédaction*) sort la divergence en
défaut à réparer.

### La langue de l'interface

**Deux sources, indépendantes, et c'est ce qui rend un écran mi-français mi-allemand
possible.** Les menus de l'éditeur, les titres de commandes et les descriptions de réglages
viennent de `package.nls.json` / `package.nls.de.json`, que VSCodium résout selon **sa propre
langue d'affichage** (`argv.json`, clé `locale`, et le pack de langue épinglé dans
`vsix.lock`). Tout le reste — arbre, formulaires, messages — vient de `lib/i18n.js`, que
`sourceLangue()` résout par cette cascade, la première source qui répond gagnant :

| # | Source | Où |
|---|--------|-----|
| 1 | `SZH_LANGUE` | l'environnement — un essai, jamais posée sur un poste de rédaction |
| 2 | réglage `szh.langue` | réglages de l'éditeur, écrits par « Réglages SZH » |
| 3 | clé `langue` | configuration du poste — le même choix, **hors** des réglages de l'éditeur |
| 4 | clé `langue` | état du poste, écrit par le dernier lanceur ouvert (`Set-SzhLangueProduit`) |
| 5 | langue d'affichage de l'éditeur | `argv.json` + pack de langue |
| 6 | langue d'affichage de Windows | locale du système |
| — | français | faute de mieux |

Deux points valent d'être sus avant d'y toucher.

**Pourquoi l'étage 4.** Les postes d'ici affichent Windows ET VSCodium en anglais : ni l'un
ni l'autre ne dit l'équipe qui s'en sert, et la cascade retombait donc toujours sur le
français — y compris à la rédaction germanophone. Le lanceur, lui, le dit : « Zeitschriften
SZH » écrit `de`, « Revues SZH » écrit `fr`.

**Pourquoi l'étage 3 double l'étage 2.** `update.ps1` (étape 4/5) réécrit *intégralement* les
réglages de l'éditeur à chaque mise à jour. Le choix du rédacteur y disparaissait — un poste
allemand se remettait à parler français après chaque mise à jour. Le second exemplaire vit
dans la configuration du poste, que la mise à jour ne touche pas. ⚠ Le thème, le zoom et la
taille de police du formulaire de réglages n'ont PAS ce second exemplaire : eux repartent
encore de zéro à chaque mise à jour.

Quand les deux moitiés divergent, personne n'a à le deviner : `windows/diagnostic.ps1`
(§ *Langue de l'interface*) pose les six sources côte à côte, nomme celle qui a tranché et
ressort en défaut à réparer ; et « Réglages SZH » affiche la discordance sous le choix de la
langue. Des menus en **anglais** ne sont pas une discordance — c'est l'état ordinaire d'un
poste francophone, aucun pack de langue français n'étant épinglé.

Gardé par `test/js/langue-interface.test.js` (la cascade, les deux écritures, l'ordre du
diagnostic) et `test/js/actualite.test.js` (aucun libellé français dans le formulaire
allemand).

### Réparer un poste

Un script qui répare (`bootstrap.ps1` relancé en administrateur, `update.ps1` en ligne de
commande) ne s'exécute jamais depuis `C:\ProgramData\SZH\toolkit` : ce dossier est inscriptible
par le groupe Utilisateurs, et un administrateur qui l'exécuterait tel quel exécuterait aussi
bien un code qu'un compte standard y aurait déposé. Toujours repartir d'un clone frais du dépôt
ou d'une archive `toolkit-<v>.zip` fraîchement téléchargée et vérifiée par sha256. Détail des
manœuvres de reprise dans [`docs/MAINTENANCE.md`](docs/MAINTENANCE.md).

### Désinstaller un poste

Retire le toolkit, les tâches planifiées, les raccourcis et les réglages VSCodium du
compte, sans jamais toucher à WSL ni aux revues — `windows\uninstall.ps1 -Simuler` d'abord,
ou double-clic sur `windows\Désinstaller le poste SZH.cmd`. Détail des options dans
[`docs/MAINTENANCE.md`](docs/MAINTENANCE.md), § Désinstaller un poste.

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

### Ce que contient un dossier d'article

Un fichier singulier de l'article est son voisin, nommé `<slug>.<rôle>.<extension>` :

```
articles/<slug>/
├── <slug>.md                 le corps
├── <slug>.meta.yaml          la fiche : titres, résumés, mots-clés, auteur·e·s
├── <slug>.biblio.md          les références seules, sans titre — détachées à l'import
│                             depuis les styles du Word, réinsérées à la compilation, qui
│                             pose le titre dans la langue de l'article et ancre les entrées
├── <slug>.taches.yaml        l'état coché des tâches de la rédaction
├── <slug>.traduction.yaml    le suivi de traduction
├── tables/table-NN.html      un fichier par tableau, édité dans le cockpit
├── media/<slug>-fig-NN.<ext> les images du corps, numérotées par ordre de citation
├── portraits/                les photos d'auteur·e·s, recadrées et détourées
└── .szh-import.empreintes    ce que la conversion a livré, pour le réimport
```

Le Word ne possède que le corps, la bibliographie, `media/` et `tables/` : ce sont les seuls
que « Réimporter cet article » remplace, sous les conditions décrites en tête de
[`pipeline/reimporter.py`](pipeline/reimporter.py). Tout le reste survit à un réimport, y
compris un sidecar qu'une version future ajouterait.

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
