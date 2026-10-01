// L'onglet Secrétariat du lanceur côté hôte (lib/lanceur-secretariat-hote.js) : les
// arguments passés à outils/secretariat-cli.js, le dossier Exports\<action>, l'historique
// du compte, et aucun enfant qui survive au lanceur. Un faux CLI tient lieu du vrai : il
// note ses arguments et son pid, puis répond ou dort.
//
//   node --test test/js/lanceur-secretariat.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const CAS = process.env.SZH_SECRETARIAT_CAS;

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-sec-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
const BASE = path.join(TRAVAIL, 'Base');
fs.mkdirSync(path.join(PROGRAMDATA, 'toolkit'), { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA, 'config.json'), JSON.stringify({ emplacementRevues: 'test' }), 'utf8');
Object.assign(process.env, { SZH_BASE: PROGRAMDATA, SZH_RACINE_TEST: BASE, SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'),
  SZH_ANCRAGE: '', LOCALAPPDATA: path.join(TRAVAIL, 'Local'), SZH_LANGUE: 'fr' });
const NUMERO = path.join(BASE, 'Revue', '2026-3');
fs.mkdirSync(NUMERO, { recursive: true });
fs.writeFileSync(path.join(NUMERO, 'ausgabe.yaml'), 'title: "Trois"\nrevue: revue\n');

const FAUX = path.join(TRAVAIL, 'faux-cli.js');
const JOURNAL = path.join(TRAVAIL, 'appels.jsonl');
fs.writeFileSync(FAUX, [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  'const args = process.argv.slice(2);',
  "fs.appendFileSync(process.env.SZH_FAUX_JOURNAL, JSON.stringify({ pid: process.pid, args, electron: process.env.ELECTRON_RUN_AS_NODE }) + '\\n');",
  "const dire = (o) => process.stdout.write(JSON.stringify(o) + '\\n');",
  'const val = (k) => args[args.indexOf(k) + 1];',
  "dire({ t: 'etape', texte: 'Lecture…' });",
  "if (process.env.SZH_FAUX_MODE === 'dormir') { setInterval(() => {}, 1000); } else {",
  "  if (args[0] === 'numeros-ojs') { dire({ t: 'numero', cle: '2026-03', libelle: 'Trois', annee: '2026', numero: '03' }); }",
  "  else { const n = args[0] === 'newsletter' ? 2 : 1; for (let i = 0; i < n; i++) {",
  "    const f = path.join(val('--sortie'), 'f' + i + '.txt'); fs.writeFileSync(f, 'x'); dire({ t: 'fichier', chemin: f, nom: 'f' + i + '.txt' }); } }",
  "  dire({ t: 'fin', ok: process.env.SZH_FAUX_MODE !== 'echec', texte: process.env.SZH_FAUX_MODE === 'echec' ? 'Raté.' : 'Fini.', gabarits: '' });",
  "  process.exit(process.env.SZH_FAUX_MODE === 'echec' ? 1 : 0);",
  '}'
].join('\n'));
process.env.SZH_FAUX_JOURNAL = JOURNAL;

function appels() {
  try { return fs.readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; }
}
function vivant(pid) { try { process.kill(pid, 0); return true; } catch (e) { return false; } }
// Une promesse qui ne se tient pas en cinq secondes fait échouer le test au lieu de le figer.
function tenu(promesse) {
  return Promise.race([promesse, new Promise((r, rejeter) => setTimeout(() => rejeter(new Error('enfant toujours en vie')), 5000).unref())]);
}
async function attendre(condition, ms) {
  const fin = Date.now() + (ms || 15000);
  while (Date.now() < fin) { if (condition()) { return true; } await new Promise((r) => setTimeout(r, 25)); }
  return condition();
}

