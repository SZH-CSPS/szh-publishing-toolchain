// La vue « Propositions » de la Documentation : l'entrée de l'arbre, les messages de l'hôte
// (documentation-hote.js) et la page (media/_propositions.js). Les lots sont synthétiques,
// écrits ici dans la bibliothèque jetable du numéro d'essai (docs/FORMAT-PROPOSITIONS.md).
//
//   node --test test/js/documentation-propositions.test.js
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
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const session = require(path.join(COCKPIT, 'lib', 'session.js'));
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
const RACINE_ARBRE = kirby.racineArbre(REVUE);
function ausgabeId() { return yaml.idNumero(REVUE); }

// ---- Les lots d'essai ---------------------------------------------------------------------

function proposition(type, id, valeurs, extra) {
  return Object.assign({
    format: 'pronto-proposition/1', cle: 'essai:source-exemple:' + id, moissonneur: 'parlement',
    type: type, langue: 'fr', recolte: '2026-10-02T14:12:00Z',
    lien_source: 'https://exemple.ch/objet/' + id, valeurs: valeurs, doutes: [], brut: {},
    pertinence: { verdict: 'retenu', raison: 'ancrage fort' }, doublon: null
  }, extra || {});
}
function intervention(id, canton, titre, extra) {
  return proposition('intervention', id, {
    title: titre, canton: canton, categorie: 'motion', numero: 'M ' + id, date: '2026-03-04',
    lien: 'https://exemple.ch/objet/' + id, source: 'openparldata'
  }, extra);
}
function recherche(id, titre, extra) {
  return proposition('recherche', id, {
    title: titre, institutions: 'HEP Exemple', debut: '2024', fin: '2026', descriptif: 'Une étude.'
  }, Object.assign({ moissonneur: 'recherche' }, extra || {}));
}
const DOUTE_DATE = [{ champ: 'date', code: 'date-illisible', detail: 'mois en toutes lettres', suggestion: '2026-03-04' }];
const LOT = [
  intervention('GE-1', 'GE', 'Alpha genevois'),
  intervention('CH-1', 'CH', 'Zêta fédéral'),
  intervention('VD-1', 'VD', 'Date douteuse', { doutes: DOUTE_DATE, brut: { date: '4 mars' } }),
  intervention('NE-1', 'NE', 'Bêta neuchâtelois'),
  recherche('R-1', 'Une recherche prête'),
  intervention('de-1', 'ZH', 'Ein Vorstoss', { langue: 'de' })
];
function cle(id) { return 'essai:source-exemple:' + id; }

function ecrireLot(nom, lignes, moissonneur) {
  const dossier = path.join(pr.cheminMoissons(RACINE_ARBRE), moissonneur || 'parlement');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, nom), lignes.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
}
function ecrireEtat(moissonneur, etat) {
  const dossier = path.join(pr.cheminMoissons(RACINE_ARBRE), moissonneur);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'etat.json'), JSON.stringify(Object.assign({
    format: 'pronto-etat/1', moissonneur: moissonneur, contrat: 1, derniere_moisson: '2026-10-01T05:12:00Z',
    duree_s: 42, requetes: 10, propositions_ecrites: 5, lot: '', sources_en_echec: [], interrompu: null
  }, etat || {})));
}
// Remet les moissons à l'état du lot de départ : aucune décision, les deux lots d'essai.
function repartir() {
  fs.rmSync(pr.cheminMoissons(RACINE_ARBRE), { recursive: true, force: true });
  ecrireLot('2026-10-01-1.jsonl', LOT.filter((p) => p.type === 'intervention'));
  ecrireLot('2026-10-01-1.jsonl', LOT.filter((p) => p.type === 'recherche'), 'recherche');
  ecrireEtat('parlement', { sources_en_echec: [{ source: 'Grand Conseil NE', raison: 'délai dépassé' }] });
  ecrireEtat('recherche', { propositions_ecrites: 1 });
}

async function entreeArbre() {
  const sections = await HOTE.arbre().getChildren();
  const s = sections.find((it) => it.contextValue === 'section-actualite');
  const enfants = await HOTE.arbre().getChildren(s);
  return { enfants: enfants, entree: enfants.find((it) => it.id === 'actualite:propositions') };
}

async function panneau() {
  await HOTE.executer('szh.ouvrirActualite', 'propositions');
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  assert.ok(p, 'panneau de Documentation absent');
  await p._recepteur({ type: MSG.PRET });
  return p;
}
function derniere(p, type) { return p.messages.filter((m) => m.type === type).pop(); }
async function donnees(p) {
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_CHARGER });
  const d = derniere(p, MSG.PROP_DONNEES);
  assert.ok(d, 'aucune réponse PROP_DONNEES');
  return d;
}

// ---- L'arbre ------------------------------------------------------------------------------

test('arbre : « Propositions » juste après « Documentation du numéro », avec son compte et l’icône d’avertissement', async () => {
  repartir();
  const { enfants, entree } = await entreeArbre();
  assert.ok(entree, 'entrée Propositions absente');
  assert.strictEqual(enfants.indexOf(entree), enfants.findIndex((it) => it.id === 'actualite:numero') + 1);
  assert.strictEqual(entree.label, T('doc.prop.vue'));
  assert.strictEqual(entree.description, '(5)', 'cinq propositions françaises en attente');
  assert.strictEqual(entree.iconPath.id, 'warning');
  assert.strictEqual(entree.iconPath.color && entree.iconPath.color.id, 'list.warningForeground');
  assert.strictEqual(entree.tooltip, T('arbre.actualite.propositions.tip.plus', [5, 1]));
  assert.deepStrictEqual(entree.command.arguments, ['propositions']);
});

test('arbre : sans cas B, l’icône ordinaire ; sans rien en attente, aucun compte', async () => {
  repartir();
  pr.refuser(RACINE_ARBRE, { cle: cle('VD-1') });
  let { entree } = await entreeArbre();
  assert.notStrictEqual(entree.iconPath.id, 'warning');
  assert.strictEqual(entree.iconPath.color, undefined);
  assert.strictEqual(entree.tooltip, T('arbre.actualite.propositions.tipA.plus', [4]));
  for (const id of ['GE-1', 'CH-1', 'NE-1', 'R-1']) { pr.refuser(RACINE_ARBRE, { cle: cle(id) }); }
  ({ entree } = await entreeArbre());
  assert.strictEqual(entree.description, undefined);
  assert.strictEqual(entree.tooltip, T('arbre.actualite.propositions.tipVide'));
});

