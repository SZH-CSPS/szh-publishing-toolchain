# Todo Robin (mis à jour le 2026-08-20, après le cycle de vie des numéros)

## Corrigé après revue adversariale du lanceur (2026-08-20) — à re-vérifier sur le terrain

Une revue adversariale a été passée sur « Logiciel v. … » + « Version du logiciel… ». Dix
constats, dix correctifs. Ce qui suit est **déjà corrigé et vérifié** ici ; ce qu'il reste à
voir sur un vrai poste est marqué en case.

| # | Constat | Correctif |
|---|---|---|
| 1 | `Get-SzhVersionInstallee` levait sur un `VERSION` **vide** (`Get-Content -Raw` → `$null`, `.Trim()` → exception) et, avec `Stop`, **tuait le lanceur avant l'affichage, sans un mot** — typiquement pendant une mise à jour. | `try/catch` sur chacune des deux lectures + repli `''` ; `Get-SzhConfig` / `Get-SzhState` blindés pareil. **Prouvé** : `VERSION` vide + `state.json` tronqué → `''`, script survivant. |
| 2 | Chemin `-Versions` lancé détaché avec `stdio: 'ignore'` : un échec était **100 % muet** des deux côtés. | Le lanceur journalise son entrée dans le chemin (`open-revue : selecteur de versions demande`) et l'installation demandée. **Vérifié dans le journal.** |
| 3 | L'appel réseau (`Get-SzhVersionsPubliees`) se faisait **avant** l'affichage de la boîte : jusqu'à 20 s de fenêtre figée derrière un pare-feu muet. | Boîte affichée d'abord avec « Recherche des versions publiées… », liste remplie au `Shown` ; timeout 20 s → 8 s. |
| 4 | « les versions déjà téléchargées s'installent sans réseau » était **faux** : `update.ps1` télécharge le manifest en première action, et une seule archive de toolkit était conservée. | Manifest **mis en cache** (`staging\manifest-<v>.json`) et relu hors ligne ; **deux** archives de toolkit conservées ; `Get-SzhVersionsLocales` n'annonce que ce qui est réellement installable hors ligne ; textes corrigés (dont le faux « pas de connexion ? » sur un 403 de limite de débit). |
| 5 | L'API GitHub trie par **date**, pas par numéro : `2026.08.10` s'affichait après `2026.08.7`. Un rédacteur cherchant « la précédente » se trompait. | `Sort-SzhVersions` (essai `[version]`, repli alphabétique inverse) ; `per_page` 30 → 100. **Prouvé** : `2026.08.11 > 2026.08.10 > 2026.08.9 > 2026.08.7`. |
| 6 | Le sélecteur de version était **derrière** le test VSCodium : l'outil de réparation inaccessible quand l'installation est abîmée, et un message « VSCodium introuvable » hors sujet au clic depuis le cockpit. | `if ($Versions)` déplacé **avant** le test VSCodium. |
| 7 | Fenêtre passée de 380 à 560 px : sur un 1366×768 à 125 %, elle **sortait de l'écran**, sans recours (`FixedDialog`). | Hauteur des deux listes **adaptée** à `WorkingArea.Height` (4 paliers), toutes les positions calculées. |
| 8 | `$choix` était le seul argument non cité passé à `update.ps1` : `-Version '2026.08.0 -Verbose'` **injectait un paramètre** et n'installait pas la version demandée. | `Test-SzhVersionTag` (alphabet strict) + argument cité. **Prouvé** : l'injection est refusée. |
| 9 | Rien ne bornait la concurrence : deux `update.ps1` écrivaient la même archive et dépliaient deux `Expand-Archive` sur le même toolkit ; le lanceur restait cliquable pendant le remplacement du rootfs. | Mutex nommé `Local\SZH-Publishing-Update` en tête d'`update.ps1` (sortie propre si occupé) ; le lanceur se **ferme** après avoir lancé une installation. |
| 10 | `ShowDialog()` sans propriétaire sur le chemin `-Versions` : la boîte pouvait s'ouvrir **derrière** VSCodium (« le bouton ne fait rien »). | `TopMost` quand il n'y a pas de parent. |

**Bonus, trouvé en testant le contrat des liens** : PowerShell 5.1 écrit un **BOM** avec
`Set-Content -Encoding UTF8`, et `JSON.parse` de Node le refuse. `config.json` (écrit par
`bootstrap.ps1`) en portait un → le cockpit lisait **toujours** le mode développeur par défaut,
en silence ; et l'intention d'ouverture d'un lien `szh://` aurait été jugée illisible, donc le
lien n'aurait **jamais** atterri sur le panneau. Corrigé des deux côtés : un seul écrivain JSON
sans BOM (`Set-SzhJson`, utilisé par `bootstrap`, `new-revue`, `Set-SzhDevMode`, `Set-SzhIntention`)
et un retrait défensif du BOM à la lecture côté JavaScript.

- [ ] **Sur un poste réel** : lancer le lanceur pendant une mise à jour en cours (le cas du
  constat 1) et vérifier qu'il s'ouvre, ou affiche une erreur — mais ne disparaît pas.
- [ ] **Écran 1366×768** (ou 125/150 % de mise à l'échelle) : les deux listes, les infos et les
  quatre boutons tiennent dans l'écran (constat 7 — non reproductible sur ce poste).
- [ ] **Hors ligne** : ouvrir « Version du logiciel… » sans réseau → message correct, et la
  version N‑1 doit être proposée **après une deuxième mise à jour** (le temps que staging ait
  deux archives et deux manifests). Avant cela, la liste hors ligne est vide, c'est normal.
- [ ] **Deux mises à jour concurrentes** : lancer une installation, puis relancer aussitôt le
  sélecteur et réinstaller → la seconde doit dire « une mise à jour est déjà en cours » et sortir.
- [ ] **`Get-SzhVersionsPubliees` derrière le proxy SZH** : mesurer le temps réel et vérifier que
  8 s suffisent (sinon remonter le timeout).
- [ ] **Limite de débit GitHub** (60 requêtes/h/IP publique, tout un bureau derrière la même) :
  confirmer que le message « trop de demandes vers GitHub depuis ce réseau » est compréhensible.
  Si le cas devient fréquent, il faudra mettre la liste des versions en cache elle aussi.

## À vérifier — le lanceur ne liste que l'arborescence officielle (D125)

Éprouvé ici avec de vraies fixtures : une revue dans `RV02_Redaction` est **listée**, une revue
dans `OneDrive\Revues` est **signalée et non listée**, les racines héritées sont dédoublonnées et
celles qui coïncident avec un emplacement officiel écartées (`revuesRoots` en contenait une, posée
par l'ancien `new-revue.ps1`). Le lanceur reste vivant avec les fixtures en place.

- [ ] Vérifier de visu la ligne « N revue(s) hors arborescence dans … — à déplacer » sous les
  listes, et qu'elle disparaît une fois le dossier déplacé.
- [ ] **Les deux dossiers de `OneDrive - SZH CSPS\Revues` de ce poste** (`2026-04`, `test`) n'ont
  **pas** d'`ausgabe.yaml` : ce ne sont pas des revues (restes d'essais — `articles`, `out`,
  `articles-word`). Ils n'étaient donc déjà pas listés. À supprimer si tu n'en as plus besoin.
- [ ] `config.json` de ce poste porte encore `revuesRoots = ["…\Revues-TESTING+_Zeitschrift\ZS02_Redaktion"]`,
  posé par l'ancien `new-revue.ps1`. Inoffensif (le lanceur écarte les emplacements officiels de la
  liste héritée), mais tu peux vider la clé.
- [ ] **Décider** si une revue hors arborescence doit rester non listée. Aujourd'hui : signalée,
  jamais listée, jamais déplacée d'office.

## Constaté au déploiement de v2026.08.22 — `update.ps1` lancé à la main est en retard d'une passe

