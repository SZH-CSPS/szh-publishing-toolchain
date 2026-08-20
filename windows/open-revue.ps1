<#
.SYNOPSIS
  Lanceur « Revues SZH » (raccourci du menu Démarrer, via hidden.vbs -> pas de console).
  Liste les revues trouvées sous les emplacements connus et ouvre la sélection dans
  VSCodium (D14). Depuis D116, DEUX listes : « En cours » et « Archivées » (les revues
  verrouillées portent un cadenas). Affiche la version du logiciel installée et permet
  d'en changer (D120) ; signale le mode test (D119).

    powershell -ExecutionPolicy Bypass -File open-revue.ps1
    powershell -ExecutionPolicy Bypass -File open-revue.ps1 -Versions   # sélecteur de version seul

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Lien « szh://… » (D123), passé par le gestionnaire de protocole Windows en PREMIER
  # argument POSITIONNEL : ouvre le numéro visé et amène l'utilisateur au bon endroit,
  # sans passer par la liste. Positionnel parce que hidden.vbs requote chacun de ses
  # arguments, et qu'un « %1 » requoté se lie à un paramètre positionnel (mesuré).
  [Parameter(Position = 0)][string]$Lien,
  # Quel produit lister : « tout » (défaut, comportement historique), « revue » ou
  # « zeitschrift » (D124). C'est ce qui distingue les deux raccourcis du menu
  # Démarrer — « Revues SZH » et « Zeitschriften SZH ».
  [string]$Produit = 'tout',
  # Ouvre directement le sélecteur de version du logiciel — c'est ce que lance
  # l'avertissement de divergence du cockpit (« Changer de version… », D120) : une
  # seule implémentation du choix de version, atteignable des deux côtés.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

# ⚠ FILET DE DERNIER RECOURS (voir le `trap` juste après). Ce script tourne sous
# hidden.vbs : sans console, une exception terminante ($ErrorActionPreference = 'Stop')
# ne donnait pas un message d'erreur, elle donnait un lanceur qui ne s'ouvre pas — rien
# à l'écran, rien dans un journal.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Le filet, posé ici parce qu'il a besoin de System.Windows.Forms pour parler. `trap`
# plutôt qu'un try/catch enveloppant tout le script : il attrape les erreurs
# terminantes de la portée entière sans réindenter une ligne, donc sans risquer d'en
# casser une. Le titre est écrit en dur — à ce stade, $titreFenetre n'existe pas encore
# et l'i18n pourrait justement être la chose qui a échoué.
trap {
  $souci = $_.Exception.Message
  try { Write-SzhLog ('open-revue ERREUR : ' + $souci) } catch { }
  try {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.erreur' @($souci, $SzhSupport)), 'Revues SZH')
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show($souci, 'Revues SZH')
  }
  exit 1
}

# Normalisation MANUELLE plutôt que [ValidateSet] (D124) : une valeur inattendue ne
# doit pas lever d'exception terminante ($ErrorActionPreference = 'Stop' dans le
# socle) — sans console, le lanceur mourrait sans le moindre message.
$produitFiltre = ([string]$Produit).ToLower()
if (@('revue', 'zeitschrift') -notcontains $produitFiltre) { $produitFiltre = 'tout' }
$titreFenetre = (T 'lanceur.titre')
if ($produitFiltre -eq 'zeitschrift') { $titreFenetre = (T 'lanceur.titre.zs') }

