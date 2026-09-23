// Les commandes szh.fmt.* (lib/formatting.js) — figure, tableau, sautPage, noteBasPage,
// collerTableau, et la palette szh.miseEnForme — n'étaient exercées par aucun test :
// formatting.test.js et formatting-pur.test.js n'éprouvent que la part sans `vscode`
// (basculerEnrobage, poserBloc…), jamais la commande elle-même. Ici, l'hôte factice
// (test/js/hote-factice.js) active l'extension pour de vrai et joue ces commandes sur un
// éditeur factice — même patron que test/js/lier-reference.test.js pour szh.lierReference :
// hote.stub.window.activeTextEditor posé à la main, hote.stub.window.showQuickPick
// remplacé quand une réponse pilotée est nécessaire.
//
// lireHtmlPressePapiers (le seul accès PowerShell de ce module, presse-papiers HTML
// d'Excel/Word) est éprouvé à part, avec spawn injecté — même ruse que
// test/js/portraits-traitement.test.js : patch de require('child_process').spawn posé AVANT
// le premier require de hote-factice.js, qui charge ce module transitivement
// (extension.js -> lib/formatting.js). Le repli sur le TSV, lui, se vérifie en conditions
// réelles via szh.fmt.collerTableau : presse-papiers HTML absent (spawn qui échoue), lecture
// du TSV depuis vscode.env.clipboard.readText — que hote-factice.js ne pilote pas encore
// (seul writeText y existe) : on pose la réponse directement sur hote.stub.env.clipboard,
// à la façon dont lier-reference.test.js pose hote.stub.window.showQuickPick.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('node:events');

process.env.SZH_LANGUE = 'fr';

const cp = require('child_process');
const spawnReel = cp.spawn;
let impl = null;
cp.spawn = function (commande, args, options) {
  if (impl) { return impl(commande, args, options); }
  return spawnReel(commande, args, options);
};

function fauxProcessus() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.tue = false;
  p.kill = () => { p.tue = true; };
  return p;
}

const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);

const i18n = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));
const T = i18n.T;
const formatting = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'formatting.js'));

// Un éditeur minimal, une seule ligne : suffisant pour toutes les commandes szh.fmt.* qui
// travaillent ligne par ligne ou sur une sélection dans une seule ligne. `_info` retient ce
// que edit()/save() ont vu, pour les assertions.
function fauxEditeur(fsPath) {
  const info = { remplacements: [], sauvegardes: 0 };
  const ed = {
    document: {
      uri: { fsPath: fsPath },
      languageId: 'markdown',
      get lineCount() { return ed._lignes.length; },
      lineAt: (i) => ({ text: ed._lignes[i] }),
      getText: (plage) => {
        const ligne = ed._lignes[0] || '';
        return plage ? ligne.slice(plage.start.character, plage.end.character) : ligne;
      },
      save: () => { info.sauvegardes++; return Promise.resolve(true); }
    },
    selection: { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 },
      active: { line: 0, character: 0 } },
    edit: (f) => {
      f({ replace: (plage, texte) => { info.remplacements.push(texte); } });
      return Promise.resolve(true);
    },
    _lignes: [''],
    _info: info
  };
  return ed;
}

test('mise en route : le démarrage se tait', async () => { await demarrageSeTait(HOTE); });

test('szh.fmt.figure : copie l’image choisie dans media/, insère le lien, ouvre le gestionnaire',
  async () => {
    HOTE.erreurs.length = 0;
    const article = path.join(REVUE, 'articles', '01-essai', '01-essai.md');
    const mediaDir = path.join(REVUE, 'articles', '01-essai', 'media');
    const source = path.join(REVUE, 'source-figure.png');
    fs.writeFileSync(source, Buffer.from([1, 2, 3, 4]));

    const ed = fauxEditeur(article);
    HOTE.stub.window.activeTextEditor = ed;
    HOTE.repondreOuverture([{ fsPath: source }]);

    await HOTE.executer('szh.fmt.figure');

    const noms = fs.readdirSync(mediaDir);
    assert.ok(noms.indexOf('source-figure.png') !== -1,
      'le fichier choisi n’a pas été copié dans media/ : ' + noms.join(', '));
    assert.strictEqual(ed._info.remplacements[0],
      '![' + T('fmt.figure.legende') + '](media/source-figure.png)');
    assert.ok(ed._info.sauvegardes > 0,
      'le document n’a pas été enregistré avant l’ouverture du gestionnaire');
    assert.ok(HOTE.panneauDeType('szhMedias'), 'le gestionnaire des médias ne s’est pas ouvert');
    assert.deepStrictEqual(HOTE.erreurs, []);
  });

