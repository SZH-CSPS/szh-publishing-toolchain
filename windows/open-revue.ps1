<#
.SYNOPSIS
  Lanceur du menu Démarrer (« Revues SZH », « Zeitschriften SZH »), appelé par hidden.vbs,
  donc sans console. Liste les numéros en cours et archivés du produit, ouvre celui qu'on
  choisit dans VSCodium, affiche et permet de changer la version installée.

    powershell -ExecutionPolicy Bypass -File open-revue.ps1
    powershell -ExecutionPolicy Bypass -File open-revue.ps1 -Versions   # sélecteur de version seul

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Lien « szh://… » passé par le gestionnaire de protocole Windows : ouvre directement le
  # numéro visé. Positionnel, parce que hidden.vbs requote chacun de ses arguments et
  # qu'un « %1 » requoté se lie à un paramètre positionnel.
  [Parameter(Position = 0)][string]$Lien,
  # « revue » (défaut) ou « zeitschrift » : ce qui distingue les deux raccourcis du menu
  # Démarrer. Pas de valeur « tout » : une liste mélangée montrerait une Zeitschrift parmi
  # les revues, et « Nouvelle revue… » ne saurait pas quel produit créer.
  [string]$Produit = 'revue',
  # Ouvre directement le sélecteur de version, comme le bouton « Changer de version… » du
  # cockpit : une seule implémentation, atteignable des deux côtés.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

# ⚠ Ce script tourne sans console : une exception terminante n'y donne aucun message,
# seulement un lanceur qui ne s'ouvre pas. D'où le filet posé juste après.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Posé ici parce qu'il lui faut System.Windows.Forms pour parler. `trap` plutôt qu'un
# try/catch enveloppant : il couvre toute la portée sans réindenter une ligne. Titre en
# dur, $titreFenetre n'existant pas encore et la traduction pouvant avoir échoué.
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

# Normalisation à la main plutôt que [ValidateSet] : une valeur inattendue ne doit pas
# lever, le lanceur mourrait sans message. Tout sauf « zeitschrift » vaut « revue ».
$produitFiltre = ([string]$Produit).ToLower()
if ($produitFiltre -ne 'zeitschrift') { $produitFiltre = 'revue' }
# Avant le premier texte affiché : ce lanceur parle la langue de son produit.
Set-SzhLangueProduit $produitFiltre
$titreFenetre = (T 'lanceur.titre')
if ($produitFiltre -eq 'zeitschrift') { $titreFenetre = (T 'lanceur.titre.zs') }

# ---- Icône des fenêtres ----
# Chaque fenêtre porte l'icône de son produit (windows/icone.py). 'FixedDialog' masque
# celle du bandeau de titre, mais la barre des tâches et Alt+Tab la montrent : sans elle,
# le lanceur s'y annonce avec l'icône de wscript.exe et deux lanceurs sont indiscernables.
$fichierIcone = Join-Path $PSScriptRoot 'szh-revue.ico'
if ($produitFiltre -eq 'zeitschrift') { $fichierIcone = Join-Path $PSScriptRoot 'szh-zeitschrift.ico' }

# Lecture en tableau d'octets et non par nom de fichier : Icon(String) garderait le .ico
# ouvert tant que la fenêtre vit, et une mise à jour concurrente ne pourrait pas le
# remplacer. Ne lève jamais, une icône n'étant pas une condition d'ouverture.
function Set-SzhIconeFenetre($Fenetre) {
  if (-not (Test-Path $fichierIcone)) { return }
  try {
    # La virgule force le byte[] à passer comme un seul argument de constructeur.
    $flux = New-Object System.IO.MemoryStream (,[System.IO.File]::ReadAllBytes($fichierIcone))
    $Fenetre.Icon = New-Object System.Drawing.Icon $flux
  } catch {
    Write-SzhLog ('open-revue : icone non chargee (' + $_.Exception.Message + ')')
  }
}

