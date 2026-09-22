// outils/auteurs-cli.js : le point d'entrée en ligne de commande sur le moissonneur des
// auteur·e·s publiés (lib/auteurs-ojs.js, lib/auteurs-corpus.js), lancé par
// windows/open-produit.ps1 au démarrage du lanceur (voir Start-SzhMoissonAuteurs, même
// fichier) -- pas seulement à l'activation du cockpit. Ce fichier ne rejoue AUCUN moissonnage
// réel : executerRafraichissement() prend ses deux moissonneurs en paramètre, exactement
// comme lib/auteurs-ojs.js#rafraichir() prend son `recuperer` -- aucun test ici ne fait de
// réseau ni ne lance PowerShell (voir aussi le test « bout en bout » plus bas, qui redirige
// SZH_BASE et SZH_AUTEURS_CACHE vers un dossier jetable et bloque le réseau réel via
// SZH_RESEAU_INTERDIT).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const CLI = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'outils', 'auteurs-cli.js');
const { executerRafraichissement } = require(CLI);

// ---- Contrôle n1 : appelle bien les deux moissonneurs, dans l'ordre, sans argument -------
// « sans argument » compte : c'est ce qui garantit la même politique de fraîcheur que
// rafraichirAuteursPubliesEnFond() (lib/metadonnees-hote.js) -- un argument oublié ou ajouté
// ici court-circuiterait cacheFrais() sans que rien ne le dise.

test('executerRafraichissement : appelle rafraichirOjs puis rafraichirCorpus, sans argument, une seule fois chacun',
  async () => {
    const appels = [];
    const lignes = [];
    const resultat = await executerRafraichissement({
      emettre: (o) => lignes.push(o),
      rafraichirOjs: async (...a) => { appels.push(['ojs', a]); return { fait: true, complet: true, nombre: 42, nombreRor: 3, rorRates: 0 }; },
      rafraichirCorpus: async (...a) => { appels.push(['corpus', a]); return { fait: true, complet: true, nombre: 50, fichiers: 12 }; }
    });
    assert.strictEqual(appels.length, 2, 'les deux moissonneurs doivent être appelés exactement une fois chacun');
    assert.strictEqual(appels[0][0], 'ojs', 'auteurs-ojs doit être moissonné avant le corpus (même ordre que rafraichirAuteursPubliesEnFond)');
    assert.strictEqual(appels[1][0], 'corpus');
    assert.deepStrictEqual(appels[0][1], [], 'rafraichirOjs ne doit recevoir aucun argument');
    assert.deepStrictEqual(appels[1][1], [], 'rafraichirCorpus ne doit recevoir aucun argument');
    assert.strictEqual(resultat.ojs.nombre, 42);
    assert.strictEqual(resultat.corpus.nombre, 50);
  });

test('executerRafraichissement : succès complet -> deux étapes puis fin ok, dans cet ordre', async () => {
  const lignes = [];
  await executerRafraichissement({
    emettre: (o) => lignes.push(o),
    rafraichirOjs: async () => ({ fait: true, complet: true, nombre: 7, nombreRor: 1, rorRates: 0 }),
    rafraichirCorpus: async () => ({ fait: true, complet: true, nombre: 9, fichiers: 4 })
  });
  assert.strictEqual(lignes.length, 3, 'deux étapes + une fin attendues : ' + JSON.stringify(lignes));
  assert.strictEqual(lignes[0].t, 'etape');
  assert.match(lignes[0].texte, /auteurs-ojs/);
  assert.strictEqual(lignes[1].t, 'etape');
  assert.match(lignes[1].texte, /auteurs-corpus/);
  const fin = lignes[lignes.length - 1];
  assert.deepStrictEqual(fin, { t: 'fin', ok: true }, 'la ligne fin doit toujours être { t: "fin", ok: true }');
});

test('executerRafraichissement : cache frais des deux côtés -> le dit, jamais une erreur', async () => {
  const lignes = [];
  await executerRafraichissement({
    emettre: (o) => lignes.push(o),
    rafraichirOjs: async () => ({ fait: false, raison: 'frais', dateFetch: '2026-09-01T00:00:00.000Z', nombre: 100 }),
    rafraichirCorpus: async () => ({ fait: false, raison: 'frais', dateCorpus: '2026-09-01T00:00:00.000Z', nombre: 100 })
  });
  assert.match(lignes[0].texte, /cache frais/);
  assert.match(lignes[1].texte, /cache frais/);
  assert.strictEqual(lignes[lignes.length - 1].ok, true);
});

