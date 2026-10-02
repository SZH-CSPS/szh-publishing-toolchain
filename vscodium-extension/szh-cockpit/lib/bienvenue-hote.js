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
// Le dernier MEDIUM dont cette personne a vu les nouveautés (« 1.1 »), et non la version
// complète : une mineure ne s'annonce pas, sans quoi la fenêtre s'ouvrirait deux fois par
// jour. globalState et non un fichier du poste : le toolkit est commun à la machine, mais
// « l'ai-je lu ? » est propre à chaque compte.
const CLE_NOUVEAUTES_VU = 'szh.nouveautes.medium';

// postMessage tolérant : le panneau peut être fermé.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// Une seule fois, et seulement sur un numéro ouvert : la page d'accueil de l'éditeur est
// désactivée par nos réglages, et la barre d'activités masquée — sans cette invitation,
// le tutoriel n'existerait que pour qui pense à le chercher.
//
// ⚠ Aucun tutoriel pour un livre (le `when` du walkthrough dans package.json ne suffit
// pas ici : il ne filtre que ce qui apparaît dans la page d'accueil « Get Started »,
// jamais un `workbench.action.openWalkthrough` appelé par son id, comme le fait
// la commande szh.tutoriel d'extension.js — vérifié dans le workbench installé, sa
// commande ouvre l'éditeur sans lire aucun contexte). Sans cette garde ici, la seule invitation
// ouvrirait quand même les neuf pas d'une revue sur un livre qui n'a ni articles-word/
// ni traductions.
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
// La fenêtre s'ouvre seule après une mise à jour qui a changé de MEDIUM, une fois par
// personne et par medium ; une mineure ne dit jamais rien. Le texte vient de
// nouveautes.json, livré à la racine du toolkit, et il est écrit pour la rédaction — pas
// de CHANGELOG.md, qui nomme des fonctions et n'existe qu'en français.

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

// $medium : ce que la personne avait déjà vu. La fenêtre ouverte à la main depuis le
// panneau de commande passe le medium installé — elle montre alors la note du jour, et non
// tout ce qui a été manqué.
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

// Rien n'est montré sans un clic : la fenêtre s'ouvre seule, mais elle ne s'ouvre qu'après
// une invitation acceptée — une page qui surgit par-dessus le travail en cours se ferme
// sans être lue. Le medium est enregistré dans tous les cas, refus compris : reposer la
// question à chaque ouverture de numéro serait pire que de ne rien dire.
async function proposerNouveautes(context) {
  try {
    const installe = nouveautes.mediumInstalle();
    if (!installe) { return; }                       // version illisible, ou poste de dev
    const vu = String(context.globalState.get(CLE_NOUVEAUTES_VU) || '');
    if (vu === installe) { return; }
    // Personne n'a encore rien vu. Sur un poste NEUF, tout est nouveau et l'invitation au
    // tutoriel dit déjà ce qu'il faut : on enregistre en silence. Sur un poste qui tournait
    // avant cette version, le tutoriel a déjà été proposé — c'est le seul signe fiable que
    // quelqu'un travaillait ici avant la mise à jour, et c'est à lui qu'on doit la note.
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
