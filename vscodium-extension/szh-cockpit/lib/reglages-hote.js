// Les réglages « SZH » de l'onglet Paramètres de l'Accueil : leurs valeurs, leurs écritures, les
// réglages protégés (relais, état, fichier à transmettre) et le fichier de langue de l'interface. Impur (panneau, dialogues, disque) ;
// les rappels vers l'hôte passent par configurer() plus bas, jamais par require('../extension').
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
// Posés une seule fois, à la fin d'extension.js. Les valeurs par défaut ne servent qu'à ne
// pas planter un test qui require ce module seul.
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

// Lecture-modification-écriture de config.json. Illisible n'est pas absent : un fichier
// qu'on n'a pas su lire n'est pas écrasé, sans quoi l'emplacement des revues et la
// configuration OJS partiraient avec. -> null quand c'est écrit ; sinon le message d'erreur,
// qui est le chemin du fichier quand c'est lui qui est illisible.
function modifierConfigPoste(fn) {
  const chemin = cheminConfigPoste();
  if (lireConfigPoste() === null && fs.existsSync(chemin)) { return chemin; }
  return ecrireConfigPoste(fn);
}

// Ce que le panneau doit connaître des tâches : la table effective des deux revues et leur
// nom lisible. Les listes viennent de lib/articles.js — le panneau n'en recopie aucune, et
// le jeu de départ vit là-bas, seul endroit où il existe.
function donneesTaches() {
  return {
    table: tachesConfig(lireConfigPoste()),
    revues: REVUES_TACHES.map((cle) => ({ cle: cle, libelle: T('meta.revue.' + cle) })),
    max: MAX_TACHES
  };
}

// Ce que le panneau doit connaître du titre de la bibliographie : les intitulés effectifs,
// les deux revues et les trois langues, avec leur nom lisible. Les listes viennent de
// lib/citations.js et de lib/yaml.js — le panneau n'en recopie aucune, et les valeurs par
// défaut vivent dans le filtre de composition, seul endroit où elles existent.
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

// L'état de la liste des auteur·e·s publiés, pour le groupe informatif des réglages :
// quand elle a été mise à jour, combien de noms elle porte. Rien ne se règle là — le
// rafraîchissement se fait seul, à l'activation (rafraichirAuteursPubliesEnFond).
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

