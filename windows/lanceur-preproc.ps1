# ---- L'onglet « Preprocessing » : le nettoyeur de manuscrit (Article) ----
# Contrat complet : docs/ARCHITECTURE-nettoyeur-manuscrit.md. La CLI appelee est
# pipeline/manuscrit-nettoyer.py, executee par le python3 de la WSL SZH-Publishing --
# jamais le Node de VSCodium ici, ce n'est pas un script JS. Le patron reste celui de
# Invoke-SzhSecretariat (grisage des boutons, sablier, barre de progression, bouton
# Interrompre), mais les DEUX FLUX SONT INVERSES par rapport au secretariat : le contrat
# de la CLI (paragraphe 8 de l'architecture) met la progression ligne a ligne sur STDERR
# et une UNIQUE ligne JSON de statistiques sur STDOUT, a la toute fin. C'est donc stderr
# qui est pompe en direct (ReadLineAsync + DoEvents, jamais un ReadLine() synchrone), et
# stdout qui est lu une seule fois en tache de fond -- demarree EN PREMIER, avant la
# boucle sur stderr, pour la meme raison que Invoke-SzhSecretariat demarre sa tache
# d'erreur en premier : quel que soit le flux qu'on lit en boucle, l'autre doit avoir un
# lecteur actif tout de suite, sinon il sature son tube et bloque l'enfant. Jamais
# add_ErrorDataReceived / BeginErrorReadLine : ce gestionnaire tourne hors pipeline et a
# deja tue le processus PowerShell entier sur ce poste.
#
# Decodage de la sortie de wsl.exe -- au sens strict, les messages de wsl.exe LUI-MEME
# (wslpath, la liste des distributions), jamais ceux du script Python qu'il lance : une
# seule fonction plus bas (ConvertFrom-SzhOctetsWsl), et nulle part ailleurs. Mesure du
# 18.09.2026 : wsl -l -v rend de l'UTF-16 sur ce poste. Le script Python, lui, parle UTF-8
# sur ses deux flux -- convention deja suivie par le reste du pipeline -- d'ou
# StandardOutputEncoding/StandardErrorEncoding = UTF8 sur le PROCESSUS PRINCIPAL plus bas,
# exactement comme Invoke-SzhSecretariat pour son Node.
#
# Dot-source par open-produit.ps1, qui appelle New-SzhPagePreproc avec un contexte explicite
# (voir la fonction). Les gestionnaires d'evenements tournent apres le retour de cette
# fonction : ils lisent le contexte et l'etat de l'onglet dans la portee du script
# ($script:ctxPreproc, $script:journalPreproc...), jamais dans les locales de la fonction.
# Add-SzhLigneJournal et Add-SzhEnteteJournal, communes avec l'onglet Export et secretariat,
# restent dans open-produit.ps1.
#
# Comme « Journal » et « Reglages » : pas un produit, .Tag reste vide.

# Heuristique UTF-16LE vs UTF-8 sur des octets bruts. Un texte ASCII encode en UTF-16LE
# alterne un octet de donnee et un octet nul : on regarde la moitie "impaire" d'un
# echantillon de tete, et au-dela de 60 % de nuls, c'est de l'UTF-16LE.
function ConvertFrom-SzhOctetsWsl([byte[]]$Octets) {
  if (-not $Octets -or $Octets.Length -eq 0) { return '' }
  $echantillonWsl = [Math]::Min($Octets.Length, 128)
  if ($echantillonWsl -ge 2) {
    $nulsWsl = 0
    $pairesWsl = 0
    for ($i = 1; $i -lt $echantillonWsl; $i += 2) {
      $pairesWsl++
      if ($Octets[$i] -eq 0) { $nulsWsl++ }
    }
    if (($pairesWsl -gt 0) -and (($nulsWsl / $pairesWsl) -gt 0.6)) {
      return [System.Text.Encoding]::Unicode.GetString($Octets)
    }
  }
  return [System.Text.Encoding]::UTF8.GetString($Octets)
}

# $env:SZH_MANUSCRIT_WSL_EXE / _DISTRO / _CLI : trois points d'entree de test, pour viser
# un faux wsl.exe, une fausse distribution ou un faux script sans dependre d'une vraie
# installation. Absents en production -- Get-WslExe (szh-common.ps1) et $SzhToolkit font
# alors foi, comme partout ailleurs dans ce fichier. Get-SzhDistrosEnregistrees (szh-common.ps1)
# lit lui aussi SZH_MANUSCRIT_WSL_EXE.
function Get-SzhWslExePreproc {
  if ($env:SZH_MANUSCRIT_WSL_EXE) { return $env:SZH_MANUSCRIT_WSL_EXE }
  return (Get-WslExe)
}
function Get-SzhDistroPreproc {
  if ($env:SZH_MANUSCRIT_DISTRO) { return $env:SZH_MANUSCRIT_DISTRO }
  return $SzhDistro
}
function Get-SzhCheminManuscritCli {
  if ($env:SZH_MANUSCRIT_CLI) { return $env:SZH_MANUSCRIT_CLI }
  return (Join-Path $SzhToolkit 'pipeline\manuscrit-nettoyer.py')
}

# wsl.exe pour une commande COURTE (wslpath, liste des distributions) : les deux flux
# sont lus EN PARALLELE (CopyToAsync), donc ni l'un ni l'autre ne peut saturer son tube
# pendant qu'on attend l'autre. N'est PAS utilisee pour le processus principal (long, a
# pomper en direct) -- voir Invoke-SzhManuscrit, plus bas.
function Invoke-SzhWslBrut {
  param([Parameter(Mandatory = $true)][string[]]$Arguments, [int]$TimeoutMs = 15000)
  $psiWslBrut = New-Object System.Diagnostics.ProcessStartInfo
  $psiWslBrut.FileName = Get-SzhWslExePreproc
  $psiWslBrut.Arguments = ConvertTo-SzhArguments $Arguments
  $psiWslBrut.RedirectStandardOutput = $true
  $psiWslBrut.RedirectStandardError = $true
  $psiWslBrut.UseShellExecute = $false
  $psiWslBrut.CreateNoWindow = $true
  $processusWslBrut = New-Object System.Diagnostics.Process
  $processusWslBrut.StartInfo = $psiWslBrut
  [void]$processusWslBrut.Start()
  $tamponSortieWslBrut = New-Object System.IO.MemoryStream
  $tamponErreurWslBrut = New-Object System.IO.MemoryStream
  $tacheSortieWslBrut = $processusWslBrut.StandardOutput.BaseStream.CopyToAsync($tamponSortieWslBrut)
  $tacheErreurWslBrut = $processusWslBrut.StandardError.BaseStream.CopyToAsync($tamponErreurWslBrut)
  if (-not $processusWslBrut.WaitForExit($TimeoutMs)) {
    try { $processusWslBrut.Kill() } catch { }
    throw 'wsl.exe ne repond pas.'
  }
  [System.Threading.Tasks.Task]::WaitAll(@($tacheSortieWslBrut, $tacheErreurWslBrut))
  return [pscustomobject]@{
    code   = $processusWslBrut.ExitCode
    sortie = (ConvertFrom-SzhOctetsWsl $tamponSortieWslBrut.ToArray()).Trim()
    erreur = (ConvertFrom-SzhOctetsWsl $tamponErreurWslBrut.ToArray()).Trim()
  }
}

