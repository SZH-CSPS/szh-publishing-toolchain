// Aperçu commutable HTML / PDF, colonne 2 : le panneau HTML (CSP, bandeau, styles de
// survol), sa bascule avec le PDF, et le défilement synchronisé entre l'éditeur et l'aperçu.
// Impur (webviews, éditeur, disque) ; les rappels vers l'hôte passent par configurer() plus bas.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { T } = require('./i18n');
const session = require('./session');
const profils = require('./profil');
const { lireMedia } = require('./webviews/util');
const { differer } = require('./interaction');
const { compilationAutoCoupee } = require('./cycle-vie');
const { MSG } = require('./messages');

const VUE_PDF = 'pdf.preview';

// L'aperçu Markdown de l'éditeur (extension intégrée markdown-language-features). Son
// `viewType` est préfixé par l'hôte (« mainThreadWebview-markdown.preview ») : on le
// reconnaît donc à l'inclusion, jamais à l'égalité. C'est lui qui rend la bibliographie
// — aucun moteur n'est embarqué pour ça, et une liste de références est de la prose.
const VUE_MD = 'markdown.preview';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  fermerOnglets: async () => {},
  // Les onglets ouverts, pour savoir si l'aperçu Markdown est à l'écran : son état vit dans
  // l'éditeur et nulle part ici — il se ferme aussi à la croix.
  ongletOuvert: () => false,
  ouvrirApercuPdf: async () => {},
  // Mode « Trad » : le clic détourné vers le formulaire de suggestion. Un module non
  // configuré ne détourne rien — voir repondreModeTrad dans extension.js.
  repondreModeTrad: () => false
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le dossier des unités de texte du profil actif — même calcul que dossierUnites()
// dans extension.js, mais tiré directement de session.profilOuvrage() : ce module n'a pas
// à recevoir ce rappel-là, lib/profil.js suffit.
function dossierUnites() {
  return (session.profilOuvrage() || profils.profilPour('revue')).unites.dossier;
}

async function fermerApercuCourant(saufUri) {
  const courant = session.apercuCourantUri();
  if (!courant) { return; }
  if (saufUri && courant.fsPath.toLowerCase() === saufUri.fsPath.toLowerCase()) { return; }
  session.poserApercuCourantUri(null);
  const cible = courant.fsPath.toLowerCase();
  await ctx.fermerOnglets((e) => e && e.uri && e.uri.fsPath && e.uri.fsPath.toLowerCase() === cible);
}

// ---- Aperçu commutable HTML / PDF ------------------------------------------------
// Mode global szh.apercuMode (défaut html). En HTML, la colonne 2 est une webview qui
// charge out/<slug>/<slug>.apercu.html, rendu avec sourcepos : survol = contour, clic =
// ligne source du .md. En PDF, c'est tomoki1207.pdf, et szh-apercu ne s'active que dans
// ce mode : la colonne 2 n'a qu'un propriétaire à la fois.

