// Bail de co-édition : deux postes travaillent le même numéro, et un seul à la fois
// modifie un fichier donné. Le bail expire de lui-même après deux minutes, et ne crée pas
// lui-même de copies en conflit (un fichier de bail par personne).
//
//   node --test test/js/coedition.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE_REPO = path.resolve(__dirname, '..', '..');
const coedition = require(path.join(RACINE_REPO, 'vscodium-extension', 'szh-cockpit', 'lib', 'coedition'));
const {
  DOSSIER_EDITION, BAIL_MS, RENOUVELLEMENT_MS, PEREMPTION_MS,
  clefFichier, identite, qui, nomBail, poser, titulaireAutre, titulairesDuNumero,
  baux, rendre, purger, empreinte, instantReference
} = coedition;

const T0 = Date.parse('2026-08-28T10:00:00.000Z');

const ANNE = { utilisateur: 'Anne', poste: 'PC-1' };
const BEAT = { utilisateur: 'Beat', poste: 'PC-2' };

// poser() écrit le fichier à l'heure du poste, et instantReference() retient la date la
// plus tardive des deux : sans recaler la date de modification sur l'instant simulé, un
// bail posé « à T0 » paraîtrait renouvelé à l'heure du test et n'expirerait jamais.
function poserA(racine, chemin, id, instant) {
  const resultat = poser(racine, chemin, id, instant);
  const clef = clefFichier(racine, chemin);
  if (clef) {
    const fichier = path.join(racine, DOSSIER_EDITION, nomBail(clef, id));
    try { fs.utimesSync(fichier, new Date(instant), new Date(instant)); }
    catch (e) { /* pose refusée : aucun fichier à dater */ }
  }
  return resultat;
}

