// Badge « Dossier de test » dans la barre d'état : un poste qui pointe sur l'arborescence de
// test le dit, en couleur — la décision test/production reste ouverte, l'annonce ne demande
// aucune décision à qui la lit.
//
//   node --test "test/js/*.test.js"
//
// lib/archivage.js DÉCIDE (lireEmplacementRevues, EMPLACEMENT_TEST, lireConfigPoste) ;
// extension.js (majBarreModeTest, dans activate()) ne fait qu'AFFICHER cette décision — le
// cockpit ne connaît jamais les chemins, seulement le verdict. Un seul activerHote() par
// processus (voir hote-factice.js) : les quatre scénarios réutilisent le MÊME hôte sur la
// MÊME revue, chacun posant son propre config.json jetable via SZH_CONFIG_OJS puis rejouant
// szh.cockpit.rafraichir (-> majContexte -> majBarreModeTest), exactement comme hote.test.js
// le fait déjà pour un verrou posé après coup sur ausgabe.yaml.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// La langue de l'hôte factice (vscode.env.language) vaut déjà 'fr' par défaut, mais on
// l'impose : le libellé attendu est le français, et SZH_LANGUE prime sur tout le reste
// (lib/i18n.js#langueCockpit).
process.env.SZH_LANGUE = 'fr';

const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
// demarrageInitial() (extension.js) est asynchrone et non attendu par activate() : la toute
// première majContexte() (donc le tout premier majBarreModeTest()) ne s'exécute qu'après un
// tour de boucle. Même délai que doi-ojs.test.js pour la même raison.
const pret = new Promise((r) => setTimeout(r, 30));

// Un config.json jetable par scénario, jamais celui du poste : SZH_CONFIG_OJS détourne la
// lecture, comme le font déjà config-poste.test.js, doi-ojs.test.js, date-numero.test.js et
// licence.test.js.
function fichierConfigJetable() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-mode-test-')), 'config.json');
}

// Pose SZH_CONFIG_OJS sur un config.json jetable — son contenu, ou aucun fichier écrit du
// tout si `contenu` est null (scénario « aucune configuration de poste ») —, rejoue le
// rafraîchissement complet comme le ferait l'ouverture du numéro ou la bascule du réglage
// « Mode développeur », laisse `fn` regarder la barre d'état, puis restaure la variable
// d'environnement et rejoue une dernière fois pour ne rien laisser filtrer sur le test
// suivant (même discipline que config-poste.test.js : restauration en try/finally).
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

// Le badge, qu'il soit visible ou non : retrouvé par sa commande (fixée une fois pour
// toutes à la création), pas par son texte — un badge caché n'a plus le texte qu'on
// chercherait.
function barreModeTest() {
  return HOTE.barres.filter((b) => b.command === 'szh.reglages').pop() || null;
}

test('emplacementRevues: "test" -> badge visible, orange, commande des Réglages', async () => {
  await avecConfigPoste({ emplacementRevues: 'test' }, () => {
    const barre = HOTE.barreQuiDit('Dossier de test');
    assert.ok(barre, 'le badge « Dossier de test » n’est pas visible');
    assert.strictEqual(barre.command, 'szh.reglages',
      'le clic sur le badge ne mène pas aux réglages');
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
