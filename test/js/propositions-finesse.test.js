// La finesse du tri dans la vue « Propositions » : l'hôte (crans, aperçu du poste, réglage
// partagé), l'arbre qui suit ce que la personne voit, et la page (curseur, masquées, colonne
// Cran, « Pourquoi »). Les lots et les crans sont synthétiques (docs/FORMAT-PROPOSITIONS.md).
//
//   node --test test/js/propositions-finesse.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
const RACINE_ARBRE = kirby.racineArbre(REVUE);
const CLE_APERCU = 'szh.propositions.finesse';

// ---- Données d'essai ------------------------------------------------------------------------

// Dix seuils aux déciles ; le cran 5 est identique au cran 4.
const SEUILS = [0, 5, 9, 12, 12, 18, 29, 38, 56, 78];
function crans() {
  return SEUILS.map((s, i) => ({
    cran: i + 1, seuil: s, par_mois: 81 - i * 8, rappel: i === 9 ? null : 73 - i * 6, rappel_sur: 79,
    identique_au_cran_precedent: i > 0 && SEUILS[i - 1] === s
  }));
}
function proposition(type, id, valeurs, extra) {
  return Object.assign({
    format: 'pronto-proposition/1', cle: 'parlement:source-exemple:' + id, moissonneur: 'parlement',
    type: type, langue: 'fr', recolte: '2026-10-02T14:12:00Z',
    lien_source: 'https://parlement.exemple.ch/objet/' + id, valeurs: valeurs, doutes: [], brut: {},
    pertinence: { verdict: 'retenu', raison: 'ancrage' }, doublon: null
  }, extra || {});
}
function intervention(id, titre, score, extra) {
  return proposition('intervention', id, {
    title: titre, canton: 'GE', categorie: 'motion', numero: 'M ' + id, date: '2026-03-04',
    lien: 'https://parlement.exemple.ch/objet/' + id, source: 'openparldata'
  }, Object.assign({
    pertinence: {
      verdict: 'retenu', raison: 'ancrage', score: score, categorie: 'signal-faible',
      termes: [
        { terme: 'aménagement', langue: 'fr', role: 'ambigu', ou: 'titre', note_sans: 4 },
        { terme: 'Nachteilsausgleich', langue: 'de', role: 'ancrage', ou: 'extrait', note_sans: 10 },
        { terme: 'élèves', langue: 'fr', role: 'ecole', ou: 'texte', note_sans: 20 }
      ]
    }
  }, extra || {}));
}
function recherche(id, titre) {
  return proposition('recherche', id, { title: titre, institutions: 'HEP Exemple', debut: '2024', fin: '2026', descriptif: 'Une étude.' },
    { moissonneur: 'recherche', cle: 'recherche:source-exemple:' + id });
}
function cle(id) { return 'parlement:source-exemple:' + id; }
// Scores : visibles jusqu'au cran 1, 2, 5, 6, 7, 10 ; une sans score ; une en doute.
const LOT = [
  intervention('A', 'Alpha', 2), intervention('B', 'Bêta', 6), intervention('C', 'Gamma', 12),
  intervention('D', 'Delta', 20), intervention('E', 'Epsilon', 30), intervention('F', 'Zêta', 90),
  intervention('G', 'Êta sans note', undefined),
  intervention('H', 'Thêta douteuse', 40, { doutes: [{ champ: 'date', code: 'date-illisible', detail: 'x' }] })
];

