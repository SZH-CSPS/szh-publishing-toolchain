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
  // Le résumé « 3 règle(s) ne sont pas respectées » ne double plus les règles qui suivent :
  // la carte les nomme une par une, le chiffre n'y ajoutait rien.
  assert.doesNotMatch(phrases, /règle\(s\) ne sont pas respectées|PDF non conforme PDF\/UA/,
    'le résumé PDF/UA double les règles détaillées : ' + phrases);
  assert.strictEqual(carte.messages.length, 2, 'une phrase par règle, et rien d’autre : ' + phrases);
  // Le compte seul ne se corrige pas : la règle, sa cause et son geste doivent suivre. La
  // règle est le titre du message (la carte dit déjà « Accessibilité du PDF ») ; le geste
  // est sa consigne ; la cause et le repère ISO sont passés dans l'infobulle (29.09.2026).
  const regleTitre = (carte.messages || []).find((m) => /pas de titre/.test(m.titre || ''));
  assert.ok(regleTitre, 'la règle en échec n’est pas nommée : ' + phrases);
  assert.strictEqual(regleTitre.titre, 'Le document n’a pas de titre (1 fois, page(s) 3)');
  assert.strictEqual(regleTitre.consigne, 'remplir le titre.',
    'le geste de la règle ne suit pas : ' + JSON.stringify(regleTitre));
  assert.match(regleTitre.infobulle, /le champ title de la fiche est vide\./,
    'la cause de la règle s’est perdue : ' + regleTitre.infobulle);
  assert.match(regleTitre.infobulle, /ISO 14289-1 7\.1-9/, 'le repère ISO s’est perdu');
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

// ---- 8. Le résumé ne sort que s'il est seul -----------------------------------------
//
// Un verdict non conforme sans règle lisible (bloc tronqué, cache d'avant `details`) doit
// garder l'article dans « À corriger » : c'est le seul cas où le résumé reste.

// Un second exemplaire du module, état mémoire neuf, sans toucher à celui de l'hôte.
function moduleFrais() {
  const cleModule = require.resolve(path.join(COCKPIT, 'lib', 'pdfua-hote.js'));
  const original = require.cache[cleModule];
  delete require.cache[cleModule];
  const frais = require(cleModule);
  require.cache[cleModule] = original;
  return frais;
}

test('le résumé PDF/UA ne sort que si aucune règle détaillée ne suit', async () => {
  await HOTE.stub.workspace.getConfiguration('szh').update('controlePdfUa', true);
  const emp = empreinteFichier(PDF);
  const sauve = fs.readFileSync(CACHE, 'utf8');
  try {
    fs.writeFileSync(CACHE, JSON.stringify({ version: 1, verdicts: {
      '01-essai': { empreinte: emp, verdict: 'non-conforme', regles: 2,
                    details: { fr: [], de: [] }, date: '' } } }));
    const frais = moduleFrais();
    frais.configurer({ listerArticles: () => ['01-essai'], racine: () => REVUE });
    assert.deepStrictEqual(frais.constats(REVUE, 'fr').map((c) => c.code), ['non-conforme'],
      'sans règle détaillée, l’article non conforme disparaît du panneau');

    fs.writeFileSync(CACHE, JSON.stringify({ version: 1, verdicts: {
      '01-essai': { empreinte: emp, verdict: 'non-conforme', regles: 1,
                    details: { fr: [{ regle: 'Titre absent', explication: '', repere: '7.1-9' }], de: [] },
                    date: '' } } }));
    const frais2 = moduleFrais();
    frais2.configurer({ listerArticles: () => ['01-essai'], racine: () => REVUE });
    assert.deepStrictEqual(frais2.constats(REVUE, 'fr').map((c) => c.code), ['regle'],
      'le résumé double encore la règle qu’il annonce');
  } finally {
    fs.writeFileSync(CACHE, sauve);
  }
});

// ---- 9. Un verdict sous un nom que plus aucun article ne porte ----------------------
//
// Mesuré sur 2025-02 (29.09.2026) : .szh-pdfua.json gardait 4 clés fantômes après une
// renumérotation (00-origf-massie, 02-origf-hug-schnyder…), comptées bloquantes dans la vue
// ET dans la barre d'état : le test `actuels[cle] !== undefined && …` de constats() laissait
// passer toute clé absente de listerCles().

