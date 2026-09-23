// Pagination continue du numéro (lib/pagination-hote.js) : lecture de l'état après chaque
// compilation d'un numéro déjà paginé, rafraîchissement manuel au bouclage, et les
// constats qu'un numéro périmé pose dans « À corriger ».
//
//   node --test "test/js/*.test.js"
//
// child_process.spawn n'est pas simulé par le harnais (voir hote-factice.js) : le
// lancement réel de `make` est remplacé par un faux `lancer` injecté via
// paginationHote.configurer(), après celui que extension.js a déjà posé à l'activation —
// configurer() fusionne, il ne remplace pas (même contrat que lib/pdfua-hote.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

const NOM_TACHE_BUILD = 'Aperçu / Export PDF';

// Même module que celui chargé par extension.js (require('./lib/pagination-hote') depuis
// extension.js résout le même chemin absolu) : le cache de require le garantit.
const paginationHote = require(path.join(COCKPIT, 'lib', 'pagination-hote.js'));

// ---- Le faux lanceur -------------------------------------------------------------------
// Chaque appel est retenu (l'argv reçu), et répond selon `prochaineReponse` : un objet
// { texte, code, erreur } résolu tout de suite. Jamais de vraie WSL.
const appelsLancer = [];
let prochaineReponse = { texte: '', code: 0, erreur: null };

paginationHote.configurer({
  lancer: (racine, argv) => {
    appelsLancer.push(argv);
    return Promise.resolve(prochaineReponse);
  }
});

function ligneEtat(obj) { return JSON.stringify(Object.assign({ schema: 'szh-pagination/1' }, obj)); }

function reponseEtat(obj, avantApres) {
  const av = avantApres || {};
  return {
    texte: [
      'pandoc articles/01-essai/01-essai.md -> out/01-essai/01-essai.html',
      av.avant || '',
      ligneEtat(obj),
      av.apres || ''
    ].filter((l) => l !== '').join('\n'),
    code: 0, erreur: null
  };
}

function laisserDecanter() { return new Promise((r) => setImmediate(r)); }

// =========================================================================================
// 1. extraireEtat() : la ligne JSON au milieu d'une sortie mêlée, pure.
// =========================================================================================

test('extraireEtat : reconnaît la ligne JSON au milieu de lignes de compilation', () => {
  const etat = { articles: [{ slug: '01-a', depart: 1, pages: 3, pdf: true }], total: 3,
                 perimes: [], inconnus: [], enregistre: true };
  const texte = [
    'pandoc articles/01-a/01-a.md -> out/01-a/01-a.html',
    'echo un avertissement quelconque',
    ligneEtat(etat),
    ''
  ].join('\n');
  const lu = paginationHote.extraireEtat(texte);
  assert.ok(lu, 'la ligne JSON n’a pas été trouvée au milieu de la sortie');
  assert.strictEqual(lu.total, 3);
  assert.deepStrictEqual(lu.articles, etat.articles);
});

test('extraireEtat : refuse un JSON d’un autre schéma', () => {
  const texte = JSON.stringify({ schema: 'szh-pdfua/1', ok: true });
  assert.strictEqual(paginationHote.extraireEtat(texte), null,
    'une ligne JSON d’un autre schéma a été prise pour un état de pagination');
});

test('extraireEtat : une ligne qui ne COMMENCE pas par {"schema" ne compte pas', () => {
  const texte = 'préfixe ' + ligneEtat({ articles: [], total: 0, perimes: [], inconnus: [], enregistre: false });
  assert.strictEqual(paginationHote.extraireEtat(texte), null,
    'une ligne JSON précédée d’un préfixe a quand même été reconnue');
});

test('extraireEtat : aucune ligne JSON dans la sortie -> null', () => {
  assert.strictEqual(paginationHote.extraireEtat('rien à voir\nici non plus\n'), null);
});

// =========================================================================================
// 2. constatsPagination() : un constat par slug périmé, pure.
// =========================================================================================

test('constatsPagination : un constat par slug périmé, dans l’ordre reçu', () => {
  const etat = { enregistre: true, perimes: ['03-b', '04-c'] };
  const constats = paginationHote.constatsPagination(etat);
  assert.strictEqual(constats.length, 2);
  assert.deepStrictEqual(constats[0], {
    source: 'pagination', code: 'perimee', slug: '03-b', ton: 'attention',
    cle: '', args: [], champs: { article: '03-b' }
  });
  assert.strictEqual(constats[1].slug, '04-c');
});

test('constatsPagination : rien si enregistre est faux, même avec des périmés', () => {
  const etat = { enregistre: false, perimes: ['03-b'] };
  assert.deepStrictEqual(paginationHote.constatsPagination(etat), []);
});

test('constatsPagination : rien si l’état est absent', () => {
  assert.deepStrictEqual(paginationHote.constatsPagination(null), []);
  assert.deepStrictEqual(paginationHote.constatsPagination(undefined), []);
});

// =========================================================================================
// 3. aRecompiler() : le compte de PDF qui seront refaits, pure.
// =========================================================================================

test('aRecompiler : jamais enregistré -> tous les articles comptent', () => {
  const etat = { articles: [{ slug: 'a', depart: 1 }, { slug: 'b', depart: 4 }] };
  assert.strictEqual(paginationHote.aRecompiler(etat, null), 2);
});

test('aRecompiler : rien n’a changé -> zéro', () => {
  const etat = { articles: [{ slug: 'a', depart: 1 }, { slug: 'b', depart: 4 }] };
  const registre = { articles: [{ slug: 'a', depart: 1 }, { slug: 'b', depart: 4 }] };
  assert.strictEqual(paginationHote.aRecompiler(etat, registre), 0);
});

