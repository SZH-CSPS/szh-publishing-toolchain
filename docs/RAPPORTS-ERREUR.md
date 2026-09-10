# Rapports d'erreur automatiques

Référence du schéma v1 des rapports que le lanceur (PowerShell) et le cockpit (extension
VSCodium) écrivent seuls, en silence, quand quelque chose échoue de façon inattendue.
Décisions actées le 09.09.2026 (SPEC-RAPPORTS.md, gelée), et corrigées le même jour par cinq
amendements pris en cours de lot : résolution passive contre interactive de l'ancrage (§1),
la règle 5 du masquage scindée en 5a/5b (§3), et les décisions D6 à D10 (anti-inondation au
jour calendaire **local**, aucun écouteur global côté cockpit, id fondé sur l'UTC, les deux
variables d'environnement `SZH_ANCRAGE`/`SZH_RAPPORTS`).

**État à cette date** : les deux écrivains sont **livrés et câblés** à de vrais points
d'appel — `windows/szh-rapport.ps1` côté lanceur, `lib/rapport-erreur.js` côté cockpit —
tous deux bâtis sur la table commune `lib/codes-erreur.js`. Le §10 liste les accroches
réelles et leurs codes ; le §11 compare les deux écrivains sur un même incident. Ce qui suit
décrit ce qui **tourne**, pas seulement ce qui est gelé.

---

## 1. À quoi ça sert, et où c'est

Un numéro qui refuse de s'ouvrir, une mise à jour qui s'arrête à mi-chemin, une extension du
cockpit qui lève une exception : aujourd'hui, la seule trace est une ligne dans le journal du
poste (`C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log`), que personne ne relit sans y être invité.
Un **rapport d'erreur** est un second exemplaire, ciblé, écrit à côté du journal — un fichier
JSON par erreur — dans un dossier SharePoint que l'équipe surveille :

```
C:\Users\robin\SZH CSPS\Daten_Allgemein - General\2_Produkte\Edition SZH CSPS allgemein\_AutoReportToolboxZeitscrhiften
```

La faute de frappe **« Zeitscrhiften » est le vrai nom du dossier** : elle se reproduit à
l'identique, elle ne se corrige pas. Le chemin ci-dessus est **dérivé** de l'ancrage
SharePoint (le dossier `Daten_Allgemein - General`, cherché comme `2_Produkte` l'est déjà
pour les revues — voir `docs/EMPLACEMENTS.md`) : rien ne le code en dur.

Un seul dossier pour les trois produits (revue, Zeitschrift, livre) : le produit concerné est
un champ du JSON (`produit.type`), pas un sous-dossier.

### Comment l'ancrage est retrouvé, et qui a le droit d'ouvrir une fenêtre

L'ancrage n'est plus déduit d'une variable d'environnement (`%OneDrive%` ne pointe pas
forcément dessus) : il est **cherché**, à quatre niveaux passifs
partagés avec la base des produits (`windows/szh-ancrage.ps1`, `Resolve-SzhAncrage`,
mémoïsée en portée script) :

| Niveau | Origine | Source |
|---|---|---|
| 1 | `essai` | `$env:SZH_ANCRAGE` |
| 2 | `config` | `config.json`, clé `ancrageSharePoint` |
| 3 | `cache` | `etat-utilisateur.json`, clé `ancrageSharePoint` — revalidé à chaque lecture ; un chemin disparu est ignoré **et** purgé |
| 4 | `auto` | détection automatique (`%USERPROFILE%\SZH CSPS`, `OneDriveCommercial`, `OneDrive`, `OneDrive - SZH CSPS`, puis tout dossier candidat) |

**Cette résolution passive n'ouvre jamais de fenêtre**, y compris quand rien n'est trouvable
— amendement du 09.09.2026, pris après relecture : la première version couvrait les cinq
niveaux et `Get-SzhBaseRevuesPour` l'appelait, or cet accesseur est aussi appelé depuis
`archive-revue.ps1` et `new-revue.ps1`, qui tournent **sans console**. Le cinquième niveau —
`FolderBrowserDialog`, garde-fou anti-harcèlement de 24 h compris — vit à part, dans
`Initialize-SzhAncrage`, appelée **une seule fois**, par `windows/open-produit.ps1` à son
démarrage : un rattachement vaut d'un coup pour les trois produits (Revue, Zeitschrift,
Books). Détail complet (normalisation d'un chemin donné à la main — parent, enfant, fichier,
UNC — et garde-fous de la descente) dans `windows/szh-ancrage.ps1` et `docs/EMPLACEMENTS.md`.

