# Emplacements des revues et des livres (test ou production), lecteur YAML plat, identité
# d'un numéro ou d'un livre, écriture de leurs clés, liens szh:// et intention d'ouverture.
# Compatible Windows PowerShell 5.1 : pas de ?. ?? ?: && ||.

# ---- Emplacement des revues et des livres : test ou production ----
# Seul endroit qui décide où vivent les revues : le cockpit ne calcule aucun chemin
# SharePoint et confie l'archivage à archive-revue.ps1.
#
# Une seule table pour les deux racines : un essai dans le dossier de test passe par les
# mêmes chemins que la production, seule la base change. Ces lignes ne dépendent pas de
# l'emplacement actif.
#
# Les trois produits vivent dans l'arbre de l'application (szh-ancrage.ps1,
# $SzhSegmentApplication), les livres sous « Books ».
#
# Forme de l'arbre :
#   * un numéro en cours est directement sous son dossier produit : `Revue\2026-01` ;
#   * les archives sont regroupées sous `_Archive\`, un sous-dossier par produit :
#     `_Archive\Revue\2020-05`.
# Les deux états n'ont donc pas la même profondeur sous la racine. Le code qui remonte d'un
# numéro vers la racine reconnaît des noms au lieu de compter des niveaux (voir racineArbre()
# dans vscodium-extension/szh-cockpit/lib/kirby-contenu.js).
$script:SzhSousDossiers = @{
  revue       = @{ encours = 'Revue';        archive = '_Archive\Revue' }
  zeitschrift = @{ encours = 'Zeitschrift';  archive = '_Archive\Zeitschrift' }
  livre       = @{ encours = 'Books';        archive = '_Archive\Books' }
}

# Les autres dossiers qui suivent la racine active (test ou production), identiques sous
# les deux. Seul le mode test les crée (Initialize-SzhEmplacementsTest) ; en production,
# l'arborescence est celle de SharePoint.
#   _NewsUndActu\          la bibliothèque de fiches et d'actualités, commune aux deux
#                          rédactions (docs/FORMAT-DOCUMENTATION-KIRBY.md) : `Fiches\` pour
#                          les fiches, `_Statuts\fr\` et `_Statuts\de\` pour leur état par
#                          langue. Le cockpit en gère le contenu.
#   Exports                les sorties du secrétariat, un sous-dossier par export (le cockpit).
#
# `_Systeme\` (rapports d'erreur, journaux, suggestions, inventaire des postes) n'est pas
# dans cette liste : il est toujours sur SharePoint, trouvé par Resolve-SzhAncrage (voir
# Get-SzhDossierSysteme), même quand le poste travaille dans la racine de test.
#
# `_Archive\` non plus : ses sous-dossiers sont les moitiés « archive » de $SzhSousDossiers.

# Le nom de la bibliothèque partagée, écrit ici seulement. windows\szh-migration.ps1, chargé
# juste après, réutilise $SzhDossiersCommuns et $SzhSousDossiers. Les sous-dossiers de la
# bibliothèque sont rangés par langue et non par produit (voir
# docs/FORMAT-DOCUMENTATION-KIRBY.md) ; ce code garantit seulement qu'ils existent.
$script:SzhNomDossierReserve = '_NewsUndActu'
$script:SzhDossiersBibliotheque = @(
  (Join-Path $SzhNomDossierReserve 'Fiches'),
  (Join-Path $SzhNomDossierReserve '_Statuts\fr'),
  (Join-Path $SzhNomDossierReserve '_Statuts\de')
)

$script:SzhDossiersCommuns = @($SzhDossiersBibliotheque) + @(
  'Exports'
)

# Les deux racines par défaut, dernier recours de Get-SzhBaseRevuesPour ci-dessous.
#   prod : la bibliothèque SharePoint et le dossier de l'application, tiré de
#          $SzhDeriveBaseProduits (szh-ancrage.ps1). Normalement, c'est l'ancrage SharePoint
#          résolu qui donne la racine.
#   dev  : la racine d'essai, déjà utilisée par des postes : à ne pas renommer.
# Les trois produits partagent la même racine ; seuls les sous-dossiers changent.
$script:SzhBasesDefaut = @{
  prod = (Join-Path '%USERPROFILE%\SZH CSPS\Daten_Allgemein - General' $SzhDeriveBaseProduits)
  dev  = '%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING'
}

# Les deux valeurs de `emplacementRevues` dans config.json. L'ancienne clé `devMode` est
# encore lue : des postes la portent.
$script:SzhEmplacementTest = 'test'
$script:SzhEmplacementProd = 'production'

# Booléen d'un JSON écrit à la main : $true/$false, "true"/"false", 1/0 ; tout le reste rend
# $null (« clé absente »). Sans cela, `"devMode": "false"` vaudrait vrai ici ([bool]'false'
# est $true) et faux côté JavaScript.
function Resolve-SzhBooleenConfig($Valeur) {
  if ($null -eq $Valeur) { return $null }
  if ($Valeur -is [bool]) { return $Valeur }
  if ($Valeur -is [int] -or $Valeur -is [long] -or $Valeur -is [double] -or $Valeur -is [decimal]) {
    if ($Valeur -eq 1) { return $true }
    if ($Valeur -eq 0) { return $false }
    return $null
  }
  $t = ([string]$Valeur).Trim().ToLower()
  if ($t -eq 'true') { return $true }
  if ($t -eq 'false') { return $false }
  return $null
}

# Sans lecture du disque : `emplacementRevues`, puis `devMode`, puis « test » par défaut.
# Initialize-SzhEmplacementRevues consulte le disque une fois pour écrire la valeur. Mêmes
# règles que resoudreEmplacementRevues() de lib/archivage.js ; test/js/emplacements.test.js
# compare les deux.
function Resolve-SzhEmplacementRevues($Config) {
  if ($Config) {
    $brut = $null
    if ($Config.PSObject.Properties['emplacementRevues']) { $brut = $Config.emplacementRevues }
    $v = ([string]$brut).Trim().ToLower()
    if ($v -eq $SzhEmplacementProd) { return $SzhEmplacementProd }
    if ($v -eq $SzhEmplacementTest) { return $SzhEmplacementTest }
    $ancien = $null
    if ($Config.PSObject.Properties['devMode']) { $ancien = Resolve-SzhBooleenConfig $Config.devMode }
    if ($null -ne $ancien) {
      if ($ancien) { return $SzhEmplacementTest }
      return $SzhEmplacementProd
    }
  }
  return $SzhEmplacementTest
}

