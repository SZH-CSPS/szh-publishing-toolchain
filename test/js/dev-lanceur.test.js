// outils-dev/pronto-dev.ps1 : une instance de développement qui lit le dépôt en place et
// laisse intacts l'installation de production (C:\ProgramData\SZH) et les réglages
// VSCodium du compte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(RACINE, 'outils-dev', 'pronto-dev.ps1');
// Nom du .lnk posé par Set-SzhRaccourciDev (pronto-dev.ps1), utilisé par les groupes 4 et 6.
const NOM_RACCOURCI_DEV = 'Pronto (dev)';

function assertScriptExiste() {
  assert.ok(fs.existsSync(SCRIPT), 'script absent, aucun controle possible - ' + SCRIPT);
}

function echapperRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Comparaison segment par segment : avec startsWith, « C:\ProgramData\SZH-dev » passerait
// pour un sous-dossier de « C:\ProgramData\SZH ».
function segments(p) {
  return path.resolve(p).toLowerCase().split(path.sep).filter(Boolean);
}
function estSousChemin(chemin, base) {
  const c = segments(chemin);
  const b = segments(base);
  if (c.length < b.length) { return false; }
  for (let i = 0; i < b.length; i++) { if (c[i] !== b[i]) { return false; } }
  return true;
}

function versWsl(cheminWindows) {
  const resolu = path.resolve(cheminWindows).replace(/\\/g, '/');
  const correspondance = resolu.match(/^([A-Za-z]):\/(.*)$/);
  if (!correspondance) { return resolu; }
  return '/mnt/' + correspondance[1].toLowerCase() + '/' + correspondance[2];
}

// ---- Groupe 1 : le mode simulation, un seul appel partagé par tous les contrôles ----

function executerSimulation(baseDev) {
  if (!POWERSHELL) { return null; }
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-Simuler', '-BaseDev', baseDev], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  let sortie = null;
  if (run.stdout) { try { sortie = JSON.parse(run.stdout.trim()); } catch (e) { /* rapporte par l'appelant */ } }
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', sortie };
}

const DOSSIER_SIM = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-simuler-'));
const SIMULATION = executerSimulation(DOSSIER_SIM);
const CONTENU_APRES_SIM = fs.readdirSync(DOSSIER_SIM);
fs.rmSync(DOSSIER_SIM, { recursive: true, force: true });

test('outils-dev/pronto-dev.ps1 existe', () => {
  assertScriptExiste();
});

test('mode simulation - code 0, JSON valide, rien ecrit dans le dossier jetable', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  assert.ok(SIMULATION, 'aucun resultat de simulation');
  assert.strictEqual(SIMULATION.status, 0, 'le mode simulation a echoue - ' + SIMULATION.stderr);
  assert.ok(SIMULATION.sortie, 'sortie non JSON - ' + SIMULATION.stdout + ' / ' + SIMULATION.stderr);
  assert.deepStrictEqual(CONTENU_APRES_SIM, [],
    'le mode simulation a ecrit dans le dossier jetable - ' + CONTENU_APRES_SIM.join(', '));
});

test('racineDepot est la racine du depot, pipeline/Makefile y existe vraiment', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  assert.strictEqual(path.resolve(s.racineDepot), RACINE, 'racineDepot inattendu - ' + s.racineDepot);
  const makefile = path.join(s.racineDepot, 'pipeline', 'Makefile');
  assert.ok(fs.existsSync(makefile), makefile + ' n\'existe pas sur le disque');
});

test('jonctions - exactement trois entrees, chacune nommee', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  assert.strictEqual(s.jonctions.length, 3,
    'jonctions ne porte pas exactement trois entrees - ' + JSON.stringify(s.jonctions));
  const baseDevAbs = path.resolve(s.baseDev);
  const racineAbs = path.resolve(s.racineDepot);

  const toolkit = s.jonctions.find((j) => path.resolve(j.lien) === path.join(baseDevAbs, 'toolkit'));
  assert.ok(toolkit, 'aucune jonction <baseDev>\\toolkit');
  assert.strictEqual(path.resolve(toolkit.cible), racineAbs,
    'la jonction toolkit ne vise pas la racine du depot - ' + toolkit.cible);

  const cockpit = s.jonctions.find((j) =>
    path.resolve(j.lien) === path.join(baseDevAbs, 'codium', 'extensions', 'szh-cockpit'));
  assert.ok(cockpit, 'aucune jonction <baseDev>\\codium\\extensions\\szh-cockpit');
  assert.strictEqual(path.resolve(cockpit.cible), path.join(racineAbs, 'vscodium-extension', 'szh-cockpit'),
    'la jonction szh-cockpit ne vise pas vscodium-extension\\szh-cockpit - ' + cockpit.cible);

  const apercu = s.jonctions.find((j) =>
    path.resolve(j.lien) === path.join(baseDevAbs, 'codium', 'extensions', 'szh-apercu'));
  assert.ok(apercu, 'aucune jonction <baseDev>\\codium\\extensions\\szh-apercu');
  assert.strictEqual(path.resolve(apercu.cible), path.join(racineAbs, 'vscodium-extension', 'szh-apercu'),
    'la jonction szh-apercu ne vise pas vscodium-extension\\szh-apercu - ' + apercu.cible);
});