// ---- Le côté enfant : l'extension activée, un export lancé, puis le geste qui doit le tuer ----
async function enfant() {
  const { revueDEssai, activerHote } = require('./hote-factice');
  const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
  process.env.SZH_FAUX_MODE = 'dormir';
  const HOTE = activerHote(revueDEssai(), { sansDossier: true });
  require(path.join(COCKPIT, 'lib', 'lanceur-secretariat-hote.js')).configurer({ cli: FAUX });
  for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
  const p = HOTE.panneaux.filter((x) => x.type === 'szhLanceur')[0];
  await p._recepteur({ type: MSG.PRET });
  const charger = p.messages.filter((m) => m.type === MSG.CHARGER)[0];
  const chemin = charger.produits[0].enCours[0].chemin;
  p._recepteur({ type: MSG.LANCEUR_EXPORTER, commande: 'newsletter', revue: 'revue', numeros: [chemin] });
  p._recepteur({ type: MSG.LANCEUR_OJS_CHARGER, revue: 'revue', depuisAnnee: 2026 });
  await attendre(() => appels().length === 2);
  const pids = appels().map((a) => a.pid);
  if (CAS === 'fermeture') { p.dispose(); }
  if (CAS === 'dossier') { await p._recepteur({ type: MSG.LANCEUR_OUVRIR, chemin }); }
  if (CAS === 'desactivation') { require(path.join(COCKPIT, 'extension.js')).deactivate(); }
  await attendre(() => !pids.some(vivant), 10000);
  const sortie = { pids, vivants: pids.filter(vivant), fins: p.messages.filter((m) => m.type === MSG.LANCEUR_FIN).length };
  for (const pid of sortie.vivants) { try { process.kill(pid); } catch (e) { /* déjà mort */ } }
  process.stdout.write('@@SEC@@' + JSON.stringify(sortie) + '\n');
  process.exit(0);
}

