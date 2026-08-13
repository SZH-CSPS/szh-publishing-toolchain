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

[capture : la barre « Revue SZH » avec ses deux sections]

Elle a **deux sections** :

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
    sont préservés ; **clic** = ouvrir le tableau pour le **modifier directement** ;
    **Remplacer** au survol l'échange contre un autre fichier HTML, même nom conservé.
    La modification apparaît à la compilation suivante (Ctrl + S ou re-clic).
- **Word en attente (n)** — les fichiers Word déposés mais pas encore convertis ; le
  nombre entre parenthèses est le compte. Un ⚠ « déjà converti » signale un Word dont
  l'article existe déjà (renommer le fichier si c'est une nouvelle version).
  Après une conversion réussie, le fichier Word **disparaît de ce dossier** : l'article
  (`.md`) devient l'unique copie de travail — c'est voulu, plus de doublons.

Le **titre de la barre** affiche le numéro en cours (p. ex. « R2026-2 | Autodétermination »),
mis à jour dès que les méta-données changent. En haut de la barre, cinq boutons :

- **➕ Importer des Word** — ouvre un sélecteur pour **choisir des `.docx` sur le disque** ;
  ils sont copiés dans la revue puis convertis.
- **⚙ Méta-données du numéro** — un petit formulaire (titre du dossier, nom de la revue,
  volume, numéro, date, langue) ; **Enregistrer** met à jour la revue sans rien toucher
  d'autre. Aucun fichier technique à ouvrir.
- **⬆ Tout exporter** — régénère **tous** les PDF de la revue, même ceux à jour
  (utile avant une livraison : tout est reconstruit proprement d'un coup).
- **☰ Métadonnées des articles** — un formulaire qui liste **tous les articles** :
  **type d'article** (menu déroulant, libellés dans la langue de la revue), titre,
  sous-titre, **résumé** et mots-clés **en français et en allemand** (case « + Italien »
  pour ajouter l'italien à un article), auteur(s) (prénom, nom, fonction, affiliation,
  ORCID) et DOI. Le **résumé** (abrégé) se saisit ici — jamais dans le texte de l'article. Seuls les articles modifiés (●) sont réécrits à l'enregistrement.
  Ces informations vivent dans une **fiche cachée** à côté de l'article (invisible
  dans l'explorateur) — le texte de l'article n'est jamais touché, et la fiche ne
  s'édite **que** par ce formulaire.
- **⟳ Rafraîchir** — recharge la liste (utile si OneDrive a tardé à synchroniser).

À l'ouverture d'une revue, l'environnement de compilation démarre en arrière-plan et
reste prêt : la première compilation n'a plus de temps de chauffe.

Et sur la section « Word en attente », un bouton :

- **▶▶ Convertir les Word en attente** — convertit **d'un clic** tous les Word déjà
  déposés dans le dossier (le cas le plus courant : on glisse les Word dans la revue via
  OneDrive, puis on clique ici).

[capture : la barre avec son titre « R2026-2 | … » et les cinq boutons]
[capture : la section « Word en attente (2) » avec le bouton « Convertir »]
[capture : le formulaire « Méta-données du numéro »]
[capture : le formulaire « Métadonnées des articles » (cartes par article)]
[capture : un article déplié montrant images et tableaux, boutons « Remplacer »]

### Le geste type

1. Glisser les `.docx` finalisés dans le dossier **articles-word** de la revue (ou via **➕**).
2. Dans la barre « Revue », cliquer **▶▶ Convertir les Word en attente** → une notification
   « N article(s) importé(s) » confirme (les `.docx` convertis sont retirés du dossier).
3. **Cliquer un article** : son texte s'ouvre à gauche et son PDF apparaît à droite
   (compilé au passage si nécessaire). Ensuite, chaque **Ctrl + S** régénère l'aperçu.

## Mettre en forme le texte

Pas besoin de connaître le Markdown : **sélectionne du texte, puis clic droit →
« Mise en forme »**. Le sous-menu propose (chaque raccourci y est rappelé) :

- **Gras**, **Italique**, **Souligné** (`Ctrl+B`, `Ctrl+I`, `Ctrl+U`) ;
- **Titre 1 / 2 / 3** (`Ctrl+Alt+1/2/3`) ;
- les blocs de la maquette — **Important**, **Mise en évidence**, **Question**
  (`Ctrl+Alt+W / H / Q`) et **Citation** (`Ctrl+Alt+C`). Le bloc « Important »
  demande un **titre** (Information, Attention, Note… ou un titre libre) ;
- **Insérer une figure** (`Ctrl+Alt+F`) : choisis une image ; elle est copiée dans
  l'article et il ne reste qu'à écrire la légende ;
- **Insérer un tableau** (`Ctrl+Alt+T`) : un petit tableau vierge à remplir (`Tab`
  passe d'une cellule à l'autre) ;
- **Coller un tableau depuis Excel/Word** (`Maj+Alt+V`) : copie les cellules dans
  Excel ou Word, puis `Maj+Alt+V` dans l'article — le tableau est écrit en Markdown.

Appliquer deux fois gras, italique, souligné, un titre ou une citation **retire** la
mise en forme (bascule).

## Créer une nouvelle revue

Menu Démarrer → **« Revues SZH »** → bouton **« Nouvelle revue… »** (en bas à gauche) :
choisir l'emplacement (le dossier `OneDrive\Revues` est proposé), donner un nom (p. ex.
`2026-02`), et la revue s'ouvre toute prête — dossiers `articles-word` et `articles`,
raccourci « Ouvrir la revue » inclus. Elle apparaîtra ensuite dans la liste du lanceur
comme les autres.
