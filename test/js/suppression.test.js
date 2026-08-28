// Supprimer un article quand Windows tient encore le dossier.
//
//   node --test "test/js/*.test.js"
//
// Le cas vu sur un poste : l'article part, puis fs.rmSync bute sur un EPERM au moment
// d'effacer le dossier lui-même — OneDrive le synchronisait encore. Deux dégâts, tous
// deux invisibles depuis l'interface :
//
//  1. L'échec était définitif à la première tentative, alors que le verrou tombe seul en
//     quelques secondes.
//  2. Le lever d'exception sautait l'effacement de out/<slug>, qui pèse le plus lourd
//     (PDF + HTML), et l'article disparaissait quand même de l'arbre (il n'y a plus de
//     .md) : plus aucun geste ne permettait de rattraper les documents restés là.
//
// D'où ce contrôle, qui simule le verrou en détournant fs.rmSync.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

// out/<slug> n'existe pas dans la revue d'essai : la suppression doit l'emporter aussi.
function poserSortie(slug) {
  const dossier = path.join(REVUE, 'out', slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.pdf'), Buffer.alloc(256));
  return dossier;
}

// Détourne fs.rmSync pour ce chemin-là, et rend de quoi le remettre en place.
function verrouiller(chemin, fabriquerErreur, fois) {
  const vrai = fs.rmSync;
  let restant = fois;
  fs.rmSync = function (cible, options) {
    if (String(cible) === chemin && restant > 0) { restant--; throw fabriquerErreur(); }
    return vrai.call(fs, cible, options);
  };
  return () => { fs.rmSync = vrai; };
}

function erreurVerrou() {
  const e = new Error('EPERM: operation not permitted, rmdir');
  e.code = 'EPERM';
  return e;
}

test('un verrou passager ne fait plus échouer la suppression', async () => {
  const slug = '02-sans-fiche';
  const dossier = path.join(REVUE, 'articles', slug);
  const sortie = poserSortie(slug);
  const nErreurs = HOTE.erreurs.length;

  const rendre = verrouiller(dossier, erreurVerrou, 1);   // une fois, comme OneDrive
  try {
    HOTE.repondreModale('Supprimer');
    await HOTE.executer('szh.supprimerArticle', { slug: slug });
  } finally { rendre(); }

  assert.strictEqual(fs.existsSync(dossier), false, 'le dossier de l’article est resté');
  assert.strictEqual(fs.existsSync(sortie), false, 'out/<slug> est resté');
  assert.strictEqual(HOTE.erreurs.length, nErreurs,
    'un message d’erreur est sorti alors que la reprise a réussi : ' + HOTE.erreurs.slice(nErreurs).join(' | '));
});

test('un dossier d’article qui résiste n’emporte pas les documents produits', async () => {
  const slug = '01-essai';
  const dossier = path.join(REVUE, 'articles', slug);
  const sortie = poserSortie(slug);
  const nErreurs = HOTE.erreurs.length;

  // Sans code de verrou : la fonction rend la main tout de suite, sans les dix secondes
  // de reprises — ce qui vaut aussi pour un vrai échec définitif.
  const rendre = verrouiller(dossier, () => new Error('verrou d’essai'), 99);
  try {
    HOTE.repondreModale('Supprimer');
    await HOTE.executer('szh.supprimerArticle', { slug: slug });
  } finally { rendre(); }

  assert.strictEqual(fs.existsSync(dossier), true, 'le détournement n’a pas pris');
  assert.strictEqual(fs.existsSync(sortie), false,
    'out/<slug> est resté alors que seul le dossier de l’article était tenu');
  assert.strictEqual(HOTE.erreurs.length, nErreurs + 1, 'l’échec n’a pas été signalé');
  assert.ok(HOTE.erreurs[nErreurs].indexOf(slug) !== -1,
    'le message ne nomme pas l’article : ' + HOTE.erreurs[nErreurs]);
});

// La seconde chance, une minute plus tard : c'est elle qui évite le cul-de-sac. Un
// article dont le .md est parti n'a plus de ligne dans l'arbre, donc plus de clic droit
// « Supprimer » — sans ce rattrapage, son dossier resterait là pour de bon.
test('ce qui résistait est repris une minute plus tard, sans rien dire', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slug = '03-tardif';
  const dossier = path.join(REVUE, 'articles', slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte.\n');
  const nErreurs = HOTE.erreurs.length;

  const rendre = verrouiller(dossier, () => new Error('verrou d’essai'), 99);
  HOTE.repondreModale('Supprimer');
  await HOTE.executer('szh.supprimerArticle', { slug: slug });
  assert.strictEqual(fs.existsSync(dossier), true, 'le détournement n’a pas pris');
  assert.strictEqual(HOTE.erreurs.length, nErreurs + 1, 'l’échec n’a pas été signalé');

  rendre();                                        // le verrou tombe, comme OneDrive
  t.mock.timers.tick(60000);
  assert.strictEqual(fs.existsSync(dossier), false, 'la reprise différée n’a pas eu lieu');
  assert.strictEqual(HOTE.erreurs.length, nErreurs + 1, 'la reprise a parlé alors qu’elle doit se taire');
});