# wslpath -a (Windows -> Linux) et -w (Linux -> Windows) : conversion "dans les deux
# sens" (contrat, paragraphe 9) -- les manuscrits viennent de OneDrive, chemins a espaces
# et accents compris.
function ConvertTo-SzhCheminWsl([string]$CheminWindows) {
  $resultatConversionWsl = Invoke-SzhWslBrut -Arguments @('-d', (Get-SzhDistroPreproc), '-e', 'wslpath', '-a', $CheminWindows)
  if (($resultatConversionWsl.code -ne 0) -or (-not $resultatConversionWsl.sortie)) {
    throw (T 'lanceur.preproc.chemin.echec' @($CheminWindows))
  }
  return $resultatConversionWsl.sortie
}
function ConvertTo-SzhCheminWindowsDepuisWsl([string]$CheminWsl) {
  $resultatConversionWin = Invoke-SzhWslBrut -Arguments @('-d', (Get-SzhDistroPreproc), '-e', 'wslpath', '-w', $CheminWsl)
  if (($resultatConversionWin.code -ne 0) -or (-not $resultatConversionWin.sortie)) {
    throw (T 'lanceur.preproc.chemin.echec' @($CheminWsl))
  }
  return $resultatConversionWin.sortie
}

# Verifications d'avance, chacune avec un message clair -- jamais une trace brute (WSL
# absente, distro eteinte, CLI introuvable sont TROIS causes distinctes, comme err.wsl /
# err.wsl.dossier / err.wsl.moteur plus haut dans ce meme fichier pour la mise a jour).
# Rend le chemin Windows de la CLI si tout va bien.
function Test-SzhManuscritPret {
  $wslExePreproc = Get-SzhWslExePreproc
  if (-not (Test-Path -LiteralPath $wslExePreproc)) { throw (T 'lanceur.preproc.wsl.absent' @($SzhSupport)) }
  $distroPreproc = Get-SzhDistroPreproc
  if (-not ((Get-SzhDistrosEnregistrees) -contains $distroPreproc)) {
    throw (T 'lanceur.preproc.wsl.distro.absente' @($distroPreproc))
  }
  $cliPreproc = Get-SzhCheminManuscritCli
  if (-not (Test-Path -LiteralPath $cliPreproc)) { throw (T 'lanceur.preproc.cli.absent') }
  return $cliPreproc
}

# ---- Le JSON du rapport : un fichier temporaire, jamais a cote du manuscrit ----
# La CLI ecrit son rapport complet (--rapport) ; le lanceur le relit une fois pour rendre la
# page HTML, puis le supprime. Tout le cycle de vie -- creation du chemin, suppression -- tient
# dans ces deux fonctions, et nulle part ailleurs : c'est ici qu'une remontee vers un dossier
# commun viendrait se brancher. Le chemin part a la CLI en barres obliques (wsl.exe avale les
# antislashs). Sous %TEMP% : GetTempPath suit les variables TEMP/TMP.
function New-SzhRapportTemporaire {
  return (Join-Path ([System.IO.Path]::GetTempPath()) ('szh-rapport-manuscrit-' + [guid]::NewGuid().ToString('N') + '.json'))
}
function Remove-SzhRapportTemporaire([string]$Chemin) {
  if (-not $Chemin) { return }
  try {
    if (Test-Path -LiteralPath $Chemin) { Remove-Item -LiteralPath $Chemin -Force -ErrorAction Stop }
  } catch {
    Write-SzhLog ('open-produit : suppression du rapport temporaire echouee (' + $_.Exception.Message + ')')
  }
}

# ---- Ce que le nettoyeur laisse derriere lui : un rapport d'erreur, des compteurs ----
# Le nettoyeur manipule des manuscrits : NI le texte, NI un nom de fichier, NI un chemin, NI un
# message d'exception ne sort jamais d'ici. Le rapport d'erreur (NETTOYEUR-ECHEC) ne porte que
# des valeurs d'une liste blanche -- le type de l'exception, le lieu dans le depot, l'etape, un
# code de refus, un code de sortie -- revalidees ICI par motif meme quand la CLI les a deja
# assainies ; les compteurs (windows\szh-compteurs.ps1) ne portent que des noms de mesure et des
# entiers. Jamais $textePreproc, jamais le journal de l'onglet, jamais de fichiers joints.
# Aucune de ces deux ecritures ne leve vers l'interface.

