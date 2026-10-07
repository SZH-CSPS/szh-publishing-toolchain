# Limites d'accessibilité connues

Cette page liste, format par format, ce que les sorties de Pronto ne garantissent pas encore.
Les normes visées et ce qui est en place sont dans [`ACCESSIBILITE.md`](ACCESSIBILITE.md).
Une limite levée sort de cette page.

Les PDF passent veraPDF PDF/UA-1 malgré ces limites : veraPDF ne teste que les conditions
vérifiables par machine, et la plupart des défauts ci-dessous lui échappent.

## Comment lire les tableaux

- **Norme** : la clause en cause. PDF/UA-1 (ISO 14289-1) ; Matterhorn 1.1, la liste des
  conditions d'échec de PDF/UA-1 (« MH » suivi du point de contrôle) ; WCAG 2.2 ; EPUB
  Accessibility 1.1.
- **Gravité** : *majeure* (une information n'atteint pas un lecteur d'écran, ou lui arrive
  fausse), *moyenne* (elle arrive, mais mal placée ou mal annoncée), *mineure* (gêne,
  métadonnée, confort).
- **Cause** : WeasyPrint, pandoc, la maquette de Pronto, ou le contenu déposé.
- **État** : *accepté* (on vit avec), *attend WeasyPrint* ou *attend pandoc* (seul un
  changement de l'outil le lèvera), *à corriger* (dans Pronto).

## PDF d'article

La sortie `out/<slug>/<slug>.pdf`, aussi galley PDF de l'export OJS.

| Limite | Norme | Gravité | Cause | État |
|---|---|---|---|---|
| Les notes de bas de page ne sont pas des `/Note` : le texte d'une note est balisé à l'endroit de son appel, et un lecteur d'écran le lit au milieu de la phrase. | PDF/UA-1 7.9 ; MH 19 | majeure | WeasyPrint : `float: footnote` ne produit pas de `/Note` | accepté, sans correctif |
| Aucune langue d'élément : un résumé allemand, une citation `lang=de`, un mot `{lang=en}` gardent leur `lang` dans le HTML et le perdent dans le PDF. Seul le catalogue a un `/Lang`, et tout est lu avec la voix de l'article. | PDF/UA-1 7.2 ; MH 11 ; WCAG 3.1.2 | majeure | WeasyPrint : `pdf/tags.py` n'écrit jamais `/Lang` sur un élément, et aucun attribut HTML ni propriété CSS ne l'atteint | attend WeasyPrint |
| La légende d'une figure est un `/Caption` voisin de la `/Figure`, et non son enfant ; la `/BBox` de la figure est en pixels CSS, et non en points. | PDF/UA-1 7.3 ; MH 13 ; ISO 32000-1, `BBox` | moyenne | WeasyPrint ([Kozea/WeasyPrint#2482](https://github.com/Kozea/WeasyPrint/issues/2482)) | attend WeasyPrint |
| Une figure numérotée (légende non vide) mais déclarée décorative (`alt=""`) devient un fond CSS : la légende reste, l'image se tait, et aucun contrôle ne le signale. | WCAG 1.1.1 ; PDF/UA-1 7.3 | majeure pour le contenu touché | contenu, et règle de Pronto | à corriger : lever un avertissement dans les Contrôles |
| Un paragraphe coupé par la page devient deux `/P` : la lecture continue, mais la navigation par paragraphe s'arrête au milieu d'une phrase. | PDF/UA-1 7.1 | mineure | WeasyPrint : un arbre de structure par page | accepté (seul `break-inside: avoid` sur les paragraphes l'éviterait, au prix de la mise en page) |
| Un lien coupé en fin de ligne produit deux annotations et deux `/Link` : le lecteur d'écran annonce deux liens. | PDF/UA-1 7.18 ; MH 28 ; WCAG 2.4.4 | mineure | WeasyPrint : une annotation par boîte de ligne | attend WeasyPrint |
| Le `/Contents` d'un lien interne est l'identifiant de sa cible (« ref-plaisance-2007 »). Le texte du lien, que le lecteur d'écran annonce d'abord, est bien dans le `/Link`. | PDF/UA-1 7.18.5 ; WCAG 2.4.4 | mineure | WeasyPrint : `add_links` (`pdf/anchors.py`) écrit la cible sans lire `aria-label`, `title` ni le texte | attend une décision : correctif possible, non écrit |
| L'exergue est lue deux fois : à sa place dans le texte, puis dans l'exergue. | WCAG 1.3.2 | mineure | maquette ; WeasyPrint ignore `aria-hidden` | accepté |
| La puce `▸` d'une liste est un vrai `/Lbl`, mais un lecteur d'écran peut la prononcer (« triangle ») au lieu de « puce ». | PDF/UA-1 7.1 | mineure | WeasyPrint n'écrit pas d'`/ActualText` | accepté |
| La description longue d'un tableau (`data-alt`) est un `/Div` juste après le `/Table` : elle se lit comme un paragraphe qui suit, sans lien avec le tableau. | PDF/UA-1 7.5 | mineure | WeasyPrint n'écrit ni `/Summary` ni `/Alt` sur un `/Table` | attend WeasyPrint |
| Le « N° » et le point médian de la ligne « VOL. 7 · N° 4/2017 » de la couverture sont lus tels quels. | WCAG 1.3.1 | mineure | maquette | accepté |

Non visés : les profils plus stricts que PDF/UA-1 (PDF/UA-2, WTPDF). veraPDF y relève
notamment des `/Span` enfants directs de `/Document` et de `/Sect`, et les `/Caption` hors
figure décrits plus haut.

Non vérifié : tout ce que Matterhorn laisse au jugement humain (pertinence des textes
alternatifs, ordre de lecture réel, titres qui décrivent leur section, sens porté par la
seule couleur, tableau complexe lu cellule par cellule). Aucun essai avec un lecteur d'écran
(NVDA, JAWS, VoiceOver) n'a été fait.

## HTML autonome

La sortie `out/<slug>/<slug>.html` : source de WeasyPrint, et galley HTML de l'export OJS.

| Limite | Norme | Gravité | Cause | État |
|---|---|---|---|---|
| Une note est un `<span class="szh-note">` à l'endroit de son appel, sans rôle ni lien : elle est lue au milieu de la phrase. | WCAG 1.3.1 | majeure | maquette : le balisage des notes sert le `float: footnote` du PDF | à corriger avec une sortie web propre ([`A-FAIRE.md`](A-FAIRE.md#sortie-web-de-la-revue)) |
| Une figure numérotée déclarée décorative est un fond CSS, sans texte alternatif (même cas que dans le PDF). | WCAG 1.1.1 | majeure pour le contenu touché | contenu, et règle de Pronto | à corriger |
| Pas de repère `<main>`. | WCAG 1.3.1 | mineure | maquette | sans objet tant que le site intègre le contenu dans sa propre page |

Non vérifié : rendu et contraste à l'écran (la feuille est `print.css`, pensée pour l'A4),
zoom et redistribution à 400 % (WCAG 1.4.10), navigation au clavier, validateurs
automatiques (axe, WAVE, Nu Html Checker), lecteur d'écran.

## Galley Word (DOCX)

La sortie `out/<slug>/<slug>.docx` (cible `docx`), tirée du HTML autonome par pandoc et
`szh-galley-docx.lua`. Pronto ne produit pas de galley ODT.

| Limite | Norme | Gravité | Cause | État |
|---|---|---|---|---|
| Une note de plusieurs paragraphes arrive en un seul : `szh-notes.lua` joint les paragraphes d'une note dans le HTML, et le galley est tiré de ce HTML. | WCAG 1.3.1 | mineure | chaîne | accepté |
| Une image décorative sans légende (`alt=""`) est absente du Word, un paragraphe vide à sa place. pandoc ne sait pas écrire la marque « décorative » de Word (`adec:decorative`), et une image sans description serait signalée par le vérificateur de Word. | WCAG 1.1.1 | mineure (aucune information perdue) | pandoc | accepté |

Non vérifié : vérificateur d'accessibilité de Word, ordre de lecture dans Word, texte
alternatif des tableaux.

## Livre

Les sorties du profil livre ([`SORTIES.md`](SORTIES.md)). Le PDF numérique et la couverture
à plat passent veraPDF PDF/UA-1. Les limites du PDF d'article valent aussi pour le PDF du
livre : c'est le même moteur.

| Sortie | Limite | Norme | Gravité | Cause | État |
|---|---|---|---|---|---|
| PDF numérique | Les entrées du sommaire sont des `/LI` sans `/Lbl`, et chacune contient un `/Link` imbriqué dans un autre (le titre, puis le folio). | PDF/UA-1 7.18 | mineure | maquette et WeasyPrint | à examiner |
| EPUB 3 | Pas de déclaration de conformité (`dcterms:conformsTo`), pas d'`accessibilitySummary`, pas de liste des pages (`page-list`) alors qu'une édition imprimée existe. | EPUB Accessibility 1.1 | mineure à moyenne | chaîne EPUB du livre | à corriger |
| EPUB 3 | EPUBCheck et Ace (DAISY) ne sont pas dans l'image WSL : l'EPUB n'est contrôlé que par `test/epub-check.py`. | EPUB Accessibility 1.1 | inconnue | outillage | non vérifié |
| HTML web | Mêmes points non vérifiés que le HTML autonome. | WCAG 2.2 | inconnue | — | non vérifié |

Le PDF imprimeur n'est pas un livrable d'accessibilité.

## Hors du champ

L'aperçu du cockpit (`*.apercu.html`) n'est jamais publié. Les exports de métadonnées (OJS,
secrétariat, Kirby) ne sont pas des documents de lecture.