`update.ps1` extrait le nouveau toolkit à son étape 1, mais PowerShell a déjà lu tout le fichier :
la suite tourne avec l'ANCIEN code. Lancé à la main sur ce poste, il a donc bien installé le
cockpit 0.13.0 mais **n'a créé ni le raccourci « Zeitschriften SZH » ni le protocole `szh:`** — il
a fallu le relancer. La tâche planifiée n'a pas ce défaut (`update-launcher.ps1` extrait le
toolkit **avant** de passer la main). Vérifié après relance : les deux raccourcis sont là avec les
bons arguments, `HKCU\Software\Classes\szh` porte `URL Protocol` et la bonne commande, et la
chaîne menu Démarrer → `hidden.vbs` → `open-revue.ps1 -Produit zeitschrift` lance bien le lanceur
filtré.

- [ ] **Décider** s'il faut qu'`update.ps1` se relance tout seul quand il constate que sa propre
  copie a changé (une passe, un commutateur `-Relance` pour borner la récursion) — aujourd'hui
  c'est à la main, et seul un lancement manuel est concerné.

## À vérifier — liens de traduction et second lanceur (D123, D124)

**Éprouvé sur ce poste** : la grammaire `szh://` refuse tout ce qu'elle doit refuser (produit
inconnu, `..`, `C:\Windows`, espace, segment surnuméraire, autre schéma, chaîne vide) des DEUX
côtés — `lib/liens.js` et le motif PowerShell ; la liaison des arguments `-File` a été mesurée
pour les quatre formes utilisées (nommé, nommé requoté par `hidden.vbs`, switch requoté,
positionnel requoté) ; l'extension charge, i18n 487 = 487 (fr/de), tous les `%marqueurs%` traduits.

**Pas encore tourné** : le protocole `szh:` n'est pas enregistré sur ce poste (il l'est par
`update.ps1`, non exécuté), donc **aucun lien n'a jamais été cliqué**, et l'atterrissage
(intention → panneau) n'a jamais été joué de bout en bout.

### 8. Envoyer pour traduction (D123)

- [ ] Le bouton **« Envoyer pour traduction »** apparaît dans le panneau de traduction, à côté
  d'*Enregistrer*, et son infobulle est lisible.
- [ ] Les boutons ✉ apparaissent dans la barre : sur la section **Traductions** (lien vers tout le
  numéro) et sur **chaque article** de cette section.
- [ ] Un clic : le lien est bien dans le presse-papiers (coller quelque part pour vérifier) **et**
  le brouillon d'e-mail s'ouvre avec le sujet, le corps et le lien.
- [ ] Vérifier la forme du lien : `szh://traduction/revue/2026-01/03-inklusion` depuis le panneau
  d'un article, `szh://traduction/revue/2026-01` depuis la section.
- [ ] Sur une **Zeitschrift**, le lien doit dire `zeitschrift` (et non `revue`).
- [ ] Cas de refus : un numéro dont `ausgabe.yaml` n'a pas de clé `revue:`, ou dont le dossier
  s'appelle p. ex. `2026 01` (espace) → message « Lien impossible à construire », **pas** de lien
  bancal copié.
- [ ] Le bouton fonctionne aussi sur un numéro **verrouillé** (il ne modifie rien) — c'est même là
  qu'il sert le plus.
- [ ] Il ne change **aucun statut** de traduction : vérifier qu'un champ « pas prêt » le reste.
- [ ] **Le clic sur le lien**, depuis Outlook et depuis Teams : Windows demande l'autorisation la
  première fois → accepter → la bonne revue s'ouvre et le panneau de traduction s'affiche sur le
  bon article. À refaire une fois VSCodium **déjà ouvert** sur une autre revue, et une fois
  VSCodium **fermé**.
- [ ] Le lien d'un numéro **archivé** ouvre bien la revue depuis les archives.
- [ ] Cas d'échec à provoquer : lien vers un numéro qui n'existe pas sur le poste → message
  « introuvable sur ce poste » ; lien tordu à la main (`szh://traduction/revue/../x`) → message
  « lien non valide », et **rien** ne s'ouvre.
- [ ] `%LOCALAPPDATA%\SZH\intention.json` : créé au clic, **supprimé** dès que le cockpit l'a
  consommée. Vérifier qu'il ne traîne pas.
- [ ] Intention **périmée** : cliquer un lien, fermer la fenêtre avant qu'elle ne s'ouvre, attendre
  6 minutes, ouvrir la revue à la main → le panneau ne doit **pas** s'ouvrir tout seul, et le
  fichier doit disparaître.
- [ ] Intention pour une **autre** revue : cliquer un lien vers 2026-01 puis ouvrir 2026-02 à la
  main → 2026-02 ne doit rien ouvrir, et 2026-01 doit encore atterrir quand elle s'ouvre.
- [ ] Sur un poste **sans** la chaîne installée, le lien ne fait rien (ou ouvre le navigateur) :
  confirmer que le message de l'e-mail explique le repli (« menu Démarrer → Revues SZH »).

### 9. Second lanceur « Zeitschriften SZH » (D124)

- [ ] Le raccourci **« Zeitschriften SZH »** apparaît dans le menu Démarrer après une mise à jour,
  avec la bonne icône, et n'ouvre **aucune console**.
- [ ] Il ne liste que les Zeitschriften (les deux listes, en cours et archivées), et « Revues SZH »
  continue de tout lister.
- [ ] Le titre de la fenêtre et le texte d'introduction sont bien ceux de la Zeitschrift.
- [ ] « Nouvelle revue… » depuis ce lanceur propose `ZS02_Redaktion` (et non `RV02_Redaction`).
- [ ] Un numéro **sans** clé `revue:` n'apparaît dans **aucun** des deux lanceurs filtrés (mais
  reste visible dans « Revues SZH ») — vérifier que c'est acceptable, sinon il faut le signaler.
- [ ] Une Zeitschrift rangée dans un dossier **historique** (`OneDrive\Revues`) n'apparaît PAS dans
  les listes (D125) mais est comptée dans « N revue(s) hors arborescence ».
- [ ] Le bouton « Version du logiciel… » et l'affichage « Logiciel v. … » marchent dans les deux
  lanceurs.
- [ ] **Décision** : faut-il aussi filtrer « Revues SZH » sur la Revue (au lieu de tout montrer) ?
  Aujourd'hui il montre tout, pour ne rien retirer à qui l'utilise déjà.
- [ ] **Décision** : le lanceur Zeitschrift doit-il forcer l'interface en allemand ? Aujourd'hui
  non — la langue suit celle de Windows, comme partout.
- [ ] **Relire les libellés DE/EN** ajoutés (titres des deux lanceurs, messages de lien).

## À vérifier — cycle de vie des numéros : archivage, verrou, export, version, mode test (D116, D117, D119, D120)

**Ce qui est déjà éprouvé sur ce poste**, à ne pas refaire : sérialisation d'`ausgabe.yaml`
(booléens nus `locked: true`, estampille citée, 27 commentaires préservés, clés ajoutées
proprement sur un fichier ancien) · déplacement **aller-retour** réel d'une revue de test dans
`Revues-TESTING` (`out/` supprimé, `.lnk` réécrit sur les deux chemins, verrou conservé au
désarchivage, classement du lanceur) · chemin d'erreur d'`archive-revue.ps1` (journal + écran
d'erreur dédié) · les deux fenêtres WinForms se construisent sans exception (lanceur et sélecteur
de version) · la liste des releases GitHub remonte (26 versions, l'installée marquée) · tous les
`.js` compilent et se chargent, i18n 475 = 475 (fr/de), `package.json`/nls valides, les 8 `.ps1`
parsent, `files.readonlyInclude` existe bien dans le VSCodium installé (1.109, scope resource).

**Ce qui n'a PAS tourné** : tout ce qui passe par VSCodium (l'extension n'a jamais été chargée),
et la réouverture de l'éditeur par `archive-revue.ps1` (`Start-Process`, non exécutée pour ne pas
ouvrir de fenêtre — même ligne que dans `open-revue.ps1` / `new-revue.ps1`).

### 0. Préparer le terrain

