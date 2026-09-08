# La typographie de la revue

Les règles de composition des deux langues, d’où elles viennent, ce qui les applique et ce
qui les vérifie.

- **[TYPOGRAPHIE-FR.md](TYPOGRAPHIE-FR.md)** et **[TYPOGRAPHIE-DE.md](TYPOGRAPHIE-DE.md)** –
  les mêmes règles écrites pour la rédaction, chacune dans sa langue. C’est ce qu’on donne
  à lire à l’équipe ; cette note-ci est technique.

## En une phrase

Le français et l’allemand suivent des règles **opposées** sur l’espacement : le romand
sépare la ponctuation haute et l’intérieur des guillemets par une insécable, l’allemand
suisse colle tout. Une règle unique appliquée aux deux langues est donc fausse pour l’une
d’elles.

## D’où viennent ces règles

Deux normes, et un corpus qui tranche.

- **Français** – le *Guide du typographe*, publié depuis 1943 par le Groupe de Lausanne de
  l’Association suisse des typographes. C’est le code romand, et il diffère du code
  français : il met une espace fine insécable devant **toutes** les ponctuations doubles,
  deux-points compris, là où la France réserve au deux-points une espace-mot insécable.
- **Allemand** – le Duden et l’usage suisse alémanique. Trois écarts avec l’Allemagne : les
  guillemets sont des chevrons `« »` et non `„ “`, le `ß` s’écrit `ss`, et les nombres se
  groupent à l’apostrophe.
- **Corpus** – les 421 galleys DOCX publiées sur ojs.szh.ch, 2,4 millions de caractères en
  français et 6,1 millions en allemand. Ce sont les fichiers réellement diffusés, pas nos
  sorties : la seule mesure qui ne raisonne pas en rond.

## Les règles

Un code par règle : une lettre de famille, un numéro. Le même code vaut pour l’interface et
pour les articles ; `E1`, `E2` et `T1` portent deux prescriptions inverses selon la langue,
et c’est la langue de l’article qui les départage.

| Code | Règle | Français | Allemand (et italien) |
|---|---|---|---|
| A1 | apostrophe | `’` U+2019 | `’` U+2019 |
| A2 | guillemets, 1er niveau | `« »` | `« »` – jamais `„ “` |
| A3 | guillemets, 2e niveau | `‹ ›` | `‹ ›` |
| A4 | majuscules accentuées | `École`, `À l’heure` – **titres seulement** | – |
| A5 | ligatures | `cœur`, `œuvre`, `vitæ` | – |
| E1 | intérieur des guillemets | insécable | **collé** |
| E2 | avant `;` `:` `!` `?` | insécable | **collé** |
| E3 | avant `%` et `‰` | insécable | insécable |
| E4 | abréviations | `p. ex.`, `p. 202`, `n° 3` | `z. B.`, `d. h.`, `S. 12` |
| E5 | insécables de contexte | `12 km`, `art. 8`, `M. Dupont`, `4 h 04` | `3 Tagen`, `Abb. 4`, `8.30 Uhr` |
| E6 | groupement des nombres | `22 255 725`, à la fine insécable | idem – l’apostrophe suisse ne se coupe pas |
| E7 | intérieur des `( )` et `[ ]` | rien | rien |
| E8 | avant `,` et `.` | rien | rien |
| T1 | tiret d’incise | `–`, **insécable devant** | `–`, espaces simples |
| T2 | plage de pages | `pp. 12-25`, **trait d’union** | `S. 12–25`, **demi-cadratin** |
| S1 | points de suspension | `…` U+2026 | `…` U+2026 |
| S2 | ordinaux | `1er` `1re` `2e` – jamais `2ème` | – |
| S3 | eszett | – | `ss` |
| S4 | point abréviatif final | `etc.` – jamais `etc..` ni `etc…` | `usw.` |
| L1 | noms propres | jamais coupés | – (tout substantif y est capitalisé) |
| L2 | déterminant et préposition | liés à leur mot, **dans les titres** | idem |
| L3 | effet d’escalier | 1re ligne du titre plus courte que la 2e | idem |
| L4 | limites de coupure de mot | `6 3 3` | défaut, `5 2 2` |
| C1 | `ß` dans un article | – | **signalé**, jamais remplacé |
| C2 | guillemets droits non appariés | **signalé** | **signalé** |
| C3 | majuscule non accentuée dans le corps | **signalé** | – |

