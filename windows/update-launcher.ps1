<#
.SYNOPSIS
  Vérification silencieuse des mises à jour, lancée par la tâche planifiée
  « SZH - Mise a jour » à l'ouverture de session et le mardi à 14 h, via hidden.vbs, donc
  sans fenêtre.

  Ordre : les raccourcis du menu Démarrer sont remis d'aplomb, puis la tâche planifiée
  elle-même, puis — une fois par semaine seulement — le contrôle de version. Tout à jour,
  une ligne de journal ; du neuf et le moment est bon, le toolkit est mis à niveau d'abord,
  pour exécuter l'update.ps1 le plus récent, puis celui-ci s'ouvre dans une fenêtre
  visible ; du neuf mais le moment est mauvais, renoncement journalisé et nouvel essai au
  prochain déclenchement. Un blocage qui dure finit par ouvrir la fenêtre visible, pour que
  l'échec se voie ailleurs que dans un journal.

  Rien ne s'affiche jamais depuis ce script : c'est le propre de la passe silencieuse.

  Compatibilité : Windows PowerShell 5.1.
#>
. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"

# Le menu Démarrer est remis d'aplomb à chaque ouverture de session, avant même de regarder
# s'il y a du neuf, et avant la cadence hebdomadaire ci-dessous. Deux raisons : un poste
# déjà à la dernière version n'exécute plus update.ps1 et n'obtiendrait jamais une entrée
# ajoutée après coup ; et les raccourcis vivent dans le profil de l'utilisateur, donc chacun
# doit recevoir les siens là où il ouvre sa session, pas là où l'administrateur a installé
# le poste. Idempotent — les mêmes quatre .lnk sont réécrits à l'identique — et jamais
# bloquant : ce script ne fait que vérifier. Le journal ne dit que l'anormal, pour ne pas
# grossir d'une ligne par jour.
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

# Même leçon pour la tâche planifiée : bootstrap.ps1 ne tourne qu'à l'installation, donc un
# poste installé avant que le rythme change garderait son déclencheur quotidien de 11 h pour
# toujours. On la remet en conformité si elle diffère, on ne la recrée pas si elle est déjà
# juste, et on n'échoue jamais pour autant.
#
# Le refus est le cas courant, pas l'exception : la tâche vit dans la racine du planificateur
# et appartient à l'administrateur qui a installé le poste, alors qu'une mise à jour ne
# demande jamais l'élévation. Le journal nomme donc le geste qui manque — mais la cadence
# hebdomadaire ne l'attend pas, elle est tenue plus bas par ce script.
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
# Le déclencheur d'ouverture de session revient chaque matin et, sur un poste installé avant
# ce changement, le déclencheur quotidien revient chaque jour. Sans ce garde, « une fois par
# semaine » serait un vœu. Fenêtre déjà consommée : on ne dit rien — c'est le cas normal, et
# une ligne par ouverture de session noierait le journal.
$maintenant = Get-Date
$suivi = Get-SzhSuiviMaj
$derniereVerif = Get-SzhSuiviChamp $suivi 'derniereVerif'
if (-not (Test-SzhFenetreMaj -Maintenant $maintenant -DerniereVerif $derniereVerif)) { exit 0 }

# Depuis quand ça coince, et combien de fois. Une seule horloge pour les deux causes,
# renoncement ou échec : ce qui compte est le temps passé sans aboutir.
$bloqueDepuis = Get-SzhSuiviChamp $suivi 'bloqueDepuis'
$alerteLe = Get-SzhSuiviChamp $suivi 'alerteLe'
$bloqueFois = 0
try { $bloqueFois = [int](Get-SzhSuiviChamp $suivi 'bloqueFois') } catch { $bloqueFois = 0 }
$presse = Test-SzhPolitesseExpiree -Maintenant $maintenant -Depuis $bloqueDepuis

# La fenêtre de la semaine est consommée, les compteurs de blocage remis à zéro.
function Save-SzhVerifFaite {
  Save-SzhSuiviMaj ([ordered]@{
    derniereVerif = (Get-Date -Format 's')
    bloqueDepuis  = ''
    bloqueFois    = 0
    bloqueRaison  = ''
    alerteLe      = ''
  }) | Out-Null
}

