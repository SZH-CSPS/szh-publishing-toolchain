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
