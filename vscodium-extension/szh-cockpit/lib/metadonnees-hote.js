// Formulaires de métadonnées : le numéro (ausgabe.yaml), le livre (buch.yaml), et les
// fiches de tous les articles (meta.yaml). Trois formulaires, un seul moteur de carte
// d'auteur·e et de photo. Impur (webviews, disque) ; les rappels vers l'hôte passent par
// configurer() plus bas, jamais par require('../extension').
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { refuserSiVerrouille, poidsLisible } = require('./cycle-vie');
const { fermerTousLesApercus } = require('./apercu');
const { slugifier } = require('./slug');
const { traiterPortraits } = require('./portraits');
const { alignerMotsCles } = require('./traduction');
const {
  lireCache: lireCacheAuteursPublies, rafraichir: rafraichirCacheAuteursPublies
} = require('./auteurs-ojs');
const { lireCacheMotsCles, rafraichirMotsCles } = require('./mots-cles-edudoc');
const {
  CLES_METADONNEES, COULEURS_NUMERO, HEX_COULEURS, normaliserRevue, estVraiYaml,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, ecrireAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, langueDefaut, normaliserLangueArticle,
  LICENCE_DEFAUT, LICENCES_ARTICLE, normaliserLicence, etatRevue
} = require('./yaml');
const {
  NOMS_COUVERTURE, EXTENSIONS_COUVERTURE, nomCouverture, MAX_COUVERTURE, rangDoi
} = require('./articles');
const { doiCalcule } = require('./export-ojs');
const {
  EXTENSIONS_IMAGE_IMPORT, TAILLE_MAX_IMAGE_IMPORT,
  assainirCheminPhoto, decomposerPhoto, baseAuteurValide,
  dataUriImage, trouverOriginal, versionsPhoto
} = require('./medias');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois, à la fin d'extension.js. Les valeurs par défaut ne servent qu'à ne
// pas planter un test qui require ce module seul. Tous relèvent de la co-édition (le bail
// par fichier vit chez l'hôte, partagé entre tous les panneaux) ou d'un geste que ce
// module ne connaît pas (relancer une compilation, focaliser l'arbre).
let ctx = {
  ecrireClesAusgabe: () => 'lib/metadonnees-hote.js non configuré',
  mainCoedition: () => null,
  ecrireSousMain: (panneau, racine, chemin, ecrire) => {
    const erreur = ecrire();
    return erreur ? { code: 'echec', message: erreur } : null;
  },
  annoncerMain: () => null,
  noterLectureCoedition: () => {},
  rafraichirEmpreinteCoedition: () => {},
  libererCoedition: () => {},
  lireCouleurAccent: () => '',
  permuterStatutsTraduction: () => {},
  relancerCompilation: () => {},
  focaliserUnite: () => {},
  slugDepuisChemin: () => null,
  articlesSansDoi: () => new Set()
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le profil du dossier ouvert, comme dans extension.js : ce module n'a pas à le recevoir en
// rappel, lib/profil.js et lib/session.js suffisent (même choix que lib/medias-hote.js).
function profilCourant() { return session.profilOuvrage() || profils.profilPour('revue'); }
function dossierUnites() { return profilCourant().unites.dossier; }
function cleOrdre() { return profilCourant().unites.ordre; }
function cheminConfig(racine) { return path.join(racine, profilCourant().config); }

// postMessage tolérant : le panneau peut être fermé pendant le traitement.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

function cheminMeta(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.meta.yaml');
}

// ---- Couverture du numéro ---------------------------------------------------------
// couverture.jpg à la racine du numéro, sous l'un des noms de NOMS_COUVERTURE.

function couvertureNumero(racine) {
  for (const nom of NOMS_COUVERTURE) {
    const chemin = path.join(racine, nom);
    try {
      const st = fs.statSync(chemin);
      if (st.isFile()) { return { nom: nom, chemin: chemin, taille: st.size }; }
    } catch (e) { /* nom suivant */ }
  }
  return null;
}

// L'aperçu voyage en data: dans le postMessage : c'est la seule voie, la webview n'ayant
// aucune racine locale autorisée (localResourceRoots: []). Au-delà de ce poids, on montre
// le nom et le poids sans l'image plutôt que de faire passer huit mégaoctets de base64.
const MAX_APERCU_COUVERTURE = 6 * 1024 * 1024;

function chargeCouverture(racine) {
  const trouvee = couvertureNumero(racine);
  if (!trouvee) { return { nom: '', description: '', apercu: null }; }
  let apercu = null;
  if (trouvee.taille <= MAX_APERCU_COUVERTURE) {
    try {
      const mime = /\.png$/i.test(trouvee.nom) ? 'image/png' : 'image/jpeg';
      apercu = 'data:' + mime + ';base64,' + fs.readFileSync(trouvee.chemin).toString('base64');
    } catch (e) { apercu = null; }
  }
  return { nom: trouvee.nom, description: poidsLisible(trouvee.taille), apercu: apercu };
}

// -> null, ou le message de l'échec. Format et poids sont revérifiés ici : ce qui vient
// d'une webview n'est jamais cru sur parole.
function ecrireCouverture(racine, nomFichier, donneesBase64) {
  const nom = nomCouverture(nomFichier);
  if (nom === '') { return T('art.couverture.format'); }
  let donnees;
  try { donnees = Buffer.from(String(donneesBase64 || ''), 'base64'); }
  catch (e) { return T('art.couverture.format'); }
  if (donnees.length === 0) { return T('art.couverture.format'); }
  if (donnees.length > MAX_COUVERTURE) { return T('art.couverture.poids'); }
  const cible = path.join(racine, nom);
  try {
    const tmp = path.join(racine, '~$' + nom);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
  } catch (e) { return T('err.ecriture', [String((e && e.message) || e)]); }
  // Une seule couverture par numéro : les autres noms que l'export essaie sont retirés,
  // sans quoi il prendrait le premier de sa liste et non celui qu'on vient de déposer.
  for (const autre of NOMS_COUVERTURE) {
    if (autre === nom) { continue; }
    try {
      const c = path.join(racine, autre);
      if (fs.existsSync(c)) { fs.unlinkSync(c); }
    } catch (e) { /* verrouillé : le nom affiché dira lequel l'export voit */ }
  }
  return null;
}

// ---- Formulaire du numéro : une seule charge utile, une seule écriture ----------
//
// La page « Méta-données du numéro » et la vue « Articles » montrent le même formulaire
// (SZH.formulaireNumero, media/_numero.js). Elles lisent et écrivent donc par ici, et non
// chacune de son côté.
const LIBELLES_NUMERO = ['meta.title', 'meta.revue', 'meta.revue.zeitschrift', 'meta.revue.revue',
  'meta.volume', 'meta.numero', 'meta.date', 'meta.langue', 'meta.langue.aucune',
  'meta.langue.fr', 'meta.langue.de', 'meta.langue.en', 'meta.langue.it',
  'meta.couleur', 'meta.entete.condensee'];

function textesNumero() {
  const libelles = {};
  for (const cle of LIBELLES_NUMERO) { libelles[cle] = T(cle); }
  return {
    libelles: libelles,
    indiceDate: T('meta.date.indice'),
    rien: T('form.rien'),
    enregistre: T('form.enregistre'),
    couleurAucune: T('meta.couleur.aucune'),
    couleurs: COULEURS_NUMERO.map((c) => ({ hex: c.hex, nom: T('meta.couleur.' + c.cle) })),
    couverture: T('art.couverture'),
    couvertureAbsente: T('art.couverture.absente'),
    couvertureDeposer: T('art.couverture.deposer'),
    couvertureChoisir: T('art.couverture.choisir'),
    couvertureFormat: T('art.couverture.format'),
    couverturePoids: T('art.couverture.poids'),
    couvertureAgrandir: T('art.couverture.agrandir'),
    couvertureApercuAbsent: T('art.couverture.apercu.absent'),
    couvertureFermer: T('art.couverture.fermer'),
    couvertureEnregistree: T('art.couverture.enregistree'),
    // Formats et poids acceptés : ceux de lib/articles.js, et non une seconde liste écrite
    // dans la webview. Elle s'en sert pour refuser tout de suite ; l'hôte les revérifie.
    couvertureExtensions: Object.keys(EXTENSIONS_COUVERTURE),
    couvertureMax: MAX_COUVERTURE
  };
}

// `avecCouverture` : l'aperçu de la couverture pèse plusieurs mégaoctets en base64. Il
// part au premier chargement, et non à chaque re-rendu d'une vue.
function chargeNumero(racine, avecCouverture) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* fichier illisible : formulaire vide */ }
  valeurs['entete-condensee'] = estVraiYaml(valeurs['entete-condensee']) ? 'true' : 'false';
  const charge = { valeurs: valeurs };
  if (avecCouverture) { charge.couverture = chargeCouverture(racine); }
  return charge;
}

