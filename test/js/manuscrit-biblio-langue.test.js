// pipeline/manuscrit_biblio.py — déterminisme du jeton annoncé et langue des messages.
//
//   node --test test/js/manuscrit-biblio-langue.test.js
//
// Module pur, appelé par python() de gardes.js, sans réseau.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { python, cheminPython, sansPython } = require('./gardes');

const PIPELINE = path.resolve(__dirname, '..', '..', 'pipeline');

function executer(corps, graine) {
  const programme = [
    'import sys, json',
    'sys.path.insert(0, ' + JSON.stringify(cheminPython(PIPELINE)) + ')',
    'import manuscrit_biblio as mb',
    corps,
  ].join('\n');
  const r = python( ['-c', programme], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' },
      graine === undefined ? {} : { PYTHONHASHSEED: String(graine) }),
  });
  assert.strictEqual(r.status, 0, 'le script Python a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('_jeton_manquant : le premier jeton absent dans l\'ordre du texte, quelle que soit '
  + 'PYTHONHASHSEED', { skip: sansPython }, () => {
  const corps = [
    'orig = "Schalock, R. L., & Braddock, D. (2010). Intellectual disability. Washington."',
    'print(json.dumps(mb._jeton_manquant(orig, "Intellectual disability.")))',
  ].join('\n');
  for (const graine of [0, 1, 2, 3, 4, 5, 6, 7]) {
    assert.strictEqual(executer(corps, graine), 'schalock', 'graine ' + graine);
  }
});

// ---------------------------------------------------------------------------------
// Langue des messages : le catalogue `MESSAGES` est la seule source. Une fixture allemande
// qui déclenche le plus de règles possible ne doit rien laisser de français.

const FIXTURE = [
  'def fausse_requete(url, delai):',
  "    if '/works/' in url:",
  "        return json.dumps({'message': {'author': [{'family': 'Autre'}],",
  "            'title': ['Völlig anderer Titel'], 'issued': {'date-parts': [[1990]]}}}).encode('utf-8')",
  "    return json.dumps({'message': {'items': [{'title': ['Wirkungen von Coaching auf Planung "
    + "und Unterricht'], 'author': [{'family': 'Ploessl'}], 'issued': {'date-parts': [[2014]]},",
  "        'DOI': '10.1177/8756870514540836'}]}}).encode('utf-8')",
  'mb._requete = fausse_requete',
  'corps = [{"texte": "Das ist belegt (Zimmer, 2001) und bestätigt (Weber, 2010b). Ebenso '
    + '(Keller et al., 2015) sowie (Berger, 2012) und (Huber, 2018). Ferner (UNESCO, 2017). '
    + 'Dazu (Ploessl & Rock, 2014).", "source": 1}]',
  'biblio = [',
  '  {"texte": "Weber, A. (2010). Schule und Inklusion. Beltz.", "source": 10},',
  '  {"texte": "Weber, A. (2010). Schule und Teilhabe. Beltz.", "source": 11},',
  '  {"texte": "Keller, M., & Frei, S. (2015). Zusammenarbeit im Team. Haupt.", "source": 12},',
  '  {"texte": "Berger, L., Frei, S., & Moser, T. (2012). Heilpädagogik heute. Klett.", "source": 13},',
  '  {"texte": "Huber, C. (2016). Integration. Springer.", "source": 14},',
  '  {"texte": "UNESCO 2017 Education report", "source": 15},',
  '  {"texte": "Abegg, R. (2011). Nie zitierte Arbeit. Verlag.", "source": 16},',
  '  {"texte": "Müller, K. (2019). Ein Artikel. Zeitschrift für Heilpädagogik, 70(2), 10–20. '
    + 'doi: 10.1000/xyz123", "source": 17},',
  '  {"texte": "Ploessl, D. M., & Rock, M. L. (2014). Wirkungen von Coaching auf Planung und '
    + 'Unterricht. Teacher Education and Special Education, 37(3), 191–215.", "source": 18},',
  ']',
  'sortie = {}',
  "for langue in ('fr', 'de'):",
  '    alertes, _ = mb.analyser_bibliographie(corps, biblio, langue, reseau=True)',
  "    sortie[langue] = sorted({(a['rule'], a['message']) for a in alertes})",
  'print(json.dumps(sortie))',
].join('\n');

