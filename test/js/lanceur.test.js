// Les deux entrées « Pronto » (windows/open-revue.ps1, et open-livre.ps1 qui lui renvoie) et
// ce que leur démarrage pose sur le poste, en mode simulé (SZH_LANCEUR_SIMULE=1) : aucune
// fenêtre ne s'ouvre, Start-SzhAccueil écrit son plan en JSON. S'y ajoutent les cascades du
// socle qui décident de l'emplacement et de la langue.
//
//   node --test "test/js/*.test.js"
//
// Sur une arborescence jetable : SZH_BASE, les deux racines, l'ancrage et le cockpit sont
// détournés, pour que les tâches de démarrage n'écrivent jamais sur le vrai poste.
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
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const TEXTES_PS1 = path.join(RACINE, 'windows', 'szh-textes.ps1');

// Le nom définitif de l'application n'est pas arrêté (voir windows/szh-shell.ps1) : il vit à
// UN seul endroit, $script:SzhNomApplication, et ce fichier le LIT plutôt que de le recopier
// en dur -- sans quoi un futur baptême casserait ce test sans avoir rien cassé de réel.
const SHELL = fs.readFileSync(path.join(RACINE, 'windows', 'szh-shell.ps1'), 'utf8');
const mNom = SHELL.match(/\$script:SzhNomApplication\s*=\s*'([^']+)'/);
assert.ok(mNom, 'szh-shell.ps1 ne déclare plus $script:SzhNomApplication');
const NOM_APPLICATION = mNom[1];

const { POWERSHELL, sansPowerShell } = require('./gardes');

// Échappe les caractères spéciaux d'une regex -- NOM_APPLICATION porte un « & », inoffensif
// en regex, mais un futur nom pourrait porter autre chose.
function echapperRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const TITRE_SUITE = new RegExp('^' + echapperRegex(NOM_APPLICATION));

// ---- L'arborescence jetable : deux numeros de revue, une Zeitschrift, un livre ----
//
// PROGRAMDATA tient lieu de C:\ProgramData\SZH (config.json, state.json, logs, toolkit) --
// c'est ce que redirige $env:SZH_BASE (szh-common.ps1). BASE est un dossier distinct : la
// racine des revues, Zeitschriften et livres -- separee de PROGRAMDATA, comme sur un vrai
// poste (l'arbre de production n'est pas sous C:\ProgramData\SZH).
//
// Cette racine-la est posee par $env:SZH_RACINE_TEST, et c'est desormais le SEUL moyen de la
// detourner vers un dossier jetable : la cle de config.json qui le permettait a ete
// supprimee le 15.09.2026 (elle primait sur tout, y compris sur l'ancrage SharePoint). La
// variable suit le modele de $env:SZH_ANCRAGE et $env:SZH_RAPPORTS -- reservee aux essais,
// jamais ecrite nulle part. Voir Get-SzhBaseRevuesPour (windows/szh-produits.ps1).
const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-'));
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
const BASE = path.join(TRAVAIL, 'Base');
const ANCRAGE_JETABLE = path.join(TRAVAIL, 'sp', 'Daten_Allgemein - General');
fs.mkdirSync(ANCRAGE_JETABLE, { recursive: true });

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
}), 'utf8');
// La version installee : Get-SzhVersionInstallee lit d'abord <toolkit>\VERSION.
const VERSION_INSTALLEE = '2026.09.1-test';
fs.mkdirSync(path.join(PROGRAMDATA, 'toolkit'), { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA, 'toolkit', 'VERSION'), VERSION_INSTALLEE + '\n', 'utf8');

