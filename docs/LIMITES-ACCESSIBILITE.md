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
  changement de l'outil le lèvera), *à corriger* (dans Pronto), *levée à la reconstruction
  de l'image* (un correctif de WeasyPrint est écrit ; il arrive sur un poste avec l'image
  WSL, et la ligne sort ensuite).

## PDF d'article

La sortie `out/<slug>/<slug>.pdf`, aussi galley PDF de l'export OJS.

| Limite | Norme | Gravité | Cause | État |
|---|---|---|---|---|
| Les notes de bas de page ne sont pas des `/Note`. Le texte d'une note est balisé en bas de page, après le dernier bloc de la page : un lecteur d'écran le lit au milieu du flux, et peut couper une liste entre deux items. L'appel est un `/NonStruct` sans lien vers sa note. | PDF/UA-1 7.9 ; MH 19 | majeure | WeasyPrint : `float: footnote` ne produit pas de `/Note` | levée à la reconstruction de l'image (correctif `80-notes-balisees` : `/Note` juste après son appel, appel en `/Reference`) |
| Aucune langue d'élément : un résumé allemand, une citation `lang=de`, un mot `{lang=en}` gardent leur `lang` dans le HTML et le perdent dans le PDF. Tout est lu avec la voix de l'article. | PDF/UA-1 7.2 ; MH 11 ; WCAG 3.1.2 | majeure | WeasyPrint : `pdf/tags.py` n'écrit pas de `/Lang` sur un élément | levée à la reconstruction de l'image (correctif `60-langue-element`) |
| La légende d'une figure est un `/Caption` voisin de la `/Figure`, et non son enfant. La `/BBox` de la figure est en pixels CSS, et non en points, et mesurée depuis le haut de la page. | PDF/UA-1 7.3 ; MH 13 ; ISO 32000-1, `BBox` | moyenne | WeasyPrint ([Kozea/WeasyPrint#2482](https://github.com/Kozea/WeasyPrint/issues/2482)) | attend WeasyPrint |
| Une figure numérotée (légende non vide) mais déclarée décorative (`alt=""`) devient un fond CSS : la légende reste, l'image se tait. | WCAG 1.1.1 ; PDF/UA-1 7.3 | majeure pour le contenu touché | contenu | signalé : message `figure-legendee-decorative` dans les Contrôles et l'aperçu |
| Un bloc coupé par la page devient deux éléments : un paragraphe deux `/P`, une liste deux `/L` (un lecteur d'écran annonce deux listes), un chapitre de livre un `/Sect` par page. La lecture continue, mais la navigation par élément s'arrête à la coupure. | PDF/UA-1 7.1 ; WCAG 1.3.1 | mineure | WeasyPrint : un arbre de structure par page | accepté (seul `break-inside: avoid` l'éviterait, au prix de la mise en page) |
| Une sous-liste est un `/L` frère des `/LI` de sa liste, et non un enfant du `/LBody` de son item : le lien entre l'item et sa sous-liste est perdu. | PDF/UA-1 7.6 ; ISO 32000-1, tableau 336 ; WCAG 1.3.1 | moyenne | WeasyPrint (`pdf/tags.py`) | levée à la reconstruction de l'image (correctif `85-listes-imbriquees`) |
| Une liste de définition (`dl`) devient un `/L` dont chaque terme et chaque définition sont des `/LI` sans `/Lbl` : rien ne lie le terme à sa définition. | PDF/UA-1 7.6 ; WCAG 1.3.1 | moyenne | WeasyPrint (`dt` et `dd` en `/LI`) | levée à la reconstruction de l'image (correctif `85-listes-imbriquees`) |
| Un lien coupé en fin de ligne produit deux annotations et deux `/Link` : le lecteur d'écran annonce deux liens. | PDF/UA-1 7.18 ; MH 28 ; WCAG 2.4.4 | mineure | WeasyPrint : une annotation par boîte de ligne | attend WeasyPrint |
| Le `/Contents` d'un lien interne est l'identifiant de sa cible (« ref-plaisance-2007 »), que NVDA prononce avec Acrobat. Un lien sans texte (ORCID, retour à l'appel, licence) n'a que ce `/Contents` ou son URL : son `aria-label` est perdu. | PDF/UA-1 7.18.1, 7.18.5 ; MH 28 ; WCAG 2.4.4 | moyenne | WeasyPrint : `add_links` (`pdf/anchors.py`) écrit la cible sans lire `aria-label`, `title` ni le texte | levée à la reconstruction de l'image (correctif `65-nom-des-liens`) |
| Dans une ligne justifiée, Edge (pdfium) colle des mots (« unarticle de laRevue ») : il ne lit pas les espaces élargies et en déduit d'autres. | WCAG 1.3.1 | moyenne | WeasyPrint : l'espace justifiée est dessinée avec un décalage avant | levée à la reconstruction de l'image (correctif `70-espaces-justifiees`) |
| Dans le lecteur PDF d'Edge, NVDA colle la fin d'une ligne au début de la suivante (« andnot ») : chaque ligne est un contenu marqué, qu'Edge expose comme un texte à part, sans ses espaces. | WCAG 1.3.1 | moyenne | WeasyPrint : un `/Span` et un MCID par ligne | levée à la reconstruction de l'image (correctif `90-un-mcid-par-element`) ; reste vrai à la frontière d'un élément en ligne, entre les deux morceaux d'un lien ou d'un accent coupé par la ligne, après un `<br>`, dans un `pre` et de droite à gauche |
| `/Info /Author` joint les auteurs par une virgule, alors que chacun s'écrit « Nom, Prénom » : « Dupont, Anne, Muller, Jean ». Le XMP (`dc:creator`) garde un auteur par entrée. | PDF/UA-1 7.1 (métadonnées) | mineure | WeasyPrint : `', '.join(metadata.authors)` (`pdf/__init__.py`) | levée à la reconstruction de l'image (correctif `75-auteurs-info`) |
| Les `headers=` d'un tableau complexe sont calculés quand l'éditeur du cockpit enregistre le fichier `tables/*.html`. Un fichier qui n'a pas été réenregistré depuis peut omettre le groupe de colonnes sous un titre de section (l'année), rattacher la rangée de total à la dernière section, et garder un `/TH` vide à gauche d'un titre de section. | PDF/UA-1 7.5 ; WCAG 1.3.1 | moyenne | contenu : fichier écrit avant les règles de [`ACCESSIBILITE.md`](ACCESSIBILITE.md#le-balisage-du-pdf) | à corriger tableau par tableau, par une modification dans l'éditeur |
| La description longue d'un tableau (`data-alt`) est un `/Div` après le `/Table` et sa note : elle se lit comme un paragraphe qui suit, sans lien avec le tableau. | PDF/UA-1 7.5 | mineure | WeasyPrint n'écrit ni `/Summary` ni `/Alt` sur un `/Table` | attend WeasyPrint |
| Dans une grille d'images, chaque `/Figure` est enfant d'un `/Span` (élément en ligne). | PDF/UA-1 7.1 | mineure | WeasyPrint | accepté |
| Une exergue qui répète une phrase du texte est lue deux fois : à sa place dans le texte, puis dans l'exergue. | WCAG 1.3.2 | mineure | maquette ; WeasyPrint ignore `aria-hidden` | accepté |
| La puce `▸` d'une liste est un vrai `/Lbl`, mais un lecteur d'écran peut la prononcer comme un symbole (« petit triangle plein pointant vers la droite » dans les dictionnaires de NVDA) au lieu de « puce ». | PDF/UA-1 7.1 | mineure | WeasyPrint n'écrit pas d'`/ActualText` | accepté |
| Une URL ou un DOI écrit en clair dans la bibliographie est du texte, et non un lien, dans le PDF comme dans le HTML. | WCAG 2.4.4 | mineure | contenu : `<slug>.biblio.md` en texte brut ; un lien posé par la chaîne change l'anticrénelage de quelques glyphes des lignes touchées | à reprendre à la prochaine majeure |
| Un texte interlettré au-delà de 0,105 em (« Résumé », « Zusammenfassung », titre d'un encadré, à 0,12 et 0,14 em) est extrait lettre à lettre par pdfium (Edge, Chrome) : « R é s u m é ». Le texte balisé, qu'un lecteur d'écran reçoit, est juste. | WCAG 1.3.1 (copier-coller) | mineure | maquette (`print.css`) | accepté |
| Dans Chrome et Edge (pdfium), le texte extrait d'un mot coupé en fin de ligne contient U+FFFE à la place du trait (« quotidien », U+FFFE, « nement »), qui peut sortir d'un copier-coller ; un trait de césure dans un texte interlettré y est dessiné environ 0,8 pt trop loin. Acrobat et Ghostscript ne sont pas touchés, et le texte balisé (`/ActualText` U+00AD) est juste. | WCAG 1.3.1 (copier-coller) | mineure | correctif `20-cesure-trait` lu par pdfium | accepté (non vérifié dans un navigateur ; aucun texte interlettré de Pronto n'est coupé) |
| Le « N° » et le point médian de la ligne « VOL. 7 · N° 4/2017 », sur la couverture comme dans l'en-tête d'un article, sont lus tels quels ; le « o » en exposant est extrait à part (« N o 4/2017 »). | WCAG 1.3.1 | mineure | maquette | accepté |

Non visés : les profils plus stricts que PDF/UA-1 (PDF/UA-2, WTPDF). veraPDF y relève
notamment des `/Span` enfants directs de `/Document` et de `/Sect`, et les `/Caption` hors
figure décrits plus haut. PAC 2024 relève, pour la même raison, 5 échecs « Structure
Elements » sur chaque article d'essai : neuf des dix viennent des `/Caption` hors de leur
`/Figure`, le dixième (article allemand) n'est pas expliqué.

Essai avec un lecteur d'écran : le 11 octobre 2026, NVDA 2026.2 a lu les articles d'essai
fr et de dans Acrobat, l'article fr dans Edge, en PDF et en HTML, avant les corrections de
la version 3.11.0. Il a confirmé la langue perdue, l'année absente des en-têtes du tableau
complexe, les notes lues entre deux items de liste et les identifiants de liens prononcés.
Non vérifié : JAWS et VoiceOver, et ce que Matterhorn laisse au jugement humain (pertinence
des textes alternatifs, titres qui décrivent leur section, sens porté par la seule
couleur).

## HTML autonome

La sortie `out/<slug>/<slug>.html` : source de WeasyPrint, et galley HTML de l'export OJS.

| Limite | Norme | Gravité | Cause | État |
|---|---|---|---|---|
| Une note est un `<span class="szh-note">` à l'endroit de son appel, sans rôle ni lien : elle est lue au milieu de la phrase. | WCAG 1.3.1 | majeure | maquette : le balisage des notes sert le `float: footnote` du PDF | à corriger avec une sortie web propre ([`A-FAIRE.md`](A-FAIRE.md#sortie-web-de-la-revue)) |
| Une figure numérotée déclarée décorative est un fond CSS, sans texte alternatif (même cas que dans le PDF). | WCAG 1.1.1 | majeure pour le contenu touché | contenu | signalé : message `figure-legendee-decorative` |
| Pas de repère `<main>`. | WCAG 1.3.1 | mineure | maquette | sans objet tant que le site intègre le contenu dans sa propre page |

Vérifié dans Edge, sur les articles d'essai : aucun défilement horizontal à 320, 768 et
1280 px ni à 400 % (WCAG 1.4.10), aucun texte sous 12 px hors exposant. Avec NVDA dans
Edge, la voix change aux passages en langue étrangère, et les notes sont lues dans la
phrase. Non vérifié : navigation au clavier.

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
| PDF numérique, HTML web, EPUB 3 | Une partie et ses chapitres sont tous des titres de niveau 1, et le titre du livre est un paragraphe de la page de titre : la hiérarchie des titres ne dit pas qu'un chapitre appartient à sa partie. Seuls le sommaire, les signets du PDF et la navigation de l'EPUB l'imbriquent. | WCAG 1.3.1 ; PDF/UA-1 7.4 | moyenne | maquette : un chapitre se compile comme un article, son titre est un `<h1>` | attend une décision |
| EPUB 3 | Pas de déclaration de conformité (`dcterms:conformsTo`) : la conformité WCAG 2.2 AA de l'EPUB n'a pas été vérifiée en entier (EPUBCheck, Ace, lecteur d'écran). Le résumé d'accessibilité le dit. | EPUB Accessibility 1.1 | mineure | outillage | non vérifié |
| EPUB 3 | Pas de liste des pages (`page-list`) alors qu'une édition imprimée existe. | EPUB Accessibility 1.1 | moyenne | chaîne EPUB du livre | à corriger |
| EPUB 3 | Un tableau qui contient une image est relu par pandoc : un tableau complexe y perd ses `<th>` de rangée. | WCAG 1.3.1 | majeure pour le contenu touché | chaîne EPUB du livre | accepté (cas non rencontré) |
| EPUB 3 | EPUBCheck et Ace (DAISY) ne sont pas dans l'image WSL : l'EPUB n'est contrôlé que par `test/epub-check.py`. | EPUB Accessibility 1.1 | inconnue | outillage | non vérifié |
| HTML web | Une note d'une pièce liminaire ou d'une pièce de fin reste en ligne, entre crochets : ces pièces sont compilées avec `szh-notes`. | WCAG 1.3.1 | mineure | chaîne | accepté |
| HTML web | Lecteur d'écran, zoom à 400 % au clavier : non essayés. | WCAG 2.2 | inconnue | — | non vérifié |

Le PDF imprimeur n'est pas un livrable d'accessibilité.

## Hors du champ

L'aperçu du cockpit (`*.apercu.html`) n'est jamais publié. Les exports de métadonnées (OJS,
secrétariat, Kirby) ne sont pas des documents de lecture.
