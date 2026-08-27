<#
.SYNOPSIS
  État d'un poste, dit en une page. À lancer SANS administrateur, DANS LA SESSION de la
  personne dont on diagnostique le poste :

    powershell -ExecutionPolicy Bypass -File C:\ProgramData\SZH\toolkit\windows\diagnostic.ps1

  Ne modifie rien : il lit, il compare, il nomme ce qui manque et le geste qui répare.

  Pourquoi ce script existe. L'essentiel de l'outil est posé PAR UTILISATEUR — distribution
  WSL, extensions de l'éditeur, réglages, raccourcis, associations de fichiers — alors que
  le toolkit est commun au poste. Un poste peut donc être « à jour » et parfaitement
  inutilisable pour la personne qui s'en sert, sans qu'aucune ligne n'échoue. C'est arrivé
  le 26 août 2026, et il a fallu lire quatre journaux pour le voir. Une commande suffit
  maintenant.

  Code de sortie : 0 si tout est en place pour ce compte, 1 sinon.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).
#>
[CmdletBinding()]
param()

. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"

$script:Bilan = New-Object System.Collections.ArrayList

# Trois états seulement, parce qu'un diagnostic qui nuance ne décide de rien : « ok »,
# « manque » (ce qui doit être réparé) et « note » (ce qui se lit sans rien exiger).
function Dire([string]$Etat, [string]$Sujet, [string]$Detail) {
  [void]$Bilan.Add([ordered]@{ etat = $Etat; sujet = $Sujet; detail = $Detail })
  $couleur = 'Gray'
  $marque = '  ·'
  if ($Etat -eq 'ok') { $couleur = 'Green'; $marque = '  +' }
  if ($Etat -eq 'manque') { $couleur = 'Yellow'; $marque = '  !' }
  Write-Host ('{0} {1,-34} {2}' -f $marque, $Sujet, $Detail) -ForegroundColor $couleur
}

Write-SzhBanniere 'Diagnostic du poste'

# ---- Qui, et pour qui ----
Write-SzhTitre 'Comptes'
$moi = Get-SzhIdentite
$session = Get-SzhSessionUtilisateur
Dire 'note' 'Compte qui exécute' ('{0} (admin : {1})' -f $moi.nom, $moi.admin)
Dire 'note' 'SID' $moi.sid
if ($session) {
  # L'écart entre les deux est LA cause du 26 août 2026 : une installation élevée avec le
  # compte du support pose tout dans le profil du support, et la rédactrice n'a rien.
  if ($session -eq $moi.nom) {
    Dire 'ok' 'Session ouverte pour' $session
  } else {
    Dire 'manque' 'Session ouverte pour' ($session + ' — ce diagnostic ne décrit PAS ce compte-là. Relancez-le dans SA session, sans élévation.')
  }
} else {
  Dire 'note' 'Session ouverte pour' 'indéterminé'
}

# ---- Ce qui est commun au poste ----
Write-SzhTitre 'Poste'
$versionInstallee = Get-SzhVersionInstallee
if ($versionInstallee) { Dire 'ok' 'Toolkit installé' $versionInstallee }
else { Dire 'manque' 'Toolkit installé' ('absent de ' + $SzhToolkit) }

$manifest = $null
try { $manifest = Get-SzhManifest } catch { $manifest = $null }
if ($manifest) {
  if ([string]$manifest.version -eq $versionInstallee) {
    Dire 'ok' 'Dernière version publiée' ([string]$manifest.version)
  } else {
    Dire 'manque' 'Dernière version publiée' ('{0} — le poste est en {1}' -f $manifest.version, $versionInstallee)
  }
} else {
  Dire 'note' 'Dernière version publiée' 'Release injoignable (hors ligne, proxy, ou quota GitHub)'
}

$libre = Get-SzhEspaceLibreGo
if ($libre -lt 0) { Dire 'note' 'Place libre' 'non mesurable' }
elseif ($libre -lt 5) { Dire 'manque' 'Place libre' ('{0} Go — il en faut 5 pour installer l''environnement' -f $libre) }
else { Dire 'ok' 'Place libre' ('{0} Go' -f $libre) }

