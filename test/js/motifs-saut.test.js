'use strict';
// Preuve que chaque assistant `sauter.*` (test/js/gardes.js) écrit un motif que la porte
// (test/js/verifier-tap.js) admet réellement sur AU MOINS UN runner, et que la table
// partagée (test/js/motifs-saut.js) elle-même ne se contredit pas. Sans ce fichier, un
// assistant et la table qu'il est censé respecter pourraient diverger sans qu'aucun test ne
// le remarque avant le prochain run GitHub — exactement ce qui a coûté trois poses du tag à
// la 1.2.0.
const test = require('node:test');
const assert = require('node:assert');
const { MOTIFS, ADMIS } = require('./motifs-saut');
const gardes = require('./gardes');
const { verifier } = require('./verifier-tap');

// ---- la table elle-même ------------------------------------------------------------------

test('motifs-saut : aucun fragment n’apparaît dans deux familles', () => {
  const vus = new Map();
  for (const [famille, fragments] of Object.entries(MOTIFS)) {
    for (const frag of fragments) {
      const autre = vus.get(frag);
      assert.ok(!autre, 'fragment "' + frag + '" partagé entre les familles "' + autre
        + '" et "' + famille + '" — verifier-tap.js ne pourrait plus décider laquelle');
      vus.set(frag, famille);
    }
  }
});

test('motifs-saut : chaque famille est admise sur au moins un runner', () => {
  const admisQuelquePart = new Set(Object.values(ADMIS).flat());
  for (const famille of Object.keys(MOTIFS)) {
    assert.ok(admisQuelquePart.has(famille),
      'la famille "' + famille + '" n’apparaît dans ADMIS d’aucun runner : un saut qui la '
      + 'cite ferait toujours échouer la porte, sur les trois runners à la fois');
  }
});

test('motifs-saut : chaque famille d’ADMIS existe dans MOTIFS', () => {
  for (const [runner, familles] of Object.entries(ADMIS)) {
    for (const f of familles) {
      assert.ok(Object.prototype.hasOwnProperty.call(MOTIFS, f),
        'ADMIS.' + runner + ' cite une famille "' + f + '" absente de MOTIFS');
    }
  }
});

// ---- forme des assistants -----------------------------------------------------------------

const ASSISTANTS_ATTENDUS = ['corpus', 'wsl', 'pandoc', 'powershell', 'vale', 'vscodium',
  'production', 'eleve', 'pliage'];

test('gardes.sauter : exactement les neuf assistants attendus', () => {
  assert.deepStrictEqual(Object.keys(gardes.sauter).sort(), ASSISTANTS_ATTENDUS.slice().sort());
});

// ---- ce que chaque assistant écrit, vraiment reconnu par une famille ---------------------

// Capture le motif que l'assistant passerait à t.skip(...), ou signale qu'il a refusé de
// sauter (garde-fou _garantir : l'outil est en fait présent sur CE poste). Les deux issues
// sont normales et attendues selon l'outillage du poste qui fait tourner la suite — le test
// ne suppose jamais lequel des deux.
function essayer(fn) {
  let motif;
  const t = { skip(m) { motif = m; } };
  try {
    fn(t);
  } catch (e) {
    return { refuse: true, erreur: e };
  }
  return { refuse: false, motif };
}

function fragmentDe(famille) { return MOTIFS[famille][0]; }
function admisQuelquePart(famille) {
  return Object.values(ADMIS).some((familles) => familles.includes(famille));
}

// Un motif capturé doit contenir un fragment de SA famille, et cette famille doit être
// admise par la porte sur au moins un runner — sans quoi produire ce motif ne servirait à
// rien : aucun runner ne le laisserait jamais passer.
function verifierMotifFamille(famille, motif) {
  const fragments = MOTIFS[famille];
  assert.ok(fragments.some((f) => motif.includes(f)),
    'le motif "' + motif + '" ne cite aucun fragment de la famille "' + famille + '" ('
    + fragments.join(', ') + ')');
  assert.ok(admisQuelquePart(famille), 'la famille "' + famille + '" n’est admise nulle part');
}