test('arbre : un rafraichissement sur des lots inchangés ne relit aucun lot', async () => {
  repartir();
  const origine = fs.readFileSync;
  let lus = 0;
  fs.readFileSync = function (chemin) {
    if (/\.jsonl$/.test(String(chemin))) { lus++; }
    return origine.apply(fs, arguments);
  };
  let premiere;
  try {
    await entreeArbre();
    premiere = lus;
    await entreeArbre();
  } finally { fs.readFileSync = origine; }
  assert.ok(premiere > 0, 'des lots neufs doivent être lus une fois');
  assert.strictEqual(lus, premiere, 'lots relus par l’arbre : ' + (lus - premiere));
});

// ---- L'hôte -----------------------------------------------------------------------------

test('hôte : l’entrée ouvre la Documentation sur la vue propositions', async () => {
  repartir();
  const p = await panneau();
  const charge = derniere(p, MSG.CHARGER);
  assert.deepStrictEqual(charge.vueInitiale, { onglet: 'propositions', categorie: undefined });
});

test('hôte : PROP_DONNEES rend les propositions de la langue du numéro, B en tête puis l’ordre `tri`', async () => {
  repartir();
  const d = await donnees(await panneau());
  assert.strictEqual(d.langue, 'fr');
  assert.strictEqual(d.cible, 'de');
  const inter = d.propositions.filter((x) => x.type === 'intervention');
  assert.deepStrictEqual(inter.map((x) => x.valeurs.title),
    ['Date douteuse', 'Zêta fédéral', 'Alpha genevois', 'Bêta neuchâtelois']);
  assert.deepStrictEqual(inter.map((x) => x.cas), ['B', 'A', 'A', 'A']);
  assert.deepStrictEqual(inter[0].bloquants, [{ code: 'doute-non-touche', champ: 'date' }]);
  assert.deepStrictEqual(d.propositions.filter((x) => x.aussi).map((x) => x.cle), [cle('CH-1')],
    'la marque de l’autre revue est cochée d’office pour CH, et là seulement');
  assert.ok(!d.propositions.some((x) => x.cle === cle('de-1')), 'une proposition allemande dans la Revue');
  const parlement = d.etats.find((e) => e.moissonneur === 'parlement');
  assert.strictEqual(parlement.libelle, T('doc.prop.moissonneur.parlement'));
  assert.deepStrictEqual(parlement.echecs, [{ source: 'Grand Conseil NE', raison: 'délai dépassé' }]);
  const intervType = d.types.find((t) => t.type === 'intervention');
  assert.deepStrictEqual(intervType.tri, ['canton']);
  assert.strictEqual(intervType.categorie, true);
  assert.strictEqual(d.types.find((t) => t.type === 'recherche').categorie, false);
});

test('hôte : accepter dans ce numéro, en lot — les A seulement, la fiche rattachée, la page rechargée', async () => {
  repartir();
  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true,
    demandes: [{ cle: cle('CH-1'), aussi: true }, { cle: cle('GE-1') }, { cle: cle('VD-1') }] });
  const d = derniere(p, MSG.PROP_DONNEES);
  assert.deepStrictEqual(d.resultat.faites.sort(), [cle('CH-1'), cle('GE-1')].sort());
  assert.deepStrictEqual(d.resultat.ignorees, [{ cle: cle('VD-1'), raison: 'a-verifier' }]);
  assert.strictEqual(d.resultat.geste, 'accepte');
  const titres = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).map((f) => f.valeurs.title);
  assert.ok(titres.includes('Zêta fédéral') && titres.includes('Alpha genevois'), titres.join(', '));
  const uuidCh = pr.lireDecision(RACINE_ARBRE, cle('CH-1')).fiche;
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'de', uuidCh).statut, 'a-traduire');
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'de', pr.lireDecision(RACINE_ARBRE, cle('GE-1')).fiche), null);
  assert.ok(p.messages.some((m) => m.type === MSG.CHARGER), 'la Documentation du numéro doit se recharger');
  assert.ok(!d.propositions.some((x) => x.cle === cle('CH-1')), 'une acceptée reste en attente');
});

test('hôte : garder au réservoir crée une orpheline ; refuser avec motif, en lot', async () => {
  repartir();
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: false, demandes: [{ cle: cle('NE-1') }] });
  const f = kirby.listerOrphelines(RACINE_ARBRE, 'fr').find((x) => x.valeurs.title === 'Bêta neuchâtelois');
  assert.ok(f, 'pas d’orpheline créée');
  assert.strictEqual(derniere(p, MSG.PROP_DONNEES).resultat.geste, 'garde');
  await p._recepteur({ type: MSG.PROP_REFUSER, cles: [cle('GE-1'), cle('VD-1')], motif: 'hors-sujet' });
  assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('VD-1')).motif, 'hors-sujet');
  const d = derniere(p, MSG.PROP_DONNEES);
  assert.deepStrictEqual(d.resultat.faites, [cle('GE-1'), cle('VD-1')]);
  assert.strictEqual(d.resultat.motif, 'hors-sujet');
  assert.deepStrictEqual(d.refusees.map((x) => [x.cle, x.motif]).sort(),
    [[cle('GE-1'), 'hors-sujet'], [cle('VD-1'), 'hors-sujet']]);
});

test('hôte : Annuler défait un geste entier, lot compris', async () => {
  repartir();
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('CH-1') }, { cle: cle('GE-1') }] });
  const avant = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).length;
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_ANNULER, cles: [cle('CH-1'), cle('GE-1')] });
  assert.strictEqual(kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).length, avant - 2);
  assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('CH-1')), null);
  const d = derniere(p, MSG.PROP_DONNEES);
  assert.strictEqual(d.resultat.geste, 'annule');
  assert.ok(d.propositions.some((x) => x.cle === cle('CH-1')) && d.propositions.some((x) => x.cle === cle('GE-1')));
  assert.ok(p.messages.some((m) => m.type === MSG.CHARGER), 'les fiches retirées doivent quitter la page');
});

test('hôte : numéro gelé — « Accepter dans ce numéro » refusé, « Garder au réservoir » possible', async () => {
  repartir();
  const p = await panneau();
  const etatAvant = session.etatNumero();
  session.poserEtatNumero(Object.assign({}, etatAvant, { verrouillee: true }));
  try {
    const nAvertis = HOTE.avertissements.length;
    await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('GE-1') }] });
    assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('GE-1')), null, 'une acceptation est passée sur un numéro gelé');
    assert.strictEqual(derniere(p, MSG.PROP_DONNEES).resultat.refus, 'verrou');
    assert.ok(HOTE.avertissements.length > nAvertis, 'le refus doit se dire');
    await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: false, demandes: [{ cle: cle('GE-1') }] });
    assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('GE-1')).decision, 'accepte');
  } finally { session.poserEtatNumero(etatAvant); }
});

