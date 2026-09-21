// outils-dev/lexique/generer-lexique.py : lit pipeline/vale/lexique/lexique-{fr,de}.csv (la
// source de vérité éditable au tableur) et écrit le classeur xlsx, le TBX et les règles Vale
// générées (Coherence.yml, Sigle.yml). Ce fichier ne rejoue JAMAIS le vrai lexique (483/478
// lignes, issu du corpus OJS — voir outils-dev/lexique/analyser-corpus.py) : un mini-CSV
// fabriqué ici, cinq lignes fr, deux lignes de, suffit à prouver le contrat sans dépendre
// d'un corpus qui n'est pas versionné (tmp/corpus-ojs est hors git).
//
//   node --test "test/js/*.test.js"
//
// generer-lexique.py accepte --lexique-dir/--sortie/--styles-dir (ajoutés pour ce test :
// sans eux, il n'y aurait aucun moyen d'exercer le script sans écrire dans les vrais
// pipeline/vale/styles/{CSPS,SZH}/Lexique/ du dépôt).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const GENERER = path.join(RACINE, 'outils-dev', 'lexique', 'generer-lexique.py');

const ENTETE = 'terme;categorie;forme_privilegiee;variantes;frequence;documents;' +
  'sigle_developpement;statut;source_normative;exemple_1;exemple_2;note';

// Mêmes colonnes, mêmes séparateurs que pipeline/vale/lexique/lexique-fr.csv réel.
const LEXIQUE_FR = [
  ENTETE,
  'co-enseignement;ecole;co-enseignement;coenseignement;10;5;;privilegie;' +
    'lexique maison (test);;;',
  'élèves;ecole;élèves;élève;20;8;;a_trancher;;;;variante de nombre',
  'CUA;sigle;CUA;;15;6;conception universelle de l\'apprentissage;neutre;;;;',
  'OMS;sigle;OMS;;3;2;;neutre;;;;jamais développe dans le corpus',
  'personne handicapée;handicap;personne handicapée;;4;3;;deconseille;' +
    'CSPS.Vocabulaire.Handicap;;;faux positif mesuré',
].join('\n') + '\n';

const LEXIQUE_DE = [
  ENTETE,
  'CUA;sigle;CUA;;9;4;conception universelle de l\'apprentissage;neutre;;;;',
  'Schüler:innen;ecole;Schüler:innen;Schülerinnen und Schüler;12;5;;' +
    'privilegie;lexique maison (test);;;',
].join('\n') + '\n';

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}

function ecrireLexique() {
  const lexiqueDir = dossierJetable('szh-lexique-csv-');
  fs.writeFileSync(path.join(lexiqueDir, 'lexique-fr.csv'), LEXIQUE_FR, 'utf8');
  fs.writeFileSync(path.join(lexiqueDir, 'lexique-de.csv'), LEXIQUE_DE, 'utf8');
  return lexiqueDir;
}

function lancerGenerer(lexiqueDir, sortieDir, stylesDir) {
  return cp.spawnSync(PYTHON, [GENERER,
    '--lexique-dir', lexiqueDir, '--sortie', sortieDir, '--styles-dir', stylesDir],
    { encoding: 'utf8' });
}

function preparerEtLancer() {
  const lexiqueDir = ecrireLexique();
  const sortieDir = dossierJetable('szh-lexique-sortie-');
  const stylesDir = dossierJetable('szh-lexique-styles-');
  const r = lancerGenerer(lexiqueDir, sortieDir, stylesDir);
  assert.strictEqual(r.status, 0, 'generer-lexique.py a échoué : ' + r.stderr);
  return { lexiqueDir, sortieDir, stylesDir };
}

// ---- xlsx : quatre parties obligatoires + autoFilter, vérifiées avec zipfile/xml (Python
// stdlib — pas de dépendance Node à un lecteur zip). ----

const VERIFIER_XLSX = [
  'import sys, zipfile',
  'from xml.etree import ElementTree as ET',
  'chemin = sys.argv[1]',
  'z = zipfile.ZipFile(chemin)',
  'noms = set(z.namelist())',
  'obligatoires = ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]',
  'manquantes = [n for n in obligatoires if n not in noms]',
  'if manquantes:',
  '    print("MANQUANTES:" + ",".join(manquantes)); sys.exit(0)',
  'for n in noms:',
  '    if n.endswith(".xml") or n.endswith(".rels"):',
  '        ET.fromstring(z.read(n))',
  'sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8")',
  'print("AUTOFILTER:" + ("1" if "<autoFilter" in sheet else "0"))',
].join('\n');

function inspecterXlsx(chemin) {
  const r = cp.spawnSync(PYTHON, ['-c', VERIFIER_XLSX, chemin], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'lecture xlsx a échoué : ' + r.stderr);
  return r.stdout;
}

test('xlsx : les quatre parties obligatoires et un autoFilter sont présents',
  { skip: sansPython }, () => {
    const { sortieDir } = preparerEtLancer();
    const sortie = inspecterXlsx(path.join(sortieDir, 'lexique-fr.xlsx'));
    assert.ok(!sortie.includes('MANQUANTES'), sortie);
    assert.match(sortie, /AUTOFILTER:1/);
  });

// ---- TBX : XML bien formé, un termEntry par concept, langSet fr+de sur le concept partagé
// (CUA, apparié par sigle_developpement identique dans les deux CSV). ----

