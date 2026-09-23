// Validation PDF/UA en arrière-plan (lib/pdfua-hote.js) : après chaque compilation
// réussie, sans bloquer la rédaction, avec un badge par article dans la barre d'état et
// un cache par empreinte du PDF pour ne pas revalider ce qui n'a pas changé.
//
//   node --test "test/js/*.test.js"
//
// Un seul hôte, réellement activé, pour tout le fichier : les scénarios s'enchaînent sur
// le même numéro, comme test/js/controles.test.js. child_process.spawn n'est pas simulé
// par le harnais (voir hote-factice.js) : le lancement réel du validateur est remplacé par
// un faux `lancerValidateur` injecté via pdfuaHote.configurer(), après celui que
// extension.js a déjà posé à l'activation — configurer() fusionne, il ne remplace pas.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { revueDEssai, activerHote } = require('./hote-factice');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

const NOM_TACHE_BUILD = 'Aperçu / Export PDF';

const REVUE = revueDEssai();
const PDF = path.join(REVUE, 'out', '01-essai', '01-essai.pdf');
fs.mkdirSync(path.dirname(PDF), { recursive: true });
fs.writeFileSync(PDF, 'A');                          // contenu quelconque, remplacé plus bas

const CACHE = path.join(REVUE, '.szh-pdfua.json');

const HOTE = activerHote(REVUE);

// Même module que celui chargé par extension.js (require('./lib/pdfua-hote') depuis
// extension.js résout le même chemin absolu) : le cache de require le garantit, c'est ce
// qui permet à configurer() ci-dessous d'atteindre le module que l'hôte utilise vraiment.
const pdfuaHote = require(path.join(COCKPIT, 'lib', 'pdfua-hote.js'));

// ---- Le faux validateur --------------------------------------------------------------
//
// Chaque appel est retenu (chemins relatifs reçus), et répond selon `prochaineReponse` :
// un objet { lignes, code, erreur } résolu tout de suite, ou une fonction qui rend elle-
// même une promesse — pour le scénario où le test contrôle à la main quand elle se résout.
const appelsValidateur = [];
let prochaineReponse = { lignes: [], code: 0, erreur: null };

pdfuaHote.configurer({
  lancerValidateur: (racine, pdfsRelatifs) => {
    appelsValidateur.push(pdfsRelatifs);
    return typeof prochaineReponse === 'function'
      ? prochaineReponse(racine, pdfsRelatifs)
      : Promise.resolve(prochaineReponse);
  }
});

function reponseConforme(fichier) {
  return { lignes: ['[pdf-ua] PDF/UA-1 : ' + fichier + ' — conforme.'], code: 0, erreur: null };
}

// Le format de pipeline/rapport-ua.py : un bloc par langue, chaque règle suivie de sa
// cause, de son geste (repliés sur deux lignes ici) et de son repère ISO.
function reponseNonConforme(fichier, n) {
  return {
    lignes: [
      '[pdf-ua] PDF/UA-1 : ' + fichier + ' — NON conforme, ' + n + ' règle(s) en échec.',
      '[pdf-ua]   • Le document n’a pas de titre (1 fois, page(s) 3)',
      '[pdf-ua]       En cause : le champ title de la fiche',
      '[pdf-ua]                  est vide.',
      '[pdf-ua]       À faire  : remplir le titre.',
      '[pdf-ua]   ISO 14289-1 7.1-9',
      '[pdf-ua]   • Police non incorporée (2 fois)',
      '[pdf-ua]       À faire  : signalez-le.',
      '[pdf-ua]   ISO 14289-1 7.21.4.1-1',
      '[pdf-ua] 1 fichier(s) sur 1 ne sont pas conformes : l’export est arrêté.',
      '[pdf-ua] [de] PDF/UA-1: ' + fichier + ' — NICHT konform, ' + n + ' Regel(n) nicht erfüllt.',
      '[pdf-ua] [de]   • Das Dokument hat keinen Titel (1 Mal, Seite(n) 3)',
      '[pdf-ua] [de]       Ursache: das Feld title ist leer.',
      '[pdf-ua] [de]   ISO 14289-1 7.1-9'
    ],
    code: 1, erreur: null
  };
}

function reponseOutillage() {
  return {
    lignes: ['[pdf-ua] ✗ Le validateur PDF/UA n’a pas pu rendre de verdict (code 2).'],
    code: 2, erreur: null
  };
}

function empreinteFichier(chemin) {
  return crypto.createHash('sha1').update(fs.readFileSync(chemin)).digest('hex');
}

function lireCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { return null; }
}

// Laisse la chaîne de promesses (relireJournal -> planifier -> unTravail -> …) atteindre
// son prochain point d'arrêt : aucun de ces maillons ne dépend d'un minuteur, seulement de
// l'ordonnancement des micro-tâches, qu'un setImmediate laisse toujours se vider avant lui.
function laisserDecanter() { return new Promise((r) => setImmediate(r)); }

// ---- 1. Un PDF conforme, validé une fois, badge conforme ----------------------------

