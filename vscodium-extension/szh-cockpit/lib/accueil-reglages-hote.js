// L'onglet Paramètres de l'Accueil côté hôte : les valeurs que la page reçoit, les réglages propres
// à l'Accueil (produit proposé, mise à jour silencieuse, mode développeur), les services en ligne
// (adresse Shlink en réglage, clés Shlink et OJS dans SecretStorage) et la recopie, une seule
// fois, des réglages d'avant. Les autres messages vont à lib/reglages-hote.js.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T, langueCockpit, oublierLanguePoste, cheminEtatDuPoste } = require('./i18n');
const { MSG } = require('./messages');
const reglages = require('./reglages-hote');
const services = require('./services-env');
const rapport = require('./rapport-erreur');
const archivage = require('./archivage');
const inventaire = require('./inventaire');
const { produitParDefaut } = require('./accueil-page');

// Les clés du coffre : jamais écrites ailleurs, jamais envoyées à la page.
const COFFRE = Object.freeze({ shlinkCle: 'szh.shlinkCle', ojsCle: 'szh.ojsCle' });
// Valeur gardée du temps du « lanceur » : la renommer recopierait une seconde fois les réglages.
const CLE_RECOPIE = 'szh.lanceur.reglagesRecopies';
const RE_HTTPS = /^https:\/\/[^\s/$.?#][^\s]*$/i;
// Ceux de REGLER qui sont propres à l'Accueil ; les autres vont à lib/reglages-hote.js.
const CLES_PROPRES = new Set(['produit', 'majSilencieuse', 'modeDev']);

let ctx = { rafraichirTout: null, recharger: () => {}, rechargerPage: () => {} };
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

let secrets = null;
let collection = null;

function configSzh() { return vscode.workspace.getConfiguration('szh'); }
function adresseShlink() { return String(configSzh().get('shlinkUrl', '') || '').trim(); }

// La copie en mémoire des trois valeurs que la chaîne reçoit (lib/services-env.js), relue à
// l'activation et à chaque changement du coffre ou de l'adresse.
async function relireServices() {
  const lire = async (cle) => {
    try { return secrets ? String((await secrets.get(cle)) || '') : ''; } catch (e) { return ''; }
  };
  services.poser({ url: adresseShlink(), shlinkCle: await lire(COFFRE.shlinkCle), ojsCle: await lire(COFFRE.ojsCle) });
  appliquerAuxTerminaux();
}

// Ctrl+S lance la tâche de tasks.json sans passer par le cockpit : on lui offre les mêmes
// variables par l'environnement des terminaux, que VS Code applique aux tâches. Non persisté :
// une clé ne doit pas rester dans le stockage de l'espace de travail.
function appliquerAuxTerminaux() {
  if (!collection) { return; }
  try {
    collection.persistent = false;
    collection.clear();
    const plus = services.ajouts(process.env);
    if (plus) { for (const nom of Object.keys(plus)) { collection.replace(nom, plus[nom]); } }
  } catch (e) { /* hôte sans cette interface */ }
}

function majSilencieuse() {
  const v = (rapport.lireEtatUtilisateur() || {}).majSilencieuse;
  return v === true || String(v).toLowerCase() === 'true';
}

// Ce que la page affiche en plus du reste : jamais une clé, seulement « réglée » ou non.
function messageValeurs() {
  const msg = reglages.messageValeursReglages();
  const v = services.variables();
  const choisi = String(configSzh().get('produitParDefaut', '') || '');
  Object.assign(msg.valeurs, {
    majSilencieuse: majSilencieuse() ? 'silence' : 'fenetre',
    modeDev: archivage.lireModeDeveloppeur() ? 'actif' : 'inactif'
  });
  msg.poste = {
    produit: inventaire.ORDRE.indexOf(choisi) !== -1 ? choisi : '',
    produitAuto: produitParDefaut(langueCockpit(), '', null, inventaire.ORDRE)
  };
  msg.services = {
    shlinkUrl: adresseShlink(), shlinkCle: !!v.SZH_SHLINK_CLE, ojsCle: !!v.SZH_OJS_CLE
  };
  return msg;
}

function ecrireEtatCompte(fn) {
  if (rapport.ecrireEtatUtilisateur(fn)) { return; }
  vscode.window.showErrorMessage(T('err.ecriture', ['etat-utilisateur.json', '']));
}

// Les scripts PowerShell restants lisent la langue dans etat-utilisateur.json puis state.json :
// le choix fait ici leur est recopié, sans quoi leur fenêtre parlerait l'autre langue.
function miroirLangue(langue) {
  ecrireEtatCompte((avant) => Object.assign({}, avant, { langueInterface: langue }));
  try {
    const chemin = cheminEtatDuPoste();
    const etat = rapport.lireJsonTolerant(chemin);
    etat.langue = langue;
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    fs.writeFileSync(chemin, JSON.stringify(etat, null, 2) + '\n', 'utf8');
  } catch (e) { /* state.json est le miroir : le choix principal est déjà posé */ }
}

async function regler(msg) {
  const Global = vscode.ConfigurationTarget.Global;
  if (msg.cle === 'produit') {
    const v = inventaire.ORDRE.indexOf(msg.valeur) !== -1 ? msg.valeur : '';
    await configSzh().update('produitParDefaut', v === '' ? undefined : v, Global);
    ctx.recharger();
  } else if (msg.cle === 'majSilencieuse') {
    const silence = msg.valeur === 'silence';
    ecrireEtatCompte((avant) => Object.assign({}, avant, { majSilencieuse: silence }));
  } else if (msg.cle === 'modeDev') {
    const erreur = reglages.modifierConfigPoste((avant) =>
      archivage.configAvecEmplacement(avant, msg.valeur === 'actif' ? archivage.EMPLACEMENT_TEST : archivage.EMPLACEMENT_PRODUCTION));
    if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(archivage.cheminConfigPoste()), erreur])); }
    ctx.recharger();   // les listes de numéros pointent vers un autre dossier
  }
}

