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
  retirerLectureSeule(out);
  // Le fichier est de nouveau inscriptible : c'est ce que Windows lit comme « plus en
  // lecture seule ».
  fs.appendFileSync(pdf, '!');                    // lèverait si l'attribut tenait encore
  fs.rmSync(base, { recursive: true, force: true });
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
