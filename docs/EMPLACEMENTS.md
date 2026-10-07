# Où vivent les publications

Les numéros de la Revue et de la Zeitschrift, les livres et la bibliothèque de la
Documentation vivent dans des dossiers synchronisés par OneDrive. Pronto connaît deux
racines : une racine de **test** et une racine de **production**. Un réglage du poste choisit
la racine active ; le code ne contient aucun autre chemin de travail.

Cette page décrit les deux racines, leur arborescence, le dossier `_Systeme\` commun à tous
les postes, ce qui reste sur le poste, et comment passer de test à production. Les mots
« numéro », « toolkit » et « Accueil » sont définis dans le
[vocabulaire](ARCHITECTURE.md#vocabulaire).

## Les deux racines

| Emplacement | Racine |
|---|---|
| `test` | `%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING` |
| `production` | `<ancrage>\2_Produkte\54_Pronto` |

L'**ancrage** est le dossier `Daten_Allgemein - General` de la bibliothèque SharePoint
synchronisée. Pronto le cherche sur le poste ; il ne le déduit pas d'une variable
d'environnement. Sur un poste ordinaire, il vaut
`%USERPROFILE%\SZH CSPS\Daten_Allgemein - General`. La recherche est décrite plus bas, dans
[L'ancrage SharePoint](#lancrage-sharepoint).

`54_Pronto` est le dossier de l'application. Les autres dossiers de `2_Produkte`
(`52_Revue`, `53_Zeitschrift`, `54_Buch`, `51_Dokumentation`…) appartiennent à d'autres
équipes : Pronto ne les lit pas et n'y écrit pas.

La clé `emplacementRevues` de `C:\ProgramData\SZH\config.json` choisit la racine active
([Choisir la racine active](#choisir-la-racine-active)). Changer cette clé ne déplace aucun
fichier : seul l'endroit où Pronto regarde change.

## L'arborescence

Les deux racines ont la même arborescence. Un essai dans la racine de test passe donc par les
mêmes chemins que la production.

```
<racine active>\                 test ou production, selon emplacementRevues
├── Revue\                       numéros en cours de la Revue
├── Zeitschrift\                 numéros en cours de la Zeitschrift
├── Books\                       livres en cours
├── _Archive\
│   ├── Revue\
│   ├── Zeitschrift\
│   └── Books\
├── _NewsUndActu\                bibliothèque de la Documentation
│   ├── Fiches\
│   ├── _Statuts\fr\
│   ├── _Statuts\de\
│   └── _Moissons\               propositions des moissonneurs
└── Exports\
    ├── Newsletter\
    ├── Edudoc\
    ├── Caractères par article\
    ├── Contrôle des métadonnées\
    └── Préprocessing\

<racine de production>\          toujours celle-ci, même en mode test
└── _Systeme\
    ├── rapports\
    ├── inventaire\
    ├── compteurs\
    └── exports\
