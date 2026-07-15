# Socle commun des scripts SZH — à dot-sourcer :  . "$PSScriptRoot\szh-common.ps1"
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$script:SzhBase       = 'C:\ProgramData\SZH'
$script:SzhToolkit    = Join-Path $SzhBase 'toolkit'
$script:SzhStaging    = Join-Path $SzhBase 'staging'
$script:SzhLogs       = Join-Path $SzhBase 'logs'
$script:SzhStateFile  = Join-Path $SzhBase 'state.json'
$script:SzhConfigFile = Join-Path $SzhBase 'config.json'
$script:SzhDistro     = 'SZH-Publishing'
$script:SzhSupport    = 'robin.morand@szh.ch'          # contact affiché en cas de problème (D17)

# ---------- Langue de l'interface (D25) ----------
# Basée sur la langue d'AFFICHAGE de Windows (Get-UICulture). Le code à deux lettres
# couvre toutes les variantes régionales : fr-CH/fr-FR -> fr, de-CH/de-DE -> de.
# Tout le reste -> anglais (fallback). Forçable pour test/support : $env:SZH_LANGUE.
# Allemand en orthographe SUISSE (ss, pas de ß).
$script:SzhLangue = 'en'
try {
  $langueUi = (Get-UICulture).TwoLetterISOLanguageName.ToLower()
  if ($langueUi -eq 'fr' -or $langueUi -eq 'de') { $script:SzhLangue = $langueUi }
} catch { }
if ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower())) {
  $script:SzhLangue = $env:SZH_LANGUE.ToLower()
}

