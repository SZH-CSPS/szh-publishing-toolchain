// Langue d'un lien szh:// reçu par le protocole : elle ne doit plus toucher à la langue de
// PERSONNE.
//
//   node --test "test/js/*.test.js"
//
// RENOMMÉ le 13.09.2026 (ancien nom : lien-langue.test.js). Le défaut d'ORIGINE que ce
// fichier gardait était un effet de bord silencieux sur un réglage PARTAGÉ ENTRE TOUS LES
// COMPTES d'un poste : windows/open-revue.ps1 servait deux rôles (lanceur du menu Démarrer,
// appelé avec -Produit revue|zeitschrift, et gestionnaire du protocole szh://), et
// update.ps1 (Set-SzhProtocoleSzh) enregistrait ce protocole SANS -Produit. Un lien
// szh://traduction/zeitschrift/… ouvert depuis Outlook faisait donc retomber $Produit sur
// son défaut 'revue', et Set-SzhLangueProduit 'revue' — appelée avant toute analyse du lien
// — forçait le français dans state.json (C:\ProgramData\SZH, un chemin MACHINE, partagé par
// tous les comptes). Une rédactrice germanophone qui cliquait un lien Zeitschrift voyait
// ainsi la préférence de langue de TOUT LE POSTE basculer en français. Le correctif de
// l'époque : rappeler Set-SzhLangueProduit avec le produit DU LIEN, après Get-SzhLien.
//
// La fusion des trois lanceurs (13.09.2026, voir l'en-tête d'open-produit.ps1) a supprimé
// Set-SzhLangueProduit — et c'est délibéré, pas un oubli : la langue de l'interface est
// maintenant un réglage par COMPTE (Set-SzhLangueInterface, choisi dans l'onglet
// « Paramètres »), jamais quelque chose qu'un lanceur ou un lien pourrait décider à la
// place du rédacteur. Le défaut gardé ici est donc devenu son INVERSE : ouvrir un lien —
// quel que soit son produit — ne doit changer NI state.json NI etat-utilisateur.json. Un
// lien reçu par courriel n'est pas un réglage.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const OUVRIR = lire('windows', 'open-produit.ps1');
const UPDATE = lire('windows', 'update.ps1');

const { POWERSHELL, sansPowerShell } = require('./gardes');

// ---- La prémisse d'origine tient toujours, mais elle n'est plus dangereuse ----

test('update.ps1 enregistre le ProgId szh sans -Produit, et ce n’est plus un problème', () => {
  const debut = UPDATE.indexOf('function Set-SzhProtocoleSzh');
  assert.ok(debut !== -1, 'Set-SzhProtocoleSzh a disparu de update.ps1');
  const corps = UPDATE.slice(debut, UPDATE.indexOf('\r\nfunction ', debut + 10));
  assert.ok(corps.indexOf('open-revue.ps1') !== -1, 'le ProgId ne vise plus open-revue.ps1');
  assert.ok(corps.indexOf('-Produit') === -1,
    'update.ps1 passe maintenant -Produit au protocole : la prémisse de ce fichier a changé, ' +
    'à vérifier alors que le lien ne touche toujours à aucune langue');
  // Ce que $Produit vaut par défaut quand personne ne le passe : '' (onglet décidé par
  // Get-SzhOngletDefaut), et non plus 'revue' — mais peu importe désormais pour la langue,
  // qui ne dépend plus du tout de $Produit.
  assert.match(OUVRIR, /\[string\]\$Produit = ''/);
});

// ---- Le bloc « lien reçu » ne doit plus toucher à aucune langue ----

