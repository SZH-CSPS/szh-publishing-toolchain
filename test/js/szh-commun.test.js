// pipeline/szh_commun.py : docx-meta.py, docx-tables.py, livre-scinder.py et reimporter.py
// recopiaient chacun la même fonction avertir() (préfixe propre à l'appelant, sinon
// identique). Ce fichier fixe ce que ces quatre points d'appel rendent AVANT le refactor
// (capturé en exécutant le code d'origine) et vérifie qu'ils rendent EXACTEMENT la même
// chose une fois qu'ils délèguent à szh_commun.avertir() : mêmes octets sur stderr, même
// contenu de journal, même comportement quand SZH_IMPORT_LOG est absente ou illisible.
//
//   node --test "test/js/*.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');

// python3, puis python — même repli que livre-scinder.test.js/reimport.test.js. Aucun saut
// silencieux : un contrôle qui mesure des octets ne doit pas passer au vert sans rien lancer.
function interpretePython() {
  for (const commande of ['python3', 'python']) {
    const r = cp.spawnSync(commande, ['--version'], { encoding: 'utf8' });
    if (!r.error && /Python 3/.test(String(r.stdout || '') + String(r.stderr || ''))) {
      return commande;
    }
  }
  return null;
}
const PYTHON = interpretePython();

// Arguments fixes, mêmes pour les quatre appelants : guillemets français, accents,
// apostrophe — de quoi voir un octet perdu ou une ré-encodure ratée.
const CODE = 'test-code';
const CHAMPS = ['article « essai »', 'champ « x »'];
const FR = 'Message français avec « guillemets » et accent éàü.';
const DE = 'Deutsche Meldung mit Anführungszeichen «» und Umlaut ÄÖÜ.';

// Capturé en exécutant, AVANT ce lot, la fonction avertir() propre à chaque fichier (recopiée
// trois fois à l'identique, préfixe [import-avertissement], plus la version scission de
// livre-scinder.py) sur les arguments ci-dessus. Toute divergence après refactor est un
// changement d'octets que l'interface du cockpit reçoit — voir la note de non-régression
// du lot.
const LIGNE_IMPORT = "[import-avertissement] test-code | article « essai » | champ « x » | "
  + "Message français avec « guillemets » et accent éàü. | [de] Deutsche Meldung mit "
  + "Anführungszeichen «» und Umlaut ÄÖÜ.";
const LIGNE_SCISSION = "[scission-avertissement] test-code | article « essai » | champ « x » | "
  + "Message français avec « guillemets » et accent éàü. | [de] Deutsche Meldung mit "
  + "Anführungszeichen «» und Umlaut ÄÖÜ.";

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-commun-'));
}

// Charge <nom_fichier> par CHEMIN (comme couverture.py le fait pour livre-assembler.py) et
// appelle avertir(CODE, CHAMPS, FR, DE) dessus, avec SZH_IMPORT_LOG posée sur `journal` (ou
// absente si `journal` est null). Rend { status, stdout, stderr }.
function appelerAvertirModule(nomFichier, journal) {
  const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
  if (journal !== null) { env.SZH_IMPORT_LOG = journal; } else { delete env.SZH_IMPORT_LOG; }
  const code = [
    'import importlib.util, os',
    'spec = importlib.util.spec_from_file_location("m", ' + JSON.stringify(
      path.join(PIPELINE, nomFichier)) + ')',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'm.avertir(' + JSON.stringify(CODE) + ', ' + JSON.stringify(CHAMPS) + ', '
      + JSON.stringify(FR) + ', ' + JSON.stringify(DE) + ')',
  ].join('\n');
  return normaliser(cp.spawnSync(PYTHON, ['-c', code], { encoding: 'utf8', env: env }));
}

// Un python natif Windows écrit stdout/stderr en CRLF (traduction de fin de ligne du mode
// texte, indépendante de ce que szh_commun.py écrit) : uniformisé ici, comme le fait déjà
// test/filtres-pandoc.test.js pour pandoc, pour que les comparaisons ne dépendent pas de la
// plateforme qui exécute ce fichier.
function normaliser(r) {
  r.stdout = (r.stdout || '').replace(/\r\n/g, '\n');
  r.stderr = (r.stderr || '').replace(/\r\n/g, '\n');
  return r;
}

