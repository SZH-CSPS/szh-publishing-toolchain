// La migration AUTOMATIQUE de l'arborescence (windows/szh-migration.ps1,
// Invoke-SzhMigrationArborescence), appelée par update.ps1 à chaque mise à jour.
//
//   node --test test/js/migration-arborescence.test.js
//   node --test "test/js/*.test.js"
//
// Ce que ce banc prouve, sur une arborescence jetable (jamais le vrai OneDrive, jamais le
// vrai C:\ProgramData) :
//   1. un conflit de nom ne perd rien : la source reste en place, la destination déjà
//      occupée n'est jamais écrasée, et le conflit se journalise ;
//   2. un déplacement normal pose un `id:` manquant (16 [A-Za-z0-9], jamais recalculé s'il
//      existe déjà) et refait le raccourci « Ouvrir la revue » dans sa forme définitive ;
//   3. relancée sur un état déjà migré, la fonction ne fait rien de plus (idempotence) ;
//   4. un item qui ne peut pas être déplacé (verrouillé, ou destination occupée par un
//      FICHIER) ne fait pas planter le reste du lot -- l'équivalent le plus proche, sur ce
//      banc, d'un fichier OneDrive « en ligne seulement » : voir la note au test 4, dont la
//      vraie preuve ne peut se faire que sur un poste avec OneDrive Files On-Demand.
//
// La racine de PRODUCTION n'est JAMAIS redirigée vers un dossier qui existe : la fonction ne
// doit rien y lire ni y écrire, et un test qui la pointerait vers un dossier réel ne
// prouverait rien.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const MIGRATION_PS1 = path.join(RACINE, 'windows', 'szh-migration.ps1');

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
const sansPowerShell = POWERSHELL ? false : 'powershell.exe indisponible';

const RE_ID = /^[A-Za-z0-9]{16}$/;

function monterRacine(nom) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-migration-' + nom + '-'));
  const programData = path.join(travail, 'ProgramData');
  const racineTest = path.join(travail, 'racine-test');
  fs.mkdirSync(programData, { recursive: true });
  fs.mkdirSync(racineTest, { recursive: true });
  return { travail, programData, racineTest };
}

function ecrireAusgabe(dossier, contenu) {
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'ausgabe.yaml'), contenu, 'utf8');
}

// Lance windows/szh-common.ps1 (qui dot-source szh-migration.ps1) sur l'arborescence
// jetable, appelle Invoke-SzhMigrationArborescence une fois, et rend le dernier journal
// écrit -- c'est la seule fenêtre sur ce que la fonction a fait, puisqu'elle ne rend rien.
function lancerMigration(f) {
  const sonde = path.join(f.travail, 'sonde-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1');
  const sortie = sonde.replace(/\.ps1$/, '.json');
  const script = [
    'param([string]$RacineDepot)',
    '. (Join-Path $RacineDepot \'windows\\szh-common.ps1\')',
    'Invoke-SzhMigrationArborescence',
    '$dernier = \'\'',
    'try {',
    '  $logs = @(Get-ChildItem (Join-Path $env:SZH_BASE \'logs\') -Filter \'szh-*.log\' -ErrorAction Stop |',
    '    Sort-Object LastWriteTime -Descending)',
    '  if ($logs.Count -gt 0) { $dernier = [string](Get-Content -LiteralPath $logs[0].FullName -Raw -Encoding UTF8) }',
    '} catch { }',
    ('[ordered]@{ journal = $dernier } | ConvertTo-Json -Depth 4 | ' +
      'Set-Content -LiteralPath \'' + sortie.replace(/\\/g, '\\\\') + '\' -Encoding UTF8')
  ].join('\r\n');
  fs.writeFileSync(sonde, '\ufeff' + script, 'utf8');
  const env = Object.assign({}, process.env, {
    SZH_BASE: f.programData,
    SZH_RACINE_TEST: f.racineTest,
    // N'existe jamais : la migration ne doit ni le lire ni l'écrire.
    SZH_RACINE_PROD: path.join(f.travail, 'jamais-cree-prod'),
    LOCALAPPDATA: path.join(f.travail, 'Local')
  });
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sonde,
    '-RacineDepot', RACINE], { encoding: 'utf8', windowsHide: true, timeout: 120000, env });
  let journal = '';
  try { journal = JSON.parse(fs.readFileSync(sortie, 'utf8').replace(/^\uFEFF/, '')).journal; } catch (e) { journal = ''; }
  return { run, journal };
}

