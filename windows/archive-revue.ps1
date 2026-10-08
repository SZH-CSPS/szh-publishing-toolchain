<#
.SYNOPSIS
  Déplace un dossier de revue ou de livre entre l'arborescence « en cours » et celle des
  archives. Un livre se reconnaît à buch.yaml, une revue à ausgabe.yaml. Appelé par le
  cockpit (« Archiver et verrouiller », « Désarchiver ») ou à la main :

    powershell -ExecutionPolicy Bypass -File archive-revue.ps1 -Dossier "<revue>"
    powershell -ExecutionPolicy Bypass -File archive-revue.ps1 -Dossier "<revue>" -Desarchiver

.DESCRIPTION
  Windows refuse de renommer un dossier qu'une application tient ouvert : l'extension ne
  peut donc pas déplacer son propre dossier de travail. Le cockpit écrit les drapeaux
  locked et archived, lance ce script détaché, puis ferme VSCodium. Le script attend que le
  dossier soit libre, le déplace et rouvre l'éditeur à sa nouvelle place. Les emplacements
  viennent de Get-SzhEmplacements.

  La fenêtre reste visible : un déplacement de plusieurs centaines de Mo sans rien afficher
  passerait pour un plantage. Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  [switch]$Desarchiver,
  [int]$AttenteSecondes = 120
)

. "$PSScriptRoot\szh-common.ps1"

# Erreur en boîte de dialogue : lancé par hidden.vbs pour survivre à la fermeture de
# VSCodium, le script n'a pas de console visible. Show-SzhErreur ne convient pas : ses textes
# annoncent un nouvel essai automatique.
# Un rapport d'erreur silencieux part d'abord (docs/RAPPORTS-ERREUR.md), avec $Dossier pour
# fichier concerné.
function Show-SzhErreurArchivage([string]$Etape, [string]$Message) {
  try { Write-SzhRapport -Code 'ARCHIVAGE-ECHEC' -Source 'archivage' -Etape $Etape -Message $Message -Fichiers @($Dossier) } catch { }
  $texte = $Etape + "`n`n" + $Message + "`n`n" + (T 'err.rassure') + "`n" + (T ('arch.err.suite' + $suffixeLivre) @($SzhSupport))
  Write-Host ''
  Write-Host ('  ' + $texte)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($texte, $titreFenetre,
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
  } catch { Start-Sleep -Seconds 10 }
}

# ---- Le produit : buch.yaml prime sur ausgabe.yaml, comme dans lib/profil.js et le
# Makefile. $suffixeLivre choisit la variante « .livre » des textes arch.*.
$estLivre = Test-Path (Join-Path $Dossier 'buch.yaml')
$suffixeLivre = ''
if ($estLivre) { $suffixeLivre = '.livre' }

$etatCible = 'archive'
$titreFenetre = (T ('arch.titre' + $suffixeLivre))
if ($Desarchiver) { $etatCible = 'encours'; $titreFenetre = (T ('arch.titre.des' + $suffixeLivre)) }
try { $Host.UI.RawUI.WindowTitle = $titreFenetre } catch { }

$etape = $titreFenetre
try {
  Write-SzhBanniere $titreFenetre

  # ---- Le produit ----
  if (-not $estLivre -and -not (Test-Path (Join-Path $Dossier 'ausgabe.yaml'))) {
    throw (T 'arch.err.introuvable' @($Dossier))
  }
  $source = (Resolve-Path -LiteralPath $Dossier).Path
  $nom = Split-Path $source -Leaf
  $jeton = 'livre'
  if ($estLivre) {
    # Un livre n'a pas de jeton de produit : son jeton est « livre ».
    $etatProduit = Get-SzhLivreEtat $source
  } else {
    $etatProduit = Get-SzhRevueEtat $source
    $jeton = $etatProduit.jeton
    if (-not $jeton) { throw (T 'arch.err.emplacement' @($nom)) }
  }

  # ---- La destination ----
  $racineCible = Get-SzhEmplacementRevue $jeton $etatCible
  if (-not $racineCible) { throw (T 'arch.err.emplacement' @($nom)) }
  $cible = Join-Path $racineCible $nom
  if ((Test-Path $cible) -and ($cible.ToLower() -ne $source.ToLower())) {
    throw (T 'arch.err.existe' @($nom))
  }
  if ($cible.ToLower() -eq $source.ToLower()) {
    # Déjà à sa place (déplacé à la main, script relancé) : on refait seulement le raccourci
    # et la réouverture.
    Write-SzhOk (T ('arch.ok' + $suffixeLivre) @($cible))
    $deplace = $false
  } else {
    # -Force crée toute la chaîne de dossiers : la racine d'archives est à deux niveaux sous
    # la base (« _Archive\Revue »), celle des numéros en cours à un seul (« Revue »).
    New-Item -ItemType Directory -Force -Path $racineCible | Out-Null

    # ---- Les documents produits, à l'archivage seulement ----
    # Le cockpit a déjà supprimé out/ ; on le refait au cas où un fichier y était verrouillé,
    # car c'est le gros du volume.
    if (-not $Desarchiver) {
      $out = Join-Path $source 'out'
      if (Test-Path $out) {
        try { Remove-Item $out -Recurse -Force -ErrorAction Stop } catch { }
      }
    }

    # ---- Le déplacement, quand la main est rendue ----
    # Le renommage échoue tant que VSCodium est ouvert : on réessaie pendant $AttenteSecondes,
    # puis on abandonne sans rien avoir déplacé.
    $etape = (T 'arch.deplacement' @($racineCible))
    Write-SzhEtape (T 'arch.attente')
    $limite = (Get-Date).AddSeconds($AttenteSecondes)
    $deplace = $false
    $derniere = ''
    while (-not $deplace) {
      try {
        Move-Item -LiteralPath $source -Destination $cible -ErrorAction Stop
        $deplace = $true
      } catch {
        $derniere = $_.Exception.Message
        if ((Get-Date) -ge $limite) { break }
        Start-Sleep -Seconds 2
      }
    }
    if (-not $deplace) {
      Write-SzhLog ('archive-revue : deplacement impossible (' + $derniere + ')')
      throw (T 'arch.err.verrou' @($AttenteSecondes))
    }
    Write-SzhOk (T ('arch.ok' + $suffixeLivre) @($cible))
  }

  # ---- Le raccourci du dossier voyage avec lui ----
  # Le lien « szh:// » du raccourci vaut en cours comme aux archives ; on le réécrit quand
  # même, par précaution.
  try {
    $infoRaccourci = Get-SzhProduitInfo $jeton
    Set-SzhRaccourciRevue $cible (T $infoRaccourci.nomRaccourci) (T $infoRaccourci.descRaccourci) $jeton | Out-Null
  } catch { }

  # ---- Réouverture à sa nouvelle place ----
  Write-SzhEtape (T ('arch.rouvre' + $suffixeLivre))
  [void](Start-SzhCodium $cible)
  Write-SzhLog ('archive-revue OK : ' + $source + ' -> ' + $cible)
  Start-Sleep -Seconds 4
  exit 0

} catch {
  $message = $_.Exception.Message
  Write-SzhLog ('archive-revue ERREUR (' + $etape + ') : ' + $message)
  Show-SzhErreurArchivage $etape $message
  exit 1
}
