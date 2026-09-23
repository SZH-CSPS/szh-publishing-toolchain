// lib/reserve.js : la réserve de fiches hors numéro (cahier des charges, §4), depuis que
// la Documentation est une arborescence Kirby — une fiche est un DOSSIER, pas un bloc de
// texte. Module PUR (fs, path, lib/slug.js, lib/kirby-contenu.js), exercé ici sans hôte
// VSCode, dans un dossier temporaire nettoyé à la fin de chaque test.
//
//   node --test "test/js/reserve.test.js"
//   node --test "test/js/*.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const reserve = require(path.join(COCKPIT, 'lib', 'reserve.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));

// Un dossier de numéro factice, sous un dossier temporaire : reserve.js range la réserve
// dans le PARENT du numéro (voir cheminReserve), donc `racineNumero` doit être un
// sous-dossier réel pour que path.dirname() désigne quelque chose de sensé.
function nouveauNumero() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-reserve-'));
  const racineNumero = path.join(parent, '2026-02');
  fs.mkdirSync(racineNumero, { recursive: true });
  return { parent, racineNumero };
}

// Une fiche « livre », dans un dossier isolé (comme le dossier d'une fiche dans un
// article) : c'est ce que kirby-contenu.js ajouterFiche() produirait.
function ficheLivre(parent, titre, langue) {
  const dossierArticle = fs.mkdtempSync(path.join(parent, 'article-'));
  const { uuid, dossier } = kirby.ajouterFiche(dossierArticle, langue || 'fr', 'livre', {
    categorie: 'manuel', title: titre || 'Un ouvrage', auteurs: 'A', annee: '2026',
    editeur: 'E', descriptif: 'D', couverture: ''
  });
  return { dossierSource: path.join(dossierArticle, dossier), uuid: uuid };
}

// ---- autreRevue ---------------------------------------------------------------------

test('autreRevue : bascule dans les deux sens, null sur une valeur inconnue', () => {
  assert.strictEqual(reserve.autreRevue('revue'), 'zeitschrift');
  assert.strictEqual(reserve.autreRevue('zeitschrift'), 'revue');
  assert.strictEqual(reserve.autreRevue('livre'), null);
  assert.strictEqual(reserve.autreRevue(''), null);
  assert.strictEqual(reserve.autreRevue(undefined), null);
  assert.deepStrictEqual(reserve.REVUES, ['revue', 'zeitschrift']);
});

// ---- cheminReserve --------------------------------------------------------------------

