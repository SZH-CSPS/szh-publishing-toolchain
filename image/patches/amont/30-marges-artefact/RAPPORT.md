# Correctif 30 : boîtes de marge en artefact de pagination

Patch : `image/patches/weasyprint-70.0/30-marges-artefact.patch`.

## Le défaut

L'en-tête courant, le pied de page et le folio (`@top-*`, `@bottom-*`… de `@page`) sortent
en contenu marqué `/Span` avec un MCID, mais ce MCID n'est rattaché à aucun élément
atteignable depuis `StructTreeRoot` : un sous-arbre est construit puis jamais relié. Ce
n'est ni du contenu réel ni un artefact. Mesuré sur l'article 09 de la Revue : 44 MCID
orphelins sur 8 pages.

PDF/UA-1 veut la pagination en artefact : ISO 14289-1:2014, 7.1 (tout contenu est réel ou
artefact) et 7.8 (en-têtes et pieds de page) ; ISO 32000-1:2008, 14.8.2.2.2 (artefacts de
pagination, propriétés `/Type /Pagination`, `/Subtype /Header|/Footer`, `/Attached`).

**veraPDF ne voit pas le défaut** dans le cas courant : sans opacité, le PDF nu passe
PDF/UA-1 avec 6 MCID orphelins sur 2 pages (essai du 01.10.2026, même HTML sans la ligne
`opacity`). Il ne l'attrape que si une boîte de marge a une `opacity` < 1 : son groupe de
transparence sort hors balisage et 7.1-3 échoue. La démo utilise ce cas pour avoir un
verdict, et compte les orphelins pour le cas général.

## La cause dans le code amont

`weasyprint/pdf/tags.py` de la 70.0, lignes 144-150 :

```python
elif isinstance(box, boxes.MarginBox):
    # Build tree for margin boxes but don't link it to main tree. It ensures that
    # marked content is mapped in document and removed from list. It could be
    # included in tree as Artifact, but that's only allowed in PDF 2.0.
    for child in box.children:
        tuple(_build_box_tree(
            child, parent, pdf, page_number, nums, annotations, tags))
    return
```

Et `weasyprint/draw/__init__.py`, ligne 32 (`draw_stacking_context`) : les boîtes de marge
sont dessinées comme le reste, leur texte passe par `Stream.marked` (`pdf/stream.py`
ligne 283) et reçoit un MCID. Le commentaire confond deux choses : l'élément de structure
`Artifact` (PDF 2.0 seulement) et le contenu marqué `/Artifact` (PDF 1.x, ISO 32000-1
14.8.2.2), que PDF/UA-1 demande justement.

## Ce que dit l'amont