function ecrire(dossier, nom, contenu) {
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, nom), contenu, 'utf8');
}
function ecrireEtat(moissonneur, extra) {
  ecrire(path.join(pr.cheminMoissons(RACINE_ARBRE), moissonneur), 'etat.json', JSON.stringify(Object.assign({
    format: 'pronto-etat/1', moissonneur: moissonneur, contrat: 1, derniere_moisson: '2026-10-01T05:12:00Z',
    duree_s: 42, requetes: 10, propositions_ecrites: 8, lot: '', sources_en_echec: [], interrompu: null
  }, extra || {})));
}
function repartir(options) {
  const o = options || {};
  fs.rmSync(pr.cheminMoissons(RACINE_ARBRE), { recursive: true, force: true });
  delete HOTE.memoire[CLE_APERCU];
  delete HOTE.memoire['szh.propositions.colonnes'];
  ecrire(path.join(pr.cheminMoissons(RACINE_ARBRE), 'parlement'), '2026-10-01-1.jsonl', LOT.map((l) => JSON.stringify(l)).join('\n') + '\n');
  ecrire(path.join(pr.cheminMoissons(RACINE_ARBRE), 'recherche'), '2026-10-01-1.jsonl', JSON.stringify(recherche('R1', 'Une recherche')) + '\n');
  ecrireEtat('parlement', o.sansCrans ? {} : {
    crans: { fr: o.sansReference ? crans().map((c) => Object.assign(c, { rappel: 0, rappel_sur: 0 })) : crans(), de: crans() },
    crans_calcules_le: '2026-10-01',
    crans_source: { fr: 'langue', de: 'commun' }, crans_fenetre: { du: '2026-04-01', au: '2026-09-30' },
    ...(o.calibree ? { note_calibree: true } : {})
  });
  ecrireEtat('recherche', { propositions_ecrites: 1 });
  if (o.reglage) { pr.ecrireReglage(RACINE_ARBRE, 'fr', 'parlement', 'intervention', o.reglage, 'Claire Exemple'); }
}

async function entreeArbre() {
  const sections = await HOTE.arbre().getChildren();
  const s = sections.find((it) => it.contextValue === 'section-actualite');
  const enfants = await HOTE.arbre().getChildren(s);
  return enfants.find((it) => it.id === 'actualite:propositions');
}
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

// ---- L'hôte ---------------------------------------------------------------------------------

test('hôte : PROP_DONNEES porte les crans du type, la note de chaque proposition, le réglage et l’aperçu', async () => {
  repartir({ reglage: 6 });
  const d = await donnees(await panneau());
  const f = d.finesse.intervention;
  assert.ok(f, 'pas de finesse pour les interventions');
  assert.strictEqual(f.crans.length, 10);
  assert.strictEqual(f.crans[4].identique_au_cran_precedent, true);
  assert.strictEqual(f.source, 'langue');
  assert.strictEqual(f.calculeLe, '2026-10-01');
  assert.deepStrictEqual(f.fenetre, { du: '2026-04-01', au: '2026-09-30' });
  assert.strictEqual(f.reglage.cran, 6);
  assert.strictEqual(f.reglage.par, 'Claire Exemple');
  assert.strictEqual(f.apercu, null);
  assert.strictEqual(d.finesse.recherche, undefined, 'un type sans crans n’a pas de finesse');
  const max = {};
  d.propositions.forEach((p) => { max[p.cle] = p.cranMax; });
  assert.deepStrictEqual([max[cle('A')], max[cle('B')], max[cle('C')], max[cle('D')], max[cle('E')], max[cle('F')], max[cle('G')]],
    [1, 2, 5, 6, 7, 10, 10]);
  assert.strictEqual(d.propositions.find((p) => p.cle === cle('A')).pertinence.score, 2);
  assert.strictEqual(d.revue, 'Revue');
});

