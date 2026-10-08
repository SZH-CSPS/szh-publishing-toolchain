# Inventaire mensuel des postes (check-in) : un CSV par poste dans le dossier partagé, une
# ligne par mois et par compte Windows, mise à jour à chaque ouverture du lanceur.
# Dot-sourcé par szh-common.ps1, après szh-produits.ps1.
# Compatibilité : Windows PowerShell 5.1.
#
# Il permet de savoir quels postes existent et dans quel état, sans serveur : le dossier
# partagé sert de point de rendez-vous.
#
# Un fichier par poste, car OneDrive n'arbitre pas deux écritures simultanées d'un même
# fichier (il crée une « copie en conflit »). Le nom du fichier ne porte que le nom de la
# machine : l'identité de la personne reste dans le fichier, car un nom de fichier est
# visible de tous dans un dossier synchronisé.
#
# La ligne du mois courant est créée ou réécrite : un poste allumé une fois dans le mois a
# sa ligne, et l'horodatage donne la dernière activité.
#
# Ce fichier n'est pas un rapport d'erreur : il porte l'adresse de connexion, que les
# rapports n'ont pas le droit de contenir. Voir « L'inventaire des postes n'est pas un
# rapport d'erreur » dans docs/RAPPORTS-ERREUR.md.

# ---- 1. Où, et sous quel nom ----

# Le dossier d'inventaire, toujours sur SharePoint (Get-SzhDossierSysteme), quelle que soit
# la racine active : tous les postes, en test comme en production, écrivent au même endroit.
# Rend '' quand l'ancrage SharePoint n'est pas résolu ; Get-SzhDossierSysteme crée le dossier
# s'il manque.
function Get-SzhDossierInventaire {
  try { return (Get-SzhDossierSysteme 'inventaire') } catch { return '' }
}

# Le nom du poste : %COMPUTERNAME%, vide dans certains contextes de service, puis le nom
# d'hôte, puis 'POSTE-INCONNU'.
function Get-SzhNomPoste {
  $nom = ([string]$env:COMPUTERNAME).Trim()
  if (-not $nom) { try { $nom = ([string][System.Net.Dns]::GetHostName()).Trim() } catch { $nom = '' } }
  if (-not $nom) { $nom = 'POSTE-INCONNU' }
  return $nom
}

# « RMO-DESK » -> « RMO-DESK.csv ». Les caractères interdits dans un nom de fichier sont
# remplacés par un tiret.
function Get-SzhCheckinNomFichier([string]$Poste) {
  $interdits = [System.IO.Path]::GetInvalidFileNameChars()
  $net = ''
  foreach ($c in ([string]$Poste).ToCharArray()) {
    if ($interdits -contains $c) { $net += '-' } else { $net += $c }
  }
  $net = $net.Trim()
  if (-not $net) { $net = 'POSTE-INCONNU' }
  return ($net + '.csv')
}

# ---- 2. L'adresse de connexion ----

