# Socle commun des scripts SZH — à dot-sourcer :  . "$PSScriptRoot\szh-common.ps1"
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

$ErrorActionPreference = 'Stop'

# Les trois fils, dans l'ordre de leurs dépendances : les textes avant que T (plus bas) ne
# s'en serve, les produits après les fonctions de config qu'ils appellent (résolues à
# l'appel, jamais à la lecture), le shell en dernier car il se sert des deux premiers.
# $SzhBaseUtilisateur (plus bas) est calculé après ce dot-source et n'en dépend pas, mais
# szh-taches.ps1, dot-sourcé ensuite par les scripts appelants, le lit dès son chargement.
. "$PSScriptRoot\szh-textes.ps1"
. "$PSScriptRoot\szh-produits.ps1"
. "$PSScriptRoot\szh-shell.ps1"
# Affectation, pas -bor : un -bor sur la valeur en place garde SSL3/TLS 1.0 si le poste les
# avait déjà, aux côtés de TLS 1.2. Tls13 en plus quand l'énumération de ce .NET la connaît
# -- absente sur des postes plus anciens, d'où le try/catch plutôt qu'une casse à l'ouverture
# même du script.
$szhTls = [Net.SecurityProtocolType]::Tls12
try { $szhTls = $szhTls -bor [Net.SecurityProtocolType]::Tls13 } catch { }
[Net.ServicePointManager]::SecurityProtocol = $szhTls

# Proxy d'entreprise : sans ces deux lignes, un proxy qui demande une authentification rend
# 407 à chaque téléchargement, et l'installation d'un poste devient impossible sans qu'un
# message le dise. Les identifiants de la session suffisent (Kerberos ou NTLM), aucune
# saisie n'est demandée ; sans proxy, la valeur est inoffensive.
try {
  $proxySysteme = [Net.WebRequest]::GetSystemWebProxy()
  $proxySysteme.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
  [Net.WebRequest]::DefaultWebProxy = $proxySysteme
} catch { }

# ---- Environnement hérité : ELECTRON_RUN_AS_NODE ----
# ⚠ Tout processus lancé par l'hôte d'extensions de VSCodium hérite de
# ELECTRON_RUN_AS_NODE=1 : Electron se prend alors pour Node et `VSCodium.exe "<dossier>"`
# cherche un script au lieu d'ouvrir le dossier, puis meurt sans fenêtre. D'où ce
# nettoyage à l'entrée de chaque script, le dot-source étant le seul passage obligé.
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
# Trois sources, par ordre de priorité : la variable d'environnement (pour un essai), la
# préférence enregistrée par le dernier lanceur ouvert, puis la langue d'affichage de
# Windows. Anglais en dernier recours seulement : les postes d'ici affichent Windows en
# anglais, et le lanceur parlait donc anglais à des équipes francophone et germanophone.
# Textes allemands en orthographe suisse (ss, pas de ß).
$script:SzhLangue = 'en'
try {
  $langueUi = (Get-UICulture).TwoLetterISOLanguageName.ToLower()
  if ($langueUi -eq 'fr' -or $langueUi -eq 'de') { $script:SzhLangue = $langueUi }
} catch { }
# Lecture directe, sans Get-SzhState : la table des textes est utilisée dès le début du
# script, avant que les fonctions de plus bas soient définies pour tout le monde.
try {
  if (Test-Path $SzhStateFile) {
    $etatLangue = (Get-Content $SzhStateFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    $memo = [string]$etatLangue.langue
    if (@('fr', 'de') -contains $memo) { $script:SzhLangue = $memo }
  }
} catch { }
if ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower())) {
  $script:SzhLangue = $env:SZH_LANGUE.ToLower()
}


# « Revues SZH » parle français, « Zeitschriften SZH » allemand : chaque lanceur s'adresse à
# son équipe, pas à la langue de Windows. Vaut aussi pour ce qui n'a pas de produit, la mise
# à jour surtout, qui s'ouvre seule. $env:SZH_LANGUE garde le dernier mot, pour un essai.
#
# ⚠ Le livre est l'exception : il s'écrit dans sa propre langue (`lang:` de buch.yaml), jamais
#   celle d'un produit. Le lanceur « Books SZH-CSPS » appelle quand même cette fonction, pour
#   rester au même endroit que les deux autres, mais elle n'y change rien : $SzhLangue garde
#   ce que la cascade du haut du fichier a déjà résolu.
function Set-SzhLangueProduit([string]$Produit) {
  if (([string]$Produit).ToLower() -eq 'livre') { return }
  $voulue = if (([string]$Produit).ToLower() -eq 'zeitschrift') { 'de' } else { 'fr' }
  if ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower())) { return }
  $script:SzhLangue = $voulue
  try {
    $etat = Get-SzhState
    if (-not $etat) { $etat = New-Object psobject }
    if ($etat.PSObject.Properties['langue']) { $etat.langue = $voulue }
    else { $etat | Add-Member -MemberType NoteProperty -Name 'langue' -Value $voulue }
    Save-SzhState $etat
  } catch { }        # préférence non écrite : la session courante reste dans la bonne langue
}

