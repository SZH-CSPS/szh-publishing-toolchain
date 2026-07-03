<#
.SYNOPSIS
  [LEGACY — sera remplacé en P3 par bootstrap.ps1 / update.ps1 / new-revue.ps1, voir PLANIFICATION.md]
  Déploiement idempotent de l'environnement de rédaction SZH/CSPS (Option A) sur un poste Windows.
  À lancer en administrateur :  powershell -ExecutionPolicy Bypass -File .\deploy.ps1

  Compatibilité : DOIT tourner sous Windows PowerShell 5.1 (défaut Windows ; PS7 non garanti).
                  Proscrire la syntaxe PS7 : opérateurs ?. (null-conditionnel), ??, ?:, && / ||.

  Idempotent  : ne refait que ce qui manque (compare la version du rootfs).
  Reproductible : rootfs (Release GitHub, vérifié sha256) + VSIX + config épinglés.
  Paramétrable : tout est en tête de script.
#>

[CmdletBinding()]
param(
  [string]$NewRevue,                  # scaffolde une revue depuis le template dans ce dossier OneDrive
  [string]$GhToken = $env:GH_TOKEN    # requis SEULEMENT si le dépôt GitHub est privé (PAT lecture)
)

#region ---- PARAMÈTRES (adapter) -----------------------------------------------
$Repo            = 'SZH-CSPS/szh-publishing-toolchain'           # dépôt GitHub ; Releases = rootfs
$DistroName      = 'SZH-Publishing'
$TargetVersion   = '2026.06.1'                                   # = tag GitHub sans le « v » = DISTRO_VERSION
$InstallDir      = 'C:\ProgramData\SZH\WSL\SZH-Publishing'
$RootfsName      = "szh-publishing-rootfs-$TargetVersion.tar.gz"   # releases >= 2026.07 : .tar.gz (D6)
$RootfsUrl       = "https://github.com/$Repo/releases/download/v$TargetVersion/$RootfsName"
$RootfsShaUrl    = "$RootfsUrl.sha256"
$VsixDir         = "$PSScriptRoot\vsix"
$VSCodiumWinget  = 'VSCodium.VSCodium'
$SumatraWinget   = 'SumatraPDF.SumatraPDF'                       # lecteur PDF : ne verrouille pas le fichier, recharge auto
$UserCfgSrc      = "$PSScriptRoot\..\vscodium-user"
$TemplateDir     = "$PSScriptRoot\..\revue-template"
$Staging         = "$env:ProgramData\SZH\staging"
#endregion

$ErrorActionPreference = 'Stop'
function Info($m){ Write-Host "[deploy] $m" -ForegroundColor Cyan }
function Warn($m){ Write-Host "[deploy] $m" -ForegroundColor Yellow }

# 0. Admin requis
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
  throw "Lancer ce script en tant qu'administrateur."
}
New-Item -ItemType Directory -Force -Path $Staging | Out-Null
$headers = @{}
if ($GhToken) { $headers['Authorization'] = "Bearer $GhToken" }   # dépôt privé

# Résolution robuste de wsl.exe (peut manquer du PATH ; cas 32 bits -> sysnative)
$Wsl = (Get-Command wsl.exe -ErrorAction SilentlyContinue).Source
if (-not $Wsl) { foreach ($p in "$env:WINDIR\System32\wsl.exe","$env:WINDIR\sysnative\wsl.exe") { if (Test-Path $p) { $Wsl = $p; break } } }
if (-not $Wsl) { throw "wsl.exe introuvable." }

# 1. Moteur WSL présent ?
Info "Vérification du moteur WSL"
$null = & $Wsl --status 2>&1
if ($LASTEXITCODE -ne 0) {
  Warn "WSL absent -> installation du moteur (sans distribution). REDÉMARRAGE requis ensuite."
  & $Wsl --install --no-distribution
  Warn "Redémarrer le poste puis relancer deploy.ps1."
  return
}

