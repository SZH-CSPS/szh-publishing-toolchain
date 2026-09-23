// lib/kirby-contenu.js : le module pur qui lit et écrit la Documentation — la page du
// numéro (rubriques) et la bibliothèque partagée de fiches (_NewsUndActu\Fiches\<slug>\).
//
// Quatre familles : l'aller-retour du fichier .txt (lireTxt/ecrireTxt, listes YAML), les
// calculs purs (curia, ordre des fiches, racine de l'arbre), la bibliothèque sur disque
// (arborescences jetables sous un dossier temporaire, jamais dans le dépôt), et les statuts
// de traduction / vues du réservoir.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const kc = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-kirby-'));
}

// Une arborescence jetable minimale : <racine>\Revue\<numero>\ausgabe.yaml et
// <racine>\Zeitschrift\<numero>\ausgabe.yaml, chacun avec un id posé. Sert de base à tous
// les tests de bibliothèque, qui ont besoin d'une vraie racine d'arbre (racineArbre).
function arbreJetable() {
  const racine = dossierJetable();
  const numeroRevue = path.join(racine, 'Revue', '2026-01');
  const numeroZeitschrift = path.join(racine, 'Zeitschrift', '2026-01');
  fs.mkdirSync(numeroRevue, { recursive: true });
  fs.mkdirSync(numeroZeitschrift, { recursive: true });
  fs.writeFileSync(path.join(numeroRevue, 'ausgabe.yaml'), 'title: Numéro\nrevue: revue\nlang: fr\n', 'utf8');
  fs.writeFileSync(path.join(numeroZeitschrift, 'ausgabe.yaml'), 'title: Nummer\nrevue: zeitschrift\nlang: de\n', 'utf8');
  const idRevue = yaml.assurerIdNumero(numeroRevue);
  const idZeitschrift = yaml.assurerIdNumero(numeroZeitschrift);
  return { racine, numeroRevue, numeroZeitschrift, idRevue, idZeitschrift };
}

