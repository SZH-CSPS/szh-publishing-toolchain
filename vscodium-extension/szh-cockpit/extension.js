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

// ---- i18n du cockpit (M4, D52) -> lib/i18n.js ------------------------------------
const { TEXTES_COCKPIT, T, langueCockpit } = require('./lib/i18n');
// ---- Sérialiseurs YAML -> lib/yaml.js --------------------------------------------
const {
  CLES_METADONNEES, COULEURS_NUMERO, HEX_COULEURS,
  TYPES_ARTICLE, LIBELLES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, serialiserAusgabe, ecrireAusgabeAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, titreNumero
} = require('./lib/yaml');
// ---- Modèle de tableau -> lib/table-model.js -------------------------------------
const {
  analyserTable, serialiserTable, disposition, matriceOccupation,
  etendreGrille, compacterGrille, normaliserModele, finaliserModele, canoniserInline,
  ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
  fusionner, scinder, appliquerOperationTable
} = require('./lib/table-model');

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
        this._section('articles', T('arbre.articles'), 'book', undefined),
        this._section('word', T('arbre.word'), 'inbox', n > 0 ? '(' + n + ')' : undefined)
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
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.articles'))]; }
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
      it.tooltip = T('arbre.table.tooltip', [chemin]);
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
    if (noms.length === 0) { return [this._vide(T('arbre.vide.word'))]; }
    return noms.map((nom) => {
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.contextValue = 'word';
      if (this._articleExiste(slugifier(nom))) {
        // Le .md cible existe déjà : l'import l'ignorera (D12, non-écrasement).
        it.iconPath = new vscode.ThemeIcon('warning');
        it.description = T('arbre.deja.badge');
        it.tooltip = T('arbre.deja.tooltip');
      } else {
        it.iconPath = new vscode.ThemeIcon('file');
        it.tooltip = T('arbre.word.tooltip', [nom]);
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
    vscode.window.showInformationMessage(T('info.pdf.externe'));
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
    vscode.window.showErrorMessage(T('err.tache', [nomTache]));
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
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.export'));
  try {
    await fermerOngletsSous(path.join(racine, 'out'));
    apercuCourantUri = null;                       // tous les aperçus viennent d'être fermés
    const code = await lancerTache(NOM_TACHE_EXPORT);
    rafraichirTout();
    if (code === null) { return; }                 // tâche introuvable (déjà signalé)
    if (code !== 0) {
      vscode.window.showErrorMessage(T('err.export', [NOM_TACHE_EXPORT]));
      return;
    }
    const n = fournisseur.listerArticles().length;
    vscode.window.showInformationMessage(n > 1 ? T('info.exportes', [n]) : T('info.exportes.un'));
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

// ---- Aperçu commutable HTML <-> PDF (M5, D53/D54) -----------------------------------
//
// Mode global persistant szh.apercuMode (défaut : html). En mode HTML, la
// colonne 2 est une webview maison qui charge out/<slug>/<slug>.apercu.html
// (rendu sourcepos) : survol = contour, clic = aller à la ligne source du .md.
// En mode PDF, comportement historique (tomoki1207.pdf). Un SEUL propriétaire
// de la colonne 2 à la fois : szh-apercu ne s'active qu'en mode pdf (D54).

function modeApercu() {
  try {
    return String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { return 'html'; }
}

let panneauApercuHtml = null;
let apercuCourantSlug = null;
let apercuHtmlMtime = 0;

// « 01-exemple.md@12:3-14:1 » (ou « 12:3-14:1 ») -> 12. null si illisible.
function lignePos(pos) {
  const texte = String(pos || '');
  const droite = texte.indexOf('@') !== -1 ? texte.slice(texte.indexOf('@') + 1) : texte;
  const m = droite.match(/^(\d+):/);
  return m ? parseInt(m[1], 10) : null;
}

// Injecte dans le HTML autonome de pandoc : CSP stricte, bandeau, styles de
// survol et script (nonce). Les valeurs n'entrent jamais en HTML non échappé.
function injecterApercu(contenu, nonce) {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">';
  const ajout =
    '<style>body{margin-top:2.4rem;}' +
    '#szh-bandeau{position:fixed;top:0;left:0;right:0;z-index:9999;font:13px sans-serif;' +
    'padding:.35rem .8rem;background:#1f6feb;color:#fff;display:flex;justify-content:space-between;align-items:center;}' +
    '#szh-bandeau button{font:inherit;border:none;border-radius:3px;padding:.15rem .6rem;cursor:pointer;background:#fff;color:#1f6feb;}' +
    '.szh-survol{outline:2px solid #1f6feb;outline-offset:2px;}</style>' +
    '<div id="szh-bandeau"><span>' + T('apercu.bandeau') + '</span>' +
    '<button id="szh-basculer" type="button">' + T('apercu.bandeau.pdf') + '</button></div>' +
    '<script nonce="' + nonce + '">(function(){' +
    "'use strict';" +
    'var vscodeApi=acquireVsCodeApi();var courant=null;' +
    "document.getElementById('szh-basculer').addEventListener('click',function(){vscodeApi.postMessage({type:'basculer'});});" +
    "document.addEventListener('mouseover',function(e){var c=e.target&&e.target.closest?e.target.closest('[data-pos]'):null;" +
    "if(courant===c){return;}if(courant){courant.classList.remove('szh-survol');}courant=c;if(courant){courant.classList.add('szh-survol');}});" +
    "document.addEventListener('click',function(e){var c=e.target&&e.target.closest?e.target.closest('[data-pos]'):null;" +
    "if(!c){return;}e.preventDefault();vscodeApi.postMessage({type:'revele',pos:c.getAttribute('data-pos')});});" +
    '})();</script>';
  let html = contenu;
  html = html.indexOf('<head>') !== -1 ? html.replace('<head>', '<head>\n' + csp) : csp + html;
  html = html.indexOf('</body>') !== -1 ? html.replace('</body>', ajout + '\n</body>') : html + ajout;
  return html;
}

async function revelerLigne(fournisseur, slug, ligne) {
  if (!ligne || !fournisseur.racine) { return; }
  const md = path.join(fournisseur.racine, 'articles', slug, slug + '.md');
  try {
    const doc = await vscode.workspace.openTextDocument(md);
    const editeur = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    const l = Math.max(0, Math.min(ligne - 1, doc.lineCount - 1));
    editeur.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.InCenter);
    editeur.selection = new vscode.Selection(l, 0, l, 0);
  } catch (e) { /* fichier disparu entre-temps */ }
}

function fermerApercuHtml() {
  if (!panneauApercuHtml) { return; }
  const p = panneauApercuHtml;
  panneauApercuHtml = null;
  try { p.dispose(); } catch (e) { /* déjà fermé */ }
}

// Ouvre (ou recharge) l'aperçu HTML de l'article en colonne 2 (webview réutilisée).
// Repli si le toolkit n'est pas resynchronisé : le .html du PDF (sans clic),
// sinon un message « pas encore compilé ».
function ouvrirApercuHtml(fournisseur, slug) {
  const dossier = path.join(fournisseur.racine, 'out', slug);
  let fichier = path.join(dossier, slug + '.apercu.html');
  let contenu = null;
  try { contenu = fs.readFileSync(fichier, 'utf8'); }
  catch (e) {
    fichier = path.join(dossier, slug + '.html');
    try { contenu = fs.readFileSync(fichier, 'utf8'); } catch (e2) { contenu = null; }
  }
  let mtime = 0;
  try { mtime = fs.statSync(fichier).mtimeMs; } catch (e) { /* placeholder */ }
  if (contenu === null) {
    contenu = '<!DOCTYPE html><html lang="fr"><head></head><body><p>' + T('apercu.indisponible') + '</p></body></html>';
  }
  const html = injecterApercu(contenu, crypto.randomBytes(16).toString('hex'));
  if (!panneauApercuHtml) {
    const panneau = vscode.window.createWebviewPanel(
      'szhApercuHtml', slug,
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [] }
    );
    panneauApercuHtml = panneau;
    panneau.onDidDispose(() => { if (panneauApercuHtml === panneau) { panneauApercuHtml = null; } });
    panneau.webview.onDidReceiveMessage((msg) => {
      if (!msg) { return; }
      if (msg.type === 'basculer') { vscode.commands.executeCommand('szh.basculerApercu'); }
      if (msg.type === 'revele' && apercuCourantSlug) { revelerLigne(fournisseur, apercuCourantSlug, lignePos(msg.pos)); }
    });
  }
  panneauApercuHtml.title = slug;
  panneauApercuHtml.webview.html = html;
  apercuCourantSlug = slug;
  apercuHtmlMtime = mtime;
}

// Recharge l'aperçu HTML si le fichier régénéré a changé (appelé au refresh —
// la perte du défilement n'arrive donc qu'à une vraie recompilation).
function rechargerApercuHtmlSiChange(fournisseur) {
  if (!panneauApercuHtml || !apercuCourantSlug || !fournisseur.racine || modeApercu() !== 'html') { return; }
  const slug = apercuCourantSlug;
  let mtime = 0;
  try { mtime = fs.statSync(path.join(fournisseur.racine, 'out', slug, slug + '.apercu.html')).mtimeMs; }
  catch (e) { return; }
  if (mtime > apercuHtmlMtime) { ouvrirApercuHtml(fournisseur, slug); }
}

// Bascule globale HTML <-> PDF : persiste szh.apercuMode et échange l'aperçu
// de l'article courant (jamais deux aperçus concurrents en colonne 2).
async function basculerApercu(fournisseur, majBarreApercu) {
  const nouveau = modeApercu() === 'html' ? 'pdf' : 'html';
  try {
    await vscode.workspace.getConfiguration('szh').update('apercuMode', nouveau, vscode.ConfigurationTarget.Global);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    return;
  }
  if (majBarreApercu) { majBarreApercu(); }
  const slug = apercuCourantSlug;
  if (!slug || !fournisseur.racine) { return; }
  if (nouveau === 'html') {
    if (apercuCourantUri) { await fermerApercuCourant(null); }   // l'onglet PDF courant
    ouvrirApercuHtml(fournisseur, slug);
  } else {
    fermerApercuHtml();
    const pdf = vscode.Uri.file(path.join(fournisseur.racine, 'out', slug, slug + '.pdf'));
    if (fs.existsSync(pdf.fsPath)) {
      await ouvrirApercuPdf(pdf);
      apercuCourantUri = pdf;
    }
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
    if (buildEnCours) { vscode.window.setStatusBarMessage(T('statut.build.encours'), 3000); return; }
    buildEnCours = true;
    const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
    try {
      const code = await lancerBuild();
      if (code === null) { return; }               // tâche introuvable (déjà signalé)
      if (code !== 0) {
        vscode.window.showErrorMessage(T('err.build', [NOM_TACHE_BUILD]));
        return;
      }
    } finally {
      statut.dispose();
      buildEnCours = false;
    }
  }
  // M5 : la colonne 2 affiche l'aperçu DU MODE COURANT (html par défaut).
  if (modeApercu() === 'html') {
    if (apercuCourantUri) { await fermerApercuCourant(null); }  // onglet PDF d'une bascule passée
    ouvrirApercuHtml(fournisseur, slug);
    return;
  }
  fermerApercuHtml();                              // webview HTML d'une bascule passée
  if (!fs.existsSync(pdf.fsPath)) {
    vscode.window.showErrorMessage(T('err.pdf.introuvable', [slug]));
    return;
  }
  await fermerApercuCourant(pdf);                  // l'aperçu du précédent article
  await ouvrirApercuPdf(pdf);                      // mono-instance : révèle si déjà là
  apercuCourantUri = pdf;
  apercuCourantSlug = slug;
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
  if (importEnCours) { vscode.window.setStatusBarMessage(T('statut.import.encours'), 3000); return; }
  importEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.import'));
  try {
    const avant = new Set(fournisseur.listerArticles());
    const code = await executerImport();
    rafraichirTout();
    if (code === null) { return; }               // tâche introuvable (déjà signalé)
    if (code !== 0) {
      vscode.window.showErrorMessage(T('err.import', [NOM_TACHE_IMPORT]));
      return;
    }
    let n = 0;
    for (const slug of fournisseur.listerArticles()) { if (!avant.has(slug)) { n++; } }
    if (n > 0) {
      vscode.window.showInformationMessage(n > 1 ? T('info.importes', [n]) : T('info.importes.un'));
    } else {
      vscode.window.showInformationMessage(T('info.importes.aucun'));
    }
  } finally {
    statut.dispose();
    importEnCours = false;
  }
}

async function importerWord(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }

  const filtresImport = {};
  filtresImport[T('dial.importer.filtre')] = ['docx'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: filtresImport,
    openLabel: T('dial.importer.bouton'),
    title: T('dial.importer.titre')
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
      T('modale.conflit.question', [noms]),
      { modal: true },
      T('modale.remplacer.bouton'), T('modale.conflit.ignorer')
    );
    if (rep === undefined) { return; }             // annulé
    remplacer = (rep === T('modale.remplacer.bouton'));
  }

  let copies = 0;
  for (const u of choix) {
    const dest = path.join(dossierWord, path.basename(u.fsPath));
    if (fs.existsSync(dest) && !remplacer) { continue; }
    try { fs.copyFileSync(u.fsPath, dest); copies++; }
    catch (e) { vscode.window.showErrorMessage(T('err.copie', [path.basename(u.fsPath), e.message])); }
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
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const cible = item.cheminAsset;
  const nomCible = path.basename(cible);
  const filtresImage = {};
  filtresImage[T('dial.image.filtre')] = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: filtresImage,
    openLabel: T('dial.image.bouton'),
    title: T('dial.image.titre', [nomCible])
  });
  if (!choix || choix.length === 0) { return; }    // dialogue annulé
  const source = choix[0].fsPath;
  const nomSource = path.basename(source);
  let detail = T('modale.remplacer.detail.image', [nomCible]);
  if (formatImage(nomSource) !== formatImage(nomCible)) {
    detail = T('modale.remplacer.detail.format', [formatImage(nomSource), formatImage(nomCible)]) + detail;
  }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.remplacer.question', [nomCible, nomSource]),
    { modal: true, detail: detail },
    T('modale.remplacer.bouton')
  );
  if (reponse !== T('modale.remplacer.bouton')) { return; }   // annulé : rien n'est touché
  try {
    fs.copyFileSync(source, cible);                // même nom : lien du .md intact
    vscode.window.setStatusBarMessage(T('statut.image.remplacee', [nomCible]), 5000);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.remplacement', [e.message]));
  }
  rafraichirTout();
}

