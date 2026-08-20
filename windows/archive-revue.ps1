<#
.SYNOPSIS
  Déplace un dossier de revue entre l'arborescence « en cours » et l'arborescence
  d'archives (D116). Appelé par le cockpit (« Archiver et verrouiller » /
  « Désarchiver »), utilisable aussi à la main :

    powershell -ExecutionPolicy Bypass -File archive-revue.ps1 -Dossier "<revue>"
    powershell -ExecutionPolicy Bypass -File archive-revue.ps1 -Dossier "<revue>" -Desarchiver

.DESCRIPTION
  POURQUOI un script Windows et pas l'extension : Windows refuse de renommer un dossier
  qu'une application tient ouvert. L'extension ne peut donc pas déplacer SON PROPRE
  dossier de travail. Ce script, lancé détaché juste avant que la fenêtre de VSCodium
  ne se ferme, attend que la main soit rendue (retentatives), déplace, puis rouvre
  l'éditeur au bon endroit.

  Il est aussi le SEUL endroit qui connaisse les emplacements (Get-SzhEmplacements,
  szh-common.ps1) : le mode développeur (D119) s'applique donc sans que l'extension
  n'ait à calculer un chemin SharePoint.

  Les DRAPEAUX (locked / archived) sont écrits par le cockpit AVANT l'appel : ce script
  ne touche pas ausgabe.yaml. Un seul écrivain par fichier.

  Fenêtre VISIBLE et rassurante (D5) : déplacer plusieurs centaines de Mo en silence
  passerait pour un plantage. Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  [switch]$Desarchiver,
  [int]$AttenteSecondes = 120
)

. "$PSScriptRoot\szh-common.ps1"

# Écran d'erreur PROPRE à l'archivage, en BOÎTE DE DIALOGUE.
#
# Pas la console : ce script est lancé par le cockpit via hidden.vbs, donc sa console est
# cachée (D126 — c'est la seule façon fiable de survivre à la fermeture de la fenêtre de
# VSCodium). Un message écrit dans une console invisible, c'est exactement le symptôme
# « j'ai cliqué et rien ne s'est passé ».
# Et pas Show-SzhErreur : ses textes sont ceux de la mise à jour (« la mise à jour
# réessaiera toute seule »), or ici rien ne réessaiera. Le message dit deux choses, et
# seulement elles : ce qui a empêché le déplacement, et que la revue est intacte.
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

  # ---- 1. La revue -----------------------------------------------------------------
  if (-not (Test-Path (Join-Path $Dossier 'ausgabe.yaml'))) {
    throw (T 'arch.err.introuvable' @($Dossier))
  }
  $source = (Resolve-Path $Dossier).Path
  $nom = Split-Path $source -Leaf
  $etatRevue = Get-SzhRevueEtat $source
  if (-not $etatRevue.jeton) { throw (T 'arch.err.emplacement' @($nom)) }

  # ---- 2. La destination ------------------------------------------------------------
  $racineCible = Get-SzhEmplacementRevue $etatRevue.jeton $etatCible
  if (-not $racineCible) { throw (T 'arch.err.emplacement' @($nom)) }
  $cible = Join-Path $racineCible $nom
  if ((Test-Path $cible) -and ($cible.ToLower() -ne $source.ToLower())) {
    throw (T 'arch.err.existe' @($nom))
  }
  if ($cible.ToLower() -eq $source.ToLower()) {
    # Déjà à sa place (dossier déplacé à la main, script relancé) : rien à faire, mais
    # le raccourci et la réouverture restent utiles.
    Write-SzhOk (T 'arch.ok' @($cible))
    $deplace = $false
  } else {
    New-Item -ItemType Directory -Force -Path $racineCible | Out-Null

    # ---- 3. Les documents produits (archivage seulement) --------------------------
    # Le cockpit a déjà supprimé out/ (il prévient l'utilisateur AVANT et chiffre le
    # gain). Filet ici pour le cas où un fichier était encore verrouillé à ce
    # moment-là : c'est le gros du volume, autant ne pas le déplacer pour rien.
    # Le DÉSARCHIVAGE, lui, ne supprime rien : le dossier repart tel quel.
    if (-not $Desarchiver) {
      $out = Join-Path $source 'out'
      if (Test-Path $out) {
        try { Remove-Item $out -Recurse -Force -ErrorAction Stop } catch { }
      }
    }

    # ---- 4. Le déplacement, quand la main est rendue -------------------------------
    # Tant que la fenêtre de VSCodium n'est pas fermée, le renommage échoue. On retente
    # jusqu'à $AttenteSecondes, puis on abandonne SANS rien avoir déplacé (message
    # explicite : fermer l'éditeur et réessayer).
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

  # ---- 5. Le raccourci du dossier voyage avec lui (D14) ----------------------------
  # « Ouvrir la revue.lnk » porte le chemin ABSOLU : sans réécriture, il rouvrirait
  # l'ancien emplacement. Jamais bloquant.
  try { Set-SzhRaccourciRevue $cible | Out-Null } catch { }

  # ---- 6. Réouverture de la revue à sa nouvelle place -------------------------------
  # C'est ce qui rend le geste lisible : la revue revient sous les yeux, verrouillée
  # (ou libérée), à son nouvel emplacement.
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
