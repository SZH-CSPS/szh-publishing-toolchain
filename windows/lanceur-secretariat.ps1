# L'onglet « Export et secretariat » du lanceur : quatre exports pilotes par secretariat-cli.js,
# livre dans l'extension du cockpit et execute par le Node qu'embarque VSCodium (pas un
# Node du poste, pas WSL -- Robin a tranche pour un seul moteur de rendu dans tout le
# produit, le JS). Ce fichier ne fait que le dialogue : choix du ou des numeros (filtres par
# le combo Revue/Zeitschrift de l'onglet), dossier de sortie, suivi ligne a ligne du script
# pendant qu'il tourne -- avec une barre de progression et un bouton d'interruption, parce
# qu'un moissonnage OJS peut prendre plusieurs dizaines de secondes (mesure du 15.09.2026).
# Les quatre gestes se ressemblent (meme processus, JSON sur stdout, dossier de sortie
# demande a chaque fois) : une seule fonction, Invoke-SzhSecretariat, fait tout le dialogue
# avec le processus (lecture non bloquante, progression, annulation comprises), et une
# seule boite (Show-SzhBoiteExportOjs) sert aux deux exports CSV qui ne different que par
# leur commande.
#
# Dot-source par open-produit.ps1, qui appelle New-SzhPageSecretariat avec un contexte
# explicite (voir la fonction). Les gestionnaires d'evenements tournent apres le retour de
# cette fonction : ils lisent le contexte et l'etat de l'onglet dans la portee du script
# ($script:ctxSecretariat, $script:journalSecretariat...), jamais dans les locales de la
# fonction. Add-SzhLigneJournal et Add-SzhEnteteJournal, communes avec l'onglet
# Preprocessing, restent dans open-produit.ps1.
#
# Comme « Journal » et « Reglages » : pas un produit, .Tag reste vide, « Ouvrir » n'a rien a
# ouvrir ici.

# Le seul appelant de secretariat-cli.js. Le lance avec le VSCodium DEJA resolu plus haut
# (Contexte.Codium ; le lanceur se serait deja arrete si l'editeur manquait) et
# ELECTRON_RUN_AS_NODE=1 -- sans cette variable, VSCodium.exe ouvre une fenetre d'editeur
# au lieu d'executer le script. Grise les quatre boutons de l'onglet et pose le sablier
# pendant que le processus tourne (les rallume dans le finally, quelle que soit l'issue),
# et pilote en prime la barre de progression et le bouton "Interrompre" de LA SURFACE
# APPELANTE (onglet ou boite d'export CSV -- chacune porte les siens, voir plus bas) si on
# les lui passe.
#
# Mesure du 15.09.2026 : une page OAI-PMH de 100 notices prend 4,6 s, la Zeitschrift en
# compte 7 -> ~32 s bloquant tout entiers avec l'ancien ReadLine(). Invoke-SzhNodeCockpit
# (szh-shell.ps1) lit donc stdout ligne à ligne sans bloquer l'interface et teste au passage
# le drapeau d'annulation ($EtatAnnulation, une table de hachage et non une variable simple :
# une fermeture ne réassigne pas une variable simple -- voir $etatBoiteOjs plus bas). Chaque
# ligne reçue est décodée comme du JSON par $surLigne, qui s'exécute dans une portée fille :
# il écrit dans $etat et les listes, jamais dans une variable. etape/avert vont dans le
# journal, progres met à jour la barre, numero et fichier s'accumulent, fin mémorise
# l'issue. Une ligne qui n'est pas du JSON valide s'affiche telle quelle plutôt que de faire
# tomber le lanceur. stderr n'est affiché que si le code de sortie n'est pas nul (une
# annulation ne le lit pas : le texte affiché doit rester "Export interrompu.", pas une
# sortie de processus tué).
function Invoke-SzhSecretariat {
  param(
    [Parameter(Mandatory = $true)][string]$Commande,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory = $true)]$Journal,
    [string]$DossierSortie = '',
    [string]$NomExport = '',
    $BarreProgression = $null,
    $BoutonInterrompre = $null,
    $EtatAnnulation = $null
  )
  Add-SzhEnteteJournal $Journal $NomExport
  foreach ($boutonGrise in $script:secretariatBoutons) { $boutonGrise.Enabled = $false }
  $script:ctxSecretariat.Form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  if ($BarreProgression) {
    $BarreProgression.Style = 'Marquee'
    $BarreProgression.MarqueeAnimationSpeed = 30
    $BarreProgression.Value = 0
  }
  if ($BoutonInterrompre) { $BoutonInterrompre.Enabled = $true }
  if ($EtatAnnulation) { $EtatAnnulation.annule = $false }
  $numerosRecus = New-Object System.Collections.ArrayList
  $fichiersRecus = New-Object System.Collections.ArrayList
  $dossierRendu = ''
  $dossierGabarits = ''
  $ok = $false
  $texteFin = ''
  try {
    if (-not $script:ctxSecretariat.Codium) { throw (T 'lanceur.codium' @($SzhSupport)) }
    $etat = @{ ok = $false; texte = ''; gabarits = ''; dossier = '' }
    $surLigne = {
      param($texteLigne)
      $objetJson = $null
      try { $objetJson = $texteLigne | ConvertFrom-Json -ErrorAction Stop } catch { $objetJson = $null }
      if ($objetJson -and $objetJson.t) {
        switch ([string]$objetJson.t) {
          'etape'   { Add-SzhLigneJournal $Journal ([string]$objetJson.texte) }
          'avert'   { Add-SzhLigneJournal $Journal ([string]$objetJson.texte) }
          'numero'  { [void]$numerosRecus.Add($objetJson) }
          'fichier' {
            [void]$fichiersRecus.Add($objetJson)
            if ($DossierSortie) { $etat.dossier = $DossierSortie }
          }
          'fin'     {
            $etat.ok = [bool]$objetJson.ok
            $etat.texte = [string]$objetJson.texte
            $etat.gabarits = [string]$objetJson.gabarits
          }
          'progres' {
            # total = 0 : total inconnu, la barre reste en Marquee. Sinon elle passe en
            # Continuous des la premiere ligne qui donne un total.
            if ($BarreProgression) {
              $totalProgres = 0
              try { $totalProgres = [int]$objetJson.total } catch { $totalProgres = 0 }
              if ($totalProgres -gt 0) {
                if ($BarreProgression.Style -ne 'Continuous' -or $BarreProgression.Maximum -ne $totalProgres) {
                  $BarreProgression.Style = 'Continuous'
                  $BarreProgression.Maximum = $totalProgres
                }
                $faitProgres = 0
                try { $faitProgres = [int]$objetJson.fait } catch { $faitProgres = 0 }
                if ($faitProgres -lt 0) { $faitProgres = 0 }
                if ($faitProgres -gt $totalProgres) { $faitProgres = $totalProgres }
                $BarreProgression.Value = $faitProgres
              }
            }
          }
          default   { Add-SzhLigneJournal $Journal $texteLigne }
        }
      } else {
        Add-SzhLigneJournal $Journal $texteLigne
      }
    }
    $reponse = Invoke-SzhNodeCockpit -Outil 'secretariat-cli.js' -Codium $script:ctxSecretariat.Codium -Arguments (@($Commande) + $Arguments) -SurLigne $surLigne -EtatAnnulation $EtatAnnulation -MessageAbsent (T 'lanceur.secretariat.outil.absent')
    $ok = $etat.ok
    $texteFin = $etat.texte
    $dossierGabarits = $etat.gabarits
    if ($etat.dossier) { $dossierRendu = $etat.dossier }
    if ($reponse.Annule) {
      $ok = $false
      $texteFin = (T 'lanceur.secretariat.interrompu')
    } elseif ($reponse.CodeSortie -ne 0) {
      $erreurStd = $reponse.Erreur
      if ($erreurStd -and $erreurStd.Trim()) { Add-SzhLigneJournal $Journal $erreurStd.Trim() }
      $ok = $false
    }
  } catch {
    $ok = $false
    $texteFin = $_.Exception.Message
    Add-SzhLigneJournal $Journal $texteFin
  } finally {
    $script:ctxSecretariat.Form.Cursor = [System.Windows.Forms.Cursors]::Default
    foreach ($boutonRallume in $script:secretariatBoutons) { $boutonRallume.Enabled = $true }
    if ($BarreProgression) {
      $BarreProgression.Style = 'Marquee'
      $BarreProgression.MarqueeAnimationSpeed = 0
      $BarreProgression.Value = 0
    }
    if ($BoutonInterrompre) { $BoutonInterrompre.Enabled = $false }
  }
  return [pscustomobject]@{
    ok       = $ok
    texte    = $texteFin
    numeros  = @($numerosRecus)
    fichiers = @($fichiersRecus)
    dossier  = $dossierRendu
    gabarits = $dossierGabarits
  }
}

