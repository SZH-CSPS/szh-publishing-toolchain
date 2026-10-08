# Resolution de l'ancrage SharePoint : le dossier "Daten_Allgemein - General" dont derivent
# la base des produits et le dossier des rapports d'erreur. Dot-source par szh-common.ps1,
# avant szh-produits.ps1 qui s'en sert (Get-SzhBaseRevuesPour).
# Compatibilite : Windows PowerShell 5.1.
#
# Cinq sources, de la plus forte a la plus faible (chacune rend son "origine") :
#   1. $env:SZH_ANCRAGE (essai)             4. detection automatique (auto)
#   2. config.json (config)                 5. FolderBrowserDialog (utilisateur), ou
#   3. etat-utilisateur.json (cache)           defaut/absent si rien n'aboutit
# Les quatre premieres sont dans Resolve-SzhAncrage, la cinquieme dans Initialize-SzhAncrage.
#
# Les fonctions de decision (noms, remontee des parents) n'accedent pas au disque : les
# tests les eprouvent sans arborescence.

# ---- Definition et derives ----
# Nom de l'ancrage, compare sans tenir compte de la casse.
$script:SzhNomAncrage = 'Daten_Allgemein - General'

# Nom du dossier de l'application, sous lequel se trouve toute la production : numeros,
# archives, fiches, rapports d'erreur, journaux. C'est le seul endroit du PowerShell qui
# l'ecrit ; tout le reste en derive. Son equivalent JavaScript est SEGMENT_APPLICATION
# (vscodium-extension/szh-cockpit/lib/rapport-erreur.js) : les deux changent ensemble.
# Le nom affiche de l'application est $script:SzhNomApplication (szh-shell.ps1).
$script:SzhSegmentApplication = '54_Pronto'

# Racine de la production sous la bibliotheque SharePoint, d'ou derivent les sous-dossiers
# de produits (szh-produits.ps1, $SzhSousDossiers).
$script:SzhDeriveBaseProduits = Join-Path '2_Produkte' $SzhSegmentApplication

# Dossier des rapports d'erreur automatiques. Equivalent JavaScript :
# SEGMENTS_DOSSIER_RAPPORTS (lib/rapport-erreur.js).
$script:SzhDeriveDossierRapports = Join-Path $SzhDeriveBaseProduits '_Systeme\rapports'

# Vrai si ce nom de dossier est celui de l'ancrage. Sans acces disque.
function Test-SzhNomAncrage([string]$Nom) {
  if (-not $Nom) { return $false }
  return ($Nom.Trim().ToLower() -eq $SzhNomAncrage.ToLower())
}

# Ancrage confirme : le nom attendu et un sous-dossier 2_Produkte. Un dossier qui n'a que le
# nom est un ancrage presume, accepte faute de mieux.
function Test-SzhAncrageConfirme([string]$Chemin) {
  if (-not $Chemin) { return $false }
  if (-not (Test-SzhNomAncrage (Split-Path $Chemin -Leaf))) { return $false }
  try { return (Test-Path -LiteralPath (Join-Path $Chemin '2_Produkte') -PathType Container) }
  catch { return $false }
}

# Base des produits et dossier des rapports, derives de l'ancrage. Rendent '' si l'ancrage
# est vide, plutot qu'un chemin relatif.
function Get-SzhBaseProduitsDepuisAncrage([string]$Ancrage) {
  if (-not $Ancrage) { return '' }
  return (Join-Path $Ancrage $SzhDeriveBaseProduits)
}

function Get-SzhDossierRapportsDepuisAncrage([string]$Ancrage) {
  if (-not $Ancrage) { return '' }
  return (Join-Path $Ancrage $SzhDeriveDossierRapports)
}

# Les autres sous-dossiers de "_Systeme\", toujours sur SharePoint comme les rapports, quelle
# que soit la racine active. $SousDossier : 'journaux' | 'suggestions' | 'inventaire'.
$script:SzhDeriveDossierSysteme = Join-Path $SzhDeriveBaseProduits '_Systeme'

