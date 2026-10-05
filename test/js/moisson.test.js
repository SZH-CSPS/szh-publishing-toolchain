// La moisson vue du cockpit (lib/moisson.js), sans vscode : l'état partagé lu dans _Moissons
// (créneau, compteurs du mois, socle, imports FNS) et l'état d'une passe nourri par la fixture
// d'événements que les tests Python produisent (moissonneurs/tests/fixtures/passe-exemple.jsonl).
//
//   node --test test/js/moisson.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const moisson = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'moisson.js'));
const FIXTURE = path.join(RACINE, 'moissonneurs', 'tests', 'fixtures', 'passe-exemple.jsonl');

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-moisson-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
let n = 0;
function moissons() { const d = path.join(TRAVAIL, 'm' + (++n), '_Moissons'); fs.mkdirSync(d, { recursive: true }); return d; }
function ecrire(chemin, contenu) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
}
const iso = (d) => d.toISOString().slice(0, 19) + 'Z';

test('constantes : les mêmes que moissonneurs/creneau.py', () => {
  const py = fs.readFileSync(path.join(RACINE, 'moissonneurs', 'creneau.py'), 'utf8');
  const lire = (nom) => {
    const m = new RegExp('^' + nom + ' = ([0-9 *]+)', 'm').exec(py);
    assert.ok(m, nom + ' absent de creneau.py');
    return m[1].trim().split('*').reduce((a, x) => a * Number(x.trim()), 1);
  };
  assert.strictEqual(moisson.PERIME_S, lire('PERIME_S'));
  assert.strictEqual(moisson.ATTENTE_CRENEAU_S, lire('ATTENTE_S'));
  assert.strictEqual(moisson.MARGE_REQUETES, lire('MARGE_REQUETES'));
});

test('poste__compte : la normalisation de partage.normaliser', () => {
  assert.strictEqual(moisson.clePoste('PC-Rédaction 3', 'Zoë Müller'), 'pc-redaction-3__zoe-muller');
  assert.strictEqual(moisson.clePoste('  ', 'a.b_c'), '-__a.b_c');
  assert.strictEqual(moisson.normaliser('--Ärger!!'), 'arger');
});

test('créneau : une annonce vivante se montre, une périmée ou échue non ; une illisible est ignorée', () => {
  const m = moissons();
  const maintenant = new Date('2026-11-01T08:00:00Z');
  const annonce = (battement, echeance) => ({ format: 'pronto-creneau/1', poste: 'PC-B', compte: 'anna', debut: '2026-11-01T07:30:00Z',
    echeance: echeance, battement: battement, declencheur: 'cockpit', moissonneurs: ['parlement'] });
  ecrire(path.join(m, '_Creneau', 'pc-b__anna.json'), annonce('2026-11-01T07:59:00Z', '2026-11-01T09:00:00Z'));
  ecrire(path.join(m, '_Creneau', 'pc-c__ben.json'), annonce('2026-11-01T07:44:59Z', '2026-11-01T09:00:00Z'));
  ecrire(path.join(m, '_Creneau', 'pc-d__eva.json'), annonce('2026-11-01T07:59:00Z', '2026-11-01T07:59:59Z'));
  ecrire(path.join(m, '_Creneau', 'pc-e__x.json'), '{ illisible');
  ecrire(path.join(m, '_Creneau', 'pc-f__y.json'), Object.assign(annonce('hier', '2026-11-01T09:00:00Z')));
  const v = moisson.annoncesVivantes(m, maintenant);
  assert.deepStrictEqual(v.map((a) => [a.cle, a.poste, a.compte]), [['pc-b__anna', 'PC-B', 'anna']]);
  assert.strictEqual(iso(v[0].expire), '2026-11-01T08:14:00Z', 'battement + 15 min, avant l’échéance');
  assert.deepStrictEqual(moisson.annoncesVivantes(path.join(TRAVAIL, 'absent'), maintenant), []);
});

test('budget du mois : la somme de tous les postes, un compteur illisible ne compte pas', () => {
  const m = moissons();
  const d = path.join(m, 'parlement', '_partage', 'requetes', '2026-11');
  ecrire(path.join(d, 'a__x.json'), { format: 'pronto-requetes/1', mois: '2026-11', requetes: 500, maj: '' });
  ecrire(path.join(d, 'b__y.json'), { format: 'pronto-requetes/1', mois: '2026-11', requetes: 230, maj: '' });
  ecrire(path.join(d, 'c__z.json'), { requetes: -3 });
  ecrire(path.join(d, 'd__z.json'), 'rien');
  ecrire(path.join(m, 'parlement', '_partage', 'requetes', '2026-10', 'a__x.json'), { requetes: 700 });
  assert.strictEqual(moisson.sommeMois(m, 'parlement', '2026-11'), 730);
  assert.strictEqual(moisson.sommeMois(m, 'recherche', '2026-11'), 0);
  assert.strictEqual(moisson.moisDe(new Date('2026-11-30T23:30:00Z')), '2026-11');
  // Épuisé à budget − marge tout juste : le plafond vaudrait déjà 0.
  const M = moisson.MARGE_REQUETES;
  assert.strictEqual(moisson.epuise(800, 800 - M - 1), false);
  assert.strictEqual(moisson.epuise(800, 800 - M), true);
  assert.strictEqual(moisson.epuise(null, 9999), false, 'budget inconnu : rien n’est dit épuisé');
  assert.strictEqual(moisson.plafond(800, 600), 800 - M - 600);
  assert.strictEqual(moisson.plafond(800, 799), 0, 'jamais négatif');
});

test('socle, dernière exécution et dernier import FNS', () => {
  const m = moissons();
  assert.strictEqual(moisson.soclePresent(m, 'parlement'), false);
  ecrire(path.join(m, 'parlement', '_partage', 'socle-PC-B.json'), '{}');
  assert.strictEqual(moisson.soclePresent(m, 'parlement'), true, 'une copie en conflit compte');
  ecrire(path.join(m, 'parlement', 'etat.json'), { format: 'pronto-etat/1', derniere_moisson: '2026-11-01T06:10:00Z',
    lot: '2026-11-01-1.jsonl', propositions_ecrites: 14 });
  const d = moisson.derniereExecution(m, 'parlement');
  assert.deepStrictEqual([iso(d.date), d.lot, d.propositions], ['2026-11-01T06:10:00Z', '2026-11-01-1.jsonl', 14]);
  assert.strictEqual(moisson.dernierImportFns(m), null);
  const imp = path.join(m, 'recherche', '_partage', 'imports-fns');
  // `date` ne dit que le jour : deux imports du même jour se départagent par `heure`.
  ecrire(path.join(imp, '2026-12-01-pc-b__anna.json'), { format: 'pronto-import-fns/1', date: '2026-12-01', heure: '2026-12-01T08:00:00Z', poste: 'PC-B',
    compte: 'anna', fichier: { taille: 1, mtime: '2026-06-01T10:00:00Z', lignes: 90000, max_call_end: '2025-10-01' }, nouvelles: 12, lot: '' });
  ecrire(path.join(imp, '2026-12-01-pc-a__ben.json'), { format: 'pronto-import-fns/1', date: '2026-12-01', heure: '2026-12-01T09:00:00Z', poste: 'PC-A',
    compte: 'ben', fichier: { mtime: '2026-11-30T10:00:00Z' }, nouvelles: 15 });
  ecrire(path.join(imp, 'autre.json'), { format: 'autre/1', date: '2027-01-01T00:00:00Z' });
  const f = moisson.dernierImportFns(m);
  assert.deepStrictEqual([iso(f.date), f.poste, iso(f.fichierDate), f.nouvelles], ['2026-12-01T09:00:00Z', 'PC-A', '2026-11-30T10:00:00Z', 15]);
  // Sans `heure`, le jour de `date` suffit.
  const m2 = moissons();
  ecrire(path.join(m2, 'recherche', '_partage', 'imports-fns', 'a.json'), { format: 'pronto-import-fns/1', date: '2026-06-02', poste: 'PC-C' });
  assert.strictEqual(iso(moisson.dernierImportFns(m2).date), '2026-06-02T00:00:00Z');
});

test('bilans de passes : la plus récente, tous postes, sans les passes à blanc', () => {
  const m = moissons();
  assert.strictEqual(moisson.dernierePasse(m, 'parlement'), null);
  const bilan = (poste, debut, fin, extra) => Object.assign({ format: 'pronto-passe/1', moissonneur: 'parlement', poste: poste, compte: 'c',
    declencheur: 'cockpit', debut: debut, fin: fin, requetes: 10, code: 0, interrompu: null, lot: 'parlement/2026-11-01-1.jsonl',
    propositions: 4, hors_ligne: false, a_blanc: false }, extra || {});
  const d = path.join(m, 'parlement', '_partage', 'passes');
  ecrire(path.join(d, '2026-10', 'pc-a__c-20261031T060000Z.json'), bilan('PC-A', '2026-10-31T06:00:00Z', '2026-10-31T06:20:00Z'));
  ecrire(path.join(d, '2026-11', 'pc-b__c-20261101T060000Z.json'), bilan('PC-B', '2026-11-01T06:00:00Z', '2026-11-01T06:30:00Z'));
  ecrire(path.join(d, '2026-11', 'pc-c__c-20261102T060000Z.json'), bilan('PC-C', '2026-11-02T06:00:00Z', '2026-11-02T06:05:00Z', { a_blanc: true, lot: '' }));
  ecrire(path.join(d, '2026-11', 'illisible.json'), '{');
  const p = moisson.dernierePasse(m, 'parlement');
  assert.deepStrictEqual([iso(p.date), p.poste, p.lot, p.propositions], ['2026-11-01T06:30:00Z', 'PC-B', 'parlement/2026-11-01-1.jsonl', 4]);
});

