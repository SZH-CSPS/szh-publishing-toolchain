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
const { cheminSysteme } = require('./poste');
// Un QuickPick ou une InputBox se ferme dès que le focus bouge : la garde retient, tant
// qu'un choix est ouvert, ce qui le lui volerait (rafraîchissement d'aperçu, avis de fin
// de compilation).
const { sousGarde } = require('./interaction');
// La part de ce module qui ne référence pas `vscode` : bascules de texte, pose des blocs
// :::, squelettes de tableau, noms de fichiers sûrs, et la palette. Réexportée plus bas
// pour qu'aucun appelant actuel (extension.js, les tests) n'ait à changer d'import.
const formattingPur = require('./formatting-pur');
// lib/medias.js ne référence pas vscode non plus ; il requiert formatting-pur, pas ce module.
const { nomImageAssaini } = require('./medias');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  attrBloc, enroberBloc, CLASSES_BLOCS, blocAutour, poserBloc,
  squeletteTableau, tableauVierge, nomMediaUnique, nomTableLibre,
  blocReferenceTable, blocSautPage, noteBasPage, normaliserUrl, lienMarkdown, PALETTE_MEF,
  langueLivre, texteFalcHeader, TEXTE_QR_LINK, PALETTE_MEF_LIVRE, PALETTE_CLIC_DROIT,
  insererBlocIsole, BLOC_SAUT_PAGE, blocTableSeul
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
  convertirCmyk: () => Promise.resolve(0),
  // Le profil actif ('revue' ou 'livre') : le groupe « Livre » de la palette (falc-header,
  // qr-link) ne s'ajoute que pour un livre — même repli que lib/panneaux.js.
  profil: () => 'revue'
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
  // Nom assaini (minuscules, sans espace ni accent) avant le suffixe de nom libre : le
  // Makefile liste media/ par $(wildcard …) dans les prérequis du PDF, et make coupe aux
  // espaces — « Mon image été.png » y devient deux fichiers inexistants, « No rule to make
  // target », et l'article ne compile plus (mesuré le 29.09.2026 dans la WSL). Même
  // assainissement que l'éditeur de tableau (lib/table-images.js) et l'import des médias.
  const nomSur = nomImageAssaini(path.basename(source));
  if (!nomSur) { vscode.window.showErrorMessage(T('importv.err.format')); return; }
  const nom = nomMediaUnique(mediaDir, nomSur);
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
    vscode.window.showErrorMessage(T('err.ecriture', [nom, e.message]));
    return;
  }
  await poserBlocIsole(editeur, blocTableSeul(nom));
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
  const systeme = cheminSysteme('WindowsPowerShell', 'v1.0', 'powershell.exe');
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

// Pose un bloc ::: isolé (voir insererBlocIsole, lib/formatting-pur.js) à la FIN de la
// sélection — son début si elle est vide, comme un simple curseur. Le texte sélectionné n'est
// jamais détruit, comme pour l'en-tête FALC et le QR. `snippet` : le bloc porte des champs
// ${n} à parcourir au Tab (insertSnippet) ; le texte qui l'entoure est alors échappé.
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

// ---- Styles « Livre » : en-tête de chapitre FALC, code QR ----
//
// Deux fenced div insérés en SnippetString (champs modifiables au Tab), jamais proposés
// hors du profil livre (voir PALETTE_MEF_LIVRE, lib/formatting-pur.js). Une sélection
// existante n'est JAMAIS détruite : insertSnippet ne touche qu'au point d'insertion — la
// fin de la sélection (son début si elle est vide, comme un simple curseur) — et laisse le
// texte sélectionné intact, où qu'il soit. Les lignes vides autour : poserBlocIsole.
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
  vscode.window.setStatusBarMessage(T('fmt.note.retour'), 8000);
}

// Demande l'adresse, puis fait de la sélection le texte du lien : [sélection](adresse).
// Sans sélection, l'adresse telle qu'elle a été tapée sert de texte, et elle reste
// sélectionnée après l'insertion — on peut la garder ou taper le texte voulu par-dessus.
// La saisie est préremplie par la sélection si c'est déjà une adresse, sinon par le
// presse-papiers s'il en contient une : c'est d'ordinaire de là que vient le lien.
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
  if (saisie === undefined) { return; }              // annulé : rien n'est inséré
  const url = normaliserUrl(saisie);
  if (!url) { return; }
  // Une sélection qui n'était que l'adresse devient un lien sur elle-même, comme sans
  // sélection : le texte reste l'adresse lisible, sans le https:// ajouté.
  const texte = texteSel && texteSel.trim() !== propose ? texteSel : saisie.trim();
  const lien = lienMarkdown(texte, url);
  const ok = await editeur.edit((b) => { b.replace(sel, lien); });
  if (!ok || texteSel) { return; }
  // Sans sélection, le point d'insertion est sur une seule ligne : le texte du lien va du
  // « [ » au « ](adresse) ».
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
  // Un mot sélectionné dans la parenthèse (double-clic) s'étend à tout l'appel, comme le
  // liage automatique ; une sélection hors de toute parenthèse reste telle quelle.
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
  // Groupe « Livre » (falc-header, qr-link) : ajouté seulement pour un livre — jamais une
  // revue ni une Zeitschrift. Même condition que pourProfil (lib/panneaux.js) pour le
  // panneau d'édition, qui propose la même palette.
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
  c('szh.fmt.lien', () => fmtLien());
  c('szh.fmt.tableau', () => fmtTableau());
  c('szh.fmt.collerTableau', () => fmtCollerTableau());
  c('szh.fmt.sautPage', () => fmtSautPage());
  // Livre seulement : la commande existe toujours (comme les autres szh.fmt.*), mais
  // n'apparaît dans aucun menu hors profil livre (PALETTE_MEF_LIVRE, package.json).
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
