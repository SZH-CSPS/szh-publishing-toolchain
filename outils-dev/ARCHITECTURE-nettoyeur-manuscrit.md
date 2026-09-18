# Nettoyeur de manuscrit (article) — contrat d'architecture

**Ce fichier est le contrat que suit chaque module.** Il fixe les frontières, les noms et les
formats d'échange. Un désaccord avec ce fichier se règle en le modifiant, jamais en s'en
écartant dans le code.

Décidé avec Robin le 18.09.2026. Le brief fonctionnel reste
`outils-dev/Pipeline de relecture automatisée — Revue CSPS.md` ; ce fichier-ci ne le remplace
pas, il dit comment on le construit ici.

---

## 1. Ce que l'outil fait

Un manuscrit arrive de l'autrice, sous Word ou LibreOffice, dans l'état où elle l'a écrit.
L'outil en rend deux choses :

1. un `.docx` **au gabarit « Pronto — modèle d'article »**, nettoyé de tout formatage manuel,
   avec les titres retrouvés, chaque image dans un bloc figure et chaque tableau coiffé de sa
   rangée de métadonnées ;
2. un **rapport** de ce qu'il a fait et de ce qu'il n'a pas su faire.

Il tourne **à la réception**, avant toute relecture humaine.

### Les deux cas de figure

| | Ce que l'outil fait |
|---|---|
| **Cas B** — manuscrit quelconque | Restructuration complète : titres, styles, blocs figure et tableau, typographie. |
| **Cas A** — manuscrit déjà au gabarit | **Aucune restructuration.** Typographie et style de corps seulement. Le rapport décrit ce qui a été vu, sans y toucher. |

Reconnaissance du cas A : présence des styles `SZH Cle` **et** `SZH Aide` dans `word/styles.xml`
— c'est le critère que recommande l'étape 4 de `TODO-BRANCHEMENT-PARSER-V2.md`. Rien d'autre ne
sert de critère : ni un réglage de poste, ni le nom du fichier.

⚠ **Le cas A n'est validé par aucun document réel** (18.09.2026 : Robin n'en a pas). Il est donc
délibérément conservateur. À rouvrir dès que la validation formelle du lecteur Pronto, prévue la
semaine du 22.09.2026, aura produit un document rempli à la main.

---

## 2. Où le code tourne

**100 % Python**, sauf l'onglet du lanceur qui est en PowerShell WinForms — incompressible.

| | |
|---|---|
| Interpréteur | `python3` de la WSL `SZH-Publishing` — **3.13.5**, mesuré le 18.09.2026 |
| Bibliothèques | **stdlib seule** : `zipfile`, `xml.etree.ElementTree`, `difflib`, `json`, `re`. Pas de PyYAML, pas de python-docx, pas de jinja2 — ils ne sont pas dans la WSL de la flotte |
| Binaire externe | `pandoc` 3.5 de la WSL, et lui seul |
| Rapport HTML | rendu par `lib/gabarits.js` via `outils/rendre-gabarit.js`, comme les courriels et les exports |

⚠ **Révision du 19.09.2026, tranchée par Robin.** Le §2 disait ici « pas de Vale », au motif
qu'il coûterait une entrée `windows/apps.lock`. Cet argument supposait un déploiement
Windows — faux : le nettoyeur tourne **dans la WSL** (voir ci-dessus), où Vale entre comme un
**binaire épinglé de l'image**, exactement comme pandoc et veraPDF (URL versionnée GitHub
releases, `sha256sum -c`, `vale --version` vérifié en fin de build dans `image/Containerfile`)
— **zéro entrée `windows/apps.lock`**. Ce que le §7 (18.09.2026) affirmait aussi à tort :
« les règles lexicales sont des données Python ». C'est faux pour la détection — `Regle.
detecter` est une référence de fonction Python, pas une donnée — mais ça devient vrai pour de
bon avec Vale : les motifs lexicaux et éditoriaux (langage épicène, vocabulaire du handicap,
casse maison, citation directe, liaison et/&) sont maintenant des fichiers **YAML**, dans
`pipeline/vale/styles/`, que la rédaction édite sans coder. Vale lui-même ne réimplémente
aucune règle qu'on pourrait emprunter d'un écosystème existant : le catalogue reste
entièrement maison, Vale n'en est que le moteur d'exécution. Voir §7 pour les trois couches
et `pipeline/vale/LISEZMOI.md` pour ce que la rédaction peut modifier.

**Pourquoi la WSL et pas le Python de Windows** : `windows/apps.lock` ne pose que VSCodium
(`requis: true`) et SumatraPDF. Aucun Python n'est garanti côté Windows. La WSL, elle, est posée
sur chaque poste et **maintenue chaude** par la tâche planifiée « SZH - Prechauffage WSL »
(`windows/bootstrap.ps1`, déclencheur à l'ouverture de session). Appel à chaud mesuré :
**0,138 s**.

⚠ **La sortie de `wsl.exe` n'est pas de l'UTF-8 propre** (UTF-16 constaté sur `wsl -l -v`, poste
de Robin, 18.09.2026). Le décodage se fait **une fois**, dans l'assistant PowerShell, jamais dans
chaque appelant.

---

## 3. Les modules

Convention du dépôt, déjà suivie par `pronto_modele.py` / `pronto-lire.py` : **un module
importable porte un tiret bas, une CLI porte un tiret**.

| Fichier | Rôle | Ne sait rien de |
|---|---|---|
| `pipeline/manuscrit_modele.py` | le modèle riche (§4) et **toutes les décisions** (§5) | Word, OpenDocument, pandoc |
| `pipeline/manuscrit_docx.py` | `.docx` → modèle riche | les décisions |
| `pipeline/manuscrit_odt.py` | `.odt` → modèle riche | les décisions |
| `pipeline/manuscrit_typo.py` | le pont typographique (§6) | les décisions |
| `pipeline/manuscrit_gabarit.py` | modèle riche → `.docx` au gabarit (§5.3) | les décisions |
| `pipeline/manuscrit_regles.py` | le catalogue de règles et le moteur d'alertes (§7) | les formats |
| `pipeline/manuscrit-nettoyer.py` | la CLI (§8) | tout le reste ; il ne fait que brancher |

La frontière est la même que celle qui a fait ses preuves sur le lecteur Pronto : **le lecteur
rend le style déjà résolu en son nom humain**, et c'est le seul endroit où `.docx` et `.odt`
diffèrent.

### Dette assumée, avec une date

`pipeline/pronto_docx.py` lit déjà le `.docx` vers un modèle plus pauvre. `manuscrit_docx.py`
lit le même format vers un modèle plus riche. **C'est une duplication, elle est temporaire et
bornée** : Robin valide formellement le lecteur Pronto la semaine du 22.09.2026, et le toucher
maintenant invaliderait cette validation.

⚠ Precision du 18.09.2026, plus favorable que prevu : `manuscrit_docx.py` **importe et reutilise
litteralement** `resoudre_style`, `pstyle`, `charger_styles`, `compter_marqueurs_page` et
`blocs_du_corps` de `pronto_docx.py` (en lecture seule, jamais modifies) au lieu de les recrire.
La duplication ne porte donc que sur ce que le modele riche ajoute, et `projeter_pronto()` est
fiable **par construction** plutot que par coincidence entre deux implementations separees.

Deux obligations qui tiennent la duplication en laisse :

- `manuscrit_docx.py` expose `projeter_pronto(document)` qui rend **exactement** le modèle de
  `pronto_docx.lire()` ;
- un test différentiel (`test/js/manuscrit-parite-lecteur.test.js`) exige que les deux lecteurs
  s'accordent sur les deux gabarits livrés. Il tombe dès qu'ils divergent.

Après la validation, `pronto_docx.py` devient une projection de `manuscrit_docx.py` et le test
différentiel disparaît avec la duplication. **Ce paragraphe se supprime ce jour-là.**

---

## 4. Le modèle riche

Cinq classes, `__slots__` partout, aucune dépendance. Toutes portent `source`, l'index du nœud
dans le document d'origine : c'est la carte de positions, et c'est elle qui rendra possible
l'écriture de révisions natives à l'étape 2 du brief.

```
Image(nom, octets, surface, alt, flottante, source, cx, cy, largeur_px, hauteur_px)
    ⚠ les quatre derniers champs ont été AJOUTÉS le 18.09.2026, à la fin et avec une
      valeur par défaut : l'ordre positionnel des six premiers ne bouge pas, pour ne
      rien casser chez qui construit déjà une Image.
    nom         nom de fichier sous word/media/ ou Pictures/
    octets      le contenu du fichier — l'écrivain en a besoin
    surface     EMU², 0 si non déclarée (même convention que docx-meta.py)
    cx, cy      la boîte d'affichage en EMU, SÉPARÉMENT. Leur produit est `surface`,
                mais le produit seul ne permet de rien calculer : voir ci-dessous.
    largeur_px  dimensions en pixels du FICHIER, lues dans ses octets (en-tête PNG
    hauteur_px  IHDR / JPEG SOF / GIF / BMP), 0 si le format est inconnu ou vectoriel.
                C'est la seule mesure sur laquelle la qualité se gagne.
    alt         texte alternatif déclaré, '' si absent
    flottante   vraie si l'image est ancrée (w:anchor) et non en ligne (w:inline)

Fragment(texte, image, forme, lien, source)
    texte      str, jamais None ; '' quand le fragment porte une image
    image      Image ou None
    forme      dict figé : gras, italique, souligne, exposant, indice, barre,
               petites_capitales, majuscules, police, taille (demi-points),
               couleur, surlignage. Valeur None = « non déclaré », à distinguer
               de False = « déclaré éteint ».
    lien       URL ou None
    source     index du w:r dans son paragraphe

Paragraphe(style, niveau_declare, niveau_retenu, fragments, liste, alignement,
           retrait, source)
    style           nom humain résolu : 'heading 1', 'Body Text', 'SZH Cle', ''
    niveau_declare  1..3 si le STYLE dit titre, 0 sinon. Jamais une déduction.
    niveau_retenu   rempli par classer_titres(). 0 = corps. C'est le seul champ
                    que les décisions écrivent.
    liste           (numId, ilvl, format) ou None. `format` vaut 'puce', 'numero',
                    ou '' quand il n'a pas pu être établi — JAMAIS deviné.
                    ⚠ Il ne se lit PAS dans le paragraphe : le `w:numPr` n'y porte
                    qu'un numId et un niveau. Le `w:numFmt` vit dans
                    word/numbering.xml, via w:num -> w:abstractNum -> w:lvl, et un
                    w:lvlOverride peut le redéfinir pour un niveau donné. Le
                    lecteur charge ce fichier UNE fois par document ; absent, tous
                    les formats valent ''.
    source          index du w:p dans le corps

