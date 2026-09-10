// lib/rapport-erreur.js : l'écrivain des rapports d'erreur automatiques côté cockpit
// (SPEC-RAPPORTS.md, §4 et §5), et les deux accroches d'extension.js (COMPIL-ECHEC,
// COCKPIT-EXCEPTION). Défaut réel gardé par ce fichier (trouvé en l'écrivant, pas en le
// vivant en production) : sans garde dédiée, une compilation en échec déclenchée par un
// AUTRE fichier de test (controles.test.js, interaction.test.js, pdfua.test.js — hors du
// périmètre de ce jalon) aurait écrit pour de vrai dans le vrai %LOCALAPPDATA%\SZH, voire
// dans le vrai dossier SharePoint sur un poste où un ancrage est déjà configuré :
// ecritureReelleEviteeParHarnaisTest() (lib/rapport-erreur.js) coupe l'écriture réelle dès
// que test/js/hote-factice.js pose SZH_RESEAU_INTERDIT ET qu'aucune destination explicite
// (SZH_ANCRAGE ou SZH_RAPPORTS) n'a été fournie — jamais en production, où cette variable
// n'est jamais posée.
//
// AMENDEMENT D10 (09.09.2026, Robin, en éprouvant ce module de bout en bout) : deux
// variables ORTHOGONALES, dont le nom dit la vérité — SZH_ANCRAGE pour l'ANCRAGE
// (Daten_Allgemein - General ; même variable que Resolve-SzhAncrage côté PowerShell), et
// SZH_RAPPORTS pour le DOSSIER DE RAPPORTS, directement, tel quel (elle l'emporte sans
// condition sur la dérivation depuis l'ancrage, mais ne remplace pas la résolution de
// l'ancrage elle-même — le champ `ancrage` du rapport et les chemins relatifs restent
// ceux de l'ancrage résolu séparément). Avant cet amendement, SZH_RAPPORTS désignait
// l'ancrage, et un dossier de rapports qu'on lui passait directement héritait d'un
// `2_Produkte\…` de trop en dessous de lui.
//
//   node --test test/js/rapport-erreur.test.js
//
// Aucun test ci-dessous ne touche le vrai C:\ProgramData\SZH, le vrai %LOCALAPPDATA%\SZH
// ni le vrai SharePoint : tout passe par SZH_ANCRAGE, SZH_RAPPORTS, SZH_BASE (config.json,
// state.json, toolkit/VERSION) et la variable réelle LOCALAPPDATA (etat-utilisateur.json,
// rapports-en-attente), chacune pointée vers un dossier jetable (fs.mkdtempSync).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const rapportErreur = require(path.join(COCKPIT, 'lib', 'rapport-erreur.js'));
const codesErreur = require(path.join(COCKPIT, 'lib', 'codes-erreur.js'));

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe + '-'));
}

