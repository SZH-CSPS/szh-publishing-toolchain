// Le raccourci posé à la racine de chaque numéro, et le verbe de lien qu'il porte.
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici est un double chemin absolu. « Ouvrir la revue.lnk » (« Ouvrir le
// livre.lnk ») vit DANS le dossier du numéro, donc OneDrive le recopie sur l'autre poste —
// et il y arrivait mort, deux fois plutôt qu'une :
//   * sa CIBLE était l'exécutable de l'éditeur, qui s'installe sous le profil de
//     l'utilisateur, donc à un chemin qui contient le nom du compte Windows ;
//   * son ARGUMENT était le chemin absolu du dossier du numéro, qui contient lui aussi le
//     nom du compte.
// Sur le poste d'en face, les deux chemins désignent un compte qui n'existe pas : le
// double-clic ne fait rien, et rien ne dit pourquoi.
//
// La forme retenue ne contient plus aucun chemin qui dépend du poste ou du compte : elle
// vise wscript.exe (sous %WINDIR%) et les deux scripts du toolkit (sous C:\ProgramData,
// racine MACHINE), et désigne le numéro par un lien « szh:// » — un nom de produit et un
// IDENTIFIANT (`id:` du manifeste, depuis le 23.09.2026 : plus le nom du dossier), que le
// lanceur résout dans les racines qu'il connaît en ouvrant chaque manifeste candidat. C'est
// ce second changement qui rend le lien valable après un renommage ou un archivage du
// dossier, là où un lien par nom mourait au premier des deux.
//
// Cinq choses à garder, donc :
//   1. la composition du raccourci : aucune des deux racines de chemin ne sort de
//      %WINDIR% ni du toolkit, et le chemin du numéro n'y figure nulle part ;
//   2. la grammaire du second verbe : acceptée pour ce qu'elle doit accepter, refusée pour
//      tout le reste — un lien vient d'un courriel ou d'un .lnk recopié, jamais de nous ;
//   3. l'alignement PowerShell / JavaScript des DEUX grammaires, littéral ET comportement ;
//   4. la résolution, qui doit atteindre la racine de production ET reconnaître l'id, pas
//      le nom du dossier ;
//   5. l'id est posé s'il manque (Set-SzhAusgabeIdSiAbsent), jamais recalculé s'il existe.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const PRODUITS_PS1 = lire('windows', 'szh-produits.ps1');
const SHELL_PS1 = lire('windows', 'szh-shell.ps1');
const COMMUN_PS1 = lire('windows', 'szh-common.ps1');
const MIGRATION_PS1 = lire('windows', 'szh-migration.ps1');
const liens = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'liens.js'));

// La racine MACHINE du toolkit, telle qu'elle vaut sur un vrai poste. Lue dans la source et
// non recopiée : c'est d'elle que vient toute la portabilité du raccourci, et le banc
// redirige $SzhBase vers une arborescence jetable pour ne rien écrire dans la vraie.
const BASE_REELLE = (COMMUN_PS1.match(/\$script:SzhBase\s*=\s*'([^']+)'/) || [])[1];
assert.ok(BASE_REELLE, 'szh-common.ps1 ne déclare plus $script:SzhBase');
const TOOLKIT_REEL = path.join(BASE_REELLE, 'toolkit');

// Détection partagée (gardes.js) : sous un runner simulé sans PowerShell, elle rend
// « indisponible » au lieu d'appeler le vrai powershell.exe.
const { POWERSHELL, sansPowerShell } = require('./gardes');

// ---- Les identifiants du corpus : 16 caractères [A-Za-z0-9], la forme exacte de `id:` ----
const ID_NUM = 'Ab12Cd34Ef56Gh78';       // revue, en cours (« 2026-01 »)
const ID_ZS = 'Zz98Yy76Xx54Ww32';        // zeitschrift, en cours (« 2026-03 »)
const ID_LIVRE = 'Bk11Bk22Bk33Bk44';     // livre, aux archives

// ---- Le corpus de liens, éprouvé des deux côtés ----
// Les mêmes chaînes passent par Get-SzhLien (PowerShell) et par analyserLien (JavaScript) :
// c'est le seul moyen de prouver que les deux grammaires ne sont pas seulement écrites
// pareil, mais qu'elles se comportent pareil.
const CORPUS = [
  // Ce que le raccourci produit, et ce que le protocole doit continuer d'accepter.
  'szh://ouvrir/revue/' + ID_NUM,
  'szh://ouvrir/zeitschrift/' + ID_ZS,
  'szh://ouvrir/livre/' + ID_LIVRE,
  'szh://ouvrir/revue/' + ID_NUM + '/',
  'szh://traduction/revue/' + ID_NUM,
  'szh://traduction/zeitschrift/' + ID_ZS + '/03-inklusion',
  // Le verbe « ouvrir » ne prend pas d'article : ce n'est pas une vue, il n'y a rien à viser.
  'szh://ouvrir/revue/' + ID_NUM + '/03-inklusion',
  // Le livre n'a pas de suivi de traduction.
  'szh://traduction/livre/' + ID_LIVRE,
  // Remontées de dossier et chemins : aucune forme n'est 16 caractères alnum, donc aucune
  // ne passe plus — l'alphabet de l'id les exclut par construction.
  'szh://ouvrir/revue/..',
  'szh://ouvrir/revue/' + ID_NUM + '/..',
  'szh://ouvrir/revue/..%5C..%5CWindows',
  'szh://ouvrir/revue/C:\\Users\\robin\\numero',
  'szh://ouvrir/revue/sous/dossier',
  'szh://ouvrir/revue/\\\\serveur\\partage',
  // La casse : tolérée, parce que l'opérateur -match de PowerShell l'ignore et que les deux
  // côtés doivent dire la même chose. Le corpus le vérifie plutôt que de le supposer.
  'szh://OUVRIR/revue/' + ID_NUM,
  'szh://ouvrir/REVUE/' + ID_NUM,
  'szh://TRADUCTION/Zeitschrift/' + ID_ZS,
  // Produits et verbes inventés.
  'szh://ouvrir/facture/' + ID_NUM,
  'szh://ouvrir//' + ID_NUM,
  'szh://ouvrir/revue/',
  'szh://supprimer/revue/' + ID_NUM,
  'szh:/ouvrir/revue/' + ID_NUM,
  'http://ouvrir/revue/' + ID_NUM,
  // Bornes de longueur de l'id : exactement 16 alnum passent (déjà dans le corpus
  // ci-dessus), 15 et 17 non.
  'szh://ouvrir/revue/' + 'a'.repeat(15),
  'szh://ouvrir/revue/' + 'a'.repeat(17),
  // Ce que le gestionnaire de protocole Windows peut coller autour.
  '  szh://ouvrir/revue/' + ID_NUM + '  ',
  'szh://ouvrir/revue/' + ID_NUM + '\u0000',
  ''
];

// ---- 1. Les deux grammaires, littéral pour littéral ----

test('les quatre motifs de grammaire sont identiques des deux côtés', () => {
  const mT = PRODUITS_PS1.match(/\$script:SzhLienMotif\s*=\s*'([^']+)'/);
  const mO = PRODUITS_PS1.match(/\$script:SzhLienMotifOuvrir\s*=\s*'([^']+)'/);
  assert.ok(mT, 'szh-produits.ps1 ne déclare plus $script:SzhLienMotif');
  assert.ok(mO, 'szh-produits.ps1 ne déclare plus $script:SzhLienMotifOuvrir');
  assert.strictEqual(mT[1], liens.MOTIF_TRADUCTION,
    'la grammaire « traduction » a bougé d’un seul côté : un lien s’ouvrirait ici et se ' +
    'refuserait là, sans que personne ne sache lequel a raison');
  assert.strictEqual(mO[1], liens.MOTIF_OUVRIR,
    'la grammaire « ouvrir » a bougé d’un seul côté');
  // Une seule déclaration de chaque : deux copies dans le même fichier divergeraient à leur
  // tour, et ce contrôle ne verrait que la première.
  assert.strictEqual((PRODUITS_PS1.match(/\$script:SzhLienMotif\s*=/g) || []).length, 1);
  assert.strictEqual((PRODUITS_PS1.match(/\$script:SzhLienMotifOuvrir\s*=/g) || []).length, 1);
  // Le motif ne dit pas tout : l'opérateur -match de PowerShell ignore la casse, et le
  // cockpit doit l'ignorer aussi, sans quoi un lien s'ouvrirait sur le poste et se ferait
  // refuser par l'extension. Deux littéraux identiques avec deux sensibilités différentes,
  // c'est une divergence que la comparaison de chaînes ne verrait pas.
  assert.ok(liens.analyserLien('szh://OUVRIR/REVUE/' + ID_NUM),
    'le cockpit refuse une casse que PowerShell accepte');
  assert.ok(liens.analyserLien('szh://TRADUCTION/Revue/' + ID_NUM),
    'le cockpit refuse une casse que PowerShell accepte, verbe « traduction »');
});

