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
// F6 (dialogue d'import) : à la fin d'une conversion qui produit AU MOINS UN
//   nouvel article, le webview « Vérification de l'import » (szhImportVerif,
//   singleton) remplace la notification « N importés » — cartes de métadonnées
//   pré-remplies par le <slug>.meta.yaml du pipeline avec badges détecté /
//   à compléter, photos d'auteur·e·s (modale F3 réutilisée) et remplacement des
//   images de media/ par leurs originaux (dépôt base64 ≤ 50 Mo, nom conservé).
//
// Fiche image : le CLIC sur une image de l'arbre ouvre une fiche (webview
//   szhFicheImage, une par image) où se saisissent la LÉGENDE, le TEXTE ALTERNATIF
//   (avec un choix explicite « image décorative » qui écrit alt="") et les CRÉDITS
//   (copyright / source). Ces données vivent dans le TEXTE de l'article —
//   ![Légende](media/x.png){alt="…" copyright="…" source="…"} — et sont lues/écrites
//   par les fonctions pures de lib/references.js, via WorkspaceEdit + doc.save().
//   L'aperçu natif de VSCodium reste accessible (bouton « Ouvrir l'image »).
//
// Traductions (D113) : troisième section de la barre, « Traductions ». Un article
//   par ligne, DÉPLIABLE sur ses champs bilingues (titre / sous-titre / résumé /
//   mots-clés × langue cible) : le coup d'œil « traduit / à traduire », plus l'état
//   d'atelier de chacun (pas prêt → prêt pour traduction → prêt pour relecture →
//   traduction finalisée). Le bouton de la section lance la campagne (tous les
//   champs encore « pas prêt » passent à « prêt pour traduction » — jamais de
//   recul). Le CLIC ouvre le panneau szhTraduction : formulaire en colonne 1
//   (source en lecture seule + traduction à saisir + état, un bouton par état pour
//   tout l'article, zone « question / commentaire »), aperçu de l'article en
//   colonne 2. Deux fichiers, deux rôles : les TEXTES traduits vont dans
//   <slug>.meta.yaml (publiés, exportés vers OJS), l'ÉTAT dans le sidecar
//   <slug>.traduction.yaml (jamais publié, invisible du Makefile) — cf. l'en-tête
//   de lib/traduction.js.
//
// Écritures autorisées : la COPIE des .docx choisis vers articles-word/ (S3 ;
// mêmes règles pour les .docx DÉPOSÉS sur la vue, F2), ausgabe.yaml (G1), la
// SUPPRESSION confirmée d'un article (G3), l'ÉCRASEMENT confirmé d'une image
// (G5 ; aussi par dépôt depuis le dialogue de vérification d'import, F6),
// la CRÉATION d'un tableau articles/<slug>/tables/table-NN.html au collage depuis
// Excel/Word (D81) ET par « Insérer un tableau » (D95, grille vierge puis éditeur de
// tableau) — lib/formatting.js, jamais d'écrasement : premier numéro libre
// et les PORTRAITS d'auteur·e·s articles/<slug>/portraits/ (F3, D91/D92 : photo
// déposée <slug-auteur>.original.<ext> — les anciens .original.* d'une autre
// extension sont retirés — plus les versions .avec-fond.png/.sans-fond.png écrites
// par le pipeline WSL), et la RÉÉCRITURE de la référence d'une image dans
// articles/<slug>/<slug>.md par la fiche image (légende + attributs alt/copyright/
// source ; WorkspaceEdit, donc annulable par Ctrl+Z), et le SUIVI DE TRADUCTION
// articles/<slug>/<slug>.traduction.yaml (D113 : statuts + commentaire ; fichier
// form-owned, régénéré à chaque enregistrement et SUPPRIMÉ quand il ne reste plus
// rien à retenir). Tout le reste est en lecture seule (ouverture/lancement de
// tâche uniquement).
// Posture szh-apercu : JavaScript pur, zéro dépendance, API VS Code ^1.75.
//
// STRUCTURE (refactor R1–R6, SANS build — CommonJS require résolu à l'exécution +
// fichiers statiques ; empaqueté tel quel par vsce, cf. .vscodeignore) :
//   extension.js            activate/deactivate + câblage des commandes + _pur ré-agrégé
//   lib/i18n.js             TEXTES_COCKPIT, T, langueCockpit
//   lib/yaml.js             sérialiseurs ausgabe/frontmatter/meta, titreNumero, écriture atomique
//   lib/table-model.js      parseur/sérialiseur/opérations PURS du tableau
//   lib/slug.js             slugifier + slugifierArticle ; lib/wsl.js dormeur WSL ;
//                           lib/formatting.js mise en forme
//   lib/portraits.js        appel WSL du pipeline de portraits (F3, D91)
//   lib/panneaux.js         les trois panneaux QuickPick de la barre (Commande/Édition/Export, F1)
//   lib/traduction.js       modèle PUR du suivi de traduction (sidecar + lignes à traduire, D113)
//   lib/webviews/util.js    construireHtml/lireMedia : inline media/ + nonce + CSP stricte
//   media/*.{html,css,js}   webviews (table-editor, metadata-issue/articles, settings,
//                           apercu, import-verif, traduction)
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
// D116 : l'état du numéro en clés de contexte — c'est ce que lisent les `when` de
// package.json (bouton « Exporter cet article » de l'arbre).
const CLE_VERROUILLEE = 'szh.verrouillee';
const CLE_ARCHIVEE = 'szh.archivee';
const ID_VUE = 'szhCockpitVue';
// ⚠ Doivent correspondre EXACTEMENT aux labels de vscodium-user/tasks.json.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const NOM_TACHE_EXPORT = 'Tout exporter';
const NOM_TACHE_DOCX = 'Galleys DOCX (OJS)';
// « Exporter cet article » (D117) : la seule tâche que le cockpit construit LUI-MÊME
// (les autres sont des tâches utilisateur retrouvées par leur label). Raison : sa
// cible dépend du slug cliqué, or une tâche de tasks.json a des arguments figés.
// ⚠ Distro et chemin du Makefile identiques à vscodium-user/tasks.json, lib/wsl.js
// et lib/portraits.js — quatre endroits, une seule valeur.
const DISTRO_WSL = 'SZH-Publishing';
const MAKEFILE_WSL = '/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile';

// ---- i18n du cockpit (M4, D52) -> lib/i18n.js ------------------------------------
const { TEXTES_COCKPIT, T, langueCockpit } = require('./lib/i18n');
// ---- Sérialiseurs YAML -> lib/yaml.js --------------------------------------------
const {
  CLES_METADONNEES, COULEURS_NUMERO, HEX_COULEURS, normaliserRevue, estVraiYaml,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, serialiserAusgabe, ecrireAusgabeAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, titreNumero, etatRevue
} = require('./lib/yaml');
// ---- Cycle de vie du numéro (D116-D117 et D120) -> lib/archivage.js -----------------------
const {
  versionInstallee, versionsDivergent, tailleDossier, supprimerDossier,
  lancerArchivage, lancerChoixVersion, lireModeDeveloppeur, ecrireModeDeveloppeur
} = require('./lib/archivage');
// ---- Modèle de tableau -> lib/table-model.js -------------------------------------
const {
  analyserTable, serialiserTable, disposition, matriceOccupation,
  etendreGrille, compacterGrille, normaliserModele, finaliserModele, canoniserInline,
  ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
  fusionner, scinder, viderCellules, alignerCellules,
  deplacerLigne, deplacerColonne,
  tableauDepuisTsv, collerDans, appliquerOperationTable,
  fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule, tableauDepuisHtmlBureautique,
  PRESETS_ORDRE
} = require('./lib/table-model');
// ---- Assemblage des webviews -> lib/webviews/util.js -----------------------------
const { construireHtml, lireMedia } = require('./lib/webviews/util');
// ---- Modules impératifs -> lib/{slug,wsl,formatting}.js --------------------------
const { slugifier, slugifierArticle } = require('./lib/slug');
const { demarrerDormeurWsl, arreterDormeurWsl, reveillerWsl } = require('./lib/wsl');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, nomTableLibre,
  enregistrerCommandesMiseEnForme
} = require('./lib/formatting');
const { enregistrerPanneaux } = require('./lib/panneaux');
const { genererExportOjs } = require('./lib/export-ojs');
const { retirerImage, retirerTable, lireAttributsImage, ecrireAttributsImage } = require('./lib/references');
const { traiterPortraits } = require('./lib/portraits');
// ---- Suivi de traduction (D113) -> lib/traduction.js -----------------------------
const {
  CHAMPS_TRADUISIBLES, STATUTS, STATUT_DEFAUT,
  cleChamp, statutValide, analyserTraduction, serialiserTraduction,
  texteChamp, listeChamp, valeurChamp, alignerMotsCles, estATraduire, MARQUE_A_TRADUIRE,
  lignesTraduction, groupesTraduction, resumeTraduction
} = require('./lib/traduction');

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

// ---- Cycle de vie du numéro : verrou, archive, version du logiciel (D116-D117 et D120) ----
//
// La SOURCE DE VÉRITÉ est ausgabe.yaml (lib/yaml.js : etatRevue) — rien n'est
// mémorisé côté poste, un numéro archivé sur OneDrive l'est pour toute l'équipe.
// L'état est relu à chaque rafraîchissement (ausgabe.yaml est déjà surveillé pour le
// titre de la vue, N2) et projeté en TROIS endroits :
//   1. deux clés de contexte (szh.verrouillee / szh.archivee) qui pilotent les
//      boutons de package.json — le bouton « Exporter cet article » de l'arbre ;
//   2. la barre d'état (clic = déverrouiller / désarchiver) et le titre de la vue ;
//   3. les gardes de commandes : tout geste d'ÉCRITURE est refusé sur un numéro
//      verrouillé, et la compilation AUTOMATIQUE est coupée sur un numéro gelé.
//
// Lecture seule de l'ÉDITEUR : `files.readonlyInclude` posé au niveau WORKSPACE, donc
// dans <revue>/.vscode/settings.json. C'est le seul fichier technique qu'on accepte
// dans un dossier de revue (D8), et le compromis est payant : le verrou VOYAGE avec
// le dossier (un numéro archivé s'ouvre en lecture seule sur n'importe quel poste),
// il ne fuit pas sur les autres fenêtres (un réglage utilisateur, lui, verrouillerait
// aussi la revue en cours ouverte à côté), et il survit à update.ps1, qui réécrit
// settings.json au niveau utilisateur. Le fichier est SUPPRIMÉ au déverrouillage, et
// masqué de l'explorateur par files.exclude (vscodium-user/settings.json).
let etatNumero = { verrouillee: false, archivee: false, versionToolkit: '' };
// Dernier état de verrou réellement APPLIQUÉ au dossier (null = jamais vu). Évite de
// réécrire .vscode/settings.json à chaque rafraîchissement de l'arbre.
let verrouApplique = null;
let racineVerrou = null;
// L'avertissement de divergence de version ne se dit qu'UNE FOIS par fenêtre : il
// accompagne une compilation, et une compilation part à chaque Ctrl+S.
let divergenceSignalee = false;

function etatCourant() { return etatNumero; }

// Numéro « gelé » : plus aucune compilation AUTOMATIQUE (clic sur un article, aperçu
// obsolète). Vrai pour un numéro archivé — la demande explicite (D117) — et aussi
// pour un numéro simplement verrouillé : ses sources ne peuvent plus changer, le
// recompiler tout seul ne ferait que réécrire out/ sans raison. L'export à la
// demande, lui, reste toujours possible (« Exporter cet article », « Recompiler
// toute la revue ») : c'est la contrepartie de la suppression de out/ à l'archivage.
function compilationAutoCoupee() {
  return etatNumero.archivee || etatNumero.verrouillee;
}

// Garde d'écriture. Retourne true si l'action est REFUSÉE (l'appelant sort aussitôt).
// Jamais un silence : message + bouton qui mène au déverrouillage.
function refuserSiVerrouille() {
  if (!etatNumero.verrouillee) { return false; }
  const bouton = T('verrou.refuse.bouton');
  vscode.window.showWarningMessage(T('verrou.refuse'), bouton).then((choix) => {
    if (choix === bouton) { vscode.commands.executeCommand('szh.deverrouiller'); }
  });
  return true;
}

