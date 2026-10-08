<#
.SYNOPSIS
  Sert les epinglages « Books SZH-CSPS » encore presents sur des postes. Ouvre « Pronto »
  par open-revue.ps1.

    powershell -ExecutionPolicy Bypass -File open-livre.ps1
    powershell -ExecutionPolicy Bypass -File open-livre.ps1 -Versions   # selecteur de version seul

  Compatibilite : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Ouvre seulement le selecteur de version.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

& (Join-Path $PSScriptRoot 'open-revue.ps1') -Versions:$Versions
exit $LASTEXITCODE
