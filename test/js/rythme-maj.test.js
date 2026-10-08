// Le rythme de la mise à jour : quand elle se déclenche, quand elle renonce, et comment un
// blocage qui dure finit par se voir.
//
//   node --test "test/js/*.test.js"
//
// Ce que ces contrôles vérifient :
//
//   * Le rythme est « une fois par semaine, le mardi à 14 h ». Un déclencheur seul ne le
//     tient pas : celui de l'ouverture de session revient chaque matin, et un poste plus
//     ancien peut garder un déclencheur quotidien de 11 h (la tâche vit à la racine du
//     planificateur, que seul un administrateur réécrit, et une mise à jour ne demande pas
//     l'élévation). La cadence vit donc dans le script, remplacé sur chaque poste sans
//     intervention.
//   * 14 h tombe en plein après-midi de travail, et une mise à jour peut remplacer les 574 Mo
//     de l'environnement de fabrication, ce qui exige de le désenregistrer, impossible
//     « pendant qu'une compilation s'en sert » ('err.wsl'). La passe silencieuse renonce
//     alors, et repasse plus tard.
//   * Un renoncement muet qui se répète cache un poste qui ne se met plus à jour. Au bout de
//     quatre semaines, la fenêtre visible s'ouvre ; la passe, elle, reste muette.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const TACHES = lire('windows', 'szh-taches.ps1');
const LANCEUR = lire('windows', 'update-launcher.ps1');
const UPDATE = lire('windows', 'update.ps1');
const BOOTSTRAP = lire('windows', 'bootstrap.ps1');
const SHELL = lire('windows', 'szh-shell.ps1');

// ---- Une seule définition pour la forme de la tâche ----

test('la forme de la tâche est déclarée une seule fois, et les trois scripts la lisent', () => {
  // bootstrap l'écrit à l'installation, update la remet d'aplomb, la passe silencieuse la
  // vérifie à chaque ouverture de session. Trois copies divergeraient : un poste installé
  // aujourd'hui et un poste mis à jour demain porteraient deux rythmes.
  for (const [nom, source] of [['bootstrap.ps1', BOOTSTRAP], ['update.ps1', UPDATE],
    ['update-launcher.ps1', LANCEUR]]) {
    assert.ok(source.indexOf('. "$PSScriptRoot\\szh-taches.ps1"') !== -1,
      nom + ' ne dot-source plus szh-taches.ps1');
    assert.ok(source.indexOf('Set-SzhTacheMaj') !== -1,
      nom + ' ne vérifie plus la tâche planifiée');
  // Personne ne réécrit la tâche à la main à côté de la fonction.
    assert.ok(source.indexOf("Register-ScheduledTask -TaskName 'SZH - Mise a jour'") === -1,
      nom + ' enregistre encore la tâche de mise à jour lui-même');
    assert.ok(source.indexOf('New-ScheduledTaskTrigger -Daily') === -1,
      nom + ' porte encore un déclencheur quotidien');
  }
  // La tâche de préchauffage WSL reste chez bootstrap : elle n'a ni cadence ni moment.
  assert.ok(BOOTSTRAP.indexOf("'SZH - Prechauffage WSL'") !== -1);
});

test('bootstrap ne fige plus le nom de la tâche dans ses messages affichés', () => {
  // Le nom vit dans $script:SzhTacheMaj (szh-taches.ps1), que bootstrap charge avant de former
  // ses messages. Un nom recopié en dur resterait faux après un renommage, sans que rien ne le
  // signale.
  assert.ok(BOOTSTRAP.indexOf('SZH - Mise a jour') === -1,
    'bootstrap.ps1 recopie encore en dur le nom de la tâche de mise à jour dans un message');
  assert.ok(BOOTSTRAP.indexOf('$SzhTacheMaj') !== -1,
    'bootstrap.ps1 ne se réfère plus à $SzhTacheMaj pour nommer la tâche dans ses messages');
  // Le préchauffage n'a ni cadence ni moment et reste en dur : l'assertion sur le nom de la
  // mise à jour ne doit pas emporter ce littéral.
  assert.ok(BOOTSTRAP.indexOf("'SZH - Prechauffage WSL'") !== -1,
    'le préchauffage WSL a perdu son nom en dur : ce n’est pas ce défaut-ci qui est gardé');
});

