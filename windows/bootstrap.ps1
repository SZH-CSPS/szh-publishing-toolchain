<#
.SYNOPSIS
  Préparation d'un poste, à lancer une fois en administrateur :
    powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1

  Ne fait que ce qui exige l'administrateur : dossiers C:\ProgramData\SZH ouverts en
  écriture aux Utilisateurs, moteur WSL sans distribution, VSCodium et SumatraPDF au
  niveau machine dans les versions figées par windows/apps.lock (téléchargement direct,
  sha256 et signature vérifiés — winget n'est plus dans la chaîne, voir APPS.md),
  toolkit initial, tâches planifiées de mise à jour et de préchauffage WSL, puis
  une première mise à jour visible. Ensuite le poste n'a plus besoin d'administrateur,
  sauf pour monter VSCodium ou SumatraPDF de version, geste volontairement manuel.

  Ce script pose aussi, POUR LE COMPTE QUI L'EXÉCUTE, ce qui est par utilisateur
  (raccourcis, réglages, extensions, environnement WSL). Élevé avec un compte de support
  depuis la session d'un rédacteur, il ne peut donc pas servir ce rédacteur : il le dit,
  s'en abstient, et laisse la tâche planifiée le faire à sa prochaine ouverture de session.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param(
  [string]$Repo = 'SZH-CSPS/szh-publishing-toolchain'   # dépôt GitHub public (Releases)
)

. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"

function Info([string]$m) { Write-Host ('[bootstrap] ' + $m) -ForegroundColor Cyan }
function Attention([string]$m) { Write-Host ('[bootstrap] ' + $m) -ForegroundColor Yellow }

# ---- Administrateur requis ----
$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
            ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $estAdmin) { throw 'Lancer ce script en tant qu''administrateur.' }
Write-SzhBanniere 'Installation du poste (administrateur)'

