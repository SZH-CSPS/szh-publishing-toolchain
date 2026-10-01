/**
 * Audit de conformité : la table de référence des couleurs de maison
 * (pipeline/styles/couleurs-reference.json) DOIT correspondre exactement aux
 * définitions CSS et aux CMJN du graphiste.
 *
 * C'est la seule table : cmjn.py (PDF imprimeur) et couverture.py (couverture)
 * la lisent, aucun des deux n'en garde de copie. Une couleur de charte qui change
 * se change dans le JSON, et ce test dit si le CSS a suivi.
 *
 * Table des sept couleurs officielles (graphiste) :
 *   - Rouge SZH-CSPS (#D31932) → CMJN officiel 16 90 64 0
 *   - Nuit (#252B46)            → CMJN officiel 65 45 0 60
 *   - Capucine (#EB5E51)        → CMJN officiel 0 74 64 0
 *   - Moutarde (#C7CF1C)        → CMJN officiel 30 4 95 0
 *   - Poireau (#51A66D)         → CMJN officiel 70 10 70 0
 *   - Bleu acier (#5F9FBC)      → CMJN officiel 65 25 20 0
 *   - Mountbatten (#A98899)     → CMJN officiel 40 50 30 0
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Extrait les définitions CSS depuis un fichier.
 * Retourne un objet { 'var-name': '#HEX' }.
 */
function extractCSSColors(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const colors = {};

  // Pattern : --c-<name>: #RRGGBB;
  const pattern = /--c-([\w-]+):\s*#([0-9A-Fa-f]{6});/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const varName = match[1];
    const hex = '#' + match[2].toUpperCase();
    colors[varName] = hex;
  }

  return colors;
}

/**
 * Lit la table de référence.
 * Retourne un objet { '#HEX': [C, M, J, N] }.
 */
function extractCMYKTable(filePath) {
  const ref = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const cmyk = {};
  for (const entree of Object.values(ref)) {
    cmyk[entree.rgb.toUpperCase()] = entree.cmjn.map(Number);
  }
  return cmyk;
}

const REFERENCE = path.join(__dirname, '../../pipeline/styles/couleurs-reference.json');

/**
 * Normalise un hex pour comparaison.
 */
function normalizeHex(hex) {
  return hex.toUpperCase();
}

test('Couleurs de maison : socle.css vs couleurs.css', () => {
  const toolkitPath = path.join(__dirname, '../../pipeline/styles');
  const socleColors = extractCSSColors(path.join(toolkitPath, 'socle.css'));
  const couleursColors = extractCSSColors(path.join(toolkitPath, 'couleurs.css'));

  // Sept variables de base (--c-nuit provenant de socle.css, les 6 autres de couleurs.css)
  // Les couleurs de charte sont à des crans spécifiques (700 pour rouge, 500 pour les autres)
  const expected = {
    'nuit': '#252B46',  // de socle.css
    'rouge-700': '#D31932',  // cran 700 dans couleurs.css
    'capucine-500': '#EB5E51',  // cran 500
    'moutarde-300': '#C7CF1C',  // cran 300
    'poireau-500': '#51A66D',  // cran 500
    'bleuacier-500': '#5F9FBC',  // cran 500
    'mountbatten-500': '#A98899',  // cran 500
  };

  for (const [varName, expectedHex] of Object.entries(expected)) {
    const source = varName === 'nuit' ? socleColors : couleursColors;
    const actualHex = source[varName];

    assert.ok(
      actualHex,
      `Variable --c-${varName} introuvable dans ${varName === 'nuit' ? 'socle.css' : 'couleurs.css'}`
    );

    assert.strictEqual(
      normalizeHex(actualHex),
      normalizeHex(expectedHex),
      `Couleur --c-${varName} diverge : attendu ${expectedHex}, trouvé ${actualHex}`
    );
  }
});

test('Couleurs de maison : CSS vs couleurs-reference.json', () => {
  const toolkitPath = path.join(__dirname, '../../pipeline');
  const couleursColors = extractCSSColors(path.join(toolkitPath, 'styles/couleurs.css'));
  const socleColors = extractCSSColors(path.join(toolkitPath, 'styles/socle.css'));
  const cmykTable = extractCMYKTable(REFERENCE);

  // Sept variables : l'une du socle, les six de couleurs.css
  const hexMapping = {
    '#252B46': 'Nuit',
    '#D31932': 'Rouge SZH-CSPS',
    '#EB5E51': 'Capucine',
    '#C7CF1C': 'Moutarde',
    '#51A66D': 'Poireau',
    '#5F9FBC': 'Bleu acier',
    '#A98899': 'Mountbatten',
  };

  for (const [hex, name] of Object.entries(hexMapping)) {
    const normalizedHex = normalizeHex(hex);

    assert.ok(
      cmykTable[normalizedHex],
      `Couleur ${name} (${hex}) absente de couleurs-reference.json`
    );

    // Vérifier aussi que le hex figure dans CSS
    const allColors = { ...couleursColors, ...socleColors };
    const foundInCSS = Object.values(allColors).some(v => normalizeHex(v) === normalizedHex);

    assert.ok(
      foundInCSS,
      `Couleur ${name} (${hex}) trouvée dans couleurs-reference.json mais absente de CSS`
    );
  }
});

test('Valeurs officielles CMJN (graphiste)', () => {
  const toolkitPath = path.join(__dirname, '../../pipeline');
  const cmykTable = extractCMYKTable(REFERENCE);

  // Table attendue (en format normalisé [0, 1])
  const expectedCMYK = {
    '#D31932': [0.16, 0.90, 0.64, 0.0],  // Rouge SZH-CSPS
    '#252B46': [0.65, 0.45, 0.0, 0.60],  // Nuit
    '#EB5E51': [0.0, 0.74, 0.64, 0.0],   // Capucine
    '#C7CF1C': [0.30, 0.04, 0.95, 0.0],  // Moutarde
    '#51A66D': [0.70, 0.10, 0.70, 0.0],  // Poireau
    '#5F9FBC': [0.65, 0.25, 0.20, 0.0],  // Bleu acier
    '#A98899': [0.40, 0.50, 0.30, 0.0],  // Mountbatten
  };

  // Table du graphiste et table de référence doivent porter exactement les mêmes couleurs :
  // ni une de plus (résidu), ni une de moins (couleur oubliée).
  assert.strictEqual(Object.keys(cmykTable).length, Object.keys(expectedCMYK).length,
    `Table CMJN : attendu ${Object.keys(expectedCMYK).length} couleurs, trouvé ${Object.keys(cmykTable).length}`);

  for (const [hex, expected] of Object.entries(expectedCMYK)) {
    const normalized = normalizeHex(hex);
    const actual = cmykTable[normalized];

    assert.ok(actual, `Couleur ${hex} absente de couleurs-reference.json`);
    assert.strictEqual(actual.length, 4, `CMJN de ${hex} a ${actual.length} composantes au lieu de 4`);

    // Comparaison avec tolérance (PDF arrondit)
    const tolerance = 0.001;
    for (let i = 0; i < 4; i++) {
      assert.ok(
        Math.abs(actual[i] - expected[i]) < tolerance,
        `CMJN[${i}] de ${hex} : attendu ${expected[i]}, trouvé ${actual[i]}`
      );
    }
  }
});

// Pas de seconde table : cmjn.py et couverture.py lisent le JSON, aucun n'écrit de hex
// de maison en dur (une copie divergerait à la première retouche de charte).
test('cmjn.py et couverture.py lisent la table de référence, sans copie', () => {
  const pipeline = path.join(__dirname, '../../pipeline');
  const hexMaison = Object.keys(extractCMYKTable(REFERENCE));
  for (const f of ['cmjn.py', 'couverture.py']) {
    const src = fs.readFileSync(path.join(pipeline, f), 'utf-8');
    assert.ok(src.includes('couleurs-reference.json'), `${f} ne lit pas couleurs-reference.json`);
    for (const hex of hexMaison) {
      assert.ok(!src.toUpperCase().includes(hex), `${f} écrit ${hex} en dur`);
    }
  }
});