`S3` corrige l’interface, où il n’y a pas de nom propre ; dans un article c’est `C1` qui
prend le relais, et il se contente de signaler – voir plus bas.

### Les familles ajoutées le 08.09.2026

Six règles neuves, une complétée, une inversée. Ce qui les distingue de `A1`–`S3` : elles
ne se décident pas toutes sur une chaîne de caractères.

**`A4` – les majuscules accentuées, et le seul endroit où le filtre a deux régimes.** Le
Guide accentue les capitales comme les bas de casse, versales comprises. C’est le défaut le
plus coûteux de la chaîne parce qu’il est **irréversible en aval** : `print.css` passe
l’en-tête courant (§2), la rubrique du hero (§5) et le titre d’un encadré (§8) en
`text-transform: uppercase`, et une rubrique tapée « Ecole inclusive » y sort « ECOLE
INCLUSIVE », où plus rien ne laisse deviner l’accent perdu. Mais « Education » est aussi le
mot juste dans *International Journal of Inclusive Education*, qui se cite au fil du texte
et en bibliographie : le lexique **corrige** donc dans les titres et se contente de
**signaler** dans le corps (`C3`). Le « A » isolé qui est un « À » se corrige partout, mais
**en ouverture de phrase seulement** – au milieu d’une phrase, un « A » capital est un « à »
minuscule, et poser la capitale accentuée aggraverait la faute au lieu de la corriger.

**`A5` – les ligatures, sur une liste fermée.** C’est la liste qui rend la règle sûre :
`coefficient`, `coexister`, `moelle`, `poêle`, `Groenland` et `goéland` n’y figurent pas et
ne bougent pas. Chaque entrée est une suite de lettres qui n’apparaît dans aucune autre
famille de mots que la sienne, ce qui permet de la corriger n’importe où dans le mot sans
avoir à énumérer les formes fléchies.

**`E5` à `E8` – les règles de jetons.** Un « jeton » est un mot avec la ponctuation qui y
est collée : « art. », « 12 », « km », « (ci-joint) ». Ces quatre règles ne regardent jamais
plus que le jeton de gauche et celui de droite, et c’est ce qui leur permet de servir aux
**deux mécaniques** du filtre sans être écrites deux fois : la chaîne entière – une
MetaString, le texte d’un tableau réinjecté – et la liste d’inlines, où l’espace est un
élément et non un caractère. `E5` couvre les unités abrégées et écrites en mots, les
renvois normatifs (`art.`, `al.`, `§`, `Abb.`, `Kap.`), les civilités, les initiales de
prénom, le jour et son mois, l’heure, la monnaie et le chiffre romain qui suit un nom.

**`E6` ne convertit pas, il protège.** `35000` ne devient pas `35 000` : ce serait changer
le texte, et c’est une décision de rédaction. La règle rend seulement insécable ce que la
rédaction a déjà groupé – un `22 255 725` coupé en fin de ligne cesse d’être un nombre. Le
séparateur devient une **fine** insécable U+202F et non une insécable ordinaire : c’est la
seule des règles où la finesse est dans la source, parce qu’un blanc de mot entre deux
tranches de trois chiffres se lit comme deux nombres. La face livrée la porte – la preuve
en est le « Source&#8239;: » que `szh-numerotation.lua` imprime depuis des mois.

**`L` – la famille des lignes.** Trois règles de composition et une de coupure, demandées
le 08.09.2026. `L1` existait déjà sans porter de code : c’est `szh-cesure.lua`. `L2` soude
les mots outils **dans les titres seulement** – dans le corps, souder tous les déterminants
d’un paragraphe justifié fabriquerait des lézardes, le nombre de points de coupure étant ce
qui permet à WeasyPrint de répartir le blanc. `L3` demande une mesure, et a donc son propre
filtre (voir plus bas). `L4` est du CSS.

### `T2`, la règle inversée