# Affiche l'issue d'un export dans le journal, et n'active « Ouvrir le dossier » que si tout
# s'est bien passe -- un ok:false le dit clairement et n'ouvre jamais de dossier. Le dossier
# des gabarits ($Resultat.gabarits, ligne JSON "fin" du script Node) n'est plus affiche ici :
# Robin n'en a que faire -- mais le champ continue d'arriver, au cas ou un diagnostic futur
# en ait besoin.
function Show-SzhResultatSecretariat($Resultat) {
  if ($Resultat.ok) {
    if ($Resultat.texte) {
      Add-SzhLigneJournal $script:journalSecretariat (T 'lanceur.secretariat.resultat.ok' @($Resultat.texte))
    }
    if ($Resultat.dossier) {
      $script:secretariatDossierCourant = $Resultat.dossier
      $script:boutonSecretariatDossier.Enabled = $true
      if ($Resultat.fichiers.Count -gt 0) {
        Add-SzhLigneJournal $script:journalSecretariat (T 'lanceur.secretariat.resultat.enregistre' @($Resultat.dossier))
      }
    }
  } else {
    $texteEchecAffiche = $Resultat.texte
    if (-not $texteEchecAffiche) { $texteEchecAffiche = (T 'lanceur.secretariat.echec.inconnu') }
    Add-SzhLigneJournal $script:journalSecretariat (T 'lanceur.secretariat.resultat.echec' @($texteEchecAffiche))
  }
}

