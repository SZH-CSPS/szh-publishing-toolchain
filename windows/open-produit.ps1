<#
.SYNOPSIS
  Le lanceur du poste : une fenetre, quatre onglets -- Revue, Zeitschrift, Book, et les
  reglages. Appele par hidden.vbs depuis l'entree « Pronto » du menu Demarrer,
  donc sans console. Chaque onglet de produit liste les numeros (ou les livres) en cours et
  archives, et ouvre celui qu'on choisit dans VSCodium ; l'onglet des reglages decide lequel
  des trois s'ouvre au demarrage, et dans quelle langue.

  Il y avait trois lanceurs jusqu'au 13.09.2026, un par produit, chacun avec son entree de
  menu, son icone et sa langue. Un seul les remplace. Ce qui change vraiment, au-dela des
  onglets : la fenetre ne parle plus la langue de son produit mais UNE langue, celle du
  reglage -- un poste allemand lit donc l'onglet Revue en allemand. Set-SzhLangueProduit,
  qui ecrivait la langue du produit ouvert dans l'etat du POSTE (partage par tous les
  comptes), a disparu avec eux : c'est maintenant un choix, range par compte.

  windows/open-revue.ps1 et windows/open-livre.ps1 restent les points d'entree que
  connaissent les raccourcis et le protocole "szh:" -- deux enveloppes de quelques lignes
  qui transmettent leurs parametres ici. Ce qui distingue les trois produits vient de la
  table $SzhProduits (szh-produits.ps1) : fichier de configuration, fonction d'etat, textes,
  icone, presence des racines heritees, formulaire "Nouveau...". Rien n'est ecrit trois fois
  ci-dessous : la boucle sur $SzhOrdreOnglets fabrique les trois onglets du meme moule.

    powershell -ExecutionPolicy Bypass -File open-produit.ps1
    powershell -ExecutionPolicy Bypass -File open-produit.ps1 -Produit livre
    powershell -ExecutionPolicy Bypass -File open-produit.ps1 -Versions

  SZH_LANCEUR_SIMULE=1 : aucune classe WinForms n'est chargee, aucune fenetre ne s'ouvre --
  le script calcule tout ce qu'il aurait affiche (titre, onglet ouvert, les trois listes,
  version installee, avertissements) et l'ecrit en JSON sur la sortie standard, puis sort.
  Sur le patron de SZH_OPENMD_SIMULE (open-md.ps1).

  SZH_ONGLET=revue|zeitschrift|livre : force l'onglet ouvert, pour un essai. Sur le patron
  de SZH_LANGUE.

  Compatibilite : Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
  # Lien "szh://..." pour la revue et la Zeitschrift seulement (le protocole ne vise que
  # open-revue.ps1) : ouvre directement le numero vise, sans jamais montrer la fenetre.
  # Positionnel, parce que hidden.vbs requote chacun de ses arguments et qu'un "%1" requote
  # se lie a un parametre positionnel.
  [Parameter(Position = 0)][string]$Lien,
  # L'onglet a ouvrir : revue | zeitschrift | livre. VIDE par defaut, et c'est le changement
  # -- l'entree du menu Demarrer ne passe plus rien, et laisse donc le reglage du compte
  # decider (Get-SzhOngletDefaut). Un raccourci d'une version anterieure, reste epingle a la
  # barre des taches, porte encore -Produit revue ou -Produit zeitschrift : il continue
  # d'ouvrir SON onglet, ce qui est la moindre des choses pour qui l'a epingle. Une valeur
  # inattendue ne doit pas lever : ce lanceur tourne sans console.
  [string]$Produit = '',
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

# L'onglet a ouvrir, et le titre. Get-SzhOngletDefaut (szh-produits.ps1) enchaine les quatre
# sources : la langue du poste, le reglage du compte, -Produit, $env:SZH_ONGLET. Il rend
# toujours un jeton connu, jamais vide -- rien en dessous n'a donc a se demander quoi faire
# d'une valeur inattendue.
$ongletActif = Get-SzhOngletDefaut $Produit
$titreFenetre = (T 'lanceur.titre.suite' @($SzhNomApplication))

# Titre de secours pour le trap ci-dessous : $titreFenetre peut ne pas encore exister si
# l'erreur survient avant la ligne du dessus.
$titreSecours = $SzhNomApplication