// Écrit des clés d'ausgabe.yaml (mêmes sérialiseur et écriture atomique que le
// formulaire de métadonnées : lignes non gérées préservées, commentaires compris).
// Retourne null si tout est écrit, sinon le message d'erreur.
function ecrireClesAusgabe(racine, modifies) {
  const chemin = path.join(racine, 'ausgabe.yaml');
  try {
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
    ecrireAusgabeAtomique(chemin, serialiserAusgabe(contenu, modifies));
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Applique (ou retire) la lecture seule de l'ÉDITEUR pour le dossier de revue.
// `files.readonlyInclude` au scope Workspace = <revue>/.vscode/settings.json ; le
// motif « ** » couvre tout le dossier, y compris out/ (un PDF affiché n'a de toute
// façon rien à se faire éditer). On y coupe aussi `triggerTaskOnSave.tasks` : sans
// ça, un numéro gelé mais dont un fichier serait tout de même enregistré (par une
// extension tierce, un formatage) relancerait `make all`.
// Ne rejette jamais : l'échec est signalé, il ne doit pas laisser l'archivage à
// moitié fait.
async function appliquerVerrou(racine, verrouillee) {
  if (!racine) { return null; }
  try {
    const cfgFichiers = vscode.workspace.getConfiguration('files', vscode.Uri.file(racine));
    const cfgTaches = vscode.workspace.getConfiguration('triggerTaskOnSave', vscode.Uri.file(racine));
    const cible = vscode.ConfigurationTarget.Workspace;
    if (verrouillee) {
      await cfgFichiers.update('readonlyInclude', { '**': true }, cible);
      await cfgTaches.update('tasks', {}, cible);
    } else {
      // Rien à retirer si le fichier n'existe pas : sans ce test, OUVRIR une revue
      // ordinaire créerait un .vscode/settings.json vide dans CHAQUE dossier de revue
      // (update(…, undefined) matérialise le fichier) — l'inverse de D8.
      if (!fs.existsSync(path.join(racine, '.vscode', 'settings.json'))) { return null; }
      await cfgFichiers.update('readonlyInclude', undefined, cible);
      await cfgTaches.update('tasks', undefined, cible);
      // Fichier redevenu vide (« {} ») : on l'efface, le dossier de revue retrouve
      // son état épuré (D8). Un settings.json qui contient autre chose est laissé.
      nettoyerReglagesWorkspace(racine);
    }
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Supprime <revue>/.vscode/settings.json s'il ne reste plus aucune clé (et le
// dossier .vscode s'il devient vide). Silencieux : c'est du rangement.
function nettoyerReglagesWorkspace(racine) {
  const dossier = path.join(racine, '.vscode');
  const fichier = path.join(dossier, 'settings.json');
  try {
    const brut = fs.readFileSync(fichier, 'utf8');
    const valeurs = JSON.parse(brut);
    if (valeurs && typeof valeurs === 'object' && Object.keys(valeurs).length > 0) { return; }
    fs.unlinkSync(fichier);
  } catch (e) { return; }                          // absent, ou JSON avec commentaires : on n'y touche pas
  try { fs.rmdirSync(dossier); } catch (e) { /* pas vide : très bien */ }
}

// Relit l'état du numéro et le projette partout (contextes, barre d'état, verrou du
// dossier). Appelée à chaque rafraîchissement : ausgabe.yaml est déjà surveillé.
function majEtatNumero(fournisseur, barreEtat) {
  const racine = fournisseur.racine;
  etatNumero = racine ? etatRevue(racine)
                      : { verrouillee: false, archivee: false, versionToolkit: '' };
  vscode.commands.executeCommand('setContext', CLE_VERROUILLEE, etatNumero.verrouillee);
  vscode.commands.executeCommand('setContext', CLE_ARCHIVEE, etatNumero.archivee);
  if (barreEtat) { majBarreEtatNumero(barreEtat); }
  // Le verrou du dossier suit l'état du fichier — y compris quand ausgabe.yaml a été
  // édité à la main ou synchronisé par OneDrive depuis un autre poste.
  if (racine && (racineVerrou !== racine || verrouApplique !== etatNumero.verrouillee)) {
    racineVerrou = racine;
    verrouApplique = etatNumero.verrouillee;
    appliquerVerrou(racine, etatNumero.verrouillee).then((erreur) => {
      if (erreur) { vscode.window.showWarningMessage(T('err.verrou.reglages', [erreur])); }
    });
  }
}

// Barre d'état du cycle de vie : visible seulement si le numéro est gelé, et le clic
// mène au geste inverse (déverrouiller, ou désarchiver s'il n'est que archivé).
function majBarreEtatNumero(barre) {
  if (!etatNumero.verrouillee && !etatNumero.archivee) { barre.hide(); return; }
  if (etatNumero.verrouillee && etatNumero.archivee) { barre.text = T('etat.barre.lesdeux'); }
  else if (etatNumero.verrouillee) { barre.text = T('etat.barre.verrouillee'); }
  else { barre.text = T('etat.barre.archivee'); }
  barre.command = etatNumero.verrouillee ? 'szh.deverrouiller' : 'szh.desarchiver';
  const morceaux = [T(etatNumero.verrouillee ? 'etat.barre.tooltip.verrou' : 'etat.barre.tooltip.archive')];
  if (etatNumero.versionToolkit !== '') {
    morceaux.push(T('etat.barre.tooltip.version',
      [etatNumero.versionToolkit, versionInstallee() || '?']));
  }
  barre.tooltip = morceaux.join('\n');
  barre.show();
}

// Titre de la vue : le numéro, suffixé des pictogrammes de son état (D116).
function titreVue(racine) {
  const base = titreNumero(racine);
  if (etatNumero.verrouillee && etatNumero.archivee) { return T('arbre.titre.archiveeVerrouillee', [base]); }
  if (etatNumero.verrouillee) { return T('arbre.titre.verrouillee', [base]); }
  if (etatNumero.archivee) { return T('arbre.titre.archivee', [base]); }
  return base;
}

// Avertissement de divergence de version (D120), au moment de compiler : le rédacteur
// doit savoir que le numéro a été fabriqué par un autre logiciel que celui qui tourne
// — c'est là, et seulement là, que le résultat peut changer. Une fois par fenêtre.
function avertirVersionSiDivergente() {
  if (divergenceSignalee) { return; }
  const poste = versionInstallee();
  if (!versionsDivergent(etatNumero.versionToolkit, poste)) { return; }
  divergenceSignalee = true;
  const bouton = T('version.divergence.bouton');
  vscode.window.showWarningMessage(
    T('version.divergence', [poste, etatNumero.versionToolkit]), bouton
  ).then((choix) => {
    if (choix !== bouton) { return; }
    const erreur = lancerChoixVersion();
    if (erreur) { vscode.window.showErrorMessage(T('err.version.lancement', [erreur])); }
  });
}

// Réglage szh.replierAssetsAutres (D96) : au clic sur un article, ses images et
// tableaux se déplient et ceux des AUTRES articles se replient — une seule liste
// d'assets ouverte à la fois. À false : l'arbre se comporte comme avant (aucun
// dépliage ni repliage automatique). Défaut true.
function replierAssetsAutres() {
  try { return vscode.workspace.getConfiguration('szh').get('replierAssetsAutres', true) !== false; }
  catch (e) { return true; }                       // configuration indisponible : comportement par défaut
}

class FournisseurRevue {
  constructor() {
    this.racine = null;
    // D96 : slug dont les assets sont DÉPLOYÉS (tous les autres sont repliés). null =
    // aucun (état de départ, ou réglage désactivé).
    this.slugDeploye = null;
    this._changement = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changement.event;
  }

  definirRacine(racine) { this.racine = racine; }
  rafraichir() { this._changement.fire(); }

  // Retourne true si l'état a CHANGÉ (l'appelant rafraîchit alors l'arbre) : cliquer
  // deux fois le même article ne doit pas reconstruire la vue pour rien.
  definirDeploye(slug) {
    const cible = replierAssetsAutres() ? (slug || null) : null;
    if (this.slugDeploye === cible) { return false; }
    this.slugDeploye = cible;
    return true;
  }

  getTreeItem(element) { return element; }

  getChildren(element) {
    if (!this.racine) { return []; }
    if (!element) {
      // Compte des Word en attente dans la DESCRIPTION de la section (S4) : le badge
      // de conteneur n'est plus visible depuis que la vue est dans l'Explorateur (S2.1).
      const n = this.compterWord();
      // D113 : la section « Traductions » arrive REPLIÉE — elle double la liste des
      // articles, et on ne l'ouvre que quand on vient y travailler.
      const t = this.compterTraductions();
      return [
        this._section('articles', T('arbre.articles'), 'book', undefined),
        this._section('word', T('arbre.word'), 'inbox', n > 0 ? '(' + n + ')' : undefined),
        this._section('traductions', T('arbre.traductions'), 'globe',
          t.total > 0 ? '(' + t.finalises + '/' + t.total + ')' : undefined, true)
      ];
    }
    if (element.categorie === 'articles') { return this._itemsArticles(); }
    if (element.categorie === 'word') { return this._itemsWord(); }
    if (element.categorie === 'traductions') { return this._itemsTraductions(); }
    if (element.contextValue === 'article') { return this._itemsAssets(element.slug); }
    if (element.contextValue === 'traduction-article') { return this._itemsChampsTraduction(element.slug); }
    return [];
  }

  _section(categorie, libelle, icone, description, replie) {
    const it = new vscode.TreeItem(libelle, replie
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded);
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
    const auto = replierAssetsAutres();
    return slugs.map((slug) => {
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      const aDesAssets = this._imagesArticle(slug).length > 0 || this._tablesArticle(slug).length > 0;
      // D96 : un article SANS asset n'a pas de chevron (None). Avec le repli
      // automatique, l'article visé est Expanded et tous les autres Collapsed.
      const deploye = auto && aDesAssets && slug === this.slugDeploye;
      const it = new vscode.TreeItem(slug, !aDesAssets
        ? vscode.TreeItemCollapsibleState.None
        : (deploye ? vscode.TreeItemCollapsibleState.Expanded
                   : vscode.TreeItemCollapsibleState.Collapsed));
      // ⚠ VS Code MÉMORISE l'état plié/déplié d'un élément qu'il reconnaît et ignore
      // alors le collapsibleState renvoyé : sans identité changeante, le repliage
      // automatique n'aurait aucun effet visible. On fait donc varier l'`id` avec
      // l'état voulu — l'élément est recréé, l'état est réappliqué. Sans le réglage,
      // aucun `id` n'est posé : l'arbre retrouve exactement son comportement d'avant
      // (c'est l'utilisateur qui plie et déplie, VS Code s'en souvient).
      if (auto && aDesAssets) { it.id = 'article:' + slug + ':' + (deploye ? 'ouvert' : 'ferme'); }
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
      it.tooltip = T('arbre.image.tooltip', [chemin]);
      // Le clic ouvre la FICHE de l'image, pas l'aperçu natif : ce qu'on vient faire
      // sur une image, c'est écrire sa légende, son texte alternatif et ses crédits —
      // données qui vivent dans le texte de l'article, pas dans le fichier. L'aperçu
      // natif reste à un clic : le bouton « Ouvrir l'image » de la fiche le rouvre.
      it.command = {
        command: 'szh.ficheImage', title: 'Ouvrir la fiche de l’image',
        arguments: [it]
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
      // Le clic ouvre l'ÉDITEUR de tableau, pas le HTML brut : personne dans l'équipe de
      // rédaction n'a à lire du `<td colspan="2">` pour corriger une cellule. Du coup le
      // bouton « Éditer » du survol n'a plus de raison d'être et a été retiré du menu
      // (la commande szh.editerTable reste, c'est elle que ce clic appelle).
      // Le HTML brut reste accessible à qui le veut : clic droit dans l'Explorateur, ou
      // « Remplacer » pour échanger le fichier entier.
      it.command = {
        command: 'szh.editerTable', title: 'Ouvrir l’éditeur de tableau',
        arguments: [it]
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
      // D93 : le slug d'un article complète le nombre de tête sur deux chiffres
      // (« 4_Titre.docx » -> 04-titre) — même règle que la cible import du Makefile.
      if (this._articleExiste(slugifierArticle(nom))) {
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

  // ---- Section « Traductions » (D113) ---------------------------------------------
  //
  // Un article par ligne, DÉPLIABLE sur ses champs bilingues : le coup d'œil
  // demandé — combien de champs sont traduits, et où en est le plus en retard.
  // « 💬 » signale une question posée à l'équipe de traduction : la laisser
  // invisible dans l'arbre reviendrait à ne jamais y répondre.
  _itemsTraductions() {
    const slugs = this._sousDossiersAvecMd(path.join(this.racine, 'articles'));
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.traductions'))]; }
    const source = langueRevue(this.racine);
    return slugs.map((slug) => {
      const etat = etatTraduction(this.racine, slug, source);
      const rien = etat.lignes.length === 0;
      const it = new vscode.TreeItem(slug, rien
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed);
      it.slug = slug;
      it.contextValue = 'traduction-article';
      it.iconPath = rien ? new vscode.ThemeIcon('dash') : iconeStatut(etat.resume.statut);
      const morceaux = rien
        ? [T('trad.rien.court')]
        : [T('trad.avancement', [etat.resume.remplis, etat.resume.total]),
           etat.resume.melange ? T('trad.statut.melange') : T('trad.statut.' + etat.resume.statut)];
      if (etat.suivi.commentaire !== '') { morceaux.push('💬'); }
      it.description = morceaux.join(' · ');
      it.tooltip = T('trad.article.tooltip', [slug]);
      it.command = { command: 'szh.traduction', title: 'Suivi de traduction', arguments: [{ slug: slug }] };
      return it;
    });
  }

  // Enfants d'un article de la section « Traductions » : une ligne par champ
  // bilingue (« Titre (DE) »), état de remplissage ET statut d'atelier.
  _itemsChampsTraduction(slug) {
    const etat = etatTraduction(this.racine, slug);
    return etat.groupes.map((groupe) => {
      const nom = libelleGroupe(groupe);
      const rempli = etatRemplissageGroupe(groupe);
      const statut = T('trad.statut.' + groupe.statut);
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cleTraduction = groupe.cle;
      it.contextValue = 'traduction-champ';
      it.iconPath = iconeStatut(groupe.statut);
      it.description = rempli + ' · ' + statut;
      it.tooltip = T('trad.champ.tooltip', [nom, rempli, statut]);
      // Le clic ouvre le panneau de l'article ET y met le focus sur CE bloc.
      it.command = {
        command: 'szh.traduction', title: 'Suivi de traduction',
        arguments: [{ slug: slug, cle: groupe.cle }]
      };
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

  // Avancement global affiché dans la description de la section (D113) :
  // champs finalisés / champs bilingues de toute la revue.
  compterTraductions() {
    if (!this.racine) { return { total: 0, finalises: 0 }; }
    const source = langueRevue(this.racine);
    let total = 0, finalises = 0;
    for (const slug of this._sousDossiersAvecMd(path.join(this.racine, 'articles'))) {
      const r = etatTraduction(this.racine, slug, source).resume;
      total += r.total;
      finalises += r.finalises;
    }
    return { total: total, finalises: finalises };
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

// Export OJS (F7) : rebuild complet (PDF+HTML frais), galleys DOCX, puis XML natif
// écrit à la racine de la revue. Les manques bloquants (type, titre, auteurs, produits
// out/) arrivent en une seule erreur listée par lib/export-ojs.js.
async function exporterXml(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('exportOjs.statut'));
  try {
    await fermerOngletsSous(path.join(racine, 'out'));
    apercuCourantUri = null;                       // « Tout exporter » fait clean
    let code = await lancerTache(NOM_TACHE_EXPORT);
    rafraichirTout();
    if (code === null) { return; }                 // tâche introuvable (déjà signalé)
    if (code !== 0) {
      vscode.window.showErrorMessage(T('err.export', [NOM_TACHE_EXPORT]));
      return;
    }
    code = await lancerTache(NOM_TACHE_DOCX);
    if (code === null) { return; }
    if (code !== 0) {
      vscode.window.showErrorMessage(T('exportOjs.erreurDocx'));
      return;
    }
    const resultat = genererExportOjs(racine);     // synchrone : quelques secondes
    const message = T('exportOjs.fini', [path.basename(resultat.chemin)]);
    if (resultat.avertissements.length > 0) {
      const bouton = T('exportOjs.voirAvertissements');
      const choix = await vscode.window.showInformationMessage(
        message + ' — ' + T('exportOjs.nAvertissements', [resultat.avertissements.length]), bouton
      );
      if (choix === bouton) {
        const doc = await vscode.workspace.openTextDocument({
          content: resultat.avertissements.join('\n'), language: 'plaintext'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    } else {
      vscode.window.showInformationMessage(message);
    }
  } catch (e) {
    vscode.window.showErrorMessage(T('exportOjs.erreur', [String((e && e.message) || e)]));
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

// ---- Export d'UN article (D117) -----------------------------------------------------
//
// Sur un numéro gelé, la compilation automatique est coupée : il faut un geste
// explicite pour régénérer un document. C'est la seule tâche que le cockpit CONSTRUIT
// (sa cible dépend du slug ; une tâche de tasks.json a des arguments figés). Cibles
// visées : le PDF et l'aperçu HTML de l'article — exactement ce que produit `make
// pdf` pour un article, sans la passe d'import (un numéro gelé ne doit plus rien
// avaler d'articles-word/, l'import supprimant le .docx source, D39) et sans clean.
function tacheMakeArticle(racine, slug) {
  const cibles = ['out/' + slug + '/' + slug + '.pdf', 'out/' + slug + '/' + slug + '.apercu.html'];
  const execution = new vscode.ProcessExecution('wsl.exe',
    ['-d', DISTRO_WSL, '--cd', racine, '--', 'make', '-f', MAKEFILE_WSL].concat(cibles));
  const tache = new vscode.Task(
    { type: 'szh', cible: 'article', slug: slug }, vscode.TaskScope.Workspace,
    T('tache.exportArticle') + ' — ' + slug, 'SZH', execution, []);
  tache.presentationOptions = {
    reveal: vscode.TaskRevealKind.Silent, showReuseMessage: false,
    clear: true, panel: vscode.TaskPanelKind.Shared
  };
  return tache;
}

// Exécute une tâche DÉJÀ construite et résout avec son code de sortie (pendant de
// lancerTache, qui va chercher une tâche utilisateur par son label).
async function lancerTacheObjet(tache) {
  const execution = await vscode.tasks.executeTask(tache);
  return await new Promise((resolve) => {
    const abo = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { abo.dispose(); resolve(e.exitCode); }
    });
  });
}

// « Exporter cet article » : bouton en survol de l'article (numéro gelé seulement) et
// entrée du panneau d'export. Sans argument, l'article visé est celui du .md actif, à
// défaut celui affiché en aperçu — même cascade que « Métadonnées de l'article
// courant » (D97). L'aperçu est rafraîchi à l'arrivée : c'est le résultat qu'on vient
// voir.
async function exporterArticle(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const slug = cibleTraduction(fournisseur, cible).slug;
  if (!slug || fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.exportArticle', [slug]));
  try {
    const code = await lancerTacheObjet(tacheMakeArticle(racine, slug));
    rafraichirTout();
    if (code !== 0) {
      vscode.window.showErrorMessage(T('err.exportArticle', [slug]));
      return;
    }
    vscode.window.setStatusBarMessage(T('info.exportArticle', [slug]), 4000);
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
  // Le document vient d'être régénéré : on le montre. `ouvrirArticle` ne recompilera
  // pas (numéro gelé) — il se contente d'afficher ce qui est là.
  await ouvrirArticle(fournisseur, slug);
}

// ---- Archiver / verrouiller / désarchiver (D116) -------------------------------------
//
// Trois gestes, une seule règle : ausgabe.yaml est écrit d'abord (source de vérité),
// le reste en découle. Le DÉPLACEMENT du dossier est délégué à
// windows/archive-revue.ps1 : lui seul connaît l'arborescence « en cours »/archives
// (mode développeur compris, D119), et lui seul peut déplacer un dossier que VSCodium
// tient ouvert — il attend la fermeture de cette fenêtre, puis rouvre l'éditeur sur
// la nouvelle place. D'où l'ordre : écrire, nettoyer, lancer le script, fermer.

// Poids lisible d'un dossier out/ pour la confirmation (« 148 Mo ») — la promesse
// « vous pourrez toujours réexporter » ne vaut que si le gain est chiffré.
function poidsLisible(octets) {
  if (octets <= 0) { return T('modale.archiver.rien'); }
  if (octets < 1024 * 1024) { return Math.max(1, Math.round(octets / 1024)) + ' Ko'; }
  const mo = octets / (1024 * 1024);
  return (mo < 10 ? mo.toFixed(1).replace('.', ',') : String(Math.round(mo))) + ' Mo';
}

// Verrouillage SEUL : le dossier ne bouge pas, out/ est conservé. C'est le geste qui
// reste sur un numéro déjà archivé qu'on avait déverrouillé pour une correction.
async function verrouillerSeulement(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  const choix = await vscode.window.showWarningMessage(
    T('modale.verrouiller.question', [titreNumero(racine)]),
    { modal: true, detail: T('modale.verrouiller.detail') },
    T('modale.verrouiller.bouton'));
  if (choix !== T('modale.verrouiller.bouton')) { return; }
  const erreur = ecrireClesAusgabe(racine, { locked: 'true' });
  if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [erreur])); return; }
  rafraichirTout();
  vscode.window.setStatusBarMessage(T('statut.verrouille'), 4000);
}

// « Archiver et verrouiller » — le geste complet.
async function archiverEtVerrouiller(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Déjà archivé : il ne reste qu'à reposer le verrou (rien à déplacer, rien à jeter).
  if (etatNumero.archivee) {
    if (etatNumero.verrouillee) { vscode.window.showInformationMessage(T('info.deja.archivee')); return; }
    await verrouillerSeulement(fournisseur, rafraichirTout);
    return;
  }
  const dossierOut = path.join(racine, 'out');
  const bouton = T('modale.archiver.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.archiver.question', [titreNumero(racine)]),
    { modal: true, detail: T('modale.archiver.detail', [poidsLisible(tailleDossier(dossierOut))]) },
    bouton);
  if (choix !== bouton) { return; }

  // 1. ausgabe.yaml : les deux drapeaux. Rien d'autre pour l'instant — l'étape 2 peut
  //    encore échouer, et on veut pouvoir revenir exactement à l'état de départ.
  const erreurYaml = ecrireClesAusgabe(racine, { locked: 'true', archived: 'true' });
  if (erreurYaml) { vscode.window.showErrorMessage(T('err.ecriture', [erreurYaml])); return; }

  // 2. les documents produits : onglets fermés (un PDF affiché est verrouillé côté
  //    Windows, R6) puis out/ supprimé. Échec -> on s'arrête AVANT tout déplacement,
  //    et on relève les drapeaux : mieux vaut un numéro inchangé qu'à moitié archivé.
  await fermerTousLesApercus();
  await fermerOngletsSous(dossierOut);
  apercuCourantUri = null;
  apercuCourantSlug = null;
  const erreurOut = supprimerDossier(dossierOut);
  if (erreurOut) {
    ecrireClesAusgabe(racine, { locked: 'false', archived: 'false' });
    rafraichirTout();
    vscode.window.showErrorMessage(T('err.out.suppression', [erreurOut]));
    return;
  }

  // 3. la version du logiciel, si le numéro n'en portait pas encore : un numéro archivé
  //    doit toujours dire avec quoi il a été fabriqué (D120). Écrite APRÈS le point de
  //    non-retour, pour qu'un archivage annulé ne laisse pas d'estampille inventée. Un
  //    numéro qui porte déjà une version n'est jamais réécrit.
  const poste = versionInstallee();
  if (etatNumero.versionToolkit === '' && poste !== '') {
    ecrireClesAusgabe(racine, { 'version-toolkit': poste });
  }

  // 4. la lecture seule, écrite DANS le dossier : elle part avec lui.
  const erreurVerrou = await appliquerVerrou(racine, true);
  if (erreurVerrou) { vscode.window.showWarningMessage(T('err.verrou.reglages', [erreurVerrou])); }
  verrouApplique = true;
  racineVerrou = racine;
  rafraichirTout();

  // 5. le déplacement, puis la fermeture de cette fenêtre (condition du déplacement).
  const erreurScript = lancerArchivage('archiver', racine);
  if (erreurScript) {
    vscode.window.showErrorMessage(T('err.archivage', [erreurScript]));
    return;                                        // le numéro reste gelé, à sa place
  }
  vscode.window.setStatusBarMessage(T('statut.archivage'), 10000);
  await fermerFenetreApresArchivage();
}

// « Désarchiver » : retour dans l'arborescence « en cours ». Le verrou n'est PAS levé
// (deux gestes distincts, demandés séparément) : le numéro rouvert reste en lecture
// seule jusqu'à « Déverrouiller la revue ».
async function desarchiver(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (!etatNumero.archivee) { vscode.window.showInformationMessage(T('info.deja.encours')); return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const bouton = T('modale.desarchiver.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.desarchiver.question', [titreNumero(racine)]),
    { modal: true, detail: T('modale.desarchiver.detail') }, bouton);
  if (choix !== bouton) { return; }
  const erreurYaml = ecrireClesAusgabe(racine, { archived: 'false' });
  if (erreurYaml) { vscode.window.showErrorMessage(T('err.ecriture', [erreurYaml])); return; }
  await fermerTousLesApercus();
  apercuCourantUri = null;
  apercuCourantSlug = null;
  rafraichirTout();
  const erreurScript = lancerArchivage('desarchiver', racine);
  if (erreurScript) { vscode.window.showErrorMessage(T('err.desarchivage', [erreurScript])); return; }
  vscode.window.setStatusBarMessage(T('statut.desarchivage'), 10000);
  await fermerFenetreApresArchivage();
}

// Laisse au script détaché le temps de démarrer, puis ferme la fenêtre : tant qu'elle
// est ouverte, Windows refuse de déplacer le dossier. Le script, lui, retente jusqu'à
// ce que la main soit rendue, puis rouvre l'éditeur au bon endroit.
async function fermerFenetreApresArchivage() {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await vscode.commands.executeCommand('workbench.action.closeWindow');
}

// « Déverrouiller la revue » : le seul geste qui rend un numéro modifiable. Rien ne
// bouge sur le disque à part le drapeau et le .vscode/settings.json de lecture seule.
async function deverrouiller(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (!etatNumero.verrouillee) {
    vscode.window.showInformationMessage(T('info.deja.deverrouillee'));
    return;
  }
  const bouton = T('modale.deverrouiller.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.deverrouiller.question', [titreNumero(racine)]),
    { modal: true, detail: T('modale.deverrouiller.detail') }, bouton);
  if (choix !== bouton) { return; }
  const erreur = ecrireClesAusgabe(racine, { locked: 'false' });
  if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [erreur])); return; }
  const erreurVerrou = await appliquerVerrou(racine, false);
  if (erreurVerrou) { vscode.window.showWarningMessage(T('err.verrou.reglages', [erreurVerrou])); }
  verrouApplique = false;
  racineVerrou = racine;
  rafraichirTout();
  vscode.window.setStatusBarMessage(T('statut.deverrouille'), 5000);
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

// F5 — édition pleine page : ferme TOUT ce qui occupe la colonne 2 avant d'ouvrir
// un formulaire ou l'éditeur de tableau. La webview HTML et l'onglet PDF suivi ne
// suffisent pas : szh-apercu ouvre des onglets pdf.preview que le cockpit ne suit
// pas (apercuCourantUri) — on balaie donc tabGroups sur le viewType.
async function fermerTousLesApercus() {
  fermerApercuHtml();
  await fermerApercuCourant(null);
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.viewType === VUE_PDF) { aFermer.push(onglet); }
    }
  }
  if (aFermer.length > 0) {
    try { await vscode.window.tabGroups.close(aFermer); } catch (e) { /* déjà fermé */ }
  }
  apercuCourantUri = null;
}

// Les seuls textes que le cockpit pose lui-même dans le HTML de l'aperçu sont des
// libellés traduits (jamais de donnée de revue) — on les échappe quand même :
// une apostrophe typographique ou un « & » dans une traduction ne doit pas
// pouvoir casser la page.
function echapperTexte(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Ouvre (ou recharge) l'aperçu HTML de l'article en colonne 2 (webview réutilisée).
// Repli si le toolkit n'est pas resynchronisé : le .html du PDF (sans clic),
// sinon un message « pas encore compilé ».
function ouvrirApercuHtml(fournisseur, slug, enAttente) {
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
    // C2 : au message « pas encore compilé » s'ajoute l'attente quand une
    // compilation vient d'être lancée (ou tourne déjà) — sinon l'utilisateur ne
    // sait pas qu'il suffit de patienter. Les libellés sont échappés : ce sont
    // des traductions, pas du HTML.
    const lignes = [echapperTexte(T('apercu.indisponible'))];
    if (enAttente) { lignes.push(echapperTexte(T('apercu.encours'))); }
    // D117 : numéro gelé — rien ne se compilera tout seul, on dit par quel geste.
    else if (compilationAutoCoupee()) { lignes.push(echapperTexte(T('apercu.gele'))); }
    contenu = '<!DOCTYPE html><html lang="fr"><head></head><body><p>'
            + lignes.join('</p><p>') + '</p></body></html>';
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

// 1. .md en colonne 1 ; 2. build si l'aperçu du mode courant est absent/obsolète
// (mtime), incrémental ; 3. fermer l'aperçu de l'article précédent ; 4. aperçu en
// colonne 2.
// En cas d'échec de build : le .md reste ouvert, erreur sobre, PAS d'aperçu
// obsolète trompeur.
// `opts.sansTexte` (D113) : ne pas ouvrir le .md en colonne 1 — le panneau de
// traduction l'occupe, seul l'aperçu de la colonne 2 est demandé.
async function ouvrirArticle(fournisseur, slug, opts) {
  const racine = fournisseur.racine;
  if (!racine || typeof slug !== 'string' || slug === '') { return; }
  // D96 : les assets de CET article se déplient, ceux des autres se replient. Fait
  // AVANT le reste (ouverture du .md, compilation) : l'arbre suit le clic tout de
  // suite, sans attendre la fin d'un build.
  if (fournisseur.definirDeploye(slug)) { fournisseur.rafraichir(); }
  const md = path.join(racine, 'articles', slug, slug + '.md');
  const pdf = vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf'));
  const modeCourant = modeApercu();
  // C2 : la fraîcheur se juge sur l'aperçu DU MODE COURANT. Un PDF à jour ne dit
  // rien de l'existence du HTML d'aperçu (out/ partiellement effacé, article
  // compilé par un toolkit plus ancien) — on compilait alors sans jamais montrer
  // autre chose que « pas encore compilé ».
  const apercuAttendu = modeCourant === 'html'
    ? path.join(racine, 'out', slug, slug + '.apercu.html')
    : pdf.fsPath;

  if (!(opts && opts.sansTexte)) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md), { viewColumn: vscode.ViewColumn.One });
  }

  // Obsolète = aperçu plus ancien que la source la plus récente (.md, un tableau
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
    obsolete = fs.statSync(apercuAttendu).mtimeMs < mSource;
  } catch (e) { obsolete = true; }                 // aperçu (ou .md) illisible -> on compile

  // D117 : numéro gelé -> on n'enclenche JAMAIS de compilation en cliquant un
  // article. On montre ce qui existe (les documents d'un numéro archivé ont été
  // supprimés : le volet affiche alors son message, qui renvoie vers « Exporter cet
  // article »). Le geste explicite reste toujours disponible.
  if (compilationAutoCoupee()) { obsolete = false; }

  if (obsolete && buildEnCours) {
    // C2 : une compilation tourne déjà (import, Ctrl+S, autre article). Ne plus
    // abandonner en silence : on affiche l'aperçu avec le message d'attente, que
    // le rafraîchissement de out/** remplacera par le rendu dès la fin.
    vscode.window.setStatusBarMessage(T('statut.build.encours') + ' ' + T('apercu.encours'), 5000);
    if (modeCourant === 'html') {
      if (apercuCourantUri) { await fermerApercuCourant(null); }
      ouvrirApercuHtml(fournisseur, slug, true);
    }
    return;
  }
  if (obsolete) {
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
  if (modeCourant === 'html') {
    if (apercuCourantUri) { await fermerApercuCourant(null); }  // onglet PDF d'une bascule passée
    const pret = fs.existsSync(apercuAttendu);
    ouvrirApercuHtml(fournisseur, slug, !pret && !compilationAutoCoupee());
    if (!pret && !compilationAutoCoupee()) { relancerCompilation(fournisseur, slug); }   // C2
    return;
  }
  fermerApercuHtml();                              // webview HTML d'une bascule passée
  if (!fs.existsSync(pdf.fsPath)) {
    // D117 : sur un numéro gelé, on ne promet pas une compilation qui ne viendra
    // pas — le message dit quoi faire (« Exporter cet article »).
    const gele = compilationAutoCoupee();
    vscode.window.showErrorMessage(T('err.pdf.introuvable', [slug]) + ' '
      + T(gele ? 'apercu.gele' : 'apercu.encours'));
    apercuCourantSlug = slug;                      // l'article visé en colonne 2
    if (!gele) { relancerCompilation(fournisseur, slug); }       // C2 : relance, puis affiche
    return;
  }
  await fermerApercuCourant(pdf);                  // l'aperçu du précédent article
  await ouvrirApercuPdf(pdf);                      // mono-instance : révèle si déjà là
  apercuCourantUri = pdf;
  apercuCourantSlug = slug;
}

// Lance compilerPuisAfficher SANS attendre (le clic sur l'article a déjà rendu la
// main : le texte est ouvert, le message d'attente est affiché). Une erreur
// inattendue ne doit pas remonter en rejet non capturé de l'hôte d'extensions.
function relancerCompilation(fournisseur, slug) {
  compilerPuisAfficher(fournisseur, slug).catch(() => { /* signalé côté build */ });
}

// C2 : l'aperçu manque encore (article jamais compilé, out/ effacé, compilation
// précédente en échec). On relance UNE passe en tâche de fond — jamais de boucle
// si la compilation ne produit toujours rien — et on remplace le message d'attente
// par le rendu dès qu'elle aboutit, à condition que l'utilisateur soit resté sur
// le même article.
async function compilerPuisAfficher(fournisseur, slug) {
  if (buildEnCours || importEnCours) { return; }
  if (compilationAutoCoupee()) { return; }         // D117 : jamais de build implicite

  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
  let code = null;
  try {
    code = await lancerBuild();
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
  if (code === null) { return; }                   // tâche introuvable (déjà signalé)
  if (code !== 0) { vscode.window.showErrorMessage(T('err.build', [NOM_TACHE_BUILD])); return; }
  if (apercuCourantSlug !== slug || !fournisseur.racine) { return; }   // article changé entre-temps
  if (modeApercu() === 'html') {
    if (panneauApercuHtml) { ouvrirApercuHtml(fournisseur, slug); }
    return;
  }
  const pdf = vscode.Uri.file(path.join(fournisseur.racine, 'out', slug, slug + '.pdf'));
  if (!fs.existsSync(pdf.fsPath)) { return; }
  await fermerApercuCourant(pdf);
  await ouvrirApercuPdf(pdf);
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

// C1 : compilation qui suit immédiatement une conversion réussie. Appelée DEPUIS
// lancerConversion, donc pendant que importEnCours est posé — d'où le drapeau de
// build géré ici et non la garde de compilerPuisAfficher. Un échec est signalé
// mais n'annule pas l'import : les articles sont là, seul l'aperçu manquera.
async function compilerApresImport() {
  if (buildEnCours) { return; }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.build.import'));
  try {
    const code = await lancerBuild();
    if (code !== null && code !== 0) { vscode.window.showErrorMessage(T('err.build', [NOM_TACHE_BUILD])); }
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
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
    const nouveaux = [];
    for (const slug of fournisseur.listerArticles()) { if (!avant.has(slug)) { nouveaux.push(slug); } }
    if (nouveaux.length > 0) {
      // C1 : compiler TOUT DE SUITE (PDF + HTML + aperçu HTML) pour que le premier
      // clic sur un article importé montre son aperçu sans attente. Avant le
      // dialogue, pas pendant : « Remplacer » y refuse d'agir tant qu'un build
      // tourne (garde statut.occupe), et deux écritures concurrentes dans out/
      // n'auraient rien à s'apporter.
      await compilerApresImport();
      rafraichirTout();
      // F6 : le dialogue « Vérification de l'import » remplace la notification
      // « N importés » — c'est lui qui montre ce que la conversion a détecté
      // (fiche .meta.yaml pré-remplie) et ce qui reste à compléter.
      await ouvrirImportVerif(fournisseur, rafraichirTout, nouveaux);
    } else {
      vscode.window.showInformationMessage(T('info.importes.aucun'));
    }
  } finally {
    statut.dispose();
    importEnCours = false;
  }
}

// Tronc commun du bouton « Importer des Word » et du glisser-déposer sur la vue
// (F2) : copie des .docx (`uris`, tableau de vscode.Uri déjà filtré) vers
// articles-word/, conflits demandés en modale, puis conversion.
async function importerFichiersWord(fournisseur, rafraichirTout, uris) {
  const racine = fournisseur.racine;
  if (!racine || !Array.isArray(uris) || uris.length === 0) { return; }
  const choix = uris;

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

async function importerWord(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  const filtresImport = {};
  filtresImport[T('dial.importer.filtre')] = ['docx'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: filtresImport,
    openLabel: T('dial.importer.bouton'),
    title: T('dial.importer.titre')
  });
  if (!choix || choix.length === 0) { return; }   // dialogue annulé
  await importerFichiersWord(fournisseur, rafraichirTout, choix);
}

// F2 — dépôt de fichiers sur la vue « Revue SZH » : accepte les .docx de
// l'Explorateur Windows (ou de l'arborescence de l'éditeur) déposés N'IMPORTE OÙ
// dans la vue, et les passe au même circuit que le bouton « Importer des Word »
// (conflits en modale + conversion). `text/uri-list` : une URI par ligne (CRLF),
// lignes vides et commentaires « # » ignorés (RFC 2483). Pas de handleDrag : on
// ne tire rien HORS de la vue. Des fichiers déposés mais aucun .docx -> message
// d'information (jamais silencieux) ; dépôt sans fichier (texte…) -> ignoré.
function controleurDepotVue(fournisseur, rafraichirTout) {
  return {
    dropMimeTypes: ['text/uri-list'],
    dragMimeTypes: [],
    handleDrop: async (cible, dataTransfer) => {
      if (refuserSiVerrouille()) { return; }       // D116 : le dépôt écrit, comme le bouton
      const item = dataTransfer.get('text/uri-list');
      if (!item) { return; }
      const brut = await item.asString();
      const docx = [];
      let fichiers = 0;
      for (const ligne of String(brut || '').split(/\r?\n/)) {
        const nette = ligne.trim();
        if (nette === '' || nette.charAt(0) === '#') { continue; }
        let uri = null;
        try { uri = vscode.Uri.parse(nette); } catch (e) { continue; }
        if (!uri || uri.scheme !== 'file') { continue; }
        fichiers++;
        if (/\.docx$/i.test(uri.fsPath)) { docx.push(uri); }
      }
      if (docx.length > 0) { await importerFichiersWord(fournisseur, rafraichirTout, docx); return; }
      if (fichiers > 0) { vscode.window.showInformationMessage(T('drop.seulement.docx')); }
    }
  };
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

// C3 — Supprimer une image ou un tableau, RÉFÉRENCE COMPRISE. Effacer le seul
// fichier laisserait un lien mort dans le .md : image cassée au rendu, ou bloc
// d'avertissement pour un tableau (szh-tabelle-inclure.lua). Le texte est modifié
// par un WorkspaceEdit (et non par un fs.writeFileSync) : l'article est souvent
// ouvert à l'écran, l'édition doit passer par le tampon de l'éditeur pour rester
// annulable (Ctrl+Z) et ne pas écraser des frappes non enregistrées.
async function supprimerAsset(fournisseur, rafraichirTout, item, estTable) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.cheminAsset || !item.slug) { return; }
  // Comme « Remplacer » : pas de suppression pendant que make lit le dossier.
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const slug = item.slug;
  const cible = item.cheminAsset;
  const nom = path.basename(cible);
  // Nom relatif à media/ pour une image (l'arbre affiche « sous/img.png »),
  // nom simple pour un tableau.
  const relatif = estTable
    ? nom
    : path.relative(path.join(racine, 'articles', slug, 'media'), cible).replace(/\\/g, '/');

  const reponse = await vscode.window.showWarningMessage(
    T(estTable ? 'modale.supprimerTable.question' : 'modale.supprimerAsset.question', [nom]),
    { modal: true, detail: T(estTable ? 'modale.supprimerTable.detail' : 'modale.supprimerAsset.detail', [slug]) },
    T('modale.supprimer.bouton')
  );
  if (reponse !== T('modale.supprimer.bouton')) { return; }   // annulé : rien n'est touché

  // Ordre voulu : 1) retirer la référence DANS LE TAMPON (rien sur le disque),
  // 2) effacer le fichier, 3) enregistrer le .md. L'enregistrement déclenche la
  // compilation à la sauvegarde : il doit arriver EN DERNIER, quand le fichier a
  // disparu et que le texte ne le cite plus — sinon pandoc lit un média qu'on est
  // en train de supprimer. Si une étape échoue avant l'enregistrement, rien n'est
  // écrit et le tampon reste annulable (Ctrl+Z).
  let retirees = 0;
  let doc = null;
  const md = path.join(racine, 'articles', slug, slug + '.md');
  try {
    doc = await vscode.workspace.openTextDocument(md);
    const resultat = estTable
      ? retirerTable(doc.getText(), relatif)
      : retirerImage(doc.getText(), relatif);
    if (resultat.n > 0) {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), resultat.texte);
      if (await vscode.workspace.applyEdit(edition)) { retirees = resultat.n; }
    }
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    return;
  }

  try {
    // L'éditeur (tableau) ou la fiche (image) ouvert sur ce fichier n'a plus d'objet :
    // le laisser à l'écran ferait réécrire un asset qui vient d'être supprimé.
    const ouvert = estTable ? panneauxTable.get(cible) : panneauxFicheImage.get(cible);
    if (ouvert) { try { ouvert.dispose(); } catch (e) { /* déjà fermé */ } }
    await fermerOngletDuFichier(cible);
    fs.rmSync(cible, { force: true });
  } catch (e) {
    vscode.window.showErrorMessage(T('err.suppression', [nom, e.message]));
    rafraichirTout();
    return;                                        // .md non enregistré : état cohérent
  }
  if (retirees > 0 && doc) {
    try { await doc.save(); }                      // déclenche la recompilation (Ctrl+S)
    catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [e.message])); }
  }
  vscode.window.setStatusBarMessage(
    retirees > 0
      ? T(estTable ? 'statut.table.supprimee' : 'statut.asset.supprime', [nom, retirees])
      : T(estTable ? 'statut.table.supprimee.sansref' : 'statut.asset.supprime.sansref', [nom]),
    5000
  );
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

// Même chose pour UN fichier (C3) : l'aperçu d'image ouvert en colonne 1 doit
// disparaître avec le fichier, sinon l'onglet reste en « fantôme ».
async function fermerOngletDuFichier(chemin) {
  const vise = String(chemin).toLowerCase();
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      const entree = onglet.input;
      if (entree && entree.uri && entree.uri.fsPath && entree.uri.fsPath.toLowerCase() === vise) {
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
  // entete-condensee (D114) : la case à cocher reçoit un booléen DÉJÀ tranché, pour
  // que la liste des valeurs vraies tolérées ne vive qu'à un seul endroit (lib/yaml.js).
  valeurs['entete-condensee'] = estVraiYaml(valeurs['entete-condensee']) ? 'true' : 'false';
  panneau.webview.postMessage({ type: 'valeurs', valeurs: valeurs });
}

// Panneau singleton : rouvrir la commande RÉVÈLE le formulaire existant (valeurs
// relues du disque) au lieu d'en empiler un deuxième. Colonne 1 = côté texte.
// `rafraichirTout` (N2) : le titre de la vue suit immédiatement l'enregistrement.
// F5 — pleine page : les aperçus sont fermés AVANT d'afficher (reveal compris),
// le formulaire n'a pas de colonne 2 qui lui réponde.
async function ouvrirMetadonnees(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  await fermerTousLesApercus();
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
    // entete-condensee (D114) : la case à cocher n'envoie que « true » ou « false » ;
    // toute autre valeur est ignorée (jamais écrite dans ausgabe.yaml).
    if ('entete-condensee' in modifies) {
      const e = modifies['entete-condensee'].toLowerCase();
      if (e !== 'true' && e !== 'false') { delete modifies['entete-condensee']; }
      else { modifies['entete-condensee'] = e; }
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
// Libellés communs au gabarit de carte d'article (type, champs par langue,
// auteurs, modale photo F3) — partagés entre « Métadonnées des articles » et le
// dialogue « Vérification de l'import » (F6), qui reprend le même gabarit.
function textesCarteArticle() {
  return {
    type: T('fiches.type'), typeAucun: T('fiches.type.aucun'),
    titreChamp: T('fiches.titre.champ'), sousTitre: T('fiches.soustitre'),
    resume: T('fiches.resume'),
    auteurs: T('fiches.auteurs'), ajouterAuteur: T('fiches.auteur.ajouter'),
    retirerAuteur: T('fiches.auteur.retirer'),
    aPrenom: T('fiches.auteur.prenom'), aNom: T('fiches.auteur.nom'),
    aFonction: T('fiches.auteur.fonction'), aAffiliation: T('fiches.auteur.affiliation'),
    aOrcid: T('fiches.auteur.orcid'), aEmail: T('fiches.auteur.email'),
    motsCles: T('fiches.motscles'), italien: T('fiches.italien'),
    // Grille de mots-clés appariés (D122) — fragment partagé SZH.motsCles.
    motsClesTitre: T('fiches.motscles.titre'), motsClesAide: T('fiches.motscles.aide'),
    motCleAjouter: T('fiches.motcle.ajouter'), motCleRetirer: T('fiches.motcle.retirer'),
    rien: T('form.rien'), enregistre: T('fiches.enregistre'),
    // Photo d'auteur·e (F3, D92) : bouton par rangée + modale de dépôt/choix.
    photoBouton: T('photo.bouton'), photoPresente: T('photo.bouton.presente'),
    photoNomRequis: T('photo.nomrequis'), photoTitre: T('photo.titre'),
    photoDeposer: T('photo.deposer'), photoOu: T('photo.ou'),
    photoChoisirFichier: T('photo.choisirFichier'),
    vOriginal: T('photo.version.original'), vAvecFond: T('photo.version.avecfond'),
    vSansFond: T('photo.version.sansfond'),
    valider: T('photo.valider'), annuler: T('photo.annuler'),
    chargement: T('photo.chargement'), traitement: T('photo.traitement'),
    sansVisage: T('photo.sansvisage'), padding: T('photo.padding'),
    errTropVolumineux: T('photo.err.tropvolumineux'), errFormat: T('photo.err.format')
  };
}

// Options traduites du menu « Type d'article » (E2, D71) : 6 types en 2 groupes,
// libellés + en-têtes de groupe dans la langue par défaut du numéro. Partagé
// par les deux panneaux de fiches (métadonnées des articles, vérification F6).
function typesTraduits(langue) {
  const options = (liste, groupe) => liste.map((t) => ({
    valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t,
    groupe: (GROUPES_TYPES[groupe] || {})[langue] || (GROUPES_TYPES[groupe] || {}).fr || ''
  }));
  return options(TYPES_DOSSIER, 'dossier').concat(options(TYPES_HORS, 'hors'));
}

// Écrit les cartes reçues d'un webview de fiches : nettoyage (types/bornes, 20
// auteurs max), clés inconnues de la fiche existante restituées (D49), écriture
// atomique. `slugsAutorises` (F6) restreint en plus à la liste du panneau ;
// dans tous les cas un slug hors de listerArticles() est ignoré (sécurité).
function ecrireCartesArticles(fournisseur, cartes, slugsAutorises) {
  const connus = new Set(fournisseur.listerArticles());
  let n = 0;
  const erreurs = [];
  for (const slug of Object.keys(cartes || {})) {
    if (!connus.has(slug)) { continue; }           // slug inconnu : ignoré (sécurité)
    if (slugsAutorises && slugsAutorises.indexOf(slug) === -1) { continue; }
    const fichierMeta = cheminMeta(fournisseur.racine, slug);
    try {
      // Fichier « form-owned » : régénéré — mais les clés inconnues de haut
      // niveau de la fiche existante sont restituées par prudence (D49).
      const carte = nettoyerCarte(cartes[slug]);
      try { carte._inconnues = analyserMeta(fs.readFileSync(fichierMeta, 'utf8'))._inconnues; }
      catch (e) { /* pas de fiche existante */ }
      ecrireAusgabeAtomique(fichierMeta, serialiserMeta(carte));
      n++;
    } catch (e) {
      erreurs.push(slug + ' (' + e.message + ')');
    }
  }
  return { n: n, erreurs: erreurs };
}

function htmlApercuMetadonnees(nonce) {
  // + le bandeau de la vue filtrée (D97), propre à ce formulaire (le dialogue
  // d'import, lui, a toujours sa propre liste d'articles).
  const txt = JSON.stringify(Object.assign(textesCarteArticle(), {
    filtreNote: T('fiches.filtre.note'), tous: T('fiches.tous')
  }));
  return construireHtml('metadata-articles', nonce, {
    titre: T('fiches.titre'),
    remplacements: { '__TXT__': txt },
    // Seule dérogation du cockpit à la CSP par défaut : les aperçus de la modale
    // photo sont des <img> à data: URI poussées par postMessage (aucun réseau,
    // localResourceRoots reste []).
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
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

// `filtre` (D97) : tableau de slugs à afficher, ou null pour tous. L'ordre reste
// celui de l'arbre (listerArticles) — jamais celui du filtre.
function lireMetadonneesArticles(fournisseur, filtre) {
  const articles = [];
  for (const slug of fournisseur.listerArticles()) {
    if (filtre && filtre.indexOf(slug) === -1) { continue; }
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

// Assainit le champ `photo` d'un auteur (D92) : il n'est JAMAIS saisi au clavier
// (posé par la modale photo uniquement), donc on n'accepte qu'un chemin RELATIF
// à l'article, sous portraits/, sans remontée « .. » ni antislash ni jeton vide —
// toute autre valeur VIDE le champ (il disparaît de la fiche à la sérialisation).
function assainirCheminPhoto(valeur) {
  const c = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (c === '' || c.length > 300) { return ''; }
  if (c.indexOf('\\') !== -1 || /[\r\n:]/.test(c)) { return ''; }
  // Exactement DEUX segments (les trois formes D92 sont « portraits/<fichier> ») :
  // ni remontée, ni sous-dossier, ni segment vide.
  const morceaux = c.split('/');
  if (morceaux.length !== 2 || morceaux[0] !== 'portraits') { return ''; }
  const nom = morceaux[1];
  if (nom === '' || nom === '.' || nom === '..') { return ''; }
  return c;
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
  // Mots-clés (D122) : les listes de langues sont APPARIÉES PAR POSITION — c'est le
  // seul lien entre « diagnostic » et « Diagnose ». On borne d'abord (50 mots, 100
  // caractères) sans retirer les vides, puis alignerMotsCles tient chaque case vide
  // avec la marque TO BE TRANSLATED : retirer un vide au milieu ferait remonter tous
  // les mots-clés suivants d'un cran, et la paire deviendrait fausse en silence.
  const km = (brut && brut.keywords) || {};
  const brutes = {};
  let nMax = 0;
  for (const l of LANGUES_META) {
    if (!Array.isArray(km[l])) { continue; }
    brutes[l] = km[l].slice(0, 50).map((k) => texteCourt(k, 100));
    if (brutes[l].length > nMax) { nMax = brutes[l].length; }
  }
  for (const l of Object.keys(brutes)) {
    const liste = alignerMotsCles(brutes[l], nMax);
    if (liste.length > 0) { carte.keywords[l] = liste; }
  }
  if (brut && Array.isArray(brut.author)) {
    for (const a of brut.author.slice(0, 20)) {
      const propre = {};
      // Bornes par champ (D91/D92) : email 200, le reste 300 ; photo assainie
      // en plus (chemin relatif portraits/… uniquement, sinon vidée).
      for (const c of CHAMPS_AUTEUR) { propre[c] = texteCourt(a && a[c], c === 'email' ? 200 : 300); }
      propre.photo = assainirCheminPhoto(propre.photo);
      carte.author.push(propre);
    }
  }
  return carte;
}

// ---- Suivi de traduction (D113) ----------------------------------------------------
//
// Section « Traductions » de l'arbre + panneau szhTraduction (colonne 1, aperçu de
// l'article en colonne 2). Deux fichiers, deux rôles — voir l'en-tête de
// lib/traduction.js : les TEXTES traduits vont dans <slug>.meta.yaml (publiés,
// exportés vers OJS), l'ÉTAT D'ATELIER dans <slug>.traduction.yaml (jamais publié).
// Protocole :
//   webview -> hôte : pret | modifie {modifie} | copier {texte}
//                     enregistrer {slug, champs:[{champ,langue,texte,statut}], commentaire}
//                     rechargement {…}  (réponse à « demande-rechargement »)
//   hôte -> webview : valeurs {slug, langueSource, lignes, commentaire, statuts, focus}
//                     enregistre | copie | erreur {message} | demande-rechargement

const ICONES_STATUT = {
  'pas-pret': 'circle-large-outline',
  'pret-traduction': 'arrow-right',
  'pret-relecture': 'eye',
  'finalise': 'pass-filled'
};
const COULEURS_STATUT = {
  'pret-traduction': 'charts.blue',
  'pret-relecture': 'charts.orange',
  'finalise': 'charts.green'
};

function iconeStatut(statut) {
  const couleur = COULEURS_STATUT[statut];
  return new vscode.ThemeIcon(ICONES_STATUT[statut] || ICONES_STATUT[STATUT_DEFAUT],
    couleur ? new vscode.ThemeColor(couleur) : undefined);
}

function cheminTraduction(racine, slug) {
  return path.join(racine, 'articles', slug, slug + '.traduction.yaml');
}

function lireMetaArticle(racine, slug) {
  try { return analyserMeta(fs.readFileSync(cheminMeta(racine, slug), 'utf8')); }
  catch (e) { return analyserMeta(''); }           // pas encore de fiche : tout vide
}

function lireSuiviTraduction(racine, slug) {
  try { return analyserTraduction(fs.readFileSync(cheminTraduction(racine, slug), 'utf8')); }
  catch (e) { return analyserTraduction(''); }
}

// État complet d'un article pour l'arbre ET le panneau. `source` (langue du numéro)
// est passée par les boucles pour ne pas relire ausgabe.yaml à chaque article.
function etatTraduction(racine, slug, source) {
  const langue = source || langueRevue(racine);
  const meta = lireMetaArticle(racine, slug);
  const suivi = lireSuiviTraduction(racine, slug);
  const lignes = lignesTraduction(meta, suivi.statuts, langue);
  const groupes = groupesTraduction(lignes);
  return {
    meta: meta, suivi: suivi, lignes: lignes, groupes: groupes,
    source: langue, resume: resumeTraduction(groupes)
  };
}

// Libellé d'un groupe dans l'arbre et sur la carte : « Titre et sous-titre (DE) »
// quand les deux existent, « Titre (DE) » quand l'article n'a pas de sous-titre.
function libelleGroupe(groupe) {
  let nom;
  if (groupe.groupe === 'titre') {
    nom = groupe.champs.length > 1
      ? T('trad.champ.titre.duo')
      : T('trad.champ.' + groupe.champs[0]);
  } else {
    nom = T('trad.champ.' + groupe.champs[0]);
  }
  return T('trad.champ.libelle', [nom, groupe.langue.toUpperCase()]);
}

// « traduit » / « à traduire », sauf pour les mots-clés où le compte des PAIRES dit
// bien plus : « 2/4 traduits » se lit d'un coup d'œil.
function etatRemplissageGroupe(groupe) {
  if (groupe.groupe === 'motscles') {
    const l = groupe.lignes[0];
    return T('trad.avancement', [l.remplies, l.total]);
  }
  return groupe.rempli ? T('trad.traduit') : T('trad.atraduire');
}

// Écrit le sidecar — ou le SUPPRIME s'il ne reste rien à retenir (aucun statut hors
// défaut, aucun commentaire) : pas de fichier vide dans le dossier de l'article, et
// « tout remettre à zéro » efface vraiment. Fichier form-owned : ce panneau est le
// seul à l'écrire, la suppression ne peut donc rien perdre d'autre.
function ecrireSuiviTraduction(racine, slug, suivi) {
  const chemin = cheminTraduction(racine, slug);
  const contenu = serialiserTraduction(suivi);
  if (contenu === '') {
    try { if (fs.existsSync(chemin)) { fs.unlinkSync(chemin); } } catch (e) { /* déjà parti */ }
    return;
  }
  ecrireAusgabeAtomique(chemin, contenu);
}

// Bouton de la section « Traductions » : lance la campagne. N'avance QUE les champs
// encore « pas prêt » — un champ déjà en relecture ou finalisé ne recule jamais,
// sinon le bouton détruirait le travail qu'il est censé organiser.
function marquerToutPretTraduction(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  const racine = fournisseur.racine;
  const source = langueRevue(racine);
  const erreurs = [];
  let n = 0;
  for (const slug of fournisseur.listerArticles()) {
    const etat = etatTraduction(racine, slug, source);
    const statuts = Object.assign({}, etat.suivi.statuts);
    let change = false;
    for (const ligne of etat.lignes) {
      if (ligne.statut !== STATUT_DEFAUT) { continue; }
      statuts[ligne.cle] = 'pret-traduction';
      change = true;
      n++;
    }
    if (!change) { continue; }
    try {
      ecrireSuiviTraduction(racine, slug, {
        statuts: statuts, commentaire: etat.suivi.commentaire, _inconnues: etat.suivi._inconnues
      });
    } catch (e) { erreurs.push(slug + ' (' + e.message + ')'); }
  }
  if (erreurs.length > 0) { vscode.window.showErrorMessage(T('err.ecriture', [erreurs.join(', ')])); }
  vscode.window.setStatusBarMessage(n > 0 ? T('trad.toutpret.fait', [n]) : T('trad.toutpret.rien'), 5000);
  if (rafraichirTout) { rafraichirTout(); }
  rafraichirPanneauTraduction(fournisseur);        // le panneau ouvert suit le bouton
}

function textesTraduction() {
  return {
    source: T('trad.source'), sourceVide: T('trad.source.vide'), cible: T('trad.cible'),
    copier: T('trad.copier'), copie: T('trad.copie'), statut: T('trad.statut'),
    traduit: T('trad.traduit'), atraduire: T('trad.atraduire'),
    tout: T('trad.tout'), toutAide: T('trad.tout.aide'),
    rien: T('trad.rien'), aucuneModif: T('form.rien'), enregistre: T('trad.enregistre'),
    commentaire: T('trad.commentaire'), commentaireAide: T('trad.commentaire.aide'),
    deepl: T('trad.deepl'), deeplTip: T('trad.deepl.tooltip'),
    motCle: T('trad.motcle'), motCleSansEquiv: T('trad.motcle.sansequivalent'),
    motsClesAide: T('trad.motscles.aide')
  };
}

function htmlTraduction(nonce) {
  return construireHtml('traduction', nonce, {
    titre: T('trad.titre'),
    remplacements: { '__TXT__': JSON.stringify(textesTraduction()) }
  });
}

let panneauTraduction = null;
let slugTraduction = null;
let traductionModifiee = false;
let rechargementTraduction = null;

// Les groupes tels que la webview les attend (libellés résolus côté hôte : le
// webview ne connaît ni LIBELLES ni langue d'interface).
function groupesPourWebview(etat) {
  return etat.groupes.map((groupe) => ({
    cle: groupe.cle, groupe: groupe.groupe, langue: groupe.langue,
    langueSource: etat.source,
    libelle: libelleGroupe(groupe),
    remplissage: etatRemplissageGroupe(groupe),
    rempli: groupe.rempli,
    statut: groupe.statut,
    champs: groupe.lignes.map((ligne) => ({
      champ: ligne.champ,
      libelle: T('trad.champ.' + ligne.champ),
      source: ligne.source,
      cible: ligne.cible,
      paires: ligne.paires || null,
      multiligne: ligne.champ === 'resume'
    }))
  }));
}

function envoyerValeursTraduction(panneau, fournisseur, slug, focus) {
  const etat = etatTraduction(fournisseur.racine, slug);
  repondrePanneau(panneau, {
    type: 'valeurs',
    slug: slug,
    langueSource: etat.source,
    groupes: groupesPourWebview(etat),
    commentaire: etat.suivi.commentaire,
    statuts: STATUTS.map((s) => ({ valeur: s, libelle: T('trad.statut.' + s) })),
    focus: focus || null
  });
  traductionModifiee = false;                      // les cartes viennent d'être reconstruites
}

// Recharge le panneau ouvert (après le bouton « tout marquer », ou un enregistrement).
function rafraichirPanneauTraduction(fournisseur) {
  if (!panneauTraduction || !slugTraduction || !fournisseur.racine) { return; }
  if (fournisseur.listerArticles().indexOf(slugTraduction) === -1) { return; }
  envoyerValeursTraduction(panneauTraduction, fournisseur, slugTraduction, null);
}

// Enregistre ce que renvoie le panneau. Les TEXTES passent par le chemin d'écriture
// des fiches (ecrireCartesArticles -> nettoyerCarte -> serialiserMeta -> écriture
// atomique) : mêmes bornes, mêmes clés inconnues restituées (D49), et la fiche est
// RELUE à l'instant — une modification faite entre-temps dans « Métadonnées des
// articles » (et déjà enregistrée) n'est pas écrasée. Retourne
// { ok, message, metaChangee } ; metaChangee pilote la recompilation de l'aperçu.
function enregistrerTraduction(fournisseur, msg) {
  const racine = fournisseur.racine;
  const slug = String((msg && msg.slug) || '');
  if (!racine || fournisseur.listerArticles().indexOf(slug) === -1) {
    return { ok: false, message: T('err.ecriture', [slug]) };
  }
  const source = langueRevue(racine);
  const meta = lireMetaArticle(racine, slug);
  delete meta._inconnues;                          // ecrireCartesArticles les relit du disque
  const suivi = lireSuiviTraduction(racine, slug);
  const statuts = Object.assign({}, suivi.statuts);
  let metaChangee = false;
  for (const groupe of (Array.isArray(msg.groupes) ? msg.groupes : [])) {
    const langue = String((groupe && groupe.langue) || '');
    // Jamais la langue du numéro : ce panneau ne touche pas au texte source.
    if (LANGUES_META.indexOf(langue) === -1 || langue === source) { continue; }
    const s = statutValide(groupe.statut);
    for (const brut of (Array.isArray(groupe.champs) ? groupe.champs : [])) {
      const champ = String((brut && brut.champ) || '');
      if (CHAMPS_TRADUISIBLES.indexOf(champ) === -1) { continue; }
      // L'état est celui du GROUPE : il est posé sur chacune de ses clés, pour que
      // le sidecar reste lisible par une version qui ne connaît pas les groupes.
      if (s) { statuts[cleChamp(champ, langue)] = s; }
      const avant = texteChamp(meta, champ, langue);
      let valeur;
      if (champ === 'keywords') {
        // Appariement par position : une case vide AU MILIEU ferait remonter tous les
        // mots-clés suivants d'un cran. alignerMotsCles tient la place avec la marque
        // TO BE TRANSLATED. Le webview l'a déjà fait — on le refait ici, parce que ce
        // qui protège le fichier doit être du côté qui l'écrit.
        valeur = alignerMotsCles(brut.paires, listeChamp(meta, 'keywords', source).length);
      } else {
        valeur = valeurChamp(champ, brut.texte);
      }
      meta[champ] = meta[champ] || {};
      meta[champ][langue] = valeur;
      if (texteChamp(meta, champ, langue) !== avant) { metaChangee = true; }
    }
  }
  const res = ecrireCartesArticles(fournisseur, { [slug]: meta }, [slug]);
  if (res.erreurs.length > 0) { return { ok: false, message: T('err.ecriture', [res.erreurs.join(', ')]) }; }
  const commentaire = String(msg.commentaire === undefined || msg.commentaire === null ? '' : msg.commentaire)
    .replace(/\r\n?/g, '\n').slice(0, 4000);
  try {
    ecrireSuiviTraduction(racine, slug, {
      statuts: statuts, commentaire: commentaire, _inconnues: suivi._inconnues
    });
  } catch (e) { return { ok: false, message: T('err.ecriture', [e.message]) }; }
  return { ok: true, metaChangee: metaChangee };
}

// « Envoyer dans DeepL » : le traducteur web accepte le texte dans le FRAGMENT de
// l'URL — https://www.deepl.com/translator#<source>/<cible>/<texte>. Rien n'est
// envoyé par l'extension : c'est le navigateur qui ouvre la page (le texte reste
// donc dans l'URL, jamais dans une requête faite par le cockpit). Le retour se fait
// au copier-coller : sans clé d'API, DeepL ne peut pas nous rendre la traduction.
const LONGUEUR_MAX_DEEPL = 4000;                   // au-delà, les navigateurs tronquent

function ouvrirDeepl(panneau, msg) {
  const texte = String((msg && msg.texte) || '').trim();
  const de = LANGUES_META.indexOf(String(msg.source || '')) !== -1 ? msg.source : 'fr';
  const vers = LANGUES_META.indexOf(String(msg.cible || '')) !== -1 ? msg.cible : 'de';
  if (texte === '') { return; }
  if (texte.length > LONGUEUR_MAX_DEEPL) {
    repondrePanneau(panneau, { type: 'erreur', message: T('trad.deepl.troplong') });
    return;
  }
  const url = 'https://www.deepl.com/translator#' + de + '/' + vers + '/' + encodeURIComponent(texte);
  vscode.env.openExternal(vscode.Uri.parse(url));
}

// Résout l'article visé : argument de l'arbre ({slug[, cle]} ou slug), sinon le .md
// actif, sinon celui affiché en aperçu — même cascade que « Métadonnées de l'article
// courant » (D97).
function cibleTraduction(fournisseur, cible) {
  if (typeof cible === 'string' && cible !== '') { return { slug: cible, cle: null }; }
  if (cible && cible.slug) { return { slug: String(cible.slug), cle: cible.cle ? String(cible.cle) : null }; }
  const ed = vscode.window.activeTextEditor;
  const actif = ed ? slugDepuisChemin(fournisseur.racine, ed.document.uri.fsPath) : null;
  return { slug: actif || apercuCourantSlug || null, cle: null };
}

// Panneau « Traduction » : formulaire en colonne 1, aperçu de l'article en colonne 2
// (ouvrirArticle sans ouvrir le .md — F5 fermerait justement l'aperçu, ici on le veut).
async function ouvrirTraduction(fournisseur, rafraichirTout, cible) {
  if (!fournisseur.racine) { return; }
  const vise = cibleTraduction(fournisseur, cible);
  if (!vise.slug || fournisseur.listerArticles().indexOf(vise.slug) === -1) {
    vscode.window.setStatusBarMessage(T('trad.horsarticle'), 4000);
    return;
  }
  const montrerApercu = (slug) => {
    // L'aperçu suit l'article affiché ; une erreur de compilation est déjà signalée
    // par ouvrirArticle et ne doit pas remonter en rejet non capturé.
    ouvrirArticle(fournisseur, slug, { sansTexte: true }).catch(() => { /* signalé côté build */ });
  };
  if (panneauTraduction) {
    panneauTraduction.reveal(vscode.ViewColumn.One);
    if (vise.slug === slugTraduction) {
      if (vise.cle) { repondrePanneau(panneauTraduction, { type: 'focus', cle: vise.cle }); }
      montrerApercu(vise.slug);
      return;
    }
    if (traductionModifiee) {
      // Le panneau porte un ● : on demande à la webview ce qu'elle contient, la
      // garde (et le changement d'article) se joue à sa réponse.
      rechargementTraduction = vise;
      repondrePanneau(panneauTraduction, { type: 'demande-rechargement' });
      return;
    }
    slugTraduction = vise.slug;
    panneauTraduction.title = T('trad.titre.un', [vise.slug]);
    envoyerValeursTraduction(panneauTraduction, fournisseur, vise.slug, vise.cle);
    montrerApercu(vise.slug);
    return;
  }
  slugTraduction = vise.slug;
  traductionModifiee = false;
  rechargementTraduction = null;
  const panneau = vscode.window.createWebviewPanel(
    'szhTraduction', T('trad.titre.un', [vise.slug]), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauTraduction = panneau;
  let focusInitial = vise.cle;
  panneau.onDidDispose(() => {
    if (panneauTraduction === panneau) {
      panneauTraduction = null; slugTraduction = null;
      traductionModifiee = false; rechargementTraduction = null;
    }
  });
  panneau.webview.html = htmlTraduction(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') {
      envoyerValeursTraduction(panneau, fournisseur, slugTraduction, focusInitial);
      focusInitial = null;
      return;
    }
    if (msg.type === 'modifie') { traductionModifiee = !!msg.modifie; return; }
    if (msg.type === 'copier') {
      await vscode.env.clipboard.writeText(String(msg.texte || ''));
      repondrePanneau(panneau, { type: 'copie' });
      return;
    }
    if (msg.type === 'deepl') { ouvrirDeepl(panneau, msg); return; }
    if (msg.type === 'rechargement') {
      const attente = rechargementTraduction;
      rechargementTraduction = null;
      if (!attente) { return; }                    // réponse tardive : changement abandonné
      const choix = await vscode.window.showWarningMessage(
        T('trad.recharger.question'), { modal: true, detail: T('table.quitter.detail') },
        T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
      if (choix === undefined) { return; }         // Annuler : on reste sur l'article en cours
      if (choix === T('form.enregistrer')) {
        const res = enregistrerTraduction(fournisseur, msg);
        if (!res.ok) { repondrePanneau(panneau, { type: 'erreur', message: res.message }); return; }
        vscode.window.setStatusBarMessage(T('statut.traduction', [msg.slug]), 3000);
        if (rafraichirTout) { rafraichirTout(); }
      }
      slugTraduction = attente.slug;
      panneau.title = T('trad.titre.un', [attente.slug]);
      envoyerValeursTraduction(panneau, fournisseur, attente.slug, attente.cle);
      montrerApercu(attente.slug);
      return;
    }
    if (msg.type !== 'enregistrer') { return; }
    const res = enregistrerTraduction(fournisseur, msg);
    if (!res.ok) { repondrePanneau(panneau, { type: 'erreur', message: res.message }); return; }
    repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto });
    traductionModifiee = false;
    if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.traduction', [slugTraduction]), 3000); }
    if (rafraichirTout) { rafraichirTout(); }
    // D121 : un enregistrement AUTOMATIQUE ne renvoie jamais les valeurs — le
    // re-rendu reconstruirait le DOM sous les doigts (curseur et sélection perdus).
    // Le webview est déjà à jour : c'est lui qui vient d'envoyer ce qu'il affiche.
    if (!msg.auto) { envoyerValeursTraduction(panneau, fournisseur, slugTraduction, null); }
    // La fiche est une dépendance de build (M1) : un titre traduit change le rendu.
    // On ne recompile que si un TEXTE a bougé — pas pour un simple changement d'état —
    // et jamais sur un enregistrement automatique, qui tomberait en pleine frappe.
    if (res.metaChangee && !msg.auto) { montrerApercu(slugTraduction); }
  });
  montrerApercu(vise.slug);
}

// ---- Photos d'auteur·e·s (F3, D91/D92) ---------------------------------------------
//
// Flux : la modale du webview dépose une image (base64) -> l'hôte écrit
// articles/<slug>/portraits/<slug-auteur>.original.<ext> puis appelle le pipeline
// WSL (lib/portraits.js) qui produit .avec-fond.png / .sans-fond.png -> l'hôte
// renvoie les TROIS versions en data: URIs (aperçu) -> « Valider » fige le champ
// `photo` (chemin relatif) que la fiche emporte à l'enregistrement. Protocole :
//   webview -> hôte : photo-ouvrir   { slug, index, photo }            (photo déjà posée)
//                     photo-deposer  { slug, index, prenom, nom, nomFichier, donneesBase64 }
//                     photo-choisir  { slug, index, base, version }
//   hôte -> webview : photo-versions { slug, index, base, versions:{original,
//                        avecFond, sansFond}, infos:{visage,padding}|null, actuelle|null }
//                     photo-valeur   { slug, index, photo }
//                     photo-erreur   { slug, index, message }
// `base` (= <slug-auteur>) est TOUJOURS généré par l'hôte (slugifier ou champ
// photo existant décomposé) ; quand la webview le renvoie, il est revalidé
// (segment unique, alphabet sûr) avant toute construction de chemin.

const EXTENSIONS_PHOTO = ['png', 'jpg', 'jpeg', 'webp'];
const MIMES_PHOTO = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const TAILLE_MAX_PHOTO = 20 * 1024 * 1024;     // ~20 Mo — garde côté webview ET hôte
const VERSIONS_PHOTO = ['original', 'avec-fond', 'sans-fond'];

let photoEnCours = false;                       // garde anti-double (le pipeline est long)

function dossierPortraitsArticle(racine, slug) {
  return path.join(racine, 'articles', slug, 'portraits');
}

// data: URI d'une image du disque (null si illisible) — aperçus de la modale
// (CSP img-src data:, localResourceRoots reste []).
function dataUriImage(chemin) {
  try {
    const ext = (chemin.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
    return 'data:' + (MIMES_PHOTO[ext] || 'image/png') + ';base64,' +
      fs.readFileSync(chemin).toString('base64');
  } catch (e) { return null; }
}

// Nom de fichier du <base>.original.<ext> présent dans `dossier` (null si aucun) —
// l'extension de l'original n'est pas connue de la webview, on la retrouve ici.
function trouverOriginal(dossier, base) {
  let noms = [];
  try { noms = fs.readdirSync(dossier); } catch (e) { return null; }
  for (const n of noms) {
    if (n.indexOf(base + '.original.') === 0 && !n.startsWith('~$')) { return n; }
  }
  return null;
}

// Les trois versions d'un portrait en data: URIs (null pour chaque fichier absent).
function versionsPhoto(dossier, base) {
  const original = trouverOriginal(dossier, base);
  return {
    original: original ? dataUriImage(path.join(dossier, original)) : null,
    avecFond: dataUriImage(path.join(dossier, base + '.avec-fond.png')),
    sansFond: dataUriImage(path.join(dossier, base + '.sans-fond.png'))
  };
}

// Décompose un champ `photo` DÉJÀ assaini en { base, version } (null si la forme
// n'est aucune des trois de D92) : même base, trois suffixes.
function decomposerPhoto(photo) {
  const nom = String(photo || '').replace(/^portraits\//, '');
  let m = nom.match(/^(.+)\.original\.[a-z0-9]+$/i);
  if (m) { return { base: m[1], version: 'original' }; }
  m = nom.match(/^(.+)\.avec-fond\.png$/i);
  if (m) { return { base: m[1], version: 'avec-fond' }; }
  m = nom.match(/^(.+)\.sans-fond\.png$/i);
  if (m) { return { base: m[1], version: 'sans-fond' }; }
  return null;
}

// `base` renvoyé par la webview : un SEUL segment de chemin, alphabet sûr (pas de
// séparateur, donc pas de remontée possible sous portraits/).
function baseAuteurValide(base) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(base || ''));
}

// postMessage tolérant : le panneau peut être fermé pendant le traitement WSL.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// photo-ouvrir : l'auteur a DÉJÀ une photo -> renvoyer les data: URIs des versions
// existantes (déduites du champ), radio préselectionnée sur la version actuelle.
function ouvrirVersionsPhoto(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }   // slug inconnu : ignoré
  const photo = assainirCheminPhoto(msg.photo);
  const d = photo === '' ? null : decomposerPhoto(photo);
  if (!d) {
    // Valeur hors des trois formes D92 (fiche retouchée à la main ?) : la modale
    // ne doit pas rester sur « Chargement… » — on invite à redéposer.
    repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  repondrePanneau(panneau, {
    type: 'photo-versions', slug: slug, index: msg.index, base: d.base,
    versions: versionsPhoto(dossierPortraitsArticle(fournisseur.racine, slug), d.base),
    infos: null, actuelle: d.version
  });
}

// photo-deposer : écrit l'original (écriture « ~$ » + rename, comme ausgabe.yaml),
// purge les anciens .original.* d'une autre extension, lance le pipeline WSL puis
// renvoie les trois versions. Avertissement (hôte) si aucun visage détecté.
async function deposerPhotoAuteur(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  const index = msg.index;
  const erreur = (texte) => repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: index, message: texte });
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }   // slug inconnu : ignoré
  if (photoEnCours) { erreur(T('photo.encours')); return; }
  const prenom = String(msg.prenom || '').trim();
  const nom = String(msg.nom || '').trim();
  if (prenom === '' && nom === '') { return; }    // la webview garde déjà (nom requis)
  const slugAuteur = slugifier(prenom + '-' + nom);
  const ext = (String(msg.nomFichier || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (EXTENSIONS_PHOTO.indexOf(ext) === -1) { erreur(T('photo.err.format')); return; }
  const donnees = Buffer.from(String(msg.donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { erreur(T('photo.err.format')); return; }
  if (donnees.length > TAILLE_MAX_PHOTO) { erreur(T('photo.err.tropvolumineux')); return; }

  photoEnCours = true;
  try {
    const dossier = dossierPortraitsArticle(fournisseur.racine, slug);
    const nomOriginal = slugAuteur + '.original.' + ext;
    const chemin = path.join(dossier, nomOriginal);
    try {
      fs.mkdirSync(dossier, { recursive: true });
      // Un seul .original.* par auteur : sans cette purge, trouverOriginal
      // deviendrait ambigu après un dépôt .jpg puis un dépôt .png.
      for (const n of (fs.readdirSync(dossier) || [])) {
        if (n.indexOf(slugAuteur + '.original.') === 0 && n !== nomOriginal) {
          try { fs.unlinkSync(path.join(dossier, n)); } catch (e) { /* verrouillé : sans gravité */ }
        }
      }
      const tmp = path.join(dossier, '~$' + nomOriginal);
      try {
        fs.writeFileSync(tmp, donnees);
        fs.renameSync(tmp, chemin);
      } finally {
        try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
      }
    } catch (e) {
      erreur(T('err.ecriture', [e.message]));
      return;
    }
    let resultats;
    try {
      resultats = await traiterPortraits({
        dossierPortraits: dossier,
        entrees: [{ slug: slugAuteur, cheminSource: chemin }]
      });
    } catch (e) {
      erreur(T(e && e.wsl ? 'photo.err.wsl' : 'photo.err.traitement', [e.message]));
      return;
    }
    const r = resultats.filter((x) => x && x.slug === slugAuteur)[0] || resultats[0] || {};
    if (!r.ok) { erreur(T('photo.err.traitement', [String(r.erreur || '?')])); return; }
    if (!r.visage) { vscode.window.showWarningMessage(T('photo.sansvisage')); }
    repondrePanneau(panneau, {
      type: 'photo-versions', slug: slug, index: index, base: slugAuteur,
      versions: versionsPhoto(dossier, slugAuteur),
      infos: { visage: !!r.visage, padding: !!r.padding },
      actuelle: null
    });
  } finally {
    photoEnCours = false;
  }
}

// photo-choisir : « Valider » de la modale -> chemin relatif de la version choisie,
// vérifié SUR LE DISQUE avant d'être renvoyé (jamais de valeur photo aveugle).
function choisirPhotoAuteur(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }   // slug inconnu : ignoré
  const base = String(msg.base || '');
  const version = String(msg.version || '');
  if (!baseAuteurValide(base) || VERSIONS_PHOTO.indexOf(version) === -1) { return; }
  const dossier = dossierPortraitsArticle(fournisseur.racine, slug);
  let nom = null;
  if (version === 'original') {
    nom = trouverOriginal(dossier, base);
  } else {
    nom = base + '.' + version + '.png';
    try { if (!fs.existsSync(path.join(dossier, nom))) { nom = null; } } catch (e) { nom = null; }
  }
  if (!nom) {
    repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  repondrePanneau(panneau, { type: 'photo-valeur', slug: slug, index: msg.index, photo: 'portraits/' + nom });
}

// ---- Formulaire de fiches : liste complète ou UN article (D97) ----------------------
//
// Le formulaire liste par défaut TOUS les articles. L'icône ✎ de l'arbre (et l'entrée
// « Métadonnées de l'article courant » du panneau d'édition) l'ouvre FILTRÉ sur un seul
// article : même webview, même gabarit de carte, même circuit d'écriture
// (ecrireCartesArticles) — seule la liste envoyée change, plus un bouton « Voir tous
// les articles » pour revenir. Un seul gabarit, un seul chemin d'écriture.
//
// Le panneau est un SINGLETON : passer de « tous » à « un » (et l'inverse) RECHARGE le
// panneau existant au lieu d'en ouvrir un second. Comme un rechargement reconstruit les
// cartes, les modifications non enregistrées seraient perdues : la webview annonce son
// état par le message « modifie », et tout rechargement passe alors par la garde
// (Enregistrer / Quitter sans enregistrer / Annuler), sur le patron du dialogue
// d'import. Les cartes à écrire, elles, ne peuvent venir que de la webview : l'hôte les
// lui demande (« demande-rechargement ») et la garde se joue à sa réponse.
let filtreArticles = null;           // tableau de slugs affichés, ou null = tous
let fichesModifie = false;           // ● côté webview (cartes modifiées non enregistrées)
let rechargementEnAttente = null;    // { filtre } pendant l'aller-retour de la garde

// Filtre demandé -> liste de slugs RÉELS, ou null (tous). Un slug inconnu (article
// supprimé entre-temps) ne doit pas donner un formulaire vide : on retombe sur tous.
function filtreValide(fournisseur, slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) { return null; }
  const connus = new Set(fournisseur.listerArticles());
  const retenus = slugs.map(String).filter((s) => connus.has(s));
  return retenus.length > 0 ? retenus : null;
}

function titreFiches(filtre) {
  return (filtre && filtre.length === 1) ? T('fiches.titre.un', [filtre[0]]) : T('fiches.titre');
}

// F5 — pleine page : mêmes règles que « Méta-données du numéro » (fermer les
// aperçus avant d'afficher, y compris quand le panneau existe déjà et est révélé).
async function ouvrirApercuMetadonnees(fournisseur, rafraichirTout, slugs) {
  if (!fournisseur.racine) { return; }
  const filtre = filtreValide(fournisseur, slugs);
  await fermerTousLesApercus();
  const envoyerValeurs = (panneau) => {
    const langue = langueRevue(fournisseur.racine);
    // Le champ `groupe` des types pilote la construction des <optgroup> côté webview ;
    // `filtre` y montre (ou non) le bandeau « Voir tous les articles ».
    panneau.webview.postMessage({
      type: 'valeurs',
      articles: lireMetadonneesArticles(fournisseur, filtreArticles),
      filtre: filtreArticles,
      langue: langue,
      types: typesTraduits(langue)
    });
    fichesModifie = false;                         // les cartes viennent d'être reconstruites
  };
  const appliquerFiltre = (panneau, nouveau) => {
    filtreArticles = nouveau;
    panneau.title = titreFiches(filtreArticles);
    envoyerValeurs(panneau);
  };
  if (panneauArticles) {
    panneauArticles.reveal(vscode.ViewColumn.One);
    if (fichesModifie) {
      // Des cartes portent un ● : on demande à la webview de rendre ce qu'elle a, la
      // garde (et le rechargement) se joue à sa réponse.
      rechargementEnAttente = { filtre: filtre };
      repondrePanneau(panneauArticles, { type: 'demande-rechargement' });
      return;
    }
    appliquerFiltre(panneauArticles, filtre);
    return;
  }
  filtreArticles = filtre;
  fichesModifie = false;
  const panneau = vscode.window.createWebviewPanel(
    'szhApercuMetadonnees', titreFiches(filtreArticles), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauArticles = panneau;
  panneau.onDidDispose(() => {
    if (panneauArticles === panneau) { panneauArticles = null; fichesModifie = false; rechargementEnAttente = null; }
  });
  panneau.webview.html = htmlApercuMetadonnees(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeurs(panneau); return; }
    if (msg.type === 'modifie') { fichesModifie = !!msg.modifie; return; }
    // « Voir tous les articles » : même chemin que l'ouverture, garde comprise.
    if (msg.type === 'tous') { await ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null); return; }
    // Réponse à « demande-rechargement » : garde « non enregistré » puis rechargement.
    if (msg.type === 'rechargement') {
      const attente = rechargementEnAttente;
      rechargementEnAttente = null;
      if (!attente) { return; }                    // réponse tardive : le rechargement a été abandonné
      const choix = await vscode.window.showWarningMessage(
        T('fiches.recharger.question'), { modal: true, detail: T('table.quitter.detail') },
        T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
      if (choix === undefined) { return; }         // Annuler : on reste sur les cartes en cours
      if (choix === T('form.enregistrer')) {
        const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles);
        if (res.erreurs.length > 0) {
          repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [res.erreurs.join(', ')]) });
          return;                                  // échec : rien n'est rechargé
        }
        vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000);
        if (rafraichirTout) { rafraichirTout(); }
      }
      appliquerFiltre(panneau, attente.filtre);
      return;
    }
    // Modale photo (F3) : dépôt -> pipeline WSL ; ouverture sur photo existante ;
    // « Valider » -> chemin relatif de la version choisie.
    if (msg.type === 'photo-deposer') { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-ouvrir') { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-choisir') { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type !== 'enregistrer' || !msg.articles) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles);
    if (res.erreurs.length > 0) {
      panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [res.erreurs.join(', ')]) });
    } else {
      panneau.webview.postMessage({ type: 'enregistre', n: res.n, auto: !!msg.auto });
      if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000); }
    }
    if (rafraichirTout) { rafraichirTout(); }
    // D121 : un enregistrement AUTOMATIQUE ne renvoie jamais les cartes — les
    // reconstruire sous les doigts ferait sauter le curseur toutes les 3 secondes.
    // La webview est déjà à jour : c'est elle qui vient d'envoyer ce qu'elle affiche.
    if (!msg.auto) { envoyerValeurs(panneau); }     // resynchronise (dirty remis à zéro)
  });
}

