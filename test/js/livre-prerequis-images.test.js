// Une image du livre remplacée sous le même nom recompile ce qui l'incorpore : logos de
// l'impressum, illustration de partie, image d'une pièce liminaire. Compile une copie
// jetable de test/livre-normal (WSL), remplace l'image, relance make. Les fichiers du
// toolkit (badge, logo, fonds de couverture) se lisent dans la base de make.
//
//   node --test test/js/livre-prerequis-images.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl, cheminVersWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const BANC = path.join(RACINE, 'test', 'livre-normal');
const DISTRO = 'SZH-Publishing';

function make(dossier, cibles, options) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const args = ['-d', DISTRO, '--cd', cheminVersWsl(dossier), '--', 'make', ...(options || []), '-f',
    cheminVersWsl(path.join(RACINE, 'pipeline', 'Makefile')), ...cibles];
  return spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe', args,
    { encoding: 'utf8', windowsHide: true, timeout: 280000 });
}

// Le même octet ne peut pas sortir de l'ancienne image : on lui ajoute une queue après IEND,
// que les lecteurs PNG ignorent.
function remplacer(fichier, marque) {
  const neuf = Buffer.concat([fs.readFileSync(fichier), Buffer.from('szh-' + marque)]);
  fs.writeFileSync(fichier, neuf);
  const t = Date.now() / 1000 + 2;
  fs.utimesSync(fichier, t, t);
  return neuf.toString('base64');
}

test('livre : remplacer une image sous le même nom recompile les assemblages qui l’incorporent',
  { timeout: 300000 }, async (t) => {
    if (sansPandocWsl) { return sauter.wsl(t); }
    const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-livre-img-')), 'livre-img');
    try {
      fs.cpSync(BANC, d, { recursive: true, filter: (s) => path.basename(s) !== 'out' });
      // Une image dans une pièce de fin, à la place que livre-scinder.py lui donne.
      fs.mkdirSync(path.join(d, 'liminaires', 'media'), { recursive: true });
      fs.copyFileSync(path.join(d, 'parties', 'illustration-1.png'),
        path.join(d, 'liminaires', 'media', 'portrait.png'));
      fs.appendFileSync(path.join(d, 'liminaires', 'autorinnen.md'),
        '\n![Porträt einer erfundenen Person](media/portrait.png)\n', 'utf8');
      const nom = path.basename(d);
      const cibles = ['out/' + nom + '.html', 'out/' + nom + '-imprimeur.html',
        'out/web/' + nom + '.html', 'out/' + nom + '-epub.html'];
      const premiere = make(d, cibles);
      assert.strictEqual(premiere.status, 0, premiere.stdout + premiere.stderr);

      for (const image of ['impressum/soutien.png', 'impressum/druck-2.png',
        'parties/illustration-1.png', 'liminaires/media/portrait.png']) {
        await t.test(image, () => {
          const b64 = remplacer(path.join(d, image), image);
          const q = make(d, [cibles[0]], ['-q']);
          assert.notStrictEqual(q.status, 0, image + ' : make dit le livre à jour');
          const r = make(d, cibles);
          assert.strictEqual(r.status, 0, image + ' : ' + r.stdout + r.stderr);
          const perimees = cibles.filter((c) => !fs.readFileSync(path.join(d, c), 'utf8').includes(b64));
          assert.deepStrictEqual(perimees, [], image + ' : ancienne image dans ces sorties');
        });
      }
    } finally { fs.rmSync(path.dirname(d), { recursive: true, force: true }); }
  });

// Les prérequis d'une cible, lus dans la base de make (`-p`).
function prerequis(sortie, cible) {
  const ligne = sortie.split(/\r?\n/).find((l) => l.startsWith(cible + ':'));
  return ligne ? ligne.slice(cible.length + 1).trim().split(/\s+/) : null;
}

test('livre.mk : badge, logo de page de titre et fonds de couverture en prérequis ; un nom absent ne casse pas make',
  { timeout: 300000 }, (t) => {
    if (sansPandocWsl) { return sauter.wsl(t); }
    const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-livre-img-')), 'livre-noms');
    try {
      fs.mkdirSync(path.join(d, 'chapitres', '01-a'), { recursive: true });
      fs.writeFileSync(path.join(d, 'chapitres', '01-a', '01-a.md'), '# Titel\n\nText.\n', 'utf8');
      fs.mkdirSync(path.join(d, 'couverture'));
      fs.writeFileSync(path.join(d, 'couverture', 'quatrieme.md'), 'Text.\n', 'utf8');
      fs.mkdirSync(path.join(d, 'impressum'));
      for (const f of ['da.png', 'mit leer.png']) {
        fs.copyFileSync(path.join(BANC, 'impressum', 'druck-1.png'), path.join(d, 'impressum', f));
      }
      fs.writeFileSync(path.join(d, 'buch.yaml'), 'titre: "Ein Buch"\nlang: de\nmaquette: normal\n'
        + 'licence: cc-by-4.0\nliminaires: [impressum, page-titre]\nimpressum:\n'
        + '  logo-soutien: impressum/absent.png\n'
        + '  logos-imprimeur: [impressum/da.png, "impressum/mit leer.png"]\n', 'utf8');
      const nom = path.basename(d);
      const html = 'out/' + nom + '.html';
      const couv = 'out/couverture/' + nom + '-couverture.html';
      const r = make(d, [html, couv], ['-p', '-n']);
      assert.strictEqual(r.status, 0, r.stderr);
      const p = prerequis(r.stdout, html);
      assert.ok(p, html + ' absent de la base de make');
      assert.ok(p.includes('impressum/da.png'), p.join(' '));
      assert.ok(!p.some((x) => x.includes('absent')), p.join(' '));
      for (const logo of ['/media/logos/cc-by-4.0.svg', '/media/logos/edition-szh-csps.svg']) {
        assert.ok(p.some((x) => x.endsWith(logo)), logo + ' : ' + p.join(' '));
      }
      const c = prerequis(r.stdout, couv);
      assert.ok(c && c.some((x) => x.endsWith('/media/fonds/prospectrum.jpg')), String(c));
    } finally { fs.rmSync(path.dirname(d), { recursive: true, force: true }); }
  });