# Le contenu assaini d'un rapport : un objet ordonne de valeurs a motif verifie, ou $null.
#   plantage          -> type / lieu / etape de la CLI
#   refus             -> code du refus et code de sortie
#   sortie inattendue -> code de sortie seul
#   echec             -> un mot (preparation, rendu-rapport) et, au plus, un nom de phase
function ConvertTo-SzhNettoyeurContenu {
  param($Stats = $null, $CodeSortie = $null, [string]$Echec = '', [string]$Phase = '', [string]$TypeException = '')
  $contenu = [ordered]@{}
  if ($Echec) {
    $contenu['echec'] = $Echec
    if ($Phase -cmatch '^[a-z]{1,20}\z') { $contenu['phase'] = $Phase }
    if ($TypeException -cmatch '^[A-Za-z_][A-Za-z0-9_]{0,63}\z') { $contenu['type'] = $TypeException }
    return $contenu
  }
  if ($Stats -and $Stats.PSObject.Properties['plantage'] -and $Stats.plantage) {
    $type = [string]$Stats.type
    $lieu = [string]$Stats.lieu
    $etape = [string]$Stats.etape
    $contenu['plantage'] = $true
    $contenu['type'] = $(if ($type -cmatch '^[A-Za-z_][A-Za-z0-9_]{0,63}\z') { $type } else { 'Exception' })
    $contenu['lieu'] = $(if (($lieu -cmatch '^[A-Za-z0-9_.-]{1,80}\.py:\d{1,6}\z') -or ($lieu -ceq 'inconnu')) { $lieu } else { 'inconnu' })
    $contenu['etape'] = $(if ($etape -cmatch '^[a-z0-9-]{1,40}\z') { $etape } else { 'inconnue' })
  } elseif ($Stats -and $Stats.PSObject.Properties['refus'] -and $Stats.refus) {
    $code = [string]$Stats.code_refus
    $contenu['refus'] = $(if ($code -cmatch '^[a-z][a-z0-9-]{1,40}\z') { $code } else { 'inconnu' })
  }
  if ($null -ne $CodeSortie) {
    try { $contenu['code_sortie'] = [int]$CodeSortie } catch { }
  }
  return $contenu
}

# Ecrit un NETTOYEUR-ECHEC. L'etape est « nettoyeur : <etape> » ; le contenu part en message,
# en JSON compact. L'anti-inondation et le masquage sont ceux de Write-SzhRapport.
function Send-SzhRapportNettoyeur {
  param([string]$Etape, $Contenu, [string]$Produit = '')
  try {
    if ($Etape -cnotmatch '^[a-z0-9-]{1,40}\z') { $Etape = 'inconnue' }
    $produitRapport = $null
    if (($Produit -ceq 'revue') -or ($Produit -ceq 'zeitschrift')) { $produitRapport = @{ type = $Produit } }
    Write-SzhRapport -Code 'NETTOYEUR-ECHEC' -Source 'lanceur' -Etape ('nettoyeur : ' + $Etape) `
      -Message ($Contenu | ConvertTo-Json -Compress) -Produit $produitRapport
  } catch { }
}

# Apres un passage : les compteurs (toujours, des qu'il y en a) et, pour un defaut du logiciel
# seulement, un rapport d'erreur. Les refus attendus (fichier-verrou, extension-inconnue,
# suivi-modifications, conversion-impossible) ne font AUCUN rapport ; une interruption voulue
# non plus.
function Send-SzhConstatsNettoyeur {
  param($Stats, $CodeSortie, [bool]$Interrompu, [string]$PhaseEchec, [string]$Produit,
    [string]$CheminManuscrit, [bool]$Ok)
  try {
    $mesures = $null
    $passage = ''
    if ($Stats -and $Stats.PSObject.Properties['compteurs'] -and $Stats.compteurs) {
      $mesures = $Stats.compteurs.mesures
      $passage = [string]$Stats.compteurs.passage
    }
    if (($null -eq $mesures) -and ($Interrompu -or (-not $Ok))) {
      # Rien n'est revenu de la CLI (interruption, sortie sans JSON, WSL pas prete) : un
      # compteur minimal, pour que l'issue se compte quand meme.
      $passage = Get-SzhCompteursPassage $CheminManuscrit
      $issue = 'plantage'
      if ($Interrompu) { $issue = 'interrompu' }
      $mesures = [ordered]@{ ('issue.' + $issue) = 1 }
      if (($Produit -ceq 'revue') -or ($Produit -ceq 'zeitschrift')) { $mesures['produit.' + $Produit] = 1 }
    }
    if ($null -ne $mesures) { Write-SzhCompteurs -Source 'nettoyeur' -Passage $passage -Mesures $mesures }
  } catch { }

  try {
    if ($Interrompu) { return }
    if ($PhaseEchec) {
      Send-SzhRapportNettoyeur -Etape 'preparation' -Produit $Produit `
        -Contenu (ConvertTo-SzhNettoyeurContenu -Echec 'preparation' -Phase $PhaseEchec)
    } elseif ($Stats -and $Stats.PSObject.Properties['plantage'] -and $Stats.plantage) {
      $contenu = ConvertTo-SzhNettoyeurContenu -Stats $Stats -CodeSortie $CodeSortie
      Send-SzhRapportNettoyeur -Etape ([string]$contenu['etape']) -Contenu $contenu -Produit $Produit
    } elseif ($Stats -and $Stats.PSObject.Properties['refus'] -and $Stats.refus) {
      $code = [string]$Stats.code_refus
      $etapeRefus = ''
      if ($code -ceq 'lecture-impossible') { $etapeRefus = 'lecture' }
      elseif ($code -ceq 'perte-de-contenu') { $etapeRefus = 'controle-perte' }
      if ($etapeRefus) {
        Send-SzhRapportNettoyeur -Etape $etapeRefus -Produit $Produit `
          -Contenu (ConvertTo-SzhNettoyeurContenu -Stats $Stats -CodeSortie $CodeSortie)
      }
    } elseif (-not $Ok) {
      Send-SzhRapportNettoyeur -Etape 'sortie-inattendue' -Produit $Produit `
        -Contenu (ConvertTo-SzhNettoyeurContenu -CodeSortie $CodeSortie)
    }
  } catch { }
}