Le référentiel suisse qui décline le Guide – *Règles typographiques*, Schule für Gestaltung
Zürich, 2018, § trait d’union – donne le trait d’union comme « bis-Strich » romand : « le
trait d’union est utilisé en Suisse romande entre les chiffres », avec `4-47`, `2015-2018`,
`16.12.2017-20.1.2018`. Le Duden, lui, veut le demi-cadratin. `T2` porte donc **deux
prescriptions inverses**, comme `E1`, `E2` et `T1`, et convertit dans les deux sens : ce que
la rédaction a tapé ne décide pas.

⚠ Cette inversion n’a **pas** été mesurée sur le corpus, faute d’accès aux galleys au
moment de la décision – c’est la seule règle de cette note qui repose sur un référentiel
seul. La mesure qui trancherait pour de bon, à lancer sur les 421 galleys :

```sh
# part des plages de pages au trait d'union contre le demi-cadratin, par langue
grep -ohE '(pp?|S)\. ?[0-9]+[-–][0-9]+' *.txt | grep -c '–'
```

## Ce que dit le corpus

Part des occurrences déjà conformes dans ce qui est publié. Les règles n’ont pas été
choisies pour coller à ces chiffres : ce sont les chiffres qui disent si la norme est
vraiment la pratique de la maison.

| Règle | Français | Allemand |
|---|---|---|
| apostrophe courbe | 94,6 % (16 994 / 17 955) | 94 % du texte allemand¹ |
| guillemets `« »` | 97,7 % (1 037 / 1 061) | 99,5 % (3 022 / 3 037) |
| espacement des guillemets | 96,3 % **avec** insécable | 96,1 % **sans** espace |
| ponctuation haute | 83,8 % **avec** espace | 99,0 % **sans** espace |
| espace avant `%` | 89,6 % | 66,2 % |
| incise au demi-cadratin | 99,9 % (852 / 853) | 100 % (2 418 / 2 418) |
| cadratin `—` | **5** sur 2,4 M caractères | **0** sur 6,1 M |
| `…` en un seul signe | 97,1 % | 95,4 % |
| `ß` | – | 143, dans 62 fichiers sur 316² |
| abréviation à l’insécable | 70,5 % (`p. ex.`) | 97,2 % (`z. B.`) |

¹ Le corpus allemand contient 869 apostrophes droites, mais 800 d’entre elles (92 %) sont
des élisions françaises : les galleys allemandes portent les résumés en français. Hors ces
résumés, l’allemand publié est à `’` comme le français.

² Le `ß` n’est donc pas une exception de citation mais une **fuite éditoriale** : des
articles d’autrices et d’auteurs d’Allemagne publiés tels quels. La règle maison reste
`ss`.

## Les deux points où la norme et l’usage divergent

**L’espace fine insécable.** Le Guide du typographe prescrit `U+202F` devant la ponctuation
haute et dans les guillemets. Le corpus en compte **9 en français et 23 en allemand**,
contre 11 383 et 7 038 espaces insécables ordinaires : Word ne la produit pas sans geste
délibéré, et les navigateurs la rendent inégalement – le Typoguide romand le reconnaît
lui-même et y renonce pour sa version en ligne. **Le programme écrit donc `U+00A0`.** La
finesse est une affaire de rendu, pas de source : c’est à la composition de resserrer une
insécable devant un deux-points, et c’est ce que fait `szh-numerotation.lua` pour le
« Source&#8239;: » d’un crédit. Une fine déjà posée est d’ailleurs **conservée** par le
filtre des articles : elle satisfait la règle aussi bien que l’insécable ordinaire.

**Le cadratin.** Les résumés moissonnés par OAI-PMH sur ojs.szh.ch donnent 409
demi-cadratins et zéro cadratin ; nos propres sorties converties donnaient l’inverse. Ce
sont les galleys qui tranchent, et elles sont sans appel : **5 cadratins en 2,4 M
caractères de français, tous dans des titres bibliographiques anglais, et zéro en 6,1 M de
caractères d’allemand**. Le cadratin n’est pas la convention maison ; il ne l’a jamais été.
La mesure précédente lisait nos propres fichiers et confirmait donc notre propre habitude.

## Les quatre applications

Les mêmes règles, quatre endroits. Le filtre des articles porte la plus grande part ; `L3`
a besoin de mesurer et vit donc à part, `L4` est du CSS, et l’interface du cockpit a sa
propre porte.

### Le texte des articles – `pipeline/filters/szh-typographie.lua`