Côté cockpit, la résolution (`resoudreAncrage()`, `lib/rapport-erreur.js`) est
**volontairement plus étroite** (D8) : trois niveaux seulement (`essai`, `config`, `cache`),
jamais `auto` ni `utilisateur`. Le lanceur tourne toujours avant le cockpit et laisse
l'ancrage en cache dans `etat-utilisateur.json` ; balayer le disque — ou lancer un processus
PowerShell — depuis le cockpit rien que pour écrire un rapport contredirait D5 (« un rapport
ne doit jamais ralentir »).

### Deux variables d'environnement, orthogonales (D10)

| Variable | Effet | Reconnue par |
|---|---|---|
| `SZH_ANCRAGE` | Surcharge l'**ancrage** (`Daten_Allgemein - General`) ; tout en dérive, base des produits et dossier de rapports | `Resolve-SzhAncrage` (PS) et `resoudreAncrage()` (JS) — une seule surcharge d'ancrage dans tout le produit |
| `SZH_RAPPORTS` | Nomme **directement** le dossier de rapports ; l'emporte sans condition sur toute dérivation depuis l'ancrage | `Write-SzhRapport` / `Clear-SzhRapportsEnAttente` (PS) et `resoudreDossierRapports()` / `viderFileAttente()` (JS) |

Les deux ne se combinent pas : poser `SZH_RAPPORTS` sur un dossier de rapports **ne le fait
pas** dériver davantage (pas de `2_Produkte\…` ajouté dessous) — c'est la surcharge la plus
spécifique, « le dossier, tel quel ». Le champ `ancrage` du JSON garde son sens propre : il
reste résolu séparément et continue de dire d'où vient l'ancrage, même quand `SZH_RAPPORTS`
décide seul de la destination d'écriture.

Piège vécu en éprouvant le module (Robin) : avant cet amendement, `SZH_RAPPORTS` désignait
l'ancrage, et un dossier de rapports qu'on lui passait directement héritait d'un
`2_Produkte\Edition SZH CSPS allgemein\_AutoReportToolboxZeitscrhiften` de trop en dessous de
lui. Bénéfice concret pour les tests : pointer `SZH_RAPPORTS` sur un dossier jetable suffit,
sans fabriquer une fausse arborescence SharePoint complète.

**Écriture silencieuse.** Rien à l'écran, jamais de fenêtre, jamais de blocage : une ligne
dans le journal du poste suffit à dire qu'un rapport est parti (ou n'a pas pu partir). Un
rapport ne doit **jamais** faire échouer, ralentir ni bruiter l'action qui l'a déclenché —
son écriture est toujours sous garde, un échec de plus reste local (§7, `RAPPORT-ECHEC-ECRITURE`).

---

## 2. Le schéma v1, champ par champ

Un fichier par erreur, nommé `<id>.json` (voir §3). UTF-8 **sans BOM**, indenté 2 espaces,
clés de premier niveau **dans l'ordre ci-dessous** — c'est ce que `ORDRE_CLES_RAPPORT`
(`lib/codes-erreur.js`) fige, et ce que `validerRapport()` contrôle.

### Exemple complet

