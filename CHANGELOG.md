# Journal des versions

Les versions sont en `majeure.medium.mineure` depuis la `1.0.0` (18 septembre 2026). La règle
de numérotation, avec ses exemples, est dans le [README](README.md#numéroter-une-version) :

- **majeure** — un numéro déjà compilé sortirait différent ;
- **medium** — il faut le dire à quelqu'un ;
- **mineure** — ni l'un ni l'autre, et c'est le cas le plus fréquent.

Avant la `1.0.0`, les versions étaient en `année.mois.compteur` (`v2026.06.1` à `v2026.09.42`,
113 étiquettes). Elles ne sont pas reprises ici : leur histoire est dans les messages de tag
(`git tag -l --format='%(contents)' 'v2026.*'`) et dans les Releases GitHub.

## 1.2.4

**Bibliographie : une seule révision par référence, et rien de perdu.** Un DOI retrouvé par
Crossref entre désormais dans la révision de remise en forme de sa référence au lieu de finir en
commentaire ; les éditeurs d'un ouvrage collectif liés par « et » ou « und » sont reconnus (ils
disparaissaient en silence) ; aucune révision qui perdrait un nom, une année ou un nombre de
l'original n'est plus jamais proposée ; marqueurs « In », « (Ed.) », « (Eds.) », « (Hrsg.) » et
« pp. »/« S. » conformes aux deux Redaktionsrichtlinien.

## 1.2.3

**Le lanceur ne prend plus un manuscrit nettoyé avec des points bloquants pour un échec.**
Le nettoyeur sort avec un code de sortie non nul dès qu'une alerte bloquante subsiste — mais le
`.docx` a bien été écrit, annoté, et le rapport existe. L'onglet Préprocessing traitait ce cas
comme un échec technique et affichait « Raison inconnue » à la place.

- Ce cas (alerte bloquante, pas un refus du nettoyeur) est désormais un succès : le message
  donne les trois nombres qui comptent (points à traiter, révisions et commentaires posés dans
  le document), et le rapport se rend et s'ouvre exactement comme pour un nettoyage sans alerte.
- Un vrai échec (document illisible, environnement absent…) affiche maintenant les dernières
  lignes utiles du journal au lieu de « Raison inconnue » — jamais un code de sortie.

**Bibliographie : des révisions ciblées et justes.** Une remise en forme APA 7 ne barre plus la
référence entière : seuls les segments qui changent partent en supprimé/inséré. Chaque référence
porte sa langue (un titre anglais garde « Title: Subtitle » sans espace, un titre français son
insécable), seul le volume passe en italique, et un DOI retrouvé par Crossref s'insère en fin de
référence en révision au lieu d'un commentaire. À sévérité égale, la révision la plus large gagne
sur un chevauchement — 19 remises en forme sur 19 sortent en révision sur un manuscrit réel, contre
15 avant. Plus aucun astérisque dans un commentaire, et le rapport dit ce que chaque alerte est
réellement devenue dans le document.

## 1.2.2

**Orthographe rectifiée et trait d'union des préfixes dans le nettoyeur.** La Revue écrit en
orthographe rectifiée (décision de la rédaction du 21 septembre 2026) : une graphie
traditionnelle trouvée dans un manuscrit part désormais en révision Word, acceptable d'un clic.

- Neuf catégories de règles Vale générées depuis `pipeline/vale/lexique/orthographe-rectifiee.csv`
  (185 paires sûres) ; « dû », « mûr », « sûr », « jeûne » et « croître » ne sont jamais touchés.
- Huit règles de trait d'union à lexique fermé, fondées sur la page Wikipédia « Emploi du trait
  d'union pour les préfixes en français » ; « sans- », « peut être » et « a priori » sont écartés.
- Mesuré sur 92 articles publiés : aucune règle ne touche plus de 5,4 % des documents.

## 1.2.1

**La release se publie sans tag posé à la main — mineure, outillage seul, rien qui se voit
en dehors du dépôt.** La 1.2.0 a demandé trois poses du tag : vert en local n'a jamais garanti
vert sur un runner GitHub, et la CI ne parlait qu'après la pose, quand la réparer coûtait
déjà un `git push --delete` puis un retag.

