// diagnostic.ps1 : trois défauts trouvés en revue, gardés ici.
//
//   node --test "test/js/*.test.js"
//
// 1. Branche morte (ligne ~102) : `if (-not $app.requis) { $etat = 'manque' }` recopiait
//    la valeur déjà posée juste au-dessus — les deux branches étaient identiques. SumatraPDF
//    porte `"requis": false` dans apps.lock (windows/apps.lock), et son absence doit se lire
//    au ton 'note', qui existe déjà (fonction Dire) mais n'était jamais atteint pour cette
//    application. Conséquence : un poste sans SumatraPDF — pourtant conforme, puisqu'il
//    n'est pas requis — ressortait avec `exit 1` comme n'importe quel vrai défaut.
//
// 2. Compte périmé (lignes ~196 et ~199) : les textes affichés au rédacteur disaient en dur
//    « 4 entrées » / « les 4 entrées », alors que Get-SzhRaccourcisMenu (szh-common.ps1) en
//    pose 5 depuis l'arrivée de « Books SZH-CSPS » (voir test/js/raccourcis.test.js, qui
//    l'affirme : `r.passe2.poses === 5`). Le chiffre est maintenant dérivé du tableau rendu
//    par Get-SzhRaccourcisMenu, pour qu'un sixième produit ne rende plus ce diagnostic faux
//    sans qu'aucune ligne n'ait besoin de changer ici.
//
// 3. Clés de registre en dur (lignes ~209 et ~214) : `SZH.Markdown` et le schéma `szh` sont
//    possédés et nommés par update.ps1 (Set-SzhProgIdMarkdown, Set-SzhProtocoleSzh), pas par
//    diagnostic.ps1. Aucune variable ni fonction de szh-common.ps1 ne les expose aujourd'hui ;
//    ce fichier n'a donc PAS été centralisé (une centralisation reste à faire — voir le
//    rapport de la tâche). Ce test garde à la place un commentaire ⚠ qui nomme update.ps1 et
//    les deux lignes où il faudrait regarder avant de renommer quoi que ce soit là-bas — et
//    vérifie, en relisant le VRAI update.ps1, que ces deux fonctions sont toujours où le
//    commentaire dit qu'elles sont.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const DIAG_PATH = path.join(RACINE, 'windows', 'diagnostic.ps1');
const DIAG = lire('windows', 'diagnostic.ps1');
const UPDATE = lire('windows', 'update.ps1');

// Une tranche du VRAI texte de diagnostic.ps1, entre deux motifs qui doivent tous deux
// exister : si l'un des deux disparaît, ce script a changé de forme et le test doit le dire
// plutôt que de continuer à éprouver un extrait qui ne correspond plus au fichier.
function tranche(source, debutMotif, finMotif) {
  const iDebut = source.indexOf(debutMotif);
  assert.ok(iDebut !== -1, 'motif de début introuvable dans diagnostic.ps1 : ' + debutMotif);
  const iFin = source.indexOf(finMotif, iDebut + debutMotif.length);
  assert.ok(iFin !== -1, 'motif de fin introuvable dans diagnostic.ps1 : ' + finMotif);
  return source.slice(iDebut, iFin);
}

function ligneContenant(source, motif) {
  const i = source.indexOf(motif);
  assert.ok(i !== -1, 'ligne introuvable dans diagnostic.ps1 : ' + motif);
  const finLigne = source.indexOf('\r\n', i);
  return source.slice(i, finLigne === -1 ? source.length : finLigne);
}

// ---- Contrats sur le texte source, sans rien exécuter ----

test('correctif 1 : la branche « pas requis » ne recopie plus la branche « requis »', () => {
  const bloc = tranche(DIAG, '$sujet = $app.nom', '\r\n  $v = ');
  // Les deux affectations à $etat doivent maintenant différer ; avant le correctif, la
  // seconde ligne écrivait 'manque' au lieu de 'note' et les deux étaient identiques.
  const lignesEtat = bloc.split('\r\n').filter((l) => l.indexOf('$etat = ') !== -1 || l.indexOf('$etat =') !== -1);
  assert.ok(lignesEtat.length >= 2, 'les deux affectations de $etat ont disparu du bloc');
  assert.ok(bloc.indexOf("$etat = 'manque'") !== -1, 'la branche par défaut doit rester « manque »');
  assert.ok(bloc.indexOf("if (-not $app.requis) { $etat = 'note' }") !== -1,
    'la branche « pas requis » doit passer $etat à \'note\', le ton que Dire sait déjà afficher sans faire échouer le diagnostic');
});

