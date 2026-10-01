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

// lib/coedition.js pose le bail et sait le lire ; ici vit ce qu'il ne peut pas savoir :
// quel panneau tient quel fichier, ce que ce fichier valait quand le formulaire l'a
// chargé, et comment le refus s'affiche.
//
// ⚠ L'ordre des gardes ne change jamais : le verrou du numéro d'abord — refuserSiVerrouille
// ou session.etatNumero().verrouillee, qui parlent d'un numéro gelé —, le bail de co-édition ensuite.
// Un numéro gelé refuse déjà tout, il n'a aucune co-édition à raconter.
//
// Le refus part dans la zone d'état du formulaire, jamais en fenêtre : l'enregistrement est
// automatique toutes les trois secondes, et une fenêtre à cette cadence serait pire que le
// refus lui-même. Même choix, et même raison, que le refus du numéro verrouillé.

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
// Une Map et non une WeakMap : après une écriture, l'empreinte doit être remise à jour dans
// tous les panneaux qui suivent le fichier, ce qui demande de pouvoir les parcourir. D'où
// libererCoedition(), appelé par le onDidDispose de chaque panneau concerné — sans lui, un
// panneau fermé resterait retenu ici.
const suivisCoedition = new Map();

function suiviCoedition(panneau) {
  if (!panneau) { return null; }
  let suivi = suivisCoedition.get(panneau);
  if (!suivi) { suivi = new Map(); suivisCoedition.set(panneau, suivi); }
  return suivi;
}

// Le formulaire vient de lire le fichier : ce qu'il montre est ce que le disque dit, et le
// compteur d'inactivité repart. À appeler à chaque fois qu'un panneau charge des valeurs.
// `quand` : l'instant de la lecture, pour qu'un test puisse antidater une saisie sans
// attendre cinq minutes ; l'hôte ne le passe jamais.
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

// Après une écriture réussie : tous les suivis de ce fichier repartent de l'empreinte du
// disque. C'est ce qui évite de crier au conflit quand c'est nous qui avons écrit — un
// « Monter » dans l'arbre, une commande, un autre panneau du même poste : tous touchent
// ausgabe.yaml sans passer par le formulaire qui l'affiche.
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
//    'pris'   un autre poste modifie le fichier ; rien ne doit être écrit
//    'perime' notre saisie a dormi plus de cinq minutes ET le fichier a changé entre-temps.
//             Le formulaire montre donc autre chose que le disque : il faut le recharger et
//             refaire la saisie. Si le fichier n'a pas changé, la main est simplement
//             reprise et l'écriture passe — faire refaire une saisie que personne n'a
//             contredite serait une punition sans objet.
//
// `opts.ecriture` : une écriture suit. C'est le seul cas où l'inactivité est vérifiée ;
// à l'ouverture d'un formulaire, il n'y a encore rien à écraser.
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

// Le geste complet d'un formulaire : la main, l'écriture, puis l'empreinte remise à jour.
// `ecrire` rend null en cas de succès, sinon son message d'échec brut.
// -> null, ou { code, message } prêt à partir dans la zone d'état ; `code` vaut 'echec'
//    quand c'est l'écriture elle-même qui a échoué, et 'perime' quand le formulaire doit
//    être rechargé.
function ecrireSousMain(panneau, racine, chemin, ecrire) {
  const refus = mainCoedition(panneau, racine, chemin, { ecriture: true });
  if (refus) { return refus; }
  const erreur = ecrire();
  if (erreur) { return { code: 'echec', message: T('err.ecriture', [path.basename(chemin), erreur]) }; }
  rafraichirEmpreinteCoedition(racine, chemin);
  return null;
}

// Bail posé à l'ouverture d'un formulaire dédié à un fichier : l'ouvrir, c'est venir le
// modifier. Le refus s'affiche sans empêcher l'ouverture — on voit les valeurs, on est
// seulement prévenu que l'enregistrement ne passera pas. Rien n'est posé sur les vues
// multi-articles : y ouvrir une vue d'ensemble prendrait la main sur tout le numéro, et une
// consultation gèlerait le travail des autres. Là, le bail se prend fiche par fiche, à la
// première écriture.
function annoncerMain(panneau, racine, chemin) {
  const refus = mainCoedition(panneau, racine, chemin, {});
  if (refus) { repondrePanneau(panneau, { type: MSG.ERREUR, message: refus.message }); }
  return refus;
}

// Les gestes sans session de saisie — déplacer un article, cocher « pas de DOI », geler le
// numéro : ils regardent le bail, ils n'en posent pas. Un clic isolé n'a pas de main à
// garder, et prendre un bail pour trois millisecondes ne protégerait personne.
// -> null quand la voie est libre, sinon le message à afficher.
function refusCoedition(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const titulaire = coedition.titulaireAutre(racine, chemin, moiCoedition());
  return titulaire ? T('coedition.geste.pris', [titulaire.utilisateur]) : null;
}

// Même garde, pour un geste qui touche tout le numéro (archiver, verrouiller) : personne ne
// doit être en train d'y écrire.
function refusCoeditionNumero(racine) {
  if (!racine) { return null; }
  const titulaires = coedition.titulairesDuNumero(racine, moiCoedition());
  return titulaires.length > 0 ? T('coedition.geste.pris', [titulaires[0].utilisateur]) : null;
}

// Panneau fermé : les baux sont rendus tout de suite, sans attendre les deux minutes. Un
// fichier qu'un autre panneau du même poste suit encore n'est pas rendu : deux fenêtres de
// la même personne partagent un seul fichier de bail.
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