# ---- Sélecteur de version du logiciel (D120) -------------------------------------
#
# Recompiler un ancien numéro « à l'identique » suppose de pouvoir réinstaller la
# version qui l'a fabriqué. Le mécanisme existe déjà (update.ps1 -Version X, qui
# reprend l'archive de staging quand elle est là, D10) : ce dialogue ne fait que le
# rendre atteignable. Volontairement EXPLICITE et non silencieux — un changement de
# version remplace le rootfs WSL et les extensions, et demande un redémarrage de
# l'éditeur : le faire en tâche de fond passerait pour une panne.
function Show-SzhVersions($Parent) {
  $installee = Get-SzhVersionInstallee
  # ⚠ AUCUN appel réseau ici : la liste est remplie au Shown (voir plus bas). Le faire
  # avant d'afficher gelait la fenêtre du lanceur jusqu'au bout du timeout — et, sur le
  # chemin « -Versions », ne montrait rien du tout pendant ce temps (constat 3).
  $locales = @(Get-SzhVersionsLocales)
  $disponibles = New-Object System.Collections.ArrayList

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.versions.titre')
  if ($Parent) { $boite.StartPosition = 'CenterParent' } else { $boite.StartPosition = 'CenterScreen' }
  $boite.ClientSize = New-Object System.Drawing.Size(460, 340)
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false

  $intro = New-Object System.Windows.Forms.Label
  $etiqInstallee = $installee
  if (-not $etiqInstallee) { $etiqInstallee = '?' }
  $intro.Text = (T 'lanceur.versions.intro' @($etiqInstallee))
  $intro.Location = New-Object System.Drawing.Point(16, 14)
  $intro.Size = New-Object System.Drawing.Size(428, 34)
  $boite.Controls.Add($intro)

  $liVersions = New-Object System.Windows.Forms.ListBox
  $liVersions.Location = New-Object System.Drawing.Point(16, 54)
  $liVersions.Size = New-Object System.Drawing.Size(428, 180)
  $liVersions.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $boite.Controls.Add($liVersions)

  $note = New-Object System.Windows.Forms.Label
  $note.Text = (T 'lanceur.versions.chargement')
  $note.Location = New-Object System.Drawing.Point(16, 240)
  $note.Size = New-Object System.Drawing.Size(428, 44)
  $note.ForeColor = [System.Drawing.Color]::DimGray
  $boite.Controls.Add($note)

  $bInstaller = New-Object System.Windows.Forms.Button
  $bInstaller.Text = (T 'lanceur.versions.installer')
  $bInstaller.Location = New-Object System.Drawing.Point(248, 292)
  $bInstaller.Size = New-Object System.Drawing.Size(96, 32)
  $bInstaller.Enabled = $false                     # activé quand la liste est peuplée
  $boite.Controls.Add($bInstaller)

  $bFermer = New-Object System.Windows.Forms.Button
  $bFermer.Text = (T 'lanceur.annuler')
  $bFermer.Location = New-Object System.Drawing.Point(350, 292)
  $bFermer.Size = New-Object System.Drawing.Size(94, 32)
  $bFermer.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $boite.Controls.Add($bFermer)
  $boite.CancelButton = $bFermer

  # La liste se remplit APRÈS l'affichage : la fenêtre est là tout de suite, avec
  # « Recherche des versions publiées… », et l'attente réseau (8 s au pire) se voit au
  # lieu de figer l'interface.
  $boite.Add_Shown({
    $boite.Refresh()
    $publiees = @(Get-SzhVersionsPubliees)
    foreach ($v in $publiees) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
    foreach ($v in $locales) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
    if ($installee -and (-not $disponibles.Contains($installee))) { [void]$disponibles.Insert(0, $installee) }
    foreach ($v in $disponibles) {
      if ($v -eq $installee) { [void]$liVersions.Items.Add((T 'lanceur.versions.installee' @($v))) }
      elseif ($locales -contains $v) { [void]$liVersions.Items.Add((T 'lanceur.versions.locale' @($v))) }
      else { [void]$liVersions.Items.Add($v) }
    }
    if ($liVersions.Items.Count -gt 0) { $liVersions.SelectedIndex = 0 }
    # Trois états à distinguer, et à NOMMER : liste complète, hors ligne avec un repli
    # réel, hors ligne sans repli (seule la version installée est là — donc rien à
    # installer). Promettre un repli inexistant était le constat 4 de la revue.
    if ($publiees.Count -gt 0) { $note.Text = '' }
    elseif ($locales.Count -gt 0) { $note.Text = (T 'lanceur.versions.horsligne') }
    else { $note.Text = (T 'lanceur.versions.horsligne.deja') }
    if ($disponibles.Count -eq 0) { $note.Text = (T 'lanceur.versions.vide') }
    $bInstaller.Enabled = ($disponibles.Count -gt 0)
  })

  $bInstaller.Add_Click({
    if ($liVersions.SelectedIndex -lt 0) { return }
    $choix = [string]$disponibles[$liVersions.SelectedIndex]
    # Garde-fou de quoting : la valeur peut venir d'un nom de fichier de staging, et
    # elle part en ARGUMENT de update.ps1 — « 2026.08.0 -Verbose » y injecterait un
    # paramètre, et ce n'est pas la version demandée qui s'installerait (constat 8).
    if (-not (Test-SzhVersionTag $choix)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.versions.vide'), (T 'lanceur.versions.titre'))
      return
    }
    $reponse = [System.Windows.Forms.MessageBox]::Show(
      (T 'lanceur.versions.avert' @($choix)), (T 'lanceur.versions.titre'),
      [System.Windows.Forms.MessageBoxButtons]::OKCancel,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($reponse -ne [System.Windows.Forms.DialogResult]::OK) { return }
    # update.ps1 sait déjà tout faire (et ne demande jamais l'administrateur, D3) :
    # fenêtre visible, étapes nommées, manifest et archive repris de staging quand ils
    # y sont. Chaque argument est cité — le chemin du toolkit contient des espaces.
    Write-SzhLog ('open-revue : installation de la version ' + $choix + ' demandee')
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      ('"{0}"' -f (Join-Path $PSScriptRoot 'update.ps1')), '-Version', ('"{0}"' -f $choix))
    $boite.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $boite.Close()
  })

  # Sans parent (chemin « -Versions », process détaché fraîchement lancé), rien ne
  # garantit le premier plan : une boîte qui s'ouvre DERRIÈRE VSCodium se lit comme
  # « le bouton ne fait rien » (constat 10).
  $resultat = [System.Windows.Forms.DialogResult]::Cancel
  if ($Parent) { $resultat = $boite.ShowDialog($Parent) }
  else {
    $boite.TopMost = $true
    $resultat = $boite.ShowDialog()
  }
  # $true = une installation a été lancée : l'appelant doit se retirer.
  return ($resultat -eq [System.Windows.Forms.DialogResult]::OK)
}

