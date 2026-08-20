<#
.SYNOPSIS
  Vérification silencieuse des mises à jour, lancée par la tâche planifiée
  « SZH - Mise a jour » à la connexion et une fois par jour, via hidden.vbs, donc sans
  fenêtre. Tout à jour : une ligne de journal. Mise à jour disponible : le toolkit est mis
  à niveau d'abord, pour exécuter l'update.ps1 le plus récent, puis celui-ci s'ouvre dans
  une fenêtre visible. Erreur : journalisée, nouvel essai au prochain déclenchement.

  Compatibilité : Windows PowerShell 5.1.
#>
. "$PSScriptRoot\szh-common.ps1"

try {
  $manifest = Get-SzhManifest
  $etat = Get-SzhState
  $actuel = ''
  if ($etat -and $etat.version) { $actuel = $etat.version }

  if ($actuel -eq $manifest.version) {
    Write-SzhLog ('check : à jour ({0})' -f $actuel)
    exit 0
  }

  Write-SzhLog ('check : mise à jour {0} -> {1}' -f $actuel, $manifest.version)

  # Mettre le toolkit à niveau pour disposer du dernier update.ps1.
  New-Item -ItemType Directory -Force -Path $SzhStaging, $SzhToolkit | Out-Null
  $zip = Join-Path $SzhStaging $manifest.toolkit.file
  if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
    Get-SzhFichier -Url $manifest.toolkit.url -Destination $zip -Silencieux
    if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
      throw ('empreinte invalide pour {0}' -f $manifest.toolkit.file)
    }
  }
  Expand-Archive -Path $zip -DestinationPath $SzhToolkit -Force

  # Passer la main à la fenêtre visible.
  Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $SzhToolkit 'windows\update.ps1')
  )
  exit 0
} catch {
  Write-SzhLog ('check ERREUR : {0}' -f $_.Exception.Message)
  exit 1
}
