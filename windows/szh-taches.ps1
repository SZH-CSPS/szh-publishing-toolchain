<#
.SYNOPSIS
  Le rythme de la mise à jour : la tâche planifiée qui la déclenche, la cadence de la passe
  silencieuse et le choix du moment.

  Dot-sourcé par bootstrap.ps1 (qui crée la tâche), update.ps1 (qui la corrige) et
  update-launcher.ps1 (la passe silencieuse, qui décide quand agir).

  Compatibilité : Windows PowerShell 5.1.
#>

# La tâche vise le mardi 14 h, une fois par semaine.
$script:SzhTacheMaj    = 'SZH - Mise a jour'
$script:SzhMajJour     = 'Tuesday'
$script:SzhMajJourNum  = 2            # [int][DayOfWeek]::Tuesday
$script:SzhMajHeure    = 14

# Suivi de la passe silencieuse. Fichier à part : update.ps1 réécrit state.json en entier à
# chaque succès. Il est par compte, car le travail qu'il cadence l'est (distribution WSL,
# extensions, réglages, raccourcis) : un fichier commun laisserait le premier compte
# connecté prendre la fenêtre de la semaine pour tous.
$script:SzhMajSuiviFile = Join-Path $SzhBaseUtilisateur 'maj-auto.json'

# Jours de renoncement après lesquels la mise à jour passe outre l'éditeur ouvert et
# alerte. Quatre semaines, bien en deçà du rythme d'un numéro (environ 13 semaines).
$script:SzhMajPolitesse = 28

# Noms des outils de la chaîne dans /proc/<pid>/comm, à l'intérieur de la distribution.
$script:SzhMajOutils = @('make', 'pandoc', 'weasyprint', 'verapdf', 'python3')

# ---- La tâche planifiée : ce qu'elle doit porter ----

function Get-SzhTacheMajVoulue {
  param([string]$Toolkit = $SzhToolkit)
  $vbs = Join-Path $Toolkit 'windows\hidden.vbs'
  $ps1 = Join-Path $Toolkit 'windows\update-launcher.ps1'
  return [ordered]@{
    execute   = (Join-Path $env:WINDIR 'System32\wscript.exe')
    arguments = ('//B "{0}" "{1}"' -f $vbs, $ps1)
  }
}