// Profil du dossier, lu comme le fait le Makefile : clé absente = « article », clé
// présente mais vide = 'rien', soit aucun document produit.
function lireProfil(racine) {
  if (!racine) { return 'article'; }
  try {
    const m = fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')
      .match(/^profil:[ \t]*["']?([a-zA-Z-]*)/m);
    if (!m) { return 'article'; }
    return m[1] === '' ? 'rien' : m[1];
  } catch (e) { return 'article'; }        // ausgabe.yaml illisible : profil par défaut
}

function modeApercu() {
  // Un profil sans PDF n'a rien à montrer en mode pdf : aperçu HTML forcé.
  if (session.profilRevue() !== 'article') { return 'html'; }
  try {
    return String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { return 'html'; }
}

// « 01-exemple.md@12:3-14:1 » (ou « 12:3-14:1 ») -> 12. null si illisible.
function lignePos(pos) {
  const texte = String(pos || '');
  const droite = texte.indexOf('@') !== -1 ? texte.slice(texte.indexOf('@') + 1) : texte;
  const m = droite.match(/^(\d+):/);
  return m ? parseInt(m[1], 10) : null;
}

// Plage d'un data-pos : « …@L:C-L:C » -> {l1,c1,l2,c2}, 1-based, ou null. Pure.
function plagePos(pos) {
  const texte = String(pos || '');
  const droite = texte.indexOf('@') !== -1 ? texte.slice(texte.indexOf('@') + 1) : texte;
  const m = droite.match(/^(\d+):(\d+)-(\d+):(\d+)/);
  if (!m) { return null; }
  return { l1: parseInt(m[1], 10), c1: parseInt(m[2], 10), l2: parseInt(m[3], 10), c2: parseInt(m[4], 10) };
}

// Première occurrence de `mot` dans la plage [l1:c1 .. l2] des `lignes` du .md ->
// {ligne, colonne, longueur} 0-based, ou null : venant du texte rendu, le mot n'est pas
// toujours dans la source, et l'appelant se rabat alors sur le bloc entier. Pure.
function positionMot(lignes, l1, c1, l2, mot) {
  const m = String(mot == null ? '' : mot);
  if (!m || !Array.isArray(lignes)) { return null; }
  const debut = Math.max(1, l1 | 0);
  const fin = Math.max(debut, l2 | 0);
  for (let L = debut; L <= fin && L <= lignes.length; L++) {
    const ligne = lignes[L - 1];
    if (ligne == null) { continue; }
    const depart = (L === debut) ? Math.max(0, (c1 | 0) - 1) : 0;
    const idx = ligne.indexOf(m, depart);
    if (idx !== -1) { return { ligne: L - 1, colonne: idx, longueur: m.length }; }
  }
  return null;
}

// Mot sous le curseur ; mêmes délimiteurs que motAuPoint (media/apercu.js). Pure.
function jetonSource(texte, colonne) {
  const s = String(texte == null ? '' : texte);
  const i = Math.max(0, Math.min(colonne | 0, s.length));
  const estMot = (ch) => ch !== '' && /[^\s.,;:!?()\[\]{}«»"'…—–\/]/.test(ch);
  let deb = i, fin = i;
  while (deb > 0 && estMot(s.charAt(deb - 1))) { deb--; }
  while (fin < s.length && estMot(s.charAt(fin))) { fin++; }
  return s.slice(deb, fin);
}

function editeurArticleCourant(fournisseur) {
  if (!session.apercuCourantSlug() || !fournisseur.racine) { return null; }
  const cible = path.join(fournisseur.racine, dossierUnites(), session.apercuCourantSlug(), session.apercuCourantSlug() + '.md').toLowerCase();
  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document && ed.document.uri && ed.document.uri.fsPath.toLowerCase() === cible) { return ed; }
  }
  return null;
}

// Aperçu -> éditeur : révèle `ligne` (1-based) au sommet, sans focus, garde posée.
function revelerLigneSource(fournisseur, ligne) {
  const ed = editeurArticleCourant(fournisseur);
  if (!ed) { return; }
  const l = Math.max(0, Math.min((parseInt(ligne, 10) || 1) - 1, ed.document.lineCount - 1));
  session.poserDefilementProgrammatiqueHote(true);
  ed.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.AtTop);
  if (session.minuteurHoteRelache()) { clearTimeout(session.minuteurHoteRelache()); }
  session.poserMinuteurHoteRelache(setTimeout(() => { session.poserDefilementProgrammatiqueHote(false); }, 200));
}

function pousserDefilementVersApercu(ligne0Based) {
  if (session.minuteurHoteVersApercu()) { clearTimeout(session.minuteurHoteVersApercu()); }
  session.poserMinuteurHoteVersApercu(setTimeout(() => {
    if (!session.panneauApercuHtml()) { return; }
    try { session.panneauApercuHtml().webview.postMessage({ type: 'scroll', ligne: ligne0Based + 1 }); }
    catch (e) { /* webview fermée entre-temps */ }
  }, 35));
}

// Curseur dans le .md -> surlignage dans l'aperçu, amené en vue s'il est hors écran.
function pousserSurlignageVersApercu(fournisseur) {
  if (session.minuteurHoteSurlignage()) { clearTimeout(session.minuteurHoteSurlignage()); }
  session.poserMinuteurHoteSurlignage(setTimeout(() => {
    if (!session.panneauApercuHtml()) { return; }
    const ed = editeurArticleCourant(fournisseur);
    if (!ed) { return; }
    const pos = ed.selection.active;
    let mot = '';
    try { mot = jetonSource(ed.document.lineAt(pos.line).text, pos.character); }
    catch (e) { mot = ''; }
    try { session.panneauApercuHtml().webview.postMessage({ type: 'surligner', ligne: pos.line + 1, mot: mot }); }
    catch (e) { /* webview fermée entre-temps */ }
  }, 60));
}

// Le script de la page, en un seul morceau et donc sous un seul nonce, comme le fait
// construireHtml pour les onze autres webviews : la table du protocole
// (media/_messages.js -> SZH.MSG) AVANT media/apercu.js, qui nomme par elle chaque
// message échangé avec l'hôte. L'aperçu n'emprunte pas construireHtml — il enrobe le
// HTML de pandoc au lieu d'un gabarit de media/ — et n'héritait donc d'aucun socle :
// `SZH` restait indéfini, et la première lecture de SZH.MSG levait une ReferenceError
// qui emportait le clic vers la source et le défilement synchronisé. Le socle posé ici
// est le strict minimum : media/_commun.js n'entre pas, l'aperçu n'ayant aucune de ses
// fonctions à appeler, et _messages.js suppose seulement que `SZH` existe.
function scriptApercu() {
  return ['var SZH = SZH || {};', lireMedia('_messages.js'), lireMedia('apercu.js')].join('\n');
}

// Injecte dans le HTML de pandoc la CSP, le bandeau, les styles de survol et le script.
function injecterApercu(contenu, nonce) {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">';
  const ajout =
    '<style>' + lireMedia('apercu.css') + '</style>' +
    '<div id="szh-bandeau"><span>' + T('apercu.bandeau') + '</span>' +
    '<button id="szh-basculer" type="button">' + T('apercu.bandeau.pdf') + '</button></div>' +
    '<script nonce="' + nonce + '">' + scriptApercu() + '</script>';
  let html = contenu;
  html = html.indexOf('<head>') !== -1 ? html.replace('<head>', '<head>\n' + csp) : csp + html;
  html = html.indexOf('</body>') !== -1 ? html.replace('</body>', ajout + '\n</body>') : html + ajout;
  return html;
}

// Clic dans l'aperçu -> texte source : le mot cliqué s'il est retrouvé, sinon le début
// du bloc ; le .md s'ouvre en colonne 1, curseur et focus posés.
async function revelerPos(fournisseur, slug, pos, mot) {
  const pl = plagePos(pos);
  const ligneDebut = pl ? pl.l1 : lignePos(pos);
  if (!ligneDebut || !fournisseur.racine) { return; }
  const md = path.join(fournisseur.racine, dossierUnites(), slug, slug + '.md');
  try {
    const doc = await vscode.workspace.openTextDocument(md);
    const editeur = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    let selection = null;
    if (mot && pl) {
      const p = positionMot(doc.getText().split(/\r?\n/), pl.l1, pl.c1, pl.l2, mot);
      if (p) {
        const l = Math.max(0, Math.min(p.ligne, doc.lineCount - 1));
        selection = new vscode.Selection(l, p.colonne, l, p.colonne + p.longueur);
      }
    }
    if (!selection) {
      const l = Math.max(0, Math.min(ligneDebut - 1, doc.lineCount - 1));
      selection = new vscode.Selection(l, 0, l, 0);
    }
    editeur.selection = selection;
    editeur.revealRange(selection, vscode.TextEditorRevealType.InCenter);
  } catch (e) { /* fichier disparu entre-temps */ }
}

function fermerApercuHtml() {
  if (!session.panneauApercuHtml()) { return; }
  const p = session.panneauApercuHtml();
  session.poserPanneauApercuHtml(null);
  try { p.dispose(); } catch (e) { /* déjà fermé */ }
}

// Ferme la colonne 2. szh-apercu ouvre des onglets pdf.preview dont le cockpit ne garde
// pas trace : d'où le balayage de tabGroups.
async function fermerTousLesApercus() {
  fermerApercuHtml();
  await fermerApercuCourant(null);
  await ctx.fermerOnglets((e) => e && e.viewType === VUE_PDF);
  // Le rendu d'une bibliographie occupe la même colonne que les deux autres : il part avec
  // eux. Sans cette ligne, un formulaire pleine page s'ouvrirait derrière lui.
  await fermerApercuMd();
  session.poserApercuCourantUri(null);
}

// ---- Aperçu d'une bibliographie -------------------------------------------------
//
// <slug>.biblio.md est de la prose : une référence par paragraphe, collée depuis Zotero.
// Ce qu'on veut en voir, c'est le texte mis en forme — pas la maquette du numéro, qui
// demanderait une compilation entière pour un fichier qu'on relit au fil de la saisie.
// L'aperçu Markdown de l'éditeur suffit, et il se rafraîchit à la frappe.
function estBiblio(chemin) { return /\.biblio\.md$/i.test(String(chemin || '')); }

function estOngletMd(entree) {
  return !!(entree && typeof entree.viewType === 'string' && entree.viewType.indexOf(VUE_MD) !== -1);
}

function apercuMdOuvert() { return !!ctx.ongletOuvert(estOngletMd); }

async function fermerApercuMd() { await ctx.fermerOnglets(estOngletMd); }

// Le texte en colonne 1, son rendu en colonne 2. Le focus revient au texte : c'est là
// qu'on écrit, et `markdown.showPreviewToSide` le laisse sur le rendu, où l'on ne peut
// rien saisir.
async function ouvrirApercuBiblio(uri) {
  await fermerTousLesApercus();            // la colonne 2 n'a qu'un propriétaire à la fois
  await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.One });
  try {
    await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
  } catch (e) {
    vscode.window.setStatusBarMessage(T('biblio.apercu.absent'), 4000);
    return;
  }
  await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.One });
}

