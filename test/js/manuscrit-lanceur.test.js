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

// ---- Controle n5 : --format atteint vraiment la CLI (point 4 du chantier "gabarits Pronto
// FR/DE + ODT", 29.09.2026) -- pas seulement une chaine litterale dans le script, une preuve
// bout en bout : le faux script Python ecrit sys.argv sur le disque, le test relit ce fichier.
test('Invoke-SzhManuscrit passe --format <valeur> a la CLI, quel que soit le format choisi',
  { skip: sansPowerShell || sansPython }, () => {
    const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-cli-format-'));
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-format-'));
    const manuscrit = path.join(manuscritsDir, 'brouillon.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable', 'utf8');
    const argvPath = path.join(travailScript, 'argv.json');
    const cli = fabriquerScriptPython(travailScript, [
      'import sys, json',
      'with open(' + JSON.stringify(argvPath) + ", 'w', encoding='utf-8') as f:",
      '    json.dump(sys.argv[1:], f)',
      "print(json.dumps({'alertes': 0, 'erreurs': 0}))",
      'sys.exit(0)',
    ]);
    const fauxWsl = fabriquerFauxWsl(travailScript);

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "zeitschrift" ' +
        '-Format "odt" -Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
    });

    // argv.json est lu AVANT de nettoyer travailScript (qui le contient) -- l'inverse a
    // deja fait echouer une premiere version de ce test (fichier supprime avant lecture).
    const argvExiste = fs.existsSync(argvPath);
    const argv = argvExiste ? JSON.parse(fs.readFileSync(argvPath, 'utf8')) : null;
    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r && r.r.ok, 'Invoke-SzhManuscrit a echoue - ' + JSON.stringify(r.r));
    assert.ok(argvExiste, 'argv.json n\'a pas ete ecrit par le faux script - la CLI n\'a jamais tourne');
    const iFormat = argv.indexOf('--format');
    assert.ok(iFormat !== -1, '--format absent des arguments passes a la CLI : ' + JSON.stringify(argv));
    assert.strictEqual(argv[iFormat + 1], 'odt',
      'la valeur de --format n\'est pas "odt" : ' + JSON.stringify(argv));
  });

// Meme preuve, valeur par defaut (aucun -Format passe) : rétrocompatible, --format docx quand
// meme transmis explicitement (jamais un simple silence qui laisserait la CLI deviner).
test('Invoke-SzhManuscrit : sans -Format explicite, "docx" part quand meme sur la ligne de commande',
  { skip: sansPowerShell || sansPython }, () => {
    const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-cli-format-defaut-'));
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-format-defaut-'));
    const manuscrit = path.join(manuscritsDir, 'brouillon.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable', 'utf8');
    const argvPath = path.join(travailScript, 'argv.json');
    const cli = fabriquerScriptPython(travailScript, [
      'import sys, json',
      'with open(' + JSON.stringify(argvPath) + ", 'w', encoding='utf-8') as f:",
      '    json.dump(sys.argv[1:], f)',
      "print(json.dumps({'alertes': 0, 'erreurs': 0}))",
      'sys.exit(0)',
    ]);
    const fauxWsl = fabriquerFauxWsl(travailScript);

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
    });

    const argvExiste = fs.existsSync(argvPath);
    const argv = argvExiste ? JSON.parse(fs.readFileSync(argvPath, 'utf8')) : null;
    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r && r.r.ok, 'Invoke-SzhManuscrit a echoue - ' + JSON.stringify(r.r));
    assert.ok(argvExiste, 'argv.json n\'a pas ete ecrit par le faux script - la CLI n\'a jamais tourne');
    const iFormat = argv.indexOf('--format');
    assert.ok(iFormat !== -1, '--format absent des arguments passes a la CLI : ' + JSON.stringify(argv));
    assert.strictEqual(argv[iFormat + 1], 'docx',
      'la valeur par defaut de --format n\'est pas "docx" : ' + JSON.stringify(argv));
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
  // SZH_LANGUE=fr : sans elle, T suit la langue du compte qui lance les tests.
  const env = Object.assign({}, process.env, { SZH_BASE: baseJetable, SZH_LANGUE: 'fr' }, envSupplementaire || {});
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
  'New-SzhRapportTemporaire', 'Remove-SzhRapportTemporaire', 'Show-SzhResultatPreproc',
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

