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
  # L'écart entre les deux est la cause du 26 août 2026 : une installation élevée avec le
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
    # SumatraPDF porte `"requis": false` dans apps.lock : son absence se lit, mais ne doit
    # pas compter dans le verdict final (voir plus bas, seul le ton 'manque' y est retenu).
    # Sans cette ligne, un poste sans SumatraPDF — pourtant conforme — sortait en exit 1.
    if (-not $app.requis) { $etat = 'note' }
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

# Les extensions, telles que l'éditeur les liste pour ce compte.
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

# ---- Réglages protégés de la chaîne de publication ----
#
# La configuration de l'export OJS et les titres de bibliographie valent pour toute la
# rédaction. Un poste qui les a modifiés localement — c'est possible, après déverrouillage
# explicite dans « Réglages SZH » — publiera autrement que les autres jusqu'à la prochaine
# mise à jour, et personne ne le saura si on ne le dit pas ici.
Write-SzhTitre 'Réglages de la rédaction'

$protegesFichier = Join-Path $SzhBase 'settings-protected.json'
$protegesBlocs = @('ojs', 'biblio')
$reference = $null
try {
  if (Test-Path $protegesFichier) {
    $reference = (Get-Content $protegesFichier -Raw -Encoding UTF8 | ConvertFrom-Json)
  }
} catch { }
$configPoste = Get-SzhConfig

if (-not $reference) {
  Dire 'note' 'Réglages de la rédaction' ('pas encore déployés sur ce poste — ' + $protegesFichier)
} else {
  # Comparaison sur le JSON réordonné : l'ordre des clés d'un objet n'a pas de sens, et la
  # table des rubriques OJS en porte des dizaines. Une comparaison brute aurait fait
  # diverger un poste qui n'avait rien changé.
  function Get-SzhJsonCanonique($Valeur) {
    if ($null -eq $Valeur) { return 'null' }
    if ($Valeur -is [array]) {
      return '[' + (($Valeur | ForEach-Object { Get-SzhJsonCanonique $_ }) -join ',') + ']'
    }
    if ($Valeur -is [psobject] -and $Valeur.PSObject.Properties.Name.Count -gt 0 -and -not ($Valeur -is [string])) {
      $morceaux = foreach ($n in ($Valeur.PSObject.Properties.Name | Sort-Object)) {
        '"' + $n + '":' + (Get-SzhJsonCanonique $Valeur.$n)
      }
      return '{' + ($morceaux -join ',') + '}'
    }
    return (ConvertTo-Json $Valeur -Compress -Depth 20)
  }
  $ecarts = New-Object System.Collections.ArrayList
  $poses = New-Object System.Collections.ArrayList
  foreach ($bloc in $protegesBlocs) {
    if (-not $reference.PSObject.Properties[$bloc]) { continue }
    [void]$poses.Add($bloc)
    $ici = $null
    if ($configPoste -and $configPoste.PSObject.Properties[$bloc]) { $ici = $configPoste.$bloc }
    if ((Get-SzhJsonCanonique $ici) -ne (Get-SzhJsonCanonique $reference.$bloc)) {
      [void]$ecarts.Add($bloc)
    }
  }
  if ($poses.Count -eq 0) {
    Dire 'note' 'Réglages de la rédaction' 'déployés, mais sans rien imposer : le poste garde les valeurs livrées avec l''outil'
  } elseif ($ecarts.Count -eq 0) {
    Dire 'ok' 'Réglages de la rédaction' ('conformes (' + ($poses -join ', ') + ')')
  } else {
    Dire 'manque' 'Réglages de la rédaction' (($ecarts -join ', ') + ' : ce poste ne porte pas les valeurs de la rédaction. Il publiera autrement que les autres. Ouvrez « Réglages SZH », bouton « Télécharger les réglages protégés », et transmettez le fichier.')
  }
}

# ---- Langue de l'interface ----
#
# Deux moitiés d'écran, deux sources, et rien ne les oblige à s'accorder : les menus de
# l'éditeur suivent argv.json et le pack de langue installé, les textes du cockpit suivent
# leur propre cascade (voir l'en-tête de lib/i18n.js). Un poste s'est retrouvé avec les
# menus en allemand et les formulaires en français, et il a fallu deviner pourquoi. Cette
# section pose les six sources côte à côte, dans l'ordre où le cockpit les interroge, et
# nomme celle qui a tranché.
Write-SzhTitre 'Langue de l''interface'

