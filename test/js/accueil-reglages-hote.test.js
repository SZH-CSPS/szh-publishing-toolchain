// L'onglet Paramètres de l'Accueil côté hôte (lib/accueil-reglages-hote.js) : szh.reglages ouvre
// l'Accueil sur cet onglet, les clés Shlink et OJS vont dans SecretStorage et n'en sortent que par
// l'environnement de la chaîne, les réglages simples sont recopiés une seule fois depuis
// l'état du compte, et langue comme mise à jour silencieuse restent écrites là où les scripts
// PowerShell les lisent.
//
//   node --test test/js/accueil-reglages-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Tout le poste est jetable : base, racines, état du compte, config.json, state.json.
const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-regl-hote-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const LOCAL = path.join(TRAVAIL, 'Local');
const CONFIG = path.join(TRAVAIL, 'config.json');
const STATE = path.join(TRAVAIL, 'state.json');
Object.assign(process.env, {
  SZH_BASE: path.join(TRAVAIL, 'ProgramData'), SZH_RACINE_TEST: path.join(TRAVAIL, 'Base'),
  SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'), SZH_ANCRAGE: '', SZH_ONGLET: '', LOCALAPPDATA: LOCAL,
  SZH_CONFIG_OJS: CONFIG, SZH_ETAT_POSTE: STATE
});
delete process.env.SZH_ACCUEIL;
delete process.env.WSLENV;
fs.mkdirSync(path.join(TRAVAIL, 'ProgramData'), { recursive: true });
fs.writeFileSync(CONFIG, '{}\n');
fs.writeFileSync(STATE, '{}\n');
// L'état du compte d'avant : le produit proposé et la langue, à recopier une fois.
const ETAT = path.join(LOCAL, 'SZH', 'etat-utilisateur.json');
fs.mkdirSync(path.dirname(ETAT), { recursive: true });
fs.writeFileSync(ETAT, JSON.stringify({ ongletDefaut: 'zeitschrift', langueInterface: 'fr', majSilencieuse: false }));
const lireEtat = () => JSON.parse(fs.readFileSync(ETAT, 'utf8'));
const lireJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const { revueDEssai, activerHote } = require('./hote-factice');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const services = require(path.join(COCKPIT, 'lib', 'services-env.js'));
const moteur = require(path.join(COCKPIT, 'lib', 'moteur.js'));
// Un fichier ouvert : l'Accueil ne s'ouvre pas seul, la commande doit l'ouvrir quand même.
const HOTE = activerHote(revueDEssai(), { sansDossier: true, onglets: [{ uri: { fsPath: path.join(TRAVAIL, 'note.md') } }] });

const CLE = 'cle-shlink-secrete-9876';
const panneau = () => HOTE.panneauDeType('szhAccueil');
const dits = (type) => panneau().messages.filter((m) => m.type === type);
const envoyer = (msg) => panneau()._recepteur(msg);
const tick = async () => { for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); } };

test('premier lancement : produit proposé recopié depuis l’état du compte, drapeau posé, jamais une seconde fois', async () => {
  await tick();
  assert.strictEqual(HOTE.configuration['szh.produitParDefaut'], 'zeitschrift');
  assert.strictEqual(HOTE.memoire['szh.lanceur.reglagesRecopies'], true);
  assert.strictEqual(HOTE.configuration['szh.langue'], 'fr', 'la langue de l’état du compte n’a pas été recopiée');
  // La mise à jour silencieuse reste dans l'état du compte : on n'y touche pas à la recopie.
  assert.strictEqual(lireEtat().majSilencieuse, false);
  // Une seconde recopie, réglages effacés et état changé : le drapeau l'interdit.
  const regl = require(path.join(COCKPIT, 'lib', 'accueil-reglages-hote.js'));
  delete HOTE.configuration['szh.produitParDefaut'];
  delete HOTE.configuration['szh.langue'];
  fs.writeFileSync(ETAT, JSON.stringify({ ongletDefaut: 'livre', langueInterface: 'de' }));
  await regl.recopierUneFois({ globalState: { get: (c) => HOTE.memoire[c], update: (c, v) => { HOTE.memoire[c] = v; return Promise.resolve(); } } });
  assert.strictEqual(HOTE.configuration['szh.produitParDefaut'], undefined, 'le produit a été recopié une seconde fois');
  assert.strictEqual(HOTE.configuration['szh.langue'], undefined, 'la langue a été recopiée une seconde fois');
  HOTE.configuration['szh.produitParDefaut'] = 'zeitschrift';
  fs.writeFileSync(ETAT, JSON.stringify({ ongletDefaut: 'zeitschrift', langueInterface: 'fr', majSilencieuse: false }));
});