# ---- Racines d'essai, une par emplacement ----
# Comme $env:SZH_ANCRAGE (szh-ancrage.ps1) et $env:SZH_RAPPORTS (lib/rapport-erreur.js) :
# une variable d'environnement posée pour un essai ou un test, jamais écrite nulle part.
# Elle remplace la racine telle quelle, sans rien y ajouter.
#   * $env:SZH_RACINE_TEST : la racine de test. Elle ne dérive d'aucun ancrage ; c'est le
#     seul moyen pour test/js/lanceur.test.js de faire travailler le lanceur ailleurs que
#     dans le OneDrive du poste.
#   * $env:SZH_RACINE_PROD : la racine de production. $env:SZH_ANCRAGE suffit le plus
#     souvent ; celle-ci donne la racine exacte sans fabriquer d'ancrage.
# Voir docs/EMPLACEMENTS.md.
$script:SzhVariableRacine = @{ prod = 'SZH_RACINE_PROD'; dev = 'SZH_RACINE_TEST' }

# Base d'un emplacement (clés `dev` et `prod`).
#
# Trois sources, de la plus forte à la plus faible :
#   1. la racine d'essai ci-dessus, s'il y en a une ;
#   2. pour « prod » seulement : l'ancrage SharePoint résolu (Resolve-SzhAncrage), dont la
#      racine des produits dérive ;
#   3. le défaut écrit en dur ($SzhBasesDefaut).
#
# La racine de production vient du dossier trouvé sur le disque, pas d'un chemin écrit dans
# la configuration, qui ne suivrait pas un déplacement de la bibliothèque. Un poste dont la
# bibliothèque est synchronisée ailleurs se répare en rattachant l'ancrage
# (`ancrageSharePoint`).
function Get-SzhBaseRevuesPour([string]$Emplacement) {
  $cle = 'prod'
  if ($Emplacement -eq $SzhEmplacementTest) { $cle = 'dev' }
  $essai = ([string][Environment]::GetEnvironmentVariable($SzhVariableRacine[$cle])).Trim()
  if ($essai) { return [Environment]::ExpandEnvironmentVariables($essai) }
  if ($cle -eq 'prod') {
    $ancrage = Resolve-SzhAncrage
    if ($ancrage -and $ancrage.chemin) { return (Get-SzhBaseProduitsDepuisAncrage $ancrage.chemin) }
  }
  return [Environment]::ExpandEnvironmentVariables($SzhBasesDefaut[$cle])
}

# ---- `_Systeme\` : toujours sur SharePoint ----
# Journaux, suggestions et inventaire des postes (les rapports d'erreur passent par
# szh-rapport.ps1) vont sur SharePoint même quand le poste travaille dans la racine de
# test : c'est là que les rédactions et les postes les retrouvent. L'ancrage est résolu
# directement, sans Get-SzhBaseRevuesPour, qui suivrait `emplacementRevues`. Crée le
# dossier s'il manque. Rend '' si l'ancrage n'est pas résolu : l'appelant journalise et
# n'écrit rien, sans repli vers OneDrive (voir docs/RAPPORTS-ERREUR.md).
function Get-SzhDossierSysteme([string]$SousDossier) {
  $ancrage = $null
  try { $ancrage = Resolve-SzhAncrage } catch { return '' }
  if (-not $ancrage -or -not $ancrage.chemin) { return '' }
  $chemin = Get-SzhDossierSystemeDepuisAncrage $ancrage.chemin $SousDossier
  if (-not $chemin) { return '' }
  try {
    if (-not (Test-Path -LiteralPath $chemin -PathType Container)) {
      New-Item -ItemType Directory -Force -Path $chemin -ErrorAction Stop | Out-Null
    }
  } catch { return '' }
  return $chemin
}

# Combien de numéros (et de livres) dorment sous un emplacement : un dossier portant un
# ausgabe.yaml ou un buch.yaml, dans les six dossiers des trois produits (trois en cours à
# la racine, trois sous `_Archive\`). Sans exception : un OneDrive non synchronisé rend 0.
function Measure-SzhNumeros([string]$Emplacement) {
  $base = Get-SzhBaseRevuesPour $Emplacement
  $total = 0
  foreach ($produit in @('revue', 'zeitschrift', 'livre')) {
    $manifeste = [string]$SzhProduits[$produit].manifeste
    foreach ($etat in @('encours', 'archive')) {
      $racine = Join-Path $base $SzhSousDossiers[$produit][$etat]
      if (-not (Test-Path $racine)) { continue }
      try {
        $total += @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue |
          Where-Object { Test-Path (Join-Path $_.FullName $manifeste) }).Count
      } catch { }
    }
  }
  return $total
}

# Écrit l'emplacement dans config.json quand il n'y est pas, pour qu'il ne dépende pas d'un
# défaut qu'une mise à jour pourrait changer.
#
#   * `emplacementRevues` déjà présent et valide : rien ;
#   * `devMode` seul : recopié sous `emplacementRevues`, même valeur ;
#   * ni l'un ni l'autre : « production » si la racine de production porte des numéros et
#     celle de test aucun, « test » sinon. Le compte des deux racines va au journal ; une
#     ligne de config.json suffit à changer (docs/EMPLACEMENTS.md).
#
# N'écrit rien si config.json n'existe pas : bootstrap.ps1 le crée lui-même, avec `repo` et
# `revuesRoots`. Au plus une fois par processus.
$script:SzhEmplacementFige = $false
function Initialize-SzhEmplacementRevues {
  if ($SzhEmplacementFige) { return '' }
  $script:SzhEmplacementFige = $true
  if (-not (Test-Path $SzhConfigFile)) { return '' }
  $cfg = Get-SzhConfig
  if (-not $cfg) { return '' }
  if ($cfg.PSObject.Properties['emplacementRevues']) {
    $deja = ([string]$cfg.emplacementRevues).Trim().ToLower()
    if ($deja -eq $SzhEmplacementProd -or $deja -eq $SzhEmplacementTest) { return '' }
  }
  $ancien = $null
  if ($cfg.PSObject.Properties['devMode']) { $ancien = Resolve-SzhBooleenConfig $cfg.devMode }
  if ($null -ne $ancien) {
    $choisi = $SzhEmplacementProd
    if ($ancien) { $choisi = $SzhEmplacementTest }
    $motif = 'devMode existant recopie'
  } else {
    $nTest = Measure-SzhNumeros $SzhEmplacementTest
    $nProd = Measure-SzhNumeros $SzhEmplacementProd
    $choisi = $SzhEmplacementTest
    if ($nTest -eq 0 -and $nProd -gt 0) { $choisi = $SzhEmplacementProd }
    $motif = ('numeros trouves : test {0}, production {1}' -f $nTest, $nProd)
  }
  try {
    if ($cfg.PSObject.Properties['emplacementRevues']) { $cfg.emplacementRevues = $choisi }
    else { $cfg | Add-Member -MemberType NoteProperty -Name 'emplacementRevues' -Value $choisi }
    Set-SzhJson $SzhConfigFile $cfg
    Write-SzhLog ('emplacement des revues : "{0}" ecrit dans config.json ({1})' -f $choisi, $motif)
  } catch {
    try { Write-SzhLog ('emplacement des revues : ecriture impossible (' + $_.Exception.Message + ')') } catch { }
  }
  return $choisi
}