# Trois sources, dans l'ordre, sans droits administrateur ; chacune passe à la suivante en
# cas d'échec :
#
#   1. `UserEmail` des comptes professionnels OneDrive
#      (HKCU\Software\Microsoft\OneDrive\Accounts\Business*), le compte qui synchronise la
#      bibliothèque. Le premier qui répond, dans l'ordre des noms de clé ;
#   2. `whoami.exe /upn`, qui rend le nom de connexion d'un poste du domaine ;
#   3. chaîne vide. Le dossier personnel suffit alors à identifier la personne.
#
# Ne lève pas : un poste sans adresse produit une ligne complète. $ErrorActionPreference est
# mis à 'Continue' autour de whoami.exe : sous 'Stop', PowerShell 5.1 ferait de sa sortie
# d'erreur une exception. Invoke-SzhNatif n'est pas utilisé, pour que le test puisse extraire
# la fonction seule.
function Get-SzhAdresseConnexion {
  $racine = 'HKCU:\Software\Microsoft\OneDrive\Accounts'
  try {
    if (Test-Path -LiteralPath $racine) {
      $comptes = @(Get-ChildItem -LiteralPath $racine -ErrorAction Stop |
        Where-Object { $_.PSChildName -like 'Business*' } | Sort-Object PSChildName)
      foreach ($compte in $comptes) {
        $valeur = ''
        try {
          $valeur = ([string](Get-ItemProperty -LiteralPath $compte.PSPath -Name 'UserEmail' -ErrorAction Stop).UserEmail).Trim()
        } catch { $valeur = '' }
        if ($valeur -and $valeur.Contains('@')) { return $valeur }
      }
    }
  } catch { }

  $ancien = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $exe = Join-Path $env:WINDIR 'System32\whoami.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { $exe = 'whoami.exe' }
    $global:LASTEXITCODE = 0
    $lignes = @(& $exe '/upn' 2>$null)
    if ($LASTEXITCODE -eq 0) {
      foreach ($l in $lignes) {
        $t = ([string]$l).Trim()
        # Un nom de connexion contient « @ » et pas d'espace : cela écarte le « ERREUR : … »
        # qu'un poste hors domaine écrit parfois sur la sortie standard.
        if ($t -and $t.Contains('@') -and ($t -notmatch '\s')) { return $t }
      }
    }
  } catch { } finally { $ErrorActionPreference = $ancien }

  return ''
}

# ---- 3. Les colonnes, et les faits qu'elles portent ----

# Les deux colonnes qui identifient une ligne : mois et compte. Deux comptes du même poste
# ont chacun leur ligne.
$script:SzhCheckinCleMois = 'Mois'
$script:SzhCheckinCleCompte = 'Compte Windows'

# L'en-tête du CSV, dans l'ordre, en français et non traduit (le fichier se lit dans un
# tableur). Une colonne ajoutée ici apparaît dans les fichiers existants au check-in suivant,
# vide pour les lignes anciennes.
$script:SzhCheckinColonnes = @(
  'Horodatage',
  $SzhCheckinCleMois,
  'Poste',
  $SzhCheckinCleCompte,
  'SID du compte',
  'Dossier personnel',
  'Adresse de connexion',
  'Système',
  'PowerShell',
  'Version du toolkit',
  'Version du cockpit',
  'Version de l''éditeur',
  'Machine virtuelle',
  'Version du disque virtuel',
  'Langue de l''interface',
  'Emplacement',
  'Origine de l''ancrage',
  'Place libre (Go)'
)

# Le système : ProductName, DisplayVersion et numéro de version. ProductName indique
# « Windows 10 » même sur Windows 11 : le numéro de build tranche.
function Get-SzhVersionSysteme {
  $morceaux = New-Object System.Collections.ArrayList
  try {
    $k = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
    $nom = ([string]$k.ProductName).Trim()
    if ($nom) { [void]$morceaux.Add($nom) }
    $affichee = ([string]$k.DisplayVersion).Trim()
    if ($affichee) { [void]$morceaux.Add($affichee) }
  } catch { }
  try { [void]$morceaux.Add(([string][Environment]::OSVersion.Version).Trim()) } catch { }
  return (($morceaux | Where-Object { $_ }) -join ' ')
}

# La version du cockpit installée pour ce compte, lue dans son package.json : la CLI de
# l'éditeur ralentirait l'ouverture du lanceur.
function Get-SzhVersionCockpit {
  $dossier = ''
  try { $dossier = Get-SzhDossierCockpit } catch { return '' }
  if (-not $dossier) { return '' }
  try {
    $pkg = Get-Content -LiteralPath (Join-Path $dossier 'package.json') -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
    return ([string]$pkg.version).Trim()
  } catch { return '' }
}

# La version de l'éditeur : celle du fichier sur le disque, sans lancer quoi que ce soit.
function Get-SzhVersionEditeur {
  $exe = ''
  try { $exe = Get-VSCodiumExe } catch { return '' }
  if (-not $exe) { return '' }
  try { return ([string](Get-Item -LiteralPath $exe).VersionInfo.ProductVersion).Trim() } catch { return '' }
}