# Les deux applications, comparées aux versions figées dans apps.lock : c'est ce qui rend un
# écart de flotte visible sans ouvrir dix postes. Une montée de version est un geste
# volontaire (windows/APPS.md), donc un écart n'est pas une faute — mais il doit se lire.
$verrouApps = Join-Path $PSScriptRoot 'apps.lock'
$apps = @()
try { $apps = @((Get-Content $verrouApps -Raw -Encoding UTF8 | ConvertFrom-Json).applications) } catch { $apps = @() }
if ($apps.Count -eq 0) { Dire 'note' 'Versions épinglées' ('apps.lock illisible : ' + $verrouApps) }
foreach ($app in $apps) {
  $chemin = ''
  foreach ($s in @($app.sondes)) {
    $p = [Environment]::ExpandEnvironmentVariables([string]$s)
    if ((-not $chemin) -and (Test-Path $p)) { $chemin = $p }
  }
  $sujet = $app.nom
  if (-not $chemin) {
    $etat = 'manque'
    if (-not $app.requis) { $etat = 'manque' }
    Dire $etat $sujet ('absent — version épinglée {0}, à poser par un administrateur (bootstrap.ps1)' -f $app.version)
    continue
  }
  $v = ''
  try { $v = ([string](Get-Item $chemin).VersionInfo.ProductVersion).Trim() } catch { $v = '' }
  $ou = ''
  if ($chemin -like ($env:LOCALAPPDATA + '*')) { $ou = ' (installé pour ce compte seulement)' }
  if ($v -eq [string]$app.version) {
    Dire 'ok' $sujet ('{0}{1}' -f $v, $ou)
  } else {
    Dire 'note' $sujet ('{0} — version épinglée {1}{2}' -f $v, $app.version, $ou)
  }
}

# wscript.exe porte les deux lanceurs, les tâches planifiées et l'association des .md : une
# stratégie qui l'interdit rend tout cela muet, sans message.
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
if (Test-Path $wscript) { Dire 'ok' 'Hôte de scripts (wscript)' 'présent' }
else { Dire 'manque' 'Hôte de scripts (wscript)' 'absent — raccourcis et tâches planifiées inopérants' }

# ---- Ce qui appartient à ce compte ----
Write-SzhTitre ('Ce compte : ' + $moi.nom)
$etatUtil = Get-SzhEtatUtilisateur
$dossierDistro = Get-SzhDossierDistro
$distroPresente = ((Get-SzhDistrosEnregistrees) -contains $SzhDistro)
if ($distroPresente) {
  $rootfsPose = Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'
  # Poste d'avant l'état par utilisateur : la version ne se lisait que dans l'état commun.
  if (-not $rootfsPose) {
    $etatPoste = Get-SzhState
    if ($etatPoste -and $etatPoste.rootfs) { $rootfsPose = [string]$etatPoste.rootfs }
  }
  if (-not $rootfsPose) { $rootfsPose = 'version inconnue' }
  if (Test-SzhDistroRepond) {
    Dire 'ok' 'Environnement de fabrication' ('{0}, il répond' -f $rootfsPose)
  } else {
    Dire 'manque' 'Environnement de fabrication' ('enregistré ({0}) mais il ne démarre pas — virtualisation désactivée dans le firmware ?' -f $rootfsPose)
  }
} else {
  $reste = ''
  if (Test-Path $dossierDistro) { $reste = ' — un reste occupe déjà ' + $dossierDistro }
  Dire 'manque' 'Environnement de fabrication' ('aucune distribution enregistrée pour ce compte' + $reste + '. Lancez la mise à jour depuis le menu Démarrer.')
}
Dire 'note' 'Disque de la distribution' $dossierDistro

# Les extensions, telles que l'éditeur les liste POUR CE COMPTE.
$reelles = Get-SzhExtensionsInstallees
if ($null -eq $reelles) {
  Dire 'note' 'Extensions de l''éditeur' 'CLI de l''éditeur sans réponse — mesure impossible'
} elseif ($manifest) {
  $manquantes = New-Object System.Collections.ArrayList
  foreach ($ext in @($manifest.vsix)) {
    $id = [string]$ext.id
    if (-not $reelles.ContainsKey($id)) { [void]$manquantes.Add($id + ' (absente)') }
    elseif ($reelles[$id] -ne [string]$ext.version) {
      [void]$manquantes.Add(('{0} ({1} au lieu de {2})' -f $id, $reelles[$id], $ext.version))
    }
  }
  if ($manquantes.Count -eq 0) {
    Dire 'ok' 'Extensions de l''éditeur' ('{0} posées, toutes à jour' -f $reelles.Count)
  } else {
    Dire 'manque' 'Extensions de l''éditeur' (($manquantes -join ' ; ') + '. Lancez la mise à jour depuis le menu Démarrer.')
  }
} else {
  Dire 'note' 'Extensions de l''éditeur' ('{0} posées (rien à comparer, Release injoignable)' -f $reelles.Count)
}

