// lib/propositions.js : lots des moissonneurs, cas A/B, décisions et acceptation, sur une
// bibliothèque jetable. Les lots sont synthétiques, écrits ici (docs/FORMAT-PROPOSITIONS.md).
//
//   node --test test/js/propositions.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));
const kc = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));

const RE_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Une racine d'arbre jetable, avec un numéro de la Revue qui porte son id.
function bibliotheque() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-propositions-'));
  const numero = path.join(racine, 'Revue', '2026-01');
  fs.mkdirSync(numero, { recursive: true });
  fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'title: Numéro\nrevue: revue\nlang: fr\n', 'utf8');
  return { racine: racine, idRevue: yaml.assurerIdNumero(numero) };
}
function nettoyer(racine) { fs.rmSync(racine, { recursive: true, force: true }); }

function ecrireLot(racine, moissonneur, nom, lignes) {
  const dossier = path.join(pr.cheminMoissons(racine), moissonneur);
  fs.mkdirSync(dossier, { recursive: true });
  const texte = lignes.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  fs.writeFileSync(path.join(dossier, nom), texte, 'utf8');
}

// Une intervention complète et conforme : un cas A.
function intervention(id, extra) {
  return Object.assign({
    format: 'pronto-proposition/1',
    cle: 'essai:source-exemple:GE:' + id,
    moissonneur: 'essai',
    type: 'intervention',
    langue: 'fr',
    recolte: '2026-10-02T14:12:00Z',
    lien_source: 'https://grandconseil.exemple.ch/objet/' + id,
    valeurs: {
      title: 'Motion d’essai ' + id, canton: 'GE', categorie: 'motion', numero: 'M ' + id,
      date: '2026-03-04', lien: 'https://grandconseil.exemple.ch/objet/' + id, source: 'openparldata'
    },
    doutes: [],
    brut: {},
    pertinence: { verdict: 'retenu', raison: 'ancrage fort dans le titre' },
    doublon: null
  }, extra || {});
}
function avecValeurs(p, valeurs) {
  return Object.assign({}, p, { valeurs: Object.assign({}, p.valeurs, valeurs) });
}
function codes(raisons) { return raisons.map((r) => r.code + ':' + r.champ); }

// ---- Emplacements ---------------------------------------------------------------------

test('cheminMoissons et le fichier de décision : 16 hex du SHA-256 de la cle', () => {
  const racine = path.join(os.tmpdir(), 'racine-fictive');
  assert.strictEqual(pr.cheminMoissons(racine), path.join(racine, '_NewsUndActu', '_Moissons'));
  // SHA-256 de « a » : ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb
  assert.strictEqual(pr.empreinteCle('a'), 'ca978112ca1bbdca');
  assert.strictEqual(pr.cheminDecision(racine, 'a'),
    path.join(racine, '_NewsUndActu', '_Moissons', '_Decisions', 'ca978112ca1bbdca.txt'));
});

// ---- listerPropositions -----------------------------------------------------------------

test('listerPropositions lit chaque moissonneur et rend ses états', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [intervention('1'), intervention('2')]);
    ecrireLot(racine, 'autre', '2026-10-01-1.jsonl', [intervention('3', { cle: 'autre:x:3', moissonneur: 'autre' })]);
    fs.writeFileSync(path.join(pr.cheminMoissons(racine), 'essai', 'etat.json'),
      JSON.stringify({ format: 'pronto-etat/1', moissonneur: 'essai', derniere_moisson: '2026-10-02T14:00:00Z' }));
    const r = pr.listerPropositions(racine, 'fr');
    assert.deepStrictEqual(r.propositions.map((p) => p.cle).sort(),
      ['autre:x:3', 'essai:source-exemple:GE:1', 'essai:source-exemple:GE:2']);
    assert.deepStrictEqual(r.avertissements, []);
    assert.strictEqual(r.etats.essai.derniere_moisson, '2026-10-02T14:00:00Z');
    assert.strictEqual(r.etats.autre, null);
    assert.strictEqual(r.propositions.find((p) => p.cle === 'autre:x:3').lot, '2026-10-01-1.jsonl');
  } finally { nettoyer(racine); }
});

test('sans dossier _Moissons : aucune proposition, aucun avertissement', () => {
  const { racine } = bibliotheque();
  try {
    assert.deepStrictEqual(pr.listerPropositions(racine, 'fr'), { propositions: [], avertissements: [], etats: {} });
  } finally { nettoyer(racine); }
});

test('une ligne illisible est écartée, le reste du lot est gardé', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [intervention('1'), '{ pas du json', intervention('2')]);
    const r = pr.listerPropositions(racine, 'fr');
    assert.strictEqual(r.propositions.length, 2);
    assert.deepStrictEqual(r.avertissements,
      [{ code: 'ligne-illisible', moissonneur: 'essai', lot: '2026-10-02-1.jsonl', ligne: 2 }]);
  } finally { nettoyer(racine); }
});

