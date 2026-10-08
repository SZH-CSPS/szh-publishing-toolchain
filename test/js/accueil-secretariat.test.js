// L'onglet Secrétariat de l'Accueil côté hôte (lib/accueil-secretariat-hote.js) : les
// arguments passés à outils/secretariat-cli.js, le dossier Exports\<action>, l'historique
// partagé dans _Systeme\exports, et aucun enfant qui survive à l'Accueil. Un faux CLI tient
// lieu du vrai : il note ses arguments et son pid, puis répond ou dort.
//
//   node --test test/js/accueil-secretariat.test.js
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

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-accueil-sec-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
const BASE = path.join(TRAVAIL, 'Base');
fs.mkdirSync(path.join(PROGRAMDATA, 'toolkit'), { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA, 'config.json'), JSON.stringify({ emplacementRevues: 'test' }), 'utf8');
Object.assign(process.env, { SZH_BASE: PROGRAMDATA, SZH_RACINE_TEST: BASE, SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'),
  SZH_ANCRAGE: '', LOCALAPPDATA: path.join(TRAVAIL, 'Local'), SZH_LANGUE: 'fr' });
// L'historique partagé des exports, dans un dossier jetable : aucun test n'écrit sur le partage.
const HISTO = path.join(TRAVAIL, 'Systeme', 'exports');
process.env.SZH_HISTORIQUE_EXPORTS = HISTO;
const lireHisto = (nom) => { try { return JSON.parse(fs.readFileSync(path.join(HISTO, nom), 'utf8')); } catch (e) { return undefined; } };
const emplacement = (v) => fs.writeFileSync(path.join(PROGRAMDATA, 'config.json'), JSON.stringify({ emplacementRevues: v }), 'utf8');
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
  // Même oublié par un test qui échoue, un enfant qui dort ne vit pas plus d'une minute.
  "if (process.env.SZH_FAUX_MODE === 'dormir') { setTimeout(() => process.exit(3), 60000); } else {",
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
// Le journal suit l'ordre de démarrage des enfants, pas celui des spawn : on les reconnaît à leur commande.
const appelDe = (commande) => appels().filter((a) => a.args[0] === commande)[0];
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

// ---- Le côté enfant : l'extension activée, un export lancé, puis l'action qui doit le tuer ----
async function enfant() {
  const { revueDEssai, activerHote } = require('./hote-factice');
  const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
  process.env.SZH_FAUX_MODE = 'dormir';
  const HOTE = activerHote(revueDEssai(), { sansDossier: true });
  require(path.join(COCKPIT, 'lib', 'accueil-secretariat-hote.js')).configurer({ cli: FAUX });
  for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
  const p = HOTE.panneaux.filter((x) => x.type === 'szhAccueil')[0];
  await p._recepteur({ type: MSG.PRET });
  const charger = p.messages.filter((m) => m.type === MSG.CHARGER)[0];
  const chemin = charger.produits[0].enCours[0].chemin;
  p._recepteur({ type: MSG.ACCUEIL_EXPORTER, commande: 'newsletter', revue: 'revue', numeros: [chemin] });
  p._recepteur({ type: MSG.ACCUEIL_OJS_CHARGER, revue: 'revue', depuisAnnee: 2026 });
  await attendre(() => appels().length === 2);
  const pids = appels().map((a) => a.pid);
  if (CAS === 'fermeture') { p.dispose(); }
  if (CAS === 'dossier') { await p._recepteur({ type: MSG.ACCUEIL_OUVRIR, chemin }); }
  if (CAS === 'desactivation') { require(path.join(COCKPIT, 'extension.js')).deactivate(); }
  await attendre(() => !pids.some(vivant), 10000);
  const sortie = { pids, vivants: pids.filter(vivant), fins: p.messages.filter((m) => m.type === MSG.ACCUEIL_FIN).length,
    commandes: appels().map((a) => a.args[0]) };
  for (const pid of sortie.vivants) { try { process.kill(pid); } catch (e) { /* déjà mort */ } }
  process.stdout.write('@@SEC@@' + JSON.stringify(sortie) + '\n');
  process.exit(0);
}

