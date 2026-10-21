// Supprimer un article renumérote les autres sans laisser de trou, même quand le disque
// résiste ou contient un dossier qui n'est pas un article.
//
//   node --test test/js/suppression-renumerotation.test.js
//
// Cas vérifiés, sur une revue d'essai dans os.tmpdir() :
//   - out/<slug> que Windows tient encore : l'article est parti, les autres sont renumérotés ;
//   - le dossier de l'article qui résiste après la perte de son .md : idem, le reste du
//     dossier est laissé à la reprise différée ;
//   - un dossier étranger dans articles/ (sans .md) n'empêche pas la renumérotation et
//     garde son nom.
//
// Le verrou est simulé en détournant fs.rmSync, comme dans suppression.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const ARTICLES = path.join(REVUE, 'articles');

function poserArticle(slug) {
  fs.mkdirSync(path.join(ARTICLES, slug), { recursive: true });
  fs.writeFileSync(path.join(ARTICLES, slug, slug + '.md'), 'Texte.\n');
}

function dossiers() {
  return fs.readdirSync(ARTICLES, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function ordreEcrit() {
  const m = fs.readFileSync(path.join(REVUE, 'ausgabe.yaml'), 'utf8').match(/^ordre-articles:\s*\[(.*)\]/m);
  return (m ? m[1] : '').split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

// Détourne fs.rmSync pour ce chemin-là. `avant` s'exécute avant l'erreur, pour simuler un
// effacement partiel. Rend de quoi remettre fs.rmSync en place.
function verrouiller(chemin, avant) {
  const vrai = fs.rmSync;
  fs.rmSync = function (cible, options) {
    if (String(cible) === chemin) {
      if (avant) { avant(); }
      throw new Error('verrou d’essai');           // sans code : pas de reprises
    }
    return vrai.call(fs, cible, options);
  };
  return () => { fs.rmSync = vrai; };
}

async function supprimer(slug) {
  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await HOTE.executer('szh.supprimerArticle', { slug: slug });
}

test('out/<slug> tenu par Windows : les articles restants sont renumérotés', async () => {
  poserArticle('03-troisieme');
  poserArticle('04-quatrieme');
  const sortie = path.join(REVUE, 'out', '02-sans-fiche');
  fs.mkdirSync(sortie, { recursive: true });
  fs.writeFileSync(path.join(sortie, '02-sans-fiche.pdf'), 'PDF');
  const nErreurs = HOTE.erreurs.length;

  const rendre = verrouiller(sortie);
  try { await supprimer('02-sans-fiche'); } finally { rendre(); }

  assert.strictEqual(HOTE.erreurs.length, nErreurs + 1, 'l’échec sur out/ n’a pas été signalé');
  assert.deepStrictEqual(dossiers(), ['00-essai', '01-troisieme', '02-quatrieme'],
    'un trou est resté dans la numérotation après la suppression');
  assert.deepStrictEqual(ordreEcrit(), ['00-essai', '01-troisieme', '02-quatrieme']);
  fs.rmSync(path.join(REVUE, 'out'), { recursive: true, force: true });
});

test('dossier de l’article qui résiste sans son .md : les autres sont renumérotés', async () => {
  const slug = '01-troisieme';
  const dossier = path.join(ARTICLES, slug);
  fs.writeFileSync(path.join(dossier, 'reste.bin'), 'tenu');
  const rendre = verrouiller(dossier, () => fs.unlinkSync(path.join(dossier, slug + '.md')));
  try { await supprimer(slug); } finally { rendre(); }

  // Le reste de l'ancien dossier garde son nom, à côté des articles renumérotés.
  assert.deepStrictEqual(dossiers(), ['00-essai', '01-quatrieme', slug],
    'un trou est resté dans la numérotation après une suppression partielle');
  assert.deepStrictEqual(ordreEcrit(), ['00-essai', '01-quatrieme']);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('un dossier étranger dans articles/ ne bloque pas la renumérotation', async () => {
  poserArticle('02-cinquieme');
  const etranger = path.join(ARTICLES, 'Nouveau dossier');
  fs.mkdirSync(etranger);
  fs.writeFileSync(path.join(etranger, 'note.txt'), 'pense-bête');
  const nAvert = HOTE.avertissements.length;

  await supprimer('01-quatrieme');

  assert.deepStrictEqual(dossiers(), ['00-essai', '01-cinquieme', 'Nouveau dossier'],
    'le dossier étranger a empêché de refermer le trou, ou a été renommé');
  const refus = HOTE.avertissements.slice(nAvert).filter((m) => /renumérot/.test(m));
  assert.deepStrictEqual(refus, [], 'la renumérotation a été refusée : ' + refus.join(' | '));
});

// Le message compte les dossiers renommés, pas les étapes du renommage en deux passes.
test('la barre d’état compte les dossiers renommés', async () => {
  poserArticle('02-sixieme');
  poserArticle('03-septieme');
  const avant = HOTE.statuts.length;
  await supprimer('01-cinquieme');
  assert.deepStrictEqual(dossiers(), ['00-essai', '01-sixieme', '02-septieme', 'Nouveau dossier']);
  const dit = HOTE.statuts.slice(avant).join(' | ');
  assert.ok(dit.indexOf(T('statut.supprime.renumerote', ['01-cinquieme', 2])) !== -1,
    'le compte annoncé n’est pas celui des dossiers renommés : ' + dit);
});
