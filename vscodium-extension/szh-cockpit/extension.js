// SZH — Revue (cockpit), tranches S2 + S3 + S4 (D36).
// Barre latérale « Revue SZH » (dans l'Explorateur, cf. S2.1) : deux sections —
// « Articles » (articles/<slug>/<slug>.md, clic = ouvrir ; actions inline
// « Ouvrir le PDF » et « Compiler ») et « Word en attente » (articles-word/*.docx
// hors _convertis/ ; compte affiché dans la description de la section ; tooltip
// « déjà converti » si le .md cible existe). La vue n'apparaît que si ausgabe.yaml
// existe à la racine (contexte szh.estRevue).
//
// S3 : commande « Importer des Word » (szh.importerWord).
// S4 puis N5 (D46) : le CLIC sur un article fait tout — ouvre le .md (colonne 1),
//   compile si le PDF est obsolète (mtime) ou absent, ferme l'aperçu de l'article
//   précédent et affiche le sien (colonne 2, pdf.preview, preserveFocus). Les
//   boutons « Ouvrir le PDF » / « Compiler » de S4 sont supprimés. Jamais de vol
//   de focus. szh-apercu reste en place (rafraîchissement après Ctrl+S).
// G1 (D37) : formulaire « Méta-données du numéro » (webview szh.metadonnees) qui
//   réécrit ausgabe.yaml — sérialiseur maison, lignes non gérées préservées,
//   écriture atomique.
// G3 (D40) : « Supprimer l'article » (szh.supprimerArticle) — confirmation MODALE
//   obligatoire, puis rm de articles/<slug>/ ET out/<slug>/ (onglets fermés avant).
// G5 (D41) : article dépliable -> ses images (articles/<slug>/media/, récursif)
//   avec dimensions + poids ; clic = aperçu natif ; « Remplacer » (szh.remplacerAsset)
//   écrase l'image EN GARDANT son nom (le lien du .md reste valide).
// N1 (D42) : dormant WSL (sleep infinity dans SZH-Publishing) tant qu'une revue est
//   ouverte — pas de démarrage à froid à la première compilation.
//
// Écritures autorisées : la COPIE des .docx choisis vers articles-word/ (S3),
// ausgabe.yaml (G1), la SUPPRESSION confirmée d'un article (G3) et l'ÉCRASEMENT
// confirmé d'une image (G5). Tout le reste est en lecture seule (ouverture/
// lancement de tâche uniquement).
// Posture szh-apercu : JavaScript pur, zéro dépendance, API VS Code ^1.75.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CLE_CONTEXTE = 'szh.estRevue';
const ID_VUE = 'szhCockpitVue';
// ⚠ Doivent correspondre EXACTEMENT aux labels de vscodium-user/tasks.json.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const NOM_TACHE_EXPORT = 'Tout exporter';
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

// ---- Maintien en vie de WSL (N1, D42) ---------------------------------------------
//
// Les builds sont des `wsl.exe` éphémères : entre deux Ctrl+S la VM WSL s'éteint
// (vmIdleTimeout) et la compilation suivante paie un démarrage à froid. Tant qu'une
// revue est ouverte, on maintient un processus DORMANT dans la distro du pipeline —
// il ne consomme rien et empêche l'extinction de la VM. Tué quand on quitte la
// revue, à la désactivation, et de toute façon nettoyé par un `wsl --shutdown`/reboot.

// ⚠ Doit correspondre à la distro de vscodium-user/tasks.json et szh-common.ps1.
const DISTRO = 'SZH-Publishing';

let dormeurWsl = null;

// wsl.exe : System32 en priorité (chemin sûr), PATH en repli.
function cheminWsl() {
  const systeme = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wsl.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'wsl.exe';
}

