// Les correctifs SZH de WeasyPrint (image/patches/weasyprint-<version>/, un fichier par
// sujet) : qu'ils existent pour la version épinglée, qu'ils restent indépendants les uns des
// autres, et que l'image ET la CI les appliquent au même moment — juste après
// l'installation épinglée. Contrat de texte, sans outil : le comportement (veraPDF
// avant/après) est éprouvé par test/weasyprint-patch-check.py dans le job pdf-ua.
//
// Pourquoi ce contrat : sans les patchs, un th colspan=2 laisse sa seconde colonne en
// /Headers [] (PDF/UA-1 7.5-1), une image alt="" + role="presentation" sort en /Figure
// sans /Alt (7.3-1), le copier-coller rend « ensei-gnants » et « lamarche », et l'en-tête
// courant sort en MCID rattachés à rien. Un Containerfile qui oublierait de les appliquer
// produirait une flotte non conforme sans qu'aucune ligne du pipeline ait bougé.
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

// nom du patch : fichiers visés, et une ligne que chacun introduit.
const PATCHS = {
  '10-tableaux-entetes': {
    cibles: ['weasyprint/pdf/tags.py'],
    reperes: [/^\+\s+j = cell\.grid_x$/m, /^\+\s+if html_id := cell\.element\.attrib\.get\('id'\):$/m],
  },
  '15-images-decoratives': {
    cibles: ['weasyprint/pdf/stream.py', 'weasyprint/pdf/tags.py'],
    reperes: [/^\+def is_decorative_image\(box\):$/m, /^\+from \.stream import is_decorative_image$/m],
  },
  // Le dessin de l'espace de fin de ligne est dans le 20 : il lit les variables du trait.
  '20-cesure-trait': {
    cibles: ['weasyprint/draw/text.py', 'weasyprint/layout/inline.py',
      'weasyprint/text/ffi.py', 'weasyprint/text/line_break.py'],
    reperes: [/^\+SOFT_HYPHEN_ACTUAL_TEXT = pydyf\.Dictionary\(\{'ActualText': pydyf\.String\('\\u00ad'\)\}\)$/m,
      /^\+\s+layout\.hyphenated = hyphenated$/m],
  },
  '25-espace-fin-de-ligne': {
    cibles: ['weasyprint/layout/inline.py'],
    reperes: [/^\+def _break_at_space\(box, skip_stack\):$/m, /^\+\s+textbox\.line_end_space = True$/m],
  },
  '30-marges-artefact': {
    cibles: ['weasyprint/draw/__init__.py', 'weasyprint/pdf/stream.py', 'weasyprint/pdf/tags.py'],
    reperes: [/^\+\s+def pagination_artifact\(self, box, page=None\):$/m,
      /^\+\s+with stream\.pagination_artifact\(stacking_context\.box, stacking_context\.page\):$/m],
  },
  '40-xmp-dc-language': {
    cibles: ['weasyprint/pdf/metadata.py'],
    reperes: [/^\+\s+element = SubElement\(element, f'\{\{\{NS\["dc"\]\}\}\}language'\)$/m],
  },
};

function dossierPatchs() {
  return path.join(IMAGE, 'patches', 'weasyprint-' + versionEpinglee());
}

// Texte d'un patch, qu'il soit actif (.patch) ou désactivé (.patch.off).
function lirePatch(nom) {
  const base = path.join(dossierPatchs(), nom + '.patch');
  const fichier = fs.existsSync(base) ? base : base + '.off';
  return fs.readFileSync(fichier, 'utf8');
}

test('un dossier de patchs existe pour la version épinglée, sans fichier égaré', () => {
  const d = dossierPatchs();
  assert.ok(fs.existsSync(d), path.relative(RACINE, d) + ' absent : une montée de WeasyPrint '
    + 'oblige à rejuger les correctifs (voir les en-têtes des patchs précédents)');
  const fichiers = fs.readdirSync(d).sort();
  for (const f of fichiers) {
    assert.match(f, /\.patch(\.off)?$/, f + ' : ni .patch ni .patch.off, patch-weasyprint.sh le refuserait');
  }
  const noms = fichiers.map((f) => f.replace(/\.patch(\.off)?$/, ''));
  assert.deepStrictEqual(noms, Object.keys(PATCHS));
});

