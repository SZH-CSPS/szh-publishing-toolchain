// lib/oai-pmh.js : le module OAI-PMH commun extrait de lib/auteurs-ojs.js le 01.09.2026,
// pour que lib/mots-cles-edudoc.js cesse d'importer son voisin comme une bibliothèque.
//
//   node --test "test/js/*.test.js"
//
// Ce fichier ne rejoue PAS les contrôles déjà faits ailleurs sur le détail du parseur ou
// des trois gardes réseau (redirection hors hôte, réponse démesurée, délai total) :
// test/js/auteurs-ojs.test.js les couvre toujours, sur les mêmes fonctions — réexportées,
// pas recopiées, ce que le premier test ci-dessous vérifie par égalité de référence. Ce
// qui est propre à ce fichier : que l'extraction n'a RIEN dupliqué, et que la garde
// SZH_RESEAU_INTERDIT — LE point de passage unique vers un vrai socket https — couvre bien
// les DEUX moissonneurs, jusque dans leur chemin par défaut (rafraichir / rafraichirMotsCles
// appelés SANS `recuperer` injecté), et pas seulement la fonction bas niveau.
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

// ---- L'extraction n'a rien dupliqué -------------------------------------------------
//
// auteurs-ojs.js et mots-cles-edudoc.js réexportent ces noms pour ne rien changer à leurs
// propres appelants et tests — mais ils doivent pointer sur LA MÊME fonction que
// lib/oai-pmh.js, pas sur une copie qui pourrait diverger en silence.

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

// ---- La garde réseau, LE point le plus important --------------------------------------
//
// SZH_RESEAU_INTERDIT vit UNE fois, dans recupererHttps() de lib/oai-pmh.js — voir son
// en-tête. test/js/hote-factice.js la pose pour les suites qui activent l'extension, mais
// ce fichier tourne dans son propre processus (un processus par fichier de test, comme
// partout dans ce dépôt) : elle n'y est PAS déjà posée, ce qui permet d'éprouver ici la
// transition « absente -> présente » et de la relâcher proprement ensuite.

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
    // Aucun `transport` fourni : sans la garde, ceci ouvrirait un vrai socket vers
    // ojs.szh.ch. Le rejet doit venir AVANT toute tentative réseau, donc être immédiat.
    const debut = Date.now();
    await assert.rejects(
      () => oaiPmh.recupererHttps('https://ojs.szh.ch/index.php/revue/fr/oai', 0, {}),
      /SZH_RESEAU_INTERDIT/);
    assert.ok(Date.now() - debut < 1000, 'le rejet doit être immédiat, pas un délai réseau');
  });
});

test('recupererAvecRepli : la garde se voit aussi à travers le repli sur 503', async () => {
  await avecReseauInterdit(async () => {
    // recupererAvecRepli délègue à recupererHttps ; « HTTP 503 » est le seul message qui
    // déclenche une nouvelle tentative — celui de la garde ne doit PAS être retenté en
    // boucle, juste relevé tel quel.
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

// Le contrôle de bout en bout : rafraichir() et rafraichirMotsCles() appelés SANS
// `recuperer` injecté prennent leur repli par défaut — recupererHttps pour l'un,
// recupererAvecRepli pour l'autre. Si la garde ne couvrait pas vraiment ce chemin (une
// régression qui réintroduirait un client réseau local, par exemple), ceci partirait en
// silence interroger ojs.szh.ch ou edudoc.ch au lieu de rendre une erreur nette — exactement
// la panne que SZH_RESEAU_INTERDIT existe pour empêcher.

function cacheVideTemporaire(prefixe, nomFichier) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  return path.join(dossier, nomFichier);
}

test('rafraichir (auteur·e·s) sans recuperer injecté : la garde coupe, pas un vrai appel', async () => {
  await avecReseauInterdit(async () => {
    const avantCache = process.env.SZH_AUTEURS_CACHE;
    process.env.SZH_AUTEURS_CACHE = cacheVideTemporaire('szh-oai-pmh-auteurs-', 'auteurs.json');
    try {
      // Cache absent -> cacheVide() -> dateFetch null -> jamais frais : rafraichir() va
      // donc bien tenter un appel, et c'est cet appel que la garde doit intercepter.
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
