# Nettoyeur de manuscrit — brief de reprise

> **État historique du 18.09.2026, dépassé.** L'état courant est dans `ETAT-REPRISE-2026-09-18.md`,
> le contrat dans `ARCHITECTURE-nettoyeur-manuscrit.md`.

**Pour qui :** l'agent qui reprend ce chantier sans l'avoir suivi. Tu connais le dépôt, tu n'as
pas assisté à la session du 18.09.2026 où tout ceci a été écrit.

**Ce que tu dois lire avant d'écrire une ligne**, dans cet ordre :

1. `outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md` — **le contrat**. Signatures exactes,
   frontières de modules, pièges mesurés, contrôles de validité. Un désaccord avec lui se règle
   en le modifiant, jamais en s'en écartant dans le code.
2. `outils-dev/Pipeline de relecture automatisée — Revue CSPS.md` — le brief fonctionnel
   d'origine, écrit par Robin. Le contrat dit comment on le construit ; celui-ci dit pourquoi.
3. Ce fichier, pour l'état réel et ce qui ne marche pas.

**Où ça vit :** tout est dans le worktree `.claude/worktrees/nettoyeur-manuscrit`, branche
`worktree-nettoyeur-manuscrit`, **jamais rapatrié dans l'arbre principal**. Il a été isolé parce
qu'une autre session Claude Code travaillait sur la release `v1.1.0` dans le même dépôt ; cette
raison a disparu, le rapatriement reste à faire.

---

## 1. Ce que l'outil fait

Un manuscrit arrive de l'autrice, en `.docx` ou `.odt`, dans l'état où elle l'a écrit. L'outil rend
un `.docx` **au gabarit « Pronto — modèle d'article »**, nettoyé du formatage manuel, titres
retrouvés, images en blocs figure, tableaux coiffés de leur rangée de métadonnées — plus un rapport
de ce qu'il a fait et de ce qu'il n'a pas su faire.

Il tourne **à la réception**, avant toute relecture humaine. Il ne modifie jamais l'original.

Surface d'entrée : un onglet **« Préprocessing »** du lanceur, bouton « Manuscript cleaner
(Article) », boutons radio Revue / Zeitschrift.

---

## 2. L'état, module par module

**117 contrôles verts** au 18.09.2026 (les huit fichiers ci-dessous plus `controles.test.js`).

| module | lignes | contrôles | rôle |
|---|---|---|---|
| `pipeline/manuscrit_modele.py` | 1420 | 16 | le modèle riche (§4) et **toutes les décisions** |
| `pipeline/manuscrit_docx.py` | 1104 | 24 | `.docx` → modèle riche |
| `pipeline/manuscrit_gabarit.py` | 913 | 15 | modèle riche → `.docx` au gabarit |
| `pipeline/manuscrit_regles.py` | 887 | 9 | 29 règles ; métadonnées en données, détection en Python (voir §8) |
| `pipeline/manuscrit-nettoyer.py` | 520 | 8 | la CLI, qui branche tout |
| `pipeline/manuscrit_typo.py` | 423 | 7 | le pont typographique |
| `windows/open-produit.ps1` | +411 | 7 | l'onglet et `Invoke-SzhManuscrit` |
| `test/js/encodage-sorties.test.js` | — | 3 | interdit la rechute d'encodage |

`pipeline/manuscrit_odt.py` **n'existe pas** : une entrée `.odt` est refusée proprement. Le gabarit
Twig du rapport HTML n'existe pas non plus, l'onglet l'appelle déjà.

---

## 3. Les décisions prises, à ne pas re-litiger

- **sortie `.docx` seule**, entrées `.docx` et `.odt` ;
- **100 % Python**, dans la WSL `SZH-Publishing` (python3 3.13.5). Aucun Python n'est garanti côté
  Windows — `apps.lock` ne pose que VSCodium et SumatraPDF. Appel à chaud mesuré **0,138 s**, et
  chaque poste préchauffe la distro à l'ouverture de session ;
- **stdlib seule.** Pas de PyYAML, pas de python-docx, pas de lxml, pas de jinja2 ;
- **le pont typographique n'implémente aucune règle** : il envoie l'AST pandoc au filtre existant
  `pipeline/filters/szh-typographie.lua` et réinjecte le texte normalisé dans les `w:r` par un diff
  caractère par caractère. Un seul moteur, littéralement ;
