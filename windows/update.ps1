<#
.SYNOPSIS
  Mise à jour de l'outil Revue SZH — fenêtre VISIBLE, interface sobre et rassurante (D5),
  trilingue FR/DE/EN selon la langue d'affichage de Windows (D25).
  Lancée normalement par update-launcher.ps1 ; utilisable aussi à la main :

    powershell -ExecutionPolicy Bypass -File update.ps1                  # dernière version
    powershell -ExecutionPolicy Bypass -File update.ps1 -Version X.Y.Z  # version précise (rollback / canal de test)

  Ne demande JAMAIS les droits administrateur (D3) : l'import WSL, les extensions et la
  config éditeur sont au niveau utilisateur. Idempotent : ne refait que ce qui a changé
  (comparaison composant par composant avec state.json).

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [string]$Version    # vide = dernière release ; sinon tag sans le « v » (rollback : l'archive N-1 est encore en staging)
)

. "$PSScriptRoot\szh-common.ps1"

try { $Host.UI.RawUI.WindowTitle = (T 'maj.fenetre') } catch { }

# ---------------------------------------------------------------------------------
# Association « Ouvrir avec » des .md (T6.3, D18)
#
# Pose le ProgId SZH.Markdown dans HKCU (donc SANS droits administrateur, D3) et
# l'inscrit dans la liste « Ouvrir avec » de l'extension .md. INTERDIT de forcer
# l'application par défaut (D18) : la clé UserChoice est scellée par un hachage voulu
# par Microsoft, et l'écraser (SetUserFTA & consorts) casserait la garantie que le
# geste vient de l'utilisateur. On se contente donc de PROPOSER l'entrée ; le geste
# « Toujours utiliser cette application » reste à faire une fois par personne
# (procédure dans userdoc.md).
#
# La valeur OpenWithProgids est de type REG_NONE, sans donnée : c'est la forme
# attendue par le shell, et elle ne touche à rien d'autre (ni le défaut de .md, ni
# UserChoice).
#
# Idempotent : on ne crée une clé que si elle manque (New-Item -Force sur une clé
# existante la recrée) et on réécrit les valeurs, qui sont de simples chaînes.
# $Racine est paramétrable pour pouvoir tester la fonction sans toucher la vraie
# ruche des classes.
function Set-SzhProgIdMarkdown {
  param(
    [string]$Racine  = 'HKCU:\Software\Classes',
    [string]$Toolkit = $SzhToolkit
  )
  $vbs = Join-Path $Toolkit 'windows\hidden.vbs'
  $ps1 = Join-Path $Toolkit 'windows\open-md.ps1'
  # Même construction qu'au raccourci du menu Démarrer : wscript.exe //B hidden.vbs
  # <script> <arguments…> — hidden.vbs requote chacun de ses arguments, donc le « %1 »
  # (chemin du fichier double-cliqué, espaces compris) arrive intact à open-md.ps1.
  $commande = ('"{0}\System32\wscript.exe" //B "{1}" "{2}" "%1"' -f $env:WINDIR, $vbs, $ps1)

  $cleProg = Join-Path $Racine 'SZH.Markdown'
  foreach ($c in $cleProg, (Join-Path $cleProg 'shell\open\command')) {
    if (-not (Test-Path $c)) { New-Item -Path $c -Force | Out-Null }
  }
  # Libellé montré dans « Ouvrir avec ». La valeur par défaut du ProgId nomme le type ;
  # FriendlyAppName est ce que le shell affiche pour l'application elle-même — sans elle,
  # l'entrée s'appellerait « Microsoft ® Windows Based Script Host » (le nom de wscript.exe).
  Set-ItemProperty -Path $cleProg -Name '(default)'      -Value 'Revue SZH'
  Set-ItemProperty -Path $cleProg -Name 'FriendlyAppName' -Value 'Revue SZH'
  Set-ItemProperty -Path (Join-Path $cleProg 'shell\open\command') -Name '(default)' -Value $commande

  # Icône : celle de l'éditeur. Si VSCodium n'est pas encore installé, on saute l'icône
  # — la clé DefaultIcon n'est même pas créée : vide, elle donnerait une icône blanche,
  # alors qu'absente elle laisse le shell choisir son icône générique. La commande, elle,
  # est posée dans tous les cas (le prochain update posera l'icône).
  $codium = Get-VSCodiumExe
  if ($codium) {
    $cleIcone = Join-Path $cleProg 'DefaultIcon'
    if (-not (Test-Path $cleIcone)) { New-Item -Path $cleIcone -Force | Out-Null }
    Set-ItemProperty -Path $cleIcone -Name '(default)' -Value ('"{0}",0' -f $codium)
  }

  $cleOuvrirAvec = Join-Path $Racine '.md\OpenWithProgids'
  if (-not (Test-Path $cleOuvrirAvec)) { New-Item -Path $cleOuvrirAvec -Force | Out-Null }
  $deja = Get-ItemProperty -Path $cleOuvrirAvec -Name 'SZH.Markdown' -ErrorAction SilentlyContinue
  if (-not $deja) {
    New-ItemProperty -Path $cleOuvrirAvec -Name 'SZH.Markdown' -PropertyType None -Value ([byte[]]@()) | Out-Null
  }
}