# Emplacement actif. Le premier appel écrit la valeur dans config.json si besoin.
function Get-SzhEmplacementRevues {
  [void](Initialize-SzhEmplacementRevues)
  return (Resolve-SzhEmplacementRevues (Get-SzhConfig))
}

# Les quatre emplacements de revue du poste, plus les deux de livre ; les listes à plat
# (`encours`/`archives`) ne portent que les deux produits de revue, parce que leurs lecteurs
# (new-revue.ps1, lib/auteurs-corpus.js) s'en servent pour décider qu'un dossier est « une
# revue » : y mettre Books ferait passer un livre pour tel. Le livre vit à part, dans sa
# propre paire `livre.encours`/`livre.archive` (Get-SzhEmplacementRevue 'livre' …). La racine active part au journal une fois par processus : après coup, il dit
# d'où venaient les revues d'un lancement donné.
$script:SzhRacineJournalisee = $false
function Get-SzhEmplacements {
  $emplacement = Get-SzhEmplacementRevues
  $base = Get-SzhBaseRevuesPour $emplacement
  if (-not $SzhRacineJournalisee) {
    $script:SzhRacineJournalisee = $true
    try { Write-SzhLog ('revues : emplacement "{0}" -> {1}' -f $emplacement, $base) } catch { }
  }
  $revue = @{
    encours = (Join-Path $base $SzhSousDossiers.revue.encours)
    archive = (Join-Path $base $SzhSousDossiers.revue.archive)
  }
  $zeitschrift = @{
    encours = (Join-Path $base $SzhSousDossiers.zeitschrift.encours)
    archive = (Join-Path $base $SzhSousDossiers.zeitschrift.archive)
  }
  $livre = @{
    encours = (Join-Path $base $SzhSousDossiers.livre.encours)
    archive = (Join-Path $base $SzhSousDossiers.livre.archive)
  }
  return [pscustomobject]@{
    emplacement = $emplacement
    devMode     = ($emplacement -eq $SzhEmplacementTest)
    base        = $base
    revue       = $revue
    zeitschrift = $zeitschrift
    livre       = $livre
    encours     = @($revue.encours, $zeitschrift.encours)
    archives    = @($revue.archive, $zeitschrift.archive)
  }
}

# En mode test seulement, crée les dossiers manquants : les six des trois produits (trois en
# cours, trois sous `_Archive\`) et ceux de $SzhDossiersCommuns, pour que la racine d'essai
# montre l'arbre complet. En production, l'arborescence est celle de SharePoint.
# New-Item -Force crée au passage le dossier parent `_Archive\`.
function Initialize-SzhEmplacementsTest {
  # En simulation, seule une racine d'essai désignée reçoit l'arbre, jamais celle du poste.
  if (($env:SZH_LANCEUR_SIMULE -eq '1') -and (-not $env:SZH_RACINE_TEST)) { return $false }
  $emp = Get-SzhEmplacements
  if (-not $emp.devMode) { return $false }
  $communs = @()
  foreach ($c in $SzhDossiersCommuns) { $communs += (Join-Path $emp.base $c) }
  foreach ($d in ($emp.encours + $emp.archives + @($emp.livre.encours, $emp.livre.archive) + $communs)) {
    if (-not (Test-Path $d)) {
      try { New-Item -ItemType Directory -Force -Path $d | Out-Null } catch { }
    }
  }
  return $true
}

# $Jeton = 'revue' | 'zeitschrift' | 'livre', $Etat = 'encours' | 'archive' ; '' si jeton
# inconnu. open-livre.ps1 s'en sert comme open-revue.ps1.
function Get-SzhEmplacementRevue([string]$Jeton, [string]$Etat) {
  if (-not $SzhProduits.ContainsKey($Jeton)) { return '' }
  return [string](Get-SzhEmplacements).$Jeton.$Etat
}

# ---- Lecture d'ausgabe.yaml ----
# YAML plat, une clé par ligne, comme le sed du Makefile : pas de module YAML à installer
# sur le poste. Guillemets et commentaire de fin de ligne retirés, première occurrence
# gagnante, comme analyserAusgabe côté cockpit.
function Get-SzhAusgabe([string]$Fichier) {
  $valeurs = @{}
  if (-not (Test-Path $Fichier)) { return $valeurs }
  foreach ($ligne in (Get-Content $Fichier -Encoding UTF8)) {
    if ($ligne -notmatch '^([A-Za-z0-9_-]+):\s*(.*)$') { continue }
    $cle = $Matches[1]
    if ($valeurs.ContainsKey($cle)) { continue }
    $brut = $Matches[2].Trim()
    if ($brut -match '^"(.*)"\s*(#.*)?$') { $brut = $Matches[1] }
    elseif ($brut -match "^'(.*)'\s*(#.*)?$") { $brut = $Matches[1] }
    elseif ($brut -match '^([^#]*?)\s*#.*$') { $brut = $Matches[1] }
    $valeurs[$cle] = $brut.Trim()
  }
  return $valeurs
}

