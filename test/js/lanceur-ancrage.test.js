// Le câblage de l'ancrage SharePoint au démarrage de « Pronto » (windows/open-revue.ps1 ->
// Invoke-SzhTachesDemarrage, windows/szh-shell.ps1) : un seul appel à Initialize-SzhAncrage
// (windows/szh-ancrage.ps1), avant tout ce qui en dépend. open-md.ps1 et archive-revue.ps1
// n'utilisent que la résolution passive, qui ne demande rien.
//
//   node --test test/js/lanceur-ancrage.test.js
//
// L'appel a sa place exacte :
//   * après le switch -Versions, pour réparer une installation sans avoir à choisir un
//     dossier SharePoint ;
//   * avant le check-in, l'épinglage et l'arbre d'essai, qui lisent la racine.
// L'ordre est vérifié par l'observation (JSON de simulation) et sur le texte source.
//
// Les tests ne touchent ni C:\ProgramData\SZH, ni %LOCALAPPDATA%\SZH, ni le SharePoint du
// poste : SZH_BASE, USERPROFILE et LOCALAPPDATA vont vers des dossiers jetables
// (fs.mkdtempSync) avant tout appel, OneDrive/OneDriveCommercial et SZH_ANCRAGE sont
// retirés de l'environnement transmis, et SZH_LANCEUR_SIMULE=1 est posé partout.
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
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const SHELL_PS1 = path.join(RACINE, 'windows', 'szh-shell.ps1');

const { POWERSHELL, sansPowerShell } = require('./gardes');

// Le nom du dossier de l'application est lu dans $script:SzhSegmentApplication
// (windows/szh-ancrage.ps1), pas recopié, comme NOM_APPLICATION dans
// test/js/lanceur.test.js.
const SOURCE_ANCRAGE = fs.readFileSync(path.join(RACINE, 'windows', 'szh-ancrage.ps1'), 'utf8');
const mSegment = SOURCE_ANCRAGE.match(/\$script:SzhSegmentApplication\s*=\s*'([^']+)'/);
assert.ok(mSegment, 'szh-ancrage.ps1 ne declare plus $script:SzhSegmentApplication');
const SEGMENT_APPLICATION = mSegment[1];
// La base des produits dérive de l'ancrage : <ancrage>\2_Produkte\<application>.
const SEGMENTS_BASE = ['2_Produkte', SEGMENT_APPLICATION];

