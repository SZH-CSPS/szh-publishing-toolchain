// La liste des auteur·e·s publiés : parseur OAI-PMH, normalisation, fusion, cache.
//
//   node --test "test/js/*.test.js"
//
// AUCUN réseau ici : le moissonnage prend sa fonction de récupération en paramètre, et les
// tests lui donnent une table de fixtures XML — y compris du XML tronqué et hostile, qui
// doit rendre moins de records, jamais une exception. Le cache passe par SZH_AUTEURS_CACHE
// pour ne pas toucher C:\ProgramData ; l'écriture atomique de lib/yaml.js ne doit pas
// laisser de temporaire derrière elle.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auteursOjs = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'auteurs-ojs.js'));
const {
  ENDPOINTS_OAI_DEFAUT, OCTETS_MAX_REPONSE, JOURS_FRAICHEUR,
  extraireRecords, extraireRecordsMarc, extraireResumptionToken,
  erreurOai, normaliserCreator, cleAuteur, recordsEnAuteurs, fusionnerAuteurs,
  rorCanonique, idRor, resoudreRor,
  lireCache, ecrireCache, cacheFrais, endpointsOai,
  resoudreRedirection, recupererHttps, moissonner, rafraichir
} = auteursOjs;

// La forme d'une entrée d'auteur·e après fusion : neuf clés, toutes présentes. Écrire
// l'attendu à la main dans chaque test ferait dériver les tests du module à la première
// clé ajoutée ; ici, une seule ligne suit.
function entree(champs) {
  return Object.assign({
    prenom: '', nom: '', affiliation: '', ror: '',
    fonction: '', email: '', orcid: '', datePublication: '', source: 'oai'
  }, champs);
}

// ---- Fixtures : ce qu'OJS 3.5 répond réellement (relevé le 25.08.2026) ------------

function enveloppe(corps) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?xml-stylesheet type="text/xsl" href="https://ojs.szh.ch/lib/pkp/xml/oai2.xsl" ?>\n' +
    '<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">\n' +
    '\t<responseDate>2026-08-25T12:00:00Z</responseDate>\n' +
    '\t<request verb="ListRecords">https://ojs.szh.ch/index.php/revue/fr/oai</request>\n' +
    corps + '\n</OAI-PMH>\n';
}

function record(datestamp, creators, options) {
  const o = options || {};
  const statut = o.deleted ? ' status="deleted"' : '';
  const corps = o.deleted ? '' :
    '\n\t\t\t<metadata>\n<oai_dc:dc xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
    creators.map((c) => '\t<dc:creator xml:lang="fr">' + c + '</dc:creator>').join('\n') +
    '\n</oai_dc:dc>\n\t\t\t</metadata>';
  return '\t\t<record>\n\t\t\t<header' + statut + '>\n' +
    '\t\t\t\t<identifier>oai:ojs_szh.ojs.szh.ch:article/35</identifier>\n' +
    '\t\t\t\t<datestamp>' + datestamp + '</datestamp>\n' +
    '\t\t\t\t<setSpec>revue:ART</setSpec>\n\t\t\t</header>' + corps + '\n\t\t</record>';
}

// Le même record, mais en marcxml — le format que le moissonnage lit désormais, parce que
// lui seul porte l'affiliation ($u). `auteurs` = [[nomComplet, ...affiliations]].
// L'indentation erratique et le <record> MARC imbriqué dans le <record> OAI sont ceux de
// l'instance : c'est exactement ce que le parseur doit encaisser.
function recordMarc(datestamp, auteurs, options) {
  const o = options || {};
  const statut = o.deleted ? ' status="deleted"' : '';
  const champs = (auteurs || []).map((a, i) => {
    const tag = i === 0 ? '100' : '720';
    const sous = a.slice(1).map((u) => '\n\t\t\t\t\t\t\t<subfield code="u">' + u + '</subfield>');
    return '\t\t\t\t<datafield tag="' + tag + '" ind1="1" ind2=" ">\n' +
      '\t\t\t<subfield code="a">' + a[0] + '</subfield>' +
      (sous.length > 0 ? sous.join('') : '\n\t\t\t\t\t\t\t<subfield code="u"></subfield>') +
      '\t\t\t\t\t\t\t\t\t\t\t</datafield>';
  }).join('\n\t\t\t');
  const corps = o.deleted ? '' :
    '\n\t\t\t<metadata>\n<record\n\txmlns="http://www.loc.gov/MARC21/slim">\n' +
    '\t<leader>     nmb a2200000Iu 4500</leader>\n' + champs + '\n</record>\n\t\t\t</metadata>';
  return '\t\t<record>\n\t\t\t<header' + statut + '>\n' +
    '\t\t\t\t<identifier>oai:ojs_szh.ojs.szh.ch:article/35</identifier>\n' +
    '\t\t\t\t<datestamp>' + datestamp + '</datestamp>\n' +
    '\t\t\t\t<setSpec>revue:ART</setSpec>\n\t\t\t</header>' + corps + '\n\t\t</record>';
}

// Une réponse de l'API ROR, telle qu'elle arrive vraiment : `ror_display` y porte
// « lang: "en" », et non pas une langue absente. C'est ce détail qui décide du repli quand
// une institution n'a ni libellé français ni libellé allemand.
function reponseRor() {
  return JSON.stringify({
    names: [
      { lang: null, types: ['acronym'], value: 'UNIGE' },
      { lang: 'en', types: ['ror_display', 'label'], value: 'University of Geneva' },
      { lang: 'fr', types: ['label'], value: 'Université de Genève' }
    ]
  });
}

// Le resumptionToken tel qu'OJS l'écrit : attributs sur plusieurs lignes.
function pageListRecords(records, token) {
  const queue = token === undefined ? '' :
    '\n\t\t<resumptionToken expirationDate="2026-08-26T12:00:00Z"\n' +
    '\t\t\tcompleteListSize="325"\n\t\t\tcursor="0">' + token + '</resumptionToken>';
  return enveloppe('\t<ListRecords>\n' + records.join('\n') + queue + '\n\t</ListRecords>');
}

function cacheTemporaire(nom) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-auteurs-' + nom + '-'));
  return path.join(dossier, 'auteurs.json');
}

