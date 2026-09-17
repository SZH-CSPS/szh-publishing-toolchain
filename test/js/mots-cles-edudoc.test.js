// Le vocabulaire edudoc.ch : parseur MARC 690 (namespace « marc: » toléré), fusion sans
// suppression, moissonnage par set avec resumptionToken, repli sur 503, cache.
//
//   node --test "test/js/*.test.js"
//
// AUCUN réseau ici : le moissonnage prend sa fonction de récupération en paramètre, et les
// tests lui donnent une table de fixtures XML — y compris du XML tronqué et hostile, qui
// doit rendre moins de records, jamais une exception. Le cache passe par SZH_MOTS_CLES_CACHE
// pour ne pas toucher C:\ProgramData ; l'écriture atomique de lib/yaml.js ne doit pas
// laisser de temporaire derrière elle.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');

const motsClesEdudoc = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'mots-cles-edudoc.js'));
const {
  ENDPOINT_EDUDOC_DEFAUT, SETS_EDUDOC_DEFAUT, JOURS_FRAICHEUR,
  extraireRecordsMotsCles, recordsEnMotsCles, fusionnerMotsCles,
  lireCacheMotsCles, ecrireCacheMotsCles, cacheFraisMotsCles,
  configEdudoc, recupererAvecRepli, moissonnerMotsCles, rafraichirMotsCles,
  plierDescripteur, indexerThesaurus, apparierDescripteurs
} = motsClesEdudoc;

// ---- Fixtures : ce qu'edudoc.ch répond réellement (relevé le 31.08.2026) --------------

function enveloppe(corps, requete) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?xml-stylesheet type="text/xsl" href="https://edudoc.ch/css/oai2.xsl.v1.0" ?>\n' +
    '<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">\n' +
    '<responseDate>2026-08-31T08:00:00Z</responseDate>' +
    '<request verb="ListRecords">' + (requete || 'https://edudoc.ch/oai2d') + '</request>\n' +
    corps + '\n</OAI-PMH>\n';
}

// Un champ 690, namespace marc: — la forme réelle de l'instance. `de`/`fr` peuvent être
// null pour simuler une paire incomplète (le sous-champ correspondant n'est simplement pas
// écrit, comme sur les 10 notices réelles où cela arrive).
function champ690(de, fr) {
  const sousA = de === null ? '' : '\n    <marc:subfield code="a">' + de + '</marc:subfield>';
  const sousB = fr === null ? '' : '\n    <marc:subfield code="b">' + fr + '</marc:subfield>';
  return '  <marc:datafield tag="690" ind1=" " ind2=" ">' + sousA + sousB + '\n  </marc:datafield>';
}

// Un record OAI complet, avec sa notice marc:record imbriquée — reprend la structure
// exacte observée (namespace sur record/datafield/subfield, <record> OAI nu).
function record(datestamp, paires690, options) {
  const o = options || {};
  const statut = o.deleted ? ' status="deleted"' : '';
  if (o.deleted) {
    return '<record><header' + statut + '>' +
      '<identifier>oai:edudoc.ch:1</identifier><datestamp>' + datestamp + '</datestamp>' +
      '</header></record>';
  }
  const champs = paires690.map((p) => champ690(p[0], p[1])).join('\n');
  return '<record><header>' +
    '<identifier>oai:edudoc.ch:100984</identifier><datestamp>' + datestamp + '</datestamp>' +
    '<setSpec>Articles</setSpec><setSpec>Revue suisse de pédagogie spécialisée</setSpec>' +
    '</header><metadata><marc:record xmlns:marc="http://www.loc.gov/MARC21/slim" type="Bibliographic">\n' +
    '  <marc:leader>          22        4500</marc:leader>\n' +
    '  <marc:controlfield tag="001">100984</marc:controlfield>\n' +
    '  <marc:datafield tag="245" ind1=" " ind2=" ">\n' +
    '    <marc:subfield code="a">Un titre qui ne doit pas passer pour un descripteur</marc:subfield>\n' +
    '  </marc:datafield>\n' +
    champs + '\n' +
    '  <marc:datafield tag="700" ind1="1" ind2=" ">\n' +
    '    <marc:subfield code="a">Jost-Hurni, Myriam</marc:subfield>\n' +
    '    <marc:subfield code="0">207683</marc:subfield>\n' +
    '  </marc:datafield>\n' +
    '</marc:record></metadata></record>';
}

function pageListRecords(records, token) {
  const queue = token === undefined ? '' :
    '<resumptionToken expirationDate="2026-09-01T00:00:00Z"\n' +
    '  cursor="0" completeListSize="2385">' + token + '</resumptionToken>';
  return enveloppe('<ListRecords>' + records.join('') + queue + '</ListRecords>');
}

// Fragment RÉEL, copié tel quel de l'instance (set Revue, notice oai:edudoc.ch:100984,
// moissonnage du 31.08.2026) — verrues comprises : indentation propre cette fois (contraste
// avec OJS), mais le namespace marc: partout, y compris sur <marc:record> lui-même.
const FRAGMENT_REEL = [
  '<record><header><identifier>oai:edudoc.ch:100984</identifier>',
  '<datestamp>2026-03-05T10:07:02Z</datestamp>',
  '<setSpec>Articles</setSpec><setSpec>politic</setSpec>',
  '<setSpec>Revue suisse de pédagogie spécialisée</setSpec></header>',
  '<metadata><marc:record xmlns:marc="http://www.loc.gov/MARC21/slim" ',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ',
  'xsi:schemaLocation="http://www.loc.gov/MARC21/slim ',
  'http://www.loc.gov/standards/marcxml/schema/MARC21slim.xsd" type="Bibliographic">',
  '     <marc:leader>          22        4500</marc:leader>',
  '  <marc:controlfield tag="001">100984</marc:controlfield>',
  '  <marc:controlfield tag="005">20260305110702.0</marc:controlfield>',
  '  <marc:datafield tag="041" ind1=" " ind2=" ">',
  '    <marc:subfield code="a">fre</marc:subfield>',
  '  </marc:datafield>',
  '  <marc:datafield tag="245" ind1=" " ind2=" ">',
  "    <marc:subfield code=\"a\">L'Agence européenne pour le développement de l'éducation des personnes ayant des besoins particuliers</marc:subfield>",
  '    <marc:subfield code="c">Myriam Jost-Hurni</marc:subfield>',
  '  </marc:datafield>',
  '  <marc:datafield tag="690" ind1=" " ind2=" ">',
  '    <marc:subfield code="a">Sonderschulwesen</marc:subfield>',
  '    <marc:subfield code="b">enseignement spécialisé</marc:subfield>',
  '  </marc:datafield>',
  '  <marc:datafield tag="690" ind1=" " ind2=" ">',
  '    <marc:subfield code="a">Sonderpädagogik</marc:subfield>',
  '    <marc:subfield code="b">pédagogie spécialisée</marc:subfield>',
  '  </marc:datafield>',
  '  <marc:datafield tag="700" ind1="1" ind2=" ">',
  '    <marc:subfield code="a">Jost-Hurni, Myriam</marc:subfield>',
  '    <marc:subfield code="0">207683</marc:subfield>',
  '  </marc:datafield>',
  '</marc:record>',
  '</metadata></record>'
].join('\n');

function cacheTemporaire(nom) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-motscles-' + nom + '-'));
  return path.join(dossier, 'mots-cles.json');
}

function avecCache(nom, fn) {
  const avant = process.env.SZH_MOTS_CLES_CACHE;
  process.env.SZH_MOTS_CLES_CACHE = cacheTemporaire(nom);
  try { return fn(process.env.SZH_MOTS_CLES_CACHE); }
  finally {
    if (avant === undefined) { delete process.env.SZH_MOTS_CLES_CACHE; }
    else { process.env.SZH_MOTS_CLES_CACHE = avant; }
  }
}

async function avecCacheAsync(nom, fn) {
  const avant = process.env.SZH_MOTS_CLES_CACHE;
  process.env.SZH_MOTS_CLES_CACHE = cacheTemporaire(nom);
  try { return await fn(process.env.SZH_MOTS_CLES_CACHE); }
  finally {
    if (avant === undefined) { delete process.env.SZH_MOTS_CLES_CACHE; }
    else { process.env.SZH_MOTS_CLES_CACHE = avant; }
  }
}

// Un https.get factice, identique dans l'esprit à celui de auteurs-ojs.test.js : rejoue les
// réponses (y compris un 503) sans réseau ni attente réelle.
function fauxTransport(scenario) {
  return (url, options, cb) => {
    const req = new EventEmitter();
    req.detruit = false;
    req.destroy = (e) => { req.detruit = true; if (e) { req.emit('error', e); } };
    const s = scenario(url, req);
    const res = new EventEmitter();
    res.statusCode = s.code;
    res.headers = s.headers || {};
    res.resume = () => {};
    setImmediate(() => {
      cb(res);
      setImmediate(() => {
        for (const m of (s.morceaux || [])) { res.emit('data', Buffer.from(m)); }
        res.emit('end');
      });
    });
    return req;
  };
}

// ---- Parseur : extraireRecordsMotsCles ------------------------------------------------

test('extraireRecordsMotsCles : une réponse ordinaire, plusieurs descripteurs par notice', () => {
  const xml = pageListRecords([
    record('2011-01-01T00:00:00Z', [
      ['Sonderschulwesen', 'enseignement spécialisé'],
      ['Sonderpädagogik', 'pédagogie spécialisée']
    ])
  ]);
  const records = extraireRecordsMotsCles(xml);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].datestamp, '2011-01-01T00:00:00Z');
  assert.strictEqual(records[0].deleted, false);
  assert.deepStrictEqual(records[0].descripteurs, [
    { de: 'Sonderschulwesen', fr: 'enseignement spécialisé', manque: null },
    { de: 'Sonderpädagogik', fr: 'pédagogie spécialisée', manque: null }
  ]);
});

test('extraireRecordsMotsCles : le fragment RÉEL de l’instance, namespace marc: partout', () => {
  const xml = enveloppe('<ListRecords>' + FRAGMENT_REEL + '</ListRecords>');
  const records = extraireRecordsMotsCles(xml);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].datestamp, '2026-03-05T10:07:02Z');
  assert.strictEqual(records[0].deleted, false);
  assert.deepStrictEqual(records[0].descripteurs, [
    { de: 'Sonderschulwesen', fr: 'enseignement spécialisé', manque: null },
    { de: 'Sonderpädagogik', fr: 'pédagogie spécialisée', manque: null }
  ]);
  // Le datafield 245 (titre) et le 700 (auteur, avec son $0 numérique) ne doivent produire
  // aucun descripteur : seul le 690 compte.
  assert.strictEqual(records[0].descripteurs.length, 2);
});

test('extraireRecordsMotsCles : paire incomplète — jamais rejetée, le manque est signalé', () => {
  const xml = pageListRecords([
    record('2024-01-01T00:00:00Z', [
      ['Berufsbildung', null],          // français absent — rencontré réellement (8/10975)
      [null, 'diagnostic']              // allemand absent — rencontré réellement (2/10975)
    ])
  ]);
  const records = extraireRecordsMotsCles(xml);
  assert.deepStrictEqual(records[0].descripteurs, [
    { de: 'Berufsbildung', fr: '', manque: 'fr' },
    { de: '', fr: 'diagnostic', manque: 'de' }
  ]);
});

test('extraireRecordsMotsCles : un $a et un $b tous les deux absents ne produit rien', () => {
  const xml = '<record><header><datestamp>2024-01-01T00:00:00Z</datestamp></header>' +
    '<metadata><marc:record><marc:datafield tag="690" ind1=" " ind2=" ">' +
    '</marc:datafield></marc:record></metadata></record>';
  assert.deepStrictEqual(extraireRecordsMotsCles(enveloppe('<ListRecords>' + xml + '</ListRecords>'))[0].descripteurs, []);
});

test('extraireRecordsMotsCles : un record deleted est reconnu, et recordsEnMotsCles l’écarte', () => {
  const xml = pageListRecords([
    record('2024-01-01T00:00:00Z', [], { deleted: true }),
    record('2024-02-02T00:00:00Z', [['Evaluation', 'évaluation']])
  ]);
  const records = extraireRecordsMotsCles(xml);
  assert.strictEqual(records[0].deleted, true);
  assert.strictEqual(records[1].deleted, false);
  const mots = recordsEnMotsCles(records);
  assert.deepStrictEqual(mots, [{ de: 'Evaluation', fr: 'évaluation', manque: null }]);
});

