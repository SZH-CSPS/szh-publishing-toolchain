// Le lanceur unique (windows/open-produit.ps1) et ses deux enveloppes (open-revue.ps1,
// open-livre.ps1) : ce que l'unification des deux anciens scripts ne doit pas casser.
//
//   node --test "test/js/*.test.js"
//
// Les raccourcis du menu Demarrer et le protocole "szh:" visent open-revue.ps1 et
// open-livre.ps1 par leur nom (szh-shell.ps1, update.ps1) -- ces deux enveloppes restent
// donc les points d'entree reels, exerces ici en mode simulation (SZH_LANCEUR_SIMULE=1) :
// aucune fenetre WinForms ne s'ouvre, le script calcule ce qu'il aurait affiche et l'ecrit
// en JSON sur la sortie standard (voir l'en-tete d'open-produit.ps1).
//
// Sur une arborescence jetable (SZH_BASE), avec un config.json en emplacement "test" : deux
// numeros de revue (un en cours, un archive), une Zeitschrift, et un livre. Un seul pilote
// par produit (open-revue.ps1 -Produit revue|zeitschrift, open-livre.ps1) -- pas de driver
// PowerShell intermediaire, contrairement a socle-decoupage.test.js et raccourcis.test.js,
// puisque les deux enveloppes sont deja les scripts a executer directement.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const OUVRIR_REVUE = path.join(RACINE, 'windows', 'open-revue.ps1');
const OUVRIR_LIVRE = path.join(RACINE, 'windows', 'open-livre.ps1');

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

// ---- L'arborescence jetable : deux numeros de revue, une Zeitschrift, un livre ----
//
// PROGRAMDATA tient lieu de C:\ProgramData\SZH (config.json, state.json, logs, toolkit) --
// c'est ce que redirige $env:SZH_BASE (szh-common.ps1). BASE est un dossier distinct : celui
// que config.json (`basesRevues.dev`) designe comme racine des revues, Zeitschriften et
// livres -- separe de PROGRAMDATA, comme sur un vrai poste (2_Produkte n'est pas sous
// C:\ProgramData\SZH).
const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-'));
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
const BASE = path.join(TRAVAIL, 'Base');

function creerDossier(...segments) {
  const p = path.join(BASE, ...segments);
  fs.mkdirSync(p, { recursive: true });
  return p;
}
function ecrireYaml(dossier, nomFichier, lignes) {
  fs.writeFileSync(path.join(dossier, nomFichier), lignes.join('\n') + '\n', 'utf8');
}

fs.mkdirSync(PROGRAMDATA, { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA, 'config.json'), JSON.stringify({
  emplacementRevues: 'test',
  basesRevues: { dev: BASE },
}), 'utf8');
// La version installee : Get-SzhVersionInstallee lit d'abord <toolkit>\VERSION.
const VERSION_INSTALLEE = '2026.09.1-test';
fs.mkdirSync(path.join(PROGRAMDATA, 'toolkit'), { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA, 'toolkit', 'VERSION'), VERSION_INSTALLEE + '\n', 'utf8');

// Revue : un numero en cours, un numero archive.
const REVUE_ENCOURS = creerDossier('52_Revue', 'RV02_Redaction', '2026-01');
ecrireYaml(REVUE_ENCOURS, 'ausgabe.yaml', ['title: "Numero en cours"', 'revue: "revue"']);
const REVUE_ARCHIVE = creerDossier('52_Revue', 'RV99_Archives', '2020-05');
ecrireYaml(REVUE_ARCHIVE, 'ausgabe.yaml', ['title: "Numero archive"', 'revue: "revue"']);

// Zeitschrift : une seule, en cours -- jamais dans les listes de la revue, ni l'inverse.
const ZS_ENCOURS = creerDossier('53_Zeitschrift', 'ZS02_Redaktion', '2026-03');
ecrireYaml(ZS_ENCOURS, 'ausgabe.yaml', ['title: "Ausgabe Test"', 'revue: "zeitschrift"']);

