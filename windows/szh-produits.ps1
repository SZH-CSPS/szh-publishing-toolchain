# Emplacements des revues et des livres (test ou production), lecteur YAML plat, identité
# d'un numéro ou d'un livre, écriture de leurs clés, liens szh:// et intention d'ouverture.
# Compatibilité : Windows PowerShell 5.1 (proscrire ?. ?? ?: && ||).

# ---- Emplacement des revues (et des livres) : test ou production ----
# Seul endroit qui décide où vivent les revues : le cockpit ne calcule aucun chemin
# SharePoint, il délègue l'archivage à archive-revue.ps1. Sous-dossiers identiques en test
# et en production, seule la base change, si bien qu'un essai exerce le code réel.
#
# ⚠ Hypothèse à confirmer avec la rédaction, pour la ligne `livre` seulement — les deux
#   autres sont vérifiées sur SharePoint. On sait que la convention « BU » existe et que le
#   dossier d'archives livré s'appelle littéralement « BU01_Auflagen finale » (espace
#   compris, pas de tiret bas avant « finale ») ; on ne sait pas sous quel numéro de dossier
#   produit il vit (« 52_Revue », « 53_Zeitschrift » suggèrent « 54_Buch », posé ici par
#   déduction, jamais vérifié), ni comment s'appelle le dossier de rédaction (« RV02 »/« ZS02 »
#   suggèrent « BU02_Redaktion », posé de même). Configurable par `config.json`
#   (« sousDossiersLivre ») → Get-SzhSousDossierLivre ci-dessous, précisément parce que
#   cette ligne-ci n'est qu'un défaut plausible et non une valeur relevée.
$script:SzhSousDossiers = @{
  revue       = @{ encours = '52_Revue\RV02_Redaction';        archive = '52_Revue\RV99_Archives' }
  zeitschrift = @{ encours = '53_Zeitschrift\ZS02_Redaktion';  archive = '53_Zeitschrift\ZS99_Archives' }
  livre       = @{ encours = '54_Buch\BU02_Redaktion';         archive = '54_Buch\BU01_Auflagen finale' }
}
# Bases par défaut, surchargeables par config.json (« basesRevues ») : seule chaîne à
# corriger si la bibliothèque SharePoint est synchronisée ailleurs. Les livres partagent la
# même base que les revues — c'est la même bibliothèque SharePoint, « 2_Produkte » — seul le
# sous-dossier change, ci-dessus.
$script:SzhBasesDefaut = @{
  prod = '%USERPROFILE%\SZH CSPS\Daten_Allgemein - General\2_Produkte'
  dev  = '%USERPROFILE%\OneDrive - SZH CSPS\Revues-TESTING'
}

# Sous-dossier de livre effectif : le défaut ci-dessus, ou la valeur de `config.json` quand
# la rédaction l'a corrigée. Seule la ligne « livre » de $SzhSousDossiers a besoin de ce
# détour — revue et zeitschrift sont des valeurs relevées, pas des hypothèses.
#   "sousDossiersLivre": { "encours": "...", "archive": "..." }
function Get-SzhSousDossierLivre([string]$Etat) {
  $defaut = $SzhSousDossiers.livre.$Etat
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.PSObject.Properties['sousDossiersLivre']) {
    $table = $cfg.sousDossiersLivre
    if ($table -and $table.PSObject.Properties[$Etat] -and [string]$table.$Etat) {
      return [string]$table.$Etat
    }
  }
  return $defaut
}

# Les deux valeurs de `emplacementRevues` dans config.json. Cette clé remplace `devMode` :
# elle dit son effet — l'endroit où sont les revues — là où « mode développeur » ne parlait
# que du développeur. L'ancienne clé reste lue, des postes la portent déjà.
$script:SzhEmplacementTest = 'test'
$script:SzhEmplacementProd = 'production'

# Booléen d'un JSON écrit à la main : $true/$false, "true"/"false", 1/0. Tout le reste rend
# $null, soit « clé absente ». Sans cette normalisation, `"devMode": "false"` vaut vrai ici
# ([bool]'false' est $true) et faux côté JavaScript : les deux moitiés liraient deux
# racines différentes pour la même configuration.
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

