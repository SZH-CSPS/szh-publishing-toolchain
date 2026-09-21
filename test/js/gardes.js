// Une seule détection par outil externe, faite une fois par processus, partagée par tous
// les fichiers de test qui en ont besoin — au lieu de la recopier (14 fois pour PowerShell
// avant ce module, avec le risque qu'une copie diverge des autres sans que rien ne le dise).
//
// Chaque « sansX » vaut `false` si l'outil est là, sinon une chaîne (le motif du skip),
// utilisable telle quelle en `{ skip: sansX }`. Par défaut un outil absent fait sauter le
// test — mais un poste de release ne doit pas pouvoir « réussir » simplement parce que la
// moitié des contrôles s'est tue : poser la variable d'environnement correspondante
// (SZH_PS_OBLIGATOIRE, SZH_PYTHON_OBLIGATOIRE, SZH_WSL_OBLIGATOIRE, SZH_PANDOC_OBLIGATOIRE,
// SZH_VALE_OBLIGATOIRE) fait ÉCHOUER le chargement de ce module au lieu de sauter, dès
// qu'un outil qu'elle couvre manque. C'est délibérément un échec au chargement (avant le
// premier `test()`) : la forme la plus simple qui rende quelque chose de rouge, sans
// machinerie par test.
//
// Les assistants `sauter.*` (en bas de fichier) sont la seconde moitié du même principe :
// composer soi-même le texte d'un `t.skip(...)` est ce qui a fait refuser trois fois le tag
// de la 1.2.0 — un motif à un mot près de celui que test/js/verifier-tap.js admet est un
// motif refusé. Les fragments qu'ils écrivent viennent de test/js/motifs-saut.js, la même
// table que verifier-tap.js relit : un seul endroit décide de la formule.
//
// SZH_SIMULER_RUNNER=ubuntu|windows truque les détections ci-dessous pour qu'elles rendent
// exactement ce que CE runner-là voit réellement (voir OUTILS_SIMULES), et refuse tout appel
// réel à un outil que ce runner n'a pas (voir l'interposition child_process, en bas) — pour
// que « node test/js/porte-release.js --runner ubuntu » sur ce poste (qui a tout) ne mente
// pas par excès d'outillage.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MOTIFS } = require('./motifs-saut'); // pas utilisé directement ici, mais garde le
// couplage explicite : un fragment ajouté à une famille sans exister nulle part dans ce
// fichier serait un fragment que rien n'écrit jamais.
void MOTIFS;

// ---- PowerShell (Windows uniquement) --------------------------------------------------
// Même détection que les 16 fichiers qui la recopiaient : le powershell.exe du système
// d'abord (jamais celui, éventuel, du PATH d'un profil qui l'aurait masqué), sinon celui du
// PATH.
function detecterPowerShell() {
  if (process.platform !== 'win32') { return ''; }
  const candidats = [path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe'];
  for (const c of candidats) {
    const essai = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) { return c; }
  }
  return '';
}

// ---- Python (Windows et ailleurs) ------------------------------------------------------
// `python3` en premier peut tomber sur l'alias d'exécution de WindowsApps quand aucun
// Python n'est installé : ce lanceur peut rester accroché (tentative d'ouverture du Store)
// au lieu de rendre la main, ce qui gèlerait toute la suite derrière lui. `python` n'est pas
// concerné sur les postes de la maison, on l'essaie donc en premier ; `python3` n'est tenté
// qu'en repli, et jamais nu — borné par un délai, pour qu'un blocage devienne un simple
// « absent » plutôt qu'un processus de test qui ne rend jamais la main.
function detecterPython() {
  for (const commande of ['python', 'python3']) {
    let r;
    try {
      r = spawnSync(commande, ['--version'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true });
    } catch (e) {
      continue;
    }
    if (r.error || r.signal) { continue; } // r.signal : tué par le délai (le stub qui traîne)
    if (/Python 3/.test(String(r.stdout || '') + String(r.stderr || ''))) { return commande; }
  }
  return '';
}