test('hôte : l’aperçu se range dans le globalState du poste, par langue et par type ; égal au partagé, il s’efface', async () => {
  repartir({ reglage: 6 });
  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_FINESSE_APERCU, typeFiche: 'intervention', cran: 9 });
  assert.deepStrictEqual(HOTE.memoire[CLE_APERCU], { fr: { intervention: 9 } });
  assert.strictEqual(derniere(p, MSG.PROP_DONNEES).finesse.intervention.apercu, 9);
  assert.strictEqual(pr.lireReglages(RACINE_ARBRE, 'fr').parlement.intervention.cran, 6, 'l’aperçu n’écrit rien de partagé');
  await p._recepteur({ type: MSG.PROP_FINESSE_APERCU, typeFiche: 'intervention', cran: 6 });
  assert.deepStrictEqual(HOTE.memoire[CLE_APERCU], { fr: {} });
  // Valeurs refusées : hors bornes, type inconnu.
  await p._recepteur({ type: MSG.PROP_FINESSE_APERCU, typeFiche: 'intervention', cran: 11 });
  await p._recepteur({ type: MSG.PROP_FINESSE_APERCU, typeFiche: 'inconnu', cran: 3 });
  assert.deepStrictEqual(HOTE.memoire[CLE_APERCU], { fr: {} });
});

test('hôte : « Garder » écrit le réglage partagé au nom du poste et efface l’aperçu ; Annuler rétablit les deux', async () => {
  repartir({ reglage: 6 });
  HOTE.configuration['szh.nomUtilisateur'] = 'Poste Essai';
  require(path.join(COCKPIT, 'lib', 'coedition-hote.js')).oublierIdentiteCoedition();
  try {
    const p = await panneau();
    await p._recepteur({ type: MSG.PROP_FINESSE_APERCU, typeFiche: 'intervention', cran: 8 });
    p.messages.length = 0;
    await p._recepteur({ type: MSG.PROP_FINESSE_GARDER, typeFiche: 'intervention' });
    const r = pr.lireReglages(RACINE_ARBRE, 'fr').parlement.intervention;
    assert.strictEqual(r.cran, 8);
    assert.strictEqual(r.par, 'Poste Essai');
    assert.deepStrictEqual(HOTE.memoire[CLE_APERCU], { fr: {} });
    const d = derniere(p, MSG.PROP_DONNEES);
    assert.deepStrictEqual(d.finesseGeste, { geste: 'garde', typeFiche: 'intervention', cran: 8 });
    assert.strictEqual(d.finesse.intervention.apercu, null);
    await p._recepteur({ type: MSG.PROP_FINESSE_ANNULER, typeFiche: 'intervention' });
    const avant = pr.lireReglages(RACINE_ARBRE, 'fr').parlement.intervention;
    assert.strictEqual(avant.cran, 6);
    assert.strictEqual(avant.par, 'Claire Exemple', 'le réglage d’avant revient tel quel');
    assert.deepStrictEqual(HOTE.memoire[CLE_APERCU], { fr: { intervention: 8 } });
  } finally {
    delete HOTE.configuration['szh.nomUtilisateur'];
    require(path.join(COCKPIT, 'lib', 'coedition-hote.js')).oublierIdentiteCoedition();
  }
});

// ---- L'arbre --------------------------------------------------------------------------------

test('arbre : le compte suit l’aperçu s’il existe, sinon le réglage partagé ; l’infobulle dit les masquées', async () => {
  repartir();
  let e = await entreeArbre();
  assert.strictEqual(e.description, '(9)', 'sans réglage : cran 1, tout visible');
  assert.strictEqual(e.tooltip, T('arbre.actualite.propositions.tip.plus', [9, 1]));
  pr.ecrireReglage(RACINE_ARBRE, 'fr', 'parlement', 'intervention', 6, 'A');
  e = await entreeArbre();
  assert.strictEqual(e.description, '(6)', 'cran 6 : D, E, F, G, H et la recherche');
  assert.strictEqual(e.tooltip, T('arbre.actualite.propositions.tip.plus', [6, 1]) + ' · '
    + T('arbre.actualite.propositions.masquees.plus', [3]));
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_FINESSE_APERCU, typeFiche: 'intervention', cran: 10 });
  e = await entreeArbre();
  assert.strictEqual(e.description, '(3)', 'l’aperçu du poste : F, G et la recherche');
  // Le cran le plus strict masque aussi le cas B : l'icône d'avertissement tombe.
  assert.notStrictEqual(e.iconPath.id, 'warning');
});

// ---- La page --------------------------------------------------------------------------------

