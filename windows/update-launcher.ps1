<#
.SYNOPSIS
  Vérification silencieuse des mises à jour, lancée sans fenêtre (hidden.vbs) par la tâche
  planifiée « SZH - Mise a jour », à l'ouverture de session et le mardi à 14 h.

  Ordre :
    1. remettre en état les raccourcis du menu Démarrer ;
    2. remettre en état la tâche planifiée ;
    3. une fois par semaine, comparer la version installée à la dernière publiée.
  Si tout est à jour : une ligne de journal. S'il y a du neuf et que le moment s'y prête :
  mise à niveau du toolkit, pour disposer du dernier update.ps1, puis lancement de
  celui-ci. Si le moment ne s'y prête pas : renoncement journalisé, nouvel essai au
  prochain déclenchement. Un blocage qui dure finit par ouvrir la fenêtre visible de mise
  à jour.

  Ce script n'affiche rien lui-même : ses traces vont au journal.

  Compatibilité : Windows PowerShell 5.1.
#>
. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"

# Ce script met lui-même le toolkit à niveau, plus bas, avant de lancer update.ps1 :
# update.ps1 trouve alors un toolkit déjà à la bonne version et saute sa propre mise à
# niveau. Install-SzhToolkitDepuisArchive (szh-common.ps1), commune aux trois scripts,
# remplace le toolkit d'un coup et en retire les fichiers orphelins
# (Remove-SzhToolkitOrphelins) : ceux que la nouvelle archive ne contient plus.

# Les raccourcis du menu Démarrer sont remis en état à chaque passage, avant la cadence
# hebdomadaire : un poste à jour ne lance plus update.ps1, et les raccourcis sont propres à
# chaque compte. L'opération ne change rien si tout est en place ; le journal ne note que
# l'anormal.
try {
  $bilanMenu = Set-SzhRaccourcisMenu
  foreach ($retire in $bilanMenu.retires) {
    Write-SzhLog ('check : ancien raccourci du menu Démarrer retiré : ' + $retire)
  }
  foreach ($manque in $bilanMenu.manques) {
    Write-SzhLog ('check : raccourci du menu Démarrer non posé -> ' + $manque)
  }
} catch {
  Write-SzhLog ('check : raccourcis du menu Démarrer non posés : ' + $_.Exception.Message)
}

# La tâche planifiée est remise en conformité si elle diffère : bootstrap.ps1 ne tourne
# qu'à l'installation. Le refus est le cas courant (la tâche appartient à l'administrateur,
# la mise à jour tourne sans élévation) : le journal dit quoi faire, et la cadence
# hebdomadaire est tenue plus bas par ce script.
try {
  $bilanTache = Set-SzhTacheMaj
  if ($bilanTache.etat -ne 'conforme') {
    Write-SzhLog ('check : tâche planifiée {0} — écarts : {1}' -f $bilanTache.etat, ($bilanTache.ecarts -join ' ; '))
    if ($bilanTache.etat -eq 'refusee') {
      Write-SzhLog ('check : tâche planifiée non corrigée ({0}) — un administrateur doit relancer bootstrap.ps1 sur ce poste, ou la commande donnée dans docs/MAINTENANCE.md. En attendant, la cadence hebdomadaire est tenue par ce script, pas par le déclencheur.' -f $bilanTache.message)
    }
  }
} catch {
  Write-SzhLog ('check : tâche planifiée non vérifiée : ' + $_.Exception.Message)
}

# ---- Cadence : une fois par semaine, à partir du mardi 14 h ----
# Les déclencheurs reviennent plus souvent (chaque ouverture de session) : c'est ce test qui
# tient le rythme. Fenêtre déjà consommée : sortie sans rien journaliser, c'est le cas
# normal.
$maintenant = Get-Date
$suivi = Get-SzhSuiviMaj
$derniereVerif = Get-SzhSuiviChamp $suivi 'derniereVerif'
if (-not (Test-SzhFenetreMaj -Maintenant $maintenant -DerniereVerif $derniereVerif)) { exit 0 }

