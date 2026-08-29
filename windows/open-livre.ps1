<#
.SYNOPSIS
  Lanceur du menu Démarrer « Books SZH-CSPS », appelé par hidden.vbs, donc sans console.
  Liste les livres en cours et archivés, ouvre celui qu'on choisit dans VSCodium, affiche et
  permet de changer la version installée. Calqué sur open-revue.ps1 (mêmes briques : WinForms,
  trap global, icône chargée en mémoire, identité de barre des tâches déclarée avant la
  première fenêtre), avec les écarts qu'impose un livre :
    * un seul produit — pas de -Produit, pas de liste « hors arborescence » héritée d'avant
      le livre (config.json `revuesRoots` / OneDrive\Revues ne concernent que les revues) ;
    * la liste affiche le TITRE lu dans buch.yaml, jamais le nom du dossier ;
    * un livre n'a pas de langue de produit (voir Set-SzhLangueProduit dans szh-common.ps1) :
      l'appel ci-dessous ne force donc rien, et l'interface suit la langue déjà résolue
      (variable d'environnement, préférence retenue, langue de Windows) ;
    * « Nouveau livre… » demande titre, année, référence B, type et maquette — un livre n'a
      ni volume ni numéro.

    powershell -ExecutionPolicy Bypass -File open-livre.ps1
    powershell -ExecutionPolicy Bypass -File open-livre.ps1 -Versions   # sélecteur de version seul

  Compatibilité : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
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

trap {
  $souci = $_.Exception.Message
  try { Write-SzhLog ('open-livre ERREUR : ' + $souci) } catch { }
  try {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.erreur' @($souci, $SzhSupport)), 'Books SZH-CSPS')
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show($souci, 'Books SZH-CSPS')
  }
  exit 1
}

# Appelée par cohérence avec les deux autres lanceurs, mais elle ne fait rien ici : un livre
# n'a pas de langue de produit (voir le commentaire de Set-SzhLangueProduit). $SzhLangue reste
# ce que la cascade du haut de szh-common.ps1 a déjà résolu.
Set-SzhLangueProduit 'livre'
$titreFenetre = (T 'lanceur.titre.livre')

# ---- Icône des fenêtres, et identité de barre des tâches ----
# 'FixedDialog' masque celle du bandeau de titre, mais Alt+Tab la montre : sans elle, le
# lanceur s'y annonce avec l'icône de wscript.exe et les trois lanceurs sont indiscernables.
$fichierIcone = Join-Path $PSScriptRoot 'szh-livre.ico'

# La barre des tâches, elle, ne regarde pas l'icône de la fenêtre : elle range le bouton sous
# l'AppUserModelID du processus. La déclaration est ici, donc AVANT la première fenêtre :
# Windows lit l'identité au moment où la fenêtre s'inscrit à la barre, et ne la relit jamais
# ensuite. Voir « Identité de barre des tâches » dans szh-common.ps1.
[void](Set-SzhAppUserModelId (Get-SzhAppId 'livre'))

# Lecture en tableau d'octets et non par nom de fichier : Icon(String) garderait le .ico
# ouvert tant que la fenêtre vit, et une mise à jour concurrente ne pourrait pas le
# remplacer. Ne lève jamais, une icône n'étant pas une condition d'ouverture.
function Set-SzhIconeFenetre($Fenetre) {
  if (-not (Test-Path $fichierIcone)) { return }
  try {
    $flux = New-Object System.IO.MemoryStream (,[System.IO.File]::ReadAllBytes($fichierIcone))
    $Fenetre.Icon = New-Object System.Drawing.Icon $flux
  } catch {
    Write-SzhLog ('open-livre : icone non chargee (' + $_.Exception.Message + ')')
  }
}

# ---- Sélecteur de version du logiciel ----
# Dupliqué à dessein plutôt que partagé avec open-revue.ps1 : chaque lanceur de produit est
# un script autonome dans ce toolkit (open-revue.ps1 et update.ps1 le sont déjà l'un de
# l'autre), et cette boîte capture des variables locales à sa fenêtre appelante.
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
    Write-SzhLog ('open-livre : installation de la version ' + $choix + ' demandee')
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      ('"{0}"' -f (Join-Path $PSScriptRoot 'update.ps1')), '-Version', ('"{0}"' -f $choix))
    $boite.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $boite.Close()
  })

  # Sans parent (processus détaché), rien ne garantit le premier plan.
  $resultat = [System.Windows.Forms.DialogResult]::Cancel
  if ($Parent) { $resultat = $boite.ShowDialog($Parent) }
  else {
    $boite.TopMost = $true
    $resultat = $boite.ShowDialog()
  }
  # $true = une installation a été lancée : l'appelant doit se retirer.
  return ($resultat -eq [System.Windows.Forms.DialogResult]::OK)
}

