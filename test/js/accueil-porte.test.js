// La porte de l'Accueil dans l'éditeur (lib/accueil-hote.js) : il ne s'ouvre seul que sous
// SZH_ACCUEIL=1 et dans une fenêtre sans dossier. Une porte mal fermée le ferait surgir sur
// chaque poste. Chaque cas active l'extension dans son propre processus : le faux vscode ne
// s'active qu'une fois par processus.
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
  // Un dossier d'avant la convention : il s'affiche quand même « 2025-04 ».
  const ancien = path.join(process.env.SZH_RACINE_TEST, 'Revue', '2025-4');
  fs.mkdirSync(ancien, { recursive: true });
  fs.writeFileSync(path.join(ancien, 'ausgabe.yaml'), 'revue: revue\n');
  fs.utimesSync(ancien, 1000000000, 1000000000);
  const HOTE = activerHote(revueDEssai(), { sansDossier: CAS !== 'dossier' });
  for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
  const accueils = HOTE.panneaux.filter((p) => p.type === 'szhAccueil');
  const sortie = {
    accueils: accueils.length,
    actif: HOTE.contexte()['szh.accueil.actif'],
    commande: HOTE.commandes().indexOf('szh.accueil') !== -1
  };
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
  const r = spawnSync(process.execPath, [__filename], { env, encoding: 'utf8', timeout: 120000 });
  const ligne = String(r.stdout || '').split(/\r?\n/).filter((l) => l.indexOf('@@PORTE@@') === 0).pop();
  assert.ok(ligne, 'aucun verdict de l’enfant : ' + r.stdout + r.stderr);
  return JSON.parse(ligne.slice('@@PORTE@@'.length));
}

if (CAS) {
  enfant().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
} else {
  test('porte fermée : rien ne s’ouvre, même sans dossier, et le contexte est faux', () => {
    const r = rejouer('fermee', '');
    assert.strictEqual(r.accueils, 0);
    assert.strictEqual(r.actif, false);
    assert.strictEqual(r.commande, true, 'la commande existe, masquée de la palette par le contexte');
    const autre = rejouer('fermee', '0');
    assert.strictEqual(autre.accueils, 0, 'seul « 1 » ouvre la porte');
    assert.strictEqual(autre.actif, false);
  });

  test('porte ouverte sur un dossier : rien ne s’ouvre', () => {
    const r = rejouer('dossier', '1');
    assert.strictEqual(r.accueils, 0);
    assert.strictEqual(r.actif, true);
  });

  test('porte ouverte sans dossier : le panneau s’ouvre, liste, ouvre et refuse', () => {
    const r = rejouer('ouverte', '1');
    assert.strictEqual(r.accueils, 1);
    assert.strictEqual(r.actif, true);
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
