// outils-dev/lexique/generer-lexique.py : lit pipeline/vale/lexique/lexique-{fr,de}.csv (la
// source de vérité éditable au tableur) et écrit le classeur xlsx, le TBX et les règles Vale
// générées (Coherence.yml, un Sigle-<SIGLE>.yml par sigle à exiger_developpement=oui). Ce
// fichier ne rejoue JAMAIS le vrai lexique (475/472 lignes, issu du corpus OJS — voir
// outils-dev/lexique/analyser-corpus.py) : un mini-CSV fabriqué ici, cinq lignes fr, deux
// lignes de, suffit à prouver le contrat sans dépendre d'un corpus qui n'est pas versionné
// (tmp/corpus-ojs est hors git).
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
  'sigle_developpement;statut;source_normative;exemple_1;exemple_2;note;exiger_developpement';

// Mêmes colonnes, mêmes séparateurs que pipeline/vale/lexique/lexique-fr.csv réel. CUA porte
// `exiger_developpement=oui` (doit produire Sigle-CUA.yml), OMS `non` (ne doit produire
// AUCUN fichier Sigle-OMS.yml — c'est exactement le garde-fou demandé par le superviseur :
// un sigle établi que le corpus ne redéveloppe pas assez souvent lui-même ne doit jamais
// entrer dans la règle, quel que soit son développement connu par ailleurs).
const LEXIQUE_FR = [
  ENTETE,
  'co-enseignement;ecole;co-enseignement;coenseignement;10;5;;privilegie;' +
    'lexique maison (test);;;;non',
  'élèves;ecole;élèves;élève;20;8;;a_trancher;;;;variante de nombre;non',
  'CUA;sigle;CUA;;15;6;conception universelle de l\'apprentissage;neutre;;;;;oui',
  'OMS;sigle;OMS;;3;2;Organisation mondiale de la santé;neutre;;;;' +
    'sigle établi, développement connu mais jamais exigé (preuve d\'usage insuffisante);non',
  'personne handicapée;handicap;personne handicapée;;4;3;;deconseille;' +
    'CSPS.Vocabulaire.Handicap;;;faux positif mesuré;non',
].join('\n') + '\n';

const LEXIQUE_DE = [
  ENTETE,
  'CUA;sigle;CUA;;9;4;conception universelle de l\'apprentissage;neutre;;;;;oui',
  'Schüler:innen;ecole;Schüler:innen;Schülerinnen und Schüler;12;5;;' +
    'privilegie;lexique maison (test);;;;non',
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

// ---- Sigle-<SIGLE>.yml : un fichier par sigle à `exiger_developpement=oui` (CUA), jamais
// un fichier générique à `%s` (mesuré en vrai : Vale 3.22.0 ne substitue pas `%s` dans
// `second`, voir generer-lexique.py). OMS (`exiger_developpement=non`, sabotage demandé par
// le superviseur : un sigle à `non` — même avec un développement connu par ailleurs — ne
// doit produire AUCUN fichier). ----

test('Sigle-CUA.yml existe (exiger_developpement=oui), aucun Sigle-OMS.yml (=non)',
  { skip: sansPython }, () => {
    const { stylesDir } = preparerEtLancer();
    const dossier = path.join(stylesDir, 'CSPS', 'Lexique');
    assert.ok(fs.existsSync(path.join(dossier, 'Sigle-CUA.yml')), 'Sigle-CUA.yml doit exister');
    const cua = fs.readFileSync(path.join(dossier, 'Sigle-CUA.yml'), 'utf8');
    assert.match(cua, /extends: conditional/);
    assert.match(cua, /\\bCUA\\b/);
    assert.ok(!fs.existsSync(path.join(dossier, 'Sigle-OMS.yml')),
      'un sigle à exiger_developpement=non ne doit produire aucun fichier Sigle-*.yml');
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
    for (const rel of [['CSPS', 'Coherence.yml'], ['CSPS', 'Sigle-CUA.yml'],
      ['SZH', 'Coherence.yml'], ['SZH', 'Sigle-CUA.yml']]) {
      const a = fs.readFileSync(path.join(styles1, rel[0], 'Lexique', rel[1]));
      const b = fs.readFileSync(path.join(styles2, rel[0], 'Lexique', rel[1]));
      assert.ok(a.equals(b), rel.join('/') + ' diffère entre les deux exécutions');
    }
    // le nettoyage (retrait des anciens Sigle-*.yml avant réécriture) est lui aussi
    // idempotent : la liste des fichiers du dossier doit être identique, pas seulement le
    // contenu de Sigle-CUA.yml.
    const listeFichiers = (d) => fs.readdirSync(path.join(d, 'CSPS', 'Lexique')).sort();
    assert.deepStrictEqual(listeFichiers(styles1), listeFichiers(styles2));
  });
