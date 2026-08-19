Voici une liste de features à implémenter. Planifie l'implémentation que tu délgèuera a plusieurs agents 


# F1
=> Panneau de commande (raccourci CTRL+ALT+A) : Importer un word, éditer méta données revue, éditer méta donnée articles, règlage de l'application (Règlage SZH), 
=> Panneau d'édition (raccourci CTRL+ALT+S) : Aperçu HTML / PDF, et les autres raccourcis existants
=> Panneau d'export (raccourci CTRL+ALT+D) : Recompiler toute la revue 

=> Supprimer le bouton "Rafrachir Revue"

# F2
=> Word en attente, accepeter du Drag and Drop est-ce possible ? 

# F3
=> Editions autriceet auteur : modifier la croix en "poubelle", ajouter une icone "photo" pour éditer la photo de l'autrice / auteur. 
Cette icone photo ouvre un formulaire (type modal) qui contient : Champ drag and drop pour déposer la photo d'une autrice ou d'auteur + un radio permettant de choisir "original"  "avec background" ou "sans background" + aperçu de l'image. 
Tu vas devoir stocker 3 images, l'original, la version avec background, la version sans background. 
# F4 
Au drag and drop de photos, implémente une edition automatique de l'image. le script DeleteBackground.py est le script que nous utilisions pour réaliser cette tâche, les fonctionnalités sont les suivantes : 
a) détection du visage recentrement de l'image pour que le visage soit au centre et utilise X% de l'espace 
b) suppression du background avec rembg 
c) passage en noir et blanc et crop à Y x Y pixel 

1) Réutilise les mêmes dimensions en sortie et le meme noir et blanc
2) pour le reste des fonctionnalités audit les et améliore les
3) améliore explicitement la fontionnalité de recadrage, nous avons un problème lorsque l'image de l'auteur est trop "centrée" ou "zoomée" dans ces cas nnous ajoutions du blanc autour de l'image pour permettre au script de fonctionner et donner un résultat uniforme. 
4) tout doit fonctionner en local (dans la WSL), le plus rapidement possible.

# F5
=> Ouverture métadonnées articles / auteurs : fait que tout aperçu ouverts se ferme, idem à l'édition de tableaux ainsi l'édition / modification se fait en pleine page


# F6
J'aimerai que tu améliore le convertisseur DOCX. 

Dans le dossier 
C:\Users\robin\prog\szh-publishing-toolchain\tmp\docx-dev
Tu trouveras les fichiers typqiues que nous passerons dans le convertisseur. 
Je souhaite que tu détecte (avec mécanisme de fallback si les styles ne sont pas bien défini )
1) Titre de l'article et sous-titre 
2) Résumés, mots clés et DOI 
3) Corps du texte et les niveaux de titre
4) Tous les tableaux et images / Figures (à wrapper correctement)
5) Bibliographie 
6) Le tableau des auteurs, je ne veux pas que ce soit un tableau mais purement importé dans le métadonnée. 

Dialogue import docx 
=> Demander de vérifier les métadonnées et les afficher 
=> Demander de fournir les photos de auteurs (originaux) avec un drag and drop 
=> Demander de fournir les originaux de chaque image avec un drag and drop 

=> Parsing des images des autrices et auteurs automatiquement avec le script de F4

# F7
J'aimerai pouvoir exporter directement une revue entière en XML natif avec tous les fichiers et asssets encodé en base64 pour exporter et importer en un click. Un fichier xml d'exmeple se trouve ici : native-20260819-054712-issues-5.xml


Analyse le tout, planifie et une fois planifié pose moi les questions nécessaires