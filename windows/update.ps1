<#
.SYNOPSIS
  Met à jour l'outil Pronto dans une fenêtre visible. Lancé par update-launcher.ps1 ou par
  l'entrée « Pronto (Updater) » du menu Démarrer. La fenêtre prend la langue réglée pour le
  compte.

    powershell -ExecutionPolicy Bypass -File update.ps1                  # dernière version
    powershell -ExecutionPolicy Bypass -File update.ps1 -Version X.Y.Z  # version précise
    powershell -ExecutionPolicy Bypass -File update.ps1 -Langue de       # essai manuel, en allemand

  Sans droits administrateur : l'import WSL, les extensions et les réglages de l'éditeur
  sont propres au compte. Chaque composant n'est installé que s'il n'est pas déjà à la
  bonne version.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [string]$Version,     # vide = dernière release ; sinon le tag sans son « v »
  [string]$Langue,      # vide = langue du poste ; 'fr', 'de' ou 'en' pour cette fenêtre
  [switch]$Silencieux   # posé par update-launcher.ps1 en mode « mise à jour silencieuse » :
                        # la fenêtre est cachée, et Show-SzhErreur n'attend pas de touche.
)

. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"

if ($Silencieux) { $script:SzhSansInteraction = $true }

# -Langue sert aux essais manuels et ne vaut que pour cette fenêtre : la préférence du
# poste n'est pas modifiée. Une valeur inconnue est ignorée. $env:SZH_LANGUE prime.
$envLangue = ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower()))
if ($Langue -and (-not $envLangue) -and (@('fr', 'de', 'en') -contains $Langue.ToLower())) {
  $script:SzhLangue = $Langue.ToLower()
}

# Identité de barre des tâches propre ('maj') : sinon le bouton se range avec les autres
# consoles PowerShell et en prend l'icône. Sans effet sous Windows Terminal, dont la
# fenêtre ne nous appartient pas.
$idMaj = Get-SzhAppId 'maj'
[void](Set-SzhAppUserModelId $idMaj)

try { $Host.UI.RawUI.WindowTitle = (T 'maj.fenetre') } catch { }

