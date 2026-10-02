// L'entrée de production « Pronto » (windows/open-revue.ps1) ouvre VSCodium sur l'Accueil du
// cockpit, par Start-SzhAccueil (windows/szh-shell.ps1), que pronto-dev.ps1 appelle aussi.
// Tout passe par le mode simulé : rien n'est lancé, et le poste est jetable (ancrage, base,
// rapports, racines et LOCALAPPDATA détournés), pour que le check-in n'écrive jamais sur le
// vrai dossier partagé.
//
//   node --test test/js/accueil-demarrage.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const OUVRIR_REVUE = path.join(RACINE, 'windows', 'open-revue.ps1');
const PRONTO_DEV = path.join(RACINE, 'outils-dev', 'pronto-dev.ps1');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const VERSION_COCKPIT = JSON.parse(fs.readFileSync(path.join(COCKPIT, 'package.json'), 'utf8')).version;
const TACHES = ['Initialize-SzhAncrage', 'Clear-SzhRapportsEnAttente', 'Invoke-SzhCheckin',
  'Invoke-SzhEpinglageHorsLigne', 'Initialize-SzhEmplacementsTest', 'Set-SzhEnvironnementSecrets'];

function moisCourant() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Un poste jetable, et l'environnement qui le désigne. Les variables du poste qui feraient
// viser la production ou le dev sont retirées.
function posteJetable(surcharges) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-accueil-dem-'));
  const d = (...n) => { const p = path.join(t, ...n); fs.mkdirSync(p, { recursive: true }); return p; };
  const env = Object.assign({}, process.env, {
    SZH_LANCEUR_SIMULE: '1', SZH_BASE: d('ProgramData'), SZH_ANCRAGE: d('sp', 'Daten_Allgemein - General'),
    SZH_RAPPORTS: d('rapports'), SZH_RACINE_PROD: d('prod'), SZH_RACINE_TEST: d('test'), LOCALAPPDATA: d('local')
  });
  for (const v of ['SZH_CODIUM_PROFIL', 'SZH_COCKPIT_DOSSIER', 'SZH_ACCUEIL', 'SZH_ONGLET', 'ELECTRON_RUN_AS_NODE']) { delete env[v]; }
  Object.assign(env, surcharges || {});
  return { t, env, d };
}

function lancer(script, args, poste) {
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script].concat(args || []),
    { encoding: 'utf8', windowsHide: true, timeout: 120000, env: poste.env });
  let sortie = null;
  try { sortie = JSON.parse(String(run.stdout || '').trim()); } catch (e) { /* rapporté par le test */ }
  const journal = path.join(poste.env.SZH_BASE, 'logs', 'szh-' + moisCourant() + '.log');
  return { status: run.status, stdout: run.stdout || '', stderr: run.stderr || '', sortie,
    journal: fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8') : '' };
}

function avecPoste(surcharges, f) {
  const poste = posteJetable(surcharges);
  try { return f(poste); } finally { fs.rmSync(poste.t, { recursive: true, force: true }); }
}

// Un cockpit d'une version donnée, ou un dossier vide.
function cockpitFactice(poste, version) {
  const dossier = poste.d('cockpit-' + (version || 'absent'));
  if (version) { fs.writeFileSync(path.join(dossier, 'package.json'), JSON.stringify({ name: 'szh-cockpit', version })); }
  return dossier;
}

const SANS_ARGUMENT = POWERSHELL
  ? avecPoste({ SZH_COCKPIT_DOSSIER: COCKPIT }, (p) => lancer(OUVRIR_REVUE, [], p)) : null;
const DEV = POWERSHELL
  ? avecPoste({}, (p) => {
    const r = lancer(PRONTO_DEV, ['-BaseDev', path.join(p.t, 'SZH-dev'), '-Menu', path.join(p.t, 'menu')], p);
    return Object.assign(r, { baseDev: path.join(p.t, 'SZH-dev') });
  }) : null;

