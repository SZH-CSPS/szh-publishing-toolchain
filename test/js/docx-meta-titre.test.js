// Le titre à deux-points dans pipeline/docx-meta.py : « Inclusion scolaire : le rôle de
// l'enseignant », écrit sur une ligne sans paragraphe Untertitel, est coupé en titre et
// sous-titre, que la maquette compose différemment et que l'export envoie séparément.
//
// Trois contrôles :
//   1. scinder_titre() seule, sur ce qui se coupe et ce qui ne se coupe pas (heures, URL,
//      titres numérotés) ;
//   2. l'import : trois .docx fabriqués ici, docx-meta.py lancé dessus, la fiche relue. Un
//      titre qui a déjà un sous-titre stylé reste tel quel ;
//   3. le constat à l'écran, en fr et en de, avec le bouton qui ouvre le champ « titre »
//      pour défaire la coupe.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chargerAvecVscodeFactice } = require('./dom-minimal');
const { python, sansPython, cheminPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const DOCX_META = path.join(RACINE, 'pipeline', 'docx-meta.py');
const ENV = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-titre-'));
}

// ---- 1. La fonction seule --------------------------------------------------------
//
// Chargée par son chemin : docx-meta.py n'est pas un module importable par son nom. Le texte
// passe d'abord par normaliser(), comme à l'import : l'insécable devant le deux-points y
// devient une espace ordinaire.

const CAS_SCISSION = [
  // [titre lu dans le Word, titre attendu, sous-titre attendu]
  ['Inclusion scolaire : le rôle de l’enseignant',
    'Inclusion scolaire', 'le rôle de l’enseignant'],
  ['Frühförderung: Wege in die Praxis', 'Frühförderung', 'Wege in die Praxis'],
  // Deux deux-points : le premier coupe, le second reste dans le sous-titre.
  ['Dossier : inclusion : ce qui change', 'Dossier', 'inclusion : ce qui change'],
  // Rien à scinder.
  ['Un titre sans deux-points', 'Un titre sans deux-points', ''],
  // Le deux-points collé à ce qui suit n'est pas une scission : heures, rapports, URL.
  ['Rendez-vous à 10:30 au collège', 'Rendez-vous à 10:30 au collège', ''],
  ['Voir https://szh.ch pour la suite', 'Voir https://szh.ch pour la suite', ''],
  ['L’école:demain', 'L’école:demain', ''],
  // Une numérotation n'est pas un titre, et un deux-points en l'air n'est pas une coupe.
  ['2 : Die Schule', '2 : Die Schule', ''],
  ['Titre :', 'Titre :', ''],
  [': sans titre', ': sans titre', '']
];

test('docx-meta.py : scinder_titre coupe au deux-points, et seulement là', { skip: sansPython }, () => {
  const programme = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("dm", ' + JSON.stringify(cheminPython(DOCX_META)) + ')',
    'dm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(dm)',
    'cas = json.loads(sys.argv[1])',
    'print(json.dumps([dm.scinder_titre(dm.normaliser(t)) for t in cas]))'
  ].join('\n');
  const r = python(['-c', programme, JSON.stringify(CAS_SCISSION.map((c) => c[0]))], { env: ENV });
  assert.strictEqual(r.status, 0, 'scinder_titre a échoué : ' + r.stderr);
  const rendu = JSON.parse(r.stdout);
  CAS_SCISSION.forEach(([brut, titre, sousTitre], i) => {
    assert.deepStrictEqual(rendu[i], [titre, sousTitre], 'scission fausse sur : ' + brut);
  });
});

// ---- 2. L'import réel ------------------------------------------------------------
//
// Un .docx minimal suffit : docx-meta.py ne lit que word/document.xml et word/styles.xml.
// Fabriqué ici, il montre dans le test le style de chaque paragraphe.