if (CAS) {
  enfant().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
} else {
  const hote = require(path.join(COCKPIT, 'lib', 'accueil-secretariat-hote.js'));
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
  // Un test qui échoue en laissant un enfant ne doit pas figer le fichier : ses tuyaux le tiendraient en vie.
  // On tue par l'hôte, pas par un pid relevé plus tôt, que Windows a pu redonner à un autre processus.
  test.after(() => hote.arreter());
  const fin = () => envoyes.filter((m) => m.type === MSG.ACCUEIL_FIN).pop();
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
    assert.deepStrictEqual(envoyes.map((m) => m.type), [MSG.ACCUEIL_DEBUT, MSG.ACCUEIL_LIGNE, MSG.ACCUEIL_LIGNE,
      MSG.ACCUEIL_LIGNE, MSG.ACCUEIL_LIGNE, MSG.ACCUEIL_FIN]);
    assert.deepStrictEqual(envoyes[1].ligne, { t: 'etape', texte: 'Lecture…' }, 'chaque ligne passe telle quelle');
    assert.strictEqual(fin().ok, true);
    assert.strictEqual(fin().texte, 'Fini.');
    assert.strictEqual(fin().dossier, sortie);
    assert.match(fin().date, /^\d{2}\.\d{2}\.\d{4}$/);
    assert.deepStrictEqual(dossiers, [sortie], 'deux fichiers : leur dossier');
    assert.deepStrictEqual(lireHisto('historique-test.json'), undefined, 'la newsletter n’entre pas dans l’historique');
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
    assert.deepStrictEqual(envoyes.map((m) => m.type), [MSG.ACCUEIL_DEBUT, MSG.ACCUEIL_LIGNE, MSG.ACCUEIL_LIGNE, MSG.ACCUEIL_LIGNE, MSG.ACCUEIL_FIN]);
    assert.ok(envoyes.every((m) => m.type === MSG.ACCUEIL_FIN || m.type === MSG.ACCUEIL_DEBUT || m.commande === 'numeros-ojs'));
    const cache = val(appels()[0].args, '--cache');
    assert.strictEqual(val(appels()[0].args, '--depuis-annee'), '2026');
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-02', '2026-03'] });
    const a = appels()[1];
    assert.strictEqual(val(a.args, '--cache'), cache, 'le même fichier que le chargement');
    assert.strictEqual(val(a.args, '--numeros'), '2026-02,2026-03');
    assert.strictEqual(val(a.args, '--sortie'), path.join(EXPORTS, 'Edudoc'));
    assert.deepStrictEqual(reveles, [path.join(EXPORTS, 'Edudoc', 'f0.txt')], 'un seul fichier : sélectionné');
    const date = fin().date;
    assert.deepStrictEqual(lireHisto('historique-test.json'), { edudoc: { revue: { '2026-02': date, '2026-03': date } } });
    assert.deepStrictEqual(hote.historique(), lireHisto('historique-test.json'), 'l’historique que la page reçoit pour précocher');
    assert.deepStrictEqual(memoire, {}, 'rien n’est plus retenu par compte');
    await hote.exporter({ commande: 'caracteres', revue: 'revue', cles: ['2026-03'] });
    assert.strictEqual(val(appels()[2].args, '--sortie'), path.join(EXPORTS, 'Caractères par article'));
    assert.deepStrictEqual(Object.keys(lireHisto('historique-test.json')).sort(), ['caracteres', 'edudoc']);
  });

  test('secrétariat : un export échoué n’entre pas dans l’historique et n’ouvre rien', async () => {
    oublier();
    const avant = lireHisto('historique-test.json');
    process.env.SZH_FAUX_MODE = 'echec';
    try { await hote.exporter({ commande: 'edudoc', revue: 'zeitschrift', cles: ['2026-05'] }); }
    finally { delete process.env.SZH_FAUX_MODE; }
    assert.strictEqual(fin().ok, false);
    assert.strictEqual(fin().texte, 'Raté.');
    assert.deepStrictEqual(lireHisto('historique-test.json'), avant);
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
    assert.strictEqual(envoyes.filter((m) => m.type === MSG.ACCUEIL_DEBUT).length, 1, 'une seule tâche pour la page');
  });

  test('secrétariat : la langue de l’interface passe au CLI', async () => {
    oublier();
    process.env.SZH_LANGUE = 'de';
    try { await hote.exporter({ commande: 'caracteres', revue: 'zeitschrift', cles: ['2026-05'] }); }
    finally { process.env.SZH_LANGUE = 'fr'; }
    assert.strictEqual(val(appels()[0].args, '--langue'), 'de');
  });

  // ---- L'historique partagé : _Systeme\exports, le même pour tous les postes ----
  const viderHisto = () => { fs.rmSync(HISTO, { recursive: true, force: true }); };
  // Un « poste » : son propre globalState, branché sur l'hôte le temps d'une action.
  const poste = (etat) => ({ get: (k) => etat[k], update: (k, v) => { if (v === undefined) { delete etat[k]; } else { etat[k] = v; } return Promise.resolve(); } });
  const brancher = (m) => hote.configurer({ memoire: m });
  test.afterEach(() => { brancher({ get: (k) => memoire[k], update: (k, v) => { memoire[k] = v; return Promise.resolve(); } }); emplacement('test'); });

  // L'ancrage se normalise en chemin Windows : ce cas ne se joue que sous Windows.
  test('historique : _Systeme\\exports sous l’ancrage, un fichier à part en mode test',
    { skip: process.platform !== 'win32' ? 'chemins Windows — joué par le job contrats-windows' : false }, () => {
    const ancrage = path.join(TRAVAIL, 'Ancrage');
    fs.mkdirSync(ancrage, { recursive: true });
    const dossier = path.join(ancrage, '2_Produkte', '54_Pronto', '_Systeme', 'exports');
    delete process.env.SZH_HISTORIQUE_EXPORTS;
    process.env.SZH_ANCRAGE = ancrage;
    try {
      assert.strictEqual(hote.cheminHistorique(), path.join(dossier, 'historique-test.json'));
      emplacement('production');
      assert.strictEqual(hote.cheminHistorique(), path.join(dossier, 'historique.json'));
      process.env.SZH_ANCRAGE = '';
      assert.strictEqual(hote.cheminHistorique(), null, 'sans ancrage, pas de fichier');
    } finally { process.env.SZH_HISTORIQUE_EXPORTS = HISTO; process.env.SZH_ANCRAGE = ''; }
  });

  test('historique : deux postes précochent les mêmes numéros', async () => {
    oublier(); viderHisto();
    const a = {}; const b = {};
    brancher(poste(a));
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-03'] });
    const date = fin().date;
    brancher(poste(b));
    assert.deepStrictEqual(hote.historique(), { edudoc: { revue: { '2026-03': date } } }, 'le second poste voit l’export du premier');
    await hote.exporter({ commande: 'caracteres', revue: 'zeitschrift', cles: ['2026-05'] });
    brancher(poste(a));
    assert.deepStrictEqual(hote.historique(), { edudoc: { revue: { '2026-03': date } }, caracteres: { zeitschrift: { '2026-05': date } } });
    assert.deepStrictEqual([a, b], [{}, {}], 'aucun globalState n’est écrit');
  });

  test('historique : un export relit le fichier avant d’écrire, sans écraser celui d’un autre poste', async () => {
    oublier(); viderHisto();
    brancher(poste({}));
    assert.deepStrictEqual(hote.historique(), {});
    // Un autre poste exporte entre la lecture de la page et la fin de notre export.
    fs.mkdirSync(HISTO, { recursive: true });
    fs.writeFileSync(path.join(HISTO, 'historique-test.json'), JSON.stringify({ edudoc: { revue: { '2026-01': '01.02.2026' } } }));
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-03'] });
    assert.deepStrictEqual(lireHisto('historique-test.json'), { edudoc: { revue: { '2026-01': '01.02.2026', '2026-03': fin().date } } });
  });

  test('historique : le mode test écrit à part, la production ne le voit pas', async () => {
    oublier(); viderHisto();
    brancher(poste({}));
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-03'] });
    assert.ok(lireHisto('historique-test.json'));
    assert.strictEqual(lireHisto('historique.json'), undefined, 'l’essai ne pollue pas la production');
    emplacement('production');
    assert.deepStrictEqual(hote.historique(), {});
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-02'] });
    assert.deepStrictEqual(lireHisto('historique.json'), { edudoc: { revue: { '2026-02': fin().date } } });
    assert.deepStrictEqual(Object.keys(lireHisto('historique-test.json').edudoc.revue), ['2026-03']);
  });

  test('historique : illisible ou injoignable, il est vide et l’export n’est jamais bloqué', async () => {
    oublier(); viderHisto();
    brancher(poste({}));
    fs.mkdirSync(HISTO, { recursive: true });
    fs.writeFileSync(path.join(HISTO, 'historique-test.json'), '{ pas du json');
    assert.deepStrictEqual(hote.historique(), {});
    await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-03'] });
    assert.strictEqual(fin().ok, true);
    assert.deepStrictEqual(lireHisto('historique-test.json'), { edudoc: { revue: { '2026-03': fin().date } } });
    // Un dossier qui ne peut pas exister (son parent est un fichier) : rien ne lève, le journal le dit.
    const bloque = path.join(TRAVAIL, 'un-fichier');
    fs.writeFileSync(bloque, 'x');
    process.env.SZH_HISTORIQUE_EXPORTS = path.join(bloque, 'exports');
    const avertis = [];
    const warn = console.warn;
    console.warn = (...m) => avertis.push(m.join(' '));
    try {
      assert.deepStrictEqual(hote.historique(), {});
      oublier();
      await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-02'] });
    } finally { console.warn = warn; process.env.SZH_HISTORIQUE_EXPORTS = HISTO; }
    assert.strictEqual(fin().ok, true, 'l’export reste réussi');
    assert.strictEqual(avertis.length, 1);
    assert.match(avertis[0], /historique/);
  });

  test('historique : écrit dans un temporaire ~$ du même dossier, puis renommé', async () => {
    oublier(); viderHisto();
    brancher(poste({}));
    const renommages = [];
    const renommer = fs.renameSync;
    fs.renameSync = (de, vers) => { renommages.push([de, vers]); return renommer(de, vers); };
    try { await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-03'] }); }
    finally { fs.renameSync = renommer; }
    const cible = path.join(HISTO, 'historique-test.json');
    const vers = renommages.filter((r) => r[1] === cible);
    assert.strictEqual(vers.length, 1);
    assert.strictEqual(path.dirname(vers[0][0]), HISTO);
    assert.ok(path.basename(vers[0][0]).startsWith('~$'), path.basename(vers[0][0]));
    assert.deepStrictEqual(fs.readdirSync(HISTO), ['historique-test.json'], 'aucun temporaire ne reste');
  });

  test('historique : la clé d’un ancien poste est fusionnée une fois au premier export, puis oubliée', async () => {
    oublier(); viderHisto();
    const ancien = { [hote.CLE_HISTORIQUE]: { edudoc: { zeitschrift: { '2025-04': '03.09.2025' } } } };
    brancher(poste(ancien));
    assert.deepStrictEqual(hote.historique(), { edudoc: { zeitschrift: { '2025-04': '03.09.2025' } } }, 'la page la voit déjà');
    fs.mkdirSync(HISTO, { recursive: true });
    fs.writeFileSync(path.join(HISTO, 'historique-test.json'), JSON.stringify({ edudoc: { zeitschrift: { '2025-04': '10.09.2025' } } }));
    await hote.exporter({ commande: 'caracteres', revue: 'revue', cles: ['2026-03'] });
    assert.deepStrictEqual(lireHisto('historique-test.json'), {
      edudoc: { zeitschrift: { '2025-04': '10.09.2025' } }, caracteres: { revue: { '2026-03': fin().date } }
    }, 'le fichier partagé l’emporte sur la clé du poste');
    assert.deepStrictEqual(ancien, {}, 'la clé est retirée');
    // Un autre poste efface l'entrée : la clé oubliée ne la ramène pas.
    fs.writeFileSync(path.join(HISTO, 'historique-test.json'), '{}');
    assert.deepStrictEqual(hote.historique(), {});
  });

  // ---- Edudoc avec le vrai CLI : les mots-clés des numéros du poste, filtrés par le thésaurus ----
  const secretariat = require(path.join(COCKPIT, 'lib', 'secretariat.js'));
  const VRAI_CLI = path.join(COCKPIT, 'outils', 'secretariat-cli.js');
  const ARCHIVE = path.join(BASE, '_Archive', 'Revue', '2025-2');
  const ZEITSCHRIFT = path.join(BASE, 'Zeitschrift', '2026-5');
  const numeroLocal = (racine, revue, annee, numero, articles) => {
    fs.mkdirSync(racine, { recursive: true });
    fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), ['title: "Essai"', 'revue: ' + revue, 'lang: fr',
      'volume: "16"', 'numero: "' + numero + '"', 'date: "' + annee + '-09-01"', ''].join('\n'));
    for (const a of articles) {
      const dossier = path.join(racine, 'articles', a.slug);
      fs.mkdirSync(dossier, { recursive: true });
      fs.writeFileSync(path.join(dossier, a.slug + '.md'), 'Texte.\n');
      fs.writeFileSync(path.join(dossier, a.slug + '.meta.yaml'), ['type: varia', 'lang: fr', 'doi: "' + a.doi + '"',
        'title:', '  fr: "' + a.slug + '"', 'author:', '- prenom: "Amelie"', '  nom: "Dentz"', 'keywords:',
        '  fr: ' + JSON.stringify(a.fr), '  de: ' + JSON.stringify(a.de), ''].join('\n'));
    }
  };
  // Les deux listes sont triées chacune de son côté : leur rang ne les apparie pas.
  numeroLocal(NUMERO, 'revue', '2026', '03', [{ slug: 'a-encours', doi: '10.57161/r2026-03-01',
    fr: ['cycle d’orientation', 'jeu éducatif', 'processus cognitif', 'projet pilote'],
    de: ['kognitiver Prozess', 'Lernspiel', 'Orientierungsstufe', 'Pilotprojekt'] }]);
  numeroLocal(ARCHIVE, 'revue', '2025', '02', [{ slug: 'b-archive', doi: '10.57161/r2025-02-01',
    fr: ['inclusion'], de: ['Inklusion'] }]);
  numeroLocal(ZEITSCHRIFT, 'zeitschrift', '2026', '05', [{ slug: 'c-zeitschrift', doi: '10.57161/z2026-05-01',
    fr: ['inclusion'], de: ['Inklusion'] }]);
  const THESAURUS = path.join(TRAVAIL, 'mots-cles.json');
  fs.writeFileSync(THESAURUS, JSON.stringify({ dateFetch: '2026-09-27T00:00:00.000Z', motsCles: [
    { de: 'Orientierungsstufe', fr: "cycle d'orientation", manque: null },
    { de: 'Lernspiel', fr: 'jeu éducatif', manque: null },
    { de: 'Pilotprojekt (na)', fr: 'projet pilote (na)', manque: null },
    { de: 'Inklusion (SZH)', fr: 'inclusion (CSPS)', manque: null }
  ] }));
  // Ce que le chargement OJS aurait écrit pour ces deux numéros, sans réseau.
  const cacheOjs = (chemin) => {
    const numero = (annee, n, doi) => {
      const xml = '<OAI-PMH><ListRecords><record><header><identifier>oai:ojs.szh.ch:article/' + doi.slice(-7) +
        '</identifier><datestamp>2026-09-01T00:00:00Z</datestamp><setSpec>revue:VA</setSpec></header><metadata><oai_dc:dc>' +
        '<dc:title xml:lang="fr">Article ' + doi + '</dc:title><dc:creator>Dentz, Amélie</dc:creator><dc:identifier>' + doi +
        '</dc:identifier><dc:source>Revue suisse de pédagogie spécialisée; Vol. 16 No ' + n + ' (' + annee + '): Essai</dc:source>' +
        '</oai_dc:dc></metadata></record></ListRecords></OAI-PMH>';
      const art = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(xml)[0], 'revue');
      return [{ cle: annee + '-' + n, revue: 'revue', locale: 'fr', annee, numero: n, volume: '16', titre: 'Essai', issn: '', articles: [art] }];
    };
    secretariat.ecrireCacheNumeros(chemin, { version: 1, dateRecolte: null,
      numeros: { '2025-02': numero('2025', '02', '10.57161/r2025-02-01'), '2026-03': numero('2026', '03', '10.57161/r2026-03-01') } });
  };
  // Le CSV d'Edudoc en { DOI : { colonne : valeur } }.
  const lireCsv = (chemin) => {
    const champs = (l) => (l.match(/"(?:[^"]|"")*"/g) || []).map((c) => c.slice(1, -1).replace(/""/g, '"'));
    const [tete, ...corps] = fs.readFileSync(chemin, 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean).map(champs);
    const parDoi = {};
    for (const l of corps) {
      const o = {};
      tete.forEach((c, i) => { o[c] = l[i]; });
      parDoi[Object.values(o).find((v) => /^https:\/\/doi\.org\//.test(v)).replace('https://doi.org/', '')] = o;
    }
    return parDoi;
  };
  const descripteurs = (o) => Object.keys(o).filter((c) => /^690__a-/.test(c) && o[c])
    .map((c) => [o[c], o[c.replace('__a-', '__b-')]]);
  const avecThesaurus = async (chemin, fn) => {
    const avant = process.env.SZH_MOTS_CLES_CACHE;
    process.env.SZH_MOTS_CLES_CACHE = chemin;
    try { return await fn(); }
    finally { if (avant === undefined) { delete process.env.SZH_MOTS_CLES_CACHE; } else { process.env.SZH_MOTS_CLES_CACHE = avant; } }
  };
  async function exporterEdudoc(thesaurus) {
    oublier();
    await avecThesaurus(thesaurus, async () => {
      await hote.chargerOjs({ revue: 'revue', depuisAnnee: 2025 });
      cacheOjs(val(appels()[0].args, '--cache'));
      hote.configurer({ cli: VRAI_CLI });
      try { await hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2025-02', '2026-03'] }); }
      finally { hote.configurer({ cli: FAUX }); }
    });
    const lignes = envoyes.filter((m) => m.type === MSG.ACCUEIL_LIGNE && m.commande === 'edudoc').map((m) => m.ligne);
    return { lignes, fin: fin(), csv: lireCsv(path.join(EXPORTS, 'Edudoc', 'edudoc.csv')) };
  }

  test('secrétariat : Edudoc passe les numéros du poste et le thésaurus, et seuls ses descripteurs partent en 690', async () => {
    oublier();
    await avecThesaurus(THESAURUS, () => hote.exporter({ commande: 'edudoc', revue: 'revue', cles: ['2026-03'] }));
    const args = appels()[0].args;
    const numeros = args.filter((x, i) => args[i - 1] === '--numero');
    assert.deepStrictEqual(numeros.sort(), [ARCHIVE, NUMERO].sort(), 'en cours et archivés, de la seule revue choisie');
    assert.strictEqual(val(args, '--mots-cles'), THESAURUS, 'le cache que lit aussi le panneau des fiches');

    const r = await exporterEdudoc(THESAURUS);
    assert.strictEqual(r.fin.ok, true, r.fin.texte);
    assert.deepStrictEqual(descripteurs(r.csv['10.57161/r2026-03-01']), [
      ['Orientierungsstufe', "cycle d'orientation"], ['Lernspiel', 'jeu éducatif'], ['Pilotprojekt (na)', 'projet pilote (na)']
    ], 'la paire vient du thésaurus, apostrophe et qualificatif compris, jamais du rang');
    assert.deepStrictEqual(descripteurs(r.csv['10.57161/r2025-02-01']), [['Inklusion (SZH)', 'inclusion (CSPS)']]);
    const inconnus = r.lignes.filter((l) => l.t === 'avert' && /thésaurus/.test(l.texte));
    assert.strictEqual(inconnus.length, 1);
    assert.match(inconnus[0].texte, /processus cognitif, kognitiver Prozess/, 'l’écarté est dit au journal');
  });

  test('secrétariat : Edudoc sans cache de mots-clés part sans 690 et le dit', async () => {
    const r = await exporterEdudoc(path.join(TRAVAIL, 'absent', 'mots-cles.json'));
    assert.strictEqual(r.fin.ok, true, r.fin.texte);
    assert.deepStrictEqual(Object.keys(r.csv).sort(), ['10.57161/r2025-02-01', '10.57161/r2026-03-01']);
    assert.ok(Object.values(r.csv).every((o) => !Object.keys(o).some((c) => /^690/.test(c))), 'aucune colonne 690');
    const avert = r.lignes.filter((l) => l.t === 'avert');
    assert.deepStrictEqual(avert.map((l) => l.texte), [secretariat.dire('fr', 'edudoc.sanscache')]);
    assert.notStrictEqual(secretariat.dire('de', 'edudoc.sanscache'), secretariat.dire('fr', 'edudoc.sanscache'));
    assert.match(secretariat.dire('fr', 'edudoc.sanscache'), /mots-clés/);
  });

  test('secrétariat : « Afficher » ne montre que ce qui est sous Exports', () => {
    oublier();
    const fichier = path.join(EXPORTS, 'Edudoc', 'f0.txt');
    hote.surMessage({ type: MSG.ACCUEIL_AFFICHER, chemin: fichier });
    hote.surMessage({ type: MSG.ACCUEIL_AFFICHER, chemin: path.join(EXPORTS, 'Edudoc') });
    hote.surMessage({ type: MSG.ACCUEIL_AFFICHER, chemin: path.join(PROGRAMDATA, 'config.json') });
    hote.surMessage({ type: MSG.ACCUEIL_AFFICHER, chemin: path.join(EXPORTS, '..', 'Revue') });
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
      const ojs = appelDe('numeros-ojs').pid;
      const tache = appelDe('edudoc').pid;
      await hote.exporter({ commande: 'caracteres', revue: 'revue', cles: ['2026-03'] });
      hote.chargerOjs({ revue: 'zeitschrift', depuisAnnee: 2025 });
      assert.strictEqual(appels().length, 2, 'au plus un chargement et une tâche');
      hote.surMessage({ type: MSG.ACCUEIL_INTERROMPRE, commande: 'caracteres' });
      hote.surMessage({ type: MSG.ACCUEIL_INTERROMPRE, commande: 'edudoc' });
      await tenu(exportEnCours);
      assert.strictEqual(vivant(tache), false);
      assert.strictEqual(vivant(ojs), true, 'le chargement continue');
      const f = envoyes.filter((m) => m.type === MSG.ACCUEIL_FIN && m.commande === 'edudoc').pop();
      assert.strictEqual(f.ok, false);
      assert.strictEqual(f.annule, true);
      assert.strictEqual(f.texte, '');
      hote.arreter();
      await tenu(chargement);
      assert.strictEqual(vivant(ojs), false);
    } finally { delete process.env.SZH_FAUX_MODE; hote.arreter(); }
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
    } finally { delete process.env.SZH_FAUX_MODE; hote.arreter(); }
  });

  // Les trois actions qui ferment l'Accueil, dans l'extension activée : chacune dans son
  // propre processus, le faux vscode ne s'activant qu'une fois.
  for (const cas of ['fermeture', 'dossier', 'desactivation']) {
    test('secrétariat : ' + cas + ' de l’Accueil pendant un export, et aucun enfant ne survit', () => {
      const env = Object.assign({}, process.env, { SZH_SECRETARIAT_CAS: cas, SZH_ACCUEIL: '1' });
      const r = spawnSync(process.execPath, [__filename], { env, encoding: 'utf8', timeout: 120000 });
      const ligne = String(r.stdout || '').split(/\r?\n/).filter((l) => l.indexOf('@@SEC@@') === 0).pop();
      assert.ok(ligne, 'aucun verdict de l’enfant (' + (r.error || 'code ' + r.status) + ') : ' + r.stdout + r.stderr);
      const v = JSON.parse(ligne.slice('@@SEC@@'.length));
      assert.strictEqual(v.pids.length, 2, 'la tâche et le chargement tournaient : ' + JSON.stringify(v));
      assert.deepStrictEqual(v.vivants, [], 'orphelins : ' + v.vivants.join(', '));
    });
  }
}
