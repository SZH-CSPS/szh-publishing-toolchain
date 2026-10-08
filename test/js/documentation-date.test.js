// L'aperçu de la date imprimée sous un champ de date de la Documentation : la page demande
// la forme à l'hôte (MSG.DOC_DATE_FORMER), qui la calcule par lib/date-apercu.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
// Après activerHote(), qui fournit le faux « vscode » à documentation-hote.js.
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
const dateApercu = require(path.join(COCKPIT, 'lib', 'date-apercu.js'));
const { langueRevue } = require(path.join(COCKPIT, 'lib', 'yaml.js'));

// ---- Côté hôte ----------------------------------------------------------------------

test('hôte : DOC_DATE_FORMER reçoit DOC_DATE_FORMEE, même jeton, dans la langue du numéro', async (t) => {
  const recus = [];
  const origine = dateApercu.former;
  dateApercu.former = async (d) => { recus.push(d); return { ok: true, forme: '05.01.2026' }; };
  t.after(() => { dateApercu.former = origine; });
  await HOTE.arbre().getChildren();
  await HOTE.executer('szh.ouvrirSection', 'actualite');
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  assert.ok(p, 'panneau de Documentation absent');
  await p._recepteur({ type: 'pret' });
  p.messages.length = 0;
  await p._recepteur({ type: MSG.DOC_DATE_FORMER, jeton: 7, saisie: 'date', valeurs: ['2026-01-05'] });
  assert.deepStrictEqual(recus, [{ saisie: 'date', lang: langueRevue(REVUE), valeurs: ['2026-01-05'] }]);
  const r = p.messages.filter((m) => m.type === MSG.DOC_DATE_FORMEE);
  assert.deepStrictEqual(r, [{ type: MSG.DOC_DATE_FORMEE, jeton: 7, ok: true, forme: '05.01.2026' }]);
});

test('hôte : la plage de l’agenda est transmise à la page', () => {
  const agenda = doc._libelles.typesRessourceConfig('fr').find((x) => x.valeur === 'agenda');
  assert.deepStrictEqual(agenda.plage, ['debut', 'fin']);
  const livre = doc._libelles.typesRessourceConfig('fr').find((x) => x.valeur === 'livre');
  assert.strictEqual(livre.plage, null);
});

// ---- Côté page ----------------------------------------------------------------------

// Les minuteurs du DOM minimal ne se déclenchent pas : une frappe seule ne produit aucun
// message, ce qui montre qu'elle attend.
function pageAvecFiches(ressources) {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const page = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js'], txt: txt
  });
  page.envoyer({
    type: 'charger', slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: doc._libelles.typesRessourceConfig('fr'), typesRubrique: [],
    rubriques: [], ressources: ressources, vueInitiale: { onglet: 'numero', categorie: 'agenda' }
  });
  return { page: page, txt: txt };
}
function champ(page, cle) {
  const i = page.document.querySelectorAll('input').find((e) => e.id.indexOf('ch-' + cle + '-') === 0);
  assert.ok(i, 'champ absent : ' + cle);
  return i;
}
function demandes(page) { return page.messages.filter((m) => m.type === MSG.DOC_DATE_FORMER); }
function ligneSous(input) { return input.parent.querySelector('.doc-date-forme'); }
const AGENDA = { id: 'a1', type: 'agenda', apercu: null, valeurs: {
  evenement: '', title: 'Journée', debut: '2026-06-29', fin: '2026-07-02', lieu: '', organisateur: '', lien: '', descriptif: '' } };

test('page : une frappe n’envoie rien, la sortie du champ envoie aussitôt une plage', () => {
  const { page } = pageAvecFiches([AGENDA]);
  const debut = champ(page, 'debut');
  debut.value = '2026-06-30';
  debut.dispatchEvent({ type: 'input' });
  debut.dispatchEvent({ type: 'input' });
  assert.strictEqual(demandes(page).length, 0, 'jamais un message par frappe');
  debut.dispatchEvent({ type: 'blur' });
  const d = demandes(page);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].saisie, 'plage');
  assert.deepStrictEqual([...d[0].valeurs], ['2026-06-30', '2026-07-02']);
});