// Sabotage : dans Invoke-SzhManuscrit, remettre `Add-SzhLigneJournal $Journal $ligneVuePreproc`
// dans la boucle de lecture de stderr -- les lignes de progression reviennent dans le journal.
test('Invoke-SzhManuscrit : succes - JSON de stdout lu, progression NON recopiee dans le journal, dossier propose',
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
    assert.doesNotMatch(r.r.journal, /etape \d\/3/, 'la progression de la CLI ne doit plus etre dans le journal : ' + r.r.journal);
    assert.match(r.r.journal, /brouillon\.docx/, 'le manuscrit traite doit etre nomme dans le journal');
    assert.strictEqual(path.resolve(r.r.dossier), path.resolve(manuscritsDir),
      'le dossier propose n\'est pas celui du manuscrit');
  });

test('Invoke-SzhManuscrit : code de sortie non nul - ok:false, une phrase courte, la cause dans `detail` et pas dans le journal',
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
      '$r = [ordered]@{ ok = $resultat.ok; texte = $resultat.texte; detail = $resultat.detail; journal = $journalFaux.Text }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
    });

    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat JSON produit - stderr : ' + r.stderr);
    assert.strictEqual(r.r.ok, false, 'ok devrait etre faux apres un code de sortie non nul');
    assert.match(r.r.detail, /refus : document en suivi de modifications/,
      'la cause doit rester disponible dans `detail`, pour le journal technique');
    assert.doesNotMatch(r.r.texte + r.r.journal, /refus : document en suivi/,
      'la progression de la CLI ne doit pas arriver a l\'ecran');
    assert.match(r.r.texte, /^Le nettoyage a échoué\. Réessayez/, 'une phrase qui dit quoi faire : ' + r.r.texte);
  });

// ---- Code 1 (CODE_ALERTE_ERROR, §8 du contrat) : un nettoyage REUSSI, pas un echec -----
// Robin l'a vu en vrai sur le lanceur : .docx ecrit, annote, rapport ecrit, et pourtant
// "Raison inconnue" a l'ecran parce que le code de sortie n'est pas 0. Ce test prouve le
// correctif : ok:true, le message porte les trois nombres (alertes error, revisions,
// commentaires) sans jamais nommer le code de sortie -- ce dernier ne vit QUE dans les
// revisions/commentaires releves sur le rapport ecrit sur le disque, jamais sur la ligne
// JSON de stdout (§8 : elle ne porte que les compteurs d'alertes).
test('Invoke-SzhManuscrit : code 1 (alerte error) - succes avec des points a traiter, drapeau alertesBloquantes',
  { skip: sansPowerShell || sansPython }, () => {
    const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-cli-alerte-'));
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-alerte-'));
    const manuscrit = path.join(manuscritsDir, 'brouillon.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable, jamais lu par le faux script', 'utf8');
    const rapportPath = path.join(travailScript, 'brouillon-rapport.json');
    const cli = fabriquerScriptPython(travailScript, [
      'import sys, json',
      "print('lecture du manuscrit...', file=sys.stderr)",
      "print('annotation : 4 revision(s), 3 commentaire(s), 0 renvoyee(s) au rapport', file=sys.stderr)",
      'with open(' + JSON.stringify(rapportPath) + ", 'w', encoding='utf-8') as f:",
      "    json.dump({'compteurs': {'revisions': 4, 'commentaires_poses': 3}}, f)",
      "print('58 alerte(s) (2 error, 1 warning, 0 suggestion)', file=sys.stderr)",
      "print('termine en 500 ms (code de sortie 1)', file=sys.stderr)",
      'print(json.dumps({' +
        "'entree': " + JSON.stringify(manuscrit) + ', ' +
        "'sortie_rapport': " + JSON.stringify(rapportPath) + ', ' +
        "'alertes_total': 3, 'alertes_error': 2, 'alertes_warning': 1, 'alertes_suggestion': 0, " +
        "'code_sortie': 1}))",
      'sys.exit(1)',
    ]);
    const fauxWsl = fabriquerFauxWsl(travailScript);

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok; texte = $resultat.texte; alertesBloquantes = $resultat.alertesBloquantes; ' +
        'stats = $resultat.stats; dossier = $resultat.dossier }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
    });

    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat JSON produit - stderr : ' + r.stderr);
    assert.strictEqual(r.r.ok, true,
      'un code 1 avec alerte error doit rester un succes - ' + JSON.stringify(r.r));
    assert.strictEqual(r.r.alertesBloquantes, true);
    assert.ok(!/code de sortie|exit ?code/i.test(r.r.texte),
      'le code de sortie a fuite dans le message : ' + r.r.texte);
    // Les compteurs d'alertes voyagent sur la ligne de stdout ; le journal les dit dans
    // Show-SzhResultatPreproc (voir les tests de ce nom plus bas).
    assert.strictEqual(r.r.stats.alertes_error, 2);
    // Le rapport est bien celui ecrit par la CLI (chemin porte par stdout, releve sur le
    // disque) : c'est de la que Show-SzhResultatPreproc le rend et l'ouvre, exactement
    // comme pour un code 0 -- $resultat.ok et $resultat.dossier suffisent a cet appelant.
    assert.ok(r.r.stats && r.r.stats.sortie_rapport, 'sortie_rapport absent des stats');
    assert.strictEqual(path.resolve(r.r.dossier), path.resolve(manuscritsDir),
      'le dossier propose n\'est pas celui du manuscrit');
  });

