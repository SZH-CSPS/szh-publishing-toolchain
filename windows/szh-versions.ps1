# ---- Sélecteur de version du logiciel ----
# Appelé par le seul open-produit.ps1 (bouton « Changer de version… » et -Versions), qui
# dot-source ce fichier : le socle (szh-common.ps1) est chargé par des scripts sans fenêtre et
# n'a pas à porter un sélecteur WinForms. Recomposer un ancien numéro à l'identique suppose de
# réinstaller la version qui l'a fabriqué ; `update.ps1 -Version X` sait le faire, ce dialogue
# le rend atteignable, et explicitement : le changement remplace le rootfs WSL et les
# extensions, et demande un redémarrage de l'éditeur.
#
# $Parent : fenêtre appelante, ou $null en processus détaché (le sélecteur ouvert seul, hors
# du lanceur). $FichierIcone : icône de ce lanceur (szh-revue.ico, szh-zeitschrift.ico ou
# szh-livre.ico) — chaque produit garde la sienne, cette fonction ne décide donc pas d'icône
# elle-même. Chargée en tableau d'octets et non par nom de fichier : Icon(String) garderait
# le .ico ouvert tant que la fenêtre vit, et une mise à jour concurrente ne pourrait pas le
# remplacer. Ne lève jamais, une icône n'étant pas une condition d'ouverture.
function Show-SzhVersions($Parent, [string]$FichierIcone) {
  $installee = Get-SzhVersionInstallee
  # Aucun appel réseau ici : la liste est remplie au Shown, plus bas ; le faire avant
  # l'affichage fige la fenêtre jusqu'au bout du timeout.
  $locales = @(Select-SzhVersionsProposables (Get-SzhVersionsLocales))
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

  # La liste se remplit après l'affichage : la fenêtre est là tout de suite, et l'attente
  # réseau se voit au lieu de figer l'interface.
  $boite.Add_Shown({
    $boite.Refresh()
    # Le réseau d’abord, le filtre ensuite : c’est « GitHub a-t-il répondu ? » qui décide du
    # message hors ligne, plus bas, et non « reste-t-il quelque chose après le filtre ».
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
    # La ligne présélectionnée est la première qui changerait quelque chose. La version
    # installée ouvre la liste quand elle n’y figure pas — elle dit où l’on en est —, mais
    # la réinstaller n’est pas le geste qu’on vient chercher ici. Le cas est devenu la règle
    # au passage à 1.0.0 : toutes les versions d’avant s’insèrent ainsi, sans jamais être
    # proposables, et le bouton « Installer » aurait proposé de ne rien faire.
    $premier = 0
    if (($disponibles.Count -gt 1) -and ($disponibles[0] -eq $installee)) { $premier = 1 }
    if ($liVersions.Items.Count -gt 0) { $liVersions.SelectedIndex = $premier }
    # Trois états à nommer : liste complète, hors ligne avec un repli réel, hors ligne
    # sans repli (seule la version installée, donc rien à installer).
    if ($publieesBrutes.Count -gt 0) { $note.Text = (T 'lanceur.versions.note') }
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
    Write-SzhLog ('Show-SzhVersions : installation de la version ' + $choix + ' demandee')
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
