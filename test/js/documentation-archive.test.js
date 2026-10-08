// L'onglet Archive de la Documentation montre toute la bibliothèque de production
// (_NewsUndActu\Fiches\), des deux langues et de tous les numéros, même en mode test : elle
// se déduit de l'ancrage SharePoint (lib/rapport-erreur.js#resoudreAncrage), et non de la
// racine active (voir docs/EMPLACEMENTS.md). Elle est en lecture seule ; « Reprendre dans ce
// numéro » (lib/kirby-contenu.js#reprendreDansNumero) crée une fiche neuve dans la
// bibliothèque active.
//
// Chaque test a deux racines jetables distinctes : la racine active (hote-factice#revueDEssai)
// et une racine d'ancrage posée par SZH_ANCRAGE, qui évite la lecture de
// C:\ProgramData\SZH\config.json. SZH_BASE et LOCALAPPDATA visent aussi un poste jetable,
// pour que le test « ancrage absent » ne lise pas l'ancrage réel du poste.
'use strict';

const test = require('node:test');
const { before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LF = '\n';
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// ---- Poste jetable, à la place de C:\ProgramData\SZH et de %LOCALAPPDATA% ---------------
const POSTE_JETABLE = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-archive-poste-'));
process.env.SZH_BASE = path.join(POSTE_JETABLE, 'ProgramData');
process.env.LOCALAPPDATA = path.join(POSTE_JETABLE, 'Local');
fs.mkdirSync(process.env.SZH_BASE, { recursive: true });
fs.mkdirSync(process.env.LOCALAPPDATA, { recursive: true });

const { revueDEssai, activerHote } = require('./hote-factice');
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
// documentation-hote.js requiert « vscode » dès son chargement : il se charge après
// activerHote(), qui fournit le faux « vscode ».
const documentationHote = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));
// La bibliothèque active (celle du numéro ouvert), distincte de la racine de production
// posée plus bas.
const RACINE_ACTIVE = kirby.racineArbre(REVUE);
function ausgabeId() { return yaml.idNumero(REVUE); }

// Le formulaire ne se crée qu'au premier clic sur l'en-tête ACTUALITÉ : il est ouvert une
// fois, ici, avant tous les tests.
before(async () => {
  // Le premier getChildren() amorce le contexte du numéro (majContexte, extension.js) ; sans
  // lui, l'en-tête ACTUALITÉ n'existe pas et szh.ouvrirSection n'ouvre rien.
  await HOTE.arbre().getChildren();
  await HOTE.executer('szh.ouvrirSection', 'actualite');
});

async function panneau() {
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  assert.ok(p, 'panneau de Documentation absent');
  await p._recepteur({ type: 'pret' });
  return p;
}
function dernierMessage(p, type) {
  const m = p.messages.filter((x) => x.type === type).pop();
  assert.ok(m, 'aucun message de type « ' + type + ' »');
  return m;
}

// ---- Une racine d'ancrage SharePoint jetable et distincte, par test --------------------
//
// racineProduction() (lib/documentation-hote.js) vaut <ancrage>\2_Produkte\54_Pronto. Ces
// segments sont lus dans rapport-erreur.js#SEGMENT_APPLICATION, et non recopiés.
const rapportErreur = require(path.join(COCKPIT, 'lib', 'rapport-erreur.js'));
function nouvelleRacineProduction() {
  const ancrage = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-archive-ancrage-'));
  process.env.SZH_ANCRAGE = ancrage;
  return path.join(ancrage, '2_Produkte', rapportErreur.SEGMENT_APPLICATION);
}

function livre(titre, extra) {
  return Object.assign({ categorie: 'manuel', title: titre, auteurs: 'A. Auteur', annee: '2021',
    editeur: 'Éditions', descriptif: 'Un descriptif.' }, extra || {});
}

test('lecture de la production en mode test : une fiche écrite hors de la racine active apparaît quand même', async () => {
  const racineProd = nouvelleRacineProduction();
  const { uuid, slug } = kirby.creerFiche(racineProd, 'fr', 'livre', livre('Archivé au loin'), '');
  // Racine active vide : l'onglet ne la lit pas.
  assert.strictEqual(kirby.listerSlugsBibliotheque(RACINE_ACTIVE).length, 0);

  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({ type: MSG.ARCHIVE_CHARGER });
  const m = dernierMessage(p, MSG.ARCHIVE_DONNEES);
  assert.strictEqual(m.ok, true);
  const trouvee = m.fiches.find((f) => f.slug === slug);
  assert.ok(trouvee, 'la fiche de production doit apparaître dans ARCHIVE_DONNEES');
  assert.strictEqual(trouvee.type, 'livre');
  assert.deepStrictEqual(trouvee.langues, ['fr']);
  assert.strictEqual(trouvee.titres.fr, 'Archivé au loin');
  void uuid;
});

