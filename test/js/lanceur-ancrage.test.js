// Le cablage de l'ancrage SharePoint dans le lanceur unique (windows/open-produit.ps1) : un
// seul appel a Initialize-SzhAncrage (windows/szh-ancrage.ps1), au demarrage, avant tout ce
// qui en depend -- jamais dans open-md.ps1 ni archive-revue.ps1, qui n'utilisent que la
// resolution passive et ne doivent jamais rien demander.
//
//   node --test test/js/lanceur-ancrage.test.js
//   node --test "test/js/*.test.js"                 (reference : voir le rapport du jalon)
//
// Le defaut reel que ce fichier garde : l'ORDRE du cablage est un piege a deux sens.
//   * Trop TOT (avant le switch -Versions) : la personne devrait choisir un dossier SharePoint
//     rien que pour reparer une installation abimee -- l'outil de reparation deviendrait
//     inatteignable sur le poste meme qui en a le plus besoin.
//   * Trop TARD (apres Get-SzhEmplacements, qui calcule la base des produits) : la base serait
//     figee sur "introuvable" avant meme que l'ancrage n'ait ete rattache, et la personne
//     verrait une liste vide alors qu'elle vient de choisir le bon dossier.
// Ce fichier prouve donc le placement par l'observation (JSON de simulation) ET par le texte
// source (indexOf), pas seulement l'un des deux : un futur remaniement qui deplacerait
// l'appel sans casser le texte environnant pourrait sinon passer inapercu.
//
// Technique reprise de test/js/lanceur.test.js (SZH_LANCEUR_SIMULE=1, JSON sur stdout) et de
// test/js/ancrage-sharepoint.test.js (isolation de USERPROFILE/OneDrive*/LOCALAPPDATA) : cette
// derniere est indispensable ici, parce que open-produit.ps1 appelle desormais une fonction
// habilitee a LIRE (cache) et, hors simulation, a ECRIRE (etat-utilisateur.json) -- deux
// choses que test/js/lanceur.test.js n'avait jamais eu a isoler avant l'existence de
// l'ancrage.
//
// Aucun test ne touche le vrai C:\ProgramData\SZH, le vrai %LOCALAPPDATA%\SZH ni le vrai
// SharePoint du poste (C:\Users\<compte>\SZH CSPS\...\_AutoReportToolboxZeitscrhiften, un
// dossier partage reel de l'entreprise) : SZH_BASE, USERPROFILE et LOCALAPPDATA sont
// systematiquement rediriges vers des dossiers jetables (fs.mkdtempSync) AVANT tout appel,
// OneDrive/OneDriveCommercial sont retires de l'environnement transmis, et
// SZH_LANCEUR_SIMULE=1 est pose partout -- aucune fenetre ne doit jamais s'ouvrir pendant ces
// tests.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const OUVRIR_REVUE = path.join(RACINE, 'windows', 'open-revue.ps1');
const OUVRIR_LIVRE = path.join(RACINE, 'windows', 'open-livre.ps1');
const OUVRIR_PRODUIT_PS1 = path.join(RACINE, 'windows', 'open-produit.ps1');
const TEXTES_PS1 = path.join(RACINE, 'windows', 'szh-textes.ps1');

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

// ---- Execution isolee : USERPROFILE, LOCALAPPDATA et OneDrive* toujours neutralises -------
//
// $env:SZH_ANCRAGE, s'il traine deja dans l'environnement du poste qui fait tourner ces
// tests, est retire par defaut : chaque scenario le repose explicitement s'il en a besoin
// (overrides l'emporte toujours, applique apres le nettoyage).
function executer(scriptPath, args, overrides) {
  if (!POWERSHELL) { return null; }
  const env = Object.assign({}, process.env);
  delete env.OneDrive;
  delete env.OneDriveCommercial;
  delete env.SZH_ANCRAGE;
  Object.assign(env, { SZH_LANCEUR_SIMULE: '1' }, overrides || {});
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  let sortie = null;
  let erreurJson = null;
  if (run.stdout) {
    try { sortie = JSON.parse(run.stdout.trim()); } catch (e) { erreurJson = e; }
  }
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', sortie, erreurJson };
}

