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

Quand tu ouvres une revue, une barre **« Revue SZH »** apparaît dans le panneau de
gauche (l'Explorateur). Elle regroupe tout le travail courant, sans toucher aux
fichiers ni au terminal.

[capture : la barre « Revue SZH » avec ses deux sections]

Elle a **deux sections** :

- **Articles** — un article par ligne. **Clic** = ouvrir le texte (à gauche).
  Au survol d'un article, deux boutons apparaissent à droite :
  - **👁 Ouvrir le PDF** — affiche l'aperçu à droite (le compile d'abord s'il n'existe
    pas encore) ;
  - **▷ Compiler** — régénère le PDF.
- **Word en attente (n)** — les fichiers Word déposés mais pas encore convertis ; le
  nombre entre parenthèses est le compte. Un ⚠ « déjà converti » signale un Word dont
  l'article existe déjà (renomme le fichier si c'est une nouvelle version).

En haut de la barre, deux boutons :

- **➕ Importer des Word** — ouvre un sélecteur pour **choisir des `.docx` sur le disque** ;
  ils sont copiés dans la revue puis convertis.
- **⟳ Rafraîchir** — recharge la liste (utile si OneDrive a tardé à synchroniser).

Et sur la section « Word en attente », un bouton :

- **▶▶ Convertir les Word en attente** — convertit **d'un clic** tous les Word déjà
  déposés dans le dossier (le cas le plus courant : on glisse les Word dans la revue via
  OneDrive, puis on clique ici).

[capture : survol d'un article montrant « Ouvrir le PDF » et « Compiler »]
[capture : la section « Word en attente (2) » avec le bouton « Convertir »]

### Le geste type

1. Glisser les `.docx` finalisés dans le dossier **articles-word** de la revue (ou via **➕**).
2. Dans la barre « Revue », cliquer **▶▶ Convertir les Word en attente** → une notification
   « N article(s) importé(s) » confirme.
3. Cliquer un article, puis **👁** pour voir son PDF à droite. Ensuite, chaque **Ctrl + S**
   régénère l'aperçu.
