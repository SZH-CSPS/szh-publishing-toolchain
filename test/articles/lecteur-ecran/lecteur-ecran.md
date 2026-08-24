Cet article n'existe que pour un contrôle : ce qu'un lecteur d'écran reçoit, et que l'œil
ne voit nulle part. L'aperçu HTML du cockpit pose sous chaque image et chaque tableau un
encadré pointillé qui le montre ; le PDF, lui, n'en porte aucune trace. Les cas ci-dessous
sont à regarder **dans l'aperçu**, côte à côte : le seul encadré coloré de la page doit être
celui de l'image sans texte alternatif.

## Texte alternatif distinct de la légende

Le cas ordinaire, celui qu'on souhaite partout : la légende dit ce que la figure apporte à
l'argument, le texte alternatif décrit l'image. Attendu dans l'aperçu — `ALT=` suivi de la
description, sur fond blanc, en pointillé gris.

![Bandes horizontales de la charte, du bleu au sable](media/lecteur-ecran-fig-01.png){alt="Quatre bandes horizontales : bleu foncé, bleu ciel, sable, blanc cassé" copyright="© SZH"}

## Texte alternatif laissé vide, avec une légende

La case du formulaire n'a pas été remplie, mais il y a une légende : le rendu la recopie
dans l'`alt`, et un lecteur d'écran entend donc deux fois la même phrase. Ce n'est pas une
faute, c'est une redondance — l'encadré la nomme (« reprend la légende ») sans alerter.

![Deux bandes horizontales, bleu foncé et sable](media/lecteur-ecran-fig-04.png)

## Image déclarée décorative

`alt=""` écrit exprès : le rédacteur a coché « Image purement décorative », un lecteur
d'écran doit passer l'image. Attendu — l'encadré le **dit**, en gris : c'est une
information, pas une absence. Aucune couleur d'alerte ici, cette décision est légitime et
la revue la prend exprès pour les portraits d'auteur·e·s.

![](media/lecteur-ecran-fig-02.png){.szh-hors-figure alt=""}

## Aucun texte alternatif, et aucune légende

Le seul cas rouge de tout le dispositif : rien n'atteindra le lecteur d'écran, et rien ne
dit que c'est voulu. C'est exactement ce que l'export OJS refuse au dernier moment
(`imagesSansAlternative` de `lib/references.js`) ; l'encadré le montre beaucoup plus tôt, à
la relecture. Attendu — aplat rose, filet rouge, le mot **VIDE** en gros.

Ne pas « réparer » cette image : c'est le cas que le banc doit tenir.

![](media/lecteur-ecran-fig-03.png){.szh-hors-figure}

## Tableau avec une description longue

La description longue d'un tableau (`data-alt`) n'apparaît **nulle part** ailleurs :
`print.css` la masque à l'écran, la retire à l'impression, et `szh-galley-docx.lua` l'ôte du
galley Word. L'aperçu est le seul endroit où elle se relit. Attendu — `DESCRIPTION=` suivie
de son texte, puis le compte des en-têtes et leur portée.

::: {.szh-tabelle src="tables/table-01.html"}
:::

## Tableau sans description et sans en-tête

Ni description longue, ni rangée d'en-tête. Aucun des deux n'est une faute : la description
est facultative, et ni le RGAA ni les WCAG n'exigent qu'un tableau ait un en-tête — ils
exigent que celui qui existe soit déclaré. Attendu — deux témoins gris en italique, aucune
couleur d'alerte.

Ne pas « réparer » ce tableau non plus.

::: {.szh-tabelle src="tables/table-02.html"}
:::

## Tableau écrit en markdown

Une table pipe ne permet pas de saisir une description longue : l'encadré n'en parle donc
pas — annoncer « non renseignée » désignerait une case qui n'existe pas. Reste la portée des
en-têtes, posée par `szh-tabelle-scope.lua`, que rien d'autre ne montre.

Pas de légende ici : la syntaxe `: Légende` d'une table pipe n'est lue que par le lecteur
`markdown` du PDF, pas par le `commonmark_x` de l'aperçu, où elle resterait un paragraphe
égaré. Aucun article du banc n'en met, et un rédacteur n'en écrit pas non plus.

| Mesure | Effectif |
|:-------|---------:|
| Entretiens | 59 |
| Observations | 98 |

Texte de queue, pour que le dernier encadré ne soit pas seul en fin de page.
