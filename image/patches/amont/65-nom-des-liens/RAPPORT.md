# Correctif 65 : nom des liens en `/Contents` et `/Alt`

Patch : `image/patches/weasyprint-70.0/65-nom-des-liens.patch`.

## Le défaut

Pronto écrit des liens sans texte, nommés par `aria-label` : l'icône ORCID, le retour de la
note à son appel, le badge de licence, le QR. WeasyPrint leur donne pour `/Contents` leur
cible : l'URL, ou l'identifiant de l'ancre pour un lien interne (« appel-ref-1 »). Le texte
d'un lien, son `aria-label` et son `title` ne sont jamais lus. Un lien vide n'a donc pour
nom que cette cible, et son élément de structure `/Link` ne contient que la référence à
l'annotation (`/OBJR`) : rien que le lecteur d'écran puisse annoncer.

- PDF/UA-1 7.18.1 et 7.18.5 : une annotation, et en particulier un lien, porte une
  description en `/Contents` (ISO 32000-1:2008, 12.5.2 et 14.9.3) ; Matterhorn 28-012 (« A
  link annotation does not include an alternate description in the Contents key » ; 28-004
  exclut les liens).
- PDF/UA-1 7.3 : une `/Figure` a un texte de remplacement (Matterhorn 13-004). Il ne doit
  pas venir du lien qui l'entoure : une image sans description reste signalée.
- WCAG 2.4.4 : le nom d'un lien dit où il mène.
- Un lecteur d'écran lit l'arbre de structure : le contenu de l'élément `/Link`, ou son
  `/Alt` s'il en a un, qui remplace ce contenu (ISO 32000-1, 14.9.3). Pour un `/Link` vide,
  `/Alt` est donc le seul nom lisible dans l'arbre ; `/Contents` reste exigé sur
  l'annotation. D'où les deux. Ce qu'en fait un lecteur d'écran réel n'est pas vérifié.

veraPDF passe avant comme après : il ne vérifie que la présence de `/Contents`, pas ce
qu'il dit.

## La cause dans le code amont

`weasyprint/pdf/anchors.py` de la 70.0, `add_links()`, lignes 37-38 :
`box.link_annotation['Contents'] = pydyf.String(link_target)`. Pour les champs de
formulaire, la même 70.0 a `_get_human_name()` (ligne 99) qui choisit entre le texte du
`label`, `title`, `placeholder` et `name` : rien d'équivalent pour les liens.
`weasyprint/pdf/tags.py`, lignes 238-248 : l'élément `/Link` reçoit l'`/OBJR`, jamais
d'`/Alt`. `add_links()` voit une page à la fois et ne connaît que la boîte du lien : pour
écarter le texte masqué ou le corps d'une note, il faut les boîtes de tout le document, que
seul `add_tags()` a.

## Ce que dit l'amont

- [#2550](https://github.com/Kozea/WeasyPrint/issues/2550) (ouverte, « PDF/UA aria and role
  attributes ») : liZe juge utile la prise en charge des attributs `aria-*` ; listée dans
  [#2482](https://github.com/Kozea/WeasyPrint/issues/2482) (« Support `aria-*`
  attributes »). Rien sur les liens en particulier.
- `main` : `anchors.py` écrit toujours `link_target`. Non corrigé (11.10.2026).

## Notre correctif

Tout est dans `tags.py`, au début d'`add_tags()`, quand les boîtes de toutes les pages
sont connues ; `anchors.py` n'est pas touché.

- `add_tags()` parcourt d'abord les boîtes des pages et retient, pour chaque élément HTML,
  s'il est affiché (une boîte), visible (`visibility: visible`), en bloc, ou s'il est une
  note (`float: footnote`, ou la note d'un `::footnote-call`). Le nom d'un lien est le
  premier non vide entre `aria-label`, son texte, l'`alt` de ses images (le `<title>` d'un
  SVG) et `title`, espaces normalisés. Le texte est celui du DOM, sans ce qui n'est pas
  affiché (`display: none`, `visibility: hidden`, `<script>`, commentaires) ni le corps d'une
  note appelée dans le lien ; deux blocs y sont séparés par une espace. `/Contents` de
  l'annotation prend ce nom, la cible à défaut. Une image ou un pseudo-élément du lien porte
  une annotation à lui (WeasyPrint en crée une par boîte) : elle reçoit le nom du `<a>` qui
  le contient.
- `_build_box_tree()` : l'élément `/Link` d'un `<a>` nommé par `aria-label`, ou sans texte,
  reçoit le même nom en `/Alt`. Un lien à texte sans `aria-label` garde son texte, sans
  `/Alt`, comme le veut le calcul du nom accessible de HTML (`aria-label` l'emporte sur le
  contenu). Le `/Alt` n'est posé que sur le `/Link` de l'élément `<a>` lui-même, jamais sur
  une `/Figure`, un pseudo-élément ou un élément qui a déjà un `/Alt`, et jamais avec la
  cible : un lien sans aucun nom n'a pas de `/Alt`, et une `<img alt="">` dans un lien reste
  une `/Figure` sans `/Alt`, que veraPDF signale (7.3-1). Recopier la cible en `/Alt` lui
  aurait donné l'URL pour description et fait taire ce contrôle.

Un contenu généré par CSS (`::after`) n'entre pas dans le nom. `aria-labelledby` n'est pas
lu.

## Recommandation

**Le garder**, et **commenter #2550** plutôt qu'ouvrir une issue : c'est un cas de la même
demande. Proposer le code si liZe le demande. Le retirer quand l'amont nommera les liens.

Texte prêt : `ISSUE.md` (commentaire pour #2550).

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/65-nom-des-liens/demo/demo.sh
```

HTML : `liens.html` (lien à texte sur plusieurs espaces, appel de note, lien à texte et
`aria-label`, lien à texte masqué en `display: none`, ORCID à `aria-label`, licence à
`title`, lien sans aucun nom, retour à l'appel à `aria-label`).

Sortie du 11.10.2026 (`/Link` : `/Contents` de l'annotation, `/Alt` de l'élément) :

```
== liens, WeasyPrint nu
  veraPDF ua1 : PASS (0 règle(s) en échec)
  /Link  Contents=['https://example.org/']  Alt='-'
  /Link  Contents=['note']  Alt='-'
  /Link  Contents=['https://example.org/report.pdf']  Alt='-'
  /Link  Contents=['https://example.org/guide']  Alt='-'
  /Link  Contents=['https://orcid.org/0000-0002-1825-0097']  Alt='-'
  /Link  Contents=['https://creativecommons.org/licenses/by/4.0/']  Alt='-'
  /Link  Contents=['https://example.org/nameless']  Alt='-'
  /Link  Contents=['call']  Alt='-'

== liens, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  /Link  Contents=['the example site']  Alt='-'
  /Link  Contents=['1']  Alt='-'
  /Link  Contents=['Annual report, PDF, 2 MB']  Alt='Annual report, PDF, 2 MB'
  /Link  Contents=['guide']  Alt='-'
  /Link  Contents=['ORCID profile of Jane Doe']  Alt='ORCID profile of Jane Doe'
  /Link  Contents=['CC BY 4.0']  Alt='CC BY 4.0'
  /Link  Contents=['https://example.org/nameless']  Alt='-'
  /Link  Contents=['Back to the call']  Alt='Back to the call'
```

Sur le corpus d'essai de Pronto, avec et sans ce correctif : veraPDF ua1 sans échec, pages
identiques au pixel ; les retours à l'appel, les icônes ORCID et le badge de licence du
livre ont leur `aria-label` en `/Contents` et en `/Alt`, les liens internes leur texte
(« (Dupré & Lefèvre, 2019) ») au lieu de l'identifiant de la cible.

Un élément dans un lien à texte (`<a>…<em>…</em></a>`) devient un `/NonStruct` sous le
`/Link`, que veraPDF refuse (7.18.5-1) avec ou sans ce correctif : c'est
[#185](https://github.com/Kozea/WeasyPrint/issues/185), listée dans #2482, et [#2942](https://github.com/Kozea/WeasyPrint/issues/2942) (ouverte
le 28.09.2026), qui décrit le même cas.

Texte de pull request, test pytest compris : `PR.md`.
