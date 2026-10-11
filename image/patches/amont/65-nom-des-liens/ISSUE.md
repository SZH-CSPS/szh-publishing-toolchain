<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. Le sujet touche à aria-label : d'abord un
commentaire sur #2550 (« Support aria-* attributes », listé dans #2482), ou une issue liée
si liZe préfère séparer. Le diff n'est à envoyer que si liZe le demande. À reformuler par
Robin avant de poster.
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

A related case for links. With `pdf/ua-1`, the `/Contents` of a link annotation is always its target: the URL, or the anchor name for internal links. For an icon link without text, that is the only name a screen reader can get, and `aria-label` and `title` are ignored:

```html
<html lang="en"><title>Test</title>
<style>a { display: inline-block; width: 4mm; height: 4mm; background: green }</style>
<p id="call"><a href="https://orcid.org/0000-0002-1825-0097" aria-label="ORCID profile of Jane Doe"></a>
<a href="#call" aria-label="Back to the call"></a></p>
```

Here `/Contents` is `https://orcid.org/0000-0002-1825-0097` and `call`, and the `/Link` structure elements have no content to read. PDF/UA-1 7.18.5 asks for an alternate description in `/Contents`, and WCAG 2.4.4 for a name that tells the purpose of the link.

Would it be OK to use, in this order, `aria-label`, the link text, `title`, and the target as a fallback, for `/Contents`? And to also set this name as `/Alt` of the `/Link` structure element when it comes from `aria-label` or when the link has no text, as assistive technologies read the structure element and not the annotation? I have a small patch for `pdf/anchors.py` and `pdf/tags.py` if you're interested.
