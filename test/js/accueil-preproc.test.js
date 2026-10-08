// L'onglet Préprocessing de l'Accueil côté hôte (lib/accueil-preproc-hote.js) : les arguments
// passés au nettoyeur dans le moteur, l'ordre des messages, l'issue, le rapport, le réglage
// szh.formatTravail, et aucun enfant qui survive à l'Accueil. Une fausse commande du moteur
// tient lieu de wsl.exe : elle note ses arguments et son pid, puis répond ou dort.
//
//   node --test test/js/accueil-preproc.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const CAS = process.env.SZH_PREPROC_CAS;

const TRAVAIL = process.env.SZH_PREPROC_TRAVAIL || fs.mkdtempSync(path.join(os.tmpdir(), 'szh-accueil-pp-'));
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
const RECUS = path.join(TRAVAIL, 'Manuscrits reçus');
const MANUSCRIT = path.join(RECUS, 'Martin école.docx');
const FAUX = path.join(TRAVAIL, 'faux-moteur.js');
const JOURNAL = path.join(TRAVAIL, 'appels.jsonl');
// La racine des exports, celle du Secrétariat : en mode test, <racine de test>\Exports. Chaque
// passage écrit sous <racine des exports>\Préprocessing.
const EXPORTS = path.join(TRAVAIL, 'Base', 'Exports');
const SORTIES = path.join(EXPORTS, 'Préprocessing');
const SORTIE = path.join(SORTIES, 'Martin école');
if (!CAS) {
  const numero = path.join(TRAVAIL, 'Base', 'Revue', '2026-3');
  fs.mkdirSync(numero, { recursive: true });
  fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'title: "Trois"\nrevue: revue\n');
  fs.mkdirSync(path.join(PROGRAMDATA, 'toolkit'), { recursive: true });
  fs.mkdirSync(RECUS, { recursive: true });
  fs.writeFileSync(path.join(PROGRAMDATA, 'config.json'), JSON.stringify({ emplacementRevues: 'test' }), 'utf8');
  fs.writeFileSync(MANUSCRIT, 'manuscrit');
  // Le faux moteur : il reçoit l'argv de la CLI (python3, le script, puis ses options). Un faux
  // qui dort se termine seul au bout de 30 s, même si personne ne le tue.
  fs.writeFileSync(FAUX, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    'const argv = process.argv.slice(2);',
    "fs.appendFileSync(process.env.SZH_FAUX_JOURNAL, JSON.stringify({ pid: process.pid, argv, cwd: process.cwd() }) + '\\n');",
    'const val = (k) => argv[argv.indexOf(k) + 1];',
    "const mode = process.env.SZH_FAUX_MODE || 'ok';",
    "const etape = (n) => process.stderr.write('[manuscrit-nettoyer] etape ' + n + '\\n');",
    "const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
    "const compteurs = { passage: 'abcdef012345', mesures: { 'issue.ok': 1, 'produit.revue': 1 } };",
    "process.stderr.write('[manuscrit-nettoyer] entrée : ' + argv[2] + '\\n');",
    "etape('controle-entree'); etape('lecture');",
    "if (mode === 'dormir') { setTimeout(() => process.exit(9), 30000); setInterval(() => {}, 1000); } else {",
    "  if (mode === 'plantage') { etape('bibliographie'); dire({ plantage: true, type: 'KeyError', lieu: 'manuscrit_biblio.py:12', etape: 'bibliographie', code_sortie: 4, compteurs }); process.exit(4); }",
    "  if (mode === 'refus') { dire({ entree: argv[2], refus: true, code_refus: 'suivi-modifications', message: '3 modification(s) suivie(s) non acceptée(s).', revisions: 3, sortie_nettoyeur: false, code_sortie: 2, compteurs }); process.exit(2); }",
    "  if (mode === 'muet') { process.exit(3); }",
    "  for (const n of ['gabarit', 'noms', 'titres', 'formatage', 'typographie', 'regles', 'vale', 'bibliographie', 'ecriture', 'controle-perte', 'annotation', 'conversion-sortie', 'rapport']) { etape(n); }",
    "  const nom = path.basename(argv[2], '.docx') + '-nettoye.' + val('--format');",
    "  fs.writeFileSync(nom, 'propre');",
    "  fs.writeFileSync(val('--rapport'), JSON.stringify({ entree: argv[2], produit: val('--produit'), gabarit: 'B', alertes: { total: 0, liste: [] }, compteurs: {}, decisions: {} }));",
    "  const erreurs = mode === 'alertes' ? 2 : 0;",
    "  dire({ entree: argv[2], sortie: './' + nom, sortie_rapport: val('--rapport'), alertes_error: erreurs, alertes_warning: 1, alertes_suggestion: 3, code_sortie: erreurs ? 1 : 0, compteurs });",
    '  process.exit(erreurs ? 1 : 0);',
    '}'
  ].join('\n'));
}
process.on('exit', () => {
  for (const a of appels()) { try { process.kill(a.pid); } catch (e) { /* déjà mort */ } }
  if (!CAS) { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } }
});
Object.assign(process.env, { SZH_BASE: PROGRAMDATA, SZH_RACINE_TEST: path.join(TRAVAIL, 'Base'),
  SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'), SZH_ANCRAGE: '', LOCALAPPDATA: path.join(TRAVAIL, 'Local'),
  SZH_LANGUE: process.env.SZH_LANGUE || 'fr', SZH_FAUX_JOURNAL: JOURNAL, SZH_PREPROC_TRAVAIL: TRAVAIL });