// Exécute `fn` avec les variables d'environnement données, puis les restaure exactement
// telles qu'elles étaient (posées ou absentes) — indispensable ici : plusieurs tests de ce
// fichier posent SZH_RAPPORTS / SZH_BASE / LOCALAPPDATA, et un oubli de restauration
// ferait déteindre un test sur le suivant dans le même processus (node --test donne un
// processus par FICHIER, pas par test).
// Gère aussi bien un `fn` synchrone qu'asynchrone : un `fn` async rend une promesse
// IMMÉDIATEMENT (avant son premier await), et restaurer l'environnement dans un simple
// `finally` synchrone le ferait donc TROP TÔT — avant la suite du corps de `fn`, qui
// tournerait alors sous le MAUVAIS environnement. Restaurer seulement quand la promesse se
// dénoue règle le problème pour les deux cas.
function avecEnv(vars, fn) {
  const anciennes = {};
  for (const cle of Object.keys(vars)) { anciennes[cle] = process.env[cle]; process.env[cle] = vars[cle]; }
  const restaurer = () => {
    for (const cle of Object.keys(vars)) {
      if (anciennes[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = anciennes[cle]; }
    }
  };
  let resultat;
  try { resultat = fn(); }
  catch (e) { restaurer(); throw e; }
  if (resultat && typeof resultat.then === 'function') {
    return resultat.then((v) => { restaurer(); return v; }, (e) => { restaurer(); throw e; });
  }
  restaurer();
  return resultat;
}

function attendre(ms) { return new Promise((r) => setTimeout(r, ms)); }
function unTick() { return new Promise((r) => setImmediate(r)); }

// Un sandbox complet (ancrage + base + local) pour un appel à emettreRapport() qui doit
// vraiment écrire (SZH_ANCRAGE -> origine 'essai' — la garde du banc ne s'applique donc
// pas, voir l'en-tête). `SZH_RESEAU_INTERDIT` n'est jamais posé dans cette section
// (Partie 1, module pur, sans hote-factice) : la garde ne joue de toute façon aucun rôle
// ici. `varsSandbox()` ne pose PAS SZH_RAPPORTS : le dossier de rapports reste dérivé de
// l'ancrage (le cas courant) ; les tests dédiés à SZH_RAPPORTS le posent eux-mêmes.
function sandbox() {
  return { ancrage: dossierJetable('szh-ancrage'), base: dossierJetable('szh-base'), local: dossierJetable('szh-local') };
}
function varsSandbox(s) { return { SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }; }
function dossierRapportsDe(s) {
  return path.join(s.ancrage, '2_Produkte', 'Edition SZH CSPS allgemein', '_AutoReportToolboxZeitscrhiften');
}
function dossierAttenteDe(s) { return path.join(s.local, 'SZH', 'rapports-en-attente'); }

const CHAMPS_MINIMAUX = {
  gravite: 'erreur', source: 'cockpit', code: 'COCKPIT-EXCEPTION',
  etape: 'essai', message: 'un message sans secret'
};

// =========================================================================================
// Partie 1 — le module, seul (pur pour l'essentiel, sandbox jetable pour le reste)
// =========================================================================================

test('construireRapport() : un rapport complet est conforme au schéma v1 (validerRapport)', () => {
  const racines = { ancrage: 'C:\\ancrage', userProfile: 'C:\\Users\\robin', programData: 'C:\\ProgramData\\SZH' };
  const rapport = rapportErreur.construireRapport({
    id: codesErreur.calculerId('2026-09-09T08:15:30Z', 'ROBIN-PC', 'a1b2c3'),
    horodatage: '2026-09-09T08:15:30.000Z',
    horodatageLocal: '2026-09-09T10:15:30+02:00',
    gravite: 'erreur', source: 'chaine', code: 'COMPIL-ECHEC',
    signature: codesErreur.calculerSignature({ source: 'chaine', code: 'COMPIL-ECHEC' }),
    etape: 'compilation', message: 'La compilation a rendu le code de sortie 1.', pile: null,
    poste: { nom: 'ROBIN-PC', utilisateur: 'robin', os: '10.0.26200', powershell: null, langueInterface: 'fr' },
    versions: { toolkit: 'v2026.08.59', cockpit: '0.34.0', vscodium: '1.101.2' },
    produit: { type: 'revue', numero: '2027-02', emplacement: 'production' },
    ancrage: { trouve: true, origine: 'cache', chemin: racines.ancrage },
    fichiers: [{ chemin: 'C:\\ancrage\\2_Produkte\\52_Revue\\x.md', role: 'article' }],
    journal: { chemin: 'C:\\ProgramData\\SZH\\logs\\szh-2026-09.log', lignes: 3, tronque: false, extrait: ['une ligne', 'une autre'] },
    constats: [{ source: 'pandoc', code: 'tableau-sans-entete', ton: 'danger', slug: '03-x' }],
    environnement: { wsl: 'repond', espaceLibreGo: 42.3 },
    racines: racines
  });
  const ecarts = codesErreur.validerRapport(rapport);
  assert.deepEqual(ecarts, [], 'rapport mal formé : ' + ecarts.join(' ; '));
  assert.equal(Object.keys(rapport).join(','), codesErreur.ORDRE_CLES_RAPPORT.join(','));
  // Câblage : un fichier sous l'ancrage sort en relatif, un chemin ProgramData aussi.
  assert.equal(rapport.fichiers[0].chemin, '2_Produkte\\52_Revue\\x.md');
  assert.equal(rapport.fichiers[0].relatifA, 'ancrage');
  assert.equal(rapport.journal.chemin, 'logs\\szh-2026-09.log');
  assert.equal(rapport.journal.relatifA, 'programdata');
});

test('construireRapport() : message/pile/extrait passent par le masquage (§4.1)', () => {
  const racines = { ancrage: 'C:\\ancrage', userProfile: 'C:\\Users\\robin', programData: 'C:\\ProgramData\\SZH' };
  const rapport = rapportErreur.construireRapport({
    id: codesErreur.calculerId('2026-09-09T08:15:30Z', 'POSTE', 'a1b2c3'),
    horodatage: '2026-09-09T08:15:30.000Z', horodatageLocal: '2026-09-09T10:15:30+02:00',
    gravite: 'erreur', source: 'cockpit', code: 'COCKPIT-EXCEPTION', signature: 'abcdef123456',
    etape: null,
    message: 'token: SecretMelange123Value et un chemin C:\\Users\\robin\\Bureau\\x.txt',
    pile: 'jean.dupont@example.com a échoué',
    poste: null, versions: null, produit: null,
    ancrage: { trouve: false, origine: 'absent', chemin: null },
    fichiers: [], journal: { chemin: 'C:\\ancrage\\2_Produkte\\y.md', lignes: 1, tronque: false, extrait: ['secret: SecretMelange123Value'] },
    constats: [], environnement: null,
    racines: racines
  });
  assert.match(rapport.message, /token: \*\*\*/, 'le jeton nommé doit être masqué');
  assert.match(rapport.message, /~\\Bureau\\x\.txt/, '%USERPROFILE% doit devenir ~\\…');
  assert.match(rapport.pile, /\*\*\*@\*\*\*/, 'un courriel autre que celui du support doit être masqué');
  assert.equal(rapport.journal.chemin, '2_Produkte\\y.md', 'le journal doit aussi sortir relatif à l’ancrage');
  assert.match(rapport.journal.extrait[0], /secret: \*\*\*/, 'l’extrait du journal doit lui aussi passer par le masquage');
});

test('dossierRapportsDepuisAncrage() : la faute de frappe est reproduite à l’identique, jamais corrigée', () => {
  const derive = rapportErreur.dossierRapportsDepuisAncrage('C:\\un\\ancrage');
  // Comparé à une chaîne tapée en dur ICI, indépendamment de la constante du module : si
  // quelqu'un « corrige » un jour la faute de frappe dans rapport-erreur.js, ce test doit
  // continuer à réclamer l'orthographe fautive et donc échouer.
  assert.ok(derive.endsWith('2_Produkte\\Edition SZH CSPS allgemein\\_AutoReportToolboxZeitscrhiften'),
    'dérivation inattendue : ' + derive);
  assert.ok(derive.indexOf('_AutoReportToolboxZeitschriften') === -1,
    'la faute de frappe a été « corrigée » — c’est le vrai nom du dossier, à ne jamais toucher');
});

test('résolution passive : SZH_ANCRAGE (essai) l’emporte sur config.json et sur le cache', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.base, 'config.json'), JSON.stringify({ ancrageSharePoint: s.base }) + '\n');
  fs.mkdirSync(path.join(s.local, 'SZH'), { recursive: true });
  fs.writeFileSync(path.join(s.local, 'SZH', 'etat-utilisateur.json'), JSON.stringify({ ancrageSharePoint: s.local }) + '\n');
  avecEnv(varsSandbox(s), () => {
    const r = rapportErreur.resoudreAncrage();
    assert.deepEqual(r, { trouve: true, origine: 'essai', chemin: s.ancrage });
  });
});

