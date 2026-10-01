// Les onglets Export et secretariat et Preprocessing du lanceur vivent dans leurs propres
// fichiers (windows/lanceur-secretariat.ps1, windows/lanceur-preproc.ps1) : chacun expose une
// fonction New-SzhPage<X> qui recoit un contexte explicite et rend son TabPage. L'ordre des
// onglets est declare une seule fois dans open-produit.ps1.
//
//   node --test test/js/lanceur-pages.test.js
//
// Deux familles de controles :
//   * statiques : l'ordre est une liste unique, plus aucun TabPages.Clear ni TabPages.Add
//     disperse, un seul AddRange ;
//   * dynamiques : les deux pages se construisent pour de vrai (WinForms, sans fenetre
//     montree), et leurs gestionnaires agissent APRES le retour de la fonction -- c'est le
//     piege de ce decoupage, une fonction imbriquee dans New-SzhPage<X> disparait avec elle.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const WINDOWS = path.join(RACINE, 'windows');
const LANCEUR = fs.readFileSync(path.join(WINDOWS, 'open-produit.ps1'), 'utf8');

// ---- L'ordre des onglets : une liste, un AddRange ----

test('l\'ordre des onglets est declare une fois, et pose par un seul AddRange', () => {
  const declarations = LANCEUR.match(/^\$ordreOnglets = .*$/gm) || [];
  assert.strictEqual(declarations.length, 1, 'l\'ordre des onglets doit etre declare une seule fois : ' + declarations.length);
  assert.match(declarations[0], /'preproc', 'secretariat', 'reglages', 'journal'/,
    'la liste ne dit plus Preprocessing, Secretariat, Reglages, Journal apres les produits');
  const code = LANCEUR.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/TabPages\.Clear\s*\(/.test(code), 'TabPages.Clear est revenu : le rattrapage d\'ordre ne doit plus exister');
  assert.ok(!/TabPages\.Add\s*\(/.test(code), 'une page est encore ajoutee au TabControl hors de la liste d\'ordre');
  assert.ok(!/TabPages\.Insert\s*\(/.test(code), 'TabPages.Insert est ignore tant que le controle n\'a pas de handle');
  const ajouts = code.match(/TabPages\.AddRange\s*\(/g) || [];
  assert.strictEqual(ajouts.length, 1, 'un seul AddRange doit poser les onglets : ' + ajouts.length);
  assert.match(code, /TabPages\.AddRange\(\[System\.Windows\.Forms\.TabPage\[\]\]@\(\$ordreOnglets \| ForEach-Object \{ \$pages\[\$_\] \}\)\)/,
    'AddRange ne lit plus la liste $ordreOnglets');
  // L'explication du choix d'AddRange (Insert ignore) est gardee a cote du code.
  assert.match(LANCEUR, /TabPages\.Insert, que\r?\n# le controle ignore/, 'le commentaire qui dit pourquoi n\'a pas Insert a disparu');
});

test('chaque page d\'outil est dot-sourcee, appelee avec un contexte, et rangee par cle', () => {
  for (const [fichier, fonction, cle] of [['lanceur-secretariat.ps1', 'New-SzhPageSecretariat', 'secretariat'],
    ['lanceur-preproc.ps1', 'New-SzhPagePreproc', 'preproc']]) {
    assert.ok(fs.existsSync(path.join(WINDOWS, fichier)), fichier + ' manque');
    assert.ok(LANCEUR.indexOf('. "$PSScriptRoot\\' + fichier + '"') !== -1, 'open-produit.ps1 ne dot-source plus ' + fichier);
    assert.match(LANCEUR, new RegExp("\\$pages\\['" + cle + "'\\] = " + fonction + ' @\\{'),
      'la page ' + cle + ' n\'est plus construite par ' + fonction + ' @{...}');
    const source = fs.readFileSync(path.join(WINDOWS, fichier), 'utf8');
    assert.match(source, new RegExp('function ' + fonction + '\\(\\$Contexte\\)'));
    assert.ok(!/\$onglets\b/.test(source), fichier + ' touche au TabControl : elle doit seulement rendre son TabPage');
  }
});

// ---- Les deux pages, construites pour de vrai ----

const PILOTE = [
  '$ErrorActionPreference = "Stop"',
  '$sortie = $args[0]',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '. "' + path.join(WINDOWS, 'szh-common.ps1') + '"',
  '. "' + path.join(WINDOWS, 'lanceur-secretariat.ps1') + '"',
  '. "' + path.join(WINDOWS, 'lanceur-preproc.ps1') + '"',
  // Les deux fonctions de journal partagees restent dans open-produit.ps1 : des doublures.
  'function Add-SzhEnteteJournal($Journal, [string]$NomExport) { }',
  'function Add-SzhLigneJournal($ZoneTexte, [string]$Ligne) { }',
  '$script:form = New-Object System.Windows.Forms.Form',
  '$inventaires = [ordered]@{}',
  'foreach ($j in $SzhOrdreOnglets) {',
  '  $enCours = @(); $archives = @()',
  '  if ($SzhProduits[$j].secretariat) {',
  '    $enCours = @([pscustomobject]@{ nom = ($j + "-encours"); titre = "t"; chemin = ("C:\\x\\" + $j + "\\encours") })',
  '    $archives = @([pscustomobject]@{ nom = ($j + "-archive"); titre = "t"; chemin = ("C:\\x\\" + $j + "\\archive") })',
  '  }',
  '  $inventaires[$j] = [pscustomobject]@{ enCours = $enCours; archives = $archives }',
  '}',
  '$sec = New-SzhPageSecretariat @{ Form = $script:form; TitreFenetre = "titre"; Codium = "C:\\faux\\codium.exe"; Inventaires = $inventaires; XPage = 12; LargeurPage = 592; YNouveau = 300 }',
  '$pre = New-SzhPagePreproc @{ Form = $script:form; XPage = 12; LargeurPage = 592; YNouveau = 300 }',
  '$r = [ordered]@{}',
  '$r.typeSecretariat = $sec.GetType().Name',
  '$r.typePreproc = $pre.GetType().Name',
  '$r.tagSecretariat = [string]$sec.Tag',
  '$r.tagPreproc = [string]$pre.Tag',
  '$r.jetonsFiltre = @($script:jetonsFiltreSecretariat)',
  '$r.visiblesAvant = @($script:secretariatEntreesVisibles | ForEach-Object { $_.nom })',
  // Le gestionnaire du filtre tourne apres le retour de New-SzhPageSecretariat.
  '$script:comboFiltreSecretariat.SelectedIndex = 1',
  '$r.visiblesApres = @($script:secretariatEntreesVisibles | ForEach-Object { $_.nom })',
  '$r.itemsApres = $script:listeSecretariat.Items.Count',
  '$script:boutonInterrompreSecretariat.Enabled = $true',
  '$script:boutonInterrompreSecretariat.PerformClick()',
  '$r.annuleSecretariat = [bool]$script:etatAnnulationSecretariat.annule',
  '$script:boutonInterromprePreproc.Enabled = $true',
  '$script:boutonInterromprePreproc.PerformClick()',
  '$r.annulePreproc = [bool]$script:etatAnnulationPreproc.annule',
  '$r.boutonsSecretariat = $script:secretariatBoutons.Count',
  '$r.boutonsPreproc = $script:preprocBoutons.Count',
  '$r.contexteForm = ($script:ctxSecretariat.Form -eq $script:form) -and ($script:ctxPreproc.Form -eq $script:form)',
  'Set-SzhJson $sortie $r',
].join('\r\n') + '\r\n';

const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-pages-'));
  const pilote = path.join(travail, 'pages.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(pilote, '\ufeff' + PILOTE, 'utf8');
  const env = Object.assign({}, process.env, {
    SZH_BASE: path.join(travail, 'ProgramData'), SZH_LANGUE: 'fr',
    SZH_RACINE_TEST: path.join(travail, 'base'), SZH_RACINE_PROD: path.join(travail, 'prod'),
    SZH_RAPPORTS: path.join(travail, 'rapports'), SZH_COMPTEURS: path.join(travail, 'compteurs'),
    LOCALAPPDATA: path.join(travail, 'localappdata'),
  });
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, sortie],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8').replace(/^\ufeff/, '')) : null;
  const rendu = { status: run.status, stderr: run.stderr || '', r: lu };
  fs.rmSync(travail, { recursive: true, force: true });
  return rendu;
})();

test('les deux pages se construisent et rendent un TabPage sans produit', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a echoue : ' + bilan.stderr);
  const r = bilan.r;
  assert.strictEqual(r.typeSecretariat, 'TabPage', 'New-SzhPageSecretariat ne rend pas UN TabPage (sortie parasite ?)');
  assert.strictEqual(r.typePreproc, 'TabPage', 'New-SzhPagePreproc ne rend pas UN TabPage (sortie parasite ?)');
  assert.strictEqual(r.tagSecretariat, '', '« Ouvrir » n\'a rien a ouvrir sur l\'onglet Secretariat');
  assert.strictEqual(r.tagPreproc, '', '« Ouvrir » n\'a rien a ouvrir sur l\'onglet Preprocessing');
  assert.strictEqual(r.boutonsSecretariat, 4);
  assert.strictEqual(r.boutonsPreproc, 1);
  assert.strictEqual(r.contexteForm, true, 'le formulaire du contexte n\'est pas celui du lanceur');
});

test('le filtre de l\'onglet Secretariat agit apres le retour de la fonction', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a echoue : ' + bilan.stderr);
  const r = bilan.r;
  assert.deepStrictEqual(r.jetonsFiltre, ['revue', 'zeitschrift']);
  assert.deepStrictEqual(r.visiblesAvant, ['revue-encours', 'revue-archive']);
  assert.deepStrictEqual(r.visiblesApres, ['zeitschrift-encours', 'zeitschrift-archive'],
    'le filtre ne refait plus la liste : Update-SzhListeSecretariat est-elle encore une fonction du fichier ?');
  assert.strictEqual(r.itemsApres, 2);
});

test('les boutons Interrompre des deux onglets levent leur propre drapeau', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a echoue : ' + bilan.stderr);
  assert.strictEqual(bilan.r.annuleSecretariat, true);
  assert.strictEqual(bilan.r.annulePreproc, true);
});