function appels() {
  try { return fs.readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; }
}
function vivant(pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } }
// Une promesse qui ne se tient pas en cinq secondes fait échouer le test au lieu de le figer.
function tenu(promesse) {
  return Promise.race([promesse, new Promise((r, rejeter) => setTimeout(() => rejeter(new Error('enfant toujours en vie')), 5000).unref())]);
}
async function attendre(condition, ms) {
  const fin = Date.now() + (ms || 10000);
  while (Date.now() < fin) { if (condition()) { return true; } await new Promise((r) => setTimeout(r, 25)); }
  return condition();
}
// La fausse commande du moteur : le même argv, le même dossier de travail, sans wsl.exe.
function fauxLancer(argv, options) {
  return spawn(process.execPath, [FAUX].concat(argv), { cwd: options.cwd, stdio: options.stdio, windowsHide: true });
}
const val = (argv, k) => argv[argv.indexOf(k) + 1];

// ---- Le côté enfant : l'extension activée, sans dossier, et la page de l'Accueil ----
async function enfant() {
  const { revueDEssai, activerHote } = require('./hote-factice');
  const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
  const HOTE = activerHote(revueDEssai(), { sansDossier: true });
  const ecritures = [];
  const getConfiguration = HOTE.stub.workspace.getConfiguration;
  HOTE.stub.workspace.getConfiguration = (section) => {
    const c = getConfiguration(section);
    return Object.assign({}, c, { update: (cle, v) => { ecritures.push((section ? section + '.' : '') + cle); return c.update(cle, v); } });
  };
  if (CAS === 'reglage') { await getConfiguration('szh').update('formatTravail', 'odt'); }
  const preproc = require(path.join(COCKPIT, 'lib', 'accueil-preproc-hote.js'));
  preproc.configurer({ lancer: fauxLancer, cli: '/faux/manuscrit-nettoyer.py', versMoteur: (c) => c,
    compter: () => {}, signaler: () => {} });
  for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
  const p = HOTE.panneaux.filter((x) => x.type === 'szhAccueil')[0];
  await p._recepteur({ type: MSG.PRET });
  await attendre(() => p.messages.some((m) => m.type === MSG.ACCUEIL_PREPROC_ETAT));
  const etats = () => p.messages.filter((m) => m.type === MSG.ACCUEIL_PREPROC_ETAT);
  HOTE.repondreOuverture([{ fsPath: MANUSCRIT }]);
  if (CAS !== 'reglage') { process.env.SZH_FAUX_MODE = 'dormir'; }
  p._recepteur({ type: MSG.ACCUEIL_PREPROC_CHOISIR, produit: 'revue', format: 'docx' });
  await attendre(() => appels().length === 1 && p.messages.some((m) => m.type === MSG.ACCUEIL_PREPROC_ETAPE && m.etape === 'lecture'));
  const pids = appels().map((a) => a.pid);
  if (CAS === 'fermeture') { p.dispose(); }
  if (CAS === 'dossier') {
    const charger = p.messages.filter((m) => m.type === MSG.CHARGER)[0];
    await p._recepteur({ type: MSG.ACCUEIL_OUVRIR, chemin: charger.produits[0].enCours[0].chemin });
  }
  if (CAS === 'desactivation') { require(path.join(COCKPIT, 'extension.js')).deactivate(); }
  await attendre(() => !pids.some(vivant) && !preproc.enCours(), 10000);
  const fin = p.messages.filter((m) => m.type === MSG.ACCUEIL_PREPROC_FIN).pop() || null;
  const sortie = { pids, vivants: pids.filter(vivant), fin, premierEtat: etats()[0], dernierEtat: etats().pop(),
    argv: (appels()[0] || {}).argv || [], cwd: (appels()[0] || {}).cwd || '', ecritures, format: getConfiguration('szh').get('formatTravail') };
  for (const pid of sortie.vivants) { try { process.kill(pid); } catch (e) { /* déjà mort */ } }
  process.stdout.write('@@PP@@' + JSON.stringify(sortie) + '\n');
  process.exit(0);
}