function pageDocumentation(txtSup) {
  const txt = Object.assign(libellesHote(RACINE, ['textesDocumentation']), txtSup || {});
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
      if (r.type === MSG.PROP_DONNEES || r.type === MSG.PROP_VERIFIE) { page.envoyer(JSON.parse(JSON.stringify(r))); }
    }
  }
  return envoyes;
}
async function vueBranchee() {
  const p = await panneau();
  const { page, txt } = pageDocumentation();
  await relayer(page, p);
  const panel = page.parId['panel-propositions'];
  onglet(page, 'intervention').click();
  return { page: page, txt: txt, p: p, panel: panel };
}
function onglet(page, type) {
  return page.parId.barreCategories.querySelectorAll('button').find((x) => x.dataset.type === type);
}
function lignes(panel) { return panel.querySelectorAll('tr').filter((tr) => tr.dataset.cle !== undefined); }
function titres(panel) { return lignes(panel).map((tr) => tr.querySelector('.prop-titre').textContent); }
function copie(x) { return JSON.parse(JSON.stringify(x)); }
function r(t, v) { let x = String(t); (v || []).forEach((y, i) => { x = x.split('{' + i + '}').join(String(y)); }); return x; }

test('page : le curseur tient sur une ligne, au cran du réglage partagé ; les lignes, l’onglet et la pastille suivent', async () => {
  repartir({ reglage: 6 });
  const { page, panel, txt } = await vueBranchee();
  const c = panel.querySelector('.prop-finesse-curseur');
  assert.ok(c, 'curseur absent');
  assert.strictEqual(c.type, 'range');
  assert.deepStrictEqual([c.min, c.max, c.step, c.value], ['1', '10', '1', '6']);
  assert.strictEqual(panel.querySelector('.prop-filtre-pertinence'), null, 'le filtre de pertinence cède la place au curseur');
  const bouts = panel.querySelectorAll('.prop-finesse-bout').map((b) => b.textContent);
  assert.deepStrictEqual(bouts, [txt.propFinesseLarge, txt.propFinesseStrict], 'seuls les deux bouts sont nommés');
  assert.strictEqual(panel.querySelector('.prop-finesse-lecture').textContent,
    r(txt.propFinesseLecture, [6, r(txt.propFinesseVisiblesPlus, [5]), r(txt.propFinesseMasqueesPlus, [3])]));
  assert.strictEqual(c.getAttribute('aria-valuetext'), r(txt.propFinesseValeur, [6, r(txt.propFinesseVisiblesPlus, [5])]));
  assert.deepStrictEqual(titres(panel), ['Thêta douteuse', 'Delta', 'Epsilon', 'Êta sans note', 'Zêta']);
  const o = onglet(page, 'intervention');
  assert.strictEqual(o.querySelector('.doc-onglet-compte').textContent, '5');
  assert.strictEqual(o.querySelector('.prop-onglet-b-n').textContent, '1');
  assert.strictEqual(panel.querySelector('.prop-finesse-garder'), null, 'l’aperçu ne diffère pas du partagé');
});

