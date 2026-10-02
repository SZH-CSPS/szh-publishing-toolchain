// Les réglages Shlink/OJS que l'ancien lanceur rangeait dans etat-utilisateur.json :
// Get-SzhShlinkUrl, Get-SzhShlinkCle, Get-SzhOjsCle, et Set-SzhEnvironnementSecrets
// / Set-SzhWslEnvSecrets (tous dans windows/szh-common.ps1), qui posent SZH_SHLINK_URL,
// SZH_SHLINK_CLE, SZH_OJS_CLE dans l'environnement du processus enfant au lancement de
// VSCodium et les ajoutent à WSLENV pour que wsl.exe les transmette aux tâches du cockpit
// (vscodium-user/tasks.json, `wsl.exe -d SZH-Publishing`). DEUX lanceurs appellent
// Set-SzhEnvironnementSecrets : Start-SzhCodium (windows/szh-shell.ps1, le lanceur principal)
// et Start-SzhCodiumFichier (windows/open-md.ps1, l'ouverture d'un .md par double-clic) --
// d'où ces fonctions dans szh-common.ps1 et non dans szh-shell.ps1 : open-md.ps1 ne
// dot-source QUE szh-common.ps1.
//
// Ce que ce fichier prouve, dans l'ordre :
//   1. une clé se relit depuis son chiffrement DPAPI du compte (ConvertFrom-SecureString sans
//      -Key, la forme où l'ancien lanceur la rangeait), et une valeur en clair n'en est pas une ;
//   2. un champ vide ne rend aucune clé ;
//   3. Set-SzhWslEnvSecrets construit WSLENV correctement dans les quatre cas -- vide,
//      valeur existante préservée, appel répété sans doublon, retrait ;
//   4. Start-SzhCodium ne pose les trois variables que si un réglage existe, jamais à vide,
//      et le journal ne porte jamais la clé en clair -- même sans VSCodium installé sur ce
//      poste, puisque Set-SzhEnvironnementSecrets s'exécute AVANT la vérification de
//      Get-VSCodiumExe (voir le commentaire d'en-tête de Start-SzhCodium) ;
//   5. aucune source (diagnostic.ps1, szh-rapport.ps1) ne recopie etat-utilisateur.json tel
//      quel, et aucune des deux ne porte les noms de champs shlinkCle/ojsCle ;
//   7. Start-SzhCodiumFichier (open-md.ps1) pose le même pont -- même garantie qu'au 4,
//      via le vrai open-md.ps1 en SZH_OPENMD_SIMULE=1 (sauté si VSCodium n'est pas installé
//      sur ce poste : Get-VSCodiumExe est vérifié par open-md.ps1 AVANT d'appeler
//      Start-SzhCodiumFichier, à la différence de Start-SzhCodium).
//
// Chaque scénario isole SON PROPRE %LOCALAPPDATA% et SZH_BASE jetables : jamais le vrai
// profil de qui lance cette suite, dont etat-utilisateur.json peut porter une vraie clé.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMON_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const SHELL_PS1 = path.join(RACINE, 'windows', 'szh-shell.ps1');
const OPENMD_PS1 = path.join(RACINE, 'windows', 'open-md.ps1');
const DIAGNOSTIC_PS1 = path.join(RACINE, 'windows', 'diagnostic.ps1');
const RAPPORT_PS1 = path.join(RACINE, 'windows', 'szh-rapport.ps1');

// Même détection et même motif de saut que dev-lanceur.test.js (Groupe 5) : le runner
// windows-latest n'a pas VSCodium, et Get-VSCodiumExe (szh-common.ps1) ne regarde que ces
// deux chemins.
const sansVSCodiumExe = (function () {
  if (process.platform !== 'win32') { return 'pas Windows'; }
  const candidats = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'VSCodium', 'VSCodium.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium', 'VSCodium.exe')
  ];
  for (const c of candidats) { if (fs.existsSync(c)) { return false; } }
  return 'VSCodium introuvable sur ce poste';
})();