# Depuis quand la mise à jour n'aboutit pas, et combien de fois, toutes causes confondues
# (renoncement ou échec).
$bloqueDepuis = Get-SzhSuiviChamp $suivi 'bloqueDepuis'
$alerteLe = Get-SzhSuiviChamp $suivi 'alerteLe'
$bloqueFois = 0
try { $bloqueFois = [int](Get-SzhSuiviChamp $suivi 'bloqueFois') } catch { $bloqueFois = 0 }
$presse = Test-SzhPolitesseExpiree -Maintenant $maintenant -Depuis $bloqueDepuis

# Marque la vérification de la semaine comme faite et remet à zéro les compteurs de blocage.
function Save-SzhVerifFaite {
  Save-SzhSuiviMaj ([ordered]@{
    derniereVerif = (Get-Date -Format 's')
    bloqueDepuis  = ''
    bloqueFois    = 0
    bloqueRaison  = ''
    alerteLe      = ''
  }) | Out-Null
}

# Note un blocage sans consommer la fenêtre de la semaine : le prochain déclenchement
# réessaiera.
function Save-SzhBlocage([string]$Raison) {
  $depuis = $bloqueDepuis
  if (-not $depuis) { $depuis = (Get-Date -Format 's') }
  Save-SzhSuiviMaj ([ordered]@{
    derniereVerif = $derniereVerif
    bloqueDepuis  = $depuis
    bloqueFois    = ($bloqueFois + 1)
    bloqueRaison  = $Raison
    alerteLe      = $alerteLe
  }) | Out-Null
}

# Lance update.ps1, qui télécharge, installe et, en cas d'échec, dit quoi faire : à l'écran,
# ou dans le seul journal quand le réglage « mise à jour silencieuse »
# (Get-SzhMajSilencieuse) le fait tourner caché. Rend son code de sortie, qui décide si la
# vérification est marquée faite.
function Start-SzhFenetreMaj {
  # -Visible passe outre le réglage « mise à jour silencieuse ». Seule l'alerte d'un poste
  # bloqué depuis des semaines s'en sert : le réglage cache la fenêtre de routine, pas cette
  # alerte.
  param([switch]$Visible)

  # Le verrou est relâché avant de lancer update.ps1, qui prend le même : sinon il croirait
  # une autre mise à jour en cours et sortirait. Entre les deux, un autre déclenchement
  # pourrait s'intercaler ; ce risque est accepté.
  if ($script:SzhMutexTenu) {
    try { $SzhMutex.ReleaseMutex() } catch { }
    $script:SzhMutexTenu = $false
  }
  # Windows PowerShell 5.1 explicitement : sous PowerShell 7, $PSHOME n'a pas de
  # powershell.exe.
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path $ps)) { $ps = Join-Path $PSHOME 'powershell.exe' }
  $update = Join-Path $SzhToolkit 'windows\update.ps1'

  if ((Get-SzhMajSilencieuse) -and (-not $Visible)) {
    # Start-Process -WindowStyle Hidden peut laisser clignoter une fenêtre de console
    # (surtout avec Windows Terminal comme hôte). WScript.Shell.Run crée le processus déjà
    # caché, comme hidden.vbs. Le troisième argument à $true attend la fin d'update.ps1 et
    # rend son code de sortie.
    $ligne = ('"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" -Silencieux' -f $ps, $update)
    try {
      $sh = New-Object -ComObject WScript.Shell
      return [int]$sh.Run($ligne, 0, $true)
    } catch {
      Write-SzhLog ('update-launcher : WScript.Shell indisponible, repli sur une fenêtre visible (' + $_.Exception.Message + ')')
      # Repli sur la fenêtre visible ci-dessous.
    }
  }

  # -Wait -PassThru : attendre la fin pour connaître le code de sortie.
  $p = Start-Process -FilePath $ps -Wait -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', $update
  )
  return $p.ExitCode
}

