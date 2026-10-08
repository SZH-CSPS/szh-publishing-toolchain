<#
.SYNOPSIS
  Préparation d'un poste, à lancer une fois en administrateur :
    powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1

  Fait ce qui exige l'administrateur :
    - dossiers C:\ProgramData\SZH, ouverts en écriture au groupe Utilisateurs ;
    - moteur WSL, sans distribution ;
    - VSCodium et SumatraPDF au niveau machine, dans les versions de windows/apps.lock
      (téléchargement direct, sha256 et signature vérifiés, voir APPS.md) ;
    - toolkit initial ;
    - tâches planifiées de mise à jour et de préchauffage WSL ;
  puis lance une première mise à jour visible. Ensuite, le poste n'a plus besoin
  d'administrateur, sauf pour monter VSCodium ou SumatraPDF de version, ce qui se fait à
  la main.

  La première mise à jour installe aussi ce qui est propre au compte qui exécute le
  script. Si ce compte n'est pas celui de la session ouverte (compte de support), elle
  n'est pas lancée : la tâche planifiée s'en charge à la prochaine ouverture de session.

  Compatibilité : Windows PowerShell 5.1.
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
# Transcription complète de l'installation dans bootstrap-<date>.log. Le journal mensuel
# reçoit en plus les deux comptes en jeu.
New-Item -ItemType Directory -Force -Path $SzhLogs | Out-Null
$journalInstall = Join-Path $SzhLogs ('bootstrap-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
try { Start-Transcript -Path $journalInstall | Out-Null } catch { }

# ---- Qui installe, et pour qui ----
#
# Élevé depuis la session d'un rédacteur avec un compte de support, le script tourne sous
# ce compte : HKCU, %APPDATA%, %LOCALAPPDATA% et les distributions WSL sont les siens. Ce
# qui est propre au compte ne peut pas être installé pour le rédacteur depuis ici. On le
# dit, et on n'installe pas l'environnement pour le compte de support.
$moi = Get-SzhIdentite
$sessionUtilisateur = Get-SzhSessionUtilisateur
$memeCompte = ((-not $sessionUtilisateur) -or ($sessionUtilisateur -eq $moi.nom))
Info ('Compte qui installe : ' + $moi.nom)
Write-SzhLog ('bootstrap : compte {0}, session ouverte pour « {1} »' -f $moi.nom, $sessionUtilisateur)
if (-not $memeCompte) {
  Attention ('Session ouverte pour ' + $sessionUtilisateur + ', installation élevée sous ' + $moi.nom + '.')
  Attention 'Ce qui est par utilisateur (extensions, réglages, raccourcis, environnement WSL) ne peut pas'
  Attention ('être posé dans le profil de ' + $sessionUtilisateur + " depuis ici : c'est fait à sa prochaine")
  Attention 'ouverture de session, par la tâche planifiée. Rien à faire de plus, sinon vérifier ensuite'
  Attention 'avec windows\diagnostic.ps1, lancé dans sa session et sans élévation.'
}

# ---- Dossiers et droits ----
Info 'Dossiers C:\ProgramData\SZH + droits Utilisateurs (mises à jour sans admin)'
New-Item -ItemType Directory -Force -Path $SzhBase, $SzhStaging, $SzhLogs, $SzhToolkit | Out-Null
# S-1-5-32-545 = groupe Utilisateurs (indépendant de la langue de Windows)
& icacls $SzhBase /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw ('icacls a échoué (code {0}) sur {1} : les mises à jour sans administrateur ne pourraient pas écrire dans ce dossier.' -f $LASTEXITCODE, $SzhBase)
}

if (-not (Test-Path $SzhConfigFile)) {
  $cfg = [ordered]@{
    repo        = $Repo
    # Dossiers hors de l'arborescence officielle, que le lanceur signale. Vide sur un
    # poste neuf.
    revuesRoots = @()
    # Mode développeur : les revues sont cherchées, créées et archivées sous la racine
    # d'essai. Se change dans l'onglet « Paramètres » du lanceur.
    #
    # Les racines ne sont pas écrites ici : la production vient de l'ancrage SharePoint,
    # l'essai d'une valeur par défaut (Get-SzhBaseRevuesPour, docs/EMPLACEMENTS.md).
    devMode     = $true
  }
  Set-SzhJson $SzhConfigFile $cfg
}

