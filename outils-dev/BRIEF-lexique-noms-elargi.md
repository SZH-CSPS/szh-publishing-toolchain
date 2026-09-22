# Élargir le lexique des noms de famille — brief de délégation

> **Écrit le 22.09.2026** pour l'agent qui prend ce chantier **sur un autre poste**, sans avoir
> assisté à la session où il a été cadré. Tu connais peut-être le dépôt ; tu ne connais pas ce
> lot-ci, qui date du jour même.

**La demande, en trois points.** Ils viennent de Robin, ils ne se négocient pas :

1. **Élargir le lexique des noms de famille.** `pipeline/lexique/noms-famille.txt` ne porte
   aujourd'hui que les 1 282 noms tirés des bibliographies du corpus local ; il doit couvrir les
   noms les plus fréquents **en Suisse d'abord, en Europe ensuite**.
2. **Créer aussi un index des prénoms** (§5.4) — il en a existé un, supprimé le 22.09.2026 pour
   une raison de **provenance** qui tient toujours : source publique uniquement, jamais une
   dérivée de la base maison.
3. **La détection part du principe que l'ordre prénom/nom est constant dans un même document**
   (§3 bis) — la byline et le bloc final des autrices et auteurs se votent l'un l'autre, ils ne se
   décident pas chacun dans son coin.

**Le piège central, à comprendre avant d'écrire une ligne :** ce n'est pas un problème de volume.
Le disque et la RAM sont négligeables à toutes les tailles envisagées (§4). Élargir naïvement
**dégrade** le signal, et peut le rendre **faux** (§3). Le travail utile est un travail de
filtrage et de mesure, pas de moissonnage.

---

## 0. Ce que tu n'as probablement pas sur ton poste

Vérifie ces quatre points **avant** de commencer ; trois sur quatre sont bloquants.

| | État | Quoi faire |
|---|---|---|
| **Le code du lot** | ✅ committé et poussé le 22.09.2026 | `git pull`, puis lis le §1. Voir la réserve ci-dessous |
| `tmp/docx-dev` (77 galleys) | ⛔ hors dépôt (`tmp/` est dans `.gitignore`) | Tu n'en as **pas besoin** si tu suis le §7. Ne tente pas de le reconstituer |
| `C:\ProgramData\SZH\auteurs.json` | ⚠ absent d'un poste neuf | Nécessaire au banc de mesure (§6). Il se moissonne tout seul sur l'OAI-PMH **public** de `ojs.szh.ch` : lance VSCodium avec le cockpit, ou le lanceur `windows/open-produit.ps1`. Voir le §5.5 quinquies du contrat |
| Python 3.11+ | — | Mesuré ici sur 3.11.9. **stdlib seule**, aucune dépendance tierce nulle part dans ce lot |

**Le lot est dans `4d47dec`**, sur `main` — 17 fichiers, 5 508 lignes :

```
pipeline/manuscrit_noms.py                    765 l.   <- le consommateur du lexique
pipeline/lexique/noms-famille.txt            1285 l.   <- le lexique lui-même
outils-dev/lexique/generer-noms.py            459 l.   <- le générateur
outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md +307 l. <- le contrat, §5.5 ter/quater/quinquies
test/js/manuscrit-noms.test.js, lexique-noms.test.js, auteurs-cli.test.js, auteurs-lanceur.test.js
pipeline/manuscrit_entete.py, manuscrit-nettoyer.py, docx-meta.py, windows/open-produit.ps1,
vscodium-extension/szh-cockpit/outils/auteurs-cli.js   <- le branchement
```

⚠ **Réserve** : c'est un commit `wip(`, poussé sous pression de temps et **mêlé à d'autres
chantiers du même arbre** (import, pronto, typographie). Ne prends pas son contenu pour une
frontière de lot propre, et ne conclus rien d'un `git log` sur ces fichiers-là. Le contrat
(`ARCHITECTURE-nettoyeur-manuscrit.md`) fait foi, pas l'historique.

⚠ **Sept tests de réimport échouent sur un poste Windows** (`test/js/reimport.test.js`) : un défaut
connu de chemin Windows dans le harnais (`C:UsersrobinAppData…`, les antislashs mangés), **pas une
régression** et **hors de ton périmètre**. Ne les corrige pas, ne t'en sers pas comme ligne de
base : compare le nombre d'échecs avant et après ton lot, pas à zéro.

---

## 1. Ce qu'il faut lire, dans cet ordre

