// La flèche d'un constat sélectionne l'élément en cause là où il se corrige : le passage
// dans le .md, le tableau dans son éditeur.
//
//   node --test "test/js/selection-focus.test.js"
//
// Trois pièges, chacun éprouvé par le chemin réel du clic (vue « À corriger » -> commande ->
// éditeur) :
//   1. `vscode.open` rend la main avant que l'hôte d'extension connaisse le nouvel éditeur :
//      visibleTextEditors et activeTextEditor décrivent encore l'écran d'avant. Le harnais le
//      reproduit : l'ouverture ne les remplit pas, seul showTextDocument rend l'éditeur ;
//   2. le .md déjà ouvert dans un autre groupe ne doit pas recevoir la sélection à la place ;
//   3. une référence jamais citée vit dans <slug>.biblio.md, pas dans le .md, et son titre y
//      est en italique alors que le constat l'écrit aplati.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const LF = String.fromCharCode(10);
const NBSP = String.fromCharCode(0xa0);

const REVUE = revueDEssai();
const DOSSIER = path.join(REVUE, 'articles', '01-essai');
const MD = path.join(DOSSIER, '01-essai.md');
const BIBLIO = path.join(DOSSIER, '01-essai.biblio.md');
const JOURNAL = path.join(REVUE, '.szh-journal.log');

// L'appel tel que Word l'a laissé : une espace insécable avant l'année. Le constat, lui,
// porte une espace simple (normaliser() de szh-citations.lua).
fs.writeFileSync(MD, ['Un paragraphe.', '', 'Comme le montre (Shaw et al.,' + NBSP + '2023), rien.', '',
  '![Une legende](media/a.png){alt="desc"}', ''].join(LF));
// Deux tableaux de plus : l'un sans en-tête, l'autre dont la case du coin est vide.
fs.writeFileSync(path.join(DOSSIER, 'tables', 'table-02.html'),
  '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>' + LF);
fs.writeFileSync(path.join(DOSSIER, 'tables', 'table-03.html'),
  '<table data-entete-lignes="1"><thead><tr><th></th><th>Punkte</th></tr></thead>'
  + '<tbody><tr><td>x</td><td>1</td></tr></tbody></table>' + LF);

const HOTE = activerHote(REVUE);

// Ce que VS Code aurait rendu : un éditeur par fichier, sur le texte réel du disque.
const editeurs = [];
function editeurFactice(chemin, colonne) {
  const texte = fs.readFileSync(chemin, 'utf8');
  const ed = {
    viewColumn: colonne || 1, selection: null, revele: null,
    document: {
      uri: HOTE.stub.Uri.file(chemin), fileName: chemin,
      getText: () => texte,
      positionAt: (o) => {
        const avant = texte.slice(0, o).split(LF);
        return new HOTE.stub.Position(avant.length - 1, avant[avant.length - 1].length);
      }
    },
    revealRange(r) { ed.revele = r; },
    setDecorations() {}
  };
  editeurs.push(ed);
  return ed;
}
HOTE.stub.window.showTextDocument = (uri) => Promise.resolve(editeurFactice(uri.fsPath, 1));
HOTE.stub.window.createTextEditorDecorationType = () => ({ dispose() {} });
HOTE.stub.OverviewRulerLane = { Center: 2 };
// vscode.open n'est enregistrée nulle part : elle ne laisse aucune trace dans
// visibleTextEditors ni dans activeTextEditor.

function selectionne(ed) {
  if (!ed || !ed.selection) { return null; }
  const lignes = ed.document.getText().split(LF);
  const s = ed.selection.start;
  const f = ed.selection.end;
  assert.strictEqual(s.line, f.line, 'la sélection déborde sur plusieurs lignes');
  return lignes[s.line].slice(s.character, f.character);
}

