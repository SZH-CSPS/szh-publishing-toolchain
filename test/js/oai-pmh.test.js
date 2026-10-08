// Tests de lib/oai-pmh.js, le module OAI-PMH commun à lib/auteurs-ojs.js et
// lib/mots-cles-edudoc.js.
//
// Le lecteur et les trois gardes réseau (redirection hors hôte, réponse démesurée, délai
// total) sont testés dans test/js/auteurs-ojs.test.js, sur les mêmes fonctions réexportées.
// Ce fichier vérifie que ces fonctions sont réexportées et non recopiées, et que la garde
// SZH_RESEAU_INTERDIT (le point de passage unique vers un socket https) couvre les deux
// moissonneurs jusque dans leur chemin par défaut (rafraichir / rafraichirMotsCles sans
// `recuperer` injecté).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE_LIB = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib');
const oaiPmh = require(path.join(RACINE_LIB, 'oai-pmh.js'));
const auteursOjs = require(path.join(RACINE_LIB, 'auteurs-ojs.js'));
const motsClesEdudoc = require(path.join(RACINE_LIB, 'mots-cles-edudoc.js'));

// ---- Aucune copie -------------------------------------------------------------------
//
// auteurs-ojs.js et mots-cles-edudoc.js réexportent ces noms pour leurs appelants : ils
// doivent pointer sur la même fonction que lib/oai-pmh.js.

test('lib/auteurs-ojs.js réexporte les fonctions communes de lib/oai-pmh.js, pas des copies', () => {
  assert.strictEqual(auteursOjs.decoderTexteXml, oaiPmh.decoderTexteXml);
  assert.strictEqual(auteursOjs.extraireResumptionToken, oaiPmh.extraireResumptionToken);
  assert.strictEqual(auteursOjs.erreurOai, oaiPmh.erreurOai);
  assert.strictEqual(auteursOjs.plierNom, oaiPmh.plierNom);
  assert.strictEqual(auteursOjs.resoudreRedirection, oaiPmh.resoudreRedirection);
  assert.strictEqual(auteursOjs.recupererHttps, oaiPmh.recupererHttps);
  assert.strictEqual(auteursOjs.OCTETS_MAX_REPONSE, oaiPmh.OCTETS_MAX_REPONSE);
  assert.strictEqual(auteursOjs.DELAI_TOTAL_MS, oaiPmh.DELAI_TOTAL_MS);
});

test('lib/mots-cles-edudoc.js réexporte recupererAvecRepli de lib/oai-pmh.js, pas une copie', () => {
  assert.strictEqual(motsClesEdudoc.recupererAvecRepli, oaiPmh.recupererAvecRepli);
});

// ---- La garde réseau --------------------------------------------------------------------
//
// SZH_RESEAU_INTERDIT est lue à un seul endroit, recupererHttps() de lib/oai-pmh.js.
// test/js/hote-factice.js la pose pour les suites qui activent l'extension ; ce fichier
// tourne dans son propre processus, où elle n'est pas encore posée : on éprouve le passage
// « absente -> présente », puis on la retire.

async function avecReseauInterdit(fn) {
  const avant = process.env.SZH_RESEAU_INTERDIT;
  process.env.SZH_RESEAU_INTERDIT = '1';
  try { return await fn(); }
  finally {
    if (avant === undefined) { delete process.env.SZH_RESEAU_INTERDIT; }
    else { process.env.SZH_RESEAU_INTERDIT = avant; }
  }
}

test('recupererHttps : SZH_RESEAU_INTERDIT bloque tout appel réel sans transport factice', async () => {
  await avecReseauInterdit(async () => {
    // Aucun `transport` fourni : sans la garde, ceci ouvrirait un socket vers ojs.szh.ch. Le
    // rejet vient avant toute tentative réseau, donc tout de suite.
    const debut = Date.now();
    await assert.rejects(
      () => oaiPmh.recupererHttps('https://ojs.szh.ch/index.php/revue/fr/oai', 0, {}),
      /SZH_RESEAU_INTERDIT/);
    assert.ok(Date.now() - debut < 1000, 'le rejet doit être immédiat, pas un délai réseau');
  });
});

test('recupererAvecRepli : la garde se voit aussi à travers le repli sur 503', async () => {
  await avecReseauInterdit(async () => {
    // recupererAvecRepli délègue à recupererHttps ; seul « HTTP 503 » déclenche une nouvelle
    // tentative. Le refus de la garde n'est pas retenté.
    await assert.rejects(
      () => oaiPmh.recupererAvecRepli('https://edudoc.ch/oai2d', {}),
      /SZH_RESEAU_INTERDIT/);
  });
});

test('la garde couvre les DEUX moissonneurs depuis leur propre surface exportée', async () => {
  await avecReseauInterdit(async () => {
    await assert.rejects(
      () => auteursOjs.recupererHttps('https://ojs.szh.ch/oai', 0, {}),
      /SZH_RESEAU_INTERDIT/);
    await assert.rejects(
      () => motsClesEdudoc.recupererAvecRepli('https://edudoc.ch/oai2d', {}),
      /SZH_RESEAU_INTERDIT/);
  });
});

// De bout en bout : rafraichir() et rafraichirMotsCles() sans `recuperer` injecté prennent
// leur repli par défaut (recupererHttps pour l'un, recupererAvecRepli pour l'autre). Si la
// garde ne couvrait pas ce chemin, ils interrogeraient ojs.szh.ch ou edudoc.ch au lieu de
// rendre une erreur.

function cacheVideTemporaire(prefixe, nomFichier) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  return path.join(dossier, nomFichier);
}