// « Remplacer » un tableau (N6, D47) : écrase tables/table-NN.html par un fichier
// .html choisi, EN GARDANT le nom (la référence du .md reste valide). Jamais
// silencieux : confirmation modale. L'édition fine se fait au clic (fichier HTML).
async function remplacerTable(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const cible = item.cheminAsset;
  const nomCible = path.basename(cible);
  const filtresTable = {};
  filtresTable[T('dial.table.filtre')] = ['html', 'htm'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: filtresTable,
    openLabel: T('dial.table.bouton'),
    title: T('dial.table.titre', [nomCible])
  });
  if (!choix || choix.length === 0) { return; }    // dialogue annulé
  const source = choix[0].fsPath;
  const reponse = await vscode.window.showWarningMessage(
    T('modale.remplacer.question', [nomCible, path.basename(source)]),
    { modal: true, detail: T('modale.remplacer.detail.table', [nomCible]) },
    T('modale.remplacer.bouton')
  );
  if (reponse !== T('modale.remplacer.bouton')) { return; }   // annulé : rien n'est touché
  try {
    fs.copyFileSync(source, cible);
    vscode.window.setStatusBarMessage(T('statut.table.remplacee', [nomCible]), 5000);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.remplacement', [e.message]));
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
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.supprimer.question', [slug]),
    { modal: true, detail: T('modale.supprimer.detail', [slug]) },
    T('modale.supprimer.bouton')
  );
  if (reponse !== T('modale.supprimer.bouton')) { return; }   // annulé : rien n'est touché
  const dossierArticle = path.join(racine, 'articles', slug);
  const dossierSortie = path.join(racine, 'out', slug);
  try {
    if (apercuCourantSlug === slug) { fermerApercuHtml(); apercuCourantSlug = null; }
    await fermerOngletsSous(dossierArticle);
    await fermerOngletsSous(dossierSortie);
    fs.rmSync(dossierArticle, { recursive: true, force: true });
    fs.rmSync(dossierSortie, { recursive: true, force: true });
    vscode.window.setStatusBarMessage(T('statut.supprime', [slug]), 3000);
  } catch (e) {
    vscode.window.showErrorMessage(T('err.suppression', [slug, e.message]));
  }
  rafraichirTout();
}

// ---- Sérialiseurs YAML (ausgabe/frontmatter/meta) -> lib/yaml.js -----------------
// (déplacés en tête de fichier via require ; voir lib/yaml.js)