test('hôte : les colonnes se mémorisent dans le globalState, par type de fiche, et se relisent', async () => {
  repartir();
  const p = await panneau();
  const reglage = { largeurs: { titre: 420 }, masquees: ['pertinence'] };
  await p._recepteur({ type: MSG.PROP_COLONNES, typeFiche: 'intervention', reglage: reglage });
  assert.deepStrictEqual(HOTE.memoire['szh.propositions.colonnes'], { intervention: reglage });
  assert.deepStrictEqual((await donnees(p)).colonnes, { intervention: reglage });
  await p._recepteur({ type: MSG.PROP_COLONNES, typeFiche: 'intervention', reglage: null });
  assert.deepStrictEqual(HOTE.memoire['szh.propositions.colonnes'], {});
});

test('hôte : « Ouvrir la source » passe par l’hôte, et seulement vers http(s)', async () => {
  repartir();
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_OUVRIR_SOURCE, cle: cle('GE-1') });
  assert.ok(HOTE.ouvertures().some((u) => String(u).indexOf('exemple.ch/objet/GE-1') !== -1), HOTE.ouvertures().join(', '));
  const n = HOTE.ouvertures().length;
  await p._recepteur({ type: MSG.PROP_OUVRIR_SOURCE, cle: 'inconnue' });
  assert.strictEqual(HOTE.ouvertures().length, n);
});

// ---- Une carte du numéro modifiée et non enregistrée ---------------------------------------

function pageDocumentation(ressources, vue) {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const page = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css', '_propositions.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js', '_propositions.js'], txt: txt
  });
  page.envoyer({
    type: MSG.CHARGER, slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: doc._libelles.typesRessourceConfig('fr'), typesRubrique: [],
    rubriques: [], ressources: ressources, orphelines: [{ slug: 'orph', uuid: 'u-orph', type: 'livre', typeLibelle: 'Livres', titre: 'Orpheline' }],
    vueInitiale: vue || { onglet: 'numero', categorie: 'livre' }
  });
  return { page: page, txt: txt };
}
const LIVRE_CARTE = { id: 'UuidCarteLivre01', type: 'livre', apercu: null, valeurs: {
  categorie: 'manuel', title: 'Titre enregistré', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: '' } };
function champTitre(page) {
  const i = page.document.querySelectorAll('input').find((e) => e.id.indexOf('ch-title-') === 0);
  assert.ok(i, 'champ du titre absent');
  return i;
}

// Le détail est dans documentation-tirer.test.js ; ici, que la vue Propositions n'y change rien.
test('« Tirer dans ce numéro » enregistre d’abord une carte modifiée, et ne part qu’après l’accusé', () => {
  const { page, txt } = pageDocumentation([LIVRE_CARTE]);
  const titre = champTitre(page);
  titre.value = 'Titre modifié, non enregistré';
  titre.dispatchEvent({ type: 'input' });
  page.messages.length = 0;
  const tirer = page.document.querySelectorAll('button').find((b) => b.textContent === txt.tirerDansNumero);
  tirer.click();
  const envoyes = page.messages.map((m) => m.type);
  assert.ok(envoyes.includes(MSG.ENREGISTRER), 'la carte part d’abord');
  assert.ok(!envoyes.includes(MSG.TIRER_DANS_NUMERO), 'le geste attend l’accusé');
  page.envoyer({ type: MSG.ENREGISTRE, auto: true, correspondances: [] });
  assert.ok(page.messages.some((m) => m.type === MSG.TIRER_DANS_NUMERO && m.slug === 'orph'));
});

// ---- La page --------------------------------------------------------------------------------

// Une page ouverte sur la vue, nourrie par le vrai hôte : chaque message qu'elle envoie part
// au panneau factice, et ce qu'il répond lui revient.
async function vueBranchee(ressources) {
  const p = await panneau();
  const { page, txt } = pageDocumentation(ressources || [], { onglet: 'propositions' });
  await relayer(page, p);
  return { page: page, txt: txt, p: p, panel: page.parId['panel-propositions'] };
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
function lignes(panel) { return panel.querySelectorAll('tr').filter((tr) => tr.dataset.cle !== undefined); }
function ligne(panel, id) {
  const tr = lignes(panel).find((x) => x.dataset.cle === cle(id));
  assert.ok(tr, 'ligne absente : ' + id);
  return tr;
}
function onglet(page, type) {
  const b = page.parId.barreCategories.querySelectorAll('button').find((x) => x.dataset.type === type);
  assert.ok(b, 'onglet absent : ' + type);
  return b;
}
function envoyes(page, type) { return JSON.parse(JSON.stringify(page.messages.filter((m) => m.type === type))); }

test('page : un onglet par type qui a des propositions, son compte et la pastille des cas B', async () => {
  repartir();
  const { page } = await vueBranchee();
  const types = page.parId.barreCategories.querySelectorAll('button').map((b) => b.dataset.type);
  assert.deepStrictEqual(types, ['recherche', 'intervention'], 'l’ordre du contrat, sans onglet vide');
  const inter = onglet(page, 'intervention');
  assert.strictEqual(inter.querySelector('.doc-onglet-compte').textContent, '4');
  assert.strictEqual(inter.querySelector('.prop-onglet-b-n').textContent, '1');
  assert.strictEqual(onglet(page, 'recherche').querySelector('.prop-onglet-b'), null);
  assert.strictEqual(page.parId.barreCategories.hidden, false);
});

test('page : les cas B en tête, puis l’ordre `tri` ; Vérifier pour un B, Accepter et Réservoir pour un A', async () => {
  repartir();
  const { page, panel, txt } = await vueBranchee();
  onglet(page, 'intervention').click();
  assert.deepStrictEqual(lignes(panel).map((tr) => tr.querySelector('.prop-titre').textContent),
    ['Date douteuse', 'Zêta fédéral', 'Alpha genevois', 'Bêta neuchâtelois']);
  const b = ligne(panel, 'VD-1');
  assert.ok(b.querySelector('.prop-bouton-verifier'));
  assert.strictEqual(b.querySelector('.prop-bouton-accepter'), null, 'un cas B ne s’accepte pas depuis la ligne');
  assert.strictEqual(b.querySelector('.prop-etat').textContent, txt.propAVerifier);
  const a = ligne(panel, 'GE-1');
  assert.ok(a.querySelector('.prop-bouton-accepter') && a.querySelector('.prop-bouton-garder'));
  assert.strictEqual(a.querySelector('.prop-etat'), null);
  // Type (categorie) se lit en clair ; Pertinence est là.
  assert.ok(panel.querySelector('th.prop-th-champ-categorie') && panel.querySelector('th.prop-th-pertinence'));
});

test('page : la marque « + de » d’office pour CH, qui se retire d’un clic et part avec l’acceptation', async () => {
  repartir();
  const { page, panel, p } = await vueBranchee();
  onglet(page, 'intervention').click();
  const marque = ligne(panel, 'CH-1').querySelector('.prop-aussi');
  assert.ok(marque, 'marque absente sur une intervention fédérale');
  assert.strictEqual(marque.textContent, '+ de');
  assert.strictEqual(ligne(panel, 'GE-1').querySelector('.prop-aussi'), null);
  ligne(panel, 'CH-1').querySelector('.prop-bouton-accepter').click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_ACCEPTER)[0].demandes, [{ cle: cle('CH-1'), aussi: true }]);
  await relayer(page, p);
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'de', pr.lireDecision(RACINE_ARBRE, cle('CH-1')).fiche).statut, 'a-traduire');
});

test('page : la marque retirée ne part pas', async () => {
  repartir();
  const { page, panel } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'CH-1').querySelector('.prop-aussi').click();
  assert.strictEqual(ligne(panel, 'CH-1').querySelector('.prop-aussi'), null);
  ligne(panel, 'CH-1').querySelector('.prop-bouton-accepter').click();
  const m = envoyes(page, MSG.PROP_ACCEPTER)[0];
  assert.deepStrictEqual(m.demandes, [{ cle: cle('CH-1'), aussi: false }]);
  assert.strictEqual(m.dansNumero, true);
});

test('page : une sélection mêlée n’accepte que les A, et la barre le dit', async () => {
  repartir();
  const { page, panel, p } = await vueBranchee();
  onglet(page, 'intervention').click();
  const tout = panel.querySelector('.prop-case-tout');
  tout.checked = true;
  tout.dispatchEvent({ type: 'change' });
  const barre = panel.querySelector('.prop-selbar');
  assert.ok(barre, 'barre de sélection absente');
  assert.ok(barre.querySelector('.prop-selbar-b'), 'la barre doit dire qu’un cas B attend');
  assert.match(barre.querySelector('.prop-lot-accepter').textContent, /\(3\)$/);
  barre.querySelector('.prop-lot-accepter').click();
  const m = envoyes(page, MSG.PROP_ACCEPTER)[0];
  assert.deepStrictEqual(m.demandes.map((x) => x.cle).sort(), [cle('CH-1'), cle('GE-1'), cle('NE-1')].sort());
  await relayer(page, p);
  assert.deepStrictEqual(lignes(panel).map((tr) => tr.dataset.cle), [cle('VD-1')], 'seul le cas B reste');
  assert.ok(panel.querySelector('.prop-bandeau'), 'le bandeau Annuler doit suivre le geste');
});

test('page : refuser en lot avec un motif, puis Annuler défait tout le lot', async () => {
  repartir();
  const { page, panel, p } = await vueBranchee();
  onglet(page, 'intervention').click();
  for (const id of ['GE-1', 'NE-1']) {
    const c = ligne(panel, id).querySelector('.prop-case');
    c.checked = true;
    c.dispatchEvent({ type: 'click' });
  }
  panel.querySelector('.prop-selbar .prop-refus-menu').click();
  const motif = panel.querySelector('.prop-menu').querySelectorAll('button').find((b) => b.dataset.motif === 'hors-sujet');
  motif.click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_REFUSER), [{ type: MSG.PROP_REFUSER, cles: [cle('GE-1'), cle('NE-1')], motif: 'hors-sujet' }]);
  await relayer(page, p);
  assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('NE-1')).motif, 'hors-sujet');
  assert.strictEqual(lignes(panel).length, 2);
  panel.querySelector('.prop-bandeau .prop-bouton-annuler').click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_ANNULER)[0].cles, [cle('GE-1'), cle('NE-1')]);
  await relayer(page, p);
  assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('GE-1')), null);
  assert.strictEqual(lignes(panel).length, 4, 'les deux refusées reviennent en attente');
});

test('page : la touche A sur un cas B dit « À vérifier d’abord » et n’envoie rien', async () => {
  repartir();
  const { page, panel, txt } = await vueBranchee();
  onglet(page, 'intervention').click();
  const tr = ligne(panel, 'VD-1');
  tr.dispatchEvent({ type: 'keydown', key: 'a', bubbles: true });
  assert.strictEqual(envoyes(page, MSG.PROP_ACCEPTER).length, 0);
  const avis = panel.querySelector('.prop-avis');
  assert.ok(avis, 'aucun avis');
  assert.strictEqual(avis.textContent, txt.propVerifierDabord.replace('{0}', 'Date douteuse'));
  // Sur un cas A, la même touche accepte dans le numéro.
  ligne(panel, 'GE-1').dispatchEvent({ type: 'click' });
  ligne(panel, 'GE-1').dispatchEvent({ type: 'keydown', key: 'a', bubbles: true });
  const m = envoyes(page, MSG.PROP_ACCEPTER);
  assert.strictEqual(m.length, 1);
  assert.deepStrictEqual(m[0].demandes, [{ cle: cle('GE-1'), aussi: false }]);
});

test('page : le détail d’un cas B — Accepter désactivé avec sa raison, les doutes et les valeurs lues', async () => {
  repartir();
  const { page, panel, txt } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'VD-1').querySelector('.prop-bouton-verifier').click();
  const det = panel.querySelector('.prop-detail');
  assert.ok(det, 'détail absent');
  const acc = det.querySelector('.prop-detail-accepter');
  assert.strictEqual(acc.disabled, true);
  assert.strictEqual(acc.title, txt.propBloque.replace('{0}', 'Date'));
  assert.ok(det.querySelector('.prop-doute-bloc'), 'le doute doit se lire');
  assert.ok(det.textContent.indexOf(txt.propDouteLu.replace('{0}', '4 mars')) !== -1, 'la valeur lue manque');
  assert.ok(det.textContent.indexOf(txt.propDouteSuggestion.replace('{0}', '2026-03-04')) !== -1);
  assert.strictEqual(det.querySelector('.prop-position').textContent, txt.propPosition.replace('{0}', '1').replace('{1}', '4'));
  det.querySelector('.prop-lien').click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_OUVRIR_SOURCE), [{ type: MSG.PROP_OUVRIR_SOURCE, cle: cle('VD-1') }]);
});

test('page : un cas A s’accepte depuis son détail, et le détail passe à la suivante', async () => {
  repartir();
  const { page, panel, p } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'CH-1').querySelector('.prop-titre').click();
  const acc = panel.querySelector('.prop-detail .prop-detail-accepter');
  assert.strictEqual(acc.disabled, false);
  acc.click();
  const m = envoyes(page, MSG.PROP_ACCEPTER)[0];
  assert.strictEqual(m.depuisDetail, true);
  await relayer(page, p);
  assert.strictEqual(panel.querySelector('.prop-detail .szh-tete-nom').textContent, 'Alpha genevois');
});