- **la sortie est écrite à côté du manuscrit d'entrée**, sans demander de dossier ;
- **`docx-titres.py` ne devait pas bouger** (en service sur la chaîne d'import) — ⚠ **il a
  pourtant reçu 5 lignes** de garde d'encodage, comme 14 autres scripts du pipeline. La consigne
  et le résultat divergent : à trancher, garder ou défaire.

---

## 4. Le corpus, et la seule vérité terrain du dépôt

`tmp/corpus-relecture/` — **hors git**, manuscrits non publiés, et `tmp/` a déjà été vidé sans
prévenir le 17.09.2026. Lire son `LISEZMOI.md`.

Onze manuscrits réels, un piège par fichier. Et surtout `lot-A/2-fabrique.csv` : **34 paragraphes
truqués** avec leur style d'avant. C'est la seule vérité terrain du dépôt — on **note** le
nettoyeur, on ne le regarde pas tourner. Le banc du parser Pronto, lui, était circulaire.

⚠ **Deux pièges de mesure, déjà payés**, détaillés dans
`scratchpad/note-34-paragraphes.md` (hors dépôt, à refaire si perdu) :

1. le CSV numérote **tous** les `w:p` à toute profondeur ; la trace ne compte que les **enfants
   directs du corps**. L'écart atteint 34. Apparier par **identité d'objet XML**, jamais par index ;
2. la colonne `debut_du_texte` du CSV peut décrire une **citation en exergue ancrée** dans le
   premier run, pas le texte du paragraphe. Ne pas apparier par le texte non plus.

⚠ **Le corpus fabriqué est adversarial pour toute approche fondée sur la mise en forme** : les
faux titres ont été créés en n'insérant **qu'un `w:pStyle`**, donc ils gardent la mise en forme
directe du corps — et dans `2-clairseme`, exactement celle des vrais titres aussi
(`{'police': 'Verdana'}` pour les deux). Un score bas sur `2-*` ne condamne pas forcément une
conception ; mesurer **aussi** sur `1_` et `1bis_`, qui portent la vraie pathologie.

---

## 5. Les chiffres, mesurés et reproductibles

Chaîne complète sur les onze manuscrits : **8,7 s**, soit 0,8 s par fichier. Dix produisent leur
`.docx` et leur rapport ; le onzième est **refusé** — il porte des révisions ouvertes, et c'est le
comportement voulu.

Détection des titres, conception **en place** :

| mesure | résultat |
|---|---|
| faux titres rattrapés (`2-*`, 33 mesurables) | **29 / 33** |
| **vrais titres détruits** | **4** |
| pseudo-titres promus (`3_`, 17 attendus) | **6 / 17** |

Les quatre vrais titres détruits sont des intertitres réels de la Revue :
« Informations sur les autrices et auteurs : » (7 mots, rétrogradé sur son deux-points), et trois
de 13, 17 et 19 mots. La Revue écrit des intertitres longs, en phrase : **un seuil de 12 mots les
combat**.

---

## 6. CE QUI NE MARCHE PAS

### 6.0 LA TYPOGRAPHIE NE TOURNE JAMAIS EN PRODUCTION

**Le défaut le plus grave du chantier, et il est invisible dans les 117 contrôles verts.**

`manuscrit_typo.py` joint pandoc en appelant `wsl.exe -d SZH-Publishing`. Mais la CLI est
elle-même exécutée **DANS** la WSL par le lanceur (§2 du contrat). Là, `wsl.exe` n'existe pas :
le repli prévu par le module se déclenche, les paragraphes ressortent **inchangés**, et le
nettoyage se termine sans erreur. Mesuré par une autre session : **repli sans typographie sur
10 fichiers sur 10**.

C'est une contradiction que le contrat porte lui-même — son §2 dit que la CLI tourne dans la WSL,
son §6 dit que le pont appelle `wsl.exe`. Les deux ne peuvent pas être vrais. Personne ne l'a vue.

**Et voici pourquoi aucun test ne l'attrape** : la suite tourne depuis le **Python de Windows**, où
`wsl.exe` existe. **L'environnement de test n'est pas l'environnement de production.** Toute la
discipline de sabotage de ce chantier a validé une configuration qui ne se produit jamais.

⚠ **Conséquence de méthode, à appliquer avant toute autre mesure** : le nettoyeur se mesure **dans
la WSL**, jamais depuis Windows. Un chiffre obtenu depuis Windows ne dit rien de la production.

Le correctif est simple — détecter si l'on est déjà dans la WSL et appeler `pandoc` directement —
mais il n'a pas été fait, et il invalide toute mesure typographique prise jusqu'ici.

### 6.1 Le gabarit n'est pas rempli

Les champs du gabarit (Titre, Sous-titre, Résumé, Prénom, Nom, Fonction, Institution, Email)
restent **tous vides** : titre, auteurs et résumé de l'article restent dans le corps.
`manuscrit_gabarit.ecrire()` recopie les deux tableaux fixes vides depuis le gabarit, parce que le
`Document` du §4 ne porte aucun de ces champs. C'était un choix de périmètre défendable module par
module ; du point de vue du produit, la sortie n'est pas vraiment « au gabarit ».

### 6.2 La détection des titres — lis ça avant de reprendre

Une refonte « par signatures de mise en forme » a été écrite, testée (16 contrôles verts), et
**n'a pas remplacé** la conception en place. Elle donne 24/33, 0 détruit, 6/17 — elle échoue deux
des trois critères. Le §5.1 du contrat la décrit ; elle est dans `classer_titres()`.

**La cause est identifiée, et c'est un défaut du contrat, pas de l'implémentation.**

Mesuré sur `1_Résumé-article-revue-CSPS.docx`, la vraie pathologie (quatre paragraphes en Titre 2
ramenés de 18 pt gras à 12 pt non gras) : **les quatre faux titres sont conservés**, avec ce motif :

> signature (12.0 pt, alignement center) typographiquement distincte de celle du corps
> (**taille non déclarée**)

Le corps ne **déclare** aucune taille, il l'hérite. Le faux titre déclare explicitement 12 pt. La
comparaison conclut « différent » alors que les deux font **12 pt à l'écran**.

Le §4 du contrat spécifie que `Fragment.forme` ne porte que la mise en forme **directe**, avec
`None` = « non déclaré ». C'est juste pour un booléen — « gras jamais posé » et « gras
explicitement éteint » sont deux intentions. C'est **faux pour une taille** : « non déclarée » veut
dire « celle dont j'hérite ».

**Le correctif, identifié et borné** : résoudre la mise en forme **effective** dans le lecteur —
direct, puis style du paragraphe, puis `docDefaults` — et bâtir les signatures là-dessus. C'est ce
que compare l'œil d'une relectrice. `pronto_docx.py` sait déjà remonter la chaîne des styles pour
les **noms** ; il faut l'étendre aux **attributs**.

Ça explique trois échecs d'un coup : le 24/33, l'adoption de la passe 3 bis qui ne s'est
**jamais** déclenchée sur aucun des onze fichiers, et le cas réel ci-dessus.

---

## 7. Les pièges déjà payés — ne les repaie pas

**`mc:AlternateContent` cache des dessins.** Les dix ancrages flottants de
`4_La méthode Flip Flap.docx` sont sous `w:r > mc:AlternateContent > mc:Choice > w:drawing`. Un
lecteur qui ne regarde que les enfants directs d'un `w:r` les perd **tous les dix sans un mot**.
Déplier `mc:Choice`, **jamais `mc:Fallback`** — sauf quand la branche `Choice` est une forme sans
image : ses **cinq** images ne vivent alors que dans le `Fallback`, et n'étaient recensées nulle
part. 16 images DrawingML + 5 VML = les 21 médias du paquet, sans recoupement.

**`wsl.exe` avale les antislashs** d'un argument passé en tableau à `subprocess.run`. Convertir en
barres obliques avant l'appel. L'échec est silencieux.

**L'UTF-16 de `wsl.exe` ne concerne que ses commandes natives** (`wsl -l -v`). La sortie relayée
d'un programme Linux traverse en UTF-8 intact. Ne pas ajouter de décodage défensif.

**Le filtre Lua ne convertit pas `--`** : cette conversion vient de l'extension `smart` du lecteur
Markdown de pandoc, qu'un AST construit à la main ne traverse pas. Ne pas réimplémenter `smart`.

**Les listes** : `w:numPr` ne porte qu'un `numId` et un niveau. Le format (puce / numérotée) vit
dans `word/numbering.xml`, au bout de trois sauts, et un `w:lvlOverride` peut le redéfinir. Le
`numId` d'origine **ne se recopie jamais** — report par correspondance. Mesuré sous pandoc 3.5 :
`numPr` sur le paragraphe et `numPr` hérité d'un style donnent un AST **identique**.

**LibreOffice fond deux tableaux qui se touchent.** Toujours un paragraphe vide entre deux blocs.

**Le numéro de page n'existe que si Word a repaginé.** Ne jamais l'estimer depuis un nombre de
signes. `page = None` est une réponse acceptable.

**`python3` nu, sur Windows, tombe sur l'alias `WindowsApps` et ne rend jamais la main** sous
`spawnSync` : la suite de tests se fige indéfiniment. Passer par `PYTHON` de `test/js/gardes.js`.

**Deux contrôles transverses du dépôt cassent facilement**, et aucun test du chantier ne les voit :
`test/typo-check.py` (typographie de l'interface, en CI à chaque push) et `test/js/controles.test.js`
(aucun message ne doit nommer une machine virtuelle, un script, un flux, un code de sortie). Les
deux ont été cassés par ce chantier. **Faire tourner la suite complète avant tout commit.**

⚠ `windows/szh-textes.ps1` : **apostrophes typographiques DOUBLÉES** (`n’’est`), BOM en tête, trois
blocs de langue, et l'allemand suisse **colle** la ponctuation là où le français l'espace. Deux
passes déléguées y ont introduit des fautes qu'aucun contrôle ne voit — vérifier à l'octet.

---

## 8. Les décisions ouvertes

- ⚠ **Les règles ne sont PAS des données éditables**, contrairement à ce qui a été affirmé deux
  fois à Robin pendant la discussion sur Vale. `Regle` est un `namedtuple` dont le champ
  `detecter` porte une **référence de fonction Python** (`_detecter_*`). Les métadonnées sont des
  données ; la détection est du code. Les sortir en YAML demande donc d'écrire un interpréteur de
  motifs, pas un simple export — ce qui change l'arbitrage sur Vale, dont c'est précisément le
  point fort.
- **Vale.** Écarté d'abord, à tort : l'argument de coût supposait un déploiement Windows, alors
  que le nettoyeur tourne dans la WSL — Vale y serait un binaire épinglé du `Containerfile`, comme
  pandoc et veraPDF, **sans aucune entrée `apps.lock`**. Partage proposé, non tranché : les onze
  familles lexicales non typographiques à Vale, la typographie au filtre Lua avec son rapport tiré
  du **diff du pont** (gratuit, et incapable de diverger du moteur qui corrige). Demanderait
  l'étape `extract` du brief — le `.txt` à un paragraphe par ligne, plus son index.
- **Le style de liste dans le gabarit.** Le gabarit livré n'en définit aucun (seul `Aucuneliste`).
  L'écrivain injecte donc sa propre définition. Si Robin en ajoute, l'écrivain l'utilisera.
- **Le cas A** (manuscrit déjà au gabarit) n'est validé par **aucun document réel** et reste
  délibérément conservateur. Risque connu et documenté : `ecrire()` insère toujours les deux
  tableaux fixes, qu'un document de cas A porte déjà.
- **`RE_NIVEAU_TITRE` de `pronto_modele.py`** ne reconnaît un style allemand que par le repli sur
  l'identifiant brut (`berschrift1`), jamais par « Überschrift 1 ». Risque latent pour la
  Zeitschrift.
- **L'allemand n'est calibré par rien** : le lot C du corpus n'existe pas.

---

## 9. La règle de méthode, et elle prime sur le reste

**« Tests verts » ne prouve rien.** Des tests verts prouvent qu'ils sont verts.

Pour chaque contrôle, trouver le **sabotage minimal** qui le fait rougir, l'appliquer pour de vrai,
constater **quels** tests tombent, restaurer, vérifier par empreinte.

**Vérifier d'abord que le sabotage atterrit** — afficher la ligne modifiée. Trois sabotages ont été
ratés dans cette session pour ne pas l'avoir fait : un décalage d'indice, une ancre introuvable, et
une précédence de `and` sur `or` qui ne désactivait qu'une moitié de condition.

**Cinq contrôles de ce chantier se sont révélés ne rien garder du tout** alors qu'ils étaient
verts, dont un sur la seule décision irréversible du produit (la survie de l'italique) et un sur
une exigence explicite de Robin (le style « Corps de texte »). Aucun n'avait été trouvé par
relecture ; tous par sabotage.

Et quand un contrôle reste vert alors qu'on casse ce qu'il prétend garder : **le dire**, ne pas le
réparer en silence.
