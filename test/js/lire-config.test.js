// pipeline/filters/szh-lire-config.lua : lit une clé de premier niveau d'un YAML « maison »
// (ausgabe.yaml, buch.yaml, une fiche <slug>.meta.yaml) sans PyYAML ni lyaml — ce que le
// Makefile et livre.mk faisaient jusqu'ici par sed/grep, chacun à sa façon, une seule forme
// comprise à la fois (PROFIL_LU, exiger_titre, ORDRE_LU).
//
//   node --test "test/js/*.test.js"
//
// Ce fichier vit sous test/js/ (le job `contrats` de la CI, sans chaîne PDF) : contrairement
// à test/filtres-pandoc.test.js, un pandoc absent se SAUTE, il ne fait pas échouer la suite —
// SZH_LUA_OBLIGATOIRE=1 en fait des échecs, comme test/js/ancrages.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(RACINE, 'pipeline', 'filters', 'szh-lire-config.lua');

// pandoc absent, ou trop ancien pour `pandoc lua` (sous-commande apparue en pandoc 3) :
// mémoïsé, comme pliageCasse() de test/filtres-pandoc.test.js.
let raisonAbsence;
function pandocLuaAbsent() {
  if (raisonAbsence !== undefined) { return raisonAbsence; }
  const r = spawnSync('pandoc', ['lua', '-e', 'print(1)'], { encoding: 'utf8' });
  if (r.error) {
    raisonAbsence = 'pandoc introuvable : ' + r.error.message;
  } else if (r.status !== 0 || r.stdout.trim() !== '1') {
    raisonAbsence = 'pandoc sans sous-commande « lua » exploitable (' + (r.stderr || '').trim() + ')';
  } else {
    raisonAbsence = null;
  }
  return raisonAbsence;
}

function sauterSiPandocAbsent(t) {
  const raison = pandocLuaAbsent();
  if (!raison) { return false; }
  const msg = 'szh-lire-config.lua non vérifié : ' + raison;
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail(msg); }
  console.warn('\n*** ' + msg + ' ***\n');
  t.skip(msg);
  return true;
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lire-config-'));
}

function ecrire(dossier, nom, contenu) {
  const chemin = path.join(dossier, nom);
  fs.writeFileSync(chemin, contenu);
  return chemin;
}

// Rend { stdout, status }. stdout n'a pas de fin de ligne (le script n'en écrit pas).
function lire(fichier, cle) {
  const r = spawnSync('pandoc', ['lua', SCRIPT, fichier, cle], { encoding: 'utf8' });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// ---- Scalaire ----

test('scalaire : nu, cité, et vide (clé présente, aucune valeur)', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml', 'profil: article\ntitre: "Santé psychique"\nvide:\n');
  assert.deepStrictEqual(lire(f, 'profil'), { stdout: 'article', stderr: '', status: 0 });
  assert.deepStrictEqual(lire(f, 'titre'), { stdout: 'Santé psychique', stderr: '', status: 0 });
  assert.deepStrictEqual(lire(f, 'vide'), { stdout: '', stderr: '', status: 0 });
});

test('scalaire : clé absente -> chaîne vide, code 1', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml', 'autre: 1\n');
  const r = lire(f, 'profil');
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.status, 1);
});

test('scalaire : guillemets simples, échappement dans un guillemet double', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml',
    "simple: 'texte'\nechappe: \"une \\\"citation\\\" ici\"\napostrophe: 'l''auteur'\n");
  assert.strictEqual(lire(f, 'simple').stdout, 'texte');
  assert.strictEqual(lire(f, 'echappe').stdout, 'une "citation" ici');
  assert.strictEqual(lire(f, 'apostrophe').stdout, "l'auteur");
});

test('scalaire : commentaire de fin de ligne coupé, valeur citée insensible au « # »', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml',
    'profil: article  # notes internes\ncouleur: "#5F9FBC"\n');
  assert.strictEqual(lire(f, 'profil').stdout, 'article');
  assert.strictEqual(lire(f, 'couleur').stdout, '#5F9FBC');
});

// ---- Liste en ligne ----

test('liste en ligne : éléments séparés par un espace, guillemets ôtés, liste vide', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml',
    "ordre-chapitres: [a, 'b-c', \"d e\"]\nliminaires: [demi-titre, colophon]\nrien: []\n");
  assert.strictEqual(lire(f, 'ordre-chapitres').stdout, 'a b-c d e');
  assert.strictEqual(lire(f, 'liminaires').stdout, 'demi-titre colophon');
  const r = lire(f, 'rien');
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.status, 0, 'une liste vide reste une clé PRÉSENTE : code 0');
});

// ---- Liste en blocs ----

test('liste en blocs : au fer à gauche, comme les fiches de la maison', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml',
    'ordre-chapitres:\n- 01-intro\n- 02-corps\n- 03-fin\napres: rien\n');
  assert.strictEqual(lire(f, 'ordre-chapitres').stdout, '01-intro 02-corps 03-fin');
  assert.strictEqual(lire(f, 'apres').stdout, 'rien',
    'la clé suivante ne doit pas être avalée par le bloc précédent');
});

test('liste en blocs : une ligne blanche ou un commentaire au milieu ne coupe pas la liste', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml',
    'ordre-chapitres:\n- 01-intro\n\n# un commentaire\n- 02-fin\n');
  assert.strictEqual(lire(f, 'ordre-chapitres').stdout, '01-intro 02-fin');
});

// ---- Map (title: multilingue) ----

test('map : la première valeur non vide, dans l’ordre du fichier', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml',
    'title:\n  fr: "Bonjour"\n  de: "Hallo"\ntitre-de-vide:\n  fr:\n  de: "Nur Deutsch"\n');
  assert.strictEqual(lire(f, 'title').stdout, 'Bonjour');
  assert.strictEqual(lire(f, 'titre-de-vide').stdout, 'Nur Deutsch',
    'la première sous-clé vide doit céder la place à la suivante, non vide');
});

test('map : toutes les sous-valeurs vides -> chaîne vide, code 0', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const f = ecrire(dossier, 'a.yaml', 'impression:\n  grammage:\n  dos-mm:\n');
  const r = lire(f, 'impression');
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.status, 0);
});

// ---- BOM, CRLF ----

test('BOM UTF-8 et CRLF : lus sans un octet de reste dans la valeur', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const dossier = dossierJetable();
  const chemin = path.join(dossier, 'a.yaml');
  fs.writeFileSync(chemin, '﻿profil: book\r\ntitle: "Avec BOM"\r\nliste:\r\n- un\r\n- deux\r\n');
  assert.strictEqual(lire(chemin, 'profil').stdout, 'book');
  assert.strictEqual(lire(chemin, 'title').stdout, 'Avec BOM');
  assert.strictEqual(lire(chemin, 'liste').stdout, 'un deux');
});

// ---- Fichier illisible ----

test('fichier introuvable : chaîne vide, code 1, jamais d’exception Lua', (t) => {
  if (sauterSiPandocAbsent(t)) { return; }
  const r = lire(path.join(dossierJetable(), 'absent.yaml'), 'profil');
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.stderr, '');
});
