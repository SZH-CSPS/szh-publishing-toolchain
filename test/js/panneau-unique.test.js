// Tests de la fabrique des panneaux webview (lib/webviews/panneau.js) : un seul panneau par
// viewType et par clé, remis à zéro à la fermeture, mode Trad en tête du gestionnaire, et
// la poignée de main PRET. Le second test balaie les sources : tout createWebviewPanel de
// lib/ passe par la fabrique, et extension.js n'en garde que les exceptions nommées.
//
// Exécution : depuis la racine du dépôt,
//   node --test test/js/panneau-unique.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Un vscode réduit à ce que la fabrique touche : chaque panneau créé est retenu, avec ses
// options, ses reveal et le seul gestionnaire de messages et de fermeture qu'on lui pose.
function fauxVscode() {
  const crees = [];
  const faux = {
    ViewColumn: { One: 1, Two: 2, Beside: -2 },
    window: {
      createWebviewPanel(type, titre, colonne, options) {
        const p = {
          type: type, title: titre, colonne: colonne, options: options,
          html: null, reveles: [], recepteurs: [], fermetures: [], dispose() {
            for (const f of p.fermetures) { f(); }
          },
          reveal(c, garderFocus) { p.reveles.push([c, garderFocus]); },
          onDidDispose(f) { p.fermetures.push(f); return { dispose() {} }; },
          webview: {
            messages: [],
            postMessage(m) { p.webview.messages.push(m); return Promise.resolve(true); },
            onDidReceiveMessage(f) { p.recepteurs.push(f); return { dispose() {} }; },
            set html(v) { p.html = v; },
            get html() { return p.html; }
          }
        };
        crees.push(p);
        return p;
      }
    }
  };
  return { faux, crees };
}

function chargerFabrique() {
  const { faux, crees } = fauxVscode();
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (r, pp, i) {
    if (r === 'vscode') { return faux; }
    return orig(r, pp, i);
  };
  const chemin = path.join(COCKPIT, 'lib', 'webviews', 'panneau.js');
  try {
    delete require.cache[require.resolve(chemin)];
    return { fabrique: require(chemin), crees };
  } finally { Module._load = orig; }
}

test('panneauUnique : deux ouvertures donnent un seul panneau, la seconde le révèle', () => {
  const { fabrique, crees } = chargerFabrique();
  const premier = fabrique.panneauUnique({ viewType: 'szhEssai', titre: 'Essai', html: () => '<p></p>' });
  assert.strictEqual(premier.nouveau, true);
  const second = fabrique.panneauUnique({ viewType: 'szhEssai', titre: 'Essai', html: () => '<p></p>' });
  assert.strictEqual(second.nouveau, false);
  assert.strictEqual(second.panneau, premier.panneau);
  assert.strictEqual(crees.length, 1, 'la seconde ouverture a créé un second panneau');
  assert.deepStrictEqual(premier.panneau.reveles, [[1, undefined]],
    'la seconde ouverture doit révéler le panneau existant dans sa colonne');
  assert.strictEqual(fabrique.panneauCourant('szhEssai'), premier.panneau);
  // Une seule écoute de chaque événement : le faux hôte des tests n'en garde qu'une.
  assert.strictEqual(premier.panneau.recepteurs.length, 1);
  assert.strictEqual(premier.panneau.fermetures.length, 1);
  // Options communes à tous les panneaux, et le nonce dans le HTML.
  assert.deepStrictEqual(premier.panneau.options, { enableScripts: true, localResourceRoots: [] });
});

