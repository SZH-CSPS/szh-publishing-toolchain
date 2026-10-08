// La typographie tapée dans Word arrive intacte dans la fiche. Les deux lecteurs de l'import
// (pipeline/pronto-lire.py pour le gabarit, pipeline/docx-meta.py pour les Word hérités)
// écrivent titre, sous-titre, résumé, champs d'auteur et valeurs de bloc (légende…) dans
// <slug>.meta.yaml et $SZH_META. szh-typographie.lua ne reconstruit pas un demi-cadratin
// devenu trait d'union ni une insécable devenue espace.
//
//   node --test test/js/typo-valeurs.test.js
//
// Repères des noms de test :
//   D1  <w:noBreakHyphen/> (Ctrl+Maj+-) et <w:sym> sont lus : « Jean‑Éric » reste entier ;
//   D2  les valeurs gardent tirets et insécables (la forme de comparaison sert seulement à
//       reconnaître les clés) ;
//   D3  docx-meta.py prend la langue du produit du numéro ; la langue déduite du document ne
//       fait qu'avertir.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { python, cheminPython, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PRONTO_LIRE = path.join(RACINE, 'pipeline', 'pronto-lire.py');
const DOCX_META = path.join(RACINE, 'pipeline', 'docx-meta.py');
const GABARIT_FR = path.join(RACINE, 'revue-template', "Pronto - modele d'article_FR.docx");

const NBSP = ' ';
const TU_INSECABLE = '‑';

function lancerPython(args, env) {
  return python(args, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, env || {})
  });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-typo-valeurs-'));
}

// ---- Fabricant ----------------------------------------------------------------------
//
// Deux modes, une spec JSON :
//   { gabarit, sortie, operations } — copie d'un vrai gabarit du dépôt ; une opération
//     ['cellule', clé, runs] pose des runs XML dans la 2e cellule de la rangée dont le 1er
//     paragraphe dit `clé` ; ['paragraphe', texte, runs] remplace les runs du premier
//     paragraphe dont le texte vaut exactement `texte` ;
//   { sortie, paragraphes: [[style, runs], ...] } — un Word hérité minimal.
// Les runs arrivent en XML brut : c'est la seule façon d'écrire un <w:noBreakHyphen/>.
const FABRICANT_PY = String.raw`# -*- coding: utf-8 -*-
import json, re, sys, zipfile
from xml.sax.saxutils import unescape
spec = json.load(open(sys.argv[1], encoding='utf-8'))
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

def texte_p(p):
    return ''.join(unescape(t) for t in re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', p))

def paragraphes(x):
    return re.findall(r'<w:p[ >](?:(?!<w:p[ >]).)*?</w:p>', x, re.S)

def avec_runs(p, runs):
    ppr = re.search(r'<w:pPr>.*?</w:pPr>', p, re.S)
    return p[:p.find('>') + 1] + (ppr.group(0) if ppr else '') + runs + '</w:p>'

def cellule(x, cle, runs):
    for tr in re.findall(r'<w:tr[ >].*?</w:tr>', x, re.S):
        tcs = re.findall(r'<w:tc>.*?</w:tc>', tr, re.S)
        if len(tcs) < 2:
            continue
        p0 = paragraphes(tcs[0])
        if not p0 or texte_p(p0[0]).strip() != cle:
            continue
        p1 = paragraphes(tcs[1])[0]
        return x.replace(p1, avec_runs(p1, runs), 1)
    raise SystemExit('cellule introuvable : ' + cle)

def paragraphe(x, texte, runs):
    for p in paragraphes(x):
        if texte_p(p) == texte:
            return x.replace(p, avec_runs(p, runs), 1)
    raise SystemExit('paragraphe introuvable : ' + texte)

if spec.get('gabarit'):
    z = zipfile.ZipFile(spec['gabarit'])
    x = z.read('word/document.xml').decode('utf-8')
    for op in spec['operations']:
        x = (cellule if op[0] == 'cellule' else paragraphe)(x, op[1], op[2])
    with zipfile.ZipFile(spec['sortie'], 'w', zipfile.ZIP_DEFLATED) as out:
        for item in z.infolist():
            donnees = x.encode('utf-8') if item.filename == 'word/document.xml' else z.read(item.filename)
            out.writestr(item, donnees)
else:
    corps = ''.join('<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>%s</w:p>' % (s, r)
                    for s, r in spec['paragraphes'])
    doc = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s"><w:body>%s'
           '</w:body></w:document>' % (W, corps))
    styles = '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">' % W
    for sid, nom in (('Title', 'Title'), ('Subtitle', 'Subtitle'), ('Normal', 'Normal'),
                     ('Heading1', 'heading 1')):
        styles += '<w:style w:type="paragraph" w:styleId="%s"><w:name w:val="%s"/></w:style>' % (sid, nom)
    styles += '</w:styles>'
    with zipfile.ZipFile(spec['sortie'], 'w') as z:
        z.writestr('word/document.xml', doc.encode('utf-8'))
        z.writestr('word/styles.xml', styles.encode('utf-8'))
`;

