# Correctif 10 : en-têtes de tableau

Patch : `image/patches/weasyprint-70.0/10-tableaux-entetes.patch`. Il portait aussi l'image
décorative, qui a désormais son propre correctif : [15-images-decoratives](../15-images-decoratives/RAPPORT.md).

## `/Headers` faux sous un `colspan` ou un `rowspan` d'en-tête

### Le défaut

En PDF/UA-1, chaque cellule `TD` doit pouvoir retrouver ses en-têtes : soit par
l'attribut `/Headers` (liste des `/ID` des `TH`), soit par `/Scope` sur les `TH`
(ISO 14289-1:2014, 7.5 ; ISO 32000-1:2008, 14.8.5.7, tableau 349). WeasyPrint 70 choisit
`/Headers`, mais calcule mal les colonnes :

- un `<th colspan="2">` n'est inscrit que sur sa première colonne ; la seconde colonne reçoit
  `/Headers []` (cas mesuré sur la Revue : massie 2025-02, `tables/table-01.html`,
  « Punkte ») ;
- sous un `<th scope="row" rowspan="2">`, la ligne suivante perd son en-tête de ligne, et le
  compteur de colonnes se décale : la cellule « 11 », sous « Test B », reçoit l'en-tête de
  « Test A ». C'est pire qu'un en-tête manquant, c'est un en-tête faux, et veraPDF ne le
  voit pas (il ne signale que la cellule restée vide).

### La cause dans le code amont

`weasyprint/pdf/tags.py` de la 70.0, lignes 328-345 (« Find column and row headers ») :

```python
for i, row in enumerate(rows):
    j = 0
    for cell in row.children:
        if cell.element is not None and cell.element_tag == 'th':
            key = pydyf.String(f'{element.number}-{i}-{j}')
            ...
            if cell.element.attrib.get('scope') == 'row':
                row_headers[i].append(key)          # une seule ligne, même si rowspan
            else:
                column_headers[j].append(key)       # une seule colonne, même si colspan
        for _ in range(cell.colspan):
            colspans[j] = cell.rowspan - 1
            j += 1
        if colspans[j]:                             # un seul saut, une seule fois
            j += 1
            colspans[j] -= 1
```

Le compteur `j` est refait à la main, alors que `formatting_structure/build.py` a déjà
calculé la position de grille de chaque cellule (`cell.grid_x`). Le même compteur est
repris lignes 347-365 (« Map headers to cells »). L'attribut HTML `headers` n'est jamais lu.

### Ce que dit l'amont

