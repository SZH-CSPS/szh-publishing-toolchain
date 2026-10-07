# SZH — Revue (cockpit)

L'extension VSCodium de Pronto. Elle ajoute la vue « Pronto » dans l'explorateur quand le
dossier ouvert est un numéro (`ausgabe.yaml`) ou un livre (`buch.yaml`), et donne accès à
tout le travail de la rédaction : import Word, compilation et aperçu, métadonnées, médias,
tableaux, traductions, contrôles, exports, verrouillage et archivage du numéro. Sans dossier
ouvert ni onglet, elle affiche l'Accueil.

Trois panneaux de commandes s'ouvrent depuis la barre de la vue : Commande (`Ctrl+Alt+A`),
Édition (`Ctrl+Alt+S`) et Export (`Ctrl+Alt+D`). Les raccourcis sont posés par
[`vscodium-user/keybindings.json`](../../vscodium-user/keybindings.json).

La CI ([`release.yml`](../../.github/workflows/release.yml)) construit le `.vsix` et
`windows/update.ps1` l'installe sur les postes. Pour essayer une version en cours sur le
poste de développement, voir « L'instance de développement » dans
[`docs/DEVELOPPEMENT.md`](../../docs/DEVELOPPEMENT.md).

Les patrons du code (un module hôte par zone, `configurer()`, `panneauUnique`, table `MSG`)
sont décrits dans [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md). Il n'y a pas d'étape
de construction : du CommonJS chargé tel quel, et des fichiers statiques.

## Modules

Un module « hôte » (`*-hote.js`) tient une zone de l'interface et reçoit ses rappels par
`configurer()`. « Pur » veut dire sans `vscode` ni accès disque.

`extension.js` active l'extension, appelle les `configurer()`, tient l'arbre latéral
(`FournisseurRevue`) et compile une unité. Il ne crée aucun panneau.

### Interface

| Module | Rôle |
|---|---|
| `lib/accueil-hote.js` | l'Accueil : panneau, données, ouverture et création d'un numéro |
| `lib/accueil-page.js` | ce que l'Accueil envoie à sa page : libellés, produits, produit ouvert d'office |
| `lib/accueil-nouveau.js` | créer un numéro ou un livre par `new-revue.ps1` ou `new-livre.ps1` |
| `lib/accueil-journal-hote.js` | onglet Log : journaux de mise à jour et signalement au support |
| `lib/accueil-preproc-hote.js` | onglet Préprocessing : le nettoyeur de manuscrit, lancé dans la WSL |
| `lib/accueil-reglages-hote.js` | onglet Paramètres : produit proposé, mise à jour silencieuse, mode développeur, services en ligne |
| `lib/accueil-secretariat-hote.js` | onglet Secrétariat : les quatre exports et leur historique |
| `lib/bienvenue-hote.js` | invitation au tutoriel, puis « Quoi de neuf » après une mise à jour |
| `lib/apercu.js` | aperçu HTML ou PDF en colonne 2, défilement synchronisé avec l'éditeur |
| `lib/vue-articles-hote.js` | vue « Articles » (ou « Chapitres ») : cartes, ordre, envoi à l'auteur, PDF |
| `lib/vue-ensemble-hote.js` | vues d'ensemble des sections (traductions, Word, contrôles) |
| `lib/controles-hote.js` | constats de compilation, vue « À corriger », badge PDF/UA de la barre d'état |
| `lib/pdfua-hote.js` | validation PDF/UA en arrière-plan après chaque compilation, cache `.szh-pdfua.json` |
| `lib/pagination-hote.js` | pagination continue du numéro (`make etat-pagination`, `rafraichir-pagination`) |
| `lib/import-hote.js` | import des `.docx` et `.odt` en attente, puis compilation |
| `lib/import-verif-hote.js` | dialogue « Vérification de l'import » après une conversion |
| `lib/metadonnees-hote.js` | formulaires du numéro (`ausgabe.yaml`), du livre (`buch.yaml`) et des fiches d'articles |
| `lib/medias-hote.js` | médias d'un article : images, grilles, portraits |
| `lib/table-hote.js` | éditeur de tableau d'un article |
| `lib/documentation-hote.js` | Documentation d'un numéro : rubriques et fiches |
| `lib/traduction-hote.js` | envoi pour traduction, panneau des traductions, mode « Trad », suggestions |
| `lib/reglages-hote.js` | réglages SZH, réglages protégés, fichier de langue |
| `lib/moisson-hote.js` | « Moisson mensuelle » et « Données FNS » dans Paramètres |
| `lib/resumes-hote.js` | « Raccourcir les résumés » dans Paramètres : clé Mistral, modèle, passe |
| `lib/coedition-hote.js` | baux de co-édition tenus par les panneaux du poste |
| `lib/uri-hote.js` | liens `vscodium://szh-csps.szh-cockpit/…` reçus par l'éditeur |
| `lib/panneaux.js` | les trois panneaux Commande, Édition, Export (QuickPick) |
| `lib/formatting.js` | commandes de mise en forme `szh.fmt.*`, presse-papiers HTML |
| `lib/interaction.js` | retient ce qui volerait le focus tant qu'un QuickPick est ouvert |
| `lib/webviews/panneau.js` | `panneauUnique()` : un panneau par clé, mode Trad, poignée `PRET` |
| `lib/webviews/util.js` | assemble le HTML d'une webview (libellés, nonce, CSP) depuis `media/` |

