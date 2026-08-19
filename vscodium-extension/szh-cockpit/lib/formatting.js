// SZH cockpit — mise en forme (M6, D55). Extrait de extension.js (R6). Toggles PURS
// (basculer*/enrober/squelette, testés via _pur) + commandes szh.fmt.* et palette.
// Contient aussi le seul accès IMPÉRATIF au presse-papiers HTML (PowerShell) — la
// transformation, elle, est pure et vit dans lib/table-model.js.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { T } = require('./i18n');
const { tableauDepuisHtmlBureautique, tableauDepuisTsv, serialiserTable,
  finaliserModele, PRESETS_TABLE } = require('./table-model');

// Contexte de la revue, INJECTÉ par extension.js à l'enregistrement des commandes :
//   racine()                       -> racine de la revue (ou null)
//   slugDepuisChemin(racine, chem) -> slug si le chemin EST un article (D26), sinon null
//   rafraichirTout()               -> rafraîchit l'arbre du cockpit (et le reste)
// POURQUOI une injection et pas un require : extension.js require CE module — l'inverse
// serait un cycle. On réutilise ainsi la SEULE définition de « est-ce un article » et le
// SEUL rafraîchissement, sans les redéfinir ici.
let revue = {
  racine: () => null,
  slugDepuisChemin: () => null,
  rafraichirTout: () => {}
};

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

// Squelette de tableau Markdown (3 colonnes, 2 lignes) — repli HORS article seulement
// depuis D95 (dans un article, « Insérer un tableau » crée un fichier tables/table-NN.html
// et ouvre l'éditeur de tableau, cf. fmtTableau). Un tableau VENU d'Excel/Word ne passe
// pas non plus par le pipe (Ctrl+Alt+V, cf. fmtCollerTableau).
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
// (nom rendu unique), insérer ![Légende](media/nom.ext) à la sélection — puis, dans un
// article, ouvrir la FICHE de l'image pour que légende, texte alternatif et crédits se
// remplissent tout de suite (même esprit que « Insérer un tableau », qui enchaîne sur
// l'éditeur de tableau, D95/D102). Une figure sans texte alternatif ni crédits est un
// défaut que personne ne va rattraper trois semaines plus tard : le moment de les
// écrire, c'est celui où l'on choisit l'image.
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
  const md = '![' + T('fmt.figure.legende') + '](media/' + nom + ')';
  await editeur.edit((b) => { b.replace(editeur.selection, md); });
  vscode.window.setStatusBarMessage(T('fmt.figure.copiee', [nom]), 4000);
  if (!slug) { return; }                             // hors article : pas de fiche à ouvrir
  // On ENREGISTRE avant de partir vers la fiche (même raison que fmtTableau) : sinon
  // la référence reste dans le tampon, l'article se recompile sans elle, et « Retour à
  // l'article » montrerait un aperçu sans la figure qu'on vient d'insérer.
  try { await doc.save(); } catch (e) { /* fichier verrouillé : la référence reste au tampon */ }
  revue.rafraichirTout();                            // l'image apparaît sous l'article
  // Mêmes champs que l'item d'arbre attendu par ouvrirFicheImage (slug + cheminAsset).
  await vscode.commands.executeCommand('szh.ficheImage',
    { slug: slug, cheminAsset: path.join(mediaDir, nom) });
}

// ---- Insérer un tableau (Ctrl+Alt+T, D95) ------------------------------------------
//
// Le tableau inséré est un VRAI tableau de la revue — un fichier
// articles/<slug>/tables/table-NN.html + la référence ::: {.szh-tabelle src="…"} au
// curseur — puis l'éditeur de tableau s'ouvre dessus. Exactement la mécanique du
// collage (D81), avec pour seule différence la SOURCE du modèle : ici, une grille
// vierge. Le pipe Markdown ne survivait de toute façon pas à la mise en forme du PDF
// (ni fusions, ni en-têtes, ni styles) et l'équipe de rédaction n'a pas à écrire des
// « |---|---| » à la main.

// Grille vierge 3 × 3 dont la première rangée est un en-tête (les colonnes sont
// nommées « Colonne 1/2/3 » pour que la rangée d'en-tête ne soit pas vide à l'écran).
// L'habillage est celui du préréglage « académique » — SOURCE UNIQUE : PRESETS_TABLE,
// jamais recopié ici. finaliserModele pose th/scope depuis le compte d'en-tête.
function tableauVierge(colonne) {
  const c = String(colonne || 'Colonne');
  const cellule = (contenu) => ({ contenu: contenu, colspan: 1, rowspan: 1, th: false, scope: '', align: 'left' });
  const lignes = [{ cellules: [cellule(c + ' 1'), cellule(c + ' 2'), cellule(c + ' 3')] }];
  for (let i = 0; i < 2; i++) { lignes.push({ cellules: [cellule(''), cellule(''), cellule('')] }); }
  return finaliserModele({
    attrs: Object.assign({ enteteLignes: 1 }, PRESETS_TABLE.academique),
    lignes: lignes
  });
}