# Valeurs « vraies » tolérées, à garder alignées avec VRAIS_YAML (lib/yaml.js) et
# szh-maquette.lua : un ausgabe.yaml peut avoir été écrit à la main.
function Test-SzhVraiYaml($Valeur) {
  if ($null -eq $Valeur) { return $false }
  return (@('true', '1', 'oui', 'ja', 'yes', 'si') -contains ([string]$Valeur).Trim().ToLower())
}

# Accepte aussi l'ancien nom complet ; « zeitschrift » testé avant « revue », même ordre
# que normaliserRevue côté cockpit.
function Get-SzhJetonRevue($Valeur) {
  $v = ([string]$Valeur).ToLower()
  if ($v -like '*zeitschrift*') { return 'zeitschrift' }
  if ($v -like '*revue*') { return 'revue' }
  return ''
}

# État complet d'un dossier de revue, pour le lanceur et pour l'archivage.
function Get-SzhRevueEtat([string]$Dossier) {
  $valeurs = Get-SzhAusgabe (Join-Path $Dossier 'ausgabe.yaml')
  $titre = ''
  if ($valeurs.ContainsKey('title')) { $titre = $valeurs['title'] }
  $jeton = ''
  if ($valeurs.ContainsKey('revue')) { $jeton = Get-SzhJetonRevue $valeurs['revue'] }
  $verrou = $false
  if ($valeurs.ContainsKey('locked')) { $verrou = Test-SzhVraiYaml $valeurs['locked'] }
  $archive = $false
  if ($valeurs.ContainsKey('archived')) { $archive = Test-SzhVraiYaml $valeurs['archived'] }
  return [pscustomobject]@{
    dossier     = $Dossier
    titre       = $titre
    jeton       = $jeton
    verrouillee = $verrou
    archivee    = $archive
  }
}

# État complet d'un dossier de livre, sur le modèle de Get-SzhRevueEtat, pour l'onglet
# « Book » du lanceur. Lit buch.yaml avec Get-SzhAusgabe.
#
# La langue se lit dans `lang:`, la clé que lit la chaîne (pipeline/livre-assembler.py,
# `meta.get('lang')`). `langue:` est acceptée aussi ; `lang:` l'emporte si les deux sont
# présentes.
function Get-SzhLivreEtat([string]$Dossier) {
  $valeurs = Get-SzhAusgabe (Join-Path $Dossier 'buch.yaml')
  $titre = ''
  if ($valeurs.ContainsKey('titre')) { $titre = $valeurs['titre'] }
  $langue = ''
  if ($valeurs.ContainsKey('lang')) { $langue = $valeurs['lang'] }
  elseif ($valeurs.ContainsKey('langue')) { $langue = $valeurs['langue'] }
  $maquette = 'normal'
  if ($valeurs.ContainsKey('maquette') -and $valeurs['maquette']) { $maquette = $valeurs['maquette'] }
  $verrou = $false
  if ($valeurs.ContainsKey('locked')) { $verrou = Test-SzhVraiYaml $valeurs['locked'] }
  $archive = $false
  if ($valeurs.ContainsKey('archived')) { $archive = Test-SzhVraiYaml $valeurs['archived'] }
  return [pscustomobject]@{
    dossier     = $Dossier
    titre       = $titre
    langue      = $langue
    maquette    = $maquette
    verrouillee = $verrou
    archivee    = $archive
  }
}

# ---- Identité d'un numéro : année, numéro, volume ----
# Le volume est le millésime de la revue, un par année civile. Il s'imprime sur la
# couverture (szh-maquette.lua) et part dans OJS en <volume>. Il se déduit de l'année, avec
# une année de départ propre à chaque revue (relevé sur ojs.szh.ch, 2018 à 2026) :
#   Revue        2018 -> Vol. 8  … 2026 -> Vol. 16    soit annee - 2010
#   Zeitschrift  2018 -> Bd. 24  … 2026 -> Bd. 32     soit annee - 1994
# Le nombre de numéros d'une année ne dit rien du volume. Si une revue sautait ou doublait
# un volume, le formulaire garde un réglage manuel.
$script:SzhVolumeAnneeZero = @{
  revue       = 2010
  zeitschrift = 1994
}

# ---- Couleur annuelle d'un numéro ----
# Même calcul que couleurAnnuelle() dans vscodium-extension/szh-cockpit/lib/yaml.js ;
# test/js/couleur-annuelle.test.js les compare (il lit ce fichier en texte et en extrait les
# ancres par expression régulière).
#
# La palette, dans l'ordre alphabétique des noms français, donne la couleur de l'année
# suivante : réordonner la liste change les couleurs futures des deux revues.
$script:SzhCouleursNumero = @(
  @{ cle = 'bleuacier';   hex = '#5F9FBC' },
  @{ cle = 'capucine';    hex = '#EB5E51' },
  @{ cle = 'mountbatten'; hex = '#A98899' },
  @{ cle = 'moutarde';    hex = '#C7CF1C' },
  @{ cle = 'poireau';     hex = '#51A66D' },
  @{ cle = 'rouge';       hex = '#D31932' }
)

# Les couleurs des numéros parus en 2026 (Zeitschrift vol. 32, Revue vol. 16) : les autres
# années s'en déduisent.
$script:SzhCouleurAnneeAncre = @{
  zeitschrift = @{ annee = 2026; cle = 'bleuacier' }
  revue       = @{ annee = 2026; cle = 'poireau' }
}

# Couleur calculée, ou '' si le produit est inconnu ou l'année illisible. Boucle sur les six
# teintes ; le modulo de PowerShell (%) peut rendre un reste négatif pour une année antérieure
# à l'ancre, d'où le double modulo, comme côté cockpit.
function Get-SzhCouleurPour([string]$Produit, [int]$Annee) {
  $jeton = Get-SzhJetonRevue $Produit
  if (-not $jeton) { return '' }
  if (-not $SzhCouleurAnneeAncre.ContainsKey($jeton)) { return '' }
  $ancre = $SzhCouleurAnneeAncre[$jeton]
  $n = $SzhCouleursNumero.Count
  $depart = 0
  for ($i = 0; $i -lt $n; $i++) { if ($SzhCouleursNumero[$i].cle -eq $ancre.cle) { $depart = $i } }
  $ecart = $Annee - $ancre.annee
  $index = ((($depart + $ecart) % $n) + $n) % $n
  return $SzhCouleursNumero[$index].hex
}

