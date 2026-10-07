# Les règles Vale du nettoyeur de manuscrit

Ce dossier contient les règles que le nettoyeur de manuscrit applique au texte des articles :
langage épicène, vocabulaire du handicap, casse maison, citations APA, trait d'union,
orthographe rectifiée et lexique maison. Elles sont écrites en YAML, un format texte simple,
pour qu'une personne de la rédaction puisse les lire et les ajuster sans programmer. Vale est
le programme qui les exécute.

Cette page dit où sont les règles, comment en modifier une, ce qu'il ne faut pas toucher, et
comment essayer une phrase. Le fonctionnement du nettoyeur est décrit dans
[`docs/ARCHITECTURE-nettoyeur-manuscrit.md`](../../docs/ARCHITECTURE-nettoyeur-manuscrit.md).

## D'où viennent ces règles

Les règles se fondent sur les lignes directrices rédactionnelles 2025 de la Revue (en
français) et de la Zeitschrift (en allemand). Ces deux PDF ne sont pas dans le dépôt. Chaque
règle cite, dans son commentaire d'en-tête, le chapitre dont elle découle. Si une règle vous
semble trop stricte ou trop lâche, la première question est : que dit ce chapitre,
exactement ?

## Où sont les fichiers

```
pipeline/vale/
  .vale.ini              la configuration : quelles règles pour quel texte
  lexique/               les CSV d'où sont générées les règles Orthographe/ et Lexique/
  styles/
    CSPS/                corps de l'article, en français
      Epicene/           FormesContractees, FormesNonListees, FormuleGenerique
      Vocabulaire/       Handicap, HandicapPersonne, Cf
      Casse/             Internet
      Editions/          SZH
      Forme/             AbreviationHorsParentheses
      APA/               EtDansParentheses, EsperluetteHorsParentheses, CitationDirectePage
      TraitUnion/        huit règles écrites à la main (voir plus bas)
      Orthographe/       neuf règles Rectifiee-*, générées (voir plus bas)
      Lexique/           Coherence et Sigle-*, générées (voir plus bas)
    CSPS-Biblio/         bibliographie, en français
      APA/               DoiForme, Esperluette
    SZH/                 corps de l'article, en allemand
      Epicene/           Paarform, GenerischesMaskulinum
      Vokabular/         Behinderung
      APA/               WoertlichesZitatSeite, UndInKlammern, KaufmannsUndAusserhalbKlammern
      Lexique/           Coherence et Sigle-*, générées
```

Le style, le dossier et le nom du fichier forment ensemble l'identifiant de la règle :
`CSPS/Epicene/FormesContractees.yml` devient `CSPS.Epicene.FormesContractees`. C'est cet
identifiant qui apparaît dans le rapport et à la fin de chaque commentaire Word.

## Corps et bibliographie sont séparés

Le nettoyeur écrit le corps et la bibliographie dans deux fichiers distincts, et `.vale.ini`
choisit les règles d'après leur nom :

| Fichier | Style appliqué |
|---|---|
| `corps-fr.txt` | `CSPS` |
| `biblio-fr.txt` | `CSPS-Biblio` |
| `corps-de.txt` | `SZH` |
| `biblio-de.txt` | aucun : il n'existe pas encore de règle de bibliographie allemande |

Une référence bibliographique reproduit le nom d'une autrice ou d'un auteur tel qu'il a été
publié : la rédaction n'a pas à le corriger. Les règles d'épicène et de vocabulaire ne
s'appliquent donc pas à la bibliographie ; seules les règles de forme des références (DOI,
esperluette) s'y appliquent.

## Les familles générées

On ne modifie pas à la main les fichiers des dossiers `Lexique/` et `Orthographe/` : on corrige
le CSV, puis on relance le générateur (son mode d'emploi est dans l'en-tête du script).

| Dossier | Source | Générateur |
|---|---|---|
| `Lexique/` (fr et de) | `lexique/lexique-fr.csv`, `lexique/lexique-de.csv` | `outils-dev/lexique/generer-lexique.py` |
| `CSPS/Orthographe/` | `lexique/orthographe-rectifiee.csv` | `outils-dev/lexique/generer-orthographe.py` |

Le lexique maison et ses colonnes sont décrits dans
[`lexique/LISEZMOI.md`](lexique/LISEZMOI.md).

### Orthographe : l'orthographe rectifiée de 1990

La Revue écrit en orthographe rectifiée. Une graphie traditionnelle est donc une faute à
corriger : les neuf règles `Rectifiee-<Catégorie>` sont au niveau `warning` et proposent un
remplacement, qui devient une révision suivie dans le document. Elles se fondent sur la page
Wikipédia « Rectifications orthographiques du français en 1990 ». Le CSV a quatre colonnes :
`traditionnelle;rectifiee;categorie;source`.