# Chemin « -Versions » : AVANT le test VSCodium, exprès. C'est l'outil de réparation
# quand l'installation est abîmée — le mettre derrière la chose à réparer le rendrait
# inatteignable, et le bouton « Changer de version… » du cockpit répondrait
# « VSCodium introuvable » alors que l'éditeur tourne (constat 6 de la revue).
# Journalisé à l'entrée : lancé détaché par l'extension (stdio ignoré), c'est la SEULE
# trace qui dise que le chemin a bien été pris (constat 2).
if ($Versions) {
  Write-SzhLog 'open-revue : selecteur de versions demande'
  Show-SzhVersions $null
  exit 0
}

$codium = Get-VSCodiumExe
if (-not $codium) {
  [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.codium' @($SzhSupport)), $titreFenetre)
  exit 1
}

# ---- Lien « szh:// » reçu (D123) : on ouvre, on ne liste pas ----------------------
#
# Le lien ne désigne qu'un produit, un nom de dossier et un slug : le dossier est
# cherché dans les emplacements du poste (Find-SzhRevue), jamais construit sur
# l'entrée brute. Trois issues, toutes bavardes — un lien qui ne marche pas doit dire
# pourquoi, sinon l'utilisateur croit que son poste est cassé.
if ($Lien) {
  $cible = Get-SzhLien $Lien
  if (-not $cible) {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lien.invalide' @($Lien)), $titreFenetre)
    exit 1
  }
  $dossierLien = Find-SzhRevue $cible.produit $cible.numero
  if (-not $dossierLien) {
    [void][System.Windows.Forms.MessageBox]::Show(
      (T 'lien.introuvable' @($cible.numero, $cible.produit)), $titreFenetre)
    exit 1
  }
  # L'intention dit au cockpit où atterrir ; à usage unique, périmée au bout de
  # 5 minutes (lib/liens.js). Jamais bloquante : si elle ne peut pas s'écrire, la revue
  # s'ouvre quand même, simplement sans aller droit au panneau.
  try { Set-SzhIntention $dossierLien $cible.vue $cible.article } catch { }
  Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f $dossierLien)
  exit 0
}

