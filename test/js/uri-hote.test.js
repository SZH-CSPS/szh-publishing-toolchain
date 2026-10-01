// Les liens vscodium:// reçus par le cockpit (lib/uri-hote.js) : le dossier ouvert sert la
// vue, un autre dossier part au lanceur, un lien mal formé n'ouvre rien.
//
//   node --test test/js/uri-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const ID_OUVERT = 'AbCd1234EfGh5678';
const ID_AUTRE = 'ZzYy9876XxWw5432';

const { revueDEssai, activerHote } = require('./hote-factice');
const REVUE = revueDEssai();
fs.appendFileSync(path.join(REVUE, 'ausgabe.yaml'), 'id: ' + ID_OUVERT + '\n');
const HOTE = activerHote(REVUE);

// Le lanceur simulé, remplacé sur le module que lib/uri-hote.js lit à l'appel.
const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
const lancements = [];
archivage.lancerScriptPowerShell = (script, args) => { lancements.push({ script: script, args: args }); return null; };

function uriVscodium(chemin, query) {
  return { scheme: 'vscodium', authority: 'szh-csps.szh-cockpit', path: chemin,
    query: query || '', fragment: '' };
}

test('un gestionnaire de liens est enregistré à l’activation', () => {
  const g = HOTE.gestionnaireUri();
  assert.ok(g && typeof g.handleUri === 'function', 'aucun registerUriHandler à l’activation');
});

test('vers le dossier ouvert : la vue est servie, le lanceur n’est pas appelé', async () => {
  lancements.length = 0;
  const avant = HOTE.panneaux.length;
  const issue = await HOTE.gestionnaireUri().handleUri(
    uriVscodium('/traduction/revue/' + ID_OUVERT + '/01-essai'));
  assert.strictEqual(issue, 'vue');
  assert.deepStrictEqual(lancements, []);
  assert.ok(HOTE.panneaux.length > avant && HOTE.panneauDeType('szhTraduction'),
    'le suivi de traduction ne s’est pas ouvert');
});

test('vers un autre dossier : le lien szh:// part au lanceur', async () => {
  lancements.length = 0;
  const avant = HOTE.panneaux.length;
  const issue = await HOTE.gestionnaireUri().handleUri(
    uriVscodium('/traduction/zeitschrift/' + ID_AUTRE + '/03-inklusion'));
  assert.strictEqual(issue, 'lanceur');
  assert.deepStrictEqual(lancements, [{
    script: archivage.SCRIPT_LANCEUR,
    args: ['szh://traduction/zeitschrift/' + ID_AUTRE + '/03-inklusion']
  }]);
  assert.strictEqual(HOTE.panneaux.length, avant);
});

test('un lien mal formé est refusé sans rien ouvrir', async () => {
  lancements.length = 0;
  const avant = HOTE.panneaux.length;
  const mauvais = [
    uriVscodium('/traduction/revue/court/01-essai'),
    uriVscodium('/traduction/revue/' + ID_AUTRE + '/../x'),
    uriVscodium('/supprimer/revue/' + ID_AUTRE),
    uriVscodium('/ouvrir/revue/' + ID_AUTRE, 'x=1'),
    uriVscodium(''),
    null
  ];
  for (const uri of mauvais) {
    assert.strictEqual(await HOTE.gestionnaireUri().handleUri(uri), 'refuse', JSON.stringify(uri));
  }
  assert.deepStrictEqual(lancements, []);
  assert.strictEqual(HOTE.panneaux.length, avant);
});

test('un refus, ou un lanceur qui ne part pas, se dit à l’utilisateur', async () => {
  const d = HOTE.avertissements.length;
  assert.strictEqual(await HOTE.gestionnaireUri().handleUri(uriVscodium('')), 'refuse');
  assert.strictEqual(HOTE.avertissements.length, d + 1, 'un lien refusé est passé en silence');
  const vrai = archivage.lancerScriptPowerShell;
  archivage.lancerScriptPowerShell = () => 'script introuvable : open-revue.ps1';
  try {
    const issue = await HOTE.gestionnaireUri().handleUri(uriVscodium('/ouvrir/revue/' + ID_AUTRE));
    assert.strictEqual(issue, 'refuse', 'un lanceur en échec ne doit pas passer pour un succès');
    assert.strictEqual(HOTE.avertissements.length, d + 2);
  } finally {
    archivage.lancerScriptPowerShell = vrai;
    HOTE.avertissements.length = d;
  }
});
