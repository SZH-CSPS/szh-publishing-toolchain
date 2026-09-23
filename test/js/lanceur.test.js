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
const OUVRIR_PRODUIT = path.join(RACINE, 'windows', 'open-produit.ps1');
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
// Meme enveloppe que "revue" ci-dessus, mais contre la deuxieme arborescence -- emplacement
// "production" dans son config.json, et non plus le defaut "test".
const production = (function () { return executer(OUVRIR_REVUE, ['-Produit', 'revue'], PROGRAMDATA_PROD); })();

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
    'Secrétariat und Export',
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
    // revue), et Secretariat und Export.
    for (const d of [path.join('_NewsUndActu', 'Fiches'), path.join('_NewsUndActu', '_Statuts', 'fr'),
      path.join('_NewsUndActu', '_Statuts', 'de'), 'Secrétariat und Export']) {
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
      path.join('_Systeme', 'rapports'), path.join('_Systeme', 'journaux'),
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

// ---- Revue : titre, liste, archive, version ----

test('open-revue.ps1 -Produit revue : titre, liste, archive, version, en mode simule',
  { skip: sansPowerShell }, () => {
    verifierExecution(revue, 'revue');
    const r = revue.sortie;
    assert.strictEqual(r.produit, 'revue');
    // Glissement du 13.09.2026 : il n'y a plus un titre par produit (« Revues SZH ») mais un
    // seul titre, commun aux trois onglets (lanceur.titre.suite) -- c'est l'onglet actif, pas
    // le titre, qui dit quel produit est ouvert.
    assert.match(r.titreFenetre, TITRE_SUITE, 'titre de fenetre inattendu : ' + r.titreFenetre);
    // La revue ne voit que ses propres numeros : un en cours, un archive -- ni la
    // Zeitschrift ni le livre, ranges ailleurs, ne peuvent y apparaitre.
    assert.strictEqual(r.enCours.length, 1, 'la revue ne devrait voir qu\'un numero en cours');
    assert.strictEqual(r.enCours[0].nom, '2026-01');
    assert.strictEqual(r.archives.length, 1, 'le numero archive doit apparaitre, et un seul');
    assert.strictEqual(r.archives[0].nom, '2020-05');
    assert.strictEqual(r.archives[0].archivee, true, 'un numero sous _Archive doit se dire archive');
    // Et l'inverse, qui est le vrai piege du regroupement des archives : « _Archive\Revue »
    // et « Revue » se terminent par le meme segment. Un numero EN COURS ne doit jamais
    // basculer du cote archive -- c'est ce que garantit la comparaison par EGALITE des
    // racines dans Get-SzhInventaireProduit (open-produit.ps1).
    assert.strictEqual(r.enCours[0].archivee, false, 'un numero en cours ne doit jamais se dire archive');
    assert.strictEqual(r.versionInstallee, VERSION_INSTALLEE);
    // Poste de test : l'emplacement actif le dit en clair, modeTest en decoule, et
    // l'etiquette de racine (jointe au titre par le jeton {racine}) n'est jamais vide.
    assert.strictEqual(r.emplacement, 'test', 'emplacement attendu : test');
    assert.strictEqual(r.modeTest, true, 'modeTest doit etre vrai en emplacement test');
    assert.ok(r.etiquetteRacine && r.etiquetteRacine.length > 0, 'etiquetteRacine ne doit pas etre vide');
  });

// ---- Zeitschrift : meme enveloppe, produit different, liste different ----

test('open-revue.ps1 -Produit zeitschrift : sa propre liste, jamais celle de la revue',
  { skip: sansPowerShell }, () => {
    verifierExecution(zeitschrift, 'zeitschrift');
    const r = zeitschrift.sortie;
    assert.strictEqual(r.produit, 'zeitschrift');
    // Le même titre commun qu'au test précédent, malgré un onglet différent -- justement ce
    // que garde ce test.
    assert.match(r.titreFenetre, TITRE_SUITE, 'titre de fenetre inattendu : ' + r.titreFenetre);
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
    // Là encore le titre commun -- ce sont les listes ci-dessous qui distinguent le livre.
    assert.match(r.titreFenetre, TITRE_SUITE, 'titre de fenetre inattendu : ' + r.titreFenetre);
    assert.strictEqual(r.enCours.length, 1);
    assert.strictEqual(r.enCours[0].nom, '2026-B300-MonLivre');
    assert.strictEqual(r.enCours[0].titre, 'Mon Livre Test');
    // Etiquete par le titre, jamais par le nom du dossier -- a la difference de la revue.
    assert.ok(r.enCours[0].libelle.indexOf('Mon Livre Test') !== -1,
      'le libelle du livre doit porter son titre : ' + r.enCours[0].libelle);
    assert.strictEqual(r.archives.length, 0);
    assert.strictEqual(r.versionInstallee, VERSION_INSTALLEE);
  });

// ---- Emplacement "production" dans config.json : emplacement et modeTest en decoulent ----

test('emplacementRevues "production" : emplacement et modeTest suivent, jamais le defaut test',
  { skip: sansPowerShell }, () => {
    verifierExecution(production, 'production');
    const r = production.sortie;
    assert.strictEqual(r.emplacement, 'production', 'emplacement attendu : production');
    assert.strictEqual(r.modeTest, false, 'modeTest doit etre faux en emplacement production');
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

// ---- Le JSON de simulation porte les trois produits, étanches entre eux ----
// Pas seulement entre trois appels séparés (le test ci-dessus) : DANS UN SEUL ET MÊME JSON,
// `produits` porte les trois blocs -- ouvrir sur l'onglet Revue ne doit pas priver les
// lecteurs (diagnostic, tests d'ouverture) de ce que les deux autres onglets auraient
// montré.

test('le JSON de simulation porte les trois produits dans `produits`, étanches entre eux',
  { skip: sansPowerShell }, () => {
    verifierExecution(revue, 'revue');
    const p = revue.sortie.produits;
    assert.ok(p && p.revue && p.zeitschrift && p.livre,
      'les trois produits ne sont pas tous dans `produits` : ' + JSON.stringify(Object.keys(p || {})));
    assert.strictEqual(p.revue.enCours.length, 1);
    assert.strictEqual(p.revue.enCours[0].nom, '2026-01');
    assert.strictEqual(p.revue.archives.length, 1);
    assert.strictEqual(p.revue.archives[0].nom, '2020-05');
    assert.strictEqual(p.zeitschrift.enCours.length, 1);
    assert.strictEqual(p.zeitschrift.enCours[0].nom, '2026-03');
    assert.strictEqual(p.zeitschrift.archives.length, 0);
    assert.strictEqual(p.livre.enCours.length, 1);
    assert.strictEqual(p.livre.enCours[0].nom, '2026-B300-MonLivre');
    assert.strictEqual(p.livre.archives.length, 0);
    // Chaque bloc porte aussi son propre onglet et ses propres racines -- pas seulement ses
    // listes -- et les racines ne se recopient pas d'un produit à l'autre.
    assert.strictEqual(p.revue.onglet, 'Revue');
    assert.strictEqual(p.zeitschrift.onglet, 'Zeitschrift');
    assert.strictEqual(p.livre.onglet, 'Book');
    assert.notStrictEqual(p.revue.racineEnCours, p.zeitschrift.racineEnCours);
    assert.notStrictEqual(p.revue.racineEnCours, p.livre.racineEnCours);
    // Étanche à l'intérieur de ce MÊME JSON : aucun nom ne fuit d'un bloc à l'autre.
    const noms = {
      revue: p.revue.enCours.concat(p.revue.archives).map((e) => e.nom),
      zeitschrift: p.zeitschrift.enCours.concat(p.zeitschrift.archives).map((e) => e.nom),
      livre: p.livre.enCours.concat(p.livre.archives).map((e) => e.nom)
    };
    for (const a of Object.keys(noms)) {
      for (const b of Object.keys(noms)) {
        if (a === b) { continue; }
        for (const n of noms[a]) {
          assert.ok(noms[b].indexOf(n) === -1, n + ' (dans produits.' + a + ') fuit aussi dans produits.' + b);
        }
      }
    }
  });

// ---- Cascades : quel onglet s'ouvre, quelle langue parle la fenêtre ----
// Un pilote dédié, sur une arborescence minimale (un seul config.json, aucune revue) : ces
// deux cascades ne dépendent d'aucun contenu, seulement des réglages du poste et du compte.
// Chaque appel isole SON PROPRE dossier jetable pour state.json (SZH_BASE) et
// etat-utilisateur.json (LOCALAPPDATA), afin qu'un scénario n'en influence jamais un autre.

function executerProduit(options) {
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
  const env = Object.assign({}, process.env, {
    SZH_BASE: programData,
    LOCALAPPDATA: localAppData,
    SZH_LANCEUR_SIMULE: '1',
  });
  delete env.SZH_LANGUE;
  delete env.SZH_ONGLET;
  if (options.envLangue) { env.SZH_LANGUE = options.envLangue; }
  if (options.envOnglet) { env.SZH_ONGLET = options.envOnglet; }
  const args = [];
  if (options.produit) { args.push('-Produit', options.produit); }
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', OUVRIR_PRODUIT, ...args],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  fs.rmSync(travail, { recursive: true, force: true });
  let sortie = null;
  try { sortie = JSON.parse((run.stdout || '').trim()); } catch (e) { /* rapporté par l'appelant */ }
  return { status: run.status, stderr: run.stderr || '', stdout: run.stdout || '', sortie };
}

test('Get-SzhOngletDefaut : quatre échelons, le livre jamais par défaut, -Produit devant le réglage du compte',
  { skip: sansPowerShell }, () => {
    // Échelon 1 (le plus deviné) : la langue résolue seule décide. Zéro configuration
    // explicite d'onglet ici -- SZH_LANGUE force juste la langue résolue, sans passer par
    // state.json ni etat-utilisateur.json (la cascade de langue est éprouvée séparément
    // plus bas).
    let r = executerProduit({ envLangue: 'de' });
    assert.ok(r && r.sortie, 'échelon 1 (de) : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.ongletActif, 'zeitschrift', 'allemand -> Zeitschrift par défaut');
    r = executerProduit({ envLangue: 'fr' });
    assert.ok(r && r.sortie, 'échelon 1 (fr) : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.ongletActif, 'revue', 'français -> Revue par défaut');
    // Le livre n'apparaît dans AUCUn des deux cas : aucune langue ne le désigne jamais
    // seule, contrairement à revue et zeitschrift.
    assert.notStrictEqual(r.sortie.ongletActif, 'livre');

    // Échelon 2 : le réglage du compte (etat-utilisateur.json, ongletDefaut) l'emporte sur
    // la langue -- y compris pour choisir le livre, que la langue seule ne désigne jamais.
    r = executerProduit({ envLangue: 'fr', etatUtilisateur: { ongletDefaut: 'livre' } });
    assert.ok(r && r.sortie, 'échelon 2 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.ongletActif, 'livre',
      'le réglage du compte ne l’emporte plus sur la langue');
    assert.strictEqual(r.sortie.reglages.ongletChoisi, 'livre');

    // Échelon 3 : -Produit l'emporte sur le réglage du compte -- un raccourci d'une version
    // antérieure, resté épinglé à la barre des tâches, doit continuer d'ouvrir SON onglet
    // même si le compte a depuis choisi autre chose.
    r = executerProduit({ envLangue: 'fr', etatUtilisateur: { ongletDefaut: 'livre' }, produit: 'zeitschrift' });
    assert.ok(r && r.sortie, 'échelon 3 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.ongletActif, 'zeitschrift',
      '-Produit ne l’emporte plus sur le réglage du compte');
    // Le réglage du compte, lui, n'a pas bougé pour autant : -Produit ne l'écrase pas.
    assert.strictEqual(r.sortie.reglages.ongletChoisi, 'livre');

    // Échelon 4 (le plus explicite) : $env:SZH_ONGLET l'emporte sur -Produit.
    r = executerProduit({ envLangue: 'fr', etatUtilisateur: { ongletDefaut: 'livre' },
      produit: 'zeitschrift', envOnglet: 'revue' });
    assert.ok(r && r.sortie, 'échelon 4 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.ongletActif, 'revue', '$env:SZH_ONGLET ne l’emporte plus sur -Produit');
  });

test('la cascade de $SzhLangue : cinq échelons, et le repli à « de », jamais « en »',
  { skip: sansPowerShell }, () => {
    // Échelon 5 (le plus explicite) : $env:SZH_LANGUE l'emporte sur tout le reste.
    let r = executerProduit({ stateJson: { langue: 'fr' }, etatUtilisateur: { langueInterface: 'fr' }, envLangue: 'de' });
    assert.ok(r && r.sortie, 'échelon 5 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.langue, 'de', '$env:SZH_LANGUE ne garde plus le dernier mot');

    // Échelon 4 : le choix du compte (etat-utilisateur.json, langueInterface) l'emporte sur
    // state.json et sur Windows, tant que rien de plus explicite n'est fourni.
    r = executerProduit({ stateJson: { langue: 'fr' }, etatUtilisateur: { langueInterface: 'de' } });
    assert.ok(r && r.sortie, 'échelon 4 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.langue, 'de', 'le choix du compte ne l’emporte plus sur state.json');

    // Échelon 3 : state.json (l'héritage, celui qu'écrivait l'ancien lanceur) l'emporte sur
    // Windows et sur le repli, tant que le compte n'a rien choisi lui-même.
    r = executerProduit({ stateJson: { langue: 'fr' } });
    assert.ok(r && r.sortie, 'échelon 3 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.langue, 'fr', 'state.json ne l’emporte plus sur Windows/le repli');

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
    r = executerProduit({});
    assert.ok(r && r.sortie, 'échelons 1-2 : pas de JSON -- ' + (r ? r.stderr : ''));
    assert.strictEqual(r.sortie.langue, attendu,
      'sans aucune préférence, la langue devrait suivre Windows (fr/de) ou retomber sur « de »');
    assert.notStrictEqual(r.sortie.langue, 'en', 'le repli est retombé sur « en », pas sur « de »');
    // Et le littéral source le confirme, indépendamment de la langue de CE poste-ci.
    const commun = fs.readFileSync(path.join(RACINE, 'windows', 'szh-common.ps1'), 'utf8');
    assert.match(commun, /\$script:SzhLangue = 'de'/,
      'le repli de $SzhLangue n’est plus la littérale \'de\'');
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

// ---- L'onglet « Export et secretariat » : lecture non bloquante, plus de dossier de
// gabarits affiche, nouvelles clés de texte ----
//
// Mesure du 15.09.2026 (voir le commentaire d'Invoke-SzhSecretariat, open-produit.ps1) :
// une page OAI-PMH de 100 notices prend 4,6 s, la Zeitschrift en compte 7 -> ~32 s qui
// figeaient toute la fenêtre avec l'ancien ReadLine() bloquant. Non-régression, sans
// dérouler le lanceur en vrai (les quatre exports appellent un vrai processus Node) :
// garde textuelle sur ce qui a changé.

test('secretariat : ReadLine bloquant a disparu, aucune API interdite ne l\'a remplacé',
  () => {
    const source = fs.readFileSync(OUVRIR_PRODUIT, 'utf8');

    // INTERDIT ABSOLU (voir le commentaire d'Invoke-SzhSecretariat) : ces gestionnaires
    // tournent sur un fil hors du pipeline PowerShell et ont déjà tué le processus entier
    // sur ce poste, sans exception à attraper. On ne cherche que l'APPEL -- un nom suivi
    // d'une parenthèse : les noms seuls, sans parenthèse, apparaissent à bon droit dans le
    // commentaire qui explique l'interdiction.
    for (const api of ['add_ErrorDataReceived', 'BeginErrorReadLine', 'add_OutputDataReceived']) {
      const motif = new RegExp('\\.?' + api + '\\s*\\(', 'i');
      assert.ok(!motif.test(source),
        'open-produit.ps1 appelle ' + api + ' : interdit, voir la mesure du 15.09.2026');
    }

    // La boucle de lecture du secrétariat ne bloque plus le fil de l'interface.
    assert.ok(source.indexOf('StandardOutput.ReadLine()') === -1,
      'Invoke-SzhSecretariat lit encore stdout de façon bloquante (ReadLine)');
    assert.ok(source.indexOf('StandardOutput.ReadLineAsync()') !== -1,
      'Invoke-SzhSecretariat ne lit plus stdout de façon asynchrone (ReadLineAsync)');
  });

test('secretariat : le dossier des gabarits ne s\'affiche plus nulle part', () => {
  // La clé ELLE-MÊME a disparu (pas seulement son affichage) : ni dans le lanceur, ni dans
  // aucune des trois tables de texte, ni ailleurs dans windows/.
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

test('secretariat : les nouvelles clés de texte existent dans les trois langues', () => {
  const textes = fs.readFileSync(TEXTES_PS1, 'utf8');
  const nouvellesCles = [
    'lanceur.secretariat.filtre',
    'lanceur.secretariat.journal.entete',
    'lanceur.secretariat.resultat.enregistre',
    'lanceur.secretariat.interrompu',
    'lanceur.secretariat.interrompre',
    'lanceur.secretariat.export.titre.newsletter',
    'lanceur.secretariat.export.titre.metadonnees',
    'lanceur.secretariat.export.titre.chargement',
    'lanceur.secretariat.export.charger.plus',
    'lanceur.secretariat.export.fincourse',
  ];
  for (const cle of nouvellesCles) {
    // Chaque clé porte sa propre table (fr, de, en) : trois occurrences du littéral, ni
    // plus ni moins -- une clé absente d'une langue afficherait la clé nue à l'écran.
    const occurrences = textes.split('\'' + cle + '\'').length - 1;
    assert.strictEqual(occurrences, 3,
      'la clé « ' + cle + ' » ne porte pas exactement trois entrées (fr/de/en) : ' + occurrences);
  }
});

// Le premier bouton de la boîte d'export CSV (Show-SzhBoiteExportOjs) ne charge plus que
// l'année en cours (20 à 41 s de moisson complète contre 3 à 5 s pour une seule année,
// mesure du 15.09.2026) ; le contrôle des métadonnées ne restreint la moisson qu'à
// l'année la plus ancienne des numéros locaux cochés. Vérifié ici sur le SOURCE plutôt
// qu'en conditions réelles : la boîte modale et son dialogue OAI-PMH ne passent pas par
// SZH_LANCEUR_SIMULE, qui ne couvre que la liste des produits.
test('secretariat : --depuis-annee est passé par la boîte d\'export CSV et par le contrôle des métadonnées', () => {
  const source = fs.readFileSync(OUVRIR_PRODUIT, 'utf8');

  // Deux appels réels de numeros-ojs portent --depuis-annee suivi d'une valeur explicitement
  // convertie en chaîne -- un dans Show-SzhBoiteExportOjs (le second, chargé conditionnellement
  // par $anneesLisiblesMeta, ne l'écrit que dans l'argument assemblé plus haut).
  const motifAppel = /'--depuis-annee',\s*\[string\]/g;
  const occurrencesAppel = (source.match(motifAppel) || []).length;
  assert.strictEqual(occurrencesAppel, 2,
    '--depuis-annee devrait être construit exactement deux fois (boîte d\'export, contrôle des métadonnées) : '
    + occurrencesAppel);

  // Le second bouton de la boîte existe, démarre inactif, et son gestionnaire redescend
  // d'une année depuis l'année plancher tenue dans $etatBoiteOjs -- jamais une fusion.
  assert.ok(source.indexOf('$boutonChargerPlusOjs.Enabled = $false') !== -1,
    'le second bouton "Charger aussi" ne démarre plus inactif');
  assert.ok(source.indexOf('& $chargerNumerosOjs ($etatBoiteOjs.anneePlancher - 1) $false') !== -1,
    'le second bouton ne redescend plus d\'une année depuis $etatBoiteOjs.anneePlancher');
  assert.ok(source.indexOf('& $chargerNumerosOjs $anneeCouranteOjs $true') !== -1,
    'le premier bouton ne charge plus $anneeCouranteOjs');

  // Le contrôle des métadonnées : un numéro dont l'année n'est pas lisible dans son nom fait
  // basculer en moisson complète, jamais en silence trompeur -- $anneesLisiblesMeta porte
  // cette garde.
  assert.ok(source.indexOf('$anneesLisiblesMeta = $false') !== -1,
    'le contrôle des métadonnées ne garde plus la moisson complète en repli sur un nom illisible');
});
