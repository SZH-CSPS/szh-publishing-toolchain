# Check-in mensuel des postes : un CSV PAR POSTE dans le dossier partagé, une ligne par mois
# et par compte Windows, rafraîchie à chaque ouverture du lanceur. Dot-sourcé par
# szh-common.ps1, après szh-produits.ps1 dont il tire la racine active.
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#
# POURQUOI. Le propriétaire veut savoir quels postes existent et dans quel état ils sont sans
# rien demander à personne, et sans serveur : deux postes aujourd'hui, peut-être quatre
# demain, tous synchronisés sur la même bibliothèque. Le dossier partagé est donc le seul
# point de rendez-vous disponible, et un fichier déposé par chaque poste le seul protocole.
#
# POURQUOI UN FICHIER PAR POSTE, ET RIEN QUE LE NOM DU POSTE DANS SON NOM. Un fichier unique
# partagé serait réécrit par deux postes en même temps, et OneDrive n'arbitre pas : il
# déposerait une « copie en conflit » que personne ne lit. Un fichier par poste supprime la
# collision entre postes par construction. Et son nom ne porte QUE le nom de la machine :
# l'identité de la personne (compte, adresse) vit DANS le fichier, jamais dans son nom, parce
# qu'un nom de fichier est visible de tous dans un dossier synchronisé, y compris de qui n'a
# aucune raison de l'ouvrir.
#
# POURQUOI UNE LIGNE PAR MOIS, RAFRAÎCHIE. Un rendez-vous à date fixe rate le poste éteint ce
# jour-là. Ici, la ligne du mois courant est créée si elle manque et réécrite sinon : un poste
# allumé une seule fois dans le mois a sa ligne, et l'horodatage de cette ligne donne la date
# de dernière activité sans qu'on ait rien à mesurer de plus.
#
# ⚠ CE FICHIER N'EST PAS UN RAPPORT D'ERREUR. Il porte l'adresse de connexion, que
# docs/RAPPORTS-ERREUR.md interdit expressément dans un rapport (et que lib/codes-erreur.js
# masque). Les deux artefacts n'ont ni le même lecteur ni le même but : voir le paragraphe
# « L'inventaire des postes n'est pas un rapport d'erreur » de docs/RAPPORTS-ERREUR.md. Rien
# ici ne touche au masquage ni aux rapports.

# ---- 1. Où, et sous quel nom ----

# Le dossier d'inventaire, TOUJOURS sur SharePoint (Get-SzhDossierSysteme, szh-produits.ps1)
# — jamais sous la racine active : deux postes en mode test, l'un sur `emplacementRevues`
# test et l'autre sur production, doivent écrire dans le MÊME fichier partagé. Suivre la
# racine active, comme avant le 23.09.2026, aurait posé l'inventaire sous `Revues-TESTING`
# d'un poste de développement — personne d'autre ne l'aurait jamais lu.
#
# Rend '' quand l'ancrage SharePoint n'est pas résolu : Get-SzhDossierSysteme applique déjà
# la garde (pas de repli vers un dossier fabriqué sous le profil) et crée le dossier s'il
# manque, comme pour les rapports d'erreur (szh-rapport.ps1).
function Get-SzhDossierInventaire {
  try { return (Get-SzhDossierSysteme 'inventaire') } catch { return '' }
}

# Le nom du poste. %COMPUTERNAME% est vide dans des contextes de service ; le nom d'hôte prend
# le relais, et un dernier repli évite un nom de fichier vide.
function Get-SzhNomPoste {
  $nom = ([string]$env:COMPUTERNAME).Trim()
  if (-not $nom) { try { $nom = ([string][System.Net.Dns]::GetHostName()).Trim() } catch { $nom = '' } }
  if (-not $nom) { $nom = 'POSTE-INCONNU' }
  return $nom
}

# « RMO-DESK » -> « RMO-DESK.csv ». Les caractères interdits dans un nom de fichier sont
# remplacés par un tiret : un nom de machine n'en porte pas, mais un repli exotique le
# pourrait, et un nom de fichier invalide ferait échouer l'écriture sans rien dire.
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