test('correctif 1 : le ton \'note\' n\'est pas compté dans le verdict final', () => {
  // $aReparer ne retient que 'manque' : c'est ce qui rend le correctif 1 sûr. S'il retenait
  // aussi 'note', passer SumatraPDF à ce ton n'aurait rien réparé.
  const ligne = ligneContenant(DIAG, '$aReparer = @($Bilan');
  assert.match(ligne, /Where-Object \{ \$_\.etat -eq 'manque' \}/,
    'le filtre du verdict a changé : vérifier qu\'il ne compte toujours que \'manque\'');
});

test('correctif 2 : plus de littéral « 4 entrées », le compte vient de Get-SzhRaccourcisMenu', () => {
  assert.ok(DIAG.indexOf('4 entrées') === -1,
    'diagnostic.ps1 porte encore un compte écrit en dur : ' + "'4 entrées'");
  assert.ok(DIAG.indexOf('les 4 entrées') === -1,
    'diagnostic.ps1 porte encore un compte écrit en dur : ' + "'les 4 entrées'");
  // Les deux textes affichés doivent tous deux se former avec -f à partir d'un .Count tiré
  // du tableau rendu par Get-SzhRaccourcisMenu — jamais un chiffre écrit à la main.
  assert.ok(DIAG.indexOf('$raccourcisMenu = @(Get-SzhRaccourcisMenu)') !== -1,
    'le tableau de raccourcis n\'est plus capturé dans une variable nommée');
  assert.match(DIAG, /'Raccourcis du menu Démarrer'\s*\(\s*'\{0\} entrées en place'\s*-f\s*\$raccourcisMenu\.Count\s*\)/);
  assert.match(DIAG, /'Icône dans la barre des tâches'\s*\(\s*'les \{0\} entrées portent leur identité'\s*-f\s*\$raccourcisMenu\.Count\s*\)/);
});

test('correctif 3 : les clés de registre restent en dur, mais un commentaire ⚠ nomme update.ps1 comme propriétaire', () => {
  const bloc = tranche(DIAG, '# ⚠ Ces deux chemins de registre', "\r\nif (Test-Path (Join-Path \$env:USERPROFILE '.wslconfig'))");
  assert.ok(bloc.indexOf('update.ps1') !== -1, 'le commentaire ne nomme plus update.ps1 comme propriétaire');
  assert.ok(bloc.indexOf('Set-SzhProgIdMarkdown') !== -1, 'le commentaire ne nomme plus Set-SzhProgIdMarkdown');
  assert.ok(bloc.indexOf('Set-SzhProtocoleSzh') !== -1, 'le commentaire ne nomme plus Set-SzhProtocoleSzh');
  assert.ok(bloc.indexOf('centralisation') !== -1,
    'le commentaire ne dit plus qu\'une centralisation reste à faire — sans quoi le prochain lecteur croira le sujet clos');
  // Les deux littéraux existent toujours : aucune fonction de szh-common.ps1 ne les nomme
  // aujourd'hui (vérifié à l'écriture de ce correctif), donc rien n'a été centralisé ici.
  assert.ok(bloc.indexOf('HKCU:\\Software\\Classes\\SZH.Markdown\\shell\\open\\command') !== -1);
  assert.ok(bloc.indexOf('HKCU:\\Software\\Classes\\szh\\shell\\open\\command') !== -1);
});

// La ligne de fonction PowerShell : de sa déclaration jusqu'à la première ligne qui n'est
// QUE « } » en colonne 0, la fermeture du top-level dans le style constant de ce dépôt
// (même méthode que test/js/orphelins-toolkit.test.js, dupliquée ici pour que ce fichier
// reste autonome). Rend des numéros de ligne 1-based, pour les comparer à ceux cités dans
// le commentaire ⚠ de diagnostic.ps1.
function bornesFonction(source, nom) {
  const lignes = source.split('\r\n');
  let debut = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].indexOf('function ' + nom) === 0) { debut = i; break; }
  }
  assert.ok(debut !== -1, 'fonction introuvable dans update.ps1 : ' + nom);
  let fin = -1;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (lignes[i] === '}') { fin = i; break; }
  }
  assert.ok(fin !== -1, 'fin de fonction introuvable dans update.ps1 : ' + nom);
  return { debut: debut + 1, fin: fin + 1 };
}