Cellule(colspan, rowspan, entete, blocs)
    blocs      liste de Paragraphe | Tableau, dans l'ordre, imbrication comprise

Tableau(rangees, page, source)
    rangees    liste de listes de Cellule ; une cellule masquée par une fusion
               n'y figure JAMAIS, le lecteur l'a déjà sautée
    page       numéro de page ou None — JAMAIS deviné (voir §10)

Document(blocs, styles, langue, revisions, commentaires, notes, source)
    blocs         liste de Paragraphe | Tableau, premier niveau, dans l'ordre
    styles        noms des styles présents dans styles.xml — sert au cas A
    langue        langue déclarée du document, ou ''
    revisions     nombre de w:ins / w:del trouvés
    commentaires  nombre de commentaires trouvés
    notes         les notes de bas de page, mêmes classes
```

`texte` est **déjà normalisé** par le lecteur, comme le fait déjà `pronto_modele` — ⚠ **sauf les
trois substitutions de tiret**, retirées le 19.09.2026 (voir la révision ci-dessous) : le VRAI
tiret du document (cadratin, demi-cadratin, insécable) doit survivre dans le modèle riche. Un
lecteur ne rend jamais de texte brut pour autant : le compactage d'espaces, lui, reste appliqué.

⚠ Correction du 18.09.2026 : `normaliser()` **ne vit pas dans `szh_commun.py`**, contrairement à
ce que ce contrat affirmait d'abord. Elle est recopiée à l'identique dans `pronto_modele.py`,
`docx-titres.py`, `docx-meta.py` et `docx-tables.py`. On l'importe donc depuis `pronto_modele`,
qui ne connaît ni Word ni OpenDocument — l'import ne franchit aucune frontière du §3. Seule
`avertir()` vient bien de `szh_commun`. Cette quadruple copie est un défaut du dépôt, antérieur à
ce chantier ; elle n'est pas à corriger ici.

### ⚠ Révision du 19.09.2026

Défauts constatés sur le corpus réel en préparant l'écriture (`manuscrit_gabarit.py`) et le pont
typographique : le lecteur détruisait les tirets à la source, perdait plusieurs sources de texte
en silence, et le modèle ne distinguait pas la mise en forme DIRECTE de celle EFFECTIVEMENT
appliquée par la cascade des styles — une distinction dont `classer_titres()` (§5.1) a besoin
pour comparer un vrai titre stylé (mise en forme portée par le style, jamais par le run) à un
faux titre habillé de mise en forme directe. Corrigés dans `manuscrit_docx.py` :

- **Les tirets ne sont plus détruits.** Les trois substitutions de `pronto_modele.normaliser()`
  (–, —, ‑ → `-`) ne s'appliquent plus à `Fragment.texte` (mesuré : 4 cadratins et 89
  demi-cadratins du corpus réel dégradés en simple trait d'union avant cette correction, avant
  même que la règle typographique T2, qui décide justement entre eux, ait pu les voir).
  `projeter_pronto()` reste, lui, l'exact miroir de `pronto_docx.lire()` (§3, dette assumée) :
  c'est SEULEMENT dans la projection que `normaliser()` continue de s'appliquer.
- **`w:noBreakHyphen`** rend désormais U+2011 (le vrai trait d'union insécable), plus un simple
  `-`. **`w:tab`** rend `'\t'`, **`w:br`/`w:cr`** rendent `'\n'` — plus une simple espace : c'est
  ce qui rend enfin utile le nettoyage en tête/queue de paragraphe du §5.2 (mesuré mort avant
  cette date, ces caractères étant déjà des espaces à son arrivée). Sans effet sur
  `projeter_pronto()` : `pronto_modele.normaliser()` traite `'\t'`/`'\n'` comme un blanc,
  exactement comme l'espace qu'ils remplaçaient.
- **`w:sym`** (Insertion > Symbole) est maintenant lu : le caractère de `w:char` est rendu, avec
  une correspondance vers l'Unicode réel pour la puce Wingdings/Symbol usuelle (U+F0B7 → •) ;
  tout le reste est repris tel quel et signalé (`symboles-police-speciale`), jamais en silence.
- **`w:fldSimple`** est déplié (ajouté à la liste des conteneurs « passe-plat ») : sa valeur
  affichée, mise en cache par Word dans un `w:r` enfant, est désormais lue comme du texte normal
  — l'avertissement `champs-word-non-resolus` l'affirmait déjà, à tort, avant cette date.
- **`w:sdt` de niveau BLOC** (un contrôle de contenu enveloppant un ou plusieurs `w:p` entiers,
  enfant direct du corps ou d'une cellule) est déplié avant tout parcours : il faisait
  disparaître ces paragraphes sans le moindre avertissement (`blocs_du_corps()` de
  `pronto_docx.py`, repris tel quel, ne reconnaît que `w:p`/`w:tbl`). Le niveau RUN était déjà
  couvert.
- **`word/endnotes.xml`** est lu, comme les notes de bas de page (voir `Document.notes`
  ci-dessous).
- **Les notes ORPHELINES** — présentes dans `footnotes.xml`/`endnotes.xml` mais qu'AUCUN
  `w:footnoteReference`/`w:endnoteReference` n'appelle dans `document.xml` — n'entrent PAS dans
  `Document.notes` (signalées, jamais en silence : `notes-orphelines`). Ajout du superviseur,
  sur mesure de l'agent de l'écrivain : `'continuationNotice'` (le texte « … suite » que Word
  pose en bas d'une page où une note continue) manquait à la liste des types techniques déjà
  exclus (`separator`, `continuationSeparator`) — mesuré sur 4 fichiers réels (`1bis`,
  `2-dense`, `2-grappes`, `5bis`), chacun ne portant QUE ce type de note fantôme dans ses deux
  fichiers de notes, sans un seul renvoi correspondant : ces quatre fichiers n'ont, après
  filtrage, plus AUCUNE note. Le filtre orphelines est GÉNÉRAL (toute note jamais appelée, pas
  seulement les types techniques) : une note ordinaire mal reportée ou orpheline d'une
  suppression manuelle du renvoi tombe dans le même filet.
- **Le décompte d'images VML héritées** (w:pict / mc:Fallback) comptait les OCCURRENCES de
  `v:imagedata`, pas les identifiants DISTINCTS (mesuré : facteur 5 en trop sur un fichier réel,
  un même r:id répété plusieurs fois dans un groupe). Corrigé, ET ces images sont maintenant
  **récupérées** quand leur relation résout vers un média présent dans l'archive — jusque-là,
  cinq médias sur vingt-et-un d'un même fichier réel n'apparaissaient dans AUCUNE sortie.
- **`Image.source`** porte désormais l'indice du `w:p` PORTEUR dans le corps — avant cette
  correction, il recevait par erreur l'indice du `w:r` (celui de `Fragment.source`, qui lui reste
  inchangé, §4 : « index du w:r dans son paragraphe »), donnant `source=0` pour la quasi-totalité
  des images d'un document réel.
- **La liste d'un paragraphe** (§5.4) se résout aussi depuis un `numPr` HÉRITÉ du style de
  paragraphe (chaîne `w:pStyle → w:basedOn → …`), plus seulement depuis un `numPr` posé
  directement. **`numId="0"`** (convention Word : « retire explicitement la numérotation
  héritée ») rend `None` (« pas de liste »), plus une liste de format indéterminé.
- **`_compter_revisions()`** compte aussi `footnotes.xml` et `endnotes.xml` : un suivi de
  modifications confiné aux notes n'était pas détecté avant cette date.

Deux champs ajoutés au modèle riche, à la fin de `__slots__` et de la signature (même convention
que les quatre champs d'`Image` ajoutés le 18.09.2026 : l'ordre positionnel des champs d'origine
ne bouge pas) :

```
Fragment(texte, image, forme, lien, source, note, effectif)
    note        identifiant de la note appelée par ce fragment (w:footnoteReference /
                w:endnoteReference), ou None. texte == '' quand ce champ est rempli — même
                convention que `image`. Une note de fin porte un identifiant DÉCALÉ au-delà du
                plus grand identifiant de note de bas de page (manuscrit_docx.py le calcule ;
                ce champ ne dit pas lui-même de quelle famille vient la note).
    effectif    dict figé, mêmes clés que `forme` (FORME_CLES) : la mise en forme
                EFFECTIVEMENT appliquée — directe (= `forme`) sinon style de caractère
                (w:rStyle) sinon chaîne des styles de paragraphe (w:pStyle → w:basedOn → …, y
                compris leur w:rPr) sinon w:docDefaults/w:rPrDefault. None seulement si rien
                n'est déclaré nulle part. `forme` reste inchangée : jamais la cascade des
                styles pour le NETTOYAGE (§5.2). Motivé par le §5.1 : « corps sans taille
                déclarée » et « faux titre déclaré 12 pt » sont aujourd'hui jugés différents
                par la forme DIRECTE alors qu'ils font tous deux 12 pt une fois la cascade
                résolue.

Paragraphe(…, alignement, retrait, source, alignement_effectif)
    alignement_effectif   direct (= `alignement`) sinon la chaîne des styles de paragraphe ;
                          '' si non déclaré nulle part. Même principe que Fragment.effectif.

Document(blocs, styles, langue, revisions, commentaires, notes, source)
    notes       CHANGÉ : dict[int, list[Paragraphe | Tableau]], le contenu de CHAQUE note par
                identifiant — c'était une liste plate qui fondait toutes les notes ensemble,
                sans dire laquelle appelle quoi. Notes de bas de page ET de fin cohabitent
                (identifiants disjoints, voir plus haut).
