<#
.SYNOPSIS
  Lance une instance de developpement de Pronto, qui lit le depot en place par jonctions et
  ne copie jamais rien. Elle ne touche jamais a l'installation de production sous
  C:\ProgramData\SZH ni aux reglages VSCodium du compte, c'est le seul invariant qui ne se
  negocie pas.

    powershell -ExecutionPolicy Bypass -File outils-dev\pronto-dev.ps1
    powershell -ExecutionPolicy Bypass -File outils-dev\pronto-dev.ps1 -Simuler -BaseDev <dossier>

  Compatibilite, Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [string]$BaseDev = 'C:\ProgramData\SZH-dev',
  [switch]$Simuler,
  # Vide ou absent, c'est le vrai menu Demarrer (comportement inchange). Renseigne, c'est ce
  # dossier-la qui recoit le .lnk - meme forme que $Menu de Set-SzhRaccourcisMenu.
  [string]$Menu = '',
  # Transmis tel quel a windows\open-revue.ps1 - un lien "szh://...", -Produit, -Versions.
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)

$ErrorActionPreference = 'Stop'

# Choix provisoire, pas encore tranche par Robin - une seule ligne a changer si la decision
# change. Designe quelle entree de basesRevues fournit le dossier des revues de developpement.
$CLE_BASESREVUES_DEV = 'dev'

# Nom du fichier .lnk pose au menu Demarrer par ce script - une seule ligne a changer si le
# nom change. Jamais pose par update.ps1 ni bootstrap.ps1 : voir Set-SzhRaccourciDev plus bas.
$NOM_RACCOURCI_DEV = 'Pronto (dev)'

# ---- racine du depot, et garde d'entree ----
$racineDepot = Split-Path $PSScriptRoot -Parent
$makefileDepot = Join-Path $racineDepot 'pipeline\Makefile'
if (-not (Test-Path -LiteralPath $makefileDepot)) {
  [Console]::Error.WriteLine('pronto-dev - pas dans le depot, ' + $makefileDepot +
    ' est introuvable. A lancer depuis outils-dev\ du depot szh-publishing-toolchain.')
  exit 1
}

# ---- conversion vers la forme WSL d'un chemin Windows ----
# Identique, au caractere pres, a versWsl() de
# vscodium-extension\szh-cockpit\lib\chemins-poste.js - lettre de lecteur minusculisee,
# antislash convertis.
function ConvertTo-SzhCheminWsl([string]$CheminWindows) {
  $resolu = ([System.IO.Path]::GetFullPath($CheminWindows) -replace '\\', '/')
  if ($resolu -match '^([A-Za-z]):/(.*)$') {
    return '/mnt/' + $Matches[1].ToLower() + '/' + $Matches[2]
  }
  return $resolu
}

# ---- raccourci "Pronto (dev)" au menu Demarrer, pose a chaque lancement reel ----
# Jamais en mode -Simuler. Idempotent - si le .lnk existe deja et vise deja le bon script,
# rien n'est reecrit. Ne leve jamais : un menu Demarrer verrouille par une strategie de
# groupe ne doit pas faire echouer un lancement par ailleurs reussi, meme comportement que
# Set-SzhRaccourcisMenu en production.
function Set-SzhRaccourciDev([string]$RacineDepot, [string]$NomRaccourci, [string]$DossierMenu) {
  try {
    $dossierMenu = $DossierMenu
    if (-not $dossierMenu) { $dossierMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }
    $cheminLnk = Join-Path $dossierMenu ($NomRaccourci + '.lnk')
    $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
    $vbs = Join-Path $RacineDepot 'windows\hidden.vbs'
    $cibleScript = Join-Path $RacineDepot 'outils-dev\pronto-dev.ps1'
    $icone = Join-Path $RacineDepot 'windows\pronto.ico'
    $argumentsVoulus = ('//B "{0}" "{1}"' -f $vbs, $cibleScript)

    if (Test-Path -LiteralPath $cheminLnk) {
      $existant = (New-Object -ComObject WScript.Shell).CreateShortcut($cheminLnk)
      $dejaBon = (([string]$existant.TargetPath).ToLower() -eq $wscript.ToLower()) -and
        (([string]$existant.Arguments) -eq $argumentsVoulus)
      if ($dejaBon) { return }
    }

    New-Item -ItemType Directory -Force -Path $dossierMenu | Out-Null
    $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut($cheminLnk)
    $lnk.TargetPath = $wscript
    $lnk.Arguments = $argumentsVoulus
    $lnk.Description = 'Pronto, instance de developpement'
    $lnk.WindowStyle = 1
    if (Test-Path -LiteralPath $icone) { $lnk.IconLocation = ('{0},0' -f $icone) }
    $lnk.Save()
  } catch {
    if (Get-Command Write-SzhLog -ErrorAction SilentlyContinue) {
      Write-SzhLog ('pronto-dev : raccourci menu Demarrer non pose - ' + $_.Exception.Message)
    }
  }
}

# ---- le plan, calcule que l'on soit en simulation ou non ----
$cheminToolkit = Join-Path $BaseDev 'toolkit'
$cheminExtensions = Join-Path (Join-Path $BaseDev 'codium') 'extensions'
$cheminCockpit = Join-Path $cheminExtensions 'szh-cockpit'
$cheminApercu = Join-Path $cheminExtensions 'szh-apercu'

$jonctions = @(
  [ordered]@{ lien = $cheminToolkit; cible = $racineDepot }
  [ordered]@{ lien = $cheminCockpit; cible = (Join-Path $racineDepot 'vscodium-extension\szh-cockpit') }
  [ordered]@{ lien = $cheminApercu; cible = (Join-Path $racineDepot 'vscodium-extension\szh-apercu') }
)

$dossierUser = Join-Path (Join-Path $BaseDev 'codium') 'data\User'
$fichierConfigDev = Join-Path $BaseDev 'config.json'
$fichierProteges = Join-Path $BaseDev 'settings-protected.json'
$fichierVersion = Join-Path $racineDepot 'VERSION'
$fichierSettings = Join-Path $dossierUser 'settings.json'
$fichierKeybinds = Join-Path $dossierUser 'keybindings.json'
$dossierSnippets = Join-Path $dossierUser 'snippets'
$fichierTasks = Join-Path $dossierUser 'tasks.json'

$fichiers = @(
  $fichierVersion, $fichierConfigDev, $fichierProteges,
  $fichierSettings, $fichierKeybinds, $dossierSnippets, $fichierTasks
)

$makefileWsl = ConvertTo-SzhCheminWsl (Join-Path $racineDepot 'pipeline\Makefile')
$configWsl = ConvertTo-SzhCheminWsl $fichierConfigDev

$variables = [ordered]@{
  SZH_BASE            = $BaseDev
  SZH_TOOLKIT         = $cheminToolkit
  SZH_COCKPIT_DOSSIER = $cheminCockpit
  # Lu par Start-SzhCodium (szh-shell.ps1) - sans elle VSCodium ouvrirait le profil de
  # production, et tout ce qui est seme sous <baseDev>\codium ne servirait jamais a rien.
  SZH_CODIUM_PROFIL   = Join-Path $BaseDev 'codium'
}