// Seuls les champs modifiés arrivent : une valeur que le formulaire n'a pas su afficher
// n'est pas écrasée. -> null, ou le message de l'échec ; null aussi quand il n'y avait rien
// de recevable à écrire.
function ecrireChampsNumero(racine, brut) {
  const modifies = {};
  for (const cle of CLES_METADONNEES) {
    if (brut && typeof brut[cle] === 'string') {
      modifies[cle] = brut[cle].replace(/[\r\n]+/g, ' ').slice(0, 500).trim();
    }
  }
  // Vide (« aucune ») ou un hex de la palette ; toute autre valeur est ignorée.
  if ('couleur' in modifies) {
    const c = modifies.couleur.toUpperCase();
    if (c !== '' && HEX_COULEURS.indexOf(c) === -1) { delete modifies.couleur; }
    else { modifies.couleur = c; }
  }
  // Seul le jeton canonique zeitschrift/revue est accepté.
  if ('revue' in modifies) {
    const r = normaliserRevue(modifies.revue);
    if (r === '') { delete modifies.revue; } else { modifies.revue = r; }
  }
  // La case à cocher n'envoie que « true » ou « false » ; le reste est ignoré.
  if ('entete-condensee' in modifies) {
    const e = modifies['entete-condensee'].toLowerCase();
    if (e !== 'true' && e !== 'false') { delete modifies['entete-condensee']; }
    else { modifies['entete-condensee'] = e; }
  }
  // L'ordre des articles ne se saisit pas au clavier : il ne passe pas par ce formulaire.
  delete modifies[cleOrdre()];
  if (Object.keys(modifies).length === 0) { return null; }
  return ctx.ecrireClesAusgabe(racine, modifies);
}

// Les messages du formulaire du numéro, traités à l'identique dans les deux panneaux qui le
// portent. -> true quand le message a été traité.
//
// `recharger` remet le formulaire à ce que le disque dit ; il ne sert qu'au refus « périmé »
// de la co-édition.
function messageNumero(panneau, racine, msg, rafraichirTout, recharger) {
  if (msg.type === MSG.ENREGISTRER) {
    if (session.etatNumero().verrouillee) {
      repondrePanneau(panneau, { type: 'erreur', message: T('verrou.refuse') });
      return true;
    }
    const refus = ctx.ecrireSousMain(panneau, racine, cheminConfig(racine),
      () => ecrireChampsNumero(racine, msg.modifies));
    if (refus) {
      repondrePanneau(panneau, { type: 'erreur', message: refus.message });
      if (refus.code === 'perime' && recharger) { recharger(); }
      return true;
    }
    repondrePanneau(panneau, { type: 'enregistre' });
    vscode.window.setStatusBarMessage(T('statut.ausgabe'), 3000);
    if (rafraichirTout) { rafraichirTout(); }
    return true;
  }
  if (msg.type === MSG.COUVERTURE_DEPOSER) {
    if (refuserSiVerrouille()) { return true; }
    const erreur = ecrireCouverture(racine, String(msg.nomFichier || ''), msg.donneesBase64);
    if (erreur) {
      repondrePanneau(panneau, { type: 'erreur', message: erreur });
      return true;
    }
    repondrePanneau(panneau, Object.assign({ type: 'couverture' }, chargeCouverture(racine)));
    vscode.window.setStatusBarMessage(T('art.couverture.enregistree'), 3000);
    return true;
  }
  return false;
}

function htmlMetadonnees(nonce) {
  return construireHtml('metadata-issue', nonce, {
    cssPartage: ['_design.css', '_numero.css'], jsPartage: ['_messages.js', '_numero.js'],
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'",
    titre: T('meta.titre'), remplacements: { '__TXT__': JSON.stringify(textesNumero()) }
  });
}

let panneauMetadonnees = null;

function envoyerValeursMetadonnees(panneau, racine) {
  repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, chargeNumero(racine, true)));
  ctx.noterLectureCoedition(panneau, racine, cheminConfig(racine));
}

// ---- Formulaire « Métadonnées du livre » -----------------------------------------
//
// Le pendant du bloc ci-dessus, pour buch.yaml. Même schéma — un fragment partagé
// (SZH.formulaireLivre, media/_numero.js), une charge et une écriture uniques — mais un
// second jeu de fonctions : la validation d'un livre n'est pas celle d'un numéro.
//
// Les six dernières clés sont celles du bloc `impression:` de buch.yaml — grammage, main,
// dos imposé, fond perdu, traits de coupe, profil CMJN.
const LIBELLES_LIVRE = ['meta.livre.titre', 'meta.livre.soustitre', 'meta.livre.ouvrage',
  'meta.livre.ouvrage.monographie', 'meta.livre.ouvrage.collectif', 'meta.livre.langue',
  'meta.langue.fr', 'meta.langue.de', 'meta.langue.it', 'meta.langue.en',
  'meta.livre.maquette', 'meta.livre.maquette.normal', 'meta.livre.maquette.falc',
  'meta.livre.format', 'meta.livre.format.standard', 'meta.livre.format.a4',
  'meta.livre.collection', 'meta.livre.tome', 'meta.livre.annee',
  'meta.livre.isbnPrint', 'meta.livre.isbnEbook', 'meta.livre.doi',
  'meta.livre.licence', 'meta.livre.couleur',
  'meta.livre.grammage', 'meta.livre.main', 'meta.livre.dosMm', 'meta.livre.fondPerduMm',
  'meta.livre.traitsDeCoupe', 'meta.livre.profilCmjn'];

