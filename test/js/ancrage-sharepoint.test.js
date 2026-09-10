// L'ancrage SharePoint (windows/szh-ancrage.ps1) : le dossier « Daten_Allgemein - General »
// dont dérivent la base des produits et le futur dossier des rapports d'erreur automatiques,
// et son articulation avec Get-SzhBaseRevuesPour (windows/szh-produits.ps1).
//
//   node --test test/js/ancrage-sharepoint.test.js
//   node --test "test/js/*.test.js"                 (référence : voir plus bas)
//
// Le défaut réel que ce fichier garde, trouvé en cours de route (relecture adversariale,
// avant tout commit) : la première version de Resolve-SzhAncrage couvrait les CINQ niveaux
// de résolution, fenêtre de sélection de dossier comprise -- et Get-SzhBaseRevuesPour
// l'appelle. Or cet accesseur de chemin est appelé depuis archive-revue.ps1 et new-revue.ps1,
// qui tournent SANS CONSOLE (ils ont leur propre MessageBox d'erreur précisément pour ça) :
// un simple archivage aurait donc pu faire surgir un sélecteur de dossier en plein milieu.
// Corrigé en scindant le contrat en deux avant même d'écrire ce test :
//   * Resolve-SzhAncrage ne couvre plus que les niveaux 1 à 4 (essai, config, cache, auto) et
//     n'ouvre JAMAIS de fenêtre -- même sans SZH_LANCEUR_SIMULE=1, même quand rien n'est
//     trouvable. C'est elle que Get-SzhBaseRevuesPour appelle.
//   * Initialize-SzhAncrage porte seul le niveau 5 (anti-harcèlement puis demande), pour un
//     futur appel unique par le lanceur à son démarrage -- jamais depuis un accesseur.
//   * La résolution passive est mémoïsée en portée script (Clear-SzhAncrageMemo la vide) :
//     sans ça, Get-SzhEmplacements + Get-SzhEmplacementRevue balayaient le disque deux à
//     trois fois par ouverture de lanceur.
// Une deuxième chose que ce fichier garde explicitement, parce qu'elle se « corrige » avec la
// meilleure volonté du monde si on ne la voit pas venir : le dossier des rapports s'appelle
// RÉELLEMENT « _AutoReportToolboxZeitscrhiften » (faute de frappe SharePoint authentique, pas
// une coquille du dépôt) -- un correctif orthographique un jour futur casserait le chemin réel.
//
// Technique reprise telle quelle de test/js/courriel-support.test.js et
// test/js/orphelins-toolkit.test.js : les VRAIS .ps1 du dépôt sont dot-sourcés (jamais
// réécrits ni recopiés) dans des scripts pilotes générés à la volée, écrits AVEC BOM UTF-8
// (PowerShell 5.1 relit un .ps1 sans BOM avec la page de code ANSI du poste, pas en UTF-8),
// exécutés par spawnSync('powershell.exe', ...), sautés proprement si powershell.exe manque.
// Chaque groupe de scénarios tient dans UN SEUL processus PowerShell (comme le « bilan » de
// orphelins-toolkit.test.js) : un « pilote » construit toutes les arborescences jetables sous
// UNE racine fs.mkdtempSync (jamais un chemin fixe), enchaîne les scénarios, et sérialise tout
// en un seul JSON relu ici.
//
// Aucun test ne touche le vrai C:\ProgramData\SZH, le vrai %LOCALAPPDATA%\SZH ni le vrai
// SharePoint du poste : SZH_BASE, LOCALAPPDATA, USERPROFILE, OneDrive, OneDriveCommercial et
// SZH_ANCRAGE sont systématiquement redirigés vers des dossiers jetables AVANT tout
// dot-source, et SZH_LANCEUR_SIMULE=1 est posé partout où une fenêtre serait sinon légitime
// (Request-SzhAncrageUtilisateur) -- sauf dans le scénario qui prouve justement que
// Resolve-SzhAncrage n'en ouvre aucune, y compris SANS cette variable.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const ANCRAGE_PS1 = path.join(RACINE, 'windows', 'szh-ancrage.ps1');
const PRODUITS_PS1 = path.join(RACINE, 'windows', 'szh-produits.ps1');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');

const ANCRAGE_SOURCE = fs.readFileSync(ANCRAGE_PS1, 'utf8');
const PRODUITS_SOURCE = fs.readFileSync(PRODUITS_PS1, 'utf8');

// ---- PowerShell, comme dans les autres fichiers du dépôt ----

const POWERSHELL = (function () {
  if (process.platform !== 'win32') { return ''; }
  const candidats = [path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe'];
  for (const c of candidats) {
    const essai = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) { return c; }
  }
  return '';
})();
const sansPowerShell = POWERSHELL ? false : 'powershell.exe indisponible';

// Sans BOM sous PowerShell 5.1, un .ps1 SANS ce préfixe se relit avec la page de code ANSI
// du poste (mêmes précautions que les autres fichiers de ce dépôt).
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\ufeff' + contenu, 'utf8');
}

// Le corps d'une fonction PowerShell : de sa ligne de déclaration jusqu'à la première ligne
// qui n'est QUE « } », en colonne 0 -- identique en principe à corpsFonction des autres
// fichiers de test, mais tolérant aux deux fins de ligne : szh-ancrage.ps1 est écrit en LF
// pur (sans BOM, ASCII strict -- un choix délibéré du texte d'origine), quand le reste du
// dépôt (szh-produits.ps1, szh-common.ps1...) est en CRLF avec BOM.
function corpsFonction(source, nom) {
  const lignes = source.replace(/\r\n/g, '\n').split('\n');
  let debut = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].indexOf('function ' + nom) === 0) { debut = i; break; }
  }
  assert.ok(debut !== -1, 'fonction introuvable : ' + nom);
  let fin = -1;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (lignes[i] === '}') { fin = i; break; }
  }
  assert.ok(fin !== -1, 'fin de fonction introuvable : ' + nom);
  return lignes.slice(debut, fin + 1).join('\n');
}

function executerPilote(prefixe, dossierTravail, contenuPs1, args) {
  const pilote = path.join(dossierTravail, 'pilote.ps1');
  const sortie = path.join(dossierTravail, 'sortie.json');
  ecrirePs1(pilote, contenuPs1);
  const run = spawnSync(POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote].concat(args || []).concat([sortie]),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  return {
    status: run.status, stderr: run.stderr || '', stdout: run.stdout || '',
    lu: fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null
  };
}

// =====================================================================================
// ---- Contrôles statiques (aucun PowerShell requis) : source réelle des .ps1 -----------
// =====================================================================================

