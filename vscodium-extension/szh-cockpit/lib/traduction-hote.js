// Traduction côté hôte : l'envoi pour traduction (lien szh:// et e-mail), le panneau
// « Traductions », le mode « Trad » des panneaux, et le formulaire de suggestion. Impur
// (webviews, dialogues, disque) ; les rappels vers l'hôte passent par configurer().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { TEXTES_COCKPIT, T, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const { construireHtml } = require('./webviews/util');
const { panneauUnique, revelerPanneau } = require('./webviews/panneau');
const { confirmerAbandon } = require('./interaction');
const { libererCoedition, moiCoedition, noterLectureCoedition, ecrireSousMain } = require('./coedition-hote');
const { brouillonTraduction, uriMailto } = require('./courriel');
const { construireLienTraduction, consommerIntention } = require('./liens');
const { analyserAusgabe, normaliserRevue, titreNumero, langueRevue, LANGUES_META } = require('./yaml');
const { CONFIG_POSTE, lireModeTrad, ecrireModeTrad, lireVerifTraduction } = require('./archivage');
const {
  CHAMPS_TRADUISIBLES, STATUTS, cleChamp, statutValide,
  texteChamp, listeChamp, valeurChamp, alignerMotsCles
} = require('./traduction');
const session = require('./session');
const profils = require('./profil');
const suggestionTraduction = require('./suggestion-traduction');
const indexTextes = require('./index-textes');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés par extension.js. Les valeurs par défaut permettent de charger ce module seul
// dans un test.
let ctx = {
  ouvrirArticle: async () => {},
  slugDepuisChemin: () => null,
  revueNumero: () => '',
  // Le suivi de traduction d'un article : sa fiche, son sidecar, et l'état qu'ils donnent.
  etatTraduction: () => ({
    meta: {}, suivi: { statuts: {}, commentaire: '' }, lignes: [], groupes: [], source: 'fr', resume: null
  }),
  cheminTraduction: () => '',
  lireMetaArticle: () => ({}),
  lireSuiviTraduction: () => ({ statuts: {}, commentaire: '' }),
  ecrireSuiviTraduction: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// postMessage tolérant : le panneau peut être fermé pendant le traitement.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// ---- « Envoyer pour traduction » : lien szh:// et e-mail -------------------------
// Le bouton fabrique un lien szh://traduction/<produit>/<numero>[/<article>]
// (lib/liens.js) qui ouvre le numéro sur le suivi de traduction, et le met dans le
// presse-papiers et dans un brouillon d'e-mail. Le lanceur retrouve le dossier sur le poste.

// Le brouillon est un `mailto:` en texte brut, où le lien szh:// n'est pas cliquable : il
// est donc seul sur sa ligne, sélectionnable d'un double-clic, et le texte dit quoi en
// faire. L'adresse n'est pas encodée : adresseMailTraduction refuse tout caractère réservé.
// Les gabarits de mail-templates/ (lib/courriel.js) nomment la revue et le sens de la traduction.

function ouvrirBrouillonMail(brouillon) {
  return vscode.env.openExternal(vscode.Uri.parse(uriMailto(brouillon)));
}

async function envoyerPourTraduction(fournisseur, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const vise = cibleTraduction(fournisseur, cible);   // sinon le lien vise le numéro
  const slug = (vise.slug && fournisseur.listerArticles().indexOf(vise.slug) !== -1) ? vise.slug : '';
  let produit = '';
  let id = '';
  try {
    const ausgabe = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'));
    produit = normaliserRevue(ausgabe.revue);
    id = String(ausgabe.id || '');
  } catch (e) { produit = ''; }
  // Le lien porte l'id du numéro. Un numéro sans `id:` n'a pas de lien valable ; le cockpit
  // pose l'id à l'ouverture du numéro.
  const lien = construireLienTraduction(produit, id, slug);
  if (lien === '') {
    vscode.window.showWarningMessage(T('trad.lien.impossible'));
    return;
  }
  try { await vscode.env.clipboard.writeText(lien); } catch (e) { /* presse-papiers refusé */ }

  const quoi = slug === '' ? titreNumero(racine) : titreNumero(racine) + ' — ' + slug;
  const brouillon = brouillonTraduction(produit, quoi, lien);
  try {
    await ouvrirBrouillonMail(brouillon);
    vscode.window.setStatusBarMessage(T('trad.lien.copie', [lien]), 8000);
  } catch (e) {
    // Pas de client de messagerie, ou refus de l'hôte : le lien est au presse-papiers, et un
    // bouton permet de réessayer le brouillon.
    const bouton = T('trad.lien.mail');
    const choix = await vscode.window.showInformationMessage(T('trad.lien.copie.seul', [lien]), bouton);
    // Un second échec est attendu et ignoré, pour éviter un rejet non capturé dans l'hôte
    // d'extensions.
    if (choix === bouton) {
      try { await ouvrirBrouillonMail(brouillon); } catch (err) { /* déjà signalé */ }
    }
  }
}

// Lien reçu : le lanceur a déposé une intention à usage unique, consommée ici une fois
// l'arbre prêt. Une intention qui vise une autre revue est laissée à sa fenêtre. Ne lève
// pas, pour ne pas bloquer l'ouverture.
async function honorerIntention(fournisseur, rafraichirTout) {
  try {
    const racine = fournisseur.racine;
    if (!racine) { return; }
    const intention = consommerIntention(racine);
    if (!intention || intention.vue !== 'traduction') { return; }
    const cible = (intention.article !== '' && fournisseur.listerArticles().indexOf(intention.article) !== -1)
      ? { slug: intention.article } : undefined;
    await ouvrirTraduction(fournisseur, rafraichirTout, cible);
    vscode.window.setStatusBarMessage(T('intention.ouverte'), 6000);
  } catch (e) { /* jamais bloquant */ }
}

// ---- Le panneau « Traductions » : page, valeurs, enregistrement, DeepL ---------

// « Titre et sous-titre (DE) » quand les deux existent, sinon « Titre (DE) ».
function libelleGroupe(groupe) {
  let nom;
  if (groupe.groupe === 'titre') {
    nom = groupe.champs.length > 1
      ? T('trad.champ.titre.duo')
      : T('trad.champ.' + groupe.champs[0]);
  } else {
    nom = T('trad.champ.' + groupe.champs[0]);
  }
  return T('trad.champ.libelle', [nom, groupe.langue.toUpperCase()]);
}

// « traduit » ou « à traduire », sauf pour les mots-clés : « 2/4 traduits ».
function etatRemplissageGroupe(groupe) {
  if (groupe.groupe === 'motscles') {
    const l = groupe.lignes[0];
    return T('trad.avancement', [l.remplies, l.total]);
  }
  return groupe.rempli ? T('trad.traduit') : T('trad.atraduire');
}

function textesTraduction() {
  return {
    source: T('trad.source'), sourceVide: T('trad.source.vide'), cible: T('trad.cible'),
    copier: T('trad.copier'), copie: T('trad.copie'), statut: T('trad.statut'),
    traduit: T('trad.traduit'), atraduire: T('trad.atraduire'),
    courtTraduction: T('trad.court.traduction'), courtRelecture: T('trad.court.relecture'),
    courtFinalise: T('trad.court.finalise'), toutTip: T('trad.tout.tip'),
    rien: T('trad.rien'), aucuneModif: T('form.rien'), enregistre: T('trad.enregistre'),
    // `commentaire` et son aide sont résolus à l'assemblage de la page
    // (%%SZH:cle%% dans media/traduction.html).
    commentaire: T('trad.commentaire'),
    deepl: T('trad.deepl'), deeplTip: T('trad.deepl.tooltip'),
    envoyer: T('trad.envoyer'), envoyerTip: T('trad.envoyer.tooltip'),
    motCle: T('trad.motcle'), motCleSansEquiv: T('trad.motcle.sansequivalent'),
    motsClesAide: T('trad.motscles.aide'),
    // Texte indicatif d'un mot-clé vide, le même que sur la fiche des métadonnées (et non
    // la marque écrite dans le YAML).
    motCleATraduire: T('mc.aTraduire'),
    // Infobulle de la pastille du vérificateur de traduction, la même que sur les fiches.
    suggPastille: T('sugg.pastille')
  };
}

function htmlTraduction(nonce) {
  return construireHtml('traduction', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    titre: T('trad.titre'),
    remplacements: { '__TXT__': JSON.stringify(textesTraduction()) }
  });
}

