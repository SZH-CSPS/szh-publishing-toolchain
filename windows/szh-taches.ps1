<#
.SYNOPSIS
  Le rythme de la mise à jour : la tâche planifiée qui la déclenche, la cadence de la passe
  silencieuse, et le choix du moment.

  Dot-sourcé par bootstrap.ps1 (qui crée la tâche), update.ps1 (qui la remet d'aplomb) et
  update-launcher.ps1 (la passe silencieuse, qui s'en sert pour décider quand agir).
  Une seule vérité : trois copies de la forme voulue divergeraient sans qu'on le voie.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>

# La tâche vise le mardi 14 h, une fois par semaine.
$script:SzhTacheMaj    = 'SZH - Mise a jour'
$script:SzhMajJour     = 'Tuesday'
$script:SzhMajJourNum  = 2            # [int][DayOfWeek]::Tuesday
$script:SzhMajHeure    = 14

# Suivi de la passe silencieuse. Fichier à part, et non state.json : celui-ci est réécrit
# entièrement par update.ps1 à chaque succès, ce qui effacerait la cadence. Sous
# C:\ProgramData\SZH, donc partagé par les comptes du poste — c'est voulu, le toolkit
# l'est aussi.
$script:SzhMajSuiviFile = Join-Path $SzhBase 'maj-auto.json'

# Au bout de combien de jours de renoncements une mise à jour cesse d'être polie. Quatre
# semaines : quatre fenêtres hebdomadaires et une vingtaine d'ouvertures de session ont
# échoué, ce n'est plus un mauvais moment, c'est un blocage. Et l'on reste sous le rythme
# d'un numéro (≈ 13 semaines), donc le rédacteur l'apprend avant de boucler.
$script:SzhMajPolitesse = 28

# Les outils de la chaîne, tels qu'ils se lisent dans /proc à l'intérieur de la distro.
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

# Deux déclencheurs, et les deux comptent.
#
# Hebdomadaire mardi 14 h : le rythme demandé.
#
# À l'ouverture de session : c'est lui qui fait tenir tout le reste, et le retirer rendrait
# la question « et si le poste est éteint ? » beaucoup plus grave. Il rattrape le poste
# éteint ou endormi le mardi après-midi, il donne au rédacteur qui rentre de vacances une
# mise à jour immédiate plutôt qu'une attente jusqu'au mardi suivant, et surtout c'est le
# seul instant de la journée où l'éditeur n'est pas encore ouvert : le seul, donc, où
# remplacer l'environnement de fabrication ne coupe pas un travail en cours. La cadence
# hebdomadaire, elle, ne vient pas des déclencheurs mais de Test-SzhFenetreMaj ci-dessous.
#
# $Utilisateur vide = à l'ouverture de session de n'importe qui, ce que veut un poste
# partagé. Le nommer restreint le déclencheur à un compte : cela ne sert qu'à éprouver la
# fonction hors de la racine du planificateur, un déclencheur « tout utilisateur » exigeant
# l'élévation. Même intention que le paramètre $Menu de Set-SzhRaccourcisMenu.
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

# StartWhenAvailable : le rattrapage des fenêtres manquées. Poste éteint, endormi ou
# service occupé le mardi à 14 h, la tâche part à la première occasion ensuite, une dizaine
# de minutes après le retour.
#
# AllowStartIfOnBatteries : sans lui, la tâche ne démarre PAS sur batterie — ni le mardi, ni
# à l'ouverture de session. Un portable jamais branché ne se mettait donc jamais à jour, et
# passer du quotidien à l'hebdomadaire aggravait le cas de sept chances par semaine à une.
# La passe silencieuse ne coûte qu'une lecture de manifest ; les 574 Mo de l'environnement
# passent par la fenêtre visible, que le rédacteur voit et peut fermer.
#
# Pas de WakeToRun : voir docs/MAINTENANCE.md, § « Les quatre états du poste ».
function New-SzhTacheMajReglages {
  return New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew
}

# Ce qui sépare la tâche du poste de la tâche voulue, dit en français, pour le journal.
# Liste vide = tâche conforme, et rien ne sera réécrit : une tâche juste ne doit pas être
# recréée, sinon chaque passe lui remettrait son historique à zéro.
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
      # L'heure se lit dans la chaîne telle qu'elle est écrite, décalage compris :
      # [datetime] la ramènerait au fuseau du jour, et la tâche paraîtrait décalée d'une
      # heure la moitié de l'année, donc réécrite deux fois par an pour rien.
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
  # Un chemin d'action périmé rendrait la tâche muette sans jamais échouer bruyamment.
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

# Met la tâche en conformité, jamais bloquant, et rend un bilan que l'appelant journalise —
# même patron que Set-SzhRaccourcisMenu.
#
#   etat = 'conforme'  rien à faire, rien écrit
#          'creee'     la tâche n'existait pas
#          'corrigee'  elle différait, elle a été réécrite
#          'refusee'   elle différait, le poste a refusé l'écriture (voir message)
#          'illisible' le planificateur n'a pas répondu, et rien n'a été écrit
#
# Refus attendu : la tâche vit dans la racine du planificateur et appartient à
# l'administrateur qui a installé le poste ; une passe de mise à jour, qui ne demande
# jamais l'élévation, ne peut pas la réécrire. Ce n'est pas une raison d'échouer — la
# cadence, elle, est tenue par le script (Test-SzhFenetreMaj), donc le rythme demandé
# s'applique quand même. Le journal nomme le geste qui manque.
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

  # « Absente » et « illisible » sont deux choses très différentes, et les confondre fait
  # recréer une tâche qui existe — donc lui remettre son historique à zéro, ou se faire
  # refuser une écriture dont personne n'avait besoin. Le planificateur est un service
  # comme un autre : sous charge, il ne répond pas toujours. D'où la lecture du dossier
  # entier : si elle réussit, l'absence de la tâche est une vraie absence.
  $tache = $null
  try {
    $dossier = @(Get-ScheduledTask -TaskPath $Chemin -ErrorAction Stop)
    foreach ($t in $dossier) {
      if (([string]$t.TaskName -eq $Nom) -and ([string]$t.TaskPath -eq $Chemin)) { $tache = $t }
    }
  } catch {
    # Un dossier sans aucune tâche lève au lieu de rendre une liste vide : c'est une vraie
    # absence, et bootstrap doit pouvoir créer la tâche sur un poste neuf. Toute autre
    # erreur veut dire qu'on ne sait pas, et on n'écrit rien quand on ne sait pas.
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
    # Le planificateur rend ses messages avec un saut de ligne final, qui couperait la ligne
    # de journal en deux : une ligne, un événement.
    $bilan.message = (([string]$_.Exception.Message) -replace '\s+', ' ').Trim()
  }
  return $bilan
}

# ---- Cadence de la passe silencieuse ----
#
# Les déclencheurs n'imposent pas le rythme, ils ouvrent des occasions : celui de
# l'ouverture de session revient chaque matin, et un poste installé avant ce changement
# garde son déclencheur quotidien de 11 h jusqu'à ce qu'un administrateur le corrige. Le
# rythme demandé — une fois par semaine, à partir du mardi 14 h — vit donc ici, dans un
# script que chaque poste reçoit à la mise à jour suivante, sans intervention.

# Le dernier mardi 14 h révolu. Avant : la fenêtre de la semaine n'est pas encore ouverte.
function Get-SzhJalonHebdo {
  param([datetime]$Maintenant = (Get-Date))
  $recul = ([int]$Maintenant.DayOfWeek - $SzhMajJourNum + 7) % 7
  $jalon = $Maintenant.Date.AddDays(-$recul).AddHours($SzhMajHeure)
  if ($jalon -gt $Maintenant) { $jalon = $jalon.AddDays(-7) }
  return $jalon
}

# La fenêtre de la semaine est-elle encore ouverte ? Toute date illisible, absente ou dans
# l'avenir (horloge remise à l'heure) rouvre la fenêtre : mieux vaut une vérification de
# trop qu'un poste qui ne se met plus jamais à jour.
function Test-SzhFenetreMaj {
  param([datetime]$Maintenant = (Get-Date), [string]$DerniereVerif = '')
  if (-not $DerniereVerif) { return $true }
  try {
    $quand = [datetime]::Parse($DerniereVerif, [Globalization.CultureInfo]::InvariantCulture)
  } catch { return $true }
  if ($quand -gt $Maintenant) { return $true }
  return ($quand -lt (Get-SzhJalonHebdo $Maintenant))
}

# Le blocage dure-t-il depuis trop longtemps ? Une seule horloge pour les deux causes —
# renoncement devant un mauvais moment, ou contrôle qui échoue : ce qui compte est le temps
# passé sans que la mise à jour aboutisse, pas la raison.
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

# Une alerte visible par semaine au plus. Sans ce frein, un poste durablement bloqué
# ouvrirait une fenêtre à chaque ouverture de session, et la passe muette deviendrait la
# passe la plus bavarde de la chaîne.
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

# Jamais bloquante : la passe silencieuse n'a pas à échouer parce qu'un fichier de suivi
# n'a pas pu s'écrire.
function Save-SzhSuiviMaj($Suivi) {
  try {
    New-Item -ItemType Directory -Force -Path $SzhBase | Out-Null
    Set-SzhJson $SzhMajSuiviFile $Suivi
    return $true
  } catch { return $false }
}

# ---- Le bon moment ----
#
# Une mise à jour qui remplace l'environnement de fabrication doit le désenregistrer, et
# elle ne peut pas le faire pendant qu'une compilation s'en sert : c'est exactement ce que
# dit le message 'err.wsl'. Passer à un déclencheur de 14 h met cette collision en plein
# après-midi de travail, d'où ce garde-fou.
#
# La décision est séparée de la mesure : ce qui suit est pur, donc éprouvable sur les
# trente-deux combinaisons, et Test-SzhMomentMaj plus bas se contente de mesurer.
function Resolve-SzhMomentMaj {
  param(
    [bool]$RemplaceEnvironnement,
    [bool]$Presse,
    [bool]$Compilation,
    [bool]$Editeur,
    [bool]$DistroEnMarche
  )
  $bilan = [ordered]@{ propice = $true; raison = ''; grave = $false }
  # Rien à remplacer, rien à craindre : un toolkit, des extensions et des réglages
  # s'installent sous l'éditeur ouvert. Renoncer ici retarderait les corrections pour rien.
  if (-not $RemplaceEnvironnement) { return $bilan }

  # Une compilation en vol : jamais, à aucun prix. La couper détruit du travail, et c'est
  # la seule gêne que le délai de politesse ne fait pas céder.
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
  if ($DistroEnMarche) {
    $bilan.propice = $false
    $bilan.raison = 'l''environnement de fabrication est en marche'
    return $bilan
  }
  return $bilan
}

function Test-SzhEditeurOuvert {
  try { return ([bool](Get-Process -Name 'VSCodium' -ErrorAction SilentlyContinue)) } catch { return $false }
}

# `wsl -l --running -q` ne rend que des noms de distributions, sans en-tête ni colonne
# d'état : `-l -v` traduit « Running » selon la langue de WSL, et la comparaison casserait
# sur un poste allemand.
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

# Deux mesures, parce qu'aucune ne suffit seule.
#
# Côté Windows : la compilation part de VSCodium par `wsl.exe … make -f …/Makefile`, et ce
# client vit tant que le build dure. Mais l'éditeur laisse aussi tourner en permanence des
# clients `sleep infinity`, qui ne sont pas des compilations : c'est la ligne de commande
# qui distingue, pas la présence du processus.
#
# Côté Linux : l'image n'embarque pas procps, donc pas de `ps` ni de `pgrep` ; /proc suffit.
# Cette mesure attrape aussi un pandoc lancé à la main, que la première ne voit pas. Elle
# n'est tentée que si la distro tourne déjà, pour ne pas la démarrer en la sondant.
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
  # Aucune mesure quand il n'y a rien à remplacer : la décision est déjà prise, et sonder
  # la distro la réveillerait pour rien.
  if ($remplace) {
    $enMarche = Test-SzhDistroEnMarche
    $compil = Test-SzhCompilationEnVol -DistroEnMarche $enMarche
    $editeur = Test-SzhEditeurOuvert
  }
  return (Resolve-SzhMomentMaj -RemplaceEnvironnement $remplace -Presse $Presse.IsPresent `
    -Compilation $compil -Editeur $editeur -DistroEnMarche $enMarche)
}