// Chaque test qui touche le cache pose son propre fichier : pas d'état partagé, et jamais
// C:\ProgramData.
function avecCache(nom, fn) {
  const avant = process.env.SZH_AUTEURS_CACHE;
  process.env.SZH_AUTEURS_CACHE = cacheTemporaire(nom);
  try { return fn(process.env.SZH_AUTEURS_CACHE); }
  finally {
    if (avant === undefined) { delete process.env.SZH_AUTEURS_CACHE; }
    else { process.env.SZH_AUTEURS_CACHE = avant; }
  }
}

async function avecCacheAsync(nom, fn) {
  const avant = process.env.SZH_AUTEURS_CACHE;
  process.env.SZH_AUTEURS_CACHE = cacheTemporaire(nom);
  try { return await fn(process.env.SZH_AUTEURS_CACHE); }
  finally {
    if (avant === undefined) { delete process.env.SZH_AUTEURS_CACHE; }
    else { process.env.SZH_AUTEURS_CACHE = avant; }
  }
}

// ---- Parseur ------------------------------------------------------------------------

test('extraireRecords : une réponse OJS ordinaire', () => {
  const xml = pageListRecords([
    record('2022-12-20T16:31:08Z', ['Wood de Wilde, Hilary', 'Costes, Astrid']),
    record('2024-03-01T08:00:00Z', ['Morand, Robin'])
  ]);
  const records = extraireRecords(xml);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].datestamp, '2022-12-20T16:31:08Z');
  assert.deepStrictEqual(records[0].creators, ['Wood de Wilde, Hilary', 'Costes, Astrid']);
  assert.strictEqual(records[0].deleted, false);
  assert.deepStrictEqual(records[1].creators, ['Morand, Robin']);
});

test('extraireRecords : CDATA et entités décodés, y compris les pièges', () => {
  const xml = pageListRecords([
    record('2024-01-01T00:00:00Z', [
      '<![CDATA[Nu\u00f1ez, Mar\u00eda]]>',
      'M&#252;ller &amp; Fils, Andr&#xE9;',
      'Test &amp;#65;, Sans'          // &amp;#65; doit rester « &#65; », pas devenir « A »
    ])
  ]);
  const records = extraireRecords(xml);
  assert.deepStrictEqual(records[0].creators, [
    'Nu\u00f1ez, Mar\u00eda',
    'M\u00fcller & Fils, Andr\u00e9',
    'Test &#65;, Sans'
  ]);
});

test('extraireRecords : un record deleted est reconnu, et recordsEnAuteurs l’écarte', () => {
  const xml = pageListRecords([
    record('2024-01-01T00:00:00Z', ['Disparu, Jamais'], { deleted: true }),
    record('2024-02-02T00:00:00Z', ['Morand, Robin'])
  ]);
  const records = extraireRecords(xml);
  assert.strictEqual(records.length, 2);
  assert.strictEqual(records[0].deleted, true);
  const auteurs = recordsEnAuteurs(records);
  assert.deepStrictEqual(auteurs.map((a) => a.nom), ['Morand']);
  assert.strictEqual(auteurs[0].datePublication, '2024-02-02T00:00:00Z');
});

test('extraireRecords : XML tronqué ou hostile ne lève jamais', () => {
  const hostiles = [
    '',                                            // rien du tout
    null, undefined, 12345,                        // même pas une chaîne
    '<record><header><datestamp>2024',             // tronqué en plein datestamp
    pageListRecords([record('2024-01-01T00:00:00Z', ['Morand, Robin'])]).slice(0, 200),
    '<html><body>Proxy captif : connectez-vous</body></html>',
    '<record>' + '<dc:creator>'.repeat(500),       // ouvertures jamais refermées
    '<record><header status="deleted"></record>'.repeat(50)
  ];
  for (const xml of hostiles) {
    assert.doesNotThrow(() => { extraireRecords(xml); }, 'a levé sur : ' + String(xml).slice(0, 40));
    assert.ok(Array.isArray(extraireRecords(xml)));
  }
  // Un record complet au milieu de bruit doit quand même sortir.
  const mixte = 'bruit <record><header><datestamp>2024-05-05T00:00:00Z</datestamp></header>' +
    '<metadata><dc:creator>Morand, Robin</dc:creator></metadata></record> resduit <record>';
  const records = extraireRecords(mixte);
  assert.strictEqual(records.length, 1);
  assert.deepStrictEqual(records[0].creators, ['Morand, Robin']);
});

test('extraireResumptionToken : attributs multilignes, élément vide, absence', () => {
  const avec = pageListRecords([record('2024-01-01T00:00:00Z', ['A, B'])], '718afc5bf5602d02');
  assert.strictEqual(extraireResumptionToken(avec), '718afc5bf5602d02');
  // Dernière page : OJS renvoie l'élément vide — même sens que l'absence.
  const vide = pageListRecords([record('2024-01-01T00:00:00Z', ['A, B'])], '');
  assert.strictEqual(extraireResumptionToken(vide), '');
  const sans = pageListRecords([record('2024-01-01T00:00:00Z', ['A, B'])]);
  assert.strictEqual(extraireResumptionToken(sans), '');
  assert.strictEqual(extraireResumptionToken('<resumptionToken/>'), '');
  assert.strictEqual(extraireResumptionToken(null), '');
});

test('erreurOai : noRecordsMatch et les autres codes', () => {
  const rien = enveloppe('\t<error code="noRecordsMatch">No matching records</error>');
  assert.deepStrictEqual(erreurOai(rien), { code: 'noRecordsMatch', message: 'No matching records' });
  const mauvais = enveloppe('\t<error code="badResumptionToken"/>');
  assert.strictEqual(erreurOai(mauvais).code, 'badResumptionToken');
  assert.strictEqual(erreurOai(pageListRecords([record('2024-01-01T00:00:00Z', ['A, B'])])), null);
});

// ---- Normalisation et déduplication --------------------------------------------------

