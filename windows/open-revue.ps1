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
  # Ouvre directement le sélecteur de version du logiciel — c'est ce que lance
  # l'avertissement de divergence du cockpit (« Changer de version… », D120) : une
  # seule implémentation du choix de version, atteignable des deux côtés.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$codium = Get-VSCodiumExe
if (-not $codium) {
  [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.codium' @($SzhSupport)), 'Revues SZH')
  exit 1
}

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
  $publiees = @(Get-SzhVersionsPubliees)
  $locales = @(Get-SzhVersionsLocales)
  $horsLigne = ($publiees.Count -eq 0)

  # Publiées d'abord (ordre GitHub = plus récent en tête), puis les versions déjà
  # téléchargées qui n'y sont pas — elles s'installent sans réseau.
  $disponibles = New-Object System.Collections.ArrayList
  foreach ($v in $publiees) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
  foreach ($v in $locales) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
  if ($installee -and (-not $disponibles.Contains($installee))) { [void]$disponibles.Insert(0, $installee) }

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
  foreach ($v in $disponibles) {
    if ($v -eq $installee) { [void]$liVersions.Items.Add((T 'lanceur.versions.installee' @($v))) }
    elseif ($locales -contains $v) { [void]$liVersions.Items.Add((T 'lanceur.versions.locale' @($v))) }
    else { [void]$liVersions.Items.Add($v) }
  }
  if ($liVersions.Items.Count -gt 0) { $liVersions.SelectedIndex = 0 }
  $boite.Controls.Add($liVersions)

  $note = New-Object System.Windows.Forms.Label
  if ($horsLigne) { $note.Text = (T 'lanceur.versions.horsligne') }
  if ($disponibles.Count -eq 0) { $note.Text = (T 'lanceur.versions.vide') }
  $note.Location = New-Object System.Drawing.Point(16, 240)
  $note.Size = New-Object System.Drawing.Size(428, 44)
  $note.ForeColor = [System.Drawing.Color]::DimGray
  $boite.Controls.Add($note)

  $bInstaller = New-Object System.Windows.Forms.Button
  $bInstaller.Text = (T 'lanceur.versions.installer')
  $bInstaller.Location = New-Object System.Drawing.Point(248, 292)
  $bInstaller.Size = New-Object System.Drawing.Size(96, 32)
  $bInstaller.Enabled = ($disponibles.Count -gt 0)
  $boite.Controls.Add($bInstaller)

  $bFermer = New-Object System.Windows.Forms.Button
  $bFermer.Text = (T 'lanceur.annuler')
  $bFermer.Location = New-Object System.Drawing.Point(350, 292)
  $bFermer.Size = New-Object System.Drawing.Size(94, 32)
  $bFermer.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $boite.Controls.Add($bFermer)
  $boite.CancelButton = $bFermer

  $bInstaller.Add_Click({
    if ($liVersions.SelectedIndex -lt 0) { return }
    $choix = [string]$disponibles[$liVersions.SelectedIndex]
    $reponse = [System.Windows.Forms.MessageBox]::Show(
      (T 'lanceur.versions.avert' @($choix)), (T 'lanceur.versions.titre'),
      [System.Windows.Forms.MessageBoxButtons]::OKCancel,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($reponse -ne [System.Windows.Forms.DialogResult]::OK) { return }
    # update.ps1 sait déjà tout faire (et ne demande jamais l'administrateur, D3) :
    # fenêtre visible, étapes nommées, rollback depuis l'archive de staging si elle
    # est encore là. On le lance tel quel, sur la version demandée.
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      ('"{0}"' -f (Join-Path $PSScriptRoot 'update.ps1')), '-Version', $choix)
    $boite.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $boite.Close()
  })

  if ($Parent) { [void]$boite.ShowDialog($Parent) } else { [void]$boite.ShowDialog() }
}

if ($Versions) { Show-SzhVersions $null; exit 0 }