```json
{
  "schema": "szh-rapport-erreur/1",
  "id": "20260909-081530-ROBIN-PC-a1b2c3",
  "horodatage": "2026-09-09T08:15:30Z",
  "horodatageLocal": "2026-09-09T10:15:30+02:00",
  "gravite": "erreur",
  "source": "lanceur",
  "code": "LANCEUR-TRAP",
  "signature": "a1b2c3d4e5f6",
  "resume": {
    "fr": "Une erreur inattendue est survenue à l’ouverture du lanceur ; ce rapport en garde la trace pour le diagnostic.",
    "de": "Beim Öffnen des Starters ist ein unerwarteter Fehler aufgetreten; dieser Bericht hält ihn zur Diagnose fest."
  },
  "etape": "ouverture de la liste des numéros",
  "message": "…",
  "pile": "…",
  "poste": {
    "nom": "ROBIN-PC", "utilisateur": "robin", "os": "10.0.26200",
    "powershell": "5.1.26200.1", "langueInterface": "fr"
  },
  "versions": { "toolkit": "v2026.08.59", "cockpit": "0.26.7", "vscodium": "1.101.2" },
  "produit": { "type": "revue", "numero": "2027-02", "emplacement": "production" },
  "ancrage": {
    "trouve": true, "origine": "cache",
    "chemin": "C:\\Users\\robin\\SZH CSPS\\Daten_Allgemein - General"
  },
  "fichiers": [
    { "chemin": "2_Produkte\\52_Revue\\RV02_Redaction\\2027-02\\articles\\03-x\\03-x.md",
      "relatifA": "ancrage", "role": "article" }
  ],
  "journal": {
    "chemin": "logs\\szh-2026-09.log", "relatifA": "programdata",
    "lignes": 200, "tronque": true, "extrait": ["…"]
  },
  "constats": [
    { "source": "pandoc", "code": "tableau-sans-entete", "ton": "danger", "slug": "03-x" }
  ],
  "environnement": { "wsl": "repond", "espaceLibreGo": 42.3 }
}
```

### Les champs

| Champ | Type | Sens |
|---|---|---|
| `schema` | chaîne fixe | `"szh-rapport-erreur/1"` — voir §7, la règle de stabilité |
| `id` | chaîne | `<AAAAMMJJ-HHmmss>-<poste>-<6 hex>`, aussi le nom du fichier ; voir §3 |
| `horodatage` | chaîne ISO-8601, UTC | l'instant de l'erreur, en UTC (`Z`) |
| `horodatageLocal` | chaîne ISO-8601, décalage inclus | le même instant, à l'heure du poste — pour la personne qui relit, pas pour le tri |
| `gravite` | énumération | `erreur` \| `echec-partiel` |
| `source` | énumération | `lanceur` \| `maj` \| `archivage` \| `cockpit` \| `chaine` |
| `code` | chaîne stable | une des 9 clés de la table des codes, §7 |
| `signature` | chaîne, 12 hex | pour le regroupement anti-inondation, §5 — pas un identifiant |
| `resume` | objet `{ fr, de }` | une phrase courte, non technique — copiée depuis la table des codes |
| `etape` | chaîne ou `null` | ce que faisait l'outil quand ça a cassé, en langage humain |
| `message` | chaîne ou `null` | le détail technique, masqué (§3), plafonné à 4000 caractères |
| `pile` | chaîne ou `null` | la pile d'appel si disponible, masquée, plafonnée à 8000 caractères |
| `poste` | objet | nom de machine, **compte Windows** (jamais le courriel, voir §3), OS, version de PowerShell, langue de l'interface |
| `versions` | objet | ce qui tournait : toolkit, cockpit, VSCodium |
| `produit` | objet ou `null` | `type` (`revue`\|`zeitschrift`\|`livre`), `numero`, `emplacement` (`test`\|`production`) |
| `ancrage` | objet | `trouve` (bool), `origine` (§2.2 de la spec de résolution — `essai`\|`config`\|`cache`\|`auto`\|`utilisateur`\|`defaut`\|`absent`), `chemin` (masqué si absolu et hors racine connue) |
| `fichiers` | tableau, **jamais `null`** | jusqu'à 50 `{ chemin, relatifA, role }` — voir §4 pour `relatifA` |
| `journal` | objet ou `null` | `chemin`, `relatifA`, `lignes` (total réel avant plafonnement), `tronque` (bool), `extrait` (tableau de lignes, masquées) |
| `constats` | tableau, **jamais `null`** | jusqu'à 100 constats du pipeline concernés, format de `lib/journal.js` |
| `environnement` | objet ou `null` | `wsl` (`repond`\|`absent`\|…), `espaceLibreGo` (nombre) |

**Champ inconnu au moment d'écrire ⇒ `null`, jamais omis, jamais inventé.** `fichiers` et
`constats` sont l'exception : un tableau vide plutôt que `null` quand il n'y a rien à
rapporter — parce que ce sont des collections, pas des faits ponctuels.

