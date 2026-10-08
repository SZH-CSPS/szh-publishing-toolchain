// Le raccourci posé à la racine de chaque numéro, et le lien szh:// qu'il porte.
//
//   node --test test/js/raccourcis-portables.test.js
//
// « Ouvrir la revue.lnk » (« Ouvrir le livre.lnk ») vit dans le dossier du numéro, que
// OneDrive recopie sur les autres postes. Il ne doit donc contenir aucun chemin propre à un
// poste ou à un compte Windows (profil utilisateur, dossier OneDrive) : sur un autre poste,
// le double-clic ne ferait rien, sans message. Le raccourci vise wscript.exe (sous %WINDIR%)
// et deux scripts du toolkit (sous C:\ProgramData), et désigne le numéro par un lien
// « szh:// » : un produit et l'identifiant `id:` du manifeste, que le lanceur cherche dans
// les racines qu'il connaît. Le lien reste valable après un renommage ou un archivage.
//
// Ce que le fichier vérifie :
//   1. la composition du raccourci : tous les chemins partent de %WINDIR% ou du toolkit, et
//      le chemin du numéro n'y figure pas ;
//   2. la grammaire du lien : un lien vient d'un courriel ou d'un .lnk recopié, tout ce qui
//      sort de la grammaire est refusé ;
//   3. les grammaires PowerShell et JavaScript sont identiques, en texte et en comportement ;
//   4. la résolution atteint la racine de production et reconnaît l'id, pas le nom du
//      dossier ;
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

// La racine machine du toolkit, telle qu'elle vaut sur un vrai poste, lue dans la source. Le
// banc redirige $SzhBase vers une arborescence jetable.
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
// Les mêmes chaînes passent par Get-SzhLien (PowerShell) et par analyserLien (JavaScript),
// pour comparer le comportement des deux grammaires, pas seulement leur texte.
const CORPUS = [
  // Ce que le raccourci produit, et ce que le protocole doit continuer d'accepter.
  'szh://ouvrir/revue/' + ID_NUM,
  'szh://ouvrir/zeitschrift/' + ID_ZS,
  'szh://ouvrir/livre/' + ID_LIVRE,
  'szh://ouvrir/revue/' + ID_NUM + '/',
  'szh://traduction/revue/' + ID_NUM,
  'szh://traduction/zeitschrift/' + ID_ZS + '/03-inklusion',
  // Le verbe « ouvrir » ne prend pas d'article.
  'szh://ouvrir/revue/' + ID_NUM + '/03-inklusion',
  // Le livre n'a pas de suivi de traduction.
  'szh://traduction/livre/' + ID_LIVRE,
  // Remontées de dossier et chemins : aucune de ces formes n'a 16 caractères alphanumériques,
  // l'alphabet de l'id les exclut.
  'szh://ouvrir/revue/..',
  'szh://ouvrir/revue/' + ID_NUM + '/..',
  'szh://ouvrir/revue/..%5C..%5CWindows',
  'szh://ouvrir/revue/C:\\Users\\robin\\numero',
  'szh://ouvrir/revue/sous/dossier',
  'szh://ouvrir/revue/\\\\serveur\\partage',
  // La casse est tolérée, car l'opérateur -match de PowerShell l'ignore et les deux côtés
  // doivent répondre pareil.
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
  // Bornes de longueur de l'id : 16 caractères passent (plus haut), 15 et 17 non.
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
  // Une seule déclaration de chaque : une seconde copie pourrait diverger sans que ce
  // contrôle la voie.
  assert.strictEqual((PRODUITS_PS1.match(/\$script:SzhLienMotif\s*=/g) || []).length, 1);
  assert.strictEqual((PRODUITS_PS1.match(/\$script:SzhLienMotifOuvrir\s*=/g) || []).length, 1);
  // -match ignore la casse : le cockpit doit l'ignorer aussi, sinon un lien s'ouvrirait sur le
  // poste et serait refusé par l'extension. La comparaison des littéraux ne le verrait pas.
  assert.ok(liens.analyserLien('szh://OUVRIR/REVUE/' + ID_NUM),
    'le cockpit refuse une casse que PowerShell accepte');
  assert.ok(liens.analyserLien('szh://TRADUCTION/Revue/' + ID_NUM),
    'le cockpit refuse une casse que PowerShell accepte, verbe « traduction »');
});

