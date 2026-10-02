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
// Posés une seule fois dans extension.js. Les valeurs par défaut ne servent qu'à ne pas
// planter un test qui require ce module seul.
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
// (lib/liens.js) qui ouvre le bon numéro sur le suivi de traduction, et le met dans le
// presse-papiers comme dans un brouillon d'e-mail. Le lien ne porte pas de chemin :
// c'est le lanceur qui retrouve le dossier sur le poste.

// Le brouillon, et le seul chemin : un `mailto:` en texte brut. Le corps d'un mailto
// n'accepte pas de HTML, le lien szh:// y arrive donc inerte — c'est le prix du retrait du
// composant COM d'Outlook, qui ne parlait qu'à l'ancien client. D'où deux compensations :
// le lien est seul sur sa ligne dans le corps, sélectionnable d'un double-clic, et le
// texte dit au destinataire quoi en faire. L'adresse n'est pas encodée : sa forme est
// vérifiée par adresseMailTraduction, qui n'en laisse passer aucun caractère réservé.
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
  // Le lien porte l'id, pas le nom du dossier (depuis le 23.09.2026) : un numéro sans `id:`
  // (créé avant cette date, jamais rouvert dans le cockpit depuis) n'a encore aucun lien
  // valable -- le cockpit le pose à l'ouverture (voir ailleurs), pas ici.
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
    // Aucun client de messagerie, ou refus de l'hôte : le lien est déjà au presse-papiers,
    // et le bouton laisse une seconde chance au brouillon.
    const bouton = T('trad.lien.mail');
    const choix = await vscode.window.showInformationMessage(T('trad.lien.copie.seul', [lien]), bouton);
    // Second échec : rien à ajouter, la notification a déjà dit l'essentiel. Mais il faut
    // l'attendre et l'avaler, sans quoi c'est un rejet non capturé de l'hôte d'extensions.
    if (choix === bouton) {
      try { await ouvrirBrouillonMail(brouillon); } catch (err) { /* déjà signalé */ }
    }
  }
}

// Atterrissage d'un lien reçu : le lanceur a déposé une intention à usage unique,
// consommée ici une fois l'arbre prêt ; celle qui vise une autre revue est laissée à une
// autre fenêtre. Ne lève pas : un lien ne doit pas bloquer l'ouverture.
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
    // `commentaire` et son aide sont resolus a l'assemblage de la page
    // (%%SZH:cle%% dans media/traduction.html) : ils ne passent pas par cette table.
    commentaire: T('trad.commentaire'),
    deepl: T('trad.deepl'), deeplTip: T('trad.deepl.tooltip'),
    envoyer: T('trad.envoyer'), envoyerTip: T('trad.envoyer.tooltip'),
    motCle: T('trad.motcle'), motCleSansEquiv: T('trad.motcle.sansequivalent'),
    motsClesAide: T('trad.motscles.aide'),
    // Placeholder d'un mot-clé vide : la même clé que la fiche des métadonnées, jamais
    // la sentinelle anglaise écrite dans le YAML.
    motCleATraduire: T('mc.aTraduire'),
    // Vérificateur de traduction : l'infobulle de la pastille, la même que sur les fiches.
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
    // Le vérificateur de traduction : lu à chaque envoi, donc pris en compte dès le
    // prochain rendu des cartes (changement d'article, rechargement).
    verifTrad: lireVerifTraduction()
  });
  traductionModifiee = false;                      // les cartes viennent d'être reconstruites
  // Les deux fichiers que ce panneau écrit, et ce qu'ils valaient à cet instant.
  const fiche = profils.chemins(profils.courant(), fournisseur.racine, slug).meta;
  noterLectureCoedition(panneau, fournisseur.racine, fiche);
  noterLectureCoedition(panneau, fournisseur.racine, ctx.cheminTraduction(fournisseur.racine, slug));
}

// Le panneau suit ce qui vient d'être écrit ailleurs — sauf s'il porte une saisie non
// enregistrée : le re-rendu la jetterait sans un mot, et remettrait son témoin de
// modification à zéro. On le dit alors, et l'utilisateur tranche.
function rafraichirPanneauTraduction(fournisseur) {
  if (!panneauTraduction || !slugTraduction || !fournisseur.racine) { return; }
  if (fournisseur.listerArticles().indexOf(slugTraduction) === -1) { return; }
  if (traductionModifiee) { vscode.window.showWarningMessage(T('trad.perimee')); return; }
  envoyerValeursTraduction(panneauTraduction, fournisseur, slugTraduction, null);
}

