# Élargir le lexique des noms de famille — rapport de livraison

> **22.09.2026.** Répond point par point à `outils-dev/BRIEF-lexique-noms-elargi.md`. Le contrat
> (`ARCHITECTURE-nettoyeur-manuscrit.md`, §5.5 ter et §5.5 quater) a été mis à jour en même
> temps que le code : c'est lui qui fait foi, ce rapport dit **comment on y est arrivé, ce qui
> n'a pas marché, et ce qui reste à trancher**.

## 0. En une page

Le lexique passe de 1 282 à **284 494 jetons** (1 282 + 227 687 noms + 55 525 prénoms). Mesuré
en leave-one-out sur les 1 152 fiches réelles de `auteurs.json` :

| | tranché juste | à l'envers | indécis | muet |
|---|---|---|---|---|
| avant (base OJS + `noms-famille.txt`) | 834 (72,4 %) | 10 (0,9 %) | 28 (2,4 %) | 280 (24,3 %) |
| **après (les trois fichiers)** | **1110 (96,4 %)** | **7 (0,6 %)** | **28 (2,4 %)** | **7 (0,6 %)** |

**+276 décisions justes, −273 silences, et TROIS inversions de moins.** Le critère d'acceptation
du §6 du brief est tenu, et au-delà : la colonne « à l'envers » ne monte pas, elle *baisse* —
jusqu'au niveau du témoin sans aucun lexique.

Coût : 2,3 Mo sur disque, **818 Ko compressés dans git**, et **115 ms** pour charger toute la
base — 5 % d'un nettoyage de manuscrit, et seulement grâce au chemin rapide que le §4 du brief
avait repéré (sans lui, ~450 ms).

`node --test "test/js/*.test.js"` : **2396 tests, 0 échec, 2 sautés** (2380/0/2 avant le lot).

⚠ **Les sept échecs de `reimport.test.js` que le §0 du brief annonçait n'existent pas sur ce
poste** : la suite était déjà à zéro échec avant que je touche à quoi que ce soit. Ligne de base
vérifiée, pas supposée.

---

## 1. Ce qui a été livré (la case à cocher du §10)

| Livrable | État |
|---|---|
| `outils-dev/lexique/banc-noms.py` | ✅ le banc leave-one-out, réutilisable, stdlib seule, sa limite écrite dans son en-tête |
| La table du §6 pour chaque palier | ✅ dans ce rapport (§3) **et** dans le contrat §5.5 quater |
| `outils-dev/lexique/moissonner-noms-publics.py` | ✅ moissonnage + filtre, stdlib seule |
| Le lexique des noms régénéré, provenance en en-tête | ✅ `pipeline/lexique/noms-frequents.txt`, 227 687 jetons |
| **L'index des prénoms**, de source publique | ✅ `pipeline/lexique/prenoms-frequents.txt`, 55 525 jetons — démonstration au §5 |
| **La portée de la propagation vérifiée** | ✅ elle était **fausse**, c'est une correction à part entière — §4 |
| Contrat §5.5 ter et §5.5 quater à jour | ✅ |
| `node --test "test/js/*.test.js"` vert | ✅ 2396 / 0 |
| Rapport qui dit ce qui n'a pas marché | ce document, §6 et §7 |

Rien n'a été committé : l'arbre porte aussi le travail d'un autre poste
(`pipeline/pagination.py`, `pipeline/Makefile`, `test/js/pagination.test.js`), auquel je n'ai pas
touché.

---

## 2. Les sources, vérifiées sur pièce — trois hypothèses du brief étaient fausses

Le brief donnait ses liens « trouvés par recherche, pas ouverts ». Ouverts :

**(a) « L'OFS compte plus d'un demi-million de noms distincts rien qu'en Suisse. »** Non :
**238 962**, pour 8 557 230 personnes. La queue redoutée n'existe pas à cette échelle.

**(b) « Le seuil de suppression des noms rares n'a pas été vérifié ici. »** Il vaut **3** —
aucune ligne du fichier ne descend en dessous, ni pour les noms ni pour les prénoms. L'OFS a
déjà coupé la queue à la source, ce qui retire au palier une bonne part de son enjeu.

**(c) Le lien du brief pointait l'édition 2022 (données 2021).** Une édition **2026 (données
2025)** existe, publiée le 21.08.2026 ; c'est elle qui est prise.