function lancerEnfant(cas) {
  const env = Object.assign({}, process.env, { SZH_PREPROC_CAS: cas, SZH_ACCUEIL: '1' });
  const r = spawnSync(process.execPath, [__filename], { env, encoding: 'utf8', timeout: 120000 });
  const ligne = String(r.stdout || '').split(/\r?\n/).filter((l) => l.indexOf('@@PP@@') === 0).pop();
  assert.ok(ligne, 'aucun verdict de l’enfant : ' + r.stdout + r.stderr);
  return JSON.parse(ligne.slice('@@PP@@'.length));
}

if (CAS) {
  enfant().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
} else {
  const hote = require(path.join(COCKPIT, 'lib', 'accueil-preproc-hote.js'));
  const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
  const { TL } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  const envoyes = [];
  const ouvertures = [];
  const reveles = [];
  const comptes = [];
  const signales = [];
  const choix = [];
  const memoire = {};
  const convertis = [];
  let reponse = MANUSCRIT;
  let format = 'docx';
  hote.configurer({
    lancer: fauxLancer, cli: '/faux/manuscrit-nettoyer.py', versMoteur: (c) => { convertis.push(c); return c; }, racineExports: () => EXPORTS,
    envoyer: (m) => envoyes.push(m), revelerFichier: (c) => reveles.push(c),
    ouvrirExterne: (c) => { ouvertures.push(c); return Promise.resolve(true); },
    choisirFichier: (d) => { choix.push(d); return Promise.resolve(reponse); },
    formatTravail: () => format, compter: (c) => comptes.push(c), signaler: (c) => signales.push(c),
    memoire: { get: (k) => memoire[k], update: (k, v) => { memoire[k] = v; return Promise.resolve(); } }
  });
  const oublier = () => {
    for (const t of [envoyes, ouvertures, reveles, comptes, signales, choix, convertis]) { t.length = 0; }
    try { fs.rmSync(JOURNAL); } catch (e) { /* vide */ }
    fs.rmSync(EXPORTS, { recursive: true, force: true });
    delete process.env.SZH_FAUX_MODE;
  };
  const types = () => envoyes.map((m) => m.type);
  const fin = () => envoyes.filter((m) => m.type === MSG.ACCUEIL_PREPROC_FIN).pop();
  const lancer = async (mode, produit, fmt) => {
    oublier();
    if (mode) { process.env.SZH_FAUX_MODE = mode; }
    try { await tenu(hote.choisir({ produit: produit || 'revue', format: fmt || 'docx' })); }
    finally { delete process.env.SZH_FAUX_MODE; }
  };

  test.after(() => { for (const a of appels()) { try { process.kill(a.pid); } catch (e) { /* déjà mort */ } } });

  test('préprocessing : l’état suit la langue et szh.formatTravail, le dépôt est ouvert', () => {
    oublier();
    format = 'odt';
    try {
      assert.deepStrictEqual(hote.etat(), { type: MSG.ACCUEIL_PREPROC_ETAT, produit: 'revue', format: 'odt', dossier: '', depot: true,
        tailleMax: 50 * 1024 * 1024 });
      process.env.SZH_LANGUE = 'de';
      try { assert.strictEqual(hote.etat().produit, 'zeitschrift'); } finally { process.env.SZH_LANGUE = 'fr'; }
      format = 'pdf';
      assert.strictEqual(hote.etat().format, 'docx', 'une valeur hors de l’enum retombe sur docx');
    } finally { format = 'docx'; }
  });

  test('préprocessing : le nettoyeur part sur une copie dans les exports, les étapes arrivent dans l’ordre', async () => {
    const avant = fs.readdirSync(RECUS).sort();
    await lancer('ok', 'revue', 'odt');
    const a = appels();
    assert.strictEqual(a.length, 1);
    assert.deepStrictEqual(a[0].argv.slice(0, 3), ['python3', '/faux/manuscrit-nettoyer.py', './Martin école.docx']);
    assert.strictEqual(fs.realpathSync(a[0].cwd), fs.realpathSync(SORTIE), 'le dossier du passage passe à --cd');
    assert.strictEqual(fs.readFileSync(path.join(SORTIE, 'Martin école.docx'), 'utf8'), 'manuscrit', 'la copie sous son nom d’origine');
    assert.strictEqual(fs.readFileSync(MANUSCRIT, 'utf8'), 'manuscrit', 'l’original n’est pas touché');
    assert.deepStrictEqual(fs.readdirSync(RECUS).sort(), avant, 'rien ne s’écrit à côté de l’original');
    assert.strictEqual(val(a[0].argv, '--produit'), 'revue');
    assert.strictEqual(val(a[0].argv, '--sortie'), '.');
    assert.strictEqual(val(a[0].argv, '--format'), 'odt');
    assert.ok(a[0].argv.includes('--etapes'));
    assert.match(path.basename(val(a[0].argv, '--rapport')), /^szh-rapport-manuscrit-[0-9a-f]{16}\.json$/);
    assert.deepStrictEqual(convertis, [val(a[0].argv, '--rapport')], 'le chemin du rapport passe par le moteur');
    assert.ok(!fs.existsSync(val(a[0].argv, '--rapport')), 'le JSON temporaire est effacé');
    assert.deepStrictEqual(types(), [MSG.ACCUEIL_PREPROC_DEBUT].concat(Array(10).fill(MSG.ACCUEIL_PREPROC_ETAPE),
      [MSG.ACCUEIL_PREPROC_FIN, MSG.ACCUEIL_PREPROC_ETAT]));
    assert.deepStrictEqual(envoyes[0], { type: MSG.ACCUEIL_PREPROC_DEBUT, nom: 'Martin école.docx', produit: 'revue', format: 'odt' });
    assert.deepStrictEqual(envoyes.filter((m) => m.type === MSG.ACCUEIL_PREPROC_ETAPE).map((m) => m.etape),
      ['preparation', 'lecture', 'titres', 'formatage', 'typographie', 'regles', 'bibliographie', 'ecriture', 'annotation', 'rapport'],
      'une étape par étape de la page, jamais en arrière');
    const rapport = path.join(SORTIE, 'Martin école-rapport.html');
    assert.deepStrictEqual(fin(), { type: MSG.ACCUEIL_PREPROC_FIN, issue: 'ok', texte: '', document: 'Martin école-nettoye.odt',
      rapport: true, rapportOuvert: true, alertes: { erreurs: 0, avertissements: 1, suggestions: 3 } });
    assert.ok(fs.statSync(rapport).size > 0, 'le rapport HTML est rendu à côté de la copie');
    assert.deepStrictEqual(ouvertures, [rapport], 'le rapport s’ouvre dans le navigateur, avant l’issue');
    assert.strictEqual(comptes.length, 1);
    assert.deepStrictEqual(comptes[0], { source: 'nettoyeur', passage: 'abcdef012345', mesures: { 'issue.ok': 1, 'produit.revue': 1 } });
    assert.deepStrictEqual(signales, []);
    // La page ne renvoie qu'un mot : l'hôte garde les chemins.
    hote.surMessage({ type: MSG.ACCUEIL_PREPROC_OUVRIR, quoi: 'document' });
    hote.surMessage({ type: MSG.ACCUEIL_PREPROC_OUVRIR, quoi: 'rapport' });
    hote.surMessage({ type: MSG.ACCUEIL_PREPROC_OUVRIR, quoi: 'dossier' });
    hote.surMessage({ type: MSG.ACCUEIL_PREPROC_OUVRIR, quoi: 'C:\\Windows' });
    assert.deepStrictEqual(ouvertures.slice(1), [path.join(SORTIE, 'Martin école-nettoye.odt'), rapport]);
    assert.deepStrictEqual(reveles, [path.join(SORTIE, 'Martin école-nettoye.odt')]);
  });

  test('préprocessing : un second passage du même nom va dans « (2) », sans rien écraser', async () => {
    await lancer('ok');
    await tenu(hote.choisir({ produit: 'revue', format: 'docx' }));
    await tenu(hote.choisir({ produit: 'revue', format: 'docx' }));
    assert.deepStrictEqual(appels().map((a) => fs.realpathSync(a.cwd)),
      [SORTIE, SORTIE + ' (2)', SORTIE + ' (3)'].map((d) => fs.realpathSync(d)));
    assert.deepStrictEqual(fs.readdirSync(SORTIES).sort(), ['Martin école', 'Martin école (2)', 'Martin école (3)']);
    assert.deepStrictEqual(fs.readdirSync(SORTIE).sort(), ['Martin école-nettoye.docx', 'Martin école-rapport.html', 'Martin école.docx']);
  });

  const b64 = (t) => Buffer.from(t).toString('base64');
  const deposer = (autres) => tenu(hote.deposer(Object.assign({ type: MSG.ACCUEIL_PREPROC_DEPOSER, produit: 'revue', format: 'docx' }, autres)));

  test('préprocessing : un dépôt d’octets s’écrit dans les exports, puis se nettoie', async () => {
    oublier();
    assert.strictEqual(hote.surMessage({ type: MSG.ACCUEIL_PREPROC_DEPOSER }), true);
    await deposer({ nomFichier: 'Dupont étude.docx', donneesBase64: b64('octets déposés') });
    const dossier = path.join(SORTIES, 'Dupont étude');
    assert.strictEqual(fs.readFileSync(path.join(dossier, 'Dupont étude.docx'), 'utf8'), 'octets déposés');
    assert.strictEqual(appels().length, 1);
    assert.strictEqual(fs.realpathSync(appels()[0].cwd), fs.realpathSync(dossier));
    assert.strictEqual(appels()[0].argv[2], './Dupont étude.docx');
    assert.strictEqual(fin().issue, 'ok');
    assert.strictEqual(envoyes[0].nom, 'Dupont étude.docx');
    // Un nom venu de la page ne remonte pas l'arborescence.
    oublier();
    await deposer({ nomFichier: '..\\..\\Évasion.odt', donneesBase64: b64('x') });
    assert.ok(fs.existsSync(path.join(SORTIES, 'Évasion', 'Évasion.odt')));
    // Un fichier de l'explorateur de l'éditeur arrive avec son adresse : il est copié comme un choix.
    oublier();
    await deposer({ uri: require('url').pathToFileURL(MANUSCRIT).href });
    assert.strictEqual(fs.realpathSync(appels()[0].cwd), fs.realpathSync(SORTIE));
    assert.strictEqual(fs.readFileSync(path.join(SORTIE, 'Martin école.docx'), 'utf8'), 'manuscrit');
  });

  test('préprocessing : un dépôt hors .docx et .odt, ou trop gros, est refusé sans rien écrire', async () => {
    for (const m of [{ nomFichier: 'a.pdf', donneesBase64: b64('x') }, { nomFichier: 'a.docx', donneesBase64: '' },
      { uri: require('url').pathToFileURL(path.join(RECUS, 'a.pdf')).href }]) {
      oublier();
      await deposer(m);
      assert.deepStrictEqual(appels(), [], JSON.stringify(m));
      assert.strictEqual(fin().issue, 'refus');
      assert.strictEqual(fin().texte, TL('fr', 'accueil.preproc.depot.format'));
      assert.ok(!fs.existsSync(EXPORTS), 'aucun dossier pour un refus');
    }
    oublier();
    await deposer({ nomFichier: 'gros.docx', donneesBase64: Buffer.alloc(hote.TAILLE_MAX + 1).toString('base64') });
    assert.deepStrictEqual(appels(), []);
    assert.strictEqual(fin().issue, 'refus');
    assert.strictEqual(fin().texte, TL('fr', 'accueil.preproc.depot.taille', [50]));
    assert.ok(!fs.existsSync(EXPORTS));
    assert.strictEqual(types().pop(), MSG.ACCUEIL_PREPROC_ETAT);
  });

  test('préprocessing : la boîte de choix part du dernier dossier, et un choix annulé ne lance rien', async () => {
    oublier();
    memoire[hote.CLE_DOSSIER] = path.join(TRAVAIL, 'disparu');
    reponse = null;
    try {
      await hote.choisir({ produit: 'revue', format: 'docx' });
      assert.deepStrictEqual(choix, [''], 'un dossier disparu n’est pas proposé');
      await hote.choisir({ produit: 'livre', format: 'docx' });
      await hote.choisir({ produit: 'revue', format: 'pdf' });
      assert.strictEqual(choix.length, 1, 'une demande mal formée n’ouvre pas la boîte');
    } finally { reponse = MANUSCRIT; }
    assert.deepStrictEqual(appels(), []);
    assert.deepStrictEqual(envoyes, []);
    await lancer('ok');
    assert.strictEqual(memoire[hote.CLE_DOSSIER], RECUS);
    await lancer('ok');
    assert.deepStrictEqual(choix, [RECUS]);
    assert.strictEqual(envoyes.filter((m) => m.type === MSG.ACCUEIL_PREPROC_ETAT).pop().dossier, RECUS);
  });

  test('préprocessing : des erreurs bloquantes restent une réussite, avec leur compte', async () => {
    await lancer('alertes');
    assert.strictEqual(fin().issue, 'alertes');
    assert.deepStrictEqual(fin().alertes, { erreurs: 2, avertissements: 1, suggestions: 3 });
    assert.strictEqual(fin().rapport, true);
  });

  test('préprocessing : un refus se dit en clair dans la langue de l’interface, au vrai pluriel', async () => {
    await lancer('refus');
    assert.strictEqual(fin().issue, 'refus');
    assert.strictEqual(fin().texte, TL('fr', 'accueil.preproc.refus.suivi.plus', [3]));
    assert.doesNotMatch(fin().texte, /\(s\)/);
    assert.strictEqual(fin().rapport, true, 'un refus a sa page courte');
    assert.deepStrictEqual(signales, [], 'un refus attendu ne fait aucun rapport d’erreur');
    process.env.SZH_LANGUE = 'de';
    try { await lancer('refus', 'zeitschrift'); } finally { process.env.SZH_LANGUE = 'fr'; }
    assert.strictEqual(fin().texte, TL('de', 'accueil.preproc.refus.suivi.plus', [3]));
    assert.notStrictEqual(fin().texte, TL('fr', 'accueil.preproc.refus.suivi.plus', [3]));
  });

  test('préprocessing : un plantage dit l’étape et fait un rapport sans chemin', async () => {
    await lancer('plantage');
    assert.strictEqual(fin().issue, 'echec');
    assert.match(fin().texte, new RegExp(TL('fr', 'accueil.preproc.etape.bibliographie')));
    assert.strictEqual(fin().rapport, false);
    assert.strictEqual(signales.length, 1);
    assert.strictEqual(signales[0].code, 'NETTOYEUR-ECHEC');
    assert.strictEqual(signales[0].etape, 'nettoyeur : bibliographie');
    assert.deepStrictEqual(JSON.parse(signales[0].message), { plantage: true, type: 'KeyError', lieu: 'manuscrit_biblio.py:12',
      etape: 'bibliographie', code_sortie: 4 });
    assert.doesNotMatch(JSON.stringify(signales), /Martin/);
  });

  test('préprocessing : une sortie sans ligne JSON, puis un moteur absent, sont des échecs dits', async () => {
    await lancer('muet');
    assert.strictEqual(fin().issue, 'echec');
    assert.strictEqual(fin().texte, TL('fr', 'accueil.preproc.echec.inconnu', [require(path.join(COCKPIT, 'lib', 'codes-erreur.js')).COURRIEL_SUPPORT]));
    assert.deepStrictEqual(signales.map((s) => s.etape), ['nettoyeur : sortie-inattendue']);
    assert.deepStrictEqual(comptes[0].mesures, { 'issue.plantage': 1, 'produit.revue': 1 }, 'un compteur minimal');
    hote.configurer({ lancer: () => { throw new Error('ENOENT'); } });
    try { await lancer('ok'); } finally { hote.configurer({ lancer: fauxLancer }); }
    assert.strictEqual(fin().texte, TL('fr', 'accueil.preproc.echec.moteur'));
    assert.strictEqual(hote.enCours(), false);
  });

  test('préprocessing : Interrompre tue le nettoyeur et le dit, sans rapport d’erreur', async () => {
    oublier();
    process.env.SZH_FAUX_MODE = 'dormir';
    let passage;
    try {
      passage = hote.choisir({ produit: 'revue', format: 'docx' });
      assert.ok(await attendre(() => envoyes.some((m) => m.etape === 'lecture')), 'le nettoyeur a commencé');
    } finally { delete process.env.SZH_FAUX_MODE; }
    const pid = appels()[0].pid;
    await hote.choisir({ produit: 'revue', format: 'docx' });
    assert.strictEqual(appels().length, 1, 'un seul nettoyage à la fois');
    hote.surMessage({ type: MSG.ACCUEIL_PREPROC_INTERROMPRE });
    await tenu(passage);
    assert.ok(await attendre(() => !vivant(pid), 5000), 'le nettoyeur a survécu');
    assert.strictEqual(fin().issue, 'interrompu');
    assert.strictEqual(fin().rapport, false);
    assert.deepStrictEqual(comptes[0].mesures, { 'issue.interrompu': 1, 'produit.revue': 1 });
    assert.deepStrictEqual(signales, []);
    assert.strictEqual(types().pop(), MSG.ACCUEIL_PREPROC_ETAT);
  });

  // La vraie CLI : avec --etapes, chaque étape s'écrit sur stderr sous la forme que lit l'hôte ;
  // sans, la sortie reste celle que lit l'onglet WinForms. Un fichier verrou de Word (~$…)
  // suffit : il est refusé dès la première étape, sans manuscrit à fabriquer.
  const { python, sansPython } = require('./gardes');
  test('préprocessing : la CLI dit ses étapes avec --etapes, et seulement avec', { skip: sansPython }, () => {
    const verrou = path.join(RECUS, '~$verrou.docx');
    fs.writeFileSync(verrou, 'x');
    const cli = path.join(RACINE, 'pipeline', 'manuscrit-nettoyer.py');
    const lancerCli = (plus) => python([cli, verrou, '--produit', 'revue', '--sortie', RECUS].concat(plus),
      { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }), timeout: 60000 });
    const avec = lancerCli(['--etapes']);
    const sans = lancerCli([]);
    assert.strictEqual(avec.status, 2, avec.stderr);
    const marques = (sortie) => String(sortie).split(/\r?\n/).filter((l) => /\] etape /.test(l));
    assert.deepStrictEqual(marques(avec.stderr), ['[manuscrit-nettoyer] etape controle-entree']);
    assert.ok(Object.keys(hote.VERS_PAGE).indexOf('controle-entree') !== -1, 'l’hôte connaît cette étape');
    assert.strictEqual(JSON.parse(avec.stdout.trim()).code_refus, 'fichier-verrou');
    const sansDuree = (o) => Object.assign({}, o, { compteurs: null });
    assert.deepStrictEqual(sansDuree(JSON.parse(sans.stdout)), sansDuree(JSON.parse(avec.stdout)), 'stdout ne change pas, hors durée');
    assert.deepStrictEqual(marques(sans.stderr), [], 'sans --etapes, rien de neuf sur stderr');
  });

  test('préprocessing : la sortie va sous <racine des exports>\\Préprocessing\\<nom>', async () => {
    await lancer('ok');
    assert.strictEqual(fs.realpathSync(appels()[0].cwd), fs.realpathSync(path.join(EXPORTS, 'Préprocessing', 'Martin école')));
    assert.deepStrictEqual(fs.readdirSync(EXPORTS), ['Préprocessing'], 'rien d’autre dans les exports');
    hote.surMessage({ type: MSG.ACCUEIL_PREPROC_OUVRIR, quoi: 'dossier' });
    assert.strictEqual(path.dirname(reveles[0]), path.join(EXPORTS, 'Préprocessing', 'Martin école'));
  });

  // Un partage absent : la racine des exports pend sous un dossier qui n'existe pas, n'est pas
  // un chemin absolu, ou ne se lit pas. Le passage échoue avec son message, sans rien créer.
  test('préprocessing : une racine des exports injoignable échoue proprement, sans écrire ailleurs', async () => {
    const absent = path.join(TRAVAIL, 'Partage absent', 'Exports');
    const cwd = process.cwd();
    const cas = [[() => absent, path.join(absent, 'Préprocessing')],
      [() => 'Exports', path.join('Exports', 'Préprocessing')],
      [() => { throw new Error('inventaire illisible'); }, path.join('Exports', 'Préprocessing')]];
    try {
      for (const [racine, affiche] of cas) {
        hote.configurer({ racineExports: racine });
        await lancer('ok');
        assert.deepStrictEqual(appels(), [], 'le nettoyeur ne part pas');
        assert.strictEqual(fin().issue, 'echec');
        assert.strictEqual(fin().texte, TL('fr', 'accueil.preproc.echec.sortie', [affiche]));
        assert.strictEqual(fin().document, '');
        assert.strictEqual(types().pop(), MSG.ACCUEIL_PREPROC_ETAT);
        assert.ok(!fs.existsSync(path.join(TRAVAIL, 'Partage absent')), 'un partage absent n’est pas recréé');
        assert.ok(!fs.existsSync(path.join(cwd, 'Exports')), 'rien ne s’écrit dans le dossier courant');
      }
    } finally { hote.configurer({ racineExports: () => EXPORTS }); }
    for (const l of ['fr', 'de']) {
      assert.doesNotMatch(TL(l, 'accueil.preproc.echec.sortie', ['X']), /Bureau|Desktop/, 'le message ne parle plus du Bureau');
    }
  });

  // Les actions qui ferment l'Accueil, et le réglage, dans l'extension activée : chacune dans
  // son propre processus, le faux vscode ne s'activant qu'une fois.
  for (const cas of ['fermeture', 'dossier', 'desactivation']) {
    test('préprocessing : ' + cas + ' de l’Accueil pendant un nettoyage, et aucun enfant ne survit', () => {
      oublier();
      const v = lancerEnfant(cas);
      assert.strictEqual(v.pids.length, 1, 'le nettoyeur tournait');
      assert.deepStrictEqual(v.vivants, [], 'orphelin : ' + v.vivants.join(', '));
    });
  }

  test('préprocessing : l’état suit szh.formatTravail, et le passage n’écrit pas le réglage', () => {
    oublier();
    const v = lancerEnfant('reglage');
    assert.strictEqual(v.premierEtat.format, 'odt', 'l’état envoyé à la page suit le réglage');
    assert.strictEqual(v.premierEtat.produit, 'revue');
    assert.strictEqual(v.premierEtat.depot, true);
    assert.strictEqual(val(v.argv, '--format'), 'docx', 'le choix de la page vaut pour ce passage');
    assert.strictEqual(v.fin.issue, 'ok');
    assert.strictEqual(fs.realpathSync(v.cwd), fs.realpathSync(SORTIE), 'sans racine injectée, celle des exports du mode test');
    assert.deepStrictEqual(v.ecritures, [], 'aucune écriture de réglage');
    assert.strictEqual(v.format, 'odt');
    assert.strictEqual(v.dernierEtat.format, 'odt', 'le passage suivant repart du réglage');
  });
}
