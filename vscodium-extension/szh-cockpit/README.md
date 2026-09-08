# SZH — Revue (cockpit)

Extension interne SZH/CSPS. Ajoute une barre latérale « Revue SZH » qui n'apparaît que
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
extension.js            activation, câblage des commandes, hôtes de webview
lib/
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
  cantons.js            les 26 cantons et la Confédération : la liste fermée du champ
                        « canton » d'une fiche d'intervention parlementaire — le code est
                        stocké et imprimé, le nom complet ne sert qu'à la liste déroulante
  citations.js          liste de références d'un article et liage manuel d'un appel
  cmyk.js               detection des JPEG CMJN et appel du convertisseur, dans WSL
  coedition.js          bail de deux minutes posé sur un fichier pendant qu'un formulaire le
                        modifie : deux postes sur le même numéro n'écrivent pas ensemble
                        (à ne pas confondre avec verrou.js, qui gèle le numéro entier)
  copies-conflit.js     détection des copies en conflit déposées par OneDrive/SharePoint, et
                        application bloc par bloc des divergences que l'éditeur calcule
                        (« Prendre cette version » / « Garder la mienne »)
  courriel.js           sujet et corps de « Envoyer à l'auteur » et « Envoyer pour
                        traduction », rendus depuis mail-templates/*.twig par gabarits.js
  cycle-vie.js          verrouillage, archivage, désarchivage, avertissement de version
                        divergente ; et les copies en conflit du synchroniseur jusqu'à leur
                        résolution bloc par bloc (le calcul lui-même reste dans
                        copies-conflit.js). Rappelle l'hôte par un petit objet de contexte
                        (configurer()), jamais par import
  documentation-hote.js la Documentation d'un numéro : fiches et rubriques, un seul
                        formulaire. Rappelle l'hôte par configurer(), jamais par import
  export-ojs.js         génération du XML natif OJS
  formatting.js         mise en forme markdown et commandes szh.fmt.*
  formatting-pur.js      la part de formatting.js qui ne référence pas vscode (bascules de
                        texte, pose des blocs :::, palette), réutilisable par medias.js et
                        panneaux.js
  gabarits.js           moteur de gabarits, sous-ensemble de Twig sans vscode ni dépendance :
                        sert lib/courriel.js
  i18n.js               textes fr/de et T(clé[, args])
  import-hote.js        import guidé : conversion des .docx en attente (bouton ou glisser-
                        déposer), écriture de l'ordre des nouveaux articles (le numéro de
                        tête du Word migre vers ordre-articles/ordre-chapitres), et la
                        compilation qui suit un import fructueux. Rappelle l'hôte par
                        configurer(), jamais par import
  interaction.js        garde d'interaction : retient ce qui volerait le focus (aperçu,
                        notifications) tant qu'un QuickPick est ouvert
  journal.js            journal de compilation -> constats de la vue « Contrôles »
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
  oai-pmh.js            client https et parseur OAI-PMH communs à auteurs-ojs.js et
                        mots-cles-edudoc.js : redirections même-hôte, réponse bornée,
                        délai total, resumptionToken, repli sur 503 — SZH_RESEAU_INTERDIT
                        y bloque tout appel réel en test, pour les deux moissonneurs
  panneaux.js           les trois panneaux QuickPick
  pdfua-hote.js         validation PDF/UA en arrière-plan après une compilation réussie ;
                        badge par article (conforme/non conforme/en cours/outillage),
                        cache par empreinte du PDF (.szh-pdfua.json). Rappelle l'hôte par
                        configurer(), jamais par import
  portraits.js          appel du script de détourage des photos, dans WSL
  profil.js             ce qu'est le dossier ouvert — numéro de revue (ausgabe.yaml,
                        articles/) ou livre (buch.yaml, chapitres/) — et ses chemins
  qualite-image.js      seuils de résolution des images et verdict de qualité
  references.js         insertions d'images et de tableaux dans le markdown, et les
                        grilles d'images (plusieurs images pour une seule figure)
  reglages-flotte.js    les réglages de l'éditeur imposés à tous les postes : lecture du
                        gabarit commenté (vscodium-user/settings.json, recopié en défauts
                        d'extension dans package.json), empreinte des valeurs voulues, et
                        mesure de ce que l'éditeur refuse en défaut — que le cockpit pose
                        alors lui-même, sans jamais réécrire le fichier du rédacteur
  reglages-proteges.js  les réglages qui décrivent la chaîne de publication et non le
                        confort d'une personne — configuration de l'export OJS, titres de
                        bibliographie. Déployés par la mise à jour
                        (windows/settings-protected.json), relayés dans config.json pour la
                        compilation, affichés en lecture seule tant qu'on n'a pas
                        déverrouillé, et comparés à la version déployée pour dire quand un
                        poste diverge
  reserve.js            réserve de fiches hors numéro (dossier parent, _reserve/<revue>/) :
                        mettre de côté, et envoyer une copie à traduire dans la revue sœur
  ressources.js         fiches de « ressources » d'un article (livre, film, intervention
                        parlementaire, agenda, …) : un moteur générique, décliné par une
                        table de champs par type (TYPES, recopiée dans
                        pipeline/filters/szh-ressource.lua), plus les listes fermées et les
                        champs de date de chaque type
  rubriques.js          rubriques de texte riche d'un article de Documentation (références
                        du dossier, tour d'horizon, podcasts) : un bloc de prose titré, le
                        titre étant déduit du type par pipeline/filters/szh-rubrique.lua
  session.js            état de session partagé entre les zones d'extension.js (verrouillage,
                        aperçu en cours, import/compilation en vol…) derrière des accesseurs
                        nommés — aucune de ces variables n'est plus une variable de module nue
  slug.js               slug d'article, miroir de celui du Makefile
  table-model.js        analyse, sérialisation et opérations du modèle de tableau
  traduction.js         sidecar <slug>.traduction.yaml et suivi des traductions
  verrou.js             lecture seule du dossier quand le numéro est gelé
  wsl.js                distro, localisation de wsl.exe, maintien en vie de la VM
  yaml.js               (dé)sérialiseurs ausgabe/frontmatter/meta, écriture atomique
  webviews/util.js      assemblage du HTML des webviews (nonce, CSP, fichiers de media/)
mail-templates/          gabarits Twig des courriels, un fichier par nom et par langue
                        (envoi-auteur.fr.twig, traduction.de.twig, …) — voir son README.md
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
  settings.{html,css,js}          réglages
  table-editor.{html,css,js}      éditeur de tableau
  traduction.{html,css,js}        suivi des traductions
  vue-ensemble.{html,css,js}      vue d'ensemble d'une section (traductions, Word, contrôles)
  articles.{html,css,js}          vue « Articles » : ordre, tâches, métadonnées du numéro
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
