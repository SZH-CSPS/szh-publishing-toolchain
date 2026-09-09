// Mise en forme : les bascules pures (basculer*, enrober, squelette), les commandes
// szh.fmt.* et la palette qui les rassemble. Contient aussi le seul accès au
// presse-papiers HTML, par PowerShell ; la transformation, elle, est pure et vit dans
// lib/table-model.js.
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
// Un QuickPick ou une InputBox se ferme dès que le focus bouge : la garde retient, tant
// qu'un choix est ouvert, ce qui le lui volerait (rafraîchissement d'aperçu, avis de fin
// de compilation).
const { sousGarde } = require('./interaction');
// La part de ce module qui ne référence pas `vscode` : bascules de texte, pose des blocs
// :::, squelettes de tableau, noms de fichiers sûrs, et la palette. Réexportée plus bas
// pour qu'aucun appelant actuel (extension.js, les tests) n'ait à changer d'import.
const formattingPur = require('./formatting-pur');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  attrBloc, enroberBloc, CLASSES_BLOCS, blocAutour, poserBloc,
  squeletteTableau, tableauVierge, nomMediaUnique, nomTableLibre,
  blocReferenceTable, blocSautPage, noteBasPage, PALETTE_MEF
} = formattingPur;

// Contexte de la revue, injecté par extension.js à l'enregistrement des commandes plutôt
// que requis, extension.js requérant déjà ce module. On réutilise ainsi sa définition
// d'« est-ce un article » et son rafraîchissement.
let revue = {
  racine: () => null,
  slugDepuisChemin: () => null,
  rafraichirTout: () => {},
  // Sur un numéro gelé, toute mise en forme est refusée : l'éditeur est en lecture seule
  // et un WorkspaceEdit y échouerait sans dire pourquoi.
  verrouillee: () => false,
  // Refus visible, injecté par extension.js : message et bouton « Déverrouiller ».
  refuser: () => { vscode.window.setStatusBarMessage(T('verrou.refuse'), 4000); },
  // Conversion des JPEG CMJN, injectée : elle passe par la WSL, que ce module ignore.
  convertirCmyk: () => Promise.resolve(0)
};

// ---- Mise en forme au clic droit et aux raccourcis ----
//
// Chaque action transforme la sélection via editor.edit à partir d'une fonction pure ;
// les enrobages en ligne sont des bascules. Les blocs sont les classes .important,
// .highlight et .question, la citation un blockquote « > », et le bloc « important »
// porte un titre paramétrable que rend print.css. Les fonctions pures (basculer*,
// attrBloc, enroberBloc…) vivent maintenant dans lib/formatting-pur.js, importées plus
// haut ; ce qui suit ne fait qu'appliquer l'éditeur sur ce qu'elles calculent.


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

// Applique poserBloc au document de l'éditeur actif. Contrairement à appliquerSelection,
// le remplacement porte sur des lignes entières : la place des lignes vides et la
// détection d'un bloc existant se lisent dans le document, pas dans la seule sélection.
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
  // Curseur dans le bloc, en fin de contenu : on y tape la suite, et y refrapper la
  // commande met le bloc à jour au lieu d'en insérer un second en dessous.
  const pos = new vscode.Position(r.curseur.ligne, r.curseur.colonne);
  editeur.selection = new vscode.Selection(pos, pos);
}

async function choisirTitreImportant() {
  // Une seule garde englobe le QuickPick ET l'InputBox d'« Autre titre… » : entre les
  // deux, rien ne doit se rejouer qui déplacerait le focus avant la saisie libre.
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
  if (titre === undefined) { return; }               // annulé : rien n'est inséré
  await appliquerBlocClasse('important', titre);
}

// Copie l'image choisie sous articles/<slug>/media/, insère ![Légende](media/nom.ext) à
// la sélection, puis ouvre le gestionnaire des médias sur cette image : le moment d'écrire
// texte alternatif et crédits est celui où l'on choisit l'image.
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
  if (!choix || choix.length === 0) { return; }      // dialogue annulé
  const source = choix[0].fsPath;
  const mediaDir = path.join(path.dirname(doc.uri.fsPath), 'media');
  try { fs.mkdirSync(mediaDir, { recursive: true }); } catch (e) { /* existe déjà */ }
  const nom = nomMediaUnique(mediaDir, path.basename(source));
  try { fs.copyFileSync(source, path.join(mediaDir, nom)); }
  catch (e) { vscode.window.showErrorMessage(T('err.copie', [path.basename(source), e.message])); return; }
  // Avant l'insertion : la conversion réécrit le fichier sous le même nom.
  try { await revue.convertirCmyk([path.join(mediaDir, nom)]); } catch (e) { /* signalé côté hôte */ }
  const md = '![' + T('fmt.figure.legende') + '](media/' + nom + ')';
  await editeur.edit((b) => { b.replace(editeur.selection, md); });
  vscode.window.setStatusBarMessage(T('fmt.figure.copiee', [nom]), 4000);
  if (!slug) { return; }                             // hors article : pas de formulaire à ouvrir
  // Enregistrer avant de partir vers le formulaire : sinon la référence reste dans le
  // tampon et l'aperçu se recompile sans la figure.
  try { await doc.save(); } catch (e) { /* fichier verrouillé : la référence reste au tampon */ }
  revue.rafraichirTout();
  // Le gestionnaire des médias, positionné sur l'image qui vient d'être insérée : c'est
  // là que s'écrivent sa légende, son texte alternatif et ses crédits.
  await vscode.commands.executeCommand('szh.mediasArticle', { slug: slug, focus: nom });
}

// ---- Insérer un tableau ----
//
// Le tableau inséré est un vrai tableau de la revue : un fichier
// articles/<slug>/tables/table-NN.html et la référence ::: {.szh-tabelle src="…"} au
// curseur, sur lequel s'ouvre l'éditeur de tableau. Même mécanique que le collage, la
// source du modèle près : ici, une grille vierge. Le pipe Markdown, lui, ne survit pas à
// la mise en forme du PDF.

async function fmtTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const racine = revue.racine();
  const slug = racine ? revue.slugDepuisChemin(racine, doc.uri.fsPath) : null;
  if (!slug) {
    // Hors article, il n'y a pas de dossier tables/ où écrire : on insère le squelette
    // Markdown, en le disant, pour que le résultat différent ne surprenne pas.
    const sq = squeletteTableau(T('fmt.tableau.colonne'));
    await editeur.edit((b) => { b.replace(editeur.selection, sq); });
    vscode.window.setStatusBarMessage(T('fmt.tableau.markdown'), 5000);
    return;
  }
  const dossier = path.join(path.dirname(doc.uri.fsPath), 'tables');
  const nom = nomTableLibre(dossier);                // premier libre : jamais d'écrasement
  try {
    fs.mkdirSync(dossier, { recursive: true });
    ecrireAtomique(path.join(dossier, nom), serialiserTable(tableauVierge(T('fmt.tableau.colonne'))));
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    return;
  }
  const sel = editeur.selection;
  const avant = doc.lineAt(sel.start.line).text.slice(0, sel.start.character);
  const apres = doc.lineAt(sel.end.line).text.slice(sel.end.character);
  await editeur.edit((b) => { b.replace(sel, blocReferenceTable(nom, avant, apres)); });
  // Enregistrer avant de partir vers l'éditeur de tableau : sinon la référence reste dans
  // le tampon et l'aperçu se recompile sans le tableau. Le collage, lui, laisse la main
  // dans le texte et n'a pas besoin d'enregistrer.
  try { await doc.save(); } catch (e) { /* fichier verrouillé : la référence reste au tampon */ }
  vscode.window.setStatusBarMessage(T('fmt.tableau.creee', [nom]), 5000);
  revue.rafraichirTout();                            // le tableau apparaît sous l'article
  await vscode.commands.executeCommand('szh.editerTable', { slug: slug, cheminAsset: path.join(dossier, nom) });
}

// ---- Coller un tableau depuis Excel ou Word ----
//
// Le collage écrit lui aussi un articles/<slug>/tables/table-NN.html et une référence
// ::: {.szh-tabelle src="…"} dans le .md, que résout à la compilation
// pipeline/filters/szh-tabelle-inclure.lua.
//
// Les cellules fusionnées ne survivent que par la variante HTML du presse-papiers
// Windows, que l'API de VS Code ne sait pas lire mais que PowerShell atteint.

function cheminPowerShell() {
  const systeme = path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'powershell.exe';
}

// Script de lecture du presse-papiers HTML.
//
// ⚠ Piège d'encodage vérifié : les octets CF_HTML déposés par Excel et Word sont de
// l'UTF-8, mais .NET Framework les rend déjà décodés dans la page de codes ANSI, et
// « Élèves — Zürich » revient en « Ã‰lÃ¨ves â€” ZÃ¼rich ». On ré-encode donc la chaîne
// dans cette page pour retrouver les octets d'origine, puis on les décode en UTF-8 avec
// un décodeur strict : si l'échec survient, c'est que la chaîne n'avait pas été mal
// décodée et on la garde telle quelle. Un vrai flux d'octets passe par la branche Stream.
//
// [Console]::Out.Write plutôt que Write-Output : sur une sortie redirigée, le formateur
// de PowerShell couperait les chaînes longues et casserait le HTML.
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

// Variante HTML du presse-papiers, en-tête CF_HTML comprise, ou chaîne vide. Ne rejette
// pas : tout échec rend une chaîne vide et l'appelant se replie sur le TSV.
// -EncodedCommand, en UTF-16LE base64, évite tout échappement de guillemets.
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

