// Le profil CMJN FOGRA52 : la licence de l'ECI interdit de le distribuer, et le dépôt est
// public. Seule sa copie chiffrée est suivie, et la CI comme l'image la déchiffrent au lieu
// de la télécharger.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const NOM = 'PSOuncoated_v3_FOGRA52.icc';
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

test('la copie chiffrée et son empreinte sont dans image/icc/', () => {
  const gpg = path.join(RACINE, 'image', 'icc', NOM + '.gpg');
  assert.ok(fs.statSync(gpg).size > 100000, NOM + '.gpg absent ou tronqué');
  assert.match(lire('image', 'icc', NOM + '.sha256'), new RegExp('^[0-9a-f]{64}  ' + NOM.replace(/\./g, '\\.') + '\\n$'));
});

test('aucun profil ICC en clair n’est suivi par git', () => {
  const suivis = execFileSync('git', ['ls-files', '-z'], { cwd: RACINE, encoding: 'utf8' })
    .split('\0').filter((f) => /\.(icc|icm)$/i.test(f));
  assert.deepStrictEqual(suivis, []);
  // Le clair que dechiffrer.sh pose à côté du .gpg est ignoré ; check-ignore sort en 1 sinon.
  execFileSync('git', ['check-ignore', '-q', 'image/icc/' + NOM], { cwd: RACINE });
});

test('ni la CI ni l’image ne téléchargent le profil de color.org', () => {
  for (const f of [['.github', 'workflows', 'ci.yml'], ['.github', 'workflows', 'release.yml'],
    ['image', 'Containerfile'], ['image', 'build-rootfs.sh']]) {
    assert.doesNotMatch(lire(...f), /color\.org/, f.join('/'));
  }
  assert.match(lire('.github', 'workflows', 'ci.yml'), /bash image\/icc\/dechiffrer\.sh/);
  assert.match(lire('image', 'build-rootfs.sh'), /bash icc\/dechiffrer\.sh/);
  assert.match(lire('image', 'Containerfile'), /^COPY icc\/\$\{ICC_NOM\} /m);
});
