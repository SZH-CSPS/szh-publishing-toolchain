# Gabarits de courriel du lanceur Windows

Un fichier par courriel et par langue : `nom.langue.twig` (`support.fr.twig`,
`support.de.twig`, `support.en.twig`). Repli sur `.fr.twig` — voir `Get-SzhCourriel`
dans `windows/szh-common.ps1`.

Même convention que le cockpit : deux blocs, `{% block sujet %}…{% endblock %}` et
`{% block corps %}…{% endblock %}`.

Sous-ensemble compris, plus restreint que `lib/gabarits.js` : commentaires `{# … #}`,
blocs `{% block nom %}` au premier niveau, variables `{{ nom }}` (absente -> chaîne
vide). Rien d'autre — `if`, `for`, filtre… lèvent une erreur nommant le gabarit.

Voir `vscodium-extension/szh-cockpit/mail-templates/README.md` pour la syntaxe complète.
