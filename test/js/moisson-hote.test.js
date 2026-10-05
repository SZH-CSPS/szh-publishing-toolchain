// « Moisson mensuelle » et « Données FNS » côté hôte (lib/moisson-hote.js), par l'Accueil : l'état
// partagé lu dans _Moissons, la raison d'un bouton désactivé, l'estimation puis la confirmation, la
// passe relayée événement par événement, Arrêter, et l'import FNS. moisson.py est un faux
// exécutable qui rejoue la fixture d'événements des tests Python.
//
//   node --test test/js/moisson-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-moisson-hote-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const CONFIG = path.join(TRAVAIL, 'config.json');
const STATE = path.join(TRAVAIL, 'state.json');
Object.assign(process.env, {
  SZH_BASE: path.join(TRAVAIL, 'ProgramData'), SZH_RACINE_TEST: path.join(TRAVAIL, 'Base'),
  SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'), SZH_ANCRAGE: '', SZH_ONGLET: '', LOCALAPPDATA: path.join(TRAVAIL, 'Local'),
  SZH_CONFIG_OJS: CONFIG, SZH_ETAT_POSTE: STATE
});
delete process.env.SZH_ACCUEIL;
delete process.env.WSLENV;
fs.mkdirSync(path.join(TRAVAIL, 'ProgramData'), { recursive: true });
fs.mkdirSync(path.join(TRAVAIL, 'Local', 'SZH'), { recursive: true });
fs.writeFileSync(CONFIG, '{}\n');
fs.writeFileSync(STATE, '{}\n');

const RACINE_DEPOT = path.join(__dirname, '..', '..');
const COCKPIT = path.join(RACINE_DEPOT, 'vscodium-extension', 'szh-cockpit');
const { revueDEssai, activerHote } = require('./hote-factice');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const HOTE = activerHote(revueDEssai(), { sansDossier: true });
const moissonHote = require(path.join(COCKPIT, 'lib', 'moisson-hote.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const { MARGE_REQUETES } = require(path.join(COCKPIT, 'lib', 'moisson.js'));
const FIXTURE = fs.readFileSync(path.join(RACINE_DEPOT, 'moissonneurs', 'tests', 'fixtures', 'passe-exemple.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim());

const BASE = path.join(TRAVAIL, 'Base');
const MOISSONS = path.join(BASE, '_NewsUndActu', '_Moissons');
const MAINTENANT = new Date('2026-11-01T08:00:00Z');
const panneau = () => HOTE.panneauDeType('szhAccueil');
const etats = () => panneau().messages.filter((m) => m.type === MSG.ACCUEIL_MOISSON_ETAT);
const dernierEtat = () => etats().pop();
const envoyer = (msg) => panneau()._recepteur(msg);
const tick = async () => { for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); } };
function ecrire(chemin, contenu) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, typeof contenu === 'string' ? contenu : JSON.stringify(contenu));
}

// ---- Le faux moteur -----------------------------------------------------------------------------
// Chaque appel est noté ; `estimer` répond aussitôt, une passe attend que le test lui donne ses lignes.
let appels = [];
let passeEnCours = null;
let estimation = { parlement: { requetes: 300, delai_s: 2.0, budget: 800 }, recherche: { requetes: 60, delai_s: 3.0, budget: 3000 } };
function fauxProcessus() {
  const p = new EventEmitter();
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.finir = (code) => { p.stdout.end(); p.stderr.end(); setImmediate(() => p.emit('close', code)); };
  return p;
}
function executer(argv) {
  appels.push(argv.slice());
  const p = fauxProcessus();
  const commande = argv[3];
  if (commande === 'estimer') {
    const e = estimation[argv[4]];
    if (e) { p.stdout.write(JSON.stringify(Object.assign({ type: 'estimation', avertissements: [] }, e)) + '\n'); }
    p.finir(e ? 0 : 2);
    return p;
  }
  passeEnCours = p;
  return p;
}
function evenements(lignes) { for (const l of lignes) { passeEnCours.stdout.write(l + '\n'); } }

