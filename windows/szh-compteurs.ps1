# Ecrivain PowerShell des compteurs d'usage : un fichier CSV par evenement dans
# <ancrage SharePoint>\2_Produkte\54_Pronto\_Systeme\compteurs\, jamais reecrit. Dot-source par
# szh-common.ps1, apres szh-checkin.ps1 dont il reprend la lecture de la version du disque
# virtuel. Compatibilite : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#
# CE N'EST PAS UN RAPPORT D'ERREUR. Un compteur ne porte JAMAIS de texte de manuscrit : ni nom
# de fichier, ni titre, ni nom d'auteur, ni institution, ni courriel, ni chemin, ni message
# d'exception. Seulement des noms de mesure d'une liste blanche et des entiers. C'est ce
# fichier-ci, et non l'appelant, qui le garantit : chaque mesure est revalidee ici (nom et
# valeur) avant d'etre ecrite, quel que soit le producteur.
#
# Pourquoi des nombres : savoir si le nettoyeur rend service (quelles regles se declenchent,
# lesquelles finissent en revision, combien de passages echouent) sans lire un seul document.
# Ce n'est jamais un moyen d'evaluer une personne ; la date est locale et SANS heure (art. 26
# OLT 3 : pas de surveillance des heures de travail). Conservation : 24 mois, purges par
# l'outil de synthese.
#
# Contrepartie JS : ENTETE_COMPTEURS (vscodium-extension/szh-cockpit/lib/compteurs.js) -- meme
# en-tete, au signe pres ; un test de parite le garde.

$script:SzhCompteursEntete = 'date;poste;contexte;version_toolkit;version_rootfs;source;passage;mesure;valeur'

# Les seules mesures que chaque source a le droit d'ecrire : MESURES_NETTOYEUR et MESURES_IMPORT
# de lib/compteurs.js, recopiees ici (un test de parite les compare). Une mesure qui n'y est pas
# est ecartee en silence, meme de bonne forme : la forme [a-z0-9_.:-] laisserait passer un nom de
# fichier mis en minuscules.
$script:SzhCompteursMesuresNettoyeur = @('issue.ok', 'issue.alertes', 'issue.plantage', 'issue.interrompu',
  'produit.revue', 'produit.zeitschrift', 'cas.a', 'cas.b', 'format.entree.odt', 'format.sortie.odt',
  'langue.desaccord', 'signes', 'signes_biblio', 'paragraphes', 'references', 'notes', 'images',
  'images_sans_alt', 'duree_ms', 'plafond_commentaires_atteint', 'perte_mots', 'ecartes',
  'vale.indisponible', 'typo.repli', 'annotation.restauree', 'reseau.crossref.panne',
  'reseau.ror.panne', 'reseau.orcid.panne', 'doi.proposes', 'ror.proposes', 'orcid.proposes',
  'orcid.candidats', 'entete.auteurs', 'entete.champs_vides', 'entete.ordre_incertain')
$script:SzhCompteursMesuresImport = @('auteurs', 'auteurs_orcid', 'auteurs_ror', 'langue_deduite')

# File d'attente locale : par compte, comme celle des rapports (rapports-en-attente).
# Plafonds : 200 fichiers et 90 jours, au-dela perte silencieuse.
$script:SzhCompteursPlafondFichiers = 200
$script:SzhCompteursPlafondJours = 90

# ---- 1. Ce qui est ecrit ----

# MAJUSCULES, reduit a [A-Z0-9-] : un nom de machine, rien d'autre. Vide -> 'POSTE'.
function Get-SzhCompteursPoste {
  $brut = ([string]$env:COMPUTERNAME).Trim()
  if (-not $brut) { try { $brut = ([string][System.Net.Dns]::GetHostName()).Trim() } catch { $brut = '' } }
  $net = ($brut.ToUpperInvariant() -creplace '[^A-Z0-9-]', '')
  if ($net.Length -gt 63) { $net = $net.Substring(0, 63) }
  if (-not $net) { $net = 'POSTE' }
  return $net
}