test('executerRafraichissement : moissonnage OJS incomplet (hors ligne) -> une étape le dit, le corpus tourne quand même',
  async () => {
    const lignes = [];
    const appels = [];
    await executerRafraichissement({
      emettre: (o) => lignes.push(o),
      rafraichirOjs: async () => ({ fait: true, complet: false, erreur: 'HTTP 503 : https://ojs.szh.ch/...' }),
      rafraichirCorpus: async () => { appels.push('corpus'); return { fait: true, complet: true, nombre: 5, fichiers: 2 }; }
    });
    assert.match(lignes[0].texte, /incomplet/);
    assert.match(lignes[0].texte, /HTTP 503/);
    assert.strictEqual(appels.length, 1, 'le corpus doit quand même être moissonné après un OJS incomplet');
    assert.strictEqual(lignes[lignes.length - 1].ok, true, 'un moissonnage incomplet (hors ligne) n’est jamais un échec du point de vue du script');
  });

// ---- Contrôle n2 : « muet en cas d'échec » -- même si un moissonneur LÈVE (ce qu'aucun des
// deux ne devrait faire en usage réel, mais le filet doit tenir), executerRafraichissement
// ne relance jamais, et poursuit vers le second moissonneur, puis vers la ligne « fin ». ----

test('executerRafraichissement : rafraichirOjs qui lève -> avalé, le corpus tourne quand même, fin ok',
  async () => {
    const lignes = [];
    const appels = [];
    const resultat = await executerRafraichissement({
      emettre: (o) => lignes.push(o),
      rafraichirOjs: async () => { throw new Error('panne imprévue OJS'); },
      rafraichirCorpus: async () => { appels.push('corpus'); return { fait: true, complet: true, nombre: 1, fichiers: 1 }; }
    });
    assert.strictEqual(appels.length, 1, 'le corpus doit être moissonné même après une exception côté OJS');
    assert.match(lignes[0].texte, /panne imprévue OJS/);
    assert.strictEqual(lignes[lignes.length - 1].ok, true);
    assert.strictEqual(resultat.ojs, null, 'resOjs reste null quand rafraichirOjs a levé');
    assert.strictEqual(resultat.corpus.nombre, 1);
  });

test('executerRafraichissement : rafraichirCorpus qui lève -> avalé, fin ok quand même', async () => {
  const lignes = [];
  const resultat = await executerRafraichissement({
    emettre: (o) => lignes.push(o),
    rafraichirOjs: async () => ({ fait: true, complet: true, nombre: 3, nombreRor: 0, rorRates: 0 }),
    rafraichirCorpus: async () => { throw new Error('panne imprévue corpus'); }
  });
  const derniereEtape = lignes.find((l) => l.t === 'etape' && /auteurs-corpus/.test(l.texte));
  assert.ok(derniereEtape, 'aucune étape auteurs-corpus émise');
  assert.match(derniereEtape.texte, /panne imprévue corpus/);
  assert.strictEqual(lignes[lignes.length - 1].ok, true);
  assert.strictEqual(resultat.corpus, null, 'resCorpus reste null quand rafraichirCorpus a levé');
});

// ---- Contrôle n3 : l'architecture -- zéro logique de moissonnage propre, et jamais un ----
// require('vscode') (ce script tourne hors de l'hôte d'extensions, sous VSCodium-en-Node) ----

