# Rapports d'erreur et compteurs d'usage

Quand quelque chose échoue de façon inattendue, Pronto écrit seul un **rapport d'erreur** :
un fichier JSON par incident, déposé dans un dossier partagé que l'équipe surveille. Le
journal du poste (`C:\ProgramData\SZH\logs\szh-<AAAA-MM>.log`) garde aussi la trace, mais
personne ne le relit sans y être invité ; le rapport, lui, arrive au même endroit pour tous
les postes.

Deux programmes écrivent des rapports, au même format :

- les scripts PowerShell (`windows/szh-rapport.ps1`, fonction `Write-SzhRapport`) ;
- le cockpit (`lib/rapport-erreur.js`, fonction `emettreRapport`).

Le format, les codes et les fonctions de calcul communes sont dans
`vscodium-extension/szh-cockpit/lib/codes-erreur.js`. PowerShell ne peut pas exécuter ce
fichier : `szh-rapport.ps1` en reproduit les algorithmes, et un test vérifie que les deux
donnent le même résultat.

Cette page décrit aussi deux autres fichiers déposés dans le même dossier `_Systeme\` :
l'[inventaire des postes](#linventaire-des-postes) et les
[compteurs d'usage](#les-compteurs-dusage).

## Où vont les rapports

```
<ancrage>\2_Produkte\54_Pronto\_Systeme\rapports\<id>.json
```

L'ancrage est le dossier SharePoint `Daten_Allgemein - General`, cherché sur le poste
([`EMPLACEMENTS.md`](EMPLACEMENTS.md#lancrage-sharepoint)). Le dossier des rapports en est
dérivé : il ne dépend pas de la racine active (test ou production). Un seul dossier sert aux
trois produits ; le produit concerné est un champ du rapport.

Côté PowerShell, l'ancrage vient de `Resolve-SzhAncrage`, qui ne demande jamais rien à
l'utilisateur : les scripts sans fenêtre (`archive-revue.ps1`, `new-revue.ps1`) peuvent donc
écrire un rapport. Seule `Initialize-SzhAncrage`, au démarrage de Pronto, peut ouvrir un
sélecteur de dossier.

Côté cockpit, `resoudreAncrage()` ne lit que les trois premiers niveaux (variable d'essai,
`config.json`, cache de `etat-utilisateur.json`). Il ne parcourt pas le disque : écrire un
rapport ne doit pas ralentir l'éditeur, et le démarrage de Pronto a déjà mis l'ancrage en
cache.

### Variables d'essai

| Variable | Effet | Lue par |
|---|---|---|
| `SZH_ANCRAGE` | remplace l'ancrage ; la racine de production et le dossier des rapports en dérivent | `Resolve-SzhAncrage`, `resoudreAncrage()` |
| `SZH_RAPPORTS` | nomme directement le dossier des rapports, sans rien ajouter dessous ; elle l'emporte sur la dérivation depuis l'ancrage, pour l'écriture comme pour le vidage de la file d'attente | `Write-SzhRapport`, `Clear-SzhRapportsEnAttente`, `resoudreDossierRapports()`, `viderFileAttente()` |

Avec `SZH_RAPPORTS`, le champ `ancrage` du rapport est quand même résolu à part : il dit
toujours d'où vient l'ancrage. Pour un test, pointer `SZH_RAPPORTS` sur un dossier jetable
suffit.

## L'écriture

- **Silencieuse.** Aucun affichage, aucune fenêtre. Une ligne de journal dit qu'un rapport
  est parti ou n'a pas pu partir.
- **Sans effet sur l'action.** L'écriture est toujours protégée : un rapport ne fait ni
  échouer, ni ralentir l'action qui l'a déclenché. Un échec d'écriture reste dans le journal
  local, sous le code `RAPPORT-ECHEC-ECRITURE`, et ne produit jamais de rapport.
- **Atomique.** Le rapport est d'abord écrit dans un fichier temporaire du même dossier,
  `~$<id>.json.<jeton>`, puis renommé. Une lecture ne voit jamais un fichier à moitié écrit.
  OneDrive ignore les fichiers préfixés `~$`. Le temporaire est supprimé dans tous les cas,
  y compris en cas d'échec.

## Le format d'un rapport

Un fichier par incident, nommé `<id>.json`. UTF-8 sans BOM, indentation de 2 espaces, clés
dans l'ordre ci-dessous (`ORDRE_CLES_RAPPORT`, contrôlé par `validerRapport()`).

### Exemple

```json
{
  "schema": "szh-rapport-erreur/1",
  "id": "20260909-081530-POSTE-01-a1b2c3",
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
  "etape": "ouverture d'un fichier .md",
  "message": "…",
  "pile": "…",
  "poste": {
    "nom": "POSTE-01", "utilisateur": "compte", "os": "10.0.26200",
    "powershell": "5.1.26200.1", "langueInterface": "fr"
  },
  "versions": { "toolkit": "3.10.5", "cockpit": null, "vscodium": "1.126.04524" },
  "produit": { "type": "revue", "numero": "2027-02", "emplacement": "production" },
  "ancrage": {
    "trouve": true, "origine": "cache",
    "chemin": "C:\\Users\\compte\\SZH CSPS\\Daten_Allgemein - General"
  },
  "fichiers": [
    { "chemin": "2_Produkte\\54_Pronto\\Revue\\2027-02\\articles\\03-x\\03-x.md",
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
| `schema` | chaîne fixe | `"szh-rapport-erreur/1"` ([règle de stabilité](#la-règle-de-stabilité)) |
| `id` | chaîne | `<AAAAMMJJ-HHmmss>-<poste>-<6 hex>`, heure UTC, 120 caractères au plus ; c'est aussi le nom du fichier |
| `horodatage` | ISO 8601, UTC | l'instant de l'erreur |
| `horodatageLocal` | ISO 8601 avec décalage | le même instant à l'heure du poste, pour la lecture |
| `gravite` | `erreur` \| `echec-partiel` | aujourd'hui, tous les écrivains emploient `erreur` |
| `source` | `lanceur` \| `maj` \| `archivage` \| `cockpit` \| `chaine` | la partie de Pronto qui écrit |
| `code` | chaîne | une clé de la [table des codes](#les-codes-derreur) |
| `signature` | 12 caractères hexadécimaux | sert à regrouper les répétitions ([anti-inondation](#lanti-inondation)) |
| `resume` | `{ fr, de }` | une phrase courte et non technique, tirée de la table des codes |
| `etape` | chaîne ou `null` | ce que faisait l'outil, en langage courant |
| `message` | chaîne ou `null` | le détail technique, masqué |
| `pile` | chaîne ou `null` | la pile d'appels, masquée |
| `poste` | objet | nom de la machine, compte Windows, version du système, version de PowerShell, langue de l'interface |
| `versions` | objet | toolkit, cockpit, VSCodium |
| `produit` | objet ou `null` | `type` (`revue`, `zeitschrift`, `livre`), `numero`, `emplacement` (`test`, `production`) |
| `ancrage` | objet | `trouve`, `origine` (`essai`, `config`, `cache`, `auto`, `utilisateur`, `defaut`, `absent`), `chemin` |
| `fichiers` | tableau | des `{ chemin, relatifA, role }` |
| `journal` | objet ou `null` | `chemin`, `relatifA`, `lignes` (total avant plafond), `tronque`, `extrait` (lignes masquées) |
| `constats` | tableau | les constats de compilation concernés, au format de `lib/journal.js` |
| `environnement` | objet ou `null` | `wsl` (`repond`, `absent`…), `espaceLibreGo` |

Un champ inconnu au moment d'écrire vaut `null` ; il n'est ni omis ni deviné. `fichiers` et
`constats` valent un tableau vide quand il n'y a rien.

**Chemins.** Le séparateur est `\`. `relatifA` vaut `ancrage`, `programdata`
(`C:\ProgramData\SZH`) ou `absolu`. On peut coller `<ancrage.chemin>\<fichiers[].chemin>`
dans l'Explorateur. Un chemin absolu passe par le masquage.

## Le masquage

Avant l'écriture, `message`, `pile`, chaque ligne de `journal.extrait` et tout chemin absolu
passent par `masquer()` (`lib/codes-erreur.js`, reproduite par `Protect-SzhRapportTexte` en
PowerShell). Les règles s'appliquent dans cet ordre :

| Règle | Ce qu'elle fait | Exemple |
|---|---|---|
| 1 | chemin sous l'ancrage → relatif à l'ancrage | `…\Daten_Allgemein - General\2_Produkte\x.md` → `2_Produkte\x.md` |
| 2 | chemin sous `%USERPROFILE%` → `~\…` | `C:\Users\compte\Bureau\notes.txt` → `~\Bureau\notes.txt` |
| 3 | chemin sous `C:\ProgramData\SZH` → relatif | `C:\ProgramData\SZH\logs\x.log` → `logs\x.log` |
| 4 | mot-clé de secret (`api key`, `token`, `secret`, `authorization`, `bearer`, `deepl`, `password`, `mot de passe`, `pwd`) suivi d'une valeur → la valeur seule devient `***` | `token: eyJhbGci…` → `token: ***` |
| 5b | jeton JWT complet (`eyJ…`, trois parties séparées par des points) → `***` | `Bearer eyJ….eyJ….sig` → `Bearer ***` |
| 5a | suite d'au moins 32 caractères `[A-Za-z0-9+=_-]`, sans `/`, qui mêle majuscule, minuscule et chiffre et n'est pas purement hexadécimale → `***` | une clé d'API |
| 6 | adresse électronique → `***@***`, sauf l'adresse du support (`COURRIEL_SUPPORT`) | `jean.dupont@example.com` → `***@***` |

Pourquoi cet ordre :

- Les règles 1 à 3 raccourcissent les chemins avant les règles générales.
- L'ancrage passe avant `%USERPROFILE%`, qui le contient presque toujours : le chemin relatif
  à l'ancrage est plus utile au diagnostic que `~\…`.
- La règle 5b passe avant 5a. Sinon 5a masquerait seulement les morceaux longs d'un JWT et
  laisserait lisible sa partie centrale, qui contient l'identité.

Le masquage laisse intacts, et des tests le vérifient : un chemin (une chaîne avec `/` ou
`\`), une suite hexadécimale (empreinte SHA, GUID), une adresse web, un slug d'article.
`source`, `code`, `etape` et `signature` ne sont jamais masqués.

Deux limites connues :

- Un secret écrit seul, sans mot-clé devant et sans majuscule (une clé DeepL : hexadécimal
  minuscule et tirets), ressemble à un GUID et n'est pas masqué. Les messages construits par
  Pronto placent toujours une clé après son mot-clé, ce qui déclenche la règle 4.
- Un nom de dossier extérieur de 32 caractères ou plus, mêlant majuscules, minuscules et
  chiffres, serait masqué par la règle 5a. Les slugs de Pronto, toujours en minuscules, ne
  sont pas concernés.

### Ce qui n'est pas collecté

- **L'adresse électronique de la personne.** Le rapport contient le compte Windows
  (`poste.utilisateur`), qui identifie un poste, mais pas l'adresse. Si une adresse se
  trouvait dans un message, la règle 6 la masquerait.
- **Les secrets** : jetons, mots de passe, clés d'API (règles 4, 5a, 5b), avec les deux
  limites ci-dessus.
- **Le contenu des articles.** Aucun fichier, extrait de Word ou texte d'article n'est joint.
  Le rapport cite des chemins et, dans `constats`, des codes de contrôle.

Une exception à connaître : `journal.extrait` reprend jusqu'à 200 lignes de la sortie de
`make`, Pandoc et WeasyPrint. Le masquage y retire les secrets et raccourcit les chemins,
mais ne retire pas de texte. Ce sont presque toujours des
chemins, des slugs et des codes. Mais un outil peut citer dans son message d'erreur le
passage qui l'a fait échouer (une clé de citation introuvable, une cellule de tableau mal
formée). Ce passage arrive alors dans le rapport.

## Les plafonds

Dans `PLAFONDS` (`lib/codes-erreur.js`), appliqués par `appliquerPlafonds()` :

| Élément | Plafond |
|---|---|
| `message` | 4 000 caractères |
| `pile` | 8 000 caractères |
| `journal.extrait` | les 200 dernières lignes, et 40 000 caractères |
| `fichiers` | 50 entrées |
| `constats` | 100 entrées |
| fichier entier | 256 Ko, mesurés sur le JSON indenté ; au-delà, `journal.extrait` est vidé et `tronque` passe à `true` |

## L'anti-inondation

Une panne qui se répète ne doit pas écrire un fichier à chaque fois.

- **Signature** : les 12 premiers caractères hexadécimaux de
  `SHA-256(source | code | etape | 200 premiers caractères du message masqué | produit.numero)`,
  un champ absent valant une chaîne vide (`calculerSignature()`).
- Une même signature au plus une fois par 24 heures, par compte.
- 20 rapports au plus par jour, par compte. Le jour est le jour calendaire local.
- Les compteurs sont dans `%LOCALAPPDATA%\SZH\etat-utilisateur.json`, clé `rapports` :
  `{ "<signature>": "<ISO>", "_jour": "2026-09-09", "_compte": 3 }`. Les signatures de plus
  de 7 jours sont effacées à chaque écriture. Les deux écrivains partagent ces compteurs.
- Un rapport écarté par ces limites est perdu. Une ligne de journal le dit.

## La file d'attente hors ligne

Si le dossier des rapports est injoignable (SharePoint pas encore synchronisé, poste hors
ligne), le rapport va dans `%LOCALAPPDATA%\SZH\rapports-en-attente\<id>.json`. Les deux
écrivains utilisent ce même dossier.

- Le démarrage de Pronto vide la file juste après la recherche de l'ancrage
  (`Clear-SzhRapportsEnAttente`, appelée par `Invoke-SzhTachesDemarrage`). Chaque fichier est
  déplacé vers le dossier des rapports ; un échec le laisse en place pour la fois suivante.
- L'activation du cockpit la vide aussi (`viderFileAttente()`).
- Un fichier en attente depuis plus de 30 jours est effacé sans être transmis. Au-delà de 50
  fichiers, les plus anciens sont effacés.

## Les codes d'erreur

Treize codes, dans `CODES` (`lib/codes-erreur.js`) et dans `Get-SzhRapportCodesConnus` /
`Get-SzhRapportResume` (`windows/szh-rapport.ps1`). Chaque code a un résumé en français et en
allemand : une phrase courte et factuelle, lisible sans connaissances techniques.

| Code | Quand | Émis par |
|---|---|---|
| `LANCEUR-TRAP` | exception non rattrapée à l'ouverture d'un `.md` par double-clic ; `fichiers` porte le chemin reçu | `windows/open-md.ps1` (bloc `trap`) |
| `LANCEUR-CODIUM-ABSENT` | VSCodium introuvable au démarrage | `Show-SzhCodiumAbsent` (`windows/szh-shell.ps1`), appelée par `Start-SzhAccueil` et par `open-revue.ps1` avant d'ouvrir un lien |
| `ACCUEIL-COCKPIT-ABSENT` | l'extension cockpit manque, ou sa version est inférieure à `$SzhCockpitAccueilMin` ; une fenêtre renvoie à « Pronto (Updater) » | `Start-SzhAccueil` (`windows/szh-shell.ps1`) |
| `ANCRAGE-INTROUVABLE` | aucun ancrage après détection et demande à l'utilisateur (origine `absent`). Pas de rapport quand la demande a été évitée (moins de 24 heures depuis la dernière, ou simulation) | `Invoke-SzhTachesDemarrage` (`windows/szh-shell.ps1`) |
| `MAJ-ETAPE-ECHEC` | une étape de la mise à jour échoue, les suivantes continuent | `Show-SzhErreur` (`windows/szh-common.ps1`), appelée par `update.ps1` |
| `MAJ-ECHEC` | la mise à jour s'arrête avant la fin | `Show-SzhErreur`, appelée par `update.ps1` |
| `ARCHIVAGE-ECHEC` | l'archivage ou le désarchivage échoue ; `fichiers` porte le dossier du numéro | `Show-SzhErreurArchivage` (`windows/archive-revue.ps1`) |
| `COMPIL-ECHEC` | une compilation se termine avec un code de sortie non nul. Les constats de contenu (tableau sans en-tête, figure sans texte alternatif…) ne déclenchent pas de rapport à eux seuls | `relireJournal` (`lib/controles-hote.js`) |
| `COCKPIT-EXCEPTION` | une exception sort d'une commande `szh.*` du cockpit. Le cockpit n'écoute pas les exceptions globales : le processus est partagé avec les autres extensions | `signalerExceptionCockpit` (`extension.js`), autour de chaque commande déclarée par `cmd()` et `cmdEcriture()` |
| `LANCEUR-SIGNALEMENT` | une personne clique « Signaler une erreur… » dans l'onglet Journal de l'Accueil et écrit une phrase | `lib/accueil-journal-hote.js` |
| `COCKPIT-SIGNALEMENT` | une personne clique « Contacter le support » sur une carte de contrôle qui le propose, ou sur la notification d'une compilation arrêtée sans cause lisible | `signalerConstat` (`lib/controles-hote.js`) |
| `NETTOYEUR-ECHEC` | le nettoyeur de manuscrit s'arrête sur un défaut du logiciel (plantage, échec de préparation, échec du rendu du rapport). Les refus attendus et l'interruption n'en produisent pas | `lib/accueil-preproc-hote.js` |
| `RAPPORT-ECHEC-ECRITURE` | l'écriture d'un rapport échoue. Jamais écrit en rapport : journal local seulement | les deux écrivains |

Précisions sur les rapports déclenchés par une personne ou par le nettoyeur :

- `COCKPIT-SIGNALEMENT` : `etape` porte le contrôle (`source/code`), `message` le contrôle et
  le slug, `constats` le seul constat (code, ton, slug, sans sa phrase ni son texte brut),
  `journal` la fin de `.szh-journal.log`. L'écran dit « Signalement enregistré » seulement si
  le fichier est écrit dans le dossier partagé ; sinon il dit ce qui s'est passé (file
  d'attente, anti-inondation, refus). Un brouillon de courriel au support s'ouvre ensuite,
  avec le chemin du rapport, jamais le texte de l'article.
- `NETTOYEUR-ECHEC` : `message` ne porte que la nature de l'échec, le type d'exception et le
  lieu dans le code (`fichier.py:ligne`), jamais de texte du manuscrit, de nom de fichier ni
  de chemin.

`test/js/codes-erreur.test.js` relit tous les `-Code '…'` cités dans `windows/*.ps1` et
exige que chacun soit connu des deux tables. Un code ajouté d'un seul côté serait refusé par
`Test-SzhRapportValide` et le rapport ne serait pas écrit.

## La règle de stabilité

- Un code publié ne se renomme et ne se supprime jamais : un poste peut garder une ancienne
  version pendant des mois et écrire encore ce code.
- Les valeurs des listes fermées (`gravite`, `source`, `relatifA`, `ancrage.origine`) ne
  changent ni d'orthographe ni de sens.
- Un changement de forme (nouveau champ obligatoire, sens nouveau d'un champ, autre ordre des
  clés) passe par une nouvelle valeur de `schema` (`"szh-rapport-erreur/2"`). Un lecteur
  sait ainsi, par `schema`, quelle forme attendre.

## Deux écrivains, un format

| Fichier | Rôle |
|---|---|
| `vscodium-extension/szh-cockpit/lib/codes-erreur.js` | la table des codes, les constantes du format (version, listes fermées, plafonds, seuils d'anti-inondation) et les fonctions pures : `masquer`, `versCheminRelatif`, `calculerSignature`, `calculerId`, `appliquerPlafonds`, `validerRapport`. Aucun accès disque |
| `vscodium-extension/szh-cockpit/lib/rapport-erreur.js` | l'écrivain du cockpit : ancrage sur trois niveaux, construction, anti-inondation, file d'attente, écriture |
| `windows/szh-rapport.ps1` | l'écrivain PowerShell : construit, masque, plafonne, valide, applique l'anti-inondation, écrit ou met en attente |
| `windows/szh-ancrage.ps1` | l'ancrage SharePoint |
| `test/js/codes-erreur.test.js` | la table et les fonctions pures |
| `test/js/rapport-erreur.test.js` | l'écrivain du cockpit et ses points d'appel |
| `test/js/rapport-erreur-ps.test.js` | l'égalité des deux écrivains : même format, même masquage, même signature, même id, mêmes plafonds |
| `test/js/ancrage-sharepoint.test.js`, `test/js/lanceur-ancrage.test.js` | la recherche de l'ancrage, et son appel unique au démarrage |

Pour un même incident, les deux écrivains produisent la même signature, le même ordre de
clés, sans BOM, avec la même indentation. Trois champs diffèrent, parce que chacun ne voit
qu'une partie du poste :

| Champ | PowerShell | Cockpit |
|---|---|---|
| `poste.powershell` | renseigné | `null` |
| `versions.cockpit` | `null` | renseigné (depuis `package.json`) |
| `poste.os` | quatre nombres (`10.0.26200.0`) | trois nombres (`10.0.26200`) |

Les deux fonctions ne s'appellent pas de la même façon pour le journal :
`emettreRapport` (cockpit) reçoit `journal: { chemin, extrait }` déjà lu par l'appelant
(`lireExtraitFichier`), alors que `Write-SzhRapport` reçoit `-Journal <chemin>` et lit le
fichier lui-même (`Get-SzhRapportExtraitJournal`). Copier la forme d'un appel d'un côté à
l'autre ferait perdre le journal sans erreur visible.

## L'inventaire des postes

À chaque ouverture de Pronto, `Invoke-SzhCheckin` (`windows/szh-checkin.ps1`) met à jour
`_Systeme\inventaire\<POSTE>.csv` : une ligne par mois et par compte Windows, avec les
versions installées, l'emplacement actif, la place libre et l'adresse de connexion de la
personne ([`EMPLACEMENTS.md`](EMPLACEMENTS.md#le-dossier-_systeme)).

L'inventaire et les rapports ne suivent pas la même règle, parce qu'ils ne servent pas à la
même chose :

| | Rapport d'erreur | Inventaire |
|---|---|---|
| Ce que c'est | la trace d'un incident | l'état d'un poste |
| Adresse de connexion | jamais (masquée par la règle 6 si elle apparaît) | une colonne |
| Raison | un rapport circule, se cite dans un ticket, se relit hors contexte | l'inventaire sert à savoir qui utilise quel poste |

Le nom du fichier d'inventaire ne porte que le nom de la machine : un nom de fichier est
visible de tous dans un dossier partagé.

## Les compteurs d'usage

Le nettoyeur de manuscrit et l'import Word déposent des compteurs d'usage dans
`_Systeme\compteurs\`. Ils servent à repérer les défauts qui se répètent : une règle du
nettoyeur qui signale beaucoup et que personne ne suit, un avertissement de l'import qui
revient sur un article sur deux, un service réseau souvent en panne. Ils mesurent le
logiciel, pas les personnes : aucun fichier n'est relié à un compte, et la synthèse ne
connaît que des totaux.

**Ce qui est compté.** Des mesures nommées, avec des valeurs entières :

- nettoyeur : alertes par règle et par traitement (révision, commentaire, rapport), nombre de
  signes, de paragraphes, de notes, d'images, refus par motif, plantages, pannes réseau par
  service, DOI, ROR et ORCID proposés, plafond de commentaires atteint ;
- import : codes d'avertissement de chaque article converti, nombre d'auteurs et
  d'autrices, combien ont un ORCID ou un ROR, langue devinée ou non.

**Ce qui n'est jamais écrit.** Nom de fichier, slug, titre, nom d'auteur, institution,
adresse, chemin, message d'exception, phrase du manuscrit, heure. Les mesures acceptées
forment une liste fermée (`MESURES_NETTOYEUR`, `MESURES_IMPORT`, `lib/compteurs.js`) : une
mesure absente de la liste est écartée, une règle inconnue devient `Autre`. Du journal
d'import, seul le code d'un avertissement (le second mot de la ligne) est lu.

**Quand.** Le nettoyeur écrit à la fin de chaque passage lancé depuis l'Accueil
(`lib/accueil-preproc-hote.js`). L'import écrit après une conversion réussie (ligne
`[import] converti` de `.szh-journal.log`) et après un réimport réussi, jamais à chaque
compilation : tant qu'un Word attend, l'import se relance à chaque enregistrement.

**Où.** `_Systeme\compteurs\`, dérivé de l'ancrage comme les rapports, jamais sous la racine
active. Le seul écrivain est `lib/compteurs.js`, dans le cockpit. Hors ligne, les fichiers
attendent dans `%LOCALAPPDATA%\SZH\compteurs-en-attente\` (200 fichiers ou 90 jours au plus),
vidé à l'activation du cockpit. Rien n'est écrit quand `SZH_LANCEUR_SIMULE=1` ou
`SZH_RESEAU_INTERDIT` est posée, sauf si `SZH_COMPTEURS` désigne un dossier d'essai.

**Format.** Un fichier par événement, écrit une fois :
`<AAAAMMJJ>-<POSTE>-<source>-<6 hex>.csv`, où `source` vaut `nettoyeur` ou `import`. UTF-8
avec BOM, séparateur `;`, fins de ligne CRLF, une ligne par mesure :

```
date;poste;contexte;version_toolkit;version_rootfs;source;passage;mesure;valeur
2026-09-30;POSTE-01;prod;2.7.0;2.7.0;nettoyeur;dfc2b33a172b;signes;5000
```

- `valeur` est toujours un entier, parce qu'Excel en français de Suisse lirait une virgule
  décimale comme du texte. Un taux s'exprime en pour mille.
- `contexte` vaut `dev` sur une instance de développement (`SZH_MANUSCRIT_CLI` ou
  `SZH_CODIUM_PROFIL` posée, toolkit relié à un dépôt par une jonction, ou
  `"compteurs": "dev"` dans `config.json`), `prod` sinon.
- La date est sans heure. L'heure permettrait de reconstituer quand une personne a
  travaillé, ce qui est une surveillance des heures de travail interdite par l'art. 26 OLT 3,
  et elle n'apporte rien à une synthèse.

**Lire.** `outils/compteurs-synthese.js`, lancé avec le Node de VSCodium
(`ELECTRON_RUN_AS_NODE=1`), produit une page HTML autonome (gabarit
`export-templates/compteurs-synthese.twig`) et un CSV de synthèse :

```
node vscodium-extension/szh-cockpit/outils/compteurs-synthese.js [--dossier D] [--depuis AAAA-MM-JJ] [--jusqua AAAA-MM-JJ] [--contexte prod|dev|tous] [--sortie D]
```

Le contexte `dev` est écarté par défaut. La page commence par les règles à examiner : les
plus fréquentes, et celles qui finissent le plus souvent dans le rapport. Les fichiers
illisibles, à l'en-tête différent ou aux mesures inconnues sont comptés et signalés, sans
arrêter la synthèse.

**Conservation : 24 mois.** `--purger` supprime les fichiers plus anciens (date lue dans le
nom). Sans cette option, rien n'est supprimé.
