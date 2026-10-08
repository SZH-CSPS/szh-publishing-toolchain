// Quand l'Accueil s'ouvre de lui-même (lib/accueil-hote.js) : seulement dans une fenêtre sans
// dossier ni onglet, sinon il recouvrirait un numéro ou un fichier. Quand le numéro choisi est
// déjà ouvert ailleurs, la fenêtre de l'Accueil se ferme. Chaque cas active l'extension dans
// son propre processus : le faux vscode ne s'active qu'une fois par processus.
//
//   node --test test/js/accueil-porte.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CAS = process.env.SZH_PORTE_CAS;

// ---- Le côté enfant : une activation, puis ce qu'elle a laissé, en JSON ----
async function enfant() {
  const { revueDEssai, activerHote } = require('./hote-factice');
  const { MSG } = require('../../vscodium-extension/szh-cockpit/lib/messages');
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-porte-'));
  process.env.SZH_BASE = path.join(travail, 'ProgramData');
  process.env.SZH_RACINE_TEST = path.join(travail, 'Base');
  process.env.SZH_RACINE_PROD = path.join(travail, 'Prod');
  process.env.SZH_ONGLET = '';
  fs.mkdirSync(path.join(process.env.SZH_RACINE_TEST, 'Revue', '2026-03'), { recursive: true });
  fs.writeFileSync(path.join(process.env.SZH_RACINE_TEST, 'Revue', '2026-03', 'ausgabe.yaml'),
    'title: "Trois"\nrevue: revue\n');
  // Un dossier nommé sans zéro (2025-4) s'affiche « 2025-04 ».
  const ancien = path.join(process.env.SZH_RACINE_TEST, 'Revue', '2025-4');
  fs.mkdirSync(ancien, { recursive: true });
  fs.writeFileSync(path.join(ancien, 'ausgabe.yaml'), 'revue: revue\n');
  fs.utimesSync(ancien, 1000000000, 1000000000);
  const fichier = { uri: { fsPath: path.join(travail, 'note.md') } };
  const avecOnglet = CAS === 'onglet' || CAS === 'relecture';
  const HOTE = activerHote(revueDEssai(), { sansDossier: CAS !== 'dossier', onglets: avecOnglet ? [fichier] : [] });
  const accueilsAvant = HOTE.panneaux.filter((p) => p.type === 'szhAccueil').length;
  // L'onglet se ferme avant la relecture : seule elle peut ouvrir l'Accueil.
  if (CAS === 'relecture') { HOTE.poserOnglets([]); }
  for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
  await new Promise((r) => setTimeout(r, 700));
  const accueils = HOTE.panneaux.filter((p) => p.type === 'szhAccueil');
  const sortie = {
    accueils: accueils.length,
    accueilsAvant,
    commande: HOTE.commandes().indexOf('szh.accueil') !== -1,
    bouton: HOTE.barres.filter((b) => b.command === 'szh.accueil' && b.visible).map((b) => b.text)
  };
  // Le bouton, depuis un numéro ouvert : tout enregistrer, puis fermer le numéro ; la fenêtre
  // vide qui en résulte ouvre l'Accueil d'elle-même.
  if (CAS === 'dossier') {
    HOTE.oublierCommandes();
    await HOTE.executer('szh.accueil');
    sortie.retour = HOTE.commandesJouees().map((c) => c.id).filter((id) => id !== 'szh.accueil');
    sortie.accueilsApresRetour = HOTE.panneaux.filter((p) => p.type === 'szhAccueil').length;
  }
  // Le numéro choisi est-il déjà ouvert ailleurs ? Le faux éditeur garde la fenêtre et
  // son focus, ou le donne à une autre, ou se désactive comme au rechargement.
  if (['ailleurs', 'remplacee', 'desactivee'].indexOf(CAS) !== -1 && accueils.length === 1) {
    const p = accueils[0];
    require('../../vscodium-extension/szh-cockpit/lib/accueil-hote').configurer({ delaiFermeture: 50 });
    await p._recepteur({ type: MSG.PRET });
    const charger = p.messages.filter((m) => m.type === MSG.CHARGER)[0] || {};
    const chemin = (((charger.produits || [])[0] || {}).enCours || [])[0].chemin;
    HOTE.oublierCommandes();
    if (CAS !== 'remplacee') { HOTE.poserFocus(false); }
    await p._recepteur({ type: MSG.ACCUEIL_OUVRIR, chemin: chemin });
    if (CAS === 'desactivee') { HOTE.desactiver(); }
    await new Promise((r) => setTimeout(r, 200));
    sortie.jouees = HOTE.commandesJouees().map((c) => c.id);
  }
  if (CAS === 'ouverte' && accueils.length === 1) {
    const p = accueils[0];
    await p._recepteur({ type: MSG.PRET });
    const charger = p.messages.filter((m) => m.type === MSG.CHARGER)[0] || {};
    sortie.produit = charger.produit;
    sortie.enCours = ((charger.produits || [])[0] || {}).enCours;
    const chemin = sortie.enCours && sortie.enCours[0] && sortie.enCours[0].chemin;
    HOTE.oublierCommandes();
    await p._recepteur({ type: MSG.ACCUEIL_OUVRIR, chemin: path.join(travail, 'ailleurs') });
    await p._recepteur({ type: MSG.ACCUEIL_OUVRIR, chemin: chemin });
    sortie.ouvertures = HOTE.commandesJouees().filter((c) => c.id === 'vscode.openFolder')
      .map((c) => ({ chemin: c.args[0].fsPath, options: c.args[1] }));
    sortie.dernier = HOTE.memoire['szh.lanceur.dernier'];
    await p._recepteur({ type: MSG.ACCUEIL_CREER, produit: 'revue', annee: 2026, numero: 0 });
    sortie.cree = p.messages.filter((m) => m.type === MSG.ACCUEIL_CREE);
  }
  process.stdout.write('@@PORTE@@' + JSON.stringify(sortie) + '\n');
  try { fs.rmSync(travail, { recursive: true, force: true }); } catch (e) { /* débris */ }
  process.exit(0);
}

