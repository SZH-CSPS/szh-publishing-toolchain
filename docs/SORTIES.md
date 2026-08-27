# Les sorties de la chaîne

Qui produit quoi, ce que chaque sortie garantit, et les deux endroits où l'on se trompe.

## En une phrase

Une source Markdown, une seule chaîne de filtres, plusieurs rendus. Ce qui porte le **sens**
— numéros de section, ancres de bibliographie, textes alternatifs — est produit une fois et
partagé ; ce qui porte la **forme** diffère par sortie.

## Aujourd'hui : deux compilations par article

| Sortie | Lecteur pandoc | Gabarit | Sert à |
|---|---|---|---|
| `out/<slug>/<slug>.html` | `markdown` | `szh-article.html` | source de WeasyPrint (le PDF) et du galley DOCX |
| `out/<slug>/<slug>.apercu.html` | `commonmark_x+sourcepos` | aucun | la colonne de droite de l'éditeur |

Les deux passent par la même suite de filtres Lua, dans le même ordre. Le PDF sort du
premier ; le second n'est jamais publié.

## Demain : trois, et pourquoi pas deux

La sortie web s'ajoute — un HTML pensé pour l'écran, sans page A4, sans en-tête courant,
sans couverture. Elle **remplace** le galley HTML actuel dans l'export OJS : le HTML
d'impression redevient alors ce qu'il aurait toujours dû être, un fichier de compilation.

| Sortie | Lecteur pandoc | Gabarit | Feuille |
|---|---|---|---|
| HTML d'impression | `markdown` | gabarit d'impression | `socle.css` + `print.css` |
| HTML web | `markdown` | gabarit web | `socle.css` + `web.css` |
| Aperçu du cockpit | `commonmark_x+sourcepos` | gabarit web | `socle.css` + `web.css` |

L'aperçu et la sortie web partagent gabarit et feuille : le rédacteur relit son article dans
la maquette du site, ce qui a du sens dans une webview étroite — une feuille A4 n'en a aucun.
Le PDF et la sortie web partagent le lecteur et les filtres : c'est là que la divergence
serait dangereuse, et c'est là que le test de parité regarde.

### La question qui revient : pourquoi pas deux ?

Puisque le site nettoie le HTML avant de l'injecter, on pourrait n'en compiler qu'un seul,
avec `sourcepos`, et le laisser servir l'aperçu **et** la publication. L'idée est
séduisante — et la mesure la tue.

`sourcepos` n'est pas un attribut de plus : c'est un mode du lecteur `commonmark_x`, qui
**enveloppe** les blocs pour pouvoir leur accrocher une position. Sur un article réel du
numéro 2027-01 :

| | HTML d'impression | Aperçu (`sourcepos`) |
|---|---|---|
| attributs `data-pos` | 0 | **8 380** |
| `<div>` | 34 | 55 |

Vingt et un `div` d'enveloppe qui n'existent pas dans le document, et huit mille attributs
de machine à bâtir. Publier ce fichier-là, ce serait publier l'outil avec l'œuvre, et donner
au parseur du site huit mille occasions de se tromper. Le balisage publié doit être celui
qu'on a décidé, pas celui qu'un mode de lecteur a produit en passant.

Trois compilations, donc. Une passe pandoc de plus par article se compte en secondes ; un
balisage publié qu'on ne contrôle plus se paie pendant des années.

## Ce que devient le HTML sur le site

Le HTML web n'est **pas** affiché tel quel. Un analyseur, côté site, le nettoie et en
réinjecte le contenu dans la page de l'article — pas d'iframe, pas de fichier autonome
téléchargé par le lecteur. C'est plus propre et plus accessible qu'un cadre : le texte de
l'article est du texte de la page, dans le même document que la navigation.

Trois conséquences, et la troisième est celle qu'on oublie.

### 1. Ce que la chaîne livre, c'est du contenu

Tout ce qui appartient au document englobant — `<html>`, `<head>`, `<title>`, les métadonnées
de page — est écarté à l'injection. Inutile d'y soigner quoi que ce soit ; et surtout,
**rien d'important ne doit y être posé**. Le millésime, en particulier, ne se met pas sur
`<html>` mais sur l'élément d'article, seul survivant :

```html
<article class="szh-article" data-szh-maquette="1" data-szh-numero="2027-01" data-szh-revue="revue">
```

### 2. La feuille de style peut se corriger sans rien republier

Le fragment injecté hérite de la page qui l'accueille. Corriger l'apparence d'un article
publié, c'est donc modifier une feuille — pas ré-exporter, pas re-téléverser, pas
republier. C'était la question de départ, et elle se trouve résolue par la mécanique du
site plutôt que par la chaîne.