// Les jetons fermés du formulaire — refusés ici ET par le <select>/<input radio> côté
// webview.
const OUVRAGES_VALIDES = ['monographie', 'collectif'];
const MAQUETTES_LIVRE_VALIDES = ['normal', 'falc'];
const FORMATS_LIVRE_VALIDES = ['standard', 'a4'];

function textesLivre() {
  const libelles = {};
  for (const cle of LIBELLES_LIVRE) { libelles[cle] = T(cle); }
  // Le reste (rien, enregistre, couleurs, couvertureExtensions/Max, couverture*) vient de
  // textesNumero() : ce formulaire réutilise le même moteur (_numero.js).
  return Object.assign({}, textesNumero(), {
    libelles: libelles,
    licences: [{ valeur: '', libelle: T('meta.livre.licence.aucune') }].concat(licencesTraduites())
  });
}

function htmlMetadonneesLivre(nonce) {
  return construireHtml('metadata-book', nonce, {
    cssPartage: ['_design.css', '_numero.css'], jsPartage: ['_messages.js', '_numero.js'],
    titre: T('meta.livre.panneau'), remplacements: { '__TXT__': JSON.stringify(textesLivre()) }
  });
}

// `avecCouverture` n'existe pas ici : buch.yaml n'a pas de couverture-image.
function chargeLivre(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8')); }
  catch (e) { /* fichier illisible : formulaire vide */ }
  for (const cle of CLES_METADONNEES) { if (valeurs[cle] === undefined) { valeurs[cle] = ''; } }
  valeurs['impression.traits-de-coupe'] = estVraiYaml(valeurs['impression.traits-de-coupe']) ? 'true' : 'false';
  return { valeurs: valeurs };
}

// -> null, ou le message de l'échec. Miroir d'ecrireChampsNumero, avec sa propre
// validation : une couleur de livre est libre, et ouvrage/maquette/format sont des jetons
// fermés que ce formulaire est seul à poser.
function ecrireChampsLivre(racine, brut) {
  const modifies = {};
  for (const cle of CLES_METADONNEES) {
    if (brut && typeof brut[cle] === 'string') {
      modifies[cle] = brut[cle].replace(/[\r\n]+/g, ' ').slice(0, 500).trim();
    }
  }
  if ('ouvrage' in modifies && OUVRAGES_VALIDES.indexOf(modifies.ouvrage) === -1) { delete modifies.ouvrage; }
  if ('maquette' in modifies && MAQUETTES_LIVRE_VALIDES.indexOf(modifies.maquette) === -1) { delete modifies.maquette; }
  if ('format' in modifies && FORMATS_LIVRE_VALIDES.indexOf(modifies.format) === -1) { delete modifies.format; }
  if ('licence' in modifies && modifies.licence !== '' && normaliserLicence(modifies.licence) === '') {
    delete modifies.licence;
  }
  if ('couleur' in modifies) {
    const c = modifies.couleur.toUpperCase();
    if (c !== '' && !/^#[0-9A-F]{6}$/.test(c)) { delete modifies.couleur; } else { modifies.couleur = c; }
  }
  if ('impression.traits-de-coupe' in modifies) {
    const t = modifies['impression.traits-de-coupe'].toLowerCase();
    if (t !== 'true' && t !== 'false') { delete modifies['impression.traits-de-coupe']; }
    else { modifies['impression.traits-de-coupe'] = t; }
  }
  delete modifies[cleOrdre()];
  if (Object.keys(modifies).length === 0) { return null; }
  return ctx.ecrireClesAusgabe(racine, modifies);
}

// Miroir de messageNumero, sans la couverture-image.
function messageLivre(panneau, racine, msg, rafraichirTout, recharger) {
  if (msg.type === MSG.ENREGISTRER) {
    if (session.etatNumero().verrouillee) {
      repondrePanneau(panneau, { type: 'erreur', message: T('verrou.refuse') });
      return true;
    }
    const refus = ctx.ecrireSousMain(panneau, racine, cheminConfig(racine),
      () => ecrireChampsLivre(racine, msg.modifies));
    if (refus) {
      repondrePanneau(panneau, { type: 'erreur', message: refus.message });
      if (refus.code === 'perime' && recharger) { recharger(); }
      return true;
    }
    repondrePanneau(panneau, { type: 'enregistre' });
    vscode.window.setStatusBarMessage(T('statut.ausgabe'), 3000);
    if (rafraichirTout) { rafraichirTout(); }
    return true;
  }
  return false;
}

// Panneau singleton : rouvrir la commande révèle le formulaire existant, valeurs relues du
// disque. Un seul panneau pour les deux profils, deux formulaires distincts derrière.
async function ouvrirMetadonnees(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  await fermerTousLesApercus();
  const estLivre = profilCourant().cle === 'livre';
  const titre = estLivre ? T('meta.livre.panneau') : T('meta.titre');
  const envoyerValeurs = (panneau) => {
    if (estLivre) { repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, chargeLivre(racine))); }
    else { repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, chargeNumero(racine, true))); }
    ctx.noterLectureCoedition(panneau, racine, cheminConfig(racine));
  };
  if (panneauMetadonnees) {
    panneauMetadonnees.reveal(vscode.ViewColumn.One);
    envoyerValeurs(panneauMetadonnees);
    ctx.annoncerMain(panneauMetadonnees, racine, cheminConfig(racine));
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhMetadonnees', titre, vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
  );
  panneauMetadonnees = panneau;
  panneau.onDidDispose(() => {
    ctx.libererCoedition(panneau);
    if (panneauMetadonnees === panneau) { panneauMetadonnees = null; }
  });
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) {
      envoyerValeurs(panneau);
      ctx.annoncerMain(panneau, racine, cheminConfig(racine));
      return;
    }
    const traite = estLivre
      ? messageLivre(panneau, racine, msg, rafraichirTout, () => envoyerValeurs(panneau))
      : messageNumero(panneau, racine, msg, rafraichirTout, () => envoyerValeurs(panneau));
    if (!traite) { console.warn('métadonnées : type de message inconnu', msg.type); }
  });
  panneau.webview.html = estLivre
    ? htmlMetadonneesLivre(crypto.randomBytes(16).toString('hex'))
    : htmlMetadonnees(crypto.randomBytes(16).toString('hex'));
}

