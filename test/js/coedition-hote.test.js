// La co-édition vue de l'hôte : ce qu'un formulaire a le droit d'écrire.
//
// lib/coedition.js est éprouvé à part (coedition.test.js) : le bail, son expiration, son
// renouvellement. Ici on éprouve la DÉCISION, celle qui vit dans extension.js — refuser
// quand un autre poste tient le fichier, refuser quand la saisie a dormi ET que le fichier
// a changé, laisser passer quand elle a dormi mais que personne n'y a touché.
//
// Ce dernier point est un écart assumé sur la règle « après cinq minutes, refais ta
// saisie » : faire refaire une saisie que personne n'a contredite serait une punition sans
// objet, et le formulaire garde de toute façon sa saisie en attente. Le test le fixe pour
// que l'écart soit un choix et non une dérive.
//
// Exécution : depuis la racine du dépôt,
//   node --test test/js/coedition-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { revueDEssai, activerHote } = require('./hote-factice');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const coedition = require(path.join(COCKPIT, 'lib', 'coedition.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const AUSGABE = path.join(REVUE, 'ausgabe.yaml');
const SLUG = '01-essai';
const META = path.join(REVUE, 'articles', SLUG, SLUG + '.meta.yaml');

// Un collègue sur un autre poste. Le nôtre vient du nom de session Windows (szh.nomUtilisateur
// est vide dans l'hôte factice), donc jamais celui-ci.
const VOISIN = { utilisateur: 'Anne Voisine', poste: 'PC-VOISIN' };

const ext = require(path.join(COCKPIT, 'extension.js'));
const P = ext._pur;

// Le démarrage de l'hôte passe par un indicateur de progression : ses microtâches doivent
// avoir tourné avant de l'interroger.
const pret = new Promise((r) => setTimeout(r, 30));

// Un panneau n'est pour la co-édition qu'une clé d'identité : n'importe quel objet fait
// l'affaire, et un objet neuf par test garantit qu'aucun état ne fuit d'un test à l'autre.
function panneauFactice() { return {}; }

function poserBailVoisin(chemin) {
  const res = coedition.poser(REVUE, chemin, VOISIN, Date.now());
  assert.ok(res.ok, 'le bail du voisin n’a pas pu être posé, le test ne prouverait rien');
}

function retirerBailVoisin(chemin) { coedition.rendre(REVUE, chemin, VOISIN); }

test('un fichier tenu par un autre poste ne s’écrit pas, et le refus le nomme', async () => {
  await pret;
  poserBailVoisin(AUSGABE);
  try {
    const message = P.refusCoedition(REVUE, AUSGABE);
    assert.ok(message, 'un geste sans session a écrit sur un fichier tenu par quelqu’un');
    assert.ok(message.indexOf('Anne Voisine') !== -1,
      'le refus ne dit pas qui tient le fichier : ' + message);

    let ecrit = false;
    const refus = P.ecrireSousMain(panneauFactice(), REVUE, AUSGABE, () => { ecrit = true; return null; });
    assert.ok(refus, 'le formulaire a écrit par-dessus la saisie d’un autre poste');
    assert.strictEqual(refus.code, 'pris', 'mauvais motif de refus : ' + refus.code);
    assert.strictEqual(ecrit, false, 'l’écriture a été tentée malgré le refus');
    assert.ok(refus.message.indexOf('Anne Voisine') !== -1,
      'le message du formulaire ne nomme pas le titulaire : ' + refus.message);
  } finally { retirerBailVoisin(AUSGABE); }
});

test('libre : l’écriture passe, et le bail devient le nôtre', async () => {
  await pret;
  const panneau = panneauFactice();
  let ecrit = false;
  const refus = P.ecrireSousMain(panneau, REVUE, AUSGABE, () => { ecrit = true; return null; });
  assert.strictEqual(refus, null, 'un fichier libre a été refusé');
  assert.strictEqual(ecrit, true, 'l’écriture n’a pas eu lieu');
  // Le bail est bien posé : un troisième poste le verrait.
  const titulaire = coedition.titulaireAutre(REVUE, AUSGABE, VOISIN);
  assert.ok(titulaire, 'aucun bail n’a été posé par l’écriture');

  // Panneau fermé : le bail est rendu sans attendre les deux minutes.
  P.libererCoedition(panneau);
  assert.strictEqual(coedition.titulaireAutre(REVUE, AUSGABE, VOISIN), null,
    'le bail survit à la fermeture du formulaire');
});