if ($Simuler) {
  # Hors du tableau fichiers : ni sous baseDev ni sous la racine du depot, un controle
  # existant refuse tout chemin de fichiers qui ne l'est pas.
  $dossierMenuPlan = $Menu
  if (-not $dossierMenuPlan) { $dossierMenuPlan = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs' }
  $cheminRaccourciPlan = Join-Path $dossierMenuPlan ($NOM_RACCOURCI_DEV + '.lnk')

  $sortie = [ordered]@{
    racineDepot = $racineDepot
    baseDev     = $BaseDev
    jonctions   = $jonctions
    fichiers    = $fichiers
    raccourci   = $cheminRaccourciPlan
    variables   = $variables
    makefileWsl = $makefileWsl
  }
  # Octets UTF-8 ecrits directement sur le flux, hors Write-Output - celui-ci passe par
  # l'encodage de la console et abimerait un accent en PowerShell 5.1 non interactif.
  $json = ($sortie | ConvertTo-Json -Depth 6)
  $octets = [System.Text.Encoding]::UTF8.GetBytes($json)
  $flux = [Console]::OpenStandardOutput()
  $flux.Write($octets, 0, $octets.Length)
  $flux.Flush()
  exit 0
}

try {
  # ---- jonctions, sans avoir besoin de l'administrateur ----
  function Test-SzhEstJonction([string]$Chemin) {
    if (-not (Test-Path -LiteralPath $Chemin)) { return $false }
    $item = Get-Item -LiteralPath $Chemin -Force
    return (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
  }

  function Set-SzhJonction([string]$Lien, [string]$Cible) {
    if (Test-Path -LiteralPath $Lien) {
      if (-not (Test-SzhEstJonction $Lien)) {
        # Un vrai dossier deja present ne se remplace jamais tout seul - refuser bruyamment
        # est le seul geste sur, effacer a sa place perdrait un dossier de travail reel.
        throw ('refus - ' + $Lien + ' existe deja comme un vrai dossier, pas une jonction. Rien n''a ete touche.')
      }
      $item = Get-Item -LiteralPath $Lien -Force
      $cibleActuelle = [string]$item.Target
      $memeCible = $false
      if ($cibleActuelle) {
        $memeCible = ([System.IO.Path]::GetFullPath($cibleActuelle).TrimEnd('\') -ieq
          [System.IO.Path]::GetFullPath($Cible).TrimEnd('\'))
      }
      if ($memeCible) { return }
      # .Delete() sans recursion ne retire que le lien, jamais le contenu de la cible visee.
      $item.Delete()
    }
    $parent = Split-Path $Lien -Parent
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    New-Item -ItemType Junction -Path $Lien -Target $Cible | Out-Null
  }

  foreach ($j in $jonctions) { Set-SzhJonction $j.lien $j.cible }

  # ---- VERSION du depot, lue par Get-SzhVersionInstallee (szh-common.ps1) via la jonction toolkit ----
  function Get-SzhShaCourtDepot([string]$Racine) {
    try {
      $brut = & git -C $Racine rev-parse --short HEAD 2>$null
      if (($LASTEXITCODE -eq 0) -and $brut) { return ([string]$brut).Trim() }
    } catch { }
    return 'inconnu'
  }
  $versionCible = '0.0.0-dev+' + (Get-SzhShaCourtDepot $racineDepot)
  $versionActuelle = ''
  if (Test-Path -LiteralPath $fichierVersion) {
    try { $versionActuelle = (Get-Content -LiteralPath $fichierVersion -Raw -ErrorAction Stop).Trim() } catch { }
  }
  if ($versionActuelle -ne $versionCible) {
    Set-Content -LiteralPath $fichierVersion -Value $versionCible -Encoding ASCII
  }

  # ---- config.json du dossier de developpement, seulement s'il manque ----
  if (-not (Test-Path -LiteralPath $fichierConfigDev)) {
    $basesRevues = [ordered]@{
      prod = '%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte'
      dev  = '%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING'
    }
    $configProdFichier = 'C:\ProgramData\SZH\config.json'
    if (Test-Path -LiteralPath $configProdFichier) {
      try {
        $cfgProd = Get-Content -LiteralPath $configProdFichier -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfgProd -and $cfgProd.basesRevues) {
          $bp = [ordered]@{}
          foreach ($p in $cfgProd.basesRevues.PSObject.Properties) { $bp[$p.Name] = $p.Value }
          if ($bp.Contains($CLE_BASESREVUES_DEV)) { $basesRevues['dev'] = $bp[$CLE_BASESREVUES_DEV] }
          if ($bp.Contains('prod')) { $basesRevues['prod'] = $bp['prod'] }
        }
      } catch { }
    }
    $cfgDev = [ordered]@{
      repo              = 'SZH-CSPS/szh-publishing-toolchain'
      revuesRoots       = @()
      basesRevues       = $basesRevues
      # Jamais "production" ici, cette instance de developpement ne doit jamais toucher aux
      # vraies revues.
      emplacementRevues = 'test'
    }
    $json = ($cfgDev | ConvertTo-Json -Depth 5)
    [System.IO.File]::WriteAllText($fichierConfigDev, $json, (New-Object System.Text.UTF8Encoding($false)))
  }

  # ---- reglages proteges, ecrases a chaque lancement, comme le fait update.ps1 vers SzhBase ----
  $protegesSrc = Join-Path $racineDepot 'windows\settings-protected.json'
  if (Test-Path -LiteralPath $protegesSrc) {
    Copy-Item -LiteralPath $protegesSrc -Destination $fichierProteges -Force
  }

  # ---- reglages VSCodium du compte de developpement ----
  $srcUser = Join-Path $racineDepot 'vscodium-user'
  if (-not (Test-Path -LiteralPath $dossierUser)) { New-Item -ItemType Directory -Force -Path $dossierUser | Out-Null }

  # settings.json se garde une fois pose, c'est le seul que la personne retouche a la main.
  $srcSettings = Join-Path $srcUser 'settings.json'
  if ((Test-Path -LiteralPath $srcSettings) -and (-not (Test-Path -LiteralPath $fichierSettings))) {
    Copy-Item -LiteralPath $srcSettings -Destination $fichierSettings -Force
  }
  $srcKeybinds = Join-Path $srcUser 'keybindings.json'
  if (Test-Path -LiteralPath $srcKeybinds) { Copy-Item -LiteralPath $srcKeybinds -Destination $fichierKeybinds -Force }

  $srcSnippets = Join-Path $srcUser 'snippets'
  if (Test-Path -LiteralPath $srcSnippets) {
    if (-not (Test-Path -LiteralPath $dossierSnippets)) { New-Item -ItemType Directory -Force -Path $dossierSnippets | Out-Null }
    Copy-Item -Path (Join-Path $srcSnippets '*') -Destination $dossierSnippets -Force
  }

  # ---- tasks.json, reecrit a chaque lancement pour qu'une retouche du depot se voie tout de suite ----
  # Le prefixe SZH_CONFIG est le seul moyen de faire lire ce dossier de developpement par le
  # filtre pandoc szh-citations.lua - wsl.exe ne transmet pas l'environnement de Windows sans
  # WSLENV, et sans ce prefixe la compilation dev lirait les titres de bibliographie de la
  # configuration de production.
  $srcTasks = Join-Path $srcUser 'tasks.json'
  if (Test-Path -LiteralPath $srcTasks) {
    $contenu = Get-Content -LiteralPath $srcTasks -Raw -Encoding UTF8
    $motifMakefileProd = [regex]::Escape('/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile')
    $remplaceMakefile = $makefileWsl -replace '\$', '$$'
    $contenu = [regex]::Replace($contenu, $motifMakefileProd, $remplaceMakefile)
    $remplaceConfig = '$1SZH_CONFIG=' + ($configWsl -replace '\$', '$$') + ' '
    $contenu = [regex]::Replace($contenu, '("bash",\s*"-c",\s*")', $remplaceConfig)
    [System.IO.File]::WriteAllText($fichierTasks, $contenu, (New-Object System.Text.UTF8Encoding($false)))
  }

  # ---- variables d'environnement, uniquement pour ce processus ----
  # Jamais setx, jamais une variable machine ou utilisateur - une variable qui fuiterait
  # ferait tourner le VSCodium de production sur la configuration de developpement, en silence.
  $env:SZH_BASE = $variables.SZH_BASE
  $env:SZH_TOOLKIT = $variables.SZH_TOOLKIT
  $env:SZH_COCKPIT_DOSSIER = $variables.SZH_COCKPIT_DOSSIER
  $env:SZH_CODIUM_PROFIL = $variables.SZH_CODIUM_PROFIL

  # ---- raccourci "Pronto (dev)" au menu Demarrer - pose ici et seulement ici, voir le ----
  # ---- commentaire de Set-SzhRaccourciDev plus haut ----
  . (Join-Path $racineDepot 'windows\szh-common.ps1')
  Set-SzhRaccourciDev -RacineDepot $racineDepot -NomRaccourci $NOM_RACCOURCI_DEV -DossierMenu $Menu

  & (Join-Path $racineDepot 'windows\open-revue.ps1') @Arguments
  exit $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine('pronto-dev, erreur - ' + $_.Exception.Message)
  exit 1
}