# Volume calculé, ou 0 si le produit est inconnu ou l'année antérieure au premier volume.
function Get-SzhVolumePour([string]$Produit, [int]$Annee) {
  $jeton = Get-SzhJetonRevue $Produit
  if (-not $jeton) { return 0 }
  if (-not $SzhVolumeAnneeZero.ContainsKey($jeton)) { return 0 }
  $volume = $Annee - $SzhVolumeAnneeZero[$jeton]
  if ($volume -lt 1) { return 0 }
  return $volume
}

# Première année dont le volume existe : la borne basse du formulaire, qui ne propose ainsi
# pas de volume nul ou négatif.
function Get-SzhPremiereAnnee([string]$Produit) {
  $jeton = Get-SzhJetonRevue $Produit
  if ($jeton -and $SzhVolumeAnneeZero.ContainsKey($jeton)) { return ($SzhVolumeAnneeZero[$jeton] + 1) }
  return 1
}

# Nom de dossier d'un numéro : « AAAA-NN », numéro sur deux chiffres. szh-maquette.lua y lit
# l'année quand `date:` est vide, et lib/yaml.js le titre de la barre latérale ; le nom se
# déduit donc, il ne se saisit pas.
function Get-SzhNomNumero([int]$Annee, [int]$Numero) {
  return ('{0:0000}-{1:00}' -f $Annee, $Numero)
}

# Entier d'une valeur d'ausgabe.yaml, 0 si elle n'en est pas une : « 01 » et « 1 » sont le
# même numéro, et un champ vide n'en est aucun.
function Get-SzhEntierYaml($Valeur) {
  $texte = ([string]$Valeur).Trim()
  if ($texte -notmatch '^[0-9]{1,6}$') { return 0 }
  return [int]$texte
}

# Un numéro se reconnaît à son couple volume + numéro, pas à son nom de dossier : deux
# dossiers peuvent porter le même couple, ce qu'il faut refuser. La recherche couvre les
# numéros en cours et les archives : un numéro archivé occupe toujours son volume.
#
# Rend $null, ou le premier numéro trouvé : { nom, chemin, dossier, archive }.
function Find-SzhNumeroVolume([string]$Produit, [int]$Volume, [int]$Numero) {
  if ($Volume -lt 1) { return $null }
  if ($Numero -lt 1) { return $null }
  $jeton = Get-SzhJetonRevue $Produit
  if (-not $jeton) { return $null }
  foreach ($etat in @('encours', 'archive')) {
    $racine = Get-SzhEmplacementRevue $jeton $etat
    if (-not $racine) { continue }
    if (-not (Test-Path $racine)) { continue }
    $dossiers = @()
    try { $dossiers = @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue) } catch { }
    foreach ($d in $dossiers) {
      $fichier = Join-Path $d.FullName 'ausgabe.yaml'
      if (-not (Test-Path $fichier)) { continue }
      $valeurs = Get-SzhAusgabe $fichier
      # Le produit vient du jeton du numéro, pas de son emplacement : un dossier mal rangé ne
      # bloque pas la création d'un numéro de l'autre revue.
      $sien = ''
      if ($valeurs.ContainsKey('revue')) { $sien = Get-SzhJetonRevue $valeurs['revue'] }
      if ($sien -ne $jeton) { continue }
      if ((Get-SzhEntierYaml $valeurs['volume']) -ne $Volume) { continue }
      if ((Get-SzhEntierYaml $valeurs['numero']) -ne $Numero) { continue }
      return [pscustomobject]@{
        nom     = $d.Name
        chemin  = $d.FullName
        dossier = $racine
        archive = ($etat -eq 'archive')
      }
    }
  }
  return $null
}

# ---- Identité d'un livre : titre, année, référence B ----
# Un livre a un titre, une année et une référence B. Nom de dossier d'un livre neuf :
# « <année>-B<référence>-<nom> », le <nom> étant déduit du titre (comme Get-SzhNomNumero).
# Des dossiers plus anciens ont d'autres formes (« Buch_2019-B301-Thaler »).
#
# Translittération en ASCII (accents retirés, le reste réduit à des « _ »), comme à l'import
# (iconv -t ASCII//TRANSLIT, pipeline/Makefile). 40 caractères au plus : le nom revient
# plusieurs fois dans un chemin de sortie (out/<nom>.pdf…), et la limite Windows est de 260
# caractères.
function Get-SzhSlugLivre([string]$Titre) {
  $texte = ([string]$Titre).Trim()
  $decompose = $texte.Normalize([Text.NormalizationForm]::FormD)
  $sansAccents = -join ($decompose.ToCharArray() | Where-Object {
    [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne
      [Globalization.UnicodeCategory]::NonSpacingMark
  })
  $slug = ($sansAccents -replace '[^A-Za-z0-9]+', '_').Trim('_')
  if ($slug.Length -gt 40) { $slug = $slug.Substring(0, 40).Trim('_') }
  if (-not $slug) { $slug = 'Livre' }
  return $slug
}

# Nom de dossier d'un livre neuf : « <année>-B<référence>-<nom> ». Voir Get-SzhSlugLivre.
function Get-SzhNomLivre([int]$Annee, [int]$Reference, [string]$Titre) {
  return ('{0}-B{1}-{2}' -f $Annee, $Reference, (Get-SzhSlugLivre $Titre))
}

# Un livre se reconnaît à sa référence B, comme un numéro à son volume (Find-SzhNumeroVolume).
# buch.yaml ne porte pas cette référence : elle est lue dans le nom du dossier, selon le
# motif de Get-SzhNomLivre. La recherche couvre les livres en cours et les archives.
#
# Rend $null, ou le premier livre trouvé : { nom, titre, chemin, dossier, archive }.
function Find-SzhLivreReference([int]$Reference) {
  if ($Reference -lt 1) { return $null }
  foreach ($etat in @('encours', 'archive')) {
    $racine = Get-SzhEmplacementRevue 'livre' $etat
    if (-not $racine) { continue }
    if (-not (Test-Path $racine)) { continue }
    $dossiers = @()
    try { $dossiers = @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue) } catch { }
    foreach ($d in $dossiers) {
      if ($d.Name -notmatch '^\d{4}-B(\d+)-') { continue }
      if ([int]$Matches[1] -ne $Reference) { continue }
      if (-not (Test-Path (Join-Path $d.FullName 'buch.yaml'))) { continue }
      $etatLivre = Get-SzhLivreEtat $d.FullName
      return [pscustomobject]@{
        nom     = $d.Name
        titre   = $etatLivre.titre
        chemin  = $d.FullName
        dossier = $racine
        archive = ($etat -eq 'archive')
      }
    }
  }
  return $null
}



