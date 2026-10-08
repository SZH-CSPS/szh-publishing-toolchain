<#
.SYNOPSIS
  Crée une nouvelle revue à partir du gabarit du toolkit, sans administrateur :
    powershell -ExecutionPolicy Bypass -File new-revue.ps1 -Dossier "$env:OneDrive\Revues\2026-01"

  L'Accueil passe en plus -Produit, -Annee, -Numero et -Volume. Sans -Annee ni -Numero, ils
  se lisent dans le nom du dossier (« AAAA-NN »).

  Copie le gabarit, écrit l'identité du numéro dans ausgabe.yaml et pose « Ouvrir la
  revue.lnk » dans le dossier. Un dossier hors de l'arborescence officielle est enregistré
  dans la configuration.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  # Produit du numéro, écrit dans la clé `revue:` d'ausgabe.yaml. Il décide du nom de la
  # revue, de son ISSN, de sa langue et de l'onglet qui l'affiche. Vide : valeur du gabarit.
  [string]$Produit = '',
  # À 0 : lus dans le nom du dossier (« AAAA-NN »).
  [int]$Annee = 0,
  [int]$Numero = 0,
  # À 0 : calculé d'après l'année (Get-SzhVolumePour).
  [int]$Volume = 0
)

. "$PSScriptRoot\szh-common.ps1"

# Les messages suivent la langue réglée pour le compte (szh-common.ps1), pas le produit.
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
  # -Force sur Get-ChildItem pour copier aussi les fichiers cachés (.gitkeep, .gitattributes).
  # L'article d'exemple et les modèles d'article Pronto restent dans le toolkit, où le
  # nettoyeur et les tests les lisent : un numéro neuf part avec « articles » vide.
  Get-ChildItem -LiteralPath $template -Force |
    Where-Object { $_.Name -ne 'articles' -and $_.Name -notlike 'Pronto - *' } |
    Copy-Item -Destination $Dossier -Recurse -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $Dossier 'articles') | Out-Null
}
$chemin = (Resolve-Path -LiteralPath $Dossier).Path

# Le jeton `revue:` décide de l'onglet où le numéro apparaît. Sans lui, un numéro de la
# Zeitschrift garderait le « revue: revue » du gabarit.
if (-not $existait) {
  $jeton = Get-SzhJetonRevue $Produit
  if ($jeton) {
    if (Set-SzhAusgabeCle $chemin 'revue' $jeton $false $false) {
      Write-SzhInfo ('Numéro marqué « revue: {0} ».' -f $jeton)
    }
  }
}

# Identité du numéro : année, numéro, volume et couleur remplacent les valeurs d'exemple du
# gabarit, et le titre est vidé.
#
# `date:` reste vide : c'est la date de publication, inconnue à la création. Elle se saisit
# dans « Métadonnées du numéro » ; l'export OJS la demande complète. La couverture prend
# l'année du nom du dossier quand `date:` est vide (szh-maquette.lua).
if (-not $existait) {
  $leaf = Split-Path $chemin -Leaf
  [void](Set-SzhAusgabeCle $chemin 'date' '' $true $true)
  # Les valeurs passées priment sur le nom du dossier.
  $annee = $Annee
  $rang = $Numero
  if (($annee -le 0) -or ($rang -le 0)) {
    if ($leaf -match '^(\d{4})-(\d{1,3})$') {
      if ($annee -le 0) { $annee = [int]$Matches[1] }
      if ($rang -le 0) { $rang = [int]$Matches[2] }
    }
  }
  # Le volume s'imprime sur la couverture et part dans OJS. Il est calculé s'il n'est pas
  # donné, et vidé si l'année manque : un champ vide se remarque, un faux volume non.
  $jetonVolume = Get-SzhJetonRevue $Produit
  if (-not $jetonVolume) {
    $deja = Get-SzhAusgabe (Join-Path $chemin 'ausgabe.yaml')
    if ($deja.ContainsKey('revue')) { $jetonVolume = Get-SzhJetonRevue $deja['revue'] }
  }
  $vol = $Volume
  if (($vol -le 0) -and ($annee -gt 0)) { $vol = Get-SzhVolumePour $jetonVolume $annee }
  if ($vol -gt 0) { [void](Set-SzhAusgabeCle $chemin 'volume' ([string]$vol) $true $false) }
  else { [void](Set-SzhAusgabeCle $chemin 'volume' '' $true $true) }
  # Couleur annuelle (Get-SzhCouleurPour). Revue ou année inconnue : la couleur du gabarit
  # reste.
  if ($annee -gt 0) {
    $couleur = Get-SzhCouleurPour $jetonVolume $annee
    if ($couleur) {
      [void](Set-SzhAusgabeCle $chemin 'couleur' $couleur $true $false)
      Write-SzhInfo ('Couleur du numéro posée : {0}.' -f $couleur)
    }
  }
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

# Version du logiciel qui crée le numéro, pour pouvoir le recomposer à l'identique. Le
# cockpit la compare à la version installée.
if (-not $existait) {
  $version = Get-SzhVersionInstallee
  if (Set-SzhAusgabeVersion $chemin $version) {
    Write-SzhInfo ('Numéro estampillé « version-toolkit: {0} ».' -f $version)
  }
}

# Identifiant fixe du numéro (`id:`), posé à la création seulement. Le raccourci et les
# liens szh:// le portent (docs/EMPLACEMENTS.md).
if (-not $existait) {
  [void](Set-SzhAusgabeIdSiAbsent $chemin)
}

# Raccourci dans le dossier, qui voyage avec la revue sur OneDrive : il vise le lanceur
# commun de C:\ProgramData et porte un lien « szh:// ». Set-SzhRaccourciRevue relit le
# produit dans ausgabe.yaml.
if (-not (Get-VSCodiumExe)) { throw 'VSCodium introuvable — lancer d''abord bootstrap.ps1.' }
Set-SzhRaccourciRevue $chemin | Out-Null

# Le dossier parent n'est enregistré (revuesRoots) que s'il est hors de l'arborescence
# officielle (Get-SzhEmplacements), pour que le lanceur signale la revue.
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
  $onglet = $SzhProduits['revue'].onglet
  if ((Get-SzhJetonRevue $Produit) -eq 'zeitschrift') { $onglet = $SzhProduits['zeitschrift'].onglet }
  Write-SzhInfo ('Le numéro apparaît dans « {0} », onglet « {1} », du menu Démarrer.' -f $SzhNomApplication, $onglet)
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
Write-SzhInfo ('La revue apparaît aussi dans « {0} », au menu Démarrer.' -f $SzhNomApplication)
