# Ce qui reste à faire

Ce fichier ne contient que ce qui reste à vérifier ou à trancher : rien de ce qui est déjà fait.
On coche une case quand le résultat annoncé a été constaté, puis on la supprime.

## Avant de tester

- [ ] Installer le toolkit et l'extension du cockpit depuis une release, ou à la main. Rien de
  ce qui suit n'est testable sans eux : les scripts d'archivage et de mise à jour sont appelés
  par leur chemin dans `C:\ProgramData\SZH\toolkit\windows\`. C'est bon quand le lanceur
  affiche un numéro de version.
- [ ] Vérifier que le mode développeur est actif (Réglages SZH, ou `devMode` dans `config.json`)
  avant le premier essai. Sinon le premier clic déplace un vrai numéro.
- [ ] Créer deux numéros de test dans `Revues-TESTING`, un par produit (`revue: revue` et
  `revue: zeitschrift`), avec chacun deux ou trois articles compilés, des images, un tableau et
  des traductions renseignées. Ils servent à tout le reste.

## Ménage sur ce poste

- [ ] Deux numéros sont mal renseignés. `2027-05`, et tout numéro créé avant que la création
  déduise ses métadonnées du nom du dossier, porte encore l'année, le numéro et le titre du
  gabarit : les corriger dans « Méta-données du numéro ». `2027-01` vit dans le dossier de la
  Zeitschrift mais se déclare `revue: revue`, et il est marqué archivé sans avoir été déplacé :
  corriger le jeton puis relancer l'archivage, ou le supprimer si c'était un essai.
- [ ] Nettoyer les restes d'essais et les clés héritées : les deux dossiers de
  `OneDrive - SZH CSPS\Revues` (`2026-04`, `test`) n'ont pas d'`ausgabe.yaml`, ce ne sont pas des
  numéros ; les dossiers laissés dans `Revues-TESTING` seront recréés au prochain lancement en
  mode test ; la clé `revuesRoots` de `config.json`, posée par une ancienne version du script de
  création, est sans effet mais trompeuse.
- [ ] Désinstaller l'extension résiduelle, absente des nouveaux postes :
  `codium --uninstall-extension csholmq.excel-to-markdown-table`.

## Lanceur

- [ ] Conditions dégradées. Lancé pendant qu'une mise à jour est en cours, le lanceur doit
  s'ouvrir ou afficher une erreur, jamais disparaître sans un mot. Sur un écran 1366 × 768, ou à
  125 et 150 % de mise à l'échelle, les deux listes, le bloc d'informations et les quatre boutons
  doivent tenir dans l'écran (non reproductible sur le poste de développement).
- [ ] Les deux listes. « En cours » et « Archivées », cadenas sur les numéros verrouillés,
  sélection qui bascule de l'une à l'autre, double-clic qui ouvre dans chacune. Un numéro déplacé
  à la main dans le dossier d'archives doit apparaître quand même. Sur un poste sans aucun numéro,
  la fenêtre s'ouvre et propose « Nouvelle revue… ». Sous les listes, la ligne
  « N revue(s) hors arborescence dans … — à déplacer » compte les numéros rangés ailleurs, y
  compris dans les anciens `OneDrive\Revues`, et disparaît une fois le dossier déplacé.
- [ ] Filtrage par produit. « Revues SZH » ne liste que la Revue, « Zeitschriften SZH » que la
  Zeitschrift, dans les deux listes. Titre de fenêtre et texte d'introduction cohérents avec le
  produit.
- [ ] Création d'un numéro. « Nouvelle revue… » ne demande que le nom, rappelle où le numéro sera
  créé et crée dans le dossier de rédaction du produit du lanceur. Vérifier depuis chaque lanceur
  que le jeton `revue:` écrit correspond au produit, et que la barre du cockpit affiche tout de
  suite l'année et le numéro déduits du nom du dossier.
- [ ] Menu Démarrer. Les deux raccourcis apparaissent après une mise à jour et n'ouvrent aucune
  console. Ils se distinguent d'un coup d'œil : même étagère de trois dos sur la tuile bleu nuit,
  tablette capucine pour la Revue, moutarde pour la Zeitschrift, et la fenêtre ouverte porte la
  même icône dans la barre des tâches. À 16 px, sur un écran sans mise à l'échelle, les deux
  intervalles entre les dos doivent rester visibles. Un raccourci déjà épinglé garde son ancienne
  icône, Windows en ayant fait une copie : dépingler puis ré-épingler une fois, pour savoir quoi
  répondre à qui le signalera.
- [ ] Sélecteur de version. « Logiciel v. … » s'affiche dans les deux lanceurs et le bouton
  « Version du logiciel… » ouvre le sélecteur, la version installée marquée et les versions déjà
  téléchargées annotées. Le même sélecteur doit s'ouvrir depuis l'avertissement de divergence du
  cockpit, sans console noire derrière le dialogue.
- [ ] Réseau contrarié. Hors ligne, le sélecteur annonce qu'il ne peut pas lister les versions
  publiées et propose celles déjà téléchargées ; la version précédente n'apparaîtra qu'après une
  deuxième mise à jour, le temps que deux archives soient conservées. Deux installations
  concurrentes : la seconde doit dire qu'une mise à jour est déjà en cours et sortir. Derrière le
  proxy SZH, mesurer le temps réel de la recherche des versions et confirmer que 8 s suffisent.
  Limite de débit de l'API GitHub (60 requêtes par heure et par adresse publique, tout un bureau
  derrière la même) : confirmer que le message est compréhensible ; si le cas devient fréquent,
  il faudra mettre la liste des versions en cache.
- [ ] Aller-retour de version réel, sur un poste de test : fermer tous les numéros, installer une
  version antérieure, vérifier que le PDF d'un ancien numéro redevient conforme, puis réinstaller
  la dernière. C'est le seul test qui prouve la promesse de recompiler à l'identique.

## Liens de traduction et e-mails

- [ ] Le bouton et le lien produit. « Envoyer pour traduction » apparaît dans le panneau de
  traduction à côté d'Enregistrer, avec une infobulle lisible ; les boutons d'envoi apparaissent
  dans la barre, un sur la section Traductions et un sur chaque article. Un clic dépose le lien
  dans le presse-papiers (le coller ailleurs pour vérifier) et ouvre le brouillon avec le sujet,
  le corps et le lien. Forme attendue : `szh://traduction/<produit>/<numéro>/<article>` depuis le
  panneau d'un article, sans le dernier segment depuis la section, et `<produit>` est celui du
  numéro. Le bouton doit fonctionner sur un numéro verrouillé — c'est là qu'il sert le plus — et
  ne changer aucun statut : un champ « pas prêt » le reste.