test('le verbe « traduction » n’a pas bougé de grammaire, seul l’identifiant a changé', () => {
  // Il porte tout l'existant (« Envoyer pour traduction », les liens déjà collés dans des
  // courriels partis) : le second verbe s'ajoute, il ne réécrit rien.
  assert.strictEqual(liens.MOTIF_TRADUCTION,
    '^szh://traduction/(revue|zeitschrift)/([A-Za-z0-9]{16})(?:/([a-z0-9][a-z0-9-]{0,63}))?/?$');
  assert.deepStrictEqual(liens.PRODUITS, ['revue', 'zeitschrift']);
  assert.strictEqual(liens.construireLienTraduction('zeitschrift', ID_ZS, '03-inklusion'),
    'szh://traduction/zeitschrift/' + ID_ZS + '/03-inklusion');
});

// ---- 2. La grammaire du second verbe, côté JavaScript ----

test('construireLienOuvrir : les trois produits, et rien d’autre', () => {
  assert.strictEqual(liens.construireLienOuvrir('revue', ID_NUM), 'szh://ouvrir/revue/' + ID_NUM);
  assert.strictEqual(liens.construireLienOuvrir('zeitschrift', ID_ZS), 'szh://ouvrir/zeitschrift/' + ID_ZS);
  assert.strictEqual(liens.construireLienOuvrir('livre', ID_LIVRE), 'szh://ouvrir/livre/' + ID_LIVRE);
  // Rien plutôt qu'un lien douteux : un raccourci mort-né vaut mieux qu'un raccourci qui
  // ouvre autre chose.
  for (const [p, n] of [['facture', ID_NUM], ['', ID_NUM], ['revue', ''],
    ['revue', '..'], ['revue', '../2025-01'], ['revue', 'C:\\Users\\robin'],
    ['revue', 'a'.repeat(17)], ['revue', 'a'.repeat(15)], ['revue', 'numéro'],
    ['revue', '2026-01']]) {
    assert.strictEqual(liens.construireLienOuvrir(p, n), '',
      'produit « ' + p + ' » / id « ' + n + ' » aurait donné un lien');
  }
});

test('analyserLien accepte ce qu’il doit, et refuse tout le reste', () => {
  assert.deepStrictEqual(liens.analyserLien('szh://ouvrir/livre/' + ID_LIVRE),
    { vue: 'ouvrir', produit: 'livre', id: ID_LIVRE, article: '' });
  assert.deepStrictEqual(liens.analyserLien('szh://traduction/revue/' + ID_NUM + '/03-inklusion'),
    { vue: 'traduction', produit: 'revue', id: ID_NUM, article: '03-inklusion' });
  for (const mauvais of ['szh://ouvrir/revue/..', 'szh://ouvrir/revue/' + ID_NUM + '/..',
    'szh://ouvrir/revue/..%5C..%5CWindows']) {
    assert.strictEqual(liens.analyserLien(mauvais), null,
      'une remontée de dossier est passée : ' + mauvais);
  }
  for (const mauvais of ['szh://ouvrir/facture/' + ID_NUM, 'szh://ouvrir/revue/sous/dossier',
    'szh://ouvrir/revue/C:\\Users\\robin\\numero', 'szh://supprimer/revue/' + ID_NUM,
    'szh://ouvrir/revue/' + 'a'.repeat(17), 'szh://ouvrir/revue/' + 'a'.repeat(15), '']) {
    assert.strictEqual(liens.analyserLien(mauvais), null, 'accepté à tort : ' + mauvais);
  }
});

// ---- 3. Le mécanisme, réellement exécuté ----
// Windows seulement. Rien n'est écrit dans le vrai C:\ProgramData ni dans le vrai OneDrive :
// SZH_BASE, SZH_RACINE_TEST et SZH_RACINE_PROD sont redirigés vers une arborescence jetable,
// comme le font déjà test/js/installation.test.js et test/js/lien-sans-langue.test.js.

