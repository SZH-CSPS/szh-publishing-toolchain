// Résoudre une copie en conflit dans l'éditeur : le câblage, vu de l'hôte.
//
// Le calcul des blocs appartient à l'éditeur et leur application est éprouvée à part
// (conflits-blocs.test.js). Ici on vérifie ce qui les relie : le fichier servi comme
// « original » du fichier du numéro — c'est lui qui fait naître les marques de divergence
// dans la gouttière —, l'entrée du contrôle de source qui n'existe que le temps du conflit,
// et les deux sens de résolution avec leurs refus.
//
// Exécution : depuis la racine du dépôt,
//   node --test test/js/conflits-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { revueDEssai, activerHote } = require('./hote-factice');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const coedition = require(path.join(COCKPIT, 'lib', 'coedition.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const AUSGABE = path.join(REVUE, 'ausgabe.yaml');
const COPIE = path.join(REVUE, 'ausgabe-Copie en conflit.yaml');

const ext = require(path.join(COCKPIT, 'extension.js'));
const P = ext._pur;
const Uri = HOTE.stub.Uri;

const VOISIN = { utilisateur: 'Anne Voisine', poste: 'PC-VOISIN' };

const pret = new Promise((r) => setTimeout(r, 30));

// La copie en conflit du numéro d'essai : le fichier du numéro, avec une seule ligne
// différente. Un seul bloc de divergence, donc, et son LineChange est connu d'avance.
function poserCopie() {
  const lignes = fs.readFileSync(AUSGABE, 'utf8').split('\n');
  const i = lignes.findIndex((l) => l.startsWith('title:'));
  assert.notStrictEqual(i, -1, 'le numéro d’essai n’a plus de ligne « title: »');
  const copie = lignes.slice();
  copie[i] = 'title: "Version restée sur l’autre poste"';
  fs.writeFileSync(COPIE, copie.join('\n'));
  // Les numéros de ligne d'un LineChange comptent à partir de 1.
  return {
    originalStartLineNumber: i + 1, originalEndLineNumber: i + 1,
    modifiedStartLineNumber: i + 1, modifiedEndLineNumber: i + 1
  };
}

function retirerCopie() { try { fs.unlinkSync(COPIE); } catch (e) { /* déjà partie */ } }

test('le fichier du numéro reçoit la copie en conflit pour original', async () => {
  await pret;
  poserCopie();
  try {
    const original = P.fournisseurDiffConflit.provideOriginalResource(Uri.file(AUSGABE));
    assert.ok(original, 'aucun original proposé : la gouttière ne montrerait rien');
    assert.strictEqual(original.scheme, P.SCHEME_CONFLIT,
      'l’original n’est pas servi sous notre schéma : ' + original.scheme);
    assert.strictEqual(P.cheminDepuisUriConflit(original), COPIE,
      'l’original ne désigne pas la copie en conflit');

    // Un fichier sans copie à côté ne doit RIEN décorer : sinon tout le numéro se
    // couvrirait de marques de divergence.
    const sansCopie = P.fournisseurDiffConflit.provideOriginalResource(
      Uri.file(path.join(REVUE, 'articles', '01-essai', '01-essai.md')));
    assert.strictEqual(sansCopie, undefined, 'un fichier sans copie a reçu un original');

    // Hors du numéro, on ne lit même pas le dossier : l'éditeur interroge ce fournisseur
    // pour CHAQUE document ouvert, y compris ceux qui n'ont rien à voir avec la revue.
    const dehors = P.fournisseurDiffConflit.provideOriginalResource(
      Uri.file(path.join(path.dirname(REVUE), 'ausgabe.yaml')));
    assert.strictEqual(dehors, undefined, 'un fichier hors du numéro a été examiné');
  } finally { retirerCopie(); }
});

test('le contenu de la copie est servi sous son schéma, et vide quand elle a disparu', async () => {
  await pret;
  poserCopie();
  const fournisseur = HOTE.fournisseurContenu(P.SCHEME_CONFLIT);
  assert.ok(fournisseur, 'aucun fournisseur de contenu enregistré pour le schéma');
  const uri = Uri.file(COPIE).with({ scheme: P.SCHEME_CONFLIT });
  assert.strictEqual(fournisseur.provideTextDocumentContent(uri), fs.readFileSync(COPIE, 'utf8'),
    'le contenu servi n’est pas celui de la copie');
  retirerCopie();
  assert.strictEqual(fournisseur.provideTextDocumentContent(uri), '',
    'une copie disparue doit rendre un contenu vide, pas lever');
});

