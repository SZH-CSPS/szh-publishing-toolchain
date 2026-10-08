# Fonctions communes des scripts SZH, à charger par :  . "$PSScriptRoot\szh-common.ps1"
# Compatible Windows PowerShell 5.1 : pas de ?. ?? ?: && ||.

$ErrorActionPreference = 'Stop'

# Les fichiers chargés, dans l'ordre de leurs dépendances : les textes avant T (plus bas) ;
# l'ancrage SharePoint avant szh-rapport.ps1 et szh-produits.ps1, qui s'en servent
# (Resolve-SzhAncrage) ; le check-in après les produits (Get-SzhBaseRevuesPour) ; le shell
# après le check-in ; la migration ensuite, car elle utilise Set-SzhRaccourciRevue
# (szh-shell.ps1) ; l'épinglage hors ligne en dernier.
# Les fonctions de config appelées par ces fichiers sont résolues à l'appel, pas au
# chargement. De même, $SzhBaseUtilisateur (plus bas) n'est lu par szh-rapport.ps1 et
# szh-taches.ps1 qu'à leur premier appel.
. "$PSScriptRoot\szh-textes.ps1"
. "$PSScriptRoot\szh-ancrage.ps1"
. "$PSScriptRoot\szh-rapport.ps1"
. "$PSScriptRoot\szh-produits.ps1"
. "$PSScriptRoot\szh-checkin.ps1"
. "$PSScriptRoot\szh-shell.ps1"
. "$PSScriptRoot\szh-migration.ps1"
. "$PSScriptRoot\szh-epinglage.ps1"
# Affectation et non -bor sur la valeur en place, qui garderait SSL3/TLS 1.0. Tls13 en plus
# quand ce .NET le connaît (pas sur les postes anciens, d'où le try/catch).
$szhTls = [Net.SecurityProtocolType]::Tls12
try { $szhTls = $szhTls -bor [Net.SecurityProtocolType]::Tls13 } catch { }
[Net.ServicePointManager]::SecurityProtocol = $szhTls

# Proxy d'entreprise : sans ces lignes, un proxy qui demande une authentification rend 407 à
# chaque téléchargement, sans message clair. Les identifiants de la session suffisent
# (Kerberos ou NTLM) ; sans proxy, le réglage est sans effet.
try {
  $proxySysteme = [Net.WebRequest]::GetSystemWebProxy()
  $proxySysteme.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
  [Net.WebRequest]::DefaultWebProxy = $proxySysteme
} catch { }

# ---- Environnement hérité : ELECTRON_RUN_AS_NODE ----
# Tout processus lancé par l'hôte d'extensions de VSCodium hérite de ELECTRON_RUN_AS_NODE=1 :
# `VSCodium.exe "<dossier>"` se comporte alors comme Node, cherche un script et se ferme sans
# fenêtre. Chaque script charge ce fichier, d'où le nettoyage ici.
foreach ($nuisible in 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE') {
  if (Test-Path ('Env:' + $nuisible)) {
    Remove-Item ('Env:' + $nuisible) -ErrorAction SilentlyContinue
  }
}

$script:SzhBase       = 'C:\ProgramData\SZH'
if ($env:SZH_BASE) { $script:SzhBase = $env:SZH_BASE }   # tests : arborescence jetable, $SzhToolkit et $SzhStaging en dérivent ci-dessous
$script:SzhToolkit    = Join-Path $SzhBase 'toolkit'
$script:SzhStaging    = Join-Path $SzhBase 'staging'
$script:SzhLogs       = Join-Path $SzhBase 'logs'
$script:SzhStateFile  = Join-Path $SzhBase 'state.json'
$script:SzhConfigFile = Join-Path $SzhBase 'config.json'
$script:SzhDistro     = 'SZH-Publishing'
$script:SzhSupport    = 'robin.morand@szh.ch'          # contact affiché en cas de problème

# ---- Langue de l'interface ----
# Une seule langue pour le lanceur et tout ce que la chaîne affiche. Cinq sources, la
# dernière trouvée l'emportant :
#
#   1. l'allemand par défaut, langue de la majorité des postes (Windows est souvent en
#      anglais, langue qu'aucune équipe n'emploie) ;
#   2. la langue d'affichage de Windows, si c'est fr ou de ;
#   3. state.json (clé `langue`), écrite par le lanceur et lue aussi par le cockpit
#      (lib/i18n.js) ;
#   4. etat-utilisateur.json (`langueInterface`), un choix par compte : deux personnes sur un
#      même poste ont chacune leur langue ;
#   5. $env:SZH_LANGUE, pour un essai sans toucher au poste.
#
# Textes allemands en orthographe suisse (ss, pas de ß).
$script:SzhLangue = 'de'
try {
  $langueUi = (Get-UICulture).TwoLetterISOLanguageName.ToLower()
  if ($langueUi -eq 'fr' -or $langueUi -eq 'de') { $script:SzhLangue = $langueUi }
} catch { }
# Lectures directes, sans Get-SzhState ni Get-SzhEtatUtilisateur, définies plus bas : la
# table des textes sert dès le début du script. Le chemin de l'état par compte est donc
# recalculé ici, dans %LOCALAPPDATA% seulement (un contexte sans profil n'a pas de
# préférence).
try {
  if (Test-Path $SzhStateFile) {
    $etatLangue = (Get-Content $SzhStateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    $memo = [string]$etatLangue.langue
    if (@('fr', 'de') -contains $memo) { $script:SzhLangue = $memo }
  }
} catch { }
try {
  if ([string]$env:LOCALAPPDATA) {
    $fichierPrefLangue = Join-Path $env:LOCALAPPDATA 'SZH\etat-utilisateur.json'
    if (Test-Path $fichierPrefLangue) {
      $prefLangue = (Get-Content $fichierPrefLangue -Raw -Encoding UTF8 | ConvertFrom-Json)
      $choisie = [string]$prefLangue.langueInterface
      if (@('fr', 'de') -contains $choisie) { $script:SzhLangue = $choisie }
    }
  }
} catch { }
if ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower())) {
  $script:SzhLangue = $env:SZH_LANGUE.ToLower()
}

# Réglage « mise à jour silencieuse », rangé par compte (etat-utilisateur.json) : la tâche
# planifiée (update-launcher.ps1) tourne dans la session de chacun, et update.ps1 met à jour
# des éléments propres au compte (distribution WSL, extensions). Par défaut $false : la
# fenêtre reste visible.
function Get-SzhMajSilencieuse {
  try {
    $pref = Get-SzhEtatUtilisateur
    if ($pref -and $pref.PSObject.Properties['majSilencieuse']) {
      # Resolve-SzhBooleenConfig (szh-produits.ps1) : un JSON écrit à la main peut porter
      # "true"/"false" en chaîne plutôt qu'un booléen natif.
      $v = Resolve-SzhBooleenConfig $pref.majSilencieuse
      if ($null -ne $v) { return $v }
    }
  } catch { }
  return $false
}

# T 'clé' @(args…) -> texte dans la langue courante, à défaut en anglais, sinon la clé.
function T {
  param([Parameter(Mandatory = $true)][string]$Cle, [object[]]$Valeurs)
  $texte = $null
  $table = $SzhTextes[$SzhLangue]
  if ($table -and $table.ContainsKey($Cle)) { $texte = $table[$Cle] }
  if (-not $texte) { $texte = $SzhTextes['en'][$Cle] }
  if (-not $texte) { return $Cle }
  if ($Valeurs -and $Valeurs.Count -gt 0) { return ($texte -f $Valeurs) }
  return $texte
}

# ---- Config / état ----

