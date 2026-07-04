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

if ($revues.Count -eq 0) {
  [void][System.Windows.Forms.MessageBox]::Show(
    ("Aucune revue trouvée.`n`nVérifiez que le dossier OneDrive\Revues est bien synchronisé," +
     "`nou demandez la création d'une revue (" + $SzhSupport + ")."),
    'Revues SZH')
  exit 0
}

$codium = Get-VSCodiumExe
if (-not $codium) {
  [void][System.Windows.Forms.MessageBox]::Show(
    ('L''éditeur VSCodium est introuvable sur ce poste. Contact : ' + $SzhSupport), 'Revues SZH')
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
$intro.Text = 'Choisissez la revue à ouvrir :'
$intro.Location = New-Object System.Drawing.Point(16, 14)
$intro.AutoSize = $true
$form.Controls.Add($intro)

$liste = New-Object System.Windows.Forms.ListBox
$liste.Location = New-Object System.Drawing.Point(16, 40)
$liste.Size = New-Object System.Drawing.Size(408, 270)
$liste.Font = New-Object System.Drawing.Font('Segoe UI', 11)
foreach ($r in $revues) {
  [void]$liste.Items.Add(('{0}    (modifiée le {1})' -f $r.Name, $r.LastWriteTime.ToString('dd.MM.yyyy')))
}
$liste.SelectedIndex = 0
$form.Controls.Add($liste)

$boutonOk = New-Object System.Windows.Forms.Button
$boutonOk.Text = 'Ouvrir'
$boutonOk.Location = New-Object System.Drawing.Point(238, 326)
$boutonOk.Size = New-Object System.Drawing.Size(90, 32)
$boutonOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($boutonOk)
$form.AcceptButton = $boutonOk

$boutonNon = New-Object System.Windows.Forms.Button
$boutonNon.Text = 'Annuler'
$boutonNon.Location = New-Object System.Drawing.Point(334, 326)
$boutonNon.Size = New-Object System.Drawing.Size(90, 32)
$boutonNon.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($boutonNon)
$form.CancelButton = $boutonNon

# Double-clic = ouvrir
$liste.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })

$resultat = $form.ShowDialog()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK -and $liste.SelectedIndex -ge 0) {
  $choix = $revues[$liste.SelectedIndex]
  Start-Process -FilePath $codium -ArgumentList ('"{0}"' -f $choix.FullName)
}