test('la langue de l’état du compte se recopie au premier lancement, sauf si elle est déjà choisie', async () => {
  const regl = require(path.join(COCKPIT, 'lib', 'accueil-reglages-hote.js'));
  const memoire = {};
  const ctx = { globalState: { get: (c) => memoire[c], update: (c, v) => { memoire[c] = v; return Promise.resolve(); } } };
  fs.writeFileSync(ETAT, JSON.stringify({ langueInterface: 'fr' }));
  await regl.recopierUneFois(ctx);
  assert.strictEqual(HOTE.configuration['szh.langue'], 'fr');
  delete HOTE.configuration['szh.langue'];
  fs.writeFileSync(ETAT, JSON.stringify({ ongletDefaut: 'zeitschrift', langueInterface: 'fr', majSilencieuse: false }));
});

test('szh.reglages : sans Accueil ouvert ni produit, ouvre l’Accueil sur Paramètres, une seule page', async () => {
  assert.strictEqual(HOTE.panneaux.filter((p) => p.type === 'szhAccueil').length, 0, 'l’Accueil s’est ouvert seul : le test doit partir sans lui');
  await HOTE.executer('szh.reglages');
  assert.strictEqual(HOTE.panneaux.filter((p) => p.type === 'szhAccueil').length, 1);
  assert.strictEqual(HOTE.panneaux.filter((p) => p.type === 'szhReglages').length, 0, 'l’ancien panneau existe encore');
  await envoyer({ type: MSG.PRET });
  const charger = dits(MSG.CHARGER)[0];
  assert.strictEqual(charger.onglet, 'reglages');
  assert.strictEqual(charger.produit, 'zeitschrift', 'le produit proposé vient du réglage recopié');
  const valeurs = dits(MSG.VALEURS)[0];
  assert.ok(valeurs, 'les valeurs des réglages ne suivent pas le chargement');
  assert.deepStrictEqual(valeurs.services, { shlinkUrl: '', shlinkCle: false, ojsCle: false });
  assert.strictEqual(valeurs.valeurs.majSilencieuse, 'fenetre');
  assert.strictEqual(valeurs.valeurs.modeDev, 'actif', 'sans config, l’emplacement est « test »');
  assert.ok(valeurs.ojs && valeurs.biblio && valeurs.taches, 'sans produit ouvert, les blocs de la revue sont envoyés');
  // Rouvrir : la page existante reçoit l'ordre d'aller sur Paramètres.
  await HOTE.executer('szh.reglages');
  assert.strictEqual(HOTE.panneaux.filter((p) => p.type === 'szhAccueil').length, 1);
  assert.deepStrictEqual(dits(MSG.ACCUEIL_ALLER), [{ type: MSG.ACCUEIL_ALLER, onglet: 'reglages' }]);
});

test('adresse Shlink : https:// exigé, valide enregistrée, vide efface', async () => {
  await envoyer({ type: MSG.ACCUEIL_SERVICE, service: 'shlinkUrl', valeur: 'http://link.exemple.ch' });
  const refus = dits(MSG.ERREUR).pop();
  assert.strictEqual(refus.bloc, 'service');
  assert.ok(refus.message);
  assert.strictEqual(HOTE.configuration['szh.shlinkUrl'], undefined);
  await envoyer({ type: MSG.ACCUEIL_SERVICE, service: 'shlinkUrl', valeur: 'https://link.exemple.ch' });
  assert.strictEqual(HOTE.configuration['szh.shlinkUrl'], 'https://link.exemple.ch');
  assert.strictEqual(dits(MSG.VALEURS).pop().services.shlinkUrl, 'https://link.exemple.ch');
  assert.strictEqual(services.variables().SZH_SHLINK_URL, 'https://link.exemple.ch');
});

