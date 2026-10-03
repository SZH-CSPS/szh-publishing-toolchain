// Termes et demandes de la vue « Propositions » : ce que chaque terme ramène au cran regardé,
// le filtre sur un terme, et les demandes sur le lexique (écrire, confirmer, retirer, relire la
// réponse du moissonneur). Les lots, l'état et les demandes sont synthétiques
// (docs/FORMAT-PROPOSITIONS.md).
//
//   node --test test/js/propositions-termes.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-termes-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
let n = 0;
function racineNeuve() { n += 1; return path.join(TRAVAIL, 'r' + n); }

const SEUILS = [0, 5, 9, 12, 12, 18, 29, 38, 56, 78];
function crans() {
  return SEUILS.map((s, i) => ({ cran: i + 1, seuil: s, par_mois: 81 - i * 8, rappel: 73 - i * 6, rappel_sur: 79,
    identique_au_cran_precedent: i > 0 && SEUILS[i - 1] === s }));
}
function inter(id, score, termes, extra) {
  return Object.assign({
    format: 'pronto-proposition/1', cle: 'parlement:exemple:' + id, moissonneur: 'parlement', type: 'intervention',
    langue: 'fr', recolte: '2026-10-02T14:12:00Z', valeurs: { title: 'Objet ' + id, canton: 'GE' }, doutes: [], brut: {},
    pertinence: { verdict: 'retenu', raison: 'x', score: score, termes: termes }
  }, extra || {});
}
const T = (terme, role, noteSans, langue) => {
  const x = { terme: terme, langue: langue || 'fr', role: role, ou: 'texte' };
  if (noteSans !== undefined) { x.note_sans = noteSans; }
  return x;
};
// Au cran 6 (seuil 18) : A, B, D et E visibles, C masquée.
const LOT = [
  inter('A', 20, [T('inclusion', 'ancrage', 10), T('élèves', 'ecole', 19)]),
  inter('B', 30, [T('inclusion', 'ancrage', 25), T('logopédie', 'ancrage', 12)]),
  inter('C', 6, [T('inclusion', 'ancrage', 0)]),
  inter('D', 40, [T('handicap', 'ancrage')]),
  inter('E', 50, [T('handicap', 'ancrage'), T('école', 'ecole')])
];
function ecrireJson(chemin, objet) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, JSON.stringify(objet), 'utf8');
}
function etat(extra) {
  return Object.assign({ format: 'pronto-etat/1', moissonneur: 'parlement', derniere_moisson: '2026-10-01T05:12:00Z',
    crans: { fr: crans(), de: crans() }, rappel_sur: 79,
    termes: [{ terme: 'inclusion', langue: 'fr', role: 'ancrage', ref: 12, ref_seul: 0 },
      { terme: 'logopédie', langue: 'fr', role: 'ancrage', ref: 5, ref_seul: 2 },
      { terme: 'école', langue: 'fr', role: 'ecole', ref: 3, ref_seul: 1 }] }, extra || {});
}
function preparer(options) {
  const o = options || {};
  const racine = racineNeuve();
  const dossier = path.join(pr.cheminMoissons(racine), 'parlement');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, '2026-10-01-1.jsonl'), (o.lot || LOT).map((l) => JSON.stringify(l)).join('\n') + '\n');
  ecrireJson(path.join(dossier, 'etat.json'), etat(o.etat));
  if (o.reglage !== null) { pr.ecrireReglage(racine, 'fr', 'parlement', 'intervention', o.reglage || 6, 'Claire Exemple'); }
  return racine;
}
function ligne(r, terme, role) { return r.termes.find((x) => x.terme === terme && x.role === role); }
function fichierDemande(racine, id) { return path.join(pr.cheminMoissons(racine), 'parlement', 'demandes', id + '.json'); }
function poserReponse(racine, demandes, extra) {
  ecrireJson(path.join(pr.cheminMoissons(racine), 'parlement', 'etat.json'), etat(Object.assign({ demandes: demandes }, extra || {})));
}

// ---- Comptes par terme et par rôle ----------------------------------------------------------

test('termes : au cran du réglage, « ramène » compte les visibles, « seul à ramener » se lit sur note_sans', () => {
  const racine = preparer();
  const r = pr.comptesTermes(racine, 'fr').parlement;
  assert.ok(r, 'pas de comptes pour le parlement');
  assert.deepStrictEqual(r.types, { intervention: 6 });
  assert.strictEqual(r.visibles, 4);
  assert.strictEqual(r.total, 5);
  assert.strictEqual(r.rappelSur, 79);
  const inc = ligne(r, 'inclusion', 'ancrage');
  assert.deepStrictEqual([inc.ramene, inc.seul, inc.approx, inc.ref, inc.refSeul], [2, 1, false, 12, 0]);
  const log = ligne(r, 'logopédie', 'ancrage');
  assert.deepStrictEqual([log.ramene, log.seul, log.ref, log.refSeul], [1, 1, 5, 2]);
  const el = ligne(r, 'élèves', 'ecole');
  assert.deepStrictEqual([el.ramene, el.seul, el.ref, el.refSeul], [1, 0, null, null], 'un terme absent de etat.termes : donnée absente');
});

test('termes : sans note_sans, seule une proposition à un terme compte, et la ligne le signale', () => {
  const r = pr.comptesTermes(preparer(), 'fr').parlement;
  const h = ligne(r, 'handicap', 'ancrage');
  assert.deepStrictEqual([h.ramene, h.seul, h.approx], [2, 1, true]);
  const e = ligne(r, 'école', 'ecole');
  assert.deepStrictEqual([e.ramene, e.seul, e.approx], [1, 0, true]);
  assert.strictEqual(r.approx, true);
  assert.strictEqual(ligne(r, 'inclusion', 'ancrage').approx, false);
});

test('termes : les comptes suivent le cran regardé — réglage, puis aperçu du poste', () => {
  const racine = preparer({ reglage: 1 });
  let r = pr.comptesTermes(racine, 'fr').parlement;
  assert.strictEqual(r.visibles, 5);
  assert.deepStrictEqual([ligne(r, 'inclusion', 'ancrage').ramene, ligne(r, 'inclusion', 'ancrage').seul], [3, 0], 'au cran 1, rien n’est seul par la note');
  r = pr.comptesTermes(racine, 'fr', { intervention: 8 }).parlement;
  assert.deepStrictEqual(r.types, { intervention: 8 });
  assert.strictEqual(r.visibles, 2);
  assert.strictEqual(ligne(r, 'inclusion', 'ancrage').ramene, 0, 'un terme des seules masquées reste listé, à 0');
});

