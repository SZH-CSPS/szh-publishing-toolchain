<#
.SYNOPSIS
  Déplace un dossier de revue entre l'arborescence « en cours » et celle des archives.
  Appelé par le cockpit (« Archiver et verrouiller », « Désarchiver »), utilisable aussi
  à la main :

    powershell -ExecutionPolicy Bypass -File archive-revue.ps1 -Dossier "<revue>"
    powershell -ExecutionPolicy Bypass -File archive-revue.ps1 -Dossier "<revue>" -Desarchiver

.DESCRIPTION
  Un script plutôt que l'extension, parce que Windows refuse de renommer un dossier qu'une
  application tient ouvert : l'extension ne peut pas déplacer son propre dossier de
  travail. Lancé détaché juste avant la fermeture de VSCodium, il attend que la main soit
  rendue, déplace, puis rouvre l'éditeur au bon endroit. Il est aussi le seul à connaître
  les emplacements (Get-SzhEmplacements), si bien que l'extension n'a aucun chemin
  SharePoint à calculer ; les drapeaux locked et archived sont écrits par le cockpit avant
  l'appel, un seul écrivain par fichier.

  Fenêtre visible : déplacer plusieurs centaines de Mo en silence passerait pour un
  plantage. Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  [switch]$Desarchiver,
  [int]$AttenteSecondes = 120
)

. "$PSScriptRoot\szh-common.ps1"

# En boîte de dialogue, pas en console : lancé par le cockpit via hidden.vbs, ce script a
# une console cachée, seule façon fiable de survivre à la fermeture de VSCodium. Pas
# Show-SzhErreur non plus, dont les textes annoncent un nouvel essai automatique, alors
# qu'ici rien ne réessaiera.
function Show-SzhErreurArchivage([string]$Etape, [string]$Message) {
  $texte = $Etape + "`n`n" + $Message + "`n`n" + (T 'err.rassure') + "`n" + (T 'arch.err.suite' @($SzhSupport))
  Write-Host ''
  Write-Host ('  ' + $texte)
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($texte, (T 'arch.titre'),
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
  } catch { Start-Sleep -Seconds 10 }
}

$etatCible = 'archive'
$titreFenetre = (T 'arch.titre')
if ($Desarchiver) { $etatCible = 'encours'; $titreFenetre = (T 'arch.titre.des') }
try { $Host.UI.RawUI.WindowTitle = $titreFenetre } catch { }

$etape = $titreFenetre
try {
  Write-SzhBanniere $titreFenetre

  # ---- La revue ----
  if (-not (Test-Path (Join-Path $Dossier 'ausgabe.yaml'))) {
    throw (T 'arch.err.introuvable' @($Dossier))
  }
  $source = (Resolve-Path $Dossier).Path
  $nom = Split-Path $source -Leaf
  $etatRevue = Get-SzhRevueEtat $source
  if (-not $etatRevue.jeton) { throw (T 'arch.err.emplacement' @($nom)) }

  # ---- La destination ----
  $racineCible = Get-SzhEmplacementRevue $etatRevue.jeton $etatCible
  if (-not $racineCible) { throw (T 'arch.err.emplacement' @($nom)) }
  $cible = Join-Path $racineCible $nom
  if ((Test-Path $cible) -and ($cible.ToLower() -ne $source.ToLower())) {
    throw (T 'arch.err.existe' @($nom))
  }
  if ($cible.ToLower() -eq $source.ToLower()) {
    # Déjà à sa place (dossier déplacé à la main, script relancé) : rien à déplacer, mais
    # le raccourci et la réouverture restent utiles.
    Write-SzhOk (T 'arch.ok' @($cible))
    $deplace = $false
  } else {
    New-Item -ItemType Directory -Force -Path $racineCible | Out-Null

    # ---- Les documents produits, à l'archivage seulement ----
    # Le cockpit a déjà supprimé out/ ; filet pour le cas où un fichier y était verrouillé,
    # car c'est le gros du volume. Le désarchivage ne supprime rien.
    if (-not $Desarchiver) {
      $out = Join-Path $source 'out'
      if (Test-Path $out) {
        try { Remove-Item $out -Recurse -Force -ErrorAction Stop } catch { }
      }
    }

    # ---- Le déplacement, quand la main est rendue ----
    # Tant que la fenêtre de VSCodium n'est pas fermée, le renommage échoue. On retente
    # jusqu'à $AttenteSecondes puis on abandonne sans rien avoir déplacé.
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
    Write-SzhOk (T 'arch.ok' @($cible))
  }

  # ---- Le raccourci du dossier voyage avec lui ----
  # « Ouvrir la revue.lnk » porte un chemin absolu : sans réécriture, il rouvrirait
  # l'ancien emplacement. Jamais bloquant.
  try { Set-SzhRaccourciRevue $cible | Out-Null } catch { }

  # ---- Réouverture de la revue à sa nouvelle place ----
  # C'est ce qui rend le geste lisible : la revue revient sous les yeux, à son nouvel
  # emplacement.
  Write-SzhEtape (T 'arch.rouvre')
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
