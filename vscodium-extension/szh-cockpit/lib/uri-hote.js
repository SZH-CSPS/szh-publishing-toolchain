// Liens « vscodium://szh-csps.szh-cockpit/<vue>/<produit>/<id>[/<article>] » reçus par
// l'éditeur. Le chemin se relit comme le lien szh:// de même suite, par la même grammaire
// (lib/liens.js). Si l'id est celui du dossier ouvert, cette fenêtre sert la vue ; sinon le
// lien part au lanceur, seul à retrouver un numéro par son id, et dont Start-SzhCodium
// garde les secrets transmis par WSLENV.
'use strict';

const liens = require('./liens');
const archivage = require('./archivage');

// La racine ouverte, son id, et l'ouverture d'une vue dans cette fenêtre, posés par
// extension.js.
let ctx = {
  racine: () => '',
  idDossier: () => '',
  ouvrirTraduction: () => Promise.resolve(),
  signalerRefus: () => {}
};
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// -> le lien szh:// de même suite, ou '' : ni requête ni fragment, que la grammaire n'a pas.
function versLienSzh(uri) {
  if (!uri || uri.query || uri.fragment) { return ''; }
  const suite = String(uri.path || '').replace(/^\/+/, '');
  return suite === '' ? '' : liens.SCHEMA + '://' + suite;
}

// Le lien reconstruit depuis son analyse : seul il part au lanceur, jamais le texte reçu.
function lienCanonique(analyse) {
  return analyse.vue === liens.VUE_TRADUCTION
    ? liens.construireLienTraduction(analyse.produit, analyse.id, analyse.article)
    : liens.construireLienOuvrir(analyse.produit, analyse.id);
}

// -> 'vue', 'lanceur' ou 'refuse'. Ne lève pas : un lien venu d'une page web ou d'un
// e-mail est une donnée non fiable, et un mauvais lien ne doit rien ouvrir.
async function traiterUri(uri) {
  try {
    const analyse = liens.analyserLien(versLienSzh(uri));
    if (!analyse) { return 'refuse'; }
    const racine = ctx.racine();
    if (racine && ctx.idDossier(racine) === analyse.id) {
      if (analyse.vue === liens.VUE_TRADUCTION) { await ctx.ouvrirTraduction(analyse.article); }
      return 'vue';
    }
    const lien = lienCanonique(analyse);
    if (lien === '') { return 'refuse'; }
    // Lu à l'appel : les tests le remplacent sur le module.
    const lancer = archivage.lancerScriptPowerShell;
    if (typeof lancer !== 'function') { return 'refuse'; }
    if (lancer(archivage.SCRIPT_LANCEUR, [lien])) { return 'refuse'; }
    return 'lanceur';
  } catch (e) { return 'refuse'; }
}

// Un refus se dit à l'utilisateur : un lien cliqué sans effet passerait pour une panne.
const gestionnaire = {
  handleUri: async (uri) => {
    const verdict = await traiterUri(uri);
    if (verdict === 'refuse') { try { ctx.signalerRefus(); } catch (e) { /* jamais bloquant */ } }
    return verdict;
  }
};

module.exports = { configurer, versLienSzh, traiterUri, gestionnaire };