test('mardi 14 h, une fois par semaine, et le déclencheur d’ouverture de session reste', () => {
  assert.match(TACHES, /\$script:SzhMajJour\s+=\s+'Tuesday'/);
  assert.match(TACHES, /\$script:SzhMajHeure\s+=\s+14/);
  assert.match(TACHES, /\$script:SzhMajJourNum\s+=\s+2/);
  const debut = TACHES.indexOf('function New-SzhTacheMajDeclencheurs');
  const corps = TACHES.slice(debut, TACHES.indexOf('\r\n# StartWhenAvailable', debut));
  assert.ok(corps.indexOf('New-ScheduledTaskTrigger -AtLogOn') !== -1,
    'le déclencheur à l’ouverture de session a disparu');
  assert.match(corps, /-Weekly -DaysOfWeek \$SzhMajJour -WeeksInterval 1/);
  assert.ok(corps.indexOf('-Daily') === -1, 'le quotidien est de retour');
  // La raison de garder l'ouverture de session est écrite au-dessus : elle rattrape les postes
  // éteints, et c'est le seul moment où l'éditeur n'est pas encore ouvert.
  const raison = TACHES.slice(TACHES.indexOf('# Deux déclencheurs'), debut);
  assert.match(raison, /éteint/);
  assert.match(raison, /éditeur n'est pas encore ouvert/);
});

test('les réglages rattrapent les fenêtres manquées et ne réveillent pas le poste', () => {
  const debut = TACHES.indexOf('function New-SzhTacheMajReglages');
  const corps = TACHES.slice(debut, TACHES.indexOf('\r\n#', debut + 10));
  assert.ok(corps.indexOf('-StartWhenAvailable') !== -1,
    'sans lui, un poste éteint le mardi à 14 h saute la semaine');
  // Avec DisallowStartIfOnBatteries à true, un portable jamais branché ne se mettrait jamais
  // à jour, ni le mardi ni à l'ouverture de session.
  assert.ok(corps.indexOf('-AllowStartIfOnBatteries') !== -1,
    'la tâche refuse encore de démarrer sur batterie');
  assert.ok(corps.indexOf('-DontStopIfGoingOnBatteries') !== -1);
  assert.ok(corps.indexOf('-MultipleInstances IgnoreNew') !== -1);
  // Pas de réveil : il dépend d'un réglage du plan d'alimentation qui diffère entre secteur et
  // batterie, et réveiller un poste pour télécharger 574 Mo est intrusif. Le rattrapage et
  // l'ouverture de session suffisent.
  assert.ok(corps.indexOf('-WakeToRun') === -1, 'la tâche réveillerait le poste');
  assert.ok(TACHES.indexOf('Pas de WakeToRun') !== -1, 'le choix n’est plus expliqué');
});

// ---- La passe silencieuse reste silencieuse ----

test('rien ne s’affiche depuis la passe silencieuse', () => {
  // Elle tourne sous hidden.vbs, sans console : un Write-Host n'irait nulle part, et un
  // Read-Host la ferait attendre indéfiniment. Ses traces vont au journal.
  for (const interdit of ['Write-Host', 'Read-Host', 'Write-SzhBanniere', 'Write-SzhInfo',
    'Write-SzhEtape', 'Write-SzhOk', 'Show-SzhErreur']) {
    assert.ok(LANCEUR.indexOf(interdit) === -1,
      'update-launcher.ps1 parle à l’écran : ' + interdit);
  }
  // Chaque renoncement laisse une trace, sinon un poste qui décroche est invisible.
  const renonce = LANCEUR.indexOf('$moment.propice');
  assert.ok(renonce !== -1, 'la passe ne consulte plus le moment');
  const suite = LANCEUR.slice(renonce, renonce + 1200);
  assert.match(suite, /Write-SzhLog \('check : renoncement/);
  assert.ok(suite.indexOf('Save-SzhBlocage') !== -1, 'le renoncement ne se retient plus');
  // La gêne qui ne cède jamais se distingue dans le journal des gênes réversibles : cent
  // lignes identiques doivent se lire comme une anomalie.
  assert.ok(suite.indexOf('$moment.grave') !== -1,
    'le renoncement ferme ne se distingue plus du renoncement poli');
});

test('le raccourci manuel, lui, reste visible', () => {
  // Automatique muet, manuel visible. La tâche planifiée passe par wscript.exe //B
  // hidden.vbs ; l'entrée du menu Démarrer lance powershell.exe en direct, fenêtre normale.
  const voulue = TACHES.slice(TACHES.indexOf('function Get-SzhTacheMajVoulue'),
    TACHES.indexOf('# Deux déclencheurs'));
  assert.match(voulue, /System32\\wscript\.exe/);
  assert.match(voulue, /\/\/B "\{0\}" "\{1\}"/);
  assert.ok(voulue.indexOf('hidden.vbs') !== -1);
  assert.ok(voulue.indexOf('update-launcher.ps1') !== -1);
  assert.ok(voulue.indexOf('update.ps1') === -1,
    'la tâche doit lancer la vérification silencieuse, pas la fenêtre visible');
  // L'entrée du menu, définie dans szh-shell.ps1, s'ouvre en fenêtre normale, sans -Langue (la
  // fenêtre prend la langue du réglage du compte). « -ExecutionPolicy Bypass -File », propre
  // à l'entrée de mise à jour, la distingue du lanceur, qui vise wscript.exe //B hidden.vbs.
  const menu = SHELL.slice(SHELL.indexOf('function Get-SzhRaccourcisMenu'),
    SHELL.indexOf('function Set-SzhRaccourcisMenu'));
  const ligneMaj = menu.split('\r\n').filter((l) => l.indexOf('-ExecutionPolicy Bypass -File') !== -1);
  assert.strictEqual(ligneMaj.length, 1);
  assert.ok(ligneMaj[0].indexOf('hidden.vbs') === -1, 'la mise à jour manuelle doit se voir');
  assert.match(SHELL, /\$lnk\.WindowStyle = 1/);
});

// ---- L'ordre des choses dans la passe silencieuse ----

test('le menu et la tâche sont réparés à chaque passage, la version une fois par semaine', () => {
  const iMenu = LANCEUR.indexOf('Set-SzhRaccourcisMenu');
  const iTache = LANCEUR.indexOf('Set-SzhTacheMaj');
  const iCadence = LANCEUR.indexOf('Test-SzhFenetreMaj');
  const iManifest = LANCEUR.indexOf('Get-SzhManifest');
  assert.ok(iMenu > 0 && iTache > iMenu, 'la tâche se vérifie après le menu');
  // La cadence vient après les deux réparations : un poste qui n'a rien de neuf à installer
  // retrouve quand même ses raccourcis et son bon déclencheur, chaque jour.
  assert.ok(iCadence > iTache, 'la cadence court-circuiterait la réparation de la tâche');
  // Et avant la lecture du manifest, qui est ainsi soumise à la cadence.
  assert.ok(iManifest > iCadence, 'le contrôle de version échappe à la cadence');
  // La sortie est muette quand la fenêtre est déjà consommée : une ligne par ouverture de
  // session noierait le journal.
  const garde = LANCEUR.slice(iCadence, iCadence + 200);
  assert.match(garde, /\{ exit 0 \}/);
  assert.ok(garde.indexOf('Write-SzhLog') === -1, 'la fenêtre fermée ne doit rien dire');
});

test('la cadence vit dans son propre fichier, par utilisateur', () => {
  // Dans son propre fichier, car update.ps1 réécrivait state.json de zéro à chaque succès et
  // la cadence y aurait été effacée.
  //
  // Et par utilisateur, car la cadence gouverne un travail par utilisateur (distribution WSL,
  // extensions, réglages, raccourcis). Sous C:\ProgramData\SZH, le premier compte connecté
  // consommerait la fenêtre de la semaine pour tous les autres.
  assert.match(TACHES, /\$script:SzhMajSuiviFile = Join-Path \$SzhBaseUtilisateur 'maj-auto\.json'/);
  assert.match(TACHES, /New-Item -ItemType Directory -Force -Path \$SzhBaseUtilisateur/);
  // update.ps1 ne réécrit plus state.json en entier (Set-SzhStateCles) : la réécriture
  // complète emportait la langue choisie par le dernier lanceur ouvert.
  assert.ok(UPDATE.indexOf('Set-SzhStateCles') !== -1,
    'update.ps1 doit écrire state.json clé par clé, pas le réécrire en entier');
  // On cherche l'appel, pas la mention : un commentaire au-dessus de Set-SzhStateCles nomme
  // Save-SzhState.
  assert.ok(!/\r?\n\s*Save-SzhState /.test(UPDATE),
    'update.ps1 réécrit encore state.json de zéro : la langue du poste y serait effacée');
  assert.ok(LANCEUR.indexOf('Save-SzhState') === -1,
    'la passe silencieuse ne doit pas toucher state.json');
  assert.ok(LANCEUR.indexOf('Set-SzhJson $SzhConfigFile') === -1);
  // Le suivi ne s'écrit pas de force : un fichier non inscriptible ne fait pas échouer une
  // vérification.
  const debut = TACHES.indexOf('function Save-SzhSuiviMaj');
  assert.match(TACHES.slice(debut, debut + 300), /try \{[\s\S]*catch \{ return \$false \}/);
});

test('un blocage qui dure finit par ouvrir la fenêtre visible, une fois par semaine au plus', () => {
  assert.match(TACHES, /\$script:SzhMajPolitesse = 28/);
  const i = LANCEUR.indexOf('Test-SzhAlerteDue');
  assert.ok(i !== -1, 'plus rien ne rend un échec répété visible');
  const suite = LANCEUR.slice(i - 200, i + 700);
  assert.ok(suite.indexOf('$presse') !== -1, 'l’alerte doit attendre le délai de politesse');
  // Le nom de la fonction a suivi son comportement : elle sait aussi se cacher (voir le
  // commentaire de update-launcher.ps1).
  assert.ok(suite.indexOf('Start-SzhFenetreMaj') !== -1,
    'l’alerte doit passer par la fenêtre visible (Start-SzhFenetreMaj -Visible), pas par un message maison');
  assert.ok(suite.indexOf('alerteLe') !== -1, 'l’alerte ne se retient pas, elle se répétera');
});

// ---- La décision, réellement exécutée ----
// Windows seulement : ces scripts visent Windows PowerShell 5.1 et le planificateur de
// tâches. La vraie tâche « SZH - Mise a jour » et le vrai C:\ProgramData\SZH ne sont pas
// touchés : la tâche d'essai vit dans un sous-dossier du planificateur, au nom de
// l'utilisateur courant, et le suivi dans un dossier de travail.

const { POWERSHELL, sansPowerShell } = require('./gardes');

const PILOTE = [
  "$ErrorActionPreference = 'Stop'",
  '. "' + path.join(RACINE, 'windows', 'szh-common.ps1') + '"',
  '. "' + path.join(RACINE, 'windows', 'szh-taches.ps1') + '"',
  '$travail = $args[0]; $sortie = $args[1]',
  '$r = [ordered]@{}',

  // 1. Le jalon hebdomadaire : le dernier mardi 14 h révolu.
  '$r.jalons = @(foreach ($q in @(',
  "  '2026-08-25T13:59:00', '2026-08-25T14:00:00', '2026-08-25T14:00:01',",
  "  '2026-08-24T09:00:00', '2026-08-26T09:00:00', '2026-08-31T23:59:00',",
  "  '2026-08-30T12:00:00', '2026-08-29T00:00:00')) {",
  '  $d = [datetime]::Parse($q, [Globalization.CultureInfo]::InvariantCulture)',
  "  [ordered]@{ quand = $q; jour = [string]$d.DayOfWeek",
  "    jalon = (Get-SzhJalonHebdo $d).ToString('s') } })",

  // 2. La fenêtre : ouverte tant que la dernière vérification est antérieure au jalon.
  '$r.fenetres = @(foreach ($c in @(',
  "  @('2026-08-25T15:00:00', ''),",
  "  @('2026-08-25T15:00:00', '2026-08-25T14:30:00'),",
  "  @('2026-08-25T15:00:00', '2026-08-24T09:00:00'),",
  "  @('2026-08-25T13:00:00', '2026-08-24T09:00:00'),",
  "  @('2026-08-31T09:00:00', '2026-08-25T14:30:00'),",
  "  @('2026-08-25T15:00:00', 'pas une date'),",
  "  @('2026-08-25T15:00:00', '2027-01-01T00:00:00'))) {",
  '  [ordered]@{ maintenant = $c[0]; derniere = $c[1]',
  '    ouverte = [bool](Test-SzhFenetreMaj -Maintenant ([datetime]::Parse($c[0], [Globalization.CultureInfo]::InvariantCulture)) -DerniereVerif $c[1]) } })',

  // 3. Le délai de politesse, et le frein de l'alerte.
  '$r.politesse = @(foreach ($c in @(',
  "  @('2026-08-25T15:00:00', ''),",
  "  @('2026-08-25T15:00:00', '2026-08-01T15:00:00'),",
  "  @('2026-08-25T15:00:00', '2026-07-28T15:00:00'),",
  "  @('2026-08-25T15:00:00', '2026-07-28T15:00:01'),",
  "  @('2026-08-25T15:00:00', 'illisible'),",
  "  @('2026-08-25T15:00:00', '2026-12-01T00:00:00'))) {",
  '  [ordered]@{ maintenant = $c[0]; depuis = $c[1]',
  '    expiree = [bool](Test-SzhPolitesseExpiree -Maintenant ([datetime]::Parse($c[0], [Globalization.CultureInfo]::InvariantCulture)) -Depuis $c[1]) } })',
  '$r.alertes = @(foreach ($c in @(',
  "  @('2026-08-25T15:00:00', ''),",
  "  @('2026-08-25T15:00:00', '2026-08-24T15:00:00'),",
  "  @('2026-08-25T15:00:00', '2026-08-18T15:00:00'),",
  "  @('2026-08-25T15:00:00', 'illisible'))) {",
  '  [ordered]@{ maintenant = $c[0]; alerteLe = $c[1]',
  '    due = [bool](Test-SzhAlerteDue -Maintenant ([datetime]::Parse($c[0], [Globalization.CultureInfo]::InvariantCulture)) -AlerteLe $c[1]) } })',

  // 4. Le moment : les trente-deux combinaisons de la décision pure.
  '$r.moments = @(foreach ($remplace in @($true, $false)) {',
  '  foreach ($presse in @($true, $false)) {',
  '    foreach ($compil in @($true, $false)) {',
  '      foreach ($editeur in @($true, $false)) {',
  '        foreach ($distro in @($true, $false)) {',
  '          $m = Resolve-SzhMomentMaj -RemplaceEnvironnement $remplace -Presse $presse -Compilation $compil -Editeur $editeur -DistroEnMarche $distro',
  '          [ordered]@{ remplace = $remplace; presse = $presse; compilation = $compil',
  '            editeur = $editeur; distro = $distro',
  '            propice = [bool]$m.propice; grave = [bool]$m.grave; raison = [string]$m.raison } } } } } })',

  // 5. Les sondes réelles ne lèvent pas, et ne mesurent rien quand il n'y a rien à
  //    remplacer : sonder la distribution la réveillerait pour rien.
  '$r.sondes = [ordered]@{',
  '  sansRemplacement = [bool](Test-SzhMomentMaj).propice',
  '  editeur = [bool](Test-SzhEditeurOuvert)',
  '  distro = [bool](Test-SzhDistroEnMarche) }',

  // 6. Le suivi : aller-retour dans un fichier de travail, pas celui du poste.
  "$script:SzhMajSuiviFile = Join-Path $travail 'maj-auto.json'",
  '$r.suiviVide = [ordered]@{ lu = [bool](Get-SzhSuiviMaj)',
  "  champ = (Get-SzhSuiviChamp (Get-SzhSuiviMaj) 'derniereVerif') }",
  "$null = Save-SzhSuiviMaj ([ordered]@{ derniereVerif = '2026-08-25T14:30:00'; bloqueDepuis = ''; bloqueFois = 0 })",
  '$r.suiviRelu = [ordered]@{',
  "  derniereVerif = (Get-SzhSuiviChamp (Get-SzhSuiviMaj) 'derniereVerif')",
  "  absent = (Get-SzhSuiviChamp (Get-SzhSuiviMaj) 'champInexistant')",
  "  bom = [bool]([System.IO.File]::ReadAllBytes($script:SzhMajSuiviFile)[0] -eq 0xEF) }",

  // 7. La tâche, réellement réconciliée. On reproduit la forme d'un poste ancien (ouverture
  //    de session + quotidien 11 h), puis on rejoue la réconciliation.
  // Nom propre à ce processus : deux exécutions concurrentes du harnais ne doivent pas
  // désenregistrer la tâche l'une de l'autre.
  "$nomEssai = 'rythme-' + $PID",
  '$moi = [Security.Principal.WindowsIdentity]::GetCurrent().Name',
  '$pr = New-ScheduledTaskPrincipal -UserId $moi -LogonType Interactive -RunLevel Limited',
  '$vieux = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew',
  "$act = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\\wscript.exe') -Argument ('//B \"{0}\" \"{1}\"' -f (Join-Path $travail 'windows\\hidden.vbs'), (Join-Path $travail 'windows\\update-launcher.ps1'))",
  "New-Item -ItemType Directory -Force -Path (Join-Path $travail 'windows') | Out-Null",
  "Register-ScheduledTask -TaskPath '\\SZH-Essai\\' -TaskName $nomEssai -Action $act -Principal $pr -Settings $vieux -Trigger @((New-ScheduledTaskTrigger -AtLogOn -User $moi), (New-ScheduledTaskTrigger -Daily -At '11:00')) -Force | Out-Null",
  "$avant = Get-ScheduledTask -TaskPath '\\SZH-Essai\\' -TaskName $nomEssai",
  '$r.avant = [ordered]@{ ecarts = @(Get-SzhTacheMajEcarts -Tache $avant -Toolkit $travail)',
  '  declencheurs = @($avant.Triggers | ForEach-Object { [string]$_.CimClass.CimClassName }) }',
  "$p1 = Set-SzhTacheMaj -Toolkit $travail -Nom $nomEssai -Chemin '\\SZH-Essai\\' -Principal $pr -Utilisateur $moi",
  "$apres = Get-ScheduledTask -TaskPath '\\SZH-Essai\\' -TaskName $nomEssai",
  '$r.passe1 = [ordered]@{ etat = [string]$p1.etat',
  '  declencheurs = @($apres.Triggers | ForEach-Object { [ordered]@{ classe = [string]$_.CimClass.CimClassName',
  '    depart = [string]$_.StartBoundary; jours = [string]$_.DaysOfWeek; semaines = [string]$_.WeeksInterval } })',
  '  batterieInterdite = [bool]$apres.Settings.DisallowStartIfOnBatteries',
  '  reprise = [bool]$apres.Settings.StartWhenAvailable',
  '  reveil = [bool]$apres.Settings.WakeToRun',
  '  limite = [string]$apres.Settings.ExecutionTimeLimit',
  "  suivante = ((Get-ScheduledTaskInfo -TaskPath '\\SZH-Essai\\' -TaskName $nomEssai).NextRunTime).ToString('s') }",
  // Deuxième passe : une tâche conforme n'est pas réécrite.
  "$avant2 = (Get-ScheduledTask -TaskPath '\\SZH-Essai\\' -TaskName $nomEssai | Export-ScheduledTask)",
  "$p2 = Set-SzhTacheMaj -Toolkit $travail -Nom $nomEssai -Chemin '\\SZH-Essai\\' -Principal $pr -Utilisateur $moi",
  "$apres2 = (Get-ScheduledTask -TaskPath '\\SZH-Essai\\' -TaskName $nomEssai | Export-ScheduledTask)",
  '$r.passe2 = [ordered]@{ etat = [string]$p2.etat; ecarts = @($p2.ecarts); identique = ($avant2 -eq $apres2) }',
  // Un chemin d'action périmé se voit aussi : le toolkit a bougé.
  "$r.actionPerimee = @(Get-SzhTacheMajEcarts -Tache $apres -Toolkit 'C:\\ailleurs')",
  // La vraie tâche du poste, lue seulement : ce qu'une passe non élevée en dit.
  '$vraie = $null',
  "try { $vraie = Get-ScheduledTask -TaskName 'SZH - Mise a jour' -ErrorAction Stop } catch { $vraie = $null }",
  '$r.vraie = [ordered]@{ existe = [bool]$vraie',
  '  ecarts = @(Get-SzhTacheMajEcarts -Tache $vraie) }',
  "Unregister-ScheduledTask -TaskPath '\\SZH-Essai\\' -TaskName $nomEssai -Confirm:$false",
  'Set-SzhJson $sortie $r'
].join('\r\n') + '\r\n';

const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-rythme-'));
  const pilote = path.join(travail, 'rythme.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(pilote, PILOTE, 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    travail, sortie], { encoding: 'utf8', windowsHide: true, timeout: 180000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('le jalon hebdomadaire est le dernier mardi 14 h révolu', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a échoué : ' + bilan.stderr);
  const par = {};
  for (const j of bilan.r.jalons) { par[j.quand] = j; }
  // Mardi 13 h 59 : la fenêtre de la semaine n'est pas encore ouverte, on retombe sur le
  // mardi précédent. Ainsi le déclencheur quotidien de 11 h d'un poste ancien ne consomme pas
  // la fenêtre avant l'heure.
  assert.strictEqual(par['2026-08-25T13:59:00'].jour, 'Tuesday');
  assert.strictEqual(par['2026-08-25T13:59:00'].jalon, '2026-08-18T14:00:00');
  assert.strictEqual(par['2026-08-25T14:00:00'].jalon, '2026-08-25T14:00:00');
  assert.strictEqual(par['2026-08-25T14:00:01'].jalon, '2026-08-25T14:00:00');
  // Lundi matin : le jalon est le mardi d'avant, six jours plus tôt.
  assert.strictEqual(par['2026-08-24T09:00:00'].jour, 'Monday');
  assert.strictEqual(par['2026-08-24T09:00:00'].jalon, '2026-08-18T14:00:00');
  // Mercredi matin : le jalon est la veille. Un poste au déclencheur quotidien rattrape la
  // semaine ici, ou à l'ouverture de session, d'ordinaire plus tôt.
  assert.strictEqual(par['2026-08-26T09:00:00'].jalon, '2026-08-25T14:00:00');
  assert.strictEqual(par['2026-08-29T00:00:00'].jalon, '2026-08-25T14:00:00');
  assert.strictEqual(par['2026-08-30T12:00:00'].jalon, '2026-08-25T14:00:00');
  assert.strictEqual(par['2026-08-31T23:59:00'].jalon, '2026-08-25T14:00:00');
});

test('la fenêtre s’ouvre une fois par semaine, et le doute la rouvre', { skip: sansPowerShell }, () => {
  const f = bilan.r.fenetres;
  const trouve = (m, d) => f.find((x) => x.maintenant === m && x.derniere === d);
  // Poste neuf, aucun suivi : on vérifie.
  assert.strictEqual(trouve('2026-08-25T15:00:00', '').ouverte, true);
  // Déjà vérifié cette semaine : rien à faire, et rien à dire.
  assert.strictEqual(trouve('2026-08-25T15:00:00', '2026-08-25T14:30:00').ouverte, false);
  assert.strictEqual(trouve('2026-08-31T09:00:00', '2026-08-25T14:30:00').ouverte, false);
  // Vérifié lundi, donc avant le jalon de mardi : la nouvelle semaine rouvre.
  assert.strictEqual(trouve('2026-08-25T15:00:00', '2026-08-24T09:00:00').ouverte, true);
  // Mardi 13 h, jalon encore à la semaine d'avant : la vérification de lundi suffit.
  assert.strictEqual(trouve('2026-08-25T13:00:00', '2026-08-24T09:00:00').ouverte, false);
  // Date illisible, ou dans l'avenir après une remise à l'heure : mieux vaut une vérification
  // de trop qu'un poste qui ne se met plus à jour.
  assert.strictEqual(trouve('2026-08-25T15:00:00', 'pas une date').ouverte, true);
  assert.strictEqual(trouve('2026-08-25T15:00:00', '2027-01-01T00:00:00').ouverte, true);
});

test('la politesse expire au bout de quatre semaines, l’alerte se répète au plus une fois par semaine', { skip: sansPowerShell }, () => {
  const p = bilan.r.politesse;
  const t = (d) => p.find((x) => x.depuis === d).expiree;
  assert.strictEqual(t(''), false, 'rien ne bloque : rien n’expire');
  assert.strictEqual(t('2026-08-01T15:00:00'), false, '24 jours : encore poli');
  assert.strictEqual(t('2026-07-28T15:00:00'), true, '28 jours pile : expiré');
  assert.strictEqual(t('2026-07-28T15:00:01'), false, 'une seconde de moins : encore poli');
  assert.strictEqual(t('illisible'), false, 'une date illisible n’autorise pas à passer outre');
  assert.strictEqual(t('2026-12-01T00:00:00'), false, 'une date à venir non plus');
  const a = bilan.r.alertes;
  const d = (x) => a.find((y) => y.alerteLe === x).due;
  assert.strictEqual(d(''), true, 'jamais alerté : la première alerte est due');
  assert.strictEqual(d('2026-08-24T15:00:00'), false, 'alerté hier : on se tait');
  assert.strictEqual(d('2026-08-18T15:00:00'), true, 'alerté il y a une semaine : à nouveau');
  assert.strictEqual(d('illisible'), true);
});

test('le moment : les trente-deux combinaisons', { skip: sansPowerShell }, () => {
  // Le modèle : rien à remplacer, on y va ; une compilation en cours, jamais ; le délai expiré
  // fait céder les gênes réversibles, pas la compilation ; sinon l'éditeur ouvert fait
  // renoncer. Une distribution en marche seule ne fait pas renoncer : le préchauffage WSL la
  // démarre à chaque ouverture de session, sur le même déclencheur que la mise à jour, et
  // update.ps1 sait l'arrêter avant de la désenregistrer.
  const attendu = (m) => {
    if (!m.remplace) { return { propice: true, grave: false }; }
    if (m.compilation) { return { propice: false, grave: true }; }
    if (m.presse) { return { propice: true, grave: false }; }
    if (m.editeur) { return { propice: false, grave: false }; }
    return { propice: true, grave: false };
  };
  assert.strictEqual(bilan.r.moments.length, 32);
  for (const m of bilan.r.moments) {
    const a = attendu(m);
    const ou = JSON.stringify(m);
    assert.strictEqual(m.propice, a.propice, 'propice : ' + ou);
    assert.strictEqual(m.grave, a.grave, 'grave : ' + ou);
    // Tout renoncement donne sa raison, pour le journal.
    if (!m.propice) { assert.ok(m.raison.length > 8, 'renoncement sans raison : ' + ou); }
  }
  // La seule gêne que le délai de politesse ne fait pas céder est la compilation : la couper
  // détruit du travail, alors qu'un éditeur ouvert ne coûte qu'un message.
  const graves = bilan.r.moments.filter((m) => m.grave);
  assert.strictEqual(graves.length, 8);
  for (const g of graves) { assert.ok(g.remplace && g.compilation); }
  assert.match(graves[0].raison, /compilation/);
  // Une passe pressée qui passe outre le dit dans le journal.
  const presse = bilan.r.moments.filter((m) => m.remplace && m.presse && !m.compilation);
  for (const p of presse) {
    assert.strictEqual(p.propice, true);
    assert.match(p.raison, /politesse/);
  }
});

test('les sondes réelles ne lèvent pas et ne réveillent rien', { skip: sansPowerShell }, () => {
  // Sans remplacement d'environnement, aucune mesure n'est faite et la réponse est oui :
  // un toolkit et des extensions s'installent sous l'éditeur ouvert.
  assert.strictEqual(bilan.r.sondes.sansRemplacement, true);
  assert.strictEqual(typeof bilan.r.sondes.editeur, 'boolean');
  assert.strictEqual(typeof bilan.r.sondes.distro, 'boolean');
});

test('le suivi se relit, et son JSON est lisible par Node', { skip: sansPowerShell }, () => {
  // Fichier absent : aucune exception, et un champ vide plutôt qu'un null qui lèverait plus
  // loin.
  assert.strictEqual(bilan.r.suiviVide.lu, false);
  assert.strictEqual(bilan.r.suiviVide.champ, '');
  assert.strictEqual(bilan.r.suiviRelu.derniereVerif, '2026-08-25T14:30:00');
  assert.strictEqual(bilan.r.suiviRelu.absent, '');
  // Sans BOM, comme config.json : Set-Content -Encoding UTF8 en poserait un.
  assert.strictEqual(bilan.r.suiviRelu.bom, false);
});

test('un poste au rythme quotidien passe à l’hebdomadaire, et une tâche juste n’est pas recréée', { skip: sansPowerShell }, () => {
  const a = bilan.r.avant;
  // La forme reproduite est bien celle d'un poste ancien.
  assert.deepStrictEqual(a.declencheurs, ['MSFT_TaskLogonTrigger', 'MSFT_TaskDailyTrigger']);
  // Les écarts sont nommés un par un, pour le journal.
  assert.ok(a.ecarts.indexOf('déclencheur quotidien à retirer') !== -1);
  assert.ok(a.ecarts.some((e) => e.indexOf('déclencheur hebdomadaire absent') === 0));
  assert.ok(a.ecarts.indexOf('démarrage refusé sur batterie') !== -1);

  const p = bilan.r.passe1;
  assert.strictEqual(p.etat, 'corrigee');
  assert.deepStrictEqual(p.declencheurs.map((d) => d.classe),
    ['MSFT_TaskLogonTrigger', 'MSFT_TaskWeeklyTrigger']);
  const hebdo = p.declencheurs[1];
  assert.strictEqual(hebdo.jours, '4', 'mardi, dans le masque de bits du planificateur');
  assert.strictEqual(hebdo.semaines, '1');
  assert.match(hebdo.depart, /T14:00:00/);
  assert.strictEqual(p.batterieInterdite, false);
  assert.strictEqual(p.reprise, true);
  assert.strictEqual(p.reveil, false);
  assert.strictEqual(p.limite, 'PT2H');
  // Résolue par le planificateur lui-même : la prochaine exécution tombe un mardi à 14 h.
  const suivante = new Date(p.suivante);
  assert.strictEqual(suivante.getDay(), 2, 'la prochaine exécution n’est pas un mardi : ' + p.suivante);
  assert.strictEqual(suivante.getHours(), 14);

  // Deuxième passe : conforme, aucun écart, et la définition est identique à l'octet.
  assert.strictEqual(bilan.r.passe2.etat, 'conforme');
  assert.deepStrictEqual(bilan.r.passe2.ecarts, []);
  assert.strictEqual(bilan.r.passe2.identique, true,
    'une tâche déjà juste a été réécrite : son historique repartirait de zéro');

  // Un toolkit qui a déménagé se voit aussi : une tâche pointant dans le vide n'échouerait
  // jamais bruyamment.
  assert.ok(bilan.r.actionPerimee.indexOf('action : arguments périmés') !== -1);
});

test('la vraie tâche du poste est lue, et ce qui manque est nommé', { skip: sansPowerShell }, () => {
  // Lecture seule : une passe non élevée ne peut pas réécrire une tâche de la racine du
  // planificateur, et ce contrôle n'essaie pas. Il garantit que la comparaison sait décrire
  // la tâche réelle sans lever.
  const v = bilan.r.vraie;
  if (!v.existe) { return; }   // poste sans toolkit installé : rien à comparer
  assert.ok(Array.isArray(v.ecarts));
  for (const e of v.ecarts) { assert.ok(e.length > 5, 'écart sans libellé : ' + e); }
});
