# Typographie maison

Cette page décrit, pour les développeurs, les règles typographiques de Pronto : leur code,
ce qu’elles font dans chaque langue, le code qui les applique et les tests qui les
vérifient.

Les mêmes règles sont écrites pour les rédactions dans [TYPOGRAPHIE-FR.md](TYPOGRAPHIE-FR.md)
et [TYPOGRAPHIE-DE.md](TYPOGRAPHIE-DE.md), chacune dans sa langue. Les codes de règle y sont
les mêmes.

## Le principe

Le français et l’allemand suivent des règles opposées sur l’espacement. Le français de Suisse
romande sépare la ponctuation haute et l’intérieur des guillemets par une espace insécable ;
l’allemand suisse colle tout. L’italien suit l’allemand. Une règle unique serait donc fausse
pour l’une des langues : c’est la langue du passage qui choisit la règle.

Les sources :

- **français** : le *Guide du typographe* du Groupe de Lausanne de l’Association suisse des
  typographes. Il met une espace devant toutes les ponctuations doubles, deux-points compris ;
- **allemand** : le Duden et l’usage suisse alémanique. Les guillemets sont des chevrons
  `« »` et non `„ “`, le `ß` s’écrit `ss`, les nombres se groupent à l’apostrophe ;
- **plages de pages en français** : *Règles typographiques* (Schule für Gestaltung Zürich),
  qui donne le trait d’union entre chiffres pour la Suisse romande.

## Les règles

Un code par règle : une lettre de famille, un numéro. `E1`, `E2`, `T1` et `T2` portent deux
prescriptions inverses selon la langue.

| Code | Règle | Français | Allemand (et italien) |
|---|---|---|---|
| A1 | apostrophe | `’` U+2019 | `’` U+2019 |
| A2 | guillemets, 1er niveau | `« »` | `« »`, jamais `„ “` |
| A3 | guillemets, 2e niveau | `‹ ›` | `‹ ›` |
| A4 | majuscules accentuées | `École`, `À l’heure`, dans les titres | – |
| A5 | ligatures | `cœur`, `œuvre`, `vitæ` | – |
| E1 | intérieur des guillemets | insécable | collé |
| E2 | avant `;` `:` `!` `?` | insécable | collé |
| E3 | avant `%` et `‰` | insécable | insécable |
| E4 | abréviations | `p. ex.`, `p. 202`, `n° 3` | `z. B.`, `d. h.`, `S. 12` |
| E5 | insécables de contexte | `12 km`, `art. 8`, `M. Dupont`, `4 h 04` | `3 Tagen`, `Abb. 4`, `8.30 Uhr` |
| E6 | groupement des nombres | `22 255 725`, à la fine insécable | rien à faire : l’apostrophe ne se coupe pas |
| E7 | intérieur des `( )` et `[ ]` | rien | rien |
| E8 | avant `,` et `.` | rien | rien |
| E9 | ordinal en tête de cellule de tableau | `1. Étape` insécable | `1. Hilfe` insécable |
| T1 | tiret d’incise | `–`, insécable devant | `–`, espaces simples |
| T2 | plage de pages | `pp. 12-25`, trait d’union | `S. 12–25`, demi-cadratin |
| S1 | points de suspension | `…` U+2026 | `…` U+2026 |
| S2 | ordinaux | `1er` `1re` `2e`, jamais `2ème` | – |
| S3 | eszett (interface seulement) | – | `ss` |
| S4 | point abréviatif final | `etc.`, jamais `etc..` ni `etc…` | `usw.` |
| L1 | noms propres | jamais coupés | – |
| L2 | déterminant et préposition | liés à leur mot, dans les titres | idem |
| L3 | effet d’escalier | 1re ligne du titre de couverture plus courte que la 2e | idem |
| L4 | limites de coupure de mot | `6 3 3` | défaut de WeasyPrint |
| C1 | `ß` dans un article | – | signalé, jamais remplacé |
| C2 | guillemets droits non appariés | signalé | signalé |
| C3 | majuscule non accentuée dans le corps | signalé | – |

Deux choix valent pour toutes les règles :

