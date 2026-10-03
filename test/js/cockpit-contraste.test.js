// Contraste des jetons d'encre du cockpit (media/_design.css), mesuré par pipeline/apca.py
// avec les couleurs réelles des thèmes de l'éditeur.
//
// Light+ ne définit ni foreground ni descriptionForeground : ce sont les défauts du registre
// de VS Code, #616161 et ce même gris à 70 % d'opacité. Sur blanc, l'encre principale y vaut
// Lc 81 : c'est le plafond du thème. Le seuil APCA des petites tailles (90, seuil_pour) est
// donc hors d'atteinte pour tout jeton tiré du thème ; le plancher retenu pour l'encre
// secondaire, qui porte des libellés, des valeurs lues et des comptes, est Lc 75.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pythonSortie, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MEDIA = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'media');
const DESIGN = fs.readFileSync(path.join(MEDIA, '_design.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const LC_ENCRE_2 = 75;

// Les couleurs que l'éditeur pose dans la webview, thème par thème.
const THEMES = {
  'Light+': { foreground: 'rgba(97, 97, 97, 1)', descriptionForeground: 'rgba(97, 97, 97, 0.7)',
    'editor-background': '#ffffff', 'editorWidget-background': '#f3f3f3' },
  'Dark+': { foreground: '#cccccc', descriptionForeground: 'rgba(204, 204, 204, 0.7)',
    'editor-background': '#1e1e1e', 'editorWidget-background': '#252526' },
  'Dark Modern': { foreground: '#cccccc', descriptionForeground: '#9d9d9d',
    'editor-background': '#1f1f1f', 'editorWidget-background': '#202020' }
};

// Les jetons du :root, hors du repli @supports (qui ne vaut que sans color-mix).
const JETONS = (() => {
  const sansRepli = DESIGN.replace(/@supports[^{]*\{[^{}]*\{[^{}]*\}\s*\}/g, '');
  const jetons = {};
  for (const m of sansRepli.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    assert.ok(!(m[1] in jetons) || jetons[m[1]] === m[2].trim(), 'jeton déclaré deux fois : ' + m[1]);
    jetons[m[1]] = m[2].trim();
  }
  return jetons;
})();

// Découpe « a, b(c, d), e » aux virgules de premier niveau.
function argumentsDe(s) {
  const sortie = []; let prof = 0; let debut = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') { prof++; } else if (s[i] === ')') { prof--; } else if (s[i] === ',' && prof === 0) {
      sortie.push(s.slice(debut, i).trim()); debut = i + 1;
    }
  }
  sortie.push(s.slice(debut).trim());
  return sortie;
}

// Valeur CSS -> { r, g, b, a } : hex, rgb(a), var() et color-mix(in srgb, …), les seules
// formes que les jetons d'encre emploient. Toute autre forme échoue franchement.
function couleur(valeur, theme) {
  const v = valeur.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) { return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4), 16), a: 1 }; }
  m = /^rgba?\((.*)\)$/.exec(v);
  if (m) { const p = argumentsDe(m[1]).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
  m = /^var\((.*)\)$/.exec(v);
  if (m) {
    const [nom, repli] = argumentsDe(m[1]);
    if (nom.startsWith('--vscode-')) {
      const c = THEMES[theme][nom.slice('--vscode-'.length)];
      return couleur(c !== undefined ? c : repli, theme);
    }
    assert.ok(nom in JETONS, 'jeton inconnu : ' + nom);
    return couleur(JETONS[nom], theme);
  }
  m = /^color-mix\(\s*in srgb\s*,(.*)\)$/.exec(v);
  if (m) {
    const [a, b] = argumentsDe(m[1]);
    const pa = /^(.*)\s+([\d.]+)%$/.exec(a);
    assert.ok(pa && !/%$/.test(b), 'color-mix attendu sous la forme « A p%, B » : ' + v);
    const p = Number(pa[2]) / 100;
    const c1 = couleur(pa[1], theme); const c2 = couleur(b, theme);
    // Mélange de CSS Color 5 : prémultiplié par l'alpha.
    const alpha = c1.a * p + c2.a * (1 - p);
    const canal = (k) => (c1[k] * c1.a * p + c2[k] * c2.a * (1 - p)) / alpha;
    return { r: canal('r'), g: canal('g'), b: canal('b'), a: alpha };
  }
  throw new Error('forme de couleur non prise en charge : ' + v);
}

