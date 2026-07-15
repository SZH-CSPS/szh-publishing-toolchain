// SZH — Revue (cockpit), tranches S2 + S3 + S4 (D36).
// Barre latérale « Revue SZH » (dans l'Explorateur, cf. S2.1) : deux sections —
// « Articles » (articles/<slug>/<slug>.md, clic = ouvrir ; actions inline
// « Ouvrir le PDF » et « Compiler ») et « Word en attente » (articles-word/*.docx
// hors _convertis/ ; compte affiché dans la description de la section ; tooltip
// « déjà converti » si le .md cible existe). La vue n'apparaît que si ausgabe.yaml
// existe à la racine (contexte szh.estRevue).
//
// S3 : commande « Importer des Word » (szh.importerWord).
// S4 : actions d'article « Ouvrir le PDF » (szh.ouvrirPdf) et « Compiler »
//   (szh.compiler). Ouverture du PDF calquée sur szh-apercu (pdf.preview,
//   ViewColumn.Beside, preserveFocus, test « déjà ouvert » partagé pour éviter la
//   double-ouverture). Jamais de vol de focus.
//
// Seule écriture (S3) : la COPIE des .docx choisis vers articles-word/. S4 est en
// lecture seule (ouverture/lancement de tâche uniquement).
// Posture szh-apercu : JavaScript pur, zéro dépendance, API VS Code ^1.75.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const CLE_CONTEXTE = 'szh.estRevue';
const ID_VUE = 'szhCockpitVue';
// ⚠ Doivent correspondre EXACTEMENT aux labels de vscodium-user/tasks.json.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
// Éditeur PDF (extension tomoki1207.pdf), comme szh-apercu.
const VUE_PDF = 'pdf.preview';
const EXT_PDF = 'tomoki1207.pdf';

// Reproduit le slug du Makefile (cible import) :
//   nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
// En JS sans iconv : on translittère les ligatures françaises courantes puis on
// supprime les diacritiques (NFD). Divergence connue (rare) : un symbole exotique
// qu'iconv//TRANSLIT convertirait en mot précis devient ici un tiret — sans effet
// visible sur des titres d'articles réels (accents et ligatures usuels couverts).
function slugifier(nomFichier) {
  let s = nomFichier.replace(/\.[^.]*$/, '');
  s = s
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'article';
}

// Racine de revue = premier dossier du workspace contenant ausgabe.yaml (D22),
// ou null si aucun (dossier quelconque -> la vue reste masquée).
function trouverRacineRevue() {
  const dossiers = vscode.workspace.workspaceFolders;
  if (!dossiers) { return null; }
  for (const d of dossiers) {
    try {
      if (fs.existsSync(path.join(d.uri.fsPath, 'ausgabe.yaml'))) { return d.uri.fsPath; }
    } catch (e) { /* dossier illisible : on continue */ }
  }
  return null;
}

class FournisseurRevue {
  constructor() {
    this.racine = null;
    this._changement = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changement.event;
  }

  definirRacine(racine) { this.racine = racine; }
  rafraichir() { this._changement.fire(); }

  getTreeItem(element) { return element; }

  getChildren(element) {
    if (!this.racine) { return []; }
    if (!element) {
      // Compte des Word en attente dans la DESCRIPTION de la section (S4) : le badge
      // de conteneur n'est plus visible depuis que la vue est dans l'Explorateur (S2.1).
      const n = this.compterWord();
      return [
        this._section('articles', 'Articles', 'book', undefined),
        this._section('word', 'Word en attente', 'inbox', n > 0 ? '(' + n + ')' : undefined)
      ];
    }
    if (element.categorie === 'articles') { return this._itemsArticles(); }
    if (element.categorie === 'word') { return this._itemsWord(); }
    return [];
  }

  _section(categorie, libelle, icone, description) {
    const it = new vscode.TreeItem(libelle, vscode.TreeItemCollapsibleState.Expanded);
    it.categorie = categorie;
    it.iconPath = new vscode.ThemeIcon(icone);
    it.contextValue = 'section';
    if (description) { it.description = description; }
    return it;
  }