test('termes : un moissonneur sans crans ou sans termes n’a pas de vue Termes ; une autre langue ne compte pas', () => {
  const sansTermes = preparer({ lot: LOT.map((p) => Object.assign({}, p, { pertinence: { score: p.pertinence.score } })) });
  assert.deepStrictEqual(pr.comptesTermes(sansTermes, 'fr'), {});
  const sansCrans = preparer({ etat: { crans: undefined } });
  assert.deepStrictEqual(pr.comptesTermes(sansCrans, 'fr'), {});
  assert.deepStrictEqual(pr.comptesTermes(preparer(), 'de'), {});
});

test('filtre : les propositions qui portent un terme dans un rôle, jamais une expression régulière', () => {
  const avec = pr.filtrerSurTerme(LOT, { terme: 'inclusion', role: 'ancrage' }).map((p) => p.cle);
  assert.deepStrictEqual(avec, ['parlement:exemple:A', 'parlement:exemple:B', 'parlement:exemple:C']);
  assert.deepStrictEqual(pr.filtrerSurTerme(LOT, { terme: 'inclusion', role: 'ecole' }), []);
  assert.deepStrictEqual(pr.filtrerSurTerme(LOT, { terme: '.*', role: 'ancrage' }), []);
  assert.deepStrictEqual(pr.filtrerSurTerme(LOT, { terme: 'handicap' }).length, 2, 'sans rôle, tous les rôles');
  assert.strictEqual(pr.filtrerSurTerme(LOT, null).length, LOT.length);
});

// ---- Demandes ---------------------------------------------------------------------------------

test('demande : le terme est validé — 60 caractères, lettres, espaces, tirets, apostrophes ; langue fr, de ou it', () => {
  const racine = preparer();
  const ecrire = (terme, langue) => pr.ecrireDemande(racine, 'parlement', { terme: terme, langue: langue || 'fr', sens: 'exclusion', par: 'Claire Exemple' });
  assert.strictEqual(ecrire('.*').raison, 'terme-caractere');
  assert.strictEqual(ecrire('(').raison, 'terme-caractere');
  assert.strictEqual(ecrire('inclusion|handicap').raison, 'terme-caractere');
  assert.strictEqual(ecrire('a'.repeat(61)).raison, 'terme-long');
  assert.strictEqual(ecrire('   ').raison, 'terme-vide');
  assert.strictEqual(ecrire('ligne\nsuivante').raison, 'terme-caractere');
  assert.strictEqual(ecrire('handicap', 'en').raison, 'langue-invalide');
  assert.strictEqual(pr.ecrireDemande(racine, '../x', { terme: 'x', langue: 'fr', sens: 'ajout', par: 'A' }).raison, 'moissonneur-invalide');
  assert.strictEqual(pr.ecrireDemande(racine, 'parlement', { terme: 'x', langue: 'fr', sens: 'supprimer', par: 'A' }).raison, 'sens-invalide');
  assert.ok(!fs.existsSync(path.join(pr.cheminMoissons(racine), 'parlement', 'demandes')), 'rien d’écrit pour un refus');
  for (const t of ['a'.repeat(60), 'aujourd’hui', 'semi-autonomie', 'scuola speciale', 'Nachteilsausgleich']) {
    assert.strictEqual(ecrire(t, 'it').ok, true, t);
  }
  assert.strictEqual(pr.validerTerme('  élèves  ').terme, 'élèves');
});

test('demande : un fichier par demande, au nom sûr, écrit d’un coup, avec qui et quand', () => {
  const racine = preparer();
  const r = pr.ecrireDemande(racine, 'parlement', { terme: 'inclusion', langue: 'fr', sens: 'exclusion', par: 'Claire Exemple' });
  assert.strictEqual(r.ok, true);
  assert.match(r.demande.id, /^[A-Za-z0-9_-]{1,64}$/);
  const lu = JSON.parse(fs.readFileSync(fichierDemande(racine, r.demande.id), 'utf8'));
  assert.deepStrictEqual(Object.keys(lu).sort(), ['id', 'langue', 'le', 'par', 'sens', 'terme']);
  assert.deepStrictEqual([lu.id, lu.terme, lu.langue, lu.sens, lu.par], [r.demande.id, 'inclusion', 'fr', 'exclusion', 'Claire Exemple']);
  assert.match(lu.le, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(fichierDemande(racine, r.demande.id))), [r.demande.id + '.json'], 'aucun fichier temporaire');
  const r2 = pr.ecrireDemande(racine, 'parlement', { terme: 'logopédie', langue: 'fr', sens: 'exclusion', par: 'Claire Exemple' });
  assert.notStrictEqual(r2.demande.id, r.demande.id);
});

test('demande : une demande en double, encore en attente, est refusée par un code', () => {
  const racine = preparer();
  const d = { terme: 'inclusion', langue: 'fr', sens: 'exclusion', par: 'Claire Exemple' };
  const r = pr.ecrireDemande(racine, 'parlement', d);
  const doublon = pr.ecrireDemande(racine, 'parlement', Object.assign({}, d, { terme: ' Inclusion ', par: 'Jonas Beispiel' }));
  assert.strictEqual(doublon.ok, false);
  assert.strictEqual(doublon.raison, 'doublon');
  assert.strictEqual(doublon.demande.id, r.demande.id);
  assert.strictEqual(pr.ecrireDemande(racine, 'parlement', Object.assign({}, d, { sens: 'ajout' })).ok, true, 'un autre sens n’est pas un doublon');
  assert.strictEqual(pr.ecrireDemande(racine, 'parlement', Object.assign({}, d, { langue: 'de' })).ok, true, 'une autre langue non plus');
  // Une fois que le moissonneur a répondu, la même demande se refait.
  poserReponse(racine, [{ id: r.demande.id, statut: 'refuse-perte', fiches_perdues: ['X'], mesure_le: '2026-10-02' }]);
  assert.strictEqual(pr.ecrireDemande(racine, 'parlement', d).ok, true);
});

