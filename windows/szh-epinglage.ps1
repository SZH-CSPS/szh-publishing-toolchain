# Épinglage hors ligne (OneDrive Files On-Demand) : marque « Toujours conserver sur cet
# appareil » les dossiers que tout le monde doit avoir sans connexion, sans geste manuel
# (demande de Robin, 24.09.2026) -- le numéro en cours de chaque revue, et la bibliothèque
# partagée _NewsUndActu. Dot-sourcé par szh-common.ps1, après szh-migration.ps1 : réutilise
# Get-SzhBaseRevuesPour, $SzhSousDossiers, $SzhNomDossierReserve (szh-produits.ps1) et
# Get-SzhConfig/Write-SzhLog (szh-common.ps1), tous déjà définis à ce point de la chaîne.
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#
# CE QUI EST ÉPINGLÉ.
#   * Chaque numéro EN COURS des revues -- un dossier directement sous `Revue\` ou
#     `Zeitschrift\` de la racine ACTIVE (test ou production, selon emplacementRevues),
#     reconnu à son `ausgabe.yaml` comme partout ailleurs dans ce dépôt. Jamais `_Archive\`,
#     jamais `Books\` : $SzhEpinglageProduits ci-dessous ne porte que 'revue' et
#     'zeitschrift' -- Robin n'a pas demandé le livre, et y ajouter 'livre' suffirait
#     ($SzhSousDossiers.livre.encours vaut déjà 'Books').
#   * La bibliothèque `_NewsUndActu\Fiches` et `_NewsUndActu\_Statuts`, toujours celle de
#     PRODUCTION (`<ancrage>\2_Produkte\54_Pronto\_NewsUndActu`, que l'onglet Archive du
#     cockpit lit toujours -- voir docs/EMPLACEMENTS.md, §1bis), PLUS celle de la racine
#     ACTIVE si elle en diffère (poste en mode test). Ciblés par NOM ('Fiches', '_Statuts'),
#     jamais par un `Get-ChildItem` sur `_NewsUndActu\` entier : `_Import-*` n'est donc
#     jamais épinglé, quel que soit ce qu'il contient.
#
# LA MÉCANIQUE, mesurée sur ce poste. Un dossier synchronisé par OneDrive porte l'attribut
# .NET ReparsePoint (0x400) ; « Toujours conserver sur cet appareil » pose en plus
# FILE_ATTRIBUTE_PINNED (0x80000), « Libérer de l'espace » pose FILE_ATTRIBUTE_UNPINNED
# (0x100000) -- deux valeurs que [System.IO.FileAttributes] ne nomme pas (ajoutées par
# Windows 10 1709 pour Files On-Demand, après l'énumération .NET), d'où les entiers bruts.
# Épingler se fait par `attrib.exe +P -U <dossier> /S /D` (%SystemRoot%\System32\attrib.exe),
# lancé en processus caché et NON attendu -- le lanceur ne doit jamais attendre un
# téléchargement OneDrive. Un dossier déjà épinglé ne demande rien : les fichiers qu'on y
# ajoutera ensuite héritent de l'épinglage de leur dossier.
#
# CE QU'ON NE FAIT JAMAIS. Bloquer le lanceur (D5) : tout est dans des try/catch, journalisé,
# jamais une fenêtre. Attendre le téléchargement d'un dossier (pas de -Wait). Épingler en
# simulation (SZH_LANCEUR_SIMULE=1) : le plan est calculé comme d'habitude, mais rien n'est
# lancé pour de vrai -- exactement le même principe que szh-ancrage.ps1 et szh-rapport.ps1
# pour ce drapeau.

# ---- Constantes ----

# Les jetons de $SzhSousDossiers (szh-produits.ps1) à épingler. 'livre' (Books) n'est PAS
# demandé -- l'ajouter à cette liste suffirait à l'inclure, sans toucher au reste de ce
# fichier.
$script:SzhEpinglageProduits = @('revue', 'zeitschrift')

# Les deux sous-dossiers de la bibliothèque à épingler, PAR NOM -- voir l'en-tête ci-dessus
# pour pourquoi jamais un balayage de `_NewsUndActu\` entier.
$script:SzhEpinglageBibliotheque = @('Fiches', '_Statuts')

# Attributs de fichier .NET pertinents pour OneDrive Files On-Demand (en-tête ci-dessus).
$script:SzhAttributReparsePoint = 0x400
$script:SzhAttributEpingle      = 0x80000

