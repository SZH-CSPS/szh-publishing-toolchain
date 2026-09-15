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