test('demande : listerDemandes fusionne les fichiers et la réponse du moissonneur ; sans réponse, en attente', () => {
  const racine = preparer();
  const a = pr.ecrireDemande(racine, 'parlement', { terme: 'inclusion', langue: 'fr', sens: 'exclusion', par: 'Claire Exemple' }).demande;
  const b = pr.ecrireDemande(racine, 'parlement', { terme: 'classe ressource', langue: 'fr', sens: 'ajout', par: 'Jonas Beispiel' }).demande;
  poserReponse(racine, [{ id: b.id, statut: 'applique-partiel', mesure_le: '2026-10-02',
    effet: { rappel_avant: 73, rappel_apres: 74, par_mois_avant: 81, par_mois_apres: 82, complet: false } }]);
  const l = pr.listerDemandes(racine, 'parlement');
  assert.deepStrictEqual(l.avertissements, []);
  const da = l.demandes.find((x) => x.id === a.id), db = l.demandes.find((x) => x.id === b.id);
  assert.deepStrictEqual([da.statut, da.par, da.terme, da.sens, da.effet], ['en-attente', 'Claire Exemple', 'inclusion', 'exclusion', null]);
  assert.deepStrictEqual([db.statut, db.par, db.mesure_le], ['applique-partiel', 'Jonas Beispiel', '2026-10-02']);
  assert.deepStrictEqual(db.effet, { rappel_avant: 73, rappel_apres: 74, par_mois_avant: 81, par_mois_apres: 82, complet: false });
  assert.deepStrictEqual(db.fiches_perdues, []);
});

test('demande : les demandes ignorées par le moissonneur, et les fichiers illisibles, remontent comme avertissements', () => {
  const racine = preparer();
  const dossier = path.join(pr.cheminMoissons(racine), 'parlement', 'demandes');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'casse.json'), '{ pas du json');
  ecrireJson(path.join(dossier, 'autre-nom.json'), { id: 'pas-le-meme', terme: 'x', langue: 'fr', sens: 'ajout', par: 'A', le: '2026-10-01T00:00:00Z' });
  fs.writeFileSync(path.join(dossier, 'nom avec espace.json'), '{}');
  poserReponse(racine, [], { demandes_ignorees: [{ fichier: 'nom avec espace.json', raison: 'id non sûr' }] });
  const l = pr.listerDemandes(racine, 'parlement');
  assert.deepStrictEqual(l.demandes, []);
  const codes = l.avertissements.map((a) => a.code + ':' + a.fichier).sort();
  assert.deepStrictEqual(codes, ['demande-ignoree:nom avec espace.json', 'demande-illisible:autre-nom.json',
    'demande-illisible:casse.json', 'demande-nom-invalide:nom avec espace.json']);
  assert.strictEqual(l.avertissements.find((a) => a.code === 'demande-ignoree').raison, 'id non sûr');
});

test('demande : « Appliquer quand même » se confirme par le demandeur seul, et seulement après un refus pour perte', () => {
  const racine = preparer();
  const d = pr.ecrireDemande(racine, 'parlement', { terme: 'inclusion', langue: 'fr', sens: 'exclusion', par: 'Claire Exemple' }).demande;
  assert.strictEqual(pr.confirmerDemande(racine, 'parlement', d.id, 'Claire Exemple').raison, 'pas-refusee');
  poserReponse(racine, [{ id: d.id, statut: 'refuse-perte', fiches_perdues: ['Objet réf. 1'], mesure_le: '2026-10-02' }]);
  assert.strictEqual(pr.confirmerDemande(racine, 'parlement', d.id, 'Jonas Beispiel').raison, 'pas-le-demandeur');
  assert.strictEqual(pr.confirmerDemande(racine, 'parlement', 'inconnue', 'Claire Exemple').raison, 'demande-introuvable');
  assert.strictEqual(pr.confirmerDemande(racine, 'parlement', '../x', 'Claire Exemple').raison, 'demande-introuvable');
  const r = pr.confirmerDemande(racine, 'parlement', d.id, 'Claire Exemple');
  assert.strictEqual(r.ok, true);
  const lu = JSON.parse(fs.readFileSync(fichierDemande(racine, d.id), 'utf8'));
  assert.strictEqual(lu.confirme_par, 'Claire Exemple');
  assert.match(lu.confirme_le, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(lu.par, 'Claire Exemple');
  assert.strictEqual(pr.confirmerDemande(racine, 'parlement', d.id, 'Claire Exemple').raison, 'deja-confirmee');
  const l = pr.listerDemandes(racine, 'parlement').demandes[0];
  assert.deepStrictEqual([l.confirme_par, l.fiches_perdues], ['Claire Exemple', ['Objet réf. 1']]);
});

test('demande : un poste sans nom ne confirme rien', () => {
  const racine = preparer();
  const d = pr.ecrireDemande(racine, 'parlement', { terme: 'inclusion', langue: 'fr', sens: 'exclusion', par: '—' }).demande;
  poserReponse(racine, [{ id: d.id, statut: 'refuse-perte', fiches_perdues: ['X'] }]);
  assert.strictEqual(pr.confirmerDemande(racine, 'parlement', d.id, '—').raison, 'auteur-inconnu');
});

test('demande : retirer — en attente, le fichier part ; appliquée, une demande de retrait s’écrit ; refusée ou en doublon, le fichier part', () => {
  const racine = preparer();
  const ecrire = (terme, sens) => pr.ecrireDemande(racine, 'parlement', { terme: terme, langue: 'fr', sens: sens, par: 'Claire Exemple' }).demande;
  const attente = ecrire('inclusion', 'exclusion');
  const appliquee = ecrire('jeux vidéo', 'exclusion');
  const partielle = ecrire('classe ressource', 'ajout');
  const bruit = ecrire('école', 'ajout');
  const doublon = ecrire('logopédie', 'ajout');
  poserReponse(racine, [{ id: appliquee.id, statut: 'applique' }, { id: partielle.id, statut: 'applique-partiel' },
    { id: bruit.id, statut: 'refuse-bruit' }, { id: doublon.id, statut: 'doublon' }]);

  let r = pr.retirerDemande(racine, 'parlement', attente.id, 'Jonas Beispiel');
  assert.deepStrictEqual([r.ok, r.action], [true, 'supprimee']);
  assert.ok(!fs.existsSync(fichierDemande(racine, attente.id)));
  assert.strictEqual(r.demande.terme, 'inclusion', 'le contenu retiré revient, pour Annuler');

  r = pr.retirerDemande(racine, 'parlement', appliquee.id, 'Jonas Beispiel');
  assert.deepStrictEqual([r.ok, r.action], [true, 'retrait']);
  assert.ok(fs.existsSync(fichierDemande(racine, appliquee.id)), 'une demande appliquée reste');
  const retrait = JSON.parse(fs.readFileSync(fichierDemande(racine, r.retrait.id), 'utf8'));
  assert.deepStrictEqual([retrait.sens, retrait.terme, retrait.langue, retrait.par], ['retrait', 'jeux vidéo', 'fr', 'Jonas Beispiel']);
  assert.strictEqual(pr.listerDemandes(racine, 'parlement').demandes.find((x) => x.id === appliquee.id).statut, 'retrait-en-attente');
  assert.strictEqual(pr.retirerDemande(racine, 'parlement', appliquee.id, 'Jonas Beispiel').raison, 'retrait-deja-demande');

  assert.strictEqual(pr.retirerDemande(racine, 'parlement', partielle.id, 'A').action, 'retrait');
  assert.strictEqual(pr.retirerDemande(racine, 'parlement', bruit.id, 'A').action, 'supprimee');
  assert.ok(!fs.existsSync(fichierDemande(racine, bruit.id)));
  const rd = pr.retirerDemande(racine, 'parlement', doublon.id, 'A');
  assert.strictEqual(rd.action, 'supprimee');
  assert.strictEqual(pr.retirerDemande(racine, 'parlement', 'inconnue', 'A').raison, 'demande-introuvable');

  // Annuler : le fichier retiré revient tel quel ; un retrait écrit se retire comme une demande en attente.
  assert.strictEqual(pr.retablirDemande(racine, 'parlement', rd.demande).ok, true);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(fichierDemande(racine, doublon.id), 'utf8')), rd.demande);
  assert.strictEqual(pr.retablirDemande(racine, 'parlement', rd.demande).raison, 'demande-presente');
  assert.strictEqual(pr.retablirDemande(racine, 'parlement', Object.assign({}, rd.demande, { id: '../x' })).ok, false);
  assert.strictEqual(pr.retirerDemande(racine, 'parlement', r.retrait.id, 'A').action, 'supprimee');
});

