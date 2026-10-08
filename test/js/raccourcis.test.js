// Les raccourcis du menu Démarrer : les entrées que Pronto pose, et ce qui se passe quand le
// menu refuse l'écriture.
//
//   node --test test/js/raccourcis.test.js
//
// Points vérifiés :
//   * le libellé d'un .lnk est un nom de fichier, donc figé : l'entrée de mise à jour a un nom
//     sans mot à traduire, pour qu'un poste germanophone ne lise pas un libellé français ;
//   * une mise à jour télécharge, peut échouer, et son journal est la seule trace : son
//     raccourci ne passe pas par hidden.vbs et ouvre une fenêtre visible ;
//   * un menu Démarrer tenu par une stratégie de groupe ne fait pas échouer la mise à jour,
//     mais le journal le dit ;
//   * un raccourci d'une version antérieure est retiré, pas doublé, sans toucher au
//     sous-dossier « SZH », qui appartient à un autre produit.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const COMMUN = lire('windows', 'szh-common.ps1');
const SHELL = lire('windows', 'szh-shell.ps1');
const TEXTES = lire('windows', 'szh-textes.ps1');
const UPDATE = lire('windows', 'update.ps1');
const LANCEUR_MAJ = lire('windows', 'update-launcher.ps1');
const BOOTSTRAP = lire('windows', 'bootstrap.ps1');
const OUVRIR = lire('windows', 'open-revue.ps1');
const OUVRIR_LIVRE = lire('windows', 'open-livre.ps1');
// open-revue.ps1 est le point d'entrée que visent les raccourcis et le protocole "szh:" ;
// open-livre.ps1 lui renvoie.
const SHELL_PRODUITS = lire('windows', 'szh-produits.ps1');
const ICONE_PY = lire('windows', 'icone.py');
// pronto.ico et pronto-maj.ico sont rendus par Edge depuis un .svg, par icone-pronto.py, et non
// par le fabricant des icônes de produit.
const ICONE_PRONTO_PY = lire('windows', 'icone-pronto.py');

// Les cinq anciennes entrées (trois lanceurs de produit, deux mises à jour par langue). Elles
// ne se posent plus, mais Get-SzhRaccourcisObsoletes (szh-shell.ps1) les nomme pour la
// désinstallation, et les deux noms de mise à jour restent les valeurs de
// `raccourci.maj.nom` (szh-textes.ps1), vérifiées par le test « les libellés des raccourcis
// existent dans les trois langues ».
const NOMS = ['Revues SZH', 'Zeitschriften SZH', 'Books SZH-CSPS',
  'Mise à jour de l’outil Revue', 'Aktualisierung des Redaktionstools'];

// Les deux entrées posées. Le nom de l'application est lu dans $script:SzhNomApplication
// (szh-shell.ps1) plutôt que recopié, pour qu'un changement de nom ne casse pas ce fichier.
function litLitteral(source, nomVar) {
  const m = source.match(new RegExp('\\$script:' + nomVar + "\\s*=\\s*'([^']+)'"));
  assert.ok(m, nomVar + ' introuvable dans szh-shell.ps1');
  return m[1];
}
const NOM_APPLICATION = litLitteral(SHELL, 'SzhNomApplication');
const NOM_MISE_A_JOUR = litLitteral(SHELL, 'SzhNomMiseAJour');
const NOMS_ACTUELS = [NOM_APPLICATION, NOM_MISE_A_JOUR];

// Windows seulement : szh-common.ps1 vise Windows PowerShell 5.1, et un .lnk n'existe que là.
// Plusieurs contrôles exécutent la fonction, pour des faits (l'ordre des noms selon la
// langue) qu'une lecture du texte ne prouve pas.
const { POWERSHELL, sansPowerShell, sauter } = require('./gardes');

// ---- Ce que szh-shell.ps1 déclare ----

test('les raccourcis du menu sont posés par une seule fonction, paramétrable', () => {
  // Une seule définition, car trois scripts la posent : la mise à jour, la tâche de
  // connexion et l'installation d'un poste.
  for (const attendu of ['function Get-SzhRaccourcisMenu', 'function Set-SzhRaccourcisMenu']) {
    assert.ok(SHELL.indexOf(attendu) !== -1, 'szh-shell.ps1 ne déclare plus : ' + attendu);
  }
  const debut = SHELL.indexOf('function Set-SzhRaccourcisMenu');
  const corps = SHELL.slice(debut, SHELL.indexOf('\r\nfunction ', debut + 10));
  // $Menu et $Toolkit paramétrables : la fonction s'éprouve hors du vrai menu Démarrer (voir
  // le contrôle en bas de ce fichier).
  assert.match(corps, /\[string\]\$Menu\s+=\s+''/);
  assert.match(corps, /\[string\]\$Toolkit\s+=\s+\$SzhToolkit/);
  // Le bilan est rendu, pas affiché : chaque appelant l'écrit dans son propre journal.
  for (const cle of ['poses', 'retires', 'manques']) {
    assert.ok(corps.indexOf(cle + '   =') !== -1 || corps.indexOf(cle + ' =') !== -1,
      'le bilan ne porte plus « ' + cle + ' »');
  }
});

