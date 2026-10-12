# Correctif 90 : un seul contenu marqué pour les lignes d'un bloc

Patch : `image/patches/weasyprint-70.0/90-un-mcid-par-element.patch`.

## Le défaut

Dans le PDF balisé de WeasyPrint 70.0, chaque ligne de texte est un contenu marqué à part :
un MCID et un élément `/Span` par ligne, sous le `/P` du paragraphe. Un paragraphe de quatre
lignes donne quatre `/Span`.

Le lecteur PDF d'Edge 155 (« Powered by Adobe Acrobat ») expose chaque contenu marqué comme un
nœud de texte, rogné de ses espaces. NVDA enchaîne ces nœuds sans séparateur : la dernière
lettre d'une ligne se colle à la première de la suivante (« and » + « not » se lit
« andnot »). L'espace de fin de ligne que pose le correctif 25 n'y change rien, puisqu'Edge
la retire.

Aucune norme n'impose un contenu marqué par élément. ISO 32000-1, 14.7.4 laisse un élément
citer autant de contenus marqués qu'il veut ; PDF/UA-1 n'en dit rien. La gêne est celle d'un
lecteur réel : un paragraphe d'un seul tenant, comme l'écrivent Word et LibreOffice, se lit
juste.

## La cause dans le code amont

- `weasyprint/draw/__init__.py`, `draw_inline_level()` : chaque `TextBox` d'une ligne est
  dessinée dans `stream.marked(child, 'Span')`.
- `weasyprint/pdf/stream.py`, `Stream.marked()` : chaque appel ouvre un `BDC /Span` à MCID
  neuf et le ferme par `EMC`.
- `weasyprint/pdf/tags.py`, `_build_box_tree()` : chaque `TextBox` reçoit son élément
  `/Span`, enfant de l'élément de son bloc.

## Ce que dit l'amont

- Jusqu'à la 65, un bloc avait un seul MCID : l'arbre montré dans
  [#2153](https://github.com/Kozea/WeasyPrint/issues/2153) (pdfplumber) donne un `/P` à
  `mcids [1]`. La PR [#2471](https://github.com/Kozea/WeasyPrint/pull/2471) (66.0, « Improve
  PDF/UA support ») a placé le balisage au niveau des boîtes de texte, pour ne plus dépendre
  des contextes d'empilement ([#2444](https://github.com/Kozea/WeasyPrint/issues/2444)).
- Aucune issue sur les mots collés d'une ligne à l'autre dans un lecteur d'écran (recherche
  du 11.10.2026 : « marked content », « MCID », « screen reader », « NVDA »).