Branché dans la chaîne de compilation **et** dans celle de l’aperçu, entre
`szh-tabelle-scope` et `szh-grille`.

**Le `.md` n’est jamais réécrit.** La normalisation a lieu sur l’arbre pandoc, au moment où
le PDF se fabrique : la source reste ce que la rédaction a tapé, lisible et comparable d’une
version à l’autre, et c’est la sortie qui est composée. Semer des insécables et des chevrons
dans le Markdown le rendrait pénible à relire pour un gain nul – personne ne lit le
Markdown, tout le monde lit le PDF.

Sa place dans la chaîne n’est pas indifférente :

- **après `szh-tabelle-inclure`**, sinon le texte des tableaux – réinjecté en `RawBlock`
  html – lui échapperait entièrement. Il le traverse à la main, en ne touchant qu’entre les
  balises, jamais un attribut ni un commentaire ;
- **avant `szh-numerotation`**, parce qu’il ne normalise que le texte de la rédaction. Le
  `« Figure 1 — Légende »` et le `« Source : »` que la maquette compose ensuite sont des
  décisions de composition, pas des fautes de frappe, et lui passer dessus les déferait.

Il normalise aussi une liste blanche de métadonnées – `title`, `subtitle`, `pagetitle`,
`description`, `resumes`, `licence-texte`, et par auteur `fonction` et `affiliation` –,
celles qui partent dans la couverture et dans les métadonnées du PDF. Un DOI, une URL, une
classe CSS n’ont pas de typographie et n’y figurent pas. Depuis le 08.09.2026 la liste
compte deux clés de plus, `titre-affiche` et `sous-titre-affiche`, et quatre d’entre elles
reçoivent en outre les règles de titre (`A4`, `L2`) : les deux précédentes et `title`,
`subtitle`.

⚠ **Ces deux clés manquaient, et la couverture n’avait donc AUCUNE typographie** jusque-là :
ni insécable devant un deux-points, ni chevron, ni ligature. Deux causes superposées, dont
chacune suffisait. `szh-maquette.lua` pose `titre-affiche` **avant** ce filtre, en
`pandoc.MetaString`, à partir de `title` : normaliser `title` seul ne touchait pas la copie
que le gabarit imprime. Et une `MetaString` arrive dans un filtre Lua en **chaîne nue**,
sans champ `.t` : le test de type de `normaliser_valeur_meta` ne mordait donc jamais, en
silence, une chaîne Lua rendant `nil` pour n’importe quel champ. Le défaut se lisait dans
le PDF du 08.09.2026 : « … comme partenaires de / formation », préposition en fin de ligne
et mot seul en dessous, ce que `L2` corrige maintenant.

Ce qu’il **ne corrige pas**, et pourquoi :

- **`C1` – le `ß`.** « Klauß » n’est pas « Klauss », et une citation d’un ouvrage allemand
  garde son orthographe. Le filtre le signale et laisse trancher ;
- **`C2` – les guillemets droits** que pandoc n’a pas su apparier : les remplacer au jugé
  ouvrirait ou fermerait au hasard ;
- **les plages de nombres** en général. Seules les plages de **pages** passent au
  demi-cadratin, reconnaissables à leur `p.` ou `S.` : hors de ce contexte, `2020-2021` peut
  être un exercice, `COVID-19` un nom, `2026-08-29` une date ;
- **le contenu des `code`** et des blocs de code, jamais touché ;
- **`C3` – une majuscule non accentuée dans le CORPS.** « Education » est fautif en
  français et juste en anglais, et le corps d’un article porte des titres d’ouvrages dans
  les deux langues. Corrigé dans les titres, signalé ici ;
- **le groupement d’un nombre qui n’en a pas.** `35000` ne devient pas `35 000` : `E6`
  protège ce que la rédaction a groupé, il ne groupe pas à sa place ;
- **un « A » capital au milieu d’une phrase.** C’est un « à » minuscule, pas un « À » : le
  filtre ne peut pas le distinguer d’un intitulé (« variante A la plus courte »).

Les constats `C1`, `C2` et `C3` partent sur le journal au format que `lib/journal.js`
découpe déjà, sous la famille `typo`, **une ligne par code et non par occurrence**. `C3` se
cherche en fin de course, sur le document déjà transformé : les titres y sont corrigés, et
ce qui subsiste est donc exactement ce que le filtre a laissé.


