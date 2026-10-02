// La fiche « D'une revue à l'autre » se préremplit depuis un article de l'autre revue : la
// page demande la liste à l'hôte une fois (MSG.DOC_AUTREREVUE_CHARGER), le choix remplit la
// carte sans rien écrire sur le disque.
//
//   node --test test/js/documentation-autre-revue.test.js
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

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));

// ---- Côté hôte ----------------------------------------------------------------------

test('hôte : DOC_AUTREREVUE_CHARGER rend les articles de la Zeitschrift voisine', async () => {
  // Un numéro de la Zeitschrift à côté de la Revue d'essai, dans la même racine d'arbre.
  const z = path.join(kirby.racineArbre(REVUE), 'Zeitschrift', '2026-01');
  fs.mkdirSync(path.join(z, 'articles', '01-eins'), { recursive: true });
  fs.writeFileSync(path.join(z, 'ausgabe.yaml'),
    'revue: "Schweizerische Zeitschrift für Heilpädagogik"\nlang: de\nnumero: "1"\nvolume: "32"\n');
  fs.writeFileSync(path.join(z, 'articles', '01-eins', '01-eins.md'), 'Text.\n');
  fs.writeFileSync(path.join(z, 'articles', '01-eins', '01-eins.meta.yaml'),
    'type: article\ntitle:\n  de: "Ein Artikel"\nauthor:\n- prenom: "Eva"\n  nom: "Keller"\n');
  await HOTE.arbre().getChildren();
  await HOTE.executer('szh.ouvrirSection', 'actualite');
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  assert.ok(p, 'panneau de Documentation absent');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'charger').pop();
  const reprise = charge.typesConfig.find((t) => t.valeur === 'reprise');
  assert.deepStrictEqual(reprise.preremplissage, { revue: 'Zeitschrift' });
  assert.ok(charge.typesConfig.filter((t) => t.preremplissage).length === 1, 'seule la reprise se préremplit');
  p.messages.length = 0;
  await p._recepteur({ type: MSG.DOC_AUTREREVUE_CHARGER });
  const r = p.messages.filter((m) => m.type === MSG.DOC_AUTREREVUE_DONNEES);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].ok, true);
  assert.strictEqual(r[0].illisibles, 0);
  assert.deepStrictEqual(r[0].numeros.map((n) => n.cle), ['2026-01']);
  assert.strictEqual(r[0].numeros[0].articles[0].valeurs.title, 'Ein Artikel');
  assert.strictEqual(r[0].numeros[0].articles[0].valeurs.revue, 'zeitschrift');
  assert.strictEqual(r[0].numeros[0].articles[0].valeurs.auteurs, 'Eva Keller');
});

// ---- Côté page ----------------------------------------------------------------------

const DONNEES = {
  type: MSG.DOC_AUTREREVUE_DONNEES, ok: true, illisibles: 1,
  numeros: [
    { cle: '2026-01', libelle: 'Z2026-01 | Inklusion', archive: false, articles: [
      { cle: 'a', titreAffiche: 'Ein Artikel', signature: 'Eva Keller', valeurs: {
        revue: 'zeitschrift', title: 'Ein Artikel', auteurs: 'Eva Keller', reference: '2026, 1',
        doi: '10.57161/z2026-01-00', lien: 'https://doi.org/10.57161/z2026-01-00', descriptif: 'Eine Zusammenfassung.' } },
      { cle: 'b', titreAffiche: 'Zweiter Beitrag', signature: 'Max Muster', valeurs: {
        revue: 'zeitschrift', title: 'Zweiter Beitrag', auteurs: 'Max Muster', reference: '2026, 1',
        doi: '10.57161/z2026-01-01', lien: 'https://doi.org/10.57161/z2026-01-01', descriptif: 'Kurz.' } }
    ] },
    { cle: '2025-02', libelle: 'Z2025-02 | Alt', archive: true, articles: [
      { cle: 'c', titreAffiche: 'Älterer Text', signature: 'Ida Alt', valeurs: {
        revue: 'zeitschrift', title: 'Älterer Text', auteurs: 'Ida Alt', reference: '2025, 2',
        doi: '', lien: '', descriptif: '' } }
    ] }
  ]
};

function pageReprise(valeursReprise) {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const typesConfig = doc._libelles.typesRessourceConfig('fr', 'revue');
  const page = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css'],
    jsPartage: ['_messages.js'], txt: txt
  });
  page.envoyer({
    type: 'charger', slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: typesConfig, typesRubrique: [], rubriques: [],
    ressources: [
      { id: 'p1', type: 'reprise', apercu: null, valeurs: valeursReprise || {} },
      { id: 'l1', type: 'livre', apercu: null, valeurs: { title: 'Un livre' } }
    ],
    vueInitiale: { onglet: 'numero', categorie: 'reprise' }
  });
  return { page: page, txt: txt };
}
function boutons(page) { return page.document.querySelectorAll('button.doc-autrerevue-bouton'); }
function demandes(page) { return page.messages.filter((m) => m.type === MSG.DOC_AUTREREVUE_CHARGER); }
function champ(page, cle) {
  const carte = page.document.querySelectorAll('section.doc-fiche')
    .find((s) => s.querySelector('button.doc-autrerevue-bouton'));
  return carte.querySelectorAll('input, textarea, select').find((e) => e.id.indexOf('ch-' + cle + '-') === 0);
}
function choisir(page, titre) {
  const b = page.document.body.querySelectorAll('button.doc-autrerevue-article')
    .find((x) => x.textContent.indexOf(titre) !== -1);
  assert.ok(b, 'article absent de la liste : ' + titre);
  b.click();
}