  // Article = dossier articles/<slug>/ contenant le .md homonyme <slug>.md
  // (même règle que le Makefile : un dossier sans .md homonyme est ignoré).
  _itemsArticles() {
    const base = path.join(this.racine, 'articles');
    const slugs = this._sousDossiersAvecMd(base);
    if (slugs.length === 0) { return [this._vide('Aucun article pour l’instant')]; }
    return slugs.map((slug) => {
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      const it = new vscode.TreeItem(slug, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;                   // utilisé par les actions S4 (Ouvrir le PDF / Compiler)
      it.resourceUri = md;              // icône de fichier selon le thème
      it.tooltip = md.fsPath;
      it.contextValue = 'article';      // pilote les boutons inline (menus view/item/context)
      it.command = { command: 'vscode.open', title: 'Ouvrir l’article', arguments: [md] };
      return it;
    });
  }

  // Word en attente = articles-word/*.docx (niveau racine seulement -> _convertis/ exclu).
  _itemsWord() {
    const noms = this._docxEnAttente(path.join(this.racine, 'articles-word'));
    if (noms.length === 0) { return [this._vide('Aucun Word en attente')]; }
    return noms.map((nom) => {
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.contextValue = 'word';
      if (this._articleExiste(slugifier(nom))) {
        // Le .md cible existe déjà : l'import l'ignorera (D12, non-écrasement).
        it.iconPath = new vscode.ThemeIcon('warning');
        it.description = 'déjà converti';
        it.tooltip = 'Déjà converti — renommez le fichier si c’est une nouvelle version.';
      } else {
        it.iconPath = new vscode.ThemeIcon('file');
        it.tooltip = 'Word en attente d’import : ' + nom;
      }
      return it;
    });
  }

  // Élément gris « rien pour l'instant » (une section vide reste visible et lisible).
  _vide(texte) {
    const it = new vscode.TreeItem(texte, vscode.TreeItemCollapsibleState.None);
    it.iconPath = new vscode.ThemeIcon('info');
    it.contextValue = 'vide';
    return it;
  }

  compterWord() {
    if (!this.racine) { return 0; }
    return this._docxEnAttente(path.join(this.racine, 'articles-word')).length;
  }

  // Liste des slugs d'articles (dossier + .md homonyme). Sert aussi au diff d'import.
  listerArticles() {
    if (!this.racine) { return []; }
    return this._sousDossiersAvecMd(path.join(this.racine, 'articles'));
  }

  _articleExiste(slug) {
    try { return fs.statSync(path.join(this.racine, 'articles', slug, slug + '.md')).isFile(); }
    catch (e) { return false; }
  }

  _sousDossiersAvecMd(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((slug) => {
        try { return fs.statSync(path.join(base, slug, slug + '.md')).isFile(); }
        catch (e) { return false; }
      })
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  _docxEnAttente(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.docx'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }
}

// ---- PDF (S4) : ouverture calquée sur szh-apercu -------------------------------

// Test « déjà ouvert » PARTAGÉ avec szh-apercu : évite un 2ᵉ onglet.
function pdfDejaOuvert(uri) {
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.uri && entree.uri.fsPath === uri.fsPath) { return true; }
    }
  }
  return false;
}

async function ouvrirApercuPdf(uri) {
  if (pdfDejaOuvert(uri)) { return; }   // déjà ouvert -> rien (pas de double-ouverture)
  if (vscode.extensions.getExtension(EXT_PDF)) {
    await vscode.commands.executeCommand('vscode.openWith', uri, VUE_PDF, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: true
    });
  } else {
    // Repli propre (hôte de dev sans tomoki1207.pdf) : lecteur système.
    vscode.window.showInformationMessage('Aperçu PDF intégré indisponible — ouverture dans le lecteur système.');
    await vscode.env.openExternal(uri);
  }
}

// ---- Tâche de build (S4) : réutilise la tâche user, écoute la fin ---------------

let buildEnCours = false;

