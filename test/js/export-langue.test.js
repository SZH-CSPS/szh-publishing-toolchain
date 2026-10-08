// Fichier de langue de l'interface : la copie de tous les libellés du cockpit, français et
// allemand côte à côte, qu'on envoie à qui relit.
//
// On vérifie :
//   * que l'export est complet. Un export à moitié vide se lit comme un export entier, et
//     les libellés manquants ne seraient jamais relus. Il contient TEXTES_COCKPIT
//     (lib/i18n.js) et les deux package.nls*.json (titres de commandes, tutoriel) ;
//   * qu'une clé absente d'une langue sort avec `null` en face, pour que le relecteur la
//     voie ;
//   * que l'ordre est stable (par source puis par clé), pour comparer deux envois ;
//   * que les valeurs sont intactes (apostrophes, insécables, guillemets, marqueurs {0}) :
//     le relecteur corrige la chaîne affichée ;
//   * que l'en-tête porte le schéma et la version.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const exp = require(path.join(COCKPIT, 'lib', 'export-langue.js'));
const { TEXTES_COCKPIT } = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const lireJson = (nom) => JSON.parse(fs.readFileSync(path.join(COCKPIT, nom), 'utf8'));
const NLS = { fr: lireJson('package.nls.json'), de: lireJson('package.nls.de.json') };
const VERSION = String(lireJson('package.json').version);

// L'export tel que l'hôte le fabrique, avec les vraies tables du dépôt.
function exportReel() {
  return exp.construire({
    cockpit: TEXTES_COCKPIT,
    commandes: NLS,
    version: VERSION,
    lire: { fr: 'copie', de: 'Kopie' }
  });
}

// Les entrées d'une source, indexées par clé.
function parCle(objet, source) {
  const index = new Map();
  for (const e of objet.entrees) { if (e.source === source) { index.set(e.cle, e); } }
  return index;
}

test('aucune clé perdue : les deux tables du cockpit et les deux package.nls y sont', () => {
  const objet = exportReel();
  const cockpit = parCle(objet, 'cockpit');
  const commandes = parCle(objet, 'commandes');

  for (const langue of ['fr', 'de']) {
    for (const cle of Object.keys(TEXTES_COCKPIT[langue])) {
      const e = cockpit.get(cle);
      assert.ok(e, 'clé du cockpit absente de l’export (' + langue + ') : ' + cle);
      assert.strictEqual(e[langue], TEXTES_COCKPIT[langue][cle],
        'valeur divergente pour ' + cle + ' (' + langue + ')');
    }
    for (const cle of Object.keys(NLS[langue])) {
      const e = commandes.get(cle);
      assert.ok(e, 'clé de package.nls absente de l’export (' + langue + ') : ' + cle);
      assert.strictEqual(e[langue], NLS[langue][cle],
        'valeur divergente pour ' + cle + ' (' + langue + ')');
    }
  }

  // Rien d'inventé : le compte est celui de l'union des deux langues.
  const union = (paire) => new Set(Object.keys(paire.fr).concat(Object.keys(paire.de)));
  assert.strictEqual(cockpit.size, union(TEXTES_COCKPIT).size, 'le compte des libellés du cockpit ne tombe pas juste');
  assert.strictEqual(commandes.size, union(NLS).size, 'le compte des titres de commandes ne tombe pas juste');
  assert.strictEqual(objet.entrees.length, cockpit.size + commandes.size, 'des entrées d’une autre source se sont glissées là');
});

test('une clé absente d’une langue sort quand même, avec null en face', () => {
  const objet = exp.construire({
    cockpit: { fr: { 'a.seul': 'Seulement en français', commun: 'Deux' }, de: { commun: 'Zwei' } },
    commandes: { fr: {}, de: { 'cmd.seul': 'Nur auf Deutsch' } },
    version: '1.0.0', lire: { fr: '', de: '' }
  });
  const cockpit = parCle(objet, 'cockpit');
  assert.ok(cockpit.has('a.seul'), 'la clé présente d’un seul côté a été escamotée');
  assert.strictEqual(cockpit.get('a.seul').fr, 'Seulement en français');
  assert.strictEqual(cockpit.get('a.seul').de, null, 'le trou est masqué au lieu d’être dit');
  const commandes = parCle(objet, 'commandes');
  assert.strictEqual(commandes.get('cmd.seul').fr, null, 'le trou est masqué au lieu d’être dit');
  assert.strictEqual(commandes.get('cmd.seul').de, 'Nur auf Deutsch');
  // Une chaîne vide est une valeur, distincte d'une clé absente.
  const vide = exp.construire({ cockpit: { fr: { x: '' }, de: { x: '' } }, commandes: {}, version: '1', lire: {} });
  assert.strictEqual(parCle(vide, 'cockpit').get('x').fr, '', 'une valeur vide est prise pour un trou');
});

