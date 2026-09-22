// Le focus d'un bouton de constat jusqu'aux formulaires de métadonnées — revue F03
// (22.09.2026). lib/constats.js écrit le contrat en tête de sa table : la commande d'un
// bouton est appelée avec { slug, focus }. Sur les huit destinations, « fiche » et
// « numero » (szh.metadonneesArticle, szh.metadonnees) jetaient tout : les cinq commandes
// visées étaient enregistrées avec une fonction fléchée SANS paramètre, donc rien ne leur
// parvenait, pas même le slug. Ce fichier tient le focus au niveau de l'hôte (la charge
// postée au panneau) ; test/js/controles.test.js tient le même geste depuis un vrai clic de
// constat, et test/js/webviews.test.js prouve que le champ visé reçoit vraiment le curseur.
//
//   node --test test/js/metadonnees-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const SLUG = '01-essai';

function dernieresValeurs(panneau) {
  return panneau.messages.filter((m) => m.type === 'valeurs').pop();
}

// ---- « fiche » (szh.metadonneesArticle -> ouvrirMetadonneesArticle) ----------------------
//
// Le panneau des fiches est un singleton (panneauArticles, lib/metadonnees-hote.js) : les
// quatre tests qui suivent partagent donc le MÊME panneau, comme un rédacteur qui cliquerait
// plusieurs constats sans refermer le formulaire. Un seul test envoie « pret » — celui qui
// ouvre le panneau la première fois : le renvoyer sur un panneau déjà ouvert réveillerait le
// gestionnaire de messages posé à la CRÉATION du panneau, dont le focus est figé sur la
// toute première ouverture — exactement le piège que le commentaire d'ouvrirApercuMetadonnees
// signale (« on ne réveille pas la page par un pret »).
function panneauFiche() { return HOTE.panneauDeType('szhApercuMetadonnees'); }

test('fiche, panneau neuf : le focus part dans la charge initiale', async () => {
  await HOTE.executer('szh.metadonneesArticle', { slug: SLUG, focus: 'title' });
  const p = panneauFiche();
  assert.ok(p, 'le formulaire des fiches ne s’est pas ouvert');
  await p._recepteur({ type: 'pret' });
  const valeurs = dernieresValeurs(p);
  assert.strictEqual(valeurs.focus, 'title');
  assert.deepStrictEqual(valeurs.filtre, [SLUG]);
});

test('fiche, panneau déjà ouvert : une nouvelle « valeurs » reporte le focus, sans repasser par « pret »', async () => {
  const p = panneauFiche();
  assert.ok(p, 'ce test part du panneau laissé ouvert par le précédent');
  p.messages.length = 0;
  await HOTE.executer('szh.metadonneesArticle', { slug: SLUG, focus: 'doi' });
  const valeurs = dernieresValeurs(p);
  assert.ok(valeurs, 'le panneau déjà ouvert n’a rien reçu');
  assert.strictEqual(valeurs.focus, 'doi');
});

test('fiche : un slug sans focus n’envoie aucune clé focus (comportement d’avant, inchangé)', async () => {
  const p = panneauFiche();
  p.messages.length = 0;
  await HOTE.executer('szh.metadonneesArticle', { slug: SLUG });
  const valeurs = dernieresValeurs(p);
  assert.strictEqual(valeurs.focus, undefined);
});

// Le focus n'est validé nulle part côté hôte — c'est la webview qui, ne trouvant pas de
// [data-cle] pour ce nom, ne fait rien (test/js/webviews.test.js). L'hôte ne doit ni lever
// ni afficher d'erreur pour un focus qui ne correspond à aucun champ connu.
test('fiche : un focus qui ne correspond à aucun champ ne fait rien lever côté hôte', async () => {
  HOTE.erreurs.length = 0;
  const p = panneauFiche();
  p.messages.length = 0;
  await HOTE.executer('szh.metadonneesArticle', { slug: SLUG, focus: 'un-champ-qui-n-existe-pas' });
  const valeurs = dernieresValeurs(p);
  assert.strictEqual(valeurs.focus, 'un-champ-qui-n-existe-pas');
  assert.strictEqual(HOTE.erreurs.length, 0);
});

