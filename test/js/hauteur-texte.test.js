// Un textarea à la hauteur de son texte : SZH.ajusterHauteur et SZH.suivreHauteur
// (media/_commun.js), seul moteur pour la Documentation et le détail d'une proposition.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RACINE = path.resolve(__dirname, '..', '..');
const MEDIA = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'media');

// Le socle tel quel, avec un ResizeObserver qu'on déclenche à la main.
function socle() {
  const observes = [];
  const ctx = {
    window: { addEventListener() {} },
    document: { addEventListener() {} },
    ResizeObserver: function (fn) { this.observe = (el) => { observes.push({ el: el, fn: fn }); }; }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(MEDIA, '_commun.js'), 'utf8'), ctx, { filename: '_commun.js' });
  const SZH = vm.runInContext('SZH', ctx);
  const redimensionner = (largeur) => {
    for (const o of observes) { o.fn([{ target: o.el, contentRect: { width: largeur, height: 0 } }]); }
  };
  return { SZH: SZH, redimensionner: redimensionner };
}

// Une zone dont on règle la visibilité et la hauteur de texte.
function zone(o) {
  const z = {
    visible: o.visible !== false, texte: o.texte || 0,
    dataset: {}, style: {}, parentElement: o.parent || null, ecouteurs: {},
    get scrollHeight() { return this.visible ? this.texte : 0; },
    getClientRects() { return this.visible ? [{}] : []; },
    addEventListener(type, fn) { (this.ecouteurs[type] = this.ecouteurs[type] || []).push(fn); },
    saisir() { (this.ecouteurs.input || []).forEach((fn) => fn({ type: 'input' })); }
  };
  return z;
}

test('la zone prend la hauteur de son texte, jusqu’au plafond', () => {
  const { SZH } = socle();
  const z = zone({ texte: 300 });
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '300px');
  assert.strictEqual(z.style.overflowY, 'hidden');
  z.texte = 900;
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '600px');
  assert.strictEqual(z.style.overflowY, 'auto', 'au-delà du plafond, la zone défile elle-même');
  const d = zone({ texte: 900 });
  SZH.ajusterHauteur(d);
  assert.strictEqual(d.style.height, '480px', 'sans plafond, celui de la Documentation');
});

test('une hauteur tirée à la main l’emporte sur la mesure', () => {
  const { SZH } = socle();
  const z = zone({ texte: 200 });
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '200px');
  z.style.height = '523px';            // le coin tiré
  z.texte = 100;
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '523px');
  assert.strictEqual(z.dataset.hauteurTiree, '1');
  assert.strictEqual(z.style.overflowY, 'auto');
  z.texte = 900;
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '523px', 'la saisie suivante ne la reprend pas');
});

test('une zone cachée n’est pas mesurée, et ne passe pas pour tirée quand elle revient', () => {
  const { SZH } = socle();
  const z = zone({ texte: 300 });
  SZH.ajusterHauteur(z, 600);
  z.visible = false;
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '300px', 'cachée, sa hauteur reste celle posée');
  z.visible = true;
  z.texte = 400;
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '400px');
  assert.strictEqual(z.dataset.hauteurTiree, undefined);
});

test('suivreHauteur mesure à la saisie et quand la zone prend une largeur', () => {
  const { SZH, redimensionner } = socle();
  const z = zone({ texte: 250, visible: false });
  let plafond = 600;
  SZH.suivreHauteur(z, () => plafond);
  assert.strictEqual(z.style.height, undefined, 'détachée ou cachée : rien n’est posé');
  z.visible = true;
  redimensionner(500);
  assert.strictEqual(z.style.height, '250px', 'visible, elle est mesurée');
  z.texte = 800;
  plafond = 700;
  z.saisir();
  assert.strictEqual(z.style.height, '700px', 'le plafond se relit à chaque mesure');
});

test('la mesure rend aux ascenseurs du dessus leur position', () => {
  const { SZH } = socle();
  const colonne = { scrollTop: 120, parentElement: null };
  const z = zone({ texte: 300, parent: colonne });
  // Replier la zone ramène l'ascenseur en haut, comme le ferait le navigateur.
  let hauteur;
  Object.defineProperty(z.style, 'height', {
    get() { return hauteur; },
    set(v) { hauteur = v; if (v === 'auto') { colonne.scrollTop = 0; } }
  });
  SZH.ajusterHauteur(z, 600);
  assert.strictEqual(z.style.height, '300px');
  assert.strictEqual(colonne.scrollTop, 120);
});

test('un seul moteur : aucune autre définition d’ajusterHauteur dans le cockpit', () => {
  const cockpit = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
  const trouves = [];
  const parcourir = (dossier) => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (e.name === 'node_modules') { continue; }
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) { parcourir(p); continue; }
      if (!e.name.endsWith('.js')) { continue; }
      const src = fs.readFileSync(p, 'utf8');
      const n = (src.match(/function\s+ajusterHauteur\b|ajusterHauteur\s*=\s*function|\bHAUTEUR_MAX\s*=/g) || []).length;
      if (n > 0) { trouves.push(path.relative(cockpit, p) + ' ×' + n); }
    }
  };
  parcourir(cockpit);
  assert.deepStrictEqual(trouves, [path.join('media', '_commun.js') + ' ×2']);
  // Les deux pages s'en servent par le socle.
  assert.match(fs.readFileSync(path.join(MEDIA, '_fiche-doc.js'), 'utf8'), /SZH\.suivreHauteur\(/);
  assert.match(fs.readFileSync(path.join(MEDIA, 'documentation.js'), 'utf8'), /SZH\.suivreHauteur\(/);
});
