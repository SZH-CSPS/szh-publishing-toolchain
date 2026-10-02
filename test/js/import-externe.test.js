// Un Word importé hors du cockpit (Ctrl+S, qui lance `make all`, ou la tâche d'import au
// démarrage) finit comme l'import guidé : ordre, préfixe, recompilation si le dossier a
// changé de nom, et vérification de l'import.
//
//   node --test test/js/import-externe.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const LF = String.fromCharCode(10);
const NOM_IMPORT = 'Importer les articles Word';
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));
const attendre = async (n) => { for (let i = 0; i < (n || 8); i++) { await tick(); } };

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);
const MOTS = path.join(REVUE, 'articles-word');
const ARTICLES = path.join(REVUE, 'articles');

let lancees = [];
const origExecute = HOTE.stub.tasks.executeTask;

function simulerArticleImporte(slug, titre) {
  const dossier = path.join(ARTICLES, slug);
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte importé.' + LF);
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'title:', '  fr: "' + titre + '"', ''].join(LF));
}

function fermerVerif() {
  const p = HOTE.panneauDeType('szhImportVerif');
  if (p) { p.dispose(); }
}

test('mise en route', async () => {
  await demarrageSeTait(HOTE);
  fs.rmSync(path.join(MOTS, '9_Essai.docx'), { force: true });
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
  HOTE.stub.tasks.executeTask = (t) => { lancees.push(t.name); return origExecute(t); };
});

test('Ctrl+S (make all) : le nouvel article reçoit son préfixe, son rang, et se recompile', async () => {
  lancees = [];
  fs.writeFileSync(path.join(MOTS, '3_Nouveau.docx'), Buffer.alloc(16));
  HOTE.demarrerTache(NOM_BUILD);
  // `make all` : l'import convertit et supprime le Word, puis la passe pdf compile le
  // dossier sous le nom que l'import lui a donné.
  fs.rmSync(path.join(MOTS, '3_Nouveau.docx'));
  simulerArticleImporte('nouveau', 'Article nouveau');
  fs.mkdirSync(path.join(REVUE, 'out', 'nouveau'), { recursive: true });
  fs.writeFileSync(path.join(REVUE, 'out', 'nouveau', 'nouveau.pdf'), 'pdf');
  HOTE.finirTache(NOM_BUILD, 0);
  await attendre();

  assert.ok(fs.existsSync(path.join(ARTICLES, '02-nouveau', '02-nouveau.md')),
    'le dossier importé n’a pas reçu son préfixe : ' + fs.readdirSync(ARTICLES).join(', '));
  assert.match(fs.readFileSync(path.join(REVUE, 'ausgabe.yaml'), 'utf8'),
    /ordre-articles: \["01-essai", "02-sans-fiche", "02-nouveau"\]/);
  assert.ok(!fs.existsSync(path.join(REVUE, 'out', 'nouveau')),
    'le PDF compilé sous l’ancien nom est resté dans out/');
  assert.deepStrictEqual(lancees, [NOM_BUILD], 'le dossier renommé devait se recompiler');

  await HOTE.finirTache(NOM_BUILD, 0);
  await attendre();
  assert.ok(HOTE.panneauDeType('szhImportVerif'), 'la vérification d’import ne s’est pas ouverte');
  fermerVerif();
});

test('la tâche d’import seule (démarrage, Ctrl+Alt+I) enchaîne aussi sur la compilation', async () => {
  lancees = [];
  fs.writeFileSync(path.join(MOTS, 'Autre.docx'), Buffer.alloc(16));
  HOTE.demarrerTache(NOM_IMPORT);
  fs.rmSync(path.join(MOTS, 'Autre.docx'));
  simulerArticleImporte('autre', 'Autre');
  HOTE.finirTache(NOM_IMPORT, 0);
  await attendre();
  assert.ok(fs.existsSync(path.join(ARTICLES, '03-autre', '03-autre.md')));
  assert.deepStrictEqual(lancees, [NOM_BUILD]);
  await HOTE.finirTache(NOM_BUILD, 0);
  await attendre();
  assert.ok(HOTE.panneauDeType('szhImportVerif'));
  fermerVerif();
});

test('une compilation sans Word en attente ne déclenche rien', async () => {
  lancees = [];
  HOTE.demarrerTache(NOM_BUILD);
  simulerArticleImporte('a-la-main', 'À la main');
  HOTE.finirTache(NOM_BUILD, 0);
  await attendre();
  assert.ok(fs.existsSync(path.join(ARTICLES, 'a-la-main')), 'un dossier posé à la main a été renommé');
  assert.deepStrictEqual(lancees, []);
  fs.rmSync(path.join(ARTICLES, 'a-la-main'), { recursive: true, force: true });
});

test('une tâche en échec ne touche à rien', async () => {
  lancees = [];
  fs.writeFileSync(path.join(MOTS, 'Rate.docx'), Buffer.alloc(16));
  HOTE.demarrerTache(NOM_BUILD);
  fs.rmSync(path.join(MOTS, 'Rate.docx'));
  simulerArticleImporte('rate', 'Raté');
  HOTE.finirTache(NOM_BUILD, 2);
  await attendre();
  assert.ok(fs.existsSync(path.join(ARTICLES, 'rate')));
  assert.deepStrictEqual(lancees, []);
  fs.rmSync(path.join(ARTICLES, 'rate'), { recursive: true, force: true });
});

test('l’import guidé ne se double pas de la suite externe', async () => {
  lancees = [];
  fs.writeFileSync(path.join(MOTS, 'Guide.docx'), Buffer.alloc(16));
  // Les écritures de l'ordre : une seule suite d'import doit l'écrire.
  let ecrituresOrdre = 0;
  const vers = (p) => String(p).endsWith('ausgabe.yaml');
  const origRename = fs.renameSync, origWrite = fs.writeFileSync;
  fs.renameSync = function (a, b) { if (vers(b)) { ecrituresOrdre++; } return origRename.apply(fs, arguments); };
  fs.writeFileSync = function (p) { if (vers(p)) { ecrituresOrdre++; } return origWrite.apply(fs, arguments); };
  const promesse = HOTE.executer('szh.convertirEnAttente');
  await attendre(4);
  // VS Code annonce aussi le démarrage des tâches que le cockpit lance lui-même.
  HOTE.demarrerTache(NOM_IMPORT);
  fs.rmSync(path.join(MOTS, 'Guide.docx'));
  simulerArticleImporte('guide', 'Guidé');
  await HOTE.finirTache(NOM_IMPORT, 0);
  await attendre();
  HOTE.demarrerTache(NOM_BUILD);
  await HOTE.finirTache(NOM_BUILD, 0);
  await promesse;
  await attendre();
  fs.renameSync = origRename;
  fs.writeFileSync = origWrite;
  assert.strictEqual(ecrituresOrdre, 1, 'l’ordre a été écrit par deux suites d’import');
  assert.deepStrictEqual(lancees, [NOM_IMPORT, NOM_BUILD], 'une compilation de trop est partie');
  const dossiers = fs.readdirSync(ARTICLES).filter((d) => /guide$/.test(d));
  assert.deepStrictEqual(dossiers, ['04-guide']);
  fermerVerif();
  HOTE.stub.tasks.executeTask = origExecute;
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
});