// ---- Exécution isolée : USERPROFILE, LOCALAPPDATA et OneDrive* neutralisés -------------
//
// $env:SZH_ANCRAGE du poste est retiré : chaque scénario le pose s'il en a besoin
// (overrides s'applique après le nettoyage).
function executer(scriptPath, args, overrides) {
  if (!POWERSHELL) { return null; }
  const env = Object.assign({}, process.env);
  delete env.OneDrive;
  delete env.OneDriveCommercial;
  delete env.SZH_ANCRAGE;
  // Le cockpit du dépôt : open-revue.ps1 refuse d'ouvrir l'Accueil sous une version trop
  // ancienne, et le profil neutre n'en porte aucune.
  Object.assign(env, { SZH_LANCEUR_SIMULE: '1',
    SZH_COCKPIT_DOSSIER: path.join(RACINE, 'vscodium-extension', 'szh-cockpit') }, overrides || {});
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
// ---- Scénario 1 : SZH_ANCRAGE (essai) retenu, la base des produits en découle ---------
// =====================================================================================

const TRAVAIL_1 = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-ancrage-essai-'));
const PROGRAMDATA_1 = path.join(TRAVAIL_1, 'programdata');
const PROFIL_1 = path.join(TRAVAIL_1, 'profil-neutre');
const LOCALAPPDATA_1 = path.join(TRAVAIL_1, 'localappdata');
fs.mkdirSync(PROGRAMDATA_1, { recursive: true });
fs.mkdirSync(PROFIL_1, { recursive: true });
// "emplacementRevues" seul est posé : la racine de production vient de l'ancrage
// (Get-SzhBaseRevuesPour), le défaut écrit dans le code n'étant que le dernier recours.
fs.writeFileSync(path.join(PROGRAMDATA_1, 'config.json'), JSON.stringify({
  emplacementRevues: 'production',
}), 'utf8');
const ANCRAGE_1 = creerAncrage(TRAVAIL_1);
// Un numéro et un livre sous cet ancrage : la résolution sert les trois produits (Revue,
// Zeitschrift, Books).
const BASE_1 = path.join.apply(path, [ANCRAGE_1].concat(SEGMENTS_BASE));
// Les numéros sont directement sous leur dossier produit ; seules les archives ont un
// niveau de plus (« _Archive\<Produit> »).
ecrireYaml(path.join(BASE_1, 'Revue', '2026-04'), 'ausgabe.yaml',
  ['title: "Via ancrage"', 'revue: "revue"']);
ecrireYaml(path.join(BASE_1, 'Books', '2026-B900-LivreViaAncrage'), 'buch.yaml',
  ['titre: "Livre via ancrage"', 'lang: "fr"']);

const envEssai = { SZH_BASE: PROGRAMDATA_1, USERPROFILE: PROFIL_1, LOCALAPPDATA: LOCALAPPDATA_1, SZH_ANCRAGE: ANCRAGE_1 };
const essaiRevue = (function () { return executer(OUVRIR_REVUE, [], envEssai); })();
// La base et les racines en cours que le socle tire de cet ancrage, pour les trois produits.
function emplacementsSocle(env) {
  if (!POWERSHELL) { return null; }
  const e = Object.assign({}, process.env);
  delete e.OneDrive;
  delete e.OneDriveCommercial;
  Object.assign(e, { SZH_LANCEUR_SIMULE: '1' }, env);
  const commande = '. "' + COMMUN_PS1 + '"; $r = [ordered]@{ base = (Get-SzhEmplacements).base; ' +
    'revue = (Get-SzhEmplacementRevue revue encours); livre = (Get-SzhEmplacementRevue livre encours) }; ' +
    '[Console]::Out.Write(($r | ConvertTo-Json -Compress))';
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commande],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env: e });
  let sortie = null;
  try { sortie = JSON.parse(String(run.stdout || '').trim()); } catch (err) { /* rapporté par le test */ }
  const lister = (d) => { try { return fs.readdirSync(d).sort(); } catch (err) { return null; } };
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', sortie,
    enCours: sortie ? { revue: lister(sortie.revue), livre: lister(sortie.livre) } : null };
}
const socleEssai = emplacementsSocle(envEssai);

// Un SZH_BASE à part pour le livre : PROGRAMDATA_1 sert au contrôle « une seule ligne de
// journal par lancement », qu'un deuxième lancement dans le même dossier fausserait.
const PROGRAMDATA_1_LIVRE = path.join(TRAVAIL_1, 'programdata-livre');
fs.mkdirSync(PROGRAMDATA_1_LIVRE, { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA_1_LIVRE, 'config.json'), JSON.stringify({
  emplacementRevues: 'production',
}), 'utf8');
const essaiLivre = (function () {
  return executer(OUVRIR_LIVRE, [], Object.assign({}, envEssai, { SZH_BASE: PROGRAMDATA_1_LIVRE }));
})();
// Le journal est lu ici, juste après l'exécution : node:test exécute les corps de test une
// fois le module chargé, donc après le nettoyage de TRAVAIL_1 en fin de fichier.
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

test('la base des produits DECOULE de l\'ancrage retenu : base = <ancrage>\\2_Produkte\\<application>, et le numero y est',
  { skip: sansPowerShell }, () => {
    verifierExecution(socleEssai, 'socle-essai');
    const r = socleEssai.sortie;
    assert.strictEqual(r.base, BASE_1);
    assert.strictEqual(r.revue, path.join(BASE_1, 'Revue'));
    assert.deepStrictEqual(socleEssai.enCours.revue, ['2026-04'], 'le numero pose sous l\'ancrage doit etre sous la racine en cours');
  });