test('clé Shlink : dans SecretStorage seulement, jamais dans un message, dans l’env de la chaîne', async () => {
  await envoyer({ type: MSG.ACCUEIL_SERVICE, service: 'shlinkCle', valeur: '  ' + CLE + '  ' });
  await tick();
  assert.strictEqual(HOTE.coffre['szh.shlinkCle'], CLE);
  assert.strictEqual(dits(MSG.VALEURS).pop().services.shlinkCle, true);
  // Jamais la clé dans ce que la page reçoit, ni sur le disque du poste.
  assert.ok(JSON.stringify(panneau().messages).indexOf(CLE) === -1, 'la clé est partie vers la page');
  for (const f of [CONFIG, STATE, ETAT]) { assert.ok(fs.readFileSync(f, 'utf8').indexOf(CLE) === -1, 'clé en clair dans ' + f); }
  assert.ok(JSON.stringify(HOTE.configuration).indexOf(CLE) === -1, 'clé dans les réglages de l’éditeur');
  // L'env de la chaîne : variables et WSLENV.
  const ligne = moteur.ligneTache(['make']);
  assert.strictEqual(ligne.options.env.SZH_SHLINK_CLE, CLE);
  assert.strictEqual(ligne.options.env.SZH_SHLINK_URL, 'https://link.exemple.ch');
  assert.strictEqual(ligne.options.env.WSLENV, 'SZH_SHLINK_URL/u:SZH_SHLINK_CLE/u');
  assert.strictEqual(JSON.stringify(ligne.args).indexOf(CLE), -1);
  // Et l'environnement des terminaux, pour Ctrl+S, sans persistance.
  assert.strictEqual(HOTE.variablesTerminal.SZH_SHLINK_CLE, CLE);
  assert.strictEqual(HOTE.terminal.persistent, false);
});

test('une clé modifiée hors de la page (onDidChange) est relue', async () => {
  await HOTE.secrets.store('szh.ojsCle', 'cle-ojs-0001');
  await tick();
  assert.strictEqual(services.variables().SZH_OJS_CLE, 'cle-ojs-0001');
  await HOTE.secrets.delete('szh.ojsCle');
  await tick();
  assert.strictEqual(services.variables().SZH_OJS_CLE, undefined);
  await envoyer({ type: MSG.ACCUEIL_SERVICE, service: 'ojsCle', valeur: 'cle-ojs-0002' });
  await tick();
  assert.strictEqual(services.variables().SZH_OJS_CLE, 'cle-ojs-0002');
});

test('Effacer, ou un champ vide enregistré, supprime la clé et ses variables', async () => {
  await envoyer({ type: MSG.ACCUEIL_SERVICE, service: 'shlinkCle', valeur: '' });
  await tick();
  assert.strictEqual(HOTE.coffre['szh.shlinkCle'], undefined);
  assert.strictEqual(dits(MSG.VALEURS).pop().services.shlinkCle, false);
  assert.strictEqual(services.variables().SZH_SHLINK_CLE, undefined);
  await envoyer({ type: MSG.ACCUEIL_SERVICE, service: 'ojsCle', valeur: '' });
  await envoyer({ type: MSG.ACCUEIL_SERVICE, service: 'shlinkUrl', valeur: '' });
  await tick();
  // Plus rien de réglé : plus aucune variable posée, nulle part.
  assert.deepStrictEqual(services.variables(), {});
  assert.strictEqual(moteur.ligneTache(['make']).options, undefined);
  assert.deepStrictEqual(HOTE.variablesTerminal, {});
});

test('réglages simples : produit, mise à jour silencieuse, mode développeur', async () => {
  await envoyer({ type: MSG.REGLER, cle: 'produit', valeur: 'livre' });
  assert.strictEqual(HOTE.configuration['szh.produitParDefaut'], 'livre');
  await envoyer({ type: MSG.REGLER, cle: 'produit', valeur: 'nimporte' });
  assert.strictEqual(HOTE.configuration['szh.produitParDefaut'], undefined, 'un produit inconnu vaut « automatique »');
  await envoyer({ type: MSG.REGLER, cle: 'majSilencieuse', valeur: 'silence' });
  assert.strictEqual(lireEtat().majSilencieuse, true);
  assert.strictEqual(lireEtat().ongletDefaut, 'zeitschrift', 'le reste de l’état est gardé');
  await envoyer({ type: MSG.REGLER, cle: 'modeDev', valeur: 'inactif' });
  assert.strictEqual(lireJson(CONFIG).emplacementRevues, 'production');
  await envoyer({ type: MSG.REGLER, cle: 'modeDev', valeur: 'actif' });
  assert.strictEqual(lireJson(CONFIG).emplacementRevues, 'test');
});