let racineTest = false;
const ARRETS = path.join(TRAVAIL, 'arrets');
moissonHote.configurer({ dossierArret: () => ARRETS, executer: executer, racineTest: () => racineTest, poste: () => 'PC-A', compte: () => 'robin',
  maintenant: () => MAINTENANT, script: () => '/mnt/c/ProgramData/SZH/toolkit/moissonneurs/moisson.py' });

function poserSocles() {
  for (const m of ['parlement', 'recherche']) {
    ecrire(path.join(MOISSONS, m, '_partage', 'socle.json'), { format: 'pronto-socle/1' });
    ecrire(path.join(MOISSONS, m, 'etat.json'), { format: 'pronto-etat/1', derniere_moisson: '2026-10-01T06:10:00Z',
      lot: '2026-10-01-1.jsonl', propositions_ecrites: 3 });
  }
}
async function ouvrirReglages() {
  await envoyer({ type: MSG.ACCUEIL_ONGLET, onglet: 'reglages' });
  await tick();
  return dernierEtat();
}

test('sans _Moissons : le bloc se montre, désactivé, avec sa raison', async () => {
  await tick();
  await envoyer({ type: MSG.PRET });
  await tick();
  const e = dernierEtat();
  assert.ok(e, 'aucun état de la moisson à l’ouverture');
  assert.deepStrictEqual([e.disponible, e.raison, e.fns], [false, T('moisson.raison.racine'), null]);
  assert.strictEqual(e.textes.titre, T('moisson.titre'));
});

test('sans socle : désactivé, « publier le socle depuis le poste de développement »', async () => {
  fs.mkdirSync(path.join(MOISSONS, 'parlement'), { recursive: true });
  const e = await ouvrirReglages();
  assert.deepStrictEqual([e.disponible, e.raison], [true, T('moisson.raison.socle')]);
  assert.ok(e.moissonneurs[0].ligne.indexOf(T('moisson.sansSocle')) !== -1);
  assert.strictEqual(e.fns.raison, T('moisson.raison.socle'), 'sans socle de la recherche, pas d’import FNS');
  assert.ok(!appels.some((a) => a[3] === 'estimer'), 'estimer sans socle ne sert à rien');
});

