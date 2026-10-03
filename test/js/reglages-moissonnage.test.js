// Paramètres de l'Accueil, section Moissonnage (media/accueil.js) : un curseur par revue qui
// règle la finesse de toute la rédaction, la table des dix crans de chaque langue, l'explication
// des catégories. Les données sont synthétiques, au format de docs/FORMAT-PROPOSITIONS.md.
//
//   node --test test/js/reglages-moissonnage.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ouvrirReglages, MSG } = require('./page-reglages');

const SEUILS = [0, 5, 9, 12, 12, 18, 29, 38, 56, 78];
const CRANS = SEUILS.map((s, i) => ({ cran: i + 1, seuil: s, par_mois: 81 - i * 8, rappel: i === 9 ? null : 73 - i * 6,
  rappel_sur: 79, identique_au_cran_precedent: i > 0 && SEUILS[i - 1] === s }));
const TEXTES = {
  titre: 'Moissonnage', astuce: 'Astuce.', passe: 'Dernière passe le {0}.', passeInconnue: 'Inconnue.',
  finesse: 'Finesse – {0}, {1}', regle: 'Réglé par {0} le {1}.', regleAucun: 'Pas réglé.',
  lecture: 'Cran {0} : environ {1} par mois, retrouve {2} des {3}', lectureSans: 'Cran {0} : environ {1} par mois',
  identique: ' (identique au cran {0})', valeur: '{0} sur 10, environ {1} par mois', crans: 'Les dix crans – {0}',
  cransAide: 'Du {0} au {1}, calculés le {2}.', cransCommun: 'Déciles communs.', colCran: 'Cran', colSeuil: 'Note dès',
  colMois: 'Par mois', colRappel: 'Rappel (sur {0})', colActif: 'Réglage actif', egal: '= cran {0}', actif: 'réglage actif',
  optimiste: 'Optimiste.', categories: 'Catégories', categoriesAide: 'Aide.', sansCrans: 'Pas de crans.',
  large: 'Large', strict: 'Strict', revues: { fr: 'Revue (fr)', de: 'Zeitschrift (de)' },
  jetons: { titre: 'terme dans le titre', 'signal-faible': 'signal faible' }
};
function moissonnage() {
  return {
    textes: TEXTES, langue: 'fr',
    moissonneurs: [
      { id: 'isbn', libelle: 'Livres (ISBN)', derniere: '2026-09-30T06:05:00Z', types: [{ type: 'livre', libelle: 'Livres' }],
        langues: { fr: { crans: null, source: '', reglages: {} }, de: { crans: null, source: '', reglages: {} } },
        calculeLe: '', fenetre: null, categories: [] },
      { id: 'parlement', libelle: 'Interventions (OpenParlData)', derniere: '2026-10-01T05:12:00Z',
        types: [{ type: 'intervention', libelle: 'Interventions parlementaires' }],
        langues: {
          fr: { crans: CRANS, source: 'langue', reglages: { intervention: { cran: 6, par: 'Claire Exemple', le: '2026-10-01' } } },
          de: { crans: CRANS, source: 'commun', reglages: {} }
        },
        calculeLe: '2026-10-01', fenetre: { du: '2026-04-01', au: '2026-09-30' }, categories: ['titre', 'signal-faible'] }
    ]
  };
}
function ouvrir() {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: moissonnage() });
  return p;
}
function rangeeFinesse(p, cle) { return p.tous('.accueil-tache').find((r) => r.dataset.finesse === cle); }
function rangeeCrans(p, cle) { return p.tous('.accueil-tache').find((r) => r.dataset.crans === cle); }

test('réglages : sans moissonneur, pas de section Moissonnage', () => {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false } });
  assert.strictEqual(p.parId('regl-moissonnage').hidden, true);
  assert.strictEqual(p.parId('regl-moissonnage').enfants.length, 0);
});

test('réglages : une section par moissonneur ; sans crans, une ligne qui le dit', () => {
  const p = ouvrir();
  const s = p.parId('regl-moissonnage');
  assert.strictEqual(s.hidden, false);
  assert.deepStrictEqual(s.querySelectorAll('.accueil-moiss-nom').map((h) => h.textContent), ['Livres (ISBN)', 'Interventions (OpenParlData)']);
  assert.deepStrictEqual(s.querySelectorAll('.accueil-moiss-sans').map((x) => x.textContent), ['Pas de crans.']);
  assert.ok(s.textContent.indexOf('Dernière passe le 01.10.2026.') !== -1);
});