test('un lot illisible est signalé, les autres lots sont lus', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [intervention('1')]);
    fs.mkdirSync(path.join(pr.cheminMoissons(racine), 'essai', '2026-10-03-1.jsonl'));
    const r = pr.listerPropositions(racine, 'fr');
    assert.strictEqual(r.propositions.length, 1);
    assert.deepStrictEqual(r.avertissements,
      [{ code: 'lot-illisible', moissonneur: 'essai', lot: '2026-10-03-1.jsonl' }]);
  } finally { nettoyer(racine); }
});

test('format inconnu, type inconnu, langue inconnue et lot mal nommé : avertis et ignorés', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [
      intervention('1', { format: 'pronto-proposition/2' }),
      intervention('2', { type: 'colloque' }),
      intervention('3', { langue: 'en' }),
      intervention('4')
    ]);
    ecrireLot(racine, 'essai', 'lot-du-jour.jsonl', [intervention('5')]);
    const r = pr.listerPropositions(racine, 'fr');
    assert.deepStrictEqual(r.propositions.map((p) => p.cle), ['essai:source-exemple:GE:4']);
    assert.deepStrictEqual(r.avertissements.map((a) => a.code).sort(),
      ['format-inconnu', 'langue-inconnue', 'lot-mal-nomme', 'type-inconnu']);
    assert.strictEqual(r.avertissements.find((a) => a.code === 'type-inconnu').cle, 'essai:source-exemple:GE:2');
  } finally { nettoyer(racine); }
});

test('une cle répétée : la ligne du lot le plus récent l’emporte, numéro du jour comparé en nombre', () => {
  const { racine } = bibliotheque();
  try {
    const p = intervention('1');
    ecrireLot(racine, 'essai', '2026-10-02-10.jsonl', [avecValeurs(p, { title: 'Dixième' })]);
    ecrireLot(racine, 'essai', '2026-10-02-2.jsonl', [avecValeurs(p, { title: 'Deuxième' })]);
    ecrireLot(racine, 'essai', '2026-09-30-99.jsonl', [avecValeurs(p, { title: 'Ancienne' })]);
    const r = pr.listerPropositions(racine, 'fr');
    assert.strictEqual(r.propositions.length, 1);
    assert.strictEqual(r.propositions[0].valeurs.title, 'Dixième');
    assert.strictEqual(r.propositions[0].lot, '2026-10-02-10.jsonl');
  } finally { nettoyer(racine); }
});

test('une proposition décidée est masquée, acceptée comme refusée', () => {
  const { racine } = bibliotheque();
  try {
    const a = intervention('1'), b = intervention('2'), c = intervention('3');
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [a, b, c]);
    assert.ok(pr.refuser(racine, a, 'hors-sujet').ok);
    assert.ok(pr.ecrireDecision(racine, { cle: b.cle, decision: 'accepte', fiche: 'AAAAAAAAAAAAAAAA' }).ok);
    const r = pr.listerPropositions(racine, 'fr');
    assert.deepStrictEqual(r.propositions.map((p) => p.cle), [c.cle]);
  } finally { nettoyer(racine); }
});

test('seule la langue demandée est rendue', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [intervention('1'), intervention('2', { langue: 'de' })]);
    assert.deepStrictEqual(pr.listerPropositions(racine, 'fr').propositions.map((p) => p.langue), ['fr']);
    assert.deepStrictEqual(pr.listerPropositions(racine, 'de').propositions.map((p) => p.cle), ['essai:source-exemple:GE:2']);
  } finally { nettoyer(racine); }
});

test('un etat.json illisible est signalé', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [intervention('1')]);
    fs.writeFileSync(path.join(pr.cheminMoissons(racine), 'essai', 'etat.json'), '{ tronqué');
    const r = pr.listerPropositions(racine, 'fr');
    assert.strictEqual(r.etats.essai, null);
    assert.deepStrictEqual(r.avertissements, [{ code: 'etat-illisible', moissonneur: 'essai' }]);
  } finally { nettoyer(racine); }
});

// ---- classer ----------------------------------------------------------------------------

test('classer : une proposition complète, sans doute ni doublon, est un cas A', () => {
  assert.deepStrictEqual(pr.classer(intervention('1')), { cas: 'A', raisons: [] });
});

test('classer : un doute déclaré fait un cas B', () => {
  const p = intervention('1', { doutes: [{ champ: 'categorie', code: 'correspondance-incertaine', detail: 'type harmonisé' }] });
  assert.deepStrictEqual(pr.classer(p), { cas: 'B', raisons: [{ code: 'doute', champ: 'categorie' }] });
});