test('szh.fmt.tableau : écrit un tableau vierge sous tables/, insère la référence, ouvre l’éditeur',
  async () => {
    HOTE.erreurs.length = 0;
    const article = path.join(REVUE, 'articles', '01-essai', '01-essai.md');
    const dossierTables = path.join(REVUE, 'articles', '01-essai', 'tables');
    const avant = fs.readdirSync(dossierTables);   // table-01.html, posé par revueDEssai()

    const ed = fauxEditeur(article);
    ed._lignes = ['Un paragraphe.', ''];
    HOTE.stub.window.activeTextEditor = ed;

    await HOTE.executer('szh.fmt.tableau');

    const apres = fs.readdirSync(dossierTables);
    const nouveaux = apres.filter((n) => avant.indexOf(n) === -1);
    assert.strictEqual(nouveaux.length, 1,
      'aucun (ou plusieurs) nouveau fichier de tableau : ' + apres.join(', '));
    assert.strictEqual(nouveaux[0], 'table-02.html', 'le premier nom libre n’est pas table-02.html');
    assert.ok(ed._info.remplacements[0].indexOf('src="tables/table-02.html"') !== -1,
      'la référence insérée ne pointe pas vers le nouveau tableau : ' + ed._info.remplacements[0]);
    assert.ok(HOTE.panneauDeType('szhEditeurTable'), 'l’éditeur de tableau ne s’est pas ouvert');
    assert.deepStrictEqual(HOTE.erreurs, []);
  });

test('szh.fmt.sautPage : pose le marqueur ::: {.szh-saut} ::: à la coupure', async () => {
  const ed = fauxEditeur(path.join(REVUE, 'articles', '01-essai', '01-essai.md'));
  ed._lignes = ['Un paragraphe avant la coupure et sa suite.'];
  const point = 'Un paragraphe avant la coupure'.length;
  ed.selection = { active: { line: 0, character: point } };
  HOTE.stub.window.activeTextEditor = ed;

  await HOTE.executer('szh.fmt.sautPage');

  assert.strictEqual(ed._info.remplacements[0], '\n\n::: {.szh-saut}\n:::\n\n');
});

test('szh.fmt.noteBasPage : pose [^1] au curseur, sa définition en fin de document', async () => {
  const ed = fauxEditeur(path.join(REVUE, 'articles', '01-essai', '01-essai.md'));
  ed._lignes = ['Une phrase.', ''];
  const fin = { line: 0, character: 'Une phrase.'.length };
  ed.selection = { start: fin, end: fin };
  HOTE.stub.window.activeTextEditor = ed;

  await HOTE.executer('szh.fmt.noteBasPage');

  assert.strictEqual(ed._info.remplacements[0], 'Une phrase.[^1]\n\n[^1]: ');
});

test('szh.fmt.collerTableau : presse-papiers HTML absent, repli sur le TSV', async () => {
  HOTE.erreurs.length = 0;
  // PowerShell introuvable : lireHtmlPressePapiers() résout une chaîne vide, sans lever.
  impl = () => { const e = new Error('spawn powershell.exe ENOENT'); e.code = 'ENOENT'; throw e; };
  HOTE.stub.env.clipboard.readText = () => Promise.resolve('Colonne 1\tColonne 2\nA\tB\n');

  const article = path.join(REVUE, 'articles', '01-essai', '01-essai.md');
  const dossierTables = path.join(REVUE, 'articles', '01-essai', 'tables');
  const avant = fs.readdirSync(dossierTables);

  const ed = fauxEditeur(article);
  HOTE.stub.window.activeTextEditor = ed;

  await HOTE.executer('szh.fmt.collerTableau');

  const nouveau = fs.readdirSync(dossierTables).filter((n) => avant.indexOf(n) === -1)[0];
  assert.ok(nouveau, 'aucun tableau créé depuis le repli TSV');
  const html = fs.readFileSync(path.join(dossierTables, nouveau), 'utf8');
  assert.ok(html.indexOf('Colonne 1') !== -1 && html.indexOf('Colonne 2') !== -1,
    'le contenu du TSV n’a pas été repris : ' + html);
  assert.deepStrictEqual(HOTE.erreurs, []);
});