function Get-SzhDossierSystemeDepuisAncrage([string]$Ancrage, [string]$SousDossier) {
  if (-not $Ancrage) { return '' }
  return (Join-Path (Join-Path $Ancrage $SzhDeriveDossierSysteme) $SousDossier)
}

# ---- Normalisation d'un chemin donne a la main ----

# Retire guillemets englobants et espaces, remplace "/" par "\" et retire le "\" final, sauf
# sur une racine de lecteur ("C:\"). Sans acces disque.
function Get-SzhCheminNettoye([string]$Chemin) {
  if (-not $Chemin) { return '' }
  $net = $Chemin.Trim()
  if ($net.Length -ge 2 -and $net.StartsWith('"') -and $net.EndsWith('"')) {
    $net = $net.Substring(1, $net.Length - 2).Trim()
  }
  $net = $net.Replace('/', '\')
  while ($net.Length -gt 3 -and $net.EndsWith('\') -and (-not $net.EndsWith(':\'))) {
    $net = $net.Substring(0, $net.Length - 1)
  }
  return $net
}

# Remonte les parents jusqu'au premier segment nomme comme l'ancrage ; $null sinon. Sans
# acces disque : marche sur un chemin inexistant ou UNC, et sur un chemin de fichier.
function Resolve-SzhRemonteeAncrage([string]$Chemin) {
  $courant = $Chemin
  while ($courant) {
    if (Test-SzhNomAncrage (Split-Path $courant -Leaf)) { return $courant }
    $parent = Split-Path $courant -Parent
    if ((-not $parent) -or ($parent -eq $courant)) { break }
    $courant = $parent
  }
  return $null
}

# Dossiers systeme sautes pendant une descente, pour qu'un "C:\" donne a la main n'epuise
# pas le budget de dossiers dans Windows\ ou AppData\.
$script:SzhDossiersSystemeExclus = @('windows', 'programdata', '$recycle.bin', 'appdata', 'node_modules', '.git')
function Test-SzhDossierSystemeExclu([string]$Nom) {
  if (-not $Nom) { return $false }
  $n = $Nom.ToLower()
  if ($n -like 'program files*') { return $true }
  return ($SzhDossiersSystemeExclus -contains $n)
}

# Cherche l'ancrage sous $Racine, en largeur, sur $ProfondeurMax niveaux et $MaxDossiers
# dossiers au plus. Rend $null sans lever si rien n'est trouve ou si l'enumeration echoue.
function Find-SzhAncrageParDescente {
  param(
    [Parameter(Mandatory = $true)][string]$Racine,
    [int]$ProfondeurMax = 3,
    [int]$MaxDossiers = 2000
  )
  $niveau = New-Object System.Collections.Generic.List[string]
  $niveau.Add($Racine)
  $visites = 0
  for ($profondeur = 1; $profondeur -le $ProfondeurMax; $profondeur++) {
    $suivant = New-Object System.Collections.Generic.List[string]
    foreach ($dossier in $niveau) {
      if ($visites -ge $MaxDossiers) { return $null }
      $enfants = @()
      try { $enfants = @(Get-ChildItem -LiteralPath $dossier -Directory -Force -ErrorAction Stop) }
      catch { continue }
      foreach ($enfant in $enfants) {
        if ($visites -ge $MaxDossiers) { return $null }
        $visites++
        if (Test-SzhDossierSystemeExclu $enfant.Name) { continue }
        if (Test-SzhNomAncrage $enfant.Name) { return $enfant.FullName }
        $suivant.Add($enfant.FullName)
      }
    }
    $niveau = $suivant
    if ($niveau.Count -eq 0) { break }
  }
  return $null
}

# Rend l'ancrage a partir d'un chemin donne : l'ancrage lui-meme, un dossier ou un fichier
# en dessous, une racine au-dessus, avec ou sans guillemets, "/" ou "\" final, UNC compris.
# $null si rien n'est trouve. La remontee, sans acces disque, passe d'abord : un chemin UNC
# sous l'ancrage se resout donc sans toucher le reseau. La descente, couteuse, ne part que
# d'un dossier existant.
function Resolve-SzhAncrageDepuisChemin([string]$Chemin) {
  $net = Get-SzhCheminNettoye $Chemin
  if (-not $net) { return $null }
  $remonte = Resolve-SzhRemonteeAncrage $net
  if ($remonte) { return $remonte }
  $depart = $net
  try {
    if (Test-Path -LiteralPath $net -PathType Leaf) { $depart = Split-Path $net -Parent }
  } catch { return $null }
  if (-not $depart) { return $null }
  try {
    if (-not (Test-Path -LiteralPath $depart -PathType Container)) { return $null }
  } catch { return $null }
  return (Find-SzhAncrageParDescente -Racine $depart)
}

# ---- Detection automatique ----

# Vrai pour un dossier de %USERPROFILE% a essayer : il contient "SZH" ou commence par
# "OneDrive".
function Test-SzhNomRacineCandidate([string]$Nom) {
  if (-not $Nom) { return $false }
  $n = $Nom.ToLower()
  if ($n -like '*szh*') { return $true }
  return $n.StartsWith('onedrive')
}

# Les racines candidates, dans l'ordre d'essai et sans doublon.
function Get-SzhRacinesCandidates {
  $vues = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $racines = New-Object System.Collections.Generic.List[string]
  $ajoute = {
    param($c)
    if (-not $c) { return }
    if ($vues.Add($c)) { [void]$racines.Add($c) }
  }
  if ($env:USERPROFILE) { & $ajoute (Join-Path $env:USERPROFILE 'SZH CSPS') }
  if ($env:OneDriveCommercial) { & $ajoute $env:OneDriveCommercial }
  if ($env:OneDrive) { & $ajoute $env:OneDrive }
  if ($env:USERPROFILE) { & $ajoute (Join-Path $env:USERPROFILE 'OneDrive - SZH CSPS') }
  if ($env:USERPROFILE -and (Test-Path -LiteralPath $env:USERPROFILE)) {
    try {
      $enfants = @(Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -Force -ErrorAction Stop |
        Where-Object { Test-SzhNomRacineCandidate $_.Name } | Sort-Object Name)
      foreach ($e in $enfants) { & $ajoute $e.FullName }
    } catch { }
  }
  return @($racines)
}

# Examine chaque candidate puis ses enfants sur deux niveaux. Le premier ancrage confirme
# gagne ; a defaut, le premier presume.
function Find-SzhAncrageAuto {
  $presume = $null
  foreach ($racine in (Get-SzhRacinesCandidates)) {
    if (-not (Test-Path -LiteralPath $racine -PathType Container)) { continue }
    $aExaminer = @($racine)
    for ($p = 0; $p -le 2; $p++) {
      $suivant = New-Object System.Collections.Generic.List[string]
      foreach ($dossier in $aExaminer) {
        if (Test-SzhAncrageConfirme $dossier) { return $dossier }
        if ((-not $presume) -and (Test-SzhNomAncrage (Split-Path $dossier -Leaf))) { $presume = $dossier }
        if ($p -lt 2) {
          try {
            foreach ($enfant in @(Get-ChildItem -LiteralPath $dossier -Directory -Force -ErrorAction Stop)) {
              if (Test-SzhDossierSystemeExclu $enfant.Name) { continue }
              $suivant.Add($enfant.FullName)
            }
          } catch { }
        }
      }
      $aExaminer = @($suivant)
      if ($aExaminer.Count -eq 0) { break }
    }
  }
  return $presume
}

# ---- La demande a l'utilisateur : FolderBrowserDialog, 3 tentatives ----

# Vrai si la derniere demande date de moins de 24 h : on ne redemande pas. Lit l'etat recu.
function Test-SzhDemandeRecente($Etat) {
  if (-not $Etat) { return $false }
  if (-not $Etat.PSObject.Properties['ancrageDemandeLe']) { return $false }
  $brut = [string]$Etat.ancrageDemandeLe
  if (-not $brut) { return $false }
  try {
    $date = [DateTimeOffset]::Parse($brut, [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind)
    return (((Get-Date).ToUniversalTime()) - $date.UtcDateTime) -lt (New-TimeSpan -Hours 24)
  } catch { return $false }
}

# Demande le dossier par FolderBrowserDialog, sauf en simulation. Au plus 3 tentatives, avec
# un message entre deux. Un succes ecrit ancrageSharePoint dans l'etat du compte et efface
# la date de demande. Un abandon (annulation ou 3 echecs) affiche un message et note la date
# de demande (ancrageDemandeLe).
function Request-SzhAncrageUtilisateur {
  if ($env:SZH_LANCEUR_SIMULE -eq '1') { return '' }
  try { Add-Type -AssemblyName System.Windows.Forms } catch { return '' }
  $titre = (T 'ancrage.demande.titre')
  for ($tentative = 1; $tentative -le 3; $tentative++) {
    $boite = New-Object System.Windows.Forms.FolderBrowserDialog
    $boite.Description = (T 'ancrage.demande.texte')
    $boite.ShowNewFolderButton = $false
    $boite.RootFolder = [System.Environment+SpecialFolder]::MyComputer
    $boite.SelectedPath = $env:USERPROFILE
    $resultat = $boite.ShowDialog()
    if ($resultat -ne [System.Windows.Forms.DialogResult]::OK) { break }
    $trouve = Resolve-SzhAncrageDepuisChemin $boite.SelectedPath
    if ($trouve) {
      try {
        $etat = Get-SzhEtatUtilisateur
        if (-not $etat) { $etat = New-Object psobject }
        if ($etat.PSObject.Properties['ancrageSharePoint']) { $etat.ancrageSharePoint = $trouve }
        else { $etat | Add-Member -MemberType NoteProperty -Name 'ancrageSharePoint' -Value $trouve }
        if ($etat.PSObject.Properties['ancrageDemandeLe']) { $etat.PSObject.Properties.Remove('ancrageDemandeLe') }
        Save-SzhEtatUtilisateur $etat
      } catch { }
      return $trouve
    }
    if ($tentative -lt 3) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'ancrage.demande.echec'), $titre)
    }
  }
  try {
    $etat = Get-SzhEtatUtilisateur
    if (-not $etat) { $etat = New-Object psobject }
    $horodatage = (Get-Date).ToUniversalTime().ToString('o')
    if ($etat.PSObject.Properties['ancrageDemandeLe']) { $etat.ancrageDemandeLe = $horodatage }
    else { $etat | Add-Member -MemberType NoteProperty -Name 'ancrageDemandeLe' -Value $horodatage }
    Save-SzhEtatUtilisateur $etat
  } catch { }
  try { [void][System.Windows.Forms.MessageBox]::Show((T 'ancrage.abandon' @($SzhSupport)), $titre) } catch { }
  return ''
}