test('extraireRecordsMotsCles : XML tronqué ou hostile ne lève jamais', () => {
  const hostiles = [
    '', null, undefined, 12345,
    '<record><header><datestamp>2024',
    pageListRecords([record('2024-01-01T00:00:00Z', [['A', 'B']])]).slice(0, 250),
    '<html><body>Service momentanément indisponible</body></html>',
    '<record>' + '<marc:datafield tag="690">'.repeat(500),
    '<record><header status="deleted"></record>'.repeat(50)
  ];
  for (const xml of hostiles) {
    assert.doesNotThrow(() => { extraireRecordsMotsCles(xml); }, 'a levé sur : ' + String(xml).slice(0, 40));
    assert.ok(Array.isArray(extraireRecordsMotsCles(xml)));
  }
});

// ---- Set vide ---------------------------------------------------------------------------

test('extraireRecordsMotsCles : un set vide (ListRecords sans notice) rend une liste vide', () => {
  const xml = enveloppe('<ListRecords></ListRecords>');
  assert.deepStrictEqual(extraireRecordsMotsCles(xml), []);
});

// ---- Fusion et déduplication ------------------------------------------------------------

test('fusionnerMotsCles : dédoublonnage par forme normalisée (casse et accents)', () => {
  const fusion = fusionnerMotsCles(
    [{ de: 'Sonderpädagogik', fr: 'pédagogie spécialisée', manque: null }],
    [{ de: 'SONDERPÄDAGOGIK', fr: 'Pédagogie Spécialisée', manque: null }]
  );
  assert.strictEqual(fusion.length, 1, 'une variante de casse/accents ne doit pas dupliquer');
  assert.strictEqual(fusion[0].de, 'Sonderpädagogik', 'la première graphie rencontrée fait foi');
});

test('fusionnerMotsCles : une paire incomplète est complétée par une paire complète arrivée ensuite', () => {
  const fusion = fusionnerMotsCles(
    [{ de: 'Berufsbildung', fr: '', manque: 'fr' }],
    [{ de: 'Berufsbildung', fr: 'formation professionnelle', manque: null }]
  );
  assert.strictEqual(fusion.length, 1);
  assert.strictEqual(fusion[0].fr, 'formation professionnelle');
  assert.strictEqual(fusion[0].manque, null, 'le manque doit être levé une fois comblé');
});

test('fusionnerMotsCles : et dans l’autre sens — le français retrouve l’allemand qui manquait', () => {
  const fusion = fusionnerMotsCles(
    [{ de: '', fr: 'diagnostic', manque: 'de' }],
    [{ de: 'Diagnose', fr: 'diagnostic', manque: null }]
  );
  assert.strictEqual(fusion.length, 1);
  assert.strictEqual(fusion[0].de, 'Diagnose');
  assert.strictEqual(fusion[0].manque, null);
});

// Cas RÉEL rencontré lors du moissonnage complet du 31.08.2026 : « Lernschwierigkeit » porte
// deux traductions concurrentes sur l'instance. Un vrai désaccord ne doit ni s'écraser en
// silence, ni faire disparaître l'une des deux formes.
test('fusionnerMotsCles : un désaccord réel entre deux moissons donne deux entrées, jamais un écrasement muet', () => {
  const fusion = fusionnerMotsCles(
    [{ de: 'Lernschwierigkeit', fr: "difficulté d'apprentissage", manque: null }],
    [{ de: 'Lernschwierigkeit', fr: "difficulté de l'apprentissage", manque: null }]
  );
  assert.strictEqual(fusion.length, 2, 'les deux traductions doivent survivre');
  assert.deepStrictEqual(fusion.map((m) => m.fr).sort(), [
    "difficulté d'apprentissage", "difficulté de l'apprentissage"
  ].sort());
  assert.ok(fusion.every((m) => m.de === 'Lernschwierigkeit'));
});

// Symétrique du cas ci-dessus : les trois scénarios de désaccord du fichier (lignes
// précédentes) varient tous sur le FRANÇAIS avec un ALLEMAND identique — la branche
// « else if (de !== '' && kd !== '' && plierTexte(existant.de) !== kd) » (mots-cles-edudoc.js,
// juste avant la règle symétrique du français) n'était donc jamais exercée sur un vrai
// désaccord côté allemand.
test('fusionnerMotsCles : un désaccord réel sur l’ALLEMAND, français identique, donne deux entrées', () => {
  const fusion = fusionnerMotsCles(
    [{ de: 'Lernbehinderung', fr: 'difficulté', manque: null }],
    [{ de: 'Lernstörung', fr: 'difficulté', manque: null }]
  );
  assert.strictEqual(fusion.length, 2, 'les deux allemands concurrents doivent survivre');
  assert.deepStrictEqual(fusion.map((m) => m.de).sort(), ['Lernbehinderung', 'Lernstörung'].sort());
  assert.ok(fusion.every((m) => m.fr === 'difficulté'));
});

test('fusionnerMotsCles : jamais de suppression — rejouer un moissonnage vide garde tout', () => {
  const existants = [
    { de: 'Europa', fr: 'Europe', manque: null },
    { de: 'Schüler', fr: 'élève', manque: null }
  ];
  assert.deepStrictEqual(fusionnerMotsCles(existants, []), existants);
  assert.deepStrictEqual(fusionnerMotsCles(existants, undefined), existants);
});

test('fusionnerMotsCles : idempotence — rejouer le même moissonnage ne change rien', () => {
  const un = fusionnerMotsCles([], [
    { de: 'Standard', fr: 'standard', manque: null },
    { de: 'Schüler', fr: 'élève', manque: null }
  ]);
  const deux = fusionnerMotsCles(un, [
    { de: 'Standard', fr: 'standard', manque: null },
    { de: 'Schüler', fr: 'élève', manque: null }
  ]);
  assert.deepStrictEqual(deux, un);
});

test('fusionnerMotsCles : une entrée sans allemand ni français est écartée', () => {
  assert.deepStrictEqual(fusionnerMotsCles([{ de: '', fr: '', manque: null }], []), []);
  assert.deepStrictEqual(fusionnerMotsCles([], [{ de: '', fr: '' }]), []);
});

