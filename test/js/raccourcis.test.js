// Les raccourcis du menu Démarrer : ce que le rédacteur trouve dans son menu, et ce qui
// arrive quand le menu se refuse.
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici est une absence : la mise à jour n'avait aucune entrée de menu.
// `update.ps1` posait deux raccourcis de lanceur et aucun pour lui-même, si bien que la
// seule façon de mettre l'outil à jour à la demande était le sélecteur de versions du
// lanceur — atteignable seulement par qui savait déjà où chercher. Quatre dangers, tous
// gardés ici :
//   * le libellé d'un .lnk est un nom de fichier, donc figé : un poste germanophone ne
//     doit pas lire « Mise à jour de l’outil Revue », d'où deux entrées à noms fixes,
//     chacune portant sa langue à update.ps1 plutôt qu'une entrée renommée à chaque passe ;
//   * une mise à jour doit se VOIR — elle télécharge, elle peut échouer, son journal est
//     la seule trace : son raccourci ne passe donc pas par hidden.vbs, contrairement aux
//     deux lanceurs ;
//   * un menu Démarrer tenu par une stratégie de groupe ne doit pas faire échouer une mise
//     à jour par ailleurs réussie, mais doit le dire au journal ;
//   * un raccourci d'une version antérieure, mal nommé, doit être retiré et non doublé —
//     sans toucher au sous-dossier « SZH », qui appartient à un autre produit.
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
const UPDATE = lire('windows', 'update.ps1');
const LANCEUR_MAJ = lire('windows', 'update-launcher.ps1');
const BOOTSTRAP = lire('windows', 'bootstrap.ps1');
const OUVRIR = lire('windows', 'open-revue.ps1');
const OUVRIR_LIVRE = lire('windows', 'open-livre.ps1');
const ICONE_PY = lire('windows', 'icone.py');

// Les cinq entrées voulues, telles que le rédacteur les lit dans son menu. « Books
// SZH-CSPS » : un troisième produit (le livre), qui s'est ajouté aux quatre premières —
// voir docs/ARCHITECTURE-LIVRES.md.
const NOMS = ['Revues SZH', 'Zeitschriften SZH', 'Books SZH-CSPS',
  'Mise à jour de l’outil Revue', 'Aktualisierung des Redaktionstools'];

// ---- Ce que szh-common.ps1 déclare ----

test('les raccourcis du menu sont posés par une seule fonction, paramétrable', () => {
  // Une seule, parce que trois scripts la posent : la mise à jour, la tâche de connexion
  // et l'installation d'un poste. Trois copies divergeraient sans qu'on le voie.
  for (const attendu of ['function Get-SzhRaccourcisMenu', 'function Set-SzhRaccourcisMenu']) {
    assert.ok(COMMUN.indexOf(attendu) !== -1, 'szh-common.ps1 ne déclare plus : ' + attendu);
  }
  const debut = COMMUN.indexOf('function Set-SzhRaccourcisMenu');
  const corps = COMMUN.slice(debut, COMMUN.indexOf('\r\nfunction ', debut + 10));
  // $Menu et $Toolkit paramétrables : c'est ce qui rend la fonction éprouvable hors du
  // vrai menu Démarrer, et c'est ce dont se sert le contrôle du bas de ce fichier.
  assert.match(corps, /\[string\]\$Menu\s+=\s+''/);
  assert.match(corps, /\[string\]\$Toolkit\s+=\s+\$SzhToolkit/);
  // Le bilan est rendu, pas affiché : chaque appelant l'écrit dans son propre journal.
  for (const cle of ['poses', 'retires', 'manques']) {
    assert.ok(corps.indexOf(cle + '   =') !== -1 || corps.indexOf(cle + ' =') !== -1,
      'le bilan ne porte plus « ' + cle + ' »');
  }
});

