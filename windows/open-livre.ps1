<#
.SYNOPSIS
  Enveloppe gardee pour les anciens epinglages « Books SZH-CSPS » : aucun raccourci pose
  par l'installation ne vise plus ce script. Toute la logique vit dans open-produit.ps1,
  appele ici avec -Produit livre.

    powershell -ExecutionPolicy Bypass -File open-livre.ps1
    powershell -ExecutionPolicy Bypass -File open-livre.ps1 -Versions   # selecteur de version seul

  Compatibilite : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Ouvre directement le selecteur de version, comme le bouton « Changer de version... » du
  # cockpit.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

& (Join-Path $PSScriptRoot 'open-produit.ps1') -Produit 'livre' -Versions:$Versions
exit $LASTEXITCODE
