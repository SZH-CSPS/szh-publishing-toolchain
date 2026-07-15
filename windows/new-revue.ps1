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

# Raccourci dans le dossier (voyage avec la revue sur OneDrive)
$codium = Get-VSCodiumExe
if (-not $codium) { throw 'VSCodium introuvable — lancer d''abord bootstrap.ps1.' }
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $chemin 'Ouvrir la revue.lnk'))
$lnk.TargetPath = $codium
$lnk.Arguments = ('"{0}"' -f $chemin)
$lnk.IconLocation = $codium
$lnk.Description = 'Ouvrir cette revue dans l''éditeur'
$lnk.Save()

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
  $cfg | ConvertTo-Json | Set-Content -Path $SzhConfigFile -Encoding UTF8
}

Write-SzhOk ('Revue créée : {0}' -f $chemin)
Write-SzhInfo 'Dans OneDrive : clic droit sur ce dossier -> « Toujours conserver sur cet appareil ».'
Write-SzhInfo 'Déposez les articles Word finalisés dans « articles-word », puis double-cliquez « Ouvrir la revue ».'
Write-SzhInfo 'La revue apparaît aussi dans le lanceur « Revues SZH » du menu Démarrer.'