$script:SzhTextes = @{
  fr = @{
    'app.titre'         = 'SZH/CSPS — Toolchain de publication'
    'maj.soustitre'     = 'Mise à jour de l''outil Revue'
    'maj.fenetre'       = 'Mise à jour de l''outil Revue SZH'
    'maj.intro1'        = 'Vos textes et vos revues ne sont pas touchés par cette opération.'
    'maj.intro2'        = 'Vous pouvez continuer à travailler pendant ce temps.'
    'maj.verif'         = 'Vérification de la version disponible…'
    'maj.cible'         = 'Version cible : {0}'
    'maj.e1'            = '1/5  Maquette et réglages…'
    'maj.e1.ok'         = 'Maquette et réglages à jour.'
    'maj.deja'          = 'Déjà à jour.'
    'maj.e2'            = '2/5  Environnement de fabrication du PDF…'
    'maj.dl.gros'       = 'C''est le plus gros téléchargement — merci de patienter.'
    'maj.dl.cache'      = 'Archive déjà téléchargée, réutilisée.'
    'maj.install'       = 'Installation (l''ancien environnement est jetable : aucune donnée dedans)…'
    'maj.env.ok'        = 'Environnement {0} installé.'
    'maj.env.deja'      = 'Déjà à jour ({0}).'
    'maj.e3'            = '3/5  Extensions de l''éditeur…'
    'maj.ext.ok'        = 'Extensions à jour.'
    'maj.codium.absent' = 'VSCodium introuvable — extensions ignorées (bootstrap.ps1 pas encore passé ?).'
    'maj.e4'            = '4/5  Réglages de l''éditeur…'
    'maj.e4.ok'         = 'Réglages appliqués, raccourci « Revues SZH » à jour.'
    'maj.e5'            = '5/5  Nettoyage…'
    'maj.e5.ok'         = 'Terminé.'
    'maj.fini'          = '✓ Tout est à jour (version {0}). Bonne rédaction !'
    'maj.ferme'         = 'Cette fenêtre se ferme toute seule dans quelques secondes.'
    'etape.prepa'       = 'préparation'
    'etape.manifest'    = 'lecture de la version disponible'
    'etape.toolkit'     = 'mise à jour de la maquette et des réglages'
    'etape.env'         = 'mise à jour de l''environnement de fabrication'
    'etape.ext'         = 'mise à jour des extensions de l''éditeur'
    'etape.reglages'    = 'application des réglages de l''éditeur'
    'etape.nettoyage'   = 'nettoyage'
    'err.empreinte'     = 'Empreinte invalide pour {0}.'
    'err.wsl'           = 'L''import de l''environnement WSL a échoué.'
    'err.titre'         = 'Une erreur est survenue pendant la mise à jour.'
    'err.l.etape'       = 'Étape   : {0}'
    'err.l.detail'      = 'Détail  : {0}'
    'err.l.journal'     = 'Journal : {0}'
    'err.rassure'       = 'Pas d''inquiétude : vos textes et vos revues ne sont pas touchés.'
    'err.retry'         = 'La mise à jour réessaiera toute seule. Si le problème persiste : {0}'
    'err.menu'          = '[E] préparer un e-mail au support   [O] ouvrir le journal   [autre touche] fermer'
    'mail.sujet'        = 'Probleme de mise a jour - outil Revue SZH ({0})'
    'mail.corps'        = "Bonjour,`r`n`r`nLa mise a jour de l'outil Revue a rencontre un probleme.`r`n`r`nPoste   : {0}`r`nEtape   : {1}`r`nDetail  : {2}`r`nJournal : {3}`r`n`r`nMerci de joindre le fichier journal ci-dessus a ce message."
    'dl.format'         = '{0:N1} / {1:N1} Mo'
    'lanceur.choisir'   = 'Choisissez la revue à ouvrir :'
    'lanceur.ouvrir'    = 'Ouvrir'
    'lanceur.annuler'   = 'Annuler'
    'lanceur.modifie'   = '{0}    (modifiée le {1})'
    'lanceur.aucune'    = "Aucune revue trouvée.`n`nVérifiez que le dossier OneDrive\Revues est bien synchronisé,`nou demandez la création d'une revue ({0})."
    'lanceur.codium'    = 'L''éditeur VSCodium est introuvable sur ce poste. Contact : {0}'
  }
  de = @{
    'app.titre'         = 'SZH/CSPS — Publikations-Toolchain'
    'maj.soustitre'     = 'Aktualisierung des Redaktionstools'
    'maj.fenetre'       = 'Aktualisierung — SZH-Redaktionstool'
    'maj.intro1'        = 'Ihre Texte und Zeitschriften werden dabei nicht verändert.'
    'maj.intro2'        = 'Sie können währenddessen weiterarbeiten.'
    'maj.verif'         = 'Prüfe die verfügbare Version…'
    'maj.cible'         = 'Zielversion: {0}'
    'maj.e1'            = '1/5  Layout und Einstellungen…'
    'maj.e1.ok'         = 'Layout und Einstellungen sind aktuell.'
    'maj.deja'          = 'Bereits aktuell.'
    'maj.e2'            = '2/5  PDF-Erzeugungsumgebung…'
    'maj.dl.gros'       = 'Dies ist der grösste Download — bitte etwas Geduld.'
    'maj.dl.cache'      = 'Archiv bereits heruntergeladen, wird wiederverwendet.'
    'maj.install'       = 'Installation (die alte Umgebung ist wegwerfbar: sie enthält keine Daten)…'
    'maj.env.ok'        = 'Umgebung {0} installiert.'
    'maj.env.deja'      = 'Bereits aktuell ({0}).'
    'maj.e3'            = '3/5  Editor-Erweiterungen…'
    'maj.ext.ok'        = 'Erweiterungen sind aktuell.'
    'maj.codium.absent' = 'VSCodium nicht gefunden — Erweiterungen übersprungen (bootstrap.ps1 noch nicht ausgeführt?).'
    'maj.e4'            = '4/5  Editor-Einstellungen…'
    'maj.e4.ok'         = 'Einstellungen angewendet, Verknüpfung « Revues SZH » aktualisiert.'
    'maj.e5'            = '5/5  Aufräumen…'
    'maj.e5.ok'         = 'Fertig.'
    'maj.fini'          = '✓ Alles ist aktuell (Version {0}). Gutes Schreiben!'
    'maj.ferme'         = 'Dieses Fenster schliesst sich in wenigen Sekunden von selbst.'
    'etape.prepa'       = 'Vorbereitung'
    'etape.manifest'    = 'Abruf der verfügbaren Version'
    'etape.toolkit'     = 'Aktualisierung von Layout und Einstellungen'
    'etape.env'         = 'Aktualisierung der Erzeugungsumgebung'
    'etape.ext'         = 'Aktualisierung der Editor-Erweiterungen'
    'etape.reglages'    = 'Anwenden der Editor-Einstellungen'
    'etape.nettoyage'   = 'Aufräumen'
    'err.empreinte'     = 'Ungültige Prüfsumme für {0}.'
    'err.wsl'           = 'Der Import der WSL-Umgebung ist fehlgeschlagen.'
    'err.titre'         = 'Bei der Aktualisierung ist ein Fehler aufgetreten.'
    'err.l.etape'       = 'Schritt   : {0}'
    'err.l.detail'      = 'Detail    : {0}'
    'err.l.journal'     = 'Protokoll : {0}'
    'err.rassure'       = 'Keine Sorge: Ihre Texte und Zeitschriften sind nicht betroffen.'
    'err.retry'         = 'Die Aktualisierung versucht es später automatisch erneut. Falls das Problem bleibt: {0}'
    'err.menu'          = '[E] E-Mail an den Support vorbereiten   [O] Protokoll öffnen   [andere Taste] schliessen'
    'mail.sujet'        = 'Problem bei der Aktualisierung - SZH-Redaktionstool ({0})'
    'mail.corps'        = "Guten Tag,`r`n`r`nBei der Aktualisierung des SZH-Redaktionstools ist ein Problem aufgetreten.`r`n`r`nComputer  : {0}`r`nSchritt   : {1}`r`nDetail    : {2}`r`nProtokoll : {3}`r`n`r`nBitte haengen Sie die oben genannte Protokolldatei an diese Nachricht an."
    'dl.format'         = '{0:N1} / {1:N1} MB'
    'lanceur.choisir'   = 'Wählen Sie die zu öffnende Zeitschrift:'
    'lanceur.ouvrir'    = 'Öffnen'
    'lanceur.annuler'   = 'Abbrechen'
    'lanceur.modifie'   = '{0}    (geändert am {1})'
    'lanceur.aucune'    = "Keine Zeitschrift gefunden.`n`nPrüfen Sie, ob der Ordner OneDrive\Revues synchronisiert ist,`noder lassen Sie eine Zeitschrift anlegen ({0})."
    'lanceur.codium'    = 'Der Editor VSCodium wurde auf diesem Computer nicht gefunden. Kontakt: {0}'
  }
  en = @{
    'app.titre'         = 'SZH/CSPS — Publishing toolchain'
    'maj.soustitre'     = 'Journal tool update'
    'maj.fenetre'       = 'SZH journal tool — update'
    'maj.intro1'        = 'Your texts and journals are not affected by this operation.'
    'maj.intro2'        = 'You can keep working in the meantime.'
    'maj.verif'         = 'Checking the available version…'
    'maj.cible'         = 'Target version: {0}'
    'maj.e1'            = '1/5  Layout and settings…'
    'maj.e1.ok'         = 'Layout and settings up to date.'
    'maj.deja'          = 'Already up to date.'
    'maj.e2'            = '2/5  PDF build environment…'
    'maj.dl.gros'       = 'This is the largest download — please be patient.'
    'maj.dl.cache'      = 'Archive already downloaded, reusing it.'
    'maj.install'       = 'Installing (the old environment is disposable: it holds no data)…'
    'maj.env.ok'        = 'Environment {0} installed.'
    'maj.env.deja'      = 'Already up to date ({0}).'
    'maj.e3'            = '3/5  Editor extensions…'
    'maj.ext.ok'        = 'Extensions up to date.'
    'maj.codium.absent' = 'VSCodium not found — extensions skipped (bootstrap.ps1 not run yet?).'
    'maj.e4'            = '4/5  Editor settings…'
    'maj.e4.ok'         = 'Settings applied, “Revues SZH” shortcut updated.'
    'maj.e5'            = '5/5  Cleanup…'
    'maj.e5.ok'         = 'Done.'
    'maj.fini'          = '✓ Everything is up to date (version {0}). Happy writing!'
    'maj.ferme'         = 'This window will close itself in a few seconds.'
    'etape.prepa'       = 'preparation'
    'etape.manifest'    = 'reading the available version'
    'etape.toolkit'     = 'updating layout and settings'
    'etape.env'         = 'updating the build environment'
    'etape.ext'         = 'updating editor extensions'
    'etape.reglages'    = 'applying editor settings'
    'etape.nettoyage'   = 'cleanup'
    'err.empreinte'     = 'Invalid checksum for {0}.'
    'err.wsl'           = 'Importing the WSL environment failed.'
    'err.titre'         = 'An error occurred during the update.'
    'err.l.etape'       = 'Step   : {0}'
    'err.l.detail'      = 'Detail : {0}'
    'err.l.journal'     = 'Log    : {0}'
    'err.rassure'       = 'No worries: your texts and journals are not affected.'
    'err.retry'         = 'The update will retry automatically. If the problem persists: {0}'
    'err.menu'          = '[E] prepare a support e-mail   [O] open the log   [any other key] close'
    'mail.sujet'        = 'Update problem - SZH journal tool ({0})'
    'mail.corps'        = "Hello,`r`n`r`nThe SZH journal tool update ran into a problem.`r`n`r`nComputer: {0}`r`nStep    : {1}`r`nDetail  : {2}`r`nLog     : {3}`r`n`r`nPlease attach the log file above to this message."
    'dl.format'         = '{0:N1} / {1:N1} MB'
    'lanceur.choisir'   = 'Choose the journal to open:'
    'lanceur.ouvrir'    = 'Open'
    'lanceur.annuler'   = 'Cancel'
    'lanceur.modifie'   = '{0}    (modified on {1})'
    'lanceur.aucune'    = "No journal found.`n`nCheck that the OneDrive\Revues folder is synced,`nor ask for a journal to be created ({0})."
    'lanceur.codium'    = 'The VSCodium editor was not found on this computer. Contact: {0}'
  }
}

