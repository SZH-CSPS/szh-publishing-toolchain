// Listes numérotées de la revue rendues par WeasyPrint (WSL), avec la pile de la revue
// (socle, print, partage-filtres) : le numéro d'un item à deux chiffres commence sur la
// marge comme celui d'un item à un chiffre, et le texte reste à 1,7 em, que la liste
// commence à 1 ou reprenne plus loin.
//
//   node --test test/js/listes-rang-rendu.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { sansPandocWsl, sauter, cheminVersWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const STYLES = path.join(RACINE, 'pipeline', 'styles');
const PILE = ['socle.css', 'print.css', 'partage-filtres.css'].map((f) => path.join(STYLES, f));

// x (mm) du début de chaque ligne de texte, par cas : [x, texte].
const MESURER = String.raw`
import io, json, sys
import pypdf, weasyprint
PT_MM = 25.4 / 72
res = {}
for cas in json.load(open(sys.argv[1], encoding='utf-8')):
    tampon = io.BytesIO()
    weasyprint.HTML(string=cas['html'], base_url=cas['base']).write_pdf(tampon)
    vus = []
    def v(t, cm, tm, police, corps):
        if t.strip():
            vus.append([round((cm[0] * tm[4] + cm[2] * tm[5] + cm[4]) * PT_MM, 2), t.strip()])
    for p in pypdf.PdfReader(io.BytesIO(tampon.getvalue())).pages:
        p.extract_text(visitor_text=v)
    res[cas['nom']] = vus
print(json.dumps(res))
`;

const MOTS = ['Eins', 'Zwei', 'Drei', 'Vier', 'Fünf', 'Sechs', 'Sieben', 'Acht', 'Neun', 'Zehn',
  'Elf', 'Zwölf', 'Dreizehn'];

function page(corps) {
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Listen</title>'
    + PILE.map((f) => '<link rel="stylesheet" href="' + cheminVersWsl(f) + '">').join('')
    + '</head><body>' + corps + '</body></html>';
}

// Une liste Markdown qui commence à `debut`, passée par szh-listes-serrees.lua (pandoc du poste).
function liste(debut, n, dansCitation) {
  const md = MOTS.slice(debut - 1, debut - 1 + n).map((m, i) => (dansCitation ? '> ' : '') + (debut + i) + '. ' + m).join('\n') + '\n';
  const r = cp.spawnSync('pandoc', ['--from=markdown', '--to=html5',
    '--lua-filter=' + path.join(RACINE, 'pipeline', 'filters', 'szh-listes-serrees.lua')], { input: md, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'pandoc : ' + (r.error ? r.error.message : r.stderr));
  return r.stdout;
}

let _mesures = null;
function mesures() {
  if (_mesures) { return _mesures; }
  const base = cheminVersWsl(RACINE) + '/';
  const cas = [
    { nom: 'de-1', base, html: page(liste(1, 12)) },
    { nom: 'de-7', base, html: page(liste(7, 6)) },
    { nom: 'de-7-citation', base, html: page(liste(7, 6, true)) },
    { nom: 'de-1-citation', base, html: page(liste(1, 12, true)) },
  ];
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-listes-rang-'));
  try {
    const entree = path.join(d, 'cas.json');
    const script = path.join(d, 'mesurer.py');
    fs.writeFileSync(entree, JSON.stringify(cas), 'utf8');
    fs.writeFileSync(script, MESURER, 'utf8');
    const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    const r = cp.spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe',
      ['-d', 'SZH-Publishing', '--', '/opt/weasyprint/bin/python', cheminVersWsl(script), cheminVersWsl(entree)],
      { encoding: 'utf8', windowsHide: true, timeout: 280000, maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(r.status, 0, 'rendu WeasyPrint en échec : ' + r.stderr);
    _mesures = JSON.parse(r.stdout);
    return _mesures;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

function x(nom, mot) {
  const v = mesures()[nom].find((e) => e[1] === mot);
  assert.ok(v, nom + ' : « ' + mot + ' » introuvable dans ' + JSON.stringify(mesures()[nom]));
  return v[0];
}

for (const cas of ['de-1', 'de-7', 'de-1-citation', 'de-7-citation']) {
  test('listes de la revue (' + cas + ') : « 10. » commence sur la marge comme « 9. », texte aligné', (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
    assert.ok(Math.abs(x(cas, '9.') - x(cas, '10.')) <= 0.05,
      cas + ' : « 9. » à ' + x(cas, '9.') + ' mm, « 10. » à ' + x(cas, '10.') + ' mm');
    assert.ok(Math.abs(x(cas, 'Neun') - x(cas, 'Zehn')) <= 0.05, cas + ' : texte de 9 et de 10');
  });
}

test('listes de la revue : une liste qui reprend à 7 aligne son texte sur celle qui part de 1', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  for (const mot of ['Sieben', 'Zehn', 'Zwölf']) {
    assert.ok(Math.abs(x('de-7', mot) - x('de-1', mot)) <= 0.05, mot + ' : ' + x('de-7', mot) + ' contre ' + x('de-1', mot));
  }
});
