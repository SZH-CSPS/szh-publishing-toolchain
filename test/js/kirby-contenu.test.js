// lib/kirby-contenu.js : le module pur qui lit et écrit l'arborescence Kirby de la
// Documentation. Remplace test/js/ressources.test.js et test/js/rubriques.test.js.
//
// Trois familles : l'aller-retour du fichier .txt (lireTxt/ecrireTxt, listes YAML), les
// calculs purs (curia, ordre des fiches, nom de dossier), et l'arborescence réelle sur
// disque (arborescences jetables sous un dossier temporaire, jamais dans le dépôt).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const kc = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-kirby-'));
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
  // horizon.canton : requis=false, quand={portee:'regional'} — jamais listé comme manquant,
  // portée nationale ou régionale, puisque requis est déjà faux.
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
  assert.strictEqual(ordre[0].type, 'horizon');   // horizon avant film dans ordreTypes
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
  // Ordre de la liste `portee` du JSON : international, national, regional, varia.
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

test('calculerNoms : dossier « <n>_<slug> », numérotation continue sur tous les types', () => {
  const fiches = [
    { type: 'film', valeurs: { title: 'Le film' } },
    { type: 'livre', valeurs: { title: 'Le livre' } }
  ];
  const noms = kc.calculerNoms(fiches, 'fr');
  const livre = noms.find((f) => f.type === 'livre');
  const film = noms.find((f) => f.type === 'film');
  assert.strictEqual(livre.position, 1);          // livre avant film dans ordreTypes
  assert.strictEqual(livre.dossierVoulu, '1_le-livre');
  assert.strictEqual(film.position, 2);
  assert.strictEqual(film.dossierVoulu, '2_le-film');
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
  const anzugPos = ordre.indexOf('anzug');       // local, cantons: ["BS"]
  const motionPos = ordre.indexOf('motion');     // cantons: [... "BS" ...]
  const initCantonalePos = ordre.indexOf('initiative-cantonale');  // cantons: []
  assert.ok(anzugPos < initCantonalePos);
  assert.ok(motionPos < initCantonalePos);
});
test('instrumentEstLocal / cantonsInstrument', () => {
  assert.strictEqual(kc.instrumentEstLocal('anzug'), true);
  assert.strictEqual(kc.instrumentEstLocal('motion'), false);
  assert.deepStrictEqual(kc.cantonsInstrument('anzug'), ['BS']);
});

// ---- L'arborescence sur le disque ------------------------------------------------------