test('le verbe « traduction » n’a pas bougé de grammaire, seul l’identifiant a changé', () => {
  // Ce motif sert aux liens déjà envoyés (« Envoyer pour traduction ») : il reste inchangé.
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
  // Un lien douteux ne produit rien : mieux vaut pas de raccourci qu'un raccourci qui ouvre
  // autre chose.
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
// Windows seulement. SZH_BASE, SZH_RACINE_TEST et SZH_RACINE_PROD sont redirigés vers une
// arborescence jetable : rien n'est écrit dans le vrai C:\ProgramData ni dans OneDrive.

// La sonde charge le socle, analyse le corpus, cherche des numéros, pose un raccourci et relit
// le .lnk, en un seul lancement de PowerShell (un lancement par assertion coûterait trop).
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
  // $resultat et non $sortie : PowerShell ignore la casse des noms de variables, et $sortie
  // écraserait le paramètre $Sortie (le fichier partirait sous un autre nom, sans message).
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
  // La racine de production : deux numéros et un livre, dont un aux archives.
  //
  // Get-SzhRacinesOuverture balaie « <racine>\Revue » puis « <racine>\_Archive\Revue » : les
  // deux profondeurs sont exercées, pour qu'un oubli du second étage se voie.
  const numero = path.join(racineProd, 'Revue', '2026-01');
  const livre = path.join(racineProd, '_Archive', 'Books', '2026-B330-Essai');
  const archiveZs = path.join(racineProd, '_Archive', 'Zeitschrift', '2025-04');
  // Un dossier sans manifeste : un homonyme ne suffit pas à ouvrir, et Set-SzhRaccourciRevue
  // refuse d'y poser un raccourci (pas d'id).
  const sansManifeste = path.join(racineProd, 'Revue', '2026-02');
  // Dans la racine active (test) : ce que le premier passage doit trouver.
  const dansActive = path.join(racineTest, 'Revue', '2027-09');
  // Un toolkit factice : seules les icônes doivent exister. hidden.vbs et open-revue.ps1 ne
  // sont que des chaînes dans le raccourci, résolues par Windows au double-clic.
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
  // sansManifeste ne reçoit ni ausgabe.yaml ni buch.yaml.

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
      // La cible : wscript.exe, sous %WINDIR%, et non l'exécutable de l'éditeur installé sous
      // le profil de l'utilisateur.
      assert.strictEqual(String(vu.cible).toLowerCase(),
        path.join(windir, 'System32', 'wscript.exe').toLowerCase());
      // Les arguments : hidden.vbs, le point d'entrée du lanceur, et le lien construit depuis
      // l'id de ausgabe.yaml, pas depuis le nom du dossier.
      assert.strictEqual(vu.args, '//B "' + path.join(toolkit, 'windows', 'hidden.vbs')
        + '" "' + path.join(toolkit, 'windows', 'open-revue.ps1')
        + '" "szh://ouvrir/revue/' + ID_NUM + '"');
      assert.strictEqual(vu.travail, '', 'un WorkingDirectory rentrerait un chemin de poste par la fenêtre');
      // L'icône du produit, dans le toolkit : épinglé ou sur un bureau, le raccourci se
      // reconnaît à son image.
      assert.strictEqual(vu.icone, path.join(toolkit, 'windows', 'szh-revue.ico') + ',0');
      // Aucun champ du .lnk ne nomme le dossier du numéro, donc ni OneDrive ni le compte.
      const champs = [vu.cible, vu.args, vu.icone, vu.travail].map((c) => String(c).toLowerCase());
      for (const champ of champs) {
        assert.ok(champ.indexOf(numero.toLowerCase()) === -1,
          'le raccourci porte encore le chemin du numéro : ' + champ);
      }
      // Les seules racines admises sont le toolkit et %WINDIR%. Le toolkit redirigé vit ici
      // sous le profil de l'utilisateur, comme tout dossier temporaire : on refait la
      // substitution inverse pour relire le raccourci tel qu'il sera sur un vrai poste, et
      // vérifier qu'aucun « C:\Users\… » n'y reste.
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
      // Un dossier sans manifeste ne donne ni id, ni lien, ni raccourci, et pas d'exception :
      // le raccourci est un confort.
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
      // Le corpus contient au moins un lien accepté et au moins un refusé.
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
      // L'arborescence d'essai n'a pas de config.json : la racine active est « test ». La
      // production doit être atteinte alors qu'elle n'est pas la racine active.
      assert.strictEqual(vu.emplacement, 'test',
        'ce banc ne prouve rien si la racine active est déjà la production');
      assert.strictEqual(String(vu.ouvrirProd).toLowerCase(), numero.toLowerCase(),
        'un numéro de production reste introuvable depuis la racine d’essai');
      assert.strictEqual(String(vu.ouvrirArchive).toLowerCase(), archiveZs.toLowerCase(),
        'les archives de production ne sont pas balayées');
      assert.strictEqual(String(vu.ouvrirLivre).toLowerCase(), livre.toLowerCase(),
        'le livre n’est pas résolu : son manifeste n’est pas ausgabe.yaml');
      // Le verbe « traduction » cherche dans la racine active seulement.
      assert.strictEqual(vu.tradProd, '',
        'Find-SzhRevue est allé chercher en production : le verbe « traduction » a changé');
      // La racine active est balayée en premier (voir Get-SzhRacinesOuverture) : un numéro
      // créé dans la racine d'essai reçoit le même raccourci et doit s'ouvrir.
      assert.strictEqual(String(vu.ouvrirActive).toLowerCase(), dansActive.toLowerCase(),
        'un numéro de la racine active n’est pas trouvé');
      // Introuvable : chaîne vide, dont l'appelant fait un message.
      assert.strictEqual(vu.ouvrirAbsent, '');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('le lanceur, lancé sur le lien du raccourci, ouvre le bon dossier',
  { skip: sansPowerShell }, () => {
    // Ce que Windows fait au double-clic, hidden.vbs en moins. En mode simulé
    // (SZH_LANCEUR_SIMULE), le lanceur n'ouvre aucune fenêtre et dit en JSON ce qu'il aurait
    // ouvert, par le même code que le vrai.
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-raccourcis-e2e-'));
    const racineProd = path.join(travail, 'racine-prod');
    const numero = path.join(racineProd, 'Revue', '2026-01');
    // Le livre est aux archives, deux étages sous la racine : c'est le second passage de
    // Get-SzhRacinesOuverture qui le trouve.
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
      SZH_LANCEUR_SIMULE: '1',
      // Les tâches de démarrage passent avant le lien : un ancrage jetable empêche le check-in
      // d'écrire dans le vrai dossier partagé.
      SZH_ANCRAGE: path.join(travail, 'sp', 'Daten_Allgemein - General'),
      SZH_RAPPORTS: path.join(travail, 'rapports')
    });
    fs.mkdirSync(env.SZH_ANCRAGE, { recursive: true });
    const lancer = (lien) => {
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(RACINE, 'windows', 'open-revue.ps1'), lien],
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
      // Introuvable : le lanceur le signale.
      assert.strictEqual(lancer('szh://ouvrir/revue/ZZ99ZZ99ZZ99ZZ99').erreur, 'introuvable');
      assert.strictEqual(lancer('szh://ouvrir/revue/..').erreur, 'invalide');
      // « ouvrir » ne vise aucun panneau : aucune intention ne reste dans %LOCALAPPDATA% pour
      // la prochaine fenêtre.
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
  // L'id est posé s'il manque, jamais recalculé s'il existe.
  assert.ok(corps.indexOf('Set-SzhAusgabeIdSiAbsent') !== -1,
    'le raccourci ne pose plus l’id manquant du manifeste');
  // $SzhToolkit est une racine machine : c'est elle qui rend le raccourci portable.
  assert.match(COMMUN_PS1, /\$script:SzhBase\s*=\s*'C:\\ProgramData\\SZH'/);
  assert.match(COMMUN_PS1, /\$script:SzhToolkit\s*=\s*Join-Path \$SzhBase 'toolkit'/);
});

