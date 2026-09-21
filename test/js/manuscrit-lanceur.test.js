// Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, paragraphe 9 (l'onglet du
// lanceur) et paragraphe 11 (les controles de validite). Ce fichier ne teste PAS
// manuscrit-nettoyer.py (n'existe pas encore, un autre agent l'ecrit) : il prouve que
// l'onglet « Preprocessing » ajoute a windows/open-produit.ps1 respecte les quatre
// contraintes posees par Robin -- analyse statique du texte du script, jamais une vraie
// fenetre WinForms (le lanceur n'a pas de mode "silencieux" pour ouvrir un onglet seul).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { POWERSHELL, sansPowerShell, PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const OPEN_PRODUIT = path.join(RACINE, 'windows', 'open-produit.ps1');
const TEXTES = path.join(RACINE, 'windows', 'szh-textes.ps1');

const TEXTE_PRODUIT = fs.readFileSync(OPEN_PRODUIT, 'utf8');
const TEXTE_TEXTES = fs.readFileSync(TEXTES, 'utf8');

// ---- Controle n1 : le script s'analyse toujours sans erreur de syntaxe ----------------
// [System.Management.Automation.Language.Parser]::ParseFile veut un chemin en BARRES
// INVERSES : avec des barres obliques il rend une fausse erreur de syntaxe (mesure sur ce
// poste), donc jamais path.join a barres obliques ici -- OPEN_PRODUIT (path.join) est deja
// en barres inverses sous Windows, mais on le redit explicitement pour ne pas dependre de
// ce detail de plateforme.
test('open-produit.ps1 s\'analyse toujours sans erreur de syntaxe apres l\'ajout de l\'onglet',
  { skip: sansPowerShell }, () => {
    const cheminBarres = OPEN_PRODUIT.replace(/\//g, '\\');
    const script = [
      '$chemin = ' + JSON.stringify(cheminBarres),
      '$erreurs = $null',
      '[System.Management.Automation.Language.Parser]::ParseFile($chemin, [ref]$null, [ref]$erreurs) | Out-Null',
      'if ($erreurs.Count -gt 0) { $erreurs | ForEach-Object { Write-Output $_.ToString() } } else { Write-Output "OK" }'
    ].join("\r\n");
    const pilote = path.join(require('os').tmpdir(), 'szh-parse-open-produit-' + process.pid + '.ps1');
    fs.writeFileSync(pilote, script, 'utf8');
    let run;
    try {
      run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    } finally {
      fs.rmSync(pilote, { force: true });
    }
    assert.strictEqual(run.status, 0, 'le pilote PowerShell a echoue - ' + (run.stderr || ''));
    assert.strictEqual(run.stdout.trim(), 'OK', 'erreur(s) de syntaxe rapportee(s) - ' + run.stdout);
  });

// ---- Controle n2 : aucune cle lanceur.preproc.* manquante, aucune orpheline ----------
// Les trois blocs (fr/de/en) de $script:SzhTextes sont separes par "\n  <langue> = @{" ;
// chaque bloc va jusqu'au marqueur suivant (ou la fin du fichier pour "en").
function extraireBlocsLangues(texte) {
  const marqueurs = [...texte.matchAll(/\n {2}(fr|de|en) = @\{/g)];
  assert.ok(marqueurs.length === 3, 'szh-textes.ps1 ne porte plus exactement trois blocs de langue');
  const blocs = {};
  for (let i = 0; i < marqueurs.length; i++) {
    const debut = marqueurs[i].index + marqueurs[i][0].length;
    const fin = (i + 1 < marqueurs.length) ? marqueurs[i + 1].index : texte.length;
    blocs[marqueurs[i][1]] = texte.slice(debut, fin);
  }
  return blocs;
}

function clesPreprocDeclarees(blocLangue) {
  const vues = new Set();
  for (const m of blocLangue.matchAll(/'(lanceur\.preproc(?:\.[\w.]*)?)'\s*=/g)) { vues.add(m[1]); }
  return vues;
}

function clesPreprocEmployees(texteScript) {
  const vues = new Set();
  for (const m of texteScript.matchAll(/'(lanceur\.preproc(?:\.[\w.]*)?)'/g)) { vues.add(m[1]); }
  return vues;
}

test('toute cle lanceur.preproc.* employee dans open-produit.ps1 existe dans les trois langues, et reciproquement', () => {
  const blocs = extraireBlocsLangues(TEXTE_TEXTES);
  const declareesFr = clesPreprocDeclarees(blocs.fr);
  const declareesDe = clesPreprocDeclarees(blocs.de);
  const declareesEn = clesPreprocDeclarees(blocs.en);
  const employees = clesPreprocEmployees(TEXTE_PRODUIT);

  assert.ok(employees.size > 0, 'aucune cle lanceur.preproc.* employee dans open-produit.ps1 - le controle est casse');

  // Chaque cle employee doit exister dans les TROIS langues.
  for (const cle of employees) {
    assert.ok(declareesFr.has(cle), 'cle absente du bloc fr : ' + cle);
    assert.ok(declareesDe.has(cle), 'cle absente du bloc de : ' + cle);
    assert.ok(declareesEn.has(cle), 'cle absente du bloc en : ' + cle);
  }
  // Et aucune cle declaree ne doit rester orpheline (les trois blocs doivent aussi
  // porter exactement le meme jeu de cles entre eux).
  for (const [nomBloc, declarees] of [['fr', declareesFr], ['de', declareesDe], ['en', declareesEn]]) {
    for (const cle of declarees) {
      assert.ok(employees.has(cle), 'cle declaree dans le bloc ' + nomBloc + ' mais jamais employee : ' + cle);
    }
  }
  assert.deepStrictEqual([...declareesFr].sort(), [...declareesDe].sort(),
    'les blocs fr et de ne portent pas le meme jeu de cles lanceur.preproc.*');
  assert.deepStrictEqual([...declareesFr].sort(), [...declareesEn].sort(),
    'les blocs fr et en ne portent pas le meme jeu de cles lanceur.preproc.*');
});

// ---- Controle n3 : aucun controle de l'onglet ne deborde de $xPage + $largeurPage ----
function extraireBlocOnglet(texte) {
  const debut = texte.indexOf('$pagePreproc = New-Object System.Windows.Forms.TabPage');
  assert.ok(debut !== -1, 'le bloc de l\'onglet Preprocessing (pagePreproc) est introuvable');
  const fin = texte.indexOf('$onglets.TabPages.Add($pagePreproc)', debut);
  assert.ok(fin !== -1, 'la fin du bloc de l\'onglet Preprocessing est introuvable');
  return texte.slice(debut, fin);
}

// Scinde "a, b" au premier virgule de profondeur 0 (les arguments eux-memes n'en portent
// jamais, mais peuvent contenir des parentheses : "($xPage + 70)").
function diviserArguments(s) {
  let profondeur = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') { profondeur++; }
    else if (c === ')') { profondeur--; }
    else if (c === ',' && profondeur === 0) { return [s.slice(0, i).trim(), s.slice(i + 1).trim()]; }
  }
  throw new Error('argument non scinde : ' + s);
}

function evaluerExpression(expr, xPageVal, largeurPageVal) {
  const substitue = expr.replace(/\$xPage/g, String(xPageVal)).replace(/\$largeurPage/g, String(largeurPageVal));
  // Pas de $yNouveau ici : ce controle ne porte que sur l'axe horizontal (X + largeur),
  // exactement la contrainte formulee par Robin ("restent dans $xPage + $largeurPage").
  assert.ok(!/\$/.test(substitue), 'expression non resolue (variable inconnue) : ' + expr);
  // eslint-disable-next-line no-new-func
  return Function('"use strict";return (' + substitue + ')')();
}

test('aucun controle de l\'onglet Preprocessing ne deborde de $xPage + $largeurPage', () => {
  const mXPage = TEXTE_PRODUIT.match(/\$xPage = (\d+)/);
  const mLargeurPage = TEXTE_PRODUIT.match(/\$largeurPage = (\d+)/);
  assert.ok(mXPage && mLargeurPage, 'xPage / largeurPage introuvables dans open-produit.ps1');
  const xPageVal = Number(mXPage[1]);
  const largeurPageVal = Number(mLargeurPage[1]);
  const borneDroite = xPageVal + largeurPageVal;

  const bloc = extraireBlocOnglet(TEXTE_PRODUIT);

  const locations = new Map();
  for (const m of bloc.matchAll(/\$(script:)?(\w+)\.Location = New-Object System\.Drawing\.Point\(([^;]*?)\)\r?\n/g)) {
    locations.set(m[2], m[3]);
  }
  const sizes = new Map();
  for (const m of bloc.matchAll(/\$(script:)?(\w+)\.Size = New-Object System\.Drawing\.Size\(([^;]*?)\)\r?\n/g)) {
    sizes.set(m[2], m[3]);
  }

  assert.ok(locations.size >= 6, 'trop peu de controles positionnes trouves dans le bloc (' + locations.size + ')');
  // Seuls les controles qui portent une Size EXPLICITE sont mesures : un Label en
  // AutoSize (introPreproc, etiqProduitPreproc) ne pose pas de largeur lui-meme, il n'y a
  // donc rien a comparer a $xPage + $largeurPage pour lui.
  const controlesMesures = [...locations.keys()].filter((nom) => sizes.has(nom));
  assert.ok(controlesMesures.length >= 6,
    'trop peu de controles avec Location ET Size explicites (' + controlesMesures.length + ') - ' +
    JSON.stringify({ locations: [...locations.keys()], sizes: [...sizes.keys()] }));

  const debordements = [];
  for (const nom of controlesMesures) {
    const locExpr = locations.get(nom);
    const sizeExpr = sizes.get(nom);
    const [xExpr] = diviserArguments(locExpr);
    const [wExpr] = diviserArguments(sizeExpr);
    const x = evaluerExpression(xExpr, xPageVal, largeurPageVal);
    const w = evaluerExpression(wExpr, xPageVal, largeurPageVal);
    if (x + w > borneDroite) { debordements.push(nom + ' : x=' + x + ' + largeur=' + w + ' = ' + (x + w) + ' > ' + borneDroite); }
  }
  assert.deepStrictEqual(debordements, [], 'controle(s) qui debordent de $xPage + $largeurPage (' + borneDroite + ') : ' + debordements.join(' | '));
});

// ---- Controle n4 : les deux motifs interdits sont absents du fichier -----------------
// BeginErrorReadLine (avec add_ErrorDataReceived) tue le processus PowerShell ENTIER sur ce
// poste, hors pipeline, sans exception a attraper. Un ReadLine() synchrone sur la sortie
// standard gele la fenetre. Aucun des deux ne doit apparaitre nulle part dans le fichier,
// pas seulement dans le code qu'on vient d'ajouter -- Invoke-SzhSecretariat, deja present,
// ne les emploie pas non plus, et ce controle le prouve du meme coup.
test('BeginErrorReadLine et ReadLine() synchrone sur la sortie standard sont absents du fichier', () => {
  // Recherche des vrais SITES D'APPEL (".Nom(" avec le point et la parenthese colles au
  // nom) : le commentaire qui EXPLIQUE l'interdiction, plus haut dans ce meme fichier,
  // nomme les deux motifs en toutes lettres ("add_ErrorDataReceived / BeginErrorReadLine
  // / add_OutputDataReceived") sans jamais les appeler -- une recherche de sous-chaine nue
  // s'y accrocherait a tort.
  assert.ok(!/\.\s*BeginErrorReadLine\s*\(/.test(TEXTE_PRODUIT),
    'un appel .BeginErrorReadLine( trouve dans open-produit.ps1');
  assert.ok(!/\.\s*add_ErrorDataReceived\s*\(/.test(TEXTE_PRODUIT),
    'un appel .add_ErrorDataReceived( trouve dans open-produit.ps1');
  assert.ok(!/StandardOutput\.ReadLine\(\)/.test(TEXTE_PRODUIT),
    'un ReadLine() synchrone sur StandardOutput a ete trouve (il faut ReadLineAsync, ou ReadToEndAsync)');
  // Ceinture et bretelles : aucun appel ".ReadLine()" synchrone nu (sans le suffixe Async)
  // nulle part, qu'il porte sur stdout ou un flux enveloppe autrement.
  assert.ok(!/\.ReadLine\(\)/.test(TEXTE_PRODUIT),
    'un appel .ReadLine() synchrone (sans Async) a ete trouve dans open-produit.ps1');
});

// ---- Bonus : Invoke-SzhManuscrit, pour de vrai, contre un faux manuscrit-nettoyer.py ---
// Pas demande explicitement par les quatre controles ci-dessus, mais le brief insiste :
// "fabrique un faux script Python jetable qui imite ce contrat" pour verifier l'assistant.
// La WSL SZH-Publishing est presente et repond sur ce poste de developpement (mesure) ;
// gardee par sansPowerShell tout de meme, jamais un vrai wsl.exe requis en dur.
function executerPiloteManuscrit(corpsSupplementaire, envSupplementaire) {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-pilote-'));
  const baseJetable = path.join(travail, 'SZH-base');
  const sortie = path.join(travail, 'r.json');
  const pilote = path.join(travail, 'p.ps1');
  const lignes = [
    '$ErrorActionPreference = "Stop"',
    // WinForms n'est PAS charge par szh-common.ps1 (c'est open-produit.ps1 qui le fait,
    // ligne ~78) : sans ces deux lignes, "New-Object System.Windows.Forms.Form" echoue
    // avec "Cannot find type" avant meme d'atteindre le code teste.
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '. "' + path.join(RACINE, 'windows', 'szh-common.ps1') + '"',
    // szh-common.ps1 (dot-source) : rien qu'il n'ecrit sur le disque a ce stade, mais
    // $env:SZH_BASE (pose plus bas, dans env) isole quand meme Write-SzhLog etc. de la
    // vraie production, jamais C:\ProgramData\SZH pendant une suite de tests.
    '$script:form = New-Object System.Windows.Forms.Form',
    '$script:preprocBoutons = @()',
  ].concat(corpsSupplementaire).concat([
    'Set-SzhJson "' + sortie.replace(/\\/g, '\\\\') + '" $r'
  ]);
  fs.writeFileSync(pilote, lignes.join('\r\n') + '\r\n', 'utf8');
  const env = Object.assign({}, process.env, { SZH_BASE: baseJetable }, envSupplementaire || {});
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  const resultat = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  fs.rmSync(travail, { recursive: true, force: true });
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', r: resultat };
}

// N'extrait QUE les definitions de fonctions dont ce fichier a besoin pour le pilote, sans
// dupliquer leur code a la main (qui divergerait du vrai fichier sans que rien ne le dise).
function extraireFonctions(texte, noms) {
  const blocs = [];
  for (const nom of noms) {
    const motifDebut = new RegExp('\\nfunction ' + nom + ' ?\\(?[^\\r\\n]*\\r?\\n');
    const mDebut = texte.match(motifDebut);
    assert.ok(mDebut, 'fonction introuvable dans open-produit.ps1 : ' + nom);
    const debutBloc = mDebut.index + 1;
    // Fin du bloc : la prochaine ligne qui commence par "function " ou par "$" a la colonne
    // 0 (debut de la section suivante), au meme niveau d'indentation (aucune des fonctions
    // visees ici n'a d'accolade fermante en colonne 0 avant sa toute derniere ligne).
    const reste = texte.slice(debutBloc + mDebut[0].length - 1);
    const mFin = reste.match(/\r?\n\}\r?\n/);
    assert.ok(mFin, 'fin de fonction introuvable pour ' + nom);
    const finBloc = debutBloc + mDebut[0].length - 1 + mFin.index + mFin[0].length;
    blocs.push(texte.slice(debutBloc, finBloc));
  }
  return blocs;
}

const FONCTIONS_NECESSAIRES = [
  'ConvertTo-SzhArgumentEchappe', 'ConvertTo-SzhArguments', 'Add-SzhLigneJournal',
  'Add-SzhEnteteJournal', 'ConvertFrom-SzhOctetsWsl', 'Get-SzhWslExePreproc',
  'Get-SzhDistroPreproc', 'Get-SzhCheminManuscritCli', 'Invoke-SzhWslBrut',
  'Get-SzhDistrosEnregistreesPreproc', 'ConvertTo-SzhCheminWsl',
  'ConvertTo-SzhCheminWindowsDepuisWsl', 'Test-SzhManuscritPret', 'Invoke-SzhManuscrit',
];
const CORPS_FONCTIONS = extraireFonctions(TEXTE_PRODUIT, FONCTIONS_NECESSAIRES);

// Un faux Consolas^Wjournal : une simple TextBox WinForms suffit, Add-SzhLigneJournal ne
// demande rien de plus (voir le vrai code : TextLength / AppendText / SelectionStart).
const CORPS_APPEL_COMMUN = [
  '$journalFaux = New-Object System.Windows.Forms.TextBox',
  '$journalFaux.Multiline = $true',
  '$script:preprocBoutons = @()',
];

function fabriquerScriptPython(dossier, lignes) {
  const chemin = path.join(dossier, 'manuscrit-nettoyer.py');
  fs.writeFileSync(chemin, lignes.join('\n') + '\n', 'utf8');
  return chemin;
}

// ---- Faux wsl.exe -- pour ne plus dependre d'une vraie distro sur la machine qui teste --
//
// Bug mesure le 21.09.2026 : "succes" et "code de sortie non nul" (ci-dessous) posaient
// SZH_MANUSCRIT_CLI et SZH_MANUSCRIT_DISTRO mais jamais SZH_MANUSCRIT_WSL_EXE -- Invoke-
// SzhManuscrit passait donc par le VRAI wsl.exe du poste (Get-WslExe, szh-common.ps1) pour
// verifier que la distribution existe (Test-SzhManuscritPret), avant meme d'atteindre le
// faux script Python. Vert sur un poste de developpement qui a reellement la distro SZH-
// Publishing ; rouge sur un runner CI sans WSL (le refus de distro absente arrive AVANT le
// faux CLI, jamais un JSON). Seul "distribution WSL absente" (plus bas) le controle deja
// pour de vrai avec le vrai wsl.exe -- lui, ca lui est egal QUELLE distro manque.
//
// Un .cmd qui relaie vers un petit script Node : le format des trois appels que ce fichier
// adresse a wsl.exe est fixe (`-l -q` ; `-d <distro> -e wslpath -a|-w <chemin>` ; `-d
// <distro> -e python3 <script> <args...>`), mais un parsing par position en pur batch est
// fragile des le 10e argument -- Node fait ca sans limite. wslpath : identite (aucun test
// n'inspecte la conversion elle-meme, seulement ce que le faux script Python rend).
// python3 : relaye vers PYTHON (gardes.js -- jamais un `python3` nu, le piege du stub
// WindowsApps qui gele un lancement, deja mesure ailleurs dans ce chantier).
function fabriquerFauxWsl(dossier) {
  const script = path.join(dossier, 'faux-wsl.js');
  fs.writeFileSync(script, [
    "'use strict';",
    "const { spawnSync } = require('child_process');",
    'const args = process.argv.slice(2);',
    "if (args[0] === '-l' && args[1] === '-q') {",
    "  process.stdout.write((process.env.SZH_MANUSCRIT_DISTRO || '') + '\\n');",
    '  process.exit(0);',
    '}',
    "const iE = args.indexOf('-e');",
    'if (iE === -1) {',
    "  process.stderr.write('faux-wsl : commande non reconnue (pas de -e)\\n');",
    '  process.exit(1);',
    '}',
    'const reste = args.slice(iE + 1);',
    "if (reste[0] === 'wslpath') {",
    '  process.stdout.write(reste[reste.length - 1] + \'\\n\');',
    '  process.exit(0);',
    '}',
    "if (reste[0] === 'python3') {",
    "  const r = spawnSync(process.env.SZH_MANUSCRIT_FAUX_PYTHON || 'python', reste.slice(1),",
    "    { stdio: 'inherit' });",
    '  process.exit(r.status === null ? 1 : r.status);',
    '}',
    "process.stderr.write('faux-wsl : commande non reconnue : ' + reste.join(' ') + '\\n');",
    'process.exit(1);',
  ].join('\n') + '\n', 'utf8');
  const cmd = path.join(dossier, 'faux-wsl.cmd');
  fs.writeFileSync(cmd, '@echo off\r\nnode "%~dp0faux-wsl.js" %*\r\nexit /b %errorlevel%\r\n', 'utf8');
  return cmd;
}

test('Invoke-SzhManuscrit : succes - JSON de stdout lu, lignes de stderr dans le journal, dossier propose',
  { skip: sansPowerShell || sansPython }, () => {
    const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-cli-'));
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-'));
    const manuscrit = path.join(manuscritsDir, 'brouillon.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable, jamais lu par le faux script', 'utf8');
    const cli = fabriquerScriptPython(travailScript, [
      'import sys, json',
      "print('etape 1/3 : lecture', file=sys.stderr)",
      "print('etape 2/3 : typographie', file=sys.stderr)",
      "print('etape 3/3 : ecriture', file=sys.stderr)",
      "print(json.dumps({'alertes': 2, 'erreurs': 0}))",
      'sys.exit(0)',
    ]);
    const fauxWsl = fabriquerFauxWsl(travailScript);

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok; texte = $resultat.texte; stats = $resultat.stats; ' +
        'dossier = $resultat.dossier; journal = $journalFaux.Text }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
    });

    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat JSON produit - stderr : ' + r.stderr);
    assert.strictEqual(r.r.ok, true, 'ok devrait etre vrai - ' + JSON.stringify(r.r));
    assert.ok(r.r.stats && r.r.stats.alertes === 2, 'stats.alertes non retrouve - ' + JSON.stringify(r.r.stats));
    assert.match(r.r.journal, /etape 1\/3/, 'la ligne de progression 1 n\'est pas dans le journal');
    assert.match(r.r.journal, /etape 3\/3/, 'la ligne de progression 3 n\'est pas dans le journal');
    assert.strictEqual(path.resolve(r.r.dossier), path.resolve(manuscritsDir),
      'le dossier propose n\'est pas celui du manuscrit');
  });

