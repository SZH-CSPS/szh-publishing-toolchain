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
// ausgabe.yaml (G1), la SUPPRESSION confirmée d'un article (G3), l'ÉCRASEMENT
// confirmé d'une image (G5) et la CRÉATION d'un tableau articles/<slug>/tables/
// table-NN.html au collage depuis Excel/Word (D81, lib/formatting.js — jamais
// d'écrasement : premier numéro libre). Tout le reste est en lecture seule (ouverture/
// lancement de tâche uniquement).
// Posture szh-apercu : JavaScript pur, zéro dépendance, API VS Code ^1.75.
//
// STRUCTURE (refactor R1–R6, SANS build — CommonJS require résolu à l'exécution +
// fichiers statiques ; empaqueté tel quel par vsce, cf. .vscodeignore) :
//   extension.js            activate/deactivate + câblage des commandes + _pur ré-agrégé
//   lib/i18n.js             TEXTES_COCKPIT, T, langueCockpit
//   lib/yaml.js             sérialiseurs ausgabe/frontmatter/meta, titreNumero, écriture atomique
//   lib/table-model.js      parseur/sérialiseur/opérations PURS du tableau
//   lib/slug.js             slugifier ; lib/wsl.js dormeur WSL ; lib/formatting.js mise en forme
//   lib/webviews/util.js    construireHtml/lireMedia : inline media/ + nonce + CSP stricte
//   media/*.{html,css,js}   webviews (table-editor, metadata-issue/articles, settings, apercu)
// Les webviews n'injectent AUCUNE donnée dans le HTML (elles arrivent par postMessage) ;
// les libellés i18n sont des marqueurs %%SZH:cle%% résolus par T() à l'assemblage.
// lib/ et media/ DOIVENT être empaquetés (voir .vscodeignore). _pur = contrat immuable
// des fonctions pures pour les harnais headless.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  CLES_METADONNEES, COULEURS_NUMERO, HEX_COULEURS, normaliserRevue,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, serialiserAusgabe, ecrireAusgabeAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, titreNumero
} = require('./lib/yaml');
// ---- Modèle de tableau -> lib/table-model.js -------------------------------------
const {
  analyserTable, serialiserTable, disposition, matriceOccupation,
  etendreGrille, compacterGrille, normaliserModele, finaliserModele, canoniserInline,
  ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
  fusionner, scinder, viderCellules, alignerCellules,
  deplacerLigne, deplacerColonne,
  tableauDepuisTsv, collerDans, appliquerOperationTable,
  fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule, tableauDepuisHtmlBureautique
} = require('./lib/table-model');
// ---- Assemblage des webviews -> lib/webviews/util.js -----------------------------
const { construireHtml, lireMedia } = require('./lib/webviews/util');
// ---- Modules impératifs -> lib/{slug,wsl,formatting}.js --------------------------
const { slugifier } = require('./lib/slug');
const { demarrerDormeurWsl, arreterDormeurWsl, reveillerWsl } = require('./lib/wsl');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, blocReferenceTable, nomTableLibre,
  enregistrerCommandesMiseEnForme
} = require('./lib/formatting');

// Éditeur PDF (extension tomoki1207.pdf), comme szh-apercu.
const VUE_PDF = 'pdf.preview';
const EXT_PDF = 'tomoki1207.pdf';

// slugifier -> lib/slug.js

// Maintien en vie de WSL (N1) -> lib/wsl.js

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

// Profil de compilation du DOSSIER (D20/T6.4), relu par majContexte(). Miroir exact
// de la lecture du Makefile (sed sur ausgabe.yaml) : clé absente = « article ».
// Une clé PRÉSENTE mais VIDE est un choix (« ce dossier ne produit aucun document ») :
// on la distingue, comme le Makefile, sous le jeton 'rien'.
let profilRevue = 'article';

