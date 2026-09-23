// Le check-in mensuel des postes (windows/szh-checkin.ps1) : un CSV par poste dans le
// dossier partagé, une ligne par mois ET par compte Windows, rafraîchie à chaque ouverture
// du lanceur.
//
//   node --test test/js/checkin-postes.test.js
//   node --test "test/js/*.test.js"
//
// Trois familles, du plus statique au plus complet :
//
//   1. la SOURCE réelle des .ps1 : le fichier est bien dot-sourcé, le nom du dossier de
//      l'application n'y est pas recopié (un banc voisin l'interdit déjà pour szh-ancrage),
//      le dossier d'inventaire n'est déclaré qu'une fois, et l'écriture porte le préfixe
//      « ~$ » et son bloc de nettoyage ;
//   2. les fonctions PURES extraites du vrai fichier et rejouées dans un pilote PowerShell
//      (même technique que test/js/rapport-erreur-ps.test.js et
//      test/js/orphelins-toolkit.test.js) : la fusion des lignes, la forme du CSV, le
//      nettoyage du temporaire quand l'écriture échoue ;
//   3. le VRAI lanceur (windows/open-produit.ps1) en simulation, sur une arborescence
//      jetable : le fichier apparaît au bon endroit, sous le bon nom, et deux lancements de
//      suite ne font toujours qu'une ligne.
//
// ⚠ AUCUN test ici ne touche le vrai OneDrive du poste : SZH_BASE, SZH_RACINE_TEST,
// SZH_RACINE_PROD, SZH_ANCRAGE, LOCALAPPDATA et USERPROFILE sont tous détournés vers des
// dossiers jetables (fs.mkdtempSync), et le lanceur tourne en SZH_LANCEUR_SIMULE=1.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const CHECKIN_PS1 = path.join(RACINE, 'windows', 'szh-checkin.ps1');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const PRODUITS_PS1 = path.join(RACINE, 'windows', 'szh-produits.ps1');
const ANCRAGE_PS1 = path.join(RACINE, 'windows', 'szh-ancrage.ps1');
const LANCEUR_PS1 = path.join(RACINE, 'windows', 'open-produit.ps1');

const SOURCE_CHECKIN = fs.readFileSync(CHECKIN_PS1, 'utf8');
const SOURCE_COMMUN = fs.readFileSync(COMMUN_PS1, 'utf8');
const SOURCE_PRODUITS = fs.readFileSync(PRODUITS_PS1, 'utf8');
const SOURCE_ANCRAGE = fs.readFileSync(ANCRAGE_PS1, 'utf8');
const SOURCE_LANCEUR = fs.readFileSync(LANCEUR_PS1, 'utf8');

// Lu plutôt que recopié, même motif que dans test/js/lanceur-ancrage.test.js : un futur
// renommage du dossier de l'application ne doit pas casser ce banc.
const mSegmentApplication = SOURCE_ANCRAGE.match(/\$script:SzhSegmentApplication\s*=\s*'([^']+)'/);
assert.ok(mSegmentApplication, 'szh-ancrage.ps1 ne déclare plus $script:SzhSegmentApplication');
const SEGMENT_APPLICATION = mSegmentApplication[1];

// Détection partagée (gardes.js) : sous un runner simulé sans PowerShell, elle rend
// « indisponible » au lieu d'appeler le vrai powershell.exe.
const { POWERSHELL, sansPowerShell } = require('./gardes');

// L'en-tête attendu, dans l'ordre. C'est la FORME décidée par le propriétaire : si une
// colonne bouge ou disparaît, c'est ici que ça se voit, et pas dans un tableur six mois
// plus tard.
const COLONNES = [
  'Horodatage',
  'Mois',
  'Poste',
  'Compte Windows',
  'SID du compte',
  'Dossier personnel',
  'Adresse de connexion',
  'Système',
  'PowerShell',
  'Version du toolkit',
  'Version du cockpit',
  'Version de l\'éditeur',
  'Machine virtuelle',
  'Version du disque virtuel',
  'Langue de l\'interface',
  'Emplacement',
  'Origine de l\'ancrage',
  'Place libre (Go)'
];

// =====================================================================================
// ---- 1. Contrôles statiques : la source réelle des .ps1 -----------------------------
// =====================================================================================

