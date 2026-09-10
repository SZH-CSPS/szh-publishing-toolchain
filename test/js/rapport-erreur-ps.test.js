// Parité entre l'écrivain PowerShell des rapports d'erreur (windows/szh-rapport.ps1) et
// l'écrivain JS (vscodium-extension/szh-cockpit/lib/rapport-erreur.js + lib/codes-erreur.js).
// Les deux moteurs doivent produire, pour un même incident, un JSON structurellement
// identique -- même masquage, même signature (l'anti-inondation partagée, dans
// etat-utilisateur.json, en dépend directement), même format d'id, mêmes plafonds.
//
//   node --test test/js/rapport-erreur-ps.test.js
//   node --test "test/js/*.test.js"
//
// Défaut réel que ce fichier garde : la parité de calcul entre deux langages qui ne
// s'exécutent jamais ensemble (PowerShell 5.1 côté lanceur, Node côté cockpit) ne se
// remarque qu'au moment où l'anti-inondation partagée (etat-utilisateur.json, clé
// "rapports") se met à diverger en silence -- un rapport que l'un des deux écrivains
// laisserait passer alors que l'autre l'étoufferait, ou deux signatures différentes pour un
// même incident qui empêcheraient tout regroupement. La technique (extraction du corps de
// fonction depuis le vrai .ps1, pilote généré, spawnSync('powershell.exe', ...), pilote
// écrit avec BOM UTF-8) reprend test/js/courriel-support.test.js, seul autre banc du dépôt à
// éprouver deux moteurs indépendants sur la même sortie.
//
// Aucun test ici ne touche le vrai C:\ProgramData\SZH, le vrai %LOCALAPPDATA%\SZH ni le vrai
// dossier SharePoint : SZH_BASE, LOCALAPPDATA, USERPROFILE, SZH_ANCRAGE, SZH_RAPPORTS et
// SZH_LANCEUR_SIMULE sont systématiquement redirigés vers des dossiers jetables
// (fs.mkdtempSync), aussi bien pour les appels PowerShell spawnés que pour les appels directs
// à lib/rapport-erreur.js dans CE processus Node (chaque fichier de `node --test` tourne dans
// son propre processus : modifier process.env ici ne fuit pas vers les autres fichiers).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const SOURCE_RAPPORT_PATH = path.join(RACINE, 'windows', 'szh-rapport.ps1');
const SOURCE_ANCRAGE_PATH = path.join(RACINE, 'windows', 'szh-ancrage.ps1');
const SZH_COMMUN_PATH = path.join(RACINE, 'windows', 'szh-common.ps1');
const SOURCE_RAPPORT = fs.readFileSync(SOURCE_RAPPORT_PATH, 'utf8');

const codesErreur = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'codes-erreur'));
const rapportErreurJs = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'rapport-erreur'));

// ---------------------------------------------------------------------------------------
// PowerShell disponible ? (même détection que partout ailleurs dans le dépôt)
// ---------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------
// Le corps d'une fonction PowerShell, du vrai fichier -- même technique que
// test/js/courriel-support.test.js et test/js/orphelins-toolkit.test.js : de sa ligne de
// déclaration jusqu'à la première ligne qui n'est QUE "}" en colonne 0. windows/szh-rapport.ps1
// est écrit en LF (pas CRLF) : on découpe sur les deux, on rejoint toujours en CRLF (ce que
// PowerShell 5.1 préfère dans un script sur disque).
// ---------------------------------------------------------------------------------------
function corpsFonction(source, nom) {
  const lignes = source.split(/\r\n|\n/);
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

// Sans BOM sous PowerShell 5.1, un .ps1 SANS ce préfixe se relit avec la page de code ANSI
// du poste, pas en UTF-8 (même précaution que courriel-support.test.js / orphelins-toolkit).
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\ufeff' + contenu, 'utf8');
}