# JSON en UTF-8 sans BOM : `Set-Content -Encoding UTF8` en poserait un sous PowerShell 5.1,
# que JSON.parse() de Node refuse, et le cockpit relit config.json et l'intention
# d'ouverture. state.json, lu par PowerShell seul, passe par Save-SzhState.
function Set-SzhJson([string]$Chemin, $Objet) {
  $json = ($Objet | ConvertTo-Json -Depth 5)
  [System.IO.File]::WriteAllText($Chemin, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# Lectures tolérantes : un fichier tronqué ou en cours d'écriture ne doit pas faire échouer
# un script, à commencer par le lanceur, qui n'a pas de console.
function Get-SzhConfig {
  try {
    if (Test-Path $SzhConfigFile) { return (Get-Content $SzhConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
  } catch { }
  return $null
}

$script:SzhRepoDefaut = 'SZH-CSPS/szh-publishing-toolchain'

# La clé `repo` ne peut viser qu'un dépôt de l'organisation : config.json est inscriptible
# par les Utilisateurs, et le dépôt fournit le toolkit, le rootfs et les extensions.
function Get-SzhRepo {
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.repo) {
    if ([string]$cfg.repo -match '^SZH-CSPS/[A-Za-z0-9_.-]+$') { return $cfg.repo }
    Write-SzhLog ('config.json : clé repo refusée (hors organisation SZH-CSPS) -> ' + [string]$cfg.repo)
  }
  return $script:SzhRepoDefaut
}

function Get-SzhState {
  try {
    if (Test-Path $SzhStateFile) { return (Get-Content $SzhStateFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
  } catch { }
  return $null
}

function Save-SzhState($Etat) {
  # Sans BOM, par Set-SzhJson (Set-Content -Encoding UTF8 en pose un sous PowerShell 5.1).
  Set-SzhJson $SzhStateFile $Etat
}

# Écrit les clés données sans effacer le reste du fichier, qui porte aussi la langue de
# l'interface. $Retirer : des clés à supprimer parce qu'elles vivent désormais ailleurs
# (`rootfs` et `vsix` sont dans l'état par utilisateur) ; les garder ici donnerait deux
# réponses à la même question.
function Set-SzhStateCles($Cles, [string[]]$Retirer = @()) {
  $etat = Get-SzhState
  if (-not $etat) { $etat = New-Object psobject }
  foreach ($c in @($Cles.Keys)) {
    if ($etat.PSObject.Properties[$c]) { $etat.$c = $Cles[$c] }
    else { $etat | Add-Member -MemberType NoteProperty -Name $c -Value $Cles[$c] -Force }
  }
  foreach ($c in @($Retirer)) {
    if ($etat.PSObject.Properties[$c]) { $etat.PSObject.Properties.Remove($c) }
  }
  Save-SzhState $etat
  return $etat
}

# ---- Qui exécute, et pour qui ----
#
# Une installation lancée depuis la session du rédacteur mais élevée avec le compte du
# support tourne sous le compte du support : HKCU, %APPDATA%, %LOCALAPPDATA% et les
# distributions WSL sont alors ceux du support, et tout ce qui est par utilisateur atterrit
# dans le mauvais profil. Ces deux fonctions permettent de le détecter, et chaque ligne de
# journal qui pose quelque chose par utilisateur nomme le compte.
function Get-SzhIdentite {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $admin = $false
  try {
    $admin = ([Security.Principal.WindowsPrincipal]$id).IsInRole(
               [Security.Principal.WindowsBuiltinRole]::Administrator)
  } catch { }
  return [ordered]@{ nom = [string]$id.Name; sid = [string]$id.User.Value; admin = $admin }
}

# Le compte dont la session graphique est ouverte : le propriétaire d'explorer.exe. C'est
# lui le rédacteur, même quand le script tourne sous un autre compte. Vide si personne n'est
# connecté ou si la mesure échoue : l'installation continue, le journal le dit. Avec
# plusieurs sessions, le premier propriétaire lisible, ce qui suffit pour dire « ce n'est
# pas ce compte ».
function Get-SzhSessionUtilisateur {
  try {
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction Stop)) {
      $rep = $null
      try { $rep = Invoke-CimMethod -InputObject $p -MethodName GetOwner -ErrorAction Stop } catch { $rep = $null }
      if ($rep -and $rep.User) {
        if ([string]$rep.Domain) { return (([string]$rep.Domain) + '\' + ([string]$rep.User)) }
        return [string]$rep.User
      }
    }
  } catch { }
  return ''
}

# ---- État par utilisateur ----
#
# state.json, dans C:\ProgramData\SZH, est commun à tous les comptes du poste. Or la
# distribution WSL et les extensions de l'éditeur sont installées par utilisateur : leur
# état est donc retenu par compte, sinon la mise à jour les croirait installées pour un
# compte qui ne les a pas.
$script:SzhBaseUtilisateur = ''
if ([string]$env:LOCALAPPDATA) {
  $script:SzhBaseUtilisateur = Join-Path $env:LOCALAPPDATA 'SZH'
} else {
  # Contexte sans profil (SYSTEM, session détachée) : le SID sépare, faute de %LOCALAPPDATA%.
  $script:SzhBaseUtilisateur = Join-Path $SzhBase ('comptes\' + (Get-SzhIdentite).sid)
}
$script:SzhEtatUtilisateurFile = Join-Path $SzhBaseUtilisateur 'etat-utilisateur.json'

function Get-SzhEtatUtilisateur {
  try {
    if (Test-Path $SzhEtatUtilisateurFile) {
      return (Get-Content $SzhEtatUtilisateurFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
  } catch { }
  return $null
}

# Sans exception : un état non écrit fait seulement refaire un travail idempotent au
# prochain passage, alors qu'une exception arrêterait une mise à jour réussie.
function Save-SzhEtatUtilisateur($Etat) {
  try {
    New-Item -ItemType Directory -Force -Path $SzhBaseUtilisateur | Out-Null
    Set-SzhJson $SzhEtatUtilisateurFile $Etat
    return $true
  } catch { return $false }
}

function Get-SzhEtatUtilisateurChamp($Etat, [string]$Nom) {
  if (-not $Etat) { return '' }
  try { if ($null -ne $Etat.$Nom) { return [string]$Etat.$Nom } } catch { }
  return ''
}

# ---- Secrets par compte : Shlink (raccourcisseur de liens) et OJS ----
#
# Lus dans etat-utilisateur.json (par compte) : l'adresse de l'instance Shlink en clair, et
# les deux clés d'API chiffrées par DPAPI (portée CurrentUser), que seul ce compte, sur ce
# poste, peut relire. Le cockpit range les siennes dans son propre coffre.

# Rend '' pour un champ vide, absent ou indéchiffrable (DPAPI d'un autre compte, fichier
# copié d'un autre poste), sans exception : une clé illisible vaut une clé absente.
function ConvertFrom-SzhSecretChiffre([string]$Chiffre) {
  if (-not $Chiffre) { return '' }
  $bstr = [IntPtr]::Zero
  try {
    $sec = ConvertTo-SecureString -String $Chiffre
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } catch { return '' }
  finally { if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) } }
}

# Adresse de l'instance Shlink, en clair : c'est une URL publique.
function Get-SzhShlinkUrl {
  return (Get-SzhEtatUtilisateurChamp (Get-SzhEtatUtilisateur) 'shlinkUrl')
}

# Clé d'API Shlink, rendue en clair : seulement pour l'environnement du processus enfant
# (Start-SzhCodium, szh-shell.ps1) ou le champ de l'interface, jamais pour un journal.
function Get-SzhShlinkCle {
  return (ConvertFrom-SzhSecretChiffre (Get-SzhEtatUtilisateurChamp (Get-SzhEtatUtilisateur) 'shlinkCle'))
}

# Clé d'API OJS, rangée comme la clé Shlink. Set-SzhEnvironnementSecrets la pose dans
# $env:SZH_OJS_CLE ; rien ne la lit encore côté WSL.
function Get-SzhOjsCle {
  return (ConvertFrom-SzhSecretChiffre (Get-SzhEtatUtilisateurChamp (Get-SzhEtatUtilisateur) 'ojsCle'))
}

# ---- Secrets Shlink/OJS dans l'environnement du processus enfant ----
#
# Trois variables, lues côté WSL par la chaîne de fabrication (pipeline/liens-courts.py pour
# SZH_SHLINK_URL et SZH_SHLINK_CLE ; SZH_OJS_CLE n'a pas encore de lecteur). Ni setx ni
# variable machine ou utilisateur : $env:… ne touche que ce processus PowerShell, et
# Start-Process (Start-SzhCodium dans szh-shell.ps1, Start-SzhCodiumFichier dans open-md.ps1)
# le transmet à VSCodium, comme $env:SZH_CODIUM_PROFIL. wsl.exe ne recopie l'environnement
# Windows que par WSLENV (voir docs/DEVELOPPEMENT.md, « L'instance de développement ») : les
# tâches du cockpit (`wsl.exe -d SZH-Publishing -- bash -c '… make …'`) ne voient ces
# variables que par ce moyen.
#
# Ces fonctions sont ici et non dans szh-shell.ps1 : open-md.ps1 (ouverture d'un .md par
# double-clic) ne charge que szh-common.ps1, et un article ouvert ainsi doit compiler avec
# les mêmes variables qu'une revue ouverte depuis le lanceur.
$script:SzhNomsSecretsWsl = @('SZH_SHLINK_URL', 'SZH_SHLINK_CLE', 'SZH_OJS_CLE')

# Ajoute nos noms à WSLENV avec /u (partagés de Win32 vers WSL seulement). Le reste de
# WSLENV est conservé : nos trois noms en sont d'abord retirés, avec ou sans suffixe, puis
# reposés pour ceux demandés. La fonction est donc idempotente. $NomsAPoser vide retire nos
# trois noms.
function Set-SzhWslEnvSecrets([string[]]$NomsAPoser = @()) {
  $existant = [string]$env:WSLENV
  $parties = @()
  if ($existant) { $parties = @($existant -split ':' | Where-Object { $_ }) }
  $gardes = @($parties | Where-Object {
      $nom = ($_ -split '/')[0]
      -not ($script:SzhNomsSecretsWsl -contains $nom)
    })
  foreach ($n in $NomsAPoser) { $gardes += ($n + '/u') }
  if ($gardes.Count -gt 0) { $env:WSLENV = ($gardes -join ':') }
  else { Remove-Item Env:WSLENV -ErrorAction SilentlyContinue }
}

# Pose SZH_SHLINK_URL, SZH_SHLINK_CLE et SZH_OJS_CLE dans l'environnement de ce processus,
# pour celles que le compte a réglées, et met WSLENV à jour. Une valeur vide n'est pas
# posée du tout : une variable vide arriverait dans WSL, et un filtre qui ne teste que sa
# présence s'y tromperait. Le journal ne reçoit que les noms, jamais les clés.
function Set-SzhEnvironnementSecrets {
  $poses = New-Object System.Collections.ArrayList
  $url = Get-SzhShlinkUrl
  if ($url) { $env:SZH_SHLINK_URL = $url; [void]$poses.Add('SZH_SHLINK_URL') }
  else { Remove-Item Env:SZH_SHLINK_URL -ErrorAction SilentlyContinue }

  $shlinkCle = Get-SzhShlinkCle
  if ($shlinkCle) { $env:SZH_SHLINK_CLE = $shlinkCle; [void]$poses.Add('SZH_SHLINK_CLE') }
  else { Remove-Item Env:SZH_SHLINK_CLE -ErrorAction SilentlyContinue }

  $ojsCle = Get-SzhOjsCle
  if ($ojsCle) { $env:SZH_OJS_CLE = $ojsCle; [void]$poses.Add('SZH_OJS_CLE') }
  else { Remove-Item Env:SZH_OJS_CLE -ErrorAction SilentlyContinue }

  Set-SzhWslEnvSecrets @($poses)
  if ($poses.Count -gt 0) {
    Write-SzhLog ('codium : variables WSL posées pour ce lancement -> ' + ($poses -join ', ') + ' (WSLENV=' + $env:WSLENV + ')')
  }
}

# ---- Version du logiciel installée ----
# Le fichier VERSION du toolkit d'abord, state.json en repli, chaîne vide sinon. Sans
# exception : le lanceur l'appelle sans console et ne s'ouvrirait pas. Pendant une mise à
# jour, VERSION peut être vide et state.json tronqué, d'où un try/catch par lecture.
function Get-SzhVersionInstallee {
  try {
    $fichier = Join-Path $SzhToolkit 'VERSION'
    if (Test-Path $fichier) {
      $brut = Get-Content $fichier -Raw -ErrorAction Stop
      if ($null -ne $brut) {
        $v = ([string]$brut).Trim()
        if ($v) { return $v }
      }
    }
  } catch { }
  try {
    $etat = Get-SzhState
    if ($etat -and $etat.version) { return ([string]$etat.version).Trim() }
  } catch { }
  return ''
}

# Trie par numéro, la plus récente d'abord : l'API GitHub trie par date de publication,
# et c'est dans cette liste qu'on cherche « la précédente ». [version] quand le tag s'y
# prête (2026.08.10 > 2026.08.7), ordre alphabétique inverse sinon.
function Sort-SzhVersions($Versions) {
  $paires = @()
  foreach ($v in $Versions) {
    $texte = [string]$v
    # « v1.2.3 » comme « 1.2.3 », comme dans Get-SzhMediumVersion : sinon « v1.0.1 » serait
    # classée parmi les non-numériques, après « 1.0.0 ».
    $nu = $texte -replace '^v', ''
    $num = $null
    $base = ''
    # La partie numérique s'arrête au premier caractère qui n'est ni un chiffre ni un point :
    # « 2026.08.10-rc1 » donne « 2026.08.10 », et non « 2026.08.101 ».
    if ($nu -match '^([0-9]+(\.[0-9]+)*)') { $base = $Matches[1] }
    if ($base) { try { $num = [version]$base } catch { $num = $null } }
    # Un suffixe (« -rc1 », « -local »…) se classe sous la version nue de même numéro : ce
    # n'est pas un numéro plus récent, mais une pré-version de celui-là.
    $suffixe = ($base -and ($base -ne $nu))
    $paires += [pscustomobject]@{ texte = $texte; num = $num; suffixe = $suffixe }
  }
  $avec = @($paires | Where-Object { $null -ne $_.num } |
    Sort-Object -Property @{Expression = 'num'; Descending = $true}, @{Expression = 'suffixe'; Descending = $false})
  $sans = @($paires | Where-Object { $null -eq $_.num } | Sort-Object -Property texte -Descending)
  return @(($avec + $sans) | ForEach-Object { $_.texte })
}

# Le medium d'un numéro de version (« 1.2 » pour 1.2.13), ou une chaîne vide pour un numéro
# qui n'est pas en majeure.medium.mineure. Les anciens numéros année.mois.compteur
# (2026.09.42) se reconnaissent à leur majeure supérieure à 2000 ; [version] les classerait
# sinon au-dessus des nouveaux. Le « 0.0.0-dev+<sha> » de l'instance de développement est
# écarté aussi, sa majeure étant nulle.
function Get-SzhMediumVersion([string]$Version) {
  $texte = ([string]$Version).Trim() -replace '^v', ''
  if ($texte -notmatch '^([0-9]+)[.]([0-9]+)[.][0-9]+') { return '' }
  $majeure = [int]$Matches[1]
  if (($majeure -lt 1) -or ($majeure -ge 2000)) { return '' }
  return ('{0}.{1}' -f $majeure, [int]$Matches[2])
}

# Ce que propose le sélecteur de version : une ligne par medium, avec sa mineure la plus
# récente (1.2.13, sans 1.2.12 ni les précédentes). Une mineure intermédiaire ne diffère de
# la suivante que par des correctifs. Les anciens numéros année.mois.compteur ne sont pas
# proposés ; update.ps1 -Version <numéro> permet encore d'y revenir.
function Select-SzhVersionsProposables($Versions) {
  $vues = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $retenues = @()
  # Après Sort-SzhVersions, la plus récente de chaque medium est la première vue, et une
  # pré-version (« 1.2.3-rc1 ») est classée sous la version nue de même numéro.
  foreach ($v in (Sort-SzhVersions $Versions)) {
    $medium = Get-SzhMediumVersion $v
    if (-not $medium) { continue }
    if (-not $vues.Add($medium)) { continue }
    # Le numéro sans « v » : il part en « update.ps1 -Version X », et Get-SzhManifestUrl
    # ajoute le « v » du tag.
    $retenues += (([string]$v).Trim() -replace '^v', '')
  }
  return @($retenues)
}

# Releases GitHub, les plus récentes d'abord ; tableau vide si le réseau manque ou refuse
# (403 de limite de débit). `per_page=100` : avec une seule page lue, les anciennes
# versions disparaîtraient de la liste.
function Get-SzhVersionsPubliees {
  try {
    $url = ('https://api.github.com/repos/{0}/releases?per_page=100' -f (Get-SzhRepo))
    $entetes = @{ 'User-Agent' = 'SZH-Publishing'; 'Accept' = 'application/vnd.github+json' }
    $releases = Invoke-RestMethod -Uri $url -Headers $entetes -UseBasicParsing -TimeoutSec 8
    $versions = @()
    foreach ($r in $releases) {
      if ($r.draft) { continue }
      $tag = [string]$r.tag_name
      if (-not $tag) { continue }
      $versions += ($tag -replace '^v', '')
    }
    return (Sort-SzhVersions $versions)
  } catch {
    return @()
  }
}

# Versions installables hors ligne : l'archive du toolkit et le manifest doivent être
# tous deux en staging, update.ps1 s'arrêtant dès sa première étape sans le manifest.
function Get-SzhVersionsLocales {
  $versions = @()
  Get-ChildItem (Join-Path $SzhStaging 'toolkit-*.zip') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | ForEach-Object {
      if ($_.Name -match '^toolkit-(.+)\.zip$') {
        $v = $Matches[1]
        if (Test-Path (Join-Path $SzhStaging ('manifest-{0}.json' -f $v))) { $versions += $v }
      }
    }
  return (Sort-SzhVersions $versions)
}

# Contrôle de la valeur : elle peut venir d'un nom de fichier de staging et part en argument
# de update.ps1, où « 2026.08.0 -Verbose » ajouterait un paramètre.
function Test-SzhVersionTag([string]$Version) {
  if (-not $Version) { return $false }
  return ($Version -match '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$')
}

# Contrôle de chemin : les champs *.file du manifest sont joints à $SzhStaging par
# Join-Path. Ils ne doivent être qu'un nom de fichier, sans séparateur ni « .. » qui
# sortirait du dossier de staging.
function Test-SzhNomFichierManifest([string]$Nom) {
  if (-not $Nom) { return $false }
  return ($Nom -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$')
}

# ---- Manifest (Release GitHub) ----

function Get-SzhManifestUrl([string]$Version) {
  $repo = Get-SzhRepo
  if ($Version) { return "https://github.com/$repo/releases/download/v$Version/manifest.json" }
  return "https://github.com/$repo/releases/latest/download/manifest.json"
}

# Chemin du manifest mis en cache pour une version donnée (staging).
function Get-SzhManifestCache([string]$Version) {
  return (Join-Path $SzhStaging ('manifest-{0}.json' -f $Version))
}

# Le réseau d'abord, le cache de staging ensuite, pour qu'une réinstallation reste
# possible hors ligne. Le cache est écrit par update.ps1 à chaque passage réussi, et n'est
# consulté que pour une version explicite : « latest » n'a de sens qu'en ligne.
function Get-SzhManifest([string]$Version) {
  try {
    # L'asset est servi en octet-stream : Invoke-RestMethod peut rendre une chaîne brute.
    $brut = Invoke-RestMethod -Uri (Get-SzhManifestUrl $Version) -UseBasicParsing -TimeoutSec 30
    if ($brut -is [string]) { return ($brut | ConvertFrom-Json) }
    if ($brut -is [byte[]]) { return ([Text.Encoding]::UTF8.GetString($brut) | ConvertFrom-Json) }
    return $brut
  } catch {
    if ($Version) {
      $cache = Get-SzhManifestCache $Version
      if (Test-Path $cache) {
        Write-SzhLog ('manifest hors ligne : cache de staging utilisé pour ' + $Version)
        return (Get-Content $cache -Raw -Encoding UTF8 | ConvertFrom-Json)
      }
    }
    throw
  }
}

# ---- Journal ----

function Write-SzhLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path $SzhLogs | Out-Null
  $ligne = ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Add-Content -Path (Join-Path $SzhLogs ('szh-{0}.log' -f (Get-Date -Format 'yyyy-MM'))) -Value $ligne -Encoding UTF8
}

# ---- Journaux de mise à jour (transcripts d'update.ps1) ----

# Ne garde que les $Garder dernières mises à jour du poste, par l'ordre de leur nom. Dans
# $SzhLogs et non SZH_JOURNAUX_MAJ : l'instance de dev lit les journaux du poste sans les
# effacer. Sans exception.
function Limit-SzhJournauxMaj {
  param([int]$Garder = 9)
  try {
    $anciens = @(Get-ChildItem -LiteralPath $SzhLogs -Filter 'update-*.log' -File -ErrorAction Stop |
      Sort-Object Name -Descending | Select-Object -Skip ([Math]::Max(0, $Garder)))
    foreach ($f in $anciens) {
      try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch { }
    }
  } catch { }
}

# Le journal mensuel (szh-AAAA-MM.log, Write-SzhLog) : les $Garder derniers mois, mêmes règles.
function Limit-SzhJournauxMensuels {
  param([int]$Garder = 3)
  try {
    $anciens = @(Get-ChildItem -LiteralPath $SzhLogs -Filter 'szh-*.log' -File -ErrorAction Stop |
      Where-Object { $_.Name -match '^szh-\d{4}-\d{2}\.log$' } |
      Sort-Object Name -Descending | Select-Object -Skip ([Math]::Max(0, $Garder)))
    foreach ($f in $anciens) {
      try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch { }
    }
  } catch { }
}

# ---- Téléchargement (barre de progression) ----

function Get-SzhFichier {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$Silencieux,
    [int]$Essais = 3
  )
  # Trois tentatives, et un fichier .part tant que le téléchargement n'est pas complet : une
  # connexion faible coupe souvent un gros fichier, et un fichier tronqué ne doit pas porter
  # le nom final.
  $partiel = $Destination + '.part'
  $derniere = $null
  for ($essai = 1; $essai -le [Math]::Max(1, $Essais); $essai++) {
    try {
      Get-SzhFichierUneFois -Url $Url -Destination $partiel -Silencieux:$Silencieux
      Move-Item -LiteralPath $partiel -Destination $Destination -Force
      return
    } catch {
      $derniere = $_
      try { if (Test-Path $partiel) { Remove-Item -LiteralPath $partiel -Force } } catch { }
      if ($essai -lt $Essais) {
        Write-SzhLog ('téléchargement : essai {0} échoué ({1}) -> nouvel essai' -f $essai, $_.Exception.Message)
        Start-Sleep -Seconds (2 * $essai)
      }
    }
  }
  throw $derniere
}

function Get-SzhFichierUneFois {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$Silencieux
  )
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.UserAgent = 'SZH-Publishing'
  $req.Timeout = 60000
  $req.ReadWriteTimeout = 600000
  $resp = $req.GetResponse()
  try {
    $total = $resp.ContentLength
    # -1 : le serveur n'a pas annoncé de taille (réponse « chunked », par exemple). La
    # complétude est alors contrôlée par Test-SzhSha256.
    if ($total -lt 0) { Write-SzhLog ('téléchargement : taille inconnue (Content-Length absent) -> ' + $Url) }
    $flux  = $resp.GetResponseStream()
    $sortie = [System.IO.File]::Create($Destination)
    try {
      $tampon = New-Object byte[] 262144
      $fait = [long]0
      $dernierPct = -1
      while ($true) {
        $n = $flux.Read($tampon, 0, $tampon.Length)
        if ($n -le 0) { break }
        $sortie.Write($tampon, 0, $n)
        $fait += $n
        if ((-not $Silencieux) -and ($total -gt 0)) {
          $pct = [int](100 * $fait / $total)
          if ($pct -ne $dernierPct) {
            $dernierPct = $pct
            $largeur = 24
            $plein = [int]($largeur * $pct / 100)
            $barre = ('#' * $plein).PadRight($largeur, '.')
            $etatMo = (T 'dl.format' @(($fait / 1MB), ($total / 1MB)))
            Write-Host -NoNewline ("`r    [{0}] {1,3} %  {2}    " -f $barre, $pct, $etatMo)
          }
        }
      }
      if (-not $Silencieux) { Write-Host '' }
    } finally {
      $sortie.Close()
      $flux.Close()
    }
  } finally {
    $resp.Close()
  }
  # Une coupure de connexion ne lève pas : le flux rend 0 comme à la fin normale. Sans
  # cette comparaison, un fichier tronqué passe pour complet.
  if (($total -gt 0) -and ($fait -lt $total)) {
    throw ('téléchargement incomplet : {0} octets sur {1}' -f $fait, $total)
  }
}

# ---- Place libre ----
# L'environnement de fabrication demande l'archive (0,6 Go) puis le disque virtuel qu'elle
# déplie (≈ 2,4 Go). Un disque plein laisserait un import à moitié fait (dossier créé,
# distribution absente), qui bloque les mises à jour suivantes. Mesure impossible : -1, et
# l'appelant laisse faire.
function Get-SzhEspaceLibreGo {
  param([string]$Chemin = '')
  if (-not $Chemin) { $Chemin = $SzhBase }
  try {
    $d = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($Chemin))
    return [Math]::Round($d.AvailableFreeSpace / 1GB, 1)
  } catch { return -1 }
}

# ---- Une seule mise à jour à la fois sur le poste ----
# « Global\ » rend le mutex visible à tout le poste : avec « Local\ », limité à la session,
# deux comptes connectés pourraient décompresser en même temps dans le même
# C:\ProgramData\SZH\toolkit. L'ACL doit nommer les Utilisateurs, sinon le deuxième compte
# se voit refuser l'ouverture et croit qu'une mise à jour est en cours.
function New-SzhMutexPoste {
  param([string]$Nom = 'SZH-Publishing-Update')
  try {
    $droits = New-Object System.Security.AccessControl.MutexSecurity
    $droits.AddAccessRule((New-Object System.Security.AccessControl.MutexAccessRule(
      (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')),
      [System.Security.AccessControl.MutexRights]::FullControl,
      [System.Security.AccessControl.AccessControlType]::Allow)))
    $cree = $false
    return (New-Object System.Threading.Mutex($false, ('Global\' + $Nom), [ref]$cree, $droits))
  } catch {
    # Poste où « Global\ » est refusé (SeCreateGlobalPrivilege retiré par stratégie) : un
    # verrou de session vaut mieux que pas de verrou.
    try { Write-SzhLog ('mutex : "Global\' + $Nom + '" refusé, repli sur "Local\' + $Nom + '" -> ' + $_.Exception.Message) } catch { }
    return (New-Object System.Threading.Mutex($false, ('Local\' + $Nom)))
  }
}

function Test-SzhSha256 {
  param([Parameter(Mandatory = $true)][string]$Fichier, [Parameter(Mandatory = $true)][string]$Attendu)
  if (-not (Test-Path $Fichier)) { return $false }
  $h = (Get-FileHash -Path $Fichier -Algorithm SHA256).Hash.ToLower()
  return ($h -eq $Attendu.ToLower())
}

# ---- Remplacement du toolkit ----
# `Expand-Archive -Force` écrase ce que l'archive contient, mais ne supprime pas ce qu'elle
# ne contient plus : sans ce nettoyage, un fichier retiré du dépôt resterait dans le toolkit
# de chaque poste.
#
# Une seule définition, appelée par update.ps1, update-launcher.ps1 et bootstrap.ps1.
#
# $Extrait est une extraction à part de la même archive, qui dit ce que cette version
# contient. Seuls les dossiers que l'archive gère sont nettoyés (voir $dossiersGeres et
# release.yml) ; rien hors de $Toolkit n'est regardé (state.json, config.json, staging,
# logs et l'état par compte sont ailleurs).
function Remove-SzhToolkitOrphelins {
  param(
    [Parameter(Mandatory = $true)][string]$Toolkit,
    [Parameter(Mandatory = $true)][string]$Extrait
  )
  # Forme longue dès l'entrée : $Toolkit et $Extrait peuvent arriver en forme courte 8.3
  # (dossier temporaire d'un runner de CI, C:\Users\RUNNER~1\...), alors que Get-ChildItem
  # rend toujours la forme longue dans FullName. Le calcul du chemin relatif plus bas
  # ($f.FullName.Substring($dansToolkit.Length)) suppose les deux de même longueur. Get-Item
  # résout un chemin existant ; GetFullPath sert pour un chemin absent. Écrit ici et non dans
  # une fonction à part : test/js/orphelins-toolkit.test.js extrait cette fonction seule.
  if ($Toolkit -and (Test-Path -LiteralPath $Toolkit)) { $Toolkit = (Get-Item -LiteralPath $Toolkit).FullName }
  elseif ($Toolkit) { $Toolkit = [System.IO.Path]::GetFullPath($Toolkit) }
  if ($Extrait -and (Test-Path -LiteralPath $Extrait)) { $Extrait = (Get-Item -LiteralPath $Extrait).FullName }
  elseif ($Extrait) { $Extrait = [System.IO.Path]::GetFullPath($Extrait) }
  $dossiersGeres = @('pipeline', 'vscodium-user', 'revue-template', 'livre-template', 'windows', 'moissonneurs')
  $retires = New-Object System.Collections.ArrayList
  $avertissements = New-Object System.Collections.ArrayList

  # ---- Contrôle global : l'extraction doit ressembler à un vrai toolkit ----
  # Une extraction vide viderait tous les dossiers gérés. Sans VERSION ou sans aucun des
  # dossiers gérés, le nettoyage est abandonné.
  $versionExtraite = Test-Path -LiteralPath (Join-Path $Extrait 'VERSION') -PathType Leaf
  $auMoinsUnDossier = $false
  foreach ($d in $dossiersGeres) {
    if (Test-Path -LiteralPath (Join-Path $Extrait $d) -PathType Container) { $auMoinsUnDossier = $true; break }
  }
  if ((-not $versionExtraite) -or (-not $auMoinsUnDossier)) {
    [void]$avertissements.Add('nettoyage abandonné en entier : extraction sans VERSION ni aucun des dossiers gérés -- rien n''est fiable à comparer')
    return [ordered]@{ retires = $retires; avertissements = $avertissements }
  }

  # Sous ce nombre de fichiers, une forte proportion d'orphelins reste plausible, et le
  # contrôle de vraisemblance ci-dessous ne s'applique pas.
  $seuilPlancherFichiers = 4
  # Au-delà de cette part d'un dossier géré, le nettoyage est invraisemblable pour une mise
  # à jour normale.
  $seuilProportionOrpheline = 0.5

  foreach ($d in $dossiersGeres) {
    $dansToolkit = Join-Path $Toolkit $d
    if (-not (Test-Path $dansToolkit)) { continue }
    $dansArchive = Join-Path $Extrait $d

    # ---- Contrôle par dossier : il doit exister dans l'archive extraite ----
    # Sinon tout le dossier du toolkit serait effacé. Il n'est pas touché ; les autres
    # dossiers sont jugés chacun pour soi.
    if (-not (Test-Path -LiteralPath $dansArchive -PathType Container)) {
      [void]$avertissements.Add('dossier absent de l''archive extraite, rien retiré -> ' + $d)
      continue
    }

    $fichiers = @(Get-ChildItem -LiteralPath $dansToolkit -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($fichiers.Count -eq 0) { continue }

    # Candidats orphelins : présents dans le toolkit, absents de l'archive. Tous calculés
    # avant toute suppression, pour le contrôle de vraisemblance.
    $candidats = New-Object System.Collections.ArrayList
    foreach ($f in $fichiers) {
      $relatif = $f.FullName.Substring($dansToolkit.Length).TrimStart('\')
      $cible = Join-Path $dansArchive $relatif
      if (-not (Test-Path -LiteralPath $cible)) {
        [void]$candidats.Add([ordered]@{ chemin = $f.FullName; relatif = $relatif })
      }
    }
    if ($candidats.Count -eq 0) { continue }

    # ---- Contrôle de vraisemblance ----
    # Une archive authentique mais incomplète (dossier source vidé avant le `cp -r` de
    # release.yml) passe les deux contrôles précédents : le dossier existe, mais presque vide.
    if (($fichiers.Count -ge $seuilPlancherFichiers) -and
        (($candidats.Count / [double]$fichiers.Count) -gt $seuilProportionOrpheline)) {
      [void]$avertissements.Add(('proportion invraisemblable, rien retiré -> {0} : {1}/{2} fichier(s) auraient été retirés' -f $d, $candidats.Count, $fichiers.Count))
      continue
    }

    foreach ($c in $candidats) {
      Remove-Item -LiteralPath $c.chemin -Force
      [void]$retires.Add((Join-Path $d $c.relatif))
    }

    # Dossiers restés vides, du plus profond au moins profond ; le dossier géré lui-même
    # ($dansToolkit) reste, même vide.
    Get-ChildItem -LiteralPath $dansToolkit -Recurse -Directory -Force -ErrorAction SilentlyContinue |
      Sort-Object { $_.FullName.Length } -Descending |
      Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
  return [ordered]@{ retires = $retires; avertissements = $avertissements }
}

# Remplace le toolkit d'un coup : la nouvelle version est construite dans <toolkit>.neuf
# (copie de l'actuel, complétée par l'archive, nettoyée par Remove-SzhToolkitOrphelins),
# puis mise en place par un renommage NTFS, tout ou rien.
#
# [System.IO.Directory]::Move et non Move-Item : Move-Item copie dossier par dossier, peut
# laisser le toolkit à moitié déplacé si un fichier est verrouillé, et peut créer
# <toolkit>\neuf au lieu de remplacer <toolkit> sans erreur. Directory.Move renomme le
# dossier en une seule opération, qui réussit ou échoue entièrement.
#
# $Zip : l'archive téléchargée, déjà vérifiée par sha256. $Toolkit : le dossier en service.
# $DossierTravail : où poser l'extraction de référence ($SzhStaging en service, un dossier
# jetable dans les tests).
#
# Rend le bilan de Remove-SzhToolkitOrphelins ({ retires; avertissements }). Lève
# (T 'err.toolkit') si la copie ou le renommage échoue, presque toujours à cause d'un
# fichier ouvert dans l'éditeur, après avoir remis le toolkit d'origine en place.
function Install-SzhToolkitDepuisArchive {
  param(
    [Parameter(Mandatory = $true)][string]$Zip,
    [Parameter(Mandatory = $true)][string]$Toolkit,
    [string]$DossierTravail = ''
  )
  # Forme longue dès l'entrée, comme dans Remove-SzhToolkitOrphelins (formes courtes 8.3 sur
  # un runner de CI). $neuf, $vieux et $extrait s'en déduisent ; $Toolkit est normalisé
  # avant que $DossierTravail n'en soit tiré par défaut.
  if ($Zip -and (Test-Path -LiteralPath $Zip)) { $Zip = (Get-Item -LiteralPath $Zip).FullName }
  elseif ($Zip) { $Zip = [System.IO.Path]::GetFullPath($Zip) }
  if ($Toolkit -and (Test-Path -LiteralPath $Toolkit)) { $Toolkit = (Get-Item -LiteralPath $Toolkit).FullName }
  elseif ($Toolkit) { $Toolkit = [System.IO.Path]::GetFullPath($Toolkit) }
  if (-not $DossierTravail) { $DossierTravail = Split-Path $Toolkit -Parent }
  if ($DossierTravail -and (Test-Path -LiteralPath $DossierTravail)) { $DossierTravail = (Get-Item -LiteralPath $DossierTravail).FullName }
  elseif ($DossierTravail) { $DossierTravail = [System.IO.Path]::GetFullPath($DossierTravail) }
  $neuf    = $Toolkit + '.neuf'
  $vieux   = $Toolkit + '.vieux'
  $extrait = Join-Path $DossierTravail ((Split-Path $Toolkit -Leaf) + '-verif-' + [guid]::NewGuid().Guid)
  $bilanOrphelins = [ordered]@{ retires = @(); avertissements = @() }

  # Restes d'une passe interrompue : la copie repart de zéro.
  foreach ($d in $neuf, $vieux) {
    if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
  }

  try {
    # ---- La copie, à côté du toolkit en service ----
    # Une lecture qui échoue ici (fichier ouvert dans l'éditeur) a la même cause qu'un
    # renommage refusé plus bas : même message, plutôt que l'exception .NET brute.
    try {
      New-Item -ItemType Directory -Force -Path $neuf | Out-Null
      if (Test-Path -LiteralPath $Toolkit) {
        Get-ChildItem -LiteralPath $Toolkit -Force | Copy-Item -Destination $neuf -Recurse -Force
      }
      Expand-Archive -Path $Zip -DestinationPath $neuf -Force
    } catch {
      throw (T 'err.toolkit')
    }

    # ---- Nettoyage des orphelins, sur la copie ----
    # Sans blocage : la copie reste un toolkit valide même avec des restes de l'ancienne
    # version.
    try {
      Expand-Archive -Path $Zip -DestinationPath $extrait -Force
      $bilanOrphelins = Remove-SzhToolkitOrphelins -Toolkit $neuf -Extrait $extrait
    } catch {
      Write-SzhLog ('Install-SzhToolkitDepuisArchive : nettoyage des orphelins non effectué : ' + $_.Exception.Message)
    } finally {
      if (Test-Path -LiteralPath $extrait) { Remove-Item -LiteralPath $extrait -Recurse -Force -ErrorAction SilentlyContinue }
    }

    # ---- Mise en place : deux renommages ----
    if (Test-Path -LiteralPath $Toolkit) {
      try {
        [System.IO.Directory]::Move($Toolkit, $vieux)
      } catch {
        throw (T 'err.toolkit')
      }
    }
    try {
      [System.IO.Directory]::Move($neuf, $Toolkit)
    } catch {
      # Le toolkit d'origine est dans $vieux : il est remis en place avant de lever, pour
      # que le poste garde un toolkit.
      if (Test-Path -LiteralPath $vieux) {
        try { [System.IO.Directory]::Move($vieux, $Toolkit) } catch { }
      }
      throw (T 'err.toolkit')
    }
    if (Test-Path -LiteralPath $vieux) { Remove-Item -LiteralPath $vieux -Recurse -Force -ErrorAction SilentlyContinue }
    return $bilanOrphelins
  } finally {
    if (Test-Path -LiteralPath $neuf) { Remove-Item -LiteralPath $neuf -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

# ---- Résolution d'exécutables ----

function Get-WslExe {
  $c = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in "$env:WINDIR\System32\wsl.exe", "$env:WINDIR\sysnative\wsl.exe") {
    if (Test-Path $p) { return $p }
  }
  throw 'wsl.exe introuvable.'
}

function Get-VSCodiumExe {
  foreach ($p in "$env:ProgramFiles\VSCodium\VSCodium.exe", "$env:LOCALAPPDATA\Programs\VSCodium\VSCodium.exe") {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Get-VSCodiumCli {
  foreach ($p in "$env:ProgramFiles\VSCodium\bin\codium.cmd", "$env:LOCALAPPDATA\Programs\VSCodium\bin\codium.cmd") {
    if (Test-Path $p) { return $p }
  }
  $c = Get-Command codium -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  return $null
}

# Le dossier de l'extension du cockpit installée pour ce compte (szh-csps.szh-cockpit-*, la
# plus récente sous %USERPROFILE%\.vscode-oss\extensions par date d'écriture), ou une chaîne
# vide. Get-SzhOutilCockpit (szh-shell.ps1) y cherche ensuite l'outil demandé.
#
# $env:SZH_COCKPIT_DOSSIER, s'il est posé, donne directement ce dossier, comme
# $env:SZH_RAPPORTS (szh-rapport.ps1) et $env:SZH_ANCRAGE (szh-ancrage.ps1). Les tests s'en
# servent pour viser le dépôt lui-même ou un dossier vide.
function Get-SzhDossierCockpit {
  if ($env:SZH_COCKPIT_DOSSIER) { return $env:SZH_COCKPIT_DOSSIER }
  $dossierExtensions = Join-Path $env:USERPROFILE '.vscode-oss\extensions'
  if (-not (Test-Path -LiteralPath $dossierExtensions)) { return '' }
  $candidats = @(Get-ChildItem -LiteralPath $dossierExtensions -Directory `
    -Filter 'szh-csps.szh-cockpit-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($candidats.Count -eq 0) { return '' }
  return $candidats[0].FullName
}

# Les extensions installées, telles que l'éditeur les liste pour ce compte (state.json est
# commun au poste, alors qu'une extension s'installe par utilisateur). Table id -> version,
# ou $null quand le CLI ne répond pas, à distinguer d'une table vide (profil neuf). Les
# tables PowerShell ignorent la casse, ce qu'il faut ici : l'éditeur écrit
# « MS-CEINTL.vscode-language-pack-de ».
function Get-SzhExtensionsInstallees {
  param([string]$Cli = '')
  if (-not $Cli) { $Cli = Get-VSCodiumCli }
  if (-not $Cli) { return $null }
  $table = @{}
  try {
    $lignes = Invoke-SzhNatif { & $Cli --list-extensions --show-versions 2>$null }
    if ($LASTEXITCODE -ne 0) { return $null }
    foreach ($l in @($lignes)) {
      $t = ([string]$l).Trim()
      $i = $t.LastIndexOf('@')
      if ($i -gt 0) { $table[$t.Substring(0, $i)] = $t.Substring($i + 1) }
    }
  } catch { return $null }
  return $table
}

# Toutes les extensions du manifest sont-elles installées, dans leur version, pour ce
# compte ? $true quand le CLI ne répond pas ou que l'éditeur manque : pas de mise à jour sur
# une mesure impossible.
function Test-SzhExtensionsAJour($Manifest) {
  if (-not $Manifest) { return $true }
  $reelles = Get-SzhExtensionsInstallees
  if ($null -eq $reelles) { return $true }
  foreach ($ext in @($Manifest.vsix)) {
    $id = [string]$ext.id
    if (-not $reelles.ContainsKey($id)) { return $false }
    if ($reelles[$id] -ne [string]$ext.version) { return $false }
  }
  return $true
}

# ---- Le disque de la distribution, par utilisateur ----
#
# L'enregistrement d'une distribution WSL est par utilisateur (HKCU\...\Lxss) : chaque
# compte a donc son propre dossier, sinon `wsl --import` d'un deuxième compte échouerait
# (ERROR_FILE_EXISTS) et `wsl --unregister` d'un compte effacerait le disque de l'autre.
# Le SID plutôt que le nom : deux domaines peuvent avoir le même nom de compte, et un
# compte renommé garde son SID.
function Get-SzhDossierDistro {
  param([string]$Sid = '')
  if (-not $Sid) { $Sid = (Get-SzhIdentite).sid }
  return (Join-Path $SzhBase ('WSL\' + $Sid + '\' + $SzhDistro))
}

# Les distributions enregistrées pour ce compte. `-l -q` ne rend que des noms, sans
# en-tête ni colonne d'état traduite ; les octets nuls viennent de l'UTF-16 de wsl.exe.
function Get-SzhDistrosEnregistrees {
  $noms = New-Object System.Collections.ArrayList
  try {
    # SZH_MANUSCRIT_WSL_EXE : point d'entrée de test, un faux wsl.exe à la place du vrai.
    $wsl = $env:SZH_MANUSCRIT_WSL_EXE
    if (-not $wsl) { $wsl = Get-WslExe }
    foreach ($l in @(Invoke-SzhNatif { & $wsl -l -q 2>$null })) {
      $n = (([string]$l) -replace "`0", '').Trim()
      if ($n) { [void]$noms.Add($n) }
    }
  } catch { }
  return $noms
}

# Un dossier de distribution présent alors que la distribution n'est pas enregistrée pour
# ce compte est un reste (installation interrompue, disque plein). Il est supprimé :
# l'environnement ne contient aucune donnée. Seulement si le dossier porte le nom de la
# distribution. Échoue si une machine WSL en marche tient encore le .vhdx ; l'appelant
# affiche alors « redémarrez le poste ».
function Clear-SzhDossierDistro {
  param([Parameter(Mandatory = $true)][string]$Dossier)
  if (-not (Test-Path $Dossier)) { return $false }
  if ((Split-Path $Dossier -Leaf) -ne $SzhDistro) {
    throw ('Dossier de distribution inattendu, rien n''a été supprimé : ' + $Dossier)
  }
  Remove-Item -LiteralPath $Dossier -Recurse -Force
  return $true
}

# L'environnement répond-il ? Un import réussi ne prouve pas que la distribution démarre :
# sans virtualisation (désactivée dans le firmware ou par une stratégie), l'import passe et
# le premier `--exec` échoue. Ce contrôle signale la panne à l'installation plutôt qu'au
# premier PDF.
function Test-SzhDistroRepond {
  try {
    $wsl = Get-WslExe
    Invoke-SzhNatif { & $wsl -d $SzhDistro --exec /bin/true 2>$null | Out-Null }
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

# Exécute un natif sans que ErrorActionPreference = 'Stop' ne fasse d'une ligne de stderr
# une erreur fatale : piège de PowerShell 5.1.
function Invoke-SzhNatif([scriptblock]$Bloc) {
  $ancien = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Bloc } finally { $ErrorActionPreference = $ancien }
}

# ---- Petite interface de terminal ----

function Write-SzhTitre([string]$Texte) {
  Write-Host ''
  Write-Host ('  ' + $Texte) -ForegroundColor Cyan
  Write-Host ('  ' + ('─' * $Texte.Length)) -ForegroundColor DarkCyan
}

# Bannière encadrée de l'installation et de la mise à jour.
function Write-SzhBanniere([string]$SousTitre) {
  $titre = (T 'app.titre')
  $larg = [Math]::Max($titre.Length, $SousTitre.Length) + 4
  $h = ('─' * $larg)
  Write-Host ''
  Write-Host ('  ┌' + $h + '┐') -ForegroundColor DarkCyan
  Write-Host '  │  ' -ForegroundColor DarkCyan -NoNewline
  Write-Host $titre.PadRight($larg - 4) -ForegroundColor Cyan -NoNewline
  Write-Host '  │' -ForegroundColor DarkCyan
  Write-Host '  │  ' -ForegroundColor DarkCyan -NoNewline
  Write-Host $SousTitre.PadRight($larg - 4) -ForegroundColor White -NoNewline
  Write-Host '  │' -ForegroundColor DarkCyan
  Write-Host ('  └' + $h + '┘') -ForegroundColor DarkCyan
}

function Write-SzhEtape([string]$Texte) { Write-Host ('  > ' + $Texte) }
function Write-SzhOk([string]$Texte)    { Write-Host ('    ✓ ' + $Texte) -ForegroundColor Green }
function Write-SzhInfo([string]$Texte)  { Write-Host ('    ' + $Texte) -ForegroundColor Gray }
# Ce qui n'a pas abouti sans faire echouer le reste : visible, mais pas rouge.
function Write-SzhAttention([string]$Texte) { Write-Host ('    ! ' + $Texte) -ForegroundColor Yellow }

# Rend un gabarit de courriel (windows/mail-templates/*.twig) avec lib/gabarits.js, le
# moteur du cockpit, par outils/rendre-gabarit.js (vscodium-extension/szh-cockpit), exécuté
# par le Node de VSCodium (ELECTRON_RUN_AS_NODE=1, Invoke-SzhNodeCockpit) : un aller-retour
# JSON sur stdin/stdout.
#
# Show-SzhErreur, seul appelant, est l'écran d'une mise à jour qui a échoué, y compris à la
# première installation, quand VSCodium peut manquer. Si l'exécutable, l'extension ou le
# script manquent, ou si le rendu échoue, la fonction ne lève pas : elle rend un message
# minimal tiré de szh-textes.ps1 (courriel.repli.*) et journalise la raison. Ce repli ne
# lit pas le .twig : c'est un texte d'incident, pas un second moteur.
function Get-SzhCourriel {
  param(
    [Parameter(Mandatory = $true)][string]$Nom,
    [Parameter(Mandatory = $true)][hashtable]$Variables,
    [string]$Langue = $SzhLangue
  )
  $dossierGabarits = Join-Path $PSScriptRoot 'mail-templates'
  $langueUtilisee = $Langue
  $chemin = Join-Path $dossierGabarits ($Nom + '.' + $Langue + '.twig')
  if (-not (Test-Path -LiteralPath $chemin)) {
    $langueUtilisee = 'fr'
    $chemin = Join-Path $dossierGabarits ($Nom + '.fr.twig')
  }
  if (-not (Test-Path -LiteralPath $chemin)) {
    throw ('gabarit de courriel introuvable : « ' + $Nom + ' » (langue « ' + $Langue +
      ' », et son repli français absent aussi)')
  }

  $raisonRepli = $null
  $sujetFinal = ''
  $corpsFinal = ''
  try {
    $reponse = Invoke-SzhNodeCockpit -Outil 'rendre-gabarit.js' -Entree ([pscustomobject]@{ chemin = $chemin; variables = $Variables })
    $objetRendu = $null
    try { $objetRendu = $reponse.Sortie.Trim() | ConvertFrom-Json -ErrorAction Stop } catch { $objetRendu = $null }
    if ($reponse.CodeSortie -ne 0 -or (-not $objetRendu) -or (-not $objetRendu.ok)) {
      $detailErreur = ''
      if ($objetRendu -and $objetRendu.erreur) { $detailErreur = [string]$objetRendu.erreur }
      if (-not $detailErreur) { $detailErreur = $reponse.Erreur.Trim() }
      if (-not $detailErreur) { $detailErreur = 'code de sortie ' + $reponse.CodeSortie }
      throw ('rendre-gabarit.js : ' + $detailErreur)
    }

    $blocsRendus = $objetRendu.blocs
    # Même convention que lib/courriel.js#rendreCourriel : le sujet perd ses blancs de bord,
    # le corps un retour à la ligne après l'ouverture du bloc et un avant sa fermeture,
    # présents dans le gabarit pour la lisibilité.
    if ($blocsRendus -and ($blocsRendus.PSObject.Properties.Name -contains 'sujet')) {
      $sujetFinal = ([string]$blocsRendus.sujet).Trim()
    }
    if ($blocsRendus -and ($blocsRendus.PSObject.Properties.Name -contains 'corps')) {
      $corpsFinal = (([string]$blocsRendus.corps) -replace '^\n', '') -replace '\n$', ''
    }
  } catch {
    $raisonRepli = $_.Exception.Message
  }

  if ($null -eq $raisonRepli) {
    $sujetFinal = $sujetFinal -replace '\n', "`r`n"
    $corpsFinal = $corpsFinal -replace '\n', "`r`n"
    return [pscustomobject]@{ sujet = $sujetFinal; corps = $corpsFinal }
  }

  # ---- Repli : texte simple tiré de szh-textes.ps1 ----
  try { Write-SzhLog ('Get-SzhCourriel : repli en texte simple (' + $Nom + ', ' + $Langue + ') -- ' + $raisonRepli) } catch { }
  $posteRepli = ''
  if ($Variables.Contains('poste')) { $posteRepli = [string]$Variables['poste'] }
  $etapeRepli = ''
  if ($Variables.Contains('etape')) { $etapeRepli = [string]$Variables['etape'] }
  $messageRepli = ''
  if ($Variables.Contains('message')) { $messageRepli = [string]$Variables['message'] }
  $journalRepli = ''
  if ($Variables.Contains('journal')) { $journalRepli = [string]$Variables['journal'] }
  $sujetFinal = (T 'courriel.repli.sujet' @($posteRepli)) -replace '\n', "`r`n"
  $corpsFinal = (T 'courriel.repli.corps' @($etapeRepli, $messageRepli, $journalRepli)) -replace '\n', "`r`n"
  return [pscustomobject]@{ sujet = $sujetFinal; corps = $corpsFinal }
}

# Mode sans interaction (update.ps1 -Silencieux, posé par update-launcher.ps1 quand
# Get-SzhMajSilencieuse est actif) : personne ne voit la fenêtre, et le ReadKey de
# Show-SzhErreur bloquerait le processus indéfiniment, mutex de mise à jour compris. Faux
# par défaut : une fenêtre ouverte à la main garde son écran d'erreur interactif.
$script:SzhSansInteraction = $false

# Écran d'erreur final : message calme, contact, e-mail pré-rempli, accès au journal.
# -Code distingue les deux appels d'update.ps1 (échec d'une étape ou échec total) dans le
# rapport d'erreur automatique (docs/RAPPORTS-ERREUR.md, szh-rapport.ps1). Write-SzhRapport
# ne bloque pas et n'affiche rien.
function Show-SzhErreur {
  param([string]$Etape, [string]$Message, [string]$Journal, [string]$Code = 'MAJ-ECHEC')
  try { Write-SzhRapport -Code $Code -Source 'maj' -Etape $Etape -Message $Message -Journal $Journal } catch { }
  Write-Host ''
  Write-Host ('  ' + (T 'err.titre')) -ForegroundColor Yellow
  Write-Host ('  ' + (T 'err.l.etape' @($Etape)))
  Write-Host ('  ' + (T 'err.l.detail' @($Message)))
  if ($Journal) { Write-Host ('  ' + (T 'err.l.journal' @($Journal))) }
  Write-Host ''
  Write-Host ('  ' + (T 'err.rassure')) -ForegroundColor Green
  Write-Host ('  ' + (T 'err.retry' @($SzhSupport)))
  Write-Host ''
  # Mode silencieux : le rapport est parti et l'erreur reste dans le journal (onglet
  # « Journal » du lanceur). Le menu et l'attente d'une touche bloqueraient le processus,
  # mutex compris : la fonction rend la main.
  if ($script:SzhSansInteraction) {
    try { Write-SzhLog ('update : erreur survenue en mode silencieux (' + $Etape + ') -> ' + $Message) } catch { }
    return
  }
  Write-Host ('  ' + (T 'err.menu'))
  try {
    $touche = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    $car = [string]$touche.Character
  } catch { $car = '' }
  if ($car -eq 'e' -or $car -eq 'E') {
    $rendu = Get-SzhCourriel -Nom 'support' -Variables @{
      poste = $env:COMPUTERNAME; etape = $Etape; message = $Message; journal = $Journal
    }
    $sujet = $rendu.sujet
    $corps = $rendu.corps
    if ($corps.Length -gt 1500) { $corps = $corps.Substring(0, 1500) }   # limite de longueur d'un mailto
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $SzhSupport, [Uri]::EscapeDataString($sujet), [Uri]::EscapeDataString($corps))
    Start-Process $uri
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
  } elseif ($car -eq 'o' -or $car -eq 'O') {
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
    else { Start-Process explorer.exe $SzhLogs }
  }
}
