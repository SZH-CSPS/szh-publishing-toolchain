<#
.SYNOPSIS
  Pose l'icône Pronto sur VSCodium, après coup :
    powershell -ExecutionPolicy Bypass -File .\patch-icone.ps1

  Se lance seul sur un poste déjà installé, et bootstrap.ps1 l'appelle après avoir posé
  l'éditeur. Rejouable : un second passage ne fait rien de plus.

  Deux gestes, et deux seulement :

    1. l'icône des raccourcis qui visent VSCodium.exe. C'est ELLE qui décide du bouton de
       la barre des tâches : Windows 11 groupe par AppUserModelID et prend l'image du
       raccourci du menu Démarrer qui porte le même — mesuré le 15.09.2026 en lançant
       l'éditeur trois fois avec trois icônes différentes, le bouton a suivi à chaque fois,
       sans redémarrer l'explorateur ;
    2. resources\app\out\media\code-icon.svg, l'image que le workbench affiche dans sa
       barre de titre (VSCodium est en barre de titre personnalisée : cette image ne vient
       pas de l'exécutable). Ce fichier n'est PAS dans les `checksums` de product.json —
       le remplacer ne déclenche donc pas « votre installation semble corrompue ».

  AUCUN binaire n'est modifié. VSCodium.exe reste octet pour octet celui que l'installeur a
  posé : l'empreinte d'apps.lock continue de porter, et il n'y a pas de signature à casser
  (seul l'installeur est signé, l'exécutable ne l'est pas).

  Ce qui reste à l'ancienne icône : Alt+Tab et la vignette de survol, qui lisent l'icône de
  l'exécutable. Les corriger demanderait de réécrire les ressources du binaire — hors de
  proportion avec le gain.

  -Restaurer remet l'état d'origine (sauvegarde déposée au premier passage).
  -Simuler dit ce qui serait fait, sans rien écrire.

  Administrateur : nécessaire seulement si l'éditeur est dans Program Files ou si les
  raccourcis sont dans le menu Démarrer commun — c'est le cas normal d'un poste de
  rédacteur. Sur une installation par utilisateur, le script tourne sans élévation.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [switch]$Restaurer,
  [switch]$Simuler
)

. "$PSScriptRoot\szh-common.ps1"

function Info([string]$m)      { Write-Host ('[icone] ' + $m) -ForegroundColor Cyan }
function Attention([string]$m) { Write-Host ('[icone] ' + $m) -ForegroundColor Yellow }
function Fait([string]$m)      { Write-Host ('[icone] ' + $m) -ForegroundColor Green }

$script:Poses = 0
$script:Soucis = 0

# ---- Où prendre les images ----
#
# Le .ico doit être désigné par un chemin DURABLE : un raccourci garde le chemin, pas
# l'image. $SzhToolkit\windows est cet endroit — c'est déjà là que pointent les raccourcis
# du lanceur, et update.ps1 y remet les fichiers à chaque passage. $PSScriptRoot n'est un
# repli que pour un essai depuis un dossier quelconque : bootstrap.ps1 lance ses scripts
# depuis une copie temporaire, qui aura disparu quand l'utilisateur ouvrira son menu.
$icoToolkit = Join-Path $SzhToolkit 'windows\pronto.ico'
$icoLocal   = Join-Path $PSScriptRoot 'pronto.ico'
$svgLocal   = Join-Path $PSScriptRoot 'pronto.svg'

$ico = ''
if (Test-Path -LiteralPath $icoToolkit) {
  $ico = $icoToolkit
} elseif (Test-Path -LiteralPath $icoLocal) {
  $ico = $icoLocal
  Attention ('pronto.ico pris dans ' + $PSScriptRoot + ' : ce chemin n''est pas durable, les raccourcis perdront leur image s''il disparaît.')
}
if ((-not $ico) -and (-not $Restaurer)) { throw ('pronto.ico introuvable — cherché dans ' + $icoToolkit + ' puis ' + $icoLocal + '.') }
if ((-not (Test-Path -LiteralPath $svgLocal)) -and (-not $Restaurer)) { throw ('pronto.svg introuvable : ' + $svgLocal) }

# ---- L'éditeur ----
$codium = Get-VSCodiumExe
if (-not $codium) { throw 'VSCodium introuvable — lancer d''abord bootstrap.ps1.' }
$racine = Split-Path -Parent $codium
Info ('Éditeur : ' + $codium)

# Un éditeur ouvert tient sa barre de titre en mémoire : le fichier se remplace quand même,
# mais l'image ne changera qu'à la prochaine ouverture. Le dire plutôt que de laisser croire
# à un échec.
$ouverts = @(Get-Process -Name 'VSCodium' -ErrorAction SilentlyContinue)
if ($ouverts.Count -gt 0) {
  Attention ('VSCodium est ouvert (' + $ouverts.Count + ' processus) : la barre de titre ne changera qu''à sa prochaine ouverture.')
}

# ---- 1/2 L'image de la barre de titre ----
$cible     = Join-Path $racine 'resources\app\out\media\code-icon.svg'
$sauvegarde = $cible + '.origine'

if (-not (Test-Path -LiteralPath $cible)) {
  Attention ('code-icon.svg introuvable (' + $cible + ') : cette version de l''éditeur ne range pas son image là. Barre de titre laissée telle quelle.')
  $script:Soucis++
} elseif ($Restaurer) {
  if (Test-Path -LiteralPath $sauvegarde) {
    if ($Simuler) {
      Info ('[SIMULE] restaurer ' + $cible)
    } else {
      Copy-Item -LiteralPath $sauvegarde -Destination $cible -Force
      Remove-Item -LiteralPath $sauvegarde -Force
      Fait 'Barre de titre : image d''origine remise.'
      Write-SzhLog 'patch-icone : code-icon.svg restauré'
    }
  } else {
    Info 'Barre de titre : aucune sauvegarde, rien à restaurer.'
  }
} else {
  $voulu = [IO.File]::ReadAllText($svgLocal)
  $actuel = ''
  try { $actuel = [IO.File]::ReadAllText($cible) } catch { }
  if ($actuel -eq $voulu) {
    Info 'Barre de titre : déjà à l''icône Pronto.'
  } elseif ($Simuler) {
    Info ('[SIMULE] écrire pronto.svg dans ' + $cible)
  } else {
    try {
      # La sauvegarde n'est prise qu'une fois : au deuxième passage, $cible porte déjà notre
      # image, et l'écraser ferait perdre l'original pour de bon.
      if (-not (Test-Path -LiteralPath $sauvegarde)) { Copy-Item -LiteralPath $cible -Destination $sauvegarde -Force }
      Copy-Item -LiteralPath $svgLocal -Destination $cible -Force
      Fait ('Barre de titre : ' + $cible)
      Write-SzhLog ('patch-icone : code-icon.svg remplacé dans ' + $racine)
      $script:Poses++
    } catch {
      Attention ('Barre de titre non posée (' + $_.Exception.Message + '). Élévation requise si l''éditeur est dans Program Files.')
      $script:Soucis++
    }
  }
}

# ---- 2/2 Les raccourcis ----
#
# Tous ceux qui visent VSCodium.exe, où qu'ils soient : menu Démarrer commun et par
# utilisateur, bureaux, et la barre des tâches épinglée. On ne devine pas un chemin, on
# lit la cible de chaque .lnk — l'installeur Inno ne range pas ses raccourcis au même
# endroit selon qu'il pose la variante système ou celle par utilisateur.
$racinesLnk = @(
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
  (Join-Path $env:PUBLIC 'Desktop'),
  [Environment]::GetFolderPath('Desktop')
)

$shell = New-Object -ComObject WScript.Shell
$trouves = 0

foreach ($racineLnk in $racinesLnk) {
  if ((-not $racineLnk) -or (-not (Test-Path -LiteralPath $racineLnk))) { continue }
  $liens = @(Get-ChildItem -LiteralPath $racineLnk -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue)
  foreach ($lien in $liens) {
    $raccourci = $null
    try { $raccourci = $shell.CreateShortcut($lien.FullName) } catch { continue }
    if (-not $raccourci.TargetPath) { continue }
    if ((Split-Path $raccourci.TargetPath -Leaf) -ne 'VSCodium.exe') { continue }
    $trouves++

    $voulu = ''
    if ($Restaurer) { $voulu = ',0' } else { $voulu = ($ico + ',0') }
    if ($raccourci.IconLocation -eq $voulu) {
      Info ('Raccourci déjà à jour : ' + $lien.FullName)
      continue
    }
    if ($Simuler) {
      Info ('[SIMULE] ' + $lien.FullName + ' -> ' + $voulu)
      continue
    }

    # L'AppUserModelID est relu avant et après : c'est lui qui rattache la fenêtre au
    # raccourci, donc à son image. WScript.Shell le préserve (vérifié), mais s'il venait à
    # le perdre, le bouton de la barre retomberait sur l'icône de l'exécutable sans que
    # rien ne le dise — d'où le contrôle, et le repli par le pont COM de szh-shell.ps1.
    $identite = Get-SzhLnkAppId $lien.FullName
    try {
      $raccourci.IconLocation = $voulu
      $raccourci.Save()
    } catch {
      Attention ('Raccourci non écrit (' + $lien.FullName + ') : ' + $_.Exception.Message)
      $script:Soucis++
      continue
    }
    if ($identite -and ((Get-SzhLnkAppId $lien.FullName) -ne $identite)) {
      if (Set-SzhLnkAppId $lien.FullName $identite) {
        Info ('AppUserModelID « ' + $identite +' » remis sur ' + $lien.Name)
      } else {
        Attention ('AppUserModelID « ' + $identite + ' » perdu sur ' + $lien.FullName + ' : le bouton de la barre gardera l''ancienne icône.')
        $script:Soucis++
      }
    }
    Fait ('Raccourci : ' + $lien.FullName)
    Write-SzhLog ('patch-icone : ' + $lien.FullName + ' -> ' + $voulu)
    $script:Poses++
  }
}

if ($trouves -eq 0) {
  Attention 'Aucun raccourci ne vise VSCodium.exe : le bouton de la barre des tâches gardera l''icône de l''exécutable.'
  Attention 'Un raccourci de menu Démarrer est posé par l''installeur ; s''il a été supprimé, le recréer puis relancer ce script.'
  $script:Soucis++
}

# ---- Cache d'icônes ----
#
# Sans ça, l'explorateur continue de servir l'ancienne image depuis son cache, et on croit
# le script en échec. Ne touche pas aux fenêtres déjà ouvertes.
if (($script:Poses -gt 0) -and (-not $Simuler)) {
  try { Invoke-SzhNatif { & (Join-Path $env:WINDIR 'System32\ie4uinit.exe') -show | Out-Null } } catch { }
}

Write-Host ''
if ($Simuler) {
  Info 'Simulation : rien n''a été écrit.'
} elseif ($script:Poses -eq 0) {
  Info 'Rien à faire, tout était déjà en place.'
} else {
  Fait ($script:Poses.ToString() + ' élément(s) posé(s).')
}
if ($script:Soucis -gt 0) {
  Attention ($script:Soucis.ToString() + ' point(s) à regarder ci-dessus.')
  exit 1
}