**(d) Le jeu CC0 « 75 pays » de GitHub est inutilisable** : 95 Ko, une centaine de noms par pays,
entièrement contenu dans le reste. Écarté.

**(e) L'Europe ne se moissonne pas comme le brief l'imaginait.** Il demandait « DE, FR, IT, AT,
~15 000 ». Il n'existe pas d'équivalent ouvert et pondéré de l'OFS pour l'Allemagne, l'Autriche
ou l'Italie. Mais la demande est déjà largement satisfaite autrement : la source de l'OFS n'est
pas « les noms suisses », c'est **la population résidante** — *da Silva*, *Ferreira*, *Pereira*
figurent dans ses trente premiers noms, et les régions linguistiques allemande, française et
italienne y sont comptées séparément. S'y ajoute l'INSEE pour la France (879 421 patronymes
pondérés, Licence Ouverte 2.0). Le milieu réel de la revue est donc couvert par **deux** sources,
pas par cinq pays — et c'est la mesure, pas le principe, qui le dit.

**Licences, et ce qu'elles exigent** : OFS sous opendata.swiss « utilisation libre **avec
obligation d'indiquer la source** » ; INSEE sous Licence Ouverte 2.0 (Etalab). La citation est
portée par **l'en-tête de chaque fichier produit**, pas seulement par le script : c'est le
fichier qui voyage. Un test le vérifie.

Le serveur de l'OFS rend **403 sans en-tête `User-Agent`** : mesuré, commenté dans le
moissonneur, et l'agent annoncé est explicite.

---

## 3. La mesure — et la principale correction au brief

Le brief pose au §3 que « plus gros » dégrade, et que l'index de prénoms est ce qui sauve le
signal. **La première moitié est vraie, la seconde est fausse** — et c'est la découverte du lot.

Banc leave-one-out, 1 152 fiches, toutes les lignes mesurées le 22.09.2026 :

| | tranché juste | à l'envers | indécis | muet |
|---|---|---|---|---|
| témoin, base OJS seule | 792 (68,8 %) | 7 (0,6 %) | 33 (2,9 %) | 320 (27,8 %) |
| + `noms-famille.txt` seul (état du matin) | 834 (72,4 %) | 10 (0,9 %) | 28 (2,4 %) | 280 (24,3 %) |
| + 30 000 noms publics, **sans filtre, sans prénoms** | 864 (75,0 %) | **44 (3,8 %)** | 152 (13,2 %) | 92 (8,0 %) |
| + 50 000 noms publics, sans filtre, sans prénoms | 853 (74,0 %) | **46 (4,0 %)** | 181 (15,7 %) | 72 (6,2 %) |
| + 30 000 noms publics **filtrés**, sans prénoms | 987 (85,7 %) | 10 (0,9 %) | 25 (2,2 %) | 130 (11,3 %) |
| + 30 000 noms + 8 000 prénoms, filtrés | 1086 (94,3 %) | 10 (0,9 %) | 31 (2,7 %) | 25 (2,2 %) |
| + 30 000 noms + TOUS les prénoms, filtrés | 1095 (95,1 %) | 9 (0,8 %) | 32 (2,8 %) | 16 (1,4 %) |
| + 100 000 noms + 30 000 prénoms, filtrés | 1101 (95,6 %) | 9 (0,8 %) | 29 (2,5 %) | 13 (1,1 %) |
| **+ tout (227 687 / 55 525), filtrés — LIVRÉ** | **1110 (96,4 %)** | **7 (0,6 %)** | **28 (2,4 %)** | **7 (0,6 %)** |

**Ligne 3 : l'avertissement du brief, mesuré.** Verser 30 000 noms sans filtre **quadruple** la
colonne qui ment (10 → 44). Le danger était réel et il est exactement là où le brief le disait.

**Ligne 5 : c'est le FILTRE qui le neutralise, pas l'index de prénoms.** Les mêmes 30 000 noms,
passés au filtre de discrimination, ramènent les inversions à 10 — le niveau d'avant — **sans
aucun prénom public**. Ce que le brief attribuait à l'index de prénoms revient au filtre.

**Ligne 6 : l'index de prénoms sert à autre chose, et c'est considérable.** Il ne touche pas aux
inversions (10 → 10) : il tue le **silence**, 11,3 % → 2,2 %, et fait gagner 99 décisions justes
de plus. La décision de Robin tient donc à la mesure, pas seulement au principe — mais pour une
raison différente de celle qui la motivait.

