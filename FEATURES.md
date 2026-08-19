=> Panneau de commande (raccourci CTRL+ALT+A) : Aperçu HTML / PDF, éditer méta données revue, éditer méta donnée articles, règlage de l'application, 

=> Editions autriceet auteur : modifier la croix en "poubelle", ajouter une icone "photo" pour éditer la photo de l'autrice / auteur. Champ drag and drop pour déposer la photo d'une autrice ou d'auteur. Option pour choisir "original / avec ou sans background" + aperçu de l'image. 
Tu vas devoir stocker 3 images, l'original, la version avec background, la version sans background. 

=> Ouverture métadonnées articles / auteurs : en pleine page fermer tout aperçu ouverts, idem à l'édition de tableaux 

=> Supprimer le bouton "Rafrachir Revue"

J'aimerai que tu améliore le convertisseur HTML. 

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
=> Demander de fournir les photos de auteurs (originaux)
=> Demander de fournir les originaux de chaque image 

=> Parsing des images des autrices et auteurs 


=> Export OJS 