// Cas RÉEL, relevé sur C:\ProgramData\SZH\mots-cles.json : 1148 entrées pour 922 paires
// distinctes, 226 doublons exacts — « Prävention (na) / prévention (na) » y figure 46 fois.
// La cause : après un fork sur désaccord (même allemand, français distinct), parDe continue
// de désigner l'entrée D'ORIGINE (jamais réécrite), donc un troisième descripteur identique
// au FORK ne le retrouve jamais par ce chemin et forke une nouvelle fois — répété à chaque
// notice qui remoissonne le même terme.
test('fusionnerMotsCles : un doublon rigoureusement identique, répété après un fork, ne s’empile pas', () => {
  const moisson = [{ de: 'Prävention (na)', fr: 'prévention', manque: null }];
  for (let i = 0; i < 5; i++) {
    moisson.push({ de: 'Prävention (na)', fr: 'prévention (na)', manque: null });
  }
  const fusion = fusionnerMotsCles([], moisson);
  assert.strictEqual(fusion.length, 2, 'la variante, puis le fork une seule fois — pas cinq');
  assert.deepStrictEqual(fusion.map((m) => m.fr).sort(), ['prévention', 'prévention (na)'].sort());
  assert.ok(fusion.every((m) => m.de === 'Prävention (na)'));
});

test('fusionnerMotsCles : le fork sur un vrai désaccord reste préservé (non-régression)', () => {
  const fusion = fusionnerMotsCles(
    [{ de: 'Lernschwierigkeit', fr: "difficulté d'apprentissage", manque: null }],
    [{ de: 'Lernschwierigkeit', fr: "difficulté de l'apprentissage", manque: null }]
  );
  assert.strictEqual(fusion.length, 2, 'deux vraies traductions concurrentes doivent survivre');
});

test('fusionnerMotsCles : une chaîne de trois forks légitimes, chacun redondé plusieurs fois', () => {
  const moisson = [
    { de: 'X', fr: 'un', manque: null },
    { de: 'X', fr: 'deux', manque: null },       // fork n°1 (français différent)
    { de: 'X', fr: 'trois', manque: null },      // fork n°2 (français différent, encore)
    { de: 'X', fr: 'deux', manque: null },       // doublon du fork n°1
    { de: 'X', fr: 'trois', manque: null },      // doublon du fork n°2
    { de: 'X', fr: 'un', manque: null }          // doublon de la toute première entrée
  ];
  const fusion = fusionnerMotsCles([], moisson);
  assert.strictEqual(fusion.length, 3, 'trois traductions distinctes, aucun doublon supplémentaire');
  assert.deepStrictEqual(fusion.map((m) => m.fr).sort(), ['deux', 'trois', 'un']);
  assert.ok(fusion.every((m) => m.de === 'X'));
});

// Le prochain rafraîchissement appelle fusionnerMotsCles(cache.motsCles, nouveaux) — un
// cache DÉJÀ pollué (moissonné avant la correction) doit donc se replier tout seul dès qu'il
// retraverse fusionnerMotsCles, même sans aucun mot-clé neuf à fusionner.
test('fusionnerMotsCles : un cache déjà pollué se replie de lui-même, même sans rien de neuf à fusionner', () => {
  const pollue = [
    { de: 'Prävention (na)', fr: 'prévention', manque: null },
    { de: 'Prävention (na)', fr: 'prévention (na)', manque: null },
    { de: 'Prävention (na)', fr: 'prévention (na)', manque: null },
    { de: 'Prävention (na)', fr: 'prévention (na)', manque: null },
    { de: 'Sprachentwicklung', fr: 'développement du langage', manque: null },
    { de: 'Sprachentwicklung', fr: 'développement du langage', manque: null }
  ];
  const fusion = fusionnerMotsCles(pollue, []);
  assert.strictEqual(fusion.length, 3);
  assert.deepStrictEqual(fusion.map((m) => m.fr).sort(), [
    'développement du langage', 'prévention', 'prévention (na)'
  ]);
});

// ---- Moissonnage (récupération injectée : aucun réseau) --------------------------------

test('moissonnerMotsCles : première requête — set et metadataPrefix, from incrémental', async () => {
  const endpoint = 'https://exemple.test/oai2d';
  const setSpec = 'Revue suisse de pédagogie spécialisée';
  let premiere = null;
  const recuperer = async (url) => {
    premiere = premiere || url;
    return pageListRecords([record('2026-08-01T00:00:00Z', [['Standard', 'standard']])]);
  };
  await moissonnerMotsCles(recuperer, endpoint, setSpec, '2026-07-01');
  assert.strictEqual(premiere,
    endpoint + '?verb=ListRecords&metadataPrefix=marcxml&set=' + encodeURIComponent(setSpec) +
    '&from=2026-07-01');
});

test('moissonnerMotsCles : sans from, la première requête n’en porte pas', async () => {
  const endpoint = 'https://exemple.test/oai2d';
  const setSpec = 'Schweizerische Zeitschrift für Heilpädagogik';
  let premiere = null;
  const recuperer = async (url) => {
    premiere = premiere || url;
    return pageListRecords([record('2026-08-01T00:00:00Z', [['Standard', 'standard']])]);
  };
  await moissonnerMotsCles(recuperer, endpoint, setSpec, null);
  assert.strictEqual(premiere,
    endpoint + '?verb=ListRecords&metadataPrefix=marcxml&set=' + encodeURIComponent(setSpec));
});

