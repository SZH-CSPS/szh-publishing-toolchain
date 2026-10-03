// Les propositions multilingues dans la vue « Propositions » : une affaire fédérale visible des
// deux rédactions, la coche de l'autre revue, le titre officiel repris à la traduction, et
// l'annulation qui garde une fiche déjà dans un numéro. Lots synthétiques (docs/FORMAT-PROPOSITIONS.md).
//
//   node --test test/js/propositions-multilingues.test.js
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

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
const RACINE_ARBRE = kirby.racineArbre(REVUE);

function intervention(id, canton, extra) {
  return Object.assign({
    format: 'pronto-proposition/1', cle: 'parlement:source-exemple:' + id, moissonneur: 'parlement',
    type: 'intervention', recolte: '2026-10-02T14:12:00Z', lien_source: 'https://parlement.exemple.ch/objet/' + id,
    valeurs: { canton: canton, categorie: 'motion', numero: id, date: '2026-03-04', lien: 'https://parlement.exemple.ch/objet/' + id, source: 'openparldata' },
    doutes: [], brut: {}, pertinence: { verdict: 'retenu', raison: 'ancrage' }, doublon: null
  }, extra || {});
}
// Fédérale et bernoise : les deux langues, les titres officiels ; une genevoise, monolingue.
const CH = intervention('CH-1', 'CH', { langues: ['fr', 'de'],
  titres: { fr: 'Motion fédérale sur l’école', de: 'Bundesmotion zur Schule', it: 'Mozione federale sulla scuola' } });
const BE = intervention('BE-1', 'BE', { langues: ['fr', 'de'], titres: { fr: 'Motion bernoise', de: 'Berner Motion' } });
const GE = intervention('GE-1', 'GE', { langue: 'fr', valeurs: Object.assign({}, intervention('x', 'GE').valeurs, { title: 'Motion genevoise' }) });
function cle(id) { return 'parlement:source-exemple:' + id; }

function repartir(lignes) {
  fs.rmSync(pr.cheminMoissons(RACINE_ARBRE), { recursive: true, force: true });
  fs.rmSync(kirby.cheminBibliotheque(RACINE_ARBRE), { recursive: true, force: true });
  const dossier = path.join(pr.cheminMoissons(RACINE_ARBRE), 'parlement');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, '2026-10-01-1.jsonl'), (lignes || [CH, BE, GE]).map((l) => JSON.stringify(l)).join('\n') + '\n');
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

test('hôte : la proposition multilingue a son titre de la langue ; « + de » d’office pour CH seulement, pas pour BE', async () => {
  repartir();
  const d = await donnees(await panneau());
  const par = {};
  d.propositions.forEach((x) => { par[x.cle] = x; });
  assert.strictEqual(par[cle('CH-1')].valeurs.title, 'Motion fédérale sur l’école');
  assert.deepStrictEqual(par[cle('CH-1')].langues, ['fr', 'de']);
  assert.strictEqual(par[cle('CH-1')].titres.it, 'Mozione federale sulla scuola');
  assert.strictEqual(par[cle('CH-1')].aussi, true);
  assert.strictEqual(par[cle('BE-1')].aussi, false, 'canton bilingue : la coche reste décochée');
  assert.deepStrictEqual(par[cle('GE-1')].langues, ['fr']);
});

test('hôte : acceptée dans la Revue avec la coche, la fiche allemande nait orpheline avec son titre officiel', async () => {
  repartir();
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('CH-1'), aussi: true }] });
  assert.deepStrictEqual(derniere(p, MSG.PROP_DONNEES).resultat.faites, [cle('CH-1')]);
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('CH-1')).fiche;
  const slug = kirby.trouverSlugParUuid(RACINE_ARBRE, 'fr', uuid);
  assert.strictEqual(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr', 'intervention').ausgabe, yaml.idNumero(REVUE));
  const de = kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'de', 'intervention');
  assert.strictEqual(de.uuid, uuid);
  assert.strictEqual(de.valeurs.title, 'Bundesmotion zur Schule');
  assert.strictEqual(de.ausgabe, '');
});

test('hôte : « Traduire dans ce numéro » préremplit le titre par le titre officiel gardé dans la décision', async () => {
  // Acceptée dans la Zeitschrift avec un descriptif à traduire : la Revue reçoit « à traduire ».
  const avecTexte = Object.assign({}, CH, { valeurs: Object.assign({}, CH.valeurs, { descriptif: 'Ein Text.' }) });
  repartir([avecTexte]);
  const r = pr.accepterLot(RACINE_ARBRE, 'de', [{ cle: cle('CH-1'), aussi: true }], { ausgabeId: '' });
  assert.deepStrictEqual(r.faites, [cle('CH-1')]);
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('CH-1')).fiche;
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuid).statut, 'a-traduire');
  const slug = kirby.trouverSlugParUuid(RACINE_ARBRE, 'de', uuid);
  const p = await panneau();
  await p._recepteur({ type: MSG.TRADUIRE_DANS_NUMERO, slug: slug });
  const fr = kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr', 'intervention');
  assert.ok(fr, 'le fichier français n’a pas été créé');
  assert.strictEqual(fr.valeurs.title, 'Motion fédérale sur l’école');
  assert.strictEqual(fr.valeurs.descriptif, 'Ein Text.', 'le reste est repris tel quel, à traduire');
  assert.strictEqual(fr.ausgabe, yaml.idNumero(REVUE));
});

