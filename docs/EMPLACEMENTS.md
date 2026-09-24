# Où vivent les revues

Un seul réglage décide de l'endroit où le lanceur cherche, crée et archive les numéros :
la clé **`emplacementRevues`** de `C:\ProgramData\SZH\config.json`, qui vaut `test` ou
`production`. Elle déplace la **racine** de tout le travail. Elle ne déplace **aucun
fichier** : les dossiers restent où ils sont, c'est le regard de l'outil qui change.

État constaté sur le poste `robin` le 2026-08-23, arborescence mise à jour le 2026-09-15.

---

## 1. Les deux racines

| Emplacement | Racine |
|---|---|
| `test` | `%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING` |
| `production` | `<ancrage SharePoint>\2_Produkte\54_Pronto` |

L'ancrage SharePoint est le dossier `Daten_Allgemein - General`, **cherché** sur le poste et
non déduit d'un chemin écrit à la main (§4 et `docs/RAPPORTS-ERREUR.md`, §1). Sur un poste
ordinaire il vaut `%USERPROFILE%\SZH CSPS\Daten_Allgemein - General`.

> **`54_Pronto` est le dossier de production de l'outil**, qui s'appelle Pronto.
> Le segment ne vit qu'à **deux** endroits dans tout le dépôt, et nulle part ailleurs :
>
> | Langage | Constante | Fichier |
> |---|---|---|
> | PowerShell | `$script:SzhSegmentApplication` | `windows\szh-ancrage.ps1` |
> | JavaScript | `SEGMENT_APPLICATION` | `szh-cockpit\lib\rapport-erreur.js` |
>
> Si le dossier devait un jour changer de nom : corriger ces deux chaînes, renommer le
> dossier sur SharePoint, publier. Tout le reste — racine de production, dossier des
> rapports, titre du lanceur — suit tout seul. Les tests
> `test/js/ancrage-sharepoint.test.js` et `test/js/rapport-erreur.test.js` refusent que le
> littéral soit recopié ailleurs.

Les racines ne sont **plus** surchargeables par une clé de `config.json` : cette clé primait
sur tout, y compris sur l'ancrage trouvé, et un poste dont la bibliothèque avait déménagé
restait muet (voir §4, `Get-SzhBaseRevuesPour`). Pour un essai, et pour un essai seulement,
deux variables d'environnement les remplacent telles quelles — `SZH_RACINE_TEST` et
`SZH_RACINE_PROD`, sur le modèle de `SZH_ANCRAGE` et `SZH_RAPPORTS`.

### La même arborescence sous les deux racines — sauf `_Systeme\`

C'est une exigence : **une seule table de sous-dossiers**, seule la racine change. Un essai
dans le dossier de test exerce donc exactement les chemins de la production — à UNE
exception près, `_Systeme\`, qui ne suit jamais la racine active (§1bis ci-dessous).

```
<racine active>\             (test OU production, selon emplacementRevues)
├── Revue\                   les numéros en cours, directement
├── Zeitschrift\             idem
├── Books\                   idem
├── _Archive\                Revue\  Zeitschrift\  Books\
├── _NewsUndActu\            Fiches\  _Statuts\fr\  _Statuts\de\
└── Secrétariat und Export\

