# Ce qui reste à faire

Ce fichier ne contient que ce qui reste à vérifier ou à trancher : rien de ce qui est déjà fait.
On coche une case quand le résultat annoncé a été constaté, puis on la supprime.

N'y figure que le critique : ce qui peut perdre des données, casser la production, rendre non
conforme un document publié, ou laisser sans preuve une promesse de la chaîne. Les vérifications
d'ergonomie, les relectures de libellés et les arbitrages esthétiques ont été retirés le
23.09.2026 ; ils restent lisibles dans l'historique git de ce fichier.

## Recompiler à l'identique

- [ ] Aller-retour de version réel, sur un poste de test : fermer tous les numéros, installer une
  version antérieure, vérifier que le PDF d'un ancien numéro redevient conforme, puis réinstaller
  la dernière. C'est le seul test qui prouve la promesse de recompiler à l'identique.

## Archivage : aucun fichier perdu

- [ ] Archivage complet depuis VSCodium. La confirmation annonce une place cohérente avec le
  poids réel de `out/` (comparer dans l'explorateur Windows), ou dit « aucun document produit
  pour l'instant » sur un numéro jamais compilé ; Annuler ne change ni les drapeaux, ni `out/`,
  ni l'emplacement ; le geste complet ferme la fenêtre, annonce ses étapes, et le numéro se
  rouvre depuis les archives, verrouillé, avec un arbre correct.
- [ ] Ce qui reste après l'archivage : `out/` a disparu et rien d'autre — `articles/`,
  `articles-word/`, `media/`, `tables/`, `portraits/`, les `.meta.yaml`, les `.traduction.yaml`
  et `BIENVENUE.md` sont tous là. `ausgabe.yaml` porte `locked: true`, `archived: true` et une
  `version-toolkit`. Le raccourci « Ouvrir la revue.lnk » du dossier archivé rouvre bien le
  numéro : il ne porte plus aucun chemin, seulement un lien qui vaut aussi depuis les archives —
  et il doit fonctionner tel quel sur l’AUTRE poste, une fois OneDrive synchronisé. Une
  Zeitschrift part dans les archives de la Zeitschrift, pas dans celles de la Revue.
- [ ] Échec et collision à provoquer. Ouvrir le PDF dans SumatraPDF puis archiver : une boîte de
  dialogue doit annoncer que les documents produits n'ont pas pu être supprimés — la console
  étant cachée, c'est le seul canal — et le numéro doit rester exactement dans son état de
  départ. Placer un dossier du même nom à destination puis archiver : le message doit dire qu'un
  dossier existe déjà, et rien ne doit être déplacé.
- [ ] Désarchivage. Retour dans le dossier de rédaction, raccourci réécrit, verrou toujours posé.
  Sur un numéro archivé puis déverrouillé, le panneau propose « Verrouiller la revue » sans
  déplacement ni suppression : vérifier que ça ne rejoue pas un archivage.

## Passage en production

- [ ] Mode développeur. Le groupe apparaît dans « Réglages SZH » avec le bon état et écrit
  `devMode` dans `C:\ProgramData\SZH\config.json`. Désactivé puis lanceur relancé : il lit les
  dossiers de production et n'y crée rien. Réactivé : il recrée et relit les dossiers de test.
- [ ] Décider quand le mode développeur passe à `false` par défaut. Il est actif partout
  aujourd'hui, y compris sur un poste neuf et quand la clé manque.
- [ ] Archiver une fois en mode production, sur un numéro de test copié dans le dossier de
  rédaction réel, pour confirmer que les vrais chemins fonctionnent. Confirmer aussi
  l'arborescence de production sur un poste de la rédaction : si un poste synchronise la
  bibliothèque sous un autre nom, rattacher l'**ancrage SharePoint** (clé `ancrageSharePoint`
  de `config.json`, ou le sélecteur de dossier du lanceur) — il n'existe plus de clé pour
  forcer la racine elle-même. Vérifier au passage la FORME de l'arbre (`docs/EMPLACEMENTS.md`
  §1) : les numéros en cours directement sous `Revue\`, `Zeitschrift\` et `Books\`, et les
  archives des trois regroupées sous un `_Archive\` unique. Sur SharePoint, RIEN ne déplace
  les numéros existants automatiquement — la migration automatique du 23.09.2026
  (`windows/szh-migration.ps1`) ne touche QUE le dossier de test ; un passage en production
  sur une bibliothèque encore à l'ancienne forme se déplace à la main.
- [ ] Vérifier sur le vrai SharePoint (jamais éprouvé hors banc jetable) : la migration
  automatique tourne à chaque mise à jour dans le dossier de test
  (`Invoke-SzhMigrationArborescence`, `windows/szh-migration.ps1`, appelée par `update.ps1`)
  — confirmer qu'elle ne s'exécute jamais quand `emplacementRevues` vaut `production`, et
  que `_Systeme\` (rapports, journaux, suggestions, inventaire) reste bien ancré sur
  SharePoint même en mode test (`Get-SzhDossierSysteme`).
- [ ] La bibliothèque `_NewsUndActu\` a changé de forme le 23.09.2026 : `Fiches\` et
  `_Statuts\fr\`/`_Statuts\de\` remplacent l'ancien magasin par revue
  (`_NewsUndActu\Revue\`, `_NewsUndActu\Zeitschrift\`, posé le 15.09.2026 puis jamais
  déployé). Vérifier qu'aucun poste ne porte encore l'ancienne forme avant de considérer ce
  point clos.

## Contenu publié

- [ ] Relire un échantillon de conversions : un article français, un allemand, un éditorial, une
  « Actualité et ressources ». Corps sans perte, titres aux bons niveaux, résumés et mots-clés
  dans la bonne langue, bibliographie rendue sous son titre.
- [ ] Export OJS. Saisir une adresse d'auteur dans le formulaire, exporter le XML, vérifier la
  présence de `<email>` dans le bloc auteur. Puis importer le XML dans un OJS de test, ou dans le
  vrai sur un numéro dépublié : rubriques rattachées, galleys téléchargeables, résumés et
  mots-clés présents, et voir ce qu'OJS fait sans adresse d'auteur. Piège : le genre, l'uploader
  et le groupe d'utilisateurs sont rattachés par nom, valables pour le journal français observé ;
  à vérifier pour la Zeitschrift. Un XML de production fera 30 à 50 Mo, ce qui peut imposer
  l'import en ligne de commande.
- [ ] Pagination continue d'un numéro — chantier en cours (`pipeline/pagination.py`, état dans
  `.szh-pagination.json`). Tant qu'il n'est pas livré, chaque article commence à la page 1 : une
  citation « p. 4 » ne désigne rien de stable et l'export OJS n'a pas de `<pages>` à donner.

## Conformité PDF/UA

- [ ] Image sans légende et PDF/UA-1 : WeasyPrint 69 ne distingue pas un `alt` vide d'un `alt`
  absent et écrit une erreur, le PDF sortant quand même. Exiger une légende à l'import, avec un
  avertissement du cockpit sur toute image non légendée, ou attendre une version de WeasyPrint qui
  fasse la distinction.
- [ ] **Le portrait n'est exercé par aucune des deux portes.** `test/articles/` et
  `test/accessibilite/` écrivent tous `photo: ""` : les deux `make verifier-ua` rendent 0 sans
  jamais compiler un portrait. La preuve a dû se faire sur un numéro hors banc. Poser une photo
  sur un auteur du corpus d'accessibilité fermerait cet angle mort pour de bon.
- [ ] **`.szh-arrow { opacity: 0.9 }` est un piège armé** (`pipeline/styles/print.css`). La règle
  est morte aujourd'hui : toute flèche vit dans le hero, où `opacity: 1` la neutralise. Mais une
  `opacity` inférieure à 1 fait dessiner l'élément dans un objet séparé où son marquage devient
  orphelin, et **fait échouer PDF/UA 7.1-3**. Une flèche posée un jour hors du hero casserait la
  porte de conformité sans que personne comprenne pourquoi. Retirer la déclaration, ou
  pré-mélanger comme ailleurs.

La maintenance récurrente — compacter le disque WSL, reconstruire le rootfs, surveiller la fin de
support de Debian, vérifier les extensions épinglées — est décrite dans `docs/MAINTENANCE.md` et
n'a pas à être suivie ici.
