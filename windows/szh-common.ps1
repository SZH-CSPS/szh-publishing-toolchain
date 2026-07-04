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
            $etatMo = ('{0:N1} / {1:N1} Mo' -f ($fait / 1MB), ($total / 1MB))
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

# Bannière encadrée pour l'installateur et l'updater.
function Write-SzhBanniere([string]$SousTitre) {
  $titre = 'SZH/CSPS — Toolchain de publication'
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
  Write-Host '  Une erreur est survenue pendant la mise à jour.' -ForegroundColor Yellow
  Write-Host ('  Étape   : ' + $Etape)
  Write-Host ('  Détail  : ' + $Message)
  if ($Journal) { Write-Host ('  Journal : ' + $Journal) }
  Write-Host ''
  Write-Host '  Pas d''inquiétude : vos textes et vos revues ne sont pas touchés.' -ForegroundColor Green
  Write-Host ('  La mise à jour réessaiera toute seule. Si le problème persiste : ' + $SzhSupport)
  Write-Host ''
  Write-Host '  [E] préparer un e-mail au support   [O] ouvrir le journal   [autre touche] fermer'
  try {
    $touche = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    $car = [string]$touche.Character
  } catch { $car = '' }
  if ($car -eq 'e' -or $car -eq 'E') {
    $sujet = ('Probleme de mise a jour - outil Revue SZH ({0})' -f $env:COMPUTERNAME)
    $lignes = @(
      'Bonjour,'
      ''
      'La mise a jour de l''outil Revue a rencontre un probleme.'
      ''
      ('Poste   : {0}' -f $env:COMPUTERNAME)
      ('Etape   : {0}' -f $Etape)
      ('Detail  : {0}' -f $Message)
      ('Journal : {0}' -f $Journal)
      ''
      'Merci de joindre le fichier journal ci-dessus a ce message.'
    )
    $corps = ($lignes -join "`r`n")
    if ($corps.Length -gt 1500) { $corps = $corps.Substring(0, 1500) }   # limite mailto (V5)
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $SzhSupport, [Uri]::EscapeDataString($sujet), [Uri]::EscapeDataString($corps))
    Start-Process $uri
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
  } elseif ($car -eq 'o' -or $car -eq 'O') {
    if ($Journal -and (Test-Path $Journal)) { Start-Process explorer.exe ('/select,"' + $Journal + '"') }
    else { Start-Process explorer.exe $SzhLogs }
  }
}
