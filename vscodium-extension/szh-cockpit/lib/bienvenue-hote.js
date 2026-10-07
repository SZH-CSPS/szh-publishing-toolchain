// La bienvenue d'un poste : l'invitation au tutoriel, une seule fois, et « Quoi de neuf »
// après une mise à jour. Sans rappel vers l'hôte : tout se lit dans globalState et lib/.
'use strict';

const vscode = require('vscode');

const { T, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const profils = require('./profil');
const nouveautes = require('./nouveautes');
const { versionInstallee } = require('./archivage');
const { construireHtml } = require('./webviews/util');
const { panneauUnique } = require('./webviews/panneau');

const CLE_TUTORIEL_VU = 'szh.tutoriel.propose';   // invitation au tutoriel : une seule fois
// Le dernier medium (« 1.1 ») dont ce compte a vu les nouveautés ; une mineure ne
// s'annonce pas. Gardé dans globalState, propre à chaque compte, alors que le toolkit est
// commun à la machine.
const CLE_NOUVEAUTES_VU = 'szh.nouveautes.medium';

// postMessage tolérant : le panneau peut être fermé.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// Propose le tutoriel une seule fois, sur un numéro ouvert : la page d'accueil de l'éditeur
// est désactivée et la barre d'activités masquée, le tutoriel serait sinon introuvable.
//
// Pas de tutoriel pour un livre. Le `when` du walkthrough dans package.json ne suffit pas :
// il ne filtre que la page « Get Started », et `workbench.action.openWalkthrough` appelé par
// son id (commande szh.tutoriel) ouvre le tutoriel sans lire aucun contexte. D'où la garde
// sur la capacité `tutoriel` du profil.
async function proposerTutoriel(context) {
  try {
    if (!profils.courant().capacites.tutoriel) { return; }
    if (context.globalState.get(CLE_TUTORIEL_VU)) { return; }
    await context.globalState.update(CLE_TUTORIEL_VU, true);
    const ouvrir = T('tuto.invite.bouton');
    const choix = await vscode.window.showInformationMessage(T('tuto.invite'), ouvrir);
    if (choix === ouvrir) { await vscode.commands.executeCommand('szh.tutoriel'); }
  } catch (e) { /* invitation ratée : la commande et l'icône restent */ }
}

// ---- « Quoi de neuf » ------------------------------------------------------------
// Après une mise à jour qui change de medium, une fois par compte et par medium. Le texte
// vient de nouveautes.json, à la racine du toolkit, écrit pour la rédaction en fr et en de.

function htmlNouveautes(nonce) {
  return construireHtml('nouveautes', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'], titre: T('nouv.titre')
  });
}

function valeursNouveautes(medium) {
  const installee = versionInstallee();
  return {
    type: MSG.VALEURS,
    titre: T('nouv.titre'),
    version: installee ? T('nouv.version', [installee]) : '',
    notes: nouveautes.notesPour(medium, langueCockpit()),
    i18n: { rien: T('nouv.rien') }
  };
}

// `medium` : le dernier medium déjà vu ; la fenêtre montre les notes qui le suivent.
// Ouverte à la main, elle reçoit le medium installé et montre la note de cette version.
function montrerNouveautes(medium) {
  // Sans modeTrad : voir PANNEAUX_SANS_MODE_TRAD (test/js/mode-trad.test.js).
  const { panneau, nouveau } = panneauUnique({
    viewType: 'szhNouveautes', titre: T('nouv.titre'),
    html: htmlNouveautes,
    surPret: (recu, p) => repondrePanneau(p, valeursNouveautes(medium)),
    surMessage: (recu) => { console.warn('nouveautés : type de message inconnu', recu.type); }
  });
  if (!nouveau) { repondrePanneau(panneau, valeursNouveautes(medium)); }
}

// Propose les nouveautés par une notification ; la fenêtre ne s'ouvre que si on accepte.
// Le medium est enregistré dans tous les cas, refus compris : la question n'est posée
// qu'une fois.
async function proposerNouveautes(context) {
  try {
    const installe = nouveautes.mediumInstalle();
    if (!installe) { return; }                       // version illisible, ou poste de dev
    const vu = String(context.globalState.get(CLE_NOUVEAUTES_VU) || '');
    if (vu === installe) { return; }
    // Aucun medium vu : sur un compte neuf (tutoriel jamais proposé), l'invitation au
    // tutoriel suffit et le medium s'enregistre sans rien montrer. Un tutoriel déjà proposé
    // signale un compte qui travaillait avant la mise à jour : il reçoit la note.
    const dejaLa = Boolean(context.globalState.get(CLE_TUTORIEL_VU));
    if (!vu && !dejaLa) { await context.globalState.update(CLE_NOUVEAUTES_VU, installe); return; }
    if (nouveautes.notesPour(vu, langueCockpit()).length === 0) {
      await context.globalState.update(CLE_NOUVEAUTES_VU, installe);
      return;
    }
    await context.globalState.update(CLE_NOUVEAUTES_VU, installe);
    const ouvrir = T('nouv.invite.bouton');
    const choix = await vscode.window.showInformationMessage(T('nouv.invite'), ouvrir);
    if (choix === ouvrir) { montrerNouveautes(vu); }
  } catch (e) { /* invitation ratée : la commande du panneau reste */ }
}

module.exports = { proposerTutoriel, proposerNouveautes, montrerNouveautes, CLE_TUTORIEL_VU, CLE_NOUVEAUTES_VU };