const REGLES_ATTENDUES = ['APA.CitationAbsente', 'APA.Suffixe', 'APA.EtAl',
  'APA.ReferenceNonCitee', 'APA.ReferenceNonVerifiee', 'APA.OrdreBiblio', 'APA.DoiForme',
  'APA.DoiDivergent', 'APA.MiseEnForme', 'APA.DoiRetrouve'];

// Marqueurs du français : mots-outils et mots de métier, accents, apostrophe courbe,
// insécable. L'allemand n'en porte aucun.
const MARQUEURS_FR = /\b(la|le|les|du|une?|ne|pas|est|cette|ce|référence|citation|bibliographie|année|auteurs?|renvoie)\b|[’ éèêàçôîû]/i;

const NBSP = ' ';
const FR_ATTENDU = [
  ['APA.CitationAbsente', `Cette citation ne correspond à aucune référence de la bibliographie${NBSP}: «${NBSP}Huber, 2018${NBSP}». La bibliographie porte « Huber » avec l'année 2016 : vérifier l'année.`],
  ['APA.CitationAbsente', `Cette citation ne correspond à aucune référence de la bibliographie${NBSP}: «${NBSP}Zimmer, 2001${NBSP}».`],
  ['APA.DoiDivergent', 'Le DOI renvoie à une autre publication (auteur, annee, titre).'],
  ['APA.DoiForme', `Le DOI n’est pas écrit sous sa forme normalisée «${NBSP}https://doi.org/10.1000/xyz123${NBSP}».`],
  ['APA.DoiRetrouve', `Un DOI correspondant a été trouvé pour cette référence${NBSP}: https://doi.org/10.1177/8756870514540836 (à confirmer avant de l’accepter).`],
  ['APA.EtAl', `Cette référence compte 3 auteurs${NBSP}: la citation doit porter «${NBSP}et al.${NBSP}» («${NBSP}Berger et al. (2012)${NBSP}»).`],
  ['APA.EtAl', `Cette référence ne compte que 2 auteur(s)${NBSP}: «${NBSP}et al.${NBSP}» est de trop («${NBSP}Keller & Frei (2015)${NBSP}»).`],
  ['APA.MiseEnForme', `La mise en forme APA 7 de cette référence diffère de l’original${NBSP}– révision proposée.`],
  ['APA.MiseEnForme', `La mise en forme APA 7 de cette référence diffère de l’original${NBSP}– révision proposée. DOI ajouté : un DOI correspondant a été trouvé (https://doi.org/10.1177/8756870514540836), à confirmer avant d'accepter cette révision.`],
  ['APA.OrdreBiblio', `Référence mal classée${NBSP}: l’ordre alphabétique puis chronologique n’est pas respecté.`],
  ['APA.ReferenceNonCitee', 'Cette référence ne semble jamais citée dans le texte.'],
  ['APA.ReferenceNonVerifiee', `La référence «${NBSP}UNESCO, 2017${NBSP}» n’a pas pu être vérifiée automatiquement${NBSP}: son format n’a pas été reconnu. Contrôlez l’entrée correspondante dans la liste des références, puis corrigez cet appel si nécessaire.`],
  ['APA.Suffixe', `Le suffixe «${NBSP}b${NBSP}» de cette citation ne correspond à aucune référence du même auteur et de la même année.`],
  ['APA.Suffixe', 'Plusieurs références du même auteur et de la même année (2010) ne sont pas distinguées par a/b/c.'],
];