// Icône ✎ de l'arbre (item d'article) et entrée « Métadonnées de l'article courant »
// du panneau d'édition. Sans item, l'article courant est celui du .md ACTIF ; à défaut
// celui affiché en aperçu (on vient peut-être de cliquer dans la colonne 2).
async function ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine) { return; }
  let slug = (item && item.slug) ? String(item.slug) : null;
  if (!slug) {
    const ed = vscode.window.activeTextEditor;
    slug = ed ? slugDepuisChemin(fournisseur.racine, ed.document.uri.fsPath) : null;
  }
  if (!slug) { slug = apercuCourantSlug; }
  if (!slug) {
    vscode.window.setStatusBarMessage(T('fiches.horsarticle'), 4000);
    return;
  }
  await ouvrirApercuMetadonnees(fournisseur, rafraichirTout, [slug]);
}

// ---- Dialogue « Vérification de l'import » (F6) -------------------------------------
//
// Ouvert automatiquement à la fin de lancerConversion dès qu'AU MOINS UN nouvel
// article est apparu (diff avant/après de listerArticles — jamais de parsing de
// sortie). Panneau singleton szhImportVerif, colonne 1, aperçus fermés d'abord
// (F5) ; une nouvelle conversion le RÉVÈLE et recharge la liste de slugs (les
// sections affichées sont celles de la DERNIÈRE vague). Une section par article :
//   1. la carte de métadonnées du formulaire M1 (même gabarit, même écriture :
//      nettoyerCarte + serialiserMeta + écriture atomique via ecrireCartesArticles),
//      plus des badges par champ — rempli = « détecté » (pré-rempli par le
//      pipeline dans <slug>.meta.yaml), vide = « à compléter » — et le compte de
//      champs vides en tête de carte. Le dialogue ne lit QUE le .meta.yaml.
//   2. les photos d'auteur·e·s : mêmes boutons 📷 / même modale que M1 — les
//      handlers photo-* de F3 sont génériques (slug + index) et réutilisés tels quels.
//   3. les originaux des images : articles/<slug>/media/ (nom + « L × H · poids »
//      de decrireImage), chaque image avec une zone de dépôt / un bouton fichier
//      pour la REMPLACER par l'original haute qualité EN GARDANT LE NOM — mêmes
//      confirmation et renfort de format que szh.remplacerAsset (G5), contenu
//      passé en base64 par postMessage (≤ 50 Mo), écriture « ~$ » + rename.
// Protocole (en plus de photo-* de F3) :
//   webview -> hôte : pret ; enregistrer { articles } ; fermer { modifie, articles } ;
//                     remplacer-image { slug, relatif, nomFichier, donneesBase64 }
//   hôte -> webview : valeurs { articles:[{slug, valeurs, images:[{relatif,
//                     description}]}], langue, types } ; enregistre { n } ;
//                     erreur { message } ; image-remplacee { slug, relatif,
//                     description } ; image-erreur { slug, relatif, message } ;
//                     image-annulee { slug, relatif }