# La fenêtre reste ouverte : le prochain déclenchement réessaiera, et l'ouverture de session
# du lendemain est justement un bon moment.
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

# Passer la main à la fenêtre visible : c'est elle qui télécharge, qui installe et qui, en
# cas d'échec, montre à l'écran le geste à faire.
function Start-SzhFenetreVisible {
  Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $SzhToolkit 'windows\update.ps1')
  )
}

try {
  $manifest = Get-SzhManifest
  $etat = Get-SzhState
  $actuel = ''
  if ($etat -and $etat.version) { $actuel = $etat.version }

  if ($actuel -eq $manifest.version) {
    Write-SzhLog ('check : à jour ({0})' -f $actuel)
    Save-SzhVerifFaite
    exit 0
  }

  Write-SzhLog ('check : mise à jour {0} -> {1}' -f $actuel, $manifest.version)

  # Le moment ne compte que si l'environnement de fabrication change : un toolkit, des
  # extensions et des réglages s'installent sous l'éditeur ouvert, alors que remplacer la
  # distro exige de la désenregistrer, ce qui échoue tant qu'une compilation s'en sert.
  $rootfsActuel = ''
  if ($etat -and $etat.rootfs) { $rootfsActuel = $etat.rootfs }
  $remplace = ($rootfsActuel -ne $manifest.rootfs.version)

  $moment = Test-SzhMomentMaj -RemplaceEnvironnement:$remplace -Presse:$presse
  if (-not $moment.propice) {
    # Une compilation en vol est la seule gêne que le délai de politesse ne fait pas céder :
    # la couper détruit du travail, et elle finit de toute façon en quelques minutes. On le
    # dit, pour qu'un journal où cette ligne se répète cent fois se lise comme une anomalie
    # et non comme la routine.
    $suite = 'nouvel essai au prochain déclenchement'
    if ($moment.grave) { $suite = 'on ne coupe pas une compilation, nouvel essai au prochain déclenchement' }
    Write-SzhLog ('check : renoncement, {0} (fois {1}) -> {2}' -f $moment.raison, ($bloqueFois + 1), $suite)
    Save-SzhBlocage $moment.raison
    exit 0
  }
  if ($moment.raison) { Write-SzhLog ('check : ' + $moment.raison) }

  # Mettre le toolkit à niveau pour disposer du dernier update.ps1.
  New-Item -ItemType Directory -Force -Path $SzhStaging, $SzhToolkit | Out-Null
  $zip = Join-Path $SzhStaging $manifest.toolkit.file
  if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
    Get-SzhFichier -Url $manifest.toolkit.url -Destination $zip -Silencieux
    if (-not (Test-SzhSha256 -Fichier $zip -Attendu $manifest.toolkit.sha256)) {
      throw ('empreinte invalide pour {0}' -f $manifest.toolkit.file)
    }
  }
  Expand-Archive -Path $zip -DestinationPath $SzhToolkit -Force

  Start-SzhFenetreVisible
  Save-SzhVerifFaite
  exit 0
} catch {
  # Une ligne, un événement : les messages du planificateur et du réseau portent des sauts
  # de ligne qui couperaient la ligne de journal en deux.
  $message = (([string]$_.Exception.Message) -replace '\s+', ' ').Trim()
  Write-SzhLog ('check ERREUR : {0}' -f $message)
  Save-SzhBlocage $message
  # Un poste qui ne se met plus à jour depuis quatre semaines doit l'apprendre autrement
  # qu'en lisant un journal. La passe reste muette ; c'est la fenêtre visible qui parle, et
  # elle dira soit « terminé », soit l'erreur réelle avec le geste à faire. Une fois par
  # semaine au plus, sinon la passe muette deviendrait la plus bavarde de la chaîne.
  if ($presse -and (Test-SzhAlerteDue -Maintenant $maintenant -AlerteLe $alerteLe)) {
    Write-SzhLog ('check : bloqué depuis le {0} -> ouverture de la fenêtre visible pour que l''échec se voie' -f $bloqueDepuis)
    try {
      Start-SzhFenetreVisible
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
}