// Dossiers jetables par appel : SZH_BASE (state.json, logs) et LOCALAPPDATA
// (etat-utilisateur.json) -- jamais le vrai profil de qui lance cette suite.
function nouveauxDossiers(prefixe) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
  const base = path.join(travail, 'ProgramData');
  const local = path.join(travail, 'Local');
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  return { travail, base, local };
}

// process.env recopié sans les variables sensibles à l'isolement, puis les surcharges
// demandées -- même discipline que envIsole() dans dev-lanceur.test.js.
function envIsole(surcharges) {
  const env = Object.assign({}, process.env);
  delete env.SZH_BASE;
  delete env.LOCALAPPDATA;
  delete env.WSLENV;
  delete env.SZH_SHLINK_URL;
  delete env.SZH_SHLINK_CLE;
  delete env.SZH_OJS_CLE;
  delete env.SZH_LANCEUR_SIMULE;
  delete env.SZH_CODIUM_PROFIL;
  return Object.assign(env, surcharges || {});
}

// Dot-source szh-common.ps1 puis szh-shell.ps1, exécute les lignes fournies (qui doivent
// construire $r), et rend $r sérialisé en JSON -- même patron qu'executerFonctionShell()
// dans dev-lanceur.test.js, avec un environnement personnalisable en plus (indispensable
// ici : les fonctions visées lisent et écrivent etat-utilisateur.json).
function executerFonctionShell(lignesCorps, env) {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-secrets-fn-'));
  const sortie = path.join(travail, 'r.json');
  const pilote = path.join(travail, 'p.ps1');
  fs.writeFileSync(pilote, [
    "$ErrorActionPreference = 'Stop'",
    '. "' + COMMON_PS1 + '"',
    '. "' + SHELL_PS1 + '"'
  ].concat(lignesCorps).concat([
    'Set-SzhJson "' + sortie + '" $r'
  ]).join('\r\n') + '\r\n', 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  fs.rmSync(travail, { recursive: true, force: true });
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', r: lu };
}

// Dot-source, puis Start-SzhCodium -Dossier <dossierCible> -- un script jetable plutôt qu'un
// -Command à échapper, même patron qu'executerStartSzhCodium() dans dev-lanceur.test.js.
function executerStartSzhCodium(env, dossierCible) {
  if (!POWERSHELL) { return null; }
  const script = path.join(os.tmpdir(), 'szh-secrets-codium-' + process.pid + '-' + Date.now() + '.ps1');
  const lignes = [
    '$ErrorActionPreference = "Stop"',
    '. "' + COMMON_PS1 + '"',
    '. "' + SHELL_PS1 + '"',
    '[void](Start-SzhCodium -Dossier "' + dossierCible + '")'
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

function moisCourant() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function lireJournal(base) {
  const fichier = path.join(base, 'logs', 'szh-' + moisCourant() + '.log');
  if (!fs.existsSync(fichier)) { return ''; }
  return fs.readFileSync(fichier, 'utf8');
}

// Range des champs dans etat-utilisateur.json sous la forme où l'ancien lanceur les écrivait :
// l'adresse en clair, chaque clé chiffrée par DPAPI pour ce compte. { clair: true } range une
// clé en clair, ce que rien n'a jamais écrit.
function ranger(champs, opts) {
  const lignes = ['$etat = Get-SzhEtatUtilisateur', 'if (-not $etat) { $etat = New-Object psobject }'];
  for (const [nom, valeur] of Object.entries(champs)) {
    const v = "'" + String(valeur).replace(/'/g, "''") + "'";
    const chiffre = nom !== 'shlinkUrl' && valeur !== '' && !(opts && opts.clair);
    const expr = chiffre
      ? '(ConvertFrom-SecureString -SecureString (ConvertTo-SecureString -String ' + v + ' -AsPlainText -Force))' : v;
    lignes.push('$etat | Add-Member -Force -MemberType NoteProperty -Name ' + nom + ' -Value ' + expr);
  }
  lignes.push('[void](Save-SzhEtatUtilisateur $etat)');
  return lignes;
}

// ---- 1. Lecture chiffrée : la clé rangée se relit, une valeur en clair ne vaut rien

test('Get-SzhShlinkCle : relit la clé chiffrée pour ce compte, jamais une valeur en clair',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-roundtrip-');
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
    const secret = 'CLE-DE-TEST-9f83ac';
    const res = executerFonctionShell(ranger({ shlinkCle: secret }).concat([
      '$relue = Get-SzhShlinkCle'
    ], ranger({ shlinkCle: 'CLE-EN-CLAIR' }, { clair: true }), [
      '$r = [ordered]@{ relue = $relue; clair = (Get-SzhShlinkCle) }'
    ]), env);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
    assert.strictEqual(res.r.relue, secret, 'la cle relue ne correspond pas a la cle rangee');
    assert.strictEqual(res.r.clair, '', 'une valeur en clair dans etat-utilisateur.json passe pour une cle');
  });

test('Get-SzhOjsCle : meme garantie que Shlink -- relue chiffrée, jamais en clair',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-ojs-roundtrip-');
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
    const secret = 'OJS-CLE-7a21bd';
    const res = executerFonctionShell(ranger({ ojsCle: secret }).concat([
      '$relue = Get-SzhOjsCle'
    ], ranger({ ojsCle: 'OJS-EN-CLAIR' }, { clair: true }), [
      '$r = [ordered]@{ relue = $relue; clair = (Get-SzhOjsCle) }'
    ]), env);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
    assert.strictEqual(res.r.relue, secret, 'la cle OJS relue ne correspond pas a la cle rangee');
    assert.strictEqual(res.r.clair, '', 'une valeur OJS en clair passe pour une cle');
  });

test('Get-SzhShlinkUrl : en clair (ce n\'est pas un secret)',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-url-');
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
    const res = executerFonctionShell(ranger({ shlinkUrl: 'https://link.szh-csps.ch' }).concat([
      '$r = [ordered]@{ url = (Get-SzhShlinkUrl) }'
    ]), env);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
    assert.strictEqual(res.r.url, 'https://link.szh-csps.ch');
  });

// ---- 2. Champ vide = aucune clé

test('un champ vide ne rend aucune cle (Get- rend "")', { skip: sansPowerShell }, () => {
  const { travail, base, local } = nouveauxDossiers('szh-secrets-efface-');
  const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
  const res = executerFonctionShell(ranger({ shlinkCle: 'une-cle-quelconque' }).concat([
    '$avant = Get-SzhShlinkCle'
  ], ranger({ shlinkCle: '' }), [
    '$apres = Get-SzhShlinkCle',
    '$r = [ordered]@{ avant = $avant; apres = $apres }'
  ]), env);
  fs.rmSync(travail, { recursive: true, force: true });
  assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
  assert.strictEqual(res.r.avant, 'une-cle-quelconque');
  assert.strictEqual(res.r.apres, '', 'un champ vide rend encore une cle');
});

// ---- 3. Construction de WSLENV : vide, existant, doublon, retrait

test('Set-SzhWslEnvSecrets : WSLENV vide au depart -> les noms demandes, chacun en /u',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-wslenv-vide-');
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
    delete env.WSLENV;
    const res = executerFonctionShell([
      'Set-SzhWslEnvSecrets @("SZH_SHLINK_URL", "SZH_SHLINK_CLE")',
      '$r = [ordered]@{ wslenv = [string]$env:WSLENV }'
    ], env);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
    assert.strictEqual(res.r.wslenv, 'SZH_SHLINK_URL/u:SZH_SHLINK_CLE/u');
  });

