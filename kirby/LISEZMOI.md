# kirby/

Les blueprints du site Kirby de la Documentation (« Actualité et ressources » / « News &
Ressourcen »). Un blueprint est le fichier YAML qui décrit, dans Kirby, les champs d'une page et
le formulaire du Panel.

Ces fichiers sont générés depuis le contrat des champs, `pipeline/kirby/champs-documentation.json`.
Le format des fiches que Pronto écrit, et ce que le site doit en faire, sont dans
[`docs/FORMAT-DOCUMENTATION-KIRBY.md`](../docs/FORMAT-DOCUMENTATION-KIRBY.md).

## Contenu

| Fichier | Rôle |
|---|---|
| `generer-blueprints.js` | le générateur (Node, sans dépendance) |
| `site/blueprints/pages/<type>.yml` | une fiche, un fichier par type du contrat : `horizon`, `recherche`, `intervention`, `livre`, `film`, `reprise`, `agenda` |
| `site/blueprints/pages/<dossier>.yml` | la page parente des fiches d'un type, un fichier par `types[].dossier` : `rundschau`, `forschung`, `vorstoesse`, `buecher`, `filme`, `revueblick`, `weiterbildung` |
| `site/blueprints/pages/actualites.yml` | la page parente de toute la bibliothèque |
| `site/blueprints/files/couverture.yml` | le gabarit du fichier image d'un livre ou d'un film |

**Une fiche** (`livre.yml`…) porte les champs de son type, plus les trois champs système
`ausgabe`, `ordre` et `origine`, cachés (`hidden`).

**Une page dossier** (`buecher.yml`…) a pour titre `types[].libelle` et une seule section
`pages` qui liste les fiches de son type (`template: <type>`, `sortable: false`). Son nom est
celui du dossier, pas celui du type : la page dossier et ses fiches sont deux pages Kirby
différentes, avec deux gabarits différents.

**`actualites.yml`** n'a pas de champ. Sa section `pages` liste les sept pages dossier
(`templates:`), dans l'ordre de `ordreTypes`. Les rubriques des numéros ne vont pas sur le site :
il n'y a pas de blueprint pour elles.

**`couverture.yml`** porte la liste des extensions acceptées (`accept: extension:`). Le champ
`files` de la fiche y renvoie par `uploads: couverture`, car le champ `files` de Kirby n'a pas
d'option `accept`. Il n'a pas de champ `alt` : l'image est décorative, et le site rend `alt=""`.

Le libellé du champ natif `title` est redéclaré dans `fields.title.label`, sans `type`.

## Champs traduisibles ou communs

Dans le contrat, un champ `"traduire": true` est propre à chaque fichier de langue ; les autres
sont communs, et Pronto les recopie dans les deux fichiers à l'enregistrement. Le générateur
traduit cette règle pour le Panel :

| Champ | `translate` |
|---|---|
| commun (sans `traduire: true`) | `false` : le Panel ne le modifie que dans la langue par défaut, et il ne peut pas diverger entre les deux fichiers |
| traduisible | absent : le défaut de Kirby, `true` |
| `suivi` (structure) | rien au niveau du champ ; la règle s'applique à chaque sous-champ (`date`, `genre`, `lien` communs, `libelle` traduisible) |
| `ausgabe`, `ordre`, `origine` | `true` explicite : une fiche appartient à un numéro différent dans chaque langue |

Autres correspondances : une saisie `derive` (`curia`) devient un champ `hidden`, une
`liste_multiple` un `multiselect`, une liste un `select` dont les options portent les libellés
fr et de.

## Régénérer

Les `.yml` ne s'éditent pas à la main : une retouche serait écrasée à la régénération suivante,
et divergerait d'ici là du formulaire du cockpit et du PDF, qui lisent le même contrat.

1. Modifier `pipeline/kirby/champs-documentation.json`.
2. Régénérer :

   ```sh
   node kirby/generer-blueprints.js
   ```

3. Committer les `.yml` qui ont changé.

Pour contrôler sans rien écrire :

```sh
node kirby/generer-blueprints.js --verifier
```

Il sort en code 1, en nommant le fichier, si un blueprint committé diffère de la génération.

## Test

```sh
node --test test/js/blueprints-kirby.test.js
```

Le test vérifie que :

- les blueprints committés égalent la génération ;
- chaque liste du contrat a ses deux langues ;
- aucun champ n'a un nom hors `[a-z0-9_]`, ni ne s'appelle `image` (méthode réservée de Kirby) ;
- `translate` suit la règle ci-dessus, champ par champ, y compris dans `suivi` ;
- chaque fiche porte `ausgabe` et `ordre`, cachés et traduisibles ;
- chaque `types[].dossier` est en ASCII et a sa page dossier, dont le titre et la section sont
  ceux attendus ;
- `actualites.yml` liste les sept pages dossier et n'a pas de champ.