// Lance la tâche « Aperçu / Export PDF » et résout avec son code de sortie
// (null si la tâche est introuvable). Même mécanique que szh-apercu.
async function lancerBuild() {
  const taches = await vscode.tasks.fetchTasks();
  const tache = taches.find((t) => t.name === NOM_TACHE_BUILD);
  if (!tache) {
    vscode.window.showErrorMessage('Tâche « ' + NOM_TACHE_BUILD + ' » introuvable. Réglages de l’éditeur incomplets ?');
    return null;
  }
  const execution = await vscode.tasks.executeTask(tache);
  return await new Promise((resolve) => {
    const abo = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { abo.dispose(); resolve(e.exitCode); }
    });
  });
}

async function compiler(fournisseur) {
  if (!fournisseur.racine) { return; }
  if (buildEnCours) { vscode.window.setStatusBarMessage('Compilation déjà en cours…', 3000); return; }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage('Compilation en cours…');
  try {
    const code = await lancerBuild();
    if (code !== null && code !== 0) {
      vscode.window.showErrorMessage('La compilation a échoué. Ouvrez le panneau « ' + NOM_TACHE_BUILD + ' » pour le détail.');
    }
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

async function ouvrirPdf(fournisseur, item) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.slug) { return; }
  const slug = item.slug;
  const pdf = vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf'));

  if (fs.existsSync(pdf.fsPath)) { await ouvrirApercuPdf(pdf); return; }

  // PDF absent : compiler d'abord, ouvrir SEULEMENT en cas de succès.
  if (buildEnCours) { vscode.window.setStatusBarMessage('Compilation déjà en cours…', 3000); return; }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage('Compilation de « ' + slug + ' »…');
  try {
    const code = await lancerBuild();
    if (code === null) { return; }
    if (code !== 0) {
      vscode.window.showErrorMessage('La compilation a échoué. Ouvrez le panneau « ' + NOM_TACHE_BUILD + ' » pour le détail.');
      return;
    }
    // szh-apercu ouvre déjà le PDF de l'article ACTIF après un build réussi ; on lui
    // laisse un court instant pour enregistrer son onglet, puis le test « déjà ouvert »
    // évite le 2ᵉ onglet si c'était le même article.
    await new Promise((r) => setTimeout(r, 250));
    if (fs.existsSync(pdf.fsPath)) { await ouvrirApercuPdf(pdf); }
    else { vscode.window.showErrorMessage('PDF introuvable après compilation : « ' + slug + ' ».'); }
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

// ---- Import guidé (S3) ---------------------------------------------------------

async function executerImport() {
  const taches = await vscode.tasks.fetchTasks();
  const tache = taches.find((t) => t.name === NOM_TACHE_IMPORT);
  if (!tache) {
    vscode.window.showErrorMessage(
      'Tâche « ' + NOM_TACHE_IMPORT + ' » introuvable. Réglages de l’éditeur incomplets ?'
    );
    return null;
  }
  const execution = await vscode.tasks.executeTask(tache);
  return await new Promise((resolve) => {
    const abo = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { abo.dispose(); resolve(e.exitCode); }
    });
  });
}

