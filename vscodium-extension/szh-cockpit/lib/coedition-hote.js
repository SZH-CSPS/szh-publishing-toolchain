// Co-édition côté hôte : les baux que tiennent les panneaux de ce poste. Aucun rappel vers
// l'hôte : les formulaires requièrent ce module directement.
'use strict';

const vscode = require('vscode');
const path = require('path');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const coedition = require('./coedition');

// postMessage tolérant : le panneau peut être fermé pendant le traitement.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// lib/coedition.js pose et lit les baux ; ce module sait quel panneau suit quel fichier,
// ce que valait ce fichier au chargement du formulaire, et comment afficher un refus.
//
// Ordre des gardes : d'abord le verrou du numéro (refuserSiVerrouille ou
// session.etatNumero().verrouillee), ensuite le bail. Un numéro gelé refuse déjà tout.
//
// Le refus s'affiche dans la zone d'état du formulaire et non dans une fenêtre : le
// formulaire enregistre toutes les trois secondes. Le refus du numéro verrouillé fait de même.

// Qui nous sommes pour les autres postes : le réglage szh.nomUtilisateur, sinon le nom de
// session Windows. Relu au changement de réglage (oublierIdentiteCoedition).
function moiCoedition() {
  if (session.identiteCoedition()) { return session.identiteCoedition(); }
  let nom = '';
  try { nom = String(vscode.workspace.getConfiguration('szh').get('nomUtilisateur', '') || ''); }
  catch (e) { /* configuration indisponible */ }
  session.poserIdentiteCoedition(coedition.identite(nom));
  return session.identiteCoedition();
}

function oublierIdentiteCoedition() { session.poserIdentiteCoedition(null); }

// panneau -> Map(clé du fichier -> { racine, chemin, activite, empreinte }).
//
// Une Map et non une WeakMap : après une écriture, l'empreinte est remise à jour dans tous
// les panneaux qui suivent le fichier, ce qui demande de les parcourir. libererCoedition(),
// appelé à la fermeture de chaque panneau, les retire.
const suivisCoedition = new Map();

function suiviCoedition(panneau) {
  if (!panneau) { return null; }
  let suivi = suivisCoedition.get(panneau);
  if (!suivi) { suivi = new Map(); suivisCoedition.set(panneau, suivi); }
  return suivi;
}

// À appeler chaque fois qu'un panneau charge des valeurs : le formulaire montre l'état du
// disque, et le compteur d'inactivité repart. `quand` : l'instant de la lecture, que seuls
// les tests passent, pour antidater une saisie.
function noterLectureCoedition(panneau, racine, chemin, quand) {
  const suivi = suiviCoedition(panneau);
  const clef = racine && chemin ? coedition.clefFichier(racine, chemin) : null;
  if (!suivi || !clef) { return; }
  suivi.set(clef, {
    racine: racine, chemin: chemin,
    activite: quand === undefined ? Date.now() : quand,
    empreinte: coedition.empreinte(chemin)
  });
}

// Après une écriture réussie, tous les suivis de ce fichier reprennent l'empreinte du
// disque : une écriture de ce poste (arbre, commande, autre panneau) ne compte pas comme
// un conflit.
function rafraichirEmpreinteCoedition(racine, chemin) {
  const clef = racine && chemin ? coedition.clefFichier(racine, chemin) : null;
  if (!clef) { return; }
  const fraiche = coedition.empreinte(chemin);
  for (const suivi of suivisCoedition.values()) {
    const etat = suivi.get(clef);
    if (etat) { etat.empreinte = fraiche; }
  }
}