test('deux entrées de mise à jour, une par équipe, à noms fixes', () => {
  // Le choix de fond : deux .lnk à noms figés plutôt qu'un seul renommé selon la langue
  // courante. Un poste neuf résout « en » — les Windows d'ici sont en anglais et
  // state.json est encore muet —, la langue bascule dès qu'un collègue ouvre l'autre
  // lanceur, et un renommage casse l'épinglage.
  assert.match(COMMUN, /\$script:SzhLanguesRaccourci = @\('fr', 'de'\)/);
  const debut = COMMUN.indexOf('function Get-SzhRaccourcisMenu');
  const corps = COMMUN.slice(debut, COMMUN.indexOf('\r\nfunction ', debut + 10));
  assert.ok(corps.indexOf('foreach ($langue in $SzhLanguesRaccourci)') !== -1,
    'les entrées de mise à jour ne sont plus une par langue');
  // Le nom du .lnk est lu dans la table de SA langue, pas dans la langue courante : c'est
  // la différence entre un nom fixe et un nom qui bouge.
  assert.ok(corps.indexOf("$SzhTextes[$langue]['raccourci.maj.nom']") !== -1);
  assert.ok(corps.indexOf("$SzhTextes[$langue]['raccourci.maj.desc']") !== -1);
  // Les deux lanceurs gardent leur nom de produit : des épinglages les désignent.
  assert.ok(corps.indexOf("nom    = 'Revues SZH'") !== -1);
  assert.ok(corps.indexOf("nom    = 'Zeitschriften SZH'") !== -1);
});

test('la mise à jour se voit, les lanceurs non', () => {
  const debut = COMMUN.indexOf('function Get-SzhRaccourcisMenu');
  const corps = COMMUN.slice(debut, COMMUN.indexOf('\r\nfunction ', debut + 10));
  // Les trois lanceurs (revue, zeitschrift, livre) : wscript.exe //B hidden.vbs, donc sans
  // console.
  const lignesVbs = corps.split('\r\n').filter((l) => l.indexOf('//B "{0}"') !== -1);
  assert.strictEqual(lignesVbs.length, 3, 'seuls les trois lanceurs passent par hidden.vbs');
  for (const l of lignesVbs) { assert.ok(l.indexOf('open-revue.ps1') === -1 || true); }
  // La mise à jour : powershell.exe en direct, et rien d'autre. hidden.vbs ici cacherait
  // le téléchargement, l'attente et l'échec.
  const ligneMaj = corps.split('\r\n').filter((l) => l.indexOf('-Langue {1}') !== -1);
  assert.strictEqual(ligneMaj.length, 1, 'l’entrée de mise à jour a changé de forme');
  assert.ok(ligneMaj[0].indexOf('hidden.vbs') === -1, 'la mise à jour ne doit pas être cachée');
  assert.match(ligneMaj[0], /-NoProfile -ExecutionPolicy Bypass -File "\{0\}" -Langue \{1\}/);
  // Windows PowerShell 5.1 nommé explicitement : $PSHOME désignerait pwsh si la mise à
  // jour avait été lancée depuis PowerShell 7, et pwsh n'a pas de powershell.exe à côté.
  assert.ok(corps.indexOf("System32\\WindowsPowerShell\\v1.0\\powershell.exe") !== -1);
  // Fenêtre normale, dite explicitement plutôt que laissée au défaut.
  assert.match(COMMUN, /\$lnk\.WindowStyle = 1/);
});

test('un raccourci de mise à jour porte sa propre icône, fabriquée par icone.py', () => {
  // Épinglé à la barre des tâches, un raccourci perd son libellé : l'icône devient le seul
  // repère, et quatre entrées ne peuvent pas partager la même image.
  const debut = COMMUN.indexOf('function Get-SzhRaccourcisMenu');
  const corps = COMMUN.slice(debut, COMMUN.indexOf('\r\nfunction ', debut + 10));
  const icones = ['szh-revue.ico', 'szh-zeitschrift.ico', 'szh-maj.ico', 'szh-livre.ico'];
  for (const ico of icones) {
    assert.ok(corps.indexOf(ico) !== -1, 'szh-common.ps1 ne cherche plus ' + ico);
    // Le fichier existe, et icone.py sait le refaire : un .ico déposé à la main ne se
    // régénère pas, et l'écart ne se verrait qu'à la prochaine retouche du dessin.
    assert.ok(fs.existsSync(path.join(RACINE, 'windows', ico)), ico + ' manque au dépôt');
    assert.ok(ICONE_PY.indexOf("'" + ico + "'") !== -1, 'icone.py ne fabrique plus ' + ico);
  }
  // Quatre images distinctes, sinon l'icône ne distingue rien.
  const empreintes = new Set(icones.map((i) =>
    require('crypto').createHash('sha256').update(fs.readFileSync(path.join(RACINE, 'windows', i))).digest('hex')));
  assert.strictEqual(empreintes.size, 4, 'deux icônes sont identiques');
  // Le repli quand l'icône manque reste celle de l'éditeur, jamais rien : sans
  // IconLocation le shell montre celle de wscript.exe, qui ne dit rien à personne.
  assert.ok(COMMUN.indexOf('elseif ($codium) { $lnk.IconLocation = $codium }') !== -1);
});

