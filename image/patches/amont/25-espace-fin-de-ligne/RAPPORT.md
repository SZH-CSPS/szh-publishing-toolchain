# Correctif 25 : espace de fin de ligne

Patch : `image/patches/weasyprint-70.0/25-espace-fin-de-ligne.patch`. Tiré du correctif 20,
qui le portait avec le trait de césure ([20-cesure-trait](../20-cesure-trait/RAPPORT.md)).
Il ne produit rien sans le 20 : le dessin de l'espace y est resté, parce qu'il lit les
variables que pose le bloc du trait dans `draw_first_line`, et qu'une même ligne ne peut
pas appartenir à deux patchs. Le 25 s'applique seul au caractère près ; posé sans le 20,
`test/weasyprint-patch-check.py` échoue.

## Le défaut

Au copier-coller, à l'extraction et pour un lecteur d'écran, une ligne coupée sur une espace
ne garde pas cette espace dans le PDF : « la marche » se recolle en « lamarche » chez les
lecteurs qui joignent les lignes (mesuré sur 4 articles de la Revue : 5 fins de ligne sur
782 portaient une espace).

Norme : ISO 32000-1 14.8.2.5 (identification des séparations de mots en PDF balisé), à
notre lecture. veraPDF ne le contrôle pas : il passe avant comme après.

## La cause dans le code amont

- `layout/inline.py`, `remove_last_whitespace()` ligne 242 (appelée ligne 115) : l'espace
  de fin de ligne est retirée de la boîte, donc du dessin, donc de la couche texte. Pour la
  mise en page, c'est ce que veut CSS Text (une espace repliable en fin de ligne est
  retirée) : le retrait est juste, c'est la couche texte qui y perd.

## Ce que dit l'amont

- [#1635](https://github.com/Kozea/WeasyPrint/issues/1635) (fermée), liZe :
  « Understanding the text layout is so complex in a PDF that I think that PDF viewers don't
  rely at all on actual space characters, but use the distance between text items. I'm not
  sure that there's a solution to get these spaces back. » Et dans
  [#2715](https://github.com/Kozea/WeasyPrint/issues/2715) (fermée, marqueurs de liste
  séparés à l'extraction) : « PDF text extraction is heavily based on heuristics, that are
  different for different tools. We won't try to please them all, that would be endless
  work. » Le mainteneur renvoie alors au balisage (`--pdf-tags`).
- La PR ouverte [#1840](https://github.com/Kozea/WeasyPrint/pull/1840) (« Draft: Do line
  breaking in WeasyPrint using Harfbuzz data », brouillon depuis 2023) toucherait le même
  code de coupure ; rien n'y traite de la couche texte.
- `main` au 01.10.2026 : `layout/inline.py` identique à la 70.0. Non corrigé.

## Notre correctif

`get_next_linebox` repère une coupure sur une espace repliable (`_break_at_space`) et pose
`line_end_space` sur la dernière boîte de texte ; `draw_first_line` (dans le 20) ajoute alors
le glyphe espace de la police (`hb_font_get_nominal_glyph`, déclaré dans `text/ffi.py`),
sans encre. Jamais après une césure, en fin de paragraphe, sur un `<br>`, en
`white-space: pre*` ni de droite à gauche.

Le repérage touche la mise en ligne, le code le plus mouvant de WeasyPrint.

## Recommandation

- **Le garder, sans le proposer**. Les deux réponses citées disent d'avance que l'amont ne veut pas courir après les heuristiques des lecteurs ; le
  code est intrusif. **À rejuger à chaque montée** : c'est le morceau le plus exposé à un
  conflit, et le premier à retirer si le coût de maintenance dépasse le gain (5 lignes sur
  782).

Pas de texte d'issue : rien n'est proposé en amont.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/25-espace-fin-de-ligne/demo/demo.sh
```

HTML : `espace.html` (le paragraphe de `cesure.html` du 20 : 32 mm, `hyphens: auto`,
`lang="fr"`). Les deux venvs portent le 20, seul le patché a le 25. Sortie du 01.10.2026 :

```
== Préparation des deux venvs
  patch-weasyprint : posé 20-cesure-trait.patch
  patch-weasyprint : WeasyPrint 70.0, 1 correctif(s) posé(s) sur /tmp/tmp.QGPUHyc8qj/nu/lib/python3.13/site-packages.
  patch-weasyprint : posé 20-cesure-trait.patch
  patch-weasyprint : posé 25-espace-fin-de-ligne.patch
  patch-weasyprint : WeasyPrint 70.0, 2 correctif(s) posé(s) sur /tmp/tmp.QGPUHyc8qj/patche/lib/python3.13/site-packages.
  nu     : WeasyPrint 70.0 + 20-cesure-trait.patch (socle), sans 25-espace-fin-de-ligne.patch
  patché : WeasyPrint 70.0 + 20-cesure-trait.patch 25-espace-fin-de-ligne.patch

== espace, WeasyPrint + 20
  veraPDF ua1 : PASS (0 règle(s) en échec)
  texte extrait par pypdf (· = espace) :
    p1 |Les·enseignantes|
    p1 |spécialisées·ac‐|
    p1 |compagnent·la|
    p1 |marche·des|
    p1 |élèves.|

== espace, WeasyPrint + 20 + 25
  veraPDF ua1 : PASS (0 règle(s) en échec)
  texte extrait par pypdf (· = espace) :
    p1 |Les·enseignantes·|
    p1 |spécialisées·ac‐|
    p1 |compagnent·la·|
    p1 |marche·des·|
    p1 |élèves.|
```

Lecture : les espaces de fin de ligne (`·` en bout de ligne) n'existent que dans le PDF qui
porte le 25 ; aucune après la césure « ac‐ ». Aucun lecteur PDF ni lecteur d'écran n'a été
essayé ici : l'effet sur NVDA ou Acrobat est **non vérifié**.