test('moissonnerMotsCles : suit les resumptionToken — le token seul sur les pages suivantes', async () => {
  const endpoint = 'https://exemple.test/oai2d';
  const setSpec = 'Revue suisse de pédagogie spécialisée';
  const premiereUrl = endpoint + '?verb=ListRecords&metadataPrefix=marcxml&set=' +
    encodeURIComponent(setSpec);
  // Jeton fidèle à la forme réelle d'edudoc.ch : le nom du set y est inclus, avec espaces.
  const jeton1 = setSpec + '___4a9y8lth';
  const jeton2 = setSpec + '___infsjro7';
  const urlsVues = [];
  const pages = {};
  pages[premiereUrl] = pageListRecords([record('2026-03-01T00:00:00Z', [['A', 'B']])], jeton1);
  pages[endpoint + '?verb=ListRecords&resumptionToken=' + encodeURIComponent(jeton1)] =
    pageListRecords([record('2026-03-05T00:00:00Z', [['C', 'D']])], jeton2);
  pages[endpoint + '?verb=ListRecords&resumptionToken=' + encodeURIComponent(jeton2)] =
    pageListRecords([record('2026-03-10T00:00:00Z', [['E', 'F']])], '');
  const recuperer = async (url) => {
    urlsVues.push(url);
    if (!(url in pages)) { throw new Error('URL inattendue : ' + url); }
    return pages[url];
  };
  const records = await moissonnerMotsCles(recuperer, endpoint, setSpec, null);
  assert.strictEqual(records.length, 3);
  assert.deepStrictEqual(records.map((r) => r.descripteurs[0].de), ['A', 'C', 'E']);
  assert.strictEqual(urlsVues.length, 3, 'le token vide doit arrêter la boucle');
  assert.ok(urlsVues[1].indexOf('metadataPrefix') === -1, 'metadataPrefix envoyé avec un token');
  assert.ok(urlsVues[1].indexOf('set=') === -1, 'set envoyé avec un token');
});

test('moissonnerMotsCles : garde anti-boucle sur un resumptionToken répété', async () => {
  const page = pageListRecords([record('2024-01-01T00:00:00Z', [['A', 'B']])], 'toujours-le-meme');
  let appels = 0;
  const recuperer = async () => { appels++; return page; };
  await assert.rejects(
    () => moissonnerMotsCles(recuperer, 'https://exemple.test/oai2d', 'un-set', null),
    /resumptionToken r\u00e9p\u00e9t\u00e9/);
  assert.ok(appels <= 3, 'la boucle aurait dû s’arrêter au token déjà vu : ' + appels + ' appels');
});

test('moissonnerMotsCles : noRecordsMatch (set vide côté serveur) est un résultat vide, pas une panne', async () => {
  const recuperer = async () => enveloppe('<error code="noRecordsMatch">rien de neuf</error>');
  assert.deepStrictEqual(
    await moissonnerMotsCles(recuperer, 'https://exemple.test/oai2d', 'un-set', '2026-08-20'), []);
});

test('moissonnerMotsCles : une autre erreur OAI lève, avec le nom du set dans le message', async () => {
  const recuperer = async () => enveloppe('<error code="badArgument">from illisible</error>');
  await assert.rejects(
    () => moissonnerMotsCles(recuperer, 'https://exemple.test/oai2d', 'Mon Set', 'n-importe-quoi'),
    /badArgument.*Mon Set|Mon Set.*badArgument/);
});

// ---- Cache -------------------------------------------------------------------------------

const CACHE_VIDE = { dateFetch: null, motsCles: [] };

test('cache : absent, corrompu ou difforme -> cache vide, sans exception', () => {
  avecCache('lecture', (chemin) => {
    assert.deepStrictEqual(lireCacheMotsCles(), CACHE_VIDE);
    fs.writeFileSync(chemin, '{ pas du json', 'utf8');
    assert.deepStrictEqual(lireCacheMotsCles(), CACHE_VIDE);
    fs.writeFileSync(chemin, JSON.stringify({ dateFetch: 'x', motsCles: 'pas une liste' }), 'utf8');
    assert.deepStrictEqual(lireCacheMotsCles().motsCles, []);
    // Un BOM en tête ne rend pas le fichier illisible.
    fs.writeFileSync(chemin, '\uFEFF' + JSON.stringify({
      dateFetch: '2026-08-20T00:00:00Z',
      motsCles: [{ de: 'Standard', fr: 'standard', manque: null }]
    }), 'utf8');
    const cache = lireCacheMotsCles();
    assert.strictEqual(cache.dateFetch, '2026-08-20T00:00:00Z');
    assert.strictEqual(cache.motsCles.length, 1);
  });
});

test('cache : écriture atomique puis relecture, sans temporaire résiduel', () => {
  avecCache('ecriture', (chemin) => {
    const donnees = {
      dateFetch: '2026-08-31T12:00:00.000Z',
      motsCles: [
        { de: 'Sonderpädagogik', fr: 'pédagogie spécialisée', manque: null },
        { de: 'Berufsbildung', fr: '', manque: 'fr' }
      ]
    };
    assert.strictEqual(ecrireCacheMotsCles(donnees), null);
    assert.deepStrictEqual(lireCacheMotsCles(), donnees);
    const restes = fs.readdirSync(path.dirname(chemin)).filter((n) => n.startsWith('~$'));
    assert.deepStrictEqual(restes, [], 'temporaire d’écriture resté sur le disque');
  });
});

test('cacheFraisMotsCles : la fenêtre de fraîcheur, ses bornes et l’horloge repassée en arrière', () => {
  const maintenant = Date.parse('2026-08-31T12:00:00Z');
  const jour = 24 * 3600 * 1000;
  const cache = (date) => ({ dateFetch: date, motsCles: [] });
  const ilYA = (n) => cache(new Date(maintenant - n * jour).toISOString());
  assert.strictEqual(JOURS_FRAICHEUR, 30, 'la cadence retenue est mensuelle, comme les auteur·e·s');
  assert.strictEqual(cacheFraisMotsCles(cache('2026-08-31T11:00:00Z'), maintenant), true);
  assert.strictEqual(cacheFraisMotsCles(ilYA(JOURS_FRAICHEUR - 1), maintenant), true);
  assert.strictEqual(cacheFraisMotsCles(ilYA(JOURS_FRAICHEUR + 1), maintenant), false);
  assert.strictEqual(cacheFraisMotsCles(cache(new Date(maintenant + jour).toISOString()), maintenant), false);
  assert.strictEqual(cacheFraisMotsCles(cache(null), maintenant), false);
  assert.strictEqual(cacheFraisMotsCles(cache('pas une date'), maintenant), false);
  assert.strictEqual(cacheFraisMotsCles(null, maintenant), false);
});

// ---- Config -------------------------------------------------------------------------------

