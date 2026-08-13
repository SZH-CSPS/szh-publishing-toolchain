# Bienvenue 👋

Cet espace sert à **mettre en page la revue**. Tu n'as **rien à installer ni à configurer** :
tout est déjà prêt. Tu écris, tu enregistres, le **PDF se fabrique tout seul**.

Tout se pilote depuis **une seule barre à gauche : « Revue SZH »** (son titre affiche le
numéro en cours). Pas besoin de l'explorateur de fichiers.

---

## L'ordre à suivre (4 étapes)

### 1️⃣ Déposer les articles Word
Glisse les fichiers **Word (`.docx`) finalisés** dans le dossier **`articles-word`**, puis, dans
la barre « Revue SZH », clique **▶▶ Convertir les Word en attente**.
Chaque article devient un dossier de travail dans **`articles`** — texte, images et **tableaux
fidèles** (fusions de cellules comprises). Une fois converti, le Word disparaît d'`articles-word` :
le texte de travail devient l'**unique version**.

### 2️⃣ Renseigner les métadonnées
- **⚙ Métadonnées du numéro** : le **nom de la revue**, le **volume/numéro**, la **couleur** de
  l'année, le **titre du dossier thématique**. À faire **une fois** par numéro.
- **☰ Métadonnées des articles** : pour **chaque** article, le **titre**, le **sous-titre**, les
  **auteurs**, le **DOI**, les **mots-clés** et le **type** (article, éditorial, varia…), en
  **français et allemand** (l'italien s'ajoute à la demande). **Rien de tout cela ne s'écrit dans
  le texte** — le formulaire s'en occupe, et la couverture se remplit automatiquement.

### 3️⃣ Écrire et mettre en forme
**Clique un article** dans la barre : son texte s'ouvre à gauche, son aperçu PDF à droite.
Pour appliquer un style de la revue (encadré, citation en exergue, mise en évidence…), tape
**`:::`** puis le début du nom, ou appuie sur **Ctrl + Alt + S** pour voir la liste.
Les titres se font avec **Ctrl + Alt + 1 / 2 / 3**, le gras/italique avec **Ctrl + B / Ctrl + I**.

### 4️⃣ Enregistrer
Appuie sur **Ctrl + S**. L'article est compilé et **son aperçu PDF s'ouvre/se met à jour tout
seul** à droite. Les sorties sont rangées dans le dossier **`out`** (un sous-dossier par article,
PDF + version web). Pour tout régénérer d'un coup : **⬆ Tout exporter**.

---

## La barre « Revue SZH » en détail

| Élément | À quoi ça sert |
|---|---|
| **Titre de la barre** | Le numéro en cours (repère) |
| **➕ Importer** | Ajouter un/des Word à convertir |
| **▶▶ Convertir les Word en attente** | Transformer les Word déposés en articles Markdown |
| **⚙ Métadonnées du numéro** | Réglages du numéro (revue, volume, couleur, dossier) — 1× |
| **☰ Métadonnées des articles** | Fiche par article (titre, auteurs, DOI, mots-clés, type) |
| **⬆ Tout exporter** | Recompiler tous les articles (utile avant l'envoi final) |
| **🗑 Supprimer l'article** | Retirer un article (avec confirmation) |
| Section **Articles** | La liste de tes articles — **un clic** ouvre et affiche l'aperçu |
| Section **Word en attente (n)** | Les Word déposés pas encore convertis |
| Sous un article (déplié) | Ses **images** (dimensions + poids) et ses **tableaux** — chacun avec **Remplacer** (même nom conservé) |

---

## Raccourcis clavier utiles

| Raccourci | Effet |
|---|---|
| **Ctrl + S** | Enregistrer — le PDF de l'article se régénère |
| **Ctrl + B** / **Ctrl + I** | **Gras** / *italique* |
| **Ctrl + Alt + 1 / 2 / 3** | Titre de niveau 1 / 2 / 3 |
| **Ctrl + Alt + S** | Palette « Mise en forme SZH » (encadrés, exergue, figure, tableau…) |
| **Entrée** (dans une liste) | La liste continue toute seule |
| **Tab** / **Maj + Tab** (dans un tableau) | Cellule suivante / précédente (mise en forme auto) |
| **Maj + Alt + V** | Coller un tableau copié depuis **Excel ou Word** |
| **Ctrl + Espace** | Afficher les suggestions (p. ex. après `:::`) |
| **Ctrl + Alt + I** | Importer les Word déposés dans `articles-word` |
| **Ctrl + E** | Relancer la compilation sans rien modifier |
| **Ctrl + Alt + R** | Secours : recharger la fenêtre si l'aperçu semble figé |

## Astuces
- Le texte est sauvegardé tout seul après une courte pause ; **Ctrl + S** force la mise à jour du PDF.
- Un Word déposé après coup : il suffit d'enregistrer (**Ctrl + S**) pour l'intégrer.
- L'**ordre des articles** suit l'ordre des fichiers dans `articles` — renomme-les au besoin (`01-…`, `02-…`).
- Pour rédiger en **allemand**, nomme le fichier `….de.md` (la correction passe en allemand).
- Pour **rouvrir** une revue plus tard : raccourci **« Ouvrir la revue »** dans le dossier, ou
  **« Revues SZH »** dans le menu Démarrer.

Bonne mise en page ! ✨