// Le panneau ouvert, l'article qu'il montre, sa saisie non enregistrée, et le changement
// d'article qui attend la réponse de la page.
let panneauTraduction = null;
let slugTraduction = null;
let traductionModifiee = false;
let rechargementTraduction = null;

function etatPanneau() {
  return {
    panneau: panneauTraduction, slug: slugTraduction,
    modifiee: traductionModifiee, rechargement: rechargementTraduction
  };
}

function poserEtatPanneau(n) {
  if ('panneau' in n) { panneauTraduction = n.panneau; }
  if ('slug' in n) { slugTraduction = n.slug; }
  if ('modifiee' in n) { traductionModifiee = n.modifiee; }
  if ('rechargement' in n) { rechargementTraduction = n.rechargement; }
}

// Libellés résolus côté hôte : la webview ne connaît pas la langue d'interface.
function groupesPourWebview(etat) {
  return etat.groupes.map((groupe) => ({
    cle: groupe.cle, groupe: groupe.groupe, langue: groupe.langue,
    langueSource: etat.source,
    libelle: libelleGroupe(groupe),
    remplissage: etatRemplissageGroupe(groupe),
    rempli: groupe.rempli,
    statut: groupe.statut,
    champs: groupe.lignes.map((ligne) => ({
      champ: ligne.champ,
      libelle: T('trad.champ.' + ligne.champ),
      source: ligne.source,
      cible: ligne.cible,
      paires: ligne.paires || null,
      multiligne: ligne.champ === 'resume'
    }))
  }));
}