# 'dev' si SZH_MANUSCRIT_CLI ou SZH_CODIUM_PROFIL est posee, si le toolkit est une jonction
# vers un depot, ou si config.json porte "compteurs": "dev" ; 'prod' sinon. Un poste de developpement ne melange
# jamais ses essais aux chiffres de la redaction.
function Get-SzhCompteursContexte {
  try {
    if (([string]$env:SZH_MANUSCRIT_CLI).Trim()) { return 'dev' }
    if (([string]$env:SZH_CODIUM_PROFIL).Trim()) { return 'dev' }
    try {
      $element = Get-Item -LiteralPath $SzhToolkit -Force -ErrorAction Stop
      if (($element.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return 'dev' }
    } catch { }
    $config = Get-SzhConfig
    if ($config -and $config.PSObject.Properties['compteurs'] -and (([string]$config.compteurs).Trim().ToLowerInvariant() -ceq 'dev')) { return 'dev' }
  } catch { }
  return 'prod'
}

# Une version n'est jamais qu'un motif de chiffres, lettres et . _ + - : le CSV n'a ni
# guillemets ni point-virgule a craindre.
function ConvertTo-SzhCompteursVersion($Brut) {
  $net = ([string]$Brut -creplace '[^0-9A-Za-z._+-]', '')
  if ($net.Length -gt 40) { $net = $net.Substring(0, 40) }
  return $net
}

# Le nom d'une mesure tel qu'il sera ecrit, ou $null s'il est ecarte -- les memes regles que
# normaliserMesure de lib/compteurs.js. Le segment de regle (`regle:<Id>:<devenir>`) garde son
# Id s'il suit le motif du catalogue (64 signes au plus), sinon il devient `Autre` ; un devenir
# inconnu ecarte la mesure. Le reste doit suivre [a-z0-9_.:-]{1,96} ET figurer dans la liste de
# la source. \z, jamais $ : en .NET, $ accepte un saut de ligne final.
function ConvertTo-SzhCompteursMesure([string]$Brut, [string]$Source) {
  if ($null -eq $Brut) { return $null }
  if ($Brut.StartsWith('regle:')) {
    if ($Source -cne 'nettoyeur') { return $null }
    $i = $Brut.LastIndexOf(':')
    if ($i -le 5) { return $null }
    $devenir = $Brut.Substring($i + 1)
    if (@('revision', 'commentaire', 'rapport') -cnotcontains $devenir) { return $null }
    $id = $Brut.Substring(6, $i - 6)
    $sain = 'Autre'
    if (($id.Length -le 64) -and ($id -cmatch '^[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+\z')) { $sain = $id }
    return ('regle:' + $sain + ':' + $devenir)
  }
  if ($Brut -cnotmatch '^[a-z0-9_.:-]{1,96}\z') { return $null }
  if ($Source -ceq 'nettoyeur') {
    if ($script:SzhCompteursMesuresNettoyeur -ccontains $Brut) { return $Brut }
    if (($Brut -cmatch '^issue\.refus:[a-z0-9_-]{1,48}\z') -or ($Brut -cmatch '^titres\.[a-z0-9_]{1,40}\z')) { return $Brut }
    return $null
  }
  if ($Source -ceq 'import') {
    if ($Brut.StartsWith('import.code:')) {
      if ($Brut.Substring(12) -cmatch '^[a-z][a-z0-9-]{1,40}\z') { return $Brut }
      return $null
    }
    if ($script:SzhCompteursMesuresImport -ccontains $Brut) { return $Brut }
  }
  return $null
}

# Une valeur est un entier positif ou nul, rendu en chiffres seuls ; tout le reste (texte,
# decimale, negatif, booleen) rend $null et la ligne est ecartee.
function ConvertTo-SzhCompteursValeur($Brut) {
  if ($null -eq $Brut) { return $null }
  if ($Brut -is [bool]) { return $null }
  if (($Brut -is [int]) -or ($Brut -is [long]) -or ($Brut -is [int16]) -or ($Brut -is [byte])) {
    if ([long]$Brut -lt 0) { return $null }
    return ([long]$Brut).ToString([System.Globalization.CultureInfo]::InvariantCulture)
  }
  if (($Brut -is [double]) -or ($Brut -is [decimal]) -or ($Brut -is [single])) {
    if (([double]$Brut -lt 0) -or ([double]$Brut -ne [math]::Floor([double]$Brut)) -or ([double]$Brut -gt 9007199254740991)) { return $null }
    return ([long][double]$Brut).ToString([System.Globalization.CultureInfo]::InvariantCulture)
  }
  if (([string]$Brut) -cmatch '^\d{1,15}\z') { return ([string]$Brut) }
  return $null
}

# Les paires (nom, valeur) d'une table (IDictionary) ou d'un objet lu par ConvertFrom-Json.
function Get-SzhCompteursPaires($Mesures) {
  $paires = New-Object System.Collections.ArrayList
  if ($null -eq $Mesures) { return @() }
  if ($Mesures -is [System.Collections.IDictionary]) {
    foreach ($cle in $Mesures.Keys) { [void]$paires.Add([pscustomobject]@{ nom = [string]$cle; valeur = $Mesures[$cle] }) }
  } else {
    foreach ($p in $Mesures.PSObject.Properties) { [void]$paires.Add([pscustomobject]@{ nom = [string]$p.Name; valeur = $p.Value }) }
  }
  return @($paires)
}

# Le texte du fichier (en-tete comprise, CRLF, terminaison comprise), ou $null quand aucune
# mesure ne passe la validation : on n'ecrit jamais un fichier vide. Pure -- testable seule.
function ConvertTo-SzhCompteursTexte {
  param(
    [string]$Source, [string]$Passage, $Mesures,
    [string]$Date, [string]$Poste, [string]$Contexte, [string]$VersionToolkit, [string]$VersionRootfs
  )
  $lignes = New-Object System.Collections.ArrayList
  [void]$lignes.Add($script:SzhCompteursEntete)
  $avant = $lignes.Count
  $prefixe = (($Date, $Poste, $Contexte, (ConvertTo-SzhCompteursVersion $VersionToolkit),
    (ConvertTo-SzhCompteursVersion $VersionRootfs), $Source, $Passage) -join ';')
  # Les noms devenus identiques (plusieurs Id de regle inconnus -> `Autre`) s'additionnent.
  $sommes = @{}
  foreach ($paire in @(Get-SzhCompteursPaires $Mesures)) {
    $nom = ConvertTo-SzhCompteursMesure $paire.nom $Source
    if ($null -eq $nom) { continue }
    $valeur = ConvertTo-SzhCompteursValeur $paire.valeur
    if ($null -eq $valeur) { continue }
    if ($sommes.ContainsKey($nom)) { $sommes[$nom] = [long]$sommes[$nom] + [long]$valeur } else { $sommes[$nom] = [long]$valeur }
  }
  foreach ($nom in @($sommes.Keys | Sort-Object)) {
    [void]$lignes.Add($prefixe + ';' + $nom + ';' + ([long]$sommes[$nom]).ToString([System.Globalization.CultureInfo]::InvariantCulture))
  }
  if ($lignes.Count -eq $avant) { return $null }
  return (($lignes.ToArray() -join "`r`n") + "`r`n")
}

# Les 12 premiers hexadecimaux du SHA-256 d'un fichier : le meme condensat que la CLI, pour un
# passage qui n'a rien rendu. Vide quand le fichier est illisible.
function Get-SzhCompteursPassage([string]$Chemin) {
  $flux = $null
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $flux = [System.IO.File]::OpenRead($Chemin)
    $octets = $sha.ComputeHash($flux)
    return (([System.BitConverter]::ToString($octets) -replace '-', '').ToLowerInvariant().Substring(0, 12))
  } catch { return '' } finally {
    if ($flux) { try { $flux.Dispose() } catch { } }
  }
}

