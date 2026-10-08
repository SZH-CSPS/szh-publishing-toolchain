// « Tirer dans ce numéro » et « Traduire dans ce numéro » rechargent la Documentation : une
// carte modifiée est d'abord enregistrée, et le geste part seulement après l'accusé.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

activerHote(revueDEssai());
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));

const LIVRE = { id: 'UuidCarteLivre01', type: 'livre', apercu: null, valeurs: {
  categorie: 'manuel', title: 'Titre enregistré', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: '' } };

function page() {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const p = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js'], txt: txt
  });
  p.envoyer({
    type: MSG.CHARGER, slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: doc._libelles.typesRessourceConfig('fr'), typesRubrique: [],
    rubriques: [], ressources: [LIVRE],
    orphelines: [{ slug: 'orph', uuid: 'u-orph', type: 'livre', typeLibelle: 'Livres', titre: 'Orpheline' }],
    traductions: [{ slug: 'trad', uuid: 'u-trad', type: 'livre', typeLibelle: 'Livres', titre: 'À traduire' }],
    vueInitiale: { onglet: 'numero', categorie: 'livre' }
  });
  return { p: p, txt: txt };
}
function modifierTitre(p) {
  const i = p.document.querySelectorAll('input').find((e) => e.id.indexOf('ch-title-') === 0);
  assert.ok(i, 'champ du titre absent');
  i.value = 'Titre modifié, non enregistré';
  i.dispatchEvent({ type: 'input' });
}
function cliquer(p, libelle) {
  const b = p.document.querySelectorAll('button').find((x) => x.textContent === libelle);
  assert.ok(b, 'bouton absent : ' + libelle);
  b.click();
}
// L'avis MODIFIE à l'hôte accompagne chaque changement d'état : il ne compte pas ici.
function gestes(p) { return JSON.parse(JSON.stringify(p.messages.filter((m) => m.type !== MSG.MODIFIE))); }
function types(p) { return gestes(p).map((m) => m.type); }

for (const cas of [
  { nom: 'Tirer dans ce numéro', libelle: 'tirerDansNumero', type: MSG.TIRER_DANS_NUMERO, slug: 'orph' },
  { nom: 'Traduire dans ce numéro', libelle: 'traduireDansNumero', type: MSG.TRADUIRE_DANS_NUMERO, slug: 'trad' }
]) {
  test('« ' + cas.nom + ' » sans modification : le geste part aussitôt', () => {
    const { p, txt } = page();
    p.messages.length = 0;
    cliquer(p, txt[cas.libelle]);
    assert.deepStrictEqual(gestes(p), [{ type: cas.type, slug: cas.slug }]);
  });

  test('« ' + cas.nom + ' » avec une carte modifiée : enregistrer d’abord, le geste après l’accusé', () => {
    const { p, txt } = page();
    modifierTitre(p);
    p.messages.length = 0;
    cliquer(p, txt[cas.libelle]);
    assert.deepStrictEqual(types(p), [MSG.ENREGISTRER], 'la carte part avant le geste');
    const envoi = p.messages.find((m) => m.type === MSG.ENREGISTRER);
    assert.strictEqual(envoi.ressources.find((r) => r.id === LIVRE.id).valeurs.title, 'Titre modifié, non enregistré');
    p.messages.length = 0;
    p.envoyer({ type: MSG.ENREGISTRE, auto: true, correspondances: [] });
    assert.deepStrictEqual(gestes(p), [{ type: cas.type, slug: cas.slug }]);
  });

  test('« ' + cas.nom + ' » : un enregistrement refusé annule le geste', () => {
    const { p, txt } = page();
    modifierTitre(p);
    cliquer(p, txt[cas.libelle]);
    p.messages.length = 0;
    p.envoyer({ type: MSG.ERREUR, message: 'refusé' });
    p.envoyer({ type: MSG.ENREGISTRE, auto: true, correspondances: [] });
    assert.ok(!types(p).includes(cas.type), 'le geste ne doit pas partir après une erreur');
  });
}
