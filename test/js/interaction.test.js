// La garde d'interaction : un QuickPick de VS Code se ferme dès que le focus bouge, et la
// fin d'une compilation le lui volait — réassignation du HTML de l'aperçu, notification
// des contrôles. Le rédacteur qui choisissait un titre ou parcourait un panneau
// (Ctrl+Alt+A/S/D) voyait son geste s'évaporer dès qu'un PDF sortait.
//
//   node --test "test/js/*.test.js"
//
// Deux familles de contrôle :
//   1. lib/interaction.js tout seul — le module est pur, pas de vscode : exécution
//      immédiate hors interaction, rétention pendant, une action par clé, rejeu à la
//      fermeture de la DERNIÈRE interaction, et un compteur qui survit aux exceptions.
//   2. L'hôte réellement activé : chaque panneau du cockpit tient la garde tant que son
//      QuickPick est ouvert, la notification de fin de compilation attend la fermeture —
//      mais la barre d'état, inoffensive pour le focus, suit sans attendre.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { creerGarde } = require(path.join(COCKPIT, 'lib', 'interaction.js'));

const LF = String.fromCharCode(10);
const tick = () => new Promise((r) => setImmediate(r));

// ---- 1. Le module, pur ----

test('garde : sans interaction ouverte, l’action part sur-le-champ', () => {
  const g = creerGarde();
  let vécues = 0;
  g.differer('apercu', () => { vécues++; });
  assert.strictEqual(vécues, 1, 'hors interaction, différer serait un retard gratuit');
  assert.ok(!g.interactionEnCours());
});

test('garde : pendant une interaction, l’action attend la fermeture', async () => {
  const g = creerGarde();
  const traces = [];
  let resoudre;
  const p = g.sousGarde(() => new Promise((r) => { resoudre = r; }));
  assert.ok(g.interactionEnCours(), 'le compteur doit monter dès l’ouverture');
  g.differer('apercu', () => traces.push('apercu'));
  assert.deepStrictEqual(traces, [], 'l’action est partie pendant le QuickPick');
  resoudre('mon-choix');
  // Le choix du rédacteur traverse la garde intact — c'est lui qu'on protège.
  assert.strictEqual(await p, 'mon-choix');
  assert.deepStrictEqual(traces, ['apercu'], 'l’action n’a pas été rejouée à la fermeture');
  assert.ok(!g.interactionEnCours());
});

test('garde : une seule action par clé — la dernière gagne, les clés distinctes cohabitent', async () => {
  const g = creerGarde();
  const traces = [];
  let resoudre;
  const p = g.sousGarde(() => new Promise((r) => { resoudre = r; }));
  // Trois compilations finissent pendant le choix : un seul rafraîchissement, le dernier.
  g.differer('apercu', () => traces.push('apercu-1'));
  g.differer('notif', () => traces.push('notif-1'));
  g.differer('apercu', () => traces.push('apercu-2'));
  g.differer('apercu', () => traces.push('apercu-3'));
  resoudre(undefined);
  await p;
  // Une Map garde la position de la première insertion : « apercu » reste devant
  // « notif », mais c'est bien sa DERNIÈRE version qui tourne.
  assert.deepStrictEqual(traces, ['apercu-3', 'notif-1'],
    'soit un empilement de refresh, soit une clé écrasée à tort');
});

test('garde : deux interactions imbriquées — rien ne part avant la fermeture de la dernière', async () => {
  const g = creerGarde();
  const traces = [];
  let r1, r2;
  // « Autre titre… » : un QuickPick puis une InputBox, ou une garde englobante et une
  // interne. Le rejeu à la fermeture de la première aurait volé le focus de la seconde.
  const p1 = g.sousGarde(() => new Promise((r) => { r1 = r; }));
  const p2 = g.sousGarde(() => new Promise((r) => { r2 = r; }));
  g.differer('apercu', () => traces.push('apercu'));
  r2(undefined);
  await p2;
  assert.deepStrictEqual(traces, [], 'la fermeture de l’interaction interne a tout rejoué trop tôt');
  assert.ok(g.interactionEnCours(), 'l’interaction externe est encore ouverte');
  r1(undefined);
  await p1;
  assert.deepStrictEqual(traces, ['apercu']);
  assert.ok(!g.interactionEnCours());
});