### Le filtre de discrimination, en deux chiffres

Les deux sources de l'OFS décrivent la **même population** : pour chaque jeton on connaît son
poids comme nom *et* comme prénom, sur la même échelle. 14 750 jetons pliés apparaissent des deux
côtés ; parmi le top 30 000 des noms, **1 383 (4,6 %) pèsent plus lourd comme prénom** — *martin,
peter, michel, walter, simon, werner, richard, gabriel, ernst, rosa*, tout en haut du classement,
exactement comme le brief l'avait prévu. Ce sont eux qui fabriquent les 44 inversions de la
ligne 3.

### Ce que le banc ne peut pas voir, et une inversion qui n'en est pas une

Le banc juge des fiches **isolées** : il ne voit rien de la propagation, donc il sous-estime le
gain d'un lexique large **et** le coût d'une inversion. C'est écrit dans son en-tête, dans le
contrat, et ici.

Sur les 7 fiches de la colonne « à l'envers » de la ligne livrée, **au moins trois sont des
saisies OJS déjà inversées**, où le signal a raison contre la vérité terrain : « Monney Corinne »
(champ prénom = Monney) et « Steinegger Barbara » sont des personnes réelles saisies à l'envers,
et « Hanny Urban » / « Urban Hanny » est la même personne entrée deux fois dans les deux sens —
l'une des deux fiches est fausse par construction. Le taux réel d'inversions fabriquées est donc
**au plus 4/1152 (0,35 %)**, sous le témoin sans lexique. Conformément au §8 du brief, je n'ai
rien « corrigé » dans la base OJS en passant.

---

## 4. La portée de la propagation (§3 bis) — elle était fausse

**Ce n'était pas déjà le cas. C'est une correction à part entière, et elle a sa preuve.**

`trancher_groupe()` propage bien, mais `_tenter_noms()` l'appelle **une fois par LIGNE**. La
portée réelle était donc la ligne : deux noms d'une même byline se votaient l'un l'autre, la
byline et le bloc final jamais. Le seul pont entre les deux zones était `_fusionner_auteurs()`,
qui ne rapproche que les fiches reconnues comme **la même personne** (e-mail identique ou même
ensemble de jetons) : une autrice présente dans les deux endroits pouvait y corriger son propre
ordre, mais n'apprenait rien à ses coautrices.

⚠ **Le brief envoyait au mauvais fichier** : il désigne `manuscrit-nettoyer.py`, « la CLI, qui
décide de ce qui est passé ensemble à `trancher_groupe()` ». Le vrai appelant est
`manuscrit_entete.py`.

**Correction** : `manuscrit_entete._propager_ordre_document()`, appelé **après** la fusion du
bloc final — le seul moment du traitement où `entete.auteurs` porte les deux zones. Même règle
que `trancher_groupe()`, transposée : les fiches tranchées votent, l'unanimité est requise, seules
les fiches en `defaut` sans conflit basculent, et sans consensus **rien** ne bouge.

**Preuve** : le test `l'ordre tranché dans le BLOC FINAL retourne un nom resté en defaut dans la
byline` a été écrit d'abord, puis rejoué **sur `HEAD` dans un worktree isolé** (pour ne pas
mesurer le travail en cours de l'autre poste) : il y **échoue**, et il passe avec le correctif.
`test/js/manuscrit-entete.test.js`, trois tests au total — le cas nominal, la non-propagation en
cas de contradiction, et la virgule qui ne vote pas.

### Un quatrième champ sur la fiche, et un choix qui m'appartient

La fiche portait `ordre_confiance`, `ordre_motif`, `ordre_conflit` : à quel point on est sûr,
**jamais de quoi**. Or `mn.repartir()` n'est inversible qu'une fois l'ordre connu. Un quatrième
champ `ordre` a donc été ajouté à la fin, comme les trois autres et pour la même raison de
compatibilité (les lecteurs JS du produit n'ouvrent qu'une liste blanche fermée ; aucun ne le
voit). Conforme à la règle de maison que le contrat énonce lui-même : *un état voyage comme une
donnée, jamais comme une sous-chaîne de prose.*

