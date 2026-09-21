#!/usr/bin/env node
'use strict';
// La porte locale qui rejoue, AVANT de committer un `release: X.Y.Z`, ce que ci.yml et
// release.yml vérifient APRÈS coup — pour qu'un rouge se voie ici, pas après une pose de tag
// ratée. La 1.2.0 (21.09.2026) a coûté trois poses : vert en local, rouge sur le runner. Le
// problème n'était pas la sévérité de la CI, c'est qu'elle parlait après coup et que ses
// règles ne vivaient que dans son propre code — ce fichier les rejoue depuis les mêmes
// sources (test/js/gardes.js, test/js/verifier-tap.js, .github/workflows/*.yml).
//
//   node test/js/porte-release.js [--runner ubuntu|windows|poste|tous] [--version X.Y.Z] [--rapide]
//
// Sans --runner : poste. --runner tous = poste, puis ubuntu, puis windows (le poste d'abord :
// c'est le moins coûteux à corriger). --version : requis pour le contrôle CHANGELOG/
// nouveautes (sinon sauté — utile hors contexte de release). --rapide : seulement les
// contrôles rapides (YAML, typographie, bump, CHANGELOG) plus un balayage statique des
// `t.skip(` sans assistant — jamais la suite complète ; c'est ce que le crochet pre-push
// utilise, sous 30 s.
//
// Chaque étape s'arrête au premier rouge, avec un message qui dit quoi corriger. Code de
// sortie 0 si tout est vert, 1 sinon.
//
// ⚠ Étape (e), portée volontairement différente de la ligne brute donnée par le brief :
// sous --runner ubuntu/windows (simulés), seul test/js/*.test.js tourne — exactement le
// glob des jobs réels `contrats`/`contrats-windows` de ci.yml. test/filtres-pandoc.test.js
// et test/filtres-import.test.js DEMANDENT un vrai pandoc et ne sont, en CI réelle, JAMAIS
// lancés par ces deux jobs : ils appartiennent au job `pdf-ua` (ubuntu-24.04, jamais simulé
// ici, toujours avec un vrai pandoc). Les inclure sous une simulation où pandoc est bloqué
// ferait rougir la porte pour un scénario qu'aucun job réel ne rencontre à cet endroit — un
// faux rouge n'est pas plus utile qu'un faux vert. Sous --runner poste (réel), les trois
// globs tournent ensemble, comme le fait déjà la ronde manuelle documentée dans la mémoire
// « publier-une-release » (§0 bis).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const GARDES_JS = path.join(__dirname, 'gardes.js');
const { PYTHON } = require('./gardes');
const { verifier } = require('./verifier-tap');
const { MOTIFS } = require('./motifs-saut');

// ---- utilitaires --------------------------------------------------------------------------

function cheminVersWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}
function wslExe() {
  const w = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return fs.existsSync(w) ? w : 'wsl.exe';
}
function resumerEchec(r) {
  if (!r) { return '(aucune tentative)'; }
  if (r.error) { return 'erreur : ' + r.error.message; }
  return 'code ' + r.status + (r.stderr ? ' — ' + String(r.stderr).trim().slice(0, 400) : '');
}

