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

  $icone = Join-Path $Toolkit 'windows\szh-revue.ico'

  $cleProg = Join-Path $Racine 'SZH.Markdown'
  $cleApp = Join-Path $cleProg 'Application'
  foreach ($c in $cleProg, $cleApp, (Join-Path $cleProg 'shell\open\command'),
                 (Join-Path $cleProg 'DefaultIcon')) {
    if (-not (Test-Path $c)) { New-Item -Path $c -Force | Out-Null }
  }

  # ── Le nom affiché dans « Ouvrir avec » : sous-clé Application, PAS la racine ────────
  # Constaté sur Windows 11 : un FriendlyAppName posé à la RACINE du ProgId est ignoré par
  # la boîte « Ouvrir avec », qui affichait donc le nom de l'exécutable réellement lancé,
  # « Microsoft ® Windows Based Script Host ». Le shell lit ce nom dans la sous-clé
  # <ProgId>\Application (FriendlyAppName + ApplicationIcon + ApplicationName). La racine,
  # elle, nomme le TYPE de fichier (colonne « Type » de l'Explorateur) : c'est ce que fait
  # FriendlyTypeName ci-dessous, et les deux ne servent pas à la même chose.
  Set-ItemProperty -Path $cleProg -Name '(default)'        -Value 'Article de revue SZH'
  Set-ItemProperty -Path $cleProg -Name 'FriendlyTypeName' -Value 'Article de revue SZH'
  Set-ItemProperty -Path $cleApp  -Name 'ApplicationName'  -Value 'Revue SZH'
  Set-ItemProperty -Path $cleApp  -Name 'FriendlyAppName'  -Value 'Revue SZH'
  Set-ItemProperty -Path $cleApp  -Name 'ApplicationCompany' -Value 'SZH / CSPS'
  Set-ItemProperty -Path (Join-Path $cleProg 'shell\open\command') -Name '(default)' -Value $commande

  # ── L'icône : la nôtre, surtout PAS celle de VSCodium ────────────────────────────────
  # Dans la liste « Ouvrir avec », l'entrée « Revue SZH » et l'entrée « VSCodium » se
  # suivent : la même icône rendrait le choix impossible à faire d'un coup d'œil, or c'est
  # le choix que l'utilisateur doit réussir une fois pour toutes (D18 — Windows scelle son
  # « Toujours »). D'où szh-revue.ico, livré par le toolkit (voir windows/icone.py).
  # Repli si l'icône manque (toolkit partiel) : VSCodium, faute de mieux ; et si VSCodium
  # manque aussi, on ne pose rien — une clé d'icône vide donne un carré blanc, alors
  # qu'absente elle laisse le shell choisir son icône générique.
  $refIcone = ''
  if (Test-Path $icone) {
    $refIcone = ('"{0}",0' -f $icone)
  } else {
    $codium = Get-VSCodiumExe
    if ($codium) { $refIcone = ('"{0}",0' -f $codium) }
  }
  if ($refIcone) {
    Set-ItemProperty -Path (Join-Path $cleProg 'DefaultIcon') -Name '(default)' -Value $refIcone
    Set-ItemProperty -Path $cleApp -Name 'ApplicationIcon' -Value $refIcone
  }

  $cleOuvrirAvec = Join-Path $Racine '.md\OpenWithProgids'
  if (-not (Test-Path $cleOuvrirAvec)) { New-Item -Path $cleOuvrirAvec -Force | Out-Null }
  $deja = Get-ItemProperty -Path $cleOuvrirAvec -Name 'SZH.Markdown' -ErrorAction SilentlyContinue
  if (-not $deja) {
    New-ItemProperty -Path $cleOuvrirAvec -Name 'SZH.Markdown' -PropertyType None -Value ([byte[]]@()) | Out-Null
  }
}

