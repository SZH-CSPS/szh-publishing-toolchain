# Typographie – ce que la chaîne corrige toute seule

Pour la rédaction francophone de la *Revue suisse de pédagogie spécialisée*.

Vous n’avez rien à taper de particulier. Écrivez au kilomètre, avec l’apostrophe et les
guillemets de votre clavier : la chaîne pose la bonne typographie à la compilation, dans
la langue déclarée de l’article.

**Votre fichier n’est jamais modifié.** La correction a lieu au moment où le PDF se
fabrique. Le Markdown reste exactement ce que vous avez écrit – lisible, comparable d’une
version à l’autre – et c’est la sortie qui est composée dans les règles.

> Les règles viennent du *Guide du typographe*, le code romand publié par le Groupe de
> Lausanne de l’Association suisse des typographes, confronté aux 421 articles déjà
> publiés sur ojs.szh.ch. Le détail des mesures est dans [TYPOGRAPHIE.md](TYPOGRAPHIE.md).

---

## Les règles

Chaque règle porte un code. Il sert à en parler sans la décrire, et c’est celui qu’affiche
`python3 test/typo-check.py --liste`.

### A – Apostrophes et guillemets

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **A1** | `l'enfant d'ici` | l’enfant d’ici |
| **A2** | `"une citation"` | «&nbsp;une citation&nbsp;» |
| **A3** | `"un 'mot' cité"` | «&nbsp;un ‹&nbsp;mot&nbsp;› cité&nbsp;» |
| **A4** | `L'Ecole inclusive`, `A l'heure actuelle` | L’École inclusive, À l’heure actuelle |
| **A5** | `le coeur de l'oeuvre` | le cœur de l’œuvre |

**A1** – l’apostrophe droite devient l’apostrophe typographique `’` dans toutes les
élisions.

**A2** – les guillemets, quels qu’ils soient (`"`, `“ ”`, `„ “`), deviennent des chevrons
`« »`. C’est le guillemet de la revue, en français comme en allemand.

**A3** – une citation dans une citation prend les chevrons simples `‹ ›`.

**A4** – les capitales s’accentuent, comme le veut le Guide : `Etat` devient `État`,
`Ecole` `École`, `Evaluation` `Évaluation`. C’est important au-delà de la correction : la
rubrique de la couverture et l’en-tête courant sont imprimés en CAPITALES, et un accent qui
manque dans votre texte y est perdu pour de bon.

> Cette correction ne vaut que pour **les titres et les intertitres**. Dans le corps, le
> mot vous est seulement signalé (`C3`), parce que « Education » est aussi le mot juste
> dans un titre d’ouvrage anglais que vous citez.

Le `A` isolé qui est un `À` est corrigé **en début de phrase seulement** : « A l’heure
actuelle » devient « À l’heure actuelle », mais « il va A la maison » reste tel quel –
là, c’est un `à` minuscule qu’il faudrait, et la machine ne peut pas le deviner.

**A5** – les ligatures obligatoires sont posées : `coeur`, `oeuvre`, `soeur`, `voeu`,
`noeud`, `boeuf`, `oeil`, `moeurs`, `foetus`… La liste est fermée, ce qui laisse
tranquilles `coefficient`, `coexister`, `moelle`, `poêle` et `Groenland`, où le o et le e
ne se lient pas.

### E – Espaces

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **E1** | `« mot »` ou `«mot»` | «&nbsp;mot&nbsp;» |
| **E2** | `la suite : ainsi` ou `la suite: ainsi` | la suite&nbsp;: ainsi |
| **E3** | `80 %` ou `80%` | 80&nbsp;% |
| **E4** | `p. ex.`, `p. 202`, `n° 3` | p.&nbsp;ex., p.&nbsp;202, n°&nbsp;3 |
| **E5** | `12 km`, `art. 8`, `Mme Berger`, `4 h 04`, `160 fr.` | 12&nbsp;km, art.&nbsp;8, Mme&nbsp;Berger, 4&nbsp;h&nbsp;04, 160&nbsp;fr. |
| **E6** | `22 255 725 francs` | 22 255 725&nbsp;francs, d’un seul bloc |
| **E7** | `( ci-joint )` | (ci-joint) |
| **E8** | `le mot , puis la suite .` | le mot, puis la suite. |

C’est la famille qui distingue le plus le français de l’allemand : **le français sépare, à
l’espace insécable ; l’allemand colle.** Une espace insécable retient les deux mots
ensemble – le deux-points ne peut pas se retrouver seul en début de ligne.

**E2** vaut pour les quatre signes doubles : `;` `:` `!` `?`. La règle ne s’applique qu’en
fin de mot, ce qui laisse tranquilles `https://…`, `10:30` et les codes.

**E5** retient ensemble ce qui ne doit pas se séparer d’un bout de ligne à l’autre : un
nombre et son unité (`12 km`, `54,5 hectares`, `20 ans`), un renvoi et son numéro
(`art. 8`, `al. 2`, `§ 12`, `fig. 3`, `vol. 17`), une civilité et son nom (`M. Dupont`,
`Mme Berger`, `Dr Meier`), l’initiale d’un prénom (`J.-P. Dupont`), le jour et son mois
(`6 août 2017`), l’heure (`4 h 04`), la monnaie (`160 fr.`, `CHF 499.–`, `25 €`) et le
chiffre romain d’un nom (`Louis XIV`). Cela ne se voit que dans le PDF : c’est là que les
lignes se coupent.

**E6** – un nombre groupé ne se coupe plus jamais en fin de ligne. La chaîne **ne groupe
pas à votre place** : si vous écrivez `35000`, cela reste `35000`. Le groupement est une
décision de rédaction ; nous ne faisons que le protéger.