# Deux déclencheurs.
#
# Hebdomadaire, mardi 14 h : le rythme voulu.
#
# À l'ouverture de session : il rattrape un poste éteint ou endormi le mardi, et c'est le
# moment où l'éditeur n'est pas encore ouvert, donc où remplacer l'environnement de
# fabrication ne coupe aucun travail. La cadence hebdomadaire est tenue par
# Test-SzhFenetreMaj, pas par les déclencheurs.
#
# $Utilisateur vide : ouverture de session de n'importe quel compte. Le nommer restreint le
# déclencheur à un compte, pour les tests : un déclencheur « tout utilisateur » exige
# l'élévation.
function New-SzhTacheMajDeclencheurs {
  param([string]$Utilisateur = '')
  $logon = $null
  if ($Utilisateur) {
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $Utilisateur
  } else {
    $logon = New-ScheduledTaskTrigger -AtLogOn
  }
  return @(
    $logon,
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $SzhMajJour -WeeksInterval 1 `
       -At ('{0:00}:00' -f $SzhMajHeure))
  )
}

# StartWhenAvailable : une fenêtre manquée (poste éteint, endormi) est rattrapée à la
# première occasion.
#
# AllowStartIfOnBatteries : sans lui, un portable jamais branché ne se mettrait jamais à
# jour. La passe silencieuse ne lit que le manifeste ; le gros téléchargement passe par la
# fenêtre visible, que le rédacteur peut fermer.
#
# Pas de WakeToRun : voir docs/MAINTENANCE.md, « Les quatre états du poste ».
function New-SzhTacheMajReglages {
  return New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew
}

# Les écarts entre la tâche du poste et la tâche voulue, en français, pour le journal.
# Liste vide : tâche conforme, qui n'est pas réécrite (on garderait sinon son historique à
# zéro).
function Get-SzhTacheMajEcarts {
  param($Tache, [string]$Toolkit = $SzhToolkit)
  $ecarts = New-Object System.Collections.ArrayList
  if (-not $Tache) {
    [void]$ecarts.Add('tâche absente')
    return $ecarts
  }

  # ---- Déclencheurs ----
  # DaysOfWeek est un masque de bits ; on le demande à l'API plutôt que de l'écrire en dur.
  $bitVoulu = 0
  try {
    $bitVoulu = [int](New-ScheduledTaskTrigger -Weekly -DaysOfWeek $SzhMajJour -At '00:00').DaysOfWeek
  } catch { $bitVoulu = 0 }
  $logon = 0
  $hebdo = 0
  foreach ($d in @($Tache.Triggers)) {
    $classe = ''
    try { $classe = [string]$d.CimClass.CimClassName } catch { $classe = '' }
    if ($classe -eq 'MSFT_TaskLogonTrigger') { $logon++; continue }
    if ($classe -eq 'MSFT_TaskWeeklyTrigger') {
      # L'heure se lit en [datetimeoffset], décalage compris : [datetime] la ramènerait au
      # fuseau du jour, et la tâche paraîtrait décalée d'une heure la moitié de l'année.
      $heure = -1
      $minute = -1
      try {
        $quand = [datetimeoffset]::Parse([string]$d.StartBoundary, [Globalization.CultureInfo]::InvariantCulture)
        $heure = $quand.Hour
        $minute = $quand.Minute
      } catch { $heure = -1 }
      $semaines = 1
      try { if ($null -ne $d.WeeksInterval) { $semaines = [int]$d.WeeksInterval } } catch { $semaines = 1 }
      $jours = 0
      try { $jours = [int]$d.DaysOfWeek } catch { $jours = 0 }
      if (($heure -eq $SzhMajHeure) -and ($minute -eq 0) -and ($semaines -eq 1) -and ($jours -eq $bitVoulu)) {
        $hebdo++
      } else {
        [void]$ecarts.Add(('déclencheur hebdomadaire mal réglé (jour {0}, {1}h{2:00}, toutes les {3} semaines)' -f $jours, $heure, [Math]::Max($minute, 0), $semaines))
      }
      continue
    }
    if ($classe -eq 'MSFT_TaskDailyTrigger') {
      [void]$ecarts.Add('déclencheur quotidien à retirer')
      continue
    }
    [void]$ecarts.Add(('déclencheur superflu ({0})' -f $classe))
  }
  if ($logon -lt 1) { [void]$ecarts.Add('déclencheur à l''ouverture de session absent') }
  if ($hebdo -lt 1) { [void]$ecarts.Add(('déclencheur hebdomadaire absent (mardi {0}h00)' -f $SzhMajHeure)) }
  if ($logon -gt 1) { [void]$ecarts.Add('déclencheur à l''ouverture de session en double') }
  if ($hebdo -gt 1) { [void]$ecarts.Add('déclencheur hebdomadaire en double') }

  # ---- Réglages ----
  $r = $Tache.Settings
  if ($r) {
    if (-not $r.StartWhenAvailable) { [void]$ecarts.Add('reprise après fenêtre manquée désactivée') }
    if ($r.DisallowStartIfOnBatteries) { [void]$ecarts.Add('démarrage refusé sur batterie') }
    if ($r.StopIfGoingOnBatteries) { [void]$ecarts.Add('arrêt au passage sur batterie') }
    if ($r.WakeToRun) { [void]$ecarts.Add('réveil du poste activé') }
    if ([string]$r.MultipleInstances -ne 'IgnoreNew') { [void]$ecarts.Add('deux passes pourraient se chevaucher') }
    if ([string]$r.ExecutionTimeLimit -ne 'PT2H') { [void]$ecarts.Add(('limite de durée {0} au lieu de PT2H' -f $r.ExecutionTimeLimit)) }
  }

  # ---- Action ----
  # Un chemin d'action périmé rendrait la tâche inopérante sans erreur visible.
  $voulu = Get-SzhTacheMajVoulue -Toolkit $Toolkit
  $actions = @($Tache.Actions)
  if ($actions.Count -ne 1) {
    [void]$ecarts.Add(('{0} action(s) au lieu d''une' -f $actions.Count))
  } else {
    if ([string]$actions[0].Execute -ne $voulu.execute) {
      [void]$ecarts.Add(('action : {0} au lieu de {1}' -f $actions[0].Execute, $voulu.execute))
    }
    if ([string]$actions[0].Arguments -ne $voulu.arguments) {
      [void]$ecarts.Add('action : arguments périmés')
    }
  }
  return $ecarts
}

# Met la tâche en conformité sans lever, et rend un bilan que l'appelant journalise.
#
#   etat = 'conforme'  rien à faire, rien écrit
#          'creee'     la tâche n'existait pas
#          'corrigee'  elle différait, elle a été réécrite
#          'refusee'   elle différait, le poste a refusé l'écriture (voir message)
#          'illisible' le planificateur n'a pas répondu, et rien n'a été écrit
#
# Le refus est attendu : la tâche appartient à l'administrateur qui a installé le poste, et
# une mise à jour sans élévation ne peut pas la réécrire. La cadence reste tenue par
# Test-SzhFenetreMaj.
function Set-SzhTacheMaj {
  param(
    [string]$Toolkit = $SzhToolkit,
    [string]$Nom     = '',
    [string]$Chemin  = '\',
    $Principal       = $null,
    [string]$Utilisateur = ''
  )
  if (-not $Nom) { $Nom = $SzhTacheMaj }
  if (-not $Principal) {
    # Groupe Utilisateurs : la tâche tourne dans la session de l'utilisateur connecté.
    $Principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
  }
  $bilan = [ordered]@{ etat = 'conforme'; ecarts = @(); message = '' }

  # Distinguer « absente » de « illisible » : le planificateur ne répond pas toujours sous
  # charge, et recréer une tâche existante effacerait son historique. On lit donc le
  # dossier entier : si la lecture réussit, l'absence de la tâche est réelle.
  $tache = $null
  try {
    $dossier = @(Get-ScheduledTask -TaskPath $Chemin -ErrorAction Stop)
    foreach ($t in $dossier) {
      if (([string]$t.TaskName -eq $Nom) -and ([string]$t.TaskPath -eq $Chemin)) { $tache = $t }
    }
  } catch {
    # Un dossier sans aucune tâche lève CmdletizationQuery_NotFound : c'est une absence
    # réelle (poste neuf). Toute autre erreur : on ne sait pas, on n'écrit rien.
    if (([string]$_.FullyQualifiedErrorId) -notlike 'CmdletizationQuery_NotFound*') {
      $bilan.etat = 'illisible'
      $bilan.message = (([string]$_.Exception.Message) -replace '\s+', ' ').Trim()
      return $bilan
    }
    $tache = $null
  }
  $bilan.ecarts = @(Get-SzhTacheMajEcarts -Tache $tache -Toolkit $Toolkit)
  if ($bilan.ecarts.Count -eq 0) { return $bilan }

  $voulu = Get-SzhTacheMajVoulue -Toolkit $Toolkit
  try {
    $action = New-ScheduledTaskAction -Execute $voulu.execute -Argument $voulu.arguments
    if ($null -eq $tache) {
      Register-ScheduledTask -TaskPath $Chemin -TaskName $Nom -Action $action -Principal $Principal `
        -Trigger (New-SzhTacheMajDeclencheurs -Utilisateur $Utilisateur) `
        -Settings (New-SzhTacheMajReglages) -Force -ErrorAction Stop | Out-Null
      $bilan.etat = 'creee'
    } else {
      Set-ScheduledTask -TaskPath $Chemin -TaskName $Nom -Action $action -Principal $Principal `
        -Trigger (New-SzhTacheMajDeclencheurs -Utilisateur $Utilisateur) `
        -Settings (New-SzhTacheMajReglages) -ErrorAction Stop | Out-Null
      $bilan.etat = 'corrigee'
    }
  } catch {
    $bilan.etat = 'refusee'
    # Message mis sur une ligne : le planificateur y ajoute des sauts de ligne.
    $bilan.message = (([string]$_.Exception.Message) -replace '\s+', ' ').Trim()
  }
  return $bilan
}

# ---- Cadence de la passe silencieuse ----
#
# Les déclencheurs ouvrent des occasions (chaque ouverture de session, ou un ancien
# déclencheur quotidien qu'un administrateur n'a pas encore corrigé). Le rythme, une fois
# par semaine à partir du mardi 14 h, est décidé ici.

# Le dernier mardi 14 h passé.
function Get-SzhJalonHebdo {
  param([datetime]$Maintenant = (Get-Date))
  $recul = ([int]$Maintenant.DayOfWeek - $SzhMajJourNum + 7) % 7
  $jalon = $Maintenant.Date.AddDays(-$recul).AddHours($SzhMajHeure)
  if ($jalon -gt $Maintenant) { $jalon = $jalon.AddDays(-7) }
  return $jalon
}

# Vrai si aucune vérification n'a eu lieu depuis le dernier mardi 14 h. Une date absente,
# illisible ou future (horloge corrigée) rend vrai : mieux vaut une vérification de trop.
function Test-SzhFenetreMaj {
  param([datetime]$Maintenant = (Get-Date), [string]$DerniereVerif = '')
  if (-not $DerniereVerif) { return $true }
  try {
    $quand = [datetime]::Parse($DerniereVerif, [Globalization.CultureInfo]::InvariantCulture)
  } catch { return $true }
  if ($quand -gt $Maintenant) { return $true }
  return ($quand -lt (Get-SzhJalonHebdo $Maintenant))
}

# Vrai si la mise à jour n'aboutit plus depuis $Jours jours (par défaut $SzhMajPolitesse),
# quelle qu'en soit la cause : renoncement ou contrôle en échec.
function Test-SzhPolitesseExpiree {
  param([datetime]$Maintenant = (Get-Date), [string]$Depuis = '', [int]$Jours = 0)
  if ($Jours -le 0) { $Jours = $SzhMajPolitesse }
  if (-not $Depuis) { return $false }
  try {
    $quand = [datetime]::Parse($Depuis, [Globalization.CultureInfo]::InvariantCulture)
  } catch { return $false }
  if ($quand -gt $Maintenant) { return $false }
  return ((($Maintenant - $quand).TotalDays) -ge $Jours)
}

# Une alerte visible par semaine au plus, et non à chaque ouverture de session.
function Test-SzhAlerteDue {
  param([datetime]$Maintenant = (Get-Date), [string]$AlerteLe = '', [int]$Jours = 7)
  if (-not $AlerteLe) { return $true }
  try {
    $quand = [datetime]::Parse($AlerteLe, [Globalization.CultureInfo]::InvariantCulture)
  } catch { return $true }
  if ($quand -gt $Maintenant) { return $true }
  return ((($Maintenant - $quand).TotalDays) -ge $Jours)
}

function Get-SzhSuiviMaj {
  try {
    if (Test-Path $SzhMajSuiviFile) {
      return (Get-Content $SzhMajSuiviFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
  } catch { }
  return $null
}

function Get-SzhSuiviChamp($Suivi, [string]$Nom) {
  if (-not $Suivi) { return '' }
  try { if ($null -ne $Suivi.$Nom) { return [string]$Suivi.$Nom } } catch { }
  return ''
}

# Rend $false sans lever si le fichier de suivi ne peut pas s'écrire.
function Save-SzhSuiviMaj($Suivi) {
  try {
    New-Item -ItemType Directory -Force -Path $SzhBaseUtilisateur | Out-Null
    Set-SzhJson $SzhMajSuiviFile $Suivi
    return $true
  } catch { return $false }
}

# ---- Le bon moment ----
#
# Remplacer l'environnement de fabrication oblige à désenregistrer la distribution, ce qui
# est impossible pendant une compilation (message 'err.wsl'). Une compilation en cours ou
# l'éditeur ouvert font donc renoncer.
#
# Une distribution en marche ne suffit pas à renoncer : le préchauffage WSL la démarre à
# chaque ouverture de session, et update.ps1 l'arrête (`--terminate`) avant de la
# désenregistrer.
#
# Resolve-SzhMomentMaj décide sans rien mesurer (les tests couvrent toutes les
# combinaisons) ; Test-SzhMomentMaj mesure.
function Resolve-SzhMomentMaj {
  param(
    [bool]$RemplaceEnvironnement,
    [bool]$Presse,
    [bool]$Compilation,
    [bool]$Editeur,
    [bool]$DistroEnMarche
  )
  $bilan = [ordered]@{ propice = $true; raison = ''; grave = $false }
  # Sans environnement à remplacer, tout s'installe même éditeur ouvert.
  if (-not $RemplaceEnvironnement) { return $bilan }

  # Une compilation en cours fait toujours renoncer, même après le délai de politesse : la
  # couper détruirait du travail.
  if ($Compilation) {
    $bilan.propice = $false
    $bilan.grave = $true
    $bilan.raison = 'une compilation est en cours'
    return $bilan
  }
  if ($Presse) {
    $bilan.raison = 'délai de politesse expiré, on passe outre'
    return $bilan
  }
  if ($Editeur) {
    $bilan.propice = $false
    $bilan.raison = 'l''éditeur est ouvert'
    return $bilan
  }
  # $DistroEnMarche seul ne fait pas renoncer (voir plus haut).
  return $bilan
}

function Test-SzhEditeurOuvert {
  try { return ([bool](Get-Process -Name 'VSCodium' -ErrorAction SilentlyContinue)) } catch { return $false }
}

# `wsl -l --running -q` rend seulement des noms de distributions. `-l -v` traduirait
# « Running » selon la langue de WSL.
function Test-SzhDistroEnMarche {
  try {
    $wsl = Get-WslExe
    $brut = Invoke-SzhNatif { & $wsl -l --running -q 2>$null }
    foreach ($l in @($brut)) {
      if ((([string]$l) -replace "`0", '').Trim() -eq $SzhDistro) { return $true }
    }
  } catch { }
  return $false
}