- **`test/js/porte-release.js` rejoue en local, avant tout push,** ce que `ci.yml` et
  `release.yml` vérifient après coup : YAML des deux workflows, typographie des textes
  visibles, bump des extensions modifiées depuis le dernier tag, section `CHANGELOG.md`
  (et `nouveautes.json` si le medium change), puis la suite complète — en simulant
  ubuntu-latest et windows-latest (`SZH_SIMULER_RUNNER`) pour juger un `--runner ubuntu` ou
  `--runner windows` comme CE runner-là le verrait, sans attendre un run distant.
- **Le tag est désormais posé par la CI, pas par un `git tag` humain** : `release.yml` se
  déclenche sur la fin d'un `ci` réussi sur `main` dont le commit de tête est
  `release: X.Y.Z résumé`, pose alors `vX.Y.Z`, et enchaîne la publication sans rejouer
  `ci.yml` une seconde fois. Un commit `release:` dont `ci` échoue ne pose aucun tag.
- **Un motif de saut a désormais une seule source vraie** : `test/js/motifs-saut.js`, importé
  à la fois par `test/js/gardes.js` (qui les écrit, via les assistants `sauter.corpus`,
  `sauter.wsl`, `sauter.pandoc`, `sauter.powershell`, `sauter.vale`, `sauter.vscodium`,
  `sauter.production`, `sauter.eleve`, `sauter.pliage`) et par `test/js/verifier-tap.js` (qui
  les relit). Une nouvelle famille `vale` distingue enfin l'absence de Vale de l'absence de la
  WSL, que les tests concernés empruntaient jusqu'ici pour passer la porte.
- **Un crochet `pre-push`** (`.githooks/pre-push`, activé par `git config core.hooksPath
  .githooks`) rejoue la partie rapide de cette porte avant d'autoriser un push, en moins de
  30 secondes.

## 1.2.0

**Le nettoyeur de manuscrit : un onglet « Préprocessing » dans le lanceur.** Un manuscrit
d'autrice arrive tel qu'il a été écrit ; l'outil rend un `.docx` au gabarit Pronto, plus un
rapport HTML, et il tourne à la réception, avant toute relecture humaine.