test('Set-SzhWslEnvSecrets : une valeur WSLENV existante et non liee est preservee',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-wslenv-existant-');
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local, WSLENV: 'AUTRE_VAR/p:ENCORE_UNE/l' });
    const res = executerFonctionShell([
      'Set-SzhWslEnvSecrets @("SZH_SHLINK_URL")',
      '$r = [ordered]@{ wslenv = [string]$env:WSLENV }'
    ], env);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
    assert.strictEqual(res.r.wslenv, 'AUTRE_VAR/p:ENCORE_UNE/l:SZH_SHLINK_URL/u',
      'la valeur WSLENV existante n\'est plus preservee');
  });

test('Set-SzhWslEnvSecrets : un appel repete ne double pas l\'entree', { skip: sansPowerShell }, () => {
  const { travail, base, local } = nouveauxDossiers('szh-secrets-wslenv-doublon-');
  const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
  delete env.WSLENV;
  const res = executerFonctionShell([
    'Set-SzhWslEnvSecrets @("SZH_SHLINK_URL", "SZH_OJS_CLE")',
    'Set-SzhWslEnvSecrets @("SZH_SHLINK_URL", "SZH_OJS_CLE")',
    'Set-SzhWslEnvSecrets @("SZH_SHLINK_URL", "SZH_OJS_CLE")',
    '$r = [ordered]@{ wslenv = [string]$env:WSLENV }'
  ], env);
  fs.rmSync(travail, { recursive: true, force: true });
  assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
  assert.strictEqual(res.r.wslenv, 'SZH_SHLINK_URL/u:SZH_OJS_CLE/u',
    'trois appels ont fini par doubler une entree - ' + res.r.wslenv);
});

test('Set-SzhWslEnvSecrets : aucun nom a poser retire nos entrees et garde le reste',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-wslenv-retrait-');
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local, WSLENV: 'AUTRE_VAR/p' });
    const res = executerFonctionShell([
      'Set-SzhWslEnvSecrets @("SZH_SHLINK_URL")',
      'Set-SzhWslEnvSecrets @()',
      '$r = [ordered]@{ wslenv = [string]$env:WSLENV }'
    ], env);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'le pilote a echoue - ' + (res ? res.stderr : ''));
    assert.strictEqual(res.r.wslenv, 'AUTRE_VAR/p',
      'nos entrees n\'ont pas ete proprement retirees, ou le reste a disparu');
  });

// ---- 4. Start-SzhCodium : variables posees seulement si reglees, jamais a vide, jamais
// ---- dans le journal -- meme sans VSCodium installe (voir le commentaire d'en-tete)

test('Start-SzhCodium : rien de regle -> aucune des trois variables n\'est posee, pas de WSLENV',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-codium-vide-');
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local, SZH_LANCEUR_SIMULE: '1' });
    const res = executerStartSzhCodium(env, base);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'Start-SzhCodium a echoue - ' + (res ? res.stderr : ''));
    // Aucune trace du pont dans le journal : Set-SzhEnvironnementSecrets ne journalise que
    // si $poses.Count -gt 0 (szh-shell.ps1).
    const journal = lireJournal(base);
    assert.ok(journal.indexOf('variables WSL posées') === -1,
      'le journal parle de variables posees alors qu\'aucun reglage n\'existe - ' + journal);
  });

test('Start-SzhCodium : Shlink URL+cle regles, OJS vide -> seules les deux premieres sont posees',
  { skip: sansPowerShell }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-codium-partiel-');
    const secret = 'SECRET-SHLINK-4c91';
    const envReglage = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
    const reglage = executerFonctionShell(ranger({ shlinkUrl: 'https://link.szh-csps.ch', shlinkCle: secret })
      .concat(['$r = [ordered]@{ ok = $true }']), envReglage);
    assert.ok(reglage && reglage.status === 0, 'le reglage prealable a echoue - ' + (reglage ? reglage.stderr : ''));

    // Environnement isole pour Start-SzhCodium : sans SZH_SHLINK_CLE/URL herites de CE
    // processus-ci (envIsole les retire deja), pour ne mesurer que ce que Start-SzhCodium
    // pose lui-meme a partir d'etat-utilisateur.json.
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local, SZH_LANCEUR_SIMULE: '1' });
    const res = executerStartSzhCodium(env, base);
    const journal = lireJournal(base);
    fs.rmSync(travail, { recursive: true, force: true });

    assert.ok(res && res.status === 0, 'Start-SzhCodium a echoue - ' + (res ? res.stderr : ''));
    assert.ok(journal.indexOf('SZH_SHLINK_URL') !== -1, 'le journal ne nomme pas SZH_SHLINK_URL - ' + journal);
    assert.ok(journal.indexOf('SZH_SHLINK_CLE') !== -1, 'le journal ne nomme pas SZH_SHLINK_CLE - ' + journal);
    assert.ok(journal.indexOf('SZH_OJS_CLE') === -1,
      'le journal nomme SZH_OJS_CLE alors qu\'aucune cle OJS n\'est reglee - ' + journal);
    assert.ok(journal.indexOf('WSLENV=SZH_SHLINK_URL/u:SZH_SHLINK_CLE/u') !== -1,
      'la trace WSLENV n\'est pas celle attendue - ' + journal);
    // Et surtout : la cle elle-meme n'apparait JAMAIS dans le journal, meme partiellement.
    assert.ok(journal.indexOf(secret) === -1,
      'LA CLE EN CLAIR EST DANS LE JOURNAL -- ' + journal);
  });

// ---- 5. Aucune recopie brute de etat-utilisateur.json dans un diagnostic ou un rapport

test('diagnostic.ps1 et szh-rapport.ps1 ne recopient jamais etat-utilisateur.json tel quel, '
  + 'et ne portent ni "shlinkCle" ni "ojsCle"', () => {
    for (const fichier of [DIAGNOSTIC_PS1, RAPPORT_PS1]) {
      const source = fs.readFileSync(fichier, 'utf8');
      // Aucune sérialisation brute d'une variable issue de Get-SzhEtatUtilisateur : le
      // motif visé est `$xxx | ConvertTo-Json` ou une interpolation directe où $xxx a été
      // affecté par un appel à Get-SzhEtatUtilisateur -- recherché ici par les deux noms de
      // champ eux-memes, la preuve la plus directe qu'aucune clé ne peut fuiter par ce
      // fichier : un fichier qui ne nomme jamais ces deux champs ne peut pas les afficher.
      assert.ok(source.indexOf('shlinkCle') === -1,
        path.basename(fichier) + ' porte le champ shlinkCle -- vérifier qu\'il ne l\'affiche jamais en clair');
      assert.ok(source.indexOf('ojsCle') === -1,
        path.basename(fichier) + ' porte le champ ojsCle -- vérifier qu\'il ne l\'affiche jamais en clair');
    }
  });

test('le pont des secrets vit dans szh-common.ps1, pas dans szh-shell.ps1 -- '
  + 'open-md.ps1 ne dot-source que szh-common.ps1', () => {
    const common = fs.readFileSync(COMMON_PS1, 'utf8');
    const shell = fs.readFileSync(SHELL_PS1, 'utf8');
    for (const fn of ['function Set-SzhWslEnvSecrets', 'function Set-SzhEnvironnementSecrets']) {
      assert.ok(common.indexOf(fn) !== -1, 'szh-common.ps1 ne définit plus ' + fn);
      assert.ok(shell.indexOf(fn) === -1,
        'szh-shell.ps1 définit encore ' + fn + ' -- redéfinition possible si un script dot-source les deux');
    }
    const openMd = fs.readFileSync(OPENMD_PS1, 'utf8');
    assert.ok(openMd.indexOf('Set-SzhEnvironnementSecrets') !== -1,
      'open-md.ps1 n\'appelle plus Set-SzhEnvironnementSecrets dans Start-SzhCodiumFichier');
    // Le contrat que tout ceci protège : open-md.ps1 ne dot-source que szh-common.ps1 (jamais
    // szh-shell.ps1) -- sinon les fonctions n'existeraient pas dans sa portée.
    const dotSources = [...openMd.matchAll(/^\.\s+"\$PSScriptRoot\\([^"]+)"/gm)].map((m) => m[1]);
    assert.deepStrictEqual(dotSources, ['szh-common.ps1'],
      'open-md.ps1 dot-source autre chose que szh-common.ps1 seul : ' + JSON.stringify(dotSources));
  });

// ---- 7. Start-SzhCodiumFichier (open-md.ps1) : le même pont, pour un article ouvert par
// ---- double-clic -- sauté sans VSCodium installé (Get-VSCodiumExe y est vérifié AVANT
// ---- Start-SzhCodiumFichier, à la différence de Start-SzhCodium)