// ---- Code 3 (CODE_ECHEC_INTERNE) et tout code inattendu : un vrai echec, mais utile -----
test('Invoke-SzhManuscrit : code 3 (echec interne) - ok:false, une phrase courte, les dernieres lignes de stderr dans `detail`',
  { skip: sansPowerShell || sansPython }, () => {
    const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-cli-interne-'));
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-interne-'));
    const manuscrit = path.join(manuscritsDir, 'illisible.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable', 'utf8');
    const cli = fabriquerScriptPython(travailScript, [
      'import sys',
      "print('entree : illisible.docx (produit=revue)', file=sys.stderr)",
      "print('lecture du manuscrit...', file=sys.stderr)",
      "print('lecture impossible : document corrompu', file=sys.stderr)",
      "print('termine en 80 ms (code de sortie 3)', file=sys.stderr)",
      'sys.exit(3)',
    ]);
    const fauxWsl = fabriquerFauxWsl(travailScript);

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok; texte = $resultat.texte; detail = $resultat.detail; alertesBloquantes = $resultat.alertesBloquantes }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
    });

    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat JSON produit - stderr : ' + r.stderr);
    assert.strictEqual(r.r.ok, false, 'un code 3 reste un echec - ' + JSON.stringify(r.r));
    assert.strictEqual(r.r.alertesBloquantes, false);
    // La cause technique reste disponible (journal du lanceur), jamais a l'ecran.
    assert.match(r.r.detail, /lecture impossible/, 'la derniere cause utile n\'est pas dans `detail` : ' + r.r.detail);
    assert.match(r.r.detail, /document corrompu/, 'le detail de la cause n\'est pas dans `detail` : ' + r.r.detail);
    assert.doesNotMatch(r.r.detail, /code de sortie|exit ?code/i, 'le code de sortie a fuite dans `detail`');
    assert.doesNotMatch(r.r.texte, /corrompu|lecture impossible/, 'la cause technique ne doit pas etre a l\'ecran : ' + r.r.texte);
    assert.match(r.r.texte, /^Le nettoyage a échoué\. Réessayez/, 'une phrase qui dit quoi faire : ' + r.r.texte);
  });