- **Le mécanique est appliqué tel quel** : styles du gabarit sur tout le corps, titres retrouvés
  d'après la mise en forme effective (un titre numéroté par une liste Word est reconnu, son
  numéro retiré), formatage manuel retiré (l'italique, l'exposant, l'indice et les liens restent),
  typographie de la maison par le filtre `szh-typographie.lua` déjà en service, notes de bas de
  page, images et tableaux replacés dans leurs blocs. Titre, sous-titre, résumé, mots-clés et
  fiches d'autrices et d'auteurs remplissent les deux tableaux du gabarit, y compris le bloc
  « Informations sur les autrices et auteurs » de fin de manuscrit.
- **Les lignes directrices deviennent des révisions et des commentaires Word**, sous un auteur
  dédié : les corrections textuelles déterministes en suivi de modifications (tout s'accepte d'un
  clic), les points de jugement en commentaires ancrés, plafonnés à vingt-cinq par document et
  cinq par règle, le reste dans le rapport.
- **Vale porte les règles lexicales**, en YAML éditables par la rédaction dans `pipeline/vale/`
  (langage épicène, vocabulaire du handicap, casse, « cf. », et/&, DOI…), tirées des deux
  Redaktionsrichtlinien 2025 et mesurées sur 288 articles publiés. Vale 3.22.0 entre dans l'image
  WSL comme binaire épinglé ; les règles structurelles (longueurs, niveaux de titre, alt,
  tableaux) restent en Python.
- **La bibliographie est vérifiée** : citations sans référence et références jamais citées,
  ordre alphabétique puis chronologique, suffixes a/b, DOI normalisés en `https://doi.org/`,
  cohérence par Crossref (seul le DOI ou la référence part sur le réseau), DOI manquant retrouvé
  et proposé en commentaire, remise en forme APA 7 proposée en révision quand la lecture est sûre.
- **Un lexique maison** tiré des articles publiés des deux dernières années :
  `pipeline/vale/lexique/*.csv` (source de vérité, éditable au tableur), exports Excel et TBX
  générés, règles Vale de cohérence et de sigles générées depuis le CSV.
- Le contrat du chantier est `outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md` ; l'état et le
  reste à faire dans `outils-dev/ETAT-REPRISE-2026-09-18.md`. Le corpus de mise au point
  (onze manuscrits réels, trente-quatre paragraphes truqués) n'est pas versionné.

## 1.1.0

**« Quoi de neuf » : les postes apprennent ce qui a changé.** Jusqu'ici, une mise à jour
arrivait sans un mot — `update.ps1` posait la nouvelle version pendant la nuit et personne
ne savait ce qu'elle apportait. Le cockpit propose désormais une fenêtre, à la première
ouverture d'un numéro qui suit une mise à jour.

- **Seul un changement de MEDIUM la déclenche.** Une mineure ne dit rien : à deux releases
  par jour, une fenêtre par correction ne serait plus lue au bout d'une semaine. Le medium
  est l'unité d'annonce du dépôt, et c'est ici qu'il sert.
- **Rien ne s'ouvre sans un clic.** Une invitation discrète, un bouton. Refusée, elle ne
  revient pas — mais l'entrée « Quoi de neuf » du panneau de commande reste, pour toujours.
- **Le texte vient de `nouveautes.json`**, livré à la racine du toolkit et écrit pour la
  rédaction, dans les deux langues. Ni CHANGELOG.md, qui nomme des fonctions, ni le VSIX du
  cockpit, qui aurait forcé un bump de l'extension à chaque release.
- **Un poste neuf ne voit rien**, et c'est voulu : tout y est nouveau, et l'invitation au
  tutoriel dit déjà ce qu'il faut. Un poste de développement non plus, sa version n'étant
  pas un numéro de release.
- `test/typo-check.py` contrôle désormais 85 surfaces : `nouveautes.json` et la page de la
  fenêtre en font partie. La première version du contrôle ne lisait que les titres — quatre
  phrases sur cinq seraient parties sans apostrophe typographique ni insécable.

L'avertissement de maquette (numéro ↔ poste) **n'a pas bougé** : il reste sur la majeure
seule. Un écart de medium ne change pas la maquette du document qu'on relit ; le dire là
serait le noyer à nouveau.

## 1.0.0

Premier numéro de la nouvelle ère. Rien de la maquette ne change dans cette release : la
majeure `1` ouvre le compte, elle ne signale pas une rupture.

**Un schéma de version qui dit quelque chose.** `v2026.09.42` ne permettait ni de savoir si
une maquette avait bougé, ni de juger si une mise à jour pressait — quarante et une releases
pour le seul mois de septembre. Deux mécanismes lisent désormais les niveaux :

- le sélecteur *Version du logiciel…* ne propose qu'une **ligne par medium**, la plus récente
  de ses mineures (`1.2.13`, ni `1.2.12` ni les onze d'avant), et **rien d'avant `1.0.0`**.
  Revenir plus loin en arrière reste possible en ligne de commande, par
  `update.ps1 -Version 2026.09.42` ;
- l'avertissement « ce numéro n'a pas été fait avec cette maquette » ne se déclenche plus que
  sur un écart de **majeure**. Posé sur l'égalité des chaînes, il criait à chaque release,
  donc plus personne ne le lisait. Un numéro estampillé de l'ancienne ère le déclenche encore
  une fois, ce qui est exact — la maquette a bougé entre les deux.

**Aussi dans cette release.** Les chemins du poste passent par un seul module du cockpit
(`lib/chemins-poste.js`) au lieu d'une dizaine d'écritures en dur ; une instance de
développement lit le dépôt en place, sans passer par le toolkit déployé ; la fenêtre du
lanceur porte enfin l'icône de Pronto et non celle de la Revue.