// L'instance de développement ne désigne aucun chemin de la production (C:\ProgramData\SZH,
// %APPDATA%\VSCodium, %USERPROFILE%\.vscode-oss). Le message d'échec nomme chaque valeur
// fautive.
test('aucun chemin de fichiers, jonctions.lien, variables ou raccourci ne vise la production', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  const basesInterdites = [
    'C:\\ProgramData\\SZH',
    path.join(process.env.APPDATA || 'C:\\Users\\Default\\AppData\\Roaming', 'VSCodium'),
    path.join(process.env.USERPROFILE || 'C:\\Users\\Default', '.vscode-oss'),
  ];
  const candidats = []
    .concat((s.fichiers || []).map((f) => ['fichiers[]', f]))
    .concat((s.jonctions || []).map((j) => ['jonctions[].lien', j.lien]))
    .concat(Object.entries(s.variables || {}).map(([cle, valeur]) => ['variables.' + cle, valeur]))
    .concat([['raccourci', s.raccourci]]);

  for (const [origine, valeur] of candidats) {
    // Seule exception, en lecture : les journaux de mise à jour du poste, à ce chemin exact
    // (le test suivant vérifie que rien n'écrit par cette variable).
    if (origine === 'variables.SZH_JOURNAUX_MAJ'
      && path.resolve(valeur) === path.resolve('C:\\ProgramData\\SZH', 'logs')) { continue; }
    for (const base of basesInterdites) {
      assert.ok(!estSousChemin(valeur, base),
        origine + ' = ' + valeur + ' est sous ' + base + ' (production), la valeur fautive ci-dessus le nomme');
    }
  }
});