test('Invoke-SzhManuscrit : distribution WSL absente - message clair, jamais une trace brute',
  { skip: sansPowerShell }, () => {
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-abs-'));
    const manuscrit = path.join(manuscritsDir, 'brouillon.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable', 'utf8');

    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$r = [ordered]@{ ok = $resultat.ok; texte = $resultat.texte; journal = $journalFaux.Text }',
    ]), { SZH_MANUSCRIT_DISTRO: 'SZH-Distro-Qui-N-Existe-Pas' });

    fs.rmSync(manuscritsDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat JSON produit - stderr : ' + r.stderr);
    assert.strictEqual(r.r.ok, false);
    // Le message est dit UNE fois, par Show-SzhResultatPreproc : Invoke ne le recopie pas dans
    // le journal (sabotage : y remettre `Add-SzhLigneJournal $Journal $textePreproc` dans le catch).
    assert.doesNotMatch(r.r.journal, /SZH-Distro-Qui-N-Existe-Pas/,
      'le message d\'echec ne doit pas etre ecrit par Invoke-SzhManuscrit (doublon avec Show) : ' + r.r.journal);
    assert.ok(!/Exception|StackTrace|at System\./.test(r.r.texte),
      'le message ressemble a une trace d\'erreur brute : ' + r.r.texte);
    assert.match(r.r.texte, /SZH-Distro-Qui-N-Existe-Pas/,
      'le message ne nomme pas la distribution manquante : ' + r.r.texte);
  });

// ---- Le journal de l'onglet : l'essentiel seulement ------------------------------------------
// Show-SzhResultatPreproc est pilote avec une fausse page HTML (New-SzhRapportManuscrit est
// remplacee : le rendu reel a ses propres tests, manuscrit-rapport.test.js). Les textes
// attendus sont ceux de szh-textes.ps1, espaces insecables ramenees a des espaces.
const sansNbsp = (s) => String(s).replace(/\u00a0/g, ' ');

function lignesJournal(texte) {
  return sansNbsp(texte).split(/\r?\n/).filter((l) => l.length > 0);
}

// Un journal par scenario ; chaque scenario recoit son propre fichier temporaire, dont le
// pilote dit s'il existe encore apres Show-SzhResultatPreproc. ASCII seul dans le code du
// pilote (il est ecrit sans BOM, PowerShell 5.1 le lirait en ANSI).
function pilotePourShow(tempDir) {
  const t = tempDir.replace(/\\/g, '/');
  const scenario = (nom, corps) => [
    '$script:journalPreproc = New-Object System.Windows.Forms.TextBox',
    '$script:journalPreproc.Multiline = $true',
    '$tmp = "' + t + '/rapport-' + nom + '.json"',
    'Set-Content -LiteralPath $tmp -Value "{}"',
    corps,
    '$r["' + nom + '"] = $script:journalPreproc.Text',
    '$r["' + nom + 'Temp"] = (Test-Path -LiteralPath $tmp)',
  ].join('\r\n');
  const stats = (extra) => '([pscustomobject]@{ entree = "/mnt/c/Users/robin/Downloads/DOCX a TEST/a.docx"; ' +
    'sortie = "/mnt/c/Users/robin/Downloads/DOCX a TEST/a-nettoye.docx"; ' + extra + ' })';
  const resultat = (ok, texte, st, bloquant) => '$res = [pscustomobject]@{ ok = $' + ok + '; texte = "' + texte + '"; ' +
    'stats = ' + st + '; dossier = ""; produit = "revue"; alertesBloquantes = $' + bloquant + '; ' +
    'manuscrit = "C:/Users/robin/Downloads/DOCX a TEST/a.docx"; detail = ""; rapportTemporaire = $tmp }';
  return [
    '$script:boutonPreprocDossier = New-Object System.Windows.Forms.Button',
    '$script:preprocDossierCourant = ""',
    '$script:stubRendu = "ok"',
    'function New-SzhRapportManuscrit { param($Stats, $Produit, $CheminManuscrit, $CheminRapportJson)',
    '  if ($script:stubRendu -eq "echec") { throw "rendre-gabarit.js : panne simulee" }',
    '  return "C:/dossier/a-rapport.html" }',
    '$r = [ordered]@{}',
    scenario('succes', resultat('true', '', stats('alertes_error = 0; alertes_warning = 5; alertes_suggestion = 12'), 'false') + '\r\nShow-SzhResultatPreproc $res'),
    scenario('bloquant', resultat('true', '', stats('alertes_error = 2; alertes_warning = 1; alertes_suggestion = 0'), 'true') + '\r\nShow-SzhResultatPreproc $res'),
    scenario('refus', resultat('true', '', '([pscustomobject]@{ entree = "/mnt/c/x/a.docx"; refus = $true; code_refus = "suivi-modifications"; ' +
      'message = "52 modification(s) suivie(s) non acceptee(s). Acceptez-les ou refusez-les dans Word, puis relancez." })', 'false') + '\r\nShow-SzhResultatPreproc $res'),
    scenario('echec', resultat('false', 'Le nettoyage a echoue.', '$null', 'false') + '\r\nShow-SzhResultatPreproc $res'),
    scenario('rendu', '$script:stubRendu = "echec"\r\n' + resultat('true', '', stats('alertes_error = 0; alertes_warning = 0; alertes_suggestion = 0'), 'false') + '\r\nShow-SzhResultatPreproc $res'),
  ];
}