test('résolution passive : config.json l’emporte sur le cache quand SZH_ANCRAGE est absent', () => {
  const s = sandbox();
  fs.rmSync(s.ancrage, { recursive: true, force: true });   // « essai » ne doit rien trouver
  fs.writeFileSync(path.join(s.base, 'config.json'), JSON.stringify({ ancrageSharePoint: s.base }) + '\n');
  fs.mkdirSync(path.join(s.local, 'SZH'), { recursive: true });
  fs.writeFileSync(path.join(s.local, 'SZH', 'etat-utilisateur.json'), JSON.stringify({ ancrageSharePoint: s.local }) + '\n');
  avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    const r = rapportErreur.resoudreAncrage();
    assert.deepEqual(r, { trouve: true, origine: 'config', chemin: s.base });
  });
});

test('résolution passive : le cache (etat-utilisateur.json) sert de dernier recours', () => {
  const s = sandbox();
  fs.rmSync(s.ancrage, { recursive: true, force: true });
  // config.json existe mais sans ancrageSharePoint.
  fs.writeFileSync(path.join(s.base, 'config.json'), '{}\n');
  fs.mkdirSync(path.join(s.local, 'SZH'), { recursive: true });
  fs.writeFileSync(path.join(s.local, 'SZH', 'etat-utilisateur.json'), JSON.stringify({ ancrageSharePoint: s.local }) + '\n');
  avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    const r = rapportErreur.resoudreAncrage();
    assert.deepEqual(r, { trouve: true, origine: 'cache', chemin: s.local });
  });
});

test('résolution passive : variables d’environnement développées dans la valeur de config.json', () => {
  const s = sandbox();
  fs.rmSync(s.ancrage, { recursive: true, force: true });
  avecEnv({ SZH_ANCRAGE_ESSAI_CIBLE: s.base }, () => {
    fs.writeFileSync(path.join(s.base, 'config.json'), JSON.stringify({ ancrageSharePoint: '%SZH_ANCRAGE_ESSAI_CIBLE%' }) + '\n');
    avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
      const r = rapportErreur.resoudreAncrage();
      assert.deepEqual(r, { trouve: true, origine: 'config', chemin: s.base });
    });
  });
});

test('résolution passive : rien de tout cela n’aboutit -> absent, en silence', () => {
  const s = sandbox();
  fs.rmSync(s.ancrage, { recursive: true, force: true });
  avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    const r = rapportErreur.resoudreAncrage();
    assert.deepEqual(r, { trouve: false, origine: 'absent', chemin: null });
  });
});

// Trouvé en comparant les deux écrivains (JS et PowerShell) sur un même incident : PS
// normalise déjà `ancrage.chemin` en antislash (via Resolve-SzhAncrage), le JS le
// recopiait tel quel — un SZH_ANCRAGE tapé avec des barres obliques (habitude de shell)
// rendait donc deux chaînes différentes pour le MÊME ancrage, incollables l'une à l'autre
// avec `fichiers[].chemin` (toujours en antislash, lui).
test('résolution passive : SZH_ANCRAGE en barres obliques -> chemin rendu en antislash, sans séparateur final', () => {
  const s = sandbox();
  const enOblique = s.ancrage.replace(/\\/g, '/') + '/';   // + un séparateur final, pour de bon
  avecEnv({ SZH_ANCRAGE: enOblique, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    const r = rapportErreur.resoudreAncrage();
    assert.equal(r.trouve, true);
    assert.equal(r.origine, 'essai');
    assert.equal(r.chemin, s.ancrage, 'le chemin rendu doit être identique à la forme antislash, sans "/" ni séparateur final');
    assert.equal(r.chemin.indexOf('/'), -1);
    assert.equal(r.chemin.endsWith('\\'), false);
  });
});

test('résolution passive : la même normalisation s’applique à l’ancrage venu de config.json', () => {
  const s = sandbox();
  fs.rmSync(s.ancrage, { recursive: true, force: true });   // « essai » ne doit rien trouver
  const enOblique = s.base.replace(/\\/g, '/');
  fs.writeFileSync(path.join(s.base, 'config.json'), JSON.stringify({ ancrageSharePoint: enOblique }) + '\n');
  avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    const r = rapportErreur.resoudreAncrage();
    assert.equal(r.origine, 'config');
    assert.equal(r.chemin, s.base);
  });
});