// SZH_JOURNAUX_MAJ vise la production : seuls pronto-dev.ps1, qui la pose, et son lecteur la
// nomment, et le lecteur n'écrit pas dans le dossier qu'elle désigne.
test('SZH_JOURNAUX_MAJ n\'est lue que par le lecteur des journaux, qui n\'ecrit pas', () => {
  const racine = path.resolve(__dirname, '..', '..');
  const autorises = [path.join('vscodium-extension', 'szh-cockpit', 'lib', 'journaux-maj.js'),
    path.join('outils-dev', 'pronto-dev.ps1')];
  const vus = [];
  const parcourir = (d) => {
    for (const e of fs.readdirSync(path.join(racine, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') { parcourir(rel); } continue; }
      // Le code seulement : un commentaire qui la nomme ne compte pas.
      const code = /\.(js|ps1)$/.test(e.name) ? fs.readFileSync(path.join(racine, rel), 'utf8').split(/\r?\n/)
        .filter((l) => !/^\s*(#|\/\/)/.test(l)).join('\n') : '';
      if (code.includes('SZH_JOURNAUX_MAJ')) {
        vus.push(rel);
      }
    }
  };
  for (const d of ['vscodium-extension', 'windows', 'outils-dev', 'outils']) {
    if (fs.existsSync(path.join(racine, d))) { parcourir(d); }
  }
  assert.deepStrictEqual(vus.sort(), autorises.slice().sort());
  const js = fs.readFileSync(path.join(racine, autorises[0]), 'utf8');
  assert.ok(!/\b(writeFile|appendFile|mkdir|rename|unlink|rm|copyFile)\w*\(/.test(js), 'journaux-maj.js ecrit sur le disque');
});

test('raccourci nomme bien Pronto (dev).lnk', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  assert.ok(s.raccourci, 'le plan ne porte pas la cle raccourci');
  assert.strictEqual(path.basename(s.raccourci), NOM_RACCOURCI_DEV + '.lnk',
    'raccourci ne nomme pas ' + NOM_RACCOURCI_DEV + '.lnk - ' + s.raccourci);
});

test('les fichiers hors du dossier jetable ne sont autorises que sous la racine du depot', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  const baseDevAbs = path.resolve(s.baseDev);
  const racineAbs = path.resolve(s.racineDepot);
  const horsCadre = (s.fichiers || []).filter((f) =>
    !estSousChemin(f, baseDevAbs) && !estSousChemin(f, racineAbs));
  assert.deepStrictEqual(horsCadre, [],
    'chemins de fichiers hors du dossier jetable et hors du depot - ' + horsCadre.join(', '));
});

test('variables porte SZH_BASE sur le dossier jetable, jamais sur la production', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  assert.ok(s.variables && Object.prototype.hasOwnProperty.call(s.variables, 'SZH_BASE'),
    'variables ne porte pas SZH_BASE');
  assert.strictEqual(path.resolve(s.variables.SZH_BASE), path.resolve(s.baseDev),
    'SZH_BASE ne vaut pas le dossier jetable - ' + s.variables.SZH_BASE);
});

// L'onglet Log de l'instance de dev lit les journaux de mise a jour du poste : aucune mise a
// jour n'ecrit sous le dossier jetable.
test('variables designe les journaux de mise a jour du poste', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  assert.strictEqual(path.resolve(String(s.variables.SZH_JOURNAUX_MAJ || '')),
    path.resolve(process.env.ProgramData || 'C:\\ProgramData', 'SZH', 'logs'),
    'SZH_JOURNAUX_MAJ ne designe pas les journaux du poste - ' + s.variables.SZH_JOURNAUX_MAJ);
});

test('makefileWsl commence par /mnt/ et ne designe plus le toolkit de production', { skip: sansPowerShell }, () => {
  assertScriptExiste();
  const s = SIMULATION.sortie;
  assert.match(s.makefileWsl, /^\/mnt\//, 'makefileWsl ne commence pas par /mnt/ - ' + s.makefileWsl);
  assert.ok(s.makefileWsl.indexOf('ProgramData/SZH/toolkit') === -1,
    'makefileWsl designe encore ProgramData/SZH/toolkit - ' + s.makefileWsl);
});

// ---- Groupe 2 : la réécriture des tâches de compilation ----

const TASKS_SOURCE = path.join(RACINE, 'vscodium-user', 'tasks.json');
const CONTENU_TASKS_SOURCE = fs.readFileSync(TASKS_SOURCE, 'utf8');
const MOTIF_MAKEFILE_PROD = '/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile';
// Nombre de tâches lu dans la source, pour qu'une tâche ajoutée soit aussi contrôlée.
const NB_MAKEFILE_SOURCE =
  (CONTENU_TASKS_SOURCE.match(new RegExp(echapperRegex(MOTIF_MAKEFILE_PROD), 'g')) || []).length;
assert.ok(NB_MAKEFILE_SOURCE > 0,
  'aucune occurrence du Makefile de production dans vscodium-user/tasks.json, le calcul de reference est casse');

const MAKEFILE_DEPOT_WSL = versWsl(path.join(RACINE, 'pipeline', 'Makefile'));

// Les tâches de démarrage de l'Accueil (ancrage, check-in, rapports, arbre d'essai) visent
// des dossiers jetables à côté de la base de dev, et non le dossier partagé.
function posteDemarrage(dossier) {
  const d = (n) => { const p = path.join(dossier, 'poste', n); fs.mkdirSync(p, { recursive: true }); return p; };
  return { SZH_ANCRAGE: d(path.join('sp', 'Daten_Allgemein - General')), SZH_RAPPORTS: d('rapports'),
    SZH_RACINE_PROD: d('prod'), SZH_RACINE_TEST: d('test'), LOCALAPPDATA: d('local') };
}

function executerReel(baseDev, args) {
  if (!POWERSHELL) { return null; }
  // SZH_LANCEUR_SIMULE=1 : le script finit par appeler windows/open-revue.ps1, qui ouvrirait
  // sinon une vraie fenêtre pendant les tests.
  // -Menu vers un dossier jetable : chaque lancement pose Pronto (dev).lnk au menu Démarrer
  // (Set-SzhRaccourciDev). APPDATA reste celui du poste, pour que le groupe 4 vérifie que le
  // script n'y écrit pas de lui-même.
  const menuJetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-menu-'));
  const env = Object.assign({}, process.env, { SZH_LANCEUR_SIMULE: '1' }, posteDemarrage(path.dirname(baseDev)));
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-BaseDev', baseDev, '-Menu', menuJetable].concat(args || []), { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  fs.rmSync(menuJetable, { recursive: true, force: true });
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '' };
}

const REECRITURE = (function () {
  if (!POWERSHELL) { return null; }
  const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-reecriture-'));
  const baseDev = path.join(jetable, 'SZH-dev');
  const empreinteAvant = fs.readFileSync(TASKS_SOURCE);
  const r = executerReel(baseDev);
  const empreinteApres = fs.readFileSync(TASKS_SOURCE);
  const produit = path.join(baseDev, 'codium', 'data', 'User', 'tasks.json');
  const produitExiste = fs.existsSync(produit);
  const contenuProduit = produitExiste ? fs.readFileSync(produit, 'utf8') : null;
  fs.rmSync(jetable, { recursive: true, force: true });
  return { r, produitExiste, contenuProduit, empreinteAvant, empreinteApres, baseDev };
})();

test('reecriture des taches de compilation - zero occurrence de la production, meme nombre de Makefile du depot',
  { skip: sansPowerShell }, () => {
    assertScriptExiste();
    assert.ok(REECRITURE.r && REECRITURE.r.status === 0,
      'le script a echoue - ' + (REECRITURE.r ? REECRITURE.r.stderr : ''));
    const produit = path.join(REECRITURE.baseDev, 'codium', 'data', 'User', 'tasks.json');
    assert.ok(REECRITURE.produitExiste, 'tasks.json non produit sous ' + produit);
    const occurrencesProd = (REECRITURE.contenuProduit.match(/\/mnt\/c\/ProgramData\/SZH\/toolkit/g) || []).length;
    assert.strictEqual(occurrencesProd, 0, 'le tasks.json produit porte encore le chemin de production toolkit');
    const motifDepot = new RegExp(echapperRegex(MAKEFILE_DEPOT_WSL), 'g');
    const occurrencesDepot = (REECRITURE.contenuProduit.match(motifDepot) || []).length;
    assert.strictEqual(occurrencesDepot, NB_MAKEFILE_SOURCE,
      'nombre d\'occurrences du Makefile du depot inattendu, attendu ' + NB_MAKEFILE_SOURCE +
      ', obtenu ' + occurrencesDepot);
  });

test('chaque commande bash -c porte SZH_CONFIG en tete vers le config.json du dossier jetable',
  { skip: sansPowerShell }, () => {
    assertScriptExiste();
    assert.ok(REECRITURE.produitExiste, 'tasks.json non produit');
    const configWsl = versWsl(path.join(REECRITURE.baseDev, 'config.json'));
    const commandes = [...REECRITURE.contenuProduit.matchAll(/"bash",\s*"-c",\s*"([^"]*)"/g)].map((m) => m[1]);
    assert.ok(commandes.length > 0, 'aucune commande bash -c trouvee dans le tasks.json produit');
    const motifTete = new RegExp('^SZH_CONFIG=' + echapperRegex(configWsl) + '(\\s|$)');
    for (const cmd of commandes) {
      assert.ok(motifTete.test(cmd), 'commande sans SZH_CONFIG en tete - ' + cmd.slice(0, 90));
    }
  });

test('vscodium-user/tasks.json du depot n\'a pas bouge, meme empreinte avant et apres',
  { skip: sansPowerShell }, () => {
    assertScriptExiste();
    assert.ok(REECRITURE.r, 'aucun resultat');
    assert.ok(REECRITURE.empreinteAvant.equals(REECRITURE.empreinteApres),
      'vscodium-user/tasks.json du depot a change pendant l\'execution du script dev');
  });

// ---- Groupe 3 : le refus si toolkit est déjà un vrai dossier ----

const REFUS = (function () {
  if (!POWERSHELL) { return null; }
  const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-refus-'));
  const baseDev = path.join(jetable, 'SZH-dev');
  const toolkitReel = path.join(baseDev, 'toolkit');
  fs.mkdirSync(toolkitReel, { recursive: true });
  const temoin = path.join(toolkitReel, 'temoin.txt');
  fs.writeFileSync(temoin, 'ne doit pas disparaitre', 'utf8');
  const r = executerReel(baseDev);
  const dossierReste = fs.existsSync(toolkitReel);
  let contenuTemoin = null;
  try { contenuTemoin = fs.readFileSync(temoin, 'utf8'); } catch (e) { /* absent */ }
  fs.rmSync(jetable, { recursive: true, force: true });
  return { r, dossierReste, contenuTemoin, toolkitReel };
})();

test('toolkit deja present comme un vrai dossier - refus bruyant, le contenu survit',
  { skip: sansPowerShell }, () => {
    assertScriptExiste();
    assert.ok(REFUS.r, 'aucun resultat');
    assert.notStrictEqual(REFUS.r.status, 0, 'le script aurait du refuser (code non nul) au lieu de continuer');
    const message = REFUS.r.stderr + REFUS.r.stdout;
    assert.ok(message.indexOf(REFUS.toolkitReel) !== -1,
      'le message de refus ne nomme pas le chemin ' + REFUS.toolkitReel + ' - ' + message.slice(0, 300));
    assert.strictEqual(REFUS.dossierReste, true, 'le vrai dossier toolkit a disparu, la garde n\'a pas tenu');
    assert.strictEqual(REFUS.contenuTemoin, 'ne doit pas disparaitre', 'le fichier temoin n\'a pas survecu');
  });

// ---- Groupe 4 : l'isolement mesuré sur le disque du poste ----

const PROD_CONFIG = 'C:\\ProgramData\\SZH\\config.json';
const PROD_TASKS = path.join(process.env.APPDATA || 'C:\\Users\\Default\\AppData\\Roaming',
  'VSCodium', 'User', 'tasks.json');
// Le menu Démarrer du poste. Ce .lnk peut exister (un poste de dev l'a en principe), mais un
// lancement dirigé vers un menu jetable ne le crée ni ne le modifie.
const PROD_MENU_LNK_DEV = path.join(process.env.APPDATA || 'C:\\Users\\Default\\AppData\\Roaming',
  'Microsoft', 'Windows', 'Start Menu', 'Programs', NOM_RACCOURCI_DEV + '.lnk');

function motifSautGroupe4() {
  if (sansPowerShell) { return sansPowerShell; }
  if (!fs.existsSync(PROD_CONFIG) || !fs.existsSync(PROD_TASKS)) { return 'installation de production absente'; }
  return false;
}
const SAUT_GROUPE4 = motifSautGroupe4();

test('isolement mesure sur le disque - la production n\'est jamais touchee', { skip: SAUT_GROUPE4 }, () => {
  assertScriptExiste();
  const avantConfig = fs.statSync(PROD_CONFIG).mtimeMs;
  const avantTasks = fs.statSync(PROD_TASKS).mtimeMs;
  const avantMenuExiste = fs.existsSync(PROD_MENU_LNK_DEV);
  const avantMenuMtime = avantMenuExiste ? fs.statSync(PROD_MENU_LNK_DEV).mtimeMs : null;
  const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-isolement-'));
  const baseDev = path.join(jetable, 'SZH-dev');
  executerReel(baseDev);
  const apresConfig = fs.statSync(PROD_CONFIG).mtimeMs;
  const apresTasks = fs.statSync(PROD_TASKS).mtimeMs;
  const apresMenuExiste = fs.existsSync(PROD_MENU_LNK_DEV);
  const apresMenuMtime = apresMenuExiste ? fs.statSync(PROD_MENU_LNK_DEV).mtimeMs : null;
  fs.rmSync(jetable, { recursive: true, force: true });
  assert.strictEqual(apresConfig, avantConfig, 'C:\\ProgramData\\SZH\\config.json a change de date de modification');
  assert.strictEqual(apresTasks, avantTasks, '%APPDATA%\\VSCodium\\User\\tasks.json a change de date de modification');
  assert.strictEqual(apresMenuExiste, avantMenuExiste,
    PROD_MENU_LNK_DEV + ' a change d\'existence - un lancement dirige vers un menu jetable ne doit jamais le creer ni le supprimer');
  if (avantMenuExiste) {
    assert.strictEqual(apresMenuMtime, avantMenuMtime,
      PROD_MENU_LNK_DEV + ' a change de date de modification (' + avantMenuMtime + ' -> ' + apresMenuMtime + ')');
  }
});

// ---- Groupe 5 : SZH_CODIUM_PROFIL, de pronto-dev.ps1 à l'éditeur ----
// Sans cette variable, Start-SzhCodium (windows/szh-shell.ps1) ouvrirait le profil de
// production au lieu de <baseDev>\codium.

const SHELL_PS1 = path.join(RACINE, 'windows', 'szh-shell.ps1');
const COMMON_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');

function moisCourant() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Write-SzhLog (szh-common.ps1) écrit dans $SzhLogs\szh-<année-mois>.log, et $SzhLogs suit
// $env:SZH_BASE.
function lireJournal(base) {
  const fichier = path.join(base, 'logs', 'szh-' + moisCourant() + '.log');
  if (!fs.existsSync(fichier)) { return ''; }
  return fs.readFileSync(fichier, 'utf8');
}

// Une option suivie de sa valeur, avec ou sans guillemets.
function contientOption(journal, option, valeur) {
  const motif = new RegExp(echapperRegex(option) + '\\s+"?' + echapperRegex(valeur) + '"?');
  return motif.test(journal);
}

// process.env sans les trois variables sensibles (dont SZH_CODIUM_PROFIL du poste), puis
// les surcharges demandées.
function envIsole(surcharges) {
  const env = Object.assign({}, process.env);
  delete env.SZH_CODIUM_PROFIL;
  delete env.SZH_LANCEUR_SIMULE;
  delete env.SZH_BASE;
  return Object.assign(env, surcharges || {});
}

// Charge szh-common.ps1 puis szh-shell.ps1 dans un processus enfant et appelle
// Start-SzhCodium, par un script jetable plutôt qu'un -Command à échapper.
function executerStartSzhCodium(env, dossierCible) {
  if (!POWERSHELL) { return null; }
  const script = path.join(os.tmpdir(), 'szh-start-codium-' + process.pid + '-' + Date.now() + '.ps1');
  const lignes = [
    '$ErrorActionPreference = "Stop"',
    '. "' + COMMON_PS1 + '"',
    '. "' + SHELL_PS1 + '"',
    '[void](Start-SzhCodium -Dossier "' + dossierCible + '")',
  ];
  fs.writeFileSync(script, lignes.join('\r\n'), 'utf8');
  let run;
  try {
    run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8', windowsHide: true, timeout: 30000, env });
  } finally {
    fs.rmSync(script, { force: true });
  }
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '' };
}