// ---- (a) YAML des deux workflows -----------------------------------------------------------
// PyYAML : le `python` de Windows l'a (PYTHON de gardes.js) ; en repli, python3 de la WSL
// SZH-Publishing ; si ni l'un ni l'autre, échec explicite plutôt qu'un contrôle tu.
function verifierYaml() {
  const fichiers = ['.github/workflows/ci.yml', '.github/workflows/release.yml']
    .map((f) => path.join(RACINE, f));
  const script = "import sys, yaml\nfor f in sys.argv[1:]:\n    yaml.safe_load(open(f, encoding='utf-8'))\nprint('YAML_OK')\n";

  if (PYTHON) {
    const r = spawnSync(PYTHON, ['-c', script].concat(fichiers), { encoding: 'utf8', timeout: 20000 });
    if (!r.error && r.status === 0 && /YAML_OK/.test(r.stdout || '')) {
      return { ok: true, detail: 'ci.yml et release.yml : YAML valide (Python Windows, ' + PYTHON + ')' };
    }
    if (!r.error) {
      // pandoc présent mais PyYAML absent, ou YAML réellement invalide : on tente quand
      // même la WSL avant de conclure, un module Python manquant n'est pas une erreur YAML.
      var echecWindows = resumerEchec(r);
    } else {
      var echecWindowsProcess = resumerEchec(r);
    }
  }
  const argsWsl = ['-c', script].concat(fichiers.map(cheminVersWsl));
  let r2;
  try {
    r2 = spawnSync(wslExe(), ['-d', 'SZH-Publishing', '--', 'python3'].concat(argsWsl),
      { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  } catch (e) {
    r2 = { error: e };
  }
  if (!r2.error && r2.status === 0 && /YAML_OK/.test(r2.stdout || '')) {
    return { ok: true, detail: 'ci.yml et release.yml : YAML valide (WSL SZH-Publishing, python3)' };
  }
  return {
    ok: false,
    detail: 'PyYAML introuvable ou YAML invalide.\n'
      + '  Python Windows (' + (PYTHON || 'aucun interprète trouvé') + ') : '
      + (echecWindows || echecWindowsProcess || '(non tenté)') + '\n'
      + '  WSL SZH-Publishing python3 : ' + resumerEchec(r2)
  };
}

// ---- (b) typographie des textes visibles -------------------------------------------------
function verifierTypographie() {
  const script = path.join(RACINE, 'test', 'typo-check.py');
  if (PYTHON) {
    const r = spawnSync(PYTHON, [script], { encoding: 'utf8', timeout: 60000, cwd: RACINE });
    if (!r.error && r.status === 0) {
      return { ok: true, detail: 'test/typo-check.py : conforme (Python Windows, ' + PYTHON + ')' };
    }
    if (!r.error && r.status !== 0) {
      return { ok: false, detail: 'test/typo-check.py signale des écarts :\n' + (r.stdout || '') + (r.stderr || '') };
    }
  }
  let r2;
  try {
    r2 = spawnSync(wslExe(), ['-d', 'SZH-Publishing', '--', 'python3', cheminVersWsl(script)],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, cwd: RACINE });
  } catch (e) {
    r2 = { error: e };
  }
  if (!r2.error && r2.status === 0) {
    return { ok: true, detail: 'test/typo-check.py : conforme (WSL SZH-Publishing)' };
  }
  return {
    ok: false,
    detail: 'test/typo-check.py n’a pas pu s’exécuter (ni Python Windows, ni WSL) ou signale '
      + 'des écarts :\n' + resumerEchec(r2) + (r2.stdout ? '\n' + r2.stdout : '')
  };
}

// ---- (c) bump des extensions modifiées depuis le dernier tag -----------------------------
// Même critère que l’étape « Vérifier le bump de version des extensions » de release.yml :
// comparer au tag, pas au fichier local.
function dernierTag() {
  const r = spawnSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: RACINE, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
function extensionsDuDepot() {
  const dossier = path.join(RACINE, 'vscodium-extension');
  if (!fs.existsSync(dossier)) { return []; }
  return fs.readdirSync(dossier).filter((d) =>
    fs.existsSync(path.join(dossier, d, 'package.json')));
}
function verifierBumpExtensions() {
  const tag = dernierTag();
  if (!tag) {
    return { ok: true, detail: 'pas de tag précédent — bump non vérifiable (1re release de ce format)' };
  }
  const problemes = [];
  const details = [];
  for (const ext of extensionsDuDepot()) {
    const dossierRel = 'vscodium-extension/' + ext;
    const diff = spawnSync('git', ['diff', '--quiet', tag + '..HEAD', '--', dossierRel], { cwd: RACINE });
    if (diff.status === 0) { details.push(dossierRel + ' : inchangé depuis ' + tag); continue; }
    const fichierPkg = path.join(RACINE, dossierRel, 'package.json');
    const vHead = JSON.parse(fs.readFileSync(fichierPkg, 'utf8')).version;
    const show = spawnSync('git', ['show', tag + ':' + dossierRel + '/package.json'], { cwd: RACINE, encoding: 'utf8' });
    if (show.status !== 0) { details.push(dossierRel + ' : nouveau depuis ' + tag + ' (pas de version antérieure à comparer)'); continue; }
    let vPrev;
    try { vPrev = JSON.parse(show.stdout).version; } catch (e) { vPrev = null; }
    if (vPrev !== null && vHead === vPrev) {
      problemes.push(dossierRel + ' a changé depuis ' + tag + ' mais sa version est restée ' + vHead + ' — bump requis');
      continue;
    }
    details.push(dossierRel + ' : ' + vPrev + ' -> ' + vHead);
  }
  return {
    ok: problemes.length === 0,
    detail: (problemes.length ? problemes.join('\n') + '\n' : '') + (details.join('\n') || '(aucune extension modifiée)')
  };
}

// ---- (d) CHANGELOG.md porte la version, nouveautes.json si le medium change --------------
function verifierChangelogEtNouveautes(version) {
  if (!version) {
    return { ok: true, detail: '--version non fourni : contrôle sauté (usage hors préparation de release)' };
  }
  const changelog = fs.readFileSync(path.join(RACINE, 'CHANGELOG.md'), 'utf8');
  const aLaSection = changelog.split('\n').some((l) => l.trim() === '## ' + version);
  if (!aLaSection) {
    return { ok: false, detail: 'CHANGELOG.md n’a pas de section exacte "## ' + version + '"' };
  }
  const medium = version.split('.').slice(0, 2).join('.');
  const tag = dernierTag();
  const mediumPrecedent = tag ? tag.replace(/^v/, '').split('.').slice(0, 2).join('.') : null;
  if (tag && medium === mediumPrecedent) {
    return { ok: true, detail: 'CHANGELOG.md : section ' + version + ' trouvée ; medium ' + medium
      + ' inchangé depuis ' + tag + ' -> nouveautes.json non requis' };
  }
  let nouveautes;
  try {
    nouveautes = JSON.parse(fs.readFileSync(path.join(RACINE, 'nouveautes.json'), 'utf8'));
  } catch (e) {
    return { ok: false, detail: 'nouveautes.json illisible : ' + e.message };
  }
  if (!Object.prototype.hasOwnProperty.call(nouveautes, medium)) {
    return {
      ok: false,
      detail: 'medium ' + medium + ' nouveau depuis ' + (tag || '(pas de tag)')
        + ' mais nouveautes.json n’a pas d’entrée "' + medium + '"'
    };
  }
  return {
    ok: true,
    detail: 'CHANGELOG.md : section ' + version + ' trouvée ; nouveautes.json porte l’entrée "' + medium + '"'
  };
}

// ---- (e), version --rapide : balayage statique des t.skip() sans assistant ----------------
// Un `t.skip(` qui n'appelle ni sauter.*, ni un des deux échappatoires historiques déjà
// signalés dans le rapport de livraison (documentés, hors périmètre) est un motif potentiel
// que rien ne garantit conforme à MOTIFS — la porte rapide le signale avant même de lancer
// quoi que ce soit.
const EXCEPTIONS_CONNUES = [
  // [fichier relatif, sous-chaîne du motif] — documentées dans le rapport de livraison du
  // chantier « porte de release » : deux échappatoires ad hoc, jamais atteintes en CI
  // (gardées derrière un retour anticipé sur corpus absent / fichier livré présent).
  ['test/js/manuscrit-annoter.test.js', 'manuscrit-nettoyer.py en échec'],
  ['test/js/manuscrit-docx.test.js', 'gabarit livré absent'],
];
function fichiersDeTest() {
  const dossier = path.join(RACINE, 'test', 'js');
  const rel = (n) => 'test/js/' + n;
  const liste = fs.readdirSync(dossier).filter((n) => n.endsWith('.test.js')).map(rel);
  liste.push('test/filtres-pandoc.test.js', 'test/filtres-import.test.js');
  return liste;
}
const TOUS_LES_FRAGMENTS = Object.values(MOTIFS).flat();

function verifierSautsStatiques() {
  const suspects = [];
  for (const f of fichiersDeTest()) {
    const chemin = path.join(RACINE, f);
    if (!fs.existsSync(chemin)) { continue; }
    const lignes = fs.readFileSync(chemin, 'utf8').split('\n');
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      if (/^\s*\/\//.test(l)) { continue; } // ligne de commentaire pure : rien à exécuter
      if (!/\bt\.skip\(/.test(l)) { continue; }
      if (/sauter\.\w+\(/.test(l)) { continue; } // routé par un assistant : voir gardes.js
      // Un motif écrit à la main mais qui cite déjà littéralement un fragment admis (par
      // exemple un chemin de corpus précis, ajouté après le fragment générique de
      // sauter.corpus) est admis tel quel par verifier-tap.js — pas d'assistant à forcer ici.
      if (TOUS_LES_FRAGMENTS.some((frag) => l.includes(frag))) { continue; }
      const exception = EXCEPTIONS_CONNUES.find(([ef, motif]) => ef === f && l.includes(motif));
      if (exception) { continue; }
      suspects.push(f + ':' + (i + 1) + ': ' + l.trim());
    }
  }
  return {
    ok: suspects.length === 0,
    detail: suspects.length
      ? 'des t.skip(...) ne passent ni par un assistant sauter.*, ni ne citent déjà un '
        + 'fragment admis, ni ne figurent parmi les exceptions documentées :\n' + suspects.join('\n')
      : 'aucun t.skip(...) hors assistant, hors fragment déjà admis, ni hors exception documentée'
  };
}

// ---- (e), version complète : la suite réelle, en TAP, jugée par verifier-tap.js ----------
function fichiersDeSuite(runner) {
  const dossier = path.join(RACINE, 'test', 'js');
  const base = fs.readdirSync(dossier).filter((n) => n.endsWith('.test.js'))
    .map((n) => path.join('test', 'js', n));
  if (runner === 'poste') {
    return base.concat(['test/filtres-pandoc.test.js', 'test/filtres-import.test.js']);
  }
  return base; // ubuntu/windows simulés : glob exact des jobs contrats/contrats-windows
}
function envPourRunner(runner) {
  const env = Object.assign({}, process.env);
  delete env.SZH_SIMULER_RUNNER;
  for (const v of ['SZH_PS_OBLIGATOIRE', 'SZH_PYTHON_OBLIGATOIRE', 'SZH_WSL_OBLIGATOIRE',
    'SZH_PANDOC_OBLIGATOIRE', 'SZH_VALE_OBLIGATOIRE']) { delete env[v]; }
  if (runner === 'ubuntu') {
    env.SZH_SIMULER_RUNNER = 'ubuntu';
    env.SZH_PYTHON_OBLIGATOIRE = '1'; // job `contrats`
    // PAS SZH_VALE_OBLIGATOIRE ici, à dessein, malgré ci.yml qui le pose (job `contrats`,
    // vale réellement installé sur le PATH du runner) : la simulation locale ne peut PAS
    // faire apparaître un outil qui manque vraiment sur ce poste — seulement en faire
    // disparaître un qui y est. Sur un poste où vale n'est joignable que par la WSL (jamais
    // sur le PATH Windows), le forcer ferait échouer le CHARGEMENT du module pour tout le
    // fichier (gardes.js jette avant le premier test), masquant le verdict de tout le
    // reste — bien moins utile qu'un skip ciblé, correctement signalé « non admis sur
    // ubuntu » par verifier-tap.js. Documenté dans le rapport de livraison.
  } else if (runner === 'windows') {
    env.SZH_SIMULER_RUNNER = 'windows';
    env.SZH_PS_OBLIGATOIRE = '1'; // job `contrats-windows`
  } else {
    // poste réel : mode exigeant (mémoire « publier-une-release », §0 bis) — mais PAS
    // SZH_VALE_OBLIGATOIRE : ADMIS.poste admet un saut `vale` (un poste de dev peut
    // légitimement ne pas encore l’avoir installé).
    env.SZH_WSL_OBLIGATOIRE = '1';
    env.SZH_PS_OBLIGATOIRE = '1';
    env.SZH_PANDOC_OBLIGATOIRE = '1';
    env.SZH_PYTHON_OBLIGATOIRE = '1';
  }
  return env;
}
function verifierSuite(runner) {
  const fichiers = fichiersDeSuite(runner);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-porte-'));
  const tap = path.join(scratch, 'porte-' + runner + '.tap');
  const args = [];
  if (runner !== 'poste') {
    // Patche child_process AVANT que le premier fichier de test ne fasse sa propre
    // destructuration de spawnSync/exec — voir gardes.js, section « interposition ».
    args.push('--require', GARDES_JS);
  }
  args.push('--test', '--test-timeout=180000', '--test-reporter=tap',
    '--test-reporter-destination=' + tap);
  args.push(...fichiers);
  const env = envPourRunner(runner);
  let r;
  try {
    r = spawnSync(process.execPath, args, { cwd: RACINE, env, encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024, timeout: 330000 });
  } catch (e) {
    r = { error: e };
  }
  let texteTap = '';
  try { texteTap = fs.readFileSync(tap, 'utf8'); } catch (e) { /* rien à lire */ }
  fs.rmSync(scratch, { recursive: true, force: true });
  if (!texteTap) {
    return {
      ok: false,
      detail: 'aucun rapport TAP produit — la suite n’est pas allée à son terme.\n'
        + resumerEchec(r) + (r.stdout ? '\n' + String(r.stdout).slice(-2000) : '')
    };
  }
  const verdict = verifier(texteTap, runner === 'poste' ? 'poste' : runner);
  const processusVert = !r.error && r.status === 0;
  const ok = verdict.erreurs.length === 0 && processusVert;
  const lignes = [
    'tests=' + verdict.tests + ' fail=' + verdict.fail + ' cancelled=' + verdict.cancelled
      + ' skipped=' + verdict.skipped,
    'motifs des sauts : ' + JSON.stringify(verdict.histogramme)
  ];
  if (!processusVert) { lignes.push('code de sortie de node --test : ' + (r.status === null ? '(tué / ' + resumerEchec(r) + ')' : r.status)); }
  for (const e of verdict.erreurs) { lignes.push('  - ' + e); }
  return { ok, detail: lignes.join('\n') };
}

// ---- orchestration --------------------------------------------------------------------------

function analyserArgs(argv) {
  const a = { runner: 'poste', version: null, rapide: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runner') { a.runner = argv[++i]; }
    else if (argv[i] === '--version') { a.version = argv[++i]; }
    else if (argv[i] === '--rapide') { a.rapide = true; }
  }
  return a;
}

function main() {
  const { runner, version, rapide } = analyserArgs(process.argv.slice(2));
  const runnersValides = ['ubuntu', 'windows', 'poste', 'tous'];
  if (!runnersValides.includes(runner)) {
    console.error('--runner attend l’une de : ' + runnersValides.join(', ') + ' (reçu "' + runner + '")');
    process.exit(2);
  }
  const runnersAJouer = runner === 'tous' ? ['poste', 'ubuntu', 'windows'] : [runner];

  const etapes = [
    ['a) YAML des deux workflows', verifierYaml],
    ['b) typographie des textes visibles', verifierTypographie],
    ['c) bump des extensions modifiées', verifierBumpExtensions],
    ['d) CHANGELOG' + (version ? '.md et nouveautes.json' : '.md (sauté, --version absent)'),
      () => verifierChangelogEtNouveautes(version)],
  ];
  if (rapide) {
    etapes.push(['e) t.skip() sans assistant sauter.* (statique)', verifierSautsStatiques]);
  } else {
    for (const r of runnersAJouer) {
      etapes.push(['e) suite complète — runner ' + r, () => verifierSuite(r)]);
    }
  }

  let vert = true;
  for (const [nom, fn] of etapes) {
    const debut = Date.now();
    const resultat = fn();
    const duree = ((Date.now() - debut) / 1000).toFixed(1);
    console.log((resultat.ok ? '[OK]    ' : '[ROUGE] ') + nom + '  (' + duree + 's)');
    if (resultat.detail) {
      for (const l of resultat.detail.split('\n')) { console.log('        ' + l); }
    }
    if (!resultat.ok) { vert = false; break; }
  }
  process.exit(vert ? 0 : 1);
}

if (require.main === module) { main(); }

module.exports = {
  verifierYaml, verifierTypographie, verifierBumpExtensions, verifierChangelogEtNouveautes,
  verifierSautsStatiques, verifierSuite, dernierTag, extensionsDuDepot, fichiersDeSuite,
  envPourRunner, analyserArgs
};