// Formulaire (webview) — CSP stricte : aucun réseau, styles inline, script à nonce.
// Les valeurs ne sont PAS injectées dans le HTML : elles arrivent par postMessage
// (le webview envoie « pret » au chargement), donc zéro échappement HTML à gérer.
function htmlMetadonnees(nonce) {
  const txt = JSON.stringify({
    indiceDate: T('meta.date.indice'),
    rien: T('form.rien'),
    enregistre: T('form.enregistre'),
    couleurAucune: T('meta.couleur.aucune'),
    couleurs: COULEURS_NUMERO.map((c) => ({ hex: c.hex, nom: T('meta.couleur.' + c.cle) }))
  });
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('meta.titre') + '</title>\n' +
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
    '.pastilles { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .3rem; }\n' +
    '.pastille { display: inline-flex; align-items: center; gap: .4em; cursor: pointer;\n' +
    '  padding: .3em .7em .3em .4em; border: 1px solid var(--vscode-input-border, rgba(128,128,128,.4));\n' +
    '  border-radius: 999px; background: var(--vscode-input-background); color: var(--vscode-foreground);\n' +
    '  font: inherit; margin: 0; width: auto; box-sizing: border-box; }\n' +
    '.pastille .puce { width: 1em; height: 1em; border-radius: 50%; border: 1px solid rgba(128,128,128,.5); flex: 0 0 auto; }\n' +
    '.pastille[aria-pressed="true"] { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; font-weight: 600; }\n' +
    'button { margin-top: 1.2rem; padding: .45em 1.1em; border: none; border-radius: 2px; font: inherit;\n' +
    '  color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }\n' +
    'button:hover { background: var(--vscode-button-hoverBackground); }\n' +
    '#etat { margin-left: .8rem; font-size: .92em; color: var(--vscode-descriptionForeground); }\n' +
    '</style>\n</head>\n<body>\n' +
    '<h1>' + T('meta.titre') + '</h1>\n' +
    '<p class="note">' + T('meta.note') + '</p>\n' +
    '<form id="formulaire">\n' +
    '<label for="title">' + T('meta.title') + '</label><input id="title" type="text">\n' +
    '<label for="revue">' + T('meta.revue') + '</label><input id="revue" type="text">\n' +
    '<label for="volume">' + T('meta.volume') + '</label><input id="volume" type="text">\n' +
    '<label for="numero">' + T('meta.numero') + '</label><input id="numero" type="text">\n' +
    '<label for="date">' + T('meta.date') + '</label><input id="date" type="date">\n' +
    '<div class="indice" id="indiceDate" hidden></div>\n' +
    '<label for="lang">' + T('meta.langue') + '</label>\n' +
    '<select id="lang"><option value="">' + T('meta.langue.aucune') + '</option><option value="fr">' + T('meta.langue.fr') + '</option>' +
    '<option value="de">' + T('meta.langue.de') + '</option><option value="en">' + T('meta.langue.en') + '</option><option value="it">' + T('meta.langue.it') + '</option></select>\n' +
    '<label>' + T('meta.couleur') + '</label>\n' +
    '<div class="pastilles" id="couleurs"></div>\n' +
    '<button type="submit">' + T('form.enregistrer') + '</button><span id="etat" role="status"></span>\n' +
    '</form>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const TXT = ' + txt + ';\n' +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const CLES = ['title', 'revue', 'volume', 'numero', 'date', 'lang'];\n" +
    '  const modifies = new Set();\n' +
    "  const etat = document.getElementById('etat');\n" +
    "  let couleurChoisie = '';\n" +
    '  function majPastilles() {\n' +
    "    for (const b of document.querySelectorAll('#couleurs .pastille')) {\n" +
    "      b.setAttribute('aria-pressed', b.dataset.hex === couleurChoisie ? 'true' : 'false');\n" +
    '    }\n' +
    '  }\n' +
    '  function rendreCouleurs() {\n' +
    "    const conteneur = document.getElementById('couleurs');\n" +
    "    conteneur.textContent = '';\n" +
    "    const items = [{ hex: '', nom: TXT.couleurAucune }].concat(TXT.couleurs);\n" +
    '    for (const c of items) {\n' +
    "      const b = document.createElement('button');\n" +
    "      b.type = 'button';\n" +
    "      b.className = 'pastille';\n" +
    '      b.dataset.hex = c.hex;\n' +
    "      b.setAttribute('aria-pressed', 'false');\n" +
    '      if (c.hex) {\n' +
    "        const puce = document.createElement('span');\n" +
    "        puce.className = 'puce';\n" +
    '        puce.style.background = c.hex;\n' +
    '        b.appendChild(puce);\n' +
    '      }\n' +
    '      b.appendChild(document.createTextNode(c.nom));\n' +
    "      b.addEventListener('click', function () {\n" +
    '        couleurChoisie = c.hex;\n' +
    '        majPastilles();\n' +
    "        modifies.add('couleur');\n" +
    "        etat.textContent = '';\n" +
    '      });\n' +
    '      conteneur.appendChild(b);\n' +
    '    }\n' +
    '  }\n' +
    '  function remplir(valeurs) {\n' +
    '    for (const cle of CLES) {\n' +
    '      const champ = document.getElementById(cle);\n' +
    "      const v = valeurs[cle] === undefined ? '' : String(valeurs[cle]);\n" +
    '      champ.value = v;\n' +
    "      if (cle === 'date') {\n" +
    "        const indice = document.getElementById('indiceDate');\n" +
    '        if (v && champ.value !== v) {\n' +
    "          indice.textContent = TXT.indiceDate.split('{0}').join(v);\n" +
    '          indice.hidden = false;\n' +
    '        } else { indice.hidden = true; }\n' +
    '      }\n' +
    "      if (cle === 'lang' && champ.value !== v) { champ.value = ''; }\n" +
    '    }\n' +
    "    couleurChoisie = valeurs.couleur === undefined ? '' : String(valeurs.couleur);\n" +
    '    majPastilles();\n' +
    '    modifies.clear();\n' +
    "    etat.textContent = '';\n" +
    '  }\n' +
    '  for (const cle of CLES) {\n' +
    "    document.getElementById(cle).addEventListener('input', function () { modifies.add(cle); etat.textContent = ''; });\n" +
    '  }\n' +
    '  rendreCouleurs();\n' +
    "  document.getElementById('formulaire').addEventListener('submit', function (e) {\n" +
    '    e.preventDefault();\n' +
    '    if (modifies.size === 0) { etat.textContent = TXT.rien; return; }\n' +
    '    const envoi = {};\n' +
    '    for (const cle of modifies) {\n' +
    "      envoi[cle] = cle === 'couleur' ? couleurChoisie : document.getElementById(cle).value;\n" +
    '    }\n' +
    "    vscodeApi.postMessage({ type: 'enregistrer', modifies: envoi });\n" +
    '  });\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { remplir(msg.valeurs || {}); }\n" +
    "    if (msg.type === 'enregistre') { modifies.clear(); etat.textContent = TXT.enregistre; }\n" +
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
    'szhMetadonnees', T('meta.titre'), vscode.ViewColumn.One,
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
    // couleur (M7, D56) : soit vide (« aucune »), soit un hex de la palette —
    // toute autre valeur est ignorée (jamais écrite dans ausgabe.yaml).
    if ('couleur' in modifies) {
      const c = modifies.couleur.toUpperCase();
      if (c !== '' && HEX_COULEURS.indexOf(c) === -1) { delete modifies.couleur; }
      else { modifies.couleur = c; }
    }
    if (Object.keys(modifies).length === 0) { return; }
    try {
      let contenu = '';
      try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
      ecrireAusgabeAtomique(chemin, serialiserAusgabe(contenu, modifies));
      panneau.webview.postMessage({ type: 'enregistre' });
      vscode.window.setStatusBarMessage(T('statut.ausgabe'), 3000);
      if (rafraichirTout) { rafraichirTout(); }    // titre de la vue à jour (N2)
    } catch (e) {
      panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [e.message]) });
    }
  });
}

// ---- Éditeur des métadonnées de TOUS les articles (N7 refondu par M1, D49/D51) -----

// Webview « Métadonnées des articles » : une carte par article — type (menu
// déroulant traduit), doi, title/subtitle/keywords TRADUCTIBLES (FR/DE toujours,
// IT révélé par la case « + Italien »), auteurs répétables à 5 champs. DOM
// construit sans injection HTML, valeurs par postMessage, dirty PAR ARTICLE.
function htmlApercuMetadonnees(nonce) {
  const txt = JSON.stringify({
    type: T('fiches.type'), typeAucun: T('fiches.type.aucun'),
    titreChamp: T('fiches.titre.champ'), sousTitre: T('fiches.soustitre'),
    resume: T('fiches.resume'),
    auteurs: T('fiches.auteurs'), ajouterAuteur: T('fiches.auteur.ajouter'),
    retirerAuteur: T('fiches.auteur.retirer'),
    aPrenom: T('fiches.auteur.prenom'), aNom: T('fiches.auteur.nom'),
    aFonction: T('fiches.auteur.fonction'), aAffiliation: T('fiches.auteur.affiliation'),
    aOrcid: T('fiches.auteur.orcid'),
    motsCles: T('fiches.motscles'), italien: T('fiches.italien'),
    rien: T('form.rien'), enregistre: T('fiches.enregistre')
  });
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('fiches.titre') + '</title>\n' +
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
    'input, select, textarea { width: 100%; box-sizing: border-box; padding: .3em .5em; font: inherit;\n' +
    '  color: var(--vscode-input-foreground); background: var(--vscode-input-background);\n' +
    '  border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; }\n' +
    'textarea { resize: vertical; min-height: 3.4em; font-family: inherit; }\n' +
    'input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); }\n' +
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
    '<h1>' + T('fiches.titre') + '</h1>\n' +
    '<p class="note">' + T('fiches.note') + '</p>\n' +
    '<div class="barre"><button class="principal" id="enregistrer">' + T('form.enregistrer') + '</button><span id="etat" role="status"></span></div>\n' +
    '<div id="cartes"></div>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const TXT = ' + txt + ';\n' +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const etat = document.getElementById('etat');\n" +
    "  const conteneur = document.getElementById('cartes');\n" +
    '  const modifies = new Set();\n' +
    '  let TYPES = [];\n' +
    '  function marquer(carte, slug) { modifies.add(slug); carte.classList.add(\'modifie\'); etat.textContent = \'\'; }\n' +
    '  function champTexte(carte, parent, slug, cle, langue, libelle, valeur, multiligne) {\n' +
    "    const l = document.createElement('label');\n" +
    '    l.textContent = libelle;\n' +
    "    const i = document.createElement(multiligne ? 'textarea' : 'input');\n" +
    "    if (multiligne) { i.rows = 3; } else { i.type = 'text'; }\n" +
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
    "    for (const [cle, indice] of [['prenom', TXT.aPrenom], ['nom', TXT.aNom], ['fonction', TXT.aFonction], ['affiliation', TXT.aAffiliation], ['orcid', TXT.aOrcid]]) {\n" +
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
    '    retirer.title = TXT.retirerAuteur;\n' +
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
    '      const avecIt = [\'title\', \'subtitle\', \'resume\'].some(function (c) { return v[c] && v[c].it; }) ||\n' +
    '        (v.keywords && v.keywords.it && v.keywords.it.length > 0);\n' +
    '      if (avecIt) { carte.classList.add(\'avec-it\'); }\n' +
    "      const lType = document.createElement('label');\n" +
    '      lType.textContent = TXT.type;\n' +
    '      carte.appendChild(lType);\n' +
    "      const selection = document.createElement('select');\n" +
    "      selection.dataset.cle = 'type';\n" +
    "      const optVide = document.createElement('option');\n" +
    "      optVide.value = '';\n" +
    '      optVide.textContent = TXT.typeAucun;\n' +
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
    '        champTexte(carte, carte, article.slug, \'title\', lg, TXT.titreChamp.split(\'{0}\').join(nomsLangues[lg]), (v.title || {})[lg]);\n' +
    '      }\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'subtitle\', lg, TXT.sousTitre.split(\'{0}\').join(nomsLangues[lg]), (v.subtitle || {})[lg]);\n' +
    '      }\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'resume\', lg, TXT.resume.split(\'{0}\').join(nomsLangues[lg]), (v.resume || {})[lg], true);\n' +
    '      }\n' +
    "      const lAuteurs = document.createElement('label');\n" +
    '      lAuteurs.textContent = TXT.auteurs;\n' +
    '      carte.appendChild(lAuteurs);\n' +
    "      const zone = document.createElement('div');\n" +
    "      zone.className = 'auteurs';\n" +
    '      carte.appendChild(zone);\n' +
    '      for (const a of (v.author || [])) { ligneAuteur(carte, article.slug, zone, a); }\n' +
    "      const ajouter = document.createElement('button');\n" +
    "      ajouter.type = 'button';\n" +
    '      ajouter.textContent = TXT.ajouterAuteur;\n' +
    "      ajouter.addEventListener('click', function () { ligneAuteur(carte, article.slug, zone, null); marquer(carte, article.slug); });\n" +
    '      carte.appendChild(ajouter);\n' +
    '      champTexte(carte, carte, article.slug, \'doi\', null, \'DOI\', v.doi);\n' +
    '      for (const lg of langues) {\n' +
    '        champTexte(carte, carte, article.slug, \'keywords\', lg, TXT.motsCles.split(\'{0}\').join(nomsLangues[lg]), ((v.keywords || {})[lg] || []).join(\', \'));\n' +
    '      }\n' +
    '      const caseIt = document.createElement(\'label\');\n' +
    "      caseIt.className = 'case-it';\n" +
    "      const coche = document.createElement('input');\n" +
    "      coche.type = 'checkbox';\n" +
    '      coche.checked = avecIt;\n' +
    '      caseIt.appendChild(coche);\n' +
    '      caseIt.appendChild(document.createTextNode(TXT.italien));\n' +
    "      coche.addEventListener('change', function () {\n" +
    "        carte.classList.toggle('avec-it', coche.checked);\n" +
    '      });\n' +
    '      carte.appendChild(caseIt);\n' +
    '      conteneur.appendChild(carte);\n' +
    '    }\n' +
    '  }\n' +
    '  function collecter(carte) {\n' +
    '    const resultat = { type: \'\', doi: \'\', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };\n' +
    "    const sel = carte.querySelector('select[data-cle=type]');\n" +
    '    if (sel) { resultat.type = sel.value; }\n' +
    "    for (const i of carte.querySelectorAll(':scope > input, :scope > textarea')) {\n" +
    '      const cle = i.dataset.cle;\n' +
    '      const langue = i.dataset.langue;\n' +
    "      if (cle === 'doi') { resultat.doi = i.value; }\n" +
    "      else if (cle === 'title' || cle === 'subtitle' || cle === 'resume') { resultat[cle][langue] = i.value; }\n" +
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
    '    if (modifies.size === 0) { etat.textContent = TXT.rien; return; }\n' +
    '    const envoi = {};\n' +
    "    for (const carte of conteneur.querySelectorAll('.carte')) {\n" +
    '      if (modifies.has(carte.dataset.slug)) { envoi[carte.dataset.slug] = collecter(carte); }\n' +
    '    }\n' +
    "    vscodeApi.postMessage({ type: 'enregistrer', articles: envoi });\n" +
    '  });\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { TYPES = msg.types || []; rendre(msg.articles || []); }\n" +
    "    if (msg.type === 'enregistre') { etat.textContent = TXT.enregistre.split('{0}').join(msg.n); }\n" +
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
    let valeurs = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
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
  const carte = { type: '', doi: texteCourt(brut && brut.doi, 200), title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
  const type = texteCourt(brut && brut.type, 40);
  if (TYPES_ARTICLE.indexOf(type) !== -1) { carte.type = type; }
  for (const cle of ['title', 'subtitle', 'resume']) {
    const map = (brut && brut[cle]) || {};
    const max = cle === 'resume' ? 2000 : 500;   // le résumé est un abrégé, plus long
    for (const l of LANGUES_META) {
      const t = texteCourt(map[l], max);
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
    'szhApercuMetadonnees', T('fiches.titre'), vscode.ViewColumn.One,
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
      panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [erreurs.join(', ')]) });
    } else {
      panneau.webview.postMessage({ type: 'enregistre', n: n });
      vscode.window.setStatusBarMessage(T('statut.fiches', [n]), 3000);
    }
    if (rafraichirTout) { rafraichirTout(); }
    envoyerValeurs(panneau);                       // resynchronise les cartes (dirty remis à zéro)
  });
}