test('aucun nom d’application en dur n’est apparu dans le nouveau code', () => {
  // Le nom visible de l'application vit en deux variables (windows/szh-shell.ps1), le segment
  // de dossier en une troisième (windows/szh-ancrage.ps1) : rien ici ne doit les recopier.
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
  // Le raccourci se pose après le déplacement, dans le dossier à sa place définitive. La
  // recherche se limite au corps de la fonction : le nom de Set-SzhRaccourciRevue apparaît
  // aussi dans des commentaires plus haut.
  const debutFonction = MIGRATION_PS1.indexOf('function Move-SzhContenuDossier');
  assert.notStrictEqual(debutFonction, -1, 'Move-SzhContenuDossier a disparu de windows/szh-migration.ps1');
  const corpsFonction = MIGRATION_PS1.slice(debutFonction);
  const iMove = corpsFonction.indexOf('Move-Item -LiteralPath');
  const iRefait = corpsFonction.indexOf('Set-SzhRaccourciRevue');
  assert.ok(iMove !== -1 && iRefait !== -1 && iMove < iRefait,
    'les raccourcis sont refaits avant le déplacement');
  // Seulement sur la racine de test, pas sur la production.
  assert.ok(MIGRATION_PS1.indexOf('SzhEmplacementTest') !== -1,
    'la migration automatique ne se limite plus explicitement à la racine de test');
});