test('l’ordre est stable : deux exports des mêmes tables se comparent ligne à ligne', () => {
  const a = exportReel();
  const b = exportReel();
  assert.deepStrictEqual(b.entrees, a.entrees, 'deux exports des mêmes tables donnent deux ordres');

  // Trié par source puis par clé, et non par ordre d'insertion.
  const desordre = exp.construire({
    cockpit: { fr: { zz: 'z', aa: 'a', mm: 'm' }, de: { mm: 'm', aa: 'a' } },
    commandes: { fr: { 'cmd.b': 'b', 'cmd.a': 'a' }, de: {} },
    version: '1', lire: {}
  });
  assert.deepStrictEqual(desordre.entrees.map((e) => e.source + '/' + e.cle),
    ['cockpit/aa', 'cockpit/mm', 'cockpit/zz', 'commandes/cmd.a', 'commandes/cmd.b']);
});

test('les valeurs ne sont pas retouchées : apostrophes, insécables, guillemets, {0}', () => {
  const APO = '’';
  const NBSP = ' ';
  const brut = {
    'a.apo': 'L' + APO + 'article n' + APO + 'a pas de titre',
    'a.nbsp': 'Impossible' + NBSP + ': {0} ({1})',
    'a.guill': '«' + NBSP + '{0}' + NBSP + '»',
    'a.droite': "L'apostrophe droite reste droite",
    'a.tiret': 'un tiret – d’incise'
  };
  const objet = exp.construire({ cockpit: { fr: brut, de: {} }, commandes: {}, version: '1', lire: {} });
  const cockpit = parCle(objet, 'cockpit');
  for (const cle of Object.keys(brut)) {
    assert.strictEqual(cockpit.get(cle).fr, brut[cle], 'valeur retouchée : ' + cle);
  }
  // L'aller-retour JSON ne perd rien non plus.
  const relu = JSON.parse(exp.serialiser(objet));
  for (const e of relu.entrees) {
    if (e.fr !== null) { assert.strictEqual(e.fr, brut[e.cle], 'valeur altérée par la sérialisation : ' + e.cle); }
  }

  // Même vérification sur les tables du dépôt, qui portent ces caractères.
  const reel = parCle(exportReel(), 'cockpit');
  const avecApo = Object.keys(TEXTES_COCKPIT.fr).filter((c) => String(TEXTES_COCKPIT.fr[c]).indexOf(APO) !== -1);
  assert.ok(avecApo.length > 0, 'plus aucune apostrophe typographique dans lib/i18n.js ?');
  for (const cle of avecApo) { assert.strictEqual(reel.get(cle).fr, TEXTES_COCKPIT.fr[cle]); }
});

test('l’en-tête dit le schéma, la version, les langues et ce qu’est ce fichier', () => {
  const objet = exportReel();
  assert.strictEqual(objet.schema, 'szh-langue/1');
  assert.strictEqual(objet.extension, 'szh-cockpit');
  assert.strictEqual(objet.version, VERSION);
  assert.deepStrictEqual(objet.langues, ['fr', 'de']);
  // L'horodatage porte son fuseau : sans lui, l'heure se relit à une heure près.
  assert.match(objet.genere, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  // Un JSON n'a pas de commentaire : _lire explique ce qu'est le fichier.
  const dit = exp.construire({
    cockpit: {}, commandes: {}, version: '1',
    lire: { fr: 'Ce fichier est une COPIE.', de: 'Diese Datei ist eine KOPIE.' }
  });
  assert.strictEqual(dit._lire.fr, 'Ce fichier est une COPIE.');
  assert.strictEqual(dit._lire.de, 'Diese Datei ist eine KOPIE.');
  // Le nom proposé porte la version affichée ce jour-là.
  assert.strictEqual(exp.nomFichier(VERSION), 'langue-szh-cockpit-' + VERSION + '.json');
});

// ---- Le bouton, dans le DOM ----
//
// On rend la page des réglages (onglet Paramètres de l'Accueil, avec media/accueil.js) et on
// y cherche le bouton : une fonction juste ne garantit pas que la page l'affiche. Les
// libellés sont ceux de l'hôte (textesAccueil), chargés par page-reglages.js.
const { ouvrirReglages } = require('./page-reglages');

function textesDe(racine) {
  const sortie = [];
  const visiter = (e) => {
    if (e._texte) { sortie.push(e._texte); }
    for (const c of e.enfants) { visiter(c); }
  };
  visiter(racine);
  return sortie;
}

test('réglages : le bouton du fichier de langue est dans la page, et parle', () => {
  const page = ouvrirReglages();
  const zones = page.panneau;
  const boutons = zones.querySelectorAll('button');
  const libelle = TEXTES_COCKPIT.fr['regl.exportLangue'];
  const vu = boutons.filter((b) => b.textContent === libelle);
  assert.strictEqual(vu.length, 1,
    'le bouton « ' + libelle + ' » n’est pas dans la page de réglages ; boutons vus : '
    + JSON.stringify(boutons.map((b) => b.textContent)));
  // Son explication est affichée : le libellé seul ne dit pas à quoi sert le fichier.
  assert.ok(textesDe(zones).includes(TEXTES_COCKPIT.fr['accueil.regl.fichier.aide']),
    'le bouton est là, mais rien ne dit à quoi sert le fichier');
  // Et il envoie un message à l’hôte.
  vu[0].dispatchEvent({ type: 'click' });
  assert.ok(page.messages.some((m) => m.type === 'exporterLangue'),
    'le clic n’envoie rien à l’hôte ; messages vus : ' + JSON.stringify(page.messages));
});