**Chemins.** Séparateur `\` (Windows), échappé JSON comme n'importe quelle chaîne : on doit
pouvoir coller `<ancrage.chemin>\<fichiers[].chemin>` directement dans l'Explorateur.
`relatifA` vaut `ancrage` \| `programdata` \| `absolu` — `absolu` seulement quand ni
l'ancrage ni `C:\ProgramData\SZH` ne s'appliquent, et alors le chemin passe quand même par
le masquage (§3) avant d'être écrit.

---

## 3. Masquage — et ce qu'on ne collecte jamais

Avant d'écrire un rapport, `message`, `pile`, chaque ligne de `journal.extrait`, et tout
chemin qui resterait absolu passent par `masquer()` (`lib/codes-erreur.js`), sept règles,
appliquées **dans cet ordre** :

| # | Règle | Exemple |
|---|---|---|
| 1 | Chemin sous l'ancrage → relatif à l'ancrage | `…\Daten_Allgemein - General\2_Produkte\x.md` → `2_Produkte\x.md` |
| 2 | Chemin sous `%USERPROFILE%` → `~\…` | `C:\Users\robin\Bureau\notes.txt` → `~\Bureau\notes.txt` |
| 3 | Chemin sous `C:\ProgramData\SZH` → relatif | `C:\ProgramData\SZH\logs\x.log` → `logs\x.log` |
| 4 | Mot-clé de secret (`api[-_ ]?key`, `token`, `secret`, `authorization`, `bearer`, `deepl`, `password`, `mot de passe`, `pwd`) + **le jeton qui suit, rien de plus** → `***` | `token: eyJhbGci…` → `token: ***` ; `token: absent — configuration OJS non remplie` reste lisible |
| 5b | Un JWT complet (`eyJ…`, en-tête, charge utile et signature séparés par des points) → `***` en un seul bloc | `Bearer eyJhbGci….eyJzdWIi….sig` → `Bearer ***` |
| 5a | Suite de ≥ 32 caractères de `[A-Za-z0-9+=_-]` (**sans `/`**) qui mélange majuscule, minuscule et chiffre, **et** qui n'est pas purement hexadécimale (tirets ignorés) → `***` | une clé d'API à haute entropie |
| 6 | Adresse courriel autre que `robin.morand@szh.ch` → `***@***` | `jean.dupont@example.com` → `***@***` |

**Pourquoi cet ordre, précisément.** Les règles 1 à 3 raccourcissent le texte avant que 5a/5b
(génériques, les plus gourmandes) ne s'appliquent. Parmi 1-2-3, l'ancrage doit passer
**avant** `%USERPROFILE%` : il lui est presque toujours imbriqué, donc l'ordre inverse
masquerait un chemin utile en `~\…` au lieu du relatif à l'ancrage, qui porte plus de sens
pour le diagnostic. Et **5b avant 5a** : un JWT découpé par ses points en segments
individuels peut avoir un segment assez long et assez mélangé pour que 5a le masque tout
seul, laissant les autres segments — souvent plus courts que 32 caractères — lisibles ; 5b
masque le jeton entier en un seul passage, ne laissant plus rien à mordre pour 5a.

**AMENDEMENT du 09.09.2026 (erreur de spécification, pas d'implémentation).** La règle 5
d'origine (« ≥ 32 caractères de `[A-Za-z0-9+/=_-]` », `/` compris) a été mesurée sur des
lignes réelles de la chaîne et masquait exactement ce que D3 demande de garder :

| Ligne réelle | Ce que l'ancienne règle 5 en faisait |
|---|---|
| `2_Produkte/52_Revue/RV02_Redaction/2027-02/articles/03-inclusion/03-inclusion.md` | `***.md` |
| `make: *** [Makefile:142: out/2027-02/articles/03-inclusion-scolaire.pdf] Error 1` | `***.pdf` |
| `WeasyPrint: figure sans alt dans articles/07-ressources-documentaires/image-01.png` | `***.png` |
| `https://www.szh-csps.ch/revue/2027-02/inclusion-scolaire-participation-sociale` | `https://www.szh-csps.***` |
| une empreinte SHA-256 (le sujet même de l'erreur `err.empreinte`) | `***` |

Retirer `/` de la classe et exiger le mélange majuscule/minuscule/chiffre (5a) répare les
cinq lignes ci-dessus. Ça ne suffisait pas pour un JWT (`Authorization: Bearer eyJhbGci….
eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig`) : la règle 4 ne masque que le jeton qui suit le mot-clé —
ici le mot « Bearer » lui-même, puisqu'un espace le sépare du vrai jeton — et l'ancienne
règle 5, redécoupée par les points du JWT, ne masquait que les segments individuellement
assez longs. La charge utile (`eyJzdWIiOiIxMjM0NTY3ODkwIn0`, soit `{"sub":"1234567890"}`
en base64 une fois décodée) survivait : une vraie fuite d'identité. D'où 5b, dédiée.

**Ce que le masquage ne doit jamais toucher** (gardé par des tests) : une chaîne contenant
`/` ou `\` — un chemin — ; une suite purement hexadécimale, tirets compris — empreinte
SHA-1/SHA-256, GUID — ; une URL ; un slug d'article (minuscules, chiffres, tirets — jamais
de majuscule, voir `lib/slug.js`). `source`, `code`, `etape` et `signature` ne sont de toute
façon jamais masqués : c'est sur eux, pas sur un message déjà tronqué, que se fait le
regroupement (§4).

**Deux limites connues, assumées, à ne pas « corriger » sans en reparler avec l'équipe :**
- Un secret nu, **sans mot-clé devant**, dont **aucune lettre n'est en majuscule** (une clé
  DeepL nue en est l'exemple réel : hexadécimal minuscule et tirets) n'a rien qui le
  distingue d'un GUID ou d'un slug, et échappe à 5a. Le filet de sécurité reste la règle 4 :
  ces clés sont censées apparaître précédées de leur mot-clé dans un message construit par
  l'outil, pas nues dans une pile d'appel tierce.
- Un segment de chemin isolé (entre deux séparateurs) qui mélangerait casse et chiffres sur
  ≥ 32 caractères — un nom de dossier tiers, hors des slugs de ce dépôt qui sont toujours en
  minuscules — reste une candidate valide pour 5a et **serait masqué**. Non atteignable par
  un slug de cette chaîne, mais possible dans un chemin extérieur cité tel quel (une
  bibliothèque Node, un dossier personnel Windows au nom composé).

### Ce qui n'est délibérément **pas** collecté

- **Le courriel de la personne qui utilise l'outil.** Le compte Windows (`$env:USERNAME`,
  champ `poste.utilisateur`) est inclus — il identifie un poste, pas une personne à
  contacter — mais son adresse professionnelle n'apparaît nulle part dans un rapport. Si
  elle apparaissait malgré tout dans un message technique copié tel quel, la règle 6 la
  masquerait comme n'importe quelle autre adresse.
- **Tout secret** au sens des règles 4, 5a et 5b : jetons, mots de passe, clés d'API, JWT —
  y compris ceux qui n'auraient jamais dû se trouver dans un message d'erreur en premier
  lieu (sous réserve des deux limites connues ci-dessus).
- **L'article lui-même.** Ni son fichier, ni un extrait de Word, ni son texte intégral ne
  sont jamais joints à un rapport. Un rapport cite des **chemins** de fichiers et, via
  `constats`, des **codes** de contrôle de publication (`lib/journal.js`).

**Limite honnête, à ne pas maquiller.** `journal.extrait` (§2, jusqu'à 200 lignes) est la
sortie **brute** de `make`, Pandoc et WeasyPrint — `Get-SzhRapportExtraitJournal` (PS) et
`lireExtraitFichier` (JS) lisent le fichier tel quel, sans en retirer de contenu éditorial ;
seul `masquer()`/`Protect-SzhRapportTexte` s'applique ensuite, et ses règles (§3) ciblent des
secrets et des chemins, jamais du texte de rédaction. En pratique, ces lignes sont
presque toujours des chemins, des slugs et des codes (« tableau sans en-tête », par
exemple) — mais rien n'empêche un outil de citer, dans son message d'erreur, le passage
exact du texte qui l'a fait échouer (une clé de citation introuvable, une cellule de tableau
mal formée…). Ce n'est ni fréquent, ni l'article entier ni un fichier joint — seulement,
à l'occasion, la ligne fautive telle que l'outil de compilation l'a citée.

---

## 4. Plafonds

Non négociables, dans `PLAFONDS` (`lib/codes-erreur.js`), appliqués par `appliquerPlafonds()`
à un rapport déjà construit :

| Élément | Plafond |
|---|---|
| `message` | 4 000 caractères |
| `pile` | 8 000 caractères |
| `journal.extrait` | 200 **dernières** lignes **et** 40 000 caractères |
| `fichiers` | 50 entrées |
| `constats` | 100 entrées |
| Fichier entier | 256 Ko — au-delà, `journal.extrait` est **vidé** et `tronque: true` est reposé |

Le plafond de 256 Ko porte sur le fichier **sérialisé** (2 espaces d'indentation, comme à
l'écriture) : c'est le seul champ sans plafond de longueur individuelle (`fichiers[].chemin`
n'a pas de borne de caractères, seul son **nombre** d'entrées est plafonné) qui puisse à lui
seul faire déborder un rapport par ailleurs conforme ; c'est pourquoi c'est lui qu'on
sacrifie en dernier recours plutôt que de tronquer au hasard un autre champ.

---

## 5. Anti-inondation

Une panne qui se répète toutes les dix secondes ne doit pas écrire un fichier par occurrence.

- **Signature** = 12 premiers caractères hexadécimaux de
  `SHA-256(source | code | etape | 200 premiers caractères du message masqué | produit.numero)`,
  chaque champ manquant valant chaîne vide (`calculerSignature()`).
- **Une signature au plus toutes les 24 h** par compte.
- **20 rapports par jour** au maximum par compte, toutes signatures confondues.
- Compteurs dans `etat-utilisateur.json` (`%LOCALAPPDATA%\SZH\etat-utilisateur.json`), clé
  `rapports` : `{ "<signature>": "<ISO>", "_jour": "2026-09-09", "_compte": 3 }`. Entrées de
  plus de 7 jours purgées à chaque écriture.
- Un rapport étouffé par ces plafonds n'est **pas** mis en attente : il est **perdu**, et une
  seule ligne de journal local le dit — mieux vaut perdre un doublon que ralentir ou bloquer
  l'outil pour le conserver.

---

## 6. File d'attente hors ligne

Le dossier de rapports peut être injoignable (SharePoint pas encore synchronisé, poste hors
ligne). Le JSON va alors dans `%LOCALAPPDATA%\SZH\rapports-en-attente\<id>.json` — **le même
dossier des deux côtés** : `Get-SzhRapportDossierAttente` (PS, `windows/szh-rapport.ps1`)
rejoint `$script:SzhBaseUtilisateur` (déjà `%LOCALAPPDATA%\SZH`, avec son repli par SID) ;
`cheminDossierAttente()` (JS, `lib/rapport-erreur.js`) rejoint la même racine via
`%LOCALAPPDATA%`. Un rapport mis en attente par le lanceur et un autre mis en attente par le
cockpit, sur le même poste, atterrissent donc côte à côte.

- **Vidée au démarrage du lanceur**, après résolution de l'ancrage : `open-produit.ps1`
  appelle `Clear-SzhRapportsEnAttente` juste après `Initialize-SzhAncrage`, avant même de
  traiter un lien `szh://` reçu. Chaque fichier restant après les plafonds est déplacé
  (`Move-Item`) vers le vrai dossier de rapports ; un échec le laisse en place pour la
  prochaine tentative.
- **Vidée à l'activation du cockpit** : `activate()` (`extension.js`) appelle
  `rapportErreur.viderFileAttente()` une fois, sans attendre une compilation ou une commande.
- `SZH_RAPPORTS`, quand elle est posée, décide aussi de la destination du **vidage** (D10) :
  les deux fonctions ci-dessus l'honorent exactement comme l'écriture d'un nouveau rapport.
- Plafond de **50 fichiers** en attente : au-delà, les plus anciens sont effacés sans être
  transmis.
- Un fichier resté plus de **30 jours** en attente est effacé sans être transmis.

---

## 7. La table des codes

Neuf codes, gelés dans `lib/codes-erreur.js` (`CODES`). Une clé de code, une fois publiée,
**ne se renomme et ne se supprime jamais** — un poste peut tourner des mois avec une version
plus ancienne du toolkit et continuer à écrire ce code-là.

| Code | Quand |
|---|---|
| `LANCEUR-TRAP` | exception non rattrapée dans `open-produit.ps1` / `open-md.ps1` |
| `LANCEUR-CODIUM-ABSENT` | VSCodium introuvable au démarrage |
| `ANCRAGE-INTROUVABLE` | aucun ancrage après détection **et** demande à l'utilisateur·trice |
| `MAJ-ETAPE-ECHEC` | échec partiel d'une étape de `update.ps1` |
| `MAJ-ECHEC` | échec total de `update.ps1` |
| `ARCHIVAGE-ECHEC` | échec de `archive-revue.ps1` |
| `COMPIL-ECHEC` | tâche de compilation terminée avec un code de sortie non nul |
| `COCKPIT-EXCEPTION` | exception non rattrapée côté extension |
| `RAPPORT-ECHEC-ECRITURE` | **jamais écrit en rapport** — journal local seulement ; sans quoi un échec d'écriture de rapport tenterait d'écrire un rapport sur son propre échec, indéfiniment |

Chaque code porte un `resume` en français et en allemand (`CODES[code].resume.fr` /
`.de`) : une phrase courte, factuelle, jamais alarmiste, lisible par une personne qui ouvre
le fichier JSON sans être technicienne.

---

## 8. La règle de stabilité

- Un **code** publié ne se renomme et ne se supprime jamais (§7).
- Les valeurs des **énumérations closes** (`gravite`, `source`, `relatifA`, `ancrage.origine`)
  ne changent ni de graphie ni de sens une fois publiées.
- Un changement de **forme** du rapport (nouveau champ obligatoire, sens différent d'un champ
  existant, réordonnancement des clés) passe par une **nouvelle valeur de `schema`**
  (`"szh-rapport-erreur/2"`, etc.) — jamais par une modification silencieuse de la version 1.
  Un lecteur (tableau de bord, script de tri) peut donc toujours faire confiance à
  `schema` pour savoir quelle forme attendre, sans avoir à deviner.

---

## 9. Qui décide quoi

| Où | Quoi |
|---|---|
| `vscodium-extension/szh-cockpit/lib/codes-erreur.js` | La table des 9 codes, les constantes du schéma (version, énumérations, plafonds §4, seuils anti-inondation §5), et les fonctions pures partagées par les deux écrivains : `masquer`, `versCheminRelatif`, `calculerSignature`, `calculerId`, `genererAleatoireHex`, `appliquerPlafonds`, `validerRapport`. Aucun accès disque, aucune dépendance à `vscode`. |
| `test/js/codes-erreur.test.js` | Éprouve cette table et ces fonctions contre le schéma gelé — `node --test test/js/codes-erreur.test.js`. |
| `windows/szh-ancrage.ps1` | L'ancrage SharePoint : résolution passive à 4 niveaux (`Resolve-SzhAncrage`, mémoïsée, n'ouvre jamais de fenêtre), normalisation d'un chemin donné à la main, et `Initialize-SzhAncrage` (5ᵉ niveau, seule fonction habilitée à ouvrir un `FolderBrowserDialog`). |
| `windows/szh-rapport.ps1` | L'écrivain PowerShell (`Write-SzhRapport`) : construit le rapport, masque, plafonne, valide, applique l'anti-inondation, écrit ou met en attente — reproduit à la main les fonctions de `lib/codes-erreur.js`, PowerShell n'exécutant pas de JS. |
| `test/js/ancrage-sharepoint.test.js`, `test/js/lanceur-ancrage.test.js` | Éprouvent la résolution de l'ancrage (le partage des 4 niveaux passifs, le garde-fou « jamais de fenêtre » de `Resolve-SzhAncrage`) et son câblage unique, au bon endroit, dans `open-produit.ps1`. |
| `vscodium-extension/szh-cockpit/lib/rapport-erreur.js` | L'écrivain côté cockpit (`emettreRapport`) : résolution **passive à 3 niveaux seulement** (D8, jamais de balayage ni de fenêtre), construction, anti-inondation, file d'attente, écriture — en s'appuyant sur `lib/codes-erreur.js`. |
| `test/js/rapport-erreur.test.js` | Éprouve l'écrivain cockpit et ses deux accroches d'`extension.js` (§10). |
| `test/js/rapport-erreur-ps.test.js` | Éprouve la **parité** entre les deux écrivains (§11) : même schéma, même masquage, même signature, même id, mêmes plafonds — au signe près, sinon l'anti-inondation partagée diverge en silence. Technique : extraction du corps de fonction depuis le vrai `.ps1`, pilote généré, `spawnSync('powershell.exe', …)` (même méthode que `test/js/courriel-support.test.js`). |

