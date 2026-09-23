# kirby/

Blueprints du site Kirby de la Documentation (« Actualité et ressources » /
« News & Ressourcen »), générés depuis le contrat unique
`pipeline/kirby/champs-documentation.json`. Voir `docs/FORMAT-DOCUMENTATION-KIRBY.md` pour le
format de l'arborescence que Pronto écrit, et `TODO_KirbyCMS.md` pour ce que le site Kirby
doit encore reprendre — les deux font foi, pas ce fichier.

## Contenu

- `generer-blueprints.js` — le générateur (Node, zéro dépendance).
- `site/blueprints/pages/<type>.yml` — un blueprint par clé de `types` du JSON (horizon,
  recherche, intervention, livre, film, reprise, agenda).
- `site/blueprints/pages/documentation.yml` — la page Documentation elle-même : les rubriques
  en champs, une section `pages` par type de fiche.
- `site/blueprints/files/<cle>.yml` — un gabarit de fichier par CLÉ de champ `fichier` du JSON
  (aujourd'hui : `couverture`, partagé par `livre` et `film`). Porte le `accept: extension:
  […]` ; le champ `files` correspondant le référence via `uploads: <cle>`. Pas de champ
  `alt` : l'image est décorative (couverture, affiche — TODO_KirbyCMS.md §10), le site doit
  rendre `alt=""` de lui-même.

**Ces `.yml` sont générés : ne jamais les éditer à la main.** Toute retouche se fait dans
`pipeline/kirby/champs-documentation.json`, puis on régénère. Une modification manuelle serait
écrasée à la prochaine régénération, et diverge en attendant du formulaire de Pronto et des
filtres du PDF qui lisent le même JSON.

## Régénérer

```sh
node kirby/generer-blueprints.js            # écrit les fichiers
node kirby/generer-blueprints.js --verifier # ne rien écrire ; code 1 si un fichier committé
                                             # diffère (le nomme) — utilisé par le test
```

Après une modification du JSON, régénérer puis committer les `.yml` qui changent.

## Test

```sh
node --test test/js/blueprints-kirby.test.js
```

Contrôle que les blueprints committés égalent la génération, que chaque liste du JSON porte
ses deux langues, et qu'aucun champ généré n'a un nom hors `[a-z0-9_]` ou ne s'appelle
`image` (méthode réservée de Kirby, voir `TODO_KirbyCMS.md` §10).

## Incertitudes Kirby restant à vérifier sur une vraie instance

Voir les commentaires de `generer-blueprints.js` pour le détail et les pages
getkirby.com consultées le 23.09.2026 ; résumé :

- Le libellé du champ `title` natif (pas le nom du gabarit, réglé lui via le `title:` à la
  racine du blueprint) est redéclaré dans `fields.title.label` sans `type:`. C'est la
  pratique Kirby usuelle pour ce champ précis, mais pas trouvée noir sur blanc dans la doc
  récupérée — à confirmer.
- Le champ `files` n'a pas d'option `accept` documentée (vérifié via la liste complète de ses
  options) : la restriction par extension passe par un gabarit de fichier séparé, référencé
  via `uploads: <cle>` — c'est ce que fait ce générateur (`site/blueprints/files/<cle>.yml`).
  Syntaxe de `accept.extension` sur un gabarit de fichier également vérifiée sur
  getkirby.com. Reste à confirmer sur une vraie instance (`TODO_KirbyCMS.md` §6) : la
  version de Kirby retenue applique bien cette restriction au moment de l'upload dans le
  Panel.