// Le nom de l'entrée de mise à jour ne contient aucun mot à traduire : il ne change pas avec
// $SzhLangue, contrairement à sa description. Vérifié en exécutant Get-SzhRaccourcisMenu
// sous fr puis sous de.
test('l’entrée de mise à jour garde un nom fixe quelle que soit la langue, à la différence de sa description',
  { skip: sansPowerShell }, () => {
    const lireEnLangue = (langue) => {
      const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-raccourcis-langue-'));
      const sortie = path.join(travail, 'bilan.json');
      const pilote = path.join(travail, 'lire.ps1');
      fs.writeFileSync(pilote, [
        "$ErrorActionPreference = 'Stop'",
        '. "' + COMMUN_PS1 + '"',
        '$r = @(Get-SzhRaccourcisMenu -Toolkit $args[0]) | ForEach-Object {',
        '  [ordered]@{ nom = $_.nom; desc = $_.desc }',
        '}',
        'Set-SzhJson $args[1] $r'
      ].join('\r\n') + '\r\n', 'utf8');
      const env = Object.assign({}, process.env, { SZH_LANGUE: langue });
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
        RACINE, sortie], { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
      assert.strictEqual(run.status, 0, 'pilote (' + langue + ') : ' + (run.stderr || ''));
      const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
      fs.rmSync(travail, { recursive: true, force: true });
      return r;
    };
    const fr = lireEnLangue('fr');
    const de = lireEnLangue('de');
    assert.deepStrictEqual(fr.map((x) => x.nom), de.map((x) => x.nom),
      'un nom de .lnk change avec la langue : un épinglage casserait à chaque bascule');
    assert.deepStrictEqual(fr.map((x) => x.nom).sort(), NOMS_ACTUELS.slice().sort());
    const majFr = fr.find((x) => x.nom === NOM_MISE_A_JOUR);
    const majDe = de.find((x) => x.nom === NOM_MISE_A_JOUR);
    assert.ok(majFr && majDe, 'l’entrée de mise à jour a disparu dans une des deux langues');
    assert.notStrictEqual(majFr.desc, majDe.desc,
      'la description ne suit plus la langue : le réglage ne servirait plus à rien');
  });

test('la mise à jour se voit, le lanceur non', () => {
  // Le lanceur reste sans console ; la mise à jour reste visible.
  const debut = SHELL.indexOf('function Get-SzhRaccourcisMenu');
  const corps = SHELL.slice(debut, SHELL.indexOf('\r\nfunction ', debut + 10));
  // Le lanceur unique : wscript.exe //B hidden.vbs, donc sans console.
  const lignesVbs = corps.split('\r\n').filter((l) => l.indexOf('//B "{0}"') !== -1);
  assert.strictEqual(lignesVbs.length, 1, 'seul le lanceur passe par hidden.vbs');
  assert.ok(lignesVbs[0].indexOf('open-revue.ps1') !== -1 || lignesVbs[0].indexOf('$lanceur') !== -1);
  // La mise à jour : powershell.exe en direct. hidden.vbs cacherait le téléchargement,
  // l'attente et l'échec.
  const ligneMaj = corps.split('\r\n').filter((l) => l.indexOf('-ExecutionPolicy Bypass -File') !== -1);
  assert.strictEqual(ligneMaj.length, 1, 'l’entrée de mise à jour a changé de forme');
  assert.ok(ligneMaj[0].indexOf('hidden.vbs') === -1, 'la mise à jour ne doit pas être cachée');
  assert.match(ligneMaj[0], /-NoProfile -ExecutionPolicy Bypass -File "\{0\}"/);
  assert.ok(ligneMaj[0].indexOf('-Langue') === -1,
    'la mise à jour reçoit encore -Langue : elle ne devrait plus le passer par son raccourci');
  // Windows PowerShell 5.1 nommé explicitement : $PSHOME désignerait pwsh si la mise à jour
  // était lancée depuis PowerShell 7, et pwsh n'a pas de powershell.exe à côté.
  assert.ok(corps.indexOf("System32\\WindowsPowerShell\\v1.0\\powershell.exe") !== -1);
  // Fenêtre normale, explicite.
  assert.match(SHELL, /\$lnk\.WindowStyle = 1/);
});

test('le lanceur et sa mise à jour portent chacun leur propre icône, fabriquée par icone-pronto.py', () => {
  // Épinglé à la barre des tâches, un raccourci perd son libellé : l'icône est le seul repère.
  // Get-SzhRaccourcisMenu cherche deux icônes, pronto.ico (lanceur) et pronto-maj.ico (mise à
  // jour), fabriquées par icone-pronto.py depuis pronto.svg et pronto-maj.svg.
  // szh-revue.ico, szh-zeitschrift.ico et szh-livre.ico (icone.py) servent aux raccourcis
  // posés à la racine d'un numéro ou d'un livre (szh-produits.ps1).
  const debut = SHELL.indexOf('function Get-SzhRaccourcisMenu');
  const corps = SHELL.slice(debut, SHELL.indexOf('\r\nfunction ', debut + 10));
  const icones = ['pronto.ico', 'pronto-maj.ico'];
  for (const ico of icones) {
    assert.ok(corps.indexOf(ico) !== -1, 'szh-shell.ps1 ne cherche plus ' + ico);
    // Le fichier existe et son fabricant sait le refaire : un .ico déposé à la main ne se
    // régénère pas, et l'écart ne se verrait qu'à la prochaine retouche du dessin.
    assert.ok(fs.existsSync(path.join(RACINE, 'windows', ico)), ico + ' manque au dépôt');
    assert.ok(ICONE_PRONTO_PY.indexOf("'" + ico + "'") !== -1, 'icone-pronto.py ne fabrique plus ' + ico);
  }
  // Deux images distinctes, pour distinguer le lanceur de sa mise à jour.
  const empreintes = new Set(icones.map((i) =>
    require('crypto').createHash('sha256').update(fs.readFileSync(path.join(RACINE, 'windows', i))).digest('hex')));
  assert.strictEqual(empreintes.size, 2, 'les deux icônes du menu sont identiques');
  // Si l'icône manque, le repli est celle de l'éditeur : sans IconLocation, le shell montre
  // celle de wscript.exe.
  assert.ok(SHELL.indexOf('elseif ($codium) { $lnk.IconLocation = $codium }') !== -1);
});