---

## 10. Les accroches réelles, et leurs codes

Neuf codes gelés (§7), mais un seul (`RAPPORT-ECHEC-ECRITURE`) n'est jamais écrit. Voici,
pour chacun des huit autres, l'endroit exact du dépôt qui l'émet — pas un exemple, le vrai
point d'appel.

| Code | Émis depuis | Condition précise |
|---|---|---|
| `LANCEUR-TRAP` | `windows/open-produit.ps1` (bloc `trap`) | toute exception non rattrapée dans le lanceur, quel que soit le produit |
| `LANCEUR-TRAP` | `windows/open-md.ps1` (bloc `trap`) | toute exception non rattrapée à l'ouverture d'un `.md` par double-clic ; `fichiers` porte le chemin reçu |
| `LANCEUR-CODIUM-ABSENT` | `windows/open-produit.ps1` | `Get-VSCodiumExe` ne rend rien, hors simulation |
| `ANCRAGE-INTROUVABLE` | `windows/open-produit.ps1`, juste après `Initialize-SzhAncrage` | seulement quand `$ancrageResolu.origine -eq 'absent'` — une vraie demande a eu lieu et n'a rien donné ; **jamais** quand la demande est évitée par l'anti-harcèlement ou la simulation (origine `defaut`), pour ne pas produire un rapport à chaque lancement d'un poste déjà averti |
| `MAJ-ETAPE-ECHEC` | `windows/szh-common.ps1` (`Show-SzhErreur -Code 'MAJ-ETAPE-ECHEC'`), appelée par `update.ps1` | une étape de la mise à jour échoue, les suivantes continuent |
| `MAJ-ECHEC` | `windows/szh-common.ps1` (`Show-SzhErreur`, code par défaut), appelée par `update.ps1` | la mise à jour s'arrête avant la fin |
| `ARCHIVAGE-ECHEC` | `windows/archive-revue.ps1` (`Show-SzhErreurArchivage`) | le déplacement en cours ⇄ archives échoue ; `fichiers` porte `$Dossier`, le seul chemin sûrement connu à ce stade |
| `COMPIL-ECHEC` | `extension.js` (`relireJournal`) | une tâche de compilation se termine avec un code de sortie non nul — **jamais** sur un `code === 0`, le cas le plus fréquent ; les constats de contenu (tableau sans en-tête, figure sans alt…) ne déclenchent jamais un rapport à eux seuls, ils ne partent qu'en contexte d'un rapport parti pour une autre raison |
| `COCKPIT-EXCEPTION` | `extension.js` (`signalerExceptionCockpit`), appelée depuis l'enveloppe posée sur `cmd()`/`cmdEcriture()` | une exception sort d'une commande `szh.*` de l'extension — **jamais** via un écouteur global sur le processus (D7, §0 : ce processus est partagé avec toutes les autres extensions de VSCodium) |

