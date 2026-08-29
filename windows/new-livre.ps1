<#
.SYNOPSIS
  Crée un nouveau livre à partir du gabarit du toolkit, sans administrateur :
    powershell -ExecutionPolicy Bypass -File new-livre.ps1 -Dossier "$env:OneDrive\Livres\2026-B330-Nom"

  Le lanceur passe en plus -Titre, -Annee, -Reference, -Type, -Maquette et -Format : c'est
  lui qui les fait saisir (voir Read-SzhNouveauLivre dans open-livre.ps1). Sans -Titre ou
  sans -Annee, ils se relisent dans le nom du dossier (convention « <année>-B<référence>-<nom> »,
  Get-SzhNomLivre) — repli imparfait, gardé pour un appel en ligne de commande sur un
  dossier déjà nommé, comme le fait new-revue.ps1 pour l'année et le numéro.

  Copie le gabarit livre-template/, pose les clés de buch.yaml que le formulaire a fait
  saisir (titre, année, type, maquette, format), pose « Ouvrir le livre.lnk » dans le
  dossier pour qu'il voyage avec le livre.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  [string]$Titre = '',
  [int]$Annee = 0,
  # Référence B (le nombre après « B » dans le nom du dossier) : n'est écrite nulle part
  # dans buch.yaml — elle ne vit que dans le nom du dossier — mais sert au repli ci-dessous
  # quand -Titre ou -Annee manquent.
  [int]$Reference = 0,
  # monographie | collectif — vide : on laisse ce que dit le gabarit.
  [string]$Type = '',
  # normal | falc — vide : on laisse ce que dit le gabarit.
  [string]$Maquette = '',
  # standard | a4 — vide : on laisse ce que dit le gabarit. N'a de sens qu'en FALC (voir le
  # commentaire de la clé « format » dans buch.yaml) ; un « a4 » reçu avec la maquette
  # normale est ramené à « standard » plus bas, pour ne pas écrire une combinaison que
  # styles/livre/normal.css ne compose pas.
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
  Copy-Item (Join-Path $template '*') $Dossier -Recurse -Force
}
$chemin = (Resolve-Path $Dossier).Path

# Sans -Titre ni -Annee (appel en ligne de commande sur un dossier déjà nommé), on relit la
# convention « <année>-B<référence>-<nom> » du nom de dossier. Le <nom> qu'on y retrouve est
# un SLUG (accents et espaces perdus, underscores à la place) : loin d'un vrai titre, mais
# moins vide qu'un titre resté blanc — et le champ reste modifiable dans buch.yaml.
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
    # Cité : un titre est une chaîne libre, comme `title` pour un numéro de revue.
    [void](Set-SzhAusgabeCle $chemin 'titre' $Titre $true $false 'buch.yaml')
    Write-SzhInfo ('Livre intitulé « {0} ».' -f $Titre)
  } else {
    Write-SzhInfo 'Titre inconnu : laissé vide dans buch.yaml, à saisir à la main.'
  }
  if ($Annee -gt 0) {
    # Nu, comme `annee:` dans les buch.yaml réels (2025, pas "2025") : un entier lu par
    # livre-assembler.py et par le sed du Makefile, jamais entre guillemets.
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

# Version du logiciel qui crée ce livre : de quoi le recomposer plus tard à l'identique.
if (-not $existait) {
  $version = Get-SzhVersionInstallee
  if (Set-SzhAusgabeVersion $chemin $version 'buch.yaml') {
    Write-SzhInfo ('Livre estampillé « version-toolkit: {0} ».' -f $version)
  }
}

# Raccourci dans le dossier : il voyage avec le livre sur OneDrive, sur le modèle de
# « Ouvrir la revue.lnk », mais nommé et décrit pour un livre.
if (-not (Get-VSCodiumExe)) { throw 'VSCodium introuvable — lancer d''abord bootstrap.ps1.' }
Set-SzhRaccourciRevue $chemin 'Ouvrir le livre' 'Ouvrir ce livre dans l''éditeur' | Out-Null

Write-SzhOk ('Livre créé : {0}' -f $chemin)
Write-SzhInfo 'Dans OneDrive : clic droit sur ce dossier -> « Toujours conserver sur cet appareil ».'
Write-SzhInfo 'Écrivez les chapitres dans « chapitres » (un dossier par chapitre, sur le modèle de « 01-exemple »), puis double-cliquez « Ouvrir le livre ».'
Write-SzhInfo 'Le livre apparaît dans le lanceur « Books SZH-CSPS » du menu Démarrer.'