// ---- L'hôte de la Documentation ---------------------------------------------------------------

const { revueDEssai, activerHote } = require('./hote-factice');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const RACINE_ARBRE = kirby.racineArbre(REVUE);
const coedition = require(path.join(COCKPIT, 'lib', 'coedition-hote.js'));

function repartirHote(options) {
  const o = options || {};
  fs.rmSync(pr.cheminMoissons(RACINE_ARBRE), { recursive: true, force: true });
  delete HOTE.memoire['szh.propositions.finesse'];
  const dossier = path.join(pr.cheminMoissons(RACINE_ARBRE), 'parlement');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, '2026-10-01-1.jsonl'), (o.lot || LOT).map((l) => JSON.stringify(l)).join('\n') + '\n');
  ecrireJson(path.join(dossier, 'etat.json'), etat(o.etat));
  pr.ecrireReglage(RACINE_ARBRE, 'fr', 'parlement', 'intervention', o.reglage || 6, 'Claire Exemple');
}
function panneauDoc() { return HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop(); }
async function ouvrirPanneau(onglet, categorie) {
  await HOTE.executer('szh.ouvrirActualite', onglet || 'propositions', categorie);
  const p = panneauDoc();
  await p._recepteur({ type: MSG.PRET });
  return p;
}
function derniere(p, type) { return p.messages.filter((m) => m.type === type).pop(); }
async function charger(p) {
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_CHARGER });
  return derniere(p, MSG.PROP_DONNEES);
}
async function avecNom(nom, fn) {
  HOTE.configuration['szh.nomUtilisateur'] = nom;
  coedition.oublierIdentiteCoedition();
  try { return await fn(); } finally {
    delete HOTE.configuration['szh.nomUtilisateur'];
    coedition.oublierIdentiteCoedition();
  }
}

test('hôte : « Ouvrir Propositions › Termes » — un panneau neuf ouvre l’onglet Termes au premier envoi, un panneau ouvert le reçoit aussitôt', async () => {
  repartirHote();
  const p = await ouvrirPanneau('propositions', '_termes:parlement');
  const d = await charger(p);
  assert.deepStrictEqual(d.ongletDemande, { onglet: '_termes', moissonneur: 'parlement' });
  assert.strictEqual((await charger(p)).ongletDemande, undefined, 'une seule fois');
  p.messages.length = 0;
  await HOTE.executer('szh.ouvrirActualite', 'propositions', '_termes:parlement');
  assert.ok(p.messages.some((m) => m.type === MSG.ONGLET_ACTIVER && m.cle === 'propositions'));
  const poussee = derniere(p, MSG.PROP_DONNEES);
  assert.ok(poussee, 'le panneau ouvert reçoit les données');
  assert.deepStrictEqual(poussee.ongletDemande, { onglet: '_termes', moissonneur: 'parlement' });
});

test('hôte : PROP_DONNEES porte les comptes par terme et les demandes de chaque moissonneur à termes', async () => {
  repartirHote();
  const d = await charger(await ouvrirPanneau());
  const t = d.termes.parlement;
  assert.ok(t, 'pas de termes pour le parlement');
  assert.strictEqual(t.libelle, 'Interventions (OpenParlData)');
  assert.deepStrictEqual([t.visibles, t.total, t.rappelSur, t.approx], [4, 5, 79, true]);
  assert.deepStrictEqual(t.types, { intervention: 6 });
  const inc = t.termes.find((x) => x.terme === 'inclusion');
  assert.deepStrictEqual([inc.ramene, inc.seul, inc.ref, inc.refSeul], [2, 1, 12, 0]);
  assert.deepStrictEqual(d.demandes, { parlement: [] });
  assert.strictEqual(d.filtre, null);
});

test('hôte : PROP_DEMANDE_ECRIRE écrit la demande au nom du poste ; un doublon ou un terme invalide revient par un code', async () => {
  repartirHote();
  await avecNom('Poste Essai', async () => {
    const p = await ouvrirPanneau();
    p.messages.length = 0;
    await p._recepteur({ type: MSG.PROP_DEMANDE_ECRIRE, moissonneur: 'parlement', terme: 'inclusion', langue: 'fr', sens: 'exclusion' });
    let d = derniere(p, MSG.PROP_DONNEES);
    assert.strictEqual(d.demandeGeste.ok, true);
    assert.deepStrictEqual([d.demandeGeste.terme, d.demandeGeste.sens, d.demandeGeste.moissonneur], ['inclusion', 'exclusion', 'parlement']);
    const l = d.demandes.parlement;
    assert.strictEqual(l.length, 1);
    assert.deepStrictEqual([l[0].terme, l[0].par, l[0].statut], ['inclusion', 'Poste Essai', 'en-attente']);
    p.messages.length = 0;
    await p._recepteur({ type: MSG.PROP_DEMANDE_ECRIRE, moissonneur: 'parlement', terme: 'inclusion', langue: 'fr', sens: 'exclusion' });
    d = derniere(p, MSG.PROP_DONNEES);
    assert.deepStrictEqual([d.demandeGeste.ok, d.demandeGeste.raison], [false, 'doublon']);
    p.messages.length = 0;
    await p._recepteur({ type: MSG.PROP_DEMANDE_ECRIRE, moissonneur: 'parlement', terme: '.*', langue: 'fr', sens: 'ajout' });
    d = derniere(p, MSG.PROP_DONNEES);
    assert.deepStrictEqual([d.demandeGeste.ok, d.demandeGeste.raison, d.demandeGeste.caractere], [false, 'terme-caractere', '.']);
    assert.strictEqual(pr.listerDemandes(RACINE_ARBRE, 'parlement').demandes.length, 1);
  });
});