if ($Versions) {
  Write-SzhLog 'open-livre : selecteur de versions demande'
  Show-SzhVersions $null
  exit 0
}

$codium = Get-VSCodiumExe
if (-not $codium) {
  [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.codium' @($SzhSupport)), $titreFenetre)
  exit 1
}

# ---- Racines à balayer ----
# Un livre n'a qu'un seul jeton de produit ; contrairement à open-revue.ps1, il n'y a donc
# rien à filtrer et pas de racines héritées à signaler (config.json `revuesRoots` et
# OneDrive\Revues ne concernent que les revues, pas les livres).
$emplacements = Get-SzhEmplacements
[void](Initialize-SzhEmplacementsTest)
$encoursLivre = Get-SzhEmplacementRevue 'livre' 'encours'
$archiveLivre = Get-SzhEmplacementRevue 'livre' 'archive'

# ---- Découverte des livres (dossier contenant buch.yaml) ----
$livresEnCours = New-Object System.Collections.ArrayList
$livresArchives = New-Object System.Collections.ArrayList
$vus = @{}
foreach ($racine in @($encoursLivre, $archiveLivre)) {
  if (-not $racine) { continue }
  if (-not (Test-Path $racine)) { continue }
  $sousArchives = ($racine.ToLower() -eq $archiveLivre.ToLower())
  Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_
    if (Test-Path (Join-Path $d.FullName 'buch.yaml')) {
      $cle = $d.FullName.ToLower()
      if (-not $vus.ContainsKey($cle)) {
        $vus[$cle] = $true
        $etat = Get-SzhLivreEtat $d.FullName
        $entree = [pscustomobject]@{
          nom         = $d.Name
          titre       = $etat.titre
          chemin      = $d.FullName
          modifie     = $d.LastWriteTime
          verrouillee = $etat.verrouillee
          archivee    = ($etat.archivee -or $sousArchives)
        }
        if ($entree.archivee) { [void]$livresArchives.Add($entree) }
        else { [void]$livresEnCours.Add($entree) }
      }
    }
  }
}
$livresEnCours = @($livresEnCours | Sort-Object modifie -Descending)
$livresArchives = @($livresArchives | Sort-Object nom -Descending)

# Pas de sortie anticipée quand il n'y a aucun livre : la fenêtre s'ouvre quand même, pour
# offrir « Nouveau livre… » sur un poste vierge.

# ---- Le bloc d'informations, calculé avant la mise en page ----
$lignesInfo = @()
$vInstallee = Get-SzhVersionInstallee
if ($vInstallee) { $lignesInfo += (T 'lanceur.version' @($vInstallee)) }
else { $lignesInfo += (T 'lanceur.version.inconnue') }
$lignesInfo += (T 'lanceur.test.livre' @($emplacements.base))
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
# Hauteur adaptée à l'écran, même calcul qu'open-revue.ps1 : le processus ignore le DPI.
$hauteurUtile = 900
try { $hauteurUtile = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height } catch { }
$hListe = 208
$hArchives = 130
if ($hauteurUtile -lt 560) { $hListe = 96; $hArchives = 60 }
elseif ($hauteurUtile -lt 660) { $hListe = 136; $hArchives = 84 }
elseif ($hauteurUtile -lt 780) { $hListe = 170; $hArchives = 106 }
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
if (($livresEnCours.Count + $livresArchives.Count) -gt 0) { $intro.Text = (T 'lanceur.choisir.livre') }
else { $intro.Text = (T 'lanceur.vide.livre') }
$intro.Location = New-Object System.Drawing.Point(16, 14)
$intro.AutoSize = $true
$form.Controls.Add($intro)