# ---- Journal ----
# Sans transcription, l'installation d'un poste ne laissait AUCUNE trace : seule la mise à
# jour en écrivait, et le diagnostic du 26 août 2026 s'est fait sur quatre journaux qui ne
# parlaient que d'elle. Le journal mensuel reçoit en plus les deux comptes en jeu.
New-Item -ItemType Directory -Force -Path $SzhLogs | Out-Null
$journalInstall = Join-Path $SzhLogs ('bootstrap-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
try { Start-Transcript -Path $journalInstall | Out-Null } catch { }

# ---- Qui installe, et pour qui ----
#
# Le piège de cette installation, et la cause de toute la panne du 26 août 2026 : élevée
# depuis la session d'une rédactrice avec le compte du support, elle tourne SOUS le compte
# du support. HKCU, %APPDATA%, %LOCALAPPDATA% et l'enregistrement des distributions WSL
# sont ceux du support. Tout ce qui est par utilisateur — distribution WSL, extensions,
# réglages, raccourcis, associations — atterrit donc dans le mauvais profil, et la
# rédactrice ouvre sa session sans rien. Rien ne le disait : les lignes de journal ne
# nommaient pas le compte.
#
# On ne peut pas y remédier ici — un processus ne peut pas écrire dans le profil d'un autre
# compte —, mais on peut le NOMMER, et ne pas gaspiller 3 Go d'environnement pour un compte
# de support qui ne rédigera jamais.
$moi = Get-SzhIdentite
$sessionUtilisateur = Get-SzhSessionUtilisateur
$memeCompte = ((-not $sessionUtilisateur) -or ($sessionUtilisateur -eq $moi.nom))
Info ('Compte qui installe : ' + $moi.nom)
Write-SzhLog ('bootstrap : compte {0}, session ouverte pour « {1} »' -f $moi.nom, $sessionUtilisateur)
if (-not $memeCompte) {
  Attention ('Session ouverte pour ' + $sessionUtilisateur + ', installation élevée sous ' + $moi.nom + '.')
  Attention 'Ce qui est par utilisateur (extensions, réglages, raccourcis, environnement WSL) NE PEUT PAS'
  Attention ('être posé dans le profil de ' + $sessionUtilisateur + " depuis ici : c'est fait à sa prochaine")
  Attention 'ouverture de session, par la tâche planifiée. Rien à faire de plus, sinon vérifier ensuite'
  Attention 'avec windows\diagnostic.ps1, lancé DANS SA session et sans élévation.'
}

# ---- Dossiers et droits ----
Info 'Dossiers C:\ProgramData\SZH + droits Utilisateurs (mises à jour sans admin)'
New-Item -ItemType Directory -Force -Path $SzhBase, $SzhStaging, $SzhLogs, $SzhToolkit | Out-Null
# S-1-5-32-545 = groupe Utilisateurs (indépendant de la langue de Windows)
& icacls $SzhBase /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null

if (-not (Test-Path $SzhConfigFile)) {
  $cfg = [ordered]@{
    repo        = $Repo
    # Le lanceur ne liste que l'arborescence officielle (basesRevues ci-dessous). Cette
    # clé ne sert plus qu'à signaler des revues restées ailleurs : vide sur un poste
    # neuf, à remplir à la main pour surveiller un dossier historique.
    revuesRoots = @()
    # Mode développeur : les revues sont cherchées, créées et archivées sous
    # basesRevues.dev. Bascule depuis « Réglages SZH » du cockpit, ou ici.
    devMode     = $true
    # Emplacements « en cours » et archives. Seule la base change entre test et
    # production, les sous-dossiers étant figés dans szh-common.ps1. À corriger ici si
    # la bibliothèque SharePoint est synchronisée sous un autre nom.
    basesRevues = [ordered]@{
      prod = '%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte'
      dev  = '%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING'
    }
  }
  Set-SzhJson $SzhConfigFile $cfg
}

# ---- Moteur WSL ----
Info 'Vérification du moteur WSL'
$wsl = Get-WslExe
Invoke-SzhNatif { $null = & $wsl --status 2>&1 }
if ($LASTEXITCODE -ne 0) {
  Attention 'WSL absent -> installation du moteur (sans distribution). REDÉMARRAGE requis ensuite.'
  & $wsl --install --no-distribution
  Attention 'Redémarrer le poste puis RELANCER bootstrap.ps1.'
  return
}

# ---- Applications du poste (versions figées, niveau machine) ----
#
# winget n'est plus dans la chaîne, et ce n'est pas un caprice. Sur un poste neuf il tombe en
# panne plus souvent qu'on ne le croit — index de source jamais synchronisé
# (« 0x8a15000f : données manquantes »), source msstore qui réclame une région à deux
# lettres, proxy d'entreprise qui coupe cdn.winget.microsoft.com — et, sous une élévation
# faite avec un compte de support, son App Installer n'est même pas provisionné pour ce
# compte : winget n'existe simplement pas. Le 26 août 2026, les deux applications ont fini
# par être posées à la main.
#
# À la place, le patron de vsix.lock : version et empreinte figées dans windows/apps.lock,
# téléchargement direct, sha256 vérifié, signature de l'éditeur lue, installation
# silencieuse, puis contrôle par le disque. Détails et procédure de montée : APPS.md.
function Get-SzhApplicationsEpinglees {
  param([string]$Fichier = '')
  if (-not $Fichier) { $Fichier = Join-Path $PSScriptRoot 'apps.lock' }
  if (-not (Test-Path $Fichier)) { throw ('apps.lock introuvable : ' + $Fichier) }
  return (Get-Content $Fichier -Raw -Encoding UTF8 | ConvertFrom-Json).applications
}

# Le chemin de l'application si elle est posée, sinon ''. Les sondes viennent du verrou, dans
# leur ordre : le paquet système d'abord, le paquet par utilisateur ensuite.
#
# $SystemeSeulement : quand l'installation est élevée avec un autre compte, le paquet « par
# utilisateur » qu'on trouverait serait celui du SUPPORT, et le rédacteur ouvrirait sa
# session sans éditeur. On l'ignore alors, et on pose le paquet système.
function Get-SzhAppChemin($App, [switch]$SystemeSeulement) {
  foreach ($s in @($App.sondes)) {
    $brut = [string]$s
    if ($SystemeSeulement -and ($brut -like '*LOCALAPPDATA*')) { continue }
    $p = [Environment]::ExpandEnvironmentVariables($brut)
    if (Test-Path $p) { return $p }
  }
  return ''
}

function Get-SzhAppVersion([string]$Chemin) {
  try { return ([string](Get-Item $Chemin).VersionInfo.ProductVersion).Trim() } catch { return '' }
}

function Install-SzhAppEpinglee($App, [switch]$SystemeSeulement) {
  $exe = Join-Path $SzhStaging ([string]$App.fichier)
  if (Test-SzhSha256 -Fichier $exe -Attendu $App.sha256) {
    Info ('Installeur déjà en cache : ' + $App.fichier)
  } else {
    Info ('Téléchargement de ' + $App.fichier)
    Get-SzhFichier -Url $App.source -Destination $exe
    if (-not (Test-SzhSha256 -Fichier $exe -Attendu $App.sha256)) {
      throw ('Empreinte inattendue pour {0} : ce n''est pas le fichier épinglé dans apps.lock. Rien n''a été installé.' -f $App.fichier)
    }
  }

  # Un proxy qui répond par une page d'erreur rend un fichier de la bonne taille et du
  # mauvais genre. L'empreinte l'attrape aussi, mais deux octets nomment la cause.
  $entete = [System.IO.File]::ReadAllBytes($exe)[0..1]
  if (($entete[0] -ne 0x4D) -or ($entete[1] -ne 0x5A)) {
    throw ('{0} n''est pas un exécutable Windows — réponse d''un proxy ?' -f $App.fichier)
  }

  # La signature ne remplace pas l'empreinte, elle la double : l'empreinte fige des octets,
  # la signature dit qui les a produits. Un défaut de chaîne ou de révocation sur un poste
  # hors ligne ne doit pas arrêter une installation — d'où l'avertissement plutôt que
  # l'arrêt, sauf pour « pas signé » et « empreinte de signature fausse », qui n'arrivent
  # pas par accident.
  $sig = $null
  try { $sig = Get-AuthenticodeSignature $exe } catch { $sig = $null }
  if ($sig) {
    $etatSig = [string]$sig.Status
    if (($etatSig -eq 'HashMismatch') -or ($etatSig -eq 'NotSigned')) {
      throw ('Signature de {0} : {1}. Rien n''a été installé.' -f $App.fichier, $etatSig)
    }
    $sujet = ''
    try { $sujet = [string]$sig.SignerCertificate.Subject } catch { $sujet = '' }
    if ($App.signataire -and $sujet -and ($sujet -notlike ('*' + $App.signataire + '*'))) {
      Attention ('Signataire inattendu pour {0} : {1} (attendu : {2}).' -f $App.fichier, $sujet, $App.signataire)
    }
    if ($etatSig -ne 'Valid') {
      Attention ('Signature de {0} non validée sur ce poste ({1}) — l''empreinte, elle, correspond.' -f $App.fichier, $etatSig)
    }
  }

  # Un jeu d'arguments, et son repli si le verrou en déclare un : un drapeau qui disparaît
  # d'une version amont ne doit pas laisser un poste sans lecteur PDF.
  $jeux = New-Object System.Collections.ArrayList
  [void]$jeux.Add(@($App.installation))
  if ($App.installationRepli) { [void]$jeux.Add(@($App.installationRepli)) }
  foreach ($jeu in $jeux) {
    Info ('Installation silencieuse : {0} {1}' -f $App.fichier, ($jeu -join ' '))
    $p = Start-Process -FilePath $exe -Wait -PassThru -ArgumentList $jeu
    # C'est le disque qui décide, pas le code de retour : un installeur peut sortir en 0
    # sans rien poser là où on l'attend, et l'inverse arrive aussi.
    $chemin = Get-SzhAppChemin $App -SystemeSeulement:$SystemeSeulement
    if ($chemin) { return $chemin }
    Attention ('{0} : code de sortie {1}, et rien de posé.' -f $App.fichier, $p.ExitCode)
  }
  return ''
}

Info 'Applications du poste (versions figées dans apps.lock)'
foreach ($app in @(Get-SzhApplicationsEpinglees)) {
  $chemin = Get-SzhAppChemin $app -SystemeSeulement:(-not $memeCompte)
  $version = ''
  if ($chemin) { $version = Get-SzhAppVersion $chemin }

  if ($chemin -and ($version -eq [string]$app.version)) {
    Info ('{0} {1} déjà en place : {2}' -f $app.nom, $version, $chemin)
    Write-SzhLog ('bootstrap : {0} {1} déjà en place' -f $app.nom, $version)
    continue
  }
  if ($chemin) {
    # Présent dans une autre version : on ne remplace pas. Une montée est un geste
    # volontaire (APPS.md), et remplacer l'éditeur pendant l'installation d'un poste n'est
    # pas une surprise à faire à quelqu'un. L'écart se lit dans diagnostic.ps1.
    Attention ('{0} est en {1}, la version épinglée est {2}. Laissé tel quel : une montée de version est un geste volontaire (windows/APPS.md).' -f $app.nom, $version, $app.version)
    Write-SzhLog ('bootstrap : {0} en écart — posé {1}, épinglé {2}' -f $app.nom, $version, $app.version)
    continue
  }

  try {
    $pose = Install-SzhAppEpinglee $app -SystemeSeulement:(-not $memeCompte)
    if ($pose) {
      Info ('{0} {1} posé : {2}' -f $app.nom, $app.version, $pose)
      Write-SzhLog ('bootstrap : {0} {1} installé' -f $app.nom, $app.version)
    } elseif ($app.requis) {
      throw ('{0} introuvable après installation. Le poser à la main depuis {1}, puis relancer ce script.' -f $app.nom, $app.source)
    } else {
      Attention ('{0} non installé — à poser à la main depuis {1}.' -f $app.nom, $app.source)
    }
  } catch {
    # Requis : on s'arrête, un poste sans éditeur n'est pas un poste. Facultatif : on le dit
    # et on continue — la chaîne compile sans lecteur PDF, mais le rédacteur doit savoir
    # qu'un PDF ouvert dans Acrobat bloque la compilation suivante.
    if ($app.requis) { throw }
    Attention ('{0} non installé : {1}' -f $app.nom, $_.Exception.Message)
    Write-SzhLog ('bootstrap : {0} non installé -> {1}' -f $app.nom, $_.Exception.Message)
  }
}

$codium = Get-VSCodiumExe
if (-not $codium) {
  throw ('VSCodium introuvable après installation. Poser l''éditeur à la main depuis ' +
         'https://github.com/VSCodium/vscodium/releases (VSCodiumSetup-x64), puis relancer ce script.')
}
# Un éditeur posé dans le profil de l'administrateur n'existe pour aucun rédacteur : le poste
# passerait l'installation pour se bloquer à la première ouverture de session.
if ($codium -like ($env:LOCALAPPDATA + '*')) {
  Attention ('VSCodium n''est installé que pour ce compte (' + $codium + ') : le désinstaller ' +
             'puis reprendre avec l''installeur système, sinon les rédacteurs n''auront pas d''éditeur.')
}

# ---- Orphelins du toolkit ----
# Même manque que update.ps1, et même correction : `Expand-Archive -Force` écrase ce que
# l'archive contient mais ne supprime jamais ce qu'elle ne contient plus. Sans effet sur un
# poste neuf, qui part d'un $SzhToolkit vide — mais bootstrap.ps1 est aussi ce qu'un
# administrateur relance en réparation sur un poste déjà installé (voir plus bas, tâche
# planifiée), et cette rejouabilité mérite la même garantie.
#
# $Extrait est une extraction à part de LA MÊME archive, faite avant d'écraser le toolkit :
# elle dit exactement ce que cette version contient. Uniquement dans les dossiers que
# l'archive gère (release.yml : pipeline, vscodium-user, revue-template, livre-template,
# windows) — un dossier qui n'appartient pas à l'archive n'a pas à être jugé par elle.
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

# ---- Toolkit initial ----
Info 'Toolkit initial'
$toolkitOk = $false
try {
  $manifest = Get-SzhManifest
  $zip = Join-Path $SzhStaging $manifest.toolkit.file
  Get-SzhFichier -Url $manifest.toolkit.url -Destination $zip -Silencieux
  if (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256) {
    # Écarte les orphelins AVANT d'écraser le toolkit. Jamais bloquant : un souci ici ne
    # doit pas empêcher l'installation du poste, l'extraction normale qui suit répare de
    # toute façon ce que l'archive gère.
    $extrait = ''
    try {
      $extrait = Join-Path $SzhStaging ('toolkit-extrait-' + $manifest.version)
      if (Test-Path $extrait) { Remove-Item -LiteralPath $extrait -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $extrait -Force
      $bilanOrphelins = Remove-SzhToolkitOrphelins -Toolkit $SzhToolkit -Extrait $extrait
      foreach ($o in $bilanOrphelins.retires) {
        Write-SzhLog ('bootstrap : orphelin retiré du toolkit -> ' + $o)
      }
      if ($bilanOrphelins.retires.Count -gt 0) {
        Write-SzhLog ('bootstrap : ' + $bilanOrphelins.retires.Count + ' orphelin(s) retiré(s) du toolkit (absents de la version ' + $manifest.version + ')')
      }
      foreach ($a in $bilanOrphelins.avertissements) {
        Write-SzhLog ('bootstrap : nettoyage des orphelins, anomalie -> ' + $a)
      }
    } catch {
      Write-SzhLog ('bootstrap : nettoyage des orphelins du toolkit non effectué : ' + $_.Exception.Message)
    } finally {
      if ($extrait -and (Test-Path $extrait)) { Remove-Item -LiteralPath $extrait -Recurse -Force -ErrorAction SilentlyContinue }
    }

    Expand-Archive -Path $zip -DestinationPath $SzhToolkit -Force
    $toolkitOk = $true
    Info ('Toolkit {0} téléchargé depuis la Release.' -f $manifest.version)
  }
} catch {
  Attention ('Release inaccessible ({0}).' -f $_.Exception.Message)
}
if (-not $toolkitOk) {
  # Repli hors ligne : le script tourne depuis un clone du dépôt, on copie sur place.
  $racineDepot = Split-Path $PSScriptRoot -Parent
  if (Test-Path (Join-Path $racineDepot 'pipeline\Makefile')) {
    Attention 'Repli : copie du toolkit depuis le dépôt cloné (version locale).'
    foreach ($d in 'pipeline', 'vscodium-user', 'revue-template', 'windows') {
      Copy-Item (Join-Path $racineDepot $d) $SzhToolkit -Recurse -Force
    }
    Set-Content -Path (Join-Path $SzhToolkit 'VERSION') -Value '0.0.0-local' -Encoding ASCII
    $toolkitOk = $true
  }
}
if (-not $toolkitOk) { throw 'Impossible d''obtenir le toolkit (ni Release, ni dépôt local).' }

# ---- Raccourcis du menu Démarrer ----
# Posés ici, sans attendre la première mise à jour : si la Release est injoignable, celle-ci
# s'arrête à la lecture du manifest et le poste resterait sans aucune entrée de menu alors
# que le toolkit, lui, est en place par le repli hors ligne. Ils atterrissent dans le profil
# du compte qui lance ce script, donc celui de l'administrateur ; chaque rédacteur reçoit
# les siens à sa première ouverture de session, par la tâche planifiée ci-dessous. Jamais
# bloquant : un menu Démarrer tenu par une stratégie de groupe n'empêche pas d'installer
# un poste, mais il faut le lire à l'écran.
Info 'Raccourcis du menu Démarrer (profil du compte qui installe)'
try {
  $bilanMenu = Set-SzhRaccourcisMenu
  if ($bilanMenu.poses.Count -gt 0) { Info ('Posés : ' + ($bilanMenu.poses -join ', ')) }
  foreach ($retire in $bilanMenu.retires) { Info ('Ancien raccourci retiré : ' + $retire) }
  foreach ($manque in $bilanMenu.manques) { Attention ('Raccourci non posé -> ' + $manque) }
} catch {
  Attention ('Raccourcis du menu Démarrer non posés : ' + $_.Exception.Message)
}

# ---- Tâches planifiées ----
Info 'Tâches planifiées (pour tout utilisateur connecté, sans admin)'
$vbs = Join-Path $SzhToolkit 'windows\hidden.vbs'
# Groupe Utilisateurs : la tâche tourne dans la session de l'utilisateur connecté.
$principal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew

# Mise à jour : déclencheurs, réglages et action viennent de szh-taches.ps1, que la passe de
# mise à jour relit ensuite à chaque passage. Une seule vérité, sinon un poste installé
# aujourd'hui et un poste mis à jour demain porteraient deux rythmes différents.
$bilanTache = Set-SzhTacheMaj
if ($bilanTache.etat -eq 'refusee') {
  Attention ('Tâche « ' + $SzhTacheMaj + ' » non écrite : ' + $bilanTache.message)
} else {
  Info ('Tâche « ' + $SzhTacheMaj + ' » : ' + $bilanTache.etat + ' (ouverture de session + mardi 14 h)')
}

$actionChauffe = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" `
  -Argument ('//B "{0}" "{1}" "-d" "{2}" "--exec" "/bin/true"' -f $vbs, "$env:WINDIR\System32\wsl.exe", $SzhDistro)
Register-ScheduledTask -TaskName 'SZH - Prechauffage WSL' -Action $actionChauffe `
  -Principal $principal -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Settings $reglages -Force | Out-Null

# ---- Première mise à jour, en fenêtre visible ----
#
# Seulement si l'installation tourne sous le compte de la session : sinon elle poserait
# 3 Go d'environnement de fabrication, dix extensions et tous les réglages dans le profil
# du compte de support, qui ne rédigera jamais — et c'est exactement ce dossier
# d'environnement, posé par un compte pour un autre, qui a bloqué le poste du 26 août 2026.
#
# -Wait : sans lui, bootstrap annonçait « Terminé » et ses consignes d'antivirus pendant que
# 574 Mo se téléchargeaient encore, et une session fermée trop tôt laissait un import à
# moitié fait.
if ($memeCompte) {
  Info 'Lancement de la première mise à jour (fenêtre visible)…'
  Start-Process -Wait -FilePath "$PSHOME\powershell.exe" -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $SzhToolkit 'windows\update.ps1')
  )
} else {
  Info 'Première mise à jour laissée à la session du rédacteur (tâche planifiée à l''ouverture).'
  Write-SzhLog ('bootstrap : première mise à jour non lancée ici, elle appartient à ' + $sessionUtilisateur)
}

Write-Host ''
Info 'Terminé.'
# Le disque de la distribution est rangé par SID depuis que son dossier commun bloquait le
# deuxième compte du poste : l'exclusion doit donc couvrir les sous-dossiers.
Attention ('Antivirus : exclure {0}\WSL\ (tous sous-dossiers, *.vhdx) et {1}\*, + processus vmcompute.exe, vmmem.exe, wsl.exe, wslservice.exe.' -f $SzhBase, $SzhStaging)
Attention 'Chaque utilisateur du poste recevra réglages + raccourcis à sa prochaine connexion (tâche planifiée).'
Attention 'Nouvelle revue : menu Démarrer > Revues SZH (ou Zeitschriften SZH) > « Nouvelle revue ».'
Attention 'Mise à jour à la demande : menu Démarrer > « Mise à jour de l''outil Revue » (ou « Aktualisierung des Redaktionstools »).'
Attention ('Contrôle : powershell -ExecutionPolicy Bypass -File "{0}", dans la session du rédacteur.' -f (Join-Path $SzhToolkit 'windows\diagnostic.ps1'))

# Le bilan, tout de suite et à l'écran : une installation qui s'annonce terminée sans dire
# ce qui manque est ce qui a laissé partir un poste sans éditeur utilisable. Ce qu'il dit ne
# vaut que pour le compte qui installe — le diagnostic le dit lui-même quand ils diffèrent.
# Dans un processus à lui : le diagnostic sort en code 1 quand il manque quelque chose, et
# un `exit` dot-sourcé emporterait bootstrap avec lui, transcription comprise.
Write-Host ''
try {
  Invoke-SzhNatif {
    & "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass `
      -File (Join-Path $SzhToolkit 'windows\diagnostic.ps1') | Out-Host
  }
} catch {
  Attention ('Diagnostic non exécuté : ' + $_.Exception.Message)
}
try { Stop-Transcript | Out-Null } catch { }