# ---- Écriture d'une clé plate dans ausgabe.yaml (ou buch.yaml) ----
# Ligne existante remplacée, sinon ajoutée en fin de fichier : le reste est préservé,
# comme serialiserAusgabe côté cockpit. `$Cite` suit formaterValeurYaml ; `revue` et
# `lang` restent des jetons nus, le sed du Makefile ne comprenant pas les guillemets.
# `$Vide` autorise une valeur vide, pour qu'un appel sans valeur n'efface pas une clé.
#
# `$NomFichier` : « ausgabe.yaml » par défaut ; new-livre.ps1 passe « buch.yaml ». Son nom
# diffère de la variable locale `$fichier` : PowerShell ignore la casse des noms de
# variables.
function Set-SzhAusgabeCle([string]$Dossier, [string]$Cle, [string]$Valeur, [bool]$Cite, [bool]$Vide, [string]$NomFichier = 'ausgabe.yaml') {
  if ((-not $Valeur) -and (-not $Vide)) { return $false }
  $fichier = Join-Path $Dossier $NomFichier
  if (-not (Test-Path $fichier)) { return $false }
  $lignes = @(Get-Content $fichier -Encoding UTF8)
  $ligne = ('{0}: {1}' -f $Cle, $Valeur)
  if ($Cite) { $ligne = ('{0}: "{1}"' -f $Cle, $Valeur) }
  $trouvee = $false
  for ($i = 0; $i -lt $lignes.Count; $i++) {
    if ($lignes[$i] -match ('^' + [regex]::Escape($Cle) + ':')) { $lignes[$i] = $ligne; $trouvee = $true; break }
  }
  if (-not $trouvee) { $lignes += $ligne }
  # Sans BOM et par remplacement atomique : les lecteurs ancrés en début de ligne (sed du
  # Makefile, ^title: de szh-maquette.lua) ne savent pas ignorer un BOM.
  $tmp = Join-Path $Dossier ('~$' + $NomFichier)
  [System.IO.File]::WriteAllLines($tmp, $lignes, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $tmp -Destination $fichier -Force
  return $true
}

# `version-toolkit` : la version avec laquelle le numéro ou le livre a été créé, pour le
# recomposer plus tard à l'identique. Posée à la création seulement.
function Set-SzhAusgabeVersion([string]$Dossier, [string]$Version, [string]$NomFichier = 'ausgabe.yaml') {
  return (Set-SzhAusgabeCle $Dossier 'version-toolkit' $Version $true $false $NomFichier)
}

# ---- Identifiant fixe d'un numéro ou d'un livre : `id:` ----
# 16 caractères [A-Za-z0-9], posé une fois à la création (new-revue.ps1, new-livre.ps1) ou
# par la migration (windows\szh-migration.ps1) pour un manifeste qui n'en a pas, puis jamais
# recalculé : un lien szh:// (voir plus bas) reste ainsi valable après un renommage ou un
# archivage du dossier. Même alphabet que le lien (`RE_ID`, lib/liens.js).
$script:SzhIdMotif = '^[A-Za-z0-9]{16}$'
$script:SzhIdAlphabet = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function Test-SzhIdValide([string]$Id) {
  if (-not $Id) { return $false }
  return ($Id -match $SzhIdMotif)
}

# Get-Random suffit : un id n'est pas un secret. 16 caractères sur un alphabet de 62 rendent
# une collision improbable ; en cas de collision, Find-SzhRevue rend le premier dossier
# trouvé.
function New-SzhId {
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt 16; $i++) {
    [void]$sb.Append($SzhIdAlphabet[(Get-Random -Minimum 0 -Maximum $SzhIdAlphabet.Length)])
  }
  return $sb.ToString()
}

# Pose un id seulement s'il manque : rend $false sans rien écrire si `id:` est déjà présent
# et valide, $true si un id neuf a été posé.
function Set-SzhAusgabeIdSiAbsent([string]$Dossier, [string]$NomFichier = 'ausgabe.yaml') {
  $fichier = Join-Path $Dossier $NomFichier
  if (-not (Test-Path -LiteralPath $fichier)) { return $false }
  $valeurs = Get-SzhAusgabe $fichier
  if ($valeurs.ContainsKey('id') -and (Test-SzhIdValide $valeurs['id'])) { return $false }
  return (Set-SzhAusgabeCle $Dossier 'id' (New-SzhId) $true $false $NomFichier)
}

# ---- Liens profonds « szh:// » ----
# Deux verbes, alignés avec lib/liens.js, qui fabrique les liens côté cockpit :
#
#   szh://traduction/<produit>/<id>[/<article>]
#     Collé dans un e-mail par « Envoyer pour traduction ».
#
#   szh://ouvrir/<produit>/<id>
#     Porté par le raccourci posé à la racine de chaque numéro ou livre
#     (Set-SzhRaccourciRevue, szh-shell.ps1). Il ouvre le dossier sans viser de panneau du
#     cockpit. Le livre n'a pas de suivi de traduction, seulement ce verbe.
#
# Le lien porte l'identifiant du numéro (`id:` d'ausgabe.yaml ou de buch.yaml, voir
# Set-SzhAusgabeIdSiAbsent), pas son nom de dossier : un renommage ou un archivage ne casse
# pas un lien déjà envoyé.
#
# Un lien vient d'un e-mail ou d'un .lnk recopié par OneDrive, source non fiable : l'id
# (16 caractères [A-Za-z0-9]) exclut tout séparateur de chemin, toute lettre de lecteur et
# tout « .. ».
#
# Les deux motifs sont recopiés tels quels dans lib/liens.js (MOTIF_TRADUCTION,
# MOTIF_OUVRIR) ; test/js/raccourcis-portables.test.js compare les quatre littéraux.
$script:SzhLienMotif = '^szh://traduction/(revue|zeitschrift)/([A-Za-z0-9]{16})(?:/([a-z0-9][a-z0-9-]{0,63}))?/?$'
$script:SzhLienMotifOuvrir = '^szh://ouvrir/(revue|zeitschrift|livre)/([A-Za-z0-9]{16})/?$'