// Seuls des libellés traduits sont posés dans ce HTML ; ils sont échappés quand même.
function echapperTexte(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Le fichier d'aperçu HTML d'une unité, selon le profil actif : celui du chapitre pour un
// livre (out/chapitres/<slug>.apercu.html, lib/profil.js#chemins — outUnite est déjà ce
// fichier), celui de l'article pour une revue (out/<slug>/<slug>.apercu.html — outUnite y
// est le dossier de sortie de l'article, pas le fichier).
function cheminApercuHtml(racine, slug) {
  const profil = session.profilOuvrage() || profils.profilPour('revue');
  const c = profils.chemins(profil, racine, slug);
  return profil.cle === 'livre' ? c.outUnite : path.join(c.outUnite, slug + '.apercu.html');
}

// Repli du mode PDF (le .html complet que pandoc écrit aussi) : n'existe que pour un
// article — un chapitre de livre n'a pas de HTML complet à lui, seulement son fragment et
// son aperçu, voir profil.js.
function cheminHtmlComplet(racine, slug) {
  const profil = session.profilOuvrage() || profils.profilPour('revue');
  if (profil.cle === 'livre') { return null; }
  return path.join(profils.chemins(profil, racine, slug).outUnite, slug + '.html');
}

// Dernière clé (racine|slug|mode) écrite dans .szh-apercu : évite de réécrire à chaque
// rafraîchissement si rien n'a changé.
let dernierApercuPrioritaireEcrit = null;

// Priorité de compilation : dit au Makefile quel article regarder d'abord dans le lot,
// via <racine>/.szh-apercu (une ligne « <slug> <mode> »). Efface le fichier si aucun
// aperçu n'est ouvert. Jamais bloquant : un numéro verrouillé ou une synchro en cours ne
// doivent pas gêner l'affichage de l'aperçu.
function noterApercuPrioritaire(racine) {
  if (!racine) { return; }
  const slug = session.apercuCourantSlug();
  const mode = modeApercu();
  const cle = racine + '|' + (slug || '') + '|' + mode;
  if (cle === dernierApercuPrioritaireEcrit) { return; }
  const fichier = path.join(racine, '.szh-apercu');
  try {
    if (slug) {
      fs.writeFileSync(fichier, slug + ' ' + mode + '\n', 'utf8');
    } else if (fs.existsSync(fichier)) {
      fs.unlinkSync(fichier);
    }
    dernierApercuPrioritaireEcrit = cle;
  } catch (e) { /* numéro verrouillé, disque plein, synchro OneDrive en cours : tant pis */ }
}

// Aperçu HTML en colonne 2 ; si le fichier manque, replie sur le .html du PDF.
function ouvrirApercuHtml(fournisseur, slug, enAttente) {
  let fichier = cheminApercuHtml(fournisseur.racine, slug);
  let contenu = null;
  try { contenu = fs.readFileSync(fichier, 'utf8'); }
  catch (e) {
    const repli = cheminHtmlComplet(fournisseur.racine, slug);
    contenu = null;
    if (repli) {
      fichier = repli;
      try { contenu = fs.readFileSync(fichier, 'utf8'); } catch (e2) { contenu = null; }
    }
  }
  let mtime = 0;
  try { mtime = fs.statSync(fichier).mtimeMs; } catch (e) { /* page de remplacement */ }
  if (contenu === null) {
    const lignes = [echapperTexte(T('apercu.indisponible'))];
    if (enAttente) { lignes.push(echapperTexte(T('apercu.encours'))); }
    // Numéro gelé : rien ne se compilera tout seul, on dit par quel geste le faire.
    else if (compilationAutoCoupee()) { lignes.push(echapperTexte(T('apercu.gele'))); }
    contenu = '<!DOCTYPE html><html lang="fr"><head></head><body><p>'
            + lignes.join('</p><p>') + '</p></body></html>';
  }
  const html = injecterApercu(contenu, crypto.randomBytes(16).toString('hex'));
  if (!session.panneauApercuHtml()) {
    const panneau = vscode.window.createWebviewPanel(
      'szhApercuHtml', slug,
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [] }
    );
    session.poserPanneauApercuHtml(panneau);
    panneau.onDidDispose(() => { if (session.panneauApercuHtml() === panneau) { session.poserPanneauApercuHtml(null); } });
    panneau.webview.onDidReceiveMessage((msg) => {
      if (!msg) { return; }
      // Mode « Trad » : l'état du mode, et le clic détourné. Branché ici et non dans les
      // réglages ni dans le formulaire de suggestion — voir repondreModeTrad.
      if (ctx.repondreModeTrad(panneau, msg)) { return; }
      if (msg.type === MSG.BASCULER) { vscode.commands.executeCommand('szh.basculerApercu'); return; }
      if (msg.type === MSG.REVELE) {
        if (session.apercuCourantSlug()) { revelerPos(fournisseur, session.apercuCourantSlug(), msg.pos, msg.mot); }
        return;
      }
      if (msg.type === MSG.SCROLL_SOURCE) { revelerLigneSource(fournisseur, msg.ligne); return; }
      console.warn('aperçu HTML : type de message inconnu', msg.type);
    });
  }
  session.panneauApercuHtml().title = slug;
  session.panneauApercuHtml().webview.html = html;
  session.poserApercuCourantSlug(slug);
  session.poserApercuHtmlMtime(mtime);
}