test('un verdict de l’ancien slug n’apparaît plus, et quitte le cache', async () => {
  const sauve = fs.readFileSync(CACHE, 'utf8');
  try {
    // Le PDF de l'article renommé est encore là sous son nouveau nom : même empreinte.
    const emp = empreinteFichier(PDF);
    fs.writeFileSync(CACHE, JSON.stringify({ version: 1, verdicts: {
      '00-ancien': { empreinte: 'ffff', verdict: 'non-conforme', regles: 1,
                     details: { fr: [{ regle: 'Fantôme', explication: '' }], de: [] }, date: '' },
      '03-renomme': { empreinte: emp, verdict: 'conforme', regles: 0,
                      details: { fr: [], de: [] }, date: 'x' }
    } }));
    const frais = moduleFrais();
    frais.configurer({ listerArticles: () => ['01-essai'], racine: () => REVUE });
    assert.deepStrictEqual(frais.constats(REVUE, 'fr'), [],
      'le verdict d’un slug disparu est encore montré');
    assert.strictEqual(frais.purgerAbsents(REVUE), true, 'rien n’a été purgé');
    const cache = lireCache();
    assert.deepStrictEqual(Object.keys(cache.verdicts), ['01-essai'],
      'des clés fantômes restent dans .szh-pdfua.json : ' + Object.keys(cache.verdicts));
    // Même PDF, nouveau nom : le verdict suit au lieu d'être rejugé.
    assert.strictEqual(cache.verdicts['01-essai'].date, 'x', 'le verdict au même PDF n’a pas migré');
    // Une liste vide (fournisseur pas encore chargé) ne purge rien.
    frais.configurer({ listerArticles: () => [] });
    assert.strictEqual(frais.purgerAbsents(REVUE), false);
  } finally {
    fs.writeFileSync(CACHE, sauve);
  }
});

// ---- 10. Le voile « Analyse en cours… » de la vue « À corriger » --------------------

function derniereAnalyse(p) {
  return p.messages.filter((m) => m.type === 'analyse').pop() || null;
}

test('voile : posé au démarrage, levé seulement après le journal ET la validation PDF/UA', async () => {
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });

  fs.writeFileSync(PDF, 'VOILE-1');
  let resoudre = null;
  prochaineReponse = () => new Promise((r) => { resoudre = r; });

  HOTE.demarrerTache(NOM_TACHE_BUILD);                // Ctrl+S : article inconnu
  const pose = derniereAnalyse(p);
  assert.ok(pose && pose.actif === true, 'aucun voile au démarrage de la compilation');
  // Aucun enregistrement ne l'a précédée : article inconnu, aucune carte voilée (la page
  // n'affiche que le bandeau), jamais toute la liste.
  assert.strictEqual(pose.cle, '', 'slug inconnu : aucune carte ne doit être visée');
  assert.deepStrictEqual(pose.cles, []);
  assert.strictEqual(pose.texte, 'Analyse en cours…');

  HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();
  await laisserDecanter();
  assert.strictEqual(pdfuaHote.etat('01-essai').verdict, 'en-cours', 'décor : la validation doit tourner');
  assert.strictEqual(derniereAnalyse(p).actif, true,
    'le voile tombe avant la fin de la validation PDF/UA');
  // Un panneau rafraîchi pendant l'analyse la montre d'emblée.
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.ok(charge.analyse && charge.analyse.actif, '« valeurs » ne porte pas le voile en cours');

  resoudre(reponseConforme('01-essai.pdf'));
  await laisserDecanter();
  await laisserDecanter();
  assert.strictEqual(derniereAnalyse(p).actif, false, 'le voile reste après la validation');
  const apres = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.strictEqual(apres.analyse.actif, false, '« valeurs » porte encore le voile');
});

test('voile : une tâche interrompue ou en échec ne le laisse pas coincé', async () => {
  const p = HOTE.panneauDeType('szhVueControles');
  HOTE.demarrerTache(NOM_TACHE_BUILD);
  assert.strictEqual(derniereAnalyse(p).actif, true);
  HOTE.finirTacheSansProcessus(NOM_TACHE_BUILD);
  assert.strictEqual(derniereAnalyse(p).actif, false, 'le voile reste après une tâche annulée');
  // Une compilation en échec : pas de validation, le voile tombe avec le journal.
  HOTE.demarrerTache(NOM_TACHE_BUILD);
  HOTE.finirTache(NOM_TACHE_BUILD, 2);
  await laisserDecanter();
  await laisserDecanter();
  assert.strictEqual(derniereAnalyse(p).actif, false, 'le voile reste après une compilation en échec');
});

