// Le correctif SZH de WeasyPrint (image/patches/weasyprint-<version>.patch) : qu'il existe
// pour la version épinglée, et que l'image ET la CI l'appliquent au même moment — juste
// après l'installation épinglée. Contrat de texte, sans outil : le comportement (veraPDF
// avant/après) est éprouvé par test/weasyprint-patch.test.js dans le job pdf-ua.
//
// Pourquoi ce contrat : sans le patch, un th colspan=2 laisse sa seconde colonne en
// /Headers [] (PDF/UA-1 7.5-1) et une image alt="" + role="presentation" sort en /Figure
// sans /Alt (7.3-1). Un Containerfile qui oublierait de l'appliquer produirait une flotte
// non conforme sans qu'aucune ligne du pipeline ait bougé.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const RACINE = path.resolve(__dirname, '..', '..');
const IMAGE = path.join(RACINE, 'image');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

function versionEpinglee() {
  const m = lire('image', 'requirements.txt').match(/^weasyprint==(\S+)\s*$/m);
  assert.ok(m, 'weasyprint==<version> introuvable dans image/requirements.txt');
  return m[1];
}

test('un patch existe pour la version de WeasyPrint épinglée', () => {
  const v = versionEpinglee();
  const fichier = path.join(IMAGE, 'patches', 'weasyprint-' + v + '.patch');
  assert.ok(fs.existsSync(fichier),
    'image/patches/weasyprint-' + v + '.patch absent : une montée de WeasyPrint oblige à '
    + 'rejuger le correctif (voir l\'en-tête du patch précédent)');
});

test('le patch touche tags.py et stream.py, en LF, sans horodatage', () => {
  const texte = lire('image', 'patches', 'weasyprint-' + versionEpinglee() + '.patch');
  assert.ok(!texte.includes('\r'), 'CRLF dans le patch : patch --fuzz=0 le refuserait');
  const cibles = [...texte.matchAll(/^\+\+\+ b\/(\S+)$/gm)].map((m) => m[1]).sort();
  assert.deepStrictEqual(cibles, ['weasyprint/pdf/stream.py', 'weasyprint/pdf/tags.py']);
  // Les deux corrections, repérées par ce qu'elles introduisent.
  assert.match(texte, /^\+def is_decorative_image\(box\):$/m);
  assert.match(texte, /^\+\s+j = cell\.grid_x$/m);
  assert.match(texte, /^\+\s+for token in cell\.element\.attrib\.get\('headers', ''\)\.split\(\)$/m);
});

test('patch-weasyprint.sh refuse le flou, le double passage et le demi-patch', () => {
  const s = lire('image', 'patch-weasyprint.sh');
  assert.match(s, /^set -eu$/m);
  assert.match(s, /patch --dry-run [^\n]*--forward --batch --fuzz=0/);
  assert.match(s, /\npatch -d [^\n]*--forward --batch --fuzz=0/);
  assert.ok(s.indexOf('--dry-run') < s.indexOf('\npatch -d'), 'le --dry-run doit précéder la pose');
  assert.match(s, /weasyprint-\$VERSION\.patch/, 'le patch doit être choisi par la version INSTALLÉE');
});

test('le Containerfile applique le patch juste après l\'installation épinglée', () => {
  const c = lire('image', 'Containerfile');
  assert.match(c, /^COPY patch-weasyprint\.sh \/tmp\/patch-weasyprint\.sh$/m);
  assert.match(c, /^COPY patches\/ \/tmp\/patches\/$/m);
  const pip = c.indexOf('/opt/weasyprint/bin/pip install --no-cache-dir -r /tmp/requirements.txt');
  const pose = c.indexOf('sh /tmp/patch-weasyprint.sh /opt/weasyprint/bin/python /tmp/patches');
  const lien = c.indexOf('ln -s /opt/weasyprint/bin/weasyprint /usr/local/bin/weasyprint');
  assert.ok(pip > 0 && pose > pip && lien > pose, 'ordre attendu : pip install, patch, lien');
  // Même RUN : une erreur du patch doit faire tomber la couche d'installation elle-même.
  assert.ok(!c.slice(pip, pose).includes('\nRUN '), 'pip et patch doivent être dans le même RUN');
  // `patch` (GNU) est dans la liste apt du rootfs, pas seulement de l'étape veraPDF.
  const rootfs = c.slice(c.lastIndexOf('\nFROM '));
  assert.match(rootfs, /apt-get install -y --no-install-recommends \\\n[^\n]*\bpatch\b/);
});

test('la CI applique le même patch à son propre venv', () => {
  const ci = lire('.github', 'workflows', 'ci.yml');
  const pip = ci.indexOf('"$RUNNER_TEMP/weasyprint/bin/pip" install --quiet -r image/requirements.txt');
  const pose = ci.indexOf('sh image/patch-weasyprint.sh "$RUNNER_TEMP/weasyprint/bin/python" image/patches');
  assert.ok(pip > 0 && pose > pip, 'ci.yml doit appliquer le patch après son pip install');
  assert.match(ci, /apt-get install -y --no-install-recommends \\\n\s+make patch /);
});