test('la barre des tâches reçoit une identité, des deux côtés', () => {
  // La barre des tâches ne regarde pas l'icône de la fenêtre : elle groupe les boutons par
  // AppUserModelID et prend l'image associée. Sans identité déclarée, Windows la déduit de
  // l'exécutable hôte (powershell.exe, lancé par hidden.vbs) et affiche son icône. Il faut
  // l'identité sur le raccourci et dans le processus : ce contrôle garde les deux.
  //
  // Deux identités : « Pronto » prend celle de VSCodium, qu'il ouvre (un seul bouton dans la
  // barre des tâches), et la mise à jour a la sienne, sans langue.
  assert.match(SHELL, /\$script:SzhAppIds = @\{/);
  assert.match(SHELL, /'codium'\s*=\s*'VSCodium\.VSCodium'/);
  assert.match(SHELL, /'maj'\s*=\s*'SZH\.Publishing\.MiseAJour'/);
  // Aucune identité par produit ou par langue, ni « suite » (fenêtre WinForms). La recherche
  // se limite à la table : ses clés reviennent ailleurs (szh-produits.ps1 notamment).
  const iTable = SHELL.indexOf('$script:SzhAppIds = @{');
  const corpsTable = SHELL.slice(iTable, SHELL.indexOf('}', iTable));
  for (const ancien of ["'suite'", "'revue'", "'zeitschrift'", "'livre'", "'maj.fr'", "'maj.de'"]) {
    assert.ok(corpsTable.indexOf(ancien + ' = ') === -1,
      'szh-shell.ps1 garde encore une ancienne clé d’identité dans $SzhAppIds : ' + ancien);
  }

  // Sur le raccourci : l'identité fait retrouver au bouton l'icône du raccourci, et
  // « Épingler » épingle le lanceur et non powershell.exe. Elle est posée après
  // $lnk.Save() : WScript.Shell réécrit le fichier entier et effacerait une propriété posée
  // avant.
  const save = SHELL.indexOf('$lnk.Save()');
  const pose = SHELL.indexOf('Set-SzhLnkAppId', save);
  assert.ok(save !== -1 && pose !== -1, 'l’identité n’est plus posée sur les raccourcis');
  assert.ok(pose > save, 'posée avant $lnk.Save(), elle serait effacée par la sauvegarde');

  // Dans le processus : l'identité se déclare avant la première fenêtre, car Windows la lit
  // quand la fenêtre s'inscrit à la barre et ne la relit plus. La seule fenêtre de Pronto est
  // le sélecteur de version (open-revue.ps1 -Versions), qui prend l'identité de la mise à jour.
  const iVersions = OUVRIR.indexOf('if ($Versions) {');
  const decl = OUVRIR.indexOf("Set-SzhAppUserModelId (Get-SzhAppId 'maj')", iVersions);
  const fenetre = OUVRIR.indexOf('Show-SzhVersions', iVersions);
  assert.ok(iVersions !== -1 && decl !== -1, 'open-revue.ps1 -Versions ne déclare plus l’identité de barre des tâches');
  assert.ok(fenetre !== -1, 'open-revue.ps1 -Versions n’ouvre plus le sélecteur');
  assert.ok(decl < fenetre, 'identité déclarée après la première fenêtre : trop tard');

  // Chaque produit garde sa ligne dans la table (icône, raccourci...), sans champ appId.
  for (const jeton of ['revue', 'zeitschrift', 'livre']) {
    const debutLigne = SHELL_PRODUITS.indexOf(jeton + ' = @{');
    assert.ok(debutLigne !== -1, 'szh-produits.ps1 : ligne de table manquante pour ' + jeton);
  }
  assert.ok(SHELL_PRODUITS.indexOf('appId') === -1,
    'szh-produits.ps1 garde encore un champ appId : il n’a plus de sens depuis la fusion des lanceurs');

  // L'entrée « Pronto » ouvre VSCodium sur l'Accueil, qui porte l'identité de l'éditeur.
  // open-livre.ps1 est une enveloppe d'open-revue.ps1.
  assert.ok(OUVRIR.indexOf('exit (Start-SzhAccueil)') !== -1, 'open-revue.ps1 n’ouvre plus l’Accueil');
  assert.ok(OUVRIR.indexOf("Get-SzhAppId 'suite'") === -1, 'open-revue.ps1 déclare encore l’identité du lanceur');
  assert.ok(OUVRIR_LIVRE.indexOf("Join-Path $PSScriptRoot 'open-revue.ps1'") !== -1,
    'open-livre.ps1 ne délègue plus à open-revue.ps1');

  // La fenêtre de mise à jour a son propre bouton, sous une seule clé fixe, « maj ».
  assert.ok(UPDATE.indexOf("Get-SzhAppId 'maj'") !== -1,
    'update.ps1 ne déclare plus son identité par la clé fixe "maj"');
  assert.ok(UPDATE.indexOf('Set-SzhAppUserModelId $idMaj') !== -1,
    'update.ps1 ne déclare plus son identité');
});

// ---- Les textes ----

test('les libellés des raccourcis existent dans les trois langues, en « ss »', () => {
  for (const cle of ['raccourci.maj.nom', 'raccourci.maj.desc', 'raccourci.lanceur.desc']) {
    const motif = new RegExp("'" + cle.replace(/\./g, '\\.') + "'\\s*=\\s*(.+)", 'g');
    const lignes = TEXTES.match(motif) || [];
    assert.strictEqual(lignes.length, 3, 'il manque une traduction de ' + cle);
    for (const l of lignes) {
      assert.ok(l.indexOf('ß') === -1, 'orthographe suisse (ss) : ' + l);
      assert.ok(l.trim().length > cle.length + 6, 'traduction vide : ' + l);
    }
  }
  // Les trois noms de produit sont des littéraux de szh-shell.ps1 ; les noms de mise à jour
  // viennent de szh-textes.ps1 (raccourci.maj.nom). Chacun est un nom de fichier .lnk : aucun
  // caractère interdit par Windows.
  for (const nom of NOMS) {
    assert.ok(!/[<>:"/\\|?*]/.test(nom), 'nom de fichier impossible : ' + nom);
    // PowerShell traite l'apostrophe courbe comme un délimiteur de chaîne : dans le source,
    // elle est doublée. On compare donc les deux formes.
    const doublee = nom.split('’').join('’’');
    assert.ok(SHELL.indexOf(nom) !== -1 || SHELL.indexOf(doublee) !== -1 ||
      TEXTES.indexOf(nom) !== -1 || TEXTES.indexOf(doublee) !== -1,
      'ni szh-shell.ps1 ni szh-textes.ps1 ne portent plus le libellé : ' + nom);
  }
  // Le libellé français, avec son apostrophe doublée comme PowerShell l'exige.
  assert.ok(TEXTES.indexOf("'Mise à jour de l’’outil Revue'") !== -1);
  assert.ok(TEXTES.indexOf("'Aktualisierung des Redaktionstools'") !== -1);
});

test('la mise à jour ne parle plus d’un seul raccourci, ni d’un produit', () => {
  // Le message de fin d'étape ne nomme pas un produit : il y a plusieurs entrées et deux
  // langues.
  const lignes = TEXTES.match(/'maj\.e4\.ok'\s*=\s*(.+)/g) || [];
  assert.strictEqual(lignes.length, 3, 'il manque une traduction de maj.e4.ok');
  for (const l of lignes) {
    assert.ok(l.indexOf('Revues SZH') === -1, 'maj.e4.ok nomme encore un produit : ' + l);
    assert.ok(/raccourcis|Verknüpfungen|shortcuts/.test(l), 'maj.e4.ok reste au singulier : ' + l);
  }
});

// ---- Les trois appelants ----

test('les trois chemins d’installation posent les mêmes raccourcis', () => {
  // Poste neuf (bootstrap), mise à jour (update) et chaque ouverture de session
  // (update-launcher) : sans le troisième, un poste déjà à jour, où update.ps1 ne tourne pas,
  // n'obtiendrait jamais une entrée ajoutée après coup.
  for (const [nom, source] of [['update.ps1', UPDATE], ['update-launcher.ps1', LANCEUR_MAJ],
    ['bootstrap.ps1', BOOTSTRAP]]) {
    const i = source.indexOf('Set-SzhRaccourcisMenu');
    assert.ok(i !== -1, nom + ' ne pose plus les raccourcis du menu Démarrer');
  // Non bloquant : l'appel est sous try, et le catch écrit au journal au lieu de relever.
    const avant = source.slice(0, i);
    const dernierTry = avant.lastIndexOf('try {');
    assert.ok(dernierTry !== -1 && avant.indexOf('} catch', dernierTry) === -1,
      nom + ' : l’appel doit être sous try, un menu verrouillé ne doit rien faire échouer');
    const apres = source.slice(i, i + 1400);
    assert.ok(/\} catch \{/.test(apres), nom + ' : pas de catch après l’appel');
  // Un raccourci absent est signalé au journal.
    assert.ok(apres.indexOf('$bilanMenu.manques') !== -1,
      nom + ' : les raccourcis non posés ne sont plus journalisés');
  }
  // bootstrap.ps1 pose les raccourcis après avoir obtenu le toolkit : si la Release est
  // injoignable, le repli hors ligne a déjà copié les scripts, et le poste a son menu même
  // quand la première mise à jour échoue sur le manifest.
  assert.ok(BOOTSTRAP.indexOf("Impossible d''obtenir le toolkit") <
    BOOTSTRAP.indexOf('Set-SzhRaccourcisMenu'), 'bootstrap pose le menu avant le toolkit');
  // update-launcher.ps1 les pose avant de chercher une nouvelle version, sinon la sortie
  // anticipée « à jour » sauterait l'étape.
  assert.ok(LANCEUR_MAJ.indexOf('Set-SzhRaccourcisMenu') <
    LANCEUR_MAJ.indexOf('Get-SzhManifest'), 'la sortie « à jour » sauterait le menu');
});

test('update.ps1 prend la langue de son raccourci, pour cette fenêtre seulement', () => {
  assert.match(UPDATE, /\[string\]\$Langue/);
  const debut = UPDATE.indexOf('. "$PSScriptRoot\\szh-common.ps1"');
  const corps = UPDATE.slice(debut, UPDATE.indexOf("T 'maj.fenetre'"));
  // La langue s'applique avant le premier texte affiché, sinon le titre de la fenêtre et la
  // bannière sortiraient dans l'autre langue.
  assert.ok(corps.indexOf('$script:SzhLangue = $Langue.ToLower()') !== -1,
    'update.ps1 n’applique plus la langue reçue');
  // Trois valeurs admises ; une valeur inconnue est ignorée : c'est un détail d'affichage, pas
  // une raison d'arrêter une mise à jour.
  assert.match(corps, /@\('fr', 'de', 'en'\) -contains \$Langue\.ToLower\(\)/);
  // $env:SZH_LANGUE garde le dernier mot, comme dans szh-common et Set-SzhLangueProduit.
  assert.ok(corps.indexOf('$envLangue') !== -1 && corps.indexOf('-not $envLangue') !== -1,
    'la variable d’environnement doit garder le dernier mot');
  // La préférence du poste n'est pas réécrite : la mise à jour n'a pas à choisir la langue des
  // lanceurs.
  assert.ok(corps.indexOf('Save-SzhState') === -1,
    'update.ps1 ne doit pas écrire la préférence de langue du poste');
  assert.ok(corps.indexOf('Set-SzhLangueProduit') === -1);
});

// ---- La fonction, réellement exécutée ----
// Rien n'est écrit dans le vrai menu Démarrer : $Menu pointe sur un dossier de travail.

// Un seul lancement de PowerShell pour les quatre situations : le démarrage du socle coûte
// plus cher que le reste.
const PILOTE = [
  "$ErrorActionPreference = 'Stop'",
  '. "' + COMMUN_PS1 + '"',
  '$menu = $args[0]; $toolkit = $args[1]; $sortie = $args[2]',
  '$sh = New-Object -ComObject WScript.Shell',
  'New-Item -ItemType Directory -Force -Path $menu | Out-Null',
  // Un raccourci d'une version antérieure, mal nommé ; un raccourci étranger ; et le
  // sous-dossier « SZH » d'un autre produit, qui ne doit pas être touché.
  "$a = $sh.CreateShortcut((Join-Path $menu 'Mise a jour Revue SZH.lnk'))",
  '$a.TargetPath = (Join-Path $env:WINDIR \'System32\\wscript.exe\')',
  "$a.Arguments = ('//B \"{0}\" \"{1}\"' -f (Join-Path $toolkit 'windows\\hidden.vbs'), (Join-Path $toolkit 'windows\\update.ps1'))",
  '$a.Save()',
  "$b = $sh.CreateShortcut((Join-Path $menu 'Bloc-notes.lnk'))",
  '$b.TargetPath = (Join-Path $env:WINDIR \'System32\\notepad.exe\'); $b.Save()',
  "New-Item -ItemType Directory -Force -Path (Join-Path $menu 'SZH') | Out-Null",
  "$c = $sh.CreateShortcut((Join-Path $menu 'SZH\\SZH Updater.lnk'))",
  '$c.TargetPath = (Join-Path $env:LOCALAPPDATA \'SZH\\AppUpdater\\SZH-AppUpdater.exe\'); $c.Save()',
  '$r = [ordered]@{}',
  // 1. la pose
  '$p1 = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
  '$r.poses = @($p1.poses); $r.retires = @($p1.retires); $r.manques = @($p1.manques)',
  '$r.lnk = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\' | Sort-Object Name | ForEach-Object {',
  '  $l = $sh.CreateShortcut($_.FullName)',
  '  [ordered]@{ nom = $_.Name; cible = $l.TargetPath; args = $l.Arguments; desc = $l.Description; icone = $l.IconLocation',
  '    fenetre = [int]$l.WindowStyle; appid = [string](Get-SzhLnkAppId $_.FullName) } })',
  "$r.sousDossier = @(Get-ChildItem -LiteralPath (Join-Path $menu 'SZH') -Filter '*.lnk' | ForEach-Object { $_.Name })",
  // 2. deux passes de suite ne doublent rien
  '$p2 = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
  '$r.passe2 = [ordered]@{ poses = @($p2.poses).Count; retires = @($p2.retires).Count; manques = @($p2.manques).Count',
  '  fichiers = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\').Count }',
  // 3. un menu que le poste refuse d'écrire (ce que fait une stratégie de groupe)
  "$verrou = Join-Path (Split-Path $menu -Parent) 'menu-verrouille'",
  'New-Item -ItemType Directory -Force -Path $verrou | Out-Null',
  "Invoke-SzhNatif { & icacls $verrou /inheritance:r /grant ($env:USERNAME + ':(RX)') 2>$null | Out-Null }",
  // Un compte administrateur (comme le runner de CI) passe outre cette ACL. Le pilote tente
  // d'écrire un fichier témoin juste après la restriction : si l'écriture passe, le contrôle
  // qui suit ne mesurerait rien.
  '$aclContournee = $false',
  'try {',
  '  Set-Content -Path (Join-Path $verrou "temoin-acl.txt") -Value "x" -ErrorAction Stop',
  '  $aclContournee = $true',
  '  Remove-Item -LiteralPath (Join-Path $verrou "temoin-acl.txt") -Force -ErrorAction SilentlyContinue',
  '} catch { }',
  '$p3 = Set-SzhRaccourcisMenu -Menu $verrou -Toolkit $toolkit',
  '$r.verrou = [ordered]@{ poses = @($p3.poses).Count; manques = @($p3.manques)',
  '  fichiers = @(Get-ChildItem -LiteralPath $verrou -Filter \'*.lnk\' -ErrorAction SilentlyContinue).Count',
  '  aclContournee = $aclContournee }',
  "Invoke-SzhNatif { & icacls $verrou /reset 2>$null | Out-Null }",
  "Invoke-SzhNatif { & icacls $verrou /grant ($env:USERNAME + ':(F)') 2>$null | Out-Null }",
  // 4. un toolkit incomplet : pas de raccourci mort vers un script absent
  "$partiel = Join-Path (Split-Path $menu -Parent) 'toolkit-partiel'",
  "New-Item -ItemType Directory -Force -Path (Join-Path $partiel 'windows') | Out-Null",
  "foreach ($f in 'open-revue.ps1', 'hidden.vbs') { Copy-Item (Join-Path $toolkit ('windows\\' + $f)) (Join-Path $partiel 'windows') -Force }",
  "$menu4 = Join-Path (Split-Path $menu -Parent) 'Programs-partiel'",
  '$p4 = Set-SzhRaccourcisMenu -Menu $menu4 -Toolkit $partiel',
  '$r.partiel = [ordered]@{ poses = @($p4.poses); manques = @($p4.manques)',
  '  fichiers = @(Get-ChildItem -LiteralPath $menu4 -Filter \'*.lnk\' | ForEach-Object { $_.Name }) }',
  'Set-SzhJson $sortie $r'
].join('\r\n') + '\r\n';

const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-raccourcis-'));
  const pilote = path.join(travail, 'poser.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(pilote, PILOTE, 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    path.join(travail, 'Programs'), RACINE, sortie],
  { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { travail, status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('le menu reçoit les DEUX entrées, résolues comme le shell les lit', { skip: sansPowerShell }, () => {
  // Chaque entrée (le lanceur, sa mise à jour) se pose avec la bonne cible, la bonne icône et
  // sa propre identité de barre des tâches.
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a échoué : ' + bilan.stderr);
  const r = bilan.r;
  assert.deepStrictEqual(r.manques, [], 'un raccourci n’a pas pu être posé');
  assert.deepStrictEqual(r.poses.slice().sort(), NOMS_ACTUELS.slice().sort());
  const par = {};
  for (const l of r.lnk) { par[l.nom] = l; }

  // Le lanceur : caché, sans -Produit (le produit montré par l'Accueil vient du réglage du
  // compte).
  const lanceur = par[NOM_APPLICATION + '.lnk'];
  assert.ok(lanceur, NOM_APPLICATION + ' manque au menu');
  assert.match(lanceur.cible, /wscript\.exe$/i);
  assert.ok(lanceur.args.indexOf('hidden.vbs') !== -1, 'le lanceur doit rester sans console');
  assert.ok(lanceur.args.indexOf('-Produit') === -1,
    'le lanceur reçoit encore -Produit : l’onglet ouvert ne devrait plus dépendre du raccourci');
  assert.ok(lanceur.icone.indexOf('pronto.ico') !== -1, 'icône ' + lanceur.icone);
  assert.ok(lanceur.desc.length > 8, 'description vide');
  // L'identité de VSCodium : un seul bouton dans la barre des tâches pour Pronto et l'éditeur.
  assert.strictEqual(lanceur.appid, 'VSCodium.VSCodium', 'identité de barre des tâches');

  // La mise à jour : powershell.exe en direct, fenêtre normale, sans langue dans le raccourci
  // (la fenêtre suit le réglage du compte).
  const maj = par[NOM_MISE_A_JOUR + '.lnk'];
  assert.ok(maj, NOM_MISE_A_JOUR + ' manque au menu');
  assert.match(maj.cible, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.ok(maj.args.indexOf('hidden.vbs') === -1, 'une mise à jour doit se voir');
  assert.ok(maj.args.indexOf('-Langue') === -1,
    'la mise à jour reçoit encore -Langue par son raccourci');
  assert.ok(maj.args.indexOf('update.ps1"') !== -1, maj.args);
  assert.strictEqual(maj.fenetre, 1, 'la fenêtre doit être normale');
  assert.ok(maj.icone.indexOf('pronto-maj.ico') !== -1, 'icône ' + maj.icone);
  assert.strictEqual(maj.appid, 'SZH.Publishing.MiseAJour', 'identité');
  assert.ok(maj.desc.length > 8, 'description vide');

  // Windows tient l'AppUserModelID pour l'identité de l'application et n'affiche qu'une
  // entrée de menu par identité : chaque entrée a la sienne.
  const identites = r.lnk.map((l) => l.appid);
  assert.strictEqual(new Set(identites).size, identites.length,
    'deux entrées du menu partagent une identité : ' + identites.join(', '));
  assert.notStrictEqual(lanceur.desc, maj.desc, 'les deux entrées ont la même description');
});

test('un ancien raccourci mal nommé est retiré, pas doublé', { skip: sansPowerShell }, () => {
  const r = bilan.r;
  assert.deepStrictEqual(r.retires, ['Mise a jour Revue SZH.lnk']);
  const noms = r.lnk.map((l) => l.nom);
  assert.ok(noms.indexOf('Mise a jour Revue SZH.lnk') === -1, 'l’ancien raccourci survit');
  // Rien d'étranger n'est touché : ni un raccourci du premier niveau, ni le sous-dossier
  // « SZH », qui appartient à l'AppLauncher interne.
  assert.ok(noms.indexOf('Bloc-notes.lnk') !== -1, 'un raccourci étranger a été supprimé');
  assert.deepStrictEqual(r.sousDossier, ['SZH Updater.lnk'],
    'le sous-dossier « SZH » d’un autre produit a été touché');
  // Deux entrées plus l'étranger : trois fichiers.
  assert.strictEqual(r.lnk.length, 3, 'le menu porte les deux entrées plus l’étranger');
  // Deux passes de suite : rien de doublé, rien de retiré une seconde fois.
  assert.strictEqual(r.passe2.poses, 2);
  assert.strictEqual(r.passe2.retires, 0);
  assert.strictEqual(r.passe2.manques, 0);
  assert.strictEqual(r.passe2.fichiers, 3);
});

// Set-SzhRaccourcisMenu reconnaît un ancien raccourci à sa cible, pas à son nom. La
// désinstallation a besoin des noms : sur un poste dont le toolkit est déjà retiré, il ne
// reste que le nom d'un .lnk. test/js/desinstallation.test.js vérifie qu'un nom périmé
// n'entre dans le plan que si le fichier existe.
test('Get-SzhRaccourcisObsoletes nomme les neuf entrées périmées : trois produits, trois langues de mise à jour, deux anciens noms d\'application, et Pronto (dev)',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-obsoletes-'));
    const sortie = path.join(travail, 'bilan.json');
    const pilote = path.join(travail, 'lire.ps1');
    fs.writeFileSync(pilote, [
      "$ErrorActionPreference = 'Stop'",
      '. "' + COMMUN_PS1 + '"',
      '$r = [ordered]@{',
      '  obsoletes = @(Get-SzhRaccourcisObsoletes)',
      '  majFr     = [string]$SzhTextes[\'fr\'][\'raccourci.maj.nom\']',
      '  majDe     = [string]$SzhTextes[\'de\'][\'raccourci.maj.nom\']',
      '  majEn     = [string]$SzhTextes[\'en\'][\'raccourci.maj.nom\']',
      '}',
      'Set-SzhJson $args[0] $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, sortie],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.strictEqual(run.status, 0, 'pilote : ' + (run.stderr || ''));
    const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
    fs.rmSync(travail, { recursive: true, force: true });
    // Les trois noms de produit, puis les trois traductions de « raccourci.maj.nom » (fr, de
    // et en : un poste où Windows résolvait « en » a pu recevoir cette version), les deux
    // anciens noms de l'application, et « Pronto (dev) », que seul outils-dev/pronto-dev.ps1
    // pose sur un poste de développement.
    const attendus = ['Revues SZH', 'Zeitschriften SZH', 'Books SZH-CSPS', r.majFr, r.majDe, r.majEn,
      'Revue & Zeitschrift', 'Revue & Zeitschrift (Updater)', 'Pronto (dev)'];
    assert.strictEqual(r.obsoletes.length, 9, 'Get-SzhRaccourcisObsoletes doit nommer les neuf anciens noms');
    assert.deepStrictEqual(r.obsoletes.slice().sort(), attendus.slice().sort());
    // Les deux entrées actuelles n'y figurent pas : la désinstallation les compterait sinon
    // parmi ce qui n'existe plus.
    for (const actuel of NOMS_ACTUELS) {
      assert.ok(r.obsoletes.indexOf(actuel) === -1, actuel + ' ne devrait pas être dans les entrées périmées');
    }
  });

test('un menu Démarrer non inscriptible n’arrête rien, et le dit', { skip: sansPowerShell }, (t) => {
  const v = bilan.r.verrou;
  // Un compte administrateur (comme le runner de CI) passe outre l'ACL posée par le pilote :
  // le menu reste inscriptible et ce contrôle ne mesurerait rien. Le pilote a tenté d'écrire
  // un fichier témoin (voir PILOTE) ; si l'écriture est passée, le test est sauté.
  if (v.aclContournee) { sauter.eleve(t); return; }
  // La fonction ne lève pas, sinon le pilote entier serait tombé.
  assert.strictEqual(bilan.status, 0);
  assert.strictEqual(v.poses, 0);
  assert.strictEqual(v.fichiers, 0);
  // Deux entrées manquantes plus la ligne d'ensemble : au moins trois lignes.
  assert.ok(v.manques.length >= 3, 'chaque entrée manquante doit être nommée');
  for (const nom of NOMS_ACTUELS) {
    assert.ok(v.manques.some((m) => m.indexOf(nom) === 0), 'rien n’est dit de : ' + nom);
  }
  // Une ligne d'ensemble dit la cause probable et la marche à suivre en attendant.
  const ensemble = v.manques.filter((m) => m.indexOf('stratégie de groupe') !== -1);
  assert.strictEqual(ensemble.length, 1, 'il faut une ligne d’ensemble, et une seule');
  assert.match(ensemble[0], /Changer de version/);
  assert.match(ensemble[0], /Rien d'autre n'est affecté/);
});

test('un toolkit incomplet ne laisse pas de raccourci mort', { skip: sansPowerShell }, () => {
  // Le raccourci pointe dans le toolkit ; si le script visé n'y est pas, il n'est pas posé, le
  // journal le dit, et le reste est posé. Get-SzhRaccourcisMenu connaît deux scripts :
  // open-revue.ps1 (le lanceur) et update.ps1 (la mise à jour). Ce toolkit partiel a
  // open-revue.ps1 et hidden.vbs, pas update.ps1 : un seul manque.
  const p = bilan.r.partiel;
  assert.deepStrictEqual(p.poses.slice().sort(), [NOM_APPLICATION]);
  assert.deepStrictEqual(p.fichiers.slice().sort(), [NOM_APPLICATION + '.lnk']);
  assert.strictEqual(p.manques.length, 1);
  for (const m of p.manques) {
    assert.match(m, /update\.ps1 manque au toolkit/);
    // Le message dit ce qui réparera, sans intervention.
    assert.match(m, /tâche planifiée/);
  }
});

// ---- La migration : un poste en service porte encore les cinq anciennes entrées ----
//
// Un poste en service se met à jour sans intervention. Les cinq anciens .lnk (trois
// lanceurs, deux mises à jour) sont posés sur un menu Démarrer jetable, avec leurs vraies
// cibles (open-revue.ps1, open-livre.ps1, update.ps1) : c'est la cible, et non le nom, que
// Set-SzhRaccourcisMenu reconnaît. Une seule passe doit les retirer tous et ne laisser que
// les deux entrées actuelles.
test('la migration : un menu à cinq anciennes entrées n’en garde plus que deux, et le dit',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-migration-'));
    const menu = path.join(travail, 'Programs');
    const sortie = path.join(travail, 'bilan.json');
    const pilote = path.join(travail, 'migrer.ps1');
    fs.writeFileSync(pilote, [
      "$ErrorActionPreference = 'Stop'",
      '. "' + COMMUN_PS1 + '"',
      '$menu = $args[0]; $toolkit = $args[1]; $sortie = $args[2]',
      'New-Item -ItemType Directory -Force -Path $menu | Out-Null',
      '$sh = New-Object -ComObject WScript.Shell',
      '$vbs = Join-Path $toolkit "windows\\hidden.vbs"',
      '$wscript = Join-Path $env:WINDIR "System32\\wscript.exe"',
      '$ps = Join-Path $env:WINDIR "System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
      // Les trois anciens lanceurs : wscript.exe //B hidden.vbs <script>.
      "foreach ($e in @(" +
        "@{ nom = 'Revues SZH'; script = 'open-revue.ps1'; args = '' }, " +
        "@{ nom = 'Zeitschriften SZH'; script = 'open-revue.ps1'; args = ' \"-Produit\" \"zeitschrift\"' }, " +
        "@{ nom = 'Books SZH-CSPS'; script = 'open-livre.ps1'; args = '' }" +
        ")) {",
      '  $l = $sh.CreateShortcut((Join-Path $menu ($e.nom + ".lnk")))',
      '  $l.TargetPath = $wscript',
      '  $cible = Join-Path $toolkit ("windows\\" + $e.script)',
      '  $l.Arguments = (\'//B "{0}" "{1}"\' -f $vbs, $cible) + $e.args',
      '  $l.Save()',
      '}',
      // Les deux anciennes mises à jour : powershell.exe en direct, une par langue.
      "foreach ($e in @(" +
        "@{ nom = 'Mise a jour Revue SZH'; langue = 'fr' }, " +
        "@{ nom = 'Update Redaktionstool SZH'; langue = 'de' }" +
        ")) {",
      '  $l = $sh.CreateShortcut((Join-Path $menu ($e.nom + ".lnk")))',
      '  $l.TargetPath = $ps',
      '  $cible = Join-Path $toolkit "windows\\update.ps1"',
      '  $l.Arguments = (\'-NoProfile -ExecutionPolicy Bypass -File "{0}" -Langue {1}\' -f $cible, $e.langue)',
      '  $l.Save()',
      '}',
      '$avant = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\').Count',
      '$bilan = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
      '$apres = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\' | ForEach-Object { $_.Name })',
      '$r = [ordered]@{ avant = $avant; retires = @($bilan.retires); poses = @($bilan.poses)',
      '  manques = @($bilan.manques); apres = @($apres) }',
      'Set-SzhJson $sortie $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
      menu, RACINE, sortie], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.strictEqual(run.status, 0, 'le pilote de migration a échoué : ' + (run.stderr || ''));
    const r = JSON.parse(fs.readFileSync(sortie, 'utf8'));
    fs.rmSync(travail, { recursive: true, force: true });

    assert.strictEqual(r.avant, 5, 'le pilote n’a pas posé les cinq anciennes entrées');
    // Les cinq retraits, reconnus à leur cible (open-revue.ps1, open-livre.ps1, update.ps1).
    assert.strictEqual(r.retires.length, 5, 'Set-SzhRaccourcisMenu ne retire plus les cinq anciennes entrées');
    assert.deepStrictEqual(r.retires.slice().sort(), [
      'Books SZH-CSPS.lnk', 'Mise a jour Revue SZH.lnk', 'Revues SZH.lnk',
      'Update Redaktionstool SZH.lnk', 'Zeitschriften SZH.lnk'
    ]);
    // Les deux entrées actuelles, posées à la même passe.
    assert.deepStrictEqual(r.poses.slice().sort(), NOMS_ACTUELS.slice().sort());
    assert.deepStrictEqual(r.manques, []);
    // Sur le disque, il ne reste que ces deux fichiers.
    assert.deepStrictEqual(r.apres.slice().sort(), (NOMS_ACTUELS.map((n) => n + '.lnk')).sort());
    assert.strictEqual(r.apres.length, 2, 'le menu ne porte plus exactement deux entrées');
  });

// Un seul bouton dans la barre des tâches : « Pronto » prend l'identité de VSCodium. Le menu
// Démarrer ne montre qu'une entrée par identité, et « VSCodium » l'emporterait : les
// raccourcis de l'installeur reçoivent donc une identité à eux, et pronto.ico.
test('Pronto prend l’identité de VSCodium, et les raccourcis de VSCodium en reçoivent une autre',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-codium-lnk-'));
    const menu = path.join(travail, 'Programs');
    const exe = path.join(travail, 'VSCodium', 'VSCodium.exe');
    const sortie = path.join(travail, 'bilan.json');
    const pilote = path.join(travail, 'poser.ps1');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, 'x');
    fs.writeFileSync(pilote, [
      "$ErrorActionPreference = 'Stop'",
      '. "' + COMMUN_PS1 + '"',
      '$menu = $args[0]; $toolkit = $args[1]; $sortie = $args[2]; $exe = $args[3]',
      '$sh = New-Object -ComObject WScript.Shell',
      "New-Item -ItemType Directory -Force -Path (Join-Path $menu 'VSCodium') | Out-Null",
      // Celui de l'installeur, dans son dossier, sans icône ; celui du premier niveau porte
      // déjà pronto.ico et garde l'identité.
      "foreach ($n in 'VSCodium\\VSCodium.lnk', 'VSCodium.lnk') {",
      '  $l = $sh.CreateShortcut((Join-Path $menu $n)); $l.TargetPath = $exe',
      "  if ($n -eq 'VSCodium.lnk') { $l.IconLocation = (Join-Path $toolkit 'windows\\pronto.ico') + ',0' }",
      '  $l.Save()',
      "  [void](Set-SzhLnkAppId (Join-Path $menu $n) 'VSCodium.VSCodium') }",
      "$b = $sh.CreateShortcut((Join-Path $menu 'Bloc-notes.lnk'))",
      '$b.TargetPath = (Join-Path $env:WINDIR \'System32\\notepad.exe\'); $b.Save()',
      '$p = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
      '$r = [ordered]@{ manques = @($p.manques); codium = @($p.codium); lnk = [ordered]@{} }',
      "foreach ($n in 'Pronto.lnk', 'Pronto (Updater).lnk', 'VSCodium.lnk', 'VSCodium\\VSCodium.lnk', 'Bloc-notes.lnk') {",
      '  $f = Join-Path $menu $n; $l = $sh.CreateShortcut($f)',
      '  $r.lnk[$n] = [ordered]@{ icone = [string]$l.IconLocation; appid = [string](Get-SzhLnkAppId $f) } }',
      'Set-SzhJson $sortie $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
      menu, RACINE, sortie, exe], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    const r = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote a échoué : ' + (run.stderr || ''));
    // Les raccourcis de l'entrée Pronto et de la mise à jour, chacun sous son nom.
    const pronto = r.lnk[NOM_APPLICATION + '.lnk'];
    const maj = r.lnk[NOM_MISE_A_JOUR + '.lnk'];
    assert.strictEqual(pronto.appid, 'VSCodium.VSCodium', 'Pronto ne partage pas l’identité de VSCodium');
    assert.ok(pronto.icone.indexOf('pronto.ico') !== -1, 'Pronto a perdu son icône : ' + pronto.icone);
    assert.strictEqual(maj.appid, 'SZH.Publishing.MiseAJour', 'la mise à jour a perdu son identité');
    const voulue = path.join(RACINE, 'windows', 'pronto.ico') + ',0';
    for (const n of ['VSCodium.lnk', 'VSCodium\\VSCodium.lnk']) {
      assert.strictEqual(r.lnk[n].icone.toLowerCase(), voulue.toLowerCase(), n + ' garde l’icône de l’exécutable');
      assert.strictEqual(r.lnk[n].appid, 'SZH.Publishing.VSCodium',
        n + ' partage l’identité de Pronto, qui disparaît alors du menu Démarrer');
    }
    assert.deepStrictEqual(r.codium.slice().sort(), ['VSCodium.lnk', 'VSCodium.lnk']);
    assert.strictEqual(r.lnk['Bloc-notes.lnk'].icone, ',0', 'un raccourci étranger a été retouché');
    assert.deepStrictEqual(r.manques, []);
  });
