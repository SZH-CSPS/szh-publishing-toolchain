<#
.SYNOPSIS
  Ouverture d'un .md par double-clic : cible de l'association « Ouvrir avec » →
  « Revue SZH » (ProgId SZH.Markdown posé par update.ps1). Reçoit le chemin du fichier
  en premier argument positionnel, remonte jusqu'au dossier de revue (celui qui porte
  ausgabe.yaml) et ouvre VSCodium sur le dossier puis sur le fichier.

.DESCRIPTION
  Il ne compile rien et n'appelle pas WSL : le Makefile n'a aucun verrou et un build lancé
  ici courrait contre ceux de « folderOpen » et de « Trigger Task on Save », un PDF ouvert
  hors de l'éditeur ferait échouer le « mv » atomique sans que personne ne lise l'erreur,
  et la colonne 2 appartient à l'aperçu du cockpit. Le dossier est ouvert en plus du
  fichier : sans lui, ni l'aperçu ni la régénération ne s'activent.

  SZH_OPENMD_SIMULE=1 : la commande qui aurait été lancée et les messages destinés à
  l'utilisateur partent sur la sortie standard, un test automatisé resterait sinon bloqué
  sur une boîte de dialogue.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Fichier
)

. "$PSScriptRoot\szh-common.ps1"

# Mode simulation (tests / diagnostic) : voir l'en-tête.
$script:SzhSimule = ($env:SZH_OPENMD_SIMULE -eq '1')

# Le journal ne doit pas faire échouer une ouverture (dossier de logs absent ou en
# lecture seule) : l'échec d'écriture est avalé.
function Write-SzhTrace([string]$Message) {
  try { Write-SzhLog ('open-md : ' + $Message) } catch { }
}

# Lancé par hidden.vbs, donc sans console : Write-Host ne serait vu de personne et
# Show-SzhErreur, qui attend une touche, bloquerait un processus invisible. D'où WinForms.
# Réservé aux cas anormaux, le cas nominal est silencieux.
function Show-SzhMessage([string]$Texte) {
  Write-SzhTrace ('message = ' + ($Texte -replace "`r", '' -replace "`n", ' | '))
  if ($script:SzhSimule) { Write-Host ('[MESSAGE] ' + $Texte); return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Texte, 'Revue SZH')
  } catch { }
}

# Remontée jusqu'au dossier de revue, .Parent jusqu'à $null : pas de profondeur maximale,
# une revue pouvant être n'importe où sous OneDrive. $null si aucun ausgabe.yaml.
function Find-SzhRacineRevue([System.IO.DirectoryInfo]$Depart) {
  $d = $Depart
  while ($null -ne $d) {
    if (Test-Path -LiteralPath (Join-Path $d.FullName 'ausgabe.yaml')) { return $d }
    $d = $d.Parent
  }
  return $null
}

# Un article est un <racine>\articles\<slug>\<slug>.md, le .md portant le nom de son
# dossier. Ne sert qu'à qualifier la trace : l'ouverture est la même dans les deux cas.
function Test-SzhArticle([System.IO.FileInfo]$Md, [string]$Racine) {
  $dossier = $Md.Directory
  if ($null -eq $dossier) { return $false }
  if ($null -eq $dossier.Parent) { return $false }
  $attendu = Join-Path $Racine 'articles'
  if ($dossier.Parent.FullName.TrimEnd('\') -ne $attendu.TrimEnd('\')) { return $false }
  return ($Md.BaseName -eq $dossier.Name)
}

# Un seul Start-Process, chaque chemin quoté séparément : VSCodium lit l'argument dossier
# comme « ouvrir ce dossier » et l'argument fichier comme « ouvrir cet onglet ».
function Start-SzhCodium([string]$Codium, [string[]]$Chemins) {
  $arguments = (($Chemins | ForEach-Object { '"{0}"' -f $_ }) -join ' ')
  Write-SzhTrace ('ouverture -> {0} {1}' -f $Codium, $arguments)
  if ($script:SzhSimule) {
    Write-Host ('[SIMULE] {0} {1}' -f $Codium, $arguments)
    return
  }
  # ELECTRON_RUN_AS_NODE hérité ferait exécuter le dossier comme un script Node.
if (Test-Path 'Env:ELECTRON_RUN_AS_NODE') { Remove-Item 'Env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue }
Start-Process -FilePath $Codium -ArgumentList $arguments
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

# ---- L'éditeur : sans lui, rien n'est possible ; on donne le contact du support ----
$codium = Get-VSCodiumExe
if (-not $codium) {
  Write-SzhTrace 'VSCodium introuvable'
  Show-SzhMessage (T 'lanceur.codium' @($SzhSupport))   # texte déjà traduit pour le lanceur
  exit 1
}

# ---- Chemin réseau (UNC) ----
# On ouvre quand même : lire et corriger un texte marche, mais WSL ne monte pas l'UNC et
# la fabrication du PDF échouerait. Le message part après l'ouverture, pour accompagner
# plutôt que barrer la route.
$estUnc = $complet.StartsWith('\\')

# ---- La revue : remontée jusqu'à ausgabe.yaml ----
$racine = Find-SzhRacineRevue $md.Directory

if ($null -eq $racine) {
  # Hors de toute revue : on ouvre le fichier seul, ouvrir un dossier arbitraire serait
  # pire, et on annonce la limite.
  Write-SzhTrace ('hors revue : ' + $complet)
  Start-SzhCodium $codium @($complet)
  if ($estUnc) { Show-SzhMessage (T 'openmd.reseau') } else { Show-SzhMessage (T 'openmd.horsrevue') }
  exit 0
}

# Dans une revue : dossier puis fichier. Article ou simple .md à la racine du numéro, le
# geste est le même, seule la trace change. Cas nominal : aucun message.
$estArticle = Test-SzhArticle $md $racine.FullName
if ($estArticle) {
  Write-SzhTrace ('article {0} de la revue {1}' -f $md.BaseName, $racine.Name)
} else {
  Write-SzhTrace ('fichier {0} (hors articles) de la revue {1}' -f $md.Name, $racine.Name)
}

Start-SzhCodium $codium @($racine.FullName, $complet)

if ($estUnc) { Show-SzhMessage (T 'openmd.reseau') }
exit 0
