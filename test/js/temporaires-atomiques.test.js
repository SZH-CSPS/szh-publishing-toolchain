// Les fichiers temporaires des écritures atomiques : leur NOM, et leur disparition quand
// l'écriture échoue.
//
//   node --test test/js/temporaires-atomiques.test.js
//   node --test "test/js/*.test.js"
//
// Le défaut que ce banc garde est un défaut de SYNCHRONISATION, pas de correction : les deux
// écrivains de rapports d'erreur — ecrireJsonAtomique / ecrireRapportSurDisque
// (lib/rapport-erreur.js) et Write-SzhRapportSurDisque (windows/szh-rapport.ps1) — écrivaient
// bien leur fichier, mais :
//
//   * ils nommaient leur temporaire « <cible>.tmp-… », SANS le préfixe « ~$ » que le reste du
//     dépôt emploie précisément parce que OneDrive l'IGNORE. Chaque écriture faisait donc
//     voyager un fichier de plus vers tous les postes ;
//   * ni l'un ni l'autre ne supprimait ce temporaire quand l'écriture échouait — il manquait
//     un `finally` côté JavaScript, et côté PowerShell l'exception était avalée sans rien
//     nettoyer. Les orphelins s'accumulaient dans le dossier PARTAGÉ, donc sur tous les
//     postes à la fois.
//
// Aucun de ces deux défauts ne se voit dans le résultat d'une écriture réussie : il faut
// observer le NOM du temporaire pendant l'écriture, et faire ÉCHOUER le renommage pour voir
// ce qui reste derrière. C'est ce que font les tests ci-dessous.
//
// Rien ici ne touche le vrai dossier SharePoint : tout se passe dans des dossiers jetables.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const RAPPORT_PS1 = path.join(RACINE, 'windows', 'szh-rapport.ps1');
const SOURCE_RAPPORT_PS = fs.readFileSync(RAPPORT_PS1, 'utf8');

