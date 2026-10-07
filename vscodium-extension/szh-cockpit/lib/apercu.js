// Aperçu commutable HTML / PDF, colonne 2 : le panneau HTML (CSP, bandeau, styles de
// survol), sa bascule avec le PDF, et le défilement synchronisé entre l'éditeur et l'aperçu.
// Les rappels vers l'hôte passent par configurer().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { T } = require('./i18n');
const session = require('./session');
const profils = require('./profil');
const { lireMedia } = require('./webviews/util');
const { panneauUnique } = require('./webviews/panneau');
const { differer } = require('./interaction');
const { compilationAutoCoupee } = require('./cycle-vie');
const { MSG } = require('./messages');

const VUE_PDF = 'pdf.preview';

// L'aperçu Markdown de l'éditeur (extension intégrée markdown-language-features). Son
// `viewType` est préfixé par l'hôte (« mainThreadWebview-markdown.preview ») : on le
// reconnaît donc à l'inclusion, pas à l'égalité. C'est lui qui rend la bibliographie.
const VUE_MD = 'markdown.preview';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  fermerOnglets: async () => {},
  // Les onglets ouverts, pour savoir si l'aperçu Markdown est à l'écran : son état vit dans
  // l'éditeur, et il peut se fermer par sa croix.
  ongletOuvert: () => false,
  ouvrirApercuPdf: async () => {},
  // Mode « Trad » : le clic détourné vers le formulaire de suggestion.
  repondreModeTrad: require('./traduction-hote').repondreModeTrad
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function dossierUnites() {
  return profils.courant().unites.dossier;
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
// Réglage szh.apercuMode (html par défaut). En HTML, la colonne 2 est une webview qui
// charge out/<slug>/<slug>.apercu.html, rendu avec sourcepos : le survol trace un contour,
// le clic mène à la ligne source du .md. En PDF, c'est tomoki1207.pdf, et szh-apercu ne
// s'active que dans ce mode : la colonne 2 n'affiche qu'un aperçu à la fois.

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

// Plage d'un data-pos : « …@L:C-L:C » -> {l1,c1,l2,c2}, 1-based, ou null.
function plagePos(pos) {
  const texte = String(pos || '');
  const droite = texte.indexOf('@') !== -1 ? texte.slice(texte.indexOf('@') + 1) : texte;
  const m = droite.match(/^(\d+):(\d+)-(\d+):(\d+)/);
  if (!m) { return null; }
  return { l1: parseInt(m[1], 10), c1: parseInt(m[2], 10), l2: parseInt(m[3], 10), c2: parseInt(m[4], 10) };
}

// Première occurrence de `mot` dans la plage [l1:c1 .. l2] des `lignes` du .md ->
// {ligne, colonne, longueur} 0-based, ou null : venant du texte rendu, le mot n'est pas
// toujours dans la source, et l'appelant se rabat alors sur le bloc entier.
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

// Mot sous le curseur ; mêmes délimiteurs que motAuPoint (media/apercu.js).
function jetonSource(texte, colonne) {
  const s = String(texte == null ? '' : texte);
  const i = Math.max(0, Math.min(colonne | 0, s.length));
  const estMot = (ch) => ch !== '' && /[^\s.,;:!?()\[\]{}«»"'…—–\/]/.test(ch);
  let deb = i, fin = i;
  while (deb > 0 && estMot(s.charAt(deb - 1))) { deb--; }
  while (fin < s.length && estMot(s.charAt(fin))) { fin++; }
  return s.slice(deb, fin);
}

function editeurArticle(fournisseur, slug) {
  if (!slug || !fournisseur.racine) { return null; }
  const cible = path.join(fournisseur.racine, dossierUnites(), slug, slug + '.md').toLowerCase();
  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document && ed.document.uri && ed.document.uri.fsPath.toLowerCase() === cible) { return ed; }
  }
  return null;
}

function editeurArticleCourant(fournisseur) {
  return editeurArticle(fournisseur, session.apercuCourantSlug());
}

