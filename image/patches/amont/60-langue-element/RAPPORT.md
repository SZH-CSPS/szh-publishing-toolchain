# Correctif 60 : `/Lang` sur l'élément d'un passage dans une autre langue

Patch : `image/patches/weasyprint-70.0/60-langue-element.patch`.

## Le défaut

Un article français contient un résumé allemand (`<section lang="de">`), une citation
anglaise (`<blockquote lang="en">`) et des mots isolés (`[mindset]{lang=en}` en pandoc,
`<span lang="en">` dans le HTML). WeasyPrint écrit la langue de `<html lang>` en `/Lang` du
catalogue, mais aucun élément de structure ne reçoit de `/Lang` : un lecteur d'écran lit
tout avec la voix du document. PDF/UA-1 7.2 (ISO 14289-1) renvoie à ISO 32000-1:2008,
14.9.2 : la langue d'un passage se déclare par `/Lang` sur l'élément de structure (ou sur le
contenu marqué). Matterhorn 11-007 (« Natural language is not appropriate », jugement
humain ; 11-006 porte sur la langue des métadonnées) ; WCAG 3.1.2 (langue d'un passage).

veraPDF ne le voit pas : il ne peut pas savoir dans quelle langue est un texte. Le PDF passe
PDF/UA-1 avant comme après.

Aucun recours sans patch : `lang` est lu par WeasyPrint (propriété interne `lang`, qui règle
la césure et les guillemets) mais n'atteint jamais `pdf/tags.py`, et aucune propriété CSS ne
pose `/Lang`.

## La cause dans le code amont

`weasyprint/pdf/tags.py` de la 70.0 :

- ligne 77 : `/Lang` n'est posé que sur le catalogue (repli vide si `<html>` n'a pas de
  `lang`) ;
- lignes 188-196, `_build_box_tree()` : l'élément de structure reçoit `Type`, `S`, `K`,
  `Pg`, `P`, jamais `Lang` ;
- `css/__init__.py`, ligne 373 : l'attribut `lang` devient `-weasy-lang`, calculé en
  `style['lang']` et hérité ; `style.parent_style` donne la langue héritée.

## Ce que dit l'amont

- [#2482](https://github.com/Kozea/WeasyPrint/issues/2482) (ouverte, liZe, « PDF/UA support
  improvement ») regroupe les demandes PDF/UA ; la langue d'élément n'y figure pas.
- Aucune issue ni PR ne parle de `/Lang` sur un élément (recherche du 11.10.2026). `main` :
  `tags.py` n'écrit `Lang` que sur le catalogue. Non corrigé.

## Notre correctif

Une douzaine de lignes dans `_build_box_tree()`, juste après la création de l'élément : si
`box.style['lang']` est posé et diffère de `box.style.parent_style['lang']`, l'élément
reçoit `/Lang` avec cette valeur, telle qu'écrite dans le HTML (balise BCP 47, la même
chaîne que le `/Lang` du catalogue). Les descendants de même langue n'en reçoivent pas : ils
en héritent dans l'arbre (ISO 32000-1, 14.9.2.1). Les boîtes anonymes et les pseudo-éléments
ont la langue de leur parent et n'en reçoivent pas non plus. Un `<span lang>` est un `/Span`
et reçoit `/Lang` comme un bloc.

La valeur n'est écrite que si elle a la forme d'une étiquette de langue BCP 47 : des
sous-étiquettes ASCII de 1 à 8 lettres ou chiffres, séparées par « - », la première faite de
lettres (« de », « fr-CH », « EN-gb », « zh-Hant-TW »). Sinon (« en_US », « nimporte
quoi », « fr- »), rien n'est écrit, un avertissement est journalisé (`Invalid language tag
"en_US" not set in PDF tags`) et l'élément garde la langue de son parent. Recopiée, une telle
valeur fait échouer veraPDF ua1 (7.2-29, « not a Language-Tag ») là où le PDF passait sans
le correctif : une faute de frappe dans un `[mot]{lang=…}` de pandoc rendait le PDF non
conforme. Le contrôle est syntaxique : une étiquette bien formée mais inconnue (« xx ») est
écrite.

`lang=""` ne produit rien non plus. HTML lui donne le sens « langue inconnue » ; ISO
32000-1 aussi pour une `/Lang` vide, mais veraPDF ua1 la refuse (7.2-29, mesuré sur un
`/Span` dont le `/Lang` a été vidé). WeasyPrint ignore déjà `lang=""` pour la césure : le
passage garde la langue de son parent, dans le PDF comme dans la mise en page.

Ce que le correctif ne couvre pas :

- `xml:lang` : WeasyPrint ne lit que `lang`, comme un navigateur pour du HTML ;
- `lang` sur `<body>` (pas d'élément de structure) ou sur `<table>` (l'élément `/Table`
  est créé sur l'enveloppe anonyme, qui a la langue du parent) : le passage n'a pas de
  `/Lang`. Pronto ne pose `lang` ni sur l'un ni sur l'autre.

## Recommandation

**Le proposer en amont** par une issue courte qui offre la PR (liée à #2482). Règle
CourtBouillon « Ask before sending code » : la question d'abord. **Le garder** d'ici là, le
**retirer** dès la version qui pose `/Lang` sur les éléments.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/60-langue-element/demo/demo.sh
```

HTML : `langue-element.html` (`lang="en"`, un `span` français, une `section` allemande qui
contient un `span` anglais, une citation française, un `span lang="en"` redondant, un
`lang="en_US"` et un `lang=""`).

Sortie du 11.10.2026, résumée : veraPDF ua1 PASS avant comme après. Nu, aucun `/Lang` dans
l'arbre. Patché : `/Span Lang='fr'` (bricolage), `/Sect Lang='de'` (sans `/Lang` sur son
`/H2` ni son `/P`), `/Span Lang='en'` dans la section allemande (mindset),
`/BlockQuote Lang='fr'` ; le `span lang="en"` redondant n'en reçoit pas, ni les `span`
à `lang="en_US"` et `lang=""` (un avertissement pour « en_US »).

Texte de pull request, test pytest compris : `PR.md`. Cas de
`test/weasyprint-patch-check.py` : `o-langue` et `w-langue-invalide` (« en_US », texte
libre, `lang=""` sans `/Lang`, « EN-gb » écrit ; veraPDF sans échec).

Sur le corpus d'essai de Pronto (trois articles, un livre), compilé avec les dix correctifs
puis sans les correctifs 60 et 65 : veraPDF ua1 sans échec, 40 pages identiques au pixel.
Dans l'article français, la Zusammenfassung (`/Div Lang='de'`), les citations allemande et
anglaise et les mots `{lang=en}` et `{lang=de}` portent leur `/Lang`.