function envoyerValeursTraduction(panneau, fournisseur, slug, focus) {
  const etat = ctx.etatTraduction(fournisseur.racine, slug);
  repondrePanneau(panneau, {
    type: MSG.VALEURS,
    slug: slug,
    langueSource: etat.source,
    groupes: groupesPourWebview(etat),
    commentaire: etat.suivi.commentaire,
    statuts: STATUTS.map((s) => ({ valeur: s, libelle: T('trad.statut.' + s) })),
    focus: focus || null,
    // Réglage du vérificateur de traduction, relu à chaque envoi.
    verifTrad: lireVerifTraduction()
  });
  traductionModifiee = false;                      // les cartes viennent d'être reconstruites
  // Les deux fichiers que ce panneau écrit, et ce qu'ils valaient à cet instant.
  const fiche = profils.chemins(profils.courant(), fournisseur.racine, slug).meta;
  noterLectureCoedition(panneau, fournisseur.racine, fiche);
  noterLectureCoedition(panneau, fournisseur.racine, ctx.cheminTraduction(fournisseur.racine, slug));
}

// Le panneau reprend ce qui vient d'être écrit ailleurs. S'il porte une saisie non
// enregistrée, le re-rendu la perdrait : on demande alors à l'utilisateur.
function rafraichirPanneauTraduction(fournisseur) {
  if (!panneauTraduction || !slugTraduction || !fournisseur.racine) { return; }
  if (fournisseur.listerArticles().indexOf(slugTraduction) === -1) { return; }
  if (traductionModifiee) { vscode.window.showWarningMessage(T('trad.perimee')); return; }
  envoyerValeursTraduction(panneauTraduction, fournisseur, slugTraduction, null);
}

