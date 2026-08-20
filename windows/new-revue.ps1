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
  [Parameter(Mandatory = $true)][string]$Dossier,
  # Produit du numéro (D126) : écrit le jeton `revue:` d'ausgabe.yaml, donc le nom de la
  # revue, son ISSN, sa langue par défaut (D74) ET le lanceur qui le listera. Vide =
  # on laisse ce que dit le template (rétrocompatibilité des appels en ligne).
  [string]$Produit = ''
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

# Produit (D126) : c'est CE jeton qui décide dans quel lanceur le numéro apparaîtra.
# Sans lui, un numéro créé dans le dossier de la Zeitschrift gardait le « revue: revue »
# du template et se retrouvait listé du mauvais côté — exactement le décalage constaté.
if (-not $existait) {
  $jeton = Get-SzhJetonRevue $Produit
  if ($jeton) {
    if (Set-SzhAusgabeCle $chemin 'revue' $jeton $false $false) {
      Write-SzhInfo ('Numéro marqué « revue: {0} ».' -f $jeton)
    }
  }
}

# Identité du numéro déduite du NOM DU DOSSIER (D129).
#
# Le gabarit porte des valeurs d'exemple (`numero: "2"`, `date: "2026"`, un titre de
# démonstration) et rien ne les remplaçait : un numéro neuf s'annonçait donc
# « R2026-2 | Dossier — numéro d'exemple » dans la barre du cockpit, quel que soit son
# dossier — en contradiction avec le nom que voient le lanceur, les liens et les
# archives. Or ce nom suit une convention (« 2027-05 ») : on en tire l'année et le
# numéro, et on VIDE le titre de démonstration, qui n'appartient qu'au rédacteur.
# Un nom hors convention vide aussi année et numéro : la barre retombe alors sur le nom
# du dossier, ce qui est honnête — jamais une valeur d'exemple prise pour vraie.
if (-not $existait) {
  $leaf = Split-Path $chemin -Leaf
  if ($leaf -match '^(\d{4})-(\d{1,3})$') {
    [void](Set-SzhAusgabeCle $chemin 'date' $Matches[1] $true $false)
    [void](Set-SzhAusgabeCle $chemin 'numero' $Matches[2] $true $false)
    Write-SzhInfo ('Numéro identifié d''après le dossier : {0}, n° {1}.' -f $Matches[1], $Matches[2])
  } else {
    [void](Set-SzhAusgabeCle $chemin 'date' '' $true $true)
    [void](Set-SzhAusgabeCle $chemin 'numero' '' $true $true)
    Write-SzhInfo 'Nom de dossier hors convention (AAAA-NN) : année et numéro laissés à remplir.'
  }
  [void](Set-SzhAusgabeCle $chemin 'title' '' $true $true)
}

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

# Enregistrer la racine (parent) — SEULEMENT si elle est hors de l'arborescence
# officielle (D125). Le lanceur liste les emplacements de Get-SzhEmplacements ; y
# ajouter un parent qui en fait déjà partie ne servait à rien, et enregistrer un parent
# quelconque faisait grossir une liste que le lanceur n'utilise plus pour lister — elle
# ne sert qu'à SIGNALER une revue restée dehors, ce qui est justement le cas ici.
$parent = Split-Path $chemin -Parent
$emp = Get-SzhEmplacements
$officiel = $false
foreach ($d in ($emp.encours + $emp.archives)) {
  if ($d -ieq $parent) { $officiel = $true }
}
if ($officiel) {
  Write-SzhOk ('Revue créée : {0}' -f $chemin)
  Write-SzhInfo 'Dans OneDrive : clic droit sur ce dossier -> « Toujours conserver sur cet appareil ».'
  Write-SzhInfo 'Déposez les articles Word finalisés dans « articles-word », puis double-cliquez « Ouvrir la revue ».'
  $lanceur = 'Revues SZH'
  if ((Get-SzhJetonRevue $Produit) -eq 'zeitschrift') { $lanceur = 'Zeitschriften SZH' }
  Write-SzhInfo ('Le numéro apparaît dans le lanceur « {0} » du menu Démarrer.' -f $lanceur)
  return
}
Write-SzhInfo ('Ce dossier est hors de l''arborescence officielle : le lanceur le signalera au lieu de lister la revue.')
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