# ---- Une seule mise à jour à la fois (mutex nommé, portée poste) ----
# Ce script remplace lui-même le toolkit plus bas : deux passes simultanées (deux comptes,
# ou session et tâche planifiée) écriraient sur le même arbre. Le verrou est celui
# d'update.ps1 (même nom), que Start-SzhFenetreMaj relâche avant de lui passer la main.
$script:SzhMutex = New-SzhMutexPoste
$script:SzhMutexTenu = $false
# AbandonedMutexException (processus mort en tenant le mutex) vaut prise du mutex : la
# traiter comme « déjà pris » le laisserait abandonné pour de bon.
try { $script:SzhMutexTenu = $SzhMutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $script:SzhMutexTenu = $true; Write-SzhLog 'check : mutex abandonné par une passe précédente, repris' }
catch { $script:SzhMutexTenu = $false }
if (-not $script:SzhMutexTenu) {
  Write-SzhLog 'check : une autre mise à jour est déjà en cours -> sortie'
  exit 0
}

try {
  $manifest = Get-SzhManifest
  # Ces champs du manifeste deviennent des noms de fichiers sous $SzhStaging : on vérifie
  # leur forme pour qu'un manifeste corrompu ne fasse rien lire ni écrire ailleurs.
  if (-not (Test-SzhVersionTag $manifest.version)) {
    throw ('Version de manifest invalide : ' + [string]$manifest.version)
  }
  if (-not (Test-SzhNomFichierManifest $manifest.toolkit.file)) {
    throw ('Nom de fichier de manifest invalide (toolkit) : ' + [string]$manifest.toolkit.file)
  }
  $etat = Get-SzhState
  $etatUtil = Get-SzhEtatUtilisateur
  # Le fichier VERSION du toolkit fait foi, state.json sert de repli : une passe interrompue
  # après l'extraction laisse state.json en retard.
  $actuel = Get-SzhVersionInstallee

  # Deux questions : le poste est-il à jour, et ce compte l'est-il ? Le toolkit est commun
  # au poste, mais la distribution WSL, les extensions et les réglages sont par compte.
  $rootfsActuel = Get-SzhEtatUtilisateurChamp $etatUtil 'rootfs'
  # Repli sur l'état commun du poste, comme dans update.ps1, à condition que la
  # distribution soit enregistrée pour ce compte. wsl.exe n'est interrogé qu'en dernier.
  if ((-not $rootfsActuel) -and $etat -and $etat.rootfs -and
      ((Get-SzhDistrosEnregistrees) -contains $SzhDistro)) {
    $rootfsActuel = [string]$etat.rootfs
  }
  $moiPose = (($rootfsActuel -eq $manifest.rootfs.version) -and (Test-SzhExtensionsAJour $manifest))

  if (($actuel -eq $manifest.version) -and $moiPose) {
    Write-SzhLog ('check : à jour ({0})' -f $actuel)
    Save-SzhVerifFaite
    exit 0
  }

  if ($actuel -eq $manifest.version) {
    Write-SzhLog ('check : poste à jour ({0}) mais ce compte n''a pas tout reçu -> fenêtre visible' -f $actuel)
  } else {
    Write-SzhLog ('check : mise à jour {0} -> {1}' -f $actuel, $manifest.version)
  }

  # Le moment ne compte que si l'environnement de fabrication change : le remplacer oblige à
  # désenregistrer la distribution, ce qui échoue pendant une compilation.
  $remplace = ($rootfsActuel -ne $manifest.rootfs.version)

  $moment = Test-SzhMomentMaj -RemplaceEnvironnement:$remplace -Presse:$presse
  if (-not $moment.propice) {
    # Une compilation en cours fait renoncer même après le délai de politesse. Le journal le
    # précise, pour qu'une répétition de cette ligne se remarque.
    $suite = 'nouvel essai au prochain déclenchement'
    if ($moment.grave) { $suite = 'on ne coupe pas une compilation, nouvel essai au prochain déclenchement' }
    Write-SzhLog ('check : renoncement, {0} (fois {1}) -> {2}' -f $moment.raison, ($bloqueFois + 1), $suite)
    Save-SzhBlocage $moment.raison
    exit 0
  }
  if ($moment.raison) { Write-SzhLog ('check : ' + $moment.raison) }

  # Mise à niveau du toolkit, pour disposer du dernier update.ps1. Sautée si le poste est
  # déjà à la bonne version et que seul ce compte est en retard.
  if ($actuel -ne $manifest.version) {
    New-Item -ItemType Directory -Force -Path $SzhStaging, $SzhToolkit | Out-Null
    $zip = Join-Path $SzhStaging $manifest.toolkit.file
    if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
      Get-SzhFichier -Url $manifest.toolkit.url -Destination $zip -Silencieux
      if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
        throw ('empreinte invalide pour {0}' -f $manifest.toolkit.file)
      }
    }
    # Remplacement atomique, orphelins retirés (Install-SzhToolkitDepuisArchive). Un échec
    # (fichier encore ouvert) remonte au catch ci-dessous.
    $bilanOrphelins = Install-SzhToolkitDepuisArchive -Zip $zip -Toolkit $SzhToolkit -DossierTravail $SzhStaging
    foreach ($o in $bilanOrphelins.retires) {
      Write-SzhLog ('check : orphelin retiré du toolkit -> ' + $o)
    }
    if ($bilanOrphelins.retires.Count -gt 0) {
      Write-SzhLog ('check : ' + $bilanOrphelins.retires.Count + ' orphelin(s) retiré(s) du toolkit (absents de la version ' + $manifest.version + ')')
    }
    foreach ($a in $bilanOrphelins.avertissements) {
      Write-SzhLog ('check : nettoyage des orphelins, anomalie -> ' + $a)
    }
  }

  $codeFenetre = Start-SzhFenetreMaj
  if ($codeFenetre -eq 0) {
    Save-SzhVerifFaite
  } else {
    # Un échec d'installation compte comme un blocage, pour le délai de politesse.
    Write-SzhLog ('check : la fenêtre de mise à jour a échoué (code ' + $codeFenetre + ')')
    Save-SzhBlocage ('la fenêtre de mise à jour a échoué (code ' + $codeFenetre + ')')
  }
  exit 0
} catch {
  # Message mis sur une ligne : les messages du réseau portent des sauts de ligne.
  $message = (([string]$_.Exception.Message) -replace '\s+', ' ').Trim()
  Write-SzhLog ('check ERREUR : {0}' -f $message)
  Save-SzhBlocage $message
  # Après le délai de politesse, la fenêtre de mise à jour s'ouvre, visible même en mode
  # silencieux, une fois par semaine au plus : elle dira « terminé » ou l'erreur réelle.
  if ($presse -and (Test-SzhAlerteDue -Maintenant $maintenant -AlerteLe $alerteLe)) {
    Write-SzhLog ('check : bloqué depuis le {0} -> ouverture de la fenêtre visible pour que l''échec se voie' -f $bloqueDepuis)
    try {
      [void](Start-SzhFenetreMaj -Visible)
      Save-SzhSuiviMaj ([ordered]@{
        derniereVerif = $derniereVerif
        bloqueDepuis  = $bloqueDepuis
        bloqueFois    = ($bloqueFois + 1)
        bloqueRaison  = $message
        alerteLe      = (Get-Date -Format 's')
      }) | Out-Null
    } catch { }
  }
  exit 1
} finally {
  # Relâche le verrou sur toutes les autres sorties. Le drapeau évite un second ReleaseMutex
  # quand Start-SzhFenetreMaj l'a déjà fait.
  if ($script:SzhMutexTenu) {
    try { $SzhMutex.ReleaseMutex() } catch { }
    $script:SzhMutexTenu = $false
  }
}