// Le point qui compte réellement pour la personne qui lit le rapport : `ancrage.chemin`
// et `fichiers[].chemin` doivent pouvoir se COLLER l'un à l'autre dans l'Explorateur.
// versCheminRelatif()/masquer() (codes-erreur.js) acceptent déjà l'un ou l'autre séparateur
// pour RECONNAÎTRE la racine dans un chemin absolu (vérifié par exécution, pas supposé) —
// seul le champ `ancrage.chemin` lui-même, jamais masqué (§4.1), avait besoin du correctif
// ci-dessus. Ce test-ci le prouve de bout en bout, ancrage ET fichier concaténables.
test('emettreRapport() : ancrage en barres obliques + fichier réel -> chemins collables tels quels', () => {
  const s = sandbox();
  const cheminArticle = path.join(s.ancrage, '2_Produkte', '52_Revue', 'x.md');   // toujours en antislash (fs/path)
  avecEnv({ SZH_ANCRAGE: s.ancrage.replace(/\\/g, '/'), SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    const resultat = rapportErreur.emettreRapport(Object.assign({}, CHAMPS_MINIMAUX, {
      fichiers: [{ chemin: cheminArticle, role: 'article' }]
    }));
    assert.equal(resultat.ecrit, true, 'motif : ' + resultat.motif);
    const rapport = JSON.parse(fs.readFileSync(path.join(dossierRapportsDe(s), resultat.id + '.json'), 'utf8'));
    assert.equal(rapport.ancrage.chemin, s.ancrage);
    assert.equal(rapport.fichiers[0].chemin, '2_Produkte\\52_Revue\\x.md');
    // Le test que ferait la personne qui lit le rapport : coller les deux bouts.
    assert.equal(rapport.ancrage.chemin + '\\' + rapport.fichiers[0].chemin,
      path.join(s.ancrage, '2_Produkte', '52_Revue', 'x.md'));
  });
});

test('résolution passive : aucun balayage de disque (fs.readdirSync jamais appelé)', () => {
  const s = sandbox();
  // Un ancrage introuvable à tous les niveaux, MAIS un dossier voisin bien rempli : si la
  // résolution se mettait à énumérer quoi que ce soit pour « chercher », readdirSync le
  // trahirait immédiatement.
  fs.mkdirSync(path.join(s.local, 'SZH'), { recursive: true });
  for (let i = 0; i < 10; i++) { fs.mkdirSync(path.join(s.local, 'leurre-' + i)); }
  const original = fs.readdirSync;
  fs.readdirSync = () => { throw new Error('resoudreAncrage() a balayé le disque — interdit par l’amendement du 09.09.2026'); };
  try {
    avecEnv({ SZH_ANCRAGE: '', SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
      assert.doesNotThrow(() => rapportErreur.resoudreAncrage());
      assert.deepEqual(rapportErreur.resoudreAncrage(), { trouve: false, origine: 'absent', chemin: null });
    });
  } finally { fs.readdirSync = original; }
});

test('le module ne référence aucune API de sélection de dossier ni de demande utilisateur', () => {
  const source = fs.readFileSync(path.join(COCKPIT, 'lib', 'rapport-erreur.js'), 'utf8');
  for (const motif of ['FolderBrowserDialog', 'showOpenDialog', 'showInputBox', 'showQuickPick', 'showSaveDialog']) {
    assert.equal(source.indexOf(motif), -1, 'référence interdite trouvée : ' + motif);
  }
});

test('emettreRapport() : le nom de fichier est <id>.json, et le tri du dossier est chronologique', async () => {
  const s = sandbox();
  await avecEnv(varsSandbox(s), async () => {
    const r1 = rapportErreur.emettreRapport(Object.assign({}, CHAMPS_MINIMAUX, { etape: 'premier' }));
    assert.equal(r1.ecrit, true, 'motif : ' + r1.motif);
    await attendre(1100);   // franchir la frontière de la seconde : timestamps d'id distincts
    const r2 = rapportErreur.emettreRapport(Object.assign({}, CHAMPS_MINIMAUX, { etape: 'second' }));
    assert.equal(r2.ecrit, true, 'motif : ' + r2.motif);

    assert.match(r1.id, codesErreur.FORMAT_ID);
    assert.match(r2.id, codesErreur.FORMAT_ID);
    const noms = fs.readdirSync(dossierRapportsDe(s)).sort();
    assert.deepEqual(noms, [r1.id + '.json', r2.id + '.json'].sort());
    assert.ok(r1.id < r2.id, 'l’id doit croître avec le temps pour que le tri reste chronologique');
  });
});

test('anti-inondation : la même signature deux fois de suite -> un seul fichier, le second étouffé', () => {
  const s = sandbox();
  avecEnv(varsSandbox(s), () => {
    const champs = Object.assign({}, CHAMPS_MINIMAUX, { etape: 'toujours le même' });
    const r1 = rapportErreur.emettreRapport(champs);
    const r2 = rapportErreur.emettreRapport(champs);
    assert.equal(r1.ecrit, true);
    assert.equal(r2.ecrit, false);
    assert.equal(r2.etouffe, true);
    assert.equal(r2.motif, 'signature-recente');
    assert.equal(fs.readdirSync(dossierRapportsDe(s)).length, 1);
  });
});