// Échappement PowerShell dans une chaîne SIMPLE-quote : double ' (U+0027) ET les guillemets
// typographiques de la même famille (U+2018/2019/201A/201B) que PowerShell 5.1 traite comme
// des délimiteurs interchangeables -- vérifié À L'EXÉCUTION en écrivant ce lot (un ' seul,
// non doublé, ferme la chaîne et casse le script avec « Le terminateur ' est manquant » ;
// même mécanisme, même remède, que les 35 occurrences déjà en place dans
// windows/szh-textes.ps1 -- voir le commentaire au sommet de Get-SzhRapportResume).
function psChaine(v) {
  if (v === null || v === undefined) { return '$null'; }
  return "'" + String(v).replace(/['\u2018\u2019\u201A\u201B]/g, (m) => m + m) + "'";
}
function psHashtable(obj) {
  if (!obj) { return '$null'; }
  return '@{ ' + Object.keys(obj).map((k) => k + ' = ' + psChaine(obj[k])).join('; ') + ' }';
}
function psTableauFichiers(liste) {
  if (!liste || liste.length === 0) { return '@()'; }
  return '@(' + liste.map((f) => psHashtable(f)).join(', ') + ')';
}

// ---------------------------------------------------------------------------------------
// Exécute un jeu de fonctions PURES (extraites telles quelles du vrai fichier, aucune
// dépendance à szh-common.ps1) suivi d'un appel qui peuple $sortie -- même schéma que
// executerGetSzhCourriel dans courriel-support.test.js.
// ---------------------------------------------------------------------------------------
function executerFonctionsPures(travail, fonctions, appel) {
  const corps = fonctions.map((nom) => corpsFonction(SOURCE_RAPPORT, nom)).join('\r\n\r\n');
  const pilote = [
    "$ErrorActionPreference = 'Stop'",
    corps,
    '$sortie = [ordered]@{ ok = $true }',
    'try {',
    '  ' + appel,
    '} catch {',
    '  $sortie = [ordered]@{ ok = $false; erreur = $_.Exception.Message }',
    '}',
    '[System.IO.File]::WriteAllText($args[0], ($sortie | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))'
  ].join('\r\n') + '\r\n';
  const pPilote = path.join(travail, 'pilote-' + Math.random().toString(16).slice(2) + '.ps1');
  const pSortie = pPilote + '.sortie.json';
  ecrirePs1(pPilote, pilote);
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pPilote, pSortie],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.ok(run.status === 0 && fs.existsSync(pSortie), 'le pilote PowerShell a échoué : ' + run.stderr + ' / ' + run.stdout);
  return JSON.parse(fs.readFileSync(pSortie, 'utf8'));
}

// ---------------------------------------------------------------------------------------
// Exécute un script qui dot-source le VRAI szh-common.ps1 (donc szh-rapport.ps1 avec lui) et
// lance le code donné, avec les variables d'environnement isolées passées en overrides.
// Rend { status, stdout, stderr }. Jamais de fenêtre : aucun des scénarios ci-dessous ne
// passe par -Versions ni par SZH_LANCEUR_SIMULE=1 sauf quand le test l'exige explicitement --
// et Write-SzhRapport/Clear-SzhRapportsEnAttente n'ouvrent de toute façon jamais de WinForms.
// ---------------------------------------------------------------------------------------
function executerAvecSzhCommun(travail, overrides, script) {
  const pilote = [
    "$ErrorActionPreference = 'Stop'",
    '. ' + psChaine(SZH_COMMUN_PATH),
    script
  ].join('\r\n') + '\r\n';
  const pPilote = path.join(travail, 'pilote-commun-' + Math.random().toString(16).slice(2) + '.ps1');
  ecrirePs1(pPilote, pilote);
  const env = Object.assign({}, process.env);
  delete env.OneDrive;
  delete env.OneDriveCommercial;
  delete env.SZH_ANCRAGE;
  delete env.SZH_RAPPORTS;
  delete env.SZH_LANCEUR_SIMULE;
  delete env.SZH_OPENMD_SIMULE;
  Object.assign(env, overrides || {});
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pPilote],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, env });
  return { status: run.status, stdout: run.stdout || '', stderr: run.stderr || '' };
}

// Un dossier jetable par test (jamais le vrai ProgramData / LOCALAPPDATA / SharePoint).
function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}

function environnementIsole(travail, extra) {
  const base = {
    SZH_BASE: path.join(travail, 'programdata'),
    LOCALAPPDATA: path.join(travail, 'localappdata'),
    USERPROFILE: path.join(travail, 'profil')
  };
  fs.mkdirSync(base.SZH_BASE, { recursive: true });
  fs.mkdirSync(base.LOCALAPPDATA, { recursive: true });
  fs.mkdirSync(base.USERPROFILE, { recursive: true });
  return Object.assign(base, extra || {});
}

// Un seul fichier .json dans un dossier -- le lit et le rend parsé. Échoue si ce n'est pas
// exactement un.
function lireUniqueRapport(dossier) {
  const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.json'));
  assert.strictEqual(fichiers.length, 1, 'attendu exactement un rapport dans ' + dossier + ', trouvé : ' + JSON.stringify(fichiers));
  const chemin = path.join(dossier, fichiers[0]);
  const octets = fs.readFileSync(chemin);
  const texte = fs.readFileSync(chemin, 'utf8');
  return { chemin, octets, texte, json: JSON.parse(texte) };
}

// =========================================================================================
// 1. Masquage identique sur des entrées adverses (règles 1 à 6, y compris 5a/5b amendées)
// =========================================================================================

const RACINES_ESSAI = {
  ancrage: 'C:\\Faux\\Ancrage\\Daten_Allgemein - General',
  userProfile: 'C:\\Users\\FauxUtilisateur',
  programData: 'C:\\ProgramData\\SZH'
};

const LIGNES_ADVERSES = [
  'chemin sous l\u2019ancrage : C:\\Faux\\Ancrage\\Daten_Allgemein - General\\2_Produkte\\52_Revue\\x.md',
  'chemin sous %USERPROFILE% : C:\\Users\\FauxUtilisateur\\Bureau\\notes.txt',
  'chemin sous ProgramData : C:\\ProgramData\\SZH\\logs\\szh-2026-09.log',
  'token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123ghi',
  'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sigfinale',
  'api_key=ABCdef1234567890GHIJklmnop0099',
  'password: MotDePasseSecret123',
  'token: absent \u2014 configuration OJS non remplie',
  'courriel jean.dupont@example.com et support robin.morand@szh.ch',
  'empreinte SHA-1 0123456789abcdef0123456789abcdef01234567',
  'guid 3fa85f64-5717-4562-b3fc-2c963f66afa6',
  'chemin relatif 2_Produkte/52_Revue/RV02_Redaction/2027-02/articles/03-inclusion/03-inclusion.md',
  'make: *** [Makefile:142: out/2027-02/articles/03-inclusion-scolaire.pdf] Error 1',
  'url https://www.szh-csps.ch/revue/2027-02/inclusion-scolaire-participation-sociale',
  'slug seul 03-inclusion-scolaire-participation',
  'rien de particulier ici, juste du texte français avec des accents éàü'
];