// Sabotage (trois, chacun remis ensuite) :
//  1. dans Show-SzhResultatPreproc, retirer la ligne « Add-SzhLigneJournal ... resultat.compte » --
//     le compteur d'alertes disparait (succes, bloquant, rendu).
//  2. y retirer `Remove-SzhRapportTemporaire` du finally -- un fichier reste (les cinq scenarios).
//  3. y remettre un second `Add-SzhLigneJournal` du message de refus -- le doublon reapparait.
test('Show-SzhResultatPreproc : journal concis (succes, erreurs, refus, echec, rendu en panne), jamais un chemin, temporaire supprime',
  { skip: sansPowerShell }, () => {
    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-journal-temp-'));
    let r;
    try {
      r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat(pilotePourShow(tempDir)), {});
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r, 'aucun resultat produit - stderr : ' + r.stderr);

    assert.deepStrictEqual(lignesJournal(r.r.succes), [
      '✓ Nettoyage terminé : a-nettoye.docx',
      'Rapport : a-rapport.html',
      'Alertes : 0 erreur(s), 5 avertissement(s), 12 suggestion(s).',
    ]);
    assert.deepStrictEqual(lignesJournal(r.r.bloquant), [
      '⚠ Nettoyage terminé : a-nettoye.docx (des erreurs restent à traiter).',
      'Rapport : a-rapport.html',
      'Alertes : 2 erreur(s), 1 avertissement(s), 0 suggestion(s).',
    ]);
    // Un refus : UNE seule ligne, la phrase de la CLI, une fois.
    assert.deepStrictEqual(lignesJournal(r.r.refus), [
      '⚠ Refusé : 52 modification(s) suivie(s) non acceptee(s). Acceptez-les ou refusez-les dans Word, puis relancez.',
    ]);
    assert.deepStrictEqual(lignesJournal(r.r.echec), ['⚠ Le nettoyage a echoue.']);
    // Rendu de la page en panne : le resultat reste dit, la panne en une ligne, pas de « Rapport : ».
    assert.deepStrictEqual(lignesJournal(r.r.rendu), [
      '✓ Nettoyage terminé : a-nettoye.docx',
      'Alertes : 0 erreur(s), 0 avertissement(s), 0 suggestion(s).',
      'Erreur : rendre-gabarit.js : panne simulee',
    ]);
    for (const nom of ['succes', 'bloquant', 'refus', 'echec', 'rendu']) {
      assert.doesNotMatch(r.r[nom], /\/mnt\/|import-avertissement|manuscrit-nettoyer\]|C:\\|C:\//,
        nom + ' : un chemin ou une etiquette technique a fuite : ' + r.r[nom]);
      assert.strictEqual(r.r[nom + 'Temp'], false, nom + ' : le fichier temporaire n\'a pas ete supprime');
    }
  });