test('la faute de frappe réelle du dossier des rapports est présente au caractère près, jamais « corrigée »', () => {
  assert.ok(ANCRAGE_SOURCE.indexOf('_AutoReportToolboxZeitscrhiften') !== -1,
    'szh-ancrage.ps1 ne porte plus le nom réel du dossier SharePoint (faute de frappe comprise)');
  // Et surtout PAS la version orthographiquement correcte, qui trahirait une « correction ».
  assert.ok(ANCRAGE_SOURCE.indexOf('_AutoReportToolboxZeitschriften') === -1,
    'le nom du dossier a été "corrigé" -- il doit rester la faute de frappe réelle du SharePoint');
});

test('Find-SzhAncrageParDescente : les plafonds par défaut sont bien 3 niveaux et 2000 dossiers', () => {
  const corps = corpsFonction(ANCRAGE_SOURCE, 'Find-SzhAncrageParDescente');
  assert.match(corps, /\[int\]\$ProfondeurMax\s*=\s*3\b/, 'la profondeur par défaut n’est plus 3');
  assert.match(corps, /\[int\]\$MaxDossiers\s*=\s*2000\b/, 'le budget par défaut n’est plus 2000');
});

test('Resolve-SzhAncrage : aucune fenêtre n’est atteignable depuis son propre corps (contrôle statique)', () => {
  // Contrôle direct sur le texte : Resolve-SzhAncrage ne doit mentionner ni la fonction qui
  // ouvre la fenêtre, ni la classe .NET du sélecteur, ni le garde-fou anti-harcèlement (ce
  // dernier appartient désormais à Initialize-SzhAncrage seule -- une résolution PASSIVE n'a
  // rien à faire de « depuis combien de temps a-t-on demandé »).
  const corps = corpsFonction(ANCRAGE_SOURCE, 'Resolve-SzhAncrage');
  assert.ok(corps.indexOf('Request-SzhAncrageUtilisateur') === -1,
    'Resolve-SzhAncrage appelle encore Request-SzhAncrageUtilisateur -- elle n’est plus censée pouvoir demander');
  assert.ok(corps.indexOf('FolderBrowserDialog') === -1,
    'Resolve-SzhAncrage mentionne encore la fenêtre de sélection');
  assert.ok(corps.indexOf('Test-SzhDemandeRecente') === -1,
    'Resolve-SzhAncrage regarde encore le marqueur anti-harcèlement -- ce n’est plus son rôle');
  assert.ok(corps.indexOf('SZH_LANCEUR_SIMULE') === -1,
    'Resolve-SzhAncrage connaît encore le mode simulation -- une fonction purement passive n’en a pas besoin');
});

test('Initialize-SzhAncrage existe, porte bien le niveau 5, et vide la mémoïsation après un succès', () => {
  assert.ok(ANCRAGE_SOURCE.indexOf('function Initialize-SzhAncrage') !== -1,
    'Initialize-SzhAncrage a disparu -- le niveau 5 (demande) doit vivre quelque part');
  const corps = corpsFonction(ANCRAGE_SOURCE, 'Initialize-SzhAncrage');
  assert.ok(corps.indexOf('Request-SzhAncrageUtilisateur') !== -1,
    'Initialize-SzhAncrage n’appelle plus Request-SzhAncrageUtilisateur');
  assert.ok(corps.indexOf('Resolve-SzhAncrage') !== -1,
    'Initialize-SzhAncrage ne réutilise plus la résolution passive');
  assert.ok(corps.indexOf('Clear-SzhAncrageMemo') !== -1,
    'Initialize-SzhAncrage n’efface plus la mémoïsation après avoir écrit un nouvel ancrage');
});

test('Get-SzhBaseRevuesPour appelle la résolution PASSIVE (Resolve-SzhAncrage), jamais Initialize-SzhAncrage', () => {
  // C'est la garantie de fond : un accesseur de chemin, appelé par des scripts sans console
  // (archive-revue.ps1, new-revue.ps1), ne doit jamais pouvoir remonter jusqu'à une fenêtre.
  const corps = corpsFonction(PRODUITS_SOURCE, 'Get-SzhBaseRevuesPour');
  assert.ok(corps.indexOf('Resolve-SzhAncrage') !== -1,
    'Get-SzhBaseRevuesPour ne consulte plus l’ancrage du tout');
  assert.ok(corps.indexOf('Initialize-SzhAncrage') === -1,
    'Get-SzhBaseRevuesPour appelle Initialize-SzhAncrage -- un accesseur de chemin pourrait alors ouvrir une fenêtre');
});

// =====================================================================================
// ---- Groupe 1 : décisions et accès disque, szh-ancrage.ps1 seul (aucune dépendance à
//      szh-common.ps1 pour les 13 fonctions ci-dessous -- exactement le découpage que le
//      fichier revendique lui-même dans son en-tête : « la décision séparée de l'accès
//      disque, pour que les tests puissent l'éprouver sans construire une seule
//      arborescence, et l'accès disque avec de vraies arborescences jetables »). ---------
// =====================================================================================