test('le check-in est un fichier à lui, dot-sourcé par le socle commun', () => {
  assert.ok(fs.existsSync(CHECKIN_PS1), 'windows/szh-checkin.ps1 n’existe pas');
  assert.match(SOURCE_COMMUN, /\.\s+"\$PSScriptRoot\\szh-checkin\.ps1"/,
    'szh-common.ps1 ne dot-source pas szh-checkin.ps1');
  // Après szh-produits.ps1, dont il tire la racine active : l'ordre de ce bloc porte les
  // dépendances, il n'est pas décoratif.
  const iProduits = SOURCE_COMMUN.indexOf('szh-produits.ps1"');
  const iCheckin = SOURCE_COMMUN.indexOf('szh-checkin.ps1"');
  assert.ok(iProduits !== -1 && iCheckin !== -1 && iProduits < iCheckin,
    'szh-checkin.ps1 doit être dot-sourcé APRÈS szh-produits.ps1');
});

test('le check-in est embarqué dans le toolkit déployé', () => {
  // release.yml recopie le DOSSIER windows/ en entier (`cp -r … windows toolkit/`) et
  // update.ps1 ne tient aucune liste de fichiers : un fichier neuf y monte tout seul. Ce
  // test garde cette propriété — le jour où quelqu'un remplacerait le `cp -r` par une liste
  // explicite, il faudra y ajouter szh-checkin.ps1, et c'est ici qu'on l'apprendra.
  const release = fs.readFileSync(path.join(RACINE, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(release, /cp -r [^\n]*\bwindows\b[^\n]*toolkit\//,
    'release.yml ne recopie plus le dossier windows/ en entier : ajouter szh-checkin.ps1 à sa liste');
});

test('le nom du dossier de l’application n’est pas recopié dans le check-in', () => {
  // Le littéral ne vit qu'à deux endroits du dépôt ($script:SzhSegmentApplication et
  // SEGMENT_APPLICATION). Il est LU ici, jamais écrit, pour que ce banc survive à un
  // renommage du dossier.
  const m = SOURCE_ANCRAGE.match(/\$script:SzhSegmentApplication\s*=\s*'([^']+)'/);
  assert.ok(m, 'szh-ancrage.ps1 ne déclare plus $script:SzhSegmentApplication');
  assert.ok(SOURCE_CHECKIN.indexOf(m[1]) === -1,
    'szh-checkin.ps1 recopie le nom du dossier de l’application');
  // Ni « 2_Produkte », ni « Daten_Allgemein » : tout le chemin vient de Get-SzhBaseRevuesPour.
  assert.ok(SOURCE_CHECKIN.indexOf('2_Produkte') === -1,
    'szh-checkin.ps1 recompose un chemin de bibliothèque au lieu de le dériver');
});

test('le dossier d’inventaire vient de Get-SzhDossierSysteme, jamais de la racine active', () => {
  // Depuis le 23.09.2026 : _Systeme\ (rapports, journaux, suggestions, inventaire) vit
  // TOUJOURS sur SharePoint, ancré via Resolve-SzhAncrage — jamais sous la racine active, où
  // un poste en mode test l'aurait posé jusqu'ici (deux postes sur des emplacements
  // différents auraient alors écrit deux CSV différents, jamais lus par la même personne).
  assert.ok(SOURCE_PRODUITS.indexOf('function Get-SzhDossierSysteme(') !== -1,
    'szh-produits.ps1 ne déclare plus Get-SzhDossierSysteme');
  assert.ok(SOURCE_CHECKIN.indexOf("Get-SzhDossierSysteme 'inventaire'") !== -1,
    'szh-checkin.ps1 ne dérive plus son dossier de Get-SzhDossierSysteme');
  // $SzhDossiersCommuns (créé sous la racine ACTIVE par Initialize-SzhEmplacementsTest) ne
  // doit plus contenir _Systeme : sinon un poste en mode test verrait l'inventaire sous
  // Revues-TESTING au lieu de SharePoint.
  const m = SOURCE_PRODUITS.match(/\$script:SzhDossiersCommuns = @\([\s\S]*?\n\)/);
  assert.ok(m, '$SzhDossiersCommuns introuvable');
  assert.ok(m[0].indexOf('_Systeme') === -1,
    '$SzhDossiersCommuns contient encore _Systeme : l’inventaire serait créé sous la racine active');
});

test('l’écriture du CSV est atomique, préfixée « ~$ », et nettoie son temporaire', () => {
  const m = SOURCE_CHECKIN.match(/function Write-SzhCheckinCsv \{[\s\S]*?\n\}/);
  assert.ok(m, 'Write-SzhCheckinCsv introuvable');
  const corps = m[0];
  assert.ok(corps.indexOf("'~$'") !== -1,
    'le temporaire du check-in ne porte pas le préfixe « ~$ », que OneDrive ignore');
  assert.ok(corps.indexOf('Move-Item') !== -1, 'le CSV n’est plus écrit puis renommé');
  assert.match(corps, /\}\s*finally\s*\{/, 'le temporaire n’est pas nettoyé par un finally');
  // Jamais Set-SzhJson : il n'est pas atomique (et n'écrit pas du CSV).
  assert.ok(SOURCE_CHECKIN.indexOf('Set-SzhJson') === -1,
    'le check-in passe par Set-SzhJson, qui n’est pas atomique');
});

test('le lanceur appelle le check-in une fois, après la résolution de l’ancrage', () => {
  // Les lignes de CODE seulement : le commentaire au-dessus de l'appel nomme la fonction
  // lui aussi, et il n'appelle rien.
  const appels = SOURCE_LANCEUR.match(/^\s*try \{ \[void\]\(Invoke-SzhCheckin/gm) || [];
  assert.strictEqual(appels.length, 1, 'open-produit.ps1 appelle le check-in ' + appels.length + ' fois');
  const iAncrage = SOURCE_LANCEUR.indexOf('$ancrageResolu = Initialize-SzhAncrage');
  const iCheckin = SOURCE_LANCEUR.indexOf('try { [void](Invoke-SzhCheckin');
  assert.ok(iAncrage !== -1 && iAncrage < iCheckin,
    'le check-in doit venir APRÈS la résolution de l’ancrage');
  // Avant la branche du lien « szh:// », qui sort du script : un poste qui ne sert qu'à
  // ouvrir des liens ne doit pas manquer son rendez-vous mensuel.
  const iLien = SOURCE_LANCEUR.indexOf('if ($Lien) {');
  assert.ok(iLien !== -1 && iCheckin < iLien,
    'le check-in doit venir AVANT la branche qui traite un lien et quitte');
  // Sous garde : le lanceur ne doit jamais échouer à cause de l'inventaire.
  assert.match(SOURCE_LANCEUR, /try \{ \[void\]\(Invoke-SzhCheckin[^\n]*\} catch \{ \}/,
    'l’appel au check-in n’est pas sous garde');
});

test('l’adresse de connexion est cherchée dans l’ordre prévu, et ne lève jamais', () => {
  const m = SOURCE_CHECKIN.match(/function Get-SzhAdresseConnexion \{[\s\S]*?\n\}/);
  assert.ok(m, 'Get-SzhAdresseConnexion introuvable');
  const corps = m[0];
  const iRegistre = corps.indexOf('OneDrive\\Accounts');
  const iWhoami = corps.indexOf('whoami.exe');
  const iVide = corps.lastIndexOf("return ''");
  assert.ok(iRegistre !== -1, 'la valeur UserEmail de OneDrive n’est plus lue');
  assert.ok(corps.indexOf('UserEmail') !== -1, 'la valeur lue n’est plus UserEmail');
  assert.ok(corps.indexOf("'Business*'") !== -1, 'les autres comptes Business* ne sont plus parcourus');
  assert.ok(iWhoami !== -1, 'le repli whoami.exe /upn a disparu');
  assert.ok(iRegistre < iWhoami && iWhoami < iVide,
    'l’ordre registre -> whoami -> chaîne vide n’est plus respecté');
  // Aucun droit administrateur, aucune dépendance neuve : ni HKLM en écriture, ni module.
  assert.ok(corps.indexOf('Import-Module') === -1, 'le check-in importe un module');
});

// =====================================================================================
// ---- 2. Les fonctions pures, extraites du vrai fichier et rejouées ------------------
// =====================================================================================

// Le corps d'une fonction PowerShell, du vrai fichier : de sa déclaration jusqu'à la
// première ligne qui n'est QU'UN « } » en colonne 0. Même technique que
// test/js/rapport-erreur-ps.test.js.
function corpsFonction(nom) {
  const lignes = SOURCE_CHECKIN.split(/\r\n|\n/);
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
  return lignes.slice(debut, fin + 1).join('\r\n');
}

// Sans BOM, un .ps1 se relit avec la page de code ANSI du poste et non en UTF-8 : les
// accents de l'en-tête (« Système », « Version de l'éditeur ») seraient abîmés.
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\ufeff' + contenu, 'utf8');
}

const FONCTIONS_PURES = [
  'Get-SzhCheckinValeur',
  'ConvertTo-SzhCheckinTexte',
  'ConvertTo-SzhCheckinLigne',
  'Merge-SzhCheckinLignes',
  'Read-SzhCheckinCsv',
  'Write-SzhCheckinCsv'
];

function executerPilote(travail, appel) {
  const corps = FONCTIONS_PURES.map(corpsFonction).join('\r\n\r\n');
  const sortie = path.join(travail, 'sortie.json');
  const pilote = path.join(travail, 'pilote.ps1');
  ecrirePs1(pilote, [
    "$ErrorActionPreference = 'Stop'",
    corps,
    '$sortie = [ordered]@{ ok = $true }',
    'try {',
    appel,
    '} catch {',
    '  $sortie = [ordered]@{ ok = $false; erreur = $_.Exception.Message }',
    '}',
    '($sortie | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath ' + "'" + sortie + "'" + ' -Encoding UTF8'
  ].join('\r\n'));
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  return {
    status: run.status, stderr: run.stderr || '',
    lu: fs.existsSync(sortie) ? JSON.parse(String(fs.readFileSync(sortie, 'utf8')).replace(/^\uFEFF/, '')) : null
  };
}

// Un CSV « tout entre guillemets » tel qu'Export-Csv l'écrit : découpage d'une ligne en
// champs, guillemets doublés compris.
function champs(ligne) {
  const sortie = [];
  let courant = '';
  let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (dansGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') { courant += '"'; i++; continue; }
      if (c === '"') { dansGuillemets = false; continue; }
      courant += c;
      continue;
    }
    if (c === '"') { dansGuillemets = true; continue; }
    if (c === ';') { sortie.push(courant); courant = ''; continue; }
    courant += c;
  }
  sortie.push(courant);
  return sortie;
}

function lireCsv(chemin) {
  const brut = fs.readFileSync(chemin);
  const avecBom = brut.length >= 3 && brut[0] === 0xEF && brut[1] === 0xBB && brut[2] === 0xBF;
  const texte = String(brut.toString('utf8')).replace(/^\uFEFF/, '');
  const lignes = texte.split(/\r?\n/).filter((l) => l !== '');
  return { avecBom: avecBom, lignes: lignes, entete: champs(lignes[0]), corps: lignes.slice(1).map(champs) };
}

test('CSV : une ligne par mois ET par compte, la ligne du mois étant rafraîchie',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-checkin-fusion-'));
    try {
      const cible = path.join(travail, 'RMO-DESK.csv').replace(/\\/g, '\\\\');
      const appel = [
        "  $colonnes = @('Horodatage', 'Mois', 'Poste', 'Compte Windows', 'Adresse de connexion')",
        // Le fichier tel qu'il existe déjà : deux mois, et DEUX comptes pour le mois courant.
        "  $anciennes = @(",
        "    [pscustomobject]@{ 'Horodatage' = '2026-08-03 08:00:00'; 'Mois' = '2026-08'; 'Poste' = 'RMO-DESK'; 'Compte Windows' = 'RMO-DESK\\robin'; 'Adresse de connexion' = 'a@b.ch' },",
        "    [pscustomobject]@{ 'Horodatage' = '2026-09-01 08:00:00'; 'Mois' = '2026-09'; 'Poste' = 'RMO-DESK'; 'Compte Windows' = 'RMO-DESK\\robin'; 'Adresse de connexion' = 'a@b.ch' },",
        "    [pscustomobject]@{ 'Horodatage' = '2026-09-02 09:00:00'; 'Mois' = '2026-09'; 'Poste' = 'RMO-DESK'; 'Compte Windows' = 'RMO-DESK\\claire'; 'Adresse de connexion' = 'c@b.ch' }",
        "  )",
        // La ligne du jour : même mois, même compte que la deuxième -- et SANS adresse, ce
        // qu'un poste hors domaine et sans OneDrive professionnel produit.
        "  $neuve = [ordered]@{ 'Horodatage' = '2026-09-15 17:30:00'; 'Mois' = '2026-09'; 'Poste' = 'RMO-DESK'; 'Compte Windows' = 'rmo-desk\\ROBIN'; 'Adresse de connexion' = '' }",
        "  $lignes = Merge-SzhCheckinLignes $anciennes $neuve $colonnes 'Mois' 'Compte Windows'",
        "  Write-SzhCheckinCsv -Fichier '" + cible + "' -Lignes $lignes",
        "  $sortie['compte'] = @($lignes).Count"
      ].join('\r\n');
      const r = executerPilote(travail, appel);
      assert.ok(r.lu && r.lu.ok, 'le pilote a échoué : ' + JSON.stringify(r.lu) + r.stderr);
      assert.strictEqual(r.lu.compte, 3, 'la fusion n’a pas gardé exactement trois lignes');

      const csv = lireCsv(path.join(travail, 'RMO-DESK.csv'));
      assert.ok(csv.avecBom, 'le CSV n’a pas de BOM UTF-8 : un tableur suisse l’ouvrirait en charabia');
      assert.deepStrictEqual(csv.entete,
        ['Horodatage', 'Mois', 'Poste', 'Compte Windows', 'Adresse de connexion'],
        'l’en-tête n’est pas en première ligne, ou n’est pas séparé par des points-virgules');
      assert.strictEqual(csv.corps.length, 3, 'mauvais nombre de lignes de données');

      // Le mois d'août n'a pas bougé, et garde son rang.
      assert.deepStrictEqual(csv.corps[0].slice(0, 2), ['2026-08-03 08:00:00', '2026-08']);
      // La ligne du même mois ET du même compte a été REMPLACÉE, sur place — la casse du
      // compte ne crée pas une deuxième ligne pour la même personne.
      assert.strictEqual(csv.corps[1][0], '2026-09-15 17:30:00', 'la ligne du mois n’a pas été rafraîchie');
      assert.strictEqual(csv.corps[1][3], 'rmo-desk\\ROBIN');
      assert.strictEqual(csv.corps[1][4], '', 'une adresse absente doit laisser une case vide, pas casser la ligne');
      assert.strictEqual(csv.corps[1].length, 5, 'une ligne sans adresse doit rester complète');
      // L'autre compte du même mois est intact : le couple mois + compte identifie la ligne.
      assert.deepStrictEqual(csv.corps[2].slice(1, 4), ['2026-09', 'RMO-DESK', 'RMO-DESK\\claire']);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('CSV : un fichier neuf se relit tel quel, et une colonne ajoutée ne le tronque pas',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-checkin-relecture-'));
    try {
      const cible = path.join(travail, 'POSTE.csv').replace(/\\/g, '\\\\');
      const appel = [
        // Un fichier écrit par une version ANTÉRIEURE : trois colonnes seulement.
        "  $vieilles = @('\"Mois\";\"Compte Windows\";\"Poste\"', '\"2026-08\";\"D\\a\";\"POSTE\"')",
        "  Set-Content -LiteralPath '" + cible + "' -Value $vieilles -Encoding UTF8",
        "  $relues = Read-SzhCheckinCsv '" + cible + "'",
        "  $sortie['relues'] = @($relues).Count",
        // La version d'aujourd'hui en connaît quatre : la ligne ancienne doit ressortir
        // complétée, sinon Export-Csv tronquerait TOUT le fichier sur son premier objet.
        "  $colonnes = @('Mois', 'Compte Windows', 'Poste', 'Adresse de connexion')",
        "  $neuve = [ordered]@{ 'Mois' = '2026-09'; 'Compte Windows' = 'D\\b'; 'Poste' = 'POSTE'; 'Adresse de connexion' = 'x@y.ch' }",
        "  $lignes = Merge-SzhCheckinLignes $relues $neuve $colonnes 'Mois' 'Compte Windows'",
        "  Write-SzhCheckinCsv -Fichier '" + cible + "' -Lignes $lignes",
        // Un fichier ABSENT rend un tableau vide, jamais $null : c'est ce qui distingue
        // « premier check-in » de « fichier illisible ».
        "  $absent = Read-SzhCheckinCsv (Join-Path '" + travail.replace(/\\/g, '\\\\') + "' 'jamais-ecrit.csv')",
        "  $sortie['absentEstNul'] = ($null -eq $absent)",
        "  $sortie['absentCompte'] = @($absent).Count"
      ].join('\r\n');
      const r = executerPilote(travail, appel);
      assert.ok(r.lu && r.lu.ok, 'le pilote a échoué : ' + JSON.stringify(r.lu) + r.stderr);
      assert.strictEqual(r.lu.relues, 1, 'la ligne déjà déposée n’a pas été relue');
      assert.strictEqual(r.lu.absentEstNul, false,
        'un fichier absent doit rendre un tableau vide, pas $null — sinon le check-in se croit illisible');
      assert.strictEqual(r.lu.absentCompte, 0);

      const csv = lireCsv(path.join(travail, 'POSTE.csv'));
      assert.deepStrictEqual(csv.entete, ['Mois', 'Compte Windows', 'Poste', 'Adresse de connexion']);
      assert.strictEqual(csv.corps.length, 2);
      assert.deepStrictEqual(csv.corps[0], ['2026-08', 'D\\a', 'POSTE', ''],
        'la ligne d’une version antérieure n’a pas été complétée par une case vide');
      assert.deepStrictEqual(csv.corps[1], ['2026-09', 'D\\b', 'POSTE', 'x@y.ch']);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('CSV : une écriture qui échoue n’abandonne aucun temporaire dans le dossier partagé',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-checkin-temporaire-'));
    try {
      const dossier = path.join(travail, 'inventaire');
      fs.mkdirSync(dossier);
      const cible = path.join(dossier, 'POSTE.csv');
      fs.writeFileSync(cible, 'deja la', 'utf8');
      const appel = [
        // La cible est tenue ouverte SANS partage : le renommage final échoue, exactement
        // comme lorsqu'un synchroniseur tient le fichier. Le temporaire, lui, a bien été
        // écrit -- c'est le seul montage qui prouve que le finally fait son travail.
        "  $flux = [System.IO.File]::Open('" + cible.replace(/\\/g, '\\\\') + "', 'Open', 'ReadWrite', 'None')",
        "  try {",
        "    $echec = $false",
        "    try { Write-SzhCheckinCsv -Fichier '" + cible.replace(/\\/g, '\\\\') + "' -Lignes @([pscustomobject]@{ a = '1' }) }",
        "    catch { $echec = $true }",
        "    $sortie['echec'] = $echec",
        "  } finally { $flux.Close() }"
      ].join('\r\n');
      const r = executerPilote(travail, appel);
      assert.ok(r.lu && r.lu.ok, 'le pilote a échoué : ' + JSON.stringify(r.lu) + r.stderr);
      assert.strictEqual(r.lu.echec, true, 'l’écriture aurait dû échouer sur un fichier verrouillé');
      const restes = fs.readdirSync(dossier).filter((n) => n.startsWith('~$'));
      assert.deepStrictEqual(restes, [],
        'un temporaire a été abandonné dans le dossier partagé : ' + restes.join(', '));
      assert.strictEqual(fs.readFileSync(cible, 'utf8'), 'deja la',
        'le fichier d’origine a été abîmé par une écriture ratée');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =====================================================================================
// ---- 3. Le vrai lanceur, en simulation, sur une arborescence jetable ----------------
// =====================================================================================

// Toutes les racines détournées : SZH_BASE (C:\ProgramData\SZH), les deux racines de revues,
// l'ancrage, et les deux variables de profil dont dépendent la découverte du cockpit et le
// balayage automatique de l'ancrage. Rien de ce qui suit n'atteint le vrai OneDrive.
function monterPoste(nom) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-checkin-' + nom + '-'));
  const programData = path.join(travail, 'ProgramData');
  const base = path.join(travail, 'Base');
  const profil = path.join(travail, 'Profil');
  // Un ancrage jetable, reconnaissable : le lanceur le résout par la surcharge d'essai
  // (origine « essai »), sans jamais balayer le disque du poste qui fait tourner ce banc.
  const ancrage = path.join(travail, 'Ancrage', 'Daten_Allgemein - General');
  fs.mkdirSync(path.join(ancrage, '2_Produkte'), { recursive: true });
  fs.mkdirSync(programData, { recursive: true });
  fs.mkdirSync(profil, { recursive: true });
  // Un numéro EN COURS, donc directement sous son dossier produit (arborescence arrêtée
  // le 15.09.2026) : le check-in compte les numéros de la racine active, il doit les
  // trouver là et non sous un niveau de rédaction qui n'existe plus.
  fs.mkdirSync(path.join(base, 'Revue', '2026-01'), { recursive: true });
  fs.writeFileSync(path.join(base, 'Revue', '2026-01', 'ausgabe.yaml'),
    'title: "Numero"\nrevue: "revue"\n', 'utf8');
  fs.writeFileSync(path.join(programData, 'config.json'),
    JSON.stringify({ emplacementRevues: 'test' }), 'utf8');
  fs.mkdirSync(path.join(programData, 'toolkit'), { recursive: true });
  fs.writeFileSync(path.join(programData, 'toolkit', 'VERSION'), '2026.09.1-essai\n', 'utf8');
  return { travail: travail, programData: programData, base: base, profil: profil, ancrage: ancrage };
}

function lancer(poste, racineTest, ancrage) {
  const env = Object.assign({}, process.env, {
    SZH_BASE: poste.programData,
    SZH_LANCEUR_SIMULE: '1',
    SZH_RACINE_TEST: racineTest === undefined ? poste.base : racineTest,
    SZH_RACINE_PROD: path.join(poste.travail, 'BaseProd'),
    SZH_ANCRAGE: ancrage === undefined ? poste.ancrage : ancrage,
    LOCALAPPDATA: path.join(poste.profil, 'AppData', 'Local'),
    USERPROFILE: poste.profil
  });
  return spawnSync(POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', LANCEUR_PS1],
    { encoding: 'utf8', env: env, windowsHide: true, timeout: 180000 });
}

function journal(poste) {
  const dossier = path.join(poste.programData, 'logs');
  if (!fs.existsSync(dossier)) { return ''; }
  return fs.readdirSync(dossier)
    .map((n) => String(fs.readFileSync(path.join(dossier, n), 'utf8')).replace(/^\uFEFF/, ''))
    .join('\n');
}

test('le lanceur dépose un CSV nommé du seul nom du poste, et le rafraîchit',
  { skip: sansPowerShell }, () => {
    const poste = monterPoste('lanceur');
    try {
      const un = lancer(poste);
      assert.strictEqual(un.status, 0, 'le lanceur a échoué : ' + un.stderr);

      // TOUJOURS sur SharePoint (l'ancrage), jamais sous poste.base (la racine active) :
      // c'est tout l'objet du correctif du 23.09.2026.
      const inventaire = path.join(poste.ancrage, '2_Produkte', SEGMENT_APPLICATION,
        '_Systeme', 'inventaire');
      const fichiers = fs.readdirSync(inventaire);
      assert.strictEqual(fichiers.length, 1, 'le dossier d’inventaire contient ' + fichiers.join(', '));
      const nom = fichiers[0];
      // Le nom ne porte QUE le nom de la machine : pas de compte, pas d'adresse, pas de date.
      assert.strictEqual(nom, process.env.COMPUTERNAME + '.csv',
        'le nom du fichier ne devrait porter que le nom du poste : ' + nom);

      const csv = lireCsv(path.join(inventaire, nom));
      assert.ok(csv.avecBom, 'le CSV du lanceur n’a pas de BOM UTF-8');
      assert.deepStrictEqual(csv.entete, COLONNES, 'l’en-tête du check-in a changé');
      assert.strictEqual(csv.corps.length, 1, 'un seul lancement devrait donner une seule ligne');

      const ligne = {};
      csv.entete.forEach((c, i) => { ligne[c] = csv.corps[0][i]; });
      assert.match(ligne['Horodatage'], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      assert.match(ligne['Mois'], /^\d{4}-\d{2}$/);
      assert.strictEqual(ligne['Mois'], ligne['Horodatage'].slice(0, 7));
      assert.strictEqual(ligne['Poste'], process.env.COMPUTERNAME);
      assert.ok(ligne['Compte Windows'], 'le compte Windows manque');
      assert.match(ligne['SID du compte'], /^S-1-/, 'l’identifiant de sécurité manque');
      assert.strictEqual(ligne['Dossier personnel'], poste.profil);
      assert.ok(ligne['PowerShell'], 'la version de PowerShell manque');
      assert.strictEqual(ligne['Version du toolkit'], '2026.09.1-essai');
      assert.strictEqual(ligne['Emplacement'], 'test');
      assert.strictEqual(ligne['Origine de l\'ancrage'], 'essai');
      assert.ok(ligne['Système'], 'la version du système manque');
      assert.ok(['enregistree', 'absente', ''].indexOf(ligne['Machine virtuelle']) !== -1,
        'état de machine virtuelle inattendu : ' + ligne['Machine virtuelle']);
      // L'adresse peut être vide — c'est tout l'objet du repli silencieux — mais la ligne,
      // elle, doit être complète dans tous les cas.
      assert.strictEqual(csv.corps[0].length, COLONNES.length,
        'une ligne incomplète a été écrite');

      // Deuxième lancement, même mois, même compte : la ligne est RÉÉCRITE, pas ajoutée.
      const deux = lancer(poste);
      assert.strictEqual(deux.status, 0, 'le deuxième lancement a échoué : ' + deux.stderr);
      const csv2 = lireCsv(path.join(inventaire, nom));
      assert.strictEqual(csv2.corps.length, 1,
        'un deuxième lancement dans le même mois a ajouté une ligne au lieu de la rafraîchir');
      assert.deepStrictEqual(csv2.entete, COLONNES);
      assert.ok(csv2.corps[0][0] >= csv.corps[0][0],
        'l’horodatage n’a pas été rafraîchi : ' + csv2.corps[0][0] + ' < ' + csv.corps[0][0]);
      // Et aucun temporaire n'est resté derrière, deux écritures plus tard.
      assert.deepStrictEqual(fs.readdirSync(inventaire).filter((n) => n.startsWith('~$')), []);
    } finally {
      fs.rmSync(poste.travail, { recursive: true, force: true });
    }
  });

test('un ancrage SharePoint introuvable ne fait pas échouer le lanceur',
  { skip: sansPowerShell }, () => {
    const poste = monterPoste('injoignable');
    try {
      // L'inventaire vient TOUJOURS de l'ancrage (Get-SzhDossierSysteme), jamais de la
      // racine active : c'est donc l'ancrage qu'il faut rendre introuvable ici, pas la
      // racine de test (qui, elle, reste valide — OneDrive non synchronisé côté SharePoint
      // seulement, portable hors réseau, ancrage jamais rattaché).
      const ancrageAbsent = path.join(poste.travail, 'Ancrage-Absente', 'encore-plus-loin');
      const run = lancer(poste, undefined, ancrageAbsent);
      assert.strictEqual(run.status, 0,
        'le lanceur a échoué alors que seul l’inventaire était impossible : ' + run.stderr);
      const json = JSON.parse(String(run.stdout || '').replace(/^﻿/, ''));
      assert.ok(json && json.produit, 'le lanceur n’a pas produit son état : ' + run.stdout);
      assert.match(journal(poste), /check-in : dossier partage introuvable/,
        'le journal ne dit pas que le check-in a été sauté');
      // Et surtout : rien n'a été fabriqué ailleurs pour compenser, ni sous le véritable
      // ancrage du poste (jamais visé par SZH_ANCRAGE ici) ni sous la racine de test.
      assert.ok(!fs.existsSync(path.join(poste.ancrage, '2_Produkte', SEGMENT_APPLICATION, '_Systeme')),
        'un faux arbre a été créé sous l’ancrage');
      assert.ok(!fs.existsSync(path.join(poste.base, '_Systeme')),
        'un faux arbre a été créé sous la racine active');
    } finally {
      fs.rmSync(poste.travail, { recursive: true, force: true });
    }
  });
