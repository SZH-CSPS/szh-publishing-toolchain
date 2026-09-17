// « Vérifier les méta (print) » vu depuis l'hôte : le bouton du formulaire jusqu'au
// fichier rendu au navigateur.
//
// Ce que ce banc tient, et que lib/verif-meta.js seul ne peut pas tenir :
//   — ENREGISTREMENT D'ABORD. La feuille se lit du disque. Une carte modifiée mais non
//     enregistrée doit être écrite AVANT la génération, sans quoi la feuille et le
//     fichier divergent — et l'empreinte imprimée en pied de page ne vaudrait plus rien.
//   — la feuille part vraiment au navigateur (env.openExternal), puisqu'une webview
//     VSCodium ne sait pas imprimer.
//
//   node --test test/js/verif-meta-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { revueDEssai, activerHote } = require('./hote-factice');

const revue = revueDEssai();
const hote = activerHote(revue);
hote.arbre().definirRacine(revue);
const SLUG = '01-essai';
const META = path.join(revue, 'articles', SLUG, SLUG + '.meta.yaml');
const FEUILLE = path.join(revue, 'out', 'verification-metadonnees.html');

// Le formulaire des fiches, ouvert comme le rédacteur l'ouvre.
async function panneauFiches() {
  await hote.executer('szh.apercuMetadonnees');
  const p = hote.panneauDeType('szhApercuMetadonnees');
  assert.ok(p, 'le formulaire « Métadonnées des articles » ne s’est pas ouvert');
  return p;
}

// La carte telle que la webview la renvoie (media/_fiches.js, collecter()).
function carte(extra) {
  return Object.assign({
    type: 'article', lang: '', licence: '', doi: '10.57161/x',
    title: { fr: 'Titre' }, subtitle: {}, resume: {}, keywords: {},
    author: [{ prenom: 'Anne', nom: 'Dupont', fonction: '', affiliation: '', ror: '',
      orcid: '', email: '', photo: 'portraits/anne-dupont.sans-fond.png' }]
  }, extra || {});
}

test('la feuille est écrite dans out/ et rendue au navigateur', async () => {
  const p = await panneauFiches();
  await p._recepteur({ type: 'verif-meta', articles: {} });
  assert.ok(fs.existsSync(FEUILLE), 'la feuille n’a pas été écrite');
  const ouvertes = hote.ouvertures();
  assert.ok(ouvertes.indexOf(FEUILLE) !== -1,
    'la feuille n’a pas été ouverte hors de l’éditeur : ' + JSON.stringify(ouvertes));
});

test('la feuille porte l’article du numéro et ses intitulés', async () => {
  const p = await panneauFiches();
  await p._recepteur({ type: 'verif-meta', articles: {} });
  const html = fs.readFileSync(FEUILLE, 'utf8');
  assert.ok(html.indexOf(SLUG) !== -1, 'le slug de l’article manque');
  assert.ok(html.indexOf('Anne') !== -1 && html.indexOf('Dupont') !== -1,
    'l’auteure de la fiche manque');
  assert.ok(html.indexOf('size: A4') !== -1, 'la feuille n’est pas au format A4');
});

test('une carte modifiée est ENREGISTRÉE avant que la feuille soit tirée', async () => {
  const p = await panneauFiches();
  await p._recepteur({
    type: 'verif-meta',
    articles: { [SLUG]: carte({ title: { fr: 'Titre corrigé sur le vif' } }) }
  });
  // Sur le disque d'abord : c'est l'enregistrement qui est en jeu.
  assert.ok(fs.readFileSync(META, 'utf8').indexOf('Titre corrigé sur le vif') !== -1,
    'la carte modifiée n’a pas été écrite avant la génération');
  // Puis sur la feuille : elle a donc bien été relue du disque, et non prise de l'écran.
  assert.ok(fs.readFileSync(FEUILLE, 'utf8').indexOf('Titre corrigé sur le vif') !== -1,
    'la feuille ne porte pas la valeur enregistrée');
  // Et la page le confirme au formulaire, qui peut alors oublier ses marques.
  assert.ok(p.messages.some((m) => m.type === 'enregistre'),
    'le formulaire n’a pas été prévenu de l’enregistrement');
});

test('un champ vidé s’imprime LEER plutôt que de disparaître', async () => {
  const p = await panneauFiches();
  await p._recepteur({
    type: 'verif-meta',
    articles: { [SLUG]: carte({ doi: '', title: { fr: 'Titre' } }) }
  });
  assert.ok(fs.readFileSync(FEUILLE, 'utf8').indexOf('LEER') !== -1);
});

