// « Quoi de neuf » : ce que la fenêtre a le droit de montrer, et à qui.
//
//   node --test "test/js/nouveautes.test.js"
//
// La règle tient en une phrase : on annonce un MEDIUM, jamais une mineure. À deux releases
// par jour — quarante et une pour le seul mois de septembre 2026 — une fenêtre qui s'ouvre à
// chaque correction ne serait plus lue au bout d'une semaine. Ce fichier garde les quatre
// décisions qui en découlent, plus la forme du fichier de notes lui-même : il est livré avec
// le toolkit et personne ne le relit avant qu'une rédactrice ne l'ouvre.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const FICHIER_NOTES = path.join(RACINE, 'nouveautes.json');

const { notesAMontrer, comparerMediums, estMedium, lireTable } =
  require(path.join(COCKPIT, 'lib', 'nouveautes.js'));
const { mediumVersion } = require(path.join(COCKPIT, 'lib', 'archivage.js'));

const TABLE = {
  '_lisez-moi': ['une clé de service, jamais une note'],
  '1.0': { fr: { titre: 'Un', points: ['premier'] }, de: { titre: 'Eins', points: ['erstens'] } },
  '1.1': { fr: { titre: 'Deux', points: ['deuxième'] }, de: { titre: 'Zwei', points: ['zweitens'] } },
  '1.2': { fr: { titre: 'Trois', points: ['troisième'] }, de: { titre: 'Drei', points: ['drittens'] } },
  '2.0': { fr: { titre: 'Quatre', points: ['quatrième'] }, de: { titre: 'Vier', points: ['viertens'] } }
};

const titres = (notes) => notes.map((n) => n.medium);

// ---- Le medium, unité d'annonce -------------------------------------------------------

test('le medium se lit sur deux nombres, et l’ancienne ère n’en a pas', () => {
  assert.strictEqual(mediumVersion('1.2.13'), '1.2');
  assert.strictEqual(mediumVersion('v1.2.13'), '1.2');
  assert.strictEqual(mediumVersion('1.10.0'), '1.10');
  // 2026 est une année : l'ancienne numérotation ne porte pas de medium, donc rien ne
  // s'annonce pour elle — ce qui est juste, aucune note n'a jamais été écrite.
  assert.strictEqual(mediumVersion('2026.09.42'), '');
  assert.strictEqual(mediumVersion('0.0.0-dev+f153f92'), '');
  assert.strictEqual(mediumVersion(''), '');
});

test('1.10 est plus récent que 1.9 — la comparaison porte sur des nombres', () => {
  assert.ok(comparerMediums('1.10', '1.9') > 0, '1.10 classé sous 1.9 : comparaison de chaînes');
  assert.ok(comparerMediums('2.0', '1.99') > 0);
  assert.strictEqual(comparerMediums('1.2', '1.2'), 0);
  assert.ok(estMedium('1.2') && !estMedium('1.2.3') && !estMedium('_lisez-moi'));
});

// ---- Ce que la fenêtre montre ---------------------------------------------------------

test('une mineure n’annonce rien : même medium des deux côtés, aucune note', () => {
  assert.deepStrictEqual(notesAMontrer('1.2', '1.2', TABLE, 'fr'), []);
});

test('un saut de plusieurs mediums les montre tous, du plus récent au plus ancien', () => {
  assert.deepStrictEqual(titres(notesAMontrer('1.0', '2.0', TABLE, 'fr')), ['2.0', '1.2', '1.1']);
});

test('jamais la note d’un medium que ce poste n’a pas encore', () => {
  // Le fichier voyage avec le toolkit et ne peut pas porter plus récent que lui — mais une
  // note d'avance annoncerait une fonction introuvable, et c'est le pire des messages.
  assert.deepStrictEqual(titres(notesAMontrer('1.0', '1.1', TABLE, 'fr')), ['1.1']);
});

test('personne n’a rien vu : seule la note du jour, pas tout l’historique', () => {
  // Un poste neuf n'a pas de « nouveautés » — tout y est nouveau. Dérouler quatre notes à
  // la première ouverture serait un mur de texte devant quelqu'un qui découvre l'outil.
  assert.deepStrictEqual(titres(notesAMontrer('', '2.0', TABLE, 'fr')), ['2.0']);
});

test('une version de poste illisible ne montre rien', () => {
  // Poste de développement (0.0.0-dev) : le logiciel y est celui du dépôt ouvert, et aucune
  // note ne décrit ce qu'il contient à cet instant.
  assert.deepStrictEqual(notesAMontrer('1.0', '', TABLE, 'fr'), []);
  assert.deepStrictEqual(notesAMontrer('1.0', '2026.09.42', TABLE, 'fr'), []);
});

test('un medium vu plus récent que l’installé — un retour en arrière — ne montre rien', () => {
  assert.deepStrictEqual(notesAMontrer('2.0', '1.1', TABLE, 'fr'), []);
});

