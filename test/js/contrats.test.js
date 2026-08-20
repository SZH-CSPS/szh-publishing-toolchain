// Contrôles des contrats du cockpit, sans dépendance ni build.
//
//   node --test test/js
//
// Ne couvre que les modules chargeables hors de l'éditeur (ceux qui ne font pas
// require('vscode')). Deux familles :
//   - aller-retour : analyser puis sérialiser doit rendre la source intacte ;
//   - cohérence : les valeurs recopiées d'un fichier à l'autre doivent concorder.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const table = require(path.join(COCKPIT, 'lib', 'table-model.js'));
const slug = require(path.join(COCKPIT, 'lib', 'slug.js'));
const refs = require(path.join(COCKPIT, 'lib', 'references.js'));
const wsl = require(path.join(COCKPIT, 'lib', 'wsl.js'));

const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// Un JSON avec commentaires (tasks.json, keybindings.json…).
function jsonc(src) {
  return JSON.parse(src.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (m) => (m[0] === '"' ? m : '')).replace(/,(\s*[}\]])/g, '$1'));
}

// ---- ausgabe.yaml -----------------------------------------------------------

test('ausgabe.yaml : les commentaires et les clés inconnues survivent', () => {
  const src = '# en-tête\ntitle: "Dossier"\nprofil: article\ninconnue: 3\n';
  const sortie = yaml.serialiserAusgabe(src, { title: 'Autre' });
  assert.match(sortie, /^# en-tête$/m);
  assert.match(sortie, /^profil: article$/m);
  assert.match(sortie, /^inconnue: 3$/m);
  assert.match(sortie, /^title: "Autre"$/m);
});

test('ausgabe.yaml : le BOM et les fins de ligne Windows sont préservés', () => {
  const src = '﻿title: "A"\r\nlang: fr\r\n';
  const sortie = yaml.serialiserAusgabe(src, { title: 'B' });
  assert.ok(sortie.startsWith('﻿'), 'BOM perdu');
  assert.ok(sortie.includes('\r\n'), 'CRLF perdu');
});

test('ausgabe.yaml : une valeur relue est la valeur écrite', () => {
  const src = 'title: "A"\n';
  for (const valeur of ['Sans guillemet', 'Avec "guillemets"', 'Deux : points', '#croisillon']) {
    const relu = yaml.analyserAusgabe(yaml.serialiserAusgabe(src, { title: valeur }));
    assert.strictEqual(relu.title, valeur, 'aller-retour cassé sur : ' + valeur);
  }
});

// ---- Tableaux ---------------------------------------------------------------

test('tableau : analyser puis sérialiser puis analyser donne le même modèle', () => {
  const html = lire('test', 'articles', 'contenu-long', 'tables', 'table-01.html');
  const un = table.analyserTable(html);
  const deux = table.analyserTable(table.serialiserTable(un));
  assert.deepStrictEqual(deux, un);
});

test('tableau : le texte à caractères réservés fait l’aller-retour', () => {
  const modele = table.analyserTable(
    '<table class="szh-tableau"><tbody><tr><td>a &amp; b &lt;c&gt; "d"</td></tr></tbody></table>');
  const relu = table.analyserTable(table.serialiserTable(modele));
  assert.deepStrictEqual(relu, modele);
});

// ---- Slug : le miroir du Makefile -------------------------------------------

test('slug d’article : mêmes règles que le Makefile', () => {
  assert.strictEqual(slug.slugifierArticle('4_Titre'), '04-titre');
  assert.strictEqual(slug.slugifierArticle('10_Actualité et ressources'),
    '10-actualite-et-ressources');
  assert.ok(slug.slugifierArticle('9' + '_' + 'x'.repeat(80)).length <= 39,
    'la borne de 39 caractères du Makefile n’est pas tenue');
});

// ---- Attributs d’image ------------------------------------------------------

test('attributs d’image : écrire puis relire rend les mêmes valeurs', () => {
  const md = '![Une légende](media/x.png)\n';
  const ecrit = refs.ecrireAttributsImage(md, 'x.png',
    { legende: 'Une légende', alt: 'Description', altDefini: true,
      copyright: 'SZH', source: 'Rapport 2026' });
  assert.strictEqual(ecrit.n, 1, 'aucune insertion trouvée');
  const relu = refs.lireAttributsImage(ecrit.texte, 'x.png');
  assert.strictEqual(relu.alt, 'Description');
  assert.strictEqual(relu.copyright, 'SZH');
  assert.strictEqual(relu.source, 'Rapport 2026');
  assert.strictEqual(relu.legende, 'Une légende');
});

test('attributs d’image : alt vide reste un choix explicite (image décorative)', () => {
  const ecrit = refs.ecrireAttributsImage('![](media/x.png)\n', 'x.png',
    { alt: '', altDefini: true });
  assert.match(ecrit.texte, /alt=""/);
  assert.strictEqual(refs.lireAttributsImage(ecrit.texte, 'x.png').altDefini, true);
});

// ---- Cohérence entre fichiers -----------------------------------------------

test('la distro WSL est la même dans le code et dans tasks.json', () => {
  const taches = jsonc(lire('vscodium-user', 'tasks.json')).tasks;
  for (const t of taches) {
    const i = t.args.indexOf('-d');
    assert.notStrictEqual(i, -1, 'tâche sans -d : ' + t.label);
    assert.strictEqual(t.args[i + 1], wsl.DISTRO,
      'tâche « ' + t.label + ' » : distro différente de lib/wsl.js');
  }
});

test('les libellés de tâches attendus par le code existent dans tasks.json', () => {
  const labels = jsonc(lire('vscodium-user', 'tasks.json')).tasks.map((t) => t.label);
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  for (const m of src.matchAll(/^const NOM_TACHE_\w+ = '([^']+)';$/gm)) {
    assert.ok(labels.includes(m[1]), 'aucune tâche nommée « ' + m[1] + ' » dans tasks.json');
  }
});