- [#2902](https://github.com/Kozea/WeasyPrint/issues/2902) (fermée) : un élément coupé par la
  page devient plusieurs éléments. Sans rapport direct : ce correctif garde un MCID par page.
- `main` : inchangé.

## Notre correctif

- `_text_follows(page)` (`draw/__init__.py`) relève, une fois par page, sur l'arbre de
  mise en page d'origine et dans l'ordre où `_build_box_tree()` le parcourt (les enfants
  d'une ligne mis à plat), chaque boîte de texte dont la voisine immédiate qui la précède
  est une boîte de texte du même élément et du même pseudo-élément, et si elle est sur la
  ligne d'avant.
- `draw_block_level()` passe ce relevé à `Stream.text_block()` pendant le dessin des
  lignes.
- `Stream.marked()` ne fusionne une boîte que si celle qu'elle continue est la dernière
  boîte marquée, que le flux n'a pas grandi depuis son `EMC`, et, d'une ligne à l'autre,
  que le dernier glyphe réellement dessiné de la précédente soit une espace ou un trait.
  `Stream.show_text()` garde ce dernier texte, lu par la ToUnicode de sa police. On ne se
  fie pas à `line_end_space` du 25 : le 20 ne dessine pas l'espace de droite à gauche, sur
  une ligne tronquée ni en police bitmap ou en couleur, et un paragraphe `dir="rtl"`
  sortait « alpha betagamma deltaepsilon ». Il retire l'`EMC`, n'ouvre rien, et pose
  `box.continued_mark`.
- `_build_box_tree()` saute les boîtes à `continued_mark` ; les autres restent exigées
  dans `_tags` (`tags.pop(child)`), comme dans la 70.0.

L'ordre de dessin ne suffit pas : WeasyPrint peint après le texte de la ligne les images en
ligne, un `<svg>`, les flottants, les éléments positionnés, un inline-block à `z-index`. Le
texte qui précède et celui qui suit un tel objet sont voisins dans le flux, mais l'arbre de
structure les sépare par l'objet : les fusionner faisait lire « Q01Q03… » puis l'image.
Le relevé dans l'ordre des boîtes l'empêche.

Ce qui reste séparé :

- le texte d'un élément en ligne (`em`, lien, `span lang`, appel de note) ; la langue
  (correctif 60), les `/Link` et leurs `OBJR` (65), les `/Note` (80) ne bougent pas ;
- tout objet en ligne, même peint plus tard, et un lien vide à `aria-label` ;
- une ligne qui ne finit ni par une espace ni par un trait dessinés : après un `<br>`, dans
  un `pre`, de droite à gauche (hébreu, arabe, latin dans `dir="rtl"`), dans une note où le
  25 ne pose pas l'espace. Le texte du contenu marqué n'y aurait
  aucun séparateur, et Acrobat le lit à la suite : « Forced line breakafter » ;
- deux pages : chaque page a son flux, un MCID ne la traverse pas ;
- deux fragments d'un même bloc (colonnes) et deux blocs anonymes d'un même élément : ils
  ne sont pas voisins dans l'ordre des boîtes, ou le flux a grandi entre eux.

Posé seul, sans le 20 et le 25, le correctif ne réunit presque rien : la mise en ligne
retire l'espace de fin de ligne, et rien n'en reste dans la boîte de texte.

Le rendu ne change pas : seuls des `EMC`/`BDC` disparaissent du flux, et l'`ET`/`BT` qui les
séparait est fusionné par `begin_text()`, qui le faisait déjà sans balisage. Chaque
`TextBox` pose sa matrice de texte (`Tm`) : la position ne dépend pas du `BT` précédent.

## Limites

- Un élément en ligne coupé par la ligne (un lien sur deux lignes, un `em` qui déborde)
  reste deux éléments, chacun avec son contenu marqué : Edge lit encore ses deux morceaux
  collés. Les réunir demande de fusionner les éléments de structure des deux fragments,
  et pour un lien d'y garder deux `OBJR`.
- La frontière entre le texte du bloc et un élément en ligne reste une frontière de
  contenu marqué : Edge rogne l'espace qui la précède (« le mot » + « Förderplan »). Une
  espace dessinée dans le contenu marqué de gauche ne suffit pas, Edge la retire.
- Après un `<br>` ou dans un `pre`, chaque ligne garde son contenu marqué : Edge les colle
  encore.
- Indépendant de ce correctif, mais visible dans la même démo : un contenu marqué qui
  commence par la ligature « fi » perd son « f » dans Edge (« finance » se lit
  « inance »).

## Recommandation

**Signaler le défaut en amont** par une issue courte. La PR ne vaut qu'avec l'espace de fin
de ligne dans la couche texte (correctif 25), que l'amont ne prendra sans doute pas : la
proposer seulement si l'issue reçoit un accueil favorable, en exposant cette dépendance.
**Le garder** d'ici là.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/90-un-mcid-par-element/demo/demo.sh
```

HTML : `lignes.html` : paragraphe justifié de quatre lignes ; paragraphe avec `em`, lien,
passage allemand et appel de note, coupé sur cinq lignes ; item de liste et cellules sur
deux lignes ; `<br>`.

La démo pose le 20 et le 25 sur les deux venvs. Sortie du 11.10.2026, résumée : nu, 32
contenus marqués, un `/Span` par ligne ; patché, 24, un `/Span` par paragraphe, item ou
cellule, et toujours un par morceau du lien et de l'`em`, par ligne du `<br>` et de la
note. veraPDF ua1 PASS des deux côtés. Avec les quatorze autres correctifs avant et après :
mêmes chiffres, pixels identiques à 150 et 300 dpi.
Dans Edge (arbre MSAA, sans lecteur d'écran) : avant, le premier paragraphe est quatre
nœuds (« …can do, and », « not by what… ») ; après, un seul nœud « …can do, and not by
what… ». Même chose pour l'item et les cellules ; les deux lignes du `<br>` restent deux
nœuds.

Sur le corpus d'essai de Pronto (trois articles, deux livres, 50 pages), compilé avec les
quatorze correctifs puis avec les quinze : 0 page différente au pixel, veraPDF ua1 sans
échec, texte extrait par pdfium et pypdf identique ; 1066 contenus marqués avant, 978
après. Dans l'arbre, mêmes mots dans le même ordre, sauf des mots coupés par la césure,
désormais d'un seul tenant (« Seitenumbruch » au lieu de « Seite numbruch ») ; aucun mot
collé dans le texte brut des contenus marqués, livres compris.

Cas de `test/weasyprint-patch-check.py` : `y-mcid-lignes` (un mot par ligne sur deux pages :
un MCID et un `/Span` par page), `y-mcid-frontieres` (texte du paragraphe coupé par un
`em`, un lien et un passage français), `y-mcid-ordre` (image, SVG, flottant, positionné,
relatif, inline-block à `z-index`, lien vide : le texte qui suit n'est pas fusionné avec
celui qui précède), `y-mcid-sauts` (`<br>`, `pre`) et `y-mcid-rtl` (hébreu, arabe, latin
dans `dir="rtl"`) ; une boîte de texte jamais dessinée lève toujours le `KeyError` de la
70.0. Cas du banc : `c28` à `c52`, avec les invariants `colle-brut` (jeton collé d'un côté
ou de l'autre) et `mots-brut` (le texte brut des contenus marqués a les mêmes mots que la
lecture par position, hors trait de fin de ligne recollé).

Texte de pull request, test pytest compris : `PR.md`.