test('configEdudoc : défauts relevés le 31.08.2026, surcharge par config.json', () => {
  assert.deepStrictEqual(configEdudoc(null), { endpoint: ENDPOINT_EDUDOC_DEFAUT, sets: SETS_EDUDOC_DEFAUT });
  assert.deepStrictEqual(configEdudoc({}), { endpoint: ENDPOINT_EDUDOC_DEFAUT, sets: SETS_EDUDOC_DEFAUT });
  assert.deepStrictEqual(
    configEdudoc({ edudoc: { endpoint: 'https://autre.test/oai2d', sets: ['Set A', 'Set B'] } }),
    { endpoint: 'https://autre.test/oai2d', sets: ['Set A', 'Set B'] });
  // http en clair refusé ; sets vide ou absent retombe sur les défauts.
  assert.deepStrictEqual(configEdudoc({ edudoc: { endpoint: 'http://clair.test/oai2d' } }),
    { endpoint: ENDPOINT_EDUDOC_DEFAUT, sets: SETS_EDUDOC_DEFAUT });
  assert.deepStrictEqual(configEdudoc({ edudoc: { sets: [] } }),
    { endpoint: ENDPOINT_EDUDOC_DEFAUT, sets: SETS_EDUDOC_DEFAUT });
});

// ---- Réseau : repli sur le 503 « Retry after » (transport injecté, aucun réseau) --------

test('recupererAvecRepli : un 503 puis un succès — le repli fonctionne, sans attente réelle', async () => {
  let appels = 0;
  const transport = fauxTransport(() => {
    appels++;
    if (appels === 1) { return { code: 503, morceaux: ['Retry after 1 seconds'] }; }
    return { code: 200, morceaux: ['<OAI-PMH>ok</OAI-PMH>'] };
  });
  const corps = await recupererAvecRepli('https://edudoc.ch/oai2d', {
    transport: transport, delaisRepliMs: [0, 0]
  });
  assert.strictEqual(corps, '<OAI-PMH>ok</OAI-PMH>');
  assert.strictEqual(appels, 2, 'le premier 503 doit être suivi d’une seconde tentative');
});

test('recupererAvecRepli : un 503 persistant finit par lever, une fois les essais épuisés', async () => {
  let appels = 0;
  const transport = fauxTransport(() => { appels++; return { code: 503, morceaux: ['Retry after 1 seconds'] }; });
  await assert.rejects(
    () => recupererAvecRepli('https://edudoc.ch/oai2d', { transport: transport, delaisRepliMs: [0, 0] }),
    /HTTP 503/);
  assert.strictEqual(appels, 3, 'les deux délais de repli plus la tentative initiale');
});

test('recupererAvecRepli : une autre erreur HTTP n’est pas retentée', async () => {
  let appels = 0;
  const transport = fauxTransport(() => { appels++; return { code: 500, morceaux: [] }; });
  await assert.rejects(
    () => recupererAvecRepli('https://edudoc.ch/oai2d', { transport: transport, delaisRepliMs: [0, 0] }),
    /HTTP 500/);
  assert.strictEqual(appels, 1, 'seul le 503 déclenche un repli');
});

// ---- Rafraîchissement -----------------------------------------------------------------

test('rafraichirMotsCles : un cache encore frais ne déclenche AUCUN appel', async () => {
  await avecCacheAsync('frais', async () => {
    ecrireCacheMotsCles({ dateFetch: '2026-08-29T00:00:00Z', motsCles: [] });
    const recuperer = async () => { throw new Error('appel réseau interdit : cache frais'); };
    const res = await rafraichirMotsCles({
      maintenant: Date.parse('2026-08-31T12:00:00Z'), recuperer: recuperer, config: {}
    });
    assert.strictEqual(res.fait, false);
    assert.strictEqual(res.raison, 'frais');
  });
});