# ---- Racines à scanner ---------------------------------------------------------
#
# UNE SEULE source de vérité pour ce que le lanceur LISTE : les quatre emplacements
# « en cours »/archives (D116, mode test compris D119). Les racines historiques
# (config.json `revuesRoots`, OneDrive\Revues) ne sont plus balayées pour la liste —
# elles ne servent qu'à SIGNALER ce qui est resté dehors (D125). Sans ça, le lanceur
# mélangeait l'arborescence officielle et les dossiers d'essai d'avant.
$emplacements = Get-SzhEmplacements
# Mode test (D119) : les quatre dossiers de test sont créés s'ils manquent — sinon le
# mode ne serait utilisable qu'après un montage manuel. En production, rien n'est créé.
[void](Initialize-SzhEmplacementsTest)
$racines = New-Object System.Collections.ArrayList
$racinesArchives = @{}
foreach ($r in $emplacements.encours) { [void]$racines.Add($r) }
foreach ($r in $emplacements.archives) {
  [void]$racines.Add($r)
  $racinesArchives[$r.ToLower()] = $true
}

# Racines HÉRITÉES, dédoublonnées : `revuesRoots` contient d'ordinaire déjà
# « %OneDrive%\Revues », et le balayer deux fois n'apportait rien.
$racinesHeritees = New-Object System.Collections.ArrayList
$vuesHeritees = @{}
$ajouterHeritee = {
  param($chemin)
  if (-not $chemin) { return }
  $cle = ([string]$chemin).ToLower()
  if ($racinesArchives.ContainsKey($cle)) { return }
  if ($vuesHeritees.ContainsKey($cle)) { return }
  foreach ($officielle in ($emplacements.encours + $emplacements.archives)) {
    if ($officielle.ToLower() -eq $cle) { return }
  }
  $vuesHeritees[$cle] = $true
  [void]$racinesHeritees.Add([string]$chemin)
}
$cfg = Get-SzhConfig
if ($cfg -and $cfg.revuesRoots) {
  foreach ($r in $cfg.revuesRoots) {
    & $ajouterHeritee ([Environment]::ExpandEnvironmentVariables([string]$r))
  }
}
if ($env:OneDrive) { & $ajouterHeritee (Join-Path $env:OneDrive 'Revues') }

# Combien de revues sont restées dehors ? On les COMPTE (une vraie revue = un
# ausgabe.yaml), on ne les liste pas : le lanceur le dit sous les listes, et le geste
# reste à l'utilisateur — déplacer un dossier de revue derrière son dos serait pire.
$horsArborescence = 0
$dossierHors = ''
foreach ($racine in $racinesHeritees) {
  if (-not (Test-Path $racine)) { continue }
  $trouvees = @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'ausgabe.yaml') })
  if ($trouvees.Count -gt 0) {
    $horsArborescence += $trouvees.Count
    if (-not $dossierHors) { $dossierHors = $racine }
  }
}

# ---- Découverte des revues (dossier contenant ausgabe.yaml) ---------------------
#
# Une revue est ARCHIVÉE si son ausgabe.yaml le dit (`archived: true`, source de
# vérité — D116) OU si elle se trouve sous une racine d'archives : un dossier déplacé
# à la main reste classé où il est réellement.
$revuesEnCours = New-Object System.Collections.ArrayList
$revuesArchivees = New-Object System.Collections.ArrayList
$vus = @{}
foreach ($racine in $racines) {
  if (-not $racine) { continue }
  if (-not (Test-Path $racine)) { continue }
  $sousArchives = $racinesArchives.ContainsKey($racine.ToLower())
  Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_
    if (Test-Path (Join-Path $d.FullName 'ausgabe.yaml')) {
      $cle = $d.FullName.ToLower()
      if (-not $vus.ContainsKey($cle)) {
        $vus[$cle] = $true
        $etat = Get-SzhRevueEtat $d.FullName
        # D124 : un lanceur filtré ne montre que SON produit — et il le décide sur le
        # jeton d'ausgabe.yaml, pas sur l'emplacement : une Zeitschrift rangée dans un
        # dossier historique reste visible dans le lanceur Zeitschrift. Un numéro qui
        # ne déclare pas sa revue n'est classable dans aucun des deux filtres.
        if (($produitFiltre -ne 'tout') -and ($etat.jeton -ne $produitFiltre)) { return }
        $entree = [pscustomobject]@{
          nom         = $d.Name
          chemin      = $d.FullName
          modifie     = $d.LastWriteTime
          verrouillee = $etat.verrouillee
          archivee    = ($etat.archivee -or $sousArchives)
        }
        if ($entree.archivee) { [void]$revuesArchivees.Add($entree) }
        else { [void]$revuesEnCours.Add($entree) }
      }
    }
  }
}
$revuesEnCours = @($revuesEnCours | Sort-Object modifie -Descending)
$revuesArchivees = @($revuesArchivees | Sort-Object nom -Descending)

