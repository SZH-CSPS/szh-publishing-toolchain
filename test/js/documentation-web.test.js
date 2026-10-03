// La vue « Publier sur le site web » de la Documentation : une notice « fonctionnalité à
// venir », ouverte depuis l'arbre, qui ne parle jamais à l'hôte.
//
//   node --test test/js/documentation-web.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

test('hôte : szh.ouvrirActualite(« web ») ouvre la Documentation sur la vue « web »', async () => {
  await HOTE.arbre().getChildren();
  await HOTE.executer('szh.ouvrirActualite', 'web');
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  assert.ok(p, 'panneau de Documentation absent');
  await p._recepteur({ type: 'pret' });
  const m = p.messages.find((x) => x.type === 'charger');
  assert.ok(m, 'aucun « charger »');
  assert.strictEqual(m.vueInitiale && m.vueInitiale.onglet, 'web');
});

function pageWeb() {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const page = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js'], txt: txt
  });
  page.envoyer({
    type: 'charger', slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: [], typesRubrique: [], rubriques: [], ressources: [],
    vueInitiale: { onglet: 'web' }
  });
  return { page: page, txt: txt };
}

test('page : la vue « web » seule visible, son titre, la notice et un bouton désactivé', () => {
  const { page } = pageWeb();
  const panel = page.parId['panel-web'];
  assert.strictEqual(panel.hidden, false, '#panel-web doit être visible');
  for (const autre of ['traductions', 'reservoir', 'numero', 'archive']) {
    assert.strictEqual(page.parId['panel-' + autre].hidden, true, 'panneau visible : ' + autre);
  }
  assert.strictEqual(page.parId.barreCategories.hidden, true, 'pas de barre de catégories');
  assert.strictEqual(page.parId.titreVue.textContent, T('doc.web.titre'));
  const notice = panel.querySelector('.szh-notif');
  assert.ok(notice, 'notice absente');
  assert.ok(notice.textContent.includes(T('doc.web.avenir')), 'la notice doit dire « à venir »');
  assert.ok(panel.textContent.includes(T('doc.web.explication')));
  const b = panel.querySelector('button');
  assert.ok(b, 'bouton « Publier » absent');
  assert.strictEqual(b.textContent, T('doc.web.bouton'));
  assert.strictEqual(b.disabled, true);
  assert.strictEqual(b.getAttribute('aria-disabled'), 'true');
  assert.strictEqual(b.title, T('doc.web.bouton.tip'));
});

test('page : cliquer « Publier » ne poste aucun message', () => {
  const { page } = pageWeb();
  const avant = page.messages.length;
  page.parId['panel-web'].querySelector('button').click();
  assert.strictEqual(page.messages.length, avant);
});

test('page : quitter la vue « web » la masque', () => {
  const { page } = pageWeb();
  page.envoyer({ type: MSG.ONGLET_ACTIVER, cle: 'numero', categorie: 'rubriques' });
  assert.strictEqual(page.parId['panel-web'].hidden, true);
  assert.strictEqual(page.parId['panel-numero'].hidden, false);
});