1. **`outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md`, §5.5 ter, quater et quinquies** — le
   contrat. C'est lui qui fait foi. Un désaccord avec lui se règle **en le modifiant**, jamais en
   s'en écartant dans le code. Le §5.5 quater est celui que ton travail va modifier.
2. **`pipeline/manuscrit_noms.py`** — l'en-tête (le partage segmentation/attribution), puis
   `BaseNoms.charger()` et surtout **`_signal_lexique()`**. C'est le seul consommateur du fichier.
3. **`outils-dev/lexique/generer-noms.py`** — l'en-tête, puis `filtrer_noms_famille()`. C'est le
   seul producteur du fichier.

Deux conventions de maison que ces fichiers appliquent et que ton code doit appliquer aussi :
**chaque seuil chiffré est justifié par une mesure datée, jamais par une intuition**, et
**en cas de doute, rien** — un module muet vaut toujours mieux qu'un module qui devine.

---

## 2. Où le fichier est lu, et à quoi il sert

`pipeline/lexique/noms-famille.txt` : un jeton **plié** par ligne (minuscule, accents retirés,
ponctuation de bord retirée), trié, `#` en commentaire. Lu par
`manuscrit_noms._charger_fichier_lexique()`, qui en fait un `dict {jeton -> poids}`.

Il sert à **un seul** des quatre signaux qui décident si « Guilley Edith » est écrit à l'endroit ou
à l'envers. Les trois autres (casse, e-mail, bibliographie du manuscrit) n'en dépendent pas et ne
doivent pas être touchés.

Le fichier ne porte **que des noms nus** : aucun e-mail, aucune affiliation, aucun ORCID, aucun
couple prénom↔nom reconstituable. **Le dépôt a vocation à devenir public** — cette contrainte a
déjà fait retirer `prenoms.txt` le 22.09.2026 (§5.5 quater). Elle s'applique à tout ce que tu
ajoutes, **l'index des prénoms compris** : deux listes séparées ne reconstituent aucune personne,
une paire prénom↔nom oui.

`_charger_fichier_lexique(dossier, nom_fichier, cible)` prend déjà le nom du fichier **et** le
dictionnaire cible en paramètres : lire un second fichier dans `_prenoms` au lieu de `_noms` est un
appel de plus dans `BaseNoms.charger()`, pas une refonte. Le mécanisme d'accueil de l'index de
prénoms existe donc déjà — il a servi jusqu'au 22.09.2026 au matin.

---

## 3. Le mécanisme — pourquoi « plus gros » n'est pas « meilleur »

`_signal_lexique()` n'est **pas** un test d'appartenance, c'est une **comparaison** entre deux
hypothèses :

```python
score_direct  = (1 if base.poids_prenom(tête)  > 0 else 0) + (1 if base.poids_nom(queue) > 0 else 0)
score_inverse = (1 if base.poids_nom(tête)     > 0 else 0) + (1 if base.poids_prenom(queue) > 0 else 0)
# MARGE_LEXIQUE = 1 : tout écart tranche ; une égalité reste muette.
```

État de la base sur un poste équipé, mesuré le 22.09.2026 :
`BaseNoms(disponible=True, 2 sources, 599 prénoms, 2150 noms)` — déjà **1 prénom pour 3,6 noms**,
et les 599 prénoms viennent **uniquement** de la base OJS du poste, jamais du dépôt.

Porter les noms à 50 000 **sans toucher aux prénoms** met ce rapport à 1 pour 83 et produit deux
dégâts distincts :

**(a) L'extinction — on perd des décisions justes qu'on avait déjà.** Presque tout prénom européen
est un nom de famille quelque part. « Simon Keller » dans une liste large a ses *deux* jetons dans
`noms` et aucun dans `prenoms` → `score_direct == score_inverse` → **muet**. Aujourd'hui ce cas
tranche juste, précisément parce que `simon` n'est pas dans la liste.