test('classer : un champ requis vide fait un cas B', () => {
  const p = avecValeurs(intervention('1'), { numero: '' });
  assert.deepStrictEqual(pr.classer(p), { cas: 'B', raisons: [{ code: 'requis-vide', champ: 'numero' }] });
});

test('classer : une date hors format, pour date, date_partielle et annee', () => {
  assert.deepStrictEqual(codes(pr.classer(avecValeurs(intervention('1'), { date: '04.03.2026' })).raisons),
    ['date-hors-format:date']);
  const recherche = {
    format: 'pronto-proposition/1', cle: 'essai:r:1', type: 'recherche', langue: 'fr',
    valeurs: { title: 'Une recherche', institutions: 'Haute école exemple', debut: '2024-09', fin: 'September 2025', descriptif: 'D' }
  };
  assert.deepStrictEqual(codes(pr.classer(recherche).raisons), ['date-hors-format:fin']);
  const livre = {
    format: 'pronto-proposition/1', cle: 'essai:l:1', type: 'livre', langue: 'fr',
    valeurs: { categorie: 'manuel', title: 'Un livre', auteurs: 'A', annee: '26', editeur: 'E', descriptif: 'D', couverture: 'c.png' }
  };
  assert.deepStrictEqual(codes(pr.classer(livre).raisons), ['date-hors-format:annee']);
});

test('classer : un jeton absent de sa liste, liste simple et liste_multiple', () => {
  assert.deepStrictEqual(codes(pr.classer(avecValeurs(intervention('1'), { categorie: 'motion-imaginaire' })).raisons),
    ['jeton-hors-liste:categorie']);
  const film = {
    format: 'pronto-proposition/1', cle: 'essai:f:1', type: 'film', langue: 'fr',
    valeurs: {
      title: 'Un film', categorie: 'documentaire', genre: ['drame', 'western-spaghetti'], pays: ['CH'],
      realisateur: 'R', annee: '2025', descriptif: 'D', couverture: 'c.png'
    }
  };
  assert.deepStrictEqual(codes(pr.classer(film).raisons), ['jeton-hors-liste:genre']);
  film.valeurs.genre = ['drame'];
  assert.deepStrictEqual(pr.classer(film), { cas: 'A', raisons: [] });
});

test('classer : un doublon renseigné fait un cas B', () => {
  const p = intervention('1', { doublon: { uuid: 'BBBBBBBBBBBBBBBB', slug: 'motion', certitude: 'probable' } });
  assert.deepStrictEqual(pr.classer(p), { cas: 'B', raisons: [{ code: 'doublon', champ: null }] });
});

// ---- bloquants --------------------------------------------------------------------------

test('bloquants : un champ en doute non touché bloque', () => {
  const p = avecValeurs(intervention('1', { doutes: [{ champ: 'date', code: 'date-illisible', suggestion: '2026-03-04' }] }), { date: '' });
  assert.deepStrictEqual(pr.bloquants(p, p.valeurs, []), [{ code: 'doute-non-touche', champ: 'date' }]);
});

test('bloquants : un champ en doute touché ne bloque plus, s’il est au format', () => {
  const p = avecValeurs(intervention('1', { doutes: [{ champ: 'date', code: 'date-illisible' }] }), { date: '' });
  const saisies = Object.assign({}, p.valeurs, { date: '2026-03-04' });
  assert.deepStrictEqual(pr.bloquants(p, saisies, ['date']), []);
  const mal = Object.assign({}, p.valeurs, { date: '4 mars' });
  assert.deepStrictEqual(pr.bloquants(p, mal, new Set(['date'])), [{ code: 'date-hors-format', champ: 'date' }]);
});

test('bloquants : un requis vide sans doute ne bloque pas, un jeton hors liste bloque', () => {
  const p = avecValeurs(intervention('1'), { numero: '' });
  assert.deepStrictEqual(pr.bloquants(p, p.valeurs, []), []);
  const saisies = Object.assign({}, p.valeurs, { canton: 'XX' });
  assert.deepStrictEqual(pr.bloquants(p, saisies, ['canton']), [{ code: 'jeton-hors-liste', champ: 'canton' }]);
});

test('bloquants : un doute hors des champs du type (la langue) ne bloque pas', () => {
  const p = intervention('1', { doutes: [{ champ: 'langue', code: 'langue-devinee' }] });
  assert.deepStrictEqual(pr.bloquants(p, p.valeurs, []), []);
});

// ---- Décisions --------------------------------------------------------------------------