// ---- Le côté test ----
function rejouer(cas, accueil) {
  const env = Object.assign({}, process.env, { SZH_PORTE_CAS: cas });
  if (accueil) { env.SZH_ACCUEIL = accueil; } else { delete env.SZH_ACCUEIL; }
  delete env.SZH_ONGLET;
  const r = spawnSync(process.execPath, [__filename], { env, encoding: 'utf8', timeout: 120000 });
  const ligne = String(r.stdout || '').split(/\r?\n/).filter((l) => l.indexOf('@@PORTE@@') === 0).pop();
  assert.ok(ligne, 'aucun verdict de l’enfant : ' + r.stdout + r.stderr);
  return JSON.parse(ligne.slice('@@PORTE@@'.length));
}

if (CAS) {
  enfant().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
} else {
  test('un dossier ouvert : rien ne s’ouvre, même après la relecture', () => {
    const r = rejouer('dossier', '');
    assert.strictEqual(r.accueils, 0);
    assert.strictEqual(r.commande, true, 'la commande reste, toujours visible');
    // La barre d'activité est masquée : le retour à l'Accueil a son bouton dans la barre d'état.
    assert.deepStrictEqual(r.bouton, ['$(home) Accueil'], 'pas de bouton Accueil dans la barre d’état');
    assert.deepStrictEqual(r.retour, ['workbench.action.files.saveAll', 'workbench.action.closeFolder'],
      'le retour enregistre tout puis ferme le numéro');
    assert.strictEqual(r.accueilsApresRetour, 0, 'l’Accueil ne s’ouvre pas par-dessus le numéro');
  });

  test('un onglet ouvert sans dossier : rien ne s’ouvre, même après la relecture', () => {
    const r = rejouer('onglet', '');
    assert.strictEqual(r.accueils, 0);
  });

  test('l’onglet fermé avant la relecture : l’Accueil s’ouvre à +500 ms, pas avant', () => {
    const r = rejouer('relecture', '');
    assert.strictEqual(r.accueilsAvant, 0, 'ouvert dès l’activation malgré l’onglet');
    assert.strictEqual(r.accueils, 1, 'la relecture n’a pas ouvert l’Accueil');
  });

  test('SZH_ACCUEIL ne décide plus rien : « 0 » n’empêche pas l’Accueil d’une fenêtre vide', () => {
    const r = rejouer('ouverte', '0');
    assert.strictEqual(r.accueils, 1);
    assert.strictEqual(r.accueilsAvant, 1, 'l’Accueil attend la relecture au lieu de s’ouvrir à l’activation');
  });

  test('le numéro est déjà ouvert ailleurs : la fenêtre de l’Accueil se ferme', () => {
    const r = rejouer('ailleurs', '');
    assert.deepStrictEqual(r.jouees, ['vscode.openFolder', 'workbench.action.closeWindow']);
  });

  test('la fenêtre garde le focus (elle se recharge sur le numéro) : rien ne se ferme', () => {
    const r = rejouer('remplacee', '');
    assert.deepStrictEqual(r.jouees, ['vscode.openFolder']);
  });

  test('l’extension se désactive avant le délai : rien ne se ferme', () => {
    const r = rejouer('desactivee', '');
    assert.deepStrictEqual(r.jouees, ['vscode.openFolder']);
  });

  test('ni dossier ni onglet : le panneau s’ouvre, liste, ouvre et refuse', () => {
    const r = rejouer('ouverte', '');
    assert.strictEqual(r.accueils, 1);
    assert.strictEqual(r.accueilsAvant, 1, 'l’Accueil ne s’ouvre pas dès l’activation');
    assert.strictEqual(r.produit, 'revue', 'le produit d’office vient de l’hôte');
    assert.deepStrictEqual(r.enCours.map((e) => e.nom), ['2026-03', '2025-04'], 'deux chiffres, toujours');
    assert.match(r.enCours[0].modifie, /^\d{2}\.\d{2}\.\d{4}$/);
    // Un chemin que la page n'a pas reçu ne s'ouvre pas ; celui de la liste, si.
    assert.deepStrictEqual(r.ouvertures, [{ chemin: r.enCours[0].chemin, options: { forceReuseWindow: true } }]);
    assert.strictEqual(r.dernier, r.enCours[0].chemin);
    assert.strictEqual(r.cree.length, 1);
    assert.strictEqual(r.cree[0].ok, false);
    assert.ok(r.cree[0].texte, 'un refus se dit');
  });
}