// ---- Éditeur des métadonnées de tous les articles --------------------------------
// Une carte par article : type, doi, title/subtitle/keywords traduisibles, auteurs.
// Gabarit partagé avec le dialogue d'import (extension.js).
function textesCarteArticle() {
  return Object.assign({
    type: T('fiches.type'), typeAucun: T('fiches.type.aucun'),
    langueArticle: T('fiches.langue.article'),
    langueFr: T('meta.langue.fr'), langueDe: T('meta.langue.de'), langueIt: T('meta.langue.it'),
    licence: T('fiches.licence'),
    titreChamp: T('fiches.titre.champ'), sousTitre: T('fiches.soustitre'),
    resume: T('fiches.resume'),
    resumeCompteur: T('fiches.resume.compteur'),
    auteurs: T('fiches.auteurs'),
    motsCles: T('fiches.motscles'),
    ajoutFr: T('fiches.ajout.fr'), ajoutDe: T('fiches.ajout.de'), ajoutIt: T('fiches.ajout.it'),
    motsClesTitre: T('fiches.motscles.titre'),
    motCleAjouter: T('fiches.motcle.ajouter'), motCleRetirer: T('fiches.motcle.retirer'),
    motCleATraduire: T('mc.aTraduire'),
    motsClesSuggestions: T('fiches.motscles.suggestions'),
    rien: T('form.rien'), enregistre: T('fiches.enregistre'),
    tradAfficher: T('fiches.trad.afficher'), tradMasquer: T('fiches.trad.masquer'),
    langueAvenir: T('fiches.langue.avenir'),
    doiVerrouTip: T('fiches.doi.tip'), doiManuel: T('fiches.doi.manuel')
  }, textesAuteur());
}

// La fiche d'auteur·e et sa modale (media/_auteurs.js) servent à plusieurs vues : leurs
// libellés vivent dans une seule table, ajoutée à chacune.
function textesAuteur() {
  return {
    aPrenom: T('fiches.auteur.prenom'), aNom: T('fiches.auteur.nom'),
    aFonction: T('fiches.auteur.fonction'), aAffiliation: T('fiches.auteur.affiliation'),
    aRor: T('fiches.auteur.ror'),
    aOrcid: T('fiches.auteur.orcid'), aEmail: T('fiches.auteur.email'),
    retirerAuteur: T('fiches.auteur.retirer'), ajouterAuteur: T('fiches.auteur.ajouter'),
    auteurEditer: T('auteur.editer'), auteurTitre: T('auteur.titre'),
    auteurSuggestions: T('auteur.suggestions'),
    auteurSansNom: T('auteur.sansnom'), auteurSansPhoto: T('auteur.sansphoto'),
    auteurPhoto: T('auteur.photo'), auteurNomRequis: T('auteur.nomrequis'),
    auteurPhotoCachee: T('auteur.photo.cachee'), auteurAgrandir: T('auteur.agrandir'),
    enregistrerBouton: T('form.enregistrer'), annuler: T('photo.annuler'),
    photoNomRequis: T('photo.nomrequis'),
    photoDeposer: T('photo.deposer'), photoOu: T('photo.ou'),
    photoChoisirFichier: T('photo.choisirFichier'),
    vOriginal: T('photo.version.original'), vAvecFond: T('photo.version.avecfond'),
    vSansFond: T('photo.version.sansfond'),
    chargement: T('photo.chargement'), traitement: T('photo.traitement'),
    sansVisage: T('photo.sansvisage'), recadre: T('photo.recadre'),
    photoErrTropVolumineux: T('photo.err.tropvolumineux'), photoErrFormat: T('photo.err.format')
  };
}

// Le choix de licence de la carte, dans la langue de l'interface.
function licencesTraduites() {
  return LICENCES_ARTICLE.map((l) => ({ valeur: l.cle, libelle: T('licence.' + l.cle) }));
}

// Deux groupes, dans la langue par défaut du numéro.
function typesTraduits(langue) {
  const options = (liste, groupe) => liste.map((t) => ({
    valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t,
    groupe: (GROUPES_TYPES[groupe] || {})[langue] || (GROUPES_TYPES[groupe] || {}).fr || ''
  }));
  return options(TYPES_DOSSIER, 'dossier').concat(options(TYPES_HORS, 'hors'));
}

// Écrit les cartes reçues d'une webview de fiches : nettoyage, restitution des clés
// inconnues, écriture atomique. `slugsAutorises` restreint à la liste du panneau.
// `panneau` sert au bail de co-édition : il se prend fiche par fiche, et seulement sur
// celles qui changent.
function ecrireCartesArticles(fournisseur, cartes, slugsAutorises, panneau) {
  const connus = new Set(fournisseur.listerArticles());
  const langueNumero = langueRevue(fournisseur.racine);
  let n = 0;
  const erreurs = [];
  const refus = [];
  const ecrits = [];
  let recharger = false;
  for (const slug of Object.keys(cartes || {})) {
    if (!connus.has(slug)) { continue; }
    if (slugsAutorises && slugsAutorises.indexOf(slug) === -1) { continue; }
    const fichierMeta = cheminMeta(fournisseur.racine, slug);
    const barre = ctx.mainCoedition(panneau, fournisseur.racine, fichierMeta, { ecriture: true });
    if (barre) {
      refus.push(barre.code === 'pris'
        ? T('coedition.fiche.prise', [slug, barre.titulaire])
        : barre.message);
      if (barre.code === 'perime') { recharger = true; }
      continue;
    }
    try {
      const carte = nettoyerCarte(cartes[slug]);
      let langAvant = null;
      try {
        const ancien = analyserMeta(fs.readFileSync(fichierMeta, 'utf8'));
        carte._inconnues = ancien._inconnues;
        if (carte.source === '') { carte.source = ancien.source; }
        langAvant = ancien.lang || langueNumero;
      } catch (e) { /* pas de fiche existante */ }
      ecrireAtomique(fichierMeta, serialiserMeta(carte));
      ctx.rafraichirEmpreinteCoedition(fournisseur.racine, fichierMeta);
      n++;
      ecrits.push(slug);
      // La langue a changé : les statuts du suivi de traduction suivent leurs contenus.
      if (langAvant && carte.lang && carte.lang !== langAvant) {
        try { ctx.permuterStatutsTraduction(fournisseur.racine, slug, langAvant, carte.lang); }
        catch (e) { vscode.window.showWarningMessage(T('fiches.statuts.echec', [slug])); }
      }
    } catch (e) {
      erreurs.push(slug + ' (' + e.message + ')');
    }
  }
  return { n: n, erreurs: erreurs, refus: refus, recharger: recharger, ecrits: ecrits };
}

// Le message à afficher après ecrireCartesArticles, ou null quand tout est passé.
function messageCartes(res) {
  const morceaux = (res.refus || []).slice();
  if (res.erreurs.length > 0) { morceaux.push(T('err.ecriture', [res.erreurs.join(', ')])); }
  return morceaux.length > 0 ? morceaux.join(' ') : null;
}

// L'enregistrement des métadonnées relance la compilation de chaque article écrit, en
// tâche de fond.
function relancerCompilationCartes(fournisseur, res) {
  for (const slug of (res && res.ecrits) || []) {
    ctx.relancerCompilation(fournisseur, slug, { sansAffichage: true });
  }
}