test('hôte : PROP_FILTRE_TERME filtre l’onglet du type, et le filtre tient jusqu’à ce qu’on le retire', async () => {
  repartirHote();
  const p = await ouvrirPanneau();
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_FILTRE_TERME, typeFiche: 'intervention', terme: 'inclusion', role: 'ancrage', langue: 'fr' });
  const f = derniere(p, MSG.PROP_DONNEES).filtre;
  assert.deepStrictEqual(f, { typeFiche: 'intervention', terme: 'inclusion', role: 'ancrage', langue: 'fr',
    cles: ['parlement:exemple:A', 'parlement:exemple:B', 'parlement:exemple:C'] });
  assert.deepStrictEqual((await charger(p)).filtre.cles.length, 3, 'le filtre survit à un rechargement');
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_FILTRE_TERME, typeFiche: 'intervention', terme: '' });
  assert.strictEqual(derniere(p, MSG.PROP_DONNEES).filtre, null);
  await p._recepteur({ type: MSG.PROP_FILTRE_TERME, typeFiche: 'inconnu', terme: 'inclusion', role: 'ancrage' });
  assert.strictEqual((await charger(p)).filtre, null, 'un type inconnu ne filtre rien');
});

// ---- La page : l'onglet Termes, le filtre, les demandes, Pourquoi --------------------------

const { ouvrir, libellesHote } = require('./dom-minimal');
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));

function pageDocumentation() {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const page = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css', '_propositions.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js', '_propositions.js'], txt: txt
  });
  page.envoyer({
    type: MSG.CHARGER, slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: doc._libelles.typesRessourceConfig('fr'), typesRubrique: [],
    rubriques: [], ressources: [], orphelines: [], vueInitiale: { onglet: 'propositions' }
  });
  return { page: page, txt: txt };
}
async function relayer(page, p) {
  const envoyes = JSON.parse(JSON.stringify(page.messages.splice(0)));
  for (const m of envoyes) {
    if (!/^prop/.test(m.type)) { continue; }
    p.messages.length = 0;
    await p._recepteur(m);
    for (const x of p.messages) {
      if (x.type === MSG.PROP_DONNEES || x.type === MSG.PROP_VERIFIE) { page.envoyer(JSON.parse(JSON.stringify(x))); }
    }
  }
  return envoyes;
}
function r(t, v) { let x = String(t); (v || []).forEach((y, i) => { x = x.split('{' + i + '}').join(String(y)); }); return x; }
function copie(x) { return JSON.parse(JSON.stringify(x)); }
function boutonOnglet(page, type) { return page.parId.barreCategories.querySelectorAll('button').find((x) => x.dataset.type === type); }
async function vueTermes(options) {
  repartirHote(options);
  const p = await ouvrirPanneau();
  await charger(p);
  const { page, txt } = pageDocumentation();
  await relayer(page, p);
  const panel = page.parId['panel-propositions'];
  boutonOnglet(page, '_termes').click();
  return { page: page, txt: txt, p: p, panel: panel };
}
function lignesTermes(panel) { return panel.querySelectorAll('tr').filter((tr) => tr.dataset.terme !== undefined); }
function nomsTermes(panel) { return lignesTermes(panel).map((tr) => tr.dataset.terme); }
function ligneTerme(panel, terme) { return lignesTermes(panel).find((tr) => tr.dataset.terme === terme); }
function enTete(panel, col) { return panel.querySelectorAll('th').find((th) => th.dataset.col === col); }
function lignesProp(panel) { return panel.querySelectorAll('tr').filter((tr) => tr.dataset.cle !== undefined); }

test('page : l’onglet Termes vient après les types, séparé par un filet', async () => {
  const { page, panel, txt } = await vueTermes();
  const enfants = page.parId.barreCategories.enfants;
  const i = enfants.findIndex((e) => e.dataset && e.dataset.type === '_termes');
  assert.ok(i > 0, 'onglet Termes absent');
  assert.ok(enfants[i - 1].classList.contains('prop-onglet-sep'), 'pas de filet avant Termes');
  assert.strictEqual(enfants[i - 1].getAttribute('aria-hidden'), 'true');
  assert.strictEqual(enfants[i].getAttribute('role'), 'tab');
  assert.strictEqual(enfants[i].getAttribute('aria-selected'), 'true');
  assert.ok(enfants[i].textContent.indexOf(txt.propTermesOnglet) !== -1);
  assert.ok(panel.querySelector('.prop-table-termes'), 'tableau des termes absent');
  assert.strictEqual(page.parId.titreVue.textContent, r(txt.propTitreVue, [txt.propTermesOnglet]));
  assert.strictEqual(panel.querySelector('.prop-termes-comptes').textContent, r(txt.propTermesComptesAu, [6, 4, 5]));
  assert.strictEqual(panel.querySelector('.prop-termes-segments'), null, 'un seul moissonneur : pas de choix');
});

test('page Termes : tri par défaut sur « seul à ramener » décroissant, aria-sort, puis par colonne', async () => {
  const { panel, txt } = await vueTermes();
  assert.deepStrictEqual(nomsTermes(panel), ['handicap', 'inclusion', 'logopédie', 'école', 'élèves']);
  assert.strictEqual(enTete(panel, 'seul').getAttribute('aria-sort'), 'descending');
  assert.strictEqual(enTete(panel, 'ramene').getAttribute('aria-sort'), null);
  enTete(panel, 'ramene').querySelector('.prop-tri').click();
  assert.deepStrictEqual(nomsTermes(panel), ['handicap', 'inclusion', 'école', 'élèves', 'logopédie']);
  assert.strictEqual(enTete(panel, 'ramene').getAttribute('aria-sort'), 'descending');
  assert.strictEqual(enTete(panel, 'seul').getAttribute('aria-sort'), null);
  enTete(panel, 'terme').querySelector('.prop-tri').click();
  assert.strictEqual(enTete(panel, 'terme').getAttribute('aria-sort'), 'ascending', 'un texte se trie d’abord croissant');
  assert.deepStrictEqual(nomsTermes(panel), ['école', 'élèves', 'handicap', 'inclusion', 'logopédie']);
  enTete(panel, 'terme').querySelector('.prop-tri').click();
  assert.strictEqual(enTete(panel, 'terme').getAttribute('aria-sort'), 'descending');
  assert.strictEqual(enTete(panel, 'seul').querySelector('.prop-tri').title, txt.propTermesTipSeul);
});