- **L’insécable écrite est U+00A0**, et non la fine U+202F que prescrit le Guide : Word ne
  produit pas la fine, et les navigateurs la rendent inégalement. Une fine déjà présente est
  conservée, car elle satisfait la règle. Seul `E6` écrit une fine, parce qu’un blanc
  ordinaire entre deux tranches de chiffres se lit comme deux nombres.
- **Pas de cadratin** `—` dans le texte de la rédaction, dans aucune langue : le tiret
  maison est le demi-cadratin `–`. Seule la maquette en compose un, dans le préfixe des
  légendes (`Figure 1 —`).

### Précisions par règle

**A4.** Le Guide accentue les capitales. `print.css` passe l’en-tête courant, la rubrique de
la couverture et le titre d’un encadré en `text-transform: uppercase` : un accent qui manque
dans la source y est perdu. Mais « Education » est juste dans un titre d’ouvrage anglais
cité. Le filtre corrige donc dans les titres et ne fait que signaler dans le corps (`C3`).
Un « A » isolé n’est corrigé en « À » qu’en début de phrase : au milieu d’une phrase, c’est
un « à » minuscule qu’il faudrait, et le filtre ne le distingue pas d’un intitulé
(« variante A la plus courte »).

**A5.** La liste des ligatures est fermée. `coefficient`, `coexister`, `moelle`, `poêle`,
`Groenland` et `goéland` n’y figurent pas et ne bougent pas. Chaque entrée est une suite de
lettres propre à sa famille de mots, ce qui permet de la corriger n’importe où dans le mot.

**E5 à E8.** Ces règles regardent un mot avec sa ponctuation collée (« art. », « 12 »,
« km », « (ci-joint) ») et ses deux voisins, rien de plus. C’est ce qui permet de les écrire
une seule fois pour les deux cas du filtre : une chaîne entière (une métadonnée, le HTML d’un
tableau) et une liste d’éléments pandoc, où l’espace est un élément. `E5` couvre les unités
abrégées ou en toutes lettres, les renvois (`art.`, `al.`, `§`, `Abb.`, `Kap.`), les
civilités, les initiales de prénom, le jour et son mois, l’heure, la monnaie et le chiffre
romain qui suit un nom.

**E6.** La règle protège un nombre déjà groupé ; elle ne groupe pas. `35000` reste `35000`.

**E9.** Seul le premier texte d’une cellule `<td>` ou `<th>` est concerné. Dans un
paragraphe, « en 2021. Ensuite » n’est jamais soudé.

**T2.** Seules les plages de pages, reconnues à leur `p.`, `pp.` ou `S.`, sont converties,
dans les deux sens. `2020-2021`, `COVID-19` ou `2026-08-29` ne bougent pas.

**L2.** Titres et sous-titres seulement. Dans un paragraphe justifié, souder tous les mots
outils retirerait les points de coupure qui permettent de répartir le blanc.

**L1 et L4.** Français seulement. En allemand, tout substantif porte une majuscule : la
reconnaissance des noms propres y prendrait la moitié du texte. Et retirer des points de
coupure à une langue de mots composés élargirait les blancs.

## Où les règles s’appliquent

| Où | Règles | Code |
|---|---|---|
| texte des articles et des chapitres | A, E, T, S1, S2, S4, L2, C | `pipeline/filters/szh-typographie.lua` |
| noms propres sans césure | L1 | `pipeline/filters/szh-cesure.lua` |
| titre de couverture en escalier | L3 | `pipeline/filters/szh-titre-lignes.lua` |
| limites de coupure | L4 | `pipeline/styles/print.css` |
| libellés de l’interface et documents de la rédaction | A1, A2, E1 à E4, T1, S1 à S3 | `test/typo-check.py` |

### Le texte des articles : `szh-typographie.lua`

Le filtre tourne dans la chaîne de compilation et dans celle de l’aperçu, après
`szh-tabelle-scope` et avant `szh-titre-lignes` (`pipeline/filtres.mk`). Les langues
traitées sont `fr`, `de` et `it` ; un passage dans une autre langue (`lang=en`) n’est pas
touché. Un résumé se compose dans sa propre langue.

