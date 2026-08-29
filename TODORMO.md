# Ce qui reste à faire

Ce fichier ne contient que ce qui reste à vérifier ou à trancher : rien de ce qui est déjà fait.
On coche une case quand le résultat annoncé a été constaté, puis on la supprime.

## Lanceur

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
  champ), validation de la section Traductions, suppression d'article, gestion des médias
  (enregistrement, remplacement par dépôt, retrait, dépôt d'un portrait), éditeur de tableau,
  remplacer ou supprimer un tableau, les raccourcis de mise en forme, et le glissement d'un
  `.docx` sur la vue. Un formulaire de médias resté ouvert doit se fermer au verrouillage. Taper dans un article n'écrit rien, les boutons de survol
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
  description rafraîchie, refus au-delà de 50 Mo, refus pendant un build ou un import. Les photos
  du tableau des auteurs sont déjà rattachées, recadrées et détourées, et `media/` ne contient plus
  que les images que le texte utilise — vérifier sur un Word à logo de licence et à portraits. Fermer
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
  l'import, éditeur de tableau. Le gestionnaire des médias, lui, ne doit pas compiler pendant la
  saisie et doit enregistrer quand on quitte le panneau.
- [ ] Gestion des médias. Le picto 🖼 à côté de celui des métadonnées ouvre le formulaire, une
  carte par **figure** — une image seule, ou toutes les images d'une même grille — dans l'ordre
  du texte. Repliée, la carte ne montre que ses aperçus, leur nom, leurs pastilles d'état et la
  zone « Ajouter une image à côté ». Les images n'apparaissent plus sous l'article dans l'arbre,
  les tableaux si. Cliquer un aperçu déplie SON formulaire sous la rangée : un seul ouvert à la
  fois dans une carte, recliquer referme, l'aperçu ouvert est cerné d'un filet d'accent et son
  chevron pivote. Y remplir les champs, enregistrer, vérifier le `.md`, et confirmer que Ctrl+Z
  dans l'éditeur défait l'écriture. Un formulaire REPLIÉ garde ses saisies : les remplir,
  replier, enregistrer, vérifier qu'elles sont écrites. Taper dans le `.md` sans enregistrer
  puis enregistrer depuis le formulaire ne doit rien perdre. Modifier puis « Retour à l'article »
  ouvre la modale, et l'onglet porte l'indicateur de modification. Les trois états
  d'accessibilité : « décorative » écrit `alt=""` ; repasser à « apporte une information » avec
  le champ vide retire l'attribut ; un texte alternatif s'écrit tel quel. Une image insérée zéro
  fois verrouille son formulaire et le dit ; insérée deux fois, l'enregistrement met les deux à
  jour. `Ctrl+Alt+F` doit ouvrir le panneau SUR l'image insérée, formulaire déplié.
- [ ] Ce qui se lit sans rien déplier. Les pastilles d'un aperçu disent l'essentiel : « 2
  insertions », « jamais insérée », « doublon », « basse résolution », « image muette ».
  Corriger le défaut — déposer un fichier plus grand, écrire un texte alternatif — doit faire
  disparaître la pastille sans recharger la page. La loupe et la corbeille sont dans l'en-tête
  du formulaire, pas sur l'aperçu : supprimer une image demande donc de la déplier d'abord.
- [ ] Accordéon « Paramètres du groupe d'images ». N'existe que sur une carte de plusieurs
  images, et s'ouvre replié. Son en-tête redit la légende de la figure et la suit à la frappe ;
  une figure sans légende affiche « sans légende ». Dedans : la liste des membres, la
  disposition, et cette légende — une seule pour toute la grille. Les images d'une grille n'ont
  PAS de champ légende dans leur formulaire ; les deux sorties (« Sortir de la grille »,
  « Retirer de la figure ») y sont, elles, puisqu'elles portent sur une image.
- [ ] Case « Image sans légende ni numéro ». Cochée, le champ Légende se verrouille et
  l'enregistrement écrit `![](media/x.png){.szh-hors-figure …}`. Au rendu : ni « Figure N », ni
  légende ; le texte alternatif reste ; les crédits s'affichent sous l'image, dans une `<figure>`.
  La numérotation des autres figures ne saute pas de numéro. Décocher rend la légende éditable et
  retire la classe. Vérifier qu'une image de 2000 px de large ne déborde pas de la page, avec et
  sans crédits.
- [ ] Encadré « Attention qualité ». Une image de moins de 1000 px de large le déclenche, un
  portrait de moins de 400 px sur son petit côté aussi, un SVG jamais. Le remplacement par un
  fichier plus grand fait disparaître l'encadré sans recharger la page.
- [ ] Remplacer un média. Par glissement et par bouton, sur une image comme sur un portrait :
  confirmation, nom conservé, aperçu et description rafraîchis, refus au-delà de 50 Mo (20 Mo pour
  un portrait), refus pendant un build ou un import. « Retirer » supprime le fichier et ses
  insertions, après confirmation ; l'aperçu et le formulaire quittent la carte, et une carte
  vidée de sa dernière image disparaît. Supprimer une image d'une GRILLE recharge le panneau :
  membres, compte et disposition doivent suivre, et les saisies en cours survivre. Déposer une
  photo sur un portrait rejoue le recadrage et le détourage, et la fiche de l'auteur·e continue
  de désigner un fichier
  qui existe.
- [ ] Ctrl+Alt+F. L'image choisie est copiée dans `media/`, la référence insérée au curseur, et le
  gestionnaire s'ouvre positionné sur cette carte. Recommencer avec le formulaire déjà ouvert doit
  amener la nouvelle carte à l'écran sans perdre une saisie en cours.

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
- [ ] Valider le DOI. C'est un champ texte libre : ni format, ni préfixe, ni unicité dans le
  numéro. Un `meta.yaml` recopié d'un article à l'autre suffit à envoyer deux fois le même DOI
  sans que personne ne le voie. La forme réelle a été relevée le 23.08.2026 sur `ojs.szh.ch` par
  l'interface OAI, et elle est simple :

      10.57161/r{AAAA}-{NN}-{SS}   revue française
      10.57161/z{AAAA}-{NN}-{SS}   Zeitschrift

  Un seul préfixe pour les deux revues, la lettre `r` ou `z` les distinguant. `NN` est le numéro
  dans l'année sur deux chiffres, `SS` un compteur courant dans le numéro, sur deux chiffres, qui
  traverse les rubriques dans l'ordre du sommaire — l'éditorial portant `00`. La rubrique
  Documentation ne reçoit pas de DOI. À faire : vérifier ce motif à la saisie, refuser un doublon
  dans `collecter()`, et corriger le DOI inventé du corpus de test
  (`test/articles/contenu-long/` porte `10.57262/szh/2026-iter-001`, dont ni le préfixe ni la
  structure n'existent). Reporté sciemment le 23.08.2026.
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
- [ ] Grilles d'images, sur une vraie série de photos. Le banc (`test/articles/figures/`) est un
  cas extrême exprès — quatre bandeaux de rapports 3,2 / 4,0 / 2,0 / 1,6 — et il montre le prix de
  la mise en page justifiée : les images d'une rangée sortent bien à la même hauteur, mais les
  gouttières de deux rangées ne s'alignent pas quand les formats diffèrent à ce point. Sur une
  série de photos de formats voisins, elles doivent tomber l'une sous l'autre. Juger là-dessus, et
  si le résultat ne convient pas, trancher entre les deux seules options : garder le justifié
  (jamais de trou, jamais de recadrage) ou passer à des colonnes égales pour les dispositions
  rectangulaires (gouttières alignées, mais bas de rangée en dents de scie). C'est un choix de
  maquette, pas un défaut.
- [ ] Grilles d'images, coupure de page. `figure` porte déjà `break-inside: avoid`, et chaque
  rangée aussi : une grille de six qui ne tient pas dans la fin d'une page doit passer entière à
  la suivante, sans laisser sa légende seule en bas. À éprouver sur un article réel, une grille
  posée juste avant un bas de page.
- [ ] Puces ▸ dans un article dense : listes imbriquées, item d'une seule ligne, item qui passe à
  la ligne. Le triangle doit rester posé sur la ligne de base du texte. Le glyphe n'est plus celui
  d'une police de repli : il est **dessiné** dans les quatre faces Open Sans livrées (côté
  0,498 em, centré sur la mi-hauteur d'x). Sur le banc, la comparaison PNG avant / après ne bouge
  d'aucun pixel visible, mais c'est à juger sur un article réel et dense.
- [ ] Hiérarchie de titres sur un numéro complet : un seul `<h1>`, corps à partir de `<h2>`,
  numérotation 1 / 1.1 / 1.1.1 inchangée à l'œil, galley Word en Title puis Heading2 et suivants.
  Deux points nouveaux à juger : `szh-niveaux.lua` **compacte** désormais les niveaux réellement
  présents (un article stylé Heading 2 puis Heading 4 sort en h2 puis h3, sans trou), et le numéro
  de section est écrit **dans le texte** du titre par `szh-sections.lua` — il se retrouve donc dans
  le galley DOCX, ce qui n'était pas le cas. Sur un numéro complet : aucun titre à deux numéros,
  aucun titre sans numéro qui devrait en porter un, et un journal de compilation sans ligne
  `[niveaux]` — celle-ci ne paraît qu'au-delà de cinq rangs de titre, où deux niveaux fusionnent.
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
- [x] Corpus d'accessibilité versé — dans `test/accessibilite/`, un **second dossier de numéro**
  et non trois articles de plus dans `test/articles/` : la porte PDF/UA prend le numéro entier
  (`SLUGS` vient de `articles/*`), un article volontairement fautif y ferait donc échouer la porte
  sur le banc entier. La note de tête de `test/accessibilite/ausgabe.yaml` expose le raisonnement.
  Il exerce un tableau sans rangée d'en-tête, un tableau sans légende, des sauts de niveau de
  titre, une bibliographie à diacritiques polonais / turcs / serbes, un crédit de figure avec sa
  fine insécable, un corps français dans un numéro de la Zeitschrift, et une paire fr/de dont les
  compteurs de figures divergent à dessein. `test/build-render.sh` l'enchaîne au banc.
- [x] **Le portrait d'auteur·e est une image décorative, sans texte alternatif.** Le filtre en
  fabriquait un depuis le nom (« Portrait de X », « Porträt von X ») quel qu'en soit le contenu
  réel du fichier : un logo, une photo de groupe ou une photo appariée à la mauvaise personne
  affirmaient une identité fausse à un lecteur d'écran. Et le nom est déjà écrit à côté, dans
  le bloc « À propos des auteur·e·s ». `ALT_PORTRAIT` a donc disparu de `szh-maquette.lua`,
  avec l'élision française qui ne servait qu'à lui.
  Le piège, et c'est tout l'enjeu : `role="presentation"` ne suffit pas. WeasyPrint 69 balise
  tout `<img>` en `/Figure` même avec `role="presentation"`, même avec `aria-hidden="true"`
  (mesuré par cas minimal) — soit une `/Figure` sans `/Alt`, soit PDF/UA-1 7.3 violée, que
  `make verifier-ua` refuse. Le portrait est donc un `<span>` vide à fond CSS, comme l'image
  décorative d'article. L'URL passe par un `<style>` de l'en-tête du gabarit : `--embed-resources`
  ne réécrit `url()` que là, jamais dans un attribut `style` (mesuré), où le galley serait parti
  avec un chemin relatif mort.
  Mesuré sur un numéro à quatre portraits réels et un numéro à un : `/Figure` 4 et 1 → **0**,
  `/Alt` 4 et 1 → **0**, les images restent dans le PDF (10 et 4 `Image XObject`, inchangés),
  le rendu PNG est **identique au pixel sur les 15 pages**, et les deux PDF restent conformes
  PDF/UA-1. Gardé par `test/js/portrait.test.js`.
- [ ] **Le portrait n'est exercé par aucune des deux portes.** `test/articles/` et
  `test/accessibilite/` écrivent tous `photo: ""` : les deux `make verifier-ua` rendent 0 sans
  jamais compiler un portrait. La preuve a dû se faire sur un numéro hors banc. Poser une photo
  sur un auteur du corpus d'accessibilité fermerait cet angle mort pour de bon.
- [ ] **Le portrait disparaît du galley DOCX — accepté le 24.08.2026, à reprendre un jour.**
  Un fond CSS ne traverse pas le writer docx de pandoc, qui lit le HTML sans son CSS. Mesuré :
  `multi.docx` passe de 723 850 à 28 167 octets, les quatre PNG de portrait quittent
  `word/media/`, et le nombre de dessins tombe de 7 à 3. Le texte du bloc auteurs — nom,
  fonction, affiliation, e-mail — est intact, et aucune règle CSS ne réapparaît en clair : le
  `<style>` vit dans `<head>`, que le reader html ignore.
  **Décision du propriétaire : on laisse ainsi.** Le portrait est dans le PDF et dans le galley
  HTML, qui sont les deux formats réellement lus ; le Word sert de version de travail. Ce n'est
  donc pas un défaut à corriger mais une perte assumée, à rouvrir seulement si OJS ou une
  relecture externe réclame les portraits en Word.
  Si le jour vient : un second passage qui les réinjecte côté docx uniquement, le HTML devant
  rester sans `<img>` — c'est lui qui tient la conformité PDF/UA.
- [ ] **Un en-tête visuel non déclaré est indétectable automatiquement.** Mesuré : un `<table>`
  sans `<caption>` et sans un seul `<th scope>` passe la porte `--flavour ua1` en « conforme » —
  et veraPDF a **raison**. Ni le RGAA ni les WCAG n'exigent qu'un tableau ait un en-tête : ils
  exigent que l'en-tête **qui existe** soit déclaré (WCAG 1.3.1 ; RGAA 5.6 porte sur « chaque
  en-tête est-il correctement déclaré »). Un tableau sans en-tête est légitime.
  Le vrai risque est donc l'inverse de ce qui était écrit ici : un tableau dont la première
  rangée **est** un en-tête aux yeux d'un lecteur humain — fond coloré, gras, simple sens du
  texte — sans être déclarée. Savoir si une rangée est un en-tête est un **jugement sémantique**,
  qu'aucun contrôle ne peut rendre : un `tables/table-NN.html` sans `<th scope>` ne doit donc
  **pas** être refusé. La seule parade est celle en place : l'import pose la question quand sa
  devinette échoue, et la rédaction tranche. Corrigé le 24.08.2026, l'ancien message disait de
  désigner la première rangée, ce qui aurait fait poser des relations fausses.
- [ ] Caractères encore non couverts par les faces livrées : → U+2192, ↑ U+2191, ▶ U+25B6 et les
  émojis. Aucun corps d'article n'en écrit aujourd'hui (`revue-template/BIENVENUE.md` en contient,
  mais ne passe pas par la chaîne d'impression) ; `test/polices-check.py` nommerait le PDF fautif
  le jour où un article en emploie. À traiter alors dans `pipeline/fonts/glyphes-manquants.py`.
- [ ] Sept paires de couleurs restent hors de `test/apca-check.py`, toutes conformes aujourd'hui
  mais que rien ne garde : lien de corps `#002A56` sur papier (+101) et sur fond de résumé (+94) ;
  corps sur `#f3f3f4` (+98) ; étiquette de résumé (+99) ; crédits de légende `#444` (+93) ; `th`
  générique noir sur `#eee` (+96) ; appel de citation non résolu sur `#fdecea` (+97). Les ajouter
  coûte quelques lignes et supprime autant d'angles morts.
- [ ] Pagination continue. `print.css` fait `content: counter(page)` sans jamais poser de
  `counter-reset`, et aucun champ de pagination n'existe : chaque article commence donc à la
  page 1. Une citation « p. 4 » ne désigne rien de stable et l'export OJS n'a pas de `<pages>`
  à donner. Piste : un champ `page-debut` par article, injecté en `@page { counter-reset: page N }`
  et repris à l'export. Reporté sciemment le 23.08.2026.
- [ ] Normalisation typographique. Rien dans la chaîne ne pose d'espace insécable devant `:`
  `;` `!` `?` `»`, ne choisit les guillemets selon la langue — pandoc `smart` produit les
  guillemets anglais quelle que soit la valeur de `lang` — ni ne signale un `ß` dans un texte
  destiné à la Zeitschrift, où l'orthographe de maison est `ss`. Et `lib/table-model.js` remplace
  toute insécable des cellules collées depuis Word par une espace ordinaire, si bien que
  « 12 000 » peut se couper en fin de ligne : le commentaire l'admet. Un filtre Lua en fin de
  chaîne, piloté par la langue de l'article, ferait le travail. Pour le `ß`, un rapport et non une
  conversion : « Weiß » est un nom propre. Reporté sciemment le 23.08.2026.

## Traductions et relecture germanophone

- [ ] Relecture germanophone du classeur `C:\Users\robin\Documents\SZH-traductions-a-relire.xlsx`
  (230 textes du cockpit, 29 menus, les types d'articles). L'audit mécanique est propre : pas de
  `ß`, pas de marqueur divergent, parité complète. Le classeur ne couvre pas les textes des
  scripts PowerShell, qui sont aussi un premier jet.
- [ ] Relire les libellés allemands de premier jet non couverts par le classeur : titres des deux
  lanceurs et messages de lien, panneau et arbre de suivi de traduction, panneau d'export, modales
  de confirmation, barre d'état, écran d'archivage, sélecteur de version, mode développeur, case
  « en-tête condensé » et son aide, gestion des médias (encadré de qualité compris), bandeau de
  filtre des métadonnées, légende de tableau et messages d'insertion de tableau.
- [ ] Relire les deux gabarits d'e-mail de traduction, français et allemand : ce sont des textes
  qui partent hors de l'équipe.
- [ ] Libellés italiens et anglais des figures et tableaux (`Figura`/`Tabella`, `Figure`/`Table`) :
  premier jet à valider. Confronter aussi les libellés allemands et italiens des six types
  d'article aux noms de rubriques réellement imprimés ; cas à regarder, `tribune-libre` →
  « Freie Tribüne » / « Tribuna libera », et les deux en-têtes de groupe. Deux tables sont à
  modifier ensemble : celle de l'extension et celle de `pipeline/filters/szh-maquette.lua`.
- [ ] Rejouer un numéro complet avec l'interface en allemand : import, formulaires, gestion des
  médias, éditeur et légende de tableau, bandeau de filtre, panneaux, messages. Aucun marqueur non traduit
  ne doit rester à l'écran.

## Décisions à trancher

- [ ] E-mail de traduction : **tranché le 23.08.2026**, le client par défaut avec un lien à
  copier-coller. L'automatisation COM d'Outlook, seule à donner un lien cliquable, ne fonctionne
  pas avec le nouveau client : elle a été retirée, `windows/mail-traduction.ps1` avec elle. Restent
  à décider : si les adresses de destination conviennent, et si une copie à l'expéditeur serait
  utile.
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

- [ ] **Demander une revue de tous les états d'erreur et de tous les plantages muets**, dans le
  programme comme dans les scripts. Pas une relecture générale : une chasse à une famille précise
  de défauts, celle où **quelque chose échoue et personne ne l'apprend**.

  La journée du 24.08.2026 en a livré une dizaine, tous trouvés par accident en cherchant autre
  chose. C'est ce qui justifie une passe dédiée : ils ne se voient pas en lisant le code, ils se
  voient en l'exécutant et en regardant ce qui aurait dû crier.

  **Les formes qu'ils prennent ici** — de quoi guider la recherche :

  - *le code de retour n'est pas lu.* `& $cli --install-extension … | Out-Null` suivi de
    l'enregistrement de la version dans `state.json` quoi qu'il arrive : l'échec devenait un
    succès, et la mise à jour suivante sautait l'extension pour toujours.
  - *le code est lu par quelqu'un qui le jette.* `-@$(MAKE) … import` ; une recette qui rend
    non nul mais dont la cible appelante ignore le résultat ; `make reimporter` avalant les codes
    3 et 4 du script.
  - *la sortie d'erreur est jetée là où elle sert.* Les deux `2>/dev/null` de la recette PDF,
    qui envoyaient au néant tout ce que WeasyPrint avait à dire.
  - *un tube masque l'échec.* Sans `set -o pipefail`, une compilation échouée rendait le code de
    `tee`, c'est-à-dire zéro. Et `| head -n1` dans le `Containerfile` rendait zéro même quand la
    commande en amont n'existait pas : la vérification de fin de build donnait son quitus à une
    image cassée.
  - *un `|| true` posé pour une bonne raison qui a cessé d'être vraie.* `docx-meta.py` à
    l'import.
  - *un contrôle dont le code de sortie ne dépend pas de ce qu'il contrôle.* `test/build-render.sh`
    cherchait `warning|error` dans le journal sans que le grep décide de rien.
  - *un mauvais compteur.* Une collision de slug comptée en « déjà converti » plutôt qu'en échec,
    donc `rate` à zéro, donc sortie zéro, donc deux articles évaporés en silence.
  - *un test qui valide le nom de la chose au lieu de la chose.* La clé `ojs.avert.doi.voulu`
    n'existait pas ; l'export affichait son nom brut à l'utilisateur, et le test passait parce que
    son motif contenait le mot cherché.
  - *une lecture qui rend « rien » et qu'on prend pour « absent ».* `Get-ScheduledTask` sous
    charge : la tâche existait, la réponse était vide, et le script s'apprêtait à la recréer en
    effaçant son historique.
  - *un repli légitime qui ne dit pas qu'il a eu lieu.* `docx-meta.py` juge le tableau des
    auteurs tout-ou-rien, à raison — un encadré de contenu ne doit pas se faire prendre pour un
    bloc auteurs. Mais le repli sur la ligne d'auteurs sous le titre ne portait aucun code : la
    fiche n'avait plus que des noms, l'export partait sans affiliation ni e-mail, `portraits/`
    restait vide, et la ligne de statistiques avait l'air normale. Un « ém. » inconnu suffisait.
    Dix-sept articles du corpus étaient dans ce cas, dont un — cinq auteurs, deux lus — qui se
    présentait comme une réussite. Corrigé le 26.08.2026 (`tableau-auteurs-non-lu`) ; la forme,
    elle, est à chercher ailleurs : **tout repli sur une valeur par défaut est un candidat.**

  **Comment chercher** : les motifs `Out-Null`, `2>/dev/null`, `|| true`, `-@`, `| head`,
  `-ErrorAction SilentlyContinue`, `except:` nu, `catch {}` vide, et tout `$?`/`$LASTEXITCODE`
  jamais testé après un appel. Puis, pour chacun, la seule question qui compte : **si ceci
  échoue, qui l'apprend, et quand ?** Un silence délibéré est légitime — il doit alors porter un
  commentaire qui dit pourquoi, comme le repli du PDF non balisé.

  Le harnais ne voit pas cette famille : un test qui n'exécute rien ne peut pas constater qu'un
  échec s'est tu. Prévoir des essais qui **provoquent** la panne — fichier verrouillé, réseau
  coupé, processus tué, droits refusés — et vérifient qu'elle se dit.


- [ ] **`.szh-arrow { opacity: 0.9 }` est un piège armé** (`pipeline/styles/print.css`). La règle
  est morte aujourd'hui : toute flèche vit dans le hero, où `opacity: 1` la neutralise. Mais
  c'est exactement le motif que la feuille interdit deux fois ailleurs, avec un ⚠ : une `opacity`
  inférieure à 1 fait dessiner l'élément dans un objet séparé où son marquage devient orphelin,
  et **fait échouer PDF/UA 7.1-3**. Une flèche posée un jour hors du hero casserait la porte de
  conformité sans que personne comprenne pourquoi. Retirer la déclaration, ou pré-mélanger comme
  ailleurs. Laissée en place le 23.08.2026 pour ne rien changer au rendu à la veille d'une
  publication.
- [ ] **`Ignored \`overflow-x: auto\`` de WeasyPrint, à chaque article.** Diagnostic établi : la
  déclaration n'est **pas** dans notre feuille. Elle vient du partiel de styles intégré de
  pandoc, injecté par `$styles.html()$` dans `pipeline/templates/szh-article.html`. La faire
  taire demande de masquer ce partiel par un `pipeline/templates/styles.html` local — donc de
  reprendre à notre charge `code{white-space: pre-wrap}`, `span.smallcaps`, les listes de tâches
  et les maths, que `print.css` ne définit pas. Gain nul côté rédaction : la ligne est déjà jetée
  avant l'écran, et un test interdit qu'elle y arrive. À ne faire que si le partiel gêne pour une
  autre raison.

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
  nouveau gel des dépendances. `fonts-noto` **peut maintenant partir**, et
  `fonts-dejavu` avec lui : les six caractères que la maquette écrivait sans les porter ont été
  ajoutés aux quatre faces Open Sans (U+202F, U+2010, U+2011, U+25B8, U+21A9, U+FE0E — voir
  `pipeline/fonts/README.md`), et `test/polices-check.py` vérifie qu'aucune police hors de
  `pipeline/fonts/` n'est plus embarquée. Manœuvre : retirer les paquets de `image/Containerfile`,
  reconstruire, puis relancer `bash test/build-render.sh` — c'est `polices-check` qui dira si un
  repli subsistait. Sans lui, un caractère non couvert cesserait simplement d'être dessiné, en
  silence.
- [ ] Un numéro qui porte un `styles/print.css` local hérité peut encore contenir les compteurs
  CSS retirés, d'où une double numérotation. Aucun numéro du dépôt n'est concerné ; à vérifier au
  déploiement sur les numéros réels. Le risque a **doublé** : aux compteurs de figures et de
  tableaux s'ajoutent désormais ceux des titres de section (`sec1/sec2/sec3`, `h2::before`), que
  `szh-sections.lua` écrit maintenant dans le texte. Un print.css local ancien afficherait donc
  « 2.1 2.1 Introduction ». Ce qu'il faut chercher dans un `styles/print.css` local :
  `counter-increment: sec`, `counter(sec1` et `body { counter-reset: sec`. Aucun de ces trois
  motifs ne doit subsister.
- [ ] Dérouler la procédure d'installation complète sur une machine vierge : celle de
  développement ne l'est plus.

La maintenance récurrente — compacter le disque WSL, reconstruire le rootfs, surveiller la fin de
support de Debian, vérifier les extensions épinglées — est décrite dans `docs/MAINTENANCE.md` et
n'a pas à être suivie ici.