test('normaliserCreator : « Nom, Prénom », et la décision assumée sans virgule', () => {
  assert.deepStrictEqual(normaliserCreator('Morand, Robin'), { prenom: 'Robin', nom: 'Morand' });
  assert.deepStrictEqual(normaliserCreator('Wood de Wilde, Hilary'),
    { prenom: 'Hilary', nom: 'Wood de Wilde' });
  assert.deepStrictEqual(normaliserCreator('  Morand ,   Robin  '), { prenom: 'Robin', nom: 'Morand' });
  // Sans virgule : PAS d'heuristique « dernier mot = nom » — trop fragile sur les
  // particules et les noms composés. Tout part dans `nom`, prénom vide.
  assert.deepStrictEqual(normaliserCreator('Robin Morand'), { prenom: '', nom: 'Robin Morand' });
  // Virgules surnuméraires : la première coupe, le reste suit le prénom.
  assert.deepStrictEqual(normaliserCreator('Morand, Robin, junior'),
    { prenom: 'Robin, junior', nom: 'Morand' });
  assert.strictEqual(normaliserCreator(''), null);
  assert.strictEqual(normaliserCreator('   '), null);
  assert.strictEqual(normaliserCreator(' , '), null);
  assert.strictEqual(normaliserCreator(null), null);
});

test('cleAuteur : casse, accents et espaces pliés', () => {
  const a = cleAuteur({ prenom: 'Robin', nom: 'Morand' });
  assert.strictEqual(cleAuteur({ prenom: 'ROBIN', nom: 'morand' }), a);
  assert.strictEqual(cleAuteur({ prenom: 'R\u00f4bin', nom: 'M\u00f6rand' }), a);
  // \s en JavaScript couvre aussi l'espace insécable : un nom copié-collé depuis OJS ne
  // crée pas de doublon.
  assert.strictEqual(cleAuteur({ prenom: '  Robin ', nom: 'Morand ' }), a);
  assert.strictEqual(cleAuteur({ prenom: ' Robin  ', nom: ' Morand ' }), a);
  assert.notStrictEqual(cleAuteur({ prenom: 'Robin', nom: 'Morard' }), a);
});

test('fusionnerAuteurs : ajout, mise à jour par datestamp plus récent, jamais de suppression', () => {
  const existants = [
    { prenom: 'Robin', nom: 'Morand', datePublication: '2024-01-01T00:00:00Z' },
    { prenom: 'Anne', nom: 'Dupont', datePublication: '2023-05-05T00:00:00Z' }
  ];
  const fusion = fusionnerAuteurs(existants, [
    // Plus récent : la date ET la graphie du nom sont mises à jour (règle actée).
    { prenom: 'ROBIN', nom: 'MORAND', datePublication: '2026-06-06T00:00:00Z' },
    // Plus ancien : rien ne bouge.
    { prenom: 'anne', nom: 'dupont', datePublication: '2020-01-01T00:00:00Z' },
    // Clé nouvelle : ajoutée en queue.
    { prenom: 'Hilary', nom: 'Wood de Wilde', datePublication: '2022-12-20T16:31:08Z' }
  ]);
  assert.strictEqual(fusion.length, 3, 'une fusion ne supprime jamais personne');
  assert.deepStrictEqual(fusion[0],
    entree({ prenom: 'ROBIN', nom: 'MORAND', datePublication: '2026-06-06T00:00:00Z' }));
  assert.deepStrictEqual(fusion[1],
    entree({ prenom: 'Anne', nom: 'Dupont', datePublication: '2023-05-05T00:00:00Z' }));
  assert.strictEqual(fusion[2].nom, 'Wood de Wilde');
  // Rejouer le même moissonnage ne change rien : la fusion est idempotente.
  assert.deepStrictEqual(fusionnerAuteurs(fusion, recordsEnAuteurs([])), fusion);
  // Les entrées sans nom ni prénom sont écartées, un cache retouché à la main ne casse rien.
  assert.deepStrictEqual(fusionnerAuteurs([{ datePublication: '2024-01-01' }], []), []);
});

// ---- Moissonnage (récupération injectée : aucun réseau) ------------------------------

test('moissonner : suit les resumptionToken, from incrémental, fin sur token vide', async () => {
  const base = 'https://exemple.test/index.php/revue/fr/oai';
  const urls = [];
  const pages = {};
  pages[base + '?verb=ListRecords&metadataPrefix=oai_dc&from=2026-07-01'] =
    pageListRecords([record('2026-08-10T00:00:00Z', ['Morand, Robin'])], 'jeton-1');
  pages[base + '?verb=ListRecords&resumptionToken=jeton-1'] =
    pageListRecords([record('2026-08-12T00:00:00Z', ['Dupont, Anne'])], 'jeton-2');
  pages[base + '?verb=ListRecords&resumptionToken=jeton-2'] =
    pageListRecords([record('2026-08-14T00:00:00Z', ['Nu\u00f1ez, Mar\u00eda'])], '');
  const recuperer = async (url) => {
    urls.push(url);
    if (!(url in pages)) { throw new Error('URL inattendue : ' + url); }
    return pages[url];
  };
  // Format explicite : ce test garde la PAGINATION, pas le format, et le defaut est
  // passe a marcxml.
  const records = await moissonner(recuperer, base, '2026-07-01', 'oai_dc');
  assert.strictEqual(records.length, 3);
  assert.deepStrictEqual(records.map((r) => r.creators[0]),
    ['Morand, Robin', 'Dupont, Anne', 'Nu\u00f1ez, Mar\u00eda']);
  assert.strictEqual(urls.length, 3, 'le token vide doit arrêter la boucle');
  // La reprise par token ne porte PAS metadataPrefix : OAI-PMH l'interdit.
  assert.ok(urls[1].indexOf('metadataPrefix') === -1, 'metadataPrefix envoyé avec un token');
});

test('moissonner : sans from, la première requête n’en porte pas', async () => {
  const base = 'https://exemple.test/oai';
  let premiere = null;
  const recuperer = async (url) => {
    premiere = premiere || url;
    return pageListRecords([record('2024-01-01T00:00:00Z', ['A, B'])]);
  };
  await moissonner(recuperer, base, null);
  // Le défaut est marcxml : c'est le seul format de cette instance qui porte l'affiliation.
  assert.strictEqual(premiere, base + '?verb=ListRecords&metadataPrefix=marcxml');
  premiere = null;
  await moissonner(recuperer, base, null, 'oai_dc');
  assert.strictEqual(premiere, base + '?verb=ListRecords&metadataPrefix=oai_dc',
    'le format doit rester imposable, l’ancien reste lisible');
});