Le fichier `.md` n’est jamais réécrit. La typographie est posée sur l’arbre pandoc, à la
compilation : la source reste ce que la rédaction a tapé, et c’est la sortie (PDF, HTML,
galley Word) qui est composée.

Sa place dans la chaîne compte :

- **après `szh-tabelle-inclure`**, sinon le texte des tableaux, réinjecté en HTML brut, lui
  échapperait. Il le traverse en ne touchant qu’au texte entre les balises, jamais à un
  attribut ni à un commentaire ;
- **avant `szh-numerotation`**, parce qu’il ne traite que le texte de la rédaction. Le
  préfixe `Figure 1 —` et le `Source :` que la maquette compose ensuite ne doivent pas être
  modifiés.

Il traite aussi une liste de métadonnées, celles qui partent sur la couverture et dans les
propriétés du PDF :

- texte : `pagetitle`, `description`, `licence-texte`, les résumés (`resumes`), et par
  auteur `fonction` et `affiliation` ;
- titres, qui reçoivent en plus `A4` et `L2` : `title`, `subtitle`, `titre-affiche`,
  `sous-titre-affiche`.

`titre-affiche` et `sous-titre-affiche` sont posés par `szh-maquette.lua` avant ce filtre :
ce sont eux que la couverture imprime. Une `MetaString` arrive dans un filtre Lua en chaîne
nue, sans champ `.t` : le filtre teste donc le type Lua avant le type pandoc.

Ce qu’il ne corrige pas :

| Cas | Pourquoi |
|---|---|
| `ß` (`C1`) | « Klauß » n’est pas « Klauss », et une citation garde son orthographe |
| guillemets droits non appariés (`C2`) | rien ne dit lequel ouvre et lequel ferme |
| majuscule non accentuée dans le corps (`C3`) | « Education » est juste en anglais |
| plages de nombres autres que des pages | `2020-2021`, `COVID-19`, une date ISO |
| contenu des `code` et des blocs de code | un chemin ou une commande n’a pas de typographie |

Les messages `C1`, `C2` et `C3` partent au journal sous la famille `typo`, une ligne par code
et non par occurrence. `C3` est cherché en fin de passe, sur le document déjà transformé :
il ne reste que ce que le filtre a laissé.

### Le titre de couverture : `szh-titre-lignes.lua`

`L3` veut une première ligne plus courte que la deuxième. Aucune propriété CSS ne le dit
(`text-wrap: balance` égaliserait les lignes, et WeasyPrint ne l’a pas). Un artifice CSS
risquerait d’ajouter une ligne, que `.szh-hero-main` (`max-height: 164px`,
`overflow: hidden`) couperait sans rien dire. Le filtre mesure donc le texte.

- `test/metriques-titre.py` lit les largeurs des caractères de la police du titre
  (`pipeline/fonts/OpenSans-SemiCondensed-SemiBold.ttf`) et les écrit dans
  `pipeline/filters/szh-titre-metriques.lua`. Il n’a pas de dépendance (seulement `struct`
  et trois tables TrueType). `--verifier` ne réécrit rien et sort en 1 si la table ne
  correspond plus à la police.
- `szh-titre-lignes.lua` replie le titre comme WeasyPrint (au premier point de coupure qui
  déborde), puis cherche la coupure en escalier. Il écrit le résultat dans la clé
  `titre-lignes`, que le gabarit `szh-article.html` préfère quand elle existe ;
  `titre-affiche` sert aussi au `<title>` et au `/Title` du PDF, où un `<br>` n’a pas de
  sens.

Une coupure n’est posée que si les quatre conditions sont réunies :

1. le titre se replie déjà sur au moins deux lignes ;
2. la première ligne proposée est plus courte que la deuxième ;
3. le nombre total de lignes ne change pas ;
4. chaque ligne reste sous 98 % de la colonne (marge pour le crénage, que le modèle ne
   calcule pas).

Sinon le filtre ne fait rien, et WeasyPrint replie le titre lui-même. Le sous-titre reçoit
`L2` mais pas `L3`. Les livres n’ont pas de couverture d’article : le filtre n’est pas dans
leur chaîne.

