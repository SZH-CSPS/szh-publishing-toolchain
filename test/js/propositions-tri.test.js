// La vue « Propositions » : la colonne Score, le tri sur chaque colonne, et les deux filtres
// exclusifs (refusées, acceptées récemment) avec l'annulation d'une acceptation. Les lots sont
// synthétiques (docs/FORMAT-PROPOSITIONS.md).
//
//   node --test test/js/propositions-tri.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { revueDEssai, activerHote } = require('./hote-factice');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
const RACINE_ARBRE = kirby.racineArbre(REVUE);
const CLE_COLONNES = 'szh.propositions.colonnes';

// Les fonctions pures de la vue, lues dans le script de la page tel quel.
function fonctionsPures() {
  const ctx = { SZH: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(COCKPIT, 'media', '_propositions.js'), 'utf8'), ctx);
  assert.ok(ctx.SZH.propositionsTri, 'SZH.propositionsTri absent');
  return ctx.SZH.propositionsTri;
}
let pur = null;
const PUR = new Proxy({}, { get: (o, k) => (pur = pur || fonctionsPures())[k] });
function trier(lignes, tri, langue) {
  const v = (p, col) => (p[col] === undefined ? null : p[col]);
  return [...PUR.trier(lignes, tri, v, langue || 'fr')].map((p) => p.id);
}

// ---- Fonctions pures ------------------------------------------------------------------------

const L = [
  { id: 'a', titre: 'Zürich', score: 5.25, canton: 'ZH', etat: 1 },
  { id: 'b', titre: 'Ärzte', score: null, canton: 'BE', etat: 0 },
  { id: 'c', titre: 'Bern', score: 40, canton: null, etat: 1 },
  { id: 'd', titre: 'Ofen', score: 5.25, canton: 'GE', etat: 0 },
  { id: 'e', titre: 'Öl', score: null, canton: 'AG', etat: 1 }
];

test('tri pur : sans tri, l’ordre reçu reste exactement le même', () => {
  assert.deepStrictEqual(trier(L, null), ['a', 'b', 'c', 'd', 'e']);
  assert.deepStrictEqual(trier(L, { col: 'inconnue', sens: 1 }), ['a', 'b', 'c', 'd', 'e']);
});

test('tri pur : le score en numérique, dans les deux sens, les sans-score toujours en fin', () => {
  assert.deepStrictEqual(trier(L, { col: 'score', sens: -1 }), ['c', 'a', 'd', 'b', 'e']);
  assert.deepStrictEqual(trier(L, { col: 'score', sens: 1 }), ['a', 'd', 'c', 'b', 'e']);
});

test('tri pur : une égalité se départage par l’ordre par défaut, dans les deux sens', () => {
  // a et d ont le même score ; b et d le même état : l'ordre reçu les départage.
  assert.deepStrictEqual(trier(L, { col: 'etat', sens: 1 }), ['b', 'd', 'a', 'c', 'e']);
  assert.deepStrictEqual(trier(L, { col: 'etat', sens: -1 }), ['a', 'c', 'e', 'b', 'd']);
});

test('tri pur : le titre en allemand, Umlaut à sa place, dans les deux sens', () => {
  assert.deepStrictEqual(trier(L, { col: 'titre', sens: 1 }, 'de'), ['b', 'c', 'd', 'e', 'a']);
  assert.deepStrictEqual(trier(L, { col: 'titre', sens: -1 }, 'de'), ['a', 'e', 'd', 'c', 'b']);
});

test('tri pur : le titre en français, accents et casse ignorés, nombres dans l’ordre', () => {
  const F = [{ id: 1, titre: 'élève' }, { id: 2, titre: 'Ecole' }, { id: 3, titre: 'zèbre' }, { id: 4, titre: 'Abeille' },
    { id: 5, titre: 'école' }, { id: 6, titre: 'Objet 10' }, { id: 7, titre: 'Objet 9' }];
  assert.deepStrictEqual(trier(F, { col: 'titre', sens: 1 }), [4, 2, 5, 1, 7, 6, 3]);
  assert.deepStrictEqual(trier(F, { col: 'titre', sens: -1 }), [3, 6, 7, 1, 2, 5, 4]);
});

test('tri pur : une valeur vide (canton absent) reste en fin dans les deux sens', () => {
  assert.deepStrictEqual(trier(L, { col: 'canton', sens: 1 }), ['e', 'b', 'd', 'a', 'c']);
  assert.deepStrictEqual(trier(L, { col: 'canton', sens: -1 }), ['a', 'd', 'b', 'e', 'c']);
});

test('score : une décimale, à la virgule, en fr comme en de ; un entier sans « ,0 » ; rien pour une valeur qui n’est pas un nombre', () => {
  assert.strictEqual(PUR.formaterScore(5.25), '5,3');
  assert.strictEqual(PUR.formaterScore(5.24), '5,2');
  assert.strictEqual(PUR.formaterScore(40), '40');
  assert.strictEqual(PUR.formaterScore(39.96), '40');
  assert.strictEqual(PUR.formaterScore(0), '0');
  for (const x of [null, undefined, 'x', NaN]) { assert.strictEqual(PUR.formaterScore(x), ''); }
});

