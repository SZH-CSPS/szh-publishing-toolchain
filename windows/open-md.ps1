<#
.SYNOPSIS
  Ouvre un .md double-cliqué (association « Pronto », ProgId SZH.Markdown posé par
  update.ps1). Remonte jusqu'au dossier de revue ou de livre (celui qui porte ausgabe.yaml
  ou buch.yaml) et ouvre VSCodium sur ce dossier puis sur le fichier.

.DESCRIPTION
  Le script ne compile rien : le Makefile n'a pas de verrou, et une compilation lancée ici
  entrerait en concurrence avec celles du cockpit. Le dossier est ouvert avec le fichier
  parce que l'aperçu et la régénération ne s'activent que sur un dossier ouvert.

  SZH_OPENMD_SIMULE=1 : la commande et les messages partent sur la sortie standard au lieu
  d'une boîte de dialogue (pour les tests).

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Fichier
)

. "$PSScriptRoot\szh-common.ps1"

$script:SzhSimule = ($env:SZH_OPENMD_SIMULE -eq '1')

# Un journal impossible à écrire ne fait pas échouer l'ouverture.
function Write-SzhTrace([string]$Message) {
  try { Write-SzhLog ('open-md : ' + $Message) } catch { }
}

# Le script tourne sans console avec $ErrorActionPreference = 'Stop' (szh-common.ps1) :
# sans ce trap, une exception le terminerait sans message ni journal. Le trap couvre tout le
# script ; en simulation, l'erreur part sur la sortie standard.
trap {
  $souci = $_.Exception.Message
  Write-SzhTrace ('ERREUR : ' + $souci)
  # Rapport d'erreur silencieux (docs/RAPPORTS-ERREUR.md), muet en simulation.
  try {
    Write-SzhRapport -Code 'LANCEUR-TRAP' -Source 'lanceur' -Etape 'ouverture d''un fichier .md' `
      -Message $souci -Pile $_.ScriptStackTrace -Fichiers @($Fichier)
  } catch { }
  if ($script:SzhSimule) {
    Write-Host ('[ERREUR] ' + $souci)
    exit 1
  }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.erreur' @($souci, $SzhSupport)), 'Pronto')
  } catch {
    try { [void][System.Windows.Forms.MessageBox]::Show($souci, 'Pronto') } catch { }
  }
  exit 1
}

# Message en boîte WinForms : sans console, Write-Host ne se voit pas et Show-SzhErreur
# attendrait une touche. Réservé aux cas anormaux.
function Show-SzhMessage([string]$Texte) {
  Write-SzhTrace ('message = ' + ($Texte -replace "`r", '' -replace "`n", ' | '))
  if ($script:SzhSimule) { Write-Host ('[MESSAGE] ' + $Texte); return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Texte, 'Pronto')
  } catch { }
}

# Rend le premier dossier parent qui porte buch.yaml (livre) ou ausgabe.yaml (revue), sans
# limite de profondeur ; $null s'il n'y en a pas. buch.yaml est testé d'abord, comme dans
# lib/profil.js et le Makefile.
function Find-SzhRacineRevue([System.IO.DirectoryInfo]$Depart) {
  $d = $Depart
  while ($null -ne $d) {
    if (Test-Path -LiteralPath (Join-Path $d.FullName 'buch.yaml')) { return $d }
    if (Test-Path -LiteralPath (Join-Path $d.FullName 'ausgabe.yaml')) { return $d }
    $d = $d.Parent
  }
  return $null
}

# Vrai pour un article, <racine>\articles\<slug>\<slug>.md. Ne sert qu'au journal.
function Test-SzhArticle([System.IO.FileInfo]$Md, [string]$Racine) {
  $dossier = $Md.Directory
  if ($null -eq $dossier) { return $false }
  if ($null -eq $dossier.Parent) { return $false }
  $attendu = Join-Path $Racine 'articles'
  if ($dossier.Parent.FullName.TrimEnd('\') -ne $attendu.TrimEnd('\')) { return $false }
  return ($Md.BaseName -eq $dossier.Name)
}

# Lance VSCodium en un seul Start-Process, chaque chemin entre guillemets : le dossier
# s'ouvre comme espace de travail, le fichier comme onglet. Le nom diffère de
# Start-SzhCodium (szh-common.ps1), qui a une autre signature et serait masqué.
function Start-SzhCodiumFichier([string]$Codium, [string[]]$Chemins) {
  # Mêmes variables secrètes (SZH_SHLINK_URL, SZH_SHLINK_CLE, SZH_OJS_CLE) qu'à l'ouverture
  # depuis le lanceur, pour compiler de la même façon.
  Set-SzhEnvironnementSecrets
  $arguments = (($Chemins | ForEach-Object { '"{0}"' -f $_ }) -join ' ')
  Write-SzhTrace ('ouverture -> {0} {1}' -f $Codium, $arguments)
  if ($script:SzhSimule) {
    Write-Host ('[SIMULE] {0} {1}' -f $Codium, $arguments)
    return
  }
  # ELECTRON_RUN_AS_NODE hérité ferait exécuter le dossier comme un script Node.
  if (Test-Path 'Env:ELECTRON_RUN_AS_NODE') { Remove-Item 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue }
  # Un échec de Start-Process (VSCodium désinstallé entre-temps, chemin trop long…) est
  # journalisé.
  try {
    Start-Process -FilePath $Codium -ArgumentList $arguments
  } catch {
    Write-SzhTrace ('lancement impossible (' + $_.Exception.Message + ') -> ' + $Codium + ' ' + $arguments)
  }
}

# ---- L'argument : présent ? existant ? ----
$chemin = $Fichier
if ($chemin) { $chemin = $chemin.Trim().Trim('"') }

if (-not $chemin) {
  # Lancement sans argument : personne n'a double-cliqué de fichier.
  Write-SzhTrace 'aucun argument'
  Show-SzhMessage (T 'openmd.vide')
  exit 1
}

if (-not (Test-Path -LiteralPath $chemin -PathType Leaf)) {
  # Cas courant et bénin : fichier déplacé, renommé, ou OneDrive pas encore synchronisé.
  Write-SzhTrace ('introuvable : ' + $chemin)
  Show-SzhMessage (T 'openmd.introuvable')
  exit 1
}

$md = Get-Item -LiteralPath $chemin
$complet = $md.FullName

# ---- L'éditeur : s'il manque, on donne le contact du support ----
$codium = Get-VSCodiumExe
if (-not $codium) {
  Write-SzhTrace 'VSCodium introuvable'
  Show-SzhMessage (T 'lanceur.codium' @($SzhSupport))   # texte déjà traduit pour le lanceur
  exit 1
}

# ---- Chemin réseau (UNC) ----
# Le fichier s'ouvre quand même, mais WSL ne monte pas un chemin UNC : le PDF ne pourra pas
# être fabriqué. Le message le dit après l'ouverture.
$estUnc = $complet.StartsWith('\\')

# ---- La revue ou le livre : remontée jusqu'à ausgabe.yaml ou buch.yaml ----
$racine = Find-SzhRacineRevue $md.Directory

if ($null -eq $racine) {
  # Hors de toute revue ou livre : le fichier s'ouvre seul, et un message annonce la limite.
  Write-SzhTrace ('hors revue : ' + $complet)
  Start-SzhCodiumFichier $codium @($complet)
  if ($estUnc) { Show-SzhMessage (T 'openmd.reseau') } else { Show-SzhMessage (T 'openmd.horsrevue') }
  exit 0
}

# Dans une revue ou un livre : dossier puis fichier. Seul le journal distingue les cas.
$estLivre = Test-Path -LiteralPath (Join-Path $racine.FullName 'buch.yaml')
$estArticle = Test-SzhArticle $md $racine.FullName
if ($estLivre) {
  Write-SzhTrace ('fichier {0} du livre {1}' -f $md.Name, $racine.Name)
} elseif ($estArticle) {
  Write-SzhTrace ('article {0} de la revue {1}' -f $md.BaseName, $racine.Name)
} else {
  Write-SzhTrace ('fichier {0} (hors articles) de la revue {1}' -f $md.Name, $racine.Name)
}

Start-SzhCodiumFichier $codium @($racine.FullName, $complet)

if ($estUnc) { Show-SzhMessage (T 'openmd.reseau') }
exit 0