test('réglages : un curseur par revue, avec « réglé par… le… » ; il écrit le réglage partagé', () => {
  const p = ouvrir();
  const fr = rangeeFinesse(p, 'parlement:fr:intervention');
  const de = rangeeFinesse(p, 'parlement:de:intervention');
  assert.ok(fr && de, 'un curseur par revue');
  assert.strictEqual(fr.querySelector('.accueil-tache-nom').textContent, 'Finesse – Revue (fr), Interventions parlementaires');
  assert.strictEqual(fr.querySelector('.accueil-tache-aide').textContent, 'Réglé par Claire Exemple le 01.10.2026.');
  assert.strictEqual(de.querySelector('.accueil-tache-aide').textContent, 'Pas réglé.');
  const c = fr.querySelector('.accueil-finesse-curseur');
  assert.deepStrictEqual([c.type, c.min, c.max, c.value], ['range', '1', '10', '6']);
  assert.strictEqual(c.getAttribute('aria-valuetext'), '6 sur 10, environ 41 par mois');
  assert.strictEqual(fr.querySelector('.accueil-finesse-lecture').textContent, 'Cran 6 : environ 41 par mois, retrouve 43 des 79');
  c.value = '5';
  c.dispatchEvent({ type: 'input' });
  assert.strictEqual(fr.querySelector('.accueil-finesse-lecture').textContent,
    'Cran 5 : environ 49 par mois, retrouve 49 des 79 (identique au cran 4)');
  c.dispatchEvent({ type: 'change' });
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_FINESSE),
    [{ type: MSG.ACCUEIL_FINESSE, moissonneur: 'parlement', typeFiche: 'intervention', langue: 'fr', cran: 5 }]);
  assert.strictEqual(de.querySelector('.accueil-finesse-curseur').value, '1', 'sans réglage : cran 1');
});

test('réglages : la table des dix crans de chaque langue — note dès, par mois, rappel, « = cran k », le réglage actif en texte', () => {
  const p = ouvrir();
  const r = rangeeCrans(p, 'parlement:fr');
  assert.ok(r && rangeeCrans(p, 'parlement:de'), 'une table par langue');
  assert.strictEqual(r.querySelector('.accueil-tache-nom').textContent, 'Les dix crans – Revue (fr)');
  const lignes = r.querySelector('tbody').querySelectorAll('tr');
  assert.strictEqual(lignes.length, 10);
  const cellules = (tr) => tr.querySelectorAll('td').map((td) => td.textContent);
  assert.deepStrictEqual(cellules(lignes[4]), ['= cran 4', '49', '49', '']);
  assert.deepStrictEqual(cellules(lignes[5]), ['18', '41', '43', '◀ réglage actif']);
  assert.deepStrictEqual(cellules(lignes[9]), ['78', '9', '–', '']);
  assert.strictEqual(lignes[0].querySelector('th').textContent, '1 · Large');
  assert.strictEqual(lignes[9].querySelector('th').textContent, '10 · Strict');
  assert.ok(lignes[5].classList.contains('accueil-finesse-actif'));
  const t = r.querySelector('thead').querySelectorAll('th').map((x) => x.textContent);
  assert.deepStrictEqual(t, ['Cran', 'Note dès', 'Par mois', 'Rappel (sur 79)', 'Réglage actif']);
  assert.strictEqual(r.querySelector('.accueil-tache-aide').textContent, 'Du 01.04.2026 au 30.09.2026, calculés le 01.10.2026.');
  // Sans réglage, le cran 1 est l'actif.
  assert.strictEqual(cellules(rangeeCrans(p, 'parlement:de').querySelector('tbody').querySelectorAll('tr')[0])[3], '◀ réglage actif');
});

test('réglages : crans_source dit quand une langue prend les déciles communs ; les catégories s’expliquent', () => {
  const p = ouvrir();
  assert.strictEqual(rangeeCrans(p, 'parlement:fr').querySelector('.accueil-moiss-commun'), null);
  assert.strictEqual(rangeeCrans(p, 'parlement:de').querySelector('.accueil-moiss-commun').textContent, 'Déciles communs.');
  const ol = p.un('.accueil-moiss-categories');
  assert.deepStrictEqual(ol.querySelectorAll('li').map((li) => li.textContent), ['terme dans le titre', 'signal faible']);
});