test('ecrireDecision écrit Cle, Decision, Motif et Date sous l’empreinte, puis refuse de réécrire', () => {
  const { racine } = bibliotheque();
  try {
    const p = intervention('1');
    const r = pr.refuser(racine, p, 'doublon');
    assert.strictEqual(r.ok, true);
    const chemin = path.join(racine, '_NewsUndActu', '_Moissons', '_Decisions', pr.empreinteCle(p.cle) + '.txt');
    const texte = fs.readFileSync(chemin, 'utf8');
    assert.match(texte, /^Cle: essai:source-exemple:GE:1\n\n----\n\nDecision: refuse\n\n----\n\nMotif: doublon\n\n----\n\nDate: \d{4}-\d{2}-\d{2}\n$/);
    const d = pr.lireDecision(racine, p.cle);
    assert.strictEqual(d.decision, 'refuse');
    assert.strictEqual(d.motif, 'doublon');
    assert.match(d.date, RE_DATE_ISO);

    const encore = pr.ecrireDecision(racine, { cle: p.cle, decision: 'accepte', fiche: 'CCCCCCCCCCCCCCCC' });
    assert.strictEqual(encore.ok, false);
    assert.strictEqual(encore.raison, 'deja-decidee');
    assert.strictEqual(encore.decision.decision, 'refuse');
    assert.strictEqual(fs.readFileSync(chemin, 'utf8'), texte, 'la décision présente reste intacte');
  } finally { nettoyer(racine); }
});

test('refuser : motif vide admis, motif inconnu refusé', () => {
  const { racine } = bibliotheque();
  try {
    assert.strictEqual(pr.refuser(racine, intervention('1'), 'flou').raison, 'motif-inconnu');
    assert.strictEqual(pr.lireDecision(racine, intervention('1').cle), null);
    const r = pr.refuser(racine, intervention('1'));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(pr.lireDecision(racine, intervention('1').cle).motif, '');
  } finally { nettoyer(racine); }
});

test('annulerDecision supprime le fichier, et la proposition réapparait', () => {
  const { racine } = bibliotheque();
  try {
    const p = intervention('1');
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [p]);
    pr.refuser(racine, p, '');
    assert.strictEqual(pr.listerPropositions(racine, 'fr').propositions.length, 0);
    assert.deepStrictEqual(pr.annulerDecision(racine, p.cle), { ok: true });
    assert.ok(!fs.existsSync(pr.cheminDecision(racine, p.cle)));
    assert.strictEqual(pr.listerPropositions(racine, 'fr').propositions.length, 1);
    assert.deepStrictEqual(pr.annulerDecision(racine, p.cle), { ok: false });
  } finally { nettoyer(racine); }
});

// ---- accepter ---------------------------------------------------------------------------

test('accepter au réservoir : décision accepte avec l’Uuid, fiche orpheline du même Uuid', () => {
  const { racine } = bibliotheque();
  try {
    const p = intervention('1');
    const r = pr.accepter(racine, p, p.valeurs, {});
    assert.strictEqual(r.ok, true);
    assert.match(r.uuid, /^[A-Za-z0-9]{16}$/);
    const d = pr.lireDecision(racine, p.cle);
    assert.strictEqual(d.decision, 'accepte');
    assert.strictEqual(d.fiche, r.uuid);
    const f = kc.lireFicheSlugLangue(racine, r.slug, 'fr', 'intervention');
    assert.strictEqual(f.uuid, r.uuid);
    assert.strictEqual(f.ausgabe, '');
    assert.strictEqual(f.valeurs.title, 'Motion d’essai 1');
    assert.strictEqual(kc.lireStatutFiche(racine, 'de', r.uuid), null);
    assert.strictEqual(pr.accepter(racine, p, p.valeurs, {}).raison, 'deja-decidee');
  } finally { nettoyer(racine); }
});