# 2. Distro à jour ? (idempotent : compare le marqueur de version)
function Get-DistroVersion {
  param($name)
  $installed = (& $Wsl -l -q) -replace "`0","" | ForEach-Object { $_.Trim() }
  if ($installed -notcontains $name) { return $null }
  try { return (& $Wsl -d $name -- cat /etc/szh-publishing-version 2>$null).Trim() } catch { return '' }
}
$current = Get-DistroVersion $DistroName
if ($current -ne $TargetVersion) {
  Info "Distro absente/obsolète ($current -> $TargetVersion). Import du rootfs."
  $tar = Join-Path $Staging $RootfsName
  Info "Téléchargement du rootfs depuis la Release GitHub"
  Invoke-WebRequest -Uri $RootfsUrl    -Headers $headers -OutFile $tar
  $shaFile = "$tar.sha256"
  Invoke-WebRequest -Uri $RootfsShaUrl -Headers $headers -OutFile $shaFile
  $expected = ((Get-Content $shaFile -Raw) -split '\s+')[0].ToUpper()   # "<hash>  <nom>"
  $actual   = (Get-FileHash $tar -Algorithm SHA256).Hash.ToUpper()
  if ($actual -ne $expected) { throw "Empreinte rootfs invalide (attendu $expected, obtenu $actual)." }
  Info "Empreinte vérifiée."

  $installed = (& $Wsl -l -q) -replace "`0","" | ForEach-Object { $_.Trim() }
  if ($installed -contains $DistroName) {
    Info "Suppression de l'ancienne distro (JETABLE : aucune donnée utilisateur dedans)"
    & $Wsl --terminate $DistroName 2>$null
    & $Wsl --unregister $DistroName
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  & $Wsl --import $DistroName $InstallDir $tar --version 2
  & $Wsl --terminate $DistroName 2>$null     # relit /etc/wsl.conf (user par défaut)
} else { Info "Distro déjà à jour ($current)." }

# 3. VSCodium présent + épinglé ?
Info "Vérification de VSCodium"
$codium = (Get-Command codium -ErrorAction SilentlyContinue).Source
if (-not $codium) {
  Info "Installation de VSCodium (winget)"
  winget install --id $VSCodiumWinget -e --accept-source-agreements --accept-package-agreements
  $codium = (Get-Command codium -ErrorAction SilentlyContinue).Source
  if (-not $codium) { foreach ($p in "$env:ProgramFiles\VSCodium\bin\codium.cmd","$env:LOCALAPPDATA\Programs\VSCodium\bin\codium.cmd") { if (Test-Path $p) { $codium=$p; break } } }
}
if (-not $codium) { throw "codium introuvable après installation." }

# 4. Seed de la config utilisateur (profil par défaut, pas de profil nommé)
Info "Déploiement de la config VSCodium (settings + keybindings)"
$userDir = "$env:APPDATA\VSCodium\User"
New-Item -ItemType Directory -Force -Path $userDir | Out-Null
Copy-Item "$UserCfgSrc\settings.json"    "$userDir\settings.json"    -Force
Copy-Item "$UserCfgSrc\keybindings.json" "$userDir\keybindings.json" -Force

# 5. Extensions épinglées depuis VSIX vendorisés (PAS Open VSX live -> anti-GlassWorm)
Info "Installation des extensions (VSIX épinglés)"
Get-ChildItem "$VsixDir\*.vsix" -ErrorAction SilentlyContinue | ForEach-Object {
  & $codium --install-extension $_.FullName --force
}

# 5b. Lecteur PDF (SumatraPDF : open source, ne verrouille pas le PDF -> recompilation possible + recharge auto)
Info "Vérification de SumatraPDF"
$sumatra = (Get-Command SumatraPDF -ErrorAction SilentlyContinue).Source
if (-not $sumatra) {
  Info "Installation de SumatraPDF (winget)"
  winget install --id $SumatraWinget -e --accept-source-agreements --accept-package-agreements
}

# 6. (Option) Scaffolder une nouvelle revue depuis le template
if ($NewRevue) {
  Info "Création d'une revue dans : $NewRevue"
  New-Item -ItemType Directory -Force -Path $NewRevue | Out-Null
  Copy-Item "$TemplateDir\*" $NewRevue -Recurse -Force
  $ws = Join-Path $NewRevue 'revue.code-workspace'

  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Revue SZH.lnk'
  $sh  = New-Object -ComObject WScript.Shell
  $s   = $sh.CreateShortcut($lnk)
  $s.TargetPath   = $codium
  $s.Arguments    = "`"$ws`""
  $s.IconLocation = $codium
  $s.Save()
  Info "Raccourci créé : $lnk"
  Warn "ACTION : dans OneDrive, clic droit sur le dossier de la revue -> « Toujours conserver sur cet appareil »."
}

Write-Host ""
Info "Terminé."
Warn "Antivirus : exclure $InstallDir\*.vhdx et $Staging\*, + processus vmcompute.exe, vmmem.exe, wsl.exe, wslservice.exe."
Warn "Dépôt privé ? Relancer avec -GhToken <PAT lecture> (ou via \$env:GH_TOKEN)."
