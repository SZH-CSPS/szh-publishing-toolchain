# SZH — Revue (cockpit)

Extension interne SZH/CSPS. Ajoute une barre latérale « Pronto » qui n'apparaît que
dans un dossier de revue, repéré par la présence d'`ausgabe.yaml`. Elle y liste les
articles, les Word en attente d'import et le suivi des traductions, et donne accès à
tout le reste : import Word, compilation et aperçu, métadonnées du numéro et des
articles, éditeur de tableau, fiches d'image, portraits d'auteurs, export OJS, cycle de
vie du numéro (verrouillage et archivage).

En tête de vue, trois boutons ouvrent les panneaux Commande, Édition et Export
(`Ctrl+Alt+A`, `Ctrl+Alt+S`, `Ctrl+Alt+D`). La liste se rafraîchit d'elle-même quand des
fichiers changent.

Construite et publiée par la CI du dépôt (`release.yml`), installée sur les postes par
`update.ps1` — même canal que les extensions épinglées.

## Structure du code

Aucune étape de build : du CommonJS chargé tel quel, et des fichiers statiques.

```
extension.js            activation, câblage des modules de lib/ par leurs configurer(), arbre
                        latéral (FournisseurRevue), compiler et ouvrir une unité ; aucun
                        panneau n'y est créé (motif des modules hôtes : docs/ARCHITECTURE.md)
lib/
  accueil-hote.js       l'Accueil : son panneau, ses données, l'ouverture
                        d'un numéro (vscode.openFolder) et sa création. S'ouvre seul dans
                        une fenêtre sans dossier ni onglet
  accueil-journal-hote.js  l'onglet Log : la fin d'un journal, l'éditeur, et le signalement
                        (rapport, dossier des journaux, brouillon au support). Sans vscode
  accueil-preproc-hote.js  l'onglet Préprocessing : le nettoyeur de manuscrit dans le moteur,
                        ses étapes, son rapport HTML et ses compteurs. Sans vscode
  accueil-nouveau.js    créer un numéro ou un livre : les refus et la création du socle
                        PowerShell (new-revue.ps1, new-livre.ps1), en un processus. Sans vscode
  accueil-page.js       ce que l'hôte de l'Accueil envoie à sa page : libellés, noms des
                        produits, produit ouvert d'office (jumeau de Get-SzhOngletDefaut)
  accueil-secretariat-hote.js  l'onglet Secrétariat : les quatre exports par
                        outils/secretariat-cli.js, dans <racine>Exports<action>, et
                        l'historique Edudoc et Caractères, partagé dans _Systeme\exports.
                        Tue ses enfants avec
                        l'Accueil. Sans vscode
  apercu.js             l'aperçu commutable HTML/PDF en colonne 2 : panneau HTML (CSP,
                        bandeau), bascule avec le PDF, défilement synchronisé dans les deux
                        sens avec l'éditeur. Rappelle l'hôte par configurer(), jamais par
                        import
  archivage.js          verrouillage, archivage, appels aux scripts PowerShell du poste,
                        lecture et écriture de config.json
  articles.js           ordre des articles dans le numéro, nom affiché, tâches par article
  auteurs-corpus.js     balayage mensuel des fiches meta.yaml des numéros du poste, en
                        cours et archivés : la fonction et l'e-mail, que l'OJS public
                        n'expose pas. N'ouvre que les meta.yaml, et seulement celles
                        dont le mtime a bougé — les revues sont sur OneDrive, où lire
                        un fichier le fait télécharger
  auteurs-ojs.js        auteur·e·s publiés, moissonnés en OAI-PMH public sur ojs.szh.ch
                        (marcxml : noms et affiliations, ROR résolus par api.ror.org)
                        et cachés dans auteurs.json — l'autocomplétion de la modale
  bienvenue-hote.js     la bienvenue d'un poste : l'invitation au tutoriel, une seule fois, et
                        « Quoi de neuf » après une mise à jour. Sans rappel vers l'hôte
  cantons.js            les 26 cantons et la Confédération : la liste fermée du champ
                        « canton » d'une fiche d'intervention parlementaire — le code est
                        stocké et imprimé, le nom complet ne sert qu'à la liste déroulante
  citations.js          liste de références d'un article et liage manuel d'un appel
  cmyk.js               detection des JPEG CMJN et appel du convertisseur, dans WSL
  codes-erreur.js       table des codes d'erreur applicatifs et schéma v1 des rapports
                        automatiques (masquage, plafonds, anti-inondation) : données et
                        fonctions pures, sans vscode ni fs, dont windows/szh-rapport.ps1
                        est le jumeau PowerShell (docs/RAPPORTS-ERREUR.md)
  coedition.js          bail de deux minutes posé sur un fichier pendant qu'un formulaire le
                        modifie : deux postes sur le même numéro n'écrivent pas ensemble
                        (à ne pas confondre avec verrou.js, qui gèle le numéro entier)
  coedition-hote.js     les baux que tiennent les panneaux du poste : la main sur un fichier,
                        l'écriture sous la main, le refus d'un geste quand un autre poste
                        écrit. Sans rappel vers l'hôte : les formulaires le requièrent
  compteurs.js          compteurs d'usage du nettoyeur et de l'import (entiers et noms de mesures,
                        jamais un mot du manuscrit) : un CSV par événement dans _Systeme\compteurs,
                        file d'attente hors ligne, compteurs tirés de .szh-journal.log. S'appuie
                        sur rapport-erreur.js (docs/RAPPORTS-ERREUR.md)
  constats.js           ce qu'un défaut ferme, où on va le corriger, et comment il s'écrit :
                        la barrière (compilation, PDF/UA, export, geste) d'où la couleur se
                        déduit, les huit destinations d'où le bouton se fabrique, et le
                        gabarit « {défaut} : {objet} ». Données et fonctions pures, sans
                        vscode ni fs ; un code de journal.js sans ligne ici fait tomber
                        test/js/constats.test.js
  controles-hote.js     contrôles de la compilation : les constats rangés par source (chaîne,
                        réimport, export, pagination), la vue « À corriger », le compteur et
                        le badge PDF/UA de la barre d'état, le voile « Analyse en cours… ».
                        Rappelle l'hôte par configurer(), jamais par import
  copies-conflit.js     détection des copies en conflit déposées par OneDrive/SharePoint, et
                        application bloc par bloc des divergences que l'éditeur calcule
                        (« Prendre cette version » / « Garder la mienne »). Deux portes :
                        chercherCopies() pour le dossier d'un numéro (profond),
                        chercherCopiesPlat() pour le dossier partagé de l'outil
                        (_Systeme), plat et balayé en quelques readdir
  courriel.js           sujet et corps de « Envoyer à l'auteur » et « Envoyer pour
                        traduction », rendus depuis mail-templates/*.twig par gabarits.js
  cycle-vie.js          verrouillage, archivage, désarchivage, avertissement de version
                        divergente ; et les copies en conflit du synchroniseur jusqu'à leur
                        résolution bloc par bloc (le calcul lui-même reste dans
                        copies-conflit.js). Rappelle l'hôte par un petit objet de contexte
                        (configurer()), jamais par import
  date-apercu.js        l'aperçu de la date imprimée d'une fiche : szh-date-apercu.lua lancé
                        dans le moteur, la saisie sur stdin. Module pur, sans vscode
  documentation-hote.js la Documentation d'un numéro : fiches et rubriques, un seul
                        formulaire. Rappelle l'hôte par configurer(), jamais par import
  export-langue.js      le fichier de langue de l'interface : tous les libellés du
                        cockpit, fr et de côte à côte, pour relecture. Module pur,
                        sans disque ni vscode
  export-ojs.js         génération du XML natif OJS
  formatting.js         mise en forme markdown et commandes szh.fmt.*
  formatting-pur.js      la part de formatting.js qui ne référence pas vscode (bascules de
                        texte, pose des blocs :::, palette), réutilisable par medias.js et
                        panneaux.js
  gabarits.js           le seul moteur de gabarits, sous-ensemble de Twig sans vscode ni
                        dépendance : courriels, exports, feuille de vérification, et le
                        socle PowerShell par outils/rendre-gabarit.js
  i18n.js               textes fr/de, T(clé[, args]) et TP(clé, profil[, args]), qui
                        prend la variante « clé.livre » quand elle existe
  index-textes.js       l'index qui retrouve la clé i18n d'un texte lu à l'écran :
                        exact, motifs à trous ({0}) et clés partagées. Sert le mode
                        « Trad ». Module pur, sans disque ni vscode
  import-hote.js        import guidé : conversion des .docx en attente (bouton ou glisser-
                        déposer), écriture de l'ordre des nouveaux articles (le numéro de
                        tête du Word migre vers ordre-articles/ordre-chapitres), et la
                        compilation qui suit un import fructueux. Rappelle l'hôte par
                        configurer(), jamais par import
  import-verif-hote.js  le dialogue « Vérification de l'import » ouvert après une conversion :
                        les fiches des nouveaux articles, leurs photos, et les originaux des
                        images à remettre. Rappelle l'hôte par configurer(), jamais par import
  interaction.js        garde d'interaction : retient ce qui volerait le focus (aperçu,
                        notifications) tant qu'un QuickPick est ouvert
  inventaire.js         ce que liste l'Accueil : la racine active du poste et les numéros en
                        cours et archivés de chaque produit. Jumeau de Get-SzhBaseRevuesPour
                        et de Get-SzhEmplacementRevue, tenu par un test de parité.
                        Pur, sans vscode
  journal.js            journal de compilation -> constats de la vue « Contrôles »
  journaux-maj.js       les dix derniers journaux de mise à jour du poste, leur verdict et leur
                        fin. Jumeau de Get-SzhJournauxMaj, tenu par un test de parité. Pur,
                        sans vscode
  kirby-contenu.js      arborescence Kirby de la Documentation d’un numéro : lecture et
                        écriture de documentation.<lang>.txt et des dossiers <n>_<slug>/ de
                        ses fiches, calcul de l’ordre d’impression et du nom de dossier,
                        renommage/renumérotation sûr (deux passes par un nom temporaire, la
                        reprise après interruption est idempotente). Tout vient du contrat
                        (pipeline/kirby/champs-documentation.json), remplace ressources.js
                        et rubriques.js. Pur, sans vscode
  liens.js              liens szh:// et intention déposée par le lanceur
  medias.js             médias d'un article, sans vscode ni profil actif à connaître :
                        dimensions d'image lues dans les en-têtes, noms de fichiers sûrs,
                        versions d'un portrait en data: URI, doublons détectés par empreinte
  medias-hote.js        gestionnaire des médias d'un article : le formulaire, ses images,
                        ses grilles, les portraits de ses auteur·e·s. Rappelle l'hôte par
                        configurer(), jamais par import
  metadonnees-hote.js   formulaires de métadonnées : le numéro (ausgabe.yaml), le livre
                        (buch.yaml), les fiches de tous les articles (meta.yaml), et le
                        moteur commun de carte d'auteur·e et de photo. Rappelle l'hôte par
                        configurer(), jamais par import
  messages.js           table SZH.MSG des types de messages hôte <-> webview, données pures ;
                        la même table vit aussi dans media/_messages.js, pour la webview
  mots-cles-edudoc.js   descripteurs bilingues DE/FR des deux revues, moissonnés en OAI-PMH
                        public sur edudoc.ch (marcxml, champ MARC 690) et cachés dans
                        mots-cles.json — pas encore branché sur une autocomplétion
  moteur.js             façade du moteur de la chaîne (la distro WSL) : lancement d'une
                        commande, ligne d'une tâche, réveil et dormeur, chemins vus du
                        moteur ; seul module, avec wsl.js, à connaître wsl.exe
  nouveautes.js         « Quoi de neuf » : les notes livrées à la racine du toolkit
                        (nouveautes.json), indexées par MEDIUM de version — jamais par
                        mineure —, et la décision de ce qu'il y a à montrer. Écrites pour
                        la rédaction et dans les deux langues, à l'inverse de CHANGELOG.md
  ojs-adresses.js       la base d'ojs.szh.ch et les chemins (url_path) que l'export OJS
                        fixe pour le numéro et les articles sans DOI, d'où la newsletter
                        tire ses liens. Module pur, sans dépendance
  oai-pmh.js            client https et parseur OAI-PMH communs à auteurs-ojs.js et
                        mots-cles-edudoc.js : redirections même-hôte, réponse bornée,
                        délai total, resumptionToken, repli sur 503 — SZH_RESEAU_INTERDIT
                        y bloque tout appel réel en test, pour les deux moissonneurs
  pagination-hote.js    pagination continue du numéro (make etat-pagination /
                        rafraichir-pagination) : un constat par article périmé, et
                        aucun appel WSL tant que le numéro n'a pas été paginé une
                        première fois. Rappelle l'hôte par configurer(), jamais par
                        import
  ouvrir-systeme.js     ouvre un fichier ou un dossier avec l'application du système :
                        explorer.exe et le chemin brut sous Windows, où le file:// encodé
                        d'openExternal échoue sur un chemin accentué
  panneaux.js           les trois panneaux QuickPick
  pdfua-hote.js         validation PDF/UA en arrière-plan après une compilation réussie ;
                        badge par article (conforme/non conforme/en cours/outillage),
                        cache par empreinte du PDF (.szh-pdfua.json). Rappelle l'hôte par
                        configurer(), jamais par import
  portraits.js          appel du script de détourage des photos, dans WSL
  poste.js              chemins du poste : base, toolkit, forme WSL, dossiers de
                        l'utilisateur (LOCALAPPDATA, profil, bureau, VSCodium), Windows et System32 ;
                        seul module à lire ces variables d'environnement
  profil.js             ce qu'est le dossier ouvert — numéro de revue (ausgabe.yaml,
                        articles/) ou livre (buch.yaml, chapitres/) —, ses chemins, et la
                        table des capacités (contextes szh.peut.*) ; courant() rend le
                        profil actif
  qualite-image.js      seuils de résolution des images et verdict de qualité
  rapport-erreur.js     construit et écrit les rapports d'erreur automatiques (schéma v1) :
                        résolution passive de l'ancrage SharePoint, masquage, anti-
                        inondation, file d'attente hors ligne. S'appuie sur codes-erreur.js
                        (docs/RAPPORTS-ERREUR.md)
  reglages-hote.js      les valeurs et écritures des réglages, les réglages protégés et le fichier de langue ;
                        modifierConfigPoste() porte la garde « config du poste illisible ».
                        Rappelle l'hôte par configurer(), jamais par import
  accueil-reglages-hote.js  l'onglet Paramètres de l'Accueil : produit proposé, mise à jour silencieuse,
                        mode développeur, services en ligne et clés dans le coffre ;
  services-env.js       l'adresse Shlink et les clés vues de la chaîne : variables d'environnement et WSLENV ;
  relance-compilation.js  recompilation d'un article après un enregistrement fait hors de
                        l'éditeur de texte (formulaire des médias, éditeur de tableaux) :
                        anti-rebond de 2,5 s par article, départ immédiat à la fermeture du
                        panneau, rien quand une compilation démarrée depuis l'enregistrement
                        le couvre déjà (Ctrl+S relayé par triggerTaskOnSave) ni sur un numéro
                        gelé. Sans vscode : la compilation reste celle de l'hôte
  references.js         insertions d'images et de tableaux dans le markdown, et les
                        grilles d'images (plusieurs images pour une seule figure)
  renumerotation.js     aligner le numéro du dossier d'un article sur son rang à l'écran :
                        plan de renommage en deux passes (un échange de rangs ne peut pas
                        se renommer en place), fichiers du dossier qui suivent son nom, et
                        reprise d'un lot interrompu. Pur, sans vscode ni fs — l'hôte
                        exécute le plan
  renumerotation-fs.js  l'exécution du plan ci-dessus sur le disque : les deux passes, les
                        fichiers du dossier alignés sur son nom, les documents produits sous
                        l'ancien nom retirés, et l'ordre du numéro écrit EN DERNIER — écrit
                        avant, une interruption laisserait un ausgabe.yaml qui désigne des
                        dossiers inexistants. Sans vscode : les refus d'interface restent à
                        l'appelant
  reglages-flotte.js    les réglages de l'éditeur imposés à tous les postes : lecture du
                        gabarit commenté (vscodium-user/settings.json, recopié en défauts
                        d'extension dans package.json), empreinte des valeurs voulues, et
                        mesure de ce que l'éditeur refuse en défaut — que le cockpit pose
                        alors lui-même, sans jamais réécrire le fichier du rédacteur
  reglages-proteges.js  les réglages qui décrivent la chaîne de publication et non le
                        confort d'une personne — configuration de l'export OJS, titres de
                        bibliographie, tâches éditoriales par article. Déployés par la mise
                        à jour
                        (windows/settings-protected.json), relayés dans config.json pour la
                        compilation, affichés en lecture seule tant qu'on n'a pas
                        déverrouillé, et comparés à la version déployée pour dire quand un
                        poste diverge
  reperage-focus.js     retrouve dans le .md le passage qu'un constat désigne (son focus),
                        malgré la normalisation que le filtre Lua des citations lui a fait subir
                        au texte. Fonction pure, sans vscode ni fs : extension.js s'en sert pour
                        surligner le bouton « Vers l'article »
  secretariat.js        les quatre exports du secrétariat : newsletter (local), edudoc et
                        caractères (moisson OAI-PMH oai_dc propre au secrétariat — ni
                        auteurs-ojs.js ni mots-cles-edudoc.js n'exposent le titre, le résumé
                        ou les galleys), métadonnées (comparaison locale/OJS). Gabarits Twig
                        lus directement dans export-templates/, jamais copiés sur le poste.
                        Module pur, sans vscode ; appelé par outils/secretariat-cli.js
  session.js            état de session partagé entre les zones d'extension.js (verrouillage,
                        aperçu en cours, import/compilation en vol…) derrière des accesseurs
                        nommés — aucune de ces variables n'est plus une variable de module nue
  slug.js               slug d'article, miroir de celui du Makefile
  supprimer.js          effacer un arbre qui vit sur OneDrive : l'attribut « lecture seule »
                        que le synchroniseur pose sur ses dossiers marque-place retiré (fs
                        ne le retire que des fichiers), puis quelques reprises espacées pour
                        les poignées qui tombent d'elles-mêmes. Sans vscode
  suggestion-traduction.js  dossier traduction/ du numéro : une SUGGESTION de traduction par
                        fichier JSON, jamais un fichier commun (OneDrive), et leur lecture.
                        Rien n'y est publié et aucun texte n'y est modifié. Sans vscode
  table-hote.js         l'éditeur de tableau (webview) d'un article. Rappelle l'hôte par
                        configurer(), jamais par import
  table-images.js       images des cellules de tableau : aperçu en data: pour l'éditeur,
                        copie d'une image choisie dans media/ de l'article. Sans vscode
  table-model.js        analyse, sérialisation et opérations du modèle de tableau
  traduction.js         sidecar <slug>.traduction.yaml et suivi des traductions
  traduction-hote.js    envoi pour traduction, panneau de traduction, mode « Trad » et
                        suggestions ; repondreModeTrad, que les autres modules prennent par
                        défaut. Rappelle l'hôte par configurer(), jamais par import
  uri-hote.js           liens vscodium://szh-csps.szh-cockpit/… relus en szh:// par liens.js :
                        le dossier ouvert sert la vue, un autre id part au lanceur
                        (open-revue.ps1), un lien mal formé n'ouvre rien
  verrou.js             lecture seule du dossier quand le numéro est gelé
  verif-meta.js         feuille « Vérifier les méta (print) » : une page A4 par article,
                        rendue depuis print-templates/verification-meta.twig. Module pur,
                        sans disque ni vscode. Les clés du modèle qui finissent par `Html`
                        en sortent déjà échappées ; toutes les autres attendent le filtre
                        |e du gabarit
  vue-articles-hote.js  la vue « Articles » (cartes, ordre, envoi à l'auteur, PDF d'un
                        article). Rappelle l'hôte par configurer(), jamais par import
  vue-ensemble-hote.js  les vues d'ensemble des sections (traductions, Word, contrôles) : une
                        page par section, la même webview pour toutes. Rappelle l'hôte par
                        configurer(), jamais par import
  wsl.js                distro, localisation de wsl.exe, maintien en vie de la VM ; derrière
                        moteur.js
  yaml.js               (dé)sérialiseurs ausgabe/frontmatter/meta, écriture atomique
  webviews/util.js      assemblage du HTML des webviews (nonce, CSP, fichiers de media/)
  webviews/panneau.js   panneauUnique() : singleton, fermeture, mode Trad et poignée PRET de
                        chaque panneau
outils/
  rendre-gabarit.js     rend un gabarit Twig par lib/gabarits.js pour le socle PowerShell
  compteurs-synthese.js synthèse des compteurs d'usage : page HTML autonome et CSV, lancée avec le
                        Node de VSCodium ; --purger supprime ce qui a plus de 24 mois
  secretariat-cli.js    entrée en ligne de commande de lib/secretariat.js : JSON Lines sur
                        stdout, lancée par l'Accueil avec le Node qu'embarque
                        VSCodium (ELECTRON_RUN_AS_NODE=1) ; --langue fr|de, le français à
                        défaut
mail-templates/          gabarits Twig des courriels, un fichier par nom et par langue
                        (envoi-auteur.fr.twig, traduction.de.twig, …) — voir son README.md
export-templates/        gabarits Twig des quatre exports du secrétariat (lib/secretariat.js) :
                        un fichier par section de newsletter, plus edudoc.twig,
                        caracteres.twig, metadonnees.twig. Lus directement d'ici — jamais
                        copiés sur le poste. Une retouche se fait dans le dépôt, seul
                        {% block contenu %} s'écrit (l'en-tête {# … #} de chaque fichier
                        liste ses variables), et toute valeur qui alimente un CSV doit
                        passer par le filtre |csv (un point-virgule non échappé y casserait
                        une ligne)
media/
  _commun.js            fragments partagés par les formulaires (mots-clés, auto-enregistrement,
                        icônes, notifications, barre de commandes, liste de cartes)
  _design.css           socle visuel commun : jetons, cartes, barre, notifications, modale
  _messages.js          table SZH.MSG, copie navigateur de lib/messages.js
  _auteurs.{css,js}     fiche d'auteur·e et sa modale d'édition, pour trois vues
  _fiches.{css,js}      cartes de métadonnées d'article et modale photo, pour deux formulaires
  _liste.css            liste de cartes des vues d'ensemble, pour trois vues
  _numero.{css,js}      formulaire des métadonnées du numéro et de sa couverture, pour
                        metadata-issue, metadata-book et articles
  apercu.{css,js}       fragment injecté dans l'aperçu HTML
  import-verif.{html,css,js}      vérification après import Word
  medias-article.{html,css,js}    gestionnaire des médias d'un article
  metadata-articles.{html,css,js} métadonnées des articles
  metadata-issue.{html,css,js}    métadonnées du numéro
  metadata-book.{html,css,js}     métadonnées du livre (buch.yaml)
  documentation.{html,css,js}     Documentation d'un numéro : fiches « ressources » (livre,
                        film, intervention parlementaire, agenda, …) et rubriques de texte
                        riche, dans un seul formulaire
  table-editor.{html,css,js}      éditeur de tableau
  traduction.{html,css,js}        suivi des traductions
  vue-ensemble.{html,css,js}      vue d'ensemble d'une section (traductions, Word, contrôles)
  articles.{html,css,js}          vue « Articles » : ordre, tâches, métadonnées du numéro
  suggestion.{html,css,js}        proposer une traduction d'un champ, sans rien écrire
  nouveautes.{html,css,js}        « Quoi de neuf », en lecture seule
  tutoriel/                       les illustrations du parcours de démarrage
print-templates/        gabarit Twig de la feuille de vérification des métadonnées
                        (verification-meta.twig, lib/verif-meta.js) : du HTML, donc chaque
                        valeur y porte le filtre |e — le moteur n'échappe rien tout seul.
                        Lu directement d'ici, jamais copié sur le poste
```

`test/js/contrats.test.js` vérifie que cette liste reste complète, en même temps que les
autres valeurs recopiées d'un fichier à l'autre. `test/js/webviews.test.js` rend les pages
dans un DOM minimal, et `test/js/hote.test.js` active l'extension avec un faux `vscode`
puis ouvre chaque panneau : c'est ce dernier qui attrape ce que la lecture de la source ne
montre pas — une fonction supprimée avec ses voisines, une commande posée après un
`return`. `node --test "test/js/*.test.js"` depuis la racine du dépôt.

## Empaquetage

`vsce package` empaquète tout le dossier. `lib/` et `media/` doivent être dans le VSIX :
`.vscodeignore` ne les exclut jamais. Les webviews ne reçoivent aucune donnée dans leur
HTML — tout passe par `postMessage` ; seuls les libellés sont résolus à l'assemblage,
via des marqueurs `%%SZH:clé%%`.

Pour essayer une version de développement, copier **tout le dossier** vers
`%UserProfile%\.vscode-oss\extensions\szh-csps.szh-cockpit-<version>\`, puis redémarrer
VSCodium. Copier le seul `extension.js` ne suffit pas.
