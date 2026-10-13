// Supprimer un numéro depuis l'Accueil, côté hôte (lib/accueil-suppression-hote.js) : les
// gardes de la préparation et de la confirmation, le délai sur une horloge injectée, le
// verrou, la co-édition, et la suppression sur une arborescence jetable.
//
//   node --test test/js/accueil-suppression.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-supprimer-numero-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const BASE = path.join(TRAVAIL, 'Base');
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
Object.assign(process.env, {
  SZH_BASE: PROGRAMDATA, SZH_RACINE_TEST: BASE, SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'),
  SZH_ANCRAGE: path.join(TRAVAIL, 'Ancrage'), LOCALAPPDATA: path.join(TRAVAIL, 'Local'), SZH_LANGUE: 'fr'
});
// L'inventaire lit aussi OneDrive\Revues : on l'écarte, rien ne se lit sur le vrai OneDrive.
for (const v of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) { delete process.env[v]; }

// Une doublure de « vscode » réduite à ce que lisent i18n et la co-édition.
function charger(chemin) {
  const orig = Module._load;
  const faux = {
    workspace: { getConfiguration: () => ({ get: (cle, defaut) => (cle === 'nomUtilisateur' ? 'Moi Ici' : defaut) }) },
    window: {}, env: { language: 'fr' }
  };
  Module._load = function (r, p, i) { return r === 'vscode' ? faux : orig(r, p, i); };
  try { return require(chemin); } finally { Module._load = orig; }
}
const hote = charger(path.join(COCKPIT, 'lib', 'accueil-suppression-hote.js'));
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const session = require(path.join(COCKPIT, 'lib', 'session.js'));
const coedition = require(path.join(COCKPIT, 'lib', 'coedition.js'));

// Un numéro avec ses dossiers d'articles. `champs` complète ausgabe.yaml.
function numero(produit, nom, articles, champs) {
  const dossier = path.join(BASE, produit === 'zeitschrift' ? 'Zeitschrift' : 'Revue', nom);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'ausgabe.yaml'),
    'title: "Essai ' + nom + '"\nrevue: ' + produit + '\n' + (champs || ''), 'utf8');
  for (const slug of articles) {
    fs.mkdirSync(path.join(dossier, 'articles', slug), { recursive: true });
    fs.writeFileSync(path.join(dossier, 'articles', slug, slug + '.md'), '# ' + slug + '\n', 'utf8');
  }
  return dossier;
}
function livre(nom) {
  const dossier = path.join(BASE, 'Books', nom);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'buch.yaml'), 'titre: "Livre"\n', 'utf8');
  return dossier;
}
function archive(nom) {
  const dossier = path.join(BASE, '_Archive', 'Revue', nom);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'ausgabe.yaml'), 'title: "Archive"\nrevue: revue\narchived: true\n', 'utf8');
  return dossier;
}

// L'hôte configuré sur une horloge que le test fait avancer.
let horloge = 1000000;
let envoyes = [];
let ouverts = [];
let rafraichis = 0;
hote.configurer({
  envoyer: (m) => envoyes.push(m), dossiersOuverts: () => ouverts, rafraichir: () => { rafraichis++; },
  maintenant: () => horloge, attentes: [1, 1]
});
function oublier() { envoyes = []; ouverts = []; rafraichis = 0; }
function dernier(type) { return envoyes.filter((m) => m.type === type).pop(); }
function preparer(chemin) {
  hote.surMessage({ type: MSG.ACCUEIL_SUPPRIMER_PREPARER, chemin });
  return dernier(MSG.ACCUEIL_SUPPRIMER_PRET);
}
async function confirmer(chemin, mot) {
  await hote.confirmer(chemin, mot);
  return dernier(MSG.ACCUEIL_SUPPRIMER_FIN);
}

test('préparer : titre lisible, articles comptés, mot attendu et délai', () => {
  oublier();
  const n = numero('revue', '2026-01', ['alpha', 'beta', 'gamma']);
  const r = preparer(n);
  assert.equal(r.ok, true, r.texte);
  assert.equal(r.chemin, n);
  assert.equal(r.numero, '2026-01');
  assert.equal(r.titre, 'Essai 2026-01');
  assert.equal(r.articles, 3);
  assert.equal(r.mot, 'responsibilities');
  assert.equal(r.secondes, 10);
  const z = numero('zeitschrift', '2026-02', []);
  assert.equal(preparer(z).ok, true, 'un numéro de la Zeitschrift se supprime aussi');
  assert.equal(preparer(z).articles, 0);
});