### La maquette : `print.css`

`L4` est une propriété héritée, posée sur `<html>` :

```css
html:lang(fr) { hyphenate-limit-chars: 6 3 3; }
```

Un mot de six lettres au moins, trois de chaque côté de la coupure. En allemand, le défaut
de WeasyPrint (5 2 2) reste en vigueur. Dans les cellules de tableau, `6 3 3` vaut pour
toutes les langues (`th, td`), pour qu’une colonne d’étiquettes ne s’écrase pas.

Le Guide demande aussi pas plus de trois lignes coupées de suite, et pas de coupure sur la
dernière ligne d’une page. WeasyPrint n’a pas de propriété pour cela
(`hyphenate-limit-lines` n’existe pas). Une zone de césure les tient indirectement, toutes
langues confondues :

```css
p, li { hyphenate-limit-zone: 10%; }
```

Une ligne ne se coupe que si le blanc laissé en bout de ligne dépasse 10 % de sa largeur ;
sinon les espaces s’étirent. Ce n’est pas une garantie : un article long peut encore sortir
des deux règles. `test/composition-check.py` les mesure (césures, suites de lignes coupées,
coupures en bas de page, blanc par espace) ; il se lance avec
`/opt/weasyprint/bin/python`. Ce réglage se mesure sur les articles réels de
`test/composition/`, pas sur les articles courts de `test/articles/`.

### L’interface : `test/typo-check.py`

Le script contrôle les textes que l’équipe et les lecteurs voient : `lib/i18n.js`,
`package.nls*.json`, `package.json`, `windows/szh-textes.ps1`, les libellés bilingues de
`lib/articles.js` et `lib/yaml.js`, `revue-template/`, `userdoc.md`, `nouveautes.json`, les
trois pages `docs/TYPOGRAPHIE*.md`, les messages des moissonneurs, les blocs de langue des
filtres Lua, les gabarits de courriel et d’export, et les webviews du cockpit. La liste
exacte est `SURFACES`, en tête du script.

Il applique `A1`, `A2`, `E1` à `E4`, `T1` et `S1` à `S3`. Les autres règles ne concernent
que les articles : un libellé de bouton n’a ni plage de pages, ni renvoi, ni titre en
escalier.

Il ne lit pas :

- les commentaires de code, qui gardent l’apostrophe droite ;
- les textes en anglais (repli des raccourcis Windows, gabarits `.en.`) ;
- les fichiers absents de `SURFACES`, par exemple les valeurs OJS de `lib/export-ojs.js`,
  comparées telles quelles à l’import.

Un texte visible par l’équipe va dans `lib/i18n.js`, qui est contrôlé.

## Comment on vérifie

Dans la WSL :

```sh
python3 test/typo-articles.py                 # les règles des articles, sur du vrai pandoc
python3 test/typo-check.py                    # les textes de l’interface
python3 test/typo-check.py --corriger         # applique les corrections sûres
python3 test/typo-check.py --liste            # liste les règles
python3 test/metriques-titre.py --verifier    # la table de largeurs suit-elle la police ?
```

`typo-articles.py` a besoin de pandoc ; sans lui, il le dit et échoue. Ses cas couvrent aussi
ce qui ne doit pas bouger : une URL, une heure, une date ISO, un DOI, `COVID-19`, un bloc de
code, une fine insécable déjà posée. Sa table `CAS_TITRE` compose le titre et le sous-titre
de couverture par `szh-typographie.lua` puis `szh-titre-lignes.lua`, et vérifie l’escalier :
la couverture ne suit pas le même chemin que le corps.

## Piège : l’apostrophe dans PowerShell

Windows PowerShell 5.1 traite `’` comme un délimiteur de chaîne, comme l’apostrophe droite :
`'Mise à jour de l’outil'` ne se compile pas. Dans un `.ps1`, elle est doublée
(`'l’’outil'`), et `typo-check.py --corriger` le fait. Toute retouche manuelle d’un `.ps1` se
revérifie avec `[System.Management.Automation.Language.Parser]::ParseFile()`.