test('le meme ancrage sert aussi le produit "livre" -- un seul cablage pour les trois produits',
  { skip: sansPowerShell }, () => {
    verifierExecution(essaiLivre, 'essai-livre');
    assert.strictEqual(essaiLivre.sortie.ancrage.chemin, ANCRAGE_1);
    assert.strictEqual(essaiLivre.sortie.ancrage.origine, 'essai');
    verifierExecution(socleEssai, 'socle-essai');
    assert.strictEqual(socleEssai.sortie.livre, path.join(BASE_1, 'Books'));
    assert.deepStrictEqual(socleEssai.enCours.livre, ['2026-B900-LivreViaAncrage']);
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
// ---- Scénario 2 : aucun ancrage, le lanceur poursuit normalement -----------------------
// =====================================================================================

const TRAVAIL_2 = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-ancrage-absent-'));
const PROGRAMDATA_2 = path.join(TRAVAIL_2, 'programdata');
const PROFIL_2 = path.join(TRAVAIL_2, 'profil-neutre');
const LOCALAPPDATA_2 = path.join(TRAVAIL_2, 'localappdata');
fs.mkdirSync(PROGRAMDATA_2, { recursive: true });
fs.mkdirSync(PROFIL_2, { recursive: true });
// Ni "SZH CSPS", ni "OneDrive - SZH CSPS", ni sous-dossier candidat : la détection
// automatique (Find-SzhAncrageAuto) n'a rien à trouver sous ce profil neutre.
fs.writeFileSync(path.join(PROGRAMDATA_2, 'config.json'), JSON.stringify({
  emplacementRevues: 'production',
}), 'utf8');

const envAbsent = { SZH_BASE: PROGRAMDATA_2, USERPROFILE: PROFIL_2, LOCALAPPDATA: LOCALAPPDATA_2 };
const absentRevue = (function () { return executer(OUVRIR_REVUE, [], envAbsent); })();
const absentVersions = (function () { return executer(OUVRIR_REVUE, ['-Versions'], envAbsent); })();

test('sans ancrage trouvable nulle part, le lanceur sort proprement -- meme code de sortie, JSON exploitable',
  { skip: sansPowerShell }, () => {
    verifierExecution(absentRevue, 'absent-revue');
    const r = absentRevue.sortie;
    assert.strictEqual(r.ancrage.chemin, '', 'aucun chemin ne devrait avoir ete trouve');
    assert.strictEqual(r.entree, 'accueil', 'l\'Accueil doit s\'ouvrir quand meme');
    assert.ok(Array.isArray(r.taches) && r.taches.length > 1, 'les taches suivantes doivent tourner quand meme');
  });

test('GARDE-FOU : en simulation sans ancrage trouvable, l\'origine est "defaut" -- la demande n\'est meme pas tentee',
  { skip: sansPowerShell }, () => {
    // En simulation, Initialize-SzhAncrage rend "defaut" avant de lire le marqueur de
    // relance ou d'appeler Request-SzhAncrageUtilisateur (szh-ancrage.ps1). Une demande
    // tentée rendrait "absent" : "defaut" prouve qu'aucune fenêtre n'a été ouverte.
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
    // Le switch -Versions, premier contrôle du script, en sort avant le bloc d'ancrage : le
    // champ "ancrage" est absent.
    assert.strictEqual(Object.prototype.hasOwnProperty.call(r, 'ancrage'), false,
      '-Versions ne devrait jamais atteindre le bloc d\'ancrage');
  });

// =====================================================================================
// ---- Contrôles statiques : l'ordre du câblage, vérifié sur le texte source -------------
// =====================================================================================

const SOURCE_REVUE = fs.readFileSync(OUVRIR_REVUE, 'utf8');
const SOURCE_SHELL = fs.readFileSync(SHELL_PS1, 'utf8');
const iTaches = SOURCE_SHELL.indexOf('function Invoke-SzhTachesDemarrage');
const SOURCE_TACHES = SOURCE_SHELL.slice(iTaches, SOURCE_SHELL.indexOf('\n}', iTaches));

test('un seul point d\'appel a Initialize-SzhAncrage, dans Invoke-SzhTachesDemarrage', () => {
  assert.ok(iTaches !== -1, 'Invoke-SzhTachesDemarrage a disparu de szh-shell.ps1');
  assert.strictEqual(SOURCE_TACHES.split('$ancrage = Initialize-SzhAncrage').length - 1, 1,
    'Initialize-SzhAncrage doit etre assignee a $ancrage exactement une fois');
  // Aucun autre appel dans windows/ ni outils-dev/ : seul le démarrage demande.
  const appels = [];
  for (const d of ['windows', 'outils-dev']) {
    for (const n of fs.readdirSync(path.join(RACINE, d)).filter((x) => x.endsWith('.ps1'))) {
      const code = fs.readFileSync(path.join(RACINE, d, n), 'utf8').split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
      // Le nom entre apostrophes (la liste des tâches du plan) n'est pas un appel.
      const nb = (code.match(/(^|[^-\w'])Initialize-SzhAncrage\b/g) || []).length;
      if (nb) { appels.push(n + ':' + nb); }
    }
  }
  assert.deepStrictEqual(appels.sort(), ['szh-ancrage.ps1:1', 'szh-shell.ps1:1'],
    'Initialize-SzhAncrage est appelee hors du demarrage : ' + appels.join(', '));
});

test('ORDRE : le controle -Versions reste le tout premier, avant les taches de demarrage', () => {
  const iVersions = SOURCE_REVUE.indexOf('if ($Versions) {');
  const iTachesRevue = SOURCE_REVUE.indexOf('Invoke-SzhTachesDemarrage');
  const iAccueil = SOURCE_REVUE.indexOf('Start-SzhAccueil)');
  assert.ok(iVersions !== -1 && iTachesRevue !== -1 && iAccueil !== -1, 'le controle -Versions ou le demarrage a disparu');
  assert.ok(iVersions < iTachesRevue && iVersions < iAccueil,
    '-Versions doit rester atteignable AVANT l\'ancrage -- sinon il devient inatteignable sans dossier SharePoint');
});

test('ORDRE : l\'ancrage precede tout ce qui lit la racine -- check-in, epinglage, arbre d\'essai', () => {
  const iAncrage = SOURCE_TACHES.indexOf('$ancrage = Initialize-SzhAncrage');
  for (const suivant of ['Invoke-SzhCheckin', 'Invoke-SzhEpinglageHorsLigne', 'Initialize-SzhEmplacementsTest']) {
    const i = SOURCE_TACHES.indexOf('try { [void](' + suivant);
    assert.ok(iAncrage !== -1 && i !== -1, 'repere introuvable : ' + suivant);
    assert.ok(iAncrage < i, suivant + ' doit voir l\'ancrage deja resolu, pas l\'inverse');
  }
});

test('Write-SzhLog est appele juste apres la resolution de l\'ancrage, un branchement if/else -- un seul des deux s\'execute', () => {
  // Deux mentions dans la source (une par branche) ; le contrôle « un seul appel par
  // lancement », plus haut, montre qu'une seule s'exécute.
  const iAncrage = SOURCE_TACHES.indexOf('$ancrage = Initialize-SzhAncrage');
  const voisinage = SOURCE_TACHES.slice(iAncrage, iAncrage + 400);
  assert.match(voisinage, /if \(\$ancrage\.chemin\)/, 'le branchement chemin trouve/absent a disparu');
  const occurrencesLog = voisinage.match(/Write-SzhLog/g) || [];
  assert.strictEqual(occurrencesLog.length, 2,
    'attendu deux mentions de Write-SzhLog (une par branche du if/else), trouve ' + occurrencesLog.length);
});

// ---- Nettoyage : rien ne reste sous le dossier temporaire du système -----------------
try { fs.rmSync(TRAVAIL_1, { recursive: true, force: true }); } catch (e) { /* best effort */ }
try { fs.rmSync(TRAVAIL_2, { recursive: true, force: true }); } catch (e) { /* best effort */ }
