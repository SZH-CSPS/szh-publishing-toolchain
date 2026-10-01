// pipeline/manuscrit-nettoyer.py : l'objet `compteurs` de la ligne stdout et le plantage rattrapé
// (§8 de outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md). Deux promesses, une seule
// menace : qu'un mot du manuscrit sorte de la CLI par ce canal.
//
//   1. `compteurs` ne porte que des noms de mesure d'une liste blanche et des entiers, plus un
//      `passage` (12 hexadécimaux du SHA-256 du fichier d'entrée) -- jamais le titre, les
//      auteurs, les courriels, le nom du fichier, ni le message d'une exception ;
//   2. une exception Python non rattrapée ne sort plus en code 1 (confondu avec « alertes
//      error ») : principal() la rattrape, écrit UNE ligne JSON `{plantage, type, lieu,
//      etape, ...}` et sort en code 4. Le message de l'exception n'y figure jamais.
//
// Le manuscrit fabriqué, son nom de fichier et l'exception provoquée portent chacun une
// SENTINELLE unique ; le test cherche chaque sentinelle, en casse pliée, dans ce que la CLI
// met à la disposition du lanceur.
//
//   node --test test/js/manuscrit-compteurs.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { python, cheminPython, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const NETTOYEUR = path.join(PIPELINE, 'manuscrit-nettoyer.py');
const SOURCE_CLI = fs.readFileSync(NETTOYEUR, 'utf8');
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
const PYTHON_OPTS = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 };
delete ENV_UTF8.SZH_NETTOYEUR_TRACE;

const S_TITRE = 'SENTINELLE-TITRE-51ab';
const S_AUTEUR = 'SENTINELLEAUTEUR-27c3';
const S_INSTITUTION = 'SENTINELLEINSTITUTION-9d0e';
const S_COURRIEL = 'sentinelle.courriel.4f8a@example.org';
const S_FICHIER = 'SENTINELLE-FICHIER-e7d2';
const S_EXCEPTION = 'SENTINELLE-EXCEPTION-b19c';
const SENTINELLES = [S_TITRE, S_AUTEUR, S_INSTITUTION, S_COURRIEL, S_FICHIER, S_EXCEPTION];

function contientSentinelle(texte) {
  const bas = String(texte).toLowerCase();
  return SENTINELLES.filter((s) => bas.includes(s.toLowerCase()));
}

function lancerPython(args, opts) {
  return python(args,
    Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 }, opts || {}));
}