- [ ] Publier une release depuis cette branche (ou installer le toolkit à la main) : **rien de ce
  qui suit n'est testable sans le VSIX `szh-cockpit` 0.11.0 ET le toolkit déployé** —
  `archive-revue.ps1` est appelé par son chemin dans `C:\ProgramData\SZH\toolkit\windows\`.
- [ ] Vérifier que `devMode` est bien à `true` (« Réglages SZH » ou `config.json`) **avant** le
  premier essai : sinon le premier clic déplace un vrai numéro.
- [ ] Créer **deux revues de test** dans `Revues-TESTING\52_Revue\RV02_Redaction` — une avec
  `revue: revue`, une avec `revue: zeitschrift` (les deux arborescences sont distinctes) — avec
  chacune 2–3 articles compilés, des images, un tableau, des traductions renseignées.

### 1. Verrouiller / déverrouiller (D116)

- [ ] `Ctrl+Alt+D` sur une revue neuve : le panneau montre **Archiver et verrouiller**, et **pas**
  Déverrouiller / Désarchiver / Exporter cet article.
- [ ] Après verrouillage : **taper dans un article** — rien ne doit s'écrire, l'éditeur est grisé.
- [ ] Chaque geste d'écriture doit répondre « Numéro verrouillé » + bouton **Déverrouiller** :
  ➕ Importer des Word · ▶▶ Convertir les Word en attente · ⚙ Méta-données du numéro ·
  ☰ Métadonnées des articles · ✎ d'un article · 🌐 Traductions (article et champ) · ✓✓ de la
  section Traductions · 🗑 Supprimer l'article · clic sur une **image** (fiche) · clic sur un
  **tableau** (éditeur) · Remplacer/Supprimer image · Remplacer/Supprimer tableau ·
  `Ctrl+B` / `Ctrl+Alt+1` / `Ctrl+Alt+F` / `Ctrl+Alt+V` (mise en forme) · **glisser un `.docx`
  sur la vue**.
- [ ] Les boutons de survol **disparaissent** quand le numéro est verrouillé (✎, 🗑, ▶▶, ✓✓,
  Remplacer…) — c'est le `when` de `package.json`, à confirmer à l'œil.
- [ ] Le clic sur le bouton **Déverrouiller** de ce message ouvre bien la confirmation.
- [ ] Le titre de la barre porte le picto (🔒 / 📦 / 📦 🔒) et la **barre d'état** affiche
  « Verrouillée » ; son infobulle nomme la version de création et celle du poste ; le **clic**
  déverrouille (ou désarchive si le numéro n'est qu'archivé).
- [ ] `Ctrl+S` ne relance **plus** de compilation sur un numéro verrouillé.
- [ ] `<revue>\.vscode\settings.json` : **présent** et **invisible** dans l'explorateur de
  VSCodium quand le numéro est verrouillé ; **supprimé** (avec le dossier `.vscode`) au
  déverrouillage ; **jamais créé** sur une revue ordinaire — ouvrir 2–3 revues « en cours » et
  vérifier qu'aucun `.vscode` n'apparaît (c'était le piège : `update(…, undefined)` matérialise
  le fichier).
- [ ] Déverrouiller : l'éditeur redevient éditable **sans redémarrer** VSCodium, tous les boutons
  reviennent, `Ctrl+S` recompile.

### 2. Archiver / désarchiver (D116)

- [ ] La confirmation d'archivage annonce une **place** cohérente avec le poids réel de `out/`
  (comparer dans l'explorateur Windows) ; sur une revue jamais compilée, elle dit « aucun
  document produit pour l'instant ».
- [ ] **Annuler** la confirmation ne change rien du tout (drapeaux, `out/`, emplacement).
- [ ] Geste complet : la fenêtre se ferme → la console PowerShell nomme ses étapes → la revue
  **se rouvre depuis les archives**, verrouillée, arbre correct.
- [ ] `out/` a bien disparu, et **rien d'autre** : `articles/`, `articles-word/`, `media/`,
  `tables/`, `portraits/`, `*.meta.yaml`, `*.traduction.yaml`, `BIENVENUE.md` sont tous là.
- [ ] `ausgabe.yaml` porte `locked: true`, `archived: true` et une `version-toolkit`.
- [ ] Le raccourci **« Ouvrir la revue.lnk »** du dossier archivé rouvre le **nouveau** chemin.
- [ ] La **Zeitschrift** part bien dans `ZS99_Archives` (et pas dans `RV99_Archives`).
- [ ] **Cas d'échec à provoquer** : ouvrir le PDF dans SumatraPDF (fichier verrouillé côté
  Windows) puis archiver → message « les documents produits n'ont pas pu être supprimés »,
  et le numéro doit être **exactement** dans son état de départ (drapeaux relevés, dossier non
  déplacé, `out/` intact).
- [ ] **Cas de collision** : mettre un dossier du même nom dans `RV99_Archives` puis archiver →
  la console doit dire « un dossier existe déjà à destination », **rien** n'est déplacé.
- [ ] Désarchiver : retour dans `RV02_Redaction`, `.lnk` réécrit, et le verrou **toujours posé**
  (deux gestes distincts — **confirmer que c'est bien ce que tu veux**, sinon je fusionne).
- [ ] Sur un numéro archivé **puis déverrouillé**, le panneau propose « Verrouiller la revue »
  (sans déplacement ni suppression) — vérifier que ça ne rejoue pas un archivage.

### 3. Compilation d'un numéro gelé (D117)

- [ ] Cliquer un article d'un numéro archivé : **aucune compilation** ne démarre, et le volet de
  droite affiche « Numéro gelé : la compilation automatique est coupée… » (et non un message
  d'attente qui ne viendrait jamais).
- [ ] Idem en mode aperçu **PDF** (`Ctrl+Alt+P`) : message, pas de relance.
- [ ] **Exporter cet article** : bouton au survol de l'article **et** entrée du panneau d'export ;
  le PDF + l'aperçu reviennent, l'aperçu s'affiche tout seul à la fin.
- [ ] Sans article sélectionné, l'entrée du panneau doit dire « Aucun article visé… » (et non
  échouer en silence).
- [ ] **Recompiler toute la revue** sur un numéro archivé fonctionne aussi.
- [ ] **Exporter la revue en XML (OJS)** sur un numéro archivé : à confirmer que c'est utile et
  que ça marche (il recompile tout + les galleys DOCX).
- [ ] Rouvrir la revue après l'export : les PDF régénérés s'affichent normalement, sans build.

### 4. Version du logiciel (D120)

- [ ] Une **nouvelle** revue (« Nouvelle revue… ») porte `version-toolkit: "<version du poste>"`
  dès sa création.
- [ ] Une revue **existante** sans la clé ne déclenche **aucun** avertissement (et n'est pas
  estampillée en douce) ; elle l'est au premier archivage.
- [ ] Avertissement de divergence : éditer `version-toolkit` à la main pour créer un écart, puis
  `Ctrl+S` → le message apparaît **une seule fois par fenêtre** et nomme les deux versions.
  Vérifier qu'il arrive aussi sur `Ctrl+E`, « Recompiler toute la revue » et « Exporter cet
  article », et qu'il **ne revient pas** à chaque enregistrement suivant.
- [ ] Le bouton **« Changer de version… »** du message ouvre le sélecteur **sans console noire**
  derrière le dialogue.
- [ ] Le lanceur affiche « Logiciel v. … » et le bouton « Version du logiciel… » ouvre le même
  dialogue (l'installée marquée, les téléchargées annotées).
- [ ] **Aller-retour de version pour de vrai, sur un poste de test** : fermer toutes les revues,
  installer une version antérieure, vérifier que le PDF d'un ancien numéro redevient conforme,
  puis réinstaller la dernière. C'est le seul test qui prouve la promesse « recompiler à
  l'identique ».
- [ ] Couper le réseau et rouvrir le sélecteur : il doit proposer les versions **déjà
  téléchargées** avec le message « impossible de lister les versions publiées ».

### 5. Lanceur et emplacements (D116, D119)

- [ ] Deux listes (« En cours » / « Archivées »), **🔒** sur les verrouillées, et la sélection
  bascule bien d'une liste à l'autre (cliquer dans l'une désélectionne l'autre — sinon
  « Ouvrir » ne saurait pas quoi ouvrir).
- [ ] Double-clic dans **chacune** des deux listes ouvre la revue.
- [ ] Une revue déplacée **à la main** dans `RV99_Archives` (sans le bouton) apparaît quand même
  dans « Archivées ».
- [ ] « Nouvelle revue… » propose par défaut le dossier de rédaction **en cours** du mode actif.
- [ ] Les anciennes revues de `OneDrive\Revues` (et de `revuesRoots`) ne sont plus listées mais
  signalées sous les listes (D125).
- [ ] Sur un poste **sans** aucune revue : la fenêtre s'ouvre quand même avec « Nouvelle revue… ».

### 6. Mode développeur (D119)

- [ ] « Réglages SZH » montre le groupe **Mode développeur** avec le bon état, et le changement
  est écrit dans `C:\ProgramData\SZH\config.json` (`devMode`).
- [ ] Le désactiver → relancer le lanceur → il lit les dossiers **de production** et **n'y crée
  rien** ; le remettre → il recrée/relit `Revues-TESTING`.
- [ ] Archiver en mode production (sur un numéro de test copié dans `RV02_Redaction`) pour
  confirmer que les vrais chemins fonctionnent aussi.
- [ ] **Confirmer l'arborescence de production sur un poste de la rédaction** : les quatre chemins
  ont été vérifiés présents **ici**
  (`…\SZH CSPS\Daten_Allgemein - General\2_Produkte\52_Revue\RV02_Redaction` et `RV99_Archives`,
  idem `53_Zeitschrift\ZS02_Redaktion` / `ZS99_Archives`). Si un poste synchronise la
  bibliothèque sous un autre nom → corriger `basesRevues.prod` dans `config.json`.
- [ ] Nettoyer les 4 dossiers créés dans ton `OneDrive - SZH CSPS\Revues-TESTING` pendant mes
  essais s'ils ne te servent pas (ils seront recréés au prochain lancement en mode test).

### 7. Décisions qui te reviennent

- [ ] **Auto-compilation sur un numéro seulement verrouillé** : je l'ai coupée aussi (des sources
  gelées n'ont rien à recompiler), alors que la demande ne parlait que d'`archived`. Idem pour le
  bouton « Exporter cet article », affiché dès que `locked || archived`. À confirmer ou à
  restreindre.
- [ ] **Désarchiver ne déverrouille pas** (deux boutons indépendants) : confirmer.
- [ ] **La fenêtre se ferme et se rouvre** à l'archivage : c'est la seule façon de déplacer un
  dossier que VSCodium tient ouvert. Confirmer que c'est acceptable pour la rédaction (l'autre
  option serait de ne pas rouvrir du tout).
- [ ] **Quand `devMode` passe à `false`** par défaut — aujourd'hui vrai partout, y compris sur un
  poste neuf (`bootstrap.ps1`) et si la clé manque.
- [ ] **`locked: false` / `archived: false` dans `revue-template/ausgabe.yaml`** : les deux clés
  arrivent donc aussi dans les métadonnées pandoc (inutilisées, inoffensives). À laisser pour la
  lisibilité du fichier, ou à retirer du template si tu préfères des clés absentes par défaut.
- [ ] **Relire les libellés DE** de tout le lot (panneau d'export, modales de confirmation, barre
  d'état, écran d'archivage, sélecteur de version, mode développeur) — premier jet, comme le
  reste de l'i18n.
- [ ] **Nommage** : la clé s'appelle `version-toolkit` (et non « version compilateur ») pour
  coller au vocabulaire du dépôt (`toolkit/VERSION`, `toolkit-X.zip`). À valider.

## Validations qui demandent un humain — en-tête condensé, légendes, corrections (D114, D115, D118)

Éprouvé en PNG page à page sur `test/` et sur un corpus de contrôle (couverture courte,
couverture chargée, figure + deux tableaux + listes) : le rendu par défaut ne change QUE
sur les deux flèches du hero et sur la position des puces ▸. **Rien n'a encore tourné dans
VSCodium** (la case à cocher) ni sur un vrai numéro.

- [ ] **Trancher l'allure par défaut** : l'option est **décochée** par défaut, donc les numéros
  existants ne bougent pas. Après l'avoir vue sur un vrai dossier, dire si le condensé doit
  devenir la norme (il suffirait d'inverser le défaut dans `revue-template/ausgabe.yaml`).
- [ ] **Juger les trois espaces minimum** de l'en-tête condensé (`--hero-espace-titre` 20 px,
  `-soustitre` 12 px, `-meta` 22 px, `print.css` §5) et le plancher `min-height: 220px` sur
  une couverture vraiment dépouillée (titre d'une ligne, un auteur, pas de sous-titre).
- [ ] **La case à cocher dans VSCodium** : formulaire « Méta-données du numéro » → cocher,
  **Enregistrer**, vérifier `entete-condensee: true` dans `ausgabe.yaml` (booléen nu, non
  cité), la recompilation, puis décocher et vérifier `false`.
- [ ] **Relire le libellé DE** de la case et son aide (premier jet, comme le reste de l'i18n).
- [ ] **Légende de figure au-dessus** sur un article réel : l'ordre visuel et l'ordre de lecture
  concordent (copier-coller de la page, panneau « Ordre » d'Acrobat). Le **galley Word**, lui,
  garde la légende SOUS l'image — le writer docx de pandoc ne se règle pas : confirmer que
  c'est acceptable pour OJS.
- [ ] **Puces ▸ à l'œil** dans un article dense (listes imbriquées, item d'une seule ligne,
  item qui passe à la ligne) : le triangle doit rester posé sur la ligne de base du texte.

## Validations qui demandent un humain — enregistrement auto et mots-clés (D121–D122)

- [ ] **L'enregistrement automatique ne fait pas sauter le curseur** : taper longuement
  dans un résumé, vérifier qu'au bout de 3 s le fichier est écrit (horodatage) SANS que
  la frappe, la sélection ou la position du curseur ne bougent. À faire dans les quatre
  formulaires : traduction, métadonnées des articles, vérification de l'import, éditeur
  de tableau.
- [ ] **Fiche image** : confirmer qu'elle ne déclenche PAS de compilation pendant la
  saisie (pas de minuteur), et qu'elle enregistre bien quand on quitte le panneau.
- [ ] **Grille de mots-clés** : ajouter et retirer une ligne, cocher puis décocher
  « + Italien » avec des mots-clés IT présents — ils ne doivent jamais disparaître.
  Vérifier dans le `.meta.yaml` que les listes restent alignées.
- [ ] **`TO BE TRANSLATED`** : laisser un mot-clé du milieu non traduit, enregistrer,
  rouvrir — la case doit réapparaître vide et les paires rester en face. Puis lancer
  l'export OJS et vérifier l'avertissement.
- [ ] **Bouton DeepL** : sur un résumé long (proche de 4000 caractères) et sur un titre
  avec apostrophes typographiques et caractères accentués.
- [ ] **Arbitrer** : faut-il une clé d'API DeepL (réglage + appel côté hôte) pour que la
  traduction revienne toute seule dans le champ, au lieu du copier-coller ?

## Validations qui demandent un humain — suivi de traduction (D113)

Éprouvé headless (arbre, écritures croisées fiche/sidecar, effacement, slug hors liste) ;
**rien n'a encore tourné dans VSCodium**. À voir sur un vrai numéro :

- [ ] **Le panneau à l'écran** : clic sur un article de la section « Traductions » → formulaire
  en colonne 1, aperçu de l'article en colonne 2. Vérifier que l'aperçu se compile bien
  (il passe par `ouvrirArticle` en mode `sansTexte`) et que la bascule `Ctrl+Alt+P`
  HTML ⇄ PDF fonctionne depuis ce panneau.
- [ ] **Changer d'article avec des modifications non enregistrées** : la modale
  « Enregistrer / Quitter sans enregistrer / Annuler » doit apparaître et chaque branche
  faire ce qu'elle annonce (c'est le seul chemin non couvert par le harnais).
- [ ] **Lisibilité de la carte de champ** : le texte source en bloc pointillé, la barre de
  couleur d'état à gauche, le badge « traduit / à traduire ». Le panneau est en colonne 1
  (moitié d'écran) — vérifier qu'un résumé long reste confortable à saisir.
- [ ] **Le bouton ✓✓ de la section** sur un vrai numéro : compter les champs annoncés dans la
  barre d'état, et confirmer qu'aucun champ déjà en relecture ou finalisé n'a reculé.
- [ ] **Arbitrer le périmètre** : seuls titre / sous-titre / résumé / mots-clés sont suivis.
  Faut-il une ligne « Texte de l'article » (statut + commentaire, sans texte cible) pour
  suivre la traduction intégrale, qui vit dans l'autre revue ?
- [ ] **Relire les libellés DE** du panneau et de l'arbre (premier jet, comme le reste).

## Validations qui demandent un humain — hiérarchie de titres et tableaux (D110–D112)

- [ ] **Rejouer un numéro complet** après la release : un seul `<h1>`, corps à partir de `<h2>`,
  numérotation 1 / 1.1 / 1.1.1 inchangée à l'œil, et le galley Word toujours Title puis
  Heading2+.
- [ ] **Lecteur d'écran sur un tableau markdown** (pipe ou grid) : les `scope` posés par
  `szh-tabelle-scope.lua` doivent faire annoncer l'en-tête de colonne à chaque cellule.

## Validations qui demandent un humain — accessibilité figures/tableaux (D108–D109)

- [ ] **Juger le rendu** d'un article réel : la légende porte « Figure N — … » puis les crédits
  en plus petit sur la même ligne ; vérifier que la taille distingue assez les crédits sans
  descendre sous le seuil APCA (le gris n'a **pas** été éclairci exprès, cf. D87).
- [ ] **Écouter avec un lecteur d'écran** (NVDA/Narrateur) une figure avec `alt=` distinct,
  une figure sans `alt=` (la légende y est annoncée **deux fois** — c'est le prix de la
  compatibilité, et le signal qu'il faut écrire un vrai texte alternatif), une image
  décorative, un tableau avec description longue et un tableau sans.
- [ ] **Arbitrer un signalement à la compilation** : « N figure(s) utilisent la légende comme
  texte alternatif ». C'est le seul cas restant de double annonce ; à mettre en balance avec
  le bruit ajouté au panneau.
- [ ] **Crédits sur une figure sans légende** : aujourd'hui perdus (il n'y a pas de
  `<figcaption>` où les mettre), alors que les tableaux se voient fabriquer une `<caption>`
  crédit-seule. Aligner les figures ou non ?
- [ ] **Import Word — texte alternatif** : les descriptions automatiques de Word/Copilot sont
  jetées (majoritaires dans le corpus). Vérifier sur un numéro réel que les descriptions
  **écrites à la main** par la rédaction sont bien reprises, et qu'aucune ne l'est à tort.
  ⚠ Le filtrage repose sur une liste de formulations ; une future tournure de Microsoft
  passerait au travers.
- [ ] **Vignettes dans un lien** (`[![](img)](url)`, rubrique Actualités) : jamais légendées ni
  décrites, donc décoratives par défaut — vérifier éditorialement qu'aucune ne porte de
  l'information.
- [ ] **Verser le corpus de test d'accessibilité dans `test/articles/`** : `test/` ne contient
  aujourd'hui ni image ni tableau légendé, la non-régression y est donc peu informative.

## Validations qui demandent un humain — fiche image et crédits (D105–D107)

- [ ] **Fiche image (D106)** : cliquer une image dans l'arbre → fiche en colonne 1 (aperçu,
  « L × H · poids », champs pré-remplis depuis le `.md`). Remplir les quatre champs,
  Enregistrer, vérifier le `.md` ; **Ctrl+Z dans l'éditeur doit défaire l'écriture**. Taper
  dans le `.md` sans enregistrer puis enregistrer depuis la fiche : la frappe ne doit pas
  être perdue. Modifier puis « Retour à l'article » → modale ; indicateur ● sur l'onglet.
- [ ] **Les trois états d'accessibilité (D105)** : « image décorative » → `alt=""` dans le
  `.md` ; repasser à « apporte une information » avec le champ vide → l'attribut `alt`
  **disparaît entièrement** ; remplir le champ → `alt="…"`. Vérifier au rendu que la
  légende est lue dans les trois cas.
- [ ] **Cas particuliers de la fiche** : image jamais insérée (bandeau, champs grisés) ;
  image insérée deux fois (bandeau, les deux références mises à jour) ; figure portant déjà
  `{width=50%}` (l'attribut doit survivre) ; vider les trois champs → plus aucun bloc `{…}` ;
  SVG et image > 12 Mo (message d'aperçu indisponible) ; « Ouvrir l'image » → visionneuse
  native ; supprimer l'image depuis l'arbre pendant que sa fiche est ouverte.
- [ ] **Ctrl+Alt+F** : choisir une image → copiée, référence insérée, article enregistré,
  fiche ouverte dessus. Hors article (BIENVENUE.md) : insertion seule, pas de fiche.
- [ ] **Éditeur de tableau (D107)** : les quatre champs ; Ctrl+Z / Ctrl+Y les couvrent sans
  re-rendu de la grille ; **rouvrir et réenregistrer un tableau sans y toucher doit laisser
  `git diff` vide**.
- [ ] **Tout rejouer en allemand** ; traductions DE de la fiche à relire (premier jet).
- [ ] **Pistes non faites, à arbitrer** : entrée « Ouvrir l'image » dans le menu contextuel de
  l'arbre ; report des crédits vers l'export OJS ; alerte de relecture listant les figures
  sans légende **ni** texte alternatif avant livraison.

## Validations qui demandent un humain — numérotation figures/tableaux (D104)

- [ ] **Arbitrage du séparateur** : l'`alt` dit « Figure 5 — Légende » (cadratin), là où la
  demande initiale disait « Figure 5 - Légende » (trait d'union). Le cadratin est gardé
  parce que l'`alt` doit être *identique au caractère près* au texte de la légende pour que
  pandoc pose `aria-hidden` dessus — sinon le lecteur d'écran lit deux fois la même phrase.
  Trancher : garder le cadratin (recommandé) ou changer la constante `CADRATIN` de
  `pipeline/filters/szh-numerotation.lua` en acceptant la double annonce.
- [ ] **Image sans légende et PDF/UA-1** : WeasyPrint 69 ne distingue pas `alt=""` d'un `alt`
  absent et écrit `ERROR: Image … has no required alt description` (le PDF sort quand même,
  code 0, aucun repli). Décider : exiger une légende à l'import (avertissement du cockpit sur
  toute image non légendée) ou attendre une version de WeasyPrint qui le distingue.
- [ ] **Libellés `it`/`en`** de `szh-numerotation.lua` (`Figura`/`Tabella`, `Figure`/`Table`) :
  premier jet à valider comme le reste du catalogue.
- [ ] **Revue avec un `styles/print.css` local** : un override antérieur contient encore les
  compteurs CSS retirés → **double numérotation**. Aucune revue du dépôt n'est concernée ;
  à vérifier au déploiement sur les revues réelles.
- [ ] **Juger le rendu** sur un article réel : numéros de figures et de tableaux qui se suivent
  indépendamment, en FR et en DE, dans le PDF **et** dans l'aperçu HTML.

## Validations qui demandent un humain — lot ordre/métadonnées/assets (D99–D103)

- [ ] **Ordre des articles (D99)** : déposer `4_Titre.docx` et `10_Titre.docx`, importer →
  slugs `04-…` et `10-…`, articles rangés dans l'ordre du numéro. Réimporter le même
  fichier → badge « déjà converti » (preuve que cockpit et Makefile calculent le même
  slug). ⚠ `4_X.docx` et `04_X.docx` donnent le même slug : le second est ignoré.
- [ ] **Métadonnées d'un article (D100)** : au survol, l'icône ✎ est **à gauche** de la
  poubelle ; clic → panneau « Métadonnées — <slug> », une seule carte + bandeau « Voir
  tous les articles ». Enchaîner tous → un → un autre → tous, **avec une carte modifiée
  (●)** à chaque fois : la modale Enregistrer / Quitter sans enregistrer / Annuler doit
  apparaître, « Annuler » laisser les saisies, « Enregistrer » n'écrire que l'article
  affiché. Puis Ctrl+Alt+S → « Métadonnées de l'article courant » depuis un article,
  depuis un `.md` hors article (message sobre), depuis un onglet non-`.md`.
- [ ] **Repli des assets (D101)** : cliquer A puis B → les assets de B s'ouvrent, ceux de
  A se referment ; un article sans asset n'a pas de chevron. **Juger si la sélection dans
  l'arbre reste correcte** (le nœud est recréé à chaque bascule). Puis Réglages SZH →
  « Cacher automatiquement… » = Non → plus aucun pliage automatique ; remettre Oui.
- [ ] **Insérer un tableau (D102)** : Ctrl+Alt+T dans un article → fichier `table-NN.html`
  créé, référence insérée, article enregistré, éditeur ouvert sur la grille 3 × 3 ;
  « Retour à l'article » → le tableau est dans l'aperçu. Puis Ctrl+Alt+T dans
  `BIENVENUE.md` → squelette Markdown + message.
- [ ] **Légende de tableau (D103)** : saisir une légende → ● → Ctrl+S → `<caption>` dans le
  fichier ; Ctrl+Z / Ctrl+Y sur la légende ; vider la légende → le `<caption>` disparaît ;
  ouvrir un tableau importé dont le Word avait une légende → le champ la montre et le
  fichier n'est **pas** modifié si on n'y touche pas. ⚠ Retoucher une légende importée
  avec du gras/italique la remet à plat (champ texte simple) — **à arbitrer** : faut-il
  préserver la mise en forme des légendes Word à l'édition ?
- [ ] **Tout rejouer en allemand** (`szh.langue = de`) : nouveaux libellés (bandeau de
  filtre, réglage, légende, messages Ctrl+Alt+T) et titre `%cmd.metadonneesArticle%`.

## Validations qui demandent un humain — correctifs C1–C3 (2026-08-19)

- [ ] **C1 — compilation après import** : importer un ou deux `.docx` → la compilation
  s'enchaîne toute seule (statut « Compilation des articles importés… ») AVANT le
  dialogue de vérification ; ensuite, le premier clic sur un article importé montre
  l'aperçu sans attente. Vérifier sur un import de plusieurs fichiers que la durée
  reste acceptable (sinon : à passer en tâche de fond).
- [ ] **C2 — aperçu pas encore prêt** : cliquer un article dont `out/` a été effacé →
  l'aperçu s'ouvre avec « pas encore compilé » **+ « Compilation en cours, merci de
  patienter quelques secondes… »**, la compilation part, et le rendu remplace le
  message tout seul. Rejouer en mode PDF (message d'erreur + même phrase, puis le PDF
  s'ouvre), et pendant qu'une autre compilation tourne déjà (message d'attente au lieu
  de l'abandon silencieux d'avant).
- [ ] **C3 — poubelle images/tableaux** : au survol d'une image et d'un tableau, la 🗑
  demande confirmation, supprime le fichier **et** retire l'insertion du texte
  (`![…](media/…)` / bloc `::: {.szh-tabelle …}`). Vérifier : le compte annoncé dans la
  barre d'état, le texte enregistré et recompilé, Ctrl+Z qui restaure le texte, un
  tableau ouvert dans l'éditeur qui se ferme, une image ouverte en aperçu dont l'onglet
  se ferme, et le cas « aucune insertion trouvée » (fichier orphelin) qui supprime quand
  même sans rien casser.

## Validations qui demandent un humain — lot F1/F5/F8 + portraits + export OJS (D88–D93)

- [ ] **Barre épurée (D88)** : ouvrir une revue → la vue « Revue SZH » ne montre que 3 boutons
  (🚀 ✏ ⬆), tooltips FR ; en VSCodium DE, tooltips DE. Ctrl+Maj+P → « Rafraîchir la barre
  Revue » fonctionne toujours (bouton retiré, commande conservée).
- [ ] **Panneau Commande** (`Ctrl+Alt+A` et clic) : les 5 entrées ouvrent bien importer /
  convertir / méta-données numéro / métadonnées articles / réglages.
- [ ] **Panneau Édition** (`Ctrl+Alt+S`) : depuis un `.md`, chaque action s'applique à la
  sélection ; depuis un non-`.md`, une action de mise en forme → message « Ouvrez un
  article… », mais « Basculer l'aperçu » fonctionne. Vérifier aussi `Ctrl+Alt+S` dans un
  `.md` **hors** revue. Le clic droit → « Mise en forme » reste la palette pure, inchangée.
- [ ] **Panneau Export** (`Ctrl+Alt+D`) : « Recompiler toute la revue » lance le rebuild ;
  l'entrée « Exporter en XML (OJS) » doit être **présente** (la commande est livrée).
- [ ] **F5 pleine page (D89)** : article ouvert avec aperçu PDF à droite → « Méta-données du
  numéro » : l'onglet PDF se ferme. Idem en mode HTML, idem via un aperçu ouvert par
  szh-apercu (Ctrl+S). Rejouer avec « Métadonnées des articles » déjà ouvert en arrière-plan
  (le reveal doit fermer les aperçus d'abord). Éditeur de tableau : ouverture = tout se ferme ;
  « Voir le tableau dans l'aperçu » rouvre et scrolle ; « Cacher l'aperçu » referme.
- [ ] **F8 (D90)** : Réglages SZH → radio « Aperçu par défaut » reflète l'état courant ;
  passer sur PDF → barre d'état « Aperçu : PDF » immédiate, prochain clic d'article ouvre le
  PDF ; `Ctrl+Alt+P` bascule ; radio resynchronisée à la réouverture des réglages.
- [ ] **Raccourcis `Ctrl+Alt+A/S/D/P`** sur clavier suisse FR et DE (collision AltGr à
  confirmer physiquement).
- [ ] **Portraits (D91) — vraies photos** : le test automatique n'a couvert qu'un visage
  synthétique. À valider sur de vraies photos : visages non frontaux, lunettes, groupes,
  contre-jour, photo très serrée (padding), photo sans visage (fallback). Vérifier le rendu
  N&B 400×400 des deux versions.
- [ ] **Bloc auteurs (D92)** : jugement visuel sur un article réel (taille de la pastille
  ORCID, wording du titre) ; les libellés DE/IT du bloc sont un PREMIER JET à relire.
- [ ] **Taille du rootfs (D91)** : venv portraits ≈ 735 Mo + modèle 168 Mo (weasyprint : 80 Mo).
  Accepter, ou épingler un rembg plus ancien sans scikit-image/numba (re-freeze à faire).
  Premier build CI du Containerfile = la preuve finale (pas de podman local pour l'essai).
- [ ] **Export OJS (D93)** : import d'essai du XML généré dans un OJS de test (ou le vrai,
  numéro dépublié) — rubriques rattachées, galleys téléchargeables, résumés/mots-clés, et ce
  qu'OJS fait **sans email d'auteur**. ⚠ `genre`/`uploader`/`user_group_ref` sont rattachés
  par NOM (constantes en tête d'export-ojs.js) : valables pour le journal FR observé, à
  vérifier pour la Zeitschrift (DE). Un XML de production fera 30-50 Mo : la limite d'upload
  PHP peut imposer l'import CLI d'OJS.
- [ ] **DOCX régénérés (D93)** : ouvrir un `out/<slug>/<slug>.docx` dans Word — tableaux
  fusionnés, images, bibliographie. ⚠ Les SVG de la maquette sont perdus (« rsvg-convert is
  not in path ») : ajouter `librsvg2-bin` au rootfs si ça se voit.
- [ ] **Drop de .docx (D94)** : tirer depuis l'Explorateur Windows sur la vue « Revue SZH » —
  1 fichier, plusieurs, conflit (→ modale Remplacer/Ignorer), mélange avec des non-docx
  (→ message « seuls les .docx… »), drop de texte (→ rien). Confirmer que le `text/uri-list`
  externe marche sur le VSCodium déployé (API ≥ 1.66).
- [ ] **Modale photo (D95) — bout-en-bout sur un poste à jour** (rootfs avec `/opt/portraits`
  ET toolkit avec `portraits.py`) : dépôt → 3 versions → Valider → Enregistrer → `photo:`
  dans le meta.yaml → bloc « À propos » visible dans le PDF. Réouverture = radio
  présélectionnée ; redépôt .jpg après .png ; photo « trop serrée » (note padding) ; image
  sans visage (note + recadrage centré). Icônes poubelle/photo et damier de transparence
  lisibles en thème clair ET sombre ; console webview sans erreur CSP.
- [ ] **Sans WSL / distro absente (D95)** : la modale affiche une erreur propre, pas de
  blocage ni de « Chargement… » figé.
- [ ] **E-mail d'auteur → export OJS** : saisir un email dans le formulaire, exporter le XML,
  vérifier `<email>` dans le bloc auteur.
- [ ] **Dialogue de vérification d'import (F6)** : importer un vrai .docx → le panneau
  s'ouvre seul (plus de simple notification) ; badges « détecté / à compléter » conformes au
  meta.yaml, compteur recalculé à la saisie et au « + Italien » ; Enregistrer → fiche
  réécrite (clés inconnues préservées) ; modale photo de bout en bout depuis le dialogue ;
  remplacement d'image par drop ET par bouton (confirmation, nom conservé, description
  rafraîchie, > 50 Mo refusé, refus pendant build/import) ; Fermer avec modifications →
  modale ; deuxième conversion panneau ouvert → reveal + recharge (les saisies non
  enregistrées de la vague précédente sont perdues — même logique que le formulaire) ;
  0 nouveau → notification classique ; tout rejouer en DE ; console webview sans
  violation CSP. ⚠ La croix de l'onglet ne passe pas par la garde « non enregistré »
  (limite API webview, comme l'éditeur de tableau).
- [ ] **Convertisseur (D96/D97) — relecture humaine d'un échantillon** : compiler et relire
  1 article FR + 1 DE + 1 éditorial + 1 « Actualité et ressources » convertis depuis
  tmp/docx-dev (le tableau complet des 64 est dans `tmp/rapport-calibration-f6.md`) :
  corps sans perte, titres aux bons niveaux, résumés/mots-clés dans la bonne langue,
  bibliographie rendue par citeproc sous son titre. Points connus à repérer : 2 cas
  prénom/nom inversés dans la source, seconds prénoms rangés dans `nom`,
  fonction/affiliation parfois fusionnées — se corrigent au formulaire.
- [ ] **Citations (D97)** : décider si la liaison des citations (`szh-citations`, 72,6 %
  auto) devient une action supervisée du cockpit — NE PAS l'activer à l'import.
- [ ] **Charts/SmartArt Word** : 4 légendes orphelines dans le corpus (pandoc ne convertit
  pas ces objets) — fournir les images via le dialogue d'import (zone « originaux »).
- [ ] **Types `interview`** : non détectables automatiquement — requalifier à la main dans
  le formulaire après import.

## Validations qui demandent un humain (lots précédents)

- [ ] **Scénarios GUI du lot M** : redémarrer VSCodium, puis vérifier l'aperçu HTML cliquable,
  le formulaire de métadonnées d'article, le menu de réglages, la bascule de langue.
- [ ] **Double-clic sur un `.md`** (P6) : clic droit → Ouvrir avec → **« Revue SZH »** (pas
  « VSCodium » !) → cocher « Toujours ». Vérifier que la revue s'ouvre complète et que
  l'aperçu apparaît tout seul. Deux points à regarder de près :
  - le **libellé affiché** dans la boîte « Ouvrir avec » (il dépend de `FriendlyAppName` ;
    non vérifiable sans écrire dans le vrai registre) ;
  - le comportement quand **une autre revue est déjà ouverte** (nouvelle fenêtre ou réutilisation).
- [ ] **Collage de tableau** (`Ctrl+Alt+V`, D81 — le raccourci a CHANGÉ) : copier dans
  Excel **puis** dans Word, coller dans un article. Attendu : un fichier
  `articles/<slug>/tables/table-NN.html` créé, sa référence insérée au curseur, le tableau
  visible aussitôt sous l'article dans la barre « Revue SZH », et « Éditer le tableau »
  l'ouvre correctement. Points à regarder :
  - **les cellules fusionnées** doivent survivre (c'était le défaut de l'ancienne version) ;
  - depuis **Excel**, le tableau arrive **sans gras ni ligne d'en-tête** : Excel met ces
    informations dans des classes CSS, jamais dans des balises. Ça se règle d'un clic dans
    l'éditeur. Depuis **Word**, gras, italique et en-tête sont conservés ;
  - le **délai** : la lecture du presse-papiers passe par un `powershell` court, soit
    environ une demi-seconde à une seconde avant l'insertion. À dire si c'est gênant ;
  - que `Ctrl+Alt+V` ne soit pas déjà pris par une des extensions installées.
- [ ] **Entrée « Ouvrir avec »** (D18, corrigé) : elle doit s'appeler **« Revue SZH »** et
  non plus « Microsoft ® Windows Based Script Host », avec l'icône SZH (tuile bleu nuit
  barrée de rouge) — reconnaissable au premier coup d'œil face à l'entrée « VSCodium »
  juste à côté. Et dans l'Explorateur, la colonne Type doit dire « Article de revue SZH ».
- [ ] **Clic sur un tableau** (D84) : dans la barre latérale, cliquer un tableau doit ouvrir
  l'**éditeur de tableau** (la grille), pas le fichier HTML. Le bouton « Éditer » du survol a
  disparu — seul « Remplacer » reste. À vérifier aussi que rouvrir un tableau déjà ouvert le
  ramène au premier plan au lieu d'en ouvrir un second.
- [ ] **Aplats de tableau plus pâles et plus sombres** (D87) : les fonds « couleur » et
  « négatif » des tableaux ont changé pour tenir le seuil de lisibilité à la taille réelle
  du texte de tableau (13,6 px). À juger à l'œil sur un tableau réel : `-clair` passe du
  cran 200 au 100, `-fonce` du 700 au 800. Pour un numéro **rouge**, le fond négatif n'est
  plus le rouge de charte mais `#9F001F`.