// Enregistre ce que renvoie le panneau. Les textes passent par ecrireCartesArticles, qui
// relit la fiche et garde les modifications faites ailleurs. metaChangee, dans le retour,
// décide de la recompilation de l'aperçu.
// `panneau` : le bail de co-édition sur la fiche et sur le fichier de suivi.
function enregistrerTraduction(fournisseur, msg, panneau) {
  const racine = fournisseur.racine;
  const slug = String((msg && msg.slug) || '');
  if (!racine || fournisseur.listerArticles().indexOf(slug) === -1) {
    return { ok: false, message: T('err.ecriture', [slug + '.trad.yaml', slug]) };
  }
  const source = langueRevue(racine);
  const meta = ctx.lireMetaArticle(racine, slug);
  delete meta._inconnues;                          // ecrireCartesArticles les relit du disque
  const suivi = ctx.lireSuiviTraduction(racine, slug);
  const statuts = Object.assign({}, suivi.statuts);
  let metaChangee = false;
  for (const groupe of (Array.isArray(msg.groupes) ? msg.groupes : [])) {
    const langue = String((groupe && groupe.langue) || '');
    // Langue du numéro exclue : ce panneau ne touche pas au texte source.
    if (LANGUES_META.indexOf(langue) === -1 || langue === source) { continue; }
    const s = statutValide(groupe.statut);
    for (const brut of (Array.isArray(groupe.champs) ? groupe.champs : [])) {
      const champ = String((brut && brut.champ) || '');
      if (CHAMPS_TRADUISIBLES.indexOf(champ) === -1) { continue; }
      // Écrit sur chaque clé du groupe : le fichier de suivi ignore les groupes.
      if (s) { statuts[cleChamp(champ, langue)] = s; }
      const avant = texteChamp(meta, champ, langue);
      let valeur;
      if (champ === 'keywords') {
        // alignerMotsCles marque les cases vides pour garder les positions.
        valeur = alignerMotsCles(brut.paires, listeChamp(meta, 'keywords', source).length);
      } else {
        valeur = valeurChamp(champ, brut.texte);
      }
      meta[champ] = meta[champ] || {};
      meta[champ][langue] = valeur;
      if (texteChamp(meta, champ, langue) !== avant) { metaChangee = true; }
    }
  }
  // Requis ici et non en tête, pour éviter un cycle : lib/metadonnees-hote.js requiert ce module.
  const { ecrireCartesArticles, messageCartes } = require('./metadonnees-hote');
  const res = ecrireCartesArticles(fournisseur, { [slug]: meta }, [slug], panneau);
  const refusCartes = messageCartes(res);
  if (refusCartes) { return { ok: false, message: refusCartes, recharger: res.recharger }; }
  const commentaire = String(msg.commentaire === undefined || msg.commentaire === null ? '' : msg.commentaire)
    .replace(/\r\n?/g, '\n').slice(0, 4000);
  // Le fichier de suivi a son propre bail. S'il est tenu ailleurs, la fiche reste écrite
  // seule, et le message dit lequel des deux fichiers manque.
  const refusSuivi = ecrireSousMain(panneau, racine, ctx.cheminTraduction(racine, slug), () => {
    try {
      ctx.ecrireSuiviTraduction(racine, slug, {
        statuts: statuts, commentaire: commentaire, _inconnues: suivi._inconnues
      });
      return null;
    } catch (e) { return String((e && e.message) || e); }
  });
  if (refusSuivi) {
    return { ok: false, message: refusSuivi.message, recharger: refusSuivi.code === 'perime' };
  }
  return { ok: true, metaChangee: metaChangee };
}

// Le traducteur web de DeepL lit le texte dans le fragment de l'URL :
// https://www.deepl.com/translator#<source>/<cible>/<texte>. Le résultat revient par
// copier-coller.
const LONGUEUR_MAX_DEEPL = 4000;                   // au-delà, les navigateurs tronquent

function ouvrirDeepl(panneau, msg) {
  const texte = String((msg && msg.texte) || '').trim();
  const de = LANGUES_META.indexOf(String(msg.source || '')) !== -1 ? msg.source : 'fr';
  const vers = LANGUES_META.indexOf(String(msg.cible || '')) !== -1 ? msg.cible : 'de';
  if (texte === '') { return; }
  if (texte.length > LONGUEUR_MAX_DEEPL) {
    repondrePanneau(panneau, { type: MSG.ERREUR, message: T('trad.deepl.troplong') });
    return;
  }
  const url = 'https://www.deepl.com/translator#' + de + '/' + vers + '/' + encodeURIComponent(texte);
  vscode.env.openExternal(vscode.Uri.parse(url));
}

// L'argument de l'arbre ({slug[, cle]} ou slug), sinon le .md actif, sinon l'aperçu.
function cibleTraduction(fournisseur, cible) {
  if (typeof cible === 'string' && cible !== '') { return { slug: cible, cle: null }; }
  if (cible && cible.slug) { return { slug: String(cible.slug), cle: cible.cle ? String(cible.cle) : null }; }
  const ed = vscode.window.activeTextEditor;
  const actif = ed ? ctx.slugDepuisChemin(fournisseur.racine, ed.document.uri.fsPath) : null;
  return { slug: actif || session.apercuCourantSlug() || null, cle: null };
}