// Enregistre ce que renvoie le panneau ; les textes passent par ecrireCartesArticles,
// qui relit la fiche et n'écrase donc pas une modification enregistrée ailleurs.
// metaChangee, dans le retour, pilote la recompilation de l'aperçu.
// `panneau` : le bail de co-édition sur les deux fichiers écrits ici — la fiche et le
// sidecar du suivi.
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
    // Pas la langue du numéro : ce panneau ne touche pas au texte source.
    if (LANGUES_META.indexOf(langue) === -1 || langue === source) { continue; }
    const s = statutValide(groupe.statut);
    for (const brut of (Array.isArray(groupe.champs) ? groupe.champs : [])) {
      const champ = String((brut && brut.champ) || '');
      if (CHAMPS_TRADUISIBLES.indexOf(champ) === -1) { continue; }
      // Sur chaque clé du groupe : le sidecar reste lisible sans notion de groupe.
      if (s) { statuts[cleChamp(champ, langue)] = s; }
      const avant = texteChamp(meta, champ, langue);
      let valeur;
      if (champ === 'keywords') {
        // alignerMotsCles tient la place des cases vides, ici du côté qui écrit.
        valeur = alignerMotsCles(brut.paires, listeChamp(meta, 'keywords', source).length);
      } else {
        valeur = valeurChamp(champ, brut.texte);
      }
      meta[champ] = meta[champ] || {};
      meta[champ][langue] = valeur;
      if (texteChamp(meta, champ, langue) !== avant) { metaChangee = true; }
    }
  }
  // Requis ici et non en tête : lib/metadonnees-hote.js requiert déjà ce module.
  const { ecrireCartesArticles, messageCartes } = require('./metadonnees-hote');
  const res = ecrireCartesArticles(fournisseur, { [slug]: meta }, [slug], panneau);
  const refusCartes = messageCartes(res);
  if (refusCartes) { return { ok: false, message: refusCartes, recharger: res.recharger }; }
  const commentaire = String(msg.commentaire === undefined || msg.commentaire === null ? '' : msg.commentaire)
    .replace(/\r\n?/g, '\n').slice(0, 4000);
  // Le sidecar du suivi a son propre bail : c'est un autre fichier, et la fiche vient
  // d'être écrite — s'arrêter ici laisserait les deux désaccordés, mais écrire par-dessus
  // la saisie de quelqu'un d'autre serait pire, et le message dit lequel des deux manque.
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

// Le traducteur web accepte le texte dans le fragment de l'URL,
// https://www.deepl.com/translator#<source>/<cible>/<texte>, ouverte par le navigateur.
// Sans clé d'API, le retour se fait au copier-coller.
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
  // L'état du module reste la garde : rafraichirPanneauTraduction le lit aussi.
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
  // Les gestionnaires ne sont appelés qu'une fois cette fonction finie.
  const { panneau } = panneauUnique({
    viewType: 'szhTraduction', titre: T('trad.titre.un', [vise.slug]), garde: garde,
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    retenir: true,
    // Mode « Trad » : l'état du mode, et le clic détourné — voir repondreModeTrad.
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
    // La fiche est une dépendance de compilation ; jamais en pleine frappe.
    if (res.metaChangee && !msg.auto) { montrerApercu(etat().slug); }
  }
  montrerApercu(vise.slug);
}