### Le titre de couverture – `pipeline/filters/szh-titre-lignes.lua`

`L3` demande que la première ligne du titre soit plus courte que la deuxième. Aucune
propriété CSS ne le dit : `text-wrap: balance` égaliserait les lignes, et WeasyPrint 69 ne
l’a pas. Un flottant posé en `::before` pour raccourcir la première ligne risquerait
d’**ajouter une ligne** au titre – or `.szh-hero-main` est en `max-height: 164px;
overflow: hidden` et tronquerait le débordement **sans bruit**. Il faut donc savoir où le
titre se replie, c’est-à-dire mesurer du texte, ce qu’un filtre pandoc ne sait pas faire.

D’où deux fichiers de plus :

- **`test/metriques-titre.py`** lit les largeurs d’avance de la face qui compose le titre
  (`OpenSans-SemiCondensed-SemiBold.ttf`, le poids 600 de `.szh-title`) et les dépose dans
  `pipeline/filters/szh-titre-metriques.lua`. Sans dépendance : ni fontTools ni WeasyPrint,
  seulement `struct` et trois tables du format TrueType – c’est ce script qui garantit que
  la table suit la police, il doit donc pouvoir se relancer partout. `--verifier` refuse en
  silence de réécrire et sort 1 si la table a divergé.
- **`szh-titre-lignes.lua`** replie le titre comme le fait Pango – au premier point de
  coupure qui déborde, et non par équilibrage global – puis cherche la coupure qui met la
  couverture en escalier. Il n’écrit rien dans `titre-affiche` mais dans une clé neuve,
  `titre-lignes`, que le gabarit préfère quand elle existe : `titre-affiche` part aussi
  dans le `<title>` de la page et le `/Title` du PDF, où un `<br>` n’aurait aucun sens.

**Les quatre conditions, et l’abstention.** Une coupure n’est posée que si le titre se
replie déjà sur deux lignes au moins, que la première ligne proposée est plus courte que la
deuxième, que le **nombre total de lignes ne change pas** – c’est ce qui interdit la
troncature silencieuse – et que chaque ligne reste sous 98 % de la colonne, marge qui
absorbe ce que le modèle ne calcule pas (le crénage, environ 0,5 %). Faute de quoi le
filtre ne fait rien et WeasyPrint replie comme avant.

**Ce qui a été mesuré (08.09.2026).** Le modèle a été confronté à quatre titres réellement
rendus, en relevant leurs coupures dans les PDF par `pdftotext -layout` :

| Titre rendu | Coupure du PDF | Modèle |
|---|---|---|
| Développer ses compétences relationnelles grâce au handicap | après « compétences » | idem, 304,3 px puis 340,5 px |
| La participation sociale en classe régulière | après « classe » | idem, à 6 px du seuil (1,4 %) |
| Testartikel zur Prüfung der Seitenumbrüche | après « der » | idem |
| Erfahrungen von Schülerinnen und Schülern in inklusiven Klassen | après « und » | idem |

Le troisième cas est le plus instructif : ajouter « régulière » ferait 441,4 px pour une
colonne de 435,3 px, et le vrai moteur coupe donc au même mot que le modèle. La largeur de
colonne et les métriques sont ainsi justes à mieux que 1,5 %.

**Le hero, et lui seul.** Le sous-titre reçoit `L2` mais pas `L3` : la règle demandée porte
sur le titre. Les livres n’ont pas de hero et le filtre n’est pas dans `profils/livre.mk`.

### La maquette – `pipeline/styles/print.css`

`L4` est la seule règle qui ne soit pas dans un filtre : les limites de coupure de mot sont
une propriété héritée, posée sur `<html>`.

```css
html:lang(fr) { hyphenate-limit-chars: 6 3 3; }
```

Le code romand veut au moins deux lettres avant la coupure et **trois** reportées – « on ne
renvoie pas moins de trois lettres » – là où le défaut de WeasyPrint 69 est (5, 2, 2).
`6 3 3` est la variante de texte soigné.

⚠ **Pas en allemand, et ce n’est pas un oubli** : la langue vit de ses composés, et lui
retirer des points de coupure élargirait les blancs d’une ligne justifiée au lieu de les
resserrer. Le défaut y reste en vigueur.