test('page Termes : recherche, filtre par rôle, filtre par langue, et le compte des lignes', async () => {
  const { panel, txt } = await vueTermes();
  const q = panel.querySelector('.prop-termes-chercher');
  assert.strictEqual(q.getAttribute('aria-label'), txt.propTermesChercher);
  q.value = 'INC';
  q.dispatchEvent({ type: 'input' });
  assert.deepStrictEqual(nomsTermes(panel), ['inclusion']);
  assert.strictEqual(panel.querySelector('.prop-termes-compte').textContent, r(txt.propTermesLignes, [1, 5]));
  q.value = '';
  q.dispatchEvent({ type: 'input' });
  const role = panel.querySelector('.prop-termes-role');
  role.value = 'ecole';
  role.dispatchEvent({ type: 'change' });
  assert.deepStrictEqual(nomsTermes(panel), ['école', 'élèves']);
  role.value = '';
  role.dispatchEvent({ type: 'change' });
  const langue = panel.querySelector('.prop-termes-langue');
  langue.value = 'de';
  langue.dispatchEvent({ type: 'change' });
  assert.deepStrictEqual(nomsTermes(panel), []);
  assert.ok(panel.querySelector('.prop-table-termes').querySelector('tbody').textContent.indexOf(txt.propTermesAucun) !== -1);
});

test('page Termes : un tiret pour une donnée absente, ≈ pour un compte approché, et les précautions sous le tableau', async () => {
  const { panel, txt } = await vueTermes();
  const cellules = (terme) => ligneTerme(panel, terme).querySelectorAll('td').map((td) => td.textContent);
  assert.deepStrictEqual(cellules('élèves').slice(1, 7), ['fr', txt.propRoleEcole, '1', '0', '–', '–']);
  assert.deepStrictEqual(cellules('logopédie').slice(3, 7), ['1', '1', '5', '2']);
  const seulHandicap = ligneTerme(panel, 'handicap').querySelectorAll('td')[4];
  assert.strictEqual(seulHandicap.textContent, '≈ 1');
  assert.strictEqual(seulHandicap.title, txt.propTermesApproxTip);
  const pied = panel.querySelector('.prop-termes-precautions').querySelectorAll('p').map((x) => x.textContent);
  assert.deepStrictEqual(pied, [txt.propTermesPrecaution1, txt.propTermesPrecaution2, txt.propTermesApprox]);
});

test('page Termes : « Ne plus proposer » est une icône, marquée quand réf. seul > 0 ; son panneau donne la mesure et prévient', async () => {
  const { page, panel, txt, p } = await vueTermes();
  const icone = (terme) => ligneTerme(panel, terme).querySelector('.prop-ne-plus');
  assert.strictEqual(icone('logopédie').textContent, '', 'une icône, pas un libellé');
  assert.ok(icone('logopédie').classList.contains('prop-ne-plus--ref'));
  assert.strictEqual(icone('logopédie').getAttribute('aria-label'), r(txt.propTermesNePlusRef, ['logopédie']));
  assert.strictEqual(icone('logopédie').title, icone('logopédie').getAttribute('aria-label'));
  assert.ok(icone('école').classList.contains('prop-ne-plus--ref'), 'une seule fiche de référence suffit');
  assert.ok(!icone('inclusion').classList.contains('prop-ne-plus--ref'));
  assert.strictEqual(icone('inclusion').getAttribute('aria-label'), r(txt.propTermesNePlusLabel, ['inclusion']));
  assert.strictEqual(icone('inclusion').getAttribute('aria-haspopup'), 'dialog');
  // Réf. seul > 0 : l'avertissement.
  icone('logopédie').click();
  let d = panel.querySelector('.prop-termes-panneau');
  assert.ok(d, 'panneau absent');
  assert.strictEqual(d.getAttribute('role'), 'dialog');
  assert.strictEqual(d.querySelector('.prop-termes-mesure').textContent, r(txt.propTermesMesure, [1, 5, 2]));
  assert.ok(d.querySelector('.prop-termes-avert').textContent.indexOf(r(txt.propTermesAvertRefSeulPlus, [2])) !== -1);
  assert.ok(d.textContent.indexOf(txt.propTermesInfo) !== -1);
  assert.strictEqual(d.querySelector('.prop-termes-demander').textContent, txt.propTermesDemanderQuandMeme,
    'un refus annoncé : le bouton le dit');
  d.querySelector('.prop-termes-fermer').click();
  assert.strictEqual(panel.querySelector('.prop-termes-panneau'), null);
  // Réf. seul = 0 : pas d'avertissement ; Demander écrit l'exclusion.
  icone('inclusion').click();
  d = panel.querySelector('.prop-termes-panneau');
  assert.strictEqual(d.querySelector('.prop-termes-mesure').textContent, r(txt.propTermesMesure, [1, 12, 0]));
  assert.strictEqual(d.querySelector('.prop-termes-avert'), null);
  assert.strictEqual(d.querySelector('.prop-termes-demander').textContent, txt.propTermesDemander);
  page.messages.length = 0;
  d.querySelector('.prop-termes-demander').click();
  assert.deepStrictEqual(copie(page.messages.filter((m) => m.type === MSG.PROP_DEMANDE_ECRIRE)),
    [{ type: MSG.PROP_DEMANDE_ECRIRE, moissonneur: 'parlement', terme: 'inclusion', langue: 'fr', sens: 'exclusion' }]);
  await relayer(page, p);
  assert.ok(ligneTerme(panel, 'inclusion').querySelector('.prop-termes-statut').textContent.indexOf(txt.propStEnAttente) !== -1);
  assert.strictEqual(icone('inclusion').disabled, true, 'une exclusion déjà demandée ne se redemande pas');
  assert.strictEqual(icone('inclusion').title, txt.propTermesDemandee);
  assert.ok(panel.querySelector('.prop-termes-avis').textContent.indexOf(r(txt.propTermesEcrite, [txt.propTermesSensExclusion, 'inclusion', 'fr'])) !== -1);
});

