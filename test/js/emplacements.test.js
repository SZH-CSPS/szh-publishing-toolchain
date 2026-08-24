// Où vivent les revues : la clé de config.json qui déplace la racine de tout le travail.
//
//   node --test "test/js/*.test.js"
//
// Le défaut de cet interrupteur était implicite — clé absente valait « dossier de test » —
// et il est lu deux fois, par lib/archivage.js et par windows/szh-common.ps1. Deux dangers,
// gardés ici :
//   * un poste qui ne dit rien doit continuer de voir exactement les mêmes revues, sinon
//     une mise à jour ferait disparaître le travail d'un rédacteur sans un mot ;
//   * les deux moitiés doivent lire la même valeur. `"devMode": "false"` les séparait
//     déjà : [bool]'false' vaut $true en PowerShell, 'false' === true est faux en
//     JavaScript.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const archivage = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'archivage.js'));

// Les cas soumis aux deux moitiés. `attendu` est ce que voit le rédacteur : 'test' pour la
// racine de développement, 'production' pour l'arborescence SharePoint.
const CAS = [
  { nom: 'aucune des deux clés — le défaut historique', config: {}, attendu: 'test' },
  { nom: 'config illisible ou absente', config: null, attendu: 'test' },
  { nom: 'un poste réel : repo et revuesRoots, pas de clé', config: { repo: 'SZH-CSPS/szh-publishing-toolchain', revuesRoots: [] }, attendu: 'test' },
  { nom: 'ancienne clé, mode test', config: { devMode: true }, attendu: 'test' },
  { nom: 'ancienne clé, mode production', config: { devMode: false }, attendu: 'production' },
  { nom: 'clé neuve, test', config: { emplacementRevues: 'test' }, attendu: 'test' },
  { nom: 'clé neuve, production', config: { emplacementRevues: 'production' }, attendu: 'production' },
  { nom: 'casse et espaces tolérés', config: { emplacementRevues: '  PRODUCTION ' }, attendu: 'production' },
  { nom: 'la clé neuve gagne sur l’ancienne', config: { emplacementRevues: 'production', devMode: true }, attendu: 'production' },
  { nom: 'la clé neuve gagne aussi dans l’autre sens', config: { emplacementRevues: 'test', devMode: false }, attendu: 'test' },
  { nom: 'valeur neuve inconnue : on retombe sur l’ancienne clé', config: { emplacementRevues: 'sharepoint', devMode: false }, attendu: 'production' },
  { nom: 'valeur neuve inconnue et rien d’autre', config: { emplacementRevues: 'sharepoint' }, attendu: 'test' },
  { nom: 'ancienne clé écrite à la main : "false"', config: { devMode: 'false' }, attendu: 'production' },
  { nom: 'ancienne clé écrite à la main : "true"', config: { devMode: 'true' }, attendu: 'test' },
  { nom: 'ancienne clé numérique : 0', config: { devMode: 0 }, attendu: 'production' },
  { nom: 'ancienne clé numérique : 1', config: { devMode: 1 }, attendu: 'test' },
  { nom: 'ancienne clé illisible : la clé est ignorée', config: { devMode: 'peut-être' }, attendu: 'test' },
  { nom: 'ancienne clé nulle : la clé est ignorée', config: { devMode: null }, attendu: 'test' }
];

// ---- La moitié JavaScript ----

test('emplacement des revues : chaque configuration donne la racine attendue', () => {
  for (const cas of CAS) {
    assert.strictEqual(archivage.resoudreEmplacementRevues(cas.config), cas.attendu, cas.nom);
  }
});

test('un poste qui ne dit rien garde la racine qu’il avait', () => {
  // La règle d'avant : clé absente -> mode développeur -> arborescence de test. Elle ne
  // doit pas bouger, c'est la seule qui ne fasse disparaître aucune revue.
  for (const cfg of [null, undefined, {}, { repo: 'x' }, { basesRevues: { prod: 'P', dev: 'D' } }]) {
    assert.strictEqual(archivage.resoudreEmplacementRevues(cfg), archivage.EMPLACEMENT_TEST);
    assert.strictEqual(archivage.resoudreEmplacementRevues(cfg) === archivage.EMPLACEMENT_TEST, true);
  }
});