test('Protect-SzhRapportTexte (PowerShell) masque les entrées adverses exactement comme codesErreur.masquer (JS)',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-masquage-');
    try {
      for (const ligne of LIGNES_ADVERSES) {
        const attendu = codesErreur.masquer(ligne, RACINES_ESSAI);
        const appel = '$sortie.resultat = Protect-SzhRapportTexte -Texte ' + psChaine(ligne) +
          ' -Racines ' + psHashtable(RACINES_ESSAI);
        const resultat = executerFonctionsPures(travail, ['Protect-SzhRapportTexte'], appel);
        assert.equal(resultat.ok, true, 'Protect-SzhRapportTexte a levé sur : ' + ligne + ' -> ' + resultat.erreur);
        assert.equal(resultat.resultat, attendu, 'divergence de masquage sur : ' + JSON.stringify(ligne));
      }
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Ce que le masquage ne doit jamais toucher (chemin, hex, GUID, URL, slug) : identique des deux côtés, et effectivement intact',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-masquage-intact-');
    try {
      const casIntacts = [
        '2_Produkte/52_Revue/RV02_Redaction/2027-02/articles/03-inclusion/03-inclusion.md',
        '0123456789abcdef0123456789abcdef01234567',
        '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        'https://www.szh-csps.ch/revue/2027-02/inclusion-scolaire-participation-sociale',
        '03-inclusion-scolaire-participation'
      ];
      for (const ligne of casIntacts) {
        const attendu = codesErreur.masquer(ligne, {});
        assert.equal(attendu, ligne, 'JS a modifié une ligne censée rester intacte : ' + ligne);
        const appel = '$sortie.resultat = Protect-SzhRapportTexte -Texte ' + psChaine(ligne) + ' -Racines @{}';
        const resultat = executerFonctionsPures(travail, ['Protect-SzhRapportTexte'], appel);
        assert.equal(resultat.ok, true, resultat.erreur);
        assert.equal(resultat.resultat, ligne, 'PowerShell a modifié une ligne censée rester intacte : ' + ligne);
      }
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 2. Signature identique -- LE test le plus important : deux hachages qui divergent font
//    diverger l'anti-inondation partagée entre les deux écrivains.
// =========================================================================================

const CAS_SIGNATURE = [
  { source: 'lanceur', code: 'LANCEUR-TRAP', etape: 'ouverture du lanceur', messageMasque: 'Erreur X', produitNumero: '2027-02' },
  { source: 'maj', code: 'MAJ-ECHEC', etape: null, messageMasque: '', produitNumero: null },
  { source: 'archivage', code: 'ARCHIVAGE-ECHEC', etape: 'déplacement', messageMasque: 'a'.repeat(500), produitNumero: '2020-05' },
  { source: '', code: '', etape: '', messageMasque: '', produitNumero: '' },
  { source: 'lanceur', code: 'ANCRAGE-INTROUVABLE', etape: undefined, messageMasque: undefined, produitNumero: undefined }
];

test('Get-SzhRapportSignature (PowerShell) rend le même hachage que codesErreur.calculerSignature (JS)',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-signature-');
    try {
      for (const cas of CAS_SIGNATURE) {
        const attendu = codesErreur.calculerSignature(cas);
        const params = ['Source', 'Code', 'Etape', 'MessageMasque', 'ProduitNumero'];
        const args = params.map((p) => {
          const cle = p === 'MessageMasque' ? 'messageMasque' : p === 'ProduitNumero' ? 'produitNumero' : p.toLowerCase();
          const v = cas[cle];
          return '-' + p + ' ' + psChaine(v === undefined ? '' : v);
        }).join(' ');
        const appel = '$sortie.resultat = Get-SzhRapportSignature ' + args;
        const resultat = executerFonctionsPures(travail, ['Get-SzhRapportSignature'], appel);
        assert.equal(resultat.ok, true, resultat.erreur);
        assert.equal(resultat.resultat, attendu, 'signature divergente pour ' + JSON.stringify(cas));
        assert.match(resultat.resultat, /^[0-9a-f]{12}$/, 'la signature doit être 12 hex : ' + resultat.resultat);
      }
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 3. Format de l'id -- identique (D9 : fondé sur l'UTC), byte pour byte pour les mêmes
//    horodatage/poste/hex (calculerId est une fonction pure côté JS).
// =========================================================================================

test('Get-SzhRapportId (PowerShell) et codesErreur.calculerId (JS) rendent le même id pour les mêmes horodatage/poste/hex',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-id-');
    try {
      const cas = [
        { horodatage: '2026-09-09T08:15:30.000Z', poste: 'ROBIN-PC', hex: 'a1b2c3' },
        { horodatage: '2026-01-01T00:00:00.000Z', poste: 'Poste-Été-Zürich', hex: '000000' },
        { horodatage: '2026-12-31T23:59:59.999Z', poste: '', hex: 'ffffff' }
      ];
      for (const c of cas) {
        const attendu = codesErreur.calculerId(new Date(c.horodatage), c.poste, c.hex);
        const appel = '$sortie.resultat = Get-SzhRapportId -Horodatage ' + psChaine(c.horodatage) +
          ' -Poste ' + psChaine(c.poste) + ' -AleatoireHex ' + psChaine(c.hex);
        const resultat = executerFonctionsPures(travail, ['Get-SzhRapportId'], appel);
        assert.equal(resultat.ok, true, resultat.erreur);
        assert.equal(resultat.resultat, attendu, 'id divergent pour ' + JSON.stringify(c));
      }
      // L'exemple même du schéma v1 (docs/RAPPORTS-ERREUR.md §2).
      const exemple = codesErreur.calculerId(new Date('2026-09-09T08:15:30Z'), 'ROBIN-PC', 'a1b2c3');
      assert.equal(exemple, '20260909-081530-ROBIN-PC-a1b2c3');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 4. La faute de frappe du dossier -- reproduite à l'identique, dérivée de l'ancrage des
//    deux côtés (jamais un chemin absolu en dur).
// =========================================================================================

test('Get-SzhDossierRapportsDepuisAncrage (PowerShell, szh-ancrage.ps1) == dossierRapportsDepuisAncrage (JS) pour le même ancrage',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-dossier-');
    try {
      const ancrage = 'C:\\Un\\Faux\\Ancrage\\Daten_Allgemein - General';
      const attendu = rapportErreurJs.dossierRapportsDepuisAncrage(ancrage);
      assert.match(attendu, /_AutoReportToolboxZeitscrhiften$/, 'la faute de frappe a disparu côté JS !');

      // Dot-source du VRAI szh-ancrage.ps1 (pas une extraction de fonction) : cette fonction
      // dérive son résultat de $script:SzhDeriveDossierRapports, une CONSTANTE définie au
      // sommet du fichier -- une extraction isolée du seul corps de fonction (comme ailleurs
      // dans ce fichier) la laisserait $null et romprait silencieusement la dérivation
      // (constaté : Join-Path avec un second argument $null rend juste l'ancrage, sans la
      // moindre erreur). szh-ancrage.ps1 ne fait que définir des fonctions/variables, jamais
      // de fenêtre ni d'effet de bord au chargement -- le dot-sourcer seul est sûr.
      const pilote = [
        "$ErrorActionPreference = 'Stop'",
        '. ' + psChaine(SOURCE_ANCRAGE_PATH),
        '$sortie = [ordered]@{ ok = $true }',
        'try { $sortie.resultat = Get-SzhDossierRapportsDepuisAncrage ' + psChaine(ancrage) + ' } catch { $sortie = [ordered]@{ ok = $false; erreur = $_.Exception.Message } }',
        '[System.IO.File]::WriteAllText($args[0], ($sortie | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))'
      ].join('\r\n') + '\r\n';
      const pPilote = path.join(travail, 'pilote.ps1');
      const pSortie = path.join(travail, 'sortie.json');
      ecrirePs1(pPilote, pilote);
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pPilote, pSortie],
        { encoding: 'utf8', windowsHide: true, timeout: 30000 });
      assert.ok(run.status === 0 && fs.existsSync(pSortie), run.stderr);
      const resultat = JSON.parse(fs.readFileSync(pSortie, 'utf8'));
      assert.equal(resultat.ok, true, resultat.erreur);
      assert.match(resultat.resultat, /_AutoReportToolboxZeitscrhiften$/, 'la faute de frappe a disparu côté PowerShell !');
      assert.equal(resultat.resultat, attendu, 'le dossier de rapports dérivé diverge entre PowerShell et JS');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 5. Parité JSON complète pour UN MÊME incident (schéma v1, clé par clé) -- champs volatils
//    (id, horodatage, horodatageLocal, poste, versions) neutralisés ; tout le reste doit
//    coïncider EXACTEMENT.
// =========================================================================================

test('Write-SzhRapport (PowerShell) et emettreRapport (JS) produisent, pour un même incident, un JSON identique champ par champ (hors champs volatils)',
  { skip: sansPowerShell }, () => {
    const travailPs = dossierJetable('szh-rapport-incident-ps-');
    const travailJs = dossierJetable('szh-rapport-incident-js-');
    const ancienEnv = Object.assign({}, process.env);
    try {
      // Racine utilisateur FICTIVE, commune aux deux moteurs (juste une chaîne de
      // comparaison pour le masquage -- n'a pas besoin d'exister sur le disque) : le message,
      // la pile et le fichier concerné y font tous les trois référence, pour que le masquage
      // "~\..." produise EXACTEMENT le même résultat des deux côtés sans dépendre d'un
      // ancrage SharePoint réel ou partagé entre les deux dossiers jetables.
      const FAUX_USERPROFILE = 'C:\\Users\\FauxIncident';
      const cheminFichier = FAUX_USERPROFILE + '\\Bureau\\52_Revue\\2020-05\\articles\\03-x\\03-x.md';
      const message = 'Erreur : token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig ; chemin ' +
        cheminFichier + ' ; contact jean.dupont@example.com';
      const pile = 'at fabriquerPdf (' + cheminFichier + ':12)\nat main';

      const champsCommuns = {
        code: 'ARCHIVAGE-ECHEC',
        source: 'archivage',
        gravite: 'erreur',
        etape: 'déplacement vers les archives',
        message: message,
        pile: pile,
        produit: { type: 'revue', numero: '2020-05', emplacement: 'production' }
      };

      // ---- Côté JS : appel direct de emettreRapport, dans CE processus Node -------------
      process.env.SZH_BASE = path.join(travailJs, 'programdata');
      process.env.LOCALAPPDATA = path.join(travailJs, 'localappdata');
      process.env.USERPROFILE = FAUX_USERPROFILE;
      process.env.SZH_RAPPORTS = path.join(travailJs, 'rapports');
      delete process.env.SZH_ANCRAGE;
      fs.mkdirSync(process.env.SZH_BASE, { recursive: true });
      fs.mkdirSync(process.env.LOCALAPPDATA, { recursive: true });
      fs.mkdirSync(process.env.SZH_RAPPORTS, { recursive: true });

      const resultatJs = rapportErreurJs.emettreRapport(Object.assign({}, champsCommuns, {
        fichiers: [{ chemin: cheminFichier, role: 'article' }]
      }));
      assert.equal(resultatJs.ecrit, true, 'emettreRapport (JS) n\'a pas écrit : ' + JSON.stringify(resultatJs));
      const rJs = lireUniqueRapport(process.env.SZH_RAPPORTS).json;

      // ---- Côté PowerShell : Write-SzhRapport via le vrai szh-common.ps1 ----------------
      const envPs = environnementIsole(travailPs, {
        USERPROFILE: FAUX_USERPROFILE,
        SZH_RAPPORTS: path.join(travailPs, 'rapports')
      });
      fs.mkdirSync(envPs.SZH_RAPPORTS, { recursive: true });
      const scriptPs = 'Write-SzhRapport -Code ' + psChaine(champsCommuns.code) +
        ' -Source ' + psChaine(champsCommuns.source) +
        ' -Gravite ' + psChaine(champsCommuns.gravite) +
        ' -Etape ' + psChaine(champsCommuns.etape) +
        ' -Message ' + psChaine(champsCommuns.message) +
        ' -Pile ' + psChaine(champsCommuns.pile) +
        ' -Produit ' + psHashtable(champsCommuns.produit) +
        ' -Fichiers ' + psTableauFichiers([{ chemin: cheminFichier, role: 'article' }]);
      const runPs = executerAvecSzhCommun(travailPs, envPs, scriptPs);
      assert.equal(runPs.status, 0, 'le pilote PowerShell a échoué : ' + runPs.stderr + ' / ' + runPs.stdout);
      const rPs = lireUniqueRapport(envPs.SZH_RAPPORTS).json;

      // ---- Comparaison champ par champ ---------------------------------------------------
      assert.equal(rPs.schema, rJs.schema);
      assert.equal(rPs.gravite, rJs.gravite);
      assert.equal(rPs.source, rJs.source);
      assert.equal(rPs.code, rJs.code);
      assert.equal(rPs.signature, rJs.signature, 'LA SIGNATURE DIVERGE -- l\'anti-inondation partagée casserait en silence');
      assert.deepEqual(rPs.resume, rJs.resume);
      assert.equal(rPs.etape, rJs.etape);
      assert.equal(rPs.message, rJs.message, 'le message masqué diverge');
      assert.equal(rPs.pile, rJs.pile, 'la pile masquée diverge');
      assert.deepEqual(rPs.produit, rJs.produit);
      assert.deepEqual(rPs.ancrage, rJs.ancrage, 'ni l\'un ni l\'autre ne devrait trouver d\'ancrage ici');
      assert.equal(rPs.ancrage.trouve, false);
      assert.deepEqual(rPs.fichiers, rJs.fichiers, 'le fichier concerné (masqué en ~\\...) diverge');
      assert.equal(rPs.fichiers[0].chemin, '~\\Bureau\\52_Revue\\2020-05\\articles\\03-x\\03-x.md');
      assert.deepEqual(rPs.journal, rJs.journal);
      assert.deepEqual(rPs.constats, rJs.constats);
      assert.deepEqual(rPs.environnement, rJs.environnement);

      // Champs volatils : forme vérifiée, pas l'égalité de valeur.
      for (const r of [rPs, rJs]) {
        assert.match(r.id, /^\d{8}-\d{6}-[A-Za-z0-9-]+-[0-9a-f]{6}$/);
        assert.match(r.horodatage, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
        assert.match(r.horodatageLocal, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
        assert.ok(r.poste && typeof r.poste === 'object');
        assert.ok(r.versions && typeof r.versions === 'object');
      }
      // poste.powershell : null côté cockpit, renseigné côté lanceur (exigence explicite).
      assert.equal(rJs.poste.powershell, null);
      assert.ok(rPs.poste.powershell, 'poste.powershell doit être renseigné côté PowerShell');
    } finally {
      for (const k of Object.keys(process.env)) { delete process.env[k]; }
      Object.assign(process.env, ancienEnv);
      fs.rmSync(travailPs, { recursive: true, force: true });
      fs.rmSync(travailJs, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 6. D10 -- SZH_RAPPORTS (dossier direct) et SZH_ANCRAGE (ancrage) sont orthogonales, des
//    deux côtés. Ici : le côté PowerShell seul (l'orthogonalité côté JS est du ressort de
//    test/js/rapport-erreur.test.js, hors de mon périmètre).
// =========================================================================================

test('D10 : SZH_RAPPORTS seul -- le rapport atterrit directement dedans, ancrage.trouve = false',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-d10-rapports-');
    try {
      const env = environnementIsole(travail, { SZH_RAPPORTS: path.join(travail, 'rapports') });
      fs.mkdirSync(env.SZH_RAPPORTS, { recursive: true });
      const run = executerAvecSzhCommun(travail, env,
        'Write-SzhRapport -Code ' + psChaine('LANCEUR-TRAP') + ' -Source ' + psChaine('lanceur') + ' -Message ' + psChaine('essai'));
      assert.equal(run.status, 0, run.stderr);
      const r = lireUniqueRapport(env.SZH_RAPPORTS).json;
      assert.equal(r.ancrage.trouve, false);
      assert.equal(r.ancrage.origine, 'absent');
      assert.equal(r.ancrage.chemin, null);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('D10 : SZH_ANCRAGE seul (pas de SZH_RAPPORTS) -- dérivation habituelle sous <ancrage>\\2_Produkte\\...',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-d10-ancrage-');
    try {
      const ancrage = path.join(travail, 'Daten_Allgemein - General');
      fs.mkdirSync(path.join(ancrage, '2_Produkte'), { recursive: true });
      const env = environnementIsole(travail, { SZH_ANCRAGE: ancrage });
      const run = executerAvecSzhCommun(travail, env,
        'Write-SzhRapport -Code ' + psChaine('LANCEUR-TRAP') + ' -Source ' + psChaine('lanceur') + ' -Message ' + psChaine('essai'));
      assert.equal(run.status, 0, run.stderr);
      const dossierAttendu = rapportErreurJs.dossierRapportsDepuisAncrage(ancrage);
      assert.ok(fs.existsSync(dossierAttendu), 'le rapport n\'est pas sous le dossier dérivé de l\'ancrage : ' + dossierAttendu);
      const r = lireUniqueRapport(dossierAttendu).json;
      assert.equal(r.ancrage.trouve, true);
      assert.equal(r.ancrage.origine, 'essai');
      assert.equal(r.ancrage.chemin, ancrage);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('D10 : SZH_RAPPORTS ET SZH_ANCRAGE ensemble -- SZH_RAPPORTS gagne pour l\'écriture, le champ "ancrage" garde SZH_ANCRAGE',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-d10-combine-');
    try {
      const ancrage = path.join(travail, 'Daten_Allgemein - General');
      fs.mkdirSync(path.join(ancrage, '2_Produkte'), { recursive: true });
      const dossierRapportsDirect = path.join(travail, 'rapports-directs');
      fs.mkdirSync(dossierRapportsDirect, { recursive: true });
      const env = environnementIsole(travail, { SZH_ANCRAGE: ancrage, SZH_RAPPORTS: dossierRapportsDirect });
      const run = executerAvecSzhCommun(travail, env,
        'Write-SzhRapport -Code ' + psChaine('LANCEUR-TRAP') + ' -Source ' + psChaine('lanceur') + ' -Message ' + psChaine('essai'));
      assert.equal(run.status, 0, run.stderr);

      const dossierDerive = rapportErreurJs.dossierRapportsDepuisAncrage(ancrage);
      assert.ok(!fs.existsSync(dossierDerive) || fs.readdirSync(dossierDerive).length === 0,
        'le rapport n\'aurait pas dû atterrir sous le dossier dérivé de l\'ancrage quand SZH_RAPPORTS est posée');
      const r = lireUniqueRapport(dossierRapportsDirect).json;
      assert.equal(r.ancrage.trouve, true, 'le champ ancrage doit rester celui résolu par SZH_ANCRAGE');
      assert.equal(r.ancrage.origine, 'essai');
      assert.equal(r.ancrage.chemin, ancrage);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 7. Anti-inondation (§4.3, D6 : jour calendaire LOCAL) -- décision pure, puis vérification
//    de bout en bout que Write-SzhRapport l'applique réellement.
// =========================================================================================

test('Get-SzhRapportDecisionAntiInondation : une signature revue avant 24 h est étouffée, ne compte pas dans le plafond du jour',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-antiinond-');
    try {
      const appel = [
        '$rapports = @{}',
        '$rapports[\'abc123def456\'] = (Get-Date).ToUniversalTime().AddHours(-1).ToString(\'yyyy-MM-ddTHH:mm:ss.fffZ\')',
        '$maintenant = Get-Date',
        '$decision = Get-SzhRapportDecisionAntiInondation -Rapports $rapports -Signature \'abc123def456\' -MaintenantLocal $maintenant -MaintenantUtc $maintenant.ToUniversalTime()',
        '$sortie.autorise = $decision.autorise',
        '$sortie.motif = $decision.motif',
        '$sortie.compte = $decision.rapports._compte'
      ].join('\r\n');
      const resultat = executerFonctionsPures(travail, ['Get-SzhRapportDecisionAntiInondation'], appel);
      assert.equal(resultat.ok, true, resultat.erreur);
      assert.equal(resultat.autorise, false);
      assert.equal(resultat.motif, 'signature-recente');
      assert.equal(resultat.compte, 0, 'une signature étouffée ne doit pas incrémenter le compteur du jour');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Get-SzhRapportDecisionAntiInondation : 20 rapports déjà comptés aujourd\'hui étouffe une NOUVELLE signature (plafond-jour)',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-antiinond-plafond-');
    try {
      const appel = [
        '$jour = (Get-Date).ToString(\'yyyy-MM-dd\')',
        '$rapports = @{ _jour = $jour; _compte = 20 }',
        '$maintenant = Get-Date',
        '$decision = Get-SzhRapportDecisionAntiInondation -Rapports $rapports -Signature \'signature-neuve00\' -MaintenantLocal $maintenant -MaintenantUtc $maintenant.ToUniversalTime()',
        '$sortie.autorise = $decision.autorise',
        '$sortie.motif = $decision.motif'
      ].join('\r\n');
      const resultat = executerFonctionsPures(travail, ['Get-SzhRapportDecisionAntiInondation'], appel);
      assert.equal(resultat.ok, true, resultat.erreur);
      assert.equal(resultat.autorise, false);
      assert.equal(resultat.motif, 'plafond-jour');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Get-SzhRapportDecisionAntiInondation : purge les entrées de plus de 7 jours',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-antiinond-purge-');
    try {
      const appel = [
        '$rapports = @{}',
        '$rapports[\'vieille0000000\'] = (Get-Date).ToUniversalTime().AddDays(-10).ToString(\'yyyy-MM-ddTHH:mm:ss.fffZ\')',
        '$maintenant = Get-Date',
        '$decision = Get-SzhRapportDecisionAntiInondation -Rapports $rapports -Signature \'signature-neuve01\' -MaintenantLocal $maintenant -MaintenantUtc $maintenant.ToUniversalTime()',
        '$sortie.contientVieille = $decision.rapports.Contains(\'vieille0000000\')',
        '$sortie.autorise = $decision.autorise'
      ].join('\r\n');
      const resultat = executerFonctionsPures(travail, ['Get-SzhRapportDecisionAntiInondation'], appel);
      assert.equal(resultat.ok, true, resultat.erreur);
      assert.equal(resultat.contientVieille, false, 'une entrée de plus de 7 jours doit être purgée');
      assert.equal(resultat.autorise, true);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Write-SzhRapport de bout en bout : un second appel identique (même signature) dans la même journée est étouffé',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-antiinond-e2e-');
    try {
      const env = environnementIsole(travail, { SZH_RAPPORTS: path.join(travail, 'rapports') });
      fs.mkdirSync(env.SZH_RAPPORTS, { recursive: true });
      const script = [
        'Write-SzhRapport -Code ' + psChaine('LANCEUR-TRAP') + ' -Source ' + psChaine('lanceur') + ' -Etape ' + psChaine('x') + ' -Message ' + psChaine('même incident'),
        'Write-SzhRapport -Code ' + psChaine('LANCEUR-TRAP') + ' -Source ' + psChaine('lanceur') + ' -Etape ' + psChaine('x') + ' -Message ' + psChaine('même incident')
      ].join('\r\n');
      const run = executerAvecSzhCommun(travail, env, script);
      assert.equal(run.status, 0, run.stderr);
      const fichiers = fs.readdirSync(env.SZH_RAPPORTS).filter((f) => f.endsWith('.json'));
      assert.equal(fichiers.length, 1, 'le second appel (même signature) aurait dû être étouffé, trouvé : ' + JSON.stringify(fichiers));
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 8. File d'attente hors ligne (§4.4)
// =========================================================================================

test('Sans SZH_RAPPORTS ni ancrage résolvable, le rapport va dans %LOCALAPPDATA%\\SZH\\rapports-en-attente',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-attente-ecrit-');
    try {
      const env = environnementIsole(travail);
      const run = executerAvecSzhCommun(travail, env,
        'Write-SzhRapport -Code ' + psChaine('LANCEUR-TRAP') + ' -Source ' + psChaine('lanceur') + ' -Message ' + psChaine('hors ligne'));
      assert.equal(run.status, 0, run.stderr);
      const dossierAttente = path.join(env.LOCALAPPDATA, 'SZH', 'rapports-en-attente');
      assert.ok(fs.existsSync(dossierAttente), 'le dossier de la file d\'attente n\'a pas été créé');
      const r = lireUniqueRapport(dossierAttente).json;
      assert.equal(r.ancrage.trouve, false);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Limit-SzhRapportsEnAttente : purge les fichiers de plus de 30 jours, plafonne à 50',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-limite-');
    try {
      const dossier = path.join(travail, 'attente');
      fs.mkdirSync(dossier, { recursive: true });
      const maintenant = Date.now();
      // Un fichier vieux de 40 jours : doit disparaître.
      const vieux = path.join(dossier, 'vieux.json');
      fs.writeFileSync(vieux, '{}', 'utf8');
      const tempsVieux = new Date(maintenant - 40 * 24 * 3600 * 1000);
      fs.utimesSync(vieux, tempsVieux, tempsVieux);
      // 55 fichiers récents : au-delà de 50, les plus anciens doivent disparaître.
      for (let i = 0; i < 55; i++) {
        const p = path.join(dossier, 'recent-' + String(i).padStart(3, '0') + '.json');
        fs.writeFileSync(p, '{}', 'utf8');
        const t = new Date(maintenant - (55 - i) * 1000);
        fs.utimesSync(p, t, t);
      }
      const appel = '$sortie.restants = @(Limit-SzhRapportsEnAttente -Dossier ' + psChaine(dossier) + ').Count';
      const resultat = executerFonctionsPures(travail, ['Get-SzhRapportsEnAttenteListe', 'Limit-SzhRapportsEnAttente'], appel);
      assert.equal(resultat.ok, true, resultat.erreur);
      assert.equal(resultat.restants, 50, 'attendu exactement 50 fichiers restants (plafond), trouvé ' + resultat.restants);
      assert.ok(!fs.existsSync(vieux), 'le fichier de plus de 30 jours aurait dû être effacé');
      const restants = fs.readdirSync(dossier);
      assert.equal(restants.length, 50);
      assert.ok(!restants.includes('recent-000.json'), 'le plus ancien des 55 aurait dû être effacé en premier');
      assert.ok(restants.includes('recent-054.json'), 'le plus récent doit survivre');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('Clear-SzhRapportsEnAttente vide la file vers le dossier de rapports au démarrage du lanceur',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-vidage-');
    try {
      const env = environnementIsole(travail, { SZH_RAPPORTS: path.join(travail, 'rapports') });
      fs.mkdirSync(env.SZH_RAPPORTS, { recursive: true });
      const dossierAttente = path.join(env.LOCALAPPDATA, 'SZH', 'rapports-en-attente');
      fs.mkdirSync(dossierAttente, { recursive: true });
      fs.writeFileSync(path.join(dossierAttente, 'enattente1.json'), '{"a":1}', 'utf8');
      fs.writeFileSync(path.join(dossierAttente, 'enattente2.json'), '{"a":2}', 'utf8');

      const run = executerAvecSzhCommun(travail, env, 'Clear-SzhRapportsEnAttente');
      assert.equal(run.status, 0, run.stderr);
      assert.equal(fs.readdirSync(dossierAttente).length, 0, 'la file d\'attente devrait être vide après le vidage');
      const dans = fs.readdirSync(env.SZH_RAPPORTS);
      assert.equal(dans.length, 2, 'les deux fichiers en attente auraient dû être déplacés');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('GARDE-FOU : Clear-SzhRapportsEnAttente ne fait rien en SZH_LANCEUR_SIMULE=1 (protège les tests du lanceur)',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-vidage-simule-');
    try {
      const env = environnementIsole(travail, { SZH_RAPPORTS: path.join(travail, 'rapports'), SZH_LANCEUR_SIMULE: '1' });
      fs.mkdirSync(env.SZH_RAPPORTS, { recursive: true });
      const dossierAttente = path.join(env.LOCALAPPDATA, 'SZH', 'rapports-en-attente');
      fs.mkdirSync(dossierAttente, { recursive: true });
      fs.writeFileSync(path.join(dossierAttente, 'enattente.json'), '{}', 'utf8');

      const run = executerAvecSzhCommun(travail, env, 'Clear-SzhRapportsEnAttente');
      assert.equal(run.status, 0, run.stderr);
      assert.equal(fs.readdirSync(dossierAttente).length, 1, 'rien ne devrait bouger en simulation');
      assert.equal(fs.readdirSync(env.SZH_RAPPORTS).length, 0);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 9. D5 : un échec d'écriture ne lève jamais, et n'écrit pas de second rapport sur lui-même
// =========================================================================================

test('D5 : un dossier de rapports impossible à créer (composant du chemin = un fichier) n\'empêche jamais le processus de finir proprement',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-echec-ecriture-');
    try {
      // Un FICHIER là où Write-SzhRapport voudra créer un DOSSIER : New-Item -Force lève.
      const obstacle = path.join(travail, 'obstacle.txt');
      fs.writeFileSync(obstacle, 'ceci est un fichier, pas un dossier', 'utf8');
      const dossierImpossible = path.join(obstacle, 'rapports');

      const env = environnementIsole(travail, { SZH_RAPPORTS: dossierImpossible });
      // La file d'attente elle-même doit aussi être injoignable, pour forcer le tout dernier
      // repli (§4, RAPPORT-ECHEC-ECRITURE, jamais transformé en rapport).
      env.LOCALAPPDATA = path.join(obstacle, 'localappdata');

      const run = executerAvecSzhCommun(travail, env,
        'Write-SzhRapport -Code ' + psChaine('LANCEUR-TRAP') + ' -Source ' + psChaine('lanceur') + ' -Message ' + psChaine('essai') + '\r\nWrite-Host \'SURVECU\'');
      assert.equal(run.status, 0, 'le processus PowerShell n\'aurait jamais dû lever ni sortir en erreur : ' + run.stderr);
      assert.match(run.stdout, /SURVECU/, 'le script aurait dû continuer après Write-SzhRapport');
      assert.ok(!fs.existsSync(dossierImpossible));
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('D5 : Write-SzhRapport appelé sans code ne lève pas et n\'écrit rien',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-sans-code-');
    try {
      const env = environnementIsole(travail, { SZH_RAPPORTS: path.join(travail, 'rapports') });
      fs.mkdirSync(env.SZH_RAPPORTS, { recursive: true });
      const run = executerAvecSzhCommun(travail, env, 'Write-SzhRapport -Source lanceur -Message essai\r\nWrite-Host \'SURVECU\'');
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /SURVECU/);
      assert.equal(fs.readdirSync(env.SZH_RAPPORTS).length, 0);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// =========================================================================================
// 10. UTF-8 sans BOM, accents en clair (pas en \uXXXX) -- ConvertTo-Json de PowerShell 5.1
//     échappe le non-ASCII par défaut ; vérifié ici sur le VRAI fichier écrit sur disque.
// =========================================================================================

test('Le rapport écrit par PowerShell est UTF-8 SANS BOM, indenté 2 espaces, et les accents sont de vrais caractères UTF-8 (pas \\u00e9)',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-rapport-encodage-');
    try {
      const env = environnementIsole(travail, { SZH_RAPPORTS: path.join(travail, 'rapports') });
      fs.mkdirSync(env.SZH_RAPPORTS, { recursive: true });
      const run = executerAvecSzhCommun(travail, env,
        'Write-SzhRapport -Code ' + psChaine('COCKPIT-EXCEPTION') + ' -Source ' + psChaine('cockpit') + ' -Message ' + psChaine('essai accentué : éàüö'));
      assert.equal(run.status, 0, run.stderr);
      const { octets, texte, json } = lireUniqueRapport(env.SZH_RAPPORTS);

      // Pas de BOM (EF BB BF).
      assert.ok(!(octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf), 'le fichier porte un BOM UTF-8');
      assert.equal(octets[0], '{'.charCodeAt(0), 'le premier octet devrait être "{" (aucun BOM devant)');

      // Indentation 2 espaces.
      assert.match(texte, /\n  "id":/, 'indentation attendue : 2 espaces');

      // Accents en clair : la table des résumés (fixe, connue) doit apparaître telle quelle,
      // jamais en \u00e9 -- recherche sur le TEXTE BRUT, pas sur l'objet déjà reparsé.
      assert.ok(texte.indexOf('\u00e9') !== -1 || texte.indexOf(json.message) !== -1,
        'aucun caractère accentué littéral trouvé dans le fichier brut');
      assert.equal(texte.indexOf('\\u00'), -1, 'un échappement \\u00.. résiduel a été trouvé dans le fichier écrit');
      assert.match(json.resume.fr, /à l\u2019ouverture|dans l\u2019extension/, 'resume.fr inattendu : ' + json.resume.fr);
      assert.ok(json.message.indexOf('éàüö') !== -1, 'le message accentué ne survit pas tel quel : ' + json.message);

      // Un vrai \n final (JSON.stringify(...) + '\n' côté JS, même convention ici).
      assert.ok(texte.endsWith('}\n') || texte.endsWith('}\r\n'), 'le fichier devrait se terminer par un retour à la ligne');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });
