/**
 * Audit de conformité : les sept couleurs de maison du script cmjn.py
 * DOIVENT correspondre exactement aux définitions CSS et socle.
 *
 * Toute divergence est un défaut : une mise à jour d'une couleur
 * charte doit être doublée dans pipeline/cmjn.py avant la compilation,
 * sinon l'imprimerie recevra les mauvaises teintes.
 *
 * Table des sept couleurs officielles (graphiste) :
 *   - Rouge SZH-CSPS (#D31932) → CMJN officiel 16 90 64 0
 *   - Nuit (#252B46)            → CMJN officiel 65 45 0 60
 *   - Capucine (#EB5E51)        → CMJN officiel 0 74 64 0
 *   - Moutarde (#C7CF1C)        → CMJN officiel 30 4 95 0
 *   - Poireau (#51A66D)         → CMJN officiel 70 10 70 0
 *   - Bleu acier (#5F9FBC)      → CMJN officiel 65 25 20 0
 *   - Mountbatten (#A98899)     → CMJN officiel 40 50 30 0
 *
 * Les trois sources doivent coïncider :
 * 1. pipeline/styles/socle.css (--c-nuit)
 * 2. pipeline/styles/couleurs.css (-marque alias)
 * 3. pipeline/cmjn.py (table house_colors)
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
 * Extrait les définitions CMJN depuis pipeline/cmjn.py.
 * Retourne un objet { '#HEX': [C, M, J, N] }.
 */
function extractCMYKTable(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const cmyk = {};

  // Pattern dans la table house_colors
  // hex_to_rgb('#D31932'): (0.16, 0.90, 0.64, 0.0),  # Rouge SZH-CSPS
  const pattern = /hex_to_rgb\('(#[0-9A-Fa-f]{6})'\):\s*\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/gi;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const hex = match[1].toUpperCase();
    const c = parseFloat(match[2]);
    const m = parseFloat(match[3]);
    const y = parseFloat(match[4]);
    const k = parseFloat(match[5]);
    cmyk[hex] = [c, m, y, k];
  }

  return cmyk;
}

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

test('Couleurs de maison : CSS vs cmjn.py', () => {
  const toolkitPath = path.join(__dirname, '../../pipeline');
  const couleursColors = extractCSSColors(path.join(toolkitPath, 'styles/couleurs.css'));
  const socleColors = extractCSSColors(path.join(toolkitPath, 'styles/socle.css'));
  const cmykTable = extractCMYKTable(path.join(toolkitPath, 'cmjn.py'));

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
      `Couleur ${name} (${hex}) absente de la table CMJN dans cmjn.py`
    );

    // Vérifier aussi que le hex figure dans CSS
    const allColors = { ...couleursColors, ...socleColors };
    const foundInCSS = Object.values(allColors).some(v => normalizeHex(v) === normalizedHex);

    assert.ok(
      foundInCSS,
      `Couleur ${name} (${hex}) trouvée dans cmjn.py mais absente de CSS`
    );
  }
});

test('Cohérence intra-cmjn.py : sept couleurs et sept CMJN', () => {
  const toolkitPath = path.join(__dirname, '../../pipeline');
  const cmykTable = extractCMYKTable(path.join(toolkitPath, 'cmjn.py'));

  // Doit avoir exactement sept entrées
  const hexList = Object.keys(cmykTable);
  assert.strictEqual(
    hexList.length,
    7,
    `Table CMJN : attendu 7 couleurs, trouvé ${hexList.length}`
  );

  // Vérifier que chaque entrée a les 4 composantes
  for (const [hex, cmyk] of Object.entries(cmykTable)) {
    assert.strictEqual(
      Array.isArray(cmyk),
      true,
      `CMJN de ${hex} n'est pas un tableau`
    );
    assert.strictEqual(
      cmyk.length,
      4,
      `CMJN de ${hex} a ${cmyk.length} composantes au lieu de 4`
    );

    // Chaque composante doit être en [0, 1]
    for (let i = 0; i < 4; i++) {
      assert.ok(
        cmyk[i] >= 0 && cmyk[i] <= 1,
        `CMJN[${i}] de ${hex} = ${cmyk[i]}, hors [0, 1]`
      );
    }
  }
});

test('Valeurs officielles CMJN (graphiste)', () => {
  const toolkitPath = path.join(__dirname, '../../pipeline');
  const cmykTable = extractCMYKTable(path.join(toolkitPath, 'cmjn.py'));

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

  for (const [hex, expected] of Object.entries(expectedCMYK)) {
    const normalized = normalizeHex(hex);
    const actual = cmykTable[normalized];

    assert.ok(actual, `Couleur ${hex} absente de cmjn.py`);

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