**(b) L'inversion — on fabrique une réponse fausse.** « Thomas Aebischer » avec `thomas` dans la
liste élargie et `aebischer` absent donne `direct=0, inverse=1` → **ORDRE_INVERSE, force
probable**, c'est-à-dire un prénom et un nom permutés dans le rapport. C'est le seul mode d'échec
qui ment au lieu de se taire, et il **grandit** avec la liste tant que la couverture reste
partielle. Le contrat se vante aujourd'hui d'une propriété de sûreté mesurée (une seule inversion
à tort sur 1155 fiches, 0,09 %, et ce n'est même pas une personne) : **c'est cette propriété-là que
ton lot met en jeu.**

La collision est aujourd'hui de **12 noms sur 1 282** (0,9 %) : *fabian, frank, kim, lucas, martin,
michel, peter, robert, simon, simoni, urban, walter*. Elle va monter beaucoup sur un top-N suisse,
parce que Peter, Simon, Martin, Walter, Robert sont justement des noms de famille **fréquents** en
Suisse : ils arriveront tout en haut du classement.

### 3 bis. L'ordre est constant dans un même document — principe posé par Robin

**Un article est écrit dans UN seul ordre prénom/nom, du début à la fin.** Une autrice ne signe pas
« Edith Guilley » dans la byline pour redevenir « Sermier Dessemontet Rachel » dans le bloc final.
La détection doit partir de ce principe, et pas seulement à l'intérieur d'une byline.

Ce que le code fait **déjà** : `trancher_groupe()` propage l'ordre au sein d'**un groupe de
segments reçus ensemble** — dès qu'un segment est tranché et qu'aucun autre tranché ne le
contredit, les segments restés en `defaut` adoptent cet ordre avec la confiance `'propagee'`
(§5.5 ter du contrat).

Ce qu'il faut **vérifier, et corriger si ce n'est pas le cas** : que la portée de cette propagation
soit bien **le document entier**, et non chaque bloc pris séparément. Un manuscrit porte au moins
deux endroits où des noms apparaissent — la **byline** et le **bloc final d'informations sur les
autrices et auteurs** (§5.5 bis du contrat) — et ils doivent se voter l'un l'autre. C'est
`manuscrit-nettoyer.py`, la CLI, qui décide de ce qui est passé ensemble à `trancher_groupe()` :
c'est là qu'il faut regarder, pas dans `manuscrit_noms.py`, qui ne connaît que le groupe qu'on lui
donne.

**Deux conséquences à garder en tête pendant tout le lot :**

- **C'est le meilleur allié de l'élargissement.** Un lexique plus large ne tranchera pas forcément
  *tous* les segments d'un document — mais il suffit qu'il en tranche **un seul** pour que tout le
  document bascule dans le bon ordre. Le gain d'un palier ne se lit donc pas segment par segment.
- **C'est aussi ce qui amplifie le danger du §3 (b).** Une inversion tranchée à tort ne reste pas
  locale : elle se propage à tous les segments restés en `defaut`. **Une seule erreur peut retourner
  un article entier.** D'où un critère d'acceptation (§6) beaucoup plus dur sur la colonne « à
  l'envers » que sur la colonne « muet » : un silence ne coûte qu'une convention par défaut, une
  inversion coûte un document.

---

## 4. Mesures déjà faites — ne les refais pas

Poste Windows 11, Python 3.11.9, 22.09.2026. Chargement mesuré tel que
`_charger_fichier_lexique()` le fait ; fichier réel à 7,09 caractères par jeton en moyenne ;
compression git estimée au ratio gzip mesuré sur le fichier actuel (48 %).

| entrées | disque | dans git (gz) | RAM | chargement |
|---|---|---|---|---|
| **1 282** (aujourd'hui) | 10 Ko | 5 Ko | 0,1 Mo | 2 ms |
| 10 000 | 85 Ko | 41 Ko | 0,9 Mo | ~20 ms |
| 25 000 | 210 Ko | 100 Ko | 2,2 Mo | 56 ms |
| **50 000** | 420 Ko | 200 Ko | 4,5 Mo | ~85 ms |
| 100 000 | 850 Ko | 410 Ko | 9,0 Mo | 156 ms |
| 200 000 | 1,7 Mo | 820 Ko | 18 Mo | 336 ms |
| 500 000 (tout le CH) | 4,2 Mo | 2,0 Mo | 41 Mo | 1 370 ms |

**Point de comparaison** : aujourd'hui, `import manuscrit_noms` + `BaseNoms.charger()` coûte
**199 ms** en tout, dont **98 ms** de démarrage de Python nu. À 50 000, le chargement de la base
passe de ~100 à ~185 ms : invisible. À 200 000 il quadruple et commence à se voir sur un nettoyage
lancé par manuscrit.

**Conclusion à retenir : le volume n'est la contrainte d'aucun des paliers envisagés.** N'argumente
pas sur les octets, argumente sur la mesure du §6.

**Occasion mesurée, à saisir si tu passes à 25 000+** : le fichier est **déjà plié**, mais
`_plier()` refait un `unicodedata.normalize('NFD', …)` complet sur chaque ligne. Un chemin rapide
(`if ligne.isascii() and ligne.islower(): jeton = ligne`) divise le chargement par ~4 (156 ms →
40 ms à 100 000 entrées). Changement local à `_charger_fichier_lexique()`, sans effet sur la
sémantique — le pliage d'un jeton déjà plié est l'identité.

---

## 5. La cible recommandée

**~30 000 entrées, plafond dur à 50 000.** Mais le chiffre est le moins important des cinq points
ci-dessous, et il n'est **recommandé, pas décidé** : c'est la mesure du §6 qui tranche.

1. **La Suisse d'abord, ~15 000** — les noms portés par au moins ~10 personnes dans le jeu de
   l'OFS. Le seuil exact est à **lire sur le CSV**, pas à supposer : l'OFS supprime les noms trop
   rares et le seuil de suppression n'a pas été vérifié ici.
2. **L'Europe proche ensuite, ~15 000** — DE, FR, IT, AT. C'est le milieu réel de la revue. Au-delà
   on paie la queue de distribution sans rien gagner : les auteurs de la revue ne sont pas un
   échantillon de l'Europe. L'OFS compte **plus d'un demi-million** de noms distincts rien qu'en
   Suisse, variantes orthographiques comptées à part, presque tous portés par une à trois
   personnes : cette queue-là n'a aucune valeur ici et beaucoup de coût en collisions.
3. **Un filtre de discrimination, qui compte plus que la taille** — écarter tout jeton dont la
   fréquence comme **prénom** domine sa fréquence comme **nom**. C'est ce filtre qui décide de la
   qualité du lot, pas le palier retenu.
4. **Un index de prénoms, au même titre que celui des noms — demandé explicitement par Robin le
   22.09.2026.** Ce n'est pas une option et ce n'est pas à toi d'en débattre : sans lui, tu ne
   nourris qu'un côté de la comparaison du §3 et tu dégrades le signal au lieu de l'améliorer.

   ⚠ **Attention à la provenance, c'est tout l'objet de la demande.** Un fichier `prenoms.txt` a
   existé et **a été supprimé le matin même du 22.09.2026** : il était dérivé de
   `auteurs.json`, la base maison, dans un dépôt appelé à devenir public. Ce que Robin demande de
   recréer est un index de prénoms **de source publique** (l'OFS publie les prénoms par année de
   naissance ; l'INSEE aussi) — pas une réapparition de l'ancien fichier sous un autre nom. Si tu
   te retrouves à relire `auteurs.json` pour produire ce fichier, tu es en train de refaire
   exactement ce qui a été supprimé : arrête-toi et remonte la question.

   Taille : les prénoms distincts sont **beaucoup moins nombreux** que les noms de famille et leur
   distribution est bien plus concentrée. Vise l'ordre de **5 000 à 10 000**, à confirmer sur le
   fichier ; n'aligne pas mécaniquement cette taille sur celle des noms.
5. **Garder la provenance dans l'en-tête du fichier** — les données de l'OFS sont libres
   **sous condition de citer la source**. L'en-tête généré doit porter la source, l'année et la
   licence de chaque apport.

---

## 6. Le banc de mesure — la porte d'entrée obligatoire

**Aucun palier ne s'adopte sans cette mesure.** Le contrat (§5.5 ter) porte déjà cette table,
produite en *leave-one-out* sur les 1155 fiches réelles de `auteurs.json` — chaque auteur retiré de
la base **avant** d'être jugé, donc inconnu d'elle :

| | tranché juste | à l'envers | indécis | muet |
|---|---|---|---|---|
| marge 1, **sans** `noms-famille.txt` | 792 (68,6 %) | 9 (0,8 %) | 34 (2,9 %) | 320 (27,7 %) |
| marge 1, **avec** `noms-famille.txt` (état actuel) | **834 (72,2 %)** | **12 (1,0 %)** | 29 (2,5 %) | **280 (24,2 %)** |

C'est ta **ligne de base**. Note qu'ajouter les 1 282 noms actuels avait déjà coûté 3 inversions
supplémentaires pour 42 décisions justes gagnées : le compromis du §3 est réel et déjà visible.

⚠ **Le script qui a produit cette table n'est pas dans le dépôt** — il était ad hoc. Premier
livrable : le réécrire proprement en `outils-dev/lexique/banc-noms.py`, stdlib seule, à la manière
des autres scripts de `outils-dev/lexique/`.

**Le protocole** : pour chaque palier (1k / 5k / 15k / 30k / 50k, plus un témoin à 0), rejouer le
leave-one-out complet et remplir la table ci-dessus. Tu n'as **pas** besoin des 77 `.docx` pour ça :
le banc tourne sur `auteurs.json`, pas sur le corpus.

Le mode `--diagnostic` de `manuscrit_noms.py` prend une base **en ligne** et t'évite tout fichier de
poste dans les tests :

```
echo '{"segments":[{"texte":"Guilley Edith","indices":{}}],"base":{"prenoms":["edith"],"noms":["guilley"]}}' \
  | python pipeline/manuscrit_noms.py --diagnostic
```

**Le critère d'acceptation** : retenir le plus grand palier qui **n'augmente pas** la colonne
« à l'envers » au-delà de 12/1155 (1,0 %), et qui fait baisser « muet ». Un palier qui gagne du
« tranché juste » en payant des inversions **ne s'adopte pas en silence** : il remonte à Robin avec
ses chiffres. L'asymétrie est voulue, et le §3 bis en donne la raison : dans un document, un
silence ne coûte qu'une convention par défaut, une inversion se propage et retourne l'article.

⚠ **Limite de ce banc, à écrire noir sur blanc dans ton rapport** : il juge des fiches
**isolées**, une par une. Il ne voit donc **rien** de la propagation du §3 bis, qui est précisément
ce qui fait la valeur d'un lexique élargi en conditions réelles. Il **sous-estime** le gain d'un
palier et **sous-estime** aussi le coût d'une inversion. Ne le présente jamais comme une mesure de
ce que vit un manuscrit : c'est un banc de comparaison entre paliers, rien de plus. Si tu vois
comment ajouter un second banc **par document** (plusieurs segments du même article jugés
ensemble, propagation comprise), propose-le — mais il demande un corpus de manuscrits que tu n'as
pas, donc ne t'y engage pas sans en parler d'abord.

---

## 7. La marche à suivre, et le piège qui efface le fichier

⛔ **Ne lance jamais `generer-noms.py` sans un `--corpus` valide.** Corpus introuvable → le compteur
est vide → `filtrer_noms_famille()` ne retient rien → **le fichier est réécrit vide** et les
1 282 noms tirés des bibliographies sont perdus (ils ne se régénèrent que depuis `tmp/docx-dev`,
que tu n'as pas). Le script prévient sur sa sortie standard, il ne s'arrête pas.

La conséquence sur ton architecture : les sources externes doivent **fusionner** avec l'existant,
jamais le remplacer. Deux façons, à trancher avec Robin (§9) :

- **(A)** un second fichier, `pipeline/lexique/noms-frequents.txt`, chargé en plus par
  `BaseNoms.charger()` — les provenances restent séparées, les régénérations indépendantes, et
  l'accident ci-dessus ne peut plus effacer qu'un seul des deux. **C'est ce que je recommande.**
- **(B)** un seul fichier fusionné — plus simple à lire, mais alors `generer-noms.py` doit
  **refuser de s'exécuter** sans corpus au lieu de prévenir, sinon l'accident devient permanent.

Le reste du travail :

1. Un moissonneur séparé, `outils-dev/lexique/moissonner-noms-publics.py`, sur le patron de
   `moissonner-ojs.py` (CLI à tiret analysée à la main, commentaires denses, chaque seuil justifié
   par une mesure datée).
2. Le **CSV brut téléchargé ne va pas dans le dépôt** — il passe par `tmp/` (déjà dans
   `.gitignore`). Seul le fichier plié, trié et filtré est committé.
3. Le filtre du §5.3, avec sa mesure : combien de jetons écartés, et lesquels (donne des exemples
   dans le rapport, comme le fait déjà `generer-noms.py`).
4. Les tests : `test/js/lexique-noms.test.js` et `test/js/manuscrit-noms.test.js` existent et
   doivent rester verts. Lancer **`node --test "test/js/*.test.js"`** — **les guillemets sont
   obligatoires**, sans eux le motif est expansé par le shell et la commande ne teste pas ce que tu
   crois.
5. Mettre à jour **`ARCHITECTURE-nettoyeur-manuscrit.md`, §5.5 quater** : nouvelle provenance,
   nouveaux chiffres, nouvelle table du §6. Le contrat n'est jamais en retard sur le code.

---

## 8. Ce qui ne se fait pas

- **Jamais éditer `noms-famille.txt` à la main.** Il est généré ; son en-tête le dit.
- **Aucune dépendance tierce.** Ni dans le pipeline, ni dans `outils-dev/`. stdlib seule, partout,
  y compris pour lire un CSV ou un ZIP.
- **Ne touche pas aux trois autres signaux** (casse, e-mail, biblio), ni à `MARGE_LEXIQUE`, ni à la
  combinaison de `trancher()`. Le périmètre est la base lexicale et la portée de la propagation
  (§3 bis) — rien d'autre.
- **Ne recrée pas l'ancien `prenoms.txt`, dérivé de `auteurs.json`.** L'index de prénoms est
  demandé (§5.4), mais c'est sa **provenance** qui avait motivé la suppression du 22.09.2026, pas
  son existence : le dépôt devient public, il ne porte pas de dérivée de la base maison. Source
  publique, et rien d'autre.
- **Aucune donnée personnelle** dans ce qui est committé : des jetons de noms nus, rien d'autre.
- **Ne « corrige » pas la base OJS** en passant. Ses défauts de saisie sont documentés au §5.5 ter
  et hors périmètre.

---

## 9. Ce qui appartient à Robin, pas à toi

Remonte ces points avec des chiffres, ne les tranche pas seul :

1. **Le palier final** — ta mesure du §6 propose, Robin dispose.
2. **Un ou deux fichiers pour les noms** (§7, A ou B).
3. **Tout palier qui gagne des décisions justes en payant des inversions** (§6).
4. **Toute extension de la portée de la propagation au-delà de la byline + le bloc final**
   (§3 bis) — la constance de l'ordre dans un document est un principe posé par Robin, sa mise en
   œuvre exacte ne l'est pas.

**Déjà tranché par Robin le 22.09.2026, ne rouvre pas le débat** : l'index de prénoms **se fait**
(§5.4), de source publique et de source publique seulement.

---

## 10. Livrables

- [ ] `outils-dev/lexique/banc-noms.py` — le banc leave-one-out, réutilisable, stdlib seule, avec
      sa limite (§6) écrite dans son en-tête.
- [ ] La table du §6 remplie pour chaque palier, datée, dans le rapport de livraison **et** dans le
      contrat.
- [ ] `outils-dev/lexique/moissonner-noms-publics.py` — le moissonnage et le filtre.
- [ ] Le lexique des **noms** régénéré, avec la provenance et la licence en en-tête.
- [ ] **L'index des prénoms** (§5.4), de source publique, avec la même rigueur de provenance — et
      la démonstration, dans le rapport, qu'il ne dérive **pas** de `auteurs.json`.
- [ ] **La portée de la propagation vérifiée** (§3 bis) : byline et bloc final jugés ensemble, avec
      le test qui le prouve. Si c'était déjà le cas, dis-le et montre où ; si ça ne l'était pas,
      c'est une correction à part entière, pas un effet de bord du lexique.
- [ ] `ARCHITECTURE-nettoyeur-manuscrit.md` §5.5 ter (la propagation) **et** §5.5 quater (le
      lexique, désormais deux index) à jour.
- [ ] `node --test "test/js/*.test.js"` vert.
- [ ] Un rapport de livraison qui dit **ce qui n'a pas marché** autant que ce qui a marché, et qui
      liste les écarts au présent brief plutôt que de les corriger en silence.

---

## Sources repérées (à vérifier sur pièce, aucune n'a été téléchargée ici)

- OFS — [Prénoms et noms en Suisse](https://www.bfs.admin.ch/bfs/fr/home/statistiques/population/naissances-deces/noms-suisse.html)
- opendata.swiss — [Noms de famille de la population résidante permanente par région linguistique](https://opendata.swiss/fr/dataset/nachnamen-der-standigen-wohnbevolkerung-nach-sprachregion-1)
  (il existe aussi une version **par canton** et une **par commune**)
- opendata.swiss — [Prénoms de la population selon l'année de naissance](https://opendata.swiss/fr/dataset/mannliche-vornamen-der-bevolkerung-nach-jahrgang-schweiz-2022)
- EU Open Data Portal — [List of first names and surnames](https://data.europa.eu/data/datasets/5bc35259634f41122d982759) (extrait de la base SIRENE de l'INSEE, avec le nombre d'occurrences)
- GitHub — [popular-names-by-country-dataset](https://github.com/sigpwned/popular-names-by-country-dataset) (CC0, 75 pays)

⚠ Ces liens ont été trouvés par recherche, pas ouverts et vérifiés : le nombre exact de lignes, le
seuil de suppression des noms rares, le format et la licence précise **restent à confirmer sur le
fichier lui-même**. C'est la première chose à faire, et elle peut changer les paliers du §5.
