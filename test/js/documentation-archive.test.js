// L'onglet Archive de la Documentation : TOUTE la bibliothèque de PRODUCTION
// (_NewsUndActu\Fiches\), des deux langues, tous numéros — même quand le poste travaille en
// mode test (docs/EMPLACEMENTS.md, §1 : la racine active suit `emplacementRevues`, mais
// l'Archive lit TOUJOURS la production, dérivée de l'ancrage SharePoint résolu par
// lib/rapport-erreur.js#resoudreAncrage). Lecture seule ; le geste « Reprendre dans ce
// numéro » (lib/kirby-contenu.js#reprendreDansNumero) crée une fiche NEUVE dans la
// bibliothèque ACTIVE, jamais ne modifie l'archivée.
//
// Isolation : deux racines jetables et DISTINCTES par test — la racine « active » (celle du
// numéro ouvert dans le panneau, via hote-factice#revueDEssai) et une racine « ancrage
// SharePoint » séparée, posée via SZH_ANCRAGE (le niveau « essai » de resoudreAncrage, qui
// court-circuite toute lecture de C:\ProgramData\SZH\config.json). SZH_BASE et LOCALAPPDATA
// sont eux aussi détournés vers un poste jetable dès le chargement de ce fichier : sans quoi
// le test « ancrage absent » lirait le VRAI config.json du poste qui exécute le test, qui
// peut très bien porter un ancrage réel (docs/EMPLACEMENTS.md le documente sur le poste de
// Robin) — un contrôle qui dépendrait ainsi de la machine ne prouverait rien.
//
//   node --test test/js/documentation-archive.test.js
'use strict';

const test = require('node:test');
const { before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LF = '\n';
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// ---- Poste jetable : isole ce fichier de C:\ProgramData\SZH et de %LOCALAPPDATA% réels ---
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
// La bibliothèque ACTIVE (celle du numéro ouvert) — un dossier jetable qui n'a RIEN à voir
// avec la racine « production » posée ci-dessous : c'est précisément ce que « lecture de la
// production en mode test » doit prouver.
const RACINE_ACTIVE = kirby.racineArbre(REVUE);
function ausgabeId() { return yaml.idNumero(REVUE); }

// Le formulaire ne se crée qu'au premier clic sur l'en-tête ACTUALITÉ (comme dans le vrai
// cockpit) : ouvert une seule fois, ici, avant tous les tests de ce fichier — même motif que
// test/js/actualite.test.js, où c'est un test dédié qui le fait naître au passage.
before(async () => {
  // Le premier appel à getChildren() est ce qui amorce le contexte du numéro (majContexte,
  // extension.js) — sans lui, l'en-tête ACTUALITÉ n'existe pas encore et szh.ouvrirSection
  // n'ouvre rien (même détour que test/js/actualite.test.js, où c'est entete() qui le fait).
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

// ---- Une racine « ancrage SharePoint » jetable et DISTINCTE, par test ------------------
//
// racineProduction() (lib/documentation-hote.js) = <ancrage>\2_Produkte\54_Pronto — les deux
// segments fixes que rapport-erreur.js#SEGMENT_APPLICATION et ce module partagent. On ne les
// recopie pas en dur ici : on les LIT depuis rapport-erreur.js, pour que ce test continue de
// prouver quelque chose si l'un des deux changeait.
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
  // Rien dans la racine ACTIVE : la preuve que l'onglet ne lit jamais celle-ci.
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
  // Une fiche à un id qu'AUCUN numéro ne porte (dossier copié, renommé…) : affichée par son
  // id tel quel, jamais masquée.
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

  // La fiche neuve vit dans la bibliothèque ACTIVE, rattachée à CE numéro.
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

  // Un « charger » a suivi la reprise, pour que « Documentation du numéro » montre la
  // fiche neuve sans que l'utilisateur ait à changer d'onglet à la main.
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
