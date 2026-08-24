<#
.SYNOPSIS
  Crée une nouvelle revue à partir du gabarit du toolkit, sans administrateur :
    powershell -ExecutionPolicy Bypass -File new-revue.ps1 -Dossier "$env:OneDrive\Revues\2026-01"

  Copie le gabarit, pose « Ouvrir la revue.lnk » dans le dossier pour qu'il voyage avec la
  revue, et enregistre l'emplacement pour le lanceur du menu Démarrer.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  # Produit du numéro : écrit le jeton `revue:` d'ausgabe.yaml, dont découlent le nom de
  # la revue, son ISSN, sa langue par défaut et le lanceur qui l'affichera. Vide : on
  # laisse ce que dit le gabarit.
  [string]$Produit = ''
)

. "$PSScriptRoot\szh-common.ps1"

# Le produit demandé décide aussi de la langue des messages.
if ($Produit) { Set-SzhLangueProduit $Produit }
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

# Ce jeton décide dans quel lanceur le numéro apparaîtra. Sans lui, un numéro créé dans
# le dossier de la Zeitschrift garderait le « revue: revue » du gabarit et serait listé
# du mauvais côté.
if (-not $existait) {
  $jeton = Get-SzhJetonRevue $Produit
  if ($jeton) {
    if (Set-SzhAusgabeCle $chemin 'revue' $jeton $false $false) {
      Write-SzhInfo ('Numéro marqué « revue: {0} ».' -f $jeton)
    }
  }
}

# Identité déduite du nom du dossier, qui suit la convention « 2027-05 » : on en tire le
# numéro, et on vide le titre de démonstration du gabarit. Sans cela, un numéro neuf
# porterait les valeurs d'exemple, en contradiction avec le nom que montrent le lanceur,
# les liens et les archives.
#
# `date:` reste vide, et ce n'est pas un oubli : c'est la date de PUBLICATION du numéro,
# que personne ne connaît le jour où le dossier est créé. Y écrire l'année du dossier
# faisait paraître le champ rempli alors qu'il ne l'était pas — l'export OJS refuse une
# année seule, et le rédacteur ne voyait pas pourquoi. La couverture, elle, n'a pas besoin
# de cette clé : szh-maquette.lua reprend l'année du nom du dossier quand `date:` est vide.
# La vraie date se saisit dans « Métadonnées du numéro », qui a un sélecteur pour cela.
if (-not $existait) {
  $leaf = Split-Path $chemin -Leaf
  [void](Set-SzhAusgabeCle $chemin 'date' '' $true $true)
  if ($leaf -match '^(\d{4})-(\d{1,3})$') {
    $annee = $Matches[1]
    $rang = $Matches[2]
    [void](Set-SzhAusgabeCle $chemin 'numero' $rang $true $false)
    Write-SzhInfo ('Numéro identifié d''après le dossier : {0}, n° {1}.' -f $annee, $rang)
    Write-SzhInfo 'Date de publication à saisir dans « Métadonnées du numéro » : l''export OJS l''exige.'
  } else {
    [void](Set-SzhAusgabeCle $chemin 'numero' '' $true $true)
    Write-SzhInfo 'Nom de dossier hors convention (AAAA-NN) : numéro et date laissés à remplir.'
  }
  [void](Set-SzhAusgabeCle $chemin 'title' '' $true $true)
}

# Version du logiciel qui crée ce numéro : de quoi le recomposer plus tard à l'identique,
# et ce que le cockpit compare à la version installée. Posée à la création seulement.
if (-not $existait) {
  $version = Get-SzhVersionInstallee
  if (Set-SzhAusgabeVersion $chemin $version) {
    Write-SzhInfo ('Numéro estampillé « version-toolkit: {0} ».' -f $version)
  }
}

# Raccourci dans le dossier : il voyage avec la revue sur OneDrive.
if (-not (Get-VSCodiumExe)) { throw 'VSCodium introuvable — lancer d''abord bootstrap.ps1.' }
Set-SzhRaccourciRevue $chemin | Out-Null

# On n'enregistre le dossier parent que s'il est hors de l'arborescence officielle : le
# lanceur liste les emplacements de Get-SzhEmplacements, et cette clé ne sert plus qu'à
# signaler une revue restée dehors.
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
