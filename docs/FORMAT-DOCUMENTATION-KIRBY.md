# Format de la Documentation : bibliothèque de fiches partagée (Kirby)

Source de vérité des champs : pipeline/kirby/champs-documentation.json. Aucune
rétrocompatibilité : l'ancien format (blocs ::: dans documentation.md, fiches rangées dans le
numéro sous `<n>_<slug>/`, réserve `_reserve/`, bouton « Envoyer à l'autre revue ») n'est
plus pris en charge. On supprime, on ne garde pas de repli.

Décisions de Robin (23.09.2026) : les fiches vivent dans `_NewsUndActu\Fiches\`, une seule
bibliothèque pour les deux revues ; une fiche traduite est UN dossier avec deux fichiers de
langue (pas une copie) ; chaque fichier de langue dit à quel numéro il appartient ; les
rubriques restent dans le numéro ; un réservoir remplace l'envoi à l'autre revue.

## Arborescence

```
<racine>\                          Revues-TESTING\  ou  2_Produkte\54_Pronto\
├── Revue\<numéro>\                numéros en cours de la Revue (lang fr)
├── Zeitschrift\<numéro>\          numéros en cours de la Zeitschrift (lang de)
├── Books\
├── _Archive\Revue\ Zeitschrift\ Books\
├── _NewsUndActu\
│   ├── Fiches\                    bibliothèque Kirby : copiée TELLE QUELLE vers le site
│   │   └── <slug>\
│   │       ├── <type>.fr.txt      fichier de la Revue (facultatif)
│   │       ├── <type>.de.txt      fichier de la Zeitschrift (facultatif)
│   │       └── <image>            couverture/affiche, commune aux deux langues
│   └── _Statuts\
│       ├── fr\<uuid>.txt          décision de la Revue sur une fiche allemande
│       └── de\<uuid>.txt          décision de la Zeitschrift sur une fiche française
├── Secrétariat und Export\
└── _Systeme\ rapports\ journaux\ suggestions\ inventaire\
```

- `<racine>` se retrouve depuis un numéro en remontant les parents et en reconnaissant des
  NOMS (`Revue`, `Zeitschrift`, `_Archive`, `_NewsUndActu`), jamais en comptant des crans :
  un numéro archivé est un cran plus bas qu'un numéro en cours.
- Langue ↔ revue : fr = Revue, de = Zeitschrift (`revues` du JSON). Une seule table.

## Le numéro

- `ausgabe.yaml` porte `id: <16 caractères [A-Za-z0-9]>`, posé à la création du numéro, jamais
  recalculé, jamais changé par un renommage ou un archivage. Un numéro qui n'en a pas en
  reçoit un à la première ouverture. Deux numéros avec le même id (dossier copié à la main) :
  avertissement, et le second reçoit un id neuf seulement sur geste explicite.
- L'article Documentation du numéro (`articles/NN-<slug>/`, meta `type: documentation`)
  ne contient plus que `<slug>.meta.yaml` et `documentation.<lang>.txt` : Title, Uuid et les
  rubriques. Les rubriques ne partent jamais sur Kirby.
- Le numéro liste les fiches dont le fichier de SA langue porte `Ausgabe: <son id>`.

## Une fiche

- Dossier `_NewsUndActu\Fiches\<slug>\`, slug tiré du titre à la création (lib/slug.js),
  suffixe -2, -3 si collision, JAMAIS renommé ensuite (ni préfixe d'ordre : un numéro ne peut
  pas imposer son rang à un dossier que l'autre langue partage).
- Un fichier par langue, `<type>.<lang>.txt`, même type pour les deux.
- `Uuid` : identique dans les deux fichiers, posé à la création, jamais recalculé.
- Champs traduisibles (`"traduire": true` du JSON : title, descriptif, lien_libelle, et
  libelle d'une ligne de suivi) : propres à chaque fichier de langue.
- Tous les autres champs (listes, dates, numéro, curia, liens, image, auteurs, éditeur…)
  sont COMMUNS : écrits à l'identique dans chaque fichier de langue existant ; enregistrer un
  fichier les recopie dans l'autre. Pour le suivi (structure) : dates, genres et liens sont
  communs, le libellé de chaque ligne est propre à la langue (appariement par rang).
- Champs système (`champsSysteme`), propres à chaque fichier de langue, jamais saisis :
  `Ausgabe` = id du numéro de cette langue, vide = orpheline ; `Ordre` = rang d'impression
  dans ce numéro (entier, 1..N), recalculé à chaque enregistrement d'une fiche du numéro.
- Retirer une fiche d'un numéro = vider `Ausgabe` (elle devient orpheline). Supprimer n'est
  possible que pour une orpheline : on ôte le fichier de SA langue ; s'il n'en reste aucun,
  le dossier entier part (image comprise).

## Statuts de traduction

`_NewsUndActu\_Statuts\<langue-cible>\<uuid>.txt`, un fichier par décision (deux postes ne
se disputent jamais le même fichier OneDrive) :

```
Statut: a-traduire        (ou : ignore)
----
Date: 2026-09-23
```

Hors de `Fiches\` : un statut écrit dans le fichier de l'autre langue créerait une copie de
conflit si la collègue édite la fiche au même moment, et un faux fichier de langue ferait
afficher par Kirby le texte de l'autre langue. Quand le fichier de la langue cible existe, la
fiche est traduite et son statut ne compte plus.

## Vues du cockpit (langue L, numéro courant N)

- **Traductions à faire** : fiches avec un fichier de l'autre langue, sans fichier L, statut
  L = a-traduire. Geste « Traduire dans ce numéro » : crée le fichier L pré-rempli (champs
  communs recopiés, champs traduisibles repris du texte source pour être réécrits),
  `Ausgabe` = N.
- **Réservoir** : (a) fiches de l'autre langue rattachées à un de ses numéros, sans fichier
  L, sans statut L — filtre par numéro de l'autre revue, sélection multiple, gestes « à
  traduire » / « ignorer » ; interrupteur « afficher les ignorées » pour revenir sur une
  décision ; (b) mes orphelines (fichier L, `Ausgabe` vide) — geste « Tirer dans ce numéro ».
- **La Documentation du numéro** : rubriques + fiches dont `Ausgabe` = N.

## Syntaxe d'un fichier .txt Kirby

- Champs séparés par une ligne `----`, écrite "\n\n----\n\n" entre deux champs.
- `Clé: valeur` sur une ligne ; valeur multiligne : `Clé:` puis une ligne vide puis la valeur.
- Clés : a-z0-9_ ; écrites avec l'initiale en majuscule (`Title`, `Lien_libelle`,
  `Dossier_references`), lues sans tenir compte de la casse.
- Une ligne de valeur qui commence par `----` s'écrit `\----` (et se relit sans le `\`).
- Écriture : Title, Uuid, Ausgabe, Ordre, puis les champs dans l'ordre du JSON ; un champ
  vide ne s'écrit pas (sauf Ausgabe, écrit vide pour une orpheline). Fin de fichier : un \n.
- `title` du JSON = champ Kirby `Title`.
- saisie `derive` (curia) : écrit par Pronto depuis `instruments[categorie].curia`.
- saisie `fichier` (couverture) : `Couverture:` + ligne vide + `- <nom-du-fichier>`.
- saisie `structure` (suivi) : `Suivi:` + ligne vide + liste YAML :
  -
    date: "2026-08-20"
    genre: "prise-position"
    libelle: "Antwort des Regierungsrates"
    lien: "https://…"
  Écriture : chaque valeur en chaîne JSON, clé vide omise. Lecture : accepter aussi les
  scalaires sans guillemets et entre apostrophes (ce qu'écrit le Panel de Kirby).
- dates `date` : AAAA-MM-JJ ; `date_partielle` : ^\d{4}(-\d{2}(-\d{2})?)?$ ; `annee` : ^\d{4}$.

## Rubriques (documentation.<lang>.txt du numéro)

Champs Dossier_references, Dossier_liens, Ressources, Podcasts : markdown libre (paragraphes,
*italique*, **gras**, [liens](url), listes, intertitres ##/###). `ressources` n'existe que pour
la Revue (`rubriques[].revues`).

## Ordre d'impression (`Ordre`)

Dans un numéro : types dans l'ordre `ordreTypes`, puis à l'intérieur d'un type selon `tri` :
- intervention : canton `CH` d'abord (`triPremier`), puis les autres par code alphabétique,
  puis titre ;
- horizon : portee (ordre de la liste `portee`), puis canton, puis titre ;
- agenda : debut, puis titre ;
- les autres : titre.
Comparaison de texte : localeCompare dans la langue du numéro, sensitivity 'base', numeric
true.

## Sections du PDF

Ordre : `ordreSections`. Une section vide ne s'imprime pas. Titre de section :
`rubriques[].titre` ou `types[].libelle` dans la langue du numéro, jamais numéroté.