const VERIFIER_TBX = [
  'import sys',
  'from xml.etree import ElementTree as ET',
  'NS = "{urn:iso:std:iso:30042:ed-2}"',
  't = ET.parse(sys.argv[1])',
  'entries = t.getroot().findall(".//" + NS + "termEntry")',
  'print("ENTRIES:" + str(len(entries)))',
  'deux_langsets = 0',
  'statuts = []',
  'for e in entries:',
  '    ls = e.findall(NS + "langSet")',
  '    if len(ls) == 2:',
  '        deux_langsets += 1',
  '    for l in ls:',
  '        note = l.find(NS + "tig/" + NS + "termNote")',
  '        if note is not None:',
  '            statuts.append(note.text)',
  'print("DEUX_LANGSETS:" + str(deux_langsets))',
  'print("STATUTS:" + ",".join(sorted(set(statuts))))',
].join('\n');

test('tbx : bien formé, un termEntry par concept, le concept partagé porte fr+de',
  { skip: sansPython }, () => {
    const { sortieDir } = preparerEtLancer();
    const r = cp.spawnSync(PYTHON, ['-c', VERIFIER_TBX, path.join(sortieDir, 'lexique.tbx')],
      { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'lecture tbx a échoué : ' + r.stderr);
    // 5 lignes fr + 2 lignes de - 1 concept partagé (CUA) = 6 termEntry
    assert.match(r.stdout, /ENTRIES:6/);
    assert.match(r.stdout, /DEUX_LANGSETS:1/);
    assert.match(r.stdout, /preferredTerm-admn-sts/);
    assert.match(r.stdout, /deprecatedTerm-admn-sts/);
    assert.match(r.stdout, /admittedTerm-admn-sts/);
  });

// ---- Coherence.yml : seules les paires "privilegie" (co-enseignement, Schüler:innen) —
// jamais "élèves"/"élève" (a_trancher : un pluriel n'est pas une faute du singulier). ----

test('Coherence.yml (fr) : uniquement la paire privilegie, jamais la paire a_trancher',
  { skip: sansPython }, () => {
    const { stylesDir } = preparerEtLancer();
    const coherence = fs.readFileSync(
      path.join(stylesDir, 'CSPS', 'Lexique', 'Coherence.yml'), 'utf8');
    assert.match(coherence, /coenseignement/);
    assert.match(coherence, /co-enseignement/);
    assert.doesNotMatch(coherence, /élève(?!s)/,
      'la paire élèves/élève (a_trancher, variation de nombre) ne doit jamais apparaître');
  });

test('Coherence.yml (de) : la paire privilegie Schüler:innen est présente',
  { skip: sansPython }, () => {
    const { stylesDir } = preparerEtLancer();
    const coherence = fs.readFileSync(
      path.join(stylesDir, 'SZH', 'Lexique', 'Coherence.yml'), 'utf8');
    // re.escape() échappe aussi l'espace (spécial sous VERBOSE) : la clé générée porte donc
    // "\ " entre les mots, pas un espace nu — on vérifie la présence des deux mots plutôt
    // qu'une espace littérale entre eux.
    assert.match(coherence, /Schüler:innen/, 'la forme privilégiée doit apparaître en cible');
    assert.match(coherence, /Schülerinnen/, 'la variante (forme complète) doit apparaître en clé');
  });

// ---- Sigle.yml : le sigle avec un développement connu (CUA) est dans `first`, celui sans
// développement (OMS) n'y figure pas. ----

test('Sigle.yml : seul le sigle avec un développement connu entre dans `first`',
  { skip: sansPython }, () => {
    const { stylesDir } = preparerEtLancer();
    const sigle = fs.readFileSync(path.join(stylesDir, 'CSPS', 'Lexique', 'Sigle.yml'), 'utf8');
    assert.match(sigle, /CUA/);
    assert.doesNotMatch(sigle, /OMS/, 'un sigle sans développement connu ne doit pas être exigé');
  });

// ---- Idempotence : même CSV en entrée -> mêmes octets en sortie, deux exécutions. ----

test('idempotence : deux exécutions sur le même CSV produisent des fichiers identiques',
  { skip: sansPython }, () => {
    const lexiqueDir = ecrireLexique();
    const sortie1 = dossierJetable('szh-lexique-sortie1-');
    const styles1 = dossierJetable('szh-lexique-styles1-');
    const sortie2 = dossierJetable('szh-lexique-sortie2-');
    const styles2 = dossierJetable('szh-lexique-styles2-');
    assert.strictEqual(lancerGenerer(lexiqueDir, sortie1, styles1).status, 0);
    assert.strictEqual(lancerGenerer(lexiqueDir, sortie2, styles2).status, 0);
    for (const nom of ['lexique-fr.xlsx', 'lexique-de.xlsx', 'lexique.tbx',
      'accept-fr.txt', 'accept-de.txt']) {
      const a = fs.readFileSync(path.join(sortie1, nom));
      const b = fs.readFileSync(path.join(sortie2, nom));
      assert.ok(a.equals(b), nom + ' diffère entre les deux exécutions');
    }
    for (const rel of [['CSPS', 'Coherence.yml'], ['CSPS', 'Sigle.yml'],
      ['SZH', 'Coherence.yml'], ['SZH', 'Sigle.yml']]) {
      const a = fs.readFileSync(path.join(styles1, rel[0], 'Lexique', rel[1]));
      const b = fs.readFileSync(path.join(styles2, rel[0], 'Lexique', rel[1]));
      assert.ok(a.equals(b), rel.join('/') + ' diffère entre les deux exécutions');
    }
  });
