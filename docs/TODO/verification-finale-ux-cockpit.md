# Vérification finale : UX du cockpit (lundi 05.10.2026)

Ce qui a été livré les 1er et 2 octobre 2026 (fusion `4cc47d5`) a passé la suite exigeante, le banc de rendu et veraPDF. Rien n'a encore été essayé dans VSCodium. Cette liste en tient lieu.

À faire dans **Pronto (dev)**, sur un numéro de test. Avant de commencer, vérifier que la jonction `C:\ProgramData\SZH-dev\toolkit` pointe bien sur l'arbre principal et non sur un worktree.

## Import

- [ ] **Bouton ＋ de la barre Pronto**
  - Il ouvre le choix des Word, puis la vérification de l'import.
  - Sur un numéro verrouillé, le bouton est absent.
- [ ] **Ctrl+Alt+I**, avec un Word posé dans `articles-word/` par l'Explorateur.
  - L'import passe par le cockpit : ordre tiré du numéro du Word, préfixe du dossier, vérification de l'import.
- [ ] **Ctrl+S**, avec un Word posé dans `articles-word/` par l'Explorateur.
  - Même suite que l'import guidé : préfixe, vérification de l'import.
  - Une seule recompilation, et seulement si un dossier a été renommé.
- [ ] **Ouverture du numéro avec un Word en attente** (`runOn: folderOpen`).
  - Noter si la suite de l'import se fait. Elle n'a pas été mesurée : la tâche peut démarrer avant l'extension.
- [ ] **Le Word corrigé redéposé sous le même nom**
  - Le message « Ce Word corrige l'article « … ». Le réimporter ? » s'affiche.
  - Ensuite : Réimporter, une seule confirmation, et l'article s'ouvre.
- [ ] **Le Word corrigé renommé par l'auteur** (par exemple `…_corrige.docx`)
  - La question « Version corrigée de cet article / Nouvel article » s'affiche.
  - Avec « Version corrigée », il n'y a pas de doublon, et le réimport demande sa confirmation.
  - Après le geste, le dossier `articles-word/.szh-ecartes/` doit être vide ou absent.
- [ ] **Clic droit sur un article → « Réimporter… » sans Word en attente**
  - Le message « Déposez le Word corrigé sur la barre « Pronto »… » s'affiche.
- [ ] **Clic droit → « Revenir au texte d'avant de cet article »** après un réimport.

## Correction

- [ ] **Aperçu HTML d'un long article**
  - Faire défiler au milieu, taper, attendre la recompilation : l'aperçu reste au même endroit.
- [ ] **Ctrl+Alt+F (figure)**
  - Dans Médias, « Légende » est sélectionnée : la première frappe la remplace.
- [ ] **Ctrl+Alt+S → « Éditer le tableau sous le curseur »**
  - Le curseur dans un bloc `szh-tabelle` ouvre le bon tableau.
  - Ailleurs, un message dit quoi faire.
- [ ] **Ctrl+Alt+L, ou clic droit → Lier une référence**
  - Le curseur sur un nom d'auteur suffit : le lien couvre toute la parenthèse.
- [ ] **Ctrl+Alt+N (note de bas de page)**
  - Le message d'état rappelle Alt+←, et Alt+← ramène bien au texte.
- [ ] **Métadonnées d'un article**
  - Le bouton « ← Retour à l'article » ramène au texte.
  - S'il reste une saisie non enregistrée, le cockpit la signale.

## Contrôles et accessibilité

- [ ] **Une image appelée mais absente du disque**
  - Un cadre « Image introuvable : nom » apparaît dans l'aperçu et dans le PDF.
  - La carte est un avertissement.
  - L'export OJS et l'archivage sont refusés.
  - Refaire en allemand : « Bild nicht gefunden ».
- [ ] **Une figure sans texte alternatif**
  - Le même compte et la même couleur dans la vue, la barre d'état, l'arbre et la notification.
- [ ] **Avis PDF/UA**
  - Après un verdict avec de nouveaux bloquants, une seule notification avec « Voir ».
  - Pas de seconde notification si l'on recompile sans rien corriger.
- [ ] **Règle 7.4.2-1 (titre qui saute un niveau)**
  - La carte place le curseur sur le titre fautif.
- [ ] **Carte d'un article dans les Contrôles**
  - Elle porte le nom de l'article et le bouton « Recompiler cet article ».

## Échec de compilation inconnu

Pour le provoquer sans toucher au toolkit de production : dans l'instance de dev, introduire une erreur de syntaxe dans un filtre Lua, puis l'annuler après l'essai.

- [ ] **Notification rouge**
  - Elle dit « Le PDF n'a pas pu être produit à cause d'une erreur inconnue… ».
  - Elle porte deux boutons, « Voir les contrôles » et « Contacter le support ».