function livre(titre, extra) {
  return Object.assign({ categorie: 'manuel', title: titre, auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, extra || {});
}

// ---- Le contrat se charge -------------------------------------------------------------

test('le contrat champs-documentation.json se charge depuis le dépôt', () => {
  kc.oublierContrat();
  const c = kc.contrat();
  assert.ok(c.types && c.types.livre, 'le type « livre » doit exister');
  assert.ok(Array.isArray(c.ordreTypes) && c.ordreTypes.length > 0);
  assert.match(kc.cheminDuContrat(), /champs-documentation\.json$/);
});

// ---- lireTxt / ecrireTxt : aller-retour -----------------------------------------------

test('ecrireTxt puis lireTxt rendent le même title, uuid et champs', () => {
  const texte = kc.ecrireTxt({
    title: 'Le silence des bêtes', uuid: 'abcdefghij123456',
    champs: [
      { cle: 'auteurs', valeurBrute: 'Jean Dupont' },
      { cle: 'descriptif', valeurBrute: 'Un livre.\n\nEn deux paragraphes.' }
    ]
  });
  const relu = kc.lireTxt(texte);
  assert.strictEqual(relu.title, 'Le silence des bêtes');
  assert.strictEqual(relu.uuid, 'abcdefghij123456');
  assert.strictEqual(relu.champs.auteurs, 'Jean Dupont');
  assert.strictEqual(relu.champs.descriptif, 'Un livre.\n\nEn deux paragraphes.');
});

test('champsPourEcriture : un champ vide n’est pas préparé pour l’écriture', () => {
  const champs = kc.champsPourEcriture('livre', { title: 'X', lien: '' });
  assert.ok(!champs.some((c) => c.cle === 'lien'));
});

test('ecrireTxt : le nom du champ Kirby porte l’initiale en majuscule', () => {
  const texte = kc.ecrireTxt({ title: 'X', uuid: 'u', champs: [{ cle: 'lien_libelle', valeurBrute: 'Voir' }] });
  assert.match(texte, /^Lien_libelle: Voir$/m);
});

test('ecrireTxt : fin de fichier avec un seul \\n', () => {
  const texte = kc.ecrireTxt({ title: 'X', uuid: 'u', champs: [] });
  assert.ok(texte.endsWith('\n') && !texte.endsWith('\n\n'));
});

test('ecrireTxt : les champs sont séparés par une ligne ---- isolée par un blanc', () => {
  const texte = kc.ecrireTxt({ title: 'X', uuid: 'u', champs: [{ cle: 'lien', valeurBrute: 'https://x' }] });
  assert.match(texte, /\n\n----\n\n/);
});

test('lireTxt : lit sans tenir compte de la casse des clés', () => {
  const texte = 'TITLE: X\n\n----\n\nUUID: u\n\n----\n\nLIEN: https://x\n';
  const relu = kc.lireTxt(texte);
  assert.strictEqual(relu.title, 'X');
  assert.strictEqual(relu.uuid, 'u');
  assert.strictEqual(relu.champs.lien, 'https://x');
});

test('une ligne de valeur « ---- » s’échappe à l’écriture et se relit sans l’antislash', () => {
  const texte = kc.ecrireTxt({
    title: 'X', uuid: 'u',
    champs: [{ cle: 'descriptif', valeurBrute: 'Avant\n----\nAprès', forcerMultiligne: true }]
  });
  assert.match(texte, /\\----/);
  const relu = kc.lireTxt(texte);
  assert.strictEqual(relu.champs.descriptif, 'Avant\n----\nAprès');
});

test('une valeur multiligne forcée s’écrit toujours en forme longue, même vide de retour à la ligne', () => {
  const texte = kc.ecrireTxt({ title: 'X', uuid: 'u', champs: [{ cle: 'couverture', valeurBrute: '- x.png', forcerMultiligne: true }] });
  assert.match(texte, /Couverture:\n\n- x\.png/);
});

// ---- Listes YAML : structure (suivi) et fichier (couverture) --------------------------

test('ecrireListeStructure / lireListeStructure : aller-retour, plusieurs entrées', () => {
  const entrees = [
    { date: '2026-08-20', genre: 'prise-position', libelle: 'Antwort des Regierungsrates', lien: 'https://x' },
    { date: '2026-09-01', genre: 'decision', libelle: '', lien: '' }
  ];
  const brut = kc.ecrireListeStructure(entrees);
  const relu = kc.lireListeStructure(brut);
  assert.strictEqual(relu.length, 2);
  assert.deepStrictEqual(relu[0], entrees[0]);
  assert.strictEqual(relu[1].libelle, '');
});

test('lireListeStructure : accepte aussi des scalaires nus ou entre apostrophes', () => {
  const brut = '-\n  date: 2026-08-20\n  genre: \'prise-position\'\n  libelle: Antwort\n';
  const relu = kc.lireListeStructure(brut);
  assert.strictEqual(relu.length, 1);
  assert.strictEqual(relu[0].date, '2026-08-20');
  assert.strictEqual(relu[0].genre, 'prise-position');
  assert.strictEqual(relu[0].libelle, 'Antwort');
});

test('une ligne de suivi entièrement vide n’est pas gardée', () => {
  assert.strictEqual(kc.ecrireListeStructure([{ date: '', genre: '', libelle: '', lien: '' }]), '');
  assert.deepStrictEqual(kc.lireListeStructure(''), []);
});

test('ecrireFichierUnique / lireFichierUnique : un seul nom de fichier', () => {
  assert.strictEqual(kc.ecrireFichierUnique('couverture.jpg'), '- couverture.jpg');
  assert.strictEqual(kc.lireFichierUnique('- couverture.jpg'), 'couverture.jpg');
  assert.strictEqual(kc.ecrireFichierUnique(''), '');
  assert.strictEqual(kc.lireFichierUnique(''), '');
});

// ---- Validation des dates ---------------------------------------------------------------

test('dateValide / datePartielleValide / anneeValide', () => {
  assert.ok(kc.dateValide('2026-08-20'));
  assert.ok(!kc.dateValide('2026-08'));
  assert.ok(kc.datePartielleValide('2026'));
  assert.ok(kc.datePartielleValide('2026-08'));
  assert.ok(kc.datePartielleValide('2026-08-20'));
  assert.ok(!kc.datePartielleValide('26'));
  assert.ok(kc.anneeValide('2026'));
  assert.ok(!kc.anneeValide('26'));
});

// ---- `quand` -----------------------------------------------------------------------------

test('quandSatisfait : le canton n’est requis que si la portée est régionale', () => {
  assert.ok(kc.quandSatisfait({ portee: 'regional' }, { portee: 'regional' }));
  assert.ok(!kc.quandSatisfait({ portee: 'regional' }, { portee: 'national' }));
  assert.ok(kc.quandSatisfait(undefined, {}));
});

// ---- curia (derive) ------------------------------------------------------------------

test('curiaDepuis : le type Curia vient de la table instruments du contrat', () => {
  assert.strictEqual(kc.curiaDepuis('motion'), 5);
  assert.strictEqual(kc.curiaDepuis('anzug'), 6);
  assert.strictEqual(kc.curiaDepuis('inconnu'), null);
});

test('valeurDerive : le champ curia d’une intervention suit la catégorie, jamais saisi', () => {
  const champ = kc.champDuType('intervention', 'curia');
  assert.strictEqual(champ.saisie, 'derive');
  assert.strictEqual(kc.valeurDerive(champ, { categorie: 'postulat' }), '6');
  assert.strictEqual(kc.valeurDerive(champ, { categorie: '' }), '');
});

test('champsPourEcriture : curia est recalculé, jamais lu depuis la valeur fournie', () => {
  const champs = kc.champsPourEcriture('intervention', { categorie: 'motion', curia: '999' });
  const curia = champs.find((c) => c.cle === 'curia');
  assert.strictEqual(curia.valeurBrute, '5');
});

// ---- Complétude -------------------------------------------------------------------------

test('champsManquants : un champ requis mais masqué par `quand` ne compte pas', () => {
  const manque = kc.champsManquants('horizon', { portee: 'national', title: 'T', descriptif: 'D' });
  assert.ok(manque.indexOf('canton') === -1);
});

test('champsManquants : type inconnu -> tout manque', () => {
  assert.deepStrictEqual(kc.champsManquants('zorglub', {}), ['?']);
});

test('ficheComplete / ficheEcrivable', () => {
  assert.ok(!kc.ficheEcrivable('livre', {}));
  assert.ok(kc.ficheEcrivable('livre', { title: 'X' }));
  assert.ok(!kc.ficheComplete('livre', { title: 'X' }));
  assert.ok(kc.ficheComplete('livre', {
    categorie: 'manuel', title: 'X', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: 'c.png'
  }));
});

// ---- Identifiant ------------------------------------------------------------------------

test('genererUuid : 16 caractères [A-Za-z0-9], jamais deux fois le même', () => {
  const vus = new Set();
  for (let i = 0; i < 200; i++) {
    const u = kc.genererUuid();
    assert.match(u, /^[A-Za-z0-9]{16}$/);
    assert.ok(!vus.has(u));
    vus.add(u);
  }
});

// ---- Ordre des fiches -----------------------------------------------------------------

test('calculerOrdreFiches : les types suivent ordreTypes, jamais l’ordre de saisie', () => {
  const fiches = [
    { type: 'film', valeurs: { title: 'Z' } },
    { type: 'horizon', valeurs: { title: 'A', portee: 'national' } }
  ];
  const ordre = kc.calculerOrdreFiches(fiches, 'fr');
  assert.strictEqual(ordre[0].type, 'horizon');
  assert.strictEqual(ordre[1].type, 'film');
});

test('calculerOrdreFiches : intervention — Confédération d’abord, puis les cantons par code', () => {
  const fiches = [
    { type: 'intervention', valeurs: { title: 'x', canton: 'ZH' } },
    { type: 'intervention', valeurs: { title: 'y', canton: 'CH' } },
    { type: 'intervention', valeurs: { title: 'z', canton: 'AG' } }
  ];
  const ordre = kc.calculerOrdreFiches(fiches, 'fr').map((f) => f.valeurs.canton);
  assert.deepStrictEqual(ordre, ['CH', 'AG', 'ZH']);
});

test('calculerOrdreFiches : horizon — la portée suit l’ordre de la liste, pas l’alphabet', () => {
  const fiches = [
    { type: 'horizon', valeurs: { title: 'a', portee: 'varia' } },
    { type: 'horizon', valeurs: { title: 'b', portee: 'international' } },
    { type: 'horizon', valeurs: { title: 'c', portee: 'national' } }
  ];
  const ordre = kc.calculerOrdreFiches(fiches, 'fr').map((f) => f.valeurs.portee);
  assert.deepStrictEqual(ordre, ['international', 'national', 'varia']);
});

test('calculerOrdreFiches : agenda — la date de début, puis le titre', () => {
  const fiches = [
    { type: 'agenda', valeurs: { title: 'B', debut: '2026-11-30' } },
    { type: 'agenda', valeurs: { title: 'A', debut: '2026-01-05' } }
  ];
  const ordre = kc.calculerOrdreFiches(fiches, 'fr').map((f) => f.valeurs.title);
  assert.deepStrictEqual(ordre, ['A', 'B']);
});

test('calculerOrdreFiches : les propriétés supplémentaires (slug, uuid…) survivent au tri', () => {
  const fiches = [
    { type: 'film', valeurs: { title: 'Z' }, slug: 's-film' },
    { type: 'livre', valeurs: { title: 'A' }, slug: 's-livre' }
  ];
  const ordre = kc.calculerOrdreFiches(fiches, 'fr');
  assert.deepStrictEqual(ordre.map((f) => f.slug), ['s-livre', 's-film']);
});

test('estFichierPageDocumentation : reconnaît le fichier de page dans les deux langues, rien d’autre', () => {
  assert.strictEqual(kc.estFichierPageDocumentation('documentation.fr.txt'), true);
  assert.strictEqual(kc.estFichierPageDocumentation('documentation.de.txt'), true);
  assert.strictEqual(kc.estFichierPageDocumentation('documentation.it.txt'), false);
  assert.strictEqual(kc.estFichierPageDocumentation('livre.fr.txt'), false);
  assert.strictEqual(kc.estFichierPageDocumentation('01-documentation.fr.txt'), false);
  assert.strictEqual(kc.estFichierPageDocumentation(''), false);
  assert.strictEqual(kc.estFichierPageDocumentation(undefined), false);
});

test('slugFicheUnique : deux fiches de même titre reçoivent -2, -3', () => {
  const pris = new Set();
  const s1 = kc.slugFicheUnique('Même titre', pris); pris.add(s1);
  const s2 = kc.slugFicheUnique('Même titre', pris); pris.add(s2);
  assert.strictEqual(s1, 'meme-titre');
  assert.strictEqual(s2, 'meme-titre-2');
});

// ---- Instruments : ordre du menu selon le canton --------------------------------------

test('ordreInstruments : les instruments observés dans le canton choisi viennent en tête', () => {
  const ordre = kc.ordreInstruments('BS');
  const anzugPos = ordre.indexOf('anzug');
  const motionPos = ordre.indexOf('motion');
  const initCantonalePos = ordre.indexOf('initiative-cantonale');
  assert.ok(anzugPos < initCantonalePos);
  assert.ok(motionPos < initCantonalePos);
});
test('instrumentEstLocal / cantonsInstrument', () => {
  assert.strictEqual(kc.instrumentEstLocal('anzug'), true);
  assert.strictEqual(kc.instrumentEstLocal('motion'), false);
  assert.deepStrictEqual(kc.cantonsInstrument('anzug'), ['BS']);
});

// ---- Racine de l'arbre ------------------------------------------------------------------

test('racineArbre : un numéro en cours remonte d’un cran', () => {
  // Racine absolue sur tout système : sur Linux, path.join('C:', …) est relatif.
  const racine = path.resolve(os.tmpdir(), 'x', 'Revues-TESTING');
  assert.strictEqual(kc.racineArbre(path.join(racine, 'Revue', '2026-01')), racine);
});
test('racineArbre : un numéro archivé remonte de deux crans (à travers _Archive)', () => {
  // Racine absolue sur tout système : sur Linux, path.join('C:', …) est relatif.
  const racine = path.resolve(os.tmpdir(), 'x', 'Revues-TESTING');
  assert.strictEqual(kc.racineArbre(path.join(racine, '_Archive', 'Revue', '2020-05')), racine);
});
test('racineArbre : un dossier hors arborescence retombe sur son simple parent', () => {
  const p = path.resolve(os.tmpdir(), 'ailleurs', 'un-dossier');
  assert.strictEqual(kc.racineArbre(p), path.resolve(os.tmpdir(), 'ailleurs'));
});
test('autreRevue / dossierRevue', () => {
  assert.strictEqual(kc.autreRevue('revue'), 'zeitschrift');
  assert.strictEqual(kc.autreRevue('zeitschrift'), 'revue');
  assert.strictEqual(kc.autreRevue('livre'), null);
  assert.strictEqual(kc.dossierRevue('revue'), 'Revue');
  assert.strictEqual(kc.dossierRevue('zeitschrift'), 'Zeitschrift');
  assert.strictEqual(kc.dossierRevue('inconnu'), '');
});

// ---- id du numéro (ausgabe.yaml) — posé à la première ouverture -----------------------

test('assurerIdNumero : pose un id à la première ouverture, jamais recalculé ensuite', () => {
  const racine = dossierJetable();
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');
    fs.writeFileSync(chemin, 'title: Mon numéro\nrevue: revue\n', 'utf8');
    assert.strictEqual(yaml.idNumero(racine), '', 'pas encore d’id');
    const id1 = yaml.assurerIdNumero(racine);
    assert.match(id1, /^[A-Za-z0-9]{16}$/);
    const brut = fs.readFileSync(chemin, 'utf8');
    assert.match(brut, /title: Mon numéro/, 'le reste du fichier doit survivre');
    const id2 = yaml.assurerIdNumero(racine);
    assert.strictEqual(id2, id1, 'un second appel ne recalcule pas l’id');
    assert.strictEqual(yaml.idNumero(racine), id1);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('idsEnDouble : deux numéros qui partagent le même id sont signalés', () => {
  const { racine, numeroRevue, idRevue } = arbreJetable();
  try {
    const copie = path.join(racine, 'Revue', '2026-02');
    fs.mkdirSync(copie, { recursive: true });
    fs.writeFileSync(path.join(copie, 'ausgabe.yaml'), 'id: ' + idRevue + '\nrevue: revue\n', 'utf8');
    const doubles = kc.idsEnDouble(racine);
    assert.strictEqual(doubles.length, 1);
    assert.strictEqual(doubles[0].length, 2);
    assert.ok(doubles[0].every((n) => n.id === idRevue));
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('listerNumeros : les deux revues, en cours et archivées', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    const archive = path.join(racine, '_Archive', 'Zeitschrift', '2020-01');
    fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(path.join(archive, 'ausgabe.yaml'), 'revue: zeitschrift\n', 'utf8');
    const idArchive = yaml.assurerIdNumero(archive);
    const nums = kc.listerNumeros(racine);
    const revueEnCours = nums.find((n) => n.id === idRevue);
    assert.ok(revueEnCours && !revueEnCours.archive && revueEnCours.revue === 'revue');
    const zeitschriftArchivee = nums.find((n) => n.id === idArchive);
    assert.ok(zeitschriftArchivee && zeitschriftArchivee.archive && zeitschriftArchivee.revue === 'zeitschrift');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

// ---- La bibliothèque : une fiche par slug + langue -------------------------------------

test('creerFiche puis lireFicheSlugLangue : Ausgabe posé, Ordre absent avant reordonnerNumero', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    const { uuid, slug } = kc.creerFiche(racine, 'fr', 'livre', livre('Un livre'), idRevue);
    const f = kc.lireFicheSlugLangue(racine, slug, 'fr');
    assert.strictEqual(f.uuid, uuid);
    assert.strictEqual(f.type, 'livre');
    assert.strictEqual(f.ausgabe, idRevue);
    assert.strictEqual(f.ordre, null);
    assert.strictEqual(f.valeurs.title, 'Un livre');
    assert.ok(fs.existsSync(path.join(kc.cheminBibliotheque(racine), slug, 'livre.fr.txt')));
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('le dossier de la fiche n’est JAMAIS renommé — le slug tient malgré un changement de titre', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    const { slug } = kc.creerFiche(racine, 'fr', 'livre', livre('Titre initial'), idRevue);
    kc.reordonnerNumero(racine, 'fr', idRevue);
    kc.enregistrerFicheLangue(racine, slug, 'fr', 'livre', livre('Titre complètement différent'));
    assert.ok(fs.existsSync(path.join(kc.cheminBibliotheque(racine), slug, 'livre.fr.txt')),
      'le dossier doit garder son slug d’origine');
    const f = kc.lireFicheSlugLangue(racine, slug, 'fr');
    assert.strictEqual(f.valeurs.title, 'Titre complètement différent');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('reordonnerNumero : Ordre 1..N suit calculerOrdreFiches, par numéro et par langue', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    kc.creerFiche(racine, 'fr', 'film', livre('Z film', { realisateur: 'X' }), idRevue);
    kc.creerFiche(racine, 'fr', 'livre', livre('A livre'), idRevue);
    kc.reordonnerNumero(racine, 'fr', idRevue);
    const fiches = kc.listerFichesNumero(racine, 'fr', idRevue);
    assert.strictEqual(fiches[0].type, 'livre');   // livre avant film dans ordreTypes
    assert.strictEqual(fiches[0].ordre, 1);
    assert.strictEqual(fiches[1].type, 'film');
    assert.strictEqual(fiches[1].ordre, 2);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('aller-retour bilingue : champs communs recopiés dans l’autre langue, champs traduire propres', () => {
  const { racine, idRevue, idZeitschrift } = arbreJetable();
  try {
    const { uuid, slug } = kc.creerFiche(racine, 'fr', 'livre',
      livre('Titre français', { editeur: 'Éditions X' }), idRevue);
    kc.traduireDansNumero(racine, slug, 'de', idZeitschrift);
    // La version allemande, encore un point de départ : mêmes valeurs que la source.
    let de = kc.lireFicheSlugLangue(racine, slug, 'de');
    assert.strictEqual(de.uuid, uuid, 'même Uuid dans les deux langues');
    assert.strictEqual(de.valeurs.editeur, 'Éditions X');

    // On réécrit le TITRE allemand (traduire) et l'ÉDITEUR (commun) côté allemand.
    kc.enregistrerFicheLangue(racine, slug, 'de', 'livre',
      Object.assign({}, de.valeurs, { title: 'Titre allemand', editeur: 'Verlag Y' }));

    de = kc.lireFicheSlugLangue(racine, slug, 'de');
    const fr = kc.lireFicheSlugLangue(racine, slug, 'fr');
    assert.strictEqual(de.valeurs.title, 'Titre allemand');
    assert.strictEqual(fr.valeurs.title, 'Titre français', 'le titre français ne doit PAS bouger');
    assert.strictEqual(fr.valeurs.editeur, 'Verlag Y', 'l’éditeur, commun, doit être recopié vers le français');
    assert.strictEqual(de.valeurs.editeur, 'Verlag Y');
    // Ausgabe et Ordre restent propres à chaque langue.
    assert.strictEqual(fr.ausgabe, idRevue);
    assert.strictEqual(de.ausgabe, idZeitschrift);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('suivi (structure) : date/genre/lien communs par rang, libellé propre à la langue', () => {
  const { racine, idRevue, idZeitschrift } = arbreJetable();
  try {
    const suivi = [{ date: '2026-08-20', genre: 'decision', libelle: 'Décision FR', lien: 'https://x' }];
    const { slug } = kc.creerFiche(racine, 'fr', 'intervention', {
      canton: 'ZH', categorie: 'motion', numero: '1', date: '2026-01-01', title: 'T', source: 'manuel', suivi: suivi
    }, idRevue);
    kc.traduireDansNumero(racine, slug, 'de', idZeitschrift);
    let de = kc.lireFicheSlugLangue(racine, slug, 'de');
    // Repris tel quel par traduireDansNumero (point de départ).
    assert.strictEqual(de.valeurs.suivi[0].libelle, 'Décision FR');

    // Le libellé allemand est réécrit ; date/genre/lien restent, côté allemand, ce qu'ils
    // étaient au départ (recopiés depuis le français à l'enregistrement français, plus bas).
    kc.enregistrerFicheLangue(racine, slug, 'de', 'intervention',
      Object.assign({}, de.valeurs, {
        suivi: [{ date: '2026-08-20', genre: 'decision', libelle: 'Entscheid DE', lien: 'https://x' }]
      }));

    // On modifie ensuite la date côté français : elle doit se propager côté allemand, sans
    // toucher au libellé allemand déjà propre.
    const fr1 = kc.lireFicheSlugLangue(racine, slug, 'fr');
    kc.enregistrerFicheLangue(racine, slug, 'fr', 'intervention',
      Object.assign({}, fr1.valeurs, {
        suivi: [{ date: '2026-09-01', genre: 'prise-position', libelle: 'Décision FR modifiée', lien: 'https://y' }]
      }));

    de = kc.lireFicheSlugLangue(racine, slug, 'de');
    assert.strictEqual(de.valeurs.suivi[0].date, '2026-09-01', 'la date doit se recopier vers l’allemand');
    assert.strictEqual(de.valeurs.suivi[0].genre, 'prise-position');
    assert.strictEqual(de.valeurs.suivi[0].lien, 'https://y');
    assert.strictEqual(de.valeurs.suivi[0].libelle, 'Entscheid DE', 'le libellé allemand reste le sien');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('detacherFiche : Ausgabe vidé, l’autre langue n’est pas touchée', () => {
  const { racine, idRevue, idZeitschrift } = arbreJetable();
  try {
    const { slug } = kc.creerFiche(racine, 'fr', 'livre', livre('X'), idRevue);
    kc.traduireDansNumero(racine, slug, 'de', idZeitschrift);
    kc.detacherFiche(racine, slug, 'fr');
    const fr = kc.lireFicheSlugLangue(racine, slug, 'fr');
    const de = kc.lireFicheSlugLangue(racine, slug, 'de');
    assert.strictEqual(fr.ausgabe, '', 'orpheline en français');
    assert.strictEqual(de.ausgabe, idZeitschrift, 'l’allemand reste rattaché');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('tirerDansNumero : rattache une orpheline au numéro courant', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    const { slug } = kc.creerFiche(racine, 'fr', 'livre', livre('X'), '');
    let f = kc.lireFicheSlugLangue(racine, slug, 'fr');
    assert.strictEqual(f.ausgabe, '');
    kc.tirerDansNumero(racine, slug, 'fr', idRevue);
    f = kc.lireFicheSlugLangue(racine, slug, 'fr');
    assert.strictEqual(f.ausgabe, idRevue);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('supprimerFicheOrpheline : refuse sur une fiche rattachée, efface sinon (dossier entier si plus rien)', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    const { slug } = kc.creerFiche(racine, 'fr', 'livre', livre('X'), idRevue);
    let r = kc.supprimerFicheOrpheline(racine, slug, 'fr');
    assert.strictEqual(r.ok, false, 'rattachée : refusé');

    kc.detacherFiche(racine, slug, 'fr');
    r = kc.supprimerFicheOrpheline(racine, slug, 'fr');
    assert.strictEqual(r.ok, true);
    assert.ok(!fs.existsSync(path.join(kc.cheminBibliotheque(racine), slug)), 'plus aucune langue : le dossier part');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('supprimerFicheOrpheline : une seule langue part si l’autre existe encore', () => {
  const { racine, idRevue, idZeitschrift } = arbreJetable();
  try {
    const { slug } = kc.creerFiche(racine, 'fr', 'livre', livre('X'), idRevue);
    kc.traduireDansNumero(racine, slug, 'de', idZeitschrift);
    kc.detacherFiche(racine, slug, 'fr');
    const r = kc.supprimerFicheOrpheline(racine, slug, 'fr');
    assert.strictEqual(r.ok, true);
    assert.ok(fs.existsSync(path.join(kc.cheminBibliotheque(racine), slug)), 'le dossier doit survivre');
    assert.ok(kc.lireFicheSlugLangue(racine, slug, 'de'), 'l’allemand doit survivre');
    assert.strictEqual(kc.lireFicheSlugLangue(racine, slug, 'fr'), null);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('un numéro archivé garde ses fiches : listerFichesNumero les retrouve par id', () => {
  const racine = dossierJetable();
  try {
    const numero = path.join(racine, '_Archive', 'Revue', '2020-05');
    fs.mkdirSync(numero, { recursive: true });
    fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'revue: revue\n', 'utf8');
    const id = yaml.assurerIdNumero(numero);
    const racineArbreVal = kc.racineArbre(numero);
    kc.creerFiche(racineArbreVal, 'fr', 'livre', livre('X'), id);
    kc.reordonnerNumero(racineArbreVal, 'fr', id);
    assert.strictEqual(kc.listerFichesNumero(racineArbreVal, 'fr', id).length, 1);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('listerOrphelines : mes fiches sans numéro, dans ma langue seulement', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    kc.creerFiche(racine, 'fr', 'livre', livre('Rattachée'), idRevue);
    kc.creerFiche(racine, 'fr', 'livre', livre('Orpheline'), '');
    const orph = kc.listerOrphelines(racine, 'fr');
    assert.strictEqual(orph.length, 1);
    assert.strictEqual(orph[0].valeurs.title, 'Orpheline');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

// ---- Statuts de traduction --------------------------------------------------------------

test('statuts : écrire, lire, effacer — un fichier par décision', () => {
  const racine = dossierJetable();
  try {
    const uuid = kc.genererUuid();
    assert.strictEqual(kc.lireStatutFiche(racine, 'de', uuid), null);
    kc.ecrireStatutFiche(racine, 'de', uuid, 'a-traduire');
    let s = kc.lireStatutFiche(racine, 'de', uuid);
    assert.strictEqual(s.statut, 'a-traduire');
    assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/);
    kc.ecrireStatutFiche(racine, 'de', uuid, 'ignore');
    s = kc.lireStatutFiche(racine, 'de', uuid);
    assert.strictEqual(s.statut, 'ignore');
    assert.ok(kc.effacerStatutFiche(racine, 'de', uuid));
    assert.strictEqual(kc.lireStatutFiche(racine, 'de', uuid), null);
    assert.strictEqual(kc.effacerStatutFiche(racine, 'de', uuid), false, 'un second effacement ne lève pas');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

// ---- Les deux vues du réservoir -----------------------------------------------------

test('listerTraductionsATraire : seulement les fiches marquées a-traduire pour MA langue', () => {
  const { racine, idZeitschrift } = arbreJetable();
  try {
    const { uuid: uuidA, slug: slugA } = kc.creerFiche(racine, 'de', 'livre', livre('A'), idZeitschrift);
    kc.creerFiche(racine, 'de', 'livre', livre('B'), idZeitschrift);
    kc.ecrireStatutFiche(racine, 'fr', uuidA, 'a-traduire');
    const liste = kc.listerTraductionsATraire(racine, 'fr');
    assert.strictEqual(liste.length, 1);
    assert.strictEqual(liste[0].slug, slugA);
    assert.strictEqual(liste[0].langueSource, 'de');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('listerReservoir : rattachées, sans fichier ma langue, sans décision — puis ignorées seules avec le drapeau', () => {
  const { racine, idZeitschrift } = arbreJetable();
  try {
    const { uuid: uuidA, slug: slugA } = kc.creerFiche(racine, 'de', 'livre', livre('A'), idZeitschrift);
    const { slug: slugB } = kc.creerFiche(racine, 'de', 'livre', livre('B'), idZeitschrift);
    kc.creerFiche(racine, 'de', 'livre', livre('Orpheline'), '');   // pas rattachée : jamais dans le réservoir

    let res = kc.listerReservoir(racine, 'fr', { avecIgnorees: false });
    assert.deepStrictEqual(res.map((r) => r.slug).sort(), [slugA, slugB].sort());

    kc.ecrireStatutFiche(racine, 'fr', uuidA, 'ignore');
    res = kc.listerReservoir(racine, 'fr', { avecIgnorees: false });
    assert.deepStrictEqual(res.map((r) => r.slug), [slugB]);

    const ignorees = kc.listerReservoir(racine, 'fr', { avecIgnorees: true });
    assert.deepStrictEqual(ignorees.map((r) => r.slug), [slugA]);
    assert.strictEqual(ignorees[0].ignoree, true);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('traduireDansNumero puis annulation du statut : « annuler la décision » = effacer le statut', () => {
  const { racine, idRevue, idZeitschrift } = arbreJetable();
  try {
    const { uuid, slug } = kc.creerFiche(racine, 'de', 'livre', livre('X'), idZeitschrift);
    kc.ecrireStatutFiche(racine, 'fr', uuid, 'a-traduire');
    const r = kc.traduireDansNumero(racine, slug, 'fr', idRevue);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.uuid, uuid);
    // Le fichier français existe désormais : le statut ne doit plus compter (effacé).
    assert.strictEqual(kc.lireStatutFiche(racine, 'fr', uuid), null);
    assert.strictEqual(kc.listerTraductionsATraire(racine, 'fr').length, 0);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('traduireDansNumero refuse si la langue cible existe déjà', () => {
  const { racine, idRevue, idZeitschrift } = arbreJetable();
  try {
    const { slug } = kc.creerFiche(racine, 'fr', 'livre', livre('X'), idRevue);
    kc.traduireDansNumero(racine, slug, 'de', idZeitschrift);
    const r = kc.traduireDansNumero(racine, slug, 'de', idZeitschrift);
    assert.strictEqual(r.ok, false);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

// ---- Image d'une fiche : dépôt provisoire hors bibliothèque ---------------------------

test('image provisoire : déposée avant la fiche, installée à la création, jamais dans Fiches\\', () => {
  const { racine, idRevue } = arbreJetable();
  try {
    kc.deposerImageProvisoire('carte-1', 'couverture.png', Buffer.from('PNG'));
    const source = kc.imageProvisoire('carte-1');
    assert.ok(source);
    assert.ok(!source.startsWith(kc.cheminBibliotheque(racine)), 'le dépôt doit être hors bibliothèque');
    const { slug } = kc.creerFiche(racine, 'fr', 'livre', livre('X'), idRevue, source);
    const f = kc.lireFicheSlugLangue(racine, slug, 'fr');
    assert.strictEqual(f.valeurs.couverture, 'couverture.png');
    assert.ok(fs.existsSync(path.join(kc.cheminBibliotheque(racine), slug, 'couverture.png')));
    kc.nettoyerImageProvisoire('carte-1');
    assert.strictEqual(kc.imageProvisoire('carte-1'), null);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

// ---- La page : rubriques ---------------------------------------------------------------

test('ecrirePage puis lirePage : les rubriques non vides survivent, les vides disparaissent', () => {
  const racine = dossierJetable();
  try {
    const { uuid } = kc.ecrirePage(racine, 'fr', {
      title: 'Actualité et ressources',
      rubriques: { dossier_references: 'Une référence.', dossier_liens: '', ressources: 'x', podcasts: '' }
    });
    assert.match(uuid, /^[A-Za-z0-9]{16}$/);
    const page = kc.lirePage(racine, 'fr');
    assert.strictEqual(page.title, 'Actualité et ressources');
    assert.strictEqual(page.uuid, uuid);
    assert.strictEqual(page.rubriques.dossier_references, 'Une référence.');
    assert.strictEqual(page.rubriques.dossier_liens, '');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('rubriquesPourRevue : « ressources » n’existe que pour la Revue', () => {
  const pourRevue = kc.rubriquesPourRevue('revue').map((r) => r.cle);
  const pourZeitschrift = kc.rubriquesPourRevue('zeitschrift').map((r) => r.cle);
  assert.ok(pourRevue.indexOf('ressources') !== -1);
  assert.ok(pourZeitschrift.indexOf('ressources') === -1);
});

test('lireDocumentation : la page (dossierArticle) et les fiches de la bibliothèque, ensemble', () => {
  const { racine, idRevue } = arbreJetable();
  const dossierArticle = fs.mkdtempSync(path.join(racine, 'article-'));
  try {
    kc.ecrirePage(dossierArticle, 'fr', { title: 'T', rubriques: { dossier_references: 'Réf.' } });
    kc.creerFiche(racine, 'fr', 'livre', livre('X'), idRevue);
    kc.reordonnerNumero(racine, 'fr', idRevue);
    const doc = kc.lireDocumentation(dossierArticle, racine, 'fr', idRevue);
    assert.strictEqual(doc.page.rubriques.dossier_references, 'Réf.');
    assert.strictEqual(doc.fiches.length, 1);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});