function fabriquerDocx(chemin, paragraphes) {
  const programme = [
    'import json, sys, zipfile',
    'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
    'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'corps = "".join("<w:p><w:pPr><w:pStyle w:val=\\"%s\\"/></w:pPr><w:r>'
      + '<w:t xml:space=\\"preserve\\">%s</w:t></w:r></w:p>" % (s, t) for s, t in paras)',
    'doc = \'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s"><w:body>%s'
      + '</w:body></w:document>\' % (W, corps)',
    'styles = \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">\' % W',
    'for sid, nom in (("Title", "Title"), ("Subtitle", "Subtitle"), ("Normal", "Normal")):',
    '    styles += \'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' % (sid, nom)',
    'styles += "</w:styles>"',
    'with zipfile.ZipFile(chemin, "w") as z:',
    '    z.writestr("word/document.xml", doc.encode("utf-8"))',
    '    z.writestr("word/styles.xml", styles.encode("utf-8"))'
  ].join('\n');
  const r = python(['-c', programme, chemin, JSON.stringify(paragraphes)], { env: ENV });
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Lance l'import sur un .docx fabriqué, et rend { stats, fiche, avertissements }.
function importer(slug, paragraphes) {
  const base = dossierJetable();
  try {
    const docx = path.join(base, slug + '.docx');
    fabriquerDocx(docx, paragraphes);
    const envOpts = Object.assign({}, ENV, { SZH_META: path.join(base, 'instructions.txt') });
    const r = python([DOCX_META, docx, slug, base], { env: envOpts });
    assert.strictEqual(r.status, 0, 'docx-meta.py a échoué : ' + r.stderr);
    const lignes = String(r.stdout).trim().split(/\r?\n/);
    return {
      stats: JSON.parse(lignes[lignes.length - 1]),
      fiche: fs.readFileSync(path.join(base, slug + '.meta.yaml'), 'utf8'),
      avertissements: String(r.stderr).split(/\r?\n/)
        .filter((l) => l.indexOf('[import-avertissement]') === 0)
    };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const CORPS = 'Le corps du texte commence ici, avec le et la et les et des mots.';

test('docx-meta.py : un titre à deux-points sans sous-titre remplit les deux champs', { skip: sansPython }, () => {
  const vu = importer('01-inclusion', [
    ['Title', 'Inclusion scolaire : le rôle de l’enseignant'],
    ['Normal', CORPS]
  ]);
  assert.match(vu.fiche, /title:\n  fr: "Inclusion scolaire"\n/,
    'le titre garde encore son sous-titre : ' + vu.fiche);
  assert.match(vu.fiche, /subtitle:\n  fr: "le rôle de l’enseignant"\n/,
    'le sous-titre n’a pas été déduit : ' + vu.fiche);
  assert.strictEqual(vu.stats.sous_titre_source, 'deux-points',
    'la provenance du sous-titre n’est pas dite dans les stats');

  // La coupe est déduite par l'outil : elle est signalée avec les deux morceaux, pour
  // pouvoir la défaire.
  const ligne = vu.avertissements.find((l) => l.indexOf('sous-titre-deduit') !== -1);
  assert.ok(ligne, 'la coupe est muette : ' + vu.avertissements.join(' / '));
  assert.ok(ligne.indexOf('soustitre « le rôle de l’enseignant »') !== -1,
    'le champ « soustitre » manque à l’avertissement : ' + ligne);
  assert.ok(ligne.indexOf('article « 01-inclusion »') !== -1,
    'l’avertissement ne nomme pas son article : ' + ligne);
});

test('docx-meta.py : un sous-titre stylé interdit la coupe du titre', { skip: sansPython }, () => {
  const vu = importer('02-ecole', [
    ['Title', 'Inclusion scolaire : le rôle de l’enseignant'],
    ['Subtitle', 'Une enquête romande'],
    ['Normal', CORPS]
  ]);
  // Le document a un sous-titre stylé : le titre reste entier, deux-points et insécable
  // (U+00A0) compris, car les valeurs ne passent pas par la forme de comparaison.
  assert.match(vu.fiche, /title:\n  fr: "Inclusion scolaire : le rôle de l’enseignant"\n/,
    'le titre a été coupé alors que le Word portait déjà un sous-titre : ' + vu.fiche);
  assert.match(vu.fiche, /subtitle:\n  fr: "Une enquête romande"\n/);
  assert.strictEqual(vu.stats.sous_titre_source, 'style');
  assert.deepStrictEqual(
    vu.avertissements.filter((l) => l.indexOf('sous-titre-deduit') !== -1), [],
    'une coupe non faite s’annonce quand même');
});

test('docx-meta.py : un titre sans deux-points passe inchangé', { skip: sansPython }, () => {
  const vu = importer('03-fruehfoerderung', [
    ['Title', 'Frühförderung in der Praxis'],
    ['Normal', 'Der Text beginnt hier, mit der und die und das und und und für.']
  ]);
  assert.match(vu.fiche, /title:\n  de: "Frühförderung in der Praxis"\n/);
  assert.ok(vu.fiche.indexOf('subtitle:') === -1,
    'un sous-titre est sorti de nulle part : ' + vu.fiche);
  assert.strictEqual(vu.stats.sous_titre_source, 'aucun');
});

// ---- 3. Le constat à l'écran -----------------------------------------------------

const journal = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'journal.js'));
const constats = require(path.join(COCKPIT, 'lib', 'constats.js'));

// La ligne du pipeline telle que le contrôle précédent la reçoit sur stderr.
const LIGNE_REELLE = '[import-avertissement] sous-titre-deduit | article « 01-inclusion » | '
  + 'titre « Inclusion scolaire » | soustitre « le rôle de l’enseignant » | '
  + 'Prose française du pipeline, oubliable. | [de] Vergessliche deutsche Prosa.';

test('codes : la coupe du titre arrive à l’écran, et son bouton ouvre le titre', () => {
  for (const langue of ['fr', 'de']) {
    const c = journal.analyserJournal(LIGNE_REELLE + '\n', langue)[0];
    assert.ok(c, 'la ligne n’est pas reconnue du tout (' + langue + ')');
    assert.strictEqual(c.slug, '01-inclusion', 'le constat a perdu son article');

    // Une information, et non un défaut : l'outil a pris une décision lisible.
    assert.strictEqual(constats.gravite(c, {}), 'info',
      'la coupe se donne pour une erreur (' + langue + ')');

    const phrase = journal.phraseConstat(c, langue);
    assert.ok(phrase.indexOf('le rôle de l’enseignant') !== -1,
      'la phrase ne montre pas le sous-titre déduit (' + langue + ') : ' + phrase);
    assert.ok(phrase.indexOf('oubliable') === -1 && phrase.indexOf('Vergessliche') === -1,
      'la prose du pipeline s’affiche encore au lieu de celle de la maison (' + langue + ')');

    // L'intitulé court de la carte nomme lui aussi ce qui a été déduit.
    assert.ok(constats.phrase(c, langue).indexOf('le rôle de l’enseignant') !== -1,
      'l’intitulé court ne nomme pas le sous-titre (' + langue + ')');

    const bouton = constats.bouton(c, langue);
    assert.ok(bouton, 'aucun geste proposé (' + langue + ')');
    assert.strictEqual(bouton.id, 'fiche');
    assert.strictEqual(bouton.focus, 'title',
      'le bouton n’ouvre pas le champ du titre, là où la coupe se défait');
  }
});
