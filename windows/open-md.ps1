<#
.SYNOPSIS
  Ouverture d'un fichier .md par double-clic — cible de l'association « Ouvrir avec »
  → « Revue SZH » (ProgId SZH.Markdown posé par update.ps1, T6.2 / T6.3, D18).

  Reçoit le chemin du .md en premier argument positionnel (le « %1 » de la commande
  shell Windows), remonte l'arborescence jusqu'au dossier de revue (celui qui contient
  ausgabe.yaml, D22) et ouvre VSCodium sur le DOSSIER puis sur le FICHIER. Rien de plus.

.DESCRIPTION
  POURQUOI CE LANCEUR EST « BÊTE » — il ne compile RIEN et n'appelle PAS WSL (D20 :
  l'intelligence vit dans le toolkit et dans l'éditeur ; les scripts OS restent bêtes).
  Trois raisons, toutes constatées et non théoriques :

  1) DEUX « make » CONCURRENTS SUR LE MÊME out/ SONT POSSIBLES. Le Makefile n'a aucun
     verrou. Si ce script lançait un build, il courrait contre celui de la tâche
     « folderOpen » et contre « Trigger Task on Save » (triggerTaskOnSave), qui peuvent
     démarrer dans la même seconde que l'ouverture de la revue. Deux écritures
     concurrentes du même PDF ne se réconcilient pas.
  2) UN PDF OUVERT HORS DE L'ÉDITEUR VERROUILLE LE FICHIER (SumatraPDF, Acrobat…) et
     fait échouer le « mv » atomique du Makefile (D21). Compiler à l'aveugle depuis
     l'Explorateur, c'est fabriquer cet échec sans avoir personne pour le lire :
     ce script tourne SANS console (hidden.vbs), donc sans sortie visible.
  3) LA COLONNE 2 DE L'ÉDITEUR N'A QU'UN SEUL PROPRIÉTAIRE LÉGITIME (D54) : l'aperçu.
     C'est le cockpit (extension VSCodium) qui, au démarrage, ouvre l'aperçu de
     l'article actif et compile s'il est obsolète (D46) — un seul endroit décide, un
     seul endroit compile, un seul endroit possède la colonne 2.

  Conséquence assumée : après le double-clic, la compilation éventuelle et l'aperçu
  sont l'affaire du cockpit. Ce script se contente d'amener l'utilisateur au bon
  endroit (le dossier de la revue, pas le fichier orphelin — sans le dossier, ni
  l'aperçu ni la régénération ne seraient actifs).

  AIDE DE MAINTENANCE : SZH_OPENMD_SIMULE=1 — le script journalise et AFFICHE sur la
  sortie standard la commande qu'il aurait lancée, au lieu de démarrer VSCodium ; les
  messages destinés à l'utilisateur partent aussi sur la sortie standard au lieu d'une
  boîte de dialogue (sinon un test automatisé resterait bloqué sur un MessageBox).
  Sert à exercer les cas limites sans ouvrir l'éditeur ni fabriquer de fausse revue
  dans le dépôt.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Fichier
)

. "$PSScriptRoot\szh-common.ps1"

# Mode simulation (tests / diagnostic) : voir l'en-tête.
$script:SzhSimule = ($env:SZH_OPENMD_SIMULE -eq '1')

# Le journal ne doit JAMAIS faire échouer une ouverture (dossier de logs absent ou en
# lecture seule sur un poste bricolé) : on avale l'échec d'écriture.
function Write-SzhTrace([string]$Message) {
  try { Write-SzhLog ('open-md : ' + $Message) } catch { }
}

# Message à l'utilisateur. Ce script est lancé par hidden.vbs, donc SANS console :
# Write-Host ne serait vu de personne et Show-SzhErreur (qui attend une touche)
# bloquerait un processus invisible. D'où WinForms, comme open-revue.ps1.
# Réservé aux cas ANORMAUX : le cas nominal est totalement silencieux.
function Show-SzhMessage([string]$Texte) {
  Write-SzhTrace ('message = ' + ($Texte -replace "`r", '' -replace "`n", ' | '))
  if ($script:SzhSimule) { Write-Host ('[MESSAGE] ' + $Texte); return }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Texte, 'Revue SZH')
  } catch { }
}

# Remontée jusqu'au dossier de revue : .Parent jusqu'à $null (la racine du volume rend
# $null), pas de compteur artificiel — une revue peut être à n'importe quelle profondeur
# sous OneDrive. Rend $null si aucun ausgabe.yaml n'est rencontré.
function Find-SzhRacineRevue([System.IO.DirectoryInfo]$Depart) {
  $d = $Depart
  while ($null -ne $d) {
    if (Test-Path -LiteralPath (Join-Path $d.FullName 'ausgabe.yaml')) { return $d }
    $d = $d.Parent
  }
  return $null
}