test('sauter.corpus(t, chemin) : motif de la famille corpus, toujours (pas de garde-fou)', () => {
  const r = essayer((t) => gardes.sauter.corpus(t, 'chemin-de-test'));
  assert.strictEqual(r.refuse, false, 'sauter.corpus ne devrait jamais refuser de sauter');
  verifierMotifFamille('corpus', r.motif);
  assert.ok(r.motif.includes('chemin-de-test'), 'le chemin donné par l’appelant a disparu du motif');
});

test('sauter.eleve(t) : motif de la famille eleve, toujours (pas de détection centralisée)', () => {
  const r = essayer((t) => gardes.sauter.eleve(t));
  assert.strictEqual(r.refuse, false, 'sauter.eleve ne devrait jamais refuser de sauter');
  verifierMotifFamille('eleve', r.motif);
});

// Pour les assistants adossés à une détection centralisée (gardes.js calcule sansX une
// seule fois par processus) : sur CE poste, l'outil peut être présent (l'assistant refuse
// alors de sauter — le garde-fou fonctionne) ou absent (l'assistant produit le motif admis).
// Les deux branches sont couvertes selon ce que le poste qui exécute la suite possède — voir
// le rapport de livraison pour l'inventaire mesuré sur le poste de développement.
const CENTRALISES = [
  ['wsl', () => gardes.sauter.wsl.bind(gardes.sauter)],
  ['pandoc', () => gardes.sauter.pandoc.bind(gardes.sauter)],
  ['powershell', () => gardes.sauter.powershell.bind(gardes.sauter)],
  ['vale', () => gardes.sauter.vale.bind(gardes.sauter)],
  ['vscodium', () => gardes.sauter.vscodium.bind(gardes.sauter)],
  ['production', () => gardes.sauter.production.bind(gardes.sauter)],
];

for (const [famille, fabrique] of CENTRALISES) {
  test('sauter.' + famille + '(t) : motif admis si absent, refus explicite si présent', () => {
    const fn = fabrique();
    const r = essayer((t) => fn(t));
    if (r.refuse) {
      assert.match(r.erreur.message, /appelé alors que l.outil est présent/,
        'sauter.' + famille + ' a refusé pour une autre raison que sa propre garde : '
        + r.erreur.message);
    } else {
      verifierMotifFamille(famille, r.motif);
    }
  });
}

test('sauter.pliage(t) : motif admis si le pandoc de ce poste plie mal les accents, refus sinon', () => {
  const r = essayer((t) => gardes.sauter.pliage(t));
  if (r.refuse) {
    assert.match(r.erreur.message, /appelé alors que l.outil est présent|pliage des accents/,
      r.erreur.message);
  } else {
    verifierMotifFamille('pliage', r.motif);
  }
});

// ---- la boucle complète : le motif produit traverse verifier-tap.js sans erreur -----------

test('un motif produit par sauter.corpus est bien admis PAR verifier-tap.js sur les trois runners', () => {
  const r = essayer((t) => gardes.sauter.corpus(t, 'tmp/corpus-fictif'));
  // Neuf lignes qui passent avant le SKIP : sans elles, un seul test sauté sur un seul test
  // déclencherait la règle « plus de la moitié de la suite manque », qui n'a rien à voir
  // avec ce que ce contrôle éprouve ici.
  const passent = Array.from({ length: 9 }, (_v, i) => 'ok ' + (i + 1) + ' - a' + i).join('\n');
  const tapComplet = passent + '\nok 10 - x # SKIP ' + r.motif
    + '\n1..10\n# tests 10\n# pass 9\n# fail 0\n# cancelled 0\n# skipped 1\n';
  for (const runner of ['ubuntu', 'windows', 'poste']) {
    const v = verifier(tapComplet, runner);
    assert.deepStrictEqual(v.erreurs, [], runner + ' refuse le motif de sauter.corpus : ' + v.erreurs.join('; '));
  }
});
