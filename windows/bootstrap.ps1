<#
.SYNOPSIS
  Préparation d'un poste, à lancer une fois en administrateur :
    powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1

  Ne fait que ce qui exige l'administrateur : dossiers C:\ProgramData\SZH ouverts en
  écriture aux Utilisateurs, moteur WSL sans distribution, VSCodium et SumatraPDF par
  winget (source cassée : réparation, puis VSCodium pris sur sa Release GitHub),
  toolkit initial, tâches planifiées de mise à jour et de préchauffage WSL, puis
  une première mise à jour visible. Ensuite le poste n'a plus besoin d'administrateur,
  sauf pour monter VSCodium ou SumatraPDF de version, geste volontairement manuel.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [string]$Repo = 'SZH-CSPS/szh-publishing-toolchain'   # dépôt GitHub public (Releases)
)

. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"

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
# winget est le chemin normal, mais il tombe en panne sur un poste neuf plus souvent qu'on ne
# le croit : index de source jamais synchronisé (« 0x8a15000f : données manquantes »), source
# msstore qui réclame une région à deux lettres, proxy qui coupe cdn.winget.microsoft.com.
# Aucune de ces pannes ne mérite d'arrêter l'installation d'un poste : on répare la source,
# puis on retombe sur le téléchargement direct de l'installeur.

# Une seule réparation par exécution, sinon chaque paquet la refait pour rien.
$script:sourceReparee = $false
function Repair-SzhWingetSource {
  if ($script:sourceReparee) { return }
  $script:sourceReparee = $true
  Attention 'Source winget en panne -> reset puis resynchronisation de l''index.'
  Invoke-SzhNatif {
    & winget source reset --force 2>&1 | Out-Null
    & winget source update --name winget 2>&1 | Out-Null
  }
}