// Demande la main sur un fichier pour ce panneau, et la garde le temps du bail.
//
// -> null quand la main est à nous, sinon { code, message } :
//    'pris'   un autre poste modifie le fichier ; rien ne doit être écrit ;
//    'perime' notre saisie est inactive depuis plus de INACTIVITE_MS et le fichier a changé
//             entre-temps : le formulaire doit être rechargé. Si le fichier n'a pas changé,
//             la main est reprise et l'écriture passe.
//
// `opts.ecriture` : une écriture suit. C'est le seul cas où l'inactivité est vérifiée.
function mainCoedition(panneau, racine, chemin, opts) {
  const o = opts || {};
  const clef = racine && chemin ? coedition.clefFichier(racine, chemin) : null;
  if (!clef) { return null; }                      // hors numéro : rien à protéger
  const maintenant = Date.now();
  const suivi = suiviCoedition(panneau);
  const etat = suivi ? suivi.get(clef) : null;
  const pose = coedition.poser(racine, chemin, moiCoedition(), maintenant);
  if (!pose.ok) {
    return { code: 'pris', titulaire: pose.titulaire.utilisateur,
             message: T('coedition.pris', [pose.titulaire.utilisateur]) };
  }
  if (o.ecriture && etat && maintenant - etat.activite > coedition.INACTIVITE_MS
      && coedition.empreinte(chemin) !== etat.empreinte) {
    return { code: 'perime', titulaire: '', message: T('coedition.perime') };
  }
  if (suivi) {
    suivi.set(clef, {
      racine: racine, chemin: chemin, activite: maintenant,
      empreinte: etat ? etat.empreinte : coedition.empreinte(chemin)
    });
  }
  return null;
}

// Enregistrement complet d'un formulaire : la main, l'écriture, puis l'empreinte remise à
// jour. `ecrire` rend null en cas de succès, sinon son message d'échec brut.
// -> null, ou { code, message } pour la zone d'état ; `code` vaut 'echec' si l'écriture a
//    échoué, 'perime' si le formulaire doit être rechargé.
function ecrireSousMain(panneau, racine, chemin, ecrire) {
  const refus = mainCoedition(panneau, racine, chemin, { ecriture: true });
  if (refus) { return refus; }
  const erreur = ecrire();
  if (erreur) { return { code: 'echec', message: T('err.ecriture', [path.basename(chemin), erreur]) }; }
  rafraichirEmpreinteCoedition(racine, chemin);
  return null;
}

// Bail posé à l'ouverture d'un formulaire dédié à un fichier. Un refus s'affiche sans
// empêcher l'ouverture : les valeurs restent visibles, mais l'enregistrement ne passera pas.
// Les vues multi-articles n'en posent pas à l'ouverture, pour qu'une consultation ne bloque
// pas tout le numéro : le bail s'y prend fiche par fiche, à la première écriture.
function annoncerMain(panneau, racine, chemin) {
  const refus = mainCoedition(panneau, racine, chemin, {});
  if (refus) { repondrePanneau(panneau, { type: MSG.ERREUR, message: refus.message }); }
  return refus;
}

// Pour les actions ponctuelles (déplacer un article, cocher « pas de DOI », geler le
// numéro) : elles consultent le bail sans en poser, un clic isolé n'ayant rien à garder.
// -> null quand la voie est libre, sinon le message à afficher.
function refusCoedition(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const titulaire = coedition.titulaireAutre(racine, chemin, moiCoedition());
  return titulaire ? T('coedition.geste.pris', [titulaire.utilisateur]) : null;
}

// Même garde pour une action sur tout le numéro (archiver, verrouiller) : personne ne doit
// être en train d'y écrire.
function refusCoeditionNumero(racine) {
  if (!racine) { return null; }
  const titulaires = coedition.titulairesDuNumero(racine, moiCoedition());
  return titulaires.length > 0 ? T('coedition.geste.pris', [titulaires[0].utilisateur]) : null;
}

// Panneau fermé : ses baux sont rendus tout de suite, sans attendre leur expiration. Un
// fichier qu'un autre panneau du même poste suit encore n'est pas rendu : les fenêtres d'une
// même personne partagent un seul fichier de bail.
function libererCoedition(panneau) {
  const suivi = suivisCoedition.get(panneau);
  if (!suivi) { return; }
  suivisCoedition.delete(panneau);
  for (const [clef, etat] of suivi) {
    let ailleurs = false;
    for (const autre of suivisCoedition.values()) {
      if (autre.has(clef)) { ailleurs = true; break; }
    }
    if (!ailleurs) { coedition.rendre(etat.racine, etat.chemin, moiCoedition()); }
  }
}

module.exports = {
  moiCoedition, oublierIdentiteCoedition, noterLectureCoedition, rafraichirEmpreinteCoedition,
  mainCoedition, ecrireSousMain, annoncerMain, refusCoedition, refusCoeditionNumero,
  libererCoedition
};
