// « Raccourcir les résumés » côté hôte (lib/resumes-hote.js), par l'Accueil : la clé Mistral dans
// le coffre et nulle part ailleurs, son test, le modèle, et la passe sur les propositions en
// attente, avec progression, arrêt et erreurs. Mistral est un faux serveur local.
//
//   node --test test/js/resumes-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Tout le poste est jetable : base, racines, état du compte, config.json, state.json.
const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-resumes-hote-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const LOCAL = path.join(TRAVAIL, 'Local');
const CONFIG = path.join(TRAVAIL, 'config.json');
const STATE = path.join(TRAVAIL, 'state.json');
Object.assign(process.env, {
  SZH_BASE: path.join(TRAVAIL, 'ProgramData'), SZH_RACINE_TEST: path.join(TRAVAIL, 'Base'),
  SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'), SZH_ANCRAGE: '', SZH_ONGLET: '', LOCALAPPDATA: LOCAL,
  SZH_CONFIG_OJS: CONFIG, SZH_ETAT_POSTE: STATE
});
delete process.env.SZH_ACCUEIL;
delete process.env.WSLENV;
fs.mkdirSync(path.join(TRAVAIL, 'ProgramData'), { recursive: true });
fs.mkdirSync(path.join(LOCAL, 'SZH'), { recursive: true });
fs.writeFileSync(CONFIG, '{}\n');
fs.writeFileSync(STATE, '{}\n');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const { revueDEssai, activerHote } = require('./hote-factice');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const HOTE = activerHote(revueDEssai(), { sansDossier: true });
const mistral = require(path.join(COCKPIT, 'lib', 'mistral.js'));
const resumes = require(path.join(COCKPIT, 'lib', 'resumes.js'));
const resumesHote = require(path.join(COCKPIT, 'lib', 'resumes-hote.js'));
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));
const services = require(path.join(COCKPIT, 'lib', 'services-env.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const BASE = path.join(TRAVAIL, 'Base');
const CLE = 'cle-mistral-essai-7a3f9c21e0d4';
const panneau = () => HOTE.panneauDeType('szhAccueil');
const etats = () => panneau().messages.filter((m) => m.type === MSG.ACCUEIL_RESUMES_ETAT);
const dernierEtat = () => etats().pop();
const envoyer = (msg) => panneau()._recepteur(msg);
const tick = async () => { for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); } };

