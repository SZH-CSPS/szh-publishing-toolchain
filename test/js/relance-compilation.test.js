// La relance différée de la compilation (lib/relance-compilation.js), à froid, sous de faux
// minuteurs : l'anti-rebond, la fermeture du panneau, la compilation qui couvre déjà
// l'enregistrement, celle qui ne le couvre pas, et le numéro gelé. Le branchement réel dans
// les formulaires Médias et Tableaux est éprouvé côté hôte (relance-formulaires-hote.test.js).
//
//   node --test "test/js/relance-compilation.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { creerRelanceDifferee, delai, DELAI_PAR_DEFAUT } = require(path.join(
  __dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'relance-compilation.js'));

// Une horloge à la main : poser() retient l'échéance, avancer(ms) fait partir ce qui échoit.
function horloge() {
  let maintenant = 0;
  let suivant = 1;
  const minuteurs = new Map();
  return {
    minuteur: {
      poser: (fn, ms) => { const id = suivant++; minuteurs.set(id, { fn: fn, quand: maintenant + ms }); return id; },
      annuler: (id) => { minuteurs.delete(id); }
    },
    avancer(ms) {
      const fin = maintenant + ms;
      for (;;) {
        const prochains = Array.from(minuteurs.entries())
          .filter(([, m]) => m.quand <= fin).sort((a, b) => a[1].quand - b[1].quand);
        if (prochains.length === 0) { break; }
        const [id, m] = prochains[0];
        minuteurs.delete(id);
        maintenant = m.quand;
        m.fn();
      }
      maintenant = fin;
    },
    enAttente: () => minuteurs.size
  };
}

function banc(etat) {
  const h = horloge();
  const lances = [];
  const e = Object.assign({ coupee: false, occupe: false, demarrages: 0 }, etat || {});
  const relance = creerRelanceDifferee({
    relancer: (f, slug) => lances.push({ f: f, slug: slug }),
    coupee: () => e.coupee, occupe: () => e.occupe, demarrages: () => e.demarrages,
    minuteur: h.minuteur
  });
  return { h, lances, e, relance };
}

const F = { racine: 'x' };

test('le délai par défaut est de 2,5 s', () => {
  assert.equal(DELAI_PAR_DEFAUT, 2500);
  assert.equal(delai(), 2500);
});

test('trois enregistrements rapprochés : une seule compilation, 2,5 s après le dernier', () => {
  const { h, lances, relance } = banc();
  relance.demander(F, '01-essai');
  h.avancer(1000);
  relance.demander(F, '01-essai');
  h.avancer(1000);
  relance.demander(F, '01-essai');
  h.avancer(2499);
  assert.equal(lances.length, 0, 'la compilation est partie avant la fin de l’anti-rebond');
  h.avancer(1);
  assert.deepEqual(lances.map((l) => l.slug), ['01-essai']);
  h.avancer(10000);
  assert.equal(lances.length, 1, 'une seconde compilation est partie');
});

test('deux articles : une compilation chacun, sans que l’un repousse l’autre', () => {
  const { h, lances, relance } = banc();
  relance.demander(F, '01-essai');
  h.avancer(2000);
  relance.demander(F, '02-autre');
  h.avancer(500);
  assert.deepEqual(lances.map((l) => l.slug), ['01-essai']);
  h.avancer(2000);
  assert.deepEqual(lances.map((l) => l.slug), ['01-essai', '02-autre']);
});

test('fermeture du panneau : la demande en attente part tout de suite, une seule fois', () => {
  const { h, lances, relance } = banc();
  relance.demander(F, '01-essai');
  relance.vider('01-essai');
  assert.equal(lances.length, 1);
  assert.equal(relance.enAttente('01-essai'), false);
  h.avancer(5000);
  assert.equal(lances.length, 1, 'le minuteur annulé a relancé quand même');
  relance.vider('01-essai');             // plus rien en attente : rien
  assert.equal(lances.length, 1);
});

test('une compilation démarrée depuis la demande la couvre : rien ne repart (Ctrl+S relayé)', () => {
  const { h, lances, e, relance } = banc();
  relance.demander(F, '01-essai');
  e.demarrages++;                        // triggerTaskOnSave a lancé la tâche
  h.avancer(2500);
  assert.equal(lances.length, 0, 'la même tâche aurait tourné deux fois');
  assert.equal(relance.enAttente('01-essai'), false);
});

test('une compilation déjà en vol AVANT la demande ne la couvre pas : on attend sa fin', () => {
  const { h, lances, e, relance } = banc({ occupe: true });
  relance.demander(F, '01-essai');
  h.avancer(2500);
  assert.equal(lances.length, 0, 'lancée pendant qu’une compilation tourne');
  assert.equal(relance.enAttente('01-essai'), true, 'la demande est tombée au lieu d’attendre');
  e.occupe = false;
  h.avancer(2500);
  assert.equal(lances.length, 1);
});

test('compilation automatique coupée : aucune demande retenue, et une échéance tardive tombe', () => {
  const coupe = banc({ coupee: true });
  coupe.relance.demander(F, '01-essai');
  coupe.h.avancer(5000);
  assert.equal(coupe.lances.length, 0);
  assert.equal(coupe.h.enAttente(), 0, 'un minuteur a été posé sur un numéro gelé');

  const tard = banc();
  tard.relance.demander(F, '01-essai');
  tard.e.coupee = true;                  // verrouillé pendant l’anti-rebond
  tard.h.avancer(2500);
  assert.equal(tard.lances.length, 0);
});

test('abandonner : la demande tombe sans rien lancer', () => {
  const { h, lances, relance } = banc();
  relance.demander(F, '01-essai');
  relance.abandonner('01-essai');
  h.avancer(5000);
  relance.vider('01-essai');
  assert.equal(lances.length, 0);
});