test('page : la forme de la plage s’affiche sous la fin, et une vieille réponse est ignorée', () => {
  const { page, txt } = pageAvecFiches([AGENDA]);
  const debut = champ(page, 'debut');
  const fin = champ(page, 'fin');
  debut.dispatchEvent({ type: 'blur' });
  fin.dispatchEvent({ type: 'blur' });
  const [vieux, recent] = demandes(page);
  assert.notStrictEqual(vieux.jeton, recent.jeton);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: recent.jeton, ok: true, forme: '29.06.–02.07.2026' });
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: vieux.jeton, ok: true, forme: 'PERIME' });
  const attendu = txt.dateImprime.replace('{0}', '29.06.–02.07.2026');
  assert.strictEqual(ligneSous(fin).textContent, attendu);
  assert.strictEqual(ligneSous(debut).textContent, '', 'sous le début : rien, la fin est remplie');
});

test('page : sans fin, la plage s’affiche sous le début', () => {
  const { page, txt } = pageAvecFiches([Object.assign({}, AGENDA,
    { valeurs: Object.assign({}, AGENDA.valeurs, { fin: '' }) })]);
  const debut = champ(page, 'debut');
  debut.dispatchEvent({ type: 'blur' });
  const [d] = demandes(page);
  assert.deepStrictEqual([...d.valeurs], ['2026-06-29', '']);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: d.jeton, ok: true, forme: '29.06.2026' });
  assert.strictEqual(ligneSous(debut).textContent, txt.dateImprime.replace('{0}', '29.06.2026'));
  assert.strictEqual(ligneSous(champ(page, 'fin')).textContent, '');
});

test('page : « indisponible » se dit, et le champ reste éditable', () => {
  const { page, txt } = pageAvecFiches([AGENDA]);
  const fin = champ(page, 'fin');
  fin.dispatchEvent({ type: 'blur' });
  const [d] = demandes(page);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: d.jeton, indisponible: true });
  assert.strictEqual(ligneSous(fin).textContent, txt.dateIndisponible);
  assert.strictEqual(fin.disabled, false);
  assert.strictEqual(fin.readOnly, false);
});

test('page : une date impossible se signale, et l’enregistrement part quand même', () => {
  const { page, txt } = pageAvecFiches([AGENDA]);
  const debut = champ(page, 'debut');
  debut.value = '2026-02-30';
  debut.dispatchEvent({ type: 'input' });
  debut.dispatchEvent({ type: 'blur' });
  const [d] = demandes(page);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: d.jeton, ok: true, erreur: 'impossible', forme: '30.02.–02.07.2026' });
  const ligne = ligneSous(champ(page, 'fin'));
  assert.ok(ligne.classList.contains('doc-date-forme--erreur'), 'classe d’attention absente');
  assert.ok(ligne.textContent.includes(txt.dateErreurImpossible.replace('{0}', '30.02.–02.07.2026')), ligne.textContent);
  assert.ok(ligne.querySelector('svg') || ligne.querySelector('.szh-icone') || ligne.enfants.some((e) => e.balise === 'svg'),
    'une icône double la couleur');
  page.parId.barre.querySelector('button').click();
  assert.ok(page.messages.some((m) => m.type === MSG.ENREGISTRER), 'l’enregistrement doit partir');
});

test('page : un champ « date » simple envoie sa saisie, une date à moitié tapée ne demande rien', () => {
  const { page, txt } = pageAvecFiches([{ id: 'i1', type: 'intervention', apercu: null,
    valeurs: { canton: 'CH', categorie: 'motion', numero: '1', date: '2024-06-12', title: 'M', etat: '', etat_date: '' } }]);
  const date = champ(page, 'date');
  date.dispatchEvent({ type: 'blur' });
  const [d] = demandes(page);
  assert.strictEqual(d.saisie, 'date');
  assert.deepStrictEqual([...d.valeurs], ['2024-06-12']);
  date.validity = { badInput: true };
  date.value = '';
  date.dispatchEvent({ type: 'blur' });
  assert.strictEqual(demandes(page).length, 1, 'aucun appel pour une date incomplète');
  assert.strictEqual(ligneSous(date).textContent, txt.dateIncomplete);
});