test('garde : une exception dans le choix ne casse ni le compteur ni le rejeu', async () => {
  const g = creerGarde();
  const traces = [];
  let rejeter;
  const p = g.sousGarde(() => new Promise((x, r) => { rejeter = r; }));
  g.differer('apercu', () => traces.push('apercu'));
  rejeter(new Error('boum'));
  // L'exception remonte au point d'appel — la garde ne l'avale pas —
  await assert.rejects(p, /boum/);
  // — mais le compteur est redescendu et la file a été vidée quand même : sinon, tous les
  // rafraîchissements suivants resteraient différés pour toujours.
  assert.ok(!g.interactionEnCours(), 'un choix qui échoue laisserait la garde fermée à jamais');
  assert.deepStrictEqual(traces, ['apercu']);
  g.differer('suite', () => traces.push('suite'));
  assert.deepStrictEqual(traces, ['apercu', 'suite'], 'la garde ne fonctionne plus après une exception');
});

test('garde : une action différée qui échoue n’emporte ni les autres ni le choix', async () => {
  const g = creerGarde();
  const traces = [];
  let resoudre;
  const p = g.sousGarde(() => new Promise((r) => { resoudre = r; }));
  g.differer('a', () => { throw new Error('rafraîchissement raté'); });
  g.differer('b', () => traces.push('b'));
  resoudre('choix');
  // Le rejeu se fait dans le finally de sousGarde : une exception y remplacerait le choix
  // que le rédacteur vient de faire. Elle doit rester locale à l'action.
  assert.strictEqual(await p, 'choix', 'une action ratée a avalé le choix du rédacteur');
  assert.deepStrictEqual(traces, ['b'], 'une action ratée a bloqué les suivantes');
});

test('garde : re-différer pendant le rejeu exécute tout de suite, sans boucle', async () => {
  const g = creerGarde();
  const traces = [];
  let resoudre;
  const p = g.sousGarde(() => new Promise((r) => { resoudre = r; }));
  // rechargerApercuHtmlSiChange différé peut, en tournant, repasser par differer : plus
  // aucune interaction n'est ouverte à ce moment-là, donc exécution immédiate — la file
  // ayant été vidée avant le rejeu, pas de boucle sur soi-même.
  g.differer('apercu', () => {
    traces.push('premier');
    g.differer('apercu', () => traces.push('second'));
  });
  resoudre(undefined);
  await p;
  assert.deepStrictEqual(traces, ['premier', 'second']);
});

// ---- 2. L'hôte, réellement activé ----

// Le même journal bloquant que controles.test.js : sortie réelle de la porte du Makefile
// sur un article sans titre, code de sortie 2.
const JOURNAL_BLOQUANT = [
  "[pipeline] ⚠ L'article « 01-inclusion » n'a pas de titre : la fiche articles/01-inclusion/01-inclusion.meta.yaml est absente, ou son titre est vide.",
  '[pipeline] À faire : ouvrez « Métadonnées des articles » dans le cockpit, saisissez le titre de cet article, enregistrez, puis relancez la compilation (Ctrl+S).',
  "[pipeline] Pourquoi la compilation s'arrête : sans titre, le PDF sortirait avec un titre de document vide tout en s'annonçant conforme PDF/UA. Un lecteur d'écran n'aurait rien à annoncer.",
  '[pipeline] [de] Der Artikel « 01-inclusion » hat keinen Titel: articles/01-inclusion/01-inclusion.meta.yaml fehlt, oder der Titel ist leer.',
  'make[1]: *** [/mnt/c/…/pipeline/Makefile:265: verifie-dossier] Error 1',
  'make: *** [/mnt/c/…/pipeline/Makefile:123: all] Error 2'
].join(LF) + LF;

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
// La même instance que celle du cockpit : le cache de require partage lib/interaction.js
// entre ce test, extension.js, panneaux.js et formatting.js.
const garde = require(path.join(COCKPIT, 'lib', 'interaction.js'));
const PICK_NEUTRE = () => Promise.resolve(undefined);

test('hôte : chaque panneau du cockpit tient la garde tant que son QuickPick est ouvert', async () => {
  for (const commande of ['szh.panneauCommande', 'szh.panneauEdition', 'szh.panneauExport']) {
    let resoudre;
    HOTE.stub.window.showQuickPick = () => new Promise((r) => { resoudre = r; });
    const p = HOTE.executer(commande);
    // Le panneau Export attend getCommands avant d'ouvrir son QuickPick : on laisse la
    // microtâche partir avant de regarder le compteur.
    await tick();
    assert.ok(garde.interactionEnCours(),
      commande + ' ouvre un QuickPick hors garde : la fin d’une compilation le fermerait');
    resoudre(undefined);
    await p;
    assert.ok(!garde.interactionEnCours(), commande + ' ne rend pas la garde en se fermant');
  }
  HOTE.stub.window.showQuickPick = PICK_NEUTRE;
});