# ---- 2. Ecrire : temporaire `~$`, puis renommage, le temporaire toujours supprime ----

# Le meme motif que Write-SzhRapportSurDisque et Write-SzhCheckinCsv : le temporaire est dans
# LE MEME dossier (un renommage n'est atomique que dans un volume), prefixe `~$` que OneDrive
# ignore, et supprime dans un finally meme en cas d'echec. Jamais d'ecriture par-dessus un
# fichier existant : si la cible existe deja, on s'arrete.
function Write-SzhCompteursOctets {
  param([string]$Dossier, [string]$Nom, [byte[]]$Octets)
  $tmp = ''
  try {
    New-Item -ItemType Directory -Force -Path $Dossier -ErrorAction Stop | Out-Null
    $cible = Join-Path $Dossier $Nom
    if (Test-Path -LiteralPath $cible) { return $false }
    $tmp = Join-Path $Dossier ('~$' + $Nom + '.' + $PID)
    [System.IO.File]::WriteAllBytes($tmp, $Octets)
    Move-Item -LiteralPath $tmp -Destination $cible -ErrorAction Stop
    return $true
  } catch {
    return $false
  } finally {
    if ($tmp) {
      try { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } } catch { }
    }
  }
}

function ConvertTo-SzhCompteursOctets([string]$Texte) {
  $encodage = New-Object System.Text.UTF8Encoding($true)
  return ([byte[]]($encodage.GetPreamble() + $encodage.GetBytes($Texte)))
}