async function fmtTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  const racine = revue.racine();
  const slug = racine ? revue.slugDepuisChemin(racine, doc.uri.fsPath) : null;
  if (!slug) {
    // Hors article (BIENVENUE.md, .md d'un autre dossier, fichier hors revue) : il n'y
    // a pas de articles/<slug>/tables/ où écrire, et pas d'article à recompiler. On
    // garde donc le squelette Markdown historique — la commande reste utile partout —
    // en le disant, pour que personne ne s'étonne d'obtenir deux choses différentes.
    const sq = squeletteTableau(T('fmt.tableau.colonne'));
    await editeur.edit((b) => { b.replace(editeur.selection, sq); });
    vscode.window.setStatusBarMessage(T('fmt.tableau.markdown'), 5000);
    return;
  }
  const dossier = path.join(path.dirname(doc.uri.fsPath), 'tables');
  const nom = nomTableLibre(dossier);                // premier libre : jamais d'écrasement
  try {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, nom), serialiserTable(tableauVierge(T('fmt.tableau.colonne'))), 'utf8');
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    return;
  }
  const sel = editeur.selection;
  const avant = doc.lineAt(sel.start.line).text.slice(0, sel.start.character);
  const apres = doc.lineAt(sel.end.line).text.slice(sel.end.character);
  await editeur.edit((b) => { b.replace(sel, blocReferenceTable(nom, avant, apres)); });
  // On ENREGISTRE l'article avant de partir vers l'éditeur de tableau : sinon la
  // référence reste dans le tampon, l'article se recompile sans elle et « Retour à
  // l'article » montrerait un aperçu sans le tableau qu'on vient de créer. (Le collage
  // Ctrl+Alt+V, lui, laisse la main dans le texte : rien ne part, l'utilisateur
  // enregistre quand il veut.)
  try { await doc.save(); } catch (e) { /* fichier verrouillé : la référence reste au tampon */ }
  vscode.window.setStatusBarMessage(T('fmt.tableau.creee', [nom]), 5000);
  revue.rafraichirTout();                            // le tableau apparaît sous l'article
  // On enchaîne sur l'éditeur de tableau : c'est là que la grille se remplit. Mêmes
  // champs que l'item d'arbre attendu par ouvrirEditeurTable (slug + cheminAsset).
  await vscode.commands.executeCommand('szh.editerTable', { slug: slug, cheminAsset: path.join(dossier, nom) });
}

// ---- Coller un tableau depuis Excel/Word (Ctrl+Alt+V, D81) -------------------------
//
// Le collage d'origine (D75) lisait le presse-papiers en TEXTE et écrivait un pipe :
// les cellules FUSIONNÉES étaient perdues, sans recours (le TSV ne les porte pas). Le
// collage écrit désormais un FICHIER de tableau HTML — exactement le mécanisme D47 des
// tableaux importés de Word : articles/<slug>/tables/table-NN.html, plus une référence
// ::: {.szh-tabelle src="…"} dans le .md, résolue à la compilation par
// pipeline/filters/szh-tabelle-inclure.lua. Le fichier est écrit par serialiserTable
// (format canonique) : l'éditeur de tableau du cockpit sait le rouvrir et le réécrire.
//
// La source des fusions est la variante HTML du presse-papiers Windows, que l'API VS
// Code ne sait pas lire (readText -> TSV seulement) mais que PowerShell, lui, atteint.

// powershell.exe : System32 en priorité (chemin sûr), PATH en repli — même posture que
// cheminWsl() dans lib/wsl.js.
function cheminPowerShell() {
  const systeme = path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'powershell.exe';
}

// Script de lecture du presse-papiers HTML.
//
// PIÈGE D'ENCODAGE, vérifié sur ce poste : les octets CF_HTML déposés par Excel/Word
// sont de l'UTF-8, mais .NET Framework les rend DÉJÀ décodés — et décodés dans la page
// de codes ANSI. « Élèves — Zürich » revient en « Ã‰lÃ¨ves â€” ZÃ¼rich », que ce soit
// par « Get-Clipboard -TextFormatType Html » ou par GetData('HTML Format', $false)
// (qui rend un System.String, PAS un flux d'octets, contrairement à ce qu'on lit
// souvent). On répare donc en RE-ENCODANT la chaîne dans cette même page ANSI pour
// retrouver les octets d'origine, puis en les décodant en UTF-8 — avec un décodeur
// STRICT (throwOnInvalidBytes) : si la suite n'est pas de l'UTF-8 valide, c'est que la
// chaîne n'avait pas été mal décodée et on la garde telle quelle. Un producteur qui
// déposerait un vrai flux (autre application, autre version de .NET) passe par la
// branche Stream, lue en UTF-8 directement.
//
// [Console]::Out.Write plutôt que Write-Output : le formateur de PowerShell insère des
// retours à la ligne dans les chaînes longues quand la sortie est redirigée (largeur de
// console supposée), ce qui couperait le HTML.
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

// Variante HTML du presse-papiers (CF_HTML brut, en-tête comprise) ou '' si absente.
// Ne rejette JAMAIS : PowerShell introuvable, presse-papiers verrouillé par une autre
// application ou trop lent -> chaîne vide, et l'appelant se replie sur le TSV.
// -EncodedCommand (UTF-16LE/base64) : aucun échappement de guillemets à négocier.
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