test('correctif 3 : les lignes citées (update.ps1:54-107 et 115-142) sont toujours les bonnes', () => {
  // Si update.ps1 bouge ces fonctions sans que quiconque ne relise ce commentaire, ce test
  // le dit — plutôt que de laisser une citation de lignes fausse orienter le prochain
  // lecteur vers le mauvais endroit du fichier.
  const reelProgId = bornesFonction(UPDATE, 'Set-SzhProgIdMarkdown');
  const reelProtocole = bornesFonction(UPDATE, 'Set-SzhProtocoleSzh');
  const bloc = tranche(DIAG, '# ⚠ Ces deux chemins de registre',
    "\r\nif (Test-Path (Join-Path \$env:USERPROFILE '.wslconfig'))");
  const citations = [...bloc.matchAll(/update\.ps1:(\d+)-(\d+)/g)].map(
    (m) => ({ debut: Number(m[1]), fin: Number(m[2]) }));
  assert.strictEqual(citations.length, 2, 'il faut une citation de lignes par fonction citée');
  assert.deepStrictEqual(citations[0], reelProgId,
    'la citation de Set-SzhProgIdMarkdown ne correspond plus à update.ps1');
  assert.deepStrictEqual(citations[1], reelProtocole,
    'la citation de Set-SzhProtocoleSzh ne correspond plus à update.ps1');
});

// ---- Les correctifs 1 et 2, réellement exécutés ----
// Windows seulement. Rien n'est écrit dans le vrai registre, la vraie tâche planifiée ou
// C:\ProgramData : les deux essais ci-dessous travaillent uniquement dans des dossiers
// jetables sous le dossier temporaire de l'utilisateur, jamais posés au sens du poste.

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

// Windows PowerShell 5.1 lit un .ps1 SANS BOM avec la page de code ANSI du poste, pas en
// UTF-8 : les accents des extraits ci-dessous (« à », « é », « ô »…) en ressortiraient
// mojibake sans ce préfixe (même remarque, et même geste, que test/js/orphelins-toolkit.test.js).
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\uFEFF' + contenu, 'utf8');
}

// ---- Correctif 1, en vrai : SumatraPDF (requis: false) vs une application requise ----

const BLOC_BILAN_DIRE = tranche(DIAG,
  '$script:Bilan = New-Object System.Collections.ArrayList', '\r\n\r\nWrite-SzhBanniere');
const BLOC_APPS = tranche(DIAG,
  "$verrouApps = Join-Path \$PSScriptRoot 'apps.lock'", '\r\n\r\n# wscript.exe porte les deux lanceurs');
const LIGNE_VERDICT = ligneContenant(DIAG, '$aReparer = @($Bilan');

const bilanApps = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-diagnostic-apps-'));
  // Deux sondes qui ne peuvent pas exister : un GUID dans %TEMP%, jamais posé par personne.
  const introuvableRequise = path.join(os.tmpdir(), 'szh-test-introuvable-' + process.pid + '-requise.exe');
  const introuvableFacultative = path.join(os.tmpdir(), 'szh-test-introuvable-' + process.pid + '-facultative.exe');
  const appsLock = {
    applications: [
      { nom: 'AppTestRequise', version: '9.9.9', sondes: [introuvableRequise], requis: true },
      { nom: 'AppTestFacultative', version: '9.9.9', sondes: [introuvableFacultative], requis: false }
    ]
  };
  fs.writeFileSync(path.join(travail, 'apps.lock'), JSON.stringify(appsLock), 'utf8');
  const pilote = path.join(travail, 'eprouver.ps1');
  const sortie = path.join(travail, 'bilan.json');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    BLOC_BILAN_DIRE,
    BLOC_APPS,
    LIGNE_VERDICT,
    '$sortie = $args[0]',
    '$json = [ordered]@{',
    '  bilan = @($Bilan | ForEach-Object { [ordered]@{ etat = $_.etat; sujet = $_.sujet } })',
    '  aReparerCount = @($aReparer).Count',
    '} | ConvertTo-Json -Depth 6',
    '[System.IO.File]::WriteAllText($sortie, $json, (New-Object System.Text.UTF8Encoding($false)))'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);
  // $PSScriptRoot est automatique et vaut le dossier du script exécuté par -File : c'est ce
  // qui fait lire l'apps.lock de ce dossier-jetable, pas le vrai windows/apps.lock du poste.
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, sortie],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('correctif 1, réellement exécuté : requis:false ressort en \'note\', requis:true en \'manque\'',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(bilanApps.status, 0, 'le pilote PowerShell a échoué : ' + bilanApps.stderr);
    const parApp = {};
    for (const e of bilanApps.r.bilan) { parApp[e.sujet] = e.etat; }
    assert.strictEqual(parApp.AppTestRequise, 'manque',
      'une application requise et absente doit toujours ressortir en \'manque\'');
    assert.strictEqual(parApp.AppTestFacultative, 'note',
      'une application non requise et absente doit ressortir en \'note\', pas en \'manque\'');
  });