function piloteGroupe1() {
  const L = [];
  const p = (s) => L.push(s);
  p('$ErrorActionPreference = \'Stop\'');
  p('$Travail = $args[0]');
  p('$Sortie = $args[1]');
  // Neutralise tout de suite les trois variables d'environnement dont dépend la détection
  // automatique (Get-SzhRacinesCandidates) : sur CE poste, %USERPROFILE%\SZH CSPS et
  // %OneDrive% pointent vers le VRAI SharePoint -- interdit de toucher.
  p('$env:USERPROFILE = Join-Path $Travail \'profil-neutre\'');
  p('New-Item -ItemType Directory -Force -Path $env:USERPROFILE | Out-Null');
  p('Remove-Item Env:OneDriveCommercial -ErrorAction SilentlyContinue');
  p('Remove-Item Env:OneDrive -ErrorAction SilentlyContinue');
  p('. ' + psChaine(ANCRAGE_PS1));
  p('');
  p('function ND([string]$p) { New-Item -ItemType Directory -Force -Path $p | Out-Null; return $p }');
  p('function NF([string]$p) { New-Item -ItemType Directory -Force -Path (Split-Path $p -Parent) | Out-Null; Set-Content -Path $p -Value \'x\' -Encoding ASCII; return $p }');
  p('$resultats = [ordered]@{}');
  p('');

  // ---- section 2.4 : dix cas ----
  p('$dix = [ordered]@{}');
  p('');
  p('# cas 1 : l\'ancrage lui-même');
  p('$ancre1 = ND (Join-Path $Travail \'cas1\\SZH CSPS\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre1 \'2_Produkte\') | Out-Null');
  p('$dix[\'ancrage_lui_meme\'] = [ordered]@{ attendu = $ancre1; obtenu = (Resolve-SzhAncrageDepuisChemin $ancre1) }');
  p('');
  p('# cas 2 : dossier enfant profond');
  p('$ancre2 = ND (Join-Path $Travail \'cas2\\SZH CSPS\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre2 \'2_Produkte\') | Out-Null');
  p('$enfant2 = ND (Join-Path $ancre2 \'2_Produkte\\52_Revue\\RV02_Redaction\')');
  p('$dix[\'dossier_enfant_profond\'] = [ordered]@{ attendu = $ancre2; obtenu = (Resolve-SzhAncrageDepuisChemin $enfant2) }');
  p('');
  p('# cas 3 : le dossier de rapports lui-même');
  p('$ancre3 = ND (Join-Path $Travail \'cas3\\SZH CSPS\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre3 \'2_Produkte\') | Out-Null');
  p('$rapports3 = ND (Get-SzhDossierRapportsDepuisAncrage $ancre3)');
  p('$dix[\'dossier_rapports_lui_meme\'] = [ordered]@{ attendu = $ancre3; obtenu = (Resolve-SzhAncrageDepuisChemin $rapports3) }');
  p('');
  p('# cas 4 : la racine synchronisée parente');
  p('$racine4 = ND (Join-Path $Travail \'cas4\\SZH CSPS\')');
  p('$ancre4 = ND (Join-Path $racine4 \'Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre4 \'2_Produkte\') | Out-Null');
  p('$dix[\'racine_synchronisee_parente\'] = [ordered]@{ attendu = $ancre4; obtenu = (Resolve-SzhAncrageDepuisChemin $racine4) }');
  p('');
  p('# cas 5 : équivalent de C:\\Users\\<x> (grand-parent, profondeur 2)');
  p('$racine5parent = ND (Join-Path $Travail \'cas5\')');
  p('$racine5 = ND (Join-Path $racine5parent \'SZH CSPS\')');
  p('$ancre5 = ND (Join-Path $racine5 \'Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre5 \'2_Produkte\') | Out-Null');
  p('$dix[\'equivalent_users_x\'] = [ordered]@{ attendu = $ancre5; obtenu = (Resolve-SzhAncrageDepuisChemin $racine5parent) }');
  p('');
  p('# cas 6 : un chemin de FICHIER, pas de dossier -- son parent (racine6) n\'a pas l\'ancrage');
  p('# comme ancêtre direct (remontée depuis le fichier échoue), il faut prendre le dossier');
  p('# parent puis DESCENDRE depuis lui.');
  p('$racine6 = ND (Join-Path $Travail \'cas6\\SZH CSPS\')');
  p('$ancre6 = ND (Join-Path $racine6 \'Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre6 \'2_Produkte\') | Out-Null');
  p('$fichier6 = NF (Join-Path $racine6 \'unfichier.txt\')');
  p('$dix[\'chemin_de_fichier\'] = [ordered]@{ attendu = $ancre6; obtenu = (Resolve-SzhAncrageDepuisChemin $fichier6) }');
  p('');
  p('# cas 7 : guillemets englobants + espaces de bord');
  p('$racine7 = ND (Join-Path $Travail \'cas7\\SZH CSPS\')');
  p('$ancre7 = ND (Join-Path $racine7 \'Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre7 \'2_Produkte\') | Out-Null');
  p('$brut7 = \'  "\' + $racine7 + \'"  \'');
  p('$dix[\'guillemets_et_espaces\'] = [ordered]@{ attendu = $ancre7; obtenu = (Resolve-SzhAncrageDepuisChemin $brut7) }');
  p('');
  p('# cas 8 : "/" au lieu de "\\"');
  p('$racine8 = ND (Join-Path $Travail \'cas8\\SZH CSPS\')');
  p('$ancre8 = ND (Join-Path $racine8 \'Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre8 \'2_Produkte\') | Out-Null');
  p('$brut8 = $racine8.Replace(\'\\\', \'/\')');
  p('$dix[\'slash_au_lieu_de_antislash\'] = [ordered]@{ attendu = $ancre8; obtenu = (Resolve-SzhAncrageDepuisChemin $brut8) }');
  p('');
  p('# cas 9 : séparateur final');
  p('$racine9 = ND (Join-Path $Travail \'cas9\\SZH CSPS\')');
  p('$ancre9 = ND (Join-Path $racine9 \'Daten_Allgemein - General\')');
  p('ND (Join-Path $ancre9 \'2_Produkte\') | Out-Null');
  p('$brut9 = $racine9 + \'\\\'');
  p('$dix[\'separateur_final\'] = [ordered]@{ attendu = $ancre9; obtenu = (Resolve-SzhAncrageDepuisChemin $brut9) }');
  p('');
  p('# cas 10 : UNC -- remontée pure (string), aucun accès disque, le partage n\'existe pas réellement');
  p('$brut10 = \'\\\\serveur\\partage\\Daten_Allgemein - General\\2_Produkte\\52_Revue\'');
  p('$dix[\'unc\'] = [ordered]@{ attendu = \'\\\\serveur\\partage\\Daten_Allgemein - General\'; obtenu = (Resolve-SzhAncrageDepuisChemin $brut10) }');
  p('');
  p('$resultats[\'dix_cas\'] = $dix');
  p('');

  // ---- remontée avant descente (avec leurre descendant) ----
  p('$ancreR = ND (Join-Path $Travail \'remontee\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancreR \'2_Produkte\') | Out-Null');
  p('$enfantR = ND (Join-Path $ancreR \'2_Produkte\\52_Revue\\RV02_Redaction\')');
  p('# Leurre : nommé comme l\'ancrage, mais DESCENDANT de $enfantR (donc à portée d\'une');
  p('# descente lancée depuis lui) -- si le code descendait avant de remonter, c\'est LUI');
  p('# qu\'il trouverait, jamais le vrai ancrage qui est un ANCÊTRE hors de portée d\'une');
  p('# descente partant de $enfantR.');
  p('ND (Join-Path $enfantR \'Leurre\\Daten_Allgemein - General\') | Out-Null');
  p('$resultats[\'remontee_avant_descente\'] = [ordered]@{ attendu = $ancreR; obtenu = (Resolve-SzhAncrageDepuisChemin $enfantR) }');
  p('');

  // ---- préférence confirmé / présumé (Find-SzhAncrageAuto) ----
  p('$cP = Join-Path $Travail \'confirme-presume\'');
  p('$presumeP = ND (Join-Path $cP \'Presume\\Daten_Allgemein - General\')  # pas de 2_Produkte : présumé');
  p('$racineOneDriveP = ND (Join-Path $cP \'OneDrive\')');
  p('$confirmeP = ND (Join-Path $racineOneDriveP \'Daten_Allgemein - General\')');
  p('ND (Join-Path $confirmeP \'2_Produkte\') | Out-Null');
  p('$env:USERPROFILE = ND (Join-Path $cP \'Profil\')   # SZH CSPS n\'y existe pas : rang 1 ignoré');
  p('$env:OneDriveCommercial = $presumeP                # rang 2 : présumé, trouvé EN PREMIER');
  p('$env:OneDrive = $racineOneDriveP                    # rang 3 : confirmé, un cran plus profond');
  p('$resultats[\'confirme_bat_presume\'] = [ordered]@{ attendu = $confirmeP; obtenu = (Find-SzhAncrageAuto) }');
  p('Remove-Item Env:OneDriveCommercial -ErrorAction SilentlyContinue');
  p('Remove-Item Env:OneDrive -ErrorAction SilentlyContinue');
  p('$env:USERPROFILE = Join-Path $Travail \'profil-neutre\'');
  p('');

  // ---- garde-fou : profondeur ----
  p('$cD3 = Join-Path $Travail \'profondeur-3\'');
  p('$ancreD3 = ND (Join-Path $cD3 \'n1\\n2\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancreD3 \'2_Produkte\') | Out-Null');
  p('$cD4 = Join-Path $Travail \'profondeur-4\'');
  p('ND (Join-Path $cD4 \'n1\\n2\\n3\\Daten_Allgemein - General\\2_Produkte\') | Out-Null');
  p('$resultats[\'profondeur\'] = [ordered]@{');
  p('  troisNiveaux = [ordered]@{ attendu = $ancreD3; obtenu = (Find-SzhAncrageParDescente -Racine $cD3) }');
  p('  quatreNiveauxRefuse = (Find-SzhAncrageParDescente -Racine $cD4)');
  p('}');
  p('');

  // ---- garde-fou : budget de dossiers visités ----
  p('$cM = Join-Path $Travail \'budget\'');
  p('1..5 | ForEach-Object { ND (Join-Path $cM (\'avant\' + $_)) | Out-Null }');
  p('$ancreM = ND (Join-Path $cM \'avant1\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancreM \'2_Produkte\') | Out-Null');
  p('$resultats[\'budget\'] = [ordered]@{');
  p('  attendu = $ancreM');
  p('  budgetCourt = (Find-SzhAncrageParDescente -Racine $cM -MaxDossiers 3)');
  p('  budgetSuffisant = (Find-SzhAncrageParDescente -Racine $cM -MaxDossiers 100)');
  p('}');
  p('');

  // ---- garde-fou : dossiers système sautés ----
  p('$cS1 = Join-Path $Travail \'systeme-1\'');
  p('ND (Join-Path $cS1 \'node_modules\\Daten_Allgemein - General\\2_Produkte\') | Out-Null');
  p('$cS2 = Join-Path $Travail \'systeme-2\'');
  p('ND (Join-Path $cS2 \'.git\\Daten_Allgemein - General\\2_Produkte\') | Out-Null');
  p('$ancreS2 = ND (Join-Path $cS2 \'Vrai\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancreS2 \'2_Produkte\') | Out-Null');
  p('$resultats[\'dossiers_systeme\'] = [ordered]@{');
  p('  seulementSysteme = (Find-SzhAncrageParDescente -Racine $cS1)');
  p('  systemeEtVrai = [ordered]@{ attendu = $ancreS2; obtenu = (Find-SzhAncrageParDescente -Racine $cS2) }');
  p('}');
  p('');

  // ---- garde-fou : erreur d'énumération avalée (ACL refusée sur un dossier voisin) ----
  p('$cAcl = Join-Path $Travail \'erreur-enumeration\'');
  p('$bloque = ND (Join-Path $cAcl \'Bloque\')');
  p('$libre = ND (Join-Path $cAcl \'Libre\')');
  p('$ancreAcl = ND (Join-Path $libre \'Daten_Allgemein - General\')');
  p('ND (Join-Path $ancreAcl \'2_Produkte\') | Out-Null');
  p('$aclOk = $false');
  p('$regleDeny = $null');
  p('try {');
  p('  $regleDeny = New-Object System.Security.AccessControl.FileSystemAccessRule(');
  p('    [Security.Principal.WindowsIdentity]::GetCurrent().User, \'ListDirectory\', \'Deny\')');
  p('  $acl = Get-Acl $bloque');
  p('  $acl.AddAccessRule($regleDeny)');
  p('  Set-Acl -Path $bloque -AclObject $acl');
  p('  try { Get-ChildItem -LiteralPath $bloque -Directory -Force -ErrorAction Stop | Out-Null }');
  p('  catch { $aclOk = $true }');
  p('} catch { $aclOk = $false }');
  p('$obtenuAcl = $null');
  p('$leveAcl = $false');
  p('try { $obtenuAcl = Find-SzhAncrageParDescente -Racine $cAcl } catch { $leveAcl = $true }');
  p('if ($regleDeny) {');
  p('  try { $acl2 = Get-Acl $bloque; $acl2.RemoveAccessRule($regleDeny) | Out-Null; Set-Acl -Path $bloque -AclObject $acl2 } catch { }');
  p('}');
  p('$resultats[\'erreur_enumeration\'] = [ordered]@{ aclOk = $aclOk; attendu = $ancreAcl; obtenu = $obtenuAcl; leve = $leveAcl }');
  p('');

  // ---- échec propre : aucun ancrage nulle part -> $null, jamais une exception ----
  p('$cE = ND (Join-Path $Travail \'echec-propre\')');
  p('ND (Join-Path $cE \'RienIci\\NiLa\') | Out-Null');
  p('$leveEchec = $false');
  p('$obtenuEchec = \'valeur-non-remplacee\'');
  p('try { $obtenuEchec = Resolve-SzhAncrageDepuisChemin $cE } catch { $leveEchec = $true }');
  p('$resultats[\'echec_propre\'] = [ordered]@{ obtenu = $obtenuEchec; leve = $leveEchec }');
  p('');

  // ---- dérivés (2.1) ----
  p('$resultats[\'derives\'] = [ordered]@{');
  // "C:\Ancrage" plutôt qu'une lettre fantaisiste : Join-Path lève DriveNotFoundException
  // sur une lettre de lecteur qui ne correspond à aucun PSDrive réel du poste -- C: existe
  // toujours sous Windows.
  p('  base = (Get-SzhBaseProduitsDepuisAncrage \'C:\\Ancrage\')');
  p('  rapports = (Get-SzhDossierRapportsDepuisAncrage \'C:\\Ancrage\')');
  p('  baseVide = (Get-SzhBaseProduitsDepuisAncrage \'\')');
  p('  rapportsVide = (Get-SzhDossierRapportsDepuisAncrage \'\')');
  p('}');
  p('');

  // ---- anti-harcèlement, pur ----
  p('$maintenant = (Get-Date).ToUniversalTime()');
  p('$etatRecent = New-Object psobject -Property @{ ancrageDemandeLe = $maintenant.AddHours(-1).ToString(\'o\') }');
  p('$etatVieux = New-Object psobject -Property @{ ancrageDemandeLe = $maintenant.AddHours(-25).ToString(\'o\') }');
  p('$etatAbsent = New-Object psobject -Property @{}');
  p('$resultats[\'anti_harcelement\'] = [ordered]@{');
  p('  recent = (Test-SzhDemandeRecente $etatRecent)');
  p('  vieux = (Test-SzhDemandeRecente $etatVieux)');
  p('  marqueurAbsent = (Test-SzhDemandeRecente $etatAbsent)');
  p('  etatNul = (Test-SzhDemandeRecente $null)');
  p('}');
  p('');

  // ---- Request-SzhAncrageUtilisateur ne s'active jamais en simulation ----
  p('$env:SZH_LANCEUR_SIMULE = \'1\'');
  p('$resultats[\'demande_simulee\'] = (Request-SzhAncrageUtilisateur)');
  p('Remove-Item Env:SZH_LANCEUR_SIMULE -ErrorAction SilentlyContinue');
  p('');

  // ---- unitaires purs complémentaires ----
  p('$resultats[\'unitaires_purs\'] = [ordered]@{');
  p('  nomAncrageCasseEtEspaces = (Test-SzhNomAncrage \'  DATEN_ALLGEMEIN - GENERAL  \')');
  p('  nomAncrageFaux = (Test-SzhNomAncrage \'Autre Dossier\')');
  p('  nomAncrageVide = (Test-SzhNomAncrage \'\')');
  p('  cheminNettoyeRacineLecteur = (Get-SzhCheminNettoye \'C:\\\')');
  p('  dossierSystemeWindows = (Test-SzhDossierSystemeExclu \'Windows\')');
  p('  dossierSystemeProgramFilesX86 = (Test-SzhDossierSystemeExclu \'Program Files (x86)\')');
  p('  dossierSystemeProgramData = (Test-SzhDossierSystemeExclu \'ProgramData\')');
  p('  dossierSystemeRecycleBin = (Test-SzhDossierSystemeExclu \'$Recycle.Bin\')');
  p('  dossierSystemeAppData = (Test-SzhDossierSystemeExclu \'AppData\')');
  p('  dossierSystemeNodeModules = (Test-SzhDossierSystemeExclu \'node_modules\')');
  p('  dossierSystemeGit = (Test-SzhDossierSystemeExclu \'.git\')');
  p('  dossierNonSysteme = (Test-SzhDossierSystemeExclu \'MonDossier\')');
  p('  racineCandidateSzh = (Test-SzhNomRacineCandidate \'SZH CSPS\')');
  p('  racineCandidateOneDrive = (Test-SzhNomRacineCandidate \'OneDrive - Perso\')');
  p('  racineCandidateAutre = (Test-SzhNomRacineCandidate \'Documents\')');
  p('}');
  p('');

  p('[System.IO.File]::WriteAllText($Sortie, ($resultats | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))');
  return L.join('\r\n') + '\r\n';
}