# Analyse un lien -> { vue, produit, id, article }, ou $null si la grammaire n'est pas
# respectée. Le protocole Windows peut ajouter un « / » final ou un caractère nul.
# « traduction » d'abord, puis « ouvrir », dont $Matches ne porte que trois groupes.
function Get-SzhLien([string]$Lien) {
  if (-not $Lien) { return $null }
  $net = ([string]$Lien).Trim().Trim([char]0)
  if ($net -match $SzhLienMotif) {
    $article = ''
    if ($Matches.Count -ge 4) { $article = [string]$Matches[3] }
    return [pscustomobject]@{
      vue     = 'traduction'
      produit = [string]$Matches[1]
      id      = [string]$Matches[2]
      article = $article
    }
  }
  if ($net -match $SzhLienMotifOuvrir) {
    return [pscustomobject]@{
      vue     = 'ouvrir'
      produit = [string]$Matches[1]
      id      = [string]$Matches[2]
      article = ''
    }
  }
  return $null
}

# Fabrique le lien « ouvrir » d'un numéro, '' si une valeur est invalide. Le lien est relu
# par Get-SzhLien : ce qui sort d'ici est donc un lien que le lanceur acceptera.
function New-SzhLienOuvrir([string]$Produit, [string]$Id) {
  $p = ([string]$Produit).Trim().ToLower()
  $lien = 'szh://ouvrir/' + $p + '/' + ([string]$Id).Trim()
  if (-not (Get-SzhLien $lien)) { return '' }
  return $lien
}

# Le produit d'un dossier, lu sur le disque : buch.yaml d'abord, ausgabe.yaml ensuite, comme
# archive-revue.ps1, lib/profil.js et le Makefile. '' si ce n'est ni une revue ni un livre.
# Sert à Set-SzhRaccourciRevue, dont les appelants ne connaissent pas toujours le produit.
function Get-SzhJetonDossier([string]$Dossier) {
  if (-not $Dossier) { return '' }
  if (Test-Path (Join-Path $Dossier 'buch.yaml')) { return 'livre' }
  if (-not (Test-Path (Join-Path $Dossier 'ausgabe.yaml'))) { return '' }
  # La clé « revue: » décide entre revue et Zeitschrift ; absente ou illisible : la revue,
  # comme dans Get-SzhProduitInfo.
  $jeton = ''
  try { $jeton = (Get-SzhRevueEtat $Dossier).jeton } catch { $jeton = '' }
  if ($jeton) { return $jeton }
  return 'revue'
}

# Le verbe « traduction » : les numéros en cours puis les archives, dans la racine active du
# poste seulement, passés à Find-SzhProduitOuvrir. '' si introuvable.
function Find-SzhRevue([string]$Produit, [string]$Id) {
  $p = ([string]$Produit).Trim().ToLower()
  $racines = New-Object System.Collections.ArrayList
  foreach ($etat in @('encours', 'archive')) {
    $racine = Get-SzhEmplacementRevue $p $etat
    if ($racine) { [void]$racines.Add($racine) }
  }
  return (Find-SzhProduitOuvrir $p $Id @($racines))
}

# ---- Où le verbe « ouvrir » cherche son numéro ----
# Deux racines, dans cet ordre : la racine active du poste, puis celle de production.
#
# La production est toujours parcourue : le raccourci d'un vrai numéro fonctionne quel que
# soit le mode du poste. La racine active passe en premier, car new-revue.ps1 et
# new-livre.ps1 posent aussi ce raccourci sur un numéro créé dans la racine d'essai. En
# production, les deux racines sont la même et la liste est dédoublonnée.
function Get-SzhRacinesOuverture([string]$Produit) {
  $racines = New-Object System.Collections.ArrayList
  $p = ([string]$Produit).Trim().ToLower()
  if (-not $SzhSousDossiers.ContainsKey($p)) { return $racines }
  $emplacements = New-Object System.Collections.ArrayList
  $actif = ''
  try { $actif = Get-SzhEmplacementRevues } catch { $actif = '' }
  if ($actif) { [void]$emplacements.Add($actif) }
  if (-not $emplacements.Contains($SzhEmplacementProd)) { [void]$emplacements.Add($SzhEmplacementProd) }
  foreach ($emplacement in $emplacements) {
    $base = ''
    try { $base = Get-SzhBaseRevuesPour $emplacement } catch { $base = '' }
    if (-not $base) { continue }
    foreach ($etat in @('encours', 'archive')) {
      $racine = Join-Path $base $SzhSousDossiers[$p][$etat]
      if (-not $racines.Contains($racine)) { [void]$racines.Add($racine) }
    }
  }
  return $racines
}

# Le dossier visé par un lien « ouvrir », '' si introuvable (l'appelant affiche alors un
# message). Le manifeste dépend du produit (buch.yaml pour le livre, ausgabe.yaml sinon) ;
# l'`id:` de chaque dossier candidat est comparé à celui du lien. $Racines, s'il est donné,
# remplace les racines par défaut (Get-SzhRacinesOuverture).
function Find-SzhProduitOuvrir([string]$Produit, [string]$Id, [string[]]$Racines = $null) {
  $p = ([string]$Produit).Trim().ToLower()
  if (-not $SzhProduits.ContainsKey($p)) { return '' }
  if (-not (Test-SzhIdValide $Id)) { return '' }
  $manifeste = [string]$SzhProduits[$p].manifeste
  if ($null -eq $Racines) { $Racines = @(Get-SzhRacinesOuverture $p) }
  foreach ($racine in $Racines) {
    if (-not (Test-Path -LiteralPath $racine)) { continue }
    $dossiers = @()
    try { $dossiers = @(Get-ChildItem -LiteralPath $racine -Directory -ErrorAction SilentlyContinue) } catch { }
    foreach ($d in $dossiers) {
      $fichier = Join-Path $d.FullName $manifeste
      if (-not (Test-Path -LiteralPath $fichier)) { continue }
      $valeurs = Get-SzhAusgabe $fichier
      if ($valeurs.ContainsKey('id') -and ($valeurs['id'] -eq $Id)) { return $d.FullName }
    }
  }
  return ''
}