const rapportErreur = require(path.join(COCKPIT, 'lib', 'rapport-erreur'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml'));

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

function jetable(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }

// ---------------------------------------------------------------------------------------
// 1. Le nom du temporaire, observé pendant l'écriture
// ---------------------------------------------------------------------------------------
//
// lib/rapport-erreur.js requiert `fs` comme ce banc : c'est le MÊME objet. Remplacer
// writeFileSync le temps d'un appel donne donc le chemin réel que le module a choisi, sans
// rien deviner de sa source.
function espionnerEcriture() {
  const vus = [];
  const vrai = fs.writeFileSync;
  fs.writeFileSync = function (chemin) {
    vus.push(String(chemin));
    return vrai.apply(fs, arguments);
  };
  return { vus: vus, rendre: () => { fs.writeFileSync = vrai; } };
}

const CHAMPS_MINIMAUX = {
  gravite: 'erreur', source: 'cockpit', code: 'COCKPIT-EXCEPTION',
  etape: 'essai', message: 'un message sans secret'
};

// SZH_RAPPORTS nomme directement le dossier d'écriture, SZH_BASE et LOCALAPPDATA tiennent
// lieu de C:\ProgramData\SZH et de l'état par compte : rien ne sort du dossier jetable.
function avecSandbox(travail, fn) {
  const avant = {
    SZH_RAPPORTS: process.env.SZH_RAPPORTS,
    SZH_BASE: process.env.SZH_BASE,
    LOCALAPPDATA: process.env.LOCALAPPDATA
  };
  process.env.SZH_RAPPORTS = path.join(travail, 'rapports');
  process.env.SZH_BASE = path.join(travail, 'ProgramData');
  process.env.LOCALAPPDATA = path.join(travail, 'Local');
  try { return fn(process.env.SZH_RAPPORTS); } finally {
    for (const cle of Object.keys(avant)) {
      if (avant[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = avant[cle]; }
    }
  }
}

test('cockpit : le temporaire vit à côté de sa cible, préfixé « ~$ », et n’est jamais un .json', () => {
  const cible = path.join('C:', 'dossier', 'rapports', 'abc123.json');
  const compose = rapportErreur.cheminTemporaire(cible);
  assert.strictEqual(path.dirname(compose), path.dirname(cible),
    'le temporaire doit vivre dans LE MÊME dossier que sa cible : un renommage n’est '
    + 'atomique qu’à l’intérieur d’un volume');
  assert.ok(path.basename(compose).startsWith('~$'),
    'le temporaire ne porte pas le préfixe « ~$ », le seul que OneDrive ignore : '
    + path.basename(compose));
  assert.ok(!compose.endsWith('.json'),
    'un temporaire qui finit par « .json » serait listé comme un rapport en attente');
  // Deux écritures simultanées (deux fenêtres de l'éditeur) ne doivent pas se marcher dessus.
  assert.notStrictEqual(compose, rapportErreur.cheminTemporaire(cible));
});

test('cockpit : un rapport écrit pour de vrai passe par « ~$ » et ne laisse rien derrière', () => {
  const travail = jetable('szh-tmp-reussi-');
  const espion = espionnerEcriture();
  try {
    avecSandbox(travail, (dossier) => {
      fs.mkdirSync(dossier, { recursive: true });
      const sortie = rapportErreur.emettreRapport(CHAMPS_MINIMAUX);
      assert.ok(sortie && sortie.ecrit, 'le rapport n’a pas été écrit : ' + JSON.stringify(sortie));
      // Le chemin réellement écrit, pas celui qu'on suppose : fs est le même objet des deux
      // côtés, le module n'a donc rien pu choisir d'autre.
      const dansLeDossier = espion.vus.filter((c) => path.dirname(c) === dossier);
      assert.ok(dansLeDossier.length >= 1, 'aucune écriture vue dans le dossier de rapports');
      for (const c of dansLeDossier) {
        assert.ok(path.basename(c).startsWith('~$'),
          'le rapport a été écrit sans passer par un temporaire « ~$ » : ' + c);
      }
      const restes = fs.readdirSync(dossier).filter((n) => !n.endsWith('.json'));
      assert.deepStrictEqual(restes, [], 'des temporaires sont restés : ' + restes.join(', '));
      assert.strictEqual(fs.readdirSync(dossier).length, 1,
        'le dossier devrait ne contenir que le rapport : ' + fs.readdirSync(dossier).join(', '));
    });
  } finally {
    espion.rendre();
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('cockpit : un renommage qui échoue n’abandonne pas son temporaire', () => {
  const travail = jetable('szh-tmp-echec-');
  const vraiRename = fs.renameSync;
  try {
    avecSandbox(travail, (dossier) => {
      fs.mkdirSync(dossier, { recursive: true });
      // Le mode d'échec réel : le renommage refusé (fichier tenu par le synchroniseur,
      // dossier disparu entre-temps, disque plein). Le temporaire, lui, a bien été écrit —
      // c'est exactement ce que l'ancien code abandonnait sur place, dans le dossier
      // PARTAGÉ, d'où il se répliquait ensuite sur tous les postes.
      fs.renameSync = function () { throw new Error('EPERM simulé'); };
      const sortie = rapportErreur.emettreRapport(CHAMPS_MINIMAUX);
      fs.renameSync = vraiRename;
      assert.ok(sortie && !sortie.ecrit,
        'le rapport ne pouvait pas être écrit : ' + JSON.stringify(sortie));
      assert.deepStrictEqual(fs.readdirSync(dossier), [],
        'un temporaire a été abandonné dans le dossier partagé : '
        + fs.readdirSync(dossier).join(', '));
      // Même contrat pour l'état par compte (ecrireJsonAtomique), écrit au passage par
      // l'anti-inondation : rien ne doit rester non plus.
      const local = path.join(travail, 'Local', 'SZH');
      const restesLocaux = fs.existsSync(local)
        ? fs.readdirSync(local).filter((n) => n.startsWith('~$')) : [];
      assert.deepStrictEqual(restesLocaux, [],
        'un temporaire a été abandonné dans l’état par compte : ' + restesLocaux.join(', '));
    });
  } finally {
    fs.renameSync = vraiRename;
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('lib/yaml.js : le motif de référence, inchangé', () => {
  // C'est de LUI que les deux écrivains de rapports viennent d'être alignés : préfixe « ~$ »,
  // même dossier, et un finally. Si ce motif changeait, les trois devraient changer ensemble.
  const travail = jetable('szh-tmp-yaml-');
  const espion = espionnerEcriture();
  try {
    const cible = path.join(travail, 'ausgabe.yaml');
    yaml.ecrireAtomique(cible, 'title: essai\n');
    assert.strictEqual(fs.readFileSync(cible, 'utf8'), 'title: essai\n');
    assert.strictEqual(espion.vus.length, 1);
    assert.ok(path.basename(espion.vus[0]).startsWith('~$'),
      'le motif de référence n’emploie plus le préfixe « ~$ » : ' + espion.vus[0]);
    assert.deepStrictEqual(fs.readdirSync(travail), ['ausgabe.yaml']);
  } finally {
    espion.rendre();
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// 2. Le même contrat, côté PowerShell
// ---------------------------------------------------------------------------------------

test('lanceur : la source de Write-SzhRapportSurDisque porte le préfixe et le finally', () => {
  const m = SOURCE_RAPPORT_PS.match(/function Write-SzhRapportSurDisque \{[\s\S]*?\n\}/);
  assert.ok(m, 'Write-SzhRapportSurDisque introuvable');
  const corps = m[0];
  assert.ok(corps.indexOf("'~$'") !== -1,
    'le temporaire du lanceur ne porte pas le préfixe « ~$ », que OneDrive ignore');
  assert.ok(corps.indexOf('.tmp-') === -1,
    'l’ancien nom de temporaire « .tmp- » est toujours là');
  assert.match(corps, /\}\s*finally\s*\{/,
    'l’exception est toujours avalée sans que le temporaire soit supprimé');
});

// Le corps d'une fonction PowerShell, du vrai fichier (même technique que
// test/js/rapport-erreur-ps.test.js).
function corpsFonction(source, nom) {
  const lignes = source.split(/\r\n|\n/);
  let debut = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].indexOf('function ' + nom) === 0) { debut = i; break; }
  }
  assert.ok(debut !== -1, 'fonction introuvable : ' + nom);
  let fin = -1;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (lignes[i] === '}') { fin = i; break; }
  }
  assert.ok(fin !== -1, 'fin de fonction introuvable : ' + nom);
  return lignes.slice(debut, fin + 1).join('\r\n');
}

test('lanceur : écriture réussie puis écriture ratée, aucun orphelin dans les deux cas',
  { skip: sansPowerShell }, () => {
    const travail = jetable('szh-tmp-ps-');
    try {
      const dossier = path.join(travail, 'rapports');
      fs.mkdirSync(dossier);
      const d = dossier.replace(/\\/g, '\\\\');
      const pilote = path.join(travail, 'pilote.ps1');
      const sortie = path.join(travail, 'sortie.json');
      const contenu = [
        "$ErrorActionPreference = 'Stop'",
        // La mise en forme du JSON est une dépendance de la fonction éprouvée, mais ce n'est
        // pas le sujet ici : elle a son propre banc, qui compare sa sortie caractère par
        // caractère à celle du cockpit (test/js/rapport-erreur-ps.test.js). Un doublure d'une
        // ligne suffit — ce qu'on éprouve ci-dessous, c'est le fichier temporaire.
        'function ConvertTo-SzhRapportJsonTexte { param($Objet) return (($Objet | ConvertTo-Json -Depth 20) + "`n") }',
        corpsFonction(SOURCE_RAPPORT_PS, 'Write-SzhRapportSurDisque'),
        '$sortie = [ordered]@{ }',
        "$rapport = [ordered]@{ schema = 'szh-rapport-erreur/1'; id = 'essai-01' }",
        "$sortie['reussi'] = (Write-SzhRapportSurDisque -Dossier '" + d + "' -Id 'essai-01' -Rapport $rapport)",
        // Deuxième passage, cible tenue ouverte SANS partage : le renommage échoue, et le
        // temporaire a bel et bien été écrit avant lui.
        "$cible = Join-Path '" + d + "' 'essai-01.json'",
        "$flux = [System.IO.File]::Open($cible, 'Open', 'ReadWrite', 'None')",
        "try {",
        "  $sortie['rate'] = (Write-SzhRapportSurDisque -Dossier '" + d + "' -Id 'essai-01' -Rapport $rapport)",
        "} finally { $flux.Close() }",
        "($sortie | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath '" + sortie.replace(/\\/g, '\\\\') + "' -Encoding UTF8"
      ].join('\r\n');
      fs.writeFileSync(pilote, '\ufeff' + contenu, 'utf8');
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
        { encoding: 'utf8', windowsHide: true, timeout: 120000 });
      assert.ok(fs.existsSync(sortie), 'le pilote n’a rien rendu : ' + (run.stderr || ''));
      const lu = JSON.parse(String(fs.readFileSync(sortie, 'utf8')).replace(/^\uFEFF/, ''));
      assert.strictEqual(lu.reussi, true, 'la première écriture aurait dû réussir');
      assert.strictEqual(lu.rate, false, 'la seconde écriture aurait dû échouer (cible verrouillée)');

      const restes = fs.readdirSync(dossier).filter((n) => n !== 'essai-01.json');
      assert.deepStrictEqual(restes, [],
        'des temporaires sont restés dans le dossier partagé : ' + restes.join(', '));
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });
