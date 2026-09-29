// Le nettoyeur de manuscrit et les figures à plusieurs images (décision de Robin, 29.09.2026).
//
//   node --test test/js/manuscrit-figures.test.js
//
// Ce que le diagnostic du 29.09.2026 avait mesuré, et que ces tests tiennent désormais :
//   1. clés TAPÉES à la main avant une image (« Légende : … » en style Normal) : reconnues,
//      consommées dans le bloc figure — jamais laissées en corps de texte, jamais doublées
//      d'un second jeu de clés vides ;
//   2. (a) deux images dans un paragraphe, (b) deux paragraphes d'images, (c) un tableau 1×2
//      de mise en page : UN bloc figure, que l'import relit en UN groupe d'images (ligne FI à
//      deux images) — au lieu de deux blocs vides, ou d'un « Tableau N » ;
//   3. un tableau de DONNÉES qui porte une image reste un bloc tableau ;
//   4. un document déjà au gabarit (cas A) n'est pas dénaturé : ses deux tableaux fixes ne
//      sont pas dupliqués, ses clés « SZH Cle Abb/Tab » restent des clés ;
//   5. l'incident « tout le corps supprimé » (manuscrit court sans bibliographie) : le corps
//      et les images restent ;
//   6. le garde-fou « rien ne se perd » : une perte (provoquée par injection, jamais par une
//      modification du code de production) est dite — alerte `error` —, et une perte massive
//      refuse la sortie.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');
const F = require('./figures-fabrique');

const PIPELINE = path.join(F.RACINE, 'pipeline');
const NETTOYEUR = path.join(PIPELINE, 'manuscrit-nettoyer.py');
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');

function python(args, env) {
  return cp.spawnSync(PYTHON, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, F.ENV_UTF8, env || {}) });
}

// --sans-typo : la typographie passe par pandoc dans la WSL, et rien ici n'en dépend.
const OPTIONS = ['--produit', 'revue', '--sans-reseau', '--sans-annotation', '--sans-typo'];

function nettoyer(entree, sortie) {
  fs.mkdirSync(sortie, { recursive: true });
  const r = python([NETTOYEUR, entree, '--sortie', sortie].concat(OPTIONS));
  const ligne = r.stdout.split('\n').filter((l) => l.trim())[0] || '{}';
  return { r: r, obj: JSON.parse(ligne) };
}

// Les enfants directs de w:body du .docx écrit : { t: 'p'|'tbl', style, texte, images }.
const CORPS_PY = String.raw`
import json, re, sys, zipfile
import xml.etree.ElementTree as ET
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
racine = ET.fromstring(zipfile.ZipFile(sys.argv[1]).read('word/document.xml'))
res = []
for e in racine.find(W + 'body'):
    if e.tag == W + 'p':
        st = e.find(W + 'pPr/' + W + 'pStyle')
        res.append({'t': 'p', 'style': st.get(W + 'val') if st is not None else '',
                    'texte': ''.join(x.text or '' for x in e.iter(W + 't')),
                    'images': sum(1 for x in e.iter() if x.tag.endswith('}blip'))})
    elif e.tag == W + 'tbl':
        res.append({'t': 'tbl', 'texte': ''.join(x.text or '' for x in e.iter(W + 't')),
                    'images': sum(1 for x in e.iter() if x.tag.endswith('}blip'))})
print(json.dumps(res, ensure_ascii=False))
`;