# ---- 3. Les garde-fous ----

# Jamais d'ecriture en simulation ou sans reseau, SAUF vers un dossier de test explicite
# (SZH_COMPTEURS) : un banc de test ne doit jamais atteindre le vrai dossier partage.
function Test-SzhCompteursInterdit {
  if ($env:SZH_COMPTEURS) { return $false }
  if ($env:SZH_LANCEUR_SIMULE -eq '1') { return $true }
  if ($env:SZH_RESEAU_INTERDIT) { return $true }
  return $false
}

# Le dossier des compteurs : SZH_COMPTEURS d'abord (tests), puis l'ancrage resolu PASSIVEMENT
# (Resolve-SzhAncrage, sans fenetre ni question), '' quand il ne l'est pas.
function Get-SzhCompteursDossier {
  if ($env:SZH_COMPTEURS) { return [string]$env:SZH_COMPTEURS }
  try { return (Get-SzhDossierSysteme 'compteurs') } catch { return '' }
}

function Get-SzhCompteursDossierAttente {
  return (Join-Path $script:SzhBaseUtilisateur 'compteurs-en-attente')
}

function Get-SzhCompteursEnAttenteListe([string]$Dossier) {
  $fichiers = New-Object System.Collections.ArrayList
  try {
    foreach ($f in @(Get-ChildItem -LiteralPath $Dossier -Filter '*.csv' -File -ErrorAction Stop)) {
      [void]$fichiers.Add([pscustomobject]@{ chemin = $f.FullName; nom = $f.Name; ecrit = $f.LastWriteTimeUtc })
    }
  } catch { return @() }
  return @($fichiers | Sort-Object ecrit)
}

# 200 fichiers, 90 jours : les plus vieux partent sans etre transmis.
function Limit-SzhCompteursEnAttente {
  param([string]$Dossier, [datetime]$Maintenant = (Get-Date))
  $seuilAge = $Maintenant.ToUniversalTime().AddDays(-1 * $script:SzhCompteursPlafondJours)
  $fichiers = @(Get-SzhCompteursEnAttenteListe $Dossier | Where-Object {
    if ($_.ecrit -lt $seuilAge) {
      try { Remove-Item -LiteralPath $_.chemin -Force -ErrorAction Stop } catch { }
      return $false
    }
    return $true
  })
  if (@($fichiers).Count -gt $script:SzhCompteursPlafondFichiers) {
    $enTrop = @($fichiers).Count - $script:SzhCompteursPlafondFichiers
    for ($i = 0; $i -lt $enTrop; $i++) {
      try { Remove-Item -LiteralPath $fichiers[$i].chemin -Force -ErrorAction Stop } catch { }
    }
    $fichiers = @($fichiers | Select-Object -Skip $enTrop)
  }
  return @($fichiers)
}

# ---- 4. Les deux entrees ----

