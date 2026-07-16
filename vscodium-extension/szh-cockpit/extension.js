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
  // G5 : l'article est DÉPLIABLE s'il a des images (la flèche montre les assets,
  // le clic sur le libellé ouvre toujours le .md — risque R2, à confirmer en GUI).
  _itemsArticles() {
    const base = path.join(this.racine, 'articles');
    const slugs = this._sousDossiersAvecMd(base);
    if (slugs.length === 0) { return [this._vide('Aucun article pour l’instant')]; }
    return slugs.map((slug) => {
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      const aDesImages = this._imagesArticle(slug).length > 0;
      const it = new vscode.TreeItem(slug, aDesImages
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None);
      it.slug = slug;                   // utilisé par les actions S4/G3/G5
      it.resourceUri = md;              // icône de fichier selon le thème
      it.tooltip = md.fsPath;
      it.contextValue = 'article';      // pilote les boutons inline (menus view/item/context)
      // Le .md s'ouvre TOUJOURS dans la colonne 1 (gauche) : mise en page à deux
      // vues stable (gauche = texte, droite = aperçu), jamais de 3ᵉ colonne.
      it.command = {
        command: 'vscode.open', title: 'Ouvrir l’article',
        arguments: [md, { viewColumn: vscode.ViewColumn.One }]
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

  // Enfants d'un article (G5) : ses images, avec « L × H · poids » en description.
  _itemsAssets(slug) {
    const base = path.join(this.racine, 'articles', slug, 'media');
    return this._imagesArticle(slug).map((relatif) => {
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
    // pdf.preview étant mono-instance, ouvrir ici révèle l'onglet même si szh-apercu
    // l'a déjà ouvert (article actif) — aucun doublon possible.
    if (fs.existsSync(pdf.fsPath)) { await ouvrirApercuPdf(pdf); }
    else { vscode.window.showErrorMessage('PDF introuvable après compilation : « ' + slug + ' ».'); }
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
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
    vscode.commands.registerCommand('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    vscode.commands.registerCommand('szh.ouvrirPdf', (item) => ouvrirPdf(fournisseur, item)),
    vscode.commands.registerCommand('szh.compiler', () => compiler(fournisseur)),
    vscode.commands.registerCommand('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    vscode.commands.registerCommand('szh.remplacerAsset', (item) => remplacerAsset(fournisseur, rafraichirTout, item)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte)
  );

  majContexte();
}

function deactivate() { arreterDormeurWsl(); }

// `_pur` : fonctions pures exposées pour les harnais headless (VS Code les ignore).
module.exports = { activate, deactivate, _pur: { titreNumero } };