# ---- Sélecteur de version du logiciel ----
# Recomposer un ancien numéro à l'identique suppose de réinstaller la version qui l'a
# fabriqué ; `update.ps1 -Version X` sait le faire, ce dialogue le rend atteignable, et
# explicitement : le changement remplace le rootfs WSL et les extensions, et demande un
# redémarrage de l'éditeur.
function Show-SzhVersions($Parent) {
  $installee = Get-SzhVersionInstallee
  # Aucun appel réseau ici : la liste est remplie au Shown, plus bas ; le faire avant
  # l'affichage fige la fenêtre jusqu'au bout du timeout.
  $locales = @(Get-SzhVersionsLocales)
  $disponibles = New-Object System.Collections.ArrayList

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.versions.titre')
  if ($Parent) { $boite.StartPosition = 'CenterParent' } else { $boite.StartPosition = 'CenterScreen' }
  $boite.ClientSize = New-Object System.Drawing.Size(460, 340)
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false
  # Atteignable sans la fenêtre principale : elle a son propre bouton de barre des tâches,
  # donc son propre besoin d'icône.
  Set-SzhIconeFenetre $boite

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

  # La liste se remplit après l'affichage : la fenêtre est là tout de suite, et l'attente
  # réseau se voit au lieu de figer l'interface.
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
    # Trois états à nommer : liste complète, hors ligne avec un repli réel, hors ligne
    # sans repli (seule la version installée, donc rien à installer).
    if ($publiees.Count -gt 0) { $note.Text = '' }
    elseif ($locales.Count -gt 0) { $note.Text = (T 'lanceur.versions.horsligne') }
    else { $note.Text = (T 'lanceur.versions.horsligne.deja') }
    if ($disponibles.Count -eq 0) { $note.Text = (T 'lanceur.versions.vide') }
    $bInstaller.Enabled = ($disponibles.Count -gt 0)
  })

  $bInstaller.Add_Click({
    if ($liVersions.SelectedIndex -lt 0) { return }
    $choix = [string]$disponibles[$liVersions.SelectedIndex]
    # Garde-fou de quoting : la valeur peut venir d'un nom de fichier de staging et part
    # en argument de update.ps1, où « 2026.08.0 -Verbose » injecterait un paramètre.
    if (-not (Test-SzhVersionTag $choix)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.versions.vide'), (T 'lanceur.versions.titre'))
      return
    }
    $reponse = [System.Windows.Forms.MessageBox]::Show(
      (T 'lanceur.versions.avert' @($choix)), (T 'lanceur.versions.titre'),
      [System.Windows.Forms.MessageBoxButtons]::OKCancel,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($reponse -ne [System.Windows.Forms.DialogResult]::OK) { return }
    # update.ps1 fait le reste, sans demander l'administrateur. Chaque argument est cité,
    # le chemin du toolkit contenant des espaces.
    Write-SzhLog ('open-revue : installation de la version ' + $choix + ' demandee')
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      ('"{0}"' -f (Join-Path $PSScriptRoot 'update.ps1')), '-Version', ('"{0}"' -f $choix))
    $boite.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $boite.Close()
  })

  # Sans parent (processus détaché), rien ne garantit le premier plan, et une boîte qui
  # s'ouvre derrière VSCodium se lit comme un bouton inerte.
  $resultat = [System.Windows.Forms.DialogResult]::Cancel
  if ($Parent) { $resultat = $boite.ShowDialog($Parent) }
  else {
    $boite.TopMost = $true
    $resultat = $boite.ShowDialog()
  }
  # $true = une installation a été lancée : l'appelant doit se retirer.
  return ($resultat -eq [System.Windows.Forms.DialogResult]::OK)
}

# Avant le test VSCodium, exprès : c'est l'outil de réparation d'une installation abîmée,
# le mettre derrière la chose à réparer le rendrait inatteignable. Journalisé à l'entrée :
# lancé détaché par l'extension, c'est la seule trace de son passage.
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

# ---- Lien « szh:// » reçu : on ouvre, on ne liste pas ----
# Le dossier est cherché dans les emplacements du poste (Find-SzhRevue), jamais construit
# sur l'entrée brute. Les trois issues sont bavardes : un lien qui ne marche pas doit dire
# pourquoi.
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
  # L'intention dit au cockpit où atterrir ; à usage unique, périmée au bout de 5 minutes.
  # Jamais bloquante : sans elle, la revue s'ouvre sans aller droit au panneau.
  try { Set-SzhIntention $dossierLien $cible.vue $cible.article } catch { }
  [void](Start-SzhCodium $dossierLien)
  exit 0
}

