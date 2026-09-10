# Resolution de l'ancrage SharePoint -- le dossier "Daten_Allgemein - General" dont derive
# tout le reste (base des produits, dossier des rapports d'erreur automatiques). Dot-source
# par szh-common.ps1, juste avant szh-produits.ps1 qui s'en sert (Get-SzhBaseRevuesPour).
# Compatibilite : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#
# Cinq niveaux de resolution, du plus fort au plus faible (chacun rend son "origine") :
#   1. $env:SZH_ANCRAGE (essai)             4. detection automatique (auto)
#   2. config.json (config)                 5. FolderBrowserDialog (utilisateur), ou
#   3. etat-utilisateur.json (cache)           defaut/absent si rien n'aboutit
# Voir Resolve-SzhAncrage tout en bas, qui les enchaine.
#
# Principe de decoupage : la decision (comparaison de noms, remontee des parents, choix du
# gagnant confirme/presume) est separee de l'acces disque (Test-Path, Get-ChildItem), pour
# que les tests puissent eprouver la decision sans construire une seule arborescence, et
# l'acces disque avec de vraies arborescences jetables (fs.mkdtempSync cote Node).

# ---- 2.1 Definition et derives ----
# L'ancrage porte ce nom, comparaison insensible a la casse. "_AutoReportToolboxZeitscrhiften"
# reproduit la faute de frappe REELLE du dossier existant sur SharePoint -- ne jamais la
# corriger, elle designe un vrai dossier.
$script:SzhNomAncrage = 'Daten_Allgemein - General'
$script:SzhDeriveBaseProduits = '2_Produkte'
$script:SzhDeriveDossierRapports = '2_Produkte\Edition SZH CSPS allgemein\_AutoReportToolboxZeitscrhiften'

# Nom de dossier -> est-ce l'ancrage ? Pure, aucun acces disque : c'est ce qui rend la
# remontee "gratuite" (2.4) et rend ce controle testable sans la moindre arborescence.
function Test-SzhNomAncrage([string]$Nom) {
  if (-not $Nom) { return $false }
  return ($Nom.Trim().ToLower() -eq $SzhNomAncrage.ToLower())
}

# Confirme = porte le nom attendu ET contient 2_Produkte ; sinon, si le nom seul correspond,
# c'est un ancrage presume (accepte, mais un confirme lui est toujours prefere -- 2.1).
# Seul appel disque de cette fonction : verifier 2_Produkte, une fois le nom deja reconnu.
function Test-SzhAncrageConfirme([string]$Chemin) {
  if (-not $Chemin) { return $false }
  if (-not (Test-SzhNomAncrage (Split-Path $Chemin -Leaf))) { return $false }
  try { return (Test-Path -LiteralPath (Join-Path $Chemin '2_Produkte') -PathType Container) }
  catch { return $false }
}

# Base des produits et dossier des rapports, DERIVES de l'ancrage -- jamais un chemin absolu
# en dur (D4). '' si l'ancrage est vide : un appelant qui n'a rien resolu ne doit pas se
# retrouver avec un chemin relatif ambigu.
function Get-SzhBaseProduitsDepuisAncrage([string]$Ancrage) {
  if (-not $Ancrage) { return '' }
  return (Join-Path $Ancrage $SzhDeriveBaseProduits)
}

function Get-SzhDossierRapportsDepuisAncrage([string]$Ancrage) {
  if (-not $Ancrage) { return '' }
  return (Join-Path $Ancrage $SzhDeriveDossierRapports)
}

# ---- 2.4 Normalisation d'un chemin donne a la main -- le coeur du sujet ----

# Nettoyage pur (aucun acces disque) : guillemets englobants retires, espaces de bord
# retires, "/" ramene a "\", separateur final retire -- sauf sur une racine de lecteur
# ("C:\") ou une racine UNC ("\\serveur\partage"), qui en ont besoin pour rester valides.
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

