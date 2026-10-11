# Correctif 85 : sous-liste dans son `/LBody`, liste de définition en `/Lbl` et `/LBody`

Patch : `image/patches/weasyprint-70.0/85-listes-imbriquees.patch`.

## Le défaut

Dans le PDF balisé de WeasyPrint 70.0 :

- une sous-liste (`<li>Mesures ordinaires<ul>…</ul></li>`) devient un `/L` enfant direct du
  `/L` parent, frère des `/LI` : rien ne la rattache à l'item qui l'introduit ;
- un item qui contient un bloc (`<li><p>…</p></li>`, liste « lâche » de pandoc) reçoit ce
  `/P` directement sous le `/LI`. veraPDF le refuse : PDF/UA-1 7.2-20, « LI element may
  contain only Lbl and LBody elements » ;
- une `<dl>` devient un `/L` dont chaque `<dt>` et chaque `<dd>` est un `/LI` à part, avec
  un `/LBody` et sans `/Lbl` : le terme et sa définition sont deux items sans lien.

ISO 32000-1, tableau 336 : les enfants d'un `/L` sont des `/LI` (et une `/Caption`), ceux
d'un `/LI` un `/Lbl` et un `/LBody`. Les techniques PDF/UA de la PDF Association (bêta)
placent la sous-liste dans le `/LBody` de son item (L_05, et L_F07 pour l'échec) et balisent
une liste de description en `/L > /LI > /Lbl + /LBody`, sans `/ListNumbering` ou à `/None`
(L_14).

## La cause dans le code amont

`weasyprint/pdf/tags.py` de la 70.0, `_build_box_tree()` :

- lignes 295-300 : un `ul`/`ol` enfant d'un `/LI` est rattaché au parent du `/LI`, avec le
  commentaire « In PDFs, nested lists are linked to the parent list » ;
- lignes 156-186 : la boîte anonyme d'un `li` devient `/LBody`, mais un bloc nommé (`p`) garde
  sa balise, directement sous le `/LI` ;
- lignes 107-109 : `dt` et `dd` sont des `LI` (« TODO: dt should be different »), chacun
  enveloppé dans son propre `/LI`.

## Ce que dit l'amont

- [#2874](https://github.com/Kozea/WeasyPrint/issues/2874) (fermée) : la sous-liste était
  balisée avant son item. liZe y répond que la spécification veut les `/L` imbriqués enfants
  directs du `/L` parent ; la PR [#2879](https://github.com/Kozea/WeasyPrint/pull/2879) remet
  seulement l'item avant la sous-liste (le `child_index` déjà présent dans la 70.0).
- [#1837](https://github.com/Kozea/WeasyPrint/issues/1837),
  [#2497](https://github.com/Kozea/WeasyPrint/issues/2497) et
  [#2503](https://github.com/Kozea/WeasyPrint/issues/2503) (fermées) : `/LBody` manquant
  et `/LI` hors `/L` avec `list-style: none` ; rien sur `<li><p>` ni sur `<dl>`.
- Aucune issue sur `<dl>` (recherche du 11.10.2026). `main` : inchangé.

La position de l'amont sur les sous-listes contredit les techniques de la PDF Association.
Le `/L` directement dans un `/L` existe dans ces techniques, mais pour une liste
hiérarchique (arborescence, L_12), pas pour la sous-liste d'un item.

## Notre correctif

Dans `_build_box_tree()` :

- tout enfant d'un `/LI` autre que son marqueur va dans le `/LBody` de l'item. La boîte
  anonyme du texte reste le `/LBody` ; une sous-liste ou un bloc qui vient avant tout texte
  en fait créer un. Le texte qui suit la sous-liste dans l'item reste dans le même `/LBody`
  (en `/NonStruct`, comme le fait déjà la 70.0 pour une boîte anonyme sous un `/LBody`) ;
- dans un `/L`, les `dt` et `dd` qui se suivent partagent un `/LI` : chaque `dt` y est un
  `/Lbl`, chaque `dd` un `/LBody`. Un `dt` qui suit un `dd` ouvre un nouveau `/LI`, un `dd`
  sans terme forme un `/LI` sans `/Lbl`. Plusieurs définitions d'un terme donnent plusieurs
  `/LBody` dans le même `/LI`, plusieurs termes plusieurs `/Lbl` : le tableau 336 dit d'un
  `/LI` « one or more labels (Lbl) or list bodies (LBody) or both », et le groupe reste
  celui du HTML (un ou plusieurs `dt`, puis un ou plusieurs `dd`) ;
- aucun `/ListNumbering` : WeasyPrint n'en écrit sur aucune liste, et la valeur par défaut,
  `/None`, est la bonne pour une `<dl>` (L_14). Pour un `<ol>`, elle reste fausse : c'est
  hors de ce correctif.

Hors de portée : une liste coupée par la page reste deux `/L`. WeasyPrint bâtit un arbre par
page ; les réunir demande de fusionner aussi les blocs qui les contiennent, et de réécrire
les MCID directs et l'arbre parent : c'est la limite générale du bloc coupé, pas celle des
listes.

## Recommandation

Pour `<li><p>` (échec veraPDF) et `<dl>` : **le proposer en amont** par une issue courte
qui offre la PR. Pour la sous-liste dans `/LBody` : **commenter #2874** avec les techniques
L_05 et L_F07, sans insister si l'amont maintient sa lecture. **Le garder** d'ici là.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/85-listes-imbriquees/demo/demo.sh
```

HTML : `listes.html` : sous-liste entre deux textes d'un item, item à paragraphe suivi d'une
sous-liste, item réduit à une sous-liste, `<dl>` à un terme et une définition, à deux
définitions, à deux termes.

Sortie du 11.10.2026, résumée : nu, veraPDF ua1 FAIL (7.2-20, le `/P` sous le `/LI`), les
sous-listes enfants du `/L` parent, la `<dl>` en huit `/LI` sans `/Lbl`. Patché, PASS ;
chaque sous-liste dans le `/LBody` de son item, la `<dl>` en trois `/LI` :
`Lbl LBody`, `Lbl LBody LBody`, `Lbl Lbl LBody`.

Sur le corpus d'essai de Pronto (trois articles, deux livres, 50 pages), compilé avec les
douze correctifs puis avec les quatorze : 0 page différente au pixel, veraPDF ua1 sans
échec ; les six sous-listes des deux articles (trois chacun) sont dans leur `/LBody`, et
les deux `<dl>` font chacune deux `/LI` à `/Lbl` et `/LBody` au lieu de quatre `/LI`.
