<#
.SYNOPSIS
  Crée un nouveau livre à partir du gabarit du toolkit, sans administrateur :
    powershell -ExecutionPolicy Bypass -File new-livre.ps1 -Dossier "$env:OneDrive\Livres\2026-B330-Nom"

  L'Accueil (lib/accueil-nouveau.js) passe en plus -Titre, -Annee, -Reference, -Type,
  -Maquette et -Format. Sans -Titre ou -Annee, ils se lisent dans le nom du dossier
  (« <année>-B<référence>-<nom> »).

  Copie le gabarit livre-template/, écrit dans buch.yaml les valeurs reçues et pose
  « Ouvrir le livre.lnk » dans le dossier.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  [string]$Titre = '',
  [int]$Annee = 0,
  # Référence B (le nombre après « B » dans le nom du dossier). Elle n'est pas écrite dans
  # buch.yaml.
  [int]$Reference = 0,
  # monographie | collectif ; vide : valeur du gabarit.
  [string]$Type = '',
  # normal | falc ; vide : valeur du gabarit.
  [string]$Maquette = '',
  # standard | a4 ; vide : valeur du gabarit. « a4 » n'existe qu'en FALC : avec la maquette
  # normale, il devient « standard », seul format que styles/livre/normal.css compose.
  [string]$Format = ''
)

. "$PSScriptRoot\szh-common.ps1"

Write-SzhTitre 'Nouveau livre'

$template = Join-Path $SzhToolkit 'livre-template'
if (-not (Test-Path (Join-Path $template 'buch.yaml'))) {
  throw ('Gabarit de livre introuvable ({0}) — lancer d''abord bootstrap.ps1 (ou update.ps1).' -f $template)
}

$existait = Test-Path (Join-Path $Dossier 'buch.yaml')
New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
if ($existait) {
  Write-SzhInfo 'Ce dossier contient déjà un livre : rien n''est écrasé, seul le raccourci est (re)créé.'
} else {
  # -Force sur Get-ChildItem pour copier aussi les fichiers cachés (.gitkeep, .gitattributes).
  Get-ChildItem -LiteralPath $template -Force | Copy-Item -Destination $Dossier -Recurse -Force
}
$chemin = (Resolve-Path -LiteralPath $Dossier).Path

# Sans -Titre ou -Annee, on lit « <année>-B<référence>-<nom> » dans le nom du dossier. Le
# <nom> sert de titre provisoire (sans accents, « _ » remplacés par des espaces), à
# corriger dans buch.yaml.
if ((-not $existait) -and ((-not $Titre) -or ($Annee -le 0))) {
  $leaf = Split-Path $chemin -Leaf
  if ($leaf -match '^(\d{4})-B(\d+)-(.+)$') {
    if ($Annee -le 0) { $Annee = [int]$Matches[1] }
    if ($Reference -le 0) { $Reference = [int]$Matches[2] }
    if (-not $Titre) { $Titre = ($Matches[3] -replace '_', ' ').Trim() }
  }
}

if (-not $existait) {
  if ($Titre) {
    # Entre guillemets : le titre est une chaîne libre.
    [void](Set-SzhAusgabeCle $chemin 'titre' $Titre $true $false 'buch.yaml')
    Write-SzhInfo ('Livre intitulé « {0} ».' -f $Titre)
  } else {
    Write-SzhInfo 'Titre inconnu : laissé vide dans buch.yaml, à saisir à la main.'
  }
  if ($Annee -gt 0) {
    # Sans guillemets : livre-assembler.py et le sed du Makefile lisent un entier.
    [void](Set-SzhAusgabeCle $chemin 'annee' ([string]$Annee) $false $false 'buch.yaml')
  }

  $typeCode = ([string]$Type).ToLower()
  if ($typeCode -ne 'collectif') { $typeCode = 'monographie' }
  if ($Type) { [void](Set-SzhAusgabeCle $chemin 'ouvrage' $typeCode $false $false 'buch.yaml') }

  $maquetteCode = ([string]$Maquette).ToLower()
  if ($maquetteCode -ne 'falc') { $maquetteCode = 'normal' }
  if ($Maquette) { [void](Set-SzhAusgabeCle $chemin 'maquette' $maquetteCode $false $false 'buch.yaml') }

  $formatCode = ([string]$Format).ToLower()
  if (($formatCode -ne 'a4') -or ($maquetteCode -ne 'falc')) { $formatCode = 'standard' }
  if ($Format) { [void](Set-SzhAusgabeCle $chemin 'format' $formatCode $false $false 'buch.yaml') }

  if (($Type -and ($typeCode -eq 'collectif')) -or (-not $Type)) {
    Write-SzhInfo 'Ouvrage collectif : les auteur·e·s se saisissent dans la fiche de chaque chapitre, pas dans buch.yaml.'
  }
}

# Version du logiciel qui crée le livre, pour pouvoir le recomposer à l'identique.
if (-not $existait) {
  $version = Get-SzhVersionInstallee
  if (Set-SzhAusgabeVersion $chemin $version 'buch.yaml') {
    Write-SzhInfo ('Livre estampillé « version-toolkit: {0} ».' -f $version)
  }
}

# Identifiant fixe du livre (`id:`), posé à la création seulement. Le raccourci et les liens
# szh:// le portent (docs/EMPLACEMENTS.md).
if (-not $existait) {
  [void](Set-SzhAusgabeIdSiAbsent $chemin 'buch.yaml')
}

# Raccourci dans le dossier, qui voyage avec le livre sur OneDrive. Il ne contient aucun
# chemin propre au poste (voir Set-SzhRaccourciRevue).
if (-not (Get-VSCodiumExe)) { throw 'VSCodium introuvable — lancer d''abord bootstrap.ps1.' }
Set-SzhRaccourciRevue $chemin (T $SzhProduits['livre'].nomRaccourci) (T $SzhProduits['livre'].descRaccourci) 'livre' | Out-Null

Write-SzhOk ('Livre créé : {0}' -f $chemin)
Write-SzhInfo 'Dans OneDrive : clic droit sur ce dossier -> « Toujours conserver sur cet appareil ».'
Write-SzhInfo 'Écrivez les chapitres dans « chapitres » (un dossier par chapitre, sur le modèle de « 01-exemple »), puis double-cliquez « Ouvrir le livre ».'
Write-SzhInfo ('Le livre apparaît dans « {0} », onglet « {1} », du menu Démarrer.' -f $SzhNomApplication, $SzhProduits['livre'].onglet)
