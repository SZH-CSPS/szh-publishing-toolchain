<#
.SYNOPSIS
  Met à jour l'outil Revue SZH dans une fenêtre visible. Lancée d'ordinaire par
  update-launcher.ps1, ou par les entrées « Mise à jour » du menu Démarrer, qui lui
  passent la langue de l'équipe à qui elles s'adressent :

    powershell -ExecutionPolicy Bypass -File update.ps1                  # dernière version
    powershell -ExecutionPolicy Bypass -File update.ps1 -Version X.Y.Z  # version précise
    powershell -ExecutionPolicy Bypass -File update.ps1 -Langue de       # fenêtre en allemand

  Ne demande jamais les droits administrateur : import WSL, extensions et réglages de
  l'éditeur sont au niveau utilisateur. Idempotente, composant par composant d'après
  state.json.

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  [string]$Version,   # vide = dernière release ; sinon le tag sans son « v »
  [string]$Langue     # vide = langue du poste ; 'fr', 'de' ou 'en' pour cette fenêtre
)

. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"

# Langue de l'entrée du menu Démarrer qui a ouvert cette fenêtre : les deux raccourcis
# « Mise à jour » parlent chacun à son équipe, et la fenêtre doit suivre. Pour cette
# session seulement — la préférence du poste, écrite par les lanceurs de produit, n'est pas
# touchée : la mise à jour n'est pas un produit et n'a pas à choisir pour eux. Valeur
# inconnue : on l'ignore et le poste garde sa langue, plutôt que d'échouer sur un détail
# d'affichage. $env:SZH_LANGUE garde le dernier mot, comme partout ailleurs.
$envLangue = ($env:SZH_LANGUE -and (@('fr', 'de', 'en') -contains $env:SZH_LANGUE.ToLower()))
if ($Langue -and (-not $envLangue) -and (@('fr', 'de', 'en') -contains $Langue.ToLower())) {
  $script:SzhLangue = $Langue.ToLower()
}

# Cette fenêtre se présente sous sa propre identité : sans elle, la barre des tâches range
# son bouton avec les autres consoles PowerShell du poste et en prend l'icône. Sans effet
# quand la console est hébergée par Windows Terminal, dont la fenêtre ne nous appartient
# pas ; l'entrée du menu Démarrer, elle, garde son icône dans tous les cas.
$idMaj = Get-SzhAppId ('maj.' + $SzhLangue)
if (-not $idMaj) { $idMaj = Get-SzhAppId 'maj' }
[void](Set-SzhAppUserModelId $idMaj)

try { $Host.UI.RawUI.WindowTitle = (T 'maj.fenetre') } catch { }

