# Correctif 90 : un seul contenu marqué pour les lignes d'un bloc

Patch : `image/patches/weasyprint-70.0/90-un-mcid-par-element.patch`.

## Le défaut

Dans le PDF balisé de WeasyPrint 70.0, chaque ligne de texte est un contenu marqué à part :
un MCID et un élément `/Span` par ligne, sous le `/P` du paragraphe. Un paragraphe de quatre
lignes donne quatre `/Span`.

Le lecteur PDF d'Edge (moteur d'Acrobat dans Chromium) expose chaque contenu marqué comme un
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

- `draw_block_level()` déclare le bloc dont il dessine les lignes : `with
  stream.text_block(block)`.
- `Stream.marked()` : quand la boîte de texte est le texte propre de ce bloc (même élément,
  même pseudo-élément, donc même langue) et que rien n'a été dessiné depuis l'`EMC` du texte
  précédent de ce bloc, il retire cet `EMC` et n'ouvre pas de nouveau contenu marqué. La
  boîte n'entre pas dans `_tags`. Le test « rien depuis » compare la longueur du flux à celle
  qu'il avait après l'`EMC`.
- `_build_box_tree()` saute une boîte de texte absente de `_tags` : son texte est déjà sous
  le `/Span` de la ligne précédente.

Ce qui reste séparé :

- le texte d'un élément en ligne (`em`, lien, `span lang`, appel de note) : sa boîte de
  texte n'appartient pas à l'élément du bloc, elle garde son contenu marqué, et le texte du
  bloc qui la suit en ouvre un nouveau. La langue (correctif 60), les `/Link` et leurs
  `OBJR` (65), les `/Note` (80) ne bougent pas ;
- deux pages : chaque page a son flux, un MCID ne la traverse pas ;
- deux fragments d'un même bloc (colonnes) et deux blocs anonymes d'un même élément (texte
  avant et après un bloc vide) : la clé est la boîte du bloc, pas l'élément ;
- un dessin entre deux lignes (image en ligne, filet, fond) : le flux a grandi, rien n'est
  fusionné.

Un `<br>` ne coupe pas le contenu marqué : la ligne qui suit est du texte du même bloc. Le
texte du contenu marqué n'a pas d'espace à cet endroit ; pdfium (Edge) en déduit une au
changement de ligne, comme pour tout paragraphe d'un seul tenant.

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
- Indépendant de ce correctif, mais visible dans la même démo : un contenu marqué qui
  commence par la ligature « fi » perd son « f » dans Edge (« finance » se lit
  « inance »).

## Recommandation

**Le proposer en amont** par une issue courte qui offre la PR : le défaut se voit dans un
lecteur d'écran courant, la correction est petite (une vingtaine de lignes), sans effet sur
le rendu ni sur veraPDF. **Le garder** d'ici là.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/90-un-mcid-par-element/demo/demo.sh
```

HTML : `lignes.html` : paragraphe justifié de quatre lignes ; paragraphe avec `em`, lien,
passage allemand et appel de note, coupé sur cinq lignes ; item de liste et cellules sur
deux lignes ; `<br>`.

Sortie du 11.10.2026, résumée : nu, 32 contenus marqués, un `/Span` par ligne ; patché,
22, un `/Span` par paragraphe, item ou cellule, et toujours un par morceau du lien et de
l'`em`. veraPDF ua1 PASS des deux côtés. Avec les quatorze autres correctifs avant et
après : mêmes chiffres, pixels identiques à 150 et 300 dpi.
Dans Edge (arbre MSAA, sans lecteur d'écran) : avant, le premier paragraphe est quatre
nœuds (« …can do, and », « not by what… ») ; après, un seul nœud « …can do, and not by
what… ». Même chose pour l'item, les cellules et les deux lignes du `<br>` (« Forced line
break after the word break. »).

Sur le corpus d'essai de Pronto (trois articles, deux livres, 50 pages), compilé avec les
quatorze correctifs puis avec les quinze : 0 page différente au pixel, veraPDF ua1 sans
échec, texte extrait par pdfium et pypdf identique.

Cas de `test/weasyprint-patch-check.py` : `y-mcid-lignes` (un mot par ligne sur deux pages :
un MCID et un `/Span` par page) et `y-mcid-frontieres` (texte du paragraphe coupé par un
`em`, un lien et un passage français). Cas du banc : `c28` à `c32`.

Texte de pull request, test pytest compris : `PR.md`.