test('langue : réglage, config.json, et le miroir lu par les scripts PowerShell (compte et state.json)', async () => {
  fs.writeFileSync(STATE, JSON.stringify({ version: '2026.10.1' }));
  await envoyer({ type: MSG.REGLER, cle: 'langue', valeur: 'de' });
  assert.strictEqual(HOTE.configuration['szh.langue'], 'de');
  assert.strictEqual(lireJson(CONFIG).langue, 'de');
  assert.strictEqual(lireEtat().langueInterface, 'de');
  assert.strictEqual(lireJson(STATE).langue, 'de');
  assert.strictEqual(lireJson(STATE).version, '2026.10.1', 'state.json garde ses autres clés');
  // La page se reconstruit dans la nouvelle langue.
  assert.ok(panneau().html && panneau().html.indexOf('lang="de"') !== -1);
  await envoyer({ type: MSG.REGLER, cle: 'langue', valeur: 'fr' });
  assert.strictEqual(lireJson(STATE).langue, 'fr');
  assert.strictEqual(lireEtat().langueInterface, 'fr');
});

test('verrou des réglages de la rédaction : se referme au changement d’onglet', async () => {
  HOTE.repondreModale(require(path.join(COCKPIT, 'lib', 'i18n.js')).T('regl.proteges.confirmer'));
  await envoyer({ type: MSG.DEVERROUILLER, valeur: true });
  assert.strictEqual(dits(MSG.PROTEGES).pop().deverrouille, true);
  await envoyer({ type: MSG.ACCUEIL_ONGLET, onglet: 'secretariat' });
  assert.strictEqual(dits(MSG.PROTEGES).pop().deverrouille, false, 'le verrou est resté ouvert hors de l’onglet');
  // Verrouillé, une écriture du bloc OJS est refusée.
  await envoyer({ type: MSG.REGLER_OJS, ojs: { revues: {}, rubriques: [], types: {} } });
  assert.strictEqual(dits(MSG.ERREUR).pop().bloc, 'ojs');
  // Revenir sur Paramètres renvoie les valeurs fraîches.
  const avant = dits(MSG.VALEURS).length;
  await envoyer({ type: MSG.ACCUEIL_ONGLET, onglet: 'reglages' });
  assert.strictEqual(dits(MSG.VALEURS).length, avant + 1);
});

test('tâches : une tâche de tasks.json reçoit les variables dans son env, sans rien perdre du sien', () => {
  services.poser({ url: 'https://l.ch', shlinkCle: CLE, ojsCle: '' });
  const tache = { execution: { options: { cwd: 'C:\R', env: { WSLENV: 'FOO/p', X: '1' } } } };
  services.dansTache(tache);
  assert.deepStrictEqual(tache.execution.options.env, {
    WSLENV: 'FOO/p:SZH_SHLINK_URL/u:SZH_SHLINK_CLE/u', X: '1', SZH_SHLINK_URL: 'https://l.ch', SZH_SHLINK_CLE: CLE });
  assert.strictEqual(tache.execution.options.cwd, 'C:\R');
  const sans = { execution: { options: undefined } };
  services.dansTache(sans);
  assert.strictEqual(sans.execution.options.env.SZH_SHLINK_CLE, CLE);
  services.poser({ url: '', shlinkCle: '', ojsCle: '' });
  const rien = { execution: { options: undefined } };
  services.dansTache(rien);
  assert.strictEqual(rien.execution.options, undefined, 'rien de réglé : la tâche part telle quelle');
  services.dansTache({});     // sans exécution : sans effet, sans exception
});

test('format de travail du Préprocessing : écrit dans szh.formatTravail, docx pour toute autre valeur', async () => {
  await envoyer({ type: MSG.REGLER, cle: 'formatTravail', valeur: 'odt' });
  assert.strictEqual(HOTE.configuration['szh.formatTravail'], 'odt');
  await envoyer({ type: MSG.REGLER, cle: 'formatTravail', valeur: 'pdf' });
  assert.strictEqual(HOTE.configuration['szh.formatTravail'], 'docx');
});
