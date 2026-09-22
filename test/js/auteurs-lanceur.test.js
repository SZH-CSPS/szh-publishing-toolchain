// windows/open-produit.ps1 : Get-SzhOutilAuteurs + Start-SzhMoissonAuteurs, qui construisent
// C:\ProgramData\SZH\auteurs.json au lancement de l'application si le cache manque encore --
// le lanceur PowerShell (raccourcis du menu Démarrer) s'ouvre directement, sans jamais
// passer par VSCodium (voir outils/auteurs-cli.js pour le pourquoi).
//
// Ce fichier ne lance jamais un vrai VSCodium-en-Node : le lanceur n'a pas de mode
// « silencieux » pour ouvrir une fenêtre réelle et observer un Process.Start(), donc le
// contrôle se fait comme test/js/manuscrit-lanceur.test.js -- analyse statique du texte du
// script pour la forme (garde de simulation en premier, jamais de blocage, jamais de
// fenêtre), et SZH_LANCEUR_SIMULE=1 pour la preuve dynamique que la garde de simulation tient
// vraiment à l'exécution (rien dans le journal).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const OPEN_PRODUIT = path.join(RACINE, 'windows', 'open-produit.ps1');
const SOURCE = fs.readFileSync(OPEN_PRODUIT, 'utf8');

// Extrait le corps d'une fonction PowerShell par comptage d'accolades -- aucune des deux
// fonctions ci-dessous n'a de `{`/`}` dans un commentaire ou une chaîne, un simple compteur
// suffit donc (contrairement à un JS/CSS quelconque, il n'y a ici ni accolade dans une regex
// ni dans un template).
function extraireFonction(texte, nom) {
  const debut = texte.indexOf('function ' + nom + ' {');
  assert.ok(debut !== -1, 'fonction introuvable dans open-produit.ps1 : ' + nom);
  const iAccolade = texte.indexOf('{', debut);
  let profondeur = 0;
  for (let i = iAccolade; i < texte.length; i++) {
    if (texte[i] === '{') { profondeur++; }
    else if (texte[i] === '}') {
      profondeur--;
      if (profondeur === 0) { return texte.slice(debut, i + 1); }
    }
  }
  assert.fail('accolade fermante introuvable pour ' + nom);
}

const OUTIL_AUTEURS = extraireFonction(SOURCE, 'Get-SzhOutilAuteurs');
const MOISSON_AUTEURS = extraireFonction(SOURCE, 'Start-SzhMoissonAuteurs');

