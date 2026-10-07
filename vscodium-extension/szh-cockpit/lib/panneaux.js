// Les trois boutons de la barre de titre (Commande, Édition, Export) ouvrent chacun un
// QuickPick qui appelle des commandes enregistrées ailleurs. Les actions de mise en forme
// viennent de PALETTE_MEF (lib/formatting-pur.js). Format d'une entrée :
// ['--', cléGroupe] pour un séparateur, sinon [cléLibellé, commande, raccourci, icône].
'use strict';

const vscode = require('vscode');
const { T, TP } = require('./i18n');
const profils = require('./profil');
const { PALETTE_MEF, PALETTE_MEF_LIVRE } = require('./formatting-pur');
// Un QuickPick se ferme dès que le focus bouge : tant qu'un panneau est ouvert, la garde
// retient ce qui prendrait le focus (rafraîchissement d'aperçu, avis de fin de compilation).
const { sousGarde } = require('./interaction');

const PANNEAU_COMMANDE = [
  ['panneau.tutoriel', 'szh.tutoriel', '', '$(mortar-board)'],
  ['nouv.titre', 'szh.nouveautes', '', '$(megaphone)'],
  ['panneau.importerWord', 'szh.importerWord', '', '$(add)'],
  ['panneau.convertirEnAttente', 'szh.convertirEnAttente', '', '$(run-all)'],
  ['meta.titre', 'szh.metadonnees', '', '$(gear)'],
  ['fiches.titre', 'szh.apercuMetadonnees', '', '$(list-flat)'],
  ['trad.titre', 'szh.traduction', '', '$(globe)'],
  ['ctl.titre', 'szh.vueControles', '', '$(checklist)'],
  ['regl.titre', 'szh.reglages', '', '$(settings-gear)']
];

function itemsDepuisEntrees(entrees) {
  return entrees.map((e) => (e[0] === '--'
    ? { label: TP(e[1], hote.profil()), kind: vscode.QuickPickItemKind.Separator }
    : {
        label: (e[3] ? e[3] + ' ' : '') + TP(e[0], hote.profil()),
        description: e[2] ? '[' + e[2] + ']' : undefined,
        // Second niveau du QuickPickItem, facultatif (5e élément de l'entrée) : les options
        // d'un style qui n'en pose qu'une partie dans le snippet (palette.qrLink.detail).
        detail: e[4] ? T(e[4]) : undefined,
        commande: e[1]
      }));
}

async function choisirEtExecuter(entrees, clePlaceholder) {
  // La garde ne couvre que le choix, pas l'exécution de la commande choisie.
  const choix = await sousGarde(() => vscode.window.showQuickPick(itemsDepuisEntrees(entrees), {
    placeHolder: T(clePlaceholder)
  }));
  if (choix && choix.commande) { await vscode.commands.executeCommand(choix.commande); }
}

function ouvrirPanneauCommande() {
  return choisirEtExecuter(pourProfil(PANNEAU_COMMANDE), 'panneau.commande.placeholder');
}

// Les commandes szh.fmt.* agissent sur l'éditeur actif quel qu'il soit : le panneau
// « Édition » vérifie pour elles qu'il s'agit d'un .md. Sauf les entrées ci-dessous, qui
// marchent depuis n'importe où ou retrouvent seules leur article.
const HORS_GARDE_MD = ['szh.basculerApercu', 'szh.metadonneesArticle', 'szh.mediasArticle',
                       'szh.traduction'];

async function ouvrirPanneauEdition() {
  const ed = vscode.window.activeTextEditor;
  const estMarkdown = !!(ed && ed.document.languageId === 'markdown');
  // L'aperçu du livre entier, pour un livre seulement : la pagination et le sommaire
  // demandent tous les chapitres assemblés.
  const apercuLivre = capacites().sortiesLivre
    ? [['panneau.apercuLivre', 'szh.apercuLivre', '', '$(book)']]
    : [];
  const entrees = [
    ['--', 'panneau.g.apercu'],
    ['panneau.basculerApercu', 'szh.basculerApercu', 'Ctrl+Alt+P', '$(preview)']
  ].concat(apercuLivre).concat([
    ['--', 'panneau.g.article'],
    ['panneau.metaArticle', 'szh.metadonneesArticle', '', '$(list-flat)'],
    ['panneau.mediasArticle', 'szh.mediasArticle', '', '$(file-media)'],
    ['panneau.editerTable', 'szh.editerTable', '', '$(table)'],
    ['panneau.lierReference', 'szh.lierReference', '', '$(references)'],
    ['panneau.traduction', 'szh.traduction', '', '$(globe)']
  ]).concat(PALETTE_MEF)
    // Groupe « Livre » (falc-header, qr-link), pour un livre seulement ; mêmes commandes
    // qu'au clic droit (ouvrirMiseEnForme, lib/formatting.js).
    .concat(capacites().paletteLivre ? PALETTE_MEF_LIVRE : []);
  const choix = await sousGarde(() => vscode.window.showQuickPick(itemsDepuisEntrees(pourProfil(entrees)), {
    placeHolder: T('panneau.edition.placeholder')
  }));
  if (!choix || !choix.commande) { return; }
  if (HORS_GARDE_MD.indexOf(choix.commande) === -1 && !estMarkdown) {
    vscode.window.setStatusBarMessage(T('palette.horsmd'), 3000);
    return;
  }
  await vscode.commands.executeCommand(choix.commande);
}