# ---- Racines à balayer ----
# Le lanceur ne liste que les emplacements « en cours » et « archives » ; les racines
# héritées (config.json `revuesRoots`, OneDrive\Revues) ne servent qu'à signaler ce qui est
# resté dehors.
$emplacements = Get-SzhEmplacements
# Les quatre dossiers de test sont créés s'ils manquent ; en production, rien n'est créé.
[void](Initialize-SzhEmplacementsTest)
# Les deux emplacements du produit de ce lanceur, et eux seuls.
$encoursProduit = Get-SzhEmplacementRevue $produitFiltre 'encours'
$archiveProduit = Get-SzhEmplacementRevue $produitFiltre 'archive'
$racines = New-Object System.Collections.ArrayList
[void]$racines.Add($encoursProduit)
[void]$racines.Add($archiveProduit)
$racinesArchives = @{}
$racinesArchives[$archiveProduit.ToLower()] = $true

# Racines héritées, dédoublonnées : `revuesRoots` contient d'ordinaire déjà
# « %OneDrive%\Revues ».
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
  # Un dossier hérité qui est l'emplacement de l'autre produit n'est pas « hors
  # arborescence » : on ne le compte pas.
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

# Les revues restées dehors sont comptées (une vraie revue porte un ausgabe.yaml) et
# signalées sous les listes ; le déplacement reste à l'utilisateur.
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

# ---- Découverte des revues (dossier contenant ausgabe.yaml) ----
# Une revue est archivée si son ausgabe.yaml le dit (`archived: true`) ou si elle est sous
# une racine d'archives : un dossier déplacé à la main reste classé là où il est.
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
        # Le produit vient du jeton d'ausgabe.yaml, pas de l'emplacement : un numéro rangé
        # côté Zeitschrift mais déclarant « revue: revue » n'apparaît pas ici, et le
        # décalage se voit au lieu de se deviner.
        if ($etat.jeton -ne $produitFiltre) { return }
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

# Pas de sortie anticipée quand il n'y a aucune revue : la fenêtre s'ouvre quand même,
# pour offrir « Nouvelle revue… » sur un poste vierge.

# ---- Le bloc d'informations, calculé avant la mise en page ----
# Version installée, racine active, numéros restés dehors : à lire avant d'ouvrir un numéro,
# pas après un rendu inattendu.
#
# La racine est dite dans les DEUX racines, et non plus en test seulement : c'est, avec le
# titre de la fenêtre, le seul endroit qui la rende visible, et un lanceur aux listes vides
# après une bascule de `emplacementRevues` ne se comprend pas sans elle. Le chemin complet
# la nomme de lui-même — « …\Revues-TESTING » ou « …\2_Produkte ».
$lignesInfo = @()
$vInstallee = Get-SzhVersionInstallee
if ($vInstallee) { $lignesInfo += (T 'lanceur.version' @($vInstallee)) }
else { $lignesInfo += (T 'lanceur.version.inconnue') }
$cleRacine = 'lanceur.test'
if ($produitFiltre -eq 'zeitschrift') { $cleRacine = 'lanceur.test.zs' }
$lignesInfo += (T $cleRacine @($emplacements.base))
# Ce qui est resté hors de l'arborescence est dit, pas caché.
if ($horsArborescence -gt 0) { $lignesInfo += (T 'lanceur.hors' @($horsArborescence, $dossierHors)) }
# Hauteur réelle du bloc : un chemin de racine dépasse la largeur du libellé et revient à la
# ligne. Mesurée plutôt que devinée — sans cela, la ligne qui dit où vivent les numéros
# passait sous les boutons, et l'information était perdue au lieu d'être lue.
#
# C'est le libellé qui se mesure, et non TextRenderer : `WordBreak` ne coupe qu'aux espaces,
# et un chemin Windows n'en a pas — il rendait une seule ligne de 920 px pour un texte qui
# en occupe trois.
$infos = New-Object System.Windows.Forms.Label
$infos.AutoSize = $false
$infos.Width = 488
$infos.Text = ($lignesInfo -join "`n")
$hInfos = 44
try {
  $voulue = $infos.GetPreferredSize((New-Object System.Drawing.Size(488, 0))).Height + 8
  if ($voulue -gt $hInfos) { $hInfos = $voulue }
} catch { }