// reimporter.py : avertir() est une méthode de Voix, et son journal est un chemin passé au
// CONSTRUCTEUR — jamais lu depuis SZH_IMPORT_LOG. On le vérifie explicitement : c'est la
// seule des quatre implémentations à diverger sur ce point, et le refactor ne doit pas
// gommer cette différence.
function appelerAvertirVoix(journal) {
  const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
  delete env.SZH_IMPORT_LOG;
  const code = [
    'import importlib.util, json',
    'spec = importlib.util.spec_from_file_location("m", ' + JSON.stringify(
      path.join(PIPELINE, 'reimporter.py')) + ')',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'v = m.Voix(' + JSON.stringify(journal || '') + ')',
    'v.avertir(' + JSON.stringify(CODE) + ', ' + JSON.stringify(CHAMPS) + ', '
      + JSON.stringify(FR) + ', ' + JSON.stringify(DE) + ')',
    'print("LIGNES=" + json.dumps(v.lignes))',
    'print("AVERTISSEMENTS=" + json.dumps(v.avertissements))',
  ].join('\n');
  return normaliser(cp.spawnSync(PYTHON, ['-c', code], { encoding: 'utf8', env: env }));
}

test('szh_commun : interprète Python 3 disponible', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé (python3, puis python) : ce contrôle '
    + 'mesure des octets produits par un sous-processus, il ne peut pas être sauté en silence');
});

// ---- Les trois fonctions module-level : même ligne, même journal ----