# T 'clé' @(args…) -> texte dans la langue courante, fallback anglais, sinon la clé.
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

# ---------- Config / état ----------

function Get-SzhConfig {
  if (Test-Path $SzhConfigFile) { return (Get-Content $SzhConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
  return $null
}

function Get-SzhRepo {
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.repo) { return $cfg.repo }
  return 'SZH-CSPS/szh-publishing-toolchain'
}

function Get-SzhState {
  if (Test-Path $SzhStateFile) { return (Get-Content $SzhStateFile -Raw -Encoding UTF8 | ConvertFrom-Json) }
  return $null
}

function Save-SzhState($Etat) {
  $Etat | ConvertTo-Json -Depth 5 | Set-Content -Path $SzhStateFile -Encoding UTF8
}

# ---------- Manifest (Release GitHub) ----------

function Get-SzhManifestUrl([string]$Version) {
  $repo = Get-SzhRepo
  if ($Version) { return "https://github.com/$repo/releases/download/v$Version/manifest.json" }
  return "https://github.com/$repo/releases/latest/download/manifest.json"
}

function Get-SzhManifest([string]$Version) {
  # L'asset est servi en octet-stream : Invoke-RestMethod peut rendre une chaîne brute.
  $brut = Invoke-RestMethod -Uri (Get-SzhManifestUrl $Version) -UseBasicParsing -TimeoutSec 30
  if ($brut -is [string]) { return ($brut | ConvertFrom-Json) }
  if ($brut -is [byte[]]) { return ([Text.Encoding]::UTF8.GetString($brut) | ConvertFrom-Json) }
  return $brut
}

# ---------- Journal ----------

function Write-SzhLog([string]$Message) {
  New-Item -ItemType Directory -Force -Path $SzhLogs | Out-Null
  $ligne = ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Add-Content -Path (Join-Path $SzhLogs ('szh-{0}.log' -f (Get-Date -Format 'yyyy-MM'))) -Value $ligne -Encoding UTF8
}

# ---------- Téléchargement (barre de progression sobre) ----------

function Get-SzhFichier {
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
}

function Test-SzhSha256 {
  param([Parameter(Mandatory = $true)][string]$Fichier, [Parameter(Mandatory = $true)][string]$Attendu)
  if (-not (Test-Path $Fichier)) { return $false }
  $h = (Get-FileHash -Path $Fichier -Algorithm SHA256).Hash.ToLower()
  return ($h -eq $Attendu.ToLower())
}

# ---------- Résolution d'exécutables ----------

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

# Exécute un binaire natif avec stderr redirigé SANS que ErrorActionPreference=Stop
# ne transforme les lignes stderr en erreurs fatales (piège connu de PS 5.1).
function Invoke-SzhNatif([scriptblock]$Bloc) {
  $ancien = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $Bloc } finally { $ErrorActionPreference = $ancien }
}

# ---------- Petite UI terminal (sobre et rassurante) ----------

function Write-SzhTitre([string]$Texte) {
  Write-Host ''
  Write-Host ('  ' + $Texte) -ForegroundColor Cyan
  Write-Host ('  ' + ('─' * $Texte.Length)) -ForegroundColor DarkCyan
}

# Bannière encadrée pour l'installateur et l'updater (titre traduit, D25).
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
    if ($corps.Length -gt 1500) { $corps = $corps.Substring(0, 1500) }   # limite mailto (V5)
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $SzhSupport, [Uri]::EscapeDataString($sujet), [Uri]::EscapeDataString($corps))
    Start-Process $uri
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
  } elseif ($car -eq 'o' -or $car -eq 'O') {
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
    else { Start-Process explorer.exe $SzhLogs }
  }
}