**Choix du lot, pas du brief, et je le signale plutôt que de le glisser** : `ordre` vaut `None` —
et la fiche **ne vote jamais** — quand l'ordre vient d'ailleurs que d'un signal de
`manuscrit_noms`. C'est le cas de la forme « Nom, Prénom », où la virgule dit l'ordre **de ce
segment** sans rien dire de la convention du document : une byline « Guilley, Edith » n'interdit
pas une prose « Edith Guilley ». Laisser cette virgule voter retournerait tout un article sur la
foi d'une ponctuation locale — exactement l'accident que la propagation doit éviter. Le choix est
conservateur dans le sens que le §6 du brief demande (un silence coûte une convention, une
inversion coûte un document), mais il est discutable et il est à vous.

---

## 5. La provenance de l'index de prénoms — la démonstration demandée

Le §10 demande « la démonstration, dans le rapport, qu'il ne dérive **pas** de `auteurs.json` ».
Trois niveaux, du plus faible au plus fort :

1. **Les sources déclarées** sont trois fichiers CSV de l'OFS et de l'INSEE, téléchargés sur
   `dam-api.bfs.admin.ch` et `static.data.gouv.fr`. Un test lit la table `SOURCES` du script et
   refuse toute URL hors de ces deux domaines.
2. **Le script n'a aucun moyen de lire la base de la maison** : ni `auteurs.json`, ni
   `ProgramData`, ni `base_auteurs` n'apparaissent dans une ligne de code du moissonneur. Un test
   le vérifie sur **le script**, pas sur le fichier — un fichier propre produit par un script
   fautif passerait toutes les vérifications de forme, et c'est précisément ce qu'on empêche.
3. **La garantie de fond ne dépend d'aucun test** : les deux index restent **séparés**, et un
   test vérifie qu'ils sont **disjoints**. Deux listes de jetons nus ne reconstituent aucune
   personne ; un couple prénom↔nom, oui.

`prenoms.txt` n'est pas réapparu sous un autre nom : le test qui garde sa suppression est
toujours là et toujours vert.

---

## 6. Écarts au brief, en clair

| # | Le brief dit | Ce qui a été fait, et pourquoi |
|---|---|---|
| 1 | Table sur **1155** fiches | **1152**. Le script ad hoc d'origine jugeait aussi les 3 fiches d'institution que `_charger_base_auteurs()` écarte comme bruit — il mesurait une population qui n'alimente pas la base. « Juste » et « muet » sont inchangés au chiffre près ; les 2 inversions perdues **étaient** ces institutions, d'où la disparition de l'« unique inversion à tort » du contrat. |
| 2 | §5.3 : **écarter** tout jeton dont la fréquence de prénom domine | Je l'**attribue** au côté dominant, avec une zone neutre à `--rapport 2`. Écarter « peter » des deux index le rend muet sur « Peter Müller » ; l'attribuer aux prénoms le fait trancher juste, et il ne peut pas mentir sur « Müller Peter ». `--rapport` très grand se rapproche du comportement décrit par le brief : le paramètre est là, la mesure aussi. |
| 3 | §3 : l'index de prénoms est ce qui évite les inversions | Non : c'est le **filtre**. L'index de prénoms tue le silence (11,3 % → 2,2 %). Les deux sont nécessaires, pour deux raisons différentes. Voir §3. |
| 4 | §5 : « la Suisse ~15 000, l'Europe proche ~15 000 » | **227 687 noms / 55 525 prénoms**, Suisse + France, sans troncature. Pas de source ouverte et pondérée pour DE/AT/IT, et la donnée de l'OFS porte déjà la population **résidante**, donc le milieu européen de la revue. |
| 5 | §3 bis : regarder `manuscrit-nettoyer.py` | Le vrai appelant est `manuscrit_entete.py`. |
| 6 | §0 : 7 tests de `reimport.test.js` échouent sur Windows | **Zéro échec** sur ce poste avant le lot. Ligne de base mesurée, pas reprise. |
| 7 | §8 : ne toucher à rien d'autre | Un **quatrième champ** `ordre` sur la fiche, sans lequel la propagation de document est impossible. Dans le périmètre (§3 bis), signalé ici. |
| 8 | §4 : « occasion mesurée » du chemin rapide | Prise. 39 281 jetons chargés en 17 ms, contre ~100 ms pour 1 881 auparavant. |
| 9 | §5 : « ~30 000, plafond dur à 50 000 » | **Le plafond n'a pas été retenu** : la mesure ne le justifie pas. Voir §7 — c'est le seul écart que j'ai d'abord raté, et Robin l'a rattrapé en demandant « 30 k est donc le mieux ? ». |

