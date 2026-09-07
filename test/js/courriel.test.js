// Les gabarits de courriel (lib/courriel.js, mail-templates/*.twig) : chaque .twig
// compile, existe dans les deux langues, rend un sujet et un corps non vides, l'italien
// replie sur le français, un nom inconnu lève, et le rendu retrouve au caractère près les
// quatre anciens textes de lib/i18n.js (recopiés ci-dessous avant leur retrait).
//
//   node --test test/js/courriel.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const GABARITS = path.join(COCKPIT, 'mail-templates');
const { compiler } = require(path.join(COCKPIT, 'lib', 'gabarits'));
const courriel = require(path.join(COCKPIT, 'lib', 'courriel'));

// Les quatre textes d'origine (art.envoi.sujet/corps, trad.lien.sujet/corps), fr et de,
// recopiés de lib/i18n.js avant leur retrait — l'oracle indépendant de ce test.
const ANCIENS = {
  "fr": {
    "art.envoi.sujet": "Version finale – {0}",
    "art.envoi.corps": "Bonjour,\n\nVous trouverez en pièce jointe la version finale de votre article « {0} », telle qu’elle paraîtra dans {1}.\n\nMerci de nous signaler toute correction avant l’impression.\n\nAvec nos remerciements pour votre contribution,\nLa rédaction",
    "trad.lien.sujet": "Traduction allemand vers français – {0}",
    "trad.lien.corps": "Bonjour,\n\nLe numéro {0} de la Schweizerische Zeitschrift für Heilpädagogik est prêt pour la traduction de l’allemand vers le français.\n\nPour l’ouvrir directement au bon endroit : COPIEZ le lien ci-dessous, puis collez-le dans la fenêtre « Exécuter » de Windows (touche Windows + R) et validez.\n\n{1}\n\nAutre chemin, sans le lien : menu Démarrer -> « Zeitschriften SZH », puis choisir le numéro.\n"
  },
  "de": {
    "art.envoi.sujet": "Endfassung – {0}",
    "art.envoi.corps": "Guten Tag\n\nIm Anhang finden Sie die Endfassung Ihres Artikels «{0}», so wie er in {1} erscheinen wird.\n\nBitte melden Sie uns allfällige Korrekturen vor dem Druck.\n\nMit bestem Dank für Ihren Beitrag\nDie Redaktion",
    "trad.lien.sujet": "Übersetzung Französisch nach Deutsch – {0}",
    "trad.lien.corps": "Guten Tag\n\nDie Ausgabe {0} der Revue suisse de pédagogie spécialisée ist bereit für die Übersetzung vom Französischen ins Deutsche.\n\nSo öffnen Sie sie direkt an der richtigen Stelle: KOPIEREN Sie den Link unten, fügen Sie ihn im Windows-Fenster «Ausführen» ein (Windows-Taste + R) und bestätigen Sie.\n\n{1}\n\nOhne den Link: Startmenü -> «Revues SZH», dann die Ausgabe wählen.\n"
  }
};

function sub(texte, valeurs) {
  let r = texte;
  valeurs.forEach((v, i) => { r = r.split('{' + i + '}').join(v); });
  return r;
}

function nomsGabarits() {
  return fs.readdirSync(GABARITS).filter((f) => f.endsWith('.twig'));
}

test('chaque .twig du dossier mail-templates compile sans erreur', () => {
  for (const nom of nomsGabarits()) {
    assert.doesNotThrow(() => compiler(fs.readFileSync(path.join(GABARITS, nom), 'utf8'), nom),
      nom + ' ne compile pas');
  }
});

test('chaque nom de gabarit existe en français ET en allemand', () => {
  const noms = nomsGabarits();
  const base = new Set(noms.map((f) => f.replace(/\.(fr|de)\.twig$/, '')));
  assert.ok(base.size > 0, 'aucun gabarit trouvé');
  for (const b of base) {
    assert.ok(noms.indexOf(b + '.fr.twig') !== -1, b + ' : version française absente');
    assert.ok(noms.indexOf(b + '.de.twig') !== -1, b + ' : version allemande absente');
  }
});