function demarrerDormeurWsl() {
  if (dormeurWsl) { return; }                      // un seul dormant à la fois
  let proc;
  try {
    proc = spawn(cheminWsl(), ['-d', DISTRO, '--', 'sh', '-c', 'exec sleep infinity'],
      { windowsHide: true, stdio: 'ignore' });
  } catch (e) { return; }                          // wsl introuvable : poste non bootstrappé
  dormeurWsl = proc;
  // Distro absente ou wsl en erreur : silencieux (l'activation ne doit jamais être
  // bloquée ni bruyante) ; on retentera au prochain changement de contexte.
  proc.on('error', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
  proc.on('exit', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
}

function arreterDormeurWsl() {
  if (!dormeurWsl) { return; }
  const proc = dormeurWsl;
  dormeurWsl = null;                               // avant kill : l'écouteur exit ne re-nettoie pas
  try { proc.kill(); } catch (e) { /* déjà mort */ }
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
    if (element.contextValue === 'article') { return this._itemsAssets(element.slug); }
    return [];
  }

  _section(categorie, libelle, icone, description) {
    const it = new vscode.TreeItem(libelle, vscode.TreeItemCollapsibleState.Expanded);
    it.categorie = categorie;
    it.iconPath = new vscode.ThemeIcon(icone);
    it.contextValue = 'section-' + categorie;   // 'section-articles' / 'section-word'
    if (description) { it.description = description; }
    return it;
  }

  // Article = dossier articles/<slug>/ contenant le .md homonyme <slug>.md
  // (même règle que le Makefile : un dossier sans .md homonyme est ignoré).
  // G5/N6 : l'article est DÉPLIABLE s'il a des images OU des tableaux (la flèche
  // montre les assets, le clic sur le libellé ouvre l'article — risque R2).
  _itemsArticles() {
    const base = path.join(this.racine, 'articles');
    const slugs = this._sousDossiersAvecMd(base);
    if (slugs.length === 0) { return [this._vide('Aucun article pour l’instant')]; }
    return slugs.map((slug) => {
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      const aDesAssets = this._imagesArticle(slug).length > 0 || this._tablesArticle(slug).length > 0;
      const it = new vscode.TreeItem(slug, aDesAssets
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None);
      it.slug = slug;                   // utilisé par les actions S4/G3/G5
      it.resourceUri = md;              // icône de fichier selon le thème
      it.tooltip = md.fsPath;
      it.contextValue = 'article';      // pilote les boutons inline (menus view/item/context)
      // N5 (D46) : le clic fait tout — .md en colonne 1, build si obsolète,
      // aperçu en colonne 2 (l'aperçu du précédent article est fermé).
      it.command = {
        command: 'szh.ouvrirArticle', title: 'Ouvrir l’article',
        arguments: [slug]
      };
      return it;
    });
  }

  // Images d'un article : articles/<slug>/media/, récursif, extensions d'image
  // seulement. Chemins RELATIFS à media/ (lisibles en libellé), triés.
  _imagesArticle(slug) {
    const base = path.join(this.racine, 'articles', slug, 'media');
    const resultats = [];
    const parcourir = (dossier, prefixe) => {
      let entrees;
      try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
      catch (e) { return; }
      for (const e of entrees) {
        if (e.isDirectory()) { parcourir(path.join(dossier, e.name), prefixe + e.name + '/'); }
        else if (e.isFile() && /\.(png|jpe?g|gif|svg)$/i.test(e.name)) { resultats.push(prefixe + e.name); }
      }
    };
    parcourir(base, '');
    return resultats.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Tableaux extraits d'un article (N6, D47) : tables/*.html, triés.
  _tablesArticle(slug) {
    const base = path.join(this.racine, 'articles', slug, 'tables');
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Enfants d'un article : images (G5, « L × H · poids ») puis tableaux (N6).
  _itemsAssets(slug) {
    const base = path.join(this.racine, 'articles', slug, 'media');
    const images = this._imagesArticle(slug).map((relatif) => {
      const chemin = path.join(base, relatif);
      const it = new vscode.TreeItem(relatif, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cheminAsset = chemin;
      it.resourceUri = vscode.Uri.file(chemin);
      it.contextValue = 'asset';
      it.description = decrireImage(chemin);
      it.tooltip = chemin;
      // Aperçu natif de VSCodium, colonne 1 (côté texte, comme le .md).
      it.command = {
        command: 'vscode.open', title: 'Aperçu de l’image',
        arguments: [it.resourceUri, { viewColumn: vscode.ViewColumn.One }]
      };
      return it;
    });
    const baseTables = path.join(this.racine, 'articles', slug, 'tables');
    const tables = this._tablesArticle(slug).map((nom) => {
      const chemin = path.join(baseTables, nom);
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cheminAsset = chemin;
      it.iconPath = new vscode.ThemeIcon('table');
      it.contextValue = 'table';
      it.description = decrireImage(chemin);      // pas une image : poids seul
      it.tooltip = chemin + ' — clic = éditer le HTML du tableau';
      // Édition directe du HTML (copier-coller possible), colonne 1.
      it.command = {
        command: 'vscode.open', title: 'Ouvrir le tableau',
        arguments: [vscode.Uri.file(chemin), { viewColumn: vscode.ViewColumn.One }]
      };
      return it;
    });
    return images.concat(tables);
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

// L'éditeur pdf.preview (tomoki1207.pdf) est MONO-INSTANCE (pas de
// supportsMultipleEditorsPerDocument) : openWith RÉVÈLE l'onglet existant sans le
// dupliquer. On appelle donc openWith même si le PDF est déjà ouvert -> « Ouvrir le
// PDF » ramène l'aperçu au premier plan. preserveFocus:true : on révèle sans voler
// le focus de l'éditeur. (C'était le rôle du test « déjà ouvert » retiré ici : il
// empêchait le rappel au premier plan sans rien apporter, l'anti-doublon étant déjà
// garanti par le mono-instance.)
async function ouvrirApercuPdf(uri) {
  if (vscode.extensions.getExtension(EXT_PDF)) {
    // Colonne 2 (droite) FIXE — pas « Beside » (relatif), qui empilait des colonnes
    // 3, 4… selon la vue active. Mise en page à deux vues : gauche = .md, droite = PDF.
    await vscode.commands.executeCommand('vscode.openWith', uri, VUE_PDF, {
      viewColumn: vscode.ViewColumn.Two,
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

// Lance une tâche user par son label exact et résout avec son code de sortie
// (null si la tâche est introuvable). Même mécanique que szh-apercu.
async function lancerTache(nomTache) {
  const taches = await vscode.tasks.fetchTasks();
  const tache = taches.find((t) => t.name === nomTache);
  if (!tache) {
    vscode.window.showErrorMessage('Tâche « ' + nomTache + ' » introuvable. Réglages de l’éditeur incomplets ?');
    return null;
  }
  const execution = await vscode.tasks.executeTask(tache);
  return await new Promise((resolve) => {
    const abo = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { abo.dispose(); resolve(e.exitCode); }
    });
  });
}

function lancerBuild() { return lancerTache(NOM_TACHE_BUILD); }

// « Tout exporter » (N3, D44) : rebuild FORCÉ de toute la revue. Ferme d'abord les
// aperçus ouverts sous out/ — le clean du Makefile supprime out/, et un PDF affiché
// est verrouillé côté Windows (R6). Notifie le compte d'articles exportés.
async function toutExporter(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage('Compilation ou import en cours — réessayez ensuite.', 3000);
    return;
  }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage('Export complet de la revue…');
  try {
    await fermerOngletsSous(path.join(racine, 'out'));
    apercuCourantUri = null;                       // tous les aperçus viennent d'être fermés
    const code = await lancerTache(NOM_TACHE_EXPORT);
    rafraichirTout();
    if (code === null) { return; }                 // tâche introuvable (déjà signalé)
    if (code !== 0) {
      vscode.window.showErrorMessage('L’export complet a échoué. Ouvrez le panneau « ' + NOM_TACHE_EXPORT + ' » pour le détail.');
      return;
    }
    const n = fournisseur.listerArticles().length;
    vscode.window.showInformationMessage(n + (n > 1 ? ' articles exportés.' : ' article exporté.'));
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

// ---- Clic = aperçu direct (N5, D46) -----------------------------------------------

// URI du PDF actuellement affiché PAR LE COCKPIT (l'aperçu du précédent article est
// fermé avant d'ouvrir le suivant — deux colonnes stables, pas d'onglets qui
// s'empilent). szh-apercu, lui, ne fait que rafraîchir/ouvrir l'article ACTIF.
let apercuCourantUri = null;

async function fermerApercuCourant(saufUri) {
  const courant = apercuCourantUri;
  if (!courant) { return; }
  if (saufUri && courant.fsPath.toLowerCase() === saufUri.fsPath.toLowerCase()) { return; }
  apercuCourantUri = null;
  const cible = courant.fsPath.toLowerCase();
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.uri && entree.uri.fsPath && entree.uri.fsPath.toLowerCase() === cible) {
        aFermer.push(onglet);
      }
    }
  }
  if (aFermer.length > 0) {
    try { await vscode.window.tabGroups.close(aFermer); } catch (e) { /* déjà fermé */ }
  }
}

// Le geste unique du rédacteur : cliquer un article = voir son texte ET son PDF.
// 1. .md en colonne 1 ; 2. build si PDF absent/obsolète (mtime), incrémental ;
// 3. fermer l'aperçu de l'article précédent ; 4. aperçu en colonne 2.
// En cas d'échec de build : le .md reste ouvert, erreur sobre, PAS d'aperçu
// obsolète trompeur.
async function ouvrirArticle(fournisseur, slug) {
  const racine = fournisseur.racine;
  if (!racine || typeof slug !== 'string' || slug === '') { return; }
  const md = path.join(racine, 'articles', slug, slug + '.md');
  const pdf = vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf'));

  await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md), { viewColumn: vscode.ViewColumn.One });

  // Obsolète = PDF plus ancien que la source la plus récente (.md, un tableau
  // extrait OU la fiche .meta.yaml — même graphe de dépendances que la règle
  // HTML du Makefile, N6 + M1).
  let obsolete = true;
  try {
    let mSource = fs.statSync(md).mtimeMs;
    const dossierTables = path.join(racine, 'articles', slug, 'tables');
    let tables = [];
    try { tables = fs.readdirSync(dossierTables); } catch (e) { /* pas de tableaux */ }
    for (const t of tables) {
      if (!/\.html?$/i.test(t)) { continue; }
      try { mSource = Math.max(mSource, fs.statSync(path.join(dossierTables, t)).mtimeMs); }
      catch (e) { /* fichier disparu entre-temps */ }
    }
    try { mSource = Math.max(mSource, fs.statSync(cheminMeta(racine, slug)).mtimeMs); }
    catch (e) { /* pas de fiche */ }
    obsolete = fs.statSync(pdf.fsPath).mtimeMs < mSource;
  } catch (e) { obsolete = true; }                 // PDF (ou .md) illisible -> on compile

  if (obsolete) {
    if (buildEnCours) { vscode.window.setStatusBarMessage('Compilation déjà en cours…', 3000); return; }
    buildEnCours = true;
    const statut = vscode.window.setStatusBarMessage('Compilation de « ' + slug + ' »…');
    try {
      const code = await lancerBuild();
      if (code === null) { return; }               // tâche introuvable (déjà signalé)
      if (code !== 0) {
        vscode.window.showErrorMessage('La compilation a échoué. Ouvrez le panneau « ' + NOM_TACHE_BUILD + ' » pour le détail.');
        return;
      }
    } finally {
      statut.dispose();
      buildEnCours = false;
    }
  }
  if (!fs.existsSync(pdf.fsPath)) {
    vscode.window.showErrorMessage('PDF introuvable après compilation : « ' + slug + ' ».');
    return;
  }
  await fermerApercuCourant(pdf);                  // l'aperçu du précédent article
  await ouvrirApercuPdf(pdf);                      // mono-instance : révèle si déjà là
  apercuCourantUri = pdf;
}

// ---- Import guidé (S3) ---------------------------------------------------------

let importEnCours = false;

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

// Convertit les Word présents dans articles-word/ (déposés à la main OU copiés par
// « Importer des Word »). Compte les NOUVEAUX articles par diff avant/après (jamais
// par parsing de la sortie). Garde anti-double (clics rapprochés).
async function lancerConversion(fournisseur, rafraichirTout) {
  if (importEnCours) { vscode.window.setStatusBarMessage('Import déjà en cours…', 3000); return; }
  importEnCours = true;
  const statut = vscode.window.setStatusBarMessage('Import des Word en attente…');
  try {
    const avant = new Set(fournisseur.listerArticles());
    const code = await executerImport();
    rafraichirTout();
    if (code === null) { return; }               // tâche introuvable (déjà signalé)
    if (code !== 0) {
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
  } finally {
    statut.dispose();
    importEnCours = false;
  }
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

  // Conversion + notification (compte par diff) — mutualisée avec « Convertir les
  // Word en attente ».
  await lancerConversion(fournisseur, rafraichirTout);
}

// ---- Assets (G5, D41) : dimensions sans dépendance + « Remplacer » ----------------

// Dimensions lues des en-têtes de fichier — PNG/GIF/SVG sûrs, JPEG au mieux
// (parcours des marqueurs jusqu'au SOF). null si indéterminable : la description
// retombe alors sur le poids seul. Seuls les premiers Ko sont lus.
function lireDimensionsImage(chemin) {
  let fd = null;
  try {
    fd = fs.openSync(chemin, 'r');
    const tampon = Buffer.alloc(65536);
    const lu = fs.readSync(fd, tampon, 0, tampon.length, 0);
    const b = tampon.subarray(0, lu);
    if (lu >= 24 && b.readUInt32BE(0) === 0x89504e47) {          // PNG : IHDR
      return { largeur: b.readUInt32BE(16), hauteur: b.readUInt32BE(20) };
    }
    if (lu >= 10 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) {
      return { largeur: b.readUInt16LE(6), hauteur: b.readUInt16LE(8) };
    }
    if (lu >= 4 && b[0] === 0xff && b[1] === 0xd8) {             // JPEG : marqueurs SOF
      let i = 2;
      while (i + 9 < lu) {
        if (b[i] !== 0xff) { i++; continue; }
        const marqueur = b[i + 1];
        if (marqueur === 0xff) { i++; continue; }                 // bourrage FF
        if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd7) || marqueur === 0x01) { i += 2; continue; }
        if (marqueur === 0xda) { break; }                         // début des données : SOF manqué
        const longueur = b.readUInt16BE(i + 2);
        if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) {
          return { largeur: b.readUInt16BE(i + 7), hauteur: b.readUInt16BE(i + 5) };
        }
        if (longueur < 2) { break; }                              // en-tête corrompu
        i += 2 + longueur;
      }
      return null;
    }
    if (/\.svg$/i.test(chemin)) {                                 // SVG : attributs ou viewBox
      const texte = b.toString('utf8');
      const balise = texte.match(/<svg[^>]*>/i);
      if (balise) {
        const l = balise[0].match(/[\s"']width\s*=\s*["']?([0-9.]+)(?:px)?["']?/i);
        const h = balise[0].match(/[\s"']height\s*=\s*["']?([0-9.]+)(?:px)?["']?/i);
        if (l && h) { return { largeur: Math.round(parseFloat(l[1])), hauteur: Math.round(parseFloat(h[1])) }; }
        const vb = balise[0].match(/viewBox\s*=\s*["']\s*[0-9.+-]+[\s,]+[0-9.+-]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
        if (vb) { return { largeur: Math.round(parseFloat(vb[1])), hauteur: Math.round(parseFloat(vb[2])) }; }
      }
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* déjà fermé */ } }
  }
}

// « 1 234 × 567 · 245 Ko » — poids en o/Ko/Mo (virgule française pour les Mo).
function decrireImage(chemin) {
  let octets = 0;
  try { octets = fs.statSync(chemin).size; } catch (e) { return ''; }
  let poids;
  if (octets < 1024) { poids = octets + ' o'; }
  else if (octets < 1024 * 1024) { poids = Math.round(octets / 1024) + ' Ko'; }
  else { poids = (octets / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo'; }
  const dims = lireDimensionsImage(chemin);
  return dims ? dims.largeur + ' × ' + dims.hauteur + ' · ' + poids : poids;
}

// Extension « logique » pour la comparaison de formats (jpg et jpeg = même format).
function formatImage(nom) {
  const ext = (nom.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

// « Remplacer » (D41) : écrase l'image cible EN GARDANT son nom — le lien du .md
// reste valide. Jamais silencieux : confirmation modale, renforcée si le format
// du fichier choisi diffère de la cible (risque R4 : contenu ≠ extension).
async function remplacerAsset(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage('Compilation ou import en cours — réessayez ensuite.', 3000);
    return;
  }
  const cible = item.cheminAsset;
  const nomCible = path.basename(cible);
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'svg'] },
    openLabel: 'Choisir cette image',
    title: 'Choisir l’image de remplacement pour « ' + nomCible + ' »'
  });
  if (!choix || choix.length === 0) { return; }    // dialogue annulé
  const source = choix[0].fsPath;
  const nomSource = path.basename(source);
  let question = 'Remplacer « ' + nomCible + ' » par « ' + nomSource + ' » ?';
  let detail = 'L’ancienne image sera écrasée. Le nom « ' + nomCible + ' » est conservé (le texte de l’article pointe ce nom).';
  if (formatImage(nomSource) !== formatImage(nomCible)) {
    detail = '⚠ Le fichier choisi est un .' + formatImage(nomSource) + ' mais l’image de l’article est un .' +
      formatImage(nomCible) + ' : le contenu ne correspondra plus à l’extension et le rendu peut casser.\n' + detail;
  }
  const reponse = await vscode.window.showWarningMessage(question, { modal: true, detail: detail }, 'Remplacer');
  if (reponse !== 'Remplacer') { return; }         // annulé : rien n'est touché
  try {
    fs.copyFileSync(source, cible);                // même nom : lien du .md intact
    vscode.window.setStatusBarMessage('Image « ' + nomCible + ' » remplacée — recompilez pour voir le PDF à jour.', 5000);
  } catch (e) {
    vscode.window.showErrorMessage('Remplacement impossible : ' + e.message);
  }
  rafraichirTout();
}

// « Remplacer » un tableau (N6, D47) : écrase tables/table-NN.html par un fichier
// .html choisi, EN GARDANT le nom (la référence du .md reste valide). Jamais
// silencieux : confirmation modale. L'édition fine se fait au clic (fichier HTML).
async function remplacerTable(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage('Compilation ou import en cours — réessayez ensuite.', 3000);
    return;
  }
  const cible = item.cheminAsset;
  const nomCible = path.basename(cible);
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Tableaux HTML': ['html', 'htm'] },
    openLabel: 'Choisir ce tableau',
    title: 'Choisir le fichier HTML de remplacement pour « ' + nomCible + ' »'
  });
  if (!choix || choix.length === 0) { return; }    // dialogue annulé
  const source = choix[0].fsPath;
  const reponse = await vscode.window.showWarningMessage(
    'Remplacer « ' + nomCible + ' » par « ' + path.basename(source) + ' » ?',
    { modal: true, detail: 'L’ancien tableau sera écrasé. Le nom « ' + nomCible + ' » est conservé (l’article pointe ce nom).' },
    'Remplacer'
  );
  if (reponse !== 'Remplacer') { return; }         // annulé : rien n'est touché
  try {
    fs.copyFileSync(source, cible);
    vscode.window.setStatusBarMessage('Tableau « ' + nomCible + ' » remplacé — recompilez pour voir le PDF à jour.', 5000);
  } catch (e) {
    vscode.window.showErrorMessage('Remplacement impossible : ' + e.message);
  }
  rafraichirTout();
}