# `trap` plutot qu'un try/catch enveloppant : il couvre toute la portee sans reindenter une
# ligne. En simulation, jamais de MessageBox -- un test ne doit jamais rester bloque sur une
# boite de dialogue -- l'erreur part en JSON sur la sortie standard.
trap {
  $souci = $_.Exception.Message
  try { Write-SzhLog ('open-produit ERREUR (' + $ongletActif + ') : ' + $souci) } catch { }
  # Rapport d'erreur automatique et silencieux (docs/RAPPORTS-ERREUR.md) : Write-SzhRapport ne
  # bloque jamais, n'affiche rien et se tait de lui-même en simulation (D2, D5) -- rien
  # ci-dessous n'a besoin de savoir si on est en simulation ou non.
  try {
    $produitTrap = $null
    if ($ongletActif) { $produitTrap = @{ type = $ongletActif } }
    Write-SzhRapport -Code 'LANCEUR-TRAP' -Source 'lanceur' -Etape 'ouverture du lanceur' `
      -Message $souci -Pile $_.ScriptStackTrace -Produit $produitTrap
  } catch { }
  if ($script:SzhSimule) {
    try { Write-SzhSimuleJson ([pscustomobject]@{ produit = $ongletActif; erreur = $souci }) } catch { }
    exit 1
  }
  try {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.erreur' @($souci, $SzhSupport)), $titreSecours)
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show($souci, $titreSecours)
  }
  exit 1
}

# ---- Icone des fenetres, et identite de barre des taches ----
# Une seule identite pour tout le lanceur, et non plus une par produit : il n'y a qu'une
# fenetre, et Windows range le bouton de la barre des taches sous l'AppUserModelID du
# PROCESSUS. Trois identites pour une fenetre lui feraient croire a trois programmes.
# Declaree ici, donc avant la premiere fenetre -- Windows lit l'identite au moment ou la
# fenetre s'inscrit a la barre, et ne la relit jamais ensuite. Sans objet en simulation :
# aucune fenetre ne s'inscrit nulle part.
#
# L'icone de la fenetre principale est celle de l'application, pronto.ico -- la meme que le
# raccourci du menu Demarrer (szh-shell.ps1) et que la mise a jour. Les trois icones de
# produit servent encore, elles, aux boites « Nouveau... » ouvertes depuis un onglet : la
# seule fenetre du lanceur qui appartienne a un seul produit.
$fichierIcone = Join-Path $PSScriptRoot 'pronto.ico'
if (-not $script:SzhSimule) {
  [void](Set-SzhAppUserModelId (Get-SzhAppId 'suite'))
}

# Lecture en tableau d'octets et non par nom de fichier : Icon(String) garderait le .ico
# ouvert tant que la fenetre vit. Ne leve jamais, une icone n'etant pas une condition
# d'ouverture. Jamais appelee en simulation (System.Drawing n'y est pas charge).
function Set-SzhIconeFenetre($Fenetre, [string]$Fichier = '') {
  if ($script:SzhSimule) { return }
  if (-not $Fichier) { $Fichier = $fichierIcone }
  if (-not (Test-Path $Fichier)) { return }
  try {
    $flux = New-Object System.IO.MemoryStream (,[System.IO.File]::ReadAllBytes($Fichier))
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
  Write-SzhLog ('open-produit : selecteur de versions demande (' + $ongletActif + ')')
  if ($script:SzhSimule) {
    $r = [ordered]@{ produit = $ongletActif; versions = $true; versionInstallee = (Get-SzhVersionInstallee) }
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
  try { Write-SzhRapport -Code 'LANCEUR-CODIUM-ABSENT' -Source 'lanceur' -Etape 'démarrage du lanceur' -Produit @{ type = $ongletActif } } catch { }
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
# Une seule fois pour les TROIS onglets, et non une par onglet : c'est le meme dossier
# SharePoint pour tout le monde, et trois demandes d'affilee au premier lancement seraient
# insupportables.
#
# Placee APRES le controle VSCodium ci-dessus, expres : si l'editeur manque, ce script va
# de toute facon s'arreter juste au-dessus (MessageBox + exit) sans rien ouvrir d'autre --
# inutile de faire chercher un dossier SharePoint a quelqu'un a qui on va ensuite dire que
# l'outil ne peut pas demarrer du tout. Placee AVANT le lien "szh://..." ci-dessous et
# l'inventaire plus bas : Find-SzhRevue (lien) et Get-SzhEmplacements (racines) dependent
# tous les deux de Get-SzhBaseRevuesPour, qui lit l'ancrage -- ils doivent le voir deja
# rattache, sans quoi les listes resteraient vides sans que la personne n'ait meme eu
# l'occasion d'indiquer son dossier SharePoint.
#
# En simulation (SZH_LANCEUR_SIMULE=1), Initialize-SzhAncrage ne demande jamais rien
# (szh-ancrage.ps1) : cet appel est donc sans danger ici, et alimente aussi le JSON de
# simulation plus bas. D5 (regle absolue) : si rien n'est trouve et que la personne
# annule ou ne repond pas, $ancrageResolu.chemin reste vide et le lanceur poursuit
# normalement -- il ne s'arrete pas, il ne bloque pas ; les produits resteront
# introuvables, ce que dit la ligne de journal ci-dessous et, plus bas, le bloc
# d'informations de chaque onglet.
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
  try { Write-SzhRapport -Code 'ANCRAGE-INTROUVABLE' -Source 'lanceur' -Etape (T 'ancrage.demande.titre') -Produit @{ type = $ongletActif } } catch { }
}

# Vidage de la file d'attente des rapports d'erreur hors ligne (docs/RAPPORTS-ERREUR.md §6) :
# silencieux, jamais bloquant -- l'ancrage vient d'etre resolu, c'est le bon moment pour
# retenter les rapports ecrits hors ligne depuis le dernier lancement.
try { Clear-SzhRapportsEnAttente } catch { }

# ---- Lien "szh://..." recu : on ouvre, on ne liste pas ----
# Seuls revue et zeitschrift ont une grammaire de lien (Get-SzhLien) ; le livre n'y figure
# jamais, $Lien restant vide pour lui (open-livre.ps1 ne le transmet pas).
#
# Ce chemin n'ouvre aucune fenetre de lanceur et ne touche plus a la langue du poste. Il le
# faisait : un clic sur un lien Zeitschrift depuis Outlook basculait tout l'outil en
# allemand, pour tous les comptes du poste, sans que personne ne l'ait demande. La langue
# est un reglage, et un lien recu par courriel n'est pas un reglage.
if ($Lien) {
  $cible = Get-SzhLien $Lien
  if (-not $cible) {
    if ($script:SzhSimule) {
      Write-SzhSimuleJson ([pscustomobject]@{ produit = $ongletActif; lien = $Lien; erreur = 'invalide' })
      exit 1
    }
    [void][System.Windows.Forms.MessageBox]::Show((T 'lien.invalide' @($Lien)), $titreFenetre)
    exit 1
  }
  $dossierLien = Find-SzhRevue $cible.produit $cible.numero
  if (-not $dossierLien) {
    if ($script:SzhSimule) {
      Write-SzhSimuleJson ([pscustomobject]@{ produit = $ongletActif; lien = $Lien; erreur = 'introuvable' })
      exit 1
    }
    [void][System.Windows.Forms.MessageBox]::Show(
      (T 'lien.introuvable' @($cible.numero, $cible.produit)), $titreFenetre)
    exit 1
  }
  # A usage unique, jamais bloquante : sans elle, la revue s'ouvre sans aller droit au panneau.
  try { Set-SzhIntention $dossierLien $cible.vue $cible.article } catch { }
  if ($script:SzhSimule) {
    Write-SzhSimuleJson ([pscustomobject]@{ produit = $ongletActif; lien = $Lien; dossier = $dossierLien })
    exit 0
  }
  [void](Start-SzhCodium $dossierLien)
  exit 0
}

# ---- Racines a balayer, communes aux trois onglets ----
$emplacements = Get-SzhEmplacements
# Les six dossiers de test sont crees s'ils manquent ; en production, rien n'est cree.
[void](Initialize-SzhEmplacementsTest)
# Mode test : $emplacements.emplacement decide seul, jamais une autre lecture de la config.
$modeTest = ($emplacements.emplacement -eq $SzhEmplacementTest)

# ---- L'inventaire d'un produit ----
# Ses deux racines, ses entrees en cours et archivees, et les lignes d'information qui vont
# sous ses listes. Tout ce qui depend du produit, et rien d'autre : la fenetre n'y touche
# plus, elle se contente d'afficher ce qui en sort. C'est ce qui rend les trois onglets
# identiques a fabriquer, et ce qui fait que le JSON de simulation et la fenetre ne peuvent
# pas diverger -- ils lisent le meme objet.
#
# Lit $emplacements, $modeTest et $ancrageResolu dans la portee du script : ce sont trois
# faits du poste, resolus une fois plus haut, identiques pour les trois produits.
function Get-SzhInventaireProduit([string]$Jeton) {
  $info = $SzhProduits[$Jeton]
  $encoursProduit = Get-SzhEmplacementRevue $info.jeton 'encours'
  $archiveProduit = Get-SzhEmplacementRevue $info.jeton 'archive'
  $racines = @($encoursProduit, $archiveProduit)
  $racinesArchives = @{}
  $racinesArchives[$archiveProduit.ToLower()] = $true

  # Racines heritees (config.json `revuesRoots`, OneDrive\Revues) : seulement pour revue et
  # zeitschrift -- elles n'ont jamais concerne le livre.
  $horsArborescence = 0
  $dossierHors = ''
  if ($info.racinesHeritees) {
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
        Where-Object { Test-Path (Join-Path $_.FullName $info.manifeste) })
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
      if (Test-Path (Join-Path $d.FullName $info.manifeste)) {
        $cle = $d.FullName.ToLower()
        if (-not $vus.ContainsKey($cle)) {
          $vus[$cle] = $true
          $etat = & $info.etatFn $d.FullName
          # Le produit vient du jeton du manifeste, pas de l'emplacement : un numero range cote
          # Zeitschrift mais declarant "revue: revue" n'apparait pas ici. Sans objet pour le
          # livre (filtrerJeton = $false), qui n'a qu'un seul jeton.
          if ($info.filtrerJeton -and ($etat.jeton -ne $info.jeton)) { return }
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

  # ---- Le bloc d'informations, calcule avant la mise en page (ou avant le JSON) ----
  $lignesInfo = @()
  if ($modeTest) { $lignesInfo += (T 'lanceur.modeTest') }
  $vInstallee = Get-SzhVersionInstallee
  if ($vInstallee) { $lignesInfo += (T 'lanceur.version' @($vInstallee)) }
  else { $lignesInfo += (T 'lanceur.version.inconnue') }
  $lignesInfo += (T $info.texteTest @($emplacements.base))
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
  if ($info.racinesHeritees -and ($horsArborescence -gt 0)) {
    $avertissementHors = (T 'lanceur.hors' @($horsArborescence, $dossierHors))
    $lignesInfo += $avertissementHors
  }

  return [pscustomobject]@{
    jeton             = $info.jeton
    info              = $info
    racineEnCours     = $encoursProduit
    racineArchive     = $archiveProduit
    enCours           = @($enCours | Sort-Object modifie -Descending)
    archives          = @($archives | Sort-Object nom -Descending)
    lignesInfo        = $lignesInfo
    avertissementHors = $avertissementHors
  }
}

# Les trois inventaires, dans l'ordre des onglets. Calcules AVANT toute fenetre : trois
# balayages de dossiers OneDrive au demarrage, la ou il n'y en avait qu'un -- c'est le prix
# d'une fenetre qui montre les trois produits, et il se paie une fois, au lancement, pas a
# chaque changement d'onglet.
$inventaires = [ordered]@{}
foreach ($jeton in $SzhOrdreOnglets) { $inventaires[$jeton] = Get-SzhInventaireProduit $jeton }
$inventaireActif = $inventaires[$ongletActif]

# Pas de sortie anticipee quand il n'y a aucune entree : la fenetre s'ouvre quand meme, pour
# offrir "Nouveau..." sur un poste vierge.

# ---- Mode simulation : le JSON remplace la fenetre, et rien de WinForms n'est touche ----
if ($script:SzhSimule) {
  $versAvecLibelle = {
    param($ProduitInfo, $liste)
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
        libelle     = (Format-SzhEntree $ProduitInfo $_)
      }
    })
  }
  # Un bloc par onglet, plus les champs de l'onglet actif repetes a la racine : les lecteurs
  # qui ne s'interessent qu'a ce qui s'ouvre (diagnostic, tests d'ouverture) n'ont pas a
  # savoir qu'il y a trois onglets.
  $parProduit = [ordered]@{}
  foreach ($jeton in $SzhOrdreOnglets) {
    $inv = $inventaires[$jeton]
    $avert = New-Object System.Collections.ArrayList
    if ($inv.avertissementHors) { [void]$avert.Add($inv.avertissementHors) }
    $parProduit[$jeton] = [ordered]@{
      onglet        = $inv.info.onglet
      racineEnCours = $inv.racineEnCours
      racineArchive = $inv.racineArchive
      enCours       = (& $versAvecLibelle $inv.info $inv.enCours)
      archives      = (& $versAvecLibelle $inv.info $inv.archives)
      lignesInfo    = @($inv.lignesInfo)
      avertissements = @($avert)
    }
  }
  $avertissements = New-Object System.Collections.ArrayList
  if ($inventaireActif.avertissementHors) { [void]$avertissements.Add($inventaireActif.avertissementHors) }
  if (-not $codium) { [void]$avertissements.Add('VSCodium introuvable sur ce poste') }
  $r = [ordered]@{
    produit          = $ongletActif
    ongletActif      = $ongletActif
    onglets          = @($SzhOrdreOnglets)
    langue           = $SzhLangue
    reglages         = [ordered]@{
      ongletChoisi  = (Get-SzhOngletChoisi)
      langueChoisie = (Get-SzhEtatUtilisateurChamp (Get-SzhEtatUtilisateur) 'langueInterface')
      langueAuto    = (Get-SzhLangueAutomatique)
    }
    titreFenetre     = $titreFenetre
    etiquetteRacine  = (Get-SzhEtiquetteRacine)
    emplacement      = $emplacements.emplacement
    modeTest         = $modeTest
    racineBase       = $emplacements.base
    ancrage          = [ordered]@{ chemin = $ancrageResolu.chemin; origine = $ancrageResolu.origine }
    racineEnCours    = $inventaireActif.racineEnCours
    racineArchive    = $inventaireActif.racineArchive
    versionInstallee = (Get-SzhVersionInstallee)
    codiumTrouve     = [bool]$codium
    enCours          = (& $versAvecLibelle $inventaireActif.info $inventaireActif.enCours)
    archives         = (& $versAvecLibelle $inventaireActif.info $inventaireActif.archives)
    avertissements   = @($avertissements)
    produits         = $parProduit
  }
  Write-SzhSimuleJson $r
  exit 0
}

# ---- Les deux formulaires "Nouveau..." (un numero n'a rien a voir avec un livre) ----
# Ils ne lisent plus le produit dans la portee du script : il y a trois produits a
# l'ecran, et c'est l'onglet qui decide. Ils le recoivent donc, avec la racine "en
# cours" ou creer -- meme signature pour les deux, ce qui permet a Invoke-SzhNouveau
# (plus bas) d'appeler $ProduitInfo.nouveauFormulaire sans savoir lequel c'est.

# Demande l'annee et le numero du numero a creer -- et rien d'autre. Le volume s'affiche
# grise, calcule d'apres l'annee (Get-SzhVolumePour), et le nom du dossier n'est qu'un
# affichage : il se deduit des deux nombres. Rend $null si annule, sinon
# { annee, numero, volume, nom }.
function Read-SzhNouveauNumero($ProduitInfo, [string]$Racine) {
  $anneeMin = Get-SzhPremiereAnnee $ProduitInfo.jeton
  $anneeMax = (Get-Date).Year + 5
  $anneeDefaut = (Get-Date).Year
  if ($anneeDefaut -lt $anneeMin) { $anneeDefaut = $anneeMin }

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T $ProduitInfo.texteNouvelle) -replace '…', ''
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
  $ou.Text = (T 'lanceur.nouvelle.ou' @($Racine))
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
      $calcule = Get-SzhVolumePour $ProduitInfo.jeton $anneeVue
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
    if (Test-Path (Join-Path $Racine $nomOk)) {
      [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.nouvelle.existe' @($nomOk)), $titreFenetre)
      $boite.DialogResult = [System.Windows.Forms.DialogResult]::None
      return
    }
    $deja = Find-SzhNumeroVolume $ProduitInfo.jeton $volumeOk $numeroOk
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
function Read-SzhNouveauLivre($ProduitInfo, [string]$Racine) {
  $anneeDefaut = (Get-Date).Year

  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = (T $ProduitInfo.texteNouvelle) -replace '…', ''
  $boite.StartPosition = 'CenterParent'
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false
  Set-SzhIconeFenetre $boite (Join-Path $PSScriptRoot $ProduitInfo.icone)

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
  $ou.Text = (T 'lanceur.nouvelle.ou' @($Racine))
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
    if (Test-Path (Join-Path $Racine $nomOk)) {
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

# ---- La fenetre : un onglet par produit, plus celui des reglages ----
# Un TabControl et non trois fenetres : le bouton de la barre des taches reste le meme, la
# liste d'un produit ne se recalcule pas quand on passe a l'autre (tout est deja en memoire,
# voir $inventaires), et "Ouvrir" n'existe qu'une fois.
#
# Les trois onglets de produit sortent de la meme fonction, appelee en boucle. Aucun
# gestionnaire d'evenement ne capture la variable de boucle -- en PowerShell elle vaudrait
# sa DERNIERE valeur au moment du clic, et les trois boutons "Nouveau..." creeraient tous
# un livre. Chaque controle porte donc ce qu'il lui faut dans son .Tag, et le lit par $this.
$script:form = New-Object System.Windows.Forms.Form
$script:form.Text = $titreFenetre
$script:form.StartPosition = 'CenterScreen'
$script:form.FormBorderStyle = 'FixedDialog'
$script:form.MaximizeBox = $false
$script:form.MinimizeBox = $false
Set-SzhIconeFenetre $script:form

# Hauteur adaptee a l'ecran. Le processus ignore le DPI : sur un 1366x768 a 125 %, il ne
# "voit" que 614 px utiles, et FixedDialog interdit de deplacer une fenetre trop haute. On
# retrecit donc les listes, pas les boutons. Les seuils sont plus severes qu'avant
# l'unification : la bande d'onglets et la rangee de boutons hors du TabControl coutent une
# soixantaine de pixels que la fenetre d'un seul produit n'avait pas a trouver.
$hauteurUtile = 900
try { $hauteurUtile = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height } catch { }
$hListe = 190
$hArchives = 110
if ($hauteurUtile -lt 560) { $hListe = 84; $hArchives = 48 }
elseif ($hauteurUtile -lt 660) { $hListe = 120; $hArchives = 70 }
elseif ($hauteurUtile -lt 780) { $hListe = 150; $hArchives = 90 }

$xPage = 12
$largeurPage = 592

# Hauteur du bloc d'informations : mesuree, et la MEME pour les trois onglets. Un TabControl
# donne a toutes ses pages la taille de la plus grande ; mesurer chaque page separement
# ferait sauter le bouton "Nouveau..." d'une dizaine de pixels d'un onglet a l'autre. Un
# chemin de racine depasse la largeur du libelle et revient a la ligne -- WordBreak ne coupe
# qu'aux espaces, et un chemin Windows n'en a pas : c'est pourquoi on mesure au lieu de
# deviner.
$hInfos = 44
$mesure = New-Object System.Windows.Forms.Label
$mesure.AutoSize = $false
$mesure.Width = $largeurPage
foreach ($jeton in $SzhOrdreOnglets) {
  $mesure.Text = ($inventaires[$jeton].lignesInfo -join "`n")
  try {
    $voulue = $mesure.GetPreferredSize((New-Object System.Drawing.Size($largeurPage, 0))).Height + 8
    if ($voulue -gt $hInfos) { $hInfos = $voulue }
  } catch { }
}
$mesure.Dispose()

# Positions calculees plutot que constantes : label 20 px, marges 8 et 12 px.
$yListe        = 60
$yEtiqArchives = $yListe + $hListe + 8
$yArchives     = $yEtiqArchives + 20
$yInfos        = $yArchives + $hArchives + 8
$yNouveau      = $yInfos + $hInfos + 6
$hPage         = $yNouveau + 30 + 10
$hOnglets      = $hPage + 26          # la bande des etiquettes d'onglet
$yBoutons      = 8 + $hOnglets + 10
$script:form.ClientSize = New-Object System.Drawing.Size(640, ($yBoutons + 32 + 10))

$onglets = New-Object System.Windows.Forms.TabControl
$onglets.Location = New-Object System.Drawing.Point(8, 8)
$onglets.Size = New-Object System.Drawing.Size(624, $hOnglets)
$script:form.Controls.Add($onglets)

# Ce que chaque onglet de produit garde sous la main : ses deux listes et ses deux tableaux
# d'entrees, dans le meme ordre. "Ouvrir" y retrouve ce qui est selectionne dans l'onglet au
# premier plan, sans rien recalculer.
$script:panneaux = @{}

# Fabrique un onglet de produit. Ne capture rien : tout ce dont les gestionnaires ont besoin
# voyage dans le .Tag du controle qui les porte.
function Add-SzhOngletProduit($Onglets, $Inventaire) {
  $info = $Inventaire.info
  $page = New-Object System.Windows.Forms.TabPage
  $page.Text = $info.onglet
  $page.Tag = $info.jeton
  $page.UseVisualStyleBackColor = $true

  $intro = New-Object System.Windows.Forms.Label
  if (($Inventaire.enCours.Count + $Inventaire.archives.Count) -gt 0) { $intro.Text = (T $info.texteChoisir) }
  else { $intro.Text = (T $info.texteVide) }
  $intro.Location = New-Object System.Drawing.Point($xPage, 10)
  $intro.AutoSize = $true
  $page.Controls.Add($intro)

  $etiqEnCours = New-Object System.Windows.Forms.Label
  $etiqEnCours.Text = (T 'lanceur.encours')
  $etiqEnCours.Location = New-Object System.Drawing.Point($xPage, 38)
  $etiqEnCours.AutoSize = $true
  $page.Controls.Add($etiqEnCours)

  $liste = New-Object System.Windows.Forms.ListBox
  $liste.Location = New-Object System.Drawing.Point($xPage, $yListe)
  $liste.Size = New-Object System.Drawing.Size($largeurPage, $hListe)
  $liste.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  foreach ($e in $Inventaire.enCours) { [void]$liste.Items.Add((Format-SzhEntree $info $e)) }
  if ($liste.Items.Count -gt 0) { $liste.SelectedIndex = 0 }
  $page.Controls.Add($liste)

  $etiqArchives = New-Object System.Windows.Forms.Label
  $etiqArchives.Text = (T 'lanceur.archives')
  $etiqArchives.Location = New-Object System.Drawing.Point($xPage, $yEtiqArchives)
  $etiqArchives.AutoSize = $true
  $page.Controls.Add($etiqArchives)

  $listeArchives = New-Object System.Windows.Forms.ListBox
  $listeArchives.Location = New-Object System.Drawing.Point($xPage, $yArchives)
  $listeArchives.Size = New-Object System.Drawing.Size($largeurPage, $hArchives)
  $listeArchives.Font = New-Object System.Drawing.Font('Segoe UI', 11)
  foreach ($e in $Inventaire.archives) { [void]$listeArchives.Items.Add((Format-SzhEntree $info $e)) }
  if ($listeArchives.Items.Count -eq 0) { [void]$listeArchives.Items.Add((T $info.texteVideArchives)) }
  $page.Controls.Add($listeArchives)

  # Une seule selection a la fois : cliquer dans une liste deselectionne l'autre. Chacune
  # porte sa voisine dans son .Tag -- c'est ce qui permet d'ecrire le gestionnaire une fois
  # pour les six listes sans capturer quoi que ce soit.
  $liste.Tag = $listeArchives
  $listeArchives.Tag = $liste
  $liste.Add_Click({ $this.Tag.ClearSelected() })
  $listeArchives.Add_Click({ $this.Tag.ClearSelected() })
  $liste.Add_DoubleClick({
    $script:form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $script:form.Close()
  })
  $listeArchives.Add_DoubleClick({
    $script:form.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $script:form.Close()
  })

  $infos = New-Object System.Windows.Forms.Label
  $infos.AutoSize = $false
  $infos.Text = ($Inventaire.lignesInfo -join "`n")
  $infos.Location = New-Object System.Drawing.Point($xPage, $yInfos)
  $infos.Size = New-Object System.Drawing.Size($largeurPage, $hInfos)
  if ($modeTest) { $infos.ForeColor = [System.Drawing.Color]::Firebrick }
  else { $infos.ForeColor = [System.Drawing.Color]::DimGray }
  $page.Controls.Add($infos)

  # "Nouveau..." appartient a l'onglet : un numero se cree cote Revue, une Zeitschrift cote
  # Zeitschrift, un livre cote Book. Le jeton du produit voyage dans le .Tag du bouton.
  $boutonNouveau = New-Object System.Windows.Forms.Button
  $boutonNouveau.Text = (T $info.texteNouvelle)
  $boutonNouveau.Location = New-Object System.Drawing.Point($xPage, $yNouveau)
  $boutonNouveau.Size = New-Object System.Drawing.Size(170, 30)
  $boutonNouveau.Tag = $info.jeton
  $boutonNouveau.Add_Click({ Invoke-SzhNouveau ([string]$this.Tag) })
  $page.Controls.Add($boutonNouveau)

  $script:panneaux[$info.jeton] = @{
    liste         = $liste
    listeArchives = $listeArchives
    enCours       = $Inventaire.enCours
    archives      = $Inventaire.archives
  }
  $Onglets.TabPages.Add($page)
}

# ---- "Nouveau..." : deux formulaires distincts, puis new-revue.ps1 ou new-livre.ps1 ----
# Pas de choix d'emplacement : une entree se cree dans le dossier "en cours" de SON produit.
# new-revue.ps1 et new-livre.ps1 ne prennent pas les memes parametres -- deux branches de
# glue, mais toujours les deux memes fonctions de saisie, appelees avec la meme signature.
function Invoke-SzhNouveau([string]$Jeton) {
  $info = $SzhProduits[$Jeton]
  $racine = $inventaires[$Jeton].racineEnCours
  $neuf = & $info.nouveauFormulaire $info $racine
  if (-not $neuf) { return }
  $cible = Join-Path $racine $neuf.nom
  if ($info.jeton -eq 'livre') {
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
    try {
      # new-revue.ps1 copie le gabarit, pose le jeton `revue:`, l'annee, le numero, le
      # volume, l'estampille de version et "Ouvrir la revue.lnk".
      $parametres = @{
        Dossier = $cible
        Produit = $info.jeton
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
  $script:form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel   # entree deja ouverte ci-dessus
  $script:form.Close()
}

foreach ($jeton in $SzhOrdreOnglets) { Add-SzhOngletProduit $onglets $inventaires[$jeton] }

# ---- L'onglet « Journal » : les dix dernieres mises a jour ----
# Ce que ces journaux valent : une mise a jour ecrit un transcript complet
# (C:\ProgramData\SZH\logs\update-<horodatage>.log), et c'etait jusqu'ici le seul endroit ou
# lire pourquoi elle avait echoue -- a condition de savoir qu'il existait, et d'aller le
# chercher a la main dans ProgramData. Personne ne le faisait. Il devient donc un onglet.
#
# Il le devient d'autant plus que la mise a jour peut maintenant se faire sans fenetre
# (reglage ci-dessous) : quand rien ne s'affiche, le journal est la seule chose qui reste.
$pageJournal = New-Object System.Windows.Forms.TabPage
$pageJournal.Text = (T 'lanceur.journal')
$pageJournal.Tag = ''          # pas un produit : « Ouvrir » n'a rien a ouvrir ici
$pageJournal.UseVisualStyleBackColor = $true
$onglets.TabPages.Add($pageJournal)

# Lus une fois, a l'ouverture, comme les trois inventaires : une dizaine de fichiers de
# quelques kilo-octets, dont on ne garde ici que la fiche -- le contenu ne se lit qu'au clic.
$script:journaux = @(Get-SzhJournauxMaj 10)

$etiqJournal = New-Object System.Windows.Forms.Label
$etiqJournal.Text = (T 'lanceur.journal.liste')
$etiqJournal.Location = New-Object System.Drawing.Point($xPage, 10)
$etiqJournal.AutoSize = $true
$pageJournal.Controls.Add($etiqJournal)

$script:listeJournaux = New-Object System.Windows.Forms.ListBox
$script:listeJournaux.Location = New-Object System.Drawing.Point($xPage, 34)
$script:listeJournaux.Size = New-Object System.Drawing.Size($largeurPage, 120)
$script:listeJournaux.Font = New-Object System.Drawing.Font('Segoe UI', 10)
foreach ($j in $script:journaux) {
  # Kilo-octets arrondis au superieur : un journal de 400 octets n'est pas « 0 ko », il est
  # court -- et un « 0 » ferait croire a un fichier vide, donc a une mise a jour sans trace.
  $ko = [int][Math]::Ceiling($j.taille / 1024.0)
  [void]$script:listeJournaux.Items.Add((T 'lanceur.journal.entree' @(
    $j.date.ToString('dd.MM.yyyy HH:mm'),
    (T ('lanceur.journal.' + $j.verdict)),
    $ko)))
}
if ($script:journaux.Count -eq 0) { [void]$script:listeJournaux.Items.Add((T 'lanceur.journal.vide')) }
$pageJournal.Controls.Add($script:listeJournaux)

# Police a chasse fixe : un transcript PowerShell est aligne en colonnes, et le lire en
# Segoe UI le rend illisible. Pas de retour a la ligne, mais une barre horizontale : couper
# une ligne de journal en deux ferait perdre de vue ou elle commence.
$script:vueJournal = New-Object System.Windows.Forms.TextBox
$script:vueJournal.Multiline = $true
$script:vueJournal.ReadOnly = $true
$script:vueJournal.WordWrap = $false
$script:vueJournal.ScrollBars = 'Both'
$script:vueJournal.Font = New-Object System.Drawing.Font('Consolas', 9)
$script:vueJournal.BackColor = [System.Drawing.Color]::White
$script:vueJournal.Location = New-Object System.Drawing.Point($xPage, 162)
$script:vueJournal.Size = New-Object System.Drawing.Size($largeurPage, ($yNouveau - 170))
$script:vueJournal.Text = (T 'lanceur.journal.choisir')
$pageJournal.Controls.Add($script:vueJournal)

# Un transcript reste petit (quelques kilo-octets), mais rien ne le garantit : une mise a
# jour qui boucle sur un telechargement peut en ecrire beaucoup. On n'en montre donc que la
# FIN -- c'est la qu'une mise a jour dit comment elle s'est terminee.
function Show-SzhJournal([int]$Rang) {
  if (($Rang -lt 0) -or ($Rang -ge $script:journaux.Count)) { return }
  $fiche = $script:journaux[$Rang]
  try {
    $texte = [System.IO.File]::ReadAllText($fiche.chemin, [System.Text.Encoding]::UTF8)
    $max = 200000
    if ($texte.Length -gt $max) { $texte = $texte.Substring($texte.Length - $max) }
    $script:vueJournal.Text = $texte
    $script:vueJournal.Select($script:vueJournal.Text.Length, 0)
    $script:vueJournal.ScrollToCaret()
  } catch {
    $script:vueJournal.Text = (T 'lanceur.journal.illisible' @($_.Exception.Message))
  }
}
$script:listeJournaux.Add_SelectedIndexChanged({ Show-SzhJournal $this.SelectedIndex })

# ---- Signaler une erreur ----
# Le rapport structure existait deja (Write-SzhRapport, szh-rapport.ps1) mais ne partait que
# tout seul, sur une panne que le code avait su reconnaitre. Il manquait le cas le plus
# courant : rien n'a plante, et pourtant quelque chose ne va pas. C'est ce bouton.
#
# La phrase demandee tient en une ligne, expres : ce qu'on veut, c'est le mot que le journal
# ne contient pas -- « le PDF sort sans les images » -- pas un recit. Le reste (poste,
# versions, journal, emplacement) est joint automatiquement et masque par Write-SzhRapport.
function Read-SzhPhrase([string]$Titre, [string]$Question) {
  $boite = New-Object System.Windows.Forms.Form
  $boite.Text = $Titre
  $boite.StartPosition = 'CenterParent'
  $boite.FormBorderStyle = 'FixedDialog'
  $boite.MaximizeBox = $false
  $boite.MinimizeBox = $false
  $boite.ClientSize = New-Object System.Drawing.Size(460, 132)
  Set-SzhIconeFenetre $boite

  $etiq = New-Object System.Windows.Forms.Label
  $etiq.Text = $Question
  $etiq.Location = New-Object System.Drawing.Point(16, 16)
  $etiq.Size = New-Object System.Drawing.Size(428, 20)
  $boite.Controls.Add($etiq)

  $champ = New-Object System.Windows.Forms.TextBox
  $champ.Location = New-Object System.Drawing.Point(16, 42)
  $champ.Size = New-Object System.Drawing.Size(428, 24)
  $champ.MaxLength = 300
  $boite.Controls.Add($champ)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'OK'                      # comme les deux boites « Nouveau… » : « OK » se lit dans les trois langues
  $ok.Location = New-Object System.Drawing.Point(258, 84)
  $ok.Size = New-Object System.Drawing.Size(90, 32)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $boite.Controls.Add($ok)
  $boite.AcceptButton = $ok

  $non = New-Object System.Windows.Forms.Button
  $non.Text = (T 'lanceur.annuler')
  $non.Location = New-Object System.Drawing.Point(354, 84)
  $non.Size = New-Object System.Drawing.Size(90, 32)
  $non.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $boite.Controls.Add($non)
  $boite.CancelButton = $non

  if ($boite.ShowDialog($script:form) -ne [System.Windows.Forms.DialogResult]::OK) { return '' }
  return ([string]$champ.Text).Trim()
}

# Combien de rapports dorment dans un dossier. Ne leve jamais : un dossier SharePoint non
# synchronise n'est pas une panne, c'est un jour comme un autre.
function Measure-SzhRapports([string]$Dossier) {
  if (-not $Dossier) { return 0 }
  try { return @(Get-ChildItem -LiteralPath $Dossier -Filter '*.json' -File -ErrorAction Stop).Count }
  catch { return 0 }
}

function Invoke-SzhSignalement {
  $phrase = Read-SzhPhrase (T 'lanceur.journal.signaler.titre') (T 'lanceur.journal.signaler.quoi')
  if (-not $phrase) { return }
  $journal = ''
  $rang = $script:listeJournaux.SelectedIndex
  if (($rang -ge 0) -and ($rang -lt $script:journaux.Count)) { $journal = $script:journaux[$rang].chemin }
  # Write-SzhRapport ne dit RIEN de ce qu'il a fait : il ne rend aucune valeur, et lui en
  # faire rendre une enverrait cette sortie dans le flux de tous ses appelants -- le JSON de
  # simulation de ce fichier en premier, qu'elle abimerait. On regarde donc le disque, avant
  # et apres : le rapport atterrit soit chez le support, soit dans la file d'attente locale,
  # soit nulle part. Trois issues, trois phrases -- et la troisieme a deja servi : le code
  # 'LANCEUR-SIGNALEMENT' a vecu un temps sans etre declare dans Get-SzhRapportCodesConnus,
  # si bien que ce bouton n'ecrivait rien tout en annoncant le contraire.
  $dossierSupport = [string]$env:SZH_RAPPORTS
  if ((-not $dossierSupport) -and $ancrageResolu.chemin) {
    $dossierSupport = Get-SzhDossierRapportsDepuisAncrage $ancrageResolu.chemin
  }
  $dossierAttente = Get-SzhRapportDossierAttente
  $avantSupport = Measure-SzhRapports $dossierSupport
  $avantAttente = Measure-SzhRapports $dossierAttente

  # Ne leve jamais et n'affiche rien de lui-meme (D5) : c'est a nous de dire ce qu'il advient.
  try {
    Write-SzhRapport -Code 'LANCEUR-SIGNALEMENT' -Gravite 'erreur' -Source 'lanceur' `
      -Etape (T 'lanceur.journal.signaler.titre') -Message $phrase -Journal $journal `
      -Produit @{ type = $ongletActif }
  } catch { }

  $dit = (T 'lanceur.journal.signaler.refuse')
  if ((Measure-SzhRapports $dossierSupport) -gt $avantSupport) {
    $dit = (T 'lanceur.journal.signaler.fait')
  } elseif ((Measure-SzhRapports $dossierAttente) -gt $avantAttente) {
    $dit = (T 'lanceur.journal.signaler.attente')
  } else {
    Write-SzhLog 'open-produit : signalement non ecrit -- ni chez le support, ni en attente'
  }
  [void][System.Windows.Forms.MessageBox]::Show($dit, $titreFenetre)
}

# ---- Envoyer les journaux ----
# Un « mailto: » ne sait pas porter de piece jointe -- aucune implementation ne le permet,
# ce n'est pas une limite d'ici. On fait donc le seul geste utile : reunir les journaux en
# une archive, ouvrir l'explorateur DESSUS, et ouvrir le brouillon a cote. Le glisser-deposer
# reste a faire, et le message le dit plutot que de laisser croire que c'est parti.
#
# Le journal mensuel part avec les transcripts : il porte le fil des gestes (une ligne par
# ouverture, par compilation, par archivage), la ou un transcript ne raconte qu'une mise a
# jour. Une panne qui n'est pas une panne de mise a jour n'est visible que la.
function Invoke-SzhEnvoiJournaux {
  try {
    $fichiers = New-Object System.Collections.ArrayList
    foreach ($j in $script:journaux) {
      if (Test-Path -LiteralPath $j.chemin) { [void]$fichiers.Add($j.chemin) }
    }
    $mensuel = Join-Path $SzhLogs ('szh-{0}.log' -f (Get-Date -Format 'yyyy-MM'))
    if (Test-Path -LiteralPath $mensuel) { [void]$fichiers.Add($mensuel) }
    if ($fichiers.Count -eq 0) { throw (T 'lanceur.journal.vide') }

    $nom = ('journaux-szh-{0}-{1}.zip' -f $env:COMPUTERNAME, (Get-Date -Format 'yyyyMMdd-HHmm'))
    $zip = Join-Path ([System.IO.Path]::GetTempPath()) $nom
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    Compress-Archive -LiteralPath @($fichiers) -DestinationPath $zip -Force

    $rendu = Get-SzhCourriel -Nom 'support' -Variables @{
      poste   = $env:COMPUTERNAME
      etape   = (T 'lanceur.journal.envoyer')
      message = ''
      journal = $zip
    }
    $corps = $rendu.corps
    if ($corps.Length -gt 1500) { $corps = $corps.Substring(0, 1500) }   # limite d'un mailto
    $uri = ('mailto:{0}?subject={1}&body={2}' -f $SzhSupport,
      [Uri]::EscapeDataString($rendu.sujet), [Uri]::EscapeDataString($corps))
    Start-Process $uri
    Start-Process explorer.exe ('/select,"' + $zip + '"')
    Write-SzhLog ('open-produit : journaux reunis dans ' + $zip)
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.journal.envoyer.fait' @($nom)), $titreFenetre)
  } catch {
    [void][System.Windows.Forms.MessageBox]::Show(
      (T 'lanceur.journal.envoyer.erreur' @($_.Exception.Message)), $titreFenetre)
  }
}

$boutonSignaler = New-Object System.Windows.Forms.Button
$boutonSignaler.Text = (T 'lanceur.journal.signaler')
$boutonSignaler.Location = New-Object System.Drawing.Point($xPage, $yNouveau)
$boutonSignaler.Size = New-Object System.Drawing.Size(200, 30)
$boutonSignaler.Add_Click({ Invoke-SzhSignalement })
$pageJournal.Controls.Add($boutonSignaler)

$boutonEnvoyer = New-Object System.Windows.Forms.Button
$boutonEnvoyer.Text = (T 'lanceur.journal.envoyer')
$boutonEnvoyer.Location = New-Object System.Drawing.Point(($xPage + 212), $yNouveau)
$boutonEnvoyer.Size = New-Object System.Drawing.Size(200, 30)
$boutonEnvoyer.Add_Click({ Invoke-SzhEnvoiJournaux })
$pageJournal.Controls.Add($boutonEnvoyer)
# ---- L'onglet « Export et secretariat » : quatre exports pilotes par secretariat-cli.js,
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
# Comme « Journal » et « Reglages » : pas un produit, .Tag reste vide, « Ouvrir » n'a rien a
# ouvrir ici.

# Echappement Windows d'un argument de ligne de commande (guillemets, barres obliques
# inverses) -- l'algorithme standard, puisque ProcessStartInfo.Arguments est UNE chaine et
# non une liste : les chemins de numeros vivent sous OneDrive et portent presque tous une
# espace.
function ConvertTo-SzhArgumentEchappe([string]$Valeur) {
  if ($null -eq $Valeur) { $Valeur = '' }
  if ($Valeur -eq '') { return '""' }
  if ($Valeur -notmatch '[\s"]') { return $Valeur }
  $resultat = '"'
  $nbBarres = 0
  foreach ($caractere in $Valeur.ToCharArray()) {
    if ($caractere -eq '\') {
      $nbBarres++
      $resultat += $caractere
    } elseif ($caractere -eq '"') {
      $resultat += ('\' * $nbBarres) + '\"'
      $nbBarres = 0
    } else {
      $nbBarres = 0
      $resultat += $caractere
    }
  }
  $resultat += ('\' * $nbBarres) + '"'
  return $resultat
}
function ConvertTo-SzhArguments([string[]]$Valeurs) {
  return (($Valeurs | ForEach-Object { ConvertTo-SzhArgumentEchappe $_ }) -join ' ')
}

# Le script Node du secretariat, livre dans l'extension du cockpit -- jamais dans ce depot.
# La resolution du dossier d'extension (szh-csps.szh-cockpit-*, le plus recent) est
# factorisee dans szh-common.ps1 (Get-SzhDossierCockpit) -- Get-SzhCourriel, dans ce meme
# fichier, en a besoin tout autant pour outils\rendre-gabarit.js. Leve une erreur claire et
# traduite si le dossier ou le script manquent : un poste mal installe doit le dire, pas
# planter a la premiere ligne de JSON attendue.
function Get-SzhOutilSecretariat {
  $dossierCockpit = Get-SzhDossierCockpit
  if ($dossierCockpit) {
    $scriptCandidat = Join-Path $dossierCockpit 'outils\secretariat-cli.js'
    if (Test-Path -LiteralPath $scriptCandidat) { return $scriptCandidat }
  }
  throw (T 'lanceur.secretariat.outil.absent')
}

# En-tete avant CHAQUE export, dans le journal ou zone de messages passe en $Journal : les
# executions qui se suivent s'y collaient toutes bout a bout, et rien n'y nommait l'export en
# cours. Une ligne vide d'abord (seulement si ce journal n'est pas deja vide -- pas de ligne
# vide en tete du tout premier export), puis « [HH:mm] Nom de l'export ».
function Add-SzhEnteteJournal($Journal, [string]$NomExport) {
  if (-not $NomExport) { return }
  if ($Journal.TextLength -gt 0) {
    $Journal.AppendText("`r`n")
    $Journal.SelectionStart = $Journal.TextLength
    $Journal.ScrollToCaret()
  }
  Add-SzhLigneJournal $Journal (T 'lanceur.secretariat.journal.entete' @((Get-Date).ToString('HH:mm'), $NomExport))
}

# Le seul appelant de secretariat-cli.js. Le lance avec le VSCodium DEJA resolu plus haut
# ($codium ; le lanceur se serait deja arrete si l'editeur manquait) et
# ELECTRON_RUN_AS_NODE=1 -- sans cette variable, VSCodium.exe ouvre une fenetre d'editeur
# au lieu d'executer le script. Grise les quatre boutons de l'onglet et pose le sablier
# pendant que le processus tourne (les rallume dans le finally, quelle que soit l'issue),
# et pilote en prime la barre de progression et le bouton "Interrompre" de LA SURFACE
# APPELANTE (onglet ou boite d'export CSV -- chacune porte les siens, voir plus bas) si on
# les lui passe.
#
# Mesure du 15.09.2026 : une page OAI-PMH de 100 notices prend 4,6 s, la Zeitschrift en
# compte 7 -> ~32 s bloquant tout entiers avec l'ancien ReadLine(). La lecture de stdout est
# donc non bloquante (ReadLineAsync), avec une boucle qui pompe l'interface (DoEvents +
# petite pause) tant que la ligne n'est pas arrivee -- et qui teste au passage le drapeau
# d'annulation ($EtatAnnulation), une table de hachage et non une variable simple (une
# fermeture ne reassigne pas une variable simple -- voir $etatBoiteOjs plus bas). `.Result`
# sur une Task en faute leve une AggregateException : encadree par le try/catch autour de
# chaque lecture. Chaque ligne recue est decodee comme du JSON : etape/avert vont dans le
# journal, progres met a jour la barre, numero et fichier s'accumulent, fin memorise
# l'issue. Une ligne qui n'est pas du JSON valide s'affiche telle quelle plutot que de faire
# tomber le lanceur. stderr est lu par une Task .NET (ReadToEndAsync), jamais par un
# gestionnaire d'evenement PowerShell (add_ErrorDataReceived / BeginErrorReadLine /
# add_OutputDataReceived) : INTERDIT ABSOLU -- ces gestionnaires tournent sur un fil hors
# pipeline et ont deja tue le processus PowerShell entier sur ce poste, sans exception a
# attraper. Cette Task demarre AVANT la boucle de stdout, pour empecher stderr de saturer
# son tube et bloquer l'enfant ; son resultat n'est lu qu'apres WaitForExit, et seulement si
# le code de sortie n'est pas nul (une annulation ne le lit pas : le texte affiche doit
# rester "Export interrompu.", pas une sortie de processus tue).
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
  $script:form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
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
  $processus = $null
  $tacheErreurSecretariat = $null
  try {
    if (-not $codium) { throw (T 'lanceur.codium' @($SzhSupport)) }
    $cheminOutilSecretariat = Get-SzhOutilSecretariat
    $tousArguments = @($cheminOutilSecretariat, $Commande) + $Arguments

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $codium
    $psi.Arguments = ConvertTo-SzhArguments $tousArguments
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'

    $processus = New-Object System.Diagnostics.Process
    $processus.StartInfo = $psi
    [void]$processus.Start()
    $tacheErreurSecretariat = $processus.StandardError.ReadToEndAsync()

    $futAnnule = $false
    while ($true) {
      $tacheLigne = $processus.StandardOutput.ReadLineAsync()
      $annulePendant = $false
      while (-not $tacheLigne.IsCompleted) {
        if ($EtatAnnulation -and $EtatAnnulation.annule) { $annulePendant = $true; break }
        [System.Windows.Forms.Application]::DoEvents()
        [System.Threading.Thread]::Sleep(25)
      }
      if ($annulePendant) {
        try { if (-not $processus.HasExited) { $processus.Kill() } } catch { }
        $ok = $false
        $texteFin = (T 'lanceur.secretariat.interrompu')
        $futAnnule = $true
        break
      }
      $ligne = $null
      try { $ligne = $tacheLigne.Result } catch { $ligne = $null }
      if ($null -eq $ligne) { break }
      $ligneVue = $ligne.Trim()
      if ($ligneVue) {
        $objetJson = $null
        try { $objetJson = $ligneVue | ConvertFrom-Json -ErrorAction Stop } catch { $objetJson = $null }
        if ($objetJson -and $objetJson.t) {
          switch ([string]$objetJson.t) {
            'etape'   { Add-SzhLigneJournal $Journal ([string]$objetJson.texte) }
            'avert'   { Add-SzhLigneJournal $Journal ([string]$objetJson.texte) }
            'numero'  { [void]$numerosRecus.Add($objetJson) }
            'fichier' {
              [void]$fichiersRecus.Add($objetJson)
              if ($DossierSortie) { $dossierRendu = $DossierSortie }
            }
            'fin'     {
              $ok = [bool]$objetJson.ok
              $texteFin = [string]$objetJson.texte
              $dossierGabarits = [string]$objetJson.gabarits
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
            default   { Add-SzhLigneJournal $Journal $ligneVue }
          }
        } else {
          Add-SzhLigneJournal $Journal $ligneVue
        }
      }
    }
    if ($futAnnule) {
      try { [void]$processus.WaitForExit(3000) } catch { }
    } else {
      $processus.WaitForExit()
      if ($processus.ExitCode -ne 0) {
        $erreurStd = $tacheErreurSecretariat.Result
        if ($erreurStd -and $erreurStd.Trim()) { Add-SzhLigneJournal $Journal $erreurStd.Trim() }
        $ok = $false
      }
    }
  } catch {
    $ok = $false
    $texteFin = $_.Exception.Message
    Add-SzhLigneJournal $Journal $texteFin
  } finally {
    try {
      if ($processus -and -not $processus.HasExited) { $processus.Kill() }
      if ($processus) { $processus.Dispose() }
    } catch { }
    $script:form.Cursor = [System.Windows.Forms.Cursors]::Default
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

# Ajoute une ligne a la zone de journal (TextBox multiligne en lecture seule) et fait suivre
# le defilement -- appelee aussi bien pour les lignes du script Node que pour les erreurs
# rencontrees ici.
function Add-SzhLigneJournal($ZoneTexte, [string]$Ligne) {
  if (-not $Ligne) { return }
  if ($ZoneTexte.TextLength -gt 0) { $ZoneTexte.AppendText("`r`n" + $Ligne) }
  else { $ZoneTexte.AppendText($Ligne) }
  $ZoneTexte.SelectionStart = $ZoneTexte.TextLength
  $ZoneTexte.ScrollToCaret()
}

# Le dossier de sortie : redemande a CHAQUE export, jamais retenu d'une fois sur l'autre --
# decision du cahier des charges. Rend $null si annule.
function Get-SzhDossierSortieChoisi {
  $boiteDossier = New-Object System.Windows.Forms.FolderBrowserDialog
  $boiteDossier.Description = (T 'lanceur.secretariat.dossier.demande')
  $boiteDossier.ShowNewFolderButton = $true
  if ($boiteDossier.ShowDialog($script:form) -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
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
      $script:form.Cursor = [System.Windows.Forms.Cursors]::WaitCursor
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
        $script:form.Cursor = [System.Windows.Forms.Cursors]::Default
        $boutonChargerOjs.Enabled = $true
        $boutonChargerPlusOjs.Enabled = ((-not $etatBoiteOjs.finDeCourse) -and ($null -ne $etatBoiteOjs.anneePlancher))
      }
    }

    $boutonChargerOjs.Add_Click({ & $chargerNumerosOjs $anneeCouranteOjs $true })
    $boutonChargerPlusOjs.Add_Click({ & $chargerNumerosOjs ($etatBoiteOjs.anneePlancher - 1) $false })

    if ($boite.ShowDialog($script:form) -ne [System.Windows.Forms.DialogResult]::OK) { return }

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
# partir des inventaires deja calcules plus haut -- ni balayage ni tri supplementaire. Le
# tableau parallele retrouve le chemin (et le produit) de la ligne choisie : la ListBox ne
# porte que du texte. $script:secretariatEntrees garde TOUTES les entrees, des deux produits
# confondus ; le filtre ci-dessous n'y touche jamais.
$script:secretariatEntrees = New-Object System.Collections.ArrayList
foreach ($jetonSec in $SzhOrdreOnglets) {
  if ($jetonSec -eq 'livre') { continue }
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
$script:jetonsFiltreSecretariat = @($SzhOrdreOnglets | Where-Object { $_ -ne 'livre' })
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

$onglets.TabPages.Add($pageSecretariat)

# ---- Les quatre gestes, cote interface ----

$boutonNewsletter.Add_Click({
  if ($script:listeSecretariat.SelectedIndex -lt 0) {
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.secretariat.newsletter.manque'), $titreFenetre)
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
    [void][System.Windows.Forms.MessageBox]::Show((T 'lanceur.secretariat.metadonnees.manque'), $titreFenetre)
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


# ---- L'onglet des reglages ----
# Quatre reglages, pas de bouton « Enregistrer ». Un choix fait dans une liste EST le choix :
# il part sur le disque au moment ou on le fait. Un bouton de validation n'ajouterait qu'une
# facon d'oublier de valider.
#
# Trois d'entre eux sont ranges par COMPTE (etat-utilisateur.json) : deux personnes qui se
# partagent un poste ne se changent plus la langue l'une a l'autre, ce qui arrivait avec les
# trois anciens lanceurs -- ouvrir « Zeitschriften SZH » ecrivait « de » dans l'etat du
# POSTE, pour tout le monde. Le quatrieme, le mode developpeur, est l'exception : il decide
# ou vivent les revues, ce qui ne peut pas differer d'un compte a l'autre sur un meme poste.
# Sa note le dit a qui le change.
$pageReglages = New-Object System.Windows.Forms.TabPage
$pageReglages.Text = (T 'lanceur.reglages')
$pageReglages.Tag = ''          # pas un produit : « Ouvrir » n'a rien a ouvrir ici
$pageReglages.UseVisualStyleBackColor = $true
$onglets.TabPages.Add($pageReglages)

# Un reglage = une etiquette, une liste deroulante, une note grise. Quatre fois la meme
# forme : une fonction la pose et rend le y du suivant. Sans elle, quatre blocs de quinze
# lignes se copieraient, et le cinquieme finirait par diverger du quatrieme.
#
# Le gestionnaire arrive en parametre et n'est pose qu'APRES la selection initiale : sans cet
# ordre, le premier affichage reecrirait le reglage qu'il vient de lire -- inoffensif, mais
# un fichier reecrit a chaque ouverture pour rien.
function Add-SzhReglage($Page, [int]$Y, [string]$Etiquette, [string[]]$Choix, [int]$Rang, [string]$Note, $SurChangement) {
  $etiq = New-Object System.Windows.Forms.Label
  $etiq.Text = $Etiquette
  $etiq.Location = New-Object System.Drawing.Point($xPage, $Y)
  $etiq.AutoSize = $true
  $Page.Controls.Add($etiq)

  $liste = New-Object System.Windows.Forms.ComboBox
  $liste.DropDownStyle = 'DropDownList'
  $liste.Location = New-Object System.Drawing.Point($xPage, ($Y + 22))
  $liste.Size = New-Object System.Drawing.Size(360, 24)
  foreach ($c in $Choix) { [void]$liste.Items.Add($c) }
  if (($Rang -ge 0) -and ($Rang -lt $liste.Items.Count)) { $liste.SelectedIndex = $Rang }
  $liste.Add_SelectedIndexChanged($SurChangement)
  $Page.Controls.Add($liste)

  # $etiqNote, et surtout pas $note : PowerShell ignore la casse des noms de variables, si
  # bien que $note EST le parametre $Note. Lui affecter un Label le convertissait en chaine
  # (le parametre est type [string]), et la ligne suivante cherchait .Text sur une chaine --
  # « The property 'Text' cannot be found on this object », sans console pour le dire.
  if ($Note) {
    $etiqNote = New-Object System.Windows.Forms.Label
    $etiqNote.Text = $Note
    $etiqNote.AutoSize = $false
    $etiqNote.Location = New-Object System.Drawing.Point($xPage, ($Y + 50))
    $etiqNote.Size = New-Object System.Drawing.Size($largeurPage, 32)
    $etiqNote.ForeColor = [System.Drawing.Color]::DimGray
    $Page.Controls.Add($etiqNote)
  }
  return ($Y + 90)
}

$yR = 16

# 1. L'onglet qui s'ouvre au demarrage.
$choixOnglet = @((T 'lanceur.reglages.auto'))
foreach ($jeton in $SzhOrdreOnglets) { $choixOnglet += $SzhProduits[$jeton].onglet }
$rangOnglet = 0
$dejaOnglet = Get-SzhOngletChoisi
if ($dejaOnglet) {
  $vu = [array]::IndexOf([string[]]$SzhOrdreOnglets, $dejaOnglet)
  if ($vu -ge 0) { $rangOnglet = $vu + 1 }
}
$yR = Add-SzhReglage $pageReglages $yR (T 'lanceur.reglages.onglet') $choixOnglet $rangOnglet '' {
    $rang = $this.SelectedIndex
    $voulu = ''
    if ($rang -ge 1) { $voulu = [string]$SzhOrdreOnglets[$rang - 1] }
    [void](Set-SzhOngletChoisi $voulu)
    $dit = 'automatique'
    if ($voulu) { $dit = $voulu }
    Write-SzhLog ('open-produit : onglet par defaut -> ' + $dit)
  }

# 2. La langue de l'interface. L'ordre des langues est fige ici, comme celui des onglets :
# l'index de la liste s'y lit directement.
$script:SzhLanguesReglage = @('fr', 'de')
$choixLangue = @((T 'lanceur.reglages.langue.auto' @((T ('lanceur.reglages.langue.' + (Get-SzhLangueAutomatique))))))
foreach ($lg in $SzhLanguesReglage) { $choixLangue += (T ('lanceur.reglages.langue.' + $lg)) }
$rangLangue = 0
$dejaLangue = (Get-SzhEtatUtilisateurChamp (Get-SzhEtatUtilisateur) 'langueInterface').ToLower()
if ($dejaLangue) {
  $vu = [array]::IndexOf([string[]]$SzhLanguesReglage, $dejaLangue)
  if ($vu -ge 0) { $rangLangue = $vu + 1 }
}
# La fenetre est deja construite dans l'ancienne langue : la reconstruire en entier au clic
# couterait plus cher, en code comme en surprises, que d'attendre la prochaine ouverture. La
# note le dit, plutot que de laisser croire a un reglage qui n'aurait pas pris.
$yR = Add-SzhReglage $pageReglages $yR (T 'lanceur.reglages.langue') $choixLangue $rangLangue `
  (T 'lanceur.reglages.langue.apres') {
    $rang = $this.SelectedIndex
    $voulue = ''
    if ($rang -ge 1) { $voulue = [string]$SzhLanguesReglage[$rang - 1] }
    $resolue = Set-SzhLangueInterface $voulue
    $dit = ('automatique (' + $resolue + ')')
    if ($voulue) { $dit = $voulue }
    Write-SzhLog ('open-produit : langue de l''interface -> ' + $dit)
  }

# 3. La mise a jour, avec ou sans fenetre.
$rangMaj = 0
if (Get-SzhMajSilencieuse) { $rangMaj = 1 }
$yR = Add-SzhReglage $pageReglages $yR (T 'lanceur.reglages.maj') `
  @((T 'lanceur.reglages.maj.visible'), (T 'lanceur.reglages.maj.silence')) $rangMaj `
  (T 'lanceur.reglages.maj.note') {
    $silence = ($this.SelectedIndex -eq 1)
    [void](Set-SzhMajSilencieuse $silence)
    Write-SzhLog ('open-produit : mise a jour silencieuse -> ' + $silence)
  }

# 4. Le mode developpeur. Il vivait dans le formulaire de reglages du cockpit, ou il n'avait
# rien a faire : c'est un interrupteur de POSTE, qui deplace la racine de toutes les revues,
# a cote de reglages qui ne concernent qu'un numero. Rang 0 = production, rang 1 = test, et
# non l'inverse : la liste va du plus sur au moins sur.
$rangDev = 0
if ($modeTest) { $rangDev = 1 }
$yR = Add-SzhReglage $pageReglages $yR (T 'lanceur.reglages.dev') `
  @((T 'lanceur.reglages.dev.non'), (T 'lanceur.reglages.dev.oui')) $rangDev `
  (T 'lanceur.reglages.dev.note') {
    $voulu = $SzhEmplacementProd
    if ($this.SelectedIndex -eq 1) { $voulu = $SzhEmplacementTest }
    [void](Set-SzhEmplacementRevues $voulu)
    Write-SzhLog ('open-produit : emplacement des revues -> ' + $voulu)
  }

# ---- Les boutons, hors du TabControl : ils valent pour l'onglet au premier plan ----
$boutonVersions = New-Object System.Windows.Forms.Button
$boutonVersions.Text = (T 'lanceur.versions.bouton')
$boutonVersions.Location = New-Object System.Drawing.Point(8, $yBoutons)
$boutonVersions.Size = New-Object System.Drawing.Size(170, 32)
$script:form.Controls.Add($boutonVersions)
# Une mise a jour lancee, le lanceur se retire : il afficherait une version perimee.
$boutonVersions.Add_Click({
  if ((Show-SzhVersions $script:form $fichierIcone) -eq $true) {
    $script:form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $script:form.Close()
  }
})

$boutonOk = New-Object System.Windows.Forms.Button
$boutonOk.Text = (T 'lanceur.ouvrir')
$boutonOk.Location = New-Object System.Drawing.Point(438, $yBoutons)
$boutonOk.Size = New-Object System.Drawing.Size(90, 32)
$boutonOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$script:form.Controls.Add($boutonOk)
$script:form.AcceptButton = $boutonOk

$boutonNon = New-Object System.Windows.Forms.Button
$boutonNon.Text = (T 'lanceur.annuler')
$boutonNon.Location = New-Object System.Drawing.Point(534, $yBoutons)
$boutonNon.Size = New-Object System.Drawing.Size(90, 32)
$boutonNon.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$script:form.Controls.Add($boutonNon)
$script:form.CancelButton = $boutonNon

# "Ouvrir" n'a de sens que sur un onglet de produit qui a quelque chose a ouvrir : grise
# ailleurs, plutot qu'actif et sans effet. L'onglet des reglages porte un .Tag vide, ce qui
# suffit a le distinguer des trois autres.
$script:boutonOk = $boutonOk
function Update-SzhBoutonOuvrir($Onglets) {
  $jeton = ''
  try { $jeton = [string]$Onglets.SelectedTab.Tag } catch { }
  if ($jeton -and $script:panneaux.ContainsKey($jeton)) {
    $p = $script:panneaux[$jeton]
    $script:boutonOk.Enabled = (($p.enCours.Count + $p.archives.Count) -gt 0)
  } else {
    $script:boutonOk.Enabled = $false
  }
}
$onglets.Add_SelectedIndexChanged({ Update-SzhBoutonOuvrir $this })

# L'onglet d'ouverture, enfin : pose APRES les gestionnaires, pour que celui du dessus
# regle l'etat du bouton "Ouvrir" du premier coup.
$rangActif = [array]::IndexOf([string[]]$SzhOrdreOnglets, $ongletActif)
if ($rangActif -lt 0) { $rangActif = 0 }
$onglets.SelectedIndex = $rangActif
Update-SzhBoutonOuvrir $onglets
Write-SzhLog ('open-produit : ouverture sur l''onglet ' + $ongletActif)

$resultat = $script:form.ShowDialog()
if ($resultat -eq [System.Windows.Forms.DialogResult]::OK) {
  # Le TabControl survit a la fermeture d'une fenetre montree par ShowDialog (rien n'est
  # libere tant que Dispose n'est pas appele) : l'onglet qui etait au premier plan est donc
  # encore lisible ici. Repli sur l'onglet d'ouverture, par prudence.
  $jetonFinal = $ongletActif
  try {
    $vu = [string]$onglets.SelectedTab.Tag
    if ($vu -and $script:panneaux.ContainsKey($vu)) { $jetonFinal = $vu }
  } catch { }
  $p = $script:panneaux[$jetonFinal]
  $choix = $null
  if ($p.liste.SelectedIndex -ge 0) { $choix = $p.enCours[$p.liste.SelectedIndex] }
  elseif (($p.listeArchives.SelectedIndex -ge 0) -and ($p.archives.Count -gt 0)) {
    $choix = $p.archives[$p.listeArchives.SelectedIndex]
  }
  if ($choix) { [void](Start-SzhCodium $choix.chemin) }
}