test('budget : estimer une fois par session ; la ligne dit somme/budget ; épuisé pour tous, désactivé', async () => {
  poserSocles();
  appels = [];
  ecrire(path.join(MOISSONS, 'parlement', '_partage', 'requetes', '2026-11', 'pc-b__anna.json'), { requetes: 760 });
  ecrire(path.join(MOISSONS, 'recherche', '_partage', 'requetes', '2026-11', 'pc-b__anna.json'), { requetes: 120 });
  await ouvrirReglages();
  await tick();
  assert.deepStrictEqual(appels.map((a) => [a[3], a[4]]), [['estimer', 'parlement'], ['estimer', 'recherche']]);
  let e = dernierEtat();
  assert.ok(e.moissonneurs[0].ligne.indexOf(T('moisson.moisSur', [760, 800])) !== -1, e.moissonneurs[0].ligne);
  assert.ok(e.moissonneurs[0].ligne.indexOf(T('moisson.derniere', ['01.10.2026', '2026-10-01-1.jsonl', T('moisson.propositions.plus', [3])])) !== -1,
    'sans bilan de passe, etat.json : ' + e.moissonneurs[0].ligne);
  // Un bilan de passe dit le poste ; une passe à blanc ne compte pas.
  const passes = path.join(MOISSONS, 'parlement', '_partage', 'passes', '2026-10');
  ecrire(path.join(passes, 'pc-b__anna-20261020T060000Z.json'), { format: 'pronto-passe/1', moissonneur: 'parlement', poste: 'PC-B',
    compte: 'anna', declencheur: 'cockpit', debut: '2026-10-20T06:00:00Z', fin: '2026-10-20T06:20:00Z', requetes: 40, code: 0,
    interrompu: null, lot: 'parlement/2026-10-20-1.jsonl', propositions: 9, hors_ligne: false, a_blanc: false });
  ecrire(path.join(passes, 'pc-c__eva-20261021T060000Z.json'), { format: 'pronto-passe/1', moissonneur: 'parlement', poste: 'PC-C',
    compte: 'eva', declencheur: 'cli', debut: '2026-10-21T06:00:00Z', fin: '2026-10-21T06:20:00Z', requetes: 40, code: 0,
    interrompu: null, lot: '', propositions: 0, hors_ligne: false, a_blanc: true });
  e = await ouvrirReglages();
  assert.ok(e.moissonneurs[0].ligne.startsWith(T('moisson.derniere', ['20.10.2026', 'parlement/2026-10-20-1.jsonl', T('moisson.propositions.plus', [9])])
    + ' ' + T('moisson.depuisPoste', ['PC-B'])), e.moissonneurs[0].ligne);
  fs.rmSync(path.join(MOISSONS, 'parlement', '_partage', 'passes'), { recursive: true });
  assert.strictEqual(e.raison, '', 'recherche a encore du budget');
  ecrire(path.join(MOISSONS, 'recherche', '_partage', 'requetes', '2026-11', 'pc-b__anna.json'), { requetes: 2950 });
  e = await ouvrirReglages();
  assert.strictEqual(e.raison, T('moisson.raison.budget'));
  assert.strictEqual(appels.filter((a) => a[3] === 'estimer').length, 2, 'pas de second estimer dans la session');
  // Racine de test : hors ligne, le budget n'arrête rien.
  racineTest = true;
  e = await ouvrirReglages();
  assert.strictEqual(e.raison, '');
  racineTest = false;
  fs.rmSync(path.join(MOISSONS, 'parlement', '_partage', 'requetes'), { recursive: true });
  fs.rmSync(path.join(MOISSONS, 'recherche', '_partage', 'requetes'), { recursive: true });
});

test('créneau vivant d’un autre poste : le bouton le dit, avec le poste et l’heure', async () => {
  const annonce = { format: 'pronto-creneau/1', poste: 'PC-B', compte: 'anna', debut: '2026-11-01T07:30:00Z',
    echeance: '2026-11-01T09:00:00Z', battement: '2026-11-01T07:59:00Z', declencheur: 'cockpit', moissonneurs: ['parlement'] };
  ecrire(path.join(MOISSONS, '_Creneau', 'pc-b__anna.json'), annonce);
  const local = (iso) => { const d = new Date(iso); return [String(d.getHours()).padStart(2, '0'), String(d.getMinutes()).padStart(2, '0')]; };
  const attendu = T('moisson.creneau.autre', ['PC-B', 'anna', T('moisson.heure', local(annonce.debut)),
    T('moisson.heure', local(annonce.echeance))]);
  let e = await ouvrirReglages();
  assert.deepStrictEqual([e.creneau, e.raison], [attendu, attendu]);
  // Préparer quand même : refusé sans rien lancer.
  appels = [];
  await envoyer({ type: MSG.ACCUEIL_MOISSON_PREPARER });
  assert.deepStrictEqual(appels, []);
  assert.strictEqual(dernierEtat().bilan.texte, attendu);
  // Notre propre annonce restée après une coupure : elle se dit autrement, avec son expiration.
  fs.rmSync(path.join(MOISSONS, '_Creneau', 'pc-b__anna.json'));
  ecrire(path.join(MOISSONS, '_Creneau', 'pc-a__robin.json'), Object.assign({}, annonce, { poste: 'PC-A', compte: 'robin' }));
  e = await ouvrirReglages();
  assert.strictEqual(e.creneau, T('moisson.creneau.moi', [T('moisson.heure', local(annonce.debut)),
    T('moisson.heure', local('2026-11-01T08:14:00Z'))]));
  fs.rmSync(path.join(MOISSONS, '_Creneau'), { recursive: true });
});