# Réglages de l'éditeur : ils vivent dans le profil, donc chaque compte a les siens.
$dstReglages = Join-Path $env:APPDATA 'VSCodium\User'
$manquants = New-Object System.Collections.ArrayList
foreach ($f in 'settings.json', 'keybindings.json', 'tasks.json') {
  if (-not (Test-Path (Join-Path $dstReglages $f))) { [void]$manquants.Add($f) }
}
if ($manquants.Count -eq 0) { Dire 'ok' 'Réglages de l''éditeur' $dstReglages }
else { Dire 'manque' 'Réglages de l''éditeur' ('manquent : ' + ($manquants -join ', ')) }

# Raccourcis du menu Démarrer, dans le profil de ce compte.
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$absents = New-Object System.Collections.ArrayList
foreach ($r in @(Get-SzhRaccourcisMenu)) {
  if (-not (Test-Path (Join-Path $menu ($r.nom + '.lnk')))) { [void]$absents.Add($r.nom) }
}
if ($absents.Count -eq 0) { Dire 'ok' 'Raccourcis du menu Démarrer' '4 entrées en place' }
else { Dire 'manque' 'Raccourcis du menu Démarrer' ('absents : ' + ($absents -join ', ')) }

if (Test-Path 'HKCU:\Software\Classes\SZH.Markdown\shell\open\command') {
  Dire 'ok' 'Ouvrir un .md avec Revue SZH' 'enregistré (HKCU)'
} else {
  Dire 'manque' 'Ouvrir un .md avec Revue SZH' 'non enregistré pour ce compte'
}
if (Test-Path 'HKCU:\Software\Classes\szh\shell\open\command') {
  Dire 'ok' 'Liens szh:// (traduction)' 'enregistré (HKCU)'
} else {
  Dire 'manque' 'Liens szh:// (traduction)' 'non enregistré pour ce compte'
}
if (Test-Path (Join-Path $env:USERPROFILE '.wslconfig')) {
  Dire 'ok' 'Plafond mémoire de WSL' (Join-Path $env:USERPROFILE '.wslconfig')
} else {
  Dire 'manque' 'Plafond mémoire de WSL' '.wslconfig absent du profil'
}

# ---- Rythme des mises à jour ----
Write-SzhTitre 'Mises à jour'
$tache = $null
try {
  foreach ($t in @(Get-ScheduledTask -TaskPath '\' -ErrorAction Stop)) {
    if ([string]$t.TaskName -eq $SzhTacheMaj) { $tache = $t }
  }
} catch { $tache = $null }
if ($tache) {
  $ecarts = @(Get-SzhTacheMajEcarts -Tache $tache)
  if ($ecarts.Count -eq 0) { Dire 'ok' 'Tâche planifiée' 'conforme (ouverture de session + mardi 14 h)' }
  else { Dire 'manque' 'Tâche planifiée' ($ecarts -join ' ; ') }
} else {
  Dire 'manque' 'Tâche planifiée' ($SzhTacheMaj + ' absente — un administrateur doit relancer bootstrap.ps1')
}
$suivi = Get-SzhSuiviMaj
$derniere = Get-SzhSuiviChamp $suivi 'derniereVerif'
$bloque = Get-SzhSuiviChamp $suivi 'bloqueDepuis'
if ($derniere) { Dire 'note' 'Dernière vérification' $derniere }
else { Dire 'note' 'Dernière vérification' 'jamais (fichier de suivi absent)' }
if ($bloque) {
  Dire 'manque' 'Bloqué depuis' ('{0} — {1}' -f $bloque, (Get-SzhSuiviChamp $suivi 'bloqueRaison'))
}

# ---- Verdict ----
$aReparer = @($Bilan | Where-Object { $_.etat -eq 'manque' })
Write-Host ''
if ($aReparer.Count -eq 0) {
  Write-Host '  Tout est en place pour ce compte.' -ForegroundColor Green
  Write-Host ''
  exit 0
}
Write-Host ('  {0} point(s) à reprendre pour ce compte :' -f $aReparer.Count) -ForegroundColor Yellow
foreach ($p in $aReparer) { Write-Host ('   - {0} : {1}' -f $p.sujet, $p.detail) }
Write-Host ''
Write-Host ('  La plupart se réparent en lançant « Mise à jour de l''outil Revue » depuis le menu' ) -ForegroundColor Gray
Write-Host ('  Démarrer de CE compte. Journal : ' + $SzhLogs) -ForegroundColor Gray
Write-Host ('  Contact : ' + $SzhSupport) -ForegroundColor Gray
Write-Host ''
exit 1