const TAILLE_MAX_IMAGE_IMPORT = 50 * 1024 * 1024;  // ~50 Mo — garde côté webview ET hôte
const EXTENSIONS_IMAGE_IMPORT = ['png', 'jpg', 'jpeg', 'gif', 'svg'];

// Chemin relatif d'image reçu de la webview d'import : relatif à
// articles/<slug>/media/, séparateur « / » (forme produite par _imagesArticle).
// Jamais utilisé pour construire un chemin sans repasser ici — segments sûrs
// uniquement (pas de remontée « .. », d'antislash, de deux-points, de segment
// vide ni de temporaire « ~$ ») et extension d'image attendue. Pur (via _pur).
function relatifImageValide(relatif) {
  const c = String(relatif === undefined || relatif === null ? '' : relatif);
  if (c === '' || c.length > 300 || /[\\:\r\n]/.test(c)) { return false; }
  const segments = c.split('/');
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..' || s.indexOf('~$') === 0) { return false; }
  }
  return /\.(png|jpe?g|gif|svg)$/i.test(segments[segments.length - 1]);
}

let panneauImportVerif = null;
let slugsImportVerif = [];                         // slugs de la dernière conversion

function htmlImportVerif(nonce) {
  const txt = JSON.stringify(Object.assign(textesCarteArticle(), {
    badgeDetecte: T('importv.badge.detecte'), badgeAcompleter: T('importv.badge.acompleter'),
    vides: T('importv.vides'), videsZero: T('importv.vides.zero'),
    photosNote: T('importv.photos.note'),
    sectionImages: T('importv.section.images'), imagesNote: T('importv.images.note'),
    imagesAucune: T('importv.images.aucune'), imageDeposer: T('importv.image.deposer'),
    imageRemplacee: T('importv.image.remplacee'),
    errImageTropVolumineuse: T('importv.err.tropvolumineux'),
    errImageFormat: T('importv.err.format')
  }));
  return construireHtml('import-verif', nonce, {
    titre: T('importv.titre'),
    remplacements: { '__TXT__': txt },
    // Comme metadata-articles (F3) : aperçus de la modale photo en data: URIs.
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Fiches + images des articles de la dernière conversion (slugs revalidés contre
// la liste réelle : un article supprimé entre-temps disparaît du dialogue).
function lireArticlesImport(fournisseur) {
  const connus = new Set(fournisseur.listerArticles());
  const articles = [];
  for (const slug of slugsImportVerif) {
    if (!connus.has(slug)) { continue; }
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = { type: '', doi: '', title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas (encore) de fiche : carte vide, tout « à compléter » */ }
    delete valeurs._inconnues;                     // le webview n'a pas à les voir
    const base = path.join(fournisseur.racine, 'articles', slug, 'media');
    const images = fournisseur._imagesArticle(slug).map((relatif) => ({
      relatif: relatif,
      description: decrireImage(path.join(base, relatif))   // « L × H · poids », comme l'arbre (G5)
    }));
    articles.push({ slug: slug, valeurs: valeurs, images: images });
  }
  return articles;
}

function envoyerValeursImportVerif(panneau, fournisseur) {
  const langue = langueRevue(fournisseur.racine);
  repondrePanneau(panneau, {
    type: 'valeurs',
    articles: lireArticlesImport(fournisseur),
    langue: langue,
    types: typesTraduits(langue)
  });
}

// remplacer-image : écrase articles/<slug>/media/<relatif> par le contenu déposé
// dans la webview, EN GARDANT LE NOM (le lien du .md reste valide) — mêmes
// gardes et mêmes textes de confirmation que szh.remplacerAsset (G5), écriture
// « ~$ » + rename comme les portraits. L'annulation est signalée à la webview
// (image-annulee) pour réactiver la zone de dépôt.
async function remplacerImageImport(fournisseur, rafraichirTout, panneau, msg) {
  const slug = String(msg.slug || '');
  const relatif = String(msg.relatif || '');
  const erreur = (texte) => repondrePanneau(panneau, { type: 'image-erreur', slug: slug, relatif: relatif, message: texte });
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }   // slug inconnu : ignoré
  if (!relatifImageValide(relatif)) { return; }                       // chemin hors contrat : ignoré
  if (buildEnCours || importEnCours) { erreur(T('statut.occupe')); return; }
  const cible = path.join(fournisseur.racine, 'articles', slug, 'media', relatif);
  let existe = false;
  try { existe = fs.statSync(cible).isFile(); } catch (e) { existe = false; }
  if (!existe) { erreur(T('err.remplacement', [relatif])); return; }  // disparu entre-temps
  const nomCible = path.basename(cible);
  const nomSource = String(msg.nomFichier || '');
  const ext = (nomSource.match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (EXTENSIONS_IMAGE_IMPORT.indexOf(ext) === -1) { erreur(T('importv.err.format')); return; }
  const donnees = Buffer.from(String(msg.donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { erreur(T('importv.err.format')); return; }
  if (donnees.length > TAILLE_MAX_IMAGE_IMPORT) { erreur(T('importv.err.tropvolumineux')); return; }
  // Jamais d'écrasement silencieux : confirmation modale, renforcée si le format
  // du fichier déposé diffère de la cible (risque R4) — comme remplacerAsset.
  let detail = T('modale.remplacer.detail.image', [nomCible]);
  if (formatImage(nomSource) !== formatImage(nomCible)) {
    detail = T('modale.remplacer.detail.format', [formatImage(nomSource), formatImage(nomCible)]) + detail;
  }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.remplacer.question', [nomCible, nomSource]),
    { modal: true, detail: detail },
    T('modale.remplacer.bouton')
  );
  if (reponse !== T('modale.remplacer.bouton')) {
    repondrePanneau(panneau, { type: 'image-annulee', slug: slug, relatif: relatif });
    return;
  }
  try {
    const tmp = path.join(path.dirname(cible), '~$' + nomCible);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);                   // même nom : lien du .md intact
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
    vscode.window.setStatusBarMessage(T('statut.image.remplacee', [nomCible]), 5000);
    repondrePanneau(panneau, { type: 'image-remplacee', slug: slug, relatif: relatif, description: decrireImage(cible) });
  } catch (e) {
    erreur(T('err.remplacement', [e.message]));
  }
  if (rafraichirTout) { rafraichirTout(); }        // « L × H · poids » de l'arbre à jour
}

// Ouvre (ou révèle + recharge) le dialogue pour les articles `slugs`. Pleine
// page comme les autres formulaires (F5) : aperçus fermés d'abord.
async function ouvrirImportVerif(fournisseur, rafraichirTout, slugs) {
  if (!fournisseur.racine || !Array.isArray(slugs) || slugs.length === 0) { return; }
  slugsImportVerif = slugs.slice();
  await fermerTousLesApercus();
  if (panneauImportVerif) {
    panneauImportVerif.reveal(vscode.ViewColumn.One);
    envoyerValeursImportVerif(panneauImportVerif, fournisseur);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhImportVerif', T('importv.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauImportVerif = panneau;
  panneau.onDidDispose(() => { if (panneauImportVerif === panneau) { panneauImportVerif = null; } });
  panneau.webview.html = htmlImportVerif(crypto.randomBytes(16).toString('hex'));
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeursImportVerif(panneau, fournisseur); return; }
    // Modale photo (F3) : handlers génériques slug + index, réutilisés tels quels.
    if (msg.type === 'photo-deposer') { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-ouvrir') { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-choisir') { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'remplacer-image') { await remplacerImageImport(fournisseur, rafraichirTout, panneau, msg); return; }
    if (msg.type === 'fermer') {
      // Garde « non-enregistré » sur le chemin de fermeture que l'on contrôle
      // (patron retourArticle de l'éditeur de tableau, D1) : Enregistrer /
      // Quitter sans enregistrer / Esc = rester. La croix de l'onglet, elle,
      // ne peut pas être interceptée (limite de l'API webview).
      if (msg.modifie) {
        const choix = await vscode.window.showWarningMessage(
          T('importv.quitter.question'), { modal: true, detail: T('table.quitter.detail') },
          T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
        if (choix === undefined) { return; }                       // Annuler : on reste
        if (choix === T('form.enregistrer')) {
          const res = ecrireCartesArticles(fournisseur, msg.articles, slugsImportVerif);
          if (res.erreurs.length > 0) {
            repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [res.erreurs.join(', ')]) });
            return;                                                // échec : on reste
          }
          vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000);
          if (rafraichirTout) { rafraichirTout(); }
        }
      }
      panneau.dispose();
      return;
    }
    if (msg.type !== 'enregistrer' || !msg.articles) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, slugsImportVerif);
    if (res.erreurs.length > 0) {
      repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [res.erreurs.join(', ')]) });
    } else {
      repondrePanneau(panneau, { type: 'enregistre', n: res.n, auto: !!msg.auto });
      if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000); }
    }
    if (rafraichirTout) { rafraichirTout(); }
    // D121 : pas de re-rendu sur un enregistrement automatique (curseur préservé).
    if (!msg.auto) { envoyerValeursImportVerif(panneau, fournisseur); }
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
  apercu: T('regl.apercu'),
  apercuHtml: T('regl.apercu.html'), apercuPdf: T('regl.apercu.pdf'), apercuNote: T('regl.apercu.note'),
  assets: T('regl.assets'),
  assetsOui: T('regl.assets.oui'), assetsNon: T('regl.assets.non'), assetsNote: T('regl.assets.note'),
  langue: T('regl.langue'), langueNote: T('regl.langue.note'),
  dev: T('regl.dev'), devOui: T('regl.dev.oui'), devNon: T('regl.dev.non'), devNote: T('regl.dev.note')
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
  // F8 : la valeur ÉCRITE de szh.apercuMode, pas modeApercu() — qui force « html »
  // sur un profil sans PDF et masquerait le choix réel enregistré.
  let apercu = 'html';
  try {
    apercu = String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { /* repli html */ }
  return {
    theme: etatTheme, zoom: String(zoom), policeMd: String(policeMd), apercu: apercu,
    assets: replierAssetsAutres() ? 'oui' : 'non',   // D96
    langue: langueCockpit(),
    // D119 : le mode développeur ne vit PAS dans les réglages de l'éditeur mais dans
    // C:\ProgramData\SZH\config.json — les scripts PowerShell (lanceur, création,
    // archivage) sont les vrais consommateurs, et ils ne lisent pas settings.json.
    dev: lireModeDeveloppeur() ? 'oui' : 'non'
  };
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
      } else if (msg.cle === 'apercu') {
        // F8 : l'aperçu par défaut au clic sur un article — même réglage que la
        // bascule Ctrl+Alt+P / barre d'état (szh.apercuMode, lu par modeApercu()).
        await vscode.workspace.getConfiguration('szh')
          .update('apercuMode', msg.valeur === 'pdf' ? 'pdf' : 'html', Global);
        if (rafraichirTout) { rafraichirTout(); } // la barre d'état « Aperçu : … » suit
      } else if (msg.cle === 'assets') {
        // D96 : repli automatique des assets des autres articles. Le rafraîchissement
        // fait suivre l'arbre tout de suite (les identités d'article changent avec le
        // réglage : sans lui, l'arbre garderait l'état plié/déplié précédent).
        await vscode.workspace.getConfiguration('szh')
          .update('replierAssetsAutres', msg.valeur !== 'non', vscode.ConfigurationTarget.Global);
        if (rafraichirTout) { rafraichirTout(); }
      } else if (msg.cle === 'dev') {
        // D119 : écrit dans config.json du poste (droit d'écriture donné au groupe
        // Utilisateurs par bootstrap.ps1 — c'est ce qui permet les MAJ sans admin).
        const erreur = ecrireModeDeveloppeur(msg.valeur !== 'non');
        if (erreur) { vscode.window.showErrorMessage(T('err.dev.ecriture', [erreur])); }
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
    'table.enregistrer', 'table.fusionner', 'table.scinder',
    'table.grpApercu', 'table.apercuVoir', 'table.apercuCacher', 'table.preset.note',
    'table.preset.academique',
    'table.preset.entetenegatif',
    'table.preset.entetecouleur',
    'table.preset.entetegris',
    'table.preset.lignesalternees',
    'table.preset.colonnesalternees',
    'table.preset.synthese',
    'table.preset.matrice',
    'table.tip.apercuVoir', 'table.tip.apercuCacher',
    'table.rien', 'table.fusionImpossible', 'table.enregistre',
    'table.ctx.ligneAvant', 'table.ctx.ligneApres', 'table.ctx.ligneSuppr',
    'table.ctx.colAvant', 'table.ctx.colApres', 'table.ctx.colSuppr',
    'table.entete', 'table.enteteRetirer',
    'table.legende', 'table.legende.indice',
    'table.alt', 'table.alt.indice', 'table.alt.aide',
    'table.copyright', 'table.copyright.indice', 'table.source', 'table.source.indice',
    // Panneau de mise en forme (T2) : 3 zones.
    'table.zone.styles', 'table.zone.preset',
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
async function ouvrirEditeurTable(fournisseur, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  const chemin = item.cheminAsset;
  const nom = path.basename(chemin);
  const slugArticle = item.slug || apercuCourantSlug;
  // L'éditeur de tableau a besoin de largeur : la grille, plus deux colonnes de réglages.
  // On ferme donc TOUS les aperçus le temps de l'édition (F5 — y compris l'onglet PDF,
  // qui restait ouvert quand le mode d'aperçu était pdf) — les deux boutons « Voir dans
  // l'aperçu » / « Cacher l'aperçu » de la barre rouvrent et referment l'aperçu HTML à
  // la demande. L'aperçu du tableau lui-même, c'est la grille : elle est là.
  await fermerTousLesApercus();
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
      presets: PRESETS_ORDRE,
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
      accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE });
  };
  const enregistrer = (modele, auto) => {
    ecrireAusgabeAtomique(chemin, serialiserTable(normaliserModele(modele)));
    // D121 : l'enregistrement automatique reste silencieux — un message toutes les
    // trois secondes dans la barre d'état ne dit plus rien à personne.
    if (!auto) { vscode.window.setStatusBarMessage(T('statut.table.enregistree', [nom]), 5000); }
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
        accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE });
      return;
    }
    if (msg.type === 'apercu-ouvrir') {
      // Rouvre l'aperçu de l'article qui contient ce tableau, et tente d'y amener la vue :
      // on cherche la LIGNE de la référence ::: {.szh-tabelle src="…"} dans le .md et on
      // pousse le surlignage habituel (G3). Le tableau inclus est un bloc HTML brut, donc
      // sans position source : si la webview ne trouve rien à surligner, elle ne fait rien
      // — l'aperçu est rouvert, ce qui est l'essentiel.
      if (!slugArticle) { return; }
      ouvrirApercuHtml(fournisseur, slugArticle);
      const md = path.join(fournisseur.racine, 'articles', slugArticle, slugArticle + '.md');
      let ligne = 0;
      try {
        const lignes = fs.readFileSync(md, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lignes.length; i++) {
          if (lignes[i].indexOf(nom) !== -1 && lignes[i].indexOf('szh-tabelle') !== -1) { ligne = i + 1; break; }
        }
      } catch (e) { /* .md illisible : on se contente d'avoir rouvert l'aperçu */ }
      if (ligne > 0) {
        // La webview vient d'être créée : son script n'écoute pas encore. Un seul report
        // suffit (le HTML est déjà en mémoire, il n'y a pas de réseau).
        setTimeout(() => {
          if (!panneauApercuHtml) { return; }
          try { panneauApercuHtml.webview.postMessage({ type: 'surligner', ligne: ligne, mot: '' }); }
          catch (e) { /* aperçu refermé entre-temps */ }
        }, 400);
      }
      return;
    }
    if (msg.type === 'apercu-fermer') { fermerApercuHtml(); return; }
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
        enregistrer(msg.modele, !!msg.auto);
        panneau.webview.postMessage({ type: 'enregistre', auto: !!msg.auto });
      } catch (e) {
        panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [e.message]) });
      }
    }
  });
}