// ---- Réglages « SZH » (M4, D52) -----------------------------------------------------
//
// Formulaire webview qui écrit les réglages AU NIVEAU UTILISATEUR via l'API
// getConfiguration().update(…, Global) — jamais d'édition manuelle de
// settings.json. Chaque changement s'applique immédiatement. Thèmes : uniquement
// Default Light/Dark Modern (intégrés). La langue FR/DE pilote les chaînes du
// cockpit (szh.langue) ET la locale native (argv.json, redémarrage requis —
// menus natifs DE seulement si le pack de langue est déployé, cf. vsix.lock).

const REGL_TEXTES = () => JSON.stringify({
  theme: T('regl.theme'),
  themeSysteme: T('regl.theme.systeme'), themeClair: T('regl.theme.clair'), themeSombre: T('regl.theme.sombre'),
  zoom: T('regl.zoom'),
  zoomNormal: T('regl.zoom.normal'), zoomGrand: T('regl.zoom.grand'), zoomTresGrand: T('regl.zoom.tresgrand'),
  policeMd: T('regl.policemd'),
  langue: T('regl.langue'), langueNote: T('regl.langue.note')
});

function htmlReglages(nonce) {
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('regl.titre') + '</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background);\n' +
    '  padding: 1rem 1.2rem; max-width: 34rem; }\n' +
    'h1 { font-size: 1.15em; font-weight: 600; margin: 0 0 .25rem; }\n' +
    'p.note { color: var(--vscode-descriptionForeground); margin: 0 0 1rem; font-size: .88em; }\n' +
    'fieldset { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35));\n' +
    '  border-radius: 4px; margin: 0 0 1rem; padding: .6rem 1rem .8rem; }\n' +
    'legend { font-weight: 600; padding: 0 .4em; }\n' +
    'label { display: inline-flex; align-items: center; margin: .25rem 1.1rem .25rem 0; gap: .35em; }\n' +
    '.indice { color: var(--vscode-descriptionForeground); font-size: .82em; margin-top: .3rem; }\n' +
    '</style>\n</head>\n<body>\n' +
    '<h1>' + T('regl.titre') + '</h1>\n' +
    '<p class="note">' + T('regl.note') + '</p>\n' +
    '<div id="zones"></div>\n' +
    '<script nonce="' + nonce + '">\n' +
    '(function () {\n' +
    "  'use strict';\n" +
    '  const TXT = ' + REGL_TEXTES() + ';\n' +
    '  const vscodeApi = acquireVsCodeApi();\n' +
    "  const zones = document.getElementById('zones');\n" +
    '  const GROUPES = [\n' +
    "    { cle: 'theme', legende: TXT.theme, options: [['systeme', TXT.themeSysteme], ['clair', TXT.themeClair], ['sombre', TXT.themeSombre]] },\n" +
    "    { cle: 'zoom', legende: TXT.zoom, options: [['0', TXT.zoomNormal], ['1', TXT.zoomGrand], ['2', TXT.zoomTresGrand]] },\n" +
    "    { cle: 'policeMd', legende: TXT.policeMd, options: [['14', '14 px'], ['16', '16 px'], ['18', '18 px']] },\n" +
    "    { cle: 'langue', legende: TXT.langue, options: [['fr', 'Français'], ['de', 'Deutsch']], indice: TXT.langueNote }\n" +
    '  ];\n' +
    '  function rendre() {\n' +
    '    for (const g of GROUPES) {\n' +
    "      const zone = document.createElement('fieldset');\n" +
    "      const legende = document.createElement('legend');\n" +
    '      legende.textContent = g.legende;\n' +
    '      zone.appendChild(legende);\n' +
    '      for (const [valeur, libelle] of g.options) {\n' +
    "        const l = document.createElement('label');\n" +
    "        const radio = document.createElement('input');\n" +
    "        radio.type = 'radio';\n" +
    '        radio.name = g.cle;\n' +
    '        radio.value = valeur;\n' +
    "        radio.addEventListener('change', function () {\n" +
    "          vscodeApi.postMessage({ type: 'regler', cle: g.cle, valeur: valeur });\n" +
    '        });\n' +
    '        l.appendChild(radio);\n' +
    '        l.appendChild(document.createTextNode(libelle));\n' +
    '        zone.appendChild(l);\n' +
    '      }\n' +
    '      if (g.indice) {\n' +
    "        const indice = document.createElement('div');\n" +
    "        indice.className = 'indice';\n" +
    '        indice.textContent = g.indice;\n' +
    '        zone.appendChild(indice);\n' +
    '      }\n' +
    '      zones.appendChild(zone);\n' +
    '    }\n' +
    '  }\n' +
    '  function cocher(valeurs) {\n' +
    '    for (const cle of Object.keys(valeurs)) {\n' +
    "      const radio = document.querySelector('input[name=\"' + cle + '\"][value=\"' + String(valeurs[cle]) + '\"]');\n" +
    '      if (radio) { radio.checked = true; }\n' +
    '    }\n' +
    '  }\n' +
    '  rendre();\n' +
    "  window.addEventListener('message', function (e) {\n" +
    '    const msg = e.data || {};\n' +
    "    if (msg.type === 'valeurs') { cocher(msg.valeurs || {}); }\n" +
    '  });\n' +
    "  vscodeApi.postMessage({ type: 'pret' });\n" +
    '})();\n' +
    '</script>\n</body>\n</html>\n';
}