// ---- Suppression d'article (G3, D40) ---------------------------------------------

// Ferme les onglets dont le fichier vit sous `dossier` (comparaison insensible à la
// casse — système de fichiers Windows) : un onglet ouvert sur un fichier supprimé
// resterait sinon en « fantôme » avec une erreur à la première interaction.
async function fermerOngletsSous(dossier) {
  const prefixe = (dossier + path.sep).toLowerCase();
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.uri && entree.uri.fsPath &&
          entree.uri.fsPath.toLowerCase().indexOf(prefixe) === 0) {
        aFermer.push(onglet);
      }
    }
  }
  if (aFermer.length > 0) {
    try { await vscode.window.tabGroups.close(aFermer); } catch (e) { /* onglet déjà fermé */ }
  }
}

// Première action DESTRUCTIVE du cockpit : confirmation modale obligatoire, nommant
// l'article (D40, risque R6) — jamais de suppression silencieuse.
async function supprimerArticle(fournisseur, rafraichirTout, item) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.slug) { return; }
  const slug = item.slug;
  // Pas de suppression pendant un build/import : make pourrait recréer out/<slug>
  // ou lire un dossier à moitié effacé.
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage('Compilation ou import en cours — réessayez ensuite.', 3000);
    return;
  }
  const reponse = await vscode.window.showWarningMessage(
    'Supprimer l’article « ' + slug + ' » et son PDF ?',
    { modal: true, detail: 'Les dossiers articles/' + slug + ' et out/' + slug + ' seront définitivement effacés.\nAction irréversible.' },
    'Supprimer'
  );
  if (reponse !== 'Supprimer') { return; }         // annulé : rien n'est touché
  const dossierArticle = path.join(racine, 'articles', slug);
  const dossierSortie = path.join(racine, 'out', slug);
  try {
    await fermerOngletsSous(dossierArticle);
    await fermerOngletsSous(dossierSortie);
    fs.rmSync(dossierArticle, { recursive: true, force: true });
    fs.rmSync(dossierSortie, { recursive: true, force: true });
    vscode.window.setStatusBarMessage('Article « ' + slug + ' » supprimé.', 3000);
  } catch (e) {
    vscode.window.showErrorMessage('Suppression incomplète de « ' + slug + ' » : ' + e.message);
  }
  rafraichirTout();
}

// ---- Méta-données du numéro (G1, D37) --------------------------------------------
//
// ausgabe.yaml est un YAML PLAT (clé: valeur, une par ligne). Pas de lib YAML :
// un sérialiseur maison qui ne touche QUE les lignes des clés du schéma D37 —
// toute autre ligne (commentaires, subtitle:, clés futures) est préservée
// byte pour byte, fins de ligne (LF/CRLF) et BOM compris.

const CLES_METADONNEES = ['title', 'revue', 'volume', 'numero', 'date', 'lang'];