// ---- Le JSON du rapport part dans un fichier temporaire, jamais a cote du manuscrit ---------
// Fausse CLI : note son argv, ecrit le rapport ou on le lui dit (--rapport), comme la vraie.
// TEMP/TMP sont dirigees vers un dossier du test, pour voir ce que le lanceur y depose.
//
// Sabotage : dans Invoke-SzhManuscrit, retirer '--rapport', $rapportWslPreproc des arguments --
// `--rapport` n'arrive plus a la CLI, qui ecrit le JSON a cote du manuscrit.
test('Invoke-SzhManuscrit : --rapport vise un fichier temporaire (barres obliques), rien ne reste a cote du manuscrit, Remove-SzhRapportTemporaire le supprime',
  { skip: sansPowerShell || sansPython }, () => {
    const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-cli-rapport-'));
    const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-rapport-'));
    const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-temp-'));
    const manuscrit = path.join(manuscritsDir, 'brouillon.docx');
    fs.writeFileSync(manuscrit, 'contenu jetable', 'utf8');
    const argvPath = path.join(travailScript, 'argv.json');
    const cli = fabriquerScriptPython(travailScript, [
      'import sys, json',
      'with open(' + JSON.stringify(argvPath) + ", 'w', encoding='utf-8') as f:",
      '    json.dump(sys.argv[1:], f)',
      'args = sys.argv[1:]',
      "chemin = args[args.index('--rapport') + 1] if '--rapport' in args else args[0] + '-rapport.json'",
      "with open(chemin, 'w', encoding='utf-8') as f:",
      "    json.dump({'produit': 'revue'}, f)",
      "print(json.dumps({'sortie_rapport': chemin, 'alertes_error': 0}))",
      'sys.exit(0)',
    ]);
    const fauxWsl = fabriquerFauxWsl(travailScript);
    const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
      '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit.replace(/\\/g, '/') + '" -Produit "revue" ' +
        '-Journal $journalFaux -NomExport "test"',
      '$avant = Test-Path -LiteralPath $resultat.rapportTemporaire',
      'Remove-SzhRapportTemporaire $resultat.rapportTemporaire',
      '$apres = Test-Path -LiteralPath $resultat.rapportTemporaire',
      '$r = [ordered]@{ ok = $resultat.ok; temporaire = $resultat.rapportTemporaire; avant = $avant; apres = $apres }',
    ]), {
      SZH_MANUSCRIT_CLI: cli, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
      SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
      TEMP: tempDir, TMP: tempDir,
    });

    const argv = fs.existsSync(argvPath) ? JSON.parse(fs.readFileSync(argvPath, 'utf8')) : null;
    const restes = fs.readdirSync(manuscritsDir);
    const restesTemp = fs.readdirSync(tempDir);
    fs.rmSync(travailScript, { recursive: true, force: true });
    fs.rmSync(manuscritsDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });

    assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
    assert.ok(r.r && r.r.ok, 'Invoke-SzhManuscrit a echoue - ' + JSON.stringify(r && r.r));
    assert.ok(argv, 'la CLI n\'a jamais tourne');
    const iRapport = argv.indexOf('--rapport');
    assert.ok(iRapport !== -1, '--rapport absent des arguments : ' + JSON.stringify(argv));
    const cible = argv[iRapport + 1];
    assert.ok(!cible.includes('\\'), 'le chemin passe a la CLI doit etre en barres obliques : ' + cible);
    assert.strictEqual(path.dirname(path.resolve(cible)), path.resolve(tempDir), 'le JSON doit viser %TEMP%, pas ' + cible);
    assert.match(path.basename(cible), /^szh-rapport-manuscrit-[0-9a-f]{32}\.json$/);
    assert.deepStrictEqual(restes, ['brouillon.docx'], 'rien ne doit etre ecrit a cote du manuscrit : ' + restes);
    assert.strictEqual(r.r.avant, true, 'la CLI devait avoir ecrit le JSON temporaire');
    assert.strictEqual(r.r.apres, false, 'Remove-SzhRapportTemporaire n\'a pas supprime le fichier');
    assert.deepStrictEqual(restesTemp, [], 'le dossier temporaire doit etre vide apres suppression');
  });