- [ ] Refus propres. Un numéro sans clé `revue:`, ou un dossier dont le nom contient un espace,
  donnent « Lien impossible à construire » et ne copient rien de bancal. Un lien vers un numéro
  absent du poste donne « introuvable sur ce poste ». Un lien tordu à la main
  (`szh://traduction/revue/../x`) donne « lien non valide » et rien ne s'ouvre.
- [ ] Langue et destinataire suivent le produit, pas l'interface : Revue vers `redaktion@szh.ch`
  en allemand, Zeitschrift vers `redaction@csps.ch` en français. Changer la langue de l'interface
  ne doit rien y changer.
- [ ] Clic du lien depuis Outlook, puis depuis Teams. Windows demande l'autorisation la première
  fois, plus aucune fenêtre « cet emplacement peut ne pas être sûr », et le bon numéro s'ouvre
  sur le bon article. Refaire avec VSCodium déjà ouvert sur un autre numéro, avec VSCodium fermé,
  et sur un numéro archivé.
- [ ] Le lien en texte brut. Vérifier que le copier-coller du lien dans Exécuter (Windows + R)
  ouvre bien le numéro, puisque c'est ce que le corps de l'e-mail demande de faire.
- [ ] Ce qui arrive chez le destinataire. Le lien cliquable passe par l'automatisation de
  l'Outlook classique : si la rédaction d'en face lit ses mails dans le nouvel Outlook, le lien
  peut ne pas s'ouvrir — à tester avec un vrai destinataire avant de compter dessus. Fermer
  Outlook complètement doit faire jouer le repli `mailto:`, avec un lien en texte brut non
  cliquable, ce qui est attendu : aucun client ne transforme en lien un schéma inconnu. Sur un
  poste sans la chaîne installée, le lien ne fait rien : confirmer que l'e-mail explique le repli
  par le menu Démarrer.
- [ ] Le fichier d'intention `%LOCALAPPDATA%\SZH\intention.json` est créé au clic et supprimé dès
  que le cockpit l'a consommée : vérifier qu'il ne traîne pas. Intention périmée : cliquer un
  lien, fermer la fenêtre avant qu'elle ne s'ouvre, attendre six minutes, ouvrir le numéro à la
  main — le panneau ne doit pas s'ouvrir tout seul et le fichier doit disparaître. Intention
  visant un autre numéro : le numéro ouvert à la main ne doit rien ouvrir, et celui du lien doit
  encore atterrir sur son panneau quand il s'ouvre.

## Cycle de vie d'un numéro

- [ ] Cycle de verrouillage complet dans VSCodium : sur un numéro neuf, le panneau ne propose
  qu'« Archiver et verrouiller » — ni Déverrouiller, ni Désarchiver, ni Exporter cet article.
  Verrouiller grise les articles, déverrouiller les rend modifiables sans recharger la fenêtre,
  tous les boutons reviennent et Ctrl+S recompile de nouveau.
- [ ] Tout geste d'écriture est refusé sur un numéro verrouillé, avec le message « Numéro
  verrouillé » et un bouton Déverrouiller : importer des Word, convertir les Word en attente,
  méta-données du numéro, métadonnées des articles, édition d'un article, traductions (article et
  champ), validation de la section Traductions, suppression d'article, fiche d'image, éditeur de
  tableau, remplacer ou supprimer une image ou un tableau, les raccourcis de mise en forme, et le
  glissement d'un `.docx` sur la vue. Taper dans un article n'écrit rien, les boutons de survol
  disparaissent, et Ctrl+S ne relance plus de compilation.
- [ ] Signalisation de l'état. La barre de titre porte le picto, la barre d'état affiche
  « Verrouillée », son infobulle nomme la version de création et celle du poste, et le clic
  déverrouille — ou désarchive si le numéro n'est qu'archivé. Le bouton Déverrouiller du message
  de refus ouvre bien la confirmation.
- [ ] Le fichier `<numéro>\.vscode\settings.json` est présent et invisible dans l'explorateur
  quand le numéro est verrouillé, supprimé avec son dossier au déverrouillage, et jamais créé sur
  un numéro ordinaire : ouvrir deux ou trois numéros en cours pour le confirmer.
- [ ] Archivage complet depuis VSCodium. La confirmation annonce une place cohérente avec le
  poids réel de `out/` (comparer dans l'explorateur Windows), ou dit « aucun document produit
  pour l'instant » sur un numéro jamais compilé ; Annuler ne change ni les drapeaux, ni `out/`,
  ni l'emplacement ; le geste complet ferme la fenêtre, annonce ses étapes, et le numéro se
  rouvre depuis les archives, verrouillé, avec un arbre correct.
- [ ] Ce qui reste après l'archivage : `out/` a disparu et rien d'autre — `articles/`,
  `articles-word/`, `media/`, `tables/`, `portraits/`, les `.meta.yaml`, les `.traduction.yaml`
  et `BIENVENUE.md` sont tous là. `ausgabe.yaml` porte `locked: true`, `archived: true` et une
  `version-toolkit`. Le raccourci « Ouvrir la revue.lnk » du dossier archivé pointe sur le
  nouveau chemin. Une Zeitschrift part dans les archives de la Zeitschrift, pas dans celles de la
  Revue.
- [ ] Échec et collision à provoquer. Ouvrir le PDF dans SumatraPDF puis archiver : une boîte de
  dialogue doit annoncer que les documents produits n'ont pas pu être supprimés — la console
  étant cachée, c'est le seul canal — et le numéro doit rester exactement dans son état de
  départ. Placer un dossier du même nom à destination puis archiver : le message doit dire qu'un
  dossier existe déjà, et rien ne doit être déplacé.
- [ ] Désarchivage. Retour dans le dossier de rédaction, raccourci réécrit, verrou toujours posé.
  Sur un numéro archivé puis déverrouillé, le panneau propose « Verrouiller la revue » sans
  déplacement ni suppression : vérifier que ça ne rejoue pas un archivage.
- [ ] Numéro gelé. Cliquer un article d'un numéro archivé ne démarre aucune compilation et
  affiche « Numéro gelé : la compilation automatique est coupée… », en aperçu HTML comme en
  aperçu PDF, plutôt qu'un message d'attente qui ne viendrait jamais. « Exporter cet article »
  est disponible au survol et dans le panneau d'export ; le PDF et l'aperçu reviennent et
  l'aperçu s'affiche seul à la fin ; sans article sélectionné, le panneau dit « Aucun article
  visé… » au lieu d'échouer en silence. « Recompiler toute la revue » fonctionne aussi, et
  rouvrir le numéro ensuite affiche les PDF sans relancer de build. Confirmer enfin que
  « Exporter en XML (OJS) » sur un numéro archivé est utile et fonctionne, puisqu'il recompile
  tout, galleys DOCX compris.
- [ ] Version enregistrée dans le numéro. Un numéro neuf porte `version-toolkit` avec la version
  du poste dès sa création. Un numéro ancien sans la clé ne déclenche aucun avertissement et
  n'est pas estampillé en douce ; il l'est au premier archivage. Créer un écart en modifiant la
  clé à la main : l'avertissement doit nommer les deux versions, apparaître une seule fois par
  fenêtre, ne pas revenir aux enregistrements suivants, et se déclencher sur Ctrl+S, Ctrl+E,
  « Recompiler toute la revue » et « Exporter cet article ».
- [ ] Mode développeur. Le groupe apparaît dans « Réglages SZH » avec le bon état et écrit
  `devMode` dans `C:\ProgramData\SZH\config.json`. Désactivé puis lanceur relancé : il lit les
  dossiers de production et n'y crée rien. Réactivé : il recrée et relit les dossiers de test.
- [ ] Archiver une fois en mode production, sur un numéro de test copié dans le dossier de
  rédaction réel, pour confirmer que les vrais chemins fonctionnent. Confirmer aussi
  l'arborescence de production sur un poste de la rédaction : si un poste synchronise la
  bibliothèque sous un autre nom, corriger `basesRevues.prod` dans `config.json`.

## Import Word et convertisseur

- [ ] Enchaînement après import. La compilation démarre toute seule avant le dialogue de
  vérification, si bien que le premier clic sur un article importé montre l'aperçu sans attente.
  Sur un import de plusieurs fichiers, juger si la durée reste acceptable ; sinon il faudra la
  passer en tâche de fond. Vérifier au passage l'ordre : `4_Titre.docx` et `10_Titre.docx`
  donnent les slugs `04-…` et `10-…`, rangés dans l'ordre du numéro, et réimporter le même
  fichier affiche « déjà converti ». Piège : `4_X.docx` et `04_X.docx` donnent le même slug, le
  second est ignoré.
- [ ] Glisser des `.docx` depuis l'Explorateur sur la vue « Revue SZH » : un fichier, plusieurs,
  un conflit (modale Remplacer ou Ignorer), un mélange avec des non-docx (message « seuls les
  .docx… »), un glissement de texte (rien). Confirmer que ça marche sur le VSCodium déployé.
- [ ] Dialogue de vérification d'import. Il s'ouvre seul après un vrai import. Les badges
  « détecté / à compléter » correspondent au `.meta.yaml`, le compteur se recalcule à la saisie
  et à l'ajout de l'italien, Enregistrer réécrit la fiche en préservant les clés inconnues. Le
  remplacement d'image marche par glissement et par bouton : confirmation, nom conservé,
  description rafraîchie, refus au-delà de 50 Mo, refus pendant un build ou un import. Fermer
  avec des modifications ouvre la modale. Une deuxième conversion pendant que le panneau est
  ouvert le recharge, en perdant les saisies non enregistrées. Zéro nouveau fichier donne une
  simple notification. Piège connu : la croix de l'onglet contourne la garde « non enregistré »,
  limite de l'API des webviews.
- [ ] Aperçu pas encore prêt. Cliquer un article dont `out/` a été effacé doit afficher « pas
  encore compilé » suivi de « Compilation en cours, merci de patienter… », lancer la compilation,
  puis remplacer le message par le rendu. Rejouer en mode PDF, et pendant qu'une autre
  compilation tourne déjà : un message d'attente, pas un abandon silencieux.
- [ ] Relire un échantillon de conversions : un article français, un allemand, un éditorial, une
  « Actualité et ressources ». Corps sans perte, titres aux bons niveaux, résumés et mots-clés
  dans la bonne langue, bibliographie rendue sous son titre. Défauts connus, qui se corrigent au
  formulaire : prénom et nom inversés dans la source, seconds prénoms rangés dans le nom,
  fonction et affiliation parfois fusionnées. Les entretiens ne sont pas détectables
  automatiquement : les requalifier à la main. Les graphiques et SmartArt ne sont pas convertis
  par pandoc et laissent des légendes orphelines : fournir les images par la zone « originaux »
  du dialogue d'import.
- [ ] Textes alternatifs venus de Word. Les descriptions générées automatiquement sont jetées,
  celles écrites à la main doivent être reprises : vérifier sur un numéro réel qu'aucune n'est
  jetée à tort. Piège : le filtrage repose sur une liste de formulations, une future tournure de
  Microsoft passerait au travers. Vérifier aussi, éditorialement, que les vignettes placées dans
  un lien (rubrique Actualités) ne portent aucune information : elles ne sont jamais légendées ni
  décrites, donc décoratives par défaut.

## Cockpit : panneaux, formulaires, raccourcis

- [ ] La barre et les trois panneaux. La vue « Revue SZH » ne montre que trois boutons, avec des
  infobulles dans la langue de l'éditeur, et la commande de rafraîchissement reste accessible par
  la palette. Panneau Commande (Ctrl+Alt+A) : les cinq entrées ouvrent importer, convertir,
  méta-données du numéro, métadonnées des articles et réglages. Panneau Édition (Ctrl+Alt+S) :
  depuis un `.md`, chaque action s'applique à la sélection ; depuis un autre fichier, une mise en
  forme affiche « Ouvrez un article… » mais la bascule d'aperçu fonctionne ; essayer aussi dans
  un `.md` hors numéro. Le clic droit « Mise en forme » doit rester inchangé. Panneau Export
  (Ctrl+Alt+D) : « Recompiler toute la revue » lance le rebuild et « Exporter en XML (OJS) » est
  présente. Confirmer enfin sur clavier suisse français et allemand qu'aucun des raccourcis
  Ctrl+Alt+A, S, D et P ne collisionne avec AltGr.
- [ ] Les formulaires pleine page ferment les aperçus ouverts : article avec aperçu PDF à droite
  puis « Méta-données du numéro », idem en mode HTML, idem sur un aperçu ouvert par Ctrl+S.
  Rejouer avec « Métadonnées des articles » déjà ouvert en arrière-plan. L'éditeur de tableau
  ferme tout à l'ouverture, « Voir le tableau dans l'aperçu » rouvre et amène la vue sur le
  tableau, « Cacher l'aperçu » referme, et les deux colonnes de réglages tiennent sans
  défilement.
- [ ] Aperçu par défaut. Le réglage reflète l'état courant, passer sur PDF met à jour la barre
  d'état tout de suite, le clic d'article suivant ouvre le PDF, Ctrl+Alt+P bascule, et le réglage
  est resynchronisé à la réouverture des réglages. En thème sombre, l'aperçu HTML reste sur fond
  blanc avec l'encre sombre, y compris les messages « pas encore compilé » et « numéro gelé ».
- [ ] Enregistrement automatique. Taper longuement dans un résumé : au bout de trois secondes le
  fichier est écrit, sans que la frappe, la sélection ou la position du curseur ne bougent. À
  faire dans les quatre formulaires : traduction, métadonnées des articles, vérification de
  l'import, éditeur de tableau. La fiche d'image, elle, ne doit pas compiler pendant la saisie et
  doit enregistrer quand on quitte le panneau.
- [ ] Fiche d'image. Cliquer une image dans l'arbre ouvre la fiche avec l'aperçu, les dimensions,
  le poids et les champs pré-remplis depuis le `.md`. Remplir les quatre champs, enregistrer,
  vérifier le `.md`, et confirmer que Ctrl+Z dans l'éditeur défait l'écriture. Taper dans le `.md`
  sans enregistrer puis enregistrer depuis la fiche ne doit rien perdre. Modifier puis « Retour à
  l'article » ouvre la modale, et l'onglet porte l'indicateur de modification. Les trois états
  d'accessibilité : « décorative » écrit `alt=""` ; repasser à « apporte une information » avec le
  champ vide fait disparaître l'attribut entièrement ; remplir le champ écrit `alt="…"` — et au
  rendu, la légende est lue dans les trois cas. Cas particuliers : image jamais insérée (bandeau,
  champs grisés) ; image insérée deux fois (les deux références mises à jour) ; figure portant
  déjà `{width=50%}` (l'attribut survit) ; vider les trois champs supprime le bloc d'attributs ;
  SVG et image de plus de 12 Mo (aperçu indisponible) ; « Ouvrir l'image » lance la visionneuse ;
  supprimer l'image depuis l'arbre pendant que sa fiche est ouverte.
- [ ] Insertion. Ctrl+Alt+F dans un article : l'image choisie est copiée, la référence insérée,
  l'article enregistré et la fiche ouverte dessus ; hors article, insertion seule sans fiche.
  Ctrl+Alt+T dans un article : un fichier `table-NN.html` est créé, la référence insérée,
  l'article enregistré, l'éditeur ouvert sur une grille 3 × 3, et « Retour à l'article » montre le
  tableau dans l'aperçu ; hors article, squelette Markdown et message.
- [ ] Éditeur de tableau. Les quatre champs, l'annulation et le rétablissement sans re-rendu de la
  grille, et surtout : rouvrir puis réenregistrer un tableau sans y toucher doit laisser
  `git diff` vide. Légende : la saisir marque le tableau modifié, Ctrl+S écrit la `<caption>`, la
  vider la supprime ; un tableau importé dont le Word portait une légende doit la montrer sans que
  le fichier soit modifié si on n'y touche pas. Cliquer un tableau dans la barre latérale ouvre
  l'éditeur, pas le fichier HTML, et rouvrir un tableau déjà ouvert le ramène au premier plan.
- [ ] Collage de tableau (Ctrl+Alt+V). Copier depuis Excel puis depuis Word, coller dans un
  article : un fichier `tables/table-NN.html` est créé, sa référence insérée au curseur, le
  tableau visible aussitôt dans la barre, et l'éditeur l'ouvre correctement. Les cellules
  fusionnées doivent survivre. Depuis Excel, le tableau arrive sans gras ni ligne d'en-tête, Excel
  mettant ces informations dans des classes CSS : ça se règle d'un clic dans l'éditeur ; depuis
  Word, gras, italique et en-tête sont conservés. Dire si le délai avant insertion, une
  demi-seconde à une seconde, gêne. Vérifier qu'aucune extension installée ne prend déjà le
  raccourci.
- [ ] Panneau de métadonnées d'un article. Au survol, l'icône d'édition est à gauche de la
  corbeille ; le clic ouvre le panneau sur une seule carte, avec un bandeau « Voir tous les
  articles ». Enchaîner tous, puis un, puis un autre, puis tous, avec une carte modifiée à chaque
  fois : la modale Enregistrer / Quitter sans enregistrer / Annuler doit apparaître, Annuler
  préserver les saisies, Enregistrer n'écrire que l'article affiché. Puis Ctrl+Alt+S depuis un
  article, depuis un `.md` hors article, et depuis un onglet qui n'est pas un `.md`.
- [ ] L'arbre. Cliquer un article ouvre ses assets et referme ceux du précédent ; un article sans
  asset n'a pas de chevron ; juger si la sélection reste correcte, le nœud étant recréé à chaque
  bascule. Passer « Cacher automatiquement… » à Non doit supprimer tout pliage automatique. La
  corbeille d'une image ou d'un tableau demande confirmation, supprime le fichier et retire
  l'insertion du texte : vérifier le compte annoncé dans la barre d'état, le texte réenregistré et
  recompilé, l'annulation qui restaure le texte, l'éditeur ou l'onglet d'aperçu qui se ferme, et
  le cas du fichier orphelin sans insertion.
- [ ] Mots-clés. Ajouter et retirer une ligne, cocher puis décocher « + Italien » avec des
  mots-clés italiens présents : ils ne doivent jamais disparaître, et dans le `.meta.yaml` les
  listes doivent rester alignées. Laisser un mot-clé du milieu non traduit, enregistrer, rouvrir :
  la case réapparaît vide et les paires restent en face ; l'export OJS doit alors avertir.
- [ ] Bouton DeepL : sur un résumé proche de 4000 caractères, et sur un titre avec apostrophes
  typographiques et caractères accentués.
- [ ] Panneau de suivi de traduction. Cliquer un article de la section Traductions ouvre le
  formulaire en colonne de gauche et l'aperçu de l'article à droite : vérifier que l'aperçu se
  compile et que Ctrl+Alt+P bascule HTML et PDF depuis ce panneau. Juger la lisibilité de la carte
  de champ — texte source en bloc pointillé, barre de couleur d'état à gauche, badge
  « traduit / à traduire » — sachant que le panneau n'occupe qu'une moitié d'écran : un résumé
  long doit rester confortable à saisir. Changer d'article avec des modifications non enregistrées
  doit ouvrir la modale Enregistrer / Quitter sans enregistrer / Annuler, chaque branche faisant
  ce qu'elle annonce : c'est le seul chemin que le harnais de test ne couvre pas. Enfin, le bouton
  de validation en masse de la section doit annoncer le bon nombre de champs dans la barre d'état,
  sans faire reculer un champ déjà en relecture ou finalisé.
- [ ] Deux gestes à juger sur un article réel. Le saut de page (Ctrl+Alt+Entrée) coupe la page où
  voulu dans le PDF et laisse l'aperçu HTML inchangé — le rendu est prouvé, le geste et le
  placement du marqueur ne le sont pas. Dans l'aperçu HTML, survoler un mot au milieu d'une phrase
  doit surligner tout le paragraphe, pas le mot ni le passage en gras.
- [ ] Ouverture d'un `.md` depuis l'Explorateur. Clic droit, Ouvrir avec, « Revue SZH », cocher
  « Toujours » : le numéro s'ouvre complet et l'aperçu apparaît seul. L'entrée doit s'appeler
  « Revue SZH », avec l'icône SZH, reconnaissable face à l'entrée « VSCodium » juste à côté, et la
  colonne Type doit dire « Article de revue SZH ». Le dessin de l'icône change avec cette version :
  si l'Explorateur montre encore l'ancienne, c'est son cache d'icônes, pas l'association. Deux points à regarder : le libellé affiché
  dans la boîte « Ouvrir avec », non vérifiable sans écrire dans le registre réel, et le
  comportement quand un autre numéro est déjà ouvert (nouvelle fenêtre ou réutilisation).

## Portraits et export OJS

- [ ] Modale photo de bout en bout, sur un poste à jour. Déposer une photo, obtenir trois
  versions, valider, enregistrer, voir `photo:` dans le `.meta.yaml` et le bloc « À propos » dans
  le PDF. Réouverture avec la bonne version présélectionnée ; redépôt d'un `.jpg` après un `.png` ;
  photo trop serrée (note sur le cadrage) ; image sans visage (note et recadrage centré). Icônes
  et damier de transparence lisibles en thème clair comme sombre, console de la webview sans
  erreur. Sans WSL, ou avec la distribution absente, la modale doit afficher une erreur propre,
  sans blocage ni « Chargement… » figé.
- [ ] Détourage sur de vraies photos : le test automatique n'a couvert qu'un visage synthétique.
  Valider sur des visages non frontaux, des lunettes, des groupes, un contre-jour, une photo très
  serrée et une photo sans visage, et juger le rendu noir et blanc 400 × 400 des deux versions.
  Juger dans la foulée le bloc auteurs sur un article réel : taille de la pastille ORCID et
  formulation du titre.
- [ ] Export OJS. Saisir une adresse d'auteur dans le formulaire, exporter le XML, vérifier la
  présence de `<email>` dans le bloc auteur. Puis importer le XML dans un OJS de test, ou dans le
  vrai sur un numéro dépublié : rubriques rattachées, galleys téléchargeables, résumés et
  mots-clés présents, et voir ce qu'OJS fait sans adresse d'auteur. Piège : le genre, l'uploader
  et le groupe d'utilisateurs sont rattachés par nom, valables pour le journal français observé ;
  à vérifier pour la Zeitschrift. Un XML de production fera 30 à 50 Mo, ce qui peut imposer
  l'import en ligne de commande.
- [ ] Ouvrir un `out/<slug>/<slug>.docx` dans Word : tableaux fusionnés, images, bibliographie.
  Les SVG de la maquette sont perdus faute de `rsvg-convert` ; ajouter `librsvg2-bin` au rootfs si
  ça se voit.

## Maquette et accessibilité

- [ ] En-tête condensé. Cocher la case dans « Méta-données du numéro », enregistrer, vérifier
  `entete-condensee: true` dans `ausgabe.yaml` en booléen nu, puis la recompilation, puis décocher
  et vérifier `false`. Juger ensuite les trois espaces minimum (`--hero-espace-titre` 20 px,
  sous-titre 12 px, méta 22 px) et le plancher `min-height: 220px` sur une couverture vraiment
  dépouillée : titre d'une ligne, un auteur, pas de sous-titre.
- [ ] Légendes de figure. Sur un article réel, la légende placée au-dessus doit donner le même
  ordre visuel et le même ordre de lecture (copier-coller de la page, panneau « Ordre » d'Acrobat).
  Le galley Word garde la légende sous l'image, le writer docx de pandoc ne se réglant pas :
  confirmer que c'est acceptable pour OJS. Juger aussi la numérotation : « Figure N — … » puis les
  crédits en plus petit sur la même ligne, deux suites indépendantes pour les figures et les
  tableaux, en français et en allemand, dans le PDF comme dans l'aperçu HTML, et une taille de
  crédits qui les distingue sans passer sous le seuil APCA.
- [ ] Puces ▸ dans un article dense : listes imbriquées, item d'une seule ligne, item qui passe à
  la ligne. Le triangle doit rester posé sur la ligne de base du texte.
- [ ] Hiérarchie de titres sur un numéro complet : un seul `<h1>`, corps à partir de `<h2>`,
  numérotation 1 / 1.1 / 1.1.1 inchangée à l'œil, galley Word en Title puis Heading2 et suivants.
- [ ] Écoute au lecteur d'écran (NVDA ou Narrateur). Sur un tableau Markdown, les attributs
  `scope` doivent faire annoncer l'en-tête de colonne à chaque cellule. Écouter aussi une figure
  avec un texte alternatif distinct, une figure sans — la légende y est annoncée deux fois, c'est
  le prix de la compatibilité et le signal qu'il faut écrire un vrai texte alternatif —, une image
  décorative, un tableau avec description longue et un tableau sans.
- [ ] Aplats de tableau. Juger à l'œil, sur un tableau réel, les fonds « couleur » et « négatif »,
  dont les crans ont changé pour tenir le seuil de lisibilité à la taille réelle du texte de
  tableau (13,6 px) ; sur un numéro rouge, le fond négatif n'est plus le rouge de charte mais
  `#9F001F`. Dans un numéro coloré, les fonds de l'aperçu de l'éditeur doivent être identiques à
  ceux du PDF, l'éditeur lisant les teintes que le pipeline écrit dans `out/.szh-accent.css` ; un
  numéro jamais compilé montre des gris neutres, c'est le repli attendu.
- [ ] Planche de palette `docs/palette.html`. Juger à l'œil la grille à clarté fixe de onze crans,
  où un même numéro donne la même clarté pour les six couleurs et où la couleur de charte occupe
  l'un des crans. Regarder les crans clairs du rouge et de la capucine, qui tirent au rose faute
  de rouge clair vif en sRGB ; les crans sombres de la moutarde, olive plutôt que jaunes ; et le
  cran 400, qui ne porte aucun texte parce que ni le noir ni le blanc n'y passent — vérifier que
  sa présentation ne prête pas à confusion. Si un fond paraît trop franc, faire pointer
  `--c-<nom>-clair` vers `-100` au lieu de `-200` dans `couleurs.css`, puis relancer
  `python3 test/apca-check.py` et `python3 test/palette-html.py`.
- [ ] Verser un corpus d'accessibilité dans `test/articles/` : il n'y a aujourd'hui ni image ni
  tableau légendé, donc la non-régression y est peu informative.

## Traductions et relecture germanophone

- [ ] Relecture germanophone du classeur `C:\Users\robin\Documents\SZH-traductions-a-relire.xlsx`
  (230 textes du cockpit, 29 menus, les types d'articles). L'audit mécanique est propre : pas de
  `ß`, pas de marqueur divergent, parité complète. Le classeur ne couvre pas les textes des
  scripts PowerShell, qui sont aussi un premier jet.
- [ ] Relire les libellés allemands de premier jet non couverts par le classeur : titres des deux
  lanceurs et messages de lien, panneau et arbre de suivi de traduction, panneau d'export, modales
  de confirmation, barre d'état, écran d'archivage, sélecteur de version, mode développeur, case
  « en-tête condensé » et son aide, fiche d'image, bandeau de filtre des métadonnées, légende de
  tableau et messages d'insertion de tableau.
- [ ] Relire les deux gabarits d'e-mail de traduction, français et allemand : ce sont des textes
  qui partent hors de l'équipe.
- [ ] Libellés italiens et anglais des figures et tableaux (`Figura`/`Tabella`, `Figure`/`Table`) :
  premier jet à valider. Confronter aussi les libellés allemands et italiens des six types
  d'article aux noms de rubriques réellement imprimés ; cas à regarder, `tribune-libre` →
  « Freie Tribüne » / « Tribuna libera », et les deux en-têtes de groupe. Deux tables sont à
  modifier ensemble : celle de l'extension et celle de `pipeline/filters/szh-maquette.lua`.
- [ ] Rejouer un numéro complet avec l'interface en allemand : import, formulaires, fiche d'image,
  éditeur et légende de tableau, bandeau de filtre, panneaux, messages. Aucun marqueur non traduit
  ne doit rester à l'écran.

## Décisions à trancher

- [ ] E-mail de traduction : garder l'Outlook classique, seul à accepter un lien cliquable, ou le
  client par défaut avec un lien à copier-coller (réglage `mailTraduction` dans `config.json`).
  Décider aussi si les adresses de destination conviennent ou doivent être surchargées, et si une
  copie à l'expéditeur serait utile.
- [ ] Le lanceur de la Zeitschrift doit-il forcer l'interface en allemand ? Aujourd'hui la langue
  suit celle de Windows, comme partout.
- [ ] Que faire de ce qui n'est pas listé. Un numéro rangé hors de l'arborescence officielle est
  signalé sous les listes, jamais listé, jamais déplacé d'office : confirmer. Un numéro sans clé
  `revue:` n'apparaît dans aucun des deux lanceurs : décider si c'est acceptable ou s'il faut le
  signaler.
- [ ] Le script de mise à jour lancé à la main est en retard d'une passe : il extrait le nouveau
  toolkit puis continue avec l'ancien code, déjà lu par PowerShell. Décider s'il doit se relancer
  tout seul, avec un commutateur pour borner la récursion. La tâche planifiée n'a pas ce défaut.
- [ ] Trois détails du format `ausgabe.yaml`. La création vide le titre d'exemple du gabarit :
  confirmer, ou préférer le laisser jusqu'à ce qu'on le remplisse. `locked: false` et
  `archived: false` sont présents dans le gabarit et arrivent donc aussi dans les métadonnées
  pandoc, inutilisées et inoffensives : les garder pour la lisibilité du fichier, ou les retirer.
  La clé s'appelle `version-toolkit`, pour coller au vocabulaire du dépôt, plutôt que « version
  compilateur » : valider.
- [ ] Trois choix du cycle de vie à confirmer. La compilation automatique est coupée dès qu'un
  numéro est verrouillé, pas seulement archivé, et « Exporter cet article » apparaît dans les deux
  cas : confirmer ou restreindre à l'archivage. Désarchiver ne déverrouille pas, ce sont deux
  gestes indépendants : confirmer, sinon les fusionner. L'archivage ferme la fenêtre et la rouvre,
  seule façon de déplacer un dossier que VSCodium tient ouvert : confirmer que c'est acceptable
  pour la rédaction, l'autre option étant de ne pas rouvrir du tout.
- [ ] Quand le mode développeur doit-il passer à `false` par défaut ? Il est actif partout
  aujourd'hui, y compris sur un poste neuf et quand la clé manque.
- [ ] En-tête condensé : l'option est décochée par défaut, donc les numéros existants ne bougent
  pas. Après l'avoir vue sur un vrai numéro, dire si le condensé doit devenir la norme — il suffit
  d'inverser le défaut dans `revue-template/ausgabe.yaml`.
- [ ] Périmètre du suivi de traduction : seuls titre, sous-titre, résumé et mots-clés sont suivis.
  Faut-il une ligne « Texte de l'article », statut et commentaire sans texte cible, pour suivre la
  traduction intégrale, qui vit dans l'autre revue ?
- [ ] Clé d'API DeepL : faut-il un réglage et un appel côté hôte pour que la traduction revienne
  toute seule dans le champ, au lieu du copier-coller ?
- [ ] Liaison des citations. Le filtre `szh-citations.lua` liait 72,6 % des références
  automatiquement. Il a été retiré du dépôt et reste récupérable par git. Décider s'il revient
  comme action supervisée du cockpit ; en aucun cas déclenchée à l'import.
- [ ] Trois arbitrages sur les figures. Le texte alternatif dit « Figure 5 — Légende » avec un
  cadratin, là où la demande initiale disait un trait d'union : le cadratin est gardé parce que le
  texte alternatif doit être identique au caractère près à la légende pour que pandoc pose
  `aria-hidden` dessus, sans quoi le lecteur d'écran lit deux fois la même phrase — garder le
  cadratin, ou changer la constante dans `pipeline/filters/szh-numerotation.lua` en acceptant la
  double annonce. Faut-il un signalement à la compilation du type « N figure(s) utilisent la
  légende comme texte alternatif », dernier cas de double annonce, à mettre en balance avec le
  bruit ajouté au panneau ? Et les crédits d'une figure sans légende, aujourd'hui perdus faute de
  `<figcaption>` où les mettre alors que les tableaux se voient fabriquer une `<caption>` crédit
  seule : aligner les figures ou non ?
- [ ] Image sans légende et PDF/UA-1 : WeasyPrint 69 ne distingue pas un `alt` vide d'un `alt`
  absent et écrit une erreur, le PDF sortant quand même. Exiger une légende à l'import, avec un
  avertissement du cockpit sur toute image non légendée, ou attendre une version de WeasyPrint qui
  fasse la distinction.
- [ ] Retoucher une légende de tableau importée avec du gras ou de l'italique la remet à plat, le
  champ étant du texte simple. Faut-il préserver la mise en forme des légendes venues de Word ?
- [ ] Trois pistes non faites : entrée « Ouvrir l'image » dans le menu contextuel de l'arbre,
  report des crédits vers l'export OJS, et alerte de relecture listant avant livraison les figures
  sans légende ni texte alternatif.
- [ ] Deux jetons de maquette et trois bordures. `--c-kw-bg` : les puces de mots-clés sont à 10 px,
  plus petit que ce que couvrent les quatre niveaux, et le rouge comme la capucine passent sous le
  seuil ; à cette taille, éclaircir ne suffira pas, c'est la taille qu'il faut revoir.
  `--c-annual-text` : aucune règle ne le consomme ; soit une règle l'utilise et il faut le porter
  à 90, soit c'est du code mort à supprimer. Enfin, `--c-abstract-border` (3 px), `.szh-filet`
  (6 px) et les bords d'encadré gardent la couleur de marque brute, à Lc 30,1, pile sur le
  plancher, alors que les filets de tableau sont passés au jeton `--c-annual-ui` à Lc 45 : décider
  si les trois règles suivent. C'est un choix esthétique.
- [ ] Ne garder que quatre préréglages de tableau sur les huit proposés — académique, en-tête
  foncé, en-tête couleur, en-tête gris, lignes alternées, colonnes alternées, synthèse, matrice.
  Ouvrir un tableau, cliquer chacun, juger au rendu. Pour en retirer un : supprimer ses entrées de
  `PRESETS_TABLE` et `PRESETS_ORDRE` dans `lib/table-model.js`, et son libellé
  `table.preset.<clé>` dans `lib/i18n.js`, en français et en allemand. Rien d'autre.

## Reste technique

- [ ] Masquer la bascule d'aperçu sur un numéro dont le profil ne produit pas de PDF : le mode
  HTML est forcé, mais le bouton reste cliquable et semble ne rien faire. Demande un nouveau texte
  traduit.
- [ ] La clé `profil:` s'écrit encore à la main dans `ausgabe.yaml` ; une ligne posée à la main
  survit au formulaire. Piège si un sélecteur est ajouté : le sérialiseur saute les valeurs vides,
  donc le choix « aucun document » — clé présente et vide — n'est pas exprimable en l'état.
- [ ] Poser les associations de fichiers des profils par le fichier XML de DISM au bootstrap :
  non fait.
- [ ] Réduire la taille du rootfs. Le venv des portraits pèse environ 735 Mo et son modèle 168 Mo :
  soit on l'accepte, soit on épingle un rembg plus ancien, sans scikit-image ni numba, avec un
  nouveau gel des dépendances. Retirer aussi `fonts-noto`, devenu inutile depuis que la maquette
  embarque ses polices : plusieurs centaines de mégaoctets.
- [ ] Un numéro qui porte un `styles/print.css` local hérité peut encore contenir les compteurs
  CSS retirés, d'où une double numérotation. Aucun numéro du dépôt n'est concerné ; à vérifier au
  déploiement sur les numéros réels.
- [ ] Dérouler la procédure d'installation complète sur une machine vierge : celle de
  développement ne l'est plus.

La maintenance récurrente — compacter le disque WSL, reconstruire le rootfs, surveiller la fin de
support de Debian, vérifier les extensions épinglées — est décrite dans `docs/MAINTENANCE.md` et
n'a pas à être suivie ici.