# Appele une fois par passage du nettoyeur, avec l'objet `mesures` de la CLI (ou un compteur
# minimal). NE LEVE JAMAIS : un compteur est un confort, jamais une condition.
function Write-SzhCompteurs {
  param([string]$Source = 'nettoyeur', [string]$Passage = '', $Mesures = $null)
  try {
    if (($Source -ne 'nettoyeur') -and ($Source -ne 'import')) { return }
    if (Test-SzhCompteursInterdit) {
      try { Write-SzhLog 'compteurs : non ecrits (simulation ou reseau interdit)' } catch { }
      return
    }
    if (-not ($Passage -cmatch '^[0-9a-f]{12}\z')) { $Passage = [guid]::NewGuid().ToString('N').Substring(0, 12) }

    $versionToolkit = ''
    try { $versionToolkit = [string](Get-SzhVersionInstallee) } catch { }
    $versionRootfs = ''
    try { $versionRootfs = [string](Get-SzhVersionDisqueVirtuel) } catch { }
    $poste = Get-SzhCompteursPoste
    $maintenant = Get-Date
    $date = $maintenant.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)

    $texte = ConvertTo-SzhCompteursTexte -Source $Source -Passage $Passage -Mesures $Mesures `
      -Date $date -Poste $poste -Contexte (Get-SzhCompteursContexte) `
      -VersionToolkit $versionToolkit -VersionRootfs $versionRootfs
    if ($null -eq $texte) { return }

    $nom = $maintenant.ToString('yyyyMMdd', [System.Globalization.CultureInfo]::InvariantCulture) +
      '-' + $poste + '-' + $Source + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.csv'
    $octets = ConvertTo-SzhCompteursOctets $texte

    $dossier = Get-SzhCompteursDossier
    if ($dossier -and (Write-SzhCompteursOctets -Dossier $dossier -Nom $nom -Octets $octets)) { return }

    $dossierAttente = Get-SzhCompteursDossierAttente
    if (Write-SzhCompteursOctets -Dossier $dossierAttente -Nom $nom -Octets $octets) {
      try { Limit-SzhCompteursEnAttente -Dossier $dossierAttente | Out-Null } catch { }
      try { Write-SzhLog 'compteurs : mis en attente' } catch { }
    } else {
      try { Write-SzhLog 'compteurs : abandonnes, ecriture impossible meme en attente' } catch { }
    }
  } catch {
    try { Write-SzhLog ('compteurs : echec interne (' + $_.Exception.GetType().Name + ')') } catch { }
  }
}

# Videe au lancement suivant du lanceur (open-produit.ps1), une fois l'ancrage resolu. Chaque
# fichier en attente est recopie dans le dossier partage par le meme chemin atomique, puis
# supprime ; un fichier qui n'a pas la forme attendue (en-tete differente, trop gros) est
# supprime sans etre transmis. NE LEVE JAMAIS.
function Clear-SzhCompteursEnAttente {
  try {
    if (Test-SzhCompteursInterdit) { return }
    $dossierAttente = Get-SzhCompteursDossierAttente
    $fichiers = Limit-SzhCompteursEnAttente -Dossier $dossierAttente
    if (@($fichiers).Count -eq 0) { return }
    $dossier = Get-SzhCompteursDossier
    if (-not $dossier) { return }
    $deplaces = 0
    foreach ($f in $fichiers) {
      try {
        $octets = [System.IO.File]::ReadAllBytes($f.chemin)
        $texte = [System.Text.Encoding]::UTF8.GetString($octets).TrimStart([char]0xFEFF)
        $premiere = ($texte -split "`r?`n")[0]
        if (($octets.Length -gt 65536) -or ($premiere -cne $script:SzhCompteursEntete)) {
          Remove-Item -LiteralPath $f.chemin -Force -ErrorAction Stop
          continue
        }
        if (Write-SzhCompteursOctets -Dossier $dossier -Nom $f.nom -Octets $octets) {
          Remove-Item -LiteralPath $f.chemin -Force -ErrorAction Stop
          $deplaces++
        }
      } catch { }
    }
    try { Write-SzhLog ('compteurs : file d''attente -> {0}/{1} deplace(s).' -f $deplaces, @($fichiers).Count) } catch { }
  } catch {
    try { Write-SzhLog ('compteurs : vidage de la file d''attente impossible (' + $_.Exception.GetType().Name + ')') } catch { }
  }
}
