// Paramètres de l'Accueil (media/accueil.js) : « Moisson mensuelle » et « Données FNS », rendus
// depuis l'état que l'hôte envoie. La page ne calcule rien : elle montre, désactive avec la raison,
// et poste les gestes par MSG.
//
//   node --test test/js/reglages-moisson.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ouvrirReglages, MSG } = require('./page-reglages');

const X = { section: 'Moissonnage', titre: 'Moisson mensuelle', aide: 'Aide.', lancer: 'Lancer la moisson mensuelle',
  lancerTest: 'Lancer la moisson (test)', arreter: 'Arrêter', confirmer: 'Lancer', annuler: 'Annuler', estimation: 'Estimation…',
  creneau: 'Créneau…', arretDemande: 'Arrêt demandé.', arretApres: 'Plus tard.', voirPropositions: 'Voir les propositions',
  avertissements: 'Avertissements', fnsTitre: 'Données FNS', fnsAide: 'Aide FNS.', fnsLien: 'Ouvrir data.snf.ch',
  fnsRobots: 'Le FNS interdit les robots.', fnsTelechargements: 'Téléchargements.', fnsFrequence: 'Tous les 6 mois.',
  fnsImporter: 'Importer les données FNS…' };
function etat(extra) {
  return Object.assign({ type: MSG.ACCUEIL_MOISSON_ETAT, textes: X, test: false, disponible: true,
    moissonneurs: [{ libelle: 'Interventions', ligne: 'Dernière passe le 01.10.2026. Budget du mois : 120/800 requêtes.' }],
    creneau: '', raison: '', preparation: null, passe: null, bilan: null,
    fns: { dernier: 'Aucune importation enregistrée.', prochaine: 'Prochaine : fin novembre 2026.' } }, extra || {});
}
function ouvrir(e) {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false } });
  p.envoyer(e || etat());
  return p;
}
const un = (p, cls) => p.un('.' + cls);

test('visible même sans moissonneur réglé : son intertitre, l’état par moissonneur, le bouton actif', () => {
  const p = ouvrir();
  const s = p.parId('regl-moisson');
  assert.strictEqual(s.hidden, false);
  assert.strictEqual(s.querySelector('.accueil-intertitre').textContent, 'Moissonnage', 'sans section Moissonnage, la sienne');
  assert.strictEqual(un(p, 'accueil-moisson-etat').textContent, 'Interventions · Dernière passe le 01.10.2026. Budget du mois : 120/800 requêtes.');
  const b = un(p, 'accueil-moisson-lancer');
  assert.deepStrictEqual([b.textContent, b.disabled], ['Lancer la moisson mensuelle', false]);
  b.click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_MOISSON_PREPARER), [{ type: MSG.ACCUEIL_MOISSON_PREPARER }]);
});

test('désactivé avec sa raison ; sur la racine de test, le bouton dit « sans requête réseau »', () => {
  const raison = 'Une moisson tourne depuis le poste PC-B (anna) depuis 08 h 30, fin prévue vers 10 h 00.';
  const p = ouvrir(etat({ creneau: raison, raison: raison, test: true }));
  const b = un(p, 'accueil-moisson-lancer');
  assert.deepStrictEqual([b.textContent, b.disabled], ['Lancer la moisson (test)', true]);
  assert.strictEqual(un(p, 'accueil-moisson-raison').textContent, raison);
  assert.ok(p.parId('regl-moisson').querySelector('.szh-notif--info'), 'le créneau se dit aussi en avis');
  assert.strictEqual(un(p, 'accueil-moisson-fns-importer').disabled, true, 'pas d’import pendant le créneau d’un autre');
});

test('confirmation : l’avertissement et la durée, Annuler et Lancer', () => {
  const texte = 'La moisson s’arrête si vous fermez VSCodium. Durée estimée : au plus 15 min.';
  const p = ouvrir(etat({ preparation: { genre: 'mensuelle', etat: 'confirmation', texte: texte } }));
  assert.strictEqual(un(p, 'accueil-moisson-confirmation').textContent, texte);
  assert.strictEqual(un(p, 'accueil-moisson-lancer'), null);
  un(p, 'accueil-moisson-annuler').click();
  un(p, 'accueil-moisson-confirmer').click();
  assert.strictEqual(p.postes(MSG.ACCUEIL_MOISSON_ANNULER).length, 1);
  assert.strictEqual(p.postes(MSG.ACCUEIL_MOISSON_LANCER).length, 1);
});