# Lectures tolérantes : ces fichiers sont écrits par plusieurs mains, parfois avec un BOM,
# parfois avec des commentaires (argv.json et settings.json en portent). On ne les analyse
# donc pas en JSON, on y cherche la seule clé qui nous intéresse. Un diagnostic lit ; il ne
# doit jamais échouer sur la forme de ce qu'il lit.
function Get-SzhCleTexte([string]$Chemin, [string]$Cle) {
  try {
    if (-not (Test-Path $Chemin)) { return '' }
    $contenu = Get-Content $Chemin -Raw -Encoding UTF8
    $motif = '"' + [regex]::Escape($Cle) + '"\s*:\s*"([^"]*)"'
    $m = [regex]::Match($contenu, $motif)
    if ($m.Success) { return $m.Groups[1].Value.Trim().ToLower() }
  } catch { }
  return ''
}
function Get-SzhLangueSaine([string]$Valeur) {
  $v = ([string]$Valeur).Trim().ToLower()
  if ($v.Length -ge 2) { $v = $v.Substring(0, 2) }
  if ($v -eq 'fr' -or $v -eq 'de') { return $v }
  return ''
}

$argvJson     = Join-Path $env:APPDATA 'VSCodium\argv.json'
$settingsJson = Join-Path $env:APPDATA 'VSCodium\User\settings.json'
$srcEssai   = Get-SzhLangueSaine $env:SZH_LANGUE
$srcReglage = Get-SzhLangueSaine (Get-SzhCleTexte $settingsJson 'szh.langue')
$srcPoste   = Get-SzhLangueSaine (Get-SzhCleTexte $SzhConfigFile 'langue')
$srcLanceur = Get-SzhLangueSaine (Get-SzhCleTexte $SzhStateFile 'langue')
$localeArgv = Get-SzhLangueSaine (Get-SzhCleTexte $argvJson 'locale')
$srcWindows = ''
try { $srcWindows = Get-SzhLangueSaine (Get-UICulture).TwoLetterISOLanguageName } catch { }

# Le pack de langue décide si la locale demandée s'applique vraiment : sans lui, l'éditeur
# retombe en anglais sans le dire, et sa langue d'affichage n'est plus celle d'argv.json.
#
# ⚠ Un pack manquant n'est un DÉFAUT que si nous le livrons. Seul l'allemand est épinglé —
#   le pack français n'est plus à jour depuis 2021 et n'est volontairement pas livré. Une
#   locale « fr » qui laisse les menus en anglais est donc l'état VOULU d'un poste
#   francophone, et le dire en défaut ferait ressortir tout poste sain en « exit 1 ». Même
#   piège que SumatraPDF, non requis, dans la section des applications.
$packsLangue = @{ de = 'MS-CEINTL.vscode-language-pack-de'; fr = 'MS-CEINTL.vscode-language-pack-fr' }
$packAttendu = ''
if ($localeArgv -and $packsLangue.ContainsKey($localeArgv)) { $packAttendu = $packsLangue[$localeArgv] }
# Épinglé, c'est-à-dire livré par la version installée. Le manifest peut manquer (Release
# injoignable) : on ne conclut alors rien sur ce qui devrait être là.
$packEpingle = $false
if ($manifest -and $packAttendu) {
  foreach ($ext in @($manifest.vsix)) { if ([string]$ext.id -eq $packAttendu) { $packEpingle = $true } }
}
# $reelles vient de la section des extensions, plus haut : la table des extensions posées,
# obtenue en interrogeant la CLI de l'éditeur. On la relit plutôt que d'appeler la CLI une
# seconde fois, qui coûte une à deux secondes pour la même réponse. $null quand la CLI n'a
# pas répondu — le pack est alors dit inconnu, et non absent.
$packPose = $false
if ($reelles -and $packAttendu) { $packPose = $reelles.ContainsKey($packAttendu) }
# La langue RÉELLE des menus : celle du fichier seulement si son pack est là. C'est cette
# valeur, et non la locale demandée, qui entre dans la cascade et dans le verdict.
$langueMenus = ''
if ($localeArgv -and $packPose) { $langueMenus = $localeArgv }

# La cascade du cockpit, dans l'ordre exact de sourceLangue() (lib/i18n.js). Toute
# divergence entre les deux se paierait ici en diagnostic qui ment.
$langueCockpit = 'fr'
$sourceCockpit = 'repli'
foreach ($paire in @(
    @($srcEssai,    'variable d''essai SZH_LANGUE'),
    @($srcReglage,  'choix enregistré dans les réglages de l''éditeur'),
    @($srcPoste,    'choix enregistré pour ce poste'),
    @($srcLanceur,  'dernier lanceur ouvert'),
    @($langueMenus, 'langue d''affichage de l''éditeur'),
    @($srcWindows,  'langue d''affichage de Windows'))) {
  if ($paire[0]) { $langueCockpit = $paire[0]; $sourceCockpit = $paire[1]; break }
}