# G2 (D38) : plus de sortie anticipée quand aucune revue n'existe — la fenêtre
# s'ouvre quand même pour offrir « Nouvelle revue… » (poste vierge / pilote).

# ---- Fenêtre de sélection --------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = $titreFenetre
$form.StartPosition = 'CenterScreen'
# Hauteur ADAPTÉE à l'écran (constat 7). Le process est DPI-unaware : sur un 1366×768
# à 125 %, il « voit » 614 px de hauteur utile, et une fenêtre de 560 px sortirait de
# l'écran — sans recours, FixedDialog interdisant de la déplacer ou de la redimensionner.
# On rétrécit donc les deux listes plutôt que de perdre les boutons.
$hauteurUtile = 900
try { $hauteurUtile = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height } catch { }
$hListe = 208
$hArchives = 130
if ($hauteurUtile -lt 560) { $hListe = 96; $hArchives = 60 }
elseif ($hauteurUtile -lt 660) { $hListe = 136; $hArchives = 84 }
elseif ($hauteurUtile -lt 780) { $hListe = 170; $hArchives = 106 }
# Positions calculées, plus aucune constante magique : label 22 px, marges 10/16 px.
$yListe = 66
$yEtiqArchives = $yListe + $hListe + 10
$yArchives = $yEtiqArchives + 22
$yInfos = $yArchives + $hArchives + 10
$yBoutons = $yInfos + 46
$form.ClientSize = New-Object System.Drawing.Size(520, ($yBoutons + 44))
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$intro = New-Object System.Windows.Forms.Label
$cleChoisir = 'lanceur.choisir'
$cleVide = 'lanceur.vide'
if ($produitFiltre -eq 'zeitschrift') { $cleChoisir = 'lanceur.choisir.zs'; $cleVide = 'lanceur.vide.zs' }
if (($revuesEnCours.Count + $revuesArchivees.Count) -gt 0) { $intro.Text = (T $cleChoisir) }
else { $intro.Text = (T $cleVide) }
$intro.Location = New-Object System.Drawing.Point(16, 14)
$intro.AutoSize = $true
$form.Controls.Add($intro)

# Libellé d'une revue : cadenas si elle est verrouillée (D116) — le picto est la seule
# indication possible dans une ListBox WinForms, et « Segoe UI » le rend.
function Format-SzhRevue($Entree) {
  $texte = (T 'lanceur.modifie' @($Entree.nom, $Entree.modifie.ToString('dd.MM.yyyy')))
  # U+1F512 CADENAS FERME : ConvertFromUtf32 plutot que deux demi-paires additionnees.
  if ($Entree.verrouillee) { return ([System.Char]::ConvertFromUtf32(0x1F512) + ' ' + $texte) }
  return $texte
}

$etiqEnCours = New-Object System.Windows.Forms.Label
$etiqEnCours.Text = (T 'lanceur.encours')
$etiqEnCours.Location = New-Object System.Drawing.Point(16, 44)
$etiqEnCours.AutoSize = $true
$form.Controls.Add($etiqEnCours)

$liste = New-Object System.Windows.Forms.ListBox
$liste.Location = New-Object System.Drawing.Point(16, $yListe)
$liste.Size = New-Object System.Drawing.Size(488, $hListe)
$liste.Font = New-Object System.Drawing.Font('Segoe UI', 11)
foreach ($r in $revuesEnCours) { [void]$liste.Items.Add((Format-SzhRevue $r)) }
if ($liste.Items.Count -gt 0) { $liste.SelectedIndex = 0 }
$form.Controls.Add($liste)