// ---- Mode « Trad » : l'index des libellés, et les panneaux qui détournent -------
//
// Allumé, le mode change le sens du clic dans les panneaux : au lieu de faire ce que le
// bouton fait d'habitude, un clic ouvre le formulaire de suggestion sur le texte cliqué.
// L'hôte n'y tient que deux rôles — dire si le mode est allumé et fournir l'index qui
// retrouve la clé d'un texte, puis recevoir le clic détourné.
//
// ⚠ L'INDEX NE PART QUE SI LE MODE EST ALLUMÉ : c'est la table entière des libellés de la
//   langue courante, quelques dizaines de kilo-octets, et éteint il n'y a rien à chercher.
//   C'est donc la page qui demande (media/_commun.js, au premier « pret »), et l'hôte qui
//   répond.
//
// ⚠ LE FORMULAIRE DE SUGGESTION NE BRANCHE PAS repondreModeTrad, et c'est le premier garde-fou
//   du mode, pas un oubli : c'est lui que le mode ouvre. Il ne reçoit jamais l'index, et la page
//   le redit de son côté (SZH.modeTradJamais). L'Accueil, lui, le branche, mais sa barre
//   d'onglets et son onglet Paramètres, où l'on éteint le mode, gardent leurs clics
//   (data-trad-exempt, media/_commun.js).
const panneauxTrad = new Set();
let indexTradCache = null;
let indexTradLangue = '';

// L'index de la langue courante, construit une fois et gardé : le refaire à chaque
// ouverture de panneau parcourrait pour rien plus de mille libellés. Il se refait si la
// langue du cockpit change.
function indexTradCourant() {
  const langue = langueCockpit();
  if (!indexTradCache || indexTradLangue !== langue) {
    indexTradCache = indexTextes.construireIndex(TEXTES_COCKPIT[langue] || TEXTES_COCKPIT.fr);
    indexTradLangue = langue;
  }
  return indexTradCache;
}

// Ce que le bandeau du mode dit dans chaque panneau : ce qu'un clic va faire, et comment
// sortir. La page ne connaît pas la langue de l'interface, elle reçoit des mots tout faits.
function textesModeTrad() {
  return { bandeau: T('trad.mode.bandeau'), eteindre: T('trad.mode.eteindre') };
}

function etatModeTrad() {
  return lireModeTrad()
    ? { type: MSG.MODE_TRAD, actif: true, index: indexTradCourant(), textes: textesModeTrad() }
    : { type: MSG.MODE_TRAD, actif: false };
}

