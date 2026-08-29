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
  archivage.js          verrouillage, archivage, appels aux scripts PowerShell du poste,
                        lecture et écriture de config.json
  articles.js           ordre des articles dans le numéro, nom affiché, tâches par article
  auteurs-corpus.js     balayage mensuel des fiches meta.yaml des numéros du poste, en
                        cours et archivés : la fonction et l'e-mail, que l'OJS public
                        n'expose pas. N'ouvre QUE les meta.yaml, et seulement celles
                        dont le mtime a bougé — les revues sont sur OneDrive, où lire
                        un fichier le fait télécharger
  auteurs-ojs.js        auteur·e·s publiés, moissonnés en OAI-PMH public sur ojs.szh.ch
                        (marcxml : noms et affiliations, ROR résolus par api.ror.org)
                        et cachés dans auteurs.json — l'autocomplétion de la modale
  citations.js          liste de références d'un article et liage manuel d'un appel
  cmyk.js               detection des JPEG CMJN et appel du convertisseur, dans WSL
  coedition.js          bail de deux minutes posé sur un fichier pendant qu'un formulaire le
                        modifie : deux postes sur le même numéro n'écrivent pas ensemble
                        (à ne pas confondre avec verrou.js, qui gèle le numéro entier)
  copies-conflit.js     détection des copies en conflit déposées par OneDrive/SharePoint, et
                        application bloc par bloc des divergences que l'éditeur calcule
                        (« Prendre cette version » / « Garder la mienne »)
  export-ojs.js         génération du XML natif OJS
  formatting.js         mise en forme markdown et commandes szh.fmt.*
  i18n.js               textes fr/de et T(clé[, args])
  interaction.js        garde d'interaction : retient ce qui volerait le focus (aperçu,
                        notifications) tant qu'un QuickPick est ouvert
  journal.js            journal de compilation -> constats de la vue « Contrôles »
  liens.js              liens szh:// et intention déposée par le lanceur
  panneaux.js           les trois panneaux QuickPick
  portraits.js          appel du script de détourage des photos, dans WSL
  qualite-image.js      seuils de résolution des images et verdict de qualité
  references.js         insertions d'images et de tableaux dans le markdown, et les
                        grilles d'images (plusieurs images pour une seule figure)
  slug.js               slug d'article, miroir de celui du Makefile
  table-model.js        analyse, sérialisation et opérations du modèle de tableau
  traduction.js         sidecar <slug>.traduction.yaml et suivi des traductions
  verrou.js             lecture seule du dossier quand le numéro est gelé
  wsl.js                distro, localisation de wsl.exe, maintien en vie de la VM
  yaml.js               (dé)sérialiseurs ausgabe/frontmatter/meta, écriture atomique
  webviews/util.js      assemblage du HTML des webviews (nonce, CSP, fichiers de media/)
media/
  _commun.js            fragments partagés par les formulaires (mots-clés, auto-enregistrement,
                        icônes, notifications, barre de commandes, liste de cartes)
  _design.css           socle visuel commun : jetons, cartes, barre, notifications, modale
  _auteurs.{css,js}     fiche d'auteur·e et sa modale d'édition, pour trois vues
  _fiches.{css,js}      cartes de métadonnées d'article et modale photo, pour deux formulaires
  _liste.css            liste de cartes des vues d'ensemble, pour trois vues
  _numero.{css,js}      formulaire des métadonnées du numéro et de sa couverture, pour deux vues
  apercu.{css,js}       fragment injecté dans l'aperçu HTML
  import-verif.{html,css,js}      vérification après import Word
  medias-article.{html,css,js}    gestionnaire des médias d'un article
  metadata-articles.{html,css,js} métadonnées des articles
  metadata-issue.{html,css,js}    métadonnées du numéro
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