// La sonde : dot-source le socle, analyse le corpus, cherche des numéros, pose un raccourci
// et relit le .lnk. Tout en un seul lancement de PowerShell — en démarrer un par assertion
// coûterait plus cher que tout le reste de la suite.
const SONDE = [
  'param([string]$Racine, [string]$Liens, [string]$Sortie, [string]$Numero, [string]$Livre, [string]$SansManifeste, [string]$IdNum, [string]$IdZs, [string]$IdLivre, [string]$IdActive)',
  '. (Join-Path $Racine \'windows\\szh-common.ps1\')',
  '$analyses = New-Object System.Collections.ArrayList',
  'foreach ($l in @((Get-Content -LiteralPath $Liens -Raw -Encoding UTF8 | ConvertFrom-Json))) {',
  '  $c = Get-SzhLien ([string]$l)',
  '  if ($c) { [void]$analyses.Add([ordered]@{ vue = $c.vue; produit = $c.produit; id = $c.id; article = $c.article }) }',
  '  else { [void]$analyses.Add($null) }',
  '}',
  '$pose = [bool](Set-SzhRaccourciRevue $Numero)',
  '$poseLivre = [bool](Set-SzhRaccourciRevue $Livre \'Ouvrir le livre\' \'Ouvrir ce livre\' \'livre\')',
  '$poseSansManifeste = [bool](Set-SzhRaccourciRevue $SansManifeste)',
  '$shell = New-Object -ComObject WScript.Shell',
  '$lnk = $shell.CreateShortcut((Join-Path $Numero \'Ouvrir la revue.lnk\'))',
  '$lnkLivre = $shell.CreateShortcut((Join-Path $Livre \'Ouvrir le livre.lnk\'))',
  // $resultat, et surtout pas $sortie : PowerShell ne distingue pas la casse des noms de
  // variables, et $sortie écraserait le paramètre $Sortie — le fichier partirait alors sous
  // un nom improbable dans le dossier courant, sans le moindre message.
  '$resultat = [ordered]@{',
  '  analyses      = $analyses',
  '  motifTrad     = $SzhLienMotif',
  '  motifOuvrir   = $SzhLienMotifOuvrir',
  '  toolkit       = $SzhToolkit',
  '  windir        = $env:WINDIR',
  '  emplacement   = (Get-SzhEmplacementRevues)',
  '  pose          = $pose',
  '  poseLivre     = $poseLivre',
  '  poseSansManifeste = $poseSansManifeste',
  '  sansManifesteLnk = (Test-Path (Join-Path $SansManifeste \'Ouvrir la revue.lnk\'))',
  '  cible         = $lnk.TargetPath',
  '  args          = $lnk.Arguments',
  '  icone         = $lnk.IconLocation',
  '  travail       = $lnk.WorkingDirectory',
  '  description   = $lnk.Description',
  '  cibleLivre    = $lnkLivre.TargetPath',
  '  argsLivre     = $lnkLivre.Arguments',
  '  ouvrirProd    = (Find-SzhProduitOuvrir \'revue\' $IdNum)',
  '  ouvrirLivre   = (Find-SzhProduitOuvrir \'livre\' $IdLivre)',
  '  ouvrirArchive = (Find-SzhProduitOuvrir \'zeitschrift\' $IdZs)',
  '  ouvrirActive  = (Find-SzhProduitOuvrir \'revue\' $IdActive)',
  '  ouvrirAbsent  = (Find-SzhProduitOuvrir \'revue\' \'ZZ99ZZ99ZZ99ZZ99\')',
  '  tradProd      = (Find-SzhRevue \'revue\' $IdNum)',
  '}',
  '$resultat | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Sortie -Encoding UTF8'
].join('\r\n');

