<#
.SYNOPSIS
  Lanceur unique des trois produits du menu Demarrer -- "Revues SZH", "Zeitschriften SZH"
  et "Books SZH-CSPS" -- appele par hidden.vbs, donc sans console. Liste les numeros (ou
  les livres) en cours et archives du produit demande, ouvre celui qu'on choisit dans
  VSCodium, affiche et permet de changer la version installee.

  windows/open-revue.ps1 et windows/open-livre.ps1 restent les points d'entree que
  connaissent les raccourcis du menu Demarrer et le protocole "szh:" -- ce sont deux
  enveloppes de quelques lignes qui transmettent leurs parametres ici, avec le bon
  -Produit. Ce script-ci porte tout ce que les deux produits de revue et le livre ont en
  commun (fenetre, icone, identite de barre des taches, listes "en cours"/"archives",
  double-clic, boutons) ; ce qui les distingue vient de la table $SzhProduits
  (szh-produits.ps1) : fichier de configuration, fonction d'etat, textes, icone,
  AppUserModelID, presence des racines heritees, formulaire "Nouveau...".

    powershell -ExecutionPolicy Bypass -File open-produit.ps1 -Produit revue
    powershell -ExecutionPolicy Bypass -File open-produit.ps1 -Produit livre -Versions

  SZH_LANCEUR_SIMULE=1 : aucune classe WinForms n'est chargee, aucune fenetre ne s'ouvre --
  le script calcule tout ce qu'il aurait affiche (titre, listes, version installee,
  avertissements) et l'ecrit en JSON sur la sortie standard, puis sort. Sur le patron de
  SZH_OPENMD_SIMULE (open-md.ps1).

  Compatibilite : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Lien "szh://..." pour la revue et la Zeitschrift seulement (le protocole ne vise que
  # open-revue.ps1) : ouvre directement le numero vise. Positionnel, parce que hidden.vbs
  # requote chacun de ses arguments et qu'un "%1" requote se lie a un parametre positionnel.
  [Parameter(Position = 0)][string]$Lien,
  # revue | zeitschrift | livre. Une valeur inattendue ne doit pas lever : ce lanceur tourne
  # sans console, et vaut alors "revue" -- voir Get-SzhProduitInfo (szh-produits.ps1).
  [string]$Produit = 'revue',
  # Ouvre directement le selecteur de version, comme le bouton "Changer de version..." du
  # cockpit : une seule implementation (Show-SzhVersions, szh-common.ps1), atteignable des
  # trois cotes.
  [switch]$Versions
)

. "$PSScriptRoot\szh-common.ps1"

# Mode simulation (tests) : voir l'en-tete. Decide avant tout le reste, y compris avant les
# Add-Type WinForms qui suivent -- c'est justement ce qu'il ne faut pas charger ici.
$script:SzhSimule = ($env:SZH_LANCEUR_SIMULE -eq '1')

# Ecrit le JSON en octets UTF-8 directement sur le flux de sortie standard, hors de
# Write-Host / Write-Output : ceux-ci passent par l'encodage de la console (souvent une page
# de code ANSI ou OEM en PowerShell 5.1 non interactif), qui abime tout accent ou tiret long.
# Le lecteur (un test Node, ou un diagnostic) lit alors des octets UTF-8 propres.
function Write-SzhSimuleJson($Objet) {
  $json = ($Objet | ConvertTo-Json -Depth 8)
  $octets = [System.Text.Encoding]::UTF8.GetBytes($json)
  $flux = [Console]::OpenStandardOutput()
  $flux.Write($octets, 0, $octets.Length)
  $flux.Flush()
}

if (-not $script:SzhSimule) {
  # Sans console : une exception terminante n'y donne aucun message, seulement un lanceur
  # qui ne s'ouvre pas. D'ou le filet pose juste apres (trap).
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()
}

# Titre de secours pour le trap ci-dessous : en dur, parce que $titreFenetre (plus bas) peut
# ne pas encore exister si l'erreur survient tot. Calcule sur $Produit brut, pas encore
# normalise -- Get-SzhProduitInfo n'est pas encore utile pour un simple titre de secours.
$titreSecours = 'Revues SZH'
if (([string]$Produit).ToLower() -eq 'zeitschrift') { $titreSecours = 'Zeitschriften SZH' }
elseif (([string]$Produit).ToLower() -eq 'livre') { $titreSecours = 'Books SZH-CSPS' }