# Cadenas si le livre est verrouillé, comme dans open-revue.ps1.
function Format-SzhLivre($Entree) {
  $etiquette = $Entree.titre
  if (-not $etiquette) { $etiquette = $Entree.nom }
  $texte = (T 'lanceur.modifie.livre' @($etiquette, $Entree.modifie.ToString('dd.MM.yyyy')))
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
foreach ($r in $livresEnCours) { [void]$liste.Items.Add((Format-SzhLivre $r)) }
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
foreach ($r in $livresArchives) { [void]$listeArchives.Items.Add((Format-SzhLivre $r)) }
if ($listeArchives.Items.Count -eq 0) { [void]$listeArchives.Items.Add((T 'lanceur.vide.archives.livre')) }
$form.Controls.Add($listeArchives)

# Une seule sélection à la fois.
$liste.Add_Click({ $listeArchives.ClearSelected() })
$listeArchives.Add_Click({ $liste.ClearSelected() })

$infos.Location = New-Object System.Drawing.Point(16, $yInfos)
$infos.Size = New-Object System.Drawing.Size(488, $hInfos)
$infos.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($infos)

$boutonOk = New-Object System.Windows.Forms.Button
$boutonOk.Text = (T 'lanceur.ouvrir')
$boutonOk.Location = New-Object System.Drawing.Point(318, $yBoutons)
$boutonOk.Size = New-Object System.Drawing.Size(90, 32)
$boutonOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$boutonOk.Enabled = (($livresEnCours.Count + $livresArchives.Count) -gt 0)
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
$boutonVersions.Add_Click({
  if ((Show-SzhVersions $form) -eq $true) {
    $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Close()
  }
})

# ---- « Nouveau livre… » : new-livre.ps1 puis ouverture ----
#
# Un livre n'a pas de « numéro d'une année » : il a un TITRE, une ANNÉE et une RÉFÉRENCE B —
# voir Get-SzhNomLivre dans szh-common.ps1. Le formulaire demande donc ces trois-là, plus le
# type (monographie / ouvrage collectif) et la maquette (normal / FALC, et pour FALC le
# format standard ou A4) — ni volume ni numéro n'ont de sens ici.
#
# Rend $null si annulé, sinon { titre, annee, reference, type, maquette, format, nom }.
function Read-SzhNouveauLivre {
  $anneeDefaut = (Get-Date).Year

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.nouvelle.livre') -replace '…', ''
  $boite.StartPosition = 'CenterParent'
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false
  Set-SzhIconeFenetre $boite

  $xChamp = 140
  $largeurChamp = 260

  $etiqTitre = New-Object System.Windows.Forms.Label
  $etiqTitre.Text = (T 'lanceur.nouvelle.livre.titre')
  $etiqTitre.Location = New-Object System.Drawing.Point(16, 19)
  $etiqTitre.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqTitre)

  $champTitre = New-Object System.Windows.Forms.TextBox
  $champTitre.Location = New-Object System.Drawing.Point($xChamp, 16)
  $champTitre.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champTitre.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $boite.Controls.Add($champTitre)

  $etiqAnnee = New-Object System.Windows.Forms.Label
  $etiqAnnee.Text = (T 'lanceur.nouvelle.annee')
  $etiqAnnee.Location = New-Object System.Drawing.Point(16, 55)
  $etiqAnnee.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqAnnee)

  # NumericUpDown : bornes larges, un livre n'ayant pas de premier volume connu comme une
  # revue (Get-SzhPremiereAnnee ne s'applique qu'aux jetons revue/zeitschrift).
  $champAnnee = New-Object System.Windows.Forms.NumericUpDown
  $champAnnee.Location = New-Object System.Drawing.Point($xChamp, 52)
  $champAnnee.Size = New-Object System.Drawing.Size(110, 28)
  $champAnnee.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champAnnee.Minimum = 1990
  $champAnnee.Maximum = $anneeDefaut + 5
  $champAnnee.Value = $anneeDefaut
  $boite.Controls.Add($champAnnee)

  $etiqRef = New-Object System.Windows.Forms.Label
  $etiqRef.Text = (T 'lanceur.nouvelle.livre.reference')
  $etiqRef.Location = New-Object System.Drawing.Point(16, 91)
  $etiqRef.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqRef)

  # La référence B est un compteur tenu par la rédaction, pas calculé : rien dans buch.yaml
  # ne le dit (il ne vit que dans le nom du dossier), il se saisit donc à la main.
  $champRef = New-Object System.Windows.Forms.NumericUpDown
  $champRef.Location = New-Object System.Drawing.Point($xChamp, 88)
  $champRef.Size = New-Object System.Drawing.Size(110, 28)
  $champRef.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champRef.Minimum = 1
  $champRef.Maximum = 9999
  $champRef.Value = 1
  $boite.Controls.Add($champRef)

  $etiqType = New-Object System.Windows.Forms.Label
  $etiqType.Text = (T 'lanceur.nouvelle.livre.type')
  $etiqType.Location = New-Object System.Drawing.Point(16, 127)
  $etiqType.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqType)

  $champType = New-Object System.Windows.Forms.ComboBox
  $champType.DropDownStyle = 'DropDownList'
  $champType.Location = New-Object System.Drawing.Point($xChamp, 124)
  $champType.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champType.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  [void]$champType.Items.Add((T 'lanceur.nouvelle.livre.type.mono'))
  [void]$champType.Items.Add((T 'lanceur.nouvelle.livre.type.collectif'))
  $champType.SelectedIndex = 0
  $boite.Controls.Add($champType)

  $etiqMaquette = New-Object System.Windows.Forms.Label
  $etiqMaquette.Text = (T 'lanceur.nouvelle.livre.maquette')
  $etiqMaquette.Location = New-Object System.Drawing.Point(16, 163)
  $etiqMaquette.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqMaquette)

  $champMaquette = New-Object System.Windows.Forms.ComboBox
  $champMaquette.DropDownStyle = 'DropDownList'
  $champMaquette.Location = New-Object System.Drawing.Point($xChamp, 160)
  $champMaquette.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champMaquette.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  [void]$champMaquette.Items.Add((T 'lanceur.nouvelle.livre.maquette.normal'))
  [void]$champMaquette.Items.Add((T 'lanceur.nouvelle.livre.maquette.falc'))
  $champMaquette.SelectedIndex = 0
  $boite.Controls.Add($champMaquette)

  $etiqFormat = New-Object System.Windows.Forms.Label
  $etiqFormat.Text = (T 'lanceur.nouvelle.livre.format')
  $etiqFormat.Location = New-Object System.Drawing.Point(16, 199)
  $etiqFormat.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqFormat)

  $champFormat = New-Object System.Windows.Forms.ComboBox
  $champFormat.DropDownStyle = 'DropDownList'
  $champFormat.Location = New-Object System.Drawing.Point($xChamp, 196)
  $champFormat.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champFormat.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  [void]$champFormat.Items.Add((T 'lanceur.nouvelle.livre.format.standard'))
  [void]$champFormat.Items.Add((T 'lanceur.nouvelle.livre.format.a4'))
  $champFormat.SelectedIndex = 0
  # Le format A4 n'existe qu'en FALC (buch.yaml, commentaire de la clé « format ») : hors
  # FALC, le contrôle reste grisé sur « standard » plutôt que de laisser choisir une
  # combinaison que la maquette normale ne sait pas composer.
  $champFormat.Enabled = $false
  $boite.Controls.Add($champFormat)

  $champMaquette.Add_SelectedIndexChanged({
    $estFalc = ($champMaquette.SelectedIndex -eq 1)
    $champFormat.Enabled = $estFalc
    if (-not $estFalc) { $champFormat.SelectedIndex = 0 }
  })

  # Un libellé, pas un champ : le nom du dossier est montré et ne se change pas — même
  # principe que Read-SzhNouveauNumero dans open-revue.ps1.
  $etiqDossier = New-Object System.Windows.Forms.Label
  $etiqDossier.Location = New-Object System.Drawing.Point(16, 236)
  $etiqDossier.Size = New-Object System.Drawing.Size(398, 22)
  $etiqDossier.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
  $boite.Controls.Add($etiqDossier)

  $ou = New-Object System.Windows.Forms.Label
  $ou.AutoSize = $false
  $ou.Width = 398
  $ou.Text = (T 'lanceur.nouvelle.ou' @($encoursLivre))
  $hOu = 46
  try {
    $vouluOu = $ou.GetPreferredSize((New-Object System.Drawing.Size(398, 0))).Height + 8
    if ($vouluOu -gt $hOu) { $hOu = $vouluOu }
  } catch { }
  $ou.Location = New-Object System.Drawing.Point(16, 262)
  $ou.Size = New-Object System.Drawing.Size(398, $hOu)
  $ou.ForeColor = [System.Drawing.Color]::DimGray
  $boite.Controls.Add($ou)

  $yBoutonsBoite = 262 + $hOu + 12
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

  # Le nom du dossier suit le titre et les deux nombres, à chaque frappe.
  $rafraichir = {
    $titreVu = $champTitre.Text.Trim()
    $nomAffiche = ''
    if ($titreVu) {
      $nomAffiche = (Get-SzhNomLivre ([int]$champAnnee.Value) ([int]$champRef.Value) $titreVu)
    }
    $etiqDossier.Text = (T 'lanceur.nouvelle.dossier' @($nomAffiche))
  }
  $champTitre.Add_TextChanged($rafraichir)
  $champAnnee.Add_ValueChanged($rafraichir)
  $champRef.Add_ValueChanged($rafraichir)
  & $rafraichir

  # Les trois refus se font ici, la boîte ouverte : titre manquant, dossier homonyme, ou
  # référence B déjà prise (en cours ou aux archives — un livre archivé reste un livre
  # publié, comme un numéro archivé reste un numéro publié dans open-revue.ps1).
  $okBouton.Add_Click({
    $titreOk = $champTitre.Text.Trim()
    if (-not $titreOk) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.livre.titre.manque'), $titreFenetre)
      $boite.DialogResult = [System.Windows.Forms.DialogResult]::None
      return
    }
    $anneeOk = [int]$champAnnee.Value
    $refOk = [int]$champRef.Value
    $nomOk = Get-SzhNomLivre $anneeOk $refOk $titreOk
    if (Test-Path (Join-Path $encoursLivre $nomOk)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.existe' @($nomOk)), $titreFenetre)
      $boite.DialogResult = [System.Windows.Forms.DialogResult]::None
      return
    }
    $deja = Find-SzhLivreReference $refOk
    if ($deja) {
      $dit = @((T 'lanceur.nouvelle.livre.doublon' @($refOk, $deja.titre, $deja.chemin)))
      if ($deja.archive) { $dit += (T 'lanceur.nouvelle.livre.doublon.arch') }
      $dit += (T 'lanceur.nouvelle.livre.doublon.suite')
      [void][System.Windows.Forms.MessageBox]::Show(($dit -join "`n`n"), $titreFenetre,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
      $boite.DialogResult = [System.Windows.Forms.DialogResult]::None
      return
    }
  })

  if ($boite.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  $typeCode = 'monographie'
  if ($champType.SelectedIndex -eq 1) { $typeCode = 'collectif' }
  $maquetteCode = 'normal'
  if ($champMaquette.SelectedIndex -eq 1) { $maquetteCode = 'falc' }
  $formatCode = 'standard'
  if ($champFormat.SelectedIndex -eq 1) { $formatCode = 'a4' }
  $titreFinal = $champTitre.Text.Trim()
  $anneeFinal = [int]$champAnnee.Value
  $refFinal = [int]$champRef.Value
  return [pscustomobject]@{
    titre     = $titreFinal
    annee     = $anneeFinal
    reference = $refFinal
    type      = $typeCode
    maquette  = $maquetteCode
    format    = $formatCode
    nom       = (Get-SzhNomLivre $anneeFinal $refFinal $titreFinal)
  }
}