// Découpe la partie droite d'un « clé: reste » en { valeur, suite } — `suite` est
// l'éventuel commentaire de fin de ligne, AVEC ses espaces de tête, restitué tel
// quel à l'écriture. Gère les scalaires nus, « … » (échappes \" et \\) et '…'
// (échappe ''). Un droit malformé est traité comme scalaire nu (best effort).
function decouperValeurYaml(reste) {
  reste = String(reste);
  if (reste.startsWith('"')) {
    let i = 1, fin = -1;
    while (i < reste.length) {
      if (reste[i] === '\\') { i += 2; continue; }
      if (reste[i] === '"') { fin = i; break; }
      i++;
    }
    if (fin !== -1 && /^\s*(#.*)?$/.test(reste.slice(fin + 1))) {
      return {
        valeur: reste.slice(1, fin).replace(/\\(["\\])/g, '$1'),
        suite: reste.slice(fin + 1).replace(/\s+$/, '')
      };
    }
  } else if (reste.startsWith("'")) {
    const m = reste.match(/^'((?:[^']|'')*)'(\s*(?:#.*)?)$/);
    if (m) { return { valeur: m[1].replace(/''/g, "'"), suite: m[2].replace(/\s+$/, '') }; }
  }
  // Scalaire nu : le commentaire commence à « espace(s) + # » (ou « # » en tête) ;
  // toute la plage d'espaces fait partie de `suite` (alignement restitué tel quel).
  let debutComm = -1;
  if (reste.startsWith('#')) { debutComm = 0; }
  else {
    const m = reste.match(/\s+#/);
    if (m) { debutComm = m.index; }
  }
  if (debutComm === -1) { return { valeur: reste.trim(), suite: '' }; }
  return { valeur: reste.slice(0, debutComm).trim(), suite: reste.slice(debutComm).replace(/\s+$/, '') };
}

// Valeurs du schéma D37 actuellement dans le fichier (clés absentes : non définies).
function analyserAusgabe(contenu) {
  const valeurs = {};
  for (const ligne of contenu.split(/\r?\n/)) {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || CLES_METADONNEES.indexOf(m[1]) === -1) { continue; }
    if (!(m[1] in valeurs)) { valeurs[m[1]] = decouperValeurYaml(m[2]).valeur; }
  }
  return valeurs;
}

// ---- Frontmatter d'article (N7, D48) -----------------------------------------------
//
// Les métadonnées d'un article vivent dans le frontmatter YAML de son <slug>.md
// (créé s'il manque). Clés gérées : title, subtitle, author (liste structurée
// name/affiliation/orcid), doi, keywords (liste). Tout le reste — corps de
// l'article, clés inconnues, commentaires — est préservé VERBATIM (risque R1).

const CLES_FRONTMATTER = ['title', 'subtitle', 'author', 'doi', 'keywords'];

// Découpe un article : { bom, fm, corps, eol }. Le frontmatter n'existe que si la
// PREMIÈRE ligne du fichier est exactement « --- » ; il se ferme à la première
// ligne « --- » ou « ... ». Un « --- » plus loin dans le corps (règle horizontale)
// n'est JAMAIS pris pour une borne. `fm` = texte brut entre les bornes (null si
// absent) ; `corps` = tout le reste, restitué tel quel.
function separerFrontmatter(texte) {
  texte = String(texte);
  const bom = texte.charAt(0) === '\uFEFF' ? '\uFEFF' : '';
  const sansBom = bom ? texte.slice(1) : texte;
  const eol = sansBom.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const finLigne1 = sansBom.search(/\r?\n/);
  const ligne1 = finLigne1 === -1 ? sansBom : sansBom.slice(0, finLigne1);
  if (finLigne1 === -1 || !/^---\s*$/.test(ligne1)) {
    return { bom: bom, fm: null, corps: sansBom, eol: eol };
  }
  const debutFm = finLigne1 + (sansBom.charAt(finLigne1) === '\r' ? 2 : 1);
  let position = debutFm;
  while (position <= sansBom.length) {
    const finLigne = sansBom.indexOf('\n', position);
    const finBrute = finLigne === -1 ? sansBom.length : finLigne;
    let ligne = sansBom.slice(position, finBrute);
    if (ligne.charAt(ligne.length - 1) === '\r') { ligne = ligne.slice(0, -1); }
    if (/^(---|\.\.\.)\s*$/.test(ligne)) {
      const fm = sansBom.slice(debutFm, position).replace(/\r?\n$/, '');
      const corps = finLigne === -1 ? '' : sansBom.slice(finLigne + 1);
      return { bom: bom, fm: fm, corps: corps, eol: eol };
    }
    if (finLigne === -1) { break; }
    position = finLigne + 1;
  }
  return { bom: bom, fm: null, corps: sansBom, eol: eol };  // borne jamais fermée
}

// Valeurs des clés gérées d'un frontmatter (best effort sur l'existant).
// author accepte : scalaire (« author: Jean ») -> [{name}], liste de scalaires,
// liste de mappings (name/affiliation/orcid). keywords accepte : scalaire,
// flow ([a, b]) et liste « - mot ».
// Découpe l'intérieur d'une liste flow « [a, "b, c", d] » sur les virgules HORS
// guillemets (échappes \" et '' respectées).
function decouperFlowYaml(interieur) {
  const morceaux = [];
  let courant = '';
  let guillemet = null;
  for (let j = 0; j < interieur.length; j++) {
    const c = interieur.charAt(j);
    if (guillemet !== null) {
      courant += c;
      if (guillemet === '"' && c === '\\') { courant += interieur.charAt(j + 1); j++; continue; }
      if (c === guillemet) {
        if (guillemet === "'" && interieur.charAt(j + 1) === "'") { courant += "'"; j++; continue; }
        guillemet = null;
      }
      continue;
    }
    if (c === '"' || c === "'") { guillemet = c; courant += c; continue; }
    if (c === ',') { morceaux.push(courant); courant = ''; continue; }
    courant += c;
  }
  if (courant.trim() !== '') { morceaux.push(courant); }
  return morceaux;
}

function analyserFrontmatter(fm) {
  const valeurs = {};
  if (fm === null || fm === undefined) { return valeurs; }
  const lignes = String(fm).split(/\r?\n/);
  let i = 0;
  while (i < lignes.length) {
    const m = lignes[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const cle = m[1];
    const reste = m[2];
    if (cle === 'author') {
      const auteurs = [];
      const net = reste.trim();
      if (net !== '' && net.charAt(0) !== '#') {
        auteurs.push({ name: decouperValeurYaml(reste).valeur });
        i++;
      } else {
        i++;
        let courant = null;
        while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
          const item = lignes[i].match(/^\s*-\s*(.*)$/);
          const champ = lignes[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
          if (item) {
            courant = {};
            auteurs.push(courant);
            const interne = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
            if (interne) { courant[interne[1]] = decouperValeurYaml(interne[2]).valeur; }
            else if (item[1].trim() !== '') { courant.name = decouperValeurYaml(item[1]).valeur; }
          } else if (champ && courant) {
            courant[champ[1]] = decouperValeurYaml(champ[2]).valeur;
          }
          i++;
        }
      }
      valeurs.author = auteurs
        .map((a) => ({
          name: String(a.name || ''), affiliation: String(a.affiliation || ''), orcid: String(a.orcid || '')
        }))
        .filter((a) => a.name !== '' || a.affiliation !== '' || a.orcid !== '');
      continue;
    }
    if (cle === 'keywords') {
      const mots = [];
      const net = reste.trim();
      if (net.charAt(0) === '[') {
        for (const morceau of decouperFlowYaml(net.replace(/^\[/, '').replace(/\]\s*$/, ''))) {
          const v = decouperValeurYaml(morceau.trim()).valeur;
          if (v !== '') { mots.push(v); }
        }
        i++;
      } else if (net !== '' && net.charAt(0) !== '#') {
        mots.push(decouperValeurYaml(net).valeur);
        i++;
      } else {
        i++;
        while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
          const item = lignes[i].match(/^\s*-\s*(.*)$/);
          if (item) {
            const v = decouperValeurYaml(item[1]).valeur;
            if (v !== '') { mots.push(v); }
          }
          i++;
        }
      }
      valeurs.keywords = mots;
      continue;
    }
    if (CLES_FRONTMATTER.indexOf(cle) !== -1 && !(cle in valeurs)) {
      valeurs[cle] = decouperValeurYaml(reste).valeur;
    }
    i++;
  }
  return valeurs;
}

function citerFrontmatter(valeur) {
  return '"' + String(valeur).replace(/([\\"])/g, '\\$1') + '"';
}

// Lignes canoniques d'une clé gérée. [] si la valeur est « vide » -> la clé est
// RETIRÉE du frontmatter (pas de clé fantôme « "" » côté pandoc).
function lignesCleFrontmatter(cle, valeur) {
  if (cle === 'author') {
    const auteurs = (Array.isArray(valeur) ? valeur : [])
      .map((a) => ({
        name: String((a && a.name) || '').trim(),
        affiliation: String((a && a.affiliation) || '').trim(),
        orcid: String((a && a.orcid) || '').trim()
      }))
      .filter((a) => a.name !== '' || a.affiliation !== '' || a.orcid !== '');
    if (auteurs.length === 0) { return []; }
    const lignes = ['author:'];
    for (const a of auteurs) {
      let premiere = true;
      for (const champ of ['name', 'affiliation', 'orcid']) {
        if (a[champ] === '') { continue; }
        lignes.push((premiere ? '- ' : '  ') + champ + ': ' + citerFrontmatter(a[champ]));
        premiere = false;
      }
    }
    return lignes;
  }
  if (cle === 'keywords') {
    const mots = (Array.isArray(valeur) ? valeur : [])
      .map((v) => String(v).trim())
      .filter((v) => v !== '');
    if (mots.length === 0) { return []; }
    return ['keywords:'].concat(mots.map((v) => '- ' + citerFrontmatter(v)));
  }
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (v === '') { return []; }
  return [cle + ': ' + citerFrontmatter(v)];
}

// Réécrit le document : les clés gérées de `modifies` sont régénérées EN PLACE
// (à la position de leur première occurrence), les clés absentes sont ajoutées en
// fin de frontmatter (ordre D48), les lignes inconnues (clés libres, commentaires,
// vides) sont restituées telles quelles et le CORPS n'est jamais touché. Crée le
// bloc s'il manque ; le supprime s'il devient vide. BOM/CRLF préservés.
function serialiserFrontmatter(texte, modifies) {
  const partie = separerFrontmatter(texte);
  const fmLignes = (partie.fm === null || partie.fm === '') ? [] : partie.fm.split(/\r?\n/);
  const segments = [];
  for (const ligne of fmLignes) {
    const cle = (ligne.match(/^([A-Za-z0-9_-]+):/) || [])[1];
    if (cle) { segments.push({ cle: cle, lignes: [ligne] }); continue; }
    const dernier = segments[segments.length - 1];
    // Continuation d'une clé : ligne indentée ou item de liste « - … ».
    if (dernier && dernier.cle && (/^\s+\S/.test(ligne) || /^\s*-\s/.test(ligne))) {
      dernier.lignes.push(ligne);
    } else {
      segments.push({ cle: null, lignes: [ligne] });
    }
  }
  const restantes = new Set(
    Object.keys(modifies).filter((c) => CLES_FRONTMATTER.indexOf(c) !== -1)
  );
  const sortie = [];
  for (const s of segments) {
    if (s.cle && restantes.has(s.cle)) {
      restantes.delete(s.cle);
      const nouvelles = lignesCleFrontmatter(s.cle, modifies[s.cle]);
      for (const l of nouvelles) { sortie.push(l); }
    } else {
      for (const l of s.lignes) { sortie.push(l); }
    }
  }
  for (const cle of CLES_FRONTMATTER) {
    if (!restantes.has(cle)) { continue; }
    const nouvelles = lignesCleFrontmatter(cle, modifies[cle]);
    for (const l of nouvelles) { sortie.push(l); }
  }
  if (sortie.length === 0) { return partie.bom + partie.corps; }  // plus de frontmatter
  const eol = partie.eol;
  return partie.bom + '---' + eol + sortie.join(eol) + eol + '---' + eol + partie.corps;
}

// ---- Métadonnées d'article : fichier caché <slug>.meta.yaml (M1, D49/D51) ----------
//
// SUPERSEDE le stockage frontmatter de N7 : le .md ne contient QUE le texte ; les
// métadonnées vivent dans articles/<slug>/<slug>.meta.yaml (masqué par
// files.exclude, édité UNIQUEMENT par le formulaire). Fichier « form-owned » :
// régénéré à chaque enregistrement — les clés inconnues de haut niveau sont
// restituées par prudence. Lu par pandoc via --metadata-file (après ausgabe.yaml :
// l'article surcharge le numéro).

const TYPES_ARTICLE = ['varia', 'documentation', 'article', 'interview', 'tribune-libre', 'editorial'];
// Libellés traduits des types (DE/IT : premier jet à valider par Robin).
const LIBELLES_TYPES = {
  'varia':         { fr: 'Varia',         de: 'Varia',         it: 'Varia' },
  'documentation': { fr: 'Documentation', de: 'Dokumentation', it: 'Documentazione' },
  'article':       { fr: 'Article',       de: 'Artikel',       it: 'Articolo' },
  'interview':     { fr: 'Interview',     de: 'Interview',     it: 'Intervista' },
  'tribune-libre': { fr: 'Tribune libre', de: 'Freie Tribüne',  it: 'Tribuna libera' },
  'editorial':     { fr: 'Éditorial',     de: 'Editorial',     it: 'Editoriale' }
};
const LANGUES_META = ['fr', 'de', 'it'];   // fr + de affichées ; it activable par carte
const CHAMPS_AUTEUR = ['prenom', 'nom', 'fonction', 'affiliation', 'orcid'];

// Langue de la revue (base : « de-CH » -> « de ») limitée aux langues du schéma.
function langueRevue(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* repli fr */ }
  const base = String(valeurs.lang || 'fr').toLowerCase().slice(0, 2);
  return LANGUES_META.indexOf(base) !== -1 ? base : 'fr';
}

// analyserMeta(texte) -> { type, doi, title:{}, subtitle:{}, keywords:{}, author:[],
// _inconnues:[lignes brutes] }. Best effort : maps par langue en bloc OU en flow
// ({ fr: "…" }), listes en bloc OU en flow, auteurs en mappings.
function analyserMeta(texte) {
  const valeurs = { type: '', doi: '', title: {}, subtitle: {}, keywords: {}, author: [], _inconnues: [] };
  if (!texte) { return valeurs; }
  const lignes = String(texte).split(/\r?\n/);
  let i = 0;
  while (i < lignes.length) {
    const m = lignes[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      if (lignes[i].trim() !== '' && lignes[i].trim().charAt(0) !== '#') { valeurs._inconnues.push(lignes[i]); }
      i++;
      continue;
    }
    const cle = m[1];
    const reste = m[2];
    if (cle === 'type') { valeurs.type = decouperValeurYaml(reste).valeur; i++; continue; }
    if (cle === 'doi') { valeurs.doi = decouperValeurYaml(reste).valeur; i++; continue; }
    if (cle === 'title' || cle === 'subtitle') {
      const map = {};
      const net = reste.trim();
      if (net.charAt(0) === '{') {
        for (const partie of decouperFlowYaml(net.replace(/^\{/, '').replace(/\}\s*$/, ''))) {
          const mm = partie.match(/^\s*([A-Za-z-]+)\s*:\s*(.*)$/);
          if (mm) { map[mm[1]] = decouperValeurYaml(mm[2].trim()).valeur; }
        }
        i++;
      } else {
        i++;
        while (i < lignes.length && /^\s+\S/.test(lignes[i])) {
          const mm = lignes[i].match(/^\s+([A-Za-z-]+):\s*(.*)$/);
          if (mm) { map[mm[1]] = decouperValeurYaml(mm[2]).valeur; }
          i++;
        }
      }
      valeurs[cle] = map;
      continue;
    }
    if (cle === 'keywords') {
      const map = {};
      let langue = null;
      i++;
      while (i < lignes.length && /^\s+\S/.test(lignes[i])) {
        const mItem = lignes[i].match(/^\s+-\s*(.*)$/);
        const mLang = mItem ? null : lignes[i].match(/^\s+([A-Za-z-]+):\s*(.*)$/);
        if (mLang) {
          langue = mLang[1];
          map[langue] = map[langue] || [];
          const netL = mLang[2].trim();
          if (netL.charAt(0) === '[') {
            for (const p of decouperFlowYaml(netL.replace(/^\[/, '').replace(/\]\s*$/, ''))) {
              const v = decouperValeurYaml(p.trim()).valeur;
              if (v !== '') { map[langue].push(v); }
            }
          }
        } else if (mItem && langue) {
          const v = decouperValeurYaml(mItem[1]).valeur;
          if (v !== '') { map[langue].push(v); }
        }
        i++;
      }
      valeurs.keywords = map;
      continue;
    }
    if (cle === 'author') {
      const auteurs = [];
      let courant = null;
      i++;
      while (i < lignes.length && !/^[A-Za-z0-9_-]+:/.test(lignes[i])) {
        const item = lignes[i].match(/^\s*-\s*(.*)$/);
        const champ = item ? null : lignes[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
        if (item) {
          courant = {};
          auteurs.push(courant);
          const interne = item[1].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (interne) { courant[interne[1]] = decouperValeurYaml(interne[2]).valeur; }
          else if (item[1].trim() !== '') { courant.nom = decouperValeurYaml(item[1]).valeur; }
        } else if (champ && courant) {
          courant[champ[1]] = decouperValeurYaml(champ[2]).valeur;
        }
        i++;
      }
      valeurs.author = auteurs
        .map((a) => {
          const propre = {};
          for (const c of CHAMPS_AUTEUR) { propre[c] = String(a[c] || ''); }
          return propre;
        })
        .filter((a) => CHAMPS_AUTEUR.some((c) => a[c] !== ''));
      continue;
    }
    // Clé inconnue de haut niveau : sa ligne + ses continuations, restituées telles quelles.
    valeurs._inconnues.push(lignes[i]);
    i++;
    while (i < lignes.length && (/^\s+\S/.test(lignes[i]) || /^\s*-\s/.test(lignes[i]))) {
      valeurs._inconnues.push(lignes[i]);
      i++;
    }
  }
  return valeurs;
}

// serialiserMeta(valeurs) -> YAML régénéré (ordre D51 : type, doi, title, subtitle,
// keywords, author, puis clés inconnues). Valeurs vides omises ; langue sans
// contenu omise ; auteur entièrement vide ignoré. LF, fin de fichier à la ligne.
function serialiserMeta(valeurs) {
  const v = valeurs || {};
  const lignes = [];
  const type = String(v.type || '').trim();
  if (TYPES_ARTICLE.indexOf(type) !== -1) { lignes.push('type: ' + type); }
  const doi = String(v.doi || '').trim();
  if (doi !== '') { lignes.push('doi: ' + citerFrontmatter(doi)); }
  for (const cle of ['title', 'subtitle']) {
    const map = v[cle] || {};
    const sous = [];
    for (const l of LANGUES_META) {
      const t = String(map[l] || '').trim();
      if (t !== '') { sous.push('  ' + l + ': ' + citerFrontmatter(t)); }
    }
    if (sous.length > 0) {
      lignes.push(cle + ':');
      for (const s of sous) { lignes.push(s); }
    }
  }
  const km = v.keywords || {};
  const sousMots = [];
  for (const l of LANGUES_META) {
    const liste = (Array.isArray(km[l]) ? km[l] : []).map((x) => String(x).trim()).filter((x) => x !== '');
    if (liste.length > 0) {
      sousMots.push('  ' + l + ':');
      for (const mot of liste) { sousMots.push('  - ' + citerFrontmatter(mot)); }
    }
  }
  if (sousMots.length > 0) {
    lignes.push('keywords:');
    for (const s of sousMots) { lignes.push(s); }
  }
  const auteurs = (Array.isArray(v.author) ? v.author : [])
    .map((a) => {
      const propre = {};
      for (const c of CHAMPS_AUTEUR) { propre[c] = String((a && a[c]) || '').trim(); }
      return propre;
    })
    .filter((a) => CHAMPS_AUTEUR.some((c) => a[c] !== ''));
  if (auteurs.length > 0) {
    lignes.push('author:');
    for (const a of auteurs) {
      let premiere = true;
      for (const c of CHAMPS_AUTEUR) {
        if (a[c] === '') { continue; }
        lignes.push((premiere ? '- ' : '  ') + c + ': ' + citerFrontmatter(a[c]));
        premiere = false;
      }
    }
  }
  for (const brute of (Array.isArray(v._inconnues) ? v._inconnues : [])) { lignes.push(brute); }
  return lignes.length > 0 ? lignes.join('\n') + '\n' : '';
}

// ---- Titre de la vue (N2, D43) -----------------------------------------------------
//
// « {Z|R}{AAAA}-{numero} | {title} » : Z pour une revue allemande (lang commence
// par de), R sinon ; AAAA = première séquence de 4 chiffres de `date` ; chaque
// morceau manquant est omis (le préfixe seul ne compte pas). Si rien n'est
// exploitable -> nom du dossier de la revue. Jamais de titre vide.
function titreNumero(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : replis ci-dessous */ }
  const prefixe = String(valeurs.lang || '').toLowerCase().indexOf('de') === 0 ? 'Z' : 'R';
  const annee = (String(valeurs.date || '').match(/\d{4}/) || [''])[0];
  const numero = String(valeurs.numero || '').trim();
  const titre = String(valeurs.title || '').trim();
  const morceaux = [];
  if (annee || numero) { morceaux.push(prefixe + annee + (numero ? '-' + numero : '')); }
  if (titre) { morceaux.push(titre); }
  if (morceaux.length === 0) { return path.basename(racine); }
  return morceaux.join(' | ');
}

// Représentation YAML d'une valeur du formulaire. Tout est cité « "…" » (sûr pour
// deux-points, dièses, guillemets, accents), SAUF `lang` : le Makefile lit cette
// clé avec un sed qui ne comprend pas les guillemets (LANG_LUE) → jeton nu,
// restreint à [a-zA-Z-] (le formulaire ne propose que fr/de/en/it).
function formaterValeurYaml(cle, valeur) {
  if (cle === 'lang') { return String(valeur).replace(/[^a-zA-Z-]/g, '') || 'fr'; }
  return '"' + String(valeur).replace(/([\\"])/g, '\\$1') + '"';
}

// Réécrit `contenu` avec les clés de `modifies` : lignes existantes mises à jour
// (commentaire de fin conservé), clés absentes ajoutées en fin de fichier (ordre
// D37, sauf valeur vide : rien à ajouter). Aucune autre ligne n'est modifiée.
function serialiserAusgabe(contenu, modifies) {
  const eol = contenu.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const bom = contenu.charAt(0) === '\uFEFF' ? '\uFEFF' : '';
  const corps = bom ? contenu.slice(1) : contenu;
  const lignes = corps === '' ? [] : corps.split(/\r?\n/);
  if (lignes.length > 0 && lignes[lignes.length - 1] === '') { lignes.pop(); }
  const restantes = new Set(Object.keys(modifies));
  const resultat = lignes.map((ligne) => {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || !restantes.has(m[1])) { return ligne; }
    restantes.delete(m[1]);
    // `suite` garde ses espaces de tête (restitution telle quelle de l'alignement
    // du commentaire) ; s'il colle à la valeur (droit « "x"# c »), on intercale un espace.
    const suite = decouperValeurYaml(m[2]).suite;
    return m[1] + ': ' + formaterValeurYaml(m[1], modifies[m[1]]) + (suite ? (/^\s/.test(suite) ? suite : ' ' + suite) : '');
  });
  for (const cle of CLES_METADONNEES) {
    if (!restantes.has(cle)) { continue; }
    if (String(modifies[cle]) === '') { continue; }
    resultat.push(cle + ': ' + formaterValeurYaml(cle, modifies[cle]));
  }
  return bom + resultat.join(eol) + (resultat.length > 0 ? eol : '');
}

// Écriture atomique : temporaire « ~$… » dans le même dossier (préfixe ignoré par
// la synchro OneDrive, comme le PDF du Makefile) puis rename — jamais de fichier
// à moitié écrit, même si l'éditeur est fermé en plein enregistrement.
function ecrireAusgabeAtomique(chemin, contenu) {
  const tmp = path.join(path.dirname(chemin), '~$' + path.basename(chemin));
  try {
    fs.writeFileSync(tmp, contenu, 'utf8');
    fs.renameSync(tmp, chemin);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
}

// Formulaire (webview) — CSP stricte : aucun réseau, styles inline, script à nonce.
// Les valeurs ne sont PAS injectées dans le HTML : elles arrivent par postMessage
// (le webview envoie « pret » au chargement), donc zéro échappement HTML à gérer.
function htmlMetadonnees(nonce) {
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>Méta-données du numéro</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background);\n' +
    '  padding: 1rem 1.2rem; max-width: 34rem; }\n' +
    'h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 .25rem; }\n' +
    'p.note { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; font-size: .88em; }\n' +
    'label { display: block; margin: .8rem 0 .25rem; font-weight: 600; font-size: .92em; }\n' +
    'input, select { width: 100%; box-sizing: border-box; padding: .35em .5em; font: inherit;\n' +
    '  color: var(--vscode-input-foreground); background: var(--vscode-input-background);\n' +
    '  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }\n' +
    'input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }\n' +
    '.indice { color: var(--vscode-descriptionForeground); font-size: .82em; margin-top: .2rem; }\n' +
    'button { margin-top: 1.2rem; padding: .45em 1.1em; border: none; border-radius: 2px; font: inherit;\n' +
    '  color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }\n' +
    'button:hover { background: var(--vscode-button-hoverBackground); }\n' +
    '#etat { margin-left: .8rem; font-size: .92em; color: var(--vscode-descriptionForeground); }\n' +
    '</style>\n</head>\n<body>\n' +
    '<h1>Méta-données du numéro</h1>\n' +
    '<p class="note">Enregistrées dans <code>ausgabe.yaml</code> — seuls les champs modifiés sont réécrits, le reste du fichier est préservé.</p>\n' +
    '<form id="formulaire">\n' +
    '<label for="title">Titre du dossier thématique</label><input id="title" type="text">\n' +
    '<label for="revue">Nom de la revue</label><input id="revue" type="text">\n' +
    '<label for="volume">Volume</label><input id="volume" type="text">\n' +
    '<label for="numero">Numéro</label><input id="numero" type="text">\n' +
    '<label for="date">Date de publication</label><input id="date" type="date">\n' +
    '<div class="indice" id="indiceDate" hidden></div>\n' +
    '<label for="lang">Langue du numéro</label>\n' +
    '<select id="lang"><option value="">(non définie)</option><option value="fr">français</option>' +
    '<option value="de">allemand</option><option value="en">anglais</option><option value="it">italien</option></select>\n' +
    '<button type="submit">Enregistrer</button><span id="etat" role="status"></span>\n' +
    '</form>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const CLES = ['title', 'revue', 'volume', 'numero', 'date', 'lang'];\n" +
    '  const modifies = new Set();\n' +
    "  const etat = document.getElementById('etat');\n" +
    '  function remplir(valeurs) {\n' +
    '    for (const cle of CLES) {\n' +
    '      const champ = document.getElementById(cle);\n' +
    "      const v = valeurs[cle] === undefined ? '' : String(valeurs[cle]);\n" +
    '      champ.value = v;\n' +
    "      if (cle === 'date') {\n" +
    "        const indice = document.getElementById('indiceDate');\n" +
    '        if (v && champ.value !== v) {\n' +
    "          indice.textContent = 'Valeur actuelle dans le fichier : « ' + v + ' » — choisir une date la remplacera.';\n" +
    '          indice.hidden = false;\n' +
    '        } else { indice.hidden = true; }\n' +
    '      }\n' +
    "      if (cle === 'lang' && champ.value !== v) { champ.value = ''; }\n" +
    '    }\n' +
    '    modifies.clear();\n' +
    "    etat.textContent = '';\n" +
    '  }\n' +
    '  for (const cle of CLES) {\n' +
    "    document.getElementById(cle).addEventListener('input', function () { modifies.add(cle); etat.textContent = ''; });\n" +
    '  }\n' +
    "  document.getElementById('formulaire').addEventListener('submit', function (e) {\n" +
    '    e.preventDefault();\n' +
    "    if (modifies.size === 0) { etat.textContent = 'Aucune modification.'; return; }\n" +
    '    const envoi = {};\n' +
    '    for (const cle of modifies) { envoi[cle] = document.getElementById(cle).value; }\n' +
    "    vscodeApi.postMessage({ type: 'enregistrer', modifies: envoi });\n" +
    '  });\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { remplir(msg.valeurs || {}); }\n" +
    "    if (msg.type === 'enregistre') { modifies.clear(); etat.textContent = '✓ Enregistré'; }\n" +
    "    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }\n" +
    '  });\n' +
    "  vscodeApi.postMessage({ type: 'pret' });\n" +
    '})();\n' +
    '</script>\n</body>\n</html>\n';
}

let panneauMetadonnees = null;

function envoyerValeursMetadonnees(panneau, chemin) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(chemin, 'utf8')); }
  catch (e) { /* fichier illisible : formulaire vide */ }
  panneau.webview.postMessage({ type: 'valeurs', valeurs: valeurs });
}

// Panneau singleton : rouvrir la commande RÉVÈLE le formulaire existant (valeurs
// relues du disque) au lieu d'en empiler un deuxième. Colonne 1 = côté texte.
// `rafraichirTout` (N2) : le titre de la vue suit immédiatement l'enregistrement.
function ouvrirMetadonnees(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const chemin = path.join(racine, 'ausgabe.yaml');
  if (panneauMetadonnees) {
    panneauMetadonnees.reveal(vscode.ViewColumn.One);
    envoyerValeursMetadonnees(panneauMetadonnees, chemin);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhMetadonnees', 'Méta-données du numéro', vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauMetadonnees = panneau;
  panneau.onDidDispose(() => { if (panneauMetadonnees === panneau) { panneauMetadonnees = null; } });
  panneau.webview.html = htmlMetadonnees(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeursMetadonnees(panneau, chemin); return; }
    if (msg.type !== 'enregistrer') { return; }
    // Seuls les champs MODIFIÉS arrivent : un champ que le formulaire n'a pas su
    // afficher (ex. date « 2026 » dans un type=date) n'est jamais écrasé en douce.
    const modifies = {};
    for (const cle of CLES_METADONNEES) {
      if (msg.modifies && typeof msg.modifies[cle] === 'string') {
        modifies[cle] = msg.modifies[cle].replace(/[\r\n]+/g, ' ').slice(0, 500).trim();
      }
    }
    if (Object.keys(modifies).length === 0) { return; }
    try {
      let contenu = '';
      try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
      ecrireAusgabeAtomique(chemin, serialiserAusgabe(contenu, modifies));
      panneau.webview.postMessage({ type: 'enregistre' });
      vscode.window.setStatusBarMessage('ausgabe.yaml enregistré.', 3000);
      if (rafraichirTout) { rafraichirTout(); }    // titre de la vue à jour (N2)
    } catch (e) {
      panneau.webview.postMessage({ type: 'erreur', message: 'Écriture impossible : ' + e.message });
    }
  });
}

// ---- Éditeur des métadonnées de TOUS les articles (N7 refondu par M1, D49/D51) -----

// Webview « Métadonnées des articles » : une carte par article — type (menu
// déroulant traduit), doi, title/subtitle/keywords TRADUCTIBLES (FR/DE toujours,
// IT révélé par la case « + Italien »), auteurs répétables à 5 champs. DOM
// construit sans injection HTML, valeurs par postMessage, dirty PAR ARTICLE.
function htmlApercuMetadonnees(nonce) {
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>Métadonnées des articles</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background);\n' +
    '  padding: 1rem 1.2rem; max-width: 46rem; }\n' +
    'h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 .25rem; }\n' +
    'p.note { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; font-size: .88em; }\n' +
    '.carte { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));\n' +
    '  border-radius: 4px; padding: .8rem 1rem 1rem; margin: 0 0 1rem; }\n' +
    '.carte h2 { font-size: 1em; font-weight: 600; margin: 0 0 .2rem; font-family: var(--vscode-editor-font-family, monospace); }\n' +
    'label { display: block; margin: .6rem 0 .2rem; font-weight: 600; font-size: .9em; }\n' +
    'input, select { width: 100%; box-sizing: border-box; padding: .3em .5em; font: inherit;\n' +
    '  color: var(--vscode-input-foreground); background: var(--vscode-input-background);\n' +
    '  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }\n' +
    'input:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }\n' +
    '.auteur { display: flex; gap: .4rem; margin: .3rem 0; align-items: center; }\n' +
    '.auteur input { flex: 1 1 0; min-width: 0; }\n' +
    '.champ-it { display: none; }\n' +
    '.carte.avec-it .champ-it { display: block; }\n' +
    '.case-it { font-weight: normal; margin-top: .8rem; }\n' +
    '.case-it input { width: auto; margin-right: .35em; }\n' +
    'button { padding: .35em .9em; border: none; border-radius: 2px; font: inherit; cursor: pointer;\n' +
    '  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));\n' +
    '  background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); }\n' +
    'button.principal { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }\n' +
    'button.principal:hover { background: var(--vscode-button-hoverBackground); }\n' +
    'button.retirer { flex: 0 0 auto; padding: .3em .6em; }\n' +
    '.barre { position: sticky; top: 0; background: var(--vscode-editor-background);\n' +
    '  padding: .4rem 0 .6rem; margin-bottom: .6rem; z-index: 1; }\n' +
    '#etat { margin-left: .8rem; font-size: .92em; color: var(--vscode-descriptionForeground); }\n' +
    '.modifie h2::after { content: " ●"; color: var(--vscode-charts-orange, orange); }\n' +
    '</style>\n</head>\n<body>\n' +
    '<h1>Métadonnées des articles</h1>\n' +
    '<p class="note">Enregistrées dans la fiche de l’article (fichier caché, édité par ce formulaire uniquement) — seuls les articles modifiés (●) sont réécrits. Le texte de l’article n’est jamais touché.</p>\n' +
    '<div class="barre"><button class="principal" id="enregistrer">Enregistrer</button><span id="etat" role="status"></span></div>\n' +
    '<div id="cartes"></div>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const etat = document.getElementById('etat');\n" +
    "  const conteneur = document.getElementById('cartes');\n" +
    '  const modifies = new Set();\n' +
    '  let TYPES = [];\n' +
    '  function marquer(carte, slug) { modifies.add(slug); carte.classList.add(\'modifie\'); etat.textContent = \'\'; }\n' +
    '  function champTexte(carte, parent, slug, cle, langue, libelle, valeur) {\n' +
    "    const l = document.createElement('label');\n" +
    '    l.textContent = libelle;\n' +
    "    const i = document.createElement('input');\n" +
    "    i.type = 'text';\n" +
    '    i.value = valeur || \'\';\n' +
    '    i.dataset.cle = cle;\n' +
    '    if (langue) { i.dataset.langue = langue; l.classList.add(\'champ-\' + langue); i.classList.add(\'champ-\' + langue); }\n' +
    "    i.addEventListener('input', function () { marquer(carte, slug); });\n" +
    '    parent.appendChild(l);\n' +
    '    parent.appendChild(i);\n' +
    '  }\n' +
    '  function ligneAuteur(carte, slug, zone, auteur) {\n' +
    "    const rangee = document.createElement('div');\n" +
    "    rangee.className = 'auteur';\n" +
    "    for (const [cle, indice] of [['prenom', 'Prénom'], ['nom', 'Nom'], ['fonction', 'Fonction'], ['affiliation', 'Affiliation'], ['orcid', 'ORCID']]) {\n" +
    "      const i = document.createElement('input');\n" +
    "      i.type = 'text';\n" +
    '      i.placeholder = indice;\n' +
    '      i.title = indice;\n' +
    '      i.value = (auteur && auteur[cle]) || \'\';\n' +
    '      i.dataset.cle = cle;\n' +
    "      i.addEventListener('input', function () { marquer(carte, slug); });\n" +
    '      rangee.appendChild(i);\n' +
    '    }\n' +
    "    const retirer = document.createElement('button');\n" +
    "    retirer.type = 'button';\n" +
    "    retirer.className = 'retirer';\n" +
    "    retirer.textContent = '✕';\n" +
    "    retirer.title = 'Retirer cet auteur';\n" +
    "    retirer.addEventListener('click', function () { rangee.remove(); marquer(carte, slug); });\n" +
    '    rangee.appendChild(retirer);\n' +
    '    zone.appendChild(rangee);\n' +
    '  }\n' +
    '  function rendre(articles) {\n' +
    '    conteneur.textContent = \'\';\n' +
    '    modifies.clear();\n' +
    '    for (const article of articles) {\n' +
    "      const carte = document.createElement('div');\n" +
    "      carte.className = 'carte';\n" +
    '      carte.dataset.slug = article.slug;\n' +
    "      const titre = document.createElement('h2');\n" +
    '      titre.textContent = article.slug;\n' +
    '      carte.appendChild(titre);\n' +
    '      const v = article.valeurs || {};\n' +
    '      const avecIt = [\'title\', \'subtitle\'].some(function (c) { return v[c] && v[c].it; }) ||\n' +
    '        (v.keywords && v.keywords.it && v.keywords.it.length > 0);\n' +
    '      if (avecIt) { carte.classList.add(\'avec-it\'); }\n' +
    "      const lType = document.createElement('label');\n" +
    "      lType.textContent = 'Type d’article';\n" +
    '      carte.appendChild(lType);\n' +
    "      const selection = document.createElement('select');\n" +
    "      selection.dataset.cle = 'type';\n" +
    "      const optVide = document.createElement('option');\n" +
    "      optVide.value = '';\n" +
    "      optVide.textContent = '(non défini)';\n" +
    '      selection.appendChild(optVide);\n' +
    '      for (const t of TYPES) {\n' +
    "        const opt = document.createElement('option');\n" +
    '        opt.value = t.valeur;\n' +
    '        opt.textContent = t.libelle;\n' +
    '        selection.appendChild(opt);\n' +
    '      }\n' +
    '      selection.value = v.type || \'\';\n' +
    '      if (selection.value !== (v.type || \'\')) { selection.value = \'\'; }\n' +
    "      selection.addEventListener('input', function () { marquer(carte, article.slug); });\n" +
    '      carte.appendChild(selection);\n' +
    '      const langues = [\'fr\', \'de\', \'it\'];   // IT toujours construit, révélé par CSS\n' +
    '      const nomsLangues = { fr: \'FR\', de: \'DE\', it: \'IT\' };\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'title\', lg, \'Titre (\' + nomsLangues[lg] + \')\', (v.title || {})[lg]);\n' +
    '      }\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'subtitle\', lg, \'Sous-titre (\' + nomsLangues[lg] + \')\', (v.subtitle || {})[lg]);\n' +
    '      }\n' +
    "      const lAuteurs = document.createElement('label');\n" +
    "      lAuteurs.textContent = 'Auteur(s) — prénom, nom, fonction, affiliation, ORCID';\n" +
    '      carte.appendChild(lAuteurs);\n' +
    "      const zone = document.createElement('div');\n" +
    "      zone.className = 'auteurs';\n" +
    '      carte.appendChild(zone);\n' +
    '      for (const a of (v.author || [])) { ligneAuteur(carte, article.slug, zone, a); }\n' +
    "      const ajouter = document.createElement('button');\n" +
    "      ajouter.type = 'button';\n" +
    "      ajouter.textContent = '➕ Ajouter un auteur';\n" +
    "      ajouter.addEventListener('click', function () { ligneAuteur(carte, article.slug, zone, null); marquer(carte, article.slug); });\n" +
    '      carte.appendChild(ajouter);\n' +
    '      champTexte(carte, carte, article.slug, \'doi\', null, \'DOI\', v.doi);\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'keywords\', lg, \'Mots-clés (\' + nomsLangues[lg] + \', séparés par des virgules)\', ((v.keywords || {})[lg] || []).join(\', \'));\n' +
    '      }\n' +
    '      const caseIt = document.createElement(\'label\');\n' +
    "      caseIt.className = 'case-it';\n" +
    "      const coche = document.createElement('input');\n" +
    "      coche.type = 'checkbox';\n" +
    '      coche.checked = avecIt;\n' +
    '      caseIt.appendChild(coche);\n' +
    "      caseIt.appendChild(document.createTextNode(' + Italien (champs IT)'));\n" +
    "      coche.addEventListener('change', function () {\n" +
    "        carte.classList.toggle('avec-it', coche.checked);\n" +
    '      });\n' +
    '      carte.appendChild(caseIt);\n' +
    '      conteneur.appendChild(carte);\n' +
    '    }\n' +
    '  }\n' +
    '  function collecter(carte) {\n' +
    '    const resultat = { type: \'\', doi: \'\', title: {}, subtitle: {}, keywords: {}, author: [] };\n' +
    "    const sel = carte.querySelector('select[data-cle=type]');\n" +
    '    if (sel) { resultat.type = sel.value; }\n' +
    "    for (const i of carte.querySelectorAll(':scope > input')) {\n" +
    '      const cle = i.dataset.cle;\n' +
    '      const langue = i.dataset.langue;\n' +
    "      if (cle === 'doi') { resultat.doi = i.value; }\n" +
    "      else if (cle === 'title' || cle === 'subtitle') { resultat[cle][langue] = i.value; }\n" +
    "      else if (cle === 'keywords') {\n" +
    '        resultat.keywords[langue] = i.value.split(\',\').map(function (s) { return s.trim(); }).filter(function (s) { return s !== \'\'; });\n' +
    '      }\n' +
    '    }\n' +
    "    for (const rangee of carte.querySelectorAll('.auteur')) {\n" +
    '      const a = {};\n' +
    "      for (const i of rangee.querySelectorAll('input')) { a[i.dataset.cle] = i.value; }\n" +
    '      resultat.author.push(a);\n' +
    '    }\n' +
    '    return resultat;\n' +
    '  }\n' +
    "  document.getElementById('enregistrer').addEventListener('click', function () {\n" +
    "    if (modifies.size === 0) { etat.textContent = 'Aucune modification.'; return; }\n" +
    '    const envoi = {};\n' +
    "    for (const carte of conteneur.querySelectorAll('.carte')) {\n" +
    '      if (modifies.has(carte.dataset.slug)) { envoi[carte.dataset.slug] = collecter(carte); }\n' +
    '    }\n' +
    "    vscodeApi.postMessage({ type: 'enregistrer', articles: envoi });\n" +
    '  });\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { TYPES = msg.types || []; rendre(msg.articles || []); }\n" +
    "    if (msg.type === 'enregistre') { etat.textContent = '✓ ' + msg.n + ' article(s) enregistré(s)'; }\n" +
    "    if (msg.type === 'erreur') { etat.textContent = '⚠ ' + msg.message; }\n" +
    '  });\n' +
    "  vscodeApi.postMessage({ type: 'pret' });\n" +
    '})();\n' +
    '</script>\n</body>\n</html>\n';
}

let panneauArticles = null;

function cheminMeta(racine, slug) {
  return path.join(racine, 'articles', slug, slug + '.meta.yaml');
}

// Migration défensive (M1, idempotente) : un <slug>.md qui porte encore un
// frontmatter N7 (lot non déployé) est déplacé vers <slug>.meta.yaml — scalaires
// rangés sous la langue de la revue, name -> nom — puis le frontmatter est retiré
// du .md (le bloc disparaît s'il ne contenait que des clés gérées). Sans objet
// (no-op) si le .meta.yaml existe déjà ou si le .md n'a pas de frontmatter géré.
function migrerFrontmatterVersMeta(racine, slug) {
  const fichierMeta = cheminMeta(racine, slug);
  if (fs.existsSync(fichierMeta)) { return; }
  const fichierMd = path.join(racine, 'articles', slug, slug + '.md');
  let texte;
  try { texte = fs.readFileSync(fichierMd, 'utf8'); } catch (e) { return; }
  const partie = separerFrontmatter(texte);
  if (partie.fm === null) { return; }
  const ancien = analyserFrontmatter(partie.fm);
  const aDesCles = ancien.title !== undefined || ancien.subtitle !== undefined ||
    ancien.doi !== undefined || (ancien.author || []).length > 0 || (ancien.keywords || []).length > 0;
  if (!aDesCles) { return; }
  const langue = langueRevue(racine);
  const valeurs = { type: '', doi: String(ancien.doi || ''), title: {}, subtitle: {}, keywords: {}, author: [] };
  if (ancien.title) { valeurs.title[langue] = String(ancien.title); }
  if (ancien.subtitle) { valeurs.subtitle[langue] = String(ancien.subtitle); }
  if ((ancien.keywords || []).length > 0) { valeurs.keywords[langue] = ancien.keywords.map(String); }
  for (const a of (ancien.author || [])) {
    valeurs.author.push({ prenom: '', nom: String(a.name || ''), fonction: '', affiliation: String(a.affiliation || ''), orcid: String(a.orcid || '') });
  }
  try {
    ecrireAusgabeAtomique(fichierMeta, serialiserMeta(valeurs));
    ecrireAusgabeAtomique(fichierMd, serialiserFrontmatter(texte, { title: '', subtitle: '', doi: '', author: [], keywords: [] }));
  } catch (e) { /* migration best effort : la carte restera vide */ }
}

function lireMetadonneesArticles(fournisseur) {
  const articles = [];
  for (const slug of fournisseur.listerArticles()) {
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = { type: '', doi: '', title: {}, subtitle: {}, keywords: {}, author: [] };
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide */ }
    delete valeurs._inconnues;                     // le webview n'a pas à les voir
    articles.push({ slug: slug, valeurs: valeurs });
  }
  return articles;
}