test('Invoke-SzhManuscrit : code de sortie non nul - ok:false, la raison arrive dans le journal',
  { skip: sansPowerShell || sansPython }, () => {
    const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-cli-echec-'));
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-echec-'));
    const manuscrit = path.join(manuscritsDir, 'suivi-modif.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable', 'utf8');
    const cli = fabriquerScriptPython(travailScript, [
      'import sys',
      "print('refus : document en suivi de modifications', file=sys.stderr)",
      'sys.exit(1)',
    ]);
    const fauxWsl = fabriquerFauxWsl(travailScript);

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok; journal = $journalFaux.Text }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
    });

    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat JSON produit - stderr : ' + r.stderr);
    assert.strictEqual(r.r.ok, false, 'ok devrait etre faux apres un code de sortie non nul');
    assert.match(r.r.journal, /refus : document en suivi de modifications/,
      'la raison du refus n\'apparait pas dans le journal');
  });

test('Invoke-SzhManuscrit : distribution WSL absente - message clair, jamais une trace brute',
  { skip: sansPowerShell }, () => {
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-abs-'));
    const manuscrit = path.join(manuscritsDir, 'brouillon.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable', 'utf8');

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok; texte = $resultat.texte }',
    ]), { SZH_MANUSCRIT_DISTRO: 'SZH-Distro-Qui-N-Existe-Pas' });

    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat JSON produit - stderr : ' + r.stderr);
    assert.strictEqual(r.r.ok, false);
    assert.ok(!/Exception|StackTrace|at System\./.test(r.r.texte),
      'le message ressemble a une trace d\'erreur brute : ' + r.r.texte);
    assert.match(r.r.texte, /SZH-Distro-Qui-N-Existe-Pas/,
      'le message ne nomme pas la distribution manquante : ' + r.r.texte);
  });