test('open-revue.ps1 sans argument : VSCodium en -n, sans dossier ni profil, après les six tâches',
  { skip: sansPowerShell }, () => {
    const r = SANS_ARGUMENT;
    assert.strictEqual(r.status, 0, r.stderr + r.stdout.slice(0, 400));
    assert.ok(r.sortie, 'aucun plan JSON : ' + r.stdout.slice(0, 400));
    assert.strictEqual(r.sortie.entree, 'accueil');
    assert.deepStrictEqual(r.sortie.arguments, ['-n'], 'un dossier ou un profil se serait ouvert');
    assert.deepStrictEqual(r.sortie.taches, TACHES);
    assert.strictEqual(r.sortie.cockpit, VERSION_COCKPIT);
    assert.ok(!Object.prototype.hasOwnProperty.call(r.sortie, 'produit'), 'le lanceur WinForms a répondu');
  });

test('pronto-dev.ps1 et open-revue.ps1 lancent les mêmes tâches, dans le même ordre',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(DEV.status, 0, DEV.stderr + DEV.stdout.slice(0, 400));
    assert.ok(DEV.sortie && SANS_ARGUMENT.sortie, 'un des deux plans manque');
    assert.strictEqual(DEV.sortie.entree, 'accueil');
    assert.deepStrictEqual(DEV.sortie.taches, SANS_ARGUMENT.sortie.taches);
    // Le profil de dev, puis la même fenêtre neuve sans dossier.
    const a = DEV.sortie.arguments;
    assert.strictEqual(a.length, 3, JSON.stringify(a));
    assert.strictEqual(a[0], '--user-data-dir "' + path.join(DEV.baseDev, 'codium', 'data') + '"');
    assert.strictEqual(a[1], '--extensions-dir "' + path.join(DEV.baseDev, 'codium', 'extensions') + '"');
    assert.strictEqual(a[2], '-n');
    assert.strictEqual(DEV.sortie.cockpit, VERSION_COCKPIT, 'le dev ne lit pas le cockpit du dépôt');
  });

test('un cockpit trop ancien ou absent : refus ACCUEIL-COCKPIT-ABSENT, sans tâches ni lancement',
  { skip: sansPowerShell }, () => {
    for (const version of ['0.73.0', '']) {
      avecPoste({}, (p) => {
        p.env.SZH_COCKPIT_DOSSIER = cockpitFactice(p, version);
        const r = lancer(OUVRIR_REVUE, [], p);
        assert.strictEqual(r.status, 1, 'cockpit « ' + version + ' » : ' + r.stdout.slice(0, 300));
        assert.ok(r.sortie, 'aucun verdict JSON : ' + r.stdout.slice(0, 300) + r.stderr);
        assert.strictEqual(r.sortie.refus, 'ACCUEIL-COCKPIT-ABSENT');
        assert.strictEqual(r.sortie.cockpit, version);
        assert.ok(!r.sortie.arguments && !r.sortie.taches, 'VSCodium serait lancé quand même');
        assert.ok(r.journal.indexOf('demarrage : ancrage') === -1, 'les tâches ont tourné avant le refus');
      });
    }
  });