# Résolution pure : la clé neuve, puis l'ancienne, puis le défaut historique « test ». Rien
# n'est lu du disque ici — c'est Initialize-SzhEmplacementRevues qui interroge le disque, une
# fois, pour écrire la valeur en clair. Mêmes règles et même ordre que
# resoudreEmplacementRevues() de lib/archivage.js ; test/js/emplacements.test.js compare les
# deux sur les mêmes configurations.
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

# Base d'un emplacement donné. Les sous-clés de `basesRevues` gardent leurs noms d'avant
# (`dev`, `prod`) : des postes les portent déjà.
function Get-SzhBaseRevuesPour([string]$Emplacement) {
  $cle = 'prod'
  if ($Emplacement -eq $SzhEmplacementTest) { $cle = 'dev' }
  $base = $SzhBasesDefaut[$cle]
  $cfg = Get-SzhConfig
  if ($cfg -and $cfg.basesRevues -and $cfg.basesRevues.$cle) { $base = [string]$cfg.basesRevues.$cle }
  return [Environment]::ExpandEnvironmentVariables($base)
}

# Combien de numéros (et de livres) dorment sous un emplacement : un dossier portant un
# ausgabe.yaml ou un buch.yaml, dans les six dossiers des trois produits. Ne lève jamais —
# un OneDrive non synchronisé rend 0.
function Measure-SzhNumeros([string]$Emplacement) {
  $base = Get-SzhBaseRevuesPour $Emplacement
  $total = 0
  foreach ($produit in @('revue', 'zeitschrift', 'livre')) {
    $manifeste = 'ausgabe.yaml'
    if ($produit -eq 'livre') { $manifeste = 'buch.yaml' }
    foreach ($etat in @('encours', 'archive')) {
      # Le livre lit son sous-dossier via Get-SzhSousDossierLivre : il suit la même
      # correction éventuelle de config.json que Get-SzhEmplacements, pas le défaut figé de
      # $SzhSousDossiers.
      $sousDossier = $SzhSousDossiers[$produit][$etat]
      if ($produit -eq 'livre') { $sousDossier = Get-SzhSousDossierLivre $etat }
      $racine = Join-Path $base $sousDossier
      if (-not (Test-Path $racine)) { continue }
      try {
        $total += @(Get-ChildItem -Path $racine -Directory -ErrorAction SilentlyContinue |
          Where-Object { Test-Path (Join-Path $_.FullName $manifeste) }).Count
      } catch { }
    }
  }
  return $total
}

# Écrit l'emplacement en clair dans config.json quand il n'y est pas : la racine de tout le
# travail ne doit pas dépendre d'un défaut implicite, qu'une mise à jour pourrait renverser
# sous les pieds du rédacteur.
#
#   * `emplacementRevues` déjà là et valide -> rien ;
#   * `devMode` seul -> recopié sous le nom neuf, décision inchangée ;
#   * ni l'un ni l'autre -> le disque tranche, et jamais contre ce qui existe :
#     « production » seulement si la racine de production porte des numéros et celle de test
#     aucun. Dans tous les autres cas « test », c'est-à-dire ce que le poste voyait déjà.
#     Une racine de test vide n'a rien à perdre ; si OneDrive n'avait rien synchronisé
#     encore, le compte des deux racines part au journal, et une ligne de config.json
#     suffit à revenir (docs/EMPLACEMENTS.md).
#
# N'écrit rien si config.json n'existe pas : bootstrap.ps1 le crée lui-même, et un fichier
# posé ici l'empêcherait d'y mettre `repo` et `basesRevues`. Au plus une fois par processus.
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

# Emplacement actif : passage obligé de tout le monde, et il fige la valeur au premier appel,
# pour que le titre du lanceur et les listes qu'il affiche viennent du même choix.
function Get-SzhEmplacementRevues {
  [void](Initialize-SzhEmplacementRevues)
  return (Resolve-SzhEmplacementRevues (Get-SzhConfig))
}

