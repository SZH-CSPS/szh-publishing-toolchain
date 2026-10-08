# Épinglage hors ligne (OneDrive Files On-Demand) : marque « Toujours conserver sur cet
# appareil » les dossiers qu'on doit avoir sans connexion. Dot-sourcé par szh-common.ps1,
# après szh-migration.ps1. Compatibilité : Windows PowerShell 5.1.
#
# Ce qui est épinglé :
#   * chaque numéro en cours, sous `Revue\` ou `Zeitschrift\` de la racine active (test ou
#     production), reconnu à son `ausgabe.yaml` ; les archives ne le sont pas ;
#   * chaque livre en cours, sous `Books\`, reconnu à son `buch.yaml` ;
#   * `_NewsUndActu\Fiches` et `_NewsUndActu\_Statuts` de la production (que l'onglet
#     Archive du cockpit lit toujours, voir docs/EMPLACEMENTS.md), et aussi ceux de la racine
#     active si elle diffère. Ils sont désignés par leur nom : `_Import-*` n'est pas épinglé.
#
# Un dossier synchronisé par OneDrive porte l'attribut ReparsePoint (0x400). « Toujours
# conserver sur cet appareil » ajoute FILE_ATTRIBUTE_PINNED (0x80000). [System.IO.FileAttributes]
# ne nomme pas cette valeur, d'où l'entier brut. L'épinglage passe par attrib.exe, lancé
# caché et sans attendre : le lanceur n'attend pas un téléchargement. Les fichiers ajoutés
# plus tard héritent de l'épinglage de leur dossier.
#
# Aucune erreur ne remonte au lanceur : tout est journalisé. En simulation
# (SZH_LANCEUR_SIMULE=1), le plan est calculé mais rien n'est lancé.

# ---- Constantes ----

# Produits à épingler et manifeste qui fait d'un dossier un numéro ou un livre.
$script:SzhEpinglageProduits = @('revue', 'zeitschrift', 'livre')
$script:SzhEpinglageManifeste = @{ revue = 'ausgabe.yaml'; zeitschrift = 'ausgabe.yaml'; livre = 'buch.yaml' }

# Sous-dossiers de _NewsUndActu à épingler.
$script:SzhEpinglageBibliotheque = @('Fiches', '_Statuts')

# Attributs OneDrive Files On-Demand (voir l'en-tête).
$script:SzhAttributReparsePoint = 0x400
$script:SzhAttributEpingle      = 0x80000

# ---- Plan : quels dossiers épingler ----
# Rend la liste des dossiers à épingler, sans rien écrire. Les deux racines se résolvent
# seules quand elles manquent ; un test les fournit pour travailler sur une arborescence
# jetable.
function Get-SzhDossiersAEpingler {
  param(
    [string]$RacineActive = '',
    [string]$RacineProduction = ''
  )
  if (-not $RacineActive) {
    try { $RacineActive = Get-SzhBaseRevuesPour (Get-SzhEmplacementRevues) } catch { $RacineActive = '' }
  }
  if (-not $RacineProduction) {
    try { $RacineProduction = Get-SzhBaseRevuesPour $SzhEmplacementProd } catch { $RacineProduction = '' }
  }

  $dossiers = New-Object System.Collections.Generic.List[string]

  # ---- Numéros et livres en cours, racine active seulement ----
  if ($RacineActive) {
    foreach ($produit in $script:SzhEpinglageProduits) {
      $racineProduit = Join-Path $RacineActive $SzhSousDossiers[$produit].encours
      if (-not (Test-Path -LiteralPath $racineProduit -PathType Container)) { continue }
      $enfants = @()
      try { $enfants = @(Get-ChildItem -LiteralPath $racineProduit -Directory -Force -ErrorAction Stop) } catch { $enfants = @() }
      foreach ($e in $enfants) {
        $manifeste = $script:SzhEpinglageManifeste[$produit]
        if (Test-Path -LiteralPath (Join-Path $e.FullName $manifeste)) { [void]$dossiers.Add($e.FullName) }
      }
    }
  }

  # ---- _NewsUndActu : production, et racine active si elle diffère ----
  $racinesBibliotheque = New-Object System.Collections.Generic.List[string]
  if ($RacineProduction) { [void]$racinesBibliotheque.Add($RacineProduction) }
  if ($RacineActive -and (-not (Test-SzhMemeChemin $RacineActive $RacineProduction))) {
    [void]$racinesBibliotheque.Add($RacineActive)
  }
  foreach ($racine in $racinesBibliotheque) {
    foreach ($sous in $script:SzhEpinglageBibliotheque) {
      $chemin = Join-Path (Join-Path $racine $SzhNomDossierReserve) $sous
      if (Test-Path -LiteralPath $chemin -PathType Container) { [void]$dossiers.Add($chemin) }
    }
  }

  return @($dossiers)
}

