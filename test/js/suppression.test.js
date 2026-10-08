// Supprimer un article quand Windows tient encore le dossier.
//
//   node --test "test/js/*.test.js"
//
// fs.rmSync peut buter sur un EPERM en effaçant le dossier lui-même, quand OneDrive le
// synchronise encore. Le verrou tombe seul en quelques secondes. Ce qui est vérifié :
//
//  1. la suppression réessaie au lieu d'échouer à la première tentative ;
//  2. l'effacement de out/<slug> (PDF + HTML, le plus lourd) a lieu même si le dossier
//     résiste : l'article disparaît de l'arbre dès que son .md est parti, et plus aucun
//     geste ne permettrait de rattraper ces fichiers.
//
// Le verrou est simulé en détournant fs.rmSync.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

// out/<slug> n'existe pas dans la revue d'essai : on le crée, la suppression doit l'emporter.
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
  // Les rangs ont été réalignés après le contrôle précédent (base 0, lib/renumerotation.js) :
  // on lit le nom réel sur l'arbre plutôt que de supposer un nom figé.
  const [slug] = HOTE.arbre().listerArticles();
  assert.ok(slug, 'aucun article sur lequel jouer ce contrôle');
  const dossier = path.join(REVUE, 'articles', slug);
  const sortie = poserSortie(slug);
  const nErreurs = HOTE.erreurs.length;

  // Sans code de verrou : la fonction rend la main tout de suite, sans les dix secondes de
  // reprises, comme pour un vrai échec définitif.
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

// La seconde chance, une minute plus tard : un article dont le .md est parti n'a plus de
// ligne dans l'arbre, donc plus de « Supprimer » au clic droit. Sans ce rattrapage, son
// dossier resterait.
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