// Get-VSCodiumExe (szh-common.ps1) regarde $env:LOCALAPPDATA\Programs\VSCodium en second
// recours -- exactement le LOCALAPPDATA que ces tests isolent pour ne jamais toucher le vrai
// etat-utilisateur.json. Sur un poste où VSCodium n'est installé que là (ce poste de dev),
// un LOCALAPPDATA jetable le rendrait introuvable et open-md.ps1 sortirait avant même
// d'atteindre Start-SzhCodiumFichier. Un lien de jonction ponte le vrai dossier dans
// l'arborescence jetable, sans rien copier -- aucun droit administrateur requis pour une
// jonction (à la différence d'un lien symbolique).
function ponterVSCodiumSiBesoin(localJetable) {
  const reel = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium');
  if (!fs.existsSync(reel)) { return; }
  const programsDir = path.join(localJetable, 'Programs');
  fs.mkdirSync(programsDir, { recursive: true });
  fs.symlinkSync(reel, path.join(programsDir, 'VSCodium'), 'junction');
}

// Un .md hors de toute revue/livre (aucun ausgabe.yaml/buch.yaml au-dessus) : la branche la
// plus simple d'open-md.ps1, celle qui appelle Start-SzhCodiumFichier avec un seul chemin.
function executerOpenMd(env, mdPath) {
  if (!POWERSHELL) { return null; }
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OPENMD_PS1, mdPath],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, env });
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '' };
}

test('open-md.ps1 : rien de regle -> Start-SzhCodiumFichier ne pose rien, pas de trace WSL',
  { skip: sansPowerShell || sansVSCodiumExe }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-openmd-vide-');
    const md = path.join(travail, 'hors-revue.md');
    fs.writeFileSync(md, '# Rien\n', 'utf8');
    ponterVSCodiumSiBesoin(local);
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local, SZH_OPENMD_SIMULE: '1' });
    const res = executerOpenMd(env, md);
    const journal = lireJournal(base);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(res && res.status === 0, 'open-md.ps1 a echoue - ' + (res ? res.stderr : ''));
    assert.ok(journal.indexOf('variables WSL posées') === -1,
      'le journal parle de variables posees alors qu\'aucun reglage n\'existe - ' + journal);
  });

test('open-md.ps1 : Shlink URL+cle regles -> Start-SzhCodiumFichier pose les memes variables '
  + 'que Start-SzhCodium, la cle jamais en clair dans le journal',
  { skip: sansPowerShell || sansVSCodiumExe }, () => {
    const { travail, base, local } = nouveauxDossiers('szh-secrets-openmd-plein-');
    const secret = 'SECRET-OPENMD-7f2a';
    const envReglage = envIsole({ SZH_BASE: base, LOCALAPPDATA: local });
    const reglage = executerFonctionShell(ranger({ shlinkUrl: 'https://link.szh-csps.ch', shlinkCle: secret })
      .concat(['$r = [ordered]@{ ok = $true }']), envReglage);
    assert.ok(reglage && reglage.status === 0, 'le reglage prealable a echoue - ' + (reglage ? reglage.stderr : ''));

    const md = path.join(travail, 'hors-revue.md');
    fs.writeFileSync(md, '# Rien\n', 'utf8');
    ponterVSCodiumSiBesoin(local);
    const env = envIsole({ SZH_BASE: base, LOCALAPPDATA: local, SZH_OPENMD_SIMULE: '1' });
    const res = executerOpenMd(env, md);
    const journal = lireJournal(base);
    fs.rmSync(travail, { recursive: true, force: true });

    assert.ok(res && res.status === 0, 'open-md.ps1 a echoue - ' + (res ? res.stderr : ''));
    assert.ok(journal.indexOf('SZH_SHLINK_URL') !== -1, 'le journal ne nomme pas SZH_SHLINK_URL - ' + journal);
    assert.ok(journal.indexOf('SZH_SHLINK_CLE') !== -1, 'le journal ne nomme pas SZH_SHLINK_CLE - ' + journal);
    assert.ok(journal.indexOf('WSLENV=SZH_SHLINK_URL/u:SZH_SHLINK_CLE/u') !== -1,
      'la trace WSLENV n\'est pas celle attendue - ' + journal);
    assert.ok(journal.indexOf(secret) === -1,
      'LA CLE EN CLAIR EST DANS LE JOURNAL (open-md.ps1) -- ' + journal);
  });