test('panneauUnique : une clé par formulaire, et revelerPanneau rend l’existant ou null', () => {
  const { fabrique, crees } = chargerFabrique();
  const a = fabrique.panneauUnique({ viewType: 'szhMediasEssai', cle: 'a', titre: 'A', retenir: true });
  const b = fabrique.panneauUnique({ viewType: 'szhMediasEssai', cle: 'b', titre: 'B', retenir: true });
  assert.notStrictEqual(a.panneau, b.panneau);
  assert.strictEqual(crees.length, 2);
  assert.strictEqual(a.panneau.options.retainContextWhenHidden, true);
  assert.strictEqual(fabrique.revelerPanneau({ viewType: 'szhMediasEssai', cle: 'c' }), null);
  assert.strictEqual(fabrique.revelerPanneau({ viewType: 'szhMediasEssai', cle: 'a' }), a.panneau);
  assert.strictEqual(a.panneau.reveles.length, 1);
  assert.deepStrictEqual(fabrique.panneauxOuverts('szhMediasEssai').map((e) => e[0]), ['a', 'b']);
  fabrique.fermerPanneaux('szhMediasEssai', 'a');
  assert.deepStrictEqual(fabrique.panneauxOuverts('szhMediasEssai').map((e) => e[0]), ['b']);
  fabrique.fermerPanneaux('szhMediasEssai');
  assert.deepStrictEqual(fabrique.panneauxOuverts('szhMediasEssai'), []);
});

test('panneauUnique : la fermeture remet à zéro, puis rappelle surFermeture', () => {
  const { fabrique, crees } = chargerFabrique();
  const fermes = [];
  const { panneau } = fabrique.panneauUnique({
    viewType: 'szhFerme', titre: 'F', surFermeture: (p) => fermes.push(p)
  });
  panneau.dispose();
  assert.strictEqual(fabrique.panneauCourant('szhFerme'), null);
  assert.deepStrictEqual(fermes, [panneau]);
  const rouvert = fabrique.panneauUnique({ viewType: 'szhFerme', titre: 'F' });
  assert.strictEqual(rouvert.nouveau, true);
  assert.strictEqual(crees.length, 2);
  // Un ancien panneau qui se ferme après coup ne retire pas le nouveau.
  panneau.fermetures[0]();
  assert.strictEqual(fabrique.panneauCourant('szhFerme'), rouvert.panneau);
});

test('panneauUnique : une garde extérieure (session) tient le panneau courant', () => {
  const { fabrique } = chargerFabrique();
  let tenu = null;
  const garde = { lire: () => tenu, poser: (p) => { tenu = p; } };
  const colonne = { viewColumn: 2, preserveFocus: true };
  const { panneau } = fabrique.panneauUnique({ viewType: 'szhApercuEssai', titre: 's', garde: garde,
    colonne: colonne });
  assert.strictEqual(tenu, panneau);
  assert.deepStrictEqual(panneau.colonne, colonne);
  assert.strictEqual(fabrique.panneauUnique({ viewType: 'szhApercuEssai', garde: garde, colonne: colonne }).panneau,
    panneau);
  assert.deepStrictEqual(panneau.reveles, [[2, true]]);
  panneau.dispose();
  assert.strictEqual(tenu, null);
  // Une Map tenue par l'appelant marche de même, clé par clé.
  const table = new Map();
  const t = fabrique.panneauUnique({ viewType: 'szhTableEssai', cle: 'x', garde: table }).panneau;
  assert.strictEqual(table.get('x'), t);
  t.dispose();
  assert.strictEqual(table.has('x'), false);
});

test('panneauUnique : le mode Trad passe en tête, puis PRET, puis les autres messages', async () => {
  const { fabrique } = chargerFabrique();
  const vus = [];
  const { panneau } = fabrique.panneauUnique({
    viewType: 'szhTrad', titre: 'T',
    modeTrad: (p, msg) => { vus.push('trad:' + msg.type); return msg.type === 'modeTrad'; },
    html: (nonce) => '<script nonce="' + nonce + '"></script>',
    surPret: (msg, p) => { vus.push('pret:' + msg.requete); assert.strictEqual(p, panneau); return 'rendu-pret'; },
    surMessage: async (msg) => { vus.push('msg:' + msg.type); return 'rendu-msg'; }
  });
  const recepteur = panneau.recepteurs[0];
  assert.match(panneau.html, /nonce="[0-9a-f]{32}"/, 'le HTML reçoit un nonce de 16 octets');
  assert.strictEqual(recepteur(null), undefined);
  assert.strictEqual(recepteur({ type: 'modeTrad' }), undefined);
  assert.strictEqual(recepteur({ type: 'pret', requete: 7 }), 'rendu-pret');
  assert.strictEqual(await recepteur({ type: 'enregistrer' }), 'rendu-msg');
  assert.deepStrictEqual(vus, ['trad:modeTrad', 'trad:pret', 'pret:7', 'trad:enregistrer', 'msg:enregistrer']);
});