New-Item -ItemType Directory -Force -Path $SzhBase, $SzhStaging, $SzhLogs, $SzhToolkit | Out-Null
$journal = Join-Path $SzhLogs ('update-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
try { Start-Transcript -Path $journal | Out-Null } catch { }

$etape = (T 'etape.prepa')
try {
  Write-SzhBanniere (T 'maj.soustitre')
  Write-SzhInfo (T 'maj.intro1')
  Write-SzhInfo (T 'maj.intro2')
  Write-Host ''

  # ---- Quoi de neuf ? -------------------------------------------------------
  $etape = (T 'etape.manifest')
  Write-SzhEtape (T 'maj.verif')
  $manifest = Get-SzhManifest $Version
  $etat = Get-SzhState
  Write-SzhOk (T 'maj.cible' @($manifest.version))

  # ---- 1/5 Maquette, réglages et scripts (toolkit) --------------------------
  $etape = (T 'etape.toolkit')
  $verToolkit = ''
  $fichierVer = Join-Path $SzhToolkit 'VERSION'
  if (Test-Path $fichierVer) { $verToolkit = (Get-Content $fichierVer -Raw).Trim() }
  Write-SzhEtape (T 'maj.e1')
  if ($verToolkit -ne $manifest.version) {
    $zip = Join-Path $SzhStaging $manifest.toolkit.file
    if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
      Get-SzhFichier -Url $manifest.toolkit.url -Destination $zip
      if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
        throw (T 'err.empreinte' @($manifest.toolkit.file))
      }
    }
    Expand-Archive -Path $zip -DestinationPath $SzhToolkit -Force
    Write-SzhOk (T 'maj.e1.ok')
  } else {
    Write-SzhOk (T 'maj.deja')
  }

  # ---- 2/5 Environnement de fabrication (distro WSL) ------------------------
  $etape = (T 'etape.env')
  Write-SzhEtape (T 'maj.e2')
  $rootfsActuel = ''
  if ($etat -and $etat.rootfs) { $rootfsActuel = $etat.rootfs }
  $wsl = Get-WslExe
  $distros = (& $wsl -l -q) -replace "`0", '' | ForEach-Object { $_.Trim() }
  $distroPresente = ($distros -contains $SzhDistro)

  if (($rootfsActuel -ne $manifest.rootfs.version) -or (-not $distroPresente)) {
    $tar = Join-Path $SzhStaging $manifest.rootfs.file
    if (Test-SzhSha256 -Fichier $tar -Attendu $manifest.rootfs.sha256) {
      Write-SzhInfo (T 'maj.dl.cache')
    } else {
      Write-SzhInfo (T 'maj.dl.gros')
      Get-SzhFichier -Url $manifest.rootfs.url -Destination $tar
      if (-not (Test-SzhSha256 -Fichier $tar -Attendu $manifest.rootfs.sha256)) {
        throw (T 'err.empreinte' @($manifest.rootfs.file))
      }
    }
    Write-SzhInfo (T 'maj.install')
    if ($distroPresente) {
      Invoke-SzhNatif { & $wsl --terminate $SzhDistro 2>$null | Out-Null }
      Invoke-SzhNatif { & $wsl --unregister $SzhDistro 2>$null | Out-Null }
    }
    $dirDistro = Join-Path $SzhBase 'WSL\SZH-Publishing'
    New-Item -ItemType Directory -Force -Path $dirDistro | Out-Null
    & $wsl --import $SzhDistro $dirDistro $tar --version 2
    if ($LASTEXITCODE -ne 0) { throw (T 'err.wsl') }
    Invoke-SzhNatif { & $wsl --terminate $SzhDistro 2>$null | Out-Null }   # relit /etc/wsl.conf
    Write-SzhOk (T 'maj.env.ok' @($manifest.rootfs.version))
  } else {
    Write-SzhOk (T 'maj.env.deja' @($manifest.rootfs.version))
  }

  # ---- 3/5 Extensions de l'éditeur ------------------------------------------
  $etape = (T 'etape.ext')
  Write-SzhEtape (T 'maj.e3')
  $etatVsix = @{}
  if ($etat -and $etat.vsix) {
    foreach ($p in $etat.vsix.PSObject.Properties) { $etatVsix[$p.Name] = [string]$p.Value }
  }
  $cli = Get-VSCodiumCli
  if ($cli) {
    $changement = $false
    foreach ($ext in $manifest.vsix) {
      $installee = ''
      if ($etatVsix.ContainsKey($ext.id)) { $installee = $etatVsix[$ext.id] }
      if ($installee -ne $ext.version) {
        Write-SzhInfo ('{0} {1}…' -f $ext.id, $ext.version)
        $vf = Join-Path $SzhStaging $ext.file
        Get-SzhFichier -Url $ext.url -Destination $vf -Silencieux
        if (-not (Test-SzhSha256 -Fichier $vf -Attendu $ext.sha256)) {
          throw (T 'err.empreinte' @($ext.file))
        }
        & $cli --install-extension $vf --force | Out-Null
        $etatVsix[$ext.id] = $ext.version
        $changement = $true
      }
    }
    if ($changement) { Write-SzhOk (T 'maj.ext.ok') } else { Write-SzhOk (T 'maj.deja') }
  } else {
    Write-SzhInfo (T 'maj.codium.absent')
  }

  # ---- 4/5 Réglages de l'éditeur + menu Démarrer ----------------------------
  $etape = (T 'etape.reglages')
  Write-SzhEtape (T 'maj.e4')
  $src = Join-Path $SzhToolkit 'vscodium-user'
  if (Test-Path $src) {
    $dst = Join-Path $env:APPDATA 'VSCodium\User'
    New-Item -ItemType Directory -Force -Path $dst, (Join-Path $dst 'snippets') | Out-Null
    foreach ($f in 'settings.json', 'keybindings.json', 'tasks.json') {
      $s = Join-Path $src $f
      if (Test-Path $s) { Copy-Item $s (Join-Path $dst $f) -Force }
    }
    $sn = Join-Path $src 'snippets'
    if (Test-Path $sn) { Copy-Item (Join-Path $sn '*') (Join-Path $dst 'snippets') -Force }
  }

  # Langue de l'interface (M4, dans l'esprit de D25) : le pack DE est épinglé dans vsix.lock,
  # mais VSCodium ne bascule ses menus natifs que si %APPDATA%\VSCodium\argv.json porte
  # « locale ». On l'aligne donc sur la langue d'affichage de Windows — DE uniquement
  # (aucun pack FR n'est épinglé ; le défaut reste l'anglais, voir settings.json).
  # argv.json est du JSON *avec commentaires* : retouche textuelle, pas de ConvertFrom-Json.
  if ($SzhLangue -eq 'de') {
    $argv = Join-Path $env:APPDATA 'VSCodium\argv.json'
    if (Test-Path $argv) {
      $contenu = Get-Content $argv -Raw
      if ($contenu -match '"locale"\s*:\s*"([^"]*)"') {
        if ($Matches[1] -ne 'de') {
          $rx = New-Object System.Text.RegularExpressions.Regex '"locale"\s*:\s*"[^"]*"'
          Set-Content -Path $argv -Value $rx.Replace($contenu, '"locale": "de"', 1) -Encoding UTF8
        }
      } else {
        $rx = New-Object System.Text.RegularExpressions.Regex '\{'
        Set-Content -Path $argv -Value $rx.Replace($contenu, ('{' + "`r`n" + '  "locale": "de",'), 1) -Encoding UTF8
      }
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $argv) | Out-Null
      Set-Content -Path $argv -Value ('{' + "`r`n" + '  "locale": "de"' + "`r`n" + '}') -Encoding UTF8
    }
  }

  # Config WSL du poste (D34) : plafond RAM + extinction auto de la VM (5 min)
  $wslCfg = Join-Path $SzhToolkit 'windows\user.wslconfig'
  if (Test-Path $wslCfg) { Copy-Item $wslCfg (Join-Path $env:USERPROFILE '.wslconfig') -Force }

  # Raccourci « Revues SZH » dans le menu Démarrer (niveau utilisateur, D14)
  $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  New-Item -ItemType Directory -Force -Path $menu | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path $menu 'Revues SZH.lnk'))
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnk.Arguments = ('//B "{0}" "{1}"' -f (Join-Path $SzhToolkit 'windows\hidden.vbs'), (Join-Path $SzhToolkit 'windows\open-revue.ps1'))
  $lnk.Description = 'Ouvrir une revue SZH'
  $codium = Get-VSCodiumExe
  if ($codium) { $lnk.IconLocation = $codium }
  $lnk.Save()

  # Association « Ouvrir avec » → « Revue SZH » pour les .md (T6.3, D18). Jamais
  # bloquante : une ruche de classes verrouillée par une stratégie de groupe ne doit pas
  # faire échouer une mise à jour par ailleurs réussie.
  try {
    Set-SzhProgIdMarkdown
    Write-SzhLog 'update : ProgId SZH.Markdown posé (HKCU, Ouvrir avec)'
  } catch {
    Write-SzhLog ('update : ProgId SZH.Markdown non posé : ' + $_.Exception.Message)
  }

  Write-SzhOk (T 'maj.e4.ok')

  # ---- 5/5 Nettoyage ---------------------------------------------------------
  $etape = (T 'etape.nettoyage')
  Write-SzhEtape (T 'maj.e5')
  # Rootfs : garder l'archive courante + la précédente (rollback N-1, D10)
  $archives = @(Get-ChildItem (Join-Path $SzhStaging 'szh-publishing-rootfs-*.tar.gz') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($archives.Count -gt 2) { $archives | Select-Object -Skip 2 | Remove-Item -Force }
  $zips = @(Get-ChildItem (Join-Path $SzhStaging 'toolkit-*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($zips.Count -gt 1) { $zips | Select-Object -Skip 1 | Remove-Item -Force }
  Get-ChildItem (Join-Path $SzhStaging '*.vsix') -ErrorAction SilentlyContinue | Remove-Item -Force
  # Résidus de l'ancien format non compressé (deploy.ps1 historique) : .tar sans .gz.
  # Le -ErrorAction SilentlyContinue évite l'échec si un vieux fichier appartient à l'admin.
  Get-ChildItem (Join-Path $SzhStaging 'szh-publishing-rootfs-*.tar') -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem (Join-Path $SzhStaging 'szh-publishing-rootfs-*.tar.sha256') -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Write-SzhOk (T 'maj.e5.ok')

  # ---- État final -------------------------------------------------------------
  $nouvelEtat = [ordered]@{
    version    = $manifest.version
    toolkit    = $manifest.version
    rootfs     = $manifest.rootfs.version
    vsix       = $etatVsix
    misAJourLe = (Get-Date -Format 's')
  }
  Save-SzhState $nouvelEtat
  Write-SzhLog ('update OK -> {0}' -f $manifest.version)

  Write-Host ''
  Write-Host ('  ' + (T 'maj.fini' @($manifest.version))) -ForegroundColor Green
  Write-Host ('    ' + (T 'maj.ferme')) -ForegroundColor Gray
  try { Stop-Transcript | Out-Null } catch { }
  Start-Sleep -Seconds 6
  exit 0

} catch {
  $message = $_.Exception.Message
  Write-SzhLog ('update ERREUR ({0}) : {1}' -f $etape, $message)
  try { Stop-Transcript | Out-Null } catch { }
  Show-SzhErreur -Etape $etape -Message $message -Journal $journal
  exit 1
}