```

Règles de l'arborescence :

- Un dossier est un numéro s'il contient un `ausgabe.yaml`, un livre s'il contient un
  `buch.yaml`. Les autres dossiers sont ignorés.
- Un numéro en cours est à un niveau sous la racine, un numéro archivé à deux. Le code
  retrouve la racine en reconnaissant les noms de dossier (le dossier produit, puis
  `_Archive`), jamais en comptant des niveaux.
- L'archivage déplace un numéro de `Revue\` vers `_Archive\Revue\` dans la même racine
  (`windows/archive-revue.ps1`, lancé depuis le panneau d'export du cockpit).
- Les noms de dossier commencent par une majuscule : on les lit dans l'Explorateur.

En emplacement `test`, Pronto crée au démarrage les dossiers manquants de l'arbre, sauf
`_Systeme\` (`Initialize-SzhEmplacementsTest`). En production, il ne crée rien : l'arbre est
celui de SharePoint.

### Qui écrit dans les dossiers hors produit

| Dossier | Contenu | Écrit par |
|---|---|---|
| `_NewsUndActu\Fiches\` | les fiches de la Documentation, communes aux deux rédactions ([`FORMAT-DOCUMENTATION-KIRBY.md`](FORMAT-DOCUMENTATION-KIRBY.md)) | le cockpit |
| `_NewsUndActu\_Statuts\fr\`, `_Statuts\de\` | l'état des fiches, par langue | le cockpit |
| `_NewsUndActu\_Moissons\` | un dossier par moissonneur, ses lots de propositions et les décisions de la rédaction ([`FORMAT-PROPOSITIONS.md`](FORMAT-PROPOSITIONS.md), [`FORMAT-MOISSONS.md`](FORMAT-MOISSONS.md)) | les moissonneurs et le cockpit |
| `Exports\<export>\` | les sorties du secrétariat : newsletter, Edudoc, caractères par article, contrôle des métadonnées | l'Accueil (`lib/accueil-secretariat-hote.js`) |
| `Exports\Préprocessing\` | un dossier par nettoyage de manuscrit : la copie du Word, le document nettoyé et son rapport | l'onglet Préprocessing de l'Accueil (`lib/accueil-preproc-hote.js`) |

Côté PowerShell, la table `$SzhDossiersCommuns` (`windows/szh-produits.ps1`) ne garantit que
l'existence de `Fiches\`, `_Statuts\fr\`, `_Statuts\de\` et `Exports\`.

## Le dossier `_Systeme\`

`_Systeme\` reçoit ce que tous les postes doivent voir au même endroit : rapports d'erreur,
inventaire des postes, compteurs d'usage, historique des exports. Il est toujours sous la
racine de **production**, dérivé de l'ancrage, même quand le poste travaille en test.
Ainsi, deux postes sur des emplacements différents écrivent dans le même dossier.

| Dossier | Contenu | Écrit par |
|---|---|---|
| `_Systeme\rapports\` | les rapports d'erreur automatiques, un JSON par incident ([`RAPPORTS-ERREUR.md`](RAPPORTS-ERREUR.md)) | `lib/rapport-erreur.js`, `windows/szh-rapport.ps1` |
| `_Systeme\inventaire\` | l'inventaire des postes : un CSV par machine (`<POSTE>.csv`), une ligne par mois et par compte Windows | `windows/szh-checkin.ps1` |
| `_Systeme\compteurs\` | les compteurs d'usage du nettoyeur et de l'import, un petit CSV par événement, sans texte de manuscrit ([format](RAPPORTS-ERREUR.md#les-compteurs-dusage)) | `lib/compteurs.js` |
| `_Systeme\exports\` | `historique.json` : pour Edudoc et « Caractères par article », la date du dernier export de chaque numéro, pour que tous les postes précochent les mêmes numéros. En mode test : `historique-test.json` | `lib/accueil-secretariat-hote.js` |

Le chemin vient de `Get-SzhDossierSysteme` (`windows/szh-produits.ps1`) côté PowerShell et
de `dossierSystemeDepuisAncrage` (`lib/rapport-erreur.js`) côté cockpit. Les deux partent de
l'ancrage, et non de la racine active. Si l'ancrage est introuvable, ils rendent un chemin
vide : l'appelant écrit une ligne de journal et n'écrit rien ailleurs. Le dossier est créé
s'il manque.

L'inventaire contient l'adresse de connexion de la personne, dans une colonne. Le nom du
fichier, lui, ne porte que le nom de la machine, parce qu'il est visible de tous dans le
dossier partagé. Le CSV est en UTF-8 avec BOM et séparateur point-virgule : il s'ouvre d'un
double-clic dans Excel. Il n'est écrit que si l'ancrage est trouvé.

L'historique des exports se lit avec tolérance : absent, illisible ou injoignable, il vaut
un historique vide, et l'export continue. Il s'écrit par un fichier temporaire préfixé `~$`,
après relecture et fusion.

## L'ancrage SharePoint

`Resolve-SzhAncrage` (`windows/szh-ancrage.ps1`) cherche l'ancrage à quatre niveaux, sans
jamais ouvrir de fenêtre :

| Niveau | Origine | Source |
|---|---|---|
| 1 | `essai` | la variable d'environnement `SZH_ANCRAGE` |
| 2 | `config` | `C:\ProgramData\SZH\config.json`, clé `ancrageSharePoint` (tout le poste) |
| 3 | `cache` | `%LOCALAPPDATA%\SZH\etat-utilisateur.json`, clé `ancrageSharePoint` (ce compte) ; un chemin disparu est ignoré et effacé |
| 4 | `auto` | recherche dans `%USERPROFILE%\SZH CSPS`, `%OneDriveCommercial%`, `%OneDrive%`, `%USERPROFILE%\OneDrive - SZH CSPS`, puis les autres dossiers candidats du profil |

Au démarrage de Pronto, `Initialize-SzhAncrage` ajoute un cinquième niveau : si rien n'est
trouvé, elle ouvre un sélecteur de dossier. Elle ne le fait qu'une fois par lancement, et
pas plus d'une fois toutes les 24 heures. Un succès est mémorisé dans `etat-utilisateur.json`.

Dans le sélecteur, on peut choisir :

- l'ancrage lui-même, ou n'importe quel dossier en dessous (`2_Produkte`, un numéro…) :
  Pronto remonte les parents ;
- un dossier au-dessus de l'ancrage, jusqu'à trois niveaux plus haut (`SZH CSPS`, le dossier
  du profil) : Pronto descend, mais pas plus loin, pour ne pas parcourir tout un disque.

Le cockpit lit l'ancrage avec `resoudreAncrage()` (`lib/rapport-erreur.js`), sur les trois
premiers niveaux seulement. Il compte sur le démarrage de Pronto, qui a déjà rempli le cache.

## Ce qui reste sur le poste

Ces fichiers ne dépendent pas de la racine active.

| Quoi | Chemin |
|---|---|
| Configuration du poste, lue par PowerShell et le cockpit | `C:\ProgramData\SZH\config.json` |
| État du poste (version du toolkit, langue) | `C:\ProgramData\SZH\state.json` |
| Toolkit déployé | `C:\ProgramData\SZH\toolkit\` (`VERSION`, `pipeline\`, `windows\`, `revue-template\`, `vscodium-user\`…) |
| Téléchargements des mises à jour | `C:\ProgramData\SZH\staging\` |
| Journal (une ligne par action, un fichier par mois) | `C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log` |
| Journaux d'installation et de mise à jour | `C:\ProgramData\SZH\logs\bootstrap-<horodatage>.log`, `update-<horodatage>.log` |
| Auteurs et autrices publiés (autocomplétion, cache OAI-PMH) | `C:\ProgramData\SZH\auteurs.json` |
| Disque de la WSL, un par compte | `C:\ProgramData\SZH\WSL\<SID>\SZH-Publishing\ext4.vhdx` |
| État de ce compte : ancrage en cache, langue, mise à jour silencieuse, anti-inondation des rapports, anciennes clés Shlink et OJS chiffrées | `%LOCALAPPDATA%\SZH\etat-utilisateur.json` |
| Cadence de la mise à jour hebdomadaire, par compte | `%LOCALAPPDATA%\SZH\maj-auto.json` |
| Rapports et compteurs en attente de réseau | `%LOCALAPPDATA%\SZH\rapports-en-attente\`, `%LOCALAPPDATA%\SZH\compteurs-en-attente\` |
| Lien `szh://traduction/…` en attente d'ouverture | `%LOCALAPPDATA%\SZH\intention.json` |
| Réglages de VSCodium et de Pronto (produit proposé, adresse Shlink, langue, thème…) | `%APPDATA%\VSCodium\User\settings.json` |
| Clés d'API Shlink, OJS et Mistral | le coffre de VSCodium, chiffré pour ce compte ([`SECURITE.md`](SECURITE.md#les-secrets-sur-le-poste)) |
| Extensions VSCodium | `%USERPROFILE%\.vscode-oss\extensions\` |
| Raccourcis du menu Démarrer | `Pronto.lnk` et `Pronto (Updater).lnk`, noms tenus par `$SzhNomApplication` et `$SzhNomMiseAJour` (`windows/szh-shell.ps1`) |

Le désinstalleur retire `C:\ProgramData\SZH` sauf `WSL\` : les disques des distributions ne
sont ni désinscrits ni supprimés ([`MAINTENANCE.md`](MAINTENANCE.md)).

## Ce qu'un numéro contient en plus

### Le raccourci « Ouvrir la revue »

Chaque numéro contient `Ouvrir la revue.lnk` (`Ouvrir le livre.lnk` pour un livre). Il ne
contient aucun chemin propre au poste ou au compte :

```
cible      %WINDIR%\System32\wscript.exe
arguments  //B "<toolkit>\windows\hidden.vbs" "<toolkit>\windows\open-revue.ps1" "szh://ouvrir/<produit>/<id>"
```

Le numéro est désigné par son `id:` (dans `ausgabe.yaml` ou `buch.yaml`), posé une fois et
jamais recalculé. Le raccourci fonctionne donc sur tous les postes, après un renommage ou un
archivage. Il est posé par `Set-SzhRaccourciRevue` (`windows/szh-shell.ps1`), qui ajoute
l'`id:` s'il manque.

### Le dossier `.szh-avant-reimport\`

« Réimporter cet article » enregistre l'état d'avant dans
`.szh-avant-reimport\<slug>\<horodatage>\`, à la racine du numéro : le dossier de l'article,
le Word remplacé, la fiche que ce Word aurait produite, les portraits, un `journal.txt` et un
`LISEZ-MOI.txt` bilingue. Ce dossier suit le numéro (synchronisation, archivage). Rien ne le
vide : on le supprime à la main une fois le numéro publié.

Le point initial le cache à l'explorateur du cockpit et aux recensements d'articles. Les
dossiers `articles\.szh-reimport-<slug>\` et `articles\.szh-bascule-<slug>\` sont autre chose :
des opérations en cours, reprises ou nettoyées à la compilation suivante.

## Choisir la racine active

```json
{
  "emplacementRevues": "test"
}
```

La clé est lue dans cet ordre, de la même façon par PowerShell (`Resolve-SzhEmplacementRevues`)
et par le cockpit (`resoudreEmplacementRevues`, `lib/archivage.js`) :

1. `emplacementRevues` : `"test"` ou `"production"`, casse et espaces indifférents ;
2. sinon `devMode`, l'ancienne clé : `true` donne `test`, `false` donne `production`
   (`"true"`, `"false"`, `1` et `0` sont acceptés) ;
3. sinon `test`.

Si `config.json` ne porte aucune des deux clés, Pronto écrit `emplacementRevues` au premier
lancement (`Initialize-SzhEmplacementRevues`). Il choisit `production` seulement si la
racine de production contient des numéros et celle de test aucun ; sinon `test`. Le choix
est journalisé :

```
emplacement des revues : "test" ecrit dans config.json (numeros trouves : test 4, production 0)
```

**Changer d'emplacement.** Dans l'Accueil, onglet Paramètres, le réglage « Mode développeur
(dossiers de test) » écrit les deux clés à la fois (`configAvecEmplacement`,
`lib/archivage.js`). Il vaut pour tout le poste, pas pour un seul compte. On peut aussi
modifier `config.json` dans le Bloc-notes.

Effet de la bascule :

| | vers `production` | vers `test` |
|---|---|---|
| Fichiers déplacés | aucun | aucun |
| Numéros listés par l'Accueil | ceux de `54_Pronto` | ceux de `Revues-TESTING` |
| Un nouveau numéro est créé dans | `…\54_Pronto\Revue` | `Revues-TESTING\Revue` |
| L'archivage déplace vers | `…\54_Pronto\_Archive\Revue` | `Revues-TESTING\_Archive\Revue` |
| Dossiers manquants de l'arbre | ne sont pas créés | sont créés au lancement suivant |
| Avertissement affiché | aucun | bandeau « Mode test » dans l'Accueil, badge « Dossier de test » dans la barre d'état |
| Numéro déjà ouvert dans l'éditeur | reste ouvert et compile : son chemin est celui de la fenêtre | idem |
| `_Systeme\`, toolkit, WSL, journaux, réglages | inchangés | inchangés |

Un poste neuf démarre en `test` : `bootstrap.ps1` écrit `devMode = $true`. Sur un poste de
rédaction, on passe en production juste après l'installation.

### Passer un poste en production

1. Poser `"emplacementRevues": "production"` (Accueil → Paramètres, ou `config.json`).
2. Déplacer à la main les numéros de `Revues-TESTING\Revue` (et `Zeitschrift`, `Books`) vers
   les mêmes dossiers sous `…\2_Produkte\54_Pronto\`. Pronto ne les déplace pas.
3. Vérifier que la bibliothèque SharePoint est synchronisée sous le nom attendu, et que
   l'Accueil affiche le chemin de production.

`windows/szh-migration.ps1` (`Invoke-SzhMigrationArborescence`, lancé par `update.ps1` à
chaque mise à jour) ne travaille que dans la racine de test. Il range les numéros de
l'ancienne forme (`52_Revue\RV02_Redaction`, `53_Zeitschrift\ZS99_Archives`…) dans
l'arborescence actuelle, un numéro à la fois, sans jamais écraser : en cas de conflit de nom,
la source reste en place et le conflit est journalisé. Il pose aussi les `id:` manquants et
refait les raccourcis.

## Lire l'emplacement actif

- **L'Accueil**, onglet du produit, sous la liste : « Revue dans : `<chemin>` ». En mode
  test, un bandeau dit que tout ce qu'on crée va dans le dossier de test. En production,
  si l'ancrage est introuvable, un bandeau le dit aussi.
- **La barre d'état du cockpit**, quand un numéro est ouvert et le poste en test : un badge
  « Dossier de test » (« Testordner »). Un clic ouvre l'onglet Paramètres de l'Accueil.
- **Le journal** `C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log`, une ligne par lancement :

  ```
  revues : emplacement "test" -> C:\Users\<compte>\OneDrive - SZH CSPS\Revues-TESTING
  ```

## Dépannage : l'Accueil n'affiche plus les numéros

1. Ouvrir Pronto et lire, sous la liste, la ligne « Revue dans : … ».
2. Si le chemin est celui de `54_Pronto` et que les numéros sont dans `Revues-TESTING` : le
   poste est du mauvais côté. Rien n'est perdu. Activer « Mode développeur (dossiers de
   test) » dans Accueil → Paramètres, ou poser `"emplacementRevues": "test"` dans
   `config.json`, puis rouvrir Pronto.
3. Si le chemin est celui de `Revues-TESTING` et la liste vide : vérifier dans l'Explorateur
   que les numéros sont bien sous `Revues-TESTING\Revue`, puis que OneDrive a fini de
   synchroniser, puis lire le journal du jour.
4. Si l'Accueil affiche « Dossier partagé SharePoint introuvable » : l'ancrage n'est pas
   trouvé. Le sélecteur de dossier s'ouvrira au prochain lancement, si la dernière demande
   date de plus de 24 heures. Pour ne pas attendre, poser `ancrageSharePoint` à la main,
   avec le chemin de `Daten_Allgemein - General`, dans `C:\ProgramData\SZH\config.json`
   (tout le poste) ou dans `%LOCALAPPDATA%\SZH\etat-utilisateur.json` (ce compte).

## Épinglage hors ligne

À chaque lancement, Pronto marque « Toujours conserver sur cet appareil » les dossiers dont
la rédaction a besoin, pour qu'ils restent disponibles sans réseau :

| Épinglé | Où | Jamais épinglé |
|---|---|---|
| chaque numéro et chaque livre en cours (dossier avec `ausgabe.yaml` ou `buch.yaml`) | `Revue\`, `Zeitschrift\`, `Books\` de la racine active | `_Archive\` |
| `_NewsUndActu\Fiches` et `_NewsUndActu\_Statuts` | racine de production, et racine active si elle est différente | le reste de `_NewsUndActu\` |

Fonctionnement (`windows/szh-epinglage.ps1`) :

- Un dossier synchronisé par OneDrive porte l'attribut `ReparsePoint` (`0x400`). Un dossier
  épinglé porte en plus `0x80000` (`FILE_ATTRIBUTE_PINNED`). Un dossier hors OneDrive est
  ignoré.
- Pour un dossier pas encore épinglé, Pronto lance deux fois
  `%SystemRoot%\System32\attrib.exe`, caché et sans attendre la fin :
  `+P -U "<dossier>"`, puis `+P -U "<dossier>\*" /S /D`. Le second appel est nécessaire :
  `attrib "<dossier>" /S /D` ne descend pas dans le dossier, il cherche des dossiers du même
  nom dans l'arbre parent.
- Un fichier ajouté plus tard dans un dossier épinglé hérite de l'épinglage.
- Une ligne de journal n'est écrite que si un `attrib.exe` a été lancé.
- Rien n'est lancé en simulation (`SZH_LANCEUR_SIMULE=1`). Une erreur n'empêche jamais
  Pronto de s'ouvrir.

Pour désactiver l'épinglage sur un poste, dans `config.json` :

```json
{ "epinglageHorsLigne": false }
```

## Qui décide quoi dans le code

| Où | Rôle |
|---|---|
| `windows/szh-produits.ps1` · `$SzhSousDossiers`, `$SzhDossiersCommuns` | la table des dossiers de l'arborescence, une seule pour les deux racines |
| `windows/szh-produits.ps1` · `Get-SzhBaseRevuesPour` | la racine d'un emplacement : surcharge d'essai, puis ancrage (production), puis valeur par défaut |
| `windows/szh-produits.ps1` · `Resolve-SzhEmplacementRevues`, `Get-SzhEmplacementRevues` | la règle de lecture de `emplacementRevues` |
| `windows/szh-produits.ps1` · `Get-SzhDossierSysteme` | le chemin d'un sous-dossier de `_Systeme\` |
| `windows/szh-produits.ps1` · `Get-SzhVolumePour`, `Find-SzhNumeroVolume` | le volume d'après l'année (Zeitschrift : année − 1994 ; Revue : année − 2010), et le refus d'un numéro déjà existant |
| `windows/szh-ancrage.ps1` · `Resolve-SzhAncrage`, `Initialize-SzhAncrage` | l'ancrage SharePoint |
| `windows/szh-shell.ps1` · `Invoke-SzhTachesDemarrage` | au lancement : ancrage, envoi des rapports en attente, inventaire, épinglage, dossiers de test, secrets |
| `windows/new-revue.ps1`, `new-livre.ps1`, `archive-revue.ps1` | création et archivage, dans la racine active |
| `windows/szh-migration.ps1` | rangement de l'ancienne forme, dans la racine de test seulement |
| `lib/inventaire.js` | côté cockpit : la racine active et les numéros listés par l'Accueil |
| `lib/archivage.js` | côté cockpit : lecture et écriture de `emplacementRevues` |
| `lib/kirby-contenu.js` · `racineArbre` | remonte d'un numéro ouvert jusqu'à la racine, puis `_NewsUndActu\Fiches\` |

`test/js/emplacements.test.js` soumet PowerShell et cockpit aux mêmes configurations et
vérifie qu'ils choisissent la même racine. `test/js/inventaire.test.js` fait de même pour la
liste des numéros.

Pour un essai, des variables d'environnement remplacent les racines telles quelles :
`SZH_RACINE_TEST`, `SZH_RACINE_PROD`, `SZH_ANCRAGE`. Elles ne doivent pas être posées sur un
poste de rédaction.

La clé `revuesRoots` de `config.json` liste des dossiers hors de l'arborescence. Elle sert
seulement à compter les numéros qui y restent, avec `%OneDrive%\Revues`, pour les signaler
sous la liste de l'Accueil.

## Renommer le dossier de l'application

Le nom `54_Pronto` est écrit à deux endroits :

| Langage | Constante | Fichier |
|---|---|---|
| PowerShell | `$script:SzhSegmentApplication` | `windows/szh-ancrage.ps1` |
| JavaScript | `SEGMENT_APPLICATION` | `vscodium-extension/szh-cockpit/lib/rapport-erreur.js` |

Pour renommer le dossier : changer les deux constantes, renommer le dossier sur SharePoint,
publier une version. La racine de production, `_Systeme\` et les rapports suivent.
`test/js/ancrage-sharepoint.test.js` et `test/js/rapport-erreur.test.js` refusent que le nom
soit écrit ailleurs ; `test/js/rapport-erreur-ps.test.js` vérifie que les deux constantes
donnent le même chemin.
