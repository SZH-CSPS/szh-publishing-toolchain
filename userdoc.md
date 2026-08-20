# Documentation utilisateur — poste de rédaction SZH

> Réglages et gestes utiles sur un poste **déjà installé**. Public : équipe de rédaction /
> référent du poste. (L'installation d'un poste est décrite dans le [README](README.md), section Runbook.)

## Ouvrir les fichiers `.md` avec « Revue SZH » (une fois par poste)

Objectif : double-cliquer un article (fichier `.md`) dans l'Explorateur ou dans OneDrive
ouvre **toute la revue** — le texte à gauche, l'aperçu à droite — et non le fichier tout seul.

Windows protège le choix de l'application par défaut : il doit être **confirmé une fois
par l'utilisateur**. Aucun script ne peut le faire proprement à sa place ; c'est un
mécanisme de sécurité voulu par Microsoft (décision D18, `PLANIFICATION.md`).

1. **Clic droit** sur n'importe quel fichier `.md` → **Ouvrir avec** → **Choisir une autre application**.
2. Sélectionner **« Revue SZH »** (si absent : « Plus d'applications ↓ » et chercher dans la liste).
3. Cocher **« Toujours utiliser cette application pour ouvrir les fichiers .md »** → **OK**.

Le réglage est mémorisé pour cet utilisateur, sur ce poste. À refaire une seule fois
par personne et par poste.

> ⚠ **Choisir « Revue SZH », pas « VSCodium ».** Les deux noms apparaissent dans la liste,
> mais ils ne font pas la même chose : « VSCodium » ouvre le fichier **seul**, sans la revue
> autour — donc sans aperçu et sans régénération du PDF. Et une fois « Toujours » coché sur
> « VSCodium », le réglage est scellé par Windows : il faut refaire la manipulation pour
> revenir à « Revue SZH ».

### Ce que fait le double-clic

- **Article d'une revue** — la revue s'ouvre complète : le dossier, le texte de l'article,
  puis l'aperçu (l'article est recompilé si son PDF n'est plus à jour).
- **Autre fichier `.md` d'une revue** (par exemple `BIENVENUE.md`) — la revue s'ouvre,
  le fichier s'affiche. Rien de plus, c'est normal : ce n'est pas un article.
- **Fichier `.md` qui n'appartient à aucune revue** — il s'ouvre quand même, pour être lu
  ou corrigé, avec un message signalant que l'aperçu et la régénération ne sont pas actifs.
- **Fichier `.md` dans un dossier réseau** (chemin commençant par `\\`) — il s'ouvre, mais
  un message prévient que le PDF ne peut pas être fabriqué depuis un dossier réseau.
  Pour travailler dessus, copier la revue dans OneDrive ou sur le disque du poste.

Les deux autres entrées restent disponibles et font exactement la même chose :

- **« Ouvrir la revue »** — le raccourci présent dans le dossier de chaque revue ;
- **« Revues SZH »** — dans le menu Démarrer (liste toutes les revues du poste).

## La barre « Revue » (tout gérer sans l'explorateur)

À l'ouverture d'une revue, une barre **« Revue SZH »** apparaît dans le panneau de
gauche (l'Explorateur). Elle regroupe tout le travail courant, sans toucher aux
fichiers ni au terminal.

[capture : la barre « Revue SZH » avec ses trois sections]

Elle a **trois sections** :

- **Articles** — un article par ligne. **Un clic fait tout** : le texte s'ouvre à
  gauche, l'article est recompilé **si besoin** (texte ou tableau plus récent que le
  PDF), et l'aperçu PDF s'affiche à droite — celui de l'article précédent se ferme
  tout seul (toujours deux volets : texte à gauche, PDF à droite).
  Au survol d'un article, un bouton :
  - **🗑 Supprimer l'article** — efface l'article **et** son PDF, après une demande de
    confirmation explicite (l'action est irréversible : rien n'est supprimé sans accord).

  Si l'article contient des **images ou des tableaux**, une petite flèche permet de le
  **déplier** :
  - chaque **image** apparaît avec ses dimensions et son poids (p. ex.
    « 1200 × 800 · 245 Ko ») ; **clic** = l'afficher ; **Remplacer** au survol échange le
    fichier contre une autre image **en gardant le même nom** ;
  - chaque **tableau** (fichiers `table-01.html`, `table-02.html`…) vient du document
    Word d'origine, **fidèlement** : les cellules fusionnées, le gras et l'italique
    sont préservés ; **clic** = ouvrir le tableau dans l'**éditeur de tableau** (une
    grille, comme dans Word — jamais de code HTML à lire) ;
    **Remplacer** au survol l'échange contre un autre fichier HTML, même nom conservé.
    La modification apparaît à la compilation suivante (Ctrl + S ou re-clic).

  Au survol, images et tableaux ont aussi une **🗑 poubelle** : elle supprime le
  fichier **et retire son insertion du texte de l'article** (l'image ou le tableau
  ne laisse donc jamais de trou dans le rendu). Une confirmation est demandée ;
  la modification du texte reste annulable par **Ctrl + Z** tant que l'article
  est ouvert.

  ### L'éditeur de tableau

  Une grille, comme dans un tableur. Les gestes :

  - **clic sur une cellule** pour l'éditer ; `Ctrl+B` gras, `Ctrl+I` italique ;
  - **Tab** ou **Entrée** pour passer à la cellule suivante ;
  - `Ctrl+Z` / `Ctrl+Y` pour annuler et rétablir ; `Ctrl+V` pour coller un tableau
    venu d'Excel ;
  - **Maj + clic**, ou glisser, pour sélectionner un bloc rectangulaire de cellules ;
  - les **en-têtes A/B/C et 1/2/3** au bord de la grille : cliquer pour sélectionner
    toute la ligne ou la colonne, glisser pour la déplacer ;
  - **clic droit** pour insérer, supprimer, fusionner, scinder, ou désigner une ligne
    ou une colonne comme en-tête.

  À droite, deux colonnes de réglages : les **préréglages** (un clic habille tout le
  tableau d'un coup) et les **styles du tableau** à gauche, les **styles des en-têtes**
  à droite. Rien de tout cela ne change le contenu : uniquement l'apparence.

  L'aperçu de l'article se ferme à l'ouverture de l'éditeur, pour laisser la place à la
  grille. Deux boutons de la barre le rouvrent (**Voir le tableau dans l'aperçu**, qui
  amène la vue sur le tableau) et le referment (**Cacher l'aperçu**).
- **Word en attente (n)** — les fichiers Word déposés mais pas encore convertis ; le
  nombre entre parenthèses est le compte. Un ⚠ « déjà converti » signale un Word dont
  l'article existe déjà (renommer le fichier si c'est une nouvelle version).
  Après une conversion réussie, le fichier Word **disparaît de ce dossier** : l'article
  (`.md`) devient l'unique copie de travail — c'est voulu, plus de doublons.
  **Nouveau : on peut aussi glisser-déposer des `.docx` directement sur la barre
  « Revue SZH »** (depuis l'Explorateur ou le bureau) : ils sont copiés puis convertis,
  exactement comme avec le bouton « Importer des Word ».

Le **titre de la barre** affiche le numéro en cours (p. ex. « R2026-2 | Autodétermination »),
mis à jour dès que les méta-données changent. En haut de la barre, **trois boutons** —
chacun ouvre un petit menu qui regroupe les actions (le raccourci clavier fait pareil,
depuis n'importe où dans la revue) :

- **🚀 Commande** (`Ctrl+Alt+A`) — la gestion de la revue :
  - **Importer des Word** — ouvre un sélecteur pour **choisir des `.docx` sur le disque** ;
    ils sont copiés dans la revue puis convertis.
  - **Convertir les Word en attente** — convertit d'un clic tous les Word déjà déposés.
  - **Méta-données du numéro** — un petit formulaire (titre du dossier, nom de la revue,
    volume, numéro, date, langue, couleur) ; **Enregistrer** met à jour la revue sans rien
    toucher d'autre. Aucun fichier technique à ouvrir.
    Une case à cocher y règle aussi l'allure de la couverture, **pour tout le numéro** :
    **« Condenser l'en-tête de couverture »**. Par défaut, l'en-tête bleu nuit a une
    **hauteur fixe** : le titre commence toujours à la même place et le bloc auteur·e·s /
    DOI / licence est collé en bas — d'où un **blanc au milieu** quand le titre est court,
    qu'il n'y a pas de sous-titre ou qu'un seul auteur signe. Cochée, l'option **supprime
    ce blanc** : les éléments se suivent à un espacement minimum et l'en-tête fait
    exactement la hauteur de son contenu (il grandit donc avec un titre long, un
    sous-titre ou deux lignes d'auteur·e·s). À décider une fois par numéro : tous les
    articles suivent.
  - **Métadonnées des articles** — un formulaire qui liste **tous les articles** :
    **type d'article** (menu déroulant, libellés dans la langue de la revue), titre,
    sous-titre, **résumé** et mots-clés **en français et en allemand** (case « + Italien »
    pour ajouter l'italien à un article), auteur(s) (prénom, nom, fonction, affiliation,
    ORCID, **e-mail**) et DOI. Le **résumé** (abrégé) se saisit ici — jamais dans le texte
    de l'article. Seuls les articles modifiés (●) sont réécrits à l'enregistrement.
    Ces informations vivent dans une **fiche cachée** à côté de l'article (invisible
    dans l'explorateur) — le texte de l'article n'est jamais touché, et la fiche ne
    s'édite **que** par ce formulaire.
    Chaque auteur·e a deux petits boutons : une **poubelle** (retirer la ligne — rien
    n'est effacé tant qu'on n'enregistre pas) et une **photo**. Le bouton photo ouvre
    une fenêtre où l'on **dépose le portrait original** (glisser-déposer ou choisir un
    fichier) : la photo est **traitée sur place** (recadrage sur le visage, noir et
    blanc, 400 × 400 — même une photo très serrée passe, l'outil complète les bords
    tout seul) et trois versions sont proposées — **originale**, **avec fond**, **sans
    fond** (détourée). On choisit celle qui paraîtra dans le **bloc « À propos des
    auteur·e·s »** en fin d'article (photo, nom, pastille ORCID, fonction, affiliation,
    e-mail).
  - **Réglages SZH** — thème, taille de l'interface et du texte, **aperçu par défaut**
    (voir ci-dessous) et langue de l'interface.
- **✏ Édition** (`Ctrl+Alt+S`) — la **bascule d'aperçu HTML ⇄ PDF** (`Ctrl+Alt+P`) et
  toutes les actions de **mise en forme** (gras, titres, blocs, figure, tableau…) — les
  mêmes que le clic droit → « Mise en forme », chaque raccourci rappelé à droite.
- **⬆ Export** (`Ctrl+Alt+D`) — les **documents produits**, puis le **cycle de vie du
  numéro** :
  - **Recompiler toute la revue** : régénère **tous** les PDF, même ceux à jour (utile
    avant une livraison : tout est reconstruit proprement d'un coup) ;
  - **Exporter la revue en XML (OJS)** : fabrique **un seul fichier** `native-….xml` à la
    racine de la revue, avec tout dedans (métadonnées du numéro et des articles, et pour
    chaque article ses trois fichiers PDF, HTML et Word encodés dans le XML). Ce fichier
    s'importe tel quel dans OJS (« Importation XML des articles et numéros »). La revue
    est recompilée au passage ; les informations manquantes (résumé, DOI, e-mail…) sont
    listées en avertissements, sans bloquer.
  - **Archiver et verrouiller la revue** — voir « Terminer un numéro » ci-dessous ;
  - **Déverrouiller la revue** / **Désarchiver la revue** — présentes seulement quand le
    numéro est verrouillé / archivé ;
  - **Exporter cet article** — présente seulement sur un numéro gelé (voir ci-dessous).

L'aperçu HTML s'affiche **toujours sur fond blanc**, comme du papier, même si l'éditeur est en
thème sombre : c'est ce que montrera le PDF.

L'**aperçu par défaut** (dans **Réglages SZH**) choisit ce qui s'affiche à droite au clic
sur un article : l'aperçu **HTML** (cliquable — un clic dans l'aperçu amène au passage
correspondant du texte) ou directement le **PDF**. `Ctrl+Alt+P` bascule à tout moment,
sans passer par les réglages. Et quand un formulaire ou l'éditeur de tableau s'ouvre,
les aperçus se ferment tout seuls : la page de travail occupe tout l'écran.

La liste des articles se met à jour toute seule (plus de bouton « Rafraîchir » : si
OneDrive tarde à synchroniser, la liste suit dès que les fichiers arrivent).

À l'ouverture d'une revue, l'environnement de compilation démarre en arrière-plan et
reste prêt : la première compilation n'a plus de temps de chauffe.

Et sur la section « Word en attente », un bouton :

- **▶▶ Convertir les Word en attente** — convertit **d'un clic** tous les Word déjà
  déposés dans le dossier (le cas le plus courant : on glisse les Word dans la revue via
  OneDrive, puis on clique ici).

### La section « Traductions »

Certains champs d'un article existent **dans les deux langues** : le titre, le
sous-titre, le résumé et les mots-clés. La troisième section les rassemble pour qu'on
voie **d'un coup d'œil** ce qui est fait et ce qui reste.

Un article par ligne, avec son avancement (p. ex. « 2/4 traduits · Prêt pour
traduction »). La petite flèche **déplie** ses champs : chacun dit s'il est
**traduit** ou **à traduire**, et à quel stade il en est —

| État | Ce que ça veut dire |
|---|---|
| **Pas prêt** | le texte source n'est pas stabilisé, ne pas traduire encore |
| **Prêt pour traduction** | la traduction peut commencer |
| **Prêt pour relecture** | la traduction est faite, elle attend un regard |
| **Traduction finalisée** | plus rien à faire sur ce champ |

Sur la section, un bouton :

- **✓✓ Tout marquer prêt pour traduction** — d'un clic, tous les champs encore
  « pas prêt » de **toute la revue** passent à « prêt pour traduction ». Les champs
  déjà plus avancés ne bougent pas : le bouton lance la campagne, il ne l'efface pas.

**Un clic sur un article** (ou sur l'un de ses champs) ouvre le **panneau de
traduction**, avec l'aperçu de l'article à droite. Pour chaque champ :

- le **texte source** en haut, en lecture seule, avec un bouton **Copier** et un
  bouton **DeepL** — celui-ci ouvre le traducteur dans le navigateur, avec le texte
  et les deux langues déjà remplis ; la traduction revient par copier-coller ;
- la **traduction** à saisir juste en dessous ;
- son **état**, dans un menu déroulant.

Le **titre et le sous-titre** partagent un même cadre et un même état : on ne traduit
pas l'un sans l'autre. Les **mots-clés**, eux, se présentent en tableau — un par
ligne, les langues côte à côte :

| n° | FR | DE |
|---|---|---|
| 1 | diagnostic | Diagnose |
| 2 | trouble du spectre de l'autisme | Autismus-Spektrum-Störung |
| 3 | intelligence artificielle | *(vide)* |

C'est la **position** qui fait la paire, et rien d'autre : l'ordre n'est donc pas
modifiable, et on ajoute ou retire une **ligne entière** — jamais un mot dans une
seule langue. Une case laissée vide s'enregistre avec la mention **`TO BE
TRANSLATED`** : la place reste tenue, le mot manquant se voit dans le fichier, et
l'export OJS prévient s'il en reste au moment de publier.

En tête, une rangée **« Tout l'article : »** avec un bouton par état — un clic pose
l'état sur **tous** les champs et enregistre. En bas, une zone
**« Question / commentaire »** : c'est là qu'on écrit ce qu'on veut dire à l'équipe de
traduction (terminologie, passage à vérifier, contexte). Un article qui porte un
commentaire est signalé par **💬** dans la liste.

**Il n'y a plus à penser à enregistrer** : tous les formulaires du cockpit se
sauvegardent seuls — trois secondes après la dernière frappe, dès qu'on quitte un
champ, et quand on change d'onglet. Le bouton **Enregistrer** reste là pour qui
préfère le geste. Les traductions vont dans la fiche de l'article (ce sont elles qui
partiront dans l'export OJS) ; les états et le commentaire restent internes à la
revue et ne sont **jamais publiés**.

La même grille de mots-clés sert dans **« Métadonnées des articles »** et dans la
**vérification de l'import** : le comportement y est identique, avec en plus les
boutons pour ajouter et retirer une ligne.

[capture : la section « Traductions » dépliée sur un article]
[capture : le panneau de traduction, aperçu à droite]

[capture : la barre avec son titre « R2026-2 | … » et les trois boutons]
[capture : le panneau « Commande » ouvert (menu déroulant)]
[capture : la section « Word en attente (2) » avec le bouton « Convertir »]
[capture : le formulaire « Méta-données du numéro »]
[capture : le formulaire « Métadonnées des articles » (cartes par article)]
[capture : un article déplié montrant images et tableaux, boutons « Remplacer »]

### Le geste type

1. **Glisser les `.docx` finalisés sur la barre « Revue SZH »** (ou dans le dossier
   **articles-word**, ou via **🚀 Commande → Importer des Word**).
2. La conversion démarre, puis **les articles sont compilés dans la foulée** (PDF et
   aperçu) : le premier clic sur un article importé affiche son aperçu tout de suite.
   À la fin, le panneau **« Vérification de l'import »** s'ouvre tout seul (voir
   ci-dessous). Les `.docx` convertis sont retirés du dossier.
3. **Cliquer un article** : son texte s'ouvre à gauche et son aperçu apparaît à droite
   (compilé au passage si nécessaire). Ensuite, chaque **Ctrl + S** régénère l'aperçu.

### La vérification de l'import

Après chaque conversion, un panneau liste les **articles tout juste importés**, un par
carte. Le convertisseur a déjà **pré-rempli ce qu'il a reconnu** dans le Word — titre,
sous-titre, résumés, mots-clés, DOI, auteur(s) — et chaque champ porte un badge :
**« détecté »** (à relire) ou **« à compléter »** (le compteur en tête de carte suit).
C'est aussi là qu'on finit l'article proprement :

- **les photos des auteur·e·s** : le même bouton photo que dans les métadonnées —
  déposer l'original, choisir la version (sans fond, avec fond, originale) ;
- **les originaux des images** : le Word ne contient souvent que des images compressées ;
  chaque image de l'article a sa zone « Remplacer par l'original » (glisser-déposer le
  fichier haute qualité — le nom est conservé, le texte n'a pas à changer).

**Enregistrer** écrit les fiches ; **Fermer** prévient si des modifications ne sont pas
enregistrées. Les articles restent modifiables plus tard par **☰ Métadonnées des articles**.

## Envoyer un numéro pour traduction

Dans le panneau de traduction, le bouton **« Envoyer pour traduction »** (à côté d'*Enregistrer*)
prépare tout : il **copie un lien** et **ouvre un brouillon d'e-mail** déjà rédigé, où le lien est
un **vrai hyperlien** cliquable. Les mêmes boutons ✉ existent dans la barre, sur la section
**Traductions** (lien vers tout le numéro) et sur chaque article (lien vers cet article).

L'e-mail est écrit **dans la langue de la personne qui va traduire**, et adressé à la bonne
rédaction — vous n'avez rien à choisir :

| Vous envoyez… | L'e-mail est en… | Adressé à |
|---|---|---|
| une **Zeitschrift** (allemand → français) | français | `redaction@csps.ch` |
| une **Revue** (français → allemand) | allemand | `redaktion@szh.ch` |

Le brouillon s'ouvre dans Outlook : relisez-le, ajoutez un mot si vous voulez, puis envoyez.

Le lien arrive **en texte simple** dans le message : pour l'ouvrir, la personne qui traduit le
**copie**, puis le colle dans la fenêtre *Exécuter* de Windows (**touche Windows + R**) et valide.
Le corps de l'e-mail le rappelle. (Un lien directement cliquable est possible, mais seulement dans
l'ancien Outlook — demandez-le au support si vous le préférez.)

La personne qui reçoit l'e-mail **clique le lien** : sur un poste de rédaction SZH, le bon numéro
s'ouvre et le suivi de traduction s'affiche directement — pas besoin de chercher le dossier.
Windows demande une fois l'autorisation d'ouvrir ce type de lien : c'est normal, il faut accepter.

Si le lien ne fonctionne pas (poste sans la chaîne installée, dossier pas encore synchronisé par
OneDrive), le message le dit et il reste toujours possible d'ouvrir le numéro à la main depuis
« Revues SZH ». Le lien ne contient aucun chemin : il ne peut désigner qu'un numéro rangé aux
emplacements officiels.

Ce bouton **ne change aucun état** de traduction : pour lancer la campagne, c'est le bouton ✓✓ de
la section « Traductions » (ou les boutons d'état du panneau).

## Terminer un numéro : archiver et verrouiller

Quand un numéro est publié, il n'a plus à changer — et ses PDF, HTML et Word occupent
souvent plusieurs centaines de mégaoctets sur OneDrive pour rien. Le panneau d'export
(`Ctrl+Alt+D`) propose donc **« Archiver et verrouiller la revue »**.

Ce qui se passe, dans cet ordre, après une confirmation qui **chiffre la place libérée** :

1. le numéro passe en **lecture seule** : le texte ne se laisse plus taper, et tous les
   gestes de la barre « Revue SZH » (import, métadonnées, suppression, traductions,
   mise en forme…) répondent « Numéro verrouillé » avec un bouton pour le déverrouiller ;
2. les **documents produits** (dossier `out` : PDF, HTML, Word) sont
   **supprimés**. Vos **sources** — textes, images, tableaux, métadonnées, traductions —
   sont intégralement conservées : c'est ce qui permet de tout régénérer plus tard ;
3. le **dossier de la revue est déplacé** dans l'arborescence d'archives
   (`RV99_Archives` pour la Revue, `ZS99_Archives` pour la Zeitschrift) ;
4. la fenêtre se ferme, puis **la revue se rouvre** depuis les archives, verrouillée.

Une fois le numéro archivé, **la compilation automatique s'arrête** : enregistrer ne
relance plus rien, et cliquer un article ne le recompile plus. Pour revoir un PDF, deux
gestes explicites :

- le bouton **« Exporter cet article »** qui apparaît au survol de l'article dans la
  barre (et dans le panneau d'export) — il régénère **ce** PDF et son aperçu ;
- **« Recompiler toute la revue »**, comme avant, pour tout refaire d'un coup.

Deux boutons pour revenir en arrière, indépendants l'un de l'autre :

- **« Déverrouiller la revue »** rend le numéro modifiable (le dossier ne bouge pas) ;
- **« Désarchiver la revue »** le ramène dans l'arborescence « en cours » (le verrou,
  lui, reste posé : à déverrouiller séparément si vous voulez corriger quelque chose).

Dans le lanceur **« Revues SZH »**, les numéros archivés apparaissent dans une **liste
séparée**, et un **🔒** signale ceux qui sont verrouillés.

## La version du logiciel

Le lanceur **« Revues SZH »** affiche en bas **« Logiciel v. … »** : la version installée
sur ce poste. Chaque numéro, lui, retient la version avec laquelle il a été **créé**.

Si vous ouvrez un ancien numéro et que les deux ne correspondent pas, un message
apparaît à la première compilation : *« Vous utilisez la version X ; ce numéro a été créé
avec la version Y. Vérifiez les documents produits. »* Ce n'est pas une erreur — la
maquette a simplement pu évoluer entre-temps. Regardez le PDF : si tout va bien, il n'y a
rien à faire.

S'il faut vraiment retrouver le rendu d'origine, le bouton **« Changer de version… »** du
message (ou du lanceur) liste les versions publiées et installe celle que vous choisissez.
À savoir avant de cliquer : l'opération remplace l'environnement de fabrication du PDF et
les extensions de l'éditeur, prend quelques minutes, et demande de **fermer les fenêtres
de rédaction** puis de redémarrer l'éditeur. Elle se refait dans l'autre sens de la même
façon (choisir la version la plus récente).

## Mettre en forme le texte

Pas besoin de connaître le Markdown : **sélectionne du texte, puis clic droit →
« Mise en forme »** (ou `Ctrl+Alt+S` : le panneau d'édition propose les mêmes actions,
plus la bascule d'aperçu). Le sous-menu propose (chaque raccourci y est rappelé) :

- **Gras**, **Italique**, **Souligné** (`Ctrl+B`, `Ctrl+I`, `Ctrl+U`) ;
- **Titre 1 / 2 / 3** (`Ctrl+Alt+1/2/3`) ;
- les blocs de la maquette — **Important**, **Mise en évidence**, **Question**
  (`Ctrl+Alt+W / H / Q`) et **Citation** (`Ctrl+Alt+C`). Le bloc « Important »
  demande un **titre** (Information, Attention, Note… ou un titre libre) ;
- **Insérer une figure** (`Ctrl+Alt+F`) : choisis une image ; elle est copiée dans
  l'article et il ne reste qu'à écrire la légende. À la composition, la légende
  (« Figure 1 — … », numérotée toute seule) est placée **au-dessus** de l'image, comme
  celle d'un tableau — quel que soit l'endroit où elle est écrite dans le texte ;
- **Insérer un saut de page** (`Ctrl+Alt+Entrée`) : ce qui suit repart en haut d'une
  nouvelle page **dans le PDF**. Rien ne change dans l'aperçu ni dans la version HTML :
  une page web n'a pas de pages, le saut n'y a donc aucun sens et n'y apparaît pas.
- **Insérer un tableau** (`Ctrl+Alt+T`) : un petit tableau vierge à remplir (`Tab`
  passe d'une cellule à l'autre) ;
- **Coller un tableau depuis Excel/Word** (`Ctrl+Alt+V`) : copie les cellules dans
  Excel ou Word, puis `Ctrl+Alt+V` dans l'article. Le tableau est ajouté à l'article
  comme les tableaux venus d'un Word — **cellules fusionnées comprises** — et apparaît
  aussitôt sous l'article dans la barre « Revue SZH », où un clic permet de le modifier.
  Un tableau collé depuis **Excel** arrive sans gras ni ligne d'en-tête (Excel ne les
  transmet pas) : cela se règle d'un clic dans l'éditeur de tableau.

Appliquer deux fois gras, italique, souligné, un titre ou une citation **retire** la
mise en forme (bascule).

## Créer une nouvelle revue

Le menu Démarrer porte **deux** entrées : **« Revues SZH »** pour la Revue, et
**« Zeitschriften SZH »** pour la Zeitschrift. Chacune ne montre **que son produit** et ne crée
**que dans son dossier** — c'est ce qui garantit qu'un numéro ne se retrouve pas rangé du mauvais
côté.

Menu Démarrer → le lanceur du produit voulu → bouton **« Nouvelle revue… »** (en bas à gauche) :
donner un nom (p. ex. `2026-02`) — la boîte rappelle où le numéro sera créé, il n'y a rien à
choisir — et le numéro s'ouvre tout prêt : dossiers `articles-word` et `articles`, raccourci
« Ouvrir la revue », et la bonne revue déjà renseignée dans ses métadonnées.

Le **nom du dossier fait l'identité** : `2027-05` donne l'année 2027 et le numéro 05, que la barre
« Revue SZH » affiche aussitôt (`R2027-05`). Le titre du dossier thématique, lui, reste **vide** :
c'est à vous de le remplir dans **Méta-données du numéro**.

> Si un ancien numéro s'annonce « R2026-2 | Dossier — numéro d'exemple » dans la barre, c'est qu'il
> a été créé avant cette version et porte encore les valeurs du gabarit : ouvrez **Méta-données du
> numéro** et corrigez l'année, le numéro et le titre. Le nom du dossier, lui, est déjà le bon.

Le lanceur cherche les revues aux emplacements officiels :

| | Revue (FR) | Zeitschrift (DE) |
|---|---|---|
| En cours | `52_Revue\RV02_Redaction` | `53_Zeitschrift\ZS02_Redaktion` |
| Archivées | `52_Revue\RV99_Archives` | `53_Zeitschrift\ZS99_Archives` |

Le lanceur **ne montre que ces quatre dossiers**. Si une revue est restée ailleurs (un ancien
dossier `OneDrive\Revues`, par exemple), elle n'apparaît pas dans les listes mais le lanceur le
dit en bas : « N revue(s) hors arborescence dans … — à déplacer ». Déplacez le dossier de la revue
dans `RV02_Redaction` (ou `ZS02_Redaktion`) et il apparaîtra.

**Mode test.** Tant que la chaîne est en rodage, le poste travaille dans un dossier
d'essai : `OneDrive - SZH CSPS\Revues-TESTING`, avec exactement la même arborescence.
Le lanceur l'annonce (« Mode test : … ») et la bascule se fait dans **Réglages SZH →
Mode développeur**. Désactivé, tout se passe dans les dossiers de production.
