// Les courriels du cockpit, rendus par les gabarits Twig de mail-templates/ (lib/gabarits.js).
// Sans vscode, pour rester testable en ligne de commande.
'use strict';

const fs = require('fs');
const path = require('path');

const { compiler } = require('./gabarits');
const { FORME_MAIL, adresseMailTraduction } = require('./archivage');
const { COURRIEL_SUPPORT } = require('./codes-erreur');

const DOSSIER_GABARITS = path.join(__dirname, '..', 'mail-templates');

// Un gabarit compilé par fichier, gardé en mémoire : le texte ne change pas en cours de route.
const COMPILES = new Map();

function chargerGabarit(nom, langue) {
  const cle = nom + '.' + langue;
  if (COMPILES.has(cle)) { return COMPILES.get(cle); }
  let repli = langue;
  let chemin = path.join(DOSSIER_GABARITS, nom + '.' + langue + '.twig');
  if (!fs.existsSync(chemin)) {
    repli = 'fr';
    chemin = path.join(DOSSIER_GABARITS, nom + '.fr.twig');
  }
  if (!fs.existsSync(chemin)) {
    throw new Error('gabarit de courriel introuvable : « ' + nom + ' » (langue « ' + langue +
      ' », et son repli français absent aussi)');
  }
  const compile = compiler(fs.readFileSync(chemin, 'utf8'), nom + '.' + repli + '.twig');
  COMPILES.set(cle, compile);
  return compile;
}

// Convention de rendu, propre à ce module et non au moteur (lib/gabarits.js) : le sujet perd
// ses blancs de bord, le corps perd exactement un retour à la ligne après l'ouverture du
// bloc `corps` et un avant sa fermeture, que le gabarit porte pour rester lisible.
//
// Exportée pour que test/js/courriel-support.test.js applique la même règle au rendu de
// Get-SzhCourriel (PowerShell, qui passe par lib/gabarits.js via VSCodium-en-Node).
function normaliserRenduCourriel(blocs) {
  const sujet = String((blocs && blocs.sujet) || '').trim();
  const corps = String((blocs && blocs.corps) || '').replace(/^\n/, '').replace(/\n$/, '');
  return { sujet, corps };
}

function rendreCourriel(nom, langue, variables) {
  const compile = chargerGabarit(nom, String(langue || 'fr'));
  return normaliserRenduCourriel(compile.rendre(variables || {}));
}

// ---- Les quatre brouillons ---------------------------------------------------------------

// Les destinataires : toutes les adresses de la fiche, dans l'ordre des auteurs. Sans
// adresse dans la fiche, le champ reste vide.
function adressesAuteurs(meta) {
  const vues = [];
  for (const a of ((meta && meta.author) || [])) {
    const v = String((a && a.email) || '').trim();
    // Même forme d'adresse que « Envoyer pour traduction » : une seule règle (archivage.js).
    if (FORME_MAIL.test(v) && vues.indexOf(v) === -1) { vues.push(v); }
  }
  return vues;
}

// Le brouillon : destinataires, sujet et corps, séparé de son ouverture pour être testable
// sans client de messagerie. La langue est celle de l'article (sa fiche, à défaut le
// numéro), pas celle de l'interface. `nomsAuteurs` est facultatif : le gabarit le reçoit,
// aucun texte ne s'en sert encore.
function brouillonAuteur(langue, adresses, titreArticle, titreDuNumero, nomsAuteurs) {
  const rendu = rendreCourriel('envoi-auteur', langue, {
    titre: titreArticle, numero: titreDuNumero, auteurs: nomsAuteurs || [], langue
  });
  return { destinataire: adresses.join(','), sujet: rendu.sujet, corps: rendu.corps };
}

// Langue du courriel : celle de l'équipe qui traduit, pas celle de l'interface. Un numéro
// de la Zeitschrift part vers les traducteurs francophones, une Revue vers les
// germanophones ; les gabarits de mail-templates/ nomment la revue et le sens en conséquence.
const LANGUE_MAIL_TRADUCTION = { zeitschrift: 'fr', revue: 'de' };

// Le brouillon : destinataire, sujet et corps, tous trois déduits du seul jeton de revue.
// Séparé de son ouverture pour être éprouvable sans client de messagerie.
function brouillonTraduction(produit, quoi, lien) {
  const langue = LANGUE_MAIL_TRADUCTION[produit] || 'fr';
  const rendu = rendreCourriel('traduction', langue, { quoi, lien, produit, langue });
  return { destinataire: adresseMailTraduction(produit), sujet: rendu.sujet, corps: rendu.corps };
}

// Le courriel au support après un signalement depuis les Contrôles. Il nomme le fichier du
// rapport pour que le support le retrouve, jamais le texte de l'article ; un client de
// messagerie tronque un mailto trop long, d'où la borne.
const CORPS_SUPPORT_MAX = 1500;
function brouillonSupport(langue, variables) {
  const rendu = rendreCourriel('support', langue, variables);
  return { destinataire: COURRIEL_SUPPORT, sujet: rendu.sujet, corps: rendu.corps.slice(0, CORPS_SUPPORT_MAX) };
}

// L'adresse n'est pas encodée : sa forme est vérifiée par adresseMailTraduction (ou par
// FORME_MAIL pour un auteur), qui ne laisse passer aucun caractère réservé. Sujet et corps
// le sont, eux : accents, guillemets et retours à la ligne d'un corps entier n'y
// survivraient pas autrement.
function uriMailto(brouillon) {
  return 'mailto:' + brouillon.destinataire +
    '?subject=' + encodeURIComponent(brouillon.sujet) +
    '&body=' + encodeURIComponent(brouillon.corps);
}

module.exports = {
  rendreCourriel, normaliserRenduCourriel, adressesAuteurs, brouillonAuteur, brouillonTraduction,
  brouillonSupport,
  LANGUE_MAIL_TRADUCTION, uriMailto
};