function verifierExecution(r, nom) {
  assert.ok(r, nom + ' : aucun resultat (powershell.exe indisponible ?)');
  assert.strictEqual(r.status, 0, nom + ' : le lanceur a echoue -- ' + r.stderr);
  assert.ok(r.sortie, nom + ' : sortie non JSON -- ' + r.stdout + ' / ' + r.stderr);
}

function creerAncrage(racine) {
  const ancrage = path.join(racine, 'Ancrage', 'Daten_Allgemein - General');
  fs.mkdirSync(path.join(ancrage, '2_Produkte'), { recursive: true });
  return ancrage;
}

function ecrireYaml(dossier, nomFichier, lignes) {
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, nomFichier), lignes.join('\n') + '\n', 'utf8');
}

// =====================================================================================
// ---- Scenario 1 : SZH_ANCRAGE (essai) retenu -- la base des produits en decoule -------
// =====================================================================================

const TRAVAIL_1 = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-ancrage-essai-'));
const PROGRAMDATA_1 = path.join(TRAVAIL_1, 'programdata');
const PROFIL_1 = path.join(TRAVAIL_1, 'profil-neutre');
const LOCALAPPDATA_1 = path.join(TRAVAIL_1, 'localappdata');
fs.mkdirSync(PROGRAMDATA_1, { recursive: true });
fs.mkdirSync(PROFIL_1, { recursive: true });
// "emplacementRevues" fige explicitement : sans basesRevues.prod, pour que
// Get-SzhBaseRevuesPour retombe sur l'ancrage plutot que sur le defaut code en dur.
fs.writeFileSync(path.join(PROGRAMDATA_1, 'config.json'), JSON.stringify({
  emplacementRevues: 'production',
}), 'utf8');
const ANCRAGE_1 = creerAncrage(TRAVAIL_1);
// Un numero et un livre, tous deux sous CET ancrage : de quoi prouver que la resolution ne
// beneficie pas qu'a la revue, mais bien aux trois produits (Revue, Zeitschrift, Books)
// qu'open-produit.ps1 sert d'un seul cablage.
const BASE_1 = path.join(ANCRAGE_1, '2_Produkte');
ecrireYaml(path.join(BASE_1, '52_Revue', 'RV02_Redaction', '2026-04'), 'ausgabe.yaml',
  ['title: "Via ancrage"', 'revue: "revue"']);
ecrireYaml(path.join(BASE_1, '54_Buch', 'BU02_Redaktion', '2026-B900-LivreViaAncrage'), 'buch.yaml',
  ['titre: "Livre via ancrage"', 'lang: "fr"']);

const envEssai = { SZH_BASE: PROGRAMDATA_1, USERPROFILE: PROFIL_1, LOCALAPPDATA: LOCALAPPDATA_1, SZH_ANCRAGE: ANCRAGE_1 };
const essaiRevue = (function () { return executer(OUVRIR_REVUE, ['-Produit', 'revue'], envEssai); })();
// Un SZH_BASE SEPARE pour le livre : PROGRAMDATA_1 sert au controle "une seule ligne de
// journal par lancement" juste plus bas, et un deuxieme lancement dans le MEME dossier de
// journal y ajouterait une deuxieme ligne, faussant ce controle-la.
const PROGRAMDATA_1_LIVRE = path.join(TRAVAIL_1, 'programdata-livre');
fs.mkdirSync(PROGRAMDATA_1_LIVRE, { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA_1_LIVRE, 'config.json'), JSON.stringify({
  emplacementRevues: 'production',
}), 'utf8');
const essaiLivre = (function () {
  return executer(OUVRIR_LIVRE, [], Object.assign({}, envEssai, { SZH_BASE: PROGRAMDATA_1_LIVRE }));
})();
// Le journal est lu ICI, tout de suite apres l'execution et AVANT le nettoyage de TRAVAIL_1
// en toute fin de fichier -- les tests, eux, ne s'executent qu'apres coup (node:test execute
// les corps de test une fois tout le module charge) et ne verraient plus rien sur le disque.
const journalEssai = (function () {
  if (!essaiRevue) { return null; }
  const maintenant = new Date();
  const mois = String(maintenant.getMonth() + 1).padStart(2, '0');
  const fichierLog = path.join(PROGRAMDATA_1, 'logs', `szh-${maintenant.getFullYear()}-${mois}.log`);
  if (!fs.existsSync(fichierLog)) { return { existe: false, lignes: [] }; }
  const contenu = fs.readFileSync(fichierLog, 'utf8');
  return { existe: true, lignes: contenu.split(/\r?\n/).filter((l) => l.indexOf('ancrage SharePoint') !== -1) };
})();

