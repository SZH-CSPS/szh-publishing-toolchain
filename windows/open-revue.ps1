<#
.SYNOPSIS
  Lanceur « Revues SZH » (raccourci du menu Démarrer, via hidden.vbs -> pas de console).
  Liste toutes les revues trouvées (dossiers contenant ausgabe.yaml sous les racines
  connues, OneDrive\Revues par défaut) et ouvre la sélection dans VSCodium (D14).

  Compatibilité : Windows PowerShell 5.1.
#>
. "$PSScriptRoot\szh-common.ps1"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---- Racines à scanner ---------------------------------------------------------
$racines = New-Object System.Collections.ArrayList
$cfg = Get-SzhConfig
if ($cfg -and $cfg.revuesRoots) {
  foreach ($r in $cfg.revuesRoots) {
    [void]$racines.Add([Environment]::ExpandEnvironmentVariables([string]$r))
  }
}
if ($env:OneDrive) { [void]$racines.Add((Join-Path $env:OneDrive 'Revues')) }

# ---- Découverte des revues (dossier contenant ausgabe.yaml) ---------------------
$revues = New-Object System.Collections.ArrayList
$vus = @{}
foreach ($racine in $racines) {
  if (-not $racine) { continue }
  if (-not (Test-Path $racine)) { continue }
  Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_
    if (Test-Path (Join-Path $d.FullName 'ausgabe.yaml')) {
      $cle = $d.FullName.ToLower()
      if (-not $vus.ContainsKey($cle)) {
        $vus[$cle] = $true
        [void]$revues.Add($d)
      }
    }
  }
}
$revues = @($revues | Sort-Object LastWriteTime -Descending)

# G2 (D38) : plus de sortie anticipée quand aucune revue n'existe — la fenêtre
# s'ouvre quand même pour offrir « Nouvelle revue… » (poste vierge / pilote).

$codium = Get-VSCodiumExe
if (-not $codium) {
  [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.codium' @($SzhSupport)), 'Revues SZH')
  exit 1
}

# ---- Fenêtre de sélection --------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Revues SZH'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(440, 380)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$intro = New-Object System.Windows.Forms.Label
if ($revues.Count -gt 0) { $intro.Text = (T 'lanceur.choisir') } else { $intro.Text = (T 'lanceur.vide') }
$intro.Location = New-Object System.Drawing.Point(16, 14)
$intro.AutoSize = $true
$form.Controls.Add($intro)

$liste = New-Object System.Windows.Forms.ListBox
$liste.Location = New-Object System.Drawing.Point(16, 40)
$liste.Size = New-Object System.Drawing.Size(408, 270)
$liste.Font = New-Object System.Drawing.Font('Segoe UI', 11)
foreach ($r in $revues) {
  [void]$liste.Items.Add((T 'lanceur.modifie' @($r.Name, $r.LastWriteTime.ToString('dd.MM.yyyy'))))
}
if ($liste.Items.Count -gt 0) { $liste.SelectedIndex = 0 }
$form.Controls.Add($liste)

$boutonOk = New-Object System.Windows.Forms.Button
$boutonOk.Text = (T 'lanceur.ouvrir')
$boutonOk.Location = New-Object System.Drawing.Point(238, 326)
$boutonOk.Size = New-Object System.Drawing.Size(90, 32)
$boutonOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$boutonOk.Enabled = ($revues.Count -gt 0)
$form.Controls.Add($boutonOk)
$form.AcceptButton = $boutonOk

$boutonNon = New-Object System.Windows.Forms.Button
$boutonNon.Text = (T 'lanceur.annuler')
$boutonNon.Location = New-Object System.Drawing.Point(334, 326)
$boutonNon.Size = New-Object System.Drawing.Size(90, 32)
$boutonNon.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($boutonNon)
$form.CancelButton = $boutonNon

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
$boutonNouvelle.Location = New-Object System.Drawing.Point(16, 326)
$boutonNouvelle.Size = New-Object System.Drawing.Size(130, 32)
$form.Controls.Add($boutonNouvelle)
$boutonNouvelle.Add_Click({
  # 1) Dossier parent (OneDrive\Revues proposé par défaut), 2) nom du dossier.
  $dossierDlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dossierDlg.Description = (T 'lanceur.nouvelle.dossier')
  $dossierDlg.ShowNewFolderButton = $true
  if ($env:OneDrive) {
    $racineDefaut = Join-Path $env:OneDrive 'Revues'
    if (Test-Path $racineDefaut) { $dossierDlg.SelectedPath = $racineDefaut }
  }
  if ($dossierDlg.ShowDialog($form) -ne [System.Windows.Forms.DialogResult]::OK) { return }
  $nom = Read-SzhNomRevue
  if (-not $nom) { return }
  $cible = Join-Path $dossierDlg.SelectedPath $nom
  try {
    # new-revue.ps1 : scaffold depuis le template + « Ouvrir la revue.lnk » +
    # enregistrement de la racine pour ce lanceur (source unique, D38).
    & (Join-Path $PSScriptRoot 'new-revue.ps1') -Dossier $cible | Out-Null
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.erreur' @($_.Exception.Message)), 'Revues SZH')
    return
  }
  Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f (Resolve-Path $cible).Path)
  $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel   # revue déjà ouverte ci-dessus
  $form.Close()
})

# Double-clic = ouvrir
$liste.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })

$resultat = $form.ShowDialog()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK -and $liste.SelectedIndex -ge 0) {
  $choix = $revues[$liste.SelectedIndex]
  Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f $choix.FullName)
}