// Écrit/Met à jour "locale" dans %APPDATA%\VSCodium\argv.json — édition ciblée
// par regex (le fichier accepte des commentaires : pas de JSON.parse/stringify
// qui les perdrait). Retourne false en cas d'échec (signalé sobrement).
function ecrireLocaleArgv(langue) {
  try {
    const dossier = path.join(process.env.APPDATA || '', 'VSCodium');
    const chemin = path.join(dossier, 'argv.json');
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { contenu = '{\n}\n'; }
    if (/"locale"\s*:\s*"[^"]*"/.test(contenu)) {
      contenu = contenu.replace(/"locale"\s*:\s*"[^"]*"/, '"locale": "' + langue + '"');
    } else {
      const pos = contenu.lastIndexOf('}');
      if (pos === -1) {
        contenu = '{\n\t"locale": "' + langue + '"\n}\n';
      } else {
        const avant = contenu.slice(0, pos).replace(/\s*$/, '');
        const virgule = /[{,]\s*$/.test(avant) ? '' : ',';
        contenu = avant + virgule + '\n\t"locale": "' + langue + '"\n' + contenu.slice(pos);
      }
    }
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(chemin, contenu, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function lireReglagesActuels() {
  const cfg = vscode.workspace.getConfiguration();
  const autoDetect = cfg.get('window.autoDetectColorScheme', false) === true;
  const theme = String(cfg.get('workbench.colorTheme', '') || '');
  const etatTheme = autoDetect ? 'systeme'
    : (theme.toLowerCase().indexOf('light') !== -1 ? 'clair' : 'sombre');
  const zoom = Number(cfg.get('window.zoomLevel', 0)) || 0;
  let policeMd = 16;
  try {
    policeMd = Number(vscode.workspace.getConfiguration('editor', { languageId: 'markdown' }).get('fontSize', 16)) || 16;
  } catch (e) { /* repli 16 */ }
  return { theme: etatTheme, zoom: String(zoom), policeMd: String(policeMd), langue: langueCockpit() };
}

let panneauReglages = null;

function ouvrirReglages(rafraichirTout) {
  if (panneauReglages) {
    panneauReglages.reveal(vscode.ViewColumn.One);
    panneauReglages.webview.postMessage({ type: 'valeurs', valeurs: lireReglagesActuels() });
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhReglages', T('regl.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauReglages = panneau;
  panneau.onDidDispose(() => { if (panneauReglages === panneau) { panneauReglages = null; } });
  panneau.webview.html = htmlReglages(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') {
      panneau.webview.postMessage({ type: 'valeurs', valeurs: lireReglagesActuels() });
      return;
    }
    if (msg.type !== 'regler') { return; }
    const Global = vscode.ConfigurationTarget.Global;
    const cfg = vscode.workspace.getConfiguration();
    try {
      if (msg.cle === 'theme') {
        if (msg.valeur === 'systeme') {
          await cfg.update('workbench.preferredLightColorTheme', 'Default Light Modern', Global);
          await cfg.update('workbench.preferredDarkColorTheme', 'Default Dark Modern', Global);
          await cfg.update('window.autoDetectColorScheme', true, Global);
        } else {
          await cfg.update('window.autoDetectColorScheme', false, Global);
          await cfg.update('workbench.colorTheme',
            msg.valeur === 'clair' ? 'Default Light Modern' : 'Default Dark Modern', Global);
        }
      } else if (msg.cle === 'zoom') {
        await cfg.update('window.zoomLevel', Number(msg.valeur) || 0, Global);
      } else if (msg.cle === 'policeMd') {
        // Scopé [markdown] : la taille du CONTENU affiché, pas le contenu lui-même.
        await vscode.workspace.getConfiguration('editor', { languageId: 'markdown' })
          .update('fontSize', Number(msg.valeur) || 16, Global, true);
      } else if (msg.cle === 'langue') {
        const langue = msg.valeur === 'de' ? 'de' : 'fr';
        await vscode.workspace.getConfiguration('szh').update('langue', langue, Global);
        ecrireLocaleArgv(langue);                  // langue native : au prochain démarrage
        vscode.window.showInformationMessage(T('info.redemarrer'));
        if (rafraichirTout) { rafraichirTout(); }  // libellés de l'arbre à jour tout de suite
      }
    } catch (e) {
      vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    }
  });
}

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
  ['palette.tableau', 'szh.fmt.tableau', 'Ctrl+Alt+T', '']
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
  c('szh.miseEnForme', () => ouvrirMiseEnForme());
}

// ---- Éditeur de tableau maison (webview) — D57, T1 -------------------------------
//
// L'asset tableau (viewItem == table) reste un <table> autonome dans
// articles/<slug>/tables/table-NN.html. « Éditer » (szh.editerTable) ouvre une
// webview (grille éditable) qui charge le fichier, l'édite (texte + fusions +
// ajout/suppression de lignes/colonnes) et le réécrit (écriture atomique).
//
// PARSEUR / SÉRIALISEUR PURS (exportés via _pur, testés headless) :
//   analyserTable(html)  -> modèle { attrs, lignes:[{ total, teinte, gras,
//                            cellules:[{ contenu, colspan, rowspan, th, scope }] }] }
//   serialiserTable(mod) -> <table>…</table> propre et STABLE.
// Contrat GATE : analyser -> serialiser -> analyser identique (table nue M2 comprise).
//
// MODÈLE (encodage HTML, cf. PLAN-TABLEAU §Modèle) : le fichier est un <table
// class="szh-tableau"> ; le style est porté par des attributs data-* sur <table>
// et <tr> ; les en-têtes par <th scope>. Le contenu de cellule est de l'inline
// simple : texte échappé, <strong>, <em>, <br> (canonisé, jamais d'injection).
//
// Robustesse : un <table> nu (import M2, docx-tables.py) s'ouvre en mode neutre —
// les <th> d'en-tête sont préservés (comptes data-entete-* déduits à la volée).

// ---- Modèle de tableau (parseur/sérialiseur/opérations purs) -> lib/table-model.js
// (déplacé en tête de fichier via require ; voir lib/table-model.js)

// Couleur annuelle (hex) d'ausgabe.yaml (M7) pour l'APERÇU webview — repli '' si
// aucune couleur (l'aperçu « couleur » retombe alors sur le gris, comme le PDF).
function lireCouleurAccent(racine) {
  try {
    const c = String(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).couleur || '').toUpperCase();
    return HEX_COULEURS.indexOf(c) !== -1 ? c : '';
  } catch (e) { return ''; }
}

// Libellés localisés transmis à la webview de l'éditeur de tableau.
function textesTable() {
  const cles = [
    'table.aide', 'table.enregistrer', 'table.fusionner', 'table.scinder',
    'table.rien', 'table.fusionImpossible', 'table.enregistre',
    'table.ctx.ligneAvant', 'table.ctx.ligneApres', 'table.ctx.ligneSuppr',
    'table.ctx.colAvant', 'table.ctx.colApres', 'table.ctx.colSuppr',
    'table.grpEntetes', 'table.grpStyles',
    'table.entete', 'table.enteteRetirer', 'table.styleEntete', 'table.styleLigne', 'table.styleColonne',
    'table.st.normal', 'table.st.gras', 'table.st.negatif', 'table.st.fond',
    'table.zebre', 'table.zebre.non', 'table.zebre.lignes', 'table.zebre.colonnes',
    'table.teinte', 'table.teinte.gris', 'table.teinte.couleur',
    'table.separateurs', 'table.sep.non', 'table.sep.gris', 'table.sep.couleur',
    'table.bordureHaute', 'table.bordureBasse', 'table.oui', 'table.non',
    'table.total', 'table.total.non', 'table.total.gris', 'table.total.couleur', 'table.total.gras',
    'table.accent', 'table.accent.gris', 'table.accent.couleur', 'table.accent.aucune'
  ];
  const o = {};
  for (const c of cles) { o[c.slice('table.'.length)] = T(c); }
  return o;
}

// Webview de l'éditeur — CSP stricte : aucun réseau, styles inline, script à nonce.
// Le contenu du tableau n'est JAMAIS injecté dans le HTML : le modèle arrive par
// postMessage et la grille est construite en DOM (createElement/textContent). Le
// contenu inline (déjà canonisé côté hôte : texte échappé + <strong>/<em>/<br>) est
// posé en nœuds DOM, pas via innerHTML.
function htmlEditeurTable(nonce) {
  return '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">\n' +
    '<title>' + T('table.titre', ['']) + '</title>\n' +
    '<style>\n' +
    'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);\n' +
    '  color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: .6rem .8rem; }\n' +
    '.barre { position: sticky; top: 0; z-index: 5; background: var(--vscode-editor-background);\n' +
    '  display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; padding: .3rem 0 .5rem; }\n' +
    '.grp { display: inline-flex; align-items: center; gap: .25rem; padding: .1rem .3rem;\n' +
    '  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.3)); border-radius: 4px; }\n' +
    '.grp > .lbl { font-size: .78em; color: var(--vscode-descriptionForeground); margin-right: .1rem; }\n' +
    'button { font: inherit; padding: .25em .6em; border: none; border-radius: 3px; cursor: pointer;\n' +
    '  color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));\n' +
    '  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18)); }\n' +
    'button:hover { background: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }\n' +
    'button.principal { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }\n' +
    'button[aria-pressed="true"] { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }\n' +
    'select { font: inherit; padding: .2em .3em; color: var(--vscode-input-foreground);\n' +
    '  background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; }\n' +
    'p.aide { color: var(--vscode-descriptionForeground); font-size: .82em; margin: .1rem 0 .6rem; }\n' +
    '#etat { font-size: .85em; color: var(--vscode-descriptionForeground); margin-left: .3rem; }\n' +
    '#zone { overflow: auto; }\n' +
    'table.grille { border-collapse: collapse; }\n' +
    'table.grille th, table.grille td { border: 1px solid var(--vscode-panel-border, #888);\n' +
    '  padding: .3em .5em; min-width: 3em; height: 1.9em; vertical-align: top; text-align: left; }\n' +
    'table.grille td.cell, table.grille th.cell { background: var(--vscode-editor-background); cursor: text; }\n' +
    'table.grille .sel { outline: 2px solid var(--vscode-focusBorder); outline-offset: -2px;\n' +
    '  background: var(--vscode-editor-selectionBackground, rgba(90,140,220,.25)); }\n' +
    '.poignee { background: var(--vscode-editorGutter-background, rgba(128,128,128,.15));\n' +
    '  color: var(--vscode-descriptionForeground); cursor: pointer; text-align: center; user-select: none;\n' +
    '  min-width: 1.4em; padding: .15em .3em; font-size: .8em; }\n' +
    '.poignee.pnum { min-width: 2.4em; }\n' +
    '.poignee.selh { background: var(--vscode-editor-selectionBackground, rgba(90,140,220,.35));\n' +
    '  color: var(--vscode-foreground); }\n' +
    '.poignee:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.3)); }\n' +
    '.coin { background: var(--vscode-editorGutter-background, rgba(128,128,128,.15)); }\n' +
    '.ctxmenu { position: fixed; z-index: 1000; min-width: 13em; padding: .25em 0;\n' +
    '  background: var(--vscode-menu-background, var(--vscode-editor-background));\n' +
    '  color: var(--vscode-menu-foreground, var(--vscode-foreground));\n' +
    '  border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border, rgba(128,128,128,.4)));\n' +
    '  border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.35); font-size: .92em; }\n' +
    '.ctxmenu .ctxitem { padding: .32em .9em; cursor: pointer; white-space: nowrap; }\n' +
    '.ctxmenu .ctxitem:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground, rgba(90,140,220,.3)));\n' +
    '  color: var(--vscode-menu-selectionForeground, var(--vscode-menu-foreground, var(--vscode-foreground))); }\n' +
    '.ctxmenu .ctxsep { height: 1px; margin: .25em 0;\n' +
    '  background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border, rgba(128,128,128,.4))); }\n' +
    '</style>\n</head>\n<body>\n' +
    '<div class="barre" id="barre"></div>\n' +
    '<p class="aide" id="aide"></p>\n' +
    '<div id="zone"></div>\n' +
    '<script nonce="' + nonce + '">\n' + scriptEditeurTable() + '\n</script>\n</body>\n</html>\n';
}