---

## 7. Ce qui reste à Robin (§9 du brief)

1. **Le palier : aucun.** Les deux index sont livrés **complets**, 227 687 noms et 55 525
   prénoms. J'avais d'abord recommandé 30 000 / 8 000 — c'était une erreur de jugement de ma
   part, pas une mesure, et la question de Robin (« 30 k est donc le mieux ? ») l'a mise au jour.
   La courbe est **monotone sur les deux colonnes qui comptent à la fois** :

   | palier | juste | à l'envers | muet | disque | git (gz) | chargement |
   |---|---|---|---|---|---|---|
   | 30 000 / 8 000 | 94,3 % | 10 | 25 | 283 Ko | 105 Ko | 19 ms |
   | 30 000 / tous les prénoms | 95,1 % | 9 | 16 | 648 Ko | 227 Ko | 35 ms |
   | 100 000 / 30 000 | 95,6 % | 9 | 13 | 1,0 Mo | 359 Ko | 55 ms |
   | **tout (livré)** | **96,4 %** | **7** | **7** | **2,3 Mo** | **818 Ko** | **115 ms** |

   Ce qui tranche n'est pas le pourcentage global mais la **comparaison fiche à fiche** : le
   palier complet corrige **trois inversions réelles** que 30 000 / 8 000 laisse passer — « Ayala
   Borghini », « Kolja Ernst », « Simoni Symeonidou », des prénoms et des noms rares en Suisse,
   absents des têtes de classement — et n'en introduit **aucune**. Or l'inversion est la seule
   erreur qui se *propage* (§4) : elle retourne un article entier, quand un silence ne coûte
   qu'une convention par défaut. C'est la colonne qui compte double, et c'est celle qui s'améliore.
   Mon argument initial (« le gain restant porte sur "muet", que la propagation absorbe déjà »)
   était juste sur « muet » — et c'est précisément pour ça qu'il ne suffisait pas : il passait à
   côté de la colonne qui décide.

   **Le coût est en poids de dépôt, jamais en temps.** 115 ms sur un nettoyage qui en prend 2300,
   soit 5 %, une fois par manuscrit. Les 818 Ko compressés se paient une fois l'an (l'OFS publie
   une édition annuelle) et restent en dessous de `docs/palette.html`, déjà dans le dépôt.
   Pour revenir en arrière : `--palier-noms 30000 --palier-prenoms 8000`, et le tableau ci-dessus
   dit exactement ce que ça coûte.

2. **Un ou deux fichiers** (§7 A/B). J'ai pris **(A)**, trois fichiers séparés — provenances et
   licences distinctes, régénérations indépendantes, et l'accident du `generer-noms.py` sans
   corpus ne peut plus emporter qu'un fichier sur trois. Réversible en une ligne.
3. **Un palier qui paie des inversions** : il n'y en a pas. Aucune ligne retenue n'augmente la
   colonne « à l'envers ». Rien à arbitrer ici.
4. **La virgule « Nom, Prénom » ne vote pas** pour l'ordre du document (§4 ci-dessus). Décision
   de ma part, dans le sens prudent ; à confirmer ou à renverser.

### Ce que je n'ai pas fait

- **Le second banc « par document »** (§6 du brief) n'existe pas. Le brief dit de le proposer
  sans s'y engager, faute de corpus — mais le corpus existe : `tmp/corpus-relecture/lot-A/`
  porte 11 manuscrits réels avec leur table d'attendus. C'est le seul banc qui mesurerait ce que
  la propagation apporte vraiment, et le seul qui dirait le vrai coût d'une inversion. À décider.
- **Les sources DE / AT / IT** n'ont pas été cherchées au-delà des liens du brief : si un jeu
  ouvert et pondéré existe pour l'un des trois, il s'ajoute au moissonneur en cinq lignes (une
  entrée dans `SOURCES`).
- **Les CSV bruts** (38 Mo) restent dans `tmp/lexique-sources/`, hors dépôt, comme demandé.
  `--telecharger` les remet en place sur n'importe quel poste.