test('page Termes : un clic sur un terme ouvre l’onglet du type, filtré, avec son bandeau ; « retirer le filtre » le défait', async () => {
  const { page, panel, txt, p } = await vueTermes();
  page.messages.length = 0;
  ligneTerme(panel, 'inclusion').querySelector('.prop-terme').click();
  assert.deepStrictEqual(copie(page.messages.filter((m) => m.type === MSG.PROP_FILTRE_TERME)),
    [{ type: MSG.PROP_FILTRE_TERME, typeFiche: 'intervention', terme: 'inclusion', role: 'ancrage', langue: 'fr' }]);
  await relayer(page, p);
  assert.strictEqual(boutonOnglet(page, 'intervention').getAttribute('aria-selected'), 'true');
  assert.deepStrictEqual(lignesProp(panel).map((tr) => tr.querySelector('.prop-titre').textContent).sort(), ['Objet A', 'Objet B']);
  const b = panel.querySelector('.prop-termes-bandeau');
  assert.ok(b, 'bandeau absent');
  assert.ok(b.textContent.indexOf(r(txt.propTermesFiltre, ['inclusion', txt.propRoleAncrage, 2, 6, 1])) !== -1, b.textContent);
  page.messages.length = 0;
  b.querySelector('.prop-termes-retirer-filtre').click();
  assert.deepStrictEqual(copie(page.messages.filter((m) => m.type === MSG.PROP_FILTRE_TERME)),
    [{ type: MSG.PROP_FILTRE_TERME, typeFiche: 'intervention', terme: '' }]);
  await relayer(page, p);
  assert.strictEqual(panel.querySelector('.prop-termes-bandeau'), null);
  assert.strictEqual(lignesProp(panel).length, 4);
});

test('page Termes : « Ajouter un terme » valide en direct, signale le doublon en attente, puis écrit la demande', async () => {
  const { page, panel, txt, p } = await vueTermes();
  await p._recepteur({ type: MSG.PROP_DEMANDE_ECRIRE, moissonneur: 'parlement', terme: 'inclusion', langue: 'fr', sens: 'exclusion' });
  page.envoyer(copie(derniere(p, MSG.PROP_DONNEES)));
  const bouton = panel.querySelector('.prop-termes-ajouter');
  assert.strictEqual(bouton.getAttribute('aria-expanded'), 'false');
  bouton.click();
  const f = panel.querySelector('.prop-termes-form');
  assert.ok(f, 'formulaire absent');
  assert.strictEqual(panel.querySelector('.prop-termes-ajouter').getAttribute('aria-expanded'), 'true');
  const champ = f.querySelector('[id="prop-termes-form-terme"]');
  const erreur = f.querySelector('[id="prop-termes-form-erreur"]');
  const saisir = (v) => { champ.value = v; champ.dispatchEvent({ type: 'input' }); };
  saisir('(');
  assert.strictEqual(erreur.textContent, r(txt.propTermesErrCaractere, ['(']));
  assert.strictEqual(erreur.hidden, false);
  assert.strictEqual(champ.getAttribute('aria-invalid'), 'true');
  assert.strictEqual(champ.getAttribute('aria-describedby'), 'prop-termes-form-erreur');
  saisir('a'.repeat(61));
  assert.strictEqual(erreur.textContent, r(txt.propTermesErrLong, [61]));
  saisir('classe ressource');
  assert.strictEqual(erreur.hidden, true);
  assert.strictEqual(champ.getAttribute('aria-invalid'), 'false');
  assert.strictEqual(champ.getAttribute('aria-describedby'), null);
  // La même exclusion attend déjà la prochaine passe.
  const radio = (v) => f.querySelectorAll('input').find((x) => x.type === 'radio' && x.value === v);
  radio('exclusion').checked = true;
  radio('exclusion').dispatchEvent({ type: 'change' });
  saisir('Inclusion');
  assert.ok(erreur.textContent.indexOf(txt.propTermesErrDoublon.split(' (')[0]) === 0, erreur.textContent);
  assert.strictEqual(champ.getAttribute('aria-invalid'), 'true');
  page.messages.length = 0;
  f.dispatchEvent({ type: 'submit' });
  assert.strictEqual(page.messages.filter((m) => m.type === MSG.PROP_DEMANDE_ECRIRE).length, 0, 'un doublon ne part pas');
  saisir('classe ressource');
  radio('ajout').checked = true;
  radio('ajout').dispatchEvent({ type: 'change' });
  f.dispatchEvent({ type: 'submit' });
  assert.deepStrictEqual(copie(page.messages.filter((m) => m.type === MSG.PROP_DEMANDE_ECRIRE)),
    [{ type: MSG.PROP_DEMANDE_ECRIRE, moissonneur: 'parlement', terme: 'classe ressource', langue: 'fr', sens: 'ajout' }]);
  await relayer(page, p);
  assert.strictEqual(panel.querySelector('.prop-termes-form'), null, 'le formulaire se ferme après l’écriture');
  assert.ok(panel.querySelector('.prop-termes-avis').textContent.indexOf(r(txt.propTermesEcrite, [txt.propTermesSensAjout, 'classe ressource', 'fr'])) !== -1);
});

test('page : dans « Pourquoi », chaque terme ouvre un menu — voir ses propositions, ne plus le proposer', async () => {
  const { page, panel, txt, p } = await vueTermes();
  boutonOnglet(page, 'intervention').click();
  lignesProp(panel).find((tr) => tr.dataset.cle === 'parlement:exemple:A').querySelector('.prop-titre').click();
  const s = panel.querySelector('.prop-detail .prop-pourquoi');
  const termes = s.querySelectorAll('button').filter((b) => b.classList.contains('prop-pourquoi-terme'));
  assert.deepStrictEqual(termes.map((b) => b.querySelector('.prop-pourquoi-mot').textContent), ['inclusion', 'élèves']);
  assert.strictEqual(termes[0].getAttribute('aria-haspopup'), 'menu');
  assert.ok(s.textContent.indexOf(txt.propTermesPourquoiAide) !== -1);
  termes[0].click();
  const m = panel.querySelector('.prop-termes-menu');
  assert.ok(m, 'menu absent');
  assert.strictEqual(m.getAttribute('role'), 'menu');
  assert.strictEqual(m.getAttribute('aria-label'), r(txt.propTermesMenu, ['inclusion']));
  assert.deepStrictEqual(m.querySelectorAll('button').map((b) => b.textContent), [txt.propTermesVoir, txt.propTermesNePlus]);
  m.querySelectorAll('button')[1].click();
  assert.ok(panel.querySelector('.prop-termes-panneau'), 'Ne plus proposer ouvre le panneau de mesure');
  panel.querySelector('.prop-termes-fermer').click();
  termes[0].click();
  page.messages.length = 0;
  panel.querySelector('.prop-termes-menu').querySelectorAll('button')[0].click();
  assert.deepStrictEqual(copie(page.messages.filter((x) => x.type === MSG.PROP_FILTRE_TERME)),
    [{ type: MSG.PROP_FILTRE_TERME, typeFiche: 'intervention', terme: 'inclusion', role: 'ancrage', langue: 'fr' }]);
  await relayer(page, p);
  assert.ok(panel.querySelector('.prop-termes-bandeau'));
});

