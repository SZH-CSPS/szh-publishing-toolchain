// Paramètres de l'Accueil (media/accueil.js) : la clé d'API Mistral sous Services en ligne
// (champ masqué, Enregistrer, Supprimer, Tester la clé), le modèle, et « Raccourcir les
// résumés » sous le Moissonnage, avec le compte, l'estimation, la progression et Arrêter.
//
//   node --test test/js/reglages-resumes.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ouvrirReglages, MSG, textesAccueil } = require('./page-reglages');

const TXT = textesAccueil();
// Un moissonneur, sans crans : la section Moissonnage se montre, et les résumés sous elle.
const MOISSONNAGE = { textes: { titre: 'Moissonnage', astuce: 'Astuce.', passe: 'Passé le {0}.', passeInconnue: 'Inconnue.',
  sansCrans: 'Pas de crans.', revues: { fr: 'Revue (fr)', de: 'Zeitschrift (de)' }, jetons: {} }, langue: 'fr',
moissonneurs: [{ id: 'recherche', libelle: 'Recherches', derniere: '', types: [{ type: 'recherche', libelle: 'Recherches' }],
  langues: { fr: { crans: null, source: '', reglages: {} }, de: { crans: null, source: '', reglages: {} } },
  calculeLe: '', fenetre: null, categories: [] }] };
function etat(extra) {
  return Object.assign({ type: MSG.ACCUEIL_RESUMES_ETAT, cle: false, modele: 'ministral-14b-2512', modeleDefaut: 'ministral-14b-2512',
    prompt: 'v6', langue: 'fr', disponible: true, candidats: 12, parType: { recherche: 12 }, jetons: 23456,
    enCours: null, bilan: null, test: null }, extra || {});
}
function ouvrir(e) {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: MOISSONNAGE });
  p.envoyer(e || etat());
  return p;
}
const bouton = (p, cls) => p.un('.' + cls);

test('clé Mistral : un champ masqué, la pastille « absente », Enregistrer grisé tant que rien n’est saisi', () => {
  const p = ouvrir();
  const r = p.parId('regl-mistral');
  assert.ok(r, 'rangée de la clé absente');
  assert.strictEqual(r.querySelector('.accueil-tache-nom').textContent, TXT.rgMistralCle);
  const champ = r.querySelector('input');
  assert.strictEqual(champ.type, 'password');
  assert.strictEqual(r.querySelector('.szh-pastille').textContent, TXT.rgAbsente);
  assert.strictEqual(bouton(p, 'accueil-mistral-enregistrer').disabled, true);
  assert.strictEqual(bouton(p, 'accueil-mistral-supprimer').hidden, true);
  assert.strictEqual(bouton(p, 'accueil-mistral-tester').disabled, true, 'rien à tester sans clé');
  champ.value = 'cle-saisie';
  champ.dispatchEvent({ type: 'input' });
  bouton(p, 'accueil-mistral-enregistrer').click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_MISTRAL_CLE), [{ type: MSG.ACCUEIL_MISTRAL_CLE, valeur: 'cle-saisie' }]);
  // L'hôte confirme : la saisie se vide, la pastille dit « définie », Supprimer et Tester apparaissent.
  p.envoyer(etat({ cle: true }));
  assert.strictEqual(champ.value, '');
  assert.strictEqual(r.querySelector('.szh-pastille').textContent, TXT.rgDefinie);
  assert.strictEqual(bouton(p, 'accueil-mistral-supprimer').hidden, false);
  bouton(p, 'accueil-mistral-tester').click();
  assert.strictEqual(p.postes(MSG.ACCUEIL_MISTRAL_TESTER).length, 1);
  bouton(p, 'accueil-mistral-supprimer').click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_MISTRAL_CLE).pop(), { type: MSG.ACCUEIL_MISTRAL_CLE, valeur: '' });
});

test('clé Mistral : le verdict du test s’affiche, et un état qui arrive pendant la frappe ne vide pas la saisie', () => {
  const p = ouvrir(etat({ cle: true, test: { ok: true, texte: 'Clé valide : 2 modèles accessibles, dont ministral-14b-2512.' } }));
  const r = p.parId('regl-mistral');
  assert.strictEqual(r.querySelector('.accueil-mistral-test').textContent, 'Clé valide : 2 modèles accessibles, dont ministral-14b-2512.');
  assert.ok(r.querySelector('.szh-notif--ok'));
  const champ = r.querySelector('input');
  champ.value = 'en-cours';
  champ.dispatchEvent({ type: 'input' });
  p.envoyer(etat({ cle: true, test: { ok: false, texte: 'Mistral refuse la clé.' } }));
  assert.strictEqual(champ.value, 'en-cours');
  assert.ok(r.querySelector('.szh-notif--attention'));
});