// Nettoie une carte reçue du webview (types + bornes ; le slug est validé contre
// la liste réelle des articles — jamais de chemin construit sur une entrée libre).
function nettoyerCarte(brut) {
  const texteCourt = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, max).trim();
  const carte = { type: '', doi: texteCourt(brut && brut.doi, 200), title: {}, subtitle: {}, keywords: {}, author: [] };
  const type = texteCourt(brut && brut.type, 40);
  if (TYPES_ARTICLE.indexOf(type) !== -1) { carte.type = type; }
  for (const cle of ['title', 'subtitle']) {
    const map = (brut && brut[cle]) || {};
    for (const l of LANGUES_META) {
      const t = texteCourt(map[l], 500);
      if (t !== '') { carte[cle][l] = t; }
    }
  }
  const km = (brut && brut.keywords) || {};
  for (const l of LANGUES_META) {
    if (!Array.isArray(km[l])) { continue; }
    const liste = [];
    for (const k of km[l].slice(0, 50)) {
      const v = texteCourt(k, 100);
      if (v !== '') { liste.push(v); }
    }
    if (liste.length > 0) { carte.keywords[l] = liste; }
  }
  if (brut && Array.isArray(brut.author)) {
    for (const a of brut.author.slice(0, 20)) {
      const propre = {};
      for (const c of CHAMPS_AUTEUR) { propre[c] = texteCourt(a && a[c], 300); }
      carte.author.push(propre);
    }
  }
  return carte;
}

