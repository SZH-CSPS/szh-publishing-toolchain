// Le module de la traduction côté hôte, configuré seul, sans extension.js : le mode
// « Trad », l'envoi pour traduction et le panneau « Traductions », qui tient son propre état.
//
//   node --test "test/js/traduction-hote.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

// Une doublure de « vscode » qui note ce que le module montre et les panneaux qu'il crée.
// Chargée une fois : lib/webviews/panneau.js garde la doublure du premier chargement, et
// chaque test repart de relevés vides.
const vu = { avertissements: [], statuts: [], panneaux: [], presse: [] };
let module_ = null;
function charger() {
  for (const cle of Object.keys(vu)) { vu[cle] = []; }
  if (module_) { return { m: module_, vu }; }
  const Module = require('module');
  const orig = Module._load;
  const faux = {
    ViewColumn: { One: 1, Beside: -2 },
    Uri: { file: (p) => ({ fsPath: p }), parse: (u) => ({ toString: () => u }) },
    window: {
      showWarningMessage: (m) => { vu.avertissements.push(m); return Promise.resolve(undefined); },
      showInformationMessage: () => Promise.resolve(undefined),
      showErrorMessage: () => Promise.resolve(undefined),
      setStatusBarMessage: (m) => { vu.statuts.push(m); },
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
    },
    workspace: { getConfiguration: () => ({ get: (c, d) => d }) },
    env: {
      language: 'fr',
      clipboard: { writeText: (t) => { vu.presse.push(t); return Promise.resolve(); } },
      openExternal: () => Promise.resolve(true)
    },
    commands: { executeCommand: () => Promise.resolve() }
  };
  Module._load = function (r, pp, i) { return r === 'vscode' ? faux : orig(r, pp, i); };
  try {
    module_ = require(path.join(COCKPIT, 'lib', 'traduction-hote.js'));
    return { m: module_, vu };
  } finally { Module._load = orig; }
}

test('traduction-hote : la garde du mode Trad laisse passer ce qui n’est pas à elle', () => {
  const { m, vu } = charger();
  const panneau = { webview: { postMessage: () => { throw new Error('rien à envoyer'); } } };
  assert.strictEqual(m.repondreModeTrad(panneau, null), false);
  assert.strictEqual(m.repondreModeTrad(panneau, { type: MSG.ENREGISTRER }), false);
  // Un « pret » sans demande d'index reste celui de la page.
  assert.strictEqual(m.repondreModeTrad(panneau, { type: MSG.PRET }), false);
  // Un clic détourné sur un texte vide est absorbé, sans ouvrir de formulaire.
  assert.strictEqual(m.repondreModeTrad(panneau, { type: MSG.SUGGERER_INTERFACE, texte: '  ' }), true);
  assert.strictEqual(vu.panneaux.length, 0);
});

test('traduction-hote : l’envoi refuse un numéro sans lien', async () => {
  const { m, vu } = charger();
  const fournisseur = { racine: path.join(os.tmpdir(), 'szh-sans-ausgabe'), listerArticles: () => ['a'] };
  await m.envoyerPourTraduction(fournisseur, { slug: 'a' });
  assert.strictEqual(vu.avertissements.length, 1, 'un numéro sans ausgabe.yaml n’a pas de lien');
  assert.deepStrictEqual(vu.presse, [], 'rien ne doit partir au presse-papiers');
});

test('traduction-hote : le panneau « Traductions » tient son état lui-même', async () => {
  const { m, vu } = charger();
  const ouverts = [];
  m.configurer({ ouvrirArticle: async (f, slug, opts) => { ouverts.push([slug, opts]); } });
  const fournisseur = { racine: os.tmpdir(), listerArticles: () => ['01-essai'] };

  await m.ouvrirTraduction(fournisseur, null, { slug: 'inconnu' });
  assert.strictEqual(vu.panneaux.length, 0, 'un article absent ouvre un panneau');

  await m.ouvrirTraduction(fournisseur, null, { slug: '01-essai' });
  assert.strictEqual(vu.panneaux.length, 1);
  const panneau = vu.panneaux[0];
  assert.strictEqual(panneau.viewType, 'szhTraduction');
  assert.match(panneau.webview.html, /<html/i, 'la page n’est pas assemblée par le module');
  assert.deepStrictEqual(ouverts, [['01-essai', { sansTexte: true }]]);

  // Une saisie en cours se garde dans le module : le rafraîchissement ne l'écrase pas.
  await panneau.recepteurs[0]({ type: MSG.MODIFIE, modifie: true });
  m.rafraichirPanneauTraduction(fournisseur);
  assert.strictEqual(vu.avertissements.length, 1, 'la saisie non enregistrée n’est pas protégée');
  assert.strictEqual(panneau.postes.length, 0, 'les valeurs ont été renvoyées par-dessus la saisie');

  // Un second appel sur le même article révèle le panneau au lieu d'en créer un autre.
  await m.ouvrirTraduction(fournisseur, null, { slug: '01-essai' });
  assert.strictEqual(vu.panneaux.length, 1);
});

test('traduction-hote : la cible vient de l’argument, sinon de l’éditeur actif par le rappel', () => {
  const { m } = charger();
  const fournisseur = { racine: os.tmpdir(), listerArticles: () => [] };
  assert.deepStrictEqual(m.cibleTraduction(fournisseur, 'a'), { slug: 'a', cle: null });
  assert.deepStrictEqual(m.cibleTraduction(fournisseur, { slug: 'b', cle: 'titre' }), { slug: 'b', cle: 'titre' });
  assert.deepStrictEqual(m.cibleTraduction(fournisseur, null), { slug: null, cle: null });
  assert.strictEqual(m.libelleGroupe({ groupe: 'titre', champs: ['title'], langue: 'de' }).indexOf('(DE)') !== -1, true);
});

test('traduction-hote : l’enregistrement refuse un article hors du numéro, sans écrire', () => {
  const { m } = charger();
  const ecrits = [];
  m.configurer({ ecrireSuiviTraduction: (r, slug) => { ecrits.push(slug); } });
  const res = m.enregistrerTraduction({ racine: os.tmpdir(), listerArticles: () => ['a'] }, { slug: 'z' }, null);
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(ecrits, []);
});