if (CAS) {
  enfant().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
} else {
  const hote = require(path.join(COCKPIT, 'lib', 'lanceur-secretariat-hote.js'));
  const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
  const envoyes = [];
  const reveles = [];
  const dossiers = [];
  const memoire = {};
  hote.configurer({
    cli: FAUX, envoyer: (m) => envoyes.push(m), revelerFichier: (c) => reveles.push(c), ouvrirDossier: (c) => dossiers.push(c),
    memoire: { get: (k) => memoire[k], update: (k, v) => { memoire[k] = v; return Promise.resolve(); } },
    numerosConnus: () => new Set([NUMERO])
  });
  const EXPORTS = path.join(BASE, 'Exports');
  const oublier = () => { envoyes.length = 0; reveles.length = 0; dossiers.length = 0; try { fs.rmSync(JOURNAL); } catch (e) { /* vide */ } };
  const fin = () => envoyes.filter((m) => m.type === MSG.LANCEUR_FIN).pop();
  const val = (args, k) => args[args.indexOf(k) + 1];

  test('secrétariat : la newsletter part dans Exports\\Newsletter\\<numéro>, l’Explorateur s’ouvre dessus', async () => {
    oublier();
    delete process.env.SZH_FAUX_MODE;
    await hote.exporter({ commande: 'newsletter', revue: 'revue', numeros: [NUMERO] });
    const a = appels();
    assert.strictEqual(a.length, 1);
    assert.strictEqual(a[0].electron, '1');
    assert.deepStrictEqual(a[0].args.slice(0, 1), ['newsletter']);
    assert.strictEqual(val(a[0].args, '--numero'), NUMERO);
    const sortie = path.join(EXPORTS, 'Newsletter', '2026-03');
    assert.strictEqual(val(a[0].args, '--sortie'), sortie, 'la racine active, puis Exports\\Newsletter et le numéro sur deux chiffres');
    assert.strictEqual(val(a[0].args, '--langue'), 'fr');
    assert.ok(fs.statSync(sortie).isDirectory());
    assert.deepStrictEqual(envoyes.map((m) => m.type), [MSG.LANCEUR_DEBUT, MSG.LANCEUR_LIGNE, MSG.LANCEUR_LIGNE,
      MSG.LANCEUR_LIGNE, MSG.LANCEUR_LIGNE, MSG.LANCEUR_FIN]);
    assert.deepStrictEqual(envoyes[1].ligne, { t: 'etape', texte: 'Lecture…' }, 'chaque ligne passe telle quelle');
    assert.strictEqual(fin().ok, true);
    assert.strictEqual(fin().texte, 'Fini.');
    assert.strictEqual(fin().dossier, sortie);
    assert.match(fin().date, /^\d{2}\.\d{2}\.\d{4}$/);
    assert.deepStrictEqual(dossiers, [sortie], 'deux fichiers : leur dossier');
    assert.deepStrictEqual(memoire[hote.CLE_HISTORIQUE], undefined, 'la newsletter n’entre pas dans l’historique');
  });

  test('secrétariat : un numéro que la page n’a pas reçu ne lance rien', async () => {
    oublier();
    await hote.exporter({ commande: 'newsletter', revue: 'revue', numeros: [path.join(TRAVAIL, 'ailleurs')] });
    await hote.exporter({ commande: 'autre', revue: 'revue', cles: ['2026-03'] });
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026/3'] });
    assert.deepStrictEqual(appels(), []);
    assert.deepStrictEqual(envoyes, []);
  });

  test('secrétariat : Edudoc relit les numéros chargés, retient ce qu’il a exporté et ouvre le fichier', async () => {
    oublier();
    await hote.chargerOjs({ revue: 'revue', depuisAnnee: 2026 });
    assert.deepStrictEqual(envoyes.map((m) => m.type), [MSG.LANCEUR_DEBUT, MSG.LANCEUR_LIGNE, MSG.LANCEUR_LIGNE, MSG.LANCEUR_LIGNE, MSG.LANCEUR_FIN]);
    assert.ok(envoyes.every((m) => m.type === MSG.LANCEUR_FIN || m.type === MSG.LANCEUR_DEBUT || m.commande === 'numeros-ojs'));
    const cache = val(appels()[0].args, '--cache');
    assert.strictEqual(val(appels()[0].args, '--depuis-annee'), '2026');
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-02', '2026-03'] });
    const a = appels()[1];
    assert.strictEqual(val(a.args, '--cache'), cache, 'le même fichier que le chargement');
    assert.strictEqual(val(a.args, '--numeros'), '2026-02,2026-03');
    assert.strictEqual(val(a.args, '--sortie'), path.join(EXPORTS, 'Edudoc'));
    assert.deepStrictEqual(reveles, [path.join(EXPORTS, 'Edudoc', 'f0.txt')], 'un seul fichier : sélectionné');
    const date = fin().date;
    assert.deepStrictEqual(memoire[hote.CLE_HISTORIQUE], { edudoc: { revue: { '2026-02': date, '2026-03': date } } });
    assert.deepStrictEqual(hote.historique(), memoire[hote.CLE_HISTORIQUE], 'l’historique que la page reçoit pour précocher');
    await hote.exporter({ commande: 'caracteres', revue: 'revue', cles: ['2026-03'] });
    assert.strictEqual(val(appels()[2].args, '--sortie'), path.join(EXPORTS, 'Caractères par article'));
    assert.deepStrictEqual(Object.keys(memoire[hote.CLE_HISTORIQUE]).sort(), ['caracteres', 'edudoc']);
  });

  test('secrétariat : un export échoué n’entre pas dans l’historique et n’ouvre rien', async () => {
    oublier();
    for (const k of Object.keys(memoire)) { delete memoire[k]; }
    process.env.SZH_FAUX_MODE = 'echec';
    try { await hote.exporter({ commande: 'edudoc', revue: 'zeitschrift', cles: ['2026-05'] }); }
    finally { delete process.env.SZH_FAUX_MODE; }
    assert.strictEqual(fin().ok, false);
    assert.strictEqual(fin().texte, 'Raté.');
    assert.deepStrictEqual(memoire, {});
    assert.deepStrictEqual(reveles.concat(dossiers), []);
  });

  test('secrétariat : le contrôle des métadonnées charge l’année du numéro, puis compare ce seul numéro', async () => {
    oublier();
    await hote.exporter({ commande: 'metadonnees', revue: 'revue', numeros: [NUMERO, path.join(BASE, 'Revue', 'autre')] });
    const a = appels();
    assert.deepStrictEqual(a.map((x) => x.args[0]), ['numeros-ojs', 'metadonnees']);
    assert.strictEqual(val(a[0].args, '--depuis-annee'), '2026');
    assert.strictEqual(val(a[1].args, '--cache'), val(a[0].args, '--cache'));
    assert.strictEqual(a[1].args.filter((x) => x === '--numero').length, 1);
    assert.strictEqual(val(a[1].args, '--sortie'), path.join(EXPORTS, 'Contrôle des métadonnées', '2026-03'));
    assert.ok(!fs.existsSync(val(a[0].args, '--cache')), 'son fichier des numéros publiés est effacé');
    assert.strictEqual(envoyes.filter((m) => m.type === MSG.LANCEUR_DEBUT).length, 1, 'une seule tâche pour la page');
  });

  test('secrétariat : la langue de l’interface passe au CLI', async () => {
    oublier();
    process.env.SZH_LANGUE = 'de';
    try { await hote.exporter({ commande: 'caracteres', revue: 'zeitschrift', cles: ['2026-05'] }); }
    finally { process.env.SZH_LANGUE = 'fr'; }
    assert.strictEqual(val(appels()[0].args, '--langue'), 'de');
  });

  test('secrétariat : « Afficher » ne montre que ce qui est sous Exports', () => {
    oublier();
    const fichier = path.join(EXPORTS, 'Edudoc', 'f0.txt');
    hote.surMessage({ type: MSG.LANCEUR_AFFICHER, chemin: fichier });
    hote.surMessage({ type: MSG.LANCEUR_AFFICHER, chemin: path.join(EXPORTS, 'Edudoc') });
    hote.surMessage({ type: MSG.LANCEUR_AFFICHER, chemin: path.join(PROGRAMDATA, 'config.json') });
    hote.surMessage({ type: MSG.LANCEUR_AFFICHER, chemin: path.join(EXPORTS, '..', 'Revue') });
    assert.deepStrictEqual(reveles, [fichier]);
    assert.deepStrictEqual(dossiers, [path.join(EXPORTS, 'Edudoc')]);
  });

  test('secrétariat : Interrompre tue la tâche et le dit, sans toucher au chargement', async () => {
    oublier();
    process.env.SZH_FAUX_MODE = 'dormir';
    try {
      const chargement = hote.chargerOjs({ revue: 'revue', depuisAnnee: 2025 });
      const exportEnCours = hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-03'] });
      assert.ok(await attendre(() => appels().length === 2), 'deux enfants à la fois');
      const [ojs, tache] = appels().map((a) => a.pid);
      await hote.exporter({ commande: 'caracteres', revue: 'revue', cles: ['2026-03'] });
      hote.chargerOjs({ revue: 'zeitschrift', depuisAnnee: 2025 });
      assert.strictEqual(appels().length, 2, 'au plus un chargement et une tâche');
      hote.surMessage({ type: MSG.LANCEUR_INTERROMPRE, commande: 'caracteres' });
      hote.surMessage({ type: MSG.LANCEUR_INTERROMPRE, commande: 'edudoc' });
      await tenu(exportEnCours);
      assert.strictEqual(vivant(tache), false);
      assert.strictEqual(vivant(ojs), true, 'le chargement continue');
      const f = envoyes.filter((m) => m.type === MSG.LANCEUR_FIN && m.commande === 'edudoc').pop();
      assert.strictEqual(f.ok, false);
      assert.strictEqual(f.annule, true);
      assert.strictEqual(f.texte, '');
      hote.arreter();
      await tenu(chargement);
      assert.strictEqual(vivant(ojs), false);
    } finally { delete process.env.SZH_FAUX_MODE; }
  });

  test('secrétariat : arrêter tue les deux enfants, jamais d’orphelin', async () => {
    oublier();
    process.env.SZH_FAUX_MODE = 'dormir';
    try {
      const promesses = [hote.chargerOjs({ revue: 'revue', depuisAnnee: 2026 }),
        hote.exporter({ commande: 'metadonnees', revue: 'revue', numeros: [NUMERO] })];
      assert.ok(await attendre(() => appels().length === 2));
      const pids = appels().map((a) => a.pid);
      assert.ok(pids.every(vivant));
      hote.arreter();
      await tenu(Promise.all(promesses));
      assert.ok(await attendre(() => !pids.some(vivant), 5000), 'un enfant a survécu');
      assert.deepStrictEqual(hote.enCours(), { ojs: false, tache: false });
      assert.strictEqual(appels().length, 2, 'la comparaison ne part pas après une interruption');
    } finally { delete process.env.SZH_FAUX_MODE; }
  });

  // Les trois gestes qui ferment le lanceur, dans l'extension activée : chacun dans son
  // propre processus, le faux vscode ne s'activant qu'une fois.
  for (const cas of ['fermeture', 'dossier', 'desactivation']) {
    test('secrétariat : ' + cas + ' du lanceur pendant un export, et aucun enfant ne survit', () => {
      const env = Object.assign({}, process.env, { SZH_SECRETARIAT_CAS: cas, SZH_ACCUEIL: '1' });
      const r = spawnSync(process.execPath, [__filename], { env, encoding: 'utf8', timeout: 120000 });
      const ligne = String(r.stdout || '').split(/\r?\n/).filter((l) => l.indexOf('@@SEC@@') === 0).pop();
      assert.ok(ligne, 'aucun verdict de l’enfant : ' + r.stdout + r.stderr);
      const v = JSON.parse(ligne.slice('@@SEC@@'.length));
      assert.strictEqual(v.pids.length, 2, 'la tâche et le chargement tournaient');
      assert.deepStrictEqual(v.vivants, [], 'orphelins : ' + v.vivants.join(', '));
    });
  }
}