test('réglage de colonnes : l’ancien `cran` se reporte sur `score`, un tri invalide s’ignore', () => {
  const lu = (x) => JSON.parse(JSON.stringify(PUR.reglageColonnes(x)));
  assert.deepStrictEqual(lu({ largeurs: { cran: 90, titre: 300 }, masquees: ['cran', 'etat'], montrees: ['cran'] }),
    { largeurs: { score: 90, titre: 300 }, masquees: ['score', 'etat'], tri: null });
  assert.deepStrictEqual(lu({ largeurs: { cran: 90, score: 70 }, masquees: [] }),
    { largeurs: { score: 70 }, masquees: [], tri: null });
  assert.deepStrictEqual(lu({ largeurs: {}, masquees: [], tri: { col: 'score', sens: -1 } }).tri, { col: 'score', sens: -1 });
  assert.strictEqual(lu({ tri: { col: 'score', sens: 0 } }).tri, null);
  assert.strictEqual(lu({ tri: { col: 7, sens: 1 } }).tri, null);
  assert.strictEqual(lu({ tri: 'score' }).tri, null);
  assert.deepStrictEqual(lu(null), { largeurs: {}, masquees: [], tri: null });
  assert.deepStrictEqual(lu({ largeurs: 'x', masquees: 'y' }), { largeurs: {}, masquees: [], tri: null });
});

// ---- Lots d'essai -------------------------------------------------------------------------

function cle(id) { return 'parlement:source-exemple:' + id; }
function intervention(id, canton, titre, score, extra) {
  const pertinence = { verdict: 'retenu', raison: 'ancrage' };
  if (score !== undefined) { pertinence.score = score; }
  return Object.assign({
    format: 'pronto-proposition/1', cle: cle(id), moissonneur: 'parlement', type: 'intervention', langue: 'fr',
    recolte: '2026-10-02T14:12:00Z', lien_source: 'https://exemple.ch/objet/' + id,
    valeurs: { title: titre, canton: canton, categorie: 'motion', numero: 'M ' + id, date: '2026-03-04',
      lien: 'https://exemple.ch/objet/' + id, source: 'openparldata' },
    doutes: [], brut: {}, pertinence: pertinence, doublon: null
  }, extra || {});
}
function recherche(id, titre) {
  return {
    format: 'pronto-proposition/1', cle: 'recherche:source-exemple:' + id, moissonneur: 'recherche', type: 'recherche',
    langue: 'fr', recolte: '2026-10-02T14:12:00Z', lien_source: 'https://exemple.ch/r/' + id,
    valeurs: { title: titre, institutions: 'HEP Exemple', debut: '2024', fin: '2026', descriptif: 'Une étude.' },
    doutes: [], brut: {}, pertinence: { verdict: 'retenu', raison: 'x' }, doublon: null
  };
}
// Ordre de l'hôte : le cas B (VD) en tête, puis l'ordre des cantons (CH d'abord) et le titre.
const LOT = [
  intervention('GE-1', 'GE', 'Alpha genevois', 5.25),
  intervention('CH-1', 'CH', 'Zêta fédéral', 40),
  intervention('VD-1', 'VD', 'Date douteuse', 12, { doutes: [{ champ: 'date', code: 'date-illisible', detail: 'x', suggestion: '2026-03-04' }] }),
  intervention('NE-1', 'NE', 'Bêta neuchâtelois'),
  intervention('BE-1', 'BE', 'Éole bernois', 40)
];
const ORDRE_HOTE = ['VD-1', 'CH-1', 'BE-1', 'GE-1', 'NE-1'];

function ecrire(dossier, nom, contenu) {
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, nom), contenu, 'utf8');
}
function repartir() {
  fs.rmSync(pr.cheminMoissons(RACINE_ARBRE), { recursive: true, force: true });
  fs.rmSync(kirby.cheminBibliotheque(RACINE_ARBRE), { recursive: true, force: true });
  delete HOTE.memoire[CLE_COLONNES];
  ecrire(path.join(pr.cheminMoissons(RACINE_ARBRE), 'parlement'), '2026-10-01-1.jsonl', LOT.map((l) => JSON.stringify(l)).join('\n') + '\n');
  ecrire(path.join(pr.cheminMoissons(RACINE_ARBRE), 'recherche'), '2026-10-01-1.jsonl', JSON.stringify(recherche('R1', 'Une recherche')) + '\n');
}
function ausgabeId() { return yaml.idNumero(REVUE); }

async function panneau() {
  await HOTE.executer('szh.ouvrirActualite', 'propositions');
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  await p._recepteur({ type: MSG.PRET });
  return p;
}
function derniere(p, type) { return p.messages.filter((m) => m.type === type).pop(); }
async function donnees(p) {
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_CHARGER });
  return derniere(p, MSG.PROP_DONNEES);
}