# Vrai si deux chemins désignent le même dossier, sans tenir compte de la casse ni d'un « \ »
# final. Une chaîne vide n'égale rien, pas même une autre chaîne vide.
function Test-SzhMemeChemin([string]$A, [string]$B) {
  if ((-not $A) -or (-not $B)) { return $false }
  return [string]::Equals($A.TrimEnd('\'), $B.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

# ---- Vérification d'attribut ----
# Rend 'epingle' | 'aepingler' | 'horsonedrive' | 'absent', sans lever. Un dossier disparu
# entre-temps (synchronisation en cours) rend 'absent'.
function Test-SzhDossierEpingle([string]$Chemin) {
  if (-not $Chemin) { return 'absent' }
  $val = 0
  try {
    if (-not (Test-Path -LiteralPath $Chemin -PathType Container)) { return 'absent' }
    $val = [int]((Get-Item -LiteralPath $Chemin -Force -ErrorAction Stop).Attributes)
  } catch { return 'absent' }
  if (-not ($val -band $script:SzhAttributReparsePoint)) { return 'horsonedrive' }
  if ($val -band $script:SzhAttributEpingle) { return 'epingle' }
  return 'aepingler'
}

# ---- Lancement réel : attrib.exe, caché, non attendu ----
# Peut lever : Invoke-SzhEpinglageHorsLigne compte et journalise l'échec.
function Start-SzhEpinglageProcessus([string]$Dossier) {
  $attribExe = Join-Path $env:SystemRoot 'System32\attrib.exe'
  if (-not (Test-Path -LiteralPath $attribExe)) { $attribExe = 'attrib.exe' }
  # +P -U : épingle et retire « en ligne seulement ». Deux appels, car
  # « attrib <dossier> /S /D » ne descend pas dans le dossier : il cherche dans l'arbre parent
  # les dossiers de même nom. D'abord le dossier lui-même (que teste Test-SzhDossierEpingle),
  # puis son contenu par « <dossier>\* /S /D ». Sans -Wait.
  Start-Process -FilePath $attribExe -WindowStyle Hidden -ArgumentList @(
    '+P', '-U', ('"{0}"' -f $Dossier))
  Start-Process -FilePath $attribExe -WindowStyle Hidden -ArgumentList @(
    '+P', '-U', ('"{0}"' -f (Join-Path $Dossier '*')), '/S', '/D')
}

# ---- Orchestration ----
# Rend { examines; lances; deja; ignores }. $VerifAttribut et $LanceurProcessus acceptent un
# nom de fonction ou un scriptblock : un test les remplace pour ne toucher ni OneDrive ni
# attrib.exe.
function Invoke-SzhEpinglageHorsLigne {
  param(
    [string[]]$Dossiers = $null,
    $VerifAttribut = 'Test-SzhDossierEpingle',
    $LanceurProcessus = 'Start-SzhEpinglageProcessus'
  )
  $vide = [pscustomobject]@{ examines = 0; lances = 0; deja = 0; ignores = 0 }

  # epinglageHorsLigne de config.json : absent vaut actif. Testé avant de calculer le plan.
  try {
    $cfg = Get-SzhConfig
    if ($cfg -and $cfg.PSObject.Properties['epinglageHorsLigne']) {
      $actif = Resolve-SzhBooleenConfig $cfg.epinglageHorsLigne
      if ($actif -eq $false) { return $vide }
    }
  } catch { }

  if ($null -eq $Dossiers) {
    try { $Dossiers = Get-SzhDossiersAEpingler } catch { $Dossiers = @() }
  }
  if (-not $Dossiers) { return $vide }

  # En simulation, le plan se calcule mais aucun processus ne part.
  $simule = ($env:SZH_LANCEUR_SIMULE -eq '1')

  $examines = 0; $lances = 0; $deja = 0; $ignores = 0
  foreach ($d in $Dossiers) {
    $examines++
    $etat = 'absent'
    try { $etat = & $VerifAttribut $d } catch { $etat = 'absent' }
    if ($etat -eq 'epingle') { $deja++; continue }
    if ($etat -ne 'aepingler') { $ignores++; continue }   # 'horsonedrive' ou 'absent'
    if ($simule) { $ignores++; continue }
    try {
      & $LanceurProcessus $d
      $lances++
    } catch {
      $ignores++
      try { Write-SzhLog ('epinglage hors ligne : lancement impossible -> "' + $d + '" (' + $_.Exception.Message + ')') } catch { }
    }
  }

  # Journalisé seulement si un épinglage a été lancé : la passe tourne à chaque ouverture et
  # n'a le plus souvent rien à faire.
  if ($lances -gt 0) {
    try {
      Write-SzhLog ('epinglage hors ligne : ' + $lances + ' dossier(s) marque(s) "toujours conserver", ' +
        $deja + ' deja epingle(s), ' + $ignores + ' ignore(s) sur ' + $examines + ' examine(s)')
    } catch { }
  }

  return [pscustomobject]@{ examines = $examines; lances = $lances; deja = $deja; ignores = $ignores }
}
