// Les courriels du cockpit : gabarits Twig (mail-templates/*.twig, lib/gabarits.js) plutôt
// que des chaînes {0}/{1} noyées dans lib/i18n.js. Pas de vscode ici — comme le reste de
// lib/, pour rester éprouvable en ligne de commande.
'use strict';

const fs = require('fs');
const path = require('path');

const { compiler } = require('./gabarits');
const { FORME_MAIL, adresseMailTraduction } = require('./archivage');

const DOSSIER_GABARITS = path.join(__dirname, '..', 'mail-templates');

// Un gabarit compilé par fichier lu, jamais recompilé : le texte ne change pas en cours
// de route, et refaire l'analyse à chaque envoi serait du gâchis.
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

// Convention de rendu, à la charge de ce module et non du moteur (lib/gabarits.js) : le
// sujet est débarrassé de ses blancs de bord, le corps perd exactement un retour à la
// ligne après l'ouverture du bloc `corps` et un avant sa fermeture — le gabarit les porte
// pour rester lisible en édition, ce ne sont pas des blancs du message.
function rendreCourriel(nom, langue, variables) {
  const compile = chargerGabarit(nom, String(langue || 'fr'));
  const blocs = compile.rendre(variables || {});
  const sujet = String(blocs.sujet || '').trim();
  const corps = String(blocs.corps || '').replace(/^\n/, '').replace(/\n$/, '');
  return { sujet, corps };
}

// ---- Les quatre fabriques, déplacées depuis extension.js ------------------------------

// Les destinataires : toutes les adresses de la fiche, dans l'ordre des auteur·e·s. La
// version finale part à tout le monde, et une fiche sans adresse laisse le champ vide
// plutôt que d'inventer une adresse.
function adressesAuteurs(meta) {
  const vues = [];
  for (const a of ((meta && meta.author) || [])) {
    const v = String((a && a.email) || '').trim();
    // Même forme d'adresse que « Envoyer pour traduction » : une seule règle (archivage.js).
    if (FORME_MAIL.test(v) && vues.indexOf(v) === -1) { vues.push(v); }
  }
  return vues;
}

// Le brouillon : destinataires, sujet et corps. Séparé de son ouverture pour être
// éprouvable sans client de messagerie. La langue est celle de l'article — sa fiche le dit,
// à défaut le numéro — et jamais celle de l'interface : on écrit à un auteur, pas à soi.
// `nomsAuteurs` est optionnel : le gabarit le porte pour un usage futur, aucun texte
// actuel ne s'en sert.
function brouillonAuteur(langue, adresses, titreArticle, titreDuNumero, nomsAuteurs) {
  const rendu = rendreCourriel('envoi-auteur', langue, {
    titre: titreArticle, numero: titreDuNumero, auteurs: nomsAuteurs || [], langue
  });
  return { destinataire: adresses.join(','), sujet: rendu.sujet, corps: rendu.corps };
}

// Langue de l'e-mail : celle de l'équipe qui va traduire, jamais celle de l'interface. Un
// numéro de la Zeitschrift part vers les traducteurs francophones, une Revue vers les
// germanophones ; les gabarits de mail-templates/ nomment la revue et le sens en conséquence.
const LANGUE_MAIL_TRADUCTION = { zeitschrift: 'fr', revue: 'de' };

// Le brouillon : destinataire, sujet et corps, tous trois déduits du seul jeton de revue.
// Séparé de son ouverture pour être éprouvable sans client de messagerie.
function brouillonTraduction(produit, quoi, lien) {
  const langue = LANGUE_MAIL_TRADUCTION[produit] || 'fr';
  const rendu = rendreCourriel('traduction', langue, { quoi, lien, produit, langue });
  return { destinataire: adresseMailTraduction(produit), sujet: rendu.sujet, corps: rendu.corps };
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
  rendreCourriel, adressesAuteurs, brouillonAuteur, brouillonTraduction,
  LANGUE_MAIL_TRADUCTION, uriMailto
};