test('page : un doublon probable — la fiche en regard, le focus sur « refuser comme doublon »', async () => {
  repartir();
  const f = kirby.creerFiche(RACINE_ARBRE, 'fr', 'intervention', {
    title: 'Le même objet', canton: 'GE', categorie: 'motion', numero: 'M 9', date: '2026-03-04', source: 'openparldata'
  }, ausgabeId());
  ecrireLot('2026-10-02-1.jsonl', [intervention('GE-9', 'GE', 'Le même objet, reformulé',
    { doublon: { uuid: f.uuid, slug: f.slug, certitude: 'probable' } })]);
  const { page, panel, p } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'GE-9').querySelector('.prop-bouton-verifier').click();
  const bouton = panel.querySelector('.prop-detail .prop-doublon-refuser');
  assert.ok(bouton, 'geste du doublon absent');
  assert.strictEqual(bouton._focused, true, 'le focus doit aller sur « C’est la même »');
  assert.ok(panel.querySelector('.prop-detail .prop-comparaison .prop-differe'), 'la comparaison doit marquer ce qui diffère');
  assert.strictEqual(panel.querySelector('.prop-detail .prop-detail-accepter').disabled, false,
    'un doublon probable sans doute s’accepte depuis son détail');
  bouton.click();
  assert.deepStrictEqual(envoyes(page, MSG.PROP_REFUSER)[0], { type: MSG.PROP_REFUSER, cles: [cle('GE-9')], motif: 'doublon' });
  await relayer(page, p);
  assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('GE-9')).motif, 'doublon');
});

test('page : les colonnes mémorisées se relisent ; Titre et Gestes ne se masquent pas ; Rétablir', async () => {
  repartir();
  HOTE.memoire['szh.propositions.colonnes'] = { intervention: { largeurs: {}, masquees: ['pertinence'] } };
  try {
    const { page, panel, txt } = await vueBranchee();
    onglet(page, 'intervention').click();
    assert.strictEqual(panel.querySelector('th.prop-th-pertinence'), null, 'Pertinence devait rester masquée');
    panel.querySelector('.prop-bouton-colonnes').click();
    const menu = panel.querySelector('.prop-menu-colonnes');
    const item = (id) => menu.querySelectorAll('button').find((b) => b.dataset.col === id);
    assert.strictEqual(item('titre').getAttribute('aria-disabled'), 'true');
    assert.strictEqual(item('titre').title, txt.propColonneFixe.replace('{0}', txt.propColTitre));
    assert.strictEqual(item('gestes').getAttribute('aria-disabled'), 'true');
    item('titre').click();
    assert.strictEqual(envoyes(page, MSG.PROP_COLONNES).length, 0, 'Titre ne se masque pas');
    item('etat').click();
    assert.deepStrictEqual(envoyes(page, MSG.PROP_COLONNES).pop(),
      { type: MSG.PROP_COLONNES, typeFiche: 'intervention', reglage: { largeurs: {}, masquees: ['pertinence', 'etat'] } });
    assert.strictEqual(panel.querySelector('th.prop-th-etat'), null);
    item('_retablir').click();
    assert.deepStrictEqual(envoyes(page, MSG.PROP_COLONNES).pop(), { type: MSG.PROP_COLONNES, typeFiche: 'intervention', reglage: null });
    assert.ok(panel.querySelector('th.prop-th-pertinence') && panel.querySelector('th.prop-th-etat'));
  } finally { delete HOTE.memoire['szh.propositions.colonnes']; }
});

test('page : la poignée de largeur se manie au clavier et se mémorise', async () => {
  repartir();
  const { page, panel } = await vueBranchee();
  onglet(page, 'intervention').click();
  const sep = panel.querySelector('th.prop-th-titre').querySelector('.prop-poignee');
  assert.strictEqual(sep.getAttribute('role'), 'separator');
  const avant = Number(sep.getAttribute('aria-valuenow'));
  sep.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true });
  const m = envoyes(page, MSG.PROP_COLONNES).pop();
  assert.strictEqual(m.reglage.largeurs.titre, avant + 16);
});

test('page : avec une carte du numéro non enregistrée, Accepter et Garder l’enregistrent d’abord, et partent à l’accusé', async () => {
  repartir();
  let page, panel, p;
  for (const [id, classe, dansNumero] of [['GE-1', '.prop-bouton-accepter', true], ['NE-1', '.prop-bouton-garder', false]]) {
    ({ page, panel, p } = await vueBranchee([LIVRE_CARTE]));
    onglet(page, 'intervention').click();
    const titre = champTitre(page);
    titre.value = 'Saisie en cours ' + id;
    titre.dispatchEvent({ type: 'input' });
    page.messages.length = 0;
    ligne(panel, id).querySelector(classe).click();
    assert.strictEqual(envoyes(page, MSG.ENREGISTRER).length, 1, 'la carte part d’abord');
    assert.strictEqual(envoyes(page, MSG.PROP_ACCEPTER).length, 0, 'le geste attend l’accusé');
    page.envoyer({ type: MSG.ENREGISTRE, auto: true, correspondances: [] });
    const m = envoyes(page, MSG.PROP_ACCEPTER);
    assert.strictEqual(m.length, 1, 'le geste part à l’accusé');
    assert.strictEqual(m[0].dansNumero, dansNumero);
    await relayer(page, p);
    assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle(id)).decision, 'accepte');
  }
  // Refuser ne recharge rien : il part aussitôt.
  const titre = champTitre(page);
  titre.value = 'Encore une saisie';
  titre.dispatchEvent({ type: 'input' });
  page.messages.length = 0;
  ligne(panel, 'CH-1').querySelector('.prop-bouton-refuser').click();
  assert.strictEqual(envoyes(page, MSG.PROP_REFUSER).length, 1);
  assert.strictEqual(envoyes(page, MSG.ENREGISTRER).length, 0);
});

test('page : sous le seuil, le détail prend toute la largeur, avec « ← Liste » et « Suivante »', async () => {
  repartir();
  const { page, panel } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'VD-1').querySelector('.prop-titre').click();
  assert.ok(panel.querySelector('.prop-split--detail'), 'détail à droite en largeur normale');
  page.redimensionner(800);
  assert.ok(panel.querySelector('.prop-split--plein'), 'le détail devait passer en pleine largeur');
  assert.ok(panel.querySelector('.prop-nav-liste') && panel.querySelector('.prop-nav-suivante'));
  panel.querySelector('.prop-nav-suivante').click();
  assert.strictEqual(panel.querySelector('.prop-detail .szh-tete-nom').textContent, 'Zêta fédéral');
  page.redimensionner(1400);
  assert.ok(panel.querySelector('.prop-split--detail'));
  // Mesuré dans VSCodium : entre 960 et 1280 px de vue, le tableau à côté du détail défile
  // en largeur et tronque ses colonnes ; le détail y prend donc toute la place.
  page.redimensionner(1200);
  assert.ok(panel.querySelector('.prop-split--plein'), 'à 1200 px, le détail devait passer en pleine largeur');
  page.redimensionner(1300);
  assert.ok(panel.querySelector('.prop-split--detail'), 'à 1300 px, le détail reste à côté du tableau');
});