test('szh.miseEnForme : la palette pilotée par QuickPick choisit et applique szh.fmt.gras',
  async () => {
    const ed = fauxEditeur(path.join(REVUE, 'articles', '01-essai', '01-essai.md'));
    ed._lignes = ['mot'];
    ed.selection = { isEmpty: false, start: { line: 0, character: 0 }, end: { line: 0, character: 3 },
      active: { line: 0, character: 3 } };
    HOTE.stub.window.activeTextEditor = ed;
    let propose = null;
    HOTE.stub.window.showQuickPick = (items) => {
      propose = items;
      return Promise.resolve(items.find((i) => i.commande === 'szh.fmt.gras'));
    };

    await HOTE.executer('szh.miseEnForme');

    assert.ok(propose, 'aucun QuickPick proposé');
    assert.ok(propose.some((i) => i.kind === HOTE.stub.QuickPickItemKind.Separator),
      'les séparateurs de la palette ont disparu');
    assert.strictEqual(ed._info.remplacements[0], '**mot**');
  });

// ---- Groupe « Livre » (falc-header, qr-link) : absent d'une revue -------------------
//
// REVUE est une Revue (lang: fr) au sens de lib/yaml.js#REVUES, mais la condition qui
// filtre ces deux styles est hote.profil()/revue.profil() === 'livre' — indifférente à la
// langue. Une Zeitschrift (même profil 'revue', lang: de) est donc couverte par ce même
// contrôle ; voir test/js/hote-livre.test.js pour la présence côté livre.
test('szh.miseEnForme : le groupe « Livre » n’apparaît jamais pour une revue', async () => {
  const ed = fauxEditeur(path.join(REVUE, 'articles', '01-essai', '01-essai.md'));
  ed._lignes = ['mot'];
  HOTE.stub.window.activeTextEditor = ed;
  let propose = null;
  HOTE.stub.window.showQuickPick = (items) => { propose = items; return Promise.resolve(undefined); };
  try {
    await HOTE.executer('szh.miseEnForme');
  } finally {
    HOTE.stub.window.showQuickPick = (items) => Promise.resolve(undefined);
  }
  assert.ok(propose, 'aucun QuickPick proposé');
  assert.ok(!propose.some((i) => i.commande === 'szh.fmt.falcHeader'),
    'szh.fmt.falcHeader apparaît au clic droit d’une revue');
  assert.ok(!propose.some((i) => i.commande === 'szh.fmt.qrLink'),
    'szh.fmt.qrLink apparaît au clic droit d’une revue');
});

test('szh.panneauEdition : le groupe « Livre » n’apparaît jamais pour une revue', async () => {
  let propose = null;
  HOTE.stub.window.showQuickPick = (items) => { propose = items; return Promise.resolve(undefined); };
  try {
    await HOTE.executer('szh.panneauEdition');
  } finally {
    HOTE.stub.window.showQuickPick = (items) => Promise.resolve(undefined);
  }
  assert.ok(propose, 'aucun QuickPick proposé');
  assert.ok(!propose.some((i) => i.commande === 'szh.fmt.falcHeader'),
    'szh.fmt.falcHeader apparaît au panneau d’édition d’une revue');
  assert.ok(!propose.some((i) => i.commande === 'szh.fmt.qrLink'),
    'szh.fmt.qrLink apparaît au panneau d’édition d’une revue');
});

// ---- lireHtmlPressePapiers, directement : HTML rendu, délai dépassé, PowerShell absent ----

test('lireHtmlPressePapiers : le flux stdout est rendu tel quel', async () => {
  impl = () => {
    const p = fauxProcessus();
    setImmediate(() => {
      p.stdout.emit('data', Buffer.from('<table><tr><td>A</td></tr></table>', 'utf8'));
      p.emit('close', 0);
    });
    return p;
  };
  const texte = await formatting.lireHtmlPressePapiers();
  assert.strictEqual(texte, '<table><tr><td>A</td></tr></table>');
});

test('lireHtmlPressePapiers : délai dépassé -> processus tué, résout vide (jamais de rejet)',
  async () => {
    let p = null;
    impl = () => { p = fauxProcessus(); return p; };   // ne répond jamais
    const debut = Date.now();
    const texte = await formatting.lireHtmlPressePapiers(50);
    assert.strictEqual(texte, '');
    assert.ok(p.tue, 'le processus n’a pas été tué au délai');
    assert.ok(Date.now() - debut >= 40, 'la résolution est arrivée avant le délai');
  });

test('lireHtmlPressePapiers : PowerShell introuvable -> résout vide sans lever', async () => {
  impl = () => { const e = new Error('spawn powershell.exe ENOENT'); e.code = 'ENOENT'; throw e; };
  const texte = await formatting.lireHtmlPressePapiers(200);
  assert.strictEqual(texte, '');
});