test('chaque commande déclarée dans package.json est enregistrée dans le code', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const src = fs.readdirSync(path.join(COCKPIT, 'lib'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(COCKPIT, 'lib', f), 'utf8'))
    .concat([lire('vscodium-extension', 'szh-cockpit', 'extension.js')])
    .join('\n');
  for (const c of pkg.contributes.commands) {
    assert.ok(src.includes("'" + c.command + "'"),
      'commande déclarée mais jamais citée : ' + c.command);
  }
});

test('les raccourcis pointent des commandes qui existent', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const connues = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const k of jsonc(lire('vscodium-user', 'keybindings.json'))) {
    if (k.command && k.command.startsWith('szh.')) {
      assert.ok(connues.has(k.command), 'raccourci vers une commande inconnue : ' + k.command);
    }
  }
});

test('les traductions fr et de couvrent les mêmes clés, avec les mêmes repères', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  const debut = src.indexOf('const TEXTES_COCKPIT = {');
  const fin = src.indexOf('\n};', debut);
  // eslint-disable-next-line no-eval
  const textes = eval('(' + src.slice(debut + 'const TEXTES_COCKPIT = '.length, fin + 2) + ')');
  const reperes = (s) => (String(s).match(/\{\d\}/g) || []).sort().join('');
  for (const cle of Object.keys(textes.fr)) {
    assert.ok(cle in textes.de, 'clé sans traduction allemande : ' + cle);
    assert.strictEqual(reperes(textes.de[cle]), reperes(textes.fr[cle]),
      'repères {0} divergents sur : ' + cle);
  }
  assert.strictEqual(Object.keys(textes.de).length, Object.keys(textes.fr).length);
});

test('le README de l’extension cite tous ses modules', () => {
  const readme = lire('vscodium-extension', 'szh-cockpit', 'README.md');
  for (const f of fs.readdirSync(path.join(COCKPIT, 'lib')).filter((f) => f.endsWith('.js'))) {
    assert.ok(readme.includes(f), 'module absent du README : lib/' + f);
  }
});

test('la palette du formulaire est celle du pipeline', () => {
  const py = lire('pipeline', 'accent-css.py');
  for (const hex of yaml.HEX_COULEURS) {
    assert.ok(py.toUpperCase().includes(hex.toUpperCase()),
      'couleur du cockpit absente de accent-css.py : ' + hex);
  }
});