test('hôte : la fin d’une compilation attend la fermeture du QuickPick — la barre d’état, non', async () => {
  fs.writeFileSync(path.join(REVUE, '.szh-journal.log'), JOURNAL_BLOQUANT, 'utf8');
  let resoudre;
  HOTE.stub.window.showQuickPick = () => new Promise((r) => { resoudre = r; });
  const panneau = HOTE.executer('szh.panneauCommande');
  await tick();
  const erreursAvant = HOTE.erreurs.length;

  // La compilation se termine pendant que le rédacteur parcourt le panneau.
  await HOTE.finirTache('Aperçu / Export PDF', 2);
  await tick();
  assert.strictEqual(HOTE.erreurs.length, erreursAvant,
    'la notification est partie pendant le QuickPick : c’est elle qui volait le focus');
  // Mais la barre d'état, qui ne touche pas au focus, dit déjà ce qu'il y a à corriger.
  assert.ok(HOTE.barreQuiDit('à corriger'),
    'la barre d’état devrait suivre sans attendre : elle est inoffensive pour le focus');

  // Le rédacteur referme son panneau : l'avis rattrape son retard, une seule fois.
  resoudre(undefined);
  await panneau;
  await tick();
  assert.strictEqual(HOTE.erreurs.length, erreursAvant + 1,
    'la notification différée n’est pas rejouée à la fermeture du panneau');
  HOTE.stub.window.showQuickPick = PICK_NEUTRE;
});

// ---- 3. Contrat de source : aucun QuickPick du cockpit hors garde ----

// Un futur showQuickPick posé sans garde referait le bogue en silence : on relit la
// source. Les appels directs sont écrits « sousGarde(() => vscode.window.show… » ;
// choisirTitreImportant enchaîne deux choix sous une garde englobante, testée à part.
test('contrat : tous les showQuickPick/showInputBox du cockpit passent par la garde', () => {
  const fichiers = {
    'lib/panneaux.js': fs.readFileSync(path.join(COCKPIT, 'lib', 'panneaux.js'), 'utf8'),
    'lib/formatting.js': fs.readFileSync(path.join(COCKPIT, 'lib', 'formatting.js'), 'utf8'),
    'extension.js': fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8')
  };
  const englobes = {
    // QuickPick puis InputBox d'« Autre titre… » sous une même garde : les deux appels de
    // choisirTitreImportant sont couverts par le sousGarde qui ouvre la fonction.
    'lib/formatting.js': { fonction: 'async function choisirTitreImportant', appels: 2 }
  };
  for (const [nom, source] of Object.entries(fichiers)) {
    const appels = (source.match(/vscode\.window\.show(QuickPick|InputBox)\(/g) || []).length;
    const directs = (source.match(/sousGarde\(\(\) =>\s*\n?\s*vscode\.window\.show(QuickPick|InputBox)\(/g) || []).length;
    let couverts = directs;
    const englobe = englobes[nom];
    if (englobe) {
      const debut = source.indexOf(englobe.fonction);
      assert.ok(debut !== -1, nom + ' : ' + englobe.fonction + ' a disparu, contrat à mettre à jour');
      const corps = source.slice(debut, source.indexOf('\nasync function', debut + 1));
      assert.ok(/return sousGarde\(async/.test(corps),
        nom + ' : choisirTitreImportant n’ouvre plus sur sousGarde');
      couverts += englobe.appels;
    }
    assert.strictEqual(couverts, appels,
      nom + ' : ' + (appels - couverts) + ' showQuickPick/showInputBox hors garde — '
      + 'la fin d’une compilation les fermerait');
  }
});

test('contrat : l’aperçu et la notification de fin de compilation passent par differer', () => {
  const source = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  assert.ok(source.indexOf("differer('apercu-html'") !== -1,
    'rechargerApercuHtmlSiChange réassigne webview.html sans garde : le focus repart');
  assert.ok(source.indexOf("differer('notif-journal'") !== -1,
    'relireJournal notifie sans garde : la fin de compilation interrompt le geste');
});