test('lancer : estimer, puis la confirmation « s’arrête si vous fermez VSCodium » avec la durée', async () => {
  appels = [];
  await envoyer({ type: MSG.ACCUEIL_MOISSON_PREPARER });
  await tick();
  const e = dernierEtat();
  // parlement : min(300, 800 − marge) × 2 s ; recherche : 60 × 3 s ; plus 90 s de créneau = 870 s, soit 15 min.
  assert.deepStrictEqual(e.preparation, { genre: 'mensuelle', etat: 'confirmation', texte: T('moisson.fermeture')
    + ' ' + T('moisson.duree', [T('moisson.duree.min', [15])]) });
  assert.ok(etats().some((x) => x.preparation && x.preparation.etat === 'estimation'), 'l’estimation se montre en cours');
  await envoyer({ type: MSG.ACCUEIL_MOISSON_ANNULER });
  assert.strictEqual(dernierEtat().preparation, null);
});

test('production : ni --hors-ligne ni --racine-test ; racine de test : les deux',
  { skip: process.platform !== 'win32' ? 'chemins Windows — joué par le job contrats-windows' : false }, async () => {
  for (const enTest of [false, true]) {
    racineTest = enTest;
    appels = [];
    await envoyer({ type: MSG.ACCUEIL_MOISSON_PREPARER });
    await tick();
    if (enTest) {
      assert.strictEqual(dernierEtat().preparation.texte, T('moisson.fermeture') + ' '
        + T('moisson.dureeHorsLigne', [T('moisson.duree.min', [2])]));
    }
    await envoyer({ type: MSG.ACCUEIL_MOISSON_LANCER });
    await tick();
    const argv = appels.find((a) => a[3] === 'mensuelle');
    assert.ok(argv, 'mensuelle non lancée');
    assert.deepStrictEqual(argv.slice(0, 4), ['python3', '-B', '/mnt/c/ProgramData/SZH/toolkit/moissonneurs/moisson.py', 'mensuelle']);
    assert.match(argv[argv.indexOf('--arret') + 1], /^\/mnt\/[a-z]\/.+\.arret$/, 'le fichier d’arrêt, vu du moteur');
    assert.strictEqual(argv[argv.indexOf('--racine') + 1], '/mnt/' + MOISSONS.charAt(0).toLowerCase()
      + path.dirname(MOISSONS).slice(2).replace(/\\/g, '/'), 'la racine _NewsUndActu, vue du moteur');
    assert.deepStrictEqual([argv.includes('--hors-ligne'), argv.includes('--racine-test')], [enTest, enTest]);
    assert.deepStrictEqual(argv.slice(argv.indexOf('--poste'), argv.indexOf('--poste') + 8),
      ['--poste', 'PC-A', '--compte', 'robin', '--declencheur', 'cockpit', '--evenements', 'json']);
    evenements(['{"format":"pronto-moisson/1","type":"fin","code":0,"duree_s":1}']);
    passeEnCours.finir(0);
    await moissonHote.finPasse();
  }
  racineTest = false;
});

