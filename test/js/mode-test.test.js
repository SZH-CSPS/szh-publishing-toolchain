// Badge « Dossier de test » dans la barre d'état : un poste qui pointe sur l'arborescence de
// test l'affiche, en couleur.
//
// lib/archivage.js décide (lireEmplacementRevues, EMPLACEMENT_TEST, lireConfigPoste) ;
// extension.js (majBarreModeTest, dans activate()) affiche. Un seul activerHote() par
// processus (voir hote-factice.js) : les scénarios réutilisent le même hôte et la même revue,
// chacun pose son config.json jetable par SZH_CONFIG_OJS puis rejoue szh.cockpit.rafraichir
// (-> majContexte -> majBarreModeTest).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// La langue de l'hôte factice vaut déjà 'fr', mais on l'impose : le libellé attendu est
// français, et SZH_LANGUE prime (lib/i18n.js#langueCockpit).
process.env.SZH_LANGUE = 'fr';

const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
// demarrageInitial() (extension.js) est asynchrone et non attendu par activate() : le premier
// majBarreModeTest() n'a lieu qu'après un tour de boucle. Même délai que doi-ojs.test.js.
const pret = new Promise((r) => setTimeout(r, 30));

// Un config.json jetable par scénario : SZH_CONFIG_OJS détourne la lecture.
function fichierConfigJetable() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-mode-test-')), 'config.json');
}

// Pose SZH_CONFIG_OJS sur un config.json jetable (aucun fichier si `contenu` est null :
// « aucune configuration de poste »), rejoue le rafraîchissement complet, laisse `fn`
// regarder la barre d'état, puis restaure la variable et rejoue une dernière fois pour ne
// rien laisser au test suivant (try/finally).
async function avecConfigPoste(contenu, fn) {
  await pret;
  const chemin = fichierConfigJetable();
  if (contenu !== null) {
    fs.writeFileSync(chemin, JSON.stringify(contenu, null, 2) + '\n');
  }
  process.env.SZH_CONFIG_OJS = chemin;
  try {
    await HOTE.executer('szh.cockpit.rafraichir');
    await fn();
  } finally {
    delete process.env.SZH_CONFIG_OJS;
    await HOTE.executer('szh.cockpit.rafraichir');
  }
}

// Retrouve le badge, visible ou non, par sa couleur d'avertissement, posée à la création. Ni
// par son texte (un badge caché n'en a plus), ni par sa commande.
function barreModeTest() {
  return HOTE.barres.filter(
    (b) => b.backgroundColor && b.backgroundColor.id === 'statusBarItem.warningBackground').pop() || null;
}

// Un clic sur le badge ouvre l'onglet Paramètres de l'Accueil (szh.reglages), où se règle le
// mode développeur, et l'infobulle le dit.
test('emplacementRevues: "test" -> badge visible, orange, et qui dit où se règle le mode', async () => {
  await avecConfigPoste({ emplacementRevues: 'test' }, () => {
    const barre = HOTE.barreQuiDit('Dossier de test');
    assert.ok(barre, 'le badge « Dossier de test » n’est pas visible');
    assert.strictEqual(barre.command, 'szh.reglages',
      'le badge ne mène plus à l’onglet Paramètres, où se règle le mode');
    assert.match(String(barre.tooltip), /Param/,
      'l’infobulle ne dit plus où se règle le mode test : le badge devient une impasse');
    assert.ok(barre.backgroundColor, 'le badge n’a pas de fond de couleur');
    assert.strictEqual(barre.backgroundColor.id, 'statusBarItem.warningBackground',
      'le badge n’a pas la couleur d’avertissement attendue');
  });
});

test('emplacementRevues: "production" -> le badge ne se montre pas', async () => {
  await avecConfigPoste({ emplacementRevues: 'production' }, () => {
    assert.strictEqual(HOTE.barreQuiDit('Dossier de test'), null,
      'le badge reste visible alors que le poste est en production');
    const barre = barreModeTest();
    assert.ok(barre, 'le badge lui-même a disparu (dispose), pas seulement masqué');
    assert.strictEqual(barre.visible, false, 'le badge est resté visible en production');
  });
});

test('aucun config.json -> badge visible, tooltip du défaut faute de configuration', async () => {
  await avecConfigPoste(null, () => {
    const barre = HOTE.barreQuiDit('Dossier de test');
    assert.ok(barre, 'sans configuration de poste, le badge doit rester visible (défaut = test)');
    assert.match(String(barre.tooltip), /défaut/i,
      'le tooltip ne dit pas que c’est le défaut faute de configuration : ' + barre.tooltip);
  });
});

test('ancienne clé devMode: true seule -> badge visible (compatibilité)', async () => {
  await avecConfigPoste({ devMode: true }, () => {
    const barre = HOTE.barreQuiDit('Dossier de test');
    assert.ok(barre, 'l’ancienne clé devMode ne fait plus apparaître le badge');
  });
});