// Deux fenêtres de la même personne partagent un seul fichier de bail — c'est le même
// « qui ». Fermer l'une ne doit donc pas désarmer l'autre : sans cette précaution, refermer
// la vue « Articles » retirerait la main du formulaire des métadonnées resté ouvert.
test('fermer un formulaire ne retire pas la main d’un autre du même poste', async () => {
  await pret;
  const premier = panneauFactice();
  const second = panneauFactice();
  assert.strictEqual(P.ecrireSousMain(premier, REVUE, AUSGABE, () => null), null);
  assert.strictEqual(P.ecrireSousMain(second, REVUE, AUSGABE, () => null), null);

  P.libererCoedition(premier);
  assert.ok(coedition.titulaireAutre(REVUE, AUSGABE, VOISIN),
    'le bail est parti alors qu’un autre formulaire du poste tient encore le fichier');
  P.libererCoedition(second);
  assert.strictEqual(coedition.titulaireAutre(REVUE, AUSGABE, VOISIN), null,
    'le bail survit à la fermeture du dernier formulaire');
});

test('une écriture qui échoue est rapportée telle quelle, pas comme un conflit', async () => {
  await pret;
  const refus = P.ecrireSousMain(panneauFactice(), REVUE, AUSGABE, () => 'disque plein');
  assert.ok(refus, 'un échec d’écriture est passé pour un succès');
  assert.strictEqual(refus.code, 'echec', 'un échec d’écriture a été pris pour autre chose');
  assert.ok(refus.message.indexOf('disque plein') !== -1,
    'le message perd la cause de l’échec : ' + refus.message);
});

test('saisie endormie ET fichier changé : refus, et rien n’est écrasé', async () => {
  await pret;
  const panneau = panneauFactice();
  const temoin = path.join(REVUE, 'articles', SLUG, SLUG + '.taches.yaml');
  fs.writeFileSync(temoin, 'faites: []\n');
  // Le formulaire a lu le fichier il y a six minutes — au-delà des cinq minutes
  // d'inactivité — puis quelqu'un d'autre l'a changé entre-temps.
  P.noterLectureCoedition(panneau, REVUE, temoin, Date.now() - 6 * 60 * 1000);
  fs.writeFileSync(temoin, 'faites: [relire]\n');

  let ecrit = false;
  const refus = P.ecrireSousMain(panneau, REVUE, temoin, () => { ecrit = true; return null; });
  assert.ok(refus, 'une saisie périmée a écrasé un fichier changé entre-temps');
  assert.strictEqual(refus.code, 'perime', 'mauvais motif de refus : ' + refus.code);
  assert.strictEqual(ecrit, false, 'l’écriture a été tentée malgré le refus');
  assert.strictEqual(fs.readFileSync(temoin, 'utf8'), 'faites: [relire]\n',
    'le fichier a été écrasé alors que le refus était prononcé');
  P.libererCoedition(panneau);
});

test('saisie endormie mais fichier intact : l’écriture passe, sans punition', async () => {
  await pret;
  const panneau = panneauFactice();
  const temoin = path.join(REVUE, 'articles', SLUG, SLUG + '.taches.yaml');
  fs.writeFileSync(temoin, 'faites: []\n');
  P.noterLectureCoedition(panneau, REVUE, temoin, Date.now() - 6 * 60 * 1000);

  let ecrit = false;
  const refus = P.ecrireSousMain(panneau, REVUE, temoin, () => { ecrit = true; return null; });
  assert.strictEqual(refus, null,
    'une saisie endormie a été refusée alors que personne n’avait touché au fichier');
  assert.strictEqual(ecrit, true, 'l’écriture n’a pas eu lieu');
  P.libererCoedition(panneau);
});

// Le piège que ce test garde : ausgabe.yaml est écrit par le formulaire, mais AUSSI par les
// boutons de l'arbre et par les commandes du numéro. Si l'empreinte du formulaire ne suivait
// pas ces écritures-là, un « Monter » suffirait à faire croire au conflit — sur notre propre
// poste, et sans que personne d'autre ne soit en cause.
test('une écriture faite ailleurs sur ce poste ne passe pas pour un conflit', async () => {
  await pret;
  const panneau = panneauFactice();
  P.noterLectureCoedition(panneau, REVUE, AUSGABE, Date.now() - 6 * 60 * 1000);
  // Le geste de l'arbre : il passe par le point d'écriture unique du fichier du numéro.
  const erreur = P.ecrireClesAusgabe(REVUE, { title: 'Titre changé par un geste' });
  assert.strictEqual(erreur, null, 'l’écriture du geste a échoué, le test ne prouve rien');

  const refus = P.ecrireSousMain(panneau, REVUE, AUSGABE, () => null);
  assert.strictEqual(refus, null,
    'notre propre écriture a été prise pour celle d’un autre poste');
  P.libererCoedition(panneau);
});