# ---- Association « Ouvrir avec » des .md ----
# Pose le ProgId SZH.Markdown dans HKCU, sans administrateur, et l'inscrit dans « Ouvrir
# avec » pour les .md. On ne force pas l'application par défaut : la clé UserChoice est
# scellée par un hachage Microsoft, et l'écraser casserait la garantie que le choix vient
# de l'utilisateur ; le « Toujours utiliser cette application » reste un geste à faire une
# fois par personne (voir userdoc.md). OpenWithProgids est de type REG_NONE sans donnée,
# la forme qu'attend le shell. $Racine est paramétrable pour tester hors de la vraie ruche.
function Set-SzhProgIdMarkdown {
  param(
    [string]$Racine  = 'HKCU:\Software\Classes',
    [string]$Toolkit = $SzhToolkit
  )
  $vbs = Join-Path $Toolkit 'windows\hidden.vbs'
  $ps1 = Join-Path $Toolkit 'windows\open-md.ps1'
  # Même construction qu'au raccourci du menu Démarrer. hidden.vbs requote chacun de ses
  # arguments, donc le « %1 » arrive intact à open-md.ps1, espaces compris.
  $commande = ('"{0}\System32\wscript.exe" //B "{1}" "{2}" "%1"' -f $env:WINDIR, $vbs, $ps1)

  $icone = Join-Path $Toolkit 'windows\szh-revue.ico'

  $cleProg = Join-Path $Racine 'SZH.Markdown'
  $cleApp = Join-Path $cleProg 'Application'
  foreach ($c in $cleProg, $cleApp, (Join-Path $cleProg 'shell\open\command'),
                 (Join-Path $cleProg 'DefaultIcon')) {
    if (-not (Test-Path $c)) { New-Item -Path $c -Force | Out-Null }
  }

  # Le nom affiché dans « Ouvrir avec » se lit dans <ProgId>\Application : sur Windows 11,
  # un FriendlyAppName posé à la racine est ignoré et la boîte annonce « Microsoft ®
  # Windows Based Script Host ». La racine nomme le type de fichier, rôle de
  # FriendlyTypeName ci-dessous.
  Set-ItemProperty -Path $cleProg -Name '(default)'        -Value 'Article de revue SZH'
  Set-ItemProperty -Path $cleProg -Name 'FriendlyTypeName' -Value 'Article de revue SZH'
  Set-ItemProperty -Path $cleApp  -Name 'ApplicationName'  -Value 'Revue SZH'
  Set-ItemProperty -Path $cleApp  -Name 'FriendlyAppName'  -Value 'Revue SZH'
  Set-ItemProperty -Path $cleApp  -Name 'ApplicationCompany' -Value 'SZH / CSPS'
  Set-ItemProperty -Path (Join-Path $cleProg 'shell\open\command') -Name '(default)' -Value $commande

  # Notre icône, pas celle de VSCodium : les deux entrées se suivent dans « Ouvrir avec »,
  # et l'utilisateur doit reconnaître celle qu'il coche une fois pour toutes. Repli sur
  # VSCodium si szh-revue.ico manque ; si VSCodium manque aussi, on ne pose rien, une clé
  # d'icône vide donnant un carré blanc là où l'absence laisse une icône générique.
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
# Enregistre le gestionnaire du schéma szh:// dans HKCU, sans administrateur : c'est ce qui
# rend cliquable, depuis un e-mail ou Teams, le lien d'« Envoyer pour traduction ». Il
# arrive au lanceur en premier argument positionnel, via hidden.vbs pour qu'aucune console
# n'apparaisse, et le lanceur revalide la grammaire. Windows demandera une fois la
# permission d'ouvrir ce type de lien : c'est voulu.
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

  # Office ne suit pas un schéma inconnu : Outlook avertit que « cet emplacement peut ne
  # pas être sûr » puis, selon la configuration, ne lance rien. D'où cette déclaration de
  # confiance, clé vide dans HKCU, dont le nom porte le deux-points comme Office l'attend.
  $confiance = 'HKCU:\Software\Microsoft\Office\Common\Security\Trusted Protocols\All Applications\szh:'
  if (-not (Test-Path $confiance)) { New-Item -Path $confiance -Force | Out-Null }
  Set-ItemProperty -Path $cle -Name '(default)' -Value 'URL:Revue SZH'
  # « URL Protocol », valeur vide, est ce qui fait d'une clé de classe un schéma d'URI.
  Set-ItemProperty -Path $cle -Name 'URL Protocol' -Value ''
  Set-ItemProperty -Path (Join-Path $cle 'shell\open\command') -Name '(default)' -Value $commande
  if (Test-Path $icone) {
    Set-ItemProperty -Path (Join-Path $cle 'DefaultIcon') -Name '(default)' -Value ('"{0}",0' -f $icone)
  }
}

