// Les réglages « SZH » de l'onglet Paramètres de l'Accueil : valeurs, écritures, réglages
// protégés (relais, état, fichier à transmettre) et fichier de langue de l'interface. Les
// rappels vers l'hôte passent par configurer().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { dossierBureau, dossierEditeur } = require('./poste');

const { TEXTES_COCKPIT, T, TL, langueCockpit, oublierLanguePoste } = require('./i18n');
const { MSG } = require('./messages');
const profils = require('./profil');
const proteges = require('./reglages-proteges');
const exportLangue = require('./export-langue');
const rapportErreur = require('./rapport-erreur');
const suggestionTraduction = require('./suggestion-traduction');
const { empreinteReglages } = require('./reglages-flotte');
const { lireCache: lireCacheAuteursPublies } = require('./auteurs-ojs');
const { ecrireAtomique, LIBELLES_TYPES, REVUES, TYPES_ARTICLE } = require('./yaml');
const { ouvrirAvecSysteme } = require('./ouvrir-systeme');
const { configOjs, ecrireConfigOjs, CHAMPS_REVUE, LOCALES_REVUE, RUBRIQUES_DEFAUT } = require('./export-ojs');
const {
  configBiblio, configAvecTitresBiblio, configAvecLiensDesactives, REVUES_BIBLIO, LANGUES_BIBLIO
} = require('./citations');
const {
  REVUES_TACHES, CLE_TACHES, MAX_TACHES, tachesConfig, configAvecTaches
} = require('./articles');
const {
  cheminConfigPoste, lireConfigPoste, ecrireConfigPoste, configAvecLangue,
  lireVerifTraduction, configAvecVerifTraduction, lireModeTrad, configAvecModeTrad
} = require('./archivage');

