# Les sorties de la compilation

Cette page dit ce que produit une compilation, ce que chaque sortie garantit, et dans quel
ordre les feuilles de style s'empilent. Les limites d'accessibilité de chaque sortie sont
dans [`LIMITES-ACCESSIBILITE.md`](LIMITES-ACCESSIBILITE.md).

## Le principe

Une source Markdown passe par une seule chaîne de filtres et donne plusieurs rendus. Ce qui
porte le sens (numéros de section et de figure, ancres de bibliographie, textes alternatifs)
est produit une fois par les filtres, et partagé par toutes les sorties. Ce qui porte la
forme (page, polices, marges) diffère d'une sortie à l'autre, par la feuille de style.

## Ce que produit un article

Toutes les sorties d'un article sont dans `out/<slug>/`.

| Fichier | Lecteur pandoc | Gabarit | Sert à |
|---|---|---|---|
| `<slug>.html` | `markdown` | `szh-article.html` | source du PDF ; galley HTML et source du galley Word de l'export OJS |
| `<slug>.pdf` | | | le PDF de l'article, mis en page par WeasyPrint depuis `<slug>.html` |
| `<slug>.apercu.html` | `commonmark_x+sourcepos` | aucun | l'aperçu à côté de l'éditeur ; jamais publié |
| `<slug>.docx` | `html` | | galley Word de l'export OJS (cible `docx`) |

Le HTML et l'aperçu passent par la même suite de filtres Lua, dans le même ordre :
`CHAINE_ARTICLE` et `CHAINE_APERCU` de `pipeline/filtres.mk`. L'aperçu n'a ni
`szh-maquette` (couverture, en-têtes) ni `szh-exergue`, et commence par `szh-sourcepos.lua`
et `szh-ancres.lua`. Le lecteur `commonmark_x+sourcepos` pose un attribut `data-pos` sur
chaque bloc, ce qui permet de cliquer de l'aperçu vers le texte source ; il ajoute aussi
des enveloppes, si bien que ce HTML ne convient pas à la publication.

Ce que chaque sortie garantit :

- **Le HTML** est autonome (`--embed-resources`) : images, polices et feuilles de style y
  sont incorporées. Il porte la feuille d'impression (`print.css`), y compris quand il sert
  de galley HTML dans OJS.
- **Le PDF** est balisé PDF/UA-1 quand WeasyPrint y parvient. Sinon, la cascade de
  `define weasy_ua` (dans `pipeline/Makefile`) livre un PDF balisé simple, puis un PDF sans
  balisage, pour que la rédaction ait toujours une épreuve. La conformité est contrôlée
  après chaque compilation par veraPDF (`lib/pdfua-hote.js`), et exigée par la cible
  `verifier-ua` avant un export (`tout-exporter`, `docx`). Le journal de WeasyPrint est
  `out/<slug>/~weasyprint.err`.
- **Le galley Word** est tiré du HTML final, et non du `.md`, pour garder les tableaux
  fusionnés et les images. `szh-galley-docx.lua` en retire les blocs techniques (descriptions
  longues masquées). La cible `docx` exige d'abord la conformité PDF/UA du numéro.

## Ce que produit un livre