function dossierJetable() { return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-compteurs-cli-')); }

// Un .docx minimal, fabriqué par un petit programme Python (aucune fixture binaire figée).
const FABRIQUER = [
  'import json, sys, zipfile',
  'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'def para(p):',
  '    st = (\'<w:pPr><w:pStyle w:val="%s"/></w:pPr>\' % p["style"]) if p.get("style") else ""',
  '    run = \'<w:r><w:t xml:space="preserve">%s</w:t></w:r>\' % p["texte"]',
  '    if p.get("revision"):',
  '        run = \'<w:ins w:id="1" w:author="essai" w:date="2026-01-01T00:00:00Z">%s</w:ins>\' % run',
  '    return "<w:p>%s%s</w:p>" % (st, run)',
  'doc = (\'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s"><w:body>%s</w:body>\'',
  '       \'</w:document>\') % (W, "".join(para(p) for p in paras))',
  'styles = \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">\' % W',
  'for sid, nom in (("Heading1", "heading 1"), ("Normal", "Normal")):',
  '    styles += \'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' % (sid, nom)',
  'styles += "</w:styles>"',
  'ct = (\'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"\'',
  '      \'></Types>\')',
  'with zipfile.ZipFile(chemin, "w") as z:',
  '    z.writestr("word/document.xml", doc.encode("utf-8"))',
  '    z.writestr("word/styles.xml", styles.encode("utf-8"))',
  '    z.writestr("[Content_Types].xml", ct)'
].join('\n');

function fabriquer(chemin, paragraphes) {
  const r = lancerPython(['-c', FABRIQUER, chemin, JSON.stringify(paragraphes)], PYTHON_OPTS);
  assert.strictEqual(r.status, 0, 'fabrication impossible : ' + r.stderr);
}

// Un manuscrit dont le titre, l'auteur, l'institution et le courriel sont des sentinelles.
function manuscritSentinelle() {
  return [
    { texte: 'Titre ' + S_TITRE + ' sur la pedagogie specialisee', style: 'Heading1' },
    { texte: 'Jeanne ' + S_AUTEUR },
    { texte: 'Universite ' + S_INSTITUTION + ', Lausanne' },
    { texte: S_COURRIEL },
    { texte: 'Resume : Un texte beaucoup trop court pour la fourchette attendue.' },
    { texte: 'Mots-cles : pedagogie, inclusion.' },
    { texte: 'Un premier paragraphe de corps ordinaire qui cite Dupont (2020) et ' + S_TITRE + '.' },
    { texte: 'References', style: 'Heading1' },
    { texte: 'Dupont, J. (2020). Un ouvrage important. Editions Test.' },
    { texte: 'Martin, A. (2018). Un autre ouvrage. Editions Test.' }
  ];
}

function sha12(chemin) {
  return crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex').slice(0, 12);
}

function ligneUnique(stdout) {
  const lignes = stdout.split('\n').filter((l) => l.length > 0);
  assert.strictEqual(lignes.length, 1, 'stdout doit porter EXACTEMENT une ligne : ' + JSON.stringify(lignes));
  return JSON.parse(lignes[0]);
}

// La liste blanche, relue dans la source de la CLI (un test de parité la compare à
// lib/compteurs.js dans compteurs-ps.test.js).
const MESURES = [...(/MESURES_NETTOYEUR = \(([\s\S]*?)\)\n/.exec(SOURCE_CLI)[1]).matchAll(/'([^']*)'/g)].map((m) => m[1]);
const MOTIFS_LIBRES = [/^issue\.refus:[a-z0-9_-]{1,48}$/, /^titres\.[a-z0-9_]{1,40}$/];
const RE_REGLE = /^regle:(Autre|[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+):(revision|commentaire|rapport)$/;

function verifierCompteurs(c, passageAttendu) {
  assert.deepStrictEqual(Object.keys(c).sort(), ['mesures', 'passage']);
  assert.match(c.passage, /^[0-9a-f]{12}$/);
  if (passageAttendu !== undefined) { assert.strictEqual(c.passage, passageAttendu); }
  const noms = Object.keys(c.mesures);
  assert.ok(noms.length > 0);
  for (const nom of noms) {
    const v = c.mesures[nom];
    assert.ok(Number.isInteger(v) && v > 0, nom + ' : entier positif attendu, obtenu ' + JSON.stringify(v));
    assert.match(String(v), /^\d+$/);
    const admis = RE_REGLE.test(nom) || MESURES.includes(nom) || MOTIFS_LIBRES.some((re) => re.test(nom));
    assert.ok(admis, nom + ' : hors de la liste blanche');
  }
}

// ---------------------------------------------------------------------------------------
// 1. Un passage réussi : l'objet `compteurs`, sans un mot du manuscrit
// ---------------------------------------------------------------------------------------

// Sabotage : dans _mesures_passage(), poser `m['titres.' + entete.titre] = 1` (le titre comme nom
// de mesure) -- la liste blanche l'écarte ; retirer aussi le filtre de _compteurs() et la sentinelle
// du titre sort dans `compteurs`.
test('un passage réussi : compteurs = noms de la liste blanche et entiers, passage = SHA-256 du fichier, aucune sentinelle', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, S_FICHIER + '.docx');
      fabriquer(entree, manuscritSentinelle());
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = lancerPython([NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau', '--sans-typo'], PYTHON_OPTS);
      assert.ok(r.status === 0 || r.status === 1, 'code de sortie inattendu ' + r.status + ' : ' + r.stderr);
      const obj = ligneUnique(r.stdout);
      assert.ok(obj.compteurs, 'la ligne stdout doit porter `compteurs`');
      verifierCompteurs(obj.compteurs, sha12(entree));
      const m = obj.compteurs.mesures;
      assert.ok(m['issue.ok'] === 1 || m['issue.alertes'] === 1, 'une issue');
      assert.strictEqual(r.status === 0 ? 'issue.ok' : 'issue.alertes', m['issue.ok'] ? 'issue.ok' : 'issue.alertes');
      assert.strictEqual(m['produit.revue'], 1);
      assert.ok(m['cas.a'] === 1 || m['cas.b'] === 1);
      assert.ok(m.duree_ms > 0 && m.signes > 0 && m.paragraphes > 0, JSON.stringify(m));
      assert.ok(m.references >= 2, 'deux références dans la bibliographie : ' + JSON.stringify(m));
      // Chaque alerte est comptée une fois, sous `regle:<Id>:<devenir>`.
      const parRegle = Object.keys(m).filter((k) => k.startsWith('regle:')).reduce((s, k) => s + m[k], 0);
      assert.strictEqual(parRegle, obj.alertes_total, 'la somme des regle:* égale le total des alertes');
      assert.deepStrictEqual(contientSentinelle(JSON.stringify(obj.compteurs)), [],
        'une sentinelle est sortie dans compteurs : ' + JSON.stringify(obj.compteurs));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('les mesures sortent des nombres, pas des textes : deux passages du même fichier donnent le même passage et les mêmes compteurs (hors durée)', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'a.docx');
      fabriquer(entree, manuscritSentinelle());
      const faire = () => {
        const sortie = fs.mkdtempSync(path.join(base, 'o-'));
        return ligneUnique(python([NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau', '--sans-typo'], PYTHON_OPTS).stdout).compteurs;
      };
      const un = faire();
      const deux = faire();
      assert.strictEqual(un.passage, deux.passage);
      delete un.mesures.duree_ms;
      delete deux.mesures.duree_ms;
      assert.deepStrictEqual(un.mesures, deux.mesures);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 2. Les refus portent eux aussi un objet `compteurs`
// ---------------------------------------------------------------------------------------

test('refus : suivi-modifications, fichier-verrou, extension-inconnue et lecture-impossible portent issue.refus:<code> ; aucune sentinelle', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const cas = [];
      const suivi = path.join(base, S_FICHIER + '-suivi.docx');
      fabriquer(suivi, [{ texte: S_TITRE }, { texte: 'Texte ajoute ' + S_AUTEUR, revision: true }]);
      cas.push([suivi, 'suivi-modifications', 2]);
      cas.push([path.join(base, '~$' + S_FICHIER + '.docx'), 'fichier-verrou', 2]);
      const inconnu = path.join(base, S_FICHIER + '.pdf');
      fs.writeFileSync(inconnu, S_TITRE);
      cas.push([inconnu, 'extension-inconnue', 2]);
      const abime = path.join(base, S_FICHIER + '-abime.docx');
      fs.writeFileSync(abime, 'ceci n\u2019est pas un zip ' + S_EXCEPTION);
      cas.push([abime, 'lecture-impossible', 3]);
      for (const [entree, code, sortieAttendue] of cas) {
        const r = lancerPython([NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau'], PYTHON_OPTS);
        assert.strictEqual(r.status, sortieAttendue, code + ' : ' + r.stderr);
        const obj = ligneUnique(r.stdout);
        assert.strictEqual(obj.code_refus, code);
        assert.ok(obj.compteurs, code + ' : compteurs absent');
        verifierCompteurs(obj.compteurs, fs.existsSync(entree) ? sha12(entree) : '000000000000');
        assert.strictEqual(obj.compteurs.mesures['issue.refus:' + code], 1);
        assert.strictEqual(obj.compteurs.mesures['produit.revue'], 1);
        assert.deepStrictEqual(contientSentinelle(JSON.stringify(obj.compteurs)), [], code);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 3. Le plantage : une exception Python rattrapée, le message jamais recopié
// ---------------------------------------------------------------------------------------

// Un pilote qui remplace UNE fonction de la chaîne par une fonction qui lève, puis appelle
// principal() -- le code de production n'est jamais modifié pour le faire échouer.
const PILOTE_PLANTAGE = [
  'import importlib.util, sys',
  'pipeline, entree, sortie, module, fonction, exception, message = sys.argv[1:8]',
  'sys.path.insert(0, pipeline)',
  'spec = importlib.util.spec_from_file_location("nettoyeur", pipeline + "/manuscrit-nettoyer.py")',
  'mod = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(mod)',
  'def boom(*a, **k):',
  '    raise getattr(__builtins__, exception)(message) if hasattr(__builtins__, exception) else '
    + 'getattr(sys.modules["builtins"], exception)(message)',
  'setattr(getattr(mod, module), fonction, boom)',
  'sys.exit(mod.principal(["manuscrit-nettoyer.py", entree, "--produit", "revue", "--sortie", sortie,'
    + ' "--sans-reseau", "--sans-typo"]))'
].join('\n');

function planter(base, module, fonction, exception, env) {
  const entree = path.join(base, S_FICHIER + '.docx');
  fabriquer(entree, manuscritSentinelle());
  const sortie = path.join(base, 'sortie');
  fs.mkdirSync(sortie, { recursive: true });
  const r = lancerPython(['-c', PILOTE_PLANTAGE, PIPELINE, entree, sortie, module, fonction, exception,
    'le message cite ' + S_EXCEPTION + ' et ' + S_TITRE + ' dans ' + entree],
  { env: Object.assign({}, ENV_UTF8, env || {}) });
  return { r, entree, sortie };
}

// Sabotage : retirer le `except Exception` de principal() (la sortie redevient le code 1 de
// Python, sans JSON) ; ou remplacer `type(exc).__name__` par `str(exc)` ET retirer le motif
// _RE_TYPE_EXCEPTION -- la sentinelle de l'exception sort sur stdout.
test('une exception non rattrapée : code 4, UNE ligne JSON {plantage, type, lieu, etape}, jamais le message ni le nom de fichier', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const { r, entree } = planter(base, 'mm', 'nettoyer_mise_en_forme', 'RuntimeError');
      assert.strictEqual(r.status, 4, 'code de sortie propre au plantage : ' + r.stderr);
      const obj = ligneUnique(r.stdout);
      assert.deepStrictEqual(Object.keys(obj).sort(), ['code_sortie', 'compteurs', 'etape', 'lieu', 'plantage', 'type']);
      assert.strictEqual(obj.plantage, true);
      assert.strictEqual(obj.type, 'RuntimeError');
      assert.strictEqual(obj.code_sortie, 4);
      assert.match(obj.lieu, /^manuscrit-nettoyer\.py:\d{1,6}$/, 'le dernier cadre d’un fichier du dépôt');
      assert.strictEqual(obj.etape, 'formatage');
      verifierCompteurs(obj.compteurs, sha12(entree));
      assert.strictEqual(obj.compteurs.mesures['issue.plantage'], 1);
      assert.strictEqual(obj.compteurs.mesures['produit.revue'], 1);
      assert.deepStrictEqual(contientSentinelle(r.stdout), [], 'stdout ne porte aucune sentinelle : ' + r.stdout);
      assert.ok(!r.stdout.includes(os.tmpdir()), 'aucun chemin sur stdout');
      // Le message n'est pas non plus sur stderr, sauf demande explicite.
      assert.ok(!contientSentinelle(r.stderr).includes(S_EXCEPTION), 'le message de l’exception est sur stderr : ' + r.stderr);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('plantage : le type vient de la classe (KeyError), le lieu du fichier du dépôt qui a appelé, l’étape de l’endroit atteint', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const { r } = planter(base, 'mr', 'evaluer', 'KeyError');
      assert.strictEqual(r.status, 4, r.stderr);
      const obj = ligneUnique(r.stdout);
      assert.strictEqual(obj.type, 'KeyError');
      assert.strictEqual(obj.etape, 'regles');
      assert.match(obj.lieu, /^manuscrit-nettoyer\.py:\d+$/);
      assert.deepStrictEqual(contientSentinelle(r.stdout), []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Le lieu est le DERNIER cadre d'un fichier du dépôt : une exception levée au fond d'un module
// (ici manuscrit_modele.py, appelé de travers) se localise dans ce module, pas dans l'appelant.
test('plantage : une exception levée dans un autre module du dépôt est localisée dans CE module (fichier:ligne)', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, S_FICHIER + '.docx');
      fabriquer(entree, manuscritSentinelle());
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const pilote = PILOTE_PLANTAGE.replace('setattr(getattr(mod, module), fonction, boom)',
        'setattr(getattr(mod, module), fonction, lambda *a, **k: mod.mm.classer_titres(None))');
      const r = lancerPython(['-c', pilote, PIPELINE, entree, sortie, 'mm', 'nettoyer_mise_en_forme', 'RuntimeError', S_EXCEPTION], PYTHON_OPTS);
      assert.strictEqual(r.status, 4, r.stderr);
      const obj = ligneUnique(r.stdout);
      assert.strictEqual(obj.type, 'AttributeError');
      assert.match(obj.lieu, /^manuscrit_modele\.py:\d{1,6}$/);
      assert.deepStrictEqual(contientSentinelle(r.stdout), []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('plantage : la trace complète n’apparaît que sur demande (SZH_NETTOYEUR_TRACE), sur stderr, jamais sur stdout', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const { r } = planter(base, 'mm', 'nettoyer_mise_en_forme', 'RuntimeError', { SZH_NETTOYEUR_TRACE: '1' });
      assert.strictEqual(r.status, 4);
      assert.match(r.stderr, /Traceback/);
      assert.ok(contientSentinelle(r.stderr).includes(S_EXCEPTION), 'avec la trace demandée, le message est sur stderr');
      assert.deepStrictEqual(contientSentinelle(r.stdout), [], 'mais jamais sur stdout');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('plantage : le code 4 est distinct de 0, 1, 2 et 3 ; la fonction qui lève est une exception de la chaîne, pas un refus', { skip: sansPython }, () => {
    const m = /CODE_OK = (\d)\nCODE_ALERTE_ERROR = (\d)\nCODE_REFUS = (\d)\nCODE_ECHEC_INTERNE = (\d)[\s\S]*?CODE_PLANTAGE = (\d)/.exec(SOURCE_CLI);
    assert.ok(m, 'les cinq codes de sortie se lisent en tête de la CLI');
    const codes = m.slice(1).map(Number);
    assert.strictEqual(new Set(codes).size, 5, 'cinq codes distincts : ' + codes);
    assert.strictEqual(codes[4], 4);
  });

// ---------------------------------------------------------------------------------------
// 4. Les constructeurs, isolés
// ---------------------------------------------------------------------------------------

const PILOTE_UNITAIRE = [
  'import importlib.util, json, sys',
  'pipeline = sys.argv[1]',
  'sys.path.insert(0, pipeline)',
  'spec = importlib.util.spec_from_file_location("nettoyeur", pipeline + "/manuscrit-nettoyer.py")',
  'mod = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(mod)',
  'entree = json.loads(sys.argv[2])',
  'sortie = {}',
  'sortie["compteurs"] = mod._compteurs(entree["passage"], entree["mesures"])',
  'sortie["regles"] = [mod._mesure_regle(i, d) for i, d in entree["regles"]]',
  'print(json.dumps(sortie))'
].join('\n');

test('_compteurs : liste blanche par le nom et par le type (entiers positifs seulement), zéros omis, Id de règle inconnu -> Autre, doublons additionnés', { skip: sansPython }, () => {
    const mesures = {
      'issue.ok': 1, 'signes': 120, 'duree_ms': 0, 'notes': 2,
      'Majuscule': 3, 'issue.ok.extra': 1, 'paragraphes': '12', 'images': 1.5, 'references': -4,
      'cas.b': true, 'perte_mots': null, 'titres.promus': 2, 'titres.Promus': 2, 'tres.x': 9,
      'issue.refus:suivi-modifications': 1, 'issue.refus:SENTINELLE': 1,
      [S_TITRE.toLowerCase()]: 5, ['issue.refus:' + 'a'.repeat(49)]: 1,
      'regle:APA.CitationAbsente:revision': 2, 'regle:texte libre:revision': 1,
      'regle:x.y:revision': 4, 'regle:APA.CitationAbsente:inconnu': 1
    };
    const regles = [['APA.CitationAbsente', 'revision'], ['texte libre', 'commentaire'], [null, 'rapport'],
      ['SZH.Epicene', 'devenir-inconnu'], ['A' + 'b'.repeat(70) + '.C', 'revision'], ['APA', 'revision']];
    const r = lancerPython(['-c', PILOTE_UNITAIRE, PIPELINE, JSON.stringify({ passage: 'abcdef012345', mesures, regles })], PYTHON_OPTS);
    assert.strictEqual(r.status, 0, r.stderr);
    const sortie = JSON.parse(r.stdout);
    assert.deepStrictEqual(sortie.compteurs, {
      passage: 'abcdef012345',
      mesures: {
        'issue.ok': 1, 'issue.refus:suivi-modifications': 1, 'notes': 2, 'regle:APA.CitationAbsente:revision': 2,
        'signes': 120, 'titres.promus': 2
      }
    });
    assert.deepStrictEqual(sortie.regles, [
      'regle:APA.CitationAbsente:revision', 'regle:Autre:commentaire', 'regle:Autre:rapport',
      'regle:SZH.Epicene:rapport', 'regle:Autre:revision', 'regle:Autre:revision'
    ]);
  });

test('_compteurs : un passage qui n’est pas 12 hexadécimaux devient 000000000000, jamais recopié', { skip: sansPython }, () => {
  for (const passage of [S_FICHIER, 'ABCDEF012345', 'abcdef01234', 'abcdef0123456', 'abcdef012345\n']) {
    const r = lancerPython(['-c', PILOTE_UNITAIRE, PIPELINE, JSON.stringify({ passage, mesures: { 'issue.ok': 1 }, regles: [] })]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).compteurs.passage, '000000000000', JSON.stringify(passage));
  }
});

// ---------------------------------------------------------------------------------------
// 5. Étapes : le seul vocabulaire qu'un plantage peut employer
// ---------------------------------------------------------------------------------------

// Sabotage : écrire `_etape('ecriture-docx')` quelque part -- le nom n'est pas dans ETAPES et
// l'étape rendue devient « inconnue » ; ce test le signale avant.
test('chaque _etape("...") de la CLI nomme une étape de ETAPES, et ETAPES ne porte que des slugs', { skip: sansPython }, () => {
  const liste = [...(/ETAPES = \(([\s\S]*?)\n\)/.exec(SOURCE_CLI)[1]).matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(liste.length >= 15);
  for (const e of liste) { assert.match(e, /^[a-z0-9-]{1,40}$/); }
  const appels = [...SOURCE_CLI.matchAll(/_etape\('([^']*)'\)/g)].map((m) => m[1]);
  assert.ok(appels.length >= 15, 'au moins quinze appels _etape : ' + appels.length);
  for (const a of appels) { assert.ok(liste.includes(a), a + ' n’est pas dans ETAPES'); }
  for (const utile of ['lecture', 'formatage', 'regles', 'ecriture', 'annotation', 'rapport']) {
    assert.ok(appels.includes(utile), 'l’étape ' + utile + ' doit être posée');
  }
});

test('principal() : le try global rattrape Exception (jamais BaseException : Ctrl+C et sys.exit passent)', { skip: sansPython }, () => {
  const m = /def principal\(argv\):[\s\S]*?\n\n\ndef _plantage/.exec(SOURCE_CLI);
  assert.ok(m, 'principal() se lit encore');
  assert.match(m[0], /except Exception as e:\s+return _plantage\(e\)/);
  assert.ok(!/except BaseException|except:/.test(m[0]));
});

// ---------------------------------------------------------------------------------------
// 6. reseau.*.panne : une VRAIE panne, pas un DOI inconnu
// ---------------------------------------------------------------------------------------

// Mesuré le 01.10.2026 sur un manuscrit réel : 4 DOI consultés, 2 confirmés, et
// stats['crossref']['indisponible'] vrai alors que le réseau répondait (un DOI inconnu, en 404,
// suffit). Le compteur doit suivre `_hors_service` (panne du réseau), pas ce drapeau-là.
//
// Sabotage : dans _mesures_passage(), remplacer `mb._hors_service` par
// `(stats_biblio.get('crossref') or {}).get('indisponible')` -- le cas 404 lève la mesure.
const PILOTE_RESEAU = [
  'import importlib.util, sys, urllib.error, urllib.request',
  'pipeline, entree, sortie, mode = sys.argv[1:5]',
  'sys.path.insert(0, pipeline)',
  'spec = importlib.util.spec_from_file_location("nettoyeur", pipeline + "/manuscrit-nettoyer.py")',
  'mod = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(mod)',
  'def panne(*a, **k):',
  '    raise OSError("reseau coupe")',
  'def inconnu(requete, *a, **k):',
  '    raise urllib.error.HTTPError(getattr(requete, "full_url", str(requete)), 404, "nf", {}, None)',
  'urllib.request.urlopen = panne if mode == "panne" else inconnu',
  'sys.exit(mod.principal(["manuscrit-nettoyer.py", entree, "--produit", "revue", "--sortie", sortie,'
    + ' "--sans-typo", "--sans-annotation"]))'
].join('\n');

function passageReseau(mode) {
  const base = dossierJetable();
  try {
    const entree = path.join(base, S_FICHIER + '.docx');
    const paras = manuscritSentinelle();
    paras.push({ texte: 'Dupont, J. (2021). Un article. Revue Test, 3(1), 1-10. https://doi.org/10.1000/inconnu.42' });
    fabriquer(entree, paras);
    const sortie = path.join(base, 'sortie');
    fs.mkdirSync(sortie);
    const r = lancerPython(['-c', PILOTE_RESEAU, PIPELINE, entree, sortie, mode], PYTHON_OPTS);
    assert.ok(r.status === 0 || r.status === 1, 'code ' + r.status + ' : ' + r.stderr);
    const obj = ligneUnique(r.stdout);
    verifierCompteurs(obj.compteurs);
    return obj.compteurs.mesures;
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('reseau.crossref.panne : levée par une coupure du réseau, jamais par un DOI inconnu (404)', { skip: sansPython }, () => {
  const panne = passageReseau('panne');
  assert.strictEqual(panne['reseau.crossref.panne'], 1, JSON.stringify(panne));
  const inconnu = passageReseau('404');
  assert.strictEqual(inconnu['reseau.crossref.panne'], undefined, JSON.stringify(inconnu));
  assert.strictEqual(inconnu['reseau.ror.panne'], undefined);
  assert.strictEqual(inconnu['reseau.orcid.panne'], undefined);
});
