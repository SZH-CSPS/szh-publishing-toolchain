// Un lien szh:// reçu par le protocole ne touche à la langue de personne.
//
//   node --test "test/js/*.test.js"
//
// windows/open-revue.ps1 est à la fois le lanceur et le gestionnaire du protocole szh://,
// qu'update.ps1 (Set-SzhProtocoleSzh) enregistre sans -Produit. La langue de l'interface
// est un réglage par compte (Set-SzhLangueInterface, onglet « Paramètres ») : ouvrir un
// lien, quel que soit son produit, ne change ni state.json (C:\ProgramData\SZH, partagé par
// tous les comptes du poste) ni etat-utilisateur.json.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const OUVRIR = lire('windows', 'open-revue.ps1');
// Tout windows/ : l'interdiction d'appeler Set-SzhLangueProduit vaut pour chaque script.
const WINDOWS_PS1 = fs.readdirSync(path.join(RACINE, 'windows')).filter((n) => n.endsWith('.ps1'))
  .map((n) => lire('windows', n)).join('\n');
const UPDATE = lire('windows', 'update.ps1');
// Le lien reçu vit dans Open-SzhLien (szh-produits.ps1), qu'appelle open-revue.ps1.
const PRODUITS = lire('windows', 'szh-produits.ps1');

const { POWERSHELL, sansPowerShell } = require('./gardes');

// ---- Le protocole est enregistré sans -Produit ----

test('update.ps1 enregistre le ProgId szh sans -Produit, et ce n’est plus un problème', () => {
  const debut = UPDATE.indexOf('function Set-SzhProtocoleSzh');
  assert.ok(debut !== -1, 'Set-SzhProtocoleSzh a disparu de update.ps1');
  const corps = UPDATE.slice(debut, UPDATE.indexOf('\r\nfunction ', debut + 10));
  assert.ok(corps.indexOf('open-revue.ps1') !== -1, 'le ProgId ne vise plus open-revue.ps1');
  assert.ok(corps.indexOf('-Produit') === -1,
    'update.ps1 passe maintenant -Produit au protocole : la prémisse de ce fichier a changé, ' +
    'à vérifier alors que le lien ne touche toujours à aucune langue');
  // $Produit vaut '' quand personne ne le passe ; la langue n'en dépend pas.
  assert.match(OUVRIR, /\[string\]\$Produit = ''/);
});

// ---- Le bloc « lien reçu » ne touche à aucune langue ----

test('Open-SzhLien : le bloc « lien reçu » ne touche à aucune langue', () => {
  const iBloc = PRODUITS.indexOf('function Open-SzhLien(');
  assert.notStrictEqual(iBloc, -1, 'Open-SzhLien a disparu de szh-produits.ps1');
  // Borne de fin : l'accolade qui ferme la fonction, en début de ligne.
  const iFin = PRODUITS.indexOf('\n}', iBloc);
  assert.notStrictEqual(iFin, -1, 'la fin d’Open-SzhLien ne se trouve plus');
  const corps = PRODUITS.slice(iBloc, iFin);
  assert.ok(corps.indexOf('Get-SzhLien $Lien') !== -1, 'la découpe ne prend plus le corps du lien');
  // Set-SzhLangueProduit n'est appelée nulle part dans windows/. On cherche une invocation
  // (le nom suivi d'un argument), un commentaire pouvant citer le nom.
  assert.ok(!/Set-SzhLangueProduit\s+[$']/.test(WINDOWS_PS1),
    'Set-SzhLangueProduit est encore APPELÉE quelque part dans windows/ : cette ' +
    'fonction devait disparaître avec la fusion des lanceurs, pas seulement son bloc lien');
  // Rien d'autre dans ce bloc ne change la langue résolue ni ne réécrit les deux fichiers
  // de préférence.
  for (const interdit of ['Set-SzhLangueInterface', '$script:SzhLangue =', 'Save-SzhEtatUtilisateur',
    'Set-SzhStateCles']) {
    assert.ok(corps.indexOf(interdit) === -1,
      'le bloc « lien reçu » touche à la langue (' + interdit + ') : un lien reçu par ' +
      'courriel ne doit pas changer la préférence du poste ni celle du compte');
  }
});

// ---- Le mécanisme, réellement exécuté : le lien ne change pas la langue ----
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
    // Deux préférences contraires au produit du lien (Zeitschrift, donc allemand ; ici tout
    // est en français) : le moindre effet du lien sur la langue se verrait. Fins de ligne
    // LF ; seul le contenu est comparé, au caractère près.
    fs.writeFileSync(stateFile, JSON.stringify({ langue: 'fr' }) + '\n', 'utf8');
    fs.writeFileSync(etatFile, JSON.stringify({ langueInterface: 'fr' }) + '\n', 'utf8');
    const avantState = fs.readFileSync(stateFile, 'utf8');
    const avantEtat = fs.readFileSync(etatFile, 'utf8');

    const env = Object.assign({}, process.env, {
      SZH_BASE: programData,
      LOCALAPPDATA: localAppData,
      SZH_LANCEUR_SIMULE: '1',
      // Les tâches de démarrage passent avant le lien : un ancrage, des rapports et des
      // racines jetables, pour que le check-in n'écrive pas dans le vrai dossier partagé.
      SZH_ANCRAGE: path.join(travail, 'sp', 'Daten_Allgemein - General'),
      SZH_RAPPORTS: path.join(travail, 'rapports'),
      SZH_RACINE_TEST: path.join(travail, 'test'),
      SZH_RACINE_PROD: path.join(travail, 'prod'),
    });
    fs.mkdirSync(env.SZH_ANCRAGE, { recursive: true });
    delete env.SZH_LANGUE;   // un essai antérieur ne doit pas fausser la cascade
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(RACINE, 'windows', 'open-revue.ps1'), 'szh://traduction/zeitschrift/2026-05'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
    assert.ok(run.stdout, 'aucune sortie JSON du lanceur : ' + run.stderr);
    const sortie = JSON.parse(run.stdout.trim());
    // Le dossier visé n'existe pas sur cette arborescence jetable : le lien est refusé
    // (« introuvable »), ce qui n'est pas le sujet. On vérifie que le lien a bien été
    // analysé.
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