function htmlApercuMetadonnees(nonce) {
  const txt = JSON.stringify(Object.assign(textesCarteArticle(), {
    filtreNote: T('fiches.filtre.note'), tous: T('fiches.tous')
  }));
  return construireHtml('metadata-articles', nonce, {
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
    titre: T('fiches.titre'),
    remplacements: { '__TXT__': txt },
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

let panneauArticles = null;

// Migration idempotente : les métadonnées encore en frontmatter partent vers
// <slug>.meta.yaml, sous la langue de la revue.
function migrerFrontmatterVersMeta(racine, slug) {
  const fichierMeta = cheminMeta(racine, slug);
  if (fs.existsSync(fichierMeta)) { return; }
  const fichierMd = path.join(racine, dossierUnites(), slug, slug + '.md');
  let texte;
  try { texte = fs.readFileSync(fichierMd, 'utf8'); } catch (e) { return; }
  const partie = separerFrontmatter(texte);
  if (partie.fm === null) { return; }
  const ancien = analyserFrontmatter(partie.fm);
  const aDesCles = ancien.title !== undefined || ancien.subtitle !== undefined ||
    ancien.doi !== undefined || (ancien.author || []).length > 0 || (ancien.keywords || []).length > 0;
  if (!aDesCles) { return; }
  const langue = langueRevue(racine);
  const valeurs = { type: '', lang: langue, doi: String(ancien.doi || ''), title: {}, subtitle: {}, keywords: {}, author: [] };
  if (ancien.title) { valeurs.title[langue] = String(ancien.title); }
  if (ancien.subtitle) { valeurs.subtitle[langue] = String(ancien.subtitle); }
  if ((ancien.keywords || []).length > 0) { valeurs.keywords[langue] = ancien.keywords.map(String); }
  for (const a of (ancien.author || [])) {
    valeurs.author.push({ prenom: '', nom: String(a.name || ''), fonction: '', affiliation: String(a.affiliation || ''), orcid: String(a.orcid || '') });
  }
  try {
    ecrireAtomique(fichierMeta, serialiserMeta(valeurs));
    ecrireAtomique(fichierMd, serialiserFrontmatter(texte, { title: '', subtitle: '', doi: '', author: [], keywords: [] }));
  } catch (e) { /* migration au mieux : la carte restera vide */ }
}

// Année du numéro : celle de la date de publication si elle y est, sinon celle du nom du
// dossier (« 2027-03 »).
function anneeNumero(racine, valeurs) {
  const annee = (String((valeurs || {}).date || '').match(/\d{4}/) || [''])[0];
  if (annee !== '') { return annee; }
  return (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
}

// Le DOI calculé de chaque article, pour les formulaires de fiches : locale, année, numéro
// et rang parmi les porteurs. Rendu slug -> DOI, '' quand il est incalculable ou que
// l'article n'en reçoit pas.
function doisCalculesArticles(fournisseur) {
  const racine = fournisseur.racine;
  const slugs = fournisseur.listerArticles();
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : DOI incalculable, et le champ le dira par « — » */ }
  const locale = langueDefaut(valeurs);
  const annee = anneeNumero(racine, valeurs);
  const numeroRevue = String(valeurs.numero || '').trim();
  const sansDoi = ctx.articlesSansDoi(racine, slugs);
  const dois = {};
  for (const slug of slugs) {
    dois[slug] = doiCalcule(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi));
  }
  return dois;
}

// Le fichier dérivé des DOI calculés, écrit à côté d'ausgabe.yaml.
const NOM_DOIS_CALCULES = 'dois-calcules.yaml';
function ecrireDoisCalcules(fournisseur) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (etatRevue(racine).archivee) { return; }
  const dois = doisCalculesArticles(fournisseur);
  const lignes = [
    '# Fichier DÉRIVÉ, écrit par le cockpit : les DOI calculés d\'après la place de',
    '# chaque article dans le numéro. Ne pas éditer — il serait réécrit tel quel au',
    '# prochain rafraîchissement. pipeline/filters/szh-maquette.lua le lit pour poser',
    '# le bandeau DOI de la couverture quand la fiche ne porte pas de DOI manuel.'
  ];
  for (const slug of Object.keys(dois)) {
    if (dois[slug] !== '') { lignes.push(slug + ': ' + dois[slug]); }
  }
  const contenu = lignes.join('\n') + '\n';
  const chemin = path.join(racine, NOM_DOIS_CALCULES);
  try {
    let ancien = null;
    try { ancien = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* pas encore écrit */ }
    if (ancien === contenu) { return; }
    ecrireAtomique(chemin, contenu);
  } catch (e) { /* au mieux : le bandeau DOI se rattrapera au prochain rafraîchissement */ }
}

// `filtre` : slugs à afficher, ou null pour tous. L'ordre reste celui de l'arbre.
function lireMetadonneesArticles(fournisseur, filtre) {
  const articles = [];
  const budget = { reste: BUDGET_VIGNETTES };
  const dois = doisCalculesArticles(fournisseur);
  for (const slug of fournisseur.listerArticles()) {
    if (filtre && filtre.indexOf(slug) === -1) { continue; }
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = analyserMeta('');
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide */ }
    delete valeurs._inconnues;
    articles.push({
      slug: slug, valeurs: valeurs, doiCalcule: dois[slug] || '',
      apercusAuteurs: (valeurs.author || [])
        .map((a) => vignetteAuteur(fournisseur.racine, slug, a.photo, budget))
    });
  }
  return articles;
}

function nettoyerCarte(brut) {
  const texteCourt = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, max).trim();
  const carte = { type: '', lang: '', source: '', licence: '', doi: texteCourt(brut && brut.doi, 200), title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
  const type = texteCourt(brut && brut.type, 40);
  if (TYPES_ARTICLE.indexOf(type) !== -1) { carte.type = type; }
  carte.lang = normaliserLangueArticle(brut && brut.lang);
  carte.source = texteCourt(brut && brut.source, 300);
  carte.licence = normaliserLicence(brut && brut.licence);
  for (const cle of ['title', 'subtitle', 'resume']) {
    const map = (brut && brut[cle]) || {};
    const max = cle === 'resume' ? 2000 : 500;
    for (const l of LANGUES_META) {
      const t = texteCourt(map[l], max);
      if (t !== '') { carte[cle][l] = t; }
    }
  }
  const km = (brut && brut.keywords) || {};
  const brutes = {};
  let nMax = 0;
  for (const l of LANGUES_META) {
    if (!Array.isArray(km[l])) { continue; }
    brutes[l] = km[l].slice(0, 50).map((k) => texteCourt(k, 100));
    if (brutes[l].length > nMax) { nMax = brutes[l].length; }
  }
  for (const l of Object.keys(brutes)) {
    const liste = alignerMotsCles(brutes[l], nMax);
    if (liste.length > 0) { carte.keywords[l] = liste; }
  }
  if (brut && Array.isArray(brut.author)) {
    for (const a of brut.author.slice(0, 20)) {
      const propre = {};
      for (const c of CHAMPS_AUTEUR) { propre[c] = texteCourt(a && a[c], c === 'email' ? 200 : 300); }
      propre.photo = assainirCheminPhoto(propre.photo);
      carte.author.push(propre);
    }
  }
  return carte;
}

