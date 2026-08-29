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
| E1 | intérieur des guillemets | insécable | **collé** |
| E2 | avant `;` `:` `!` `?` | insécable | **collé** |
| E3 | avant `%` | insécable | insécable |
| E4 | abréviations | `p. ex.`, `p. 202`, `n° 3` | `z. B.`, `d. h.`, `S. 12` |
| T1 | tiret d’incise | `–`, **insécable devant** | `–`, espaces simples |
| T2 | plage de pages | `pp. 12–25` | `S. 12–25` |
| S1 | points de suspension | `…` U+2026 | `…` U+2026 |
| S2 | ordinaux | `1er` `1re` `2e` – jamais `2ème` | – |
| S3 | eszett | – | `ss` |
| C1 | `ß` dans un article | – | **signalé**, jamais remplacé |
| C2 | guillemets droits non appariés | **signalé** | **signalé** |

`S3` corrige l’interface, où il n’y a pas de nom propre ; dans un article c’est `C1` qui
prend le relais, et il se contente de signaler – voir plus bas.

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

## Les deux applications

Les mêmes règles, deux endroits, deux mécaniques.

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
classe CSS n’ont pas de typographie et n’y figurent pas.

Ce qu’il **ne corrige pas**, et pourquoi :

- **`C1` – le `ß`.** « Klauß » n’est pas « Klauss », et une citation d’un ouvrage allemand
  garde son orthographe. Le filtre le signale et laisse trancher ;
- **`C2` – les guillemets droits** que pandoc n’a pas su apparier : les remplacer au jugé
  ouvrirait ou fermerait au hasard ;
- **les plages de nombres** en général. Seules les plages de **pages** passent au
  demi-cadratin, reconnaissables à leur `p.` ou `S.` : hors de ce contexte, `2020-2021` peut
  être un exercice, `COVID-19` un nom, `2026-08-29` une date ;
- **le contenu des `code`** et des blocs de code, jamais touché.

Les constats `C1` et `C2` partent sur le journal au format que `lib/journal.js` découpe
déjà, sous la famille `typo`, **une ligne par code et non par occurrence**.

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

## Comment on vérifie

```sh
python3 test/typo-articles.py   # les règles sur du vrai pandoc
python3 test/typo-check.py      # les mêmes règles sur l'interface du cockpit
```

`typo-articles.py` a besoin de pandoc et le dit s’il ne le trouve pas, plutôt que de faire
croire que les règles sont vérifiées. Ses cas couvrent aussi ce qui doit **rester
immobile** : une URL, une heure, une date ISO, un DOI, un `COVID-19`, un bloc de code, et
la fine insécable que la maquette a posée.

## Piège à ne pas rouvrir

Windows PowerShell 5.1 traite `’` comme un **délimiteur de chaîne**, au même titre que
l’apostrophe droite : `'Mise à jour de l’outil'` ne compile pas. Elle doit être **doublée**
dans le fichier – `'l’’outil'` –, et `typo-check.py` le fait pour vous. Toute retouche
manuelle de `windows/*.ps1` se revérifie au parseur :
`[System.Management.Automation.Language.Parser]::ParseFile`.
