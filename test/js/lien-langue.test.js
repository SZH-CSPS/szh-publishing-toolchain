// Langue d'un lien szh:// reçu par le protocole : elle doit suivre le PRODUIT DU LIEN, pas
// le défaut du paramètre -Produit du lanceur.
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici est un effet de bord silencieux sur un réglage PARTAGÉ ENTRE TOUS LES
// COMPTES d'un poste. windows/open-revue.ps1 sert deux rôles : lanceur du menu Démarrer
// (appelé avec -Produit revue|zeitschrift) et gestionnaire du protocole szh://. Mais
// update.ps1 (Set-SzhProtocoleSzh) enregistre ce protocole SANS -Produit : quand un lien
// szh://traduction/zeitschrift/… est ouvert depuis Outlook, $Produit retombe donc sur son
// défaut 'revue', et Set-SzhLangueProduit 'revue' — appelée avant toute analyse du lien —
// force le français. Cette fonction n'agit pas que sur la session : elle écrit `langue`
// dans state.json, sous C:\ProgramData\SZH — un chemin MACHINE, partagé par tous les
// comptes du poste. Une rédactrice germanophone qui clique un lien Zeitschrift voit ainsi
// la préférence de langue de TOUT LE POSTE basculer en français, jusqu'au prochain lanceur
// ouvert — et la fenêtre de mise à jour de la tâche planifiée, entre-temps, s'affiche dans
// la mauvaise langue.
//
// Le correctif : après avoir validé le lien (Get-SzhLien), open-revue.ps1 rappelle
// Set-SzhLangueProduit avec le produit DU LIEN. C'est un ordre, et c'est tout le sujet de
// ce fichier — le dernier appel gagne, donc celui qui vient après Get-SzhLien doit être
// celui qui connaît le vrai produit.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const OUVRIR = lire('windows', 'open-revue.ps1');
const UPDATE = lire('windows', 'update.ps1');

// ---- La prémisse : le protocole est enregistré sans -Produit ----

test('update.ps1 enregistre le ProgId szh sans -Produit — c’est la prémisse du défaut', () => {
  const debut = UPDATE.indexOf('function Set-SzhProtocoleSzh');
  assert.ok(debut !== -1, 'Set-SzhProtocoleSzh a disparu de update.ps1');
  const corps = UPDATE.slice(debut, UPDATE.indexOf('\r\nfunction ', debut + 10));
  assert.ok(corps.indexOf('open-revue.ps1') !== -1, 'le ProgId ne vise plus open-revue.ps1');
  assert.ok(corps.indexOf('-Produit') === -1,
    'update.ps1 passe maintenant -Produit au protocole : si le lanceur reçoit son vrai ' +
    'produit par ce biais, le correctif de ce fichier devient inutile sans que rien ne le ' +
    'dise — vérifier alors que le lien garde quand même le dernier mot sur la langue');
  // Ce que $Produit vaut par défaut quand personne ne le passe : 'revue', jamais 'tout'.
  assert.match(OUVRIR, /\[string\]\$Produit = 'revue'/);
});

// ---- L'ordre, dans open-revue.ps1 : c'est tout le sujet ----

test('open-revue.ps1 : le lien rappelle Set-SzhLangueProduit avec SON produit, après Get-SzhLien', () => {
  const iBlocLien = OUVRIR.indexOf('if ($Lien) {');
  const iGetLien = OUVRIR.indexOf('$cible = Get-SzhLien $Lien');
  const iGarde = OUVRIR.indexOf('exit 1', iGetLien);              // sort si $cible est nul
  const iRappel = OUVRIR.indexOf('Set-SzhLangueProduit $cible.produit');
  const iRacines = OUVRIR.indexOf('# ---- Racines à balayer ----');
  assert.ok(iBlocLien !== -1 && iGetLien !== -1 && iRappel !== -1,
    'un des trois repères a disparu de open-revue.ps1');
  assert.ok(iBlocLien < iGetLien, 'Get-SzhLien doit être dans le bloc if ($Lien)');
  // L'ordre qui est tout le sujet : le rappel vient après l'analyse du lien, jamais avant —
  // sinon $cible.produit n'existe pas encore et l'appel plante ou passe une valeur vide.
  assert.ok(iGetLien < iRappel,
    'Set-SzhLangueProduit $cible.produit doit venir APRÈS Get-SzhLien : c’est le lien qui ' +
    'doit dire la langue, pas l’inverse');
  // Et après la garde qui sort quand $cible est nul, sinon $cible.produit est vide à cet
  // instant précis du script.
  assert.ok(iGarde !== -1 && iGarde < iRappel,
    'le rappel doit venir après la garde « $cible nul » qui sort du script');
  // Toujours dans le bloc lien, pas glissé plus bas dans le lanceur-liste.
  assert.ok(iRacines === -1 || iRappel < iRacines,
    'le rappel a quitté le bloc « lien reçu », il ne s’applique donc plus qu’au lanceur');
  // Une seule autre occurrence : celle du tout début, avec le produit du LANCEUR
  // ($produitFiltre), avant toute analyse de lien. Si ce compte change, un appel a été
  // ajouté ou perdu sans que ce test le sache.
  const occurrences = (OUVRIR.match(/Set-SzhLangueProduit /g) || []).length;
  assert.strictEqual(occurrences, 2,
    'open-revue.ps1 doit appeler Set-SzhLangueProduit exactement deux fois : une fois pour ' +
    'le lanceur, une fois — après coup — pour le lien');
});

