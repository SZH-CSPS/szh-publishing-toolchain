// SZH cockpit — mise en forme (M6, D55). Extrait de extension.js (R6). Toggles PURS
// (basculer*/enrober/squelette, testés via _pur) + commandes szh.fmt.* et palette.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { T } = require('./i18n');

// ---- Mise en forme au clic droit + raccourcis (M6, D55) ----------------------------
//
// Sous-menu « Mise en forme » (editor/context, markdown) + raccourcis clavier
// (keybindings.json). Chaque action transforme la SÉLECTION via editor.edit.
// Les transformations sont des fonctions PURES (testées headless via _pur) ;
// les enrobages inline sont des TOGGLES (ré-appliquer retire le marquage).
// Blocs = classes canoniques .important / .highlight / .question ; citation =
// blockquote natif « > » ; le bloc « important » porte un titre paramétrable
// (::: {.important data-titre="…"}), rendu par print.css.

function estEnrobe(t, marqueur) {
  if (t.length < marqueur.length * 2) { return false; }
  if (!t.startsWith(marqueur) || !t.endsWith(marqueur)) { return false; }
  // Italique (*) : ne pas confondre avec gras (**) — sinon « **x** » se dé-graisserait
  // en « *x* » au lieu d'ajouter l'italique.
  if (marqueur === '*' && (t.startsWith('**') || t.endsWith('**'))) { return false; }
  return true;
}

// Toggle **…** (gras) ou *…* (italique) sur la sélection.
function basculerEnrobage(texte, marqueur) {
  const t = String(texte);
  if (estEnrobe(t, marqueur)) { return t.slice(marqueur.length, t.length - marqueur.length); }
  return marqueur + t + marqueur;
}

// Toggle [texte]{.underline} (souligné — attribut natif Pandoc).
function basculerSouligne(texte) {
  const t = String(texte);
  const m = t.match(/^\[([\s\S]*)\]\{\.underline\}$/);
  return m ? m[1] : '[' + t + ']{.underline}';
}

// Toggle de titre : préfixe #/##/### selon `niveau`. Même niveau -> retire ;
// niveau différent -> remplace ; aucun -> ajoute.
function basculerTitre(texte, niveau) {
  const t = String(texte);
  const m = t.match(/^(#{1,6})\s+/);
  if (m && m[1].length === niveau) { return t.replace(/^#{1,6}\s+/, ''); }
  return '#'.repeat(niveau) + ' ' + t.replace(/^#{1,6}\s+/, '');
}

// Toggle de citation : « > » par ligne (blockquote natif). Retire si toutes les
// lignes non vides sont déjà citées.
function basculerCitation(texte) {
  const lignes = String(texte).split('\n');
  const nonVides = lignes.filter((l) => l !== '');
  const toutesCitees = nonVides.length > 0 && nonVides.every((l) => /^>\s?/.test(l));
  if (toutesCitees) { return lignes.map((l) => l.replace(/^>\s?/, '')).join('\n'); }
  return lignes.map((l) => '> ' + l).join('\n');
}

// Enrobe la sélection dans un bloc « fenced div » Pandoc. `titre` (bloc important
// seulement) devient data-titre, rendu par CSS ; les guillemets en sont retirés.
function enroberBloc(texte, classe, titre) {
  const t = String(texte);
  const titrePropre = String(titre || '').replace(/"/g, '').trim();
  const attr = titrePropre ? '{.' + classe + ' data-titre="' + titrePropre + '"}' : '{.' + classe + '}';
  return '::: ' + attr + '\n' + t + '\n:::';
}

// TSV -> tableau Markdown pipe (D57). Ce que Excel/Word mettent dans le
// presse-papiers est du TSV : une ligne par ligne de tableau, cellules séparées
// par des tabulations. Première ligne promue en en-tête (le pipe l'exige, D33) ;
// les tabulations finales ne créent pas de colonne fantôme ; les `|` des cellules
// sont échappés ; les lignes courtes sont complétées. Pure (testée via _pur).
function tsvVersTableau(texte) {
  const lignes = String(texte).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const grille = lignes.map((l) => l.split('\t').map((c) => c.trim().replace(/\|/g, '\\|')));
  const largeur = Math.max.apply(null, grille.map((r) => r.length));
  const remplir = (r) => {
    const copie = r.slice();
    while (copie.length < largeur) { copie.push(''); }
    return '| ' + copie.join(' | ') + ' |';
  };
  const sortie = [remplir(grille[0]), '|' + Array(largeur + 1).join('---|')];
  for (let i = 1; i < grille.length; i++) { sortie.push(remplir(grille[i])); }
  return sortie.join('\n');
}

// Squelette de tableau Markdown (3 colonnes, 2 lignes) — édité ensuite via
// markdowntable (Tab) ou collage Excel (Maj+Alt+V).
function squeletteTableau(colonne) {
  const c = String(colonne || 'Colonne');
  return [
    '| ' + c + ' 1 | ' + c + ' 2 | ' + c + ' 3 |',
    '|---|---|---|',
    '|  |  |  |',
    '|  |  |  |'
  ].join('\n');
}

// Applique `transformer` (fonction pure texte->texte) à la sélection courante.
// opt.parLigne : étend la sélection aux lignes entières (titres, citation).
// opt.milieu : après une insertion sur sélection vide, place le curseur à N
// caractères du début (entre les marqueurs).
async function appliquerSelection(transformer, opt) {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  opt = opt || {};
  const doc = editeur.document;
  let sel = editeur.selection;
  if (opt.parLigne) {
    sel = new vscode.Selection(new vscode.Position(sel.start.line, 0), doc.lineAt(sel.end.line).range.end);
  }
  const texte = doc.getText(sel);
  const vide = texte === '';
  await editeur.edit((b) => { b.replace(sel, transformer(texte)); });
  if (vide && typeof opt.milieu === 'number') {
    const pos = doc.positionAt(doc.offsetAt(sel.start) + opt.milieu);
    editeur.selection = new vscode.Selection(pos, pos);
  }
}

// QuickPick de titres pour le bloc « important » (localisés + saisie libre).
// Retourne undefined si l'utilisateur annule (rien n'est inséré).
async function choisirTitreImportant() {
  const presets = [
    T('fmt.titre.information'), T('fmt.titre.important'),
    T('fmt.titre.attention'), T('fmt.titre.note')
  ];
  const autre = T('fmt.titre.autre');
  const choix = await vscode.window.showQuickPick(presets.concat([autre]), {
    placeHolder: T('fmt.titre.placeholder')
  });
  if (choix === undefined) { return undefined; }
  if (choix !== autre) { return choix; }
  const libre = await vscode.window.showInputBox({ prompt: T('fmt.titre.libre') });
  return libre === undefined ? undefined : libre.trim();
}

async function fmtImportant() {
  const titre = await choisirTitreImportant();
  if (titre === undefined) { return; }               // annulé : rien n'est inséré
  await appliquerSelection((t) => enroberBloc(t, 'important', titre));
}

// Nom de fichier libre dans `dossier` (jamais d'écrasement d'un média existant).
function nomMediaUnique(dossier, nom) {
  const ext = path.extname(nom);
  const base = path.basename(nom, ext);
  let candidat = nom;
  let i = 1;
  while (fs.existsSync(path.join(dossier, candidat))) { candidat = base + '-' + i + ext; i++; }
  return candidat;
}

// Insérer une figure : choisir une image, la copier dans articles/<slug>/media/
// (nom rendu unique), insérer ![Légende](media/nom.ext) à la sélection.
async function fmtFigure() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  if (!/\.md$/i.test(doc.uri.fsPath)) {
    vscode.window.showInformationMessage(T('fmt.figure.horsarticle'));
    return;
  }
  const filtres = {};
  filtres[T('fmt.figure.filtre')] = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false, filters: filtres,
    openLabel: T('fmt.figure.bouton'), title: T('fmt.figure.titre')
  });
  if (!choix || choix.length === 0) { return; }      // dialogue annulé
  const source = choix[0].fsPath;
  const mediaDir = path.join(path.dirname(doc.uri.fsPath), 'media');
  try { fs.mkdirSync(mediaDir, { recursive: true }); } catch (e) { /* existe déjà */ }
  const nom = nomMediaUnique(mediaDir, path.basename(source));
  try { fs.copyFileSync(source, path.join(mediaDir, nom)); }
  catch (e) { vscode.window.showErrorMessage(T('err.copie', [path.basename(source), e.message])); return; }
  const md = '![' + T('fmt.figure.legende') + '](media/' + nom + ')';
  await editeur.edit((b) => { b.replace(editeur.selection, md); });
  vscode.window.setStatusBarMessage(T('fmt.figure.copiee', [nom]), 4000);
}

function fmtTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const sq = squeletteTableau(T('fmt.tableau.colonne'));
  return editeur.edit((b) => { b.replace(editeur.selection, sq); });
}

// Coller un tableau copié depuis Excel/Word (Maj+Alt+V, D57) : lit le
// presse-papiers, le convertit de TSV en tableau pipe et l'insère. Remplace
// csholmq.excel-to-markdown-table, retiré d'Open VSX.
async function fmtCollerTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const presse = await vscode.env.clipboard.readText();
  if (!presse || presse.indexOf('\t') === -1) {
    vscode.window.showInformationMessage(T('fmt.coller.pastableau'));
    return;
  }
  const md = tsvVersTableau(presse);
  await editeur.edit((b) => { b.replace(editeur.selection, md); });
}

// Palette « Mise en forme » (Ctrl+Alt+M + entrée clic droit) : menu SZH-only,
// localisé, raccourci affiché à droite. Réutilise les commandes szh.fmt.*.
// Format : ['--', cléGroupe] = séparateur ; sinon [cléLibellé, commande, raccourci, icône].
const PALETTE_MEF = [
  ['--', 'palette.g.style'],
  ['palette.gras', 'szh.fmt.gras', 'Ctrl+B', '$(bold)'],
  ['palette.italique', 'szh.fmt.italique', 'Ctrl+I', '$(italic)'],
  ['palette.souligne', 'szh.fmt.souligne', 'Ctrl+U', ''],
  ['--', 'palette.g.titres'],
  ['palette.titre1', 'szh.fmt.titre1', 'Ctrl+Alt+1', ''],
  ['palette.titre2', 'szh.fmt.titre2', 'Ctrl+Alt+2', ''],
  ['palette.titre3', 'szh.fmt.titre3', 'Ctrl+Alt+3', ''],
  ['--', 'palette.g.blocs'],
  ['palette.important', 'szh.fmt.important', 'Ctrl+Alt+W', ''],
  ['palette.highlight', 'szh.fmt.highlight', 'Ctrl+Alt+H', ''],
  ['palette.question', 'szh.fmt.question', 'Ctrl+Alt+Q', ''],
  ['palette.citation', 'szh.fmt.citation', 'Ctrl+Alt+C', ''],
  ['--', 'palette.g.inserer'],
  ['palette.figure', 'szh.fmt.figure', 'Ctrl+Alt+F', ''],
  ['palette.tableau', 'szh.fmt.tableau', 'Ctrl+Alt+T', ''],
  ['palette.collerTableau', 'szh.fmt.collerTableau', 'Maj+Alt+V', '']
];

// Ouvre la palette (QuickPick) et applique la commande choisie à la sélection
// courante (l'éditeur .md reste l'éditeur actif pendant la QuickPick).
async function ouvrirMiseEnForme() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.languageId !== 'markdown') {
    vscode.window.setStatusBarMessage(T('palette.horsmd'), 3000);
    return;
  }
  const items = PALETTE_MEF.map((e) => (e[0] === '--'
    ? { label: T(e[1]), kind: vscode.QuickPickItemKind.Separator }
    : { label: (e[3] ? e[3] + ' ' : '') + T(e[0]), description: '[' + e[2] + ']', commande: e[1] }));
  const choix = await vscode.window.showQuickPick(items, { placeHolder: T('palette.placeholder') });
  if (choix && choix.commande) { await vscode.commands.executeCommand(choix.commande); }
}

function enregistrerCommandesMiseEnForme(context) {
  const c = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  c('szh.fmt.gras', () => appliquerSelection((t) => basculerEnrobage(t, '**'), { milieu: 2 }));
  c('szh.fmt.italique', () => appliquerSelection((t) => basculerEnrobage(t, '*'), { milieu: 1 }));
  c('szh.fmt.souligne', () => appliquerSelection((t) => basculerSouligne(t), { milieu: 1 }));
  c('szh.fmt.titre1', () => appliquerSelection((t) => basculerTitre(t, 1), { parLigne: true }));
  c('szh.fmt.titre2', () => appliquerSelection((t) => basculerTitre(t, 2), { parLigne: true }));
  c('szh.fmt.titre3', () => appliquerSelection((t) => basculerTitre(t, 3), { parLigne: true }));
  c('szh.fmt.important', () => fmtImportant());
  c('szh.fmt.highlight', () => appliquerSelection((t) => enroberBloc(t, 'highlight', '')));
  c('szh.fmt.question', () => appliquerSelection((t) => enroberBloc(t, 'question', '')));
  c('szh.fmt.citation', () => appliquerSelection((t) => basculerCitation(t), { parLigne: true }));
  c('szh.fmt.figure', () => fmtFigure());
  c('szh.fmt.tableau', () => fmtTableau());
  c('szh.fmt.collerTableau', () => fmtCollerTableau());
  c('szh.miseEnForme', () => ouvrirMiseEnForme());
}

module.exports = {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, tsvVersTableau, enregistrerCommandesMiseEnForme
};
