<#
.SYNOPSIS
  Préparation d'un poste — à lancer UNE seule fois, EN ADMINISTRATEUR :
    powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1

  Fait uniquement ce qui exige l'admin (D3) :
    1. dossiers C:\ProgramData\SZH + droits d'écriture pour les Utilisateurs
       (=> toutes les mises à jour suivantes tournent SANS admin, en silence) ;
    2. moteur WSL (sans distribution) ;
    3. VSCodium + SumatraPDF (winget, machine) ;
    4. toolkit initial (Release GitHub ; repli : copie du dépôt cloné) ;
    5. tâches planifiées « SZH - Mise a jour » (connexion + 11h00, silencieuse)
       et « SZH - Prechauffage WSL » (connexion) — pour TOUT utilisateur du poste ;
    6. première mise à jour visible (update.ps1).

  Ensuite : plus jamais besoin d'un admin sur ce poste (sauf bump VSCodium/SumatraPDF,
  volontairement manuel — voir V2 dans PLANIFICATION.md).

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [string]$Repo = 'SZH-CSPS/szh-publishing-toolchain'   # dépôt GitHub public (Releases)
)

. "$PSScriptRoot\szh-common.ps1"

function Info([string]$m) { Write-Host ('[bootstrap] ' + $m) -ForegroundColor Cyan }
function Attention([string]$m) { Write-Host ('[bootstrap] ' + $m) -ForegroundColor Yellow }

# ---- 0. Admin requis ---------------------------------------------------------
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
            ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $estAdmin) { throw 'Lancer ce script en tant qu''administrateur.' }
Write-SzhBanniere 'Installation du poste (administrateur)'

# ---- 1. Dossiers + droits ------------------------------------------------------
Info 'Dossiers C:\ProgramData\SZH + droits Utilisateurs (mises à jour sans admin)'
New-Item -ItemType Directory -Force -Path $SzhBase, $SzhStaging, $SzhLogs, $SzhToolkit | Out-Null
# S-1-5-32-545 = groupe Utilisateurs (indépendant de la langue de Windows)
& icacls $SzhBase /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null

if (-not (Test-Path $SzhConfigFile)) {
  $cfg = [ordered]@{
    repo        = $Repo
    revuesRoots = @('%OneDrive%\Revues')    # étendu à l'exécution (chaque utilisateur a son OneDrive)
  }
  $cfg | ConvertTo-Json | Set-Content -Path $SzhConfigFile -Encoding UTF8
}

# ---- 2. Moteur WSL --------------------------------------------------------------
Info 'Vérification du moteur WSL'
$wsl = Get-WslExe
Invoke-SzhNatif { $null = & $wsl --status 2>&1 }
if ($LASTEXITCODE -ne 0) {
  Attention 'WSL absent -> installation du moteur (sans distribution). REDÉMARRAGE requis ensuite.'
  & $wsl --install --no-distribution
  Attention 'Redémarrer le poste puis RELANCER bootstrap.ps1.'
  return
}

# ---- 3. Applications (winget, machine) ------------------------------------------
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

# ---- 4. Toolkit initial -----------------------------------------------------------
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
  # Repli : le script tourne depuis un clone du dépôt -> copie locale (pré-release / hors ligne)
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

# ---- 5. Tâches planifiées ----------------------------------------------------------
Info 'Tâches planifiées (pour tout utilisateur connecté, sans admin)'
$vbs = Join-Path $SzhToolkit 'windows\hidden.vbs'
# Groupe Utilisateurs : la tâche tourne dans la session de l'utilisateur connecté
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

# ---- 6. Première mise à jour (visible) -----------------------------------------------
Info 'Lancement de la première mise à jour (fenêtre visible)…'
Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass',
  '-File', (Join-Path $SzhToolkit 'windows\update.ps1')
)

Write-Host ''
Info 'Terminé.'
Attention ('Antivirus : exclure {0}\WSL\*.vhdx et {1}\*, + processus vmcompute.exe, vmmem.exe, wsl.exe, wslservice.exe.' -f $SzhBase, $SzhStaging)
Attention 'Chaque utilisateur du poste recevra réglages + raccourcis à sa prochaine connexion (tâche planifiée).'
Attention ('Nouvelle revue : powershell -ExecutionPolicy Bypass -File "{0}" -Dossier "<OneDrive>\Revues\2026-01"' -f (Join-Path $SzhToolkit 'windows\new-revue.ps1'))
