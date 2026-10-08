<#
.SYNOPSIS
  Point d'entree de « Pronto », lance sans console par hidden.vbs. Le raccourci du menu
  Demarrer, le protocole "szh:" (update.ps1) et le bouton « Changer de version... » du
  cockpit appellent ce script par son nom.

    powershell -ExecutionPolicy Bypass -File open-revue.ps1              # l'Accueil, dans VSCodium
    powershell -ExecutionPolicy Bypass -File open-revue.ps1 szh://...    # le numero vise
    powershell -ExecutionPolicy Bypass -File open-revue.ps1 -Versions    # selecteur de version seul

  Compatibilite : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Lien « szh://... » recu du protocole Windows : ouvre le numero vise. Positionnel, car
  # hidden.vbs remet chaque argument entre guillemets et un « %1 » ainsi quote se lie a un
  # parametre positionnel.
  [Parameter(Position = 0)][string]$Lien,
  # Encore passe par d'anciens epinglages, et ignore : l'Accueil suit le produit regle pour
  # le compte.
  [string]$Produit = '',
  # Ouvre seulement le selecteur de version.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

# Le selecteur de version sert a reparer une installation abimee : il est en WinForms et
# passe avant tout controle, sans dependre de VSCodium ni du cockpit. Il prend l'identite de
# barre des taches de la mise a jour.
if ($Versions) {
  Write-SzhLog 'open-revue : selecteur de versions demande'
  if ($env:SZH_LANCEUR_SIMULE -eq '1') {
    Write-SzhPlanJson ([ordered]@{ versions = $true; versionInstallee = (Get-SzhVersionInstallee) })
    exit 0
  }
  . "$PSScriptRoot\szh-versions.ps1"
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
  [void](Set-SzhAppUserModelId (Get-SzhAppId 'maj'))
  Show-SzhVersions $null (Join-Path $PSScriptRoot 'pronto-maj.ico')
  exit 0
}

if ($Produit) { Write-SzhLog ('open-revue : -Produit ' + $Produit + ' ignore, l''Accueil suit le reglage du compte') }

# Un lien ouvre son numero, apres les memes taches de demarrage que l'Accueil.
if ($Lien) {
  if ((-not (Get-VSCodiumExe)) -and ($env:SZH_LANCEUR_SIMULE -ne '1')) { Show-SzhCodiumAbsent; exit 1 }
  [void](Invoke-SzhTachesDemarrage)
  exit (Open-SzhLien $Lien)
}

exit (Start-SzhAccueil)
