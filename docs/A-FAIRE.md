# À faire

Ce qui reste à faire sur Pronto, par thème. Une ligne par tâche ; on la retire quand elle
est faite. Les questions à trancher sont marquées « À décider ».

## Image WSL et CI

- Reconstruire l'image régulièrement : aucun workflow planifié (`schedule:`) n'existe.
  À décider : la cadence (mensuelle ou trimestrielle), et ce que la reconstruction doit
  vérifier avant de publier (banc rendu dans la nouvelle image et comparé au pixel, ou
  ouverture d'une issue).
- Retirer `.szh-arrow { opacity: 0.9 }` de `pipeline/styles/print.css` : une flèche avec
  transparence hors de la page de titre ferait échouer PDF/UA (règle 7.1-3).
- Ajouter un portrait aux articles des contrôles PDF/UA : tous les auteurs de
  `test/accessibilite/` et `test/articles/` ont `photo: ""`.
- Avant de passer pandoc au-delà de 3.9 : revoir les quatre tests de
  `test/filtres-pandoc.test.js` qui dépendent de la forme du HTML des rubriques.

- Ni la suite exigeante ni la CI ne lancent `test/documentation-kirby.test.js`,
  `test/documentation-kirby.test.py`, `test/liens-courts.test.py` et
  `test/livre-migrer-meta.test.py`. `test/filtres-note-credits.test.js` tourne en CI mais pas
  dans la commande de la suite exigeante.
- La CI lance les tests avec un délai de 120 000 ms, la suite exigeante avec 300 000 ms.

## Mise en production

- Faire un aller-retour de version sur un poste de test : installer une version antérieure,
  recompiler un ancien numéro, revenir à la dernière.
- Éprouver l'archivage : cas normal, échec (PDF ouvert dans SumatraPDF), dossier déjà
  existant, désarchivage, raccourci « Ouvrir la revue.lnk » sur un autre poste.
- À décider : passer `emplacementRevues` à `production` par défaut. Aujourd'hui, une clé
  absente vaut `test`, et `bootstrap.ps1` installe un poste neuf en mode test.
- `bootstrap.ps1` affiche encore, en fin d'installation, « onglet Revue (ou Zeitschrift) >
  Nouvelle revue... » : le chemin est aujourd'hui Accueil → onglet Nouveau.
- La clé `revuesRoots` ne sert plus qu'à compter des numéros : la vider ou la retirer.
- `_Systeme\journaux` et `_Systeme\suggestions` n'ont aucun écrivain.
- Vérifier le cockpit (Node) et la WSL (Python) derrière un proxy authentifié : seul
  PowerShell est réglé pour cela.
- La clé OJS est stockée mais aucun code ne s'en sert. La gravité `echec-partiel` des
  rapports d'erreur n'est jamais employée.
- Confirmer avec le prestataire les domaines GitHub à autoriser pour les téléchargements
  (`objects.githubusercontent.com`, peut-être `release-assets.githubusercontent.com`).
- Archiver une fois en production. Confirmer l'arborescence de production et l'ancrage
  SharePoint sur un poste de la rédaction.
- Vérifier qu'aucun poste n'a encore l'ancienne forme `_NewsUndActu\Revue\` et
  `_NewsUndActu\Zeitschrift\`.
- Export OJS : relire un échantillon de conversions (fr, de, éditorial, Actualité) ; importer
  un XML dans un OJS de test ; vérifier pour la Zeitschrift le rattachement par nom (genre,
  déposant, groupe) ; prévoir l'import en ligne de commande au-delà de 30 à 50 Mo.
- Passer à la main, dans VSCodium, la liste de vérification du cockpit : import, correction,
  contrôles, échec inconnu, vue Articles, chemins accentués, Préprocessing, copies en conflit.

## Cockpit

- Insertion d'une image : la légende ne doit plus être préremplie par « Légende »
  (`media/formatting.js`, `lib/medias-hote.js`). Garder la reconnaissance de l'ancien mot à
  l'export OJS (`LEGENDES_PAR_DEFAUT`).
- Le badge « déjà converti » utilise `slugifierArticle` alors que l'import ajoute un suffixe
  en cas de doublon : utiliser `slugifierArticleUnique` (`extension.js`).
- Retirer le bouton « Changer la langue de l'article » de
  `media/metadata-articles.html` : il n'a plus d'usage.
- Retirer `en` des langues proposées pour un numéro et un livre (`media/_numero.js`).
- Tester le cas « toolkit plus ancien que l'extension ».
- Réexaminer les `|| true` après `docx-titres.py` et `import-medias.py` dans
  `pipeline/import-docx.sh` : un échec y passe inaperçu.
- `lib/copies-conflit.js` ne surveille pas les `.txt` : une copie en conflit d'une décision de
  moisson ou d'une fiche Kirby n'est pas signalée.
- Formulaire du livre : les clés `mise-en-page:`, `parties:`, `pieces-fin:`, `dedicace:`,
  `impressum:` et les réglages d'impression de `buch.yaml` n'y sont pas modifiables.
- Désactiver un moissonneur demande aujourd'hui une release (`reglages.toml` est remplacé à
  chaque mise à jour). À décider : un interrupteur dans les réglages du cockpit.
- `lib/cantons.js` n'a plus d'appelant : le supprimer ou le rebrancher.
- Piste : ranger `lib/` en sous-dossiers par domaine, si les tests suivent sans réécriture.

## Livres

- Relier `--fond-perdu` (`styles/livre/imprimeur.css`, fixé à 3 mm) à
  `impression.fond-perdu-mm` de `buch.yaml`, que la couverture lit déjà.
- Produire le deuxième livre FALC (allemand) depuis l'interface, et « Diagnostische Reisen »
  depuis l'export Word, vérifié contre le PDF d'origine.
- Reconfirmer le profil ICC avec l'imprimerie.
- À décider : convertir les images EMF côté Windows.
- À décider : corps du titre de la page de titre (19 ou 20 pt) ; auteurs d'une partie ;
  « (éd.) » ou « (dir.) » en français ; folio de la dédicace ; valeur par défaut du folio
  (`sur-total`).

## Import et gabarit d'article

- Faire remplir le gabarit à la main par une vraie personne : étiquette mal tapée avec une
  valeur, bloc figure avec une vraie image, article allemand.
- À décider : le champ « Fichier d'origine » a quitté le bloc figure du gabarit ; le
  remettre ?

## Nettoyeur de manuscrit

- Mesurer les faux positifs sur des versions publiées (une dizaine de numéros), sur des
  manuscrits allemands, et sur des documents déjà au gabarit.
- Alertes de texte alternatif sur une image liée à l'en-tête ; espace insécable posée dans un
  titre anglais de référence.
- Lexique des noms : vérifier que la forme « Nom, Prénom » est bien prise en compte ; ajouter
  des sources allemandes, autrichiennes et italiennes.

## Moissonneurs et Documentation

- Aucun déclenchement automatique de la moisson mensuelle : à décider qui la lance et quand.
- OpenParlData : obtenir une réponse sur leur `robots.txt` (`Disallow: /v1/`).
- Lexique parlementaire : droits civiques (droit de vote, curatelle, capacité de
  discernement), italien pour le Tessin, sens de `Integration`.
- Annoter 200 à 300 objets parlementaires à la main pour mesurer précision et rappel.
- Genève : identifier le préfixe `C`, vérifier `R`.
- À décider : table des états par canton ; Vaud ; les villes ; profondeur historique ;
  gabarits de la liste mensuelle et de la synthèse trimestrielle ; mention « Source :
  OpenParlData.ch ».
- Recherche : le FNS interdit les robots (demander une tolérance ?) ; largeur du filtre ;
  descriptifs souvent en anglais ; Suisse romande mal couverte (UNIGE, UNIFR, HETSL, HES-SO,
  flux PHZH et PHLU) ; dates PHSG et HEP Vaud.
- Catégories des fiches : à décider (trois axes, libellés, `jeunesse`, âge minimal et
  accessibilité des films, ISBN, réduire `instrument` de 20 à 8 valeurs). Corriger la fiche
  *The Holdovers*, classée documentaire.
- Créer la bibliothèque de groupe Zotero et y abonner les flux RSS repérés (Cairn,
  OpenEdition, A.N.A.E., Pages romandes, CFHE…).

## Site Kirby

- À décider : masquer une fiche sans fichier dans la langue affichée.
- Écrire les gabarits PHP de la Documentation dans le vrai site : libellés des liens lus dans
  le JSON, pastille de catégorie, dates suisses, suivi d'une intervention, canton seulement si
  `regional`, `curia` et `source` masqués.
- Hook `page.update:after` qui recalcule `curia` depuis `categorie`.
- Bouton « Synchroniser » : copier `_NewsUndActu\Fiches\` vers `content/actualites/` (jamais
  `_Statuts\`), créer les fichiers de langue des pages dossier, décider sens unique ou
  aller-retour.
- Vérifier les blueprints sur la version de Kirby retenue, et que les rubriques se rendent
  pareil par pandoc et par KirbyText.
- Masquer `ressources` côté allemand.

## Accessibilité

- Avertir quand une figure numérotée a `alt=""`.
- HTML : les notes sont lues au fil du texte ; à reprendre avec une vraie sortie web.
- EPUB : `conformsTo`, `accessibilitySummary`, `page-list` ; EPUBCheck et Ace ne sont pas
  dans l'image.
- Sommaire du livre : `/LI` sans `/Lbl` et `/Link` imbriqués, à examiner.
- Correctif possible du `/Contents` des liens internes (lire `aria-label`, `title`, le texte
  du lien).
- Faire un essai avec un vrai lecteur d'écran.
- Vérifier le PDF imprimeur de `test/livre-normal` (erreur `AssertionError` dans
  `resolve_math` constatée une fois).

## WeasyPrint

- Proposer les correctifs aux auteurs de WeasyPrint (`image/patches/amont/`), si Robin le
  décide.
