// L'onglet Paramètres du lanceur (media/lanceur.js), chargé dans le DOM minimal avec les libellés
// réels de l'hôte (lib/lanceur-page.js), comme le faisaient les tests de l'ancien panneau
// « settings » : une page prête, l'onglet Paramètres ouvert, et de quoi y chercher un élément.
//
//   const { ouvrirReglages } = require('./page-reglages');
//   const p = ouvrirReglages();            // p.page : la page du DOM minimal ; p.panneau : l'onglet
//   p.envoyer({ type: 'valeurs', valeurs: { theme: 'sombre' } });
//   p.parId('regl-biblio')                 // un élément de la page, par son id
'use strict';

const path = require('path');
const { ouvrir, chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const { textesLanceur } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'lanceur-page.js'));

// Ce que l'hôte envoie en premier : les produits, que le choix du produit proposé reprend.
const CHARGER = {
  type: MSG.CHARGER, langue: 'fr', anneeCourante: 2026, version: '2026.10.1', exports: 'C:\\P\\Exports',
  produits: [
    { jeton: 'revue', libelle: 'Revue', type: 'numero', racine: 'C:\\P\\Revue', enCours: [], archives: [] },
    { jeton: 'zeitschrift', libelle: 'Zeitschrift', type: 'numero', racine: 'C:\\P\\Zeitschrift', enCours: [], archives: [] },
    { jeton: 'livre', libelle: 'Book', type: 'livre', racine: 'C:\\P\\Book', enCours: [], archives: [] }
  ],
  historique: {}, journaux: []
};

function ouvrirReglages(opts) {
  const o = opts || {};
  const page = ouvrir({ racine: RACINE, page: 'lanceur', cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    txt: o.txt || textesLanceur() });
  page.envoyer(Object.assign({}, CHARGER, o.charger || {}));
  const lanceur = page.parId.lanceur;
  const trouver = (id) => lanceur.querySelector('[id="' + id + '"]');
  trouver('onglet-reglages').dispatchEvent({ type: 'click' });
  return {
    page: page, panneau: trouver('panneau-reglages'), parId: trouver,
    envoyer: page.envoyer, messages: page.messages,
    tous: (selecteur) => trouver('panneau-reglages').querySelectorAll(selecteur),
    un: (selecteur) => trouver('panneau-reglages').querySelector(selecteur),
    // Les messages postés à l'hôte, copiés hors du contexte de la page pour être comparés.
    postes: (type) => JSON.parse(JSON.stringify(page.messages.filter((m) => m.type === type)))
  };
}

module.exports = { ouvrirReglages, MSG, textesLanceur, RACINE, COCKPIT };