function pageDocumentation() {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const page = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css', '_propositions.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js', '_propositions.js'], txt: txt
  });
  page.envoyer({
    type: MSG.CHARGER, slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: doc._libelles.typesRessourceConfig('fr'), typesRubrique: [],
    rubriques: [], ressources: [], orphelines: [], vueInitiale: { onglet: 'propositions' }
  });
  return { page: page, txt: txt };
}
async function relayer(page, p) {
  const envoyes = JSON.parse(JSON.stringify(page.messages.splice(0)));
  for (const m of envoyes) {
    if (!/^prop/.test(m.type)) { continue; }
    p.messages.length = 0;
    await p._recepteur(m);
    for (const r of p.messages) {
      if (r.type === MSG.PROP_DONNEES || r.type === MSG.CHARGER || r.type === MSG.PROP_VERIFIE) { page.envoyer(JSON.parse(JSON.stringify(r))); }
    }
  }
  return envoyes;
}
async function vueBranchee(type) {
  const p = await panneau();
  const { page, txt } = pageDocumentation();
  await relayer(page, p);
  const panel = page.parId['panel-propositions'];
  onglet(page, type || 'intervention').click();
  return { page: page, txt: txt, p: p, panel: panel };
}
function onglet(page, type) {
  const b = page.parId.barreCategories.querySelectorAll('button').find((x) => x.dataset.type === type);
  assert.ok(b, 'onglet absent : ' + type);
  return b;
}
function lignes(panel) { return panel.querySelectorAll('tr').filter((tr) => tr.dataset.cle !== undefined); }
function ids(panel) { return lignes(panel).map((tr) => tr.dataset.cle.split(':').pop()); }
function ligne(panel, id) { return lignes(panel).find((tr) => tr.dataset.cle.split(':').pop() === id); }
function th(panel, col) { return panel.querySelectorAll('th').find((x) => x.dataset.col === col); }
function trierPar(panel, col) { th(panel, col).querySelector('.prop-tri').click(); }
function cocher(tr) { const c = tr.querySelector('.prop-case'); c.checked = true; c.click(); }
function envoyes(page, type) { return JSON.parse(JSON.stringify(page.messages.filter((m) => m.type === type))); }
function r(t, v) { let x = String(t); (v || []).forEach((y, i) => { x = x.split('{' + i + '}').join(String(y)); }); return x; }

// ---- La colonne Score -----------------------------------------------------------------------

test('page : la colonne Score s’affiche pour tout type, à une décimale, « – » avec un texte lu sans score', async () => {
  repartir();
  const { page, panel, txt } = await vueBranchee();
  assert.ok(th(panel, 'score'), 'colonne Score absente');
  assert.strictEqual(panel.querySelector('th.prop-th-cran'), null, 'la colonne Cran a laissé sa place');
  const td = ligne(panel, 'GE-1').querySelector('.prop-td-score');
  assert.strictEqual(td.textContent, '5,3');
  assert.strictEqual(td.title, r(txt.propScoreTip, ['5,3']));
  const vide = ligne(panel, 'NE-1').querySelector('.prop-td-score');
  assert.strictEqual(vide.querySelector('[aria-hidden="true"]').textContent, '–');
  assert.strictEqual(vide.querySelector('.prop-masque').textContent, txt.propSansScore);
  onglet(page, 'recherche').click();
  assert.ok(th(panel, 'score'), 'la recherche a aussi la colonne Score');
  assert.strictEqual(lignes(panel)[0].querySelector('.prop-td-score .prop-masque').textContent, txt.propSansScore);
});

test('page : la colonne Score se masque par le menu Colonnes, et se mémorise', async () => {
  repartir();
  const { page, panel } = await vueBranchee();
  panel.querySelector('.prop-bouton-colonnes').click();
  const item = panel.querySelector('.prop-menu-colonnes').querySelectorAll('button').find((b) => b.dataset.col === 'score');
  assert.strictEqual(item.getAttribute('aria-checked'), 'true');
  item.click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_COLONNES).pop().reglage, { largeurs: {}, masquees: ['score'] });
  assert.strictEqual(th(panel, 'score'), undefined);
});

test('page : un ancien réglage qui nomme `cran` se lit sans erreur et se reporte sur Score', async () => {
  repartir();
  HOTE.memoire[CLE_COLONNES] = { intervention: { largeurs: { cran: 120 }, masquees: ['cran'], montrees: ['cran'] } };
  const { page, panel } = await vueBranchee();
  assert.strictEqual(th(panel, 'score'), undefined, 'masquée sous son ancien nom, elle le reste');
  panel.querySelector('.prop-bouton-colonnes').click();
  panel.querySelector('.prop-menu-colonnes').querySelectorAll('button').find((b) => b.dataset.col === 'score').click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_COLONNES).pop().reglage, { largeurs: { score: 120 }, masquees: [] });
  assert.ok(th(panel, 'score'));
});

// ---- Le tri ---------------------------------------------------------------------------------