test('passe : la progression suit les événements ; Arrêter n’existe qu’après debut, et pose le fichier passé par --arret', async () => {
  let rafraichi = 0;
  moissonHote.configurer({ apresPasse: () => { rafraichi++; } });
  await envoyer({ type: MSG.ACCUEIL_MOISSON_PREPARER });
  await tick();
  await envoyer({ type: MSG.ACCUEIL_MOISSON_LANCER });
  await tick();
  let e = dernierEtat();
  assert.deepStrictEqual([e.passe.phase, e.passe.peutArreter, e.passe.statut], ['creneau', false, T('moisson.creneau')]);
  appels = [];
  await envoyer({ type: MSG.ACCUEIL_MOISSON_ARRETER });
  assert.deepStrictEqual(appels, []);
  assert.deepStrictEqual(fs.existsSync(ARRETS) ? fs.readdirSync(ARRETS) : [], [], 'avant debut, pas de demande d’arrêt');
  evenements(FIXTURE.slice(0, 3));
  await tick();
  e = dernierEtat();
  assert.deepStrictEqual([e.passe.phase, e.passe.peutArreter], ['en-cours', true]);
  assert.strictEqual(e.passe.statut, T('doc.prop.moissonneur.parlement') + ' · GE');
  assert.strictEqual(e.passe.lignes[0].detail, T('moisson.requetesSur', [12, 800 - MARGE_REQUETES]) + ' · '
    + T('moisson.reste', [T('moisson.duree.s', [21])]));
  // Le panneau se ferme et se rouvre : la passe continue, son état revient.
  panneau().dispose();
  await tick();
  HOTE.executer('szh.accueil');
  await tick();
  await envoyer({ type: MSG.PRET });
  await tick();
  assert.strictEqual(dernierEtat().passe.phase, 'en-cours', 'la passe survit à la fermeture du panneau');
  evenements(FIXTURE.slice(3, 14));
  await tick();
  e = dernierEtat();
  assert.strictEqual(e.passe.lignes[1].attente, T('moisson.attente', ['phbern', T('moisson.duree.min', [2]), ' (429)']));
  assert.strictEqual(e.passe.lignes[0].lot, T('moisson.lot', ['2026-11-01-1.jsonl', T('moisson.propositions.plus', [14])]));
  appels = [];
  await envoyer({ type: MSG.ACCUEIL_MOISSON_ARRETER });
  await envoyer({ type: MSG.ACCUEIL_MOISSON_ARRETER });
  assert.deepStrictEqual(appels, [], 'aucun processus lancé ni tué pour arrêter');
  assert.deepStrictEqual(fs.readdirSync(ARRETS).length, 1, 'le fichier d’arrêt est posé, une fois');
  assert.deepStrictEqual([dernierEtat().passe.arretDemande, dernierEtat().passe.peutArreter], [true, false]);
  evenements(FIXTURE.slice(14));
  passeEnCours.finir(3);
  await moissonHote.finPasse();
  e = dernierEtat();
  assert.deepStrictEqual(fs.readdirSync(ARRETS), [], 'le fichier d’arrêt est retiré en fin de passe');
  assert.strictEqual(e.passe, null);
  assert.strictEqual(e.bilan.ton, 'attention');
  assert.strictEqual(e.bilan.texte, T('moisson.code.3') + ' ' + T('moisson.dureeFin', [T('moisson.duree.min', [2])]));
  assert.deepStrictEqual(e.bilan.lots, [
    T('moisson.lotDepose', [T('doc.prop.moissonneur.parlement'), '2026-11-01-1.jsonl', T('moisson.propositions.plus', [14])]),
    T('moisson.lotDepose', [T('doc.prop.moissonneur.recherche'), '2026-11-01-1.jsonl', T('moisson.propositions.plus', [2])])]);
  assert.ok(e.bilan.details.indexOf(T('moisson.interrompu.arret', [T('doc.prop.moissonneur.recherche')])) !== -1);
  assert.strictEqual(e.bilan.lien, true);
  assert.strictEqual(rafraichi, 1, 'Propositions et réglages relus une fois');
  moissonHote.configurer({ apresPasse: () => {} });
});

test('refus « déjà en cours » : le poste, le compte et l’heure de l’autre ; sans fin, le code et stderr', async () => {
  await envoyer({ type: MSG.ACCUEIL_MOISSON_PREPARER });
  await tick();
  await envoyer({ type: MSG.ACCUEIL_MOISSON_LANCER });
  await tick();
  evenements(['{"format":"pronto-moisson/1","type":"creneau","etat":"refuse","poste":"PC-B","compte":"anna","debut":"2026-11-01T07:30:00Z"}',
    '{"format":"pronto-moisson/1","type":"refus","raison":"deja-en-cours","detail":"…"}']);
  passeEnCours.finir(4);
  await moissonHote.finPasse();
  const d = new Date('2026-11-01T07:30:00Z');
  assert.strictEqual(dernierEtat().bilan.texte, T('moisson.refus.deja-en-cours', ['PC-B', 'anna',
    T('moisson.heure', [String(d.getHours()).padStart(2, '0'), String(d.getMinutes()).padStart(2, '0')])]));
  await envoyer({ type: MSG.ACCUEIL_MOISSON_PREPARER });
  await tick();
  await envoyer({ type: MSG.ACCUEIL_MOISSON_LANCER });
  await tick();
  passeEnCours.stderr.write('Traceback (most recent call last):\nKeyError: x\n');
  passeEnCours.finir(1);
  await moissonHote.finPasse();
  assert.strictEqual(dernierEtat().bilan.texte, T('moisson.sansBilan', [1]) + ' Traceback (most recent call last): KeyError: x');
});