// L'arborescence, dans sa forme arretee le 15.09.2026 : un numero EN COURS directement sous
// son dossier produit, un numero ARCHIVE sous « _Archive\<Produit> ». Les deux etats n'ont
// donc pas la meme profondeur, et c'est volontaire -- ce banc est le seul a les exercer tous
// les deux par un vrai processus PowerShell.
//
// Revue : un numero en cours, un numero archive.
const REVUE_ENCOURS = creerDossier('Revue', '2026-01');
ecrireYaml(REVUE_ENCOURS, 'ausgabe.yaml', ['title: "Numero en cours"', 'revue: "revue"']);
const REVUE_ARCHIVE = creerDossier('_Archive', 'Revue', '2020-05');
ecrireYaml(REVUE_ARCHIVE, 'ausgabe.yaml', ['title: "Numero archive"', 'revue: "revue"']);

// Zeitschrift : une seule, en cours -- jamais dans les listes de la revue, ni l'inverse.
const ZS_ENCOURS = creerDossier('Zeitschrift', '2026-03');
ecrireYaml(ZS_ENCOURS, 'ausgabe.yaml', ['title: "Ausgabe Test"', 'revue: "zeitschrift"']);

// Livre : un seul, en cours -- affiche par son TITRE (buch.yaml), pas par le nom du dossier.
const LIVRE_ENCOURS = creerDossier('Books', '2026-B300-MonLivre');
ecrireYaml(LIVRE_ENCOURS, 'buch.yaml', ['titre: "Mon Livre Test"', 'lang: "fr"']);

// ---- Deuxieme arborescence jetable, en emplacement "production" cette fois : de quoi
// verifier que `emplacement` et `modeTest` suivent config.json plutot que le defaut "test"
// -- Resolve-SzhEmplacementRevues, Get-SzhBaseRevuesPour (szh-produits.ps1). La racine de
// production vient de $env:SZH_RACINE_PROD : sans elle, Get-SzhBaseRevuesPour irait chercher
// un ancrage SharePoint sur le vrai disque du poste qui fait tourner ces tests.
const TRAVAIL_PROD = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-prod-'));
const PROGRAMDATA_PROD = path.join(TRAVAIL_PROD, 'ProgramData');
const BASE_PROD = path.join(TRAVAIL_PROD, 'Base');
fs.mkdirSync(PROGRAMDATA_PROD, { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA_PROD, 'config.json'), JSON.stringify({
  emplacementRevues: 'production',
}), 'utf8');
fs.mkdirSync(path.join(PROGRAMDATA_PROD, 'toolkit'), { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA_PROD, 'toolkit', 'VERSION'), VERSION_INSTALLEE + '\n', 'utf8');