// Script de la webview (chaîne). Séparé pour la lisibilité ; aucune valeur dynamique
// n'y est interpolée (tout arrive par postMessage).
function scriptEditeurTable() {
  return "(function(){\n" +
    "'use strict';\n" +
    "var api=acquireVsCodeApi();\n" +
    "var modele=null, dispo=null, TXT={}, accent='', accentMode='gris', selection=null, ancre=null, premierChargement=true, ctl={};\n" +
    "var barre=document.getElementById('barre'), zone=document.getElementById('zone'), aide=document.getElementById('aide');\n" +
    // --- inline <-> DOM (sans innerHTML) ---
    "function dechap(s){return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'\\\"').replace(/&#x27;/g,\"'\").replace(/&#39;/g,\"'\").replace(/&amp;/g,'&');}\n" +
    "function echap(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}\n" +
    "function poserInline(el,contenu){el.textContent='';var re=/<\\/?(?:strong|em)>|<br>/g,dernier=0,m,pile=[el];\n" +
    "  while((m=re.exec(contenu))!==null){var txt=contenu.slice(dernier,m.index);if(txt){pile[pile.length-1].appendChild(document.createTextNode(dechap(txt)));}\n" +
    "    dernier=re.lastIndex;var tg=m[0];\n" +
    "    if(tg==='<br>'){pile[pile.length-1].appendChild(document.createElement('br'));}\n" +
    "    else if(tg==='<strong>'){var s=document.createElement('strong');pile[pile.length-1].appendChild(s);pile.push(s);}\n" +
    "    else if(tg==='<em>'){var e=document.createElement('em');pile[pile.length-1].appendChild(e);pile.push(e);}\n" +
    "    else if(pile.length>1){pile.pop();}}\n" +
    "  var reste=contenu.slice(dernier);if(reste){pile[pile.length-1].appendChild(document.createTextNode(dechap(reste)));}}\n" +
    "function inlineDeNoeud(n){var out='';n.childNodes.forEach(function(ch){\n" +
    "  if(ch.nodeType===3){out+=echap(ch.nodeValue);}\n" +
    "  else if(ch.nodeType===1){var tg=ch.tagName.toLowerCase();\n" +
    "    if(tg==='br'){out+='<br>';}\n" +
    "    else if(tg==='strong'||tg==='b'){out+='<strong>'+inlineDeNoeud(ch)+'</strong>';}\n" +
    "    else if(tg==='em'||tg==='i'){out+='<em>'+inlineDeNoeud(ch)+'</em>';}\n" +
    "    else{out+=inlineDeNoeud(ch);}}});return out;}\n" +
    // --- récolte des contenus édités vers le modèle ---
    "function recolter(){if(!modele)return;zone.querySelectorAll('[data-li]').forEach(function(el){\n" +
    "  var li=+el.dataset.li,ci=+el.dataset.ci;if(modele.lignes[li]&&modele.lignes[li].cellules[ci]){modele.lignes[li].cellules[ci].contenu=inlineDeNoeud(el).trim();}});}\n" +
    // --- géométrie de sélection ---
    "function rectCell(c){return {rMin:c.r0,cMin:c.c0,rMax:c.r0+c.rowspan-1,cMax:c.c0+c.colspan-1};}\n" +
    "function union(a,b){return {rMin:Math.min(a.rMin,b.rMin),cMin:Math.min(a.cMin,b.cMin),rMax:Math.max(a.rMax,b.rMax),cMax:Math.max(a.cMax,b.cMax)};}\n" +
    "function chevauche(a,b){return !(a.rMax<b.rMin||a.rMin>b.rMax||a.cMax<b.cMin||a.cMin>b.cMax);}\n" +
    "function etendre(rect){var change=true;while(change){change=false;dispo.lignes.forEach(function(lg){lg.cellules.forEach(function(c){\n" +
    "  var cr=rectCell(c);if(chevauche(cr,rect)){var nr=union(rect,cr);if(nr.rMin!==rect.rMin||nr.cMin!==rect.cMin||nr.rMax!==rect.rMax||nr.cMax!==rect.cMax){rect=nr;change=true;}}});});}return rect;}\n" +
    "function plage(){return selection&&(selection.rMax>selection.rMin||selection.cMax>selection.cMin);}\n" +
    "function clampSel(s){if(!s||!dispo)return null;var rMax=Math.min(s.rMax,dispo.nbLignes-1),cMax=Math.min(s.cMax,dispo.nbColonnes-1);if(s.rMin>rMax||s.cMin>cMax||s.rMin<0||s.cMin<0)return null;return etendre({rMin:s.rMin,cMin:s.cMin,rMax:rMax,cMax:cMax});}\n" +
    // --- aperçu live (approxime print.css : accent gris|couleur annuelle) ---
    "function hx(h){h=String(h||'').replace('#','');if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];}return [parseInt(h.slice(0,2),16)||0,parseInt(h.slice(2,4),16)||0,parseInt(h.slice(4,6),16)||0];}\n" +
    "function hx2(v){var s=Math.max(0,Math.min(255,Math.round(v))).toString(16);return s.length<2?'0'+s:s;}\n" +
    "function melange(a,b,t){var x=hx(a),y=hx(b);return '#'+hx2(x[0]+(y[0]-x[0])*t)+hx2(x[1]+(y[1]-x[1])*t)+hx2(x[2]+(y[2]-x[2])*t);}\n" +
    "function accBrut(){return (accentMode==='couleur'&&accent)?accent:null;}\n" +
    "function fondClair(coul){var a=coul?accBrut():null;return a?melange(a,'#ffffff',0.82):'#eeeeee';}\n" +
    "function fondFonce(coul){var a=coul?accBrut():null;return a?melange(a,'#000000',0.35):'#4a4a4a';}\n" +
    "function ligne(coul){var a=coul?accBrut():null;return a?a:'#c9c9c9';}\n" +
    "function styleEnt(el,st){if(st==='gras'){el.style.fontWeight='700';}else if(st==='fond'){el.style.background=fondClair(true);el.style.fontWeight='700';}else if(st==='negatif'){el.style.background=fondFonce(true);el.style.color='#ffffff';el.style.fontWeight='700';}}\n" +
    "function stylerApercu(){if(!dispo||!modele)return;var a=modele.attrs;zone.querySelectorAll('.cell').forEach(function(el){\n" +
    "  el.style.background='';el.style.color='';el.style.fontWeight='';el.style.borderBottom='';el.style.borderTop='';\n" +
    "  var r=+el.dataset.r0,c=+el.dataset.c0,rs=+el.dataset.rs,li=+el.dataset.li,lg=dispo.lignes[li];\n" +
    "  var entL=r<a.enteteLignes,entC=(c<a.enteteColonnes)&&!entL,tot=lg&&lg.total;\n" +
    "  if(a.zebre==='lignes'&&!entL&&!entC&&!tot){var di=r-a.enteteLignes;if(di>=0&&di%2===1)el.style.background=fondClair(a.zebreTeinte==='couleur');}\n" +
    "  else if(a.zebre==='colonnes'&&!entC&&!entL&&!tot){var dc=c-a.enteteColonnes;if(dc>=0&&dc%2===1)el.style.background=fondClair(a.zebreTeinte==='couleur');}\n" +
    "  if(entL){styleEnt(el,a.enteteLigneStyle);}else if(entC){styleEnt(el,a.enteteColonneStyle);}\n" +
    "  if(tot){el.style.background=fondClair(lg.teinte==='couleur');if(lg.gras==='oui')el.style.fontWeight='700';}\n" +
    "  if(a.separateurs!=='non'){el.style.borderBottom='1px solid '+ligne(a.separateurs==='couleur');}\n" +
    "  if(a.bordureHaute==='oui'){if(a.enteteLignes>0&&r===a.enteteLignes-1)el.style.borderBottom='2px solid '+ligne(true);else if(a.enteteLignes===0&&r===0)el.style.borderTop='2px solid '+ligne(true);}\n" +
    "  if(a.bordureBasse==='oui'&&(r+rs===dispo.nbLignes))el.style.borderBottom='2px solid '+ligne(true);\n" +
    "});}\n" +
    // --- rendu ---
    "function cellDom(c){var el=document.createElement(c.th?'th':'td');el.className='cell';el.dataset.li=c.li;el.dataset.ci=c.ci;\n" +
    "  el.dataset.r0=c.r0;el.dataset.c0=c.c0;el.dataset.rs=c.rowspan;el.dataset.cs=c.colspan;\n" +
    "  if(c.colspan>1)el.colSpan=c.colspan;if(c.rowspan>1)el.rowSpan=c.rowspan;\n" +
    "  poserInline(el,c.contenu);\n" +
    "  el.addEventListener('mousedown',function(ev){onCell(ev,c);});\n" +
    "  el.addEventListener('contextmenu',function(ev){ouvrirMenu(ev,{lignes:true,colonnes:true,rMin:c.r0,rMax:c.r0+c.rowspan-1,cMin:c.c0,cMax:c.c0+c.colspan-1,fusionnee:(c.rowspan>1||c.colspan>1)});});\n" +
    "  el.addEventListener('input',function(){etat('');});\n" +
    "  return el;}\n" +
    "function colLettre(n){var s='';n=n+1;while(n>0){var r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}\n" +
    "function rendre(){zone.textContent='';if(!dispo)return;\n" +
    "  var t=document.createElement('table');t.className='grille';\n" +
    "  var trh=document.createElement('tr');var coin=document.createElement('th');coin.className='coin';trh.appendChild(coin);\n" +
    "  for(var c=0;c<dispo.nbColonnes;c++){var ph=document.createElement('th');ph.className='poignee';ph.dataset.pcol=c;ph.textContent=colLettre(c);(function(cc){ph.addEventListener('click',function(){selCol(cc);});ph.addEventListener('contextmenu',function(ev){selCol(cc);ouvrirMenu(ev,{lignes:false,colonnes:true,rMin:0,rMax:dispo.nbLignes-1,cMin:cc,cMax:cc,fusionnee:false});});})(c);trh.appendChild(ph);}\n" +
    "  t.appendChild(trh);\n" +
    "  dispo.lignes.forEach(function(lg,r){var tr=document.createElement('tr');\n" +
    "    var pl=document.createElement('td');pl.className='poignee pnum';pl.dataset.prow=r;pl.textContent=String(r+1);(function(rr){pl.addEventListener('click',function(){selLigne(rr);});pl.addEventListener('contextmenu',function(ev){selLigne(rr);ouvrirMenu(ev,{lignes:true,colonnes:false,rMin:rr,rMax:rr,cMin:0,cMax:dispo.nbColonnes-1,fusionnee:false});});})(r);tr.appendChild(pl);\n" +
    "    lg.cellules.forEach(function(c){tr.appendChild(cellDom(c));});t.appendChild(tr);});\n" +
    "  zone.appendChild(t);majEditable();marquer();stylerApercu();}\n" +
    "function majEditable(){var ed=!plage();zone.querySelectorAll('.cell').forEach(function(el){el.contentEditable=ed?'true':'false';});}\n" +
    "function marquer(){zone.querySelectorAll('.cell').forEach(function(el){\n" +
    "  var cr={rMin:+el.dataset.r0,cMin:+el.dataset.c0,rMax:+el.dataset.r0+ +el.dataset.rs-1,cMax:+el.dataset.c0+ +el.dataset.cs-1};\n" +
    "  var dans=selection&&cr.rMin>=selection.rMin&&cr.rMax<=selection.rMax&&cr.cMin>=selection.cMin&&cr.cMax<=selection.cMax;\n" +
    "  el.classList.toggle('sel',!!dans);});\n" +
    "  zone.querySelectorAll('.poignee[data-pcol]').forEach(function(el){var c=+el.dataset.pcol;el.classList.toggle('selh',!!(selection&&c>=selection.cMin&&c<=selection.cMax));});\n" +
    "  zone.querySelectorAll('.poignee[data-prow]').forEach(function(el){var r=+el.dataset.prow;el.classList.toggle('selh',!!(selection&&r>=selection.rMin&&r<=selection.rMax));});}\n" +
    // --- interactions de sélection ---
    "function onCell(ev,c){if(ev.button===2){return;}if(ev.shiftKey&&ancre){ev.preventDefault();var sel=window.getSelection&&window.getSelection();if(sel)sel.removeAllRanges();\n" +
    "  selection=etendre(union(rectCell(ancre),rectCell(c)));majEditable();marquer();return;}\n" +
    "  ancre=c;selection=rectCell(c);majEditable();marquer();}\n" +
    "function selLigne(r){ancre=null;selection=etendre({rMin:r,cMin:0,rMax:r,cMax:dispo.nbColonnes-1});majEditable();marquer();}\n" +
    "function selCol(c){ancre=null;selection=etendre({rMin:0,cMin:c,rMax:dispo.nbLignes-1,cMax:c});majEditable();marquer();}\n" +
    // --- menu contextuel (clic droit) : opérations de structure ---
    "var menu=null;\n" +
    "function fermerMenu(){if(!menu)return;if(menu.parentNode)menu.parentNode.removeChild(menu);menu=null;document.removeEventListener('mousedown',surMenuMousedown,true);document.removeEventListener('keydown',surMenuKey,true);window.removeEventListener('blur',fermerMenu);}\n" +
    "function surMenuMousedown(ev){if(menu&&menu.contains(ev.target))return;fermerMenu();}\n" +
    "function surMenuKey(ev){if(ev.key==='Escape'){ev.preventDefault();fermerMenu();}}\n" +
    "function itemMenu(txt,fn){var d=document.createElement('div');d.className='ctxitem';d.setAttribute('role','menuitem');d.textContent=txt;d.addEventListener('click',function(){fermerMenu();fn();});return d;}\n" +
    "function sepMenu(m){var d=document.createElement('div');d.className='ctxsep';m.appendChild(d);}\n" +
    "function ouvrirMenu(ev,ctx){fermerMenu();ev.preventDefault();var m=document.createElement('div');m.className='ctxmenu';m.setAttribute('role','menu');\n" +
    "  m.addEventListener('contextmenu',function(e){e.preventDefault();});\n" +
    "  if(ctx.lignes){m.appendChild(itemMenu(TXT['ctx.ligneAvant'],function(){op('ajouterLigne',{pos:ctx.rMin});}));\n" +
    "    m.appendChild(itemMenu(TXT['ctx.ligneApres'],function(){op('ajouterLigne',{pos:ctx.rMax+1});}));\n" +
    "    m.appendChild(itemMenu(TXT['ctx.ligneSuppr'],function(){op('supprimerLigne',{rMin:ctx.rMin,rMax:ctx.rMax});}));}\n" +
    "  if(ctx.lignes&&ctx.colonnes)sepMenu(m);\n" +
    "  if(ctx.colonnes){m.appendChild(itemMenu(TXT['ctx.colAvant'],function(){op('ajouterColonne',{pos:ctx.cMin});}));\n" +
    "    m.appendChild(itemMenu(TXT['ctx.colApres'],function(){op('ajouterColonne',{pos:ctx.cMax+1});}));\n" +
    "    m.appendChild(itemMenu(TXT['ctx.colSuppr'],function(){op('supprimerColonne',{cMin:ctx.cMin,cMax:ctx.cMax});}));}\n" +
    "  if(plage()){sepMenu(m);m.appendChild(itemMenu(TXT.fusionner,function(){op('fusionner',{rMin:selection.rMin,cMin:selection.cMin,rMax:selection.rMax,cMax:selection.cMax});}));}\n" +
    "  if(ctx.fusionnee){if(!plage())sepMenu(m);m.appendChild(itemMenu(TXT.scinder,function(){op('scinder',{rMin:ctx.rMin,cMin:ctx.cMin,rMax:ctx.rMax,cMax:ctx.cMax});}));}\n" +
    "  document.body.appendChild(m);\n" +
    "  var vw=window.innerWidth||document.documentElement.clientWidth,vh=window.innerHeight||document.documentElement.clientHeight,rc=m.getBoundingClientRect();\n" +
    "  var x=ev.clientX,y=ev.clientY;if(x+rc.width>vw)x=Math.max(2,vw-rc.width-2);if(y+rc.height>vh)y=Math.max(2,vh-rc.height-2);\n" +
    "  m.style.left=x+'px';m.style.top=y+'px';menu=m;\n" +
    "  document.addEventListener('mousedown',surMenuMousedown,true);document.addEventListener('keydown',surMenuKey,true);window.addEventListener('blur',fermerMenu);}\n" +
    // --- barre d'outils (helpers ; la structure est passée dans le menu contextuel) ---
    "function bouton(txt,fn,cls){var b=document.createElement('button');b.type='button';b.textContent=txt;if(cls)b.className=cls;b.addEventListener('click',fn);return b;}\n" +
    "function groupe(label){var g=document.createElement('span');g.className='grp';if(label){var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);}return g;}\n" +
    "function op(nom,args){recolter();api.postMessage({type:'operation',nom:nom,args:args,modele:modele});}\n" +
    "function construireBarre(){barre.textContent='';\n" +
    "  barreT2(barre);\n" +
    "  var enr=bouton(TXT.enregistrer,function(){recolter();api.postMessage({type:'enregistrer',modele:modele});},'principal');\n" +
    "  barre.appendChild(enr);\n" +
    "  var e=document.createElement('span');e.id='etat';e.setAttribute('role','status');barre.appendChild(e);}\n" +
    // --- barre d'outils (T2 : en-têtes + styles) ---
    "function selCtrl(parent,label,options,onCh){var g=groupe('');var l=document.createElement('span');l.className='lbl';l.textContent=label;g.appendChild(l);var s=document.createElement('select');options.forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];s.appendChild(op);});s.addEventListener('change',function(){onCh(s.value);});g.appendChild(s);parent.appendChild(g);return s;}\n" +
    "function STYLES(){return [['normal',TXT['st.normal']],['gras',TXT['st.gras']],['negatif',TXT['st.negatif']],['fond',TXT['st.fond']]];}\n" +
    "function onDefinirEntete(){if(!selection){etat(TXT.rien);return;}var s=selection,nbC=dispo.nbColonnes,nbL=dispo.nbLignes;\n" +
    "  if(s.rMin===0&&(s.cMax-s.cMin+1)===nbC&&!(s.rMax===nbL-1&&nbC===1)){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}\n" +
    "  else if(s.cMin===0&&(s.rMax-s.rMin+1)===nbL){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}\n" +
    "  else if(s.rMin===0){op('entete',{sens:'lignes',n:Math.min(2,s.rMax+1)});}\n" +
    "  else if(s.cMin===0){op('entete',{sens:'colonnes',n:Math.min(2,s.cMax+1)});}\n" +
    "  else{etat(TXT.rien);}}\n" +
    "function appliquerTotal(){if(!selection){etat(TXT.rien);return;}op('total',{rMin:selection.rMin,rMax:selection.rMax,teinte:ctl.total.value,gras:ctl.totalGras.checked?'oui':'non'});}\n" +
    "function barreT2(barre){\n" +
    "  var ge=groupe(TXT.grpEntetes);\n" +
    "  ge.appendChild(bouton(TXT.entete,onDefinirEntete));\n" +
    "  ge.appendChild(bouton(TXT.enteteRetirer,function(){op('enteteRetirer',{});}));\n" +
    "  barre.appendChild(ge);\n" +
    "  ctl.styleLigne=selCtrl(barre,TXT.styleLigne,STYLES(),function(v){op('styleEntete',{cible:'ligne',valeur:v});});\n" +
    "  ctl.styleColonne=selCtrl(barre,TXT.styleColonne,STYLES(),function(v){op('styleEntete',{cible:'colonne',valeur:v});});\n" +
    "  var etiq=groupe('');var le=document.createElement('span');le.className='lbl';le.textContent=TXT.grpStyles;etiq.appendChild(le);barre.appendChild(etiq);\n" +
    "  ctl.zebre=selCtrl(barre,TXT.zebre,[['non',TXT['zebre.non']],['lignes',TXT['zebre.lignes']],['colonnes',TXT['zebre.colonnes']]],function(v){op('reglage',{champ:'zebre',valeur:v});});\n" +
    "  ctl.zebreTeinte=selCtrl(barre,TXT.teinte,[['gris',TXT['teinte.gris']],['couleur',TXT['teinte.couleur']]],function(v){op('reglage',{champ:'zebreTeinte',valeur:v});});\n" +
    "  ctl.separateurs=selCtrl(barre,TXT.separateurs,[['non',TXT['sep.non']],['gris',TXT['sep.gris']],['couleur',TXT['sep.couleur']]],function(v){op('reglage',{champ:'separateurs',valeur:v});});\n" +
    "  ctl.bordureHaute=selCtrl(barre,TXT.bordureHaute,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureHaute',valeur:v});});\n" +
    "  ctl.bordureBasse=selCtrl(barre,TXT.bordureBasse,[['non',TXT.non],['oui',TXT.oui]],function(v){op('reglage',{champ:'bordureBasse',valeur:v});});\n" +
    "  ctl.total=selCtrl(barre,TXT.total,[['non',TXT['total.non']],['gris',TXT['total.gris']],['couleur',TXT['total.couleur']]],function(v){appliquerTotal();});\n" +
    "  var gg=groupe('');var lab=document.createElement('label');lab.style.display='inline-flex';lab.style.alignItems='center';lab.style.gap='.25em';var cb=document.createElement('input');cb.type='checkbox';ctl.totalGras=cb;cb.addEventListener('change',appliquerTotal);lab.appendChild(cb);lab.appendChild(document.createTextNode(TXT['total.gras']));gg.appendChild(lab);barre.appendChild(gg);\n" +
    "  ctl.accent=selCtrl(barre,TXT.accent,[['gris',TXT['accent.gris']],['couleur',TXT['accent.couleur']]],function(v){accentMode=v;stylerApercu();});\n" +
    "  if(!accent){ctl.accent.title=TXT['accent.aucune'];}\n" +
    "}\n" +
    "function majT2(){if(!modele||!ctl.zebre)return;var a=modele.attrs;\n" +
    "  ctl.styleLigne.value=a.enteteLigneStyle;ctl.styleColonne.value=a.enteteColonneStyle;\n" +
    "  ctl.zebre.value=a.zebre;ctl.zebreTeinte.value=a.zebreTeinte;ctl.separateurs.value=a.separateurs;\n" +
    "  ctl.bordureHaute.value=a.bordureHaute;ctl.bordureBasse.value=a.bordureBasse;ctl.accent.value=accentMode;}\n" +
    "function etat(msg){var e=document.getElementById('etat');if(e)e.textContent=msg;}\n" +
    // --- clavier : Ctrl+B / Ctrl+I intra-cellule ---
    "try{document.execCommand('styleWithCSS',false,false);}catch(e){}\n" +
    "document.addEventListener('keydown',function(ev){if(!(ev.ctrlKey||ev.metaKey))return;var k=(ev.key||'').toLowerCase();\n" +
    "  if(k==='b'){ev.preventDefault();try{document.execCommand('bold');}catch(e){}}\n" +
    "  else if(k==='i'){ev.preventDefault();try{document.execCommand('italic');}catch(e){}}\n" +
    "  else if(k==='s'){ev.preventDefault();recolter();api.postMessage({type:'enregistrer',modele:modele});}});\n" +
    // --- messages ---
    "window.addEventListener('message',function(ev){var msg=ev.data||{};\n" +
    "  if(msg.type==='charger'){modele=msg.modele;dispo=msg.disposition;if(msg.i18n)TXT=msg.i18n;if(msg.accent!==undefined)accent=msg.accent;\n" +
    "    if(premierChargement){accentMode=accent?'couleur':'gris';premierChargement=false;}\n" +
    "    selection=clampSel(selection);ancre=null;aide.textContent=TXT.aide||'';construireBarre();rendre();majT2();etat('');}\n" +
    "  else if(msg.type==='enregistre'){etat(TXT.enregistre||'');}\n" +
    "  else if(msg.type==='erreur'){etat('\\u26A0 '+msg.message);}});\n" +
    "api.postMessage({type:'pret'});\n" +
    "})();";
}