test('lireModeDeveloppeur n’est que l’ancien nom de l’emplacement de test', () => {
  // L'hôte et ses réglages appellent encore les deux anciens noms : ils doivent suivre la
  // clé neuve, sinon la bascule du cockpit n'aurait plus d'effet.
  assert.strictEqual(typeof archivage.lireModeDeveloppeur(), 'boolean');
  assert.strictEqual(typeof archivage.ecrireModeDeveloppeur, 'function');
  assert.strictEqual(archivage.ecrireModeDeveloppeur.length, 1);
});

test('la bascule écrit les deux clés, la neuve et l’ancienne', () => {
  const versProd = archivage.configAvecEmplacement({ repo: 'x' }, 'production');
  assert.strictEqual(versProd.emplacementRevues, 'production');
  assert.strictEqual(versProd.devMode, false);
  assert.strictEqual(versProd.repo, 'x', 'le reste de config.json doit survivre');
  const versTest = archivage.configAvecEmplacement(versProd, 'test');
  assert.strictEqual(versTest.emplacementRevues, 'test');
  assert.strictEqual(versTest.devMode, true);
  // Une valeur inconnue ne doit pas écrire n'importe quoi dans config.json.
  assert.strictEqual(archivage.configAvecEmplacement({}, 'sharepoint').emplacementRevues, 'test');
  // Et ce qui est écrit se relit à l'identique.
  for (const cfg of [versProd, versTest]) {
    assert.strictEqual(archivage.resoudreEmplacementRevues(JSON.parse(JSON.stringify(cfg))),
      cfg.emplacementRevues);
  }
});

// ---- L'accord des deux moitiés ----

test('les deux moitiés déclarent les mêmes clés et les mêmes valeurs', () => {
  const ps = fs.readFileSync(COMMUN_PS1, 'utf8');
  for (const attendu of ["$script:SzhEmplacementTest = 'test'",
    "$script:SzhEmplacementProd = 'production'"]) {
    assert.ok(ps.indexOf(attendu) !== -1, 'szh-common.ps1 ne déclare plus : ' + attendu);
  }
  assert.strictEqual(archivage.EMPLACEMENT_TEST, 'test');
  assert.strictEqual(archivage.EMPLACEMENT_PRODUCTION, 'production');
  // Le corps du résolveur PowerShell, pour y lire l'ordre des règles.
  const debut = ps.indexOf('function Resolve-SzhEmplacementRevues');
  assert.ok(debut !== -1, 'Resolve-SzhEmplacementRevues a disparu de szh-common.ps1');
  const corps = ps.slice(debut, ps.indexOf('\r\nfunction ', debut + 10));
  const rangs = ['emplacementRevues', 'devMode', '$SzhEmplacementTest'].map((c) => corps.indexOf(c));
  assert.ok(rangs.every((r) => r !== -1), 'une des trois règles manque : ' + rangs.join(', '));
  assert.ok(rangs[0] < rangs[1], 'la clé neuve doit être lue avant l’ancienne');
  assert.ok(corps.trimEnd().endsWith('return $SzhEmplacementTest\r\n}'.trimEnd()) ||
    corps.indexOf('return $SzhEmplacementTest\r\n}') !== -1,
    'le dernier mot doit rester « test », le défaut historique');
});

// Les deux résolveurs sur les mêmes cas, pour de vrai. Windows seulement : szh-common.ps1
// vise Windows PowerShell 5.1 et son dot-source touche %LOCALAPPDATA%, absent ailleurs.
const POWERSHELL = (function () {
  if (process.platform !== 'win32') { return ''; }
  const candidats = [path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe'];
  for (const c of candidats) {
    const essai = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) { return c; }
  }
  return '';
})();