$etiqArchives = New-Object System.Windows.Forms.Label
$etiqArchives.Text = (T 'lanceur.archives')
$etiqArchives.Location = New-Object System.Drawing.Point(16, $yEtiqArchives)
$etiqArchives.AutoSize = $true
$form.Controls.Add($etiqArchives)

$listeArchives = New-Object System.Windows.Forms.ListBox
$listeArchives.Location = New-Object System.Drawing.Point(16, $yArchives)
$listeArchives.Size = New-Object System.Drawing.Size(488, $hArchives)
$listeArchives.Font = New-Object System.Drawing.Font('Segoe UI', 11)
foreach ($r in $revuesArchivees) { [void]$listeArchives.Items.Add((Format-SzhRevue $r)) }
if ($listeArchives.Items.Count -eq 0) { [void]$listeArchives.Items.Add((T 'lanceur.vide.archives')) }
$form.Controls.Add($listeArchives)

# Une seule sélection à la fois : cliquer dans une liste désélectionne l'autre, sinon
# « Ouvrir » ne saurait pas laquelle des deux ouvrir.
$liste.Add_Click({ $listeArchives.ClearSelected() })
$listeArchives.Add_Click({ $liste.ClearSelected() })

# Version du logiciel installée + mode test (D120/D119) : deux informations qu'on veut
# lire AVANT d'ouvrir une revue, pas après avoir constaté un rendu bizarre.
$infos = New-Object System.Windows.Forms.Label
$vInstallee = Get-SzhVersionInstallee
$lignesInfo = @()
if ($vInstallee) { $lignesInfo += (T 'lanceur.version' @($vInstallee)) }
else { $lignesInfo += (T 'lanceur.version.inconnue') }
if ($emplacements.devMode) { $lignesInfo += (T 'lanceur.test' @($emplacements.base)) }
# D125 : ce qui est resté hors de l'arborescence est dit, pas caché.
if ($horsArborescence -gt 0) { $lignesInfo += (T 'lanceur.hors' @($horsArborescence, $dossierHors)) }
$infos.Text = ($lignesInfo -join "`n")
$infos.Location = New-Object System.Drawing.Point(16, $yInfos)
$infos.Size = New-Object System.Drawing.Size(488, 44)
$infos.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($infos)

$boutonOk = New-Object System.Windows.Forms.Button
$boutonOk.Text = (T 'lanceur.ouvrir')
$boutonOk.Location = New-Object System.Drawing.Point(318, $yBoutons)
$boutonOk.Size = New-Object System.Drawing.Size(90, 32)
$boutonOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$boutonOk.Enabled = (($revuesEnCours.Count + $revuesArchivees.Count) -gt 0)
$form.Controls.Add($boutonOk)
$form.AcceptButton = $boutonOk

$boutonNon = New-Object System.Windows.Forms.Button
$boutonNon.Text = (T 'lanceur.annuler')
$boutonNon.Location = New-Object System.Drawing.Point(414, $yBoutons)
$boutonNon.Size = New-Object System.Drawing.Size(90, 32)
$boutonNon.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($boutonNon)
$form.CancelButton = $boutonNon

$boutonVersions = New-Object System.Windows.Forms.Button
$boutonVersions.Text = (T 'lanceur.versions.bouton')
$boutonVersions.Location = New-Object System.Drawing.Point(152, $yBoutons)
$boutonVersions.Size = New-Object System.Drawing.Size(160, 32)
$form.Controls.Add($boutonVersions)
# Une mise à jour lancée, le lanceur se retire : il afficherait une version périmée, et
# ses listes resteraient cliquables pendant que le rootfs WSL est remplacé (constat 9).
$boutonVersions.Add_Click({
  if ((Show-SzhVersions $form) -eq $true) {
    $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Close()
  }
})

# ---- « Nouvelle revue… » (G2, D38) : scaffold via new-revue.ps1 puis ouverture ----

