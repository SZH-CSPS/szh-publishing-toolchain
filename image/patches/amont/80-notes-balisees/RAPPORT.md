# Correctif 80 : la note de bas de page en `/Note`, après son appel

Patch : `image/patches/weasyprint-70.0/80-notes-balisees.patch`.

## Le défaut

Pronto imprime les notes en bas de page par `float: footnote` (`<span class="szh-note">` à
l'endroit de l'appel). Dans le PDF balisé de WeasyPrint 70.0 :

- le corps de la note est rangé dans l'arbre de structure là où sa boîte est dessinée :
  un `/NonStruct` (la zone `@footnote`) en fin de page, après le dernier bloc de la page.
  Un lecteur d'écran le lit au milieu du flux ; dans l'article d'essai, il tombe entre
  l'item « 3. » et l'item « 4. » d'une liste coupée par la page ;
- l'appel (`::footnote-call`) est un `/NonStruct`, relié à rien ;
- le numéro de la note (`::footnote-marker`) est un `/NonStruct`.

PDF/UA-1 7.9 (ISO 14289-1) : une note se balise en `/Note`, avec un `/ID` unique
(Matterhorn 19-001 à 19-004 : note en `/Note`, renvoi en `/Reference`, `/ID` présent et
unique). Le Tagged PDF Best Practice Guide: Syntax (PDF Association) place la
`/Note` juste après sa référence dans l'ordre logique. veraPDF ne le voit pas : il ne sait
pas qu'un `/NonStruct` est une note. L'écoute NVDA du 11 octobre 2026 a confirmé la note lue
entre deux items de liste.

Aucun recours sans patch : la boîte de la note n'existe qu'en bas de page, et aucune
propriété CSS ne règle le balisage.

## La cause dans le code amont

`weasyprint/pdf/tags.py` de la 70.0 :

- `_build_box_tree()` parcourt chaque page dans l'ordre de ses boîtes ; la zone de notes
  (`FootnoteAreaBox`, `formatting_structure/boxes.py`) est un enfant de la page après la
  racine : ses notes passent en fin de page ;
- `_get_pdf_tag()` ne connaît ni `::footnote-call` ni `::footnote-marker` (créés par
  `formatting_structure/build.py`, lignes 185-198 et 249-255) : `/NonStruct`.

L'appel garde un lien vers sa note (`box.footnote`, déjà lu par `layout/block.py`), et la
note mise en page garde le même élément HTML que son appel : on peut les apparier.

## Ce que dit l'amont

- [#2482](https://github.com/Kozea/WeasyPrint/issues/2482) (ouverte, « PDF/UA support
  improvement ») regroupe les demandes PDF/UA ; les notes n'y figurent pas.
- Aucune issue ni PR sur le balisage des notes (recherche du 11.10.2026 : « footnote
  tag », « PDF/UA footnote », « footnote accessibility »). `main` : rien. Non corrigé.

## Notre correctif

Trois endroits de `tags.py` :

- `_get_pdf_tag()` : `::footnote-call` donne `/Reference`, `::footnote-marker` donne `/Lbl` ;
- `_build_box_tree()` : l'appel garde son élément et son parent, la zone de notes garde
  son élément (`box.mark`, comme le fait déjà la cellule de tableau) ;
- `add_tags()`, après les pages : chaque enfant de la zone de notes devient `/Note` avec
  `/ID (note-<n° d'objet>)`, quitte la zone et s'insère dans l'élément qui contient l'appel,
  juste après le `/Reference`. Une zone vidée sort de `/Document`. Le contenu marqué ne
  bouge pas : l'ordre de l'arbre ne dépend pas de celui du flux de contenu. Une note reportée
  à la page suivante suit son appel comme les autres ; WeasyPrint ne coupe jamais une note,
  qui reste donc une seule `/Note`. Une note dont l'appel n'a pas d'élément (boîte de marge
  en artefact) reste dans la zone.

Selon l'élément qui porte la note et l'endroit de l'appel :

- une note portée par un `<span>`, un `<p>` ou un `<div>` (`/Span`, `/P`, `/Div`,
  `/NonStruct`) devient la `/Note`. Portée par un autre élément, elle garde son rôle : un
  `<a>` reste un `/Link`, un `<ul>` un `/L`, une `<img>` une `/Figure`, enveloppés dans une
  `/Note` neuve. Renommer un lien en `/Note` laissait son annotation hors d'un `/Link`
  (veraPDF 7.18.5-1), renommer une liste mettait des `/LI` sous une `/Note` (7.2-17). Le
  numéro (`/Lbl`), premier enfant de l'élément ou d'un bloc anonyme qui l'enveloppe, passe en
  tête de la `/Note` ; un bloc anonyme vidé est retiré ;
