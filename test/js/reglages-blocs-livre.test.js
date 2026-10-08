// Les quatre blocs de la carte des réglages de la rédaction propres à la revue
// (« Auteur·e·s publiés » (OJS), « Bibliographie », « Tâches par article », « Export OJS »)
// sont masqués quand l'Accueil est ouvert depuis un livre. L'hôte
// (lib/accueil-reglages-hote.js, messageValeurs) ne les envoie pas ; la page
// (media/accueil.js) masque chaque bloc, titre compris, tant que sa donnée n'arrive pas.
//
//   node --test test/js/reglages-blocs-livre.test.js
//
// Ce fichier ne vérifie que le rendu de la page. Le message construit par l'hôte selon le
// profil est vérifié dans test/js/hote-livre.test.js et test/js/accueil-reglages-hote.test.js,
// car hote-factice.js n'admet qu'un activerHote() par processus.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ouvrirReglages, MSG } = require('./page-reglages');

const BLOCS = ['regl-bloc-auteurs', 'regl-bloc-biblio', 'regl-bloc-taches', 'regl-bloc-ojs'];

function etatBlocs(p) {
  const etat = {};
  for (const id of BLOCS) {
    const el = p.parId(id);
    etat[id] = el ? el.hidden : 'absent';
  }
  return etat;
}

const PROTEGES = { deverrouille: false, divergences: [], avertissement: '' };

test('livre : les quatre blocs restent masqués quand l’hôte n’envoie pas leurs données', () => {
  const p = ouvrirReglages();
  // Ce que l'hôte envoie pour un livre : pas de clés ojs/biblio/taches/auteursOjs.
  p.envoyer({ type: MSG.VALEURS, valeurs: { theme: 'sombre', langue: 'fr' }, suggInterface: 0, avertLangue: '', proteges: PROTEGES });
  const etat = etatBlocs(p);
  for (const id of BLOCS) {
    assert.strictEqual(etat[id], true, id + ' n’est pas resté masqué sans donnée : ' + JSON.stringify(etat));
  }
  // La carte reste : son verrou et sa note valent aussi pour un livre.
  assert.ok(p.parId('regl-proteges'), 'la carte des réglages de la rédaction a disparu');
});

test('revue : les quatre blocs apparaissent dès que l’hôte envoie leurs données (non-régression)', () => {
  const p = ouvrirReglages();
  p.envoyer({
    type: MSG.VALEURS, valeurs: { theme: 'sombre', langue: 'fr' }, suggInterface: 0, avertLangue: '', proteges: PROTEGES,
    auteursOjs: { dateFetch: null, dateCorpus: null, nombre: 0, nombreRor: 0 },
    ojs: { config: { revues: {}, rubriques: [], types: {} }, locales: ['revue'],
      revues: { revue: 'Revue' }, clesDefaut: [], champs: [], typesArticle: [] },
    biblio: { titres: {}, revues: [{ cle: 'revue', libelle: 'Revue' }], langues: [{ cle: 'fr', libelle: 'Français' }] },
    taches: { table: { revue: [], zeitschrift: [] }, revues: [{ cle: 'revue', libelle: 'Revue' }], max: 20 }
  });
  const etat = etatBlocs(p);
  for (const id of BLOCS) {
    assert.strictEqual(etat[id], false, id + ' est resté masqué malgré la donnée reçue : ' + JSON.stringify(etat));
  }
});