# ---- Resolution passive : essai, config, cache, auto ----
# Rend { chemin; origine }, origine parmi essai|config|cache|auto|absent. N'ouvre aucune
# fenetre : Get-SzhBaseRevuesPour l'appelle, y compris depuis des scripts sans console
# (archive-revue.ps1, new-revue.ps1). La demande a l'utilisateur est dans
# Initialize-SzhAncrage, appelee une fois au demarrage du lanceur.
#
# Le resultat est memorise pour le processus : la detection automatique peut parcourir
# jusqu'a 2000 dossiers, et plusieurs fonctions appellent Get-SzhBaseRevuesPour.
# Clear-SzhAncrageMemo vide cette memoire (tests, et Initialize-SzhAncrage apres avoir ecrit
# un nouvel ancrage).
$script:SzhAncragePassifCalcule = $false
$script:SzhAncragePassifValeur = $null

function Clear-SzhAncrageMemo {
  $script:SzhAncragePassifCalcule = $false
  $script:SzhAncragePassifValeur = $null
}

function Resolve-SzhAncrage {
  if ($script:SzhAncragePassifCalcule) { return $script:SzhAncragePassifValeur }

  $resultat = $null

  if ($env:SZH_ANCRAGE) {
    $c = Resolve-SzhAncrageDepuisChemin $env:SZH_ANCRAGE
    if ($c) { $resultat = [pscustomobject]@{ chemin = $c; origine = 'essai' } }
  }

  if (-not $resultat) {
    $cfg = Get-SzhConfig
    if ($cfg -and $cfg.PSObject.Properties['ancrageSharePoint'] -and [string]$cfg.ancrageSharePoint) {
      $brutConfig = [Environment]::ExpandEnvironmentVariables([string]$cfg.ancrageSharePoint)
      $c = Resolve-SzhAncrageDepuisChemin $brutConfig
      if ($c) { $resultat = [pscustomobject]@{ chemin = $c; origine = 'config' } }
    }
  }

  if (-not $resultat) {
    # Le cache est revalide a chaque lecture : un chemin disparu (SharePoint deplace, disque
    # debranche) est ignore et retire d'etat-utilisateur.json. Le Test-Path est fait ici :
    # Resolve-SzhAncrageDepuisChemin, sans acces disque, accepterait tel quel un chemin dont
    # le dernier segment porte deja le nom de l'ancrage.
    $etat = Get-SzhEtatUtilisateur
    if ($etat -and $etat.PSObject.Properties['ancrageSharePoint'] -and [string]$etat.ancrageSharePoint) {
      $c = Resolve-SzhAncrageDepuisChemin ([string]$etat.ancrageSharePoint)
      $cExiste = $false
      if ($c) { try { $cExiste = (Test-Path -LiteralPath $c -PathType Container) } catch { $cExiste = $false } }
      if ($cExiste) { $resultat = [pscustomobject]@{ chemin = $c; origine = 'cache' } }
      else {
        try {
          $etat.PSObject.Properties.Remove('ancrageSharePoint')
          Save-SzhEtatUtilisateur $etat
          Write-SzhLog 'ancrage : cache purge (chemin disparu)'
        } catch { }
      }
    }
  }

  if (-not $resultat) {
    $auto = Find-SzhAncrageAuto
    if ($auto) { $resultat = [pscustomobject]@{ chemin = $auto; origine = 'auto' } }
  }

  if (-not $resultat) { $resultat = [pscustomobject]@{ chemin = ''; origine = 'absent' } }

  $script:SzhAncragePassifCalcule = $true
  $script:SzhAncragePassifValeur = $resultat
  return $resultat
}