Un chapitre se compile comme un article. Les sorties du livre sont assemblées par
`livre-assembler.py` à partir des fragments de chapitre. Le détail de chaque cible est dans
[`ARCHITECTURE-LIVRES.md`](ARCHITECTURE-LIVRES.md#les-sorties).

| Sortie | Cible make | Tâche VSCodium | Fichier | Garantie |
|---|---|---|---|---|
| PDF numérique | `livre-pdf` | build par défaut (`Ctrl+S`) | `out/<livre>.pdf` | RVB, PDF/UA-1, signets ; seul PDF du livre contrôlé par la porte PDF/UA |
| PDF imprimeur | `livre-imprimeur` | Livre : PDF imprimeur | `out/<livre>-imprimeur.pdf` | fond perdu de 3 mm, traits de coupe ; CMJN avec texte en noir seul si `impression.profil-cmjn` est rempli |
| Couverture | `livre-couverture` | Livre : couverture | `out/<livre>-couverture-impression.pdf` et `out/<livre>-couverture.pdf` | à plat en PDF/X-4 CMJN, sans aucun RVB ; version écran en PDF/UA-1 |
| EPUB 3 | `livre-epub` | Livre : EPUB | `out/<livre>.epub` | vraies notes de fin, sommaire de navigation, structure vérifiée par `test/epub-check.py` |
| HTML web | `livre-html-web` | Livre : HTML web | `out/web/<livre>.html` | un seul fichier, lisible hors ligne |

`<livre>` est le nom du dossier du livre. Les quatre tâches « Livre : … » sont aussi dans le
panneau Export du cockpit, qui ne les montre que pour un livre.

**L'aperçu d'un chapitre.** `out/chapitres/<slug>.apercu.html` joue pour un chapitre le
rôle de l'aperçu d'un article : même lecteur `commonmark_x+sourcepos`, même suite de filtres
que le fragment publié (sans `szh-exergue`). Il tient ses propres compteurs
(`out/.szh-compteurs/apercu/`), pour ne pas décaler la numérotation continue des figures et
des tableaux du livre.

## La pile des feuilles de style

Une variable CSS se déclare à un seul endroit. Les feuilles sont passées à pandoc par des
`--css` successifs, dans cet ordre :

| Fichier | Ce qu'il porte | Lu par |
|---|---|---|
| `styles/socle.css` | polices (`@font-face`) et jetons `:root` : familles, tailles, encres, filets, replis gris de la couleur annuelle | toutes les sorties, revue et livre |
| `styles/print.css` | ce qui n'a de sens que sur une page : `@page`, couverture, en-têtes courants, zone des notes, coupures | la revue (HTML, PDF, aperçu) |
| `styles/livre/*.css` | `base.css`, puis `normal.css` ou `falc.css`, et selon la sortie `imprimeur.css`, `couverture.css`, `web.css` ou `epub.css` | les sorties du livre |
| `styles/partage-filtres.css` | le balisage posé par les filtres communs à la revue et au livre (`szh-numerotation.lua`, `szh-citations.lua`, `szh-grille.lua`) : préfixe « Figure N — », crédits de légende, description longue d'un tableau, appel de citation non lié, grille d'images | la revue ; le PDF numérique et le PDF imprimeur du livre |
| `styles/livre.css` du dossier du livre | les blocs propres à un livre (facultatif) | le PDF numérique et le PDF imprimeur de ce livre |
| `out/.szh-accent.css` | la couleur annuelle, écrite à la compilation par `accent-css.py` | toutes les sorties |

Les cas particuliers :

- le HTML web et l'EPUB du livre ne lisent ni `partage-filtres.css` ni `base.css` et la
  charte : `web.css` et `epub.css` redonnent leur forme aux mêmes classes, en unités d'écran ;
- l'EPUB reçoit le socle sans ses `@font-face` (`out/.szh-socle-epub.css`), car les polices
  ne sont pas dans l'archive ;
- si un dossier de revue contient `styles/print.css`, le Makefile la prend à la place de
  celle du toolkit. Le socle, lui, vient toujours du toolkit : la feuille locale hérite des
  jetons sans les redéclarer.

Ce qui va au socle : une famille, une taille, une interligne, une encre, un filet, tout ce
qui se nomme et se réutilise. Une règle qui met en page (boîte, marge, `@page`, grille)
appartient à la feuille de sa sortie.

`test/js/socle-css.test.js` vérifie les règles d'empilement :

- **L'ordre compte.** `out/.szh-accent.css` remplace les replis gris du socle. Placé avant
  lui, il n'aurait aucun effet : tout un numéro s'imprimerait en gris, sans erreur.
- **Pas d'`@import`.** L'ordre de la cascade se lit dans le Makefile, et `--embed-resources`
  n'a pas à suivre d'import.
- **Le socle vient du toolkit**, même quand la revue porte sa propre `print.css`.

Les couleurs annuelles sont dans `styles/couleurs.css` : six teintes de onze crans chacune,
sur une échelle de contraste APCA, vérifiées cran par cran par `test/apca-check.py`.
`styles/couleurs-reference.json` est la table unique des couleurs de la maison (RVB et CMJN).

Déplacer une règle d'une feuille à l'autre se vérifie par la comparaison au pixel de toutes
les pages du banc, avant et après : l'égalité des règles ne suffit pas, l'ordre de la cascade
compte ([`DEVELOPPEMENT.md`](DEVELOPPEMENT.md#le-banc-de-rendu-et-ses-empreintes)).