test('PowerShell et JavaScript rendent le même emplacement', { skip: POWERSHELL ? false : 'powershell.exe indisponible' }, () => {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-emplacements-'));
  const casJson = path.join(travail, 'cas.json');
  const pilote = path.join(travail, 'resoudre.ps1');
  fs.writeFileSync(casJson, JSON.stringify(CAS.map((c) => ({ config: c.config }))), 'utf8');
  // Le pilote ne fait que dot-sourcer le socle et appeler le résolveur : rien n'est écrit
  // dans C:\ProgramData\SZH — la résolution est pure des deux côtés.
  fs.writeFileSync(pilote, [
    '$ErrorActionPreference = \'Stop\'',
    '. "' + COMMUN_PS1 + '"',
    '$cas = Get-Content $args[0] -Raw -Encoding UTF8 | ConvertFrom-Json',
    'foreach ($c in $cas) { Write-Output (Resolve-SzhEmplacementRevues $c.config) }'
  ].join('\r\n') + '\r\n', 'utf8');
  const sortie = spawnSync(POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, casJson],
    { encoding: 'utf8' });
  assert.strictEqual(sortie.status, 0, 'le pilote PowerShell a échoué : ' + (sortie.stderr || ''));
  const rendus = String(sortie.stdout).split(/\r?\n/).filter((l) => l.trim() !== '');
  assert.strictEqual(rendus.length, CAS.length, 'PowerShell n’a pas répondu à tous les cas');
  for (let i = 0; i < CAS.length; i++) {
    assert.strictEqual(rendus[i].trim(), CAS[i].attendu, 'PowerShell, cas : ' + CAS[i].nom);
    assert.strictEqual(rendus[i].trim(), archivage.resoudreEmplacementRevues(CAS[i].config),
      'les deux moitiés divergent, cas : ' + CAS[i].nom);
  }
  fs.rmSync(travail, { recursive: true, force: true });
});

// ---- Ce que le lanceur montre ----

test('le titre du lanceur nomme la racine active, dans les trois langues', () => {
  const ps = fs.readFileSync(COMMUN_PS1, 'utf8');
  // Un titre par langue, et le jeton que T remplace par l'étiquette de la racine.
  const titres = ps.match(/'lanceur\.titre'\s*=\s*'[^']*'/g) || [];
  assert.strictEqual(titres.length, 3, 'il faut un titre de lanceur par langue');
  for (const t of titres) { assert.ok(t.indexOf('{racine}') !== -1, 'titre sans {racine} : ' + t); }
  const titresZs = ps.match(/'lanceur\.titre\.zs'\s*=\s*'[^']*'/g) || [];
  assert.strictEqual(titresZs.length, 3);
  for (const t of titresZs) { assert.ok(t.indexOf('{racine}') !== -1, 'titre sans {racine} : ' + t); }
  // T doit savoir le remplacer, sinon le jeton s'afficherait tel quel.
  assert.ok(ps.indexOf("$texte.Replace('{racine}', (Get-SzhEtiquetteRacine))") !== -1,
    'T ne remplace plus {racine}');
  // Les deux mots de l'étiquette existent dans les trois langues, allemand en « ss ».
  for (const cle of ['racine.test', 'racine.prod']) {
    const mots = ps.match(new RegExp("'" + cle.replace('.', '\\.') + "'\\s*=\\s*'[^']*'", 'g')) || [];
    assert.strictEqual(mots.length, 3, 'il manque une traduction de ' + cle);
    for (const m of mots) { assert.ok(m.indexOf('ß') === -1, 'orthographe suisse : ' + m); }
  }
});

test('l’écriture de l’emplacement ne touche pas un config.json absent', () => {
  const ps = fs.readFileSync(COMMUN_PS1, 'utf8');
  const debut = ps.indexOf('function Initialize-SzhEmplacementRevues');
  assert.ok(debut !== -1, 'Initialize-SzhEmplacementRevues a disparu');
  const corps = ps.slice(debut, ps.indexOf('\r\n# Emplacement actif', debut));
  // bootstrap.ps1 crée config.json et n'y écrit `repo` et `basesRevues` que si le fichier
  // manque : un fichier posé ici avant lui le priverait des deux.
  assert.ok(corps.indexOf('if (-not (Test-Path $SzhConfigFile)) { return \'\' }') !== -1,
    'la migration doit renoncer quand config.json n’existe pas');
  // Et jamais « production » sans avoir compté les numéros des deux côtés.
  assert.ok(corps.indexOf('Measure-SzhNumeros $SzhEmplacementTest') !== -1 &&
    corps.indexOf('Measure-SzhNumeros $SzhEmplacementProd') !== -1,
    'le choix doit regarder les deux racines');
  assert.ok(corps.indexOf('if ($nTest -eq 0 -and $nProd -gt 0) { $choisi = $SzhEmplacementProd }') !== -1,
    'production ne doit être choisi que si la racine de test est vide');
});