test('page : sans rien en attente, la vue dit les dernières moissons et leurs échecs', async () => {
  repartir();
  for (const x of LOT) { if (x.langue === 'fr') { pr.refuser(RACINE_ARBRE, x); } }
  const { page, panel, txt } = await vueBranchee();
  assert.strictEqual(page.parId.barreCategories.hidden, true);
  assert.ok(panel.querySelector('.prop-vide'));
  assert.ok(panel.textContent.indexOf(txt.propEchec.replace('{0}', 'Grand Conseil NE').replace('{1}', 'délai dépassé')) !== -1);
  assert.ok(panel.textContent.indexOf(T('doc.prop.moissonneur.recherche')) !== -1);
});

test('page : chaque libellé de _propositions.js est fourni par l’hôte, en fr et en de', () => {
  const src = fs.readFileSync(path.join(COCKPIT, 'media', '_propositions.js'), 'utf8');
  const utilises = new Set([...src.matchAll(/\bTXT\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/'(prop[A-Z][A-Za-z0-9]*)'/g)) { utilises.add(m[1]); }
  const fournis = libellesHote(RACINE, ['textesDocumentation']);
  // nombre('propX', n, …) lit propXUn ou propXPlus.
  for (const m of src.matchAll(/nombre\('(prop[A-Za-z0-9]*)'/g)) { utilises.delete(m[1]); utilises.add(m[1] + 'Un'); utilises.add(m[1] + 'Plus'); }
  for (const nom of utilises) { assert.ok(fournis[nom], 'libellé absent de l’hôte : ' + nom); }
  const textes = doc._libelles.textesDocumentation();
  process.env.SZH_LANGUE = 'de';
  try {
    const de = doc._libelles.textesDocumentation();
    for (const nom of utilises) { assert.ok(de[nom] && de[nom] !== textes[nom], 'libellé allemand absent ou identique : ' + nom); }
  } finally { delete process.env.SZH_LANGUE; }
});

// ---- Retouches : pluriels, valeurs lues, nommage allemand ------------------------------------

test('page : un nombre devant un nom s’accorde, à 1 comme à 2 (onglets, moissons, sélection)', async () => {
  repartir();
  const { page, panel, txt } = await vueBranchee();
  const r = (cle, v) => SZH_remplir(txt[cle], v);
  assert.strictEqual(onglet(page, 'recherche').title, r('propOngletTipAUn', [1]));
  assert.strictEqual(onglet(page, 'intervention').title, r('propOngletTipPlus', [4, 1]));
  onglet(page, 'recherche').click();
  assert.ok(panel.textContent.indexOf(r('propMoissonUn', [T('doc.prop.moissonneur.recherche'), '01.10.2026', '', 1]).split(',')[1].trim()) !== -1,
    'la ligne d’état d’un moissonneur à une proposition doit être au singulier');
  onglet(page, 'intervention').click();
  assert.ok(panel.textContent.indexOf(r('propMoissonPlus', ['x', 'y', 'z', 5]).split(',')[1].trim()) !== -1);
  const cocher = (id) => { const c = ligne(panel, id).querySelector('.prop-case'); c.checked = true; c.dispatchEvent({ type: 'click' }); };
  cocher('GE-1');
  assert.strictEqual(panel.querySelector('.prop-selbar-compte').textContent, r('propSelectionUn', [1]));
  cocher('NE-1');
  assert.strictEqual(panel.querySelector('.prop-selbar-compte').textContent, r('propSelectionPlus', [2]));
  assert.ok(!/1 propositions/.test(panel.textContent));
});
function SZH_remplir(t, v) { let x = String(t); (v || []).forEach((y, i) => { x = x.split('{' + i + '}').join(String(y)); }); return x; }

test('page : une clé de « brut » qui nomme un champ du contrat s’affiche par son libellé', async () => {
  repartir();
  const { page, panel } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'VD-1').querySelector('.prop-bouton-verifier').click();
  const dts = panel.querySelector('.prop-detail .prop-brut-bloc').querySelectorAll('dt').map((d) => d.textContent);
  const libelleDate = kirby.champDuType('intervention', 'date').libelle.fr;
  assert.ok(dts.includes(libelleDate), 'la clé « date » devait se lire « ' + libelleDate + ' » : ' + dts.join(', '));
  assert.ok(!dts.includes('date'));
});

test('libellés : « Vorschlag » est réservé aux suggestions, les objets moissonnés disent « Treffer »', () => {
  const { TEXTES_COCKPIT } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  const cles = Object.keys(TEXTES_COCKPIT.de).filter((k) => /^doc.prop.|^arbre.actualite.propositions/.test(k));
  assert.ok(cles.length > 100, 'trop peu de clés relevées : ' + cles.length);
  const fautives = cles.filter((k) => /Vorschlag|Vorschläge/.test(TEXTES_COCKPIT.de[k]));
  assert.deepStrictEqual(fautives, []);
  assert.strictEqual(TEXTES_COCKPIT.de['doc.prop.vue'], 'Treffer');
  assert.match(TEXTES_COCKPIT.fr['sugg.aide'], /^Une suggestion ne remplace rien/);
});

// ---- Le formulaire du détail ------------------------------------------------------------------

test('hôte : PROP_VERIFIER répond par bloquants(), compte tenu des valeurs et des champs touchés', async () => {
  repartir();
  const p = await panneau();
  const verifier = async (valeurs, touches) => {
    p.messages.length = 0;
    await p._recepteur({ type: MSG.PROP_VERIFIER, cle: cle('VD-1'), jeton: 4, valeurs: valeurs, touches: touches });
    const r = derniere(p, MSG.PROP_VERIFIE);
    assert.ok(r, 'aucune réponse PROP_VERIFIE');
    assert.strictEqual(r.cle, cle('VD-1'));
    assert.strictEqual(r.jeton, 4);
    return r.bloquants;
  };
  const v = LOT.find((x) => x.cle === cle('VD-1')).valeurs;
  assert.deepStrictEqual(await verifier(v, []), [{ code: 'doute-non-touche', champ: 'date' }]);
  assert.deepStrictEqual(await verifier(Object.assign({}, v, { date: '4 mars' }), ['date']), [{ code: 'date-hors-format', champ: 'date' }]);
  assert.deepStrictEqual(await verifier(Object.assign({}, v, { date: '2026-03-05' }), ['date']), []);
});

test('hôte : à l’acceptation depuis le détail, bloquants() est rappelé et refuse ce qui bloque', async () => {
  repartir();
  const p = await panneau();
  const v = Object.assign({}, LOT.find((x) => x.cle === cle('VD-1')).valeurs, { date: '2026-03-05' });
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, depuisDetail: true,
    demandes: [{ cle: cle('VD-1'), valeurs: v, touches: [] }] });
  assert.deepStrictEqual(derniere(p, MSG.PROP_DONNEES).resultat.ignorees, [{ cle: cle('VD-1'), raison: 'a-verifier' }]);
  assert.strictEqual(pr.lireDecision(RACINE_ARBRE, cle('VD-1')), null);
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, depuisDetail: true,
    demandes: [{ cle: cle('VD-1'), valeurs: v, touches: ['date'] }] });
  const f = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).find((x) => x.valeurs.title === 'Date douteuse');
  assert.ok(f, 'la fiche n’est pas créée');
  assert.strictEqual(f.valeurs.date, '2026-03-05');
});