# ---- Orphelins du toolkit ----
# `Expand-Archive -Force` écrase ce que l'archive contient, mais ne supprime jamais ce
# qu'elle ne contient plus : un fichier retiré du dépôt survivait donc indéfiniment dans le
# toolkit de chaque poste, mise à jour après mise à jour (constaté : neuf fichiers de
# pipeline/filters, pipeline/rapport.py et pipeline/attic, encore présents après plusieurs
# mises à jour qui auraient dû les effacer).
#
# $Extrait est une extraction à part de LA MÊME archive, faite avant d'écraser le toolkit :
# elle dit exactement ce que cette version contient. Uniquement dans les dossiers que
# l'archive gère (release.yml : pipeline, vscodium-user, revue-template, livre-template,
# windows) — un dossier qui n'appartient pas à l'archive n'a pas à être jugé par elle, et
# c'est cette limite qui rend l'opération sûre. Rien HORS $Toolkit n'est même regardé :
# state.json, config.json, staging, logs et l'état par compte vivent ailleurs.
function Remove-SzhToolkitOrphelins {
  param(
    [Parameter(Mandatory = $true)][string]$Toolkit,
    [Parameter(Mandatory = $true)][string]$Extrait
  )
  $dossiersGeres = @('pipeline', 'vscodium-user', 'revue-template', 'livre-template', 'windows')
  $retires = New-Object System.Collections.ArrayList
  $avertissements = New-Object System.Collections.ArrayList

  # ---- Garde globale : l'extraction doit ressembler à un vrai toolkit avant qu'on y touche ----
  # Constaté en bac à sable : une extraction vide (zip qui réussit sans rien contenir) aurait
  # vidé les cinq dossiers gérés du toolkit, faute de quoi que ce soit à quoi les comparer. Si
  # l'extraction ne porte NI le VERSION NI un seul des dossiers gérés, elle ne dit rien de
  # fiable sur cette version : le nettoyage entier s'abstient plutôt que de juger sur du vide.
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
    # Le défaut constaté en bac à sable : $Extrait\pipeline absent alors que $Extrait\windows
    # est présent effaçait TOUT $Toolkit\pipeline, faute de savoir ce que cette version y
    # garde. En cas de doute, ce dossier-ci n'est pas touché ; les autres, eux, restent jugés
    # chacun sur sa propre comparaison.
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
    # dossier EXISTE dans l'archive, il est juste creux. Elle ne passe pas celle-ci.
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

# ---- Une seule mise à jour à la fois (mutex nommé, portée poste) ----
# Deux update.ps1 concurrents écrivent la même archive de staging et détendent deux
# Expand-Archive sur le même toolkit, qui finit à moitié écrit. On sort proprement :
# l'autre passe finira le travail. Portée poste et non session : deux comptes connectés en
# même temps sur le même poste écrivent le même C:\ProgramData\SZH\toolkit.
$script:SzhMutex = New-SzhMutexPoste
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

  # Le compte qui exécute, dans le journal, avant tout le reste. Une mise à jour pose
  # l'essentiel PAR UTILISATEUR — distribution WSL, extensions, réglages, raccourcis,
  # associations de fichiers — et les lignes de journal ne disaient pas pour qui. Sur le
  # poste du 26 août 2026, elles annonçaient « raccourcis posés » pour un compte de support
  # élevé depuis la session de la rédactrice, qui n'a donc rien reçu.
  $moi = Get-SzhIdentite
  Write-SzhLog ('update : compte {0} (admin : {1})' -f $moi.nom, $moi.admin)

  # Ce qui a échoué sans emporter le reste. Une étape qui tombe ne doit plus priver le
  # rédacteur des quatre autres : l'ennui est retenu ici, la passe continue, et l'écran de
  # fin le dit.
  $ennuis = New-Object System.Collections.ArrayList

  # ---- Quoi de neuf ? ----
  $etape = (T 'etape.manifest')
  Write-SzhEtape (T 'maj.verif')
  $manifest = Get-SzhManifest $Version
  $etat = Get-SzhState
  $etatUtil = Get-SzhEtatUtilisateur
  Write-SzhOk (T 'maj.cible' @($manifest.version))
  # Manifest mis en cache : c'est ce qui rend une réinstallation hors ligne possible.
  # Jamais bloquant.
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
    # Écarte les orphelins AVANT d'écraser le toolkit : il faut le contenu exact de cette
    # version, extrait à part, pour savoir ce qui n'y est plus. Jamais bloquant — un souci
    # ici ne doit ni interrompre cette étape ni les suivantes ($ennuis n'est pas touché),
    # l'extraction normale qui suit répare de toute façon ce que l'archive gère.
    $extrait = ''
    try {
      $extrait = Join-Path $SzhStaging ('toolkit-extrait-' + $manifest.version)
      if (Test-Path $extrait) { Remove-Item -LiteralPath $extrait -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $extrait -Force
      $bilanOrphelins = Remove-SzhToolkitOrphelins -Toolkit $SzhToolkit -Extrait $extrait
      foreach ($o in $bilanOrphelins.retires) {
        Write-SzhLog ('update : orphelin retiré du toolkit -> ' + $o)
      }
      if ($bilanOrphelins.retires.Count -gt 0) {
        Write-SzhLog ('update : ' + $bilanOrphelins.retires.Count + ' orphelin(s) retiré(s) du toolkit (absents de la version ' + $manifest.version + ')')
      }
      foreach ($a in $bilanOrphelins.avertissements) {
        Write-SzhLog ('update : nettoyage des orphelins, anomalie -> ' + $a)
      }
    } catch {
      Write-SzhLog ('update : nettoyage des orphelins du toolkit non effectué : ' + $_.Exception.Message)
    } finally {
      if ($extrait -and (Test-Path $extrait)) { Remove-Item -LiteralPath $extrait -Recurse -Force -ErrorAction SilentlyContinue }
    }

    Expand-Archive -Path $zip -DestinationPath $SzhToolkit -Force
    Write-SzhOk (T 'maj.e1.ok')
  } else {
    Write-SzhOk (T 'maj.deja')
  }

  # ---- 2/5 Environnement de fabrication (distro WSL) ----
  #
  # Jamais fatale. C'est l'étape la plus lourde — 574 Mo, un import, des verrous de
  # fichiers — et son échec emportait les étapes 3, 4 et 5 : la rédactrice du poste du
  # 26 août 2026 s'est retrouvée sans raccourcis, sans extensions et sans réglages pour une
  # panne qui ne concernait qu'elle. L'ennui est retenu, la passe continue, l'écran de fin
  # le dit.
  #
  # La version posée se lit dans l'état PAR UTILISATEUR : l'enregistrement d'une
  # distribution WSL est par compte, et l'état commun du poste affirmait « installé » à un
  # compte qui n'avait rien.
  $etape = (T 'etape.env')
  Write-SzhEtape (T 'maj.e2')
  $rootfsPose = Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'
  $distroPresente = ((Get-SzhDistrosEnregistrees) -contains $SzhDistro)
  # Reprise des postes d'avant l'état par utilisateur : la version n'y était retenue que
  # dans l'état commun. On l'accepte une fois, et seulement si la distribution est bien
  # enregistrée pour CE compte — sinon les postes déjà installés réimporteraient 3 Go pour
  # rien. Un compte qui n'a rien enregistré, lui, ne reçoit pas cette confiance : c'est
  # précisément le mensonge qu'on retire.
  if ((-not $rootfsPose) -and $distroPresente -and $etat -and $etat.rootfs) {
    $rootfsPose = [string]$etat.rootfs
  }
  # Version retenue mais aucune distribution enregistrée pour ce compte : c'est la
  # distribution qui dit vrai, pas le fichier.
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

      # La place se vérifie AVANT de désenregistrer quoi que ce soit : un import à moitié
      # fait laisse un dossier pris et aucune distribution, et c'est cet état-là qui bloque
      # ensuite toutes les mises à jour. 5 Go : l'archive (0,6) et le disque qu'elle déplie
      # (≈ 2,4), avec la marge de l'ancien environnement pas encore effacé.
      $libre = Get-SzhEspaceLibreGo
      if (($libre -ge 0) -and ($libre -lt 5)) { throw (T 'err.espace' @($libre, 5)) }

      Write-SzhInfo (T 'maj.install')
      if ($distroPresente) {
        Invoke-SzhNatif { & $wsl --terminate $SzhDistro 2>$null | Out-Null }
        Invoke-SzhNatif { & $wsl --unregister $SzhDistro 2>$null | Out-Null }
      }
      $dirDistro = Get-SzhDossierDistro
      # Un reste : installation interrompue, disque plein, ou dossier commun d'avant cette
      # version. `wsl --import` refuse d'écrire dans un dossier déjà pris, et rien ne le
      # nettoyait jamais : le poste répétait le même message à chaque essai, pour toujours.
      try {
        if (Clear-SzhDossierDistro -Dossier $dirDistro) { Write-SzhInfo (T 'maj.env.repare') }
      } catch {
        throw (T 'err.wsl.dossier')
      }
      New-Item -ItemType Directory -Force -Path $dirDistro | Out-Null
      & $wsl --import $SzhDistro $dirDistro $tar --version 2
      if ($LASTEXITCODE -ne 0) {
        # Deux pannes derrière un même code de retour, et deux gestes opposés : un dossier
        # déjà pris ne se règle pas en fermant l'éditeur.
        if (Test-Path (Join-Path $dirDistro 'ext4.vhdx')) { throw (T 'err.wsl.dossier') }
        throw (T 'err.wsl')
      }
      Invoke-SzhNatif { & $wsl --terminate $SzhDistro 2>$null | Out-Null }   # force la relecture de /etc/wsl.conf

      # Un import réussi ne prouve pas qu'une distribution démarre : sans virtualisation,
      # l'import passe et le premier `--exec` échoue. Sans ce contrôle, la panne
      # n'apparaissait qu'à la première tentative de PDF, loin de sa cause.
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
  # Ce qui est réellement posé POUR CE COMPTE : l'éditeur en est la seule preuve. L'état
  # retenu ne sert que si son CLI ne répond pas. Un état commun au poste affirmait « dix
  # extensions posées » à un compte qui n'en avait aucune, et la mise à jour les sautait
  # comme « déjà à jour » : le rédacteur se retrouvait sans cockpit, sans rien qui échoue.
  # L'état commun est lu en dernier recours, pour les postes d'avant l'état par utilisateur.
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
        # Le code de retour est LU, et l'etat n'enregistre la version que si
        # l'installation a reussi. Sans cela un echec passager -- editeur a redemarrer,
        # fichier verrouille -- faisait croire l'extension posee, et la mise a jour
        # suivante la sautait comme « deja a jour » : l'extension ne revenait jamais.
        # Invoke-SzhNatif : le CLI de VSCodium (Node 22) ecrit des DeprecationWarning sur
        # stderr, et sous ErrorActionPreference = 'Stop' le 2>&1 de PowerShell 5.1 en
        # faisait une erreur fatale (DEP0169 url.parse, mise a jour 2026.08.47 coupee).
        $sortie = Invoke-SzhNatif { & $cli --install-extension $vf --force 2>&1 }
        if ($LASTEXITCODE -eq 0) {
          $etatVsix[$ext.id] = $ext.version
          $changement = $true
        } else {
          # Une extension qui echoue n'arrete pas les autres, ni le reste de la mise
          # a jour : elle se signale, et l'etat la laisse a reprendre.
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
    foreach ($f in 'settings.json', 'keybindings.json', 'tasks.json') {
      $s = Join-Path $src $f
      if (Test-Path $s) { Copy-Item $s (Join-Path $dst $f) -Force }
    }
    $sn = Join-Path $src 'snippets'
    if (Test-Path $sn) { Copy-Item (Join-Path $sn '*') (Join-Path $dst 'snippets') -Force }
  }

  # Le pack de langue allemand est épinglé dans vsix.lock, mais VSCodium ne bascule ses
  # menus natifs que si %APPDATA%\VSCodium\argv.json porte « locale ». Allemand seulement,
  # aucun pack français n'étant épinglé. argv.json est du JSON avec commentaires, d'où une
  # retouche textuelle et non un ConvertFrom-Json.
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

  # Réglages WSL du poste : plafond de mémoire et extinction automatique de la machine.
  $wslCfg = Join-Path $SzhToolkit 'windows\user.wslconfig'
  if (Test-Path $wslCfg) { Copy-Item $wslCfg (Join-Path $env:USERPROFILE '.wslconfig') -Force }

  # Raccourcis du menu Démarrer, au niveau utilisateur : les deux lanceurs de produit et
  # les deux entrées de mise à jour. La liste et les libellés sont dans szh-common.ps1,
  # que bootstrap.ps1 et update-launcher.ps1 appellent aussi — un poste neuf comme un
  # poste déjà à jour reçoit ainsi les mêmes entrées, sans intervention.
  #
  # Jamais bloquant, pour la même raison que la ruche de classes plus bas : un menu
  # Démarrer verrouillé par une stratégie de groupe ne doit pas faire échouer une mise à
  # jour par ailleurs réussie. Mais le journal le dit, sinon un raccourci qui manque reste
  # introuvable.
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

  # La tâche planifiée qui déclenche les mises à jour, même leçon que les raccourcis :
  # bootstrap.ps1 ne tourne qu'à l'installation, donc un poste installé avant que le rythme
  # change garderait son déclencheur quotidien de 11 h pour toujours. Réécrite seulement si
  # elle diffère, jamais recréée quand elle est déjà juste.
  #
  # Jamais bloquant, et le refus est ici le cas courant plutôt que l'exception : la tâche vit
  # dans la racine du planificateur, qui appartient à l'administrateur, et cette fenêtre ne
  # demande pas l'élévation. Elle réussit quand bootstrap.ps1 l'a lancée — l'installation —
  # ou quand un administrateur ouvre le raccourci « Mise à jour » en tant qu'administrateur.
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

  # Jamais bloquante : une ruche de classes verrouillée par une stratégie de groupe ne
  # doit pas faire échouer une mise à jour par ailleurs réussie.
  try {
    Set-SzhProgIdMarkdown
    Write-SzhLog ('update : ProgId SZH.Markdown posé pour {0} (HKCU, Ouvrir avec)' -f $moi.nom)
  } catch {
    Write-SzhLog ('update : ProgId SZH.Markdown non posé : ' + $_.Exception.Message)
  }

  # Protocole des liens « Envoyer pour traduction ». Même posture : jamais bloquant.
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
  # Deux archives de toolkit, comme pour le rootfs : sans la précédente, « réinstaller une
  # version antérieure » n'aurait rien à réinstaller.
  $zips = @(Get-ChildItem (Join-Path $SzhStaging 'toolkit-*.zip') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($zips.Count -gt 2) { $zips | Select-Object -Skip 2 | Remove-Item -Force }
  # Les manifests en cache sont minuscules : cinq couvrent les archives conservées.
  $manifests = @(Get-ChildItem (Join-Path $SzhStaging 'manifest-*.json') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($manifests.Count -gt 5) { $manifests | Select-Object -Skip 5 | Remove-Item -Force }
  Get-ChildItem (Join-Path $SzhStaging '*.vsix') -ErrorAction SilentlyContinue | Remove-Item -Force
  # Reste d'un nettoyage d'orphelins interrompu (coupure de courant, disque plein) : cette
  # extraction à part n'a plus lieu d'être une fois l'étape 1/5 passée.
  Get-ChildItem (Join-Path $SzhStaging 'toolkit-extrait-*') -Directory -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  # La cadence de la passe silencieuse a déménagé chez l'utilisateur. Le fichier commun
  # d'avant ne dit plus rien de personne, et le laisser ferait mal lire un poste au
  # prochain diagnostic.
  $ancienneCadence = Join-Path $SzhBase 'maj-auto.json'
  if (Test-Path $ancienneCadence) {
    Remove-Item -LiteralPath $ancienneCadence -Force -ErrorAction SilentlyContinue
  }
  Write-SzhOk (T 'maj.e5.ok')

  # ---- État final ----
  # Deux états, parce qu'il y a deux vérités. Le poste : la version du toolkit, commune à
  # tous les comptes. Le compte : l'environnement de fabrication et les extensions, qui sont
  # les siens et ceux de personne d'autre. Les confondre faisait croire à un compte neuf que
  # tout était déjà posé, et la mise à jour ne lui posait rien.
  #
  # Set-SzhStateCles et non Save-SzhState : state.json porte aussi la langue choisie par le
  # dernier lanceur ouvert, qu'une réécriture complète effaçait à chaque mise à jour.
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

  # Un ennui retenu : tout le reste est en place, et c'est ce que l'écran doit dire — ni
  # « terminé », qui serait faux, ni un écran d'erreur nu qui laisserait croire que rien
  # n'a été fait. Le code de sortie reste 1, pour que la passe silencieuse compte un
  # blocage et finisse par rouvrir cette fenêtre si la panne dure.
  if ($ennuis.Count -gt 0) {
    $premier = $ennuis[0]
    Write-SzhLog ('update PARTIEL -> {0} ; reste en panne : {1}' -f $manifest.version, $premier.etape)
    Write-Host ''
    Write-Host ('  ' + (T 'maj.partiel' @($manifest.version, $premier.etape))) -ForegroundColor Yellow
    try { Stop-Transcript | Out-Null } catch { }
    try { $SzhMutex.ReleaseMutex() } catch { }
    Show-SzhErreur -Etape $premier.etape -Message $premier.message -Journal $journal
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
  Show-SzhErreur -Etape $etape -Message $message -Journal $journal
  exit 1
}