test('rafraichirMotsCles : moissonnage des deux sets, fusion et dateFetch avancée', async () => {
  await avecCacheAsync('complet', async () => {
    ecrireCacheMotsCles({
      dateFetch: '2026-07-01T00:00:00Z',
      motsCles: [{ de: 'Ancien', fr: 'ancien', manque: null }]
    });
    const urls = [];
    const recuperer = async (url) => {
      urls.push(url);
      if (url.indexOf('revue-a') !== -1) {
        return pageListRecords([record('2026-08-10T00:00:00Z', [['Standard', 'standard']])]);
      }
      return pageListRecords([
        // Doublon inter-sets (même clé pliée) et une paire incomplète.
        record('2026-08-12T00:00:00Z', [['STANDARD', 'Standard'], ['Berufsbildung', null]])
      ]);
    };
    const maintenant = Date.parse('2026-08-31T12:00:00Z');
    const res = await rafraichirMotsCles({
      maintenant: maintenant, recuperer: recuperer,
      config: { edudoc: { sets: ['revue-a', 'revue-b'] } }
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, true);
    const oai = urls.filter((u) => u.indexOf('exemple') === -1); // les deux vraies requêtes
    assert.strictEqual(urls.length, 2);
    for (const url of urls) { assert.ok(url.indexOf('from=2026-07-01') !== -1, 'from absent de ' + url); }
    const cache = lireCacheMotsCles();
    assert.strictEqual(cache.dateFetch, new Date(maintenant).toISOString());
    assert.deepStrictEqual(cache.motsCles.map((m) => m.de).sort(), ['Ancien', 'Berufsbildung', 'Standard']);
    const berufsbildung = cache.motsCles.filter((m) => m.de === 'Berufsbildung')[0];
    assert.strictEqual(berufsbildung.manque, 'fr', 'la paire incomplète doit garder son signal de manque');
  });
});

test('rafraichirMotsCles : un set muet -> fusion partielle, dateFetch INCHANGÉE, on réessaiera', async () => {
  await avecCacheAsync('partiel', async () => {
    ecrireCacheMotsCles({ dateFetch: '2026-07-01T00:00:00Z', motsCles: [] });
    const recuperer = async (url) => {
      if (url.indexOf('set-b') !== -1) { throw new Error('délai dépassé : ' + url); }
      return pageListRecords([record('2026-08-10T00:00:00Z', [['Evaluation', 'évaluation']])]);
    };
    const res = await rafraichirMotsCles({
      maintenant: Date.parse('2026-08-31T12:00:00Z'), recuperer: recuperer,
      config: { edudoc: { sets: ['set-a', 'set-b'] } }
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, false);
    assert.match(String(res.erreur), /délai dépassé/);
    const cache = lireCacheMotsCles();
    assert.strictEqual(cache.dateFetch, '2026-07-01T00:00:00Z', 'dateFetch ne doit pas avancer');
    assert.deepStrictEqual(cache.motsCles.map((m) => m.de), ['Evaluation'], 'le succès partiel est gardé');
  });
});

test('rafraichirMotsCles : hors ligne complet -> silencieux, rien réécrit', async () => {
  await avecCacheAsync('horsligne', async (chemin) => {
    ecrireCacheMotsCles({
      dateFetch: '2026-07-01T00:00:00Z',
      motsCles: [{ de: 'Standard', fr: 'standard', manque: null }]
    });
    const avant = fs.readFileSync(chemin, 'utf8');
    const recuperer = async () => { throw new Error('ENOTFOUND edudoc.ch'); };
    const res = await rafraichirMotsCles({
      maintenant: Date.parse('2026-08-31T12:00:00Z'), recuperer: recuperer, config: {}
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, false);
    assert.match(String(res.erreur), /ENOTFOUND/);
    assert.strictEqual(fs.readFileSync(chemin, 'utf8'), avant, 'le fichier ne doit pas être réécrit');
  });
});

test('rafraichirMotsCles : premier moissonnage sans cache -> pas de from, cache créé', async () => {
  await avecCacheAsync('premier', async (chemin) => {
    assert.strictEqual(fs.existsSync(chemin), false);
    let premiere = null;
    const recuperer = async (url) => {
      premiere = premiere || url;
      return pageListRecords([record('2011-01-01T00:00:00Z', [['Europa', 'Europe']])]);
    };
    const res = await rafraichirMotsCles({
      maintenant: Date.parse('2026-08-31T12:00:00Z'), recuperer: recuperer,
      config: { edudoc: { sets: ['https://exemple.test/oai2d'] } }
    });
    assert.strictEqual(res.complet, true);
    assert.ok(premiere.indexOf('from=') === -1, 'un premier moissonnage ne doit pas porter de from');
    const cache = lireCacheMotsCles();
    assert.deepStrictEqual(cache.motsCles, [{ de: 'Europa', fr: 'Europe', manque: null }]);
  });
});

// ---- Export vers edudoc : appariement par le thésaurus, jamais par position -------------
//
// keywords.fr et keywords.de sont chacune triées alphabétiquement de leur côté dans le
// .meta.yaml réel : la n-ième entrée française ne correspond pas à la n-ième allemande. Les
// thésaurus ci-dessous sont construits à la main, jamais le vrai cache, jamais de disque.

test('plierDescripteur : les trois apostrophes courbes/obliques, accents, casse, espaces', () => {
  assert.strictEqual(plierDescripteur('plan d’études'), plierDescripteur("plan d'etudes"));
  assert.strictEqual(plierDescripteur('plan d‘études'), plierDescripteur("plan d'etudes"));
  assert.strictEqual(plierDescripteur('plan dʼétudes'), plierDescripteur("plan d'etudes"));
  assert.strictEqual(plierDescripteur("plan d'etudes"), "plan d'etudes");
  assert.strictEqual(plierDescripteur('  Étude   Française  '), 'etude francaise');
  assert.strictEqual(plierDescripteur(null), '');
  assert.strictEqual(plierDescripteur(undefined), '');
  assert.strictEqual(plierDescripteur(1234), '');
});

test('apparierDescripteurs : le piège positionnel — deux listes triées chacune de leur côté, jamais croisées', () => {
  // Thésaurus réel condensé : quatre paires, l'appariement fr<->de n'a rien à voir avec
  // l'ordre alphabétique de chaque liste prise séparément.
  const index = indexerThesaurus([
    { de: 'Orientierungsstufe', fr: "cycle d'orientation", manque: null },
    { de: 'Lernspiel', fr: 'jeu éducatif', manque: null },
    { de: 'kognitiver Prozess', fr: 'processus cognitif', manque: null },
    { de: 'Pilotprojekt', fr: 'projet pilote', manque: null }
  ]);
  // Triées alphabétiquement chacune de son côté, comme dans un vrai .meta.yaml.
  const listeFr = ["cycle d'orientation", 'jeu éducatif', 'processus cognitif', 'projet pilote'];
  const listeDe = ['kognitiver Prozess', 'Lernspiel', 'Orientierungsstufe', 'Pilotprojekt'];
  const { descripteurs, nonReconnus } = apparierDescripteurs(listeFr, listeDe, index);
  assert.deepStrictEqual(nonReconnus, []);
  assert.deepStrictEqual(descripteurs, [
    { de: 'Orientierungsstufe', fr: "cycle d'orientation" },
    { de: 'Lernspiel', fr: 'jeu éducatif' },
    { de: 'kognitiver Prozess', fr: 'processus cognitif' },
    { de: 'Pilotprojekt', fr: 'projet pilote' }
  ]);
  // La protection explicite : aucun descripteur ne doit croiser les deux paires piégeuses.
  assert.ok(!descripteurs.some((d) => d.fr === "cycle d'orientation" && d.de !== 'Orientierungsstufe'));
  assert.ok(!descripteurs.some((d) => d.fr === 'processus cognitif' && d.de !== 'kognitiver Prozess'));
});

test('apparierDescripteurs : qualificatif entre parenthèses — la forme canonique part à l’export', () => {
  const index = indexerThesaurus([
    { de: 'Inklusion (SZH)', fr: 'inclusion (CSPS)', manque: null }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs(['Inklusion'], [], index);
  assert.deepStrictEqual(descripteurs, [{ de: 'Inklusion (SZH)', fr: 'inclusion (CSPS)' }]);
  assert.deepStrictEqual(nonReconnus, []);
});

test('apparierDescripteurs : qualificatif dans les deux langues, casse mélangée — « (szh) »/« (SZH) », « (na) »', () => {
  const index = indexerThesaurus([
    { de: 'Standard (SZH)', fr: 'norme (na)', manque: null }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs(['norme (NA)'], ['STANDARD (szh)'], index);
  assert.deepStrictEqual(descripteurs, [{ de: 'Standard (SZH)', fr: 'norme (na)' }]);
  assert.strictEqual(descripteurs.length, 1, 'fr et de retombent sur la même entrée, pas deux');
  assert.deepStrictEqual(nonReconnus, []);
});

test('apparierDescripteurs : apostrophe typographique — « plan d’études » retrouve « plan d\'études (na) »', () => {
  const index = indexerThesaurus([
    { de: 'Studienplan (na)', fr: "plan d'études (na)", manque: null }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs(['plan d’études'], [], index);
  assert.deepStrictEqual(descripteurs, [{ de: 'Studienplan (na)', fr: "plan d'études (na)" }]);
  assert.deepStrictEqual(nonReconnus, []);
});

test('apparierDescripteurs : déduplication — fr et de du même terme ne donnent qu’un descripteur', () => {
  const index = indexerThesaurus([
    { de: 'Barrierefreiheit', fr: 'accessibilité', manque: null }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs(['accessibilité'], ['Barrierefreiheit'], index);
  assert.strictEqual(descripteurs.length, 1);
  assert.deepStrictEqual(descripteurs, [{ de: 'Barrierefreiheit', fr: 'accessibilité' }]);
  assert.deepStrictEqual(nonReconnus, []);
});

test('apparierDescripteurs : un terme inconnu part en nonReconnus, sans faire échouer les autres', () => {
  const index = indexerThesaurus([
    { de: 'Barrierefreiheit', fr: 'accessibilité', manque: null }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs(
    ['accessibilité', 'terme fantaisiste'], [], index);
  assert.deepStrictEqual(descripteurs, [{ de: 'Barrierefreiheit', fr: 'accessibilité' }]);
  assert.deepStrictEqual(nonReconnus, ['terme fantaisiste']);
});

test('apparierDescripteurs : paire incomplète du thésaurus (français manquant) — non reconnue, pas de descripteur', () => {
  const index = indexerThesaurus([
    { de: 'Berufsbildung', fr: '', manque: 'fr' }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs([], ['Berufsbildung'], index);
  assert.deepStrictEqual(descripteurs, [], 'le 690 a besoin de ses deux sous-champs');
  assert.deepStrictEqual(nonReconnus, ['Berufsbildung']);
});

test('indexerThesaurus + apparierDescripteurs : la clé exacte prime sur la clé dé-qualifiée', () => {
  // « Tessin (na) » posé AVANT l'entrée exacte, pour prouver que l'ordre d'indexation ne
  // change rien : la passe des clés exactes est intégralement posée avant celle des
  // clés dé-qualifiées, quel que soit l'ordre des entrées dans le thésaurus.
  const index = indexerThesaurus([
    { de: 'Tessin (na)', fr: 'Tessin (na)', manque: null },
    { de: 'Ticino', fr: 'Tessin', manque: null }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs(['tessin'], [], index);
  assert.deepStrictEqual(descripteurs, [{ de: 'Ticino', fr: 'Tessin' }]);
  assert.deepStrictEqual(nonReconnus, []);
});

// Cas RÉEL rencontré sur 04-les-mesures-individuelles-de-pedagogie : le thésaurus porte deux
// entrées distinctes pour « Lernschwierigkeit » (deux traductions concurrentes — le même
// désaccord que fusionnerMotsCles refuse d'écraser, voir son propre test plus haut). Le
// terme allemand saisi tombe sur l'une, le terme français saisi sur l'autre : sans fusion
// après coup, un seul concept ressortirait en deux champs 690 avec le même $a et deux $b
// contradictoires.
test('apparierDescripteurs : deux entrées du thésaurus qui partagent leur allemand se fondent en un descripteur', () => {
  const index = indexerThesaurus([
    { de: 'Lernschwierigkeit', fr: "difficulté d'apprentissage", manque: null },
    { de: 'Lernschwierigkeit', fr: "difficulté de l'apprentissage", manque: null }
  ]);
  // Le fr saisi tombe sur la première entrée, le de saisi sur la seconde (même allemand).
  const { descripteurs, nonReconnus } = apparierDescripteurs(
    ["difficulté de l'apprentissage"], ['Lernschwierigkeit'], index);
  assert.strictEqual(descripteurs.length, 1, 'un seul concept, un seul descripteur');
  assert.strictEqual(descripteurs[0].de, 'Lernschwierigkeit');
  assert.deepStrictEqual(nonReconnus, []);
});

test('apparierDescripteurs : symétrique — deux entrées qui partagent leur français se fondent aussi', () => {
  const index = indexerThesaurus([
    { de: 'Lernschwierigkeit', fr: 'difficulté', manque: null },
    { de: 'Lernbehinderung', fr: 'difficulté', manque: null }
  ]);
  const { descripteurs, nonReconnus } = apparierDescripteurs(
    ['difficulté'], ['Lernbehinderung'], index);
  assert.strictEqual(descripteurs.length, 1, 'un seul concept, un seul descripteur');
  assert.strictEqual(descripteurs[0].fr, 'difficulté');
  assert.deepStrictEqual(nonReconnus, []);
});

// Garde-fou : deux entrées réellement distinctes (allemand ET français différents) ne
// doivent jamais se fondre, même saisies dans la même paire d'appel.
test('apparierDescripteurs : deux entrées vraiment distinctes ne se fondent pas', () => {
  const index = indexerThesaurus([
    { de: 'Orientierungsstufe', fr: "cycle d'orientation", manque: null },
    { de: 'Lernspiel', fr: 'jeu éducatif', manque: null }
  ]);
  const { descripteurs } = apparierDescripteurs(
    ["cycle d'orientation", 'jeu éducatif'], ['Orientierungsstufe', 'Lernspiel'], index);
  assert.strictEqual(descripteurs.length, 2);
});

test('apparierDescripteurs et indexerThesaurus : entrées vides, listes absentes, null, non-tableaux — rien ne jette', () => {
  assert.deepStrictEqual(indexerThesaurus(null).size, 0);
  assert.deepStrictEqual(indexerThesaurus(undefined).size, 0);
  assert.deepStrictEqual(indexerThesaurus('pas un tableau').size, 0);
  const index = indexerThesaurus([
    { de: '', fr: '', manque: null },
    null,
    { de: 'Standard', fr: 'standard', manque: null }
  ]);
  assert.doesNotThrow(() => apparierDescripteurs(null, undefined, index));
  assert.doesNotThrow(() => apparierDescripteurs('pas un tableau', 42, index));
  assert.deepStrictEqual(apparierDescripteurs(null, undefined, index), { descripteurs: [], nonReconnus: [] });
  assert.deepStrictEqual(
    apparierDescripteurs(['', '  ', 'standard'], [], index),
    { descripteurs: [{ de: 'Standard', fr: 'standard' }], nonReconnus: [] });
});
