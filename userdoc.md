# Documentation utilisateur — poste de rédaction SZH

> Réglages et gestes utiles sur un poste **déjà installé**. Public : équipe de rédaction /
> référent du poste. (L'installation d'un poste est décrite dans le [README](README.md), section Runbook.)

## Le tutoriel intégré

Neuf étapes, dans l'ordre du cycle d'un numéro : ouvrir, déposer les Word, vérifier
l'import, métadonnées du numéro, images et portraits, tableaux, traductions, relire le PDF,
exporter et archiver. Chaque étape porte les boutons qui la font, et se coche quand vous
l'avez faite pour de vrai.

Trois façons de l'ouvrir :

- l'icône **🎓** en haut de la barre latérale « Revue SZH » ;
- **Panneau de commande** → « Prise en main (tutoriel) » ;
- à la première ouverture d'un numéro, une invitation le propose une fois.

## Ouvrir les fichiers `.md` avec « Revue SZH » (une fois par poste)

Objectif : double-cliquer un article (fichier `.md`) dans l'Explorateur ou dans OneDrive
ouvre **toute la revue** — le texte à gauche, l'aperçu à droite — et non le fichier tout seul.

Windows protège le choix de l'application par défaut : il doit être **confirmé une fois
par l'utilisateur**. Aucun script ne peut le faire proprement à sa place ; c'est un
mécanisme de sécurité voulu par Microsoft.

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
  Chaque ligne porte le **titre** de l'article, précédé de son **rang à deux chiffres**
  dans le numéro, avec le nom de son dossier et son avancement juste à côté. Cliquer
  l'**onglet** « Articles » lui-même ouvre la **vue « Articles »**, où se règlent
  l'ordre du numéro, les tâches et la couverture (voir plus bas).
  Au survol d'un article, trois boutons :
  - **☰ Éditer les métadonnées de cet article** — le formulaire des fiches, filtré sur
    ce seul article ;
  - **🖼 Gérer les médias de cet article** — le formulaire décrit juste en dessous ;
  - **🗑 Supprimer l'article** — efface l'article **et** son PDF, après une demande de
    confirmation explicite (l'action est irréversible : rien n'est supprimé sans accord).

  Si l'article contient des **tableaux**, une petite flèche permet de le **déplier** :
  chaque **tableau** (fichiers `table-01.html`, `table-02.html`…) vient du document
  Word d'origine, **fidèlement** : les cellules fusionnées, le gras et l'italique
  sont préservés ; **clic** = ouvrir le tableau dans l'**éditeur de tableau** (une
  grille, comme dans Word — jamais de code HTML à lire) ;
  **Remplacer** au survol l'échange contre un autre fichier HTML, même nom conservé,
  et la **🗑 poubelle** supprime le fichier **et retire son insertion du texte** (un
  tableau ne laisse donc jamais de trou dans le rendu). Une confirmation est demandée ;
  la modification du texte reste annulable par **Ctrl + Z** tant que l'article
  est ouvert.

  Les **images**, elles, ne sont plus listées sous l'article : elles se gèrent toutes
  ensemble dans le gestionnaire des médias.

  ### Le gestionnaire des médias

  Le picto **🖼** à côté de « Éditer les métadonnées de cet article » ouvre un
  formulaire qui liste **tous les médias de l'article**. Une carte par image, dans
  l'ordre où elles apparaissent dans le texte, et sur chacune :

  - l'**aperçu**, le nom du fichier, ses dimensions et son poids ;
  - la **légende** (celle qui s'affiche sous la figure, numérotée toute seule), le
    **rôle** de l'image pour les lecteurs d'écran, le **texte alternatif**, le
    **copyright** et la **source** — exactement les champs de l'ancienne fiche d'image,
    mais sans avoir à ouvrir les images une par une ;
  - **Image sans légende ni numéro** : à cocher pour une image qui n'est pas une figure
    de la revue. Elle ne reçoit ni « Figure N », ni légende visible ; son texte
    alternatif reste, et ses crédits s'affichent discrètement sous l'image, dans une
    `<figure>` — le lien entre l'image et ses droits ne se perd pas, même sans légende ;
  - un encadré orange **« Attention qualité »** quand le fichier est trop petit pour
    l'usage prévu (voir plus bas) ;
  - une zone de **glisser-déposer** pour **remplacer** le fichier par un autre — le nom
    est conservé, donc le texte de l'article n'y perd aucun lien ; une confirmation est
    demandée avant d'écraser ;
  - **Ouvrir** (l'image dans la visionneuse, à côté du formulaire) et **Retirer** (le
    fichier **et** ses insertions dans le texte, après confirmation).

  **Ctrl + S** enregistre toutes les cartes d'un coup et relance la compilation.
  Une image qui n'est **insérée nulle part** dans le texte le dit et se verrouille : il
  n'y a aucun endroit où écrire sa légende. Insère-la d'abord (`Ctrl+Alt+F`).

  En pied de page, les **portraits des autrices et auteurs**. Ce ne sont pas des
  figures : ni légende, ni numéro. On y voit les dimensions de l'original, le verdict de
  qualité, et une zone de dépôt qui remplace la photo — le recadrage du visage et le
  détourage du fond sont rejoués comme au premier dépôt.

  Trois boutons **choisissent la version que la fiche retient**, comme dans le formulaire
  des auteur·e·s : **sans fond** (le détourage, retenu par défaut), **avec fond** (le
  recadrage sans détourage) et **originale** (la photo telle qu'elle a été déposée). Le
  détourage n'est pas toujours le bon choix : un fond clair, une écharpe, des cheveux fins,
  et il vaut mieux garder le fond. Une version que le pipeline n'a pas encore produite
  n'est pas proposée, et un portrait qu'aucune fiche ne désigne n'a nulle part où écrire le
  choix — il est signalé comme tel.

  > **Portraits déjà traités.** Le cadrage a été corrigé : quand le cadre visé dépassait de
  > la photo, la dernière ligne de pixels était répétée et laissait une coulure sous le
  > visage. Les portraits produits avant cette correction gardent leur coulure — il faut
  > redéposer la photo (le dépôt du gestionnaire des médias suffit) pour qu'elle disparaisse.

  #### L'encadré « Attention qualité »

  La résolution se gagne à la source : une image trop petite ne se rattrape pas à la
  composition. Le formulaire compare donc chaque fichier à ce que son usage demande.

  - **Image du texte** : elle peut être affichée en **pleine largeur**, soit environ
    17 cm dans le PDF A4. Il faut **1000 px de large au minimum**, et **2000 px** pour
    une impression nette (300 ppp) comme pour un écran haute densité. En dessous de
    1000, l'encadré est ferme : dépose l'original haute résolution.
  - **Portrait** : il est réduit à une vignette de 28 mm de côté, dont le pipeline ne
    garde que la région du visage. Il faut **400 px au minimum sur le petit côté** —
    en dessous, le recadrage agrandit et la photo sort floue — et **1000 px** pour un
    résultat net.
  - Un **SVG** n'a pas de résolution : il est net à toute taille, jamais signalé.

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
- **✏ Édition** (`Ctrl+Alt+S`) — la **bascule d'aperçu HTML ⇄ PDF** (`Ctrl+Alt+P`),
  **Lier un appel à une référence** (voir « Les références » ci-dessous) et toutes les
  actions de **mise en forme** (gras, titres, blocs, figure, tableau…) — les mêmes que le
  clic droit → « Mise en forme », chaque raccourci rappelé à droite.
- **⬆ Export** (`Ctrl+Alt+D`) — les **documents produits**, puis le **cycle de vie du
  numéro** :
  - **Recompiler toute la revue** : régénère **tous** les PDF, même ceux à jour (utile
    avant une livraison : tout est reconstruit proprement d'un coup) ;
  - **Exporter la revue en XML (OJS)** : fabrique **un seul fichier** `native-….xml` à la
    racine de la revue, avec tout dedans (métadonnées du numéro et des articles, et pour
    chaque article ses trois fichiers PDF, HTML et Word encodés dans le XML). Ce fichier
    s'importe tel quel dans OJS (« Importation XML des articles et numéros »). La revue
    est recompilée au passage. Ce qui manque se répartit en deux : les informations
    **facultatives** (sous-titre, mots-clés, e-mail d'un auteur, couverture…) sont
    listées en **avertissements** et l'export part quand même ; ce qui rendrait le numéro
    faux dans OJS **arrête l'export**, avec la liste de ce qu'il faut corriger et où — la
    **date de publication** du numéro, un **titre** ou un **résumé** manquant dans la
    langue de l'article, un **DOI** absent, un PDF / HTML / Word pas encore produit, ou
    un champ vide dans **Réglages SZH → Export OJS** (voir « Régler l'export OJS »
    ci-dessous). Dans ce cas **rien n'est écrit** : pas de fichier à moitié fait.
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
[capture : le gestionnaire des médias, une carte par image, un encadré qualité]

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

Deux choses sont déjà faites à l'import, sans rien demander :

- **les photos du tableau des auteur·e·s sont rattachées à la bonne personne** — la
  photo de sa cellule, ou celle de la même colonne — rangées dans `portraits/`, puis
  **recadrées sur le visage et détourées**, exactement comme si on les avait déposées
  dans le formulaire. La version *sans fond* est celle que la fiche retient ; les trois
  restent accessibles par le bouton photo ;
- **les images que le texte n'utilise pas sont supprimées**. Word livre tout ce que le
  document embarque — logo de licence, filigranes, portraits — et le convertisseur
  extrayait tout. Ce qu'aucune insertion du texte ni aucun tableau ne cite n'a nulle
  part où être légendé : `media/` ne garde donc que ce qui sert. Le journal d'import
  liste ce qui est parti.

**Enregistrer** écrit les fiches ; **Fermer** prévient si des modifications ne sont pas
enregistrées. Les articles restent modifiables plus tard par **☰ Métadonnées des articles**.

### L'auteur renvoie son Word corrigé

C'est le cas le plus fréquent après un premier envoi, et il a son geste : **« Réimporter cet
article »**, par un clic droit sur l'article dans la barre « Revue », ou depuis la carte de
l'article dans **Word en attente**.

Déposez le Word corrigé comme le premier. Il ne créera pas un second article : l'outil
reconnaît qu'il vient du même document et vous le dit, sans rien toucher. C'est vous qui
décidez ensuite de publier la correction.

**Ce que le réimport remplace** : le texte de l'article, ses images, ses tableaux — tout ce
qui vient du Word.

**Ce qu'il garde** : la fiche entière (titre, sous-titre, résumés, mots-clés, DOI, langue,
licence, auteur·e·s), **les photos des auteur·e·s**, l'état des traductions, et les tâches
cochées. C'est exactement ce qu'on craint de perdre, et c'est ce qui ne bouge pas.

**Les tableaux méritent un mot**, parce que c'est là qu'on travaille le plus. L'outil sait
distinguer trois cas :

- l'auteur n'a pas touché ce tableau : **votre mise en forme est gardée**, et elle suit son
  rang si l'auteur en a inséré un avant ;
- l'auteur l'a modifié, vous non : la version du Word remplace la vôtre, sans perte ;
- **vous l'avez retravaillé et l'auteur l'a modifié** : la version du Word est posée, parce
  qu'elle correspond au texte corrigé, et l'outil **vous le dit** en nommant le tableau.
  Rouvrez l'éditeur de tableaux pour refaire le préréglage. Votre ancienne version n'est pas
  perdue — voir ci-dessous.

**On peut revenir en arrière.** Avant de remplacer quoi que ce soit, l'outil met de côté le
dossier entier de l'article, tel qu'il était. **« Annuler le réimport »** le remet en place —
et met à son tour de côté ce qu'il remplace, donc annuler l'annulation est possible aussi.

Ces sauvegardes s'accumulent dans le numéro et **ne se suppriment pas toutes seules** : elles
sont là pour vous rassurer, pas pour être gérées. Quand un numéro est publié et archivé, on
peut les effacer à la main ; chaque dossier porte un `LISEZ-MOI.txt` qui le dit.

## Les contrôles de la compilation

À chaque compilation — chaque **Ctrl + S**, chaque conversion de Word, chaque
recompilation complète — la chaîne relit ce qu'elle produit et relève ce qui ne va pas :
un appel de citation qui ne mène à aucune référence, un tableau sans rangée d'en-tête, une
image absente du disque, un titre vide dans la langue de l'article, un PDF qui ne tient
pas la promesse d'accessibilité. Jusqu'ici tout cela s'écrivait dans un terminal que rien
n'ouvrait.

Désormais, **quand il y a quelque chose à dire, cela se dit** :

- une **notification** apparaît en bas à droite, avec un bouton **« Voir les contrôles »** ;
- un **compteur reste dans la barre d'état**, en bas à gauche : `⚠ 3 à vérifier` ou
  `⛔ 1 à corriger`. Il survit à la notification, qui disparaît toute seule ; un clic
  dessus ouvre la page ;
- la page **« Contrôles de la compilation »** liste un point par carte. Elle s'ouvre aussi
  par **🚀 Commande → Contrôles de la compilation**.

[capture : la vue « Contrôles de la compilation », deux sections et une carte par point]

### Deux tons, et ils ne mentent pas

La page range les points en deux sections, dans l'ordre où il faut s'en occuper.

**« Ce qui empêche de publier »** — la compilation s'est arrêtée, ou elle a produit un
document qu'on ne peut pas publier en l'état : un article sans titre, une figure appelée
par le texte mais absente du disque, un PDF sorti sans balisage d'accessibilité. Tant
qu'un point est là, le numéro n'est pas prêt.

**« À regarder avant de publier »** — les documents sont sortis, ils sont publiables, et
il reste du travail d'édition : un appel de citation à lier, une référence que rien
n'appelle, un tableau à qui il manque sa rangée d'en-tête. Ce n'est pas un échec, et la
notification le dit sur le ton d'un avertissement, pas d'une erreur.

Une troisième section, **« Pour information »**, porte les chiffres : « 4 références,
3 appels, dont 1 lié ».

### Ce qu'une carte contient

Chaque carte nomme **l'article concerné**, la **nature du contrôle** (« Citations et
références », « Métadonnées et langue », « Accessibilité du PDF »…), et donne la phrase
entière : **ce qui s'est passé**, **le geste** qui corrige, et, quand cela bloque,
**pourquoi**. Le bouton **« Ouvrir »** mène droit à l'article en cause.

Les messages sont dans la langue de l'interface, et dans elle seule : le réglage de langue
(**🚀 Commande → Réglages SZH**) les fait basculer du français à l'allemand.

### Le journal reste sur le disque

La sortie complète de la dernière compilation est écrite dans le dossier du numéro, sous
`.szh-journal.log`. Le fichier est masqué dans l'explorateur — il n'y a pas à le lire, la
page dit ce qu'il contient d'utile. Il n'est utile qu'à un signalement : si un point de la
page paraît faux, joignez ce fichier au message.

## La vue « Articles » : l'ordre du numéro, l'avancement, la couverture

Cliquer l'**onglet « Articles »** de la barre ouvre une page pleine largeur — comme
« Traductions » et « Word en attente ». C'est là qu'on monte un numéro : l'ordre des
articles, ce qui reste à faire sur chacun, et les métadonnées du numéro, au même endroit
parce qu'on les regarde ensemble.

[capture : la vue « Articles », une carte par article avec ses cases à cocher]

### Les articles portent leur nom

Dans la barre comme dans la vue, un article s'appelle désormais **« 03 · Technologies au
service des apprentissages »** : les **deux chiffres** disent où il se situe dans le
numéro, et le titre vient de sa fiche. Le **nom du dossier** (`03-technologies-au-…`)
passe en petit à côté : c'est par lui qu'on retrouve l'article dans l'explorateur, ce
n'est plus lui qu'on lit.

Un article dont la fiche manque, ou dont le titre est vide, **reste visible** : son nom de
dossier s'affiche à la place du titre, et sa carte le signale en orange. Ce n'est pas un
détail de confort : la compilation refuse de partir sur un article sans titre, et il faut
le voir tout de suite.

### Changer l'ordre du numéro

Chaque carte porte **↑ Monter** et **↓ Descendre**. Un clic déplace l'article d'un cran,
les deux chiffres se renumérotent, et la barre latérale suit dans la seconde. Les boutons
s'atteignent au **Tab** et s'activent à l'**Entrée** : l'ordre se change entièrement au
clavier.

**Aucun dossier n'est renommé.** L'ordre est retenu dans `ausgabe.yaml`, sur une ligne
`ordre-articles`, à côté du titre et du volume du numéro. C'est ce qui permet de déplacer
un article sans invalider son PDF déjà compilé ni les liens du numéro — renommer un
dossier obligeait à tout recompiler.

Cette ligne se relit et se corrige à la main si besoin. Elle **se répare toute seule** :
un article déposé dans `articles/` hors de l'interface apparaît à la fin de la liste, un
article supprimé quitte l'ordre, et rien ne disparaît de la vue.

### Les tâches par article

Chaque carte porte une **liste de cases à cocher** — les étapes qui restent à faire sur
cet article. Le jeu de départ :

- version finale
- traductions terminées
- contraste et texte alternatif
- envoi de la version finale aux autrices et auteurs

Cocher écrit tout de suite, dans le dossier de l'article (`<article>.taches.yaml`). Ce
fichier n'est **ni publié ni exporté** : il ne décrit que l'avancement de l'atelier, et il
part avec l'article si on le déplace.

**L'avancement se lit sans ouvrir quoi que ce soit** : une pastille sur la carte
(« 2/4 tâches », verte quand tout est fait), et la même mesure dans la barre latérale, à
côté du nom du dossier.

Le bouton **« Tâches »** de la barre de la vue ouvre le réglage des **intitulés**. Deux
colonnes, français et allemand : un intitulé laissé vide dans une langue reprend l'autre.
Et **une liste par revue** — la *Revue* et la *Zeitschrift* ne suivent pas le même
processus, et ajouter une étape à l'une ne l'impose pas à l'autre. Ces intitulés décrivent
le processus d'une revue et non un numéro : ils valent pour **tous** ses numéros, et vivent
dans les réglages du poste, pas dans le dossier.

Corriger un intitulé ne décoche rien : c'est l'identifiant interne, et non le texte, qui
relie une case à son article. Retirer une tâche de la liste la retire de toutes les cartes,
et l'avancement se recompte sur ce que la revue demande aujourd'hui.

### Les métadonnées du numéro, dans la vue

Le bloc **« Méta-données du numéro »**, en haut de la vue, se déplie sur **exactement le
même formulaire** que la commande du même nom (**🚀 Commande → Méta-données du numéro**) :
mêmes champs, même enregistrement automatique, même fichier. Il n'y a qu'un formulaire du
numéro dans le logiciel ; on l'atteint par deux portes.

### La couverture du numéro

Sous les champs du numéro, une zone **« Couverture du numéro »**. On y **dépose** l'image
(glisser-déposer, ou *Choisir un fichier*), on la **voit** — cliquer l'aperçu l'agrandit —
et on la **remplace** en déposant la suivante.

C'est le fichier que l'**export OJS** cherche à la racine du numéro. Sans lui, le numéro
part sans image de couverture, et rien ne le disait : la zone affiche donc un avis orange
tant qu'aucune couverture n'est déposée.

**JPEG ou PNG, 12 Mo au maximum.** Le fichier est enregistré sous un nom fixe
(`couverture.jpg` ou `couverture.png`) : il n'y a jamais deux couvertures dans un numéro,
et l'export prend toujours celle qu'on vient de déposer.

## Envoyer un article à son auteur

Le bouton **« Envoyer à l'auteur »**, sur la carte de l'article dans la vue « Articles »
(ou par un clic droit sur l'article dans la barre), fait trois choses d'affilée :

1. il **compile le PDF** de l'article, pour que ce soit bien la version d'aujourd'hui qui
   partira ;
2. il **ouvre un brouillon d'e-mail** déjà adressé — les adresses viennent du champ
   *courriel* des auteur·e·s de la fiche — avec un sujet et un corps rédigés **dans la
   langue de l'article** ;
3. il met le **PDF dans le presse-papiers**, comme fichier.

Il ne reste qu'un geste : **Ctrl + V dans le message**, et le PDF s'y attache. Relisez,
ajoutez un mot, envoyez.

[capture : le brouillon ouvert, le PDF attaché après un Ctrl + V]

Pourquoi ce collage plutôt qu'une pièce jointe déjà en place : un lien `mailto:` — la seule
façon fiable d'ouvrir un brouillon dans le nouvel Outlook — **ne sait pas porter de pièce
jointe**. Les autres voies ont été essayées sur un poste de rédaction : le fichier `.eml`
déposé sur le disque porte bien la pièce jointe, mais Windows demande alors *avec quelle
application ouvrir ce fichier .eml*, propose les deux Outlook, et l'ancien démarre à froid
avec ses rappels dans un client qui n'est pas celui où l'on travaille. Un collage explicite
vaut mieux qu'une automatisation qui réussit un jour sur deux.

Si le presse-papiers est refusé par le poste, la notification le dit et propose
**« Ouvrir le dossier du PDF »** : il reste alors à glisser le fichier dans le message.

Une fiche sans adresse de courriel n'empêche rien : le brouillon s'ouvre sans
destinataire, et un avertissement nomme l'article concerné — il n'y a pas d'adresse
inventée.

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

## Régler l'export OJS (une fois par poste)

**Réglages SZH → « Export OJS »** (en allemand : *SZH-Einstellungen → « OJS-Export »*)
porte les valeurs qu'OJS attend. Elles ne se devinent pas, et c'est la raison d'être de ce
bloc : OJS reconnaît un genre de fichier, un groupe d'auteur et une rubrique **à leur
intitulé exact**. Un intitulé approximatif ne provoque aucune erreur visible — il **crée un
doublon** dans OJS, ou **range l'article ailleurs**. C'est pourquoi un champ obligatoire
laissé vide **arrête l'export** au lieu d'envoyer une valeur inventée : le message nomme le
champ, la revue concernée, et l'endroit d'OJS où aller le lire.

Les valeurs déjà relevées sur l'instance sont en place. Ce qui reste vide porte la mention
**« à relever dans OJS »** : ouvrez OJS, lisez la valeur, saisissez-la ici, **Enregistrer**.
C'est un réglage de poste, à faire **une fois** — il ne se refait pas à chaque numéro.

### Les valeurs propres à chaque revue

Ce bloc est **dédoublé** : une colonne pour la **Revue suisse de pédagogie spécialisée**,
une pour la **Schweizerische Zeitschrift für Heilpädagogik**. Ce sont deux revues distinctes
dans OJS, avec leurs propres intitulés — ne recopiez pas ceux de l'une dans l'autre.

| Champ | Où le lire dans OJS |
|---|---|
| **Genre de fichier** | Paramètres → Flux de travail → **Composants de la soumission** — le nom exact du composant |
| **Groupe d'auteur** | Paramètres → Utilisateurs et rôles → **Rôles** — le nom exact du rôle des auteurs |
| **Compte de téléversement** | Utilisateurs et rôles → **Utilisateurs** — le compte au nom duquel les fichiers sont déposés |
| **Pays des auteurs** | facultatif — voir plus bas |

Les **trois premiers sont obligatoires**. Vide, l'un d'eux arrête l'export avec un message
qui dit exactement où regarder, par exemple : *« Schweizerische Zeitschrift für
Heilpädagogik : « Genre de fichier » n'est pas renseigné. À relever dans OJS (OJS →
Paramètres → Flux de travail → Composants de la soumission : le nom exact du composant),
puis à saisir dans « Réglages SZH » → « Export OJS ». »*

### La table des rubriques

Une **rangée par rubrique d'OJS**, et la table s'**agrandit** : le bouton **« Ajouter une
rubrique »** en crée une, pour une rubrique qui n'existait pas encore sur l'instance.

| Colonne | Ce qu'elle veut |
|---|---|
| **Clé** | un nom court, **interne** au poste — il ne part **pas** dans l'XML, il sert seulement à relier la rubrique à un type d'article, dans le bloc suivant |
| **Abréviation** | ce sur quoi **OJS rattache l'article**. Elle doit être **exacte, majuscules comprises**, et elle diffère souvent d'une revue à l'autre (le dossier thématique est `DT` côté Revue et `TS` côté Zeitschrift) |
| **Titre** | l'intitulé affiché de la rubrique, dans la langue de la revue |
| **Résumé exigé** | cochée, un article de cette rubrique **doit** avoir un résumé, sinon l'export s'arrête |
| **DOI exigé** | cochée, un article de cette rubrique **doit** avoir un DOI |

Abréviation et titre se lisent dans **OJS → Paramètres → Revue → Rubriques**. Une rubrique
dont l'abréviation manque dans la revue visée arrête l'export dès qu'un article y est rangé
— c'est le cas d'« Annonces / *Inserate* », dont l'abréviation n'a jamais pu être relevée.

### La rubrique de chaque type d'article

Dernier bloc : le **type choisi dans la fiche d'un article** (Éditorial, Article, Varia,
Tribune libre, Documentation…) décide de sa rubrique OJS. Une rubrique que vous venez
d'ajouter n'apparaît dans l'export **qu'une fois désignée ici** par au moins un type. Un
type qui ne mène à aucune rubrique arrête l'export, en le disant.

### Le pays des auteurs : désormais vide, et c'est voulu

Jusqu'ici l'export écrivait **« CH » pour tout le monde**, sans que personne l'ait vérifié :
il affirmait le pays de chaque auteur·e à sa place. Ce n'est plus le cas. Le champ **« Pays
des auteurs »** part **vide**, la balise `<country>` est simplement **omise** de l'XML, et
l'export le mentionne en avertissement — il ne bloque pas : un auteur sans pays est
parfaitement valide dans OJS.

Si le pays doit repartir dans OJS, c'est un champ à remplir **une fois**, par revue : le
code **à deux lettres** (`CH`, `DE`, `FR`, `AT`, `IT`…). Une valeur qui n'en est pas un —
« Suisse », par exemple — est refusée et signalée, parce qu'OJS n'y verrait pas un pays. Ce
pays s'applique alors à **tous** les auteurs de l'export : il n'y a pas de pays par auteur·e
dans la fiche d'un article.

## La date de publication du numéro

Dans **Méta-données du numéro**, le champ **date** est la **date de publication** du
numéro : le jour où il paraît. Un numéro tout neuf l'a donc **vide**, et c'est normal —
personne ne connaît cette date le jour où le dossier est créé.

Cela ne vous empêche de rien : la couverture prend son **année** dans le **nom du dossier**
(un numéro rangé dans `2027-03` affiche « 03/2027 » dès le premier PDF), et tout se compile
comme d'habitude.

En revanche, l'**export OJS s'arrête** tant que la date n'est pas saisie, et le message dit
où aller : *« Ouvrez « Métadonnées du numéro » et donnez la date de publication. »* La
raison : le numéro part **publié** dans OJS ; sans date, il s'y publierait sans date de
publication et il faudrait la ressaisir **article par article** dans l'interface.

Le sélecteur de date du formulaire écrit la date complète. Elle doit être **entière**
(année, mois, jour) : une année seule est refusée exactement comme un champ vide — un champ
qui paraît rempli sans l'être est le pire des trois états. Et une fois saisie, c'est **elle**
qui fait foi partout, y compris pour l'année de la couverture.

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

## Les références

La liste de références reste **exactement telle que tu l'as écrite** : rien ne la déplace,
rien ne la reformate, ni la ponctuation ni l'ordre. La seule condition est que sa section
porte un titre reconnaissable — « Références », « Bibliographie », « Literatur »,
« Quellen »…

À la compilation, chaque appel du texte devient un **lien cliquable** vers son entrée, dans
le HTML comme dans le PDF. Les formes courantes sont reconnues d'elles-mêmes, en français
comme en allemand :

| dans le texte | ce qui devient cliquable |
|---|---|
| `(Bovey, 2022)` `(Boger 2019)` `(vgl. Kunz, 2016)` | la parenthèse entière |
| `Capurso et al. (2025)` `von Lütolf und Schaub (2021)` | l'année |
| `(Grimminger et al., 2021 ; Fisseler, 2023)` | chaque citation séparément |
| `(Pelgrims, 2001, 2006)` | chaque année séparément |
| `(UNESCO, 2009)` `(OFS, s.d.)` | le sigle, s'il figure entre crochets dans la référence |

**Ce qui n'a pas pu être lié t'est signalé.** Dans l'aperçu, l'appel est souligné en
pointillé ; le panneau de compilation en donne la liste, avec deux autres avertissements
utiles : une **référence jamais citée** dans le texte, et un appel **ambigu** entre deux
références du même auteur et de la même année.

**Pour lier à la main** : place le curseur dans l'appel (ou sélectionne-le), `Ctrl+Alt+S`,
**« Lier un appel à une référence »**, choisis l'entrée dans la liste. C'est aussi la
manœuvre pour corriger un lien qui pointe vers la mauvaise entrée. Si tu modifies ensuite le
texte de la référence, refais l'opération : le lien suit le contenu de l'entrée.

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
  l'article, et le gestionnaire des médias s'ouvre **sur cette image** pour qu'il ne
  reste qu'à écrire la légende. À la composition, la légende (« Figure 1 — … »,
  numérotée toute seule) est placée **au-dessus** de l'image, comme celle d'un
  tableau — quel que soit l'endroit où elle est écrite dans le texte ;
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
« Revue SZH » affiche aussitôt (`R2027-05`), et que la couverture imprime (« 05/2027 »). Le titre
du dossier thématique, lui, reste **vide** : c'est à vous de le remplir dans **Méta-données du
numéro**. La **date de publication** aussi reste vide — elle se saisit le jour où la parution est
décidée (voir « La date de publication du numéro »).

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