# ---- Moteur WSL ----
Info 'Vérification du moteur WSL'
$wsl = Get-WslExe
Invoke-SzhNatif { $null = & $wsl --status 2>&1 }
if ($LASTEXITCODE -ne 0) {
  Attention 'WSL absent -> installation du moteur (sans distribution). Redémarrage requis ensuite.'
  & $wsl --install --no-distribution
  Attention 'Redémarrer le poste puis relancer bootstrap.ps1.'
  return
}

# ---- Applications du poste (versions figées, niveau machine) ----
#
# Sans winget : sur un poste neuf, il échoue souvent (index de source non synchronisé
# « 0x8a15000f », source msstore qui réclame une région, proxy qui coupe
# cdn.winget.microsoft.com), et il n'existe pas sous une élévation faite avec un compte de
# support.
#
# Version et empreinte sont figées dans windows/apps.lock : téléchargement direct, sha256
# vérifié, signature lue, installation silencieuse, puis contrôle sur le disque. Détails et
# montée de version : APPS.md.
function Get-SzhApplicationsEpinglees {
  param([string]$Fichier = '')
  if (-not $Fichier) { $Fichier = Join-Path $PSScriptRoot 'apps.lock' }
  if (-not (Test-Path $Fichier)) { throw ('apps.lock introuvable : ' + $Fichier) }
  return (Get-Content $Fichier -Raw -Encoding UTF8 | ConvertFrom-Json).applications
}