# Le seul appelant de manuscrit-nettoyer.py. Voir l'en-tete de cette section pour
# l'inversion stdout/stderr par rapport a Invoke-SzhSecretariat, et pourquoi.
#
# Le journal de l'onglet ne recoit QUE l'essentiel (le manuscrit traite ici, le resultat dans
# Show-SzhResultatPreproc) : la progression ligne a ligne de la CLI n'y est plus recopiee, elle
# vit dans le rapport (cle 'journal') et les dernieres lignes vont au journal technique du
# lanceur en cas d'echec.
function Invoke-SzhManuscrit {
  param(
    [Parameter(Mandatory = $true)][string]$CheminManuscrit,
    [Parameter(Mandatory = $true)][string]$Produit,
    [Parameter(Mandatory = $true)]$Journal,
    [string]$NomExport = '',
    [string]$Format = 'docx',
    $BarreProgression = $null,
    $BoutonInterrompre = $null,
    $EtatAnnulation = $null
  )
  Add-SzhEnteteJournal $Journal $NomExport
  Add-SzhLigneJournal $Journal (T 'lanceur.preproc.fichier.choisi' @((Split-Path -Leaf $CheminManuscrit)))
  foreach ($boutonGrisePreproc in $script:preprocBoutons) { $boutonGrisePreproc.Enabled = $false }
  $script:ctxPreproc.Form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
  if ($BarreProgression) {
    $BarreProgression.Style = 'Marquee'
    $BarreProgression.MarqueeAnimationSpeed = 30
    $BarreProgression.Value = 0
  }
  if ($BoutonInterrompre) { $BoutonInterrompre.Enabled = $true }
  if ($EtatAnnulation) { $EtatAnnulation.annule = $false }

  $okPreproc = $false
  $textePreproc = ''
  $statsPreproc = $null
  $dossierSortiePreproc = ''
  $processusPreproc = $null
  $tacheSortiePreproc = $null
  $cheminRapportTemporairePreproc = New-SzhRapportTemporaire
  # Succes avec alertes bloquantes (code 1 du contrat CLI, CODE_ALERTE_ERROR) : le
  # .docx et le rapport existent, seule la ligne du journal change -- voir Show-SzhResultatPreproc.
  $alerteBloquantePreproc = $false
  # Les trois dernieres lignes de progression non vides vues sur stderr, hors la ligne
  # finale qui porte le code de sortie : le seul indice qui reste quand le processus s'arrete
  # sans refus ni JSON exploitable (code 3 ou inattendu). Jamais montrees a l'ecran : elles
  # partent au journal technique du lanceur (Show-SzhResultatPreproc).
  $dernieresLignesErreurPreproc = New-Object System.Collections.ArrayList
  $detailPreproc = ''
  # Ou l'on en etait quand une exception a interrompu la preparation (pret, chemins,
  # lancement) : un mot, jamais le message de l'exception -- il citerait le chemin du manuscrit.
  $phasePreproc = 'pret'
  $echecPhasePreproc = ''
  $codeSortiePreproc = $null
  $futAnnulePreproc = $false

  try {
    $cliWindowsPreproc = Test-SzhManuscritPret
    $phasePreproc = 'chemins'
    $cliWslPreproc = ConvertTo-SzhCheminWsl $cliWindowsPreproc
    $manuscritWslPreproc = ConvertTo-SzhCheminWsl $CheminManuscrit
    $dossierSortiePreproc = Split-Path -Parent $CheminManuscrit
    $sortieWslPreproc = ConvertTo-SzhCheminWsl $dossierSortiePreproc
    $rapportWslPreproc = ConvertTo-SzhCheminWsl ($cheminRapportTemporairePreproc -replace '\\', '/')

    $phasePreproc = 'lancement'
    $psiPreproc = New-Object System.Diagnostics.ProcessStartInfo
    $psiPreproc.FileName = Get-SzhWslExePreproc
    $psiPreproc.Arguments = ConvertTo-SzhArguments @(
      '-d', (Get-SzhDistroPreproc), '-e', 'python3', $cliWslPreproc,
      $manuscritWslPreproc, '--produit', $Produit, '--sortie', $sortieWslPreproc,
      '--rapport', $rapportWslPreproc, '--format', $Format)
    $psiPreproc.RedirectStandardOutput = $true
    $psiPreproc.RedirectStandardError = $true
    $psiPreproc.UseShellExecute = $false
    $psiPreproc.CreateNoWindow = $true
    $psiPreproc.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psiPreproc.StandardErrorEncoding = [System.Text.Encoding]::UTF8

    $processusPreproc = New-Object System.Diagnostics.Process
    $processusPreproc.StartInfo = $psiPreproc
    [void]$processusPreproc.Start()
    # La tache de fond sur STDOUT demarre AVANT la boucle sur STDERR -- voir l'en-tete de
    # cette section : c'est l'inverse de Invoke-SzhSecretariat parce que le contrat de
    # cette CLI met la progression sur stderr et une seule ligne JSON, a la fin, sur
    # stdout.
    $tacheSortiePreproc = $processusPreproc.StandardOutput.ReadToEndAsync()
    $phasePreproc = 'execution'

    while ($true) {
      $tacheLignePreproc = $processusPreproc.StandardError.ReadLineAsync()
      $annulePendantPreproc = $false
      while (-not $tacheLignePreproc.IsCompleted) {
        if ($EtatAnnulation -and $EtatAnnulation.annule) { $annulePendantPreproc = $true; break }
        [System.Windows.Forms.Application]::DoEvents()
        [System.Threading.Thread]::Sleep(25)
      }
      if ($annulePendantPreproc) {
        try { if (-not $processusPreproc.HasExited) { $processusPreproc.Kill() } } catch { }
        $okPreproc = $false
        $textePreproc = (T 'lanceur.preproc.interrompu')
        $futAnnulePreproc = $true
        break
      }
      $lignePreproc = $null
      try { $lignePreproc = $tacheLignePreproc.Result } catch { $lignePreproc = $null }
      if ($null -eq $lignePreproc) { break }
      $ligneVuePreproc = $lignePreproc.Trim()
      if ($ligneVuePreproc) {
        # La toute derniere ligne de progression porte "(code de sortie N)" -- jamais
        # retenue ici, un code de sortie ne se montre pas a une relectrice.
        if ($ligneVuePreproc -notmatch 'code de sortie') {
          [void]$dernieresLignesErreurPreproc.Add($ligneVuePreproc)
          if ($dernieresLignesErreurPreproc.Count -gt 3) { $dernieresLignesErreurPreproc.RemoveAt(0) }
        }
      }
    }

    if ($futAnnulePreproc) {
      try { [void]$processusPreproc.WaitForExit(3000) } catch { }
    } else {
      $processusPreproc.WaitForExit()
      $codeSortiePreproc = $processusPreproc.ExitCode
      $sortieBrutePreproc = ''
      try { $sortieBrutePreproc = $tacheSortiePreproc.Result } catch { $sortieBrutePreproc = '' }
      $sortieVuePreproc = ([string]$sortieBrutePreproc).Trim()
      if ($sortieVuePreproc) {
        try { $statsPreproc = $sortieVuePreproc | ConvertFrom-Json -ErrorAction Stop } catch { $statsPreproc = $null }
      }
      # Un refus (§8 du contrat : suivi de modifications, fichier verrou...) sort avec un
      # code non nul mais N'EST PAS un echec technique -- la ligne JSON de stdout est deja
      # complete ($statsPreproc.refus), et c'est elle que le gabarit du rapport doit rendre
      # (page courte, le message et rien d'autre), jamais le texte generique ci-dessous.
      $refusePreprocInterne = [bool]($statsPreproc -and $statsPreproc.refus)
      # Code 1 (§8 du contrat, CODE_ALERTE_ERROR) : le nettoyage a REUSSI -- .docx ecrit,
      # annote, rapport ecrit -- il reste seulement des alertes de niveau error a traiter.
      # Ce n'est un echec que si $statsPreproc manque ou ne confirme pas d'alerte error.
      $alerteBloquantePreproc = [bool]($statsPreproc -and -not $refusePreprocInterne `
        -and ($processusPreproc.ExitCode -eq 1) -and ([int]$statsPreproc.alertes_error -gt 0))
      $okPreproc = ($processusPreproc.ExitCode -eq 0) -or $refusePreprocInterne -or $alerteBloquantePreproc
      if ((-not $alerteBloquantePreproc) -and (-not $okPreproc)) {
        # Une phrase qui dit quoi faire ; la cause technique (dernieres lignes de stderr)
        # est gardee a part pour le journal technique.
        $textePreproc = (T 'lanceur.preproc.echec.inconnu' @($SzhSupport))
        $detailPreproc = [string]::Join(' | ', $dernieresLignesErreurPreproc.ToArray())
      }
    }
  } catch {
    $okPreproc = $false
    $textePreproc = $_.Exception.Message
    $echecPhasePreproc = $phasePreproc
  } finally {
    try {
      if ($processusPreproc -and -not $processusPreproc.HasExited) { $processusPreproc.Kill() }
      if ($processusPreproc) { $processusPreproc.Dispose() }
    } catch { }
    $script:ctxPreproc.Form.Cursor = [System.Windows.Forms.Cursors]::Default
    foreach ($boutonRallumePreproc in $script:preprocBoutons) { $boutonRallumePreproc.Enabled = $true }
    if ($BarreProgression) {
      $BarreProgression.Style = 'Marquee'
      $BarreProgression.MarqueeAnimationSpeed = 0
      $BarreProgression.Value = 0
    }
    if ($BoutonInterrompre) { $BoutonInterrompre.Enabled = $false }
  }
  # Compteurs d'usage et, pour un defaut du logiciel, rapport d'erreur : jamais le texte du
  # message ni le journal, voir Send-SzhConstatsNettoyeur.
  try {
    Send-SzhConstatsNettoyeur -Stats $statsPreproc -CodeSortie $codeSortiePreproc `
      -Interrompu $futAnnulePreproc -PhaseEchec $echecPhasePreproc -Produit $Produit `
      -CheminManuscrit $CheminManuscrit -Ok $okPreproc
  } catch { }
  return [pscustomobject]@{
    ok                = $okPreproc
    texte             = $textePreproc
    stats             = $statsPreproc
    dossier           = $dossierSortiePreproc
    produit           = $Produit
    alertesBloquantes = $alerteBloquantePreproc
    manuscrit         = $CheminManuscrit
    detail            = $detailPreproc
    rapportTemporaire = $cheminRapportTemporairePreproc
  }
}

# Rend rapport-manuscrit.twig (lib/gabarits.js, via outils/rendre-gabarit.js -- meme moteur
# que le reste du produit, meme mecanisme que Get-SzhCourriel dans szh-common.ps1 :
# VSCodium-en-Node, ELECTRON_RUN_AS_NODE=1, un aller-retour JSON sur stdin/stdout) et ecrit
# la page a cote du manuscrit. Rend le chemin Windows du fichier ecrit.
#
# $Stats est soit la ligne de statistiques d'une execution normale (le JSON complet est relu
# depuis $CheminRapportJson, le fichier temporaire, ou a defaut depuis sortie_rapport), soit
# l'enveloppe courte d'un refus -- tout est deja dans $Stats. $CheminManuscrit (Windows) donne
# le dossier et le nom de la page ecrite ; sans lui, 'entree' de $Stats en tient lieu. $Produit,
# deja choisi par la personne avant de lancer le nettoyage, comble ce que le nettoyeur ne sait
# pas encore sur un refus (§8 du contrat).
function New-SzhRapportManuscrit {
  param(
    [Parameter(Mandatory = $true)]$Stats,
    [Parameter(Mandatory = $true)][string]$Produit,
    [string]$CheminManuscrit = '',
    [string]$CheminRapportJson = ''
  )
  $dossierCockpitRapport = Get-SzhDossierCockpit
  if (-not $dossierCockpitRapport) { throw 'dossier de l''extension du cockpit introuvable' }
  $cheminGabaritRapport = Join-Path $dossierCockpitRapport 'export-templates\rapport-manuscrit.twig'
  if (-not (Test-Path -LiteralPath $cheminGabaritRapport)) {
    throw ('rapport-manuscrit.twig introuvable dans ' + $dossierCockpitRapport)
  }

  $cheminManuscritWindowsRapport = $CheminManuscrit
  if (-not $cheminManuscritWindowsRapport) {
    $cheminManuscritWindowsRapport = ConvertTo-SzhCheminWindowsDepuisWsl ([string]$Stats.entree)
  }
  $dossierSortieRapport = Split-Path -Parent $cheminManuscritWindowsRapport
  $nomBaseRapport = [System.IO.Path]::GetFileNameWithoutExtension($cheminManuscritWindowsRapport)
  if ($Stats.refus) {
    $rapportJsonTexte = $Stats | ConvertTo-Json -Depth 6 -Compress
  } else {
    $cheminRapportWindows = $CheminRapportJson
    if (-not $cheminRapportWindows) {
      if (-not $Stats.sortie_rapport) { throw 'sortie_rapport absent de la ligne de statistiques' }
      $cheminRapportWindows = ConvertTo-SzhCheminWindowsDepuisWsl ([string]$Stats.sortie_rapport)
    }
    # Lu tel quel, jamais reconverti par ConvertFrom-Json/ConvertTo-Json (profondeur du
    # rapport bien au-dela de ce que ConvertTo-Json accepte sans -Depth explicite, et un
    # second passage arrondirait ou tronquerait des valeurs sans avertir personne) :
    # l'enveloppe plus bas s'assemble par CONCATENATION de texte JSON deja valide.
    $rapportJsonTexte = Get-Content -LiteralPath $cheminRapportWindows -Raw -Encoding UTF8
  }

  $enveloppeRapport = '{"chemin":' + ($cheminGabaritRapport | ConvertTo-Json -Compress) +
    ',"variables":{"produit":' + ($Produit | ConvertTo-Json -Compress) +
    ',"rapport":' + $rapportJsonTexte + '}}'

  $reponseRapport = Invoke-SzhNodeCockpit -Outil 'rendre-gabarit.js' -Entree $enveloppeRapport
  $objetRenduRapport = $null
  try { $objetRenduRapport = $reponseRapport.Sortie.Trim() | ConvertFrom-Json -ErrorAction Stop } catch { $objetRenduRapport = $null }
  if ($reponseRapport.CodeSortie -ne 0 -or (-not $objetRenduRapport) -or (-not $objetRenduRapport.ok)) {
    $detailRapport = ''
    if ($objetRenduRapport -and $objetRenduRapport.erreur) { $detailRapport = [string]$objetRenduRapport.erreur }
    if (-not $detailRapport) { $detailRapport = $reponseRapport.Erreur.Trim() }
    if (-not $detailRapport) { $detailRapport = 'code de sortie ' + $reponseRapport.CodeSortie }
    throw ('rendre-gabarit.js : ' + $detailRapport)
  }
  $contenuHtmlRapport = [string]$objetRenduRapport.blocs.contenu

  $cheminHtmlRapport = Join-Path $dossierSortieRapport ($nomBaseRapport + '-rapport.html')
  [System.IO.File]::WriteAllText($cheminHtmlRapport, $contenuHtmlRapport, (New-Object System.Text.UTF8Encoding($false)))
  return $cheminHtmlRapport
}

# Le journal de l'onglet : l'essentiel, en quelques lignes -- le resultat, le document et le
# rapport nommes (jamais un chemin), le compte des alertes ; en cas de refus ou d'echec, UNE
# phrase qui dit quoi faire. Le detail est dans le rapport (HTML et JSON), la cause technique
# dans le journal du lanceur.
function Show-SzhResultatPreproc($Resultat) {
  try {
    $refusePreproc = [bool]($Resultat.stats -and $Resultat.stats.refus)
    # Le rapport HTML se rend dans les DEUX cas (refus compris, §8 : « page courte, le
    # message et rien d'autre ») -- seul un vrai echec technique (WSL absente, CLI introuvable,
    # processus tue) n'a rien a rendre : $Resultat.ok reste faux dans ce cas-la seulement. Rendu
    # AVANT les lignes du journal, pour pouvoir nommer la page.
    $cheminHtmlPreproc = ''
    $erreurRapportPreproc = ''
    if ($Resultat.ok -and $Resultat.stats) {
      try {
        $cheminHtmlPreproc = New-SzhRapportManuscrit -Stats $Resultat.stats -Produit $Resultat.produit -CheminManuscrit $Resultat.manuscrit -CheminRapportJson $Resultat.rapportTemporaire
        if ($cheminHtmlPreproc -and (Test-Path -LiteralPath $cheminHtmlPreproc)) {
          Start-Process $cheminHtmlPreproc
        }
      } catch {
        $erreurRapportPreproc = $_.Exception.Message
        # Un defaut du logiciel, pas du manuscrit : rapport d'erreur, sans le message (il
        # citerait un chemin), seulement le type de l'exception.
        Send-SzhRapportNettoyeur -Etape 'rendu-rapport' -Produit ([string]$Resultat.produit) `
          -Contenu (ConvertTo-SzhNettoyeurContenu -Echec 'rendu-rapport' -TypeException $_.Exception.GetType().Name)
      }
    }

    if ($Resultat.ok -and -not $refusePreproc) {
      $nomSortiePreproc = ''
      if ($Resultat.stats -and $Resultat.stats.sortie) {
        $nomSortiePreproc = [System.IO.Path]::GetFileName([string]$Resultat.stats.sortie)
      }
      if ($Resultat.alertesBloquantes -and $nomSortiePreproc) {
        # Nettoyage reussi (§8 du contrat : code 1 = alerte error, pas un echec), mais des
        # erreurs restent a traiter -- le ton reste celui d'une attention.
        Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.echec' @((T 'lanceur.preproc.resultat.document.alertes' @($nomSortiePreproc))))
      } elseif ($Resultat.alertesBloquantes) {
        Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.echec' @((T 'lanceur.preproc.resultat.termine')))
      } elseif ($nomSortiePreproc) {
        Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.ok' @((T 'lanceur.preproc.resultat.document' @($nomSortiePreproc))))
      } else {
        Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.ok' @((T 'lanceur.preproc.resultat.termine')))
      }
      if ($cheminHtmlPreproc) {
        Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.rapport' @((Split-Path -Leaf $cheminHtmlPreproc)))
      }
      if ($Resultat.stats) {
        Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.compte' @(
          [int]$Resultat.stats.alertes_error, [int]$Resultat.stats.alertes_warning, [int]$Resultat.stats.alertes_suggestion))
      }
    } elseif ($refusePreproc) {
      $texteRefusPreproc = [string]$Resultat.stats.message
      if (-not $texteRefusPreproc) { $texteRefusPreproc = (T 'lanceur.preproc.echec.inconnu' @($SzhSupport)) }
      Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.refus' @($texteRefusPreproc))
    } else {
      $texteEchecPreproc = $Resultat.texte
      if (-not $texteEchecPreproc) { $texteEchecPreproc = (T 'lanceur.preproc.echec.inconnu' @($SzhSupport)) }
      Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.resultat.echec' @($texteEchecPreproc))
    }
    if ($erreurRapportPreproc) {
      Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.erreur' @($erreurRapportPreproc))
    }
    if ($Resultat.detail) { Write-SzhLog ('open-produit : nettoyeur, derniere progression : ' + $Resultat.detail) }
    if ($Resultat.stats -and $Resultat.stats.detail) { Write-SzhLog ('open-produit : nettoyeur, detail : ' + $Resultat.stats.detail) }
    if ($Resultat.ok -and $Resultat.dossier) {
      $script:preprocDossierCourant = $Resultat.dossier
      $script:boutonPreprocDossier.Enabled = $true
    }
  } finally {
    # Le JSON temporaire part dans TOUS les cas : succes, refus, echec, rendu en erreur.
    Remove-SzhRapportTemporaire $Resultat.rapportTemporaire
  }
}