> **Où en est-on.** Pour l'instant, tout reste local : la feuille est injectée dans le HTML
> à la compilation, comme pour le PDF. L'hébergement de la feuille ailleurs — dans le thème
> du site — se décidera quand la sortie web existera. Le choix n'engage rien aujourd'hui, à
> une chose près : le millésime, lui, doit être posé **dès le premier article publié**
> (ci-dessous).

### 3. Le prix : le balisage devient un contrat

Si la feuille vit d'un côté du mur et les articles de l'autre, alors ce qui les relie — les
noms de classes, la structure qu'ils habillent — n'est plus un détail d'implémentation.
C'est une interface publique entre deux choses qui n'évoluent pas au même rythme :

* un article est **figé** le jour de sa publication ; son balisage est celui de ce jour-là,
  pour toujours ;
* la feuille est **vivante** ; elle sera réécrite, plusieurs fois, sur des années.

Le jour où la chaîne renomme `.szh-tableau` ou enveloppe les figures autrement, les articles
déjà en ligne gardent l'ancien balisage — et la feuille du moment ne les reconnaît plus. Ils
perdent leur mise en forme **en silence**, et personne ne le remarque, parce que personne ne
relit les numéros d'il y a quatre ans.

D'où deux choses à tenir :

* **le contrat de balisage**, écrit : quelles classes la chaîne émet, ce qu'elles
  enveloppent, ce sur quoi une feuille a le droit de s'appuyer. Sans lui, personne côté
  feuille ne sait ce qui est sûr à cibler, et personne côté chaîne ne sait ce qu'il n'a pas
  le droit de renommer ;
* **le millésime**, qui donne à la feuille de 2032 le moyen de garder une branche pour le
  balisage de 2027 :

```css
article[data-szh-maquette="1"] .szh-tableau caption { /* l'ancienne forme */ }
```

Le millésime numérote **la maquette**, pas le logiciel. La version du cockpit s'incrémente
pour des raisons sans rapport — un bouton corrigé créerait un millésime au balisage
identique, et en quelques mois les sélecteurs deviendraient illisibles. Il s'incrémente à la
main, quand le vocabulaire de classes ou la structure change.

Et il doit exister **avant le premier article publié** : un article mis en ligne sans
millésime ne peut plus être visé par une règle datée, sauf à le republier.

## Le CSS : un socle, des feuilles de sortie

Une variable se déclare à un seul endroit. Quatre fichiers, empilés dans cet ordre :

| Fichier | Ce qu'il porte | Lu par |
|---|---|---|
| `styles/socle.css` | polices `@font-face`, jetons `:root` : familles, échelle, encres, filets, replis d'accent annuel | toutes les sorties |
| `styles/print.css` | ce qui n'a de sens que sur une page : `@page`, couverture, en-têtes courants, zone `@footnote`, coupures | PDF |
| `styles/web.css` *(à venir)* | ce qui n'a de sens qu'à l'écran : grille fluide, tableaux qui défilent, bloc de métadonnées | web et aperçu |
| `out/.szh-accent.css` | la couleur annuelle du numéro, écrite à la compilation par `accent-css.py` | toutes les sorties |

Ce qui a sa place au socle : une famille, une taille, une interligne, une encre, un filet —
tout ce qui se nomme et se réutilise. Ce qui n'y a pas sa place : une règle qui met en page.
Une boîte, une marge, un `@page`, une grille appartiennent à la feuille de leur média.

Trois points d'exécution, tous vérifiés par `test/js/socle-css.test.js` :

* **L'ordre est porteur.** `out/.szh-accent.css` surcharge les replis gris du socle. Empilé
  avant lui, il n'aurait aucun effet : tout un numéro s'imprimerait en gris, sans qu'aucune
  erreur ne soit levée.
* **Pas d'`@import`.** Les feuilles s'empilent par des `--css=` successifs. `--embed-resources`
  n'a pas à savoir suivre un import, et l'ordre de la cascade se lit dans le Makefile.
* **Le socle vient toujours du toolkit**, même quand un dossier de revue porte son propre
  `styles/print.css` — que le Makefile préfère alors. Une feuille locale hérite ainsi des
  jetons sans les redéclarer, et ne peut pas dériver de la maquette.

Les couleurs annuelles elles-mêmes vivent dans `styles/couleurs.css` : une échelle APCA à
clarté fixe, six teintes × onze crans, vérifiée cran par cran par `test/apca-check.py`.

> L'extraction du socle hors de `print.css` a été validée par empreinte visuelle : les 38
> pages du banc d'essai et de la mini-revue de test rendent des PNG **identiques au pixel**,
> avant et après. C'est le contrôle à refaire pour tout déplacement de règle entre feuilles —
> `test/README.md` décrit la boucle.