test('accepter refuse une valeur hors format, sans rien écrire', () => {
  const { racine } = bibliotheque();
  try {
    const p = intervention('9');
    const r = pr.accepter(racine, p, Object.assign({}, p.valeurs, { date: '4 mars' }), {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.raison, 'valeurs-hors-format');
    assert.deepStrictEqual(codes(r.ecarts), ['date-hors-format:date']);
    assert.strictEqual(pr.lireDecision(racine, p.cle), null, 'aucune décision');
    assert.deepStrictEqual(kc.listerSlugsBibliotheque(racine), [], 'aucune fiche');
  } finally { nettoyer(racine); }
});

test('accepter dans un numéro : Ausgabe posé et Ordre recalculé', () => {
  const { racine, idRevue } = bibliotheque();
  try {
    const existante = kc.creerFiche(racine, 'fr', 'intervention',
      avecValeurs(intervention('9'), { title: 'Zèbre' }).valeurs, idRevue);
    kc.reordonnerNumero(racine, 'fr', idRevue);
    const p = avecValeurs(intervention('1'), { title: 'Abeille' });
    const r = pr.accepter(racine, p, p.valeurs, { ausgabeId: idRevue });
    assert.strictEqual(r.ok, true);
    const neuve = kc.lireFicheSlugLangue(racine, r.slug, 'fr', 'intervention');
    assert.strictEqual(neuve.ausgabe, idRevue);
    assert.strictEqual(neuve.ordre, 1);
    assert.strictEqual(kc.lireFicheSlugLangue(racine, existante.slug, 'fr', 'intervention').ordre, 2);
  } finally { nettoyer(racine); }
});

test('accepter avec « proposer aussi à l’autre revue » : statut a-traduire dans l’autre langue', () => {
  const { racine } = bibliotheque();
  try {
    const p = intervention('1');
    const r = pr.accepter(racine, p, p.valeurs, { proposerAutreRevue: true });
    assert.strictEqual(kc.lireStatutFiche(racine, 'de', r.uuid).statut, 'a-traduire');
    assert.strictEqual(kc.lireStatutFiche(racine, 'fr', r.uuid), null);
    assert.deepStrictEqual(kc.listerTraductionsATraire(racine, 'de').map((t) => t.uuid), [r.uuid]);
  } finally { nettoyer(racine); }
});

test('accepter : une création qui échoue laisse la décision, raison fiche-introuvable', () => {
  const { racine } = bibliotheque();
  try {
    // Fiches\ est un fichier : la création de la fiche lève.
    fs.mkdirSync(path.join(racine, '_NewsUndActu'), { recursive: true });
    fs.writeFileSync(path.join(racine, '_NewsUndActu', 'Fiches'), 'bloque');
    const p = intervention('1');
    const r = pr.accepter(racine, p, p.valeurs, {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.raison, 'fiche-introuvable');
    assert.match(r.uuid, /^[A-Za-z0-9]{16}$/);
    const d = pr.lireDecision(racine, p.cle);
    assert.ok(d, 'la décision est écrite avant la fiche');
    assert.strictEqual(d.decision, 'accepte');
    assert.strictEqual(d.fiche, r.uuid);
  } finally { nettoyer(racine); }
});

// ---- annulerAcceptation -----------------------------------------------------------------

test('annulerAcceptation : fiche, statut et décision supprimés, Ordre du numéro recalculé', () => {
  const { racine, idRevue } = bibliotheque();
  try {
    const existante = kc.creerFiche(racine, 'fr', 'intervention',
      avecValeurs(intervention('9'), { title: 'Zèbre' }).valeurs, idRevue);
    const p = avecValeurs(intervention('1'), { title: 'Abeille' });
    const r = pr.accepter(racine, p, p.valeurs, { ausgabeId: idRevue, proposerAutreRevue: true });
    const dossier = kc.cheminFiche(racine, 'intervention', r.slug);
    assert.ok(fs.existsSync(dossier));
    assert.deepStrictEqual(pr.annulerAcceptation(racine, p.cle), { ok: true, ficheSupprimee: true });
    assert.ok(!fs.existsSync(dossier), 'le dossier vide part');
    assert.strictEqual(pr.lireDecision(racine, p.cle), null);
    assert.strictEqual(kc.lireStatutFiche(racine, 'de', r.uuid), null);
    assert.strictEqual(kc.lireFicheSlugLangue(racine, existante.slug, 'fr', 'intervention').ordre, 1);
    assert.strictEqual(pr.annulerAcceptation(racine, p.cle).raison, 'pas-acceptee');
  } finally { nettoyer(racine); }
});

test('annulerAcceptation ne touche que le fichier de sa langue, et un même slug d’un autre type', () => {
  const { racine } = bibliotheque();
  try {
    const p = avecValeurs(intervention('1'), { title: 'Même titre' });
    const r = pr.accepter(racine, p, p.valeurs, {});
    const dossier = kc.cheminFiche(racine, 'intervention', r.slug);
    fs.writeFileSync(path.join(dossier, 'couverture-etrangere.png'), 'x');
    fs.writeFileSync(path.join(dossier, 'intervention.de.txt'), 'Title: Anderer\n\n----\n\nUuid: DDDDDDDDDDDDDDDD\n');
    const livre = kc.creerFiche(racine, 'fr', 'livre',
      { categorie: 'manuel', title: 'Même titre', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, '');
    assert.strictEqual(livre.slug, r.slug);
    assert.strictEqual(pr.annulerAcceptation(racine, p.cle).ficheSupprimee, true);
    assert.deepStrictEqual(fs.readdirSync(dossier).sort(), ['couverture-etrangere.png', 'intervention.de.txt']);
    assert.ok(kc.lireFicheSlugLangue(racine, livre.slug, 'fr', 'livre'), 'le livre du même slug reste');
  } finally { nettoyer(racine); }
});

test('annulerAcceptation après une création échouée : seule la décision part', () => {
  const { racine } = bibliotheque();
  try {
    const p = intervention('1');
    pr.ecrireDecision(racine, { cle: p.cle, decision: 'accepte', fiche: 'EEEEEEEEEEEEEEEE' });
    assert.deepStrictEqual(pr.annulerAcceptation(racine, p.cle), { ok: true, ficheSupprimee: false });
    assert.strictEqual(pr.lireDecision(racine, p.cle), null);
  } finally { nettoyer(racine); }
});

// ---- creerFiche et uuidImpose -----------------------------------------------------------

const LIVRE = { categorie: 'manuel', title: 'Un livre', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' };
function texteFiche(racine, type, slug, langue) {
  return fs.readFileSync(path.join(kc.cheminFiche(racine, type, slug), type + '.' + langue + '.txt'), 'utf8');
}

test('creerFiche avec uuidImpose : la fiche porte cet Uuid', () => {
  const { racine } = bibliotheque();
  try {
    const c = kc.creerFiche(racine, 'fr', 'livre', LIVRE, '', null, null, 'Impose0123456789');
    assert.strictEqual(c.uuid, 'Impose0123456789');
    assert.strictEqual(kc.lireFicheSlugLangue(racine, c.slug, 'fr', 'livre').uuid, 'Impose0123456789');
  } finally { nettoyer(racine); }
});

test('creerFiche refuse un uuidImpose mal formé', () => {
  const { racine } = bibliotheque();
  try {
    for (const mauvais of ['court', 'Impose012345678!', 'Impose01234567890', 42]) {
      assert.throws(() => kc.creerFiche(racine, 'fr', 'livre', LIVRE, '', null, null, mauvais), /uuid/i);
    }
    assert.deepStrictEqual(kc.listerSlugsBibliotheque(racine), [], 'rien n’est écrit');
  } finally { nettoyer(racine); }
});

// Le texte attendu a été relevé sur creerFiche avant l'ajout de uuidImpose ; seul l'Uuid,
// tiré au hasard, est relu dans la fiche écrite.
const ATTENDUS = {
  simple: 'Title: Un livre\n\n----\n\nUuid: {uuid}\n\n----\n\nAusgabe: \n\n----\n\nCategorie: manuel\n\n----\n\n'
    + 'Auteurs: A\n\n----\n\nAnnee: 2026\n\n----\n\nEditeur: E\n\n----\n\nDescriptif: D\n',
  origine: 'Title: Un livre\n\n----\n\nUuid: {uuid}\n\n----\n\nAusgabe: AbCdEfGh12345678\n\n----\n\n'
    + 'Origine: OrigineXYZ012345\n\n----\n\nCategorie: manuel\n\n----\n\nAuteurs: A\n\n----\n\nAnnee: 2026\n\n----\n\n'
    + 'Editeur: E\n\n----\n\nDescriptif: D\n',
  image: 'Title: Un livre\n\n----\n\nUuid: {uuid}\n\n----\n\nAusgabe: \n\n----\n\nCategorie: manuel\n\n----\n\n'
    + 'Auteurs: A\n\n----\n\nAnnee: 2026\n\n----\n\nEditeur: E\n\n----\n\nDescriptif: D\n\n----\n\nCouverture:\n\n- couv.png\n'
};

test('creerFiche sans uuidImpose écrit octet pour octet le fichier d’avant, avec origine et avec image', () => {
  const { racine } = bibliotheque();
  const depot = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-propositions-depot-'));
  try {
    const image = path.join(depot, 'carte__couv.png');
    fs.writeFileSync(image, 'x');
    const cas = {
      simple: () => kc.creerFiche(racine, 'fr', 'livre', LIVRE, ''),
      origine: () => kc.creerFiche(racine, 'fr', 'livre', LIVRE, 'AbCdEfGh12345678', null, 'OrigineXYZ012345'),
      image: () => kc.creerFiche(racine, 'fr', 'livre', LIVRE, '', image)
    };
    for (const nom of Object.keys(cas)) {
      const c = cas[nom]();
      assert.match(c.uuid, /^[A-Za-z0-9]{16}$/);
      const ecrit = fs.readFileSync(path.join(kc.cheminFiche(racine, 'livre', c.slug), 'livre.fr.txt'));
      assert.ok(ecrit.equals(Buffer.from(ATTENDUS[nom].replace('{uuid}', c.uuid), 'utf8')), 'octets différents : ' + nom);
    }
    // Le même appel avec l'Uuid imposé écrit les mêmes octets.
    const libre = kc.creerFiche(racine, 'fr', 'livre', LIVRE, '', image, 'OrigineXYZ012345');
    const autre = bibliotheque();
    try {
      const impose = kc.creerFiche(autre.racine, 'fr', 'livre', LIVRE, '', image, 'OrigineXYZ012345', libre.uuid);
      assert.strictEqual(impose.slug, 'un-livre');
      assert.ok(Buffer.from(texteFiche(autre.racine, 'livre', impose.slug, 'fr'))
        .equals(Buffer.from(texteFiche(racine, 'livre', libre.slug, 'fr'))));
    } finally { nettoyer(autre.racine); }
  } finally { nettoyer(racine); nettoyer(depot); }
});

// ---- Compte de l'arbre, en cache ----------------------------------------------------------

// Compte les lectures de lots pendant `fn` : le cache se juge à ce qu'il ne relit pas.
function lecturesDeLots(fn) {
  const origine = fs.readFileSync;
  let n = 0;
  fs.readFileSync = function (chemin) {
    if (/\.jsonl$/.test(String(chemin))) { n++; }
    return origine.apply(fs, arguments);
  };
  try { fn(); } finally { fs.readFileSync = origine; }
  return n;
}

test('compterPropositions : en attente et cas B, dans la langue demandée', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [
      intervention('1'),
      intervention('2', { doutes: [{ champ: 'date', code: 'date-illisible', detail: 'mois en lettres' }] }),
      intervention('3', { langue: 'de' })
    ]);
    assert.deepStrictEqual(pr.compterPropositions(racine, 'fr'), { total: 2, aVerifier: 1 });
    assert.deepStrictEqual(pr.compterPropositions(racine, 'de'), { total: 1, aVerifier: 0 });
  } finally { nettoyer(racine); }
});

test('compterPropositions : un lot inchangé n’est pas relu, un lot ou une décision de plus si', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [intervention('1'), intervention('2')]);
    assert.strictEqual(lecturesDeLots(() => pr.compterPropositions(racine, 'fr')), 1);
    let compte;
    assert.strictEqual(lecturesDeLots(() => { compte = pr.compterPropositions(racine, 'fr'); }), 0,
      'un lot inchangé a été relu');
    assert.deepStrictEqual(compte, { total: 2, aVerifier: 0 });

    ecrireLot(racine, 'essai', '2026-10-03-1.jsonl', [intervention('3')]);
    assert.strictEqual(lecturesDeLots(() => { compte = pr.compterPropositions(racine, 'fr'); }), 2);
    assert.deepStrictEqual(compte, { total: 3, aVerifier: 0 });

    assert.ok(pr.refuser(racine, intervention('1')).ok);
    assert.deepStrictEqual(pr.compterPropositions(racine, 'fr'), { total: 2, aVerifier: 0 },
      'une décision écrite doit sortir la proposition du compte');
    // Le dossier des décisions existe désormais : seule sa propre date dit qu'une décision s'ajoute.
    assert.ok(pr.refuser(racine, intervention('2')).ok);
    assert.deepStrictEqual(pr.compterPropositions(racine, 'fr'), { total: 1, aVerifier: 0 },
      'une seconde décision doit aussi sortir sa proposition du compte');
  } finally { nettoyer(racine); }
});