# ---- Plan : quels dossiers épingler ----
# Pure (aucune écriture, aucun lancement de processus) : deux racines en entrée, une liste de
# chemins en sortie. Les deux paramètres sont résolus tout seuls quand ils manquent (usage
# normal, depuis open-produit.ps1) ; un test les fournit explicitement, sur une arborescence
# jetable, pour ne dépendre ni du poste ni de l'ancrage SharePoint réel.
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

  # ---- Numéros EN COURS des revues, racine active seulement ----
  if ($RacineActive) {
    foreach ($produit in $script:SzhEpinglageProduits) {
      $racineProduit = Join-Path $RacineActive $SzhSousDossiers[$produit].encours
      if (-not (Test-Path -LiteralPath $racineProduit -PathType Container)) { continue }
      $enfants = @()
      try { $enfants = @(Get-ChildItem -LiteralPath $racineProduit -Directory -Force -ErrorAction Stop) } catch { $enfants = @() }
      foreach ($e in $enfants) {
        # Même définition d'un « numéro » que le reste du dépôt (docs/EMPLACEMENTS.md, §1) :
        # un dossier sans ausgabe.yaml n'en est pas un, épinglé ou non n'a pas de sens.
        if (Test-Path -LiteralPath (Join-Path $e.FullName 'ausgabe.yaml')) { [void]$dossiers.Add($e.FullName) }
      }
    }
  }

  # ---- Bibliothèque _NewsUndActu : PRODUCTION toujours, racine active EN PLUS si distincte ----
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

# Deux chemins désignent-ils le même dossier -- insensible à la casse (NTFS) et à un
# séparateur final. '' n'égale jamais rien, y compris une autre chaîne vide : deux racines
# non résolues ne doivent pas se faire passer pour « la même ».
function Test-SzhMemeChemin([string]$A, [string]$B) {
  if ((-not $A) -or (-not $B)) { return $false }
  return [string]::Equals($A.TrimEnd('\'), $B.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

# ---- Vérification d'attribut ----
# Rend 'epingle' | 'aepingler' | 'horsonedrive' | 'absent'. Jamais une exception : un dossier
# qui disparaît entre le plan et la vérification (synchronisation en cours) rend 'absent'
# comme un dossier qui n'a jamais existé.
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
# Ne lève jamais côté appelant que via son propre try (Invoke-SzhEpinglageHorsLigne) : cette
# fonction-ci peut lever (chemin de attrib.exe introuvable, Start-Process refusé), et c'est
# volontaire -- l'appelant décide seul de ce que devient l'échec (compté, journalisé).
function Start-SzhEpinglageProcessus([string]$Dossier) {
  $attribExe = Join-Path $env:SystemRoot 'System32\attrib.exe'
  if (-not (Test-Path -LiteralPath $attribExe)) { $attribExe = 'attrib.exe' }
  # +P -U : épingle et retire « en ligne seulement » ; /S /D : sous-dossiers et dossiers
  # compris, pour que le contenu déjà présent hérite tout de suite, pas seulement ce qui
  # arrivera après. Jamais -Wait : un dossier qui n'est pas encore synchronisé ne doit pas
  # faire attendre le lanceur.
  Start-Process -FilePath $attribExe -WindowStyle Hidden -ArgumentList @(
    '+P', '-U', ('"{0}"' -f $Dossier), '/S', '/D')
}

# ---- Orchestration ----
# Rend { examines; lances; deja; ignores }. $VerifAttribut et $LanceurProcessus acceptent un
# nom de fonction (chaîne) ou un scriptblock -- l'opérateur `&` sait invoquer les deux -- pour
# qu'un test remplace la vérification d'attribut et le lancement du processus sans jamais
# toucher un vrai dossier OneDrive ni lancer un vrai attrib.exe.
function Invoke-SzhEpinglageHorsLigne {
  param(
    [string[]]$Dossiers = $null,
    $VerifAttribut = 'Test-SzhDossierEpingle',
    $LanceurProcessus = 'Start-SzhEpinglageProcessus'
  )
  $vide = [pscustomobject]@{ examines = 0; lances = 0; deja = 0; ignores = 0 }

  # Réglage de désactivation : absent = actif (Resolve-SzhBooleenConfig, comme les autres
  # booléens de config.json). Testé AVANT de calculer le plan -- "false" ne doit rien lire de
  # plus que nécessaire.
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

  # Jamais un lancement réel en simulation : le plan se calcule quand même (utile au journal
  # et aux tests), mais aucun processus ne part.
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

  # Une ligne récapitulative SEULEMENT quand quelque chose a vraiment été lancé -- cette passe
  # tourne à chaque ouverture du lanceur, la plupart du temps sans rien à faire (tout est déjà
  # épinglé), et un journal qui grossirait à chaque lancement pour ne rien dire ne servirait à
  # personne.
  if ($lances -gt 0) {
    try {
      Write-SzhLog ('epinglage hors ligne : ' + $lances + ' dossier(s) marque(s) "toujours conserver", ' +
        $deja + ' deja epingle(s), ' + $ignores + ' ignore(s) sur ' + $examines + ' examine(s)')
    } catch { }
  }

  return [pscustomobject]@{ examines = $examines; lances = $lances; deja = $deja; ignores = $ignores }
}