# Remontee des parents jusqu'au premier segment nomme comme l'ancrage. Pure et gratuite
# (aucun Test-Path) : Split-Path ne fait que decouper une chaine, ce qui marche aussi bien
# sur un chemin qui n'existe pas que sur un chemin UNC -- et c'est justement ce qui permet de
# l'eprouver sans reseau ni disque. S'applique tel quel a un chemin de FICHIER : son dernier
# segment (le nom du fichier) ne correspondra jamais au nom de l'ancrage, et la remontee
# continue vers son dossier parent exactement comme pour un dossier -- inutile de traiter
# le cas fichier a part.
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

# Dossiers systeme notoires a sauter pendant une descente -- quelqu'un donnera "C:\" un
# jour, et il ne faut pas y perdre les 2000 dossiers du budget dans Windows\ ou AppData\.
# Pure : ne regarde qu'un nom, jamais le disque.
$script:SzhDossiersSystemeExclus = @('windows', 'programdata', '$recycle.bin', 'appdata', 'node_modules', '.git')
function Test-SzhDossierSystemeExclu([string]$Nom) {
  if (-not $Nom) { return $false }
  $n = $Nom.ToLower()
  if ($n -like 'program files*') { return $true }
  return ($SzhDossiersSystemeExclus -contains $n)
}

# Descente en largeur (les dossiers les plus proches d'abord, pour trouver vite le cas
# courant), bornee a $ProfondeurMax niveaux SOUS $Racine et a $MaxDossiers dossiers visites
# au total. Toute exception d'enumeration (acces refuse, chemin trop long, $Racine absente)
# est avalee : la fonction rend $null, jamais une exception.
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

# La fonction centrale (2.4) : accepte l'ancrage lui-meme, un dossier enfant a n'importe
# quelle profondeur, le dossier de rapports, une racine parente, un chemin de fichier, un
# chemin entre guillemets / avec "/" / avec separateur final, un chemin UNC -- et rend
# l'ancrage, ou $null si aucun ne s'y trouve. Remontee d'abord (exacte et gratuite) ; la
# descente, couteuse, n'est tentee que si la remontee n'a rien donne, et seulement depuis un
# DOSSIER qui existe reellement -- d'ou le seul Test-Path de toute cette fonction, pose ici
# et nulle part avant, pour qu'un chemin UNC sous l'ancrage se resolve sans jamais toucher le
# reseau (voir test/js/ancrage-sharepoint.test.js).
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

# ---- 2.3 Detection automatique ----

# Nom de dossier de premier niveau de %USERPROFILE% qui merite d'etre essaye : contient
# "SZH", ou commence par "OneDrive". Pure.
function Test-SzhNomRacineCandidate([string]$Nom) {
  if (-not $Nom) { return $false }
  $n = $Nom.ToLower()
  if ($n -like '*szh*') { return $true }
  return $n.StartsWith('onedrive')
}

# Les racines candidates, dans l'ordre fixe par 2.3, dedupliquees (un meme dossier peut
# apparaitre a la fois comme candidate fixe et comme resultat du balayage du point 5).
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

# Pour chaque candidate, dans l'ordre : elle-meme (profondeur 0), puis ses enfants de
# profondeur 1, puis 2. Le premier CONFIRME rencontre gagne tout de suite (across toutes les
# candidates) ; a defaut, le premier PRESUME rencontre. Erreurs d'enumeration avalees.
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

# ---- 2.5 La demande a l'utilisateur -- FolderBrowserDialog, 3 tentatives ----

# Le marqueur anti-harcelement : moins de 24h -> on ne redemande pas. Pure (prend l'etat deja
# lu, ne relit rien) : testable avec un pscustomobject fabrique a la main.
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

# FolderBrowserDialog, jamais en simulation (D2 du lot, et l'en-tete SZH_LANCEUR_SIMULE de
# open-produit.ps1). Au plus 3 tentatives ; entre deux, un message qui dit ce qui a ete
# cherche plutot qu'un refus muet. Abandon (annulation ou 3 echecs) : MessageBox
# d'information, jamais bloquante pour la suite du lanceur (D5), et pose le marqueur
# anti-harcelement. Un succes ecrit ancrageSharePoint et efface ce marqueur.
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

