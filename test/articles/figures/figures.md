Cet article n'existe que pour éprouver le rendu des images. Chaque cas ci-dessous a
déjà cassé quelque chose au moins une fois : l'ordre légende / image, la numérotation
qui saute, un crédit qui se perd, une image qui déborde de la colonne. Les six blocs
sont à comparer d'une passe à l'autre, en PNG, page par page.

## Figure complète

Le cas ordinaire : légende visible, texte alternatif distinct de la légende, copyright
et source. Attendu — `Figure 1 — …` puis les crédits, dans une `<figcaption>` placée
**avant** l'image, et l'image ramenée à la largeur de la colonne.

![Bandes horizontales de la charte, du bleu au sable](media/figures-fig-01.png){alt="Quatre bandes horizontales : bleu foncé, bleu ciel, sable, blanc cassé" copyright="© SZH" source="Banc d'essai"}

## Image hors numérotation, avec crédits

La case « Image sans légende ni numéro » du formulaire des médias. Attendu — aucun
« Figure N », aucune légende, mais une `<figure>` dont la `<figcaption>` ne porte que le
crédit, **après** l'image : une mention de droits ne se perd pas. Le compteur de figures
ne doit pas avancer ici.

![](media/figures-fig-02.png){.szh-hors-figure alt="Trois bandes horizontales : sable, bleu foncé, blanc cassé" copyright="© SZH"}

## Image hors numérotation, sans crédits

Le cas qui débordait : sans crédits il n'y a pas de `<figure>`, donc pas de règle de
largeur héritée d'elle. Attendu — un `<img>` seul dans son paragraphe, à la largeur de la
colonne et pas à ses 1800 pixels.

![](media/figures-fig-03.png){.szh-hors-figure alt="Trois bandes horizontales : bleu ciel, blanc cassé, bleu foncé"}

## Image vectorielle décorative

`alt=""` explicite : les lecteurs d'écran doivent passer l'image. Un SVG n'a pas de
résolution, le verdict de qualité du cockpit ne le signale jamais.

![](media/figures-fig-04.svg){alt=""}

## Figure de résolution insuffisante

320 pixels de large là où la colonne en demande 1000 au minimum : le cockpit le signale
dans le formulaire des médias, et le rendu ne doit pas pour autant agrandir l'image
au-delà de sa taille naturelle.

![Petite image de contrôle, volontairement sous-dimensionnée](media/figures-fig-05.png){alt="Deux bandes horizontales, bleu foncé et sable" source="Banc d'essai"}

## Deux insertions de la même image

La même image insérée deux fois porte deux numéros de figure, mais un seul jeu de
légende et de crédits — c'est le formulaire des médias qui les tient à l'identique.

![Bandes horizontales de la charte, du bleu au sable](media/figures-fig-01.png){alt="Quatre bandes horizontales : bleu foncé, bleu ciel, sable, blanc cassé" copyright="© SZH" source="Banc d'essai"}

## Grille de quatre images

Quatre images qui ne font qu'une figure : un numéro, une légende, et un bloc qui ne se
coupe pas. Attendu — deux `<div class="szh-grille-rangee">` de deux cases, chaque case
portant un `flex-grow` égal au rapport largeur/hauteur de son image, si bien que les deux
images d'une rangée sortent à la même hauteur et remplissent la colonne. Les crédits des
quatre sont rassemblés dans la seule `<figcaption>`, sans répéter deux fois le même.

::: {.szh-grille disposition="2-2"}
  ![Quatre bandes de la charte, deux par deux](media/figures-fig-01.png){alt="Quatre bandes horizontales : bleu foncé, bleu ciel, sable, blanc cassé" copyright="© SZH"}
  ![](media/figures-fig-02.png){alt="Trois bandes horizontales : sable, bleu foncé, blanc cassé" copyright="© SZH"}
  ![](media/figures-fig-03.png){alt="Trois bandes horizontales : bleu ciel, blanc cassé, bleu foncé" copyright="© Banc d'essai"}
  ![](media/figures-fig-05.png){alt="Deux bandes horizontales, bleu foncé et sable"}
:::

## Grille de deux images, disposition automatique

Sans attribut `disposition`, le filtre mesure les fichiers et choisit. Les deux images
ci-dessous sont des bandeaux très larges : côte à côte elles feraient un filet illisible,
et le mode automatique doit donc les empiler — une rangée d'une image chacune.

::: {.szh-grille}
  ![Deux bandeaux, rangés par la mesure des fichiers](media/figures-fig-01.png){alt="Quatre bandes horizontales" copyright="© SZH"}
  ![](media/figures-fig-05.png){alt="Deux bandes horizontales"}
:::

Texte de queue, pour que la dernière figure ne soit pas seule en fin de page et que la
coupure se voie.
