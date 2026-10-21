// La section « Aide » de l'arbre du cockpit : ses entrées et l'adresse qu'elles ouvrent.
// Les mêmes pour une revue et pour un livre. Sans `vscode`, pour être testé par node --test.
'use strict';

// Page du wiki où l'on signale un problème de Pronto, ouverte par szh.signalerProbleme.
const ADRESSE_SIGNALER_PROBLEME = 'https://wiki.szh-csps.ch/edition/journals/layout/bugs';

// Entrées de la section, dans l'ordre : `cle` (id de l'élément), `libelle` et `tip` (clés
// i18n), `icone` (codicon) et `commande` (lancée au clic, sans argument).
const ENTREES_AIDE = [
  { cle: 'signaler', libelle: 'arbre.aide.signaler', tip: 'arbre.aide.signaler.tip',
    icone: 'report', commande: 'szh.signalerProbleme' },
];

module.exports = { ADRESSE_SIGNALER_PROBLEME, ENTREES_AIDE };