// ---- Bout en bout avec la VRAIE CLI : le journal d'un refus, le dossier du manuscrit --------
// La vraie CLI (Python de ce poste, via le faux wsl.exe) sur un .docx en suivi de
// modifications, puis Show-SzhResultatPreproc : une phrase, pas de doublon, pas de chemin ;
// et rien d'autre que le manuscrit dans son dossier.
function fabriquerDocxSuivi(chemin, auteur) {
  const r = spawnSync(PYTHON, ['-c', [
    'import sys, zipfile',
    'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'corps = ("<w:p><w:r><w:t>Titre</w:t></w:r></w:p><w:p><w:ins w:id=\\"1\\" w:author=\\"%s\\" w:date=\\"2026-01-01T00:00:00Z\\">"',
    '         "<w:r><w:t>Texte ajoute.</w:t></w:r></w:ins></w:p>") % sys.argv[2]',
    'doc = \'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s"><w:body>%s</w:body></w:document>\' % (W, corps)',
    'styles = \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s"/>\' % W',
    'with zipfile.ZipFile(sys.argv[1], "w") as z:',
    '    z.writestr("word/document.xml", doc.encode("utf-8"))',
    '    z.writestr("word/styles.xml", styles.encode("utf-8"))',
    '    z.writestr("[Content_Types].xml", \'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>\')',
  ].join('\n'), chemin, auteur], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

const NETTOYEUR_REEL = path.join(RACINE, 'pipeline', 'manuscrit-nettoyer.py');

for (const [nomFichier, auteur, attendu] of [
  ['suivi.docx', 'Marie Dupont', 'Refusé : 1 modification(s) suivie(s) non acceptée(s). Acceptez-les ou refusez-les dans Word, puis relancez.'],
  ['origine-nettoye.docx', 'Relecture automatique', 'Refusé : Ce fichier est déjà la sortie du nettoyeur : ouvrez le manuscrit d’origine.'],
]) {
  test('journal d\'un refus (vraie CLI) : ' + nomFichier + ' -> une seule phrase, rien ne reste a cote du manuscrit',
    { skip: sansPowerShell || sansPython }, () => {
      const travailScript = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-refus-reel-'));
      const manuscritsDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-doc-refus-'));
      const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-manuscrit-temp-refus-'));
      const manuscrit = path.join(manuscritsDir, nomFichier);
      fabriquerDocxSuivi(manuscrit, auteur);
      const fauxWsl = fabriquerFauxWsl(travailScript);
      const r = executerPiloteManuscrit(CORPS_FONCTIONS.concat(CORPS_APPEL_COMMUN).concat([
        '$script:journalPreproc = $journalFaux',
        '$script:boutonPreprocDossier = New-Object System.Windows.Forms.Button',
        'function New-SzhRapportManuscrit { param($Stats, $Produit, $CheminManuscrit, $CheminRapportJson) return "" }',
        '$resultat = Invoke-SzhManuscrit -CheminManuscrit "' + manuscrit.replace(/\\/g, '/') + '" -Produit "revue" ' +
          '-Journal $journalFaux -NomExport "test"',
        'Show-SzhResultatPreproc $resultat',
        '$r = [ordered]@{ journal = $journalFaux.Text }',
      ]), {
        SZH_MANUSCRIT_CLI: NETTOYEUR_REEL, SZH_MANUSCRIT_DISTRO: 'SZH-Publishing',
        SZH_MANUSCRIT_WSL_EXE: fauxWsl, SZH_MANUSCRIT_FAUX_PYTHON: PYTHON,
        TEMP: tempDir, TMP: tempDir,
      });
      const restes = fs.readdirSync(manuscritsDir);
      const restesTemp = fs.readdirSync(tempDir);
      fs.rmSync(travailScript, { recursive: true, force: true });
      fs.rmSync(manuscritsDir, { recursive: true, force: true });
      fs.rmSync(tempDir, { recursive: true, force: true });

      assert.ok(r && r.status === 0, 'le pilote a echoue - ' + (r ? r.stderr : ''));
      assert.ok(r.r, 'aucun resultat produit - stderr : ' + r.stderr);
      const lignes = lignesJournal(r.r.journal);
      assert.strictEqual(lignes.length, 3, 'entete + manuscrit + UNE ligne de refus : ' + JSON.stringify(lignes));
      assert.match(lignes[0], /^\[\d\d:\d\d\] test$/);
      assert.strictEqual(lignes[1], 'Manuscrit : ' + nomFichier);
      assert.strictEqual(lignes[2], '⚠ ' + sansNbsp(attendu));
      assert.doesNotMatch(r.r.journal, /\/mnt\/|\[manuscrit-nettoyer\]|import-avertissement|w:ins/);
      assert.deepStrictEqual(restes, [nomFichier], 'rien ne doit etre ecrit a cote du manuscrit : ' + restes);
      assert.deepStrictEqual(restesTemp, [], 'le dossier temporaire doit etre vide : ' + restesTemp);
    });
}