# Petite boîte : demande le nom du dossier de la nouvelle revue. $null si annulé.
function Read-SzhNomRevue {
  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.nouvelle') -replace '…', ''
  $boite.StartPosition = 'CenterParent'
  $boite.ClientSize = New-Object System.Drawing.Size(400, 118)
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false

  $question = New-Object System.Windows.Forms.Label
  $question.Text = (T 'lanceur.nouvelle.nom')
  $question.Location = New-Object System.Drawing.Point(16, 14)
  $question.AutoSize = $true
  $boite.Controls.Add($question)

  $champ = New-Object System.Windows.Forms.TextBox
  $champ.Location = New-Object System.Drawing.Point(16, 40)
  $champ.Size = New-Object System.Drawing.Size(368, 24)
  $champ.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $boite.Controls.Add($champ)

  $okBouton = New-Object System.Windows.Forms.Button
  $okBouton.Text = 'OK'
  $okBouton.Location = New-Object System.Drawing.Point(198, 76)
  $okBouton.Size = New-Object System.Drawing.Size(90, 30)
  $okBouton.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $boite.Controls.Add($okBouton)
  $boite.AcceptButton = $okBouton

  $nonBouton = New-Object System.Windows.Forms.Button
  $nonBouton.Text = (T 'lanceur.annuler')
  $nonBouton.Location = New-Object System.Drawing.Point(294, 76)
  $nonBouton.Size = New-Object System.Drawing.Size(90, 30)
  $nonBouton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $boite.Controls.Add($nonBouton)
  $boite.CancelButton = $nonBouton

  if ($boite.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  $nom = $champ.Text.Trim()
  if (-not $nom) { return $null }
  if ($nom -match '[<>:"/\\|?*]') {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.invalide'), $titreFenetre)
    return $null
  }
  return $nom
}

$boutonNouvelle = New-Object System.Windows.Forms.Button
$boutonNouvelle.Text = (T 'lanceur.nouvelle')
$boutonNouvelle.Location = New-Object System.Drawing.Point(16, $yBoutons)
$boutonNouvelle.Size = New-Object System.Drawing.Size(130, 32)
$form.Controls.Add($boutonNouvelle)
$boutonNouvelle.Add_Click({
  # 1) Dossier parent, 2) nom du dossier. Par défaut : le dossier « en cours » de la
  # Revue (D116) — celui de production ou celui de test selon le mode (D119) ; repli
  # OneDrive\Revues pour un poste encore configuré à l'ancienne.
  $dossierDlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dossierDlg.Description = (T 'lanceur.nouvelle.dossier')
  $dossierDlg.ShowNewFolderButton = $true
  $defaut = ''
  $encoursDefaut = $emplacements.revue.encours
  if ($produitFiltre -eq 'zeitschrift') { $encoursDefaut = $emplacements.zeitschrift.encours }
  if (Test-Path $encoursDefaut) { $defaut = $encoursDefaut }
  elseif ($env:OneDrive) {
    $repli = Join-Path $env:OneDrive 'Revues'
    if (Test-Path $repli) { $defaut = $repli }
  }
  if ($defaut) { $dossierDlg.SelectedPath = $defaut }
  if ($dossierDlg.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { return }
  $nom = Read-SzhNomRevue
  if (-not $nom) { return }
  $cible = Join-Path $dossierDlg.SelectedPath $nom
  try {
    # new-revue.ps1 : scaffold depuis le template + estampille de version (D120) +
    # « Ouvrir la revue.lnk » + enregistrement de la racine pour ce lanceur (D38).
    & (Join-Path $PSScriptRoot 'new-revue.ps1') -Dossier $cible | Out-Null
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.erreur' @($_.Exception.Message)), $titreFenetre)
    return
  }
  Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f (Resolve-Path $cible).Path)
  $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel   # revue déjà ouverte ci-dessus
  $form.Close()
})

# Double-clic = ouvrir (dans l'une comme dans l'autre liste)
$liste.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
$listeArchives.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })

$resultat = $form.ShowDialog()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK) {
  $choix = $null
  if ($liste.SelectedIndex -ge 0) { $choix = $revuesEnCours[$liste.SelectedIndex] }
  elseif (($listeArchives.SelectedIndex -ge 0) -and ($revuesArchivees.Count -gt 0)) {
    $choix = $revuesArchivees[$listeArchives.SelectedIndex]
  }
  if ($choix) { Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f $choix.chemin) }
}
