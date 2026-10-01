# Correctif 15 : images décoratives

Patch : `image/patches/weasyprint-70.0/15-images-decoratives.patch`. Tiré du correctif 10,
qui le portait avec les en-têtes de tableau ([10-tableaux-entetes](../10-tableaux-entetes/RAPPORT.md)).

## Image décorative peinte en `/Figure` sans `/Alt`

### Le défaut

Une `<img alt="" role="presentation">` est une image décorative déclarée (HTML, WAI-ARIA
1.2). WeasyPrint 70 en fait une `/Figure` sans `/Alt`, journalise « has no required alt
description », et veraPDF échoue sur ISO 14289-1 7.3-1. PDF/UA-1 (7.1) veut au contraire ce
décor en artefact, hors de l'arbre (ISO 32000-1:2008, 14.8.2.2).

### La cause dans le code amont

`weasyprint/pdf/tags.py` de la 70.0, ligne 118 : toute `img` devient `Figure`, sans
regarder `alt` ni `role`. Lignes 214-218 : un `alt` vide est traité comme absent
(`elif alt := box.element.attrib.get('alt')`), d'où l'erreur. `pdf/stream.py`, ligne 283
(`Stream.marked`) : le contenu est toujours marqué avec un MCID. La méthode
`Stream.artifact()` (ligne 298) existe déjà, et sert aux ombres depuis
[#2882](https://github.com/Kozea/WeasyPrint/issues/2882) / PR #2883 (70.0).

### Ce que dit l'amont

- [#2550](https://github.com/Kozea/WeasyPrint/issues/2550) (ouverte, « PDF/UA aria and role
  attributes ») : des images en `aria-hidden="true"` restent des figures. Réponse de liZe :
  « Thanks for the report. Yes, that would be useful. » Rien depuis le 10.09.2025.
- #2482 liste « Support `aria-*` attributes – #2550 » et « Use better PDF tags for
  `<figure>` », non cochés. Le 26.06.2026, liZe confirme qu'un `aria-label` sur un `th`
  attend aussi #2550.
- `main` : identique. Non corrigé.

### Notre correctif

`is_decorative_image()` dans `pdf/stream.py` : `alt=""` et `role` `presentation` ou `none`,
les deux exigés. `Stream.marked` peint alors l'image dans `Stream.artifact()`, et
`_build_box_tree` ne crée pas d'élément. `alt=""` seul reste une `/Figure` signalée : chez
nous l'import l'écrit pour toute image sans description, ce n'est pas une décision. En amont,
la règle la plus juste serait celle de HTML-AAM (`alt=""` vaut `role="presentation"`), plus
`aria-hidden="true"` (#2550) ; c'est à eux d'en décider.

## Recommandation

- **Le garder**, et **ajouter un commentaire à #2550** plutôt
  qu'ouvrir une issue : même demande, déjà acceptée sur le principe. Le retirer quand l'amont
  sortira les images décoratives en artefact, après avoir vérifié que leur règle couvre
  `alt="" role="presentation"`.

Texte prêt : `ISSUE-2550.md` (commentaire pour #2550).

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/15-images-decoratives/demo/demo.sh
```

HTML : `image-decorative.html`. Sortie du 01.10.2026 :

```
== Préparation des deux venvs
  patch-weasyprint : posé 15-images-decoratives.patch
  patch-weasyprint : WeasyPrint 70.0, 1 correctif(s) posé(s) sur /tmp/tmp.4TQsOvm3LV/patche/lib/python3.13/site-packages.
  nu     : WeasyPrint 70.0, aucun correctif SZH
  patché : WeasyPrint 70.0 + 15-images-decoratives.patch

== image-decorative, WeasyPrint nu
  [weasyprint] ERROR: Image "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23c33'/%3E%3C/svg%3E" has no required alt description
  veraPDF ua1 : FAIL (1 règle(s) en échec)
    ISO 14289-1:2014 7.3-1 x1 : Figure tags shall include an alternative representation or replacement text that represents the contents marked with the Figure tag as noted in ISO 32000-1:2008, 14.7.2, Table 323
  arbre de structure :
    /Document
      /P
        /Span MCID=[0]
      /NonStruct
        /Figure A=<</O /Layout /BBox [83 128.791992 123 168.791992]>> MCID=[2]
        /Span MCID=[1]
  aucune marque /Artifact

== image-decorative, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  arbre de structure :
    /Document
      /P
        /Span MCID=[0]
      /NonStruct
        /Span MCID=[1]
  x1 /Artifact BMC 
```

Lecture : l'image décorative quitte l'arbre et devient un `/Artifact BMC` ; veraPDF passe.
