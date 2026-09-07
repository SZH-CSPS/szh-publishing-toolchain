<#
.SYNOPSIS
  Désinstalleur du poste SZH -- à lancer en administrateur, sauf -Simuler et -ProfilSeulement :

    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Simuler
    powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

  Ce qu'il retire : le toolkit et tout ce qu'update.ps1 pose sous C:\ProgramData\SZH
  (staging, logs, comptes, config.json, state.json, auteurs.json, mots-cles.json), les deux
  tâches planifiées, les cinq raccourcis du menu Démarrer, les réglages et extraits de code
  VSCodium du compte, les extensions VSCodium épinglées (vsix.lock) plus szh-cockpit et
  szh-apercu, et les clés de registre HKCU posées par update.ps1 (association .md, protocole
  szh:, confiance Office).

  Ce qu'il conserve TOUJOURS, quelle que soit l'option : la distribution WSL et son
  enregistrement (jamais désinscrite), C:\ProgramData\SZH\WSL\ et son contenu (les
  disques des rédacteurs), la racine C:\ProgramData\SZH elle-même, %USERPROFILE%\.wslconfig,
  %APPDATA%\VSCodium\argv.json, et les revues ou livres eux-mêmes (OneDrive ou ailleurs).
  VSCodium et SumatraPDF ne sont désinstallés qu'avec -Applications explicite : ce sont des
  logiciels partagés.

  À lancer depuis un clone frais du dépôt ou une extraction de toolkit-<v>.zip -- jamais
  depuis C:\ProgramData\SZH\toolkit sous élévation (voir README.md, « Réparer un poste ») :
  ce dossier est inscriptible par le groupe Utilisateurs, et un administrateur qui
  l'exécuterait tel quel exécuterait aussi bien un code qu'un compte standard y aurait
  déposé. -Simuler n'est pas concerné : il ne fait qu'afficher le plan.

  Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

.PARAMETER Simuler
  Affiche le plan sans rien toucher. N'exige pas l'administrateur.
.PARAMETER Json
  Avec -Simuler : le plan en JSON sur la sortie standard, rien d'autre -- pour les tests et
  l'inspection automatisée. Aucune suppression n'a lieu quand -Json est présent.
.PARAMETER ProfilSeulement
  Sans administrateur : ne retire que ce qui est au compte courant (raccourcis, fichiers
  profil, registre, extensions). Ni les fichiers du poste, ni les tâches planifiées.
