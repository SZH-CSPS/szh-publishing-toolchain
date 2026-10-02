// « Éditer le tableau » lancé sans élément de l'arbre (palette, panneau Édition) : il vise
// le tableau dont la référence ::: {.szh-tabelle src="…"} entoure le curseur, et le dit
// quand le curseur n'est sur aucun.
//
//   node --test "test/js/table-curseur-hote.test.js"
//
// Un processus à lui : le crochet de Module._load posé par activerHote ne se défait pas.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);
const ARTICLE = path.join(REVUE, 'articles', '01-essai');
const MD = path.join(ARTICLE, '01-essai.md');
// Deux tableaux : l'article n'en ayant pas qu'un, seul le curseur peut désigner le bon.
fs.copyFileSync(path.join(ARTICLE, 'tables', 'table-01.html'), path.join(ARTICLE, 'tables', 'table-02.html'));

const LIGNES = [
  'Un paragraphe.',                                   // 0
  '',                                                 // 1
  '::: {.szh-tabelle src="tables/table-02.html"}',    // 2
  ':::',                                              // 3
  '',                                                 // 4
  'Après le tableau.'                                 // 5
];

// L'éditeur actif sur le .md, curseur à la ligne `ligne` (0-based).
function editeurSur(ligne) {
  HOTE.stub.window.activeTextEditor = {
    document: {
      uri: HOTE.stub.Uri.file(MD), fileName: MD, languageId: 'markdown',
      lineCount: LIGNES.length,
      lineAt: (i) => ({ text: LIGNES[i] || '' }),
      getText: () => LIGNES.join('\n')
    },
    selection: { active: new HOTE.stub.Position(ligne, 0) },
    viewColumn: 1
  };
}

function fermerEditeursTable() {
  for (const p of HOTE.panneaux.filter((x) => x.type === 'szhEditeurTable')) { p.dispose(); }
}

test('mise en route : le démarrage se tait', async () => {
  await demarrageSeTait(HOTE);
});

for (const [ligne, ou] of [[2, 'l’ouverture'], [3, 'la fermeture']]) {
  test('sans élément, le curseur sur ' + ou + ' du bloc ouvre ce tableau', async () => {
    fermerEditeursTable();
    editeurSur(ligne);
    const avant = HOTE.panneaux.length;
    await HOTE.executer('szh.editerTable');
    const ouverts = HOTE.panneaux.slice(avant).filter((p) => p.type === 'szhEditeurTable');
    assert.strictEqual(ouverts.length, 1, 'l’éditeur de tableau ne s’est pas ouvert');
    assert.ok(String(ouverts[0].title).indexOf('table-02.html') !== -1,
      'le tableau ouvert n’est pas celui de la référence : ' + ouverts[0].title);
  });
}

test('sans élément, hors d’un tableau : un message d’état, aucun éditeur', async () => {
  fermerEditeursTable();
  editeurSur(5);
  const avant = HOTE.panneaux.length;
  await HOTE.executer('szh.editerTable');
  assert.strictEqual(HOTE.panneaux.slice(avant).filter((p) => p.type === 'szhEditeurTable').length, 0,
    'un éditeur de tableau s’est ouvert hors d’une référence');
  assert.strictEqual(HOTE.statutsDits(i18n.TEXTES_COCKPIT.fr['table.curseur.aucun']).length, 1,
    'aucun message d’état ne dit où poser le curseur');
});

test('le panneau Édition offre « Éditer le tableau » dans le groupe Article', async () => {
  let propose = null;
  const avant = HOTE.stub.window.showQuickPick;
  HOTE.stub.window.showQuickPick = (items) => { propose = items; return Promise.resolve(undefined); };
  try {
    await HOTE.executer('szh.panneauEdition');
  } finally {
    HOTE.stub.window.showQuickPick = avant;
  }
  assert.ok(propose, 'aucun QuickPick proposé');
  const i = propose.findIndex((x) => x.commande === 'szh.editerTable');
  assert.notStrictEqual(i, -1, 'szh.editerTable absent du panneau Édition');
  const groupes = propose.slice(0, i).filter((x) => x.commande === undefined);
  assert.strictEqual(groupes[groupes.length - 1].label, i18n.TEXTES_COCKPIT.fr['panneau.g.article'],
    '« Éditer le tableau » n’est pas dans le groupe Article');
});

test('sortie : ni erreur ni avertissement de l’hôte', () => {
  fermerEditeursTable();
  assert.deepStrictEqual(HOTE.erreurs, []);
  assert.deepStrictEqual(HOTE.avertissements, []);
});
