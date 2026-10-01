// windows/szh-shell.ps1 : Invoke-SzhNodeCockpit, le seul lanceur des scripts d'outils\ sous
// VSCodium-en-Node. Preuve dynamique, contre un faux « VSCodium » (le node.exe de ce poste,
// ELECTRON_RUN_AS_NODE y est sans effet) et un faux outil : aller-retour JSON, suivi ligne à
// ligne, annulation, lancement sans attente, variables d'environnement propres à l'appelant.
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
  "} else if (mode === 'long') {",
  "  process.stdout.write('{\"t\":\"etape\"}\\n');",
  "  setTimeout(() => {}, 30000);",
  "} else if (mode === 'marque') {",
  "  fs.writeFileSync(process.argv[3], 'lance');",
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

test('Invoke-SzhNodeCockpit : suivi ligne à ligne (lignes vides et BOM écartés), stderr et code de sortie',
  { skip: sansPowerShell }, () => {
    const { run, r, travail } = executer(() => [
      '$etat = @{ lignes = New-Object System.Collections.ArrayList }',
      '$surLigne = { param($texteLigne) [void]$etat.lignes.Add($texteLigne) }',
      '$rep = Invoke-SzhNodeCockpit -Outil "faux-outil.js" -Codium $faux -Arguments @("lignes") -SurLigne $surLigne',
      '$r.lignes = @($etat.lignes)',
      '$r.code = $rep.CodeSortie',
      '$r.erreur = $rep.Erreur.Trim()',
      '$r.annule = $rep.Annule',
    ]);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
    assert.deepStrictEqual(r.lignes, ['{"t":"etape","texte":"un é"}', '{"t":"fin","ok":true}', 'ligne brute']);
    assert.strictEqual(r.code, 3);
    assert.strictEqual(r.erreur, 'petit message d\u2019erreur');
    assert.strictEqual(r.annule, false);
  });

test('Invoke-SzhNodeCockpit : le drapeau d\'annulation tue le processus sans attendre sa fin',
  { skip: sansPowerShell }, () => {
    const { run, r, travail } = executer(() => [
      '$etat = @{ annule = $false }',
      '$surLigne = { param($texteLigne) $etat.annule = $true }',
      '$chrono = [Diagnostics.Stopwatch]::StartNew()',
      '$rep = Invoke-SzhNodeCockpit -Outil "faux-outil.js" -Codium $faux -Arguments @("long") -SurLigne $surLigne -EtatAnnulation $etat',
      '$r.annule = $rep.Annule',
      '$r.secondes = $chrono.Elapsed.TotalSeconds',
      '$r.erreur = $rep.Erreur',
    ]);
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
    assert.strictEqual(r.annule, true);
    assert.ok(r.secondes < 20, 'l\'annulation a attendu la fin du processus : ' + r.secondes + ' s');
    assert.strictEqual(r.erreur, '', 'stderr ne se lit pas après une annulation');
  });

test('Invoke-SzhNodeCockpit : -SansAttendre lance sans rien lire, -SansLever passe son tour sans outil',
  { skip: sansPowerShell }, () => {
    const marque = path.join(os.tmpdir(), 'szh-node-cockpit-marque-' + process.pid);
    fs.rmSync(marque, { force: true });
    const { run, r, travail } = executer(() => [
      '$rep = Invoke-SzhNodeCockpit -Outil "faux-outil.js" -Codium $faux -Arguments @("marque", "' + marque + '") -SansAttendre',
      '$r.demarre = $rep.Demarre',
      '$absent = Invoke-SzhNodeCockpit -Outil "inexistant.js" -Codium $faux -SansAttendre -SansLever',
      '$r.absentDemarre = $absent.Demarre',
      '$r.leve = $false',
      'try { [void](Invoke-SzhNodeCockpit -Outil "inexistant.js" -Codium $faux -MessageAbsent "outil-absent") } catch { $r.leve = $_.Exception.Message }',
    ]);
    // Le processus lancé sans attente écrit sa marque un instant plus tard.
    const fin = Date.now() + 10000;
    while (!fs.existsSync(marque) && Date.now() < fin) { /* attente courte */ }
    const marqueEcrite = fs.existsSync(marque);
    fs.rmSync(marque, { force: true });
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
    assert.strictEqual(r.demarre, true);
    assert.strictEqual(r.absentDemarre, false);
    assert.strictEqual(r.leve, 'outil-absent');
    assert.ok(marqueEcrite, 'le processus lancé sans attente n\'a jamais tourné');
  });