test('rafraichir (auteur·e·s) sans recuperer injecté : la garde coupe, pas un vrai appel', async () => {
  await avecReseauInterdit(async () => {
    const avantCache = process.env.SZH_AUTEURS_CACHE;
    process.env.SZH_AUTEURS_CACHE = cacheVideTemporaire('szh-oai-pmh-auteurs-', 'auteurs.json');
    try {
      // Cache absent -> cacheVide() -> dateFetch null -> jamais frais : rafraichir() tente un
      // appel, que la garde doit intercepter.
      const res = await auteursOjs.rafraichir({
        maintenant: Date.parse('2026-09-01T12:00:00Z'),
        config: { oai: ['https://ojs.szh.ch/index.php/revue/fr/oai'] }
      });
      assert.strictEqual(res.fait, true);
      assert.strictEqual(res.complet, false, 'un appel réel bloqué doit rendre complet=false');
      assert.match(res.erreur || '', /SZH_RESEAU_INTERDIT/,
        'l’échec doit porter la trace de la garde, pas disparaître en silence');
    } finally {
      if (avantCache === undefined) { delete process.env.SZH_AUTEURS_CACHE; }
      else { process.env.SZH_AUTEURS_CACHE = avantCache; }
    }
  });
});

test('rafraichirMotsCles (edudoc) sans recuperer injecté : la garde coupe, pas un vrai appel', async () => {
  await avecReseauInterdit(async () => {
    const avantCache = process.env.SZH_MOTS_CLES_CACHE;
    process.env.SZH_MOTS_CLES_CACHE = cacheVideTemporaire('szh-oai-pmh-motscles-', 'mots-cles.json');
    try {
      const res = await motsClesEdudoc.rafraichirMotsCles({
        maintenant: Date.parse('2026-09-01T12:00:00Z'),
        config: { edudoc: { endpoint: 'https://edudoc.ch/oai2d', sets: ['Revue suisse de pédagogie spécialisée'] } }
      });
      assert.strictEqual(res.fait, true);
      assert.strictEqual(res.complet, false, 'un appel réel bloqué doit rendre complet=false');
      assert.match(res.erreur || '', /SZH_RESEAU_INTERDIT/,
        'l’échec doit porter la trace de la garde, pas disparaître en silence');
    } finally {
      if (avantCache === undefined) { delete process.env.SZH_MOTS_CLES_CACHE; }
      else { process.env.SZH_MOTS_CLES_CACHE = avantCache; }
    }
  });
});

// ---- Quelle fonction rafraichir() appelle-t-elle ? ---------------------------------------
//
// Les deux tests ci-dessus ne distinguent pas recupererHttps de recupererAvecRepli : l'un
// délègue à l'autre, le message est le même. Or les deux moissonneurs doivent utiliser
// recupererAvecRepli (repli sur un 503 « Retry after »).
//
// On remplace les exports de lib/oai-pmh.js, déjà en cache, par des espions, puis on recharge
// lib/auteurs-ojs.js : sa déstructuration de tête
// (`const { …, recupererHttps } = require('./oai-pmh')`) prend alors les espions, et seul le
// nom utilisé par rafraichir() est enregistré. Les deux espions rejettent tout de suite, sans
// réseau.
test('rafraichir (auteur·e·s) sans recuperer injecté : appelle recupererAvecRepli, pas recupererHttps seul', async () => {
  const cheminOai = require.resolve(path.join(RACINE_LIB, 'oai-pmh.js'));
  const cheminAuteurs = require.resolve(path.join(RACINE_LIB, 'auteurs-ojs.js'));
  const moduleOai = require.cache[cheminOai];
  assert.ok(moduleOai, 'lib/oai-pmh.js doit déjà être en cache (requis en tête de ce fichier)');
  const exportsOriginaux = Object.assign({}, moduleOai.exports);
  const appels = [];
  moduleOai.exports.recupererHttps = async () => { appels.push('recupererHttps'); throw new Error('espion recupererHttps appelé'); };
  moduleOai.exports.recupererAvecRepli = async () => { appels.push('recupererAvecRepli'); throw new Error('espion recupererAvecRepli appelé'); };
  const auteursAvant = require.cache[cheminAuteurs];
  delete require.cache[cheminAuteurs];   // force une relecture qui capte les espions ci-dessus
  try {
    const auteursOjsFrais = require(cheminAuteurs);
    const avantCache = process.env.SZH_AUTEURS_CACHE;
    process.env.SZH_AUTEURS_CACHE = cacheVideTemporaire('szh-oai-pmh-cablage-', 'auteurs.json');
    try {
      const res = await auteursOjsFrais.rafraichir({
        maintenant: Date.parse('2026-09-01T12:00:00Z'),
        config: { oai: ['https://ojs.szh.ch/index.php/revue/fr/oai'] }
      });
      assert.strictEqual(res.fait, true);
      assert.strictEqual(res.complet, false, 'l’espion doit avoir fait échouer l’unique endpoint');
    } finally {
      if (avantCache === undefined) { delete process.env.SZH_AUTEURS_CACHE; }
      else { process.env.SZH_AUTEURS_CACHE = avantCache; }
    }
  } finally {
    Object.assign(moduleOai.exports, exportsOriginaux);
    if (auteursAvant) { require.cache[cheminAuteurs] = auteursAvant; } else { delete require.cache[cheminAuteurs]; }
  }
  assert.deepStrictEqual(appels, ['recupererAvecRepli'],
    'rafraichir() doit prendre recupererAvecRepli comme repli par défaut, comme rafraichirMotsCles() : ' +
    JSON.stringify(appels));
});
