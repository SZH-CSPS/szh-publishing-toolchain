# Où vivent les revues

Un seul réglage décide de l'endroit où le lanceur cherche, crée et archive les numéros :
la clé **`emplacementRevues`** de `C:\ProgramData\SZH\config.json`, qui vaut `test` ou
`production`. Elle déplace la **racine** de tout le travail. Elle ne déplace **aucun
fichier** : les dossiers restent où ils sont, c'est le regard de l'outil qui change.

État constaté sur le poste `robin` le 2026-08-23. Les listings ci-dessous viennent du
disque, pas du code.

---

## 1. Les deux racines

| Emplacement | Racine | Ce qu'elle contient vraiment |
|---|---|---|
| `test` | `C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING` | **Les quatre numéros produits par l'outil.** Rien d'autre. |
| `production` | `C:\Users\robin\SZH CSPS\Daten_Allgemein - General\2_Produkte` | La bibliothèque SharePoint historique : Word, Excel, dossiers par année. **Aucun numéro de l'outil.** |

Les deux racines sont surchargeables par la clé `basesRevues` de `config.json`
(sous-clés `dev` pour l'emplacement de test, `prod` pour la production — noms d'origine,
gardés parce que des postes les portent). À corriger si un poste synchronise la
bibliothèque SharePoint sous un autre nom.

**Sur ce poste, l'emplacement actif est `test`** : la clé était absente de `config.json`,
et le défaut, en son absence, était l'emplacement de test. Les vraies revues de cet
éditeur vivent donc dans `Revues-TESTING`.

### Mêmes sous-dossiers dans les deux racines

| | Revue (fr) | Zeitschrift (de) |
|---|---|---|
| en cours | `52_Revue\RV02_Redaction` | `53_Zeitschrift\ZS02_Redaktion` |
| archives | `52_Revue\RV99_Archives` | `53_Zeitschrift\ZS99_Archives` |

Un dossier n'est un numéro que s'il porte un `ausgabe.yaml`. Tout le reste est ignoré par
le lanceur, listé ou non.

---

## 2. Ce que chaque racine contient, dossier par dossier

### `test` — `…\OneDrive - SZH CSPS\Revues-TESTING`

| Dossier | Contenu réel |
|---|---|
| `52_Revue\RV02_Redaction` | `2027-01`, `2027-02`, `test` — trois numéros (avec `ausgabe.yaml`) · `2027-05` — dossier **sans** `ausgabe.yaml`, invisible du lanceur |
| `52_Revue\RV99_Archives` | vide |
| `53_Zeitschrift\ZS02_Redaktion` | `2027-01` — un numéro |
| `53_Zeitschrift\ZS99_Archives` | vide |

Un numéro ressemble à ceci : `ausgabe.yaml`, `articles/`, `articles-word/`, `out/`,
`BIENVENUE.md`, `Ouvrir la revue.lnk`.

### `production` — `…\SZH CSPS\Daten_Allgemein - General\2_Produkte`

| Dossier | Contenu réel | Numéros de l'outil |
|---|---|---|
| `52_Revue\RV02_Redaction` | 18 entrées : `Revue_2023` … `Revue_2027`, `_Thèmes`, `_Rubriques`, `Idées 2028.docx`, `Liste Mots Clés Revue Edudoc.xlsx`, … | **0** |
| `52_Revue\RV99_Archives` | 1 entrée : `README - BITTE LESEN.rtf` | **0** |
| `53_Zeitschrift\ZS02_Redaktion` | 15 entrées : `Ausgaben`, `Archiv`, `Beirat`, `Konzept`, `Themenschwerpunkte`, … | **0** |
| `53_Zeitschrift\ZS99_Archives` | 8 entrées : `Planung`, `Logbuch`, `Marketing`, … | **0** |

La racine `2_Produkte` porte aussi `50_Open_Access`, `51_Dokumentation`, `56_Website`,
`57_Kongress`, `58_Forum`, `Bücher`, `Podcast`… : l'outil n'y touche pas et ne les regarde
pas.

