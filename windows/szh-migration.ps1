# Migration AUTOMATIQUE de l'arborescence, dossier de TEST seulement -- jamais SharePoint ni
# production, dont l'arbre est celui de la bibliothèque partagée et ne doit jamais être
# réarrangé par un simple poste qui se met à jour. Dot-sourcé par szh-common.ps1, après
# szh-shell.ps1 dont Invoke-SzhMigrationArborescence réutilise Set-SzhRaccourciRevue.
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#
# POURQUOI AUTOMATIQUE. outils\migrer-arborescence.ps1 (15.09.2026) exigeait un lancement à
# la main, une fois, sur les deux postes. Un poste de développement neuf, ou un poste qui
# reprend une copie ancienne du dossier de test, n'a jamais ce geste : Invoke-SzhCheckin
# vient d'apprendre qu'une collègue a des numéros de test Zeitschrift sur un poste qui ne
# passe pas forcément par une installation supervisée. update.ps1 appelle donc cette
# fonction à CHAQUE mise à jour -- idempotente, elle ne fait rien la deuxième fois.
#
# CE QU'ELLE DÉPLACE. Les mêmes six couples que l'ancien script :
#   52_Revue\RV02_Redaction        -> Revue
#   52_Revue\RV99_Archives         -> _Archive\Revue
#   53_Zeitschrift\ZS02_Redaktion  -> Zeitschrift
#   53_Zeitschrift\ZS99_Archives   -> _Archive\Zeitschrift
#   54_Buch\BU02_Redaktion         -> Books
#   54_Buch\BU01_Auflagen finale   -> _Archive\Books
# mais ENFANT PAR ENFANT (chaque numéro, chaque livre), pas le dossier entier d'un coup :
# une collègue qui a déjà un numéro « 2026-01 » des DEUX côtés (ancien ET nouveau) ne doit
# pas voir l'un écraser l'autre -- Move-Item refuse déjà d'écraser, mais le script d'origine
# refusait le déplacement ENTIER dès qu'un seul nom se recoupait, alors que tous les autres
# numéros auraient pu être sauvés. Ici, un conflit sur un nom n'empêche pas les autres.
#
# CE QU'ELLE NE FAIT JAMAIS. Écraser un fichier ou un dossier existant : un conflit laisse la
# SOURCE en place (rien n'est perdu) et se journalise -- jamais un repli silencieux, jamais
# une fusion devinée. Toucher à la racine de PRODUCTION : Invoke-SzhMigrationArborescence ne
# résout QUE l'emplacement de test, ci-dessous -- la production ne sort jamais de sa variable.

# Les six mêmes déplacements que l'ancien outils\migrer-arborescence.ps1 (recopiés et non
# importés, pour la même raison que là-bas : un script qui touche au disque doit rester
# lisible seul, sans remonter une table ailleurs).
$script:SzhMigrationMouvements = @(
  @{ de = '52_Revue\RV02_Redaction';       vers = 'Revue' }
  @{ de = '52_Revue\RV99_Archives';        vers = '_Archive\Revue' }
  @{ de = '53_Zeitschrift\ZS02_Redaktion'; vers = 'Zeitschrift' }
  @{ de = '53_Zeitschrift\ZS99_Archives';  vers = '_Archive\Zeitschrift' }
  @{ de = '54_Buch\BU02_Redaktion';        vers = 'Books' }
  @{ de = '54_Buch\BU01_Auflagen finale';  vers = '_Archive\Books' }
)

# Déplace le contenu d'un dossier source vers un dossier destination, ENFANT PAR ENFANT,
# jamais par-dessus un enfant déjà présent. Rend { deplaces; conflits } et journalise chaque
# geste. Move-Item sur un fichier OneDrive "en ligne seulement" (placeholder, reparse point)
# reste une opération NTFS de renommage tant que source et destination sont sur le même
# volume -- pas de téléchargement forcé -- mais on avale quand même toute exception : un
# fichier verrouillé par la synchronisation ne doit jamais faire tomber toute la migration.
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
      # Le raccourci se refait dans le dossier à sa place définitive, pas avant : un numéro
      # ou un livre porte buch.yaml/ausgabe.yaml, un dossier quelconque (fichier Word oublié,
      # capture d'écran) n'en porte ni l'un ni l'autre et Get-SzhJetonDossier rend '' --
      # Set-SzhRaccourciRevue s'abstient alors sans lever.
      try {
        $jetonDeplace = Get-SzhJetonDossier $cible
        if ($jetonDeplace -eq 'livre') {
          [void](Set-SzhRaccourciRevue $cible 'Ouvrir le livre' 'Ouvrir ce livre dans l''éditeur' 'livre')
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

# Pose un id manquant sur chaque numéro ou livre trouvé sous une racine donnée -- les six
# dossiers de produit, en cours et archives. Jamais un recalcul (Set-SzhAusgabeIdSiAbsent),
# et journalisé seulement quand quelque chose a vraiment été écrit (silencieux sinon : cette
# passe tourne à chaque mise à jour, la plupart du temps sans rien à faire).
function Update-SzhIdsManquants([string]$Racine) {
  $poses = 0
  foreach ($jeton in @('revue', 'zeitschrift', 'livre')) {
    $manifeste = 'ausgabe.yaml'
    if ($jeton -eq 'livre') { $manifeste = 'buch.yaml' }
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

# Supprime un dossier UNIQUEMENT s'il est réellement vide (aucun fichier, aucun sous-dossier,
# y compris cachés) -- jamais -Recurse, qui emporterait ce qu'un conflit vient de laisser en
# place. Avale toute exception : un dossier encore verrouillé par OneDrive reste, et
# réessaiera au prochain passage.
function Remove-SzhDossierSiVide([string]$Dossier) {
  if (-not (Test-Path -LiteralPath $Dossier)) { return }
  $reste = @()
  try { $reste = @(Get-ChildItem -LiteralPath $Dossier -Force -ErrorAction Stop) } catch { return }
  if ($reste.Count -gt 0) { return }
  try { Remove-Item -LiteralPath $Dossier -Force -ErrorAction Stop } catch { }
}

# Le point d'entrée, appelé par update.ps1 à chaque mise à jour -- jamais bloquant (l'appelant
# encadre déjà l'appel d'un try/catch, mais celle-ci n'en a de toute façon pas besoin : rien
# ici ne lève). Idempotente : une fois les six dossiers sources vidés et supprimés, les
# `Test-Path` suivants rendent tous faux et la fonction ne fait plus qu'un passage à vide
# (Update-SzhIdsManquants mis à part, qui continue de rattraper un id manquant si l'un
# apparaît -- un manifeste modifié à la main, par exemple).
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
    # Le parent (« 52_Revue », « 53_Zeitschrift », « 54_Buch ») peut lui aussi être vide une
    # fois ses deux enfants partis -- mais seulement s'il ne porte plus RIEN d'autre : un
    # geste humain, jamais un -Recurse, reste le seul à vider un dossier qui contiendrait
    # encore autre chose.
    Remove-SzhDossierSiVide (Split-Path $source -Parent)
  }

  # Les dossiers communs qui suivent la racine ACTIVE (voir szh-produits.ps1,
  # $SzhDossiersCommuns) : créés ici comme le fait Initialize-SzhEmplacementsTest, pour
  # qu'une migration sur un poste qui n'a jamais ouvert le lanceur en mode test les pose
  # quand même. _Systeme\ n'y figure jamais (Get-SzhDossierSysteme, toujours SharePoint).
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