### Données et règles (pur)

| Module | Rôle |
|---|---|
| `lib/profil.js` | revue ou livre, chemins, capacités (`szh.peut.*`) |
| `lib/articles.js` | ordre des articles, nom affiché, tâches éditoriales |
| `lib/yaml.js` | lecture et écriture des YAML du numéro et des fiches, écriture atomique |
| `lib/slug.js` | slug d'article et de portrait, identique à celui du Makefile |
| `lib/i18n.js` | libellés fr et de, `T()` et `TP()` (variante `clé.livre`) |
| `lib/index-textes.js` | retrouve la clé i18n d'un texte affiché, pour le mode « Trad » |
| `lib/export-langue.js` | exporte tous les libellés fr et de pour relecture |
| `lib/messages.js` | table `MSG` des messages hôte ↔ webview (copie : `media/_messages.js`) |
| `lib/constats.js` | sévérité, destination et formulation d'un constat |
| `lib/codes-erreur.js` | codes d'erreur et schéma des rapports automatiques |
| `lib/journal.js` | lit le journal de compilation et en tire les constats |
| `lib/reperage-focus.js` | retrouve dans le `.md` le passage désigné par un constat |
| `lib/formatting-pur.js` | transformations de texte et blocs `:::` de la mise en forme |
| `lib/references.js` | références d'images et de tableaux dans le texte, grilles d'images |
| `lib/table-model.js` | modèle des tableaux : analyse, sérialisation, opérations |
| `lib/qualite-image.js` | seuils de résolution et verdict de qualité d'une image |
| `lib/medias.js` | dimensions d'image, noms sûrs, portraits en `data:`, doublons |
| `lib/citations.js` | liage manuel d'un appel de citation à une référence |
| `lib/traduction.js` | suivi des traductions (`<slug>.traduction.yaml`) |
| `lib/renumerotation.js` | plan de renommage des dossiers d'articles selon leur rang |
| `lib/kirby-contenu.js` | lecture et écriture de la Documentation au format Kirby |
| `lib/propositions.js` | propositions des moissonneurs : lecture, décisions, acceptation |
| `lib/moisson.js` | état de la moisson mensuelle, lu dans `_Moissons` |
| `lib/inventaire.js` | numéros en cours et archivés de chaque produit (jumeau PowerShell testé) |
| `lib/journaux-maj.js` | les dix derniers journaux de mise à jour et leur verdict |
| `lib/autre-revue.js` | articles de l'autre revue, pour une fiche « D'une revue à l'autre » |
| `lib/cantons.js` | les 26 cantons et la Confédération, triés par langue (sans appelant) |
| `lib/ojs-adresses.js` | adresses d'ojs.szh.ch et chemins fixés par l'export OJS |
| `lib/gabarits.js` | le moteur de gabarits (sous-ensemble de Twig), seul du produit |
| `lib/verif-meta.js` | feuille « Vérifier les méta (print) », une page A4 par article |
| `lib/session.js` | état de session partagé entre les zones, par accesseurs |
| `lib/nouveautes.js` | « Quoi de neuf » : notes par version medium, ce qu'il faut montrer |

### Disque, réseau et poste

