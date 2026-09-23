# Format de la Documentation : arborescence Kirby

Source de vérité des champs : pipeline/kirby/champs-documentation.json (NE PAS le modifier ;
s'il manque quelque chose, le signaler dans le rapport final). Aucune rétrocompatibilité :
l'ancien format (blocs ::: .szh-ressource / .szh-rubrique écrits dans documentation.md, types
de rubrique tour-horizon/dossier-liens à tiret, champs genre/pays du film, categorie libre,
fiches dans un article ordinaire) n'est PLUS pris en charge. On supprime, on ne garde pas de repli.
Les fiches n'existent plus que dans l'article de type `documentation` (meta `type: documentation`).

## Arborescence d'un article Documentation

articles/NN-<slug>/
  <slug>.meta.yaml                 inchangé (type: documentation, lang: fr|de, title…)
  documentation.<lang>.txt         page Kirby : Title, Uuid, puis les rubriques
  <n>_<slug-fiche>/                une fiche = une page enfant
    <type>.<lang>.txt              type = clé de `types` du JSON (livre, film, intervention…)
    <fichier image>                couverture/affiche, dans le dossier de la fiche

- <lang> = lang de l'article (fr = Revue, de = Zeitschrift). Constante unique côté code.
- Il n'y a plus de <slug>.md source pour cet article.

## Syntaxe d'un fichier .txt Kirby

- Champs séparés par une ligne `----`, écrite "\n\n----\n\n" entre deux champs.
- `Clé: valeur` sur une ligne ; valeur multiligne : `Clé:` puis une ligne vide puis la valeur.
- Clés : a-z0-9_ ; écrites avec l'initiale en majuscule (`Title`, `Lien_libelle`,
  `Dossier_references`), lues sans tenir compte de la casse.
- Une ligne de valeur qui commence par `----` s'écrit `\----` (et se relit sans le `\`).
- Écriture : Title puis Uuid, puis les champs dans l'ordre du JSON ; un champ vide ne
  s'écrit pas. Fin de fichier : un seul \n.
- Uuid : 16 caractères [A-Za-z0-9], posé à la création, jamais recalculé ; une copie
  (envoi à l'autre revue) reçoit un Uuid neuf.
- `title` du JSON = champ Kirby `Title`.
- saisie `derive` (curia) : écrit par Pronto à chaque enregistrement depuis
  `instruments[categorie].curia` ; jamais saisi.
- saisie `fichier` (couverture) : `Couverture:` + ligne vide + `- <nom-du-fichier>` (liste
  YAML d'un élément, nom relatif au dossier de la fiche).
- saisie `structure` (suivi) : `Suivi:` + ligne vide + liste YAML :
  -
    date: "2026-08-20"
    genre: "prise-position"
    libelle: "Antwort des Regierungsrates"
    lien: "https://…"
  Écriture : chaque valeur en chaîne JSON (guillemets doubles, valide en YAML), clé vide
  omise. Lecture : accepter aussi les scalaires sans guillemets et entre apostrophes
  (c'est ce qu'écrit le Panel de Kirby).
- dates `date` : AAAA-MM-JJ ; `date_partielle` : ^\d{4}(-\d{2}(-\d{2})?)?$ ; `annee` : ^\d{4}$.

## Rubriques (page documentation.<lang>.txt)

Champs Dossier_references, Dossier_liens, Ressources, Podcasts : markdown libre (sous-ensemble
commun pandoc/KirbyText : paragraphes, *italique*, **gras**, [liens](url), listes, intertitres
##/###). `ressources` n'existe que pour la Revue (voir `rubriques[].revues`).

## Ordre des fiches = préfixe du dossier

Les fiches sont numérotées 1..N en une seule suite : types dans l'ordre `ordreTypes`, puis à
l'intérieur d'un type selon `tri` :
- intervention : canton `CH` d'abord (`triPremier`), puis les autres cantons par code
  alphabétique, puis titre ;
- horizon : portee (ordre de la liste `portee`), puis canton, puis titre ;
- agenda : debut, puis titre ;
- les autres : titre.
Comparaison de texte : localeCompare dans la langue de l'article, sensitivity 'base',
numeric true. Slug de fiche dérivé du titre (lib/slug.js côté cockpit), suffixe -2, -3 si
collision. Le dossier est renommé quand l'ordre ou le titre change.

## Sections du PDF

Ordre : `ordreSections`. Une section vide ne s'imprime pas. Titre de section : `rubriques[].titre`
ou `types[].libelle` dans la langue de l'article, jamais numéroté.