# ---------------------------------------------------------------------------------
# Protocole « szh: » (D123)
#
# Enregistre le gestionnaire du schéma szh:// dans HKCU — donc SANS administrateur
# (D3), exactement comme le ProgId .md ci-dessus. C'est ce qui rend cliquable, depuis
# un e-mail ou un message Teams, le lien fabriqué par « Envoyer pour traduction ».
#
# Le lien arrive au lanceur en PREMIER argument positionnel (« %1 »), via hidden.vbs
# pour qu'aucune console n'apparaisse. hidden.vbs requote chacun de ses arguments :
# vérifié, un « %1 » requoté se lie bien au paramètre positionnel du script — qui
# revalide la grammaire de toute façon (Get-SzhLien).
#
# Windows demandera UNE FOIS la permission d'ouvrir ce type de lien : c'est voulu — un
# protocole qui s'exécuterait sans accord explicite serait un vecteur d'attaque.
function Set-SzhProtocoleSzh {
  param(
    [string]$Racine  = 'HKCU:\Software\Classes',
    [string]$Toolkit = $SzhToolkit
  )
  $vbs = Join-Path $Toolkit 'windows\hidden.vbs'
  $ps1 = Join-Path $Toolkit 'windows\open-revue.ps1'
  $commande = ('"{0}\System32\wscript.exe" //B "{1}" "{2}" "%1"' -f $env:WINDIR, $vbs, $ps1)
  $icone = Join-Path $Toolkit 'windows\szh-revue.ico'

  $cle = Join-Path $Racine 'szh'
  foreach ($c in $cle, (Join-Path $cle 'shell\open\command'), (Join-Path $cle 'DefaultIcon')) {
    if (-not (Test-Path $c)) { New-Item -Path $c -Force | Out-Null }
  }

  # Office ne suit pas un schéma qu'il ne connaît pas : Outlook affiche « cet
  # emplacement peut ne pas être sûr » puis, selon la configuration, ne lance rien du
  # tout. Le schéma doit donc être déclaré de confiance — clé vide, dans HKCU, donc
  # toujours sans administrateur. Le nom de la clé porte le DEUX-POINTS (« szh: »),
  # c'est la forme qu'Office attend.
  $confiance = 'HKCU:\Software\Microsoft\Office\Common\Security\Trusted Protocols\All Applications\szh:'
  if (-not (Test-Path $confiance)) { New-Item -Path $confiance -Force | Out-Null }
  Set-ItemProperty -Path $cle -Name '(default)' -Value 'URL:Revue SZH'
  # « URL Protocol » (valeur VIDE) est ce qui fait d'une clé de classe un schéma d'URI.
  Set-ItemProperty -Path $cle -Name 'URL Protocol' -Value ''
  Set-ItemProperty -Path (Join-Path $cle 'shell\open\command') -Name '(default)' -Value $commande
  if (Test-Path $icone) {
    Set-ItemProperty -Path (Join-Path $cle 'DefaultIcon') -Name '(default)' -Value ('"{0}",0' -f $icone)
  }
}