test('anti-inondation : le 21e rapport du jour est refusé, les 20 premiers passent', () => {
  const s = sandbox();
  avecEnv(varsSandbox(s), () => {
    const resultats = [];
    for (let i = 0; i < 21; i++) {
      resultats.push(rapportErreur.emettreRapport(Object.assign({}, CHAMPS_MINIMAUX, { etape: 'étape numéro ' + i })));
    }
    const ecrits = resultats.filter((r) => r.ecrit).length;
    const dernier = resultats[resultats.length - 1];
    assert.equal(ecrits, 20, 'exactement 20 rapports doivent avoir été écrits');
    assert.equal(dernier.ecrit, false);
    assert.equal(dernier.etouffe, true);
    assert.equal(dernier.motif, 'plafond-jour');
    assert.equal(fs.readdirSync(dossierRapportsDe(s)).length, 20);
  });
});

test('purgerCompteursRapports() : les entrées de plus de 7 jours sont retirées, les autres restent', () => {
  const maintenant = new Date('2026-09-09T12:00:00Z');
  const rapports = {
    _jour: '2026-09-09', _compte: 3,
    ancienne: new Date(maintenant.getTime() - 8 * 24 * 3600 * 1000).toISOString(),
    recente: new Date(maintenant.getTime() - 2 * 24 * 3600 * 1000).toISOString()
  };
  const purge = rapportErreur.purgerCompteursRapports(rapports, maintenant);
  assert.equal('ancienne' in purge, false);
  assert.equal('recente' in purge, true);
  assert.equal('_jour' in purge, false, '_jour et _compte sont traités à part, pas comme des signatures');
});

test('decisionAntiInondation() : la fenêtre de 24 h se referme juste après, pas juste avant', () => {
  const maintenant = new Date('2026-09-09T12:00:00Z');
  const signature = 'abcdef123456';
  const il23h = new Date(maintenant.getTime() - 23 * 3600 * 1000).toISOString();
  const il25h = new Date(maintenant.getTime() - 25 * 3600 * 1000).toISOString();
  const refuse = rapportErreur.decisionAntiInondation({ [signature]: il23h }, signature, maintenant);
  assert.equal(refuse.autorise, false);
  const autorise = rapportErreur.decisionAntiInondation({ [signature]: il25h }, signature, maintenant);
  assert.equal(autorise.autorise, true);
});

test('emettreRapport() : dossier de rapports injoignable -> mise en attente, puis viderFileAttente() la vide', () => {
  const s = sandbox();
  // Obstrue le dossier réel : un FICHIER là où '2_Produkte' devrait être un dossier fait
  // échouer le mkdirSync récursif de l'écriture — exactement « injoignable » (SharePoint
  // pas synchronisé, ou tout autre empêchement du même effet).
  fs.writeFileSync(path.join(s.ancrage, '2_Produkte'), 'obstacle');

  const resultat = avecEnv(varsSandbox(s), () => rapportErreur.emettreRapport(CHAMPS_MINIMAUX));
  assert.equal(resultat.ecrit, false);
  assert.equal(resultat.enAttente, true);
  const attente = dossierAttenteDe(s);
  assert.deepEqual(fs.readdirSync(attente), [resultat.id + '.json']);

  // Le vidage : un ancrage propre, cette fois, résout l'obstruction.
  const ancragePropre = dossierJetable('szh-ancrage-propre');
  const deplace = avecEnv({ SZH_ANCRAGE: ancragePropre, SZH_BASE: s.base, LOCALAPPDATA: s.local },
    () => rapportErreur.viderFileAttente());
  assert.equal(deplace.deplaces, 1);
  assert.equal(deplace.restes, 0);
  assert.deepEqual(fs.readdirSync(attente), [], 'le fichier doit avoir quitté la file');
  assert.deepEqual(fs.readdirSync(dossierRapportsDe({ ancrage: ancragePropre })), [resultat.id + '.json']);
});

test('purgerFileAttente() : plafond de 50 fichiers (les plus anciens effacés) et fichiers de plus de 30 jours', () => {
  const local = dossierJetable('szh-local-attente');
  const dossier = path.join(local, 'SZH', 'rapports-en-attente');
  fs.mkdirSync(dossier, { recursive: true });
  const maintenant = Date.now();
  // 5 fichiers vieux de 40 jours (à effacer sans être transmis), 50 fichiers récents à
  // dates échelonnées (les 5 plus anciens de ceux-là devraient tomber sous le plafond de 50
  // s'ils s'ajoutaient aux fichiers restants — ici, exactement 50 doivent survivre).
  for (let i = 0; i < 5; i++) {
    const p = path.join(dossier, 'vieux-' + i + '.json');
    fs.writeFileSync(p, '{}');
    const t = (maintenant - 40 * 24 * 3600 * 1000 - i * 1000) / 1000;
    fs.utimesSync(p, t, t);
  }
  for (let i = 0; i < 50; i++) {
    const p = path.join(dossier, 'recent-' + String(i).padStart(3, '0') + '.json');
    fs.writeFileSync(p, '{}');
    const t = (maintenant - (50 - i) * 1000) / 1000;   // croissant : recent-000 est le plus ancien des 50
    fs.utimesSync(p, t, t);
  }
  const restant = avecEnv({ LOCALAPPDATA: local }, () => rapportErreur.purgerFileAttente(new Date(maintenant)));
  assert.equal(restant.length, 50);
  const nomsRestants = fs.readdirSync(dossier).sort();
  assert.equal(nomsRestants.length, 50);
  assert.ok(nomsRestants.every((n) => n.indexOf('vieux-') === -1), 'les fichiers de plus de 30 jours doivent avoir disparu');
});