async function importerWord(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }

  const choix = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: { 'Documents Word': ['docx'] },
    openLabel: 'Importer',
    title: 'Choisir les fichiers Word à importer'
  });
  if (!choix || choix.length === 0) { return; }   // dialogue annulé

  const dossierWord = path.join(racine, 'articles-word');
  try { fs.mkdirSync(dossierWord, { recursive: true }); } catch (e) { /* existe déjà */ }

  // Jamais d'écrasement silencieux : si des .docx du même nom sont déjà en
  // attente, on demande explicitement (modale). On choisit « Remplacer / Ignorer »
  // plutôt qu'un renommage auto, qui créerait en douce un article dupliqué au
  // slug suffixé — déroutant pour un rédacteur.
  const conflits = choix.filter((u) => fs.existsSync(path.join(dossierWord, path.basename(u.fsPath))));
  let remplacer = true;
  if (conflits.length > 0) {
    const noms = conflits.map((u) => path.basename(u.fsPath)).join(', ');
    const rep = await vscode.window.showWarningMessage(
      'Ces fichiers sont déjà en attente : ' + noms + '.\nQue faire ?',
      { modal: true },
      'Remplacer', 'Ignorer ces fichiers'
    );
    if (rep === undefined) { return; }             // annulé
    remplacer = (rep === 'Remplacer');
  }

  let copies = 0;
  for (const u of choix) {
    const dest = path.join(dossierWord, path.basename(u.fsPath));
    if (fs.existsSync(dest) && !remplacer) { continue; }
    try { fs.copyFileSync(u.fsPath, dest); copies++; }
    catch (e) { vscode.window.showErrorMessage('Copie impossible : ' + path.basename(u.fsPath) + ' (' + e.message + ')'); }
  }
  if (copies === 0) { rafraichirTout(); return; }

  // Diff avant/après (le compte ne repose PAS sur la sortie de la tâche).
  const avant = new Set(fournisseur.listerArticles());
  const codeSortie = await executerImport();
  rafraichirTout();
  if (codeSortie === null) { return; }             // tâche introuvable (déjà signalé)
  if (codeSortie !== 0) {
    vscode.window.showErrorMessage(
      'L’import a rencontré un problème. Ouvrez le panneau de la tâche « ' + NOM_TACHE_IMPORT + ' » pour le détail.'
    );
    return;
  }
  let n = 0;
  for (const slug of fournisseur.listerArticles()) { if (!avant.has(slug)) { n++; } }
  if (n > 0) {
    vscode.window.showInformationMessage(n + (n > 1 ? ' articles importés.' : ' article importé.'));
  } else {
    vscode.window.showInformationMessage('Aucun nouvel article importé (déjà présent(s) ?).');
  }
}

function activate(context) {
  const fournisseur = new FournisseurRevue();
  const vue = vscode.window.createTreeView(ID_VUE, {
    treeDataProvider: fournisseur,
    showCollapseAll: false
  });
  context.subscriptions.push(vue);

  let watchers = [];
  // Un SEUL nettoyage enregistré (les watchers ne sont plus poussés dans
  // context.subscriptions à chaque réinstallation — correctif du nit S2).
  context.subscriptions.push({ dispose: () => { for (const w of watchers) { w.dispose(); } } });

  // Le compte « Word en attente » est recalculé par getChildren (description de section).
  const rafraichirTout = () => { fournisseur.rafraichir(); };

  // Regroupe les rafales d'événements FS (OneDrive peut en émettre plusieurs).
  let minuteur = null;
  const rafraichirBientot = () => {
    if (minuteur) { clearTimeout(minuteur); }
    minuteur = setTimeout(() => { minuteur = null; rafraichirTout(); }, 300);
  };

  const reinstallerWatchers = (racine) => {
    for (const w of watchers) { w.dispose(); }
    watchers = [];
    if (!racine) { return; }
    // Articles, Word déposés, ET sorties (le PDF apparaît/disparaît après build).
    for (const motif of ['articles/**', 'articles-word/*', 'out/**']) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(racine, motif));
      w.onDidCreate(rafraichirBientot);
      w.onDidChange(rafraichirBientot);
      w.onDidDelete(rafraichirBientot);
      watchers.push(w);
    }
  };

  // Recalcule racine + contexte (montre/masque la vue) + watchers, puis rafraîchit.
  const majContexte = () => {
    const racine = trouverRacineRevue();
    fournisseur.definirRacine(racine);
    vscode.commands.executeCommand('setContext', CLE_CONTEXTE, !!racine);
    reinstallerWatchers(racine);
    rafraichirTout();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('szh.cockpit.rafraichir', majContexte),
    vscode.commands.registerCommand('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.ouvrirPdf', (item) => ouvrirPdf(fournisseur, item)),
    vscode.commands.registerCommand('szh.compiler', () => compiler(fournisseur)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte)
  );

  majContexte();
}

function deactivate() {}

module.exports = { activate, deactivate };