test('SZH_ANCRAGE est retenu (origine "essai") et son chemin figure dans le JSON de simulation',
  { skip: sansPowerShell }, () => {
    verifierExecution(essaiRevue, 'essai-revue');
    const r = essaiRevue.sortie;
    assert.ok(r.ancrage, 'le champ "ancrage" est absent du JSON de simulation');
    assert.strictEqual(r.ancrage.chemin, ANCRAGE_1);
    assert.strictEqual(r.ancrage.origine, 'essai');
  });

test('la base des produits DECOULE de l\'ancrage retenu : racineBase = <ancrage>\\2_Produkte, et la liste reelle en sort',
  { skip: sansPowerShell }, () => {
    verifierExecution(essaiRevue, 'essai-revue');
    const r = essaiRevue.sortie;
    assert.strictEqual(r.racineBase, BASE_1);
    assert.strictEqual(r.enCours.length, 1, 'le numero pose sous l\'ancrage doit apparaitre "en cours"');
    assert.strictEqual(r.enCours[0].nom, '2026-04');
  });

test('le meme ancrage sert aussi le produit "livre" -- un seul cablage pour les trois produits',
  { skip: sansPowerShell }, () => {
    verifierExecution(essaiLivre, 'essai-livre');
    const r = essaiLivre.sortie;
    assert.strictEqual(r.ancrage.chemin, ANCRAGE_1);
    assert.strictEqual(r.ancrage.origine, 'essai');
    assert.strictEqual(r.racineBase, BASE_1);
    assert.strictEqual(r.enCours.length, 1);
    assert.strictEqual(r.enCours[0].nom, '2026-B900-LivreViaAncrage');
  });