test('FNS : la prochaine échéance, fin mai ou fin novembre, après la date donnée', () => {
  assert.deepStrictEqual(moisson.prochaineFns(new Date('2026-10-05T10:00:00Z')), { mois: 11, annee: 2026 });
  assert.deepStrictEqual(moisson.prochaineFns(new Date('2026-12-01T10:00:00Z')), { mois: 5, annee: 2027 });
  assert.deepStrictEqual(moisson.prochaineFns(new Date('2026-02-01T10:00:00Z')), { mois: 5, annee: 2026 });
  assert.deepStrictEqual(moisson.prochaineFns(new Date('2026-06-01T00:00:00Z')), { mois: 11, annee: 2026 });
});

test('estimation : la ligne du moissonneur, puis la durée bornée par le plafond du mois, plus l’attente du créneau', () => {
  const e = moisson.lireEstimation('bruit\n{"type":"estimation","requetes_prevues":400,"delai_s":2.0,"budget":800}\n');
  assert.deepStrictEqual(e, { requetes: 400, delai_s: 2, budget: 800 });
  assert.strictEqual(moisson.lireEstimation('rien'), null);
  const est = { parlement: e, recherche: { requetes: 60, delai_s: 3, budget: 3000 } };
  // parlement : au plus 800 − marge − 600 requêtes à 2 s ; recherche : 60 à 3 s.
  assert.strictEqual(moisson.dureeEstimee(est, { parlement: 600, recherche: 0 }, false),
    moisson.ATTENTE_CRENEAU_S + Math.min(400, 800 - moisson.MARGE_REQUETES - 600) * 2 + 180);
  assert.strictEqual(moisson.dureeEstimee(est, {}, true), 90, 'hors ligne : l’attente seule');
  assert.strictEqual(moisson.dureeEstimee({ parlement: { requetes: null, delai_s: 2, budget: 800 } }, {}, false), null);
});

test('passe : la fixture partagée avec les tests Python donne l’état attendu', () => {
  const p = moisson.nouvellePasse('mensuelle');
  const lignes = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter((l) => l.trim());
  assert.ok(lignes.length > 10, 'fixture vide');
  let avant = null;
  for (const l of lignes) {
    assert.strictEqual(moisson.appliquer(p, JSON.parse(l)), true, 'événement non reconnu : ' + l);
    if (JSON.parse(l).type === 'debut') { avant = p.phase; }
  }
  assert.strictEqual(avant, 'en-cours');
  assert.deepStrictEqual(p.ordre, ['parlement', 'recherche']);
  assert.deepStrictEqual(p.lignes.parlement.lot, { chemin: 'parlement/2026-11-01-1.jsonl', propositions: 14 });
  assert.deepStrictEqual(p.lignes.recherche.fin, { code: 3, interrompu: 'arret', plantage: false, echecs: ['phsg'] });
  assert.strictEqual(p.lignes.recherche.attente, null, 'l’attente se lève à l’étape suivante');
  assert.deepStrictEqual(p.fin, { code: 3, duree_s: 90 });
  assert.deepStrictEqual(p.avertissements.map((a) => a.moissonneur), ['parlement', 'recherche']);
  assert.strictEqual(moisson.appliquer(p, { type: 'etape' }), false, 'sans format, rien');
});

test('passe : un refus de créneau garde l’autre poste, puis la raison', () => {
  const p = moisson.nouvellePasse('mensuelle');
  moisson.appliquer(p, { format: 'pronto-moisson/1', type: 'creneau', etat: 'refuse', poste: 'PC-B', compte: 'anna', debut: '2026-11-01T07:30:00Z' });
  moisson.appliquer(p, { format: 'pronto-moisson/1', type: 'refus', raison: 'deja-en-cours', detail: '…' });
  assert.deepStrictEqual([p.creneauRefuse.poste, p.creneauRefuse.compte, iso(p.creneauRefuse.debut), p.refus.raison, p.phase],
    ['PC-B', 'anna', '2026-11-01T07:30:00Z', 'deja-en-cours', 'creneau']);
});