// ---- pandoc + python3 dans la distro WSL SZH-Publishing --------------------------------
// Reprend telle quelle la détection de test/js/biblio.test.js (pandocAbsent) : ce n'est pas
// le python3 de Windows (ci-dessus) qui est en jeu ici, mais celui, réel, de la distro
// Linux — sans son risque de blocage.
const DISTRO = 'SZH-Publishing';
function detecterPandocWsl() {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const exe = fs.existsSync(wslExe) ? wslExe : 'wsl.exe';
  let r;
  try {
    r = spawnSync(exe, ['-d', DISTRO, '--', 'sh', '-c', 'command -v pandoc && command -v python3'],
      { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  } catch (e) {
    return 'wsl.exe injoignable : ' + e.message;
  }
  if (r.error) { return 'wsl.exe injoignable : ' + r.error.message; }
  if (r.status !== 0) { return 'pandoc ou python3 introuvable dans la distro ' + DISTRO; }
  return null;
}

// ---- pandoc du PATH Windows -------------------------------------------------------------
// Reprend la détection de test/js/reimport-biblio.test.js (pandocAbsent) : le pandoc lancé
// directement, jamais via wsl.exe — celui que filtres-pandoc.test.js utilise aussi.
function detecterPandoc() {
  try {
    const r = spawnSync('pandoc', ['--version'], { encoding: 'utf8' });
    return (!r.error && r.status === 0) ? null : 'pandoc introuvable sur ce poste';
  } catch (e) {
    return 'pandoc introuvable sur ce poste (' + e.message + ')';
  }
}

// ---- Vale (règles lexicales/éditoriales) : PATH d'abord, WSL en repli -----------------
// Le repli WSL n'a de sens que sur un vrai poste (un poste de dev sans sudo installe vale
// dans ~/.local/bin) : la CI qui a vale (job `contrats`, ubuntu) l'installe directement sur
// le PATH, jamais via une distro — c'est pourquoi `avecRepliWsl` se coupe sous simulation.
function detecterValeSurPath() {
  try {
    const r = spawnSync('vale', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) {
    return false;
  }
}
function detecterValeSurWsl() {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const exe = fs.existsSync(wslExe) ? wslExe : 'wsl.exe';
  try {
    const r = spawnSync(exe, ['-d', DISTRO, '--', 'bash', '-lc', 'vale --version'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) {
    return false;
  }
}
function detecterVale(avecRepliWsl) {
  if (detecterValeSurPath()) { return null; }
  if (avecRepliWsl && detecterValeSurWsl()) { return null; }
  return 'vale absent (ni sur le PATH' + (avecRepliWsl ? (', ni dans la distro ' + DISTRO + ' via wsl.exe') : '') + ')';
}

// ---- VSCodium (Windows uniquement) -----------------------------------------------------
// Mêmes deux chemins que Get-VSCodiumExe (windows/szh-shell.ps1) et que
// test/js/dev-lanceur.test.js : Program Files (install machine) ou %LOCALAPPDATA% (install
// utilisateur).
function detecterVSCodium() {
  if (process.platform !== 'win32') { return 'pas Windows'; }
  const candidats = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VSCodium', 'VSCodium.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium', 'VSCodium.exe')
  ];
  for (const c of candidats) { if (fs.existsSync(c)) { return null; } }
  return 'VSCodium introuvable sur ce poste';
}

// ---- Installation de production (C:\ProgramData\SZH) -----------------------------------
// Jamais présente sur un runner d'intégration continue (checkout frais) : pas de variable
// OBLIGATOIRE ici, un poste de développement sans installation de production est un cas
// normal, pas une panne d'outillage.
function detecterProduction() {
  const config = 'C:\\ProgramData\\SZH\\config.json';
  const taches = path.join(process.env.APPDATA || 'C:\\Users\\Default\\AppData\\Roaming',
    'VSCodium', 'User', 'tasks.json');
  if (fs.existsSync(config) && fs.existsSync(taches)) { return null; }
  return 'installation de production absente';
}

// ---- Pliage des accents (défaut de build de pandoc, pas du filtre) --------------------
// Porté depuis test/filtres-pandoc.test.js (pliageCasse()) : mémoïsé et PARESSEUX (un seul
// appel pandoc, jamais fait pour un fichier qui n'utilise pas sauter.pliage).
let _pliageMemo;
function detecterPliage() {
  if (_pliageMemo !== undefined) { return _pliageMemo; }
  const r = spawnSync('pandoc', ['lua', '-e', "print(('\\195\\137'):lower() == '\\195\\137')"],
    { encoding: 'utf8' });
  if (r.error || r.status !== 0 || r.stdout.trim() === 'true') {
    _pliageMemo = null;
  } else {
    _pliageMemo = 'pliage des accents cassé : string.lower() corrompt le premier octet UTF-8 '
      + 'd’une lettre accentuée sur ce build de pandoc (locale/page de code, pas le filtre — '
      + 'voir szh-maquette.lua, PLIAGE_ACCENTS).';
  }
  return _pliageMemo;
}

// ---- Simulation de runner ---------------------------------------------------------------
const SIMULER = process.env.SZH_SIMULER_RUNNER || '';
if (SIMULER && SIMULER !== 'ubuntu' && SIMULER !== 'windows') {
  throw new Error('SZH_SIMULER_RUNNER inconnu : "' + SIMULER + '" (ubuntu ou windows attendu)');
}
// Mesuré sur les jobs réels de .github/workflows/ci.yml : `contrats` (ubuntu-latest) et
// `contrats-windows` (windows-latest). VSCodium n'a sa propre entrée nulle part ici : aucun
// des deux runners ne l'a jamais, la détection est forcée absente plus bas sous TOUTE
// simulation, sans distinction.
const OUTILS_SIMULES = {
  ubuntu: { powershell: false, wsl: false, pandoc: true, vale: true },
  windows: { powershell: true, wsl: false, pandoc: false, vale: false }
};

let POWERSHELL;
if (SIMULER && !OUTILS_SIMULES[SIMULER].powershell) {
  POWERSHELL = '';
} else {
  POWERSHELL = detecterPowerShell();
}

// Python n'est truqué par aucun runner : présent réellement des deux côtés (ubuntu-latest le
// fournit de base, SZH_PYTHON_OBLIGATOIRE le confirme ; windows-latest aussi).
const PYTHON = detecterPython();

let _motifPandocWsl;
if (SIMULER && !OUTILS_SIMULES[SIMULER].wsl) {
  // Absent des DEUX runners réels : jamais besoin d'attendre le wsl.exe (jusqu'à 120 s) de
  // CE poste pour le savoir.
  _motifPandocWsl = 'wsl.exe absente (SZH_SIMULER_RUNNER=' + SIMULER + ')';
} else {
  _motifPandocWsl = detecterPandocWsl();
}

let _motifPandoc;
if (SIMULER && !OUTILS_SIMULES[SIMULER].pandoc) {
  _motifPandoc = 'pandoc introuvable sur ce poste (SZH_SIMULER_RUNNER=' + SIMULER + ')';
} else {
  _motifPandoc = detecterPandoc();
}

let _motifVale;
if (SIMULER && !OUTILS_SIMULES[SIMULER].vale) {
  _motifVale = 'vale absent (SZH_SIMULER_RUNNER=' + SIMULER + ')';
} else {
  // Pas de repli WSL sous simulation : le vrai ubuntu-latest n'a pas de WSL, et y installe
  // vale directement sur le PATH.
  _motifVale = detecterVale(!SIMULER);
}

// Absente des deux runners réels, sans exception : forcée sous toute simulation.
const _motifVSCodium = SIMULER
  ? 'VSCodium introuvable sur ce poste (SZH_SIMULER_RUNNER=' + SIMULER + ')'
  : detecterVSCodium();

// Ni ubuntu-latest ni windows-latest n'ont jamais d'installation de production (checkout
// frais) — mais elle N'EST PAS forcée ici : un poste de développement qui en a une doit
// pouvoir l'exercer même sous simulation, et aucun des deux runners réels ne la truque non
// plus (elle est simplement toujours absente chez eux). Limite connue : sur UN poste qui a
// une installation de production, `--runner ubuntu`/`--runner windows` verront quand même
// cette installation — documenté dans le rapport de livraison, pas corrigé ici.
const _motifProduction = detecterProduction();

// Bascule un skip en échec quand l'outil est déclaré obligatoire : sans ce contrôle, poser
// la variable sur un poste où l'outil manque encore « réussirait » silencieusement — les
// tests couverts se contenteraient de sauter, comme d'habitude.
function exiger(variable, motif) {
  if (motif && process.env[variable]) {
    throw new Error(motif + ' — ' + variable + ' est posé : cet outil est déclaré '
      + 'obligatoire, sauter le contrôle est refusé.');
  }
  return motif;
}

const sansPowerShell = exiger('SZH_PS_OBLIGATOIRE', POWERSHELL ? false : 'powershell.exe indisponible');
const sansPython = exiger('SZH_PYTHON_OBLIGATOIRE',
  PYTHON ? false : 'aucun interprète Python 3 trouvé (python, puis python3)');
const sansPandocWsl = exiger('SZH_WSL_OBLIGATOIRE', _motifPandocWsl === null ? false : _motifPandocWsl);
const sansPandoc = exiger('SZH_PANDOC_OBLIGATOIRE', _motifPandoc === null ? false : _motifPandoc);
const sansVale = exiger('SZH_VALE_OBLIGATOIRE', _motifVale === null ? false : _motifVale);
// Ni l'un ni l'autre n'a de variable OBLIGATOIRE : aucun poste de développement n'est garanti
// avoir VSCodium ou une installation de production, contrairement à PowerShell/Python/pandoc.
const sansVSCodium = _motifVSCodium === null ? false : _motifVSCodium;
const sansProduction = _motifProduction === null ? false : _motifProduction;

// ---- Assistants de saut : le motif exact, jamais recomposé à la main -------------------
// Chaque `sauter.X(t)` (sauf `corpus`, dont le chemin varie par appel, et `eleve`, dont la
// détection n'est pas centralisable — voir plus bas) refuse de sauter si l'outil est en
// fait présent : un appel à `sauter.wsl(t)` alors que sansPandocWsl est faux est un test qui
// a mal lu sa propre condition, pas un cas à couvrir silencieusement.
function _garantir(motif, nom) {
  if (!motif) {
    throw new Error('sauter.' + nom + '(t) appelé alors que l’outil est présent sur ce poste '
      + '— condition de saut mal évaluée par l’appelant.');
  }
}

const sauter = {
  // Détection faite par l'appelant (chemin variable) : cet assistant ne fait que garantir
  // le préfixe que la famille `corpus` de test/js/motifs-saut.js reconnaît.
  corpus(t, chemin) {
    return t.skip('corpus hors dépôt absent : ' + chemin);
  },
  wsl(t) {
    _garantir(sansPandocWsl, 'wsl');
    return t.skip(sansPandocWsl);
  },
  pandoc(t) {
    _garantir(sansPandoc, 'pandoc');
    return t.skip(sansPandoc);
  },
  powershell(t) {
    _garantir(sansPowerShell, 'powershell');
    return t.skip(sansPowerShell);
  },
  vale(t) {
    _garantir(sansVale, 'vale');
    return t.skip(sansVale);
  },
  vscodium(t) {
    _garantir(sansVSCodium, 'vscodium');
    return t.skip(sansVSCodium);
  },
  production(t) {
    _garantir(sansProduction, 'production');
    return t.skip(sansProduction);
  },
  // Pas de détection centralisée : la condition (un compte administrateur contourne l'ACL
  // posée pour le test) est mesurée par l'appelant — raccourcis.test.js — qui pose sa propre
  // restriction NTFS puis constate si l'écriture est vraiment bloquée. Cet assistant ne fait
  // que garantir le motif exact que la famille `eleve` reconnaît.
  eleve(t) {
    return t.skip('processus élevé : l’ACL ne bloque pas (compte administrateur)');
  },
  pliage(t) {
    const raison = detecterPliage();
    _garantir(raison, 'pliage');
    // SZH_LUA_OBLIGATOIRE : une CI qui tourne sous ubuntu-24.04 (jamais concernée par ce
    // défaut de build Windows) ne doit jamais se contenter d'un saut.
    if (process.env.SZH_LUA_OBLIGATOIRE) { throw new Error(raison); }
    return t.skip(raison);
  }
};

// ---- Interposition child_process sous simulation ----------------------------------------
// Un appel réel à un outil que le runner simulé n'a pas doit ÉCHOUER plutôt que de
// silencieusement toucher le vrai poste (qui, lui, a peut-être l'outil) : sans ça,
// `--runner ubuntu` sur CE poste dirait vert alors que le même test tomberait en panne sur
// le vrai ubuntu-latest.
//
// Patché sur l'objet module `child_process` lui-même, jamais sur une copie : pour qu'un
// test qui fait `const { spawnSync } = require('child_process')` voie la version patchée,
// ce module doit être chargé — via `--require` — AVANT que ce test ne fasse sa propre
// destructuration. C'est test/js/porte-release.js qui passe `--require` sur le chemin
// absolu de CE fichier quand il lance la suite sous un runner simulé ; charger gardes.js une
// seconde fois ensuite (`require('./gardes')`, comme tous les fichiers de test le font déjà)
// ne réexécute rien : Node met le module en cache par chemin résolu.
//
// N'intercepte que par NOM de commande (dernier segment du chemin, en minuscules) : un test
// qui redirige la production vers un faux exécutable via une variable d'environnement dédiée
// (SZH_MANUSCRIT_WSL_EXE, etc. — jamais nommé littéralement « wsl » ou « wsl.exe ») n'est
// donc jamais bloqué, par construction.
if (SIMULER) {
  const cp = require('child_process');
  const outils = OUTILS_SIMULES[SIMULER];
  const BLOQUES = new Set();
  if (!outils.wsl) { BLOQUES.add('wsl'); BLOQUES.add('wsl.exe'); }
  if (!outils.powershell) {
    BLOQUES.add('powershell'); BLOQUES.add('powershell.exe'); BLOQUES.add('pwsh'); BLOQUES.add('pwsh.exe');
  }
  if (!outils.pandoc) { BLOQUES.add('pandoc'); BLOQUES.add('pandoc.exe'); }
  if (!outils.vale) { BLOQUES.add('vale'); BLOQUES.add('vale.exe'); }

  function nomDepuisCommande(commande) {
    return typeof commande === 'string' ? path.basename(commande).toLowerCase() : '';
  }
  function nomDepuisLigne(ligne) {
    if (typeof ligne !== 'string') { return ''; }
    const premier = ligne.trim().split(/\s+/)[0] || '';
    return path.basename(premier).toLowerCase();
  }
  function refuser(nom, original) {
    if (!BLOQUES.has(nom)) { return; }
    throw new Error('appel réel à "' + original + '" refusé sous SZH_SIMULER_RUNNER=' + SIMULER
      + ' : ce runner n’a pas cet outil. Un test qui l’atteint sans passer par un point '
      + 'd’entrée de test dédié (SZH_MANUSCRIT_WSL_EXE et consorts) dépend du vrai poste, pas '
      + 'du runner simulé — corriger le test, jamais la production.');
  }
  for (const methode of ['spawnSync', 'execFileSync', 'spawn']) {
    const original = cp[methode];
    if (typeof original !== 'function') { continue; }
    cp[methode] = function (commande, ...reste) {
      refuser(nomDepuisCommande(commande), commande);
      return original.apply(this, [commande, ...reste]);
    };
  }
  for (const methode of ['execSync', 'exec']) {
    const original = cp[methode];
    if (typeof original !== 'function') { continue; }
    cp[methode] = function (ligne, ...reste) {
      refuser(nomDepuisLigne(ligne), ligne);
      return original.apply(this, [ligne, ...reste]);
    };
  }
}

module.exports = {
  POWERSHELL, sansPowerShell, PYTHON, sansPython, sansPandocWsl, sansPandoc,
  sansVale, sansVSCodium, sansProduction, exiger, sauter,
  // Fonction, pas une valeur : le pliage n'est vérifié qu'à la demande (un seul appel
  // pandoc, jamais fait pour un fichier qui ne s'en sert pas). Appeler sansPliage() rend
  // `null` si ce pandoc est sain, sinon la raison.
  sansPliage: detecterPliage,
  RUNNER_SIMULE: SIMULER
};