function sonder() {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-raccourcis-'));
  const programData = path.join(travail, 'ProgramData');
  const racineTest = path.join(travail, 'racine-test');
  const racineProd = path.join(travail, 'racine-prod');
  // La racine de PRODUCTION : deux numéros et un livre, dont un aux archives.
  //
  // ⚠ Les deux profondeurs de l'arborescence arrêtée le 15.09.2026 sont exercées ici, et il
  //   le faut : `Get-SzhRacinesOuverture` balaie « en cours » PUIS « archives », c'est-à-dire
  //   « <racine>\Revue » puis « <racine>\_Archive\Revue ». Ne poser que des numéros en cours
  //   laisserait passer une remontée qui aurait oublié le second étage.
  const numero = path.join(racineProd, 'Revue', '2026-01');
  const livre = path.join(racineProd, '_Archive', 'Books', '2026-B330-Essai');
  const archiveZs = path.join(racineProd, '_Archive', 'Zeitschrift', '2025-04');
  // Un dossier SANS manifeste : un homonyme ne doit pas suffire à faire ouvrir n'importe
  // quoi, et Set-SzhRaccourciRevue doit refuser d'y poser un raccourci (aucun id possible).
  const sansManifeste = path.join(racineProd, 'Revue', '2026-02');
  // Dans la racine ACTIVE (test) : ce que le premier passage doit trouver.
  const dansActive = path.join(racineTest, 'Revue', '2027-09');
  // Un toolkit factice : seules les icônes doivent exister, Set-SzhRaccourciRevue ne lisant
  // rien d'autre sur le disque (hidden.vbs et open-revue.ps1 ne sont que des chaînes, posées
  // sans être ouvertes — c'est Windows qui les résoudra au double-clic).
  const toolkitFactice = path.join(programData, 'toolkit', 'windows');
  for (const d of [programData, toolkitFactice, numero, livre, archiveZs, sansManifeste,
    dansActive]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const ico of ['szh-revue.ico', 'szh-zeitschrift.ico', 'szh-livre.ico']) {
    fs.writeFileSync(path.join(toolkitFactice, ico), '');
  }
  const idActive = 'Qw11Er22Ty33Ui44';
  fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'revue: revue\nid: "' + ID_NUM + '"\n', 'utf8');
  fs.writeFileSync(path.join(dansActive, 'ausgabe.yaml'), 'revue: revue\nid: "' + idActive + '"\n', 'utf8');
  fs.writeFileSync(path.join(archiveZs, 'ausgabe.yaml'), 'revue: zeitschrift\nid: "' + ID_ZS + '"\n', 'utf8');
  fs.writeFileSync(path.join(livre, 'buch.yaml'), 'titre: Essai\nid: "' + ID_LIVRE + '"\n', 'utf8');
  // sansManifeste ne reçoit ni ausgabe.yaml ni buch.yaml : c'est tout l'objet du scénario.

  const fLiens = path.join(travail, 'liens.json');
  const fSortie = path.join(travail, 'sortie.json');
  const fSonde = path.join(travail, 'sonde.ps1');
  fs.writeFileSync(fLiens, JSON.stringify(CORPUS), 'utf8');
  fs.writeFileSync(fSonde, '\ufeff' + SONDE + '\r\n', 'utf8');

  const env = Object.assign({}, process.env, {
    SZH_BASE: programData,
    SZH_RACINE_TEST: racineTest,
    SZH_RACINE_PROD: racineProd,
    LOCALAPPDATA: path.join(travail, 'Local')
  });
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fSonde,
    '-Racine', RACINE, '-Liens', fLiens, '-Sortie', fSortie,
    '-Numero', numero, '-Livre', livre, '-SansManifeste', sansManifeste,
    '-IdNum', ID_NUM, '-IdZs', ID_ZS, '-IdLivre', ID_LIVRE, '-IdActive', idActive],
  { encoding: 'utf8', windowsHide: true, timeout: 120000, env });
  assert.ok(fs.existsSync(fSortie), 'la sonde PowerShell n’a rien écrit : '
    + (run.stderr || run.stdout || run.error));
  const vu = JSON.parse(fs.readFileSync(fSortie, 'utf8').replace(/^\ufeff/, ''));
  return { vu, travail, numero, livre, dansActive, archiveZs, sansManifeste, programData, idActive };
}

