// Les chaînes de filtres Lua sont déclarées une fois, dans pipeline/filtres.mk : la base
// commune, puis la chaîne d'un article, de son aperçu, d'un chapitre et de ses variantes.
// Ce fichier vérifie que la base garde le même ordre relatif partout, que chaque filtre n'y
// passe qu'une fois (sauf livre-sous-titre, deux fois exprès), et que le lecteur statique de
// test/js/chaines-filtres-lire.js lit comme make.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');
const { lireChaines, FICHIER } = require('./chaines-filtres-lire');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const ch = lireChaines();

// Ce que chaque chaîne retire de la base commune, et rien d'autre.
const RETRAITS = {
  CHAINE_ARTICLE: [],
  CHAINE_APERCU: ['exergue'],
  CHAINE_CHAPITRE: [],
  CHAINE_CHAPITRE_APERCU: ['exergue'],
  CHAINE_CHAPITRE_EPUB: ['notes']
};

test('le socle est déclaré, sans doublon, et chacun de ses filtres existe', () => {
  assert.ok(ch.CHAINE_SOCLE && ch.CHAINE_SOCLE.length > 10, 'CHAINE_SOCLE introuvable dans filtres.mk');
  assert.strictEqual(new Set(ch.CHAINE_SOCLE).size, ch.CHAINE_SOCLE.length, 'un filtre figure deux fois dans le socle');
  for (const nom of Object.keys(RETRAITS)) {
    for (const f of ch[nom]) {
      assert.ok(fs.existsSync(path.join(RACINE, 'pipeline', 'filters', 'szh-' + f + '.lua')),
        nom + ' : szh-' + f + '.lua n’existe pas');
    }
  }
});

for (const [nom, retires] of Object.entries(RETRAITS)) {
  test(nom + ' : le socle y passe dans son ordre, une fois chacun', () => {
    const chaine = ch[nom];
    assert.ok(chaine, nom + ' introuvable dans filtres.mk');
    const vus = chaine.filter((f) => ch.CHAINE_SOCLE.includes(f));
    const attendus = ch.CHAINE_SOCLE.filter((f) => !retires.includes(f));
    assert.deepStrictEqual(vus, attendus,
      nom + ' : l’ordre relatif du socle diverge, ou un filtre du socle y manque ou y est doublé');
  });
}

test('chapitre : livre-sous-titre deux fois, avant la typographie et après livre-entete', () => {
  for (const nom of ['CHAINE_CHAPITRE', 'CHAINE_CHAPITRE_APERCU', 'CHAINE_CHAPITRE_EPUB']) {
    const c = ch[nom];
    const rangs = c.map((f, i) => (f === 'livre-sous-titre' ? i : -1)).filter((i) => i !== -1);
    assert.strictEqual(rangs.length, 2, nom + ' : livre-sous-titre doit être appelé deux fois');
    assert.ok(rangs[0] < c.indexOf('typographie'),
      nom + ' : le premier appel ne précède plus la typographie maison');
    assert.ok(rangs[1] > c.indexOf('livre-entete'),
      nom + ' : le second appel ne suit plus livre-entete, le sous-titre ne se pose plus sous le titre');
  }
});

test('contexte en tête de chaque chaîne ; article : maquette ensuite, notes à la fin ; chapitre : livre-titre ensuite, qr à la fin', () => {
  for (const nom of Object.keys(RETRAITS)) {
    assert.strictEqual(ch[nom][0], 'contexte',
      nom + ' : szh-contexte n’ouvre plus la chaîne, la langue n’y est plus posée avant les autres filtres');
  }
  assert.strictEqual(ch.CHAINE_ARTICLE[1], 'maquette');
  assert.strictEqual(ch.CHAINE_ARTICLE[ch.CHAINE_ARTICLE.length - 1], 'notes');
  assert.ok(!ch.CHAINE_APERCU.includes('maquette'), 'l’aperçu compose une couverture');
  assert.strictEqual(ch.CHAINE_CHAPITRE[1], 'livre-titre');
  assert.strictEqual(ch.CHAINE_CHAPITRE[ch.CHAINE_CHAPITRE.length - 1], 'qr');
});

// make, lancé sur filtres.mk seul, imprime chaque variable FILTRES_* : la liste doit être
// celle que rend le lecteur statique.
test('le lecteur statique de filtres.mk rend exactement ce que make développe', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
  const m = String(FICHIER).match(/^([A-Za-z]):[\\/](.*)$/);
  const mk = m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/') : FICHIER;
  const paires = {
    FILTRES_SOCLE: 'CHAINE_SOCLE', FILTRES_ARTICLE: 'CHAINE_ARTICLE',
    FILTRES_APERCU: 'CHAINE_APERCU', FILTRES_CHAPITRE: 'CHAINE_CHAPITRE',
    FILTRES_CHAPITRE_APERCU: 'CHAINE_CHAPITRE_APERCU', FILTRES_CHAPITRE_EPUB: 'CHAINE_CHAPITRE_EPUB'
  };
  // Le script passe par l'entrée standard : wsl.exe confie sa ligne de commande à un shell,
  // qui prendrait les $(…) de make pour des substitutions.
  const recette = Object.keys(paires).map((v) => "\t@echo '" + v + "=$(" + v + ")'").join('\n');
  const script = "cat > /tmp/szh-chaines.mk <<'FIN'\ninclude " + mk + '\nmontrer:\n' + recette
    + '\nFIN\nmake -s -f /tmp/szh-chaines.mk PIPELINE_DIR=/P montrer; c=$?; rm -f /tmp/szh-chaines.mk; exit $c\n';
  const r = spawnSync(cheminWsl(), ['-d', DISTRO, '--', 'bash', '-s'],
    { input: script, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.ok(!r.error, 'wsl.exe : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'make : ' + r.stderr);
  const lignes = String(r.stdout).replace(/\r/g, '').split('\n').filter(Boolean);
  assert.strictEqual(lignes.length, Object.keys(paires).length, r.stdout);
  for (const ligne of lignes) {
    const [variable, valeur] = [ligne.slice(0, ligne.indexOf('=')), ligne.slice(ligne.indexOf('=') + 1)];
    const attendu = ch[paires[variable]].map((f) => '--lua-filter="/P/filters/szh-' + f + '.lua"');
    assert.deepStrictEqual(valeur.trim().split(/\s+/), attendu, variable + ' : make et le lecteur divergent');
  }
});