# Étiquette courte de la racine active, pour le jeton {racine} des textes : le titre du
# lanceur dit alors où sont les revues, sans qu'on ouvre config.json. Mémorisée par langue —
# T est appelé souvent, et Set-SzhLangueProduit peut changer de langue après un premier
# appel : une mémoire d'une seule case figerait le titre en anglais.
$script:SzhEtiquetteMemo = @{}
function Get-SzhEtiquetteRacine {
  if ($SzhEtiquetteMemo.ContainsKey($SzhLangue)) { return $SzhEtiquetteMemo[$SzhLangue] }
  $emplacement = Get-SzhEmplacementRevues
  $mot = (T 'racine.prod')
  if ($emplacement -eq $SzhEmplacementTest) { $mot = (T 'racine.test') }
  $feuille = ''
  try { $feuille = Split-Path (Get-SzhBaseRevuesPour $emplacement) -Leaf } catch { }
  $etiquette = $mot
  if ($feuille) { $etiquette = ('{0} ({1})' -f $mot, $feuille) }
  $SzhEtiquetteMemo[$SzhLangue] = $etiquette
  return $etiquette
}

# Les quatre emplacements de revue du poste, plus les deux de livre ; les listes à plat
# (`encours`/`archives`) ne portent que les deux produits de revue — le reste est balayé par
# open-produit.ps1, comme avant le livre. Le livre vit à part, dans sa propre paire
# `livre.encours`/`livre.archive`, lue par le même open-produit.ps1 (Get-SzhEmplacementRevue
# 'livre' …). La racine active part au journal une fois par processus : après coup, il dit
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
    encours = (Join-Path $base (Get-SzhSousDossierLivre 'encours'))
    archive = (Join-Path $base (Get-SzhSousDossierLivre 'archive'))
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

# En mode test seulement, crée les dossiers manquants — les quatre de revue, plus les deux
# de livre. En production, jamais : l'arborescence est celle de SharePoint, un poste n'a pas
# à l'inventer.
function Initialize-SzhEmplacementsTest {
  $emp = Get-SzhEmplacements
  if (-not $emp.devMode) { return $false }
  foreach ($d in ($emp.encours + $emp.archives + @($emp.livre.encours, $emp.livre.archive))) {
    if (-not (Test-Path $d)) {
      try { New-Item -ItemType Directory -Force -Path $d | Out-Null } catch { }
    }
  }
  return $true
}

