// Fichier de langue de l'interface : la copie de tous les libellés du cockpit, français et
// allemand côte à côte, qu'on envoie à qui relit.
//
//   node --test "test/js/export-langue.test.js"
//
// Ce que ce fichier garde :
//   * l'EXPORT COMPLET. C'est le seul défaut qui compte vraiment ici. Un export qui perd la
//     moitié des clés se lit exactement comme un export entier : le fichier s'ouvre, les
//     entrées sont bien formées, la relecture se fait — et les libellés absents ne sont
//     jamais relus, sans que personne ne s'en aperçoive. Les DEUX sources doivent y être :
//     TEXTES_COCKPIT (lib/i18n.js) ET les deux package.nls*.json, qui portent les titres de
//     commandes et le tutoriel, donc du texte que la personne voit aussi.
//   * le TROU QUI SE VOIT. Une clé absente d'une langue sort avec `null` en face. Escamoter
//     l'entrée reviendrait à cacher au relecteur précisément ce qu'on voudrait qu'il voie.
//   * l'ORDRE STABLE. Deux exports des mêmes tables doivent se comparer ligne à ligne : un
//     tri qui dépend de la locale ou de l'ordre d'insertion rendrait tout diff illisible, et
//     personne ne saurait dire ce qui a changé entre deux envois.
//   * les VALEURS INTACTES. Apostrophes typographiques, espaces insécables, guillemets,
//     marqueurs {0} : une normalisation ferait relire un texte que personne ne voit à
//     l'écran, et les corrections reviendraient sur une autre chaîne que celle affichée.
//   * l'EN-TÊTE. Schéma et version : un fichier relu six mois plus tard doit dire à quelle
//     grammaire et à quelle livraison il se rapporte.
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

  // Et rien d'inventé au passage : le compte est celui de l'union des deux langues.
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
  // Une chaîne vide EST une valeur : elle ne doit pas se confondre avec un trou.
  const vide = exp.construire({ cockpit: { fr: { x: '' }, de: { x: '' } }, commandes: {}, version: '1', lire: {} });
  assert.strictEqual(parCle(vide, 'cockpit').get('x').fr, '', 'une valeur vide est prise pour un trou');
});

test('l’ordre est stable : deux exports des mêmes tables se comparent ligne à ligne', () => {
  const a = exportReel();
  const b = exportReel();
  assert.deepStrictEqual(b.entrees, a.entrees, 'deux exports des mêmes tables donnent deux ordres');

  // Trié par source puis par clé, et non par ordre d'insertion : c'est ce tri-là qui rend
  // un diff lisible d'un envoi à l'autre.
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
  // Et à travers la sérialisation : l'aller-retour JSON ne doit rien perdre non plus.
  const relu = JSON.parse(exp.serialiser(objet));
  for (const e of relu.entrees) {
    if (e.fr !== null) { assert.strictEqual(e.fr, brut[e.cle], 'valeur altérée par la sérialisation : ' + e.cle); }
  }

  // Les vraies tables du dépôt portent ces caractères : on le vérifie là aussi, sans quoi
  // le contrôle ci-dessus n'éprouverait qu'un jeu d'essai complaisant.
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
  // Un JSON ne porte pas de commentaire : _lire est le seul endroit où dire que ce fichier
  // est une copie. Vide, personne ne saurait quoi en faire.
  const dit = exp.construire({
    cockpit: {}, commandes: {}, version: '1',
    lire: { fr: 'Ce fichier est une COPIE.', de: 'Diese Datei ist eine KOPIE.' }
  });
  assert.strictEqual(dit._lire.fr, 'Ce fichier est une COPIE.');
  assert.strictEqual(dit._lire.de, 'Diese Datei ist eine KOPIE.');
  // Le nom proposé porte la version : un fichier relu plus tard se raccroche à ce qui était
  // affiché ce jour-là.
  assert.strictEqual(exp.nomFichier(VERSION), 'langue-szh-cockpit-' + VERSION + '.json');
});

// ---- Le bouton, dans le DOM, par le chemin réel ----
//
// Le défaut gardé ici a été vécu la veille, avec la pastille du vérificateur de traduction :
// le module était juste, ses tests verts, et le bouton ne s'affichait nulle part. Éprouver
// ce qu'une fonction rend ne dit RIEN de ce qu'une page montre. On rend donc la vraie page
// de réglages, avec le vrai media/settings.js, et on y cherche le bouton.
//
// Deux détails de montage, tous deux appris en se trompant : les libellés viennent de
// REGL_LIBELLES (REGL_TEXTES n'en est que la sérialisation, et n'en porte aucun), et la page
// des réglages pose tout dans l'élément « zones », que le conteneur par défaut du harnais ne
// connaît pas — d'où parId.
const { ouvrir, libellesHote } = require('./dom-minimal');

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
  const page = ouvrir({
    racine: RACINE, page: 'settings',
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    txt: libellesHote(RACINE, ['REGL_LIBELLES'])
  });
  const zones = page.parId.zones;
  const boutons = zones.querySelectorAll('button');
  const libelle = TEXTES_COCKPIT.fr['regl.exportLangue'];
  const vu = boutons.filter((b) => b.textContent === libelle);
  assert.strictEqual(vu.length, 1,
    'le bouton « ' + libelle + ' » n’est pas dans la page de réglages ; boutons vus : '
    + JSON.stringify(boutons.map((b) => b.textContent)));
  // Son explication est là aussi : un bouton qui enregistre un fichier pour l’envoyer à
  // quelqu’un ne se devine pas de son seul libellé.
  assert.ok(textesDe(zones).includes(TEXTES_COCKPIT.fr['regl.exportLangue.aide']),
    'le bouton est là, mais rien ne dit à quoi sert le fichier');
  // Et il parle à l’hôte : un bouton muet serait le même défaut, une fois de plus.
  vu[0].dispatchEvent({ type: 'click' });
  assert.ok(page.messages.some((m) => m.type === 'exporterLangue'),
    'le clic n’envoie rien à l’hôte ; messages vus : ' + JSON.stringify(page.messages));
});