test('l’entrée du contrôle de source n’existe que le temps du conflit', async () => {
  await pret;
  poserCopie();
  try {
    P.rafraichirConflitsScm();
    const controles = HOTE.sourceControls().filter((c) => c.id === 'szh.conflits');
    assert.strictEqual(controles.length, 1, 'pas d’entrée pour les copies en conflit');
    const sc = controles[0];
    assert.strictEqual(sc.count, 1, 'le compteur ne dit pas le nombre de copies : ' + sc.count);
    assert.ok(sc.quickDiffProvider, 'l’entrée ne porte pas le fournisseur de diff rapide');
    assert.strictEqual(sc.groupes.length, 1, 'aucun groupe de ressources');
    assert.strictEqual(sc.groupes[0].resourceStates.length, 1,
      'la copie n’est pas listée dans le groupe');
  } finally { retirerCopie(); }

  // Plus de copie : l'entrée est démontée, pour ne pas laisser une rubrique vide à vie.
  P.rafraichirConflitsScm();
  assert.strictEqual(HOTE.sourceControls().filter((c) => c.id === 'szh.conflits').length, 0,
    'l’entrée survit alors qu’il n’y a plus de copie en conflit');
});

test('« Garder la mienne » écrit mon bloc dans la copie, pas l’inverse', async () => {
  await pret;
  const bloc = poserCopie();
  try {
    const avant = fs.readFileSync(AUSGABE, 'utf8');
    await P.resoudreBlocConflit(Uri.file(AUSGABE), [bloc], 0, false);
    assert.strictEqual(fs.readFileSync(AUSGABE, 'utf8'), avant,
      'le fichier du numéro a été touché alors qu’on gardait sa version');
    assert.strictEqual(fs.readFileSync(COPIE, 'utf8'), avant,
      'la copie n’a pas reçu ma version du bloc');
  } finally { retirerCopie(); }
});

test('« Prendre cette version » refuse tant qu’un autre poste tient le fichier', async () => {
  await pret;
  const bloc = poserCopie();
  const pose = coedition.poser(REVUE, AUSGABE, VOISIN, Date.now());
  assert.ok(pose.ok, 'le bail du voisin n’a pas pu être posé, le test ne prouverait rien');
  try {
    const avant = HOTE.avertissements.length;
    await P.resoudreBlocConflit(Uri.file(AUSGABE), [bloc], 0, true);
    const nouveaux = HOTE.avertissements.slice(avant);
    assert.strictEqual(nouveaux.length, 1, 'aucun refus affiché');
    assert.ok(nouveaux[0].indexOf('Anne Voisine') !== -1,
      'le refus ne nomme pas qui tient le fichier : ' + nouveaux[0]);
    // La copie non plus n'a pas bougé : le refus arrête tout le geste.
    assert.notStrictEqual(fs.readFileSync(COPIE, 'utf8'), fs.readFileSync(AUSGABE, 'utf8'),
      'la copie a été modifiée malgré le refus');
  } finally {
    coedition.rendre(REVUE, AUSGABE, VOISIN);
    retirerCopie();
  }
});

test('sans copie en conflit, la commande le dit au lieu d’agir', async () => {
  await pret;
  const avant = HOTE.avertissements.length;
  await P.resoudreBlocConflit(Uri.file(AUSGABE), [{
    originalStartLineNumber: 1, originalEndLineNumber: 1,
    modifiedStartLineNumber: 1, modifiedEndLineNumber: 1
  }], 0, false);
  assert.strictEqual(HOTE.avertissements.length, avant + 1,
    'la commande a agi — ou s’est tue — alors qu’il n’y a aucune copie');
});

test('supprimer la copie la retire du disque et démonte l’entrée', async () => {
  await pret;
  poserCopie();
  P.rafraichirConflitsScm();
  await P.supprimerCopieConflit(COPIE, false);      // false : sans la confirmation modale
  assert.strictEqual(fs.existsSync(COPIE), false, 'la copie est encore là');
  assert.strictEqual(HOTE.sourceControls().filter((c) => c.id === 'szh.conflits').length, 0,
    'l’entrée du contrôle de source survit à la dernière copie');
});