// ---- Contrôle n1 : le script s'analyse toujours sans erreur de syntaxe ------------------
test('open-produit.ps1 s\'analyse toujours sans erreur de syntaxe après l\'ajout de la moisson des auteur·e·s',
  { skip: sansPowerShell }, () => {
    const cheminBarres = OPEN_PRODUIT.replace(/\//g, '\\');
    const script = [
      '$chemin = ' + JSON.stringify(cheminBarres),
      '$erreurs = $null',
      '[System.Management.Automation.Language.Parser]::ParseFile($chemin, [ref]$null, [ref]$erreurs) | Out-Null',
      'if ($erreurs.Count -gt 0) { $erreurs | ForEach-Object { Write-Output $_.ToString() } } else { Write-Output "OK" }'
    ].join('\r\n');
    const pilote = path.join(os.tmpdir(), 'szh-parse-open-produit-auteurs-' + process.pid + '.ps1');
    fs.writeFileSync(pilote, script, 'utf8');
    let run;
    try {
      run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    } finally {
      fs.rmSync(pilote, { force: true });
    }
    assert.strictEqual(run.status, 0, 'le pilote PowerShell a échoué - ' + (run.stderr || ''));
    assert.strictEqual(run.stdout.trim(), 'OK', 'erreur(s) de syntaxe rapportée(s) - ' + run.stdout);
  });

// ---- Contrôle n2 : Get-SzhOutilAuteurs ne lève jamais (contrairement à Get-SzhOutilSecretariat) --
test('Get-SzhOutilAuteurs ne lève jamais, et rend une chaîne vide quand l\'outil est introuvable', () => {
  assert.ok(!/\bthrow\b/.test(OUTIL_AUTEURS),
    'Get-SzhOutilAuteurs lève -- une extension pas encore posée ne doit produire ni message ni rapport d\'erreur : ' + OUTIL_AUTEURS);
  assert.match(OUTIL_AUTEURS, /return\s+['"]{2}/, 'Get-SzhOutilAuteurs doit rendre une chaîne vide en repli');
});

// ---- Contrôle n3 : Start-SzhMoissonAuteurs -- gardes en tête, jamais bloquant, jamais visible --
test('Start-SzhMoissonAuteurs : la garde de simulation est la toute première instruction', () => {
  const iGardeSimule = MOISSON_AUTEURS.indexOf('if ($script:SzhSimule) { return }');
  const iOuvreFonction = MOISSON_AUTEURS.indexOf('{');
  assert.ok(iGardeSimule !== -1, 'la garde SZH_LANCEUR_SIMULE est absente de Start-SzhMoissonAuteurs');
  // Rien d'autre entre l'accolade ouvrante de la fonction et cette garde -- un $codium lu, un
  // Get-SzhOutilAuteurs appelé, ou un Process construit AVANT elle contredirait « rien en
  // simulation ».
  const entreDeux = MOISSON_AUTEURS.slice(iOuvreFonction + 1, iGardeSimule).trim();
  assert.strictEqual(entreDeux, '', 'du code s\'exécute avant la garde de simulation : ' + JSON.stringify(entreDeux));
});

test('Start-SzhMoissonAuteurs : garde $codium juste après la garde de simulation, avant tout Process', () => {
  const iSimule = MOISSON_AUTEURS.indexOf('if ($script:SzhSimule) { return }');
  const iCodium = MOISSON_AUTEURS.indexOf('if (-not $codium) { return }');
  const iProcess = MOISSON_AUTEURS.indexOf('System.Diagnostics.Process');
  assert.ok(iCodium > iSimule, 'la garde $codium doit venir après la garde de simulation');
  assert.ok(iProcess > iCodium, 'un Process est construit avant que $codium ne soit vérifié');
});

test('Start-SzhMoissonAuteurs : jamais bloquant -- ni WaitForExit, ni ReadLine/ReadToEnd, ni Start-Process -Wait', () => {
  assert.ok(!/WaitForExit/.test(MOISSON_AUTEURS), 'Start-SzhMoissonAuteurs attend la fin du processus -- ce doit être non bloquant');
  assert.ok(!/Read(Line|ToEnd)/.test(MOISSON_AUTEURS), 'Start-SzhMoissonAuteurs lit la sortie du processus -- personne ne doit l\'attendre');
  assert.ok(!/-Wait\b/.test(MOISSON_AUTEURS), 'Start-SzhMoissonAuteurs porte -Wait -- ce doit être non bloquant');
});

test('Start-SzhMoissonAuteurs : jamais de fenêtre, jamais de rapport d\'erreur, jamais une exception qui remonte', () => {
  assert.ok(!/MessageBox/.test(MOISSON_AUTEURS), 'Start-SzhMoissonAuteurs ne doit jamais afficher de fenêtre -- hors ligne est un état normal du poste');
  assert.ok(!/Write-SzhRapport/.test(MOISSON_AUTEURS), 'Start-SzhMoissonAuteurs ne doit jamais poser de rapport d\'erreur automatique -- une ligne de journal suffit');
  assert.match(MOISSON_AUTEURS, /\btry\s*\{[\s\S]*\}\s*catch\s*\{/, 'Start-SzhMoissonAuteurs doit tout envelopper dans un try/catch');
  assert.match(MOISSON_AUTEURS, /catch\s*\{[^}]*Write-SzhLog/, 'l\'échec doit rester silencieux : seulement une ligne de journal, jamais plus');
});

test('Start-SzhMoissonAuteurs : VSCodium-en-Node (ELECTRON_RUN_AS_NODE=1), UseShellExecute=$false, CreateNoWindow=$true', () => {
  assert.match(MOISSON_AUTEURS, /EnvironmentVariables\['ELECTRON_RUN_AS_NODE'\]\s*=\s*'1'/,
    'Start-SzhMoissonAuteurs doit lancer VSCodium en mode Node (ELECTRON_RUN_AS_NODE=1)');
  assert.match(MOISSON_AUTEURS, /UseShellExecute\s*=\s*\$false/);
  assert.match(MOISSON_AUTEURS, /CreateNoWindow\s*=\s*\$true/);
  assert.match(MOISSON_AUTEURS, /Get-SzhOutilAuteurs/, 'Start-SzhMoissonAuteurs doit résoudre son script via Get-SzhOutilAuteurs, pas un chemin recopié');
});

// ---- Contrôle n4 : l'appel a bien lieu une fois, après la vérification de VSCodium -------
test('Start-SzhMoissonAuteurs est appelée exactement une fois, après la vérification de VSCodium et avant l\'ancrage SharePoint', () => {
  const iCheckCodium = SOURCE.indexOf("if ((-not $codium) -and (-not $script:SzhSimule)) {");
  const iAncrage = SOURCE.indexOf('Initialize-SzhAncrage');
  assert.ok(iCheckCodium !== -1 && iAncrage !== -1, 'repères introuvables dans open-produit.ps1');
  // Les appels (pas les définitions) : une ligne qui commence par le nom, sans "function"
  // devant ni argument derrière.
  const motifAppel = /(?:^|\n)Start-SzhMoissonAuteurs\s*(?:\r?\n|$)/g;
  const appels = [...SOURCE.matchAll(motifAppel)];
  assert.strictEqual(appels.length, 1, 'Start-SzhMoissonAuteurs doit être appelée exactement une fois : ' + appels.length + ' fois');
  assert.ok(appels[0].index > iCheckCodium, 'l\'appel doit venir après la vérification de VSCodium');
  assert.ok(appels[0].index < iAncrage, 'l\'appel doit venir avant la résolution de l\'ancrage SharePoint');
});

// ---- Contrôle n5, dynamique : sous SZH_LANCEUR_SIMULE=1, rien n'est journalisé -----------
// Preuve que la garde tient à l'EXÉCUTION, pas seulement dans le texte : un vrai lancement
// simulé, sur une arborescence jetable, ne doit laisser aucune trace de tentative de moisson.
function moisCourant() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function lireJournal(base) {
  const fichier = path.join(base, 'logs', 'szh-' + moisCourant() + '.log');
  if (!fs.existsSync(fichier)) { return ''; }
  return fs.readFileSync(fichier, 'utf8');
}

test('SZH_LANCEUR_SIMULE=1 : aucune trace de moisson des auteur·e·s dans le journal, sortie JSON normale',
  { skip: sansPowerShell }, () => {
    const programData = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-auteurs-lanceur-'));
    fs.writeFileSync(path.join(programData, 'config.json'), JSON.stringify({ emplacementRevues: 'test' }), 'utf8');
    const env = Object.assign({}, process.env, { SZH_BASE: programData, SZH_LANCEUR_SIMULE: '1' });
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OPEN_PRODUIT],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
    let sortie = null;
    try { sortie = JSON.parse((run.stdout || '').trim()); } catch (e) { /* rapporté ci-dessous */ }
    const journal = lireJournal(programData);
    fs.rmSync(programData, { recursive: true, force: true });
    assert.ok(sortie, 'le lanceur simulé n\'a pas produit de JSON valide - ' + run.stdout + ' / ' + run.stderr);
    assert.ok(journal.indexOf('moisson des auteurs') === -1,
      'le journal porte une trace de moisson des auteur·e·s alors que SZH_LANCEUR_SIMULE=1 - ' + journal);
  });
