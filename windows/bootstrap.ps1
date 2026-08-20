<#
.SYNOPSIS
  Préparation d'un poste, à lancer une fois en administrateur :
    powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1

  Ne fait que ce qui exige l'administrateur : dossiers C:\ProgramData\SZH ouverts en
  écriture aux Utilisateurs, moteur WSL sans distribution, VSCodium et SumatraPDF par
  winget, toolkit initial, tâches planifiées de mise à jour et de préchauffage WSL, puis
  une première mise à jour visible. Ensuite le poste n'a plus besoin d'administrateur,
  sauf pour monter VSCodium ou SumatraPDF de version, geste volontairement manuel.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [string]$Repo = 'SZH-CSPS/szh-publishing-toolchain'   # dépôt GitHub public (Releases)
)

. "$PSScriptRoot\szh-common.ps1"

function Info([string]$m) { Write-Host ('[bootstrap] ' + $m) -ForegroundColor Cyan }
function Attention([string]$m) { Write-Host ('[bootstrap] ' + $m) -ForegroundColor Yellow }

# ---- Administrateur requis ----
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
            ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $estAdmin) { throw 'Lancer ce script en tant qu''administrateur.' }
Write-SzhBanniere 'Installation du poste (administrateur)'

# ---- Dossiers et droits ----
Info 'Dossiers C:\ProgramData\SZH + droits Utilisateurs (mises à jour sans admin)'
New-Item -ItemType Directory -Force -Path $SzhBase, $SzhStaging, $SzhLogs, $SzhToolkit | Out-Null
# S-1-5-32-545 = groupe Utilisateurs (indépendant de la langue de Windows)
& icacls $SzhBase /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null

if (-not (Test-Path $SzhConfigFile)) {
  $cfg = [ordered]@{
    repo        = $Repo
    # Le lanceur ne liste que l'arborescence officielle (basesRevues ci-dessous). Cette
    # clé ne sert plus qu'à signaler des revues restées ailleurs : vide sur un poste
    # neuf, à remplir à la main pour surveiller un dossier historique.
    revuesRoots = @()
    # Mode développeur : les revues sont cherchées, créées et archivées sous
    # basesRevues.dev. Bascule depuis « Réglages SZH » du cockpit, ou ici.
    devMode     = $true
    # Emplacements « en cours » et archives. Seule la base change entre test et
    # production, les sous-dossiers étant figés dans szh-common.ps1. À corriger ici si
    # la bibliothèque SharePoint est synchronisée sous un autre nom.
    basesRevues = [ordered]@{
      prod = '%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte'
      dev  = '%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING'
    }
  }
  Set-SzhJson $SzhConfigFile $cfg
}

# ---- Moteur WSL ----
Info 'Vérification du moteur WSL'
$wsl = Get-WslExe
Invoke-SzhNatif { $null = & $wsl --status 2>&1 }
if ($LASTEXITCODE -ne 0) {
  Attention 'WSL absent -> installation du moteur (sans distribution). REDÉMARRAGE requis ensuite.'
  & $wsl --install --no-distribution
  Attention 'Redémarrer le poste puis RELANCER bootstrap.ps1.'
  return
}

# ---- Applications (winget, niveau machine) ----
Info 'Vérification de VSCodium'
if (-not (Get-VSCodiumExe)) {
  Info 'Installation de VSCodium (winget)'
  winget install --id VSCodium.VSCodium -e --accept-source-agreements --accept-package-agreements
}
if (-not (Get-VSCodiumExe)) { throw 'VSCodium introuvable après installation.' }

Info 'Vérification de SumatraPDF (lecteur PDF : ne verrouille pas le fichier, recharge auto)'
$sumatra = $false
foreach ($p in "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe", "$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe") {
  if (Test-Path $p) { $sumatra = $true }
}
if (-not $sumatra) {
  Info 'Installation de SumatraPDF (winget)'
  winget install --id SumatraPDF.SumatraPDF -e --accept-source-agreements --accept-package-agreements
}

# ---- Toolkit initial ----
Info 'Toolkit initial'
$toolkitOk = $false
try {
  $manifest = Get-SzhManifest
  $zip = Join-Path $SzhStaging $manifest.toolkit.file
  Get-SzhFichier -Url $manifest.toolkit.url -Destination $zip -Silencieux
  if (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256) {
    Expand-Archive -Path $zip -DestinationPath $SzhToolkit -Force
    $toolkitOk = $true
    Info ('Toolkit {0} téléchargé depuis la Release.' -f $manifest.version)
  }
} catch {
  Attention ('Release inaccessible ({0}).' -f $_.Exception.Message)
}
if (-not $toolkitOk) {
  # Repli hors ligne : le script tourne depuis un clone du dépôt, on copie sur place.
  $racineDepot = Split-Path $PSScriptRoot -Parent
  if (Test-Path (Join-Path $racineDepot 'pipeline\Makefile')) {
    Attention 'Repli : copie du toolkit depuis le dépôt cloné (version locale).'
    foreach ($d in 'pipeline', 'vscodium-user', 'revue-template', 'windows') {
      Copy-Item (Join-Path $racineDepot $d) $SzhToolkit -Recurse -Force
    }
    Set-Content -Path (Join-Path $SzhToolkit 'VERSION') -Value '0.0.0-local' -Encoding ASCII
    $toolkitOk = $true
  }
}
if (-not $toolkitOk) { throw 'Impossible d''obtenir le toolkit (ni Release, ni dépôt local).' }

# ---- Tâches planifiées ----
Info 'Tâches planifiées (pour tout utilisateur connecté, sans admin)'
$vbs = Join-Path $SzhToolkit 'windows\hidden.vbs'
# Groupe Utilisateurs : la tâche tourne dans la session de l'utilisateur connecté.
$principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew

$actionMaj = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" `
  -Argument ('//B "{0}" "{1}"' -f $vbs, (Join-Path $SzhToolkit 'windows\update-launcher.ps1'))
$declencheurs = @(
  (New-ScheduledTaskTrigger -AtLogOn),
  (New-ScheduledTaskTrigger -Daily -At '11:00')
)
Register-ScheduledTask -TaskName 'SZH - Mise a jour' -Action $actionMaj `
  -Principal $principal -Trigger $declencheurs -Settings $reglages -Force | Out-Null

$actionChauffe = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" `
  -Argument ('//B "{0}" "{1}" "-d" "{2}" "--exec" "/bin/true"' -f $vbs, "$env:WINDIR\System32\wsl.exe", $SzhDistro)
Register-ScheduledTask -TaskName 'SZH - Prechauffage WSL' -Action $actionChauffe `
  -Principal $principal -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Settings $reglages -Force | Out-Null

# ---- Première mise à jour, en fenêtre visible ----
Info 'Lancement de la première mise à jour (fenêtre visible)…'
Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', (Join-Path $SzhToolkit 'windows\update.ps1')
)

Write-Host ''
Info 'Terminé.'
Attention ('Antivirus : exclure {0}\WSL\*.vhdx et {1}\*, + processus vmcompute.exe, vmmem.exe, wsl.exe, wslservice.exe.' -f $SzhBase, $SzhStaging)
Attention 'Chaque utilisateur du poste recevra réglages + raccourcis à sa prochaine connexion (tâche planifiée).'
Attention 'Nouvelle revue : menu Démarrer > Revues SZH (ou Zeitschriften SZH) > « Nouvelle revue ».'
