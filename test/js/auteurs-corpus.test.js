// Enrichissement du cache des auteurs avec les données du corpus local.
//
//   node --test "test/js/*.test.js"
//
// AUCUN PowerShell ici : racinesCorpus prend sa fonction d'exécution en paramètre, et les
// tests la remplacent par une table de fixtures. Le cache passe par SZH_AUTEURS_CACHE pour
// ne pas toucher C:\ProgramData. L'arborescence factice monte un corpus complet avec des
// pièges : absence de ausgabe.yaml, fichiers non-meta, mtime invariants.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auteursCacheModule = path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'auteurs-corpus.js');
const auteursCacheImported = require(auteursCacheModule);
const {
  racinesCorpus, balayerCorpus, cacheFrais, rafraichirCorpus
} = auteursCacheImported;

const auteursOjs = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'auteurs-ojs.js'));
const { lireCache, ecrireCache } = auteursOjs;

// ---- Utilitaires pour arborescence factice et cache temporaire ----------

function cacheTemporaire(nom) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-' + nom + '-'));
  return path.join(dossier, 'auteurs.json');
}

function avecCacheAsync(nom, fn) {
  const avant = process.env.SZH_AUTEURS_CACHE;
  process.env.SZH_AUTEURS_CACHE = cacheTemporaire(nom);
  try { return fn(process.env.SZH_AUTEURS_CACHE); }
  finally {
    if (avant === undefined) { delete process.env.SZH_AUTEURS_CACHE; }
    else { process.env.SZH_AUTEURS_CACHE = avant; }
  }
}

async function avecCacheAsyncAlt(nom, fn) {
  const avant = process.env.SZH_AUTEURS_CACHE;
  process.env.SZH_AUTEURS_CACHE = cacheTemporaire(nom);
  try { return await fn(process.env.SZH_AUTEURS_CACHE); }
  finally {
    if (avant === undefined) { delete process.env.SZH_AUTEURS_CACHE; }
    else { process.env.SZH_AUTEURS_CACHE = avant; }
  }
}

function mkCorpus(racine, structure) {
  // structure: { '2024-01': { 'a1': { 'auteur 1': { prenom, nom, fonction, affiliation, email } } } }
  for (const anneeNum in structure) {
    const numero = path.join(racine, anneeNum);
    fs.mkdirSync(numero, { recursive: true });
    // Écrire ausgabe.yaml pour dire que c'est un numéro.
    fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'titre: Test\n', 'utf8');
    const articlesDir = path.join(numero, 'articles');
    for (const slug in structure[anneeNum]) {
      const auteurs = structure[anneeNum][slug];
      const slugDir = path.join(articlesDir, slug);
      fs.mkdirSync(slugDir, { recursive: true });
      // Écrire le meta.yaml.
      const auteursList = Object.keys(auteurs).map((nom) => {
        const a = auteurs[nom];
        return `- prenom: "${a.prenom || ''}"
  nom: "${a.nom || ''}"
  fonction: "${a.fonction || ''}"
  affiliation: "${a.affiliation || ''}"
  email: "${a.email || ''}"`;
      }).join('\n');
      const metaYaml = `type: article
author:
${auteursList}
`;
      fs.writeFileSync(path.join(slugDir, slug + '.meta.yaml'), metaYaml, 'utf8');
    }
  }
}

// ---- Tests principaux ---------------------------------------------------------

