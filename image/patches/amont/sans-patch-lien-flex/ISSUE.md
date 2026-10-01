<!--
Commentaire facultatif sur l'issue ouverte #2941 « A link that is a flex item gets no link
annotation » (https://github.com/Kozea/WeasyPrint/issues/2941), qui existe déjà et que liZe a
reconnue : probablement inutile, voir RAPPORT.md. Canevas suivi : aucun modèle d'issue ni de
PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie aux « Guidelines for Contributors » de
CourtBouillon (avec ses mots, court, sans intertitres, un exemple court, demander avant
d'envoyer du code). Voir ../30-marges-artefact/ISSUE.md. À reformuler par Robin avant de
poster. Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

We hit this one in production with 70.0: a link that is a direct child of a flex container has no `/Link` annotation.

```html
<html lang="en"><title>Test</title>
<style>.flex { display: flex }</style>
<div class="flex"><a href="https://example.org/a">Link A</a></div>
<div class="flex"><span><a href="https://example.org/b">Link B</a></span></div>
```

Two `/Link` annotations expected, only the second one is there (counted with pypdf). Our workaround is the intermediate `<span>`, which costs nothing visually. I can share the code or open a PR if you want.