async function vue(journal) {
  fs.writeFileSync(JOURNAL, journal, 'utf8');
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });
  const lignes = p.messages.filter((m) => m.type === 'valeurs').pop().lignes;
  const messages = lignes.reduce((t, l) => t.concat((l.messages || [])
    .map((m) => Object.assign({ carte: l }, m))), []);
  return { p: p, messages: messages };
}

const LIGNE = (code, champ, fr) => '[citations-avertissement] ' + code + ' | article « 01-essai » | '
  + champ + ' | ' + fr + ' | [de] x';

test('la flèche d’un appel sans référence le SÉLECTIONNE dans le .md, espace insécable comprise', async () => {
  const { p, messages } = await vue(LIGNE('appel-sans-reference', 'appel « (Shaw et al., 2023) »',
    'Appel sans référence : (Shaw et al., 2023).') + LF);
  const m = messages.find((x) => /Appel sans référence/.test(x.texte));
  assert.ok(m && m.action, 'le constat n’a pas de flèche');
  assert.strictEqual(m.action.id, 'article:(Shaw et al., 2023)');
  // Aucun éditeur visible, aucun éditeur actif : l'écran tel que la vue le laisse.
  HOTE.stub.window.visibleTextEditors = [];
  HOTE.stub.window.activeTextEditor = undefined;
  editeurs.length = 0;
  await p._recepteur({ type: 'action', cle: '01-essai', id: m.action.id });
  const ed = editeurs.find((e) => e.selection);
  assert.ok(ed, 'aucun éditeur n’a reçu de sélection : la flèche n’a toujours rien sélectionné');
  assert.strictEqual(ed.document.uri.fsPath, MD);
  assert.strictEqual(selectionne(ed), '(Shaw et al.,' + NBSP + '2023)');
  assert.ok(ed.revele, 'le passage sélectionné n’est pas amené à l’écran');
});

test('le .md ouvert dans un autre groupe ne vole pas la sélection', async () => {
  const ailleurs = editeurFactice(MD, 2);
  HOTE.stub.window.visibleTextEditors = [ailleurs];
  HOTE.stub.window.activeTextEditor = ailleurs;
  const { p, messages } = await vue(LIGNE('appel-sans-reference', 'appel « (Shaw et al., 2023) »',
    'Appel sans référence : (Shaw et al., 2023).') + LF);
  const m = messages.find((x) => /Appel sans référence/.test(x.texte));
  editeurs.length = 0;
  await p._recepteur({ type: 'action', cle: '01-essai', id: m.action.id });
  assert.strictEqual(ailleurs.selection, null, 'la sélection est partie dans la colonne 2');
  const ed = editeurs.find((e) => e.selection);
  assert.ok(ed && ed.viewColumn === 1, 'la colonne 1 n’a rien reçu');
  HOTE.stub.window.visibleTextEditors = [];
  HOTE.stub.window.activeTextEditor = undefined;
});

test('une référence jamais citée se sélectionne dans la bibliographie détachée, italique compris', async () => {
  const { p, messages } = await vue(LIGNE('reference-orpheline', 'reference « Dupont, A. (2024). Un titre. SZH. »',
    'Référence jamais appelée : Dupont, A. (2024). Un titre. SZH.…') + LF);
  const m = messages.find((x) => /Référence jamais citée/.test(x.texte));
  assert.ok(m && m.action, 'la référence orpheline n’a pas de flèche');
  editeurs.length = 0;
  await p._recepteur({ type: 'action', cle: '01-essai', id: m.action.id });
  const ed = editeurs.find((e) => e.selection);
  assert.ok(ed, 'la référence n’est sélectionnée nulle part');
  assert.strictEqual(ed.document.uri.fsPath, BIBLIO, 'ce n’est pas la bibliographie qui s’ouvre');
  assert.strictEqual(selectionne(ed), 'Dupont, A. (2024). *Un titre*. SZH.');
});