# $Jeton = 'revue' | 'zeitschrift' | 'livre', $Etat = 'encours' | 'archive' ; '' si jeton
# inconnu. Le livre n'a pas de « numéro » (volume + numéro) : il partage néanmoins ce point
# d'entrée, open-livre.ps1 s'en servant exactement comme open-revue.ps1 s'en sert déjà.
function Get-SzhEmplacementRevue([string]$Jeton, [string]$Etat) {
  $emp = Get-SzhEmplacements
  if ($Jeton -eq 'zeitschrift') { return [string]$emp.zeitschrift.$Etat }
  if ($Jeton -eq 'livre') { return [string]$emp.livre.$Etat }
  if ($Jeton -eq 'revue') { return [string]$emp.revue.$Etat }
  return ''
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

# État complet d'un dossier de livre, sur le modèle de Get-SzhRevueEtat ci-dessus, pour le
# lanceur « Books SZH-CSPS ». Réutilise Get-SzhAusgabe (l'analyseur YAML plat), qui ne sait
# rien du nom du fichier qu'on lui donne — buch.yaml n'est ici qu'un chemin de plus.
#
# ⚠ La langue du texte se lit dans `lang:` : c'est la clé que lit réellement la chaîne
#   (pipeline/livre-assembler.py, `meta.get('lang')`) et celle des deux livres du banc
#   (test/livre-normal, test/livre-falc). `langue:` — l'orthographe de l'exemple de
#   docs/ARCHITECTURE-LIVRES.md — reste tolérée pour un buch.yaml qui l'aurait suivi à la
#   lettre, mais `lang:` l'emporte si les deux sont présentes.
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
# Le volume est le millésime de la revue : un par année civile. Il s'imprime sur la
# couverture (szh-maquette.lua) et part dans OJS en <volume> ; se tromper l'étiquetterait
# faux partout, sans qu'un message le dise. Il n'a donc pas à être saisi : l'année le donne,
# chaque revue ayant sa propre année de départ.
#
# Relevé sur ojs.szh.ch le 24.08.2026, neuf millésimes de suite pour chacune, sans trou :
#   Revue        2018 -> Vol. 8  … 2026 -> Vol. 16    soit annee - 2010
#   Zeitschrift  2018 -> Bd. 24  … 2026 -> Bd. 32     soit annee - 1994
# Un volume par année, sans exception sur ces neuf-là. Ne pas déduire autre chose du compte
# de numéros visible dans l'archive : une année en cours en montre moins que les autres, et
# la numérotation elle-même a changé de forme au fil du temps — ni l'un ni l'autre ne dit
# quoi que ce soit du volume. Une revue pourrait néanmoins sauter un volume ou en doubler
# un : le formulaire garde un réglage manuel, et c'est lui qui tranche le jour où le compte
# se décale.
$script:SzhVolumeAnneeZero = @{
  revue       = 2010
  zeitschrift = 1994
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

# Première année dont le volume existe : la borne basse du formulaire, pour qu'il ne propose
# jamais un volume nul ou négatif.
function Get-SzhPremiereAnnee([string]$Produit) {
  $jeton = Get-SzhJetonRevue $Produit
  if ($jeton -and $SzhVolumeAnneeZero.ContainsKey($jeton)) { return ($SzhVolumeAnneeZero[$jeton] + 1) }
  return 1
}

# Nom de dossier d'un numéro : la convention « AAAA-NN », numéro sur deux chiffres. Toute la
# chaîne s'y appuie — szh-maquette.lua y prend l'année quand `date:` est vide, lib/yaml.js le
# titre de la barre latérale — et c'est pourquoi ce nom se déduit et ne se saisit pas.
function Get-SzhNomNumero([int]$Annee, [int]$Numero) {
  return ('{0:0000}-{1:00}' -f $Annee, $Numero)
}

# Entier d'une valeur d'ausgabe.yaml, 0 si elle n'en est pas une : « 01 » et « 1 » sont le
# même numéro, et un champ vide ne doit ressembler à aucun.
function Get-SzhEntierYaml($Valeur) {
  $texte = ([string]$Valeur).Trim()
  if ($texte -notmatch '^[0-9]{1,6}$') { return 0 }
  return [int]$texte
}

# Un numéro se reconnaît à son couple volume + numéro, jamais à son nom de dossier : deux
# dossiers différents peuvent porter le même couple, et c'est précisément ce qu'il faut
# refuser. On cherche donc dans les deux emplacements du produit, en cours et archives — un
# numéro archivé reste un numéro publié, et son volume est pris.
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
      # Le produit vient du jeton du numéro, pas de son emplacement : un dossier rangé du
      # mauvais côté ne doit pas bloquer la création d'un numéro de l'autre revue.
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
# Un livre n'a pas de « numéro d'une année » : il a un titre, une année et une référence —
# les dossiers réels s'appellent « Buch_2019-B301-Thaler », « 2025-B328-SZH_ProspectrumFALC_DE ».
# La convention retenue pour les nouveaux livres, plus régulière : « <année>-B<référence>-<nom> »,
# le <nom> étant déduit du titre, jamais saisi séparément — même principe que
# Get-SzhNomNumero ci-dessus.
#
# Translittération vers ASCII (accents retirés, tout le reste réduit à des « _ ») : un nom
# de dossier lisible sans dépendre d'un jeu de caractères, sur le modèle de la
# translittération de l'import (iconv -t ASCII//TRANSLIT, pipeline/Makefile). Borné à 40
# caractères : le nom compte plusieurs fois dans un chemin de sortie (out/<nom>.pdf…), et un
# titre entier dépasserait vite la limite Windows de 260 caractères.
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

# Un livre se reconnaît à sa référence B, jamais à son nom de dossier — même principe que
# Find-SzhNumeroVolume ci-dessus, adapté : buch.yaml ne porte pas cette référence en clé (elle
# ne vit que dans le nom du dossier), donc c'est le nom qui est lu, avec le motif que produit
# Get-SzhNomLivre. On cherche dans les deux emplacements — en cours et archives — un livre
# archivé restant un livre publié.
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
# `$NomFichier` : « ausgabe.yaml » par défaut, pour que new-revue.ps1 n'ait rien à changer ;
# new-livre.ps1 passe « buch.yaml », même mécanique d'écriture, seul le nom change. ⚠ Le
# paramètre est nommé avec une majuscule pour ne pas être confondu avec la variable locale
# `$fichier` ci-dessous — PowerShell ignore la casse des noms de variables, et les deux
# auraient sinon désigné la même case mémoire.
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

# `version-toolkit` dit avec quelle version le numéro (ou le livre) a été fabriqué, de quoi
# le recomposer plus tard à l'identique. Posée à la création, jamais réécrite ensuite.
function Set-SzhAusgabeVersion([string]$Dossier, [string]$Version, [string]$NomFichier = 'ausgabe.yaml') {
  return (Set-SzhAusgabeCle $Dossier 'version-toolkit' $Version $true $false $NomFichier)
}

# ---- Liens profonds « szh:// » ----
# Grammaire szh://traduction/<produit>/<numero>[/<article>], à garder alignée avec
# lib/liens.js, qui fabrique les liens. Un lien vient d'un e-mail, donc d'une source non
# fiable : il ne porte aucun chemin, et le dossier est cherché dans les seuls emplacements
# connus du poste.
$script:SzhLienMotif = '^szh://traduction/(revue|zeitschrift)/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:/([a-z0-9][a-z0-9-]{0,63}))?/?$'

# Analyse un lien -> { vue, produit, numero, article }, ou $null si la grammaire n'est
# pas respectée. Le protocole Windows peut ajouter un « / » final ou un caractère nul.
function Get-SzhLien([string]$Lien) {
  if (-not $Lien) { return $null }
  $net = ([string]$Lien).Trim().Trim([char]0)
  if ($net -notmatch $SzhLienMotif) { return $null }
  $numero = [string]$Matches[2]
  if ($numero -like '*..*') { return $null }
  $article = ''
  if ($Matches.Count -ge 4) { $article = [string]$Matches[3] }
  return [pscustomobject]@{
    vue     = 'traduction'
    produit = [string]$Matches[1]
    numero  = $numero
    article = $article
  }
}

# « En cours » d'abord, puis les archives, et nulle part ailleurs : le nom vient du lien,
# la racine du poste, et le dossier doit porter un ausgabe.yaml. '' si introuvable.
function Find-SzhRevue([string]$Produit, [string]$Numero) {
  foreach ($etat in @('encours', 'archive')) {
    $racine = Get-SzhEmplacementRevue $Produit $etat
    if (-not $racine) { continue }
    $candidat = Join-Path $racine $Numero
    if (Test-Path (Join-Path $candidat 'ausgabe.yaml')) { return (Resolve-Path -LiteralPath $candidat).Path }
  }
  return ''
}

# ---- Intention d'ouverture, à usage unique ----
# Le lanceur ne peut pas dire à VSCodium quel panneau ouvrir : il dépose une intention que
# le cockpit lit, vérifie, consomme et supprime. Chemin, clés et unité à garder alignés
# avec lib/liens.js : `pose` en millisecondes Unix, péremption 5 min. Posée hors du
# dossier de revue, où rien de technique n'entre.
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

# ---- Table de produit : ce que les trois lanceurs (revue, zeitschrift, livre) partagent, et
# ce qui les distingue, pour qu'open-produit.ps1 n'ait plus à choisir par des `if` répétés ce
# qui varie d'un produit à l'autre. Une ligne par produit, clé = jeton :
#   jeton             : celui d'ausgabe.yaml/buch.yaml (Get-SzhJetonRevue) et des emplacements
#                       (Get-SzhEmplacementRevue).
#   manifeste         : ausgabe.yaml ou buch.yaml -- le fichier qui marque un dossier de ce
#                       produit.
#   etatFn            : le nom de la fonction qui lit ce fichier, appelée par `&` -- Get-SzhRevueEtat
#                       et Get-SzhLivreEtat gardent la même signature (un seul $Dossier), mais ne
#                       rendent pas les mêmes champs.
#   filtrerJeton      : vrai pour revue et zeitschrift seulement -- ausgabe.yaml porte une clé
#                       `revue:` qui peut contredire le dossier où il vit (un numéro rangé côté
#                       Zeitschrift mais déclarant « revue: revue »), et ce décalage doit se voir
#                       plutôt que se deviner. buch.yaml ne porte pas cette clé : un livre n'a
#                       qu'un seul jeton, rien à contredire.
#   racinesHeritees   : vrai pour revue et zeitschrift -- `revuesRoots` de config.json et
#                       OneDrive\Revues n'existaient qu'avant le livre, et ne signalent jamais
#                       rien pour lui.
#   appId             : la clé de $SzhAppIds (Get-SzhAppId), pour l'identité de barre des tâches.
#   icone             : le nom du fichier .ico, sous windows\.
#   etiquetteChamp    : 'nom' (le nom du dossier) pour revue et zeitschrift, 'titre' (celui de
#                       buch.yaml, replié sur le nom si vide) pour le livre.
#   texteTitre / texteChoisir / texteVide / texteTest / texteNouvelle / texteModifie /
#   texteVideArchives : les clés de $SzhTextes propres à ce produit (szh-textes.ps1).
#   nouveauFormulaire : le nom de la fonction qui pose le formulaire « Nouveau… » -- deux
#                       fonctions distinctes (Read-SzhNouveauNumero, Read-SzhNouveauLivre), qui
#                       ne demandent pas les mêmes champs.
$script:SzhProduits = @{
  revue = @{
    jeton             = 'revue'
    manifeste         = 'ausgabe.yaml'
    etatFn            = 'Get-SzhRevueEtat'
    filtrerJeton      = $true
    racinesHeritees   = $true
    appId             = 'revue'
    icone             = 'szh-revue.ico'
    etiquetteChamp    = 'nom'
    texteTitre        = 'lanceur.titre'
    texteChoisir      = 'lanceur.choisir'
    texteVide         = 'lanceur.vide'
    texteTest         = 'lanceur.test'
    texteNouvelle     = 'lanceur.nouvelle'
    texteModifie      = 'lanceur.modifie'
    texteVideArchives = 'lanceur.vide.archives'
    nouveauFormulaire = 'Read-SzhNouveauNumero'
  }
  zeitschrift = @{
    jeton             = 'zeitschrift'
    manifeste         = 'ausgabe.yaml'
    etatFn            = 'Get-SzhRevueEtat'
    filtrerJeton      = $true
    racinesHeritees   = $true
    appId             = 'zeitschrift'
    icone             = 'szh-zeitschrift.ico'
    etiquetteChamp    = 'nom'
    texteTitre        = 'lanceur.titre.zs'
    texteChoisir      = 'lanceur.choisir.zs'
    texteVide         = 'lanceur.vide.zs'
    texteTest         = 'lanceur.test.zs'
    texteNouvelle     = 'lanceur.nouvelle'
    texteModifie      = 'lanceur.modifie'
    texteVideArchives = 'lanceur.vide.archives'
    nouveauFormulaire = 'Read-SzhNouveauNumero'
  }
  livre = @{
    jeton             = 'livre'
    manifeste         = 'buch.yaml'
    etatFn            = 'Get-SzhLivreEtat'
    filtrerJeton      = $false
    racinesHeritees   = $false
    appId             = 'livre'
    icone             = 'szh-livre.ico'
    etiquetteChamp    = 'titre'
    texteTitre        = 'lanceur.titre.livre'
    texteChoisir      = 'lanceur.choisir.livre'
    texteVide         = 'lanceur.vide.livre'
    texteTest         = 'lanceur.test.livre'
    texteNouvelle     = 'lanceur.nouvelle.livre'
    texteModifie      = 'lanceur.modifie.livre'
    texteVideArchives = 'lanceur.vide.archives.livre'
    nouveauFormulaire = 'Read-SzhNouveauLivre'
  }
}

# Rend la ligne de la table pour ce jeton, ou celle de la revue si le jeton est inconnu :
# open-produit.ps1 tourne sans console, une valeur inattendue ne doit pas le faire lever.
function Get-SzhProduitInfo([string]$Jeton) {
  $cle = ([string]$Jeton).ToLower()
  if ($SzhProduits.ContainsKey($cle)) { return $SzhProduits[$cle] }
  return $SzhProduits['revue']
}