- Ce code est récent : commit [2d85681b](https://github.com/Kozea/WeasyPrint/commit/2d85681b)
  du 2 août 2026, « Handle rowspan and colspan for table cells in PDF tags », dans la PR
  [#2881](https://github.com/Kozea/WeasyPrint/pull/2881) (formulaires, livrée en 70.0). Son
  test `test_pdf_tags_table_headers` (tests/test_pdf.py) couvre un `rowspan` et un `colspan`
  sur des `td`, jamais sur un `th` : c'est exactement le trou.
- [#2508](https://github.com/Kozea/WeasyPrint/issues/2508) (fermée le 11.08.2026, « PDF/UA:
  Tags for header cells in tables are missing ») : liZe explique le choix de `/Headers`
  plutôt que `/Scope` : « The scope tag is optional if cells are attached to headers, which
  is the case in WeasyPrint, if headers cover all the cells of the HTML table of course. »
  Puis, à la clôture : « Improved by #2881. This case is now handled, don't hesitate to open
  other issues if you find a problem for other cases. » C'est une invitation explicite.
- [#1784](https://github.com/Kozea/WeasyPrint/issues/1784) (fermée) : un utilisateur notait
  déjà que l'attribut HTML `headers` n'arrivait pas dans le PDF.
- Liste [#2482](https://github.com/Kozea/WeasyPrint/issues/2482) : « Fix structure of
  tables – #2508 » est coché ; rien sur les en-têtes fusionnés.
- `main` au 01.10.2026 (369b1534) : `pdf/tags.py` est identique à la 70.0. Non corrigé.

### Notre correctif

Il prend `cell.grid_x`, inscrit un `th` sur toutes les colonnes (`colspan`) ou toutes les
lignes (`rowspan`, pour `scope="row"` ou `rowgroup`) qu'il couvre, lit l'attribut HTML
`headers` quand il désigne des `th` du tableau, et retire les doublons. Une vingtaine de
lignes, dans une seule fonction.

## Recommandation

- **Le proposer en amont**, par une issue avec l'exemple, et proposer le
  code si liZe le demande (règle « Ask before sending code »). C'est un bogue, récent, dans du
  code que le mainteneur vient de toucher, et qu'il a invité à signaler. **Le garder** jusqu'à
  la version qui le corrige, puis **le retirer**.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/10-tableaux-entetes/demo/demo.sh
```

Deux HTML : `tableau-colspan.html` et `tableau-rowspan.html`. Sortie
du 01.10.2026 :

```
== Préparation des deux venvs
  patch-weasyprint : posé 10-tableaux-entetes.patch
  patch-weasyprint : WeasyPrint 70.0, 1 correctif(s) posé(s) sur /tmp/tmp.aZjU9XOoiS/patche/lib/python3.13/site-packages.
  nu     : WeasyPrint 70.0, aucun correctif SZH
  patché : WeasyPrint 70.0 + 10-tableaux-entetes.patch

== tableau-colspan, WeasyPrint nu
  veraPDF ua1 : FAIL (1 règle(s) en échec)
    ISO 14289-1:2014 7.5-1 x1 : If the table's structure is not determinable via Headers and IDs, then structure elements of type TH shall have a Scope attribute
  arbre de structure :
    /Document
      /Table
        /THead
          /TR
            /TH ID='21-0-0' A=<</O /Table>>
              /Span MCID=[0]
            /TH ID='21-0-1' A=<</O /Table /ColSpan 2>>
              /Span MCID=[1]
        /TBody
          /TR
            /TD A=<</O /Table /Headers ['21-0-0']>>
              /Span MCID=[2]
            /TD A=<</O /Table /Headers ['21-0-1']>>
              /Span MCID=[3]
            /TD A=<</O /Table /Headers []>>
              /Span MCID=[4]
          /TR
            /TD A=<</O /Table /Headers ['21-0-0']>>
              /Span MCID=[5]
            /TD A=<</O /Table /Headers ['21-0-1']>>
              /Span MCID=[6]
            /TD A=<</O /Table /Headers []>>
              /Span MCID=[7]

== tableau-colspan, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  arbre de structure :
    /Document
      /Table
        /THead
          /TR
            /TH ID='21-0-0' A=<</O /Table>>
              /Span MCID=[0]
            /TH ID='21-0-1' A=<</O /Table /ColSpan 2>>
              /Span MCID=[1]
        /TBody
          /TR
            /TD A=<</O /Table /Headers ['21-0-0']>>
              /Span MCID=[2]
            /TD A=<</O /Table /Headers ['21-0-1']>>
              /Span MCID=[3]
            /TD A=<</O /Table /Headers ['21-0-1']>>
              /Span MCID=[4]
          /TR
            /TD A=<</O /Table /Headers ['21-0-0']>>
              /Span MCID=[5]
            /TD A=<</O /Table /Headers ['21-0-1']>>
              /Span MCID=[6]
            /TD A=<</O /Table /Headers ['21-0-1']>>
              /Span MCID=[7]

== tableau-rowspan, WeasyPrint nu
  veraPDF ua1 : FAIL (1 règle(s) en échec)
    ISO 14289-1:2014 7.5-1 x1 : If the table's structure is not determinable via Headers and IDs, then structure elements of type TH shall have a Scope attribute
  arbre de structure :
    /Document
      /Table
        /TBody
          /TR
            /TD A=<</O /Table /Headers []>>
            /TH ID='21-0-1' A=<</O /Table>>
              /Span MCID=[0]
            /TH ID='21-0-2' A=<</O /Table>>
              /Span MCID=[1]
          /TR
            /TH ID='21-1-0' A=<</O /Table /RowSpan 2>>
              /Span MCID=[2]
            /TD A=<</O /Table /Headers ['21-1-0' '21-0-1']>>
              /Span MCID=[3]
            /TD A=<</O /Table /Headers ['21-1-0' '21-0-2']>>
              /Span MCID=[4]
          /TR
            /TD A=<</O /Table /Headers []>>
              /Span MCID=[5]
            /TD A=<</O /Table /Headers ['21-0-1']>>
              /Span MCID=[6]

== tableau-rowspan, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  arbre de structure :
    /Document
      /Table
        /TBody
          /TR
            /TD A=<</O /Table /Headers []>>
            /TH ID='21-0-1' A=<</O /Table>>
              /Span MCID=[0]
            /TH ID='21-0-2' A=<</O /Table>>
              /Span MCID=[1]
          /TR
            /TH ID='21-1-0' A=<</O /Table /RowSpan 2>>
              /Span MCID=[2]
            /TD A=<</O /Table /Headers ['21-1-0' '21-0-1']>>
              /Span MCID=[3]
            /TD A=<</O /Table /Headers ['21-1-0' '21-0-2']>>
              /Span MCID=[4]
          /TR
            /TD A=<</O /Table /Headers ['21-1-0' '21-0-1']>>
              /Span MCID=[5]
            /TD A=<</O /Table /Headers ['21-1-0' '21-0-2']>>
              /Span MCID=[6]
```

Lecture : dans `tableau-colspan`, la troisième colonne passe de `/Headers []` à
`['21-0-1']` ; dans `tableau-rowspan`, la cellule MCID 6 (« 11 », sous « Test B ») portait
l'en-tête de « Test A » (`21-0-1`) et sans en-tête de ligne ; patchée, elle porte `21-1-0`
et `21-0-2`.