// ---- Auteur·e·s et photos : les cartes des fiches --------------------------------
// SZH.LIMITES (media/_commun.js) au chargement des webviews médias, documentation,
// vérification d'import et fiches.
const EXTENSIONS_PHOTO = ['png', 'jpg', 'jpeg', 'webp'];
const TAILLE_MAX_PHOTO = 20 * 1024 * 1024;     // 20 Mo, vérifiés webview et hôte
const VERSIONS_PHOTO = ['original', 'avec-fond', 'sans-fond'];

function limitesMedias() {
  return {
    imageMax: TAILLE_MAX_IMAGE_IMPORT, imageExtensions: EXTENSIONS_IMAGE_IMPORT,
    photoMax: TAILLE_MAX_PHOTO, photoExtensions: EXTENSIONS_PHOTO
  };
}

let photoEnCours = false;                       // le pipeline est long : pas de doublon

function dossierPortraitsArticle(racine, slug) {
  return path.join(racine, dossierUnites(), slug, 'portraits');
}

// Vignette d'un portrait pour la fiche d'auteur·e, sous un budget partagé : au-delà, la
// fiche montre le pictogramme d'absence — la modale, elle, chargera la photo à la demande.
const TAILLE_MAX_VIGNETTE = 3 * 1024 * 1024;
const BUDGET_VIGNETTES = 8 * 1024 * 1024;