test('emettreRapport() : un échec d’écriture, réel ET en attente, ne lève pas et ne produit pas de second rapport', () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.ancrage, '2_Produkte'), 'obstacle');   // le dossier réel échoue
  const localBloque = path.join(dossierJetable('szh-local-bloque'), 'fichier-pas-un-dossier');
  fs.writeFileSync(localBloque, 'x');   // LOCALAPPDATA lui-même n'est pas un dossier : la file échoue aussi

  // Appel SANS try/catch autour : si emettreRapport() laissait fuir une exception, ce test
  // échouerait immédiatement de lui-même (D5, la règle absolue).
  const resultat = avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: localBloque },
    () => rapportErreur.emettreRapport(CHAMPS_MINIMAUX));
  assert.equal(resultat.ecrit, false);
  assert.equal(resultat.enAttente, false);
  assert.equal(resultat.motif, 'ecriture-impossible');
});

// Demandé après relecture : du code de production qui se désarme sur une variable
// d'environnement de test mérite un test qui prouve l'INVERSE — sans elle, l'écriture a
// bien lieu — sans quoi un jour quelqu'un désarme le rapport d'erreur sans s'en apercevoir.
// Nom de fonction gardé stable (ne pas renommer, cf. lib/rapport-erreur.js) : d'autres
// endroits de ce fichier s'y réfèrent en toute confiance.
test('ecritureReelleEviteeParHarnaisTest() : ne coupe QUE sous SZH_RESEAU_INTERDIT, sans destination explicite', () => {
  const avaitInterdit = process.env.SZH_RESEAU_INTERDIT;
  const avaitRapports = process.env.SZH_RAPPORTS;
  delete process.env.SZH_RAPPORTS;
  try {
    process.env.SZH_RESEAU_INTERDIT = '1';
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'config' }), true);
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'cache' }), true);
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'absent' }), true);
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'essai' }), false,
      'un ancrage explicitement fourni par le test (SZH_ANCRAGE) doit toujours pouvoir écrire');

    // D10 : SZH_RAPPORTS fournit une destination explicite à lui seul — même sur un
    // ancrage résolu par config.json (jamais fourni par le test).
    process.env.SZH_RAPPORTS = 'peu-importe-le-dossier';
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'config' }), false,
      'SZH_RAPPORTS doit à lui seul suffire à autoriser l’écriture, quelle que soit l’origine de l’ancrage');
    delete process.env.SZH_RAPPORTS;

    delete process.env.SZH_RESEAU_INTERDIT;
    // Hors du banc de test (le cas réel de production, où cette variable n'existe jamais) :
    // l'écriture ne doit JAMAIS être coupée, quelle que soit l'origine de l'ancrage.
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'config' }), false);
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'cache' }), false);
    assert.equal(rapportErreur.ecritureReelleEviteeParHarnaisTest({ origine: 'essai' }), false);
  } finally {
    if (avaitInterdit === undefined) { delete process.env.SZH_RESEAU_INTERDIT; } else { process.env.SZH_RESEAU_INTERDIT = avaitInterdit; }
    if (avaitRapports === undefined) { delete process.env.SZH_RAPPORTS; } else { process.env.SZH_RAPPORTS = avaitRapports; }
  }
});

test('emettreRapport() : sans SZH_RESEAU_INTERDIT, l’écriture réelle a bien lieu même hors origine « essai »', () => {
  const s = sandbox();
  // L'ancrage vient de config.json (origine 'config'), PAS de SZH_ANCRAGE : exactement le
  // cas que la garde du banc de test pourrait couper à tort si elle était mal réglée.
  fs.rmSync(s.ancrage, { recursive: true, force: true });
  fs.writeFileSync(path.join(s.base, 'config.json'), JSON.stringify({ ancrageSharePoint: s.base }) + '\n');

  const avait = process.env.SZH_RESEAU_INTERDIT;
  delete process.env.SZH_RESEAU_INTERDIT;
  try {
    avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
      assert.equal(rapportErreur.resoudreAncrage().origine, 'config');
      const resultat = rapportErreur.emettreRapport(CHAMPS_MINIMAUX);
      assert.equal(resultat.ecrit, true, 'motif : ' + resultat.motif);
    });
  } finally {
    if (avait === undefined) { delete process.env.SZH_RESEAU_INTERDIT; } else { process.env.SZH_RESEAU_INTERDIT = avait; }
  }
  assert.equal(fs.readdirSync(dossierRapportsDe({ ancrage: s.base })).length, 1,
    'le rapport doit avoir été écrit pour de vrai dans le dossier dérivé de l’ancrage résolu par config.json');
});