- [ ] **Deux jetons de maquette à arbitrer** (D87, laissés en attente parce qu'ils touchent
  la couverture) :
  - `--c-kw-bg` : les puces de mots-clés sont à **10 px**, plus petit que tout ce que les
    quatre niveaux couvrent. Rouge 82, capucine 90 — sous le seuil. Soit on grossit la puce
    dans `print.css`, soit on éclaircit le mélange dans `accent-css.py`. Mon avis : à 10 px,
    éclaircir ne suffira jamais vraiment ; c'est la taille qu'il faut revoir.
  - `--c-annual-text` : **aucune règle ne le consomme**. Il est déclaré et émis, rien ne
    l'applique. Soit une règle l'utilise et il faut le porter à 90, soit c'est du code mort
    à supprimer.
- [ ] **Saut de page** (`Ctrl+Alt+Entrée`, D86) : vérifier sur un article réel que la page
  se coupe où voulu dans le PDF, et que l'aperçu HTML reste inchangé. Le comportement est
  prouvé par un build (1 page → 2 pages), mais le geste et le placement du marqueur dans
  le texte n'ont pas été essayés en vrai.
- [ ] **Choisir 4 préréglages de tableau parmi les 8** (D85) : ouvrir un tableau, cliquer
  chaque préréglage et juger au rendu. Les huit sont des propositions — académique, en-tête
  foncé, en-tête couleur, en-tête gris, lignes alternées, colonnes alternées, synthèse,
  matrice. Pour n'en garder que quatre : supprimer les entrées inutiles de `PRESETS_TABLE`
  et `PRESETS_ORDRE` (`lib/table-model.js`) **et** leurs libellés `table.preset.<clé>` dans
  `lib/i18n.js` (fr **et** de). Rien d'autre.