**Conséquence, à lire deux fois :** basculer sur `production` aujourd'hui ouvre un lanceur
dont les deux listes sont **vides**. Rien n'aura été perdu — les quatre numéros seront
toujours dans `Revues-TESTING` — mais le lanceur ne les montrera plus.

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
| État de **ce compte** (environnement WSL, extensions posées) | `C:\Users\robin\AppData\Local\SZH\etat-utilisateur.json` |
| Cadence de la vérification hebdomadaire, par compte | `C:\Users\robin\AppData\Local\SZH\maj-auto.json` |
| Auteur·e·s publiés (autocomplétion, cache OAI-PMH) | `C:\ProgramData\SZH\auteurs.json` |
| Journal (une ligne par geste, un fichier par mois) | `C:\ProgramData\SZH\logs\szh-2026-08.log` |
| Journaux détaillés d'une mise à jour | `C:\ProgramData\SZH\logs\update-<horodatage>.log` |
| Téléchargements et versions installables hors ligne | `C:\ProgramData\SZH\staging\` (`toolkit-<v>.zip`, `manifest-<v>.json`, `szh-publishing-rootfs-<v>.tar.gz`) |
| Toolkit déployé (maquette, scripts, gabarit) | `C:\ProgramData\SZH\toolkit\` — `VERSION`, `pipeline\`, `windows\`, `revue-template\`, `vscodium-user\` |
| Version du toolkit installée | `C:\ProgramData\SZH\toolkit\VERSION` → `2026.08.41` |
| Disque de la distro WSL, **un par compte** | `C:\ProgramData\SZH\WSL\<SID>\SZH-Publishing\ext4.vhdx` (2,4 Go) |
| Journaux détaillés d'une installation | `C:\ProgramData\SZH\logs\bootstrap-<horodatage>.log` |
| Extensions VSCodium installées | `C:\Users\robin\.vscode-oss\extensions\` — dont `szh-csps.szh-cockpit-0.22.1` et `szh-csps.szh-apercu-0.1.2` |
| Réglages de l'éditeur | `C:\Users\robin\AppData\Roaming\VSCodium\User\settings.json` |
| Intention d'ouverture (lien `szh://`, usage unique) | `C:\Users\robin\AppData\Local\SZH\intention.json` |
| Raccourcis du menu Démarrer | `Revues SZH.lnk`, `Zeitschriften SZH.lnk` (posés par `update.ps1`) |
| Archives d'un numéro | **dans la racine active**, sous `…RV99_Archives` / `…ZS99_Archives` |

L'archivage ne sort jamais de la racine active : un numéro archivé passe de
`RV02_Redaction` à `RV99_Archives` **de la même racine**.

---

## 4. Qui décide quoi