// ---- Fiche image (clic sur une image de la barre « Revue SZH ») ---------------------
//
// Le clic sur une image ouvrait l'aperçu natif de VSCodium. Or ce qu'on vient faire sur
// une image d'article, c'est écrire sa LÉGENDE, son TEXTE ALTERNATIF et ses CRÉDITS —
// et ces données ne vivent pas dans le fichier image mais dans le TEXTE de l'article :
//     ![Légende](media/x.png){alt="…" copyright="…" source="…"}
// La fiche lit et réécrit donc cette référence, par les fonctions PURES de
// lib/references.js. L'aperçu natif reste à un clic (bouton « Ouvrir l'image »).
//
// Écriture : WorkspaceEdit + doc.save(), exactement comme supprimerAsset (C3) — le .md
// est souvent ouvert à l'écran, l'édition doit passer par le TAMPON pour rester
// annulable (Ctrl+Z) et ne pas écraser une frappe non enregistrée.
//
// Protocole (miroir de media/image-fiche.js) :
//   webview -> hôte : pret ; modifie { modifie } ; ouvrirImage ;
//                     enregistrer { valeurs } ; retourArticle { modifie, valeurs }
//   hôte -> webview : charger { nom, description, apercu, occurrences, valeurs, i18n } ;
//                     enregistre ; erreur { message }
//   valeurs = { legende, alt, altDefini, copyright, source }