test('auteurs-cli.js ne réimplémente aucun moissonnage : les vrais rafraichir/rafraichirCorpus sont requis tels quels',
  () => {
    const source = fs.readFileSync(CLI, 'utf8');
    assert.match(source, /require\(path\.join\(__dirname, '\.\.', 'lib', 'auteurs-ojs\.js'\)\)/,
      'auteurs-cli.js ne require plus lib/auteurs-ojs.js directement');
    assert.match(source, /require\(path\.join\(__dirname, '\.\.', 'lib', 'auteurs-corpus\.js'\)\)/,
      'auteurs-cli.js ne require plus lib/auteurs-corpus.js directement');
    // Jamais lib/metadonnees-hote.js (require('vscode') en tête, absent hors de l'hôte
    // d'extensions -- voir son en-tête) ni 'vscode' lui-même. Les deux noms apparaissent
    // dans les commentaires (ils expliquent pourquoi) -- on ne cherche donc que du CODE réel,
    // en écartant les lignes de commentaire // avant de chercher un require().
    const codeSeul = source.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/require\([^)]*metadonnees-hote/.test(codeSeul), 'auteurs-cli.js ne doit jamais require() lib/metadonnees-hote.js');
    assert.ok(!/require\(\s*['"]vscode['"]\s*\)/.test(codeSeul), 'auteurs-cli.js ne doit jamais require(\'vscode\')');
    // Aucune URL/endpoint OAI en dur, aucune logique de fusion/cache recopiée : un simple
    // comptage de fonctions déclarées au niveau du fichier reste bas -- une petite aide
    // d'émission par défaut, l'orchestration, et le point d'entrée. Rien qui ressemble à un
    // second parseur XML, une seconde règle de fraîcheur ou un second moissonneur.
    const nomsFonctions = [...source.matchAll(/^(?:async )?function (\w+)/gm)].map((m) => m[1]);
    assert.deepStrictEqual(nomsFonctions.sort(), ['emettreDefaut', 'executerRafraichissement', 'main'].sort(),
      'auteurs-cli.js déclare d’autres fonctions que emettreDefaut/executerRafraichissement/main : ' + nomsFonctions.join(', '));
  });

// ---- Contrôle n4 : bout en bout, processus réel, mais totalement isolé --------------------
// SZH_BASE vers un dossier jetable -> lib/archivage.js#TOOLKIT (figé au chargement du module,
// donc lu dans CE process enfant fraîchement lancé) pointe vers
// <jetable>\toolkit\windows\szh-common.ps1, qui n'existe pas : lib/auteurs-corpus.js#racinesCorpus
// échoue donc APRÈS avoir seulement testé fs.existsSync -- aucun vrai powershell.exe n'est
// jamais lancé. SZH_AUTEURS_CACHE vers un fichier jetable -> jamais C:\ProgramData.
// SZH_RESEAU_INTERDIT=1 -> lib/oai-pmh.js#recupererHttps rejette IMMÉDIATEMENT, aucun octet
// vers ojs.szh.ch. Le seul but de ce test : prouver que le VRAI script (pas les fakes
// ci-dessus) se comporte comme documenté -- sort en 0, JSON Lines valides, « fin » en dernier.
test('auteurs-cli.js (processus réel, isolé) : sort en 0, JSON Lines valides, aucune écriture hors du dossier jetable',
  () => {
    const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-auteurs-cli-'));
    const cache = path.join(jetable, 'auteurs.json');
    const env = Object.assign({}, process.env, {
      SZH_BASE: jetable,
      SZH_AUTEURS_CACHE: cache,
      SZH_RESEAU_INTERDIT: '1'
    });
    const r = cp.spawnSync(process.execPath, [CLI], { encoding: 'utf8', timeout: 20000, env });
    assert.strictEqual(r.status, 0, 'code de sortie inattendu : ' + r.status + ' -- ' + r.stderr);
    assert.ok(!r.error, 'le processus n’a pas pu être lancé : ' + (r.error && r.error.message));
    const lignes = String(r.stdout).trim().split(/\r?\n/).filter((l) => l !== '').map((l) => JSON.parse(l));
    assert.ok(lignes.length >= 1, 'aucune ligne JSON sur stdout -- ' + r.stdout);
    const fin = lignes[lignes.length - 1];
    assert.strictEqual(fin.t, 'fin', 'la dernière ligne n’est pas le bilan -- ' + JSON.stringify(fin));
    assert.strictEqual(fin.ok, true);
    // Réseau bloqué -> OJS incomplet ; toolkit absent -> corpus « rien » ou erreur -- jamais
    // une trace de succès complet, ce qui prouverait que ce test a, par accident, touché le
    // vrai réseau ou la vraie installation.
    const texteComplet = lignes.map((l) => l.texte || '').join(' | ');
    assert.ok(texteComplet.indexOf('SZH_RESEAU_INTERDIT') !== -1 || /incomplet|rien fait|cache frais/.test(texteComplet),
      'la sortie ne montre aucun signe d’un réseau bloqué comme attendu -- ' + texteComplet);
    fs.rmSync(jetable, { recursive: true, force: true });
  });
