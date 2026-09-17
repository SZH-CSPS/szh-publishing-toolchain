// Supprimer un arbre qui vit sur OneDrive.
//
//   node --test "test/js/*.test.js"
//
// Mesuré le 12.09.2026 : l'archivage du numéro 2027-03 s'est annulé parce que `out/`
// refusait de disparaître — EPERM sur le DOSSIER, pas sur un fichier. Il portait l'attribut
// `ReadOnly` que OneDrive pose sur ses dossiers marque-place, et `fs.rmSync` ne le retire
// que des fichiers. L'attribut ôté, la suppression passe.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { supprimerArbre, retirerLectureSeule } = require(path.join(COCKPIT, 'lib', 'supprimer.js'));

function arbre() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-suppr-'));
  fs.mkdirSync(path.join(base, 'out', 'article'), { recursive: true });
  fs.writeFileSync(path.join(base, 'out', 'article', 'article.pdf'), 'PDF');
  fs.writeFileSync(path.join(base, 'out', 'article', 'article.html'), '<p>');
  return base;
}

test('suppression : un arbre ordinaire part du premier coup', async () => {
  const base = arbre();
  const erreur = await supprimerArbre(path.join(base, 'out'));
  assert.strictEqual(erreur, null, 'refus inattendu : ' + erreur);
  assert.strictEqual(fs.existsSync(path.join(base, 'out')), false);
  fs.rmSync(base, { recursive: true, force: true });
});

test('suppression : un chemin déjà absent n’est pas une erreur', async () => {
  const base = arbre();
  assert.strictEqual(await supprimerArbre(path.join(base, 'jamais-existe')), null);
  fs.rmSync(base, { recursive: true, force: true });
});

test('suppression : les dossiers en lecture seule partent aussi', async () => {
  // Le cas réel : OneDrive pose l'attribut sur ses dossiers marque-place, et Windows refuse
  // alors de les supprimer. Le contrôle vaut sur les deux systèmes — ailleurs, c'est un
  // chmod ordinaire, et l'arbre part de toute façon.
  const base = arbre();
  const out = path.join(base, 'out');
  fs.chmodSync(path.join(out, 'article'), 0o555);
  fs.chmodSync(out, 0o555);
  const erreur = await supprimerArbre(out);
  assert.strictEqual(erreur, null, 'un dossier en lecture seule a résisté : ' + erreur);
  assert.strictEqual(fs.existsSync(out), false);
  fs.rmSync(base, { recursive: true, force: true });
});

test('suppression : l’attribut se retire sur tout l’arbre, pas seulement à la racine', async () => {
  const base = arbre();
  const out = path.join(base, 'out');
  const pdf = path.join(out, 'article', 'article.pdf');
  fs.chmodSync(pdf, 0o444);
  // Assertion explicite avant retrait : le fichier est bien en lecture seule (bit
  // d'écriture propriétaire absent), sinon le test suivant ne prouverait rien.
  assert.strictEqual(fs.statSync(pdf).mode & 0o200, 0,
    'le fichier n’est pas réellement en lecture seule avant le retrait');
  retirerLectureSeule(out);
  // Le fichier est de nouveau inscriptible : c'est ce que Windows lit comme « plus en
  // lecture seule ». Assertion explicite sur le mode, en plus de l'écriture réelle
  // ci-dessous (qui lèverait si l'attribut tenait encore).
  assert.notStrictEqual(fs.statSync(pdf).mode & 0o200, 0,
    'retirerLectureSeule n’a pas redonné le bit d’écriture, à deux niveaux de profondeur');
  fs.appendFileSync(pdf, '!');                    // lèverait si l'attribut tenait encore
  fs.rmSync(base, { recursive: true, force: true });
});

// Le nombre d'essais avant le retrait de l'attribut lecture-seule n'était verrouillé nulle
// part : rien n'empêchait un refactor de le déclencher un essai trop tard (ou trop tôt) sans
// qu'aucun test ne le remarque — seul le résultat final (l'arbre finit par partir) était
// vérifié, jamais LE MOMENT du retrait.
test('suppression : l’attribut se retire après le tout PREMIER refus, jamais plus tard', async () => {
  const base = arbre();
  const out = path.join(base, 'out');
  let essaisRm = 0;
  let essaisAvantChmod = null;
  const vraiRm = fs.rmSync;
  const vraiChmod = fs.chmodSync;
  fs.rmSync = () => { essaisRm++; const e = new Error('EPERM, operation not permitted'); e.code = 'EPERM'; throw e; };
  fs.chmodSync = (...args) => {
    if (essaisAvantChmod === null) { essaisAvantChmod = essaisRm; }
    return vraiChmod.apply(fs, args);
  };
  try {
    await supprimerArbre(out, { attentes: [1, 1, 1], dormir: () => Promise.resolve() });
    assert.strictEqual(essaisAvantChmod, 1,
      'l’attribut a été retiré après ' + essaisAvantChmod + ' échec(s) de rmSync, pas 1 : ' +
      'le retrait ne suit plus le tout premier refus');
  } finally {
    fs.rmSync = vraiRm;
    fs.chmodSync = vraiChmod;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('suppression : un refus qui dure rend le message, sans boucler sans fin', async () => {
  // On ne simule pas un verrou Windows : on vérifie le contrat de sortie — le nombre
  // d'attentes borne les essais, et le dernier message remonte tel quel.
  const base = arbre();
  const out = path.join(base, 'out');
  let essais = 0;
  const vraiRm = fs.rmSync;
  fs.rmSync = () => { essais++; const e = new Error('EPERM, operation not permitted'); e.code = 'EPERM'; throw e; };
  try {
    const erreur = await supprimerArbre(out, { attentes: [1, 1], dormir: () => Promise.resolve() });
    assert.match(String(erreur), /EPERM/, 'le message du dernier échec doit remonter');
    assert.strictEqual(essais, 3, 'deux attentes valent trois essais, pas davantage');
  } finally {
    fs.rmSync = vraiRm;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
