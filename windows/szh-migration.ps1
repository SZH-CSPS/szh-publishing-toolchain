# Migration de l'ancienne arborescence vers la nouvelle, dans le dossier de test seulement.
# L'arborescence de production, partagée sur SharePoint, n'est pas touchée. update.ps1
# l'appelle à chaque mise à jour ; une fois la migration faite, elle ne fait plus rien.
# Dot-sourcé par szh-common.ps1, après szh-shell.ps1 (Set-SzhRaccourciRevue).
# Compatibilité : Windows PowerShell 5.1.
#
# Le contenu de chaque ancien dossier est déplacé enfant par enfant (chaque numéro, chaque
# livre). Un nom déjà présent dans la cible est un conflit : la source reste en place et le
# conflit est journalisé, sans empêcher le déplacement des autres. Rien n'est écrasé.

# Ancien dossier -> nouveau dossier, relatifs à la racine de test.
$script:SzhMigrationMouvements = @(
  @{ de = '52_Revue\RV02_Redaction';       vers = 'Revue' }
  @{ de = '52_Revue\RV99_Archives';        vers = '_Archive\Revue' }
  @{ de = '53_Zeitschrift\ZS02_Redaktion'; vers = 'Zeitschrift' }
  @{ de = '53_Zeitschrift\ZS99_Archives';  vers = '_Archive\Zeitschrift' }
  @{ de = '54_Buch\BU02_Redaktion';        vers = 'Books' }
  @{ de = '54_Buch\BU01_Auflagen finale';  vers = '_Archive\Books' }
)

# Déplace le contenu de $Source dans $Destination, enfant par enfant, sans écraser un enfant
# déjà présent. Rend { deplaces; conflits }. Sur un même volume, Move-Item d'un fichier
# OneDrive « en ligne seulement » est un simple renommage, sans téléchargement. Un fichier
# verrouillé par la synchronisation compte comme conflit sans arrêter la migration.
function Move-SzhContenuDossier([string]$Source, [string]$Destination) {
  $deplaces = 0
  $conflits = 0
  if (-not (Test-Path -LiteralPath $Destination)) {
    try { New-Item -ItemType Directory -Force -Path $Destination | Out-Null }
    catch {
      try { Write-SzhLog ('migration arborescence : destination impossible a creer -> ' + $Destination + ' (' + $_.Exception.Message + ')') } catch { }
      return [pscustomobject]@{ deplaces = 0; conflits = 0 }
    }
  }
  $enfants = @()
  try { $enfants = @(Get-ChildItem -LiteralPath $Source -Force -ErrorAction Stop) } catch { $enfants = @() }
  foreach ($enfant in $enfants) {
    $cible = Join-Path $Destination $enfant.Name
    if (Test-Path -LiteralPath $cible) {
      $conflits++
      try { Write-SzhLog ('migration arborescence : conflit, source conservee -> "' + $enfant.FullName + '" (deja present dans la cible : "' + $cible + '")') } catch { }
      continue
    }
    try {
      Move-Item -LiteralPath $enfant.FullName -Destination $cible -ErrorAction Stop
      $deplaces++
      try { Write-SzhLog ('migration arborescence : deplace "' + $enfant.FullName + '" -> "' + $cible + '"') } catch { }
      # Raccourci refait dans le dossier déplacé, s'il s'agit d'un numéro ou d'un livre
      # (Get-SzhJetonDossier rend '' pour tout autre dossier).
      try {
        $jetonDeplace = Get-SzhJetonDossier $cible
        if ($jetonDeplace -eq 'livre') {
          [void](Set-SzhRaccourciRevue $cible (T $SzhProduits['livre'].nomRaccourci) (T $SzhProduits['livre'].descRaccourci) 'livre')
        } elseif ($jetonDeplace) {
          [void](Set-SzhRaccourciRevue $cible)
        }
      } catch { }
    } catch {
      $conflits++
      try { Write-SzhLog ('migration arborescence : deplacement impossible -> "' + $enfant.FullName + '" (' + $_.Exception.Message + ')') } catch { }
    }
  }
  return [pscustomobject]@{ deplaces = $deplaces; conflits = $conflits }
}

