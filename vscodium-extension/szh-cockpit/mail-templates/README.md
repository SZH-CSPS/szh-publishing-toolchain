# Gabarits de courriel du cockpit

Ce dossier contient le texte des courriels que le cockpit prépare dans le client de
messagerie. On peut le retoucher sans toucher au code.

Un fichier par courriel et par langue : `<nom>.<langue>.twig`. Si la langue demandée manque,
le cockpit prend `<nom>.fr.twig` (`lib/courriel.js`, fonction `rendreCourriel`).

| Courriel | Préparé par | Langue | Variables |
|---|---|---|---|
| `envoi-auteur` | « Envoyer cet article à l’auteur » (version finale) | celle de l'article | `titre` (de l'article), `numero` (titre du numéro), `auteurs` (liste des noms), `langue` |
| `traduction` | « Envoyer pour traduction » | `fr` pour la Zeitschrift, `de` pour la Revue | `quoi`, `lien`, `produit` (`revue` ou `zeitschrift`), `langue` |
| `support` | le signalement d'un problème depuis la vue Contrôles | celle du cockpit | `poste`, `numero` (dossier du numéro), `controle` (`source/code` du problème), `article` (slug, vide pour le numéro), `rapport` (chemin du rapport, ou la raison de son absence) |

Le courriel au support ne contient pas le texte d'un article. Son corps est coupé à
1500 caractères, la longueur qu'un lien `mailto:` supporte.

## Forme d'un gabarit

Chaque gabarit a deux blocs :

```twig
{% block sujet %}…{% endblock %}
{% block corps %}
…
{% endblock %}
```

Les blancs autour du sujet sont retirés. Le corps perd le retour à la ligne qui suit
`{% block corps %}` et celui qui précède `{% endblock %}`.

## Syntaxe

Le moteur est [`lib/gabarits.js`](../lib/gabarits.js), un sous-ensemble de Twig qui produit
du texte brut, sans échappement automatique.

- Valeurs : `{{ variable }}`, `{{ a.b.c }}`, littéraux `'texte'`, `3`, `true`, `false`,
  `null`.
- Filtres : `default(x)`, `upper`, `lower`, `trim`, `capitalize`, `join(sep)`, `length`,
  `first`, `last`, `csv`, `escape` (alias `e`, pour un gabarit HTML).
- Conditions : `{% if %}`, `{% elseif %}`, `{% else %}`, `{% endif %}`, avec `x`, `not x`,
  `x == y`, `x != y`, `x is empty`, `x is not empty`, `x is defined`, combinés par `and` et
  `or`, sans parenthèses.
- Boucles : `{% for x in liste %}`, `{% else %}`, `{% endfor %}`, avec `loop.index`,
  `loop.index0`, `loop.first`, `loop.last`, `loop.length`.
- Aussi : `{% set x = expr %}`, `{# commentaire #}`, `{% block nom %}` au premier niveau,
  le contrôle des blancs `{%- -%}`.

Le moteur ne connaît pas le calcul, les macros ni l'inclusion d'un autre gabarit. Une
erreur de syntaxe donne le nom du gabarit et le numéro de ligne.

Le lanceur Windows a ses propres gabarits, rendus par le même moteur :
[`windows/mail-templates/`](../../../windows/mail-templates/README.md).