function psChaine(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }

const decisions = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-ancrage-decisions-'));
  try {
    const r = executerPilote('decisions', travail, piloteGroupe1(), [travail]);
    return r;
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
})();

test('le pilote « décisions » s’exécute sans erreur', { skip: sansPowerShell }, () => {
  assert.strictEqual(decisions.status, 0, 'le pilote PowerShell a échoué : ' + decisions.stderr);
  assert.ok(decisions.lu, 'aucune sortie JSON produite');
});

test('les dix cas de la section 2.4 rendent tous l’ancrage attendu', { skip: sansPowerShell }, () => {
  const d = decisions.lu.dix_cas;
  for (const cle of Object.keys(d)) {
    assert.strictEqual(d[cle].obtenu, d[cle].attendu, 'cas : ' + cle);
  }
});

test('remontée avant descente : un chemin sous l’ancrage le retrouve par remontée, pas par un leurre en descente', { skip: sansPowerShell }, () => {
  const r = decisions.lu.remontee_avant_descente;
  assert.strictEqual(r.obtenu, r.attendu,
    'le vrai ancrage (ancêtre) n’a pas gagné -- une descente aurait trouvé le leurre (descendant) à la place');
});

test('détection automatique : un ancrage confirmé (2_Produkte) l’emporte sur un présumé trouvé avant lui', { skip: sansPowerShell }, () => {
  const r = decisions.lu.confirme_bat_presume;
  assert.strictEqual(r.obtenu, r.attendu);
});