// La création de fiche échoue, une fois : l'acceptation laisse sa décision (raison fiche-introuvable).
function creationEnEchec() {
  const origine = kirby.creerFiche;
  kirby.creerFiche = function () { kirby.creerFiche = origine; throw new Error('disque plein'); };
  return () => { kirby.creerFiche = origine; };
}

test('hôte : une création échouée se dit dans le résultat, et PROP_RECREER recrée avec l’Uuid de la décision', async () => {
  repartir();
  const p = await panneau();
  const remettre = creationEnEchec();
  try {
    await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('GE-1') }] });
  } finally { remettre(); }
  const d = derniere(p, MSG.PROP_DONNEES);
  assert.deepStrictEqual(d.resultat.echecs, [{ cle: cle('GE-1'), raison: 'fiche-introuvable' }]);
  assert.strictEqual(d.introuvables, undefined, 'la vue ne liste plus d’introuvables');
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('GE-1')).fiche;
  const v = Object.assign({}, LOT.find((x) => x.cle === cle('GE-1')).valeurs, { title: 'Alpha recréée' });
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_RECREER, cle: cle('GE-1'), valeurs: v });
  const r = derniere(p, MSG.PROP_DONNEES);
  assert.strictEqual(r.resultat.geste, 'recree');
  assert.deepStrictEqual(r.resultat.faites, [cle('GE-1')]);
  const f = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).find((x) => x.uuid === uuid);
  assert.ok(f && f.valeurs.title === 'Alpha recréée', 'fiche absente ou sans la saisie');
  assert.ok(p.messages.some((m) => m.type === MSG.CHARGER), 'la Documentation du numéro doit se recharger');
  await p._recepteur({ type: MSG.PROP_RECREER, cle: cle('GE-1'), valeurs: v });
  assert.deepStrictEqual(derniere(p, MSG.PROP_DONNEES).resultat.echecs, [{ cle: cle('GE-1'), raison: 'fiche-presente' }]);
});

function detail(panel) { const d = panel.querySelector('.prop-detail'); assert.ok(d, 'détail absent'); return d; }
function champDetail(panel, cleChamp) {
  const c = detail(panel).querySelector('[data-champ="' + cleChamp + '"]');
  assert.ok(c, 'champ absent du formulaire : ' + cleChamp);
  return c;
}
function formeDate(page, valeur, forme) {
  const m = envoyes(page, MSG.DOC_DATE_FORMER).filter((x) => x.valeurs[x.valeurs.length - 1] === valeur).pop();
  assert.ok(m, 'aucune demande de forme pour ' + valeur);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: m.jeton, ok: true, forme: forme });
}

test('page : le détail porte les champs du contrat, préremplis ; un champ en doute est marqué, lu à côté, Appliquer à la forme imprimée', async () => {
  repartir();
  const { page, panel, txt } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'VD-1').querySelector('.prop-bouton-verifier').click();
  const det = detail(panel);
  assert.strictEqual(champDetail(panel, 'title').querySelector('input').value, 'Date douteuse');
  assert.strictEqual(champDetail(panel, 'canton').querySelector('select').value, 'VD');
  const date = champDetail(panel, 'date');
  assert.ok(date.classList.contains('prop-champ--doute'), 'le champ en doute n’est pas marqué');
  assert.ok(date.textContent.indexOf(txt.propDouteLu.replace('{0}', '4 mars')) !== -1, 'la valeur lue manque à côté du champ');
  assert.ok(date.textContent.indexOf(txt.propDouteDateIllisible) !== -1, 'le texte du doute manque');
  assert.strictEqual(champDetail(panel, 'canton').classList.contains('prop-champ--doute'), false);
  const appliquer = date.querySelector('.prop-appliquer');
  assert.ok(appliquer, 'bouton Appliquer absent');
  formeDate(page, '2026-03-04', '04.03.2026');
  assert.strictEqual(appliquer.textContent, txt.propAppliquer.replace('{0}', '04.03.2026'));
  assert.ok(det.querySelector('.prop-doutes').textContent.indexOf(txt.propDouteSuggestion.replace('{0}', '04.03.2026')) !== -1,
    'la liste des doutes doit montrer la forme imprimée');
  // Rien ne s'écrit avant le geste.
  assert.strictEqual(envoyes(page, MSG.ENREGISTRER).length, 0);
});

test('page : Appliquer pose l’ISO et touche le champ ; l’hôte débloque Accepter, qui envoie la saisie', async () => {
  repartir();
  const { page, panel, p } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'VD-1').querySelector('.prop-bouton-verifier').click();
  assert.strictEqual(detail(panel).querySelector('.prop-detail-accepter').disabled, true);
  page.messages.length = 0;
  champDetail(panel, 'date').querySelector('.prop-appliquer').click();
  assert.strictEqual(champDetail(panel, 'date').querySelector('input').value, '2026-03-04');
  const v = envoyes(page, MSG.PROP_VERIFIER).pop();
  assert.ok(v, 'la page doit demander bloquants() à l’hôte');
  assert.deepStrictEqual(v.touches, ['date']);
  assert.strictEqual(v.valeurs.date, '2026-03-04');
  assert.strictEqual(detail(panel).querySelector('.prop-detail-accepter').disabled, true, 'la page ne décide pas seule');
  await relayer(page, p);
  const acc = detail(panel).querySelector('.prop-detail-accepter');
  assert.strictEqual(acc.disabled, false);
  assert.strictEqual(detail(panel).querySelector('.prop-bloque'), null, '« Vérifiez d’abord » doit disparaitre');
  acc.click();
  const m = envoyes(page, MSG.PROP_ACCEPTER).pop();
  assert.strictEqual(m.depuisDetail, true);
  assert.strictEqual(m.demandes[0].valeurs.date, '2026-03-04');
  assert.deepStrictEqual(m.demandes[0].touches, ['date']);
  await relayer(page, p);
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('VD-1')).fiche;
  const f = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).find((x) => x.uuid === uuid);
  assert.strictEqual(f.valeurs.date, '2026-03-04');
});

