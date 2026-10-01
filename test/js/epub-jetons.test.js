// Les jetons CSS de l'EPUB du livre : chaque var(--x) des feuilles embarquées a sa définition,
// dans une feuille de l'archive ou dans un attribut style= de ses XHTML.
//
//   node --test test/js/epub-jetons.test.js
//
// epub.css consomme les jetons du socle (--c-ink, --font-sans…) et l'accent annuel ; si
// l'archive n'embarque pas leurs feuilles, une liseuse les ignore sans un mot. L'EPUB est
// compilé par la vraie recette `livre-epub`, dans une copie jetable du livre du banc.
// --qr-taille est exclue : posée par élément (style= du QR), toujours avec repli.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { python, sauter, sansPandocWsl, cheminPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const DISTRO = 'SZH-Publishing';

function wsl(args) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return cp.spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe', ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 900000 });
}

// Rend en JSON les jetons utilisés et définis par les feuilles et les XHTML de l'archive.
const LIRE_EPUB = [
  'import json, re, sys, zipfile',
  'z = zipfile.ZipFile(sys.argv[1])',
  'lire = lambda suffixe: [z.read(n).decode("utf-8") for n in z.namelist() if n.endswith(suffixe)]',
  'css = "\\n".join(lire(".css"))',
  'styles = "\\n".join(s for x in lire(".xhtml") for s in re.findall(r\'style="([^"]*)"\', x))',
  'definis = set(re.findall(r"(--[\\w-]+)\\s*:", css + "\\n" + styles))',
  'utilises = set(re.findall(r"var\\(\\s*(--[\\w-]+)", css)) - {"--qr-taille"}',
  'ressources = [u for u in re.findall(r"url\\(\\s*[\'\\"]?([^)\'\\"]+)", css) if not u.startswith("data:")]',
  'print(json.dumps({"indefinis": sorted(utilises - definis), "ressources": ressources,',
  '                  "utilises": sorted(utilises)}))'
].join('\n');

function versWsl(p) {
  return cheminPython(path.resolve(p));
}

test('chaque var(--x) de l\'EPUB du livre a sa définition', { skip: sansPandocWsl || false }, (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-epub-jetons-'));
  try {
    const livre = path.join(base, 'livre');
    fs.cpSync(path.join(RACINE, 'test', 'livre-normal'), livre, { recursive: true,
      filter: (src) => path.basename(src) !== 'out' });
    const mk = versWsl(path.join(RACINE, 'pipeline', 'Makefile'));
    const rMake = wsl(['bash', '-c', 'cd "' + versWsl(livre) + '" && make -f "' + mk + '" livre-epub']);
    assert.ok(!rMake.error, 'WSL injoignable : ' + (rMake.error && rMake.error.message));
    assert.strictEqual(rMake.status, 0, 'la compilation a échoué : ' + rMake.stdout + rMake.stderr);
    const epub = path.join(livre, 'out', 'livre.epub');
    assert.ok(fs.existsSync(epub), 'EPUB absent : ' + epub);

    const script = path.join(base, 'lire-epub.py');
    fs.writeFileSync(script, LIRE_EPUB + '\n', 'utf8');
    const r = python([script, epub], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'lecture de l\'EPUB échouée : ' + r.stderr);
    const lu = JSON.parse(r.stdout.trim());
    assert.ok(lu.utilises.length > 0, 'aucun var(--x) lu : la sonde ne voit rien');
    assert.deepStrictEqual(lu.ressources, [],
      'url() des feuilles de l\'EPUB absentes de l\'archive : ' + lu.ressources.join(', '));
    assert.deepStrictEqual(lu.indefinis, [],
      'jetons utilisés sans définition dans l\'EPUB : ' + lu.indefinis.join(', '));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