test('garde-fou de profondeur : 3 niveaux trouvent l’ancrage, 4 niveaux ne le trouvent jamais', { skip: sansPowerShell }, () => {
  const p3 = decisions.lu.profondeur;
  assert.strictEqual(p3.troisNiveaux.obtenu, p3.troisNiveaux.attendu);
  assert.ok(!p3.quatreNiveauxRefuse, 'un ancrage à 4 niveaux de profondeur a été trouvé -- le garde-fou ne fonctionne plus');
});

test('garde-fou de budget : un budget trop court abandonne avant l’ancrage, un budget large le retrouve', { skip: sansPowerShell }, () => {
  const b = decisions.lu.budget;
  assert.ok(!b.budgetCourt, 'le budget de 3 dossiers a quand même laissé trouver l’ancrage -- le garde-fou ne fonctionne plus');
  assert.strictEqual(b.budgetSuffisant, b.attendu);
});

test('dossiers système : sautés y compris comme conteneurs, sans bloquer un ancrage voisin', { skip: sansPowerShell }, () => {
  const s = decisions.lu.dossiers_systeme;
  assert.ok(!s.seulementSysteme, 'un ancrage caché dans node_modules a été trouvé -- il aurait dû être sauté');
  assert.strictEqual(s.systemeEtVrai.obtenu, s.systemeEtVrai.attendu,
    'un ancrage voisin d’un dossier système (.git) n’a pas été trouvé');
});