// Premier nom de tableau LIBRE dans `dossier` : table-NN.html, NN sur deux chiffres
// comme pipeline/docx-tables.py. « Premier libre » et non « dernier + 1 » : on ne
// réécrit jamais un tableau importé, même après suppression d'un intermédiaire.
// Au-delà de 99 (jamais vu), on continue sans zéro de tête plutôt que d'échouer.
function nomTableLibre(dossier) {
  for (let n = 1; n < 1000; n++) {
    const nom = 'table-' + (n < 10 ? '0' + n : String(n)) + '.html';
    let pris = false;
    try { pris = fs.existsSync(path.join(dossier, nom)); } catch (e) { pris = false; }
    if (!pris) { return nom; }
  }
  return 'table-999.html';
}

// Bloc de référence D47 à insérer dans le .md — À LA LETTRE ce que pose
// szh-tabelle-reference.lua à l'import et ce que résout szh-tabelle-inclure.lua.
// `avant`/`apres` = le texte de la ligne courante de part et d'autre du curseur : un
// « fenced div » Pandoc doit commencer en début de ligne et être séparé du paragraphe
// voisin, on n'ajoute donc les lignes vides que si le curseur n'est pas déjà au calme.
// Pure (testée via _pur).
function blocReferenceTable(nom, avant, apres) {
  const bloc = '::: {.szh-tabelle src="tables/' + nom + '"}\n:::';
  return (String(avant || '').trim() === '' ? '' : '\n\n') + bloc
       + (String(apres || '').trim() === '' ? '' : '\n\n');
}

// Marqueur de SAUT DE PAGE (D86), même forme que la référence de tableau ci-dessus : un
// bloc « fenced div » vide. Ce n'est PAS une balise spéciale de pandoc — il n'en existe
// pas d'universelle : `\newpage` ne vaut que pour LaTeX, et notre PDF sort de WeasyPrint.
// C'est print.css qui donne son sens au marqueur (`break-after: page`), et c'est ce qui le
// rend INERTE en HTML : un média qui défile n'a pas de page suivante. Pure (via _pur).
function blocSautPage(avant, apres) {
  const bloc = '::: {.szh-saut}\n:::';
  return (String(avant || '').trim() === '' ? '' : '\n\n') + bloc
       + (String(apres || '').trim() === '' ? '' : '\n\n');
}

// Insère un saut de page au curseur. Un bloc a besoin d'être isolé par des lignes vides,
// sinon pandoc l'avale dans le paragraphe courant et le div n'existe jamais.
async function fmtSautPage() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const ligne = editeur.document.lineAt(editeur.selection.active.line).text;
  const col = editeur.selection.active.character;
  const texte = blocSautPage(ligne.slice(0, col), ligne.slice(col));
  await editeur.edit((b) => { b.replace(editeur.selection, texte); });
}

async function fmtCollerTableau() {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const doc = editeur.document;
  // Un tableau de la revue vit dans articles/<slug>/tables/ : hors d'un article, il n'y
  // a aucun endroit légitime où l'écrire (même test d'« article » que partout, D26).
  const racine = revue.racine();
  const slug = racine ? revue.slugDepuisChemin(racine, doc.uri.fsPath) : null;
  if (!slug) {
    vscode.window.showInformationMessage(T('fmt.coller.horsarticle'));
    return;
  }
  // 1. La variante HTML (fusions préservées) ; 2. à défaut, le TSV (fusions absentes,
  //    mais mieux que rien : Bloc-notes, éditeur de texte, colonne unique).
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
    fs.writeFileSync(path.join(dossier, nom), serialiserTable(modele), 'utf8');
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

// Palette « Mise en forme » (clic droit → « Mise en forme ») : menu SZH-only,
// localisé, raccourci affiché à droite. Réutilise les commandes szh.fmt.*.
// Format : ['--', cléGroupe] = séparateur ; sinon [cléLibellé, commande, raccourci, icône].
// Exportée : le panneau d'édition (lib/panneaux.js, F1) reprend ces entrées EN BLOC —
// une seule source pour la liste des actions de mise en forme.
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
  ['palette.collerTableau', 'szh.fmt.collerTableau', 'Ctrl+Alt+V', ''],
  ['palette.sautPage', 'szh.fmt.sautPage', 'Ctrl+Alt+Entrée', '']
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

// `hote` (facultatif) : contexte de revue injecté par extension.js — cf. `revue`
// en tête de fichier. Absent (harnais de test), les commandes qui en dépendent se
// comportent comme hors revue.
function enregistrerCommandesMiseEnForme(context, hote) {
  if (hote) { revue = Object.assign({}, revue, hote); }
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
  c('szh.fmt.sautPage', () => fmtSautPage());
  c('szh.miseEnForme', () => ouvrirMiseEnForme());
}

module.exports = {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, blocSautPage, nomTableLibre,
  lireHtmlPressePapiers, enregistrerCommandesMiseEnForme, PALETTE_MEF
};