test('hôte : annuler une acceptation dont l’autre langue est déjà dans un numéro garde ce fichier, et le résultat le dit', async () => {
  repartir();
  const p = await panneau();
  await p._recepteur({ type: MSG.PROP_ACCEPTER, dansNumero: true, demandes: [{ cle: cle('CH-1'), aussi: true }] });
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('CH-1')).fiche;
  const slug = kirby.trouverSlugParUuid(RACINE_ARBRE, 'fr', uuid);
  kirby.tirerDansNumero(RACINE_ARBRE, slug, 'de', 'IdZeitschrift0001');
  p.messages.length = 0;
  await p._recepteur({ type: MSG.PROP_ANNULER, cles: [cle('CH-1')] });
  const d = derniere(p, MSG.PROP_DONNEES);
  assert.deepStrictEqual(d.resultat.faites, [cle('CH-1')]);
  assert.strictEqual(d.resultat.autresGardees, 1);
  assert.strictEqual(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr', 'intervention'), null);
  assert.ok(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'de', 'intervention'));
});

// ---- La page --------------------------------------------------------------------------------

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
      if (r.type === MSG.PROP_DONNEES || r.type === MSG.PROP_VERIFIE) { page.envoyer(JSON.parse(JSON.stringify(r))); }
    }
  }
}
async function vue() {
  const p = await panneau();
  const { page, txt } = pageDocumentation();
  await relayer(page, p);
  return { page: page, txt: txt, p: p, panel: page.parId['panel-propositions'] };
}
function ligne(panel, id) { return panel.querySelectorAll('tr').find((tr) => tr.dataset.cle === cle(id)); }

test('page : la marque « fr · de » sur la ligne d’une proposition des deux rédactions, en texte et avec son aria-label', async () => {
  repartir();
  const { panel, txt } = await vue();
  const m = ligne(panel, 'CH-1').querySelector('.prop-langues');
  assert.ok(m, 'marque absente');
  assert.strictEqual(m.textContent, 'fr · de');
  assert.strictEqual(m.getAttribute('aria-label'), txt.propLanguesTip.replace('{0}', 'fr, de'));
  assert.strictEqual(m.title, m.getAttribute('aria-label'));
  assert.strictEqual(ligne(panel, 'GE-1').querySelector('.prop-langues'), null);
  assert.strictEqual(ligne(panel, 'CH-1').querySelector('.prop-titre').textContent, 'Motion fédérale sur l’école');
});

test('page : les titres officiels, it compris, dans les valeurs lues du détail', async () => {
  repartir();
  const { panel, txt } = await vue();
  ligne(panel, 'CH-1').querySelector('.prop-titre').click();
  const dl = panel.querySelector('.prop-detail .prop-brut-bloc');
  const dts = dl.querySelectorAll('dt').map((x) => x.textContent);
  const dds = dl.querySelectorAll('dd').map((x) => x.textContent);
  for (const [l, t] of [['fr', 'Motion fédérale sur l’école'], ['de', 'Bundesmotion zur Schule'], ['it', 'Mozione federale sulla scuola']]) {
    const i = dts.indexOf(txt.propTitreOfficiel.replace('{0}', l));
    assert.ok(i !== -1, 'titre officiel absent : ' + l);
    assert.strictEqual(dds[i], t);
  }
  const it = dl.querySelectorAll('dd').find((x) => x.textContent === 'Mozione federale sulla scuola');
  assert.strictEqual(it.getAttribute('lang'), 'it');
});

test('page : une annulation qui garde l’autre langue le dit dans la vue', async () => {
  repartir();
  const { page, panel, p, txt } = await vue();
  ligne(panel, 'CH-1').querySelector('.prop-bouton-accepter').click();
  await relayer(page, p);
  const uuid = pr.lireDecision(RACINE_ARBRE, cle('CH-1')).fiche;
  kirby.tirerDansNumero(RACINE_ARBRE, kirby.trouverSlugParUuid(RACINE_ARBRE, 'fr', uuid), 'de', 'IdZeitschrift0001');
  panel.querySelector('.prop-bouton-annuler').click();
  await relayer(page, p);
  assert.ok(panel.textContent.indexOf(txt.propAutreGardee) !== -1, 'le message manque');
});