test('moissonner : garde anti-boucle sur un resumptionToken répété', async () => {
  const page = pageListRecords([record('2024-01-01T00:00:00Z', ['A, B'])], 'toujours-le-meme');
  let appels = 0;
  const recuperer = async () => { appels++; return page; };
  await assert.rejects(() => moissonner(recuperer, 'https://exemple.test/oai', null),
    /resumptionToken r\u00e9p\u00e9t\u00e9/);
  assert.ok(appels <= 3, 'la boucle aurait dû s’arrêter au token déjà vu : ' + appels + ' appels');
});

test('moissonner : noRecordsMatch est un résultat vide, pas une panne', async () => {
  const recuperer = async () => enveloppe('\t<error code="noRecordsMatch">rien de neuf</error>');
  assert.deepStrictEqual(await moissonner(recuperer, 'https://exemple.test/oai', '2026-08-20'), []);
});

test('moissonner : une autre erreur OAI lève, avec son code', async () => {
  const recuperer = async () => enveloppe('\t<error code="badArgument">from illisible</error>');
  await assert.rejects(() => moissonner(recuperer, 'https://exemple.test/oai', 'n-importe-quoi'),
    /badArgument/);
});

// ---- Cache ---------------------------------------------------------------------------

const CACHE_VIDE = { version: 2, dateFetch: null, dateCorpus: null, ror: {}, vus: {}, auteurs: [] };