// Première ligne visible (1-based) de l'éditeur du .md de `slug`, 0 s'il n'est pas à
// l'écran : l'aperçu rechargé par une recompilation s'y replace au lieu de repartir en haut.
function ligneVisibleEditeur(fournisseur, slug) {
  const ed = editeurArticle(fournisseur, slug);
  const plages = ed && ed.visibleRanges;
  if (!plages || !plages.length || !plages[0].start) { return 0; }
  return (plages[0].start.line | 0) + 1;
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
    try { session.panneauApercuHtml().webview.postMessage({ type: MSG.SCROLL, ligne: ligne0Based + 1 }); }
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
    try { session.panneauApercuHtml().webview.postMessage({ type: MSG.SURLIGNER, ligne: pos.line + 1, mot: mot }); }
    catch (e) { /* webview fermée entre-temps */ }
  }, 60));
}

// Le script de la page, en un seul morceau sous un seul nonce : la déclaration de `SZH`,
// puis la table des messages (media/_messages.js -> SZH.MSG), puis media/apercu.js qui
// s'en sert. L'aperçu enrobe le HTML de pandoc et n'utilise donc pas construireHtml : il
// doit poser `SZH` lui-même. media/_commun.js n'est pas inclus, l'aperçu n'en a pas besoin.
// `ligne` (1-based, 0 = sommet) est celle où la page se place au chargement.
function scriptApercu(ligne) {
  return ['var SZH = SZH || {};', 'SZH.LIGNE_INITIALE = ' + (parseInt(ligne, 10) || 0) + ';',
    lireMedia('_messages.js'), lireMedia('apercu.js')].join('\n');
}

// Injecte dans le HTML de pandoc la CSP, le bandeau, les styles de survol et le script.
function injecterApercu(contenu, nonce, ligne) {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; font-src data:; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">';
  const ajout =
    '<style>' + lireMedia('apercu.css') + '</style>' +
    '<div id="szh-bandeau"><span>' + T('apercu.bandeau') + '</span>' +
    '<button id="szh-basculer" type="button">' + T('apercu.bandeau.pdf') + '</button></div>' +
    '<script nonce="' + nonce + '">' + scriptApercu(ligne) + '</script>';
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
  // Le rendu d'une bibliographie occupe la même colonne : il se ferme aussi, sinon un
  // formulaire pleine page s'ouvrirait derrière lui.
  await fermerApercuMd();
  session.poserApercuCourantUri(null);
}

// ---- Aperçu d'une bibliographie -------------------------------------------------
//
// <slug>.biblio.md est de la prose : une référence par paragraphe, collée depuis Zotero.
// Son aperçu est celui de l'aperçu Markdown de l'éditeur, qui se rafraîchit à la frappe
// sans compilation.
function estBiblio(chemin) { return /\.biblio\.md$/i.test(String(chemin || '')); }

function estOngletMd(entree) {
  return !!(entree && typeof entree.viewType === 'string' && entree.viewType.indexOf(VUE_MD) !== -1);
}

function apercuMdOuvert() { return !!ctx.ongletOuvert(estOngletMd); }

async function fermerApercuMd() { await ctx.fermerOnglets(estOngletMd); }