test('le plan porte le profil - variables contient SZH_CODIUM_PROFIL sur <baseDev>\\codium',
  { skip: sansPowerShell }, () => {
    assertScriptExiste();
    const s = SIMULATION.sortie;
    assert.ok(s.variables && Object.prototype.hasOwnProperty.call(s.variables, 'SZH_CODIUM_PROFIL'),
      'variables ne porte pas SZH_CODIUM_PROFIL');
    const attendu = path.join(path.resolve(s.baseDev), 'codium');
    assert.strictEqual(path.resolve(s.variables.SZH_CODIUM_PROFIL), attendu,
      'SZH_CODIUM_PROFIL ne vaut pas <baseDev>\\codium - ' + s.variables.SZH_CODIUM_PROFIL);
  });

// Sans VSCodium, Start-SzhCodium (szh-shell.ps1) s'arrête avant de composer sa ligne de
// commande (« codium : introuvable »). Les deux tests suivants lisent cette ligne dans le
// journal : l'un échouerait, l'autre, qui vérifie une absence, passerait sans rien prouver.
// Ils sont donc sautés, avec le motif « VSCodium introuvable » admis sur le runner
// windows-latest (test/js/verifier-tap.js, famille vscodium). Mêmes chemins que
// Get-VSCodiumExe.
const sansVSCodiumExe = (function () {
  if (process.platform !== 'win32') { return 'pas Windows'; }
  const candidats = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VSCodium', 'VSCodium.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium', 'VSCodium.exe')
  ];
  for (const c of candidats) { if (fs.existsSync(c)) { return false; } }
  return 'VSCodium introuvable sur ce poste';
})();