function Show-SzhSourceLangue([string]$Sujet, [string]$Valeur, [string]$Ou) {
  if ($Valeur) { Dire 'note' $Sujet ($Valeur + ' — ' + $Ou) }
  else { Dire 'note' $Sujet ('rien — ' + $Ou) }
}
Show-SzhSourceLangue '1. Variable d''essai' $srcEssai 'SZH_LANGUE dans l''environnement ; ne doit rien porter sur un poste de rédaction'
Show-SzhSourceLangue '2. Choix dans les réglages' $srcReglage $settingsJson
Show-SzhSourceLangue '3. Choix pour ce poste' $srcPoste $SzhConfigFile
Show-SzhSourceLangue '4. Dernier lanceur ouvert' $srcLanceur $SzhStateFile
if ($null -eq $reelles) {
  Dire 'note' '5. Affichage de l''éditeur' ($localeArgv + ' demandé — pack de langue non mesurable, la CLI de l''éditeur n''a pas répondu')
} elseif ($packEpingle -and (-not $packPose)) {
  Dire 'manque' '5. Affichage de l''éditeur' ($localeArgv + ' demandé, et son pack de langue est livré mais pas posé : les menus restent en anglais. Lancez la mise à jour depuis le menu Démarrer.')
} elseif ($localeArgv -and (-not $packPose)) {
  Dire 'note' '5. Affichage de l''éditeur' ($localeArgv + ' demandé ; aucun pack de cette langue n''est livré, les menus restent donc en anglais — c''est l''état voulu')
} else {
  Show-SzhSourceLangue '5. Affichage de l''éditeur' $langueMenus $argvJson
}
Show-SzhSourceLangue '6. Affichage de Windows' $srcWindows 'langue d''affichage du compte'
Dire 'note' 'Langue des formulaires' ($langueCockpit + ' — ' + $sourceCockpit)

# Le verdict : les deux moitiés de l'écran parlent-elles la même langue ? Des menus en
# anglais ne sont pas une discordance — c'est l'état ordinaire d'un poste sans pack de
# langue, et personne ne s'en plaint.
if ($null -eq $reelles) {
  Dire 'note' 'Interface cohérente' 'non mesurable : la langue des menus n''est pas connue sans la CLI de l''éditeur'
} elseif ($langueMenus -and ($langueMenus -ne $langueCockpit)) {
  Dire 'manque' 'Interface cohérente' ('les menus sont en ' + $langueMenus + ' et les formulaires en ' + $langueCockpit + ' : ouvrez « Réglages SZH » dans l''outil, choisissez la langue, puis redémarrez l''éditeur.')
} else {
  Dire 'ok' 'Interface cohérente' 'les menus et les formulaires parlent la même langue'
}

# Raccourcis du menu Démarrer, dans le profil de ce compte.
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$absents = New-Object System.Collections.ArrayList
# L'identité de barre des tâches se contrôle à part : un raccourci qui l'a perdue est
# bien là et s'ouvre, mais son bouton reprend l'icône de PowerShell — un symptôme qu'on
# ne rattache à rien sans ce diagnostic. C'est le cas de tout raccourci posé avant que
# ces identités existent, et une seule mise à jour le répare.
$sansId = New-Object System.Collections.ArrayList
# Le compte se déduit de la liste elle-même : elle a déjà changé de longueur une fois
# (l'arrivée de « Books SZH-CSPS »), et un chiffre écrit en dur dans ces deux textes
# redeviendrait faux à la prochaine entrée sans qu'aucun test ne le voie.
$raccourcisMenu = @(Get-SzhRaccourcisMenu)
foreach ($r in $raccourcisMenu) {
  $chemin = Join-Path $menu ($r.nom + '.lnk')
  if (-not (Test-Path $chemin)) { [void]$absents.Add($r.nom); continue }
  if ($r.appid -and ((Get-SzhLnkAppId $chemin) -ne $r.appid)) { [void]$sansId.Add($r.nom) }
}
if ($absents.Count -eq 0) { Dire 'ok' 'Raccourcis du menu Démarrer' ('{0} entrées en place' -f $raccourcisMenu.Count) }
else { Dire 'manque' 'Raccourcis du menu Démarrer' ('absents : ' + ($absents -join ', ')) }
if ($absents.Count -eq 0) {
  if ($sansId.Count -eq 0) { Dire 'ok' 'Icône dans la barre des tâches' ('les {0} entrées portent leur identité' -f $raccourcisMenu.Count) }
  else { Dire 'manque' 'Icône dans la barre des tâches' (($sansId -join ', ') + ' : sans identité, le bouton reprend l''icône de PowerShell — une mise à jour la repose') }
}

# ⚠ Ces deux chemins de registre sont dupliqués en littéral : update.ps1 en est
# propriétaire et les nomme (Set-SzhProgIdMarkdown, update.ps1:54-107, et
# Set-SzhProtocoleSzh, update.ps1:115-142). Aucune variable ni fonction de szh-common.ps1
# ne les expose aujourd'hui — une centralisation reste à faire, pour qu'un renommage du
# ProgId SZH.Markdown ou du schéma szh se répercute ici automatiquement. En l'état, un tel
# renommage fait annoncer « non enregistré » par ce diagnostic sur un poste pourtant sain.
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
