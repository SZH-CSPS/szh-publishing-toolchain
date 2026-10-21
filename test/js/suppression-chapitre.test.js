// Supprimer un chapitre renumérote les chapitres restants, sans toucher aux dossiers
// préfixés « _ », qui ne sont pas des chapitres (pipeline/profils/livre.mk).
//
//   node --test test/js/suppression-chapitre.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Neutralise le script de déplacement avant toute activation (voir hote-livre.test.js).
const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
archivage.lancerArchivage = () => null;

const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const { livreDEssai, activerHote } = require('./hote-factice');

const LIVRE = livreDEssai();
const CHAPITRES = path.join(LIVRE, 'chapitres');
for (const slug of ['03-fin', '_restes']) {
  fs.mkdirSync(path.join(CHAPITRES, slug), { recursive: true });
  fs.writeFileSync(path.join(CHAPITRES, slug, slug + '.md'), '# Titre\n');
}
const HOTE = activerHote(LIVRE);

test('livre : la suppression d’un chapitre referme le rang, « _restes » garde son nom', async () => {
  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await HOTE.executer('szh.supprimerArticle', { slug: '02-suite' });

  assert.deepStrictEqual(fs.readdirSync(CHAPITRES).sort(), ['00-ouverture', '01-fin', '_restes'],
    'les chapitres restants ne sont pas renumérotés sans trou, ou « _restes » a été renommé');
  const buch = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  assert.match(buch, /^ordre-chapitres: \["00-ouverture", "01-fin"\]$/m,
    'ordre-chapitres ne nomme pas les seuls chapitres : ' + buch);
});