function vignetteAuteur(racine, slug, photo, budget) {
  const relatif = assainirCheminPhoto(photo);
  if (relatif === '') { return null; }
  const chemin = path.join(dossierPortraitsArticle(racine, slug), relatif.replace(/^portraits\//, ''));
  try {
    const taille = fs.statSync(chemin).size;
    if (taille > TAILLE_MAX_VIGNETTE || taille > budget.reste) { return null; }
    budget.reste -= taille;
  } catch (e) { return null; }
  return dataUriImage(chemin);
}

// Le cache (auteurs.json, lib/auteurs-ojs.js) part vers chaque vue qui porte la modale
// d'auteur·e — métadonnées, vérification d'import, médias — en même temps que ses valeurs.
function envoyerAuteursConnus(panneau, racine) {
  let cache;
  try { cache = lireCacheAuteursPublies(); } catch (e) { return; }
  const auteurs = cache.auteurs;
  if (!Array.isArray(auteurs) || auteurs.length === 0) { return; }
  const langue = langueRevue(racine) === 'de' ? 'de' : 'fr';
  const nomsRor = (cache.ror && typeof cache.ror === 'object') ? cache.ror : {};
  repondrePanneau(panneau, {
    type: 'auteurs-connus',
    auteurs: auteurs.map((a) => ({
      prenom: a.prenom, nom: a.nom,
      fonction: a.fonction || '',
      affiliation: a.affiliation || libelleRor(nomsRor, a.ror, langue),
      ror: a.ror || '', orcid: a.orcid || '', email: a.email || ''
    }))
  });
}

// Le libellé d'un ROR dans la langue de la revue.
function libelleRor(nomsRor, ror, langue) {
  const id = String(ror || '').split('/').pop();
  const e = id === '' ? null : nomsRor[id];
  if (!e) { return ''; }
  return String(e[langue] || e.en || e.fr || e.de || '');
}

// Le cache (mots-cles.json, lib/mots-cles-edudoc.js) part vers les vues qui portent la
// grille de mots-clés — métadonnées, vérification d'import.
function envoyerMotsClesConnus(panneau) {
  let cache;
  try { cache = lireCacheMotsCles(); } catch (e) { return; }
  const motsCles = cache.motsCles;
  if (!Array.isArray(motsCles) || motsCles.length === 0) { return; }
  repondrePanneau(panneau, {
    type: 'mots-cles-connus',
    motsCles: motsCles.map((m) => ({ de: (m && m.de) || '', fr: (m && m.fr) || '' }))
  });
}

// Rythme d'activation propre à ce cockpit : 7 jours. Échec réseau = silence, hors ligne est
// un état normal du poste.
const JOURS_FRAICHEUR_MOTS_CLES_ACTIVATION = 7;

function rafraichirMotsClesConnusEnFond() {
  let cache;
  try { cache = lireCacheMotsCles(); } catch (e) { return; }
  const t = cache.dateFetch ? Date.parse(cache.dateFetch) : NaN;
  const perime = !isFinite(t) ||
    (Date.now() - t) >= JOURS_FRAICHEUR_MOTS_CLES_ACTIVATION * 24 * 3600 * 1000;
  if (!perime) { return; }
  rafraichirMotsCles({ forcer: true }).then((res) => {
    if (res.fait && res.complet) {
      console.log('[mots-cles-edudoc] edudoc.ch : ' + res.nombre + ' descripteur(s)');
    } else if (res.fait) {
      console.log('[mots-cles-edudoc] rafraîchissement incomplet (hors ligne ?) : ' +
        (res.erreur || '?'));
    }
  }).catch((e) => {
    console.log('[mots-cles-edudoc] rafraîchissement raté : ' + String((e && e.message) || e));
  });
}

// Le rafraîchissement hebdomadaire, lancé à l'activation sans l'attendre.
function rafraichirAuteursPubliesEnFond() {
  const { rafraichirCorpus: rafraichirCorpusAuteurs } = require('./auteurs-corpus');
  rafraichirCacheAuteursPublies().then((res) => {
    if (res.fait && res.complet) {
      console.log('[auteurs-ojs] OJS : ' + res.nombre + ' nom(s), ' +
        (res.nombreRor || 0) + ' institution(s) ROR' +
        (res.rorRates ? ' (' + res.rorRates + ' ROR non résolu(s), on réessaiera)' : ''));
    } else if (res.fait) {
      console.log('[auteurs-ojs] rafraîchissement incomplet (hors ligne ?) : ' + (res.erreur || '?'));
    }
    return rafraichirCorpusAuteurs();
  }).then((res) => {
    if (!res || !res.fait) { return; }
    if (res.complet) {
      console.log('[auteurs-corpus] corpus balayé : ' + res.fichiers + ' fiche(s) lue(s), ' +
        res.nombre + ' nom(s) au total');
    } else {
      console.log('[auteurs-corpus] balayage incomplet, on reprendra : ' + (res.erreur || 'borne atteinte'));
    }
  }).catch((e) => {
    console.log('[auteurs] rafraîchissement raté : ' + String((e && e.message) || e));
  });
}

// photo-ouvrir : renvoie les versions déjà présentes sur le disque.
function ouvrirVersionsPhoto(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }
  const photo = assainirCheminPhoto(msg.photo);
  const d = photo === '' ? null : decomposerPhoto(photo);
  if (d && !baseAuteurValide(d.base)) {
    repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  if (!d) {
    repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  repondrePanneau(panneau, {
    type: 'photo-versions', slug: slug, index: msg.index, base: d.base,
    versions: versionsPhoto(dossierPortraitsArticle(fournisseur.racine, slug), d.base),
    infos: null, actuelle: d.version
  });
}

// Écrit l'original par fichier « ~$ » puis rename, purge les anciens, lance le pipeline.
// Seul chemin d'écriture d'un portrait : le formulaire des fiches et le gestionnaire des
// médias y passent tous les deux.
async function ecrirePortraitEtTraiter(fournisseur, slug, slugAuteur, ext, donneesBase64) {
  const echec = (message) => ({ ok: false, message: message });
  if (!new Set(fournisseur.listerArticles()).has(String(slug || ''))) { return echec(T('photo.err.introuvable')); }
  if (!baseAuteurValide(slugAuteur)) { return echec(T('photo.err.introuvable')); }
  if (photoEnCours) { return echec(T('photo.encours')); }
  if (EXTENSIONS_PHOTO.indexOf(String(ext || '').toLowerCase()) === -1) { return echec(T('photo.err.format')); }
  const donnees = Buffer.from(String(donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { return echec(T('photo.err.format')); }
  if (donnees.length > TAILLE_MAX_PHOTO) { return echec(T('photo.err.tropvolumineux')); }

  photoEnCours = true;
  try {
    const dossier = dossierPortraitsArticle(fournisseur.racine, slug);
    const nomOriginal = slugAuteur + '.original.' + ext;
    const chemin = path.join(dossier, nomOriginal);
    try {
      fs.mkdirSync(dossier, { recursive: true });
      for (const n of (fs.readdirSync(dossier) || [])) {
        if (n.indexOf(slugAuteur + '.original.') === 0 && n !== nomOriginal) {
          try { fs.unlinkSync(path.join(dossier, n)); } catch (e) { /* verrouillé : sans gravité */ }
        }
      }
      const tmp = path.join(dossier, '~$' + nomOriginal);
      try {
        fs.writeFileSync(tmp, donnees);
        fs.renameSync(tmp, chemin);
      } finally {
        try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
      }
    } catch (e) {
      return echec(T('err.ecriture', [e.message]));
    }
    let resultats;
    try {
      resultats = await traiterPortraits({
        dossierPortraits: dossier,
        entrees: [{ slug: slugAuteur, cheminSource: chemin }]
      });
    } catch (e) {
      return echec(T(e && e.wsl ? 'photo.err.wsl' : 'photo.err.traitement', [e.message]));
    }
    const r = resultats.filter((x) => x && x.slug === slugAuteur)[0] || resultats[0] || {};
    if (!r.ok) { return echec(T('photo.err.traitement', [String(r.erreur || '?')])); }
    return { ok: true, visage: !!r.visage, recadre: !!r.recadre, dossier: dossier };
  } finally {
    photoEnCours = false;
  }
}

async function deposerPhotoAuteur(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  const index = msg.index;
  const erreur = (texte) => repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: index, message: texte });
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }
  if (refuserSiVerrouille()) { erreur(T('verrou.refuse')); return; }
  const prenom = String(msg.prenom || '').trim();
  const nom = String(msg.nom || '').trim();
  if (prenom === '' && nom === '') { erreur(T('photo.nomrequis')); return; }
  const slugAuteur = slugifier(prenom + '-' + nom);
  const ext = (String(msg.nomFichier || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  const r = await ecrirePortraitEtTraiter(fournisseur, slug, slugAuteur, ext, msg.donneesBase64);
  if (!r.ok) { erreur(r.message); return; }
  if (!r.visage) { vscode.window.showWarningMessage(T('photo.sansvisage')); }
  repondrePanneau(panneau, {
    type: 'photo-versions', slug: slug, index: index, base: slugAuteur,
    versions: versionsPhoto(r.dossier, slugAuteur),
    infos: { visage: !!r.visage, recadre: !!r.recadre },
    actuelle: null
  });
}

// Le champ `photo` d'une fiche peut désigner l'original, dont l'extension change avec le
// fichier déposé.
function recalerPhotoOriginale(racine, slug, base, extAvant, extApres) {
  if (extAvant === extApres) { return 0; }
  const chemin = cheminMeta(racine, slug);
  let contenu;
  try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { return 0; }
  const ancien = 'photo: "portraits/' + base + '.original.' + extAvant + '"';
  if (contenu.indexOf(ancien) === -1) { return 0; }
  const sortie = contenu.split(ancien).join('photo: "portraits/' + base + '.original.' + extApres + '"');
  try { ecrireAtomique(chemin, sortie); } catch (e) { return 0; }
  return 1;
}

// photo-choisir : le chemin relatif de la version demandée, vérifié sur le disque.
function choisirPhotoAuteur(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }
  const base = String(msg.base || '');
  const version = String(msg.version || '');
  const erreur = () => repondrePanneau(panneau,
    { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
  if (!baseAuteurValide(base) || VERSIONS_PHOTO.indexOf(version) === -1) { erreur(); return; }
  const dossier = dossierPortraitsArticle(fournisseur.racine, slug);
  let nom = null;
  if (version === 'original') {
    nom = trouverOriginal(dossier, base);
  } else {
    nom = base + '.' + version + '.png';
    try { if (!fs.existsSync(path.join(dossier, nom))) { nom = null; } } catch (e) { nom = null; }
  }
  if (!nom) { erreur(); return; }
  repondrePanneau(panneau, { type: 'photo-valeur', slug: slug, index: msg.index, photo: 'portraits/' + nom });
}

// ---- Formulaire de fiches : tous les articles, ou un seul ------------------------
// Le formulaire liste tous les articles ; l'icône ✎ de l'arbre l'ouvre filtré sur un seul.
let filtreArticles = null;           // tableau de slugs affichés, ou null = tous
let rafraichirFiches = null;         // renvoie les valeurs au panneau ouvert, s'il existe
let fichesModifie = false;           // ● côté webview : cartes modifiées non enregistrées
let rechargementEnAttente = null;    // { filtre } pendant l'aller-retour de la garde

function filtreValide(fournisseur, slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) { return null; }
  const connus = new Set(fournisseur.listerArticles());
  const retenus = slugs.map(String).filter((s) => connus.has(s));
  return retenus.length > 0 ? retenus : null;
}

// Une fiche écrite ailleurs rend le modèle du formulaire périmé. Panneau propre : on le
// recharge. Panneau portant des cartes modifiées : on le dit et c'est à l'utilisateur de
// trancher.
function signalerFichesPerimees() {
  if (!panneauArticles || !rafraichirFiches) { return; }
  if (fichesModifie) { vscode.window.showWarningMessage(T('fiches.perimees')); return; }
  rafraichirFiches();
}

function titreFiches(filtre) {
  return (filtre && filtre.length === 1) ? T('fiches.titre.un', [filtre[0]]) : T('fiches.titre');
}

// La case « Définir manuellement le DOI » d'une carte : l'hôte pose la question et répond.
async function confirmerDoiManuel(panneau, msg) {
  const retirer = msg.sens === 'retirer';
  const choix = await vscode.window.showWarningMessage(
    T(retirer ? 'fiches.doi.retirer.question' : 'fiches.doi.manuel.question'),
    { modal: true, detail: T(retirer ? 'fiches.doi.retirer.detail' : 'fiches.doi.manuel.detail') },
    T(retirer ? 'fiches.doi.retirer.oui' : 'fiches.doi.manuel.oui'));
  repondrePanneau(panneau, {
    type: 'doi-manuel-reponse', slug: String(msg.slug || ''),
    sens: retirer ? 'retirer' : 'activer', ok: choix !== undefined
  });
}

// Pleine page : les aperçus sont fermés avant, même pour un simple reveal.
async function ouvrirApercuMetadonnees(fournisseur, rafraichirTout, slugs) {
  if (!fournisseur.racine) { return; }
  const filtre = filtreValide(fournisseur, slugs);
  await fermerTousLesApercus();
  const envoyerValeurs = (panneau, extra) => {
    const langue = langueRevue(fournisseur.racine);
    panneau.webview.postMessage(Object.assign({
      type: 'valeurs',
      articles: lireMetadonneesArticles(fournisseur, filtreArticles),
      filtre: filtreArticles,
      langue: langue,
      accent: ctx.lireCouleurAccent(fournisseur.racine),
      types: typesTraduits(langue),
      licences: licencesTraduites(), licenceDefaut: LICENCE_DEFAUT,
      limites: limitesMedias()
    }, extra || {}));
    envoyerAuteursConnus(panneau, fournisseur.racine);
    envoyerMotsClesConnus(panneau);
    fichesModifie = false;
  };
  rafraichirFiches = () => { if (panneauArticles) { envoyerValeurs(panneauArticles); } };
  const appliquerFiltre = (panneau, nouveau, extra) => {
    filtreArticles = nouveau;
    panneau.title = titreFiches(filtreArticles);
    envoyerValeurs(panneau, extra);
  };
  if (panneauArticles) {
    panneauArticles.reveal(vscode.ViewColumn.One);
    if (fichesModifie) {
      rechargementEnAttente = { filtre: filtre };
      repondrePanneau(panneauArticles, { type: 'demande-rechargement' });
      return;
    }
    appliquerFiltre(panneauArticles, filtre);
    return;
  }
  filtreArticles = filtre;
  fichesModifie = false;
  const panneau = vscode.window.createWebviewPanel(
    'szhApercuMetadonnees', titreFiches(filtreArticles), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
  );
  panneauArticles = panneau;
  panneau.onDidDispose(() => {
    ctx.libererCoedition(panneau);
    if (panneauArticles === panneau) {
      panneauArticles = null; fichesModifie = false; rechargementEnAttente = null;
      rafraichirFiches = null;
    }
  });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) { envoyerValeurs(panneau, { requete: msg.requete }); return; }
    if (msg.type === MSG.MODIFIE) { fichesModifie = !!msg.modifie; return; }
    if (msg.type === MSG.TOUS) { await ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null); return; }
    if (msg.type === MSG.RECHARGEMENT) {
      const attente = rechargementEnAttente;
      rechargementEnAttente = null;
      if (!attente) { return; }
      const choix = await vscode.window.showWarningMessage(
        T('fiches.recharger.question'), { modal: true, detail: T('table.quitter.detail') },
        T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
      if (choix === undefined) { return; }
      if (choix === T('form.enregistrer')) {
        const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles, panneau);
        const refusCartes = messageCartes(res);
        if (refusCartes) {
          repondrePanneau(panneau, { type: 'erreur', message: refusCartes });
          return;
        }
        vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000);
        if (rafraichirTout) { rafraichirTout(); }
        relancerCompilationCartes(fournisseur, res);
      }
      appliquerFiltre(panneau, attente.filtre, { rechargement: true });
      return;
    }
    if (msg.type === MSG.PHOTO_DEPOSER) { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_OUVRIR) { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_CHOISIR) { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.DOI_MANUEL_CONFIRMER) { await confirmerDoiManuel(panneau, msg); return; }
    if (msg.type !== MSG.ENREGISTRER) {
      console.warn('métadonnées des articles (hôte) : type de message inconnu', msg.type);
      return;
    }
    if (!msg.articles) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles, panneau);
    const refusCartes = messageCartes(res);
    if (refusCartes) {
      panneau.webview.postMessage({ type: 'erreur', message: refusCartes });
    } else {
      panneau.webview.postMessage({ type: 'enregistre', n: res.n, auto: !!msg.auto });
      if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000); }
    }
    if (rafraichirTout) { rafraichirTout(); }
    relancerCompilationCartes(fournisseur, res);
    if (!msg.auto || res.recharger) { envoyerValeurs(panneau, res.recharger ? { rechargement: true } : undefined); }
  });
  panneau.webview.html = htmlApercuMetadonnees(crypto.randomBytes(16).toString('hex'));
}