test('préparer : un chemin inconnu, un archivé, un livre, un chemin vide sont refusés', () => {
  oublier();
  const refus = T('accueil.supprimer.refus.inconnu');
  const autre = path.join(TRAVAIL, 'ailleurs');
  fs.mkdirSync(autre, { recursive: true });
  fs.writeFileSync(path.join(autre, 'ausgabe.yaml'), 'revue: revue\n', 'utf8');
  // Archivé mais resté dans l'arborescence en cours : c'est encore une archive.
  const marque = numero('revue', '2025-03', ['a'], 'archived: true\n');
  for (const chemin of [autre, archive('2025-04'), marque, livre('2026-B1-essai'), '', undefined, 42,
    path.join(BASE, 'Revue'), path.join(BASE, 'Revue', '2026-01', 'articles')]) {
    const r = preparer(chemin);
    assert.equal(r.ok, false, 'accepté : ' + chemin);
    assert.equal(r.texte, refus);
  }
  assert.ok(fs.existsSync(autre));
});

test('confirmer : le mot, à la casse et aux espaces près, et rien d’autre', async () => {
  oublier();
  const n = numero('revue', '2026-03', ['a']);
  assert.equal(preparer(n).ok, true);
  horloge += 10000;
  for (const mot of ['responsibility', 'responsabilities', 'great responsibilities', '', null, undefined, 'responsibilitiess']) {
    const r = await confirmer(n, mot);
    assert.equal(r.ok, false, 'mot accepté : ' + mot);
    assert.equal(r.refus, true);
    assert.equal(r.texte, T('accueil.supprimer.refus.mot'));
  }
  assert.ok(fs.existsSync(n), 'un mot faux a supprimé le numéro');
  const r = await confirmer(n, '  ResponsiBILITIES ');
  assert.equal(r.ok, true, r.texte);
  assert.equal(fs.existsSync(n), false);
});

test('confirmer : refus avant 10 s depuis la préparation, accepté à 10 s', async () => {
  oublier();
  const n = numero('revue', '2026-04', ['a', 'b']);
  assert.equal(preparer(n).ok, true);
  horloge += 9999;
  const tot = await confirmer(n, 'responsibilities');
  assert.equal(tot.ok, false);
  assert.equal(tot.texte, T('accueil.supprimer.refus.delai', [10]));
  assert.ok(fs.existsSync(n));
  horloge += 1;
  const r = await confirmer(n, 'responsibilities');
  assert.equal(r.ok, true, r.texte);
  assert.equal(fs.existsSync(n), false);
});

test('confirmer : sans préparation, ou pour un autre chemin que celui préparé, refusé', async () => {
  oublier();
  const a = numero('revue', '2026-05', ['a']);
  const b = numero('revue', '2026-06', ['b']);
  hote.arreter();
  horloge += 20000;
  assert.equal((await confirmer(a, 'responsibilities')).texte, T('accueil.supprimer.refus.preparation'));
  assert.equal(preparer(a).ok, true);
  horloge += 20000;
  assert.equal((await confirmer(b, 'responsibilities')).texte, T('accueil.supprimer.refus.preparation'));
  // Une nouvelle préparation remplace l'ancienne et relance le délai.
  assert.equal(preparer(b).ok, true);
  assert.equal((await confirmer(a, 'responsibilities')).texte, T('accueil.supprimer.refus.preparation'));
  assert.equal((await confirmer(b, 'responsibilities')).texte, T('accueil.supprimer.refus.delai', [10]));
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});

test('verrou : un numéro gelé par ausgabe.yaml ou par ses réglages est refusé', async () => {
  oublier();
  const gele = numero('revue', '2026-07', ['a'], 'locked: true\n');
  const r = preparer(gele);
  assert.equal(r.ok, false);
  assert.equal(r.texte, T('accueil.supprimer.refus.verrou'));
  // Gelé entre la préparation et la confirmation.
  const n = numero('revue', '2026-08', ['a']);
  assert.equal(preparer(n).ok, true);
  fs.mkdirSync(path.join(n, '.vscode'));
  fs.writeFileSync(path.join(n, '.vscode', 'settings.json'), '{ "files.readonlyInclude": { "**": true } }\n', 'utf8');
  horloge += 10000;
  const c = await confirmer(n, 'responsibilities');
  assert.equal(c.ok, false);
  assert.equal(c.texte, T('accueil.supprimer.refus.verrou'));
  assert.ok(fs.existsSync(n));
});