test('cache : absent, corrompu ou difforme -> cache vide, sans exception', () => {
  avecCache('lecture', (chemin) => {
    assert.deepStrictEqual(lireCache(), CACHE_VIDE);
    fs.writeFileSync(chemin, '{ pas du json', 'utf8');
    assert.deepStrictEqual(lireCache(), CACHE_VIDE);
    fs.writeFileSync(chemin, JSON.stringify({ version: 2, dateFetch: 'x', auteurs: 'pas une liste' }), 'utf8');
    assert.deepStrictEqual(lireCache().auteurs, []);
    // Un BOM en tête — Save-SzhState en écrit — ne rend pas le fichier illisible.
    fs.writeFileSync(chemin, '﻿' + JSON.stringify({
      version: 2, dateFetch: '2026-08-20T00:00:00Z',
      auteurs: [{ prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' }]
    }), 'utf8');
    const cache = lireCache();
    assert.strictEqual(cache.dateFetch, '2026-08-20T00:00:00Z');
    assert.strictEqual(cache.auteurs.length, 1);
  });
});

// Le piège le plus coûteux du lot. Un cache d'avant marcxml ne porte que des noms : s'il
// gardait sa dateFetch, le moissonnage repartirait en incrémental depuis cette date et
// n'irait chercher que les articles publiés DEPUIS. Les affiliations des mille et quelques
// auteur·e·s déjà en cache ne seraient jamais récupérées — jamais, et sans un mot.
test('cache : un fichier v1 garde ses auteurs mais REPART de zéro (dateFetch à null)', () => {
  avecCache('migration', (chemin) => {
    fs.writeFileSync(chemin, JSON.stringify({
      version: 1, dateFetch: '2026-08-20T00:00:00Z',
      auteurs: [
        { prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' },
        { prenom: 'Anne', nom: 'Dupont', datePublication: '2025-01-01T00:00:00Z' }
      ]
    }), 'utf8');
    const cache = lireCache();
    assert.strictEqual(cache.version, 2);
    assert.strictEqual(cache.dateFetch, null,
      'un cache v1 doit forcer un moissonnage COMPLET, sinon les affiliations manquent a jamais');
    assert.strictEqual(cache.auteurs.length, 2, 'les noms deja connus ne se reperdent pas');
    assert.deepStrictEqual(cache.ror, {});
    assert.deepStrictEqual(cache.vus, {});
    assert.strictEqual(cache.dateCorpus, null);
  });
});

test('cache : écriture atomique puis relecture, sans temporaire résiduel', () => {
  avecCache('ecriture', (chemin) => {
    const donnees = {
      version: 2, dateFetch: '2026-08-25T12:00:00.000Z', dateCorpus: null,
      ror: { '01swzsf04': { fr: 'Université de Genève', de: '', en: 'University of Geneva' } },
      vus: {},
      auteurs: [entree({ prenom: 'María', nom: 'Nuñez', datePublication: '2026-08-14T00:00:00Z' })]
    };
    assert.strictEqual(ecrireCache(donnees), null);
    assert.deepStrictEqual(lireCache(), donnees);
    const restes = fs.readdirSync(path.dirname(chemin)).filter((n) => n.startsWith('~$'));
    assert.deepStrictEqual(restes, [], 'temporaire d’écriture resté sur le disque');
  });
});

// Les bornes se calculent sur la constante : le jour où la cadence rebouge, ce test suit
// tout seul plutôt que de mentir sur ce qu'il garde.
test('cacheFrais : la fenêtre de fraîcheur, ses bornes et l’horloge repassée en arrière', () => {
  const maintenant = Date.parse('2026-08-25T12:00:00Z');
  const jour = 24 * 3600 * 1000;
  const cache = (date) => ({ version: 2, dateFetch: date, auteurs: [] });
  const ilYA = (n) => cache(new Date(maintenant - n * jour).toISOString());
  assert.strictEqual(JOURS_FRAICHEUR, 30, 'la cadence retenue est mensuelle');
  assert.strictEqual(cacheFrais(cache('2026-08-25T11:00:00Z'), maintenant), true);
  assert.strictEqual(cacheFrais(ilYA(JOURS_FRAICHEUR - 1), maintenant), true, 'la veille de la borne');
  assert.strictEqual(cacheFrais(ilYA(JOURS_FRAICHEUR + 1), maintenant), false, 'le lendemain de la borne');
  // Une dateFetch dans le futur compte comme périmée : le cache se répare tout seul.
  assert.strictEqual(cacheFrais(cache(new Date(maintenant + jour).toISOString()), maintenant), false);
  assert.strictEqual(cacheFrais(cache(null), maintenant), false);
  assert.strictEqual(cacheFrais(cache('pas une date'), maintenant), false);
  assert.strictEqual(cacheFrais(null, maintenant), false);
});

// ---- Endpoints ------------------------------------------------------------------------

test('endpointsOai : défauts relevés sur l’instance, surcharge par config.json', () => {
  assert.deepStrictEqual(endpointsOai(null), [
    'https://ojs.szh.ch/index.php/revue/fr/oai',
    'https://ojs.szh.ch/index.php/zeitschrift/de/oai'
  ]);
  assert.deepStrictEqual(endpointsOai({}), ENDPOINTS_OAI_DEFAUT);
  // Les deux formes de la clé `oai` : une liste, ou { endpoints: [...] }.
  assert.deepStrictEqual(endpointsOai({ oai: ['https://autre.test/oai'] }), ['https://autre.test/oai']);
  assert.deepStrictEqual(endpointsOai({ oai: { endpoints: ['https://a.test/oai', 'https://b.test/oai'] } }),
    ['https://a.test/oai', 'https://b.test/oai']);
  // http en clair refusé ; une surcharge entièrement invalide retombe sur les défauts.
  assert.deepStrictEqual(endpointsOai({ oai: ['http://clair.test/oai', 'https://sur.test/oai'] }),
    ['https://sur.test/oai']);
  assert.deepStrictEqual(endpointsOai({ oai: ['http://clair.test/oai', 42] }), ENDPOINTS_OAI_DEFAUT);
});

// ---- Rafraîchissement -----------------------------------------------------------------

test('rafraichir : un cache encore frais ne déclenche AUCUN appel', async () => {
  await avecCacheAsync('frais', async () => {
    ecrireCache({ version: 1, dateFetch: '2026-08-23T00:00:00Z', auteurs: [] });
    const recuperer = async () => { throw new Error('appel réseau interdit : cache frais'); };
    const res = await rafraichir({
      maintenant: Date.parse('2026-08-25T12:00:00Z'), recuperer: recuperer, config: {}
    });
    assert.strictEqual(res.fait, false);
    assert.strictEqual(res.raison, 'frais');
  });
});

test('rafraichir : moissonnage des deux revues, fusion et dateFetch avancée', async () => {
  await avecCacheAsync('complet', async () => {
    ecrireCache({
      version: 2, dateFetch: '2026-07-01T00:00:00Z', dateCorpus: null, ror: {}, vus: {},
      auteurs: [entree({ prenom: 'Ancien', nom: 'Connu', datePublication: '2025-01-01T00:00:00Z' })]
    });
    const urls = [];
    const recuperer = async (url) => {
      urls.push(url);
      // Le MÊME `recuperer` sert l'OAI et l'API ROR — c'est ainsi en production, où le
      // transport est unique. Un test qui ne répondrait qu'à l'OAI laisserait la
      // résolution échouer en silence et ne verrait rien.
      if (url.indexOf('api.ror.org') !== -1) { return reponseRor(); }
      if (url.indexOf('revue-a') !== -1) {
        return pageListRecords([recordMarc('2026-08-10T00:00:00Z', [['Morand, Robin', 'SZH/CSPS']])]);
      }
      return pageListRecords([
        // Doublon inter-revues, et une affiliation donnée en ROR.
        recordMarc('2026-08-12T00:00:00Z', [
          ['Dupont, Anne', 'https://ror.org/01swzsf04'],
          ['Morand, Robin']
        ])
      ]);
    };
    const maintenant = Date.parse('2026-08-25T12:00:00Z');
    const res = await rafraichir({
      maintenant: maintenant, recuperer: recuperer,
      config: { oai: ['https://exemple.test/revue-a/oai', 'https://exemple.test/revue-b/oai'] }
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, true);
    // Incrémental : les deux requêtes OAI portent from=<date du dernier fetch, au jour>.
    const oai = urls.filter((u) => u.indexOf('exemple.test') !== -1);
    assert.strictEqual(oai.length, 2);
    for (const url of oai) {
      assert.ok(url.indexOf('from=2026-07-01') !== -1, 'from absent de ' + url);
    }
    const cache = lireCache();
    assert.strictEqual(cache.dateFetch, new Date(maintenant).toISOString());
    assert.deepStrictEqual(cache.auteurs.map((a) => a.nom).sort(),
      ['Connu', 'Dupont', 'Morand'], 'fusion sans suppression attendue');
    // Le doublon inter-revues garde la date la plus récente.
    const robin = cache.auteurs.filter((a) => a.nom === 'Morand')[0];
    assert.strictEqual(robin.datePublication, '2026-08-12T00:00:00Z');
    assert.strictEqual(robin.affiliation, 'SZH/CSPS', 'une affiliation vide n’écrase pas la remplie');
    // Le ROR rencontré est résolu, et rangé sous son identifiant NU — c’est cette clé que
    // le cockpit relit pour afficher l’affiliation dans la langue de la revue.
    const anne = cache.auteurs.filter((a) => a.nom === 'Dupont')[0];
    assert.strictEqual(anne.ror, 'https://ror.org/01swzsf04');
    assert.deepStrictEqual(cache.ror['01swzsf04'],
      { fr: 'Université de Genève', de: '', en: 'University of Geneva' });
    assert.strictEqual(res.rorRates, 0);
  });
});

test('rafraichir : une revue muette -> fusion partielle, dateFetch INCHANGÉE, on réessaiera', async () => {
  await avecCacheAsync('partiel', async () => {
    ecrireCache({ version: 2, dateFetch: '2026-07-01T00:00:00Z', dateCorpus: null, ror: {}, vus: {}, auteurs: [] });
    const recuperer = async (url) => {
      if (url.indexOf('revue-b') !== -1) { throw new Error('délai dépassé : ' + url); }
      return pageListRecords([recordMarc('2026-08-10T00:00:00Z', [['Morand, Robin']])]);
    };
    const res = await rafraichir({
      maintenant: Date.parse('2026-08-25T12:00:00Z'), recuperer: recuperer,
      config: { oai: ['https://exemple.test/revue-a/oai', 'https://exemple.test/revue-b/oai'] }
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, false);
    assert.match(String(res.erreur), /délai dépassé/);
    const cache = lireCache();
    assert.strictEqual(cache.dateFetch, '2026-07-01T00:00:00Z', 'dateFetch ne doit pas avancer');
    assert.deepStrictEqual(cache.auteurs.map((a) => a.nom), ['Morand'], 'le succès partiel est gardé');
  });
});

test('rafraichir : hors ligne complet -> silencieux, rien réécrit', async () => {
  await avecCacheAsync('horsligne', async (chemin) => {
    ecrireCache({
      version: 2, dateFetch: '2026-07-01T00:00:00Z', dateCorpus: null, ror: {}, vus: {},
      auteurs: [entree({ prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' })]
    });
    const avant = fs.readFileSync(chemin, 'utf8');
    const recuperer = async () => { throw new Error('ENOTFOUND ojs.szh.ch'); };
    const res = await rafraichir({
      maintenant: Date.parse('2026-08-25T12:00:00Z'), recuperer: recuperer, config: {}
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, false);
    assert.match(String(res.erreur), /ENOTFOUND/);
    assert.strictEqual(fs.readFileSync(chemin, 'utf8'), avant, 'le fichier ne doit pas être réécrit');
  });
});

test('rafraichir : premier moissonnage sans cache -> pas de from, cache créé', async () => {
  await avecCacheAsync('premier', async (chemin) => {
    assert.strictEqual(fs.existsSync(chemin), false);
    let premiere = null;
    const recuperer = async (url) => {
      premiere = premiere || url;
      return pageListRecords([recordMarc('2022-12-20T16:31:08Z', [['Wood de Wilde, Hilary']])]);
    };
    const res = await rafraichir({
      maintenant: Date.parse('2026-08-25T12:00:00Z'), recuperer: recuperer,
      config: { oai: ['https://exemple.test/oai'] }
    });
    assert.strictEqual(res.complet, true);
    assert.ok(premiere.indexOf('from=') === -1, 'un premier moissonnage ne doit pas porter de from');
    const cache = lireCache();
    assert.strictEqual(cache.auteurs.length, 1);
    assert.deepStrictEqual(cache.auteurs[0],
      entree({ prenom: 'Hilary', nom: 'Wood de Wilde', datePublication: '2022-12-20T16:31:08Z' }));
  });
});

// ---- Gardes du client réseau (transport injecté : toujours aucun réseau) --------------
//
// recupererHttps prend un transport et un délai total en options, réservés aux tests : on
// rejoue ici les trois pannes — redirection détournée, réponse démesurée, serveur qui
// égoutte — sans socket ni attente réelle.

const { EventEmitter } = require('node:events');

// Un https.get factice : `scenario(url, req)` décrit la réponse — code, en-têtes,
// morceaux à émettre, et `sansFin` pour un serveur qui ne conclut jamais.
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
        if (!s.sansFin) { res.emit('end'); }
      });
    });
    return req;
  };
}

test('resoudreRedirection : même hôte suivi, domaine tiers et http refusés', () => {
  // Le cas réel d'OJS : le préfixe de locale, chemin relatif ou absolu, même hôte.
  assert.strictEqual(
    resoudreRedirection('https://ojs.szh.ch/index.php/revue/oai?verb=Identify',
      'https://ojs.szh.ch/index.php/revue/fr/oai?verb=Identify'),
    'https://ojs.szh.ch/index.php/revue/fr/oai?verb=Identify');
  assert.strictEqual(
    resoudreRedirection('https://ojs.szh.ch/index.php/revue/oai', '/index.php/revue/fr/oai'),
    'https://ojs.szh.ch/index.php/revue/fr/oai');
  assert.throws(() => resoudreRedirection('https://ojs.szh.ch/oai', 'https://pirate.test/oai'),
    /hors h\u00f4te/);
  // Même hôte mais retour en clair : refusé aussi, rien ne repart en http.
  assert.throws(() => resoudreRedirection('https://ojs.szh.ch/oai', 'http://ojs.szh.ch/oai'),
    /hors https/);
  assert.throws(() => resoudreRedirection('https://ojs.szh.ch/oai', 'https://h%s:mal formé'),
    /illisible/);
});

test('recupererHttps : une 302 vers un domaine tiers est rejetée, pas suivie', async () => {
  const urls = [];
  const transport = fauxTransport((url) => {
    urls.push(url);
    return { code: 302, headers: { location: 'https://pirate.test/oai' } };
  });
  await assert.rejects(
    () => recupererHttps('https://ojs.szh.ch/index.php/revue/oai', 0, { transport: transport }),
    /hors h\u00f4te refus\u00e9e : ojs\.szh\.ch -> pirate\.test/);
  assert.deepStrictEqual(urls, ['https://ojs.szh.ch/index.php/revue/oai'],
    'le domaine tiers ne doit recevoir aucune requête');
});

test('recupererHttps : une réponse au-delà de la borne est coupée, sans crash', async () => {
  let requete = null;
  const morceau = Buffer.alloc(5 * 1024 * 1024, 65);         // 5 Mo de « A »
  const transport = fauxTransport((url, req) => {
    requete = req;
    return { code: 200, morceaux: [morceau, morceau, morceau, morceau, morceau] };   // 25 Mo
  });
  await assert.rejects(
    () => recupererHttps('https://ojs.szh.ch/oai', 0, { transport: transport }),
    /trop volumineuse/);
  assert.ok(OCTETS_MAX_REPONSE < 5 * 5 * 1024 * 1024, 'la fixture doit dépasser la borne');
  assert.strictEqual(requete.detruit, true, 'la connexion doit être coupée, pas seulement ignorée');
});

test('recupererHttps : le délai TOTAL coupe un serveur qui ne conclut jamais', async () => {
  let requete = null;
  const transport = fauxTransport((url, req) => {
    requete = req;
    // Un morceau arrive, puis plus rien : le timeout d'inactivité socket n'existe pas dans
    // ce faux transport — seule la garde du délai total peut sortir de là.
    return { code: 200, morceaux: ['<OAI-PMH>'], sansFin: true };
  });
  const debut = Date.now();
  await assert.rejects(
    () => recupererHttps('https://ojs.szh.ch/oai', 0, { transport: transport, delaiTotalMs: 40 }),
    /d\u00e9lai total d\u00e9pass\u00e9/);
  assert.ok(Date.now() - debut < 5000, 'le rejet doit venir du minuteur, pas d’un autre délai');
  assert.strictEqual(requete.detruit, true, 'la requête doit être détruite au délai total');
});

// ---- marcxml, ROR, précédence : ce que le passage à marcxml a introduit ---------------

// Le fragment ci-dessous est copié TEL QUEL de l'instance (revue française, 29.08.2026),
// verrues comprises : indentation erratique, <subfield code="u"> vide, et un <record>
// MARC21 imbriqué dans le <record> OAI — deux balises de même nom, dont la première à
// fermer est l'intérieure. Un parseur écrit sur du XML propre s'y casse.
const FRAGMENT_REEL = [
  '<record>',
  '\t\t\t<header>',
  '\t\t\t\t<identifier>oai:ojs_szh.ojs.szh.ch:article/35</identifier>',
  '\t\t\t\t<datestamp>2022-12-20T16:31:08Z</datestamp>',
  '\t\t\t\t<setSpec>revue:ART</setSpec>',
  '\t\t\t</header>',
  '\t\t\t<metadata>',
  '<record',
  '\txmlns="http://www.loc.gov/MARC21/slim"',
  '\txsi:schemaLocation="http://www.loc.gov/MARC21/slim https://www.loc.gov/standards/marcxml/schema/MARC21slim.xsd">',
  '\t<leader>     nmb a2200000Iu 4500</leader>',
  '\t\t\t<controlfield tag="008">"%18%01%01 %2018                        eng  "</controlfield>',
  '\t\t\t\t<datafield tag="720" ind1="1" ind2=" ">',
  '\t\t\t<subfield code="a">Wood de Wilde, Hilary</subfield>',
  '\t\t\t\t\t\t\t<subfield code="u"></subfield>\t\t\t\t\t\t\t\t\t\t\t</datafield>',
  '\t\t\t<datafield tag="100" ind1="1" ind2=" ">',
  '\t\t\t<subfield code="a">Lanners, Romain</subfield>',
  '\t\t\t\t\t\t\t<subfield code="u">SZH/CSPS</subfield>\t\t\t\t\t\t\t\t\t\t\t</datafield>',
  '\t\t\t<datafield tag="700" ind1="1" ind2=" ">',
  '\t\t\t<subfield code="a">Schaer, Marie</subfield>',
  '\t\t\t\t\t\t\t<subfield code="u">https://ror.org/01swzsf04</subfield>\t\t\t\t\t\t\t\t\t\t\t</datafield>',
  '\t\t\t<datafield tag="245" ind1="0" ind2="0">',
  '\t\t<subfield code="a">Un titre qui ne doit pas passer pour un auteur</subfield>',
  '\t</datafield>',
  '</record>',
  '\t\t\t</metadata>',
  '\t\t</record>'
].join('\n');

test('extraireRecordsMarc : le XML réel de l’instance, verrues comprises', () => {
  const records = extraireRecordsMarc(enveloppe('\t<ListRecords>\n' + FRAGMENT_REEL + '\n\t</ListRecords>'));
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].datestamp, '2022-12-20T16:31:08Z');
  assert.strictEqual(records[0].deleted, false);
  assert.deepStrictEqual(records[0].auteurs.map((a) => a.nomComplet),
    ['Wood de Wilde, Hilary', 'Lanners, Romain', 'Schaer, Marie'],
    'les datafields 720, 100 et 700 comptent tous les trois, dans l’ordre du document');
  // Le datafield 245 est le TITRE : le relever ferait un auteur nommé comme l’article.
  assert.strictEqual(records[0].auteurs.length, 3, 'un datafield hors 100/700/720 a été pris');
  // Un $u vide n’est pas une affiliation vide : il n’est pas une affiliation du tout.
  assert.deepStrictEqual(records[0].auteurs[0].affiliations, []);
  assert.deepStrictEqual(records[0].auteurs[1].affiliations, ['SZH/CSPS']);
  const auteurs = recordsEnAuteurs(records);
  assert.deepStrictEqual(auteurs.map((a) => a.nom), ['Wood de Wilde', 'Lanners', 'Schaer']);
  assert.strictEqual(auteurs[1].affiliation, 'SZH/CSPS');
  assert.strictEqual(auteurs[2].ror, 'https://ror.org/01swzsf04');
  assert.strictEqual(auteurs[2].affiliation, '', 'un ROR ne se range pas dans l’affiliation en clair');
});

test('extraireRecordsMarc : XML tronqué au milieu d’un datafield, sans exception', () => {
  const tronque = enveloppe('\t<ListRecords>\n' + FRAGMENT_REEL.slice(0, 900));
  const records = extraireRecordsMarc(tronque);
  assert.ok(Array.isArray(records), 'un XML tronqué doit rendre une liste, jamais lever');
  // Et les formes franchement hostiles ne lèvent pas non plus.
  for (const x of ['', null, undefined, '<record><datafield tag="100"', '<<<>>>']) {
    assert.ok(Array.isArray(extraireRecordsMarc(x)));
  }
});

// Cas RÉEL : trois auteur·e·s des deux revues déclarent deux ou trois affiliations. MARC
// autorise $u répété. Les recoller en une chaîne fabriquait « https://ror.org/A
// https://ror.org/B » — ni un ROR reconnaissable, ni un nom d’institution lisible :
// l’affiliation était perdue, en silence.
test('extraireRecordsMarc : $u répété reste une liste, et la première affiliation est retenue', () => {
  const xml = pageListRecords([recordMarc('2025-01-01T00:00:00Z', [
    ['Khemka, Ishita', 'https://ror.org/00wyq5s37', 'https://ror.org/00bgtad15'],
    ['Schelker, Serafina', 'Université de Genève', 'HETSL | HES-SO']
  ])]);
  const records = extraireRecordsMarc(xml);
  assert.deepStrictEqual(records[0].auteurs[0].affiliations,
    ['https://ror.org/00wyq5s37', 'https://ror.org/00bgtad15']);
  const auteurs = recordsEnAuteurs(records);
  // La fiche ne porte qu’une affiliation : la première, celle que l’auteur a mise en tête.
  assert.strictEqual(auteurs[0].ror, 'https://ror.org/00wyq5s37');
  assert.strictEqual(auteurs[0].affiliation, '');
  assert.strictEqual(auteurs[1].affiliation, 'Université de Genève');
  assert.strictEqual(auteurs[1].ror, '');
});

test('rorCanonique et idRor : URL, identifiant nu, et tout ce qui n’en est pas', () => {
  // Identifiants relevés sur l’instance.
  for (const id of ['01swzsf04', '00w9q2c06', '04nd0xd48', '027h8t796']) {
    assert.strictEqual(rorCanonique('https://ror.org/' + id), 'https://ror.org/' + id);
    assert.strictEqual(rorCanonique(id), 'https://ror.org/' + id, 'l’identifiant nu doit entrer');
    assert.strictEqual(idRor('https://ror.org/' + id), id);
    assert.strictEqual(idRor(id), id, 'idRor doit être idempotent : rafraichir le rappelle sur son propre résultat');
  }
  assert.strictEqual(rorCanonique('http://ror.org/01swzsf04'), 'https://ror.org/01swzsf04');
  assert.strictEqual(rorCanonique('  HTTPS://ROR.ORG/01SWZSF04  '), 'https://ror.org/01swzsf04');
  // Ce qui doit être refusé. Le dernier est le plus important : une valeur qui CONTIENT un
  // motif de ROR n’est pas un ROR, et l’accepter publierait dans OJS l’identifiant d’une
  // institution qui n’est pas la bonne — pire qu’un champ vide, et sans avertissement.
  for (const faux of ['https://ror.org/', '12345', '', null, undefined,
    'https://orcid.org/0000-0002-1825-0097', '0iiiiii00',
    'Université de Genève 012345678']) {
    assert.strictEqual(rorCanonique(faux), '', 'accepté à tort : ' + faux);
    assert.strictEqual(idRor(faux), '');
  }
});

test('resoudreRor : les libellés rangés, les échecs sautés, les connus jamais redemandés', async () => {
  const noms = await resoudreRor(async () => reponseRor(), ['01swzsf04'], {});
  assert.deepStrictEqual(noms, {
    '01swzsf04': { fr: 'Université de Genève', de: '', en: 'University of Geneva' }
  });
  // Un id qui échoue est SAUTÉ, pas mis en cache : on le retentera le mois suivant plutôt
  // que de figer une absence de libellé pour toujours.
  const partiel = await resoudreRor(async (url) => {
    if (url.indexOf('01swzsf04') !== -1) { return reponseRor(); }
    throw new Error('HTTP 404');
  }, ['01swzsf04', '00w9q2c06'], {});
  assert.deepStrictEqual(Object.keys(partiel), ['01swzsf04']);
  // Un JSON illisible ne lève pas davantage.
  assert.deepStrictEqual(await resoudreRor(async () => 'pas du json', ['01swzsf04'], {}), {});
  // Déjà connu : aucune requête. Les deux formes de `connus` sont acceptées, parce que les
  // deux appelants existent — le Set des clés, et la table cache.ror elle-même.
  const interdit = async () => { throw new Error('requête interdite : id déjà connu'); };
  assert.deepStrictEqual(await resoudreRor(interdit, ['01swzsf04'], new Set(['01swzsf04'])), {});
  assert.deepStrictEqual(await resoudreRor(interdit, ['01swzsf04'], { '01swzsf04': { fr: 'x' } }), {});
});

test('resoudreRor : sans libellé français ni allemand, le repli anglais sauve l’affiliation', async () => {
  // Cas réel de la HfH : ROR ne lui connaît qu’un libellé allemand et un libellé
  // d’affichage. Une institution sans ni l’un ni l’autre existe aussi — et sans le repli,
  // son affiliation sortirait VIDE dans la modale.
  const seulementAffichage = JSON.stringify({
    names: [{ lang: 'en', types: ['ror_display', 'label'], value: 'Some Institute' }]
  });
  const noms = await resoudreRor(async () => seulementAffichage, ['00w9q2c06'], {});
  assert.strictEqual(noms['00w9q2c06'].en, 'Some Institute',
    'ror_display porte lang:"en" sur l’instance — exiger une langue absente le manquerait toujours');
});

// La règle de précédence entre les deux sources. Le corpus, c’est ce que la rédaction a
// tapé à la main dans les fiches meta.yaml ; OJS, c’est ce qui a été publié. Sur les
// champs d’enrichissement, la saisie maison fait foi.
test('fusionnerAuteurs : le corpus écrase, OJS ne remplit que le vide, le vide n’efface rien', () => {
  const deOjs = (c) => entree(Object.assign({ source: 'oai' }, c));
  const duCorpus = (c) => entree(Object.assign({ source: 'corpus' }, c));

  // OJS pose un nom et une affiliation ; le corpus ajoute fonction et e-mail, et corrige
  // l’affiliation. Tout ce qu’il apporte gagne.
  let f = fusionnerAuteurs(
    [deOjs({ prenom: 'Robin', nom: 'Morand', affiliation: 'SZH/CSPS' })],
    [duCorpus({ prenom: 'Robin', nom: 'Morand', affiliation: 'SZH CSPS',
      fonction: 'Collaborateur scientifique', email: 'robin.morand@szh.ch' })]);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].affiliation, 'SZH CSPS', 'le corpus doit écraser');
  assert.strictEqual(f[0].fonction, 'Collaborateur scientifique');
  assert.strictEqual(f[0].email, 'robin.morand@szh.ch');
  assert.strictEqual(f[0].source, 'corpus', 'la provenance suit la dernière main qui a écrit');

  // Dans l’autre sens : OJS ne doit pas écraser une valeur venue du corpus.
  f = fusionnerAuteurs(
    [duCorpus({ prenom: 'Robin', nom: 'Morand', affiliation: 'SZH CSPS', fonction: 'Collaborateur' })],
    [deOjs({ prenom: 'Robin', nom: 'Morand', affiliation: 'Autre chose', orcid: 'https://orcid.org/0000-0002-1825-0097' })]);
  assert.strictEqual(f[0].affiliation, 'SZH CSPS', 'OJS a écrasé une saisie maison');
  assert.strictEqual(f[0].fonction, 'Collaborateur');
  assert.strictEqual(f[0].orcid, 'https://orcid.org/0000-0002-1825-0097',
    'OJS doit quand même remplir ce qui était vide');

  // Une valeur vide n’efface jamais une valeur remplie, quelle que soit la source.
  f = fusionnerAuteurs(
    [duCorpus({ prenom: 'Robin', nom: 'Morand', fonction: 'Collaborateur', email: 'r@szh.ch' })],
    [duCorpus({ prenom: 'Robin', nom: 'Morand', fonction: '', email: '' })]);
  assert.strictEqual(f[0].fonction, 'Collaborateur');
  assert.strictEqual(f[0].email, 'r@szh.ch');
});