// ---- Le faux Mistral ----------------------------------------------------------------------------
let serveur = null;
let recues = [];
let repondre = null;
async function demarrerServeur() {
  if (serveur) { await new Promise((r) => serveur.close(r)); }
  serveur = http.createServer((req, rep) => {
    let corps = '';
    req.on('data', (m) => { corps += m; });
    req.on('end', () => {
      recues.push({ methode: req.method, url: req.url, auth: req.headers.authorization, corps: corps ? JSON.parse(corps) : null });
      const r = repondre(req, corps ? JSON.parse(corps) : null);
      rep.writeHead(r.statut, { 'Content-Type': 'application/json' });
      rep.end(JSON.stringify(r.corps || {}));
    });
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + serveur.address().port;
  resumesHote.configurer({ creerClient: (cle) => mistral.creerClient({ cle: cle, base: base, attendre: () => Promise.resolve() }) });
}
const MODELES = { statut: 200, corps: { data: [{ id: 'ministral-8b-2512' }, { id: 'ministral-14b-2512' }] } };
function chat(texte) { return { statut: 200, corps: { choices: [{ message: { content: texte } }], usage: { total_tokens: 1500 } } }; }
// Un résumé de recherche dans la plage, sans nombre hors source.
const RESUME_RECHERCHE = ('Le projet étudie la lecture partagée en classe ordinaire et décrit les pratiques observées. ').repeat(8).trim();
const RESUME_INTERVENTION = ('La motion demande au gouvernement un plan pour une école inclusive. ').repeat(7).trim();
function repondreParDefaut(req, corps) {
  if (req.method === 'GET') { return MODELES; }
  const source = corps.messages[1].content;
  return chat(source.indexOf('[Document') !== -1 ? RESUME_INTERVENTION : RESUME_RECHERCHE);
}

// ---- Les propositions d'essai ------------------------------------------------------------------
const LONG = 'Le projet étudie la lecture partagée en classe ordinaire auprès de 48 élèves. '.repeat(24);
function recherche(id, descriptif) {
  return { format: 'pronto-proposition/1', cle: 'recherche:hepvd:' + id, moissonneur: 'recherche', type: 'recherche',
    langue: 'fr', recolte: '2026-10-04T10:00:00Z', lien_source: 'https://exemple.ch/' + id,
    valeurs: { title: 'Projet ' + id, institutions: 'HEP Exemple', debut: '2024', fin: '2026', descriptif: descriptif }, doutes: [], brut: {} };
}
function intervention(id, texte) {
  const p = { format: 'pronto-proposition/1', cle: 'parlement:openparldata:BE:' + id, moissonneur: 'parlement', type: 'intervention',
    langue: 'fr', recolte: '2026-10-04T10:00:00Z', lien_source: 'https://exemple.ch/' + id,
    valeurs: { title: 'Motion ' + id, canton: 'BE', categorie: 'motion', numero: 'M ' + id, date: '2026-03-04' }, doutes: [], brut: {} };
  if (texte) { p.texte_depose = texte; }
  return p;
}
function poserLots() {
  const m = pr.cheminMoissons(BASE);
  fs.rmSync(m, { recursive: true, force: true });
  const ecrire = (moissonneur, lignes) => {
    fs.mkdirSync(path.join(m, moissonneur), { recursive: true });
    fs.writeFileSync(path.join(m, moissonneur, '2026-10-04-1.jsonl'), lignes.map((l) => JSON.stringify(l)).join('\n') + '\n');
  };
  ecrire('recherche', [recherche('a', LONG), recherche('b', LONG + ' Suite.'), recherche('c', 'Court.')]);
  ecrire('parlement', [intervention('1', '[Document : texte déposé]\nLe Conseil-exécutif est chargé de présenter un plan.'), intervention('2')]);
}

// Tous les fichiers sous un dossier, pour y chercher la clé.
function fichiersSous(dossier) {
  const res = [];
  const voir = (d) => {
    let entrees = [];
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entrees) {
      const c = path.join(d, e.name);
      if (e.isDirectory()) { voir(c); } else { res.push(c); }
    }
  };
  voir(dossier);
  return res;
}

test('départ : l’Accueil s’ouvre et reçoit l’état des résumés, sans clé', async () => {
  await demarrerServeur();
  repondre = repondreParDefaut;
  await tick();
  assert.ok(panneau(), 'Accueil absent');
  await envoyer({ type: MSG.PRET });
  await tick();
  const e = dernierEtat();
  assert.ok(e, 'aucun état des résumés');
  assert.deepStrictEqual([e.cle, e.modele, e.modeleDefaut, e.prompt, e.langue], [false, 'ministral-14b-2512', 'ministral-14b-2512', 'v6', 'fr']);
  assert.strictEqual(e.disponible, false, 'sans _Moissons, la section se cache');
});

test('clé : enregistrée dans le coffre seulement, jamais dans un message, ni dans l’env de la chaîne', async () => {
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_CLE, valeur: '  ' + CLE + '  ' });
  await tick();
  assert.strictEqual(HOTE.coffre[resumesHote.CLE_COFFRE], CLE);
  assert.strictEqual(resumesHote.CLE_COFFRE, 'szh.mistralCle');
  assert.strictEqual(dernierEtat().cle, true);
  assert.ok(JSON.stringify(panneau().messages).indexOf(CLE) === -1, 'la clé est partie vers la page');
  assert.ok(JSON.stringify(services.variables()).indexOf(CLE) === -1, 'la clé dans l’env de la chaîne');
  assert.ok(JSON.stringify(HOTE.variablesTerminal).indexOf(CLE) === -1, 'la clé dans l’env des terminaux');
  assert.ok(JSON.stringify(HOTE.configuration).indexOf(CLE) === -1, 'la clé dans les réglages de l’éditeur');
});

test('tester : GET /v1/models avec la clé ; le verdict nomme le modèle, jamais la clé', async () => {
  recues = [];
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_TESTER });
  assert.deepStrictEqual(recues.map((r) => [r.methode, r.url, r.auth]), [['GET', '/v1/models', 'Bearer ' + CLE]]);
  assert.deepStrictEqual(dernierEtat().test, { ok: true, texte: T('resumes.test.ok', [2, 'ministral-14b-2512']) });
  repondre = () => ({ statut: 401, corps: { message: 'Unauthorized' } });
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_TESTER });
  assert.deepStrictEqual(dernierEtat().test, { ok: false, texte: T('resumes.err.cle-refusee') });
  repondre = repondreParDefaut;
  assert.ok(JSON.stringify(panneau().messages).indexOf(CLE) === -1);
});

test('modèle : réglable, validé ; le test dit quand la clé ne l’ouvre pas', async () => {
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_MODELE, valeur: 'Mistral Large !' });
  assert.strictEqual(HOTE.configuration['szh.mistralModele'], undefined);
  assert.deepStrictEqual(dernierEtat().test, { ok: false, texte: T('resumes.modele.invalide') });
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_MODELE, valeur: 'mistral-small-2603' });
  assert.strictEqual(HOTE.configuration['szh.mistralModele'], 'mistral-small-2603');
  assert.strictEqual(dernierEtat().modele, 'mistral-small-2603');
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_TESTER });
  assert.deepStrictEqual(dernierEtat().test, { ok: false, texte: T('resumes.test.sansModele', [2, 'mistral-small-2603']) });
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_MODELE, valeur: '' });
  assert.strictEqual(dernierEtat().modele, 'ministral-14b-2512', 'vide : le modèle des prompts');
});

