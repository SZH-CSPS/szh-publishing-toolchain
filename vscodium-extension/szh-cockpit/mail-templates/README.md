# Gabarits de courriel

Un fichier par courriel et par langue : `nom.langue.twig` (`envoi-auteur.fr.twig`,
`envoi-auteur.de.twig`, `traduction.fr.twig`, `traduction.de.twig`). La langue manquante
retombe sur `.fr.twig` — voir `lib/courriel.js`, `rendreCourriel(nom, langue, variables)`.

Chaque gabarit porte deux blocs obligatoires :

```
{% block sujet %}…{% endblock %}
{% block corps %}
…
{% endblock %}
```

Variables disponibles :

- `envoi-auteur` : `titre` (titre de l'article), `numero` (titre du numéro), `auteurs`
  (liste des noms d'auteurs, pour un usage futur), `langue`.
- `traduction` : `quoi`, `lien`, `produit` (`zeitschrift` ou `revue`), `langue`.

Syntaxe reconnue (sous-ensemble de Twig, texte brut, sans échappement) : `{{ variable }}`,
`{{ a.b.c }}`, littéraux `'texte'`, `3`, `true`, `false`, `null` ; les filtres `default(x)`,
`upper`, `lower`, `trim`, `capitalize`, `join(sep)`, `length`, `first`, `last` ;
`{% if %}`/`{% elseif %}`/`{% else %}`/`{% endif %}` avec `x`, `not x`, `x == y`, `x != y`,
`x is empty`, `x is defined`, `x is not empty`, combinés par `and`/`or` ;
`{% for x in liste %}`/`{% else %}`/`{% endfor %}` avec `loop.index`, `loop.index0`,
`loop.first`, `loop.last`, `loop.length` ; `{% set x = expr %}` ; `{# commentaire #}` ;
`{% block nom %}` au premier niveau ; le contrôle des blancs `{%- -%}` à la Twig.

Non reconnu : parenthèses dans les conditions, calcul arithmétique, macros, inclusion d'un
autre gabarit, échappement HTML. Voir `lib/gabarits.js`.

Le lanceur Windows a ses propres gabarits, dans `windows/mail-templates/` : même
convention sujet/corps, mais son petit moteur PowerShell (`Get-SzhCourriel`,
`windows/szh-common.ps1`) ne comprend que les variables, les blocs et les commentaires.
