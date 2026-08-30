// Les trois boutons de la barre de titre — Commande, Édition, Export — ouvrent chacun un
// QuickPick qui ne fait qu'appeler des commandes enregistrées ailleurs. Les actions de
// mise en forme viennent de PALETTE_MEF (formatting.js). Format d'une entrée :
// ['--', cléGroupe] pour un séparateur, sinon [cléLibellé, commande, raccourci, icône].
'use strict';

const vscode = require('vscode');
const { T } = require('./i18n');
const { PALETTE_MEF } = require('./formatting');
// Un QuickPick se ferme dès que le focus bouge : la garde retient, tant qu'un panneau est
// ouvert, ce qui le lui volerait (rafraîchissement d'aperçu, avis de fin de compilation).
const { sousGarde } = require('./interaction');

const PANNEAU_COMMANDE = [
  ['panneau.tutoriel', 'szh.tutoriel', '', '$(mortar-board)'],
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
    ? { label: T(e[1]), kind: vscode.QuickPickItemKind.Separator }
    : {
        label: (e[3] ? e[3] + ' ' : '') + T(e[0]),
        description: e[2] ? '[' + e[2] + ']' : undefined,
        commande: e[1]
      }));
}

async function choisirEtExecuter(entrees, clePlaceholder) {
  // Seul le choix est sous garde : la commande choisie, elle, peut rafraîchir ce qu'elle veut.
  const choix = await sousGarde(() => vscode.window.showQuickPick(itemsDepuisEntrees(entrees), {
    placeHolder: T(clePlaceholder)
  }));
  if (choix && choix.commande) { await vscode.commands.executeCommand(choix.commande); }
}

function ouvrirPanneauCommande() {
  return choisirEtExecuter(pourProfil(PANNEAU_COMMANDE), 'panneau.commande.placeholder');
}

// Les commandes szh.fmt.* transforment l'éditeur actif quel qu'il soit et n'ont pas de
// garde markdown : le panneau « Édition » la pose pour elles. Y échappent les entrées qui
// doivent marcher depuis n'importe où, ou qui retrouvent seules leur article.
const HORS_GARDE_MD = ['szh.basculerApercu', 'szh.metadonneesArticle', 'szh.mediasArticle',
                       'szh.traduction'];

async function ouvrirPanneauEdition() {
  const ed = vscode.window.activeTextEditor;
  const estMarkdown = !!(ed && ed.document.languageId === 'markdown');
  // L'aperçu du LIVRE entier n'existe que pour un livre : un chapitre s'aperçoit comme un
  // article, mais la pagination, le sommaire et ses numéros de page n'ont de sens
  // qu'une fois tous les chapitres assemblés.
  const apercuLivre = hote.profil() === 'livre'
    ? [['panneau.apercuLivre', 'szh.apercuLivre', '', '$(book)']]
    : [];
  const entrees = [
    ['--', 'panneau.g.apercu'],
    ['panneau.basculerApercu', 'szh.basculerApercu', 'Ctrl+Alt+P', '$(preview)']
  ].concat(apercuLivre).concat([
    ['--', 'panneau.g.article'],
    ['panneau.metaArticle', 'szh.metadonneesArticle', '', '$(list-flat)'],
    ['panneau.mediasArticle', 'szh.mediasArticle', '', '$(file-media)'],
    ['panneau.lierReference', 'szh.lierReference', '', '$(references)'],
    ['panneau.traduction', 'szh.traduction', '', '$(globe)']
  ]).concat(PALETTE_MEF);
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

// Les documents produits, puis le cycle de vie du numéro. Ne figurent que les entrées que
// l'état du numéro rend possibles : « Exporter cet article » n'apparaît que sur un numéro
// gelé, où la compilation automatique est coupée. szh.exporterXml étant facultative, sa
// présence est testée par getCommands.
async function ouvrirPanneauExport() {
  const etat = hote.etat();
  const entrees = [['--', 'panneau.g.export']];
  if (etat.archivee || etat.verrouillee) {
    entrees.push(['panneau.exporterArticle', 'szh.exporterArticle', '', '$(file-pdf)']);
  }
  entrees.push(['panneau.toutExporter', 'szh.toutExporter', '', '$(export)']);
  const commandes = await vscode.commands.getCommands(true);
  if (commandes.indexOf('szh.exporterXml') !== -1) {
    entrees.push(['panneau.exporterXml', 'szh.exporterXml', '', '$(file-code)']);
  }
  entrees.push(['--', 'panneau.g.cycle']);
  if (!etat.archivee) {
    entrees.push(['panneau.archiver', 'szh.archiverVerrouiller', '', '$(archive)']);
  } else if (!etat.verrouillee) {
    // Numéro archivé puis déverrouillé pour une correction : reste à le reverrouiller.
    // Même commande, qui constate d'elle-même qu'il n'y a plus de dossier à déplacer.
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

// État du numéro injecté par extension.js, qui le tient d'ausgabe.yaml. Sans hôte, le
// repli neutre laisse les panneaux fonctionner sans cycle de vie.
let hote = {
  etat: () => ({ verrouillee: false, archivee: false }),
  // ⚠ Repli sur « revue » : sans injection, les panneaux se comportent exactement comme
  //   avant. C'est ce qui rend ce changement sûr pour la revue.
  profil: () => 'revue'
};

// Un livre n'a ni OJS, ni suivi de traduction, ni archivage de numéro. Les proposer dans un
// panneau ouvrirait un formulaire vide, ou pire — une commande qui écrit dans un
// ausgabe.yaml qui n'existe pas. On les retire, plutôt que de compter sur la personne pour
// ne pas cliquer.
const REVUE_SEULEMENT = [
  'szh.metadonnees', 'szh.apercuMetadonnees', 'szh.traduction',
  'szh.exporterArticle', 'szh.exporterXml',
  'szh.archiverVerrouiller', 'szh.deverrouiller', 'szh.desarchiver'
];

function pourProfil(entrees) {
  if (hote.profil() !== 'livre') { return entrees; }
  return entrees.filter((e) => e[0] === '--' || REVUE_SEULEMENT.indexOf(e[1]) === -1);
}

function enregistrerPanneaux(context, injecte) {
  if (injecte) { hote = Object.assign({}, hote, injecte); }
  const c = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  c('szh.panneauCommande', () => ouvrirPanneauCommande());
  c('szh.panneauEdition', () => ouvrirPanneauEdition());
  c('szh.panneauExport', () => ouvrirPanneauExport());
}

module.exports = { enregistrerPanneaux };