test('correctif 1, réellement exécuté : le verdict final ne compte que l\'application requise',
  { skip: sansPowerShell }, () => {
    // C'est la preuve de bout en bout du correctif : SEULE l'application requise fait
    // grossir le compte qui décide de exit 0 / exit 1 (voir diagnostic.ps1:249-264).
    assert.strictEqual(bilanApps.r.aReparerCount, 1,
      'le verdict final compte l\'application facultative absente comme un défaut à réparer');
  });

// ---- Correctif 2, en vrai : le compte de raccourcis vient de Get-SzhRaccourcisMenu ----

const BLOC_RACCOURCIS = tranche(DIAG,
  '$absents = New-Object System.Collections.ArrayList',
  '\r\n\r\n# ⚠ Ces deux chemins de registre');

const bilanRaccourcis = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-diagnostic-raccourcis-'));
  const menu = path.join(travail, 'Programs');
  const sortie = path.join(travail, 'bilan.json');
  const pilote = path.join(travail, 'eprouver.ps1');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '. "' + COMMUN_PS1 + '"',
    BLOC_BILAN_DIRE,
    '$menu = $args[0]; $toolkitReel = $args[1]; $sortie = $args[2]',
    // Pose, dans un menu Démarrer jetable, les VRAIS raccourcis que rend Get-SzhRaccourcisMenu
    // pour ce dépôt — c'est ce qui rend $absents vide, et fait passer le bloc dans ses
    // branches 'ok', celles dont ce correctif change le texte.
    '$null = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkitReel',
    BLOC_RACCOURCIS,
    // Un second appel, indépendant de celui déjà capturé dans $raccourcisMenu par le bloc
    // ci-dessus : s'ils divergent, le compte affiché ne serait plus vraiment DÉRIVÉ de la
    // fonction, mais d'un état capturé une fois puis recopié.
    '$compteIndependant = @(Get-SzhRaccourcisMenu -Toolkit $toolkitReel).Count',
    '$json = [ordered]@{',
    '  raccourcisMenuCount = $raccourcisMenu.Count',
    '  compteIndependant = $compteIndependant',
    '  absentsCount = @($absents).Count',
    '  bilan = @($Bilan | ForEach-Object { [ordered]@{ etat = $_.etat; sujet = $_.sujet; detail = $_.detail } })',
    '} | ConvertTo-Json -Depth 6',
    '[System.IO.File]::WriteAllText($sortie, $json, (New-Object System.Text.UTF8Encoding($false)))'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    menu, RACINE, sortie],
  { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('correctif 2, réellement exécuté : aucun raccourci absent avec un menu complet', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilanRaccourcis.status, 0, 'le pilote PowerShell a échoué : ' + bilanRaccourcis.stderr);
  assert.strictEqual(bilanRaccourcis.r.absentsCount, 0,
    'Set-SzhRaccourcisMenu n\'a pas posé toutes les entrées attendues par Get-SzhRaccourcisMenu');
});

test('correctif 2, réellement exécuté : le compte affiché est celui, réel, de Get-SzhRaccourcisMenu',
  { skip: sansPowerShell }, () => {
    const r = bilanRaccourcis.r;
    assert.strictEqual(r.raccourcisMenuCount, r.compteIndependant,
      'le compte utilisé par le diagnostic a divergé d\'un second appel à Get-SzhRaccourcisMenu : il ne dérive plus de la fonction');
    const parSujet = {};
    for (const e of r.bilan) { parSujet[e.sujet] = e; }
    assert.strictEqual(parSujet['Raccourcis du menu Démarrer'].etat, 'ok');
    assert.strictEqual(parSujet['Raccourcis du menu Démarrer'].detail,
      r.raccourcisMenuCount + ' entrées en place');
    assert.strictEqual(parSujet['Icône dans la barre des tâches'].etat, 'ok');
    assert.strictEqual(parSujet['Icône dans la barre des tâches'].detail,
      'les ' + r.raccourcisMenuCount + ' entrées portent leur identité');
  });