| Où | Quoi | Appelé par |
|---|---|---|
| `windows\szh-common.ps1` · `Resolve-SzhEmplacementRevues` | La règle : clé neuve, puis clé ancienne, puis défaut. Pure, ne lit ni disque ni fichier. | tout le reste de cette liste |
| `windows\szh-common.ps1` · `Initialize-SzhEmplacementRevues` | Écrit la valeur en clair dans `config.json` si elle manque, après avoir compté les numéros des deux racines. Une fois par poste, journalisée. | `Get-SzhEmplacementRevues` |
| `windows\szh-common.ps1` · `Get-SzhEmplacementRevues` | Passage obligé : `test` ou `production`. | `Get-SzhBaseRevues`, `Get-SzhEtiquetteRacine`, `Get-SzhDevMode` |
| `windows\szh-common.ps1` · `Get-SzhBaseRevues` / `Get-SzhBaseRevuesPour` | La racine, `basesRevues` compris. **Seul endroit du dépôt qui connaît ces deux chemins.** | `Get-SzhEmplacements` |
| `windows\szh-common.ps1` · `Get-SzhEmplacements` | Les quatre dossiers du poste, plus l'emplacement actif. Journalise la racine une fois par lancement. | `open-revue.ps1`, `new-revue.ps1`, `archive-revue.ps1` |
| `windows\szh-common.ps1` · `Initialize-SzhEmplacementsTest` | Crée les quatre dossiers manquants — **en test seulement**. En production, jamais : l'arborescence est celle de SharePoint. | `open-revue.ps1` |
| `windows\open-revue.ps1` | Le lanceur : liste les numéros de la racine active, affiche version et racine, ouvre VSCodium. | menu Démarrer, liens `szh://` |
| `windows\new-revue.ps1` | Crée un numéro dans le dossier « en cours » de la racine active, et écrit son année, son numéro et son volume. | bouton « Nouvelle revue… » |
| `windows\szh-common.ps1` · `Get-SzhVolumePour` | Le volume d'après l'année : Zeitschrift = année − 1994, Revue = année − 2010. **Seul endroit du dépôt qui porte ces deux années zéro.** | le formulaire « Nouvelle revue… », `new-revue.ps1` |
| `windows\szh-common.ps1` · `Find-SzhNumeroVolume` | Cherche un numéro déjà posé sur un couple volume + numéro, **en cours et dans les archives** de la racine active. Rend son nom et son chemin ; ne supprime ni ne déplace rien. | le formulaire « Nouvelle revue… » |
| `test\js\volume-numero.test.js` | Juge la formule du volume contre un relevé de `ojs.szh.ch` (neuf millésimes) et éprouve le refus du doublon sur une arborescence jetable. | `node --test` |
| `windows\archive-revue.ps1` | Déplace un numéro « en cours » ⇄ « archives », dans la racine active. | panneau d'export du cockpit |
| `szh-cockpit\lib\archivage.js` · `resoudreEmplacementRevues` | La même règle, côté cockpit. Ne connaît **aucun** chemin de revue : il ne rend que la décision. | réglages du cockpit |
| `szh-cockpit\lib\archivage.js` · `ecrireEmplacementRevues` | La bascule depuis « Réglages SZH ». Écrit les deux clés à la fois. | `extension.js` |
| `windows\bootstrap.ps1` | Pose `config.json` sur un poste neuf, avec `devMode = $true` (donc l'emplacement de test). | installation, une fois |
| `test\js\emplacements.test.js` | Soumet les deux moitiés aux mêmes configurations et refuse qu'elles divergent. | `node --test` |

---

## 5. Ce que change la bascule, concrètement

| | `test` → `production` | `production` → `test` |
|---|---|---|
| **Ce qui bouge** | rien sur le disque | rien sur le disque |
| **Ce que le lanceur liste** | les numéros de `2_Produkte` (aujourd'hui : aucun) | les numéros de `Revues-TESTING` |
| **Ce qui devient invisible** | les 4 numéros de `Revues-TESTING` | les numéros de `2_Produkte`, s'il y en a un jour |
| **« Nouvelle revue… » crée dans** | `2_Produkte\52_Revue\RV02_Redaction` | `Revues-TESTING\52_Revue\RV02_Redaction` |
| **L'archivage déplace vers** | `2_Produkte\…\RV99_Archives` | `Revues-TESTING\…\RV99_Archives` |
| **Les quatre dossiers manquants** | ne sont **pas** créés | sont créés au prochain lancement |
| **Un numéro déjà ouvert dans l'éditeur** | reste ouvert et se compile normalement : le chemin est celui de la fenêtre, pas celui du réglage | idem |
| **Ce qui ne bouge pas** | toute la colonne du §3 : toolkit, WSL, extensions, journal, réglages de l'éditeur | idem |

---

## 6. Lire l'emplacement actif sans ouvrir un fichier

1. **Le titre de la fenêtre du lanceur** (menu Démarrer → *Revues SZH* / *Zeitschriften
   SZH*) le porte toujours, dans les deux sens :
   - `Revues SZH — dossier de test (Revues-TESTING)`
   - `Revues SZH — dossier de production (2_Produkte)`
   - `Zeitschriften SZH — Testordner (Revues-TESTING)`
   - `Zeitschriften SZH — Produktionsordner (2_Produkte)`
2. **Le bloc d'informations du lanceur**, sous les deux listes, donne le chemin complet de
   la racine active — dans les **deux** racines, et non plus en test seulement. C'était le
   cas grave qui restait muet : un lanceur basculé sur `production`, listes vides, ne disait
   pas pourquoi.
   - `Revue dans : C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING`
   - `Revue dans : C:\Users\robin\SZH CSPS\Daten_Allgemein - General\2_Produkte`
   - `Zeitschrift in: C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING`
   Le mot « dossier de test » n'y est plus, mais le chemin le nomme : `Revues-TESTING` d'un
   côté, `2_Produkte` de l'autre. Et le titre de la fenêtre, lui, garde l'étiquette en clair.
3. **Le journal** `C:\ProgramData\SZH\logs\szh-<année>-<mois>.log` porte une ligne par
   lancement :
   `revues : emplacement "test" -> C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING`
   et, la première fois que la valeur a été figée :
   `emplacement des revues : "test" ecrit dans config.json (numeros trouves : test 4, production 0)`

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
| `"production"` | racine de production (`2_Produkte`) |
| autre chose | ignorée : on retombe sur la clé `devMode`, puis sur `test` |

Ordre de lecture, identique côté PowerShell et côté cockpit :

1. `emplacementRevues` — `"test"` / `"production"`, casse et espaces indifférents ;
2. `devMode` — l'**ancienne** clé, encore lue : `true` = test, `false` = production
   (`"true"`, `"false"`, `1` et `0` acceptés de la même façon des deux côtés) ;
3. faute des deux : `test` — ce que voyaient tous les postes avant que la clé existe.

La bascule des « Réglages SZH » du cockpit écrit **les deux** clés à la fois : un poste
resté sur un toolkit plus ancien continue de lire `devMode` et voit la même chose.

Au premier lancement après la mise à jour, un poste dont `config.json` ne portait aucune
des deux clés se voit écrire `emplacementRevues` en clair. La valeur retenue suit le
disque et jamais au détriment de ce qui existe : `production` seulement si la racine de
production porte des numéros **et** celle de test aucun ; dans tous les autres cas `test`,
c'est-à-dire exactement ce que le poste voyait déjà.

---

## 8. Reprise : « je ne vois plus mes revues »

1. Menu Démarrer → **Revues SZH**. Lire le **titre de la fenêtre**.
2. S'il dit `dossier de production (2_Produkte)` et que les listes sont vides : les numéros
   sont dans la racine de test, l'interrupteur est du mauvais côté. **Rien n'a été
   déplacé ni supprimé.**
3. Remettre l'interrupteur :
   - *par le cockpit* — ouvrir n'importe quel numéro, **Réglages SZH**, activer le mode
     développeur (c'est le nom d'avant de l'emplacement de test) ;
   - *à la main* — ouvrir `C:\ProgramData\SZH\config.json` dans le Bloc-notes et poser
     `"emplacementRevues": "test"`, en gardant le reste du fichier tel quel.
4. Fermer le lanceur, le rouvrir : le titre doit dire `dossier de test (Revues-TESTING)` et
   les numéros reparaître.
5. Vérification à froid : les quatre numéros sont visibles dans l'Explorateur sous
   `C:\Users\robin\OneDrive - SZH CSPS\Revues-TESTING\52_Revue\RV02_Redaction` et
   `…\53_Zeitschrift\ZS02_Redaktion`, avec ou sans lanceur.
6. Si le titre disait déjà `dossier de test` et que la liste est vide : ce n'est pas
   l'interrupteur. Regarder si OneDrive a fini de synchroniser (icône de la barre des
   tâches), puis le journal du jour dans `C:\ProgramData\SZH\logs\`.

Sens inverse — passer un poste de rédaction en production : poser
`"emplacementRevues": "production"`, puis **déplacer** les numéros de
`Revues-TESTING\52_Revue\RV02_Redaction` vers
`2_Produkte\52_Revue\RV02_Redaction` (l'outil ne les suit pas tout seul), et vérifier au
passage que la bibliothèque SharePoint est bien synchronisée sous ce nom-là.

---

## 9. Ce qui reste à poser

- **Le cockpit ne dit pas encore l'emplacement actif** dans sa barre latérale : seul le
  lanceur le montre. Le réglage existe (« Réglages SZH »), l'affichage non.
- **`bootstrap.ps1` pose encore `devMode = $true`** sur un poste neuf, donc l'emplacement
  de test. Sur un poste de rédaction, poser `"emplacementRevues": "production"` juste après
  l'installation — ou corriger le script.
- **`revuesRoots` est trompeuse** : elle ne sert plus qu'au comptage des numéros restés
  dehors. Elle peut être vidée sans rien casser.
