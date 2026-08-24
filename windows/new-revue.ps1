<#
.SYNOPSIS
  Crée une nouvelle revue à partir du gabarit du toolkit, sans administrateur :
    powershell -ExecutionPolicy Bypass -File new-revue.ps1 -Dossier "$env:OneDrive\Revues\2026-01"

  Le lanceur passe en plus -Annee, -Numero et -Volume : c'est lui qui les fait saisir, et le
  nom du dossier en découle. Sans eux, ils se relisent dans le nom du dossier.

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
  [string]$Produit = '',
  # Identité du numéro, telle que le lanceur l'a fait saisir : c'est d'elle que vient le nom
  # du dossier (« AAAA-NN »), et non l'inverse. À 0, elles se relisent dans le nom du
  # dossier, pour un appel en ligne de commande sur un dossier déjà nommé.
  [int]$Annee = 0,
  [int]$Numero = 0,
  # Volume annuel de la revue. À 0, il se calcule d'après l'année (Get-SzhVolumePour).
  [int]$Volume = 0
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

# Identité du numéro : année, numéro et volume, et le titre de démonstration du gabarit
# vidé. Sans cela, un numéro neuf porterait les valeurs d'exemple, en contradiction avec le
# nom que montrent le lanceur, les liens et les archives.
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
  # Les valeurs passées gagnent ; sans elles, le nom du dossier est relu.
  $annee = $Annee
  $rang = $Numero
  if (($annee -le 0) -or ($rang -le 0)) {
    if ($leaf -match '^(\d{4})-(\d{1,3})$') {
      if ($annee -le 0) { $annee = [int]$Matches[1] }
      if ($rang -le 0) { $rang = [int]$Matches[2] }
    }
  }
  # Le volume s'imprime sur la couverture et part dans OJS en <volume>. Le laisser au
  # « 44 » du gabarit étiquetait faux tous les numéros neufs, sans qu'aucun message le dise :
  # il est donc posé ici, calculé si on ne l'a pas dit, et vidé si l'année manque — un champ
  # vide se voit, un faux volume non.
  $jetonVolume = Get-SzhJetonRevue $Produit
  if (-not $jetonVolume) {
    $deja = Get-SzhAusgabe (Join-Path $chemin 'ausgabe.yaml')
    if ($deja.ContainsKey('revue')) { $jetonVolume = Get-SzhJetonRevue $deja['revue'] }
  }
  $vol = $Volume
  if (($vol -le 0) -and ($annee -gt 0)) { $vol = Get-SzhVolumePour $jetonVolume $annee }
  if ($vol -gt 0) { [void](Set-SzhAusgabeCle $chemin 'volume' ([string]$vol) $true $false) }
  else { [void](Set-SzhAusgabeCle $chemin 'volume' '' $true $true) }
  # Numéro sur deux chiffres, comme le nom du dossier et comme l'affiche OJS.
  $rangTexte = ('{0:00}' -f $rang)
  if ($rang -gt 0) { [void](Set-SzhAusgabeCle $chemin 'numero' $rangTexte $true $false) }
  else { [void](Set-SzhAusgabeCle $chemin 'numero' '' $true $true) }
  if (($annee -gt 0) -and ($rang -gt 0)) {
    Write-SzhInfo ('Numéro {0}, n° {1}, volume {2}.' -f $annee, $rangTexte, $vol)
    Write-SzhInfo 'Date de publication à saisir dans « Métadonnées du numéro » : l''export OJS l''exige.'
  } else {
    Write-SzhInfo 'Année ou numéro inconnus, et nom de dossier hors convention (AAAA-NN) : volume, numéro et date laissés à remplir.'
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