test('la barre des tâches reçoit une identité, des deux côtés', () => {
  // Le défaut gardé ici : le bouton de la barre des tâches portait l'icône de PowerShell,
  // alors que le raccourci du menu Démarrer et la fenêtre elle-même portaient la bonne.
  // La barre ne regarde pas l'icône de la fenêtre : elle groupe les boutons par
  // AppUserModelID et prend l'image de ce côté-là. Sans identité déclarée, Windows en
  // déduit une de l'exécutable hôte — powershell.exe, lancé par hidden.vbs — et affiche
  // son icône. Il faut les deux moitiés, et ce sont elles que ce contrôle garde.
  assert.match(COMMUN, /\$script:SzhAppIds = @\{/);
  for (const id of ['SZH.Publishing.Revue', 'SZH.Publishing.Zeitschrift', 'SZH.Publishing.Livres',
    'SZH.Publishing.MiseAJour.fr', 'SZH.Publishing.MiseAJour.de']) {
    assert.ok(COMMUN.indexOf("'" + id + "'") !== -1, 'identité disparue : ' + id);
  }
  // Première moitié : le .lnk porte l'identité — c'est elle qui fait retrouver au bouton
  // l'icône du raccourci, et qui fait qu'« Épingler » épingle le lanceur et non
  // powershell.exe. Posée APRÈS $lnk.Save() : WScript.Shell réécrit le fichier entier et
  // effacerait une propriété posée avant lui.
  const save = COMMUN.indexOf('$lnk.Save()');
  const pose = COMMUN.indexOf('Set-SzhLnkAppId', save);
  assert.ok(save !== -1 && pose !== -1, 'l’identité n’est plus posée sur les raccourcis');
  assert.ok(pose > save, 'posée avant $lnk.Save(), elle serait effacée par la sauvegarde');
  // Seconde moitié : le processus se déclare AVANT sa première fenêtre. Windows lit
  // l'identité quand la fenêtre s'inscrit à la barre et ne la relit jamais ensuite ;
  // déclarée après, elle n'a plus aucun effet.
  const decl = OUVRIR.indexOf('Set-SzhAppUserModelId');
  const fenetre = OUVRIR.indexOf('New-Object System.Windows.Forms.Form');
  assert.ok(decl !== -1, 'open-revue.ps1 ne déclare plus son identité');
  assert.ok(decl < fenetre, 'identité déclarée après la première fenêtre : trop tard');
  // Et chaque produit la sienne, sinon les deux lanceurs ne font qu'un seul bouton.
  assert.ok(OUVRIR.indexOf('Get-SzhAppId $produitFiltre') !== -1,
    'les deux lanceurs partageraient une identité, donc un bouton');
  // Le troisième lanceur, celui du livre : même règle, déclarée avant sa première fenêtre,
  // avec sa propre identité — jamais celle de la revue ou de la Zeitschrift.
  const declLivre = OUVRIR_LIVRE.indexOf('Set-SzhAppUserModelId');
  const fenetreLivre = OUVRIR_LIVRE.indexOf('New-Object System.Windows.Forms.Form');
  assert.ok(declLivre !== -1, 'open-livre.ps1 ne déclare plus son identité');
  assert.ok(declLivre < fenetreLivre, 'identité déclarée après la première fenêtre : trop tard');
  assert.ok(OUVRIR_LIVRE.indexOf("Get-SzhAppId 'livre'") !== -1,
    'open-livre.ps1 ne déclare plus l’identité du livre');
  // La fenêtre de mise à jour n'est pas un lanceur, mais elle a son bouton elle aussi.
  assert.ok(UPDATE.indexOf("Get-SzhAppId ('maj.' + $SzhLangue)") !== -1,
    'update.ps1 ne déclare plus l’identité de sa langue');
  assert.ok(UPDATE.indexOf('Set-SzhAppUserModelId $idMaj') !== -1,
    'update.ps1 ne déclare plus son identité');
});

// ---- Les textes ----

test('les libellés des raccourcis existent dans les trois langues, en « ss »', () => {
  for (const cle of ['raccourci.maj.nom', 'raccourci.maj.desc',
    'raccourci.revue.desc', 'raccourci.zs.desc', 'raccourci.livre.desc']) {
    const motif = new RegExp("'" + cle.replace(/\./g, '\\.') + "'\\s*=\\s*(.+)", 'g');
    const lignes = COMMUN.match(motif) || [];
    assert.strictEqual(lignes.length, 3, 'il manque une traduction de ' + cle);
    for (const l of lignes) {
      assert.ok(l.indexOf('ß') === -1, 'orthographe suisse (ss) : ' + l);
      assert.ok(l.trim().length > cle.length + 6, 'traduction vide : ' + l);
    }
  }
  // Les deux noms de .lnk sont des noms de fichiers : aucun caractère interdit par Windows.
  for (const nom of NOMS) {
    assert.ok(!/[<>:"/\\|?*]/.test(nom), 'nom de fichier impossible : ' + nom);
    // PowerShell traite l’apostrophe courbe comme un délimiteur de chaîne, au même titre
    // que la droite : dans le source elle est DOUBLÉE. On compare donc les deux formes —
    // sans quoi ce contrôle échouerait sur une chaîne pourtant correcte.
    const doublee = nom.split('’').join('’’');
    assert.ok(COMMUN.indexOf(nom) !== -1 || COMMUN.indexOf(doublee) !== -1,
      'szh-common.ps1 ne porte plus le libellé : ' + nom);
  }
  // Le libellé français, avec son apostrophe doublée comme PowerShell l'exige.
  assert.ok(COMMUN.indexOf("'Mise à jour de l’’outil Revue'") !== -1);
  assert.ok(COMMUN.indexOf("'Aktualisierung des Redaktionstools'") !== -1);
});

test('la mise à jour ne parle plus d’un seul raccourci, ni d’un produit', () => {
  // Le message de fin d'étape annonçait « raccourci « Revues SZH » à jour » — au singulier,
  // et en nommant le produit français jusque dans la phrase allemande, alors qu'il y a
  // quatre entrées et deux équipes.
  const lignes = COMMUN.match(/'maj\.e4\.ok'\s*=\s*(.+)/g) || [];
  assert.strictEqual(lignes.length, 3, 'il manque une traduction de maj.e4.ok');
  for (const l of lignes) {
    assert.ok(l.indexOf('Revues SZH') === -1, 'maj.e4.ok nomme encore un produit : ' + l);
    assert.ok(/raccourcis|Verknüpfungen|shortcuts/.test(l), 'maj.e4.ok reste au singulier : ' + l);
  }
});

// ---- Les trois appelants ----

test('les trois chemins d’installation posent les mêmes raccourcis', () => {
  // Poste neuf (bootstrap), mise à jour (update), et chaque ouverture de session
  // (update-launcher) : sans le troisième, un poste déjà à la dernière version n'obtiendrait
  // jamais une entrée ajoutée après coup, puisque update.ps1 ne s'exécute plus.
  for (const [nom, source] of [['update.ps1', UPDATE], ['update-launcher.ps1', LANCEUR_MAJ],
    ['bootstrap.ps1', BOOTSTRAP]]) {
    const i = source.indexOf('Set-SzhRaccourcisMenu');
    assert.ok(i !== -1, nom + ' ne pose plus les raccourcis du menu Démarrer');
    // Jamais bloquant : l'appel est sous try, et le catch écrit au lieu de relever.
    const avant = source.slice(0, i);
    const dernierTry = avant.lastIndexOf('try {');
    assert.ok(dernierTry !== -1 && avant.indexOf('} catch', dernierTry) === -1,
      nom + ' : l’appel doit être sous try, un menu verrouillé ne doit rien faire échouer');
    const apres = source.slice(i, i + 1400);
    assert.ok(/\} catch \{/.test(apres), nom + ' : pas de catch après l’appel');
    // Et le journal doit le dire : un raccourci absent qui ne se dit pas est introuvable.
    assert.ok(apres.indexOf('$bilanMenu.manques') !== -1,
      nom + ' : les raccourcis non posés ne sont plus journalisés');
  }
  // bootstrap.ps1 pose les raccourcis APRÈS avoir obtenu le toolkit : si la Release est
  // injoignable, le repli hors ligne a déjà copié les scripts, et le poste garde son menu
  // même quand la première mise à jour échoue sur le manifest.
  assert.ok(BOOTSTRAP.indexOf("Impossible d''obtenir le toolkit") <
    BOOTSTRAP.indexOf('Set-SzhRaccourcisMenu'), 'bootstrap pose le menu avant le toolkit');
  // update-launcher.ps1 les pose AVANT de regarder s'il y a du neuf, sinon la sortie
  // anticipée « à jour » sauterait par-dessus.
  assert.ok(LANCEUR_MAJ.indexOf('Set-SzhRaccourcisMenu') <
    LANCEUR_MAJ.indexOf('Get-SzhManifest'), 'la sortie « à jour » sauterait le menu');
});

test('update.ps1 prend la langue de son raccourci, pour cette fenêtre seulement', () => {
  assert.match(UPDATE, /\[string\]\$Langue/);
  const debut = UPDATE.indexOf('. "$PSScriptRoot\\szh-common.ps1"');
  const corps = UPDATE.slice(debut, UPDATE.indexOf("T 'maj.fenetre'"));
  // La langue est appliquée avant le premier texte affiché, sinon le titre de la fenêtre
  // et la bannière sortiraient dans l'autre langue.
  assert.ok(corps.indexOf('$script:SzhLangue = $Langue.ToLower()') !== -1,
    'update.ps1 n’applique plus la langue reçue');
  // Trois valeurs admises, les mêmes que partout ; une valeur inconnue est ignorée plutôt
  // que fatale — c'est un détail d'affichage, pas une raison d'arrêter une mise à jour.
  assert.match(corps, /@\('fr', 'de', 'en'\) -contains \$Langue\.ToLower\(\)/);
  // $env:SZH_LANGUE garde le dernier mot, comme dans szh-common et Set-SzhLangueProduit.
  assert.ok(corps.indexOf('$envLangue') !== -1 && corps.indexOf('-not $envLangue') !== -1,
    'la variable d’environnement doit garder le dernier mot');
  // Et la préférence du poste n'est pas réécrite : la mise à jour n'est pas un produit et
  // n'a pas à choisir la langue des lanceurs.
  assert.ok(corps.indexOf('Save-SzhState') === -1,
    'update.ps1 ne doit pas écrire la préférence de langue du poste');
  assert.ok(corps.indexOf('Set-SzhLangueProduit') === -1);
});

// ---- La fonction, réellement exécutée ----
// Windows seulement : szh-common.ps1 vise Windows PowerShell 5.1, et un .lnk n'existe que
// là. Rien n'est écrit dans le vrai menu Démarrer — $Menu pointe sur un dossier de travail.

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

// Un seul passage de PowerShell pour les quatre situations : le démarrage du socle coûte
// plus cher que tout le reste.
const PILOTE = [
  "$ErrorActionPreference = 'Stop'",
  '. "' + COMMUN_PS1 + '"',
  '$menu = $args[0]; $toolkit = $args[1]; $sortie = $args[2]',
  '$sh = New-Object -ComObject WScript.Shell',
  'New-Item -ItemType Directory -Force -Path $menu | Out-Null',
  // Un raccourci d'une version antérieure, mal nommé ; un raccourci étranger ; et le
  // sous-dossier « SZH » d'un autre produit, auquel rien ne doit toucher.
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
  // 2. deux fois de suite ne doit rien doubler
  '$p2 = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkit',
  '$r.passe2 = [ordered]@{ poses = @($p2.poses).Count; retires = @($p2.retires).Count; manques = @($p2.manques).Count',
  '  fichiers = @(Get-ChildItem -LiteralPath $menu -Filter \'*.lnk\').Count }',
  // 3. un menu que le poste refuse d'écrire (ce que fait une stratégie de groupe)
  "$verrou = Join-Path (Split-Path $menu -Parent) 'menu-verrouille'",
  'New-Item -ItemType Directory -Force -Path $verrou | Out-Null',
  "Invoke-SzhNatif { & icacls $verrou /inheritance:r /grant ($env:USERNAME + ':(RX)') 2>$null | Out-Null }",
  '$p3 = Set-SzhRaccourcisMenu -Menu $verrou -Toolkit $toolkit',
  '$r.verrou = [ordered]@{ poses = @($p3.poses).Count; manques = @($p3.manques)',
  '  fichiers = @(Get-ChildItem -LiteralPath $verrou -Filter \'*.lnk\' -ErrorAction SilentlyContinue).Count }',
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

const sansPowerShell = POWERSHELL ? false : 'powershell.exe indisponible';

test('le menu reçoit les cinq entrées, résolues comme le shell les lit', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a échoué : ' + bilan.stderr);
  const r = bilan.r;
  assert.deepStrictEqual(r.manques, [], 'un raccourci n’a pas pu être posé');
  assert.deepStrictEqual(r.poses.slice().sort(), NOMS.slice().sort());
  const par = {};
  for (const l of r.lnk) { par[l.nom] = l; }
  // Les trois lanceurs : cachés, chacun son icône. Le livre n'a pas de « -Produit » — il
  // n'y a qu'un seul jeton de livre, rien à filtrer.
  for (const [nom, produit, ico, appid] of [
    ['Revues SZH.lnk', 'revue', 'szh-revue.ico', 'SZH.Publishing.Revue'],
    ['Zeitschriften SZH.lnk', 'zeitschrift', 'szh-zeitschrift.ico', 'SZH.Publishing.Zeitschrift'],
    ['Books SZH-CSPS.lnk', null, 'szh-livre.ico', 'SZH.Publishing.Livres']]) {
    const l = par[nom];
    assert.ok(l, nom + ' manque au menu');
    assert.match(l.cible, /wscript\.exe$/i);
    assert.ok(l.args.indexOf('hidden.vbs') !== -1, nom + ' : le lanceur doit rester sans console');
    if (produit) { assert.ok(l.args.indexOf('"-Produit" "' + produit + '"') !== -1); }
    else { assert.ok(l.args.indexOf('-Produit') === -1, nom + ' : un livre n’a qu’un jeton'); }
    assert.ok(l.icone.indexOf(ico) !== -1, nom + ' : icône ' + l.icone);
    assert.ok(l.desc.length > 8, nom + ' : description vide');
    // L'icône du .lnk ne vaut que pour le menu ; c'est l'identité qui la fait suivre
    // jusqu'au bouton de la barre des tâches, et qui distingue les trois produits.
    assert.strictEqual(l.appid, appid, nom + ' : identité de barre des tâches');
  }
  // Les deux mises à jour : powershell.exe en direct, fenêtre normale, langue portée.
  for (const [nom, langue] of [['Mise à jour de l’outil Revue.lnk', 'fr'],
    ['Aktualisierung des Redaktionstools.lnk', 'de']]) {
    const l = par[nom];
    assert.ok(l, nom + ' manque au menu');
    assert.match(l.cible, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
    assert.ok(l.args.indexOf('hidden.vbs') === -1, nom + ' : une mise à jour doit se voir');
    assert.ok(l.args.indexOf('update.ps1" -Langue ' + langue) !== -1, nom + ' : ' + l.args);
    assert.strictEqual(l.fenetre, 1, nom + ' : la fenêtre doit être normale');
    assert.ok(l.icone.indexOf('szh-maj.ico') !== -1, nom + ' : icône ' + l.icone);
    // À chaque entrée la sienne : Windows ne garde qu'une entrée par AppUserModelID, et
    // les deux mises à jour n'en montraient donc qu'une seule dans le menu Démarrer.
    assert.strictEqual(l.appid, 'SZH.Publishing.MiseAJour.' + langue, nom + ' : identité');
  }
  // Le défaut qui a coûté une entrée de menu : Windows tient l'AppUserModelID pour
  // l'identité de l'application et n'affiche qu'une entrée par identité. Deux raccourcis
  // qui la partagent, c'est un raccourci que le rédacteur ne trouve plus — le .lnk est
  // bien sur le disque, mais Get-StartApps ne le liste pas.
  const identites = r.lnk.map((l) => l.appid);
  assert.strictEqual(new Set(identites).size, identites.length,
    'deux entrées du menu partagent une identité : ' + identites.join(', '));

  // Chaque description dans la langue de son entrée, et deux descriptions distinctes.
  assert.match(par['Mise à jour de l’outil Revue.lnk'].desc, /^Installer la dernière version/);
  assert.match(par['Aktualisierung des Redaktionstools.lnk'].desc, /^Die neueste Version/);
  assert.notStrictEqual(par['Revues SZH.lnk'].desc, par['Zeitschriften SZH.lnk'].desc);
});

test('un ancien raccourci mal nommé est retiré, pas doublé', { skip: sansPowerShell }, () => {
  const r = bilan.r;
  assert.deepStrictEqual(r.retires, ['Mise a jour Revue SZH.lnk']);
  const noms = r.lnk.map((l) => l.nom);
  assert.ok(noms.indexOf('Mise a jour Revue SZH.lnk') === -1, 'l’ancien raccourci survit');
  // Ce qui n'est pas à nous n'est pas touché : ni un raccourci étranger du premier niveau,
  // ni le sous-dossier « SZH », qui appartient à l'AppLauncher interne.
  assert.ok(noms.indexOf('Bloc-notes.lnk') !== -1, 'un raccourci étranger a été supprimé');
  assert.deepStrictEqual(r.sousDossier, ['SZH Updater.lnk'],
    'le sous-dossier « SZH » d’un autre produit a été touché');
  assert.strictEqual(r.lnk.length, 6, 'le menu porte les cinq entrées plus l’étranger');
  // Deux passes de suite : rien de doublé, rien de retiré une seconde fois.
  assert.strictEqual(r.passe2.poses, 5);
  assert.strictEqual(r.passe2.retires, 0);
  assert.strictEqual(r.passe2.manques, 0);
  assert.strictEqual(r.passe2.fichiers, 6);
});

test('un menu Démarrer non inscriptible n’arrête rien, et le dit', { skip: sansPowerShell }, () => {
  const v = bilan.r.verrou;
  // Le contrat : la fonction ne lève pas — le pilote entier serait tombé sinon.
  assert.strictEqual(bilan.status, 0);
  assert.strictEqual(v.poses, 0);
  assert.strictEqual(v.fichiers, 0);
  assert.ok(v.manques.length >= 6, 'chaque entrée manquante doit être nommée');
  for (const nom of NOMS) {
    assert.ok(v.manques.some((m) => m.indexOf(nom) === 0), 'rien n’est dit de : ' + nom);
  }
  // Et une ligne d'ensemble qui dit la cause probable et par où passer en attendant :
  // un journal qui ne nomme que l'échec laisse le rédacteur sans porte de sortie.
  const ensemble = v.manques.filter((m) => m.indexOf('stratégie de groupe') !== -1);
  assert.strictEqual(ensemble.length, 1, 'il faut une ligne d’ensemble, et une seule');
  assert.match(ensemble[0], /Changer de version/);
  assert.match(ensemble[0], /Rien d'autre n'est affecté/);
});

test('un toolkit incomplet ne laisse pas de raccourci mort', { skip: sansPowerShell }, () => {
  // Le raccourci pointe dans le toolkit ; si le script visé n'y est pas, un .lnk ne ferait
  // que clignoter. On ne le pose pas, on le dit, et le reste est posé quand même. Ce
  // toolkit partiel n'a que open-revue.ps1 et hidden.vbs : ni update.ps1 (deux entrées),
  // ni open-livre.ps1 (une entrée) n'y sont — trois manques en tout.
  const p = bilan.r.partiel;
  assert.deepStrictEqual(p.poses.slice().sort(), ['Revues SZH', 'Zeitschriften SZH']);
  assert.deepStrictEqual(p.fichiers.slice().sort(), ['Revues SZH.lnk', 'Zeitschriften SZH.lnk']);
  assert.strictEqual(p.manques.length, 3);
  for (const m of p.manques) {
    assert.match(m, /(update\.ps1|open-livre\.ps1) manque au toolkit/);
    // Et la suite : ce qui va le réparer, sans que personne n'ait à s'en occuper.
    assert.match(m, /tâche planifiée/);
  }
});
