# Documentation utilisateur — poste de rédaction SZH

> Réglages et gestes utiles sur un poste **déjà installé**. Public : équipe de rédaction /
> référent du poste. (L'installation d'un poste est décrite dans le [README](README.md), section Runbook.)

## Ouvrir les fichiers `.md` avec l'éditeur de la revue (une fois par poste)

Objectif : double-cliquer un fichier `.md` (article) dans l'Explorateur ou OneDrive
l'ouvre dans **VSCodium**, l'éditeur de la revue.

Windows protège le choix de l'application par défaut : il doit être **confirmé une fois
par l'utilisateur** — aucun script ne peut le faire proprement à sa place, c'est un
mécanisme de sécurité voulu par Microsoft (décision D18, `PLANIFICATION.md`).

1. **Clic droit** sur n'importe quel fichier `.md` → **Ouvrir avec** → **Choisir une autre application**.
2. Sélectionner **VSCodium** (si absent : « Plus d'applications ↓ » et chercher dans la liste).
3. Cocher **« Toujours utiliser cette application pour ouvrir les fichiers .md »** → **OK**.

Le réglage est mémorisé pour cet utilisateur, sur ce poste. À refaire une seule fois
par personne et par poste.

### Limite actuelle (bon à savoir)

Le double-clic ouvre pour l'instant le fichier **seul**, sans le dossier de la revue :
l'aperçu PDF et la régénération automatique ne sont alors **pas actifs**. Pour travailler,
l'entrée normale reste :

- **« Ouvrir la revue »** — le raccourci présent dans le dossier de chaque revue ;
- **« Revues SZH »** — dans le menu Démarrer (liste toutes les revues du poste).

Le double-clic sur un `.md` sert donc à la **consultation rapide**. Une évolution prévue
(« lanceur intelligent », phase P6 de `PLANIFICATION.md`) fera qu'à terme le double-clic
ouvrira automatiquement toute la revue (éditeur + aperçu PDF à jour).

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
    Word d'origine ; **clic** = ouvrir le tableau pour le **modifier directement** ;
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
  titre, sous-titre, auteur(s) (nom, affiliation, ORCID), DOI, mots-clés. Seuls les
  articles modifiés (●) sont réécrits à l'enregistrement.
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

## Créer une nouvelle revue

Menu Démarrer → **« Revues SZH »** → bouton **« Nouvelle revue… »** (en bas à gauche) :
choisir l'emplacement (le dossier `OneDrive\Revues` est proposé), donner un nom (p. ex.
`2026-02`), et la revue s'ouvre toute prête — dossiers `articles-word` et `articles`,
raccourci « Ouvrir la revue » inclus. Elle apparaîtra ensuite dans la liste du lanceur
comme les autres.