---

## 11. Un même incident, deux écrivains : ce qui est vérifié

Vérifié empiriquement (Robin) : faire émettre le **même incident** aux deux écrivains et
comparer les deux fichiers JSON obtenus.

- **Signature identique**, ordre des clés identique, **aucun BOM**, indentation à 2 espaces.
- **13 champs sur 17 rigoureusement égaux.**
- Écarts, tous **voulus** — chaque écrivain ne connaît que sa moitié du poste :

| Champ | Côté lanceur (PS) | Côté cockpit (JS) |
|---|---|---|
| `poste.powershell` | renseigné (`$PSVersionTable.PSVersion`) | toujours `null` — le cockpit ne sait pas quelle version de PowerShell tourne sur le poste |
| `versions.cockpit` | toujours `null` — le lanceur ne sait pas quelle version du cockpit est installée | renseigné (lu dans `package.json`) |
| `poste.os` | légèrement plus précis : `10.0.26200.0` (`[System.Environment]::OSVersion.Version.ToString()`, 4 segments) | `10.0.26200` (`os.release()`, 3 segments) |

**Une asymétrie de contrat à connaître avant d'y toucher.** `emettreRapport` (JS) reçoit
`journal: { chemin, extrait }` **déjà construit** par l'appelant (`lireExtraitFichier` a déjà
lu le fichier avant l'appel) ; `Write-SzhRapport` (PS) reçoit `-Journal <chemin>` et **lit le
fichier lui-même** (`Get-SzhRapportExtraitJournal`, en interne). Le JSON produit a la même
forme au final, mais les deux appels ne se ressemblent pas — un futur appelant qui copierait
la forme JS côté PowerShell, ou l'inverse, échouerait silencieusement à passer le journal.