test('page : « Ouvrir Propositions › Termes » pose la vue sur l’onglet Termes', async () => {
  repartirHote();
  const p = await ouvrirPanneau();
  await charger(p);
  const { page } = pageDocumentation();
  await relayer(page, p);
  const panel = page.parId['panel-propositions'];
  assert.notStrictEqual(boutonOnglet(page, '_termes').getAttribute('aria-selected'), 'true');
  p.messages.length = 0;
  await HOTE.executer('szh.ouvrirActualite', 'propositions', '_termes:parlement');
  page.envoyer(copie(derniere(p, MSG.PROP_DONNEES)));
  assert.strictEqual(boutonOnglet(page, '_termes').getAttribute('aria-selected'), 'true');
  assert.ok(panel.querySelector('.prop-table-termes'));
});

// ---- Plusieurs moissonneurs à crans sur un même type -------------------------------------

test('plusieurs moissonneurs sur un type : chacun ses crans et son réglage, les comptes s’additionnent, « ? » donne chacun, « Garder » écrit les deux', async () => {
  repartirHote();
  // Un second moissonneur d'interventions, aux seuils plus hauts (ses propres déciles).
  const dossier = path.join(pr.cheminMoissons(RACINE_ARBRE), 'cantons');
  fs.mkdirSync(dossier, { recursive: true });
  const seuils2 = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const crans2 = seuils2.map((s, i) => ({ cran: i + 1, seuil: s, par_mois: 20 - i, rappel: 30 - i, rappel_sur: 40 }));
  ecrireJson(path.join(dossier, 'etat.json'), { format: 'pronto-etat/1', moissonneur: 'cantons', crans: { fr: crans2, de: crans2 } });
  const lot2 = [inter('K1', 55, [T('inclusion', 'ancrage', 0)], { cle: 'cantons:exemple:K1', moissonneur: 'cantons' }),
    inter('K2', 45, [T('inclusion', 'ancrage', 0)], { cle: 'cantons:exemple:K2', moissonneur: 'cantons' })];
  fs.writeFileSync(path.join(dossier, '2026-10-01-1.jsonl'), lot2.map((l) => JSON.stringify(l)).join('\n') + '\n');
  // Le parlement au cran 6, les cantons au cran 7 : chaque proposition suit le réglage de son moissonneur.
  pr.ecrireReglage(RACINE_ARBRE, 'fr', 'cantons', 'intervention', 7, 'Jonas Beispiel');
  const p = await ouvrirPanneau();
  const d = await charger(p);
  const f = d.finesse.intervention;
  assert.deepStrictEqual(f.moissonneurs, ['cantons', 'parlement']);
  assert.deepStrictEqual(Object.keys(f.parMoissonneur).sort(), ['cantons', 'parlement']);
  assert.strictEqual(f.parMoissonneur.cantons.crans[5].seuil, 50);
  assert.strictEqual(f.parMoissonneur.parlement.crans[5].seuil, 18);
  assert.strictEqual(f.parMoissonneur.cantons.reglage.cran, 7);
  const max = {};
  d.propositions.forEach((x) => { max[x.cle] = x.cranMax; });
  assert.strictEqual(max['cantons:exemple:K1'], 6, 'K1 se juge sur les crans des cantons : 55 ≥ 50');
  assert.strictEqual(max['cantons:exemple:K2'], 5);
  // La page : K1 et K2 masquées au cran 7 des cantons, A, B, D, E visibles au cran 6 du parlement.
  const { page, txt } = pageDocumentation();
  await relayer(page, p);
  const panel = page.parId['panel-propositions'];
  boutonOnglet(page, 'intervention').click();
  assert.strictEqual(boutonOnglet(page, 'intervention').querySelector('.doc-onglet-compte').textContent, '4', 'chaque proposition au réglage de son moissonneur');
  const aide = panel.querySelector('.prop-finesse-aide');
  assert.ok(aide.title.indexOf(r(txt.propFinesseDeMoissonneur, ['cantons'])) !== -1, aide.title);
  assert.ok(aide.title.indexOf(r(txt.propFinesseDeMoissonneur, ['Interventions (OpenParlData)'])) !== -1, aide.title);
  assert.ok(aide.title.indexOf(r(txt.propFinesseRappel, [24, 40])) !== -1, 'le rappel des cantons au cran du curseur (7) : ' + aide.title);
  assert.ok(aide.title.indexOf(r(txt.propFinesseRappel, [37, 79])) !== -1, 'le rappel du parlement au même cran');
  // L'aperçu du poste vaut pour tout le type ; « Garder » écrit les deux réglages.
  const c = panel.querySelector('.prop-finesse-curseur');
  c.value = '8';
  c.dispatchEvent({ type: 'change' });
  await relayer(page, p);
  assert.strictEqual(boutonOnglet(page, 'intervention').querySelector('.doc-onglet-compte').textContent, '2', 'D (40) et E (50) pour le parlement, aucun des cantons');
  await avecNom('Poste Essai', async () => {
    panel.querySelector('.prop-finesse-garder').click();
    await relayer(page, p);
  });
  const reg = pr.lireReglages(RACINE_ARBRE, 'fr');
  assert.deepStrictEqual([reg.parlement.intervention.cran, reg.cantons.intervention.cran], [8, 8]);
  assert.strictEqual(reg.cantons.intervention.par, 'Poste Essai');
});

test('libellés : les clés des termes et des demandes existent en fr et en de, sans « Vorschlag »', () => {
  const { TEXTES_COCKPIT } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  const cles = Object.keys(TEXTES_COCKPIT.fr).filter((k) => /^doc\.prop\.termes\.|^accueil\.regl\.moiss\.(st|expl|sens|demandes|retir|quandMeme|perte|confirm|effet|annul|ouvrirTermes|par$|mesure$|perdues|refus|ignoree|illisible)|^doc\.prop\.finesse\.deMoissonneur/.test(k));
  assert.ok(cles.length >= 110, 'trop peu de clés : ' + cles.length);
  for (const k of cles) {
    assert.ok(TEXTES_COCKPIT.de[k], 'clé allemande absente : ' + k);
    assert.ok(!/Vorschlag|Vorschläge/.test(TEXTES_COCKPIT.de[k]), k);
  }
});