function lireProfil(racine) {
  if (!racine) { return 'article'; }
  try {
    const m = fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')
      .match(/^profil:[ \t]*["']?([a-zA-Z-]*)/m);
    if (!m) { return 'article'; }
    return m[1] === '' ? 'rien' : m[1];
  } catch (e) { return 'article'; }        // ausgabe.yaml illisible : comportement historique
}

function modeApercu() {
  // Un dossier qui ne produit pas de PDF (profil « presentation », D20) n'a rien à
  // montrer en mode pdf : la colonne 2 dirait « PDF introuvable » alors que la
  // compilation a parfaitement réussi. On force donc l'aperçu HTML — que la route
  // `presentation` du Makefile régénère exprès pour cette raison.
  // Effet de bord assumé : sur un tel dossier, la bascule de la barre d'état écrit
  // bien le réglage mais l'aperçu reste HTML. Masquer la bascule demanderait un
  // nouveau texte traduit ; à faire au prochain lot de traduction.
  if (profilRevue !== 'article') { return 'html'; }
  try {
    return String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { return 'html'; }
}

let panneauApercuHtml = null;
let apercuCourantSlug = null;
let apercuHtmlMtime = 0;

// A1 — défilement synchronisé (.md <-> aperçu). Garde anti-boucle côté hôte : quand
// c'est NOUS qui révélons une ligne dans l'éditeur (suite à un scroll de l'aperçu),
// on ignore l'événement onDidChangeTextEditorVisibleRanges qui en découle.
let defilementProgrammatiqueHote = false;
let minuteurHoteVersApercu = null;
let minuteurHoteRelache = null;

// « 01-exemple.md@12:3-14:1 » (ou « 12:3-14:1 ») -> 12. null si illisible.
function lignePos(pos) {
  const texte = String(pos || '');
  const droite = texte.indexOf('@') !== -1 ? texte.slice(texte.indexOf('@') + 1) : texte;
  const m = droite.match(/^(\d+):/);
  return m ? parseInt(m[1], 10) : null;
}

// A2 — plage source complète d'un data-pos : « …@L:C-L:C » -> {l1,c1,l2,c2} (1-based)
// ou null. Pur (testé headless via _pur).
function plagePos(pos) {
  const texte = String(pos || '');
  const droite = texte.indexOf('@') !== -1 ? texte.slice(texte.indexOf('@') + 1) : texte;
  const m = droite.match(/^(\d+):(\d+)-(\d+):(\d+)/);
  if (!m) { return null; }
  return { l1: parseInt(m[1], 10), c1: parseInt(m[2], 10), l2: parseInt(m[3], 10), c2: parseInt(m[4], 10) };
}

// A2 — 1re occurrence de `mot` dans la plage source [l1:c1 .. l2] d'un bloc.
// `lignes` : tableau des lignes du .md. Renvoie {ligne, colonne, longueur} (0-based
// ligne/colonne, pour l'API VS Code) ou null. Précision « au mieux » : le mot vient
// du texte RENDU, on le cherche tel quel dans la source (repli bloc si introuvable —
// mot dans du balisage éclaté, entité HTML, etc.). Pur (testé headless via _pur).
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

// G3 — jeton (mot) sous le curseur dans une LIGNE source, colonne 0-based. Mêmes
// délimiteurs que motAuPoint (apercu.js) pour que le jeton corresponde au texte
// rendu côté aperçu. Chaîne vide si le curseur est sur un délimiteur / hors mot.
// Pur (testé headless via _pur).
function jetonSource(texte, colonne) {
  const s = String(texte == null ? '' : texte);
  const i = Math.max(0, Math.min(colonne | 0, s.length));
  const estMot = (ch) => ch !== '' && /[^\s.,;:!?()\[\]{}«»"'…—–\/]/.test(ch);
  let deb = i, fin = i;
  while (deb > 0 && estMot(s.charAt(deb - 1))) { deb--; }
  while (fin < s.length && estMot(s.charAt(fin))) { fin++; }
  return s.slice(deb, fin);
}

// Éditeur visible du .md de l'article actuellement affiché en aperçu (colonne 1),
// ou null. Sert au défilement synchronisé (A1) : révéler une ligne SANS voler le focus.
function editeurArticleCourant(fournisseur) {
  if (!apercuCourantSlug || !fournisseur.racine) { return null; }
  const cible = path.join(fournisseur.racine, 'articles', apercuCourantSlug, apercuCourantSlug + '.md').toLowerCase();
  for (const ed of vscode.window.visibleTextEditors) {
    if (ed.document && ed.document.uri && ed.document.uri.fsPath.toLowerCase() === cible) { return ed; }
  }
  return null;
}

// Aperçu -> éditeur : révèle `ligne` (1-based) au sommet, sans focus. Pose la garde
// anti-boucle le temps que l'événement de visibilité qui en résulte soit ignoré.
function revelerLigneSource(fournisseur, ligne) {
  const ed = editeurArticleCourant(fournisseur);
  if (!ed) { return; }
  const l = Math.max(0, Math.min((parseInt(ligne, 10) || 1) - 1, ed.document.lineCount - 1));
  defilementProgrammatiqueHote = true;
  ed.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.AtTop);
  if (minuteurHoteRelache) { clearTimeout(minuteurHoteRelache); }
  minuteurHoteRelache = setTimeout(() => { defilementProgrammatiqueHote = false; }, 200);
}

// Éditeur -> aperçu : première ligne visible (1-based) postée à la webview (débounce).
function pousserDefilementVersApercu(ligne0Based) {
  if (minuteurHoteVersApercu) { clearTimeout(minuteurHoteVersApercu); }
  minuteurHoteVersApercu = setTimeout(() => {
    if (!panneauApercuHtml) { return; }
    try { panneauApercuHtml.webview.postMessage({ type: 'scroll', ligne: ligne0Based + 1 }); }
    catch (e) { /* webview fermée entre-temps */ }
  }, 35);
}

// G3 — curseur/clic dans le .md -> surlignage côté aperçu. Poste la ligne (1-based)
// et le mot sous le curseur ; la webview surligne le bloc (et le mot) correspondant
// et l'amène en vue seulement s'il est hors écran. Débounce léger. Complément de
// l'A2 (aperçu -> source) ; aucune boucle : la webview ne renvoie rien au survol.
let minuteurHoteSurlignage = null;
function pousserSurlignageVersApercu(fournisseur) {
  if (minuteurHoteSurlignage) { clearTimeout(minuteurHoteSurlignage); }
  minuteurHoteSurlignage = setTimeout(() => {
    if (!panneauApercuHtml) { return; }
    const ed = editeurArticleCourant(fournisseur);
    if (!ed) { return; }
    const pos = ed.selection.active;
    let mot = '';
    try { mot = jetonSource(ed.document.lineAt(pos.line).text, pos.character); }
    catch (e) { mot = ''; }
    try { panneauApercuHtml.webview.postMessage({ type: 'surligner', ligne: pos.line + 1, mot: mot }); }
    catch (e) { /* webview fermée entre-temps */ }
  }, 60);
}

// Injecte dans le HTML autonome de pandoc : CSP stricte, bandeau, styles de
// survol et script (nonce). Les valeurs n'entrent jamais en HTML non échappé.
function injecterApercu(contenu, nonce) {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\'">';
  const ajout =
    '<style>' + lireMedia('apercu.css') + '</style>' +
    '<div id="szh-bandeau"><span>' + T('apercu.bandeau') + '</span>' +
    '<button id="szh-basculer" type="button">' + T('apercu.bandeau.pdf') + '</button></div>' +
    '<script nonce="' + nonce + '">' + lireMedia('apercu.js') + '</script>';
  let html = contenu;
  html = html.indexOf('<head>') !== -1 ? html.replace('<head>', '<head>\n' + csp) : csp + html;
  html = html.indexOf('</body>') !== -1 ? html.replace('</body>', ajout + '\n</body>') : html + ajout;
  return html;
}

// Clic dans l'aperçu -> texte source (N5 + A2). Vise le MOT cliqué s'il est fourni
// et retrouvé dans la plage source du bloc ; sinon repli sur le début du bloc
// (comportement historique, jamais régressé). Ouvre le .md en colonne 1 et y place
// le curseur (focus donné : c'est un clic explicite pour éditer).
async function revelerPos(fournisseur, slug, pos, mot) {
  const pl = plagePos(pos);
  const ligneDebut = pl ? pl.l1 : lignePos(pos);
  if (!ligneDebut || !fournisseur.racine) { return; }
  const md = path.join(fournisseur.racine, 'articles', slug, slug + '.md');
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
      if (msg.type === 'revele' && apercuCourantSlug) { revelerPos(fournisseur, apercuCourantSlug, msg.pos, msg.mot); }
      if (msg.type === 'scrollSource') { revelerLigneSource(fournisseur, msg.ligne); }   // A1
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
// Slug de l'article correspondant à un chemin, ou null. Un article est un
// <racine>/articles/<slug>/<slug>.md (structure D26, .md HOMONYME de son dossier) :
// BIENVENUE.md, un .md à la racine ou un fichier d'un autre dossier ne sont PAS des
// articles. Même test que szh-apercu (une seule définition de « article » dans la
// chaîne). Pur : chemins -> slug.
function slugDepuisChemin(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const parties = path.relative(racine, chemin).split(path.sep);
  if (parties.length !== 3 || parties[0] !== 'articles') { return null; }
  return parties[2] === parties[1] + '.md' ? parties[1] : null;
}

// T6.2 — au démarrage, si l'éditeur actif EST déjà un article (cas du double-clic sur
// un .md depuis l'Explorateur : le lanceur open-md.ps1 ouvre le DOSSIER + le FICHIER),
// enchaîner exactement ce que fait un clic dans la barre latérale : compiler si
// nécessaire puis afficher l'aperçu en colonne 2.
//
// POURQUOI ici et pas dans le lanceur PowerShell : le lanceur reste « bête » (D20).
// Compiler depuis Windows lancerait un make concurrent de celui que déclenchent
// `triggerTaskOnSave` et la tâche `folderOpen` — or le Makefile n'a aucun verrou et
// deux make écriraient le même out/<slug>/. Et ouvrir le PDF hors de l'éditeur le
// verrouillerait, faisant échouer le remplacement atomique du Makefile. Ici, tout
// passe par le chemin unique de D46, avec ses garde-fous (buildEnCours, propriété de
// la colonne 2 — D54).
async function ouvrirArticleActifAuDemarrage(fournisseur) {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const slug = slugDepuisChemin(fournisseur.racine, editeur.document.uri.fsPath);
  if (!slug) { return; }                            // pas un article : ne rien forcer
  try { await ouvrirArticle(fournisseur, slug); }
  catch (e) { /* démarrage : ne jamais bloquer l'ouverture de la revue */ }
}

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
  return construireHtml('metadata-issue', nonce, { titre: T('meta.titre'), remplacements: { '__TXT__': txt } });
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
    // revue (D74) : uniquement le jeton canonique zeitschrift/revue (dérivé du
    // radio, ou d'un ancien nom complet). Toute autre valeur est ignorée.
    if ('revue' in modifies) {
      const r = normaliserRevue(modifies.revue);
      if (r === '') { delete modifies.revue; } else { modifies.revue = r; }
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
  return construireHtml('metadata-articles', nonce, { titre: T('fiches.titre'), remplacements: { '__TXT__': txt } });
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
    // Menu « Type d'article » (E2, D71) : 6 types en 2 groupes (liés au dossier /
    // hors dossier), libellés + en-têtes de groupe dans la langue par défaut du
    // numéro. Le champ `groupe` pilote la construction des <optgroup> côté webview.
    const options = (liste, groupe) => liste.map((t) => ({
      valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t,
      groupe: (GROUPES_TYPES[groupe] || {})[langue] || (GROUPES_TYPES[groupe] || {}).fr || ''
    }));
    panneau.webview.postMessage({
      type: 'valeurs',
      articles: lireMetadonneesArticles(fournisseur),
      langue: langue,
      types: options(TYPES_DOSSIER, 'dossier').concat(options(TYPES_HORS, 'hors'))
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
  return construireHtml('settings', nonce, { titre: T('regl.titre'), remplacements: { '__TXT__': REGL_TEXTES() } });
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

// ---- Mise en forme (M6, D55) -> lib/formatting.js ------------------------------

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
// MODÈLE (encodage HTML) : le fichier est un <table
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

// Teintes RÉELLES de l'aperçu de l'éditeur de tableau (D76). On ne les RECALCULE pas :
// l'éditeur est un WYSIWYG, il doit montrer les hex que WeasyPrint appliquera. Or ces
// valeurs sont déjà écrites par le pipeline dans out/.szh-accent.css à chaque build
// (accent-css.py) : on les y LIT. Une formule réimplémentée en JS a déjà divergé une
// fois — c'est exactement ce qui a rendu l'aperçu plus pâle que le PDF au passage à APCA.
// Repli : null -> la webview retombe sur les gris neutres de print.css, comme le PDF
// d'un numéro sans couleur. Volontairement AUCUN calcul de secours.
function lireTeintesAccent(racine) {
  const jetons = { clair: null, fonce: null, filet: null };
  try {
    const css = fs.readFileSync(path.join(racine, 'out', '.szh-accent.css'), 'utf8');
    const lire = (nom) => {
      const m = css.match(new RegExp(nom + '\\s*:\\s*(#[0-9A-Fa-f]{3,6})'));
      return m ? m[1] : null;
    };
    jetons.clair = lire('--szh-accent-clair');
    jetons.fonce = lire('--szh-accent-fonce');
    jetons.filet = lire('--c-annual-ui');
  } catch (e) { /* jamais compilé : gris neutres */ }
  return jetons;
}

// Libellés localisés transmis à la webview de l'éditeur de tableau.
function textesTable() {
  const cles = [
    'table.aide', 'table.enregistrer', 'table.fusionner', 'table.scinder',
    'table.rien', 'table.fusionImpossible', 'table.enregistre',
    'table.ctx.ligneAvant', 'table.ctx.ligneApres', 'table.ctx.ligneSuppr',
    'table.ctx.colAvant', 'table.ctx.colApres', 'table.ctx.colSuppr',
    'table.entete', 'table.enteteRetirer',
    // Panneau de mise en forme (T2) : 3 zones.
    'table.zone.styles', 'table.zone.preset', 'table.preset.bientot', 'table.modele',
    'table.zone.entetes', 'table.entetesLignes', 'table.entetesColonnes', 'table.entetes.aucun',
    'table.total', 'table.gras',
    'table.fond.aucun', 'table.fond.negatif', 'table.fond.couleur', 'table.fond.gris',
    'table.zone.tableau', 'table.bordureHaute', 'table.bordureBasse',
    'table.zebreCol', 'table.zebreLig',
    'table.zebre.aucun', 'table.zebre.paires', 'table.zebre.impaires', 'table.zebre.entetes',
    'table.grpEdition', 'table.annuler', 'table.retablir', 'table.vider', 'table.effacerForme',
    'table.retour', 'table.nonEnregistre',
    'table.tip.annuler', 'table.tip.retablir', 'table.tip.vider', 'table.tip.effacerForme',
    'table.tip.retour', 'table.tip.enregistrer',
    'table.grpAlign', 'table.alignGauche', 'table.alignCentre', 'table.alignDroite',
    'table.tip.alignGauche', 'table.tip.alignCentre', 'table.tip.alignDroite', 'table.coller',
    'table.plusLigne', 'table.plusColonne', 'table.tirerReordonner', 'table.deplacementImpossible',
    'table.suppr.question', 'table.suppr.detail', 'table.suppr.bouton',
    'table.tip.entete', 'table.tip.enteteRetirer'
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
  // media/table-editor.{html,css,js} (script inline à nonce). i18n par postMessage.
  return construireHtml('table-editor', nonce, { titre: T('table.titre', ['']) });
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
      accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      i18n: textesTable()
    });
  };
  // Applique une opération : le modèle reste la source de vérité — tout passe par
  // appliquerOperationTable (round-trip préservé), l'hôte renvoie la disposition.
  // Confirmation MODALE préalable si demandée (V2d : suppression d'une ligne/colonne
  // contenant du texte ; la webview ne pose le drapeau que dans ce cas).
  const appliquer = async (msg) => {
    if (msg.confirmer) {
      const choix = await vscode.window.showWarningMessage(
        T('table.suppr.question'), { modal: true, detail: T('table.suppr.detail') }, T('table.suppr.bouton'));
      if (choix !== T('table.suppr.bouton')) { return; }
    }
    const res = appliquerOperationTable(String(msg.nom || ''), msg.modele, msg.args);
    if (res && res.erreur) { panneau.webview.postMessage({ type: 'erreur', message: T(res.erreur) }); return; }
    panneau.webview.postMessage({ type: 'charger', modele: res, disposition: disposition(res),
      accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine) });
  };
  const enregistrer = (modele) => {
    ecrireAusgabeAtomique(chemin, serialiserTable(normaliserModele(modele)));
    vscode.window.setStatusBarMessage(T('statut.table.enregistree', [nom]), 5000);
  };
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { charger(); return; }
    if (msg.type === 'operation') { await appliquer(msg); return; }
    if (msg.type === 'restaurer') {
      // Annuler/rétablir (D60) : la pile d'états vit dans la webview ; l'hôte n'est
      // qu'un calculateur pur de disposition (pas de duplication du modèle côté webview).
      const m = normaliserModele(msg.modele);
      panneau.webview.postMessage({ type: 'charger', modele: m, disposition: disposition(m),
        accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine) });
      return;
    }
    if (msg.type === 'modifie') {
      // Indicateur ● « non enregistré » sur l'onglet (D1 : confirmation, pas d'auto-save).
      panneau.title = (msg.modifie ? '● ' : '') + T('table.titre', [nom]);
      return;
    }
    if (msg.type === 'retourArticle') {
      // Garde « non-enregistré » (D1) sur un chemin de fermeture QUE l'on contrôle.
      if (msg.modifie) {
        const choix = await vscode.window.showWarningMessage(
          T('table.quitter.question', [nom]), { modal: true, detail: T('table.quitter.detail') },
          T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
        if (choix === undefined) { return; }                       // Annuler : on reste
        if (choix === T('form.enregistrer')) { try { enregistrer(msg.modele); } catch (e) { panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [e.message]) }); return; } }
      }
      if (item.slug) { await ouvrirArticle(fournisseur, item.slug); }
      panneau.dispose();
      return;
    }
    if (msg.type === 'enregistrer') {
      try {
        enregistrer(msg.modele);
        panneau.webview.postMessage({ type: 'enregistre' });
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
    profilRevue = lireProfil(racine);            // T6.4 : pilote le mode d'aperçu
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
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte),
    // A1 — défilement synchronisé éditeur -> aperçu : la 1re ligne visible du .md de
    // l'article courant est poussée à la webview. Ignoré si l'aperçu HTML n'est pas
    // à l'écran, ou si c'est notre propre révélation (aperçu -> éditeur) qui l'a déclenché.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!panneauApercuHtml || modeApercu() !== 'html' || defilementProgrammatiqueHote) { return; }
      if (!e.visibleRanges || !e.visibleRanges.length) { return; }
      const ed = editeurArticleCourant(fournisseur);
      if (!ed || e.textEditor !== ed) { return; }
      pousserDefilementVersApercu(e.visibleRanges[0].start.line);
    }),
    // G3 — sens inverse : le curseur (ou un clic) dans le .md de l'article courant
    // surligne le bloc/mot correspondant dans l'aperçu HTML.
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!panneauApercuHtml || modeApercu() !== 'html') { return; }
      const ed = editeurArticleCourant(fournisseur);
      if (!ed || e.textEditor !== ed) { return; }
      pousserSurlignageVersApercu(fournisseur);
    })
  );

  // M6, D55 — le contexte de revue est INJECTÉ : le collage de tableau (Ctrl+Alt+V)
  // doit savoir s'il est dans un article (slugDepuisChemin, définition unique) et
  // rafraîchir l'arbre pour y faire apparaître le tableau créé.
  enregistrerCommandesMiseEnForme(context, {
    racine: () => fournisseur.racine,
    slugDepuisChemin: slugDepuisChemin,
    rafraichirTout: rafraichirTout
  });

  // F7 : au démarrage, si une revue est ouverte, l'init lente (réveil de la VM WSL —
  // le vrai coût, puis chargement de l'arbre) se fait derrière un indicateur de
  // progression + un item de barre d'état animé, pour ne pas laisser l'utilisatrice
  // devant une fenêtre « vide » qui semble figée. Sans revue : init normale, silencieuse.
  const demarrageInitial = async () => {
    if (!trouverRacineRevue()) { majContexte(); return; }
    const barre = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    barre.text = '$(sync~spin) ' + T('demarrage.barre');
    barre.tooltip = T('demarrage.titre');
    barre.show();
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: T('demarrage.titre'), cancellable: false },
        async (progress) => {
          progress.report({ message: T('demarrage.env') });
          await reveillerWsl();                    // réveil WSL (démarrage à froid de la VM)
          progress.report({ message: T('demarrage.revue') });
          majContexte();                           // racine + contexte + watchers + dormant + arbre
          await ouvrirArticleActifAuDemarrage(fournisseur);   // T6.2
        });
    } finally { barre.dispose(); }
  };
  demarrageInitial();
}

function deactivate() { arreterDormeurWsl(); }

// `_pur` : fonctions pures exposées pour les harnais headless (VS Code les ignore).
module.exports = {
  activate, deactivate,
  _pur: {
    titreNumero, slugDepuisChemin, lireProfil,
    separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
    analyserMeta, serialiserMeta, lignePos, plagePos, positionMot, jetonSource,
    analyserAusgabe, serialiserAusgabe,
    basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
    enroberBloc, squeletteTableau, blocReferenceTable, nomTableLibre,
    analyserTable, serialiserTable, disposition,
    matriceOccupation, etendreGrille, compacterGrille,
    normaliserModele, finaliserModele, canoniserInline,
    ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
    fusionner, scinder, viderCellules, alignerCellules,
    deplacerLigne, deplacerColonne,
    tableauDepuisTsv, collerDans, appliquerOperationTable,
    fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule, tableauDepuisHtmlBureautique,
    TEXTES_COCKPIT
  }
};