test('chaque gabarit rend un sujet et un corps non vides, variables d’essai à l’appui', () => {
  const variables = {
    titre: 'Titre d’essai', numero: 'Numéro d’essai', auteurs: ['Ana', 'Beat'],
    quoi: 'Quoi d’essai', lien: 'szh://traduction/revue/essai', produit: 'zeitschrift', langue: 'fr'
  };
  for (const nom of ['envoi-auteur', 'traduction']) {
    for (const langue of ['fr', 'de']) {
      const r = courriel.rendreCourriel(nom, langue, variables);
      assert.ok(r.sujet.length > 0, nom + '.' + langue + ' : sujet vide');
      assert.ok(r.corps.length > 0, nom + '.' + langue + ' : corps vide');
    }
  }
});

test("rendreCourriel('envoi-auteur', 'it', …) replie sur le français", () => {
  const variables = { titre: 'T', numero: 'N', auteurs: [] };
  const fr = courriel.rendreCourriel('envoi-auteur', 'fr', variables);
  const it = courriel.rendreCourriel('envoi-auteur', 'it', variables);
  assert.deepEqual(it, fr);
});

test('un nom de gabarit inconnu lève une erreur explicite', () => {
  assert.throws(() => courriel.rendreCourriel('zorglub', 'fr', {}), /zorglub/);
});

test('brouillonTraduction : zeitschrift part en français, revue en allemand, lien seul sur sa ligne', () => {
  const bFr = courriel.brouillonTraduction('zeitschrift', 'Le numéro', 'szh://traduction/zeitschrift/2026-03');
  assert.match(bFr.sujet, /^Traduction allemand vers français/);
  assert.match(bFr.corps, /\nszh:\/\/traduction\/zeitschrift\/2026-03\n/, 'le lien n’est pas seul sur sa ligne');
  const bDe = courriel.brouillonTraduction('revue', 'Die Ausgabe', 'szh://traduction/revue/2026-03');
  assert.match(bDe.sujet, /^Übersetzung Französisch nach Deutsch/);
  assert.match(bDe.corps, /\nszh:\/\/traduction\/revue\/2026-03\n/, 'le lien n’est pas seul sur sa ligne');
});

test('envoi-auteur (fr) : identique au caractère près à l’ancien texte de lib/i18n.js', () => {
  const r = courriel.rendreCourriel('envoi-auteur', 'fr', { titre: 'Inklusive Bildung', numero: 'Z2026-03 | Essai' });
  assert.equal(r.sujet, sub(ANCIENS.fr['art.envoi.sujet'], ['Inklusive Bildung']));
  assert.equal(r.corps, sub(ANCIENS.fr['art.envoi.corps'], ['Inklusive Bildung', 'Z2026-03 | Essai']));
});

test('envoi-auteur (de) : identique au caractère près à l’ancien texte de lib/i18n.js', () => {
  const r = courriel.rendreCourriel('envoi-auteur', 'de', { titre: 'Inklusive Bildung', numero: 'Z2026-03 | Essai' });
  assert.equal(r.sujet, sub(ANCIENS.de['art.envoi.sujet'], ['Inklusive Bildung']));
  assert.equal(r.corps, sub(ANCIENS.de['art.envoi.corps'], ['Inklusive Bildung', 'Z2026-03 | Essai']));
});

test('traduction (fr) : identique au caractère près à l’ancien texte de lib/i18n.js', () => {
  const r = courriel.rendreCourriel('traduction', 'fr', { quoi: 'Z2026-03', lien: 'szh://traduction/zeitschrift/2026-03' });
  assert.equal(r.sujet, sub(ANCIENS.fr['trad.lien.sujet'], ['Z2026-03']));
  assert.equal(r.corps, sub(ANCIENS.fr['trad.lien.corps'], ['Z2026-03', 'szh://traduction/zeitschrift/2026-03']));
});

test('traduction (de) : identique au caractère près à l’ancien texte de lib/i18n.js', () => {
  const r = courriel.rendreCourriel('traduction', 'de', { quoi: 'R2026-03', lien: 'szh://traduction/revue/2026-03' });
  assert.equal(r.sujet, sub(ANCIENS.de['trad.lien.sujet'], ['R2026-03']));
  assert.equal(r.corps, sub(ANCIENS.de['trad.lien.corps'], ['R2026-03', 'szh://traduction/revue/2026-03']));
});