# T 'clé' @(args…) -> texte dans la langue courante, fallback anglais, sinon la clé.
#
# Le jeton {racine} est remplacé par l'étiquette de la racine active (Get-SzhEtiquetteRacine) :
# un texte peut ainsi dire où vivent les revues sans que chaque appelant le passe en argument
# — c'est ce qui met l'emplacement actif dans le titre du lanceur. Substitué avant `-f`, un
# chemin ne portant pas d'accolade ; les textes 'racine.*' n'ont pas le jeton, donc pas de
# récursion.
function T {
  param([Parameter(Mandatory = $true)][string]$Cle, [object[]]$Valeurs)
  $texte = $null
  $table = $SzhTextes[$SzhLangue]
  if ($table -and $table.ContainsKey($Cle)) { $texte = $table[$Cle] }
  if (-not $texte) { $texte = $SzhTextes['en'][$Cle] }
  if (-not $texte) { return $Cle }
  if ($texte -like '*{racine}*') { $texte = $texte.Replace('{racine}', (Get-SzhEtiquetteRacine)) }
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

# Lectures tolérantes : un fichier tronqué ou en cours d'écriture ne doit pas faire
# échouer un script qui n'a rien à voir, le lanceur d'abord, qui n'a pas de console.
function Get-SzhConfig {
  try {
    if (Test-Path $SzhConfigFile) { return (Get-Content $SzhConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
  } catch { }
  return $null
}

$script:SzhRepoDefaut = 'SZH-CSPS/szh-publishing-toolchain'

# La clé n'est surchargeable que vers un autre dépôt de l'organisation : config.json est
# inscriptible par les Utilisateurs, et sans ce filtre, un poste pourrait être pointé vers
# n'importe quel dépôt GitHub pour tout son approvisionnement (toolkit, rootfs, extensions).
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
  # Sans BOM, par Set-SzhJson : Set-Content -Encoding UTF8 en pose un sous PowerShell 5.1,
  # que lib/archivage.js retire par contournement (BOM connu, pas corrigé à sa source).
  Set-SzhJson $SzhStateFile $Etat
}

# Écrit les clés données sans effacer le reste du fichier. state.json porte aussi la langue
# choisie par le dernier lanceur ouvert (Set-SzhLangueProduit), et une réécriture complète
# l'effaçait à chaque mise à jour : sur ces postes, dont Windows est en anglais, le lanceur
# reparlait anglais à une équipe francophone jusqu'au prochain clic sur « Revues SZH ».
# $Retirer : les clés d'une version antérieure qui ne veulent plus rien dire là où elles
# sont. `rootfs` et `vsix` ont déménagé dans l'état par utilisateur, et les laisser ici
# donnerait deux vérités pour une même question — celle qui a fait croire à un compte neuf
# que tout était déjà installé.
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
# support tourne sous le compte du support : HKCU, %APPDATA%, %LOCALAPPDATA% et
# l'enregistrement des distributions WSL sont ceux du support. Tout ce qui est « par
# utilisateur » atterrit alors dans le mauvais profil, et le rédacteur ouvre sa session
# sans raccourcis, sans extensions, sans réglages ni environnement de fabrication, sans
# qu'aucun journal ne le dise (les lignes « raccourcis posés » ne nommaient pas le compte).
# D'où ces deux mesures, et le nom du compte dans chaque ligne qui pose quelque chose par
# utilisateur.
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
# lui le rédacteur, même quand le script tourne sous un autre compte. Vide si personne
# n'est connecté ou si la mesure échoue — un doute ne doit pas arrêter une installation,
# il doit se lire dans le journal. Plusieurs sessions ouvertes : le premier propriétaire
# lisible, ce qui suffit au seul usage qu'on en fait, dire « ce n'est pas moi ».
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
# state.json vit dans C:\ProgramData\SZH : il est donc commun à tous les comptes du poste.
# Or l'enregistrement de la distribution WSL et les extensions de l'éditeur sont, eux, par
# utilisateur. Un état commun affirmait « environnement 2026.08.42 installé, dix extensions
# posées » à un compte qui n'avait ni l'un ni les autres, et la mise à jour les sautait
# comme « déjà à jour » : le rédacteur se retrouvait sans cockpit, sans que rien n'échoue.
# Ce qui est par utilisateur se retient donc chez lui.
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

# Jamais bloquant : un état non écrit fait refaire un travail idempotent au prochain
# passage, alors qu'une exception ici arrêterait une mise à jour par ailleurs réussie.
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

# ---- Version du logiciel installée ----
# Le fichier VERSION du toolkit d'abord, state.json en repli, chaîne vide sinon. Ne doit
# jamais lever : le lanceur l'appelle sans console, et une exception l'empêcherait de
# s'ouvrir sans laisser de trace. Pendant une mise à jour, VERSION peut être vide et
# state.json tronqué, d'où un try/catch par lecture.
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
    $num = $null
    $base = ''
    # La partie numérique s'arrête au premier caractère qui n'est ni un chiffre ni un point :
    # « 2026.08.10-rc1 » donne « 2026.08.10 », pas « 2026.08.101 » (l'ancien
    # -replace '[^0-9.]', '' recollait les chiffres du suffixe à la version nue, faisant
    # passer une pré-version pour une version plus récente).
    if ($texte -match '^([0-9]+(\.[0-9]+)*)') { $base = $Matches[1] }
    if ($base) { try { $num = [version]$base } catch { $num = $null } }
    # Un suffixe (« -rc1 », « -local »…) se classe sous la version nue de même numéro : ce
    # n'est pas un numéro plus récent, mais une pré-version de celui-là.
    $suffixe = ($base -and ($base -ne $texte))
    $paires += [pscustomobject]@{ texte = $texte; num = $num; suffixe = $suffixe }
  }
  $avec = @($paires | Where-Object { $null -ne $_.num } |
    Sort-Object -Property @{Expression = 'num'; Descending = $true}, @{Expression = 'suffixe'; Descending = $false})
  $sans = @($paires | Where-Object { $null -eq $_.num } | Sort-Object -Property texte -Descending)
  return @(($avec + $sans) | ForEach-Object { $_.texte })
}