<racine de PRODUCTION>\      (toujours celle-ci, même quand la racine active est « test »)
└── _Systeme\                 rapports\  journaux\  suggestions\  inventaire\
```

| | Revue (fr) | Zeitschrift (de) | Books |
|---|---|---|---|
| en cours | `Revue` | `Zeitschrift` | `Books` |
| archives | `_Archive\Revue` | `_Archive\Zeitschrift` | `_Archive\Books` |

Un dossier n'est un numéro que s'il porte un `ausgabe.yaml` (un livre : un `buch.yaml`).
Tout le reste est ignoré par le lanceur, listé ou non.

**Les deux états n'ont pas la même profondeur, et c'est voulu.** Un numéro en cours est à
un cran sous la racine, un numéro archivé à deux. Ce qu'on ouvre tous les jours est donc au
plus court, et ce qui dort est rangé dans un seul dossier qu'on replie une fois pour cacher
dix ans des trois produits.

Conséquence pour qui écrit du code : **on ne remonte jamais vers la racine en comptant des
crans**, mais en reconnaissant des **noms** — le dossier produit, puis éventuellement
`_Archive` au-dessus.

Tous les sous-dossiers de l'arbre portent une **capitale** : ils sont faits pour être lus
par une personne, dans l'Explorateur et dans OneDrive. Ceux de `_Archive\` prennent celle
de leur dossier produit (`_Archive\Revue`) ; ceux de la bibliothèque aussi
(`_NewsUndActu\Fiches`, `_NewsUndActu\_Statuts\fr`, `_NewsUndActu\_Statuts\de`).

**`_NewsUndActu\` a changé de forme le 23.09.2026.** Jusque-là (magasin posé le 15.09.2026,
jamais réellement déployé), le code envisageait deux sous-dossiers par jeton de produit
(`_NewsUndActu\Revue\`, `_NewsUndActu\Zeitschrift\`) — un magasin qui triait par revue
d'origine. La bibliothèque qui l'a remplacé trie par **langue**, pas par revue : `Fiches\`
porte les fiches elles-mêmes, `_Statuts\fr\` et `_Statuts\de\` leur état par langue (détail
du format : `docs/FORMAT-DOCUMENTATION-KIRBY.md`). Côté PowerShell, ce dépôt ne fait que
garantir que les trois dossiers existent (`windows\szh-produits.ps1`,
`$SzhDossiersBibliotheque` ; `windows\szh-migration.ps1` les crée aussi s'ils manquent
encore). Le contenu de `Fiches\` et de `_Statuts\` est géré par le cockpit, hors du
périmètre PowerShell de ce document.

Les dossiers hors produit :

| Dossier | Ce qu'il porte | Qui l'écrit |
|---|---|---|
| `_NewsUndActu\Fiches\` | les fiches de la bibliothèque, **partagées par les deux rédactions** | le cockpit (`vscodium-extension\szh-cockpit`) |
| `_NewsUndActu\_Statuts\fr\`, `_NewsUndActu\_Statuts\de\` | l'état des fiches, par langue | le cockpit |
| `Secrétariat und Export\` | les sorties du secrétariat (OJS, Edudoc…), déposées à la main | personne, pour l'instant |

`_Systeme\` (rapports, journaux, suggestions, inventaire) N'EST PAS un dossier hors produit
de la racine active : il vit **toujours** sur SharePoint, voir §1bis ci-dessous.

En emplacement `test`, le lanceur crée les dossiers manquants de tout cet arbre au
démarrage (`Initialize-SzhEmplacementsTest`) — `_Systeme\` excepté, qui n'en fait pas
partie. En production, jamais : l'arborescence de la racine active est celle de SharePoint.
La migration automatique (`windows\szh-migration.ps1`, §8) les crée aussi, dans le dossier
de test seulement, si un poste n'a jamais ouvert le lanceur en mode test.

### 1bis. `_Systeme\` : toujours sur SharePoint, jamais sur la racine active

Rapports d'erreur, journaux, suggestions et inventaire des postes ne suivent **jamais**
`emplacementRevues` : ils vivent sous la racine de PRODUCTION, dérivée de l'ancrage
SharePoint (`Resolve-SzhAncrage`), même quand le poste travaille dans le dossier de test.
Deux rédacteur·rice·s sur des emplacements différents doivent voir le **même** inventaire et
les **mêmes** rapports — les faire suivre la racine active aurait éparpillé ces quatre
dossiers entre `Revues-TESTING` et SharePoint selon qui les a écrits en dernier.

| Dossier | Ce qu'il porte | Qui l'écrit |
|---|---|---|
| `_Systeme\rapports\` | les rapports d'erreur automatiques (`docs/RAPPORTS-ERREUR.md`) | `lib\rapport-erreur.js`, `windows\szh-rapport.ps1` |
| `_Systeme\inventaire\` | le **check-in mensuel des postes** : un CSV par machine (`<POSTE>.csv`), une ligne par mois **et par compte Windows**, créée si elle manque et rafraîchie sinon. Le nom du fichier ne porte que le nom de la machine — l'identité de la personne (compte, adresse de connexion) vit **dans** le fichier, jamais dans son nom, qui s'affiche à tout le monde dans un dossier synchronisé. UTF-8 avec BOM, séparateur point-virgule : il s'ouvre d'un double-clic. | `windows\szh-checkin.ps1`, appelé une fois par `open-produit.ps1` au démarrage |
| `_Systeme\journaux\`, `_Systeme\suggestions\` | réservés | personne, pour l'instant |

Résolu par `Get-SzhDossierSysteme` (`windows\szh-produits.ps1`), qui appelle
`Resolve-SzhAncrage` lui-même plutôt que `Get-SzhBaseRevuesPour` — c'est précisément ce
détour qui empêche ces quatre dossiers de suivre `emplacementRevues`. Rend `''` si
l'ancrage SharePoint n'est pas résolu : comme pour un rapport d'erreur, pas de repli
silencieux vers OneDrive — l'appelant journalise et passe son tour (§1 « rapports d'erreur
déplacés » ci-dessus, `docs/RAPPORTS-ERREUR.md`). Le dossier est créé s'il manque : il est à
nous, contrairement aux dossiers de produits que SharePoint fournit.

### Ce qui a changé le 15.09.2026

| Avant | Après |
|---|---|
| `52_Revue\RV02_Redaction`, `RV99_Archives` | `Revue`, `_Archive\Revue` |
| `53_Zeitschrift\ZS02_Redaktion`, `ZS99_Archives` | `Zeitschrift`, `_Archive\Zeitschrift` |
| `54_Buch\BU02_Redaktion`, `BU01_Auflagen finale` (hypothèse jamais vérifiée) | `Books`, `_Archive\Books` — **dans notre arbre** |
| un niveau d'état sous chaque produit (`01_Redaction`…) | supprimé : le numéro en cours est **directement** sous son produit |
| un dossier d'archives par produit (`99_Archives`…) | regroupés sous un `_Archive\` unique, un sous-dossier par produit |
| racine de production = `…\2_Produkte` | `…\2_Produkte\54_Pronto` |
| rapports d'erreur sous `2_Produkte\Edition SZH CSPS allgemein\_AutoReportToolbox…` (dossier d'une autre équipe) | `…\54_Pronto\_Systeme\rapports` |
| réserve de fiches dans le **parent du numéro** — donc invisible de l'autre rédaction | `_NewsUndActu\` à la **racine**, lue par les deux |
| clé `basesRevues` de `config.json` | supprimée |
| clé `sousDossiersLivre` de `config.json` | supprimée (l'hypothèse qu'elle rattrapait est tranchée) |

Pas de période de transition et aucune relecture des anciens chemins : il n'y a que deux
postes, mis à jour ensemble. Depuis le 23.09.2026, les numéros existants se déplacent
automatiquement, à chaque mise à jour (`windows\szh-migration.ps1`,
`Invoke-SzhMigrationArborescence`, appelée par `update.ps1`) — uniquement dans le dossier de
**test**, jamais sur SharePoint. §8 en détaille le comportement (conflit, idempotence,
journal).

### Ce qui a changé le 23.09.2026

| Avant | Après |
|---|---|
| `_NewsUndActu\Revue\`, `_NewsUndActu\Zeitschrift\` (posé le 15.09.2026, jamais réellement déployé) | `_NewsUndActu\Fiches\`, `_NewsUndActu\_Statuts\fr\`, `_NewsUndActu\_Statuts\de\` — la bibliothèque trie par langue, pas par revue d'origine |
| `_Systeme\` créé et lu sous la racine ACTIVE (bug : un poste en mode test y aurait écrit sous `Revues-TESTING`, jamais lu par personne d'autre) | `_Systeme\` (rapports, journaux, suggestions, inventaire) TOUJOURS sur la racine de PRODUCTION, ancrée via `Resolve-SzhAncrage` — `Get-SzhDossierSysteme` |
| lien `szh://…/<nom-de-dossier>` — mort dès qu'un numéro est renommé ou archivé | lien `szh://…/<id>`, où `id` est la clé `id:` d'`ausgabe.yaml`/`buch.yaml`, posée une fois à la création et jamais recalculée — résolu par recherche de l'id, en cours ET aux archives |
| migration de l'arborescence : script manuel (`outils\migrer-arborescence.ps1`, supprimé), à lancer une fois à la main | migration automatique (`windows\szh-migration.ps1`, `Invoke-SzhMigrationArborescence`), appelée par `update.ps1` à chaque mise à jour, dans le dossier de test seulement |