test('page : sans tri mémorisé, l’ordre de l’hôte, et aucun aria-sort', async () => {
  repartir();
  const { panel } = await vueBranchee();
  assert.deepStrictEqual(ids(panel), ORDRE_HOTE);
  assert.strictEqual(panel.querySelectorAll('th').filter((x) => x.getAttribute('aria-sort')).length, 0);
});

test('page : chaque colonne hors case et gestes se trie par un bouton dans son en-tête, à côté de la poignée', async () => {
  repartir();
  const { panel } = await vueBranchee();
  const cols = panel.querySelectorAll('th').map((x) => x.dataset.col);
  assert.deepStrictEqual(cols, ['case', 'etat', 'titre', 'champ:canton', 'champ:categorie', 'score', 'pertinence', 'gestes']);
  for (const c of cols) {
    const b = th(panel, c).querySelector('.prop-tri');
    if (c === 'case' || c === 'gestes') { assert.strictEqual(b, null, c); continue; }
    assert.ok(b, 'bouton de tri absent : ' + c);
    assert.strictEqual(b.tagName, 'BUTTON');
    assert.strictEqual(b.type, 'button');
    const poignee = th(panel, c).querySelector('.prop-poignee');
    assert.ok(poignee, 'poignée absente : ' + c);
    assert.strictEqual(b.querySelector('.prop-poignee'), null, 'la poignée ne doit pas être dans le bouton');
  }
});

test('page : Score décroissant puis croissant, les sans-score en fin ; un troisième clic rend l’ordre par défaut', async () => {
  repartir();
  const { page, panel } = await vueBranchee();
  trierPar(panel, 'score');
  assert.deepStrictEqual(ids(panel), ['CH-1', 'BE-1', 'VD-1', 'GE-1', 'NE-1']);
  assert.strictEqual(th(panel, 'score').getAttribute('aria-sort'), 'descending');
  assert.strictEqual(th(panel, 'score').querySelector('.prop-tri-sens').textContent.trim(), '▼');
  assert.strictEqual(th(panel, 'score').querySelector('.prop-tri-sens').getAttribute('aria-hidden'), 'true');
  assert.deepStrictEqual(envoyes(page, MSG.PROP_COLONNES).pop().reglage, { largeurs: {}, masquees: [], tri: { col: 'score', sens: -1 } });
  trierPar(panel, 'score');
  assert.deepStrictEqual(ids(panel), ['GE-1', 'VD-1', 'CH-1', 'BE-1', 'NE-1']);
  assert.strictEqual(th(panel, 'score').getAttribute('aria-sort'), 'ascending');
  assert.strictEqual(th(panel, 'score').querySelector('.prop-tri-sens').textContent.trim(), '▲');
  trierPar(panel, 'score');
  assert.deepStrictEqual(ids(panel), ORDRE_HOTE);
  assert.strictEqual(th(panel, 'score').getAttribute('aria-sort'), null);
  assert.strictEqual(envoyes(page, MSG.PROP_COLONNES).pop().reglage, null);
});

test('page : chaque colonne se trie dans les deux sens (état, titre, canton, type, pertinence)', async () => {
  repartir();
  const { panel } = await vueBranchee();
  const attendu = {
    etat: [ORDRE_HOTE, ['CH-1', 'BE-1', 'GE-1', 'NE-1', 'VD-1']],
    titre: [['GE-1', 'NE-1', 'VD-1', 'BE-1', 'CH-1'], ['CH-1', 'BE-1', 'VD-1', 'NE-1', 'GE-1']],
    'champ:canton': [['BE-1', 'CH-1', 'GE-1', 'NE-1', 'VD-1'], ['VD-1', 'NE-1', 'GE-1', 'CH-1', 'BE-1']],
    'champ:categorie': [ORDRE_HOTE, ORDRE_HOTE],
    pertinence: [ORDRE_HOTE, ORDRE_HOTE]
  };
  for (const col of Object.keys(attendu)) {
    trierPar(panel, col);
    assert.deepStrictEqual(ids(panel), attendu[col][0], col + ' croissant');
    assert.strictEqual(th(panel, col).getAttribute('aria-sort'), 'ascending', col);
    trierPar(panel, col);
    assert.deepStrictEqual(ids(panel), attendu[col][1], col + ' décroissant');
    assert.strictEqual(th(panel, col).getAttribute('aria-sort'), 'descending', col);
    assert.strictEqual(panel.querySelectorAll('th').filter((x) => x.getAttribute('aria-sort')).length, 1, 'un seul aria-sort');
  }
});

test('page : le tri mémorisé du poste se relit au chargement', async () => {
  repartir();
  HOTE.memoire[CLE_COLONNES] = { intervention: { largeurs: {}, masquees: [], tri: { col: 'titre', sens: -1 } } };
  const { panel } = await vueBranchee();
  assert.deepStrictEqual(ids(panel), ['CH-1', 'BE-1', 'VD-1', 'NE-1', 'GE-1']);
  assert.strictEqual(th(panel, 'titre').getAttribute('aria-sort'), 'descending');
});