test('passe : une barre par moissonneur, la ligne d’état en role=status, l’attente, Arrêter', () => {
  const passe = { genre: 'mensuelle', phase: 'en-cours', statut: 'Interventions · GE', arretDemande: false, peutArreter: true,
    avertissements: ['Interventions · corps VD en échec'],
    lignes: [{ id: 'parlement', libelle: 'Interventions', etape: 'GE', fraction: 0.25, detail: '12/750 requêtes · reste au plus 21 s', attente: '', lot: '' },
      { id: 'recherche', libelle: 'Recherches', etape: 'phbern', fraction: 0.1, detail: '6/2950 requêtes', attente: 'phbern demande d’attendre 2 min (429).', lot: '' }] };
  const p = ouvrir(etat({ passe: passe }));
  const barres = p.parId('regl-moisson').querySelectorAll('progress');
  assert.deepStrictEqual(barres.map((b) => [Number(b.value), b.getAttribute('aria-label')]), [[0.25, 'Interventions'], [0.1, 'Recherches']]);
  const st = un(p, 'accueil-moisson-statut');
  assert.deepStrictEqual([st.getAttribute('role'), st.textContent], ['status', 'Interventions · GE']);
  assert.strictEqual(un(p, 'accueil-moisson-attente').textContent, 'phbern demande d’attendre 2 min (429).');
  assert.strictEqual(un(p, 'accueil-moisson-avert').textContent, '⚠ Interventions · corps VD en échec');
  const stop = un(p, 'accueil-moisson-arreter');
  assert.strictEqual(stop.disabled, false);
  stop.click();
  assert.strictEqual(p.postes(MSG.ACCUEIL_MOISSON_ARRETER).length, 1);
  p.envoyer(etat({ passe: Object.assign({}, passe, { arretDemande: true, peutArreter: false }) }));
  assert.strictEqual(un(p, 'accueil-moisson-arreter').disabled, true);
  assert.strictEqual(un(p, 'accueil-moisson-arret').textContent, 'Arrêt demandé.');
});

test('bilan : le ton, les lots déposés, et le lien vers les Propositions', () => {
  const p = ouvrir(etat({ bilan: { genre: 'mensuelle', ok: true, ton: 'ok', texte: 'Moisson terminée. Durée : 12 min.',
    lots: ['Interventions : lot déposé, 2026-11-01-1.jsonl, 14 propositions.'], details: [], lien: true } }));
  assert.strictEqual(un(p, 'accueil-moisson-bilan').textContent, 'Moisson terminée. Durée : 12 min.');
  assert.ok(un(p, 'accueil-moisson-bilan').classList.contains('szh-notif--ok'));
  assert.strictEqual(un(p, 'accueil-moisson-bilan-ligne').textContent, 'Interventions : lot déposé, 2026-11-01-1.jsonl, 14 propositions.');
  un(p, 'accueil-moisson-propositions').click();
  assert.strictEqual(p.postes(MSG.ACCUEIL_MOISSON_PROPOSITIONS).length, 1);
});

test('FNS : le lien passe par l’hôte, l’aide, la fréquence, et jamais un <input type=file>', () => {
  const p = ouvrir();
  const f = p.un('.accueil-moisson-fns');
  assert.ok(f, 'bloc FNS absent');
  assert.ok(f.textContent.indexOf('Le FNS interdit les robots.') !== -1);
  assert.ok(f.textContent.indexOf('Téléchargements.') !== -1);
  assert.strictEqual(un(p, 'accueil-moisson-fns-frequence').textContent, 'Tous les 6 mois. Prochaine : fin novembre 2026.');
  assert.strictEqual(un(p, 'accueil-moisson-fns-dernier').textContent, 'Aucune importation enregistrée.');
  un(p, 'accueil-moisson-fns-lien').dispatchEvent({ type: 'click', preventDefault() {} });
  assert.strictEqual(p.postes(MSG.ACCUEIL_FNS_LIEN).length, 1);
  un(p, 'accueil-moisson-fns-importer').click();
  assert.strictEqual(p.postes(MSG.ACCUEIL_FNS_CHOISIR).length, 1);
  assert.deepStrictEqual(p.tous('input').filter((i) => i.type === 'file'), []);
  const q = ouvrir(etat({ fns: { dernier: '', prochaine: '', raison: 'Socle absent.' } }));
  assert.strictEqual(un(q, 'accueil-moisson-fns-importer').disabled, true);
});