test('un conflit de nom laisse la source ET la destination intactes, et se journalise',
  { skip: sansPowerShell }, () => {
    const f = monterRacine('conflit');
    try {
      const ancien = path.join(f.racineTest, '52_Revue', 'RV02_Redaction', '2026-01');
      const nouveau = path.join(f.racineTest, 'Revue', '2026-01');
      const contenuAncien = 'titre: "Ancien"\n';
      ecrireAusgabe(ancien, contenuAncien);
      const contenuNouveau = 'titre: "Deja migre"\nid: "AAAAAAAAAAAAAAAA"\n';
      ecrireAusgabe(nouveau, contenuNouveau);

      const { run, journal } = lancerMigration(f);
      assert.strictEqual(run.status, 0, 'la migration a échoué sur un conflit : ' + run.stderr);

      assert.ok(fs.existsSync(ancien), 'la source a disparu malgré le conflit : rien ne devait bouger');
      assert.strictEqual(fs.readFileSync(path.join(ancien, 'ausgabe.yaml'), 'utf8'), contenuAncien,
        'le manifeste de la source a été modifié');
      assert.strictEqual(fs.readFileSync(path.join(nouveau, 'ausgabe.yaml'), 'utf8'), contenuNouveau,
        'la destination déjà occupée a été écrasée : c’est exactement ce qu’il ne fallait jamais faire');
      assert.match(journal, /conflit/, 'le journal ne dit pas qu’un conflit a été rencontré');
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('un déplacement normal pose un id manquant et refait le raccourci',
  { skip: sansPowerShell }, () => {
    const f = monterRacine('normal');
    try {
      const ancien = path.join(f.racineTest, '52_Revue', 'RV02_Redaction', '2027-05');
      ecrireAusgabe(ancien, 'titre: "Numero"\nrevue: "revue"\n');
      // Un second numéro, avec un id DÉJÀ posé : preuve que la migration ne le recalcule
      // jamais.
      const ancienAvecId = path.join(f.racineTest, '52_Revue', 'RV02_Redaction', '2027-06');
      ecrireAusgabe(ancienAvecId, 'titre: "Autre"\nid: "QwErTyUiOpAsDfGh"\n');

      const { run, journal } = lancerMigration(f);
      assert.strictEqual(run.status, 0, 'la migration a échoué : ' + run.stderr);

      const nouveau = path.join(f.racineTest, 'Revue', '2027-05');
      assert.ok(fs.existsSync(nouveau), 'le numéro n’a pas été déplacé vers Revue\\2027-05');
      assert.ok(!fs.existsSync(ancien), 'l’ancien dossier existe encore après le déplacement');

      const contenu = fs.readFileSync(path.join(nouveau, 'ausgabe.yaml'), 'utf8');
      const mId = contenu.match(/^id:\s*"([^"]+)"/m);
      assert.ok(mId, 'aucun id n’a été posé sur le manifeste migré : ' + contenu);
      assert.match(mId[1], RE_ID, 'l’id posé n’a pas la forme attendue (16 [A-Za-z0-9])');
      assert.ok(contenu.indexOf('titre: "Numero"') !== -1,
        'le reste du manifeste n’a pas été préservé');

      assert.ok(fs.existsSync(path.join(nouveau, 'Ouvrir la revue.lnk')),
        'le raccourci n’a pas été refait dans le dossier à sa place définitive');

      // Le second numéro garde EXACTEMENT son id d’origine : jamais un recalcul.
      const nouveauAvecId = path.join(f.racineTest, 'Revue', '2027-06');
      const contenuAvecId = fs.readFileSync(path.join(nouveauAvecId, 'ausgabe.yaml'), 'utf8');
      assert.match(contenuAvecId, /id:\s*"QwErTyUiOpAsDfGh"/,
        'un id déjà présent a été recalculé pendant la migration');

      assert.match(journal, /migration arborescence/, 'la migration ne s’est pas journalisée');
      // L'id posé ci-dessus (mId) le prouve déjà pour un numéro DÉPLACÉ cette fois-ci (posé
      // par Set-SzhRaccourciRevue, appelé juste après le déplacement) ; le test suivant
      // prouve la seconde voie -- Update-SzhIdsManquants, pour un numéro déjà présent dans
      // la forme neuve.

      // Les dossiers vides d’origine (« 52_Revue\RV02_Redaction », puis « 52_Revue » lui-même
      // une fois vide) ont été retirés ; « Revue » et les dossiers communs existent.
      assert.ok(!fs.existsSync(path.join(f.racineTest, '52_Revue')),
        'le dossier « 52_Revue » vide n’a pas été retiré');
      assert.ok(fs.existsSync(path.join(f.racineTest, '_NewsUndActu', 'Fiches')),
        'la bibliothèque _NewsUndActu\\Fiches n’a pas été créée');
      assert.ok(fs.existsSync(path.join(f.racineTest, '_NewsUndActu', '_Statuts', 'fr')),
        '_NewsUndActu\\_Statuts\\fr n’a pas été créé');
      assert.ok(fs.existsSync(path.join(f.racineTest, '_NewsUndActu', '_Statuts', 'de')),
        '_NewsUndActu\\_Statuts\\de n’a pas été créé');
      // _Systeme\ ne doit JAMAIS être créé sous la racine de test : il vit sur SharePoint.
      assert.ok(!fs.existsSync(path.join(f.racineTest, '_Systeme')),
        '_Systeme a été créé sous la racine de test : il ne doit vivre que sur SharePoint');
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('un numéro déjà dans la forme neuve reçoit lui aussi un id s’il lui manque',
  { skip: sansPowerShell }, () => {
    // Aucun déplacement à faire ici : le numéro est déjà sous « Revue\ » — c'est
    // Update-SzhIdsManquants, la passe séparée qui balaie tout l'arbre neuf, qui doit poser
    // l'id, jamais Set-SzhRaccourciRevue (rien n'appelle de raccourci ici).
    const f = monterRacine('id-seul');
    try {
      const dossier = path.join(f.racineTest, 'Revue', '2027-10');
      const contenuInitial = 'titre: "Sans id"\nrevue: "revue"\n';
      ecrireAusgabe(dossier, contenuInitial);

      const { run, journal } = lancerMigration(f);
      assert.strictEqual(run.status, 0, 'la migration a échoué : ' + run.stderr);

      const contenu = fs.readFileSync(path.join(dossier, 'ausgabe.yaml'), 'utf8');
      const mId = contenu.match(/^id:\s*"([^"]+)"/m);
      assert.ok(mId, 'aucun id n’a été posé sur un numéro déjà dans la forme neuve : ' + contenu);
      assert.match(mId[1], RE_ID);
      assert.ok(contenu.indexOf('titre: "Sans id"') !== -1,
        'le reste du manifeste n’a pas été préservé par la passe de rattrapage des id');
      assert.match(journal, /id pose/, 'la pose d’un id par Update-SzhIdsManquants n’a pas été journalisée');
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('relancée sur un état déjà migré, la fonction ne bouge plus rien (idempotence)',
  { skip: sansPowerShell }, () => {
    const f = monterRacine('idempotent');
    try {
      const ancien = path.join(f.racineTest, '53_Zeitschrift', 'ZS02_Redaktion', '2027-07');
      ecrireAusgabe(ancien, 'titre: "Zeitschrift"\nrevue: "zeitschrift"\n');

      const premier = lancerMigration(f);
      assert.strictEqual(premier.run.status, 0, 'le premier passage a échoué : ' + premier.run.stderr);
      const nouveau = path.join(f.racineTest, 'Zeitschrift', '2027-07');
      assert.ok(fs.existsSync(nouveau), 'le premier passage n’a pas déplacé le numéro');
      const contenuApresUn = fs.readFileSync(path.join(nouveau, 'ausgabe.yaml'), 'utf8');

      const second = lancerMigration(f);
      assert.strictEqual(second.run.status, 0, 'le second passage a échoué : ' + second.run.stderr);
      const contenuApresDeux = fs.readFileSync(path.join(nouveau, 'ausgabe.yaml'), 'utf8');
      assert.strictEqual(contenuApresDeux, contenuApresUn,
        'le second passage a modifié un manifeste déjà migré (id recalculé ?)');
      // Rien à déplacer, rien à poser, rien à journaliser une deuxième fois : le journal du
      // mois n’a donc pas grandi entre les deux passages (Invoke-SzhMigrationArborescence
      // n’écrit qu’en cas de déplacement, de conflit ou d’id posé).
      assert.strictEqual(second.journal, premier.journal,
        'le second passage a écrit une nouvelle ligne de journal alors qu’il n’avait rien à faire : ' +
        second.journal.slice(premier.journal.length));
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('un item qui ne peut pas être déplacé ne bloque pas le reste du lot',
  { skip: sansPowerShell }, () => {
    // Reproduction la plus proche, sur un banc jetable sans vrai OneDrive, d’un fichier
    // « en ligne seulement » : une destination occupée par un FICHIER (et non un dossier),
    // ce qui fait échouer Move-Item avec une vraie exception .NET plutôt qu’un simple
    // conflit détecté par Test-Path. Un vrai placeholder OneDrive (reparse point Files
    // On-Demand) n’est pas reproductible ici : à vérifier sur un poste réel, dossier
    // « Toujours conserver sur cet appareil » désactivé sur un numéro de test.
    const f = monterRacine('verrou');
    try {
      const ancienBloque = path.join(f.racineTest, '52_Revue', 'RV02_Redaction', '2027-08');
      ecrireAusgabe(ancienBloque, 'titre: "Bloque"\n');
      // La destination est un FICHIER, pas un dossier : Move-Item ne peut pas y écrire.
      fs.mkdirSync(path.join(f.racineTest, 'Revue'), { recursive: true });
      fs.writeFileSync(path.join(f.racineTest, 'Revue', '2027-08'), 'ceci est un fichier, pas un dossier', 'utf8');

      const ancienOk = path.join(f.racineTest, '52_Revue', 'RV02_Redaction', '2027-09');
      ecrireAusgabe(ancienOk, 'titre: "Ok"\n');

      const { run, journal } = lancerMigration(f);
      assert.strictEqual(run.status, 0, 'un item bloqué a fait planter toute la migration : ' + run.stderr);

      // Le numéro bloqué n’a pas bougé : rien n’a été perdu.
      assert.ok(fs.existsSync(ancienBloque), 'la source bloquée a disparu sans avoir pu être déplacée');
      // Le numéro sain, lui, a bien été déplacé malgré l’échec de son voisin.
      const nouveauOk = path.join(f.racineTest, 'Revue', '2027-09');
      assert.ok(fs.existsSync(nouveauOk), 'un item sain n’a pas été déplacé alors qu’un autre échouait');
      assert.match(journal, /deplacement impossible|conflit/,
        'l’échec du déplacement bloqué n’a pas été journalisé');
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('la migration ne s’applique qu’au dossier de test, jamais à la production', () => {
  const source = fs.readFileSync(MIGRATION_PS1, 'utf8');
  assert.match(source, /Get-SzhBaseRevuesPour \$SzhEmplacementTest/,
    'Invoke-SzhMigrationArborescence ne se limite plus explicitement à la racine de test');
  assert.ok(source.indexOf('$SzhEmplacementProd') === -1,
    'la migration automatique référence la racine de production : elle ne devrait jamais la toucher');
});