test('une erreur d’énumération (accès refusé) est avalée, sans interrompre la recherche', { skip: sansPowerShell }, () => {
  const e = decisions.lu.erreur_enumeration;
  if (!e.aclOk) {
    // Le refus d'accès n'a pas réellement pris sur ce poste (droits particuliers) : le
    // scénario ne prouve rien, on ne l'affirme pas à tort.
    return;
  }
  assert.strictEqual(e.leve, false, 'Find-SzhAncrageParDescente a levé une exception au lieu de l’avaler');
  assert.strictEqual(e.obtenu, e.attendu, 'l’ancrage voisin du dossier bloqué n’a pas été trouvé');
});

test('échec propre : aucun ancrage nulle part rend un résultat vide, jamais une exception', { skip: sansPowerShell }, () => {
  const e = decisions.lu.echec_propre;
  assert.strictEqual(e.leve, false, 'Resolve-SzhAncrageDepuisChemin a levé une exception');
  assert.ok(!e.obtenu, 'un ancrage a été trouvé là où il ne devrait rien y avoir : ' + e.obtenu);
});

test('dérivés : base des produits et dossier des rapports, avec le nom réel (faute de frappe comprise)', { skip: sansPowerShell }, () => {
  const d = decisions.lu.derives;
  assert.strictEqual(d.base, 'C:\\Ancrage\\2_Produkte');
  assert.strictEqual(d.rapports,
    'C:\\Ancrage\\2_Produkte\\Edition SZH CSPS allgemein\\_AutoReportToolboxZeitscrhiften');
  assert.strictEqual(d.baseVide, '');
  assert.strictEqual(d.rapportsVide, '');
});

test('anti-harcèlement : un marqueur de moins de 24h bloque, un plus vieux autorise', { skip: sansPowerShell }, () => {
  const a = decisions.lu.anti_harcelement;
  assert.strictEqual(a.recent, true, 'un marqueur d’il y a 1h aurait dû empêcher une nouvelle demande');
  assert.strictEqual(a.vieux, false, 'un marqueur d’il y a 25h aurait dû autoriser une nouvelle demande');
  assert.strictEqual(a.marqueurAbsent, false);
  assert.strictEqual(a.etatNul, false);
});

test('Request-SzhAncrageUtilisateur ne s’active jamais en mode simulé', { skip: sansPowerShell }, () => {
  assert.strictEqual(decisions.lu.demande_simulee, '');
});

test('unitaires purs : casse/espaces, dossiers système, racines candidates', { skip: sansPowerShell }, () => {
  const u = decisions.lu.unitaires_purs;
  assert.strictEqual(u.nomAncrageCasseEtEspaces, true);
  assert.strictEqual(u.nomAncrageFaux, false);
  assert.strictEqual(u.nomAncrageVide, false);
  assert.strictEqual(u.cheminNettoyeRacineLecteur, 'C:\\', 'une racine de lecteur ne doit pas perdre son séparateur');
  for (const cle of ['dossierSystemeWindows', 'dossierSystemeProgramFilesX86', 'dossierSystemeProgramData',
    'dossierSystemeRecycleBin', 'dossierSystemeAppData', 'dossierSystemeNodeModules', 'dossierSystemeGit']) {
    assert.strictEqual(u[cle], true, cle);
  }
  assert.strictEqual(u.dossierNonSysteme, false);
  assert.strictEqual(u.racineCandidateSzh, true);
  assert.strictEqual(u.racineCandidateOneDrive, true);
  assert.strictEqual(u.racineCandidateAutre, false);
});

// =====================================================================================
// ---- Groupe 2 : orchestration complète, windows/szh-common.ps1 (le VRAI socle) --------
//      Requis pour Resolve-SzhAncrage (config.json, etat-utilisateur.json, Write-SzhLog),
//      Initialize-SzhAncrage et Get-SzhBaseRevuesPour, exactement comme en production.
// =====================================================================================