test('page : un champ vide ne demande rien et vide la ligne', () => {
  const { page } = pageAvecFiches([{ id: 'i1', type: 'intervention', apercu: null,
    valeurs: { canton: 'CH', categorie: 'motion', numero: '1', date: '', title: 'M', etat: '', etat_date: '' } }]);
  const date = champ(page, 'date');
  date.dispatchEvent({ type: 'blur' });
  assert.strictEqual(demandes(page).length, 0);
  assert.strictEqual(ligneSous(date).textContent, '');
});

test('page : une date partielle part en « date_partielle », son modèle suit la langue', () => {
  const { page, txt } = pageAvecFiches([{ id: 'r1', type: 'recherche', apercu: null,
    valeurs: { title: 'R', debut: '2026-03', fin: '' } }]);
  const debut = champ(page, 'debut');
  assert.strictEqual(debut.placeholder, txt.dateModelePartiel);
  debut.dispatchEvent({ type: 'blur' });
  const [d] = demandes(page);
  assert.strictEqual(d.saisie, 'date_partielle');
  assert.deepStrictEqual([...d.valeurs], ['2026-03']);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: d.jeton, ok: true, erreur: 'format', forme: '2026-3' });
  assert.ok(ligneSous(debut).textContent.includes(txt.dateErreurFormatPartiel));
});

// ---- Les dates des lignes de suivi -------------------------------------------------------

const INTERVENTION_SUIVI = { id: 'i2', type: 'intervention', apercu: null, valeurs: {
  canton: 'CH', categorie: 'motion', numero: '1', date: '2024-06-12', title: 'M', etat: '', etat_date: '',
  suivi: [{ date: '2026-06-01', genre: '', libelle: 'Réponse', lien: '' }] } };
function datesSuivi(page) {
  return page.document.querySelectorAll('input').filter((e) => e.id.indexOf('sc-suivi-date-') === 0);
}

test('page : la date d’une ligne de suivi montre sa forme imprimée, à la sortie du champ', () => {
  const { page, txt } = pageAvecFiches([INTERVENTION_SUIVI]);
  const [date] = datesSuivi(page);
  assert.ok(date, 'date de suivi absente');
  date.dispatchEvent({ type: 'input' });
  assert.strictEqual(demandes(page).length, 0, 'jamais un message par frappe');
  date.dispatchEvent({ type: 'blur' });
  const [d] = demandes(page);
  assert.strictEqual(d.saisie, 'date');
  assert.deepStrictEqual([...d.valeurs], ['2026-06-01']);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: d.jeton, ok: true, forme: '01.06.2026' });
  assert.strictEqual(ligneSous(date).textContent, txt.dateImprime.replace('{0}', '01.06.2026'));
});

test('page : une ligne de suivi ajoutée a son propre aperçu, distinct de la ligne voisine', () => {
  const { page, txt } = pageAvecFiches([INTERVENTION_SUIVI]);
  const ajouter = page.document.querySelectorAll('button').find((b) => b.classList.contains('doc-structure-ajouter'));
  ajouter.click();
  const [premiere, neuve] = datesSuivi(page);
  assert.ok(neuve, 'la ligne ajoutée n’a pas de date');
  neuve.value = '2026-07-02';
  neuve.dispatchEvent({ type: 'blur' });
  const [d] = demandes(page);
  assert.deepStrictEqual([...d.valeurs], ['2026-07-02']);
  page.envoyer({ type: MSG.DOC_DATE_FORMEE, jeton: d.jeton, ok: true, erreur: 'impossible', forme: '02.07.2026' });
  assert.ok(ligneSous(neuve).classList.contains('doc-date-forme--erreur'));
  assert.ok(neuve.classList.contains('doc-date-champ--erreur'));
  assert.strictEqual(ligneSous(premiere).textContent, '', 'la ligne voisine reste muette');
  assert.ok(!premiere.classList.contains('doc-date-champ--erreur'));
  assert.ok(txt.dateErreurImpossible);
});