Deux règles du Guide restent **inatteignables**, et autant le savoir : « pas plus de trois
coupures consécutives » (`hyphenate-limit-lines` n’existe pas dans WeasyPrint) et « pas de
coupure sur la dernière ligne d’une page » (aucune propriété CSS ne l’exprime).

### L’interface du cockpit – `test/typo-check.py`

Les libellés que l’équipe lit à l’écran : `lib/i18n.js`, `package.nls*.json`,
`package.json`, la table `$SzhTextes` de `windows/szh-common.ps1`, les blocs de langue des
filtres Lua, les libellés bilingues de `lib/articles.js` et `lib/yaml.js`,
`revue-template/`, `userdoc.md` et les trois notes de typographie.

`--corriger` applique les corrections sûres, `--liste` montre les règles.

**Volontairement hors contrôle :**

- **Les commentaires de code.** Ils emploient l’apostrophe droite et le cadratin partout ;
  c’est la convention du dépôt, délibérée, et elle ne se lit nulle part hors du code.
- **Les clés d’OJS.** `genreFichier: "Texte de l'article"` dans `lib/export-ojs.js` n’est pas
  de la prose mais une valeur relevée dans OJS et comparée telle quelle à l’import.
- **Les marqueurs de conflit** de `lib/copies-conflit.js` (`copie en conflit`,
  `konfliktkopie`…) : ce sont des motifs de reconnaissance de noms de fichiers.
- **L’anglais** de `$SzhTextes`, repli des raccourcis Windows, où seul l’ASCII compte.

**Une prose visible ne doit pas vivre ailleurs que dans `i18n.js`.** Une seule exception
subsiste, l’en-tête du sidecar de traduction dans `lib/traduction.js` : elle a été corrigée
à la main et échappe au contrôle.

⚠ **Les règles du 08.09.2026 ne sont PAS ici.** `A4`, `A5`, `E5` à `E8`, `S4` et la famille
`L` ne valent que pour les articles ; l’interface en reste à `A1`–`T2`. La raison est que
les deux applications ne composent pas la même chose : un libellé de bouton n’a ni plage de
pages, ni renvoi normatif, ni titre à mettre en escalier, et ses quelques mots sont relus à
la main. Les deux qui auraient un sens à l’écran – `A4` et `A5` – porteraient sur des
chaînes déjà conformes, et `--corriger` toucherait alors à `windows/*.ps1`, où l’apostrophe
courbe est un piège documenté plus bas. À reprendre le jour où un libellé fautif apparaît,
pas avant.

## Comment on vérifie

```sh
python3 test/typo-articles.py                 # les règles sur du vrai pandoc, hero compris
python3 test/typo-check.py                    # A1 à T2 sur l'interface du cockpit
python3 test/metriques-titre.py --verifier    # la table de largeurs suit-elle la police ?
```

`typo-articles.py` a besoin de pandoc et le dit s’il ne le trouve pas, plutôt que de faire
croire que les règles sont vérifiées. Ses cas couvrent aussi ce qui doit **rester
immobile** : une URL, une heure, une date ISO, un DOI, un `COVID-19`, un bloc de code, et
la fine insécable que la maquette a posée. Depuis le 08.09.2026 il porte une seconde table,
`CAS_TITRE`, qui compose le titre et le sous-titre de couverture par les DEUX filtres et
vérifie l’escalier : le hero ne passe pas par le même chemin que le corps, et une règle
vraie dans un paragraphe pouvait être fausse sur la couverture – elle l’a été.

`metriques-titre.py --verifier` est la porte de `L3` : si la face du titre change sans que
la table soit relancée, l’escalier tomberait à côté. Il ne réécrit rien et sort 1.

## Piège à ne pas rouvrir

Windows PowerShell 5.1 traite `’` comme un **délimiteur de chaîne**, au même titre que
l’apostrophe droite : `'Mise à jour de l’outil'` ne compile pas. Elle doit être **doublée**
dans le fichier – `'l’’outil'` –, et `typo-check.py` le fait pour vous. Toute retouche
manuelle de `windows/*.ps1` se revérifie au parseur :
`[System.Management.Automation.Language.Parser]::ParseFile`.