// ---- Ordre de la vue ----------------------------------------------------------------------

test('ordonner : les cas B en tête, puis l’ordre `tri` du contrat (CH d’abord, puis le titre)', () => {
  const doublon = { uuid: 'x', slug: 'y', certitude: 'probable' };
  const liste = [
    avecValeurs(intervention('1'), { canton: 'VD', title: 'Bêta' }),
    avecValeurs(intervention('2'), { canton: 'CH', title: 'Zêta' }),
    avecValeurs(intervention('3'), { canton: 'GE', title: 'Alpha' }),
    Object.assign(avecValeurs(intervention('4'), { canton: 'VD', title: 'Oméga' }), { doublon: doublon })
  ];
  const r = pr.ordonner(liste, 'fr');
  assert.deepStrictEqual(r.map((p) => p.valeurs.title), ['Oméga', 'Zêta', 'Alpha', 'Bêta']);
  assert.deepStrictEqual(r.map((p) => p.cas), ['B', 'A', 'A', 'A']);
  assert.deepStrictEqual(codes(r[0].raisons), ['doublon:null']);
});

test('listerRefusees : les refus de cette langue, avec leur motif', () => {
  const { racine } = bibliotheque();
  try {
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [intervention('1'), intervention('2'), intervention('3', { langue: 'de' })]);
    pr.refuser(racine, intervention('1'), 'hors-sujet');
    pr.refuser(racine, intervention('3'));
    const r = pr.listerRefusees(racine, 'fr');
    assert.deepStrictEqual(r.map((p) => [p.cle, p.motif]), [['essai:source-exemple:GE:1', 'hors-sujet']]);
  } finally { nettoyer(racine); }
});