# ---- Racines à scanner ---------------------------------------------------------
#
# Les quatre emplacements « en cours »/archives (D116, mode test compris D119), plus
# les racines historiques de config.json et OneDrive\Revues : un poste qui a des
# revues hors de l'arborescence officielle continue de les voir.
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
$cfg = Get-SzhConfig
if ($cfg -and $cfg.revuesRoots) {
  foreach ($r in $cfg.revuesRoots) {
    [void]$racines.Add([Environment]::ExpandEnvironmentVariables([string]$r))
  }
}
if ($env:OneDrive) { [void]$racines.Add((Join-Path $env:OneDrive 'Revues')) }

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
$form.Text = 'Revues SZH'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(520, 560)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$intro = New-Object System.Windows.Forms.Label
if (($revuesEnCours.Count + $revuesArchivees.Count) -gt 0) { $intro.Text = (T 'lanceur.choisir') }
else { $intro.Text = (T 'lanceur.vide') }
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
$liste.Location = New-Object System.Drawing.Point(16, 66)
$liste.Size = New-Object System.Drawing.Size(488, 208)
$liste.Font = New-Object System.Drawing.Font('Segoe UI', 11)
foreach ($r in $revuesEnCours) { [void]$liste.Items.Add((Format-SzhRevue $r)) }
if ($liste.Items.Count -gt 0) { $liste.SelectedIndex = 0 }
$form.Controls.Add($liste)

$etiqArchives = New-Object System.Windows.Forms.Label
$etiqArchives.Text = (T 'lanceur.archives')
$etiqArchives.Location = New-Object System.Drawing.Point(16, 284)
$etiqArchives.AutoSize = $true
$form.Controls.Add($etiqArchives)

$listeArchives = New-Object System.Windows.Forms.ListBox
$listeArchives.Location = New-Object System.Drawing.Point(16, 306)
$listeArchives.Size = New-Object System.Drawing.Size(488, 130)
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
$infos.Text = ($lignesInfo -join '     ')
$infos.Location = New-Object System.Drawing.Point(16, 446)
$infos.Size = New-Object System.Drawing.Size(488, 44)
$infos.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($infos)

$boutonOk = New-Object System.Windows.Forms.Button
$boutonOk.Text = (T 'lanceur.ouvrir')
$boutonOk.Location = New-Object System.Drawing.Point(318, 500)
$boutonOk.Size = New-Object System.Drawing.Size(90, 32)
$boutonOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$boutonOk.Enabled = (($revuesEnCours.Count + $revuesArchivees.Count) -gt 0)
$form.Controls.Add($boutonOk)
$form.AcceptButton = $boutonOk

$boutonNon = New-Object System.Windows.Forms.Button
$boutonNon.Text = (T 'lanceur.annuler')
$boutonNon.Location = New-Object System.Drawing.Point(414, 500)
$boutonNon.Size = New-Object System.Drawing.Size(90, 32)
$boutonNon.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($boutonNon)
$form.CancelButton = $boutonNon

$boutonVersions = New-Object System.Windows.Forms.Button
$boutonVersions.Text = (T 'lanceur.versions.bouton')
$boutonVersions.Location = New-Object System.Drawing.Point(152, 500)
$boutonVersions.Size = New-Object System.Drawing.Size(160, 32)
$form.Controls.Add($boutonVersions)
$boutonVersions.Add_Click({ Show-SzhVersions $form })

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
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.invalide'), 'Revues SZH')
    return $null
  }
  return $nom
}

$boutonNouvelle = New-Object System.Windows.Forms.Button
$boutonNouvelle.Text = (T 'lanceur.nouvelle')
$boutonNouvelle.Location = New-Object System.Drawing.Point(16, 500)
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
  if (Test-Path $emplacements.revue.encours) { $defaut = $emplacements.revue.encours }
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
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.erreur' @($_.Exception.Message)), 'Revues SZH')
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