# --source winget : msstore n'héberge aucun de nos paquets, et c'est elle qui exige un accord
# et une région. L'écarter supprime la moitié des messages d'erreur à l'écran.
function Install-SzhAppWinget([string]$Id) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Attention 'winget absent de ce poste (App Installer non provisionné).'
    return $false
  }
  foreach ($essai in 1, 2) {
    # Out-Host : la sortie d'un natif appelé dans une fonction part sinon dans la valeur de
    # retour, et winget s'installerait sans qu'une ligne s'affiche.
    Invoke-SzhNatif {
      & winget install --id $Id -e --source winget --disable-interactivity `
          --accept-source-agreements --accept-package-agreements | Out-Host
    }
    if ($LASTEXITCODE -eq 0) { return $true }
    Attention ('winget install {0} : code de sortie {1}.' -f $Id, $LASTEXITCODE)
    if ($essai -eq 1) { Repair-SzhWingetSource }
  }
  return $false
}

# Repli sans winget : l'installeur publié par VSCodium sur GitHub. « Setup » et non
# « UserSetup » : il pose l'éditeur dans Program Files, donc pour tous les comptes du poste,
# là où la variante utilisateur ne servirait qu'au compte administrateur qui installe.
function Install-SzhVSCodiumDirect {
  $entetes = @{ 'User-Agent' = 'SZH-Publishing'; 'Accept' = 'application/vnd.github+json' }
  $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/VSCodium/vscodium/releases/latest' `
               -Headers $entetes -UseBasicParsing -TimeoutSec 30
  $asset = $release.assets | Where-Object { $_.name -match '^VSCodiumSetup-x64-.+\.exe$' } | Select-Object -First 1
  if (-not $asset) { throw 'Aucun installeur VSCodiumSetup-x64 dans la dernière Release VSCodium.' }
  $exe = Join-Path $SzhStaging $asset.name
  Info ('Téléchargement de ' + $asset.name)
  Get-SzhFichier -Url $asset.browser_download_url -Destination $exe
  # Inno Setup : silencieux, sans redémarrage, sans ouvrir l'éditeur à la fin.
  $p = Start-Process -FilePath $exe -Wait -PassThru `
         -ArgumentList '/VERYSILENT', '/NORESTART', '/MERGETASKS=!runcode'
  if ($p.ExitCode -ne 0) { throw ('Installeur VSCodium sorti en code {0}.' -f $p.ExitCode) }
}

function Test-SzhSumatra {
  foreach ($p in "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe", "$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe") {
    if (Test-Path $p) { return $true }
  }
  return $false
}

Info 'Vérification de VSCodium'
if (-not (Get-VSCodiumExe)) {
  Info 'Installation de VSCodium (winget)'
  if (-not (Install-SzhAppWinget 'VSCodium.VSCodium')) {
    Attention 'winget hors service -> installeur pris directement sur la Release VSCodium.'
    Install-SzhVSCodiumDirect
  }
}
$codium = Get-VSCodiumExe
if (-not $codium) {
  throw ('VSCodium introuvable après installation. Poser l''éditeur à la main depuis ' +
         'https://github.com/VSCodium/vscodium/releases (VSCodiumSetup-x64), puis relancer ce script.')
}
# Un éditeur posé dans le profil de l'administrateur n'existe pour aucun rédacteur : le poste
# passerait l'installation pour se bloquer à la première ouverture de session.
if ($codium -like ($env:LOCALAPPDATA + '*')) {
  Attention ('VSCodium n''est installé que pour ce compte (' + $codium + ') : le désinstaller ' +
             'puis reprendre avec l''installeur système, sinon les rédacteurs n''auront pas d''éditeur.')
}

Info 'Vérification de SumatraPDF (lecteur PDF : ne verrouille pas le fichier, recharge auto)'
if (-not (Test-SzhSumatra)) {
  Info 'Installation de SumatraPDF (winget)'
  $null = Install-SzhAppWinget 'SumatraPDF.SumatraPDF'
}
# Pas bloquant : la chaîne compile sans lecteur PDF. Mais il faut le dire ici, sinon le
# rédacteur découvrira tout seul qu'un PDF ouvert dans Acrobat bloque la compilation suivante.
if (-not (Test-SzhSumatra)) {
  Attention 'SumatraPDF non installé -> à poser à la main (https://www.sumatrapdfreader.org).'
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

# ---- Raccourcis du menu Démarrer ----
# Posés ici, sans attendre la première mise à jour : si la Release est injoignable, celle-ci
# s'arrête à la lecture du manifest et le poste resterait sans aucune entrée de menu alors
# que le toolkit, lui, est en place par le repli hors ligne. Ils atterrissent dans le profil
# du compte qui lance ce script, donc celui de l'administrateur ; chaque rédacteur reçoit
# les siens à sa première ouverture de session, par la tâche planifiée ci-dessous. Jamais
# bloquant : un menu Démarrer tenu par une stratégie de groupe n'empêche pas d'installer
# un poste, mais il faut le lire à l'écran.
Info 'Raccourcis du menu Démarrer (profil du compte qui installe)'
try {
  $bilanMenu = Set-SzhRaccourcisMenu
  if ($bilanMenu.poses.Count -gt 0) { Info ('Posés : ' + ($bilanMenu.poses -join ', ')) }
  foreach ($retire in $bilanMenu.retires) { Info ('Ancien raccourci retiré : ' + $retire) }
  foreach ($manque in $bilanMenu.manques) { Attention ('Raccourci non posé -> ' + $manque) }
} catch {
  Attention ('Raccourcis du menu Démarrer non posés : ' + $_.Exception.Message)
}

# ---- Tâches planifiées ----
Info 'Tâches planifiées (pour tout utilisateur connecté, sans admin)'
$vbs = Join-Path $SzhToolkit 'windows\hidden.vbs'
# Groupe Utilisateurs : la tâche tourne dans la session de l'utilisateur connecté.
$principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew

# Mise à jour : déclencheurs, réglages et action viennent de szh-taches.ps1, que la passe de
# mise à jour relit ensuite à chaque passage. Une seule vérité, sinon un poste installé
# aujourd'hui et un poste mis à jour demain porteraient deux rythmes différents.
$bilanTache = Set-SzhTacheMaj
if ($bilanTache.etat -eq 'refusee') {
  Attention ('Tâche « SZH - Mise a jour » non écrite : ' + $bilanTache.message)
} else {
  Info ('Tâche « SZH - Mise a jour » : ' + $bilanTache.etat + ' (ouverture de session + mardi 14 h)')
}

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
Attention 'Mise à jour à la demande : menu Démarrer > « Mise à jour de l''outil Revue » (ou « Aktualisierung des Redaktionstools »).'
