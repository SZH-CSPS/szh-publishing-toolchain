# Nettoyeur de manuscrit (article) — contrat d'architecture

**Ce fichier est le contrat que suit chaque module.** Il fixe les frontières, les noms et les
formats d'échange, à l'état du **21.09.2026**. Il dit ce qui EST, pas ce qui a été — l'historique
des révisions vit dans git ; les mesures et les pièges réels, eux, sont rassemblés dans une
section unique, « Pièges mesurés » (§10), plutôt que dispersés au fil du texte. Un désaccord avec
ce fichier se règle en le modifiant, jamais en s'en écartant dans le code.

Le brief fonctionnel reste `outils-dev/Pipeline de relecture automatisée — Revue CSPS.md` ; ce
fichier-ci dit comment on le construit ici. Pour la suite du travail (ce qui reste à faire,
l'état exact du dépôt), voir `outils-dev/ETAT-REPRISE-2026-09-18.md` — ce contrat ne porte plus
aucune liste « à faire ».

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

Reconnaissance du cas A : présence des styles `SZH Cle` **et** `SZH Aide` dans `word/styles.xml`.
Rien d'autre ne sert de critère : ni un réglage de poste, ni le nom du fichier.

Le cas A reste **délibérément conservateur** : aucun document réel au gabarit n'a encore validé
ce chemin (voir `ETAT-REPRISE-2026-09-18.md` pour l'état de cette validation).

---

## 2. Où le code tourne

**100 % Python**, sauf l'onglet du lanceur qui est en PowerShell WinForms — incompressible.

| | |
|---|---|
| Interpréteur | `python3` de la WSL `SZH-Publishing` — **3.13.5** |
| Bibliothèques | **stdlib seule** : `zipfile`, `xml.etree.ElementTree`, `difflib`, `json`, `re`. Pas de PyYAML, pas de python-docx, pas de jinja2 |
| Binaires externes | `pandoc` 3.5 et **Vale 3.22.0**, tous deux binaires **épinglés de l'image WSL** (URL versionnée GitHub releases, `sha256sum -c`, version vérifiée en fin de build dans `image/Containerfile`) — comme veraPDF. **Zéro entrée `windows/apps.lock`** : le nettoyeur tourne dans la WSL, jamais sous le Python de Windows |
| Rapport HTML | rendu par `lib/gabarits.js` via `outils/rendre-gabarit.js`, comme les courriels et les exports |

**Pourquoi la WSL et pas le Python de Windows** : `windows/apps.lock` ne pose que VSCodium
(`requis: true`) et SumatraPDF. Aucun Python n'est garanti côté Windows. La WSL, elle, est posée
sur chaque poste et maintenue chaude par la tâche planifiée « SZH - Prechauffage WSL »
(`windows/bootstrap.ps1`, déclencheur à l'ouverture de session). Appel à chaud mesuré : **0,138 s**.

⚠ **La sortie de `wsl.exe` n'est pas de l'UTF-8 propre** (UTF-16 constaté sur `wsl -l -v`). Le
décodage se fait **une fois**, dans l'assistant PowerShell, jamais dans chaque appelant. Cet
avertissement ne vaut que pour les commandes Windows natives de `wsl.exe` lui-même — la sortie
**relayée** d'un programme Linux (pandoc, python3) traverse en UTF-8 intact (voir §10).

Le catalogue lexical et éditorial (langage épicène, vocabulaire du handicap, casse maison,
citation directe, liaison et/&) reste entièrement maison : Vale n'en est que le moteur
d'exécution (`existence`/`substitution`), jamais un jeu de règles emprunté à un écosystème.
Voir `pipeline/vale/LISEZMOI.md` pour ce que la rédaction peut modifier elle-même, et §7.

---

## 3. Les modules

Convention du dépôt, déjà suivie par `pronto_modele.py` / `pronto-lire.py` : **un module
importable porte un tiret bas, une CLI porte un tiret**.

| Fichier | Rôle | Ne sait rien de |
|---|---|---|
| `pipeline/manuscrit_modele.py` | le modèle riche (§4) et **toutes les décisions** de classement/nettoyage (§5) | Word, OpenDocument, pandoc |
| `pipeline/manuscrit_docx.py` | `.docx` → modèle riche | les décisions |
| `pipeline/manuscrit_odt.py` | `.odt` → modèle riche (reste à écrire, voir `ETAT-REPRISE`) | les décisions |
| `pipeline/manuscrit_typo.py` | le pont typographique (§6) | les décisions |
| `pipeline/manuscrit_entete.py` | l'en-tête et le bloc final d'autrices/auteurs (§5.5) | Word, OpenDocument |
| `pipeline/manuscrit_gabarit.py` | modèle riche → `.docx` au gabarit (§5.3, §5.4) | les décisions |
| `pipeline/manuscrit_regles.py` | le catalogue structurel et le moteur d'alertes (§7) | les formats |
| `pipeline/manuscrit_vale.py` | le pont Vale (§7) | les décisions |
| `pipeline/manuscrit_biblio.py` | contrôle de bibliographie APA 7 (§7 bis) | Word, OpenDocument |
| `pipeline/manuscrit_annoter.py` | révisions et commentaires Word (§7 ter) | les décisions |
| `pipeline/manuscrit-nettoyer.py` | la CLI (§8) | tout le reste ; il ne fait que brancher |

La frontière est la même que celle qui a fait ses preuves sur le lecteur Pronto : **le lecteur
rend le style déjà résolu en son nom humain**, et c'est le seul endroit où `.docx` et `.odt`
diffèrent.

### Dette assumée, avec une date

`pipeline/pronto_docx.py` lit déjà le `.docx` vers un modèle plus pauvre. `manuscrit_docx.py`
lit le même format vers un modèle plus riche. **C'est une duplication, elle est temporaire et
bornée** à la validation formelle du lecteur Pronto par Robin (voir `ETAT-REPRISE` pour l'état) —
la toucher avant cette validation l'invaliderait.

`manuscrit_docx.py` **importe et réutilise littéralement** `resoudre_style`, `pstyle`,
`charger_styles`, `compter_marqueurs_page` et `blocs_du_corps` de `pronto_docx.py` (en lecture
seule, jamais modifiés), plutôt que de les récrire. La duplication ne porte donc que sur ce que
le modèle riche ajoute, et `projeter_pronto()` est fiable **par construction**, pas par
coïncidence entre deux implémentations séparées :

- `manuscrit_docx.py` expose `projeter_pronto(document)` qui rend **exactement** le modèle de
  `pronto_docx.lire()` ;
- un test différentiel (`test/js/manuscrit-parite-lecteur.test.js`) exige que les deux lecteurs
  s'accordent sur les deux gabarits livrés. Il tombe dès qu'ils divergent.

Après la validation, `pronto_docx.py` devient une projection de `manuscrit_docx.py` et le test
différentiel disparaît avec la duplication. **Ce paragraphe se supprime ce jour-là.**

---

## 4. Le modèle riche

Cinq classes, `__slots__` partout, aucune dépendance. Toutes portent `source`, l'index du nœud
dans le document d'origine : c'est la carte de positions qui rend possible l'écriture de
révisions natives (§7 ter).

```
Image(nom, octets, surface, alt, flottante, source, cx, cy, largeur_px, hauteur_px)
    nom         nom de fichier sous word/media/ ou Pictures/
    octets      le contenu du fichier — l'écrivain en a besoin
    surface     EMU², 0 si non déclarée (même convention que docx-meta.py)
    cx, cy      la boîte d'affichage en EMU, SÉPARÉMENT. Leur produit est `surface`,
                mais le produit seul ne permet de rien calculer.
    largeur_px  dimensions en pixels du FICHIER, lues dans ses octets (en-tête PNG
    hauteur_px  IHDR / JPEG SOF / GIF / BMP), 0 si le format est inconnu ou vectoriel —
                c'est la seule mesure sur laquelle la qualité d'image se juge (§7).
    alt         texte alternatif déclaré, '' si absent
    flottante   vraie si l'image est ancrée (w:anchor) et non en ligne (w:inline)
    source      indice du w:p PORTEUR dans le corps (jamais celui du w:r)

Fragment(texte, image, forme, lien, source, note, effectif)
    texte      str, jamais None ; '' quand le fragment porte une image ou une note
    image      Image ou None
    forme      dict figé, mise en forme DIRECTE : gras, italique, souligne, exposant,
               indice, barre, petites_capitales, majuscules, police, taille (demi-points),
               couleur, surlignage. None = « non déclaré », à distinguer de False =
               « déclaré éteint ». Jamais lue pour le NETTOYAGE (§5.2) via `effectif`.
    effectif   dict figé, mêmes clés que `forme` : la mise en forme EFFECTIVEMENT
               appliquée — directe sinon style de caractère (w:rStyle) sinon chaîne des
               styles de paragraphe (w:pStyle → w:basedOn → …, y compris leur w:rPr)
               sinon w:docDefaults/w:rPrDefault. None seulement si rien n'est déclaré
               nulle part. C'est `effectif` que lisent les passes de classement de
               titres (§5.1) qui doivent comparer un corps qui HÉRITE sa taille par la
               cascade des styles à un faux titre qui la DÉCLARE directement.
    lien       URL ou None
    source     index du w:r dans son paragraphe
    note       identifiant de la note appelée par ce fragment (w:footnoteReference /
               w:endnoteReference), ou None. Une note de fin porte un identifiant
               DÉCALÉ au-delà du plus grand identifiant de note de bas de page.

Paragraphe(style, niveau_declare, niveau_retenu, fragments, liste, alignement,
           retrait, source, alignement_effectif)
    style               nom humain résolu : 'heading 1', 'Body Text', 'SZH Cle', ''
    niveau_declare      1..3 si le STYLE dit titre, 0 sinon. Jamais une déduction.
    niveau_retenu       rempli par classer_titres(). 0 = corps. Le seul champ que les
                        décisions écrivent, à une exception : un titre promu depuis une
                        liste numérotée (§5.1) écrit aussi `liste` et le texte du
                        premier Fragment, faute d'un autre endroit pour ces mutations.
    liste               (numId, ilvl, format) ou None. `format` vaut 'puce', 'numero',
                        ou '' quand il n'a pas pu être établi. Se résout aussi depuis un
                        numPr HÉRITÉ d'un style de paragraphe, pas seulement posé
                        directement ; `numId="0"` (convention Word) rend None.
    alignement          direct ; ''  si non déclaré
    alignement_effectif direct sinon chaîne des styles de paragraphe ; '' si non déclaré
                        nulle part — même principe que Fragment.effectif.
    retrait             en dixièmes de point
    source              index du w:p dans le corps (position parmi TOUS les w:p/w:tbl du
                        corps, à ce niveau)

Cellule(colspan, rowspan, entete, blocs)
    blocs      liste de Paragraphe | Tableau, dans l'ordre, imbrication comprise.
               Un paragraphe de cellule porte un `source` LOCAL à sa cellule (0, 1, …) —
               jamais une position globale (voir §5.2 pour la conséquence sur la trace).

Tableau(rangees, page, source)
    rangees    liste de listes de Cellule ; une cellule masquée par une fusion
               n'y figure JAMAIS
    page       numéro de page ou None — JAMAIS deviné (n'existe que si Word a repaginé,
               w:lastRenderedPageBreak ; voir §10)

Document(blocs, styles, langue, revisions, commentaires, notes, source)
    blocs         liste de Paragraphe | Tableau, premier niveau, dans l'ordre
    styles        noms des styles présents dans styles.xml — sert au cas A
    langue        langue déclarée du document, ou '' — ne pilote jamais le traitement
                  (§8 : c'est la langue du PRODUIT qui décide)
    revisions     nombre de w:ins / w:del trouvés, comptés aussi dans footnotes.xml/
                  endnotes.xml
    commentaires  nombre de commentaires trouvés
    notes         dict[int, list[Paragraphe | Tableau]] : le contenu de CHAQUE note par
                  identifiant. Notes de bas de page ET de fin cohabitent (identifiants
                  disjoints). Une note jamais APPELÉE par le corps (orpheline) n'y figure
                  pas — filtrée par le lecteur.
```

`texte` est **déjà normalisé** par le lecteur (compactage d'espaces), **sauf le tiret réel du
document** (cadratin, demi-cadratin, insécable), qui survit dans le modèle riche tel quel — c'est
`projeter_pronto()` et lui seul qui applique encore les trois substitutions de tiret de
`pronto_modele.normaliser()`, pour rester l'exact miroir de `pronto_docx.lire()` (§3, « dette
assumée »).

`normaliser()` **ne vit pas dans `szh_commun.py`** : elle est dupliquée à l'identique dans
`pronto_modele.py`, `docx-titres.py`, `docx-meta.py` et `docx-tables.py`. On l'importe donc
depuis `pronto_modele`, qui ne connaît ni Word ni OpenDocument — l'import ne franchit aucune
frontière du §3. Seule `avertir()` vient de `szh_commun`. Cette quadruple copie est un défaut du
dépôt, antérieur à ce chantier ; elle n'est pas à corriger ici.

`pronto_docx.resoudre_style`/`charger_styles` ne remontent PAS une chaîne `w:basedOn` — ils ne
résolvent qu'un `styleId` vers son nom humain (un seul niveau). La résolution de `Fragment.
effectif` et du `numPr` hérité lit `styles.xml` une seconde fois dans `manuscrit_docx.py`
(`_index_styles_complet`), pour la chaîne `basedOn` et les `w:rPr`/`w:pPr` de chaque style —
`pronto_docx.charger_styles` reste, lui, inchangé et sert toujours à résoudre le NOM affiché.

---

## 5. Les décisions

Toutes dans `manuscrit_modele.py` ou `manuscrit_entete.py`, toutes pures : elles prennent un
`Document`, rendent des décisions et une **trace**. Chaque décision tracée devient une ligne du
rapport. Aucune décision silencieuse, jamais.

### 5.1 Les titres — quatre passes, jamais un critère isolé

La question n'est pas « ce paragraphe fait-il moins de douze mots », c'est **quelles classes de
mise en forme existent dans CE document, et lesquelles se comportent comme des titres**. Quatre
passes, dans cet ordre. Aucune ne pondère quoi que ce soit : pas de score, pas de coefficient.

**Passe 1 — les exclusions**, avant toute heuristique. Ne peuvent jamais devenir un titre par
déduction : un paragraphe portant un style maison `SZH …` ; un style `Quote`/`Citation` ou de
légende ; tout ce qui est dans l'étendue de bibliographie (repérée par `TITRES_BIB` de
`pipeline/filters/szh-citations.lua`) ; un paragraphe en liste (sauf le cas des listes
numérotées, voir plus bas), dans un tableau, ou vide ; un paragraphe sans aucune lettre (une
ligne de tirets/astérisques/soulignés) ; un paragraphe qui porte un e-mail, un numéro de
téléphone ou une URL ; un paragraphe qui commence par le lexique de légende `RE_LEGENDE` de
`docx-titres.py` (« Tableau 1 », « Figure 2 »…).

Un entretien arrivé hors gabarit (questions en gras, sans style `SZH Question`) n'est **pas**
exclu par construction : ses questions peuvent être promues à un niveau de titre, à condition de
former **un seul** niveau cohérent — le rapport signale alors le nombre inhabituel de titres.

**Passe 2 — l'état déclaré décide de ce qu'on cherche.** L'état déclaré est cohérent quand le
total des titres tient dans `[MIN_TITRES, MAX_TITRES]` et n'emploie pas plus de trois niveaux
(mesuré sur 58 articles réels : les 36 qui portent de vrais styles de titre en ont au minimum 2,
en médiane 9, au maximum 21). État cohérent → l'heuristique ne promeut plus aux niveaux déjà
employés. Un niveau manque → la passe 3 cherche seulement ce niveau. Aucun style de titre → la
passe 3 cherche les trois niveaux (22 des 58 articles du corpus mesuré). La cohérence de l'état
déclaré désactive la **promotion**, jamais la **rétrogradation** de la passe 4.

**Passe 3 — les signatures.** Chaque paragraphe candidat porte une signature — taille arrondie,
gras, italique, souligné, police, alignement, casse — lue en priorité sur `Fragment.effectif`
(mise en forme EFFECTIVE, §4), avec repli sur `forme` clé par clé si `effectif` n'a rien de
propre. Un groupe devient un niveau de titre quand : sa longueur est courte RELATIVEMENT au corps
de ce document (jamais dans l'absolu — un ratio, pas un nombre de mots ; le plancher
`PLANCHER_HOMOGENEITE_MOTS = 4` empêche un titre à un seul mot d'imposer, à lui seul, un ratio
que même deux vrais titres ordinaires ne tiendraient pas) ; sa signature diffère de la signature
dominante du corps ; ses occurrences sont réparties dans le document ; ses longueurs sont
homogènes entre elles. L'ordre des groupes donne les niveaux : taille décroissante d'abord, puis
le gras, puis l'italique. Le plafond de trois niveaux est une contrainte dure ; au-delà,
`MAX_NIVEAUX` groupes qualifiants, les excédentaires sont rabattus sur le niveau 3 (signal
`groupes_rabattus_niveau3`) plutôt qu'écartés, quand ce niveau reste disponible. Le nombre total
n'est **pas** un motif de rejet — c'est un **signal** dans le rapport, jamais une décision
silencieuse.

**Passe 4 — la rétrogradation.** Un paragraphe déclaré titre dont la signature est celle du
corps est rétrogradé, quel que soit son nombre de mots — **sauf** si sa signature est distincte
du corps à la fois en EFFECTIF et en DIRECT, auquel cas il est conservé sans regarder sa
longueur ; si la distinction n'existe que dans un seul des deux référentiels, c'est la longueur,
relative au corps de CE document, qui tranche. Le seuil absolu de 12 mots et la ponctuation
finale ne jouent aucun rôle dans la rétrogradation.

**Passe 3 bis — l'adoption par signature de référence.** Le titre déclaré fournit la signature de
référence du niveau (mise en forme effective, §4), et tout paragraphe non stylé qui la porte est
adopté à ce niveau. L'ordre qui rend cette passe sûre : 1) rétrograder d'abord (passe 4) ; 2)
calculer la référence ensuite, sur les titres déclarés qui ont SURVÉCU ; 3) adopter enfin les
paragraphes qui portent cette signature. Deux garde-fous : la référence doit être MAJORITAIRE
parmi les titres déclarés survivants d'un niveau ; la référence ne doit JAMAIS être celle du
corps.

**Titres en liste numérotée** (jamais à puces) : un item devient candidat quand il est **isolé**
(ni le paragraphe précédent ni le suivant n'est un item de la même liste) et qu'il est gras, OU
que sa taille effective dépasse celle du corps, OU qu'il est en italique ET que tous les autres
candidats isolés du document le sont aussi. Un titre ainsi promu perd sa liste (`liste = None`)
et un numéro manuel en tête de texte est retiré du premier fragment. Le niveau : la profondeur du
numéro manuel s'il y en a un, sinon `ilvl + 1` de la liste, sinon l'ordre des signatures
TYPOGRAPHIQUES (sans alignement) parmi les seuls candidats retenus.

**En cas de doute : rien, et on le dit.** Si aucun groupement ne convainc, on ne promeut rien et
le rapport le dit. Ce principe gouverne aussi §5.5 et §5.5 bis.

### 5.2 Le formatage manuel

Ce qui **part** : police, taille, couleur, surlignage, petites capitales, majuscules forcées,
alignement, retraits, souligné du corps de texte, sauts de ligne manuels en fin de paragraphe,
tabulations d'indentation, paragraphes vides consécutifs (fondus à un seul au maximum).

Ce qui **reste** : l'italique, l'exposant, l'indice, les liens — un italique porte du sens (mot
étranger, titre d'ouvrage, terme technique) et le tuer est une perte qu'aucune relecture ne
rattrape. Le gras **intégral** d'un paragraphe de corps, non retenu comme titre, est aussi
**conservé** (une relectrice doit pouvoir le voir) — seul le gras **partiel** part normalement ;
les majuscules forcées, elles, partent dans tous les cas. Un paragraphe entièrement gras ou en
majuscules, non retenu comme titre, est **signalé sans être touché** — l'outil ne décide jamais
que c'est ou non un intertitre manqué.

Le nettoyage descend à **toute profondeur** — cellules de tableau (à n'importe quelle
imbrication) et notes de bas de page/de fin. La trace d'un paragraphe de cellule porte, depuis le
21.09.2026, le `.source` du TABLEAU porteur (`dans_tableau: True`), jamais la position LOCALE à
la cellule qui produisait un « paragraphe 0 » indiscernable d'une cellule à l'autre dans le
rapport HTML.

Tout le corps reçoit le style **« Corps de texte »**. Deux noms pour un seul style : `Body Text`
côté Word (`styleId` = `Corpsdetexte`), **`Text body`** côté LibreOffice — toute règle qui
reconnaît le corps par son nom teste les deux formes.

### 5.3 Les blocs

- **Chaque image** devient un bloc figure du gabarit : une rangée de métadonnées (`Légende :`,
  `Texte alternatif :`, `Crédit :`, `Source :`, en style `SZH Cle`) puis l'image. Les champs que
  le manuscrit ne fournit pas restent **vides et listés dans le rapport**.
- **Chaque tableau** reçoit en première rangée une cellule fusionnée sur toute sa largeur,
  portant les mêmes métadonnées.
- Une **légende déjà présente** (paragraphe voisin commençant par « Figure 1 », « Abbildung 2 »,
  « Tableau 3 »…, lexique `RE_LEGENDE` de `docx-titres.py`) est reprise dans `Légende :` et
  retirée du corps, **avec sa mise en forme** (italique, exposant…), jamais aplatie en texte
  plat. Une légende répartie sur deux paragraphes (un titre bref qui matche `RE_LEGENDE` à lui
  seul, suivi du texte proprement dit) est reconnue comme UNE seule légende.
- Une image flottante ou dans une zone de texte est extraite si possible, **signalée toujours**.
- Une image DANS UNE CELLULE de tableau reste en ligne dans son paragraphe, jamais extraite en
  bloc figure séparé (aucun cas mesuré sur le corpus réel ni sur le gabarit livré).

`Fragment.note`/`Document.notes` (§4) : l'écrivain reporte chaque note APPELÉE (jamais les
orphelines) dans `word/footnotes.xml`, renumérotées à partir de 1 — style de renvoi et de
paragraphe de note pris dans le gabarit s'il en définit (nom canonique anglais du style), sinon
un simple exposant et `Corpsdetexte`. Une note appelée mais absente de `document.notes` reçoit un
contenu vide, tracé, plutôt qu'un document invalide.

### 5.4 Les listes

**Les listes du manuscrit sont reportées.** Portée mesurée sur le corpus réel : 3 manuscrits sur
11, 20 paragraphes.

Sous **pandoc 3.5** (celui de production), un `w:numPr` posé sur le paragraphe et un `w:numPr`
hérité d'un style donnent un AST strictement identique — l'import ne départage pas les deux
formes. Ce qu'on écrit : **les deux à la fois** (un style ET un `numPr`), comme Word le ferait
lui-même. Le `numId` du manuscrit ne se recopie **jamais** : il désigne une définition de
`numbering.xml` qui n'est pas celle du gabarit — le report se fait par **correspondance** (puce
vers la définition à puces, numérotée vers la définition numérotée, `ilvl` conservé). Le gabarit
livré ne définit aucune liste utilisable : l'écrivain emploie la définition du gabarit si elle
existe, et en injecte une sinon, en le disant dans la trace.

### 5.5 L'en-tête

Avant reconnaissance de l'en-tête, le titre, le sous-titre, les lignes d'auteurs, le résumé et
les mots-clés restaient dans le corps du manuscrit — les deux tableaux fixes du gabarit
ressortaient vides. `pipeline/manuscrit_entete.py` (module PUR, comme `manuscrit_modele.py` : ne
sait rien de Word ni d'OpenDocument) répare cela : il reconnaît la zone d'en-tête d'un manuscrit
**avant** le classement des titres du corps, et `manuscrit_gabarit.ecrire()` la porte jusqu'aux
deux tableaux fixes.

**Où ça s'accroche (§8)**, en cas B seulement : `extraire_entete()` retire du corps titre,
sous-titre, résumé, mots-clés, auteurs, DOI et ligne de revue AVANT `classer_titres()`, qui ne
juge donc que ce qui reste ; les paragraphes retirés sont remis dans `contexte['paragraphes']`
avec leur rôle (`titre`, `sous_titre`, `resume`, `mots_cles`, `auteurs` — `doi`/`ligne_revue`
n'ont pas de rôle, ils servent seulement à exclure ces deux paragraphes du corps) ;
`compteurs.signes_total` exclut tout paragraphe de rôle d'en-tête.

**La zone d'en-tête** : du début du document jusqu'au premier paragraphe « de corps » — le
premier paragraphe long (≥ `SEUIL_CORPS_ENTETE` = 300 signes) qui ne porte pas un marqueur
reconnu, ou le premier intertitre connu (`RE_INTERTITRE_CONNU` : « Introduction »,
« Einleitung », « Einführung », un numéro de section). Un document qui commence directement par
un intertitre connu ne consomme rien. Dans cette zone, seul ce qui est **positivement reconnu**
est consommé ; un paragraphe court non reconnu reste en place sans faire cesser le balayage.

**Titre et sous-titre** : le titre est le premier paragraphe non vide. Deux lignes consécutives
de même signature (§4) dont la première finit par « : » ou ne porte aucune ponctuation finale
valent titre + sous-titre — sauf si la seconde ressemble à une ligne d'auteurs, porte un marqueur
connu, ou est l'intertitre qui clôt la zone. À défaut, `docx-meta.scinder_titre()` scinde une
ligne unique sur son premier deux-points suivi d'un espace.

**Auteurs**, trois motifs essayés dans l'ordre : 1) **byline groupée** (« Prénom Nom, Prénom Nom
et Prénom Nom »), chaque segment devant individuellement passer `nom_plausible()` ; 2) **« Nom,
Prénom »** — essayé seulement après l'échec du premier motif : les deux premiers segments,
chacun un seul mot capitalisé, valent Nom puis Prénom (ordre inversé, c'est ce qui les
distingue) ; 3) une ligne sans nom mais avec un e-mail/ORCID/mot d'institution se rattache à la
DERNIÈRE fiche ouverte, seulement si un seul nom a été introduit juste avant. Un numéro de
téléphone est reconnu et **écarté** — le schéma `EnTete.auteurs` n'a pas de champ téléphone.
`ROR` n'est jamais rempli (la rédaction le choisit dans le cockpit).

**Résumé — capture bornée** : commence à un marqueur reconnu (`docx-meta.RE_RESUME`) et se
poursuit jusqu'à la première condition atteinte parmi : un nouveau marqueur reconnu ; l'intertitre
qui clôt la zone (et la zone entière se termine là) ; un paragraphe court (< 120 signes) et
entièrement gras (un pseudo-titre que `classer_titres()`, qui tourne après ce module, n'a pas
encore pu voir) ; le plafond dur — 4 paragraphes ou 1500 signes cumulés, selon ce qui vient en
premier, avec une ligne de trace `resume_interrompu`. Une lettre de langue isolée collée au
marqueur par un saut de ligne manuel (« Résumé F\n… ») est retirée avant capture, seulement
devant un vrai `w:br`. Un résumé en langue étrangère au produit est conservé à part dans
`EnTete.resumes_autres`.

**Mots-clés** : une ligne `docx-meta.RE_KEYWORDS`, découpée par `decouper_keywords()`. Le gabarit
livré ne porte aucun champ mots-clés : ils sont écrits en premier paragraphe du corps, style
`Corpsdetexte`, sous la forme « Mots-clés : a, b, c », et signalés (`entete_mots_cles_corps`).

**DOI et ligne de revue** : reconnus et retirés du corps, mais ne portent aucun rôle dans le
vocabulaire de `manuscrit_regles.py` — aucun champ DOI dans le gabarit livré.

**Écriture dans le gabarit** : les deux tableaux fixes sont recopiés depuis le gabarit puis
remplis par regex sur leur XML brut. Plus d'auteurs que de fiches livrées par le gabarit → la
dernière fiche est dupliquée autant de fois que nécessaire ; moins d'auteurs → les fiches en trop
restent vides. `entete=None` (cas A, ou appelant qui ne le fournit pas) laisse les deux tableaux
vides.

### 5.5 bis Le bloc final d'informations sur les autrices et auteurs

La Revue demande aux autrices, en FIN de manuscrit, un second bloc « Informations sur les
autrices et auteurs : » (nom, fonction, institution, e-mail — en allemand « Angaben zu den
Autor:innen », avec les libellés de champ « Autorinnen und Autoren »/« Kontakt »). Sans
reconnaissance, ce bloc tombait dans l'étendue de bibliographie de la CLI (`_construire_
bibliographie()`), ses coordonnées ressortant en `APA.OrdreBiblio`/`APA.CitationAbsente`/
confiance basse (mesuré sur `2-clairseme_Article_CSPS_C.Pedrosa.docx` et
`2-fin-de-document_Article_RSPS.docx`).

`manuscrit_entete.extraire_bloc_auteurs_final(document, entete, langue, indices_entete)` répare
cela, **après** `extraire_entete()`, sur le document encore complet — `indices_entete` (les
indices déjà consommés par la zone d'en-tête) borne le repli ci-dessous : sans cette frontière,
un document COURT où toutes les lignes sont brèves se fait reparcourir en entier et réattribue à
tort une ligne de la TÊTE comme complément d'un auteur déjà ouvert plus haut. Deux voies, dans
cet ordre :

1. **un intertitre connu** (`RE_INTERTITRE_AUTEURS_FINAL` — « Informations sur les autrices et
   auteurs », « Angaben zu den Autor:innen »), le DERNIER du document s'il y en a plusieurs :
   tout, du marqueur jusqu'à la fin du document ou jusqu'à un Tableau, est le bloc. Un paragraphe
   unique séparé par des sauts de ligne manuels (Word pose souvent tout le bloc en UN SEUL
   paragraphe) est scindé sur `'\n'` avant d'être analysé ligne par ligne ;
2. à défaut, un **repli heuristique** : le plus long groupe de paragraphes COURTS
   (`SEUIL_LIGNE_AUTEUR_FINAL` = 120 signes — mesuré : les 117 références réelles du corpus font
   toutes plus de 120 signes, une ligne de fonction/adresse/e-mail du bloc auteurs en fait 15 à
   50) en fin de document, en s'arrêtant net sur un intitulé de bibliographie reconnu (même
   lexique que `_construire_bibliographie()`, jamais une seconde liste de titres). Consommé
   SEULEMENT s'il porte au moins un nom plausible (sinon rien, §5.1 : « en cas de doute, rien, et
   on le dit »).

Les lignes reconnues (`_analyser_bloc_auteurs()`) réutilisent EXACTEMENT les mêmes primitives que
la zone d'en-tête (`_tenter_noms`/`_tenter_nom_virgule_avec_info`/`_fusionner_info`) ; un libellé
allemand isolé (`RE_LIBELLE_AUTEUR_FINAL_DE`) n'est ni un nom ni une info, il est ignoré sans
rompre l'attribution en cours. Chaque auteur reconnu est **fusionné** dans `entete.auteurs` :
même nom (comparaison insensible à la casse et aux accents, `_cle_nom()`) → complète les champs
VIDES de la fiche déjà ouverte par la tête (jamais un champ déjà rempli écrasé, jamais une fiche
dupliquée) ; nom absent ou inconnu → nouvelle fiche, ajoutée à la fin.

Les indices consommés (marqueur + bloc, ou groupe du repli) sont fusionnés dans `indices_entete`
par la CLI (§8), retirés du corps **avant** `_construire_bibliographie()` : ces coordonnées ne
peuvent donc plus entrer dans l'étendue de bibliographie, ni comme paragraphes de corps.

⚠ **Limite connue, non corrigée ici** : le head-parsing (`_tenter_noms()`/`decouper_prenom_nom`)
ne sait pas distinguer « Prénom Nom » de « Nom Prénom » écrit sans virgule (une byline « Guilley
Edith, Valarino Isabel » donne « Guilley » comme prénom). Quand le même auteur apparaît sous les
deux ordres (tête et bloc final), la fusion par nom échoue et produit deux fiches au lieu d'une
seule complétée — mesuré sur `2-fin-de-document_Article_RSPS.docx`. Défaut pré-existant du
head-parsing, hors du périmètre de §5.5 bis.

---

## 6. Le pont typographique — un seul moteur, littéralement

La typographie de la maison, c'est `pipeline/filters/szh-typographie.lua` : douze règles A1..C2,
1 218 lignes, des règles **opposées** entre le français et l'allemand suisse, des exclusions
contextuelles (DOI, dates ISO, COVID-19, le `ß` qu'on ne touche jamais). **On ne la réécrit pas
en Python.** Le nettoyeur appelle le filtre existant :

```
pandoc -f json -t json -M lang=<fr|de> --lua-filter pipeline/filters/szh-typographie.lua
```

Entrée : un AST pandoc construit à la main depuis les fragments d'un paragraphe. Sortie : le même
AST, normalisé. La langue se passe en `-M lang=` : elle vient STRICTEMENT du produit (`revue` →
fr, `zeitschrift` → de), jamais de `document.langue`.

Le filtre émet en plus, sur stderr, ses propres avertissements `[typo-avertissement]` — les codes
C1 (le `ß`) et C2 (guillemets droits non appariés), signalés sans jamais être corrigés. Ces
lignes deviennent des alertes du rapport telles quelles, lues sur un appel **réussi** comme sur
un échec (`normaliser_paragraphes()` rend `(paragraphes, traces, abandons, avertissements,
statut)`).

**Sous Linux (production), pandoc est appelé directement** : `_executer_pandoc()` détecte
`sys.platform != 'win32'` → pandoc du PATH, direct, chemin Linux natif du filtre (sans `wslpath`,
sans `wsl.exe`, qui n'existent pas dans la distro) ; sous Windows (poste de développement) →
`wsl.exe` + `wslpath -a`, inchangé.

### La réinjection

Word découpe le texte d'un paragraphe en `w:r` de façon imprévisible, parfois au milieu d'un mot.
Le texte revient normalisé **en un bloc** ; il faut le redistribuer dans les runs d'origine sans
perdre leur mise en forme. Méthode : `difflib.SequenceMatcher` **caractère par caractère** entre
le texte d'origine et le texte normalisé. Chaque segment conservé garde la `forme` de son run
d'origine ; un caractère inséré prend celui de son voisin de gauche.

Le seul invariant qui compte : **le texte réinjecté dans les fragments doit être identique,
caractère pour caractère, au texte que le filtre a rendu** — vérifié explicitement (une « garde
de sortie »), jamais supposé. Une seconde garde, symétrique, vérifie que le texte envoyé au
filtre pour une unité n'a pas divergé de la concaténation de ses fragments d'origine entre les
deux passes (« garde d'entrée »). Un échec de l'une ou l'autre est un bug de CE module — jamais
un verdict sur une correction du filtre. On ne rend jamais un texte qu'on n'a pas su reconstruire.

`Fragment.note` (§4) est une unité OPAQUE, au même titre qu'une image : jamais envoyé au filtre,
réinséré tel quel à sa place.

---

## 7. Le moteur de règles

Le catalogue vient des deux PDF `outils-dev/Redaktionsrichtlinien {Revue,Zeitschrift} 2025.pdf`
— eux seuls font foi. Trois couches, chacune avec un **seul propriétaire** :

| Couche | Propriétaire | Édité par |
|---|---|---|
| Typographie (espace insécable, apostrophe, guillemets, tiret…) | `pipeline/filters/szh-typographie.lua` (§6) | qui code, en Lua |
| **Lexicale et éditoriale** (langage épicène, vocabulaire du handicap, casse maison, liaison et/&, citation directe, nom des éditions) | **`pipeline/vale/styles/*.yml`**, exécutées par **Vale** | la rédaction, en YAML |
| **Structurelle** (longueurs, niveaux de titre, cohérence d'une bibliographie, accessibilité) | `pipeline/manuscrit_regles.py` | qui code, en Python |

La frontière entre la deuxième et la troisième couche : un motif de texte (« ce mot-là est
proscrit ») est lexical, Vale ; une comparaison entre plusieurs éléments du document (« ce titre
saute un niveau », « ces deux références ne sont pas dans l'ordre ») est structurelle, Python.

`pipeline/manuscrit_regles.py` ne connaît NI Word NI OpenDocument. Il reçoit un Contexte — un
dict JSON simple, jamais les classes de `manuscrit_modele.py` — et ne regarde que des chaînes et
des nombres déjà extraits par l'appelant : ce module ne devine jamais quel paragraphe est le
titre, le sous-titre ou le résumé de l'article.

```
{
  "produit": "revue" | "zeitschrift",
  "langue": "fr" | "de" | "fr-CH" | "de-CH" ...,
  "paragraphes": [ {"source": 0, "texte": "…", "role": "titre", "niveau_retenu": 0}, ... ],
  "bibliographie": [ {"nom": "Dupont", "annee": 2020, "nb_auteurs": 3, "texte": "…", "source": 12}, ... ],
  "images": [ {"alt": "…", "source": 3}, ... ],
  "tableaux": [ {"fusion": true, "source": 5}, ... ],
  "avertissements_typo": [ "[typo-avertissement] eszett | article « … » | … | [de] …", ... ]
}
```

`role` sur un paragraphe : `''` (corps, défaut), `'titre'`, `'sous_titre'`, `'resume'`,
`'auteurs'`, `'mots_cles'`, `'bibliographie'` — aucune règle de ce module ne déduit ce rôle, c'est
à l'appelant de le fournir. Une alerte porte huit champs, inchangés : `rule`, `severity`,
`action`, `para`, `span`, `found`, `suggested`, `message`.

Ce que ce module NE fait PAS, et pourquoi : aucune règle de typographie (§6) ; aucune règle
lexicale/éditoriale (Vale, ci-dessus) ; `Media.ResolutionImage`/`Media.TaillePortrait` sont
inmécanisables avec le modèle actuel (`Image` ne porte qu'une `surface`, pas de
largeur/hauteur séparées) ; ce qui exige un jugement sémantique (accord grammatical de
proximité, style passif/actif, contraste WCAG d'une image) n'est pas mécanisé — classer
« indice » puis inventer une règle bruyante casserait le principe : « le volume d'alertes est
un défaut ».

`APA.OrdreAlphabetiqueBiblio` n'est **pas** dans ce catalogue : `manuscrit_biblio.
verifier_ordre()` (§7 bis) la recouvre entièrement et fait strictement plus (suffixes a/b/c, sur
une bibliographie réellement extraite). `APA.NombreAuteursListes.*`, `APA.TroisAuteursPlus` et
`APA.MemeAuteurMemeAnnee` restent ici : ce sont des questions de FORME (troncature, ponctuation,
espacement), jamais une comparaison entre citation et référence.

Trois pièges Vale mesurés (Vale 3.22.0), à ne pas repayer, voir §10.

**Aucune règle de résolution d'image dans ce catalogue.** Le nettoyeur **rapporte les
dimensions en pixels** (un fait, mesuré) ; le **verdict** est rendu par
`vscodium-extension/szh-cockpit/lib/qualite-image.js` au moment où le rapport HTML est composé —
zéro duplication, une seule vérité sur ce qui est « trop petit ».

**Le piège OQLF/CSPS** : l'Office québécois privilégie « personne handicapée » ; les lignes
directrices CSPS, adossées au MDH-PPH, privilégient « personne en situation de handicap ». La
règle `CSPS.Vocabulaire.Handicap` (`pipeline/vale/styles/CSPS/Vocabulaire/Handicap.yml`) garantit
que « personne en situation de handicap » ne lève aucune alerte — testé par
`test/js/manuscrit-vale.test.js`.

**Révision du 21.09.2026 — deux familles CSPS ajoutées** : `TraitUnion` (huit règles,
`pipeline/vale/styles/CSPS/TraitUnion/*.yml`, écrites à la main, fondées sur Wikipédia « Emploi
du trait d'union pour les préfixes en français » et « Trait d'union ») et `Orthographe` (neuf
catégories, `pipeline/vale/styles/CSPS/Orthographe/Rectifiee-*.yml`, **générées** par
`outils-dev/lexique/generer-orthographe.py` depuis `pipeline/vale/lexique/
orthographe-rectifiee.csv`, fondées sur Wikipédia « Rectifications orthographiques du français
en 1990 »). Voir `pipeline/vale/LISEZMOI.md` pour le détail de chaque famille — deux décisions
à retenir ici :
- **Décision de la rédaction (21.09.2026)** : la Revue écrit en orthographe rectifiée, pas en
  traditionnelle. Toutes les règles `Orthographe.Rectifiee-*` sont donc `level: warning` avec
  `action: replace` (révision Word, §7 ter), quel que soit ce que les deux PDF
  Redaktionsrichtlinien en disent (rien, pour l'orthographe rectifiée — silence vérifié dans les
  deux PDF) : une graphie traditionnelle rencontrée est une faute résiduelle à corriger, jamais
  une politique à trancher au cas par cas.
- **Chaque règle des deux familles est un lexique FERMÉ**, jamais un motif productif : un
  préfixe comme « sous- »/« sans- » est aussi une préposition très courante, et « non-»/
  « quasi- » ne prennent le trait d'union que devant un nom, jamais un adjectif — une
  distinction que Vale (RE2, sans lookaround) ne peut pas trancher en général. Chaque paire est
  donc vérifiée un mot à la fois, jamais une combinaison générée à la volée.

**Piège YAML mesuré en vrai (vale 3.22.0)**, à ne pas repayer en modifiant l'une ou l'autre
famille : un motif contenant `\b` doit être écrit entre guillemets SIMPLES (`'\bmot\b'`), jamais
doubles — dans une chaîne YAML entre guillemets doubles, `\b` est l'échappement du caractère
« retour arrière », pas un antislash suivi d'un `b`, et le motif ne lève alors plus rien,
silencieusement.

---

## 7 bis. Bibliographie — contrôle, DOI, mise en forme

`pipeline/manuscrit_biblio.py`. Module **pur** : il reçoit du texte de paragraphe déjà extrait
(`{'texte':…, 'source':…}`) et rend des alertes au même format à huit champs.

**Ne recopie rien** de ce qui existe déjà : `pronto_modele.normaliser()`/`aplatir()`/
`lire_titres_bib()` (repérage de l'étendue d'une bibliographie, identique à celui de
`manuscrit-nettoyer.py`) ; `docx-meta.py` pour `nettoyer_doi()`, `RE_DOI`, `langue_du_doi()`,
`decouper_prenom_nom()`, `nom_plausible()`, `PARTICULES`.

### Ce que le module fait

1. `analyser_reference(texte)` découpe UNE entrée APA 7 (fr/de) en `auteurs`, `nb_auteurs`,
   `annee`/`suffixe`, `titre`, `conteneur`, `volume`, `numero`, `pages`, `editeur`, `doi`
   (canonique), `url`, `type`, `confiance` (`haute|moyenne|basse`). Mesuré sur les 117 références
   réelles du corpus : **88/117 (75 %) en confiance haute** ; en excluant les 9 entrées d'un
   fichier où l'extension de bibliographie se trompait de section (défaut décrit plus bas, hors
   de ce module), **88/108 = 81,5 %**.
2. `citations_du_corps(paragraphes)` — chaque appel dans le texte, narratif ou parenthétique,
   avec `nom_premier_auteur`, `annee`, `suffixe`, `para`, `span`. Une année isolée hors citation
   n'est jamais retenue. Un mot capitalisé devant `(année…)` n'est narratif QUE si le contenu de
   la parenthèse commence par l'année (sinon la citation est en réalité DANS la parenthèse —
   mesuré : « du MPA (Booms et al., 2023) » prenait à tort « MPA » pour le nom cité).
3. `croiser(citations, references)` — citée mais absente (`APA.CitationAbsente`, error), en
   bibliographie mais jamais citée (`APA.ReferenceNonCitee`, warning), suffixe incohérent
   (`APA.Suffixe`), « et al. » manquant dès trois auteurs ou de trop pour un ou deux (`APA.EtAl`,
   `action='fix'`).
4. `verifier_ordre(references)` — alphabétique puis chronologique, suffixes a/b requis dès que
   deux références partagent auteur et année.
5. `doi_normaliser(ref)` — `doi:`, `DOI :`, `dx.doi.org/…`, `http://doi.org/…` →
   `https://doi.org/10.…`, `action='fix'`.
6. `resoudre_crossref(ref, delai=4)` / `retrouver_doi(ref, delai=4)` — seul point réseau, GET sur
   `api.crossref.org`. Seules les métadonnées de la référence partent, jamais le texte de
   l'article. `retrouver_doi()` n'accepte qu'une similarité de titre ≥ 0,9 avec auteur et année
   concordants, et ne rend qu'une **suggestion** (`action='comment'`). `_requete(url, delai)` est
   le seul point qui touche réellement le réseau — les tests le remplacent toujours.
7. `mise_en_forme_apa(ref, metadonnees_crossref=None)` — la chaîne canonique, italique marquée
   par `*…*`. Deux différences fr/de : volume(numéro) collé en français (`12(3)`), espacé en
   allemand (`27 (3)`) ; éditeur `(Éd.)`/`(Éds.)` en français, `(Hrsg.)` en allemand. Rendue
   seulement si `confiance == 'haute'` ou Crossref confirmé.
8. `analyser_bibliographie(paragraphes_corps, paragraphes_biblio, langue, reseau=True)` enchaîne
   tout et rend `(alertes, stats)`. `reseau=False` : `stats['crossref']['indisponible'] = True`,
   aucune tentative réseau (`--sans-reseau`).

**Où le titre se sépare du conteneur** : le titre finit sur `.`, `?` ou `!`. `:` n'est **pas**
dans ce jeu principal — un titre à sous-titre porte lui-même un `:`, le premier rencontré
l'emporterait à tort sur le vrai séparateur (mesuré : « Hétérogénéité, diversité, différences :
Vers quelle égalité des élèves ? Nouvelle revue… » coupait sur le premier `:`). `:` ne sert qu'en
repli, tenté seulement si `.?!` échouent partout.

**Les particules** : `_normaliser_nom()` ôte les particules de tête (`PARTICULES` de
`docx-meta.py`) avant de comparer. Un second cas, construit pour le chantier (aucun exemple réel
mesuré) : l'écriture APA de classement qui place la particule APRÈS les initiales (`Chambrier,
A.-F. de`) — `_decouper_initiales_et_particule()` la détecte.

### Révision du 21.09.2026 — langue DE LA RÉFÉRENCE, italique du volume, DOI retrouvé en révision

Quatre défauts mesurés sur `outils-dev/Le coenseignement développemental_revue Suisse_10082026.docx`
(référence Ploessl & Rock, 2014) et corrigés :

1. **`langue_ref`**, un nouveau champ de `analyser_reference(texte, langue_doc='fr')` : la langue de
   CETTE référence (mots-outils anglais « the, of, and, for, in », allemands « der, die, das, und,
   für », sinon `langue_doc`), distincte de `_langue` (la langue du PRODUIT, qui pilote le reste de
   la mise en forme APA — volume/numéro, « (Éd.) »/« (Hrsg.) »). Elle décide seulement de
   l'espacement du séparateur `:` titre/sous-titre À L'INTÉRIEUR du titre cité (insécable en
   français, aucune espace en anglais ET en allemand — le filtre Lua ne connaît que fr/de, jamais
   'en' : un titre anglais cité dans une bibliographie française n'est donc jamais couvert par lui).
   **Mesuré, non corrigé (sujet de compilation, hors de ce module)** : `szh-typographie.lua` pose
   une insécable AVANT ce `:` en français, y compris dans un titre anglais, parce qu'il traite tout
   le document comme une seule langue (`-M lang=`) — c'est ce qui produisait le texte d'origine
   fautif (« Coaching␣: The effects ») que `manuscrit_biblio.py` corrige maintenant dans son propre
   `suggested`.
2. **Italique du volume seul** (`mise_en_forme_apa()`) : `*37*(3)`, jamais `*37(3)*` — l'ancien
   rendu italicisait le numéro entre parenthèses avec le volume. La plage de pages d'un CHAPITRE
   (seul contexte « pp. » du module) suit désormais la même règle T2 que le filtre
   (`_t2_plage_pages_chapitre()`, trait d'union en français, demi-cadratin en allemand) ; un
   ARTICLE ne préfixe jamais ses pages, T2 ne s'y applique donc jamais (inchangé).
3. **`suggested_texte`** sur `APA.MiseEnForme` : `suggested` SANS le marquage `*…*`, pour un usage
   en texte plat (rapport HTML) — `suggested` garde ses astérisques pour l'annotation Word, seule
   destinataire qui sait les traduire en italique réel. Même principe côté `manuscrit_annoter.py`
   (§7 ter) pour un commentaire.
4. **`APA.DoiRetrouve` devient une révision** (`action='track'`), plus un commentaire : ancrée sur
   le dernier segment sûr de la référence (ses pages telles qu'écrites dans le texte d'origine, ou
   le point final), `suggested` = ce segment suivi de ` https://doi.org/…` — une INSERTION pure,
   jamais une réécriture de l'entrée. Repli commentaire si aucun segment sûr n'existe.

### Ce qui n'a pas pu être fait ici

- **Un auteur institutionnel cité par son SIGLE** (`OFS, 2022`) ne s'apparie pas à la référence
  qui porte le nom développé — mesuré : deux faux `APA.CitationAbsente`/`APA.ReferenceNonCitee`
  sur le corpus réel pour ce seul motif. Correctif identifié, non fait.
- **L'extraction de l'étendue de bibliographie** hérite du repérage par titre de
  `manuscrit-nettoyer.py`. Sur un fichier dont le dernier titre-bibliographie reconnu (« Titre 2 »
  posé sur un intitulé dupliqué en fin de document) précède le bloc final d'autrices/auteurs
  plutôt que les vraies références, ce repérage retrouve un bloc qui ne contient QUE des
  coordonnées — corrigé depuis pour ne plus produire d'alerte sur ces coordonnées (§5.5 bis), le
  repérage du bon intitulé de bibliographie, lui, reste un défaut ouvert, hors du périmètre de ce
  module qui ne fait que lire ce qu'on lui donne.
- **La mesure fr/de sans `pdftotext`** : la WSL `SZH-Publishing` ne porte pas `poppler-utils`. Les
  deux PDF Redaktionsrichtlinien ont été lus avec `pypdf` (Python de Windows) au lieu de
  `pdftotext -layout` — extraction fidèle, seul l'outil diffère.

---

## 7 ter. Annotation — révisions et commentaires Word

`pipeline/manuscrit_annoter.py` prend un `.docx` déjà au gabarit (la sortie de `ecrire()`) et les
alertes du §7/§7 bis (huit champs), et rend un `.docx` porteur de suivi de modifications et de
commentaires Word — jamais l'original, aucune décision inventée.

Décidé par Robin : **révisions Word** (auteur dédié, la rédaction accepte tout d'un clic) pour ce
qui est déterministe (`action` `fix`/`track` avec un `suggested`) ; **commentaires Word ancrés**
pour ce qui demande un jugement (`action` `comment`, ou un `fix`/`track` que le texte ne permet
pas de localiser) ; **plafonnés** ; le reste part au rapport HTML.

```
annoter(chemin_docx_entree, chemin_docx_sortie, alertes, correspondance, langue='fr',
        auteur='Relecture automatique', plafond_commentaires=25) -> stats
```

`chemin_docx_sortie` peut être IDENTIQUE à l'entrée : écriture dans un fichier temporaire puis
remplacement atomique (`os.replace`).

### Ancrage — jamais un run coupé au hasard

Pour chaque alerte avec `para` non nul, le `<w:p>` de sortie est retrouvé via `correspondance`
(le couple `{source, sortie}` de `ecrire()`, §3 : `sortie` compte les `<w:p>` enfants DIRECTS de
`w:body`, les `<w:tbl>` ne comptent pas). Ses `<w:t>` sont concaténés pour obtenir le texte du
paragraphe. Si `span` est donné ET que `found` s'y trouve exactement, il fait foi ; sinon la
première occurrence de `found` ailleurs dans le paragraphe est prise, à condition qu'elle fasse
au moins 4 caractères et soit **unique** dans le paragraphe (sinon l'alerte ancre sur le
paragraphe entier plutôt que de risquer de corrompre un mot pris au milieu d'un autre — un
`found` court comme « et » pouvait sinon matcher à l'intérieur de « **Cet**te »). Une alerte sans
`para`, ou dont le paragraphe n'existe plus dans `correspondance`, est **non ancrée** — comptée
dans `stats['non_ancrees']`, jamais perdue en silence.

Toutes les alertes d'un même paragraphe se localisent contre le MÊME texte figé, lu une seule
fois avant toute écriture. Le paragraphe se découpe en « atomes » avant la moindre écriture ; une
révision fusionne les atomes qu'elle couvre en un seul remplacement, un commentaire ne fait
qu'entourer les siens de marqueurs — le XML « de collage » qui ne vient pas d'un `<w:r>`
(ouverture/fermeture d'un `<w:hyperlink>`) est toujours recopié tel quel depuis l'original,
jamais régénéré. Deux révisions du même paragraphe dont les spans se CHEVAUCHENT ne fusionnent
jamais deux atomes imbriqués : la première qui touche un passage encore libre devient la
révision, toute suivante dont le span chevauche une révision déjà retenue devient un COMMENTAIRE
sur ce même passage. Un span qui touche la frontière d'un `<w:hyperlink>` ne devient JAMAIS une
révision non plus — il repart dans le flot des commentaires. **Filet, en plus** : chaque partie
`.xml`/`.rels` de la sortie est reparsée par `ET.fromstring` juste avant l'écriture du `.docx` ;
la moindre malformation lève une exception explicite, et `manuscrit-nettoyer.py` (§8) restaure
alors la version pré-annotation plutôt que de livrer un `.docx` corrompu avec un code de succès.

L'hypothèse qui simplifie tout : un `w:rPr` rencontré ne porte jamais que
`{w:b, w:i, w:u, w:vertAlign}` — exactement ce que `manuscrit_gabarit._rpr_xml()` sait écrire. Un
run se manipule donc par un jeu de DRAPEAUX reconstruits, jamais par une manipulation XML
générique. Le w:rPr d'un run SUPPRIMÉ (w:del) est recopié VERBATIM.

### Révisions et commentaires

Une révision pose un `<w:del>` et un `<w:ins>` avec un `w:id` chacun, uniques et croissants dans
tout le document (révisions ET commentaires partagent le même compteur), `w:date` en ISO 8601
UTC. `suggested` peut porter de l'italique `*…*` : chaque segment devient un run avec `<w:i/>`,
jamais les astérisques eux-mêmes.

Un commentaire pose `<w:commentRangeStart>`/`<w:commentRangeEnd>` autour du passage, puis un
`<w:commentReference>`. `word/comments.xml` est créé au besoin. Le texte du commentaire : le
message, puis « Suggestion : … » (« Vorschlag : … » en allemand) si `suggested`, puis
`[code.de.la.regle]` en fin de message — toujours en dernier.

**Le plafond** : les commentaires (jamais les révisions) sont triés `error` > `warning` >
`suggestion` puis par ordre d'apparition. Au plus 5 par règle — le 5ᵉ commentaire écrit d'une
règle reçoit une phrase de synthèse (« … et *N* autres occurrences… »), ajoutée à la fin de son
message. Puis le plafond global (`plafond_commentaires`, 25 par défaut). Dans les deux cas,
l'alerte écartée est ajoutée telle quelle à `stats['renvoyees_au_rapport']`. `action == 'report'`
n'est jamais écrite dans le document.

`stats` : `{revisions, commentaires, commentaires_synthese, renvoyees_au_rapport, non_ancrees,
par_regle}` — `renvoyees_au_rapport` et `non_ancrees` portent les alertes elles-mêmes, pas
seulement un compte.

Ce module expose toujours une fonction pure et une CLI d'essai (`manuscrit_annoter.py
<sortie.docx> --alertes … --correspondance … [--plafond 25]`), en plus d'être branché dans
`manuscrit-nettoyer.py` (§8).

### Révision du 21.09.2026 bis — diff par jeton, chevauchement au span le plus large, repli tolérant

Trois changements, mesurés sur le corpus réel (`Le coenseignement développemental…`, 27 références,
et sur `manuscrit-annoter.test.js`) :

1. **Une révision `found` -> `suggested` n'est plus systématiquement un seul `w:del`/`w:ins`
   couvrant tout le span.** `_construir_revision()` calcule un diff PAR JETON (`\w+|\s+|[^\w\s]`,
   `difflib.SequenceMatcher(autojunk=False)`) entre le texte d'origine et `suggested` : seuls les
   jetons qui changent — texte OU italique — deviennent `w:del`/`w:ins`, le reste reste des runs
   NORMAUX avec leur mise en forme d'origine intacte. Un jeton dont le TEXTE est égal mais qui doit
   changer d'italique est aussi émis en `w:del` + `w:ins` du seul jeton (jamais `w:rPrChange`,
   trop fragile) ; un jeton déjà dans l'état voulu (italique ou non) n'est jamais touché — la
   resubdivision se fait À L'INTÉRIEUR d'un opcode `equal` du diff, jeton par jeton, jamais à
   l'échelle de l'opcode entier (piège mesuré en écrivant ce lot : marquer tout un opcode `equal`
   de 50 jetons comme changé parce qu'UN SEUL doit devenir italique revenait à barrer toute la
   référence). Les îlots inchangés de moins de 3 jetons, coincés entre deux changements, sont
   absorbés dans le changement voisin (évite la mitraille de micro-révisions). Un diff qui change
   plus de 60 % des jetons d'origine retombe sur l'ancien comportement (un seul `w:del`/`w:ins`
   pour tout le span) — une reformulation aussi profonde n'a plus rien à gagner à être éparpillée.
2. **Repli tolérant à la typographie**, dans `_localizar()` : si `found` n'a AUCUNE occurrence
   exacte dans le paragraphe, un second essai compare les deux textes après une normalisation
   caractère-pour-caractère (apostrophe typographique/droite, insécable/fine/espace ordinaire,
   demi-cadratin/cadratin/trait d'union insécable → un caractère ASCII), qui préserve la longueur :
   une position trouvée dans le texte normalisé reste donc valide telle quelle dans l'original,
   sans remapper d'offsets. Ne s'applique jamais quand l'occurrence exacte est déjà AMBIGUË
   (plusieurs correspondances) — le repli désambiguïse un texte introuvable, jamais un texte trouvé
   plusieurs fois.
3. **Chevauchement à sévérité ÉGALE : le span le plus LARGE gagne**, plus le premier de la liste.
   Mesuré : `APA.MiseEnForme` (span = la référence entière) perdait systématiquement face à une
   règle Vale bien plus étroite qui corrige la MÊME chose en passant (ici,
   `CSPS-Biblio.APA.Esperluette`, « et » → « & », sur 4 références du manuscrit réel) — toute la
   mise en forme APA proposée disparaissait en commentaire pour ne garder qu'un « et » → « & »
   isolé. La révision la plus large a beaucoup plus de chances d'englober ce que fait la plus
   étroite que l'inverse ; l'ordre d'apparition ne tranche plus qu'en tout dernier recours. Mesuré
   après ce correctif, chaîne complète WSL sur le manuscrit « coenseignement » (27 références,
   `--sans-reseau`) : `APA.MiseEnForme` passe de 15/19 (79 %) à 19/19 (100 %) en révision Word ;
   même mesure sur `2-clairseme_Article_CSPS_C.Pedrosa.docx` (lot-A) : 8/8 (100 %).

**Défaut vu ailleurs, non corrigé ici (hors des deux fichiers de ce lot)** : `dans_docx` sur chaque
alerte (`manuscrit-nettoyer.py`, `_marquer_dans_docx()`, §8) est déduit par `id()` des seules listes
`non_ancrees`/`renvoyees_au_rapport` de `annoter()` — une alerte `fix`/`track` DÉMOTÉE en commentaire
par le chevauchement (point 3 ci-dessus, ou toute démotion future) n'apparaît dans AUCUNE des deux
et reste marquée `'revision'` dans le rapport alors qu'elle est un vrai commentaire dans le `.docx`
(mesuré : les 4 alertes `APA.MiseEnForme` démotées avant ce correctif portaient toutes
`dans_docx: 'revision'`). `manuscrit-nettoyer.py` est hors des fichiers autorisés pour ce lot
au-delà de l'ordre des étapes.

---

## 8. La CLI

```
manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift --sortie <dossier>
                      [--rapport <fichier.json>] [--analyse-seule] [--sans-typo]
                      [--sans-annotation] [--sans-reseau]
```

Enchaînement : lire → reconnaître le cas → reconnaître l'en-tête et le bloc final d'autrices/
auteurs (§5.5, §5.5 bis, cas B seulement) → classer les titres → nettoyer la mise en forme →
normaliser la typographie → passer les règles (structurel + Vale + bibliographie) → écrire le
gabarit → annoter le `.docx` écrit → écrire le rapport.

- écrit `<dossier>/<nom>-nettoye.docx` et `<dossier>/<nom>-rapport.json` ;
- `--analyse-seule` : aucun `.docx` écrit, seulement le rapport ;
- **code de sortie non nul s'il existe au moins une alerte `error`** ;
- une ligne JSON de statistiques sur stdout, rien d'autre sur ce flux. Les messages de
  progression vont sur stderr, une ligne par étape ;
- **la CLI écrit explicitement en UTF-8** sur ses deux flux ;
- **la sortie est écrite à côté du manuscrit d'entrée** ;
- la ligne JSON de stdout porte `typographie: "appliquee" | "repli"` — `--sans-typo` porte aussi
  `"repli"` sur cette ligne (rien n'a été tenté) mais ne lève PAS d'alerte ; un repli involontaire
  (pandoc/WSL indisponible) lève en plus `Typo.ApplicationImpossible`.

**Refus explicites**, jamais un devinement : le document porte des `w:ins`/`w:del` (texte non
univoque) ; extension inconnue ou `.odt` (lecteur pas encore écrit) ; un fichier `~$*.docx`
(verrou temporaire de Word) → `code_refus: 'fichier-verrou'`, avant toute tentative de lecture.

Un document porteur de **commentaires** n'est PAS refusé : comptés et signalés, ils ne survivent
pas au nettoyage.

**La langue de traitement** : `'fr'` pour `--produit revue`, `'de'` pour `--produit zeitschrift`
— jamais `document.langue`. C'est cette langue qui part au filtre, aux règles et au rapport. La
langue déclarée du document ne sert plus qu'à une alerte `warning` (`Langue.DesaccordProduit`)
quand sa sous-étiquette primaire diffère de celle du produit.

**Les quatre moteurs** (structurel, Vale, bibliographie, la reprise des avertissements du filtre
typographique) reçoivent leurs corpus, concaténent leurs alertes puis trient par sévérité puis
par `para`. Vale et la bibliographie reçoivent chacun deux corpus (corps / bibliographie), les
mêmes paragraphes de premier niveau que le moteur structurel, moins l'en-tête et le bloc final
déjà retirés ; Vale reçoit EN PLUS les cellules de tableau et le contenu des notes, à toute
profondeur — jamais ancrables dans le `.docx` produit (`source=None`), mais Vale doit les voir
quand même. `manuscrit_regles.grouper()` ne connaît que le catalogue structurel : la CLI
regroupe elle-même par famille et par règle (`_grouper_toutes_alertes()`). `rapport['alertes']
['origine']` compte les quatre moteurs séparément.

**Annotation** : après l'écriture du gabarit, si ni `--analyse-seule` ni `--sans-annotation` ne
sont posés, `manuscrit_annoter.annoter()` reçoit les alertes fusionnées et
`decisions.ecriture.correspondance`. Chaque alerte reçoit `dans_docx`
(`'revision' | 'commentaire' | 'rapport'`), déduit PAR IDENTITÉ D'OBJET (`id()`) des listes que
`annoter()` rend — jamais recalculé. `correspondance[i].source` (rendu par
`manuscrit_gabarit.ecrire()`) porte le vrai `Paragraphe.source` du bloc d'origine, jamais une
position de liste : la CLI n'a plus besoin de le remapper.

**Options d'essai** : `--sans-annotation` n'écrit ni révision ni commentaire ; `--sans-reseau`
transmis à `manuscrit_biblio.analyser_bibliographie(reseau=…)` — le lanceur ne le pose jamais en
production, les tests le posent toujours (déterminisme).

**Le rapport JSON** porte : `controles.vale` (`'effectue' | 'indisponible'`), `bibliographie`
(les stats de `manuscrit_biblio.analyser_bibliographie()`), `annotation` (les stats de
`manuscrit_annoter.annoter()`, ou `null`), `decisions.entete` (donnée fusionnée en-tête + bloc
final), `alertes.origine`, `dans_docx` sur chaque alerte, `compteurs.notes`/`revisions`/
`commentaires_poses`.

---

## 9. L'onglet du lanceur

Onglet **« Préprocessing »** dans `windows/open-produit.ps1`, calqué sur l'onglet « Export et
secrétariat » — même géométrie, mêmes marges, aucun onglet n'agrandit la fenêtre.

Contenu : un groupe de boutons radio Revue / Zeitschrift, un bouton « Manuscript cleaner
(Article)… » qui ouvre un sélecteur de fichier (`.docx`, `.odt`), un journal de progression
(Consolas 9, lecture seule), une barre de progression Marquee, un bouton « Interrompre », un
bouton « Ouvrir le dossier ».

Le nom **« Manuscript cleaner (Article) »** reste tel quel dans les trois langues (nom de
produit) ; `(Article)` parce qu'un nettoyeur dédié aux livres viendra. Tous les autres textes
passent par `T` et existent en fr, de et en (`windows/szh-textes.ps1`, préfixe
`lanceur.preproc.`).

Assistant `Invoke-SzhManuscrit`, calqué sur `Invoke-SzhSecretariat` : `wslpath -a` pour convertir
les chemins dans les deux sens ; les rôles des deux flux sont inversés par rapport à l'onglet
secrétariat (ici la progression est sur **stderr**, stdout réservé à l'unique ligne JSON finale)
— `$p.StandardOutput.ReadToEndAsync()` démarrée AVANT de boucler en `ReadLineAsync()` sur stderr,
sinon le flux qu'on ne lit pas sature son tube et bloque l'enfant ; jamais
`add_ErrorDataReceived` + `BeginErrorReadLine()` (tue le processus PowerShell entier) ;
`ReadLineAsync()` + `DoEvents` + `Sleep 25` pour pomper l'interface ; décodage de la sortie
`wsl.exe` fait ici et nulle part ailleurs ; WSL absente ou distro éteinte → message clair.

Le rapport HTML est rendu **après** le retour de la CLI : le JSON part dans
`outils/rendre-gabarit.js` avec le gabarit
`vscodium-extension/szh-cockpit/export-templates/rapport-manuscrit.twig`. Le lanceur ne fabrique
jamais d'HTML à la main.

---

## 10. Pièges mesurés

Tous constatés, aucun supposé, datés. Ils sont la valeur de ce document : les corriger ailleurs
sans les relire ici revient à les repayer.

**18.09.2026 — `docx+styles` existe, `odt+styles` n'existe pas.** pandoc 3.5 répond « The
extension styles is not supported for odt ». Ne jamais bâtir la conservation des styles
là-dessus.

**18.09.2026 — LibreOffice fond deux tableaux qui se touchent.** Mesuré sur le gabarit réel :
4 tableaux côté `.docx`, 3 côté `.odt`. L'écrivain pose donc toujours un paragraphe vide entre
deux blocs qui se touchent.

**19.09.2026 — « toujours un » n'est pas « au plus un ».** Un ou plusieurs paragraphes vides déjà
présents dans le manuscrit, collés à un bloc, s'ajoutaient au séparateur injecté au lieu de s'y
substituer — jusqu'à trois `<w:p/>` consécutifs entre deux tableaux. Corrigé dans
`manuscrit_gabarit._convertir_niveau_racine()` : les vides consécutifs sont fondus à un seul
avant l'insertion des séparateurs.

**Le numéro de page n'existe que si Word a repaginé** (`w:lastRenderedPageBreak`), absent d'un
fichier fabriqué par script, sans équivalent OpenDocument. Ne jamais estimer une page depuis un
nombre de signes : `page = None` est une réponse acceptable, une page inventée ne l'est pas.

**19.09.2026 — `wsl.exe` n'existe pas DANS la WSL, et son absence ne lève aucune exception
explicite.** Le pont typographique appelait toujours `wsl.exe -d SZH-Publishing -- pandoc ...`,
y compris quand la CLI tourne déjà dans la distro. `subprocess.run(['wsl.exe', ...])` y échoue
comme n'importe quel exécutable introuvable — capturé comme une indisponibilité de pandoc, un
repli SILENCIEUX : 845 paragraphes sur 845 rendus inchangés, code de sortie 0, rien qui le
signale. Corrigé : `sys.platform != 'win32'` → pandoc direct (§6) ; seulement sous Windows →
`wsl.exe`.

**18.09.2026 — `wsl.exe` avale les antislashs d'un argument passé en tableau.**
`subprocess.run(['wsl.exe', ..., 'C:\\Users\\robin\\...\\filtre.lua'])` fait arriver
`C:Usersrobin...filtre.lua` côté Linux. Convertir les `\` en `/` AVANT l'appel.

**18.09.2026 — l'avertissement sur l'UTF-16 de `wsl.exe` ne vaut pas pour tout.** Il concerne les
commandes Windows natives de `wsl.exe` (`wsl -l -v`). La sortie relayée d'un programme Linux
(pandoc, python3) traverse en UTF-8 intact, insécables comprises, vérifié octet par octet.

**18.09.2026 — `mc:AlternateContent` cache des dessins.** Sur `4_La méthode Flip Flap.docx`, les
dix ancrages flottants du fichier sont tous enveloppés dans `w:r > mc:AlternateContent >
mc:Choice > w:drawing`, deux niveaux sous le run — un lecteur qui ne regarde que les enfants
directs d'un `w:r` les perd tous les dix sans un mot. Déplier la branche `mc:Choice`, jamais
`mc:Fallback` par défaut (même forme répétée en VML, la compter aussi doublerait chaque dessin)
— **sauf** quand la Choice ne porte aucune image propre : son Fallback peut alors porter un vrai
groupe `<v:imagedata>` que la Choice n'a pas (4 des 10 ancrages de ce même fichier).

**Le texte n'est pas que dans `document.xml`** : notes de bas de page, en-têtes, zones de texte,
champs. L'extraction les couvre ou déclare ce qu'elle ignore — jamais en silence.

**`python3` nu peut se figer** sur Windows (résout vers l'alias d'exécution `WindowsApps`, ne
rend jamais la main sous `spawnSync`). Les tests passent par `PYTHON` de `test/js/gardes.js`.

**Le volume d'alertes** : deux cents signalements rendent l'outil détestable en une semaine. Le
rapport groupe par famille, compte par règle, et au-delà de dix occurrences d'une même règle
affiche les dix premières et le total.

**19.09.2026 — un même `r:id` VML peut être répété plusieurs fois dans le même groupe.** Sur
`4_La méthode Flip Flap.docx`, un décompte qui compte les OCCURRENCES de `v:imagedata` plutôt que
les identifiants DISTINCTS surcompte d'un facteur 5 (24 occurrences pour 5 images réelles).
Dédoublonner par `r:id`, jamais par position.

**Un `w:sdt` de niveau BLOC est invisible à `blocs_du_corps()`.** Repris tel quel de
`pronto_docx.py` (§3), il ne reconnaît que `w:p`/`w:tbl` comme enfants directs du corps — un
contrôle de contenu qui enveloppe un `w:p` ENTIER fait disparaître ce paragraphe sans
avertissement. Le déplier dans l'arbre XML avant tout parcours.

**19.09.2026 — le nom d'un fichier ment.** `2-fin-de-document_Article_RSPS.docx` porte des NOTES
DE BAS DE PAGE (`word/footnotes.xml`), pas des notes de fin. Ne jamais nommer un fichier de test
sur la foi d'un nom de fichier réel sans avoir ouvert l'archive.

**Deux Word/pandoc différents peuvent lire un tiret différemment sans corruption.** U+2011
(trait d'union insécable) peut arriver dans `<w:t>` par `w:noBreakHyphen` OU par un `w:sym` dont
`w:char="2011"` — mesuré sur `1bis_Booms Article.docx` (6 occurrences par `w:sym`, aucune par
`w:noBreakHyphen`).

**19.09.2026 — les tirets ne doivent pas être normalisés à la lecture.** Une version antérieure
du lecteur appliquait les substitutions de `pronto_modele.normaliser()` (–, —, ‑ → `-`) à chaque
`Fragment.texte` : 4 cadratins et 89 demi-cadratins réels du corpus dégradés en simple trait
d'union avant même que le filtre typographique (règle T2) ait pu les voir. Supprimé du lecteur ;
seul `projeter_pronto()` normalise encore (§4).

**19.09.2026 — `Image.source` portait l'indice du `w:r`, pas du `w:p` porteur.** Sur 6 rapports
d'images sur 7, `source` valait 0 pour toutes. Corrigé (§4).

**21.09.2026 — le plancher d'homogénéité (§5.1).** `3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx`
rendait 0 titre (1/17 pseudo-titres retrouvés) : son seul groupe qualifiant (14 des 15 vrais
titres) était rejeté en bloc parce que le critère d'homogénéité comparait au plus court candidat
— un titre à un seul mot (« Résumé »). `PLANCHER_HOMOGENEITE_MOTS = 4` corrige cela : mesuré,
15/17 sur `3bis_`, 14/16 en prime sur `4_La méthode Flip Flap.docx`, 0 régression sur le reste du
corpus (25/34 sur `2-fabrique`, inchangé).

**19.09.2026 — signatures effectives vs directes (§5.1).** Substituer partout la signature
EFFECTIVE à la DIRECTE faisait chuter le corpus `2-fabrique` (faux titres fabriqués par un simple
remplacement de `w:pStyle`, sans réglage direct) de 21/34 à 5/34 rattrapés : une fois la cascade
de styles résolue, un tel faux titre prend la signature exacte d'un vrai titre du même niveau.
Corrigé : la passe 4 exige que la signature soit distincte du corps à la fois en EFFECTIF et en
DIRECT pour conserver un titre déclaré sans regarder sa longueur ; sinon la longueur tranche.
Mesuré après ce garde-fou : 25/34 sur `2-fabrique`, 0 vrai titre détruit.

**21.09.2026 — le bloc final d'autrices/auteurs (§5.5 bis).** Sur `2-clairseme_Article_CSPS_
C.Pedrosa.docx` et `2-fin-de-document_Article_RSPS.docx`, les coordonnées de fin de document
ressortaient en `APA.OrdreBiblio`/`APA.CitationAbsente`/confiance basse avant reconnaissance.
Après : 0 alerte de bibliographie sur des coordonnées sur ces deux fichiers, fiches d'auteurs
remplies.

**21.09.2026 — paragraphe de cellule et « paragraphe 0 » (§5.2).** La trace du nettoyage portait
le `.source` LOCAL à la cellule (0, 1, 2…) pour un paragraphe de cellule — plusieurs cellules
d'un même tableau produisaient donc chacune un « paragraphe 0 » distinct, indiscernable dans le
rapport HTML et jamais ancrable. Mesuré sur `3_VF_Chanier-Delorme_Article CSPS_290626.docx` :
5 lignes « paragraphe 0 » avant correction, remplacées par le `.source` du tableau porteur
(`dans_tableau: True`) après.

**21.09.2026 — `correspondance.source` était une position de liste, pas `Paragraphe.source`
(§7 ter, §8).** `manuscrit_gabarit._convertir_niveau_racine()` rendait la POSITION du bloc dans la
liste `blocs` qu'elle reçoit, pas son `.source` réel — les deux ne coïncident que si cette liste
est complète, non filtrée. En cas B, l'en-tête retire des paragraphes de `document.blocs` AVANT
`ecrire()` : la position glissait par rapport à `Paragraphe.source`, une alerte ancrée par `para`
se serait posée sur le mauvais paragraphe. Corrigé à la source (l'écrivain rend le vrai
`Paragraphe.source`) ; la CLI n'a plus besoin de remapper.

**21.09.2026 — trois défauts d'annotation, mesurés en branchant `manuscrit_annoter.py` dans la
CLI, chaîne complète sur 12 manuscrits réels.** Deux révisions dont les spans se chevauchent dans
le même paragraphe (Vale et `manuscrit_biblio.py` lèvent chacun leur propre alerte sur le même
DOI) levaient un `KeyError: 'texto'` — un atome déjà fusionné par une première révision, sans
texte propre, repris par une seconde. `_localizar()` mésancrait un `found` court sans `span`
valide (« et » matchant à l'intérieur de « **Cet**te », corrompant du texte réel sans le moindre
signe). Une révision touchant la frontière d'un `<w:hyperlink>` pouvait laisser un
`word/document.xml` mal formé sans lever d'exception. Les trois sont corrigées (§7 ter, ancrage).
Mesuré après correctif, chaîne complète WSL sur 12 manuscrits (`--sans-reseau`) : 0 exception
d'annotation, 0 partie XML malformée sur 231 parties, 129 révisions, 113 commentaires posés, 56
renvoyées au plafond, 34 non ancrées.

**21.09.2026 — lexique maison, `CSPS.Lexique.Coherence` : substitution automatique bornée à un
ratio mesuré.** Une paire privilégiée/variante n'est une substitution automatique
(`pipeline/vale/lexique/lexique-fr.csv`, statut `privilegie`) que si la forme privilégiée est
mesurée au moins 3 fois plus fréquente que la variante sur le corpus publié (92 articles fr,
`tmp/lexique/vale-corpus`) — sinon `a_trancher`, la rédaction décide. Mesuré : 10 des 17 paires
`privilegie` à variantes ne tenaient pas ce ratio (ex. « co-enseignement »/« coenseignement »,
1,4×) ; passées en `a_trancher`, avec le ratio mesuré dans le champ `note`. Conséquence sur le
corpus réel : `CSPS.Lexique.Coherence` passe de 59 à 5 alertes sur les 11 manuscrits de lot-A.

**Risque latent, allemand, non levé** : `RE_NIVEAU_TITRE` de `pronto_modele.py` ne reconnaît un
style de titre allemand que par le repli sur le styleId brut (`berschrift1`, sans accent), jamais
par le nom affiché complet « Überschrift 1 » (qui commence par « Ü »). Sur un document allemand
moderne (styleId canonique `Heading1`, nom affiché localisé), la détection échouerait en
silence. Sans conséquence sur le corpus actuel, qui est français.

**Un no-op du dépôt, signalé en passant** : les trois substitutions « espaces spéciales →
espace » de `pronto_modele.normaliser()` remplacent, octet pour octet, une espace ordinaire par
une espace ordinaire — la vraie normalisation vient du `' '.join(t.split())` final. Antérieur à
ce chantier, sans conséquence ici.

---

## 11. Les contrôles de validité

Posés d'avance. Ils font foi : un module est fini quand ils passent, pas quand il a l'air fini.
Harnais `node --test`, gardes par `test/js/gardes.js` (`PYTHON`, `sansPython`, `sansPandocWsl`),
fixtures `.docx` **fabriquées dans le test** et non figées en binaire — patron
`test/js/docx-titres.test.js`, fonction `fabriquerDocx`.

| Fichier | Ce qu'il prouve |
|---|---|
| `manuscrit-decisions.test.js` | Classement des titres (quatre passes + passe 3 bis, §5.1) et nettoyage de la mise en forme (§5.2) — italique/exposant/liens survivent, gras intégral conservé et signalé, descente à toute profondeur (cellules, notes), trace d'un paragraphe de cellule portant le `.source` du tableau porteur. |
| `manuscrit-typo.test.js` | Sur un paragraphe dont les runs sont coupés au milieu d'un mot, le texte normalisé est réinjecté sans perdre un caractère, et un mot en italique reste en italique. Un paragraphe irreconstructible est abandonné et signalé. |
| `manuscrit-gabarit.test.js` | La sortie relue par `pronto-lire.py` rend les champs attendus. Chaque image est dans un bloc figure, chaque tableau coiffé de sa rangée fusionnée, exactement un paragraphe vide sépare toujours deux blocs. Chaque partie XML de la sortie est bien formée. `correspondance.source` porte le vrai `Paragraphe.source` (pas une position de liste), y compris quand `blocs` est un sous-ensemble filtré — vérifié sur les onze manuscrits réels. |
| `manuscrit-nettoyer.test.js` | Chaîne complète : refus explicites, code de sortie non nul dès une alerte `error`, langue du produit, repli typographique signalé, les quatre origines d'alertes branchées, `dans_docx` renseigné. |
| `manuscrit-regles.test.js` | Le catalogue structurel seul : chaque règle porte sa référence de chapitre, un saut de niveau de titre est détecté, une bibliographie mal ordonnée l'est aussi, code de sortie non nul dès la première alerte `error`. |
| `manuscrit-vale.test.js` | Le catalogue lexical et éditorial, porté par Vale : « personne en situation de handicap » ne lève aucune alerte, l'inversion épicène FR/DE, une URL ne déclenche jamais Epicene, `analyser()` rend `indisponible=True` proprement. |
| `manuscrit-biblio.test.js` | `analyser_reference()`, croisement citations/références, ordre alphabétique/chronologique, DOI, Crossref (réseau toujours injecté dans les tests). |
| `manuscrit-annoter.test.js` | Ancrage par atomes, révisions/commentaires, plafond, spans qui se chevauchent, frontière d'un `<w:hyperlink>`, validation XML systématique et restauration pré-annotation sur essai réel du corpus. |
| `manuscrit-docx.test.js` | Le lecteur : tirets réels préservés, `w:tab`/`w:br`, `w:sym`, `w:fldSimple`, `w:sdt` de niveau bloc, notes de bas de page et de fin, listes héritées du style, `Image.source`, `Fragment.effectif`. |
| `manuscrit-parite-lecteur.test.js` | `projeter_pronto()` et `pronto_docx.lire()` s'accordent sur les deux gabarits livrés. Ce fichier disparaît avec la dette du §3. |
| `manuscrit-entete.test.js` | Titre + sous-titre, auteurs (byline groupée, lignes séparées, « Nom, Prénom », téléphone écarté), résumé plafonné, mots-clés, DOI, en-tête vide. Le bloc final d'autrices/auteurs (§5.5 bis) : intertitre connu, repli heuristique, fusion sans duplication, frontière avec la zone d'en-tête. Un test de bout en bout compare la sortie relue par `pronto-lire.py` aux valeurs attendues. |
| `manuscrit-rapport.test.js` | La vue du rapport HTML (`construireVueRapportManuscrit`) : groupement par famille/règle, plafond d'occurrences, verdict d'image délégué à `qualite-image.js`, mention « (dans un tableau) » sur un paragraphe de cellule signalé. |

**Le contrôle qui compte plus que tous les autres** n'est pas dans cette table, parce qu'il
demande le corpus : passer l'outil sur des manuscrits **déjà publiés**, qui ont traversé quatre
relectures. Toute alerte y est suspecte par construction. C'est la seule mesure honnête du taux
de faux positifs, et rien ne la remplace.

### Phase 2 — la validation par la rédaction

Une fois les modules en place, une dizaine de documents passent au nettoyeur et Robin valide
chaque sortie, une par une. C'est ce passage-là qui fixe l'outil, pas la table ci-dessus — les
contrôles automatiques prouvent qu'il fait ce qu'on lui a dit, la validation prouve qu'on lui a
dit la bonne chose.

Deux conséquences sur la conception, tenues depuis le début : chaque décision est traçable et
lisible dans le rapport (« ce paragraphe a été rétrogradé au corps parce qu'il fait 41 mots et
finit par un point »), jamais seulement le résultat ; tout seuil est une constante nommée en tête
de module, jamais un nombre au milieu du code.

C'est aussi cette phase qui donnera un **cas A réel**, si l'un des dix documents arrive au
gabarit.

---

## 12. Ce qui n'est pas fait ici

- **Écrire dans le `.docx` de l'autrice.** L'outil rend un fichier neuf ; il ne touche jamais
  l'original.
- **Le nettoyeur des livres.** D'où le `(Article)` dans le nom.
- **L'allemand calibré.** Les règles allemandes sont écrites, mais leur taux de faux positifs
  n'a pas encore été mesuré sur un corpus allemand publié.
- **Le lecteur `.odt`.** `pipeline/manuscrit_odt.py` reste à écrire.

Pour l'état exact du dépôt, ce qui reste à faire et dans quel ordre : voir
`outils-dev/ETAT-REPRISE-2026-09-18.md`.