```

`pronto_docx.resoudre_style`/`charger_styles` ne remontent PAS une chaîne `w:basedOn` — ils ne
résolvent qu'un `styleId` vers son nom humain (un seul niveau). La résolution de `Fragment.effectif`
et du `numPr` hérité (ci-dessus) lit `styles.xml` une seconde fois dans `manuscrit_docx.py`
(`_index_styles_complet`), pour la chaîne `basedOn` et les `w:rPr`/`w:pPr` de chaque style —
`pronto_docx.charger_styles` reste, lui, inchangé et sert toujours à résoudre le NOM affiché.

---

## 5. Les décisions

Toutes dans `manuscrit_modele.py`, toutes pures : elles prennent un `Document`, rendent des
décisions et une **trace**. Chaque décision tracée devient une ligne du rapport. Aucune décision
silencieuse, jamais.

### 5.1 Les titres — quatre passes, jamais un critere isolé

⚠ **Refonte du 18.09.2026.** La conception précédente jugeait chaque paragraphe SEUL, contre des
valeurs absolues reprises de `docx-titres.py` (12 mots, taille ≥ 1,2 × la dominante). Mesurée sur
le corpus réel, elle rattrapait 29 des 33 faux titres mesurables — mais **détruisait autant de
vrais titres qu'elle manquait de faux** (4 et 4), et ne promouvait que 6 des 17 pseudo-titres d'un
article sans aucun style. Les quatre vrais titres détruits sont des intertitres de la Revue, longs
et en phrase : « Informations sur les autrices et auteurs : » (7 mots, rétrogradé sur son
deux-points), et trois de 13, 17 et 19 mots.

Le défaut n'était pas le seuil : c'était de juger en absolu ce qui n'a de sens qu'en **relatif**.
La bonne question n'est pas « ce paragraphe fait-il moins de douze mots », c'est **quelles classes
de mise en forme existent dans CE document, et lesquelles se comportent comme des titres**.

Quatre passes, dans cet ordre. Aucune ne pondère quoi que ce soit : **pas de score, pas de
coefficient**. Un score se règle à la main, ne se calibre pas sur quatre fichiers, et ne se
raconte pas à une relectrice — « 0,62 pour un seuil à 0,65 » n'a jamais aidé personne.

#### Passe 1 — les exclusions, avant toute heuristique

Ne peuvent JAMAIS devenir un titre par déduction :

- un paragraphe portant un **style maison** `SZH …` — `SZH Question (interview)`, `SZH Important`,
  `SZH Hervorhebung`, `SZH Cle`, `SZH Aide`. Dans un entretien, les questions sont courtes, en
  gras, nombreuses et régulièrement réparties : signature parfaite de niveau de titre, et pourtant
  ce ne sont pas des titres ;
- un paragraphe en style `Quote` / `Citation`, ou un style de légende ;
- tout ce qui est dans **l'étendue de bibliographie** — repérée par `TITRES_BIB` de
  `pipeline/filters/szh-citations.lua`, le lexique déjà partagé avec le filtre de composition et
  le cockpit. Ses entrées sont courtes, homogènes, souvent en retrait négatif : elle formerait un
  groupe très convaincant. Elle est exclue **explicitement**, jamais par chance ;
- un paragraphe en liste, dans un tableau, ou vide.

⚠ Un entretien qui arrive **hors gabarit** ne porte aucun style `SZH` : ses questions sont
simplement en gras, et rien ne les distingue d'un niveau de titre. **Arbitrage de Robin du
18.09.2026 : c'est acceptable** — « si les questions sont détectées comme H2, on fera avec ». Le
cas reste au banc, mais ce qu'on y vérifie change : non plus que les questions échappent à la
promotion, mais qu'elles forment **un seul** niveau cohérent et que le rapport signale le nombre
inhabituel.

#### Passe 2 — l'état déclaré décide de ce qu'on cherche

On compte les paragraphes par niveau déclaré. L'état déclaré est **cohérent** quand le total des
titres tient dans `[MIN_TITRES, MAX_TITRES]` et qu'il n'emploie pas plus de trois niveaux.

Ces bornes ne sont pas inventées : mesurées sur les 58 articles de
`tmp/corpus-relecture/manuscrits-par-article.csv`, les 36 qui portent de vrais styles de titre en
ont **au minimum 2, en médiane 9, au maximum 21**. Les lignes directrices plafonnent par ailleurs
à trois niveaux, des deux côtés.

- **état cohérent** → l'heuristique **ne promeut plus** aux niveaux déjà employés : les styles
  font foi pour eux ;
- **un niveau manque** (pas de niveau 3, ou seulement du niveau 1) → la passe 3 cherche des
  candidats **pour ces niveaux-là seulement** ;
- **aucun style de titre** → la passe 3 cherche les trois niveaux. C'est le cas de **22 des 58
  articles** : plus d'un manuscrit sur trois.

⚠ **« Des styles présents » ne veut pas dire « des styles fiables ».** Les quatre fichiers piégés
du corpus portent tous des Titre 1 / Titre 2 en nombre parfaitement cohérent, et 29 de ces titres
sont faux. La cohérence de l'état déclaré désactive donc la **promotion**, JAMAIS la
**rétrogradation** de la passe 4.

#### Passe 3 — les signatures

Chaque paragraphe candidat porte une **signature** : taille arrondie, gras, italique, souligné,
police, alignement, casse. On groupe par signature identique — un regroupement exact, déterministe,
sans coefficient.

Un groupe devient un niveau de titre quand **tous** ces faits tiennent :

- sa longueur est **courte relativement au corps de ce document**, jamais dans l'absolu. Mesuré :
  les paragraphes de corps de la Revue font 768 à 1 525 signes, ses intertitres 17 à 19 mots — dix
  fois plus courts. C'est le rapport qui compte, pas un nombre de mots ;
- sa signature **diffère** de la signature dominante du corps ;
- ses occurrences sont **réparties** dans le document, pas toutes collées ;
- ses longueurs sont homogènes entre elles.

L'ordre des groupes donne les niveaux : taille décroissante d'abord, puis le gras, puis l'italique.
⚠ **L'italique compte autant que le gras.** L'article `3_VF_Chanier-Delorme` a ses titres de
niveau 2 en italique, presque sans changement de taille : l'ancienne règle, qui ne regardait que le
gras et la taille, n'en voyait aucun.

**Le plafond de trois niveaux est une contrainte dure** : elle vient des lignes directrices, des
deux côtés. Au-delà, le résultat est rejeté.

**Le nombre total, lui, n'est PAS un motif de rejet** — révision du 18.09.2026, après l'arbitrage
sur l'entretien. Il était là pour écarter un groupement aberrant, et son cas d'usage principal
(les questions d'un entretien prises pour des titres) est désormais accepté. Gardé comme rejet, il
produirait le pire des deux mondes : un entretien de trente questions dépasserait le plafond, tout
le groupement serait écarté, et l'article ressortirait avec **zéro** titre.

Le nombre devient donc un **signal dans le rapport**, jamais une décision silencieuse :

> 38 titres retenus, bien au-delà de ce qu'on observe habituellement (médiane 9, maximum 21 sur
> les 36 articles stylés du corpus) — vérifiez qu'il ne s'agit pas d'un entretien ou d'un glossaire.

La relectrice tranche. L'outil ne jette rien en silence et n'accepte rien sans le dire.

#### Passe 4 — la rétrogradation

Un paragraphe **déclaré** titre dont la signature est celle du **corps** est rétrogradé, quel que
soit son nombre de mots. C'est ce qui règle le cas d'ouverture du chantier — un H2 posé sur trois
paragraphes qu'on a ensuite ramenés à la taille du corps — sans détruire un intertitre long, qui
garde, lui, la signature des autres titres de son document.

**Le seuil absolu de 12 mots et la ponctuation finale disparaissent de la rétrogradation.** Ils
ont détruit quatre vrais titres sur quatre fichiers, dont une rubrique standard de la Revue
rétrogradée pour un simple deux-points.

#### Passe 3 bis — l'adoption par signature de référence

Proposée par Robin le 18.09.2026, et elle règle l'articulation entre l'état déclaré et les groupes
découverts mieux que ce que ce contrat spécifiait d'abord :

> « typiquement quelqu'un balise 5 titres, le 6ème il le met juste italique + augmente la taille.
> Si p.ex. un H2 est utilisé régulièrement, vérifie sa mise en forme (p.ex. 12 pt italique) ; s'il
> y a quelques paragraphes isolés en 12 pt italique, alors les considérer comme des H2. »

Le titre déclaré fournit la **signature de référence** du niveau, et tout paragraphe non stylé qui
la porte est adopté **à ce niveau**. Plus de question « même niveau ou niveau différent » : le
niveau est donné par le style, pas déduit. Et rien n'est calibré à la main — le document fournit
sa propre référence.

**L'ORDRE EST CE QUI REND CETTE PASSE SÛRE**, et l'inverser la rend catastrophique :

1. **rétrograder d'abord** (passe 4) ;
2. **calculer la référence ensuite**, sur les titres déclarés **qui ont survécu** ;
3. **adopter enfin** les paragraphes qui portent cette signature.

⚠ Pourquoi cet ordre, mesuré sur le cas d'ouverture du chantier : `1_Résumé-article-revue-CSPS.docx`
porte un H2 posé sur **quatre** paragraphes — un vrai titre et trois paragraphes de corps. Calculée
avant rétrogradation, la signature majoritaire de ces quatre est celle **du corps** ; on adopterait
alors tout paragraphe du document qui la porte, c'est-à-dire **l'article entier promu en titre**.
L'échec serait silencieux, total, et sur le cas qui a motivé l'outil.

Deux garde-fous indissociables :

- **la référence doit être MAJORITAIRE** : on prend la signature modale des titres déclarés
  survivants d'un niveau, et on exige qu'elle couvre la majorité d'entre eux. Cinq H2 avec cinq
  mises en forme différentes ne donnent aucune référence — et on n'adopte rien ;
- **la référence ne doit JAMAIS être celle du corps.** Un style de titre dont la mise en forme
  directe a été réinitialisée donne la signature du corps ; adopter là-dessus promeut tout
  l'article. C'est le filet qui rattrape le cas précédent si la rétrogradation l'avait laissé
  passer.

Une adoption qui multiplierait le nombre de titres du document mérite le **signal** de la passe 3,
au même titre qu'un groupe trop nombreux.

#### En cas de doute : rien, et on le dit

Si aucun groupement ne convainc, **on ne promeut rien** et le rapport le dit — « aucune structure
de titres décelable : 23 candidats sans signature commune ». C'est le principe de `docx-titres.py`,
qui n'a jamais produit de faux titre en production, et c'est ce qui envoie la relectrice regarder
plutôt que de lui livrer un balisage inventé.

⚠ **Ce qu'on ne fait PAS** : resserrer les critères par itérations jusqu'à ce que le nombre de
titres paraisse acceptable. Une telle procédure optimise pour un chiffre plausible, pas pour une
réponse juste, et converge tranquillement sur une erreur bien peignée. Un article peut
légitimement porter 40 intertitres — un entretien, un glossaire, un dossier à rubriques.

#### Ce qui juge cette refonte

Elle remplace l'ancienne conception **si et seulement si** elle fait mieux sur les trois mesures
déjà prises, toutes reproductibles :

| mesure | ancienne conception |
|---|---|
| faux titres rattrapés (`2-*`, vérité terrain de `2-fabrique.csv`) | **29 / 33** |
| vrais titres détruits sur ces quatre fichiers | **4** — à ramener à 0 |
| pseudo-titres promus sur `3_VF_Chanier-Delorme` | **6 / 17** |

⚠ Elle vit dans le nettoyeur **seul**. `pipeline/docx-titres.py` est en service sur la chaîne
d'import et ne bouge pas tant que celle-ci n'a pas fait ses preuves.

### 5.2 Le formatage manuel

Ce qui **part** : police, taille, couleur, surlignage, petites capitales, majuscules forcées,
alignement, retraits, gras et souligné du corps de texte, sauts de ligne manuels en fin de
paragraphe, tabulations d'indentation, paragraphes vides consécutifs.

Ce qui **reste**, et c'est le point où l'outil peut faire des dégâts irréparables : **l'italique,
l'exposant, l'indice, les liens**. Un italique porte du sens — mot étranger, titre d'ouvrage,
terme technique — et le tuer est une perte qu'aucune relecture ne rattrape.

Ce qui est **signalé sans être touché** : un paragraphe entièrement en gras ou entièrement en
majuscules qui n'a pas été retenu comme titre. C'est peut-être un intertitre que l'heuristique a
raté ; ce n'est pas à l'outil d'en décider.

⚠ **Révision du 19.09.2026, décision du superviseur.** « Signalé sans être touché » était violé
pour le gras : un paragraphe de corps ENTIÈREMENT gras et non retenu comme titre voyait son gras
RETIRÉ dans la même passe qui le SIGNALE (mesuré : 16 paragraphes sur un fichier réel). Le gras
**intégral** d'un paragraphe de corps est désormais **conservé** (une relectrice doit pouvoir le
voir), le signalement reste dans le rapport. Le gras **partiel** du corps, lui, **part**
normalement — l'exception ne vaut que pour un paragraphe entièrement gras, jamais pour un simple
mot en gras au milieu d'une phrase, sous peine de protéger n'importe quel gras. Les majuscules
forcées, elles, restent retirées dans tous les cas : cette décision ne portait que sur le gras.

Descend à **toute profondeur** — cellules de tableau (à n'importe quelle imbrication) et notes
de bas de page / de fin (`Document.notes`) — depuis le 19.09.2026 : le nettoyage ne bouclait
avant cette date que sur les paragraphes de premier niveau (171 paragraphes de cellule, mesurés
sur le corpus réel, gardaient encore taille/police/couleur/gras).

Tout le corps reçoit le style **« Corps de texte »**. ⚠ Deux noms pour un seul style : `Body Text`
côté Word (`styleId` = `Corpsdetexte`), **`Text body`** côté LibreOffice. Toute règle qui
reconnaît le corps par son nom teste les deux formes.

### 5.3 Les blocs

- **Chaque image** devient un bloc figure du gabarit : une rangée de métadonnées
  (`Légende :`, `Texte alternatif :`, `Crédit :`, `Source :`, en style `SZH Cle`) puis l'image.
  Les champs que le manuscrit ne fournit pas restent **vides et listés dans le rapport** — jamais
  remplis d'un texte inventé.
- **Chaque tableau** reçoit en première rangée une cellule fusionnée sur toute sa largeur,
  portant les mêmes métadonnées.
- Une **légende déjà présente** dans le manuscrit (paragraphe voisin commençant par « Figure 1 »,
  « Abbildung 2 », « Tableau 3 »…) est reprise dans le champ `Légende :` et retirée du corps. Le
  lexique est celui de `RE_LEGENDE` dans `docx-titres.py`.
- Une **image flottante ou dans une zone de texte** est extraite si possible, **signalée
  toujours** : sa place dans le fil du texte n'est pas fiable.

⚠ **Révision du 19.09.2026, écrivain (`manuscrit_gabarit.py`).** Deux défauts mesurés sur le champ
`Légende :`, corrigés :

- la légende reprise du manuscrit **garde sa mise en forme** (italique, exposant…) au lieu d'être
  aplatie en texte plat avant d'être posée — mesuré : 2 exposants sur 2 du corpus perdus par
  l'ancienne version, tous dans des légendes (`docx-tables.py`, un tableau de résultats en m²) ;
- une **légende répartie sur deux paragraphes** — un titre bref en gras qui matche `RE_LEGENDE` à
  lui seul (« Tableau 1 », sans texte), suivi du texte de la légende proprement dit sur le
  paragraphe suivant — est reconnue comme UNE seule légende et les deux paragraphes sont retirés
  du corps. Mesuré sur un manuscrit réel (`outils-dev/Le coenseignement développemental_revue
  Suisse_10082026.docx`) : c'est exactement ce que fait son gabarit d'origine.

⚠ **Révision du 19.09.2026 — contrat partagé, notes de bas de page.** `Fragment.note : int | None`
porte l'identifiant de la note appelée par ce fragment (`texte == ''` dans ce cas, comme pour une
image) ; `Document.notes : dict[int, list[Paragraphe | Tableau]]` porte le contenu de chaque note,
par identifiant — les notes de fin sont lues comme des notes de bas de page, avec des identifiants
uniques. L'écrivain reporte chaque note APPELÉE (jamais celles qui ne le sont pas — orphelines,
tracées et non écrites) dans `word/footnotes.xml`, renumérotées à partir de 1 : le style de renvoi
et le style de paragraphe de note sont ceux du gabarit s'il en définit (recherche par le nom
canonique anglais du style, comme `heading 1`/`Body Text` ailleurs dans ce document), sinon un
simple exposant et `Corpsdetexte` — le gabarit livré n'a aujourd'hui ni l'un ni l'autre. Une note
appelée mais absente de `document.notes` (ne devrait jamais arriver depuis un vrai lecteur) reçoit
un contenu vide, tracé, plutôt qu'un document invalide.

### 5.4 Les listes

Décidé avec Robin le 18.09.2026, après mesure. **Les listes du manuscrit sont reportées.**

Portée mesurée sur le corpus réel : **3 manuscrits sur 11, 20 paragraphes** (`3_`, `3bis_`, `4_`).
Les aplatir en paragraphes ordinaires est une perte visible, pas un détail.

Mesuré sous **pandoc 3.5**, celui qui compile en production — et sous lui seul, celui du PATH
Windows étant un autre binaire : un `w:numPr` **posé sur le paragraphe** et un `w:numPr` **hérité
d'un style** donnent un AST strictement identique (`BulletList` dans les deux cas). L'import ne
départage donc pas les deux formes.

Ce qu'on écrit : **les deux à la fois**, parce que c'est ce que Word lui-même produit quand une
autrice clique sur le bouton « puces » — un style ET un `numPr` sur le paragraphe. Rendre à la
rédaction ce que Word aurait écrit est le plus sûr pour un document qui sera rouvert dans Word.
Si l'on ne devait en garder qu'une, ce serait la forme **native** : elle est autoportante et ne
demande à aucun consommateur de résoudre l'héritage de style.

⚠ **Le `numId` du manuscrit ne se recopie JAMAIS** : il désigne une définition de
`numbering.xml`, et ce fichier n'est pas celui du gabarit. Le report se fait par
**correspondance** — puce vers la définition à puces, numérotée vers la définition numérotée,
`ilvl` conservé.

Le gabarit livré ne définit **aucune** liste (seul `Aucuneliste` y figure, qui dit le contraire).
L'écrivain emploie donc la définition du gabarit **si elle existe**, et **injecte la sienne**
sinon, en le disant dans la trace. Ce choix découple le code du gabarit, qui n'est pas figé :
Robin le retouchera et le fera traduire, et le nettoyeur ne doit pas casser ce jour-là.

---

## 6. Le pont typographique — un seul moteur, littéralement

La typographie de la maison, c'est `pipeline/filters/szh-typographie.lua` : douze règles A1..C2,
1 218 lignes, des règles **opposées** entre le français et l'allemand suisse, des exclusions
contextuelles (DOI, dates ISO, COVID-19, le `ß` qu'on ne touche jamais). **On ne la réécrit pas
en Python.** Le nettoyeur appelle le filtre existant.

Chaîne mesurée le 18.09.2026 dans la WSL, pandoc 3.5 :

```
pandoc -f json -t json -M lang=<fr|de> --lua-filter pipeline/filters/szh-typographie.lua
```

Entrée : un AST pandoc construit à la main depuis les fragments d'un paragraphe. Sortie : le même
AST, normalisé. Vérifié en passant un AST JSON **directement** au filtre : `p.⍽5`, insécable devant
`:` et `;`, apostrophe typographique, chevrons avec insécables intérieures, `42⍽%`, et le cadratin
`—` ramené à insécable + demi-cadratin.

⚠ Correction du 18.09.2026 : une première mesure annonçait aussi `--` → `⍽–`. **C'était faux** —
cette conversion-là venait de l'extension `smart` du lecteur Markdown de pandoc, pas du filtre. Un
AST construit à la main, ce que ce module fait, n'en bénéficie pas : un double tiret ASCII littéral
traverse le filtre inchangé. Sans conséquence réelle (l'autocorrection de Word pose un vrai cadratin,
que le filtre traite bien), mais **ne pas réimplémenter `smart` en Python** pour combler l'écart :
ce serait un second moteur pour un cas rare.

Le filtre émet en plus, sur stderr, ses propres avertissements `[typo-avertissement]` — les codes C1
(le `ß`) et C2 (guillemets droits non appariés), qu'il signale sans jamais les corriger. Ces lignes
deviennent des alertes du rapport telles quelles : rien à réécrire.

⚠ Révision du 19.09.2026 : ce paragraphe décrivait une intention non tenue. `_appeler_pandoc()` ne
lisait stderr QUE sur l'échec de l'appel — sur un succès, ces lignes étaient capturées puis jetées
en silence, et `avertissements_typo` du contexte passé aux règles restait `[]` codé en dur dans la
CLI. Mesuré sur lot-A avant correction : 0 avertissement remonté sur 10 documents, dont 7 en
émettaient réellement (majuscule accentuée, guillemets droits). Corrigé : `normaliser_paragraphes()`
rend maintenant `(paragraphes, traces, abandons, avertissements, statut)` — l'avant-dernier élément
porte ces lignes brutes sur un appel réussi, la CLI les place dans `contexte['avertissements_typo']`.

La langue se passe en `-M lang=` : `resoudre_langue()` du filtre la prend comme **premier**
candidat. ⚠ Révision du 19.09.2026 (voir §8) : cette langue vient désormais STRICTEMENT du produit
(`revue` → `fr`, `zeitschrift` → `de`), plus jamais de `document.langue` — un article français
déclaré `de-CH` recevait la typographie allemande.

### Sous Linux (production), pandoc est appelé directement — révision du 19.09.2026

Le pont appelait TOUJOURS `wsl.exe -d SZH-Publishing -- pandoc ...`, même quand cette CLI tourne
DÉJÀ dans la WSL (le lanceur l'exécute via `wsl -d SZH-Publishing -e python3 ...`). Or `wsl.exe`
n'existe pas dans la distro, et son absence ne lève **aucune exception explicite** :
`subprocess.run(['wsl.exe', ...])` échoue comme n'importe quel exécutable introuvable, capturée
comme une indisponibilité de pandoc — un repli **silencieux**. Mesuré sur lot-A avant correction :
845 paragraphes sur 845 rendus inchangés, code de sortie 0, aucun signe visible de la panne.

Une seule fonction décide désormais, `_executer_pandoc()`, testée dans les deux branches :
`sys.platform != 'win32'` → pandoc du PATH, appelé directement, avec le chemin **Linux natif** du
filtre (sans `wslpath`, sans `wsl.exe` — ces deux-là n'existent pas dans la distro) ; sous Windows
(le poste de développement), le chemin `wsl.exe` + `wslpath -a` de toujours, inchangé.

### La réinjection

Word découpe le texte d'un paragraphe en `w:r` de façon imprévisible, parfois au milieu d'un mot.
Le texte revient normalisé **en un bloc** ; il faut le redistribuer dans les runs d'origine sans
perdre leur mise en forme.

Méthode imposée : `difflib.SequenceMatcher` **caractère par caractère** entre le texte d'origine
et le texte normalisé. Les corrections typographiques sont locales et petites (substitutions,
insertions d'espaces insécables), donc le diff l'est aussi. Chaque segment conservé garde le
`forme` de son run d'origine ; un caractère inséré prend celui de son voisin de gauche.

⚠ **Révision du 19.09.2026 — le garde-fou a changé de nature.** L'ancienne version comparait
chaque caractère perdu/ajouté par la réinjection à une liste blanche « typographique », et
abandonnait le paragraphe dès qu'un caractère en sortait. Mesuré sur lot-A : **4 paragraphes sur
845 abandonnés à tort**, parce que le filtre corrigeait du contenu réel que la liste ne connaissait
pas (`A` → `À` en début de phrase, `3ème` → `3e`, une espace fine U+2009 → l'insécable fine U+202F,
une apostrophe courbe ouvrante U+2018 → un chevron simple U+2039). **Le filtre a raison dans les
quatre cas : ce pont n'a pas à le rejuger.**

Le vrai invariant, désormais le seul : **le texte réinjecté dans les fragments doit être
identique, caractère pour caractère, au texte que le filtre a rendu** — vérifié explicitement (une
« garde de sortie »), jamais supposé, même si l'algorithme du diff le garantit déjà par
construction. Une seconde garde, symétrique, vérifie que le texte envoyé au filtre pour une unité
n'a pas divergé de la concaténation de ses fragments d'origine entre les deux passes (« garde
d'entrée »). Les deux échecs restent réels, mais deviennent des bugs de CE module — jamais un
verdict sur une correction du filtre. On ne rend jamais un texte qu'on n'a pas su reconstruire.

---

## 7. Le moteur de règles

Le catalogue vient des deux PDF `outils-dev/Redaktionsrichtlinien {Revue,Zeitschrift} 2025.pdf`
— eux seuls font foi. Le brief en propose une liste : c'est une **proposition**, pas une source.

⚠ **Révision du 19.09.2026, tranchée par Robin.** Ce paragraphe affirmait « chaque règle est
une donnée, pas une fonction » pour justifier l'absence de Vale. C'était vrai pour les
**métadonnées** (id, sévérité, chapitre...), FAUX pour la **détection** : `Regle.detecter`
est une référence de fonction Python (`_detecter_*`), jamais une donnée — sortir une règle en
YAML sans réécrire ce champ n'était donc pas un simple export. Trois couches, chacune avec un
**seul propriétaire**, remplacent l'ancien « tout est un `Regle` Python » :

| Couche | Propriétaire | Édité par |
|---|---|---|
| Typographie (espace insécable, apostrophe, guillemets, tiret…) | `pipeline/filters/szh-typographie.lua` (§6) | qui code, en Lua |
| **Lexicale et éditoriale** (langage épicène, vocabulaire du handicap, casse maison, liaison et/&, citation directe, nom des éditions) | **`pipeline/vale/styles/*.yml`**, exécutées par **Vale** | la rédaction, en YAML |
| **Structurelle** (longueurs, niveaux de titre, cohérence d'une bibliographie, accessibilité) | `pipeline/manuscrit_regles.py`, ce module | qui code, en Python |

La frontière entre la deuxième et la troisième couche : un motif de texte (« ce mot-là est
proscrit ») est lexical, Vale ; une comparaison entre plusieurs éléments du document (« ce
titre saute un niveau », « ces deux références ne sont pas dans l'ordre ») est structurelle,
Python — un motif seul ne peut pas la voir.

**Vale entre dans l'image WSL comme binaire épinglé**, exactement comme pandoc et veraPDF :
URL versionnée GitHub releases, `sha256sum -c`, `vale --version` vérifié en fin de build
(`image/Containerfile`) — **aucune entrée `windows/apps.lock`**, puisque le nettoyeur tourne
dans la WSL (§2). Le catalogue lexical reste entièrement maison : Vale n'en est que le moteur
d'exécution (`existence`/`substitution`), jamais un jeu de règles emprunté à un écosystème.
Voir `pipeline/vale/LISEZMOI.md` pour ce que la rédaction peut modifier elle-même, et
`pipeline/manuscrit_vale.py` pour le pont (extraction, appel de `vale`, conversion des
constats en alertes du contrat).

**Ce qui a migré vers Vale**, retiré de `pipeline/manuscrit_regles.py` : toute la famille
`Epicene.*`, toute la famille `Vocabulaire.*`, `Structure.MajusculeReference`,
`APA.DeuxAuteurs.*` (liaison et/&), `APA.CitationSecondeMain.*`, `APA.CitationDirectePage`.
Le catalogue Python ne garde que le structurel : longueurs, niveaux de titre (un **saut** de
niveau, pas un niveau impossible — voir plus bas), cohérence d'une bibliographie déjà
extraite (ordre, troncature, année dupliquée), accessibilité, style nominal allemand.

⚠ **Trois pièges Vale mesurés le 18.09.2026 (Vale 3.22.0), à ne pas repayer :**

- **un nom de fichier LITTÉRAL en tête de section d'un `.vale.ini` (`[corps-fr.txt]`) ne
  déclenche JAMAIS aucune règle**, silencieusement — Vale exige un caractère générique en
  tête (`[*corps-fr.txt]`) pour reconnaître la portée d'un fichier. Aucune erreur, aucun
  avertissement : zéro alerte, comme si le style n'était pas chargé ;
- **un motif dont le premier ou le dernier caractère n'est pas un caractère de mot** (`&`,
  `(`, un guillemet) **ne matche jamais** sous une règle `existence` sans `nonword: true` —
  Vale entoure chaque motif d'un `\b` implicite, qui échoue contre un symbole des deux côtés ;
- **RE2 (le moteur régulier de Vale/Go) ne supporte ni lookahead ni lookbehind.** Une règle
  qui a besoin de viser un mot précis à l'intérieur d'un contexte plus large (un « et » dans
  une parenthèse de citation, un DOI mal formé) capture le contexte entier ; la précision
  finale (found/suggested exacts, rejet d'un faux positif comme « et al. ») se calcule
  ensuite en Python dans `manuscrit_vale.RAFFINEURS` — jamais en resserrant le motif YAML, ce
  qui ne suffit pas sans lookaround.

Une alerte porte les champs du brief, inchangés : `rule`, `severity`, `action`, `para`, `span`,
`found`, `suggested`, `message`. `action` n'est pas utilisée au lot 1 mais toujours renseignée :
c'est elle qui pilotera l'écriture de révisions natives plus tard.

**Aucune règle de résolution d'image dans ce catalogue.** Le dépôt sait déjà juger une image :
`vscodium-extension/szh-cockpit/lib/qualite-image.js` porte les seuils (figure : 1 000 px
plancher, 2 000 px conseillé ; portrait : 400 / 1 000) et, surtout, **le raisonnement qui les
fonde** — `print.css` compose l'A4 sur 650 px CSS ≈ 6,77 pouces, donc 2 000 px valent 300 ppp à
l'impression. Réécrire ces nombres en Python en ferait un second jeu, qui divergerait à la
première évolution de la maquette.

Le partage se fait au point le moins cher : le nettoyeur **rapporte les dimensions en pixels**
(un fait, mesuré), et le **verdict** est rendu par `qualite-image.js` au moment où le rapport
HTML est composé — ce rapport passe déjà par `lib/gabarits.js`, donc par Node, donc par le module
qui porte les seuils. Zéro duplication, et une seule vérité sur ce qui est « trop petit ».

**Le piège OQLF / CSPS**, à couvrir par un test nommé : l'Office québécois privilégie « personne
handicapée » ; les lignes directrices CSPS, adossées au MDH-PPH, privilégient « personne en
situation de handicap ». Un import brut du vocabulaire OQLF signalerait donc comme déconseillé un
terme que la rédaction recommande. **« personne en situation de handicap » ne lève aucune
alerte.** (Depuis le 19.09.2026 : la règle qui le garantit, `CSPS.Vocabulaire.Handicap`, vit
dans `pipeline/vale/styles/CSPS/Vocabulaire/Handicap.yml` — le test nommé, lui, a migré vers
`test/js/manuscrit-vale.test.js`.)

---

## 7 bis. Bibliographie — contrôle, DOI, mise en forme

*Révision du 19.09.2026.*

`pipeline/manuscrit_biblio.py`. Module **pur** comme `manuscrit_regles.py` : il ne sait rien de
Word ni d'OpenDocument, il reçoit du texte de paragraphe déjà extrait (`{'texte':…,
'source':…}`, le schéma déjà en usage pour le Contexte de `manuscrit_regles.py`) et rend des
alertes au même format à huit champs (`rule`, `severity`, `action`, `para`, `span`, `found`,
`suggested`, `message`).

**Ne recopie rien** de ce qui existe déjà : `pronto_modele.normaliser()`/`aplatir()`/
`lire_titres_bib()`/`_titre_est_biblio()` (repérage de l'étendue d'une bibliographie, identique
à celui de `manuscrit-nettoyer.py`) ; `docx-meta.py` — chargé par chemin, il porte un tiret —
pour `nettoyer_doi()`, `RE_DOI`, `langue_du_doi()`, `decouper_prenom_nom()`, `nom_plausible()`,
`PARTICULES`.

### Ce que le module fait

1. `analyser_reference(texte)` découpe UNE entrée APA 7 (fr/de) en `auteurs` (liste de
   `{nom, initiales}`), `nb_auteurs`, `annee`/`suffixe`, `titre`, `conteneur`, `volume`,
   `numero`, `pages`, `editeur`, `doi` (canonique), `url`, `type`
   (`article|chapitre|ouvrage|rapport|web|inconnu`) et `confiance` (`haute|moyenne|basse`).
   Mesuré sur les 117 références réelles du corpus `tmp/corpus-relecture/lot-A` : **88/117
   (75 %) en confiance haute** ; en excluant les 9 entrées d'un fichier où l'extension de
   bibliographie s'est trompée de section (§ »Ce qui n'a pas pu être fait« ci-dessous, pas un
   défaut de ce module), **88/108 = 81,5 %**, au-dessus de la cible du chantier.
2. `citations_du_corps(paragraphes)` — chaque appel dans le texte, narratif
   (`Tremblay (2023b)`) ou parenthétique (`(Bacharach et al., 2010)`,
   `(Bullough et al., 2003 ; Wenzlaff, 2002)`), avec `nom_premier_auteur`, `annee`, `suffixe`,
   `para`, `span`. Une année isolée hors citation (« en 2010, ») n'est jamais retenue.
3. `croiser(citations, references)` — citée mais absente (`APA.CitationAbsente`, error), en
   bibliographie mais jamais citée (`APA.ReferenceNonCitee`, warning), suffixe incohérent
   (`APA.Suffixe`), « et al. » manquant dès trois auteurs ou de trop pour un ou deux
   (`APA.EtAl`, `action='fix'`, `suggested` rempli).
4. `verifier_ordre(references)` — alphabétique puis chronologique, suffixes a/b requis dès que
   deux références partagent auteur et année.
5. `doi_normaliser(ref)` — `doi:`, `DOI :`, `dx.doi.org/…`, `http://doi.org/…` →
   `https://doi.org/10.…`, `action='fix'`.
6. `resoudre_crossref(ref, delai=4)` / `retrouver_doi(ref, delai=4)` — seul point réseau,
   `GET https://api.crossref.org/works/<doi>` ou `…/works?query.bibliographic=…`. **Seules les
   métadonnées de la référence partent** (auteur, année, titre, DOI) — jamais le texte de
   l'article. `retrouver_doi()` n'accepte qu'une similarité de titre ≥ 0,9 avec auteur et année
   concordants, et ne rend qu'une **suggestion** (`action='comment'`) : il n'insère jamais un
   DOI deviné. `_requete(url, delai)` est le seul point qui touche réellement le réseau — les
   tests le remplacent, jamais un vrai appel.
7. `mise_en_forme_apa(ref, metadonnees_crossref=None)` — la chaîne canonique, italique marquée
   par `*…*`. Deux différences fr/de relevées dans les PDF Redaktionsrichtlinien (extraits par
   `pypdf`, faute de `pdftotext` dans la WSL — voir plus bas) : volume(numéro) collé en français
   (`12(3)`), espacé en allemand (`27 (3)`) ; éditeur d'un ouvrage collectif `(Éd.)`/`(Éds.)` en
   français, `(Hrsg.)` en allemand. Rendue seulement si `confiance == 'haute'` ou Crossref
   confirmé ; sinon `None`, jamais une reformulation devinée à la place de la rédaction.
8. `analyser_bibliographie(paragraphes_corps, paragraphes_biblio, langue, reseau=True)`
   enchaîne tout et rend `(alertes, stats)`. `reseau=False` : `stats['crossref']['indisponible']
   = True`, et **aucune tentative réseau** — la CLI d'essai (`--sans-reseau`) comme les tests
   l'utilisent.

### Comment le titre se sépare du conteneur — et pourquoi ':' n'est qu'un repli

Le titre finit sur `.`, `?` ou `!` (fréquent en français : « Quelle inclusion ? Revue X,
12(3), 45-67. »). `:` n'est **pas** dans ce jeu principal, delibérément : un titre à sous-titre
(très fréquent dans ce corpus, « Titre : sous-titre ? Revue, 12(3), 45-67. ») porte lui-même un
`:`, et comme le titre se capture en non-gourmand, le PREMIER `:` rencontré l'emporterait à tort
sur le vrai séparateur qui suit — mesuré : « Hétérogénéité, diversité, différences : Vers quelle
égalité des élèves ? Nouvelle revue de psychosociologie… » coupait sur le `:` et avalait tout le
sous-titre dans le nom de la revue. `:` ne sert qu'en **repli**, tenté seulement si `.?!`
échouent partout dans la chaîne — le cas, plus rare, d'une référence qui a perdu toute
ponctuation entre le titre et le nom de la revue (vu sur le corpus réel : « … adapté : La
nouvelle revue - Éducation et société inclusives, 97(1), 203-221. »).

### Les particules — deux graphies, une seule normalisation

`de Chambrier`, `van der Berg` : `_normaliser_nom()` ôte les particules de tête (liste
`PARTICULES` de `docx-meta.py`) avant de comparer, pour qu'une citation qui les omet
(`(Chambrier, 2020)`) apparie quand même une référence qui les porte. Un **second** cas, non
couvert par cette seule règle et **construit** pour le chantier (aucun exemple dans les 117
références réelles) : l'écriture APA de classement qui place la particule **après** les
initiales (`Chambrier, A.-F. de`, pour classer sous C plutôt que sous D — voir le guide
Zeitschrift, « Namen mit Namenszusatz »). `_decouper_initiales_et_particule()` la détecte et
recompose `{nom: 'de Chambrier', initiales: 'A.-F.'}` ; sans elle, ce test tombe sur DEUX faux
auteurs au lieu d'un — sabotage vérifié, voir le rapport de chantier.

### Le faux positif des acronymes et noms propres devant une parenthèse à année

Un mot capitalisé immédiatement suivi de `(année…)` n'est PAS forcément une citation narrative :
mesuré sur le corpus réel, « … du MPA (Booms et al., 2023) » prenait l'acronyme « MPA » pour le
nom cité, la vraie citation « Booms et al. » étant DANS la parenthèse, sans rapport avec le mot
qui précède. Correctif retenu : le contenu de la parenthèse doit **commencer** par l'année pour
que la forme narrative s'applique ; un contenu qui commence par un nom (`Booms et al., 2023`)
n'est jamais narratif, il revient à la passe parenthétique, qui lit le bon premier auteur.

⚠ **Limite connue, non résolue** : la même ambiguïté existe quand le mot qui précède N'EST PAS
un acronyme mais un nom propre ordinaire suivi directement de plusieurs années (`Fribourg
(2022 ; 2025)` pour deux événements distincts survenus à Fribourg, pas deux publications d'un
auteur nommé Fribourg). Aucune règle de casse ne distingue un nom de lieu d'un nom d'autrice ou
auteur : ce cas reste un faux positif possible, à signaler dans le rapport de chantier plutôt
qu'à corriger ici — le corriger demanderait de connaître un lexique de noms propres non-auteurs,
hors de portée d'un module qui ne lit que du texte.

### Ce qui n'a pas pu être fait ici (à couvrir ailleurs, jamais en silence)

- **Un auteur institutionnel cité par son SIGLE** (`OFS, 2022`) ne s'apparie pas à la référence
  qui porte le nom développé (`Office fédérale de la statistique [OFS]. (2022)…`) :
  `analyser_reference()` ne sépare pas le sigle entre crochets du nom qui le porte. Mesuré :
  deux faux `APA.CitationAbsente`/`APA.ReferenceNonCitee` sur le corpus réel pour ce seul motif.
  Le correctif (extraire le sigle, l'ajouter comme clé d'appariement alternative) est identifié,
  borné, non fait — pas dans le périmètre de ce lot.
- **L'extraction de l'étendue de bibliographie**, utilisée par la CLI d'essai
  (`_extraire_paragraphes()`) et par le harnais de mesure, hérite du même repérage par titre que
  `manuscrit-nettoyer.py`. Sur le fichier fabriqué `2-fin-de-document_Article_RSPS.docx` (les 8
  derniers paragraphes du corps posés en Titre 2, bibliographie comprise — voir le LISEZMOI du
  corpus), ce repérage retrouve un bloc qui contient le PARAGRAPHE DE COORDONNÉES DE L'AUTRICE
  et non les vraies références : les 9 « références » qui en sortent ne sont pas des références,
  et leurs 9 échecs de confiance ne disent rien de ce module. C'est un défaut de l'extension de
  bibliographie (hors de `manuscrit_biblio.py`, qui ne fait que lire ce qu'on lui donne), déjà
  documenté comme risque pour le cas fabriqué au § »Les titres« — signalé de nouveau ici parce
  que c'est ce fichier précis qui l'a fait apparaître pendant ce lot.

### La mesure fr/de sans `pdftotext`

La WSL `SZH-Publishing` ne porte pas `poppler-utils` (`pdftotext` introuvable, mesuré le
19.09.2026) — contrairement à ce qu'un chantier PDF supposerait disponible. Les deux PDF
`Redaktionsrichtlinien {Revue,Zeitschrift} 2025.pdf` ont donc été lus avec `pypdf` (Python de
Windows, où il est installé) au lieu de `pdftotext -layout` comme le prévoyait la consigne — la
extraction est fidèle (page par page, texte complet), seul l'outil diffère. Sans conséquence sur
le contenu lu, à signaler pour qui refera cette extraction plus tard dans la WSL.

---

## 8. La CLI

```
manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift --sortie <dossier>
                      [--rapport <fichier.json>] [--analyse-seule] [--sans-typo]
```

- écrit `<dossier>/<nom>-nettoye.docx` et `<dossier>/<nom>-rapport.json` ;
- `--analyse-seule` : aucun `.docx` écrit, seulement le rapport. C'est l'étape 1 du brief ;
- **code de sortie non nul s'il existe au moins une alerte `error`** — pour la CI plus tard ;
- une ligne JSON de statistiques sur stdout, rien d'autre sur ce flux. Les messages de
  progression vont sur stderr, une ligne par étape, pour que l'onglet les affiche au fil de
  l'eau ;
- **la CLI écrit explicitement en UTF-8** sur ses deux flux (`sys.stdout.reconfigure`), et
  l'appelant le déclare de son côté. Sans cette clause, les accents de la progression arrivent
  abîmés dans le journal du lanceur et personne ne sait à qui la faute ;
- **la sortie est écrite à côté du manuscrit d'entrée**, sans rien demander à la personne. Un
  manuscrit arrive dans un dossier de travail déjà choisi ; ouvrir une boîte de dossier à chaque
  nettoyage serait un geste de plus pour rien. Le bouton « Ouvrir le dossier » y mène ;
- révision du 19.09.2026 — la ligne JSON de stdout porte aussi `typographie: "appliquee" |
  "repli"` : la CLI dit explicitement si le filtre a vraiment tourné, jamais seulement une trace
  enfouie dans le rapport. `--sans-typo` porte aussi `"repli"` sur cette ligne (rien n'a été
  tenté), mais un repli involontaire (pandoc/WSL indisponible) lève EN PLUS une alerte `warning`
  (`Typo.ApplicationImpossible`) dans le rapport — `--sans-typo`, choix explicite déjà visible via
  `sans_typo` au rapport, n'en lève aucune.

**Refus explicites**, jamais un devinement :

- le document porte des `w:ins` / `w:del` → refus, message clair. Un texte en suivi de
  modifications n'a pas de contenu univoque ;
- extension inconnue → refus ;
- révision du 19.09.2026 — un fichier `~$*.docx` (verrou temporaire de Word, posé à côté d'un
  document ouvert ailleurs) → refus (`code_refus: 'fichier-verrou'`), avant toute tentative de
  lecture. Avant cette révision, `md.lire()` levait « File is not a zip file » (code de sortie 3
  au lieu de 2, sans message pour la rédaction).

Un document porteur de **commentaires** n'est pas refusé : les commentaires sont comptés et
signalés, mais ils ne survivent pas au nettoyage et le rapport doit le dire.

**La langue de traitement (révision du 19.09.2026)** : `'fr'` pour `--produit revue`, `'de'` pour
`--produit zeitschrift` — jamais `document.langue or 'fr'`. C'est cette langue courte qui part au
filtre (`-M lang=`), aux règles (`contexte['langue']`) et au rapport (`rapport['langue']`). La
langue déclarée du document ne sert plus qu'à une alerte `warning`
(`Langue.DesaccordProduit`) quand sa sous-étiquette primaire (`fr` de `fr-CH`) diffère de celle du
produit — jamais à choisir le traitement. Mesuré avant correction : un article français déclaré
`de-CH` recevait la typographie allemande ; cinq manuscrits du corpus lot-A sont déclarés `en-US`.

---

## 9. L'onglet du lanceur

Nouvel onglet **« Préprocessing »** dans `windows/open-produit.ps1`, calqué sur l'onglet « Export
et secrétariat » — même géométrie, mêmes marges, **aucun onglet n'agrandit la fenêtre**.

Contenu : un groupe de boutons radio **Revue / Zeitschrift**, un bouton « Manuscript cleaner
(Article)… » qui ouvre un sélecteur de fichier (`.docx`, `.odt`), un journal de progression
(Consolas 9, lecture seule), une barre de progression Marquee, un bouton « Interrompre », un
bouton « Ouvrir le dossier ».

Le nom **« Manuscript cleaner (Article) »** est celui que Robin a fixé ; `(Article)` parce qu'un
nettoyeur dédié aux livres viendra. Il reste tel quel dans les trois langues : c'est un nom de
produit. Tous les autres textes passent par `T` et existent en **fr, de et en** dans
`windows/szh-textes.ps1`, préfixe `lanceur.preproc.`.

Nouvel assistant `Invoke-SzhManuscrit`, calqué sur `Invoke-SzhSecretariat` :

- `wslpath -a` pour convertir les chemins dans les deux sens ;
- ⚠ **les rôles des deux flux sont inversés par rapport à l'onglet secrétariat.** Là-bas, la
  progression arrive ligne à ligne sur **stdout** ; ici, le §8 la met sur **stderr** et réserve
  stdout à l'unique ligne JSON finale. Le patron se transpose donc tel quel mais à l'envers :
  `$p.StandardOutput.ReadToEndAsync()` démarrée **avant** de boucler en `ReadLineAsync()` sur
  stderr. Le principe, lui, ne bouge pas : la tâche de lecture complète part la première, sinon
  le flux qu'on ne lit pas sature son tube et bloque l'enfant ;
- jamais `add_ErrorDataReceived` + `BeginErrorReadLine()`, qui tue le processus PowerShell
  entier, sans exception à attraper, parce que l'évènement s'exécute hors pipeline ;
- `ReadLineAsync()` + `DoEvents` + `Sleep 25` pour pomper l'interface, avec le drapeau
  d'annulation testé à chaque tour ;
- décodage de la sortie `wsl.exe` fait ici et nulle part ailleurs ;
- WSL absente ou distro éteinte → message clair, pas une trace d'erreur.

Le rapport HTML est rendu **après** le retour de la CLI : le JSON part dans
`outils/rendre-gabarit.js` avec un nouveau gabarit
`vscodium-extension/szh-cockpit/export-templates/rapport-manuscrit.twig`. Le lanceur ne fabrique
pas d'HTML à la main — `lib/gabarits.js` est le seul moteur de gabarits du produit.

---

## 10. Les pièges déjà mesurés, à ne pas repayer

Tous constatés, aucun supposé.

**`docx+styles` existe, `odt+styles` n'existe pas.** pandoc 3.5 répond « The extension styles is
not supported for odt ». Ne jamais bâtir la conservation des styles là-dessus : ce serait deux
chaînes selon le format.

**LibreOffice fond deux tableaux qui se touchent.** Mesuré sur le gabarit réel : 4 tableaux côté
`.docx`, 3 côté `.odt`. L'écrivain doit donc **toujours poser un paragraphe vide entre deux
blocs**, sans quoi le document qu'il produit se dégrade dès qu'il passe par LibreOffice.

⚠ **Révision du 19.09.2026 : « toujours un » n'est pas « au plus un ».** Mesuré : un ou plusieurs
paragraphes vides déjà présents dans le manuscrit, collés à un bloc, s'AJOUTAIENT au séparateur que
l'écrivain injecte lui-même, au lieu de s'y substituer — jusqu'à trois `<w:p/>` consécutifs entre
deux tableaux. Le contrat exige EXACTEMENT un paragraphe vide entre deux blocs, pas « au moins
un ». Corrigé dans `manuscrit_gabarit._convertir_niveau_racine()` : les paragraphes vides
consécutifs sont fondus à un seul avant l'insertion des séparateurs, et un séparateur n'est plus
injecté quand un paragraphe vide existe déjà de part ou d'autre du bloc.

**Le numéro de page n'existe que si Word a repaginé** (`w:lastRenderedPageBreak`). Absent d'un
fichier fabriqué par script, sans équivalent OpenDocument. **Ne jamais estimer une page depuis un
nombre de signes** : une page fausse envoie chercher au mauvais endroit et l'outil passe pour
menteur. `page = None` est une réponse acceptable, une page inventée ne l'est pas.

**`wsl.exe` n'existe pas DANS la WSL — et son absence ne lève aucune exception explicite.**
Mesuré le 19.09.2026 : le pont typographique appelait TOUJOURS `wsl.exe -d SZH-Publishing --
pandoc ...`, y compris quand cette CLI tourne déjà DANS la distro (le lanceur l'exécute via
`wsl -d SZH-Publishing -e python3 ...`). `subprocess.run(['wsl.exe', ...])` y échoue comme
n'importe quel exécutable introuvable — capturé comme une indisponibilité de pandoc, un repli
**silencieux** : 845 paragraphes sur 845 rendus inchangés, code de sortie 0, rien qui le
signale. La décision (§6) : `sys.platform != 'win32'` → pandoc du PATH, direct, chemin Linux
natif du filtre ; seulement sous Windows → `wsl.exe` + `wslpath -a`. Ne jamais supposer qu'un
code qui tourne « dans la CI/les tests sur le poste de dev » tourne dans les mêmes conditions
qu'en production : ici c'était l'inverse (Windows) de la production (WSL).

**`wsl.exe` avale les antislashs d'un argument passé en tableau.** Mesuré le 18.09.2026 :
`subprocess.run(['wsl.exe', ..., 'C:\Users\robin\...\filtre.lua'])` fait arriver
`C:Usersrobin...filtre.lua` côté Linux — un chemin inexistant, et `wslpath` échoue sans rien dire de
plus explicite. Convertir les `\` en `/` **avant** l'appel. Ce n'est pas le piège d'encodage
ci-dessous : ici c'est l'**entrée** qui est mutilée, avant même que la commande ne s'exécute.

**L'avertissement sur l'UTF-16 de `wsl.exe` ne vaut pas pour tout.** Il concerne les commandes
Windows natives de `wsl.exe` lui-même (`wsl -l -v`). La sortie **relayée** d'un programme Linux —
pandoc, python3 — traverse en UTF-8 intact, insécables comprises (vérifié octet par octet le
18.09.2026). Ne pas ajouter de décodage défensif là où il n'en faut pas : il abîmerait des données
saines.

**`mc:AlternateContent` cache des dessins.** Mesure du 18.09.2026 sur
`4_La methode Flip Flap.docx` : les **dix** ancrages flottants du fichier sont tous enveloppes
dans `w:r > mc:AlternateContent > mc:Choice > w:drawing`, deux niveaux sous le run. Un lecteur
qui ne regarde que les enfants DIRECTS d'un `w:r` les perd tous les dix **sans un mot**. Deplier
la branche `mc:Choice`, **jamais `mc:Fallback`** : elle repete la meme forme en VML, et la
compter aussi doublerait chaque dessin.

**Le texte n'est pas que dans `document.xml`** : notes de bas de page, en-têtes, zones de texte,
champs. L'extraction les couvre ou **déclare ce qu'elle ignore**. Jamais en silence.

**`python3` nu peut se figer.** Sur Windows, `python3` résout d'abord vers l'alias d'exécution de
`WindowsApps` et ne rend jamais la main sous `spawnSync`. Les tests passent par `PYTHON` de
`test/js/gardes.js`, qui essaie `python` en premier. Ne jamais écrire `python3` en dur dans un
test.

**Le volume d'alertes.** Deux cents signalements rendent l'outil détestable en une semaine. Le
rapport groupe par famille, compte par règle, et au-delà de dix occurrences d'une même règle
affiche les dix premières et le total.

**Un même r:id VML peut être répété plusieurs fois dans le même groupe.** Mesuré le 19.09.2026
sur `4_La methode Flip Flap.docx` : un décompte qui compte les OCCURRENCES de `v:imagedata`
plutôt que les identifiants DISTINCTS surcompte d'un facteur 5 (24 occurrences pour 5 images
réelles). Dédoublonner par `r:id`, jamais par position.

**Un `w:sdt` de niveau BLOC est invisible à `blocs_du_corps()`.** Ce dernier (repris tel quel de
`pronto_docx.py`, §3) ne reconnaît que `w:p`/`w:tbl` comme enfants directs du corps — un contrôle
de contenu qui enveloppe un `w:p` ENTIER (formulaire Word, citation Zotero) fait disparaître ce
paragraphe SANS AVERTISSEMENT, contrairement au niveau RUN (couvert de longue date). Le déplier
dans l'arbre XML avant tout parcours, jamais essayer de le reconnaître au niveau du bloc lui-même.

**Le nom d'un fichier ment.** `2-fin-de-document_Article_RSPS.docx` (corpus réel) porte des
NOTES DE BAS DE PAGE (`word/footnotes.xml`), pas des notes de fin — mesuré le 19.09.2026 en
vérifiant l'archive avant d'écrire le contrôle qui s'appuie dessus. Ne jamais nommer un fichier
de test sur la foi d'un nom de fichier réel sans avoir ouvert l'archive.

**Deux Word/pandoc différents peuvent lire un tiret différemment sans corruption.** Un caractère
U+2011 (trait d'union insécable) peut arriver dans `<w:t>` de DEUX façons distinctes sur le même
corpus : l'élément dédié `w:noBreakHyphen`, OU un `w:sym` dont `w:char="2011"` (une autrice qui
passe par Insertion > Symbole plutôt que par le raccourci clavier). Un lecteur qui n'en couvre
qu'une seule perd l'autre en silence — mesuré sur `1bis_Booms Article.docx` (6 occurrences par
`w:sym`, aucune par `w:noBreakHyphen`).

---

## 11. Les contrôles de validité

Posés d'avance. Ils font foi : un module est fini quand ils passent, pas quand il a l'air fini.
Harnais `node --test`, gardes par `test/js/gardes.js` (`PYTHON`, `sansPython`, `sansPandocWsl`),
fixtures `.docx` **fabriquées dans le test** et non figées en binaire — patron
`test/js/docx-titres.test.js`, fonction `fabriquerDocx`.

| Fichier | Ce qu'il prouve |
|---|---|
| `manuscrit-titres.test.js` | Le H2 sur trois paragraphes rend **un** titre et deux corps. Un style porté par plus de la moitié du document est ignoré. Un document correctement stylé ressort **inchangé** — zéro faux positif. Un document sans aucun style voit ses titres retrouvés par taille et graisse. |
| `manuscrit-typo.test.js` | Sur un paragraphe dont les runs sont coupés **au milieu d'un mot**, le texte normalisé est réinjecté sans perdre un caractère, et un mot en italique reste en italique. Un paragraphe irreconstructible est abandonné **et signalé**, jamais rendu de travers. |
| `manuscrit-formatage.test.js` | Tailles, polices, couleurs partent ; italique, exposant, indice et liens restent. Chaque suppression apparaît dans le rapport. ⚠ Le contrôle porte sur l'ÉTAT DES FRAGMENTS EN SORTIE, jamais sur le seul texte du motif : un test qui se contente de lire le motif reste vert quand l'italique est détruit — mesuré le 18.09.2026. |
| `manuscrit-gabarit.test.js` | La sortie relue par `pronto-lire.py` rend les champs attendus. Chaque image est dans un bloc figure, chaque tableau coiffé de sa rangée fusionnée, EXACTEMENT un paragraphe vide sépare toujours deux blocs (jamais deux, jamais zéro). Aucun signe du corps perdu, typographie mise à part. Chaque partie XML de la sortie (`word/*.xml`, `word/_rels/*.rels`) est bien formée, `sectPr` en dernier enfant du corps, chaque média déclaré dans `[Content_Types].xml`, chaque `r:embed`/`r:id` résolu, tout hyperlien externe porte `TargetMode="External"` — vérifié sur les onze manuscrits réels. Un lien/alt portant `&`/`"` produit un document valide (échappement d'attribut). Le rapport largeur/hauteur d'une image (cx/cy, puis pixels, puis surface en dernier recours) est conservé, plafonné à la largeur utile de la page. Une rangée plus large que la première, et une fusion verticale ET horizontale à la fois, ne perdent aucune cellule. Chaque `wp:docPr` est unique. Les notes de bas de page appelées sont écrites dans `word/footnotes.xml` (contrat partagé, notes orphelines et introuvables tracées, jamais écrites en silence) et la table de correspondance `{source, sortie}` rendue par `ecrire()` pointe, pour 100 % des paragraphes du corpus réel, le bon `<w:p>` de la sortie. |
| `manuscrit-cas-a.test.js` | Un document au gabarit n'est pas restructuré, et **nettoyer deux fois donne le même résultat que nettoyer une fois**. |
| `manuscrit-refus.test.js` | Un `.docx` en suivi de modifications est refusé avec un message clair, et **rien n'est écrit**. Extension inconnue de même. |
| `manuscrit-regles.test.js` | Le catalogue **structurel** seul (depuis le 19.09.2026, §7) : chaque règle porte sa référence de chapitre, un saut de niveau de titre (H1 → H3) est détecté, une bibliographie mal ordonnée l'est aussi sans jamais citer un « None (None) », le code de sortie est non nul dès la première alerte `error`. |
| `manuscrit-vale.test.js` | Le catalogue **lexical et éditorial**, porté par Vale (§7) : « personne en situation de handicap » ne lève **aucune** alerte, l'inversion épicène FR/DE, une URL ne déclenche jamais Epicene, `analyser()` rend `indisponible=True` proprement quand Vale ne peut pas tourner. |
| `manuscrit-parite-lecteur.test.js` | `projeter_pronto()` et `pronto_docx.lire()` s'accordent sur les deux gabarits livrés. **Ce fichier disparaît avec la dette du §3.** |
| `manuscrit-odt.test.js` | Le même manuscrit en `.docx` et en `.odt` rend le même modèle riche, modulo les écarts connus du §10. |

**Le contrôle qui compte plus que tous les autres** n'est pas dans cette table, parce qu'il
demande le corpus : passer l'outil sur des manuscrits **déjà publiés**, qui ont traversé quatre
relectures. Toute alerte y est suspecte par construction. C'est la seule mesure honnête du taux
de faux positifs, et rien ne la remplace.

### Phase 2 — la validation par la rédaction

Décidé avec Robin le 18.09.2026 : **une fois les modules en place, une dizaine de documents
passent au nettoyeur et Robin valide chaque sortie, une par une.** C'est ce passage-là qui fixe
l'outil, pas la table ci-dessus — les contrôles automatiques prouvent qu'il fait ce qu'on lui a
dit, la validation prouve qu'on lui a dit la bonne chose.

Deux conséquences sur la conception, à tenir dès maintenant :

- **chaque décision doit être traçable et lisible** dans le rapport, sinon la validation se fait
  à l'aveugle : il faut pouvoir dire « ce paragraphe a été rétrogradé au corps parce qu'il fait
  41 mots et finit par un point », pas seulement montrer le résultat ;
- **tout seuil est une constante nommée** en tête de module, jamais un nombre au milieu du code.
  La phase 2 va les faire bouger, et ils devront bouger en un seul endroit.

C'est aussi cette phase qui donnera enfin un **cas A réel**, si l'un des dix documents arrive au
gabarit.

---

## 12. Ce qui n'est pas fait ici

- **Écrire dans le `.docx` de l'autrice.** L'outil rend un fichier neuf ; il ne touche jamais
  l'original.
- **Les révisions natives et les commentaires ancrés** (étapes 2 et 3 du brief). L'architecture
  ne les empêche pas : la carte de positions (`source` sur chaque classe) est posée dès
  maintenant pour ça.
- **Le nettoyeur des livres.** D'où le `(Article)` dans le nom.
- **L'allemand calibré.** Les règles allemandes sont écrites, mais leur taux de faux positifs ne
  sera mesuré qu'avec le lot C du corpus.

  ⚠ Un risque latent a ete constate le 18.09.2026, a lever avant ce lot : `RE_NIVEAU_TITRE` de
  `pronto_modele.py` ne reconnait un style de titre allemand que par le repli sur le styleId brut
  (`berschrift1`, sans accent), jamais par le nom affiche complet « Überschrift 1 » — qui commence
  par « Ü » et ne peut donc pas correspondre a un motif exigeant `berschrift`. Sur un document
  allemand moderne (styleId canonique `Heading1`, nom affiche localise), la detection du niveau de
  titre **echouerait en silence**. Sans consequence sur le corpus actuel, qui est francais.

- **Un no-op du depot, signale en passant** : les trois substitutions « espaces speciales → espace »
  de `pronto_modele.normaliser()` remplacent, octet pour octet, une espace ordinaire par une espace
  ordinaire. La vraie normalisation vient du `' '.join(t.split())` final. Anterieur a ce chantier,
  sans consequence ici, mais a connaitre pour qui validera `pronto_docx.py`.
