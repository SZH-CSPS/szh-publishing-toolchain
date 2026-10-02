// windows/szh-shell.ps1 : Invoke-SzhNodeCockpit, le seul lanceur des scripts d'outils\ sous
// VSCodium-en-Node. Preuve dynamique, contre un faux « VSCodium » (le node.exe de ce poste,
// ELECTRON_RUN_AS_NODE y est sans effet) et un faux outil : aller-retour JSON, code de sortie,
// outil introuvable, variables d'environnement propres à l'appelant.
// Le faux outil écrit DEUX BOM : le lecteur .NET en retire déjà un, le second prouve que la
// fonction tolère ce qui reste.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');

const FAUX_OUTIL = [
  "'use strict';",
  "const fs = require('fs');",
  "const mode = process.argv[2];",
  "if (mode === 'echo') {",
  "  let entree = '';",
  "  process.stdin.setEncoding('utf8');",
  "  process.stdin.on('data', (d) => { entree += d; });",
  "  process.stdin.on('end', () => {",
  "    const o = JSON.parse(entree);",
  "    process.stdout.write('\\ufeff\\ufeff' + JSON.stringify({ ok: true, texte: o.texte, x: process.env.SZH_X || '', argv: process.argv.slice(3) }) + '\\n');",
  "  });",
  "} else if (mode === 'lignes') {",
  "  process.stderr.write('petit message d\\u2019erreur\\n');",
  "  process.stdout.write('\\ufeff\\ufeff{\"t\":\"etape\",\"texte\":\"un é\"}\\n\\n{\"t\":\"fin\",\"ok\":true}\\nligne brute\\n');",
  "  process.exit(3);",
  "}",
].join('\n') + '\n';

function executer(corps) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-node-cockpit-'));
  const dossierOutils = path.join(travail, 'outils');
  fs.mkdirSync(dossierOutils);
  fs.writeFileSync(path.join(dossierOutils, 'faux-outil.js'), FAUX_OUTIL, 'utf8');
  const sortie = path.join(travail, 'r.json');
  const pilote = path.join(travail, 'p.ps1');
  fs.writeFileSync(pilote, '\ufeff' + [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Windows.Forms',
    '. "' + path.join(RACINE, 'windows', 'szh-common.ps1') + '"',
    '$faux = "' + process.execPath + '"',
    '$r = [ordered]@{}',
  ].concat(corps(travail)).concat([
    'Set-SzhJson "' + sortie.replace(/\\/g, '\\\\') + '" $r',
  ]).join('\r\n') + '\r\n', 'utf8');
  const env = Object.assign({}, process.env, {
    SZH_BASE: path.join(travail, 'base'), SZH_COCKPIT_DOSSIER: travail,
  });
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 90000, env });
  const r = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  return { run, r, travail };
}

test('Invoke-SzhNodeCockpit : aller-retour JSON en UTF-8, BOM de sortie toléré, environnement et arguments',
  { skip: sansPowerShell }, () => {
    const { run, r, travail } = executer(() => [
      '$rep = Invoke-SzhNodeCockpit -Outil "faux-outil.js" -Codium $faux -Arguments @("echo", "avec espace") ' +
        '-Entree ([pscustomobject]@{ texte = "caf\u00e9 \u00e0 l\'\u00e9t\u00e9" }) -Environnement @{ SZH_X = "valeur" }',
      '$r.code = $rep.CodeSortie',
      '$r.debutBom = [int][char]$rep.Sortie[0]',
      '$o = $rep.Sortie.Trim() | ConvertFrom-Json',
      '$r.texte = [string]$o.texte',
      '$r.x = [string]$o.x',
      '$r.argv = @($o.argv)',
      '$rBrut = Invoke-SzhNodeCockpit -Outil "faux-outil.js" -Codium $faux -Arguments @("echo") -Entree \'{"texte":"brut"}\'',
      '$r.brut = [string](($rBrut.Sortie.Trim() | ConvertFrom-Json).texte)',
    ]);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(r.debutBom, 123, 'la sortie commence encore par un BOM au lieu de {');
    assert.strictEqual(r.texte, 'café à l\'été', 'l\'UTF-8 n\'a pas fait l\'aller-retour');
    assert.strictEqual(r.x, 'valeur', 'la variable d\'environnement de l\'appelant n\'est pas arrivée');
    assert.deepStrictEqual(r.argv, ['avec espace']);
    assert.strictEqual(r.brut, 'brut', 'un texte JSON déjà prêt doit partir tel quel');
  });

test('Invoke-SzhNodeCockpit : stdout, stderr et code de sortie d\'un outil qui échoue',
  { skip: sansPowerShell }, () => {
    const { run, r, travail } = executer(() => [
      '$rep = Invoke-SzhNodeCockpit -Outil "faux-outil.js" -Codium $faux -Arguments @("lignes")',
      '$r.code = $rep.CodeSortie',
      '$r.erreur = $rep.Erreur.Trim()',
      '$r.sortie = $rep.Sortie',
    ]);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
    assert.strictEqual(r.code, 3);
    assert.strictEqual(r.erreur, 'petit message d’erreur');
    assert.ok(r.sortie.includes('{"t":"fin","ok":true}'), 'stdout entier attendu dans .Sortie');
  });

test('Invoke-SzhNodeCockpit : un outil introuvable lève, sans mode muet', { skip: sansPowerShell }, () => {
  const { run, r, travail } = executer(() => [
    '$r.leve = $false',
    'try { [void](Invoke-SzhNodeCockpit -Outil "inexistant.js" -Codium $faux) } catch { $r.leve = $_.Exception.Message }',
  ]);
  fs.rmSync(travail, { recursive: true, force: true });
  assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
  assert.match(r.leve, /outils\\inexistant\.js introuvable/);
});

test('Invoke-SzhNodeCockpit et Get-SzhOutilCockpit : plus de suivi ligne à ligne, d\'annulation, de lancement sans attente ni de mode muet', () => {
  const source = fs.readFileSync(path.join(RACINE, 'windows', 'szh-shell.ps1'), 'utf8');
  for (const mort of ['SurLigne', 'EtatAnnulation', 'SansAttendre', 'SansLever', 'MessageAbsent']) {
    assert.ok(!source.includes(mort), 'szh-shell.ps1 porte encore ' + mort);
  }
});
