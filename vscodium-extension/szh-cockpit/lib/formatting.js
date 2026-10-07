// Commandes de mise en forme szh.fmt.* et palette du clic droit. Les transformations de
// texte sont dans lib/formatting-pur.js. Ce module lit aussi le presse-papiers HTML, par
// PowerShell, pour coller un tableau.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { T } = require('./i18n');
const { tableauDepuisHtmlBureautique, tableauDepuisTsv, serialiserTable } = require('./table-model');
const citations = require('./citations');
const { lancerChoixVersion } = require('./archivage');
const { ecrireAtomique } = require('./yaml');
const { cheminSysteme } = require('./poste');
// Un QuickPick ou une InputBox se ferme dès que le focus bouge. sousGarde retarde ce qui
// le volerait (rafraîchissement d'aperçu, avis de fin de compilation) tant qu'un choix est
// ouvert.
const { sousGarde } = require('./interaction');
const formattingPur = require('./formatting-pur');
const { nomImageAssaini } = require('./medias');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  attrBloc, enroberBloc, CLASSES_BLOCS, blocAutour, poserBloc,
  squeletteTableau, tableauVierge, nomMediaUnique, nomTableLibre,
  blocReferenceTable, blocSautPage, noteBasPage, normaliserUrl, lienMarkdown, PALETTE_MEF,
  langueLivre, texteFalcHeader, TEXTE_QR_LINK, PALETTE_MEF_LIVRE, PALETTE_CLIC_DROIT,
  insererBlocIsole, BLOC_SAUT_PAGE, blocTableSeul
} = formattingPur;

// Contexte fourni par extension.js à l'enregistrement des commandes (extension.js requiert
// déjà ce module). Les valeurs par défaut sont inoffensives.
let revue = {
  racine: () => null,
  slugDepuisChemin: () => null,
  rafraichirTout: () => {},
  // Numéro gelé : l'éditeur est en lecture seule et une édition y échouerait sans message.
  verrouillee: () => false,
  // Refus visible : message et bouton « Déverrouiller ».
  refuser: () => { vscode.window.setStatusBarMessage(T('verrou.refuse'), 4000); },
  // Conversion des JPEG CMJN, qui passe par la WSL.
  convertirCmyk: () => Promise.resolve(0),
  // 'revue' ou 'livre' : le groupe « Livre » de la palette n'apparaît que pour un livre.
  profil: () => 'revue'
};

// ---- Mise en forme au clic droit et aux raccourcis ----
//
// Chaque commande applique à la sélection une fonction de lib/formatting-pur.js. Les
// enrobages en ligne sont des bascules. Le bloc « important » porte un titre au choix,
// que rend print.css.


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

// Applique poserBloc à l'éditeur actif. Le remplacement porte sur des lignes entières,
// car les lignes vides voisines et le bloc englobant se lisent dans tout le document.
async function appliquerBlocClasse(classe, titre) {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const sel = editeur.selection;
  const lignes = [];
  for (let i = 0; i < doc.lineCount; i++) { lignes.push(doc.lineAt(i).text); }
  const r = poserBloc(lignes, {
    debutLigne: sel.start.line, debutCol: sel.start.character,
    finLigne: sel.end.line, finCol: sel.end.character
  }, classe, titre);
  const plage = new vscode.Range(r.ligneDebut, 0, r.ligneFin, lignes[r.ligneFin].length);
  const ok = await editeur.edit((b) => { b.replace(plage, r.texte); });
  if (!ok) { return; }
  const pos = new vscode.Position(r.curseur.ligne, r.curseur.colonne);
  editeur.selection = new vscode.Selection(pos, pos);
}

async function choisirTitreImportant() {
  // Une seule garde couvre le QuickPick et l'InputBox d'« Autre titre… », pour que rien
  // ne déplace le focus entre les deux.
  return sousGarde(async () => {
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
  });
}

async function fmtImportant() {
  const titre = await choisirTitreImportant();
  if (titre === undefined) { return; }
  await appliquerBlocClasse('important', titre);
}

// Copie l'image choisie dans articles/<slug>/media/, insère ![Légende](media/nom.ext),
// puis ouvre le gestionnaire des médias sur cette image pour saisir alt et crédits.
async function fmtFigure() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  if (!/\.md$/i.test(doc.uri.fsPath)) {
    vscode.window.showInformationMessage(T('fmt.figure.horsarticle'));
    return;
  }
  const racine = revue.racine();
  const slug = racine ? revue.slugDepuisChemin(racine, doc.uri.fsPath) : null;
  const filtres = {};
  filtres[T('fmt.figure.filtre')] = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false, filters: filtres,
    openLabel: T('fmt.figure.bouton'), title: T('fmt.figure.titre')
  });
  if (!choix || choix.length === 0) { return; }
  const source = choix[0].fsPath;
  const mediaDir = path.join(path.dirname(doc.uri.fsPath), 'media');
  try { fs.mkdirSync(mediaDir, { recursive: true }); } catch (e) { /* existe déjà */ }
  // Nom assaini (minuscules, sans espace ni accent) : le Makefile liste media/ dans les
  // prérequis du PDF, et make coupe un nom aux espaces (« No rule to make target »).
  const nomSur = nomImageAssaini(path.basename(source));
  if (!nomSur) { vscode.window.showErrorMessage(T('importv.err.format')); return; }
  const nom = nomMediaUnique(mediaDir, nomSur);
  try { fs.copyFileSync(source, path.join(mediaDir, nom)); }
  catch (e) { vscode.window.showErrorMessage(T('err.copie', [path.basename(source), e.message])); return; }
  // La conversion CMJN réécrit le fichier sous le même nom.
  try { await revue.convertirCmyk([path.join(mediaDir, nom)]); } catch (e) { /* signalé côté hôte */ }
  const md = '![' + T('fmt.figure.legende') + '](media/' + nom + ')';
  await editeur.edit((b) => { b.replace(editeur.selection, md); });
  vscode.window.setStatusBarMessage(T('fmt.figure.copiee', [nom]), 4000);
  if (!slug) { return; }
  // Enregistré avant d'ouvrir le formulaire, pour que l'aperçu se recompile avec la figure.
  try { await doc.save(); } catch (e) { /* fichier verrouillé : la référence reste au tampon */ }
  revue.rafraichirTout();
  await vscode.commands.executeCommand('szh.mediasArticle', { slug: slug, focus: nom });
}

// ---- Insérer un tableau ----
//
// Crée articles/<slug>/tables/table-NN.html (une grille vierge), pose la référence
// ::: {.szh-tabelle src="…"} au curseur et ouvre l'éditeur de tableau. Un tableau
// Markdown à barres verticales ne se met pas en forme correctement dans le PDF.

async function fmtTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const racine = revue.racine();
  const slug = racine ? revue.slugDepuisChemin(racine, doc.uri.fsPath) : null;
  if (!slug) {
    // Hors article, pas de dossier tables/ : on insère un tableau Markdown et on le signale.
    const sq = squeletteTableau(T('fmt.tableau.colonne'));
    await editeur.edit((b) => { b.replace(editeur.selection, sq); });
    vscode.window.setStatusBarMessage(T('fmt.tableau.markdown'), 5000);
    return;
  }
  const dossier = path.join(path.dirname(doc.uri.fsPath), 'tables');
  const nom = nomTableLibre(dossier);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    ecrireAtomique(path.join(dossier, nom), serialiserTable(tableauVierge(T('fmt.tableau.colonne'))));
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [nom, e.message]));
    return;
  }
  await poserBlocIsole(editeur, blocTableSeul(nom));
  // Enregistré avant d'ouvrir l'éditeur de tableau, pour que l'aperçu se recompile avec
  // le tableau.
  try { await doc.save(); } catch (e) { /* fichier verrouillé : la référence reste au tampon */ }
  vscode.window.setStatusBarMessage(T('fmt.tableau.creee', [nom]), 5000);
  revue.rafraichirTout();
  await vscode.commands.executeCommand('szh.editerTable', { slug: slug, cheminAsset: path.join(dossier, nom) });
}

// ---- Coller un tableau depuis Excel ou Word ----
//
// Écrit un tables/table-NN.html et sa référence ::: {.szh-tabelle src="…"}, comme
// l'insertion. Les cellules fusionnées ne se trouvent que dans la variante HTML du
// presse-papiers, que l'API de VS Code ne lit pas : on passe par PowerShell, avec un
// repli sur le texte tabulé.

function cheminPowerShell() {
  const systeme = cheminSysteme('WindowsPowerShell', 'v1.0', 'powershell.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'powershell.exe';
}

// Script PowerShell de lecture du presse-papiers HTML.
//
// Excel et Word déposent du CF_HTML en UTF-8, mais .NET Framework le rend décodé en page
// de codes ANSI (« Élèves » devient « Ã‰lÃ¨ves »). Le script ré-encode la chaîne en ANSI
// et la décode en UTF-8 strict ; si ce décodage échoue, la chaîne était juste et reste
// telle quelle. Un flux d'octets passe par la branche Stream.
//
// [Console]::Out.Write et non Write-Output, qui couperait les longues lignes sur une
// sortie redirigée.
const PS_LIRE_HTML_PRESSE = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$t = ""',
  '$o = [System.Windows.Forms.Clipboard]::GetDataObject()',
  'if ($o -and $o.GetDataPresent("HTML Format")) {',
  '  $d = $o.GetData("HTML Format", $false)',
  '  if ($d -is [System.IO.Stream]) {',
  '    $d.Position = 0',
  '    $r = New-Object System.IO.StreamReader($d, (New-Object System.Text.UTF8Encoding $false))',
  '    $t = $r.ReadToEnd()',
  '  } elseif ($d -ne $null) {',
  '    $t = [string]$d',
  '    $ansi = [System.Text.Encoding]::GetEncoding([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.ANSICodePage)',
  '    $strict = New-Object System.Text.UTF8Encoding($false, $true)',
  '    try { $t = $strict.GetString($ansi.GetBytes($t)) } catch { }',
  '  }',
  '}',
  '[Console]::Out.Write($t)'
].join('\n');

// Variante HTML du presse-papiers, en-tête CF_HTML comprise. Tout échec rend une chaîne
// vide. -EncodedCommand (UTF-16LE en base64) évite d'échapper les guillemets.
function lireHtmlPressePapiers(timeoutMs) {
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand',
      Buffer.from(PS_LIRE_HTML_PRESSE, 'utf16le').toString('base64')];
    let proc;
    try { proc = spawn(cheminPowerShell(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { resolve(''); return; }
    const morceaux = [];
    let fini = false, minuteur = null;
    const finir = (v) => { if (fini) { return; } fini = true; if (minuteur) { clearTimeout(minuteur); } resolve(v); };
    minuteur = setTimeout(() => { try { proc.kill(); } catch (e) { /* déjà mort */ } finir(''); },
      timeoutMs || 8000);
    proc.stdout.on('data', (d) => morceaux.push(d));
    proc.on('error', () => finir(''));
    proc.on('close', () => finir(Buffer.concat(morceaux).toString('utf8')));
  });
}

// Pose un bloc ::: isolé (insererBlocIsole, lib/formatting-pur.js) à la fin de la
// sélection, dont le texte reste en place. Avec `snippet`, le bloc porte des champs ${n}
// à parcourir au Tab, et le texte qui l'entoure est échappé.
async function poserBlocIsole(editeur, bloc, snippet) {
  const doc = editeur.document;
  const point = editeur.selection.end || editeur.selection.active;
  const lignes = [];
  for (let i = 0; i < doc.lineCount; i++) { lignes.push(doc.lineAt(i).text); }
  const marque = '\u0000BLOC\u0000';
  const r = insererBlocIsole(lignes, { ligne: point.line, colonne: point.character }, marque);
  const plage = new vscode.Range(r.ligneDebut, 0, r.ligneFin, doc.lineAt(r.ligneFin).text.length);
  const [avant, apres] = r.texte.split(marque);
  if (snippet) {
    const echapper = (t) => t.replace(/[$}\\]/g, '\\$&');
    await editeur.insertSnippet(new vscode.SnippetString(echapper(avant) + bloc + echapper(apres)), plage);
  } else {
    await editeur.edit((b) => { b.replace(plage, avant + bloc + apres); });
  }
}

async function fmtSautPage() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  await poserBlocIsole(editeur, BLOC_SAUT_PAGE);
}

// ---- Livre : en-tête de chapitre FALC et code QR ----
//
// Deux snippets, proposés seulement pour le profil livre (PALETTE_MEF_LIVRE,
// lib/formatting-pur.js).
async function fmtFalcHeader() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const langue = langueLivre(revue.racine());
  await poserBlocIsole(editeur, texteFalcHeader(langue, T('fmt.falcHeader.alt')), true);
}

async function fmtQrLink() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  await poserBlocIsole(editeur, TEXTE_QR_LINK, true);
}

// Insère l'appel [^n] et sa définition en fin de document (noteBasPage,
// lib/formatting-pur.js), puis pose le curseur sur la définition.
async function fmtNoteBasPage() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const sel = editeur.selection;
  const lignes = [];
  for (let i = 0; i < doc.lineCount; i++) { lignes.push(doc.lineAt(i).text); }
  const r = noteBasPage(lignes, {
    debutLigne: sel.start.line, debutCol: sel.start.character,
    finLigne: sel.end.line, finCol: sel.end.character
  });
  const plage = new vscode.Range(r.ligneDebut, 0, r.ligneFin, lignes[r.ligneFin].length);
  const ok = await editeur.edit((b) => { b.replace(plage, r.texte); });
  if (!ok) { return; }
  const pos = new vscode.Position(r.curseur.ligne, r.curseur.colonne);
  editeur.selection = new vscode.Selection(pos, pos);
  vscode.window.setStatusBarMessage(T('fmt.note.retour'), 8000);
}

// Demande l'adresse et fait de la sélection le texte du lien : [sélection](adresse).
// Sans sélection, l'adresse saisie sert de texte et reste sélectionnée, prête à être
// remplacée. La saisie est préremplie par la sélection si c'est une adresse, sinon par
// le presse-papiers s'il en contient une.
async function fmtLien() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const sel = editeur.selection;
  const texteSel = sel.isEmpty ? '' : doc.getText(sel);
  let propose = texteSel && normaliserUrl(texteSel) && !/\s/.test(texteSel.trim()) ? texteSel.trim() : '';
  if (!propose) {
    try {
      const presse = String(await vscode.env.clipboard.readText() || '').trim();
      if (presse && !/\s/.test(presse) && normaliserUrl(presse)) { propose = presse; }
    } catch (e) { /* presse-papiers illisible : on propose le schéma seul */ }
  }
  const saisie = await sousGarde(() => vscode.window.showInputBox({
    prompt: T('fmt.lien.prompt'),
    value: propose || 'https://',
    validateInput: (v) => (normaliserUrl(v) ? null : T('fmt.lien.invalide'))
  }));
  if (saisie === undefined) { return; }
  const url = normaliserUrl(saisie);
  if (!url) { return; }
  // Une sélection qui n'était que l'adresse garde l'adresse lisible comme texte, sans
  // le https:// ajouté.
  const texte = texteSel && texteSel.trim() !== propose ? texteSel : saisie.trim();
  const lien = lienMarkdown(texte, url);
  const ok = await editeur.edit((b) => { b.replace(sel, lien); });
  if (!ok || texteSel) { return; }
  // Sélectionne le texte du lien, entre « [ » et « ](adresse) ».
  const col = sel.start.character + 1;
  editeur.selection = new vscode.Selection(new vscode.Position(sel.start.line, col),
    new vscode.Position(sel.start.line, col + lien.length - url.length - 4));
}

async function fmtCollerTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const racine = revue.racine();
  const slug = racine ? revue.slugDepuisChemin(racine, doc.uri.fsPath) : null;
  if (!slug) {
    vscode.window.showInformationMessage(T('fmt.coller.horsarticle'));
    return;
  }
  const brut = await lireHtmlPressePapiers();
  let modele = brut ? tableauDepuisHtmlBureautique(brut) : null;
  if (!modele) {
    const texte = await vscode.env.clipboard.readText();
    if (texte && texte.indexOf('\t') !== -1) { modele = tableauDepuisTsv(texte); }
  }
  if (!modele) {
    vscode.window.showInformationMessage(T('fmt.coller.pastableau'));
    return;
  }
  const dossier = path.join(path.dirname(doc.uri.fsPath), 'tables');
  const nom = nomTableLibre(dossier);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    ecrireAtomique(path.join(dossier, nom), serialiserTable(modele));
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [nom, e.message]));
    return;
  }
  await poserBlocIsole(editeur, blocTableSeul(nom));
  vscode.window.setStatusBarMessage(T('fmt.coller.creee', [nom]), 5000);
  revue.rafraichirTout();
}

// ---- Lier un appel de citation à une référence ----
//
// pipeline/filters/szh-citations.lua lie les appels à la compilation. Cette commande
// traite ceux qu'il ne lie pas (nom mal orthographié, parenthèse déséquilibrée, deux
// références de même auteur et même année) : l'appel sous le curseur devient un lien
// Markdown vers la référence choisie.
async function fmtLierReference() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const racine = revue.racine();
  const slug = racine ? revue.slugDepuisChemin(racine, doc.uri.fsPath) : null;
  if (!slug) {
    vscode.window.showInformationMessage(T('cit.horsarticle'));
    return;
  }
  // Les ancres viennent des tables de repli du filtre du pipeline. Si le pipeline manque
  // ou est plus ancien que le cockpit, rien n'est posé : l'ancre n'existerait pas.
  //
  // Les références se lisent dans le fichier de bibliographie de l'article, sinon dans le
  // texte du .md (même repli que lecteurReferences(), lib/export-ojs.js).
  let entrees;
  try {
    entrees = citations.referencesDuFichier(racine, slug);
    if (entrees === null) { entrees = citations.referencesDuTexte(doc.getText()); }
  } catch (e) {
    if (!e || !e.szhRepli) { throw e; }
    // Le sélecteur de versions fait partie du toolkit : il n'est proposé que sur une
    // discordance de versions, pas quand le toolkit manque.
    if (e.szhRepli !== 'discordant') {
      vscode.window.showErrorMessage(T(e.messageCle));
      return;
    }
    const bouton = T('version.divergence.bouton');
    const choix = await vscode.window.showErrorMessage(T(e.messageCle), bouton);
    if (choix === bouton) {
      const echec = lancerChoixVersion();
      if (echec) { vscode.window.showErrorMessage(T('err.version.lancement', [echec])); }
    }
    return;
  }
  if (entrees.length === 0) {
    vscode.window.showInformationMessage(T('cit.aucuneref'));
    return;
  }
  // Sélection vide : l'appel autour du curseur (parenthèse ou lien déjà posé). Un mot
  // sélectionné dans la parenthèse s'étend à tout l'appel.
  let plage = editeur.selection;
  if (!plage.isEmpty && plage.start.line === plage.end.line
      && doc.getText(plage).indexOf('(') === -1) {
    const ligne = doc.lineAt(plage.start.line);
    const bornes = citations.plageDeLAppel(ligne.text, plage.start.character);
    if (bornes && bornes.debut <= plage.start.character && bornes.fin >= plage.end.character) {
      plage = new vscode.Range(plage.start.line, bornes.debut, plage.start.line, bornes.fin);
    }
  }
  if (plage.isEmpty) {
    const ligne = doc.lineAt(plage.active.line);
    const bornes = citations.plageDeLAppel(ligne.text, plage.active.character);
    if (!bornes) {
      vscode.window.showInformationMessage(T('cit.selection'));
      return;
    }
    plage = new vscode.Range(plage.active.line, bornes.debut, plage.active.line, bornes.fin);
  }
  const appel = doc.getText(plage);
  const choix = await sousGarde(() => vscode.window.showQuickPick(
    entrees.map((e, i) => ({
      label: String(i + 1).padStart(2, '0') + '. ' + e.texte.slice(0, 96),
      description: e.id,
      detail: e.texte.length > 96 ? e.texte.slice(96, 220) : undefined,
      id: e.id
    })),
    { placeHolder: T('cit.placeholder', [appel.trim()]), matchOnDescription: true,
      matchOnDetail: true }));
  if (!choix) { return; }
  await editeur.edit((b) => {
    b.replace(plage, citations.lienVersReference(appel, choix.id));
  });
  vscode.window.setStatusBarMessage(T('cit.fait', [choix.id]), 5000);
}

async function ouvrirMiseEnForme() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.languageId !== 'markdown') {
    vscode.window.setStatusBarMessage(T('palette.horsmd'), 3000);
    return;
  }
  // Groupe « Livre » pour un livre seulement, comme pourProfil (lib/panneaux.js).
  const entrees = PALETTE_CLIC_DROIT.concat(revue.profil() === 'livre' ? PALETTE_MEF_LIVRE : []);
  const items = entrees.map((e) => (e[0] === '--'
    ? { label: T(e[1]), kind: vscode.QuickPickItemKind.Separator }
    : {
        label: (e[3] ? e[3] + ' ' : '') + T(e[0]),
        description: e[2] ? '[' + e[2] + ']' : undefined,
        detail: e[4] ? T(e[4]) : undefined,
        commande: e[1]
      }));
  const choix = await sousGarde(() =>
    vscode.window.showQuickPick(items, { placeHolder: T('palette.placeholder') }));
  if (choix && choix.commande) { await vscode.commands.executeCommand(choix.commande); }
}

function enregistrerCommandesMiseEnForme(context, hote) {
  if (hote) { revue = Object.assign({}, revue, hote); }
  // Chaque commande écrit dans l'article : toutes sont refusées sur un numéro gelé.
  const c = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, () => {
    if (revue.verrouillee()) { return revue.refuser(); }
    return fn();
  }));
  c('szh.fmt.gras', () => appliquerSelection((t) => basculerEnrobage(t, '**'), { milieu: 2 }));
  c('szh.fmt.italique', () => appliquerSelection((t) => basculerEnrobage(t, '*'), { milieu: 1 }));
  c('szh.fmt.souligne', () => appliquerSelection((t) => basculerSouligne(t), { milieu: 1 }));
  c('szh.fmt.titre1', () => appliquerSelection((t) => basculerTitre(t, 1), { parLigne: true }));
  c('szh.fmt.titre2', () => appliquerSelection((t) => basculerTitre(t, 2), { parLigne: true }));
  c('szh.fmt.titre3', () => appliquerSelection((t) => basculerTitre(t, 3), { parLigne: true }));
  c('szh.fmt.important', () => fmtImportant());
  c('szh.fmt.highlight', () => appliquerBlocClasse('highlight', ''));
  c('szh.fmt.question', () => appliquerBlocClasse('question', ''));
  c('szh.fmt.citation', () => appliquerSelection((t) => basculerCitation(t), { parLigne: true }));
  c('szh.fmt.figure', () => fmtFigure());
  c('szh.fmt.noteBasPage', () => fmtNoteBasPage());
  c('szh.fmt.lien', () => fmtLien());
  c('szh.fmt.tableau', () => fmtTableau());
  c('szh.fmt.collerTableau', () => fmtCollerTableau());
  c('szh.fmt.sautPage', () => fmtSautPage());
  // Enregistrées pour tous les profils, mais présentes dans les menus du livre seulement.
  c('szh.fmt.falcHeader', () => fmtFalcHeader());
  c('szh.fmt.qrLink', () => fmtQrLink());
  c('szh.lierReference', () => fmtLierReference());
  c('szh.miseEnForme', () => ouvrirMiseEnForme());
}

module.exports = {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, poserBloc, blocAutour, CLASSES_BLOCS,
  squeletteTableau, tableauVierge, blocReferenceTable, blocSautPage, noteBasPage, nomTableLibre,
  lireHtmlPressePapiers, enregistrerCommandesMiseEnForme, PALETTE_MEF
};