// Le texte en colonne 1, son rendu en colonne 2. Le focus revient au texte, que
// `markdown.showPreviewToSide` laisse sur le rendu.
async function ouvrirApercuBiblio(uri) {
  await fermerTousLesApercus();            // la colonne 2 n'affiche qu'un aperçu à la fois
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

// Le fichier d'aperçu HTML d'une unité, selon le profil actif. Livre :
// out/chapitres/<slug>.apercu.html, que outUnite désigne déjà. Revue :
// out/<slug>/<slug>.apercu.html, outUnite étant le dossier de sortie de l'article.
// C'est le seul endroit qui fasse ce choix ; extension.js s'en sert aussi.
function cheminApercuHtml(racine, slug) {
  const profil = profils.courant();
  const c = profils.chemins(profil, racine, slug);
  return profil.cle === 'livre' ? c.outUnite : path.join(c.outUnite, slug + '.apercu.html');
}

// Repli : le .html complet que pandoc écrit pour le PDF. Il n'existe que pour un article ;
// un chapitre de livre n'a que son fragment et son aperçu (voir profil.js).
function cheminHtmlComplet(racine, slug) {
  const profil = profils.courant();
  if (profil.cle === 'livre') { return null; }
  return path.join(profils.chemins(profil, racine, slug).outUnite, slug + '.html');
}

// Dernière clé (racine|slug|mode) écrite dans .szh-apercu : évite de réécrire à chaque
// rafraîchissement si rien n'a changé.
let dernierApercuPrioritaireEcrit = null;

// Priorité de compilation : dit au Makefile quel article regarder d'abord dans le lot,
// via <racine>/.szh-apercu (une ligne « <slug> <mode> »). Efface le fichier si aucun
// aperçu n'est ouvert. Une écriture refusée (numéro verrouillé, synchronisation en cours)
// est ignorée.
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
  } catch (e) { /* numéro verrouillé, disque plein, synchronisation OneDrive en cours */ }
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
    // Numéro gelé : rien ne se compile seul, la page dit comment lancer la compilation.
    else if (compilationAutoCoupee()) { lignes.push(echapperTexte(T('apercu.gele'))); }
    contenu = '<!DOCTYPE html><html lang="fr"><head></head><body><p>'
            + lignes.join('</p><p>') + '</p></body></html>';
  }
  const html = injecterApercu(contenu, crypto.randomBytes(16).toString('hex'), ligneVisibleEditeur(fournisseur, slug));
  // Le panneau est créé s'il manque (ni reveal ni PRET), puis son HTML est réécrit à chaque
  // appel. La session garde la référence au panneau.
  if (!session.panneauApercuHtml()) {
    panneauUnique({
      viewType: 'szhApercuHtml', titre: slug,
      colonne: { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      garde: { lire: session.panneauApercuHtml, poser: session.poserPanneauApercuHtml },
      modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
      surMessage: (msg) => {
        if (msg.type === MSG.BASCULER) { vscode.commands.executeCommand('szh.basculerApercu'); return; }
        if (msg.type === MSG.REVELE) {
          if (session.apercuCourantSlug()) { revelerPos(fournisseur, session.apercuCourantSlug(), msg.pos, msg.mot); }
          return;
        }
        if (msg.type === MSG.SCROLL_SOURCE) { revelerLigneSource(fournisseur, msg.ligne); return; }
        console.warn('aperçu HTML : type de message inconnu', msg.type);
      }
    });
  }
  session.panneauApercuHtml().title = slug;
  session.panneauApercuHtml().webview.html = html;
  session.poserApercuCourantSlug(slug);
  session.poserApercuHtmlMtime(mtime);
}

function rechargerApercuHtmlSiChange(fournisseur) {
  // Réassigner webview.html déplace le focus, ce qui ferme un QuickPick ouvert
  // (Ctrl+Alt+A/S/D, choix de titre…). Le rechargement est donc différé tant qu'un
  // QuickPick est ouvert, puis réévalué : l'aperçu a pu être fermé entre-temps. Plusieurs
  // compilations pendant ce temps ne donnent qu'un rechargement.
  differer('apercu-html', () => {
    if (!session.panneauApercuHtml() || !session.apercuCourantSlug() || !fournisseur.racine || modeApercu() !== 'html') { return; }
    const slug = session.apercuCourantSlug();
    let mtime = 0;
    try { mtime = fs.statSync(cheminApercuHtml(fournisseur.racine, slug)).mtimeMs; }
    catch (e) { return; }
    if (mtime > session.apercuHtmlMtime()) { ouvrirApercuHtml(fournisseur, slug); }
  });
}

// Bascule l'aperçu HTML ⇄ PDF et enregistre szh.apercuMode ; la colonne 2 n'affiche qu'un
// aperçu à la fois.
//
// Sur une bibliographie, la même touche (Ctrl+Alt+P) ouvre ou ferme son aperçu Markdown :
// elle n'est pas compilée seule, HTML ⇄ PDF n'y a pas de sens. Le rendu ouvert sans éditeur
// de texte actif compte aussi : la webview a alors le focus, et c'est elle qu'on referme.
async function basculerApercu(fournisseur, majBarreApercu) {
  const actif = vscode.window.activeTextEditor;
  const surBiblio = !!(actif && estBiblio(actif.document.uri.fsPath));
  const mdOuvert = apercuMdOuvert();
  if (surBiblio || (mdOuvert && !actif)) {
    if (mdOuvert) { await fermerApercuMd(); }
    else { await ouvrirApercuBiblio(actif.document.uri); }
    return;
  }
  // Ailleurs : l'aperçu de l'article reprend la colonne 2, libérée du rendu d'une
  // bibliographie.
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
  cheminApercuHtml
};