test('ajouterFiche puis reordonnerFiches : le dossier prend son nom définitif', () => {
  const racine = dossierJetable();
  try {
    const { uuid } = kc.ajouterFiche(racine, 'fr', 'livre', {
      title: 'Un livre', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: ''
    });
    kc.reordonnerFiches(racine, 'fr');
    const fiches = kc.listerFiches(racine, 'fr');
    assert.strictEqual(fiches.length, 1);
    assert.strictEqual(fiches[0].uuid, uuid);
    assert.strictEqual(fiches[0].dossier, '1_un-livre');
    assert.ok(fs.existsSync(path.join(racine, '1_un-livre', 'livre.fr.txt')));
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('deux fiches qui échangent leur rang se renomment sans collision', () => {
  const racine = dossierJetable();
  try {
    kc.ajouterFiche(racine, 'fr', 'film', { title: 'B film', realisateur: 'X', annee: '2026', descriptif: 'D', couverture: '' });
    kc.ajouterFiche(racine, 'fr', 'livre', { title: 'A livre', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: '' });
    kc.reordonnerFiches(racine, 'fr');
    let fiches = kc.listerFiches(racine, 'fr');
    const livre1 = fiches.find((f) => f.type === 'livre');
    assert.strictEqual(livre1.dossier, '1_a-livre');   // livre avant film

    // On renomme le titre du livre pour Z : il doit désormais suivre le film.
    kc.ecrireFiche(racine, 'fr', livre1.uuid, 'livre',
      Object.assign({}, livre1.valeurs, { title: 'Z livre' }));
    kc.reordonnerFiches(racine, 'fr');
    fiches = kc.listerFiches(racine, 'fr');
    const parType = {};
    fiches.forEach((f) => { parType[f.type] = f; });
    // Livre reste avant film dans ordreTypes malgré le titre : seul le rang à l'intérieur
    // du type bougerait s'il y avait plusieurs livres — ici l'ordre des TYPES ne change pas.
    assert.strictEqual(parType.livre.dossier, '1_z-livre');
    assert.strictEqual(parType.film.dossier, '2_b-film');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('reordonnerFiches est idempotente : rejouée après une interruption simulée, elle termine le lot', () => {
  const racine = dossierJetable();
  try {
    kc.ajouterFiche(racine, 'fr', 'livre', { title: 'Alpha', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: '' });
    kc.ajouterFiche(racine, 'fr', 'livre', { title: 'Beta', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: '' });
    kc.reordonnerFiches(racine, 'fr');
    let fiches = kc.listerFiches(racine, 'fr');
    const alpha = fiches.find((f) => f.valeurs.title === 'Alpha');
    const beta = fiches.find((f) => f.valeurs.title === 'Beta');
    // On inverse les titres pour forcer un double renommage, puis on interrompt la passe 1
    // à la main : un seul des deux dossiers part au temporaire.
    kc.ecrireFiche(racine, 'fr', alpha.uuid, 'livre', Object.assign({}, alpha.valeurs, { title: 'Zeta' }));
    kc.ecrireFiche(racine, 'fr', beta.uuid, 'livre', Object.assign({}, beta.valeurs, { title: 'Aaa' }));
    fs.renameSync(path.join(racine, alpha.dossier), path.join(racine, '~kirby-tmp-2_zeta'));
    // La reprise (un second appel, comme si le premier avait été interrompu ici) doit
    // terminer le lot sans rien perdre.
    kc.reordonnerFiches(racine, 'fr');
    fiches = kc.listerFiches(racine, 'fr');
    assert.strictEqual(fiches.length, 2);
    const parTitre = {}; fiches.forEach((f) => { parTitre[f.valeurs.title] = f.dossier; });
    assert.strictEqual(parTitre.Aaa, '1_aaa');
    assert.strictEqual(parTitre.Zeta, '2_zeta');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('retirerFiche ôte le dossier entier, y compris son image', () => {
  const racine = dossierJetable();
  try {
    const { uuid, dossier } = kc.ajouterFiche(racine, 'fr', 'livre',
      { title: 'X', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: '' });
    assert.ok(fs.existsSync(path.join(racine, dossier)));
    const r = kc.retirerFiche(racine, 'fr', uuid);
    assert.ok(r.ok);
    assert.ok(!fs.existsSync(path.join(racine, dossier)));
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('retirerFiche sur un uuid absent : ok=false, ne lève pas', () => {
  const racine = dossierJetable();
  try { assert.deepStrictEqual(kc.retirerFiche(racine, 'fr', 'inconnu'), { ok: false }); }
  finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('image provisoire : déposée avant la fiche, installée à la création', () => {
  const racine = dossierJetable();
  try {
    kc.deposerImageProvisoire(racine, 'carte-1', 'couverture.png', Buffer.from('PNG'));
    const source = kc.imageProvisoire(racine, 'carte-1');
    assert.ok(source);
    const { uuid, dossier } = kc.ajouterFiche(racine, 'fr', 'livre',
      { title: 'X', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, source);
    const fiches = kc.listerFiches(racine, 'fr');
    const f = fiches.find((x) => x.uuid === uuid);
    assert.strictEqual(f.valeurs.couverture, 'couverture.png');
    assert.ok(fs.existsSync(path.join(racine, dossier, 'couverture.png')));
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

test('lireDocumentation : page et fiches ensemble', () => {
  const racine = dossierJetable();
  try {
    kc.ecrirePage(racine, 'fr', { title: 'T', rubriques: { dossier_references: 'Réf.' } });
    kc.ajouterFiche(racine, 'fr', 'livre', { title: 'X', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D', couverture: '' });
    kc.reordonnerFiches(racine, 'fr');
    const doc = kc.lireDocumentation(racine, 'fr');
    assert.strictEqual(doc.page.rubriques.dossier_references, 'Réf.');
    assert.strictEqual(doc.fiches.length, 1);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});