// Formulaire en colonne 1, aperçu de l'article en colonne 2, ouvert sans le .md.
async function ouvrirTraduction(fournisseur, rafraichirTout, cible) {
  if (!fournisseur.racine) { return; }
  const vise = cibleTraduction(fournisseur, cible);
  if (!vise.slug || fournisseur.listerArticles().indexOf(vise.slug) === -1) {
    vscode.window.setStatusBarMessage(T('trad.horsarticle'), 4000);
    return;
  }
  const etat = etatPanneau;
  const poser = poserEtatPanneau;
  const montrerApercu = (slug) => {
    // Une erreur de compilation est déjà signalée par ouvrirArticle.
    ctx.ouvrirArticle(fournisseur, slug, { sansTexte: true }).catch(() => { /* déjà signalé */ });
  };
  const garde = { lire: () => etat().panneau, poser: (p) => poser({ panneau: p }) };
  if (revelerPanneau({ viewType: 'szhTraduction', garde: garde })) {
    const ouvert = etat().panneau;
    if (vise.slug === etat().slug) {
      if (vise.cle) { repondrePanneau(ouvert, { type: MSG.FOCUS, cle: vise.cle }); }
      montrerApercu(vise.slug);
      return;
    }
    if (etat().modifiee) {
      // Le panneau porte un ● : le changement d'article se joue à la réponse.
      poser({ rechargement: vise });
      repondrePanneau(ouvert, { type: MSG.DEMANDE_RECHARGEMENT });
      return;
    }
    poser({ slug: vise.slug });
    ouvert.title = T('trad.titre.un', [vise.slug]);
    envoyerValeursTraduction(ouvert, fournisseur, vise.slug, vise.cle);
    montrerApercu(vise.slug);
    return;
  }
  poser({ slug: vise.slug, modifiee: false, rechargement: null });
  let focusInitial = vise.cle;
  // Les gestionnaires ne sont appelés qu'après la fin de cette fonction.
  const { panneau } = panneauUnique({
    viewType: 'szhTraduction', titre: T('trad.titre.un', [vise.slug]), garde: garde,
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    retenir: true,
    // Mode « Trad » : voir repondreModeTrad.
    modeTrad: (panneau, msg) => repondreModeTrad(panneau, msg),
    html: (nonce) => htmlTraduction(nonce),
    surPret: (msg, p) => {
      envoyerValeursTraduction(p, fournisseur, etat().slug, focusInitial);
      focusInitial = null;
    },
    surMessage: (msg) => traiterMessage(msg),
    surFermeture: (p, courant) => {
      libererCoedition(p);
      if (courant) { poser({ slug: null, modifiee: false, rechargement: null }); }
    }
  });
  async function traiterMessage(msg) {
    if (msg.type === MSG.MODIFIE) { poser({ modifiee: !!msg.modifie }); return; }
    if (msg.type === MSG.COPIER) {
      await vscode.env.clipboard.writeText(String(msg.texte || ''));
      repondrePanneau(panneau, { type: MSG.COPIE });
      return;
    }
    if (msg.type === MSG.DEEPL) { ouvrirDeepl(panneau, msg); return; }
    if (msg.type === MSG.LIEN) { envoyerPourTraduction(fournisseur, { slug: etat().slug }); return; }
    if (msg.type === MSG.SUGGERER_TRADUCTION) { ouvrirSuggestionTraduction(fournisseur, msg); return; }
    if (msg.type === MSG.RECHARGEMENT) {
      const attente = etat().rechargement;
      poser({ rechargement: null });
      if (!attente) { return; }                    // réponse tardive : abandonné
      const choix = await confirmerAbandon(T('trad.recharger.question'));
      if (choix === 'annuler') { return; }         // Annuler : on reste sur l'article
      if (choix === 'enregistrer') {
        const res = enregistrerTraduction(fournisseur, msg, panneau);
        if (!res.ok) { repondrePanneau(panneau, { type: MSG.ERREUR, message: res.message }); return; }
        vscode.window.setStatusBarMessage(T('statut.traduction', [msg.slug]), 3000);
        if (rafraichirTout) { rafraichirTout(); }
      }
      poser({ slug: attente.slug });
      panneau.title = T('trad.titre.un', [attente.slug]);
      envoyerValeursTraduction(panneau, fournisseur, attente.slug, attente.cle);
      montrerApercu(attente.slug);
      return;
    }
    if (msg.type !== MSG.ENREGISTRER) {
      console.warn('traduction : type de message inconnu', msg.type);
      return;
    }
    const res = enregistrerTraduction(fournisseur, msg, panneau);
    if (!res.ok) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: res.message });
      // Périmé : ce que le panneau montre n'est plus ce que les fichiers contiennent.
      if (res.recharger) { envoyerValeursTraduction(panneau, fournisseur, etat().slug, null); }
      return;
    }
    repondrePanneau(panneau, { type: MSG.ENREGISTRE, auto: !!msg.auto });
    poser({ modifiee: false });
    if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.traduction', [etat().slug]), 3000); }
    if (rafraichirTout) { rafraichirTout(); }
    // Un enregistrement automatique ne renvoie rien : le re-rendu perdrait le curseur.
    if (!msg.auto) { envoyerValeursTraduction(panneau, fournisseur, etat().slug, null); }
    // La fiche est lue par la compilation : on ne recompile pas pendant la frappe.
    if (res.metaChangee && !msg.auto) { montrerApercu(etat().slug); }
  }
  montrerApercu(vise.slug);
}

