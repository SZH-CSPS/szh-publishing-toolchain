<!--
Commentaire à ajouter à l'issue ouverte #2550 (https://github.com/Kozea/WeasyPrint/issues/2550),
plutôt qu'une nouvelle issue : même demande, acceptée sur le principe par liZe (« Yes, that
would be useful. »). Canevas suivi : celui de ISSUE.md (aucun modèle dans le dépôt, règles
CourtBouillon : court, avec ses mots, un exemple, pas de code sans le demander). À reformuler
par Robin avant de poster. Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Same need here for decorative images. In 70.0, `<img alt="" role="presentation" src="…">` becomes a `/Figure` without `/Alt`, WeasyPrint logs "has no required alt description", and veraPDF fails on ISO 14289-1 7.3-1. PDF/UA wants this kind of image as an artifact (7.1, ISO 32000-1 14.8.2.2), and HTML-AAM already maps `alt=""` to the presentation role.

```html
<html lang="en"><title>Test</title>
<p>Text.</p>
<img alt="" role="presentation" src="square.png">
```

Locally we paint such images inside `Stream.artifact()` (already used for box shadows since #2883) and skip them in `_build_box_tree`; the PDF then passes. We only do it when both `alt=""` and `role="presentation"`/`"none"` are set, but `aria-hidden="true"` could follow the same path. Happy to share the code if it helps.