test('aRecompiler : un départ qui glisse est compté (et entraîne les suivants)', () => {
  // 'a' s'est allongé (son départ enregistré était 1, resté 1 ici) mais 'b', qui le suit,
  // glisse de 4 à 6 : lui seul, et non 'a', doit compter.
  const etat = { articles: [{ slug: 'a', depart: 1 }, { slug: 'b', depart: 6 }] };
  const registre = { articles: [{ slug: 'a', depart: 1 }, { slug: 'b', depart: 4 }] };
  assert.strictEqual(paginationHote.aRecompiler(etat, registre), 1);
});

test('aRecompiler : un article absent du registre compte', () => {
  const etat = { articles: [{ slug: 'a', depart: 1 }, { slug: 'nouveau', depart: 4 }] };
  const registre = { articles: [{ slug: 'a', depart: 1 }] };
  assert.strictEqual(paginationHote.aRecompiler(etat, registre), 1);
});

// =========================================================================================
// 4. estPagine() : la seule présence de .szh-pagination.json.
// =========================================================================================

test('estPagine : faux tant que .szh-pagination.json n’existe pas, vrai une fois écrit', () => {
  const dossier = fs.mkdtempSync(path.join(RACINE, 'test', '.tmp-pagination-'));
  try {
    assert.strictEqual(paginationHote.estPagine(dossier), false);
    fs.writeFileSync(path.join(dossier, paginationHote.NOM_ETAT), '{}');
    assert.strictEqual(paginationHote.estPagine(dossier), true);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

// =========================================================================================
// 5. Sécurité : un slug qui n'a pas la forme d'un slug est refusé AVANT tout lancement.
// =========================================================================================

test('lireEtat : un ordre avec un slug invalide est refusé sans lancer le moindre processus', async () => {
  const avant = appelsLancer.length;
  await assert.rejects(() => paginationHote.lireEtat('/tmp/quelconque', ['01-a', '../evil']));
  assert.strictEqual(appelsLancer.length, avant, 'le lanceur a été appelé malgré un slug invalide');
});

test('rafraichir : un ordre avec un slug invalide est refusé sans lancer le moindre processus', async () => {
  const avant = appelsLancer.length;
  await assert.rejects(() => paginationHote.rafraichir('/tmp/quelconque', ['UN SLUG AVEC ESPACES']));
  assert.strictEqual(appelsLancer.length, avant, 'le lanceur a été appelé malgré un slug invalide');
});

test('lireEtat : un ordre vide est accepté (numéro sans article), le lanceur est appelé', async () => {
  const avant = appelsLancer.length;
  prochaineReponse = reponseEtat({ articles: [], total: 0, perimes: [], inconnus: [], enregistre: false });
  const etat = await paginationHote.lireEtat('/tmp/quelconque', []);
  assert.strictEqual(appelsLancer.length, avant + 1);
  assert.strictEqual(etat.enregistre, false);
});

test('lireEtat : rejette si make rend un code non nul', async () => {
  prochaineReponse = { texte: '', code: 2, erreur: null };
  await assert.rejects(() => paginationHote.lireEtat('/tmp/quelconque', ['01-a']));
});

test('lireEtat : rejette si aucune ligne JSON n’est reconnue', async () => {
  prochaineReponse = { texte: 'rien de reconnaissable\n', code: 0, erreur: null };
  await assert.rejects(() => paginationHote.lireEtat('/tmp/quelconque', ['01-a']));
});

// =========================================================================================
// 6. Intégration : le chemin « après compilation » d'extension.js, via le vrai cockpit.
// =========================================================================================
// Un seul hôte pour toute cette section, comme test/js/pdfua.test.js : les scénarios
// s'enchaînent sur le même numéro.

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

test('numéro jamais paginé : la fin d’une compilation ne lance AUCUN processus', async () => {
  const avant = appelsLancer.length;
  await HOTE.executer('szh.cockpit.rafraichir');       // ouverture du numéro
  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await laisserDecanter();
  assert.strictEqual(appelsLancer.length, avant,
    'un appel WSL a été tenté alors que le numéro n’a jamais été paginé — la rédaction, '
    + 'avant le bouclage, ne doit rien payer pour ce contrôle');
  assert.strictEqual(HOTE.barreQuiDit('à vérifier'), null,
    'un numéro jamais paginé ne doit poser aucun avertissement de pagination');
});

test('numéro déjà paginé : la fin d’une compilation pose un avertissement sur l’article périmé', async () => {
  fs.writeFileSync(path.join(REVUE, paginationHote.NOM_ETAT),
    JSON.stringify({ schema: 'szh-pagination/1', articles: [{ slug: '01-essai', depart: 1, pages: 3 }] }));
  prochaineReponse = reponseEtat({
    articles: [{ slug: '01-essai', depart: 1, pages: 5, pdf: true }],
    total: 5, perimes: ['01-essai'], inconnus: [], enregistre: true
  });

  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  // relireJournal() lance le contrôle en arrière-plan sans l'attendre : deux tours de
  // micro-tâches laissent la promesse de lireEtat() se résoudre puis poserConstatsPagination
  // s'exécuter avant qu'on ne lise l'état de la barre et de la vue.
  await laisserDecanter();
  await laisserDecanter();

  // Un avertissement (orange), pas un bloquant : pagination/perimee n'a pas de barrage —
  // voir lib/constats.js, TABLE['pagination/perimee'] et son commentaire.
  assert.ok(HOTE.barreQuiDit('à vérifier'), 'le compteur des Contrôles ne suit pas l’article périmé');

  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  const phrases = charge.lignes.flatMap((l) => (l.messages || []).map((m) => m.texte)).join(' | ');
  assert.match(phrases, /Pagination à mettre à jour/,
    'aucune carte ne signale la pagination périmée : ' + phrases);
});
