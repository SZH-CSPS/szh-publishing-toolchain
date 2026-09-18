# Journal des versions

Les versions sont en `majeure.medium.mineure` depuis la `1.0.0` (18 septembre 2026). La règle
de numérotation, avec ses exemples, est dans le [README](README.md#numéroter-une-version) :

- **majeure** — un numéro déjà compilé sortirait différent ;
- **medium** — il faut le dire à quelqu'un ;
- **mineure** — ni l'un ni l'autre, et c'est le cas le plus fréquent.

Avant la `1.0.0`, les versions étaient en `année.mois.compteur` (`v2026.06.1` à `v2026.09.42`,
113 étiquettes). Elles ne sont pas reprises ici : leur histoire est dans les messages de tag
(`git tag -l --format='%(contents)' 'v2026.*'`) et dans les Releases GitHub.

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