// ---- Gestes en lot --------------------------------------------------------------------------

test('accepterLot : les cas A seulement ; un cas B passe depuis son détail s’il n’a rien qui bloque', () => {
  const { racine, idRevue } = bibliotheque();
  try {
    const a = intervention('1');
    const bDoute = intervention('2', { doutes: [{ champ: 'date', code: 'date-illisible', detail: 'x' }] });
    const bDoublon = intervention('3', { doublon: { uuid: 'u', slug: 's', certitude: 'probable' } });
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', [a, bDoute, bDoublon]);
    const r = pr.accepterLot(racine, 'fr', [{ cle: a.cle, aussi: true }, { cle: bDoute.cle }, { cle: bDoublon.cle }],
      { ausgabeId: idRevue });
    assert.deepStrictEqual(r.faites, [a.cle]);
    assert.deepStrictEqual(r.ignorees.map((x) => x.cle).sort(), [bDoute.cle, bDoublon.cle].sort());
    const d = pr.lireDecision(racine, a.cle);
    assert.strictEqual(d.decision, 'accepte');
    assert.strictEqual(kc.lireStatutFiche(racine, 'de', d.fiche).statut, 'a-traduire', '« aussi » se passe par proposition');
    assert.strictEqual(pr.lireDecision(racine, bDoute.cle), null);

    const seul = pr.accepterLot(racine, 'fr', [{ cle: bDoublon.cle }], { ausgabeId: '', depuisDetail: true });
    assert.deepStrictEqual(seul.faites, [bDoublon.cle], 'un doublon probable n’a rien à toucher : son détail l’accepte');
    assert.strictEqual(kc.lireStatutFiche(racine, 'de', pr.lireDecision(racine, bDoublon.cle).fiche), null);
    const bloque = pr.accepterLot(racine, 'fr', [{ cle: bDoute.cle }], { ausgabeId: '', depuisDetail: true });
    assert.deepStrictEqual(bloque.faites, []);
    assert.deepStrictEqual(bloque.ignorees, [{ cle: bDoute.cle, raison: 'a-verifier' }]);
  } finally { nettoyer(racine); }
});

