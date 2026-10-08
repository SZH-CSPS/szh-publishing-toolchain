// lib/vue-ensemble-hote.js chargé seul, sans extension.js : les vues d'ensemble se
// construisent par leurs rappels, et une vue fermée ne reçoit rien.
//
//   node --test test/js/vue-ensemble-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

const vu = { panneaux: [] };
function charger() {
  const orig = Module._load;
  const faux = {
    ViewColumn: { One: 1, Beside: -2 },
    EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
    workspace: { getConfiguration: () => ({ get: (c, d) => d }) },
    env: { language: 'fr' },
    commands: { executeCommand: () => Promise.resolve() },
    window: {
      createWebviewPanel: (type, titre) => {
        const p = {
          viewType: type, title: titre, recepteurs: [], postes: [],
          webview: {
            html: '',
            onDidReceiveMessage: (f) => { p.recepteurs.push(f); },
            postMessage: (m) => { p.postes.push(m); return Promise.resolve(true); }
          },
          onDidDispose: () => {}, reveal: () => {}, dispose: () => {}
        };
        vu.panneaux.push(p);
        return p;
      }
    }
  };
  Module._load = function (r, p, i) { return r === 'vscode' ? faux : orig(r, p, i); };
  try { return require(path.join(COCKPIT, 'lib', 'vue-ensemble-hote.js')); }
  finally { Module._load = orig; }
}

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vue-ensemble-'));
test.after(() => { fs.rmSync(racine, { recursive: true, force: true }); });
fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), 'title: "Essai"\nlang: fr\n');

test('vue-ensemble-hote seul : la vue des traductions lit l’état par le rappel', () => {
  const m = charger();
  const lus = [];
  m.configurer({
    etatTraduction: (r, slug) => {
      lus.push(slug);
      return { meta: {}, suivi: { commentaire: 'à revoir' }, lignes: [{}],
               resume: { melange: false, statut: 'finalise', remplis: 2, total: 2 } };
    }
  });
  const vue = m.vueTraductions({ racine: racine, slugsTraduisibles: () => ['01-a'] });
  assert.deepEqual(lus, ['01-a']);
  assert.equal(vue.lignes.length, 1);
  assert.equal(vue.lignes[0].pastilles[0].ton, 'ok');
  assert.equal(vue.lignes[0].notif.texte, 'à revoir');
});

test('vue-ensemble-hote seul : sans rapport d’import, rien à lire ; vue fermée, rien d’envoyé', () => {
  const m = charger();
  assert.deepEqual(m.lireRapportImport(racine), []);
  // Aucune vue ouverte : ni le rafraîchissement ni l'envoi ne créent de panneau.
  m.rafraichirVueOuverte({ racine: racine }, 'controles');
  m.envoyerAVueOuverte('controles', { type: 'x' });
  assert.equal(vu.panneaux.length, 0);
});

// Une carte par Word, des titres qui nomment l'étiquette en cause, une action proposée, et un
// constat par champ laissé vide.
test('vue-ensemble-hote seul : le rapport d’import fait une carte par article, qui nomme ce qui est en cause et dit quoi faire', () => {
  const m = charger();
  const ligne = (code, champs) => '[import-avertissement] ' + code + ' | article « 01-essai » | '
    + champs.join(' | ') + ' | Phrase. | [de] Satz.';
  const journal = [
    ligne('cle-attendue-absente', ['clé « Adresse »', 'clé-de « Anschrift »']),
    ligne('type-article-non-reconnu', ['valeur « Rubrique libre »']),
    ligne('metadonnees-champ-hors-gabarit', ['champ « Mots-clés (FR) »', 'valeur « un, deux »']),
    ligne('cle-attendue-absente', ['clé « Photo »', 'clé-de « Porträt »'])
  ].join('\n') + '\n';
  const dossier = path.join(racine, 'articles-word');
  fs.mkdirSync(dossier, { recursive: true });
  // Le lecteur écrit chaque ligne deux fois : une seule doit compter.
  fs.writeFileSync(path.join(dossier, '.import.log'), journal + journal, 'utf8');
  try {
    const entrees = m.lireRapportImport(racine);
    assert.equal(entrees.length, 1, 'une carte par article : ' + JSON.stringify(entrees.map((e) => e.nom)));
    const e = entrees[0];
    assert.equal(e.ton, 'danger', 'la carte prend la gravité du pire de ses défauts');
    const titres = e.messages.map((g) => g.titre);
    assert.equal(titres.length, 3, JSON.stringify(titres));
    assert.match(titres[0], /Mots-clés \(FR\)$/, 'le bloquant vient en premier, et nomme sa ligne');
    assert.match(titres[1], /Rubrique libre$/, 'la valeur de type refusée n’est pas citée');
    assert.match(titres[2], /^2 champs.*Adresse, Photo$/, 'les champs vides ne sont pas regroupés et nommés');
    assert.match(e.messages[0].consigne, /Métadonnées des articles/, 'le geste manque');
    assert.ok(e.messages.every((g) => g.infobulle !== ''), 'l’explication s’est perdue');
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('vue-ensemble-hote seul : la vue des traductions s’ouvre une seule fois, avec l’accent de l’hôte', async () => {
  const m = charger();
  m.configurer({ lireCouleurAccent: () => '#123456' });
  const fournisseur = { racine: racine, slugsTraduisibles: () => [] };
  await m.ouvrirVueEnsemble(fournisseur, null, 'traductions');
  await m.ouvrirVueEnsemble(fournisseur, null, 'traductions');
  assert.equal(vu.panneaux.length, 1, 'la seconde ouverture a créé un second panneau');
  const p = vu.panneaux[0];
  assert.equal(p.viewType, 'szhVueTraductions');
  const valeurs = p.postes.find((x) => x.accent !== undefined);
  assert.ok(valeurs, 'la vue déjà ouverte n’a pas été renvoyée');
  assert.equal(valeurs.accent, '#123456');
  // Ouverte, elle reçoit ce que l'hôte lui pousse.
  m.envoyerAVueOuverte('traductions', { type: 'essai' });
  assert.equal(p.postes[p.postes.length - 1].type, 'essai');
});