function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const run = (t) => '<w:r><w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
const traitInsecable = '<w:r><w:noBreakHyphen/></w:r>';
const sym = (code, police) => '<w:r><w:sym w:font="' + police + '" w:char="' + code + '"/></w:r>';

function fabriquer(base, spec) {
  const fab = path.join(base, 'fabricant.py');
  fs.writeFileSync(fab, FABRICANT_PY, 'utf8');
  const cheminSpec = path.join(base, 'spec.json');
  fs.writeFileSync(cheminSpec, JSON.stringify(Object.assign({}, spec,
    { sortie: cheminPython(spec.sortie), gabarit: spec.gabarit && cheminPython(spec.gabarit) })), 'utf8');
  const r = lancerPython([fab, cheminSpec]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Lance un lecteur sur le .docx fabriqué ; rend { fiche, instructions, stats, stderr }.
function lire(lecteur, spec, produit) {
  const base = dossierJetable();
  try {
    const docx = path.join(base, 'essai.docx');
    fabriquer(base, Object.assign({ sortie: docx }, spec));
    const instr = path.join(base, 'instructions.txt');
    const env = { SZH_META: instr, SZH_PHOTOS: path.join(base, 'photos.txt') };
    if (produit !== undefined) env.SZH_PRODUIT = produit;
    const r = lancerPython([lecteur, docx, 'essai', base], env);
    assert.strictEqual(r.status, 0, path.basename(lecteur) + ' a échoué : ' + r.stderr);
    const lignes = String(r.stdout).trim().split(/\r?\n/);
    const fiche = path.join(base, 'essai.meta.yaml');
    return {
      fiche: fs.existsSync(fiche) ? fs.readFileSync(fiche, 'utf8') : '',
      instructions: fs.existsSync(instr) ? fs.readFileSync(instr, 'utf8') : '',
      stats: JSON.parse(lignes[lignes.length - 1]),
      stderr: String(r.stderr)
    };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ---- Le gabarit Pronto ----------------------------------------------------------------

const SPEC_PRONTO = {
  gabarit: GABARIT_FR,
  operations: [
    ['cellule', 'Titre (FR)', run('L’école inclusive' + NBSP + '– et après' + NBSP + '?')],
    ['cellule', 'Sous-titre (FR)', run('Les années 1990–2000, pp.' + NBSP + '12–25')],
    ['cellule', 'Résumé (FR)', run('Un résumé' + ' ' + ': 80' + NBSP + '% — voilà.')],
    ['paragraphe', 'Prénom : ', run('Prénom : Jean') + traitInsecable + run('Éric')],
    ['paragraphe', 'Nom : ', run('Nom : Dupont')],
    ['paragraphe', 'Fonction : ', run('Fonction : Professeure ') + sym('2192', 'Arial') + run(' HEP')],
    ['paragraphe', 'Légende' + NBSP + ': ', run('Légende' + NBSP + ': Élèves 1990–2000')]
  ]
};

test('pronto-lire.py (D1) : un trait d’union insécable Word reste U+2011, un w:sym son caractère', { skip: sansPython }, () => {
  const vu = lire(PRONTO_LIRE, SPEC_PRONTO, 'revue');
  assert.ok(vu.fiche.includes('prenom: "Jean' + TU_INSECABLE + 'Éric"'),
    'le <w:noBreakHyphen/> du prénom s’est perdu : ' + vu.fiche);
  assert.ok(vu.fiche.includes('fonction: "Professeure → HEP"'),
    'le <w:sym> de la fonction s’est perdu : ' + vu.fiche);
});

test('pronto-lire.py (D2) : titre, sous-titre, résumé et légende gardent insécables et tirets', { skip: sansPython }, () => {
  const vu = lire(PRONTO_LIRE, SPEC_PRONTO, 'revue');
  assert.ok(vu.fiche.includes('"L’école inclusive' + NBSP + '– et après' + NBSP + '?"'),
    'titre dégradé : ' + JSON.stringify(vu.fiche));
  assert.ok(vu.fiche.includes('"Les années 1990–2000, pp.' + NBSP + '12–25"'),
    'sous-titre dégradé : ' + JSON.stringify(vu.fiche));
  assert.ok(vu.fiche.includes('"Un résumé : 80' + NBSP + '% — voilà."'),
    'résumé dégradé : ' + JSON.stringify(vu.fiche));
  const fi = vu.instructions.split('\n').find((l) => l.startsWith('FI\t')) || '';
  assert.strictEqual(fi.split('\t')[2], 'Élèves 1990–2000',
    'légende dégradée dans la ligne FI : ' + JSON.stringify(fi));
  // La clé à l'insécable du gabarit est reconnue, et les deux tableaux fixes consommés.
  assert.strictEqual(vu.stats.bloquant, false, 'import bloqué : ' + vu.stderr);
  assert.strictEqual(vu.stats.tableau1_consomme, true);
});

// D9 : les messages du lecteur suivent la typographie de leur langue. Le français sépare
// («U+00A0…U+00A0», U+00A0 devant le deux-points), l'allemand colle.
test('pronto-lire.py (D9) : ses avertissements sont composés dans la typographie de chaque langue', { skip: sansPython }, () => {
  const vu = lire(PRONTO_LIRE, SPEC_PRONTO, 'revue');
  const ligne = vu.stderr.split(/\r?\n/).find((l) => l.includes('cle-attendue-absente')) || '';
  const [fr, de] = ligne.split(' | [de] ');
  const phraseFr = fr.split(' | ').pop();
  assert.ok(phraseFr.includes('Le champ «' + NBSP) && phraseFr.includes(NBSP + ': rien'),
    'phrase française mal composée : ' + JSON.stringify(phraseFr));
  assert.ok(/Das von der Vorlage erwartete Feld «[^  ]/.test(de) && !/ :/.test(de),
    'phrase allemande mal composée : ' + JSON.stringify(de));
});

// Une étiquette tapée en NFD (e + U+0301) est reconnue exactement, sans l'avertissement de
// proximité « Légende lue comme Légende ».
test('pronto_modele.identifier_cle : une étiquette en NFD se reconnaît comme en NFC, exactement', { skip: sansPython }, () => {
  const programme = [
    'import json, sys',
    "sys.path.insert(0, sys.argv[1])",
    'import pronto_modele as pm',
    "cas = [('Le\\u0301gende', 'CANON_FIGURE'), ('Re\\u0301sume\\u0301', 'CANON_METADONNEES'),",
    "       ('Pre\\u0301nom', 'CANON_AUTEUR')]",
    'print(json.dumps([list(pm.identifier_cle(e, getattr(pm, t))) for e, t in cas]))'
  ].join('\n');
  const r = lancerPython(['-c', programme, path.join(RACINE, 'pipeline')]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout),
    [['legende', 1, true], ['resume', 1, true], ['prenom', 1, true]]);
});

// ---- Les Word hérités (docx-meta.py) ------------------------------------------------------

const SPEC_HERITE = {
  paragraphes: [
    ['Title', run('L’école' + NBSP + '– A') + traitInsecable + run('B, 1990–2000')],
    ['Normal', run('Le texte du corps commence ici, et la suite est dans le document.')]
  ]
};

test('docx-meta.py (D1, D2) : le titre hérité garde U+2011, le demi-cadratin et l’insécable', { skip: sansPython }, () => {
  const vu = lire(DOCX_META, SPEC_HERITE, 'revue');
  assert.ok(vu.fiche.includes('fr: "L’école' + NBSP + '– A' + TU_INSECABLE + 'B, 1990–2000"'),
    'titre hérité dégradé : ' + JSON.stringify(vu.fiche));
});

// Un article allemand dont le premier résumé est français, comme la Zeitschrift en publie.
const SPEC_HERITE_DE = {
  paragraphes: [
    ['Title', run('Die Schule und dann')],
    ['Normal', run('Résumé : Ce texte porte sur l’école et sur la classe.')],
    ['Normal', run('Zusammenfassung: Dieser Text handelt von der Schule und der Klasse.')],
    ['Heading1', run('Einleitung')],
    ['Normal', run('Die Kinder und die Eltern sind für die Schule mit dem Lehrer im Haus.')]
  ]
};

test('docx-meta.py (D3) : la langue vient du produit du numéro, la déduction ne fait qu’avertir', { skip: sansPython }, () => {
  const vu = lire(DOCX_META, SPEC_HERITE_DE, 'zeitschrift');
  assert.match(vu.fiche, /^lang: de$/m, 'la Zeitschrift ne compose pas en allemand : ' + vu.fiche);
  assert.strictEqual(vu.stats.langue_source, 'produit');
  assert.strictEqual(vu.stats.langue_detectee, 'fr');
  assert.match(vu.stderr, /langue-desaccord-produit/, 'le désaccord n’est pas dit : ' + vu.stderr);
});

test('docx-meta.py (D3) : sans produit (hors d’un numéro), la déduction reste la règle', { skip: sansPython }, () => {
  const vu = lire(DOCX_META, SPEC_HERITE_DE, '');
  assert.match(vu.fiche, /^lang: fr$/m, vu.fiche);
  assert.strictEqual(vu.stats.langue_source, 'premier-resume');
  assert.doesNotMatch(vu.stderr, /langue-desaccord-produit/);
});

test('docx-meta.py (D3) : produit et document d’accord, aucun avertissement de désaccord', { skip: sansPython }, () => {
  const vu = lire(DOCX_META, SPEC_HERITE, 'revue');
  assert.match(vu.fiche, /^lang: fr$/m, vu.fiche);
  assert.doesNotMatch(vu.stderr, /langue-desaccord-produit/);
});