- [ ] **« Contacter le support »** (depuis la notification, puis depuis la carte)
  - Un brouillon s'ouvre, adressé à robin.morand@szh.ch, sans copie.
  - Il contient le poste, le numéro, le contrôle et le chemin du rapport `.json`.
  - Il ne contient aucun texte d'article.
- [ ] **Le fichier du rapport** existe bien à ce chemin, dans le dossier partagé.
- [ ] **Le détail de la carte** (bouton (i))
  - Les 8 dernières lignes du journal s'affichent une par ligne, et non collées en un seul paragraphe (règle `white-space: pre-line`).
  - Vérifier qu'aucune autre carte n'a changé d'allure.

## Vue Articles et navigation

- [ ] **Les boutons « Paginer » et « Exporter pour OJS »**
  - Ils sont présents hors du mode ordre.
  - « Paginer » est absent sur un numéro verrouillé.
- [ ] **Panneau Export (Ctrl+Alt+D)**
  - Il contient « Rafraîchir la pagination ».
- [ ] **Panneau Commande (Ctrl+Alt+A)**
  - Il contient « Quoi de neuf ».
- [ ] **Vocabulaire** dans l'interface, en fr puis en de :
  - la barre s'appelle « Pronto », y compris dans la catégorie de la palette (Ctrl+Maj+P) ;
  - « Contrôles » / « Prüfungen » ;
  - « Tout recompiler » ;
  - « Exporter le numéro pour OJS » ;
  - « Métadonnées du numéro » ;
  - « Archiver et verrouiller le numéro ».
- [ ] **Le tutoriel**
  - Son lien « Afficher la barre latérale » révèle la barre.
  - L'étape d'import se coche par le bouton ＋.

## Ouvrir avec l'application du système (chemins accentués)

Un fichier ou un dossier dont le chemin porte un accent ou un espace doit s'ouvrir, sans le message « Failed to open… (0x2) ».

- [ ] **Feuille de vérification des métadonnées** (vue Articles → Vérifier les métadonnées).
- [ ] **Paramètres → dossier des suggestions** de l'interface.
- [ ] **Préprocessing → Ouvrir le document / Revoir le rapport.** Ces deux gestes sont rebranchés sur `lib/ouvrir-systeme.js` par la session de la bascule « accueil ». Les vérifier après sa fusion.

## Préprocessing : sortie dans Exports\Préprocessing

- [ ] **Choisir un manuscrit…, en mode test**
  - La sortie apparaît dans `<racine de test>\Exports\Préprocessing\<manuscrit>\` : la copie, le document nettoyé et le rapport.
  - « Afficher dans le dossier » ouvre ce dossier ; « Ouvrir le document » et « Revoir le rapport » ouvrent ses fichiers.
  - Rien n'est écrit à côté de l'original, ni sur le Bureau.
- [ ] **Choisir un manuscrit…, en production** : la sortie apparaît dans `Exports\Préprocessing\<manuscrit>\` de la racine de production, à côté des sorties du Secrétariat.
- [ ] **Partage de production absent** (poste hors ligne, bibliothèque non synchronisée) : le nettoyage ne part pas, l'onglet dit que le dossier de sortie n'a pas pu être créé, et aucun dossier `Exports` n'apparaît ailleurs.
- [ ] **Le même manuscrit une seconde fois** : le passage va dans « <manuscrit> (2) ».
- [ ] **Glisser un .docx depuis l'Explorateur en maintenant Maj** : le nettoyage part, et la zone dit bien de maintenir Maj.
- [ ] **Glisser une pièce jointe depuis Outlook en maintenant Maj** : noter si ça marche, ce n'est pas mesuré.

## Copies en conflit (OneDrive)

- [ ] **« Comparer les deux versions »** : le message « Trancher … d’un coup ? » propose « Garder ma version » et « Prendre celle de la copie », avec chacun sa confirmation ; la copie disparaît ensuite.

- [ ] **Créer à la main `ausgabe - copie en conflit.yaml`** à côté d'`ausgabe.yaml`, avec une ligne différente.
  - Un repère de marge apparaît dans `ausgabe.yaml`.
  - Cliquer le repère ouvre la divergence, avec les boutons « Prendre cette version » et « Garder la mienne ».
  - Quand plus rien ne diverge, l'outil propose de supprimer la copie.
  - Sans copie en conflit, aucun repère ne s'affiche dans la marge.

## Laissés tels quels (décision de Robin, 02.10.2026)

- **Les règles PDF/UA qui relèvent de la chaîne** n'ont pas de bouton « Contacter le support ». Le cockpit ne sait pas lesquelles c'est sans un marqueur ajouté par `pipeline/rapport-ua.py`.
- **Le cadre « Image introuvable » a trois limites connues :**
  - une grille dont toutes les images manquent garde sa légende numérotée ;
  - une figure remplacée décale la numérotation des suivantes dans l'épreuve ;
  - l'italien reçoit le libellé français.