test('après une compilation réussie, un PDF conforme est validé et affiche un badge', async () => {
  await HOTE.executer('szh.cockpit.rafraichir');       // ce que fait l'ouverture du numéro
  await HOTE.executer('szh.ouvrirArticle', '01-essai', { sansApercu: true });

  fs.writeFileSync(PDF, 'CONTENU-CONFORME');
  const avant = appelsValidateur.length;
  prochaineReponse = reponseConforme('01-essai.pdf');

  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();

  assert.strictEqual(appelsValidateur.length, avant + 1, 'le validateur n’a pas été appelé');
  assert.deepStrictEqual(appelsValidateur[avant], ['out/01-essai/01-essai.pdf'],
    'le validateur ne reçoit pas le bon chemin relatif');

  const cache = lireCache();
  assert.ok(cache && cache.verdicts && cache.verdicts['01-essai'], 'aucun verdict en cache');
  assert.strictEqual(cache.verdicts['01-essai'].verdict, 'conforme');
  assert.strictEqual(cache.verdicts['01-essai'].empreinte, empreinteFichier(PDF),
    'l’empreinte en cache n’est pas celle du PDF validé');

  const badge = HOTE.barreQuiDit('PDF/UA');
  assert.ok(badge, 'aucun badge PDF/UA visible pour l’article ouvert');
  assert.match(badge.text, /\$\(verified\)/, 'le badge ne dit pas conforme : ' + badge.text);
});

// ---- 2. Rien n'a changé : pas de nouvel appel ----------------------------------------

test('sans changement du PDF, une nouvelle compilation ne revalide pas', async () => {
  const avant = appelsValidateur.length;
  prochaineReponse = reponseConforme('01-essai.pdf');

  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();

  assert.strictEqual(appelsValidateur.length, avant,
    'le validateur a été rappelé sans que le PDF ait changé');
});

// ---- 3. Un PDF modifié et non conforme bloque, et se voit dans les Contrôles --------

test('un PDF modifié et non conforme est compté bloquant et montré dans les Contrôles', async () => {
  fs.writeFileSync(PDF, 'BB');                         // taille différente : empreinte différente
  const avant = appelsValidateur.length;
  prochaineReponse = reponseNonConforme('01-essai.pdf', 3);

  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();

  assert.strictEqual(appelsValidateur.length, avant + 1);
  assert.ok(HOTE.barreQuiDit('à corriger'), 'le compteur des Contrôles ne suit pas un PDF non conforme');

  const badge = HOTE.barreQuiDit('PDF/UA');
  assert.ok(badge && /\$\(error\)/.test(badge.text), 'le badge ne dit pas non conforme : ' + (badge && badge.text));

  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  assert.ok(p, 'la vue des Contrôles ne s’ouvre pas');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  const carte = charge.lignes.find((l) => l.meta === 'Accessibilité du PDF');
  assert.ok(carte, 'aucune carte « Accessibilité du PDF » dans la vue Contrôles : '
    + JSON.stringify(charge.lignes.map((l) => l.meta)));
  // Une carte par article, plusieurs défauts dessous : la phrase est dans l'un d'eux.
  const phrases = (carte.messages || []).map((m) => m.texte).join(' | ');
  assert.match(phrases, /3 règle/, 'le nombre de règles en échec n’est pas dans la phrase : ' + phrases);
  // Le compte seul ne se corrige pas : la règle, sa cause et son geste doivent suivre.
  assert.match(phrases, /Règle PDF\/UA non respectée\s:\sLe document n’a pas de titre \(1 fois, page\(s\) 3\)/,
    'la règle en échec n’est pas nommée : ' + phrases);
  assert.match(phrases, /En cause\s:\sle champ title de la fiche est vide\. À faire\s:\sremplir le titre\./,
    'la cause et le geste de la règle ne suivent pas : ' + phrases);
  assert.doesNotMatch(phrases, /ISO 14289|Titel/, 'le repère ou la moitié allemande a fui : ' + phrases);
  // La flèche de la règle mène à la fiche, sur le champ du titre ; un défaut de la chaîne
  // (police non incorporée) n'en a pas : rien à corriger dans l'article.
  const titre = carte.messages.find((m) => /pas de titre/.test(m.texte));
  assert.ok(titre && titre.action, 'la règle du titre n’a pas de flèche : ' + JSON.stringify(titre));
  assert.strictEqual(titre.action.id, 'fiche:title');
  const police = carte.messages.find((m) => /Police non incorporée/.test(m.texte));
  assert.ok(police && police.action === null, 'un défaut de la chaîne a reçu une flèche');
  assert.ok(lireCache().verdicts['01-essai'].details.de.length === 1,
    'la moitié allemande n’est pas gardée en cache');
});

