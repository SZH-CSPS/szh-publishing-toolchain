// Les capacités de chaque profil (lib/profil.js) et les `when` de package.json disent la
// même chose : ce qui existe dans une revue et dans un livre se décide dans la table seule.
//
//   node --test test/js/capacites.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const profil = require(path.join(COCKPIT, 'lib', 'profil.js'));
const pkg = JSON.parse(fs.readFileSync(path.join(COCKPIT, 'package.json'), 'utf8'));

// Toutes les clauses `when` du manifeste, où qu'elles soient (menus, vues, parcours).
function clausesWhen(noeud, out) {
  if (Array.isArray(noeud)) { noeud.forEach((n) => clausesWhen(n, out)); }
  else if (noeud && typeof noeud === 'object') {
    for (const [k, v] of Object.entries(noeud)) {
      if (k === 'when' && typeof v === 'string') { out.push(v); } else { clausesWhen(v, out); }
    }
  }
  return out;
}
const WHENS = clausesWhen(pkg.contributes, []);
const CLES = Object.keys(profil.PROFILS.revue.capacites || {}).sort();

test('capacités : chaque profil porte le même jeu de capacités, toutes booléennes', () => {
  assert.ok(CLES.length > 0, 'la table des profils ne porte aucune capacité');
  for (const p of Object.values(profil.PROFILS)) {
    assert.deepStrictEqual(Object.keys(p.capacites || {}).sort(), CLES, p.cle + ' : jeu différent');
    for (const c of CLES) { assert.strictEqual(typeof p.capacites[c], 'boolean', p.cle + '.' + c); }
  }
});

test('capacités : toute clé szh.peut.* lue par un when existe dans la table', () => {
  const lues = new Set();
  for (const w of WHENS) { for (const m of w.matchAll(/szh\.peut\.(\w+)/g)) { lues.add(m[1]); } }
  assert.ok(lues.size > 0, 'aucun when ne lit szh.peut.*');
  for (const c of lues) { assert.ok(CLES.includes(c), 'szh.peut.' + c + ' lu par package.json, absent de la table'); }
});

test('capacités : contextes() pose szh.peut.<capacité> à la valeur de la table, et à faux sans profil', () => {
  for (const p of Object.values(profil.PROFILS)) {
    const ctx = profil.contextes(p.cle);
    for (const c of CLES) { assert.strictEqual(ctx['szh.peut.' + c], p.capacites[c], p.cle + ' : szh.peut.' + c); }
  }
  const aucun = profil.contextes(null);
  for (const c of CLES) { assert.strictEqual(aucun['szh.peut.' + c], false, 'sans profil : szh.peut.' + c); }
});

// Chaque capacité est lue quelque part ; une capacité inutilisée finirait par être fausse.
test('capacités : chacune est lue quelque part (when, hôte ou webview)', () => {
  const sources = [path.join(COCKPIT, 'extension.js')]
    .concat(fs.readdirSync(path.join(COCKPIT, 'lib')).filter((f) => f.endsWith('.js'))
      .map((f) => path.join(COCKPIT, 'lib', f)))
    .concat(fs.readdirSync(path.join(COCKPIT, 'media')).filter((f) => f.endsWith('.js'))
      .map((f) => path.join(COCKPIT, 'media', f)));
  const code = sources.map((f) => fs.readFileSync(f, 'utf8')).join('\n') + WHENS.join('\n');
  for (const c of CLES) {
    const lu = new RegExp('(capacites\\.|CAP\\.|szh\\.peut\\.|peut\\(\')' + c + '\\b').test(code);
    assert.ok(lu, 'capacité ' + c + ' lue nulle part');
  }
});

// Une commande réservée à un profil porte un when szh.peut.* dans la palette : c'est lui
// que les panneaux relisent pour retirer l'entrée (lib/panneaux.js).
test('capacités : les commandes réservées à un profil passent par szh.peut.*', () => {
  const palette = pkg.contributes.menus.commandPalette;
  const attendu = {
    'szh.traduction': 'traductions', 'szh.apercuMetadonnees': 'vueFiches',
    'szh.exporterXml': 'ojs', 'szh.exporterArticle': 'pdfArticle',
    'szh.reimporterArticle': 'reimport', 'szh.rafraichirPagination': 'pagination',
    'szh.envoyerAuteur': 'envoiAuteur', 'szh.livreEpub': 'sortiesLivre',
    'szh.apercuLivre': 'sortiesLivre', 'szh.fmt.qrLink': 'paletteLivre'
  };
  for (const [cmd, cap] of Object.entries(attendu)) {
    const e = palette.find((x) => x.command === cmd);
    assert.ok(e, cmd + ' absente de commandPalette');
    assert.strictEqual(e.when, 'szh.peut.' + cap, cmd + ' : when ' + e.when);
  }
});

test('capacités : courant() lit le profil posé dans la session, revue par défaut', () => {
  const session = require(path.join(COCKPIT, 'lib', 'session.js'));
  const avant = session.profilOuvrage();
  try {
    session.poserProfilOuvrage(null);
    assert.strictEqual(profil.courant().cle, 'revue');
    session.poserProfilOuvrage(profil.PROFILS.livre);
    assert.strictEqual(profil.courant().cle, 'livre');
    assert.strictEqual(profil.courant().capacites.doi, false);
  } finally { session.poserProfilOuvrage(avant); }
});