test('avec SZH_CODIUM_PROFIL, Start-SzhCodium passe --user-data-dir et --extensions-dir',
  { skip: sansPowerShell || sansVSCodiumExe }, () => {
    const baseJetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-profil-base-'));
    const profilJetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-profil-'));
    const env = envIsole({ SZH_BASE: baseJetable, SZH_LANCEUR_SIMULE: '1', SZH_CODIUM_PROFIL: profilJetable });
    const r = executerStartSzhCodium(env, baseJetable);
    const journal = lireJournal(baseJetable);
    fs.rmSync(baseJetable, { recursive: true, force: true });
    fs.rmSync(profilJetable, { recursive: true, force: true });
    assert.ok(r && r.status === 0, 'Start-SzhCodium a echoue - ' + (r ? r.stderr : ''));
    assert.ok(contientOption(journal, '--user-data-dir', path.join(profilJetable, 'data')),
      'la trace ne porte pas --user-data-dir ' + path.join(profilJetable, 'data') + ' - ' + journal);
    assert.ok(contientOption(journal, '--extensions-dir', path.join(profilJetable, 'extensions')),
      'la trace ne porte pas --extensions-dir ' + path.join(profilJetable, 'extensions') + ' - ' + journal);
  });

test('sans SZH_CODIUM_PROFIL, la ligne de commande ne change pas',
  { skip: sansPowerShell || sansVSCodiumExe }, () => {
    const baseJetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-sansprofil-base-'));
    const env = envIsole({ SZH_BASE: baseJetable, SZH_LANCEUR_SIMULE: '1' });
    const r = executerStartSzhCodium(env, baseJetable);
    const journal = lireJournal(baseJetable);
    fs.rmSync(baseJetable, { recursive: true, force: true });
    assert.ok(r && r.status === 0, 'Start-SzhCodium a echoue - ' + (r ? r.stderr : ''));
    assert.ok(journal.indexOf('--user-data-dir') === -1,
      'la trace porte --user-data-dir sans profil pose - ' + journal);
    assert.ok(journal.indexOf('--extensions-dir') === -1,
      'la trace porte --extensions-dir sans profil pose - ' + journal);
  });

// ---- Les extensions du dépôt, vues depuis le profil dev après un lancement réel ----

function trouverCodiumCli() {
  const candidats = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VSCodium', 'bin', 'codium.cmd'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium', 'bin', 'codium.cmd'),
  ];
  for (const c of candidats) { if (c && fs.existsSync(c)) { return c; } }
  return null;
}
const CODIUM_CLI = trouverCodiumCli();
function motifSautCodium() {
  if (sansPowerShell) { return sansPowerShell; }
  return CODIUM_CLI ? false : 'VSCodium introuvable';
}
const SAUT_CODIUM = motifSautCodium();