// Branché en tête du gestionnaire de messages de chaque panneau qui peut détourner ses
// clics. Rend vrai quand il a traité le message : l'appelant s'arrête alors là.
function repondreModeTrad(panneau, msg) {
  if (!msg) { return false; }
  // La demande voyage avec le « pret » de la page : un message de plus à l'ouverture
  // n'apprendrait rien de neuf. Une page qui ne le porte pas ne reçoit jamais l'index —
  // c'est le cas des réglages et du formulaire de suggestion. On rend FAUX : ce « pret »
  // reste celui de la page, qui a ses valeurs à envoyer.
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

// Combien de suggestions sur les textes de l'outil attendent d'être relues, sur ce poste.
// Recompté à chaque envoi de valeurs au formulaire de réglages, jamais gardé : le dossier
// se vide à la main, entre deux ouvertures du panneau.
function compterSuggestionsInterface() {
  try {
    return suggestionTraduction.compterSuggestionsInterface(
      suggestionTraduction.dossierSuggestionsInterface());
  } catch (e) { return 0; }              // pas de dossier, ou illisible : rien en attente
}

// Le mode vient de changer : les panneaux ouverts doivent le savoir tout de suite. Sans
// cela, l'éteindre depuis un panneau laisserait les autres bloqués jusqu'à leur
// réouverture — exactement le piège que les garde-fous doivent empêcher.
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
// actif (réglage du poste, lib/archivage.js#lireVerifTraduction). Il ne modifie RIEN : la
// proposition part dans le dossier traduction/ du numéro, à côté de articles/, et le texte
// publié reste ce qu'il était. Le panneau « Traductions », lui, écrit dans la fiche — les
// deux gestes cohabitent sans se gêner, et il ne faut pas les confondre.
//
// À côté (ViewColumn.Beside) et non en pleine page : on propose une traduction en regardant
// le formulaire d'où l'on vient.
//
// Un seul panneau à la fois : une seconde pastille le recharge sur son champ plutôt que
// d'ouvrir un second onglet où la première proposition serait oubliée.

let viseSuggestion = null;       // { slug, champ, langue, actuel } — ce que la pastille visait

function textesSuggestion() {
  return {
    article: T('sugg.article'), champ: T('sugg.champ'), langue: T('sugg.langue'),
    actuelVide: T('sugg.actuel.vide'), rien: T('sugg.rien'),
    supprimerQuoi: T('sugg.supprimer.quoi'),
    // La seconde cible : un libellé de l'outil, cliqué dans le mode « Trad ». Ni article,
    // ni champ — la clé du libellé, et de quoi dire qu'on ne l'a pas retrouvée.
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

// Les intitulés lisibles du champ et de la langue : la webview ne connaît pas la langue de
// l'interface, elle reçoit des mots tout faits.
function libellesSuggestion(champ, langue) {
  return { champ: T('sugg.champ.' + champ), langue: T('meta.langue.' + langue) };
}

function envoyerValeursSuggestion(panneau) {
  if (!viseSuggestion) { return; }
  // Un libellé de l'outil n'a ni champ ni langue d'article : seule la langue de l'interface
  // a un intitulé à donner.
  const libelles = viseSuggestion.cible === suggestionTraduction.CIBLE_INTERFACE
    ? { langue: T('meta.langue.' + viseSuggestion.langue) }
    : libellesSuggestion(viseSuggestion.champ, viseSuggestion.langue);
  repondrePanneau(panneau, Object.assign({ type: MSG.VALEURS, libelles: libelles }, viseSuggestion));
}

// Écrit la proposition. Le numéro n'est pas verrouillé pour autant qu'il soit gelé ou
// archivé : une suggestion ne touche à aucun fichier publié, et c'est justement sur un
// numéro figé qu'on relit. Un dossier réellement en lecture seule le dira par l'erreur
// d'écriture, plutôt que par un refus posé d'avance.
// Une suggestion sur un libellé de l'outil ne concerne aucun numéro : elle se range sur le
// poste, dans %LOCALAPPDATA%\SZH\suggestions-interface. Ni produit, ni numéro, ni article,
// ni champ — la clé du libellé, les candidates qu'on avait proposées, et la langue.
function enregistrerSuggestionInterface(msg) {
  return suggestionTraduction.ecrireSuggestionInterface(
    suggestionTraduction.dossierSuggestionsInterface(), {
      auteur: moiCoedition().utilisateur,
      // La clé retenue vient de la page : elle a pu être choisie parmi plusieurs
      // candidates, ou n'exister du tout — le formulaire s'ouvre quand même.
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
    // Le texte d'avant est celui que la pastille a capté, et non celui que la fiche porte
    // maintenant : c'est de celui-là que la proposition parle.
    actuel: viseSuggestion.actuel,
    // Le geste vient de la page : « supprimer » dit que ce texte ne devrait pas exister.
    // Tout ce qui n'est pas ce mot vaut « remplacer » (suggestion-traduction.js#normaliserGeste).
    geste: msg.geste,
    propose: msg.propose,
    commentaire: msg.commentaire
  });
  rendreCompteSuggestion(panneau, res);
}

// Ce que la page apprend d'une écriture, quelle qu'ait été la cible : le refus, ou le nom
// du fichier écrit.
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
  // Le panneau montre que c'est fait, puis s'efface : laisser un formulaire enregistré
  // ouvert invite à l'enregistrer une seconde fois.
  setTimeout(() => { try { panneau.dispose(); } catch (e) { /* déjà fermé */ } }, 1200);
}

// `msg` vient de la pastille : { slug, champ, langue, valeur }.
function ouvrirSuggestionTraduction(fournisseur, msg) {
  if (!fournisseur.racine || !msg) { return; }
  const champ = String(msg.champ || '');
  const langue = String(msg.langue || '');
  // Le champ et la langue viennent d'une webview : seuls les quatre champs traduisibles de
  // la fiche et les langues qu'elle connaît ont un sens ici.
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
// Les clés viennent d'une webview : on ne garde que celles que la table de la langue
// courante porte vraiment. Si rien ne reste, on refait la recherche ici — le formulaire doit
// s'ouvrir dans tous les cas, sur le texte littéral s'il le faut : une suggestion sur un
// texte non identifié vaut mieux que rien, et c'est justement là qu'un mainteneur veut
// regarder.
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

// Le panneau lui-même, un seul pour les deux cibles : une seconde demande le recharge sur
// son nouveau texte plutôt que d'ouvrir un second onglet où la première proposition serait
// oubliée.
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
