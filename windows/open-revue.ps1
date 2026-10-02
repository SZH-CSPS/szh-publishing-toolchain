<#
.SYNOPSIS
  Point d'entree de « Pronto », appele par hidden.vbs, donc sans console. Le raccourci du
  menu Demarrer (Get-SzhRaccourcisMenu), le gestionnaire du protocole "szh:" (update.ps1) et
  le bouton « Changer de version... » du cockpit visent ce script par son nom.

    powershell -ExecutionPolicy Bypass -File open-revue.ps1              # l'Accueil, dans VSCodium
    powershell -ExecutionPolicy Bypass -File open-revue.ps1 szh://...    # le numero vise
    powershell -ExecutionPolicy Bypass -File open-revue.ps1 -Versions    # selecteur de version seul

  Compatibilite : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Lien « szh://... » passe par le gestionnaire de protocole Windows : ouvre directement le
  # numero vise. Positionnel, parce que hidden.vbs requote chacun de ses arguments et qu'un
  # « %1 » requote se lie a un parametre positionnel.
  [Parameter(Position = 0)][string]$Lien,
  # Passe encore par d'anciens epinglages, et ignore : l'Accueil propose le produit du reglage
  # du compte, et une variable d'environnement n'atteint pas un VSCodium deja ouvert.
  [string]$Produit = '',
  # Ouvre directement le selecteur de version, comme le bouton « Changer de version... » du
  # cockpit.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

# Le selecteur de version, en WinForms et avant tout controle : c'est l'outil de reparation
# d'une installation abimee, il ne depend ni de VSCodium ni du cockpit. Il prend l'identite de
# la mise a jour, dont il lance une version.
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