test('passe : le compte et l’estimation, puis un fichier par proposition, la progression pas à pas', async () => {
  poserLots();
  await envoyer({ type: MSG.ACCUEIL_ONGLET, onglet: 'reglages' });
  const avant = dernierEtat();
  assert.strictEqual(avant.disponible, true);
  assert.deepStrictEqual([avant.candidats, avant.parType], [3, { recherche: 2, intervention: 1 }],
    'deux recherches trop longues et l’intervention qui a un texte déposé');
  assert.ok(avant.jetons > 1000, 'une estimation en jetons : ' + avant.jetons);
  recues = [];
  panneau().messages.length = 0;
  await envoyer({ type: MSG.ACCUEIL_RESUMES_LANCER });
  await resumesHote.finPasse();
  const pas = etats().filter((e) => e.enCours).map((e) => e.enCours.fait);
  assert.deepStrictEqual(pas, [0, 1, 2, 3]);
  const fin = dernierEtat();
  assert.strictEqual(fin.enCours, null);
  assert.deepStrictEqual(fin.bilan, { ok: true, texte: T('resumes.bilan.fini', [3, 3, 4500]), echecs: 0 });
  assert.strictEqual(fin.candidats, 0, 'les résumés valides sont sautés');
  assert.strictEqual(recues.length, 3);
  assert.ok(recues.every((r) => r.url === '/v1/chat/completions' && r.corps.model === 'ministral-14b-2512'));
  const ri = resumes.lireResume(BASE, 'fr', 'parlement:openparldata:BE:1');
  assert.deepStrictEqual([ri.texte, ri.mode, ri.prompt, ri.poste], [RESUME_INTERVENTION, 'creer', 'v6', os.hostname()]);
  assert.strictEqual(resumes.lireResume(BASE, 'fr', 'recherche:hepvd:a').texte, RESUME_RECHERCHE);
  assert.strictEqual(resumes.lireResume(BASE, 'fr', 'recherche:hepvd:c'), null, 'un descriptif court ne part pas');
  assert.strictEqual(resumes.lireResume(BASE, 'fr', 'parlement:openparldata:BE:2'), null, 'sans texte déposé, rien');
});

test('clé jamais écrite : aucun fichier du poste jetable ne la contient', () => {
  const fichiers = fichiersSous(TRAVAIL);
  assert.ok(fichiers.some((f) => f.indexOf('_Resumes') !== -1), 'la passe a bien écrit');
  for (const f of fichiers) {
    assert.ok(fs.readFileSync(f).indexOf(CLE) === -1, 'la clé est écrite dans ' + f);
  }
});

test('arrêter : la passe finit la proposition en cours et s’arrête', async () => {
  poserLots();
  let liberer = null;
  const porte = new Promise((r) => { liberer = r; });
  resumesHote.configurer({ creerClient: () => ({ chat: async () => { await porte; return { texte: 'Un résumé court.', jetons: 10 }; } }) });
  try {
    panneau().messages.length = 0;
    await envoyer({ type: MSG.ACCUEIL_RESUMES_LANCER });
    await tick();
    assert.deepStrictEqual(dernierEtat().enCours, { fait: 0, total: 3, echecs: 0, jetons: 0, arret: false });
    await envoyer({ type: MSG.ACCUEIL_RESUMES_ARRETER });
    assert.strictEqual(dernierEtat().enCours.arret, true);
    liberer();
    await resumesHote.finPasse();
    assert.deepStrictEqual(dernierEtat().bilan, { ok: true, texte: T('resumes.bilan.arrete', [1, 3, 10]), echecs: 0 });
    assert.strictEqual(dernierEtat().candidats, 2);
  } finally {
    await demarrerServeur();
  }
});

test('erreur : une clé refusée arrête la passe au premier appel, avec un message clair', async () => {
  poserLots();
  repondre = () => ({ statut: 401 });
  try {
    await envoyer({ type: MSG.ACCUEIL_RESUMES_LANCER });
    await resumesHote.finPasse();
    const e = dernierEtat();
    assert.deepStrictEqual(e.bilan, { ok: false, texte: T('resumes.err.cle-refusee'), echecs: 1 });
    assert.strictEqual(e.candidats, 3, 'rien n’est écrit');
    process.env.SZH_LANGUE = 'de';
    try { assert.notStrictEqual(T('resumes.err.cle-refusee'), e.bilan.texte, 'le message existe aussi en allemand'); }
    finally { delete process.env.SZH_LANGUE; }
  } finally { repondre = repondreParDefaut; }
});

test('sans clé : la passe ne part pas et le dit', async () => {
  await envoyer({ type: MSG.ACCUEIL_MISTRAL_CLE, valeur: '' });
  await tick();
  assert.strictEqual(HOTE.coffre[resumesHote.CLE_COFFRE], undefined);
  recues = [];
  await envoyer({ type: MSG.ACCUEIL_RESUMES_LANCER });
  await resumesHote.finPasse();
  assert.deepStrictEqual(dernierEtat().bilan, { ok: false, texte: T('resumes.err.cle-absente') });
  assert.strictEqual(recues.length, 0);
  await new Promise((r) => serveur.close(r));
});