| Module | Rôle |
|---|---|
| `lib/poste.js` | chemins du poste ; seul module à lire `LOCALAPPDATA`, `USERPROFILE`, `APPDATA`, `WINDIR` |
| `lib/moteur.js` | lance les commandes dans la WSL ; seul accès à `wsl.exe`, avec `lib/wsl.js` |
| `lib/wsl.js` | localise `wsl.exe` et garde la VM éveillée |
| `lib/services-env.js` | adresse Shlink et clés transmises à la WSL (`WSLENV`) |
| `lib/date-apercu.js` | aperçu de la date imprimée d'une fiche, par `szh-commun.lua` dans la WSL |
| `lib/portraits.js` | détourage des portraits par `pipeline/portraits.py` dans la WSL |
| `lib/cmyk.js` | détecte les JPEG CMJN et les convertit dans la WSL |
| `lib/archivage.js` | archivage par `windows/archive-revue.ps1`, `config.json`, version installée |
| `lib/cycle-vie.js` | verrouillage, archivage, désarchivage, copies en conflit à résoudre |
| `lib/verrou.js` | numéro gelé : tout le dossier en lecture seule |
| `lib/coedition.js` | bail de deux minutes sur un fichier modifié par un formulaire |
| `lib/copies-conflit.js` | détecte les copies en conflit de OneDrive et applique les choix bloc par bloc |
| `lib/supprimer.js` | supprime un dossier sur OneDrive (attribut lecture seule, reprises) |
| `lib/renumerotation-fs.js` | exécute le plan de renumérotation, l'ordre du numéro écrit en dernier |
| `lib/relance-compilation.js` | recompile un article enregistré par un formulaire (attente de 2,5 s) |
| `lib/table-images.js` | images des cellules de tableau : aperçu et copie dans `media/` |
| `lib/reglages-flotte.js` | réglages de l'éditeur imposés à tous les postes |
| `lib/reglages-proteges.js` | réglages de la chaîne (export OJS, bibliographie, tâches), déployés par la mise à jour |
| `lib/liens.js` | liens `szh://` et intention déposée par le lanceur |
| `lib/ouvrir-systeme.js` | ouvre un fichier avec l'application du système (chemins accentués compris) |
| `lib/courriel.js` | courriels rendus depuis `mail-templates/` |
| `lib/export-ojs.js` | export XML natif OJS du numéro |
| `lib/secretariat.js` | les quatre exports du secrétariat (newsletter, Edudoc, caractères, métadonnées) |
| `lib/oai-pmh.js` | client OAI-PMH commun ; `SZH_RESEAU_INTERDIT` bloque le réseau en test |
| `lib/auteurs-ojs.js` | auteurs publiés, moissonnés sur ojs.szh.ch, pour l'autocomplétion |
| `lib/auteurs-corpus.js` | fonction et courriel des auteurs, lus dans les `meta.yaml` du poste |
| `lib/mots-cles-edudoc.js` | descripteurs bilingues d'edudoc.ch, pour l'autocomplétion et l'export Edudoc |
| `lib/mistral.js` | client de l'API Mistral |
| `lib/resumes.js` | résumés générés des propositions et leur magasin |
| `lib/compteurs.js` | compteurs d'usage, un CSV par événement dans `_Systeme\compteurs` |
| `lib/rapport-erreur.js` | écrit les rapports d'erreur automatiques |
| `lib/suggestion-traduction.js` | suggestions de traduction, un JSON par proposition dans `traduction/` |

`test/js/contrats.test.js` échoue si un fichier de `lib/` manque à cette page.

## Autres dossiers

| Dossier | Contenu |
|---|---|
| `outils/` | scripts lancés avec le Node de VSCodium (`ELECTRON_RUN_AS_NODE=1`) : `rendre-gabarit.js` (gabarits du lanceur), `secretariat-cli.js` (exports, `--langue fr\|de`), `compteurs-synthese.js` (synthèse des compteurs, `--purger` au-delà de 24 mois) |
| `media/` | pages des webviews : `<page>.{html,css,js}` par panneau, fichiers communs préfixés `_` (`_design.css`, `_commun.js`, `_messages.js`…), illustrations du tutoriel dans `tutoriel/` |
| `mail-templates/` | gabarits des courriels ([README](mail-templates/README.md)) |
| `export-templates/` | gabarits des exports du secrétariat et de la synthèse des compteurs |
| `print-templates/` | `verification-meta.twig`, la feuille de vérification des métadonnées |
| `prompts/` | `resume-descriptif.json`, les consignes envoyées à Mistral par `lib/resumes.js` |

Les gabarits sont lus dans le dossier de l'extension et ne sont pas copiés sur le poste. Leur
syntaxe est décrite dans [`mail-templates/README.md`](mail-templates/README.md). Deux règles
propres aux autres gabarits :

- dans `export-templates/`, seul `{% block contenu %}` produit le fichier ; l'en-tête `{# … #}`
  de chaque gabarit liste ses variables. Toute valeur écrite dans un CSV passe par `|csv` ;
- `print-templates/verification-meta.twig` produit du HTML : chaque valeur porte `|e`, sauf
  les clés qui finissent par `Html`, déjà échappées.

## Webviews

Une page ne reçoit aucune donnée dans son HTML : tout passe par `postMessage`. Seuls les
libellés sont posés à l'assemblage, par des marqueurs `%%SZH:clé%%`.

`.vscodeignore` ne doit pas exclure `lib/` ni `media/` : le VSIX se chargerait, puis
casserait au premier usage.

## Tests

Depuis la racine du dépôt : `node --test test/js/*.test.js`.

- `test/js/hote.test.js` active l'extension avec un faux `vscode` (`test/js/hote-factice.js`)
  et ouvre chaque panneau ;
- `test/js/webviews.test.js` rend les pages dans un DOM minimal ;
- `test/js/contrats.test.js` vérifie les valeurs recopiées d'un fichier à l'autre, dont cette
  liste de modules.