# `trap` plutot qu'un try/catch enveloppant : il couvre toute la portee sans reindenter une
# ligne. En simulation, jamais de MessageBox -- un test ne doit jamais rester bloque sur une
# boite de dialogue -- l'erreur part en JSON sur la sortie standard.
trap {
  $souci = $_.Exception.Message
  try { Write-SzhLog ('open-produit ERREUR (' + $Produit + ') : ' + $souci) } catch { }
  # Rapport d'erreur automatique et silencieux (docs/RAPPORTS-ERREUR.md) : Write-SzhRapport ne
  # bloque jamais, n'affiche rien et se tait de lui-même en simulation (D2, D5) -- rien
  # ci-dessous n'a besoin de savoir si on est en simulation ou non.
  try {
    $produitTrap = $null
    if ($produitFiltre) { $produitTrap = @{ type = $produitFiltre } }
    Write-SzhRapport -Code 'LANCEUR-TRAP' -Source 'lanceur' -Etape 'ouverture du lanceur' `
      -Message $souci -Pile $_.ScriptStackTrace -Produit $produitTrap
  } catch { }
  if ($script:SzhSimule) {
    try { Write-SzhSimuleJson ([pscustomobject]@{ produit = $Produit; erreur = $souci }) } catch { }
    exit 1
  }
  try {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.erreur' @($souci, $SzhSupport)), $titreSecours)
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show($souci, $titreSecours)
  }
  exit 1
}

# Normalisation a la main plutot que [ValidateSet] : une valeur inattendue ne doit pas lever.
$produitFiltre = ([string]$Produit).ToLower()
if (-not $SzhProduits.ContainsKey($produitFiltre)) { $produitFiltre = 'revue' }
$Info = $SzhProduits[$produitFiltre]

# Avant le premier texte affiche : ce lanceur parle la langue de son produit (no-op pour le
# livre, qui n'en a pas -- voir Set-SzhLangueProduit dans szh-common.ps1).
Set-SzhLangueProduit $produitFiltre
$titreFenetre = (T $Info.texteTitre)

# ---- Icone des fenetres, et identite de barre des taches ----
$fichierIcone = Join-Path $PSScriptRoot $Info.icone

# La barre des taches range le bouton sous l'AppUserModelID du processus, pas sous l'icone
# de la fenetre : sans identite a nous, elle en deduit une de powershell.exe (l'hote lance
# par hidden.vbs) et affiche l'icone de PowerShell. Declaree ici, donc avant la premiere
# fenetre -- Windows lit l'identite au moment ou la fenetre s'inscrit a la barre, et ne la
# relit jamais ensuite. Sans objet en simulation : aucune fenetre ne s'inscrit nulle part.
if (-not $script:SzhSimule) {
  [void](Set-SzhAppUserModelId (Get-SzhAppId $Info.appId))
}

# Lecture en tableau d'octets et non par nom de fichier : Icon(String) garderait le .ico
# ouvert tant que la fenetre vit. Ne leve jamais, une icone n'etant pas une condition
# d'ouverture. Jamais appelee en simulation (System.Drawing n'y est pas charge).
function Set-SzhIconeFenetre($Fenetre) {
  if ($script:SzhSimule) { return }
  if (-not (Test-Path $fichierIcone)) { return }
  try {
    $flux = New-Object System.IO.MemoryStream (,[System.IO.File]::ReadAllBytes($fichierIcone))
    $Fenetre.Icon = New-Object System.Drawing.Icon $flux
  } catch {
    Write-SzhLog ('open-produit : icone non chargee (' + $_.Exception.Message + ')')
  }
}

# Cadenas si l'entree est verrouillee ; etiquette du dossier ou du titre selon le produit
# (etiquetteChamp) -- une revue montre le nom du dossier, un livre son titre repli sur le nom.
function Format-SzhEntree($ProduitInfo, $Entree) {
  $etiquette = $Entree.nom
  if (($ProduitInfo.etiquetteChamp -eq 'titre') -and $Entree.titre) { $etiquette = $Entree.titre }
  $texte = (T $ProduitInfo.texteModifie @($etiquette, $Entree.modifie.ToString('dd.MM.yyyy')))
  # U+1F512 cadenas ferme : ConvertFromUtf32 plutot que deux demi-paires additionnees.
  if ($Entree.verrouillee) { return ([System.Char]::ConvertFromUtf32(0x1F512) + ' ' + $texte) }
  return $texte
}

# Avant le test VSCodium, expres : c'est l'outil de reparation d'une installation abimee, le
# mettre derriere la chose a reparer le rendrait inatteignable.
if ($Versions) {
  Write-SzhLog ('open-produit : selecteur de versions demande (' + $produitFiltre + ')')
  if ($script:SzhSimule) {
    $r = [ordered]@{ produit = $produitFiltre; versions = $true; versionInstallee = (Get-SzhVersionInstallee) }
    Write-SzhSimuleJson $r
    exit 0
  }
  Show-SzhVersions $null $fichierIcone
  exit 0
}

$codium = Get-VSCodiumExe
# En simulation, l'absence de VSCodium ne doit pas empecher de calculer les listes : un poste
# de test n'a pas de raison de l'avoir installe. Le champ codiumTrouve du JSON le dit.
if ((-not $codium) -and (-not $script:SzhSimule)) {
  try { Write-SzhRapport -Code 'LANCEUR-CODIUM-ABSENT' -Source 'lanceur' -Etape 'démarrage du lanceur' -Produit @{ type = $produitFiltre } } catch { }
  [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.codium' @($SzhSupport)), $titreFenetre)
  exit 1
}

# ---- Ancrage SharePoint : resolu (et, au besoin, demande) UNE SEULE FOIS ici ----
# Initialize-SzhAncrage (szh-ancrage.ps1) est la seule fonction habilitee a ouvrir le
# selecteur de dossier (amendement du 09.09.2026, garde-fou anti-harcelement compris) ;
# ce lanceur est son seul appelant autorise, une seule fois par lancement. open-md.ps1 et
# archive-revue.ps1, qui tournent sans console, continuent de passer par la seule
# resolution passive (Resolve-SzhAncrage, via Get-SzhBaseRevuesPour) et ne demandent
# jamais rien -- ce n'est pas a eux d'ouvrir cette fenetre.
#
# Placee APRES le controle VSCodium ci-dessus, expres : si l'editeur manque, ce script va
# de toute facon s'arreter juste au-dessus (MessageBox + exit) sans rien ouvrir d'autre --
# inutile de faire chercher un dossier SharePoint a quelqu'un a qui on va ensuite dire que
# l'outil ne peut pas demarrer du tout. Placee AVANT le lien "szh://..." ci-dessous et
# "Racines a balayer" plus bas : Find-SzhRevue (lien) et Get-SzhEmplacements (racines)
# dependent tous les deux de Get-SzhBaseRevuesPour, qui lit l'ancrage -- ils doivent le
# voir deja rattache, sans quoi la liste resterait vide sans que la personne n'ait meme eu
# l'occasion d'indiquer son dossier SharePoint.
#
# En simulation (SZH_LANCEUR_SIMULE=1), Initialize-SzhAncrage ne demande jamais rien
# (szh-ancrage.ps1) : cet appel est donc sans danger ici, et alimente aussi le JSON de
# simulation plus bas. D5 (regle absolue) : si rien n'est trouve et que la personne
# annule ou ne repond pas, $ancrageResolu.chemin reste vide et le lanceur poursuit
# normalement -- il ne s'arrete pas, il ne bloque pas ; les produits resteront
# introuvables, ce que dit la ligne de journal ci-dessous et, plus bas, le bloc
# d'informations de la fenetre.
$ancrageResolu = Initialize-SzhAncrage
if ($ancrageResolu.chemin) {
  Write-SzhLog ('open-produit : ancrage SharePoint "{0}" (origine {1})' -f $ancrageResolu.chemin, $ancrageResolu.origine)
} else {
  Write-SzhLog ('open-produit : ancrage SharePoint introuvable (origine {0})' -f $ancrageResolu.origine)
}

# Rapport d'erreur ANCRAGE-INTROUVABLE (docs/RAPPORTS-ERREUR.md §7) : seulement quand une VRAIE
# demande a ete faite et n'a rien donne (origine "absent") -- jamais quand la demande a ete
# evitee par l'anti-harcelement ou la simulation (origine "defaut"), un cas frequent et
# attendu qui ne doit pas produire un rapport a chaque lancement.
if ($ancrageResolu.origine -eq 'absent') {
  try { Write-SzhRapport -Code 'ANCRAGE-INTROUVABLE' -Source 'lanceur' -Etape (T 'ancrage.demande.titre') -Produit @{ type = $produitFiltre } } catch { }
}

# Vidage de la file d'attente des rapports d'erreur hors ligne (docs/RAPPORTS-ERREUR.md §6) :
# silencieux, jamais bloquant -- l'ancrage vient d'etre resolu, c'est le bon moment pour
# retenter les rapports ecrits hors ligne depuis le dernier lancement.
try { Clear-SzhRapportsEnAttente } catch { }

# ---- Lien "szh://..." recu : on ouvre, on ne liste pas ----
# Seuls revue et zeitschrift ont une grammaire de lien (Get-SzhLien) ; le livre n'y figure
# jamais, $Lien restant vide pour lui (open-livre.ps1 ne le transmet pas).
if ($Lien) {
  $cible = Get-SzhLien $Lien
  if (-not $cible) {
    if ($script:SzhSimule) {
      Write-SzhSimuleJson ([pscustomobject]@{ produit = $produitFiltre; lien = $Lien; erreur = 'invalide' })
      exit 1
    }
    [void][System.Windows.Forms.MessageBox]::Show((T 'lien.invalide' @($Lien)), $titreFenetre)
    exit 1
  }
  # Le protocole szh:// est enregistre sans -Produit -- le lien connait son propre produit,
  # c'est lui qui doit parler ici, pas le defaut du parametre -Produit. Sans ce second appel,
  # un clic sur un lien Zeitschrift depuis Outlook ecrirait quand meme la langue de
  # $produitFiltre dans state.json (un reglage de poste, partage par tous les comptes).
  Set-SzhLangueProduit $cible.produit
  $infoLien = Get-SzhProduitInfo $cible.produit
  $titreFenetre = (T $infoLien.texteTitre)
  $dossierLien = Find-SzhRevue $cible.produit $cible.numero
  if (-not $dossierLien) {
    if ($script:SzhSimule) {
      Write-SzhSimuleJson ([pscustomobject]@{ produit = $produitFiltre; lien = $Lien; erreur = 'introuvable' })
      exit 1
    }
    [void][System.Windows.Forms.MessageBox]::Show(
      (T 'lien.introuvable' @($cible.numero, $cible.produit)), $titreFenetre)
    exit 1
  }
  # A usage unique, jamais bloquante : sans elle, la revue s'ouvre sans aller droit au panneau.
  try { Set-SzhIntention $dossierLien $cible.vue $cible.article } catch { }
  if ($script:SzhSimule) {
    Write-SzhSimuleJson ([pscustomobject]@{ produit = $produitFiltre; lien = $Lien; dossier = $dossierLien })
    exit 0
  }
  [void](Start-SzhCodium $dossierLien)
  exit 0
}

# ---- Racines a balayer ----
$emplacements = Get-SzhEmplacements
# Les six dossiers de test sont crees s'ils manquent ; en production, rien n'est cree.
[void](Initialize-SzhEmplacementsTest)
$encoursProduit = Get-SzhEmplacementRevue $Info.jeton 'encours'
$archiveProduit = Get-SzhEmplacementRevue $Info.jeton 'archive'
$racines = @($encoursProduit, $archiveProduit)
$racinesArchives = @{}
$racinesArchives[$archiveProduit.ToLower()] = $true

# Racines heritees (config.json `revuesRoots`, OneDrive\Revues) : seulement pour revue et
# zeitschrift -- elles n'ont jamais concerne le livre.
$horsArborescence = 0
$dossierHors = ''
if ($Info.racinesHeritees) {
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

  foreach ($racine in $racinesHeritees) {
    if (-not (Test-Path $racine)) { continue }
    $trouvees = @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName $Info.manifeste) })
    if ($trouvees.Count -gt 0) {
      $horsArborescence += $trouvees.Count
      if (-not $dossierHors) { $dossierHors = $racine }
    }
  }
}

# ---- Decouverte (dossier contenant le manifeste du produit) ----
# Une entree est archivee si son manifeste le dit (`archived: true`) ou si elle est sous une
# racine d'archives : un dossier deplace a la main reste classe la ou il est.
$enCours = New-Object System.Collections.ArrayList
$archives = New-Object System.Collections.ArrayList
$vus = @{}
foreach ($racine in $racines) {
  if (-not $racine) { continue }
  if (-not (Test-Path $racine)) { continue }
  $sousArchives = $racinesArchives.ContainsKey($racine.ToLower())
  Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $_
    if (Test-Path (Join-Path $d.FullName $Info.manifeste)) {
      $cle = $d.FullName.ToLower()
      if (-not $vus.ContainsKey($cle)) {
        $vus[$cle] = $true
        $etat = & $Info.etatFn $d.FullName
        # Le produit vient du jeton du manifeste, pas de l'emplacement : un numero range cote
        # Zeitschrift mais declarant "revue: revue" n'apparait pas ici. Sans objet pour le
        # livre (filtrerJeton = $false), qui n'a qu'un seul jeton.
        if ($Info.filtrerJeton -and ($etat.jeton -ne $Info.jeton)) { return }
        $entree = [pscustomobject]@{
          nom         = $d.Name
          titre       = $etat.titre
          chemin      = $d.FullName
          modifie     = $d.LastWriteTime
          verrouillee = $etat.verrouillee
          archivee    = ($etat.archivee -or $sousArchives)
        }
        if ($entree.archivee) { [void]$archives.Add($entree) }
        else { [void]$enCours.Add($entree) }
      }
    }
  }
}
$enCours = @($enCours | Sort-Object modifie -Descending)
$archives = @($archives | Sort-Object nom -Descending)

# Pas de sortie anticipee quand il n'y a aucune entree : la fenetre s'ouvre quand meme, pour
# offrir "Nouveau..." sur un poste vierge.

# ---- Le bloc d'informations, calcule avant la mise en page (ou avant le JSON) ----
# Mode test : $emplacements.emplacement decide seul, jamais une autre lecture de la config.
$modeTest = ($emplacements.emplacement -eq $SzhEmplacementTest)
$lignesInfo = @()
if ($modeTest) { $lignesInfo += (T 'lanceur.modeTest') }
$vInstallee = Get-SzhVersionInstallee
if ($vInstallee) { $lignesInfo += (T 'lanceur.version' @($vInstallee)) }
else { $lignesInfo += (T 'lanceur.version.inconnue') }
$lignesInfo += (T $Info.texteTest @($emplacements.base))
# Ancrage SharePoint absent : dit pourquoi la liste ci-dessus est vide, sans rouvrir la
# moindre fenetre -- Initialize-SzhAncrage, plus haut, a deja fait tout ce qu'il pouvait
# faire pour cette fois (D5). Seulement en emplacement "production", et seulement si
# basesRevues.prod n'est pas configure a la main : dans ces deux autres cas, l'ancrage
# n'entre pour rien dans la racine effectivement utilisee (szh-produits.ps1,
# Get-SzhBaseRevuesPour), et le dire serait une fausse alerte.
if ((-not $modeTest) -and (-not $ancrageResolu.chemin)) {
  $cfgAncrageInfo = Get-SzhConfig
  $baseProdConfiguree = ($cfgAncrageInfo -and $cfgAncrageInfo.basesRevues -and $cfgAncrageInfo.basesRevues.prod)
  if (-not $baseProdConfiguree) { $lignesInfo += (T 'lanceur.ancrage.absent') }
}
$avertissementHors = ''
if ($Info.racinesHeritees -and ($horsArborescence -gt 0)) {
  $avertissementHors = (T 'lanceur.hors' @($horsArborescence, $dossierHors))
  $lignesInfo += $avertissementHors
}

# ---- Mode simulation : le JSON remplace la fenetre, et rien de WinForms n'est touche ----
if ($script:SzhSimule) {
  $versAvecLibelle = {
    param($liste)
    # Virgule unaire devant @() : sans elle, un tableau d'un seul element ressort de `&`
    # comme un objet nu, et ConvertTo-Json le serialise hors de tout tableau JSON --
    # exactement le cas d'une seule entree "en cours", le plus courant.
    ,@($liste | ForEach-Object {
      [ordered]@{
        nom         = $_.nom
        titre       = $_.titre
        chemin      = $_.chemin
        modifie     = $_.modifie.ToString('o')
        verrouillee = [bool]$_.verrouillee
        archivee    = [bool]$_.archivee
        libelle     = (Format-SzhEntree $Info $_)
      }
    })
  }
  $avertissements = New-Object System.Collections.ArrayList
  if ($avertissementHors) { [void]$avertissements.Add($avertissementHors) }
  if (-not $codium) { [void]$avertissements.Add('VSCodium introuvable sur ce poste') }
  $r = [ordered]@{
    produit          = $produitFiltre
    titreFenetre     = $titreFenetre
    etiquetteRacine  = (Get-SzhEtiquetteRacine)
    emplacement      = $emplacements.emplacement
    modeTest         = ($emplacements.emplacement -eq $SzhEmplacementTest)
    racineBase       = $emplacements.base
    ancrage          = [ordered]@{ chemin = $ancrageResolu.chemin; origine = $ancrageResolu.origine }
    racineEnCours    = $encoursProduit
    racineArchive    = $archiveProduit
    versionInstallee = $vInstallee
    codiumTrouve     = [bool]$codium
    enCours          = (& $versAvecLibelle $enCours)
    archives         = (& $versAvecLibelle $archives)
    avertissements   = @($avertissements)
  }
  Write-SzhSimuleJson $r
  exit 0
}

# ---- Fenetre de selection ----
$form = New-Object System.Windows.Forms.Form
$form.Text = $titreFenetre
$form.StartPosition = 'CenterScreen'
# Hauteur adaptee a l'ecran. Le processus ignore le DPI : sur un 1366x768 a 125 %, il ne
# "voit" que 614 px utiles, et FixedDialog interdit de deplacer une fenetre trop haute. On
# retrecit donc les listes, pas les boutons.
$hauteurUtile = 900
try { $hauteurUtile = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height } catch { }
$hListe = 208
$hArchives = 130
if ($hauteurUtile -lt 560) { $hListe = 96; $hArchives = 60 }
elseif ($hauteurUtile -lt 660) { $hListe = 136; $hArchives = 84 }
elseif ($hauteurUtile -lt 780) { $hListe = 170; $hArchives = 106 }
# Positions calculees plutot que constantes : label 22 px, marges 10 et 16 px.
$yListe = 66
$yEtiqArchives = $yListe + $hListe + 10
$yArchives = $yEtiqArchives + 22
$yInfos = $yArchives + $hArchives + 10
$yBoutons = $yInfos + 44 + 2
$form.ClientSize = New-Object System.Drawing.Size(520, ($yBoutons + 44))
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
Set-SzhIconeFenetre $form

$intro = New-Object System.Windows.Forms.Label
if (($enCours.Count + $archives.Count) -gt 0) { $intro.Text = (T $Info.texteChoisir) }
else { $intro.Text = (T $Info.texteVide) }
$intro.Location = New-Object System.Drawing.Point(16, 14)
$intro.AutoSize = $true
$form.Controls.Add($intro)

$etiqEnCours = New-Object System.Windows.Forms.Label
$etiqEnCours.Text = (T 'lanceur.encours')
$etiqEnCours.Location = New-Object System.Drawing.Point(16, 44)
$etiqEnCours.AutoSize = $true
$form.Controls.Add($etiqEnCours)

$liste = New-Object System.Windows.Forms.ListBox
$liste.Location = New-Object System.Drawing.Point(16, $yListe)
$liste.Size = New-Object System.Drawing.Size(488, $hListe)
$liste.Font = New-Object System.Drawing.Font('Segoe UI', 11)
foreach ($e in $enCours) { [void]$liste.Items.Add((Format-SzhEntree $Info $e)) }
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
foreach ($e in $archives) { [void]$listeArchives.Items.Add((Format-SzhEntree $Info $e)) }
if ($listeArchives.Items.Count -eq 0) { [void]$listeArchives.Items.Add((T $Info.texteVideArchives)) }
$form.Controls.Add($listeArchives)

# Une seule selection a la fois : cliquer dans une liste deselectionne l'autre.
$liste.Add_Click({ $listeArchives.ClearSelected() })
$listeArchives.Add_Click({ $liste.ClearSelected() })

# Hauteur reelle du bloc mesuree, et non devinee : un chemin de racine depasse la largeur du
# libelle et revient a la ligne -- WordBreak ne coupe qu'aux espaces, et un chemin Windows
# n'en a pas.
$infos = New-Object System.Windows.Forms.Label
$infos.AutoSize = $false
$infos.Width = 488
$infos.Text = ($lignesInfo -join "`n")
$hInfos = 44
try {
  $voulue = $infos.GetPreferredSize((New-Object System.Drawing.Size(488, 0))).Height + 8
  if ($voulue -gt $hInfos) { $hInfos = $voulue }
} catch { }
$infos.Location = New-Object System.Drawing.Point(16, $yInfos)
$infos.Size = New-Object System.Drawing.Size(488, $hInfos)
if ($modeTest) { $infos.ForeColor = [System.Drawing.Color]::Firebrick }
else { $infos.ForeColor = [System.Drawing.Color]::DimGray }
$form.Controls.Add($infos)
# Le bloc de boutons suit la hauteur reelle du texte d'info, pas la valeur de repli fixee
# plus haut pour le calcul de la fenetre -- recalcule ici, une fois $hInfos connu.
$yBoutons = $yInfos + $hInfos + 2
$form.ClientSize = New-Object System.Drawing.Size(520, ($yBoutons + 44))

$boutonOk = New-Object System.Windows.Forms.Button
$boutonOk.Text = (T 'lanceur.ouvrir')
$boutonOk.Location = New-Object System.Drawing.Point(318, $yBoutons)
$boutonOk.Size = New-Object System.Drawing.Size(90, 32)
$boutonOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$boutonOk.Enabled = (($enCours.Count + $archives.Count) -gt 0)
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
# Une mise a jour lancee, le lanceur se retire : il afficherait une version perimee.
$boutonVersions.Add_Click({
  if ((Show-SzhVersions $form $fichierIcone) -eq $true) {
    $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Close()
  }
})

# ---- "Nouveau..." : deux formulaires distincts (un numero n'a rien a voir avec un livre),
# choisis par $Info.nouveauFormulaire, puis new-revue.ps1 ou new-livre.ps1, puis ouverture ----

# Demande l'annee et le numero du numero a creer -- et rien d'autre. Le volume s'affiche
# grise, calcule d'apres l'annee (Get-SzhVolumePour), et le nom du dossier n'est qu'un
# affichage : il se deduit des deux nombres. Rend $null si annule, sinon
# { annee, numero, volume, nom }.
function Read-SzhNouveauNumero {
  $anneeMin = Get-SzhPremiereAnnee $produitFiltre
  $anneeMax = (Get-Date).Year + 5
  $anneeDefaut = (Get-Date).Year
  if ($anneeDefaut -lt $anneeMin) { $anneeDefaut = $anneeMin }

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.nouvelle') -replace '…', ''
  $boite.StartPosition = 'CenterParent'
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false

  # Bandeau du mode test : jamais en production, decide uniquement par l'emplacement actif
  # ($emplacements, calcule plus haut dans open-produit.ps1) -- decale tout le reste du
  # formulaire de sa hauteur reelle, mesuree et non devinee (comme $hOu plus bas).
  $modeTest = ($emplacements.emplacement -eq $SzhEmplacementTest)
  $decalage = 0
  if ($modeTest) {
    $etiqModeTest = New-Object System.Windows.Forms.Label
    $etiqModeTest.Text = (T 'lanceur.modeTest')
    $etiqModeTest.ForeColor = [System.Drawing.Color]::Firebrick
    $etiqModeTest.AutoSize = $true
    $etiqModeTest.MaximumSize = New-Object System.Drawing.Size(398, 0)
    $etiqModeTest.Location = New-Object System.Drawing.Point(16, 10)
    $boite.Controls.Add($etiqModeTest)
    $decalage = $etiqModeTest.PreferredSize.Height + 8
  }
  $boite.ClientSize = New-Object System.Drawing.Size(430, (296 + $decalage))   # ajustee plus bas

  $etiqAnnee = New-Object System.Windows.Forms.Label
  $etiqAnnee.Text = (T 'lanceur.nouvelle.annee')
  $etiqAnnee.Location = New-Object System.Drawing.Point(16, (21 + $decalage))
  $etiqAnnee.Size = New-Object System.Drawing.Size(96, 22)
  $boite.Controls.Add($etiqAnnee)

  # NumericUpDown plutot que TextBox : une annee et un numero sont des nombres dans des
  # bornes, il n'y a plus de saisie invalide a refuser par un message.
  $champAnnee = New-Object System.Windows.Forms.NumericUpDown
  $champAnnee.Location = New-Object System.Drawing.Point(118, (16 + $decalage))
  $champAnnee.Size = New-Object System.Drawing.Size(96, 28)
  $champAnnee.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champAnnee.Minimum = $anneeMin
  $champAnnee.Maximum = $anneeMax
  $champAnnee.Value = $anneeDefaut
  $boite.Controls.Add($champAnnee)

  $etiqNumero = New-Object System.Windows.Forms.Label
  $etiqNumero.Text = (T 'lanceur.nouvelle.numero')
  $etiqNumero.Location = New-Object System.Drawing.Point(16, (57 + $decalage))
  $etiqNumero.Size = New-Object System.Drawing.Size(96, 22)
  $boite.Controls.Add($etiqNumero)

  # 1 a 99 : la convention "AAAA-NN" du nom de dossier tient le numero sur deux chiffres.
  $champNumero = New-Object System.Windows.Forms.NumericUpDown
  $champNumero.Location = New-Object System.Drawing.Point(118, (52 + $decalage))
  $champNumero.Size = New-Object System.Drawing.Size(96, 28)
  $champNumero.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champNumero.Minimum = 1
  $champNumero.Maximum = 99
  $champNumero.Value = 1
  $boite.Controls.Add($champNumero)

  $etiqVolume = New-Object System.Windows.Forms.Label
  $etiqVolume.Text = (T 'lanceur.nouvelle.volume')
  $etiqVolume.Location = New-Object System.Drawing.Point(16, (93 + $decalage))
  $etiqVolume.Size = New-Object System.Drawing.Size(96, 22)
  $boite.Controls.Add($etiqVolume)

  # Desactive, donc grise : le volume se lit, il ne se saisit pas -- tant que le bouton
  # ci-dessous n'a pas ete presse.
  $champVolume = New-Object System.Windows.Forms.NumericUpDown
  $champVolume.Location = New-Object System.Drawing.Point(118, (88 + $decalage))
  $champVolume.Size = New-Object System.Drawing.Size(96, 28)
  $champVolume.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champVolume.Minimum = 1
  $champVolume.Maximum = 999
  $champVolume.Value = 1
  $champVolume.Enabled = $false
  $boite.Controls.Add($champVolume)

  # Le volume se deduit d'une droite verifiee sur neuf millesimes, mais une revue peut sauter
  # un volume ou en doubler un. Ce bouton est la sortie de secours, deconseillee : un volume
  # faux s'imprime sur la couverture et part dans OJS sans que rien ne le signale.
  $boutonManuel = New-Object System.Windows.Forms.Button
  $boutonManuel.Text = (T 'lanceur.nouvelle.volume.manuel')
  $boutonManuel.Location = New-Object System.Drawing.Point(118, (122 + $decalage))
  $boutonManuel.Size = New-Object System.Drawing.Size(296, 30)
  $boite.Controls.Add($boutonManuel)

  # Un libelle, pas un champ : le nom du dossier est montre et ne se change pas.
  $etiqDossier = New-Object System.Windows.Forms.Label
  $etiqDossier.Location = New-Object System.Drawing.Point(16, (166 + $decalage))
  $etiqDossier.Size = New-Object System.Drawing.Size(398, 22)
  $etiqDossier.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
  $boite.Controls.Add($etiqDossier)

  # Hauteur mesuree et non devinee : selon la racine active, ce chemin tient sur deux lignes
  # comme sur quatre.
  $ou = New-Object System.Windows.Forms.Label
  $ou.AutoSize = $false
  $ou.Width = 398
  $ou.Text = (T 'lanceur.nouvelle.ou' @($encoursProduit))
  $hOu = 46
  try {
    $vouluOu = $ou.GetPreferredSize((New-Object System.Drawing.Size(398, 0))).Height + 8
    if ($vouluOu -gt $hOu) { $hOu = $vouluOu }
  } catch { }
  $ou.Location = New-Object System.Drawing.Point(16, (192 + $decalage))
  $ou.Size = New-Object System.Drawing.Size(398, $hOu)
  $ou.ForeColor = [System.Drawing.Color]::DimGray
  $boite.Controls.Add($ou)

  $yBoutonsBoite = 192 + $decalage + $hOu + 12
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

  # Table de hachage et non une variable : un gestionnaire d'evenement peut modifier un objet,
  # il ne peut pas reassigner la variable locale d'une fonction.
  $etat = @{ manuel = $false }

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

  # Les deux refus se font ici, la boite ouverte : le remede est a un chiffre pres.
  $okBouton.Add_Click({
    $anneeOk = [int]$champAnnee.Value
    $numeroOk = [int]$champNumero.Value
    $volumeOk = [int]$champVolume.Value
    $nomOk = Get-SzhNomNumero $anneeOk $numeroOk
    if (Test-Path (Join-Path $encoursProduit $nomOk)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.existe' @($nomOk)), $titreFenetre)
      $boite.DialogResult = [System.Windows.Forms.DialogResult]::None
      return
    }
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

# Un livre n'a pas de "numero d'une annee" : il a un titre, une annee et une reference B --
# voir Get-SzhNomLivre dans szh-produits.ps1. Le formulaire demande donc ces trois-la, plus le
# type (monographie / ouvrage collectif) et la maquette (normal / FALC, et pour FALC le format
# standard ou A4). Rend $null si annule, sinon
# { titre, annee, reference, type, maquette, format, nom }.
function Read-SzhNouveauLivre {
  $anneeDefaut = (Get-Date).Year

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T 'lanceur.nouvelle.livre') -replace '…', ''
  $boite.StartPosition = 'CenterParent'
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false
  Set-SzhIconeFenetre $boite

  # Bandeau du mode test : jamais en production, decide uniquement par l'emplacement actif
  # ($emplacements, calcule plus haut dans open-produit.ps1) -- decale tout le reste du
  # formulaire de sa hauteur reelle, mesuree et non devinee (comme $hOu plus bas).
  $modeTest = ($emplacements.emplacement -eq $SzhEmplacementTest)
  $decalage = 0
  if ($modeTest) {
    $etiqModeTest = New-Object System.Windows.Forms.Label
    $etiqModeTest.Text = (T 'lanceur.modeTest')
    $etiqModeTest.ForeColor = [System.Drawing.Color]::Firebrick
    $etiqModeTest.AutoSize = $true
    $etiqModeTest.MaximumSize = New-Object System.Drawing.Size(398, 0)
    $etiqModeTest.Location = New-Object System.Drawing.Point(16, 10)
    $boite.Controls.Add($etiqModeTest)
    $decalage = $etiqModeTest.PreferredSize.Height + 8
  }

  $xChamp = 140
  $largeurChamp = 260

  $etiqTitre = New-Object System.Windows.Forms.Label
  $etiqTitre.Text = (T 'lanceur.nouvelle.livre.titre')
  $etiqTitre.Location = New-Object System.Drawing.Point(16, (19 + $decalage))
  $etiqTitre.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqTitre)

  $champTitre = New-Object System.Windows.Forms.TextBox
  $champTitre.Location = New-Object System.Drawing.Point($xChamp, (16 + $decalage))
  $champTitre.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champTitre.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $boite.Controls.Add($champTitre)

  $etiqAnnee = New-Object System.Windows.Forms.Label
  $etiqAnnee.Text = (T 'lanceur.nouvelle.annee')
  $etiqAnnee.Location = New-Object System.Drawing.Point(16, (55 + $decalage))
  $etiqAnnee.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqAnnee)

  # Bornes larges : un livre n'a pas de premier volume connu comme une revue
  # (Get-SzhPremiereAnnee ne s'applique qu'aux jetons revue/zeitschrift).
  $champAnnee = New-Object System.Windows.Forms.NumericUpDown
  $champAnnee.Location = New-Object System.Drawing.Point($xChamp, (52 + $decalage))
  $champAnnee.Size = New-Object System.Drawing.Size(110, 28)
  $champAnnee.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champAnnee.Minimum = 1990
  $champAnnee.Maximum = $anneeDefaut + 5
  $champAnnee.Value = $anneeDefaut
  $boite.Controls.Add($champAnnee)

  $etiqRef = New-Object System.Windows.Forms.Label
  $etiqRef.Text = (T 'lanceur.nouvelle.livre.reference')
  $etiqRef.Location = New-Object System.Drawing.Point(16, (91 + $decalage))
  $etiqRef.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqRef)

  # La reference B est un compteur tenu par la redaction, pas calcule : rien dans buch.yaml
  # ne le dit (il ne vit que dans le nom du dossier), il se saisit donc a la main.
  $champRef = New-Object System.Windows.Forms.NumericUpDown
  $champRef.Location = New-Object System.Drawing.Point($xChamp, (88 + $decalage))
  $champRef.Size = New-Object System.Drawing.Size(110, 28)
  $champRef.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  $champRef.Minimum = 1
  $champRef.Maximum = 9999
  $champRef.Value = 1
  $boite.Controls.Add($champRef)

  $etiqType = New-Object System.Windows.Forms.Label
  $etiqType.Text = (T 'lanceur.nouvelle.livre.type')
  $etiqType.Location = New-Object System.Drawing.Point(16, (127 + $decalage))
  $etiqType.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqType)

  $champType = New-Object System.Windows.Forms.ComboBox
  $champType.DropDownStyle = 'DropDownList'
  $champType.Location = New-Object System.Drawing.Point($xChamp, (124 + $decalage))
  $champType.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champType.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  [void]$champType.Items.Add((T 'lanceur.nouvelle.livre.type.mono'))
  [void]$champType.Items.Add((T 'lanceur.nouvelle.livre.type.collectif'))
  $champType.SelectedIndex = 0
  $boite.Controls.Add($champType)

  $etiqMaquette = New-Object System.Windows.Forms.Label
  $etiqMaquette.Text = (T 'lanceur.nouvelle.livre.maquette')
  $etiqMaquette.Location = New-Object System.Drawing.Point(16, (163 + $decalage))
  $etiqMaquette.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqMaquette)

  $champMaquette = New-Object System.Windows.Forms.ComboBox
  $champMaquette.DropDownStyle = 'DropDownList'
  $champMaquette.Location = New-Object System.Drawing.Point($xChamp, (160 + $decalage))
  $champMaquette.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champMaquette.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  [void]$champMaquette.Items.Add((T 'lanceur.nouvelle.livre.maquette.normal'))
  [void]$champMaquette.Items.Add((T 'lanceur.nouvelle.livre.maquette.falc'))
  $champMaquette.SelectedIndex = 0
  $boite.Controls.Add($champMaquette)

  $etiqFormat = New-Object System.Windows.Forms.Label
  $etiqFormat.Text = (T 'lanceur.nouvelle.livre.format')
  $etiqFormat.Location = New-Object System.Drawing.Point(16, (199 + $decalage))
  $etiqFormat.Size = New-Object System.Drawing.Size(118, 22)
  $boite.Controls.Add($etiqFormat)

  $champFormat = New-Object System.Windows.Forms.ComboBox
  $champFormat.DropDownStyle = 'DropDownList'
  $champFormat.Location = New-Object System.Drawing.Point($xChamp, (196 + $decalage))
  $champFormat.Size = New-Object System.Drawing.Size($largeurChamp, 26)
  $champFormat.Font = New-Object System.Drawing.Font('Segoe UI', 10)
  [void]$champFormat.Items.Add((T 'lanceur.nouvelle.livre.format.standard'))
  [void]$champFormat.Items.Add((T 'lanceur.nouvelle.livre.format.a4'))
  $champFormat.SelectedIndex = 0
  # Le format A4 n'existe qu'en FALC : hors FALC, le controle reste grise sur "standard".
  $champFormat.Enabled = $false
  $boite.Controls.Add($champFormat)

  $champMaquette.Add_SelectedIndexChanged({
    $estFalc = ($champMaquette.SelectedIndex -eq 1)
    $champFormat.Enabled = $estFalc
    if (-not $estFalc) { $champFormat.SelectedIndex = 0 }
  })

  # Un libelle, pas un champ : le nom du dossier est montre et ne se change pas.
  $etiqDossier = New-Object System.Windows.Forms.Label
  $etiqDossier.Location = New-Object System.Drawing.Point(16, (236 + $decalage))
  $etiqDossier.Size = New-Object System.Drawing.Size(398, 22)
  $etiqDossier.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
  $boite.Controls.Add($etiqDossier)

  $ou = New-Object System.Windows.Forms.Label
  $ou.AutoSize = $false
  $ou.Width = 398
  $ou.Text = (T 'lanceur.nouvelle.ou' @($encoursProduit))
  $hOu = 46
  try {
    $vouluOu = $ou.GetPreferredSize((New-Object System.Drawing.Size(398, 0))).Height + 8
    if ($vouluOu -gt $hOu) { $hOu = $vouluOu }
  } catch { }
  $ou.Location = New-Object System.Drawing.Point(16, (262 + $decalage))
  $ou.Size = New-Object System.Drawing.Size(398, $hOu)
  $ou.ForeColor = [System.Drawing.Color]::DimGray
  $boite.Controls.Add($ou)

  $yBoutonsBoite = 262 + $decalage + $hOu + 12
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

  # Les trois refus se font ici, la boite ouverte : titre manquant, dossier homonyme, ou
  # reference B deja prise (en cours ou aux archives).
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
    if (Test-Path (Join-Path $encoursProduit $nomOk)) {
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
$boutonNouvelle.Text = (T $Info.texteNouvelle)
$boutonNouvelle.Location = New-Object System.Drawing.Point(16, $yBoutons)
$boutonNouvelle.Size = New-Object System.Drawing.Size(130, 32)
$form.Controls.Add($boutonNouvelle)
$boutonNouvelle.Add_Click({
  # Pas de choix d'emplacement : une entree se cree dans le dossier "en cours" du produit de
  # ce lanceur. new-revue.ps1 et new-livre.ps1 ne prennent pas les memes parametres -- deux
  # branches de glue, mais toujours les deux memes fonctions de saisie ci-dessus.
  if ($Info.jeton -eq 'livre') {
    $neuf = & $Info.nouveauFormulaire
    if (-not $neuf) { return }
    $cible = Join-Path $encoursProduit $neuf.nom
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
  } else {
    $neuf = & $Info.nouveauFormulaire
    if (-not $neuf) { return }
    $cible = Join-Path $encoursProduit $neuf.nom
    try {
      # new-revue.ps1 copie le gabarit, pose le jeton `revue:`, l'annee, le numero, le
      # volume, l'estampille de version et "Ouvrir la revue.lnk".
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
  }
  [void](Start-SzhCodium (Resolve-Path -LiteralPath $cible).Path)
  $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel   # entree deja ouverte ci-dessus
  $form.Close()
})

# Double-clic = ouvrir, dans l'une comme dans l'autre liste.
$liste.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
$listeArchives.Add_DoubleClick({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })

$resultat = $form.ShowDialog()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK) {
  $choix = $null
  if ($liste.SelectedIndex -ge 0) { $choix = $enCours[$liste.SelectedIndex] }
  elseif (($listeArchives.SelectedIndex -ge 0) -and ($archives.Count -gt 0)) {
    $choix = $archives[$listeArchives.SelectedIndex]
  }
  if ($choix) { [void](Start-SzhCodium $choix.chemin) }
}