$boutonNouvelle = New-Object System.Windows.Forms.Button
$boutonNouvelle.Text = (T 'lanceur.nouvelle.livre')
$boutonNouvelle.Location = New-Object System.Drawing.Point(16, $yBoutons)
$boutonNouvelle.Size = New-Object System.Drawing.Size(130, 32)
$form.Controls.Add($boutonNouvelle)
$boutonNouvelle.Add_Click({
  $neuf = Read-SzhNouveauLivre
  if (-not $neuf) { return }
  $cible = Join-Path $encoursLivre $neuf.nom
  try {
    $parametres = @{
      Dossier   = $cible
      Titre     = $neuf.titre
      Annee     = $neuf.annee
      Reference = $neuf.reference
      Type      = $neuf.type
      Maquette  = $neuf.maquette
      Format    = $neuf.format
    }
    & (Join-Path $PSScriptRoot 'new-livre.ps1') @parametres | Out-Null
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.livre.erreur' @($_.Exception.Message)), $titreFenetre)
    return
  }
  [void](Start-SzhCodium (Resolve-Path $cible).Path)
  $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel   # livre déjà ouvert ci-dessus
  $form.Close()
})

# Double-clic = ouvrir, dans l'une comme dans l'autre liste.
$liste.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
$listeArchives.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })

$resultat = $form.ShowDialog()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK) {
  $choix = $null
  if ($liste.SelectedIndex -ge 0) { $choix = $livresEnCours[$liste.SelectedIndex] }
  elseif (($listeArchives.SelectedIndex -ge 0) -and ($livresArchives.Count -gt 0)) {
    $choix = $livresArchives[$listeArchives.SelectedIndex]
  }
  if ($choix) { [void](Start-SzhCodium $choix.chemin) }
}