// Formats affichables en data: URI dans la webview. Le SVG y est sûr : dans un <img>,
// il ne peut ni exécuter de script ni charger de ressource externe (et la CSP de la
// page reste default-src 'none' avec le seul img-src data:).
const MIMES_FICHE_IMAGE = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp'
};
// Au-delà, pas d'aperçu : une image de 30 Mo deviendrait 40 Mo de base64 dans un
// postMessage, pour un vignettage que personne ne réclame. La fiche le dit.
const TAILLE_MAX_APERCU_FICHE = 12 * 1024 * 1024;

function apercuFicheImage(chemin) {
  try {
    if (fs.statSync(chemin).size > TAILLE_MAX_APERCU_FICHE) { return null; }
    const ext = (chemin.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
    if (!MIMES_FICHE_IMAGE[ext]) { return null; }
    return 'data:' + MIMES_FICHE_IMAGE[ext] + ';base64,' + fs.readFileSync(chemin).toString('base64');
  } catch (e) { return null; }
}

function textesFicheImage() {
  return {
    legende: T('img.legende'), legendeIndice: T('img.legende.indice'), legendeAide: T('img.legende.aide'),
    roleTitre: T('img.role.titre'),
    roleDecrit: T('img.role.decrit'), roleDecritSous: T('img.role.decrit.sous'),
    roleDeco: T('img.role.deco'), roleDecoSous: T('img.role.deco.sous'),
    alt: T('img.alt'), altIndice: T('img.alt.indice'),
    altAide: T('img.alt.aide'), altAideDeco: T('img.alt.aide.deco'),
    copyright: T('img.copyright'), copyrightIndice: T('img.copyright.indice'),
    source: T('img.source'), sourceIndice: T('img.source.indice'),
    ouvrir: T('img.ouvrir'), ouvrirTip: T('img.tip.ouvrir'),
    retour: T('img.retour'), retourTip: T('img.tip.retour'),
    enregistrer: T('img.enregistrer'), enregistrerTip: T('img.tip.enregistrer'),
    enregistre: T('img.enregistre'), nonEnregistre: T('img.nonEnregistre'),
    occZero: T('img.occ.zero'), occPlusieurs: T('img.occ.plusieurs'),
    apercuAbsent: T('img.apercu.absent')
  };
}

function htmlFicheImage(nonce) {
  return construireHtml('image-fiche', nonce, {
    titre: T('img.titre', ['']),
    // Comme la modale photo (F3) : l'aperçu est une data: URI, localResourceRoots [].
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

let panneauxFicheImage = new Map();   // fsPath -> WebviewPanel (une fiche par image)

async function ouvrirFicheImage(fournisseur, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  const racine = fournisseur.racine;
  const chemin = item.cheminAsset;
  const nom = path.basename(chemin);
  // L'item d'arbre porte toujours son slug ; le repli sert aux appels programmés
  // (insertion d'une figure) faits depuis l'article courant.
  const slug = item.slug || apercuCourantSlug;
  if (!slug) { return; }
  const relatif = path.relative(path.join(racine, 'articles', slug, 'media'), chemin).replace(/\\/g, '/');
  const md = path.join(racine, 'articles', slug, slug + '.md');
  // Même posture que l'éditeur de tableau (F5/D89) : la fiche prend toute la place, on
  // ferme les aperçus d'abord — sinon la webview s'ouvre derrière un PDF.
  await fermerTousLesApercus();
  const existant = panneauxFicheImage.get(chemin);
  if (existant) { existant.reveal(vscode.ViewColumn.One); return; }
  const panneau = vscode.window.createWebviewPanel(
    'szhFicheImage', T('img.titre', [nom]), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauxFicheImage.set(chemin, panneau);
  panneau.onDidDispose(() => { if (panneauxFicheImage.get(chemin) === panneau) { panneauxFicheImage.delete(chemin); } });
  panneau.webview.html = htmlFicheImage(crypto.randomBytes(16).toString('hex'));

  // Le texte est lu par openTextDocument (le TAMPON, pas le disque) : une frappe non
  // enregistrée dans le .md est donc déjà visible ici, et l'écriture repartira du même
  // état — jamais d'écrasement d'une saisie en cours.
  const lire = async () => {
    try {
      const doc = await vscode.workspace.openTextDocument(md);
      return lireAttributsImage(doc.getText(), relatif);
    } catch (e) {
      return { legende: '', alt: '', altDefini: false, copyright: '', source: '', n: 0 };
    }
  };
  const charger = async () => {
    const v = await lire();
    repondrePanneau(panneau, {
      type: 'charger', nom: nom, description: decrireImage(chemin),
      apercu: apercuFicheImage(chemin), occurrences: v.n,
      valeurs: { legende: v.legende, alt: v.alt, altDefini: v.altDefini, copyright: v.copyright, source: v.source },
      i18n: textesFicheImage()
    });
  };
  // Écrit les valeurs dans TOUTES les insertions de l'image (une image n'a qu'un jeu de
  // crédits ; deux insertions divergentes donneraient deux légendes pour une figure).
  // Rend le nombre d'insertions écrites, ou -1 en cas d'échec (message déjà posé).
  const enregistrer = async (valeurs) => {
    let doc;
    try { doc = await vscode.workspace.openTextDocument(md); }
    catch (e) { repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [e.message]) }); return -1; }
    const res = ecrireAttributsImage(doc.getText(), relatif, valeurs || {});
    if (res.n === 0) {
      // Le .md a changé depuis l'ouverture (image retirée entre-temps) : rien à écrire.
      vscode.window.setStatusBarMessage(T('img.statut.sansref', [nom]), 5000);
      await charger();                               // la fiche se met en état « 0 insertion »
      return 0;
    }
    if (res.texte === doc.getText()) { return res.n; }   // rien n'a changé : pas d'édition inutile
    try {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), res.texte);
      if (!(await vscode.workspace.applyEdit(edition))) {
        repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [md]) });
        return -1;
      }
      await doc.save();                              // déclenche la recompilation (comme Ctrl+S)
    } catch (e) {
      repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [e.message]) });
      return -1;
    }
    return res.n;
  };

  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { await charger(); return; }
    if (msg.type === 'modifie') {
      panneau.title = (msg.modifie ? '● ' : '') + T('img.titre', [nom]);
      return;
    }
    if (msg.type === 'ouvrirImage') {
      // L'ancien comportement du clic dans l'arbre, gardé accessible : la visionneuse
      // native, en colonne 2 pour ne pas recouvrir la fiche.
      try {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(chemin),
          { viewColumn: vscode.ViewColumn.Two, preserveFocus: true });
      } catch (e) { /* fichier disparu : rien à montrer */ }
      return;
    }
    if (msg.type === 'enregistrer') {
      const n = await enregistrer(msg.valeurs);
      // L'accusé part TOUJOURS (même à 0 insertion réécrite) : sans lui, le verrou
      // « une écriture en vol » de l'auto-enregistrement ne serait jamais levé et
      // plus rien ne serait sauvegardé ensuite.
      repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto });
      if (n > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('img.statut.enregistree', [nom, n]), 5000); }
      return;
    }
    if (msg.type === 'retourArticle') {
      // Garde « non enregistré » (patron retourArticle de l'éditeur de tableau, D1).
      if (msg.modifie) {
        const choix = await vscode.window.showWarningMessage(
          T('img.quitter.question', [nom]), { modal: true, detail: T('table.quitter.detail') },
          T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
        if (choix === undefined) { return; }          // Annuler : on reste
        if (choix === T('form.enregistrer')) {
          const n = await enregistrer(msg.valeurs);
          if (n < 0) { return; }                      // échec d'écriture : on reste
          if (n > 0) { vscode.window.setStatusBarMessage(T('img.statut.enregistree', [nom, n]), 5000); }
        }
      }
      await ouvrirArticle(fournisseur, slug);
      panneau.dispose();
      return;
    }
  });
}