- [#1836](https://github.com/Kozea/WeasyPrint/issues/1836) « PDF/UA page header and
  footer », **ouverte** depuis mars 2023. Le commit
  [f8135e4a](https://github.com/Kozea/WeasyPrint/commit/f8135e4a) (juin 2025, « Don't
  include page margin content in content tree ») a voulu la clore : « This content could be
  included in tree as Artifact, but that's only allowed in PDF 2.0. […] PAC and VeraPDF are
  happy with this solution. Fix #1836. » Elle a été rouverte en pratique par des
  utilisateurs : « Acrobat reader reads aloud the contents of the footer first thing on
  every page. » (oraslaci, 13.08.2025).
- liZe, 21.11.2025, dans #1836 : « What we currently do is to mark the content of page
  margins, but we don't include the marked content in the main content tree […]. What we'd
  like to do is to include the marked content of margins in Artifact nodes at the root of
  the main content tree. But this is only possible in PDF 2.0 (PDF/UA-2), not before. What
  the PDF Association asks is to mark the content of page margins as Artifacts. It means
  that we can't tag the inner content. Currently, there's no way to do this easily in
  WeasyPrint. » Puis : « if screenreaders use the main content tree […], we could probably
  keep this feature for later. »
- Retours NVDA contradictoires (nathalie-tate, février 2026) : lu « on every page », puis non
  reproduit.
- Précédent dans la 70.0 : [#2882](https://github.com/Kozea/WeasyPrint/issues/2882) / PR
  #2883, « Mark box shadows as PDF artifacts » : l'amont accepte désormais de peindre en
  artefact ce qui n'est pas du contenu.
- `main` au 01.10.2026 : identique à la 70.0. Non corrigé.

## Notre correctif

- `draw/__init__.py` : `draw_stacking_context` passe par `Stream.pagination_artifact()`.
- `pdf/stream.py`, `pagination_artifact()` : pour une boîte de marge (`at_keyword`), coupe
  le balisage (`_tags` à `None`, ce qu'héritent les groupes de transparence) et peint dans
  `/Artifact <</Type /Pagination /Subtype /Header|/Footer /Attached [/Top|…]>> BDC`.
  `@left-*` et `@right-*` n'ont pas de `/Subtype` (ISO 32000-1 n'en connaît que Header,
  Footer et Watermark).
- Exception : une boîte de marge qui porte un lien ou un champ reste du contenu, car son
  annotation doit être balisée (ISO 14289-1 7.18) ; son contenu rejoint alors l'arbre au
  lieu du sous-arbre détaché.
- `pdf/tags.py` : plus de sous-arbre détaché ; une boîte de marge sans MCID est ignorée.

C'est exactement ce que liZe dit impossible « easily » : on ne balise pas l'intérieur des
marges, on les peint en artefact. La seule perte est le balisage d'un lien de marge, que
nous gardons en contenu.

## Recommandation

**Le proposer en amont**, sous forme d'un **commentaire sur #1836** (ouverte, même sujet),
avec l'exemple, la mesure des MCID orphelins et l'approche ; le code sur demande. Le
point à faire valoir : le contenu marqué `/Artifact` existe en PDF 1.7, ce n'est pas
l'élément de structure de PDF 2.0. **Le garder** d'ici là ; le **retirer** quand l'amont
sortira les marges en artefact (vérifier alors le cas d'un lien dans une marge).

Texte prêt : `ISSUE.md` (commentaire pour #1836).

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/30-marges-artefact/demo/demo.sh
```

HTML : `marges.html` (A6, deux pages, `@top-center`, `@bottom-right` avec le folio,
`@bottom-left` à `opacity: 0.6`). Sortie du 01.10.2026 :

```
== Préparation des deux venvs
  patch-weasyprint : posé 30-marges-artefact.patch
  patch-weasyprint : WeasyPrint 70.0, 1 correctif(s) posé(s) sur /tmp/tmp.UqqbIOjoWl/patche/lib/python3.13/site-packages.
  nu     : WeasyPrint 70.0, aucun correctif SZH
  patché : WeasyPrint 70.0 + 30-marges-artefact.patch

== marges, WeasyPrint nu
  veraPDF ua1 : FAIL (1 règle(s) en échec)
    ISO 14289-1:2014 7.1-3 x2 : Content shall be marked as Artifact or tagged as real content
  contenu marqué :
    7 contenus marqués avec MCID, 4 rattachés à aucun élément atteignable depuis StructTreeRoot
      orphelin : page 1 /Span MCID 2
      orphelin : page 1 /Span MCID 4
      orphelin : page 2 /Span MCID 1
      orphelin : page 2 /Span MCID 3
  artefacts :
    aucune marque /Artifact
  arbre de structure :
    /Document
      /H1
        /Span MCID=[0]
      /P
        /Span MCID=[1]
      /P
        /Span MCID=[0]

== marges, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  contenu marqué :
    3 contenus marqués avec MCID, 0 rattachés à aucun élément atteignable depuis StructTreeRoot
  artefacts :
    x2 /Artifact BDC <</Type /Pagination /Attached [/Top] /Subtype /Header>>
    x4 /Artifact BDC <</Type /Pagination /Attached [/Bottom] /Subtype /Footer>>
  arbre de structure :
    /Document
      /H1
        /Span MCID=[0]
      /P
        /Span MCID=[1]
      /P
        /Span MCID=[0]
```

Lecture : nu, 4 MCID orphelins dans les flux de page (ceux de la boîte à opacité sont dans
un XObject, d'où l'échec 7.1-3) ; patché, aucun orphelin, six marques `/Artifact` de
pagination, l'arbre inchangé et veraPDF passe.