Pas de rétrocompatibilité avec un lien `szh://` par nom de dossier : aucune production
n'était en cours au moment du changement. Un numéro créé avant le 23.09.2026 reçoit son
`id:` à la première migration automatique qui le trouve (`Update-SzhIdsManquants`) ou, s'il
est déjà dans la forme neuve de l'arbre, à la première ouverture dans le cockpit (autre
agent, hors de ce document).

---

## 2. Ce que chaque racine contient, dossier par dossier

### `test` — `…\OneDrive - SZH CSPS\Revues-TESTING`

| Dossier | Contenu réel (après migration) |
|---|---|
| `Revue` | `2027-01`, `2027-02`, `test` — trois numéros (avec `ausgabe.yaml`) · `2027-05` — dossier **sans** `ausgabe.yaml`, invisible du lanceur |
| `_Archive\Revue` | vide |
| `Zeitschrift` | `2027-01` — un numéro |
| `_Archive\Zeitschrift` | vide |

Un numéro ressemble à ceci : `ausgabe.yaml`, `articles/`, `articles-word/`, `out/`,
`BIENVENUE.md`, `Ouvrir la revue.lnk`.

`Ouvrir la revue.lnk` (`Ouvrir le livre.lnk` pour un livre) **ne contient aucun chemin du
poste** : il vise `%WINDIR%\System32\wscript.exe` et lui passe `//B`, les deux scripts du
toolkit (`hidden.vbs` puis `open-revue.ps1`, sous `C:\ProgramData\SZH\toolkit\windows\`) et
un lien `szh://ouvrir/<produit>/<id>`. C'est ce qui le rend valable sur les deux postes ET
après un renommage ou un archivage : la cible est une racine machine, et le numéro est
désigné par son `id:` (posé une fois, jamais recalculé), jamais par son nom de dossier ni
son chemin. Il est posé par `Set-SzhRaccourciRevue` (`windows/szh-shell.ps1`), qui pose
l'id manquant au passage s'il n'existe pas encore (`Set-SzhAusgabeIdSiAbsent`).

### `production` — `…\Daten_Allgemein - General\2_Produkte\54_Pronto`

Arbre neuf : c'est **le nôtre**, et non plus les dossiers produits d'autres équipes
(`52_Revue`, `53_Zeitschrift`, `54_Buch`), où l'outil n'a jamais créé un seul numéro. Ces
dossiers-là restent où ils sont, avec leurs Word, leurs Excel et leurs dossiers par année :
l'outil n'y touche plus du tout et ne les regarde plus.

La bibliothèque `2_Produkte` porte aussi `50_Open_Access`, `51_Dokumentation`, `56_Website`,
`57_Kongress`, `58_Forum`, `Bücher`, `Podcast`… : même chose, l'outil les ignore.

**Conséquence, à lire deux fois :** basculer sur `production` avant d'avoir déplacé les
numéros ouvre un lanceur dont les listes sont **vides**. Rien n'est perdu — les numéros
restent dans `Revues-TESTING` — mais le lanceur ne les montre plus. Voir §8.

### Un troisième dossier, hérité

`C:\Users\robin\OneDrive - SZH CSPS\Revues` contient `2026-04` et `test`. Ni l'un ni
l'autre ne porte d'`ausgabe.yaml` : ce ne sont pas des numéros. Ce chemin est encore listé
dans la clé `revuesRoots` de `config.json` (posée par une ancienne version du script de
création). Cette clé ne sert plus qu'à **compter** les numéros restés hors de
l'arborescence officielle, pour les signaler sous les listes du lanceur. Elle n'ouvre rien
et ne déplace rien ; ici, elle ne signale rien non plus.

---

### Un dossier que le réimport ajoute à un numéro

Depuis le 23.08.2026, un numéro peut porter à sa racine un dossier
`.szh-avant-reimport/<slug>/<horodatage>/`. Il est écrit par « Réimporter cet article »,
**avant** tout remplacement, et contient l'état d'avant : le dossier complet de l'article
(déplacé, non copié), le Word consommé, la fiche que le Word aurait produite, les portraits
du Word, un `journal.txt` et un `LISEZ-MOI.txt` bilingue.

Il suit donc le numéro : synchronisé par OneDrive comme le reste, emporté à l'archivage.
Rien ne le nettoie — c'est un filet de sécurité, pas un cache. Il se supprime à la main
quand le numéro est publié.

Le nom commence par un point : l'explorateur de l'éditeur et les recensements d'articles de
la chaîne l'ignorent. Ne pas le confondre avec `articles/.szh-reimport-<slug>/` ni
`articles/.szh-bascule-<slug>/`, qui sont des chantiers en cours — ceux-là sont repris ou
nettoyés automatiquement à la compilation suivante.

## 3. Tout le reste : ce qui ne bouge jamais

Rien de cette liste ne dépend de `emplacementRevues`.

| Quoi | Chemin sur ce poste |
|---|---|
| Configuration partagée PowerShell ↔ cockpit | `C:\ProgramData\SZH\config.json` |
| État du **poste** (version du toolkit, langue) | `C:\ProgramData\SZH\state.json` |
| État de **ce compte** (environnement WSL, extensions posées, onglet et langue du lanceur, mise à jour silencieuse — clés `ongletDefaut`, `langueInterface` et `majSilencieuse`, absente/vide = automatique ou fenêtre visible ; adresse Shlink et clés d'API Shlink/OJS — `shlinkUrl` en clair, `shlinkCle`/`ojsCle` chiffrées DPAPI, jamais en clair sur le disque, voir l'onglet **Paramètres**) | `C:\Users\robin\AppData\Local\SZH\etat-utilisateur.json` |
| Cadence de la vérification hebdomadaire, par compte | `C:\Users\robin\AppData\Local\SZH\maj-auto.json` |
| Auteur·e·s publiés (autocomplétion, cache OAI-PMH) | `C:\ProgramData\SZH\auteurs.json` |
| Journal (une ligne par geste, un fichier par mois) | `C:\ProgramData\SZH\logs\szh-2026-08.log` |
| Journaux détaillés d'une mise à jour | `C:\ProgramData\SZH\logs\update-<horodatage>.log` — les dix derniers se listent dans l'onglet **Journal** du lanceur (`Get-SzhJournauxMaj`) |
| Archive des journaux réunis pour le support (bouton « Envoyer les journaux » de l'onglet Journal) | dossier temporaire de l'utilisateur, `journaux-szh-<poste>-<horodatage>.zip` — l'outil ne la nettoie pas |
| Téléchargements et versions installables hors ligne | `C:\ProgramData\SZH\staging\` (`toolkit-<v>.zip`, `manifest-<v>.json`, `szh-publishing-rootfs-<v>.tar.gz`) |
| Toolkit déployé (maquette, scripts, gabarit) | `C:\ProgramData\SZH\toolkit\` — `VERSION`, `pipeline\`, `windows\`, `revue-template\`, `vscodium-user\` |
| Version du toolkit installée | `C:\ProgramData\SZH\toolkit\VERSION` → `2026.08.41` |
| Disque de la distro WSL, **un par compte** | `C:\ProgramData\SZH\WSL\<SID>\SZH-Publishing\ext4.vhdx` (2,4 Go) |
| Journaux détaillés d'une installation | `C:\ProgramData\SZH\logs\bootstrap-<horodatage>.log` |
| Extensions VSCodium installées | `C:\Users\robin\.vscode-oss\extensions\` — dont `szh-csps.szh-cockpit-0.22.1` et `szh-csps.szh-apercu-0.1.2` |
| Réglages de l'éditeur | `C:\Users\robin\AppData\Roaming\VSCodium\User\settings.json` |
| Intention d'ouverture (lien `szh://traduction/…`, usage unique) | `C:\Users\robin\AppData\Local\SZH\intention.json` |
| Cible du raccourci d'un numéro | `C:\Windows\System32\wscript.exe` + `C:\ProgramData\SZH\toolkit\windows\{hidden.vbs, open-revue.ps1}` — aucun chemin de profil |
| Raccourcis du menu Démarrer | `Pronto.lnk`, `Pronto (Updater).lnk` (posés par `update.ps1` ; noms tenus dans `$SzhNomApplication`/`$SzhNomMiseAJour`, `windows/szh-shell.ps1`) |
| Archives d'un numéro | **dans la racine active**, sous `_Archive\Revue` / `_Archive\Zeitschrift` / `_Archive\Books` |

L'archivage ne sort jamais de la racine active : un numéro archivé passe de
son dossier produit à `_Archive\<Produit>` **dans la même racine**. Le magasin
`_NewsUndActu\`, lui, ne bouge pas — c'est tout l'intérêt de l'avoir posé à la racine.

Le désinstalleur de poste (`docs/MAINTENANCE.md`, § Désinstaller un poste) retire le reste
de `C:\ProgramData\SZH` mais laisse toujours `WSL\` et la racine elle-même : les disques des
distributions ne sont jamais désinscrits ni supprimés.

---

## 4. Qui décide quoi

| Où | Quoi | Appelé par |
|---|---|---|
| `windows\szh-produits.ps1` · `Resolve-SzhEmplacementRevues` | La règle : clé neuve, puis clé ancienne, puis défaut. Pure, ne lit ni disque ni fichier. | tout le reste de cette liste |
| `windows\szh-produits.ps1` · `Initialize-SzhEmplacementRevues` | Écrit la valeur en clair dans `config.json` si elle manque, après avoir compté les numéros des trois racines (revue, zeitschrift, **et livre**). Une fois par poste, journalisée. | `Get-SzhEmplacementRevues` |
| `windows\szh-produits.ps1` · `Get-SzhEmplacementRevues` | Passage obligé : `test` ou `production`. | `Get-SzhEmplacements`, `Get-SzhEtiquetteRacine` |
| `windows\szh-produits.ps1` · `Get-SzhBaseRevuesPour` | La racine. **Seul endroit du dépôt qui connaît ces deux chemins.** Trois sources, de la plus forte à la plus faible : (1) la surcharge d'essai `SZH_RACINE_TEST` / `SZH_RACINE_PROD` ; (2) pour `prod` seulement, l'**ancrage SharePoint** résolu (`Resolve-SzhAncrage`), dont la racine dérive ; (3) le défaut codé en dur. **`basesRevues` a été supprimée le 15.09.2026** : une racine écrite à la main primait sur l'ancrage trouvé, et rendait muet un poste dont la bibliothèque avait déménagé. `dev` ne regarde jamais l'ancrage. | `Get-SzhEmplacements`, `Measure-SzhNumeros` |
| `windows\szh-ancrage.ps1` · `$script:SzhSegmentApplication` | **Le nom du dossier de l'application, côté PowerShell — la seule chaîne à corriger si ce dossier changeait de nom.** `$SzhDeriveBaseProduits` (= `2_Produkte\<application>`) et `$SzhDeriveDossierRapports` (= `…\_Systeme\rapports`) en dérivent. | `Get-SzhBaseProduitsDepuisAncrage`, `Get-SzhDossierRapportsDepuisAncrage` |
| `szh-cockpit\lib\rapport-erreur.js` · `SEGMENT_APPLICATION` | **Son jumeau JavaScript.** Les deux se changent ENSEMBLE ; `test/js/rapport-erreur-ps.test.js` compare les deux dérivations sur le même ancrage. | `SEGMENTS_DOSSIER_RAPPORTS` |
| `windows\szh-produits.ps1` · `$script:SzhSousDossiers`, `$script:SzhDossiersCommuns` | **Les six chemins de produit et les dossiers hors produit qui suivent la racine active.** Une seule table pour les deux racines : il n'existe aucun chemin qui dépende de l'emplacement actif. Les trois dossiers de la bibliothèque en dérivent, par `$SzhNomDossierReserve` et `$SzhDossiersBibliotheque`. `_Systeme\` n'y figure PAS : voir `Get-SzhDossierSysteme` plus haut. | `Get-SzhEmplacements`, `Initialize-SzhEmplacementsTest` |
| `windows\szh-migration.ps1` · `Invoke-SzhMigrationArborescence` | La migration AUTOMATIQUE, dans le dossier de **test** seulement (jamais SharePoint), appelée par `update.ps1` à chaque mise à jour. Déplace enfant par enfant (jamais tout un dossier d'un coup, pour qu'un conflit sur un nom n'empêche pas les autres) ; un conflit laisse la source en place et se journalise. Pose aussi un `id:` manquant sur chaque numéro/livre trouvé (`Update-SzhIdsManquants`, jamais un recalcul) et refait le raccourci de chaque numéro déplacé. Idempotente : rien à faire une fois les six dossiers sources vidés. | `update.ps1`, une fois par mise à jour |
| *(le côté cockpit de la bibliothèque `_NewsUndActu\Fiches\` / `_Statuts\` est hors du périmètre de ce document : il vit dans `vscodium-extension\szh-cockpit`, et n'est pas le fichier `lib\reserve.js` — remplacé, pas ce dépôt PowerShell.)* | | |
| `windows\szh-epinglage.ps1` · `Invoke-SzhEpinglageHorsLigne` | Marque « Toujours conserver sur cet appareil » (OneDrive Files On-Demand) le numéro en cours de chaque revue et la bibliothèque `_NewsUndActu`, sans geste manuel (§8bis). Jamais bloquant, jamais en simulation. | `open-produit.ps1`, juste après le check-in |
| `windows\szh-ancrage.ps1` · `Resolve-SzhAncrage` / `Initialize-SzhAncrage` | L'ancrage SharePoint : le dossier `Daten_Allgemein - General`, dont `2_Produkte` **dérive** — cherché (4 niveaux passifs, jamais de fenêtre), pas déduit d'une variable d'environnement. `Initialize-SzhAncrage` seule peut ouvrir un sélecteur de dossier, une fois par lancement. Détail complet : `docs/RAPPORTS-ERREUR.md`, §1. | `Get-SzhBaseRevuesPour`, `windows\open-produit.ps1` |
| `windows\szh-produits.ps1` · `Measure-SzhNumeros` | Compte les dossiers portant un manifeste (`ausgabe.yaml` pour une revue ou une zeitschrift, `buch.yaml` pour un livre), en cours et aux archives, dans une racine. Un livre compte donc lui aussi dans la bascule automatique `test`/`production`. | `Initialize-SzhEmplacementRevues` |
| `windows\szh-produits.ps1` · `Get-SzhEmplacements` | Les quatre dossiers de revue du poste (plus les deux du livre), plus l'emplacement actif. Journalise la racine une fois par lancement. | `open-produit.ps1`, `new-revue.ps1`, `new-livre.ps1`, `archive-revue.ps1` |
| `windows\szh-produits.ps1` · `Initialize-SzhEmplacementsTest` | Crée les dossiers manquants de tout l'arbre — les six des produits et les six hors produit — **en test seulement**. En production, jamais : l'arborescence est celle de SharePoint. | `open-produit.ps1` |
| `windows\open-produit.ps1` | Le lanceur : liste les numéros (ou les livres) de la racine active, affiche version et racine, ouvre VSCodium. `open-revue.ps1` et `open-livre.ps1` en sont des enveloppes. | menu Démarrer, liens `szh://` |
| `windows\szh-checkin.ps1` · `Invoke-SzhCheckin` | Le **check-in mensuel du poste** : `_Systeme\inventaire\<POSTE>.csv`, une ligne par mois et par compte. Le dossier vient de `Get-SzhDossierSysteme 'inventaire'`, TOUJOURS ancré sur SharePoint, jamais un chemin en dur ni la racine active — et **n'est écrit que si l'ancrage est résolu** — sinon un poste sans ancrage fabriquerait un faux arbre SharePoint sous son profil. Sérialisé par le mutex de poste, écrit atomiquement (temporaire `~$`, nettoyé par un `finally`), et jamais bloquant : un dossier partagé injoignable laisse une ligne de journal. | `open-produit.ps1`, une fois par lancement |
| `test\js\checkin-postes.test.js` | Éprouve la forme du CSV, l'unicité de la ligne mois + compte, son rafraîchissement, l'adresse absente tolérée, le temporaire nettoyé, et le lanceur qui s'ouvre malgré un dossier partagé injoignable. | `node --test` |
| `windows\new-revue.ps1`, `windows\new-livre.ps1` | Crée un numéro ou un livre dans le dossier « en cours » de la racine active ; `new-revue.ps1` écrit en plus l'année, le numéro et le volume. | bouton « Nouvelle revue… » / « Nouveau livre… » |
| `windows\szh-produits.ps1` · `Get-SzhVolumePour` | Le volume d'après l'année : Zeitschrift = année − 1994, Revue = année − 2010. **Seul endroit du dépôt qui porte ces deux années zéro.** | le formulaire « Nouvelle revue… », `new-revue.ps1` |
| `windows\szh-produits.ps1` · `Find-SzhNumeroVolume` | Cherche un numéro déjà posé sur un couple volume + numéro, **en cours et dans les archives** de la racine active. Rend son nom et son chemin ; ne supprime ni ne déplace rien. | le formulaire « Nouvelle revue… » |
| `test\js\volume-numero.test.js` | Juge la formule du volume contre un relevé de `ojs.szh.ch` (neuf millésimes) et éprouve le refus du doublon sur une arborescence jetable. | `node --test` |
| `windows\archive-revue.ps1` | Déplace un numéro **ou un livre** « en cours » ⇄ « archives », dans la racine active — `$estLivre` choisit la variante `.livre` des textes et le sous-dossier de livre. | panneau d'export du cockpit |
| `windows\szh-produits.ps1` · `Set-SzhEmplacementRevues` | **La bascule réelle, depuis le 14.09.2026.** Écrit `emplacementRevues` et `devMode` dans `config.json` d'un coup. Vaut pour **tout le poste**, pas pour un seul compte Windows. | réglage « Mode développeur (dossiers de test) » de l'onglet **Paramètres** du lanceur (`open-produit.ps1`) |
| `szh-cockpit\lib\archivage.js` · `resoudreEmplacementRevues` | La même règle, côté cockpit. Ne connaît **aucun** chemin de revue : il ne rend que la décision. | `lireEmplacementRevues` / `lireModeDeveloppeur`, pour le seul badge de la barre d'état (`extension.js`) |
| `szh-cockpit\lib\archivage.js` · `ecrireEmplacementRevues` / `ecrireModeDeveloppeur` | Existent encore, exportées, mais **plus appelées par aucune commande du cockpit** : le groupe de boutons radio du formulaire « Réglages SZH » a disparu quand la bascule a déménagé dans le lanceur. | aucune, côté interface — gardées pour les tests |
| `windows\bootstrap.ps1` | Pose `config.json` sur un poste neuf, avec `devMode = $true` (donc l'emplacement de test). **N'y écrit plus aucune racine.** | installation, une fois |
| `test\js\emplacements.test.js` | Soumet les deux moitiés aux mêmes configurations et refuse qu'elles divergent. | `node --test` |

---

## 5. Ce que change la bascule, concrètement

| | `test` → `production` | `production` → `test` |
|---|---|---|
| **Ce qui bouge** | rien sur le disque | rien sur le disque |
| **Ce que le lanceur liste** | les numéros du dossier de l'application | les numéros de `Revues-TESTING` |
| **Ce qui devient invisible** | les numéros de `Revues-TESTING` | ceux du dossier de l'application |
| **« Nouvelle revue… » crée dans** | `…\54_Pronto\Revue` | `Revues-TESTING\Revue` |
| **L'archivage déplace vers** | `…\_Archive\Revue` | `Revues-TESTING\_Archive\Revue` |
| **Les dossiers manquants de l'arbre** | ne sont **pas** créés | sont créés au prochain lancement |
| **Ce que le lanceur affiche en plus** | rien | bandeau rouge (bloc d'informations, formulaires « Nouveau… ») |
| **Ce que le cockpit affiche en plus** | rien | badge orangé « Dossier de test » dans la barre d'état |
| **Un numéro déjà ouvert dans l'éditeur** | reste ouvert et se compile normalement : le chemin est celui de la fenêtre, pas celui du réglage | idem |
| **Ce qui ne bouge pas** | toute la colonne du §3 : toolkit, WSL, extensions, journal, réglages de l'éditeur | idem |

---

## 6. Lire l'emplacement actif sans ouvrir un fichier

1. **Le titre de la fenêtre du lanceur** (menu Démarrer → *Pronto*) le porte
   toujours, dans les deux sens — **un seul titre**, quel que soit l'onglet ouvert (Revue,
   Zeitschrift ou Book), depuis que les trois produits partagent une fenêtre unique ; seule
   l'étiquette de la racine suit la langue du lanceur :
   - `Pronto – dossier de test (Revues-TESTING)`
   - `Pronto – dossier de production (54_Pronto)`
   - `Pronto – Testordner (Revues-TESTING)`
   - `Pronto – Produktionsordner (54_Pronto)`

   Le jeton entre parenthèses est la **feuille** de la racine active
   (`Get-SzhEtiquetteRacine`) : en production, c'est donc le dossier de l'application, et il
   suivrait un renommage de ce dossier sans qu'on touche à une ligne de code.
2. **Le bloc d'informations du lanceur**, sous les deux listes, donne le chemin complet de
   la racine active — dans les **deux** racines, et non plus en test seulement. C'était le
   cas grave qui restait muet : un lanceur basculé sur `production`, listes vides, ne disait
   pas pourquoi.
   - `Revue dans : C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING`
   - `Revue dans : C:\Users\robin\SZH CSPS\Daten_Allgemein - General\2_Produkte\54_Pronto`
   - `Zeitschrift in: C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING`
   Le mot « dossier de test » n'y est plus, mais le chemin le nomme. Et le titre de la
   fenêtre, lui, garde l'étiquette en clair.
3. **Le journal** `C:\ProgramData\SZH\logs\szh-<année>-<mois>.log` porte une ligne par
   lancement :
   `revues : emplacement "test" -> C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING`
   et, la première fois que la valeur a été figée :
   `emplacement des revues : "test" ecrit dans config.json (numeros trouves : test 4, production 0)`
4. **Le badge de la barre d'état du cockpit**, une fois un numéro ouvert dans l'éditeur : icône
   éprouvette, fond orangé, étiqueté « Dossier de test » (« Testordner » en allemand), visible
   seulement en test. Depuis le 14.09.2026, **il ne se clique plus** : le réglage qui décide de
   ce badge a déménagé dans l'onglet **Paramètres** du lanceur Windows, hors de portée de
   VSCodium, et l'infobulle le dit — en plus de distinguer, comme avant, un poste sans
   `config.json` (le test par défaut) d'un poste où l'emplacement `test` est écrit en clair.

---

## 7. La clé, ses valeurs, et celle d'avant

```json
{
  "emplacementRevues": "test"
}
```

| Valeur | Effet |
|---|---|
| `"test"` | racine de test (`Revues-TESTING`) |
| `"production"` | racine de production (`…\2_Produkte\54_Pronto`) |
| autre chose | ignorée : on retombe sur la clé `devMode`, puis sur `test` |

Ordre de lecture, identique côté PowerShell et côté cockpit :

1. `emplacementRevues` — `"test"` / `"production"`, casse et espaces indifférents ;
2. `devMode` — l'**ancienne** clé, encore lue : `true` = test, `false` = production
   (`"true"`, `"false"`, `1` et `0` acceptés de la même façon des deux côtés) ;
3. faute des deux : `test` — ce que voyaient tous les postes avant que la clé existe.

La bascule se fait dans l'onglet **Paramètres** du lanceur (réglage « Mode développeur »),
qui écrit **les deux** clés à la fois (`Set-SzhEmplacementRevues`, `windows/szh-produits.ps1`) :
un poste resté sur un toolkit plus ancien continue de lire `devMode` et voit la même chose. Le
cockpit sait encore écrire les deux clés (`ecrireEmplacementRevues`), mais depuis le
14.09.2026 plus aucune commande de son interface ne l'appelle.

Au premier lancement après la mise à jour, un poste dont `config.json` ne portait aucune
des deux clés se voit écrire `emplacementRevues` en clair. La valeur retenue suit le
disque et jamais au détriment de ce qui existe : `production` seulement si la racine de
production porte des numéros **et** celle de test aucun ; dans tous les autres cas `test`,
c'est-à-dire exactement ce que le poste voyait déjà.

---

## 8. Reprise : « je ne vois plus mes revues »

1. Menu Démarrer → **Pronto**. Lire le **titre de la fenêtre**.
2. S'il dit `dossier de production (54_Pronto)` et que les listes sont vides : les numéros
   sont dans la racine de test, l'interrupteur est du mauvais côté. **Rien n'a été
   déplacé ni supprimé.**
3. Remettre l'interrupteur :
   - *par le lanceur* — menu Démarrer → **Pronto** → onglet **Paramètres** →
     « Mode développeur (dossiers de test) » → Activé (c'est le nom d'avant de l'emplacement
     de test). Ce réglage vaut pour **tout le poste**, pas pour un seul compte Windows, et les
     listes ne le suivent qu'à la prochaine ouverture du lanceur ;
   - *à la main* — ouvrir `C:\ProgramData\SZH\config.json` dans le Bloc-notes et poser
     `"emplacementRevues": "test"`, en gardant le reste du fichier tel quel.
4. Fermer le lanceur, le rouvrir : le titre doit dire `dossier de test (Revues-TESTING)` et
   les numéros reparaître.
5. Vérification à froid : les quatre numéros sont visibles dans l'Explorateur sous
   `C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING\Revue` et
   `…\Zeitschrift`, avec ou sans lanceur.
6. Si le titre disait déjà `dossier de test` et que la liste est vide : ce n'est pas
   l'interrupteur. Regarder si OneDrive a fini de synchroniser (icône de la barre des
   tâches), puis le journal du jour dans `C:\ProgramData\SZH\logs\`.
7. **Un geste de plus si le titre dit bien `production`** : la racine de production vient de
   l'**ancrage SharePoint**, et de rien d'autre depuis le 15.09.2026 (la clé de configuration
   qui pouvait la forcer a été supprimée) — le dossier `Daten_Allgemein - General`,
   **cherché**, pas déduit
   d'une variable d'environnement (`%OneDrive%` ne suffit pas). Introuvable : le bloc
   d'informations du lanceur porte une ligne dédiée (« Dossier partagé SharePoint
   introuvable : la liste ci-dessus restera vide tant que ce dossier ne sera pas rattaché. »),
   et un sélecteur de dossier s'ouvre au **prochain lancement qui suit de plus de 24 h** la
   dernière tentative — jamais plus tôt, pour ne pas harceler. Un dossier **enfant** de
   l'ancrage convient toujours, à n'importe quelle profondeur (la remontée des parents est
   gratuite, sans limite) : `Daten_Allgemein - General` lui-même, `2_Produkte`, un numéro
   précis, jusqu'au dossier des rapports. Un dossier **parent** convient aussi, mais la
   descente est bornée à 3 niveaux sous le dossier choisi (garde-fou anti-`C:\`) : `SZH CSPS`
   et `C:\Users\<compte>` sont tous deux à l'intérieur de cette limite sur ce poste, un
   ancêtre plus lointain ne le serait pas. Pour ne pas attendre les 24 h : poser
   `ancrageSharePoint` à la main dans
   `C:\ProgramData\SZH\config.json` (tout le poste) ou dans
   `%LOCALAPPDATA%\SZH\etat-utilisateur.json` (ce compte) fait sauter l'attente au lancement
   suivant. Détail complet de la résolution : `docs/RAPPORTS-ERREUR.md`, §1.

Sens inverse — passer un poste de rédaction en production : poser
`"emplacementRevues": "production"`, puis **déplacer** les numéros de
`Revues-TESTING\Revue` vers
`…\2_Produkte\54_Pronto\Revue` à la main (l'outil ne les suit pas tout seul, et la migration
automatique de `windows\szh-migration.ps1` ne touche JAMAIS SharePoint), et vérifier
au passage que la bibliothèque SharePoint est bien synchronisée sous ce nom-là.

---

## 8bis. Épinglage hors ligne (OneDrive Files On-Demand)

Demande de Robin, 24.09.2026 : que tout le monde ait, hors connexion et sans le moindre
geste, le numéro en cours de chaque revue et la bibliothèque `_NewsUndActu` — sans attendre
qu'un OneDrive « en ligne seulement » les télécharge au premier clic, un jour de coupure ou
de trajet.

**Ce qui est marqué « Toujours conserver sur cet appareil ».**

| Quoi | Où | Jamais |
|---|---|---|
| Chaque numéro **en cours** des revues | `Revue\`, `Zeitschrift\` de la racine **ACTIVE** (test ou production, selon `emplacementRevues`) | `_Archive\`, `Books\` (voir plus bas) |
| `_NewsUndActu\Fiches`, `_NewsUndActu\_Statuts` | racine de **PRODUCTION** (`<ancrage>\2_Produkte\54_Pronto`, que l'onglet Archive du cockpit lit toujours), **et** racine active si elle en diffère (mode test) | `_NewsUndActu\_Import-*` |

Un numéro se reconnaît à son `ausgabe.yaml`, même définition que partout ailleurs dans ce
document. `Books\` n'est **pas** demandé : `$script:SzhEpinglageProduits`
(`windows\szh-epinglage.ps1`) ne porte que `'revue'` et `'zeitschrift'` ; y ajouter `'livre'`
suffirait à l'inclure. La bibliothèque est ciblée **par nom** (`Fiches`, `_Statuts`), jamais
par un balayage de `_NewsUndActu\` entier — `_Import-*` n'est donc jamais concerné.

**La mécanique, mesurée sur ce poste.** Un dossier synchronisé par OneDrive porte l'attribut
.NET `ReparsePoint` (`0x400`) ; « Toujours conserver sur cet appareil » pose en plus
`FILE_ATTRIBUTE_PINNED` (`0x80000`), « Libérer de l'espace » pose `FILE_ATTRIBUTE_UNPINNED`
(`0x100000`) — deux valeurs que `[System.IO.FileAttributes]` ne nomme pas. Pour chaque
dossier cible dont l'attribut ne porte pas déjà `0x80000` : `attrib.exe +P -U "<dossier>" /S
/D` (`%SystemRoot%\System32\attrib.exe`), lancé en processus **caché et non attendu**
(`Start-Process -WindowStyle Hidden`, sans `-Wait`) — le lanceur ne doit jamais attendre un
téléchargement OneDrive. Un dossier déjà épinglé ne demande rien : ce qu'on y ajoutera
ensuite hérite de l'épinglage de son dossier. Un dossier hors OneDrive (pas de
`ReparsePoint`) est ignoré, jamais une erreur.

**Où.** `windows\szh-epinglage.ps1`, dot-sourcé par `windows\szh-common.ps1` (le huitième
fil, après la migration) :

| Fonction | Rôle |
|---|---|
| `Get-SzhDossiersAEpingler` | Pure : racine active + racine de production → la liste des dossiers à examiner. |
| `Test-SzhDossierEpingle` | L'attribut d'UN dossier → `'epingle'` \| `'aepingler'` \| `'horsonedrive'` \| `'absent'`. |
| `Start-SzhEpinglageProcessus` | Lance `attrib.exe` pour de vrai, caché et non attendu. |
| `Invoke-SzhEpinglageHorsLigne` | Orchestration : construit le plan (sauf s'il est fourni), applique la vérification et le lancement à chaque dossier, rend `{ examines; lances; deja; ignores }`. |

Appelée par `windows\open-produit.ps1`, juste après `Invoke-SzhCheckin`, dans un `try` —
jamais bloquant, jamais une fenêtre (D5) : un `attrib.exe` introuvable ou un dossier hors
OneDrive ne doit pas empêcher le lanceur de s'ouvrir. Une ligne de journal récapitulative
**seulement** quand quelque chose a vraiment été lancé — cette passe tourne à chaque
ouverture, la plupart du temps sans rien à faire.

**Réglage de désactivation**, dans `config.json` (comme les autres booléens, lus par
`Resolve-SzhBooleenConfig`) :

```json
{ "epinglageHorsLigne": false }
```

Absent = actif. Réglé à `false`, rien n'est examiné ni lancé.

**Jamais en simulation** (`SZH_LANCEUR_SIMULE=1`, comme `szh-ancrage.ps1` et
`szh-rapport.ps1`) : le plan est calculé comme d'habitude, mais aucun `attrib.exe` ne part
pour de vrai.

`test\js\epinglage-hors-ligne.test.js` éprouve le plan (numéros en cours seulement, jamais
`_Archive` ni `Books` ni `_Import-*`), la distinction production/racine active, le réglage
désactivé, la simulation, et les deux issues « lancé »/« déjà épinglé » — vérification
d'attribut et lancement de processus injectés, jamais un vrai `attrib.exe` dans un test.

---

## 9. Ce qui reste à poser

- **Le cockpit ne dit pas encore l'emplacement actif** dans sa barre latérale : seul le
  lanceur le montre ; le badge de la barre d'état (§6) ne fait qu'annoncer, il ne règle plus
  rien depuis que le réglage a déménagé dans l'onglet **Paramètres** du lanceur.
- **`bootstrap.ps1` pose encore `devMode = $true`** sur un poste neuf, donc l'emplacement
  de test. Sur un poste de rédaction, poser `"emplacementRevues": "production"` juste après
  l'installation — ou corriger le script.
- **`revuesRoots` est trompeuse** : elle ne sert plus qu'au comptage des numéros restés
  dehors. Elle peut être vidée sans rien casser.
- **Le dossier `54_Pronto` reste à créer sur SharePoint** : le code le nomme ainsi des deux
  côtés (§1) ; reste à poser le dossier dans la bibliothèque et à publier.
- **`Secrétariat und Export\`, `_Systeme\journaux\` et `_Systeme\suggestions\` sont
  créés mais vides** : aucun code n'y écrit encore. Les exports du secrétariat demandent
  toujours leur dossier de sortie à l'utilisateur. `_Systeme\inventaire\`, lui, est écrit
  depuis le 15.09.2026 (`windows\szh-checkin.ps1`).
