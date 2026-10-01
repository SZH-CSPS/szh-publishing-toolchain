# Correctif 20 : couche texte des fins de ligne

Patch : `image/patches/weasyprint-70.0/20-cesure-fin-de-ligne.patch`. Il porte lui aussi
deux corrections, d'avenir très différent en amont.

## Le défaut

Au copier-coller, à l'extraction et pour un lecteur d'écran :

1. **Trait de césure.** Le trait ajouté par `hyphens: auto` (ou un `&shy;`) est un vrai
   caractère du texte : « ac‐ compagnent » au lieu de « accompagnent ». Par défaut c'est
   U+2010 (`hyphenate-character` vaut `'‐'`, `css/properties.py` ligne 165 de la 70.0) ; la
   démo le montre. L'en-tête du patch parle de U+002D : c'est ce que la Revue obtenait avec
   ses polices, à revérifier, sans effet sur le correctif.
2. **Espace de fin de ligne.** Une ligne coupée sur une espace ne garde pas cette espace dans
   le PDF : « la marche » se recolle en « lamarche » chez les lecteurs qui joignent les
   lignes (mesuré sur 4 articles de la Revue : 5 fins de ligne sur 782 portaient une espace).

Normes : ISO 32000-1:2008, 14.9.4 (`/ActualText`, texte de remplacement) et 14.8.2.2.3,
cité par l'en-tête du patch pour la coupure de mot incidente (non revérifié dans le texte de
la norme) ; pour les espaces, ISO 32000-1 14.8.2.5 (identification des séparations de mots
en PDF balisé), à notre lecture. veraPDF ne contrôle ni l'un ni l'autre : il passe avant
comme après.

## La cause dans le code amont

- `weasyprint/text/line_break.py` de la 70.0 : `split_first_line()` sait qu'elle a coupé
  un mot (`hyphenated`, lignes 369-489) et ajoute `hyphenate_character` au texte de la
  ligne (lignes 439-472), mais l'information meurt avec la mise en page : elle n'est
  transmise qu'à `first_line_metrics()` (ligne 506).
- `weasyprint/layout/inline.py`, `split_text_box()` ligne 924 (copie ligne 947) : la boîte
  de texte garde le trait dans son texte, sans marque.
- `weasyprint/draw/text.py`, `draw_first_line()` ligne 87 : chaque glyphe part dans un `TJ`,
  le trait compris ; rien n'est entouré d'un `/Span /ActualText`. Le seul traitement du trait
  (lignes 113-117) sert à `text-overflow`.
- `layout/inline.py`, `remove_last_whitespace()` ligne 242 (appelée ligne 115) : l'espace
  de fin de ligne est retirée de la boîte, donc du dessin, donc de la couche texte. Pour la
  mise en page, c'est ce que veut CSS Text (une espace repliable en fin de ligne est
  retirée) : le retrait est juste, c'est la couche texte qui y perd.

## Ce que dit l'amont

- **Sur le trait**, [#2132](https://github.com/Kozea/WeasyPrint/issues/2132) (fermée), liZe :
  « There's a way to make PDF readers not copy some characters, like hyphens really used to
  split words, or markers for example. It's not in WeasyPrint, but it would be useful. »
  Personne ne l'a demandé depuis. Aucune occurrence de `ActualText` dans le code ni dans les
  issues (recherche du 01.10.2026).
- **Sur l'espace**, [#1635](https://github.com/Kozea/WeasyPrint/issues/1635) (fermée), liZe :
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
- `main` au 01.10.2026 : `draw/text.py`, `layout/inline.py`, `text/line_break.py` identiques
  à la 70.0. Non corrigé.

## Notre correctif

- Le trait : `line_break.py` pose `layout.hyphenated`, `split_text_box` le recopie en
  `box.hyphenated`, et `draw_first_line` ouvre `/Span <</ActualText (U+00AD)>> BDC` au
  premier glyphe du trait, ferme après le dernier. Rendu identique.
- L'espace : `get_next_linebox` repère une coupure sur une espace repliable
  (`_break_at_space`) et pose `line_end_space` sur la dernière boîte de texte ;
  `draw_first_line` ajoute alors le glyphe espace de la police (`hb_font_get_nominal_glyph`,
  déclaré dans `text/ffi.py`), sans encre. Jamais après une césure, en fin de paragraphe,
  sur un `<br>`, en `white-space: pre*` ni de droite à gauche.

C'est le plus gros des quatre patchs (232 lignes), et la partie « espace » touche la mise en
ligne, le code le plus mouvant de WeasyPrint.

## Recommandation

- **Trait de césure** : **le proposer en amont** (issue courte, code sur demande). Le
  mainteneur a dit que ce serait utile, la correction est locale (dessin) et conforme à
  ISO 32000-1. **Le garder** d'ici là, **le retirer** quand l'amont le fera.
- **Espace de fin de ligne** : **le garder, sans le proposer**. Les deux réponses citées
  disent d'avance que l'amont ne veut pas courir après les heuristiques des lecteurs ; le
  code est intrusif. **À rejuger à chaque montée** : c'est le morceau le plus exposé à un
  conflit, et le premier à retirer si le coût de maintenance dépasse le gain (5 lignes sur
  782).
- Comme le 10, ce patch mêle deux fonctionnalités : il faudrait le scinder (20-cesure,
  21-espace-fin-de-ligne) pour suivre la règle « un fichier par fonctionnalité ». Non fait
  ici, hors périmètre.

Texte prêt : `ISSUE.md` (trait de césure seulement).

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/20-cesure-fin-de-ligne/demo/demo.sh
```

HTML : `cesure.html` (paragraphe de 32 mm en `hyphens: auto`, `lang="fr"`). Sortie du
01.10.2026 :

```
== Préparation des deux venvs
  patch-weasyprint : posé 20-cesure-fin-de-ligne.patch
  patch-weasyprint : WeasyPrint 70.0, 1 correctif(s) posé(s) sur /tmp/tmp.jnAcozA30d/patche/lib/python3.13/site-packages.
  nu     : WeasyPrint 70.0, aucun correctif SZH
  patché : WeasyPrint 70.0 + 20-cesure-fin-de-ligne.patch

== cesure, WeasyPrint nu
  veraPDF ua1 : PASS (0 règle(s) en échec)
  texte extrait par pypdf (· = espace) :
    p1 |Les·enseignantes|
    p1 |spécialisées·ac‐|
    p1 |compagnent·la|
    p1 |marche·des|
    p1 |élèves.|
  flux de contenu, marques de césure :
    page 1 : 0 ligne(s) avec 'ActualText'

== cesure, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  texte extrait par pypdf (· = espace) :
    p1 |Les·enseignantes·|
    p1 |spécialisées·ac‐|
    p1 |compagnent·la·|
    p1 |marche·des·|
    p1 |élèves.|
  flux de contenu, marques de césure :
    page 1 : 1 ligne(s) avec 'ActualText'
      <</ActualText <feff00ad>>>
      BDC
      [<0af3>0] TJ
      …
```

Lecture : pypdf ne lit pas `/ActualText` et rend toujours le trait (« ac‐ ») ; la preuve
du trait est dans le flux, où le glyphe `<0af3>` est entouré du `/Span` qui le remplace par
U+00AD. Les espaces de fin de ligne (`·` en bout de ligne) n'existent que dans le PDF
patché. Aucun lecteur PDF ni lecteur d'écran n'a été essayé ici (poppler n'est pas dans la
WSL) : l'effet sur NVDA ou Acrobat est **non vérifié**.