// Un seul lancement pour les deux tests suivants. Le dossier jetable est effacé à la fin de
// cette IIFE : codium --list-extensions doit donc être lancé ici.
const EXTENSIONS_REEL = (function () {
  if (!POWERSHELL) { return null; }
  const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-extensions-'));
  const baseDev = path.join(jetable, 'SZH-dev');
  const r = executerReel(baseDev);
  const cockpit = path.join(baseDev, 'codium', 'extensions', 'szh-cockpit');
  const apercu = path.join(baseDev, 'codium', 'extensions', 'szh-apercu');
  let cibleCockpit = null;
  let cibleApercu = null;
  try { cibleCockpit = fs.readlinkSync(cockpit); } catch (e) { /* absente */ }
  try { cibleApercu = fs.readlinkSync(apercu); } catch (e) { /* absente */ }
  let listeExtensions = null;
  if (CODIUM_CLI && r && r.status === 0) {
    const extDir = path.join(baseDev, 'codium', 'extensions');
    const dataDir = path.join(baseDev, 'codium', 'data');
    // shell: true : codium.cmd est un script cmd, que spawnSync n'exécute pas seul sous
    // Windows. Les guillemets sont posés à la main, car Node concatène alors les arguments
    // sans les protéger.
    const liste = spawnSync(CODIUM_CLI, ['--extensions-dir', '"' + extDir + '"', '--user-data-dir', '"' + dataDir + '"',
      '--list-extensions', '--show-versions'], { encoding: 'utf8', windowsHide: true, timeout: 60000, shell: true });
    listeExtensions = { stdout: liste.stdout || '', stderr: liste.stderr || '', error: liste.error || null };
  }
  fs.rmSync(jetable, { recursive: true, force: true });
  return { r, cockpit, apercu, cibleCockpit, cibleApercu, listeExtensions };
})();

test('les jonctions <baseDev>\\codium\\extensions existent et visent le depot, apres un lancement reel',
  { skip: sansPowerShell }, () => {
    assertScriptExiste();
    assert.ok(EXTENSIONS_REEL.r && EXTENSIONS_REEL.r.status === 0,
      'pronto-dev.ps1 a echoue - ' + (EXTENSIONS_REEL.r ? EXTENSIONS_REEL.r.stderr : ''));
    assert.ok(EXTENSIONS_REEL.cibleCockpit, 'aucune jonction ' + EXTENSIONS_REEL.cockpit);
    assert.strictEqual(path.resolve(EXTENSIONS_REEL.cibleCockpit),
      path.join(RACINE, 'vscodium-extension', 'szh-cockpit'),
      'la jonction szh-cockpit ne vise pas vscodium-extension\\szh-cockpit - ' + EXTENSIONS_REEL.cibleCockpit);
    assert.ok(EXTENSIONS_REEL.cibleApercu, 'aucune jonction ' + EXTENSIONS_REEL.apercu);
    assert.strictEqual(path.resolve(EXTENSIONS_REEL.cibleApercu),
      path.join(RACINE, 'vscodium-extension', 'szh-apercu'),
      'la jonction szh-apercu ne vise pas vscodium-extension\\szh-apercu - ' + EXTENSIONS_REEL.cibleApercu);
  });

test('codium --list-extensions, depuis le profil dev, voit bien szh-cockpit et szh-apercu du depot',
  { skip: SAUT_CODIUM }, () => {
    assert.ok(EXTENSIONS_REEL.r && EXTENSIONS_REEL.r.status === 0,
      'pronto-dev.ps1 a echoue - ' + (EXTENSIONS_REEL.r ? EXTENSIONS_REEL.r.stderr : ''));
    assert.ok(EXTENSIONS_REEL.listeExtensions, 'codium --list-extensions n\'a pas ete lance');
    assert.ok(!EXTENSIONS_REEL.listeExtensions.error,
      'codium introuvable au lancement - ' + (EXTENSIONS_REEL.listeExtensions.error
        ? EXTENSIONS_REEL.listeExtensions.error.message : ''));
    const sortie = EXTENSIONS_REEL.listeExtensions.stdout;
    assert.match(sortie, /szh-csps\.szh-cockpit@/i,
      'szh-cockpit absent de la liste - ' + sortie + EXTENSIONS_REEL.listeExtensions.stderr);
    assert.match(sortie, /szh-csps\.szh-apercu@/i,
      'szh-apercu absent de la liste - ' + sortie + EXTENSIONS_REEL.listeExtensions.stderr);
  });

// ---- Groupe 6 : le raccourci « Pronto (dev) » au menu Démarrer ----
// -Menu vise un dossier jetable pour chaque lancement de ce groupe.

function executerReelAvecMenu(baseDev, menu) {
  if (!POWERSHELL) { return null; }
  const env = Object.assign({}, process.env, { SZH_LANCEUR_SIMULE: '1' }, posteDemarrage(path.dirname(baseDev)));
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-BaseDev', baseDev, '-Menu', menu], { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '' };
}

function lireProprietesLnk(lnk, dossierTravail) {
  if (!POWERSHELL) { return null; }
  if (!fs.existsSync(lnk)) { return null; }
  const pilote = path.join(dossierTravail, 'lire-lnk.ps1');
  const sortie = path.join(dossierTravail, 'lnk.json');
  fs.writeFileSync(pilote, [
    "$ErrorActionPreference = 'Stop'",
    '. "' + path.join(RACINE, 'windows', 'szh-common.ps1') + '"',
    '$sh = New-Object -ComObject WScript.Shell',
    '$l = $sh.CreateShortcut("' + lnk + '")',
    '$r = [ordered]@{ cible = $l.TargetPath; args = $l.Arguments; icone = $l.IconLocation; desc = $l.Description }',
    'Set-SzhJson "' + sortie + '" $r'
  ].join('\r\n') + '\r\n', 'utf8');
  spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  return fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
}

