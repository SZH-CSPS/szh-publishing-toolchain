// Contrat de vscodium-extension/szh-cockpit/lib/poste.js : basePoste(), resoudreToolkit(),
// toolkitPoste(), versWsl(), toolkitWsl(), et le contrôle qu'aucun littéral ProgramData ne
// revient ailleurs dans le cockpit.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const RACINE_DEPOT = path.join(__dirname, '..', '..');
const COCKPIT = path.join(RACINE_DEPOT, 'vscodium-extension', 'szh-cockpit');
const CHEMIN_MODULE = path.join(COCKPIT, 'lib', 'poste.js');

function modulePoste() { return require(CHEMIN_MODULE); }

// resoudreToolkit()/toolkitPoste() passent par path.resolve/path.join sur des chemins Windows
// (lettre de lecteur, barre inverse), exacts seulement sous Windows, comme
// lib/rapport-erreur.js. versWsl()/toolkitWsl() manipulent des chaînes et se testent partout.
const HORS_WINDOWS = process.platform !== 'win32'
  ? 'chemins Windows — joué par le job contrats-windows'
  : false;

// Pose les variables données, exécute fn, puis restaure l'environnement (une valeur absente
// au départ redevient absente, pas une chaîne vide).
function avecEnv(vars, fn) {
  const anciennes = {};
  for (const cle of Object.keys(vars)) {
    anciennes[cle] = process.env[cle];
    if (vars[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = vars[cle]; }
  }
  try { return fn(); }
  finally {
    for (const cle of Object.keys(vars)) {
      if (anciennes[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = anciennes[cle]; }
    }
  }
}

// =========================================================================================
// basePoste()
// =========================================================================================

test('basePoste(), SZH_BASE absente, rend le défaut C:\\ProgramData\\SZH', () => {
  avecEnv({ SZH_BASE: undefined }, () => {
    assert.equal(modulePoste().basePoste(), 'C:\\ProgramData\\SZH');
  });
});

test('basePoste(), SZH_BASE renseignée, rend cette valeur', () => {
  avecEnv({ SZH_BASE: 'D:\\essai\\SZH' }, () => {
    assert.equal(modulePoste().basePoste(), 'D:\\essai\\SZH');
  });
});

test('basePoste(), SZH_BASE à blancs seuls, rend le défaut et jamais une chaîne vide', () => {
  avecEnv({ SZH_BASE: '   ' }, () => {
    assert.equal(modulePoste().basePoste(), 'C:\\ProgramData\\SZH');
  });
});

test('basePoste(), SZH_BASE entourée de blancs, rend la valeur .trim()ée', () => {
  avecEnv({ SZH_BASE: '  D:\\essai  ' }, () => {
    assert.equal(modulePoste().basePoste(), 'D:\\essai');
  });
});

// =========================================================================================
// resoudreToolkit(env, dossierModule, existe) : fonction pure, les trois branches
// =========================================================================================

test('resoudreToolkit(), SZH_TOOLKIT renseignée, l’emporte sur tout, même existe toujours vrai et SZH_BASE renseignée', () => {
  const { resoudreToolkit } = modulePoste();
  const resultat = resoudreToolkit(
    { SZH_TOOLKIT: 'C:\\ailleurs\\toolkit', SZH_BASE: 'D:\\essai\\SZH' },
    'C:\\peu\\importe\\lib',
    () => true
  );
  assert.equal(resultat, 'C:\\ailleurs\\toolkit');
});

test('resoudreToolkit(), SZH_TOOLKIT à blancs seuls, ne compte pas, les règles suivantes s’appliquent', { skip: HORS_WINDOWS }, () => {
  const { resoudreToolkit } = modulePoste();
  const resultat = resoudreToolkit(
    { SZH_TOOLKIT: '   ', SZH_BASE: 'D:\\essai' },
    'C:\\peu\\importe\\lib',
    () => false
  );
  assert.equal(resultat, 'D:\\essai\\toolkit');
});

test('resoudreToolkit(), branche dépôt, Makefile trouvé trois crans au-dessus, rend la racine du dépôt', { skip: HORS_WINDOWS }, () => {
  const { resoudreToolkit } = modulePoste();
  const dossierModule = 'C:\\depot\\vscodium-extension\\szh-cockpit\\lib';
  const existe = (p) => p === 'C:\\depot\\pipeline\\Makefile';
  const resultat = resoudreToolkit({}, dossierModule, existe);
  assert.equal(resultat, 'C:\\depot');
});

test('resoudreToolkit(), branche dépôt, Makefile absent, ne rend pas la racine du dépôt mais le poste installé', { skip: HORS_WINDOWS }, () => {
  const { resoudreToolkit } = modulePoste();
  const dossierModule = 'C:\\depot\\vscodium-extension\\szh-cockpit\\lib';
  const resultat = resoudreToolkit({}, dossierModule, () => false);
  assert.notEqual(resultat, 'C:\\depot');
  assert.equal(resultat, 'C:\\ProgramData\\SZH\\toolkit');
});

test('resoudreToolkit(), branche poste installé, SZH_BASE fixe la base sous laquelle vit toolkit', { skip: HORS_WINDOWS }, () => {
  const { resoudreToolkit } = modulePoste();
  const resultat = resoudreToolkit({ SZH_BASE: 'D:\\essai' }, 'C:\\peu\\importe\\lib', () => false);
  assert.equal(resultat, 'D:\\essai\\toolkit');
});

test('resoudreToolkit() est pure, elle ne lit rien de process.env', () => {
  const { resoudreToolkit } = modulePoste();
  const avait = process.env.SZH_TOOLKIT;
  process.env.SZH_TOOLKIT = 'C:\\piege';
  try {
    const resultat = resoudreToolkit({}, 'C:\\peu\\importe\\lib', () => false);
    assert.equal(resultat.indexOf('piege'), -1,
      'resoudreToolkit a lu process.env.SZH_TOOLKIT au lieu de se limiter au paramètre env reçu');
  } finally {
    if (avait === undefined) { delete process.env.SZH_TOOLKIT; } else { process.env.SZH_TOOLKIT = avait; }
  }
});

// =========================================================================================
// toolkitPoste()
// =========================================================================================

test('toolkitPoste(), sans SZH_TOOLKIT, lancé depuis ce dépôt, rend la racine du dépôt', () => {
  avecEnv({ SZH_TOOLKIT: undefined }, () => {
    const racineAttendue = path.resolve(__dirname, '..', '..');
    const resultat = modulePoste().toolkitPoste();
    assert.equal(resultat, racineAttendue);
    assert.ok(fs.existsSync(path.join(resultat, 'pipeline', 'Makefile')),
      'pipeline/Makefile doit exister sous la racine rendue par toolkitPoste()');
  });
});

test('toolkitPoste(), SZH_TOOLKIT renseignée, rend cette valeur', () => {
  avecEnv({ SZH_TOOLKIT: 'D:\\ailleurs\\toolkit' }, () => {
    assert.equal(modulePoste().toolkitPoste(), 'D:\\ailleurs\\toolkit');
  });
});

// =========================================================================================
// versWsl() : même comportement que cheminVersWsl() dans lib/portraits.js
// =========================================================================================

test('versWsl(), lettre de lecteur minusculisée et antislash convertis', () => {
  const { versWsl } = modulePoste();
  assert.equal(versWsl('C:\\ProgramData\\SZH\\toolkit'), '/mnt/c/ProgramData/SZH/toolkit');
});

test('versWsl(), lecteur D, la lettre est minusculisée', () => {
  const { versWsl } = modulePoste();
  assert.equal(versWsl('D:\\a\\b'), '/mnt/d/a/b');
});

test('versWsl(), chemin déjà en barres obliques, préfixe /mnt/ tout de même posé', () => {
  const { versWsl } = modulePoste();
  assert.equal(versWsl('c:/deja/slash'), '/mnt/c/deja/slash');
});

test('versWsl(), chemin UNC, pas de préfixe /mnt/, seules les barres sont converties', () => {
  const { versWsl } = modulePoste();
  assert.equal(versWsl('\\\\serveur\\partage'), '//serveur/partage');
});

test('versWsl(), chaîne vide, rend une chaîne vide sans lever', () => {
  const { versWsl } = modulePoste();
  assert.doesNotThrow(() => versWsl(''));
  assert.equal(versWsl(''), '');
});

// =========================================================================================
// toolkitWsl(...segments) : les chemins utilisés ne changent pas
// =========================================================================================

test('toolkitWsl(), le chemin réellement employé par les tâches de compilation ne bouge pas', () => {
  avecEnv({ SZH_TOOLKIT: 'C:\\ProgramData\\SZH\\toolkit' }, () => {
    const { toolkitWsl } = modulePoste();
    assert.equal(toolkitWsl('pipeline', 'Makefile'), '/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile');
  });
});

// vscodium-user/tasks.json nomme huit fois le Makefile de production, que VSCodium exécute
// quand une rédactrice compile. Ce chemin doit être celui que rend toolkitWsl().
test('le chemin de Makefile des tâches VSCodium et celui de toolkitWsl() ne divergent pas', () => {
  const cheminTaches = path.join(RACINE_DEPOT, 'vscodium-user', 'tasks.json');
  const contenu = fs.readFileSync(cheminTaches, 'utf8');
  const trouves = [...contenu.matchAll(/-f\s+'([^']+\/Makefile)'/g)].map((m) => m[1]);
  assert.ok(trouves.length > 0, 'aucun chemin de Makefile trouvé dans ' + cheminTaches);
  for (const chemin of trouves) {
    assert.equal(chemin, trouves[0], 'les tâches ne portent pas toutes le même chemin de Makefile : ' + chemin);
  }
  avecEnv({ SZH_TOOLKIT: 'C:\\ProgramData\\SZH\\toolkit' }, () => {
    const { toolkitWsl } = modulePoste();
    assert.equal(toolkitWsl('pipeline', 'Makefile'), trouves[0]);
  });
});

// lib/cmyk.js et lib/portraits.js calculent leur SCRIPT_DEFAUT au chargement : SZH_TOOLKIT se
// rejoue dans un node enfant, avant tout require de ces modules (le cache de require
// masquerait un essai après coup). lib/pdfua-hote.js n'est pas contrôlé ici : sa constante
// MAKEFILE_WSL n'est pas exportée.
test('lib/cmyk.js et lib/portraits.js suivent SZH_TOOLKIT dès le chargement', () => {
  const cheminCmyk = path.join(COCKPIT, 'lib', 'cmyk.js');
  const cheminPortraits = path.join(COCKPIT, 'lib', 'portraits.js');
  const lignesScript = [
    'const cmyk = require(' + JSON.stringify(cheminCmyk) + ');',
    'const portraits = require(' + JSON.stringify(cheminPortraits) + ');',
    'process.stdout.write(JSON.stringify({ cmyk: cmyk.SCRIPT_DEFAUT, portraits: portraits.SCRIPT_DEFAUT }));',
  ];
  const fichierScript = path.join(os.tmpdir(), 'szh-poste-sonde-' + process.pid + '.js');
  fs.writeFileSync(fichierScript, lignesScript.join('\n'), 'utf8');
  try {
    const env = Object.assign({}, process.env, { SZH_TOOLKIT: 'D:\\faux' });
    const resultat = spawnSync(process.execPath, [fichierScript], { env, encoding: 'utf8' });
    assert.equal(resultat.status, 0, 'le node enfant a échoué : ' + resultat.stderr);
    const sortie = JSON.parse(resultat.stdout);
    assert.equal(sortie.cmyk, '/mnt/d/faux/pipeline/cmyk-rgb.py');
    assert.equal(sortie.portraits, '/mnt/d/faux/pipeline/portraits.py');
  } finally {
    fs.rmSync(fichierScript, { force: true });
  }
});

// Un littéral ProgramData hors de ces trois fichiers est un chemin en dur, ou un module qui ne
// passe pas par lib/poste.js.
test('aucun littéral ProgramData ne revient hors de la liste blanche', () => {
  const listeBlanche = new Set([
    path.join('lib', 'poste.js'),          // la source du chemin
    path.join('lib', 'codes-erreur.js'),   // motif de caviardage, pas un chemin lu sur le poste
    path.join('lib', 'articles.js'),       // texte d'en-tête pour le lecteur, pas un chemin ouvert
  ]);
  const reLitteral = /['"`][^'"`\n]*ProgramData/;
  const fautifs = [];
  (function parcourir(dossier) {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (!entree.name.endsWith('.js')) { continue; }
      const relatif = path.relative(COCKPIT, chemin);
      if (listeBlanche.has(relatif)) { continue; }
      const lignes = fs.readFileSync(chemin, 'utf8').split(/\r?\n/);
      lignes.forEach((ligne, i) => {
        if (ligne.trim().startsWith('//')) { return; }
        if (reLitteral.test(ligne)) { fautifs.push(relatif + ':' + (i + 1)); }
      });
    }
  })(COCKPIT);
  assert.deepEqual(fautifs, [], 'littéral ProgramData hors liste blanche : ' + fautifs.join(', '));
});

// =========================================================================================
// Les dossiers de l'utilisateur et de Windows, lus à l'appel
// =========================================================================================

test('racineUtilisateur(), LOCALAPPDATA renseignée, rend cette valeur ; absente, le profil', () => {
  avecEnv({ LOCALAPPDATA: '  D:\\Local  ' }, () => {
    assert.equal(modulePoste().racineUtilisateur(), 'D:\\Local');
  });
  avecEnv({ LOCALAPPDATA: undefined }, () => {
    assert.equal(modulePoste().racineUtilisateur(), path.join(os.homedir(), 'AppData', 'Local'));
  });
});

// Le repli de dossierBureau() est éprouvé dans bureau-visible.test.js, sans PowerShell.
test('dossierProfil() suit USERPROFILE, puis rien', () => {
  avecEnv({ USERPROFILE: 'D:\\Profil', HOME: 'D:\\Maison' }, () => {
    assert.equal(modulePoste().dossierProfil(), 'D:\\Profil');
  });
  avecEnv({ USERPROFILE: undefined, HOME: 'D:\\Maison' }, () => {
    assert.equal(modulePoste().dossierProfil(), '');
  });
});

test('dossierEditeur() et cheminSysteme() suivent APPDATA et WINDIR', () => {
  avecEnv({ APPDATA: 'D:\\Roaming', WINDIR: 'D:\\Win' }, () => {
    assert.equal(modulePoste().dossierEditeur(), path.join('D:\\Roaming', 'VSCodium'));
    assert.equal(modulePoste().cheminSysteme('wsl.exe'), path.join('D:\\Win', 'System32', 'wsl.exe'));
  });
  avecEnv({ WINDIR: undefined }, () => {
    assert.equal(modulePoste().cheminSysteme('wsl.exe'), path.join('C:\\Windows', 'System32', 'wsl.exe'));
  });
});

// Les variables des dossiers Windows ne se lisent que dans lib/poste.js : c'est le seul
// fichier à adapter pour un autre système.
test('LOCALAPPDATA, USERPROFILE, APPDATA et WINDIR ne se lisent que dans lib/poste.js', () => {
  const reVariable = /process\.env(\.|\[\s*['"])(LOCALAPPDATA|USERPROFILE|APPDATA|WINDIR)\b/;
  const fautifs = [];
  (function parcourir(dossier) {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) {
        if (entree.name !== 'node_modules') { parcourir(chemin); }
        continue;
      }
      if (!entree.name.endsWith('.js')) { continue; }
      const relatif = path.relative(COCKPIT, chemin);
      if (relatif === path.join('lib', 'poste.js')) { continue; }
      const lignes = fs.readFileSync(chemin, 'utf8').split(/\r?\n/);
      lignes.forEach((ligne, i) => {
        if (ligne.trim().startsWith('//')) { return; }
        if (reVariable.test(ligne)) { fautifs.push(relatif + ':' + (i + 1)); }
      });
    }
  })(COCKPIT);
  assert.deepEqual(fautifs, [], 'variable du poste lue hors de lib/poste.js : ' + fautifs.join(', '));
});