test('page : cases cochées, détail ouvert et focus survivent à un tri ; Entrée sur le bouton ne fait rien d’autre', async () => {
  repartir();
  const { panel } = await vueBranchee();
  cocher(ligne(panel, 'GE-1'));
  ligne(panel, 'CH-1').querySelector('.prop-titre').click();
  assert.ok(panel.querySelector('.prop-detail'), 'le détail devait s’ouvrir');
  trierPar(panel, 'score');
  assert.strictEqual(ligne(panel, 'GE-1').querySelector('.prop-case').checked, true);
  assert.strictEqual(panel.querySelector('.prop-detail .szh-tete-nom').textContent, 'Zêta fédéral');
  assert.ok(th(panel, 'score').querySelector('.prop-tri')._focused, 'le focus reste sur le bouton de tri');
  const ev = { type: 'keydown', key: 'Enter', bubbles: true, defaultPrevented: false };
  ev.preventDefault = () => { ev.defaultPrevented = true; };
  th(panel, 'score').querySelector('.prop-tri').dispatchEvent(ev);
  assert.strictEqual(ev.defaultPrevented, false, 'Entrée doit rester au bouton');
  assert.strictEqual(panel.querySelector('.prop-detail .szh-tete-nom').textContent, 'Zêta fédéral');
});

// ---- Les filtres exclusifs, et l'annulation d'une acceptation ------------------------------

function filtre(panel, nom) { return panel.querySelector('.prop-filtre-' + nom); }

test('page : « refusées » et « acceptées récemment » sont deux filtres exclusifs, et « Tout afficher » ramène à la vue normale', async () => {
  repartir();
  pr.refuser(RACINE_ARBRE, LOT[3]);
  pr.accepter(RACINE_ARBRE, LOT[0], LOT[0].valeurs, {});
  const { panel, txt } = await vueBranchee();
  assert.deepStrictEqual(ids(panel), ['VD-1', 'CH-1', 'BE-1']);
  const ref = filtre(panel, 'refusees'), acc = filtre(panel, 'acceptees');
  assert.strictEqual(ref.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(acc.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(acc.textContent, r(txt.propAfficherAcceptees, [pr.JOURS_ACCEPTEES]));
  assert.ok(acc.textContent.indexOf('30') !== -1, 'le libellé dit la borne');
  assert.strictEqual(panel.querySelector('.prop-tout-afficher'), null);
  ref.click();
  assert.deepStrictEqual(ids(panel), ['NE-1'], 'les refusées seules');
  assert.strictEqual(filtre(panel, 'refusees').getAttribute('aria-pressed'), 'true');
  filtre(panel, 'acceptees').click();
  assert.deepStrictEqual(ids(panel), ['GE-1'], 'les acceptées seules');
  assert.strictEqual(filtre(panel, 'refusees').getAttribute('aria-pressed'), 'false');
  assert.strictEqual(filtre(panel, 'acceptees').getAttribute('aria-pressed'), 'true');
  filtre(panel, 'acceptees').click();
  assert.deepStrictEqual(ids(panel), ['VD-1', 'CH-1', 'BE-1'], 'un second clic retire le filtre');
  filtre(panel, 'refusees').click();
  panel.querySelector('.prop-tout-afficher').click();
  assert.deepStrictEqual(ids(panel), ['VD-1', 'CH-1', 'BE-1']);
  assert.strictEqual(filtre(panel, 'refusees').getAttribute('aria-pressed'), 'false');
  assert.strictEqual(panel.querySelector('.prop-tout-afficher'), null);
});

test('page : un filtre de décision vide la sélection ; le tri vaut aussi dans ses lignes', async () => {
  repartir();
  for (const x of [LOT[0], LOT[1], LOT[4]]) { pr.accepter(RACINE_ARBRE, x, x.valeurs, {}); }
  const { panel } = await vueBranchee();
  cocher(ligne(panel, 'VD-1'));
  assert.ok(panel.querySelector('.prop-selbar'), 'la case devait être cochée');
  filtre(panel, 'acceptees').click();
  assert.strictEqual(panel.querySelector('.prop-selbar'), null, 'pas de geste en lot sur des lignes qu’on ne voit pas');
  trierPar(panel, 'titre');
  assert.deepStrictEqual(ids(panel), ['GE-1', 'BE-1', 'CH-1']);
  panel.querySelector('.prop-tout-afficher').click();
  assert.strictEqual(ligne(panel, 'VD-1').querySelector('.prop-case').checked, false);
});

// Les dates des décisions, posées à la main : la plus récente en tête.
// Le jour, n jours avant aujourd'hui (UTC), au format des décisions.
function ilYa(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function dater(cleP, date, mtime) {
  const f = pr.cheminDecision(RACINE_ARBRE, cleP);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^Date: .*$/m, 'Date: ' + date));
  if (mtime) { fs.utimesSync(f, mtime, mtime); }
}

test('hôte : les acceptées récentes de la langue, la plus récente en tête, avec ce qui en empêche l’annulation', async () => {
  repartir();
  pr.accepter(RACINE_ARBRE, LOT[0], LOT[0].valeurs, {});
  pr.accepter(RACINE_ARBRE, LOT[1], LOT[1].valeurs, { ausgabeId: ausgabeId() });
  pr.accepter(RACINE_ARBRE, LOT[4], LOT[4].valeurs, {});
  pr.refuser(RACINE_ARBRE, LOT[3]);
  dater(cle('GE-1'), ilYa(20));
  dater(cle('CH-1'), ilYa(1), new Date(Date.now() - 3600000));
  dater(cle('BE-1'), ilYa(1), new Date(Date.now() - 60000));
  const d = await donnees(await panneau());
  assert.deepStrictEqual(d.acceptees.map((x) => x.cle), [cle('BE-1'), cle('CH-1'), cle('GE-1')]);
  assert.deepStrictEqual(d.acceptees.map((x) => x.acceptee.date), [ilYa(1), ilYa(1), ilYa(20)]);
  assert.strictEqual(d.joursAcceptees, pr.JOURS_ACCEPTEES);
  assert.deepStrictEqual(d.acceptees.map((x) => x.garde), ['', 'dans-numero', '']);
  assert.ok(!d.propositions.some((x) => x.cle === cle('GE-1')));
});

test('page : une acceptée sans numéro s’annule d’un clic, sa fiche part et elle revient en attente', async () => {
  repartir();
  const a = pr.accepter(RACINE_ARBRE, LOT[0], LOT[0].valeurs, {});
  const { page, panel, p, txt } = await vueBranchee();
  filtre(panel, 'acceptees').click();
  const b = ligne(panel, 'GE-1').querySelector('.prop-bouton-annuler-acceptation');
  assert.ok(b, 'bouton d’annulation absent');
  assert.strictEqual(b.getAttribute('aria-disabled'), null);
  assert.ok(ligne(panel, 'GE-1').querySelector('.prop-etat').textContent.indexOf(r(txt.propAcceptee, ['']).trim()) === 0);
  b.click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_ANNULER).pop().cles, [cle('GE-1')]);
  await relayer(page, p);
  assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('GE-1')), null);
  assert.strictEqual(kirby.lireFicheSlugLangue(RACINE_ARBRE, a.slug, 'fr', 'intervention'), null);
  panel.querySelector('.prop-tout-afficher').click();
  assert.ok(ligne(panel, 'GE-1'), 'de nouveau en attente');
});