// Livre : un seul, en cours -- affiche par son TITRE (buch.yaml), pas par le nom du dossier.
const LIVRE_ENCOURS = creerDossier('54_Buch', 'BU02_Redaktion', '2026-B300-MonLivre');
ecrireYaml(LIVRE_ENCOURS, 'buch.yaml', ['titre: "Mon Livre Test"', 'lang: "fr"']);

function executer(scriptPath, args) {
  if (!POWERSHELL) { return null; }
  const env = Object.assign({}, process.env, {
    SZH_BASE: PROGRAMDATA,
    SZH_LANCEUR_SIMULE: '1',
  });
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  let sortie = null;
  let erreurJson = null;
  if (run.stdout) {
    try { sortie = JSON.parse(run.stdout.trim()); } catch (e) { erreurJson = e; }
  }
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', sortie, erreurJson };
}

// Un seul passage par produit : chacun appelle une enveloppe differente, impossible a
// regrouper en un seul processus PowerShell comme le fait raccourcis.test.js.
const revue = (function () { return executer(OUVRIR_REVUE, ['-Produit', 'revue']); })();
const zeitschrift = (function () { return executer(OUVRIR_REVUE, ['-Produit', 'zeitschrift']); })();
const livre = (function () { return executer(OUVRIR_LIVRE, []); })();

// L'arborescence jetable n'est plus lue une fois les trois resultats captures ci-dessus :
// rien ne doit rester sous le dossier temporaire du systeme apres coup.
try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* best effort */ }

function verifierExecution(r, nom) {
  assert.ok(r, nom + ' : aucun resultat (powershell.exe indisponible ?)');
  assert.strictEqual(r.status, 0, nom + ' : le lanceur a echoue -- ' + r.stderr);
  assert.ok(r.sortie, nom + ' : sortie non JSON -- ' + r.stdout + ' / ' + r.stderr);
}

// ---- Revue : titre, liste, archive, version ----

test('open-revue.ps1 -Produit revue : titre, liste, archive, version, en mode simule',
  { skip: sansPowerShell }, () => {
    verifierExecution(revue, 'revue');
    const r = revue.sortie;
    assert.strictEqual(r.produit, 'revue');
    assert.match(r.titreFenetre, /^Revues SZH/, 'titre de fenetre inattendu : ' + r.titreFenetre);
    // La revue ne voit que ses propres numeros : un en cours, un archive -- ni la
    // Zeitschrift ni le livre, ranges ailleurs, ne peuvent y apparaitre.
    assert.strictEqual(r.enCours.length, 1, 'la revue ne devrait voir qu\'un numero en cours');
    assert.strictEqual(r.enCours[0].nom, '2026-01');
    assert.strictEqual(r.archives.length, 1, 'le numero archive doit apparaitre, et un seul');
    assert.strictEqual(r.archives[0].nom, '2020-05');
    assert.strictEqual(r.archives[0].archivee, true, 'un numero sous RV99_Archives doit se dire archive');
    assert.strictEqual(r.enCours[0].archivee, false);
    assert.strictEqual(r.versionInstallee, VERSION_INSTALLEE);
  });

// ---- Zeitschrift : meme enveloppe, produit different, liste different ----

test('open-revue.ps1 -Produit zeitschrift : sa propre liste, jamais celle de la revue',
  { skip: sansPowerShell }, () => {
    verifierExecution(zeitschrift, 'zeitschrift');
    const r = zeitschrift.sortie;
    assert.strictEqual(r.produit, 'zeitschrift');
    assert.match(r.titreFenetre, /^Zeitschriften SZH/, 'titre de fenetre inattendu : ' + r.titreFenetre);
    assert.strictEqual(r.enCours.length, 1);
    assert.strictEqual(r.enCours[0].nom, '2026-03');
    assert.strictEqual(r.archives.length, 0, 'aucune Zeitschrift archivee dans ce banc');
    assert.strictEqual(r.versionInstallee, VERSION_INSTALLEE);
  });

// ---- Livre : troisieme produit, sa propre enveloppe, etiquette par le TITRE ----

