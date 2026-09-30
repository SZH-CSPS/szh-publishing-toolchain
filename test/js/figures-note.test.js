// La note d'une figure (note="…" sur l'image) et d'un tableau (data-note sur <table>) :
// imprimée sous l'objet, lue et réécrite par le cockpit sans rien perdre ni rien ajouter.
//
//   node --test test/js/figures-note.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { chargerAvecVscodeFactice } = require('./dom-minimal');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const ref = require(path.join(COCKPIT, 'lib', 'references.js'));
const table = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'table-model.js'));

const VALEURS = { legende: 'Une légende', alt: 'desc', altDefini: true,
                  copyright: '© A', source: 'ESA', horsFigure: false };

test('figure : la note se lit, se réécrit et reste stable', () => {
  const md = '![Une légende](media/a.png){alt="desc" copyright="© A" source="ESA" note="Données 2024."}\n';
  const lu = ref.lireAttributsImage(md, 'a.png');
  assert.strictEqual(lu.note, 'Données 2024.');
  assert.strictEqual(ref.listerImages(md)[0].note, 'Données 2024.');
  const v1 = ref.ecrireAttributsImage(md, 'a.png', Object.assign({}, VALEURS, { note: 'Données 2025.' }));
  assert.match(v1.texte, /note="Données 2025\."/);
  const v2 = ref.ecrireAttributsImage(v1.texte, 'a.png', Object.assign({}, VALEURS, { note: 'Données 2025.' }));
  assert.strictEqual(v2.texte, v1.texte, 'la réécriture n’est pas idempotente');
});

test('figure : sans note, aucun note="" n’apparaît ; vider la note retire l’attribut', () => {
  const md = '![Une légende](media/a.png){alt="desc"}\n';
  const sans = ref.ecrireAttributsImage(md, 'a.png', VALEURS);
  assert.ok(sans.texte.indexOf('note') === -1, sans.texte);
  assert.strictEqual(ref.lireAttributsImage(md, 'a.png').note, '');
  const avec = ref.ecrireAttributsImage(md, 'a.png', Object.assign({}, VALEURS, { note: 'N.' }));
  const vide = ref.ecrireAttributsImage(avec.texte, 'a.png', Object.assign({}, VALEURS, { note: '' }));
  assert.ok(vide.texte.indexOf('note') === -1, vide.texte);
  assert.ok(ref.referenceImage('a.png', VALEURS).indexOf('note') === -1);
  assert.match(ref.referenceImage('a.png', Object.assign({}, VALEURS, { note: 'N.' })), /note="N\."/);
});

const GRILLE = [
  '::: {.szh-grille disposition="auto"}',
  '![Légende](media/a.png){alt="A" note="Note de la figure."}',
  '![](media/b.png){alt="B"}',
  '![](media/c.png){alt="C"}',
  ':::', ''].join('\n');

test('grille : la note reste sur la première image quand on retire la deuxième', () => {
  assert.strictEqual(ref.lireAttributsImage(GRILLE, 'a.png').note, 'Note de la figure.');
  const apres = ref.retirerDeGrille(GRILLE, 'b.png', { garderDansTexte: false });
  assert.ok(apres.ok);
  assert.strictEqual(ref.lireAttributsImage(apres.texte, 'a.png').note, 'Note de la figure.');
  assert.strictEqual(ref.lireAttributsImage(apres.texte, 'a.png').legende, 'Légende');
  const sortie = ref.retirerDeGrille(GRILLE, 'b.png', { garderDansTexte: true });
  assert.strictEqual(ref.lireAttributsImage(sortie.texte, 'a.png').note, 'Note de la figure.');
});

test('grille : l’écriture ne pose la note que sur la première image', () => {
  const v = (n) => Object.assign({}, VALEURS, { note: n });
  // Une suiveuse qui porterait une note à la main la perd, comme sa légende.
  const sale = GRILLE.replace('{alt="B"}', '{alt="B" note="parasite"}');
  const r1 = ref.ecrireAttributsImage(sale, 'b.png', v('autre'));
  assert.ok(r1.texte.indexOf('parasite') === -1 && r1.texte.indexOf('autre') === -1, r1.texte);
  assert.strictEqual(ref.lireAttributsImage(r1.texte, 'a.png').note, 'Note de la figure.');
  const r2 = ref.ecrireAttributsImage(GRILLE, 'a.png', v('Nouvelle note.'));
  assert.strictEqual(ref.lireAttributsImage(r2.texte, 'a.png').note, 'Nouvelle note.');
  assert.strictEqual((r2.texte.match(/note=/g) || []).length, 1, 'la note est dupliquée : ' + r2.texte);
});

test('grille : une image qui rejoint la grille ne traîne pas sa note propre', () => {
  const md = '![Une](media/a.png){alt="A"}\n\n![Deux](media/b.png){alt="B" note="Propre."}\n';
  const r = ref.poserDansGrille(md, 'a.png', 'b.png');
  assert.ok(r.ok);
  assert.strictEqual(r.legendePerdue, true);
  assert.ok(r.texte.indexOf('Propre.') === -1, r.texte);
});

test('tableau : data-note fait l’aller-retour, et un tableau sans note n’en gagne pas', () => {
  const html = '<table class="szh-tableau" data-note="Lecture : 12 %."><tr><th>A</th></tr><tr><td>1</td></tr></table>';
  const m = table.analyserTable(html);
  assert.strictEqual(m.attrs.note, 'Lecture : 12 %.');
  const sortie = table.serialiserTable(m);
  assert.match(sortie, /data-note="Lecture : 12 %\."/);
  const m2 = table.analyserTable(sortie);
  assert.strictEqual(table.serialiserTable(m2), sortie, 'aller-retour instable');
  const nue = table.serialiserTable(table.analyserTable('<table><tr><td>1</td></tr></table>'));
  assert.ok(nue.indexOf('data-note') === -1, nue);
  m.attrs.note = '  a "b" <c>\n';
  const esc = table.serialiserTable(m);
  assert.match(esc, /data-note="a &quot;b&quot; &lt;c&gt;"/);
  m.attrs.note = '';
  assert.ok(table.serialiserTable(m).indexOf('data-note') === -1);
});