test('modèle : le modèle réglé, le défaut dans l’aide, Enregistrer seulement s’il change', () => {
  const p = ouvrir();
  const champ = p.tous('input').find((i) => i.type === 'text' && i.value === 'ministral-14b-2512');
  assert.ok(champ, 'champ du modèle absent');
  const b = bouton(p, 'accueil-mistral-modele');
  assert.strictEqual(b.disabled, true);
  champ.value = 'ministral-8b-2512';
  champ.dispatchEvent({ type: 'input' });
  b.click();
  assert.deepStrictEqual(p.postes(MSG.ACCUEIL_MISTRAL_MODELE), [{ type: MSG.ACCUEIL_MISTRAL_MODELE, valeur: 'ministral-8b-2512' }]);
  assert.ok(p.tous('.accueil-tache-aide').some((x) => x.textContent === TXT.rgMistralModeleAide.replace('{0}', 'ministral-14b-2512')));
});

test('raccourcir : sous le Moissonnage, le compte de la revue et l’estimation en jetons ; sans clé, le bouton est grisé', () => {
  const p = ouvrir();
  const s = p.parId('regl-resumes');
  assert.strictEqual(s.hidden, false);
  assert.strictEqual(s.querySelector('.accueil-tache-nom').textContent, TXT.rgRsTitre);
  assert.strictEqual(s.querySelector('.accueil-resumes-compte').textContent,
    '12 propositions à résumer pour la Revue, environ 23 456 jetons.');
  assert.strictEqual(s.querySelector('.accueil-resumes-lancer').disabled, true);
  assert.strictEqual(s.querySelector('.accueil-resumes-sans-cle').textContent, TXT.rgRsSansCle);
  p.envoyer(etat({ cle: true, candidats: 1, jetons: 2100, langue: 'de' }));
  assert.strictEqual(s.querySelector('.accueil-resumes-compte').textContent,
    '1 proposition à résumer pour la Zeitschrift, environ 2 100 jetons.');
  s.querySelector('.accueil-resumes-lancer').click();
  assert.strictEqual(p.postes(MSG.ACCUEIL_RESUMES_LANCER).length, 1);
  p.envoyer(etat({ cle: true, candidats: 0 }));
  assert.strictEqual(s.querySelector('.accueil-resumes-compte').textContent, 'Aucune proposition à résumer pour la Revue.');
  assert.strictEqual(s.querySelector('.accueil-resumes-lancer').disabled, true);
});

test('raccourcir : la progression, Arrêter, puis le bilan', () => {
  const p = ouvrir(etat({ cle: true, enCours: { fait: 4, total: 12, echecs: 0, jetons: 8000, arret: false } }));
  const s = p.parId('regl-resumes');
  assert.strictEqual(s.querySelector('.accueil-resumes-lancer'), null);
  const barre = s.querySelector('progress');
  assert.deepStrictEqual([String(barre.max), String(barre.value)], ['12', '4']);
  assert.ok(s.textContent.indexOf('4 sur 12, 8 000 jetons') !== -1);
  s.querySelector('.accueil-resumes-arreter').click();
  assert.strictEqual(p.postes(MSG.ACCUEIL_RESUMES_ARRETER).length, 1);
  p.envoyer(etat({ cle: true, enCours: { fait: 4, total: 12, echecs: 0, jetons: 8000, arret: true } }));
  assert.strictEqual(s.querySelector('.accueil-resumes-arreter').disabled, true);
  assert.ok(s.textContent.indexOf(TXT.rgRsArret) !== -1);
  p.envoyer(etat({ cle: true, candidats: 8, bilan: { ok: true, texte: 'Arrêté. Résumés écrits : 5 sur 12, 9000 jetons.' } }));
  assert.ok(s.querySelector('.szh-notif--ok').textContent.indexOf('Arrêté.') !== -1);
});

test('raccourcir : sans _Moissons, ou sans Moissonnage affiché, la section reste cachée', () => {
  const p = ouvrir(etat({ disponible: false }));
  assert.strictEqual(p.parId('regl-resumes').hidden, true);
  const q = ouvrirReglages();
  q.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false } });
  q.envoyer(etat());
  assert.strictEqual(q.parId('regl-resumes').hidden, true);
  // Les valeurs arrivent après l'état : la section suit le Moissonnage.
  q.envoyer({ type: MSG.VALEURS, valeurs: {}, poste: { produit: '', produitAuto: 'revue' },
    services: { shlinkUrl: '', shlinkCle: false, ojsCle: false }, moissonnage: MOISSONNAGE });
  assert.strictEqual(q.parId('regl-resumes').hidden, false);
});

test('libellés : chaque texte de la clé Mistral et des résumés existe en fr et en de, et diffère', () => {
  const fr = textesAccueil();
  process.env.SZH_LANGUE = 'de';
  let de;
  try { de = textesAccueil(); } finally { delete process.env.SZH_LANGUE; }
  const cles = Object.keys(fr).filter((x) => /^rg(Mistral|Rs)/.test(x));
  assert.strictEqual(cles.length, 18, 'libellés manquants : ' + cles.length);
  for (const k of cles) {
    assert.ok(fr[k] && de[k], 'libellé absent : ' + k);
    if (k !== 'rgRsRevueFr' && k !== 'rgRsRevueDe') { assert.notStrictEqual(fr[k], de[k], 'libellé identique : ' + k); }
  }
});