test('balayerCorpus : un numéro complet, les 4 champs remontent', () => {
  avecCacheAsync('complet', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      mkCorpus(racine, {
        '2024-01': {
          'a1': {
            'Géraldine': {
              prenom: 'Géraldine', nom: 'Ayer', fonction: 'Collaboratrice scientifique',
              affiliation: 'SZH/CSPS', email: 'geraldine.ayer@csps.ch'
            },
            'Robin': {
              prenom: 'Robin', nom: 'Morand', fonction: 'Ingénieur',
              affiliation: 'SZH', email: 'robin.morand@szh.ch'
            }
          },
          'a2': {
            'Anne': {
              prenom: 'Anne', nom: 'Dupont', fonction: 'Médecin',
              affiliation: 'Hôpital', email: 'a.dupont@hopital.ch'
            }
          }
        }
      });
      const res = balayerCorpus({ racines: [racine] });
      assert.strictEqual(res.auteurs.length, 3, 'trois auteurs attendus');
      const ayer = res.auteurs.find((a) => a.nom === 'Ayer');
      assert.strictEqual(ayer.prenom, 'Géraldine');
      assert.strictEqual(ayer.fonction, 'Collaboratrice scientifique');
      assert.strictEqual(ayer.affiliation, 'SZH/CSPS');
      assert.strictEqual(ayer.email, 'geraldine.ayer@csps.ch');
      assert.strictEqual(ayer.source, 'corpus');
      assert.ok(res.complet, 'balayage doit être complet');
      assert.strictEqual(res.fichiers, 2, 'deux fiches lues');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('balayerCorpus : un dossier SANS ausgabe.yaml est ignoré', () => {
  avecCacheAsync('sansnumero', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      // Dossier sans ausgabe.yaml.
      const pasnumero = path.join(racine, '2024-00');
      const articlesDir = path.join(pasnumero, 'articles', 'a1');
      fs.mkdirSync(articlesDir, { recursive: true });
      fs.writeFileSync(path.join(articlesDir, 'a1.meta.yaml'),
        'author:\n- prenom: Robin\n  nom: Morand\n', 'utf8');
      // Et un vrai numéro avec ausgabe.yaml.
      mkCorpus(racine, {
        '2024-01': {
          'a1': { 'Robin': { prenom: 'Robin', nom: 'Morand', fonction: '', affiliation: '', email: '' } }
        }
      });
      const res = balayerCorpus({ racines: [racine] });
      assert.strictEqual(res.auteurs.length, 1, 'un seul auteur, du numéro valide');
      assert.strictEqual(res.fichiers, 1, 'une seule fiche lue');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('balayerCorpus : une fiche dont le mtime n\'a pas bougé n\'est PAS relue', () => {
  avecCacheAsync('mtime', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      mkCorpus(racine, {
        '2024-01': {
          'a1': { 'Robin': { prenom: 'Robin', nom: 'Morand', fonction: 'Dev', affiliation: 'SZH', email: 'r@szh.ch' } }
        }
      });
      const mtimeMs = fs.statSync(path.join(racine, '2024-01', 'articles', 'a1', 'a1.meta.yaml')).mtimeMs;
      const vus = {};
      vus[path.join(racine, '2024-01', 'articles', 'a1', 'a1.meta.yaml')] = mtimeMs;
      let appelsLecture = 0;
      const lireFactice = (chemin) => {
        appelsLecture++;
        return fs.readFileSync(chemin, 'utf8');
      };
      const res = balayerCorpus({ racines: [racine], vus: vus, lire: lireFactice });
      // Le mtime n'a pas changé, donc la fiche ne doit pas être relue.
      assert.strictEqual(appelsLecture, 0, 'la fiche avec mtime connu ne doit pas être lue');
      assert.strictEqual(res.auteurs.length, 0, 'aucun auteur trouvé (fiche sautée)');
      assert.strictEqual(res.fichiers, 1, 'la fiche a été comptée même sautée');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('balayerCorpus : AUCUN fichier autre qu\'un *.meta.yaml n\'est ouvert', () => {
  avecCacheAsync('pieges', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      mkCorpus(racine, {
        '2024-01': {
          'a1': { 'Robin': { prenom: 'Robin', nom: 'Morand', fonction: '', affiliation: '', email: '' } }
        }
      });
      // Poser des pièges : un .md et un .docx dans la même arborescence.
      const articlesDir = path.join(racine, '2024-01', 'articles', 'a1');
      fs.writeFileSync(path.join(articlesDir, 'a1.md'), '# Contenu\n', 'utf8');
      fs.writeFileSync(path.join(articlesDir, 'a1.docx'), 'faux docx', 'utf8');
      const fichierLuSet = new Set();
      const lireFactice = (chemin) => {
        fichierLuSet.add(path.basename(chemin));
        return fs.readFileSync(chemin, 'utf8');
      };
      const res = balayerCorpus({ racines: [racine], lire: lireFactice });
      // On ne doit lire que la fiche .meta.yaml.
      for (const fichier of fichierLuSet) {
        assert.ok(fichier.endsWith('.meta.yaml'), 'fichier lu : ' + fichier + ' (devrait être .meta.yaml)');
      }
      assert.strictEqual(res.auteurs.length, 1, 'un auteur trouvé');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('balayerCorpus : le plafond de fichiers coupe proprement, complet=false, résultats gardés', () => {
  avecCacheAsync('plafond', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      const corpus = {};
      for (let i = 0; i < 10; i++) {
        const annee = '2024-' + String(i).padStart(2, '0');
        const slug = 'a' + i;
        corpus[annee] = {};
        corpus[annee][slug] = {
          'Auteur': { prenom: 'Auteur' + i, nom: 'Test', fonction: '', affiliation: '', email: '' }
        };
      }
      mkCorpus(racine, corpus);
      const res = balayerCorpus({ racines: [racine], plafondFichiers: 3 });
      assert.strictEqual(res.fichiers, 3, 'exactement 3 fiches lues');
      assert.strictEqual(res.complet, false, 'balayage marqué incomplet');
      assert.strictEqual(res.auteurs.length, 3, '3 auteurs trouvés avant la coupure');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

// La borne de temps, celle qui protège d'un OneDrive qui s'hydrate au compte-gouttes.
// Elle était morte : le code comparait `maintenant` à lui-même, et le test d'origine ne
// regardait que le cas où l'on ne coupe pas — il passait quoi qu'il arrive. L'horloge est
// donc injectée, et on vérifie les DEUX côtés de la borne.
test('balayerCorpus : la borne de temps coupe, et ne coupe pas quand le budget suffit', () => {
  avecCacheAsync('delai', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      mkCorpus(racine, {
        '2024-01': { 'a1': { 'Robin': { prenom: 'Robin', nom: 'Morand' } } },
        '2024-02': { 'a2': { 'Anne': { prenom: 'Anne', nom: 'Berger' } } },
        '2024-03': { 'a3': { 'Luc': { prenom: 'Luc', nom: 'Perren' } } }
      });
      const large = balayerCorpus({ racines: [racine], delaiMs: 100000, horloge: () => 0 });
      assert.strictEqual(large.complet, true, 'un budget suffisant ne doit pas couper');
      assert.strictEqual(large.fichiers, 3, 'les trois fiches sont vues');

      // Une horloge qui bondit au-delà du budget dès le premier regard.
      let tic = 0;
      const court = balayerCorpus({
        racines: [racine], delaiMs: 10, horloge: () => { tic += 1000; return tic; }
      });
      assert.strictEqual(court.complet, false, 'la borne de temps n a pas coupé');
      assert.ok(court.fichiers < 3, 'coupé, donc moins de fiches que le corpus entier');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('balayerCorpus : une racine inexistante est sautée silencieusement', () => {
  avecCacheAsync('inexistante', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    const inexistante = path.join(racine, 'fantome');
    try {
      mkCorpus(racine, {
        '2024-01': {
          'a1': { 'Robin': { prenom: 'Robin', nom: 'Morand', fonction: '', affiliation: '', email: '' } }
        }
      });
      // Passer une racine inexistante ET une valide.
      const res = balayerCorpus({ racines: [inexistante, racine] });
      assert.strictEqual(res.auteurs.length, 1, 'un auteur trouvé malgré la racine inexistante');
      assert.strictEqual(res.erreur, null, 'aucune erreur signalée');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('balayerCorpus : un meta.yaml illisible fait sauter la fiche, pas le balayage', () => {
  avecCacheAsync('illisible', () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      mkCorpus(racine, {
        '2024-01': {
          'a1': { 'Robin': { prenom: 'Robin', nom: 'Morand', fonction: '', affiliation: '', email: '' } },
          'a2': { 'Anne': { prenom: 'Anne', nom: 'Dupont', fonction: '', affiliation: '', email: '' } }
        }
      });
      // Rendre a1.meta.yaml illisible en le supprimant après.
      const metaA1 = path.join(racine, '2024-01', 'articles', 'a1', 'a1.meta.yaml');
      const autreMeta = path.join(racine, '2024-01', 'articles', 'a2', 'a2.meta.yaml');
      const lectureFactice = (chemin) => {
        if (chemin === metaA1) { throw new Error('fiche corrompue'); }
        return fs.readFileSync(chemin, 'utf8');
      };
      const res = balayerCorpus({ racines: [racine], lire: lectureFactice });
      // La fiche a2 doit toujours être lue, et a1 sautée.
      assert.strictEqual(res.auteurs.length, 1, 'un auteur trouvé (a1 sauté)');
      assert.strictEqual(res.auteurs[0].nom, 'Dupont');
      assert.match(String(res.erreur), /fiche corrompue/, 'erreur signalée');
      assert.ok(res.complet, 'le balayage reste complet malgré l\'erreur');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('rafraichirCorpus : dateCorpus n\'avance pas sur balayage partiel, mais vus est écrit', async () => {
  return avecCacheAsyncAlt('dateCorpusPtiel', async () => {
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-corpus-test-'));
    try {
      // Corpus avec plusieurs numéros pour déclencher le plafond.
      const corpus = {};
      for (let i = 0; i < 10; i++) {
        const annee = '2024-' + String(i + 1).padStart(2, '0');
        const slug = 'a' + i;
        const auteurObj = {};
        auteurObj['Auteur'] = { prenom: 'Au' + i, nom: 'Test', fonction: '', affiliation: '', email: '' };
        corpus[annee] = {};
        corpus[annee][slug] = auteurObj;
      }
      mkCorpus(racine, corpus);
      // Cache vierge.
      ecrireCache({ version: 1, dateFetch: null, dateCorpus: null, auteurs: [], vus: {} });
      const maintenant = Date.parse('2026-08-25T12:00:00Z');
      const res = await rafraichirCorpus({
        racines: [racine], maintenant: maintenant, plafondFichiers: 3,
        executer: async () => { return JSON.stringify({ encours: [racine], archives: [] }); }
      });
      assert.strictEqual(res.fait, true);
      assert.strictEqual(res.complet, false, 'balayage partiel');
      assert.strictEqual(res.dateCorpus, null, 'dateCorpus n\'avance pas');
      // Mais vus doit être écrit avec les fiches déjà vues.
      const cacheAprès = lireCache();
      assert.ok(Object.keys(cacheAprès.vus).length > 0, 'vus doit avoir des entrées');
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

test('racinesCorpus : exécuteur injecté, pas de PowerShell réel', async () => {
  const executeur = async (lignes) => {
    return JSON.stringify({
      encours: ['/test/revue1', '/test/revue2'],
      archives: ['/test/archive1']
    });
  };
  const res = await racinesCorpus({ executer: executeur });
  assert.strictEqual(res.racines.length, 3);
  assert.ok(res.racines.includes('/test/revue1'));
  assert.ok(res.racines.includes('/test/archive1'));
  assert.strictEqual(res.erreur, null);
});

test('racinesCorpus : JSON illisible rend erreur', async () => {
  const executeur = async () => { return '{ pas du json'; };
  const res = await racinesCorpus({ executer: executeur });
  assert.strictEqual(res.racines.length, 0);
  assert.match(String(res.erreur), /JSON illisible/);
});

test('cacheFrais : moins de 30 jours, bornes et horloge repassée', () => {
  const maintenant = Date.parse('2026-08-25T12:00:00Z');
  const jour = 24 * 3600 * 1000;
  // Moins de 30 jours : frais.
  assert.strictEqual(cacheFrais('2026-08-25T11:00:00Z', maintenant), true);
  assert.strictEqual(cacheFrais(new Date(maintenant - 29 * jour).toISOString(), maintenant), true);
  // Plus de 30 jours : périmé.
  assert.strictEqual(cacheFrais(new Date(maintenant - 31 * jour).toISOString(), maintenant), false);
  // Horloge repassée en arrière.
  assert.strictEqual(cacheFrais(new Date(maintenant + jour).toISOString(), maintenant), false);
  // Valeurs invalides.
  assert.strictEqual(cacheFrais(null, maintenant), false);
  assert.strictEqual(cacheFrais('pas une date', maintenant), false);
  assert.strictEqual(cacheFrais('', maintenant), false);
});