test('un verdict non conforme mis en cache sans ses règles est rejugé', async () => {
  const cache = lireCache();
  delete cache.verdicts['01-essai'].details;
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  // Le cache se relit au premier accès à une racine : on repart d'un état mémoire neuf,
  // dans un second exemplaire du module, sans toucher à celui de l'hôte.
  const cleModule = require.resolve(path.join(COCKPIT, 'lib', 'pdfua-hote.js'));
  const original = require.cache[cleModule];
  delete require.cache[cleModule];
  const frais = require(cleModule);
  require.cache[cleModule] = original;
  let appels = 0;
  frais.configurer({
    lancerValidateur: () => { appels++; return Promise.resolve(reponseNonConforme('01-essai.pdf', 3)); },
    listerArticles: () => ['01-essai'], racine: () => REVUE
  });
  await frais.planifier(REVUE);
  assert.strictEqual(appels, 1, 'un verdict sans règles a été gardé tel quel');
  const regles = frais.constats(REVUE, 'de').filter((c) => c.code === 'regle');
  assert.deepStrictEqual(regles.map((c) => c.champs.regle), ['Das Dokument hat keinen Titel (1 Mal, Seite(n) 3)']);
});

// ---- 4. Une panne d'outillage n'est ni un verdict ni un blocage ---------------------

test('une panne du validateur affiche « en question », sans compter comme bloquant', async () => {
  fs.writeFileSync(PDF, 'CCC');
  const avant = appelsValidateur.length;
  prochaineReponse = reponseOutillage();

  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();

  assert.strictEqual(appelsValidateur.length, avant + 1);
  const badge = HOTE.barreQuiDit('PDF/UA');
  assert.ok(badge && /\$\(question\)/.test(badge.text), 'le badge ne dit pas panne d’outillage : '
    + (badge && badge.text));
  assert.strictEqual(HOTE.barreQuiDit('à corriger'), null,
    'une panne d’outillage ne doit pas compter comme un défaut à corriger');

  const cache = lireCache();
  const enCache = (cache && cache.verdicts && cache.verdicts['01-essai']) || null;
  assert.ok(!enCache || enCache.empreinte !== empreinteFichier(PDF),
    'un verdict a été mis en cache pour un PDF que le validateur n’a pas su juger');
});

// ---- 5. Une compilation en échec ne lance pas la validation --------------------------

test('une compilation en échec ne déclenche pas la validation PDF/UA', async () => {
  const avant = appelsValidateur.length;
  await HOTE.finirTache(NOM_TACHE_BUILD, 1);
  await laisserDecanter();
  assert.strictEqual(appelsValidateur.length, avant,
    'le validateur a été appelé après une compilation qui a échoué');
});

// ---- 6. Une compilation démarrée pendant la validation jette le résultat ------------

test('un verdict qui revient après le début d’une nouvelle compilation est jeté', async () => {
  fs.writeFileSync(PDF, 'DDDD');
  const avant = appelsValidateur.length;
  let resoudre = null;
  prochaineReponse = () => new Promise((resolve) => { resoudre = resolve; });

  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();                             // le travail atteint l'attente du faux validateur

  assert.strictEqual(appelsValidateur.length, avant + 1, 'le validateur aurait dû être appelé');
  assert.strictEqual(pdfuaHote.etat('01-essai').verdict, 'en-cours');

  const cacheAvant = lireCache();
  HOTE.demarrerTache(NOM_TACHE_BUILD);                  // une compilation démarre pendant l'attente
  assert.ok(typeof resoudre === 'function');
  resoudre(reponseConforme('01-essai.pdf'));
  await laisserDecanter();

  const cacheApres = lireCache();
  assert.deepStrictEqual(cacheApres, cacheAvant,
    'le cache a changé alors que le résultat aurait dû être jeté');
  assert.notStrictEqual(pdfuaHote.etat('01-essai').verdict, 'conforme',
    'le verdict jeté a quand même été retenu');
});

// ---- 7. Réglage désactivé : rien ne se lance, le badge se tait ----------------------

test('réglage désactivé : le validateur n’est pas appelé et le badge se cache', async () => {
  // Un état de départ net : un verdict conforme à jour, pour prouver que le badge
  // disparaît à cause du réglage et non d'un verdict simplement périmé (voir le
  // scénario 6, qui laisse justement un verdict périmé derrière lui).
  fs.writeFileSync(PDF, 'EEEEE');
  prochaineReponse = reponseConforme('01-essai.pdf');
  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();
  assert.ok(HOTE.barreQuiDit('PDF/UA'), 'le badge devrait être visible avant de désactiver le réglage');

  await HOTE.stub.workspace.getConfiguration('szh').update('controlePdfUa', false);

  fs.writeFileSync(PDF, 'FFFFFF');                      // un contenu neuf, qui aurait sinon revalidé
  const avant = appelsValidateur.length;
  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();
  assert.strictEqual(appelsValidateur.length, avant,
    'le validateur a été appelé alors que le réglage est désactivé');

  // Le badge ne se recalcule qu'au changement d'article : on en simule un pour vérifier
  // qu'il se cache pour de bon, et pas seulement qu'il n'a pas été retouché depuis.
  await HOTE.executer('szh.ouvrirArticle', '02-sans-fiche', { sansApercu: true });
  await HOTE.executer('szh.ouvrirArticle', '01-essai', { sansApercu: true });
  await laisserDecanter();

  assert.strictEqual(HOTE.barreQuiDit('PDF/UA'), null,
    'le badge reste visible alors que le réglage PDF/UA est désactivé');
});