# Le chemin de l'application si elle est installée, sinon ''. Les sondes viennent
# d'apps.lock, dans l'ordre : paquet système, puis paquet par utilisateur.
#
# $SystemeSeulement ignore le paquet par utilisateur : sous un autre compte que celui de la
# session, ce serait celui du support.
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

  # Un proxy peut renvoyer une page d'erreur à la place du fichier. L'empreinte le détecte
  # aussi, mais l'en-tête « MZ » permet d'en nommer la cause.
  $entete = [System.IO.File]::ReadAllBytes($exe)[0..1]
  if (($entete[0] -ne 0x4D) -or ($entete[1] -ne 0x5A)) {
    throw ('{0} n''est pas un exécutable Windows — réponse d''un proxy ?' -f $App.fichier)
  }

  # La signature s'ajoute à l'empreinte : elle dit qui a produit les octets. « Non signé »
  # et « empreinte de signature fausse » arrêtent l'installation ; les autres défauts
  # (chaîne ou révocation invérifiables hors ligne) donnent un avertissement.
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

  # Un jeu d'arguments, puis son repli si apps.lock en déclare un, au cas où une version de
  # l'installeur ne reconnaîtrait plus un drapeau.
  $jeux = New-Object System.Collections.ArrayList
  [void]$jeux.Add(@($App.installation))
  if ($App.installationRepli) { [void]$jeux.Add(@($App.installationRepli)) }
  foreach ($jeu in $jeux) {
    Info ('Installation silencieuse : {0} {1}' -f $App.fichier, ($jeu -join ' '))
    $p = Start-Process -FilePath $exe -Wait -PassThru -ArgumentList $jeu
    # Le disque fait foi, pas le code de retour : un installeur peut sortir en 0 sans rien
    # installer, et inversement.
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
    # Présent dans une autre version : laissé tel quel, la montée de version se fait à la
    # main (APPS.md). diagnostic.ps1 montre l'écart.
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
    # Application requise (l'éditeur) : arrêt. Facultative (le lecteur PDF) : avertissement,
    # la chaîne compile sans elle.
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
# Un éditeur installé dans le profil de l'administrateur n'existe pour aucun rédacteur.
if ($codium -like ($env:LOCALAPPDATA + '*')) {
  Attention ('VSCodium n''est installé que pour ce compte (' + $codium + ') : le désinstaller ' +
             'puis reprendre avec l''installeur système, sinon les rédacteurs n''auront pas d''éditeur.')
}

# ---- Toolkit initial ----
# Sur un poste déjà installé (réparation), le remplacement retire aussi les fichiers
# orphelins, comme update.ps1 (Install-SzhToolkitDepuisArchive, szh-common.ps1).
Info 'Toolkit initial'
$toolkitOk = $false
# Provenance du toolkit : 'release' (archive téléchargée et vérifiée) ou 'depot' (repli
# hors ligne). Elle décide d'où lancer update.ps1 et diagnostic.ps1 plus bas.
$origineToolkit = ''
try {
  $manifest = Get-SzhManifest
  # Ce nom de fichier est joint à $SzhStaging : on vérifie sa forme pour qu'un manifeste
  # corrompu ne fasse rien lire ni écrire ailleurs.
  if (-not (Test-SzhNomFichierManifest $manifest.toolkit.file)) {
    throw ('Nom de fichier de manifest invalide (toolkit) : ' + [string]$manifest.toolkit.file)
  }
  $zip = Join-Path $SzhStaging $manifest.toolkit.file
  Get-SzhFichier -Url $manifest.toolkit.url -Destination $zip -Silencieux
  if (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256) {
    # Remplacement atomique (Install-SzhToolkitDepuisArchive). Un échec (fichier encore
    # ouvert sur un poste en service) remonte au catch ci-dessous.
    $bilanOrphelins = Install-SzhToolkitDepuisArchive -Zip $zip -Toolkit $SzhToolkit -DossierTravail $SzhStaging
    foreach ($o in $bilanOrphelins.retires) {
      Write-SzhLog ('bootstrap : orphelin retiré du toolkit -> ' + $o)
    }
    if ($bilanOrphelins.retires.Count -gt 0) {
      Write-SzhLog ('bootstrap : ' + $bilanOrphelins.retires.Count + ' orphelin(s) retiré(s) du toolkit (absents de la version ' + $manifest.version + ')')
    }
    foreach ($a in $bilanOrphelins.avertissements) {
      Write-SzhLog ('bootstrap : nettoyage des orphelins, anomalie -> ' + $a)
    }

    $toolkitOk = $true
    $origineToolkit = 'release'
    Info ('Toolkit {0} téléchargé depuis la Release.' -f $manifest.version)
  }
} catch {
  Attention ('Release inaccessible ({0}).' -f $_.Exception.Message)
}
if (-not $toolkitOk) {
  # Repli hors ligne : le script tourne depuis un clone du dépôt, on copie sur place.
  $racineDepot = Split-Path $PSScriptRoot -Parent
  # Lancé depuis C:\ProgramData\SZH\toolkit\windows (réparation sans dépôt cloné),
  # $racineDepot est le toolkit lui-même : rien à copier.
  $memeArbre = ([System.IO.Path]::GetFullPath($racineDepot).TrimEnd('\') -ieq
                [System.IO.Path]::GetFullPath($SzhToolkit).TrimEnd('\'))
  if ($memeArbre) {
    Attention 'Repli hors ligne impossible : ce script tourne depuis le toolkit lui-même, rien à copier sur lui-même.'
  } elseif (Test-Path (Join-Path $racineDepot 'pipeline\Makefile')) {
    Attention 'Repli : copie du toolkit depuis le dépôt cloné (version locale).'
    # Même liste que $dossiersGeres de Remove-SzhToolkitOrphelins (szh-common.ps1).
    foreach ($d in 'pipeline', 'vscodium-user', 'revue-template', 'livre-template', 'windows', 'moissonneurs') {
      $src  = Join-Path $racineDepot $d
      $dest = Join-Path $SzhToolkit $d
      # On copie le contenu (*) dans un dossier créé d'abord : copier le dossier lui-même
      # l'imbriquerait (toolkit\windows\windows) quand il existe déjà.
      New-Item -ItemType Directory -Force -Path $dest | Out-Null
      Copy-Item (Join-Path $src '*') $dest -Recurse -Force
    }
    Set-Content -Path (Join-Path $SzhToolkit 'VERSION') -Value '0.0.0-local' -Encoding ASCII
    $toolkitOk = $true
    $origineToolkit = 'depot'
  }
}
if (-not $toolkitOk) { throw 'Impossible d''obtenir le toolkit (ni Release, ni dépôt local).' }

# ---- Dossier d'où lancer les scripts suivants ----
#
# $SzhToolkit\windows est inscriptible par tout utilisateur (icacls plus haut) : y lancer un
# script depuis ce processus élevé exécuterait en administrateur un code qu'un compte
# standard aurait pu déposer. On réextrait donc l'archive vérifiée dans un dossier neuf de
# %TEMP%, supprimé dans le finally plus bas. Au repli hors ligne, on lance la copie du dépôt
# cloné, d'où ce script a été lancé.
$script:SzhDossierScripts = ''
$script:SzhDossierScriptsTemp = ''
if ($origineToolkit -eq 'release') {
  $script:SzhDossierScriptsTemp = Join-Path $env:TEMP ('szh-bootstrap-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $script:SzhDossierScriptsTemp | Out-Null
  Expand-Archive -Path $zip -DestinationPath $script:SzhDossierScriptsTemp -Force
  $script:SzhDossierScripts = Join-Path $script:SzhDossierScriptsTemp 'windows'
} else {
  $script:SzhDossierScripts = Join-Path $racineDepot 'windows'
}

# ---- Windows PowerShell 5.1, pour les trois scripts lancés plus bas ----
# Explicitement 5.1 : sous PowerShell 7, $PSHOME n'a pas de powershell.exe.
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path $psExe)) { $psExe = Join-Path $PSHOME 'powershell.exe' }

# ---- Icône Pronto sur l'éditeur ----
#
# Après le toolkit : patch-icone.ps1 inscrit dans les raccourcis le chemin
# $SzhToolkit\windows\pronto.ico, qui doit exister. Lancé depuis $SzhDossierScripts, dans
# son propre processus : il sort en code 1 quand un point reste à regarder, et un `exit`
# dans un script dot-sourcé arrêterait bootstrap. Un échec n'arrête pas l'installation.
Info 'Icône Pronto sur l''éditeur'
try {
  Invoke-SzhNatif {
    & $psExe -NoProfile -ExecutionPolicy Bypass `
      -File (Join-Path $SzhDossierScripts 'patch-icone.ps1') | Out-Host
  }
} catch {
  Attention ('Icône non posée : ' + $_.Exception.Message)
}

# ---- Raccourcis du menu Démarrer ----
# Posés sans attendre la première mise à jour, qui s'arrête si la Release est injoignable.
# Ils vont dans le profil du compte qui installe ; chaque rédacteur reçoit les siens à
# l'ouverture de session, par la tâche planifiée. Un échec est affiché sans arrêter
# l'installation.
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

# Mise à jour : déclencheurs, réglages et action viennent de szh-taches.ps1, que les
# mises à jour relisent ensuite.
$bilanTache = Set-SzhTacheMaj
if ($bilanTache.etat -eq 'refusee') {
  Attention ('Tâche « ' + $SzhTacheMaj + ' » non écrite : ' + $bilanTache.message)
} else {
  Info ('Tâche « ' + $SzhTacheMaj + ' » : ' + $bilanTache.etat + ' (ouverture de session + mardi 14 h)')
}

# Préchauffage WSL à l'ouverture de session, autorisé sur batterie comme la tâche de mise
# à jour (New-SzhTacheMajReglages). Réécrite seulement si elle diffère : un
# Register-ScheduledTask -Force effacerait son historique.
$actionChauffe = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" `
  -Argument ('//B "{0}" "{1}" "-d" "{2}" "--exec" "/bin/true"' -f $vbs, "$env:WINDIR\System32\wsl.exe", $SzhDistro)
$reglagesChauffe = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$tacheChauffe = $null
try { $tacheChauffe = Get-ScheduledTask -TaskName 'SZH - Prechauffage WSL' -ErrorAction Stop } catch { $tacheChauffe = $null }
$chauffeConforme = $false
if ($tacheChauffe) {
  $r = $tacheChauffe.Settings
  $declencheurOk = (@($tacheChauffe.Triggers).Count -eq 1) -and
    ([string]$tacheChauffe.Triggers[0].CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger')
  $actionOk = (@($tacheChauffe.Actions).Count -eq 1) -and
    ([string]$tacheChauffe.Actions[0].Execute -eq $actionChauffe.Execute) -and
    ([string]$tacheChauffe.Actions[0].Arguments -eq $actionChauffe.Arguments)
  $chauffeConforme = ($declencheurOk -and $actionOk -and $r -and $r.StartWhenAvailable -and
    (-not $r.DisallowStartIfOnBatteries) -and (-not $r.StopIfGoingOnBatteries) -and
    ([string]$r.MultipleInstances -eq 'IgnoreNew') -and ([string]$r.ExecutionTimeLimit -eq 'PT2H'))
}
if ($chauffeConforme) {
  Info 'Tâche « SZH - Prechauffage WSL » : déjà conforme.'
} else {
  Register-ScheduledTask -TaskName 'SZH - Prechauffage WSL' -Action $actionChauffe `
    -Principal $principal -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Settings $reglagesChauffe -Force | Out-Null
  Info 'Tâche « SZH - Prechauffage WSL » : créée ou corrigée.'
}

# ---- Première mise à jour, en fenêtre visible ----
#
# Seulement sous le compte de la session : sinon l'environnement, les extensions et les
# réglages iraient dans le profil du compte de support.
#
# -Wait : « Terminé » ne s'affiche qu'une fois la mise à jour finie, pour qu'on ne ferme pas
# la session en plein import.
#
# update.ps1 et diagnostic.ps1 sont lancés depuis $SzhDossierScripts (voir plus haut).
try {
  if ($memeCompte) {
    Info 'Lancement de la première mise à jour (fenêtre visible)…'
    Start-Process -Wait -FilePath $psExe -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', (Join-Path $SzhDossierScripts 'update.ps1')
    )
  } else {
    Info 'Première mise à jour laissée à la session du rédacteur (tâche planifiée à l''ouverture).'
    Write-SzhLog ('bootstrap : première mise à jour non lancée ici, elle appartient à ' + $sessionUtilisateur)
  }

  Write-Host ''
  Info 'Terminé.'
  # Les disques des distributions sont rangés par SID : l'exclusion couvre les sous-dossiers.
  Attention ('Antivirus : exclure {0}\WSL\ (tous sous-dossiers, *.vhdx) et {1}\*, + processus vmcompute.exe, vmmem.exe, wsl.exe, wslservice.exe.' -f $SzhBase, $SzhStaging)
  Attention 'Chaque utilisateur du poste recevra réglages + raccourcis à sa prochaine connexion (tâche planifiée).'
  Attention ('Nouvelle revue : menu Démarrer > « ' + $SzhNomApplication + ' », onglet Revue (ou Zeitschrift) > « Nouvelle revue... ».')
  Attention ('Mise à jour à la demande : menu Démarrer > « ' + $SzhNomMiseAJour + ' ».')
  Attention ('Contrôle : powershell -ExecutionPolicy Bypass -File "{0}", dans la session du rédacteur.' -f (Join-Path $SzhToolkit 'windows\diagnostic.ps1'))

  # Le diagnostic, à l'écran, pour le compte qui installe. Dans son propre processus : il
  # sort en code 1 quand il manque quelque chose, et un `exit` dans un script dot-sourcé
  # arrêterait bootstrap.
  Write-Host ''
  try {
    Invoke-SzhNatif {
      & $psExe -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $SzhDossierScripts 'diagnostic.ps1') | Out-Host
    }
  } catch {
    Attention ('Diagnostic non exécuté : ' + $_.Exception.Message)
  }
} finally {
  if ($script:SzhDossierScriptsTemp -and (Test-Path $script:SzhDossierScriptsTemp)) {
    Remove-Item -LiteralPath $script:SzhDossierScriptsTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
try { Stop-Transcript | Out-Null } catch { }