.PARAMETER TousLesProfils
  Administrateur. En plus du compte courant : les fichiers profil (jamais le registre, qui
  n'est chargé que pour le compte courant) de chaque compte sous C:\Users ayant un dossier
  AppData.
.PARAMETER Applications
  Désinstalle aussi VSCodium et SumatraPDF (Program Files). Jamais par défaut : logiciels
  partagés avec d'autres usages du poste.
.PARAMETER SansConfirmation
  N'attend pas que « oui » soit tapé en clair avant d'agir.
#>
[CmdletBinding()]
param(
  [switch]$Simuler,
  [switch]$Json,
  [switch]$ProfilSeulement,
  [switch]$TousLesProfils,
  [switch]$Applications,
  [switch]$SansConfirmation
)

. "$PSScriptRoot\szh-common.ps1"
. "$PSScriptRoot\szh-taches.ps1"
. "$PSScriptRoot\szh-desinstallation.ps1"

function Sortir([int]$Code, [string]$Message) {
  if ($Message) { Write-Host $Message }
  exit $Code
}

# ---- Jamais depuis le toolkit sous élévation (README.md, « Réparer un poste ») ----
# -Simuler n'est pas concerné : il ne fait qu'afficher un plan, jamais un Remove-Item.
$sousToolkit = $false
try {
  $ici = (Get-Item -LiteralPath $PSScriptRoot).FullName.TrimEnd('\')
  $toolkitNorm = (Get-Item -LiteralPath $SzhToolkit -ErrorAction Stop).FullName.TrimEnd('\')
  $sousToolkit = ($ici -ieq $toolkitNorm) -or ($ici -ilike ($toolkitNorm + '\*'))
} catch { $sousToolkit = $false }
if ($sousToolkit -and (-not $Simuler)) {
  Sortir 2 ('Ce script tourne depuis C:\ProgramData\SZH\toolkit : jamais en administrateur depuis ce dossier. ' +
    'Relancer depuis un clone frais du dépôt, ou une extraction de toolkit-<version>.zip fraîchement téléchargée.')
}

# ---- Administrateur, sauf -Simuler et -ProfilSeulement ----
$identite = Get-SzhIdentite
if ((-not $Simuler) -and (-not $ProfilSeulement) -and (-not $identite.admin)) {
  Sortir 2 ('Ce mode demande les droits administrateur (fichiers du poste, tâches planifiées). ' +
    'Relancer "Désinstaller le poste SZH.cmd", ou cette console en administrateur -- ' +
    'ou ajouter -ProfilSeulement pour ne retirer que votre compte, sans administrateur.')
}

# ---- Une mise à jour ne doit jamais tourner en même temps ----
$mutex = New-SzhMutexPoste
$mutexLibre = $false
try { $mutexLibre = $mutex.WaitOne(0) } catch { $mutexLibre = $false }
if ($mutexLibre) { try { $mutex.ReleaseMutex() } catch { } }
if (-not $mutexLibre) {
  Sortir 2 'Une mise à jour est en cours sur ce poste : relancer une fois qu''elle est terminée.'
}

# ---- VSCodium ouvert : des fichiers de réglages ou d'extensions seraient verrouillés ----
if ((-not $Simuler) -and (Test-SzhEditeurOuvert)) {
  Sortir 2 ('VSCodium est ouvert : fermer l''éditeur avant de continuer, sinon ses réglages ' +
    'et ses extensions restent verrouillés pendant l''opération.')
}

# ---- Construction du plan ----
$machine = (-not $ProfilSeulement)
$profil = $true

$autresProfils = @()
if ($TousLesProfils) {
  try {
    foreach ($dir in @(Get-ChildItem -LiteralPath 'C:\Users' -Directory -ErrorAction SilentlyContinue)) {
      if ($dir.FullName -ieq $env:USERPROFILE) { continue }
      if (Test-Path -LiteralPath (Join-Path $dir.FullName 'AppData')) { $autresProfils += $dir.FullName }
    }
  } catch { }
}

$plan = @(Get-SzhPlanDesinstallation -Machine:$machine -Profil:$profil -Applications:$Applications -AutresProfils $autresProfils)

# ---- -Json : le plan, rien d'autre, jamais de suppression ----
if ($Json) {
  Write-Output ($plan | ConvertTo-Json -Depth 5)
  exit 0
}

Write-SzhBanniere 'Désinstallation du poste'
if ($TousLesProfils -and ($autresProfils.Count -gt 0)) {
  Write-Host ('Comptes supplémentaires pris en compte (fichiers profil seulement, jamais le registre) : ' +
    (($autresProfils | ForEach-Object { Split-Path $_ -Leaf }) -join ', '))
  Write-Host ''
} elseif ($TousLesProfils) {
  Write-Host 'Aucun autre compte avec un dossier AppData n''a été trouvé sous C:\Users.'
  Write-Host ''
}
Write-Host (Format-SzhPlanDesinstallation -Plan $plan)

if ($Simuler) {
  Write-Host 'Simulation seulement : rien n''a été touché.'
  exit 0
}

if (-not $SansConfirmation) {
  Write-Host ''
  Write-Host 'Cette opération retire ce qui est listé ci-dessus. Elle ne se répète pas.'
  $reponse = Read-Host 'Tapez "oui" (en toutes lettres) pour confirmer, ou toute autre touche pour annuler'
  if ($reponse -ne 'oui') {
    Sortir 2 'Désinstallation annulée : rien n''a été touché.'
  }
}

$journalPath = Join-Path $env:TEMP ('szh-desinstallation-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
try { Start-Transcript -Path $journalPath | Out-Null } catch { }

Write-Host ''
Write-SzhEtape 'Désinstallation en cours…'
$bilan = Invoke-SzhPlanDesinstallation -Plan $plan -Journal { param($m) Write-Host ('  ' + $m) }

Write-Host ''
Write-Host ('Terminé : {0} retiré(s), {1} déjà absent(s) ou conservé(s), {2} échec(s).' -f `
  $bilan.faits.Count, $bilan.ignores.Count, $bilan.echecs.Count)
if ($bilan.echecs.Count -gt 0) {
  Write-Host 'Le détail des échecs est dans le journal ci-dessous ; relancer ensuite reprend ce qui manque encore.'
}
Write-Host ('Journal complet : ' + $journalPath)

try { Stop-Transcript | Out-Null } catch { }

if ($bilan.echecs.Count -gt 0) { exit 1 }
exit 0