async function fmtSautPage() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const ligne = editeur.document.lineAt(editeur.selection.active.line).text;
  const col = editeur.selection.active.character;
  const texte = blocSautPage(ligne.slice(0, col), ligne.slice(col));
  await editeur.edit((b) => { b.replace(editeur.selection, texte); });
}

// Insère l'appel [^n] à la fin de la sélection (ou au curseur) et pose sa définition
// [^n]:  en fin de document — voir noteBasPage (lib/formatting-pur.js) pour le choix de
// cette forme plutôt que la note inline ^[…]. Même mécanique qu'appliquerBlocClasse : les
// lignes du document sont lues ici, la fonction pure calcule la plage à remplacer, et le
// curseur est posé en fin de la ligne de définition — c'est là que la personne écrit sa note.
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
    vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    return;
  }
  const sel = editeur.selection;
  const avant = doc.lineAt(sel.start.line).text.slice(0, sel.start.character);
  const apres = doc.lineAt(sel.end.line).text.slice(sel.end.character);
  await editeur.edit((b) => { b.replace(sel, blocReferenceTable(nom, avant, apres)); });
  vscode.window.setStatusBarMessage(T('fmt.coller.creee', [nom]), 5000);
  revue.rafraichirTout();                            // le tableau apparaît sous l'article
}

// ---- Lier un appel de citation à une référence ----
//
// Le liage se fait tout seul à la compilation (pipeline/filters/szh-citations.lua). Cette
// action ne sert qu'aux appels que le filtre laisse de côté : nom mal orthographié dans le
// texte, parenthèse déséquilibrée, ou ambiguïté entre deux références de même auteur et de
// même année. Le rédacteur place le curseur dans l'appel — ou le sélectionne — choisit la
// référence, et l'appel devient un lien markdown que pandoc rend nativement.
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
  // Les ancres de références sortent des tables de repli du filtre du pipeline. Sans elles
  // — outil de composition absent, ou plus ancien que le cockpit — on ne pose rien : un lien
  // vers une ancre que la compilation ne produira pas est pire que pas de lien. Le rédacteur
  // lit une phrase qu'il peut suivre, le détail technique est déjà dans le journal de l'hôte.
  //
  // La source, c'est d'abord le fichier de bibliographie que l'import détache désormais —
  // même repli que lecteurReferences() dans lib/export-ojs.js. Le .md de l'article ne porte
  // plus que le marqueur ::: {.szh-biblio …} ; on ne retombe sur le corps du texte que pour
  // un article importé avant que la bibliographie devienne un fichier à part.
  let entrees;
  try {
    entrees = citations.referencesDuFichier(racine, slug);
    if (entrees === null) { entrees = citations.referencesDuTexte(doc.getText()); }
  } catch (e) {
    if (!e || !e.szhRepli) { throw e; }
    // Le sélecteur de versions vit dans le toolkit : il n'y a rien à proposer quand c'est le
    // toolkit entier qui manque. Sur une discordance, il reste juste dans les deux sens —
    // il sert autant à avancer qu'à reculer.
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
  // Sélection vide : on prend l'appel autour du curseur, parenthèse ou lien déjà posé.
  let plage = editeur.selection;
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
  const items = PALETTE_MEF.map((e) => (e[0] === '--'
    ? { label: T(e[1]), kind: vscode.QuickPickItemKind.Separator }
    : { label: (e[3] ? e[3] + ' ' : '') + T(e[0]), description: '[' + e[2] + ']', commande: e[1] }));
  const choix = await sousGarde(() =>
    vscode.window.showQuickPick(items, { placeHolder: T('palette.placeholder') }));
  if (choix && choix.commande) { await vscode.commands.executeCommand(choix.commande); }
}

function enregistrerCommandesMiseEnForme(context, hote) {
  if (hote) { revue = Object.assign({}, revue, hote); }
  // Garde de verrou posée à l'enregistrement : chaque commande écrit dans le texte de
  // l'article et n'a donc pas de sens sur un numéro gelé.
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
  c('szh.fmt.tableau', () => fmtTableau());
  c('szh.fmt.collerTableau', () => fmtCollerTableau());
  c('szh.fmt.sautPage', () => fmtSautPage());
  c('szh.lierReference', () => fmtLierReference());
  c('szh.miseEnForme', () => ouvrirMiseEnForme());
}

module.exports = {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, poserBloc, blocAutour, CLASSES_BLOCS,
  squeletteTableau, tableauVierge, blocReferenceTable, blocSautPage, noteBasPage, nomTableLibre,
  lireHtmlPressePapiers, enregistrerCommandesMiseEnForme, PALETTE_MEF
};
