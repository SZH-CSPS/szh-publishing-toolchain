# Les règles Vale du nettoyeur de manuscrit — pour la rédaction

Ce dossier contient les règles de langage épicène, de vocabulaire du handicap, de casse
maison et de citation APA que le nettoyeur de manuscrit applique automatiquement. Elles sont
écrites en YAML — un format texte simple, pas du code — pour qu'une personne de la rédaction
puisse les lire et les ajuster sans faire appel à quelqu'un qui programme.

Ce fichier explique où sont les messages, comment modifier une règle en confiance, ce qu'il
ne faut pas toucher, et comment tester une phrase à la main.

## D'où viennent ces règles

Deux documents font foi, et eux seuls : `outils-dev/Redaktionsrichtlinien Revue 2025.pdf`
(français) et `outils-dev/Redaktionsrichtlinien Zeitschrift 2025.pdf` (allemand). Chaque
règle porte, dans son commentaire d'en-tête, le chapitre du PDF dont elle découle. Si une
règle vous semble trop stricte ou pas assez, la première question est toujours : « que dit
le PDF, exactement, à ce chapitre ? » — pas « qu'est-ce qui me semblerait juste ».

## Où sont les fichiers

```
pipeline/vale/
  .vale.ini              la configuration : quel style s'applique à quel type de texte
  styles/
    CSPS/                règles du corps de l'article, en français
      Epicene/
        FormesContractees.yml
        FormesNonListees.yml
        FormuleGenerique.yml
      Vocabulaire/
        Handicap.yml
      Casse/
        Internet.yml
      Editions/
        SZH.yml
      APA/
        EtDansParentheses.yml
        EsperluetteHorsParentheses.yml
        CitationDirectePage.yml
    CSPS-Biblio/          règles de la bibliographie SEULEMENT, en français
      APA/
        DoiForme.yml
        Esperluette.yml
    SZH/                  règles du corps de l'article, en allemand
      Epicene/
        Paarform.yml
      Vokabular/
        Behinderung.yml
```

Le dossier (`Epicene`, `Vocabulaire`...) et le nom du fichier (`FormesContractees`...)
forment ensemble le nom complet de la règle dans le rapport, par exemple
`CSPS.Epicene.FormesContractees`. C'est cet identifiant qui apparaît dans le rapport HTML
envoyé à la rédaction.

**Pourquoi le corps et la bibliographie sont séparés** (`CSPS` contre `CSPS-Biblio`) : une
référence bibliographique reproduit le nom d'une autrice ou d'un auteur tel qu'il ou elle l'a
publié. La rédaction n'a pas à « corriger » un nom d'auteur qui contiendrait, par hasard, une
forme que la règle du corps proscrirait. C'est pourquoi les règles de langage épicène et de
vocabulaire ne s'appliquent JAMAIS à la bibliographie — seules les règles de forme des
références (DOI, esperluette) s'y appliquent.

## Modifier une règle

Ouvrez le fichier `.yml` de la règle. Deux formes reviennent :

### Une liste de motifs à signaler (« existence »)

```yaml
extends: existence
message: "Un message pour la relectrice, avec %s qui reprend le mot signalé."
level: error       # error | warning | suggestion
tokens:
  - '\bmotif\b'
  - '\bautre motif\b'
```

`level` fixe la gravité : `error` pour ce que le PDF interdit explicitement, `warning` pour
ce qui mérite une correction sans être une faute grave, `suggestion` pour ce qui vaut d'être
vérifié sans être une règle formelle du PDF.

### Un remplacement automatique (« substitution »)

```yaml
extends: substitution
message: "%s est préférable à « %s »."
level: suggestion
action:
  name: replace
swap:
  "motif fautif": "forme recommandée"
```

Le premier `%s` du message reprend automatiquement la forme recommandée (entre guillemets
simples), le second doit être écrit explicitement dans le message pour reprendre la forme
fautive trouvée.

### Ajouter un terme à une liste existante

Le plus simple : ajouter une ligne dans le bloc `tokens:` ou `swap:` d'une règle existante,
en suivant exactement la forme des lignes voisines. Ne changez jamais `extends`, `level` ou
`action` sans avoir relu ce LISEZMOI.

### Les motifs (la partie entre guillemets simples ou doubles)

Ce sont des expressions régulières — un langage de motifs de texte. Quelques repères :

- `\b` marque une limite de mot (« bureau » ne doit pas matcher à l'intérieur de
  « bureaucratie ») ;
- `?` après un caractère ou un groupe le rend optionnel (`personnes?` reconnaît
  « personne » et « personnes ») ;