test('page : une acceptée dans un numéro, ou publiée, garde son bouton désactivé avec sa raison lue', async () => {
  repartir();
  pr.accepter(RACINE_ARBRE, LOT[1], LOT[1].valeurs, { ausgabeId: ausgabeId() });
  const { page, panel, txt } = await vueBranchee();
  filtre(panel, 'acceptees').click();
  const b = ligne(panel, 'CH-1').querySelector('.prop-bouton-annuler-acceptation');
  assert.ok(b, 'le bouton ne disparait pas');
  assert.strictEqual(b.getAttribute('aria-disabled'), 'true');
  const id = b.getAttribute('aria-describedby');
  assert.ok(id, 'aria-describedby absent');
  const raison = panel.querySelectorAll('.prop-garde-raison').find((x) => x.id === id);
  assert.ok(raison, 'la raison n’est pas dans la page');
  assert.strictEqual(raison.textContent, txt.propGardeDansNumero);
  page.messages.length = 0;
  b.click();
  assert.strictEqual(envoyes(page, MSG.PROP_ANNULER).length, 0);
});

// ---- La garde, côté hôte et côté bibliothèque ----------------------------------------------

test('hôte : PROP_ANNULER refuse une acceptation dans un numéro, sauf le geste qu’on vient de faire', async () => {
  repartir();
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('CH-1') }] });
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: false, demandes: [{ cle: cle('GE-1') }] });
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_ANNULER, cles: [cle('CH-1')] });
  const d = derniere(p, MSG.PROP_DONNEES);
  assert.deepStrictEqual(d.resultat.faites, []);
  assert.deepStrictEqual(d.resultat.echecs, [{ cle: cle('CH-1'), raison: 'dans-numero' }]);
  assert.ok(pr.lireDecision(RACINE_ARBRE, cle('CH-1')), 'la décision reste');
  // Le geste qu'on vient de faire se défait toujours (le bandeau « Annuler »).
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('BE-1') }] });
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_ANNULER, cles: [cle('BE-1')] });
  assert.deepStrictEqual(derniere(p, MSG.PROP_DONNEES).resultat.faites, [cle('BE-1')]);
});

function bibliotheque() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-prop-tri-'));
  const numero = path.join(racine, 'Revue', '2026-01');
  fs.mkdirSync(numero, { recursive: true });
  fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'title: Numéro\nrevue: revue\nlang: fr\n', 'utf8');
  const archive = path.join(racine, '_Archive', 'Revue', '2025-04');
  fs.mkdirSync(archive, { recursive: true });
  fs.writeFileSync(path.join(archive, 'ausgabe.yaml'), 'title: Ancien\nrevue: revue\nlang: fr\n', 'utf8');
  return { racine: racine, idRevue: yaml.assurerIdNumero(numero), idArchive: yaml.assurerIdNumero(archive) };
}
function lot(racine, lignesLot) {
  const dossier = path.join(pr.cheminMoissons(racine), 'essai');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, '2026-10-02-1.jsonl'), lignesLot.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
function federale(id) {
  return intervention(id, 'CH', 'x', 30, { moissonneur: 'essai', langue: undefined, langues: ['fr', 'de'],
    titres: { fr: 'Motion fédérale ' + id, de: 'Bundesmotion ' + id } });
}

test('bibliothèque : la garde refuse « dans-numero » et « publiee », la décision et la fiche restent', () => {
  const { racine, idRevue, idArchive } = bibliotheque();
  try {
    const a = LOT[0], b = LOT[1], c = LOT[4];
    lot(racine, [a, b, c]);
    pr.accepter(racine, a, a.valeurs, { ausgabeId: idRevue });
    const rb = pr.accepter(racine, b, b.valeurs, {});
    kirby.tirerDansNumero(racine, rb.slug, 'fr', idArchive);
    pr.accepter(racine, c, c.valeurs, {});
    assert.strictEqual(pr.gardeAnnulation(racine, a.cle, 'fr'), 'dans-numero');
    assert.strictEqual(pr.gardeAnnulation(racine, b.cle, 'fr'), 'publiee');
    assert.strictEqual(pr.gardeAnnulation(racine, c.cle, 'fr'), '');
    const res = pr.annulerLot(racine, [a.cle, b.cle, c.cle], 'fr', { garde: true });
    assert.deepStrictEqual(res.faites, [c.cle]);
    assert.deepStrictEqual(res.echecs, [{ cle: a.cle, raison: 'dans-numero' }, { cle: b.cle, raison: 'publiee' }]);
    assert.ok(pr.lireDecision(racine, a.cle) && pr.lireDecision(racine, b.cle));
    assert.strictEqual(kirby.listerSlugsBibliotheque(racine).length, 2);
    // Sans garde, le chemin d'avant reste le même.
    assert.deepStrictEqual(pr.annulerLot(racine, [a.cle], 'fr').faites, [a.cle]);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliothèque : une acceptation multilingue, deux fichiers au même Uuid, s’annule par la garde et retire les deux', () => {
  const { racine, idRevue } = bibliotheque();
  try {
    const p = federale('M1');
    lot(racine, [p]);
    pr.accepterLot(racine, 'fr', [{ cle: p.cle }], {});
    const slug = kirby.listerSlugsBibliotheque(racine)[0].slug;
    const uuid = pr.lireDecision(racine, p.cle).fiche;
    const dossier = kirby.cheminFiche(racine, 'intervention', slug);
    fs.writeFileSync(path.join(dossier, kirby.nomFichierContenu('intervention', 'de')),
      'Title: Bundesmotion M1\n\n----\n\nUuid: ' + uuid + '\n');
    assert.strictEqual(pr.listerAcceptees(racine, 'de').length, 1, 'visible des deux rédactions');
    assert.strictEqual(pr.gardeAnnulation(racine, p.cle, 'fr'), '');
    const res = pr.annulerLot(racine, [p.cle], 'fr', { garde: true });
    assert.deepStrictEqual(res.faites, [p.cle]);
    assert.deepStrictEqual(kirby.listerSlugsBibliotheque(racine), []);
    // Le fichier de la vue dans un numéro : refusé, les deux fichiers restent.
    pr.accepterLot(racine, 'fr', [{ cle: p.cle }], { ausgabeId: idRevue });
    const slug2 = kirby.listerSlugsBibliotheque(racine)[0].slug;
    const uuid2 = pr.lireDecision(racine, p.cle).fiche;
    fs.writeFileSync(path.join(kirby.cheminFiche(racine, 'intervention', slug2), kirby.nomFichierContenu('intervention', 'de')),
      'Title: Bundesmotion M1\n\n----\n\nUuid: ' + uuid2 + '\n');
    assert.deepStrictEqual(pr.annulerLot(racine, [p.cle], 'fr', { garde: true }).echecs, [{ cle: p.cle, raison: 'dans-numero' }]);
    assert.ok(kirby.lireFicheSlugLangue(racine, slug2, 'fr', 'intervention'));
    assert.ok(kirby.lireFicheSlugLangue(racine, slug2, 'de', 'intervention'));
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliothèque : listerAcceptees ne rend que la langue, la plus récente en tête, et la garde de chacune', () => {
  const { racine, idRevue } = bibliotheque();
  try {
    const de = intervention('ZH-1', 'ZH', 'Ein Vorstoss', 3, { langue: 'de', moissonneur: 'essai' });
    lot(racine, [LOT[0], LOT[1], LOT[4], de]);
    pr.accepter(racine, LOT[0], LOT[0].valeurs, {});
    pr.accepter(racine, LOT[1], LOT[1].valeurs, { ausgabeId: idRevue });
    pr.accepter(racine, LOT[4], LOT[4].valeurs, {});
    pr.accepter(racine, de, de.valeurs, {});
    const dater2 = (c, date) => {
      const f = pr.cheminDecision(racine, c);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^Date: .*$/m, 'Date: ' + date));
    };
    dater2(LOT[0].cle, '2026-09-10');
    dater2(LOT[1].cle, '2026-10-01');
    dater2(LOT[4].cle, '2026-09-20');
    dater2(de.cle, '2026-10-01');
    const le = new Date('2026-10-04T12:00:00Z');
    const l = pr.listerAcceptees(racine, 'fr', le);
    assert.deepStrictEqual(l.map((x) => x.cle), [LOT[1].cle, LOT[4].cle, LOT[0].cle]);
    assert.deepStrictEqual(l.map((x) => x.garde), ['dans-numero', '', '']);
    assert.deepStrictEqual(pr.listerAcceptees(racine, 'de', le).map((x) => x.cle), [de.cle]);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliothèque : « récemment » vaut 30 jours : J-29 et J-30 listées, J-31 non, à une date donnée', () => {
  const { racine } = bibliotheque();
  try {
    assert.strictEqual(pr.JOURS_ACCEPTEES, 30);
    const [a, b, c] = [LOT[0], LOT[1], LOT[4]];
    lot(racine, [a, b, c]);
    for (const x of [a, b, c]) { pr.accepter(racine, x, x.valeurs, {}); }
    const poser = (x, date) => {
      const f = pr.cheminDecision(racine, x.cle);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^Date: .*$/m, 'Date: ' + date));
    };
    poser(a, '2026-09-05');   // J-29
    poser(b, '2026-09-04');   // J-30
    poser(c, '2026-09-03');   // J-31
    const le = new Date('2026-10-04T08:00:00Z');
    assert.deepStrictEqual(pr.listerAcceptees(racine, 'fr', le).map((x) => x.cle), [a.cle, b.cle]);
    // La même bibliothèque, un jour plus tard : J-30 sort à son tour.
    assert.deepStrictEqual(pr.listerAcceptees(racine, 'fr', new Date('2026-10-05T08:00:00Z')).map((x) => x.cle), [a.cle]);
    // Hors borne, la décision reste : elle n'est que hors de la liste.
    assert.ok(pr.lireDecision(racine, c.cle));
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

// La raison d'une garde est le seul texte qui explique un bouton désactivé, au plus petit corps :
// elle prend l'encre principale (Lc 80,9 en Light+ contre 75,7). L'état « Acceptée » reste en
// encre secondaire, comme « refusée ».
test('contraste : la raison d’une garde en --encre, l’état « Acceptée » en --encre-2, jetons que cockpit-contraste mesure', () => {
  const css = fs.readFileSync(path.join(COCKPIT, 'media', '_propositions.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [sel, jeton] of [['.prop-garde-raison', 'var(--encre)'], ['.prop-etat--acceptee', 'var(--encre-2)']]) {
    const blocs = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').some((x) => x.trim() === sel));
    assert.ok(blocs.length > 0, 'règle absente : ' + sel);
    const couleurs = blocs.map((m) => (/(?:^|;)\s*color\s*:\s*([^;]+)/.exec(m[2]) || [])[1]).filter(Boolean).map((x) => x.trim());
    assert.deepStrictEqual(couleurs, [jeton], sel + ' : sa couleur doit rester le jeton mesuré');
    assert.ok(!blocs.some((m) => /opacity/.test(m[2])), sel + ' : une opacité défait la mesure du jeton');
  }
});

test('libellés : les clés du tri et des filtres existent en fr et en de, avec « Treffer », jamais « Vorschlag »', () => {
  const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  const cles = ['doc.prop.col.score', 'doc.prop.sansScore', 'doc.prop.score.tip', 'doc.prop.trier.tip',
    'doc.prop.afficherAcceptees', 'doc.prop.toutAfficher', 'doc.prop.filtres', 'doc.prop.acceptee',
    'doc.prop.annulerAcceptation', 'doc.prop.annulerAcceptation.tip', 'doc.prop.garde.dansNumero',
    'doc.prop.garde.publiee', 'doc.prop.b.acceptationAnnulee', 'doc.prop.aucuneRefusee', 'doc.prop.aucuneAcceptee'];
  const fr = {}, de = {};
  for (const c of cles) { fr[c] = T(c); }
  process.env.SZH_LANGUE = 'de';
  try { for (const c of cles) { de[c] = T(c); } } finally { delete process.env.SZH_LANGUE; }
  for (const c of cles) {
    assert.ok(fr[c] && fr[c] !== c, 'fr absent : ' + c);
    assert.ok(de[c] && de[c] !== c && de[c] !== fr[c], 'de absent ou identique : ' + c);
    assert.ok(!/Vorschlag/.test(de[c]), 'Vorschlag dans ' + c);
  }
  assert.ok(/Treffer/.test(de['doc.prop.aucuneAcceptee']) && /Treffer/.test(de['doc.prop.b.acceptationAnnulee']));
});