# Construit la page : produit, format de sortie, bouton du nettoyeur, journal de progression,
# « Ouvrir le dossier », barre et « Interrompre ».
#
# Le contexte, une table :
#   Form         le formulaire du lanceur (curseur d'attente, parent de la boite de fichier)
#   XPage / LargeurPage / YNouveau  la geometrie commune des pages du TabControl
# Rend le TabPage, non ajoute au TabControl : l'ordre des onglets est decide par l'appelant.
function New-SzhPagePreproc($Contexte) {
  $script:ctxPreproc = $Contexte
  $xPage = $Contexte.XPage
  $largeurPage = $Contexte.LargeurPage
  $yNouveau = $Contexte.YNouveau

  $pagePreproc = New-Object System.Windows.Forms.TabPage
  $pagePreproc.Text = (T 'lanceur.preproc')
  $pagePreproc.Tag = ''          # pas un produit : « Ouvrir » n'a rien a ouvrir ici
  $pagePreproc.UseVisualStyleBackColor = $true

  $introPreproc = New-Object System.Windows.Forms.Label
  $introPreproc.Text = (T 'lanceur.preproc.intro')
  $introPreproc.Location = New-Object System.Drawing.Point($xPage, 10)
  $introPreproc.AutoSize = $true
  $pagePreproc.Controls.Add($introPreproc)

  $etiqProduitPreproc = New-Object System.Windows.Forms.Label
  $etiqProduitPreproc.Text = (T 'lanceur.preproc.produit')
  $etiqProduitPreproc.Location = New-Object System.Drawing.Point($xPage, 37)
  $etiqProduitPreproc.AutoSize = $true
  $pagePreproc.Controls.Add($etiqProduitPreproc)

  # Revue / Zeitschrift : deux noms de produit, jamais traduits (comme $SzhProduits.onglet,
  # szh-produits.ps1) -- le choix pilote le jeu de regles et la langue passee a la CLI.
  $script:radioPreprocRevue = New-Object System.Windows.Forms.RadioButton
  $script:radioPreprocRevue.Text = 'Revue'
  $script:radioPreprocRevue.Location = New-Object System.Drawing.Point(($xPage + 70), 34)
  $script:radioPreprocRevue.Size = New-Object System.Drawing.Size(90, 23)
  $script:radioPreprocRevue.Checked = $true
  $pagePreproc.Controls.Add($script:radioPreprocRevue)

  $script:radioPreprocZeitschrift = New-Object System.Windows.Forms.RadioButton
  $script:radioPreprocZeitschrift.Text = 'Zeitschrift'
  $script:radioPreprocZeitschrift.Location = New-Object System.Drawing.Point(($xPage + 170), 34)
  $script:radioPreprocZeitschrift.Size = New-Object System.Drawing.Size(120, 23)
  $pagePreproc.Controls.Add($script:radioPreprocZeitschrift)

  # Format de sortie : Word (.docx, coche par defaut, retrocompatible) ou OpenDocument (.odt) --
  # point 4 du chantier "gabarits Pronto FR/DE + ODT" (29.09.2026). Les deux boutons vivent dans
  # un Panel a eux, jamais directement sur $pagePreproc : WinForms groupe par CONTENEUR les
  # RadioButton qui n'ont pas de GroupBox explicite -- les poser a plat aupres de
  # radioPreprocRevue/Zeitschrift en ferait un seul groupe de quatre boutons mutuellement
  # exclusifs, cassant le choix du produit. Rangee a y=64 (celle du bouton Manuscript cleaner,
  # decale plus bas) ; noms de format non traduits (comme Revue/Zeitschrift), etiquette
  # traduite (lanceur.preproc.format).
  $script:panelPreprocFormat = New-Object System.Windows.Forms.Panel
  $script:panelPreprocFormat.Location = New-Object System.Drawing.Point($xPage, 64)
  $script:panelPreprocFormat.Size = New-Object System.Drawing.Size(($largeurPage), 26)
  $pagePreproc.Controls.Add($script:panelPreprocFormat)

  $etiqFormatPreproc = New-Object System.Windows.Forms.Label
  $etiqFormatPreproc.Text = (T 'lanceur.preproc.format')
  $etiqFormatPreproc.Location = New-Object System.Drawing.Point(0, 3)
  $etiqFormatPreproc.AutoSize = $true
  $script:panelPreprocFormat.Controls.Add($etiqFormatPreproc)

  $script:radioPreprocDocx = New-Object System.Windows.Forms.RadioButton
  $script:radioPreprocDocx.Text = 'Word (.docx)'
  $script:radioPreprocDocx.Location = New-Object System.Drawing.Point(120, 0)
  $script:radioPreprocDocx.Size = New-Object System.Drawing.Size(110, 23)
  $script:radioPreprocDocx.Checked = $true
  $script:panelPreprocFormat.Controls.Add($script:radioPreprocDocx)

  $script:radioPreprocOdt = New-Object System.Windows.Forms.RadioButton
  $script:radioPreprocOdt.Text = 'OpenDocument (.odt)'
  $script:radioPreprocOdt.Location = New-Object System.Drawing.Point(240, 0)
  $script:radioPreprocOdt.Size = New-Object System.Drawing.Size(160, 23)
  $script:panelPreprocFormat.Controls.Add($script:radioPreprocOdt)

  # Nom de produit fixe par Robin, JAMAIS traduit, dans les trois langues -- ne passe donc
  # pas par T (voir l'en-tete de szh-textes.ps1 pour cette meme regle). Decale a y=94 (etait
  # y=64) pour laisser la place a la rangee "Format de sortie" ci-dessus ; le journal (y=162)
  # garde de la marge.
  $script:boutonManuscritPreproc = New-Object System.Windows.Forms.Button
  $script:boutonManuscritPreproc.Text = 'Manuscript cleaner (Article)…'
  $script:boutonManuscritPreproc.Location = New-Object System.Drawing.Point($xPage, 94)
  $script:boutonManuscritPreproc.Size = New-Object System.Drawing.Size(260, 30)
  $pagePreproc.Controls.Add($script:boutonManuscritPreproc)

  $script:etiqFichierPreproc = New-Object System.Windows.Forms.Label
  $script:etiqFichierPreproc.Text = (T 'lanceur.preproc.fichier.aucun')
  $script:etiqFichierPreproc.AutoSize = $false
  $script:etiqFichierPreproc.Location = New-Object System.Drawing.Point(($xPage + 270), 94)
  $script:etiqFichierPreproc.Size = New-Object System.Drawing.Size(($largeurPage - 270), 32)
  $script:etiqFichierPreproc.ForeColor = [System.Drawing.Color]::DimGray
  $pagePreproc.Controls.Add($script:etiqFichierPreproc)

  # Ce que le nettoyeur compte, où, pourquoi et combien de temps : dit en clair, sous le bouton,
  # avant la premiere utilisation (phrase unique, lanceur.preproc.compteurs).
  $etiqCompteursPreproc = New-Object System.Windows.Forms.Label
  $etiqCompteursPreproc.Text = (T 'lanceur.preproc.compteurs')
  $etiqCompteursPreproc.AutoSize = $false
  $etiqCompteursPreproc.Location = New-Object System.Drawing.Point($xPage, 128)
  $etiqCompteursPreproc.Size = New-Object System.Drawing.Size($largeurPage, 56)
  $etiqCompteursPreproc.ForeColor = [System.Drawing.Color]::DimGray
  $pagePreproc.Controls.Add($etiqCompteursPreproc)

  # Le journal de progression -- meme gabarit, meme budget vertical que celui du secretariat
  # (Consolas 9, lecture seule, y=162 a $yNouveau, deja eprouve sur tous les paliers de
  # hauteur d'ecran par cet onglet-la).
  $script:journalPreproc = New-Object System.Windows.Forms.TextBox
  $script:journalPreproc.Multiline = $true
  $script:journalPreproc.ReadOnly = $true
  $script:journalPreproc.ScrollBars = 'Vertical'
  $script:journalPreproc.Font = New-Object System.Drawing.Font('Consolas', 9)
  $script:journalPreproc.BackColor = [System.Drawing.Color]::White
  $script:journalPreproc.Location = New-Object System.Drawing.Point($xPage, 188)
  $script:journalPreproc.Size = New-Object System.Drawing.Size($largeurPage, ($yNouveau - 196))
  $pagePreproc.Controls.Add($script:journalPreproc)

  $script:preprocDossierCourant = ''
  $script:boutonPreprocDossier = New-Object System.Windows.Forms.Button
  $script:boutonPreprocDossier.Text = (T 'lanceur.preproc.dossier')
  $script:boutonPreprocDossier.Location = New-Object System.Drawing.Point($xPage, $yNouveau)
  $script:boutonPreprocDossier.Size = New-Object System.Drawing.Size(220, 30)
  $script:boutonPreprocDossier.Enabled = $false
  $pagePreproc.Controls.Add($script:boutonPreprocDossier)

  # Barre de progression et bouton d'interruption de l'onglet, memes coordonnees que celles
  # du secretariat (242 / 492, largeur 240 / 112) -- meme rangee, jusqu'a $xPage +
  # $largeurPage (604), sans jamais deborder.
  $script:barrePreproc = New-Object System.Windows.Forms.ProgressBar
  $script:barrePreproc.Location = New-Object System.Drawing.Point(242, $yNouveau)
  $script:barrePreproc.Size = New-Object System.Drawing.Size(240, 30)
  $script:barrePreproc.Style = 'Marquee'
  $script:barrePreproc.MarqueeAnimationSpeed = 0
  $pagePreproc.Controls.Add($script:barrePreproc)

  $script:etatAnnulationPreproc = @{ annule = $false }
  $script:boutonInterromprePreproc = New-Object System.Windows.Forms.Button
  $script:boutonInterromprePreproc.Text = (T 'lanceur.preproc.interrompre')
  $script:boutonInterromprePreproc.Location = New-Object System.Drawing.Point(492, $yNouveau)
  $script:boutonInterromprePreproc.Size = New-Object System.Drawing.Size(112, 30)
  $script:boutonInterromprePreproc.Enabled = $false
  $script:boutonInterromprePreproc.Add_Click({ $script:etatAnnulationPreproc.annule = $true })
  $pagePreproc.Controls.Add($script:boutonInterromprePreproc)

  $script:preprocBoutons = @($script:boutonManuscritPreproc)


  $script:cheminManuscritChoisi = ''

  $script:boutonManuscritPreproc.Add_Click({
    $boiteFichierPreproc = New-Object System.Windows.Forms.OpenFileDialog
    $boiteFichierPreproc.Title = (T 'lanceur.preproc.fichier.titre')
    $boiteFichierPreproc.Filter = (T 'lanceur.preproc.fichier.filtre')
    $boiteFichierPreproc.CheckFileExists = $true
    if ($boiteFichierPreproc.ShowDialog($script:ctxPreproc.Form) -ne [System.Windows.Forms.DialogResult]::OK) { return }
    $script:cheminManuscritChoisi = $boiteFichierPreproc.FileName
    $script:etiqFichierPreproc.Text = (T 'lanceur.preproc.fichier.choisi' @((Split-Path -Leaf $script:cheminManuscritChoisi)))

    $produitChoisiPreproc = 'revue'
    if ($script:radioPreprocZeitschrift.Checked) { $produitChoisiPreproc = 'zeitschrift' }

    $formatChoisiPreproc = 'docx'
    if ($script:radioPreprocOdt.Checked) { $formatChoisiPreproc = 'odt' }

    try {
      $resultatPreproc = Invoke-SzhManuscrit -CheminManuscrit $script:cheminManuscritChoisi -Produit $produitChoisiPreproc `
        -Format $formatChoisiPreproc `
        -Journal $script:journalPreproc -NomExport 'Manuscript cleaner (Article)' `
        -BarreProgression $script:barrePreproc -BoutonInterrompre $script:boutonInterromprePreproc `
        -EtatAnnulation $script:etatAnnulationPreproc
      Show-SzhResultatPreproc $resultatPreproc
    } catch {
      Add-SzhLigneJournal $script:journalPreproc (T 'lanceur.preproc.erreur' @($_.Exception.Message))
    }
  })

  $script:boutonPreprocDossier.Add_Click({
    if (-not $script:preprocDossierCourant) { return }
    try {
      if (Test-Path -LiteralPath $script:preprocDossierCourant) {
        Start-Process explorer.exe ('"' + $script:preprocDossierCourant + '"')
      }
    } catch {
      Write-SzhLog ('open-produit : ouverture du dossier de sortie (preproc) echouee (' + $_.Exception.Message + ')')
    }
  })

  return $pagePreproc
}