// La couleur d'un jeton telle qu'elle s'affiche sur un fond opaque, en hex.
function surFond(jeton, fond, theme) {
  const c = couleur('var(' + jeton + ')', theme);
  const f = couleur('var(--vscode-' + fond + ')', theme);
  const octet = (k) => Math.round(c[k] * c.a + f[k] * (1 - c.a)).toString(16).padStart(2, '0');
  const hexFond = '#' + ['r', 'g', 'b'].map((k) => Math.round(f[k]).toString(16).padStart(2, '0')).join('');
  return { texte: '#' + octet('r') + octet('g') + octet('b'), fond: hexFond };
}

// Toutes les paires mesurées en un seul appel à Python.
const MESURE = 'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport apca\n'
  + 'paires = json.load(sys.stdin)\n'
  + 'print(json.dumps([[apca.lc(t, f), apca.tient(apca.lc(t, f), s)] for t, f, s in paires]))\n';
function mesurer(paires) {
  const sortie = pythonSortie(['-c', MESURE, path.join(RACINE, 'pipeline')],
    { input: JSON.stringify(paires.map((p) => [p.texte, p.fond, p.seuil])) });
  return JSON.parse(sortie);
}

test('encre secondaire : Lc 75 au moins sur le fond de page en Light+, et distincte de l’encre', { skip: sansPython }, () => {
  const e2 = surFond('--encre-2', 'editor-background', 'Light+');
  const e1 = surFond('--encre', 'editor-background', 'Light+');
  const [[lc2, tient], [lc1]] = mesurer([Object.assign({ seuil: LC_ENCRE_2 }, e2), Object.assign({ seuil: LC_ENCRE_2 }, e1)]);
  assert.ok(tient, '--encre-2 vaut ' + e2.texte + ' sur ' + e2.fond + ', soit Lc ' + lc2.toFixed(1)
    + ' : sous le plancher de ' + LC_ENCRE_2 + ' pour un texte qui porte du sens');
  assert.ok(lc2 < lc1, '--encre-2 (' + e2.texte + ') ne se distingue plus de --encre (' + e1.texte + ')');
});

test('encre secondaire : contraste non textuel tenu dans les trois thèmes, page et surface', { skip: sansPython }, () => {
  const paires = [];
  for (const theme of Object.keys(THEMES)) {
    for (const fond of ['editor-background', 'editorWidget-background']) {
      paires.push(Object.assign({ seuil: 30, nom: theme + ' / ' + fond }, surFond('--encre-2', fond, theme)));
    }
  }
  mesurer(paires).forEach(([lc, tient], i) => {
    assert.ok(tient, paires[i].nom + ' : ' + paires[i].texte + ' sur ' + paires[i].fond + ', Lc ' + lc.toFixed(1));
  });
});

test('le gris secondaire de l’éditeur ne se lit qu’à travers --encre-2', () => {
  // Une feuille, ou un style posé par un script, qui lit --vscode-descriptionForeground
  // directement échappe au jeton, et à la mesure ci-dessus.
  const directs = fs.readdirSync(MEDIA).filter((f) => /\.(css|js)$/.test(f) && f !== '_design.css')
    .filter((f) => /--vscode-descriptionForeground/.test(fs.readFileSync(path.join(MEDIA, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.deepStrictEqual(directs, [], 'feuilles qui contournent --encre-2 : ' + directs.join(', '));
});
