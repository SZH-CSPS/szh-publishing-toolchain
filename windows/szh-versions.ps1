# ---- Sélecteur de version du logiciel ----
# Chargé par open-revue.ps1 -Versions (bouton « Changer de version… » du cockpit). Il sert à
# réinstaller une version précise, par exemple pour recomposer un ancien numéro à
# l'identique, en lançant `update.ps1 -Version X`. Le changement remplace le rootfs WSL et
# les extensions, et demande de redémarrer l'éditeur.
#
# $Parent : fenêtre appelante, ou $null quand le sélecteur est ouvert seul. $FichierIcone :
# icône de la fenêtre. Elle est chargée en octets : Icon(String) garderait le .ico ouvert et
# empêcherait une mise à jour de le remplacer. Une icône qui ne se charge pas n'empêche pas
# l'ouverture.
# Rend $true si une installation a été lancée : l'appelant doit alors se retirer.
function Show-SzhVersions($Parent, [string]$FichierIcone) {
  $installee = Get-SzhVersionInstallee
  # Les versions publiées (réseau) se chargent après l'affichage, au Shown.
  $locales = @(Select-SzhVersionsProposables (Get-SzhVersionsLocales))
  $disponibles = New-Object System.Collections.ArrayList

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.versions.titre')
  if ($Parent) { $boite.StartPosition = 'CenterParent' } else { $boite.StartPosition = 'CenterScreen' }
  $boite.ClientSize = New-Object System.Drawing.Size(460, 340)
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false
  # La boîte peut s'ouvrir seule : elle a alors son propre bouton de barre des tâches.
  if ($FichierIcone -and (Test-Path $FichierIcone)) {
    try {
      $flux = New-Object System.IO.MemoryStream (,[System.IO.File]::ReadAllBytes($FichierIcone))
      $boite.Icon = New-Object System.Drawing.Icon $flux
    } catch {
      Write-SzhLog ('Show-SzhVersions : icone non chargee (' + $_.Exception.Message + ')')
    }
  }

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

  # La liste se remplit après l'affichage, pour que l'attente réseau ne fige pas la fenêtre.
  $boite.Add_Shown({
    $boite.Refresh()
    # Le message hors ligne dépend de la réponse de GitHub avant filtrage.
    $publieesBrutes = @(Get-SzhVersionsPubliees)
    $publiees = @(Select-SzhVersionsProposables $publieesBrutes)
    foreach ($v in $publiees) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
    foreach ($v in $locales) { if (-not $disponibles.Contains($v)) { [void]$disponibles.Add($v) } }
    if ($installee -and (-not $disponibles.Contains($installee))) { [void]$disponibles.Insert(0, $installee) }
    foreach ($v in $disponibles) {
      if ($v -eq $installee) { [void]$liVersions.Items.Add((T 'lanceur.versions.installee' @($v))) }
      elseif ($locales -contains $v) { [void]$liVersions.Items.Add((T 'lanceur.versions.locale' @($v))) }
      else { [void]$liVersions.Items.Add($v) }
    }
    # La version installée est ajoutée en tête si elle manque, pour situer l'utilisateur ;
    # la présélection porte sur la première ligne qui changerait quelque chose.
    $premier = 0
    if (($disponibles.Count -gt 1) -and ($disponibles[0] -eq $installee)) { $premier = 1 }
    if ($liVersions.Items.Count -gt 0) { $liVersions.SelectedIndex = $premier }
    # Trois cas : liste complète ; hors ligne avec des versions locales ; hors ligne avec la
    # seule version installée.
    if ($publieesBrutes.Count -gt 0) { $note.Text = (T 'lanceur.versions.note') }
    elseif ($locales.Count -gt 0) { $note.Text = (T 'lanceur.versions.horsligne') }
    else { $note.Text = (T 'lanceur.versions.horsligne.deja') }
    if ($disponibles.Count -eq 0) { $note.Text = (T 'lanceur.versions.vide') }
    $bInstaller.Enabled = ($disponibles.Count -gt 0)
  })

  $bInstaller.Add_Click({
    if ($liVersions.SelectedIndex -lt 0) { return }
    $choix = [string]$disponibles[$liVersions.SelectedIndex]
    # La valeur peut venir d'un nom de fichier et part en argument d'update.ps1 : on vérifie
    # sa forme, pour que « 2026.08.0 -Verbose » ne puisse pas y glisser un paramètre.
    if (-not (Test-SzhVersionTag $choix)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.versions.vide'), (T 'lanceur.versions.titre'))
      return
    }
    $reponse = [System.Windows.Forms.MessageBox]::Show(
      (T 'lanceur.versions.avert' @($choix)), (T 'lanceur.versions.titre'),
      [System.Windows.Forms.MessageBoxButtons]::OKCancel,
      [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($reponse -ne [System.Windows.Forms.DialogResult]::OK) { return }
    # update.ps1 fait le reste, sans administrateur. Arguments entre guillemets : le chemin
    # du toolkit contient des espaces.
    Write-SzhLog ('Show-SzhVersions : installation de la version ' + $choix + ' demandee')
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      ('"{0}"' -f (Join-Path $PSScriptRoot 'update.ps1')), '-Version', ('"{0}"' -f $choix))
    $boite.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $boite.Close()
  })

  # Sans parent, la boîte est forcée au premier plan : ouverte derrière VSCodium, on
  # croirait que le bouton n'a rien fait.
  $resultat = [System.Windows.Forms.DialogResult]::Cancel
  if ($Parent) { $resultat = $boite.ShowDialog($Parent) }
  else {
    $boite.TopMost = $true
    $resultat = $boite.ShowDialog()
  }
  return ($resultat -eq [System.Windows.Forms.DialogResult]::OK)
}