- [ ] **Éditeur de tableau : la place** (D85) : vérifier que l'aperçu de l'article se ferme
  bien à l'ouverture, que « Voir le tableau dans l'aperçu » le rouvre **et** amène la vue
  sur le tableau (au pire il rouvre sans scroller : le tableau inclus n'a pas de position
  source), et que les deux colonnes de réglages tiennent sans défilement.
- [ ] **Aperçu HTML : le survol prend le bloc** (D82) : survoler un mot au milieu d'une
  phrase doit surligner **tout le paragraphe**, pas le mot ni le passage en gras.
- [ ] **Planche de palette** — `docs/palette.html` (ou le lien partagé) : juger **à l'œil**.
  La palette est une **grille à clarté fixe de 11 crans** (D79) : un même numéro = la même
  clarté pour les six couleurs. La couleur de charte **occupe** l'un de ces crans (D80) —
  rouge 700, capucine/poireau/bleu acier/mountbatten 500, moutarde 300 — badgé « charte ».
  À regarder en particulier :
  - le **fond « négatif » des tableaux d'un numéro rouge** est désormais *le* rouge de charte
    `#D31932` au lieu du `#C3112C` assombri : plus vif, texte blanc à Lc 79,7 ;
  - les crans clairs du **rouge** et de la **capucine** tirent au rose (sRGB n'a pas de rouge
    clair vif : la chroma y est rabotée jusqu'à −49 %), et les crans sombres de la **moutarde**
    sont olive plutôt que jaunes — même cause, en sens inverse ;
  - le **cran 400** ne porte aucun texte : c'est le croisement où ni le noir ni le blanc ne
    passent. Vérifier que sa présentation ne prête pas à confusion.
  Si un fond te paraît trop franc, fais pointer l'alias `--c-<nom>-clair` vers `-100` au lieu
  de `-200` dans `couleurs.css`, puis relance `python3 test/apca-check.py` **et**
  `python3 test/palette-html.py`.
- [ ] **Aperçu de l'éditeur de tableau** : il ne recalcule plus les teintes, il lit celles que
  le pipeline écrit dans `out/.szh-accent.css`. Donc à vérifier sur un tableau réel, dans un
  numéro **coloré** : les fonds « couleur » et « négatif » de l'éditeur doivent être
  **identiques** à ceux du PDF. C'est le seul moyen de confirmer que la dérive WCAG/APCA est
  bien éteinte. Repli documenté : un numéro jamais compilé montre les gris neutres.
- [ ] **Rendu du `.pptx`** (`profil: presentation`) : validé structurellement (OOXML, texte
  complet), jamais ouvert dans PowerPoint. À voir à l'œil sur un article réel. ⚠ Limite
  mesurée : les tableaux de D47 (HTML réinjecté) **disparaissent** du diaporama.
- [ ] **Libellés DE/IT des 6 types d'article** (D71) : à confronter aux **noms de rubriques
  réellement imprimés**. Cas à regarder : `tribune-libre` → « Freie Tribüne » / « Tribuna
  libera », et les deux en-têtes de groupe. ⚠ **Deux** tables à modifier ensemble :
  `LIBELLES_TYPES` (extension) et `LIBELLES` de `pipeline/filters/szh-maquette.lua`.
- [ ] **Relecture germanophone** — classeur prêt : `C:\Users\robin\Documents\SZH-traductions-a-relire.xlsx`
  (230 textes du cockpit + 29 menus + les types d'articles). L'audit mécanique est propre :
  0 `ß`, 0 placeholder divergent, parité FR/DE totale. ⚠ Ce classeur ne couvre **pas** les
  textes des scripts PowerShell (`szh-common.ps1`, dont les 4 nouveaux `openmd.*`) — ils sont
  aussi un premier jet.

## Reste technique

- [ ] **Bordures épaisses de la maquette en moutarde** : `--c-abstract-border` (3 px),
  `.szh-filet` (6 px) et les bords d'encadré gardent la couleur de marque brute, à Lc **30,1**
  — pile sur le plancher. Les filets de tableau, eux, sont passés au jeton `--c-annual-ui`
  (Lc 45). Si tu veux de la marge partout, c'est le même changement à faire sur ces trois
  règles ; c'est un choix esthétique, je ne l'ai pas pris.
- [ ] **Masquer la bascule d'aperçu** sur un dossier `profil: presentation` : le mode HTML est
  forcé (il n'y a pas de PDF), mais le bouton reste cliquable et semble ne rien faire.
  Repoussé volontairement : cela demande un nouveau texte traduit, à joindre au prochain lot.
- [ ] **Commande « Ouvrir le diaporama »** : rien n'ouvre un `.pptx` depuis le cockpit.
- [ ] **`profil:` dans le formulaire du numéro** : aujourd'hui à écrire à la main dans
  `ausgabe.yaml` (une ligne posée à la main survit au formulaire, c'est vérifié). Piège si un
  sélecteur est ajouté : le sérialiseur saute les valeurs vides, donc le choix « aucun
  document » (clé présente et vide) n'est pas exprimable en l'état.
- [ ] **`--slide-level`** : au défaut de pandoc, un article réel donne 5 diapositives ; en
  `--slide-level=2`, 16, sans perte de texte. Le levier est commenté à l'endroit exact du
  Makefile. Arbitrage d'usage à prendre.
- [ ] **Option XML DISM** au bootstrap (associations des nouveaux profils, D18) : non faite.
- [ ] **Extension résiduelle** : `csholmq.excel-to-markdown-table@1.4.0` est encore installée
  sur ce poste, plus sur les nouveaux. `codium --uninstall-extension csholmq.excel-to-markdown-table`.
- [ ] **Poste pilote** : checklist V1–V8 du §5 sur une machine vierge (celle-ci ne l'est plus).
- [ ] **D7** : retirer `fonts-noto` du rootfs. D73 a déjà rendu la maquette indépendante des
  polices du rootfs ; il ne reste que le gain de taille (plusieurs centaines de Mo).

## Fait le 2026-08-13

- **Release v2026.08.7** : cockpit 0.2.0, pack de langue DE, pipeline complet livré.
- **Poste installé** par `bootstrap.ps1` (toolkit, tâches planifiées, `.wslconfig`, extensions).
- **Décisions D37–D74 transcrites** dans `PLANIFICATION.md` (la dette allait plus loin que prévu),
  **D75** retrait de `csholmq`, **D76** palette APCA, **D77** lanceur bête, **D78** dispatch `profil:`.
- **Palette APCA** (D76) : module `pipeline/apca.py`, vérificateur `test/apca-check.py`
  (157 paires, 0 échec), planche générée `docs/palette.html`. Trois vraies fautes corrigées :
  texte annuel moutarde sous le seuil, son filet fin écrasé en quasi-noir, filet de tableau
  moutarde invisible sur fond zébré. L'éditeur de tableau ne recalcule plus les teintes.
- **Grille à clarté fixe de 11 crans** (D79, release v2026.08.9) : dispersion de clarté ramenée
  de 0,266 à 0,002 par cran. Puis la **charte intégrée dans la grille** (D80, v2026.08.10) :
  elle occupe le cran le plus proche de son Lc, calculé et non codé en dur.
- **Planche** enrichie : cran 400 présenté comme les autres, badge « charte » au-dessus de la
  case, liseré doublé, échantillons « Texte » (14 px) / « Titre » (19 px gras) à la taille que
  le seuil autorise, et verdict d'usage en **élément d'interface** par cran.
- **P6** : `open-md.ps1`, association `.md` en HKCU, dispatch `profil:` (6 routes vérifiées en
  build réel), aperçu ouvert au démarrage par le cockpit, `userdoc.md` réécrit.

# Todo Features

*(le lot palette est fait — voir « Planche de palette » ci-dessus pour la seule chose qui
reste : la juger à l'œil)*