test('page : seule la carte « reprise » porte le bouton, au nom de l’autre revue', () => {
  const { page, txt } = pageReprise();
  const b = boutons(page);
  assert.strictEqual(b.length, 1);
  assert.strictEqual(b[0].textContent, txt.autreRevueChoisir.replace('{0}', 'Zeitschrift'));
  assert.strictEqual(b[0].title, txt.autreRevueChoisirTip);
});

test('page : les articles ne sont demandés qu’une fois, groupés par numéro, l’archive marquée', () => {
  const { page, txt } = pageReprise();
  boutons(page)[0].click();
  assert.strictEqual(demandes(page).length, 1);
  assert.ok(page.document.body.textContent.includes(txt.autreRevueChargement), 'chargement non dit');
  page.envoyer(DONNEES);
  const corps = page.document.body.textContent;
  assert.ok(corps.includes('Z2026-01 | Inklusion') && corps.includes('Z2025-02 | Alt'));
  assert.ok(corps.includes(txt.autreRevueArchive));
  assert.ok(corps.includes(txt.autreRevueIllisibles.replace('{0}', '1')));
  assert.strictEqual(page.document.body.querySelectorAll('button.doc-autrerevue-article').length, 3);
  boutons(page)[0].click();
  boutons(page)[0].click();
  assert.strictEqual(demandes(page).length, 1, 'une seule demande par panneau');
});

test('page : la recherche filtre par titre et par nom, sans accent ni casse', () => {
  const { page } = pageReprise();
  boutons(page)[0].click();
  page.envoyer(DONNEES);
  const recherche = page.document.body.querySelector('input.doc-autrerevue-recherche');
  recherche.value = 'alter';
  recherche.dispatchEvent({ type: 'input' });
  const visibles = page.document.body.querySelectorAll('button.doc-autrerevue-article');
  assert.deepStrictEqual(visibles.map((b) => b.textContent.indexOf('Älterer Text') !== -1), [true]);
  recherche.value = 'muster';
  recherche.dispatchEvent({ type: 'input' });
  assert.strictEqual(page.document.body.querySelectorAll('button.doc-autrerevue-article').length, 1);
});

test('page : sur une carte vide, un choix remplit les sept champs sans confirmation, et rien ne s’enregistre', () => {
  const { page, txt } = pageReprise();
  boutons(page)[0].click();
  page.envoyer(DONNEES);
  choisir(page, 'Ein Artikel');
  assert.strictEqual(champ(page, 'revue').value, 'zeitschrift');
  assert.strictEqual(champ(page, 'title').value, 'Ein Artikel');
  assert.strictEqual(champ(page, 'auteurs').value, 'Eva Keller');
  assert.strictEqual(champ(page, 'reference').value, '2026, 1');
  assert.strictEqual(champ(page, 'doi').value, '10.57161/z2026-01-00');
  assert.strictEqual(champ(page, 'lien').value, 'https://doi.org/10.57161/z2026-01-00');
  assert.strictEqual(champ(page, 'descriptif').value, 'Eine Zusammenfassung.');
  assert.ok(!page.document.body.querySelector('.doc-autrerevue-confirmer'), 'aucune confirmation sur une carte vide');
  assert.ok(!page.messages.some((m) => m.type === MSG.ENREGISTRER), 'rien ne s’enregistre avant le geste');
  assert.ok(page.messages.some((m) => m.type === MSG.MODIFIE && m.modifie === true), 'la carte doit se dire modifiée');
  assert.ok(page.parId.barre.textContent.includes(txt.autreRevueRempli.replace('{0}', 'Ein Artikel')));
});

test('page : sur une carte déjà remplie, une confirmation d’abord ; « Annuler » ne touche à rien', () => {
  const { page } = pageReprise({ revue: 'zeitschrift', title: 'Mon titre', auteurs: 'Moi', reference: '', doi: '', lien: '', descriptif: '' });
  boutons(page)[0].click();
  page.envoyer(DONNEES);
  choisir(page, 'Ein Artikel');
  const zone = page.document.body.querySelector('.doc-autrerevue-confirmer');
  assert.ok(zone, 'la confirmation doit apparaître');
  assert.strictEqual(champ(page, 'title').value, 'Mon titre', 'rien n’est remplacé avant la réponse');
  zone.querySelectorAll('button').find((b) => b.classList.contains('doc-autrerevue-annuler')).click();
  assert.strictEqual(champ(page, 'title').value, 'Mon titre');
  choisir(page, 'Ein Artikel');
  page.document.body.querySelector('.doc-autrerevue-confirmer').querySelectorAll('button')
    .find((b) => b.classList.contains('doc-autrerevue-oui')).click();
  assert.strictEqual(champ(page, 'title').value, 'Ein Artikel');
  assert.strictEqual(champ(page, 'auteurs').value, 'Eva Keller');
});

test('page : un choix identique aux champs déjà remplis ne demande rien', () => {
  const { page } = pageReprise({ revue: 'zeitschrift', title: 'Ein Artikel', auteurs: '', reference: '', doi: '', lien: '', descriptif: '' });
  boutons(page)[0].click();
  page.envoyer(DONNEES);
  choisir(page, 'Ein Artikel');
  assert.ok(!page.document.body.querySelector('.doc-autrerevue-confirmer'));
  assert.strictEqual(champ(page, 'auteurs').value, 'Eva Keller');
});

test('page : une lecture en échec se dit, sans liste', () => {
  const { page, txt } = pageReprise();
  boutons(page)[0].click();
  page.envoyer({ type: MSG.DOC_AUTREREVUE_DONNEES, ok: false, numeros: [], illisibles: 0 });
  assert.ok(page.document.body.textContent.includes(txt.autreRevueEchec.replace('{0}', 'Zeitschrift')));
  assert.strictEqual(page.document.body.querySelectorAll('button.doc-autrerevue-article').length, 0);
});