// ---- Le compte de l'Archive dans l'arbre -------------------------------------------------
//
// L'arbre (extension.js#_itemsActualite) ne lit pas la bibliothèque de production : il
// reprend le dernier compte obtenu par documentation-hote.js pour un panneau quelconque
// (compteArchiveConnu). Avant tout ARCHIVE_CHARGER ou ARCHIVE_ACTUALISER, pas de badge.
test('le compte connu de l’Archive alimente le badge de l’arbre, jamais une lecture à part', async () => {
  const racineProd = nouvelleRacineProduction();
  kirby.creerFiche(racineProd, 'fr', 'livre', livre('Un premier'), '');
  kirby.creerFiche(racineProd, 'fr', 'film', { title: 'Un second', realisateur: 'X', annee: '2022', descriptif: 'D' }, '');

  const p = await panneau();
  await p._recepteur({ type: MSG.ARCHIVE_CHARGER });
  assert.strictEqual(documentationHote.compteArchiveConnu(), 2);

  const actualite = await HOTE.arbre().getChildren(
    (await HOTE.arbre().getChildren()).find((it) => it.contextValue === 'section-actualite'));
  const archive = actualite.find((it) => it.command && it.command.arguments[0] === 'archive');
  assert.ok(archive, 'entrée Archive introuvable dans l’arbre');
  assert.strictEqual(archive.description, '(2)');

  // Une fiche ajoutée après coup : le badge ne change pas tant qu'aucun panneau ne relit
  // l'Archive.
  kirby.creerFiche(racineProd, 'fr', 'livre', livre('Ajoutée après'), '');
  const actualiteAvantRelecture = await HOTE.arbre().getChildren(
    (await HOTE.arbre().getChildren()).find((it) => it.contextValue === 'section-actualite'));
  assert.strictEqual(
    actualiteAvantRelecture.find((it) => it.command && it.command.arguments[0] === 'archive').description,
    '(2)', 'le badge ne doit pas anticiper une lecture qu’aucun panneau n’a encore faite');

  await p._recepteur({ type: MSG.ARCHIVE_ACTUALISER });
  assert.strictEqual(documentationHote.compteArchiveConnu(), 3);
  const actualiteApres = await HOTE.arbre().getChildren(
    (await HOTE.arbre().getChildren()).find((it) => it.contextValue === 'section-actualite'));
  assert.strictEqual(
    actualiteApres.find((it) => it.command && it.command.arguments[0] === 'archive').description,
    '(3)', 'après ARCHIVE_ACTUALISER, le badge doit suivre le nouveau compte');
});

test('ARCHIVE_ACTUALISER relit la bibliothèque de production (une fiche ajoutée entre-temps apparaît)', async () => {
  const racineProd = nouvelleRacineProduction();
  const p = await panneau();
  await p._recepteur({ type: MSG.ARCHIVE_CHARGER });
  const avant = dernierMessage(p, MSG.ARCHIVE_DONNEES);
  assert.strictEqual(avant.fiches.length, 0);

  kirby.creerFiche(racineProd, 'fr', 'film', { title: 'Ajouté après', realisateur: 'X', annee: '2022', descriptif: 'D' }, '');
  await p._recepteur({ type: MSG.ARCHIVE_ACTUALISER });
  const apres = dernierMessage(p, MSG.ARCHIVE_DONNEES);
  assert.strictEqual(apres.fiches.length, 1);
  assert.strictEqual(apres.fiches[0].titres.fr, 'Ajouté après');
});

test('résolution des numéros : le libellé lisible vient des ausgabe.yaml de la racine de production, id inconnu = affiché tel quel', async () => {
  const racineProd = nouvelleRacineProduction();
  const numero = path.join(racineProd, 'Revue', '2025-01');
  fs.mkdirSync(numero, { recursive: true });
  fs.writeFileSync(path.join(numero, 'ausgabe.yaml'),
    ['title: "Dossier"', 'revue: revue', 'lang: fr', 'numero: "1"', 'date: "2025-03-01"', ''].join(LF));
  const id = yaml.assurerIdNumero(numero);
  const { slug } = kirby.creerFiche(racineProd, 'fr', 'livre', livre('Rattaché'), id);
  // Une fiche dont l'id ne correspond à aucun numéro (dossier copié, renommé…) s'affiche
  // sous cet id.
  kirby.creerFiche(racineProd, 'fr', 'livre', livre('Id inconnu'), 'ID-FANTOME');

  const p = await panneau();
  await p._recepteur({ type: MSG.ARCHIVE_CHARGER });
  const m = dernierMessage(p, MSG.ARCHIVE_DONNEES);
  const rattachee = m.fiches.find((f) => f.slug === slug);
  assert.ok(rattachee);
  assert.strictEqual(rattachee.numeros.length, 1);
  assert.strictEqual(rattachee.numeros[0].id, id);
  assert.strictEqual(rattachee.numeros[0].label, 'Revue 2025/1');
  assert.strictEqual(rattachee.numeros[0].revue, 'revue');
  assert.strictEqual(rattachee.numeros[0].annee, '2025');

  const fantome = m.fiches.find((f) => f.titres.fr === 'Id inconnu');
  assert.ok(fantome);
  assert.strictEqual(fantome.numeros[0].label, 'ID-FANTOME', 'un id sans numéro connu s’affiche tel quel');
});

