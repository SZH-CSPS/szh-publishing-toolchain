// Le focus d'un bouton de constat jusqu'aux formulaires de métadonnées. lib/constats.js
// appelle la commande d'un bouton avec { slug, focus } ; ce fichier vérifie, au niveau de
// l'hôte, que « fiche » et « numero » (szh.metadonneesArticle, szh.metadonnees) transmettent
// ce focus au panneau. test/js/controles.test.js part d'un vrai clic de constat, et
// test/js/webviews.test.js vérifie que le champ visé reçoit le curseur.
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
// Le panneau des fiches est unique (panneauArticles, lib/metadonnees-hote.js) : les quatre
// tests suivants partagent le même panneau, comme un rédacteur qui clique plusieurs constats
// sans refermer le formulaire. Seul le test qui ouvre le panneau envoie « pret » : sur un
// panneau déjà ouvert, il réveillerait le gestionnaire posé à la création, dont le focus est
// figé sur la première ouverture (voir ouvrirApercuMetadonnees).
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

// Le focus n'est pas validé côté hôte : la webview, sans [data-cle] pour ce nom, ne fait rien
// (test/js/webviews.test.js). L'hôte ne lève pas et n'affiche pas d'erreur.
test('fiche : un focus qui ne correspond à aucun champ ne fait rien lever côté hôte', async () => {
  HOTE.erreurs.length = 0;
  const p = panneauFiche();
  p.messages.length = 0;
  await HOTE.executer('szh.metadonneesArticle', { slug: SLUG, focus: 'un-champ-qui-n-existe-pas' });
  const valeurs = dernieresValeurs(p);
  assert.strictEqual(valeurs.focus, 'un-champ-qui-n-existe-pas');
  assert.strictEqual(HOTE.erreurs.length, 0);
});

// La liste « Type d'article » est un libellé d'interface : elle suit l'interface, pas la
// langue du numéro (la fiche n'enregistre que le jeton).
test('fiche : interface allemande sur un numéro français, la liste des types est en allemand', async () => {
  process.env.SZH_LANGUE = 'de';
  try {
    const p = panneauFiche();
    p.messages.length = 0;
    await HOTE.executer('szh.metadonneesArticle', { slug: SLUG });
    const types = dernieresValeurs(p).types;
    const tribune = types.find((t) => t.valeur === 'tribune-libre');
    assert.strictEqual(tribune.libelle, 'Freie Tribüne');
    assert.strictEqual(tribune.groupe, 'Ausserhalb des Schwerpunkts');
  } finally { delete process.env.SZH_LANGUE; }
});

// ---- « numero » (szh.metadonnees -> ouvrirMetadonnees) -----------------------------------
//
// Les deux mêmes chemins que pour la fiche : panneau neuf, panneau déjà ouvert.

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

// ---- Les trois destinations sans focus utile acceptent l'objet sans erreur ---------------
//
// constats.js ne vise « reglages », « documentation » ou « apercu » avec aucun
// focusChamp/focusFixe. basculerApercu (lib/apercu.js) est un interrupteur sur l'article
// actif ; pour viser un article précis, pipeline/pdf-verrouille vise « pdf »
// (szh.voirPdfArticle). Ces trois commandes doivent seulement accepter { slug, focus }.
for (const id of ['szh.reglages', 'szh.documentation', 'szh.basculerApercu']) {
  test(id + ' accepte { slug, focus } sans lever', async () => {
    HOTE.erreurs.length = 0;
    await assert.doesNotReject(HOTE.executer(id, { slug: SLUG, focus: 'x' }));
  });
}

// szh.vueWord : le focus (un nom de fichier Word) est accepté, mais la liste partagée
// (SZH.listeCartes, media/_commun.js) ne sait pas désigner une ligne (voir extension.js à cet
// enregistrement). On vérifie que l'argument ne casse rien et que la vue s'ouvre.
test('szh.vueWord accepte { slug, focus } sans lever et ouvre la vue', async () => {
  HOTE.erreurs.length = 0;
  await assert.doesNotReject(HOTE.executer('szh.vueWord', { slug: '9_Essai.docx', focus: '9_Essai.docx' }));
  assert.ok(HOTE.panneauDeType('szhVueWord'), 'la vue « Word en attente » ne s’est pas ouverte');
});

// « ← Retour à l'article » du formulaire filtré sur un article : même garde « non
// enregistré » que les Médias, puis l'article se rouvre et le formulaire se ferme.
test('fiche : le retour à l’article garde la saisie, puis rouvre l’article et ferme le formulaire', async () => {
  const { T } = require(path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));
  await HOTE.executer('szh.metadonneesArticle', { slug: SLUG });
  const p = panneauFiche();
  assert.ok(p, 'le formulaire des fiches ne s’est pas ouvert');
  let fermetures = 0;
  const fermer = p.dispose;
  p.dispose = () => { fermetures++; return fermer(); };
  const ouvertures = () => HOTE.commandesJouees().filter((c) => c.id === 'szh.ouvrirArticle');

  // Saisie en cours, modale fermée sans choix : on reste.
  HOTE.oublierCommandes();
  await p._recepteur({ type: 'retourArticle', modifie: true, articles: {} });
  assert.strictEqual(ouvertures().length, 0, 'l’article s’est rouvert malgré « Annuler »');
  assert.strictEqual(fermetures, 0, 'le formulaire s’est fermé malgré « Annuler »');

  // « Quitter sans enregistrer » : l'article se rouvre, le formulaire se ferme.
  HOTE.repondreModale(T('table.quitter.sansEnregistrer'));
  await p._recepteur({ type: 'retourArticle', modifie: true, articles: {} });
  assert.strictEqual(ouvertures().length, 1, 'l’article ne s’est pas rouvert');
  assert.strictEqual(String((ouvertures()[0].args[0] || {}).slug || ouvertures()[0].args[0]), SLUG);
  assert.strictEqual(fermetures, 1, 'le formulaire est resté ouvert');
});
