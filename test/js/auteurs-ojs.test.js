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
  ENDPOINTS_OAI_DEFAUT, OCTETS_MAX_REPONSE, extraireRecords, extraireResumptionToken,
  erreurOai, normaliserCreator, cleAuteur, recordsEnAuteurs, fusionnerAuteurs,
  lireCache, ecrireCache, cacheFrais, endpointsOai,
  resoudreRedirection, recupererHttps, moissonner, rafraichir
} = auteursOjs;

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
    { prenom: 'ROBIN', nom: 'MORAND', datePublication: '2026-06-06T00:00:00Z' });
  assert.deepStrictEqual(fusion[1],
    { prenom: 'Anne', nom: 'Dupont', datePublication: '2023-05-05T00:00:00Z' });
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
  pages[base + '?verb=ListRecords&metadataPrefix=oai_dc&from=2026-08-01'] =
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
  const records = await moissonner(recuperer, base, '2026-08-01');
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
  assert.strictEqual(premiere, base + '?verb=ListRecords&metadataPrefix=oai_dc');
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

test('cache : absent, corrompu ou difforme -> cache vide, sans exception', () => {
  avecCache('lecture', (chemin) => {
    assert.deepStrictEqual(lireCache(), { version: 1, dateFetch: null, auteurs: [] });
    fs.writeFileSync(chemin, '{ pas du json', 'utf8');
    assert.deepStrictEqual(lireCache(), { version: 1, dateFetch: null, auteurs: [] });
    fs.writeFileSync(chemin, JSON.stringify({ version: 1, dateFetch: 'x', auteurs: 'pas une liste' }), 'utf8');
    assert.deepStrictEqual(lireCache().auteurs, []);
    // Un BOM en tête — Save-SzhState en écrit — ne rend pas le fichier illisible.
    fs.writeFileSync(chemin, '\uFEFF' + JSON.stringify({
      version: 1, dateFetch: '2026-08-20T00:00:00Z',
      auteurs: [{ prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' }]
    }), 'utf8');
    const cache = lireCache();
    assert.strictEqual(cache.dateFetch, '2026-08-20T00:00:00Z');
    assert.strictEqual(cache.auteurs.length, 1);
  });
});

test('cache : écriture atomique puis relecture, sans temporaire résiduel', () => {
  avecCache('ecriture', (chemin) => {
    const donnees = {
      version: 1, dateFetch: '2026-08-25T12:00:00.000Z',
      auteurs: [{ prenom: 'Mar\u00eda', nom: 'Nu\u00f1ez', datePublication: '2026-08-14T00:00:00Z' }]
    };
    assert.strictEqual(ecrireCache(donnees), null);
    assert.deepStrictEqual(lireCache(), donnees);
    const restes = fs.readdirSync(path.dirname(chemin)).filter((n) => n.startsWith('~$'));
    assert.deepStrictEqual(restes, [], 'temporaire d’écriture resté sur le disque');
  });
});

test('cacheFrais : moins de sept jours, bornes et horloge repassée en arrière', () => {
  const maintenant = Date.parse('2026-08-25T12:00:00Z');
  const jour = 24 * 3600 * 1000;
  const cache = (date) => ({ version: 1, dateFetch: date, auteurs: [] });
  assert.strictEqual(cacheFrais(cache('2026-08-25T11:00:00Z'), maintenant), true);
  assert.strictEqual(cacheFrais(cache(new Date(maintenant - 6 * jour).toISOString()), maintenant), true);
  assert.strictEqual(cacheFrais(cache(new Date(maintenant - 8 * jour).toISOString()), maintenant), false);
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

test('rafraichir : un cache de moins de sept jours ne déclenche AUCUN appel', async () => {
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
      version: 1, dateFetch: '2026-08-01T00:00:00Z',
      auteurs: [{ prenom: 'Ancien', nom: 'Connu', datePublication: '2025-01-01T00:00:00Z' }]
    });
    const urls = [];
    const recuperer = async (url) => {
      urls.push(url);
      if (url.indexOf('revue-a') !== -1) {
        return pageListRecords([record('2026-08-10T00:00:00Z', ['Morand, Robin'])]);
      }
      return pageListRecords([
        record('2026-08-12T00:00:00Z', ['Dupont, Anne', 'Morand, Robin'])   // doublon inter-revues
      ]);
    };
    const maintenant = Date.parse('2026-08-25T12:00:00Z');
    const res = await rafraichir({
      maintenant: maintenant, recuperer: recuperer,
      config: { oai: ['https://exemple.test/revue-a/oai', 'https://exemple.test/revue-b/oai'] }
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, true);
    // Incrémental : les deux requêtes portent from=<date du dernier fetch, au jour>.
    assert.strictEqual(urls.length, 2);
    for (const url of urls) {
      assert.ok(url.indexOf('from=2026-08-01') !== -1, 'from absent de ' + url);
    }
    const cache = lireCache();
    assert.strictEqual(cache.dateFetch, new Date(maintenant).toISOString());
    assert.deepStrictEqual(cache.auteurs.map((a) => a.nom).sort(),
      ['Connu', 'Dupont', 'Morand'], 'fusion sans suppression attendue');
    // Le doublon inter-revues garde la date la plus récente.
    const robin = cache.auteurs.filter((a) => a.nom === 'Morand')[0];
    assert.strictEqual(robin.datePublication, '2026-08-12T00:00:00Z');
  });
});

test('rafraichir : une revue muette -> fusion partielle, dateFetch INCHANGÉE, on réessaiera', async () => {
  await avecCacheAsync('partiel', async () => {
    ecrireCache({ version: 1, dateFetch: '2026-08-01T00:00:00Z', auteurs: [] });
    const recuperer = async (url) => {
      if (url.indexOf('revue-b') !== -1) { throw new Error('délai dépassé : ' + url); }
      return pageListRecords([record('2026-08-10T00:00:00Z', ['Morand, Robin'])]);
    };
    const res = await rafraichir({
      maintenant: Date.parse('2026-08-25T12:00:00Z'), recuperer: recuperer,
      config: { oai: ['https://exemple.test/revue-a/oai', 'https://exemple.test/revue-b/oai'] }
    });
    assert.strictEqual(res.fait, true);
    assert.strictEqual(res.complet, false);
    assert.match(String(res.erreur), /d\u00e9lai d\u00e9pass\u00e9/);
    const cache = lireCache();
    assert.strictEqual(cache.dateFetch, '2026-08-01T00:00:00Z', 'dateFetch ne doit pas avancer');
    assert.deepStrictEqual(cache.auteurs.map((a) => a.nom), ['Morand'], 'le succès partiel est gardé');
  });
});

test('rafraichir : hors ligne complet -> silencieux, rien réécrit', async () => {
  await avecCacheAsync('horsligne', async (chemin) => {
    ecrireCache({
      version: 1, dateFetch: '2026-08-01T00:00:00Z',
      auteurs: [{ prenom: 'Robin', nom: 'Morand', datePublication: '2026-01-01T00:00:00Z' }]
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
      return pageListRecords([record('2022-12-20T16:31:08Z', ['Wood de Wilde, Hilary'])]);
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
      { prenom: 'Hilary', nom: 'Wood de Wilde', datePublication: '2022-12-20T16:31:08Z' });
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