function profilCourant() { return profils.courant(); }

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés par extension.js. Les défauts permettent de charger le module seul dans un test.
let ctx = {
  repondrePanneau: () => {},
  revelerDansExplorateur: async () => {},
  diffuserModeTrad: () => {},
  compterSuggestionsInterface: () => 0,
  replierAssetsAutres: () => true,
  convertirCmykActif: () => true,
  reduireWarningsImpressionActif: () => false,
  desactiverLiensReferencesActif: () => false
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// ---- Réglages « SZH » ------------------------------------------------------------
// La page écrit au niveau utilisateur par getConfiguration().update(…,
// Global). Le choix français/allemand pilote les chaînes du cockpit (szh.langue) et la
// locale native (argv.json, effective au redémarrage, et qui suppose le pack de langue).

// Lecture-modification-écriture de config.json. Un fichier illisible n'est pas écrasé, pour
// ne pas perdre l'emplacement des revues ni la configuration OJS. -> null quand c'est écrit,
// sinon le message d'erreur (le chemin du fichier s'il est illisible).
function modifierConfigPoste(fn) {
  const chemin = cheminConfigPoste();
  if (lireConfigPoste() === null && fs.existsSync(chemin)) { return chemin; }
  return ecrireConfigPoste(fn);
}

// Les tâches pour le panneau : la table effective des deux revues et leur nom lisible,
// tirés de lib/articles.js.
function donneesTaches() {
  return {
    table: tachesConfig(lireConfigPoste()),
    revues: REVUES_TACHES.map((cle) => ({ cle: cle, libelle: T('meta.revue.' + cle) })),
    max: MAX_TACHES
  };
}

// Le titre de la bibliographie pour le panneau : intitulés effectifs, deux revues et trois
// langues avec leur nom lisible, tirés de lib/citations.js et lib/yaml.js. Les valeurs par
// défaut sont dans le filtre de composition.
function donneesBiblio() {
  return {
    titres: configBiblio().titres,
    revues: REVUES_BIBLIO.map((cle) => ({
      cle: cle,
      libelle: T('ojs.revue.' + (REVUES.find((r) => r.cle === cle) || {}).langue)
    })),
    langues: LANGUES_BIBLIO.map((cle) => ({ cle: cle, libelle: T('meta.langue.' + cle) }))
  };
}

// État de la liste des auteur·e·s publiés, pour information : date de mise à jour et
// nombre de noms. Le rafraîchissement se fait à l'activation
// (rafraichirAuteursPubliesEnFond).
function resumeAuteursPublies() {
  try {
    const cache = lireCacheAuteursPublies();
    return {
      dateFetch: cache.dateFetch,                  // dernier moissonnage OJS
      dateCorpus: cache.dateCorpus || null,        // dernier balayage des numéros du poste
      nombre: cache.auteurs.length,
      nombreRor: Object.keys(cache.ror || {}).length
    };
  } catch (e) { return { dateFetch: null, dateCorpus: null, nombre: 0, nombreRor: 0 }; }
}

// L'export OJS pour le panneau : configuration effective, champs par revue avec leur
// libellé et l'endroit où relever la valeur, types d'article. Tirés de lib/export-ojs.js et
// lib/yaml.js.
function donneesOjs() {
  const langue = langueCockpit();
  const revues = {};
  for (const loc of LOCALES_REVUE) { revues[loc] = T('ojs.revue.' + loc); }
  return {
    config: configOjs(),
    locales: LOCALES_REVUE,
    revues: revues,
    // Les clés des rubriques livrées ne se renomment pas : le type d'article pointerait
    // vers une clé disparue.
    clesDefaut: RUBRIQUES_DEFAUT.map((r) => r.cle),
    champs: CHAMPS_REVUE.map((c) => ({
      cle: c.cle, requis: c.requis, libelle: T(c.libelle), ou: T(c.ou)
    })),
    typesArticle: TYPES_ARTICLE.map((t) => ({
      valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t
    }))
  };
}

// Par expression régulière : argv.json accepte des commentaires, qu'un JSON.parse
// perdrait.
function ecrireLocaleArgv(langue) {
  try {
    const dossier = dossierEditeur();
    const chemin = path.join(dossier, 'argv.json');
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { contenu = '{\n}\n'; }
    if (/"locale"\s*:\s*"[^"]*"/.test(contenu)) {
      contenu = contenu.replace(/"locale"\s*:\s*"[^"]*"/, '"locale": "' + langue + '"');
    } else {
      const pos = contenu.lastIndexOf('}');
      if (pos === -1) {
        contenu = '{\n\t"locale": "' + langue + '"\n}\n';
      } else {
        const avant = contenu.slice(0, pos).replace(/\s*$/, '');
        const virgule = /[{,]\s*$/.test(avant) ? '' : ',';
        contenu = avant + virgule + '\n\t"locale": "' + langue + '"\n' + contenu.slice(pos);
      }
    }
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(chemin, contenu, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// La langue d'affichage de VSCodium, fr ou de. '' sans pack de langue (menus en anglais) :
// il n'y a alors rien à comparer.
function langueEditeur() {
  const brut = String((vscode.env && vscode.env.language) || '').toLowerCase();
  if (brut.indexOf('de') === 0) { return 'de'; }
  if (brut.indexOf('fr') === 0) { return 'fr'; }
  return '';
}

// Le message affiché sous le choix de la langue quand les menus de VSCodium et les textes
// du cockpit ne sont pas dans la même langue : deux mécanismes indépendants les décident
// (voir l'en-tête de lib/i18n.js). -> '' quand ils concordent.
function avertissementLangue() {
  const cockpit = langueCockpit();
  const editeur = langueEditeur();
  if (editeur === '' || editeur === cockpit) { return ''; }
  return T('regl.langue.discordance', [T('meta.langue.' + cockpit), T('meta.langue.' + editeur)]);
}

// ---- Les réglages protégés : relais, état, et fichier à transmettre --------------
//
// Le fichier déployé par la mise à jour est la référence ; config.json est celui que le
// poste et la chaîne de compilation lisent. Le relais recopie la référence dans config.json
// seulement quand elle a changé : une modification faite après déverrouillage tient ainsi
// jusqu'à la mise à jour suivante.
const CLE_EMPREINTE_PROTEGES = 'szh.reglagesProteges.empreinte';

async function relayerReglagesProteges(context) {
  const reference = proteges.lireReglagesProteges();
  if (!reference) { return; }                      // absent ou illisible : on ne relaie rien
  const blocs = proteges.blocsProteges(reference);
  if (Object.keys(blocs).length === 0) { return; } // rien à imposer : le poste garde le sien
  const empreinte = empreinteReglages(blocs);
  if (context.globalState.get(CLE_EMPREINTE_PROTEGES) === empreinte) { return; }
  const erreur = modifierConfigPoste((avant) => proteges.configAvecProteges(avant, blocs));
  if (erreur) { console.warn('réglages protégés non relayés : ' + erreur); return; }
  await context.globalState.update(CLE_EMPREINTE_PROTEGES, empreinte);
}

// L'état des réglages protégés pour le formulaire : verrouillés ou non, et les blocs où le
// poste s'écarte de la version déployée. Le déverrouillage ne dure que le temps du panneau.
let protegesDeverrouilles = false;

// Le verrou se referme de lui-même quand la personne quitte l'onglet ou ferme la page.
function reverrouillerProteges() { protegesDeverrouilles = false; }

function etatProteges() {
  const ecarts = proteges.divergences(lireConfigPoste(), proteges.lireReglagesProteges());
  return {
    deverrouille: protegesDeverrouilles,
    divergences: ecarts,
    avertissement: ecarts.length > 0
      ? T('regl.proteges.diverge', [ecarts.map((b) => T('regl.proteges.bloc.' + b)).join(', ')])
      : ''
  };
}

// « Télécharger les réglages protégés » : l'état courant du poste, au format du fichier
// déployé, à transmettre à l'administrateur. Possible même verrouillé.
async function telechargerReglagesProteges() {
  const contenu = proteges.fichierATelecharger(lireConfigPoste(), T('regl.proteges.lisezmoi'));
  let cible;
  try {
    cible = await vscode.window.showSaveDialog({
      saveLabel: T('regl.proteges.telecharger'),
      defaultUri: vscode.Uri.file(path.join(await dossierBureau(), proteges.NOM_FICHIER))
    });
  } catch (e) { cible = null; }
  if (!cible) { return null; }                     // annulé
  try {
    ecrireAtomique(cible.fsPath, contenu);
    return T('regl.proteges.telecharge', [path.basename(cible.fsPath)]);
  } catch (e) {
    return T('err.ecriture', [path.basename(cible.fsPath), String((e && e.message) || e)]);
  }
}

// Les titres de commandes et le tutoriel viennent de package.nls*.json, que VSCodium
// résout selon sa propre langue ; ils entrent aussi dans le fichier de langue. Lus à côté
// de l'extension ; un fichier absent ou illisible rend une table vide.
function nlsCommandes() {
  const paire = {};
  for (const [langue, nom] of [['fr', 'package.nls.json'], ['de', 'package.nls.de.json']]) {
    try {
      const brut = String(fs.readFileSync(path.join(__dirname, '..', nom), 'utf8')).replace(/^﻿/, '');
      const valeurs = JSON.parse(brut);
      paire[langue] = valeurs && typeof valeurs === 'object' ? valeurs : {};
    } catch (e) { paire[langue] = {}; }
  }
  return paire;
}

// « Télécharger le fichier de langue » : tous les libellés de l'interface, fr et de côte à
// côte, dans un JSON pour relecture. Les phrases de _lire passent par TL(), pour être dans
// les deux langues quelle que soit celle de l'interface.
async function telechargerFichierLangue() {
  const version = rapportErreur.versionCockpit() || '';
  const contenu = exportLangue.serialiser(exportLangue.construire({
    cockpit: TEXTES_COCKPIT,
    commandes: nlsCommandes(),
    version: version,
    lire: { fr: TL('fr', 'regl.exportLangue.lire'), de: TL('de', 'regl.exportLangue.lire') }
  }));
  let cible;
  try {
    cible = await vscode.window.showSaveDialog({
      saveLabel: T('regl.exportLangue'),
      filters: { JSON: ['json'] },
      defaultUri: vscode.Uri.file(path.join(await dossierBureau(), exportLangue.nomFichier(version)))
    });
  } catch (e) { cible = null; }
  if (!cible) { return null; }                     // annulé
  try {
    ecrireAtomique(cible.fsPath, contenu);
  } catch (e) {
    return { erreur: T('regl.exportLangue.echec', [path.basename(cible.fsPath), String((e && e.message) || e)]) };
  }
  // Montré dans l'Explorateur, d'où il se glisse dans un courriel.
  await ctx.revelerDansExplorateur(cible);
  return { message: T('regl.exportLangue.faite', [path.basename(cible.fsPath)]) };
}

function lireFormatTravail() {
  try {
    const cfg = vscode.workspace.getConfiguration('szh');
    if (!cfg.inspect('formatTravail')) { return null; }
    return cfg.get('formatTravail', 'docx') === 'odt' ? 'odt' : 'docx';
  } catch (e) { return null; }
}

function lireReglagesActuels() {
  const cfg = vscode.workspace.getConfiguration();
  const autoDetect = cfg.get('window.autoDetectColorScheme', false) === true;
  const theme = String(cfg.get('workbench.colorTheme', '') || '');
  const etatTheme = autoDetect ? 'systeme'
    : (theme.toLowerCase().indexOf('light') !== -1 ? 'clair' : 'sombre');
  const zoom = Number(cfg.get('window.zoomLevel', 0)) || 0;
  let policeMd = 16;
  try {
    policeMd = Number(vscode.workspace.getConfiguration('editor', { languageId: 'markdown' }).get('fontSize', 16)) || 16;
  } catch (e) { /* valeur par défaut : 16 */ }
  // La valeur écrite, et non modeApercu(), qui force « html » sur un profil sans PDF.
  let apercu = 'html';
  try {
    apercu = String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { /* valeur par défaut : html */ }
  return {
    theme: etatTheme, zoom: String(zoom), policeMd: String(policeMd), apercu: apercu,
    assets: ctx.replierAssetsAutres() ? 'oui' : 'non',
    cmyk: ctx.convertirCmykActif() ? 'oui' : 'non',
    warnings: ctx.reduireWarningsImpressionActif() ? 'reduits' : 'complets',
    liensReferences: ctx.desactiverLiensReferencesActif() ? 'desactives' : 'actifs',
    langue: langueCockpit(),
    // Lu dans config.json, comme la langue.
    verifTrad: lireVerifTraduction() ? 'actif' : 'inactif',
    // Le mode « Trad », lu au même endroit.
    modeTrad: lireModeTrad() ? 'actif' : 'inactif',
    // Déclaré par l'onglet Préprocessing : tant qu'il ne l'est pas, null masque la ligne.
    formatTravail: lireFormatTravail()
    // Le mode développeur (dossiers de test) est géré par lib/accueil-reglages-hote.js.
  };
}

// Les blocs « Auteur·e·s publiés » (OJS), « Bibliographie », « Tâches par article » et
// « Export OJS » ne concernent que la revue. Pour un livre, ils ne sont pas envoyés, et
// media/accueil.js (montrer) laisse leur <section> masquée.
function messageValeursReglages() {
  const msg = {
    type: MSG.VALEURS, valeurs: lireReglagesActuels(),
    suggInterface: ctx.compterSuggestionsInterface(),
    avertLangue: avertissementLangue(), proteges: etatProteges()
  };
  if (profilCourant().cle !== 'livre') {
    msg.ojs = donneesOjs();
    msg.biblio = donneesBiblio();
    msg.taches = donneesTaches();
    msg.auteursOjs = resumeAuteursPublies();
  }
  return msg;
}

// Les messages de la page des réglages (onglet Paramètres de l'Accueil). `repondre(message)` écrit à
// la page ; ceux que ce module ne connaît pas (services, produit, mise à jour…) sont traités par
// lib/accueil-reglages-hote.js, qui l'appelle en dernier. Rend vrai quand le message est traité.
async function traiterMessage(msg, repondre, rafraichirTout) {
  // ---- Les réglages protégés ----
  //
  // Le déverrouillage se redemande à chaque ouverture du panneau. La question est posée ici
  // en fenêtre modale, ce qu'une webview ne peut pas faire.
  if (msg.type === MSG.DEVERROUILLER) {
    if (!msg.valeur) {
      protegesDeverrouilles = false;
      repondre(Object.assign({ type: MSG.PROTEGES }, etatProteges()));
      return true;
    }
    const continuer = await vscode.window.showWarningMessage(
      T('regl.proteges.question'),
      { modal: true, detail: T('regl.proteges.detail') },
      T('regl.proteges.confirmer'));
    protegesDeverrouilles = continuer === T('regl.proteges.confirmer');
    repondre(Object.assign({ type: MSG.PROTEGES }, etatProteges()));
    return true;
  }
  if (msg.type === MSG.TELECHARGER_PROTEGES) {
    const dit = await telechargerReglagesProteges();
    if (dit) { vscode.window.showInformationMessage(dit); }
    return true;
  }
  // Le fichier de langue de l'interface ; une annulation n'affiche rien.
  // Le dossier des suggestions sur les textes de l'interface, créé s'il n'existe pas.
  if (msg.type === MSG.SUGGESTIONS_INTERFACE) {
    const dossier = suggestionTraduction.dossierSuggestionsInterface();
    try { fs.mkdirSync(dossier, { recursive: true }); }
    catch (e) { /* déjà là, ou disque en lecture seule : openExternal le dira */ }
    try { await ouvrirAvecSysteme(dossier, vscode); }
    catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [dossier, String((e && e.message) || e)])); }
    return true;
  }
  if (msg.type === MSG.EXPORTER_LANGUE) {
    const dit = await telechargerFichierLangue();
    if (dit && dit.erreur) { vscode.window.showErrorMessage(dit.erreur); }
    else if (dit && dit.message) { vscode.window.showInformationMessage(dit.message); }
    return true;
  }
  // Verrouillés, ces deux blocs ne s'écrivent pas. Le formulaire les désactive déjà ; ceci
  // couvre un message envoyé pendant un reverrouillage.
  const BLOC_DE_MSG = {};
  BLOC_DE_MSG[MSG.REGLER_OJS] = 'ojs';
  BLOC_DE_MSG[MSG.REGLER_BIBLIO] = 'biblio';
  BLOC_DE_MSG[MSG.TACHES_ENREGISTRER] = CLE_TACHES;
  if (BLOC_DE_MSG[msg.type] && !protegesDeverrouilles) {
    repondre({
      type: MSG.ERREUR, bloc: BLOC_DE_MSG[msg.type], message: T('regl.proteges.refus')
    });
    return true;
  }
  // La configuration de l'export OJS va dans config.json, partagé avec les scripts
  // PowerShell.
  if (msg.type === MSG.REGLER_OJS) {
    const erreur = ecrireConfigOjs(msg.ojs || {});
    if (erreur) {
      const message = T('ojs.err.ecriture', [erreur]);
      vscode.window.showErrorMessage(message);
      // Sans réponse, l'enregistrement automatique du panneau (enVol) resterait bloqué.
      repondre({ type: MSG.ERREUR, bloc: 'ojs', message: message });
    } else {
      repondre({ type: MSG.ENREGISTRE, bloc: 'ojs' });
      // Le poste a pu s'écarter de la version déployée : le bandeau se met à jour.
      repondre(Object.assign({ type: MSG.PROTEGES }, etatProteges()));
    }
    return true;
  }
  // Le titre de la bibliographie, dans le même config.json.
  if (msg.type === MSG.REGLER_BIBLIO) {
    const erreur = modifierConfigPoste((avant) => configAvecTitresBiblio(avant, msg.titres || {}));
    if (erreur) {
      const message = T('err.ecriture', [path.basename(cheminConfigPoste()), erreur]);
      vscode.window.showErrorMessage(message);
      repondre({ type: MSG.ERREUR, bloc: 'biblio', message: message });
    } else {
      repondre({ type: MSG.ENREGISTRE, bloc: 'biblio' });
      // Le poste a pu s'écarter de la version déployée : le bandeau se met à jour.
      repondre(Object.assign({ type: MSG.PROTEGES }, etatProteges()));
    }
    return true;
  }
  // Les tâches éditoriales, dans le même config.json, écrites revue par revue
  // (configAvecTaches) pour ne pas effacer une revue absente du message. L'arbre et la vue
  // « Articles », qui affichent ces intitulés, sont rafraîchis.
  if (msg.type === MSG.TACHES_ENREGISTRER) {
    const table = (msg.taches && typeof msg.taches === 'object') ? msg.taches : {};
    const erreur = modifierConfigPoste((avant) => {
      let cfg = avant;
      for (const revue of REVUES_TACHES) {
        if (!Array.isArray(table[revue])) { continue; }
        cfg = configAvecTaches(cfg, revue, table[revue]);
      }
      return cfg;
    });
    if (erreur) {
      const message = T('err.ecriture', [path.basename(cheminConfigPoste()), erreur]);
      vscode.window.showErrorMessage(message);
      repondre({ type: MSG.ERREUR, bloc: CLE_TACHES, message: message });
      return true;
    }
    repondre({ type: MSG.ENREGISTRE, bloc: CLE_TACHES });
    // La page reçoit les identifiants créés pour les nouvelles tâches, sinon elle en
    // créerait un second pour le même intitulé.
    repondre({ type: MSG.VALEURS, valeurs: lireReglagesActuels(),
      taches: donneesTaches(), proteges: etatProteges() });
    repondre(Object.assign({ type: MSG.PROTEGES }, etatProteges()));
    if (rafraichirTout) { rafraichirTout(); }
    return true;
  }
  if (msg.type !== MSG.REGLER) { return false; }
  const Global = vscode.ConfigurationTarget.Global;
  const cfg = vscode.workspace.getConfiguration();
  try {
    if (msg.cle === 'theme') {
      if (msg.valeur === 'systeme') {
        await cfg.update('workbench.preferredLightColorTheme', 'Default Light Modern', Global);
        await cfg.update('workbench.preferredDarkColorTheme', 'Default Dark Modern', Global);
        await cfg.update('window.autoDetectColorScheme', true, Global);
      } else {
        await cfg.update('window.autoDetectColorScheme', false, Global);
        await cfg.update('workbench.colorTheme',
          msg.valeur === 'clair' ? 'Default Light Modern' : 'Default Dark Modern', Global);
      }
    } else if (msg.cle === 'zoom') {
      await cfg.update('window.zoomLevel', Number(msg.valeur) || 0, Global);
    } else if (msg.cle === 'policeMd') {
      // Limité à [markdown] : la taille d'affichage, pas le contenu.
      await vscode.workspace.getConfiguration('editor', { languageId: 'markdown' })
        .update('fontSize', Number(msg.valeur) || 16, Global, true);
    } else if (msg.cle === 'formatTravail') {
      await vscode.workspace.getConfiguration('szh')
        .update('formatTravail', msg.valeur === 'odt' ? 'odt' : 'docx', Global);
    } else if (msg.cle === 'apercu') {
      // Même réglage szh.apercuMode que la bascule Ctrl+Alt+P et la barre d'état.
      await vscode.workspace.getConfiguration('szh')
        .update('apercuMode', msg.valeur === 'pdf' ? 'pdf' : 'html', Global);
      if (rafraichirTout) { rafraichirTout(); } // la barre d'état « Aperçu : … » suit
    } else if (msg.cle === 'assets') {
      // Les identités d'article changent avec le réglage : l'arbre doit suivre.
      await vscode.workspace.getConfiguration('szh')
        .update('replierAssetsAutres', msg.valeur !== 'non', vscode.ConfigurationTarget.Global);
      if (rafraichirTout) { rafraichirTout(); }
    } else if (msg.cle === 'cmyk') {
      await vscode.workspace.getConfiguration('szh')
        .update('convertirCmyk', msg.valeur !== 'non', Global);
    } else if (msg.cle === 'warnings') {
      // Le verdict recalculé arrive au prochain rendu du gestionnaire des médias.
      await vscode.workspace.getConfiguration('szh')
        .update('reduireWarningsImpression', msg.valeur === 'reduits', Global);
    } else if (msg.cle === 'liensReferences') {
      // Deux écritures : le réglage VSCodium, pour le panneau et la palette ; et
      // config.json, seul fichier que pipeline/filters/szh-citations.lua lit depuis la WSL.
      const desactiver = msg.valeur === 'desactives';
      await vscode.workspace.getConfiguration('szh')
        .update('desactiverLiensReferences', desactiver, Global);
      const erreur = modifierConfigPoste((avant) => configAvecLiensDesactives(avant, desactiver));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
    } else if (msg.cle === 'verifTrad') {
      // Écrit dans config.json, lu par les panneaux des fiches, de la vérification de
      // l'import et de la traduction.
      const erreur = modifierConfigPoste((avant) => configAvecVerifTraduction(avant, msg.valeur === 'actif'));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
    } else if (msg.cle === 'modeTrad') {
      // Même fichier que le vérificateur. Les panneaux ouverts sont prévenus tout de suite.
      const erreur = modifierConfigPoste((avant) => configAvecModeTrad(avant, msg.valeur === 'actif'));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
      else { ctx.diffuserModeTrad(); }
    } else if (msg.cle === 'langue') {
      const langue = msg.valeur === 'de' ? 'de' : 'fr';
      await vscode.workspace.getConfiguration('szh').update('langue', langue, Global);
      // Deux écritures : le réglage VSCodium et config.json, que le cockpit relit si les
      // réglages de l'éditeur ont été remplacés.
      const erreur = modifierConfigPoste((avant) => configAvecLangue(avant, langue));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
      oublierLanguePoste();                      // config.json vient de changer
      ecrireLocaleArgv(langue);                  // langue native : au prochain démarrage
      vscode.window.showInformationMessage(T('info.redemarrer'));
      if (rafraichirTout) { rafraichirTout(); }  // libellés de l'arbre tout de suite
    }
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', ['settings.json', e.message]));
  }
  return true;
}

module.exports = {
  configurer, modifierConfigPoste, traiterMessage, relayerReglagesProteges, reverrouillerProteges,
  messageValeursReglages, telechargerReglagesProteges, telechargerFichierLangue,
  lireReglagesActuels, etatProteges, avertissementLangue, langueEditeur, ecrireLocaleArgv,
  nlsCommandes
};