# Elle n'existe nulle part ailleurs dans le code : ni state.json, ni config.json, ni l'état
# par compte ne la portent. Trois sources, dans cet ordre, SANS droits administrateur et SANS
# dépendance nouvelle — chacune retombe silencieusement sur la suivante :
#
#   1. la valeur `UserEmail` des comptes professionnels de OneDrive
#      (HKCU\Software\Microsoft\OneDrive\Accounts\Business*). C'est la source la plus juste :
#      c'est exactement le compte qui synchronise la bibliothèque dont on parle. Plusieurs
#      « Business1, Business2… » peuvent coexister — on prend la première qui répond, dans
#      l'ordre des noms de clé ;
#   2. `whoami.exe /upn`, qui rend le nom de connexion d'un poste rattaché au domaine et
#      échoue proprement (code de retour non nul, message sur la sortie d'erreur) sinon ;
#   3. chaîne vide. La colonne du dossier personnel suffit alors à identifier la personne.
#
# NE LÈVE JAMAIS, et c'est le contrat : un poste sans adresse doit produire une ligne
# complète. D'où le try/catch par source, et la sauvegarde/restitution locale de
# $ErrorActionPreference autour de l'appel natif — 'Stop' ferait d'une ligne de sortie
# d'erreur de whoami.exe une exception fatale (piège classique de PowerShell 5.1). Cette
# petite danse est répétée ici plutôt qu'empruntée à Invoke-SzhNatif (szh-common.ps1) pour
# que la fonction reste extractible seule par son banc de test, sans le socle autour.
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
        # Un nom de connexion, pas une phrase d'erreur : le contrôle du « @» suffit, et il
        # écarte aussi le « ERREUR : … » qu'un poste hors domaine écrit parfois sur la
        # sortie standard plutôt que sur celle des erreurs.
        if ($t -and $t.Contains('@') -and ($t -notmatch '\s')) { return $t }
      }
    }
  } catch { } finally { $ErrorActionPreference = $ancien }

  return ''
}

# ---- 3. Les colonnes, et les faits qu'elles portent ----

# Les deux colonnes qui IDENTIFIENT une ligne : mois + compte. Deux comptes Windows du même
# poste ont donc chacun leur ligne dans le même mois, et aucun n'écrase l'autre.
$script:SzhCheckinCleMois = 'Mois'
$script:SzhCheckinCleCompte = 'Compte Windows'

# L'en-tête du CSV, dans l'ordre. En français lisible, et jamais traduit : ce fichier n'est
# pas une interface, il est lu par le propriétaire dans un tableur, pas par le rédacteur dans
# le lanceur. Toute colonne ajoutée ici apparaît d'elle-même dans les fichiers existants au
# check-in suivant (ConvertTo-SzhCheckinLigne remplit les manquantes par du vide).
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

# Le système, tel qu'un humain le nomme. ProductName annonce encore « Windows 10 Pro » sur un
# Windows 11 (Microsoft ne l'a jamais corrigé) : le numéro de build, lui, ne ment pas, d'où
# les trois morceaux assemblés. Repli sur la seule version quand la clé n'est pas lisible.
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

# La version du cockpit posée pour CE compte : le package.json de l'extension trouvée par
# Get-SzhDossierCockpit (szh-common.ps1), jamais le CLI de l'éditeur — celui-ci coûte un
# processus complet, et le lanceur ne doit pas s'ouvrir plus lentement pour un inventaire.
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

# L'état de la machine virtuelle : enregistrée pour ce compte, ou non. On ne la DÉMARRE pas
# (Test-SzhDistroRepond, szh-common.ps1) — un inventaire n'a pas à réveiller un environnement
# de fabrication, ni à ajouter quelques secondes à chaque ouverture du lanceur. Deux valeurs
# fixes, jamais traduites, pour qu'un tri de tableur les regroupe.
function Get-SzhEtatMachineVirtuelle {
  try {
    if ((Get-SzhDistrosEnregistrees) -contains $SzhDistro) { return 'enregistree' }
    return 'absente'
  } catch { return '' }
}