function executer(scriptPath, args, programData) {
  if (!POWERSHELL) { return null; }
  const env = Object.assign({}, process.env, {
    SZH_BASE: programData || PROGRAMDATA,
    SZH_LANCEUR_SIMULE: '1',
    // Les deux racines, toujours posees toutes les deux : celle qui ne sert pas au scenario
    // doit quand meme etre detournee, sinon un comptage de numeros (Measure-SzhNumeros, appele
    // par Initialize-SzhEmplacementRevues) irait lire le vrai OneDrive du poste.
    SZH_RACINE_TEST: BASE,
    SZH_RACINE_PROD: BASE_PROD,
    // Un ancrage jetable : sans lui, le check-in du démarrage écrirait dans le vrai dossier
    // partagé du poste. Et le cockpit du dépôt, sans lequel l'Accueil refuse de s'ouvrir.
    SZH_ANCRAGE: ANCRAGE_JETABLE,
    SZH_RAPPORTS: path.join(TRAVAIL, 'rapports'),
    LOCALAPPDATA: path.join(TRAVAIL, 'Local'),
    SZH_COCKPIT_DOSSIER: path.join(RACINE, 'vscodium-extension', 'szh-cockpit'),
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

// Les deux entrées, chacune dans son processus.
const accueil = (function () { return executer(OUVRIR_REVUE, []); })();
const livre = (function () { return executer(OUVRIR_LIVRE, []); })();
// Les emplacements des deux arborescences, lus avant leur suppression plus bas.
const emplacementProd = emplacements(PROGRAMDATA_PROD);
const emplacementEssai = emplacements(PROGRAMDATA);

// ---- L'arbre que le lanceur a CREE dans la racine d'essai ----
// Initialize-SzhEmplacementsTest ne tourne qu'en mode test, et il est la seule chose du
// produit qui ecrive une arborescence : c'est donc ici, et nulle part ailleurs, qu'on peut
// verifier la FORME de l'arbre plutot que la seule capacite a y retrouver un numero. Releve
// AVANT la suppression du dossier jetable, puisque c'est lui qu'on inspecte.
const ARBRE_CREE = (function () {
  const vus = {};
  for (const relatif of [
    'Revue', 'Zeitschrift', 'Books',
    path.join('_Archive', 'Revue'), path.join('_Archive', 'Zeitschrift'), path.join('_Archive', 'Books'),
    path.join('_NewsUndActu', 'Fiches'), path.join('_NewsUndActu', '_Statuts', 'fr'),
    path.join('_NewsUndActu', '_Statuts', 'de'),
    'Exports', 'Secrétariat und Export',
    // Ce qui ne doit PLUS exister : les niveaux supprimes le 15.09.2026.
    path.join('Revue', '01_Redaction'), path.join('Zeitschrift', '01_Redaktion'),
    path.join('Books', '01_Redaktion'), path.join('Revue', '99_Archives'),
    path.join('Zeitschrift', '99_Archiv'), path.join('Books', '99_Archiv'),
    // Ce qui ne doit JAMAIS etre cree sous la racine de test : _Systeme vit TOUJOURS sur
    // SharePoint (Get-SzhDossierSysteme, depuis le 23.09.2026), et l'ancien magasin par
    // revue, remplace par la bibliotheque ci-dessus.
    path.join('_Systeme', 'rapports'), path.join('_Systeme', 'journaux'),
    path.join('_Systeme', 'suggestions'), path.join('_Systeme', 'inventaire'),
    path.join('_NewsUndActu', 'Revue'), path.join('_NewsUndActu', 'Zeitschrift')
  ]) {
    let la = false;
    try { la = fs.statSync(path.join(BASE, relatif)).isDirectory(); } catch (e) { la = false; }
    vus[relatif] = la;
  }
  return vus;
})();

// La GRAPHIE reellement ecrite sur le disque, releve a part et par lecture de repertoire.
// Windows ne distingue pas la casse : ARBRE_CREE ci-dessus repondrait vrai pour
// `_NewsUndActu\Revue` alors meme que le lanceur aurait cree `_newsundactu\revue`. Seul
// readdirSync rend le nom tel qu'il a ete ecrit, et c'est lui qui prouve que le produit
// cree des dossiers faits pour etre lus, et non ses jetons internes.
const NOMS_REELS = (function () {
  function lire(relatif) {
    try { return fs.readdirSync(path.join(BASE, relatif)).sort(); } catch (e) { return null; }
  }
  return { racine: lire('.'), magasin: lire('_NewsUndActu'), statuts: lire(path.join('_NewsUndActu', '_Statuts')) };
})();

// L'arborescence jetable n'est plus lue une fois les resultats captures ci-dessus : rien ne
// doit rester sous le dossier temporaire du systeme apres coup.
try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* best effort */ }
try { fs.rmSync(TRAVAIL_PROD, { recursive: true, force: true }); } catch (e) { /* best effort */ }

function verifierExecution(r, nom) {
  assert.ok(r, nom + ' : aucun resultat (powershell.exe indisponible ?)');
  assert.strictEqual(r.status, 0, nom + ' : le lanceur a echoue -- ' + r.stderr);
  assert.ok(r.sortie, nom + ' : sortie non JSON -- ' + r.stdout + ' / ' + r.stderr);
}

// ---- L'arborescence d'essai : la forme, pas seulement le contenu ----

test('le lanceur cree l\'arbre d\'essai dans sa forme du 15.09.2026, et rien de l\'ancienne',
  { skip: sansPowerShell }, () => {
    // Les trois produits a la RACINE : un numero en cours n'a plus de niveau de redaction
    // au-dessus de lui.
    for (const d of ['Revue', 'Zeitschrift', 'Books']) {
      assert.strictEqual(ARBRE_CREE[d], true, 'dossier produit manquant a la racine : ' + d);
    }
    // Les archives REGROUPEES, un sous-dossier par produit, avec la capitale du dossier
    // produit : ces trois-la se lisent a l'Explorateur, ce ne sont pas des jetons de code.
    for (const d of ['Revue', 'Zeitschrift', 'Books']) {
      assert.strictEqual(ARBRE_CREE[path.join('_Archive', d)], true,
        'archives manquantes sous _Archive : ' + d);
    }
    // Le reste de l'arbre, qui suit la racine active : la bibliotheque de fiches, sous sa
    // forme du 23.09.2026 (Fiches\, _Statuts\fr\, _Statuts\de\ -- plus l'ancien magasin par
    // revue), et Exports, ou le cockpit range les sorties du secretariat.
    for (const d of [path.join('_NewsUndActu', 'Fiches'), path.join('_NewsUndActu', '_Statuts', 'fr'),
      path.join('_NewsUndActu', '_Statuts', 'de'), 'Exports']) {
      assert.strictEqual(ARBRE_CREE[d], true, 'dossier commun manquant : ' + d);
    }
    // Et l'ancienne forme a bien disparu : sans ce controle, une table oubliee a moitie
    // creerait les deux arborescences cote a cote, et personne ne verrait laquelle sert.
    // _Systeme\, lui, n'a JAMAIS ete cree ici : il vit toujours sur SharePoint
    // (Get-SzhDossierSysteme), meme quand le lanceur tourne en mode test.
    for (const d of [path.join('Revue', '01_Redaction'), path.join('Zeitschrift', '01_Redaktion'),
      path.join('Books', '01_Redaktion'), path.join('Revue', '99_Archives'),
      path.join('Zeitschrift', '99_Archiv'), path.join('Books', '99_Archiv'),
      path.join('_NewsUndActu', 'Revue'), path.join('_NewsUndActu', 'Zeitschrift'),
      'Secrétariat und Export', path.join('_Systeme', 'rapports'), path.join('_Systeme', 'journaux'),
      path.join('_Systeme', 'suggestions'), path.join('_Systeme', 'inventaire')]) {
      assert.strictEqual(ARBRE_CREE[d], false, 'ne devrait pas etre cree sous la racine de test : ' + d);
    }
  });

test('la bibliotheque partagee et ses sous-dossiers sont CREES avec leur capitale',
  { skip: sansPowerShell }, () => {
    assert.ok(NOMS_REELS.racine, 'la racine d\'essai n\'a pas pu etre lue');
    assert.ok(NOMS_REELS.racine.indexOf('_NewsUndActu') !== -1,
      'la bibliotheque creee ne s\'appelle pas _NewsUndActu : ' + NOMS_REELS.racine.join(', '));
    assert.strictEqual(NOMS_REELS.racine.indexOf('_newsundactu'), -1,
      'la bibliotheque a ete creee en minuscules');

    assert.deepStrictEqual(NOMS_REELS.magasin, ['Fiches', '_Statuts'],
      'les sous-dossiers de la bibliotheque ne portent pas leur forme du 23.09.2026 : '
      + String(NOMS_REELS.magasin));
    assert.deepStrictEqual(NOMS_REELS.statuts, ['de', 'fr'],
      '_NewsUndActu\\_Statuts ne porte pas ses deux sous-dossiers de langue : '
      + String(NOMS_REELS.statuts));
  });

// ---- Les deux entrées ouvrent l'Accueil ----

test('open-revue.ps1 et open-livre.ps1 ouvrent l’Accueil, après les mêmes tâches de démarrage',
  { skip: sansPowerShell }, () => {
    verifierExecution(accueil, 'open-revue');
    verifierExecution(livre, 'open-livre');
    assert.strictEqual(accueil.sortie.entree, 'accueil');
    assert.strictEqual(livre.sortie.entree, 'accueil', 'open-livre.ps1 n’ouvre plus l’Accueil');
    assert.deepStrictEqual(livre.sortie.taches, accueil.sortie.taches);
    assert.ok(accueil.sortie.taches.indexOf('Initialize-SzhEmplacementsTest') !== -1,
      'l’arbre d’essai n’est plus créé au démarrage');
  });

// ---- Emplacement "production" dans config.json : emplacement et modeTest en decoulent ----
// Get-SzhEmplacements (szh-produits.ps1), lu sur chacune des deux arborescences jetables.
// Déclarée ici, appelée plus haut, avant que les arborescences ne soient supprimées.
function emplacements(programData) {
  if (!POWERSHELL) { return null; }
  const env = Object.assign({}, process.env, {
    SZH_BASE: programData, SZH_RACINE_TEST: BASE, SZH_RACINE_PROD: BASE_PROD, SZH_ANCRAGE: ANCRAGE_JETABLE
  });
  const commande = '. "' + COMMUN_PS1 + '"; $e = Get-SzhEmplacements; ' +
    '[Console]::Out.Write((@{ emplacement = $e.emplacement; modeTest = ($e.emplacement -eq $SzhEmplacementTest); base = $e.base } | ConvertTo-Json -Compress))';
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commande],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  let sortie = null;
  try { sortie = JSON.parse(String(run.stdout || '').trim()); } catch (e) { /* rapporté par le test */ }
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', sortie };
}

test('emplacementRevues "production" : emplacement et modeTest suivent, jamais le defaut test',
  { skip: sansPowerShell }, () => {
    const prod = emplacementProd;
    verifierExecution(prod, 'production');
    assert.strictEqual(prod.sortie.emplacement, 'production', 'emplacement attendu : production');
    assert.strictEqual(prod.sortie.modeTest, false, 'modeTest doit etre faux en emplacement production');
    assert.strictEqual(prod.sortie.base, BASE_PROD);
    const essai = emplacementEssai;
    verifierExecution(essai, 'test');
    assert.strictEqual(essai.sortie.emplacement, 'test');
    assert.strictEqual(essai.sortie.modeTest, true);
    assert.strictEqual(essai.sortie.base, BASE);
  });

// ---- La cascade de la langue ----
// Un pilote dédié, sur une arborescence minimale (un seul config.json, aucune revue) : la
// cascade ne dépend que des réglages du poste et du compte. Chaque appel isole SON PROPRE
// dossier jetable pour state.json (SZH_BASE) et etat-utilisateur.json (LOCALAPPDATA).

function langueDuSocle(options) {
  options = options || {};
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-cascade-'));
  const programData = path.join(travail, 'ProgramData');
  const localAppData = path.join(travail, 'Local');
  fs.mkdirSync(programData, { recursive: true });
  fs.mkdirSync(path.join(localAppData, 'SZH'), { recursive: true });
  fs.writeFileSync(path.join(programData, 'config.json'),
    JSON.stringify({ emplacementRevues: 'test' }), 'utf8');
  if (options.stateJson) {
    fs.writeFileSync(path.join(programData, 'state.json'), JSON.stringify(options.stateJson), 'utf8');
  }
  if (options.etatUtilisateur) {
    fs.writeFileSync(path.join(localAppData, 'SZH', 'etat-utilisateur.json'),
      JSON.stringify(options.etatUtilisateur), 'utf8');
  }
  const env = Object.assign({}, process.env, { SZH_BASE: programData, LOCALAPPDATA: localAppData });
  delete env.SZH_LANGUE;
  if (options.envLangue) { env.SZH_LANGUE = options.envLangue; }
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    '. "' + COMMUN_PS1 + '"; [Console]::Out.Write($SzhLangue)'],
  { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  fs.rmSync(travail, { recursive: true, force: true });
  return { status: run.status, stderr: run.stderr || '', langue: String(run.stdout || '').trim() };
}

test('la cascade de $SzhLangue : cinq échelons, et le repli à « de », jamais « en »',
  { skip: sansPowerShell }, () => {
    // Échelon 5 (le plus explicite) : $env:SZH_LANGUE l'emporte sur tout le reste.
    let r = langueDuSocle({ stateJson: { langue: 'fr' }, etatUtilisateur: { langueInterface: 'fr' }, envLangue: 'de' });
    assert.ok(r && r.status === 0 && r.langue, 'échelon 5 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.langue, 'de', '$env:SZH_LANGUE ne garde plus le dernier mot');

    // Échelon 4 : le choix du compte (etat-utilisateur.json, langueInterface) l'emporte sur
    // state.json et sur Windows, tant que rien de plus explicite n'est fourni.
    r = langueDuSocle({ stateJson: { langue: 'fr' }, etatUtilisateur: { langueInterface: 'de' } });
    assert.ok(r && r.status === 0 && r.langue, 'échelon 4 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.langue, 'de', 'le choix du compte ne l’emporte plus sur state.json');

    // Échelon 3 : state.json (l'héritage, celui qu'écrivait l'ancien lanceur) l'emporte sur
    // Windows et sur le repli, tant que le compte n'a rien choisi lui-même.
    r = langueDuSocle({ stateJson: { langue: 'fr' } });
    assert.ok(r && r.status === 0 && r.langue, 'échelon 3 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.langue, 'fr', 'state.json ne l’emporte plus sur Windows/le repli');

    // Échelons 1 et 2, ensemble : rien de plus explicite n'est fourni, donc le résultat suit
    // Windows s'il parle fr ou de, sinon retombe sur 'de' -- jamais 'en'. L'attendu est
    // calculé ici à partir de la VRAIE langue d'affichage de Windows sur cette machine,
    // interrogée indépendamment (pas en rappelant Get-SzhLangueAutomatique, ce qui
    // éprouverait la fonction contre elle-même) : ce test reste donc correct que le poste
    // qui l'exécute soit lui-même en français, en allemand, ou dans une troisième langue.
    const sondeCulture = spawnSync(POWERSHELL, ['-NoProfile', '-Command',
      '(Get-UICulture).TwoLetterISOLanguageName'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    const langueWindows = (sondeCulture.stdout || '').trim().toLowerCase();
    const attendu = (langueWindows === 'fr' || langueWindows === 'de') ? langueWindows : 'de';
    r = langueDuSocle({});
    assert.ok(r && r.status === 0 && r.langue, 'échelons 1-2 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.langue, attendu,
      'sans aucune préférence, la langue devrait suivre Windows (fr/de) ou retomber sur « de »');
    assert.notStrictEqual(r.langue, 'en', 'le repli est retombé sur « en », pas sur « de »');
    // Et le littéral source le confirme, indépendamment de la langue de CE poste-ci.
    const commun = fs.readFileSync(path.join(RACINE, 'windows', 'szh-common.ps1'), 'utf8');
    assert.match(commun, /\$script:SzhLangue = 'de'/,
      'le repli de $SzhLangue n’est plus la littérale \'de\'');
  });

// ---- Le mode simule ne charge aucune classe WinForms ----

test('SZH_LANCEUR_SIMULE=1 ne charge ni System.Windows.Forms ni System.Drawing',
  { skip: sansPowerShell }, () => {
    // Preuve indirecte : sans profil graphique, un Add-Type WinForms aurait fait échouer
    // l'appel avant la moindre ligne de JSON.
    for (const [nom, r] of [['open-revue', accueil], ['open-livre', livre]]) {
      verifierExecution(r, nom);
    }
    // Et la garde textuelle : le sélecteur de version (open-revue.ps1 -Versions) et le refus
    // d'un cockpit trop ancien (Start-SzhAccueil) lisent la simulation avant de charger WinForms.
    const revue = fs.readFileSync(OUVRIR_REVUE, 'utf8');
    const iVersions = revue.indexOf('if ($Versions) {');
    const iSimule = revue.indexOf("$env:SZH_LANCEUR_SIMULE -eq '1'", iVersions);
    const iAddType = revue.indexOf('Add-Type -AssemblyName System.Windows.Forms', iVersions);
    assert.ok(iVersions !== -1 && iSimule !== -1 && iAddType !== -1, 'le drapeau ou le chargement WinForms a disparu');
    assert.ok(iSimule < iAddType, 'open-revue.ps1 -Versions charge WinForms avant de lire la simulation');
    const shell = fs.readFileSync(path.join(RACINE, 'windows', 'szh-shell.ps1'), 'utf8');
    const iAccueil = shell.indexOf('function Start-SzhAccueil');
    const corps = shell.slice(iAccueil, shell.indexOf('\n}', iAccueil));
    const iSimuleAccueil = corps.indexOf('if ($simule) {');
    const iAddTypeAccueil = corps.indexOf('Add-Type -AssemblyName System.Windows.Forms');
    assert.ok(iAccueil !== -1 && iSimuleAccueil !== -1 && iAddTypeAccueil !== -1, 'Start-SzhAccueil a changé de forme');
    assert.ok(iSimuleAccueil < iAddTypeAccueil, 'Start-SzhAccueil charge WinForms avant de lire la simulation');
  });

// ---- Node sous VSCodium : lecture non bloquante ----
// Mesure du 15.09.2026 : une lecture bloquante de stdout figeait toute la fenêtre pendant
// une moisson OAI-PMH, et les gestionnaires d'événements de Process ont tué le processus
// entier sur ce poste, sans exception à attraper.

test('Invoke-SzhNodeCockpit lit stdout sans bloquer, et aucune API interdite ne revient', () => {
  const dossierWindows = path.join(RACINE, 'windows');
  const sources = fs.readdirSync(dossierWindows).filter((n) => n.endsWith('.ps1'))
    .map((n) => [n, fs.readFileSync(path.join(dossierWindows, n), 'utf8')]);
  // On ne cherche que l'APPEL -- un nom suivi d'une parenthèse : les noms seuls apparaissent
  // à bon droit dans le commentaire qui explique l'interdiction.
  for (const [nom, source] of sources) {
    for (const api of ['add_ErrorDataReceived', 'BeginErrorReadLine', 'add_OutputDataReceived']) {
      assert.ok(!new RegExp('\\.?' + api + '\\s*\\(', 'i').test(source),
        nom + ' appelle ' + api + ' : interdit, voir la mesure du 15.09.2026');
    }
    assert.ok(source.indexOf('StandardOutput.ReadLine()') === -1, nom + ' lit stdout de façon bloquante (ReadLine)');
  }
  const shell = fs.readFileSync(path.join(dossierWindows, 'szh-shell.ps1'), 'utf8');
  assert.ok(shell.indexOf('StandardOutput.ReadLineAsync()') !== -1,
    'Invoke-SzhNodeCockpit ne lit plus stdout de façon asynchrone (ReadLineAsync)');
});

test('secretariat : le dossier des gabarits ne s\'affiche plus nulle part', () => {
  // La clé ELLE-MÊME a disparu (pas seulement son affichage) : ni dans aucune des trois
  // tables de texte, ni ailleurs dans windows/.
  const dossierWindows = path.join(RACINE, 'windows');
  for (const nom of fs.readdirSync(dossierWindows)) {
    if (!nom.endsWith('.ps1')) { continue; }
    const source = fs.readFileSync(path.join(dossierWindows, nom), 'utf8');
    assert.ok(source.indexOf('lanceur.secretariat.gabarits') === -1,
      nom + ' porte encore la clé lanceur.secretariat.gabarits');
  }
  const doc = fs.readFileSync(path.join(RACINE, 'userdoc.md'), 'utf8');
  assert.ok(doc.indexOf('lanceur.secretariat.gabarits') === -1,
    'userdoc.md porte encore la clé lanceur.secretariat.gabarits');
});