function ouvrirApercuMetadonnees(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  const envoyerValeurs = (panneau) => {
    const langue = langueRevue(fournisseur.racine);
    panneau.webview.postMessage({
      type: 'valeurs',
      articles: lireMetadonneesArticles(fournisseur),
      langue: langue,
      types: TYPES_ARTICLE.map((t) => ({ valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t }))
    });
  };
  if (panneauArticles) {
    panneauArticles.reveal(vscode.ViewColumn.One);
    envoyerValeurs(panneauArticles);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhApercuMetadonnees', 'Métadonnées des articles', vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauArticles = panneau;
  panneau.onDidDispose(() => { if (panneauArticles === panneau) { panneauArticles = null; } });
  panneau.webview.html = htmlApercuMetadonnees(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeurs(panneau); return; }
    if (msg.type !== 'enregistrer' || !msg.articles) { return; }
    const connus = new Set(fournisseur.listerArticles());
    let n = 0;
    const erreurs = [];
    for (const slug of Object.keys(msg.articles)) {
      if (!connus.has(slug)) { continue; }         // slug inconnu : ignoré (sécurité)
      const fichierMeta = cheminMeta(fournisseur.racine, slug);
      try {
        // Fichier « form-owned » : régénéré — mais les clés inconnues de haut
        // niveau de la fiche existante sont restituées par prudence (D49).
        const carte = nettoyerCarte(msg.articles[slug]);
        try { carte._inconnues = analyserMeta(fs.readFileSync(fichierMeta, 'utf8'))._inconnues; }
        catch (e) { /* pas de fiche existante */ }
        ecrireAusgabeAtomique(fichierMeta, serialiserMeta(carte));
        n++;
      } catch (e) {
        erreurs.push(slug + ' (' + e.message + ')');
      }
    }
    if (erreurs.length > 0) {
      panneau.webview.postMessage({ type: 'erreur', message: 'Écriture impossible : ' + erreurs.join(', ') });
    } else {
      panneau.webview.postMessage({ type: 'enregistre', n: n });
      vscode.window.setStatusBarMessage(n + ' fiche(s) de métadonnées enregistrée(s).', 3000);
    }
    if (rafraichirTout) { rafraichirTout(); }
    envoyerValeurs(panneau);                       // resynchronise les cartes (dirty remis à zéro)
  });
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
  context.subscriptions.push({ dispose: arreterDormeurWsl });   // N1 : pas de dormant orphelin

  // Le compte « Word en attente » est recalculé par getChildren (description de
  // section) ; le TITRE de la vue reflète le numéro (N2, D43) à chaque rafraîchissement.
  const rafraichirTout = () => {
    fournisseur.rafraichir();
    vue.title = fournisseur.racine ? titreNumero(fournisseur.racine) : 'Revue SZH';
  };

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
    // Articles, Word déposés, sorties (le PDF apparaît/disparaît après build) ET
    // ausgabe.yaml (le titre de la vue suit les métadonnées — N2).
    for (const motif of ['articles/**', 'articles-word/*', 'out/**', 'ausgabe.yaml']) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(racine, motif));
      w.onDidCreate(rafraichirBientot);
      w.onDidChange(rafraichirBientot);
      w.onDidDelete(rafraichirBientot);
      watchers.push(w);
    }
  };

  // Recalcule racine + contexte (montre/masque la vue) + watchers + dormant WSL,
  // puis rafraîchit.
  const majContexte = () => {
    const racine = trouverRacineRevue();
    fournisseur.definirRacine(racine);
    vscode.commands.executeCommand('setContext', CLE_CONTEXTE, !!racine);
    reinstallerWatchers(racine);
    if (racine) { demarrerDormeurWsl(); } else { arreterDormeurWsl(); }   // N1 (D42)
    rafraichirTout();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('szh.cockpit.rafraichir', majContexte),
    vscode.commands.registerCommand('szh.metadonnees', () => ouvrirMetadonnees(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.apercuMetadonnees', () => ouvrirApercuMetadonnees(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.ouvrirArticle', (slug) => ouvrirArticle(fournisseur, slug)),
    vscode.commands.registerCommand('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.remplacerAsset', (item) => remplacerAsset(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.remplacerTable', (item) => remplacerTable(fournisseur, rafraichirTout, item)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte)
  );

  majContexte();
}

function deactivate() { arreterDormeurWsl(); }

// `_pur` : fonctions pures exposées pour les harnais headless (VS Code les ignore).
module.exports = {
  activate, deactivate,
  _pur: {
    titreNumero, separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
    analyserMeta, serialiserMeta
  }
};
