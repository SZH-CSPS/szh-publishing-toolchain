<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. D'où une issue qui offre la PR ; le diff,
sous la seconde ligne de séparation, n'est à envoyer en PR que si liZe le demande, avec un
test dans tests/test_pdf.py à côté de ceux de dc:description. À reformuler par Robin avant
de poster.
Titre proposé : Add dc:language to XMP metadata
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

`<html lang>` is written in the catalog `/Lang`, but not in the XMP metadata, so `dc:language` is missing (ISO 16684-1, Dublin Core). Tools that only read XMP, pypdf for example, don't get the document language.

```html
<html lang="de"><title>Test</title><p>Ein Absatz.</p>
```

`weasyprint --pdf-variant=pdf/ua-1 test.html test.pdf`: no `dc:language` in the XMP stream. Expected: `<dc:language><rdf:Bag><rdf:li>de</rdf:li></rdf:Bag></dc:language>`.

`--xmp-metadata` can add it, but as a second `rdf:RDF` element after WeasyPrint's one, and tools like pypdf only read the first one.

It would be a few lines in `generate_rdf_metadata()`, like what was done for `dc:description` in #2681. Should I open a PR?

<!-- Diff proposé, à n'envoyer que sur demande. -->

```diff
--- a/weasyprint/pdf/metadata.py
+++ b/weasyprint/pdf/metadata.py
@@ -168,6 +168,13 @@
             element = SubElement(element, f'{{{NS["rdf"]}}}li')
             element.attrib['xml:lang'] = 'x-default'
             element.text = self.description
+        if self.lang:
+            element = SubElement(rdf, f'{{{NS["rdf"]}}}Description')
+            element.attrib[f'{{{NS["rdf"]}}}about'] = ''
+            element = SubElement(element, f'{{{NS["dc"]}}}language')
+            element = SubElement(element, f'{{{NS["rdf"]}}}Bag')
+            element = SubElement(element, f'{{{NS["rdf"]}}}li')
+            element.text = self.lang
         if self.keywords:
             element = SubElement(rdf, f'{{{NS["rdf"]}}}Description')
             element.attrib[f'{{{NS["rdf"]}}}about'] = ''
```