# Releases GitHub, les plus récentes d'abord ; tableau vide si le réseau manque ou refuse
# (403 de limite de débit). `per_page=100` : une page manquée ferait disparaître en
# silence les anciennes versions, celles-là mêmes qu'on cherche.
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

# Garde-fou de quoting : la valeur peut venir d'un nom de fichier de staging et part en
# argument de update.ps1, où « 2026.08.0 -Verbose » injecterait un paramètre.
function Test-SzhVersionTag([string]$Version) {
  if (-not $Version) { return $false }
  return ($Version -match '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$')
}

# Garde-fou de chemin : les champs *.file du manifest (manifest.json, servi par la Release
# mais rejoint tel quel à $SzhStaging via Join-Path) ne doivent désigner qu'un nom de fichier
# — jamais un séparateur ni un « .. » qui écrirait ou lirait hors du dossier de staging.
function Test-SzhNomFichierManifest([string]$Nom) {
  if (-not $Nom) { return $false }
  return ($Nom -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$')
}

# ---- Sélecteur de version du logiciel ----
# Partagé par les trois produits (open-produit.ps1, bouton « Changer de version… ») :
# recomposer un ancien numéro à l'identique suppose de réinstaller la version qui l'a
# fabriqué ; `update.ps1 -Version X` sait le faire, ce dialogue le rend atteignable, et
# explicitement : le changement remplace le rootfs WSL et les extensions, et demande un
# redémarrage de l'éditeur.
#
# $Parent : fenêtre appelante, ou $null en processus détaché (le sélecteur ouvert seul, hors
# du lanceur). $FichierIcone : icône de ce lanceur (szh-revue.ico, szh-zeitschrift.ico ou
# szh-livre.ico) — chaque produit garde la sienne, cette fonction ne décide donc pas d'icône
# elle-même. Chargée en tableau d'octets et non par nom de fichier : Icon(String) garderait
# le .ico ouvert tant que la fenêtre vit, et une mise à jour concurrente ne pourrait pas le
# remplacer. Ne lève jamais, une icône n'étant pas une condition d'ouverture.
function Show-SzhVersions($Parent, [string]$FichierIcone) {
  $installee = Get-SzhVersionInstallee
  # Aucun appel réseau ici : la liste est remplie au Shown, plus bas ; le faire avant
  # l'affichage fige la fenêtre jusqu'au bout du timeout.
  $locales = @(Get-SzhVersionsLocales)
  $disponibles = New-Object System.Collections.ArrayList

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.versions.titre')
  if ($Parent) { $boite.StartPosition = 'CenterParent' } else { $boite.StartPosition = 'CenterScreen' }
  $boite.ClientSize = New-Object System.Drawing.Size(460, 340)
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false
  # Atteignable sans la fenêtre principale : elle a son propre bouton de barre des tâches,
  # donc son propre besoin d'icône.
  if ($FichierIcone -and (Test-Path $FichierIcone)) {
    try {
      $flux = New-Object System.IO.MemoryStream (,[System.IO.File]::ReadAllBytes($FichierIcone))
      $boite.Icon = New-Object System.Drawing.Icon $flux
    } catch {
      Write-SzhLog ('Show-SzhVersions : icone non chargee (' + $_.Exception.Message + ')')
    }
  }

  $intro = New-Object System.Windows.Forms.Label
  $etiqInstallee = $installee
  if (-not $etiqInstallee) { $etiqInstallee = '?' }
  $intro.Text = (T 'lanceur.versions.intro' @($etiqInstallee))
  $intro.Location = New-Object System.Drawing.Point(16, 14)
  $intro.Size = New-Object System.Drawing.Size(428, 34)
  $boite.Controls.Add($intro)

  $liVersions = New-Object System.Windows.Forms.ListBox
  $liVersions.Location = New-Object System.Drawing.Point(16, 54)
  $liVersions.Size = New-Object System.Drawing.Size(428, 180)
  $liVersions.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $boite.Controls.Add($liVersions)

  $note = New-Object System.Windows.Forms.Label
  $note.Text = (T 'lanceur.versions.chargement')
  $note.Location = New-Object System.Drawing.Point(16, 240)
  $note.Size = New-Object System.Drawing.Size(428, 44)
  $note.ForeColor = [System.Drawing.Color]::DimGray
  $boite.Controls.Add($note)

  $bInstaller = New-Object System.Windows.Forms.Button
  $bInstaller.Text = (T 'lanceur.versions.installer')
  $bInstaller.Location = New-Object System.Drawing.Point(248, 292)
  $bInstaller.Size = New-Object System.Drawing.Size(96, 32)
  $bInstaller.Enabled = $false                     # activé quand la liste est peuplée
  $boite.Controls.Add($bInstaller)

  $bFermer = New-Object System.Windows.Forms.Button
  $bFermer.Text = (T 'lanceur.annuler')
  $bFermer.Location = New-Object System.Drawing.Point(350, 292)
  $bFermer.Size = New-Object System.Drawing.Size(94, 32)
  $bFermer.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $boite.Controls.Add($bFermer)
  $boite.CancelButton = $bFermer

  # La liste se remplit après l'affichage : la fenêtre est là tout de suite, et l'attente
  # réseau se voit au lieu de figer l'interface.
  $boite.Add_Shown({
    $boite.Refresh()
    $publiees = @(Get-SzhVersionsPubliees)
    foreach ($v in $publiees) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
    foreach ($v in $locales) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
    if ($installee -and (-not $disponibles.Contains($installee))) { [void]$disponibles.Insert(0, $installee) }
    foreach ($v in $disponibles) {
      if ($v -eq $installee) { [void]$liVersions.Items.Add((T 'lanceur.versions.installee' @($v))) }
      elseif ($locales -contains $v) { [void]$liVersions.Items.Add((T 'lanceur.versions.locale' @($v))) }
      else { [void]$liVersions.Items.Add($v) }
    }
    if ($liVersions.Items.Count -gt 0) { $liVersions.SelectedIndex = 0 }
    # Trois états à nommer : liste complète, hors ligne avec un repli réel, hors ligne
    # sans repli (seule la version installée, donc rien à installer).
    if ($publiees.Count -gt 0) { $note.Text = '' }
    elseif ($locales.Count -gt 0) { $note.Text = (T 'lanceur.versions.horsligne') }
    else { $note.Text = (T 'lanceur.versions.horsligne.deja') }
    if ($disponibles.Count -eq 0) { $note.Text = (T 'lanceur.versions.vide') }
    $bInstaller.Enabled = ($disponibles.Count -gt 0)
  })

  $bInstaller.Add_Click({
    if ($liVersions.SelectedIndex -lt 0) { return }
    $choix = [string]$disponibles[$liVersions.SelectedIndex]
    # Garde-fou de quoting : la valeur peut venir d'un nom de fichier de staging et part
    # en argument de update.ps1, où « 2026.08.0 -Verbose » injecterait un paramètre.
    if (-not (Test-SzhVersionTag $choix)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.versions.vide'), (T 'lanceur.versions.titre'))
      return
    }
    $reponse = [System.Windows.Forms.MessageBox]::Show(
      (T 'lanceur.versions.avert' @($choix)), (T 'lanceur.versions.titre'),
      [System.Windows.Forms.MessageBoxButtons]::OKCancel,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($reponse -ne [System.Windows.Forms.DialogResult]::OK) { return }
    # update.ps1 fait le reste, sans demander l'administrateur. Chaque argument est cité,
    # le chemin du toolkit contenant des espaces.
    Write-SzhLog ('Show-SzhVersions : installation de la version ' + $choix + ' demandee')
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      ('"{0}"' -f (Join-Path $PSScriptRoot 'update.ps1')), '-Version', ('"{0}"' -f $choix))
    $boite.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $boite.Close()
  })

  # Sans parent (processus détaché), rien ne garantit le premier plan, et une boîte qui
  # s'ouvre derrière VSCodium se lit comme un bouton inerte.
  $resultat = [System.Windows.Forms.DialogResult]::Cancel
  if ($Parent) { $resultat = $boite.ShowDialog($Parent) }
  else {
    $boite.TopMost = $true
    $resultat = $boite.ShowDialog()
  }
  # $true = une installation a été lancée : l'appelant doit se retirer.
  return ($resultat -eq [System.Windows.Forms.DialogResult]::OK)
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

# ---- Téléchargement (barre de progression) ----

function Get-SzhFichier {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$Silencieux,
    [int]$Essais = 3
  )
  # Trois tentatives, et un fichier temporaire tant que le téléchargement n'est pas
  # complet. Deux pannes réelles derrière ces deux mesures : 574 Mo sur un wifi d'hôtel
  # coupent une fois sur trois, et une coupure ne lève pas — le flux rend simplement 0,
  # donc le fichier tronqué portait le bon nom et n'était rejeté qu'à l'empreinte, une
  # minute plus tard, en faisant échouer toute la mise à jour au lieu de réessayer.
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
    # complétude ne se contrôle alors pas ici — c'est Test-SzhSha256, plus loin, qui tranche.
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
# déplie (≈ 2,4 Go). Un disque plein laissait un import à moitié fait : dossier pris,
# distribution absente — exactement l'état qui bloque toutes les mises à jour suivantes.
# Mesure impossible : on rend -1, et l'appelant n'empêche rien sur un doute.
function Get-SzhEspaceLibreGo {
  param([string]$Chemin = '')
  if (-not $Chemin) { $Chemin = $SzhBase }
  try {
    $d = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($Chemin))
    return [Math]::Round($d.AvailableFreeSpace / 1GB, 1)
  } catch { return -1 }
}

# ---- Une seule mise à jour à la fois sur le poste ----
# « Local\ » borne le mutex à la session : deux comptes connectés en même temps détendaient
# donc deux Expand-Archive sur le même C:\ProgramData\SZH\toolkit, qui finit à moitié
# écrit. « Global\ » le rend visible à tout le poste, et son ACL doit nommer les
# Utilisateurs : sans elle, le deuxième compte se voit refuser l'ouverture et croit qu'une
# mise à jour est en cours alors qu'il n'y en a aucune.
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
# `Expand-Archive -Force` écrase ce que l'archive contient, mais ne supprime jamais ce
# qu'elle ne contient plus : un fichier retiré du dépôt survivrait donc indéfiniment dans le
# toolkit de chaque poste, mise à jour après mise à jour.
#
# Une seule définition, appelée par update.ps1, update-launcher.ps1 et bootstrap.ps1 : trois
# copies la feraient diverger sans que rien ne le signale.
#
# $Extrait est une extraction à part de la même archive : elle dit exactement ce que cette
# version contient. Uniquement dans les dossiers que l'archive gère (release.yml : pipeline,
# vscodium-user, revue-template, livre-template, windows) — un dossier qui n'appartient pas
# à l'archive n'a pas à être jugé par elle, et c'est cette limite qui rend l'opération sûre.
# Rien hors $Toolkit n'est même regardé : state.json, config.json, staging, logs et l'état
# par compte vivent ailleurs.
function Remove-SzhToolkitOrphelins {
  param(
    [Parameter(Mandatory = $true)][string]$Toolkit,
    [Parameter(Mandatory = $true)][string]$Extrait
  )
  # Forme longue dès l'entrée : $Toolkit et $Extrait peuvent arriver en forme courte 8.3 (le
  # dossier temporaire d'un runner de CI, par exemple C:\Users\RUNNER~1\...) alors que
  # Get-ChildItem -Recurse rend TOUJOURS la forme longue dans FullName -- vérifié : passer un
  # chemin court à Get-ChildItem -LiteralPath ne fait pas ressortir ce même chemin court dans
  # FullName, mais le nom réel, plus long, du dossier. Le calcul de relatif plus bas
  # ($f.FullName.Substring($dansToolkit.Length)) suppose que les deux mesurent la même
  # longueur ; sans cette résolution il coupe au milieu d'un composant et rend un chemin
  # relatif absurde (« pipeline\ine\garde.md » constaté). Get-Item résout une forme courte
  # déjà sur le disque vers sa forme longue ; [System.IO.Path]::GetFullPath sert de repli
  # quand le chemin n'existe pas encore -- un chemin absent ne porte alors aucune forme
  # courte à résoudre. Inline plutôt qu'une fonction à part : cette fonction est éprouvée
  # extraite seule (test/js/orphelins-toolkit.test.js), sans le reste de ce fichier.
  if ($Toolkit -and (Test-Path -LiteralPath $Toolkit)) { $Toolkit = (Get-Item -LiteralPath $Toolkit).FullName }
  elseif ($Toolkit) { $Toolkit = [System.IO.Path]::GetFullPath($Toolkit) }
  if ($Extrait -and (Test-Path -LiteralPath $Extrait)) { $Extrait = (Get-Item -LiteralPath $Extrait).FullName }
  elseif ($Extrait) { $Extrait = [System.IO.Path]::GetFullPath($Extrait) }
  $dossiersGeres = @('pipeline', 'vscodium-user', 'revue-template', 'livre-template', 'windows')
  $retires = New-Object System.Collections.ArrayList
  $avertissements = New-Object System.Collections.ArrayList

  # ---- Garde globale : l'extraction doit ressembler à un vrai toolkit avant qu'on y touche ----
  # Une extraction vide (zip qui réussit sans rien contenir) viderait sinon les cinq dossiers
  # gérés du toolkit, faute de quoi que ce soit à quoi les comparer. Si l'extraction ne porte
  # ni le VERSION ni un seul des dossiers gérés, elle ne dit rien de fiable sur cette version :
  # le nettoyage entier s'abstient plutôt que de juger sur du vide.
  $versionExtraite = Test-Path -LiteralPath (Join-Path $Extrait 'VERSION') -PathType Leaf
  $auMoinsUnDossier = $false
  foreach ($d in $dossiersGeres) {
    if (Test-Path -LiteralPath (Join-Path $Extrait $d) -PathType Container) { $auMoinsUnDossier = $true; break }
  }
  if ((-not $versionExtraite) -or (-not $auMoinsUnDossier)) {
    [void]$avertissements.Add('nettoyage abandonné en entier : extraction sans VERSION ni aucun des cinq dossiers gérés -- rien n''est fiable à comparer')
    return [ordered]@{ retires = $retires; avertissements = $avertissements }
  }

  # Sous ce nombre de fichiers, une proportion élevée d'orphelins reste plausible (un petit
  # dossier retaillé de moitié) et la garde de vraisemblance ci-dessous ne s'applique pas.
  $seuilPlancherFichiers = 4
  # Au-delà de cette part, un nettoyage n'est plus « quelques fichiers retirés du dépôt » mais
  # la majorité d'un dossier géré : invraisemblable pour une mise à jour normale.
  $seuilProportionOrpheline = 0.5

  foreach ($d in $dossiersGeres) {
    $dansToolkit = Join-Path $Toolkit $d
    if (-not (Test-Path $dansToolkit)) { continue }
    $dansArchive = Join-Path $Extrait $d

    # ---- Garde par dossier : le dossier doit exister dans l'archive extraite ----
    # $Extrait\pipeline absent alors que $Extrait\windows est présent effacerait sinon tout
    # $Toolkit\pipeline, faute de savoir ce que cette version y garde. En cas de doute, ce
    # dossier-ci n'est pas touché ; les autres, eux, restent jugés chacun sur sa propre
    # comparaison.
    if (-not (Test-Path -LiteralPath $dansArchive -PathType Container)) {
      [void]$avertissements.Add('dossier absent de l''archive extraite, rien retiré -> ' + $d)
      continue
    }

    $fichiers = @(Get-ChildItem -LiteralPath $dansToolkit -Recurse -File -Force -ErrorAction SilentlyContinue)
    if ($fichiers.Count -eq 0) { continue }

    # Candidats orphelins : présents dans le toolkit, absents de l'archive. Calculés d'abord,
    # sans rien supprimer -- la garde de vraisemblance ci-dessous doit juger sur l'ensemble
    # avant qu'un seul fichier ne parte.
    $candidats = New-Object System.Collections.ArrayList
    foreach ($f in $fichiers) {
      $relatif = $f.FullName.Substring($dansToolkit.Length).TrimStart('\')
      $cible = Join-Path $dansArchive $relatif
      if (-not (Test-Path -LiteralPath $cible)) {
        [void]$candidats.Add([ordered]@{ chemin = $f.FullName; relatif = $relatif })
      }
    }
    if ($candidats.Count -eq 0) { continue }

    # ---- Garde de vraisemblance : proportion invraisemblable ----
    # Une archive authentique mais incomplète (dossier source vidé par erreur avant le `cp -r`
    # de release.yml, zip valide, empreinte correcte) passe les deux gardes ci-dessus : le
    # dossier existe dans l'archive, il est juste creux. Elle ne passe pas celle-ci.
    if (($fichiers.Count -ge $seuilPlancherFichiers) -and
        (($candidats.Count / [double]$fichiers.Count) -gt $seuilProportionOrpheline)) {
      [void]$avertissements.Add(('proportion invraisemblable, rien retiré -> {0} : {1}/{2} fichier(s) auraient été retirés' -f $d, $candidats.Count, $fichiers.Count))
      continue
    }

    foreach ($c in $candidats) {
      Remove-Item -LiteralPath $c.chemin -Force
      [void]$retires.Add((Join-Path $d $c.relatif))
    }

    # Dossiers restés vides derrière les fichiers retirés, du plus profond au moins profond ;
    # le dossier géré lui-même ($dansToolkit) n'est jamais retiré, même vide.
    Get-ChildItem -LiteralPath $dansToolkit -Recurse -Directory -Force -ErrorAction SilentlyContinue |
      Sort-Object { $_.FullName.Length } -Descending |
      Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  }
  return [ordered]@{ retires = $retires; avertissements = $avertissements }
}

# Bascule le toolkit d'un coup, jamais fichier par fichier sur l'arbre vivant : construit la
# nouvelle version dans <toolkit>.neuf (copie de l'actuel, complétée par l'archive, nettoyée
# de ses orphelins -- Remove-SzhToolkitOrphelins ci-dessus, appliquée à cette copie et non
# plus au toolkit en service), puis bascule par un renommage NTFS, tout ou rien.
#
# [System.IO.Directory]::Move, et non Move-Item : Move-Item recopie récursivement dossier par
# dossier et peut laisser le toolkit coupé en deux si un fichier est verrouillé en cours de
# route -- Move-Item peut alors créer <toolkit>\neuf au lieu de remplacer <toolkit>, sans lever
# la moindre erreur. Directory.Move est un renommage NTFS -- une seule opération sur le nom du
# dossier, jamais sur son contenu -- qui réussit ou échoue entièrement, sans état intermédiaire.
#
# $Zip : l'archive déjà téléchargée et vérifiée par sha256 (l'appelant l'a fait avant d'appeler
# cette fonction). $Toolkit : le dossier cible, en service. $DossierTravail : où poser
# l'extraction de référence qui sert à détecter les orphelins -- $SzhStaging en service, un
# dossier jetable dans les tests.
#
# Rend le bilan de Remove-SzhToolkitOrphelins ({ retires; avertissements }) ; lève (T
# 'err.toolkit') si la construction de la copie ou la bascule elle-même échoue -- presque
# toujours un fichier encore ouvert dans l'éditeur -- après avoir remis le toolkit d'origine
# en place si la bascule avait déjà commencé.
function Install-SzhToolkitDepuisArchive {
  param(
    [Parameter(Mandatory = $true)][string]$Zip,
    [Parameter(Mandatory = $true)][string]$Toolkit,
    [string]$DossierTravail = ''
  )
  # Forme longue dès l'entrée, même défaut et même remède qu'en tête de
  # Remove-SzhToolkitOrphelins ci-dessus : sur un runner de CI dont le dossier temporaire est
  # exposé en forme courte 8.3 (C:\Users\RUNNER~1\...), $Zip, $Toolkit et $DossierTravail
  # arrivent courts alors que Get-ChildItem, Expand-Archive et Directory.Move les rendent en
  # forme longue. Résolu ici, une seule fois : $neuf, $vieux et $extrait, qui s'en déduisent
  # plus bas par simple concaténation ou Join-Path, restent en forme longue à leur tour --
  # $Toolkit est donc normalisé AVANT que $DossierTravail ne s'en déduise par défaut.
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

  # Reste d'une passe précédente interrompue entre la construction et la bascule : jamais
  # rejoué tel quel, la copie repart de zéro.
  foreach ($d in $neuf, $vieux) {
    if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
  }

  try {
    # ---- La copie : jamais l'arbre vivant ----
    # Une lecture qui échoue ici (fichier du toolkit courant encore ouvert dans l'éditeur)
    # est le même dérangement qu'un renommage refusé plus bas : même cause, même remède,
    # donc le même message clair plutôt que l'exception .NET brute (« used by another
    # process »), que personne ne comprend sans lire le code.
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
    # Jamais bloquant : un souci ici ne doit pas empêcher la bascule qui suit -- la copie
    # reste un toolkit valide même si un reste de l'ancienne version y traîne encore.
    try {
      Expand-Archive -Path $Zip -DestinationPath $extrait -Force
      $bilanOrphelins = Remove-SzhToolkitOrphelins -Toolkit $neuf -Extrait $extrait
    } catch {
      Write-SzhLog ('Install-SzhToolkitDepuisArchive : nettoyage des orphelins non effectué : ' + $_.Exception.Message)
    } finally {
      if (Test-Path -LiteralPath $extrait) { Remove-Item -LiteralPath $extrait -Recurse -Force -ErrorAction SilentlyContinue }
    }

    # ---- La bascule : deux renommages, jamais un fichier copié un par un ----
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
      # Le toolkit d'origine n'a pas bougé de $vieux : on l'y remet avant de lever, pour
      # qu'un échec de bascule ne laisse jamais le poste sans toolkit du tout.
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

# Les extensions posées, telles que l'éditeur les liste pour ce compte. La source de vérité
# est l'éditeur, pas state.json : celui-ci est commun au poste alors qu'une extension
# s'installe par utilisateur, et il affirmait « posée » à un compte qui n'avait rien.
# Table id -> version, et $null — pas une table vide — quand le CLI ne répond pas : un
# profil neuf n'a aucune extension, et confondre les deux ferait sauter l'installation
# exactement là où elle est nécessaire. Les tables PowerShell ignorent la casse, ce qu'il
# faut ici : l'éditeur écrit « MS-CEINTL.vscode-language-pack-de ».
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

# Toutes les extensions du manifest sont-elles posées, dans leur version, pour ce compte ?
# $true quand le CLI ne répond pas ou que l'éditeur manque : on ne déclenche pas une mise à
# jour sur une mesure qu'on n'a pas pu faire.
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
# L'enregistrement d'une distribution WSL est par utilisateur (HKCU\...\Lxss) alors que ce
# dossier était commun au poste. Le deuxième compte n'avait donc aucune distribution
# enregistrée mais trouvait le dossier déjà pris, et `wsl --import` refusait :
# Wsl/Service/RegisterDistro/ERROR_FILE_EXISTS, sans aucune issue puisque rien ne nettoyait
# jamais ce dossier. Pire : `wsl --unregister` du premier compte efface le disque, donc
# celui du second. Un dossier par SID supprime les deux. Le SID plutôt que le nom de
# compte : deux domaines peuvent porter le même nom, et un compte renommé garde son SID.
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
    $wsl = Get-WslExe
    foreach ($l in @(Invoke-SzhNatif { & $wsl -l -q 2>$null })) {
      $n = (([string]$l) -replace "`0", '').Trim()
      if ($n) { [void]$noms.Add($n) }
    }
  } catch { }
  return $noms
}

# Un dossier de distribution présent alors que la distribution n'est pas enregistrée pour
# ce compte est un reste : installation interrompue, disque plein, ou un autre compte qui
# l'avait posé là du temps du dossier commun. On l'écarte — l'environnement est jetable, il
# ne contient aucune donnée — et seulement si le dossier porte bien notre nom, jamais un
# chemin venu d'ailleurs. Échoue si une machine WSL en marche tient encore le .vhdx :
# l'appelant en fait alors le message « redémarrez le poste ».
function Clear-SzhDossierDistro {
  param([Parameter(Mandatory = $true)][string]$Dossier)
  if (-not (Test-Path $Dossier)) { return $false }
  if ((Split-Path $Dossier -Leaf) -ne $SzhDistro) {
    throw ('Dossier de distribution inattendu, rien n''a été supprimé : ' + $Dossier)
  }
  Remove-Item -LiteralPath $Dossier -Recurse -Force
  return $true
}

# L'environnement répond-il ? Un import réussi ne prouve pas qu'une distribution démarre :
# sans virtualisation (désactivée dans le firmware ou par une stratégie), l'import passe et
# le premier `--exec` échoue. Sans ce contrôle, la panne n'apparaît qu'à la première
# tentative de PDF du rédacteur, loin de l'installation qui l'a causée.
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

# Écran d'erreur final : message calme, contact, e-mail pré-rempli, accès au journal.
function Show-SzhErreur {
  param([string]$Etape, [string]$Message, [string]$Journal)
  Write-Host ''
  Write-Host ('  ' + (T 'err.titre')) -ForegroundColor Yellow
  Write-Host ('  ' + (T 'err.l.etape' @($Etape)))
  Write-Host ('  ' + (T 'err.l.detail' @($Message)))
  if ($Journal) { Write-Host ('  ' + (T 'err.l.journal' @($Journal))) }
  Write-Host ''
  Write-Host ('  ' + (T 'err.rassure')) -ForegroundColor Green
  Write-Host ('  ' + (T 'err.retry' @($SzhSupport)))
  Write-Host ''
  Write-Host ('  ' + (T 'err.menu'))
  try {
    $touche = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    $car = [string]$touche.Character
  } catch { $car = '' }
  if ($car -eq 'e' -or $car -eq 'E') {
    $sujet = (T 'mail.sujet' @($env:COMPUTERNAME))
    $corps = (T 'mail.corps' @($env:COMPUTERNAME, $Etape, $Message, $Journal))
    if ($corps.Length -gt 1500) { $corps = $corps.Substring(0, 1500) }   # limite de longueur d'un mailto
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $SzhSupport, [Uri]::EscapeDataString($sujet), [Uri]::EscapeDataString($corps))
    Start-Process $uri
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
  } elseif ($car -eq 'o' -or $car -eq 'O') {
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
    else { Start-Process explorer.exe $SzhLogs }
  }
}