# ---- Intention d'ouverture, à usage unique ----
# Le lanceur ne peut pas dire à VSCodium quel panneau ouvrir : il dépose une intention que
# le cockpit lit, vérifie, consomme et supprime. Chemin, clés et unité alignés avec
# lib/liens.js : `pose` en millisecondes Unix, péremption 5 min. Le fichier est hors du
# dossier de revue, qui ne contient rien de technique.
$script:SzhIntentionFile = Join-Path $env:LOCALAPPDATA 'SZH\intention.json'

function Set-SzhIntention([string]$Revue, [string]$Vue, [string]$Article) {
  $dossier = Split-Path $SzhIntentionFile -Parent
  New-Item -ItemType Directory -Force -Path $dossier | Out-Null
  $intention = [ordered]@{
    revue   = $Revue
    vue     = $Vue
    article = $Article
    pose    = [long]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  }
  Set-SzhJson $SzhIntentionFile $intention
}

# ---- Lien "szh://..." recu : on ouvre, on ne liste pas ----
# Deux verbes arrivent ici (Get-SzhLien) :
#   * "traduction" vient d'un courriel, par le gestionnaire de protocole. Revue et
#     Zeitschrift seulement ; une intention est deposee pour que le cockpit ouvre le suivi
#     de traduction.
#   * "ouvrir" vient du raccourci pose a la racine du numero ou du livre
#     (Set-SzhRaccourciRevue). Pas d'intention : le dossier s'ouvre, sans panneau vise.
# Appelee par open-revue.ps1 apres les taches de demarrage (Invoke-SzhTachesDemarrage).
#
# N'ouvre pas la fenetre du lanceur et ne change pas la langue du poste : un lien recu par
# courriel n'est pas un reglage. Rend le code de sortie ; sous $env:SZH_LANCEUR_SIMULE=1,
# ecrit son verdict en JSON au lieu d'ouvrir ou d'afficher quoi que ce soit.
function Open-SzhLien([string]$Lien) {
  $simule = ($env:SZH_LANCEUR_SIMULE -eq '1')
  $cible = Get-SzhLien $Lien
  if (-not $cible) {
    if ($simule) {
      Write-SzhPlanJson ([pscustomobject]@{ lien = $Lien; erreur = 'invalide' })
      return 1
    }
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show((T 'lien.invalide' @($Lien)), $SzhNomApplication)
    return 1
  }
  # "traduction" : la racine active du poste, en cours puis archives. "ouvrir" : la racine
  # active puis celle de production, livre compris.
  $dossierLien = ''
  if ($cible.vue -eq 'ouvrir') { $dossierLien = Find-SzhProduitOuvrir $cible.produit $cible.id }
  else { $dossierLien = Find-SzhRevue $cible.produit $cible.id }
  if (-not $dossierLien) {
    if ($simule) {
      Write-SzhPlanJson ([pscustomobject]@{ lien = $Lien; vue = $cible.vue; erreur = 'introuvable' })
      return 1
    }
    # Un message dit pourquoi le raccourci n'ouvre rien. Le livre a sa variante du message
    # ("le numero" ne le concerne pas).
    $cleIntrouvable = 'lien.introuvable'
    if ($cible.produit -eq 'livre') { $cleIntrouvable = 'lien.introuvable.livre' }
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
      (T $cleIntrouvable @($cible.id, $cible.produit)), $SzhNomApplication)
    return 1
  }
  # Intention a usage unique, sans blocage : sans elle, la revue s'ouvre sans aller au
  # panneau. Rien a deposer pour "ouvrir".
  if ($cible.vue -ne 'ouvrir') {
    try { Set-SzhIntention $dossierLien $cible.vue $cible.article } catch { }
  }
  if ($simule) {
    Write-SzhPlanJson ([pscustomobject]@{ lien = $Lien; vue = $cible.vue; dossier = $dossierLien })
    return 0
  }
  [void](Start-SzhCodium $dossierLien)
  return 0
}

# ---- Table de produit : ce qui distingue les trois produits. Une ligne par produit, clé = jeton :
#   jeton             : celui d'ausgabe.yaml/buch.yaml (Get-SzhJetonRevue) et des emplacements
#                       (Get-SzhEmplacementRevue).
#   onglet            : le nom du produit, le même dans les deux langues (« Revue », « Zeitschrift »,
#                       « Book »).
#   manifeste         : ausgabe.yaml ou buch.yaml -- le fichier qui marque un dossier de ce
#                       produit.
#   icone             : le nom du fichier .ico, sous windows\.
#   nomRaccourci / descRaccourci : les clés de texte du nom du fichier .lnk posé à la racine du
#                       dossier et de sa description. Le nom est le même dans toutes les
#                       langues (le dossier est partagé sur OneDrive entre postes de langues
#                       différentes, et un nom traduit laisserait des raccourcis en double) ;
#                       la description se traduit. Zeitschrift reprend le raccourci de la revue.
$script:SzhProduits = @{
  revue = @{
    jeton             = 'revue'
    onglet            = 'Revue'
    manifeste         = 'ausgabe.yaml'
    icone             = 'szh-revue.ico'
    nomRaccourci      = 'raccourci.nom.revue'
    descRaccourci     = 'raccourci.desc.revue'
  }
  zeitschrift = @{
    jeton             = 'zeitschrift'
    onglet            = 'Zeitschrift'
    manifeste         = 'ausgabe.yaml'
    icone             = 'szh-zeitschrift.ico'
    nomRaccourci      = 'raccourci.nom.revue'
    descRaccourci     = 'raccourci.desc.revue'
  }
  livre = @{
    jeton             = 'livre'
    onglet            = 'Book'
    manifeste         = 'buch.yaml'
    icone             = 'szh-livre.ico'
    nomRaccourci      = 'raccourci.nom.livre'
    descRaccourci     = 'raccourci.desc.livre'
  }
}

# Rend la ligne de la table pour ce jeton, ou celle de la revue si le jeton est inconnu : un
# script sans console ne doit pas lever sur une valeur inattendue.
function Get-SzhProduitInfo([string]$Jeton) {
  $cle = ([string]$Jeton).ToLower()
  if ($SzhProduits.ContainsKey($cle)) { return $SzhProduits[$cle] }
  return $SzhProduits['revue']
}
