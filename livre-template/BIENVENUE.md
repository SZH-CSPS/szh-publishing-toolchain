# Bienvenue 👋

Cet espace sert à **mettre en page un livre**. Tu n'as **rien à installer ni à
configurer** : tout est déjà prêt. Tu écris, tu enregistres, le **PDF de l'ouvrage entier
se fabrique tout seul**.

Ce dossier a été créé par le lanceur **« Books SZH-CSPS »** du menu Démarrer, et
« Ouvrir le livre » (dans ce dossier) permet de le retrouver plus tard.

---

## L'ordre à suivre

### 1️⃣ Écrire les chapitres
Chaque chapitre est un dossier sous **`chapitres`**, sur le modèle de **`01-exemple`** déjà
présent : un fichier `.md` qui porte le nom du dossier, et dedans, un titre de niveau 1
(`#`) qui devient le titre du chapitre. Numérote les dossiers (`01-…`, `02-…`) : c'est cet
ordre-là qui décide de celui du livre.

Pour mettre en forme, sélectionne du texte puis fais **clic droit → « Mise en forme »**
(ou les raccourcis : `Ctrl+B` gras, `Ctrl+I` italique, `Ctrl+Alt+1/2/3` pour les titres).

⚠ Le dossier **`chapitres-word`** existe pour l'import de chapitres Word, mais ce geste
n'est pas encore automatique pour un livre (il l'est déjà pour une revue) — voir son
propre LISEZ-MOI. En attendant, écris directement dans `chapitres`.

### 2️⃣ Renseigner les métadonnées de l'ouvrage
Il n'existe pas encore de formulaire dédié dans l'éditeur pour cela : le titre, le
sous-titre, la langue, la maquette, la collection, l'ISBN, le DOI… se corrigent à la main
dans **`buch.yaml`**, à la racine de ce dossier. Chaque champ y est expliqué en
commentaire.

Pour un **ouvrage collectif** (plusieurs auteur·e·s selon le chapitre), chaque chapitre
porte les siens dans sa propre fiche (`<nom-du-chapitre>.meta.yaml`, à côté de son `.md`)
— regarde celle de `01-exemple`. Pour une **monographie**, les auteur·e·s se saisissent
une fois, dans `buch.yaml` (`auteurs:`).

### 3️⃣ Enregistrer
Appuie sur **Ctrl + S**. Le livre entier est recompilé : tous les chapitres, les pièces
liminaires (dossier **`liminaires`**), le sommaire. Les sorties sont rangées dans le
dossier **`out`**. Pour tout régénérer d'un coup, la commande **« Tout exporter »** fait
de même en repartant de zéro.

---

## Ce que contient ce dossier

| Dossier / fichier | À quoi ça sert |
|---|---|
| `buch.yaml` | Métadonnées de l'ouvrage — voir ses commentaires |
| `chapitres/` | Un dossier par chapitre, chacun avec son `.md` |
| `chapitres-word/` | Dépôt prévu pour les chapitres Word — voir son LISEZ-MOI |
| `liminaires/` | Les pièces liminaires écrites à la main (avant-propos…) |
| `couverture/` | Le texte de quatrième de couverture (`quatrieme.md`) |
| `out/` | Les sorties : PDF, HTML — régénérées à chaque enregistrement |
| `Ouvrir le livre.lnk` | Rouvre ce livre dans l'éditeur, même après un déplacement |

---

## Raccourcis clavier utiles

| Raccourci | Effet |
|---|---|
| **Ctrl + S** | Enregistrer – le PDF de l'ouvrage se régénère |
| **Ctrl + B** / **Ctrl + I** | **Gras** / *italique* |
| **Ctrl + Alt + 1 / 2 / 3** | Titre de niveau 1 / 2 / 3 |
| **Ctrl + Espace** | Afficher les suggestions (p. ex. après `:::`) |
| **Ctrl + E** | Relancer la compilation sans rien modifier |

## Astuces
- Le texte est sauvegardé tout seul après une courte pause ; **Ctrl + S** force la mise à
  jour du PDF.
- L'**ordre des chapitres** suit l'ordre des dossiers dans `chapitres` — renomme-les au
  besoin (`01-…`, `02-…`).
- Pour **rouvrir** ce livre plus tard : raccourci **« Ouvrir le livre »** dans ce dossier,
  ou **« Books SZH-CSPS »** dans le menu Démarrer.

Bonne écriture ! ✨