// ---- D10 : SZH_ANCRAGE et SZH_RAPPORTS sont deux surcharges ORTHOGONALES --------------
//
// Amendement du 09.09.2026 (Robin, en éprouvant ce module) : avant D10, SZH_RAPPORTS ÉTAIT
// la surcharge d'ancrage, et un dossier de rapports qu'on lui passait directement héritait
// d'un `2_Produkte\Edition SZH CSPS allgemein\_AutoReportToolboxZeitscrhiften` de trop en
// dessous de lui. Les trois tests ci-dessous couvrent chaque variable séparément, puis leur
// combinaison — exactement le piège qui a été trouvé.

test('SZH_ANCRAGE seule : dérive le dossier de rapports habituel (2_Produkte\\…) SOUS elle', () => {
  const s = sandbox();
  avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    const resultat = rapportErreur.emettreRapport(CHAMPS_MINIMAUX);
    assert.equal(resultat.ecrit, true, 'motif : ' + resultat.motif);
    assert.deepEqual(fs.readdirSync(dossierRapportsDe(s)), [resultat.id + '.json']);
    // Rien d'écrit directement DANS l'ancrage : tout est sous 2_Produkte\Edition SZH…
    assert.deepEqual(fs.readdirSync(s.ancrage), ['2_Produkte']);
  });
});

test('SZH_RAPPORTS seule : le dossier de rapports EST cette valeur, telle quelle, sans dérivation', () => {
  const s = sandbox();
  const rapportsDirect = dossierJetable('szh-rapports-direct');
  // SZH_ANCRAGE mis à '' explicitement : la Partie 2 (plus bas dans ce fichier) le pose
  // globalement dès le chargement du module, avant qu'aucun test ne s'exécute — sans ce
  // vidage, ce test hériterait de sa valeur et résoudrait un ancrage qu'il ne veut pas.
  avecEnv({ SZH_ANCRAGE: '', SZH_RAPPORTS: rapportsDirect, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    // Aucun ancrage résolu (SZH_ANCRAGE absent, config.json et le cache vides) : sans D10,
    // ce cas partirait en file d'attente. Avec D10, SZH_RAPPORTS suffit à lui seul.
    assert.equal(rapportErreur.resoudreAncrage().trouve, false);
    const resultat = rapportErreur.emettreRapport(CHAMPS_MINIMAUX);
    assert.equal(resultat.ecrit, true, 'motif : ' + resultat.motif);
    assert.equal(resultat.enAttente, false);
    // Le fichier est DIRECTEMENT dans rapportsDirect — aucun « 2_Produkte » en dessous.
    assert.deepEqual(fs.readdirSync(rapportsDirect), [resultat.id + '.json']);
    const rapport = JSON.parse(fs.readFileSync(path.join(rapportsDirect, resultat.id + '.json'), 'utf8'));
    // Sans ancrage résolu, le champ `ancrage` du rapport le dit honnêtement : trouvé
    // séparément de « où atterrit le fichier », D10 ne change rien à ce champ.
    assert.deepEqual(rapport.ancrage, { trouve: false, origine: 'absent', chemin: null });
  });
});

test('SZH_ANCRAGE + SZH_RAPPORTS ensemble : orthogonales — chacune ne fait que ce que son nom dit', () => {
  const s = sandbox();
  const rapportsDirect = dossierJetable('szh-rapports-direct-combine');
  avecEnv({ SZH_ANCRAGE: s.ancrage, SZH_RAPPORTS: rapportsDirect, SZH_BASE: s.base, LOCALAPPDATA: s.local }, () => {
    // Un fichier d'article, réellement sous l'ancrage : la mise en chemin relatif doit
    // continuer à fonctionner exactement comme si SZH_RAPPORTS n'existait pas.
    const cheminArticle = path.join(s.ancrage, '2_Produkte', '52_Revue', 'x.md');
    const resultat = rapportErreur.emettreRapport(Object.assign({}, CHAMPS_MINIMAUX, {
      fichiers: [{ chemin: cheminArticle, role: 'article' }]
    }));
    assert.equal(resultat.ecrit, true, 'motif : ' + resultat.motif);

    // La destination d'écriture EST rapportsDirect, tel quel — jamais dérivée de l'ancrage.
    assert.deepEqual(fs.readdirSync(rapportsDirect), [resultat.id + '.json']);
    assert.equal(fs.existsSync(dossierRapportsDe(s)), false,
      'aucune dérivation ne doit avoir eu lieu sous l’ancrage : SZH_RAPPORTS l’emporte sans condition');

    const rapport = JSON.parse(fs.readFileSync(path.join(rapportsDirect, resultat.id + '.json'), 'utf8'));
    // L'ancrage, lui, reste celui résolu par SZH_ANCRAGE — origine 'essai', chemin exact —
    // et le fichier de l'article sort bien relatif À CET ANCRAGE, D10 ne touchant en rien
    // à la résolution de l'ancrage ni au masquage des chemins.
    assert.deepEqual(rapport.ancrage, { trouve: true, origine: 'essai', chemin: s.ancrage });
    assert.deepEqual(rapport.fichiers[0], { chemin: '2_Produkte\\52_Revue\\x.md', relatifA: 'ancrage', role: 'article' });
  });
});

// =========================================================================================
// Partie 2 — les deux accroches d'extension.js, via l'hôte factice
// =========================================================================================
//
// Les trois variables sont posées AVANT d'activer l'hôte (activate() vide la file dès
// l'activation) et reposées en tête de chaque test de cette partie : la Partie 1 les
// manipule aussi, dans le MÊME processus (node --test donne un processus par fichier), et
// rien ne garantit l'ordre relatif d'exécution des deux parties.
const { revueDEssai, activerHote } = require('./hote-factice');
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';