test('le raccourci d’un numéro ne porte aucun chemin de profil utilisateur',
  { skip: sansPowerShell }, () => {
    const { vu, travail, numero } = sonder();
    try {
      assert.strictEqual(vu.pose, true, 'le raccourci n’a pas été posé');
      const toolkit = String(vu.toolkit);
      const windir = String(vu.windir);
      // La cible : wscript.exe, sous %WINDIR%. Plus l'exécutable de l'éditeur, qui
      // s'installe sous le profil de l'utilisateur — c'était la moitié du défaut.
      assert.strictEqual(String(vu.cible).toLowerCase(),
        path.join(windir, 'System32', 'wscript.exe').toLowerCase());
      // Les arguments : hidden.vbs, le point d'entrée du lanceur, et le lien — construit
      // depuis l'ID posé dans ausgabe.yaml, pas depuis le nom du dossier.
      assert.strictEqual(vu.args, '//B "' + path.join(toolkit, 'windows', 'hidden.vbs')
        + '" "' + path.join(toolkit, 'windows', 'open-revue.ps1')
        + '" "szh://ouvrir/revue/' + ID_NUM + '"');
      assert.strictEqual(vu.travail, '', 'un WorkingDirectory rentrerait un chemin de poste par la fenêtre');
      // L'icône : celle du produit, dans le toolkit. Épinglé ou posé sur un bureau, le
      // raccourci n'a plus que son image pour se faire reconnaître.
      assert.strictEqual(vu.icone, path.join(toolkit, 'windows', 'szh-revue.ico') + ',0');
      // Le contrôle qui compte : AUCUN champ du .lnk ne nomme le dossier du numéro — donc,
      // sur le vrai poste, ni le dossier OneDrive ni le nom du compte.
      const champs = [vu.cible, vu.args, vu.icone, vu.travail].map((c) => String(c).toLowerCase());
      for (const champ of champs) {
        assert.ok(champ.indexOf(numero.toLowerCase()) === -1,
          'le raccourci porte encore le chemin du numéro : ' + champ);
      }
      // Les seules racines qui subsistent sont les deux racines MACHINE : le toolkit et
      // %WINDIR%. Ici $SzhToolkit est redirigé vers l'arborescence jetable, qui vit sous le
      // profil de l'utilisateur comme tout dossier temporaire de Windows — on refait donc la
      // substitution inverse et on relit le raccourci tel qu'il sera sur un vrai poste. C'est
      // là, et là seulement, que la promesse se vérifie : plus un seul « C:\Users\… ».
      for (const champ of champs) {
        if (!champ) { continue; }
        assert.ok(champ.indexOf(toolkit.toLowerCase()) === 0 || champ.indexOf(windir.toLowerCase()) === 0
          || champ.indexOf('//b "') === 0,
        'un champ du raccourci sort du toolkit et de %WINDIR% : ' + champ);
      }
      const commeSurLePoste = [vu.cible, vu.args, vu.icone, vu.travail]
        .map((c) => String(c).split(toolkit).join(TOOLKIT_REEL)).join(' | ');
      assert.ok(!/c:\\users\\/i.test(commeSurLePoste),
        'un chemin de profil utilisateur subsiste : ' + commeSurLePoste);
      // Le livre garde son propre raccourci, même composition.
      assert.strictEqual(vu.poseLivre, true);
      assert.strictEqual(String(vu.cibleLivre).toLowerCase(), String(vu.cible).toLowerCase());
      assert.ok(String(vu.argsLivre).indexOf('"szh://ouvrir/livre/' + ID_LIVRE + '"') !== -1,
        'le raccourci du livre ne porte pas son lien : ' + vu.argsLivre);
      // Un dossier sans manifeste ne donne aucun id, donc aucun lien, donc aucun raccourci —
      // et surtout pas d'exception : ce raccourci est un confort, pas une condition.
      assert.strictEqual(vu.poseSansManifeste, false, 'un dossier sans manifeste a produit un raccourci');
      assert.strictEqual(vu.sansManifesteLnk, false, 'un .lnk a tout de même été écrit');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('les deux grammaires se comportent pareil des deux côtés',
  { skip: sansPowerShell }, () => {
    const { vu, travail } = sonder();
    try {
      assert.strictEqual(vu.motifTrad, liens.MOTIF_TRADUCTION);
      assert.strictEqual(vu.motifOuvrir, liens.MOTIF_OUVRIR);
      assert.strictEqual(vu.analyses.length, CORPUS.length,
        'la sonde n’a pas analysé tout le corpus');
      for (let i = 0; i < CORPUS.length; i++) {
        const cote = liens.analyserLien(CORPUS[i]);
        const ps = vu.analyses[i];
        if (cote === null) {
          assert.strictEqual(ps, null, 'PowerShell accepte un lien que le cockpit refuse : ' + CORPUS[i]);
          continue;
        }
        assert.ok(ps, 'PowerShell refuse un lien que le cockpit accepte : ' + CORPUS[i]);
        assert.deepStrictEqual(
          { vue: ps.vue, produit: ps.produit, id: ps.id, article: ps.article || '' },
          cote, 'les deux analyses divergent sur : ' + CORPUS[i]);
      }
      // Et le corpus prouve bien quelque chose : au moins un lien accepté, au moins un refusé.
      const acceptes = CORPUS.filter((l) => liens.analyserLien(l) !== null);
      assert.ok(acceptes.length >= 6 && acceptes.length < CORPUS.length,
        'le corpus ne fait plus le partage : ' + acceptes.length + ' / ' + CORPUS.length);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('le verbe « ouvrir » atteint la racine de production, en cours puis archives, par id',
  { skip: sansPowerShell }, () => {
    const { vu, travail, numero, livre, dansActive, archiveZs } = sonder();
    try {
      // L'arborescence d'essai n'a pas de config.json : la racine ACTIVE est donc « test »,
      // et c'est exactement le cas qui compte — la production est atteinte alors qu'elle
      // n'est pas la racine active.
      assert.strictEqual(vu.emplacement, 'test',
        'ce banc ne prouve rien si la racine active est déjà la production');
      assert.strictEqual(String(vu.ouvrirProd).toLowerCase(), numero.toLowerCase(),
        'un numéro de production reste introuvable depuis la racine d’essai');
      assert.strictEqual(String(vu.ouvrirArchive).toLowerCase(), archiveZs.toLowerCase(),
        'les archives de production ne sont pas balayées');
      assert.strictEqual(String(vu.ouvrirLivre).toLowerCase(), livre.toLowerCase(),
        'le livre n’est pas résolu : son manifeste n’est pas ausgabe.yaml');
      // Le verbe « traduction », lui, n'a pas changé de racine : ACTIVE seulement.
      assert.strictEqual(vu.tradProd, '',
        'Find-SzhRevue est allé chercher en production : le verbe « traduction » a changé');
      // La racine active est balayée EN PREMIER, et c'est délibéré (voir
      // Get-SzhRacinesOuverture) : un numéro créé dans la racine d'essai reçoit le même
      // raccourci, il doit pouvoir s'ouvrir.
      assert.strictEqual(String(vu.ouvrirActive).toLowerCase(), dansActive.toLowerCase(),
        'un numéro de la racine active n’est pas trouvé');
      // Introuvable : chaîne vide, pour que l'appelant en fasse un message et non un silence.
      assert.strictEqual(vu.ouvrirAbsent, '');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('le lanceur, lancé sur le lien du raccourci, ouvre le bon dossier',
  { skip: sansPowerShell }, () => {
    // Le bout de la chaîne : ce que Windows fera vraiment au double-clic, hidden.vbs en
    // moins. Le lanceur en mode simulation (SZH_LANCEUR_SIMULE) n'ouvre aucune fenêtre et
    // dit en JSON ce qu'il aurait ouvert — c'est le même chemin de code que le vrai.
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-raccourcis-e2e-'));
    const racineProd = path.join(travail, 'racine-prod');
    const numero = path.join(racineProd, 'Revue', '2026-01');
    // Le livre est aux ARCHIVES, deux étages sous la racine : c'est le second passage de
    // Get-SzhRacinesOuverture qui doit le trouver, pas le premier.
    const livre = path.join(racineProd, '_Archive', 'Books', '2026-B330-Essai');
    const intention = path.join(travail, 'Local', 'SZH', 'intention.json');
    for (const d of [path.join(travail, 'ProgramData'), path.join(travail, 'racine-test'),
      path.join(travail, 'Local', 'SZH'), numero, livre]) {
      fs.mkdirSync(d, { recursive: true });
    }
    fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'revue: revue\nid: "' + ID_NUM + '"\n', 'utf8');
    fs.writeFileSync(path.join(livre, 'buch.yaml'), 'titre: Essai\nid: "' + ID_LIVRE + '"\n', 'utf8');
    const env = Object.assign({}, process.env, {
      SZH_BASE: path.join(travail, 'ProgramData'),
      SZH_RACINE_TEST: path.join(travail, 'racine-test'),
      SZH_RACINE_PROD: racineProd,
      LOCALAPPDATA: path.join(travail, 'Local'),
      SZH_LANCEUR_SIMULE: '1'
    });
    const lancer = (lien) => {
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(RACINE, 'windows', 'open-produit.ps1'), lien],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
      assert.ok(run.stdout, 'aucune sortie du lanceur pour ' + lien + ' : ' + run.stderr);
      return JSON.parse(run.stdout.trim());
    };
    try {
      const revue = lancer('szh://ouvrir/revue/' + ID_NUM);
      assert.strictEqual(revue.vue, 'ouvrir');
      assert.strictEqual(String(revue.dossier).toLowerCase(), numero.toLowerCase(),
        'le lien du raccourci n’ouvre pas le numéro de production');
      const book = lancer('szh://ouvrir/livre/' + ID_LIVRE);
      assert.strictEqual(String(book.dossier).toLowerCase(), livre.toLowerCase(),
        'le raccourci d’un livre archivé n’ouvre rien');
      // Introuvable : le lanceur le dit, il ne sort pas en silence.
      assert.strictEqual(lancer('szh://ouvrir/revue/ZZ99ZZ99ZZ99ZZ99').erreur, 'introuvable');
      assert.strictEqual(lancer('szh://ouvrir/revue/..').erreur, 'invalide');
      // Aucune intention déposée : « ouvrir » ne vise aucun panneau, et rien ne doit rester
      // dans %LOCALAPPDATA% pour la prochaine fenêtre.
      assert.ok(!fs.existsSync(intention),
        'le verbe « ouvrir » a déposé une intention : la prochaine revue ouverte sauterait ' +
        'sur un panneau que personne n’a demandé');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// ---- 4. Ce que la source doit continuer de dire ----

test('Set-SzhRaccourciRevue compose depuis le toolkit, jamais depuis l’éditeur', () => {
  const debut = SHELL_PS1.indexOf('function Set-SzhRaccourciRevue');
  assert.notStrictEqual(debut, -1, 'Set-SzhRaccourciRevue a disparu de szh-shell.ps1');
  const fin = SHELL_PS1.indexOf('\r\n}\r\n', debut);
  const corps = SHELL_PS1.slice(debut, fin);
  assert.ok(corps.indexOf('Get-VSCodiumExe') === -1,
    'le raccourci vise de nouveau l’éditeur, dont le chemin contient le nom du compte');
  assert.ok(corps.indexOf('$SzhToolkit') !== -1 && corps.indexOf('$env:WINDIR') !== -1,
    'le raccourci ne compose plus depuis le toolkit et %WINDIR%');
  assert.ok(corps.indexOf('WorkingDirectory') === -1,
    'un WorkingDirectory réintroduirait le chemin du poste d’origine');
  // La signature garde ses deux libellés, et n'ajoute que le produit.
  assert.match(corps, /function Set-SzhRaccourciRevue\(\[string\]\$Dossier, \[string\]\$NomLien = 'Ouvrir la revue', \[string\]\$Description = 'Ouvrir cette revue dans l''éditeur', \[string\]\$Produit = ''\)/);
  // L'id est posé s'il manque, jamais recalculé s'il existe déjà.
  assert.ok(corps.indexOf('Set-SzhAusgabeIdSiAbsent') !== -1,
    'le raccourci ne pose plus l’id manquant du manifeste');
  // $SzhToolkit est bien une racine MACHINE : c'est de là que vient toute la portabilité.
  assert.match(COMMUN_PS1, /\$script:SzhBase\s*=\s*'C:\\ProgramData\\SZH'/);
  assert.match(COMMUN_PS1, /\$script:SzhToolkit\s*=\s*Join-Path \$SzhBase 'toolkit'/);
});

test('aucun nom d’application en dur n’est apparu dans le nouveau code', () => {
  // L'application et le lanceur vont être renommés : le nom visible ne vit qu'en deux
  // variables (windows/szh-shell.ps1), et le segment de dossier en une troisième
  // (windows/szh-ancrage.ps1). Rien de ce qui a été ajouté ici ne doit le recopier.
  const nom = SHELL_PS1.match(/\$script:SzhNomApplication\s*=\s*'([^']+)'/);
  assert.ok(nom, 'szh-shell.ps1 ne déclare plus $script:SzhNomApplication');
  const debut = SHELL_PS1.indexOf('function Set-SzhRaccourciRevue');
  const corps = SHELL_PS1.slice(debut, SHELL_PS1.indexOf('\r\n}\r\n', debut));
  assert.ok(corps.indexOf(nom[1]) === -1,
    'Set-SzhRaccourciRevue recopie le nom de l’application : il faudra y repenser au baptême');
  const debutLiens = PRODUITS_PS1.indexOf('# ---- Liens profonds');
  assert.ok(PRODUITS_PS1.slice(debutLiens).indexOf(nom[1]) === -1,
    'la section des liens recopie le nom de l’application');
});

test('la migration automatique refait les raccourcis des numéros qu’elle déplace', () => {
  assert.ok(MIGRATION_PS1.indexOf('Set-SzhRaccourciRevue') !== -1,
    'windows/szh-migration.ps1 ne refait plus les raccourcis');
  assert.ok(MIGRATION_PS1.indexOf('Set-SzhAusgabeIdSiAbsent') !== -1,
    'windows/szh-migration.ps1 ne pose plus les id manquants');
  // Après le déplacement, pas avant : le raccourci doit se poser dans le dossier à sa place
  // définitive. Recherche à l'intérieur du CORPS de la fonction seulement : le nom de
  // Set-SzhRaccourciRevue apparaît aussi plus haut, dans des commentaires d'intention.
  const debutFonction = MIGRATION_PS1.indexOf('function Move-SzhContenuDossier');
  assert.notStrictEqual(debutFonction, -1, 'Move-SzhContenuDossier a disparu de windows/szh-migration.ps1');
  const corpsFonction = MIGRATION_PS1.slice(debutFonction);
  const iMove = corpsFonction.indexOf('Move-Item -LiteralPath');
  const iRefait = corpsFonction.indexOf('Set-SzhRaccourciRevue');
  assert.ok(iMove !== -1 && iRefait !== -1 && iMove < iRefait,
    'les raccourcis sont refaits avant le déplacement');
  // Uniquement sur la racine de TEST : jamais sur SharePoint/production.
  assert.ok(MIGRATION_PS1.indexOf('SzhEmplacementTest') !== -1,
    'la migration automatique ne se limite plus explicitement à la racine de test');
});