# Deux mesures complémentaires.
#
# Côté Windows : une compilation est un `wsl.exe … make -f …/Makefile` lancé par VSCodium.
# L'éditeur garde aussi des `wsl.exe` permanents (`sleep infinity`) : c'est la ligne de
# commande qui distingue.
#
# Côté Linux : /proc, car l'image n'a pas procps (ni `ps` ni `pgrep`). Cette mesure voit
# aussi un pandoc lancé à la main. Elle n'est faite que si la distribution tourne déjà, pour
# ne pas la démarrer.
function Test-SzhCompilationEnVol {
  param([bool]$DistroEnMarche = $true)
  try {
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction Stop)) {
      $ligne = [string]$p.CommandLine
      if (-not $ligne) { continue }
      if (($ligne -like '*Makefile*') -or ($ligne -like '*make -f*')) { return $true }
    }
  } catch { }
  if (-not $DistroEnMarche) { return $false }
  try {
    $wsl = Get-WslExe
    $brut = Invoke-SzhNatif { & $wsl -d $SzhDistro --exec /bin/sh -c 'cat /proc/[0-9]*/comm 2>/dev/null' }
    foreach ($l in @($brut)) {
      $nom = (([string]$l) -replace "`0", '').Trim()
      if ($nom -and ($SzhMajOutils -contains $nom)) { return $true }
    }
  } catch { }
  return $false
}

function Test-SzhMomentMaj {
  param([switch]$RemplaceEnvironnement, [switch]$Presse)
  $remplace = $RemplaceEnvironnement.IsPresent
  $enMarche = $false
  $compil = $false
  $editeur = $false
  # Aucune mesure s'il n'y a rien à remplacer : sonder la distribution la réveillerait.
  # $enMarche décide si la sonde Linux de compilation est tentée.
  if ($remplace) {
    $enMarche = Test-SzhDistroEnMarche
    $compil = Test-SzhCompilationEnVol -DistroEnMarche $enMarche
    $editeur = Test-SzhEditeurOuvert
  }
  return (Resolve-SzhMomentMaj -RemplaceEnvironnement $remplace -Presse $Presse.IsPresent `
    -Compilation $compil -Editeur $editeur -DistroEnMarche $enMarche)
}