# Pose un `id:` sur chaque numéro ou livre de $Racine qui n'en a pas (en cours et archives).
# Un id existant n'est pas recalculé. Rend le nombre d'id posés ; journalise seulement ceux-là.
function Update-SzhIdsManquants([string]$Racine) {
  $poses = 0
  foreach ($jeton in @('revue', 'zeitschrift', 'livre')) {
    $manifeste = [string]$SzhProduits[$jeton].manifeste
    foreach ($etat in @('encours', 'archive')) {
      $sous = $SzhSousDossiers[$jeton][$etat]
      $dossier = Join-Path $Racine $sous
      if (-not (Test-Path -LiteralPath $dossier)) { continue }
      $enfants = @()
      try { $enfants = @(Get-ChildItem -LiteralPath $dossier -Directory -ErrorAction Stop) } catch { continue }
      foreach ($d in $enfants) {
        if (-not (Test-Path -LiteralPath (Join-Path $d.FullName $manifeste))) { continue }
        try {
          if (Set-SzhAusgabeIdSiAbsent $d.FullName $manifeste) {
            $poses++
            try { Write-SzhLog ('migration arborescence : id pose -> "' + $d.FullName + '"') } catch { }
          }
        } catch { }
      }
    }
  }
  return $poses
}

# Supprime un dossier seulement s'il est vide, fichiers cachés compris. Pas de -Recurse :
# il emporterait ce qu'un conflit a laissé en place. Un dossier verrouillé par OneDrive reste
# jusqu'au prochain passage.
function Remove-SzhDossierSiVide([string]$Dossier) {
  if (-not (Test-Path -LiteralPath $Dossier)) { return }
  $reste = @()
  try { $reste = @(Get-ChildItem -LiteralPath $Dossier -Force -ErrorAction Stop) } catch { return }
  if ($reste.Count -gt 0) { return }
  try { Remove-Item -LiteralPath $Dossier -Force -ErrorAction Stop } catch { }
}

# Point d'entrée, appelé par update.ps1 à chaque mise à jour. Ne lève pas. Une fois les
# anciens dossiers vidés et supprimés, il ne reste que la pose des id manquants.
function Invoke-SzhMigrationArborescence {
  $racine = ''
  try { $racine = Get-SzhBaseRevuesPour $SzhEmplacementTest } catch { $racine = '' }
  if (-not $racine) { return }
  if (-not (Test-Path -LiteralPath $racine -PathType Container)) { return }

  $totalDeplaces = 0
  $totalConflits = 0
  foreach ($m in $SzhMigrationMouvements) {
    $source = Join-Path $racine $m.de
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { continue }
    $destination = Join-Path $racine $m.vers
    $resultat = Move-SzhContenuDossier $source $destination
    $totalDeplaces += $resultat.deplaces
    $totalConflits += $resultat.conflits
    Remove-SzhDossierSiVide $source
    # Le parent (« 52_Revue »…) est supprimé lui aussi s'il est devenu vide.
    Remove-SzhDossierSiVide (Split-Path $source -Parent)
  }

  # Les dossiers communs ($SzhDossiersCommuns, szh-produits.ps1) sont créés comme le fait
  # Initialize-SzhEmplacementsTest, même si le lanceur n'a jamais été ouvert en mode test.
  foreach ($c in $SzhDossiersCommuns) {
    $chemin = Join-Path $racine $c
    if (-not (Test-Path -LiteralPath $chemin)) {
      try { New-Item -ItemType Directory -Force -Path $chemin | Out-Null } catch { }
    }
  }

  $idsPoses = Update-SzhIdsManquants $racine

  if (($totalDeplaces -gt 0) -or ($totalConflits -gt 0) -or ($idsPoses -gt 0)) {
    try {
      Write-SzhLog ('migration arborescence : terminee (' + $totalDeplaces + ' deplace(s), ' +
        $totalConflits + ' conflit(s) laisse(s) en place, ' + $idsPoses + ' id(s) pose(s))')
    } catch { }
  }
}