// ---- Mode « Trad » : l'index des libellés, et les panneaux qui détournent -------
//
// Mode allumé, un clic dans un panneau ouvre le formulaire de suggestion sur le texte
// cliqué, au lieu de l'action habituelle. L'hôte dit si le mode est allumé, fournit l'index
// qui retrouve la clé d'un texte, puis reçoit le clic détourné.
//
// L'index (toute la table des libellés de la langue, quelques dizaines de Ko) n'est envoyé
// que si le mode est allumé, à la demande de la page (media/_commun.js, au premier « pret »).
//
// Le formulaire de suggestion ne branche pas repondreModeTrad, puisque c'est lui que le mode
// ouvre ; la page le refuse aussi (SZH.modeTradJamais). Dans l'Accueil, la barre d'onglets
// et l'onglet Paramètres, où l'on éteint le mode, gardent leurs clics (data-trad-exempt).
const panneauxTrad = new Set();
let indexTradCache = null;
let indexTradLangue = '';

// L'index de la langue courante, gardé en mémoire (plus de mille libellés) et reconstruit
// si la langue du cockpit change.
function indexTradCourant() {
  const langue = langueCockpit();
  if (!indexTradCache || indexTradLangue !== langue) {
    indexTradCache = indexTextes.construireIndex(TEXTES_COCKPIT[langue] || TEXTES_COCKPIT.fr);
    indexTradLangue = langue;
  }
  return indexTradCache;
}

// Textes du bandeau du mode : ce que fait un clic, et comment sortir. Résolus ici, la page
// ne connaissant pas la langue de l'interface.
function textesModeTrad() {
  return { bandeau: T('trad.mode.bandeau'), eteindre: T('trad.mode.eteindre') };
}

function etatModeTrad() {
  return lireModeTrad()
    ? { type: MSG.MODE_TRAD, actif: true, index: indexTradCourant(), textes: textesModeTrad() }
    : { type: MSG.MODE_TRAD, actif: false };
}

// Appelé en tête du gestionnaire de messages des panneaux qui détournent leurs clics. Rend
// vrai quand il a traité le message.
function repondreModeTrad(panneau, msg) {
  if (!msg) { return false; }
  // La demande d'index arrive avec le « pret » de la page ; une page qui ne la porte pas
  // (réglages, formulaire de suggestion) ne reçoit pas l'index. On rend faux : le « pret »
  // doit encore être traité par la page appelante.
  if (msg.type === MSG.PRET) {
    if (msg.modeTrad) {
      panneauxTrad.add(panneau);
      repondrePanneau(panneau, etatModeTrad());
    }
    return false;
  }
  if (msg.type === MSG.MODE_TRAD) {
    panneauxTrad.add(panneau);
    // `actif: false` : la page vient d'éteindre le mode depuis son bandeau ou par Échap.
    // Toute autre forme est une demande d'état.
    if (msg.actif === false) {
      const erreur = ecrireModeTrad(false);
      if (erreur) {
        vscode.window.showErrorMessage(T('err.ecriture', [path.basename(CONFIG_POSTE), erreur]));
      }
      diffuserModeTrad();
      return true;
    }
    repondrePanneau(panneau, etatModeTrad());
    return true;
  }
  if (msg.type === MSG.SUGGERER_INTERFACE) { ouvrirSuggestionInterface(msg); return true; }
  return false;
}

// Nombre de suggestions sur les textes de l'outil en attente sur ce poste. Recompté à
// chaque envoi, car le dossier se vide à la main.
function compterSuggestionsInterface() {
  try {
    return suggestionTraduction.compterSuggestionsInterface(
      suggestionTraduction.dossierSuggestionsInterface());
  } catch (e) { return 0; }              // pas de dossier, ou illisible : rien en attente
}

// Le mode vient de changer : on prévient tous les panneaux ouverts, sans quoi les autres
// resteraient en mode « Trad » jusqu'à leur réouverture.
function diffuserModeTrad() {
  const etat = etatModeTrad();
  for (const panneau of Array.from(panneauxTrad)) {
    try { panneau.webview.postMessage(etat); }
    catch (e) { panneauxTrad.delete(panneau); }   // panneau fermé entre-temps
  }
}