test('les titres trop profonds : la flèche sélectionne le premier titre écrasé', async () => {
  const texte = fs.readFileSync(MD, 'utf8');
  fs.writeFileSync(MD, texte + LF + '###### Annexe profonde' + LF);
  try {
    const { p, messages } = await vue('[niveaux] 01-essai : plus de 5 rangs de titre — les niveaux 6 '
      + 'se retrouvent tous en <h6>.' + LF);
    const m = messages.find((x) => /Titres trop profonds/.test(x.texte));
    assert.ok(m && m.action, 'le constat des niveaux n’a pas de flèche');
    assert.strictEqual(m.action.id, 'article:###### Annexe profonde',
      'la flèche ne vise pas le titre en cause : ' + m.action.id);
    editeurs.length = 0;
    await p._recepteur({ type: 'action', cle: '01-essai', id: m.action.id });
    assert.strictEqual(selectionne(editeurs.find((e) => e.selection)), '###### Annexe profonde');
  } finally { fs.writeFileSync(MD, texte); }
});

test('un tableau sans en-tête ouvre l’éditeur de CE tableau, pas le texte', async () => {
  const { p, messages } = await vue('[import-avertissement] tableau-sans-entete | article « 01-essai » | '
    + 'tableau 2 | debut « a » | Aucun en-tête. | [de] Keine Kopfzeile.' + LF);
  const m = messages.find((x) => /tableau sans en-tête/i.test(x.titre || ''));
  assert.ok(m, 'la carte des tableaux sans en-tête manque : ' + messages.map((x) => x.titre).join(' | '));
  assert.strictEqual(m.titre, '1 tableau sans en-tête');
  assert.deepStrictEqual(m.elements.map((e) => e.id), ['table:table-02.html']);
  assert.strictEqual(m.action.id, 'table:table-02.html', 'un seul tableau : le bouton doit y aller tout droit');
  await p._recepteur({ type: 'action', cle: '01-essai', id: m.action.id });
  const editeur = HOTE.panneauDeType('szhEditeurTable');
  assert.ok(editeur, 'l’éditeur de tableaux ne s’ouvre pas');
  assert.match(String(editeur.title), /table-02\.html/, 'ce n’est pas CE tableau : ' + editeur.title);
});

test('une case d’en-tête vide : ambre, le tableau nommé, et l’éditeur au bout du lien', async () => {
  const { p, messages } = await vue('');
  const m = messages.find((x) => /en-tête vide/.test(x.titre || ''));
  assert.ok(m, 'la case d’en-tête vide n’est pas signalée : ' + messages.map((x) => x.titre).join(' | '));
  assert.strictEqual(m.ton, 'attention', 'une case vide ne bloque rien : jamais rouge');
  assert.strictEqual(m.titre, 'Case d’en-tête vide');
  assert.deepStrictEqual(m.elements.map((e) => [e.libelle, e.id]), [['table-03.html', 'table:table-03.html']]);
  assert.match(m.consigne, /^Donnez-lui un intitulé/);
  assert.match(m.infobulle, /colonne sans nom/);
  await p._recepteur({ type: 'action', cle: '01-essai', id: m.elements[0].id });
  const editeurs = HOTE.panneaux.filter((x) => x.type === 'szhEditeurTable');
  assert.ok(editeurs.some((x) => /table-03\.html/.test(String(x.title))), 'le lien n’ouvre pas CE tableau');
});

test('la flèche « table » sans tableau nommé : la liste, puis le tableau choisi', async () => {
  HOTE.repondreQuickPick('table-01.html');
  await HOTE.executer('szh.editerTable', { slug: '01-essai', focus: '' });
  const editeurs = HOTE.panneaux.filter((x) => x.type === 'szhEditeurTable');
  assert.ok(editeurs.some((x) => /table-01\.html/.test(String(x.title))),
    'le tableau choisi dans la liste ne s’ouvre pas');
  HOTE.repondreQuickPick(undefined);
});