function piloteGroupe2() {
  const L = [];
  const p = (s) => L.push(s);
  p('$ErrorActionPreference = \'Stop\'');
  p('$Travail = $args[0]');
  p('$Sortie = $args[1]');
  // Toutes les racines qui pourraient faire fuiter le VRAI poste, redirigées avant même le
  // dot-source : SZH_BASE (config.json, logs), LOCALAPPDATA (etat-utilisateur.json),
  // USERPROFILE/OneDrive*/OneDriveCommercial (détection automatique).
  p('$env:SZH_BASE = Join-Path $Travail \'programdata\'');
  p('$env:LOCALAPPDATA = Join-Path $Travail \'localappdata\'');
  p('$env:USERPROFILE = Join-Path $Travail \'profil-neutre\'');
  p('New-Item -ItemType Directory -Force -Path $env:USERPROFILE | Out-Null');
  p('Remove-Item Env:OneDriveCommercial -ErrorAction SilentlyContinue');
  p('Remove-Item Env:OneDrive -ErrorAction SilentlyContinue');
  p('Remove-Item Env:SZH_ANCRAGE -ErrorAction SilentlyContinue');
  p('Remove-Item Env:SZH_LANCEUR_SIMULE -ErrorAction SilentlyContinue');
  p('. ' + psChaine(COMMUN_PS1));
  p('New-Item -ItemType Directory -Force -Path $SzhBase | Out-Null');
  p('New-Item -ItemType Directory -Force -Path $SzhBaseUtilisateur | Out-Null');
  p('function ND([string]$p) { New-Item -ItemType Directory -Force -Path $p | Out-Null; return $p }');
  p('$resultats = [ordered]@{}');
  p('');

  // ---- ordre de résolution : essai > config > cache ----
  p('$ancEssai = ND (Join-Path $Travail \'ordre\\essai\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancEssai \'2_Produkte\') | Out-Null');
  p('$ancConfig = ND (Join-Path $Travail \'ordre\\config\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancConfig \'2_Produkte\') | Out-Null');
  p('$ancCacheOrdre = ND (Join-Path $Travail \'ordre\\cache\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancCacheOrdre \'2_Produkte\') | Out-Null');
  p('');
  p('$env:SZH_ANCRAGE = $ancEssai');
  p('Set-SzhJson $SzhConfigFile ([ordered]@{ ancrageSharePoint = $ancConfig })');
  p('Set-SzhJson $SzhEtatUtilisateurFile ([ordered]@{ ancrageSharePoint = $ancCacheOrdre })');
  p('Clear-SzhAncrageMemo');
  p('$rEssai = Resolve-SzhAncrage');
  p('');
  p('Remove-Item Env:SZH_ANCRAGE -ErrorAction SilentlyContinue');
  p('Clear-SzhAncrageMemo');
  p('$rConfig = Resolve-SzhAncrage');
  p('');
  p('Set-SzhJson $SzhConfigFile ([ordered]@{})');
  p('Clear-SzhAncrageMemo');
  p('$rCache = Resolve-SzhAncrage');
  p('');
  p('$resultats[\'ordre_resolution\'] = [ordered]@{');
  p('  essai = [ordered]@{ chemin = $rEssai.chemin; origine = $rEssai.origine; attendu = $ancEssai }');
  p('  config = [ordered]@{ chemin = $rConfig.chemin; origine = $rConfig.origine; attendu = $ancConfig }');
  p('  cache = [ordered]@{ chemin = $rCache.chemin; origine = $rCache.origine; attendu = $ancCacheOrdre }');
  p('}');
  p('');

  // ---- revalidation du cache : purge + hit ----
  p('$ancDisparu = Join-Path $Travail \'cache-disparu\\Daten_Allgemein - General\'   # jamais créé');
  p('Set-SzhJson $SzhConfigFile ([ordered]@{})');
  p('Set-SzhJson $SzhEtatUtilisateurFile ([ordered]@{ ancrageSharePoint = $ancDisparu })');
  p('Clear-SzhAncrageMemo');
  p('$rPurge = Resolve-SzhAncrage');
  p('$etatApresPurge = Get-Content $SzhEtatUtilisateurFile -Raw -Encoding UTF8 | ConvertFrom-Json');
  p('$cleEncorePresente = $false');
  p('if ($etatApresPurge.PSObject.Properties[\'ancrageSharePoint\'] -and [string]$etatApresPurge.ancrageSharePoint) { $cleEncorePresente = $true }');
  p('');
  p('$ancCacheOk = ND (Join-Path $Travail \'cache-ok\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancCacheOk \'2_Produkte\') | Out-Null');
  p('Set-SzhJson $SzhEtatUtilisateurFile ([ordered]@{ ancrageSharePoint = $ancCacheOk })');
  p('Clear-SzhAncrageMemo');
  p('$rHit = Resolve-SzhAncrage');
  p('');
  p('$resultats[\'cache_revalidation\'] = [ordered]@{');
  p('  purge = [ordered]@{ chemin = $rPurge.chemin; origine = $rPurge.origine; cleEncorePresente = $cleEncorePresente }');
  p('  hit = [ordered]@{ chemin = $rHit.chemin; origine = $rHit.origine; attendu = $ancCacheOk }');
  p('}');
  p('');

  // ---- Get-SzhBaseRevuesPour : la non-régression ----
  // Repart d'un état propre : le scénario précédent (revalidation du cache) laisse
  // etat-utilisateur.json avec un ancrageSharePoint valide (le cas "hit"), qui gagnerait
  // sinon la résolution avant même que la détection automatique n'entre en jeu.
  p('Set-SzhJson $SzhConfigFile ([ordered]@{})');
  p('Set-SzhJson $SzhEtatUtilisateurFile ([ordered]@{})');
  p('$ancParallele = ND (Join-Path $Travail \'regression\\parallele\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancParallele \'2_Produkte\') | Out-Null');
  p('$env:SZH_ANCRAGE = $ancParallele');
  p('$configPersonnalisee = \'Z:\\Ailleurs\\Revues\'');
  p('Set-SzhJson $SzhConfigFile ([ordered]@{ basesRevues = [ordered]@{ prod = $configPersonnalisee } })');
  p('Clear-SzhAncrageMemo');
  p('$baseA = Get-SzhBaseRevuesPour \'production\'');
  p('Remove-Item Env:SZH_ANCRAGE -ErrorAction SilentlyContinue');
  p('');
  p('# LE POINT LE PLUS IMPORTANT : sans basesRevues.prod, un poste où');
  p('# %USERPROFILE%\\SZH CSPS\\Daten_Allgemein - General existe doit rendre EXACTEMENT la');
  p('# même chaîne que le défaut codé en dur d\'avant cette modification.');
  p('Set-SzhJson $SzhConfigFile ([ordered]@{})');
  p('$profilB = ND (Join-Path $Travail \'regression\\posteB\')');
  p('$env:USERPROFILE = $profilB');
  p('$ancB = ND (Join-Path $profilB \'SZH CSPS\\Daten_Allgemein - General\')');
  p('ND (Join-Path $ancB \'2_Produkte\') | Out-Null');
  p('Clear-SzhAncrageMemo');
  p('$baseB = Get-SzhBaseRevuesPour \'production\'');
  p('$ancienDefautB = [Environment]::ExpandEnvironmentVariables($SzhBasesDefaut.prod)');
  p('');
  p('# \'test\' (dev) : jamais touché par l\'ancrage.');
  p('$env:USERPROFILE = Join-Path $Travail \'profil-neutre\'');
  p('Clear-SzhAncrageMemo');
  p('$baseDev = Get-SzhBaseRevuesPour \'test\'');
  p('$attenduDev = [Environment]::ExpandEnvironmentVariables($SzhBasesDefaut.dev)');
  p('');
  p('$resultats[\'base_revues_pour\'] = [ordered]@{');
  p('  configPrioritaire = [ordered]@{ obtenu = $baseA; attendu = $configPersonnalisee }');
  p('  nonRegression = [ordered]@{ obtenu = $baseB; attenduDerive = (Join-Path $ancB \'2_Produkte\'); attenduAncienDefaut = $ancienDefautB }');
  p('  dev = [ordered]@{ obtenu = $baseDev; attendu = $attenduDev }');
  p('}');
  p('');

  // ---- garde-fou majeur : aucune fenêtre atteignable depuis Resolve-SzhAncrage, SANS simulation ----
  p('$script:temoinDemandeAppelee = $false');
  p('function Request-SzhAncrageUtilisateur { $script:temoinDemandeAppelee = $true; return \'NE-DOIT-JAMAIS-ARRIVER\' }');
  p('Remove-Item Env:SZH_LANCEUR_SIMULE -ErrorAction SilentlyContinue   # PAS de simulation : le pire cas');
  p('Set-SzhJson $SzhConfigFile ([ordered]@{})');
  p('Set-SzhJson $SzhEtatUtilisateurFile ([ordered]@{})');
  p('$env:USERPROFILE = Join-Path $Travail \'profil-neutre\'   # aucune racine candidate n\'existe : rien de trouvable');
  p('Clear-SzhAncrageMemo');
  p('$rPassif = Resolve-SzhAncrage');
  p('$resultats[\'passivite_sans_simulation\'] = [ordered]@{');
  p('  chemin = $rPassif.chemin; origine = $rPassif.origine; fenetreDemandee = $script:temoinDemandeAppelee');
  p('}');
  p('');

  // ---- mémoïsation : deux appels, un seul balayage ; Clear-SzhAncrageMemo relance ----
  p('$script:compteurAuto = 0');
  p('function Find-SzhAncrageAuto { $script:compteurAuto++; return $null }');
  p('Clear-SzhAncrageMemo');
  p('[void](Resolve-SzhAncrage)');
  p('[void](Resolve-SzhAncrage)');
  p('$apresDeuxAppels = $script:compteurAuto');
  p('Clear-SzhAncrageMemo');
  p('[void](Resolve-SzhAncrage)');
  p('$apresClear = $script:compteurAuto');
  p('$resultats[\'memoisation\'] = [ordered]@{ apresDeuxAppels = $apresDeuxAppels; apresClear = $apresClear }');
  p('');

  // ---- Get-SzhBaseRevuesPour : aucun effet de bord (ni fenêtre, ni écriture) ----
  p('$script:temoinDemandeAppelee = $false');
  p('Set-SzhJson $SzhEtatUtilisateurFile ([ordered]@{ marqueur = \'intact\' })');
  p('$avantOctets = Get-Content $SzhEtatUtilisateurFile -Raw -Encoding UTF8');
  p('Clear-SzhAncrageMemo');
  p('[void](Get-SzhBaseRevuesPour \'production\')');
  p('$apresOctets = Get-Content $SzhEtatUtilisateurFile -Raw -Encoding UTF8');
  p('$resultats[\'base_revues_sans_effet_de_bord\'] = [ordered]@{');
  p('  fenetreDemandee = $script:temoinDemandeAppelee; etatInchange = ($avantOctets -eq $apresOctets)');
  p('}');
  p('');

  p('[System.IO.File]::WriteAllText($Sortie, ($resultats | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))');
  return L.join('\r\n') + '\r\n';
}