test('page : une saisie touche le champ ; une date hors format garde Accepter grisé, avec sa raison', async () => {
  repartir();
  const { page, panel, p, txt } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'VD-1').querySelector('.prop-bouton-verifier').click();
  const input = champDetail(panel, 'date').querySelector('input');
  input.type = 'text';
  input.value = '4 mars';
  input.dispatchEvent({ type: 'input' });
  input.dispatchEvent({ type: 'focusout', bubbles: true });
  const v = envoyes(page, MSG.PROP_VERIFIER).pop();
  assert.deepStrictEqual(v.touches, ['date']);
  await relayer(page, p);
  const acc = detail(panel).querySelector('.prop-detail-accepter');
  assert.strictEqual(acc.disabled, true);
  assert.strictEqual(acc.title, txt.propBloque.replace('{0}', 'Date'));
  input.type = 'date';
  input.value = '2026-03-05';
  input.dispatchEvent({ type: 'input' });
  input.dispatchEvent({ type: 'focusout', bubbles: true });
  await relayer(page, p);
  assert.strictEqual(detail(panel).querySelector('.prop-detail-accepter').disabled, false);
  // Le champ reste marqué : le doute se lit jusqu'au geste.
  assert.ok(champDetail(panel, 'date').classList.contains('prop-champ--doute'));
});

test('page : la saisie du détail survit à un rendu de la vue', async () => {
  repartir();
  const { page, panel } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'VD-1').querySelector('.prop-bouton-verifier').click();
  const t = champDetail(panel, 'title').querySelector('input');
  t.value = 'Titre retouché';
  t.dispatchEvent({ type: 'input' });
  page.redimensionner(800);
  page.redimensionner(1400);
  assert.strictEqual(champDetail(panel, 'title').querySelector('input').value, 'Titre retouché');
});

test('page : une création échouée offre « Recréer la fiche », dans le pied et le détail, avec la saisie', async () => {
  repartir();
  const { page, panel, p, txt } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'GE-1').querySelector('.prop-titre').click();
  const t = champDetail(panel, 'title').querySelector('input');
  t.value = 'Alpha corrigée';
  t.dispatchEvent({ type: 'input' });
  await relayer(page, p);
  detail(panel).querySelector('.prop-detail-accepter').click();
  const remettre = creationEnEchec();
  try { await relayer(page, p); } finally { remettre(); }
  const offre = panel.querySelector('.prop-pied .prop-echouee');
  assert.ok(offre, 'le pied doit offrir de recréer');
  assert.ok(offre.textContent.indexOf(txt.propIntrouvable.replace('{0}', 'Alpha genevois')) !== -1, offre.textContent);
  assert.ok(lignes(panel).every((tr) => tr.dataset.cle !== cle('GE-1')), 'une acceptée ne revient pas dans la liste');
  const det = detail(panel);
  assert.strictEqual(det.querySelector('.prop-detail-accepter'), null, 'on n’accepte pas deux fois');
  assert.strictEqual(champDetail(panel, 'title').querySelector('input').value, 'Alpha corrigée', 'la saisie reste');
  page.messages.length = 0;
  det.querySelector('.prop-recreer').click();
  const m = envoyes(page, MSG.PROP_RECREER).pop();
  assert.ok(m, 'PROP_RECREER absent');
  assert.strictEqual(m.valeurs.title, 'Alpha corrigée');
  await relayer(page, p);
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('GE-1')).fiche;
  assert.ok(kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).some((x) => x.uuid === uuid && x.valeurs.title === 'Alpha corrigée'));
  assert.strictEqual(panel.querySelector('.prop-echouee'), null, 'l’offre part avec la recréation');
  assert.ok(panel.querySelector('.prop-bandeau'), 'le bandeau dit le geste');
});

test('page : une acceptation échouée en lot s’offre aussi à recréer, avec les valeurs de la proposition', async () => {
  repartir();
  const { page, panel, p } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'NE-1').querySelector('.prop-bouton-accepter').click();
  const remettre = creationEnEchec();
  try { await relayer(page, p); } finally { remettre(); }
  assert.strictEqual(panel.querySelector('.prop-detail'), null);
  panel.querySelector('.prop-pied .prop-recreer').click();
  const m = envoyes(page, MSG.PROP_RECREER).pop();
  assert.strictEqual(m.valeurs.title, 'Bêta neuchâtelois');
});

test('page : une fiche acceptée puis supprimée dans la Documentation ne revient pas dans la vue', async () => {
  repartir();
  const pr0 = await panneau();
  await pr0._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('GE-1') }] });
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('GE-1')).fiche;
  const f = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).find((x) => x.uuid === uuid);
  assert.ok(kirby.supprimerFicheLangue(RACINE_ARBRE, f.slug, 'fr').ok, 'suppression impossible');
  const { page, panel } = await vueBranchee();
  onglet(page, 'intervention').click();
  assert.ok(lignes(panel).every((tr) => tr.dataset.cle !== cle('GE-1')), 'la supprimée revient dans la liste');
  assert.strictEqual(panel.querySelector('.prop-recreer'), null, 'aucune offre de recréation');
  assert.strictEqual(panel.querySelector('.prop-echouee'), null);
});

test('page : le champ couverture n’est pas dans le formulaire, une ligne dit de l’ajouter après acceptation', async () => {
  repartir();
  ecrireLot('2026-10-02-1.jsonl', [proposition('livre', 'L-1', { categorie: 'manuel', title: 'Un livre', auteurs: 'A',
    annee: '2026', editeur: 'E', descriptif: 'D' })], 'isbn');
  const { page, panel, txt } = await vueBranchee();
  onglet(page, 'livre').click();
  ligne(panel, 'L-1').querySelector('.prop-titre').click();
  assert.strictEqual(detail(panel).querySelector('[data-champ="couverture"]'), null);
  assert.ok(detail(panel).textContent.indexOf(txt.propCouverture) !== -1);
});

test('page : dans le détail, la date d’une ligne de suivi montre aussi sa forme imprimée', async () => {
  repartir();
  ecrireLot('2026-10-02-1.jsonl', [intervention('SU-1', 'GE', 'Avec un suivi',
    { valeurs: { title: 'Avec un suivi', canton: 'GE', categorie: 'motion', numero: 'M 7', date: '2026-03-04',
      source: 'openparldata', suivi: [{ date: '2026-05-02', genre: '', libelle: 'Réponse', lien: '' }] } })]);
  const { page, panel, txt } = await vueBranchee();
  onglet(page, 'intervention').click();
  ligne(panel, 'SU-1').querySelector('.prop-titre').click();
  const date = champDetail(panel, 'suivi').querySelectorAll('input').find((e) => e.id.indexOf('sc-suivi-date-') === 0);
  assert.ok(date, 'date de suivi absente du formulaire');
  page.messages.length = 0;
  date.dispatchEvent({ type: 'blur' });
  formeDate(page, '2026-05-02', '02.05.2026');
  assert.strictEqual(date.parent.querySelector('.doc-date-forme').textContent, txt.dateImprime.replace('{0}', '02.05.2026'));
});
