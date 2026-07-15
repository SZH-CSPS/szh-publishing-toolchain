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
