// Les trois boutons de la barre de titre — Commande, Édition, Export — ouvrent chacun un
// QuickPick qui ne fait qu'appeler des commandes enregistrées ailleurs. Les actions de
// mise en forme viennent de PALETTE_MEF (lib/formatting-pur.js — la part de
// lib/formatting.js qui ne référence pas vscode, importée directement pour ne pas tirer
// tout ce module derrière une simple donnée). Format d'une entrée :
// ['--', cléGroupe] pour un séparateur, sinon [cléLibellé, commande, raccourci, icône].
'use strict';

const vscode = require('vscode');
const { T } = require('./i18n');
const { PALETTE_MEF } = require('./formatting-pur');
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
  // L'aperçu du livre entier n'existe que pour un livre : un chapitre s'aperçoit comme un
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

// Les documents produits, puis le cycle de vie du numéro (ou du livre). Ne figurent que
// les entrées que l'état rend possibles. szh.exporterXml étant facultative, sa présence est
// testée par getCommands.
//
// « Exporter cet article » n'était offert ici que sur un numéro gelé, au motif que la
// compilation automatique s'occupe du reste sur un numéro vivant. Elle s'en occupe à
// l'enregistrement, ce qui n'est pas la même chose que de le demander : on veut refaire le
// PDF d'un seul article sans attendre ni toucher au texte, et sans lancer le numéro entier.
// L'entrée est donc là dans les deux cas — la commande, elle, n'a jamais rien exigé de
// l'état (exporterArticle, extension.js). Elle vise l'article du .md actif, à défaut celui
// en aperçu, et le dit si elle n'en trouve aucun.
//
// Le cycle de vie, lui, vaut pour les deux profils (REVUE_SEULEMENT, plus bas) ;
// suffixeProfil choisit la variante « .livre » des libellés, comme lib/cycle-vie.js le
// fait déjà pour les textes qu'il affiche.
async function ouvrirPanneauExport() {
  const etat = hote.etat();
  const entrees = [['--', 'panneau.g.export'],
                   ['panneau.exporterArticle', 'szh.exporterArticle', '', '$(file-pdf)'],
                   ['panneau.toutExporter', 'szh.toutExporter', '', '$(export)']];
  const commandes = await vscode.commands.getCommands(true);
  if (commandes.indexOf('szh.exporterXml') !== -1) {
    entrees.push(['panneau.exporterXml', 'szh.exporterXml', '', '$(file-code)']);
  }
  // Les quatre sorties du livre : sans objet sur une revue, offertes ici seulement.
  if (hote.profil() === 'livre') {
    entrees.push(
      ['panneau.livreImprimeur', 'szh.livreImprimeur', '', '$(file-pdf)'],
      ['panneau.livreCouverture', 'szh.livreCouverture', '', '$(book)'],
      ['panneau.livreEpub', 'szh.livreEpub', '', '$(package)'],
      ['panneau.livreWeb', 'szh.livreWeb', '', '$(globe)']
    );
  }
  const suffixeProfil = hote.profil() === 'livre' ? '.livre' : '';
  entrees.push(['--', 'panneau.g.cycle' + suffixeProfil]);
  if (!etat.archivee) {
    entrees.push(['panneau.archiver' + suffixeProfil, 'szh.archiverVerrouiller', '', '$(archive)']);
  } else if (!etat.verrouillee) {
    // Gelé puis déverrouillé pour une correction : reste à le reverrouiller. Même
    // commande, qui constate d'elle-même qu'il n'y a plus de dossier à déplacer.
    entrees.push(['panneau.verrouiller' + suffixeProfil, 'szh.archiverVerrouiller', '', '$(lock)']);
  }
  if (etat.verrouillee) {
    entrees.push(['panneau.deverrouiller' + suffixeProfil, 'szh.deverrouiller', '', '$(unlock)']);
  }
  if (etat.archivee) {
    entrees.push(['panneau.desarchiver' + suffixeProfil, 'szh.desarchiver', '', '$(folder-opened)']);
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

// Un livre n'a ni OJS, ni suivi de traduction. Les proposer dans un panneau ouvrirait un
// formulaire vide, ou pire — une commande qui écrit dans un ausgabe.yaml qui n'existe pas.
// On les retire, plutôt que de compter sur la personne pour ne pas cliquer. « Exporter cet
// article »/« Exporter le XML » sont propres à un article de revue ; un livre a ses quatre
// sorties à lui, ajoutées plus haut sans passer par cette liste.
// Le cycle de vie (archiver, verrouiller, désarchiver), en revanche, vaut pour les deux
// profils : un livre publié se fige et se range comme un numéro. windows/archive-revue.ps1
// sait déjà traiter les deux ($estLivre, textes arch.*.livre) ; ouvrirPanneauExport et
// lib/cycle-vie.js portent maintenant les mêmes variantes côté cockpit — ces trois
// commandes ne sont donc plus dans cette liste.
// szh.metadonnees en est sorti (docs/REPRISE-LIVRES.md §2.1a) : buch.yaml a désormais son
// propre formulaire (ouvrirMetadonnees le choisit selon le profil), là où il n'existait
// aucune saisie pour un livre.
const REVUE_SEULEMENT = [
  'szh.apercuMetadonnees', 'szh.traduction',
  'szh.exporterArticle', 'szh.exporterXml'
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