function activate(context) {
  const fournisseur = new FournisseurRevue();
  const vue = vscode.window.createTreeView(ID_VUE, {
    treeDataProvider: fournisseur,
    showCollapseAll: false,
    // F2 : déposer des .docx depuis l'Explorateur = « Importer des Word ».
    // rafraichirTout est défini plus bas -> indirection (jamais appelé avant
    // la fin de l'activation : un drop est forcément postérieur).
    dragAndDropController: controleurDepotVue(fournisseur, () => rafraichirTout())
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

  // Barre d'état du cycle de vie (D116) : n'apparaît que sur un numéro gelé, et le
  // clic mène au geste inverse (déverrouiller, ou désarchiver s'il n'est qu'archivé).
  // Priorité plus haute que l'aperçu : c'est l'information qui explique pourquoi
  // l'éditeur ne répond plus aux frappes.
  const barreEtat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
  context.subscriptions.push(barreEtat);
  const majBarreApercu = () => {
    barreApercu.text = T(modeApercu() === 'html' ? 'apercu.barre.html' : 'apercu.barre.pdf');
    barreApercu.tooltip = T('apercu.barre.tooltip');
    if (fournisseur.racine) { barreApercu.show(); } else { barreApercu.hide(); }
  };

  // Le compte « Word en attente » est recalculé par getChildren (description de
  // section) ; le TITRE de la vue reflète le numéro (N2, D43) à chaque
  // rafraîchissement ; l'aperçu HTML est rechargé si sa sortie a été régénérée (M5).
  const rafraichirTout = () => {
    // D116 : l'état du numéro AVANT tout le reste — le titre de la vue et les boutons
    // de l'arbre en dépendent (et ausgabe.yaml est déjà surveillé, N2).
    majEtatNumero(fournisseur, barreEtat);
    fournisseur.rafraichir();
    vue.title = fournisseur.racine ? titreVue(fournisseur.racine) : T('arbre.titre.defaut');
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
    divergenceSignalee = false;                    // D120 : un avertissement par revue ouverte
    profilRevue = lireProfil(racine);            // T6.4 : pilote le mode d'aperçu
    vscode.commands.executeCommand('setContext', CLE_CONTEXTE, !!racine);
    reinstallerWatchers(racine);
    if (racine) { demarrerDormeurWsl(); } else { arreterDormeurWsl(); }   // N1 (D42)
    rafraichirTout();
  };

  // D116 — deux fabriques de commandes : `cmd` pour ce qui LIT (ouvrir un article,
  // basculer l'aperçu, exporter) et `cmdEcriture` pour ce qui MODIFIE le numéro,
  // refusé net sur un numéro verrouillé. La liste ci-dessous montre donc d'un coup
  // d'œil ce que le verrou protège, au lieu d'un `if` répété dans chaque fonction.
  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  const cmdEcriture = (id, fn) => vscode.commands.registerCommand(id, function () {
    if (refuserSiVerrouille()) { return undefined; }
    return fn.apply(null, arguments);
  });

  context.subscriptions.push(
    cmd('szh.cockpit.rafraichir', majContexte),
    cmdEcriture('szh.metadonnees', () => ouvrirMetadonnees(fournisseur, rafraichirTout)),
    cmdEcriture('szh.apercuMetadonnees', () => ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null)),
    // D97 : le MÊME formulaire, filtré sur un article (icône ✎ de l'arbre, ou entrée
    // « Métadonnées de l'article courant » du panneau d'édition, sans argument).
    cmdEcriture('szh.metadonneesArticle', (item) => ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item)),
    // D113 : section « Traductions » — clic sur un article (ou sur un de ses champs)
    // et bouton « tout marquer prêt pour traduction » de la barre de section.
    cmdEcriture('szh.traduction', (item) => ouvrirTraduction(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.traductionsToutPret', () => marquerToutPretTraduction(fournisseur, rafraichirTout)),
    cmd('szh.reglages', () => ouvrirReglages(rafraichirTout)),
    cmd('szh.basculerApercu', () => basculerApercu(fournisseur, majBarreApercu)),
    cmdEcriture('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    cmdEcriture('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    // Les exports RESTENT ouverts sur un numéro gelé : c'est la contrepartie de la
    // suppression des documents à l'archivage (« vous pourrez toujours réexporter »).
    cmd('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    cmd('szh.exporterXml', () => exporterXml(fournisseur, rafraichirTout)),
    cmd('szh.exporterArticle', (item) => exporterArticle(fournisseur, rafraichirTout, item)),
    // D116 : le cycle de vie du numéro. « Archiver et verrouiller » n'est pas une
    // écriture ordinaire — c'est LUI qui pose le verrou ; « Déverrouiller » est le
    // seul geste qui doit rester possible quand tout le reste est refusé.
    cmd('szh.archiverVerrouiller', () => archiverEtVerrouiller(fournisseur, rafraichirTout)),
    cmd('szh.deverrouiller', () => deverrouiller(fournisseur, rafraichirTout)),
    cmd('szh.desarchiver', () => desarchiver(fournisseur, rafraichirTout)),
    cmd('szh.ouvrirArticle', (slug) => ouvrirArticle(fournisseur, slug)),
    cmdEcriture('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.remplacerAsset', (item) => remplacerAsset(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.remplacerTable', (item) => remplacerTable(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.supprimerAsset', (item) => supprimerAsset(fournisseur, rafraichirTout, item, false)),
    cmdEcriture('szh.supprimerTable', (item) => supprimerAsset(fournisseur, rafraichirTout, item, true)),
    cmdEcriture('szh.editerTable', (item) => ouvrirEditeurTable(fournisseur, item)),
    cmdEcriture('szh.ficheImage', (item) => ouvrirFicheImage(fournisseur, item)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte),
    // D120 — l'avertissement de divergence de version se déclenche au DÉMARRAGE d'une
    // tâche de compilation, pas dans les fonctions du cockpit : le chemin le plus
    // fréquent (Ctrl+S -> triggerTaskOnSave -> tâche utilisateur) ne passe pas par
    // nous. Un seul point d'accroche pour tous les chemins, et une seule fois par
    // fenêtre (garde dans avertirVersionSiDivergente).
    vscode.tasks.onDidStartTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      const nomsSuivis = [NOM_TACHE_BUILD, NOM_TACHE_EXPORT, NOM_TACHE_IMPORT, NOM_TACHE_DOCX];
      const estNotre = (tache.definition && tache.definition.type === 'szh');
      if (nomsSuivis.indexOf(tache.name) === -1 && !estNotre) { return; }
      avertirVersionSiDivergente();
    }),
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
    rafraichirTout: rafraichirTout,
    // D116 : toute la mise en forme écrit dans le texte -> refusée sur un numéro gelé.
    verrouillee: () => etatCourant().verrouillee,
    refuser: () => { refuserSiVerrouille(); }
  });

  // F1 — les trois panneaux de la barre (Commande / Édition / Export) : la barre de
  // titre de la vue ne porte plus que ces trois boutons, le reste passe par eux
  // (les commandes individuelles restent enregistrées — filet Ctrl+Maj+P).
  // D116 : le panneau d'export n'affiche que les gestes de cycle de vie que l'état
  // du numéro rend possibles — d'où l'injection de l'état.
  enregistrerPanneaux(context, { etat: etatCourant });

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
    nettoyerCarte, assainirCheminPhoto, decomposerPhoto, relatifImageValide,
    analyserTraduction, serialiserTraduction, lignesTraduction, resumeTraduction,
    versionsDivergent, poidsLisible,
    texteChamp, valeurChamp,
    retirerImage, retirerTable, lireAttributsImage, ecrireAttributsImage,
    basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
    enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, nomTableLibre,
    slugifier, slugifierArticle,
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