// Ce que le panneau doit connaître de l'export OJS : la configuration effective, la liste
// des champs par revue avec le libellé et l'endroit où relever la valeur, et les types
// d'article. Les listes viennent de lib/export-ojs.js et de lib/yaml.js — le panneau n'en
// recopie aucune.
function donneesOjs() {
  const langue = langueCockpit();
  const revues = {};
  for (const loc of LOCALES_REVUE) { revues[loc] = T('ojs.revue.' + loc); }
  return {
    config: configOjs(),
    locales: LOCALES_REVUE,
    revues: revues,
    // Les clés des rubriques livrées ne se renomment pas : une clé changée laisserait
    // l'ancienne en place et le type d'article pointerait dans le vide.
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

// La langue d'affichage de VSCodium, réduite aux deux que nous connaissons. '' quand un
// pack de langue n'est pas installé — l'anglais des postes d'ici — auquel cas il n'y a rien
// à comparer : c'est l'état normal d'une rédaction francophone, dont les menus sont en
// anglais et les formulaires en français.
function langueEditeur() {
  const brut = String((vscode.env && vscode.env.language) || '').toLowerCase();
  if (brut.indexOf('de') === 0) { return 'de'; }
  if (brut.indexOf('fr') === 0) { return 'fr'; }
  return '';
}

// Le mot à poser sous le choix de la langue quand les menus de VSCodium et les textes du
// cockpit ne parlent pas la même langue. Deux mécanismes indépendants les décident (voir
// l'en-tête de lib/i18n.js), et rien ne les oblige à s'accorder : un réglage posé à la
// main, une variable d'essai restée dans l'environnement, un choix effacé par une mise à
// jour, et l'écran se retrouve à moitié dans chaque langue. -> '' quand tout va bien.
function avertissementLangue() {
  const cockpit = langueCockpit();
  const editeur = langueEditeur();
  if (editeur === '' || editeur === cockpit) { return ''; }
  return T('regl.langue.discordance', [T('meta.langue.' + cockpit), T('meta.langue.' + editeur)]);
}

// ---- Les réglages protégés : relais, état, et fichier à transmettre --------------
//
// Le fichier déployé par la mise à jour est la référence ; config.json est ce que le poste
// emploie, et le seul que la chaîne de compilation sache lire. Le relais recopie l'un dans
// l'autre — mais SEULEMENT quand la référence a changé, jamais à chaque démarrage : une
// modification faite ici après un déverrouillage doit tenir jusqu'à la prochaine mise à
// jour, et un relais à chaque ouverture l'effacerait le lendemain matin.
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

// L'état des réglages protégés, tel que le formulaire en a besoin : verrouillés ou non, et
// la liste des blocs où ce poste s'écarte de la version déployée. Le déverrouillage ne vit
// que le temps du panneau ouvert — il se redemande à chaque fois, et c'est voulu : c'est un
// geste d'exception, pas un mode dans lequel on s'installe.
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
// déployé, à transmettre à l'administrateur. Offert même verrouillé — lire et transmettre
// ne modifie rien, et c'est justement ce qu'on demande à quelqu'un qui signale un problème.
async function telechargerReglagesProteges() {
  const contenu = proteges.fichierATelecharger(lireConfigPoste(), T('regl.proteges.lisezmoi'));
  let cible;
  try {
    cible = await vscode.window.showSaveDialog({
      saveLabel: T('regl.proteges.telecharger'),
      defaultUri: vscode.Uri.file(path.join(await dossierBureau(), proteges.NOM_FICHIER))
    });
  } catch (e) { cible = null; }
  if (!cible) { return null; }                     // annulé : rien à dire
  try {
    ecrireAtomique(cible.fsPath, contenu);
    return T('regl.proteges.telecharge', [path.basename(cible.fsPath)]);
  } catch (e) {
    return T('err.ecriture', [path.basename(cible.fsPath), String((e && e.message) || e)]);
  }
}

// Les titres de commandes et le tutoriel : ils ne passent pas par lib/i18n.js mais par
// package.nls*.json, que VSCodium résout selon SA langue d'affichage. Ils s'affichent
// pourtant à l'écran, et les laisser hors du fichier de langue laisserait la moitié des
// menus hors de la relecture. Lus à côté de cette extension, jamais ailleurs ; un fichier
// absent ou illisible rend une table vide plutôt que de faire échouer tout l'export.
function nlsCommandes() {
  const paire = {};
  for (const [langue, nom] of [['fr', 'package.nls.json'], ['de', 'package.nls.de.json']]) {
    try {
      const brut = String(fs.readFileSync(path.join(__dirname, nom), 'utf8')).replace(/^﻿/, '');
      const valeurs = JSON.parse(brut);
      paire[langue] = valeurs && typeof valeurs === 'object' ? valeurs : {};
    } catch (e) { paire[langue] = {}; }
  }
  return paire;
}

// « Télécharger le fichier de langue » : tous les libellés de l'interface, français et
// allemand côte à côte, dans un JSON qu'on envoie à qui relit. Les deux phrases de _lire
// passent par TL() et non par T() : le fichier porte les deux langues, quelle que soit
// celle dans laquelle le cockpit s'affiche à cet instant.
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
  if (!cible) { return null; }                     // annulé : rien à dire
  try {
    ecrireAtomique(cible.fsPath, contenu);
  } catch (e) {
    return { erreur: T('regl.exportLangue.echec', [path.basename(cible.fsPath), String((e && e.message) || e)]) };
  }
  // Révélé dans l'Explorateur : le but du fichier est d'être glissé dans un courriel, et
  // un chemin affiché dans un message ne se glisse nulle part.
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
    // Lu dans config.json, comme la langue : c'est le seul exemplaire, il n'y a rien à
    // recouper avec un réglage d'éditeur.
    verifTrad: lireVerifTraduction() ? 'actif' : 'inactif',
    // Même fichier, même lecture : le mode « Trad » vit à côté du vérificateur.
    modeTrad: lireModeTrad() ? 'actif' : 'inactif',
    // Déclaré par l'onglet Préprocessing : tant qu'il ne l'est pas, null masque la ligne.
    formatTravail: lireFormatTravail()
    // Le mode développeur (dossiers de test) ne fait plus partie de cet état : il se lit
    // et s'écrit dans lib/accueil-reglages-hote.js.
  };
}