test('open-livre.ps1 : le livre ne voit que les livres, etiquete par son titre',
  { skip: sansPowerShell }, () => {
    verifierExecution(livre, 'livre');
    const r = livre.sortie;
    assert.strictEqual(r.produit, 'livre');
    assert.match(r.titreFenetre, /^Books SZH-CSPS/, 'titre de fenetre inattendu : ' + r.titreFenetre);
    assert.strictEqual(r.enCours.length, 1);
    assert.strictEqual(r.enCours[0].nom, '2026-B300-MonLivre');
    assert.strictEqual(r.enCours[0].titre, 'Mon Livre Test');
    // Etiquete par le titre, jamais par le nom du dossier -- a la difference de la revue.
    assert.ok(r.enCours[0].libelle.indexOf('Mon Livre Test') !== -1,
      'le libelle du livre doit porter son titre : ' + r.enCours[0].libelle);
    assert.strictEqual(r.archives.length, 0);
    assert.strictEqual(r.versionInstallee, VERSION_INSTALLEE);
  });

// ---- Etancheite entre les trois produits, sur les trois resultats a la fois ----

test('les trois listes sont etanches : aucun nom ne fuit d\'un produit vers un autre',
  { skip: sansPowerShell }, () => {
    verifierExecution(revue, 'revue');
    verifierExecution(zeitschrift, 'zeitschrift');
    verifierExecution(livre, 'livre');
    const nomsRevue = revue.sortie.enCours.concat(revue.sortie.archives).map((e) => e.nom);
    const nomsZs = zeitschrift.sortie.enCours.concat(zeitschrift.sortie.archives).map((e) => e.nom);
    const nomsLivre = livre.sortie.enCours.concat(livre.sortie.archives).map((e) => e.nom);
    assert.deepStrictEqual(nomsRevue.sort(), ['2020-05', '2026-01']);
    assert.deepStrictEqual(nomsZs, ['2026-03']);
    assert.deepStrictEqual(nomsLivre, ['2026-B300-MonLivre']);
    // Aucun recoupement entre les trois ensembles.
    for (const n of nomsRevue) {
      assert.ok(nomsZs.indexOf(n) === -1 && nomsLivre.indexOf(n) === -1, n + ' fuit hors de la revue');
    }
  });

// ---- Le mode simule ne charge aucune classe WinForms ----

test('SZH_LANCEUR_SIMULE=1 ne charge ni System.Windows.Forms ni System.Drawing',
  { skip: sansPowerShell }, () => {
    // Preuve indirecte mais suffisante : si Add-Type -AssemblyName System.Windows.Forms
    // avait tourne dans un contexte sans profil graphique, ou si EnableVisualStyles avait
    // ete appele hors d'une session interactive, l'un des trois appels aurait echoue avant
    // la moindre ligne de JSON -- le statut ne serait pas 0 et stdout resterait vide.
    for (const [nom, r] of [['revue', revue], ['zeitschrift', zeitschrift], ['livre', livre]]) {
      verifierExecution(r, nom);
    }
    // Et la garde textuelle, directe celle-la : le script lui-meme ne charge ces classes
    // que sous condition.
    const source = fs.readFileSync(path.join(RACINE, 'windows', 'open-produit.ps1'), 'utf8');
    const iSimule = source.indexOf('$script:SzhSimule = ($env:SZH_LANCEUR_SIMULE');
    const iAddType = source.indexOf('Add-Type -AssemblyName System.Windows.Forms');
    assert.ok(iSimule !== -1 && iAddType !== -1, 'le drapeau ou le chargement WinForms a disparu');
    assert.ok(iSimule < iAddType, 'le drapeau de simulation doit etre lu avant le chargement WinForms');
    const gardeAvant = source.slice(Math.max(0, iAddType - 260), iAddType);
    assert.ok(gardeAvant.indexOf('if (-not $script:SzhSimule)') !== -1,
      'Add-Type WinForms n\'est plus protege par le mode simulation');
  });