// Les documents produits, puis le cycle de vie du numéro (ou du livre), selon ce que l'état
// permet. szh.exporterXml est facultative : sa présence est testée par getCommands.
//
// « Exporter cet article » est offert quel que soit l'état : il refait le PDF d'un seul
// article sans toucher au texte. Il vise l'article du .md actif, sinon celui en aperçu.
//
// Le cycle de vie vaut pour les deux profils ; ses libellés prennent leur variante
// « .livre » par TP (itemsDepuisEntrees), comme ceux de lib/cycle-vie.js.
async function ouvrirPanneauExport() {
  const etat = hote.etat();
  const entrees = [['--', 'panneau.g.export'],
                   ['panneau.exporterArticle', 'szh.exporterArticle', '', '$(file-pdf)'],
                   ['panneau.toutExporter', 'szh.toutExporter', '', '$(export)'],
                   // Retirée d'un livre par pourProfil (szh.peut.pagination).
                   ['action.pagination', 'szh.rafraichirPagination', '', '$(list-ordered)']];
  const commandes = await vscode.commands.getCommands(true);
  if (commandes.indexOf('szh.exporterXml') !== -1) {
    entrees.push(['panneau.exporterXml', 'szh.exporterXml', '', '$(file-code)']);
  }
  // Les quatre sorties du livre.
  if (capacites().sortiesLivre) {
    entrees.push(
      ['panneau.livreImprimeur', 'szh.livreImprimeur', '', '$(file-pdf)'],
      ['panneau.livreCouverture', 'szh.livreCouverture', '', '$(book)'],
      ['panneau.livreEpub', 'szh.livreEpub', '', '$(package)'],
      ['panneau.livreWeb', 'szh.livreWeb', '', '$(globe)']
    );
  }
  entrees.push(['--', 'panneau.g.cycle']);
  if (!etat.archivee) {
    entrees.push(['panneau.archiver', 'szh.archiverVerrouiller', '', '$(archive)']);
  } else if (!etat.verrouillee) {
    // Gelé puis déverrouillé pour une correction : reste à le reverrouiller, par la même
    // commande, qui voit qu'il n'y a plus de dossier à déplacer.
    entrees.push(['panneau.verrouiller', 'szh.archiverVerrouiller', '', '$(lock)']);
  }
  if (etat.verrouillee) {
    entrees.push(['panneau.deverrouiller', 'szh.deverrouiller', '', '$(unlock)']);
  }
  if (etat.archivee) {
    entrees.push(['panneau.desarchiver', 'szh.desarchiver', '', '$(folder-opened)']);
  }
  await choisirEtExecuter(pourProfil(entrees), 'panneau.export.placeholder');
}

// État du numéro, injecté par extension.js depuis ausgabe.yaml. Sans hôte, les panneaux
// fonctionnent sans cycle de vie.
let hote = {
  etat: () => ({ verrouillee: false, archivee: false }),
  // Sans injection, profil « revue ».
  profil: () => 'revue'
};

function capacites() { return (profils.profilPour(hote.profil()) || profils.PROFILS.revue).capacites; }

// La capacité qui réserve une commande à un profil, lue dans le `when` szh.peut.<capacité>
// de sa ligne commandPalette : le panneau masque ce que la palette masque.
const CAPACITE_DE_COMMANDE = {};
for (const e of require('../package.json').contributes.menus.commandPalette) {
  const m = /^szh\.peut\.(\w+)$/.exec(e.when || '');
  if (m) { CAPACITE_DE_COMMANDE[e.command] = m[1]; }
}

function pourProfil(entrees) {
  const cap = capacites();
  const gardees = entrees.filter((e) => e[0] === '--' || !CAPACITE_DE_COMMANDE[e[1]]
    || cap[CAPACITE_DE_COMMANDE[e[1]]]);
  if (hote.profil() !== 'livre') { return gardees; }
  // Le formulaire de buch.yaml se nomme « Métadonnées du livre », pas « du numéro ».
  return gardees.map((e) => (e[1] === 'szh.metadonnees' ? ['meta.livre.panneau'].concat(e.slice(1)) : e));
}

function enregistrerPanneaux(context, injecte) {
  if (injecte) { hote = Object.assign({}, hote, injecte); }
  const c = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  c('szh.panneauCommande', () => ouvrirPanneauCommande());
  c('szh.panneauEdition', () => ouvrirPanneauEdition());
  c('szh.panneauExport', () => ouvrirPanneauExport());
}

module.exports = { enregistrerPanneaux };