function rechargerApercuHtmlSiChange(fournisseur) {
  // Réassigner webview.html déplace le focus, et un QuickPick ouvert (Ctrl+Alt+A/S/D,
  // choix de titre…) se ferme dès que le focus bouge : la fin d'une compilation fermait
  // le panneau sous les doigts du rédacteur. Tout le corps est donc différé — et
  // réévalué au rejeu, l'aperçu ayant pu être fermé ou la sortie avoir encore changé
  // entre-temps. Une seule action pour toutes les compilations survenues pendant le geste.
  differer('apercu-html', () => {
    if (!session.panneauApercuHtml() || !session.apercuCourantSlug() || !fournisseur.racine || modeApercu() !== 'html') { return; }
    const slug = session.apercuCourantSlug();
    let mtime = 0;
    try { mtime = fs.statSync(cheminApercuHtml(fournisseur.racine, slug)).mtimeMs; }
    catch (e) { return; }
    if (mtime > session.apercuHtmlMtime()) { ouvrirApercuHtml(fournisseur, slug); }
  });
}

// Persiste szh.apercuMode ; jamais deux aperçus en colonne 2.
//
// Sur une bibliographie, la même touche (Ctrl+Alt+P) bascule SON aperçu : HTML ⇄ PDF n'a
// aucun sens sur un fichier qui n'est pas compilé seul, et demander une seconde touche
// pour le même geste à un endroit différent se retiendrait mal. Le rendu ouvert sans
// éditeur de texte actif compte aussi : la webview a alors le focus, et c'est pourtant elle
// qu'on veut refermer.
async function basculerApercu(fournisseur, majBarreApercu) {
  const actif = vscode.window.activeTextEditor;
  const surBiblio = !!(actif && estBiblio(actif.document.uri.fsPath));
  const mdOuvert = apercuMdOuvert();
  if (surBiblio || (mdOuvert && !actif)) {
    if (mdOuvert) { await fermerApercuMd(); }
    else { await ouvrirApercuBiblio(actif.document.uri); }
    return;
  }
  // Ailleurs : l'aperçu de l'article reprend la colonne 2, donc le rendu d'une
  // bibliographie la libère d'abord.
  if (mdOuvert) { await fermerApercuMd(); }
  const nouveau = modeApercu() === 'html' ? 'pdf' : 'html';
  try {
    await vscode.workspace.getConfiguration('szh').update('apercuMode', nouveau, vscode.ConfigurationTarget.Global);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', ['settings.json', e.message]));
    return;
  }
  if (majBarreApercu) { majBarreApercu(); }
  const slug = session.apercuCourantSlug();
  if (!slug || !fournisseur.racine) { return; }
  if (nouveau === 'html') {
    if (session.apercuCourantUri()) { await fermerApercuCourant(null); }   // l'onglet PDF courant
    ouvrirApercuHtml(fournisseur, slug);
  } else {
    fermerApercuHtml();
    const pdf = vscode.Uri.file(path.join(fournisseur.racine, 'out', slug, slug + '.pdf'));
    if (fs.existsSync(pdf.fsPath)) {
      await ctx.ouvrirApercuPdf(pdf);
      session.poserApercuCourantUri(pdf);
    }
  }
}

module.exports = {
  configurer,
  lireProfil, modeApercu, lignePos, plagePos, positionMot, jetonSource,
  editeurArticleCourant, revelerLigneSource, pousserDefilementVersApercu,
  pousserSurlignageVersApercu, injecterApercu, revelerPos,
  fermerApercuCourant, fermerApercuHtml, fermerTousLesApercus, echapperTexte,
  estBiblio, apercuMdOuvert, fermerApercuMd, ouvrirApercuBiblio,
  ouvrirApercuHtml, rechargerApercuHtmlSiChange, basculerApercu,
  noterApercuPrioritaire,
  // Le chemin d'aperçu attendu, seul endroit qui sache choisir entre le chapitre et
  // l'article : ouvrirArticle et compilerPuisAfficher (extension.js) s'y raccrochent au
  // lieu de refaire le calcul avec un path.join littéral, faux sur un livre.
  cheminApercuHtml
};