- `[a-zà-öø-ÿ]` est une liste de caractères possibles (ici, les lettres minuscules
  françaises) ;
- `(?:a|b|c)` reconnaît soit `a`, soit `b`, soit `c` ;
- un accent circonflexe, un point, une parenthèse ont un sens spécial dans un motif — pour
  les chercher tels quels, les faire précéder d'un antislash (`\.` pour un vrai point).

**Ce que ces motifs NE savent PAS faire** : reconnaître qu'un mot est « avant » ou « après »
un autre sans le capturer aussi (pas de lookahead/lookbehind — Vale ne les supporte pas). Si
une règle vous semble capturer plus de texte que le seul mot fautif (par exemple toute une
citation entre parenthèses plutôt que le seul mot « et »), c'est volontaire : voir la section
suivante.

## Ce qui ne se répare PAS ici : le raffinage en Python

Quatre règles (`APA/EtDansParentheses`, `APA/EsperluetteHorsParentheses`,
`CSPS-Biblio/APA/DoiForme`, `CSPS-Biblio/APA/Esperluette`) capturent volontairement plus de
texte que le seul mot fautif, parce que Vale ne peut pas viser un mot précis « à l'intérieur
d'une parenthèse » sans capturer la parenthèse entière. La correction exacte (le mot précis,
la suggestion précise) est calculée ensuite par `pipeline/manuscrit_vale.py`, dans une petite
table nommée `RAFFINEURS`. Si l'une de ces quatre règles se comporte mal (elle manque un cas,
ou elle en signale un qui ne devrait pas l'être), il faut regarder cette table-là, pas
seulement le fichier `.yml` — et c'est du code, donc l'affaire de qui code, pas de la
rédaction. Dites-le plutôt que d'essayer de resserrer le motif YAML : ça ne suffira pas.

## Ce qu'il ne faut PAS toucher

- **`.vale.ini`** : les sections `[*corps-fr.txt]`, `[*biblio-fr.txt]`, etc. décident quel
  style s'applique à quel rôle de paragraphe. **L'étoile en tête de chaque section est
  obligatoire** — Vale ignore silencieusement une section sans caractère générique en tête
  (mesuré le 18.09.2026, Vale 3.22.0). Ne jamais retirer cette étoile en « simplifiant ».
- **`extends`, `nonword`, `action.name`** : ce sont des réglages techniques, pas des données
  éditoriales. Une règle dont le motif commence par un symbole (`&`, `(`, guillemet) porte
  `nonword: true` — sans lui, Vale n'ouvre jamais l'œil sur elle (mesuré).
- **Le nom des fichiers et des dossiers** : il devient l'identifiant de la règle dans le
  rapport. Le renommer casse le lien avec `pipeline/manuscrit_vale.py` (la table
  `RAFFINEURS`) pour les quatre règles listées ci-dessus.

## Tester une phrase à la main

Depuis la WSL `SZH-Publishing` (ou tout Linux où `vale` est installé) :

```
cd pipeline
python3 manuscrit_vale.py --texte /tmp/ma-phrase.txt --langue fr
```

où `ma-phrase.txt` contient un paragraphe par ligne. Le résultat est la liste des alertes en
JSON, avec la règle, le passage signalé et le message.

Pour tester UNIQUEMENT une règle Vale, sans passer par Python (utile pour vérifier un motif
YAML tout de suite après l'avoir modifié) :

```
cd pipeline/vale
printf 'Ma phrase à tester.\n' > /tmp/corps-fr.txt
vale --config .vale.ini --output=JSON /tmp/corps-fr.txt
```

Le fichier de test DOIT se nommer `corps-fr.txt`, `biblio-fr.txt`, `corps-de.txt` ou
`biblio-de.txt` — c'est ce nom qui décide quel style Vale applique.

## Le piège auquel il faut penser avant de modifier une règle du handicap ou de l'épicène

**« personne en situation de handicap » ne doit jamais être signalée** — c'est la forme que
la Revue recommande. Si vous élargissez le motif de `Vocabulaire/Handicap.yml`, testez
toujours cette phrase après votre modification : c'est le contrôle le plus important de tout
ce dossier (`test/js/manuscrit-vale.test.js`, un test porte son nom).

**Le français et l'allemand proscrivent des solutions OPPOSÉES** pour le langage épicène : le
deux-points (« Schüler:innen ») est la forme prescrite en allemand et n'apparaît dans AUCUN
motif français ; la forme double complète (« l'éducatrice et l'éducateur ») est la solution
de repli prescrite en français et n'apparaît dans aucun motif allemand. Ne jamais copier un
motif d'une langue vers l'autre sans relire le PDF de cette langue.