# ---- Fenêtre de sélection ----
$form = New-Object System.Windows.Forms.Form
$form.Text = $titreFenetre
$form.StartPosition = 'CenterScreen'
# Hauteur adaptée à l'écran. Le processus ignore le DPI : sur un 1366×768 à 125 %, il ne
# « voit » que 614 px utiles, et FixedDialog interdit de déplacer une fenêtre trop haute.
# On rétrécit donc les listes, pas les boutons.
$hauteurUtile = 900
try { $hauteurUtile = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height } catch { }
$hListe = 208
$hArchives = 130
if ($hauteurUtile -lt 560) { $hListe = 96; $hArchives = 60 }
elseif ($hauteurUtile -lt 660) { $hListe = 136; $hArchives = 84 }
elseif ($hauteurUtile -lt 780) { $hListe = 170; $hArchives = 106 }
# Positions calculées plutôt que constantes : label 22 px, marges 10 et 16 px.
$yListe = 66
$yEtiqArchives = $yListe + $hListe + 10
$yArchives = $yEtiqArchives + 22
$yInfos = $yArchives + $hArchives + 10
$yBoutons = $yInfos + $hInfos + 2
$form.ClientSize = New-Object System.Drawing.Size(520, ($yBoutons + 44))
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
Set-SzhIconeFenetre $form

$intro = New-Object System.Windows.Forms.Label
$cleChoisir = 'lanceur.choisir'
$cleVide = 'lanceur.vide'
if ($produitFiltre -eq 'zeitschrift') { $cleChoisir = 'lanceur.choisir.zs'; $cleVide = 'lanceur.vide.zs' }
if (($revuesEnCours.Count + $revuesArchivees.Count) -gt 0) { $intro.Text = (T $cleChoisir) }
else { $intro.Text = (T $cleVide) }
$intro.Location = New-Object System.Drawing.Point(16, 14)
$intro.AutoSize = $true
$form.Controls.Add($intro)