test('un seul appel par lancement : une seule ligne de journal "ancrage SharePoint" par processus',
  { skip: sansPowerShell }, () => {
    verifierExecution(essaiRevue, 'essai-revue');
    assert.ok(journalEssai && journalEssai.existe, 'aucun journal ecrit sous ' + PROGRAMDATA_1);
    assert.strictEqual(journalEssai.lignes.length, 1,
      'attendu exactement une ligne "ancrage SharePoint" pour ce lancement, trouve : ' + JSON.stringify(journalEssai.lignes));
    assert.match(journalEssai.lignes[0], /ancrage SharePoint "/, 'la ligne de journal ne nomme pas l\'ancrage retenu');
    assert.match(journalEssai.lignes[0], /origine essai/, 'la ligne de journal ne dit pas l\'origine "essai"');
  });

// =====================================================================================
// ---- Scenario 2 : aucun ancrage nulle part -- le lanceur poursuit normalement (D5) -----
// =====================================================================================

const TRAVAIL_2 = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-ancrage-absent-'));
const PROGRAMDATA_2 = path.join(TRAVAIL_2, 'programdata');
const PROFIL_2 = path.join(TRAVAIL_2, 'profil-neutre');
const LOCALAPPDATA_2 = path.join(TRAVAIL_2, 'localappdata');
fs.mkdirSync(PROGRAMDATA_2, { recursive: true });
fs.mkdirSync(PROFIL_2, { recursive: true });
// Ni "SZH CSPS", ni "OneDrive - SZH CSPS", ni aucun sous-dossier candidat : la detection
// automatique (Find-SzhAncrageAuto) n'a rigoureusement rien a trouver sous ce profil neutre.
fs.writeFileSync(path.join(PROGRAMDATA_2, 'config.json'), JSON.stringify({
  emplacementRevues: 'production',
}), 'utf8');

const envAbsent = { SZH_BASE: PROGRAMDATA_2, USERPROFILE: PROFIL_2, LOCALAPPDATA: LOCALAPPDATA_2 };
const absentRevue = (function () { return executer(OUVRIR_REVUE, ['-Produit', 'revue'], envAbsent); })();
const absentVersions = (function () { return executer(OUVRIR_REVUE, ['-Produit', 'revue', '-Versions'], envAbsent); })();

test('sans ancrage trouvable nulle part, le lanceur sort proprement -- meme code de sortie, JSON exploitable',
  { skip: sansPowerShell }, () => {
    verifierExecution(absentRevue, 'absent-revue');
    const r = absentRevue.sortie;
    assert.strictEqual(r.ancrage.chemin, '', 'aucun chemin ne devrait avoir ete trouve');
    assert.ok(Array.isArray(r.enCours) && Array.isArray(r.archives),
      'les listes doivent rester des tableaux exploitables, meme vides');
  });

test('GARDE-FOU : en simulation sans ancrage trouvable, l\'origine est "defaut" -- la demande n\'est meme pas tentee',
  { skip: sansPowerShell }, () => {
    // Initialize-SzhAncrage rend "defaut" des le tout premier test SZH_LANCEUR_SIMULE=1, AVANT
    // meme de regarder le marqueur anti-harcelement ou d'appeler Request-SzhAncrageUtilisateur
    // (voir szh-ancrage.ps1). Si l'appel avait malgre tout tente la demande -- laquelle se
    // neutralise aussi en simulation, mais plus tard dans le contrat -- l'origine rendue serait
    // "absent", jamais "defaut". Cette distinction prouve donc, sans jamais avoir a observer
    // une fenetre, qu'aucune tentative d'en ouvrir une n'a eu lieu.
    verifierExecution(absentRevue, 'absent-revue');
    assert.strictEqual(absentRevue.sortie.ancrage.origine, 'defaut');
  });

test('D5 : le lanceur ne bloque jamais et n\'echoue jamais faute d\'ancrage (regle absolue)',
  { skip: sansPowerShell }, () => {
    verifierExecution(absentRevue, 'absent-revue');
    assert.strictEqual(absentRevue.status, 0, 'le code de sortie doit rester 0, comme un lancement normal');
  });

test('-Versions reste atteignable meme sans ancrage : le selecteur de version ne consulte jamais l\'ancrage',
  { skip: sansPowerShell }, () => {
    verifierExecution(absentVersions, 'absent-versions');
    const r = absentVersions.sortie;
    assert.strictEqual(r.versions, true);
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'versionInstallee'));
    // Le switch -Versions sort du script avant meme d'atteindre le bloc d'ancrage (il est
    // le tout premier controle du fichier) : le champ "ancrage" ne doit donc pas exister ici.
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, 'ancrage'), false,
      '-Versions ne devrait jamais atteindre le bloc d\'ancrage');
  });

// =====================================================================================
// ---- Controles statiques : l'ORDRE du cablage, prouve sur le texte source lui-meme -----
// =====================================================================================

const SOURCE_PRODUIT = fs.readFileSync(OUVRIR_PRODUIT_PS1, 'utf8');

test('un seul point d\'appel a Initialize-SzhAncrage dans open-produit.ps1', () => {
  const occurrences = SOURCE_PRODUIT.split('Initialize-SzhAncrage').length - 1;
  // Un dans le corps du code (l'appel), au moins un dans les commentaires qui l'expliquent :
  // au moins 2, mais l'AFFECTATION elle-meme ("$ancrageResolu = Initialize-SzhAncrage") ne
  // doit apparaitre qu'UNE SEULE fois -- c'est elle qui compte, pas les mentions en commentaire.
  assert.ok(occurrences >= 1, 'Initialize-SzhAncrage n\'est plus appelee du tout');
  const appels = SOURCE_PRODUIT.split('$ancrageResolu = Initialize-SzhAncrage').length - 1;
  assert.strictEqual(appels, 1, 'Initialize-SzhAncrage doit etre assignee a $ancrageResolu exactement une fois');
});