test('cheminReserve : dans le PARENT du numéro, sous _reserve/<revue>', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    assert.strictEqual(reserve.NOM_DOSSIER, '_reserve');
    assert.strictEqual(reserve.cheminReserve(racineNumero, 'revue'), path.join(parent, '_reserve', 'revue'));
    assert.strictEqual(reserve.cheminReserve(racineNumero, 'zeitschrift'), path.join(parent, '_reserve', 'zeitschrift'));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- Sidecar d'origine : aller-retour ---------------------------------------------

test('sidecar d’origine : aller-retour fidèle', () => {
  const o = { origine: 'revue', numeroOrigine: 'R2026-2', aTraduire: true, deposeLe: '2026-09-01' };
  assert.deepStrictEqual(reserve.analyserOrigine(reserve.serialiserOrigine(o)), o);
});

test('sidecar d’origine : a-traduire à false, origine zeitschrift', () => {
  const o = { origine: 'zeitschrift', numeroOrigine: 'Z2026-1', aTraduire: false, deposeLe: '2026-01-15' };
  assert.deepStrictEqual(reserve.analyserOrigine(reserve.serialiserOrigine(o)), o);
});

test('sidecar d’origine : texte vide ou trafiqué -> replis, jamais une levée', () => {
  assert.deepStrictEqual(reserve.analyserOrigine(''),
    { origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '' });
  assert.deepStrictEqual(reserve.analyserOrigine('n’importe quoi\nsans les bonnes clés'),
    { origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '' });
});

// ---- nomDossierFiche ------------------------------------------------------------------

test('nomDossierFiche : sûr, ordonnable, unique dans le temps', () => {
  const t1 = new Date(2026, 8, 1, 10, 0, 0, 0);
  const t2 = new Date(2026, 8, 1, 10, 0, 0, 1);
  const nomA = reserve.nomDossierFiche('livre', 'Le silence des bêtes', t1);
  const nomB = reserve.nomDossierFiche('livre', 'Le silence des bêtes', t2);
  assert.notStrictEqual(nomA, nomB);
  assert.ok(/^[a-z0-9-]+$/.test(nomA), 'nom pas sûr pour un système de fichiers : ' + nomA);
  assert.ok(nomA < nomB, 'le tri du dossier doit être chronologique : ' + nomA + ' >= ' + nomB);
});

test('nomDossierFiche : un titre vide ou entièrement non-alphanumérique reste un nom valide', () => {
  const quand = new Date(2026, 0, 1);
  for (const titre of ['', '   ', '!!!', '???...', null, undefined]) {
    const nom = reserve.nomDossierFiche('livre', titre, quand);
    assert.ok(/^[a-z0-9-]+$/.test(nom), 'nom invalide pour ' + JSON.stringify(titre) + ' : ' + nom);
  }
});

// ---- lister sur un dossier absent -------------------------------------------------

test('lister : dossier de réserve absent -> liste vide, pas une erreur', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    assert.deepStrictEqual(reserve.lister(racineNumero, 'revue'), []);
    assert.ok(!fs.existsSync(reserve.cheminReserve(racineNumero, 'revue')), 'lister() ne doit JAMAIS créer le dossier');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- deposer --------------------------------------------------------------------------

test('deposer : copie le dossier, crée l’arborescence, et lister() le retrouve', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const { dossierSource, uuid } = ficheLivre(parent, 'Un ouvrage', 'fr');
    const { chemin } = reserve.deposer(racineNumero, 'revue', {
      type: 'livre', titre: 'Un ouvrage', dossierSource: dossierSource, langueSource: 'fr',
      origine: 'revue', numeroOrigine: 'R2026-2', aTraduire: false, deposeLe: '2026-09-01'
    });
    assert.ok(fs.existsSync(chemin));
    assert.ok(fs.statSync(chemin).isDirectory());
    assert.strictEqual(path.dirname(chemin), reserve.cheminReserve(racineNumero, 'revue'));
    assert.ok(fs.existsSync(path.join(chemin, 'livre.fr.txt')));

    const trouvees = reserve.lister(racineNumero, 'revue');
    assert.strictEqual(trouvees.length, 1);
    assert.strictEqual(trouvees[0].chemin, chemin);
    assert.strictEqual(trouvees[0].fiche.origine, 'revue');
    assert.strictEqual(trouvees[0].fiche.aTraduire, false);
    assert.strictEqual(trouvees[0].fiche.titre, 'Un ouvrage');
    assert.strictEqual(trouvees[0].fiche.type, 'livre');
    assert.strictEqual(trouvees[0].fiche.langue, 'fr');
    // Un Uuid neuf, jamais celui de l'article d'origine.
    assert.notStrictEqual(trouvees[0].fiche.uuid, uuid);
    assert.match(trouvees[0].fiche.uuid, /^[A-Za-z0-9]{16}$/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('deposer : plusieurs fiches -> lister() les rend du plus récent au plus ancien', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const base = { origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01', langueSource: 'fr', type: 'livre' };
    const f1 = ficheLivre(parent, 'Premier', 'fr');
    reserve.deposer(racineNumero, 'revue', Object.assign({}, base, { titre: 'Premier', dossierSource: f1.dossierSource, quand: new Date(2026, 0, 1, 10, 0, 0, 0) }));
    const f2 = ficheLivre(parent, 'Second', 'fr');
    reserve.deposer(racineNumero, 'revue', Object.assign({}, base, { titre: 'Second', dossierSource: f2.dossierSource, quand: new Date(2026, 0, 1, 10, 0, 0, 1) }));
    const f3 = ficheLivre(parent, 'Troisième', 'fr');
    reserve.deposer(racineNumero, 'revue', Object.assign({}, base, { titre: 'Troisième', dossierSource: f3.dossierSource, quand: new Date(2026, 0, 1, 10, 0, 0, 2) }));

    const trouvees = reserve.lister(racineNumero, 'revue');
    assert.strictEqual(trouvees.length, 3);
    assert.deepStrictEqual(trouvees.map((t) => t.fiche.titre), ['Troisième', 'Second', 'Premier']);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('deposer : deux dépôts le même jour, à des instants différents, ne s’écrasent pas', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const f1 = ficheLivre(parent, 'Même livre', 'fr');
    const f2 = ficheLivre(parent, 'Même livre', 'fr');
    const base = { type: 'livre', titre: 'Même livre', langueSource: 'fr', origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01' };
    const r1 = reserve.deposer(racineNumero, 'revue', Object.assign({}, base, { dossierSource: f1.dossierSource, quand: new Date(2026, 0, 1, 8, 0, 0, 0) }));
    const r2 = reserve.deposer(racineNumero, 'revue', Object.assign({}, base, { dossierSource: f2.dossierSource, quand: new Date(2026, 0, 1, 8, 0, 0, 1) }));
    assert.notStrictEqual(r1.chemin, r2.chemin);
    assert.ok(fs.existsSync(r1.chemin) && fs.existsSync(r2.chemin));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('deposer : la source n’est jamais touchée — une copie, jamais un déplacement', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const { dossierSource } = ficheLivre(parent, 'Toujours là', 'fr');
    reserve.deposer(racineNumero, 'revue', {
      type: 'livre', titre: 'Toujours là', dossierSource: dossierSource, langueSource: 'fr',
      origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01'
    });
    assert.ok(fs.existsSync(dossierSource), 'la source ne doit pas être déplacée');
    assert.ok(fs.existsSync(path.join(dossierSource, 'livre.fr.txt')));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- Envoyer à l'autre revue : Uuid neuf, fichier renommé -------------------------

test('deposer avec langueCible différente : le fichier de contenu est renommé, le texte inchangé', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const { dossierSource } = ficheLivre(parent, 'À traduire', 'fr');
    const { chemin } = reserve.deposer(racineNumero, 'zeitschrift', {
      type: 'livre', titre: 'À traduire', dossierSource: dossierSource,
      langueSource: 'fr', langueCible: 'de',
      origine: 'revue', numeroOrigine: 'R1', aTraduire: true, deposeLe: '2026-01-01'
    });
    assert.ok(!fs.existsSync(path.join(chemin, 'livre.fr.txt')), 'l’ancien nom ne doit plus exister');
    assert.ok(fs.existsSync(path.join(chemin, 'livre.de.txt')));
    const relu = kirby.lireTxt(fs.readFileSync(path.join(chemin, 'livre.de.txt'), 'utf8'));
    // Les jetons ne se traduisent pas : le contenu (hors Uuid) reste identique au caractère
    // près, y compris les libellés en français.
    assert.strictEqual(relu.title, 'À traduire');
    assert.strictEqual(relu.champs.auteurs, 'A');
    const trouvee = reserve.lister(racineNumero, 'zeitschrift')[0];
    assert.strictEqual(trouvee.fiche.langue, 'de');
    assert.strictEqual(trouvee.fiche.aTraduire, true);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('deposer sans langueCible : garde la langue source, même geste que « Détacher »', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const { dossierSource } = ficheLivre(parent, 'Mis de côté', 'fr');
    const { chemin } = reserve.deposer(racineNumero, 'revue', {
      type: 'livre', titre: 'Mis de côté', dossierSource: dossierSource, langueSource: 'fr',
      origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01'
    });
    assert.ok(fs.existsSync(path.join(chemin, 'livre.fr.txt')));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- Avec image ----------------------------------------------------------------------

test('deposer : l’image de la fiche voyage avec son dossier', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const dossierArticle = fs.mkdtempSync(path.join(parent, 'article-'));
    const source = path.join(parent, 'couverture-x.jpg');
    fs.writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const { dossier } = kirby.ajouterFiche(dossierArticle, 'fr', 'livre', {
      categorie: 'manuel', title: 'Livre illustré', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D'
    }, source);
    const dossierSource = path.join(dossierArticle, dossier);

    const { chemin } = reserve.deposer(racineNumero, 'revue', {
      type: 'livre', titre: 'Livre illustré', dossierSource: dossierSource, langueSource: 'fr',
      origine: 'revue', numeroOrigine: 'R2026-2', aTraduire: true, deposeLe: '2026-09-01'
    });
    assert.ok(fs.existsSync(path.join(chemin, 'couverture-x.jpg')));
    assert.deepStrictEqual(fs.readFileSync(path.join(chemin, 'couverture-x.jpg')), fs.readFileSync(source));
    const relu = kirby.lireTxt(fs.readFileSync(path.join(chemin, 'livre.fr.txt'), 'utf8'));
    assert.strictEqual(kirby.lireFichierUnique(relu.champs.couverture), 'couverture-x.jpg');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

// ---- retirer ------------------------------------------------------------------------

test('retirer : supprime le dossier de réserve et rend true', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const { dossierSource } = ficheLivre(parent, 'À retirer', 'fr');
    const { chemin } = reserve.deposer(racineNumero, 'revue', {
      type: 'livre', titre: 'À retirer', dossierSource: dossierSource, langueSource: 'fr',
      origine: 'revue', numeroOrigine: 'R1', aTraduire: false, deposeLe: '2026-01-01'
    });
    assert.strictEqual(reserve.retirer(chemin), true);
    assert.ok(!fs.existsSync(chemin));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('retirer : un dossier déjà absent rend false sans lever', () => {
  const { parent, racineNumero } = nouveauNumero();
  try {
    const chemin = path.join(reserve.cheminReserve(racineNumero, 'revue'), 'inexistant');
    assert.strictEqual(reserve.retirer(chemin), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