- l'appel et le numéro d'une note portée par un lien (`a::footnote-call`,
  `a::footnote-marker`) restent des `/Link`, comme sans le correctif : ils portent
  l'annotation du lien ;
- une note appelée dans un lien est rangée après le `/Link`, et non dedans : sinon son
  texte entre dans le nom du lien, ou disparaît derrière l'`/Alt` d'un lien nommé par
  `aria-label` ;
- une note appelée dans un titre (`/H1` à `/H6`) est rangée après le titre : la navigation
  par titres ne la lit pas ;
- une note appelée dans un en-tête de tableau (`/TH`) est rangée après le `/Table` : chaque
  `/TD` qui cite l'en-tête dans ses `/Headers` le ferait relire avec la note entière ;
- dans les autres cas, dont une cellule `/TD`, une légende ou un item de liste, la `/Note`
  suit son appel dans l'élément qui le contient.

L'appel (`/Reference`) reste à sa place dans le lien, le titre ou l'en-tête : il est lu là
où il est imprimé, et sa note quand le lien, le titre ou le tableau a été lu. Si plusieurs de
ces éléments s'emboîtent, la note suit le plus extérieur.

En plus, la racine de structure reçoit `/IDTree` (arbre de noms des identifiants), exigé
par ISO 32000-1 (tableau 322) dès qu'un élément porte un `/ID` : ceux des `/Note` et ceux
que WeasyPrint pose déjà sur les `/TH`.

Choix de l'appel. Le Best Practice Guide propose `Reference > Lbl` ; le contrôleur d'Acrobat
signale `Lbl` dans `Reference` comme une imbrication fautive sous PDF/UA-1 (forum Prince,
sujet 4454, et listes WebAIM). On garde `/Reference` seul (ISO 32000-1, 14.8.4.4 :
« citation to content elsewhere in the document ») : l'appel est identifiable, sans `/Lbl`
discuté. Le `/Lbl` est dans la `/Note`, autour du numéro, comme le guide le recommande.

## Recommandation

**Le proposer en amont** par une issue courte qui offre la PR (liée à #2482). Règle
CourtBouillon « Ask before sending code » : la question d'abord. **Le garder** d'ici là, le
**retirer** dès la version qui balise les notes.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/80-notes-balisees/demo/demo.sh
```

HTML : `notes.html` (page de 100 × 80 mm) : une note au milieu d'une phrase, une dans un item
de liste, deux dans un même paragraphe, une note de quatre lignes dont l'appel est en p. 1
et le corps reporté en p. 2, puis des notes appelées dans un titre, dans un lien et dans un
en-tête de tableau.

Sortie du 11.10.2026, résumée : nu, les notes sont des `/NonStruct` en fin de page ;
patché, chaque `/Note` suit son `/Reference` dans le `/P` ou le `/LBody` de l'appel, la note
reportée (contenu en p. 2) dans le `/P` de la p. 1 ; la note du titre suit le `/H1`, celle
du lien suit le `/Link` dans le `/P`, celle de l'en-tête suit le `/Table`. veraPDF ua1 :
un échec avant comme après, 7.18.5-1 : l'appel de la note du lien a sa propre annotation de
lien, rangée dans le `/Reference` et non dans un `/Link`. C'est le cas général d'un élément
dans un lien (#185, voir le correctif 65), que ce correctif ne change pas.

Sur le corpus d'essai de Pronto (trois articles, deux livres, 50 pages), compilé avec les
douze correctifs puis avec les quatorze : 0 page différente au pixel, veraPDF ua1 sans
échec ; les quatre notes des articles et celle du livre sont des `/Note` après leur appel,
et la liste « 3. 4. 5. » de l'article français n'est plus coupée par les notes.

Cas de `test/weasyprint-patch-check.py` : `s-notes` (notes dans un paragraphe, un item,
une note reportée), `s-notes-elements` (note portée par une liste et par une image, notes
appelées dans un `/TH` et dans un `/H1`, veraPDF sans échec) et `s-notes-liens` (note portée
par un lien, notes appelées dans un lien avec et sans `aria-label`).

Texte de pull request, test pytest compris : `PR.md`.