# Le dossier de sortie : redemande a CHAQUE export, jamais retenu d'une fois sur l'autre --
# decision du cahier des charges. Rend $null si annule.
function Get-SzhDossierSortieChoisi {
  $boiteDossier = New-Object System.Windows.Forms.FolderBrowserDialog
  $boiteDossier.Description = (T 'lanceur.secretariat.dossier.demande')
  $boiteDossier.ShowNewFolderButton = $true
  if ($boiteDossier.ShowDialog($script:ctxSecretariat.Form) -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
  return $boiteDossier.SelectedPath
}

# La boite commune a l'export Edudoc et a « Caracteres par article » -- ils ne different que
# par leur titre et leur commande, ecrite UNE fois ici plutot que deux. $JetonRevue vient
# desormais du filtre de l'onglet (plus de choix Revue/Zeitschrift ICI : un seul endroit
# decide, voir la construction de l'onglet plus bas) -- une simple etiquette figee le
# rappelle. Un bouton qui charge les numeros dans un cache temporaire (JSON, $env:TEMP) et
# remplit la CheckedListBox, un OK qui n'est actif que si au moins un numero est coche. Le
# meme fichier de cache sert ensuite a la commande finale ; il n'est efface qu'a la toute
# fin, que l'export ait eu lieu ou que la boite ait ete annulee.
#
# Chargement = la requete OAI-PMH qui se fige (mesure du 15.09.2026, voir Invoke-
# SzhSecretariat) : c'est elle qui a SA PROPRE zone de messages, sa propre barre de
# progression et son propre bouton "Interrompre" -- Robin regarde CETTE boite pendant le
# chargement, pas le journal de l'onglet, cache derriere la boite modale. L'export final
# (apres OK), lui, tourne une fois la boite refermee : il continue d'ecrire dans le journal
# de l'onglet, avec la barre et le bouton de l'onglet.
#
# Le premier bouton ne charge plus que l'annee EN COURS (--depuis-annee) : 20 a 41 s de
# moisson complete contre 3 a 5 s pour une seule annee (meme mesure du 15.09.2026). Un
# second bouton, « Charger aussi <annee-1> », remonte d'une annee a la fois -- chaque clic
# REJOUE la liste entiere (le contrat de numeros-ojs --depuis-annee n'est pas cumulatif,
# une annee plus basse ramene deja un sur-ensemble complet), jamais une fusion. $etatBoiteOjs
# tient l'annee plancher courante et le nombre de numeros du dernier chargement ; un
# chargement qui n'en ramene pas plus que le precedent dit qu'il n'y a plus rien de plus
# ancien, et grise le second bouton pour de bon -- sans jamais coder d'annee limite en dur.
function Show-SzhBoiteExportOjs([string]$Titre, [string]$Commande, [string]$JetonRevue) {
  $cacheTemp = Join-Path $env:TEMP ('szh-secretariat-' + [guid]::NewGuid().ToString('N') + '.json')
  $anneeCouranteOjs = (Get-Date).Year
  try {
    $boite = New-Object System.Windows.Forms.Form
    $boite.Text = $Titre
    $boite.StartPosition = 'CenterParent'
    $boite.FormBorderStyle = 'FixedDialog'
    $boite.MaximizeBox = $false
    $boite.MinimizeBox = $false
    $boite.ClientSize = New-Object System.Drawing.Size(420, 470)
    Set-SzhIconeFenetre $boite

    $etiqRevueOjs = New-Object System.Windows.Forms.Label
    $etiqRevueOjs.Text = (T 'lanceur.secretariat.export.revue' @($SzhProduits[$JetonRevue].onglet))
    $etiqRevueOjs.Location = New-Object System.Drawing.Point(16, 16)
    $etiqRevueOjs.AutoSize = $true
    $boite.Controls.Add($etiqRevueOjs)

    $boutonChargerOjs = New-Object System.Windows.Forms.Button
    $boutonChargerOjs.Text = (T 'lanceur.secretariat.export.charger' @([string]$anneeCouranteOjs))
    $boutonChargerOjs.Location = New-Object System.Drawing.Point(16, 44)
    $boutonChargerOjs.Size = New-Object System.Drawing.Size(200, 28)
    $boite.Controls.Add($boutonChargerOjs)

    # Reste de la rangee (la boite fait 420 de large, les contrôles vont jusqu'a x=404) :
    # inactif tant qu'aucun chargement n'a eu lieu, personne n'a encore d'annee plancher a
    # etendre.
    $boutonChargerPlusOjs = New-Object System.Windows.Forms.Button
    $boutonChargerPlusOjs.Text = (T 'lanceur.secretariat.export.charger.plus' @([string]($anneeCouranteOjs - 1)))
    $boutonChargerPlusOjs.Location = New-Object System.Drawing.Point(224, 44)
    $boutonChargerPlusOjs.Size = New-Object System.Drawing.Size(180, 28)
    $boutonChargerPlusOjs.Enabled = $false
    $boite.Controls.Add($boutonChargerPlusOjs)

    $etiqNumerosOjs = New-Object System.Windows.Forms.Label
    $etiqNumerosOjs.Text = (T 'lanceur.secretariat.export.instructions')
    $etiqNumerosOjs.Location = New-Object System.Drawing.Point(16, 80)
    $etiqNumerosOjs.AutoSize = $true
    $boite.Controls.Add($etiqNumerosOjs)

    $listeNumerosOjs = New-Object System.Windows.Forms.CheckedListBox
    $listeNumerosOjs.Location = New-Object System.Drawing.Point(16, 102)
    $listeNumerosOjs.Size = New-Object System.Drawing.Size(388, 160)
    $listeNumerosOjs.CheckOnClick = $true
    $boite.Controls.Add($listeNumerosOjs)

    # La zone de messages du chargement -- meme gabarit que le journal de l'onglet
    # (Consolas 9, lecture seule, ascenseur vertical), mais PROPRE a cette boite.
    $zoneMessagesOjs = New-Object System.Windows.Forms.TextBox
    $zoneMessagesOjs.Multiline = $true
    $zoneMessagesOjs.ReadOnly = $true
    $zoneMessagesOjs.ScrollBars = 'Vertical'
    $zoneMessagesOjs.Font = New-Object System.Drawing.Font('Consolas', 9)
    $zoneMessagesOjs.BackColor = [System.Drawing.Color]::White
    $zoneMessagesOjs.Location = New-Object System.Drawing.Point(16, 268)
    $zoneMessagesOjs.Size = New-Object System.Drawing.Size(388, 92)
    $boite.Controls.Add($zoneMessagesOjs)

    $barreOjs = New-Object System.Windows.Forms.ProgressBar
    $barreOjs.Location = New-Object System.Drawing.Point(16, 366)
    $barreOjs.Size = New-Object System.Drawing.Size(270, 23)
    $barreOjs.Style = 'Marquee'
    $barreOjs.MarqueeAnimationSpeed = 0
    $boite.Controls.Add($barreOjs)

    $etatAnnulationOjs = @{ annule = $false }
    $boutonInterrompreOjs = New-Object System.Windows.Forms.Button
    $boutonInterrompreOjs.Text = (T 'lanceur.secretariat.interrompre')
    $boutonInterrompreOjs.Location = New-Object System.Drawing.Point(294, 364)
    $boutonInterrompreOjs.Size = New-Object System.Drawing.Size(110, 26)
    $boutonInterrompreOjs.Enabled = $false
    $boutonInterrompreOjs.Add_Click({ $etatAnnulationOjs.annule = $true })
    $boite.Controls.Add($boutonInterrompreOjs)

    $okBoutonOjs = New-Object System.Windows.Forms.Button
    $okBoutonOjs.Text = 'OK'
    $okBoutonOjs.Location = New-Object System.Drawing.Point(216, 426)
    $okBoutonOjs.Size = New-Object System.Drawing.Size(90, 32)
    $okBoutonOjs.Enabled = $false
    $okBoutonOjs.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $boite.Controls.Add($okBoutonOjs)
    $boite.AcceptButton = $okBoutonOjs

    $nonBoutonOjs = New-Object System.Windows.Forms.Button
    $nonBoutonOjs.Text = (T 'lanceur.annuler')
    $nonBoutonOjs.Location = New-Object System.Drawing.Point(312, 426)
    $nonBoutonOjs.Size = New-Object System.Drawing.Size(90, 32)
    $nonBoutonOjs.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $boite.Controls.Add($nonBoutonOjs)
    $boite.CancelButton = $nonBoutonOjs

    # Table de hachage et non une variable : les gestionnaires de "Charger" doivent pouvoir
    # ecrire la liste des cles OJS (une par ligne cochable) et l'annee plancher courante, et
    # une variable simple ne se reassigne pas depuis une fermeture -- voir le meme choix dans
    # Read-SzhNouveauNumero. anneePlancher reste $null tant qu'aucun chargement n'a reussi ;
    # dernierNombre est le compte de numeros du dernier chargement, seule base de comparaison
    # pour detecter la fin de course (voir $chargerNumerosOjs plus bas).
    $etatBoiteOjs = @{ cles = @(); chargement = $false; anneePlancher = $null; dernierNombre = 0; finDeCourse = $false }

    # Pendant un chargement, « Annuler » et la croix refermaient la boite alors que le
    # moissonnage tournait encore : la fenetre disparaissait et le lanceur restait inerte
    # jusqu'a sa fin, boutons grises -- exactement le gel qu'on vient de corriger. Fermer
    # PENDANT un chargement vaut donc interruption, et la boite reste ouverte.
    $boite.Add_FormClosing({
      if ($etatBoiteOjs.chargement) {
        $_.Cancel = $true
        $etatAnnulationOjs.annule = $true
      }
    })

    $listeNumerosOjs.Add_ItemCheck({
      # ItemCheck se declenche AVANT que l'etat change : on ajuste le compte de cases
      # cochees selon la nouvelle valeur, pour activer OK des la premiere case cochee.
      $dejaCocheesOjs = $listeNumerosOjs.CheckedIndices.Count
      if ($_.NewValue -eq [System.Windows.Forms.CheckState]::Checked) { $dejaCocheesOjs++ } else { $dejaCocheesOjs-- }
      $okBoutonOjs.Enabled = ($dejaCocheesOjs -gt 0)
    })

    # Un chargement REJOUE toujours la liste entiere (vide la CheckedListBox puis la
    # remplit), jamais une fusion -- le contrat de numeros-ojs --depuis-annee n'est pas
    # cumulatif, un appel a une annee plus basse ramene deja un sur-ensemble complet.
    # $EstPremier distingue le tout premier chargement (rien a comparer) des suivants, ou
    # $nombreRecuOjs est compare au dernier compte connu pour decider la fin de course.
    $chargerNumerosOjs = {
      param([int]$AnneeDepart, [bool]$EstPremier)
      $boutonChargerOjs.Enabled = $false
      $boutonChargerPlusOjs.Enabled = $false
      $script:ctxSecretariat.Form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
      $listeNumerosOjs.Items.Clear()
      $etatBoiteOjs.cles = @()
      $okBoutonOjs.Enabled = $false
      $etatBoiteOjs.chargement = $true
      # Un chargement reparti de l'annee en cours efface la fin de course : sinon, rappuyer
      # sur le premier bouton apres avoir remonte jusqu'au fond laissait le second grise pour
      # toujours, alors qu'il reste tout l'historique a reparcourir.
      if ($EstPremier) { $etatBoiteOjs.finDeCourse = $false; $etatBoiteOjs.dernierNombre = 0 }
      try {
        $resultatChargementOjs = Invoke-SzhSecretariat -Commande 'numeros-ojs' `
          -Arguments @('--revue', $JetonRevue, '--cache', $cacheTemp, '--depuis-annee', [string]$AnneeDepart) `
          -Journal $zoneMessagesOjs -NomExport (T 'lanceur.secretariat.export.titre.chargement') `
          -BarreProgression $barreOjs -BoutonInterrompre $boutonInterrompreOjs -EtatAnnulation $etatAnnulationOjs
        if (-not $resultatChargementOjs.ok) {
          Add-SzhLigneJournal $zoneMessagesOjs (T 'lanceur.secretariat.resultat.echec' @($resultatChargementOjs.texte))
        }
        $nombreRecuOjs = $resultatChargementOjs.numeros.Count
        if ($nombreRecuOjs -eq 0) {
          [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.secretariat.export.aucun'), $Titre)
        } else {
          $clesVuesOjs = New-Object System.Collections.ArrayList
          foreach ($numeroOjs in $resultatChargementOjs.numeros) {
            [void]$listeNumerosOjs.Items.Add([string]$numeroOjs.libelle)
            [void]$clesVuesOjs.Add([string]$numeroOjs.cle)
          }
          $etatBoiteOjs.cles = @($clesVuesOjs)
        }
        if ($resultatChargementOjs.ok) {
          if (-not $EstPremier -and $nombreRecuOjs -le $etatBoiteOjs.dernierNombre) {
            # Pas plus de numeros qu'au chargement precedent : plus rien de plus ancien a
            # aller chercher. Grise pour de bon, base sur le COMPTE recu -- jamais une annee
            # codee en dur.
            $etatBoiteOjs.finDeCourse = $true
            Add-SzhLigneJournal $zoneMessagesOjs (T 'lanceur.secretariat.export.fincourse')
          } else {
            $etatBoiteOjs.anneePlancher = $AnneeDepart
            $etatBoiteOjs.dernierNombre = $nombreRecuOjs
            $boutonChargerPlusOjs.Text = (T 'lanceur.secretariat.export.charger.plus' @([string]($AnneeDepart - 1)))
          }
        }
      } catch {
        [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.secretariat.erreur' @($_.Exception.Message)), $Titre)
      } finally {
        $etatBoiteOjs.chargement = $false
        $script:ctxSecretariat.Form.Cursor = [System.Windows.Forms.Cursors]::Default
        $boutonChargerOjs.Enabled = $true
        $boutonChargerPlusOjs.Enabled = ((-not $etatBoiteOjs.finDeCourse) -and ($null -ne $etatBoiteOjs.anneePlancher))
      }
    }

    $boutonChargerOjs.Add_Click({ & $chargerNumerosOjs $anneeCouranteOjs $true })
    $boutonChargerPlusOjs.Add_Click({ & $chargerNumerosOjs ($etatBoiteOjs.anneePlancher - 1) $false })

    if ($boite.ShowDialog($script:ctxSecretariat.Form) -ne [System.Windows.Forms.DialogResult]::OK) { return }

    $clesChoisiesOjs = New-Object System.Collections.ArrayList
    foreach ($indiceCoche in $listeNumerosOjs.CheckedIndices) { [void]$clesChoisiesOjs.Add($etatBoiteOjs.cles[$indiceCoche]) }
    if ($clesChoisiesOjs.Count -eq 0) { return }

    $dossierSortieOjs = Get-SzhDossierSortieChoisi
    if (-not $dossierSortieOjs) { return }

    try {
      $resultatFinalOjs = Invoke-SzhSecretariat -Commande $Commande `
        -Arguments @('--cache', $cacheTemp, '--numeros', ($clesChoisiesOjs -join ','), '--sortie', $dossierSortieOjs) `
        -Journal $script:journalSecretariat -DossierSortie $dossierSortieOjs -NomExport $Titre `
        -BarreProgression $script:barreSecretariat -BoutonInterrompre $script:boutonInterrompreSecretariat `
        -EtatAnnulation $script:etatAnnulationSecretariat
      Show-SzhResultatSecretariat $resultatFinalOjs
    } catch {
      Add-SzhLigneJournal $script:journalSecretariat (T 'lanceur.secretariat.erreur' @($_.Exception.Message))
    }
  } finally {
    if (Test-Path -LiteralPath $cacheTemp) { Remove-Item -LiteralPath $cacheTemp -Force -ErrorAction SilentlyContinue }
  }
}

# Refait le contenu de la ListBox ET le tableau parallele des entrees VISIBLES, chaque fois
# que le filtre change (et une fois au demarrage). C'est ce tableau-la -- jamais
# $secretariatEntrees -- que TOUS les gestionnaires plus bas indexent avec SelectedIndex /
# SelectedIndices : un decalage d'indice exporterait le mauvais numero, sans rien dire.
function Update-SzhListeSecretariat {
  $indiceFiltreSec = $script:comboFiltreSecretariat.SelectedIndex
  if ($indiceFiltreSec -lt 0) { $indiceFiltreSec = 0 }
  $jetonFiltreCourantSec = $script:jetonsFiltreSecretariat[$indiceFiltreSec]
  $script:secretariatEntreesVisibles = New-Object System.Collections.ArrayList
  $script:listeSecretariat.Items.Clear()
  foreach ($entreeSec in $script:secretariatEntrees) {
    if ($entreeSec.jeton -ne $jetonFiltreCourantSec) { continue }
    [void]$script:secretariatEntreesVisibles.Add($entreeSec)
    [void]$script:listeSecretariat.Items.Add(
      (T 'lanceur.secretariat.liste.entree' @($entreeSec.onglet, $entreeSec.nom, $entreeSec.titre)))
  }
}

# Construit la page : la liste des numeros locaux (filtree par produit), les quatre boutons
# d'export, le journal de progression, « Ouvrir le dossier », la barre et « Interrompre ».
#
# Le contexte, une table :
#   Form         le formulaire du lanceur (curseur d'attente, parent des boites)
#   TitreFenetre le titre des MessageBox
#   Codium       le VSCodium deja resolu (jamais vide en fenetre)
#   Inventaires  les inventaires par jeton de produit (Get-SzhInventaireProduit)
#   XPage / LargeurPage / YNouveau  la geometrie commune des pages du TabControl
# Rend le TabPage, non ajoute au TabControl : l'ordre des onglets est decide par l'appelant.
function New-SzhPageSecretariat($Contexte) {
  $script:ctxSecretariat = $Contexte
  $xPage = $Contexte.XPage
  $largeurPage = $Contexte.LargeurPage
  $yNouveau = $Contexte.YNouveau
  $inventaires = $Contexte.Inventaires

  $pageSecretariat = New-Object System.Windows.Forms.TabPage
  $pageSecretariat.Text = (T 'lanceur.secretariat')
  $pageSecretariat.Tag = ''          # pas un produit : « Ouvrir » n'a rien a ouvrir ici
  $pageSecretariat.UseVisualStyleBackColor = $true

  $introSecretariat = New-Object System.Windows.Forms.Label
  $introSecretariat.Text = (T 'lanceur.secretariat.intro')
  $introSecretariat.Location = New-Object System.Drawing.Point($xPage, 10)
  $introSecretariat.AutoSize = $true
  $pageSecretariat.Controls.Add($introSecretariat)

  # La liste des numeros locaux, tous produits confondus (jamais le livre), batie une fois a
  # partir des inventaires du contexte, deja calcules -- ni balayage ni tri supplementaire. Le
  # tableau parallele retrouve le chemin (et le produit) de la ligne choisie : la ListBox ne
  # porte que du texte. $script:secretariatEntrees garde TOUTES les entrees, des deux produits
  # confondus ; le filtre ci-dessous n'y touche jamais.
  $script:secretariatEntrees = New-Object System.Collections.ArrayList
  foreach ($jetonSec in $SzhOrdreOnglets) {
    if (-not $SzhProduits[$jetonSec].secretariat) { continue }
    $infoSec = $SzhProduits[$jetonSec]
    $invSec = $inventaires[$jetonSec]
    foreach ($groupeSec in @($invSec.enCours, $invSec.archives)) {
      foreach ($entreeSec in $groupeSec) {
        [void]$script:secretariatEntrees.Add([pscustomobject]@{
          jeton  = $jetonSec
          onglet = $infoSec.onglet
          nom    = $entreeSec.nom
          titre  = $entreeSec.titre
          chemin = $entreeSec.chemin
        })
      }
    }
  }

  $largeurListeSecretariat = 340
  $xBoutonsSecretariat = $xPage + $largeurListeSecretariat + 10
  $largeurBoutonsSecretariat = ($xPage + $largeurPage) - $xBoutonsSecretariat

  # Le filtre Revue / Zeitschrift : la liste melangeait les deux produits, sans jamais montrer
  # lequel que ce soit. Rangee unique a y=34 (etiquette + liste deroulante), a gauche des
  # quatre boutons -- la ListBox descend d'autant (y=62, hauteur 92) pour retomber exactement
  # sur y=162, ou le journal commence deja (son budget vertical est calibre sur tous les
  # paliers de hauteur d'ecran : il ne bouge pas).
  $etiqFiltreSecretariat = New-Object System.Windows.Forms.Label
  $etiqFiltreSecretariat.Text = (T 'lanceur.secretariat.filtre')
  $etiqFiltreSecretariat.Location = New-Object System.Drawing.Point($xPage, 37)
  $etiqFiltreSecretariat.AutoSize = $true
  $pageSecretariat.Controls.Add($etiqFiltreSecretariat)

  # Les jetons proposes, dans l'ordre de $SzhOrdreOnglets en sautant 'livre' -- jamais dans la
  # liste ici, comme dans $secretariatEntrees.
  $script:jetonsFiltreSecretariat = @($SzhOrdreOnglets | Where-Object { $SzhProduits[$_].secretariat })
  $script:comboFiltreSecretariat = New-Object System.Windows.Forms.ComboBox
  $script:comboFiltreSecretariat.DropDownStyle = 'DropDownList'
  $script:comboFiltreSecretariat.Location = New-Object System.Drawing.Point(($xPage + 70), 34)
  $script:comboFiltreSecretariat.Size = New-Object System.Drawing.Size(($largeurListeSecretariat - 70), 23)
  foreach ($jetonFiltre in $script:jetonsFiltreSecretariat) {
    [void]$script:comboFiltreSecretariat.Items.Add($SzhProduits[$jetonFiltre].onglet)
  }
  $script:comboFiltreSecretariat.SelectedIndex = 0
  $pageSecretariat.Controls.Add($script:comboFiltreSecretariat)

  $script:listeSecretariat = New-Object System.Windows.Forms.ListBox
  $script:listeSecretariat.Location = New-Object System.Drawing.Point($xPage, 62)
  $script:listeSecretariat.Size = New-Object System.Drawing.Size($largeurListeSecretariat, 92)
  $script:listeSecretariat.Font = New-Object System.Drawing.Font('Segoe UI', 9)
  $script:listeSecretariat.SelectionMode = 'MultiExtended'
  $pageSecretariat.Controls.Add($script:listeSecretariat)

  Update-SzhListeSecretariat
  $script:comboFiltreSecretariat.Add_SelectedIndexChanged({ Update-SzhListeSecretariat })

  # Les quatre boutons, en colonne a droite de la liste -- meme hauteur de rangee, memes
  # marges, pour ne jamais deborder de $largeurPage (aucun onglet ne doit agrandir la
  # fenetre : voir l'en-tete du fichier).
  $script:secretariatBoutons = @()

  $boutonNewsletter = New-Object System.Windows.Forms.Button
  $boutonNewsletter.Text = (T 'lanceur.secretariat.newsletter')
  $boutonNewsletter.Location = New-Object System.Drawing.Point($xBoutonsSecretariat, 34)
  $boutonNewsletter.Size = New-Object System.Drawing.Size($largeurBoutonsSecretariat, 26)
  $pageSecretariat.Controls.Add($boutonNewsletter)
  $script:secretariatBoutons += $boutonNewsletter

  $boutonEdudoc = New-Object System.Windows.Forms.Button
  $boutonEdudoc.Text = (T 'lanceur.secretariat.edudoc')
  $boutonEdudoc.Location = New-Object System.Drawing.Point($xBoutonsSecretariat, 64)
  $boutonEdudoc.Size = New-Object System.Drawing.Size($largeurBoutonsSecretariat, 26)
  $pageSecretariat.Controls.Add($boutonEdudoc)
  $script:secretariatBoutons += $boutonEdudoc

  $boutonCaracteres = New-Object System.Windows.Forms.Button
  $boutonCaracteres.Text = (T 'lanceur.secretariat.caracteres')
  $boutonCaracteres.Location = New-Object System.Drawing.Point($xBoutonsSecretariat, 94)
  $boutonCaracteres.Size = New-Object System.Drawing.Size($largeurBoutonsSecretariat, 26)
  $pageSecretariat.Controls.Add($boutonCaracteres)
  $script:secretariatBoutons += $boutonCaracteres

  $boutonMetadonnees = New-Object System.Windows.Forms.Button
  $boutonMetadonnees.Text = (T 'lanceur.secretariat.metadonnees')
  $boutonMetadonnees.Location = New-Object System.Drawing.Point($xBoutonsSecretariat, 124)
  $boutonMetadonnees.Size = New-Object System.Drawing.Size($largeurBoutonsSecretariat, 26)
  $pageSecretariat.Controls.Add($boutonMetadonnees)
  $script:secretariatBoutons += $boutonMetadonnees

  # Le journal de progression -- meme gabarit que celui de l'onglet Journal (Consolas 9, lecture
  # seule, meme budget vertical : de y=162 a $yNouveau, deja eprouve sur tous les paliers de
  # hauteur d'ecran par cet onglet-la).
  $script:journalSecretariat = New-Object System.Windows.Forms.TextBox
  $script:journalSecretariat.Multiline = $true
  $script:journalSecretariat.ReadOnly = $true
  $script:journalSecretariat.ScrollBars = 'Vertical'
  $script:journalSecretariat.Font = New-Object System.Drawing.Font('Consolas', 9)
  $script:journalSecretariat.BackColor = [System.Drawing.Color]::White
  $script:journalSecretariat.Location = New-Object System.Drawing.Point($xPage, 162)
  $script:journalSecretariat.Size = New-Object System.Drawing.Size($largeurPage, ($yNouveau - 170))
  $pageSecretariat.Controls.Add($script:journalSecretariat)

  $script:secretariatDossierCourant = ''
  $script:boutonSecretariatDossier = New-Object System.Windows.Forms.Button
  $script:boutonSecretariatDossier.Text = (T 'lanceur.secretariat.dossier')
  $script:boutonSecretariatDossier.Location = New-Object System.Drawing.Point($xPage, $yNouveau)
  $script:boutonSecretariatDossier.Size = New-Object System.Drawing.Size(220, 30)
  $script:boutonSecretariatDossier.Enabled = $false
  $pageSecretariat.Controls.Add($script:boutonSecretariatDossier)

  # Barre de progression et bouton d'interruption de l'onglet, a droite de « Ouvrir le
  # dossier » sur la meme rangee -- jusqu'a $xPage + $largeurPage (604), sans jamais deborder.
  # Pilotes par Invoke-SzhSecretariat (voir ses parametres -BarreProgression /
  # -BoutonInterrompre / -EtatAnnulation) : au repos entre deux exports (Marquee immobile,
  # bouton inactif).
  $script:barreSecretariat = New-Object System.Windows.Forms.ProgressBar
  $script:barreSecretariat.Location = New-Object System.Drawing.Point(242, $yNouveau)
  $script:barreSecretariat.Size = New-Object System.Drawing.Size(240, 30)
  $script:barreSecretariat.Style = 'Marquee'
  $script:barreSecretariat.MarqueeAnimationSpeed = 0
  $pageSecretariat.Controls.Add($script:barreSecretariat)

  $script:etatAnnulationSecretariat = @{ annule = $false }
  $script:boutonInterrompreSecretariat = New-Object System.Windows.Forms.Button
  $script:boutonInterrompreSecretariat.Text = (T 'lanceur.secretariat.interrompre')
  $script:boutonInterrompreSecretariat.Location = New-Object System.Drawing.Point(492, $yNouveau)
  $script:boutonInterrompreSecretariat.Size = New-Object System.Drawing.Size(112, 30)
  $script:boutonInterrompreSecretariat.Enabled = $false
  $script:boutonInterrompreSecretariat.Add_Click({ $script:etatAnnulationSecretariat.annule = $true })
  $pageSecretariat.Controls.Add($script:boutonInterrompreSecretariat)


  # ---- Les quatre gestes, cote interface ----

  $boutonNewsletter.Add_Click({
    if ($script:listeSecretariat.SelectedIndex -lt 0) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.secretariat.newsletter.manque'), $script:ctxSecretariat.TitreFenetre)
      return
    }
    $entreeNewsletter = $script:secretariatEntreesVisibles[$script:listeSecretariat.SelectedIndex]
    $dossierNewsletter = Get-SzhDossierSortieChoisi
    if (-not $dossierNewsletter) { return }
    try {
      $resultatNewsletter = Invoke-SzhSecretariat -Commande 'newsletter' `
        -Arguments @('--numero', $entreeNewsletter.chemin, '--sortie', $dossierNewsletter) `
        -Journal $script:journalSecretariat -DossierSortie $dossierNewsletter `
        -NomExport (T 'lanceur.secretariat.export.titre.newsletter') `
        -BarreProgression $script:barreSecretariat -BoutonInterrompre $script:boutonInterrompreSecretariat `
        -EtatAnnulation $script:etatAnnulationSecretariat
      Show-SzhResultatSecretariat $resultatNewsletter
    } catch {
      Add-SzhLigneJournal $script:journalSecretariat (T 'lanceur.secretariat.erreur' @($_.Exception.Message))
    }
  })

  $boutonEdudoc.Add_Click({
    Show-SzhBoiteExportOjs (T 'lanceur.secretariat.export.titre.edudoc') 'edudoc' `
      $script:jetonsFiltreSecretariat[$script:comboFiltreSecretariat.SelectedIndex]
  })

  $boutonCaracteres.Add_Click({
    Show-SzhBoiteExportOjs (T 'lanceur.secretariat.export.titre.caracteres') 'caracteres' `
      $script:jetonsFiltreSecretariat[$script:comboFiltreSecretariat.SelectedIndex]
  })

  $boutonMetadonnees.Add_Click({
    $indicesMeta = $script:listeSecretariat.SelectedIndices
    if ($indicesMeta.Count -eq 0) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.secretariat.metadonnees.manque'), $script:ctxSecretariat.TitreFenetre)
      return
    }
    $entreesMeta = New-Object System.Collections.ArrayList
    foreach ($indiceMeta in $indicesMeta) { [void]$entreesMeta.Add($script:secretariatEntreesVisibles[$indiceMeta]) }
    $dossierMeta = Get-SzhDossierSortieChoisi
    if (-not $dossierMeta) { return }
    # La revue a moissonner suit desormais le filtre de l'onglet, jamais le produit d'un
    # numero choisi : elle ne peut donc plus diverger de ce qui est affiche (avant le filtre,
    # elle suivait le premier numero coche -- un choix qui melangerait revue et Zeitschrift
    # n'a de toute facon aucun sens cote OJS, deux sites distincts).
    $revueMeta = $script:jetonsFiltreSecretariat[$script:comboFiltreSecretariat.SelectedIndex]
    $cacheMeta = Join-Path $env:TEMP ('szh-secretariat-' + [guid]::NewGuid().ToString('N') + '.json')
    # --depuis-annee restreint la moisson a l'annee la plus ancienne des numeros COCHES (et
    # les suivantes) : un numero local dont l'annee n'est pas lisible dans son nom ne doit pas
    # se retrouver compare a une moisson qui ne le contient pas -- moisson complete dans ce
    # cas, comme avant, sans rien dire a l'utilisateur.
    $anneesMeta = New-Object System.Collections.ArrayList
    $anneesLisiblesMeta = $true
    foreach ($entreeAnneeMeta in $entreesMeta) {
      $correspondanceAnneeMeta = [regex]::Match([string]$entreeAnneeMeta.nom, '^(\d{4})-')
      if ($correspondanceAnneeMeta.Success) { [void]$anneesMeta.Add([int]$correspondanceAnneeMeta.Groups[1].Value) }
      else { $anneesLisiblesMeta = $false }
    }
    $argumentsChargementMeta = New-Object System.Collections.ArrayList
    [void]$argumentsChargementMeta.AddRange(@('--revue', $revueMeta, '--cache', $cacheMeta))
    if ($anneesLisiblesMeta -and $anneesMeta.Count -gt 0) {
      $anneePlancherMeta = ($anneesMeta | Measure-Object -Minimum).Minimum
      [void]$argumentsChargementMeta.AddRange(@('--depuis-annee', [string]$anneePlancherMeta))
    }
    try {
      $chargementMeta = Invoke-SzhSecretariat -Commande 'numeros-ojs' `
        -Arguments @($argumentsChargementMeta) -Journal $script:journalSecretariat `
        -NomExport (T 'lanceur.secretariat.export.titre.chargement') `
        -BarreProgression $script:barreSecretariat -BoutonInterrompre $script:boutonInterrompreSecretariat `
        -EtatAnnulation $script:etatAnnulationSecretariat
      if (-not $chargementMeta.ok) {
        Show-SzhResultatSecretariat $chargementMeta
        return
      }
      $argumentsMeta = New-Object System.Collections.ArrayList
      foreach ($entreeMeta in $entreesMeta) {
        [void]$argumentsMeta.Add('--numero')
        [void]$argumentsMeta.Add($entreeMeta.chemin)
      }
      [void]$argumentsMeta.Add('--cache')
      [void]$argumentsMeta.Add($cacheMeta)
      [void]$argumentsMeta.Add('--sortie')
      [void]$argumentsMeta.Add($dossierMeta)
      $resultatMeta = Invoke-SzhSecretariat -Commande 'metadonnees' -Arguments @($argumentsMeta) `
        -Journal $script:journalSecretariat -DossierSortie $dossierMeta `
        -NomExport (T 'lanceur.secretariat.export.titre.metadonnees') `
        -BarreProgression $script:barreSecretariat -BoutonInterrompre $script:boutonInterrompreSecretariat `
        -EtatAnnulation $script:etatAnnulationSecretariat
      Show-SzhResultatSecretariat $resultatMeta
    } catch {
      Add-SzhLigneJournal $script:journalSecretariat (T 'lanceur.secretariat.erreur' @($_.Exception.Message))
    } finally {
      if (Test-Path -LiteralPath $cacheMeta) { Remove-Item -LiteralPath $cacheMeta -Force -ErrorAction SilentlyContinue }
    }
  })

  $script:boutonSecretariatDossier.Add_Click({
    if (-not $script:secretariatDossierCourant) { return }
    try {
      if (Test-Path -LiteralPath $script:secretariatDossierCourant) {
        Start-Process explorer.exe ('"' + $script:secretariatDossierCourant + '"')
      }
    } catch {
      Write-SzhLog ('open-produit : ouverture du dossier de sortie echouee (' + $_.Exception.Message + ')')
    }
  })

  return $pageSecretariat
}