let panneauxTable = new Map();   // fsPath -> WebviewPanel (un éditeur par fichier)

// Ouvre l'éditeur de tableau pour l'asset (viewItem == table) : lit table-NN.html,
// l'analyse, et alimente la webview. Écrit atomiquement à l'enregistrement.
function ouvrirEditeurTable(fournisseur, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  const chemin = item.cheminAsset;
  const nom = path.basename(chemin);
  const existant = panneauxTable.get(chemin);
  if (existant) { existant.reveal(vscode.ViewColumn.One); return; }
  const panneau = vscode.window.createWebviewPanel(
    'szhEditeurTable', T('table.titre', [nom]), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauxTable.set(chemin, panneau);
  panneau.onDidDispose(() => { if (panneauxTable.get(chemin) === panneau) { panneauxTable.delete(chemin); } });
  panneau.webview.html = htmlEditeurTable(crypto.randomBytes(16).toString('hex'));
  const charger = () => {
    let html = '';
    try { html = fs.readFileSync(chemin, 'utf8'); } catch (e) { html = '<table><tr><td></td></tr></table>'; }
    const modele = analyserTable(html);
    panneau.webview.postMessage({
      type: 'charger', modele: modele, disposition: disposition(modele),
      accent: lireCouleurAccent(fournisseur.racine), i18n: textesTable()
    });
  };
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { charger(); return; }
    if (msg.type === 'operation') {
      const res = appliquerOperationTable(String(msg.nom || ''), msg.modele, msg.args);
      if (res && res.erreur) { panneau.webview.postMessage({ type: 'erreur', message: T(res.erreur) }); return; }
      panneau.webview.postMessage({ type: 'charger', modele: res, disposition: disposition(res), accent: lireCouleurAccent(fournisseur.racine) });
      return;
    }
    if (msg.type === 'enregistrer') {
      try {
        ecrireAusgabeAtomique(chemin, serialiserTable(normaliserModele(msg.modele)));
        panneau.webview.postMessage({ type: 'enregistre' });
        vscode.window.setStatusBarMessage(T('statut.table.enregistree', [nom]), 5000);
      } catch (e) {
        panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [e.message]) });
      }
    }
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

  // Barre d'état « Aperçu : HTML / PDF » (M5, D53) — clic = basculer.
  const barreApercu = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  barreApercu.command = 'szh.basculerApercu';
  context.subscriptions.push(barreApercu);
  const majBarreApercu = () => {
    barreApercu.text = T(modeApercu() === 'html' ? 'apercu.barre.html' : 'apercu.barre.pdf');
    barreApercu.tooltip = T('apercu.barre.tooltip');
    if (fournisseur.racine) { barreApercu.show(); } else { barreApercu.hide(); }
  };

  // Le compte « Word en attente » est recalculé par getChildren (description de
  // section) ; le TITRE de la vue reflète le numéro (N2, D43) à chaque
  // rafraîchissement ; l'aperçu HTML est rechargé si sa sortie a été régénérée (M5).
  const rafraichirTout = () => {
    fournisseur.rafraichir();
    vue.title = fournisseur.racine ? titreNumero(fournisseur.racine) : T('arbre.titre.defaut');
    majBarreApercu();
    rechargerApercuHtmlSiChange(fournisseur);
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
    vscode.commands.registerCommand('szh.reglages', () => ouvrirReglages(rafraichirTout)),
    vscode.commands.registerCommand('szh.basculerApercu', () => basculerApercu(fournisseur, majBarreApercu)),
    vscode.commands.registerCommand('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.ouvrirArticle', (slug) => ouvrirArticle(fournisseur, slug)),
    vscode.commands.registerCommand('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.remplacerAsset', (item) => remplacerAsset(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.remplacerTable', (item) => remplacerTable(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.editerTable', (item) => ouvrirEditeurTable(fournisseur, item)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte)
  );

  enregistrerCommandesMiseEnForme(context);          // M6, D55

  majContexte();
}

function deactivate() { arreterDormeurWsl(); }

// `_pur` : fonctions pures exposées pour les harnais headless (VS Code les ignore).
module.exports = {
  activate, deactivate,
  _pur: {
    titreNumero, separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
    analyserMeta, serialiserMeta, lignePos,
    analyserAusgabe, serialiserAusgabe,
    basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
    enroberBloc, squeletteTableau,
    analyserTable, serialiserTable, disposition,
    matriceOccupation, etendreGrille, compacterGrille,
    normaliserModele, finaliserModele, canoniserInline,
    ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
    fusionner, scinder, appliquerOperationTable,
    TEXTES_COCKPIT
  }
};
