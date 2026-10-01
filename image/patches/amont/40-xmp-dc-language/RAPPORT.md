# Correctif 40 : `dc:language` dans le XMP

Patch : `image/patches/weasyprint-70.0/40-xmp-dc-language.patch`.

**Constat de poste** : ce patch n'est pas posé dans la WSL actuelle. Le témoin
`/opt/weasyprint/lib/python3.13/site-packages/weasyprint/szh-patchs.txt` liste 10, 20 et
30 seulement (01.10.2026) : l'image n'a pas été reconstruite depuis le commit 2f3bc47 qui
l'a ajouté. Les PDF compilés aujourd'hui sur le poste n'ont donc pas de `dc:language`.

## Le défaut

WeasyPrint lit `<html lang>` et l'écrit en `/Lang` du catalogue (ISO 32000-1:2008, 14.9.2),
mais pas dans le paquet XMP : `dc:language` manque. PDF/UA-1 ne l'exige pas (veraPDF passe
avant comme après) ; ce sont les moissonneurs de métadonnées (dépôts, catalogues, pypdf,
exiftool) qui le lisent. Dublin Core dans XMP : ISO 16684-1, `dc:language` est un
`rdf:Bag` de codes de langue.

Le seul recours sans patch, `--xmp-metadata`, ajoute le fragment fourni comme **second**
`rdf:RDF` dans le même `x:xmpmeta`. veraPDF l'accepte, mais pypdf ne lit que le premier
(`dc_language == []`, voir la démo), et XMP décrit un seul `rdf:RDF` par paquet (ISO
16684-1, à notre lecture ; non revérifié dans le texte de la norme).

## La cause dans le code amont

`weasyprint/pdf/metadata.py` de la 70.0 :

- ligne 76 : `self.lang` est bien gardé dans `DocumentMetadata` ;
- lignes 101-191, `generate_rdf_metadata()` : `dc:title` (ligne 147), `dc:creator`,
  `dc:description` (ligne 163), `pdf:Keywords`… mais jamais `self.lang` ;
- ligne 94, `include_in_pdf()` : `b'\n'.join((header, xml_data, *self.xmp_metadata,
  footer))`, d'où le second `rdf:RDF` quand on passe `--xmp-metadata`.

## Ce que dit l'amont

- PR [#2338](https://github.com/Kozea/WeasyPrint/pull/2338) (fusionnée, the-infinity,
  « custom RDF metadata for PDF/A, especially for Factur-X eInvoices ») : le mécanisme est
  pensé pour une extension de schéma, pas pour compléter le Dublin Core : « EN 16931 /
  ZUGFeRD / Factur-X eInvoices require a custom RDF metadata extension to be valid […]. This
  cannot be added with the existing mechanisms. » Le générateur de cette PR renvoie un
  `rdf:RDF` complet, d'où la concaténation.
- PR [#2658](https://github.com/Kozea/WeasyPrint/pull/2658) (fusionnée, liZe, « Add CLI for
  Factur-X / ZUGFeRD ») : crée `--xmp-metadata` ; la documentation
  (`docs/common_use_cases.rst`) ne le présente que pour Factur-X.
- PR [#2681](https://github.com/Kozea/WeasyPrint/pull/2681) (fusionnée, « Add dc:description
  to pdf/a meta data ») : précédent direct, un champ Dublin Core manquant ajouté à
  `generate_rdf_metadata()` ; liZe a même remplacé l'ancien champ : « I've replaced the old
  field by the new one. »
- [#2602](https://github.com/Kozea/WeasyPrint/issues/2602) (fermée) : liZe vérifie la syntaxe
  XMP dans la spécification avant de répondre ; elle accepte les deux formes (attribut ou
  élément).
- Aucune issue ni PR ne mentionne `dc:language` ; aucune occurrence dans le code
  (recherche du 01.10.2026). `main` : `metadata.py` identique à la 70.0. Non corrigé.

## Notre correctif

Huit lignes dans `generate_rdf_metadata()` : si `self.lang` est posé, une
`rdf:Description` avec `dc:language > rdf:Bag > rdf:li`, dans le même `rdf:RDF` que
`dc:title`. Sans `lang`, rien ne change.

## Recommandation

**Le proposer en amont, directement en PR**, ou par une issue de trois lignes qui l'offre :
c'est le cas le plus simple des quatre, calqué sur #2681 que l'amont a accepté. Règle
CourtBouillon « Ask before sending code » : poser la question dans l'issue d'abord. **Le
garder** d'ici là (mais **reconstruire l'image**, sans quoi il ne sert pas), le **retirer**
dès la version qui l'intègre.

Texte prêt : `ISSUE.md` (issue, avec le diff proposé en dessous, à n'envoyer en PR que si
liZe le demande).

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/40-xmp-dc-language/demo/demo.sh
```

HTML : `langue.html` (`lang="de"`) ; fragment `dc-language.xmp` pour le recours amont.
Trois rendus : nu, nu avec `--xmp-metadata`, patché. Sortie du 01.10.2026 :

```
== Préparation des deux venvs
  patch-weasyprint : posé 40-xmp-dc-language.patch
  patch-weasyprint : WeasyPrint 70.0, 1 correctif(s) posé(s) sur /tmp/tmp.k1TMu4kkAk/patche/lib/python3.13/site-packages.
  nu     : WeasyPrint 70.0, aucun correctif SZH
  patché : WeasyPrint 70.0 + 40-xmp-dc-language.patch

== langue, WeasyPrint nu
  veraPDF ua1 : PASS (0 règle(s) en échec)
  1 rdf:RDF dans le paquet XMP
  pypdf xmp_metadata.dc_language = []
  dc:language : absent
  /Lang du catalogue : 'de'

== langue, WeasyPrint nu + --xmp-metadata dc-language.xmp
  veraPDF ua1 : PASS (0 règle(s) en échec)
  2 rdf:RDF dans le paquet XMP
  pypdf xmp_metadata.dc_language = []
  dc:language : <dc:language><rdf:Bag><rdf:li>de</rdf:li></rdf:Bag></dc:language>
  /Lang du catalogue : 'de'

== langue, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  1 rdf:RDF dans le paquet XMP
  pypdf xmp_metadata.dc_language = ['de']
  dc:language : <dc:language><rdf:Bag><rdf:li>de</rdf:li></rdf:Bag></dc:language>
  /Lang du catalogue : 'de'
```

Lecture : nu, pas de `dc:language` ; avec `--xmp-metadata`, il est dans le flux mais dans
un second `rdf:RDF`, que pypdf ignore ; patché, un seul `rdf:RDF` et pypdf lit `['de']`.
veraPDF passe dans les trois cas : ce n'est pas une exigence PDF/UA-1.
