# Journal des versions

Les versions sont en `majeure.medium.mineure` depuis la `1.0.0` (18 septembre 2026). La règle
de numérotation, avec ses exemples, est dans le [README](README.md#numéroter-une-version) :

- **majeure** — un numéro déjà compilé sortirait différent ;
- **medium** — il faut le dire à quelqu'un ;
- **mineure** — ni l'un ni l'autre, et c'est le cas le plus fréquent.

Avant la `1.0.0`, les versions étaient en `année.mois.compteur` (`v2026.06.1` à `v2026.09.42`,
113 étiquettes). Elles ne sont pas reprises ici : leur histoire est dans les messages de tag
(`git tag -l --format='%(contents)' 'v2026.*'`) et dans les Releases GitHub.

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