for (const [nomFichier, ligneAttendue] of [
  ['docx-meta.py', LIGNE_IMPORT],
  ['docx-tables.py', LIGNE_IMPORT],
  ['livre-scinder.py', LIGNE_SCISSION],
]) {
  test('szh_commun : ' + nomFichier + ' — la ligne sur stderr n’a pas bougé d’un octet', () => {
    if (!PYTHON) { return; }
    const dossier = dossierJetable();
    try {
      const journal = path.join(dossier, 'journal.log');
      const r = appelerAvertirModule(nomFichier, journal);
      assert.strictEqual(r.status, 0, nomFichier + ' a échoué : ' + r.stderr);
      assert.strictEqual(r.stderr.trim(), ligneAttendue,
        nomFichier + ' n’écrit plus la même ligne sur stderr');
      assert.strictEqual(fs.readFileSync(journal, 'utf8'), ligneAttendue + '\n',
        nomFichier + ' n’écrit plus la même ligne dans le journal');
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  });

  test('szh_commun : ' + nomFichier + ' — sans SZH_IMPORT_LOG, stderr seul, aucun échec', () => {
    if (!PYTHON) { return; }
    const r = appelerAvertirModule(nomFichier, null);
    assert.strictEqual(r.status, 0, nomFichier + ' a échoué sans journal : ' + r.stderr);
    assert.strictEqual(r.stderr.trim(), ligneAttendue);
  });

  test('szh_commun : ' + nomFichier + ' — un journal illisible n’interrompt pas l’appel', () => {
    if (!PYTHON) { return; }
    // Dossier inexistant : l'écriture échoue (OSError), avalée — l'appelant ne doit
    // jamais planter pour un journal qu'il ne peut pas écrire.
    const journalImpossible = path.join(dossierJetable(), 'dossier-absent', 'journal.log');
    const r = appelerAvertirModule(nomFichier, journalImpossible);
    assert.strictEqual(r.status, 0,
      nomFichier + ' échoue quand le journal est illisible : ' + r.stderr);
    assert.strictEqual(r.stderr.trim(), ligneAttendue);
  });
}

// ---- reimporter.py : Voix.avertir(), journal au constructeur ----

test('szh_commun : reimporter.py — la ligne sur stderr n’a pas bougé d’un octet', () => {
  if (!PYTHON) { return; }
  const dossier = dossierJetable();
  try {
    const journal = path.join(dossier, 'journal.log');
    const r = appelerAvertirVoix(journal);
    assert.strictEqual(r.status, 0, 'reimporter.py a échoué : ' + r.stderr);
    const premiereLigne = r.stderr.split('\n')[0];
    assert.strictEqual(premiereLigne, LIGNE_IMPORT,
      'reimporter.py n’écrit plus la même ligne sur stderr');
    assert.strictEqual(fs.readFileSync(journal, 'utf8'), LIGNE_IMPORT + '\n',
      'reimporter.py n’écrit plus la même ligne dans le journal du constructeur');
    // Bilan interne (Voix.lignes / Voix.avertissements) : ce que rendre() lit pour la
    // ligne JSON du cockpit ne doit pas non plus bouger.
    const ligneLignes = r.stdout.split('\n').find((l) => l.startsWith('LIGNES='));
    const ligneAvert = r.stdout.split('\n').find((l) => l.startsWith('AVERTISSEMENTS='));
    assert.deepStrictEqual(JSON.parse(ligneLignes.slice('LIGNES='.length)), [LIGNE_IMPORT],
      'Voix.lignes ne garde plus la ligne écrite');
    assert.deepStrictEqual(JSON.parse(ligneAvert.slice('AVERTISSEMENTS='.length)), [CODE],
      'Voix.avertissements ne garde plus le code');
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('szh_commun : reimporter.py — SZH_IMPORT_LOG posée n’a AUCUN effet (le journal vient du constructeur)', () => {
  if (!PYTHON) { return; }
  const dossier = dossierJetable();
  try {
    const journalConstructeur = path.join(dossier, 'constructeur.log');
    const journalEnvFantome = path.join(dossier, 'jamais-ecrit.log');
    const env = Object.assign({}, process.env, {
      PYTHONIOENCODING: 'utf-8', SZH_IMPORT_LOG: journalEnvFantome,
    });
    const code = [
      'import importlib.util',
      'spec = importlib.util.spec_from_file_location("m", ' + JSON.stringify(
        path.join(PIPELINE, 'reimporter.py')) + ')',
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'v = m.Voix(' + JSON.stringify(journalConstructeur) + ')',
      'v.avertir(' + JSON.stringify(CODE) + ', ' + JSON.stringify(CHAMPS) + ', '
        + JSON.stringify(FR) + ', ' + JSON.stringify(DE) + ')',
    ].join('\n');
    const r = normaliser(cp.spawnSync(PYTHON, ['-c', code], { encoding: 'utf8', env: env }));
    assert.strictEqual(r.status, 0, 'reimporter.py a échoué : ' + r.stderr);
    assert.strictEqual(fs.readFileSync(journalConstructeur, 'utf8'), LIGNE_IMPORT + '\n');
    assert.ok(!fs.existsSync(journalEnvFantome),
      'reimporter.py a lu SZH_IMPORT_LOG alors que son journal vient du constructeur');
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('szh_commun : reimporter.py — journal vide (constructeur) : aucune écriture tentée', () => {
  if (!PYTHON) { return; }
  const r = appelerAvertirVoix('');
  assert.strictEqual(r.status, 0, 'reimporter.py a échoué : ' + r.stderr);
  const premiereLigne = r.stderr.split('\n')[0];
  assert.strictEqual(premiereLigne, LIGNE_IMPORT);
});

// ---- Les préfixes des quatre appelants restent DISTINCTS où ils doivent l'être ----

test('szh_commun : docx-meta.py et docx-tables.py partagent le même préfixe que reimporter.py', () => {
  if (!PYTHON) { return; }
  const rMeta = appelerAvertirModule('docx-meta.py', null);
  const rTables = appelerAvertirModule('docx-tables.py', null);
  const rVoix = appelerAvertirVoix('');
  assert.strictEqual(rMeta.stderr.trim(), LIGNE_IMPORT);
  assert.strictEqual(rTables.stderr.trim(), LIGNE_IMPORT);
  assert.strictEqual(rVoix.stderr.split('\n')[0], LIGNE_IMPORT);
});

test('szh_commun : livre-scinder.py garde son propre préfixe « scission »', () => {
  if (!PYTHON) { return; }
  const r = appelerAvertirModule('livre-scinder.py', null);
  assert.strictEqual(r.stderr.trim(), LIGNE_SCISSION);
  assert.notStrictEqual(LIGNE_SCISSION, LIGNE_IMPORT);
});