# ---------------------------------------------------------------------------------
# Une seule mise à jour à la fois (mutex nommé, portée session)
#
# Deux update.ps1 concurrents — la tâche planifiée pendant un changement de version
# demandé à la main, ou deux clics — écrivent la MÊME archive de staging
# (System.IO.File::Create -> violation de partage) et détendent deux Expand-Archive
# sur le même toolkit : à l'arrivée, un toolkit à moitié écrit. On sort proprement
# plutôt que d'abîmer l'installation ; l'autre passe finira le travail.
$script:SzhMutex = New-Object System.Threading.Mutex($false, 'Local\SZH-Publishing-Update')
$aLaMain = $false
try { $aLaMain = $SzhMutex.WaitOne(0) } catch { $aLaMain = $false }
if (-not $aLaMain) {
  Write-SzhLog 'update : une autre mise à jour est déjà en cours -> sortie'
  Write-SzhBanniere (T 'maj.soustitre')
  Write-SzhInfo (T 'maj.concurrente')
  Start-Sleep -Seconds 5
  exit 0
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
  # Le manifest est MIS EN CACHE : c'est ce qui rend une réinstallation hors ligne
  # possible (Get-SzhManifest s'y replie). Jamais bloquant.
  try { Set-SzhJson (Get-SzhManifestCache $manifest.version) $manifest } catch { }

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
  $codium = Get-VSCodiumExe
  # D134 : chaque raccourci porte l'icône de SON produit (windows/icone.py), la même
  # tuile à la barre de couleur près. Deux entrées voisines dans le menu Démarrer, et
  # surtout épinglables à la barre des tâches, où le libellé disparaît : avec une seule
  # icône, il ne reste plus rien pour les distinguer. Repli sur celle de VSCodium si le
  # toolkit ne livre pas la nôtre — sans IconLocation, le shell affiche celle de
  # wscript.exe, l'hôte de scripts, qui ne dit rien à personne (même raison qu'en D18).
  $icoRevue = Join-Path $SzhToolkit 'windows\szh-revue.ico'
  $icoZs = Join-Path $SzhToolkit 'windows\szh-zeitschrift.ico'
  $lnk = $shell.CreateShortcut((Join-Path $menu 'Revues SZH.lnk'))
  $lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
  # D126 : chaque raccourci pointe sur SON produit — la Revue ici, la Zeitschrift plus
  # bas. Explicite des deux côtés, pour qu'un raccourci ancien ne montre pas les deux.
  $lnk.Arguments = ('//B "{0}" "{1}" "-Produit" "revue"' -f (Join-Path $SzhToolkit 'windows\hidden.vbs'), (Join-Path $SzhToolkit 'windows\open-revue.ps1'))
  $lnk.Description = 'Ouvrir une revue SZH'
  if (Test-Path $icoRevue) { $lnk.IconLocation = ('{0},0' -f $icoRevue) }
  elseif ($codium) { $lnk.IconLocation = $codium }
  $lnk.Save()

  # Second raccourci « Zeitschriften SZH » (D124) : le MÊME lanceur, filtré sur la
  # Zeitschrift. Deux entrées de menu Démarrer, deux publics, un seul script.
  $lnkZs = $shell.CreateShortcut((Join-Path $menu 'Zeitschriften SZH.lnk'))
  $lnkZs.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $lnkZs.Arguments = ('//B "{0}" "{1}" "-Produit" "zeitschrift"' -f (Join-Path $SzhToolkit 'windows\hidden.vbs'), (Join-Path $SzhToolkit 'windows\open-revue.ps1'))
  $lnkZs.Description = 'Eine SZH-Zeitschrift öffnen'
  if (Test-Path $icoZs) { $lnkZs.IconLocation = ('{0},0' -f $icoZs) }
  elseif ($codium) { $lnkZs.IconLocation = $codium }
  $lnkZs.Save()

  # Association « Ouvrir avec » → « Revue SZH » pour les .md (T6.3, D18). Jamais
  # bloquante : une ruche de classes verrouillée par une stratégie de groupe ne doit pas
  # faire échouer une mise à jour par ailleurs réussie.
  try {
    Set-SzhProgIdMarkdown
    Write-SzhLog 'update : ProgId SZH.Markdown posé (HKCU, Ouvrir avec)'
  } catch {
    Write-SzhLog ('update : ProgId SZH.Markdown non posé : ' + $_.Exception.Message)
  }

  # Protocole « szh: » des liens « Envoyer pour traduction » (D123). Même posture :
  # jamais bloquante.
  try {
    Set-SzhProtocoleSzh
    Write-SzhLog 'update : protocole szh: posé (HKCU)'
  } catch {
    Write-SzhLog ('update : protocole szh: non posé : ' + $_.Exception.Message)
  }

  Write-SzhOk (T 'maj.e4.ok')

  # ---- 5/5 Nettoyage ---------------------------------------------------------
  $etape = (T 'etape.nettoyage')
  Write-SzhEtape (T 'maj.e5')
  # Rootfs : garder l'archive courante + la précédente (rollback N-1, D10)
  $archives = @(Get-ChildItem (Join-Path $SzhStaging 'szh-publishing-rootfs-*.tar.gz') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($archives.Count -gt 2) { $archives | Select-Object -Skip 2 | Remove-Item -Force }
  # DEUX archives de toolkit conservées, comme pour le rootfs (D10) : sans la N-1, le
  # « réinstaller une version précédente » de D120 n'aurait rien à réinstaller.
  $zips = @(Get-ChildItem (Join-Path $SzhStaging 'toolkit-*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($zips.Count -gt 2) { $zips | Select-Object -Skip 2 | Remove-Item -Force }
  # Les manifests en cache sont minuscules : on en garde cinq, de quoi couvrir les
  # archives conservées et un peu d'historique.
  $manifests = @(Get-ChildItem (Join-Path $SzhStaging 'manifest-*.json') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($manifests.Count -gt 5) { $manifests | Select-Object -Skip 5 | Remove-Item -Force }
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
  try { $SzhMutex.ReleaseMutex() } catch { }
  Start-Sleep -Seconds 6
  exit 0

} catch {
  $message = $_.Exception.Message
  Write-SzhLog ('update ERREUR ({0}) : {1}' -f $etape, $message)
  try { Stop-Transcript | Out-Null } catch { }
  try { $SzhMutex.ReleaseMutex() } catch { }
  Show-SzhErreur -Etape $etape -Message $message -Journal $journal
  exit 1
}