test('panneauUnique : sans modeTrad, le panneau ne détourne rien, et PRET va à surMessage sans surPret', () => {
  const { fabrique } = chargerFabrique();
  const vus = [];
  const { panneau } = fabrique.panneauUnique({
    viewType: 'szhReglagesEssai', titre: 'R', surMessage: (msg) => { vus.push(msg.type); }
  });
  panneau.recepteurs[0]({ type: 'modeTrad' });
  panneau.recepteurs[0]({ type: 'pret' });
  assert.deepStrictEqual(vus, ['modeTrad', 'pret']);
});

// ---- Balayage des sources ----

// Les panneaux d'extension.js qui n'ont pas encore été repris, par fonction englobante. La
// liste ne peut que diminuer : un nouveau createWebviewPanel échoue ici, et une exception
// qui ne correspond plus à rien doit être retirée.
const EXCEPTIONS_EXTENSION = {};

function fichiersJs(dossier) {
  const liste = [];
  for (const f of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, f.name);
    if (f.isDirectory()) { liste.push(...fichiersJs(chemin)); }
    else if (f.name.endsWith('.js')) { liste.push(chemin); }
  }
  return liste;
}

function sitesDe(chemin) {
  const lignes = fs.readFileSync(chemin, 'utf8').split('\n');
  const sites = [];
  let fonction = '(hors fonction)';
  for (let i = 0; i < lignes.length; i++) {
    const m = /^(?:async )?function ([A-Za-z0-9_$]+)/.exec(lignes[i]);
    if (m) { fonction = m[1]; }
    if (/createWebviewPanel\(/.test(lignes[i])) { sites.push({ fonction: fonction, ligne: i + 1 }); }
  }
  return sites;
}

test('panneauUnique : tout createWebviewPanel de lib/ passe par la fabrique', () => {
  const fabrique = path.join(COCKPIT, 'lib', 'webviews', 'panneau.js');
  const horsFabrique = [];
  for (const chemin of fichiersJs(path.join(COCKPIT, 'lib'))) {
    if (chemin === fabrique) { continue; }
    for (const s of sitesDe(chemin)) {
      horsFabrique.push(path.relative(COCKPIT, chemin).replace(/\\/g, '/') + ':' + s.ligne);
    }
  }
  assert.deepStrictEqual(horsFabrique, [],
    'ces panneaux de lib/ sont créés à la main : passez par panneauUnique (lib/webviews/panneau.js)');
  assert.strictEqual(sitesDe(fabrique).length, 1, 'la fabrique doit créer elle-même ses panneaux');
});

test('panneauUnique : extension.js ne garde que les exceptions nommées', () => {
  const sites = sitesDe(path.join(COCKPIT, 'extension.js'));
  const imprevus = sites.filter((s) => !Object.prototype.hasOwnProperty.call(EXCEPTIONS_EXTENSION, s.fonction))
    .map((s) => s.fonction + ' (ligne ' + s.ligne + ')');
  assert.deepStrictEqual(imprevus, [],
    'nouveau createWebviewPanel dans extension.js : passez par panneauUnique');
  const noms = new Set(sites.map((s) => s.fonction));
  for (const nom of Object.keys(EXCEPTIONS_EXTENSION)) {
    assert.ok(noms.has(nom), nom + ' ne crée plus de panneau à la main : retirez-le des exceptions');
  }
});