const orchestration = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-ancrage-orchestration-'));
  try {
    return executerPilote('orchestration', travail, piloteGroupe2(), [travail]);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
})();

test('le pilote « orchestration » s’exécute sans erreur', { skip: sansPowerShell }, () => {
  assert.strictEqual(orchestration.status, 0, 'le pilote PowerShell a échoué : ' + orchestration.stderr);
  assert.ok(orchestration.lu, 'aucune sortie JSON produite');
});

test('ordre de résolution : essai > config > cache, dans cet ordre', { skip: sansPowerShell }, () => {
  const o = orchestration.lu.ordre_resolution;
  assert.strictEqual(o.essai.chemin, o.essai.attendu);
  assert.strictEqual(o.essai.origine, 'essai');
  assert.strictEqual(o.config.chemin, o.config.attendu);
  assert.strictEqual(o.config.origine, 'config');
  assert.strictEqual(o.cache.chemin, o.cache.attendu);
  assert.strictEqual(o.cache.origine, 'cache');
});

test('cache : une valeur qui ne pointe plus sur un dossier existant est ignorée ET purgée', { skip: sansPowerShell }, () => {
  const c = orchestration.lu.cache_revalidation;
  assert.notStrictEqual(c.purge.origine, 'cache', 'un chemin disparu a quand même été rendu comme "cache"');
  assert.strictEqual(c.purge.cleEncorePresente, false,
    'etat-utilisateur.json garde encore la clé ancrageSharePoint après un cache invalide -- elle doit être purgée');
  assert.strictEqual(c.hit.chemin, c.hit.attendu);
  assert.strictEqual(c.hit.origine, 'cache');
});

test('Get-SzhBaseRevuesPour : basesRevues.prod garde la priorité absolue sur l’ancrage', { skip: sansPowerShell }, () => {
  const b = orchestration.lu.base_revues_pour.configPrioritaire;
  assert.strictEqual(b.obtenu, b.attendu);
});

test('Get-SzhBaseRevuesPour : NON-RÉGRESSION -- même chaîne qu’avant cette modification, quand l’ancrage se détecte au même endroit que le défaut codé en dur', { skip: sansPowerShell }, () => {
  const n = orchestration.lu.base_revues_pour.nonRegression;
  assert.strictEqual(n.obtenu, n.attenduDerive,
    'la base dérivée de l’ancrage ne correspond plus à <profil>\\SZH CSPS\\Daten_Allgemein - General\\2_Produkte');
  assert.strictEqual(n.obtenu, n.attenduAncienDefaut,
    'RÉGRESSION : la nouvelle résolution ne rend plus exactement ce que rendait l’ancien défaut codé en dur -- des revues disparaîtraient pour un rédacteur');
});

test('Get-SzhBaseRevuesPour : la base "test" (dev) reste inchangée, jamais dérivée de l’ancrage', { skip: sansPowerShell }, () => {
  const d = orchestration.lu.base_revues_pour.dev;
  assert.strictEqual(d.obtenu, d.attendu);
});

test('GARDE-FOU MAJEUR : Resolve-SzhAncrage n’ouvre jamais de fenêtre, même sans SZH_LANCEUR_SIMULE, même quand rien n’est trouvable', { skip: sansPowerShell }, () => {
  const p = orchestration.lu.passivite_sans_simulation;
  assert.strictEqual(p.fenetreDemandee, false,
    'Resolve-SzhAncrage a appelé Request-SzhAncrageUtilisateur -- un accesseur de chemin ne doit JAMAIS pouvoir ouvrir une fenêtre');
  assert.strictEqual(p.origine, 'absent');
  assert.strictEqual(p.chemin, '');
});

test('mémoïsation : deux appels consécutifs ne balaient le disque qu’une fois ; Clear-SzhAncrageMemo relance un balayage', { skip: sansPowerShell }, () => {
  const m = orchestration.lu.memoisation;
  assert.strictEqual(m.apresDeuxAppels, 1, 'deux appels à Resolve-SzhAncrage ont provoqué plus d’un balayage');
  assert.strictEqual(m.apresClear, 2, 'Clear-SzhAncrageMemo ne relance pas le balayage au prochain appel');
});

test('Get-SzhBaseRevuesPour reste sans effet de bord visible : aucune fenêtre, aucune écriture dans etat-utilisateur.json', { skip: sansPowerShell }, () => {
  const e = orchestration.lu.base_revues_sans_effet_de_bord;
  assert.strictEqual(e.fenetreDemandee, false);
  assert.strictEqual(e.etatInchange, true, 'etat-utilisateur.json a été modifié par un simple accesseur de chemin');
});