// Les quatre blocs « Auteur·e·s publiés » (OJS), « Bibliographie », « Tâches par
// article » et « Export OJS » n'ont de sens que pour une revue/Zeitschrift : pas
// d'export OJS pour un livre, donc rien de tout cela à régler. On ne les envoie même
// pas — media/accueil.js (montrer) ne révèle leur <section> que si la donnée arrive, et
// une donnée absente la laisse masquée, titre compris.
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
  // Déverrouiller n'est pas un réglage mais un geste, et il se redemande à chaque
  // ouverture du panneau : c'est une exception, pas un mode dans lequel on s'installe.
  // La question modale est posée ICI et non dans la page : une webview ne peut pas
  // bloquer, et un avertissement qu'on peut ignorer d'un clic à côté n'avertit personne.
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
  // Le fichier de langue de l'interface. Annulé, rien ne se dit : la personne vient de
  // refermer la boîte, elle sait ce qu'elle a fait.
  // Le dossier des suggestions sur les textes de l'outil. Créé s'il n'existe pas : un
  // bouton qui ne fait rien la première fois passerait pour cassé, et un dossier vide dit
  // au moins où elles atterriront.
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
  // Verrouillé, ces deux blocs ne s'écrivent pas. Le formulaire les grise déjà et
  // n'enverrait rien, mais un message qui arriverait quand même — page restée ouverte
  // pendant un reverrouillage, envoi automatique en vol — ne doit pas passer.
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
  // La configuration de l'export OJS va dans config.json, comme le mode développeur :
  // ce sont des réglages de poste, partagés avec les scripts PowerShell.
  if (msg.type === MSG.REGLER_OJS) {
    const erreur = ecrireConfigOjs(msg.ojs || {});
    if (erreur) {
      const message = T('ojs.err.ecriture', [erreur]);
      vscode.window.showErrorMessage(message);
      // Sinon l'auto-enregistrement du panneau (enVol) reste bloqué : plus rien ne
      // s'enregistre jamais après le premier échec.
      repondre({ type: MSG.ERREUR, bloc: 'ojs', message: message });
    } else {
      repondre({ type: MSG.ENREGISTRE, bloc: 'ojs' });
      // Le poste vient peut-être de s'écarter de la version déployée : le bandeau
      // doit le dire tout de suite, pas au prochain rechargement du panneau.
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
      // Le poste vient peut-être de s'écarter de la version déployée : le bandeau
      // doit le dire tout de suite, pas au prochain rechargement du panneau.
      repondre(Object.assign({ type: MSG.PROTEGES }, etatProteges()));
    }
    return true;
  }
  // Les tâches éditoriales, dans le même config.json. Écrites revue par revue —
  // configAvecTaches n'en touche qu'une à la fois, et c'est ce qui garantit qu'une revue
  // absente du message ne soit pas effacée. L'arbre et la vue « Articles » portent ces
  // intitulés : ils se refont, sans quoi les cases cocheraient des noms d'avant.
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
    // Les identifiants viennent d'être dérivés pour les tâches neuves : la page doit les
    // recevoir, sinon la rangée suivante en fabriquerait un second sur le même intitulé.
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
      // Deux écritures : le réglage VSCodium, pour le panneau et la palette de commandes ;
      // et config.json, seul fichier que pipeline/filters/szh-citations.lua peut lire
      // depuis WSL — même relais que le titre de la bibliographie, juste en dessous.
      const desactiver = msg.valeur === 'desactives';
      await vscode.workspace.getConfiguration('szh')
        .update('desactiverLiensReferences', desactiver, Global);
      const erreur = modifierConfigPoste((avant) => configAvecLiensDesactives(avant, desactiver));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
    } else if (msg.cle === 'verifTrad') {
      // Une seule écriture, et pas dans les réglages de l'éditeur : trois panneaux
      // lisent ce mode — fiches, vérification de l'import, traduction — et la mise à
      // jour du poste réécrit en entier les réglages de VSCodium, si bien que le mode
      // s'y éteindrait à chaque mise à jour. Même raison, et même fichier, que la langue
      // juste en dessous.
      const erreur = modifierConfigPoste((avant) => configAvecVerifTraduction(avant, msg.valeur === 'actif'));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
    } else if (msg.cle === 'modeTrad') {
      // Même fichier et même précaution que le vérificateur juste au-dessus. Les panneaux
      // ouverts sont prévenus tout de suite : sans cela, allumer le mode ne se verrait
      // qu'à la réouverture de chacun, et l'éteindre laisserait les autres bloqués.
      const erreur = modifierConfigPoste((avant) => configAvecModeTrad(avant, msg.valeur === 'actif'));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
      else { ctx.diffuserModeTrad(); }
    } else if (msg.cle === 'langue') {
      const langue = msg.valeur === 'de' ? 'de' : 'fr';
      await vscode.workspace.getConfiguration('szh').update('langue', langue, Global);
      // Deux écritures, comme pour les liens des références juste au-dessus — et pour une
      // raison de plus : la mise à jour du poste réécrit entièrement les réglages de
      // l'éditeur, et le choix de la langue partait avec eux. Le second exemplaire vit
      // hors de leur portée, et c'est lui que le cockpit relit sur un poste remis à jour.
      const erreur = modifierConfigPoste((avant) => configAvecLangue(avant, langue));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(cheminConfigPoste()), erreur])); }
      oublierLanguePoste();                      // le fichier vient de changer sous nous
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