test('chaque patch vise ses fichiers, en LF, sans horodatage', () => {
  for (const [nom, attendu] of Object.entries(PATCHS)) {
    const texte = lirePatch(nom);
    assert.ok(!texte.includes('\r'), nom + ' : CRLF, patch --fuzz=0 le refuserait');
    assert.ok(!/^(---|\+\+\+) \S+\t/m.test(texte), nom + ' : horodatage dans les en-têtes');
    const cibles = [...texte.matchAll(/^\+\+\+ b\/(\S+)$/gm)].map((m) => m[1]).sort();
    assert.deepStrictEqual(cibles, [...attendu.cibles].sort(), nom);
    for (const r of attendu.reperes) assert.match(texte, r, nom);
  }
});

// Deux patchs qui touchent le même fichier ne doivent partager aucune ligne, contexte
// compris : sans cela, l'un ne s'appliquerait plus au caractère près sans l'autre.
test('les patchs sont indépendants : aucun hunk ne chevauche celui d\'un autre patch', () => {
  const plages = {};  // fichier : [[début, fin, patch]] en lignes du fichier d'origine
  for (const nom of Object.keys(PATCHS)) {
    let fichier = null;
    for (const ligne of lirePatch(nom).split('\n')) {
      const m = ligne.match(/^--- a\/(\S+)$/);
      if (m) fichier = m[1];
      const h = ligne.match(/^@@ -(\d+)(?:,(\d+))? /);
      if (h) {
        const debut = Number(h[1]);
        (plages[fichier] = plages[fichier] || []).push([debut, debut + Number(h[2] ?? 1), nom]);
      }
    }
  }
  for (const [fichier, liste] of Object.entries(plages)) {
    liste.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < liste.length; i++) {
      const [a, b] = [liste[i - 1], liste[i]];
      if (a[2] !== b[2]) {
        assert.ok(b[0] > a[1], fichier + ' : ' + a[2] + ' (l. ' + a[0] + '-' + a[1] + ') et '
          + b[2] + ' (l. ' + b[0] + '-' + b[1] + ') se chevauchent');
      }
    }
  }
});

test('le contrôle connaît exactement les patchs du dossier', () => {
  const c = lire('test', 'weasyprint-patch-check.py');
  const connus = [...c.matchAll(/'(\d\d-[a-z-]+)\.patch'/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(connus, Object.keys(PATCHS));
});

test('patch-weasyprint.sh refuse le flou, le double passage et le demi-patch', () => {
  const s = lire('image', 'patch-weasyprint.sh');
  assert.match(s, /^set -eu$/m);
  assert.match(s, /PATCHES="\$DIR\/weasyprint-\$VERSION"/, 'les patchs doivent être choisis par la version INSTALLÉE');
  // Passe à blanc sur une copie du paquet, tous les patchs, avant toute pose réelle.
  const blanc = s.indexOf('patch --dry-run -d "$BANC" -p1 --forward --batch --fuzz=0');
  const reel = s.indexOf('patch -s -d "$SITE" -p1 --forward --batch --fuzz=0');
  assert.ok(blanc > 0 && reel > blanc, 'la passe à blanc sur la copie doit précéder la pose');
  assert.match(s, /\*\.patch\.off\)/, 'un .patch.off doit être annoncé comme ignoré');
  assert.match(s, /TEMOIN="\$SITE\/weasyprint\/szh-patchs\.txt"/);
  assert.ok(s.indexOf('if [ -e "$TEMOIN" ]') < blanc, 'un témoin présent doit arrêter avant toute pose');
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
