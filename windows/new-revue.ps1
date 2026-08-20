<#
.SYNOPSIS
  Crée une nouvelle revue à partir du template du toolkit (sans admin) :
    powershell -ExecutionPolicy Bypass -File new-revue.ps1 -Dossier "$env:OneDrive\Revues\2026-01"

  - copie le template (BIENVENUE, ausgabe.yaml, articles/, articles-word/) ;
  - crée « Ouvrir la revue.lnk » DANS le dossier (D14 — il voyage avec la revue) ;
  - enregistre l'emplacement pour le lanceur « Revues SZH » du menu Démarrer.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier
)

. "$PSScriptRoot\szh-common.ps1"

Write-SzhTitre 'Nouvelle revue'

$template = Join-Path $SzhToolkit 'revue-template'
if (-not (Test-Path (Join-Path $template 'ausgabe.yaml'))) {
  throw ('Template introuvable ({0}) — lancer d''abord bootstrap.ps1 (ou update.ps1).' -f $template)
}

$existait = Test-Path (Join-Path $Dossier 'ausgabe.yaml')
New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
if ($existait) {
  Write-SzhInfo 'Ce dossier contient déjà une revue : rien n''est écrasé, seul le raccourci est (re)créé.'
} else {
  Copy-Item (Join-Path $template '*') $Dossier -Recurse -Force
}
$chemin = (Resolve-Path $Dossier).Path

# Version du logiciel qui crée ce numéro (D120) : c'est elle qui permettra, plus tard,
# de le recompiler dans les mêmes conditions — et c'est elle que le cockpit compare à
# la version installée pour avertir d'une divergence. Posée UNIQUEMENT à la création :
# une revue existante garde son estampille d'origine.
if (-not $existait) {
  $version = Get-SzhVersionInstallee
  if (Set-SzhAusgabeVersion $chemin $version) {
    Write-SzhInfo ('Numéro estampillé « version-toolkit: {0} ».' -f $version)
  }
}

# Raccourci dans le dossier (voyage avec la revue sur OneDrive, D14)
if (-not (Get-VSCodiumExe)) { throw 'VSCodium introuvable — lancer d''abord bootstrap.ps1.' }
Set-SzhRaccourciRevue $chemin | Out-Null

# Enregistrer la racine (parent) pour le lanceur « Revues SZH »
$parent = Split-Path $chemin -Parent
$cfg = Get-SzhConfig
if (-not $cfg) { $cfg = [pscustomobject]@{ repo = (Get-SzhRepo); revuesRoots = @() } }
$racines = @()
if ($cfg.revuesRoots) { $racines = @($cfg.revuesRoots) }
$connu = $false
foreach ($r in $racines) {
  if ([Environment]::ExpandEnvironmentVariables([string]$r) -ieq $parent) { $connu = $true }
}
if (-not $connu) {
  $cfg.revuesRoots = @($racines + $parent)
  Set-SzhJson $SzhConfigFile $cfg
}

Write-SzhOk ('Revue créée : {0}' -f $chemin)
Write-SzhInfo 'Dans OneDrive : clic droit sur ce dossier -> « Toujours conserver sur cet appareil ».'
Write-SzhInfo 'Déposez les articles Word finalisés dans « articles-word », puis double-cliquez « Ouvrir la revue ».'
Write-SzhInfo 'La revue apparaît aussi dans le lanceur « Revues SZH » du menu Démarrer.'