const SANDBOX_HOTE = sandbox();
function reposerEnvHote() {
  process.env.SZH_ANCRAGE = SANDBOX_HOTE.ancrage;
  delete process.env.SZH_RAPPORTS;   // le dossier de rapports reste dérivé de l'ancrage ici
  process.env.SZH_BASE = SANDBOX_HOTE.base;
  process.env.LOCALAPPDATA = SANDBOX_HOTE.local;
}
reposerEnvHote();
const REVUE = revueDEssai();

// Pas de process.on('uncaughtException', …) côté extension.js (retiré après relecture :
// poser un tel écouteur change le comportement de l'hôte d'extensions PARTAGÉ pour toutes
// les extensions, et attraperait les exceptions des AUTRES). COCKPIT-EXCEPTION part donc
// d'une frontière plus étroite et plus sûre : envelopperCommande(), posée sur cmd() et
// cmdEcriture() — l'enregistrement de TOUTES les commandes szh.*. Rien à intercepter ici
// avant activation ; le test plus bas invoque directement une commande rendue défaillante.
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);

function fichiersRapportsHote() {
  try { return fs.readdirSync(dossierRapportsDe(SANDBOX_HOTE)); } catch (e) { return []; }
}

test('hôte : mise en route', async () => {
  reposerEnvHote();
  for (let i = 0; i < 20; i++) { await unTick(); }
});

test('hôte : une compilation en échec (code non nul) écrit un rapport COMPIL-ECHEC', async () => {
  reposerEnvHote();
  const avant = fichiersRapportsHote().length;
  await HOTE.finirTache(NOM_TACHE_BUILD, 1);
  await unTick();
  const apres = fichiersRapportsHote();
  assert.equal(apres.length, avant + 1, 'exactement un rapport doit être apparu');
  const nouveau = apres.filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(dossierRapportsDe(SANDBOX_HOTE), n), 'utf8')))
    .find((r) => r.code === 'COMPIL-ECHEC' && r.message && r.message.indexOf('code de sortie 1') !== -1);
  assert.ok(nouveau, 'aucun rapport COMPIL-ECHEC reconnaissable parmi : ' + JSON.stringify(apres));
  assert.equal(nouveau.source, 'chaine');
  assert.deepEqual(codesErreur.validerRapport(nouveau), []);
});

test('hôte : une compilation réussie (code 0) ne déclenche jamais de rapport, même avec des constats de contenu', async () => {
  reposerEnvHote();
  // Un vrai .szh-journal.log portant une ligne de constat de qualité, pour que la garde
  // porte sur le CODE de sortie et non sur l'absence de contenu à signaler.
  fs.writeFileSync(path.join(REVUE, '.szh-journal.log'),
    "⚠ Un dossier de articles/ contient des espaces\n", 'utf8');
  const avant = fichiersRapportsHote().length;
  await HOTE.finirTache(NOM_TACHE_BUILD, 0);
  await unTick();
  assert.equal(fichiersRapportsHote().length, avant,
    'un constat de qualité de contenu ne doit jamais, à lui seul, déclencher un rapport');
});

test('hôte : une commande szh.* qui lève écrit un rapport COCKPIT-EXCEPTION, puis relance l’erreur telle quelle', () => {
  reposerEnvHote();
  const arbre = HOTE.arbre();   // le même FournisseurRevue que le treeDataProvider posé par activate()
  const original = arbre.definirSectionDeployee;
  arbre.definirSectionDeployee = () => { throw new Error('essai de panne cockpit'); };
  const avant = fichiersRapportsHote().length;
  try {
    // szh.ouvrirSection appelle fournisseur.definirSectionDeployee() en premier geste :
    // l'enveloppe posée sur cmd() doit signaler PUIS relancer À L'IDENTIQUE — VSCodium doit
    // voir exactement la même erreur qu'en l'absence de notre accroche.
    assert.throws(() => HOTE.executer('szh.ouvrirSection', 'articles'), /essai de panne cockpit/);
  } finally {
    arbre.definirSectionDeployee = original;
  }
  const apres = fichiersRapportsHote();
  assert.equal(apres.length, avant + 1, 'exactement un rapport doit être apparu');
  const nouveau = apres.filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(dossierRapportsDe(SANDBOX_HOTE), n), 'utf8')))
    .find((r) => r.code === 'COCKPIT-EXCEPTION' && r.message === 'essai de panne cockpit');
  assert.ok(nouveau, 'aucun rapport COCKPIT-EXCEPTION reconnaissable parmi : ' + JSON.stringify(apres));
  assert.equal(nouveau.source, 'cockpit');
  assert.match(nouveau.pile || '', /Error: essai de panne cockpit/);
  assert.deepEqual(codesErreur.validerRapport(nouveau), []);
});

test('extension.js : aucun process.on(\'uncaughtException\'/\'unhandledRejection\') — l’hôte d’extensions partagé n’est jamais touché', () => {
  const source = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  assert.equal(/process\.on\(\s*['"]uncaughtException['"]/.test(source), false,
    'un écouteur uncaughtException changerait le comportement de l’hôte d’extensions pour TOUTES les extensions');
  assert.equal(/process\.on\(\s*['"]unhandledRejection['"]/.test(source), false);
});