// ---- Suggestion de traduction (webview) ------------------------------------------
//
// Ouvert par la pastille d'un champ traduisible, quand le vérificateur de traduction est
// actif (réglage du poste, lib/archivage.js#lireVerifTraduction). La proposition est écrite
// dans le dossier traduction/ du numéro ; le texte publié ne change pas. (Le panneau
// « Traductions », lui, écrit dans la fiche.)
//
// Ouvert à côté (ViewColumn.Beside), pour garder le formulaire d'origine sous les yeux. Un
// seul panneau à la fois : une seconde pastille le recharge sur son champ.

let viseSuggestion = null;       // { slug, champ, langue, actuel } — ce que la pastille visait

function textesSuggestion() {
  return {
    article: T('sugg.article'), champ: T('sugg.champ'), langue: T('sugg.langue'),
    actuelVide: T('sugg.actuel.vide'), rien: T('sugg.rien'),
    supprimerQuoi: T('sugg.supprimer.quoi'),
    // Seconde cible : un libellé de l'outil, cliqué en mode « Trad ». On garde sa clé, et
    // de quoi dire qu'elle n'a pas été retrouvée.
    cible: T('sugg.cible'), cibleInterface: T('sugg.cible.interface'),
    cle: T('sugg.cle'), cleInconnue: T('sugg.cle.inconnue'),
    cleInconnueAide: T('sugg.cle.inconnue.aide'), clePlusieurs: T('sugg.cle.plusieurs')
  };
}

function htmlSuggestion(nonce) {
  return construireHtml('suggestion', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    titre: T('sugg.titre'),
    remplacements: { '__TXT__': JSON.stringify(textesSuggestion()) }
  });
}

// Intitulés du champ et de la langue, résolus ici : la webview ne connaît pas la langue de
// l'interface.
function libellesSuggestion(champ, langue) {
  return { champ: T('sugg.champ.' + champ), langue: T('meta.langue.' + langue) };
}

function envoyerValeursSuggestion(panneau) {
  if (!viseSuggestion) { return; }
  // Pour un libellé de l'outil, seule la langue de l'interface a un intitulé.
  const libelles = viseSuggestion.cible === suggestionTraduction.CIBLE_INTERFACE
    ? { langue: T('meta.langue.' + viseSuggestion.langue) }
    : libellesSuggestion(viseSuggestion.champ, viseSuggestion.langue);
  repondrePanneau(panneau, Object.assign({ type: MSG.VALEURS, libelles: libelles }, viseSuggestion));
}

// Écrit la proposition, même sur un numéro gelé ou archivé : une suggestion ne touche à
// aucun fichier publié. Un dossier en lecture seule le dira par l'erreur d'écriture.
// Une suggestion sur un libellé de l'outil se range sur le poste, dans
// %LOCALAPPDATA%\SZH\suggestions-interface, avec la clé, les clés candidates et la langue.
function enregistrerSuggestionInterface(msg) {
  return suggestionTraduction.ecrireSuggestionInterface(
    suggestionTraduction.dossierSuggestionsInterface(), {
      auteur: moiCoedition().utilisateur,
      // La clé retenue vient de la page : choisie parmi plusieurs candidates, ou absente.
      cle: msg.cle,
      cles: viseSuggestion.cles,
      langue: viseSuggestion.langue,
      actuel: viseSuggestion.actuel,
      geste: msg.geste,
      propose: msg.propose,
      commentaire: msg.commentaire
    });
}

function enregistrerSuggestion(fournisseur, panneau, msg) {
  if (!viseSuggestion) { return; }
  if (viseSuggestion.cible === suggestionTraduction.CIBLE_INTERFACE) {
    rendreCompteSuggestion(panneau, enregistrerSuggestionInterface(msg));
    return;
  }
  const racine = fournisseur && fournisseur.racine;
  if (!racine) { return; }
  const res = suggestionTraduction.ecrireSuggestion(racine, {
    auteur: moiCoedition().utilisateur,
    produit: ctx.revueNumero(racine),
    numero: path.basename(racine),
    article: viseSuggestion.slug,
    champ: viseSuggestion.champ,
    langue: viseSuggestion.langue,
    // Le texte d'avant est celui que la pastille a capté, sur lequel porte la proposition.
    actuel: viseSuggestion.actuel,
    // « supprimer » : ce texte ne devrait pas exister. Toute autre valeur vaut « remplacer »
    // (suggestion-traduction.js#normaliserGeste).
    geste: msg.geste,
    propose: msg.propose,
    commentaire: msg.commentaire
  });
  rendreCompteSuggestion(panneau, res);
}

