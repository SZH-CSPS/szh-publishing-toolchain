// Les quatre blocs de la page Réglages qui n'ont de sens que pour une revue/Zeitschrift —
// « Auteur·e·s publiés » (OJS), « Bibliographie », « Tâches par article », « Export OJS » —
// masqués pour un livre. L'hôte (extension.js, ouvrirReglages) ne les envoie plus du tout
// quand un livre est ouvert ; côté webview (media/settings.js), chaque <section>
// (media/settings.html) reste masquée — TITRE compris — tant que sa donnée n'arrive pas.
//
//   node --test test/js/reglages-blocs-livre.test.js
//
// Le geste de l'hôte (le message réellement construit par ouvrirReglages selon le profil)
// vit dans test/js/hote-livre.test.js et test/js/hote.test.js : chacun a déjà son propre
// activerHote() de tout son fichier — « un seul activerHote() par processus »
// (hote-factice.js) l'interdit ici. Ce fichier-ci n'éprouve que le rendu de la webview.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');

function ouvrirPageReglages() {
  return ouvrir({
    racine: RACINE, page: 'settings',
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    txt: libellesHote(RACINE, ['REGL_LIBELLES'])
  });
}

const BLOCS = ['bloc-auteurs-ojs', 'bloc-biblio', 'bloc-taches', 'bloc-ojs'];

function etatBlocs(page) {
  const etat = {};
  for (const id of BLOCS) {
    const el = page.document.getElementById(id);
    etat[id] = el ? el.hidden : 'absent';
  }
  return etat;
}

test('livre : les quatre blocs restent masqués quand l’hôte n’envoie pas leurs données', () => {
  const page = ouvrirPageReglages();
  // Exactement ce que messageValeursReglages() (extension.js) envoie pour un livre : pas
  // de clés ojs/biblio/taches/auteursOjs du tout.
  page.envoyer({
    type: 'valeurs', valeurs: { theme: 'sombre', langue: 'fr' },
    suggInterface: 0, avertLangue: '', proteges: { deverrouille: false, divergences: [], avertissement: '' }
  });
  const etat = etatBlocs(page);
  for (const id of BLOCS) {
    assert.strictEqual(etat[id], true, id + ' n’est pas resté masqué sans donnée : ' + JSON.stringify(etat));
  }
});

test('revue : les quatre blocs apparaissent dès que l’hôte envoie leurs données (non-régression)', () => {
  const page = ouvrirPageReglages();
  page.envoyer({
    type: 'valeurs', valeurs: { theme: 'sombre', langue: 'fr' },
    suggInterface: 0, avertLangue: '', proteges: { deverrouille: false, divergences: [], avertissement: '' },
    auteursOjs: { dateFetch: null, dateCorpus: null, nombre: 0, nombreRor: 0 },
    ojs: { config: { revues: {}, rubriques: [], types: {} }, locales: ['revue'],
      revues: { revue: 'Revue' }, clesDefaut: [], champs: [], typesArticle: [] },
    biblio: { titres: {}, revues: [{ cle: 'revue', libelle: 'Revue' }], langues: [{ cle: 'fr', libelle: 'Français' }] },
    taches: { table: { revue: [], zeitschrift: [] }, revues: [{ cle: 'revue', libelle: 'Revue' }], max: 20 }
  });
  const etat = etatBlocs(page);
  for (const id of BLOCS) {
    assert.strictEqual(etat[id], false, id + ' est resté masqué malgré la donnée reçue : ' + JSON.stringify(etat));
  }
});