test('refuserLot puis annulerLot : un lot entier se défait, acceptations comprises', () => {
  const { racine, idRevue } = bibliotheque();
  try {
    const l = ['1', '2', '3'].map((i) => intervention(i));
    ecrireLot(racine, 'essai', '2026-10-02-1.jsonl', l);
    const refus = pr.refuserLot(racine, 'fr', [l[0].cle, l[1].cle], 'hors-sujet');
    assert.deepStrictEqual(refus.faites, [l[0].cle, l[1].cle]);
    assert.strictEqual(pr.lireDecision(racine, l[1].cle).motif, 'hors-sujet');
    const acc = pr.accepterLot(racine, 'fr', [{ cle: l[2].cle }], { ausgabeId: idRevue });
    const uuid = pr.lireDecision(racine, l[2].cle).fiche;
    assert.strictEqual(kc.listerFichesNumero(racine, 'fr', idRevue).length, 1);

    const r = pr.annulerLot(racine, refus.faites.concat(acc.faites));
    assert.deepStrictEqual(r.faites.sort(), l.map((p) => p.cle).sort());
    assert.strictEqual(r.fichesSupprimees, 1);
    for (const p of l) { assert.strictEqual(pr.lireDecision(racine, p.cle), null); }
    assert.strictEqual(kc.listerFichesNumero(racine, 'fr', idRevue).length, 0);
    assert.strictEqual(kc.trouverSlugParUuid(racine, 'fr', uuid), null);
    assert.strictEqual(pr.listerPropositions(racine, 'fr').propositions.length, 3);
  } finally { nettoyer(racine); }
});

test('ficheDoublon : la fiche existante que désigne un doublon probable', () => {
  const { racine, idRevue } = bibliotheque();
  try {
    const f = kc.creerFiche(racine, 'fr', 'livre', LIVRE, idRevue);
    const p = { type: 'livre', langue: 'fr', doublon: { uuid: f.uuid, slug: f.slug, certitude: 'probable' } };
    const d = pr.ficheDoublon(racine, p);
    assert.strictEqual(d.valeurs.title, 'Un livre');
    assert.strictEqual(d.ausgabe, idRevue);
    assert.strictEqual(pr.ficheDoublon(racine, Object.assign({}, p, { doublon: { uuid: 'autre', slug: f.slug } })), null);
    assert.strictEqual(pr.ficheDoublon(racine, { type: 'livre', langue: 'fr', doublon: null }), null);
  } finally { nettoyer(racine); }
});