# 'enregistree' ou 'absente' pour ce compte, sans démarrer la distribution. Valeurs fixes,
# non traduites, pour le tri dans un tableur.
function Get-SzhEtatMachineVirtuelle {
  try {
    if ((Get-SzhDistrosEnregistrees) -contains $SzhDistro) { return 'enregistree' }
    return 'absente'
  } catch { return '' }
}

# La version du disque de la distribution : l'état du compte, puis l'état du poste en
# repli, comme diagnostic.ps1.
function Get-SzhVersionDisqueVirtuel {
  try {
    $pose = Get-SzhEtatUtilisateurChamp (Get-SzhEtatUtilisateur) 'rootfs'
    if ($pose) { return $pose }
    $etat = Get-SzhState
    if ($etat -and $etat.rootfs) { return ([string]$etat.rootfs).Trim() }
  } catch { }
  return ''
}

# Les faits du poste, dans l'ordre des colonnes, sans rien écrire. Une mesure ratée laisse
# une case vide. $OrigineAncrage est celle de la résolution faite par l'appelant
# (Invoke-SzhTachesDemarrage, szh-shell.ps1).
function Get-SzhCheckinFaits {
  param([string]$OrigineAncrage = '')

  $maintenant = Get-Date
  $identite = @{ nom = ''; sid = '' }
  try { $identite = Get-SzhIdentite } catch { }

  $place = -1
  try { $place = Get-SzhEspaceLibreGo } catch { $place = -1 }
  $placeTexte = ''
  # Point décimal invariant : une virgule pourrait se confondre avec un séparateur.
  if ($place -ge 0) { $placeTexte = ([string]([double]$place).ToString([Globalization.CultureInfo]::InvariantCulture)) }

  $emplacement = ''
  try { $emplacement = Get-SzhEmplacementRevues } catch { }

  $faits = [ordered]@{}
  $faits['Horodatage'] = $maintenant.ToString('yyyy-MM-dd HH:mm:ss')
  $faits[$SzhCheckinCleMois] = $maintenant.ToString('yyyy-MM')
  $faits['Poste'] = (Get-SzhNomPoste)
  $faits[$SzhCheckinCleCompte] = [string]$identite.nom
  $faits['SID du compte'] = [string]$identite.sid
  $faits['Dossier personnel'] = [string]$env:USERPROFILE
  $faits['Adresse de connexion'] = (Get-SzhAdresseConnexion)
  $faits['Système'] = (Get-SzhVersionSysteme)
  $faits['PowerShell'] = ''
  try { $faits['PowerShell'] = [string]$PSVersionTable.PSVersion } catch { }
  $faits['Version du toolkit'] = ''
  try { $faits['Version du toolkit'] = Get-SzhVersionInstallee } catch { }
  $faits['Version du cockpit'] = (Get-SzhVersionCockpit)
  $faits['Version de l''éditeur'] = (Get-SzhVersionEditeur)
  $faits['Machine virtuelle'] = (Get-SzhEtatMachineVirtuelle)
  $faits['Version du disque virtuel'] = (Get-SzhVersionDisqueVirtuel)
  $faits['Langue de l''interface'] = [string]$SzhLangue
  $faits['Emplacement'] = [string]$emplacement
  $faits['Origine de l''ancrage'] = [string]$OrigineAncrage
  $faits['Place libre (Go)'] = $placeTexte
  return $faits
}

# ---- 4. Le CSV : lecture, fusion, écriture ----

# Une valeur de colonne, pour un objet d'Import-Csv ou une table de hachage. '' si la
# colonne manque (fichier écrit par une version antérieure).
function Get-SzhCheckinValeur($Ligne, [string]$Colonne) {
  if (-not $Ligne) { return '' }
  try {
    if ($Ligne -is [System.Collections.IDictionary]) {
      if ($Ligne.Contains($Colonne)) { return [string]$Ligne[$Colonne] }
      return ''
    }
    $p = $Ligne.PSObject.Properties[$Colonne]
    if ($p) { return [string]$p.Value }
  } catch { }
  return ''
}

# Un champ tient sur une ligne : retours chariot et tabulations deviennent des espaces, pour
# la lisibilité dans un tableur.
function ConvertTo-SzhCheckinTexte($Valeur) {
  if ($null -eq $Valeur) { return '' }
  $t = [string]$Valeur
  $t = $t -replace "`r`n", ' '
  $t = $t -replace "[`r`n`t]", ' '
  return $t.Trim()
}

# Une ligne ramenée à l'en-tête complet : toutes les colonnes, dans l'ordre, les absentes
# vides. Export-Csv ne lit les colonnes que sur le premier objet : une ligne ancienne non
# complétée tronquerait tout le fichier.
function ConvertTo-SzhCheckinLigne($Ligne, $Colonnes) {
  $ordonnee = [ordered]@{}
  foreach ($c in $Colonnes) { $ordonnee[$c] = (ConvertTo-SzhCheckinTexte (Get-SzhCheckinValeur $Ligne $c)) }
  return [pscustomobject]$ordonnee
}

# Fusionne la ligne du jour dans les lignes existantes, sans effet de bord. La ligne de même
# mois et même compte est remplacée à sa place (l'ordre chronologique reste) ; sinon la
# nouvelle s'ajoute à la fin. Toutes ressortent complétées.
# $CleMois et $CleCompte sont passées en paramètre pour que le test puisse extraire la
# fonction seule.
function Merge-SzhCheckinLignes($Lignes, $Nouvelle, $Colonnes, [string]$CleMois, [string]$CleCompte) {
  $moisVise = (ConvertTo-SzhCheckinTexte (Get-SzhCheckinValeur $Nouvelle $CleMois))
  $compteVise = (ConvertTo-SzhCheckinTexte (Get-SzhCheckinValeur $Nouvelle $CleCompte))
  $ligneNeuve = ConvertTo-SzhCheckinLigne $Nouvelle $Colonnes

  $sortie = New-Object System.Collections.ArrayList
  $remplacee = $false
  foreach ($l in @($Lignes)) {
    if (-not $l) { continue }
    $mois = (ConvertTo-SzhCheckinTexte (Get-SzhCheckinValeur $l $CleMois))
    $compte = (ConvertTo-SzhCheckinTexte (Get-SzhCheckinValeur $l $CleCompte))
    # Compte comparé sans la casse, comme Windows (« SZH\rmo » = « szh\RMO »).
    if ((-not $remplacee) -and ($mois -eq $moisVise) -and ($compte.ToLower() -eq $compteVise.ToLower())) {
      [void]$sortie.Add($ligneNeuve)
      $remplacee = $true
      continue
    }
    [void]$sortie.Add((ConvertTo-SzhCheckinLigne $l $Colonnes))
  }
  if (-not $remplacee) { [void]$sortie.Add($ligneNeuve) }
  return ,@($sortie)
}

# Les lignes du fichier. Rend @() si le fichier n'existe pas encore, et $null s'il existe
# mais ne se lit pas (fichier OneDrive pas encore téléchargé, contenu abîmé) : l'appelant
# abandonne alors plutôt que d'écraser l'historique.
#
# `return ,@(...)` : PowerShell déroule un tableau rendu par une fonction, et un tableau vide
# arriverait sous la forme de $null, confondu avec « illisible ». La virgule l'empêche.
function Read-SzhCheckinCsv([string]$Fichier) {
  try { if (-not (Test-Path -LiteralPath $Fichier -PathType Leaf)) { return ,@() } } catch { return $null }
  try { return ,@(Import-Csv -LiteralPath $Fichier -Delimiter ';' -Encoding UTF8 -ErrorAction Stop) }
  catch { return $null }
}