test('un fichier libre se prend, et l\'autre poste voit qui le tient', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');

    const resultatAnne = poser(racine, chemin, ANNE, T0);
    assert.strictEqual(resultatAnne.ok, true, 'Anne doit pouvoir poser le bail');

    const titulaire = titulaireAutre(racine, chemin, BEAT, T0);
    assert.ok(titulaire !== null, 'Beat doit voir qu\'un tiers tient le fichier');
    assert.strictEqual(titulaire.utilisateur, 'Anne', 'le titulaire doit être Anne');

    const resultatBeat = poser(racine, chemin, BEAT, T0);
    assert.strictEqual(resultatBeat.ok, false, 'Beat ne doit pas pouvoir poser');
    assert.strictEqual(resultatBeat.titulaire.utilisateur, 'Anne', 'le titulaire renvoyé doit être Anne');

    const titulaireMoi = titulaireAutre(racine, chemin, ANNE, T0);
    assert.strictEqual(titulaireMoi, null, 'Anne ne doit pas voir son propre bail');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le bail expire tout seul deux minutes après le dernier geste', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');

    const resultatAnne = poserA(racine, chemin, ANNE, T0);
    assert.strictEqual(resultatAnne.ok, true, 'Anne doit pouvoir poser');

    const refusAvant = poserA(racine, chemin, BEAT, T0 + BAIL_MS - 1000);
    assert.strictEqual(refusAvant.ok, false, 'Beat doit être refusé avant expiration');
    assert.strictEqual(refusAvant.titulaire.utilisateur, 'Anne');

    const acceptApres = poserA(racine, chemin, BEAT, T0 + BAIL_MS);
    assert.strictEqual(acceptApres.ok, true, 'Beat doit pouvoir poser après expiration du bail');

    // Le bail a expiré sans que personne le rende.
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('renouveler ne réécrit pas le fichier toutes les trois secondes', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');

    poser(racine, chemin, ANNE, T0);

    // Le fichier de bail : le seul .json de .szh-edition.
    const dossierEdition = path.join(racine, DOSSIER_EDITION);
    const fichiersJson = fs.readdirSync(dossierEdition).filter((f) => f.endsWith('.json'));
    assert.strictEqual(fichiersJson.length, 1, 'exactement un fichier de bail');
    const fichierBail = path.join(dossierEdition, fichiersJson[0]);

    // Sentinelle : mtime au 1er janvier 2000.
    const sentinelle = new Date(2000, 0, 1);
    fs.utimesSync(fichierBail, sentinelle, sentinelle);

    const resultat1 = poser(racine, chemin, ANNE, T0 + 5000);
    assert.strictEqual(resultat1.ok, true, 'Anne doit pouvoir renouveler');
    assert.strictEqual(resultat1.inchange, true, 'le bail ne doit pas être réécrit');
    const stat1 = fs.statSync(fichierBail);
    assert.strictEqual(stat1.mtime.getFullYear(), 2000, 'le fichier ne doit pas avoir été réécrit');

    // Passé le délai de renouvellement, le fichier est réécrit.
    const resultat2 = poser(racine, chemin, ANNE, T0 + RENOUVELLEMENT_MS + 1000);
    assert.strictEqual(resultat2.ok, true);
    const stat2 = fs.statSync(fichierBail);
    assert.notStrictEqual(stat2.mtime.getFullYear(), 2000, 'le fichier doit avoir été réécrit');

    const contenu = JSON.parse(fs.readFileSync(fichierBail, 'utf8'));
    const contenuInitial = JSON.parse(fs.readFileSync(fichierBail, 'utf8'));
    assert.ok(contenuInitial.pose, 'la pose doit être écrite');
    assert.ok(new Date(contenuInitial.pose).getTime() >= T0, 'la pose doit être à T0 ou après');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('rendre libère tout de suite', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');

    const resultat1 = poser(racine, chemin, ANNE, T0);
    assert.strictEqual(resultat1.ok, true, 'Anne doit pouvoir poser');

    rendre(racine, chemin, ANNE);

    const resultat2 = poser(racine, chemin, BEAT, T0 + 1000);
    assert.strictEqual(resultat2.ok, true, 'Beat doit pouvoir poser après rendre d\'Anne');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un fichier de bail par personne, jamais un fichier partagé', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    poser(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0);

    poser(racine, path.join(racine, 'articles', 'essai', 'essai.meta.yaml'), BEAT, T0);

    // Anne renouvelle : son fichier est réécrit, sans en créer un second.
    poser(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0 + RENOUVELLEMENT_MS + 1000);

    const dossierEdition = path.join(racine, DOSSIER_EDITION);
    const fichiersJson = fs.readdirSync(dossierEdition).filter((f) => f.endsWith('.json'));
    assert.strictEqual(fichiersJson.length, 2, 'exactement 2 fichiers de bail : un par (fichier, personne)');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un bail illisible reste un bail', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');
    const clef = clefFichier(racine, chemin);

    const dossierEdition = path.join(racine, DOSSIER_EDITION);
    fs.mkdirSync(dossierEdition, { recursive: true });

    // Un fichier de bail illisible, sous le nom exact attendu.
    const fichierBail = path.join(dossierEdition, nomBail(clef, ANNE));
    fs.writeFileSync(fichierBail, '{ pas du json', 'utf8');

    // mtime à T0, pour que le bail soit en cours.
    fs.utimesSync(fichierBail, new Date(T0), new Date(T0));

    const titulaire = titulaireAutre(racine, chemin, BEAT, T0);
    assert.ok(titulaire !== null, 'un bail illisible doit rester un bail');
    assert.ok(titulaire.utilisateur !== '', 'le utilisateur doit venir du nom du fichier');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('la casse du chemin ne crée pas deux baux', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const cheminAnneMaj = path.join(racine, 'Ausgabe.yaml');
    poser(racine, cheminAnneMaj, ANNE, T0);

    const cheminBeatMin = path.join(racine, 'ausgabe.yaml');
    const titulaire = titulaireAutre(racine, cheminBeatMin, BEAT, T0);
    assert.ok(titulaire !== null, 'Beat doit voir le bail d\'Anne malgré la casse différente');
    assert.strictEqual(titulaire.utilisateur, 'Anne');

    const clef1 = clefFichier(racine, cheminAnneMaj);
    const clef2 = clefFichier(racine, cheminBeatMin);
    assert.strictEqual(clef1, clef2, 'les clés doivent être identiques (minuscules)');

    const cheminHors = path.join(racine, '..', 'ailleurs.yaml');
    const clefHors = clefFichier(racine, cheminHors);
    assert.strictEqual(clefHors, null, 'un chemin hors du numéro doit retourner null');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('titulairesDuNumero ne rend que les baux des autres, et que les vivants', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    poserA(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0);
    poserA(racine, path.join(racine, 'articles', 'essai', 'essai.meta.yaml'), ANNE, T0);

    poserA(racine, path.join(racine, 'articles', 'autre', 'autre.meta.yaml'), BEAT, T0);

    const titulaires = titulairesDuNumero(racine, ANNE, T0 + 1000);
    assert.strictEqual(titulaires.length, 1, 'doit y avoir 1 titulaire autre qu\'Anne');
    assert.ok(titulaires.some((b) => b.utilisateur === 'Beat'), 'Beat doit être parmi les titulaires');

    const titulairesExpires = titulairesDuNumero(racine, ANNE, T0 + BAIL_MS);
    assert.strictEqual(titulairesExpires.length, 0, 'après expiration, pas de titulaires');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('purger balaie les restes d\'une session tuée, jamais les temporaires', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    poserA(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0);

    // Un temporaire d'écriture en cours, préfixé « ~$ ».
    const dossierEdition = path.join(racine, DOSSIER_EDITION);
    fs.mkdirSync(dossierEdition, { recursive: true });
    const fichierTemporaire = path.join(dossierEdition, '~$reste--x.json');
    fs.writeFileSync(fichierTemporaire, '{}', 'utf8');

    // Bail récent : les deux fichiers restent.
    purger(racine, T0 + 1000);
    assert.ok(fs.existsSync(fichierTemporaire), 'les temporaires ne doivent pas être supprimés');
    const fichiersJson = fs.readdirSync(dossierEdition)
      .filter((f) => !f.startsWith('~$') && f.endsWith('.json'));
    assert.strictEqual(fichiersJson.length, 1, 'le bail d\'Anne doit rester');

    // Bail périmé : supprimé, le temporaire reste.
    purger(racine, T0 + PEREMPTION_MS + 1000);
    assert.ok(fs.existsSync(fichierTemporaire), 'les temporaires ne doivent pas être supprimés');
    const fichiersJson2 = fs.readdirSync(dossierEdition)
      .filter((f) => !f.startsWith('~$') && f.endsWith('.json'));
    assert.strictEqual(fichiersJson2.length, 0, 'le bail d\'Anne doit être supprimé');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// Écrit puis date le fichier à la main : deux écritures rapprochées peuvent avoir le même
// mtimeMs (résolution de NTFS), et empreinte() se fie à (taille, mtime) pour éviter une
// lecture. poserA() date ses baux de la même façon.
function ecrireEtDater(chemin, contenu, instant) {
  fs.writeFileSync(chemin, contenu, 'utf8');
  fs.utimesSync(chemin, new Date(instant), new Date(instant));
}

test('empreinte suit le contenu', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const cheminFichier = path.join(racine, 'test.yaml');

    const empreinte1 = empreinte(cheminFichier);
    assert.strictEqual(empreinte1, '', 'empreinte d\'un fichier absent doit être vide');

    ecrireEtDater(cheminFichier, 'contenu 1', T0);
    const empreinte2 = empreinte(cheminFichier);
    assert.strictEqual(typeof empreinte2, 'string', 'empreinte doit être une chaîne');
    assert.ok(empreinte2.length === 40, 'empreinte SHA1 en hex doit faire 40 caractères');

    // Deux contenus différents (et deux mtime différents) donnent deux empreintes
    // différentes.
    ecrireEtDater(cheminFichier, 'contenu 2', T0 + 1000);
    const empreinte3 = empreinte(cheminFichier);
    assert.notStrictEqual(empreinte2, empreinte3, 'contenus différents doivent donner des empreintes différentes');

    // Le même contenu réécrit (à une date différente) donne la même empreinte.
    ecrireEtDater(cheminFichier, 'contenu 1', T0 + 2000);
    const empreinte4 = empreinte(cheminFichier);
    assert.strictEqual(empreinte2, empreinte4, 'le même contenu doit donner la même empreinte');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// Le cache d'empreinte : tant que ni la taille ni la mtime n'ont changé, le fichier n'est
// pas relu. L'enregistrement automatique d'un formulaire consulte empreinte() toutes les
// trois secondes.
test('empreinte ne relit le fichier que si sa taille ou sa mtime a changé', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const cheminFichier = path.join(racine, 'test.yaml');
    ecrireEtDater(cheminFichier, 'contenu stable', T0);
    const lectureOriginale = fs.readFileSync;
    let appels = 0;
    fs.readFileSync = (...args) => { appels++; return lectureOriginale.apply(fs, args); };
    try {
      const e1 = empreinte(cheminFichier);
      const e2 = empreinte(cheminFichier);
      const e3 = empreinte(cheminFichier);
      assert.strictEqual(e1, e2);
      assert.strictEqual(e2, e3);
      assert.strictEqual(appels, 1,
        'le fichier a été relu alors que rien n’avait changé : ' + appels + ' lecture(s)');
      // Le contenu change (taille et mtime) : le fichier est relu.
      ecrireEtDater(cheminFichier, 'contenu bien plus long qu’avant', T0 + 5000);
      const e4 = empreinte(cheminFichier);
      assert.notStrictEqual(e4, e1);
      assert.strictEqual(appels, 2, 'le changement de contenu n’a pas déclenché de relecture');
    } finally {
      fs.readFileSync = lectureOriginale;
    }
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// Le cache de baux() : poser() l'appelle deux fois, et chaque appel liste .szh-edition/ et
// lit chaque bail, toutes les trois secondes et par formulaire ouvert.
test('baux() met en cache son résultat pendant 2 secondes, par racine', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');
    const clef = clefFichier(racine, chemin);
    assert.strictEqual(baux(racine, clef, T0).length, 0, 'le dossier doit être vide au départ');
    // Un bail apparaît sur le disque sans passer par ce module (une synchronisation apporte
    // le bail d'un autre poste) : le cache ne le voit qu'après ses 2 secondes.
    const dossier = path.join(racine, DOSSIER_EDITION);
    fs.mkdirSync(dossier, { recursive: true });
    const fichierBail = path.join(dossier, nomBail(clef, ANNE));
    fs.writeFileSync(fichierBail, JSON.stringify({
      fichier: clef, utilisateur: ANNE.utilisateur, poste: ANNE.poste, qui: qui(ANNE),
      pose: new Date(T0).toISOString(), renouvele: new Date(T0).toISOString()
    }), 'utf8');
    fs.utimesSync(fichierBail, new Date(T0), new Date(T0));
    assert.strictEqual(baux(racine, clef, T0 + 500).length, 0,
      'le cache aurait dû épargner la relecture du dossier, encore dans sa fenêtre de 2 secondes');
    assert.strictEqual(baux(racine, clef, T0 + 2001).length, 1,
      'le cache n’a jamais expiré après 2 secondes');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

// Le point délicat du cache : poser() lit baux(), écrit le bail, puis relit baux() pour
// vérifier qu'il a gagné (deux postes peuvent avoir trouvé le fichier libre au même
// instant). Le cache se vide donc après l'écriture, sinon la seconde lecture verrait le
// dossier d'avant l'écriture.
test('poser() voit son propre bail juste posé, malgré le cache de baux()', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');
    const clef = clefFichier(racine, chemin);
    // Amorce le cache avec un dossier vide, à la même heure que la pose qui suit : sans
    // invalidation après écriture, la vérification interne de poser() relirait ce « vide ».
    baux(racine, clef, T0);
    const resultat = poserA(racine, chemin, ANNE, T0);
    assert.strictEqual(resultat.ok, true,
      'poser() n’a pas vu son propre bail après écriture : ' + JSON.stringify(resultat));
    assert.strictEqual(baux(racine, clef, T0).length, 1, 'le bail posé doit être visible tout de suite après');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une horloge en avance ne prolonge pas un bail', () => {
  // Une date de renouvellement trop loin dans le futur (horloge en avance) est écartée :
  // le résultat est le mtime, T0.
  const dateAvance = new Date(T0 + 7200000).toISOString();
  const resultAvance = instantReference(dateAvance, T0, T0);
  assert.strictEqual(resultAvance, T0, 'une horloge en avance doit être écartée');

  // Sinon, la plus tardive des deux.
  const dateNormale = new Date(T0).toISOString();
  const mtimePassee = T0 - 50000;
  const resultNormal = instantReference(dateNormale, mtimePassee, T0);
  assert.strictEqual(resultNormal, T0, 'doit retourner la plus tardive des deux dates');
});