// ---- « numero » (szh.metadonnees -> ouvrirMetadonnees) -----------------------------------
//
// Avant la revue F03, cette commande était enregistrée SANS paramètre du tout : ni slug
// (sans importance, un seul numéro par dossier), ni focus. Les deux mêmes chemins que pour
// la fiche : panneau neuf, panneau déjà ouvert.

test('numero, panneau neuf : le focus part avec les valeurs du numéro', async () => {
  await HOTE.executer('szh.metadonnees', { focus: 'title' });
  const p = HOTE.panneauDeType('szhMetadonnees');
  assert.ok(p, 'le formulaire du numéro ne s’est pas ouvert');
  await p._recepteur({ type: 'pret' });
  const valeurs = dernieresValeurs(p);
  assert.strictEqual(valeurs.focus, 'title');
  // La charge du numéro reste entière : le focus s'ajoute, il ne remplace rien.
  assert.ok(valeurs.valeurs, 'les valeurs du numéro ont disparu de la charge');
});

test('numero, panneau déjà ouvert : reveal() puis une nouvelle charge qui porte le focus', async () => {
  await HOTE.executer('szh.metadonnees', { focus: 'title' });
  const p = HOTE.panneauDeType('szhMetadonnees');
  await p._recepteur({ type: 'pret' });
  p.messages.length = 0;

  await HOTE.executer('szh.metadonnees', { focus: 'couleur' });
  const valeurs = dernieresValeurs(p);
  assert.ok(valeurs, 'le panneau déjà ouvert n’a rien reçu');
  assert.strictEqual(valeurs.focus, 'couleur');
  // Un seul panneau : pas un second créé par-dessus.
  assert.strictEqual(HOTE.panneaux.filter((x) => x.type === 'szhMetadonnees').length, 1);
});

test('numero : sans item du tout (démarrage, palette), la commande n’échoue pas', async () => {
  await HOTE.executer('szh.metadonnees');
  const p = HOTE.panneauDeType('szhMetadonnees');
  assert.ok(p, 'le formulaire du numéro doit s’ouvrir même sans argument');
});

// ---- Les trois destinations sans focus utile : acceptent l'objet sans se casser ----------
//
// constats.js ne vise ni « reglages » ni « documentation » avec un focusChamp/focusFixe
// (vérifié dans TABLE) ; « apercu » (pipeline/pdf-verrouille) en porte un, mais
// basculerApercu (lib/apercu.js) est un INTERRUPTEUR sur l'article actif, pas un « ouvrir
// l'aperçu de tel article » — hors des fichiers de ce chantier (extension.js,
// lib/metadonnees-hote.js). Les trois doivent au moins ne pas lever quand on leur passe
// { slug, focus }, ce qu'elles ignoraient déjà avant (une fonction fléchée sans paramètre
// n'échoue pas non plus sur un argument surnuméraire) — la revue F03 demande la
// déclaration explicite du paramètre, pas un nouveau comportement ici.
for (const id of ['szh.reglages', 'szh.documentation', 'szh.basculerApercu']) {
  test(id + ' accepte { slug, focus } sans lever', async () => {
    HOTE.erreurs.length = 0;
    await assert.doesNotReject(HOTE.executer(id, { slug: SLUG, focus: 'x' }));
  });
}

// szh.vueWord : le focus (un nom de fichier Word) est accepté, mais la liste partagée
// (SZH.listeCartes, media/_commun.js) n'a aucun moyen de désigner une ligne précise — voir
// le commentaire d'extension.js à cet enregistrement. On prouve seulement que l'argument ne
// casse rien et que la vue s'ouvre comme avant.
test('szh.vueWord accepte { slug, focus } sans lever et ouvre la vue', async () => {
  HOTE.erreurs.length = 0;
  await assert.doesNotReject(HOTE.executer('szh.vueWord', { slug: '9_Essai.docx', focus: '9_Essai.docx' }));
  assert.ok(HOTE.panneauDeType('szhVueWord'), 'la vue « Word en attente » ne s’est pas ouverte');
});