// Réponse à la page après une écriture : le refus, ou le nom du fichier écrit.
function rendreCompteSuggestion(panneau, res) {
  if (!res.ok) {
    repondrePanneau(panneau, {
      type: MSG.ERREUR,
      message: res.raison === 'vide' ? T('sugg.rien') : T('sugg.err.ecriture', [res.message])
    });
    return;
  }
  repondrePanneau(panneau, { type: MSG.ENREGISTRE, message: T('sugg.enregistree', [res.nom]) });
  vscode.window.setStatusBarMessage(T('sugg.enregistree', [res.nom]), 4000);
  // Le panneau confirme puis se ferme, pour éviter un second enregistrement.
  setTimeout(() => { try { panneau.dispose(); } catch (e) { /* déjà fermé */ } }, 1200);
}

// `msg` vient de la pastille : { slug, champ, langue, valeur }.
function ouvrirSuggestionTraduction(fournisseur, msg) {
  if (!fournisseur.racine || !msg) { return; }
  const champ = String(msg.champ || '');
  const langue = String(msg.langue || '');
  // Champ et langue viennent d'une webview : seuls les champs traduisibles et les langues
  // connues sont acceptés.
  if (!suggestionTraduction.champValide(champ) || !suggestionTraduction.langueValide(langue)) {
    vscode.window.showWarningMessage(T('sugg.err.champ'));
    return;
  }
  viseSuggestion = {
    slug: String(msg.slug || ''), champ: champ, langue: langue,
    actuel: String(msg.valeur === undefined || msg.valeur === null ? '' : msg.valeur)
  };
  montrerPanneauSuggestion(fournisseur, T('sugg.titre.un', [viseSuggestion.slug]));
}

// Le clic détourné par le mode « Trad » : un texte lu à l'écran, et les clés que la page a
// cru reconnaître.
//
// Les clés viennent d'une webview : on ne garde que celles de la table de la langue
// courante. Si aucune ne reste, on refait la recherche ici. Le formulaire s'ouvre dans tous
// les cas, au besoin sur le texte seul.
function ouvrirSuggestionInterface(msg) {
  if (!msg) { return; }
  const texte = String(msg.texte === undefined || msg.texte === null ? '' : msg.texte);
  if (texte.trim() === '') { return; }
  const table = TEXTES_COCKPIT[langueCockpit()] || TEXTES_COCKPIT.fr;
  let cles = (Array.isArray(msg.cles) ? msg.cles : []).map((c) => String(c))
    .filter((c) => Object.prototype.hasOwnProperty.call(table, c));
  if (cles.length === 0) { cles = indexTextes.trouverCles(indexTradCourant(), texte); }
  viseSuggestion = {
    cible: suggestionTraduction.CIBLE_INTERFACE,
    cles: cles, langue: langueCockpit(), actuel: texte
  };
  montrerPanneauSuggestion(null, T('sugg.titre.interface'));
}

// Le panneau, un seul pour les deux cibles : une seconde demande le recharge sur son
// nouveau texte.
function montrerPanneauSuggestion(fournisseur, titre) {
  // Sans modeTrad : c'est lui que le mode ouvre (voir repondreModeTrad).
  const { panneau, nouveau } = panneauUnique({
    viewType: 'szhSuggestionTraduction', titre: titre, colonne: vscode.ViewColumn.Beside,
    html: htmlSuggestion,
    surPret: (recu, p) => envoyerValeursSuggestion(p),
    surMessage: (recu, p) => {
      if (recu.type === MSG.FERMER) { p.dispose(); return; }
      if (recu.type !== MSG.ENREGISTRER) {
        console.warn('suggestion de traduction : type de message inconnu', recu.type);
        return;
      }
      enregistrerSuggestion(fournisseur, p, recu);
    },
    surFermeture: (p, courant) => { if (courant) { viseSuggestion = null; } }
  });
  if (!nouveau) {
    panneau.title = titre;
    envoyerValeursSuggestion(panneau);
  }
}

module.exports = {
  configurer,
  envoyerPourTraduction, honorerIntention, ouvrirTraduction, rafraichirPanneauTraduction,
  cibleTraduction, libelleGroupe, etatRemplissageGroupe, enregistrerTraduction,
  repondreModeTrad, diffuserModeTrad, compterSuggestionsInterface, etatModeTrad,
  ouvrirSuggestionTraduction, ouvrirSuggestionInterface
};