// Poser ou effacer l'adresse ou une clé. Un champ vide efface. La réponse est le message de
// valeurs, où une clé n'est jamais qu'« définie » ou « absente ».
async function poserService(msg, repondre) {
  const valeur = String(msg.valeur === undefined || msg.valeur === null ? '' : msg.valeur).trim();
  const echec = (texte) => repondre({ type: MSG.ERREUR, bloc: 'service', service: msg.service, message: texte });
  try {
    if (msg.service === 'shlinkUrl') {
      if (valeur !== '' && !RE_HTTPS.test(valeur)) { echec(T('accueil.regl.shlink.invalide')); return; }
      await configSzh().update('shlinkUrl', valeur === '' ? undefined : valeur, vscode.ConfigurationTarget.Global);
    } else if (COFFRE[msg.service]) {
      if (!secrets) { echec(T('accueil.regl.coffre.absent')); return; }
      if (valeur === '') { await secrets.delete(COFFRE[msg.service]); }
      else { await secrets.store(COFFRE[msg.service], valeur); }
    } else { return; }
  } catch (e) {
    // Le message d'erreur du coffre peut citer la valeur : on ne le recopie pas.
    echec(T('accueil.regl.coffre.echec'));
    return;
  }
  await relireServices();
  repondre(messageValeurs());
}

// Rend vrai quand le message est celui des réglages.
async function surMessage(msg, repondre) {
  if (msg.type === MSG.ACCUEIL_SERVICE) { await poserService(msg, repondre); return true; }
  if (msg.type === MSG.REGLER && CLES_PROPRES.has(msg.cle)) { await regler(msg); return true; }
  const traite = await reglages.traiterMessage(msg, repondre, ctx.rafraichirTout);
  if (traite && msg.type === MSG.REGLER && msg.cle === 'langue') {
    miroirLangue(msg.valeur === 'de' ? 'de' : 'fr');
    oublierLanguePoste();
    ctx.rechargerPage();
  }
  return traite;
}

// Le verrou des réglages de la rédaction se referme quand on quitte l'onglet.
function surOnglet(onglet, repondre) {
  if (onglet === 'reglages') { repondre(messageValeurs()); return; }
  reglages.reverrouillerProteges();
  repondre(Object.assign({ type: MSG.PROTEGES }, reglages.etatProteges()));
}

function arreter() { reglages.reverrouillerProteges(); }

// Les réglages simples d'avant (produit proposé, langue) sont recopiés depuis
// etat-utilisateur.json une seule fois : le drapeau du globalState interdit la seconde. La mise
// à jour silencieuse et la langue y restent écrites aussi, car la tâche planifiée et les scripts
// PowerShell les lisent là.
async function recopierUneFois(context) {
  if (!context.globalState || context.globalState.get(CLE_RECOPIE)) { return; }
  const etat = rapport.lireEtatUtilisateur() || {};
  const cfg = configSzh();
  const global = (cle) => { const i = cfg.inspect(cle); return i ? i.globalValue : undefined; };
  const produit = String(etat.ongletDefaut || '').toLowerCase();
  if (inventaire.ORDRE.indexOf(produit) !== -1 && global('produitParDefaut') === undefined) {
    await cfg.update('produitParDefaut', produit, vscode.ConfigurationTarget.Global);
  }
  const langue = String(etat.langueInterface || '').toLowerCase();
  const dejaChoisie = global('langue') || ((archivage.lireConfigPoste() || {}).langue);
  if ((langue === 'fr' || langue === 'de') && !dejaChoisie) {
    await cfg.update('langue', langue, vscode.ConfigurationTarget.Global);
  }
  await context.globalState.update(CLE_RECOPIE, true);
}

function demarrer(context) {
  secrets = context.secrets || null;
  collection = context.environmentVariableCollection || null;
  const surChangement = () => { relireServices().catch(() => {}); };
  try {
    if (secrets && secrets.onDidChange) { context.subscriptions.push(secrets.onDidChange(surChangement)); }
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e || !e.affectsConfiguration || e.affectsConfiguration('szh.shlinkUrl')) { surChangement(); }
    }));
  } catch (e) { /* hôte sans ces évènements */ }
  relireServices().catch(() => {});
  recopierUneFois(context).catch((e) => { console.warn('réglages de l’Accueil : ' + ((e && e.message) || e)); });
}

module.exports = {
  configurer, demarrer, arreter, surMessage, surOnglet, messageValeurs, relireServices, recopierUneFois,
  COFFRE, CLE_RECOPIE
};