test('page : le texte suit le curseur en direct ; au lâcher, l’aperçu part à l’hôte et « Garder » apparait', async () => {
  repartir({ reglage: 6 });
  const { page, panel, txt, p } = await vueBranchee();
  const c = panel.querySelector('.prop-finesse-curseur');
  c.value = '10';
  c.dispatchEvent({ type: 'input' });
  assert.strictEqual(panel.querySelector('.prop-finesse-lecture').textContent,
    r(txt.propFinesseLecture, [10, r(txt.propFinesseVisiblesPlus, [2]), r(txt.propFinesseMasqueesPlus, [6])]));
  assert.strictEqual(c.getAttribute('aria-valuetext'), r(txt.propFinesseValeur, [10, r(txt.propFinesseVisiblesPlus, [2])]));
  assert.strictEqual(page.messages.filter((m) => m.type === MSG.PROP_FINESSE_APERCU).length, 0, 'rien ne part pendant le glissé');
  c.dispatchEvent({ type: 'change' });
  const m = copie(page.messages.filter((x) => x.type === MSG.PROP_FINESSE_APERCU).pop());
  assert.deepStrictEqual(m, { type: MSG.PROP_FINESSE_APERCU, typeFiche: 'intervention', cran: 10 });
  await relayer(page, p);
  assert.deepStrictEqual(titres(panel), ['Êta sans note', 'Zêta']);
  assert.strictEqual(onglet(page, 'intervention').querySelector('.prop-onglet-b'), null, 'la pastille B suit le cran');
  const g = panel.querySelector('.prop-finesse-garder');
  assert.ok(g, '« Garder » devait apparaitre');
  assert.strictEqual(g.textContent, txt.propFinesseGarder);
  page.messages.length = 0;
  g.click();
  assert.deepStrictEqual(copie(page.messages.filter((x) => x.type === MSG.PROP_FINESSE_GARDER).pop()),
    { type: MSG.PROP_FINESSE_GARDER, typeFiche: 'intervention' });
  await relayer(page, p);
  assert.strictEqual(panel.querySelector('.prop-finesse-garder'), null);
  const bandeau = panel.querySelector('.prop-finesse-bandeau');
  assert.ok(bandeau && bandeau.textContent.indexOf(r(txt.propFinesseGarde, ['Revue', 10])) !== -1, 'bandeau absent');
  page.messages.length = 0;
  bandeau.querySelector('.prop-finesse-annuler').click();
  assert.ok(page.messages.some((x) => x.type === MSG.PROP_FINESSE_ANNULER && x.typeFiche === 'intervention'));
  await relayer(page, p);
  assert.strictEqual(pr.lireReglages(RACINE_ARBRE, 'fr').parlement.intervention.cran, 6);
  assert.ok(panel.querySelector('.prop-finesse-garder'), 'l’aperçu revient, et « Garder » avec lui');
});

test('page : « les voir » montre les masquées en grisé, en italique et avec le mot, sans les compter', async () => {
  repartir({ reglage: 6 });
  const { page, panel, txt } = await vueBranchee();
  const voir = panel.querySelector('.prop-finesse-voir');
  assert.strictEqual(voir.textContent, txt.propFinesseVoir);
  assert.strictEqual(voir.getAttribute('aria-pressed'), 'false');
  voir.click();
  assert.strictEqual(lignes(panel).length, 8);
  const masquees = lignes(panel).filter((tr) => tr.classList.contains('prop-ligne--masquee'));
  assert.deepStrictEqual(masquees.map((tr) => tr.dataset.cle).sort(), [cle('A'), cle('B'), cle('C')]);
  masquees.forEach((tr) => assert.strictEqual(tr.querySelector('.prop-masquee-mot').textContent, txt.propFinesseMasquee));
  assert.strictEqual(onglet(page, 'intervention').querySelector('.doc-onglet-compte').textContent, '5', 'les masquées ne comptent pas');
  assert.strictEqual(panel.querySelector('.prop-finesse-voir').textContent, txt.propFinesseCacher);
  assert.strictEqual(panel.querySelector('.prop-finesse-voir').getAttribute('aria-pressed'), 'true');
  // La case de tête coche les visibles seulement.
  const tout = panel.querySelector('.prop-case-tout');
  tout.checked = true;
  tout.dispatchEvent({ type: 'change' });
  assert.strictEqual(panel.querySelector('.prop-selbar-compte').textContent, r(txt.propSelectionPlus, [5]));
});

// Tant que la note n'est pas calibrée sur des jugements humains, le curseur coupe surtout par
// volume : l'infobulle le dit, et se tait quand le moissonneur annonce une note calibrée.
test('page : une langue sans fiches de référence dit « rappel non mesuré », jamais « 0 des 0 »', async () => {
  repartir({ reglage: 6, sansReference: true });
  const v = await vueBranchee();
  const t = v.panel.querySelector('.prop-finesse-aide').title;
  assert.ok(t.indexOf(v.txt.propFinesseRappelSans) !== -1, t);
  assert.strictEqual(t.indexOf(r(v.txt.propFinesseRappel, [0, 0])), -1);
});

