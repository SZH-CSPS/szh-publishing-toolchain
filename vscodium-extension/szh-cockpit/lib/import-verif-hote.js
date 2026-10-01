// Le dialogue « Vérification de l'import », ouvert à la fin d'une conversion dès qu'un
// nouvel article est apparu. Les rappels vers l'hôte passent par configurer().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { panneauUnique } = require('./webviews/panneau');
const { confirmerAbandon } = require('./interaction');
const { fermerTousLesApercus } = require('./apercu');
const { analyserMeta, langueRevue, LICENCE_DEFAUT } = require('./yaml');
const { decrireImage } = require('./medias');
const { lireVerifTraduction } = require('./archivage');
const { libererCoedition } = require('./coedition-hote');
const { repondreModeTrad, ouvrirSuggestionTraduction } = require('./traduction-hote');
const {
  textesCarteArticle, BUDGET_VIGNETTES, doisCalculesArticles, migrerFrontmatterVersMeta, cheminMeta,
  vignetteAuteur, typesTraduits, licencesTraduites, limitesMedias, envoyerAuteursConnus,
  envoyerMotsClesConnus, deposerPhotoAuteur, ouvrirVersionsPhoto, choisirPhotoAuteur,
  confirmerDoiManuel, ecrireCartesArticles, messageCartes
} = require('./metadonnees-hote');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois dans extension.js. Les valeurs par défaut ne servent qu'à ne pas
// planter un test qui require ce module seul.
let ctx = {
  lireCouleurAccent: () => '',
  // Le remplacement d'une image est celui du gestionnaire des médias (extension.js).
  remplacerFichierImage: async () => ({ etat: 'erreur', message: 'lib/import-verif-hote.js non configuré' })
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function profilCourant() { return profils.courant(); }

// postMessage tolérant : le panneau peut être fermé pendant le traitement.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// Ouvert à la fin de lancerConversion dès qu'un nouvel article est apparu. Une section
// par article : la carte de métadonnées du formulaire des fiches, avec des badges
// « détecté » ou « à compléter » ; les photos d'auteur·e·s ; et les images de
// articles/<slug>/media/, à remplacer par leur original en gardant leur nom.

let slugsImportVerif = [];                         // slugs de la dernière conversion

function htmlImportVerif(nonce) {
  const txt = JSON.stringify(Object.assign(textesCarteArticle(), {
    badgeDetecte: T('importv.badge.detecte'), badgeAcompleter: T('importv.badge.acompleter'),
    vides: T('importv.vides'), videsZero: T('importv.vides.zero'),
    sectionImages: T('importv.section.images'),
    imagesAucune: T('importv.images.aucune'), imageDeposer: T('importv.image.deposer'),
    imageRemplacee: T('importv.image.remplacee'),
    errImageTropVolumineuse: T('importv.err.tropvolumineux'),
    errImageFormat: T('importv.err.format')
  }));
  return construireHtml('import-verif', nonce, {
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
    titre: T('importv.titre'),
    remplacements: { '__TXT__': txt },
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Articles de la dernière conversion, slugs revalidés.
function lireArticlesImport(fournisseur) {
  const budgetVignettes = { reste: BUDGET_VIGNETTES };
  const connus = new Set(fournisseur.listerArticles());
  const dois = doisCalculesArticles(fournisseur);
  const articles = [];
  for (const slug of slugsImportVerif) {
    if (!connus.has(slug)) { continue; }
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = analyserMeta('');                 // forme de la carte vide
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide, tout « à compléter » */ }
    delete valeurs._inconnues;                     // la webview n'a pas à les voir
    const base = profils.chemins(profilCourant(), fournisseur.racine, slug).media;
    const images = fournisseur._imagesArticle(slug).map((relatif) => ({
      relatif: relatif,
      description: decrireImage(path.join(base, relatif))   // « L × H · poids »
    }));
    articles.push({
      slug: slug, valeurs: valeurs, images: images, doiCalcule: dois[slug] || '',
      apercusAuteurs: (valeurs.author || [])
        .map((a) => vignetteAuteur(fournisseur.racine, slug, a.photo, budgetVignettes))
    });
  }
  return articles;
}

// `extra` porte le jeton de la course pret/valeurs : `{ requete }` en réponse à
// « pret », `{ rechargement: true }` pour un rechargement forcé (fiche périmée).
function envoyerValeursImportVerif(panneau, fournisseur, extra) {
  const langue = langueRevue(fournisseur.racine);
  repondrePanneau(panneau, Object.assign({
    type: MSG.VALEURS,
    articles: lireArticlesImport(fournisseur),
    langue: langue,
    accent: ctx.lireCouleurAccent(fournisseur.racine),
    types: typesTraduits(langue),
    licences: licencesTraduites(), licenceDefaut: LICENCE_DEFAUT,
    // Le plafond des originaux d'image (section « Originaux des images ») et celui des
    // photos d'auteur·e·s (modale partagée) : plus aucun littéral côté webview.
    limites: limitesMedias(),
    // Le vérificateur de traduction : relu à chaque envoi de valeurs, c'est-à-dire à
    // chaque reconstruction des cartes.
    verifTrad: lireVerifTraduction()
  }, extra || {}));
  envoyerAuteursConnus(panneau, fournisseur.racine);
  envoyerMotsClesConnus(panneau);
}

// Le remplacement lui-même est celui du gestionnaire des médias ; ici, seul l'aller-retour
// avec la webview change. Une annulation est signalée, qui réactive la zone de dépôt.
async function remplacerImageImport(fournisseur, rafraichirTout, panneau, msg) {
  const slug = String(msg.slug || '');
  const relatif = String(msg.relatif || '');
  const res = await ctx.remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif,
    msg.nomFichier, msg.donneesBase64);
  if (res.etat === 'annule') {
    repondrePanneau(panneau, { type: MSG.IMAGE_ANNULEE, slug: slug, relatif: relatif });
    return;
  }
  if (res.etat === 'erreur') {
    repondrePanneau(panneau, { type: MSG.IMAGE_ERREUR, slug: slug, relatif: relatif, message: res.message });
    return;
  }
  repondrePanneau(panneau, {
    type: MSG.IMAGE_REMPLACEE, slug: slug, relatif: relatif,
    description: decrireImage(path.join(profils.chemins(profilCourant(), fournisseur.racine, slug).media, relatif))
  });
}

async function ouvrirImportVerif(fournisseur, rafraichirTout, slugs) {
  if (!fournisseur.racine || !Array.isArray(slugs) || slugs.length === 0) { return; }
  slugsImportVerif = slugs.slice();
  await fermerTousLesApercus();
  // Les gestionnaires ne sont appelés qu'une fois cette fonction finie.
  const { panneau, nouveau } = panneauUnique({
    viewType: 'szhImportVerif', titre: T('importv.titre'),
    // Mode « Trad » : l'état du mode, et le clic détourné — voir repondreModeTrad.
    modeTrad: (panneau, msg) => repondreModeTrad(panneau, msg),
    html: htmlImportVerif,
    surPret: (msg, p) => envoyerValeursImportVerif(p, fournisseur, { requete: msg.requete }),
    surMessage: (msg) => traiterMessage(msg),
    surFermeture: (p) => libererCoedition(p)
  });
  if (!nouveau) {
    envoyerValeursImportVerif(panneau, fournisseur);
    return;
  }
  async function traiterMessage(msg) {
    if (msg.type === MSG.PHOTO_DEPOSER) { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_OUVRIR) { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_CHOISIR) { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.DOI_MANUEL_CONFIRMER) { await confirmerDoiManuel(panneau, msg); return; }
    if (msg.type === MSG.SUGGERER_TRADUCTION) { ouvrirSuggestionTraduction(fournisseur, msg); return; }
    if (msg.type === MSG.REMPLACER_IMAGE) { await remplacerImageImport(fournisseur, rafraichirTout, panneau, msg); return; }
    if (msg.type === MSG.FERMER) {
      // Seul chemin de fermeture contrôlable : la croix de l'onglet est hors de portée.
      if (msg.modifie) {
        const choix = await confirmerAbandon(T('importv.quitter.question'));
        if (choix === 'annuler') { return; }                       // Annuler : on reste
        if (choix === 'enregistrer') {
          const res = ecrireCartesArticles(fournisseur, msg.articles, slugsImportVerif, panneau);
          const refusCartes = messageCartes(res);
          if (refusCartes) {
            repondrePanneau(panneau, { type: MSG.ERREUR, message: refusCartes });
            return;                                                // échec : on reste
          }
          vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000);
          if (rafraichirTout) { rafraichirTout(); }
        }
      }
      panneau.dispose();
      return;
    }
    if (msg.type !== MSG.ENREGISTRER) {
      console.warn('vérification de l’import (hôte) : type de message inconnu', msg.type);
      return;
    }
    if (!msg.articles) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, slugsImportVerif, panneau);
    const refusCartes = messageCartes(res);
    if (refusCartes) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: refusCartes });
    } else {
      repondrePanneau(panneau, { type: MSG.ENREGISTRE, n: res.n, auto: !!msg.auto });
      if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000); }
    }
    if (rafraichirTout) { rafraichirTout(); }
    // Pas de re-rendu sur un enregistrement automatique : le curseur serait perdu. Une
    // fiche périmée l'exige quand même — voir le formulaire des fiches.
    if (!msg.auto || res.recharger) {
      envoyerValeursImportVerif(panneau, fournisseur, res.recharger ? { rechargement: true } : undefined);
    }
  }
}

module.exports = { configurer, ouvrirImportVerif, remplacerImageImport };
