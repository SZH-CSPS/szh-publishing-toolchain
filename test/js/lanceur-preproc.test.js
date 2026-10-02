// L'onglet Préprocessing du lanceur côté hôte (lib/lanceur-preproc-hote.js) : les arguments
// passés au nettoyeur dans le moteur, l'ordre des messages, l'issue, le rapport, le réglage
// szh.formatTravail, et aucun enfant qui survive au lanceur. Une fausse commande du moteur
// tient lieu de wsl.exe : elle note ses arguments et son pid, puis répond ou dort.
//
//   node --test test/js/lanceur-preproc.test.js
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

const TRAVAIL = process.env.SZH_PREPROC_TRAVAIL || fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-pp-'));
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
const RECUS = path.join(TRAVAIL, 'Manuscrits reçus');
const MANUSCRIT = path.join(RECUS, 'Martin école.docx');
const FAUX = path.join(TRAVAIL, 'faux-moteur.js');
const JOURNAL = path.join(TRAVAIL, 'appels.jsonl');
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

// ---- Le côté enfant : l'extension activée, sans dossier, et la page du lanceur ----
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
  const preproc = require(path.join(COCKPIT, 'lib', 'lanceur-preproc-hote.js'));
  preproc.configurer({ lancer: fauxLancer, cli: '/faux/manuscrit-nettoyer.py', versMoteur: (c) => c,
    compter: () => {}, signaler: () => {} });
  for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
  const p = HOTE.panneaux.filter((x) => x.type === 'szhLanceur')[0];
  await p._recepteur({ type: MSG.PRET });
  await attendre(() => p.messages.some((m) => m.type === MSG.LANCEUR_PREPROC_ETAT));
  const etats = () => p.messages.filter((m) => m.type === MSG.LANCEUR_PREPROC_ETAT);
  HOTE.repondreOuverture([{ fsPath: MANUSCRIT }]);
  if (CAS !== 'reglage') { process.env.SZH_FAUX_MODE = 'dormir'; }
  p._recepteur({ type: MSG.LANCEUR_PREPROC_CHOISIR, produit: 'revue', format: 'docx' });
  await attendre(() => appels().length === 1 && p.messages.some((m) => m.type === MSG.LANCEUR_PREPROC_ETAPE && m.etape === 'lecture'));
  const pids = appels().map((a) => a.pid);
  if (CAS === 'fermeture') { p.dispose(); }
  if (CAS === 'dossier') {
    const charger = p.messages.filter((m) => m.type === MSG.CHARGER)[0];
    await p._recepteur({ type: MSG.LANCEUR_OUVRIR, chemin: charger.produits[0].enCours[0].chemin });
  }
  if (CAS === 'desactivation') { require(path.join(COCKPIT, 'extension.js')).deactivate(); }
  await attendre(() => !pids.some(vivant) && !preproc.enCours(), 10000);
  const fin = p.messages.filter((m) => m.type === MSG.LANCEUR_PREPROC_FIN).pop() || null;
  const sortie = { pids, vivants: pids.filter(vivant), fin, premierEtat: etats()[0], dernierEtat: etats().pop(),
    argv: (appels()[0] || {}).argv || [], ecritures, format: getConfiguration('szh').get('formatTravail') };
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
  const hote = require(path.join(COCKPIT, 'lib', 'lanceur-preproc-hote.js'));
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
    lancer: fauxLancer, cli: '/faux/manuscrit-nettoyer.py', versMoteur: (c) => { convertis.push(c); return c; },
    envoyer: (m) => envoyes.push(m), revelerFichier: (c) => reveles.push(c),
    ouvrirExterne: (c) => { ouvertures.push(c); return Promise.resolve(true); },
    choisirFichier: (d) => { choix.push(d); return Promise.resolve(reponse); },
    formatTravail: () => format, compter: (c) => comptes.push(c), signaler: (c) => signales.push(c),
    memoire: { get: (k) => memoire[k], update: (k, v) => { memoire[k] = v; return Promise.resolve(); } }
  });
  const oublier = () => {
    for (const t of [envoyes, ouvertures, reveles, comptes, signales, choix, convertis]) { t.length = 0; }
    try { fs.rmSync(JOURNAL); } catch (e) { /* vide */ }
    delete process.env.SZH_FAUX_MODE;
  };
  const types = () => envoyes.map((m) => m.type);
  const fin = () => envoyes.filter((m) => m.type === MSG.LANCEUR_PREPROC_FIN).pop();
  const lancer = async (mode, produit, fmt) => {
    oublier();
    if (mode) { process.env.SZH_FAUX_MODE = mode; }
    try { await tenu(hote.choisir({ produit: produit || 'revue', format: fmt || 'docx' })); }
    finally { delete process.env.SZH_FAUX_MODE; }
  };

  test.after(() => { for (const a of appels()) { try { process.kill(a.pid); } catch (e) { /* déjà mort */ } } });

  test('préprocessing : l’état suit la langue et szh.formatTravail, le dépôt reste fermé', () => {
    oublier();
    format = 'odt';
    try {
      assert.deepStrictEqual(hote.etat(), { type: MSG.LANCEUR_PREPROC_ETAT, produit: 'revue', format: 'odt', dossier: '', depot: false });
      process.env.SZH_LANGUE = 'de';
      try { assert.strictEqual(hote.etat().produit, 'zeitschrift'); } finally { process.env.SZH_LANGUE = 'fr'; }
      format = 'pdf';
      assert.strictEqual(hote.etat().format, 'docx', 'une valeur hors de l’enum retombe sur docx');
    } finally { format = 'docx'; }
  });

  test('préprocessing : le nettoyeur part dans le dossier du manuscrit, les étapes arrivent dans l’ordre', async () => {
    await lancer('ok', 'revue', 'odt');
    const a = appels();
    assert.strictEqual(a.length, 1);
    assert.deepStrictEqual(a[0].argv.slice(0, 3), ['python3', '/faux/manuscrit-nettoyer.py', './Martin école.docx']);
    assert.strictEqual(fs.realpathSync(a[0].cwd), fs.realpathSync(RECUS), 'le dossier du manuscrit passe à --cd');
    assert.strictEqual(val(a[0].argv, '--produit'), 'revue');
    assert.strictEqual(val(a[0].argv, '--sortie'), '.');
    assert.strictEqual(val(a[0].argv, '--format'), 'odt');
    assert.ok(a[0].argv.includes('--etapes'));
    assert.match(path.basename(val(a[0].argv, '--rapport')), /^szh-rapport-manuscrit-[0-9a-f]{16}\.json$/);
    assert.deepStrictEqual(convertis, [val(a[0].argv, '--rapport')], 'le chemin du rapport passe par le moteur');
    assert.ok(!fs.existsSync(val(a[0].argv, '--rapport')), 'le JSON temporaire est effacé');
    assert.deepStrictEqual(types(), [MSG.LANCEUR_PREPROC_DEBUT].concat(Array(10).fill(MSG.LANCEUR_PREPROC_ETAPE),
      [MSG.LANCEUR_PREPROC_FIN, MSG.LANCEUR_PREPROC_ETAT]));
    assert.deepStrictEqual(envoyes[0], { type: MSG.LANCEUR_PREPROC_DEBUT, nom: 'Martin école.docx', produit: 'revue', format: 'odt' });
    assert.deepStrictEqual(envoyes.filter((m) => m.type === MSG.LANCEUR_PREPROC_ETAPE).map((m) => m.etape),
      ['preparation', 'lecture', 'titres', 'formatage', 'typographie', 'regles', 'bibliographie', 'ecriture', 'annotation', 'rapport'],
      'une étape par étape de la page, jamais en arrière');
    const rapport = path.join(RECUS, 'Martin école-rapport.html');
    assert.deepStrictEqual(fin(), { type: MSG.LANCEUR_PREPROC_FIN, issue: 'ok', texte: '', document: 'Martin école-nettoye.odt',
      rapport: true, rapportOuvert: true, alertes: { erreurs: 0, avertissements: 1, suggestions: 3 } });
    assert.ok(fs.statSync(rapport).size > 0, 'le rapport HTML est rendu à côté du manuscrit');
    assert.deepStrictEqual(ouvertures, [rapport], 'le rapport s’ouvre dans le navigateur, avant l’issue');
    assert.strictEqual(comptes.length, 1);
    assert.deepStrictEqual(comptes[0], { source: 'nettoyeur', passage: 'abcdef012345', mesures: { 'issue.ok': 1, 'produit.revue': 1 } });
    assert.deepStrictEqual(signales, []);
    // La page ne renvoie qu'un mot : l'hôte garde les chemins.
    hote.surMessage({ type: MSG.LANCEUR_PREPROC_OUVRIR, quoi: 'document' });
    hote.surMessage({ type: MSG.LANCEUR_PREPROC_OUVRIR, quoi: 'rapport' });
    hote.surMessage({ type: MSG.LANCEUR_PREPROC_OUVRIR, quoi: 'dossier' });
    hote.surMessage({ type: MSG.LANCEUR_PREPROC_OUVRIR, quoi: 'C:\\Windows' });
    assert.deepStrictEqual(ouvertures.slice(1), [path.join(RECUS, 'Martin école-nettoye.odt'), rapport]);
    assert.deepStrictEqual(reveles, [path.join(RECUS, 'Martin école-nettoye.odt')]);
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
    assert.strictEqual(envoyes.filter((m) => m.type === MSG.LANCEUR_PREPROC_ETAT).pop().dossier, RECUS);
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
    assert.strictEqual(fin().texte, TL('fr', 'lanceur.preproc.refus.suivi.plus', [3]));
    assert.doesNotMatch(fin().texte, /\(s\)/);
    assert.strictEqual(fin().rapport, true, 'un refus a sa page courte');
    assert.deepStrictEqual(signales, [], 'un refus attendu ne fait aucun rapport d’erreur');
    process.env.SZH_LANGUE = 'de';
    try { await lancer('refus', 'zeitschrift'); } finally { process.env.SZH_LANGUE = 'fr'; }
    assert.strictEqual(fin().texte, TL('de', 'lanceur.preproc.refus.suivi.plus', [3]));
    assert.notStrictEqual(fin().texte, TL('fr', 'lanceur.preproc.refus.suivi.plus', [3]));
  });

  test('préprocessing : un plantage dit l’étape et fait un rapport sans chemin', async () => {
    await lancer('plantage');
    assert.strictEqual(fin().issue, 'echec');
    assert.match(fin().texte, new RegExp(TL('fr', 'lanceur.preproc.etape.bibliographie')));
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
    assert.strictEqual(fin().texte, TL('fr', 'lanceur.preproc.echec.inconnu', [require(path.join(COCKPIT, 'lib', 'codes-erreur.js')).COURRIEL_SUPPORT]));
    assert.deepStrictEqual(signales.map((s) => s.etape), ['nettoyeur : sortie-inattendue']);
    assert.deepStrictEqual(comptes[0].mesures, { 'issue.plantage': 1, 'produit.revue': 1 }, 'un compteur minimal');
    hote.configurer({ lancer: () => { throw new Error('ENOENT'); } });
    try { await lancer('ok'); } finally { hote.configurer({ lancer: fauxLancer }); }
    assert.strictEqual(fin().texte, TL('fr', 'lanceur.preproc.echec.moteur'));
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
    hote.surMessage({ type: MSG.LANCEUR_PREPROC_INTERROMPRE });
    await tenu(passage);
    assert.ok(await attendre(() => !vivant(pid), 5000), 'le nettoyeur a survécu');
    assert.strictEqual(fin().issue, 'interrompu');
    assert.strictEqual(fin().rapport, false);
    assert.deepStrictEqual(comptes[0].mesures, { 'issue.interrompu': 1, 'produit.revue': 1 });
    assert.deepStrictEqual(signales, []);
    assert.strictEqual(types().pop(), MSG.LANCEUR_PREPROC_ETAT);
  });

  // La vraie CLI : avec --etapes, chaque étape s'écrit sur stderr dans la forme que lit l'hôte ;
  // sans, la sortie que lit l'onglet WinForms ne change pas. Un verrou de Word suffit : il est
  // refusé dès la première étape, sans manuscrit à fabriquer.
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

  // Les gestes qui ferment le lanceur, et le réglage, dans l'extension activée : chacun dans
  // son propre processus, le faux vscode ne s'activant qu'une fois.
  for (const cas of ['fermeture', 'dossier', 'desactivation']) {
    test('préprocessing : ' + cas + ' du lanceur pendant un nettoyage, et aucun enfant ne survit', () => {
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
    assert.strictEqual(v.premierEtat.depot, false);
    assert.strictEqual(val(v.argv, '--format'), 'docx', 'le choix de la page vaut pour ce passage');
    assert.strictEqual(v.fin.issue, 'ok');
    assert.deepStrictEqual(v.ecritures, [], 'aucune écriture de réglage');
    assert.strictEqual(v.format, 'odt');
    assert.strictEqual(v.dernierEtat.format, 'odt', 'le passage suivant repart du réglage');
  });
}