Le CSV ne couvre pas :

- les mots qui gardent l'accent circonflexe : dû (masculin singulier), mûr, sûr, jeûne, et le
  verbe « croître » seul (ses dérivés accroître et décroître le perdent) ;
- les conjugaisons complètes des verbes en -eler et -eter : seules quelques formes attestées
  y figurent ;
- le pluriel général des mots composés : seules des expressions complètes (« des
  après-midi ») y figurent, parce que le pluriel dépend de la phrase.

Ces règles ne plient pas la casse (`ignorecase: false`), pour que la suggestion garde la bonne
majuscule. Sans casse pliée, « événement » ne reconnaît pas « Événement » en début de phrase :
le générateur ajoute donc lui-même, pour chaque mot en minuscule, la paire à majuscule
initiale. Le CSV ne porte qu'une ligne par mot.

## TraitUnion : le trait d'union manquant

Huit règles écrites à la main, chacune fondée sur une section des pages Wikipédia « Emploi du
trait d'union pour les préfixes en français » (`PrefixesInvariables`, `PrefixeExAncien`,
`PrefixeAntiVoyelleI`, `PrefixeNonQuasiNoms`) et « Trait d'union » (`ComposesFiges`,
`InversionVerbePronom`, `MemeApresPronom`, `DemonstratifsCiLa`). Chaque fichier cite sa
section.

Chaque règle est une liste fermée de composés vérifiés un par un, jamais un motif général
« préfixe + n'importe quel mot ». La plupart de ces préfixes (sous-, après-, avant-…) sont
aussi des prépositions courantes, et « non- » ou « quasi- » ne prennent le trait d'union que
devant un nom (« non-respect », mais « non payée ») : Vale ne sait pas faire cette
distinction. Le préfixe « sans- » est absent de `PrefixesInvariables.yml` pour la même
raison (« il est sans emploi ») ; le commentaire du fichier l'explique.

Niveau `warning` partout. Ces règles plient la casse (`ignorecase: true`) : la suggestion est
donc toujours en minuscules, même en début de phrase.

## Modifier une règle

Ouvrez le fichier `.yml` de la règle. Deux formes reviennent.

### Une liste de motifs à signaler (« existence »)

```yaml
extends: existence
message: "Un message pour la relectrice, avec %s qui reprend le mot signalé."
level: error       # error | warning | suggestion
tokens:
  - '\bmotif\b'
  - '\bautre motif\b'
```

`level` fixe la gravité : `error` pour ce que les lignes directrices interdisent, `warning`
pour ce qui mérite une correction sans être une faute grave, `suggestion` pour ce qui vaut
d'être vérifié sans être une règle formelle.

### Un remplacement (« substitution »)

```yaml
extends: substitution
message: "%s est préférable à « %s »."
level: suggestion
action:
  name: replace
swap:
  "motif fautif": "forme recommandée"
```

Le premier `%s` du message reprend la forme recommandée, le second la forme trouvée. Une règle
avec `action: replace` devient une révision suivie dans le document, si le nettoyeur peut
l'ancrer ; sinon un commentaire.

### Ajouter un terme à une liste

Le plus simple : ajouter une ligne dans le bloc `tokens:` ou `swap:` d'une règle existante, en
copiant la forme des lignes voisines. Ne changez pas `extends`, `level` ou `action` sans avoir
relu cette page.

### Les motifs

Les motifs sont des expressions régulières, un langage de motifs de texte. Quelques repères :

- `\b` marque une limite de mot : « bureau » ne reconnaît alors pas « bureaucratie » ;
- `?` rend facultatif ce qui précède : `personnes?` reconnaît « personne » et « personnes » ;
- `[a-zà-öø-ÿ]` est une liste de caractères possibles, ici les minuscules ;
- `(?:a|b|c)` reconnaît `a`, `b` ou `c` ;
- le point, l'accent circonflexe, les parenthèses ont un sens spécial : pour les chercher tels
  quels, faites-les précéder d'un antislash (`\.` pour un vrai point).

**Écrivez toujours un motif entre guillemets simples** (`'\bau dessus\b'`). Entre guillemets
doubles, YAML lit `\b` comme le caractère « retour arrière » : le motif ne trouve plus rien,
sans message d'erreur. Les générateurs écrivent aussi leurs motifs entre guillemets simples
(`_yaml_regex_str()` de `generer-orthographe.py`).

