// SZH cockpit — les trois panneaux de la barre (F1). La barre de titre de la vue ne
// porte plus que trois boutons — Commande / Édition / Export — chacun ouvrant un
// QuickPick localisé, même mécanique que la palette « Mise en forme » (formatting.js).
// Les entrées RÉUTILISENT les commandes déjà enregistrées (aucune logique métier ici) ;
// la liste des actions de mise en forme vient de PALETTE_MEF — source unique, jamais
// dupliquée. Format des entrées : ['--', cléGroupe] = séparateur ; sinon
// [cléLibellé, commande, raccourci, icône].
'use strict';

const vscode = require('vscode');
const { T } = require('./i18n');
const { PALETTE_MEF } = require('./formatting');

// Panneau « Commande » : les gestes de gestion de la revue (import, métadonnées,
// réglages). Libellés : ceux des webviews quand ils existent (meta/fiches/regl.titre).
const PANNEAU_COMMANDE = [
  ['panneau.importerWord', 'szh.importerWord', '', '$(add)'],
  ['panneau.convertirEnAttente', 'szh.convertirEnAttente', '', '$(run-all)'],
  ['meta.titre', 'szh.metadonnees', '', '$(gear)'],
  ['fiches.titre', 'szh.apercuMetadonnees', '', '$(list-flat)'],
  ['trad.titre', 'szh.traduction', '', '$(globe)'],
  ['regl.titre', 'szh.reglages', '', '$(settings-gear)']
];

function itemsDepuisEntrees(entrees) {
  return entrees.map((e) => (e[0] === '--'
    ? { label: T(e[1]), kind: vscode.QuickPickItemKind.Separator }
    : {
        label: (e[3] ? e[3] + ' ' : '') + T(e[0]),
        description: e[2] ? '[' + e[2] + ']' : undefined,
        commande: e[1]
      }));
}

async function choisirEtExecuter(entrees, clePlaceholder) {
  const choix = await vscode.window.showQuickPick(itemsDepuisEntrees(entrees), {
    placeHolder: T(clePlaceholder)
  });
  if (choix && choix.commande) { await vscode.commands.executeCommand(choix.commande); }
}

function ouvrirPanneauCommande() {
  return choisirEtExecuter(PANNEAU_COMMANDE, 'panneau.commande.placeholder');
}

// Panneau « Édition » : la bascule d'aperçu, puis TOUTE la palette de mise en forme.
// Les commandes szh.fmt.* n'ont PAS de garde markdown (elles transforment l'éditeur
// actif, quel qu'il soit) : la garde d'ouvrirMiseEnForme est reprise ici, mais
// seulement pour les entrées de mise en forme. Deux entrées y échappent : la bascule
// d'aperçu, qui doit marcher depuis n'importe où dans la revue, et — depuis D97 — les
// métadonnées de l'article courant, qui savent aussi retrouver l'article affiché en
// aperçu et disent elles-mêmes ce qui manque le cas échéant.
const HORS_GARDE_MD = ['szh.basculerApercu', 'szh.metadonneesArticle', 'szh.traduction'];

async function ouvrirPanneauEdition() {
  const ed = vscode.window.activeTextEditor;
  const estMarkdown = !!(ed && ed.document.languageId === 'markdown');
  const entrees = [
    ['--', 'panneau.g.apercu'],
    ['panneau.basculerApercu', 'szh.basculerApercu', 'Ctrl+Alt+P', '$(preview)'],
    ['--', 'panneau.g.article'],
    ['panneau.metaArticle', 'szh.metadonneesArticle', '', '$(list-flat)'],
    ['panneau.traduction', 'szh.traduction', '', '$(globe)']
  ].concat(PALETTE_MEF);
  const choix = await vscode.window.showQuickPick(itemsDepuisEntrees(entrees), {
    placeHolder: T('panneau.edition.placeholder')
  });
  if (!choix || !choix.commande) { return; }
  if (HORS_GARDE_MD.indexOf(choix.commande) === -1 && !estMarkdown) {
    vscode.window.setStatusBarMessage(T('palette.horsmd'), 3000);
    return;
  }
  await vscode.commands.executeCommand(choix.commande);
}

// Panneau « Export » : rebuild complet, et — si le lot XML est déployé — l'export
// OJS. Test DYNAMIQUE (getCommands) : le panneau marche avant comme après l'arrivée
// de szh.exporterXml, sans dépendre de l'ordre de livraison des lots.
async function ouvrirPanneauExport() {
  const entrees = [['panneau.toutExporter', 'szh.toutExporter', '', '$(export)']];
  const commandes = await vscode.commands.getCommands(true);
  if (commandes.indexOf('szh.exporterXml') !== -1) {
    entrees.push(['panneau.exporterXml', 'szh.exporterXml', '', '$(file-code)']);
  }
  await choisirEtExecuter(entrees, 'panneau.export.placeholder');
}

function enregistrerPanneaux(context) {
  const c = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  c('szh.panneauCommande', () => ouvrirPanneauCommande());
  c('szh.panneauEdition', () => ouvrirPanneauEdition());
  c('szh.panneauExport', () => ouvrirPanneauExport());
}

module.exports = { enregistrerPanneaux };