// Deux lancements sur la même base et le même menu jetables, partagés par les trois
// contrôles qui suivent.
const RACCOURCI_DEV = (function () {
  if (!POWERSHELL) { return null; }
  const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-raccourci-'));
  const baseDev = path.join(jetable, 'SZH-dev');
  const menu = path.join(jetable, 'Menu');
  const lnk = path.join(menu, NOM_RACCOURCI_DEV + '.lnk');

  const premier = executerReelAvecMenu(baseDev, menu);
  const existeApres1 = fs.existsSync(lnk);
  const mtime1 = existeApres1 ? fs.statSync(lnk).mtimeMs : null;
  const proprietes = lireProprietesLnk(lnk, jetable);

  // Deuxième lancement, même base et même menu : rien n'est réécrit.
  const second = executerReelAvecMenu(baseDev, menu);
  const mtime2 = fs.existsSync(lnk) ? fs.statSync(lnk).mtimeMs : null;

  fs.rmSync(jetable, { recursive: true, force: true });
  return { premier, second, existeApres1, mtime1, mtime2, proprietes, lnk };
})();

test('un lancement reel pose Pronto (dev).lnk sous un dossier de menu Demarrer jetable',
  { skip: sansPowerShell }, () => {
    assert.ok(RACCOURCI_DEV.premier && RACCOURCI_DEV.premier.status === 0,
      'pronto-dev.ps1 a echoue - ' + (RACCOURCI_DEV.premier ? RACCOURCI_DEV.premier.stderr : ''));
    assert.strictEqual(RACCOURCI_DEV.existeApres1, true,
      'le .lnk n\'a pas ete pose - ' + RACCOURCI_DEV.lnk);
  });

test('le .lnk vise wscript.exe, porte pronto-dev.ps1 dans ses arguments et pronto.ico du depot comme icone',
  { skip: sansPowerShell }, () => {
    assert.ok(RACCOURCI_DEV.proprietes, 'proprietes du .lnk non lues');
    assert.match(RACCOURCI_DEV.proprietes.cible, /wscript\.exe$/i,
      'cible inattendue - ' + RACCOURCI_DEV.proprietes.cible);
    assert.ok(RACCOURCI_DEV.proprietes.args.toLowerCase().indexOf('pronto-dev.ps1') !== -1,
      'les arguments ne portent pas pronto-dev.ps1 - ' + RACCOURCI_DEV.proprietes.args);
    assert.ok(RACCOURCI_DEV.proprietes.args.toLowerCase().indexOf('hidden.vbs') !== -1,
      'les arguments ne passent plus par hidden.vbs - ' + RACCOURCI_DEV.proprietes.args);
    const icone = path.resolve(RACCOURCI_DEV.proprietes.icone.split(',')[0]);
    assert.strictEqual(icone.toLowerCase(), path.join(RACINE, 'windows', 'pronto.ico').toLowerCase(),
      'icone inattendue - ' + RACCOURCI_DEV.proprietes.icone);
  });

test('un second lancement ne recree pas le .lnk (meme date d\'ecriture)', { skip: sansPowerShell }, () => {
  assert.ok(RACCOURCI_DEV.second && RACCOURCI_DEV.second.status === 0,
    'le second lancement a echoue - ' + (RACCOURCI_DEV.second ? RACCOURCI_DEV.second.stderr : ''));
  assert.ok(RACCOURCI_DEV.mtime1 !== null && RACCOURCI_DEV.mtime2 !== null,
    'date d\'ecriture introuvable avant ou apres');
  assert.strictEqual(RACCOURCI_DEV.mtime2, RACCOURCI_DEV.mtime1,
    'le .lnk a ete reecrit alors qu\'il visait deja le bon script');
});

// ---- Groupe 7 : la désinstallation retire ce raccourci, que la production ne pose pas ----