test('co-édition : quelqu’un qui écrit dans le numéro bloque la suppression', async () => {
  oublier();
  const n = numero('revue', '2026-09', ['a']);
  const fichier = path.join(n, 'articles', 'a', 'a.md');
  const voisin = { utilisateur: 'Anne Voisine', poste: 'PC-VOISIN' };
  assert.equal(preparer(n).ok, true);
  assert.ok(coedition.poser(n, fichier, voisin, Date.now()).ok);
  try {
    horloge += 10000;
    const c = await confirmer(n, 'responsibilities');
    assert.equal(c.ok, false);
    assert.ok(c.texte.includes('Anne Voisine'), c.texte);
    assert.ok(fs.existsSync(fichier));
    assert.equal(preparer(n).ok, false, 'la préparation ne voit pas le bail');
  } finally { coedition.rendre(n, fichier, voisin); }
});

test('poste occupé ou numéro ouvert dans cette fenêtre : refusé', async () => {
  oublier();
  const n = numero('revue', '2026-10', ['a']);
  session.poserBuildEnCours(true);
  try { assert.equal(preparer(n).texte, T('statut.occupe')); }
  finally { session.poserBuildEnCours(false); }
  session.poserImportEnCours(true);
  try { assert.equal(preparer(n).texte, T('statut.occupe')); }
  finally { session.poserImportEnCours(false); }
  assert.equal(preparer(n).ok, true);
  ouverts = [n];
  horloge += 10000;
  const c = await confirmer(n, 'responsibilities');
  assert.equal(c.texte, T('accueil.supprimer.refus.ouvert'));
  assert.ok(fs.existsSync(n));
});

test('cas nominal : le dossier part, la page est rafraîchie, le journal du mois le note', async () => {
  oublier();
  const n = numero('zeitschrift', '2026-11', ['eins', 'zwei']);
  fs.writeFileSync(path.join(n, 'articles', 'eins', 'bild.png'), Buffer.from([1, 2, 3]));
  const p = preparer(n);
  assert.equal(p.ok, true);
  horloge += 10000;
  const r = await confirmer(n, 'responsibilities');
  assert.equal(r.ok, true, r.texte);
  assert.equal(r.texte, T('accueil.supprimer.ok', [p.numero]));
  assert.equal(fs.existsSync(n), false);
  assert.equal(rafraichis, 1);
  // La préparation est consommée : une seconde confirmation est refusée.
  horloge += 10000;
  assert.equal((await confirmer(n, 'responsibilities')).texte, T('accueil.supprimer.refus.preparation'));
  const logs = path.join(PROGRAMDATA, 'logs');
  const journal = fs.readdirSync(logs).filter((f) => /^szh-\d{4}-\d{2}\.log$/.test(f));
  assert.equal(journal.length, 1);
  const texte = fs.readFileSync(path.join(logs, journal[0]), 'utf8');
  assert.match(texte, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} {2}suppression-numero OK : .*\(2 article\(s\)\)\r?$/m);
  assert.ok(texte.includes(n));
});

test('échec : le chemin restant est dit, le journal note l’erreur', async () => {
  oublier();
  const n = numero('revue', '2026-12', ['a']);
  assert.equal(preparer(n).ok, true);
  horloge += 10000;
  const supprimer = require(path.join(COCKPIT, 'lib', 'supprimer.js'));
  const avant = fs.rmSync;
  fs.rmSync = () => { const e = new Error('EPERM: operation not permitted, unlink'); e.code = 'EPERM'; throw e; };
  let r;
  try { r = await confirmer(n, 'responsibilities'); }
  finally { fs.rmSync = avant; }
  assert.ok(supprimer.VERROUS_PASSAGERS.has('EPERM'));
  assert.equal(r.ok, false);
  assert.notEqual(r.refus, true);
  assert.ok(r.texte.includes(n), r.texte);
  assert.ok(r.texte.includes('EPERM'), r.texte);
  assert.ok(fs.existsSync(n));
  const logs = path.join(PROGRAMDATA, 'logs');
  const texte = fs.readdirSync(logs).map((f) => fs.readFileSync(path.join(logs, f), 'utf8')).join('');
  assert.match(texte, /suppression-numero ERREUR : /);
});