# La version du disque de cette machine virtuelle : l'état par compte d'abord (c'est là
# qu'elle vit depuis que l'enregistrement est par utilisateur), l'état du poste en repli pour
# un poste installé avant ce partage — même ordre que diagnostic.ps1.
function Get-SzhVersionDisqueVirtuel {
  try {
    $pose = Get-SzhEtatUtilisateurChamp (Get-SzhEtatUtilisateur) 'rootfs'
    if ($pose) { return $pose }
    $etat = Get-SzhState
    if ($etat -and $etat.rootfs) { return ([string]$etat.rootfs).Trim() }
  } catch { }
  return ''
}

# Les dix-huit faits du poste, dans l'ordre des colonnes. Impure de bout en bout (registre,
# disque, environnement) et sans aucune écriture : tout ce qu'elle mesure est facultatif, et
# chaque mesure ratée laisse une case vide plutôt qu'une exception.
#
# $OrigineAncrage vient de l'appelant (Initialize-SzhAncrage, dans open-produit.ps1) plutôt
# que d'un second Resolve-SzhAncrage : la résolution a déjà eu lieu, et c'est SON verdict
# qu'on veut consigner, pas un autre calculé après coup.
function Get-SzhCheckinFaits {
  param([string]$OrigineAncrage = '')

  $maintenant = Get-Date
  $identite = @{ nom = ''; sid = '' }
  try { $identite = Get-SzhIdentite } catch { }

  $place = -1
  try { $place = Get-SzhEspaceLibreGo } catch { $place = -1 }
  $placeTexte = ''
  # Point décimal invariant : un tableur suisse le lit, et une virgule décimale se
  # confondrait avec un séparateur si quelqu'un ouvrait le fichier avec les mauvais réglages.
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

# Une valeur de colonne, quelle que soit la forme de la ligne (objet d'Import-Csv, table de
# hachage fabriquée à la main) : '' plutôt qu'une exception quand la colonne manque, ce qui
# est le cas normal d'un fichier écrit par une version antérieure.
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

# Un champ tient sur UNE ligne : les retours chariot sont remplacés par un espace. Le CSV les
# supporterait entre guillemets, mais un tableur qui les affiche casse la lecture visuelle du
# fichier, et c'est ce fichier-là qu'on ouvre d'un double-clic.
function ConvertTo-SzhCheckinTexte($Valeur) {
  if ($null -eq $Valeur) { return '' }
  $t = [string]$Valeur
  $t = $t -replace "`r`n", ' '
  $t = $t -replace "[`r`n`t]", ' '
  return $t.Trim()
}

# Une ligne ramenée à l'en-tête canonique : toutes les colonnes, dans l'ordre, les absentes
# vides. C'est ce qui permet d'ajouter une colonne sans casser les fichiers déjà déposés —
# Export-Csv ne regarde que les propriétés du PREMIER objet, une ligne ancienne non
# normalisée tronquerait donc tout le fichier.
function ConvertTo-SzhCheckinLigne($Ligne, $Colonnes) {
  $ordonnee = [ordered]@{}
  foreach ($c in $Colonnes) { $ordonnee[$c] = (ConvertTo-SzhCheckinTexte (Get-SzhCheckinValeur $Ligne $c)) }
  return [pscustomobject]$ordonnee
}

# PURE : les lignes déjà dans le fichier, plus celle du jour. La ligne dont le couple
# mois + compte correspond est REMPLACÉE sur place (son rang ne change pas, pour qu'un
# fichier relu d'un mois à l'autre garde son ordre chronologique) ; si aucune ne correspond,
# la nouvelle est ajoutée à la fin. Toutes ressortent normalisées.
#
# $CleMois et $CleCompte sont passées plutôt que lues dans la portée du script : c'est ce qui
# rend cette fonction éprouvable extraite seule, hors du reste de ce fichier.
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
    # Le compte se compare sans la casse : Windows ne la distingue pas, et un même compte
    # écrit « SZH\rmo » puis « szh\RMO » fabriquerait deux lignes pour une seule personne.
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

# Les lignes déjà dans le fichier. Rend @() quand le fichier n'existe pas encore (premier
# check-in de ce poste), et $null — ce qui n'est PAS la même chose — quand il existe mais ne
# se lit pas : fichier encore « à la demande » non descendu par OneDrive, disque coupé,
# contenu abîmé. L'appelant abandonne alors le check-in du jour plutôt que de réécrire un
# fichier d'une seule ligne par-dessus l'historique de tout le monde.
#
# ⚠ Les deux `return ,@(...)` ne sont pas une coquetterie : PowerShell DÉROULE un tableau
# rendu par une fonction, et un tableau vide rendu tel quel arrive chez l'appelant sous la
# forme de $null — indistinguable, précisément, du « illisible » que cette fonction doit
# pouvoir dire. L'opérateur virgule emballe le tableau le temps du retour.
function Read-SzhCheckinCsv([string]$Fichier) {
  try { if (-not (Test-Path -LiteralPath $Fichier -PathType Leaf)) { return ,@() } } catch { return $null }
  try { return ,@(Import-Csv -LiteralPath $Fichier -Delimiter ';' -Encoding UTF8 -ErrorAction Stop) }
  catch { return $null }
}

# Écriture ATOMIQUE et compatible OneDrive, sur le motif éprouvé du dépôt
# (Write-SzhRapportSurDisque, szh-rapport.ps1 ; ecrireAtomique, lib/yaml.js) :
#
#   * temporaire dans LE MÊME dossier que la cible — un renommage n'est atomique qu'à
#     l'intérieur d'un volume, et un %TEMP% sur un autre disque le dégraderait en copie ;
#   * préfixe « ~$ », que OneDrive ignore : sans lui, chaque écriture fait voyager un fichier
#     de plus vers tous les postes, et chaque écriture ratée y laisse un orphelin ;
#   * bloc finally qui supprime le temporaire MÊME en cas d'échec — c'est là que les deux
#     écrivains de rapports fuyaient (corrigé dans le même lot).
#
# UTF-8 AVEC BOM et séparateur point-virgule : c'est ce qu'il faut pour qu'un tableur suisse
# ouvre le fichier d'un double-clic, sans assistant d'importation. -Encoding UTF8 de
# PowerShell 5.1 pose bien le BOM ; -NoTypeInformation retire la ligne « #TYPE » qui, sinon,
# précéderait l'en-tête.
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

# Appelé UNE FOIS par lancement du lanceur (open-produit.ps1), juste après la résolution de
# l'ancrage. Rend $true quand une ligne a été écrite, $false sinon — et NE LÈVE JAMAIS : le
# check-in est un confort, pas une condition d'ouverture. Un dossier partagé injoignable
# (OneDrive en panne, portable hors réseau, ancrage non rattaché) laisse une ligne de journal
# et rien d'autre.
#
# Le mutex de poste (New-SzhMutexPoste, szh-common.ps1) sérialise les deux comptes Windows
# d'un même poste, qui visent le MÊME fichier : sans lui, deux ouvertures simultanées
# liraient le même contenu et la deuxième écrirait par-dessus la ligne de la première. Un nom
# à lui, distinct de celui des mises à jour : un check-in n'a aucune raison d'attendre une
# mise à jour, ni de la faire attendre. L'attente est bornée — quelques secondes suffisent à
# une lecture et une écriture de quelques kilo-octets, et au-delà mieux vaut ouvrir le
# lanceur que réussir l'inventaire.
#
# AbandonedMutexException se traite à part (même raison que dans update.ps1) : un processus
# mort en tenant le mutex le laisse abandonné, et le confondre avec « déjà pris » finirait
# par empêcher tout check-in sur ce poste.
function Invoke-SzhCheckin {
  param([string]$OrigineAncrage = '')

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