# Cadenas si la revue est verrouillée : le picto est la seule marque possible dans une
# ListBox WinForms, et « Segoe UI » le rend.
function Format-SzhRevue($Entree) {
  $texte = (T 'lanceur.modifie' @($Entree.nom, $Entree.modifie.ToString('dd.MM.yyyy')))
  # U+1F512 cadenas ferme : ConvertFromUtf32 plutot que deux demi-paires additionnees.
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

# Le libellé a été créé plus haut, pour que sa hauteur entre dans la mise en page.
$infos.Location = New-Object System.Drawing.Point(16, $yInfos)
$infos.Size = New-Object System.Drawing.Size(488, $hInfos)
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
# Une mise à jour lancée, le lanceur se retire : il afficherait une version périmée et ses
# listes resteraient cliquables pendant le remplacement du rootfs WSL.
$boutonVersions.Add_Click({
  if ((Show-SzhVersions $form) -eq $true) {
    $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Close()
  }
})

# ---- « Nouvelle revue… » : new-revue.ps1 puis ouverture ----

# Demande l'ANNÉE et le NUMÉRO du numéro à créer — et rien d'autre. Le volume s'affiche
# grisé, calculé d'après l'année (Get-SzhVolumePour), et le nom du dossier n'est qu'un
# affichage : il se déduit des deux nombres.
#
# C'est l'inverse de ce que faisait cette boîte : elle demandait un nom de dossier en texte
# libre, dont new-revue.ps1 essayait ensuite de deviner l'année et le numéro, et laissait
# tout à remplir quand le nom sortait de la convention. On demande maintenant le sens, et
# c'est le nom technique qui s'en déduit.
#
# Rend $null si annulé, sinon { annee, numero, volume, nom }.
function Read-SzhNouveauNumero {
  $anneeMin = Get-SzhPremiereAnnee $produitFiltre
  $anneeMax = (Get-Date).Year + 5
  $anneeDefaut = (Get-Date).Year
  if ($anneeDefaut -lt $anneeMin) { $anneeDefaut = $anneeMin }

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.nouvelle') -replace '…', ''
  $boite.StartPosition = 'CenterParent'
  $boite.ClientSize = New-Object System.Drawing.Size(430, 296)   # ajustée plus bas
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false

  $etiqAnnee = New-Object System.Windows.Forms.Label
  $etiqAnnee.Text = (T 'lanceur.nouvelle.annee')
  $etiqAnnee.Location = New-Object System.Drawing.Point(16, 21)
  $etiqAnnee.Size = New-Object System.Drawing.Size(96, 22)
  $boite.Controls.Add($etiqAnnee)

  # NumericUpDown plutôt que TextBox : une année et un numéro sont des nombres dans des
  # bornes, le contrôle s'en charge, et il n'y a plus de saisie invalide à refuser par un
  # message. La borne basse de l'année est celle du premier volume de la revue.
  $champAnnee = New-Object System.Windows.Forms.NumericUpDown
  $champAnnee.Location = New-Object System.Drawing.Point(118, 16)
  $champAnnee.Size = New-Object System.Drawing.Size(96, 28)
  $champAnnee.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champAnnee.Minimum = $anneeMin
  $champAnnee.Maximum = $anneeMax
  $champAnnee.Value = $anneeDefaut
  $boite.Controls.Add($champAnnee)

  $etiqNumero = New-Object System.Windows.Forms.Label
  $etiqNumero.Text = (T 'lanceur.nouvelle.numero')
  $etiqNumero.Location = New-Object System.Drawing.Point(16, 57)
  $etiqNumero.Size = New-Object System.Drawing.Size(96, 22)
  $boite.Controls.Add($etiqNumero)

  # 1 à 99 : la convention « AAAA-NN » du nom de dossier tient le numéro sur deux chiffres.
  $champNumero = New-Object System.Windows.Forms.NumericUpDown
  $champNumero.Location = New-Object System.Drawing.Point(118, 52)
  $champNumero.Size = New-Object System.Drawing.Size(96, 28)
  $champNumero.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champNumero.Minimum = 1
  $champNumero.Maximum = 99
  $champNumero.Value = 1
  $boite.Controls.Add($champNumero)

  $etiqVolume = New-Object System.Windows.Forms.Label
  $etiqVolume.Text = (T 'lanceur.nouvelle.volume')
  $etiqVolume.Location = New-Object System.Drawing.Point(16, 93)
  $etiqVolume.Size = New-Object System.Drawing.Size(96, 22)
  $boite.Controls.Add($etiqVolume)

  # Désactivé, donc grisé : le volume se lit, il ne se saisit pas. Il suit l'année tant que
  # le bouton ci-dessous n'a pas été pressé.
  $champVolume = New-Object System.Windows.Forms.NumericUpDown
  $champVolume.Location = New-Object System.Drawing.Point(118, 88)
  $champVolume.Size = New-Object System.Drawing.Size(96, 28)
  $champVolume.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champVolume.Minimum = 1
  $champVolume.Maximum = 999
  $champVolume.Value = 1
  $champVolume.Enabled = $false
  $boite.Controls.Add($champVolume)

  # Le volume se déduit d'une droite vérifiée sur neuf millésimes, mais une revue peut
  # sauter un volume ou en doubler un. Ce bouton est la sortie de secours, et son libellé
  # dit qu'elle est déconseillée : un volume faux s'imprime sur la couverture et part dans
  # OJS sans que rien ne le signale.
  $boutonManuel = New-Object System.Windows.Forms.Button
  $boutonManuel.Text = (T 'lanceur.nouvelle.volume.manuel')
  $boutonManuel.Location = New-Object System.Drawing.Point(118, 122)
  $boutonManuel.Size = New-Object System.Drawing.Size(296, 30)
  $boite.Controls.Add($boutonManuel)

  # Un libellé, pas un champ : le nom du dossier est montré et ne se change pas.
  $etiqDossier = New-Object System.Windows.Forms.Label
  $etiqDossier.Location = New-Object System.Drawing.Point(16, 166)
  $etiqDossier.Size = New-Object System.Drawing.Size(398, 22)
  $etiqDossier.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
  $boite.Controls.Add($etiqDossier)

  # Hauteur mesurée et non devinée : selon la racine active, ce chemin tient sur deux lignes
  # comme sur quatre, et tronqué il ne dirait plus où le numéro va être créé.
  $ou = New-Object System.Windows.Forms.Label
  $ou.AutoSize = $false
  $ou.Width = 398
  $ou.Text = (T 'lanceur.nouvelle.ou' @($encoursProduit))
  $hOu = 46
  try {
    $vouluOu = $ou.GetPreferredSize((New-Object System.Drawing.Size(398, 0))).Height + 8
    if ($vouluOu -gt $hOu) { $hOu = $vouluOu }
  } catch { }
  $ou.Location = New-Object System.Drawing.Point(16, 192)
  $ou.Size = New-Object System.Drawing.Size(398, $hOu)
  $ou.ForeColor = [System.Drawing.Color]::DimGray
  $boite.Controls.Add($ou)

  $yBoutonsBoite = 192 + $hOu + 12
  $boite.ClientSize = New-Object System.Drawing.Size(430, ($yBoutonsBoite + 46))

  $okBouton = New-Object System.Windows.Forms.Button
  $okBouton.Text = 'OK'
  $okBouton.Location = New-Object System.Drawing.Point(232, $yBoutonsBoite)
  $okBouton.Size = New-Object System.Drawing.Size(90, 32)
  $okBouton.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $boite.Controls.Add($okBouton)
  $boite.AcceptButton = $okBouton

  $nonBouton = New-Object System.Windows.Forms.Button
  $nonBouton.Text = (T 'lanceur.annuler')
  $nonBouton.Location = New-Object System.Drawing.Point(324, $yBoutonsBoite)
  $nonBouton.Size = New-Object System.Drawing.Size(90, 32)
  $nonBouton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $boite.Controls.Add($nonBouton)
  $boite.CancelButton = $nonBouton

  # Table de hachage et non une variable : un gestionnaire d'événement peut modifier un objet,
  # il ne peut pas réassigner la variable locale d'une fonction.
  $etat = @{ manuel = $false }

  # Le volume et le nom du dossier suivent les deux nombres, à chaque frappe.
  $rafraichir = {
    $anneeVue = [int]$champAnnee.Value
    $numeroVue = [int]$champNumero.Value
    if (-not $etat.manuel) {
      $calcule = Get-SzhVolumePour $produitFiltre $anneeVue
      if ($calcule -ge $champVolume.Minimum -and $calcule -le $champVolume.Maximum) {
        $champVolume.Value = $calcule
      }
    }
    $etiqDossier.Text = (T 'lanceur.nouvelle.dossier' @((Get-SzhNomNumero $anneeVue $numeroVue)))
  }
  $champAnnee.Add_ValueChanged($rafraichir)
  $champNumero.Add_ValueChanged($rafraichir)

  # Bascule dans les deux sens : on peut revenir au volume calculé après s'être trompé.
  $boutonManuel.Add_Click({
    if ($etat.manuel) {
      $etat.manuel = $false
      $champVolume.Enabled = $false
      $boutonManuel.Text = (T 'lanceur.nouvelle.volume.manuel')
      & $rafraichir
    } else {
      $etat.manuel = $true
      $champVolume.Enabled = $true
      $boutonManuel.Text = (T 'lanceur.nouvelle.volume.auto')
      $champVolume.Focus()
    }
  })

  # Les deux refus se font ici, la boîte ouverte : le remède est à un chiffre près, et
  # refermer le formulaire pour le redire obligerait à tout resaisir.
  $okBouton.Add_Click({
    $anneeOk = [int]$champAnnee.Value
    $numeroOk = [int]$champNumero.Value
    $volumeOk = [int]$champVolume.Value
    $nomOk = Get-SzhNomNumero $anneeOk $numeroOk
    # Le dossier homonyme d'abord : c'est le cas le plus simple, et son message existe.
    if (Test-Path (Join-Path $encoursProduit $nomOk)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.existe' @($nomOk)), $titreFenetre)
      $boite.DialogResult = [System.Windows.Forms.DialogResult]::None
      return
    }
    # Puis le couple volume + numéro, en cours ET archives. C'est lui qui identifie un
    # numéro : deux dossiers de noms différents peuvent le porter, et c'est ce qu'il faut
    # refuser. Rien n'est supprimé ni déplacé ici — le message dit lequel et où, et la
    # suppression reste un geste du rédacteur.
    $deja = Find-SzhNumeroVolume $produitFiltre $volumeOk $numeroOk
    if ($deja) {
      $dit = @((T 'lanceur.nouvelle.doublon' @($volumeOk, $numeroOk, $deja.nom, $deja.chemin)))
      if ($deja.archive) { $dit += (T 'lanceur.nouvelle.doublon.arch') }
      $dit += (T 'lanceur.nouvelle.doublon.suite')
      [void][System.Windows.Forms.MessageBox]::Show(($dit -join "`n`n"), $titreFenetre,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
      $boite.DialogResult = [System.Windows.Forms.DialogResult]::None
      return
    }
  })

  # Premier remplissage depuis la fonction elle-même : la boîte s'ouvre déjà renseignée.
  & $rafraichir

  if ($boite.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  $annee = [int]$champAnnee.Value
  $numero = [int]$champNumero.Value
  return [pscustomobject]@{
    annee  = $annee
    numero = $numero
    volume = [int]$champVolume.Value
    nom    = (Get-SzhNomNumero $annee $numero)
  }
}

$boutonNouvelle = New-Object System.Windows.Forms.Button
$boutonNouvelle.Text = (T 'lanceur.nouvelle')
$boutonNouvelle.Location = New-Object System.Drawing.Point(16, $yBoutons)
$boutonNouvelle.Size = New-Object System.Drawing.Size(130, 32)
$form.Controls.Add($boutonNouvelle)
$boutonNouvelle.Add_Click({
  # Pas de choix d'emplacement : un numéro se crée dans le dossier « en cours » du produit
  # de ce lanceur. Il n'y a qu'une bonne réponse, et laisser choisir ne servait qu'à se
  # tromper de produit.
  # Le formulaire a déjà refusé le dossier homonyme et le doublon de volume + numéro.
  $neuf = Read-SzhNouveauNumero
  if (-not $neuf) { return }
  $cible = Join-Path $encoursProduit $neuf.nom
  try {
    # new-revue.ps1 copie le gabarit, pose le jeton `revue:`, l'année, le numéro, le volume,
    # l'estampille de version et « Ouvrir la revue.lnk ».
    $parametres = @{
      Dossier = $cible
      Produit = $produitFiltre
      Annee   = $neuf.annee
      Numero  = $neuf.numero
      Volume  = $neuf.volume
    }
    & (Join-Path $PSScriptRoot 'new-revue.ps1') @parametres | Out-Null
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.erreur' @($_.Exception.Message)), $titreFenetre)
    return
  }
  [void](Start-SzhCodium (Resolve-Path $cible).Path)
  $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel   # revue déjà ouverte ci-dessus
  $form.Close()
})

# Double-clic = ouvrir, dans l'une comme dans l'autre liste.
$liste.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
$listeArchives.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })

$resultat = $form.ShowDialog()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK) {
  $choix = $null
  if ($liste.SelectedIndex -ge 0) { $choix = $revuesEnCours[$liste.SelectedIndex] }
  elseif (($listeArchives.SelectedIndex -ge 0) -and ($revuesArchivees.Count -gt 0)) {
    $choix = $revuesArchivees[$listeArchives.SelectedIndex]
  }
  if ($choix) { [void](Start-SzhCodium $choix.chemin) }
}