# Article au sens D21/D26 : <racine>\articles\<slug>\<slug>.md (le .md est HOMONYME de
# son dossier). Sert uniquement à qualifier la trace du journal : article ou non, on
# ouvre de la même façon (dossier + fichier) — c'est le cockpit qui distingue ensuite.
function Test-SzhArticle([System.IO.FileInfo]$Md, [string]$Racine) {
  $dossier = $Md.Directory
  if ($null -eq $dossier) { return $false }
  if ($null -eq $dossier.Parent) { return $false }
  $attendu = Join-Path $Racine 'articles'
  if ($dossier.Parent.FullName.TrimEnd('\') -ne $attendu.TrimEnd('\')) { return $false }
  return ($Md.BaseName -eq $dossier.Name)
}

# Ouverture effective. Un seul Start-Process, chaque chemin quoté séparément —
# modèle d'open-revue.ps1 (l.182). VSCodium interprète l'argument dossier comme
# « ouvrir ce dossier » et l'argument fichier comme « ouvrir cet onglet ».
function Start-SzhCodium([string]$Codium, [string[]]$Chemins) {
  $arguments = (($Chemins | ForEach-Object { '"{0}"' -f $_ }) -join ' ')
  Write-SzhTrace ('ouverture -> {0} {1}' -f $Codium, $arguments)
  if ($script:SzhSimule) {
    Write-Host ('[SIMULE] {0} {1}' -f $Codium, $arguments)
    return
  }
  Start-Process -FilePath $Codium -ArgumentList $arguments
}

# ---------------------------------------------------------------------------------
# 1) L'argument : présent ? existant ?
# ---------------------------------------------------------------------------------
$chemin = $Fichier
if ($chemin) { $chemin = $chemin.Trim().Trim('"') }

if (-not $chemin) {
  # Lancement sans argument : personne n'a double-cliqué de fichier. Pas de trace
  # technique, l'utilisateur n'y est pour rien.
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

# ---------------------------------------------------------------------------------
# 2) L'éditeur : sans lui, rien n'est possible — on donne le contact support (D17).
# ---------------------------------------------------------------------------------
$codium = Get-VSCodiumExe
if (-not $codium) {
  Write-SzhTrace 'VSCodium introuvable'
  Show-SzhMessage (T 'lanceur.codium' @($SzhSupport))   # texte déjà traduit pour le lanceur
  exit 1
}

# ---------------------------------------------------------------------------------
# 3) Chemin réseau (UNC) : on ouvre quand même — lire et corriger un texte marche très
#    bien — mais WSL ne monte pas l'UNC, donc la fabrication du PDF échouerait. On le
#    dit une fois, calmement, APRÈS l'ouverture (l'éditeur est déjà là quand la boîte
#    s'affiche : le message accompagne, il ne barre pas la route).
# ---------------------------------------------------------------------------------
$estUnc = $complet.StartsWith('\\')

# ---------------------------------------------------------------------------------
# 4) La revue : remontée jusqu'à ausgabe.yaml.
# ---------------------------------------------------------------------------------
$racine = Find-SzhRacineRevue $md.Directory

if ($null -eq $racine) {
  # Hors de toute revue : un .md quelconque du disque. On ouvre le fichier SEUL (ouvrir
  # un dossier arbitraire serait pire) et on annonce la limite sans dramatiser.
  Write-SzhTrace ('hors revue : ' + $complet)
  Start-SzhCodium $codium @($complet)
  if ($estUnc) { Show-SzhMessage (T 'openmd.reseau') } else { Show-SzhMessage (T 'openmd.horsrevue') }
  exit 0
}

# Dans une revue : dossier PUIS fichier. Que le .md soit un article (articles\<slug>\<slug>.md)
# ou non (BIENVENUE.md, un .md à la racine du numéro), le geste est le même — seule la
# trace change. Cas nominal : aucun message, aucune fenêtre, rien.
$estArticle = Test-SzhArticle $md $racine.FullName
if ($estArticle) {
  Write-SzhTrace ('article {0} de la revue {1}' -f $md.BaseName, $racine.Name)
} else {
  Write-SzhTrace ('fichier {0} (hors articles) de la revue {1}' -f $md.Name, $racine.Name)
}

Start-SzhCodium $codium @($racine.FullName, $complet)

if ($estUnc) { Show-SzhMessage (T 'openmd.reseau') }
exit 0
