// Les quatre blocs de la carte des réglages de la rédaction qui n'ont de sens que pour une
// revue/Zeitschrift — « Auteur·e·s publiés » (OJS), « Bibliographie », « Tâches par article »,
// « Export OJS » — masqués quand le lanceur est ouvert depuis un livre. L'hôte
// (lib/lanceur-reglages-hote.js, messageValeurs) ne les envoie alors pas ; côté page
// (media/lanceur.js), chaque bloc reste masqué — TITRE compris — tant que sa donnée n'arrive pas.
//
//   node --test test/js/reglages-blocs-livre.test.js
//
// Le geste de l'hôte (le message réellement construit selon le profil) vit dans
// test/js/hote-livre.test.js et test/js/lanceur-reglages-hote.test.js : chacun a déjà son propre
// activerHote() — « un seul activerHote() par processus » (hote-factice.js) l'interdit ici. Ce
// fichier-ci n'éprouve que le rendu de la page.
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
  // Exactement ce que l'hôte envoie pour un livre : pas de clés ojs/biblio/taches/auteursOjs.
  p.envoyer({ type: MSG.VALEURS, valeurs: { theme: 'sombre', langue: 'fr' }, suggInterface: 0, avertLangue: '', proteges: PROTEGES });
  const etat = etatBlocs(p);
  for (const id of BLOCS) {
    assert.strictEqual(etat[id], true, id + ' n’est pas resté masqué sans donnée : ' + JSON.stringify(etat));
  }
  // La carte, elle, reste : son verrou et sa note valent aussi pour un livre.
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