# ---- 2.2 Resolution PASSIVE, quatre niveaux (essai, config, cache, auto) ----
# AMENDEMENT du 09.09.2026 (relecture) : cette fonction couvrait a l'origine les cinq
# niveaux, fenetre de selection comprise -- mais Get-SzhBaseRevuesPour l'appelle, et cet
# accesseur de chemin est lui-meme appele depuis archive-revue.ps1 et new-revue.ps1, qui
# tournent SANS CONSOLE (ils ont leur propre MessageBox d'erreur precisement pour ca) : un
# archivage aurait pu faire surgir un selecteur de dossier en plein milieu. Un accesseur de
# chemin qui ouvre une fenetre est un effet de bord inacceptable. Le niveau 5 (demande a
# l'utilisateur) vit donc desormais a part, dans Initialize-SzhAncrage plus bas -- appelee
# UNE SEULE FOIS par le lanceur a son demarrage, jamais depuis ici. Rend { chemin; origine },
# origine parmi essai|config|cache|auto|absent -- "absent" veut seulement dire "rien trouve
# par les moyens passifs", plus "on a demande pour de vrai et ca n'a rien donne" (ce dernier
# sens reste celui d'Initialize-SzhAncrage, seule habilitee a le produire par la demande).
#
# Memoisee en portee script : sans quoi Get-SzhEmplacements puis Get-SzhEmplacementRevue,
# qui rappellent chacun Get-SzhBaseRevuesPour, faisaient balayer le disque (Find-SzhAncrageAuto,
# jusqu'a 2000 dossiers) deux a trois fois par ouverture de lanceur. Clear-SzhAncrageMemo vide
# ce cache : necessaire aux tests, qui enchainent plusieurs scenarios dans le meme processus,
# et a Initialize-SzhAncrage, qui doit le vider apres avoir ecrit un nouvel ancrage -- sinon
# le reste du processus continuerait de voir "absent" alors que le cache vient d'etre ecrit.
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
    # Le cache est revalide a chaque lecture : un chemin qui n'existe plus (SharePoint
    # redemenage, disque externe debranche...) est ignore ET purge, pour ne pas le retenter
    # indefiniment ni laisser trainer une valeur morte dans etat-utilisateur.json.
    #
    # Test-Path explicite ICI, et pas seulement via Resolve-SzhAncrageDepuisChemin : sa
    # remontee (Resolve-SzhRemonteeAncrage) est volontairement PURE, sans le moindre
    # Test-Path -- gratuite, y compris sur un chemin UNC (voir la remarque au-dessus de
    # Resolve-SzhAncrageDepuisChemin). Un chemin mis en cache dont le SEGMENT FINAL porte
    # deja le nom de l'ancrage se "resolvait" donc tel quel meme apres sa disparition reelle
    # du disque (SharePoint redemenage...), et le cache n'etait alors JAMAIS purge -- defaut
    # trouve par test/js/ancrage-sharepoint.test.js. La verification reste ICI (propre au
    # niveau cache, seul niveau que la spec demande de revalider) plutot que dans la fonction
    # partagee, pour ne pas retirer aux niveaux essai/config/interactif leur resolution sans
    # acces disque superflu.
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

# ---- 2.5 (suite) : le seul point d'entree autorise a demander a l'utilisateur ----
# Appelee UNE SEULE FOIS, au demarrage du lanceur (jalon separe -- pas cette fonction-ci qui
# decide quand : c'est l'appelant). Reprend d'abord la resolution passive (memoisee, donc
# gratuite si deja calculee) ; si elle echoue, applique le garde-fou anti-harcelement de 24h
# (silencieux : "defaut"), et seulement alors ouvre la fenetre. Un succes vide la memoisation
# pour que la resolution passive suivante, dans le meme processus, relise le cache tout juste
# ecrit plutot que de rendre indefiniment "absent" pour le reste du lancement.
function Initialize-SzhAncrage {
  $passif = Resolve-SzhAncrage
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