test('open-produit.ps1 : le bloc « lien reçu » ne touche à aucune langue', () => {
  const iBloc = OUVRIR.indexOf('if ($Lien) {');
  assert.notStrictEqual(iBloc, -1, 'le bloc « lien reçu » a disparu de open-produit.ps1');
  // Borne de fin : le calcul des racines à balayer, juste après le bloc lien (voir
  // l'en-tête « ---- Racines à balayer, communes aux trois onglets ---- »).
  const iRacines = OUVRIR.indexOf('$emplacements = Get-SzhEmplacements', iBloc);
  assert.notStrictEqual(iRacines, -1, 'le calcul des racines a disparu ou a changé de forme');
  assert.ok(iBloc < iRacines, 'le bloc « lien reçu » doit précéder le calcul des racines');
  const corps = OUVRIR.slice(iBloc, iRacines);
  // Set-SzhLangueProduit, comme FONCTION APPELÉE, a disparu de tout le fichier -- seul son
  // nom survit dans le commentaire d'en-tête, qui raconte le défaut d'origine. On le
  // cherche donc suivi d'un argument (une vraie invocation), jamais comme simple mot.
  assert.ok(!/Set-SzhLangueProduit\s+[$']/.test(OUVRIR),
    'Set-SzhLangueProduit est encore APPELÉE quelque part dans open-produit.ps1 : cette ' +
    'fonction devait disparaître avec la fusion des lanceurs, pas seulement son bloc lien');
  // Et rien d'autre, dans CE bloc précisément, ne change la langue résolue ni ne réécrit
  // les deux fichiers de préférence.
  for (const interdit of ['Set-SzhLangueInterface', '$script:SzhLangue =', 'Save-SzhEtatUtilisateur',
    'Set-SzhStateCles']) {
    assert.ok(corps.indexOf(interdit) === -1,
      'le bloc « lien reçu » touche à la langue (' + interdit + ') : un lien reçu par ' +
      'courriel ne doit pas changer la préférence du poste ni celle du compte');
  }
});

// ---- Le titre ne peut plus rester périmé : il ne dépend plus du produit du lien ----

test('open-produit.ps1 : le titre de la fenêtre, unique, ne peut plus rester périmé après un lien', () => {
  // Piège de l'ANCIEN correctif : $titreFenetre se lisait dans la table du produit
  // (« Revues SZH » / « Zeitschriften SZH »), et sans un recalcul après la bascule de
  // langue du lien, la boîte « lien introuvable » aurait affiché un titre resté dans la
  // mauvaise langue ou le mauvais produit. Ce piège ne peut plus se reproduire : il n'y a
  // plus qu'UN titre, commun aux trois onglets (lanceur.titre.suite), assigné une seule
  // fois, avant même que le lien ne soit examiné.
  const assignations = [...OUVRIR.matchAll(/\$titreFenetre\s*=/g)];
  assert.strictEqual(assignations.length, 1,
    'titreFenetre est assigné plus d’une fois : le piège d’un titre périmé après un lien ' +
    'pourrait revenir si une seconde assignation dépendait du produit du lien');
  const iTitre = assignations[0].index;
  const iBlocLien = OUVRIR.indexOf('if ($Lien) {');
  assert.ok(iTitre !== -1 && iBlocLien !== -1 && iTitre < iBlocLien,
    'titreFenetre doit être calculé avant le bloc « lien reçu », pas après');
  assert.match(OUVRIR.slice(iTitre, iTitre + 120),
    /\(T 'lanceur\.titre\.suite' @\(\$SzhNomApplication\)\)/,
    'titreFenetre ne vient plus de lanceur.titre.suite : un titre par produit reviendrait-il, ' +
    'le piège d’origine reviendrait avec lui');
});

// ---- Le mécanisme, réellement exécuté : le lien n'a AUCUN mot à dire sur la langue ----
// Windows seulement : szh-common.ps1 vise Windows PowerShell 5.1. Rien n'est écrit dans le
// vrai C:\ProgramData\SZH ni le vrai %LOCALAPPDATA% : SZH_BASE et LOCALAPPDATA sont
// redirigés vers un dossier de travail jetable, comme le fait déjà test/js/installation.test.js.

test('ouvrir un lien Zeitschrift ne modifie ni state.json ni etat-utilisateur.json',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lien-sans-langue-'));
    const programData = path.join(travail, 'ProgramData');
    const localAppData = path.join(travail, 'Local');
    fs.mkdirSync(programData, { recursive: true });
    fs.mkdirSync(path.join(localAppData, 'SZH'), { recursive: true });
    const stateFile = path.join(programData, 'state.json');
    const etatFile = path.join(localAppData, 'SZH', 'etat-utilisateur.json');
    // Deux préférences délibérément CONTRAIRES au produit du lien (Zeitschrift -> allemand,
    // ici tout est français) : si le lien avait le moindre effet sur la langue, ce test
    // le verrait tourner dans un sens ou dans l'autre. Fins de ligne LF, comme Set-SzhJson
    // écrit ailleurs — seul le CONTENU importe ici, comparé au caractère près.
    fs.writeFileSync(stateFile, JSON.stringify({ langue: 'fr' }) + '\n', 'utf8');
    fs.writeFileSync(etatFile, JSON.stringify({ langueInterface: 'fr' }) + '\n', 'utf8');
    const avantState = fs.readFileSync(stateFile, 'utf8');
    const avantEtat = fs.readFileSync(etatFile, 'utf8');

    const env = Object.assign({}, process.env, {
      SZH_BASE: programData,
      LOCALAPPDATA: localAppData,
      SZH_LANCEUR_SIMULE: '1',
    });
    delete env.SZH_LANGUE;   // un essai antérieur ne doit pas fausser la cascade
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(RACINE, 'windows', 'open-produit.ps1'), 'szh://traduction/zeitschrift/2026-05'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
    assert.ok(run.stdout, 'aucune sortie JSON du lanceur : ' + run.stderr);
    const sortie = JSON.parse(run.stdout.trim());
    // Le dossier visé n'existe pas sur cette arborescence jetable : le lien est refusé,
    // « introuvable » — ce refus n'est pas le sujet de ce test, seul l'avant/après des deux
    // fichiers de préférence l'est. On vérifie tout de même que le lien a bien été analysé,
    // sans quoi ce test ne prouverait rien.
    assert.strictEqual(sortie.lien, 'szh://traduction/zeitschrift/2026-05',
      'le lanceur n’a pas examiné le lien : ce test ne prouve rien');

    const apresState = fs.readFileSync(stateFile, 'utf8');
    const apresEtat = fs.readFileSync(etatFile, 'utf8');
    fs.rmSync(travail, { recursive: true, force: true });
    assert.strictEqual(apresState, avantState,
      'state.json a changé : un lien reçu par courriel a modifié la préférence du POSTE');
    assert.strictEqual(apresEtat, avantEtat,
      'etat-utilisateur.json a changé : un lien reçu par courriel a modifié la préférence du COMPTE');
  });