test('voile : Ctrl+S sur un article ne voile que cet article', async () => {
  const p = HOTE.panneauDeType('szhVueControles');
  HOTE.enregistrerDocument(path.join(REVUE, 'articles', '01-essai', '01-essai.md'));
  HOTE.demarrerTache(NOM_TACHE_BUILD);
  const pose = derniereAnalyse(p);
  assert.ok(pose && pose.actif, 'aucun voile au démarrage');
  assert.deepStrictEqual(pose.cles, ['01-essai'], 'le voile ne vise pas l’article enregistré');
  HOTE.finirTacheSansProcessus(NOM_TACHE_BUILD);
  assert.strictEqual(derniereAnalyse(p).actif, false);
});

// ---- 11. Renommer des dossiers : plus rien sous l'ancien nom ------------------------

test('après une renumérotation, aucun constat ni verdict sous un ancien slug', async () => {
  const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  const JOURNAL = path.join(REVUE, '.szh-journal.log');
  // Un troisième article, non conforme, avec un défaut de citation au journal.
  const dossier = path.join(REVUE, 'articles', '03-trois');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, '03-trois.md'), 'Texte.');
  const pdf3 = path.join(REVUE, 'out', '03-trois', '03-trois.pdf');
  fs.mkdirSync(path.dirname(pdf3), { recursive: true });
  fs.writeFileSync(pdf3, 'TROIS');
  fs.writeFileSync(JOURNAL, '[citations-avertissement] appel-sans-reference | article « 03-trois » '
    + '| appel « (Shaw, 2023) » | Appel sans référence : (Shaw, 2023). '
    + '| [de] Zitatverweis ohne Eintrag: (Shaw, 2023).');
  await HOTE.executer('szh.cockpit.rafraichir');
  const conforme = reponseConforme('01-essai.pdf');
  const non = reponseNonConforme('03-trois.pdf', 1);
  prochaineReponse = { lignes: conforme.lignes.concat(non.lignes), code: 1, erreur: null };
  HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();
  await laisserDecanter();
  assert.ok(lireCache().verdicts['03-trois'], 'décor : le verdict de 03-trois doit être en cache');

  const p = HOTE.panneauDeType('szhVueControles');
  const titres = () => p.messages.filter((m) => m.type === 'valeurs').pop()
    .lignes.map((l) => l.titre).join(' | ');
  await p._recepteur({ type: 'pret' });
  assert.match(titres(), /03-trois/, 'décor : 03-trois doit avoir ses cartes');

  // Supprimer 02-sans-fiche renumérote : 01-essai -> 00-essai, 03-trois -> 01-trois.
  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await HOTE.executer('szh.supprimerArticle', { slug: '02-sans-fiche' });
  await laisserDecanter();
  assert.ok(fs.existsSync(path.join(REVUE, 'articles', '01-trois')), 'décor : le renommage n’a pas eu lieu');

  await p._recepteur({ type: 'pret' });
  assert.doesNotMatch(titres(), /03-trois|01-essai|02-sans-fiche/,
    'le panneau montre encore un article sous un nom disparu : ' + titres());
  const cles = Object.keys(lireCache().verdicts);
  assert.ok(cles.indexOf('03-trois') === -1 && cles.indexOf('01-essai') === -1,
    'des verdicts restent sous les anciens slugs : ' + cles);
  assert.strictEqual(HOTE.barreQuiDit('à corriger'), null,
    'la barre d’état compte encore les défauts d’un ancien slug');
  // Le journal, lui, nomme toujours 03-trois : relu tel quel à la fin d'une tâche (même
  // lecture qu'au redémarrage), il ne doit rien réinjecter. Une tâche réussie : un échec
  // sans cause lisible poserait sa propre carte au numéro.
  prochaineReponse = { lignes: [], code: 0, erreur: null };
  HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();
  await p._recepteur({ type: 'pret' });
  assert.doesNotMatch(titres(), /03-trois/, 'le journal réinjecte l’ancien slug : ' + titres());
  assert.strictEqual(HOTE.barreQuiDit('à corriger'), null,
    'la barre d’état compte l’ancien slug relu au journal');
});