// Sans item, l'article visé est celui du .md actif, à défaut celui en aperçu.
async function ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine) { return; }
  let slug = (item && item.slug) ? String(item.slug) : null;
  if (!slug) {
    const ed = vscode.window.activeTextEditor;
    slug = ed ? ctx.slugDepuisChemin(fournisseur.racine, ed.document.uri.fsPath) : null;
  }
  if (!slug) { slug = session.apercuCourantSlug(); }
  if (!slug) {
    vscode.window.setStatusBarMessage(T('fiches.horsarticle'), 4000);
    return;
  }
  ctx.focaliserUnite(fournisseur, slug);
  await ouvrirApercuMetadonnees(fournisseur, rafraichirTout, [slug]);
}

module.exports = {
  configurer,
  textesNumero, chargeNumero, ecrireChampsNumero, messageNumero,
  cheminMeta, migrerFrontmatterVersMeta, doisCalculesArticles, ecrireDoisCalcules,
  lireMetadonneesArticles, nettoyerCarte, ecrireCartesArticles, messageCartes,
  relancerCompilationCartes, textesCarteArticle, textesAuteur, licencesTraduites, typesTraduits,
  ecrireChampsLivre, filtreValide, signalerFichesPerimees, titreFiches,
  confirmerDoiManuel, ouvrirMetadonnees, ouvrirApercuMetadonnees, ouvrirMetadonneesArticle,
  limitesMedias, BUDGET_VIGNETTES, vignetteAuteur, envoyerAuteursConnus, envoyerMotsClesConnus,
  rafraichirMotsClesConnusEnFond, rafraichirAuteursPubliesEnFond,
  deposerPhotoAuteur, ouvrirVersionsPhoto, choisirPhotoAuteur, recalerPhotoOriginale
};
