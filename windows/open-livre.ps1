<#
.SYNOPSIS
  Lanceur du menu Demarrer « Books SZH-CSPS », appele par hidden.vbs, donc sans console.
  Enveloppe de quelques lignes : les raccourcis du menu Demarrer (Get-SzhRaccourcisMenu, dans
  le socle) visent ce script par son nom, il reste donc le point d'entree --
  toute la logique (fenetre, listes, "Nouveau livre...", selecteur de version) vit
  maintenant dans open-produit.ps1, commune aux trois produits du lanceur. Un livre n'a ni
  lien "szh://" ni choix de produit -- open-produit.ps1 est simplement appele avec
  -Produit livre.

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