# ---- Resolution complete, avec demande a l'utilisateur ----
# Seule fonction qui peut ouvrir la fenetre de selection ; le lanceur l'appelle une fois au
# demarrage. Essaie d'abord la resolution passive. Si elle echoue et qu'aucune demande n'a
# eu lieu depuis 24 h, ouvre la fenetre ; sinon rend l'origine "defaut". Un succes vide la
# memoire de Resolve-SzhAncrage, pour que la suite du processus lise le nouvel ancrage.
function Initialize-SzhAncrage {
  $passif = Resolve-SzhAncrage
  # Un ancrage detecte est enregistre dans etat-utilisateur.json : le cockpit
  # (lib/rapport-erreur.js, resoudreAncrage) ne fait pas de detection et ne lit que la
  # config puis ce cache.
  if ($passif.chemin -and $passif.origine -eq 'auto' -and $env:SZH_LANCEUR_SIMULE -ne '1') {
    try {
      $etat = Get-SzhEtatUtilisateur
      if (-not $etat) { $etat = New-Object psobject }
      if ($etat.PSObject.Properties['ancrageSharePoint']) { $etat.ancrageSharePoint = $passif.chemin }
      else { $etat | Add-Member -MemberType NoteProperty -Name 'ancrageSharePoint' -Value $passif.chemin }
      Save-SzhEtatUtilisateur $etat
    } catch { }
  }
  if ($passif.chemin) { return $passif }

  if ($env:SZH_LANCEUR_SIMULE -eq '1') { return [pscustomobject]@{ chemin = ''; origine = 'defaut' } }
  $etat = Get-SzhEtatUtilisateur
  if (Test-SzhDemandeRecente $etat) { return [pscustomobject]@{ chemin = ''; origine = 'defaut' } }

  $demande = Request-SzhAncrageUtilisateur
  if ($demande) {
    Clear-SzhAncrageMemo
    return [pscustomobject]@{ chemin = $demande; origine = 'utilisateur' }
  }
  return [pscustomobject]@{ chemin = ''; origine = 'absent' }
}