test('la langue de l’interface décide, et le français sert de repli', () => {
  assert.strictEqual(notesAMontrer('1.1', '1.2', TABLE, 'de')[0].titre, 'Drei');
  assert.strictEqual(notesAMontrer('1.1', '1.2', TABLE, 'fr')[0].titre, 'Trois');
  const sansAllemand = { '1.2': { fr: { titre: 'Trois', points: ['troisième'] } } };
  assert.strictEqual(notesAMontrer('1.1', '1.2', sansAllemand, 'de')[0].titre, 'Trois',
    'une note sans traduction devrait retomber sur le français plutôt que disparaître');
});

test('les clés de service et les notes vides sont ignorées', () => {
  const bancal = {
    '_lisez-moi': ['mode d’emploi'],
    'pas-un-medium': { fr: { titre: 'x', points: ['y'] } },
    '1.1': { fr: { titre: 'Vide', points: ['', '   '] } },
    '1.2': { fr: { titre: 'Bonne', points: ['un point'] } }
  };
  assert.deepStrictEqual(titres(notesAMontrer('1.0', '1.2', bancal, 'fr')), ['1.2']);
});

test('un fichier absent ou illisible rend une table vide, jamais une exception', () => {
  // Ouvrir un numéro ne doit pas pouvoir échouer parce qu'un fichier de notes manque.
  assert.deepStrictEqual(lireTable(path.join(RACINE, 'ce-fichier-n-existe-pas.json')), {});
  assert.deepStrictEqual(lireTable(path.join(RACINE, 'README.md')), {});
  assert.deepStrictEqual(notesAMontrer('1.0', '1.1', null, 'fr'), []);
});

// ---- Le fichier livré ------------------------------------------------------------------

test('nouveautes.json est un JSON valide, et chaque note existe dans les DEUX langues', () => {
  const brut = fs.readFileSync(FICHIER_NOTES, 'utf8');
  const table = JSON.parse(brut);
  const mediums = Object.keys(table).filter(estMedium);
  assert.ok(mediums.length > 0, 'nouveautes.json ne porte aucune note');
  for (const cle of mediums) {
    for (const langue of ['fr', 'de']) {
      const note = table[cle][langue];
      // La Zeitschrift est germanophone : une note qui n'existe qu'en français laisse la
      // moitié de la rédaction devant un texte qu'elle ne lit pas.
      assert.ok(note, 'la note ' + cle + ' manque en ' + langue);
      assert.ok(String(note.titre || '').trim() !== '', 'note ' + cle + ' (' + langue + ') sans titre');
      assert.ok(Array.isArray(note.points) && note.points.length > 0,
        'note ' + cle + ' (' + langue + ') sans aucun point');
      for (const point of note.points) {
        assert.strictEqual(typeof point, 'string', 'un point de ' + cle + ' n’est pas du texte');
        assert.ok(point.trim() !== '', 'point vide dans ' + cle + ' (' + langue + ')');
      }
    }
    // Les deux langues disent la même chose : un point ajouté d'un côté et oublié de
    // l'autre est le défaut le plus probable de ce fichier.
    assert.strictEqual(table[cle].fr.points.length, table[cle].de.points.length,
      'la note ' + cle + ' n’a pas le même nombre de points en fr et en de');
  }
});

test('le fichier de notes part bien dans le toolkit, sinon aucun poste ne le verra', () => {
  const release = fs.readFileSync(path.join(RACINE, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(release, /cp nouveautes\.json toolkit\//,
    'release.yml ne copie plus nouveautes.json : la fenêtre serait vide sur tous les postes');
});

test('la fenêtre est atteignable après coup, pas seulement quand elle s’ouvre seule', () => {
  // Une note refusée d'un clic serait perdue pour toujours sans cette commande.
  const pkg = JSON.parse(fs.readFileSync(path.join(COCKPIT, 'package.json'), 'utf8'));
  const commandes = pkg.contributes.commands.map((c) => c.command);
  assert.ok(commandes.includes('szh.nouveautes'), 'la commande « Quoi de neuf » a disparu');
  for (const nls of ['package.nls.json', 'package.nls.de.json']) {
    const table = JSON.parse(fs.readFileSync(path.join(COCKPIT, nls), 'utf8'));
    assert.ok(table['cmd.nouveautes'], nls + ' ne traduit pas le titre de la commande');
  }
});

test('les textes de la fenêtre existent dans les deux langues du cockpit', () => {
  const i18n = fs.readFileSync(path.join(COCKPIT, 'lib', 'i18n.js'), 'utf8');
  for (const cle of ['nouv.titre', 'nouv.version', 'nouv.rien', 'nouv.invite', 'nouv.invite.bouton']) {
    const n = i18n.split("'" + cle + "':").length - 1;
    assert.strictEqual(n, 2, 'le texte « ' + cle + ' » n’existe pas en fr ET en de (trouvé ' + n + ')');
  }
});

test('la page ne pose aucun texte en HTML : une note mal écrite ne peut pas ouvrir de balise', () => {
  const js = fs.readFileSync(path.join(COCKPIT, 'media', 'nouveautes.js'), 'utf8');
  assert.ok(!/innerHTML/.test(js), 'media/nouveautes.js écrit du innerHTML');
  assert.match(js, /textContent/, 'media/nouveautes.js ne pose plus son texte par textContent');
});