test('reprise : « Reprendre dans ce numéro » crée une fiche neuve, avec origine, sans toucher l’archive', async () => {
  const racineProd = nouvelleRacineProduction();
  const { uuid: uuidArchive, slug: slugArchive } = kirby.creerFiche(racineProd, 'fr', 'livre',
    livre('À reprendre', { descriptif: 'Descriptif original.' }), 'AUTRE-NUMERO');

  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({ type: MSG.ARCHIVE_REPRENDRE, ficheType: 'livre', slug: slugArchive });
  const reprise = dernierMessage(p, MSG.ARCHIVE_REPRISE);
  assert.strictEqual(reprise.ok, true);

  // La fiche neuve est dans la bibliothèque active, rattachée à ce numéro.
  const fiches = kirby.listerFichesNumero(RACINE_ACTIVE, 'fr', ausgabeId());
  const neuve = fiches.find((f) => f.valeurs.title === 'À reprendre');
  assert.ok(neuve, 'la fiche reprise doit apparaître dans le numéro actif');
  assert.notStrictEqual(neuve.uuid, uuidArchive, 'nouvel Uuid, jamais celui de l’archive');
  assert.strictEqual(neuve.origine, uuidArchive, 'origine = Uuid de la fiche archivée');
  assert.strictEqual(neuve.valeurs.descriptif, 'Descriptif original.');

  // L'archive n'a pas bougé : même Uuid, même rattachement.
  const archiveeEncore = kirby.lireFicheSlugLangue(racineProd, slugArchive, 'fr', 'livre');
  assert.strictEqual(archiveeEncore.uuid, uuidArchive);
  assert.strictEqual(archiveeEncore.ausgabe, 'AUTRE-NUMERO');

  // Un « charger » suit la reprise, pour que « Documentation du numéro » montre la fiche
  // neuve.
  const charge = p.messages.filter((m) => m.type === 'charger').pop();
  assert.ok(charge, 'la reprise doit déclencher un rechargement de la Documentation du numéro');
  assert.ok(charge.ressources.some((r) => r.valeurs.title === 'À reprendre'));
});

test('reprise : slug introuvable dans la production -> échec explicite, rien n’est créé', async () => {
  nouvelleRacineProduction();
  const p = await panneau();
  const avant = kirby.listerFichesNumero(RACINE_ACTIVE, 'fr', ausgabeId()).length;
  p.messages.length = 0;
  await p._recepteur({ type: MSG.ARCHIVE_REPRENDRE, ficheType: 'livre', slug: 'nexiste-pas' });
  const reprise = dernierMessage(p, MSG.ARCHIVE_REPRISE);
  assert.strictEqual(reprise.ok, false);
  assert.strictEqual(reprise.message, T('doc.archive.reprise.echec'));
  assert.strictEqual(kirby.listerFichesNumero(RACINE_ACTIVE, 'fr', ausgabeId()).length, avant);
});

test('ancrage SharePoint introuvable : message clair, jamais une exception', async () => {
  const avant = process.env.SZH_ANCRAGE;
  delete process.env.SZH_ANCRAGE;
  try {
    const p = await panneau();
    p.messages.length = 0;
    await p._recepteur({ type: MSG.ARCHIVE_CHARGER });
    const m = dernierMessage(p, MSG.ARCHIVE_DONNEES);
    assert.strictEqual(m.ok, false);
    assert.strictEqual(m.message, T('doc.archive.ancrageIntrouvable'));
    assert.strictEqual(m.fiches, undefined, 'aucune liste de fiches quand l’ancrage manque');

    // La reprise refuse elle aussi, avec le même message, sans lever.
    p.messages.length = 0;
    await p._recepteur({ type: MSG.ARCHIVE_REPRENDRE, ficheType: 'livre', slug: 'peu-importe' });
    const reprise = dernierMessage(p, MSG.ARCHIVE_REPRISE);
    assert.strictEqual(reprise.ok, false);
    assert.strictEqual(reprise.message, T('doc.archive.ancrageIntrouvable'));
  } finally {
    if (avant === undefined) { delete process.env.SZH_ANCRAGE; } else { process.env.SZH_ANCRAGE = avant; }
  }
});