// ---- Depuis la vue « Articles » : tout le numéro d'un coup ---------------------------

test('la vue « Articles » offre le bouton, et il tire la feuille de tout le numéro', async () => {
  await hote.executer('szh.vueArticles');
  const vue = hote.panneauDeType('szhVueArticles');
  assert.ok(vue, 'la vue « Articles » ne s’est pas ouverte');
  // La vue ne se peint qu'après son « pret », comme toute page du cockpit.
  await vue._recepteur({ type: 'pret' });
  const valeurs = vue.messages.filter((m) => m.type === 'valeurs').pop();
  assert.ok(valeurs, 'la vue n’a reçu aucune valeur');
  const bouton = (valeurs.boutons || []).filter((b) => b.id === 'verif-meta').pop();
  assert.ok(bouton, 'le bouton de vérification n’est pas dans la barre de la vue');
  assert.ok(bouton.libelle, 'le bouton n’a pas de libellé');

  try { fs.unlinkSync(FEUILLE); } catch (e) { /* pas encore écrite */ }
  await vue._recepteur({ type: 'commande', id: 'verif-meta' });
  assert.ok(fs.existsSync(FEUILLE), 'le bouton de la vue n’a pas écrit la feuille');
  assert.ok(hote.ouvertures().indexOf(FEUILLE) !== -1,
    'la feuille n’a pas été rendue au navigateur');
});

// ---- Le refus « feuille non enregistrée », jamais exercé (revue adverse) -------------
//
// imprimerFeuilleVerifTous() (le bouton de la vue « Articles », ci-dessus) refuse de tirer
// la feuille tant qu'une carte a été modifiée dans le formulaire des fiches sans être
// enregistrée — sinon l'empreinte imprimée en pied de page mentirait sur ce qui a vraiment
// été vérifié. Rien dans le dépôt ne posait l'état modifié (le message MSG.MODIFIE que
// media/_fiches.js envoie à chaque frappe) avant d'appeler ce bouton : la garde
// `if (fichesModifie) { … return; }` pouvait être neutralisée sans qu'aucun test ne rougisse.
test('le bouton de la vue « Articles » refuse la feuille tant qu’une carte n’est pas enregistrée',
  async () => {
    const p = await panneauFiches();
    // Le message que la webview envoie dès qu'un champ change : c'est lui, et lui seul, qui
    // arme fichesModifie côté hôte (lib/metadonnees-hote.js).
    await p._recepteur({ type: 'modifie', modifie: true });

    await hote.executer('szh.vueArticles');
    const vue = hote.panneauDeType('szhVueArticles');
    await vue._recepteur({ type: 'pret' });

    try { fs.unlinkSync(FEUILLE); } catch (e) { /* pas encore écrite */ }
    // hote.ouvertures() accumule depuis le début du fichier (aucun oubli entre tests, à la
    // différence de commandesJouees()/fermetures()) : on compte un AVANT/APRÈS plutôt que
    // de chercher FEUILLE, déjà ouverte par un test précédent.
    const ouvertesAvant = hote.ouvertures().length;
    // hote-factice.js ne journalise pas showInformationMessage() : on l'intercepte ici,
    // comme le fait déjà hote.test.js (voirPdfEtNoter) pour le même besoin.
    const infoOriginal = hote.stub.window.showInformationMessage;
    const infos = [];
    hote.stub.window.showInformationMessage = (m) => { infos.push(String(m)); return Promise.resolve(undefined); };
    try {
      await vue._recepteur({ type: 'commande', id: 'verif-meta' });
    } finally {
      hote.stub.window.showInformationMessage = infoOriginal;
    }

    assert.ok(infos.length > 0, 'le refus n’a provoqué aucune notification');
    assert.ok(infos[0].length > 0, 'la notification de refus est vide');
    assert.ok(!fs.existsSync(FEUILLE), 'la feuille a été écrite malgré une carte non enregistrée');
    assert.strictEqual(hote.ouvertures().length, ouvertesAvant,
      'la feuille a été rendue au navigateur malgré le refus');
  });

// ---- Les intitulés viennent du formulaire, sans son gabarit de langue ----------------

test('l’intitulé d’un champ traduisible ne porte pas le trou « ({0}) » du formulaire', async () => {
  const p = await panneauFiches();
  await p._recepteur({ type: 'verif-meta', articles: {} });
  const html = fs.readFileSync(FEUILLE, 'utf8');
  assert.ok(html.indexOf('({0})') === -1, 'le gabarit de langue du formulaire est passé tel quel');
});