**E7 et E8** ramassent les espaces en trop : rien à l’intérieur des parenthèses et des
crochets, rien devant une virgule ou un point.

### T – Tirets

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **T1** | `un mot --- une incise --- la suite` | un mot&nbsp;– une incise&nbsp;– la suite |
| **T2** | `pp. 12-25` ou `pp. 12–25` | pp.&nbsp;12-25 |

**T1** – le tiret de la revue est le **demi-cadratin** `–`, jamais le cadratin `—`. Il est
précédé d’une insécable pour qu’il ne commence pas une ligne.

**T2** – en français, une plage de pages s’écrit au **trait d’union** : `pp. 12-25`. C’est
l’usage romand, et il diffère de l’allemand, qui met un demi-cadratin (`S. 12–25`) ; la
chaîne convertit dans les deux sens, vous n’avez donc pas à y penser.

Seules les plages de **pages** sont touchées : c’est le `p.` ou le `pp.` qui les rend
reconnaissables. `2020-2021` et `COVID-19` gardent leur trait d’union.

### S – Signes

| Code | Vous écrivez | Vous obtenez |
|---|---|---|
| **S1** | `et ainsi de suite...` | et ainsi de suite… |
| **S2** | `la 2ème fois` | la 2e fois |
| **S4** | `voir etc.. ici`, `voir etc... ici` | voir etc. ici |

**S2** – la forme correcte est `1er`, `1re`, `2e`, `3e` ; `2ème` est fautif.

**S4** – le point d’abréviation absorbe le point final : `etc..` et `etc...` deviennent
`etc.`. Le Guide ne met jamais de points de suspension derrière une abréviation.

### L – Lignes et coupures

Cette famille ne change pas une lettre de votre texte : elle décide **où les lignes se
coupent**. Elle ne se voit donc que dans le PDF.

| Code | Ce qui est tenu |
|---|---|
| **L1** | un nom propre ne se coupe jamais : ni « Fri-bourg », ni « Mau-roux » |
| **L2** | dans un titre, un déterminant ou une préposition reste avec son mot |
| **L3** | la première ligne du titre de couverture est plus courte que la deuxième |
| **L4** | une coupure de mot laisse au moins trois lettres de chaque côté |

**L2** – c’est la règle qui règle ce défaut :

> les personnes en situation de handicap comme partenaires de
> **formation**

La préposition restait seule en fin de ligne et « formation » se retrouvait seul en
dessous. La coupure se fait maintenant **devant** la préposition :

> les personnes en situation de handicap comme partenaires
> **de formation**

Titres et sous-titres seulement. Dans le corps, souder tous les mots outils d’un paragraphe
justifié creuserait des blancs entre les mots : ce sont les points de coupure qui
permettent au programme de répartir le blanc d’une ligne.

**L3** – l’effet d’escalier. Un titre replié au plus large remplit sa première ligne et
laisse la deuxième presque vide, ce qui déséquilibre la couverture. La composition veut
l’inverse, la ligne courte au-dessus de la longue :

> La participation sociale en classe
> régulière

devient

> La participation
> sociale en classe régulière

La chaîne mesure votre titre dans la police de la couverture pour trouver cette coupure. Si
elle ne trouve pas de solution qui tienne **sans ajouter de ligne**, elle ne fait rien :
mieux vaut la mise en page d’avant qu’un titre tronqué.

**L4** – une coupure de mot ne laisse jamais moins de trois lettres sur la ligne suivante,
comme le veut le code romand. En allemand, la règle n’est pas appliquée : la langue vit de
ses mots composés, et lui retirer des coupures écarterait les mots au lieu de les resserrer.

---

## Ce qui vous est signalé, mais jamais corrigé

Ces deux-là demandent votre jugement : la machine ne peut pas trancher à votre place. Ils
apparaissent dans **Contrôles** après la compilation.

| Code | Ce qui est signalé | Pourquoi vous seul pouvez décider |
|---|---|---|
| **C1** | un `ß` dans un article allemand | « Klauß » n’est pas « Klauss » : un nom propre et une citation gardent leur orthographe |
| **C2** | des guillemets droits `"` non appariés | rien ne dit lequel ouvre et lequel ferme |
| **C3** | une majuscule non accentuée dans le corps (`Etat`, `Ecole`) | « Education » est fautif en français et juste en anglais : vous seul savez si c’est un titre d’ouvrage que vous citez |

---

## Ce à quoi la chaîne ne touche pas

- **Le contenu des `blocs de code`** et des passages entre accents graves. Un chemin, une
  clé, une commande n’ont pas de typographie.
- **Les libellés composés par la maquette** – le `« Figure 1 — Légende »`, le `« Source : »`
  d’un crédit. Ce sont des décisions de composition, pas des fautes de frappe.
- **Les séparateurs de milliers**, les dates et les identifiants. `2026-08-29`,
  `10.57161/r2026-03-01` et `12000` restent tels quels.

---

## Si quelque chose ne va pas

Le résultat se voit dans l’aperçu, à droite de l’éditeur : il passe par les mêmes règles
que le PDF. Si une correction vous paraît fausse, c’est un défaut du filtre et non de votre
texte – signalez-le, avec le code de la règle.

Les règles sont vérifiées à chaque relecture du programme :

```sh
python3 test/typo-articles.py                 # les règles, sur du vrai pandoc
python3 test/typo-check.py                    # les libellés du cockpit
python3 test/metriques-titre.py --verifier    # la mesure du titre suit-elle la police ?
```

Version allemande de cette note : [TYPOGRAPHIE-DE.md](TYPOGRAPHIE-DE.md).