test('ORDRE : le controle -Versions reste le tout premier, avant l\'appel a l\'ancrage', () => {
  const iVersions = SOURCE_PRODUIT.indexOf('if ($Versions) {');
  const iAncrage = SOURCE_PRODUIT.indexOf('$ancrageResolu = Initialize-SzhAncrage');
  assert.ok(iVersions !== -1 && iAncrage !== -1, 'le controle -Versions ou l\'appel a l\'ancrage a disparu');
  assert.ok(iVersions < iAncrage,
    '-Versions doit rester atteignable AVANT l\'ancrage -- sinon il devient inatteignable sans dossier SharePoint');
});

test('ORDRE : l\'appel a l\'ancrage precede Get-SzhEmplacements -- jamais la base calculee avant l\'ancrage rattache', () => {
  const iAncrage = SOURCE_PRODUIT.indexOf('$ancrageResolu = Initialize-SzhAncrage');
  const iEmplacements = SOURCE_PRODUIT.indexOf('$emplacements = Get-SzhEmplacements');
  assert.ok(iAncrage !== -1 && iEmplacements !== -1, 'l\'appel a l\'ancrage ou Get-SzhEmplacements a disparu');
  assert.ok(iAncrage < iEmplacements,
    'Get-SzhEmplacements calcule la base des produits -- il doit voir l\'ancrage deja resolu, pas l\'inverse');
});

test('Write-SzhLog est appele juste apres la resolution de l\'ancrage, un branchement if/else -- un seul des deux s\'execute', () => {
  // Deux mentions dans le SOURCE (une par branche : chemin trouve, chemin absent) ; le
  // controle behavioral plus haut ("un seul appel par lancement") prouve qu'une seule des
  // deux s'execute reellement a l'EXECUTION -- ce test-ci ne verifie que la structure.
  const iAncrage = SOURCE_PRODUIT.indexOf('$ancrageResolu = Initialize-SzhAncrage');
  const voisinage = SOURCE_PRODUIT.slice(iAncrage, iAncrage + 400);
  assert.match(voisinage, /if \(\$ancrageResolu\.chemin\)/, 'le branchement chemin trouve/absent a disparu');
  const occurrencesLog = voisinage.match(/Write-SzhLog/g) || [];
  assert.strictEqual(occurrencesLog.length, 2,
    'attendu deux mentions de Write-SzhLog (une par branche du if/else), trouve ' + occurrencesLog.length);
});

// =====================================================================================
// ---- Le texte affiche quand l'ancrage manque : present dans les trois langues ---------
// =====================================================================================

const SOURCE_TEXTES = fs.readFileSync(TEXTES_PS1, 'utf8');

test('la cle "lanceur.ancrage.absent" existe dans les trois tables de langue (fr, de, en)', () => {
  const occurrences = SOURCE_TEXTES.split("'lanceur.ancrage.absent'").length - 1;
  assert.strictEqual(occurrences, 3, 'attendu une entree par langue (fr/de/en), trouve ' + occurrences);
});

test('open-produit.ps1 n\'affiche ce texte que si l\'ancrage manque ET qu\'on est hors mode test', () => {
  assert.ok(SOURCE_PRODUIT.indexOf("T 'lanceur.ancrage.absent'") !== -1,
    'open-produit.ps1 n\'utilise plus la cle "lanceur.ancrage.absent"');
  const iUsage = SOURCE_PRODUIT.indexOf("T 'lanceur.ancrage.absent'");
  const avant = SOURCE_PRODUIT.slice(Math.max(0, iUsage - 400), iUsage);
  assert.match(avant, /modeTest/, 'le texte devrait rester sous condition du mode test');
  assert.match(avant, /ancrageResolu\.chemin/, 'le texte devrait rester sous condition de l\'ancrage absent');
});

// ---- Nettoyage : rien ne doit rester sous le dossier temporaire du systeme apres coup ----
try { fs.rmSync(TRAVAIL_1, { recursive: true, force: true }); } catch (e) { /* best effort */ }
try { fs.rmSync(TRAVAIL_2, { recursive: true, force: true }); } catch (e) { /* best effort */ }