test('page : l’infobulle dit que la note n’est pas calibrée, sauf si le moissonneur l’annonce', async () => {
  repartir({ reglage: 6 });
  let v = await vueBranchee();
  assert.ok(v.panel.querySelector('.prop-finesse-aide').title.indexOf(v.txt.propFinesseNonCalibree) !== -1);
  repartir({ reglage: 6, calibree: true });
  v = await vueBranchee();
  assert.strictEqual(v.panel.querySelector('.prop-finesse-aide').title.indexOf(v.txt.propFinesseNonCalibree), -1);
});

test('page : l’infobulle « ? » porte les chiffres du cran, et un cran identique le dit', async () => {
  repartir({ reglage: 6 });
  const { panel, txt } = await vueBranchee();
  const aide = panel.querySelector('.prop-finesse-aide');
  assert.strictEqual(aide.getAttribute('aria-label'), txt.propFinesseAide);
  assert.ok(aide.title.indexOf(r(txt.propFinesseParMois, [41, '01.04.2026', '30.09.2026'])) !== -1, aide.title);
  assert.ok(aide.title.indexOf(r(txt.propFinesseRappel, [43, 79])) !== -1, aide.title);
  assert.ok(aide.title.indexOf(r(txt.propFinesseCalcule, ['01.10.2026'])) !== -1);
  assert.ok(aide.title.indexOf(r(txt.propFinesseRegle, ['Revue', 6, 'Claire Exemple', pr.lireReglages(RACINE_ARBRE, 'fr').parlement.intervention.le.split('-').reverse().join('.')])) !== -1, aide.title);
  aide.click();
  const det = panel.querySelector('.prop-finesse-detail');
  assert.strictEqual(det.hidden, false, 'le clic montre les chiffres pour qui n’a pas de survol');
  // Cran 5, identique au cran 4.
  const c = panel.querySelector('.prop-finesse-curseur');
  c.value = '5';
  c.dispatchEvent({ type: 'input' });
  assert.strictEqual(panel.querySelector('.prop-finesse-lecture').textContent,
    r(txt.propFinesseIdentique, [5, 4, r(txt.propFinesseVisiblesPlus, [6]), r(txt.propFinesseMasqueesPlus, [2])]));
  assert.strictEqual(c.getAttribute('aria-valuetext'), r(txt.propFinesseValeurIdentique, [5, 4, r(txt.propFinesseVisiblesPlus, [6])]));
  assert.ok(panel.querySelector('.prop-finesse-aide').title.indexOf(r(txt.propFinesseIdentiqueTip, [5, 4])) !== -1);
});

test('page : un type sans crans garde le filtre de pertinence et sa colonne, sans curseur', async () => {
  repartir({ sansCrans: true });
  const { page, panel } = await vueBranchee();
  assert.strictEqual(panel.querySelector('.prop-finesse-curseur'), null);
  assert.ok(panel.querySelector('.prop-filtre-pertinence'));
  assert.ok(panel.querySelector('th.prop-th-pertinence'));
  assert.strictEqual(panel.querySelector('th.prop-th-cran'), null);
  assert.strictEqual(lignes(panel).length, 8);
  onglet(page, 'recherche').click();
  assert.strictEqual(panel.querySelector('.prop-finesse-curseur'), null);
});

test('page : la colonne Cran remplace Pertinence, masquée par défaut, réactivable par le menu Colonnes', async () => {
  repartir({ reglage: 6 });
  const { page, panel, txt } = await vueBranchee();
  assert.strictEqual(panel.querySelector('th.prop-th-pertinence'), null);
  assert.strictEqual(panel.querySelector('th.prop-th-cran'), null, 'Cran masquée par défaut');
  panel.querySelector('.prop-bouton-colonnes').click();
  const item = panel.querySelector('.prop-menu-colonnes').querySelectorAll('button').find((b) => b.dataset.col === 'cran');
  assert.strictEqual(item.getAttribute('aria-checked'), 'false');
  assert.strictEqual(item.textContent, txt.propColCran);
  item.click();
  const m = page.messages.filter((x) => x.type === MSG.PROP_COLONNES).pop();
  assert.deepStrictEqual(copie(m.reglage), { largeurs: {}, masquees: [], montrees: ['cran'] });
  assert.ok(panel.querySelector('th.prop-th-cran'));
  const td = lignes(panel).find((tr) => tr.dataset.cle === cle('D')).querySelector('.prop-td-cran');
  assert.strictEqual(td.textContent, '1–6');
  assert.strictEqual(td.title, r(txt.propCranTip, [6, 20]));
});

test('page : « Pourquoi » dans le détail — la note, la catégorie en clair, les termes par rôle et leur emplacement', async () => {
  repartir({ reglage: 6 });
  const { panel, txt } = await vueBranchee();
  lignes(panel).find((tr) => tr.dataset.cle === cle('D')).querySelector('.prop-titre').click();
  const s = panel.querySelector('.prop-detail .prop-pourquoi');
  assert.ok(s, 'section Pourquoi absente');
  assert.strictEqual(s.querySelector('.prop-sous-titre').textContent, txt.propPourquoi);
  assert.strictEqual(s.querySelector('.prop-pourquoi-note').textContent, r(txt.propPourquoiNote, [20, 6]));
  assert.strictEqual(s.querySelector('.prop-pourquoi-categorie').textContent, r(txt.propPourquoiCategorie, [txt.propCategorieSignalFaible]));
  const roles = s.querySelectorAll('.prop-pourquoi-termes').map((l) => l.querySelector('.prop-pourquoi-role').textContent);
  assert.deepStrictEqual(roles, [txt.propRoleAncrage, txt.propRoleAmbigu, txt.propRoleEcole]);
  const ancrage = s.querySelectorAll('.prop-pourquoi-termes')[0];
  const terme = ancrage.querySelector('.prop-pourquoi-terme');
  assert.strictEqual(terme.querySelector('.prop-pourquoi-mot').getAttribute('lang'), 'de', 'un terme d’une autre langue la déclare');
  assert.ok(terme.textContent.indexOf('Nachteilsausgleich') !== -1 && terme.textContent.indexOf(txt.propOuExtrait) !== -1);
  // Chaque terme s'ouvre sur ses gestes (test/js/propositions-termes.test.js).
  const boutons = s.querySelectorAll('button');
  assert.strictEqual(boutons.length, 3, 'un bouton par terme');
  boutons.forEach((b) => assert.strictEqual(b.getAttribute('aria-haspopup'), 'menu'));
});

test('libellés : la finesse a ses clés en fr et en de, sans « Vorschlag », et les catégories des moissonneurs', () => {
  const { TEXTES_COCKPIT } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  const cles = Object.keys(TEXTES_COCKPIT.fr).filter((k) => /^doc\.prop\.(finesse|categorie|role|ou|pourquoi|cran|col\.cran)|^arbre\.actualite\.propositions\.masquees|^accueil\.regl\.moiss/.test(k));
  assert.ok(cles.length > 40, 'trop peu de clés : ' + cles.length);
  for (const k of cles) {
    assert.ok(TEXTES_COCKPIT.de[k], 'clé allemande absente : ' + k);
    assert.ok(!/Vorschlag|Vorschläge/.test(TEXTES_COCKPIT.de[k]), k);
  }
  for (const j of ['titre', 'texte-dense', 'signal-faible', 'ecole', 'theme']) {
    assert.ok(TEXTES_COCKPIT.fr['doc.prop.categorie.' + j] && TEXTES_COCKPIT.de['doc.prop.categorie.' + j], j);
  }
});