test('FNS : le lien vers data.snf.ch par l’hôte, le dernier import et la prochaine échéance', async () => {
  ecrire(path.join(MOISSONS, 'recherche', '_partage', 'imports-fns', '2026-06-02-pc-b__anna.json'), { format: 'pronto-import-fns/1',
    date: '2026-06-02', heure: '2026-06-02T09:00:00Z', poste: 'PC-B', compte: 'anna', fichier: { mtime: '2026-06-01T10:00:00Z' }, nouvelles: 12 });
  const e = await ouvrirReglages();
  assert.strictEqual(e.fns.dernier, T('moisson.fns.dernier', ['02.06.2026', 'PC-B', '01.06.2026', 12]));
  assert.strictEqual(e.fns.prochaine, T('moisson.fns.prochaine.11', [2026]));
  assert.strictEqual(e.fns.raison, '');
  await envoyer({ type: MSG.ACCUEIL_FNS_LIEN });
  assert.match(HOTE.ouvertures().pop(), /^(https:\/\/)?data\.snf\.ch\/?$/);
});

test('FNS : sélecteur de l’hôte, chemin converti, import-fns lancé ; un chemin UNC est refusé', async () => {
  HOTE.repondreOuverture(undefined);
  appels = [];
  await envoyer({ type: MSG.ACCUEIL_FNS_CHOISIR });
  assert.deepStrictEqual([appels, dernierEtat().preparation], [[], null], 'sélecteur fermé : rien');
  HOTE.repondreOuverture([{ fsPath: '\\\\serveur\\partage\\grants.csv' }]);
  await envoyer({ type: MSG.ACCUEIL_FNS_CHOISIR });
  assert.strictEqual(dernierEtat().bilan.texte, T('moisson.fns.cheminRefuse', ['\\\\serveur\\partage\\grants.csv']));
  HOTE.repondreOuverture([{ fsPath: 'C:\\Users\\x\\Downloads\\grants with abstracts.csv' }]);
  await envoyer({ type: MSG.ACCUEIL_FNS_CHOISIR });
  const e = dernierEtat();
  assert.deepStrictEqual(e.preparation, { genre: 'import-fns', etat: 'confirmation', texte: T('moisson.fermeture')
    + ' ' + T('moisson.fns.confirmation', ['grants with abstracts.csv']) });
  await envoyer({ type: MSG.ACCUEIL_MOISSON_LANCER });
  await tick();
  const argv = appels.find((a) => a[3] === 'import-fns');
  assert.deepStrictEqual(argv.slice(3, 6), ['import-fns', '--fichier', '/mnt/c/Users/x/Downloads/grants with abstracts.csv']);
  assert.ok(argv.includes('--arret'), 'un import s’arrête comme une passe');
  assert.ok(!argv.includes('--hors-ligne'), 'un import ne fait jamais de requête : pas d’option réseau');
  evenements(['{"format":"pronto-moisson/1","type":"refus","raison":"fichier-invalide","detail":"colonnes manquantes : Abstract"}']);
  passeEnCours.finir(2);
  await moissonHote.finPasse();
  const b = dernierEtat().bilan;
  assert.deepStrictEqual([b.genre, b.texte], ['import-fns', T('moisson.refus.fichier-invalide') + ' colonnes manquantes : Abstract']);
});