function executerFonctionShell(lignesCorps) {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-shell-'));
  const sortie = path.join(travail, 'r.json');
  const pilote = path.join(travail, 'p.ps1');
  fs.writeFileSync(pilote, [
    "$ErrorActionPreference = 'Stop'",
    '. "' + path.join(RACINE, 'windows', 'szh-common.ps1') + '"',
    '. "' + path.join(RACINE, 'windows', 'szh-shell.ps1') + '"'
  ].concat(lignesCorps).concat([
    'Set-SzhJson "' + sortie + '" $r'
  ]).join('\r\n') + '\r\n', 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  fs.rmSync(travail, { recursive: true, force: true });
  return { status: run.status, stderr: run.stderr || '', r: lu };
}

test('Get-SzhRaccourcisObsoletes nomme bien Pronto (dev)', { skip: sansPowerShell }, () => {
  const res = executerFonctionShell(['$r = @(Get-SzhRaccourcisObsoletes)']);
  assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
  assert.ok(res.r.indexOf(NOM_RACCOURCI_DEV) !== -1,
    'Get-SzhRaccourcisObsoletes ne nomme pas ' + NOM_RACCOURCI_DEV + ' - ' + JSON.stringify(res.r));
});

// Une mise à jour de production ne pose pas ce raccourci : Get-SzhRaccourcisMenu rend
// exactement les deux entrées de la production, sans Pronto (dev).
test('Get-SzhRaccourcisMenu rend exactement deux entrees, et aucune ne nomme Pronto (dev)',
  { skip: sansPowerShell }, () => {
    const res = executerFonctionShell(['$r = @(Get-SzhRaccourcisMenu) | ForEach-Object { $_.nom }']);
    assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
    assert.strictEqual(res.r.length, 2,
      'Get-SzhRaccourcisMenu ne rend plus exactement deux entrees - ' + JSON.stringify(res.r));
    assert.ok(res.r.indexOf(NOM_RACCOURCI_DEV) === -1,
      'Get-SzhRaccourcisMenu porte ' + NOM_RACCOURCI_DEV +
      ' : une redactrice le recevrait a la prochaine mise a jour');
  });

// ---- Groupe 8 : l'entrée de dev ouvre VSCodium sur le lanceur du cockpit ----
// Sans argument, pronto-dev.ps1 appelle Start-SzhAccueil (szh-shell.ps1) : les tâches de
// démarrage, puis VSCodium sans dossier. En simulation, la fonction écrit son plan en JSON ;
// le plan du lanceur WinForms se reconnaît à son champ produit.

function executerEntree(args) {
  if (!POWERSHELL) { return null; }
  const jetable = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-dev-entree-'));
  const baseDev = path.join(jetable, 'SZH-dev');
  const menuJetable = path.join(jetable, 'menu');
  // Ancrage, rapports, racines et LOCALAPPDATA jetables : sinon le check-in du démarrage
  // écrirait dans le dossier partagé du poste.
  const d = (n) => { const p = path.join(jetable, n); fs.mkdirSync(p, { recursive: true }); return p; };
  const env = Object.assign({}, process.env, { SZH_LANCEUR_SIMULE: '1',
    SZH_ANCRAGE: d(path.join('sp', 'Daten_Allgemein - General')), SZH_RAPPORTS: d('rapports'),
    SZH_RACINE_PROD: d('prod'), SZH_RACINE_TEST: d('test'), LOCALAPPDATA: d('local') });
  delete env.SZH_ACCUEIL;
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
    '-BaseDev', baseDev, '-Menu', menuJetable].concat(args || []), { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  const fichierJournal = path.join(baseDev, 'logs', 'szh-' + moisCourant() + '.log');
  const journal = fs.existsSync(fichierJournal) ? fs.readFileSync(fichierJournal, 'utf8') : '';
  fs.rmSync(jetable, { recursive: true, force: true });
  let sortie = null;
  if (run.stdout) { try { sortie = JSON.parse(run.stdout.trim()); } catch (e) { /* rapporte par le test */ } }
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', sortie, baseDev, journal };
}

const ENTREE_SANS_ARGUMENT = executerEntree([]);
const ENTREE_PRODUIT = executerEntree(['-Produit', 'zeitschrift']);

test('sans argument - Start-SzhAccueil sur le profil dev, en -n, sans dossier ni SZH_ACCUEIL',
  { skip: sansPowerShell }, () => {
    const r = ENTREE_SANS_ARGUMENT;
    assert.ok(r && r.status === 0, 'pronto-dev.ps1 a echoue - ' + (r ? r.stderr + r.stdout.slice(0, 300) : ''));
    assert.ok(r.sortie, 'sortie JSON illisible - ' + r.stdout.slice(0, 300));
    assert.ok(!Object.prototype.hasOwnProperty.call(r.sortie, 'produit'),
      'le lanceur WinForms a repondu alors qu\'aucun argument n\'etait passe');
    // La fonction de production, sans variable pour ouvrir l'Accueil : la fenêtre vide
    // suffit au cockpit.
    assert.strictEqual(r.sortie.entree, 'accueil');
    assert.ok(!Object.prototype.hasOwnProperty.call(r.sortie, 'environnement'), 'une variable est encore passee a VSCodium');
    const args = r.sortie.arguments;
    assert.ok(Array.isArray(args) && args.indexOf('-n') !== -1, 'pas de -n - ' + JSON.stringify(args));
    const ligne = args.join(' ');
    assert.ok(contientOption(ligne, '--user-data-dir', path.join(r.baseDev, 'codium', 'data')),
      'pas de --user-data-dir du profil dev - ' + ligne);
    assert.ok(contientOption(ligne, '--extensions-dir', path.join(r.baseDev, 'codium', 'extensions')),
      'pas de --extensions-dir du profil dev - ' + ligne);
    assert.strictEqual(args.length, 3, 'un argument de trop, un dossier serait ouvert - ' + ligne);
  });

test('sans argument - les taches de demarrage de l\'Accueil et les secrets sont appeles',
  { skip: sansPowerShell }, () => {
    const r = ENTREE_SANS_ARGUMENT;
    assert.ok(r && r.sortie, 'sortie JSON illisible');
    assert.deepStrictEqual(r.sortie.taches, ['Initialize-SzhAncrage', 'Clear-SzhRapportsEnAttente',
      'Invoke-SzhCheckin', 'Invoke-SzhEpinglageHorsLigne', 'Initialize-SzhEmplacementsTest',
      'Set-SzhEnvironnementSecrets']);
  });

// open-revue.ps1 note l'argument au journal, puis ouvre l'Accueil, qui suit le réglage du
// compte.
test('un argument (-Produit zeitschrift) passe toujours a open-revue.ps1', { skip: sansPowerShell }, () => {
  const r = ENTREE_PRODUIT;
  assert.ok(r && r.status === 0, 'pronto-dev.ps1 -Produit a echoue - ' + (r ? r.stderr : ''));
  assert.ok(r.sortie, 'sortie JSON illisible - ' + r.stdout.slice(0, 300));
  assert.ok(r.journal.indexOf('open-revue : -Produit zeitschrift ignore') !== -1,
    'open-revue.ps1 n\'a pas recu -Produit - ' + r.journal.slice(-400));
  assert.strictEqual(r.sortie.entree, 'accueil');
});
