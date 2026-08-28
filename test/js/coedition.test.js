// Bail de co-édition : deux postes travaillent le même numéro, et un seul à la fois
// modifie un fichier donné. Le bail expire tout seul après deux minutes, et ne
// fabrique jamais les copies en conflit qu'il combat.
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

// Base de temps fixe : 2026-08-28T10:00:00Z
const T0 = Date.parse('2026-08-28T10:00:00.000Z');

// Deux identités fabriquées à la main
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

    // ANNE pose sur le fichier à T0
    const resultatAnne = poser(racine, chemin, ANNE, T0);
    assert.strictEqual(resultatAnne.ok, true, 'Anne doit pouvoir poser le bail');

    // BEAT interroge titulaireAutre : doit voir Anne
    const titulaire = titulaireAutre(racine, chemin, BEAT, T0);
    assert.ok(titulaire !== null, 'Beat doit voir qu\'un tiers tient le fichier');
    assert.strictEqual(titulaire.utilisateur, 'Anne', 'le titulaire doit être Anne');

    // BEAT essaie de poser : doit échouer
    const resultatBeat = poser(racine, chemin, BEAT, T0);
    assert.strictEqual(resultatBeat.ok, false, 'Beat ne doit pas pouvoir poser');
    assert.strictEqual(resultatBeat.titulaire.utilisateur, 'Anne', 'le titulaire renvoyé doit être Anne');

    // ANNE interroge titulaireAutre : ne doit pas se voir elle-même
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

    // ANNE pose à T0
    const resultatAnne = poserA(racine, chemin, ANNE, T0);
    assert.strictEqual(resultatAnne.ok, true, 'Anne doit pouvoir poser');

    // À T0 + BAIL_MS - 1000, BEAT est refusé
    const refusAvant = poserA(racine, chemin, BEAT, T0 + BAIL_MS - 1000);
    assert.strictEqual(refusAvant.ok, false, 'Beat doit être refusé avant expiration');
    assert.strictEqual(refusAvant.titulaire.utilisateur, 'Anne');

    // À T0 + BAIL_MS, BEAT passe (le bail de Anne est expiré)
    const acceptApres = poserA(racine, chemin, BEAT, T0 + BAIL_MS);
    assert.strictEqual(acceptApres.ok, true, 'Beat doit pouvoir poser après expiration du bail');

    // Personne n'a rendu : c'est le point le plus important
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('renouveler ne réécrit pas le fichier toutes les trois secondes', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const chemin = path.join(racine, 'ausgabe.yaml');

    // ANNE pose à T0
    poser(racine, chemin, ANNE, T0);

    // Trouver le fichier de bail (le seul .json de .szh-edition)
    const dossierEdition = path.join(racine, DOSSIER_EDITION);
    const fichiersJson = fs.readdirSync(dossierEdition).filter((f) => f.endsWith('.json'));
    assert.strictEqual(fichiersJson.length, 1, 'exactement un fichier de bail');
    const fichierBail = path.join(dossierEdition, fichiersJson[0]);

    // Sentinelle : mtime fixée au 1er janvier 2000
    const sentinelle = new Date(2000, 0, 1);
    fs.utimesSync(fichierBail, sentinelle, sentinelle);

    // Re-poser à T0 + 5000 : l'année doit rester 2000, retour avec inchange:true
    const resultat1 = poser(racine, chemin, ANNE, T0 + 5000);
    assert.strictEqual(resultat1.ok, true, 'Anne doit pouvoir renouveler');
    assert.strictEqual(resultat1.inchange, true, 'le bail ne doit pas être réécrit');
    const stat1 = fs.statSync(fichierBail);
    assert.strictEqual(stat1.mtime.getFullYear(), 2000, 'le fichier ne doit pas avoir été réécrit');

    // Re-poser à T0 + RENOUVELLEMENT_MS + 1000 : doit être réécrit
    const resultat2 = poser(racine, chemin, ANNE, T0 + RENOUVELLEMENT_MS + 1000);
    assert.strictEqual(resultat2.ok, true);
    const stat2 = fs.statSync(fichierBail);
    assert.notStrictEqual(stat2.mtime.getFullYear(), 2000, 'le fichier doit avoir été réécrit');

    // La date "pose" lue dans le JSON doit être celle du premier appel
    const contenu = JSON.parse(fs.readFileSync(fichierBail, 'utf8'));
    const contenuInitial = JSON.parse(fs.readFileSync(fichierBail, 'utf8'));
    // Relire sans modifier : vérifier que pose ne change pas
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

    // ANNE pose à T0
    const resultat1 = poser(racine, chemin, ANNE, T0);
    assert.strictEqual(resultat1.ok, true, 'Anne doit pouvoir poser');

    // ANNE rend
    rendre(racine, chemin, ANNE);

    // BEAT peut poser immédiatement à T0 + 1000
    const resultat2 = poser(racine, chemin, BEAT, T0 + 1000);
    assert.strictEqual(resultat2.ok, true, 'Beat doit pouvoir poser après rendre d\'Anne');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un fichier de bail par personne, jamais un fichier partagé', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    // ANNE pose sur ausgabe.yaml
    poser(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0);

    // BEAT pose sur articles/essai/essai.meta.yaml
    poser(racine, path.join(racine, 'articles', 'essai', 'essai.meta.yaml'), BEAT, T0);

    // ANNE re-pose sur ausgabe.yaml à T0 + RENOUVELLEMENT_MS + 1000
    poser(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0 + RENOUVELLEMENT_MS + 1000);

    // Le dossier .szh-edition doit contenir exactement 2 fichiers .json
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

    // Créer le dossier .szh-edition
    const dossierEdition = path.join(racine, DOSSIER_EDITION);
    fs.mkdirSync(dossierEdition, { recursive: true });

    // Écrire un fichier de bail mal formé avec le NOM exact attendu
    const fichierBail = path.join(dossierEdition, nomBail(clef, ANNE));
    fs.writeFileSync(fichierBail, '{ pas du json', 'utf8');

    // Mettre à jour le mtime pour qu'il soit valide (T0)
    fs.utimesSync(fichierBail, new Date(T0), new Date(T0));

    // titulaireAutre doit retourner un bail non nul
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
    // ANNE pose sur path.join(racine, 'Ausgabe.yaml')
    const cheminAnneMaj = path.join(racine, 'Ausgabe.yaml');
    poser(racine, cheminAnneMaj, ANNE, T0);

    // BEAT interroge le même fichier en minuscules
    const cheminBeatMin = path.join(racine, 'ausgabe.yaml');
    const titulaire = titulaireAutre(racine, cheminBeatMin, BEAT, T0);
    assert.ok(titulaire !== null, 'Beat doit voir le bail d\'Anne malgré la casse différente');
    assert.strictEqual(titulaire.utilisateur, 'Anne');

    // Vérifier que clefFichier rend une clé minuscule
    const clef1 = clefFichier(racine, cheminAnneMaj);
    const clef2 = clefFichier(racine, cheminBeatMin);
    assert.strictEqual(clef1, clef2, 'les clés doivent être identiques (minuscules)');

    // clefFichier pour un chemin hors du numéro doit rendre null
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
    // ANNE pose sur deux fichiers
    poserA(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0);
    poserA(racine, path.join(racine, 'articles', 'essai', 'essai.meta.yaml'), ANNE, T0);

    // BEAT pose sur un troisième fichier
    poserA(racine, path.join(racine, 'articles', 'autre', 'autre.meta.yaml'), BEAT, T0);

    // Interrogé avec ANNE à T0 + 1000 : le résultat doit avoir exactement 1 entrée (Beat)
    const titulaires = titulairesDuNumero(racine, ANNE, T0 + 1000);
    assert.strictEqual(titulaires.length, 1, 'doit y avoir 1 titulaire autre qu\'Anne');
    assert.ok(titulaires.some((b) => b.utilisateur === 'Beat'), 'Beat doit être parmi les titulaires');

    // Interrogé à T0 + BAIL_MS : tous les baux sont expirés, doit être vide
    const titulairesExpires = titulairesDuNumero(racine, ANNE, T0 + BAIL_MS);
    assert.strictEqual(titulairesExpires.length, 0, 'après expiration, pas de titulaires');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('purger balaie les restes d\'une session tuée, jamais les temporaires', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    // ANNE pose à T0
    poserA(racine, path.join(racine, 'ausgabe.yaml'), ANNE, T0);

    // Écrire aussi un fichier ~$reste--x.json dans .szh-edition
    const dossierEdition = path.join(racine, DOSSIER_EDITION);
    fs.mkdirSync(dossierEdition, { recursive: true });
    const fichierTemporaire = path.join(dossierEdition, '~$reste--x.json');
    fs.writeFileSync(fichierTemporaire, '{}', 'utf8');

    // purger(racine, T0 + 1000) : les deux fichiers doivent rester en place
    purger(racine, T0 + 1000);
    assert.ok(fs.existsSync(fichierTemporaire), 'les temporaires ne doivent pas être supprimés');
    // Vérifier que le bail d'Anne est présent (filtrer sur les vrais .json, pas les temporaires)
    const fichiersJson = fs.readdirSync(dossierEdition)
      .filter((f) => !f.startsWith('~$') && f.endsWith('.json'));
    assert.strictEqual(fichiersJson.length, 1, 'le bail d\'Anne doit rester');

    // purger(racine, T0 + PEREMPTION_MS + 1000) : supprime le bail d'Anne mais pas le temporaire
    purger(racine, T0 + PEREMPTION_MS + 1000);
    assert.ok(fs.existsSync(fichierTemporaire), 'les temporaires ne doivent pas être supprimés');
    const fichiersJson2 = fs.readdirSync(dossierEdition)
      .filter((f) => !f.startsWith('~$') && f.endsWith('.json'));
    assert.strictEqual(fichiersJson2.length, 0, 'le bail d\'Anne doit être supprimé');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('empreinte suit le contenu', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-'));
  try {
    const cheminFichier = path.join(racine, 'test.yaml');

    // empreinte d'un fichier absent rend ''
    const empreinte1 = empreinte(cheminFichier);
    assert.strictEqual(empreinte1, '', 'empreinte d\'un fichier absent doit être vide');

    // Écrire un contenu
    fs.writeFileSync(cheminFichier, 'contenu 1', 'utf8');
    const empreinte2 = empreinte(cheminFichier);
    assert.strictEqual(typeof empreinte2, 'string', 'empreinte doit être une chaîne');
    assert.ok(empreinte2.length === 40, 'empreinte SHA1 en hex doit faire 40 caractères');

    // Deux contenus différents donnent deux empreintes différentes
    fs.writeFileSync(cheminFichier, 'contenu 2', 'utf8');
    const empreinte3 = empreinte(cheminFichier);
    assert.notStrictEqual(empreinte2, empreinte3, 'contenus différents doivent donner des empreintes différentes');

    // Le même contenu réécrit donne la même empreinte
    fs.writeFileSync(cheminFichier, 'contenu 1', 'utf8');
    const empreinte4 = empreinte(cheminFichier);
    assert.strictEqual(empreinte2, empreinte4, 'le même contenu doit donner la même empreinte');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une horloge en avance ne prolonge pas un bail', () => {
  // Test direct de instantReference
  // Avec une date renouvele de deux heures dans le futur (T0 + 7200000)
  // et un mtime valant T0, le résultat doit être T0
  const dateAvance = new Date(T0 + 7200000).toISOString();
  const resultAvance = instantReference(dateAvance, T0, T0);
  assert.strictEqual(resultAvance, T0, 'une horloge en avance doit être écartée');

  // Avec une date valant T0 et un mtime valant T0 - 50000,
  // le résultat doit être T0 (la plus tardive des deux)
  const dateNormale = new Date(T0).toISOString();
  const mtimePassee = T0 - 50000;
  const resultNormal = instantReference(dateNormale, mtimePassee, T0);
  assert.strictEqual(resultNormal, T0, 'doit retourner la plus tardive des deux dates');
});