test('open-revue.ps1 : le titre de la fenêtre est recalculé après la bascule de langue du lien', () => {
  // Piège de ce correctif : $titreFenetre est figé plus haut (avant l'analyse du lien),
  // calculé avec la langue du LANCEUR. Sans recalcul, la boîte « lien introuvable »
  // afficherait un titre resté dans l'ancienne langue — visible seulement quand le produit
  // du lien diffère de celui du lanceur, donc rarement remarqué à l'œil.
  const iRappel = OUVRIR.indexOf('Set-SzhLangueProduit $cible.produit');
  const iIntrouvable = OUVRIR.indexOf("T 'lien.introuvable'");
  assert.ok(iRappel !== -1 && iIntrouvable !== -1, 'repère manquant dans open-revue.ps1');
  // Le titre doit être recalculé entre le rappel de langue et la boîte « introuvable » —
  // sinon celle-ci lit encore l'ancienne table de textes.
  const segment = OUVRIR.slice(iRappel, iIntrouvable);
  assert.match(segment, /\$titreFenetre = \(T 'lanceur\.titre'\)/,
    '$titreFenetre n’est pas recalculé entre le rappel de langue et la boîte « introuvable »');
  assert.match(segment,
    /if \(\(\[string\]\$cible\.produit\)\.ToLower\(\) -eq 'zeitschrift'\) \{ \$titreFenetre = \(T 'lanceur\.titre\.zs'\) \}/,
    'le titre recalculé ne suit pas le produit DU LIEN (zeitschrift => titre.zs)');
});

// ---- Le mécanisme, réellement exécuté : le dernier appel gagne ----
// Windows seulement : szh-common.ps1 vise Windows PowerShell 5.1. Rien n'est écrit dans le
// vrai C:\ProgramData\SZH : $script:SzhBase et $script:SzhStateFile sont redirigés vers un
// dossier de travail jetable, comme le fait déjà test/js/installation.test.js.

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

test('Set-SzhLangueProduit : le dernier appel gagne — la preuve que l’ordre du fichier compte',
  { skip: POWERSHELL ? false : 'powershell.exe indisponible' }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lien-langue-'));
    const sortie = path.join(travail, 'bilan.json');
    const pilote = path.join(travail, 'piloter.ps1');
    fs.writeFileSync(pilote, [
      "$ErrorActionPreference = 'Stop'",
      // Un essai antérieur ayant laissé SZH_LANGUE dans la session le ferait gagner à la
      // place du lien : ce test porte sur state.json, pas sur cette variable d'essai.
      'if (Test-Path Env:\\SZH_LANGUE) { Remove-Item Env:\\SZH_LANGUE }',
      '. "' + COMMUN_PS1 + '"',
      '$travail = $args[0]; $sortie = $args[1]',
      '$script:SzhBase = Join-Path $travail "ProgramData"',
      '$script:SzhStateFile = Join-Path $SzhBase "state.json"',
      'New-Item -ItemType Directory -Force -Path $SzhBase | Out-Null',
      // 1. Le lanceur ouvert par le protocole, sans -Produit : le défaut 'revue' parle
      //    d'abord, exactement comme au tout début de open-revue.ps1 (lignes 51-54).
      "Set-SzhLangueProduit 'revue'",
      '$apresLanceur = (Get-SzhState).langue',
      // 2. Le lien réellement reçu, analysé par la vraie fonction — une Zeitschrift, à
      //    l'opposé du défaut du lanceur.
      "$cible = Get-SzhLien 'szh://traduction/zeitschrift/2026-05'",
      '$produitLien = $cible.produit',
      // 3. Le rappel qu'ajoute le correctif : le lien a le dernier mot.
      'Set-SzhLangueProduit $cible.produit',
      '$apresLien = (Get-SzhState).langue',
      '$r = [ordered]@{ produitLien = $produitLien; apresLanceur = $apresLanceur; apresLien = $apresLien }',
      'Set-SzhJson $sortie $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
      travail, sortie], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.strictEqual(run.status, 0, 'le pilote PowerShell a échoué : ' + (run.stderr || ''));
    const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
    fs.rmSync(travail, { recursive: true, force: true });
    assert.strictEqual(r.produitLien, 'zeitschrift', 'Get-SzhLien ne rend plus le bon produit');
    assert.strictEqual(r.apresLanceur, 'fr',
      'le lanceur, sans lien, doit bien parler français par défaut — sinon ce test ne prouve rien');
    // La preuve du défaut : sans le second appel, state.json resterait sur 'fr' — la langue
    // du LANCEUR, pas celle du LIEN. Or c'est un réglage de POSTE, partagé par tous les
    // comptes : il doit refléter le lien qui vient d'être ouvert, pas le défaut du lanceur.
    assert.strictEqual(r.apresLien, 'de',
      'le lien Zeitschrift doit faire gagner l’allemand dans state.json');
  });