test('langue de : aucune alerte de la fixture allemande ne porte de français, '
  + 'et la fixture déclenche toutes les règles du module', { skip: sansPython }, () => {
  const sortie = executer(FIXTURE);
  const regles = new Set(sortie.de.map((a) => a[0]));
  for (const r of REGLES_ATTENDUES) { assert.ok(regles.has(r), 'règle non déclenchée : ' + r); }
  assert.strictEqual(sortie.de.length, sortie.fr.length);
  for (const [regle, message] of sortie.de) {
    assert.ok(!MARQUEURS_FR.test(message), regle + ' : français en langue de : ' + message);
  }
});

// Écriture inclusive des Richtlinien : « Autor:in » au singulier, « Autor:innen » au pluriel,
// jamais « Autor:in(nen) » ; un seul terme pour la citation dans le texte (Quellenangabe) et un
// seul pour l'entrée de la liste (Eintrag) ; la forme normée du DOI est étiquetée.
// Sabotage : remettre 'Autor:in(nen)', 'Verweis' ou l'ancienne phrase du DOI dans MESSAGES.
test('langue de : Autor:in / Autor:innen selon le nombre, Quellenangabe et Eintrag partout, forme du DOI étiquetée', { skip: sansPython }, () => {
    const sortie = executer([
      'def tester(corps, biblio):',
      "    alertes, _ = mb.analyser_bibliographie(corps, biblio, 'de', reseau=False)",
      "    return sorted(a['message'] for a in alertes if a['rule'] == 'APA.EtAl')",
      "un = tester([{'texte': 'Gesagt (Huber et al., 2016).', 'source': 1}],",
      "            [{'texte': 'Huber, C. (2016). Integration. Springer.', 'source': 10}])",
      "deux = tester([{'texte': 'Gesagt (Keller et al., 2015).', 'source': 1}],",
      "              [{'texte': 'Keller, M., & Frei, S. (2015). Teamarbeit. Haupt.', 'source': 10}])",
      'print(json.dumps({"un": un, "deux": deux, "catalogue": mb.MESSAGES}))',
    ].join(String.fromCharCode(10)));
    assert.strictEqual(sortie.un.length, 1);
    assert.match(sortie.un[0], /nur 1 Autor:in: /);
    assert.match(sortie.deux[0], /nur 2 Autor:innen: /);
    for (const [id, t] of Object.entries(sortie.catalogue)) {
      assert.ok(!/Autor:in\(nen\)|Verweis/.test(t.de), id + ' : ' + t.de);
    }
    assert.match(sortie.catalogue['APA.DoiForme'].de, /^Der DOI ist nicht in der normierten Form geschrieben\. Normierte Form: «%s»\.$/);
    assert.match(sortie.catalogue['APA.ReferenceNonVerifiee'].de, /^Die Quellenangabe «%s» .*diese Quellenangabe bei Bedarf\.$/);
  });

test('langue fr : les textes français sont inchangés mot pour mot', { skip: sansPython }, () => {
  const sortie = executer(FIXTURE);
  const norm = (l) => l.map((a) => a.join('\u0000')).sort();
  assert.deepStrictEqual(norm(sortie.fr), norm(FR_ATTENDU));
});

test('catalogue MESSAGES : chaque identifiant existe dans les deux langues, sans français '
  + 'côté de, et aucun message n\'est resté en dur', { skip: sansPython }, () => {
  const cat = executer('print(json.dumps(mb.MESSAGES))');
  assert.ok(Object.keys(cat).length >= 15);
  for (const [id, textes] of Object.entries(cat)) {
    assert.deepStrictEqual(Object.keys(textes).sort(), ['de', 'fr'], id);
    assert.ok(!MARQUEURS_FR.test(textes.de), id + ' : français côté de : ' + textes.de);
    assert.ok(textes.de.length > 10 && textes.de !== textes.fr, id);
  }
  // Tout `'message':` du module passe par _msg() (ou une variable construite par _msg()).
  const source = fs.readFileSync(path.join(PIPELINE, 'manuscrit_biblio.py'), 'utf8');
  assert.ok(!/'message':\s*'/.test(source), 'un message littéral subsiste dans manuscrit_biblio.py');
  assert.ok(!/message\s*\+?=\s*\(?'/.test(source), 'un message littéral subsiste (variable)');
});