test('fiches : la fiche tenue par un autre est seule refusée, les autres passent', async () => {
  await pret;
  const fournisseur = { racine: REVUE, listerArticles: () => [SLUG, '02-sans-fiche'] };
  const panneau = panneauFactice();
  poserBailVoisin(META);
  try {
    const carte = { type: 'article', lang: 'fr', title: { fr: 'Refusé' } };
    const res = P.ecrireCartesArticles(fournisseur,
      { [SLUG]: carte, '02-sans-fiche': { type: 'article', lang: 'fr', title: { fr: 'Passé' } } },
      null, panneau);
    assert.strictEqual(res.n, 1, 'mauvais nombre de fiches écrites : ' + res.n);
    assert.strictEqual(res.refus.length, 1, 'la fiche tenue n’a pas été refusée');
    assert.ok(res.refus[0].indexOf(SLUG) !== -1 && res.refus[0].indexOf('Anne Voisine') !== -1,
      'le refus ne dit ni quelle fiche ni qui la tient : ' + res.refus[0]);
    const message = P.messageCartes(res);
    assert.ok(message && message.indexOf('Anne Voisine') !== -1,
      'le message rendu au formulaire perd le refus : ' + message);
    // La fiche refusée n'a pas bougé, l'autre a bien été écrite.
    assert.strictEqual(fs.readFileSync(META, 'utf8').indexOf('Refusé'), -1,
      'la fiche tenue par un autre poste a été écrasée');
    assert.ok(fs.existsSync(path.join(REVUE, 'articles', '02-sans-fiche', '02-sans-fiche.meta.yaml')),
      'la fiche libre n’a pas été écrite');
  } finally {
    retirerBailVoisin(META);
    P.libererCoedition(panneau);
  }
});

test('archiver refuse tant que quelqu’un écrit quelque part dans le numéro', async () => {
  await pret;
  poserBailVoisin(META);
  try {
    const message = P.refusCoeditionNumero(REVUE);
    assert.ok(message, 'le numéro a été gelé sous la saisie de quelqu’un');
    assert.ok(message.indexOf('Anne Voisine') !== -1,
      'le refus ne nomme pas qui travaille encore : ' + message);
  } finally { retirerBailVoisin(META); }
  assert.strictEqual(P.refusCoeditionNumero(REVUE), null,
    'le numéro reste bloqué alors que plus personne n’y écrit');
});

// L'avertissement de dernier recours : le bail voyage par le synchroniseur et n'arrive pas
// toujours à temps. Quand une copie en conflit est quand même apparue, elle ne doit pas
// rester invisible — c'est une version du travail qui n'est plus dans le numéro.
test('une copie en conflit déjà déposée est signalée, une seule fois', async () => {
  await pret;
  const copie = path.join(REVUE, 'ausgabe-Copie en conflit.yaml');
  fs.writeFileSync(copie, 'title: "Version perdue"\n');
  try {
    P.oublierCopiesSignalees();                    // remet aussi le délai de balayage à zéro
    const avant = HOTE.avertissements.length;
    P.avertirCopiesConflit(REVUE);
    const nouveaux = HOTE.avertissements.slice(avant);
    assert.strictEqual(nouveaux.length, 1, 'la copie en conflit n’a pas été signalée');
    assert.ok(nouveaux[0].indexOf('ausgabe-Copie en conflit.yaml') !== -1,
      'l’avertissement ne nomme pas le fichier : ' + nouveaux[0]);

    // Deux fois le même avertissement serait vite ignoré. Deux gardes s'en chargent : le
    // délai entre deux balayages, et le jeu des fichiers déjà signalés. rafraichirTout
    // passe ici à chaque geste — sans elles, la fenêtre reviendrait en boucle.
    const encore = HOTE.avertissements.length;
    P.avertirCopiesConflit(REVUE);
    assert.strictEqual(HOTE.avertissements.length, encore,
      'la même copie en conflit a été signalée deux fois');
  } finally { fs.unlinkSync(copie); }
});