test('la version du cockpit se lit dans le profil, sans les extensions marquées obsolètes',
  { skip: sansPowerShell }, () => {
    avecPoste({}, (p) => {
      const profil = p.d('profil');
      const ext = p.d('profil', 'extensions');
      for (const v of ['0.73.0', '0.74.1']) {
        const dossier = p.d('profil', 'extensions', 'szh-csps.szh-cockpit-' + v);
        fs.writeFileSync(path.join(dossier, 'package.json'), JSON.stringify({ version: v }));
      }
      const sortie = path.join(p.t, 'versions.json');
      const pilote = path.join(p.t, 'lire.ps1');
      fs.writeFileSync(pilote, [
        "$ErrorActionPreference = 'Stop'",
        '. "' + COMMUN_PS1 + '"',
        '$r = [ordered]@{ deux = (Get-SzhVersionCockpit) }',
        "Set-Content -LiteralPath (Join-Path $env:SZH_CODIUM_PROFIL 'extensions\\.obsolete') -Value '{\"szh-csps.szh-cockpit-0.74.1\":true}'",
        '$r.obsolete = (Get-SzhVersionCockpit)',
        '$r.min = $SzhCockpitAccueilMin',
        '$r.ok = @((Test-SzhCockpitAccueil $r.min), (Test-SzhCockpitAccueil \'0.73.9\'), (Test-SzhCockpitAccueil \'\'), (Test-SzhCockpitAccueil \'n.importe\'))',
        'Set-SzhJson $args[0] $r'
      ].join('\r\n') + '\r\n', 'utf8');
      p.env.SZH_CODIUM_PROFIL = profil;
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, sortie],
        { encoding: 'utf8', windowsHide: true, timeout: 60000, env: p.env });
      assert.ok(fs.existsSync(sortie), 'pilote : ' + run.stderr);
      const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
      assert.ok(fs.existsSync(ext));
      assert.strictEqual(r.deux, '0.74.1', 'la plus haute version posée');
      assert.strictEqual(r.obsolete, '0.73.0', 'une extension marquée obsolète compte encore');
      assert.deepStrictEqual(r.ok, [true, false, false, false]);
      // Le minimum ne dépasse jamais la version livrée : sinon Pronto refuserait sa propre extension.
      const vers = (s) => s.split('.').map(Number);
      const [a, b] = [vers(r.min), vers(VERSION_COCKPIT)];
      assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]))),
        'minimum ' + r.min + ' au-dessus du cockpit livré ' + VERSION_COCKPIT);
    });
  });

test('un lien szh:// passe par Open-SzhLien, après les tâches de démarrage', { skip: sansPowerShell }, () => {
  avecPoste({}, (p) => {
    const r = lancer(OUVRIR_REVUE, ['szh://n-importe-quoi'], p);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.deepStrictEqual(r.sortie, { lien: 'szh://n-importe-quoi', erreur: 'invalide' });
    assert.ok(r.journal.indexOf('demarrage : ancrage SharePoint') !== -1, 'les tâches de démarrage n’ont pas tourné');
    assert.ok(r.journal.indexOf('accueil : ') === -1, 'l’Accueil a été lancé en plus du lien');
  });
});

test('-Versions ouvre le sélecteur seul : ni VSCodium, ni cockpit, ni tâches', { skip: sansPowerShell }, () => {
  avecPoste({}, (p) => {
    p.env.SZH_COCKPIT_DOSSIER = cockpitFactice(p, '');
    const r = lancer(OUVRIR_REVUE, ['-Versions'], p);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(r.sortie.versions, true);
    assert.ok(!r.sortie.refus, 'le sélecteur dépend du cockpit');
    assert.ok(r.journal.indexOf('demarrage : ancrage') === -1, 'les tâches de démarrage ont tourné');
  });
});

// Le lanceur WinForms n'est plus lancé par personne : open-produit.ps1 n'est plus appelé.
test('aucun script ni module n’appelle encore open-produit.ps1', () => {
  const fichiers = [];
  for (const d of ['windows', 'outils-dev']) {
    // open-produit.ps1 lui-même ne compte pas : son en-tête se cite.
    for (const n of fs.readdirSync(path.join(RACINE, d))) { if (/\.(ps1|vbs|cmd)$/.test(n) && n !== 'open-produit.ps1') { fichiers.push(path.join(d, n)); } }
  }
  for (const n of fs.readdirSync(path.join(COCKPIT, 'lib'))) { if (n.endsWith('.js')) { fichiers.push(path.join('vscodium-extension', 'szh-cockpit', 'lib', n)); } }
  fichiers.push(path.join('vscodium-extension', 'szh-cockpit', 'extension.js'));
  const appels = [];
  for (const f of fichiers) {
    const lignes = fs.readFileSync(path.join(RACINE, f), 'utf8').split(/\r?\n/);
    lignes.forEach((l, i) => {
      if (/open-produit\.ps1['"]\s*\)|-File\s+\S*open-produit\.ps1/.test(l) && !/^\s*#/.test(l)) { appels.push(f + ':' + (i + 1) + ' ' + l.trim()); }
    });
  }
  assert.deepStrictEqual(appels, []);
});