function corps(docx) {
  const r = python(['-c', CORPS_PY, docx]);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// Ce que l'IMPORT lira du .docx nettoyé : les lignes d'instructions de pronto-lire.py.
function instructionsImport(docx, dossier) {
  const instr = path.join(dossier, 'instructions.txt');
  const r = python([PRONTO_LIRE, docx, 'essai', dossier], { SZH_META: instr, SZH_PRODUIT: 'revue' });
  assert.strictEqual(r.status, 0, 'pronto-lire.py a refusé la sortie du nettoyeur : ' + r.stderr);
  return fs.readFileSync(instr, 'utf8').split('\n').filter((l) => l);
}

function lignesFI(instructions) {
  return instructions.filter((l) => /^FI\t/.test(l)).map((l) => l.split('\t'));
}

for (const cas of ['a', 'b', 'c']) {
  const libelle = { a: 'deux images dans un paragraphe', b: 'deux paragraphes d’images',
    c: 'un tableau 1×2 de mise en page' }[cas];
  test('nettoyeur (' + cas + ') : ' + libelle + ' + clés tapées -> UN bloc figure, clés reprises, relu en groupe',
    { skip: sansPython }, () => {
      const base = F.dossierJetable();
      try {
        const entree = F.fabriquer(base, 'brut-' + cas, F.manuscritBrut(cas));
        const { r, obj } = nettoyer(entree, path.join(base, 'sortie'));
        assert.ok(obj.sortie_docx && fs.existsSync(obj.sortie_docx), 'aucune sortie : ' + r.stderr);
        const elements = corps(obj.sortie_docx);
        const cles = elements.filter((e) => e.style === 'SZHCleAbbTab');
        assert.strictEqual(cles.length, 4, 'UN jeu de quatre clés, pas deux : '
          + JSON.stringify(cles.map((e) => e.texte)));
        assert.deepStrictEqual(cles.map((e) => e.texte),
          ['Légende : ' + F.LEGENDE, 'Texte alternatif : ' + F.ALT, 'Crédit : ' + F.CREDIT, 'Source : '],
          'les valeurs tapées doivent passer dans les clés du bloc');
        assert.ok(!elements.some((e) => e.style !== 'SZHCleAbbTab' && /Légende :|Crédit :/.test(e.texte)),
          'une clé tapée est restée en corps de texte : '
          + JSON.stringify(elements.filter((e) => /Légende|Crédit/.test(e.texte))));
        const images = elements.reduce((n, e) => n + (e.t === 'p' ? e.images : 0), 0);
        assert.strictEqual(images, 2, 'les deux images, en paragraphes, hors de tout tableau');
        assert.strictEqual(elements.filter((e) => e.t === 'tbl').length, 2,
          'seuls les deux tableaux fixes : le tableau de mise en page n’est plus un tableau');
        // Et l'import le relit comme UN groupe : une seule ligne FI, deux images, les valeurs.
        const fi = lignesFI(instructionsImport(obj.sortie_docx, base));
        assert.strictEqual(fi.length, 1, 'une seule figure pour l’import : ' + JSON.stringify(fi));
        assert.strictEqual(fi[0][1].split(';').length, 2, 'deux images dans la figure : ' + fi[0][1]);
        assert.deepStrictEqual(fi[0].slice(2, 5), [F.LEGENDE, F.ALT, F.CREDIT]);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
}

// Décision de Robin (29.09.2026) : après une série de clés, les images qui se suivent,
// séparées de 0, 1 ou 2 paragraphes VIDES au plus, sont LA MÊME figure ; un troisième vide,
// un texte ou une nouvelle série de clés ouvrent une autre figure. Chaque cas est relu par
// l'import (pronto-lire.py) : c'est lui qui dira s'il y a un groupe ou deux figures.
const ENCHAINEMENTS = [
  { nom: '0 vide', entre: [], figures: 1 },
  { nom: '1 vide', entre: [F.vide()], figures: 1 },
  { nom: '2 vides', entre: [F.vide(), F.vide()], figures: 1 },
  { nom: '3 vides', entre: [F.vide(), F.vide(), F.vide()], figures: 2 },
  { nom: 'un texte', entre: [F.p('Un texte court qui sépare les deux images.')], figures: 2 },
  { nom: 'une nouvelle série de clés', entre: F.clesSecondes(), figures: 2, clesSecondes: true },
];

for (const cas of ENCHAINEMENTS) {
  test('nettoyeur : deux images séparées par ' + cas.nom + ' -> ' + (cas.figures === 1
    ? 'UNE figure (un groupe)' : 'deux figures'), { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const entree = F.fabriquer(base, 'enchainement',
        F.manuscritBrut('b', { contenu: F.deuxImagesSeparees(cas.entre) }));
      const { r, obj } = nettoyer(entree, path.join(base, 'sortie'));
      assert.ok(obj.sortie_docx, r.stderr);
      const elements = corps(obj.sortie_docx);
      const legendes = elements.filter((e) => e.style === 'SZHCleAbbTab' && /^Légende :/.test(e.texte));
      assert.strictEqual(legendes.length, cas.figures, 'nombre de figures : '
        + JSON.stringify(legendes.map((e) => e.texte)));
      const fi = lignesFI(instructionsImport(obj.sortie_docx, base));
      assert.strictEqual(fi.length, cas.figures, JSON.stringify(fi));
      if (cas.figures === 1) {
        assert.strictEqual(fi[0][1].split(';').length, 2, 'les deux images dans la même figure');
      } else {
        assert.ok(fi.every((l) => l[1].split(';').length === 1), 'une image par figure : ' + JSON.stringify(fi));
        assert.strictEqual(fi[0][2], F.LEGENDE, 'la première figure garde ses clés');
      }
      if (cas.clesSecondes) {
        assert.strictEqual(fi[1][2], F.LEGENDE_2, 'la seconde figure porte SES clés');
        assert.strictEqual(fi[1][4], '© Autre');
      }
      if (cas.nom === 'un texte') {
        assert.ok(elements.some((e) => /Un texte court qui sépare/.test(e.texte)), 'le texte a disparu');
      }
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
      assert.strictEqual(rapport.controles.perte_de_contenu.mots_manquants, 0,
        'les vides consommés ne doivent rien faire perdre : ' + JSON.stringify(rapport.controles.perte_de_contenu));
      assert.strictEqual(rapport.controles.perte_de_contenu.images_sortie, 2);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
}

test('nettoyeur : une ligne de la zone des autrices qu’aucune fiche ne reçoit reste dans le texte',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const spec = F.manuscritBrut('a');
      // Deux noms déclarés ensemble : l'institution qui suit n'est à personne en particulier.
      spec.corps.splice(1, 1, F.p('Jeanne Test et Marc Essai'), F.p('Université de Nulle-Part'));
      const entree = F.fabriquer(base, 'byline', spec);
      const { obj } = nettoyer(entree, path.join(base, 'sortie'));
      const texte = corps(obj.sortie_docx).map((e) => e.texte).join('\n');
      assert.match(texte, /Université de Nulle-Part/, 'la ligne non attribuée a disparu');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('nettoyeur : un tableau de DONNÉES qui porte une image reste un bloc tableau', { skip: sansPython }, () => {
  const base = F.dossierJetable();
  try {
    const spec = F.manuscritBrut('a', { cles: false });
    // La figure (a) remplacée par un vrai tableau : une colonne de texte, une image.
    const i = spec.corps.findIndex((b) => b.p && b.p.some((x) => x.img));
    spec.corps[i] = { tbl: [[[{ p: [{ t: 'Classe A' }] }], [{ p: [{ img: 'C', descr: 'logo' }] }]],
      [[{ p: [{ t: 'Classe B' }] }], [{ p: [{ t: '12 élèves' }] }]]] };
    const entree = F.fabriquer(base, 'donnees', spec);
    const { obj } = nettoyer(entree, path.join(base, 'sortie'));
    const elements = corps(obj.sortie_docx);
    const tables = elements.filter((e) => e.t === 'tbl');
    assert.strictEqual(tables.length, 3, 'deux tableaux fixes + le tableau de données');
    assert.match(tables[2].texte, /Classe A.*Classe B/, 'le tableau de données a été défait');
    assert.strictEqual(tables[2].images, 1, 'l’image reste dans sa cellule');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('nettoyeur : un document DÉJÀ au gabarit garde ses tableaux fixes et ses clés, sans doublon',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const entree = F.fabriquer(base, 'pronto-a', F.documentPronto('a'));
      const avant = corps(entree);
      const { r, obj } = nettoyer(entree, path.join(base, 'sortie'));
      assert.ok(obj.sortie_docx, r.stderr);
      const apres = corps(obj.sortie_docx);
      const n = (els, t) => els.filter((e) => e.t === t).length;
      assert.strictEqual(n(apres, 'tbl'), n(avant, 'tbl'),
        'les tableaux fixes ont été dupliqués (ou perdus) : ' + n(avant, 'tbl') + ' -> ' + n(apres, 'tbl'));
      const legendes = apres.filter((e) => /^Légende\s*:/.test(e.texte));
      assert.ok(legendes.every((e) => e.style === 'SZHCleAbbTab'),
        'une clé du gabarit a été réécrite en corps de texte : ' + JSON.stringify(legendes));
      assert.strictEqual(legendes.filter((e) => e.texte.indexOf(F.LEGENDE) !== -1).length, 1,
        'la légende remplie doit rester, une fois');
      assert.strictEqual(legendes.length, avant.filter((e) => /^Légende\s*:/.test(e.texte)).length,
        'aucun jeu de clés ajouté ni retiré');
      // Les styles maison du corps (encadrés du gabarit) survivent aussi.
      for (const style of ['SZHImportant', 'SZHHervorhebung', 'SZHQuestioninterview']) {
        assert.ok(apres.some((e) => e.style === style), 'style maison perdu : ' + style);
      }
      // Et l'import relit la même chose qu'avant : une figure à deux images, ses valeurs.
      const fi = lignesFI(instructionsImport(obj.sortie_docx, base));
      assert.strictEqual(fi.length, 1, JSON.stringify(fi));
      assert.deepStrictEqual(fi[0].slice(2, 5), [F.LEGENDE, F.ALT, F.CREDIT]);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('nettoyeur : incident « tout le corps supprimé » — un manuscrit court sans bibliographie garde son corps et ses images',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      for (const cas of ['a', 'b']) {
        const entree = F.fabriquer(base, 'court-' + cas, F.manuscritBrut(cas, { court: true }));
        const { r, obj } = nettoyer(entree, path.join(base, 'sortie-' + cas));
        assert.strictEqual(obj.code_sortie, 0, r.stderr);
        const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
        assert.ok(rapport.compteurs.signes_total > 200,
          'le corps a disparu (signes_total ' + rapport.compteurs.signes_total + ')');
        assert.strictEqual(rapport.compteurs.images.total, 2, 'les images ont disparu');
        const decisions = rapport.decisions.entete.trace.map((t) => t.decision);
        assert.ok(decisions.indexOf('bloc_auteurs_final_heuristique') === -1,
          'le corps a encore été pris pour un bloc d’autrices : ' + JSON.stringify(decisions));
        const texte = corps(obj.sortie_docx).map((e) => e.texte).join('\n');
        assert.match(texte, /Un paragraphe de corps après la figure/, 'le dernier paragraphe manque');
        assert.strictEqual(rapport.controles.perte_de_contenu.mots_manquants, 0,
          JSON.stringify(rapport.controles.perte_de_contenu));
        assert.ok(rapport.decisions.entete.donnees.auteurs.every((a) => a.prenom !== 'Crédit'),
          '« Crédit : © Jeanne Test » a été lu comme une autrice');
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Le garde-fou, éprouvé par INJECTION (patron du contrôle n°15 de manuscrit-nettoyer.test.js) :
// la reconnaissance du bloc d'autrices final est remplacée, après chargement, par l'ancienne
// faute — « tout ce qui suit l'en-tête est un bloc d'autrices » —, sans toucher au code livré.
const PONT_SABOTE = String.raw`
import importlib.util, sys
dossier, chemin, portion = sys.argv[1], sys.argv[2], float(sys.argv[3])
sys.path.insert(0, dossier)
spec = importlib.util.spec_from_file_location('nettoyeur_sabote', chemin)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
def avaler(document, entete, langue, indices_entete=None, base_noms=None, noms_biblio=None):
    n = len(document.blocs)
    debut = max(indices_entete or {0: 0}) + 1
    fin = debut + int((n - debut) * portion)
    return {i: 'auteurs' for i in range(debut, fin)}, [{'decision': 'sabotage', 'source': None}]
mod.me.extraire_bloc_auteurs_final = avaler
sys.argv = [chemin] + sys.argv[4:]
sys.exit(mod.principal(sys.argv))
`;

test('nettoyeur : garde-fou — une perte massive refuse la sortie, une perte partielle lève une alerte error',
  { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const entree = F.fabriquer(base, 'garde', F.manuscritBrut('b'));
      // Tout le corps avalé : refus, rien de livré, le rapport dit ce qui manque.
      const sortie1 = path.join(base, 'massive');
      fs.mkdirSync(sortie1);
      const r1 = python(['-c', PONT_SABOTE, PIPELINE, NETTOYEUR, '1.0', entree, '--sortie', sortie1]
        .concat(OPTIONS));
      const o1 = JSON.parse(r1.stdout.trim().split('\n').pop());
      assert.strictEqual(r1.status, 2, 'code de refus attendu : ' + r1.stderr);
      assert.strictEqual(o1.refus, true);
      assert.strictEqual(o1.code_refus, 'perte-de-contenu');
      assert.ok(!fs.readdirSync(sortie1).some((n) => /\.docx$/.test(n)),
        'le .docx qui a perdu son corps ne doit pas être livré');
      const rap1 = JSON.parse(fs.readFileSync(o1.sortie_rapport, 'utf8'));
      const alerte1 = rap1.alertes.liste.find((a) => a.rule === 'Nettoyage.ContenuPerdu');
      assert.ok(alerte1 && alerte1.severity === 'error', JSON.stringify(rap1.alertes.liste));
      assert.ok(rap1.controles.perte_de_contenu.images_sortie < rap1.controles.perte_de_contenu.images_entree);
      // Une partie seulement : le document est livré, mais l'alerte error le dit.
      const sortie2 = path.join(base, 'partielle');
      fs.mkdirSync(sortie2);
      const r2 = python(['-c', PONT_SABOTE, PIPELINE, NETTOYEUR, '0.5', entree, '--sortie', sortie2]
        .concat(OPTIONS));
      const o2 = JSON.parse(r2.stdout.trim().split('\n').pop());
      assert.strictEqual(o2.code_sortie, 1, 'une alerte error doit donner le code 1 : ' + r2.stderr);
      assert.ok(o2.sortie_docx && fs.existsSync(o2.sortie_docx));
      const rap2 = JSON.parse(fs.readFileSync(o2.sortie_rapport, 'utf8'));
      assert.ok(rap2.alertes.liste.some((a) => a.rule === 'Nettoyage.ContenuPerdu'
        && a.severity === 'error'), 'perte partielle non dite : ' + JSON.stringify(rap2.controles));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