# ---- Association « Ouvrir avec » des .md ----
# Pose le ProgId SZH.Markdown dans HKCU, sans administrateur, et l'inscrit dans « Ouvrir
# avec » pour les .md. L'application par défaut n'est pas forcée : la clé UserChoice est
# protégée par un hachage Microsoft. Chacun coche une fois « Toujours utiliser cette
# application » (voir userdoc.md). OpenWithProgids attend une valeur REG_NONE sans donnée.
# $Racine permet de tester hors de la vraie ruche.
function Set-SzhProgIdMarkdown {
  param(
    [string]$Racine  = 'HKCU:\Software\Classes',
    [string]$Toolkit = $SzhToolkit
  )
  $vbs = Join-Path $Toolkit 'windows\hidden.vbs'
  $ps1 = Join-Path $Toolkit 'windows\open-md.ps1'
  # hidden.vbs remet chaque argument entre guillemets : « %1 » arrive intact à open-md.ps1,
  # espaces compris.
  $commande = ('"{0}\System32\wscript.exe" //B "{1}" "{2}" "%1"' -f $env:WINDIR, $vbs, $ps1)

  $icone = Join-Path $Toolkit 'windows\pronto.ico'

  $cleProg = Join-Path $Racine 'SZH.Markdown'
  $cleApp = Join-Path $cleProg 'Application'
  foreach ($c in $cleProg, $cleApp, (Join-Path $cleProg 'shell\open\command'),
                 (Join-Path $cleProg 'DefaultIcon')) {
    if (-not (Test-Path $c)) { New-Item -Path $c -Force | Out-Null }
  }

  # Windows 11 lit le nom affiché dans « Ouvrir avec » sous <ProgId>\Application ; posé à
  # la racine, il est ignoré et la boîte affiche « Microsoft ® Windows Based Script Host ».
  # La racine nomme le type de fichier.
  Set-ItemProperty -Path $cleProg -Name '(default)'        -Value 'Article de revue SZH'
  Set-ItemProperty -Path $cleProg -Name 'FriendlyTypeName' -Value 'Article de revue SZH'
  Set-ItemProperty -Path $cleApp  -Name 'ApplicationName'  -Value 'Pronto'
  Set-ItemProperty -Path $cleApp  -Name 'FriendlyAppName'  -Value 'Pronto'
  Set-ItemProperty -Path $cleApp  -Name 'ApplicationCompany' -Value 'SZH / CSPS'
  Set-ItemProperty -Path (Join-Path $cleProg 'shell\open\command') -Name '(default)' -Value $commande

  # pronto.ico, pour distinguer l'entrée de celle de VSCodium dans « Ouvrir avec ». Repli
  # sur l'icône de VSCodium ; si elle manque aussi, rien n'est posé (une clé vide donnerait
  # un carré blanc).
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

# ---- Protocole « szh: » ----
# Enregistre le schéma szh:// dans HKCU, sans administrateur, pour rendre cliquables les
# liens d'« Envoyer pour traduction » dans un courriel ou Teams. Le lien arrive à
# open-revue.ps1 par hidden.vbs (sans console), qui en revérifie la forme. Windows demande
# une fois la permission d'ouvrir ce type de lien.
function Set-SzhProtocoleSzh {
  param(
    [string]$Racine  = 'HKCU:\Software\Classes',
    [string]$Toolkit = $SzhToolkit
  )
  $vbs = Join-Path $Toolkit 'windows\hidden.vbs'
  $ps1 = Join-Path $Toolkit 'windows\open-revue.ps1'
  $commande = ('"{0}\System32\wscript.exe" //B "{1}" "{2}" "%1"' -f $env:WINDIR, $vbs, $ps1)
  $icone = Join-Path $Toolkit 'windows\pronto.ico'

  $cle = Join-Path $Racine 'szh'
  foreach ($c in $cle, (Join-Path $cle 'shell\open\command'), (Join-Path $cle 'DefaultIcon')) {
    if (-not (Test-Path $c)) { New-Item -Path $c -Force | Out-Null }
  }

  # Office refuse ou met en garde devant un schéma inconnu : on le déclare de confiance par
  # une clé vide dans HKCU, dont le nom porte le deux-points comme Office l'attend.
  $confiance = 'HKCU:\Software\Microsoft\Office\Common\Security\Trusted Protocols\All Applications\szh:'
  if (-not (Test-Path $confiance)) { New-Item -Path $confiance -Force | Out-Null }
  Set-ItemProperty -Path $cle -Name '(default)' -Value 'URL:Pronto'
  # La valeur vide « URL Protocol » fait d'une clé de classe un schéma d'URI.
  Set-ItemProperty -Path $cle -Name 'URL Protocol' -Value ''
  Set-ItemProperty -Path (Join-Path $cle 'shell\open\command') -Name '(default)' -Value $commande
  if (Test-Path $icone) {
    Set-ItemProperty -Path (Join-Path $cle 'DefaultIcon') -Name '(default)' -Value ('"{0}",0' -f $icone)
  }
}

# ---- Une seule mise à jour à la fois (mutex nommé, portée poste) ----
# Deux mises à jour simultanées écriraient la même archive et le même toolkit. La seconde
# sort : la première finira le travail. Portée poste, car deux comptes connectés partagent
# C:\ProgramData\SZH\toolkit.
$script:SzhMutex = New-SzhMutexPoste
$aLaMain = $false
# AbandonedMutexException (processus mort en tenant le mutex) vaut prise du mutex : la
# traiter comme « déjà pris » le laisserait abandonné, et plus aucune mise à jour ne
# passerait.
try { $aLaMain = $SzhMutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $aLaMain = $true; Write-SzhLog 'update : mutex abandonné par une passe précédente, repris' }
catch { $aLaMain = $false }
if (-not $aLaMain) {
  Write-SzhLog 'update : une autre mise à jour est déjà en cours -> sortie'
  Write-SzhBanniere (T 'maj.soustitre')
  Write-SzhInfo (T 'maj.concurrente')
  Start-Sleep -Seconds 5
  exit 0
}

New-Item -ItemType Directory -Force -Path $SzhBase, $SzhStaging, $SzhLogs, $SzhToolkit | Out-Null
$journal = Join-Path $SzhLogs ('update-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Limit-SzhJournauxMaj -Garder 9   # avec celui qui s'ouvre, dix journaux de mise à jour au plus
Limit-SzhJournauxMensuels -Garder 3   # le mois en cours et les deux précédents
try { Start-Transcript -Path $journal | Out-Null } catch { }

$etape = (T 'etape.prepa')
try {
  Write-SzhBanniere (T 'maj.soustitre')
  Write-SzhInfo (T 'maj.intro1')
  Write-SzhInfo (T 'maj.intro2')
  Write-Host ''

  # Le compte qui exécute, au journal : l'essentiel s'installe par compte, et une
  # installation lancée avec un autre compte (support) ne profite pas à la session ouverte.
  $moi = Get-SzhIdentite
  Write-SzhLog ('update : compte {0} (admin : {1})' -f $moi.nom, $moi.admin)

  # Les étapes qui ont échoué sans arrêter les autres ; l'écran de fin les signale.
  $ennuis = New-Object System.Collections.ArrayList

  # ---- Quoi de neuf ? ----
  $etape = (T 'etape.manifest')
  Write-SzhEtape (T 'maj.verif')
  $manifest = Get-SzhManifest $Version
  # Ces champs du manifeste deviennent des noms de fichiers sous $SzhStaging : on vérifie
  # leur forme pour qu'un manifeste corrompu ne fasse rien lire ni écrire ailleurs.
  if (-not (Test-SzhVersionTag $manifest.version)) {
    throw ('Version de manifest invalide : ' + [string]$manifest.version)
  }
  if (-not (Test-SzhNomFichierManifest $manifest.toolkit.file)) {
    throw ('Nom de fichier de manifest invalide (toolkit) : ' + [string]$manifest.toolkit.file)
  }
  if (-not (Test-SzhNomFichierManifest $manifest.rootfs.file)) {
    throw ('Nom de fichier de manifest invalide (rootfs) : ' + [string]$manifest.rootfs.file)
  }
  foreach ($ext in $manifest.vsix) {
    if (-not (Test-SzhNomFichierManifest $ext.file)) {
      throw ('Nom de fichier de manifest invalide (vsix ' + [string]$ext.id + ') : ' + [string]$ext.file)
    }
  }
  $etat = Get-SzhState
  $etatUtil = Get-SzhEtatUtilisateur
  Write-SzhOk (T 'maj.cible' @($manifest.version))
  # Manifeste mis en cache, pour pouvoir réinstaller hors ligne. Un échec est ignoré.
  try { Set-SzhJson (Get-SzhManifestCache $manifest.version) $manifest } catch { }

  # ---- 1/5 Maquette, réglages et scripts (toolkit) ----
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
    # Remplacement atomique : le nouveau toolkit est construit à part (copie de l'actuel,
    # complétée par l'archive, orphelins retirés), puis mis en place par un renommage. Voir
    # Install-SzhToolkitDepuisArchive (szh-common.ps1).
    $bilanOrphelins = Install-SzhToolkitDepuisArchive -Zip $zip -Toolkit $SzhToolkit -DossierTravail $SzhStaging
    foreach ($o in $bilanOrphelins.retires) {
      Write-SzhLog ('update : orphelin retiré du toolkit -> ' + $o)
    }
    if ($bilanOrphelins.retires.Count -gt 0) {
      Write-SzhLog ('update : ' + $bilanOrphelins.retires.Count + ' orphelin(s) retiré(s) du toolkit (absents de la version ' + $manifest.version + ')')
    }
    foreach ($a in $bilanOrphelins.avertissements) {
      Write-SzhLog ('update : nettoyage des orphelins, anomalie -> ' + $a)
    }

    Write-SzhOk (T 'maj.e1.ok')
  } else {
    Write-SzhOk (T 'maj.deja')
  }

  # ---- 2/5 Environnement de fabrication (distro WSL) ----
  #
  # L'étape la plus lourde (un gros téléchargement, un import). Son échec est retenu dans
  # $ennuis et n'empêche pas les étapes 3 à 5.
  #
  # La version installée se lit dans l'état du compte : une distribution WSL est
  # enregistrée par compte.
  $etape = (T 'etape.env')
  Write-SzhEtape (T 'maj.e2')
  $rootfsPose = Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'
  $distroPresente = ((Get-SzhDistrosEnregistrees) -contains $SzhDistro)
  # Repli sur l'état commun du poste, seulement si la distribution est enregistrée pour ce
  # compte : cela évite de réimporter l'environnement sur un poste déjà installé.
  if ((-not $rootfsPose) -and $distroPresente -and $etat -and $etat.rootfs) {
    $rootfsPose = [string]$etat.rootfs
  }
  # Sans distribution enregistrée pour ce compte, la version notée ne compte pas.
  if (-not $distroPresente) { $rootfsPose = '' }

  try {
    if ($rootfsPose -ne $manifest.rootfs.version) {
      $wsl = Get-WslExe
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

      # Place vérifiée avant de désenregistrer : un import à moitié fait laisse un dossier
      # pris et aucune distribution. 5 Go : l'archive (0,6), le disque qu'elle déplie
      # (environ 2,4) et une marge.
      $libre = Get-SzhEspaceLibreGo
      if (($libre -ge 0) -and ($libre -lt 5)) { throw (T 'err.espace' @($libre, 5)) }

      # Lancée depuis le menu Démarrer, cette fenêtre n'a pas encore vérifié le moment :
      # même test que la passe silencieuse, pour ne pas couper une compilation.
      $moment = Test-SzhMomentMaj -RemplaceEnvironnement
      if (-not $moment.propice) {
        # Le message à l'écran couvre les deux cas ; le journal précise lequel.
        Write-SzhLog ('update : environnement non remplacé, moment défavorable -> ' + $moment.raison)
        throw (T 'err.wsl')
      }

      Write-SzhInfo (T 'maj.install')
      if ($distroPresente) {
        Invoke-SzhNatif { & $wsl --terminate $SzhDistro 2>$null | Out-Null }
        Invoke-SzhNatif { & $wsl --unregister $SzhDistro 2>$null | Out-Null }
      }
      $dirDistro = Get-SzhDossierDistro
      # Reste d'une installation interrompue : `wsl --import` refuse un dossier déjà pris,
      # on le vide d'abord.
      try {
        if (Clear-SzhDossierDistro -Dossier $dirDistro) { Write-SzhInfo (T 'maj.env.repare') }
      } catch {
        throw (T 'err.wsl.dossier')
      }
      New-Item -ItemType Directory -Force -Path $dirDistro | Out-Null
      & $wsl --import $SzhDistro $dirDistro $tar --version 2
      if ($LASTEXITCODE -ne 0) {
        # Deux pannes pour un même code de retour, qui demandent des actions différentes.
        if (Test-Path (Join-Path $dirDistro 'ext4.vhdx')) { throw (T 'err.wsl.dossier') }
        throw (T 'err.wsl')
      }
      Invoke-SzhNatif { & $wsl --terminate $SzhDistro 2>$null | Out-Null }   # force la relecture de /etc/wsl.conf

      # Un import réussi ne prouve pas que la distribution démarre (virtualisation
      # désactivée) : on l'essaie tout de suite plutôt qu'au premier PDF.
      Write-SzhInfo (T 'maj.env.essai')
      if (-not (Test-SzhDistroRepond)) { throw (T 'err.wsl.moteur') }

      $rootfsPose = $manifest.rootfs.version
      Write-SzhOk (T 'maj.env.ok' @($manifest.rootfs.version))
    } else {
      Write-SzhOk (T 'maj.env.deja' @($manifest.rootfs.version))
    }
  } catch {
    $messageEnv = $_.Exception.Message
    $rootfsPose = ''      # rien n'est retenu de ce qui n'est pas installé
    [void]$ennuis.Add([ordered]@{ etape = $etape; message = $messageEnv })
    Write-SzhLog ('update : environnement de fabrication non installé ({0}) -> {1}' -f $moi.nom, $messageEnv)
    Write-SzhAttention $messageEnv
  }

  # ---- 3/5 Extensions de l'éditeur ----
  $etape = (T 'etape.ext')
  Write-SzhEtape (T 'maj.e3')
  # Les extensions installées pour ce compte se lisent par la CLI de l'éditeur. L'état du
  # compte, puis celui du poste, ne servent que si la CLI ne répond pas.
  $etatVsix = @{}
  $vsixRetenu = $null
  if ($etatUtil -and $etatUtil.vsix) { $vsixRetenu = $etatUtil.vsix }
  elseif ($etat -and $etat.vsix) { $vsixRetenu = $etat.vsix }
  if ($vsixRetenu) {
    foreach ($p in $vsixRetenu.PSObject.Properties) { $etatVsix[$p.Name] = [string]$p.Value }
  }
  $cli = Get-VSCodiumCli
  $reelles = Get-SzhExtensionsInstallees -Cli $cli
  if ($null -ne $reelles) { $etatVsix = $reelles }
  if ($cli) {
    $changement = $false
    $extRatees = @()
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
        # La version n'est notée que si l'installation a réussi : sinon la mise à jour
        # suivante sauterait l'extension. Invoke-SzhNatif : la CLI de VSCodium écrit des
        # DeprecationWarning sur stderr, que le 2>&1 de PowerShell 5.1 transformerait en
        # erreur fatale sous ErrorActionPreference = 'Stop'.
        $sortie = Invoke-SzhNatif { & $cli --install-extension $vf --force 2>&1 }
        if ($LASTEXITCODE -eq 0) {
          $etatVsix[$ext.id] = $ext.version
          $changement = $true
        } else {
          # Une extension en échec n'arrête pas les autres : elle est signalée et sera
          # reprise au prochain passage.
          $detail = ($sortie | Where-Object { $_ -match 'Error|Failed' } | Select-Object -First 1)
          if (-not $detail) { $detail = ($sortie | Select-Object -Last 1) }
          $extRatees += $ext.id
          Write-SzhLog ('update : extension ratee ' + $ext.id + ' -> ' + $detail)
        }
      }
    }
    if ($extRatees.Count -gt 0) {
      Write-SzhAttention (T 'maj.ext.ratee' @(($extRatees -join ', ')))
    } elseif ($changement) {
      Write-SzhOk (T 'maj.ext.ok')
    } else {
      Write-SzhOk (T 'maj.deja')
    }
  } else {
    Write-SzhInfo (T 'maj.codium.absent')
  }

  # ---- 4/5 Réglages de l'éditeur + menu Démarrer ----
  $etape = (T 'etape.reglages')
  Write-SzhEtape (T 'maj.e4')
  $src = Join-Path $SzhToolkit 'vscodium-user'
  if (Test-Path $src) {
    $dst = Join-Path $env:APPDATA 'VSCodium\User'
    New-Item -ItemType Directory -Force -Path $dst, (Join-Path $dst 'snippets') | Out-Null
    # settings.json appartient au rédacteur (« Réglages SZH ») : il n'est copié que s'il
    # n'existe pas, pour qu'un poste neuf soit configuré dès la première ouverture. Les
    # valeurs maison passent par le cockpit (contributes.configurationDefaults et
    # vscodium-extension/szh-cockpit/lib/reglages-flotte.js).
    #
    # keybindings.json et tasks.json, que personne n'édite, sont toujours remplacés.
    $reglagesRedacteur = Join-Path $dst 'settings.json'
    $srcReglages = Join-Path $src 'settings.json'
    if ((Test-Path $srcReglages) -and (-not (Test-Path $reglagesRedacteur))) {
      Copy-Item $srcReglages $reglagesRedacteur -Force
    }
    foreach ($f in 'keybindings.json', 'tasks.json') {
      $s = Join-Path $src $f
      if (Test-Path $s) { Copy-Item $s (Join-Path $dst $f) -Force }
    }
    $sn = Join-Path $src 'snippets'
    if (Test-Path $sn) { Copy-Item (Join-Path $sn '*') (Join-Path $dst 'snippets') -Force }
  }

  # ---- Réglages protégés de la chaîne de publication ----
  # Export OJS et titres de bibliographie, communs à tous les postes et décidés dans le
  # dépôt : remplacés à chaque mise à jour. Le cockpit les recopie dans config.json, que la
  # chaîne de compilation lit depuis la machine virtuelle.
  $protegesSrc = Join-Path $SzhToolkit 'windows\settings-protected.json'
  if (Test-Path $protegesSrc) {
    Copy-Item $protegesSrc (Join-Path $SzhBase 'settings-protected.json') -Force
  }

  # VSCodium n'affiche ses menus en allemand que si argv.json porte « locale ». Seul le pack
  # allemand est livré (vsix.lock). argv.json admet des commentaires : retouche textuelle
  # plutôt que ConvertFrom-Json.
  if ($SzhLangue -eq 'de') {
    $argv = Join-Path $env:APPDATA 'VSCodium\argv.json'
    if (Test-Path $argv) {
      $contenu = Get-Content $argv -Raw
      if ($contenu -match '"locale"\s*:\s*"([^"]*)"') {
        if ($Matches[1] -ne 'de') {
          $rx = New-Object System.Text.RegularExpressions.Regex '"locale"\s*:\s*"[^"]*"'
          # Sans BOM : Electron peut refuser le BOM que pose Set-Content -Encoding UTF8 sous
          # PowerShell 5.1.
          [System.IO.File]::WriteAllText($argv, $rx.Replace($contenu, '"locale": "de"', 1), (New-Object System.Text.UTF8Encoding($false)))
        }
      } else {
        $rx = New-Object System.Text.RegularExpressions.Regex '\{'
        [System.IO.File]::WriteAllText($argv, $rx.Replace($contenu, ('{' + "`r`n" + '  "locale": "de",'), 1), (New-Object System.Text.UTF8Encoding($false)))
      }
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $argv) | Out-Null
      [System.IO.File]::WriteAllText($argv, ('{' + "`r`n" + '  "locale": "de"' + "`r`n" + '}'), (New-Object System.Text.UTF8Encoding($false)))
    }
  }

  # .wslconfig du compte : plafond de mémoire et extinction automatique de la machine. Remplacé
  # s'il diffère du gabarit. L'original est sauvegardé une seule fois (.wslconfig.szh-avant),
  # pour que la sauvegarde reste celle du rédacteur.
  $wslCfg = Join-Path $SzhToolkit 'windows\user.wslconfig'
  $wslCfgUtilisateur = Join-Path $env:USERPROFILE '.wslconfig'
  if (Test-Path $wslCfg) {
    $wslCfgVoulu = Get-Content $wslCfg -Raw
    $wslCfgActuel = $null
    if (Test-Path $wslCfgUtilisateur) { $wslCfgActuel = Get-Content $wslCfgUtilisateur -Raw }
    if ($wslCfgActuel -ne $wslCfgVoulu) {
      if ($wslCfgActuel) {
        $wslCfgSauvegarde = Join-Path $env:USERPROFILE '.wslconfig.szh-avant'
        if (-not (Test-Path $wslCfgSauvegarde)) { Copy-Item $wslCfgUtilisateur $wslCfgSauvegarde -Force }
      }
      Copy-Item $wslCfg $wslCfgUtilisateur -Force
    }
  }

  # Raccourcis du menu Démarrer du compte : Pronto et sa mise à jour, posés aussi par
  # bootstrap.ps1 et update-launcher.ps1. Un échec (menu verrouillé par stratégie de
  # groupe) est journalisé sans faire échouer la mise à jour.
  try {
    $bilanMenu = Set-SzhRaccourcisMenu
    if ($bilanMenu.poses.Count -gt 0) {
      Write-SzhLog ('update : raccourcis du menu Démarrer posés pour {0} : {1}' -f $moi.nom, ($bilanMenu.poses -join ', '))
    }
    foreach ($retire in $bilanMenu.retires) {
      Write-SzhLog ('update : ancien raccourci du menu Démarrer retiré : ' + $retire)
    }
    foreach ($manque in $bilanMenu.manques) {
      Write-SzhLog ('update : raccourci du menu Démarrer non posé -> ' + $manque)
    }
  } catch {
    Write-SzhLog ('update : raccourcis du menu Démarrer non posés : ' + $_.Exception.Message)
  }

  # La tâche planifiée est réécrite si elle diffère. Sans élévation, le refus est le cas
  # courant : elle appartient à l'administrateur. La correction réussit quand bootstrap.ps1
  # lance ce script, ou quand la mise à jour est ouverte en administrateur.
  try {
    $bilanTache = Set-SzhTacheMaj
    if ($bilanTache.etat -ne 'conforme') {
      Write-SzhLog ('update : tâche planifiée {0} — écarts : {1}' -f $bilanTache.etat, ($bilanTache.ecarts -join ' ; '))
      if ($bilanTache.etat -eq 'refusee') {
        Write-SzhLog ('update : tâche planifiée non corrigée (' + $bilanTache.message + ') — un administrateur doit relancer bootstrap.ps1 sur ce poste, ou la commande donnée dans docs/MAINTENANCE.md. La cadence hebdomadaire, elle, est tenue par update-launcher.ps1 sans administrateur.')
      }
    }
  } catch {
    Write-SzhLog ('update : tâche planifiée non vérifiée : ' + $_.Exception.Message)
  }

  # Un registre verrouillé par stratégie de groupe ne fait pas échouer la mise à jour.
  try {
    Set-SzhProgIdMarkdown
    Write-SzhLog ('update : ProgId SZH.Markdown posé pour {0} (HKCU, Ouvrir avec)' -f $moi.nom)
  } catch {
    Write-SzhLog ('update : ProgId SZH.Markdown non posé : ' + $_.Exception.Message)
  }

  # Protocole des liens « Envoyer pour traduction », même traitement des erreurs.
  try {
    Set-SzhProtocoleSzh
    Write-SzhLog ('update : protocole szh: posé pour {0} (HKCU)' -f $moi.nom)
  } catch {
    Write-SzhLog ('update : protocole szh: non posé : ' + $_.Exception.Message)
  }

  Write-SzhOk (T 'maj.e4.ok')

  # ---- 5/5 Nettoyage ----
  $etape = (T 'etape.nettoyage')
  Write-SzhEtape (T 'maj.e5')
  # Rootfs : on garde l'archive courante et la précédente.
  $archives = @(Get-ChildItem (Join-Path $SzhStaging 'szh-publishing-rootfs-*.tar.gz') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($archives.Count -gt 2) { $archives | Select-Object -Skip 2 | Remove-Item -Force }
  # Deux archives de toolkit aussi, pour pouvoir réinstaller la version précédente.
  $zips = @(Get-ChildItem (Join-Path $SzhStaging 'toolkit-*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($zips.Count -gt 2) { $zips | Select-Object -Skip 2 | Remove-Item -Force }
  # Cinq manifestes en cache, qui couvrent les archives conservées.
  $manifests = @(Get-ChildItem (Join-Path $SzhStaging 'manifest-*.json') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($manifests.Count -gt 5) { $manifests | Select-Object -Skip 5 | Remove-Item -Force }
  Get-ChildItem (Join-Path $SzhStaging '*.vsix') -ErrorAction SilentlyContinue | Remove-Item -Force
  # Restes d'une extraction de contrôle interrompue (coupure de courant, disque plein).
  Get-ChildItem (Join-Path $SzhStaging 'toolkit-extrait-*') -Directory -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  # L'ancien fichier commun de cadence ; elle est désormais par compte (szh-taches.ps1).
  $ancienneCadence = Join-Path $SzhBase 'maj-auto.json'
  if (Test-Path $ancienneCadence) {
    Remove-Item -LiteralPath $ancienneCadence -Force -ErrorAction SilentlyContinue
  }
  Write-SzhOk (T 'maj.e5.ok')

  # ---- Migration de l'arborescence (dossier de test seulement) ----
  # Voir szh-migration.ps1. Un problème est journalisé et attend le prochain passage.
  try { Invoke-SzhMigrationArborescence } catch {
    try { Write-SzhLog ('update : migration arborescence impossible -> ' + $_.Exception.Message) } catch { }
  }

  # ---- État final ----
  # Deux états : celui du poste (version du toolkit, commune à tous les comptes) et celui
  # du compte (environnement de fabrication et extensions).
  #
  # Set-SzhStateCles écrit clé par clé : state.json porte aussi la langue du dernier
  # lanceur ouvert, qu'une réécriture complète effacerait.
  Set-SzhStateCles ([ordered]@{
    version    = $manifest.version
    toolkit    = $manifest.version
    misAJourLe = (Get-Date -Format 's')
  }) -Retirer @('rootfs', 'vsix') | Out-Null
  Save-SzhEtatUtilisateur ([ordered]@{
    compte     = $moi.nom
    rootfs     = $rootfsPose
    vsix       = $etatVsix
    misAJourLe = (Get-Date -Format 's')
  }) | Out-Null

  # Une étape en échec : l'écran dit que le reste est en place et nomme l'étape. Code de
  # sortie 1, pour que la passe silencieuse compte un blocage.
  if ($ennuis.Count -gt 0) {
    $premier = $ennuis[0]
    Write-SzhLog ('update PARTIEL -> {0} ; reste en panne : {1}' -f $manifest.version, $premier.etape)
    Write-Host ''
    Write-Host ('  ' + (T 'maj.partiel' @($manifest.version, $premier.etape))) -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch { }
    try { $SzhMutex.ReleaseMutex() } catch { }
    Show-SzhErreur -Etape $premier.etape -Message $premier.message -Journal $journal -Code 'MAJ-ETAPE-ECHEC'
    exit 1
  }

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
  Show-SzhErreur -Etape $etape -Message $message -Journal $journal -Code 'MAJ-ECHEC'
  exit 1
}