Vale ne sait pas reconnaître un mot « avant » ou « après » un autre sans le capturer aussi
(pas d'assertion avant/arrière). Si une règle capture plus que le mot fautif, c'est voulu :
voir la section suivante.

## Ce qui ne se corrige pas dans le YAML

Dix règles capturent volontairement plus que le mot fautif, ou ont besoin du contexte :

- `CSPS.Vocabulaire.Cf`, `CSPS.Vocabulaire.HandicapPersonne`,
  `CSPS.Forme.AbreviationHorsParentheses`, `CSPS.APA.EtDansParentheses`,
  `CSPS.APA.EsperluetteHorsParentheses` ;
- `CSPS-Biblio.APA.DoiForme`, `CSPS-Biblio.APA.Esperluette` ;
- `SZH.APA.UndInKlammern`, `SZH.APA.KaufmannsUndAusserhalbKlammern`,
  `SZH.APA.WoertlichesZitatSeite`.

Vale ne peut pas viser un mot « à l'intérieur d'une parenthèse », ni ignorer « personnes
handicapées » dans le nom d'une loi, sans regarder plus large. La correction exacte (le mot
précis, la suggestion précise, ou le rejet d'un faux constat) est calculée ensuite par
`pipeline/manuscrit_vale.py`, dans la table `RAFFINEURS`. Si l'une de ces règles manque un cas
ou en signale un à tort, c'est cette table qu'il faut corriger, en Python : signalez-le au
développeur plutôt que de resserrer le motif YAML.

## Ce qu'il ne faut pas toucher

- **`.vale.ini`**, et en particulier l'étoile au début de chaque section
  (`[*corps-fr.txt]`) : sans elle, Vale ignore la section sans rien dire.
- **`extends`, `nonword`, `action.name`** : ce sont des réglages techniques. Une règle dont le
  motif commence par un symbole (`&`, `(`, un guillemet) porte `nonword: true` ; sans lui,
  Vale ne la déclenche jamais.
- **Le nom des fichiers et des dossiers** : il forme l'identifiant de la règle. Le changer
  casse le lien avec la table `RAFFINEURS` pour les dix règles listées plus haut, et change
  l'identifiant affiché dans le rapport.
- **Les fichiers générés** (`Lexique/`, `Orthographe/`) : corrigez le CSV.

## Essayer une phrase

Dans la WSL `SZH-Publishing`, depuis le dépôt :

```sh
cd pipeline
python3 manuscrit_vale.py --texte /tmp/ma-phrase.txt --langue fr
```

`ma-phrase.txt` contient un paragraphe par ligne, traité comme du corps. Le résultat est la
liste des alertes en JSON, avec la règle, le passage signalé et le message, après passage par
`RAFFINEURS`.

Pour essayer une règle Vale seule, juste après avoir modifié un motif :

```sh
cd pipeline/vale
printf 'Ma phrase à tester.\n' > /tmp/corps-fr.txt
vale --config .vale.ini --output=JSON /tmp/corps-fr.txt
```

Le nom du fichier d'essai décide des règles appliquées : `corps-fr.txt`, `biblio-fr.txt`,
`corps-de.txt` ou `biblio-de.txt`. Une règle de bibliographie ne se déclenche jamais sur
`corps-fr.txt`, même si la ligne est une référence. Pour essayer une référence :

```sh
cd pipeline/vale
printf 'Dupont, A., et Martin, B. (2020). Titre. Revue, 3(2), 1-10. doi:10.1000/xyz\n' \
  > /tmp/biblio-fr.txt
vale --config .vale.ini --output=JSON /tmp/biblio-fr.txt
```

Cette ligne lève `CSPS-Biblio.APA.DoiForme` (le DOI) et `CSPS-Biblio.APA.Esperluette`
(« , et Martin » avant le dernier auteur). Par `manuscrit_vale.py --analyser`, une entrée de
bibliographie va dans `paragraphes_biblio` ; dans `paragraphes_corps`, elle est traitée comme
du corps.

## Deux pièges avant de toucher au handicap ou à l'épicène

**« Personne en situation de handicap » ne doit jamais être signalée** : c'est la forme que la
Revue recommande, d'après le modèle MDH-PPH, alors que l'Office québécois de la langue
française préfère « personne handicapée ». Après toute modification de
`Vocabulaire/Handicap.yml` ou `Vocabulaire/HandicapPersonne.yml`, essayez cette phrase ; un
test de `test/js/manuscrit-vale.test.js` la vérifie.

**Le français et l'allemand prescrivent des solutions opposées pour l'épicène.** Le
deux-points (« Schüler:innen ») est la forme prescrite en allemand et n'apparaît dans aucun
motif français. La forme double complète (« l'éducatrice et l'éducateur ») est la solution
prescrite en français et n'apparaît dans aucun motif allemand. Ne copiez jamais un motif d'une
langue vers l'autre sans relire les lignes directrices de cette langue.