# Écriture atomique adaptée à OneDrive, comme Write-SzhRapportSurDisque (szh-rapport.ps1) et
# ecrireAtomique (lib/yaml.js) :
#
#   * fichier temporaire dans le dossier de la cible : un renommage n'est atomique que sur un
#     même volume ;
#   * préfixe « ~$ », que OneDrive ne synchronise pas ;
#   * le finally supprime le temporaire même en cas d'échec.
#
# UTF-8 avec BOM et séparateur point-virgule : un tableur suisse ouvre ainsi le fichier d'un
# double-clic. -Encoding UTF8 de PowerShell 5.1 pose le BOM ; -NoTypeInformation retire la
# ligne « #TYPE ».
function Write-SzhCheckinCsv {
  param([string]$Fichier, $Lignes)

  $dossier = Split-Path $Fichier -Parent
  New-Item -ItemType Directory -Force -Path $dossier -ErrorAction Stop | Out-Null
  $tmp = Join-Path $dossier ('~$' + (Split-Path $Fichier -Leaf) + '.' + $PID + '.' +
    ([guid]::NewGuid().ToString('N').Substring(0, 8)))
  try {
    @($Lignes) | Export-Csv -LiteralPath $tmp -Delimiter ';' -NoTypeInformation -Encoding UTF8 -ErrorAction Stop
    Move-Item -LiteralPath $tmp -Destination $Fichier -Force -ErrorAction Stop
  } finally {
    try { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } } catch { }
  }
}

# ---- 5. Le check-in lui-même ----

# Appelé une fois par lancement (Invoke-SzhTachesDemarrage), après la résolution de
# l'ancrage. Rend $true si une ligne a été écrite, $false sinon, sans lever : un dossier
# partagé injoignable laisse seulement une ligne de journal.
#
# Un mutex de poste, distinct de celui des mises à jour, sérialise les comptes Windows d'un
# même poste, qui écrivent dans le même fichier. L'attente est bornée à 5 secondes : au-delà,
# le check-in est abandonné.
#
# AbandonedMutexException (processus mort en tenant le mutex) vaut prise du mutex :
# la traiter comme « déjà pris » bloquerait tout check-in sur le poste.
function Invoke-SzhCheckin {
  param([string]$OrigineAncrage = '')

  # En simulation, le check-in exige un ancrage d'essai, pour qu'un test n'écrive pas dans
  # le vrai dossier partagé.
  if (($env:SZH_LANCEUR_SIMULE -eq '1') -and (-not $env:SZH_ANCRAGE)) {
    try { Write-SzhLog 'check-in : simulation sans ancrage d''essai -> passe' } catch { }
    return $false
  }
  try {
    $dossier = Get-SzhDossierInventaire
    if (-not $dossier) {
      try { Write-SzhLog 'check-in : dossier partage introuvable (racine non resolue) -> passe' } catch { }
      return $false
    }
    $fichier = Join-Path $dossier (Get-SzhCheckinNomFichier (Get-SzhNomPoste))

    $mutex = $null
    $aLaMain = $false
    try { $mutex = New-SzhMutexPoste -Nom 'SZH-Publishing-Checkin' } catch { $mutex = $null }
    if ($mutex) {
      try { $aLaMain = $mutex.WaitOne(5000) }
      catch [System.Threading.AbandonedMutexException] { $aLaMain = $true }
      catch { $aLaMain = $false }
      if (-not $aLaMain) {
        try { Write-SzhLog 'check-in : un autre compte ecrit en ce moment -> passe' } catch { }
        try { $mutex.Dispose() } catch { }
        return $false
      }
    }

    try {
      $existantes = Read-SzhCheckinCsv $fichier
      if ($null -eq $existantes) {
        try { Write-SzhLog ('check-in : "' + $fichier + '" illisible -> passe, rien n''est reecrit') } catch { }
        return $false
      }
      $faits = Get-SzhCheckinFaits -OrigineAncrage $OrigineAncrage
      $lignes = Merge-SzhCheckinLignes $existantes $faits $SzhCheckinColonnes $SzhCheckinCleMois $SzhCheckinCleCompte
      Write-SzhCheckinCsv -Fichier $fichier -Lignes $lignes
      try { Write-SzhLog ('check-in : "' + $fichier + '" a jour (' + @($lignes).Count + ' ligne(s))') } catch { }
      return $true
    } finally {
      if ($mutex) {
        if ($aLaMain) { try { $mutex.ReleaseMutex() } catch { } }
        try { $mutex.Dispose() } catch { }
      }
    }
  } catch {
    try { Write-SzhLog ('check-in : impossible (' + $_.Exception.Message + ')') } catch { }
    return $false
  }
}
