<#
.SYNOPSIS
  Lance une instance de developpement de Pronto, qui lit le depot en place par jonctions,
  sans rien copier. Elle ne touche ni a l'installation de production (C:\ProgramData\SZH)
  ni aux reglages VSCodium du compte.

    powershell -ExecutionPolicy Bypass -File outils-dev\pronto-dev.ps1
    powershell -ExecutionPolicy Bypass -File outils-dev\pronto-dev.ps1 -Simuler -BaseDev <dossier>

  Sans argument, il ouvre VSCodium sans dossier sur l'Accueil du cockpit (Start-SzhAccueil).
  Un lien szh://, -Produit ou -Versions passent par windows\open-revue.ps1.

  Compatible Windows PowerShell 5.1 (pas de ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [string]$BaseDev = 'C:\ProgramData\SZH-dev',
  [switch]$Simuler,
  # Dossier qui recoit le .lnk ; vide, le vrai menu Demarrer. Meme forme que $Menu de
  # Set-SzhRaccourcisMenu.
  [string]$Menu = '',
  # Les trois parametres d'open-revue.ps1, transmis par nom : un tableau etale passerait
  # "-Produit" comme une valeur positionnelle.
  [Parameter(Position = 0)][string]$Lien = '',
  [string]$Produit = '',
  [switch]$Versions
)

$ErrorActionPreference = 'Stop'

# Entree de basesRevues qui fournit le dossier des revues de developpement (choix provisoire).
$CLE_BASESREVUES_DEV = 'dev'

# Nom du .lnk que ce script pose au menu Demarrer (update.ps1 et bootstrap.ps1 ne le posent
# pas).
$NOM_RACCOURCI_DEV = 'Pronto (dev)'

# ---- racine du depot, et garde d'entree ----
$racineDepot = Split-Path $PSScriptRoot -Parent
$makefileDepot = Join-Path $racineDepot 'pipeline\Makefile'
if (-not (Test-Path -LiteralPath $makefileDepot)) {
  [Console]::Error.WriteLine('pronto-dev - pas dans le depot, ' + $makefileDepot +
    ' est introuvable. A lancer depuis outils-dev\ du depot szh-publishing-toolchain.')
  exit 1
}

# ---- crochet pre-push : la porte rapide (test/js/porte-release.js --rapide) avant un push ----
# Sans effet s'il est deja pose, et sans erreur bloquante : un clone sans .githooks/pre-push
# demarre quand meme. SZH_SANS_PORTE=1 contourne le crochet au moment du push (voir
# .githooks/pre-push et docs/DEVELOPPEMENT.md).
try {
  git -C $racineDepot config core.hooksPath .githooks 2>$null | Out-Null
} catch { }

# ---- conversion vers la forme WSL d'un chemin Windows ----
# Meme resultat que versWsl() de vscodium-extension\szh-cockpit\lib\chemins-poste.js :
# lettre de lecteur en minuscule, barres inverses converties.
function ConvertTo-SzhCheminWsl([string]$CheminWindows) {
  $resolu = ([System.IO.Path]::GetFullPath($CheminWindows) -replace '\\', '/')
  if ($resolu -match '^([A-Za-z]):/(.*)$') {
    return '/mnt/' + $Matches[1].ToLower() + '/' + $Matches[2]
  }
  return $resolu
}

# ---- raccourci "Pronto (dev)" au menu Demarrer, pose a chaque lancement reel ----
# Pas en mode -Simuler. Un .lnk qui vise deja le bon script n'est pas reecrit. Ne leve pas
# d'erreur : un menu Demarrer verrouille par une strategie de groupe ne doit pas faire
# echouer le lancement (comme Set-SzhRaccourcisMenu en production).
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
  # Lu par Start-SzhCodium (szh-shell.ps1) : sans elle, VSCodium ouvrirait le profil de
  # production au lieu de <baseDev>\codium.
  SZH_CODIUM_PROFIL   = Join-Path $BaseDev 'codium'
  # Les journaux de mise a jour du poste, en lecture : aucune mise a jour n'ecrit sous baseDev.
  SZH_JOURNAUX_MAJ    = Join-Path $env:ProgramData 'SZH\logs'
}

if ($Simuler) {
  # Hors du tableau fichiers : ce chemin n'est ni sous baseDev ni sous le depot, ce que le
  # controle de ce tableau refuserait.
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
  # Octets UTF-8 ecrits directement sur le flux : Write-Output passe par l'encodage de la
  # console et abimerait un accent en PowerShell 5.1 non interactif.
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
        # Un vrai dossier a cet endroit n'est pas remplace : ce serait perdre un dossier de
        # travail.
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
      # .Delete() sans recursion retire le lien seul, pas le contenu de la cible.
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
      # "test" : l'instance de developpement ne touche pas aux vraies revues.
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
  # Le prefixe SZH_CONFIG fait lire la configuration de developpement par szh-citations.lua :
  # wsl.exe ne transmet pas l'environnement Windows sans WSLENV, et le filtre lirait sinon
  # les titres de bibliographie de la production.
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
  # Pas de setx ni de variable machine ou utilisateur : elle ferait tourner le VSCodium de
  # production sur la configuration de developpement.
  $env:SZH_BASE = $variables.SZH_BASE
  $env:SZH_TOOLKIT = $variables.SZH_TOOLKIT
  $env:SZH_COCKPIT_DOSSIER = $variables.SZH_COCKPIT_DOSSIER
  $env:SZH_CODIUM_PROFIL = $variables.SZH_CODIUM_PROFIL
  $env:SZH_JOURNAUX_MAJ = $variables.SZH_JOURNAUX_MAJ

  # ---- raccourci "Pronto (dev)" au menu Demarrer (voir Set-SzhRaccourciDev) ----
  . (Join-Path $racineDepot 'windows\szh-common.ps1')
  Set-SzhRaccourciDev -RacineDepot $racineDepot -NomRaccourci $NOM_RACCOURCI_DEV -DossierMenu $Menu

  # Le cockpit est une jonction vers le depot : un changement de son package.json rend le
  # cache d'extensions de VSCodium obsolete, qui affiche alors "Extensions have been
  # modified on disk". Aucun reglage ne coupe ce message ; on supprime le cache.
  Get-ChildItem (Join-Path $BaseDev 'codium\data\CachedProfilesData') -Recurse -Filter 'extensions.user.cache' -ErrorAction SilentlyContinue | Remove-Item -Force

  if ($Lien -or $Produit -or $Versions) {
    $transmis = @{}
    if ($Lien) { $transmis['Lien'] = $Lien }
    if ($Produit) { $transmis['Produit'] = $Produit }
    if ($Versions) { $transmis['Versions'] = $true }
    & (Join-Path $racineDepot 'windows\open-revue.ps1') @transmis
    exit $LASTEXITCODE
  }

  # ---- entree par defaut : VSCodium sans dossier, sur l'Accueil du cockpit ----
  # La fonction de production (szh-shell.ps1), sur le profil de developpement que designent
  # les variables posees plus haut.
  exit (Start-SzhAccueil)
} catch {
  [Console]::Error.WriteLine('pronto-dev, erreur - ' + $_.Exception.Message)
  exit 1
}
