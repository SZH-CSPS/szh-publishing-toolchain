// Extension « Revue SZH » : la barre latérale du cockpit dans l'Explorateur de VSCodium
// (articles, Word en attente, traductions) et les commandes associées. La vue n'apparaît
// que si ausgabe.yaml existe à la racine (clé de contexte szh.estRevue).
//
// Sans build : les require sont résolus à l'exécution, donc lib/ et media/ doivent
// rester empaquetés (voir .vscodeignore). Ici, activate/deactivate, le câblage des
// commandes et l'agrégat _pur exposé aux tests. Une webview ne reçoit aucune donnée dans
// son HTML : tout arrive par postMessage, et les libellés y sont des marqueurs
// %%SZH:cle%% résolus par T().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CLE_CONTEXTE = 'szh.estRevue';
// L'état du numéro en clés de contexte : c'est ce que lisent les `when` de package.json.
const CLE_VERROUILLEE = 'szh.verrouillee';
const CLE_ARCHIVEE = 'szh.archivee';
const ID_VUE = 'szhCockpitVue';
// À garder identiques aux labels de vscodium-user/tasks.json, qui les nomme.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const CLE_TUTORIEL_VU = 'szh.tutoriel.propose';   // invitation au tutoriel : une seule fois
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const NOM_TACHE_EXPORT = 'Tout exporter';
const NOM_TACHE_DOCX = 'Galleys DOCX (OJS)';
// À garder alignés avec vscodium-user/tasks.json, lib/wsl.js et lib/portraits.js.
const DISTRO_WSL = 'SZH-Publishing';
const MAKEFILE_WSL = '/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile';
// Le réimport d'un article corrigé. Seul maillon que le cockpit appelle sans passer par
// une tâche : il rend une ligne JSON qu'il faut lire, et une tâche n'en rapporte rien.
const REIMPORTER_WSL = '/mnt/c/ProgramData/SZH/toolkit/pipeline/reimporter.py';

// ---- i18n du cockpit -> lib/i18n.js ----------------------------------------------
const { TEXTES_COCKPIT, T, TL, langueCockpit } = require('./lib/i18n');
// ---- Sérialiseurs YAML -> lib/yaml.js --------------------------------------------
const {
  CLES_METADONNEES, COULEURS_NUMERO, HEX_COULEURS, normaliserRevue, estVraiYaml,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, serialiserAusgabe, ecrireAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, langueDefaut, titreNumero, etatRevue, normaliserLangueArticle,
  LICENCE_DEFAUT, LICENCES_ARTICLE, normaliserLicence, REVUES
} = require('./lib/yaml');
// ---- Bibliographie et appels de citation -> lib/citations.js ---------------------
const {
  configBiblio, configAvecTitresBiblio, nomFichierBiblio, cheminBiblio,
  REVUES_BIBLIO, LANGUES_BIBLIO
} = require('./lib/citations');
// ---- Cycle de vie du numéro -> lib/archivage.js ----------------------------------
const {
  versionInstallee, versionsDivergent, tailleDossier, supprimerDossier,
  lancerArchivage, lancerChoixVersion, adresseMailTraduction,
  lireModeDeveloppeur, ecrireModeDeveloppeur, lireConfigPoste, ecrireConfigPoste,
  CONFIG_POSTE, FORME_MAIL
} = require('./lib/archivage');
// ---- Auteur·e·s publiés (OAI-PMH) -> lib/auteurs-ojs.js ---------------------------
const {
  lireCache: lireCacheAuteursPublies, rafraichir: rafraichirCacheAuteursPublies
} = require('./lib/auteurs-ojs');
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
const { demarrerDormeurWsl, arreterDormeurWsl, reveillerWsl, cheminWsl } = require('./lib/wsl');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, nomTableLibre,
  enregistrerCommandesMiseEnForme
} = require('./lib/formatting');
// ---- Liens profonds « szh:// » -> lib/liens.js ; lecture seule -> lib/verrou.js --
const { appliquerVerrou } = require('./lib/verrou');
const { construireLienTraduction, consommerIntention } = require('./lib/liens');
const { enregistrerPanneaux } = require('./lib/panneaux');
// ---- Garde d'interaction -> lib/interaction.js ------------------------------------
// Un QuickPick de VS Code se ferme dès que le focus bouge ; la fin d'une compilation
// (réassignation du HTML de l'aperçu, notification des contrôles) ne doit pas interrompre
// le geste en cours. sousGarde enveloppe les choix, differer retient ce qui volerait le
// focus et le rejoue à la fermeture. Instance partagée avec panneaux.js et formatting.js.
const { sousGarde, differer } = require('./lib/interaction');
const {
  genererExportOjs, configOjs, ecrireConfigOjs, doiCalcule, typeSansDoi,
  CHAMPS_REVUE, LOCALES_REVUE, RUBRIQUES_DEFAUT
} = require('./lib/export-ojs');
const {
  retirerImage, retirerTable, ordreImages, lireAttributsImage, ecrireAttributsImage,
  placeFigure, envelopperFigure, imagesSansAlternative
} = require('./lib/references');
const { traiterPortraits } = require('./lib/portraits');
// ---- Journal de compilation -> lib/journal.js ------------------------------------
const {
  analyserJournal, phraseConstat, resumeJournal, citationsParArticle,
  constatsReimport, tonResultatReimport
} = require('./lib/journal');
// ---- JPEG CMJN -> RVB -> lib/cmyk.js ---------------------------------------------
const { convertirCmykEnRgb, estJpegCmyk } = require('./lib/cmyk');
// ---- Seuils de qualité des images -> lib/qualite-image.js ------------------------
const { qualiteImage } = require('./lib/qualite-image');
// ---- Suivi de traduction -> lib/traduction.js ------------------------------------
const {
  CHAMPS_TRADUISIBLES, STATUTS, STATUT_DEFAUT,
  cleChamp, statutValide, analyserTraduction, serialiserTraduction,
  texteChamp, listeChamp, valeurChamp, alignerMotsCles, estATraduire, MARQUE_A_TRADUIRE,
  lignesTraduction, groupesTraduction, resumeTraduction
} = require('./lib/traduction');
// ---- Ordre, noms et tâches des articles -> lib/articles.js ---------------------
const {
  CLE_ORDRE, CLE_SANS_DOI, ordonnerArticles, deplacerArticle, prefixeOrdre, titreFiche,
  libelleArticle, analyserSansDoi, basculerSansDoi, trierParDoi, refusDeplacement,
  rangDoi, resumeImages,
  REVUES_TACHES, tachesRevue, tachesConfig, configAvecTaches, libelleTache,
  analyserTachesFaites, serialiserTachesFaites, resumeTaches, basculerTache,
  NOMS_COUVERTURE, EXTENSIONS_COUVERTURE, nomCouverture, MAX_COUVERTURE
} = require('./lib/articles');

const VUE_PDF = 'pdf.preview';
const EXT_PDF = 'tomoki1207.pdf';

// Premier dossier du workspace contenant ausgabe.yaml, ou null : la vue reste masquée.
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

// ---- Cycle de vie du numéro : verrou, archive, version du logiciel ---------------
// L'état vit dans ausgabe.yaml (lib/yaml.js : etatRevue) et non sur le poste. Relu à
// chaque rafraîchissement, il alimente les clés de contexte szh.verrouillee /
// szh.archivee, la barre d'état, le titre de la vue et les gardes de commandes.
// La lecture seule de l'éditeur passe par `files.readonlyInclude` dans
// <revue>/.vscode/settings.json, écrit directement par fs et non par l'API de
// configuration, sinon le verrou verrouille son propre interrupteur. Dans le dossier,
// ce réglage voyage avec lui sans atteindre les autres fenêtres.
let etatNumero = { verrouillee: false, archivee: false, versionToolkit: '' };
let verrouApplique = null;   // évite de réécrire settings.json à chaque rafraîchissement
let racineVerrou = null;
let divergenceSignalee = false;   // une fois par fenêtre : chaque Ctrl+S compile

function etatCourant() { return etatNumero; }

// Numéro « gelé », archivé ou verrouillé : plus de compilation automatique. L'export à
// la demande reste possible, puisque l'archivage supprime out/.
function compilationAutoCoupee() {
  return etatNumero.archivee || etatNumero.verrouillee;
}

// ⚠ EXCEPTION AU VERROU, et elle est voulue : l'ORDRE des articles n'est gelé que par
// l'ARCHIVAGE, pas par le verrou. Un numéro verrouillé a ses TEXTES figés — c'est ce que
// `locked` protège — mais sa SÉQUENCE peut encore se décider : on verrouille la copie,
// puis on arrête le sommaire. Un numéro archivé, lui, est terminé, et son ordre décide des
// DOI déjà déposés : plus rien ne bouge.
//
// Ne pas « réparer » cette garde en y remettant refuserSiVerrouille() : l'ordre redeviendrait
// figé trop tôt, et le sommaire ne se déciderait plus. Deux contrôles la tiennent, dont un
// qui vérifie qu'un numéro verrouillé mais NON archivé accepte encore un déplacement.
//
// Noter que désarchiver ne déverrouille pas : un numéro sorti des archives redevient donc
// réordonnable tout en restant verrouillé, ce qui est exactement le geste attendu.
function refuserSiArchivee() {
  if (!etatNumero.archivee) { return false; }
  const bouton = T('art.ordre.archive.bouton');
  vscode.window.showWarningMessage(T('art.ordre.archive'), bouton).then((choix) => {
    if (choix === bouton) { vscode.commands.executeCommand('szh.desarchiver'); }
  });
  return true;
}

// Garde d'écriture : true = refusé, l'appelant sort. Le refus est toujours affiché.
function refuserSiVerrouille() {
  if (!etatNumero.verrouillee) { return false; }
  const bouton = T('verrou.refuse.bouton');
  vscode.window.showWarningMessage(T('verrou.refuse'), bouton).then((choix) => {
    if (choix === bouton) { vscode.commands.executeCommand('szh.deverrouiller'); }
  });
  return true;
}

// Le sérialiseur du formulaire préserve les lignes non gérées. null si tout est écrit.
function ecrireClesAusgabe(racine, modifies) {
  const chemin = path.join(racine, 'ausgabe.yaml');
  try {
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
    ecrireAtomique(chemin, serialiserAusgabe(contenu, modifies));
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

function majEtatNumero(fournisseur, barreEtat) {
  const racine = fournisseur.racine;
  etatNumero = racine ? etatRevue(racine)
                      : { verrouillee: false, archivee: false, versionToolkit: '' };
  vscode.commands.executeCommand('setContext', CLE_VERROUILLEE, etatNumero.verrouillee);
  vscode.commands.executeCommand('setContext', CLE_ARCHIVEE, etatNumero.archivee);
  if (barreEtat) { majBarreEtatNumero(barreEtat); }
  // Le verrou suit le fichier, même édité à la main ou synchronisé par OneDrive.
  if (racine && (racineVerrou !== racine || verrouApplique !== etatNumero.verrouillee)) {
    racineVerrou = racine;
    verrouApplique = etatNumero.verrouillee;
    const erreurVerrou = appliquerVerrou(racine, etatNumero.verrouillee);
    if (erreurVerrou) { vscode.window.showWarningMessage(T('err.verrou.reglages', [erreurVerrou])); }
  }
}

// Visible seulement sur un numéro gelé ; le clic mène au geste inverse.
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

function titreVue(racine) {
  const base = titreNumero(racine);
  if (etatNumero.verrouillee && etatNumero.archivee) { return T('arbre.titre.archiveeVerrouillee', [base]); }
  if (etatNumero.verrouillee) { return T('arbre.titre.verrouillee', [base]); }
  if (etatNumero.archivee) { return T('arbre.titre.archivee', [base]); }
  return base;
}

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

// szh.replierAssetsAutres (défaut true) : au clic, les assets de l'article se déplient
// et ceux des autres se replient.
// Réglage szh.convertirCmyk, coché par défaut : un JPEG CMJN ne s'affiche correctement ni
// dans un navigateur ni dans WeasyPrint, et le défaut ne se voit qu'au PDF. La conversion
// reste débranchable, la chaîne de portraits n'étant pas disponible partout.
function convertirCmykActif() {
  try { return vscode.workspace.getConfiguration('szh').get('convertirCmyk', true) !== false; }
  catch (e) { return true; }
}

// Réglage szh.reduireWarningsImpression, décoché par défaut : activé, le palier
// « conseillé » des avertissements de résolution se tait — seule une image sous le
// minimum reste signalée. Le CMJN n'est pas concerné.
function reduireWarningsImpressionActif() {
  try { return vscode.workspace.getConfiguration('szh').get('reduireWarningsImpression', false) === true; }
  catch (e) { return false; }
}

// Convertit en RVB les JPEG CMJN de la liste. Silencieux quand il n'y a rien à faire ;
// un échec est signalé mais ne bloque rien, le fichier restant lisible tel quel.
// -> Promise<nombre de fichiers convertis>
async function convertirCmykSiBesoin(chemins) {
  if (!convertirCmykActif()) { return 0; }
  const candidats = (Array.isArray(chemins) ? chemins : []).filter((c) => c && estJpegCmyk(c));
  if (candidats.length === 0) { return 0; }
  let resultats;
  try {
    resultats = await convertirCmykEnRgb({ chemins: candidats });
  } catch (e) {
    vscode.window.showWarningMessage(T(e && e.wsl ? 'cmyk.err.wsl' : 'cmyk.err', [e.message]));
    return 0;
  }
  const convertis = resultats.filter((r) => r && r.converti);
  const rates = resultats.filter((r) => r && !r.ok);
  if (rates.length > 0) {
    vscode.window.showWarningMessage(T('cmyk.err', [String(rates[0].erreur || '?')]));
  }
  if (convertis.length > 0) {
    vscode.window.setStatusBarMessage(T('cmyk.statut', [convertis.length]), 5000);
  }
  return convertis.length;
}

function replierAssetsAutres() {
  try { return vscode.workspace.getConfiguration('szh').get('replierAssetsAutres', true) !== false; }
  catch (e) { return true; }                       // configuration indisponible
}

// Sections dont l'onglet ouvre une vue d'ensemble.
const COMMANDES_SECTION = {
  articles: 'szh.vueArticles', traductions: 'szh.vueTraductions', word: 'szh.vueWord'
};

// Une couleur par en-tête de section : le TreeView natif n'offre ni gras ni taille de
// police, ce sont donc les majuscules du libellé et la couleur de l'icône qui rendent les
// trois sections repérables. Bleu et vert sont ceux des états de traduction
// (COULEURS_STATUT) ; pour « Word en attente », l'ambre d'avertissement de l'éditeur
// plutôt que « charts.orange », trop clair sur fond blanc — même choix que COULEURS_STATUT.
const COULEURS_SECTION = {
  articles: 'charts.blue',
  traductions: 'charts.green',
  word: 'editorWarning.foreground'
};

// L'icône d'un article dans l'arbre : son avancement, en trois états lisibles d'un coup
// d'œil. Le langage visuel est celui des états de traduction (iconeStatut) : cercle vide =
// rien de commencé, plein et bleu = en cours, coche verte = tout est fait. Un article sans
// tâches configurées reste au cercle vide : il n'a rien à raconter.
function iconeAvancement(avance) {
  if (avance.total > 0 && avance.faites >= avance.total) {
    return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
  }
  if (avance.total > 0 && avance.faites > 0) {
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
  }
  return new vscode.ThemeIcon('circle-large-outline');
}

// ---- Ordre du numéro, nom des articles, tâches, couverture ----------------------
//
// L'ordre des articles vit dans ausgabe.yaml (clé `ordre-articles`, lib/articles.js) et
// non dans les noms de dossier : déplacer un article ne renomme ni le dossier ni son .md,
// donc out/ reste valable et les liens du numéro tiennent. Il est relu à chaque appel —
// ausgabe.yaml fait quinze lignes — et réparé de ce que le disque dit, mais jamais réécrit
// au passage : réécrire à chaque rafraîchissement de l'arbre réveillerait le surveillant de
// fichiers en boucle. La clé n'est écrite que par un geste de l'utilisateur.

function valeurOrdreArticles(racine) {
  try {
    return analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'))[CLE_ORDRE] || '';
  } catch (e) { return ''; }
}

// Les articles que la rédaction a cochés « pas de DOI ». Ils vivent dans le fichier du
// numéro, à côté de l'ordre, et c'est cette liste qui les range en fin de numéro : le rang
// décide du DOI, donc l'un ne peut pas se lire sans l'autre.
function slugsSansDoiVoulu(racine) {
  try {
    return analyserSansDoi(
      analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'))[CLE_SANS_DOI] || '');
  } catch (e) { return []; }
}

// Le jeu complet de ceux qui ne reçoivent PAS de DOI : la case cochée, et la rubrique qui
// n'en reçoit jamais — Documentation sur l'instance réelle. Le second se lit dans le type
// de la fiche, d'où une lecture par article.
//
// C'est ce jeu, et lui seul, qui décide du compteur du DOI : le compteur ne compte que les
// porteurs, si bien qu'il reste contigu — 00, 01, 02… — quoi qu'on fasse des autres.
//
// `opts.types`  slug -> type déjà lu, pour ne pas relire les fiches que l'appelant a en main
// `opts.voulus` la liste des cases cochées à employer, au lieu de celle du fichier : c'est
//               ce qui permet de calculer le jeu d'APRÈS une bascule, avant de l'écrire.
function articlesSansDoi(racine, slugs, opts) {
  const o = opts || {};
  const jeu = new Set(o.voulus || slugsSansDoiVoulu(racine));
  if (!slugs || slugs.length === 0) { return jeu; }
  const cfg = configOjs();
  for (const slug of (slugs || [])) {
    if (jeu.has(slug)) { continue; }
    const type = (o.types && o.types[slug] !== undefined)
      ? o.types[slug]
      : lireMetaArticle(racine, slug).type;
    if (typeSansDoi(cfg, type)) { jeu.add(slug); }
  }
  return jeu;
}

// Jeton de revue du numéro, ou '' : il choisit le jeu de tâches et la langue de l'e-mail.
function revueNumero(racine) {
  try {
    return normaliserRevue(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).revue);
  } catch (e) { return ''; }
}

// Le nom d'un article dans l'interface : « 03 · Titre », le titre venant de sa fiche. Sans
// fiche ou sans titre, le slug reprend sa place : l'article doit rester visible et
// repérable, jamais disparaître.
function nomArticle(racine, slug, index, langue) {
  return libelleArticle(index, slug, titreFiche(lireMetaArticle(racine, slug), langue));
}

// ---- Tâches d'un article : le sidecar <slug>.taches.yaml ------------------------
// Même partage que le suivi de traduction juste à côté : les intitulés sont un réglage de
// revue (config.json), l'état coché part avec l'article et n'est ni publié ni exporté.
function cheminTaches(racine, slug) {
  return path.join(racine, 'articles', slug, slug + '.taches.yaml');
}

function lireTachesArticle(racine, slug) {
  try { return analyserTachesFaites(fs.readFileSync(cheminTaches(racine, slug), 'utf8')); }
  catch (e) { return analyserTachesFaites(''); }
}

// Supprimé quand il ne reste rien à retenir : un article dont on décoche tout ne laisse pas
// de résidu dans son dossier.
function ecrireTachesArticle(racine, slug, valeurs) {
  const chemin = cheminTaches(racine, slug);
  const contenu = serialiserTachesFaites(valeurs);
  if (contenu === '') {
    try { if (fs.existsSync(chemin)) { fs.unlinkSync(chemin); } } catch (e) { /* déjà parti */ }
    return;
  }
  ecrireAtomique(chemin, contenu);
}

function tachesDuNumero(racine) {
  return tachesRevue(lireConfigPoste(), revueNumero(racine));
}

function avancementTaches(racine, slug, taches) {
  return resumeTaches(taches, lireTachesArticle(racine, slug).faites);
}

// ---- Couverture du numéro -------------------------------------------------------
//
// couverture.jpg à la racine du numéro : c'est ce fichier que l'export OJS cherche, sous
// l'un des noms de NOMS_COUVERTURE, et aucune interface ne le nommait — tous les numéros
// partaient donc sans couverture.
function couvertureNumero(racine) {
  for (const nom of NOMS_COUVERTURE) {
    const chemin = path.join(racine, nom);
    try {
      const st = fs.statSync(chemin);
      if (st.isFile()) { return { nom: nom, chemin: chemin, taille: st.size }; }
    } catch (e) { /* nom suivant */ }
  }
  return null;
}

// L'aperçu voyage en data: dans le postMessage : c'est la seule voie, la webview n'ayant
// aucune racine locale autorisée (localResourceRoots: []). Au-delà de ce poids, on montre
// le nom et le poids sans l'image plutôt que de faire passer huit mégaoctets de base64.
const MAX_APERCU_COUVERTURE = 6 * 1024 * 1024;

function chargeCouverture(racine) {
  const trouvee = couvertureNumero(racine);
  if (!trouvee) { return { nom: '', description: '', apercu: null }; }
  let apercu = null;
  if (trouvee.taille <= MAX_APERCU_COUVERTURE) {
    try {
      const mime = /\.png$/i.test(trouvee.nom) ? 'image/png' : 'image/jpeg';
      apercu = 'data:' + mime + ';base64,' + fs.readFileSync(trouvee.chemin).toString('base64');
    } catch (e) { apercu = null; }
  }
  return { nom: trouvee.nom, description: poidsLisible(trouvee.taille), apercu: apercu };
}

// -> null, ou le message de l'échec. Format et poids sont revérifiés ici : ce qui vient
// d'une webview n'est jamais cru sur parole.
function ecrireCouverture(racine, nomFichier, donneesBase64) {
  const nom = nomCouverture(nomFichier);
  if (nom === '') { return T('art.couverture.format'); }
  let donnees;
  try { donnees = Buffer.from(String(donneesBase64 || ''), 'base64'); }
  catch (e) { return T('art.couverture.format'); }
  if (donnees.length === 0) { return T('art.couverture.format'); }
  if (donnees.length > MAX_COUVERTURE) { return T('art.couverture.poids'); }
  const cible = path.join(racine, nom);
  try {
    const tmp = path.join(racine, '~$' + nom);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
  } catch (e) { return T('err.ecriture', [String((e && e.message) || e)]); }
  // Une seule couverture par numéro : les autres noms que l'export essaie sont retirés,
  // sans quoi il prendrait le premier de sa liste et non celui qu'on vient de déposer.
  for (const autre of NOMS_COUVERTURE) {
    if (autre === nom) { continue; }
    try {
      const c = path.join(racine, autre);
      if (fs.existsSync(c)) { fs.unlinkSync(c); }
    } catch (e) { /* verrouillé : le nom affiché dira lequel l'export voit */ }
  }
  return null;
}

// ---- Formulaire du numéro : une seule charge utile, une seule écriture ----------
//
// La page « Méta-données du numéro » et la vue « Articles » montrent le même formulaire
// (SZH.formulaireNumero, media/_numero.js). Elles lisent et écrivent donc par ici, et non
// chacune de son côté : un champ ajouté à la table du fragment n'a pas deux écritures à
// suivre.
const LIBELLES_NUMERO = ['meta.title', 'meta.revue', 'meta.revue.zeitschrift', 'meta.revue.revue',
  'meta.volume', 'meta.numero', 'meta.date', 'meta.langue', 'meta.langue.aucune',
  'meta.langue.fr', 'meta.langue.de', 'meta.langue.en', 'meta.langue.it',
  'meta.couleur', 'meta.entete.condensee'];

function textesNumero() {
  const libelles = {};
  for (const cle of LIBELLES_NUMERO) { libelles[cle] = T(cle); }
  return {
    libelles: libelles,
    indiceDate: T('meta.date.indice'),
    rien: T('form.rien'),
    enregistre: T('form.enregistre'),
    couleurAucune: T('meta.couleur.aucune'),
    couleurs: COULEURS_NUMERO.map((c) => ({ hex: c.hex, nom: T('meta.couleur.' + c.cle) })),
    couverture: T('art.couverture'),
    couvertureAbsente: T('art.couverture.absente'),
    couvertureDeposer: T('art.couverture.deposer'),
    couvertureChoisir: T('art.couverture.choisir'),
    couvertureFormat: T('art.couverture.format'),
    couverturePoids: T('art.couverture.poids'),
    couvertureAgrandir: T('art.couverture.agrandir'),
    couvertureApercuAbsent: T('art.couverture.apercu.absent'),
    couvertureFermer: T('art.couverture.fermer'),
    couvertureEnregistree: T('art.couverture.enregistree'),
    // Formats et poids acceptés : ceux de lib/articles.js, et non une seconde liste écrite
    // dans la webview. Elle s'en sert pour refuser tout de suite ; l'hôte les revérifie.
    couvertureExtensions: Object.keys(EXTENSIONS_COUVERTURE),
    couvertureMax: MAX_COUVERTURE
  };
}

// `avecCouverture` : l'aperçu de la couverture pèse plusieurs mégaoctets en base64. Il
// part au premier chargement, et non à chaque re-rendu d'une vue — un clic « Monter » ou
// une case cochée n'a aucune raison de le renvoyer.
function chargeNumero(racine, avecCouverture) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* fichier illisible : formulaire vide */ }
  // Booléen déjà tranché : la liste des valeurs vraies tolérées vit dans lib/yaml.js.
  valeurs['entete-condensee'] = estVraiYaml(valeurs['entete-condensee']) ? 'true' : 'false';
  const charge = { valeurs: valeurs };
  if (avecCouverture) { charge.couverture = chargeCouverture(racine); }
  return charge;
}

// Seuls les champs modifiés arrivent : une valeur que le formulaire n'a pas su afficher,
// comme « 2026 » dans un type=date, n'est pas écrasée. -> null, ou le message de l'échec ;
// null aussi quand il n'y avait rien de recevable à écrire.
function ecrireChampsNumero(racine, brut) {
  const modifies = {};
  for (const cle of CLES_METADONNEES) {
    if (brut && typeof brut[cle] === 'string') {
      modifies[cle] = brut[cle].replace(/[\r\n]+/g, ' ').slice(0, 500).trim();
    }
  }
  // Vide (« aucune ») ou un hex de la palette ; toute autre valeur est ignorée.
  if ('couleur' in modifies) {
    const c = modifies.couleur.toUpperCase();
    if (c !== '' && HEX_COULEURS.indexOf(c) === -1) { delete modifies.couleur; }
    else { modifies.couleur = c; }
  }
  // Seul le jeton canonique zeitschrift/revue est accepté.
  if ('revue' in modifies) {
    const r = normaliserRevue(modifies.revue);
    if (r === '') { delete modifies.revue; } else { modifies.revue = r; }
  }
  // La case à cocher n'envoie que « true » ou « false » ; le reste est ignoré.
  if ('entete-condensee' in modifies) {
    const e = modifies['entete-condensee'].toLowerCase();
    if (e !== 'true' && e !== 'false') { delete modifies['entete-condensee']; }
    else { modifies['entete-condensee'] = e; }
  }
  // L'ordre des articles ne se saisit pas au clavier : il ne passe pas par ce formulaire.
  delete modifies[CLE_ORDRE];
  if (Object.keys(modifies).length === 0) { return null; }
  return ecrireClesAusgabe(racine, modifies);
}

// Les messages du formulaire du numéro, traités à l'identique dans les deux panneaux qui le
// portent. -> true quand le message a été traité.
function messageNumero(panneau, racine, msg, rafraichirTout) {
  if (msg.type === 'enregistrer') {
    // Le verrou du numéro couvre aussi ce formulaire. Le refus part dans la zone d'état du
    // formulaire, et non en fenêtre : l'enregistrement est automatique, et une fenêtre
    // toutes les trois secondes serait pire que le refus lui-même. La commande de la page
    // dédiée est en plus gardée à l'ouverture (cmdEcriture) ; la vue « Articles »,
    // consultable sur un numéro gelé, ne l'est pas.
    if (etatNumero.verrouillee) {
      repondrePanneau(panneau, { type: 'erreur', message: T('verrou.refuse') });
      return true;
    }
    const erreur = ecrireChampsNumero(racine, msg.modifies);
    if (erreur) {
      repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [erreur]) });
      return true;
    }
    repondrePanneau(panneau, { type: 'enregistre' });
    vscode.window.setStatusBarMessage(T('statut.ausgabe'), 3000);
    if (rafraichirTout) { rafraichirTout(); }      // met le titre de la vue à jour
    return true;
  }
  if (msg.type === 'couverture-deposer') {
    if (refuserSiVerrouille()) { return true; }
    const erreur = ecrireCouverture(racine, String(msg.nomFichier || ''), msg.donneesBase64);
    if (erreur) {
      repondrePanneau(panneau, { type: 'erreur', message: erreur });
      return true;
    }
    repondrePanneau(panneau, Object.assign({ type: 'couverture' }, chargeCouverture(racine)));
    vscode.window.setStatusBarMessage(T('art.couverture.enregistree'), 3000);
    return true;
  }
  return false;
}

class FournisseurRevue {
  constructor() {
    this.racine = null;
    this.slugDeploye = null;   // article dont les assets sont dépliés
    this._changement = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changement.event;
  }

  definirRacine(racine) { this.racine = racine; }
  rafraichir() { this._changement.fire(); }

  // true si l'état a changé : recliquer le même article ne reconstruit pas la vue.
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
      const n = this.compterWord();   // le badge de conteneur ne s'affiche pas ici
      // « Traductions » arrive repliée : elle double la liste des articles.
      const t = this.compterTraductions();
      // L'ordre suit le travail : les articles du numéro, leurs traductions, puis ce qui
      // attend encore d'y entrer. Les sections n'ont pas d'`id` : VS Code les reconnaît à
      // leur libellé, l'ordre peut donc changer sans figer l'état plié/déplié mémorisé.
      return [
        this._section('articles', T('arbre.articles'), 'book', undefined),
        this._section('traductions', T('arbre.traductions'), 'globe',
          t.total > 0 ? '(' + t.finalises + '/' + t.total + ')' : undefined, true),
        this._section('word', T('arbre.word'), 'inbox', n > 0 ? '(' + n + ')' : undefined)
      ];
    }
    if (element.categorie === 'articles') { return this._itemsArticles(); }
    if (element.categorie === 'word') { return this._itemsWord(); }
    if (element.categorie === 'traductions') { return this._itemsTraductions(); }
    if (element.contextValue === 'article') { return this._itemsTables(element.slug); }
    if (element.contextValue === 'traduction-article') { return this._itemsChampsTraduction(element.slug); }
    return [];
  }

  // Cliquer l'onglet ouvre la vue d'ensemble de la section : ses commandes globales y ont
  // un bouton avec un texte, au lieu des pictogrammes muets alignés dans cette marge.
  _section(categorie, libelle, icone, description, replie) {
    const it = new vscode.TreeItem(libelle, replie
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.Expanded);
    it.categorie = categorie;
    it.iconPath = new vscode.ThemeIcon(icone, COULEURS_SECTION[categorie]
      ? new vscode.ThemeColor(COULEURS_SECTION[categorie]) : undefined);
    it.contextValue = 'section-' + categorie;   // 'section-articles', 'section-word'…
    if (description) { it.description = description; }
    if (COMMANDES_SECTION[categorie]) {
      it.command = { command: COMMANDES_SECTION[categorie], title: libelle, arguments: [] };
    }
    return it;
  }

  // Article = dossier articles/<slug>/ avec le .md homonyme, comme dans le Makefile.
  // L'ordre est celui du numéro (ausgabe.yaml) et non celui des noms de dossier ; le
  // libellé est le titre de la fiche précédé de son rang à deux chiffres, et le slug passe
  // en description — c'est le nom du dossier, ce n'est pas le nom de l'article.
  _itemsArticles() {
    const base = path.join(this.racine, 'articles');
    const slugs = this.listerArticles();
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.articles'))]; }
    const auto = replierAssetsAutres();
    const langue = langueRevue(this.racine);
    const taches = tachesDuNumero(this.racine);
    return slugs.map((slug, index) => {
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      // Seuls les tableaux se déplient sous l'article : les images se gèrent dans le
      // formulaire « Médias de cet article », qui les montre avec leurs légendes, leurs
      // crédits et leur verdict de qualité.
      // Ce qui rend un article dépliable : ses tableaux, ou sa bibliographie. Compter les
      // seuls tableaux laissait l'entrée de bibliographie inatteignable sur un article qui
      // n'a pas de tableau — c'est-à-dire sur la plupart.
      const aDesAssets = this._tablesArticle(slug).length > 0
        || fs.existsSync(cheminBiblio(this.racine, slug));
      const deploye = auto && aDesAssets && slug === this.slugDeploye;
      const nom = nomArticle(this.racine, slug, index, langue);
      const it = new vscode.TreeItem(nom, !aDesAssets
        ? vscode.TreeItemCollapsibleState.None
        : (deploye ? vscode.TreeItemCollapsibleState.Expanded
                   : vscode.TreeItemCollapsibleState.Collapsed));
      // VS Code mémorise l'état plié/déplié d'un élément qu'il reconnaît et ignore alors
      // le collapsibleState renvoyé : l'`id` porte donc l'état voulu, il change,
      // l'élément est recréé. Sans le réglage, pas d'`id` : l'utilisateur décide.
      if (auto && aDesAssets) { it.id = 'article:' + slug + ':' + (deploye ? 'ouvert' : 'ferme'); }
      it.slug = slug;                   // lu par les actions de l'arbre
      it.resourceUri = md;              // décorations du thème (git, problèmes)
      // Le slug d'abord : c'est par lui qu'on retrouve le dossier. L'avancement des tâches
      // se lit à côté, sans avoir à ouvrir la vue.
      const avance = avancementTaches(this.racine, slug, taches);
      it.description = avance.total > 0
        ? slug + ' · ' + T('art.taches.avancement', [avance.faites, avance.total])
        : slug;
      // L'icône redit l'avancement en couleur : elle prime sur l'icône de fichier du
      // thème, qui était la même pour tous les articles et ne distinguait rien.
      it.iconPath = iconeAvancement(avance);
      it.tooltip = T('art.arbre.tooltip', [nom, slug, md.fsPath]);
      it.contextValue = 'article';      // pilote les boutons inline (menus view/item/context)
      // Le clic fait tout : .md en colonne 1, compilation si besoin, aperçu en colonne 2.
      it.command = {
        command: 'szh.ouvrirArticle', title: 'Ouvrir l’article',
        arguments: [slug]
      };
      return it;
    });
  }

  // articles/<slug>/media/, récursif ; chemins relatifs à media/, triés.
  _imagesArticle(slug) {
    const base = path.join(this.racine, 'articles', slug, 'media');
    const resultats = [];
    const parcourir = (dossier, prefixe) => {
      let entrees;
      try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
      catch (e) { return; }
      for (const e of entrees) {
        if (e.isDirectory()) { parcourir(path.join(dossier, e.name), prefixe + e.name + '/'); }
        else if (e.isFile() && e.name.indexOf('~$') !== 0
                 && /\.(png|jpe?g|gif|svg)$/i.test(e.name)) { resultats.push(prefixe + e.name); }
      }
    };
    parcourir(base, '');
    return resultats.sort((a, b) => a.localeCompare(b, 'fr'));
  }

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

  // Ce que l'article porte à part de son texte : ses tableaux, et sa bibliographie. Aucune
  // description sur ces entrées — ni poids, ni compteur : la colonne reste vide, et ce qui
  // s'y affichera un jour aura donc du sens.
  _itemsTables(slug) {
    const baseTables = path.join(this.racine, 'articles', slug, 'tables');
    const tables = this._tablesArticle(slug).map((nom) => {
      const chemin = path.join(baseTables, nom);
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cheminAsset = chemin;
      it.iconPath = new vscode.ThemeIcon('table');
      it.contextValue = 'table';
      it.tooltip = T('arbre.table.tooltip', [chemin]);
      // L'éditeur plutôt que le HTML brut, qui reste accessible depuis l'Explorateur.
      it.command = {
        command: 'szh.editerTable', title: 'Ouvrir l’éditeur de tableau',
        arguments: [it]
      };
      return it;
    });
    const biblio = this._itemBiblio(slug);
    return biblio ? tables.concat([biblio]) : tables;
  }

  // La bibliographie, éditable comme un tableau — mais en texte : c'est de la prose, une
  // référence par paragraphe, que le rédacteur colle depuis Zotero ou depuis un autre
  // article. Un éditeur structuré se battrait contre ce geste-là ; le texte est la bonne
  // surface, et c'est déjà celle de l'article.
  //
  // Colonne 1, comme le .md : « Beside » est relatif à la vue active et empile les colonnes,
  // et la colonne 2 appartient à l'aperçu. L'onglet s'ouvre donc À CÔTÉ de l'article, pas à
  // sa place, et sans chasser l'aperçu.
  //
  // Pas de fichier : pas d'entrée. Un article sans bibliographie n'a rien à montrer — une
  // entrée morte ferait croire à une liste vide, ce qui n'est pas la même chose.
  _itemBiblio(slug) {
    const chemin = cheminBiblio(this.racine, slug);
    if (!fs.existsSync(chemin)) { return null; }
    const it = new vscode.TreeItem(nomFichierBiblio(slug), vscode.TreeItemCollapsibleState.None);
    it.slug = slug;
    it.cheminAsset = chemin;
    it.iconPath = new vscode.ThemeIcon('book');
    it.contextValue = 'biblio';
    it.tooltip = T('arbre.biblio.tip');
    it.command = {
      command: 'vscode.open', title: T('arbre.biblio'),
      arguments: [vscode.Uri.file(chemin), { viewColumn: vscode.ViewColumn.One }]
    };
    return it;
  }

  // articles-word/*.docx à la racine du dossier, donc sans _convertis/.
  _itemsWord() {
    const noms = this._docxEnAttente(path.join(this.racine, 'articles-word'));
    if (noms.length === 0) { return [this._vide(T('arbre.vide.word'))]; }
    return noms.map((nom) => {
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.contextValue = 'word';
      // « 4_Titre.docx » -> 04-titre, même règle que la cible d'import du Makefile.
      if (this._articleExiste(slugifierArticle(nom))) {
        // Le .md cible existe déjà : l'import l'ignorera, il n'écrase rien. C'est le
        // redépôt d'un Word corrigé, et le clic droit doit mener au geste qui le publie —
        // d'où un contextValue à part, et le nom du fichier porté par l'item.
        it.contextValue = 'word-deja';
        it.word = nom;
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

  // Un article par ligne, dépliable sur ses champs bilingues ; « 💬 » signale une
  // question posée à l'équipe de traduction.
  _itemsTraductions() {
    const slugs = this.listerArticles();
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.traductions'))]; }
    const source = langueRevue(this.racine);
    return slugs.map((slug, index) => {
      const etat = etatTraduction(this.racine, slug, source);
      const rien = etat.lignes.length === 0;
      // Le même nom que dans la section « Articles » : un article se reconnaît partout à
      // son titre et à son rang, jamais à son slug tronqué. La fiche vient d'etatTraduction,
      // qui l'a déjà lue.
      const it = new vscode.TreeItem(
        libelleArticle(index, slug, titreFiche(etat.meta, source)), rien
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

  // Une ligne par champ bilingue : « Titre (DE) », remplissage, statut d'atelier.
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
      // Le focus va sur ce bloc du panneau.
      it.command = {
        command: 'szh.traduction', title: 'Suivi de traduction',
        arguments: [{ slug: slug, cle: groupe.cle }]
      };
      return it;
    });
  }

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

  // L'ordre du numéro, réparé de ce que le disque dit : un article ajouté à la main
  // apparaît à la fin, un article effacé quitte l'ordre, et rien n'est réécrit au passage.
  //
  // Puis la règle du DOI par-dessus : les articles qui n'en reçoivent pas passent à la fin,
  // pour que le numéro d'ordre du DOI suive l'ordre de lecture. Le tri est appliqué ICI,
  // sur l'unique source d'ordre du cockpit, et non dans la vue : l'arbre, les vues et les
  // boutons de déplacement doivent tous voir le même sommaire, sans quoi un article
  // porterait deux rangs selon l'endroit où on le regarde.
  listerArticles() {
    if (!this.racine) { return []; }
    const slugs = this._sousDossiersAvecMd(path.join(this.racine, 'articles'));
    return ordonnerArticles(valeurOrdreArticles(this.racine), slugs,
      articlesSansDoi(this.racine, slugs)).slugs;
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

// ---- Ouverture du PDF, calquée sur szh-apercu ------------------------------------

// pdf.preview est mono-instance : openWith révèle l'onglet existant au lieu de le
// dupliquer, et ramène donc devant un PDF déjà ouvert.
async function ouvrirApercuPdf(uri) {
  if (vscode.extensions.getExtension(EXT_PDF)) {
    // Colonne 2 fixe : « Beside » est relatif à la vue active et empile des colonnes.
    await vscode.commands.executeCommand('vscode.openWith', uri, VUE_PDF, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: true
    });
  } else {
    vscode.window.showInformationMessage(T('info.pdf.externe'));   // hôte de développement
    await vscode.env.openExternal(uri);
  }
}

// Ferme les onglets dont l'entrée satisfait le prédicat ; les `TabInput` sont typés en
// canard, d'où les gardes chez les appelants.
async function fermerOnglets(predicat) {
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      if (predicat(onglet.input)) { aFermer.push(onglet); }
    }
  }
  if (aFermer.length === 0) { return; }
  try { await vscode.window.tabGroups.close(aFermer); } catch (e) { /* déjà fermé */ }
}

// ---- Tâche de compilation : réutilise la tâche utilisateur, écoute sa fin --------

let buildEnCours = false;

// Résout avec le code de sortie de la tâche, ou null si son label est introuvable.
async function lancerTache(nomTache) {
  const taches = await vscode.tasks.fetchTasks();
  const tache = taches.find((t) => t.name === nomTache);
  if (!tache) {
    vscode.window.showErrorMessage(T('err.tache'));
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

// Une tâche s'est terminée en échec. Si le journal porte un point bloquant, la vue des
// contrôles vient de le nommer et de dire quoi faire : ce message-ci n'ajouterait rien et
// masquerait le précis par le vague. Il ne sort donc que sur un échec muet.
function avertirEchecCompilation(cle, args) {
  if (resumeJournal(dernierJournal.constats).bloquants > 0) { return; }
  vscode.window.showErrorMessage(T(cle, args || []));
}

// Recompilation forcée de toute la revue. Les aperçus sous out/ sont fermés d'abord :
// le clean supprime out/, et un PDF affiché est verrouillé côté Windows.
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
    if (code === null) { return; }                 // tâche introuvable, déjà signalé
    if (code !== 0) {
      avertirEchecCompilation('err.export');
      return;
    }
    const n = fournisseur.listerArticles().length;
    vscode.window.showInformationMessage(n > 1 ? T('info.exportes', [n]) : T('info.exportes.un'));
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

// Recompilation, galleys DOCX, puis XML natif à la racine ; les manques bloquants
// arrivent en une erreur listée par lib/export-ojs.js.
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
    apercuCourantUri = null;                       // « Tout exporter » fait un clean
    let code = await lancerTache(NOM_TACHE_EXPORT);
    rafraichirTout();
    if (code === null) { return; }                 // tâche introuvable, déjà signalé
    if (code !== 0) {
      avertirEchecCompilation('err.export');
      return;
    }
    code = await lancerTache(NOM_TACHE_DOCX);
    if (code === null) { return; }
    if (code !== 0) {
      vscode.window.showErrorMessage(T('exportOjs.erreurDocx'));
      return;
    }
    const resultat = genererExportOjs(racine);     // synchrone, quelques secondes
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
    const message = T('exportOjs.erreur', [String((e && e.message) || e)]);
    // Un intitulé de rubrique ou un nom de groupe qui manque ne se corrige pas dans le
    // numéro : le bouton mène droit au panneau où le relever.
    if (e && e.szhConfigOjs) {
      const bouton = T('exportOjs.configurer');
      const choix = await vscode.window.showErrorMessage(message, bouton);
      if (choix === bouton) { ouvrirReglages(rafraichirTout); }
    } else {
      vscode.window.showErrorMessage(message);
    }
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

// ---- Export d'un seul article ----------------------------------------------------
// Sur un numéro gelé, seul ce geste régénère un document. La tâche vise le PDF et
// l'aperçu HTML, sans clean ni import, qui supprimerait le .docx source.
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

async function lancerTacheObjet(tache) {
  const execution = await vscode.tasks.executeTask(tache);
  return await new Promise((resolve) => {
    const abo = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { abo.dispose(); resolve(e.exitCode); }
    });
  });
}

// Sans argument, l'article visé est celui du .md actif, à défaut celui en aperçu.
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
      avertirEchecCompilation('err.exportArticle', [slug]);
      return;
    }
    vscode.window.setStatusBarMessage(T('info.exportArticle', [slug]), 4000);
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
  await ouvrirArticle(fournisseur, slug);   // montre le document régénéré
}

// ---- Archiver, verrouiller, désarchiver ------------------------------------------
// ausgabe.yaml est écrit d'abord. Le déplacement du dossier est délégué à
// windows/archive-revue.ps1, qui attend la fermeture de la fenêtre : d'où l'ordre
// écrire, nettoyer, lancer, fermer.

function poidsLisible(octets) {
  if (octets <= 0) { return T('modale.archiver.rien'); }
  if (octets < 1024 * 1024) { return Math.max(1, Math.round(octets / 1024)) + ' Ko'; }
  const mo = octets / (1024 * 1024);
  return (mo < 10 ? mo.toFixed(1).replace('.', ',') : String(Math.round(mo))) + ' Mo';
}

// Le dossier ne bouge pas, out/ est conservé : le geste d'un numéro déjà archivé.
// Les formulaires qui écrivent des fichiers sans passer par l'éditeur (gestionnaire des
// médias, éditeur de tableau) : ni le verrou en lecture seule ni la disparition d'un
// article ne les atteignent, il faut les fermer.
function fermerFormulairesEcriture(racine, slug) {
  const dossier = (racine && slug) ? path.join(racine, 'articles', slug) + path.sep : null;
  const concerne = (table, cle) => {
    if (!dossier) { return true; }                 // tout fermer (verrouillage du numéro)
    return table === panneauxMedias ? cle === slug : String(cle).indexOf(dossier) === 0;
  };
  for (const table of [panneauxMedias, panneauxTable]) {
    for (const [cle, panneau] of Array.from(table.entries())) {
      if (!concerne(table, cle)) { continue; }
      try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
      table.delete(cle);
    }
  }
}

async function verrouillerSeulement(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  const choix = await vscode.window.showWarningMessage(
    T('modale.verrouiller.question', [titreNumero(racine)]),
    { modal: true, detail: T('modale.verrouiller.detail') },
    T('modale.verrouiller.bouton'));
  if (choix !== T('modale.verrouiller.bouton')) { return; }
  const erreur = ecrireClesAusgabe(racine, { locked: 'true' });
  if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [erreur])); return; }
  fermerFormulairesEcriture(null, null);           // un formulaire ouvert écrit par fs
  rafraichirTout();
  vscode.window.setStatusBarMessage(T('statut.verrouille'), 4000);
}

async function archiverEtVerrouiller(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Déjà archivé : il ne reste qu'à reposer le verrou.
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

  // 1. les deux drapeaux seuls : l'étape 2 peut échouer, il faut pouvoir revenir.
  const erreurYaml = ecrireClesAusgabe(racine, { locked: 'true', archived: 'true' });
  if (erreurYaml) { vscode.window.showErrorMessage(T('err.ecriture', [erreurYaml])); return; }

  // 2. ⚠ fermer les onglets avant de supprimer out/ : un PDF affiché est verrouillé
  //    côté Windows. En cas d'échec on relève les drapeaux, avant tout déplacement.
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

  // 3. la version du logiciel, si le numéro n'en portait pas ; après le point de
  //    non-retour, pour qu'un archivage annulé ne laisse pas d'estampille.
  const poste = versionInstallee();
  if (etatNumero.versionToolkit === '' && poste !== '') {
    ecrireClesAusgabe(racine, { 'version-toolkit': poste });
  }

  // 4. la lecture seule, écrite dans le dossier : elle part avec lui.
  const erreurVerrou = appliquerVerrou(racine, true);
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

// Retour dans l'arborescence « en cours ». Le verrou n'est pas levé pour autant.
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

// La fenêtre se ferme après le démarrage du script : tant qu'elle est ouverte, Windows
// refuse de déplacer le dossier.
async function fermerFenetreApresArchivage() {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await vscode.commands.executeCommand('workbench.action.closeWindow');
}

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
  const erreurVerrou = appliquerVerrou(racine, false);
  if (erreurVerrou) { vscode.window.showWarningMessage(T('err.verrou.reglages', [erreurVerrou])); }
  verrouApplique = false;
  racineVerrou = racine;
  rafraichirTout();
  vscode.window.setStatusBarMessage(T('statut.deverrouille'), 5000);
}

// ---- Clic sur un article = aperçu direct -----------------------------------------

let apercuCourantUri = null;   // celui de l'article précédent est fermé avant

async function fermerApercuCourant(saufUri) {
  const courant = apercuCourantUri;
  if (!courant) { return; }
  if (saufUri && courant.fsPath.toLowerCase() === saufUri.fsPath.toLowerCase()) { return; }
  apercuCourantUri = null;
  const cible = courant.fsPath.toLowerCase();
  await fermerOnglets((e) => e && e.uri && e.uri.fsPath && e.uri.fsPath.toLowerCase() === cible);
}

// ---- Aperçu commutable HTML / PDF ------------------------------------------------
// Mode global szh.apercuMode (défaut html). En HTML, la colonne 2 est une webview qui
// charge out/<slug>/<slug>.apercu.html, rendu avec sourcepos : survol = contour, clic =
// ligne source du .md. En PDF, c'est tomoki1207.pdf, et szh-apercu ne s'active que dans
// ce mode : la colonne 2 n'a qu'un propriétaire à la fois.

// Profil du dossier, lu comme le fait le Makefile : clé absente = « article », clé
// présente mais vide = 'rien', soit aucun document produit.
let profilRevue = 'article';

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
  if (profilRevue !== 'article') { return 'html'; }
  try {
    return String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { return 'html'; }
}

let panneauApercuHtml = null;
let apercuCourantSlug = null;
let apercuHtmlMtime = 0;

// Garde anti-boucle du défilement synchronisé : quand l'extension révèle elle-même une
// ligne, l'événement de visibilité qui en découle est ignoré.
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
  if (!apercuCourantSlug || !fournisseur.racine) { return null; }
  const cible = path.join(fournisseur.racine, 'articles', apercuCourantSlug, apercuCourantSlug + '.md').toLowerCase();
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
  defilementProgrammatiqueHote = true;
  ed.revealRange(new vscode.Range(l, 0, l, 0), vscode.TextEditorRevealType.AtTop);
  if (minuteurHoteRelache) { clearTimeout(minuteurHoteRelache); }
  minuteurHoteRelache = setTimeout(() => { defilementProgrammatiqueHote = false; }, 200);
}

function pousserDefilementVersApercu(ligne0Based) {
  if (minuteurHoteVersApercu) { clearTimeout(minuteurHoteVersApercu); }
  minuteurHoteVersApercu = setTimeout(() => {
    if (!panneauApercuHtml) { return; }
    try { panneauApercuHtml.webview.postMessage({ type: 'scroll', ligne: ligne0Based + 1 }); }
    catch (e) { /* webview fermée entre-temps */ }
  }, 35);
}

// Curseur dans le .md -> surlignage dans l'aperçu, amené en vue s'il est hors écran.
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

// Injecte dans le HTML de pandoc la CSP, le bandeau, les styles de survol et le script.
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

// Clic dans l'aperçu -> texte source : le mot cliqué s'il est retrouvé, sinon le début
// du bloc ; le .md s'ouvre en colonne 1, curseur et focus posés.
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

// Ferme la colonne 2. szh-apercu ouvre des onglets pdf.preview dont le cockpit ne garde
// pas trace : d'où le balayage de tabGroups.
async function fermerTousLesApercus() {
  fermerApercuHtml();
  await fermerApercuCourant(null);
  await fermerOnglets((e) => e && e.viewType === VUE_PDF);
  apercuCourantUri = null;
}

// Seuls des libellés traduits sont posés dans ce HTML ; ils sont échappés quand même.
function echapperTexte(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Aperçu HTML en colonne 2 ; si le fichier manque, replie sur le .html du PDF.
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
      if (msg.type === 'scrollSource') { revelerLigneSource(fournisseur, msg.ligne); }
    });
  }
  panneauApercuHtml.title = slug;
  panneauApercuHtml.webview.html = html;
  apercuCourantSlug = slug;
  apercuHtmlMtime = mtime;
}

function rechargerApercuHtmlSiChange(fournisseur) {
  // Réassigner webview.html déplace le focus, et un QuickPick ouvert (Ctrl+Alt+A/S/D,
  // choix de titre…) se ferme dès que le focus bouge : la fin d'une compilation fermait
  // le panneau sous les doigts du rédacteur. Tout le corps est donc différé — et
  // réévalué au rejeu, l'aperçu ayant pu être fermé ou la sortie avoir encore changé
  // entre-temps. Une seule action pour toutes les compilations survenues pendant le geste.
  differer('apercu-html', () => {
    if (!panneauApercuHtml || !apercuCourantSlug || !fournisseur.racine || modeApercu() !== 'html') { return; }
    const slug = apercuCourantSlug;
    let mtime = 0;
    try { mtime = fs.statSync(path.join(fournisseur.racine, 'out', slug, slug + '.apercu.html')).mtimeMs; }
    catch (e) { return; }
    if (mtime > apercuHtmlMtime) { ouvrirApercuHtml(fournisseur, slug); }
  });
}

// Persiste szh.apercuMode ; jamais deux aperçus en colonne 2.
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

// Slug de l'article d'un chemin, ou null : un article est un
// <racine>/articles/<slug>/<slug>.md. Même test que szh-apercu.
function slugDepuisChemin(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const parties = path.relative(racine, chemin).split(path.sep);
  if (parties.length !== 3 || parties[0] !== 'articles') { return null; }
  return parties[2] === parties[1] + '.md' ? parties[1] : null;
}

// Au démarrage, si l'éditeur actif est déjà un article, enchaîner ce que fait un clic
// dans la barre latérale. Ici et non dans le lanceur PowerShell : un make lancé depuis
// Windows concurrencerait `triggerTaskOnSave`, et le Makefile n'a pas de verrou.
async function ouvrirArticleActifAuDemarrage(fournisseur) {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const slug = slugDepuisChemin(fournisseur.racine, editeur.document.uri.fsPath);
  if (!slug) { return; }                            // pas un article : ne rien forcer
  try { await ouvrirArticle(fournisseur, slug); }
  catch (e) { /* au démarrage, ne pas bloquer l'ouverture de la revue */ }
}

// .md en colonne 1 ; compilation incrémentale si l'aperçu du mode courant est absent ou
// plus vieux que ses sources ; aperçu en colonne 2, à la place du précédent. Une
// compilation en échec ne montre pas d'aperçu périmé, `opts.sansTexte` laisse la
// colonne 1 au panneau qui l'occupe, et `opts.sansApercu` s'arrête au .md : ni aperçu,
// ni compilation (vue d'ensemble Articles — voir le commentaire plus bas).
async function ouvrirArticle(fournisseur, slug, opts) {
  const racine = fournisseur.racine;
  if (!racine || typeof slug !== 'string' || slug === '') { return; }
  // Avant l'ouverture du .md et la compilation, pour que l'arbre suive le clic.
  if (fournisseur.definirDeploye(slug)) { fournisseur.rafraichir(); }
  const md = path.join(racine, 'articles', slug, slug + '.md');
  const pdf = vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf'));
  const modeCourant = modeApercu();
  // Un PDF à jour ne dit rien du HTML d'aperçu : on juge celui du mode courant.
  const apercuAttendu = modeCourant === 'html'
    ? path.join(racine, 'out', slug, slug + '.apercu.html')
    : pdf.fsPath;

  if (!(opts && opts.sansTexte)) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md), { viewColumn: vscode.ViewColumn.One });
  }

  // Décision de Robin (25.08.2026) : depuis la vue d'ensemble Articles, on vient lire ou
  // corriger le texte, pas mettre en page — le .md suffit, pas d'aperçu en colonne 2.
  // La compilation d'obsolescence est sautée aussi : compiler pour un aperçu qu'on
  // n'affiche pas surprendrait (barre d'état « compilation de… », journal relu en fin de
  // tâche), et rien d'autre n'en dépend ici — l'enregistrement du .md recompile de toute
  // façon via triggerTaskOnSave. Un panneau d'aperçu déjà ouvert continue, lui, de se
  // rafraîchir par le watcher out/** (rechargerApercuHtmlSiChange) — comportement voulu.
  if (opts && opts.sansApercu) { return; }

  // Obsolète = plus ancien que le .md, un tableau extrait ou la fiche .meta.yaml ; même
  // graphe de dépendances que la règle HTML du Makefile.
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
  } catch (e) { obsolete = true; }                 // aperçu ou .md illisible : on compile

  // Sur un numéro gelé, cliquer un article ne compile pas : on montre ce qui existe.
  if (compilationAutoCoupee()) { obsolete = false; }

  if (obsolete && buildEnCours) {
    // Une compilation tourne déjà : le rafraîchissement de out/** remplacera le message
    // d'attente par le rendu.
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
      if (code === null) { return; }               // tâche introuvable, déjà signalé
      if (code !== 0) {
        avertirEchecCompilation('err.build');
        return;
      }
    } finally {
      statut.dispose();
      buildEnCours = false;
    }
  }
  if (modeCourant === 'html') {
    if (apercuCourantUri) { await fermerApercuCourant(null); }  // onglet PDF d'une bascule passée
    const pret = fs.existsSync(apercuAttendu);
    ouvrirApercuHtml(fournisseur, slug, !pret && !compilationAutoCoupee());
    if (!pret && !compilationAutoCoupee()) { relancerCompilation(fournisseur, slug); }
    return;
  }
  fermerApercuHtml();                              // webview HTML d'une bascule passée
  if (!fs.existsSync(pdf.fsPath)) {
    const gele = compilationAutoCoupee();   // le message renvoie alors à l'export
    vscode.window.showErrorMessage(T('err.pdf.introuvable', [slug]) + ' '
      + T(gele ? 'apercu.gele' : 'apercu.encours'));
    apercuCourantSlug = slug;                      // l'article visé en colonne 2
    if (!gele) { relancerCompilation(fournisseur, slug); }       // relance, puis affiche
    return;
  }
  await fermerApercuCourant(pdf);                  // l'aperçu de l'article précédent
  await ouvrirApercuPdf(pdf);                      // mono-instance : révèle si déjà là
  apercuCourantUri = pdf;
  apercuCourantSlug = slug;
}

// Lance compilerPuisAfficher sans l'attendre ; le catch évite un rejet non capturé.
function relancerCompilation(fournisseur, slug) {
  compilerPuisAfficher(fournisseur, slug).catch(() => { /* signalé côté build */ });
}

// L'aperçu manque encore : une seule passe est relancée en tâche de fond, sans boucler.
async function compilerPuisAfficher(fournisseur, slug) {
  if (buildEnCours || importEnCours) { return; }
  if (compilationAutoCoupee()) { return; }         // pas de compilation implicite

  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
  let code = null;
  try {
    code = await lancerBuild();
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
  if (code === null) { return; }                   // tâche introuvable, déjà signalé
  if (code !== 0) { avertirEchecCompilation('err.build'); return; }
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

// ---- Import guidé ----------------------------------------------------------------

let importEnCours = false;

// Appelée pendant que importEnCours est posé, d'où le drapeau de compilation géré ici.
// Un échec n'annule pas l'import.
async function compilerApresImport() {
  if (buildEnCours) { return; }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.build.import'));
  try {
    const code = await lancerBuild();
    if (code !== null && code !== 0) { avertirEchecCompilation('err.build'); }
  } finally {
    statut.dispose();
    buildEnCours = false;
  }
}

// Convertit les Word de articles-word/ ; les nouveaux articles sont comptés en comparant
// la liste avant et après, pas en lisant la sortie de la tâche.
async function lancerConversion(fournisseur, rafraichirTout) {
  if (importEnCours) { vscode.window.setStatusBarMessage(T('statut.import.encours'), 3000); return; }
  importEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.import'));
  try {
    const avant = new Set(fournisseur.listerArticles());
    const code = await lancerTache(NOM_TACHE_IMPORT);
    rafraichirTout();
    if (code === null) { return; }               // tâche introuvable, déjà signalé
    if (code !== 0) {
      avertirEchecCompilation('err.import');
      return;
    }
    const nouveaux = [];
    for (const slug of fournisseur.listerArticles()) { if (!avant.has(slug)) { nouveaux.push(slug); } }
    if (nouveaux.length > 0) {
      // Avant la compilation : un JPEG d'imprimerie converti après coup laisserait
      // l'opérateur inspecter un PDF bâti sur les couleurs d'origine.
      const aConvertir = [];
      for (const slug of nouveaux) {
        const base = path.join(fournisseur.racine, 'articles', slug, 'media');
        for (const relatif of fournisseur._imagesArticle(slug)) { aConvertir.push(path.join(base, relatif)); }
      }
      await convertirCmykSiBesoin(aConvertir);
      // Avant le dialogue, où « Remplacer » refuserait d'agir pendant une compilation.
      await compilerApresImport();
      rafraichirTout();
      await ouvrirImportVerif(fournisseur, rafraichirTout, nouveaux);
    } else {
      vscode.window.showInformationMessage(T('info.importes.aucun'));
    }
  } finally {
    statut.dispose();
    importEnCours = false;
  }
}

// Commun au bouton « Importer des Word » et au glisser-déposer : copie vers
// articles-word/, conflits en modale, puis conversion.
async function importerFichiersWord(fournisseur, rafraichirTout, uris) {
  const racine = fournisseur.racine;
  if (!racine || !Array.isArray(uris) || uris.length === 0) { return; }
  const choix = uris;

  const dossierWord = path.join(racine, 'articles-word');
  try { fs.mkdirSync(dossierWord, { recursive: true }); } catch (e) { /* existe déjà */ }

  // Plutôt qu'un renommage automatique, qui créerait un article dupliqué au slug suffixé.
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

// Les .docx déposés sur la vue passent par le circuit d'« Importer des Word ». Le format
// `text/uri-list` donne une URI par ligne, lignes vides et « # » ignorés (RFC 2483).
function controleurDepotVue(fournisseur, rafraichirTout) {
  return {
    dropMimeTypes: ['text/uri-list'],
    dragMimeTypes: [],
    handleDrop: async (cible, dataTransfer) => {
      if (refuserSiVerrouille()) { return; }       // le dépôt écrit, comme le bouton
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

// ---- Réimporter un article corrigé ----------------------------------------------
//
// L'auteur renvoie son Word corrigé. Jusqu'ici il fallait renommer le fichier, réimporter,
// puis recopier à la main la fiche, les portraits et les traductions du doublon vers
// l'original — et le message de l'import promettait un bouton qui n'existait pas.
//
// pipeline/reimporter.py fait tout le travail, et il est le SEUL à le faire : rien de sa
// logique n'est redit ici. Ce qui vit ici, et rien d'autre :
//
//   * la confirmation, parce que le geste remplace le travail de quelqu'un ;
//   * la lecture de sa réponse — une ligne JSON — et le ton qui va avec ;
//   * la recompilation de l'article, sans laquelle l'aperçu et le PDF montreraient encore
//     l'ancien texte ;
//   * le retour en arrière, atteignable d'un clic.
//
// C'est aussi le seul maillon que le cockpit lance sans passer par une tâche : une tâche
// ne rapporte que son code de retour, et il faut ici lire la réponse.

// Large : le premier appel paie le réveil de la machine du pipeline, et la conversion d'un
// Word illustré prend son temps. Au-delà, on rend la main plutôt que de laisser le
// rédacteur devant une barre d'état qui ne bouge plus.
const REIMPORT_DELAI = 600000;

// -> Promise<{ json, code, erreur }>. `json` est la ligne de résultat, ou null : un appel
// mal formé et une machine absente n'en produisent pas, et l'appelant le dit autrement.
// Ne rejette jamais : les cinq issues se lisent dans le retour, pas dans une exception.
function lancerReimporter(racine, args) {
  const argv = ['-d', DISTRO_WSL, '--cd', racine, '--', 'python3', REIMPORTER_WSL]
    .concat(args || []);
  return reveillerWsl().then(() => new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cheminWsl(), argv,
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      resolve({ json: null, code: null, erreur: String((e && e.message) || e) });
      return;
    }
    const morceaux = [];
    let fini = false;
    let minuteur = null;
    const finir = (r) => {
      if (fini) { return; }
      fini = true;
      if (minuteur) { clearTimeout(minuteur); }
      resolve(r);
    };
    minuteur = setTimeout(() => {
      try { proc.kill(); } catch (e) { /* déjà mort */ }
      finir({ json: null, code: null, erreur: 'delai' });
    }, REIMPORT_DELAI);
    if (proc.stdout) { proc.stdout.on('data', (d) => morceaux.push(d)); }
    proc.on('error', (e) => finir({ json: null, code: null, erreur: String((e && e.message) || e) }));
    proc.on('close', (code) => {
      // Une seule ligne JSON, et elle est la dernière : tout le reste part sur la sortie
      // d'erreur, que l'on ne lit pas — elle va déjà dans le journal d'import.
      let json = null;
      for (const ligne of Buffer.concat(morceaux).toString('utf8').split(/\r?\n/)) {
        const nette = ligne.trim();
        if (nette.charAt(0) !== '{') { continue; }
        try {
          const objet = JSON.parse(nette);
          if (objet && typeof objet === 'object' && typeof objet.resultat === 'string') { json = objet; }
        } catch (e) { /* ligne non JSON : ignorée */ }
      }
      finir({ json: json, code: code, erreur: null });
    });
  }));
}

// L'article dont la fiche dit venir de ce document Word. '' si aucun, ou si plusieurs :
// deviner à la place du rédacteur est exactement ce que le script refuse de faire.
function articleDuWord(fournisseur, nom) {
  const cherche = String(nom || '').toLowerCase();
  const trouves = [];
  for (const slug of fournisseur.listerArticles()) {
    const source = String(lireMetaArticle(fournisseur.racine, slug).source || '').toLowerCase();
    if (source !== '' && source === cherche) { trouves.push(slug); }
  }
  return trouves.length === 1 ? trouves[0] : '';
}

// Le rédacteur désigne l'article. C'est la sortie des deux cas où le script refuse de
// choisir : plusieurs articles disent venir du même Word, ou aucun ne dit d'où il vient.
// L'article dont le nom de dossier correspond au fichier est proposé en tête — c'est le
// plus probable, et ce n'est qu'une proposition.
async function choisirArticleReimport(fournisseur, nom) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const slugs = fournisseur.listerArticles();
  const probable = slugifierArticle(nom);
  const rang = (slug) => (slug === probable ? 0 : 1);
  const items = slugs.slice()
    .sort((a, b) => rang(a) - rang(b) || slugs.indexOf(a) - slugs.indexOf(b))
    .map((slug) => ({
      label: libelleArticle(slugs.indexOf(slug), slug, titreFiche(lireMetaArticle(racine, slug), langue)),
      description: slug, slug: slug
    }));
  if (items.length === 0) { return ''; }
  const choix = await sousGarde(() => vscode.window.showQuickPick(items, {
    title: T('reimport.choisirArticle.titre', [nom]),
    placeHolder: T('reimport.choisirArticle')
  }));
  return choix ? String(choix.slug) : '';
}

// Le rédacteur désigne le Word. Sortie du refus « la fiche ne dit pas d'où vient cet
// article » et de « son document n'attend pas sous ce nom ».
async function choisirWordReimport(fournisseur, slug) {
  const noms = fournisseur._docxEnAttente(path.join(fournisseur.racine, 'articles-word'));
  if (noms.length === 0) { return ''; }
  const choix = await sousGarde(() => vscode.window.showQuickPick(noms, {
    title: T('reimport.choisirWord.titre', [slug]),
    placeHolder: T('reimport.choisirWord')
  }));
  return choix ? String(choix) : '';
}

// La confirmation. Elle nomme ce qui est REMPLACÉ et ce qui est CONSERVÉ, dans cet ordre,
// et dit que le retour en arrière existe : c'est précisément ce que le rédacteur craint de
// perdre, et un « Êtes-vous sûr ? » ne l'aurait pas renseigné.
async function confirmerReimport(slug) {
  const bouton = T('modale.reimport.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.reimport.question', [slug]),
    { modal: true, detail: T('modale.reimport.detail') }, bouton);
  return choix === bouton;
}

// Le texte de l'article a changé : son PDF et son aperçu montrent encore l'ancien. La même
// tâche que « Exporter cet article », pour qu'il n'y ait qu'une façon de compiler un article.
async function compilerApresReimport(racine, slug) {
  if (buildEnCours) { return; }
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('statut.exportArticle', [slug]));
  try { await lancerTacheObjet(tacheMakeArticle(racine, slug)); }
  catch (e) { /* la compilation ratée se dit par les contrôles, le réimport a eu lieu */ }
  finally { statut.dispose(); buildEnCours = false; }
}

// Le geste, du début à la fin. `cible` vaut { slug } depuis un article, { word } depuis la
// vue « Word en attente ».
async function reimporterArticle(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Une conversion ou une compilation en cours lit articles/ et articles-word/ : les
  // remplacer sous ses pieds laisserait un article à moitié écrit.
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const word = (cible && typeof cible === 'object' && cible.word) ? String(cible.word) : '';
  let slug = word === '' ? (cibleTraduction(fournisseur, cible).slug || '') : articleDuWord(fournisseur, word);
  if (word !== '' && slug === '') { slug = await choisirArticleReimport(fournisseur, word); }
  if (slug === '') { return; }                     // dialogue annulé : rien n'a été touché
  if (fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  if (!await confirmerReimport(slug)) { return; }
  // Les deux arguments ensemble quand le fichier est désigné : c'est l'appariement forcé,
  // le seul moyen de corriger un article dont le nom de fichier a changé depuis l'import.
  const args = ['--article', slug].concat(word === '' ? [] : ['--word', word]);
  await executerReimport(fournisseur, rafraichirTout, slug, args, false);
}

// Le filet de sécurité. Il refuse proprement quand aucun état d'avant n'est gardé, et ce
// refus est un message, pas une erreur : rien n'a été touché.
async function annulerReimport(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const slug = cibleTraduction(fournisseur, cible).slug || '';
  if (slug === '' || fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  const bouton = T('modale.annulerReimport.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.annulerReimport.question', [slug]),
    { modal: true, detail: T('modale.annulerReimport.detail') }, bouton);
  if (choix !== bouton) { return; }
  await executerReimport(fournisseur, rafraichirTout, slug, ['--annuler', '--article', slug], true);
}

// Lancer, ranger la réponse là où la vue d'ensemble et la barre d'état la trouvent,
// recompiler si le texte a changé, puis le dire une fois.
async function executerReimport(fournisseur, rafraichirTout, slug, args, annulation) {
  const racine = fournisseur.racine;
  importEnCours = true;
  const statut = vscode.window.setStatusBarMessage(
    T(annulation ? 'statut.reimport.annule' : 'statut.reimport', [slug]));
  let r;
  try { r = await lancerReimporter(racine, args); }
  finally { statut.dispose(); importEnCours = false; }
  // Les formulaires de cet article montrent des tableaux et des images qui viennent d'être
  // remplacés : les laisser ouverts, c'est laisser écrire par-dessus.
  const reussi = !!(r.json && r.json.resultat === 'reussi');
  if (reussi) { fermerFormulairesEcriture(racine, slug); }
  const constats = r.json ? constatsReimport(r.json, slug) : [];
  poserConstatsReimport(racine, constats);
  rafraichirTout();
  const ouverte = panneauxVue.get('controles');
  if (ouverte) { envoyerVue(ouverte, fournisseur, 'controles'); }
  if (reussi) {
    await compilerApresReimport(racine, slug);
    rafraichirTout();
  }
  await annoncerReimport(fournisseur, rafraichirTout, r, slug, annulation, constats);
  if (reussi) { await ouvrirArticle(fournisseur, slug); }
}

// Les cinq issues, chacune avec son ton. Le ton vient de lib/journal.js, jamais d'ici :
// c'est là que la règle se lit, et un refus n'y est pas rouge.
async function annoncerReimport(fournisseur, rafraichirTout, r, slug, annulation, constats) {
  if (!r.json) {
    // Appel mal formé, machine du pipeline absente, délai dépassé : aucune ligne de
    // réponse. Un bug d'appel ou un poste mal préparé, jamais un article abîmé.
    vscode.window.showErrorMessage(T('reimport.injoignable'));
    return;
  }
  const langue = langueCockpit();
  const premiere = constats.length > 0 ? phraseConstat(constats[0], langue) : '';
  const voir = T('ctl.notif.bouton');
  const revenir = T('modale.annulerReimport.bouton');
  const ouvrirControles = () => vscode.commands.executeCommand('szh.vueControles');
  const ton = tonResultatReimport(r.json);

  if (ton === 'ok') {
    if (annulation) {
      vscode.window.showInformationMessage(T('reimport.annule', [slug]));
      return;
    }
    // Réussi sans un mot à dire : une information, et le retour en arrière sous la main.
    if (constats.length === 0) {
      const choix = await vscode.window.showInformationMessage(T('reimport.reussi', [slug]), revenir);
      if (choix === revenir) { await annulerReimport(fournisseur, rafraichirTout, { slug: slug }); }
      return;
    }
    // Réussi, mais le remplacement a coûté quelque chose : le ton de l'avertissement, pas
    // celui de l'échec. Le document est en place et publiable.
    const choix = await vscode.window.showWarningMessage(
      T('reimport.reussi.avert', [slug, constats.length]), voir, revenir);
    if (choix === voir) { await ouvrirControles(); }
    if (choix === revenir) { await annulerReimport(fournisseur, rafraichirTout, { slug: slug }); }
    return;
  }

  // « Rien à faire » : le Word n'apportait rien. Ni échec ni avertissement — un fait.
  if (ton === 'info') {
    vscode.window.showInformationMessage(T('reimport.rien', [slug]));
    return;
  }

  // Refusé : RIEN n'a été touché, et il y a un geste à faire. Le message est celui du
  // refus lui-même, qui porte ce geste ; quand ce geste est « désignez le fichier Word »,
  // le bouton le fait sur place.
  if (ton === 'attention') {
    const codes = Array.isArray(r.json.avertissements) ? r.json.avertissements : [];
    const manqueLeWord = codes.indexOf('reimport-sans-word') !== -1
      || codes.indexOf('reimport-fiche-sans-source') !== -1;
    const boutons = manqueLeWord ? [T('reimport.choisirWord'), voir] : [voir];
    const choix = await vscode.window.showWarningMessage(
      premiere || T('reimport.refuse', [slug]), ...boutons);
    if (choix === voir) { await ouvrirControles(); }
    if (choix === T('reimport.choisirWord')) {
      const nom = await choisirWordReimport(fournisseur, slug);
      if (nom === '') { return; }
      if (!await confirmerReimport(slug)) { return; }
      await executerReimport(fournisseur, rafraichirTout, slug,
        ['--article', slug, '--word', nom], false);
    }
    return;
  }

  // Échoué : l'article est intact, et son Word attend toujours. Celui-là est rouge.
  const choix = await vscode.window.showErrorMessage(
    premiere || T('reimport.echec', [slug]), voir);
  if (choix === voir) { await ouvrirControles(); }
}

// ---- Assets : dimensions sans dépendance, et « Remplacer » -----------------------

// Lues dans les en-têtes : sûres pour PNG, GIF et SVG, au mieux pour JPEG ; null si
// indéterminable, la description retombant sur le poids seul.
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
        if (marqueur === 0xda) { break; }                         // données : SOF manqué
        const longueur = b.readUInt16BE(i + 2);
        if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) {
          return { largeur: b.readUInt16BE(i + 7), hauteur: b.readUInt16BE(i + 5) };
        }
        if (longueur < 2) { break; }                              // en-tête corrompu
        i += 2 + longueur;
      }
      return null;
    }
    // WEBP : conteneur RIFF, trois formes de bloc. Les portraits en acceptent, et sans
    // dimensions le formulaire des médias n'aurait aucun verdict à rendre.
    if (lu >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const bloc = b.toString('latin1', 12, 16);
      if (bloc === 'VP8X') {                                      // étendu : 24 bits - 1
        return { largeur: (b.readUIntLE(24, 3) & 0xffffff) + 1, hauteur: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
      }
      if (bloc === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
        return { largeur: b.readUInt16LE(26) & 0x3fff, hauteur: b.readUInt16LE(28) & 0x3fff };
      }
      if (bloc === 'VP8L') {                                      // 14 bits chacun, - 1
        const bits = b.readUInt32LE(21);
        return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 };
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

// « 1 234 × 567 · 245 Ko » ; virgule française pour les Mo.
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

// Écrase une image de media/ en gardant son nom, pour que les liens du .md restent
// valides. Seul chemin d'écriture d'une image : le gestionnaire des médias et la
// vérification de l'import y passent tous les deux, avec la même confirmation modale et
// les mêmes contrôles de format et de poids. Le fichier arrive en base64 depuis une
// webview, jamais par une boîte de dialogue de l'hôte.
// -> { etat: 'ok' | 'annule' | 'erreur', message }
async function remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64) {
  const echec = (message) => ({ etat: 'erreur', message: message });
  if (!fournisseur.racine) { return echec(T('err.remplacement', ['?'])); }
  if (!new Set(fournisseur.listerArticles()).has(String(slug || ''))) { return { etat: 'annule' }; }
  if (!relatifImageValide(relatif)) { return { etat: 'annule' }; }
  if (buildEnCours || importEnCours) { return echec(T('statut.occupe')); }
  const cible = path.join(fournisseur.racine, 'articles', slug, 'media', relatif);
  let existe = false;
  try { existe = fs.statSync(cible).isFile(); } catch (e) { existe = false; }
  if (!existe) { return echec(T('err.remplacement', [relatif])); }   // disparu entre-temps
  const nomCible = path.basename(cible);
  const nomSource = String(nomFichier || '');
  const ext = (nomSource.match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (EXTENSIONS_IMAGE_IMPORT.indexOf(ext) === -1) { return echec(T('importv.err.format')); }
  const donnees = Buffer.from(String(donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { return echec(T('importv.err.format')); }
  if (donnees.length > TAILLE_MAX_IMAGE_IMPORT) { return echec(T('importv.err.tropvolumineux')); }
  // Confirmation modale, renforcée si le format du fichier déposé diffère.
  let detail = T('modale.remplacer.detail.image', [nomCible]);
  if (formatImage(nomSource) !== formatImage(nomCible)) {
    detail = T('modale.remplacer.detail.format', [formatImage(nomSource), formatImage(nomCible)]) + detail;
  }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.remplacer.question', [nomCible, nomSource]),
    { modal: true, detail: detail },
    T('modale.remplacer.bouton')
  );
  if (reponse !== T('modale.remplacer.bouton')) { return { etat: 'annule' }; }
  try {
    const tmp = path.join(path.dirname(cible), '~$' + nomCible);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);                   // même nom : liens du .md intacts
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
  } catch (e) {
    return echec(T('err.remplacement', [e.message]));
  }
  await convertirCmykSiBesoin([cible]);           // un JPEG d'imprimerie ne s'affiche pas
  vscode.window.setStatusBarMessage(T('statut.image.remplacee', [nomCible]), 5000);
  if (rafraichirTout) { rafraichirTout(); }        // met « L × H · poids » à jour
  return { etat: 'ok' };
}

// Écrase tables/table-NN.html en gardant le nom, pour que la référence reste valide.
// Supprime une image ou un tableau, référence comprise : effacer le seul fichier
// laisserait un lien mort. Le texte passe par un WorkspaceEdit, donc annulable. Rend vrai
// quand le fichier est parti, ce que le gestionnaire des médias attend pour retirer sa
// carte.
async function supprimerAsset(fournisseur, rafraichirTout, item, estTable) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.cheminAsset || !item.slug) { return false; }
  // Comme « Remplacer » : pas de suppression pendant que make lit le dossier.
  if (buildEnCours || importEnCours) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return false;
  }
  const slug = item.slug;
  const cible = item.cheminAsset;
  const nom = path.basename(cible);
  // Relatif à media/ pour une image, nom simple pour un tableau.
  const relatif = estTable
    ? nom
    : path.relative(path.join(racine, 'articles', slug, 'media'), cible).replace(/\\/g, '/');

  const reponse = await vscode.window.showWarningMessage(
    T(estTable ? 'modale.supprimerTable.question' : 'modale.supprimerAsset.question', [nom]),
    { modal: true, detail: T(estTable ? 'modale.supprimerTable.detail' : 'modale.supprimerAsset.detail', [slug]) },
    T('modale.supprimer.bouton')
  );
  if (reponse !== T('modale.supprimer.bouton')) { return false; }   // annulé : rien n'est touché

  // L'ordre compte : référence retirée du tampon, fichier effacé, puis .md enregistré —
  // l'enregistrement compile, et pandoc lirait sinon un média en cours de suppression.
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
    return false;
  }

  try {
    // Le laisser à l'écran ferait réécrire un tableau qui vient d'être supprimé. Le
    // gestionnaire des médias, lui, n'est pas lié à un fichier : il retire sa carte.
    const ouvert = estTable ? panneauxTable.get(cible) : null;
    if (ouvert) { try { ouvert.dispose(); } catch (e) { /* déjà fermé */ } }
    await fermerOngletDuFichier(cible);
    fs.rmSync(cible, { force: true });
  } catch (e) {
    vscode.window.showErrorMessage(T('err.suppression', [nom, e.message]));
    rafraichirTout();
    return false;                                  // .md non enregistré : état cohérent
  }
  if (retirees > 0 && doc) {
    try { await doc.save(); }                      // déclenche la recompilation
    catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [e.message])); }
  }
  vscode.window.setStatusBarMessage(
    retirees > 0
      ? T(estTable ? 'statut.table.supprimee' : 'statut.asset.supprime', [nom, retirees])
      : T(estTable ? 'statut.table.supprimee.sansref' : 'statut.asset.supprime.sansref', [nom]),
    5000
  );
  rafraichirTout();
  return true;
}

// ---- Suppression d'un article ----------------------------------------------------

// Casse ignorée comme sous Windows ; un onglet sur un fichier supprimé ferait fantôme.
async function fermerOngletsSous(dossier) {
  const prefixe = (dossier + path.sep).toLowerCase();
  await fermerOnglets((e) => e && e.uri && e.uri.fsPath &&
    e.uri.fsPath.toLowerCase().indexOf(prefixe) === 0);
}

async function fermerOngletDuFichier(chemin) {
  const vise = String(chemin).toLowerCase();
  await fermerOnglets((e) => e && e.uri && e.uri.fsPath && e.uri.fsPath.toLowerCase() === vise);
}

// Confirmation modale nommant l'article, jamais de suppression silencieuse.
async function supprimerArticle(fournisseur, rafraichirTout, item) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.slug) { return; }
  const slug = item.slug;
  // Sinon make recréerait out/<slug>, ou lirait un dossier à moitié effacé.
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
    fermerFormulairesEcriture(racine, slug);
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

// ---- Formulaire « Métadonnées du numéro » ----------------------------------------

// CSP stricte. Les valeurs arrivent par postMessage, d'où aucun échappement à gérer. Le
// formulaire lui-même vient du fragment partagé media/_numero.js, que la vue « Articles »
// monte à l'identique : il n'y a qu'un formulaire du numéro, et qu'une écriture.
function htmlMetadonnees(nonce) {
  return construireHtml('metadata-issue', nonce, {
    cssPartage: ['_design.css', '_numero.css'], jsPartage: ['_numero.js'],
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'",
    titre: T('meta.titre'), remplacements: { '__TXT__': JSON.stringify(textesNumero()) }
  });
}

let panneauMetadonnees = null;

function envoyerValeursMetadonnees(panneau, racine) {
  repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, chargeNumero(racine, true)));
}

// Panneau singleton : rouvrir la commande révèle le formulaire existant, valeurs relues
// du disque. Pleine page, donc les aperçus sont fermés avant.
async function ouvrirMetadonnees(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  await fermerTousLesApercus();
  if (panneauMetadonnees) {
    panneauMetadonnees.reveal(vscode.ViewColumn.One);
    envoyerValeursMetadonnees(panneauMetadonnees, racine);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhMetadonnees', T('meta.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauMetadonnees = panneau;
  panneau.onDidDispose(() => { if (panneauMetadonnees === panneau) { panneauMetadonnees = null; } });
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeursMetadonnees(panneau, racine); return; }
    messageNumero(panneau, racine, msg, rafraichirTout);
  });
  panneau.webview.html = htmlMetadonnees(crypto.randomBytes(16).toString('hex'));
}

// ---- Éditeur des métadonnées de tous les articles --------------------------------

// Une carte par article : type, doi, title/subtitle/keywords traduisibles, auteurs.
// Gabarit partagé avec le dialogue d'import.
function textesCarteArticle() {
  return Object.assign({
    type: T('fiches.type'), typeAucun: T('fiches.type.aucun'),
    // Langue de l'article. Les noms de langues sont ceux du formulaire du numéro : une
    // seule table pour les deux formulaires.
    langueArticle: T('fiches.langue.article'),
    langueFr: T('meta.langue.fr'), langueDe: T('meta.langue.de'), langueIt: T('meta.langue.it'),
    // Licence de l'article. Les libellés des licences elles-mêmes ne sont pas ici : ils
    // voyagent avec la liste, comme les types d'article, licencesTraduites() les posant.
    licence: T('fiches.licence'),
    titreChamp: T('fiches.titre.champ'), sousTitre: T('fiches.soustitre'),
    resume: T('fiches.resume'),
    auteurs: T('fiches.auteurs'),
    motsCles: T('fiches.motscles'),
    // Cases « + <langue> (champs XX) » : une par langue manquante de la carte.
    ajoutFr: T('fiches.ajout.fr'), ajoutDe: T('fiches.ajout.de'), ajoutIt: T('fiches.ajout.it'),
    // Grille de mots-clés appariés : fragment partagé SZH.motsCles.
    motsClesTitre: T('fiches.motscles.titre'),
    motCleAjouter: T('fiches.motcle.ajouter'), motCleRetirer: T('fiches.motcle.retirer'),
    rien: T('form.rien'), enregistre: T('fiches.enregistre'),
    tradAfficher: T('fiches.trad.afficher'), tradMasquer: T('fiches.trad.masquer'),
    langueAvenir: T('fiches.langue.avenir'),
    // Le champ DOI, verrouillé sur le calculé : l'infobulle du champ et la case de
    // l'échappatoire. L'avertissement modal, lui, vit chez l'hôte (confirmerDoiManuel).
    doiVerrouTip: T('fiches.doi.tip'), doiManuel: T('fiches.doi.manuel')
  }, textesAuteur());
}

// La fiche d'auteur·e et sa modale (media/_auteurs.js) servent aux trois vues : leurs
// libellés vivent donc dans une seule table, ajoutée à chacune. Une clé oubliée d'un côté
// s'afficherait « undefined » sans rien casser, et personne ne le verrait.
function textesAuteur() {
  return {
    aPrenom: T('fiches.auteur.prenom'), aNom: T('fiches.auteur.nom'),
    aFonction: T('fiches.auteur.fonction'), aAffiliation: T('fiches.auteur.affiliation'),
    aOrcid: T('fiches.auteur.orcid'), aEmail: T('fiches.auteur.email'),
    retirerAuteur: T('fiches.auteur.retirer'), ajouterAuteur: T('fiches.auteur.ajouter'),
    auteurEditer: T('auteur.editer'), auteurTitre: T('auteur.titre'),
    auteurSuggestions: T('auteur.suggestions'),
    auteurSansNom: T('auteur.sansnom'), auteurSansPhoto: T('auteur.sansphoto'),
    auteurPhoto: T('auteur.photo'), auteurNomRequis: T('auteur.nomrequis'),
    auteurPhotoCachee: T('auteur.photo.cachee'), auteurAgrandir: T('auteur.agrandir'),
    enregistrerBouton: T('form.enregistrer'), annuler: T('photo.annuler'),
    photoNomRequis: T('photo.nomrequis'),
    photoDeposer: T('photo.deposer'), photoOu: T('photo.ou'),
    photoChoisirFichier: T('photo.choisirFichier'),
    vOriginal: T('photo.version.original'), vAvecFond: T('photo.version.avecfond'),
    vSansFond: T('photo.version.sansfond'),
    chargement: T('photo.chargement'), traitement: T('photo.traitement'),
    sansVisage: T('photo.sansvisage'), recadre: T('photo.recadre'),
    photoErrTropVolumineux: T('photo.err.tropvolumineux'), photoErrFormat: T('photo.err.format')
  };
}

// Le choix de licence de la carte, dans la langue de l'interface : la liste vient de
// lib/yaml.js, les libellés de lib/i18n.js. Comme typesTraduits(), elle voyage avec les
// valeurs plutôt que dans la table des textes — sept libellés de plus dans TXT n'y
// apprendraient rien, et la liste doit rester celle de yaml.js.
function licencesTraduites() {
  return LICENCES_ARTICLE.map((l) => ({ valeur: l.cle, libelle: T('licence.' + l.cle) }));
}

// Deux groupes, dans la langue par défaut du numéro.
function typesTraduits(langue) {
  const options = (liste, groupe) => liste.map((t) => ({
    valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t,
    groupe: (GROUPES_TYPES[groupe] || {})[langue] || (GROUPES_TYPES[groupe] || {}).fr || ''
  }));
  return options(TYPES_DOSSIER, 'dossier').concat(options(TYPES_HORS, 'hors'));
}

// Écrit les cartes reçues d'une webview de fiches : nettoyage, restitution des clés
// inconnues, écriture atomique. Un slug absent de listerArticles() est ignoré, et
// `slugsAutorises` restreint en plus à la liste du panneau.
function ecrireCartesArticles(fournisseur, cartes, slugsAutorises) {
  const connus = new Set(fournisseur.listerArticles());
  // Pour la permutation des statuts de traduction : une fiche sans `lang` s'affiche — et
  // se permute — sous la langue du numéro, l'hôte lit donc le changement avec ce repli.
  const langueNumero = langueRevue(fournisseur.racine);
  let n = 0;
  const erreurs = [];
  for (const slug of Object.keys(cartes || {})) {
    if (!connus.has(slug)) { continue; }           // slug inconnu : ignoré
    if (slugsAutorises && slugsAutorises.indexOf(slug) === -1) { continue; }
    const fichierMeta = cheminMeta(fournisseur.racine, slug);
    try {
      // Fichier régénéré depuis la carte de la webview : ce que la carte ne porte pas est
      // relu du fichier, sans quoi il serait perdu à chaque enregistrement. Les clés de
      // haut niveau inconnues, et `source` — le nom du Word d'origine, posé par l'import,
      // qu'aucun formulaire n'affiche ni ne renvoie.
      const carte = nettoyerCarte(cartes[slug]);
      let langAvant = null;
      try {
        const ancien = analyserMeta(fs.readFileSync(fichierMeta, 'utf8'));
        carte._inconnues = ancien._inconnues;
        if (carte.source === '') { carte.source = ancien.source; }
        langAvant = ancien.lang || langueNumero;
      } catch (e) { /* pas de fiche existante */ }
      ecrireAtomique(fichierMeta, serialiserMeta(carte));
      n++;
      // La langue de l'article a changé : la webview a permuté les contenus entre les
      // deux langues, et les statuts du suivi de traduction suivent leurs contenus —
      // sinon « finalisé » désignerait le mauvais texte. Un échec ici n'annule pas
      // l'enregistrement — la fiche est déjà écrite — mais il se DIT, sans bloquer :
      // un suivi resté sur l'ancienne langue se corrige dans le panneau « Traductions ».
      if (langAvant && carte.lang && carte.lang !== langAvant) {
        try { permuterStatutsTraduction(fournisseur.racine, slug, langAvant, carte.lang); }
        catch (e) { vscode.window.showWarningMessage(T('fiches.statuts.echec', [slug])); }
      }
    } catch (e) {
      erreurs.push(slug + ' (' + e.message + ')');
    }
  }
  return { n: n, erreurs: erreurs };
}

function htmlApercuMetadonnees(nonce) {
  const txt = JSON.stringify(Object.assign(textesCarteArticle(), {
    filtreNote: T('fiches.filtre.note'), tous: T('fiches.tous')
  }));
  return construireHtml('metadata-articles', nonce, {
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    titre: T('fiches.titre'),
    remplacements: { '__TXT__': txt },
    // Seule dérogation à la CSP : les aperçus de la modale photo, en data: URI.
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

let panneauArticles = null;

function cheminMeta(racine, slug) {
  return path.join(racine, 'articles', slug, slug + '.meta.yaml');
}

// Migration idempotente : les métadonnées encore en frontmatter partent vers
// <slug>.meta.yaml, sous la langue de la revue.
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
  const valeurs = { type: '', lang: langue, doi: String(ancien.doi || ''), title: {}, subtitle: {}, keywords: {}, author: [] };
  if (ancien.title) { valeurs.title[langue] = String(ancien.title); }
  if (ancien.subtitle) { valeurs.subtitle[langue] = String(ancien.subtitle); }
  if ((ancien.keywords || []).length > 0) { valeurs.keywords[langue] = ancien.keywords.map(String); }
  for (const a of (ancien.author || [])) {
    valeurs.author.push({ prenom: '', nom: String(a.name || ''), fonction: '', affiliation: String(a.affiliation || ''), orcid: String(a.orcid || '') });
  }
  try {
    ecrireAtomique(fichierMeta, serialiserMeta(valeurs));
    ecrireAtomique(fichierMd, serialiserFrontmatter(texte, { title: '', subtitle: '', doi: '', author: [], keywords: [] }));
  } catch (e) { /* migration au mieux : la carte restera vide */ }
}

// Le DOI calculé de chaque article, pour les formulaires de fiches : la même mécanique que
// la vue « Articles » (apercuDoi) — locale, année, numéro et rang parmi les porteurs. Rendu
// slug -> DOI, '' quand il est incalculable ou que l'article n'en reçoit pas : le champ
// verrouillé affiche alors « — ». Tous les articles sont lus, même sous filtre : le rang se
// compte sur le numéro entier.
function doisCalculesArticles(fournisseur) {
  const racine = fournisseur.racine;
  const slugs = fournisseur.listerArticles();
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : DOI incalculable, et le champ le dira par « — » */ }
  const locale = langueDefaut(valeurs);
  const annee = anneeNumero(racine, valeurs);
  const numeroRevue = String(valeurs.numero || '').trim();
  const sansDoi = articlesSansDoi(racine, slugs);
  const dois = {};
  for (const slug of slugs) {
    dois[slug] = doiCalcule(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi));
  }
  return dois;
}

// Le fichier DÉRIVÉ des DOI calculés, écrit à côté d'ausgabe.yaml : la maquette
// (bandeau DOI de pipeline/templates/szh-article.html, posé par szh-maquette.lua) doit
// imprimer le DOI courant alors que plus rien ne le stocke — le calcul vit ICI, dans le
// cockpit (un seul rang : lib/articles.js), et le pipeline ne fait que LIRE cette valeur
// déposée. Une ligne « slug: doi » par porteur, rien pour les sans-DOI. Écriture atomique
// et seulement au changement (OneDrive/SharePoint réplique chaque octet écrit) ; un
// numéro ARCHIVÉ n'est jamais touché. Appelée de rafraichirTout(), le point où tout
// converge — ordre déplacé, case « pas de DOI », article ajouté ou retiré, année ou
// numéro changés — et l'appel fréquent est inoffensif grâce à la comparaison.
const NOM_DOIS_CALCULES = 'dois-calcules.yaml';
function ecrireDoisCalcules(fournisseur) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (etatRevue(racine).archivee) { return; }      // un numéro archivé ne bouge plus
  const dois = doisCalculesArticles(fournisseur);
  const lignes = [
    '# Fichier DÉRIVÉ, écrit par le cockpit : les DOI calculés d\'après la place de',
    '# chaque article dans le numéro. Ne pas éditer — il serait réécrit tel quel au',
    '# prochain rafraîchissement. pipeline/filters/szh-maquette.lua le lit pour poser',
    '# le bandeau DOI de la couverture quand la fiche ne porte pas de DOI manuel.'
  ];
  for (const slug of Object.keys(dois)) {
    if (dois[slug] !== '') { lignes.push(slug + ': ' + dois[slug]); }
  }
  const contenu = lignes.join('\n') + '\n';
  const chemin = path.join(racine, NOM_DOIS_CALCULES);
  try {
    let ancien = null;
    try { ancien = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* pas encore écrit */ }
    if (ancien === contenu) { return; }
    ecrireAtomique(chemin, contenu);
  } catch (e) { /* au mieux : le bandeau DOI se rattrapera au prochain rafraîchissement */ }
}

// `filtre` : slugs à afficher, ou null pour tous. L'ordre reste celui de l'arbre.
function lireMetadonneesArticles(fournisseur, filtre) {
  const articles = [];
  const budget = { reste: BUDGET_VIGNETTES };
  const dois = doisCalculesArticles(fournisseur);
  for (const slug of fournisseur.listerArticles()) {
    if (filtre && filtre.indexOf(slug) === -1) { continue; }
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = analyserMeta('');                 // forme de la carte vide
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide */ }
    delete valeurs._inconnues;                     // la webview n'a pas à les voir
    // À côté de la fiche, jamais dedans : ces vignettes ne doivent pas repartir dans le
    // meta.yaml au prochain enregistrement. Le DOI calculé non plus : la carte l'affiche,
    // seul un DOI manuel (case cochée) revient dans la fiche.
    articles.push({
      slug: slug, valeurs: valeurs, doiCalcule: dois[slug] || '',
      apercusAuteurs: (valeurs.author || [])
        .map((a) => vignetteAuteur(fournisseur.racine, slug, a.photo, budget))
    });
  }
  return articles;
}

// Le champ `photo` est posé par la modale, jamais saisi : seul un chemin relatif sous
// portraits/, sans remontée ni segment vide, est accepté.
function assainirCheminPhoto(valeur) {
  const c = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (c === '' || c.length > 300) { return ''; }
  if (c.indexOf('\\') !== -1 || /[\r\n:]/.test(c)) { return ''; }
  const morceaux = c.split('/');
  if (morceaux.length !== 2 || morceaux[0] !== 'portraits') { return ''; }
  const nom = morceaux[1];
  if (nom === '' || nom === '.' || nom === '..') { return ''; }
  return c;
}

function nettoyerCarte(brut) {
  const texteCourt = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, max).trim();
  const carte = { type: '', lang: '', source: '', licence: '', doi: texteCourt(brut && brut.doi, 200), title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
  const type = texteCourt(brut && brut.type, 40);
  if (TYPES_ARTICLE.indexOf(type) !== -1) { carte.type = type; }
  // Choix fermé : une valeur hors fr/de/it repart vide, et l'article suivra le numéro.
  carte.lang = normaliserLangueArticle(brut && brut.lang);
  // Le Word d'origine n'est jamais saisi ni affiché : il arrive ici seulement quand
  // l'appelant a lu la fiche (suivi de traduction). Vide, ecrireCartesArticles le relit
  // du fichier — c'est là que se joue sa survie à un aller-retour du formulaire.
  carte.source = texteCourt(brut && brut.source, 300);
  // Choix fermé aussi : hors liste, la carte repart sans licence, donc sous celle de la
  // revue. Une valeur de travers ne doit jamais atteindre la couverture.
  carte.licence = normaliserLicence(brut && brut.licence);
  for (const cle of ['title', 'subtitle', 'resume']) {
    const map = (brut && brut[cle]) || {};
    const max = cle === 'resume' ? 2000 : 500;   // le résumé est plus long
    for (const l of LANGUES_META) {
      const t = texteCourt(map[l], max);
      if (t !== '') { carte[cle][l] = t; }
    }
  }
  // Les listes de mots-clés des langues sont appariées par position : c'est le seul lien
  // entre « diagnostic » et « Diagnose ». Retirer un vide au milieu décalerait tous les
  // suivants ; alignerMotsCles les remplit donc par une marque.
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
      // 200 caractères pour l'email, 300 pour le reste ; la photo est assainie en plus.
      for (const c of CHAMPS_AUTEUR) { propre[c] = texteCourt(a && a[c], c === 'email' ? 200 : 300); }
      propre.photo = assainirCheminPhoto(propre.photo);
      carte.author.push(propre);
    }
  }
  return carte;
}

// ---- Suivi de traduction ---------------------------------------------------------
// Panneau szhTraduction en colonne 1, aperçu en colonne 2. Deux fichiers, deux rôles,
// détaillés dans l'en-tête de lib/traduction.js : les textes traduits vont dans
// <slug>.meta.yaml, publié, l'état d'atelier dans <slug>.traduction.yaml, qui ne l'est pas.

const ICONES_STATUT = {
  'pas-pret': 'circle-large-outline',
  'pret-traduction': 'arrow-right',
  'pret-relecture': 'eye',
  'finalise': 'pass-filled'
};
// « charts.orange » est trop clair sur fond blanc : l'ambre d'avertissement de l'éditeur
// est fait pour se voir sur les deux fonds, et c'est déjà celui des encadrés de qualité.
const COULEURS_STATUT = {
  'pret-traduction': 'charts.blue',
  'pret-relecture': 'editorWarning.foreground',
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

// `source` est passée par les boucles pour ne pas relire ausgabe.yaml à chaque article.
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

// « Titre et sous-titre (DE) » quand les deux existent, sinon « Titre (DE) ».
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

// « traduit » ou « à traduire », sauf pour les mots-clés : « 2/4 traduits ».
function etatRemplissageGroupe(groupe) {
  if (groupe.groupe === 'motscles') {
    const l = groupe.lignes[0];
    return T('trad.avancement', [l.remplies, l.total]);
  }
  return groupe.rempli ? T('trad.traduit') : T('trad.atraduire');
}

// Au changement de langue d'un article, le formulaire (webview) permute les contenus des
// champs multilingues entre l'ancienne et la nouvelle langue. Les statuts du sidecar
// <slug>.traduction.yaml sont indexés champ×langue : ils font le même échange, pour
// continuer à désigner le texte qu'ils qualifiaient. Un statut qui atterrit sur la langue
// source du suivi devient dormant — et revient tel quel si on re-permute.
// Limite assumée : plusieurs changements de langue AVANT le même enregistrement ne
// laissent voir à l'hôte que les deux langues extrêmes ; l'enregistrement automatique
// (quelques secondes après le geste) rend le cas marginal.
function permuterStatutsTraduction(racine, slug, avant, apres) {
  if (!avant || !apres || avant === apres) { return; }
  const suivi = lireSuiviTraduction(racine, slug);
  const statuts = suivi.statuts || {};
  let change = false;
  for (const champ of CHAMPS_TRADUISIBLES) {
    const cleAvant = cleChamp(champ, avant);
    const cleApres = cleChamp(champ, apres);
    const a = statuts[cleAvant];
    const b = statuts[cleApres];
    if (a === b) { continue; }
    change = true;
    if (b === undefined) { delete statuts[cleAvant]; } else { statuts[cleAvant] = b; }
    if (a === undefined) { delete statuts[cleApres]; } else { statuts[cleApres] = a; }
  }
  if (!change) { return; }                         // rien à échanger : fichier intact
  ecrireSuiviTraduction(racine, slug, suivi);
}

// Écrit le sidecar, ou le supprime s'il ne reste rien à retenir. Écrit par le panneau
// « Traductions », par les campagnes de statut, et par la permutation ci-dessus.
function ecrireSuiviTraduction(racine, slug, suivi) {
  const chemin = cheminTraduction(racine, slug);
  const contenu = serialiserTraduction(suivi);
  if (contenu === '') {
    try { if (fs.existsSync(chemin)) { fs.unlinkSync(chemin); } } catch (e) { /* déjà parti */ }
    return;
  }
  ecrireAtomique(chemin, contenu);
}

// Lance la campagne : n'avance que les champs « pas prêt », pour ne pas faire reculer un
// champ déjà en relecture ou finalisé.
// Poser un état sur tous les blocs de tous les articles du numéro. `seulementPasPret`
// restreint aux blocs qui n'ont pas commencé — c'est ce que veut la commande de la palette,
// « rendre prêt tout ce qui ne l'est pas encore », et ce que ne veut pas un bouton de la
// vue d'ensemble : trois boutons côte à côte doivent se comporter pareil, sinon l'un d'eux
// semble ne rien faire. L'appelant fait confirmer quand il écrit partout.
// -> nombre de blocs touchés.
function marquerToutStatutRevue(fournisseur, rafraichirTout, statut, seulementPasPret) {
  if (!fournisseur.racine) { return 0; }
  const racine = fournisseur.racine;
  const source = langueRevue(racine);
  const erreurs = [];
  let n = 0;
  for (const slug of fournisseur.listerArticles()) {
    const etat = etatTraduction(racine, slug, source);
    const statuts = Object.assign({}, etat.suivi.statuts);
    let change = false;
    for (const ligne of etat.lignes) {
      if (seulementPasPret && ligne.statut !== STATUT_DEFAUT) { continue; }
      if (ligne.statut === statut) { continue; }
      statuts[ligne.cle] = statut;
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
  if (rafraichirTout) { rafraichirTout(); }
  rafraichirPanneauTraduction(fournisseur);        // le panneau ouvert suit le bouton
  return n;
}

// La commande de la palette : « prêt pour traduction » sur tout ce qui ne l'est pas encore.
// Elle ne défait donc rien, et n'a pas à être confirmée.
function marquerToutPretTraduction(fournisseur, rafraichirTout) {
  const n = marquerToutStatutRevue(fournisseur, rafraichirTout, 'pret-traduction', true);
  vscode.window.setStatusBarMessage(n > 0 ? T('trad.toutpret.fait', [n]) : T('trad.toutpret.rien'), 5000);
}

// ---- Vues d'ensemble de section ------------------------------------------------
// Cliquer l'onglet d'une section de la barre latérale ouvre une page : les commandes
// globales y ont un bouton avec un texte, au lieu des pictogrammes muets que l'arbre
// alignait dans sa marge. La webview est la même pour toutes les sections
// (media/vue-ensemble.*) : elle ne fait que poser ce que l'hôte lui envoie.

const panneauxVue = new Map();       // type -> panneau, un seul par section

function htmlVueEnsemble(nonce, titre) {
  return construireHtml('vue-ensemble', nonce, {
    cssPartage: ['_design.css', '_liste.css'], titre: titre
  });
}

function textesVueEnsemble() {
  return { ouvrir: T('vue.ouvrir'), listeVide: T('vue.rien') };
}

// Ton et pictogramme d'un état d'atelier, les mêmes que dans l'arbre : bleu ce qui est
// lancé, orange ce qui attend un regard, vert ce qui est clos, rien quand rien n'a commencé.
const PASTILLE_STATUT = {
  'pas-pret': { ton: '', icone: 'cercle' },
  'pret-traduction': { ton: 'info', icone: 'fleche' },
  'pret-relecture': { ton: 'attention', icone: 'oeil' },
  finalise: { ton: 'ok', icone: 'ok' }
};

// Un article par ligne : son avancement, son état, et la question posée s'il y en a une.
function vueTraductions(fournisseur) {
  const racine = fournisseur.racine;
  const source = langueRevue(racine);
  const lignes = [];
  const slugs = fournisseur.listerArticles();
  for (let index = 0; index < slugs.length; index++) {
    const slug = slugs[index];
    const etat = etatTraduction(racine, slug, source);
    // Le titre de l'article, et son slug juste à côté : le même nom que partout ailleurs.
    // La fiche vient d'etatTraduction, qui l'a déjà lue.
    const nom = libelleArticle(index, slug, titreFiche(etat.meta, source));
    if (etat.lignes.length === 0) {
      lignes.push({ cle: slug, titre: nom, meta: T('trad.rien.court'), pastilles: [], ouvrir: false });
      continue;
    }
    const r = etat.resume;
    // Des états mêlés dans un même article : le plus prudent des deux mondes, l'attention.
    const past = r.melange
      ? { ton: 'attention', icone: 'attention' }
      : (PASTILLE_STATUT[r.statut] || { ton: '', icone: 'cercle' });
    lignes.push({
      cle: slug, titre: nom,
      meta: slug + ' · ' + T('trad.avancement', [r.remplis, r.total]),
      pastilles: [{
        texte: r.melange ? T('trad.statut.melange') : T('trad.statut.' + r.statut),
        ton: past.ton, icone: past.icone
      }],
      notif: etat.suivi.commentaire !== ''
        ? { ton: 'info', texte: etat.suivi.commentaire } : null,
      ouvrir: true
    });
  }
  return {
    titre: T('trad.titre'),
    boutons: [
      { id: 'tout-traduction', libelle: T('trad.court.traduction'), icone: 'fleche', tip: T('trad.vue.tout.tip') },
      { id: 'tout-relecture', libelle: T('trad.court.relecture'), icone: 'oeil', tip: T('trad.vue.tout.tip') },
      { id: 'tout-finalise', libelle: T('trad.court.finalise'), icone: 'ok', tip: T('trad.vue.tout.tip') },
      { id: 'envoyer', libelle: T('trad.envoyer'), icone: 'traduction', tip: T('trad.envoyer.tooltip') }
    ],
    lignes: lignes
  };
}

// Ce qui attend d'être converti, et ce que la dernière conversion a dit — ses échecs
// surtout, qui ne vivaient que dans le terminal de la tâche.
function vueWord(fournisseur) {
  const racine = fournisseur.racine;
  const lignes = [];
  for (const entree of lireRapportImport(racine)) {
    lignes.push({
      cle: '', groupe: T('word.vue.rapport'), titre: entree.nom,
      pastilles: [{ texte: entree.libelle, ton: entree.ton, icone: entree.icone }],
      notif: entree.ligne === '' ? null : { ton: entree.ton === '' ? 'info' : entree.ton, texte: entree.ligne },
      ouvrir: false
    });
  }
  const noms = fournisseur._docxEnAttente(path.join(racine, 'articles-word'));
  for (const nom of noms) {
    const slug = slugifierArticle(nom);
    const deja = fournisseur._articleExiste(slug);
    lignes.push({
      // Le nom du fichier est la clé : c'est lui que « Réimporter cet article » reçoit.
      cle: nom, groupe: T('word.vue.attente'), titre: nom, meta: slug,
      pastilles: deja
        ? [{ texte: T('arbre.deja.badge'), ton: 'attention', icone: 'attention' }]
        : [{ texte: T('word.vue.attente.badge'), ton: 'info', icone: 'fleche' }],
      notif: deja ? { ton: 'attention', texte: T('arbre.deja.tooltip') } : null,
      // Le geste que le message du redépôt nomme, à l'endroit où le rédacteur se trouve
      // quand il vient de déposer le Word corrigé. Sur un fichier dont aucun article
      // n'existe encore, il n'y a rien à réimporter : c'est la conversion qu'il faut.
      actions: deja
        ? [{ id: 'reimporter', libelle: T('cmd.reimporter.court'), icone: 'fleche',
             tip: T('cmd.reimporter.tip') }]
        : [],
      ouvrir: false
    });
  }
  return {
    titre: T('word.vue.titre'),
    boutons: [
      { id: 'convertir', libelle: T('word.vue.convertir'), icone: 'fleche', principal: true },
      { id: 'vider', libelle: T('word.vue.vider'), icone: 'poubelle', danger: true,
        desactive: noms.length === 0, tip: T('word.vue.vider.tip') }
    ],
    lignes: lignes
  };
}

// Le rapport de la dernière conversion, écrit par la cible `import` du Makefile.
//
// Les lignes « [import-avertissement] » ne passent pas par ici : elles portent un code
// stable et deux langues, et lib/journal.js sait déjà en faire une phrase. Sans cette
// dérivation, la règle « toute ligne contenant ⚠ est un échec » ci-dessous les laissait
// filer en « converti » et affichait la ligne brute, deux langues comprises, comme titre
// de carte.
function lireRapportImport(racine) {
  let texte = '';
  try { texte = fs.readFileSync(path.join(racine, 'articles-word', '.import.log'), 'utf8'); }
  catch (e) { return []; }
  const langue = langueCockpit();
  const avertissements = new Map();
  for (const c of analyserJournal(texte, langue)) {
    if (c.source !== 'import' || c.code === 'echec' || c.code === 'restes') { continue; }
    avertissements.set(c.code + ' ' + c.slug, c);
  }
  const entrees = [];
  for (const c of avertissements.values()) {
    entrees.push({
      nom: c.slug === '' ? T('ctl.numero') : T('ctl.article', [c.slug]),
      ligne: phraseConstat(c, langue),
      libelle: T(c.ton === 'danger' ? 'ctl.badge.bloquant' : 'ctl.badge.avert'),
      ton: c.ton, icone: c.ton
    });
  }
  for (const brute of texte.split(/\r?\n/)) {
    if (brute.indexOf('[import-avertissement]') === 0) { continue; }
    const ligne = brute.replace(/^\[import\]\s*/, '').trim();
    if (ligne === '') { continue; }
    let ton = 'ok';
    let icone = 'ok';
    let libelle = T('word.rapport.converti');
    // Les motifs tolèrent l'absence d'accent : le rapport vient d'un shell, dont la locale
    // n'est pas garantie.
    // Le bilan d'abord : il compte les échecs, et se ferait classer comme l'un d'eux. Le
    // motif est ancré en début de ligne : un fichier « Dossier terminé 2026.docx » ne doit
    // pas voir son échec se déguiser en bilan.
    if (/^termin[ée]/i.test(ligne)) { ton = ''; icone = 'info'; libelle = T('word.rapport.bilan'); }
    else if (ligne.indexOf('⚠') !== -1 || /[ée]chec/i.test(ligne)) { ton = 'danger'; icone = 'danger'; libelle = T('word.rapport.echec'); }
    else if (/d[ée]j[àa] converti|ignor/i.test(ligne)) { ton = 'attention'; icone = 'attention'; libelle = T('word.rapport.ignore'); }
    // Le nom du fichier en tête de ligne, la phrase en dessous : c'est par le fichier
    // qu'on cherche, et la phrase est ce qu'il faut lire quand ça a raté.
    // Les .docx livrés portent presque toujours des espaces : on prend tout ce qui suit le
    // deux-points jusqu'à l'extension, sans quoi le titre de la carte serait un fragment.
    const m = ligne.match(/:\s*(.+?\.docx)/i);
    entrees.push({ nom: m ? m[1] : ligne, ligne: m ? ligne : '', libelle: libelle, ton: ton, icone: icone });
  }
  return entrees;
}

// ---- Contrôles de la compilation ------------------------------------------------
//
// La chaîne repère une dizaine de choses à chaque compilation, et tout partait sur la
// sortie d'erreur d'un terminal que `reveal: silent` n'ouvre jamais. Les tâches écrivent
// désormais leur sortie dans <numéro>/.szh-journal.log (vscodium-user/tasks.json), et
// lib/journal.js la traduit en constats. Ici : les relire à la fin de chaque tâche, les
// dire une fois, et les garder à portée de clic.
//
// Rien de neuf à l'écran : la vue est la vue d'ensemble des autres sections
// (media/vue-ensemble.*, SZH.listeCartes), l'avis est une notification de l'éditeur, et
// le compteur est un article de la barre d'état, comme la bascule d'aperçu.

const JOURNAL_TACHE = '.szh-journal.log';

// Le dernier journal lu, par racine de numéro : la barre d'état et la vue le relisent sans
// recompiler, et rouvrir la vue ne perd pas ce qui a été dit.
//
// `reimport` est à part, et doit l'être : le réimport ne passe pas par une tâche, ses
// constats ne sont donc pas dans .szh-journal.log, et la recompilation qui le suit
// aussitôt les effacerait s'ils étaient mêlés à ceux de la chaîne. Ils passent devant —
// c'est le geste que le rédacteur vient de faire.
let dernierJournal = { racine: null, constats: [], code: 0, reimport: [] };

// Ce que la vue et la barre d'état ont à montrer, les deux listes réunies.
function constatsCourants(racine) {
  if (dernierJournal.racine !== racine) { return lireJournalTache(racine); }
  return dernierJournal.reimport.concat(dernierJournal.constats);
}

// Les constats du dernier réimport, posés ou effacés. Un nouveau réimport remplace ceux
// du précédent : deux jeux d'avertissements sur le même article se contrediraient.
function poserConstatsReimport(racine, constats) {
  if (dernierJournal.racine !== racine) {
    dernierJournal = { racine: racine, constats: lireJournalTache(racine), code: 0, reimport: [] };
  }
  dernierJournal.reimport = constats || [];
  majBarreControles();
}

function lireJournalTache(racine) {
  if (!racine) { return []; }
  let texte = '';
  try { texte = fs.readFileSync(path.join(racine, JOURNAL_TACHE), 'utf8'); }
  catch (e) { return []; }                           // aucune compilation depuis l'ouverture
  return analyserJournal(texte, langueCockpit());
}

// Ton d'une pastille et son pictogramme : les mêmes trois tons que partout ailleurs dans
// le cockpit, pour qu'un avertissement se reconnaisse sans être lu.
const PASTILLE_CONSTAT = {
  danger: { badge: 'ctl.badge.bloquant', groupe: 'ctl.groupe.bloquant', icone: 'danger' },
  attention: { badge: 'ctl.badge.avert', groupe: 'ctl.groupe.avert', icone: 'attention' },
  info: { badge: 'ctl.badge.info', groupe: 'ctl.groupe.info', icone: 'info' }
};

const SOURCES_CONSTAT = {
  citations: 'ctl.source.citations', import: 'ctl.source.import', meta: 'ctl.source.meta',
  pdfua: 'ctl.source.pdfua', pipeline: 'ctl.source.pipeline', rendu: 'ctl.source.rendu'
};

// Une carte par constat : l'article concerné en tête, la nature du contrôle en mesure, la
// phrase dans le corps, le ton en pastille. Les bloquants d'abord — l'ordre de lecture est
// celui des gestes à faire.
function vueControles(fournisseur) {
  const racine = fournisseur.racine;
  const constats = constatsCourants(racine);
  const langue = langueCockpit();
  const connus = new Set(fournisseur.listerArticles());
  const lignes = [];
  for (const ton of ['danger', 'attention', 'info']) {
    for (const c of constats) {
      if (c.ton !== ton) { continue; }
      const past = PASTILLE_CONSTAT[ton] || PASTILLE_CONSTAT.info;
      // « Ouvrir » n'a de sens que sur un article qui existe encore : un constat peut
      // nommer un Word qui n'est jamais devenu un article.
      const ouvrable = c.slug !== '' && connus.has(c.slug);
      lignes.push({
        cle: ouvrable ? c.slug : '',
        groupe: T(past.groupe),
        titre: c.slug === '' ? T('ctl.numero') : T('ctl.article', [c.slug]),
        meta: T(SOURCES_CONSTAT[c.source] || 'ctl.source.pipeline'),
        notif: { ton: ton, texte: phraseConstat(c, langue) },
        pastilles: [{ texte: T(past.badge), ton: ton === 'info' ? '' : ton, icone: past.icone }],
        ouvrir: ouvrable
      });
    }
  }
  return {
    titre: T('ctl.titre'),
    boutons: [
      { id: 'recompiler', libelle: T('ctl.recompiler'), icone: 'fleche', principal: true,
        tip: T('ctl.recompiler.tip') }
    ],
    lignes: lignes
  };
}

// La barre d'état : le seul endroit qui reste visible quand la notification a disparu.
// Rien à afficher quand rien n'a été relevé — un compteur à zéro est du bruit.
let barreControles = null;

function majBarreControles() {
  if (!barreControles) { return; }
  const r = resumeJournal(dernierJournal.reimport.concat(dernierJournal.constats));
  if (r.bloquants > 0) { barreControles.text = T('ctl.barre.bloquant', [r.bloquants]); }
  else if (r.avertissements > 0) { barreControles.text = T('ctl.barre.avert', [r.avertissements]); }
  else { barreControles.hide(); return; }
  barreControles.tooltip = T('ctl.barre.tooltip');
  barreControles.show();
}

// Fin d'une tâche de la chaîne : on relit le journal, on met le compteur à jour, et on le
// dit une fois. Le code de sortie sépare les deux tons du message : « la compilation s'est
// arrêtée » n'est vrai que s'il est non nul, et un PDF sorti sans son image n'est pas un
// arrêt même s'il n'est pas publiable.
async function relireJournal(fournisseur, code) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const constats = lireJournalTache(racine);
  // Ce que le dernier réimport a signalé survit à la compilation qui le suit : un tableau
  // en conflit reste vrai après un Ctrl+S, et la chaîne ne le connaît pas.
  const reimport = dernierJournal.racine === racine ? dernierJournal.reimport : [];
  dernierJournal = { racine: racine, constats: constats, code: code, reimport: reimport };
  majBarreControles();
  const ouverte = panneauxVue.get('controles');
  if (ouverte) { envoyerVue(ouverte, fournisseur, 'controles'); }
  const r = resumeJournal(constats);
  if (r.bloquants === 0 && r.avertissements === 0) { return; }
  const notifier = async () => {
    const bouton = T('ctl.notif.bouton');
    const ouvrir = () => vscode.commands.executeCommand('szh.vueControles');
    if (r.bloquants > 0) {
      const cle = code === 0 ? 'ctl.notif.bloquant' : 'ctl.notif.arret';
      const choix = await vscode.window.showErrorMessage(T(cle, [r.bloquants]), bouton);
      if (choix === bouton) { await ouvrir(); }
      return;
    }
    // Non bloquant : un avertissement, pas un échec. Le ton de la notification le dit, et
    // c'est tout ce que le rédacteur en verra s'il ne clique pas.
    const choix = await vscode.window.showWarningMessage(
      T('ctl.notif.avert', [r.avertissements]), bouton);
    if (choix === bouton) { await ouvrir(); }
  };
  // La notification attend qu'un QuickPick ouvert se ferme : la fin d'une compilation ne
  // doit pas interrompre le geste en cours. La barre d'état et la vue, inoffensives pour
  // le focus, ont déjà été mises à jour plus haut. Si plusieurs compilations finissent
  // pendant le geste, seul le dernier avis part — les précédents sont périmés.
  differer('notif-journal', () => {
    notifier().catch(() => { /* un avis raté ne casse pas la compilation */ });
  });
}

const VUES = {
  traductions: { charge: vueTraductions, id: 'szhVueTraductions' },
  word: { charge: vueWord, id: 'szhVueWord' },
  controles: { charge: vueControles, id: 'szhVueControles' }
};

// Hors de ouvrirVueEnsemble : la fin d'une compilation doit pouvoir rafraîchir une vue
// déjà ouverte sans repasser par la commande, qui la révélerait sous les yeux du rédacteur.
function envoyerVue(panneau, fournisseur, type) {
  const charge = VUES[type].charge(fournisseur);
  repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, charge, {
    accent: lireCouleurAccent(fournisseur.racine), i18n: textesVueEnsemble()
  }));
  panneau.title = charge.titre;
}

async function ouvrirVueEnsemble(fournisseur, rafraichirTout, type) {
  if (!fournisseur.racine || !VUES[type]) { return; }
  const def = VUES[type];
  const envoyer = (panneau) => envoyerVue(panneau, fournisseur, type);
  const ouvert = panneauxVue.get(type);
  if (ouvert) { ouvert.reveal(vscode.ViewColumn.One); envoyer(ouvert); return; }
  const charge = def.charge(fournisseur);
  const panneau = vscode.window.createWebviewPanel(
    def.id, charge.titre, vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauxVue.set(type, panneau);
  panneau.onDidDispose(() => { if (panneauxVue.get(type) === panneau) { panneauxVue.delete(type); } });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyer(panneau); return; }
    if (msg.type === 'ouvrir') {
      // Par la commande, et non par la fonction : c'est cmdEcriture qui porte la garde du
      // verrou. Ouvrir en direct laissait écrire un numéro verrouillé, l'enregistrement
      // automatique du panneau de traduction s'en chargeant trois secondes plus tard.
      if (type === 'traductions') {
        await vscode.commands.executeCommand('szh.traduction', { slug: String(msg.cle || '') });
      }
      if (type === 'controles') {
        await vscode.commands.executeCommand('szh.ouvrirArticle', String(msg.cle || ''));
      }
      return;
    }
    if (msg.type !== 'action') { return; }
    // L'état part APRÈS le re-rendu : « valeurs » reconstruit la barre, et donc efface la
    // zone d'état. Une commande déléguée qui lève ne doit pas laisser la vue périmée.
    let dit = null;
    try {
      dit = await actionVue(fournisseur, rafraichirTout, type, String(msg.id || ''),
        String(msg.cle || ''));
    }
    catch (e) { dit = T('err.commande', [e && e.message ? e.message : String(e)]); }
    if (panneauxVue.get(type) !== panneau) { return; }
    envoyer(panneau);
    if (dit) { repondrePanneau(panneau, { type: 'etat', message: dit }); }
  });
  panneau.webview.html = htmlVueEnsemble(crypto.randomBytes(16).toString('hex'), charge.titre);
}

// Les commandes globales d'une section. Celles qui écrivent partout sont confirmées : un
// clic ne doit pas repasser tout un numéro en relecture par surprise.
// -> le message à afficher dans la barre, ou null.
// `cle` est vide pour les commandes de la barre, et porte la ligne pour un bouton de carte.
async function actionVue(fournisseur, rafraichirTout, type, id, cle) {
  if (type === 'traductions') {
    if (id === 'envoyer') { await vscode.commands.executeCommand('szh.envoyerTraduction'); return null; }
    const statuts = { 'tout-traduction': 'pret-traduction', 'tout-relecture': 'pret-relecture', 'tout-finalise': 'finalise' };
    const statut = statuts[id];
    if (!statut) { return null; }
    if (refuserSiVerrouille()) { return null; }
    // Les trois écrivent partout, y compris à rebours du flux : on confirme les trois.
    const bouton = T('vue.confirmer');
    const choix = await vscode.window.showWarningMessage(
      T('trad.vue.tout.question', [T('trad.statut.' + statut)]),
      { modal: true, detail: T('trad.vue.tout.detail') }, bouton);
    if (choix !== bouton) { return null; }
    return T('vue.faits', [marquerToutStatutRevue(fournisseur, rafraichirTout, statut, false)]);
  }
  if (type === 'controles') {
    // Recompiler refait tous les contrôles : c'est le seul geste global de cette vue, le
    // reste se corrige article par article.
    if (id === 'recompiler') { await vscode.commands.executeCommand('szh.toutExporter'); }
    return null;
  }
  if (type === 'word') {
    if (id === 'convertir') { await vscode.commands.executeCommand('szh.convertirEnAttente'); return null; }
    // Le bouton d'une carte : le Word corrigé d'un article qui existe déjà.
    if (id === 'reimporter' && cle) {
      await vscode.commands.executeCommand('szh.reimporterArticle', { word: cle });
      return null;
    }
    if (id !== 'vider') { return null; }
    if (refuserSiVerrouille()) { return null; }
    // Une conversion en cours parcourt ce dossier : lui retirer ses fichiers sous les pieds
    // fait échouer l'import et efface l'article a moitié écrit.
    if (buildEnCours || importEnCours) { return T('statut.occupe'); }
    const noms = fournisseur._docxEnAttente(path.join(fournisseur.racine, 'articles-word'));
    if (noms.length === 0) { return null; }
    const bouton = T('word.vue.vider.bouton');
    const choix = await vscode.window.showWarningMessage(
      T('word.vue.vider.question', [noms.length]),
      { modal: true, detail: T('word.vue.vider.detail') }, bouton);
    if (choix !== bouton) { return null; }
    const erreurs = [];
    for (const nom of noms) {
      try { fs.unlinkSync(path.join(fournisseur.racine, 'articles-word', nom)); }
      catch (e) { erreurs.push(nom); }
    }
    if (erreurs.length > 0) { vscode.window.showErrorMessage(T('word.vue.vider.erreur', [erreurs.join(', ')])); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('word.vue.vide', [noms.length - erreurs.length]);
  }
  return null;
}

// ---- Vue « Articles » -----------------------------------------------------------
//
// La vue qui monte un numéro : l'ordre des articles, l'avancement de chacun, et les
// métadonnées du numéro au même endroit, parce qu'on les regarde ensemble. Elle a sa page
// (media/articles.*) parce qu'elle porte un formulaire, mais rien n'y est recopié : ses
// cartes et sa barre sont celles des autres vues d'ensemble (SZH.listeCartes,
// SZH.barreBoutons) et son formulaire du numéro est celui de la page « Méta-données du
// numéro » (SZH.formulaireNumero).

let panneauVueArticles = null;

function textesArticles() {
  return Object.assign(textesNumero(), {
    ouvrir: T('vue.ouvrir'),
    // `listeVide` et non `rien` : `rien` est déjà « Aucune modification » dans la table du
    // formulaire du numéro, que cette table étend.
    listeVide: T('art.vue.rien'),
    tachesTitre: T('art.taches.titre'),
    tachesAide: T('art.taches.aide'),
    tachesFr: T('art.taches.fr'),
    tachesDe: T('art.taches.de'),
    tachesAjouter: T('art.taches.ajouter'),
    tachesRetirer: T('art.taches.retirer'),
    tachesEnregistrer: T('form.enregistrer'),
    tachesEnregistrees: T('art.taches.enregistrees'),
    tachesFermer: T('art.taches.fermer'),
    // La case « pas de DOI » : le seul texte que la page écrit elle-même. Les intitulés et
    // les valeurs de l'aperçu, eux, arrivent tout faits dans chaque ligne — c'est l'hôte qui
    // sait dire une licence ou une rubrique. L'avertissement « aperçu seul » est dans le
    // gabarit de la page, où il ne s'affiche qu'une fois.
    doiCase: T('art.doi.case'),
    doiCaseTip: T('art.doi.case.tip'),
    revues: { revue: T('meta.revue.revue'), zeitschrift: T('meta.revue.zeitschrift') }
  });
}

function htmlArticles(nonce) {
  return construireHtml('articles', nonce, {
    cssPartage: ['_design.css', '_liste.css', '_numero.css'], jsPartage: ['_numero.js'],
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'",
    titre: T('art.vue.titre'), remplacements: { '__TXT__': JSON.stringify(textesArticles()) }
  });
}

// Les pastilles d'une carte : l'avancement des tâches, puis le compteur d'images.
//
// Bleu ce qui a commencé, vert ce qui est clos, rien quand rien n'est fait : le même code
// de couleurs que les états d'atelier des traductions.
//
// Sorti de chargeArticles() parce que cocher une case ne renvoie QUE ces pastilles, et
// jamais la liste entière : la reconstruire ferait perdre au clavier le focus de la case
// qu'il vient d'utiliser. Les deux pastilles partent donc ensemble, sinon cocher une tâche
// effacerait le compteur d'images.
function pastillesCarte(avance, images) {
  const pastilles = [];
  if (avance.total > 0) {
    pastilles.push({
      texte: avance.toutes
        ? T('art.taches.toutes')
        : T('art.taches.avancement', [avance.faites, avance.total]),
      ton: avance.toutes ? 'ok' : (avance.faites > 0 ? 'info' : ''),
      icone: avance.toutes ? 'ok' : (avance.faites > 0 ? 'fleche' : 'cercle')
    });
  }
  // Un compteur à zéro est du bruit : un article sans image n'a rien à dire là-dessus.
  if (images && images.total > 0) {
    const manque = images.sansAlt + images.sansLegende;
    pastilles.push({
      texte: T('art.images.compteur', [images.total]),
      ton: manque > 0 ? 'attention' : '',
      icone: manque > 0 ? 'attention' : 'camera'
    });
  }
  return pastilles;
}

// ---- L'aperçu des métadonnées, sur la carte --------------------------------------
//
// Non éditable, et c'est tout l'intérêt : on regarde une carte d'article vingt fois pour
// une fois qu'on la corrige, et un formulaire ouvert est un formulaire où l'on efface par
// mégarde. Les deux boutons du pied mènent aux formulaires qui, eux, écrivent.
//
// « Le plus compact possible mais lisible » : une ligne par champ, un badge de langue au
// lieu d'un intitulé répété, et les textes longs coupés. Ce qui est coupé est décidé ici et
// non deviné : le résumé et les mots-clés sont les deux seuls champs dont la longueur n'a
// pas de limite, et les seuls vraiment tronqués.
const APERCU_COURT = 90;      // titre, sous-titre : un titre de la revue tient là-dedans
const APERCU_LONG = 130;      // résumé, mots-clés : de quoi reconnaître, pas de quoi relire

function couperApercu(texte, limite) {
  const t = String(texte === undefined || texte === null ? '' : texte).replace(/\s+/g, ' ').trim();
  return t.length <= limite ? t : t.slice(0, limite - 1).replace(/\s+\S*$/, '') + '…';
}

// Une ligne « un intitulé, une valeur par langue ». Seules les langues où quelque chose est
// écrit paraissent : un article monolingue ne montre pas deux lignes vides.
function ligneApercuLangues(libelle, map, limite) {
  const valeurs = [];
  for (const l of LANGUES_META) {
    const t = couperApercu((map || {})[l], limite);
    if (t !== '') { valeurs.push({ marque: l.toUpperCase(), texte: t }); }
  }
  return { libelle: libelle, valeurs: valeurs };
}

// Les mots-clés : une ligne par langue, la liste mise à plat. Le séparateur est celui des
// listes du cockpit.
function ligneApercuMotsCles(meta) {
  const plat = {};
  for (const l of LANGUES_META) {
    const liste = ((meta.keywords || {})[l] || []).map((x) => String(x).trim()).filter((x) => x !== '');
    if (liste.length > 0) { plat[l] = liste.join(' · '); }
  }
  return ligneApercuLangues(T('trad.champ.keywords'), plat, APERCU_LONG);
}

// Les auteur·e·s : l'identité d'abord, puis ce qui la situe, puis en badges ce que la fiche
// porte DÉJÀ — l'ORCID, l'adresse, la photo. Les valeurs elles-mêmes ne sont pas affichées :
// une adresse d'auteur·e n'a rien à faire dans un aperçu qui reste ouvert à l'écran.
function ligneApercuAuteurs(meta) {
  const valeurs = [];
  for (const a of (meta.author || [])) {
    const identite = [a.prenom, a.nom].map((x) => String(x || '').trim()).filter((x) => x !== '');
    const situe = [a.fonction, a.affiliation].map((x) => String(x || '').trim()).filter((x) => x !== '');
    const marques = [];
    if (String(a.orcid || '').trim() !== '') { marques.push(T('art.apercu.orcid')); }
    if (String(a.email || '').trim() !== '') { marques.push(T('art.apercu.courriel')); }
    if (String(a.photo || '').trim() !== '') { marques.push(T('art.apercu.photo')); }
    valeurs.push({
      marque: '',
      // Le prénom et le nom font UN nom, séparés d'une espace ; ce qui situe la personne
      // vient après, derrière le point médian des listes du cockpit.
      texte: couperApercu([identite.join(' ')].concat(situe).filter((x) => x !== '').join(' · '),
        APERCU_LONG),
      marques: marques
    });
  }
  return { libelle: T('fiches.auteurs'), valeurs: valeurs };
}

// Le nom court de la licence : « CC-BY 4.0 ». La table de lib/yaml.js le porte déjà, sauf
// pour « droits réservés », qui n'a pas de nom imprimable — d'où la seule exception.
function nomCourtLicence(valeur) {
  const cle = normaliserLicence(valeur) || LICENCE_DEFAUT;
  if (cle === 'droits-reserves') { return T('art.apercu.licence.reservee'); }
  for (const l of LICENCES_ARTICLE) { if (l.cle === cle) { return l.nom; } }
  return '';
}

// Année du numéro : celle de la date de publication si elle y est, sinon celle du nom du
// dossier (« 2027-03 »). Même repli que le titre de la vue : la date est vide jusqu'à la
// parution, et sans ce repli le DOI d'un numéro en préparation serait incalculable tout du
// long — c'est-à-dire pendant tout le temps où il sert.
function anneeNumero(racine, valeurs) {
  const annee = (String((valeurs || {}).date || '').match(/\d{4}/) || [''])[0];
  if (annee !== '') { return annee; }
  return (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
}

// La ligne DOI de l'aperçu, et ce qu'il faut dire à côté. -> { ligne, constats }
//
// Le DOI est un CALCUL : le rang de l'article parmi ceux qui en portent un, compté à partir
// de zéro, d'où l'éditorial en « 00 ». Rien ne le stocke — sauf l'échappatoire : un doi
// resté sur la fiche y a été défini À LA MAIN (case « Définir manuellement le DOI » du
// formulaire des métadonnées), et c'est LUI qui part vers OJS à la place du calculé.
// La carte affiche CE QUI PART : le manuel quand il existe, étiqueté « manuel » pour que
// la provenance se voie d'un coup d'œil, le calculé sinon, étiqueté « calculé » comme
// avant. La divergence entre les deux reste un constat : elle ne se devine pas.
function apercuDoi(locale, annee, numeroRevue, rang, doiFiche, voulu) {
  const fiche = String(doiFiche || '').trim();
  const constats = [];
  if (rang === -1) {
    // Un DOI manuel sur un article qui n'en reçoit pas : rien ne part, la ligne dit
    // « aucun » — c'est ce qui part — et le constat dit le doi resté sur la fiche.
    if (fiche !== '') { constats.push({ ton: 'attention', texte: T('art.doi.fiche.inutile', [fiche]) }); }
    return {
      ligne: { marque: '', texte: T(voulu ? 'art.doi.aucun.voulu' : 'art.doi.aucun.rubrique') },
      constats: constats
    };
  }
  const calcule = doiCalcule(locale, annee, numeroRevue, rang);
  if (fiche !== '') {
    // Le manuel s'affiche tel quel, calculable ou non — incalculable n'étouffe rien, le
    // manuel partira dès que le numéro sera complet. La divergence ne se dit que quand il
    // y a deux valeurs à comparer.
    if (calcule !== '' && fiche !== calcule) {
      constats.push({ ton: 'attention', texte: T('art.doi.fiche.autre', [fiche, calcule]) });
    }
    return { ligne: { marque: '', texte: fiche, marques: [T('art.doi.manuel')] },
             constats: constats };
  }
  if (calcule === '') {
    return { ligne: { marque: '', texte: T('art.doi.incalculable'), ton: 'attention' },
             constats: constats };
  }
  return { ligne: { marque: '', texte: calcule, marques: [T('art.doi.calcule')] },
           constats: constats };
}

// Ce que les images de l'article disent sans qu'on ouvre leur gestionnaire. La lecture est
// la SIENNE — lireAttributsImage, celle de lib/references.js, et la liste de fichiers de
// media/ — ce qui laisse dehors les photos des autrices et auteurs, rangées dans portraits/.
function resumeImagesArticle(fournisseur, slug) {
  const md = path.join(fournisseur.racine, 'articles', slug, slug + '.md');
  let texte = '';
  try { texte = fs.readFileSync(md, 'utf8'); } catch (e) { return resumeImages([]); }
  return resumeImages(fournisseur._imagesArticle(slug).map((relatif) => {
    const v = lireAttributsImage(texte, relatif);
    return { relatif: relatif, legende: v.legende, alt: v.alt,
             altDefini: v.altDefini, horsFigure: v.horsFigure };
  }));
}

// Ce que la carte doit signaler, en toutes lettres et dans son corps — jamais dans une
// infobulle : les images incomplètes, puis l'état des références relevé à la dernière
// compilation.
function constatsCarte(images, citations) {
  const constats = [];
  if (images.sansAlt > 0) {
    constats.push({ ton: 'attention', texte: T('art.images.sansalt', [images.sansAlt]) });
  }
  if (images.sansLegende > 0) {
    constats.push({ ton: 'attention', texte: T('art.images.sanslegende', [images.sansLegende]) });
  }
  const c = citations || null;
  if (c) {
    const dits = [
      ['appel-sans-reference', 'art.cit.sansref'],
      ['appel-ambigu', 'art.cit.ambigu'],
      ['reference-orpheline', 'art.cit.orpheline']
    ];
    for (const paire of dits) {
      if (c[paire[0]] > 0) { constats.push({ ton: 'attention', texte: T(paire[1], [c[paire[0]]]) }); }
    }
  }
  return constats;
}

// L'aperçu complet d'un article : neuf lignes, dans l'ordre où on les lit — ce que
// l'article EST, ce qu'il DIT, qui l'a écrit, sous quelles conditions il paraît.
function apercuArticle(meta, langue, doi) {
  const type = String(meta.type || '').trim();
  const langueArticle = normaliserLangueArticle(meta.lang);
  const vide = T('art.apercu.vide');
  const seule = (libelle, texte) => ({
    libelle: libelle,
    valeurs: [{ marque: '', texte: String(texte || '') !== '' ? String(texte) : vide }]
  });
  return {
    lignes: [
      seule(T('art.apercu.type'), (LIBELLES_TYPES[type] || {})[langue] || type),
      seule(T('art.apercu.langue'),
        langueArticle === '' ? T('art.apercu.langue.numero') : T('meta.langue.' + langueArticle)),
      ligneApercuLangues(T('trad.champ.title'), meta.title, APERCU_COURT),
      ligneApercuLangues(T('trad.champ.subtitle'), meta.subtitle, APERCU_COURT),
      ligneApercuLangues(T('trad.champ.resume'), meta.resume, APERCU_LONG),
      ligneApercuMotsCles(meta),
      ligneApercuAuteurs(meta),
      seule(T('art.apercu.licence'), nomCourtLicence(meta.licence)),
      { libelle: T('art.apercu.doi'), valeurs: [doi] }
    ].map((l) => (l.valeurs.length > 0 ? l : { libelle: l.libelle, valeurs: [{ marque: '', texte: vide }] }))
  };
}

// Une carte par article, dans l'ordre du numéro : son nom, son slug, l'aperçu complet de
// ses métadonnées, ses tâches cochables, ce qui lui manque, et de quoi le déplacer d'un
// cran. Tout se lit sans rien ouvrir ; les deux boutons du pied mènent aux formulaires qui
// écrivent, et sont les seuls à écrire.
function chargeArticles(fournisseur) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const interface_ = langueCockpit();
  const taches = tachesDuNumero(racine);
  const slugs = fournisseur.listerArticles();
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : le DOI sera dit incalculable, ce qui est vrai */ }
  const locale = langueDefaut(valeurs);
  const annee = anneeNumero(racine, valeurs);
  const numeroRevue = String(valeurs.numero || '').trim();
  // Les fiches sont lues UNE fois : elles servent au titre, à l'aperçu, et au verdict
  // « cette rubrique ne reçoit pas de DOI » qui décide de l'ordre.
  const metas = {};
  const types = {};
  for (const slug of slugs) {
    metas[slug] = lireMetaArticle(racine, slug);
    types[slug] = metas[slug].type;
  }
  // Deux jeux, et la nuance compte pour la case : `voulus` est ce que la rédaction a
  // coché, `sansDoi` y ajoute les rubriques qui n'en reçoivent jamais. Une case cochée par
  // la rubrique se montre verrouillée, puisque la décocher ne changerait rien.
  const voulus = new Set(slugsSansDoiVoulu(racine));
  const sansDoi = articlesSansDoi(racine, slugs, { types: types, voulus: [...voulus] });
  const citations = citationsParArticle(constatsCourants(racine));
  const lignes = slugs.map((slug, index) => {
    const meta = metas[slug];
    const titre = titreFiche(meta, langue);
    const faites = lireTachesArticle(racine, slug).faites;
    const avance = resumeTaches(taches, faites);
    const images = resumeImagesArticle(fournisseur, slug);
    const doi = apercuDoi(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi),
      meta.doi, voulus.has(slug));
    const constats = doi.constats.concat(constatsCarte(images, citations.get(slug)));
    // Un article sans titre reste dans la liste, et la carte dit pourquoi elle montre un
    // slug : la compilation refusera de partir sur cet article, et il faut le savoir ici.
    if (titre === '') { constats.unshift({ ton: 'attention', texte: T('art.sansfiche') }); }
    return {
      cle: slug,
      titre: libelleArticle(index, slug, titre),
      meta: slug,
      pastilles: pastillesCarte(avance, images),
      ouvrir: true,
      apercu: apercuArticle(meta, interface_, doi.ligne),
      constats: constats,
      // La case « pas de DOI ». Verrouillée quand c'est la RUBRIQUE qui décide : cocher ou
      // décocher n'y changerait rien, et un interrupteur sans effet est un mensonge.
      sansDoi: {
        coche: sansDoi.has(slug),
        verrouille: !voulus.has(slug) && sansDoi.has(slug)
      },
      actions: [
        // Les deux formulaires, ouverts sur CET article. Le pied de carte est le seul
        // endroit d'où l'on écrit : l'aperçu au-dessus ne se modifie pas.
        { id: 'metadonnees', libelle: T('art.meta.editer'), icone: 'info',
          tip: T('art.meta.editer.tip') },
        { id: 'medias', libelle: T('art.medias.editer'), icone: 'camera',
          tip: T('art.medias.editer.tip') },
        // Aux bords de son BLOC, et non de la liste : un article sans DOI ne remonte pas
        // au-dessus de ceux qui en portent un, sinon la numérotation cesserait de suivre
        // l'ordre de lecture. Le bouton refuse là où l'hôte refuserait de toute façon.
        { id: 'monter', libelle: T('art.monter'), icone: 'haut', tip: T('art.monter.tip'),
          desactive: refusDeplacement(slugs, slug, -1, sansDoi) !== '' },
        { id: 'descendre', libelle: T('art.descendre'), icone: 'bas', tip: T('art.descendre.tip'),
          desactive: refusDeplacement(slugs, slug, 1, sansDoi) !== '' },
        { id: 'envoyer', libelle: T('art.envoyer'), icone: 'traduction', tip: T('art.envoyer.tip') }
      ],
      taches: taches.map((t) => ({
        id: t.id, libelle: libelleTache(t, interface_), faite: faites.indexOf(t.id) !== -1
      }))
    };
  });
  return {
    titre: T('art.vue.titre'),
    boutons: [
      { id: 'importer', libelle: T('art.importer'), icone: 'fleche', principal: true },
      { id: 'taches', libelle: T('art.taches.reglage'), icone: 'ok', tip: T('art.taches.reglage.tip') }
    ],
    lignes: lignes,
    taches: tachesConfig(lireConfigPoste()),
    revue: revueNumero(racine)
  };
}

// Les gestes de la vue. -> le message à afficher dans la barre, ou null.
async function actionArticle(fournisseur, rafraichirTout, msg) {
  const racine = fournisseur.racine;
  if (msg.type === 'commande') {
    if (msg.id === 'importer') { await vscode.commands.executeCommand('szh.convertirEnAttente'); }
    return null;
  }
  if (msg.type === 'tache') {
    if (refuserSiVerrouille()) { return null; }
    const slug = String(msg.cle || '');
    if (fournisseur.listerArticles().indexOf(slug) === -1) { return null; }
    const taches = tachesDuNumero(racine);
    const suivi = lireTachesArticle(racine, slug);
    const faites = basculerTache(suivi.faites, String(msg.id || ''), !!msg.cochee, taches);
    try { ecrireTachesArticle(racine, slug, { faites: faites, _inconnues: suivi._inconnues }); }
    catch (e) { return T('err.ecriture', [String((e && e.message) || e)]); }
    if (rafraichirTout) { rafraichirTout(); }      // l'arbre porte le même avancement
    const avance = resumeTaches(taches, faites);
    return { dit: T('art.taches.avancement', [avance.faites, avance.total]),
             avancement: { cle: slug,
                           pastilles: pastillesCarte(avance, resumeImagesArticle(fournisseur, slug)) } };
  }
  if (msg.type === 'taches-enregistrer') {
    const revue = String(msg.revue || '');
    if (REVUES_TACHES.indexOf(revue) === -1) { return null; }
    // Réglage de poste, pas de numéro : le verrou du numéro ne s'y applique pas.
    const avant = lireConfigPoste();
    // Illisible — JSON malformé, fichier tenu par la synchro — n'est pas la même chose
    // qu'absent : on n'écrase pas ce qu'on n'a pas su lire, sans quoi l'emplacement des
    // revues et la configuration OJS partiraient avec.
    if (avant === null && fs.existsSync(CONFIG_POSTE)) {
      return T('err.ecriture', [CONFIG_POSTE]);
    }
    const cfg = configAvecTaches(avant, revue, Array.isArray(msg.taches) ? msg.taches : []);
    const erreur = ecrireConfigPoste(cfg);
    if (erreur) { return T('err.ecriture', [erreur]); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('art.taches.enregistrees');
  }
  // La case « pas de DOI » d'un article. Elle décide de deux choses d'un seul coup : que
  // l'article ne reçoit pas de DOI, et qu'il passe en fin de numéro — donc l'ordre est
  // réécrit avec elle, sinon le fichier dirait une chose et l'écran une autre.
  //
  // C'est l'ORDRE du numéro qu'elle touche : elle suit donc la même règle que les boutons
  // de déplacement, refusée sur un numéro archivé et acceptée sur un numéro verrouillé.
  if (msg.type === 'sansdoi') {
    if (refuserSiArchivee()) { return null; }
    const slug = String(msg.cle || '');
    const slugs = fournisseur.listerArticles();
    if (slugs.indexOf(slug) === -1) { return null; }
    const voulus = basculerSansDoi(slugsSansDoiVoulu(racine), slug, !!msg.coche, slugs);
    const modifies = {};
    modifies[CLE_SANS_DOI] = voulus;
    // L'ordre part avec. listerArticles() applique déjà la règle à la lecture, mais le
    // fichier doit finir par dire la même chose que l'écran : il se relit à la main, et il
    // voyage seul sur SharePoint.
    modifies[CLE_ORDRE] = trierParDoi(slugs, articlesSansDoi(racine, slugs, { voulus: voulus }));
    const erreur = ecrireClesAusgabe(racine, modifies);
    if (erreur) { return T('err.ecriture', [erreur]); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('art.doi.enregistre', [voulus.length]);
  }
  if (msg.type !== 'action') { return null; }
  const slug = String(msg.cle || '');
  if (msg.id === 'envoyer') {
    await envoyerAuteur(fournisseur, { slug: slug });
    return null;
  }
  // Les deux formulaires de l'article, ouverts par leur commande et non par leur fonction :
  // ce sont celles-là qui savent quel panneau réutiliser, et elles portent déjà le refus du
  // verrou. Rien n'est réécrit ici.
  if (msg.id === 'metadonnees') {
    await vscode.commands.executeCommand('szh.metadonneesArticle', { slug: slug });
    return null;
  }
  if (msg.id === 'medias') {
    await vscode.commands.executeCommand('szh.mediasArticle', { slug: slug });
    return null;
  }
  if (msg.id !== 'monter' && msg.id !== 'descendre') { return null; }
  // ⚠ refuserSiArchivee() et non refuserSiVerrouille() : voir la garde elle-même. Un
  // numéro verrouillé a ses textes figés, mais son sommaire peut encore se décider.
  if (refuserSiArchivee()) { return null; }
  const slugs = fournisseur.listerArticles();
  if (slugs.indexOf(slug) === -1) { return null; }
  const delta = msg.id === 'monter' ? -1 : 1;
  // La règle du tri passe avant le déplacement : franchir la frontière DOI / sans DOI se
  // refuse en le disant, être au bout de la liste ne se dit pas — c'est une évidence.
  const refus = refusDeplacement(slugs, slug, delta, articlesSansDoi(racine, slugs));
  if (refus === 'frontiere') { return T('art.ordre.frontiere'); }
  if (refus !== '') { return null; }
  const nouveau = deplacerArticle(slugs, slug, delta);
  if (nouveau.join(' ') === slugs.join(' ')) { return null; }   // déjà au bord
  // La liste entière part dans ausgabe.yaml : une liste partielle laisserait les autres
  // articles à réparer au prochain rendu.
  const modifies = {};
  modifies[CLE_ORDRE] = nouveau;
  const erreur = ecrireClesAusgabe(racine, modifies);
  if (erreur) { return T('err.ecriture', [erreur]); }
  if (rafraichirTout) { rafraichirTout(); }
  return T('art.ordre.enregistre', [prefixeOrdre(nouveau.indexOf(slug))]);
}

// Panneau singleton, comme les autres vues : rouvrir la commande révèle celui qui existe,
// valeurs relues du disque.
async function ouvrirVueArticles(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Décision de Robin (26.08.2026) : ouvrir la vue d'ensemble ferme l'aperçu de la
  // colonne 2 (HTML ou PDF) — on vient embrasser le numéro, l'article quitté n'a plus
  // à occuper l'écran. Même geste que la vue Métadonnées. Les rafraîchissements en
  // tâche de fond passent par envoyerVue, pas par ici : ils ne ferment rien.
  await fermerTousLesApercus();
  const envoyer = (panneau, avecCouverture) => {
    const charge = chargeArticles(fournisseur);
    repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, charge,
      chargeNumero(racine, avecCouverture), { accent: lireCouleurAccent(racine) }));
    panneau.title = charge.titre;
  };
  if (panneauVueArticles) {
    panneauVueArticles.reveal(vscode.ViewColumn.One);
    envoyer(panneauVueArticles, true);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhVueArticles', T('art.vue.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauVueArticles = panneau;
  panneau.onDidDispose(() => { if (panneauVueArticles === panneau) { panneauVueArticles = null; } });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyer(panneau, true); return; }
    // Le formulaire du numéro d'abord : c'est le même code que la page « Méta-données du
    // numéro », et il répond lui-même au panneau.
    if (messageNumero(panneau, racine, msg, rafraichirTout)) { return; }
    if (msg.type === 'ouvrir') {
      // Par la commande, pour rester sur le point d'entrée unique. sansApercu : décision
      // de Robin (25.08.2026) — depuis la vue d'ensemble, on vient lire ou corriger le
      // texte, pas mettre en page ; seul le .md s'ouvre, sans compilation ni aperçu.
      await vscode.commands.executeCommand('szh.ouvrirArticle', String(msg.cle || ''),
        { sansApercu: true });
      return;
    }
    // L'état part APRÈS le re-rendu : « valeurs » reconstruit la barre, et donc efface la
    // zone d'état.
    let dit = null;
    let avancement = null;
    try {
      const reponse = await actionArticle(fournisseur, rafraichirTout, msg);
      // Cocher une tâche rend un avancement, les autres gestes une phrase.
      if (reponse && typeof reponse === 'object') { dit = reponse.dit; avancement = reponse.avancement; }
      else { dit = reponse; }
    } catch (e) { dit = T('err.commande', [e && e.message ? e.message : String(e)]); }
    if (panneauVueArticles !== panneau) { return; }
    // Une case cochée ne fait reposer que sa pastille : « valeurs » reconstruirait la liste
    // entière, et le focus clavier quitterait la case qu'on vient d'utiliser. Dans un outil
    // dont le sujet est l'accessibilité, cela compte.
    if (avancement) { repondrePanneau(panneau, Object.assign({ type: 'avancement' }, avancement)); }
    else { envoyer(panneau); }
    if (msg.type === 'taches-enregistrer') {
      repondrePanneau(panneau, { type: 'taches', taches: tachesConfig(lireConfigPoste()) });
    }
    if (dit) { repondrePanneau(panneau, { type: 'etat', message: dit }); }
  });
  panneau.webview.html = htmlArticles(crypto.randomBytes(16).toString('hex'));
}

// ---- « Envoyer à l'auteur » -----------------------------------------------------
//
// Compiler le PDF de l'article, ouvrir un brouillon adressé, et mettre la pièce jointe à un
// collage près.
//
// Trois voies ont été éprouvées sur ce poste (Windows 11 ; le nouvel Outlook est le
// gestionnaire de `mailto:`, Outlook classique est associé aux .eml) :
//
//   1. un .eml déposé sur le disque puis ouvert. Il porte destinataire, sujet, corps et
//      pièce jointe, et « X-Unsent: 1 » ouvre bien un brouillon modifiable — vérifié. Mais
//      .eml n'a aucun gestionnaire choisi : Windows affiche « Sélectionnez une application
//      pour ouvrir ce fichier .eml » et propose les deux Outlook. Le rédacteur doit
//      deviner ; le nouveau ne sait pas ouvrir un .eml, l'ancien démarre à froid en
//      cinquante secondes avec ses compléments et ses rappels, dans un client qui n'est pas
//      celui où il travaille. Écartée : elle réussit ou échoue selon le poste.
//   2. `mailto:`. Le nouvel Outlook ouvre un brouillon complet — destinataire résolu,
//      sujet et corps accentués intacts, paragraphes conservés. Sûre, et sans pièce jointe :
//      un mailto: n'en porte pas.
//   3. le presse-papiers. `Set-Clipboard -LiteralPath` pose le PDF au format CF_HDROP, et
//      un seul Ctrl+V dans le brouillon l'attache — vérifié dans le nouvel Outlook. Le
//      corps ne peut pas voyager sur le même presse-papiers : quand les deux formats y
//      sont, Outlook prend le fichier et le texte est perdu.
//
// Retenue : la 2 pour le brouillon, la 3 pour la pièce jointe. La notification dit au
// rédacteur qu'il n'a qu'à coller, et propose le dossier du PDF en dernier recours, pour le
// poste où le presse-papiers serait refusé. Le corps de l'e-mail, lui, ne porte aucune
// consigne interne : il part tel quel à l'auteur.

// Le PDF au presse-papiers comme FICHIER, ce que vscode.env.clipboard ne sait pas faire :
// il n'écrit que du texte. Le chemin passe par l'environnement et non par la ligne de
// commande — aucune citation à échapper, donc aucun chemin à guillemets ou à apostrophe qui
// casse. -> true si PowerShell est sorti sans erreur.
function copierFichierPressePapiers(chemin) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command',
         'Set-Clipboard -LiteralPath $env:SZH_PIECE_JOINTE'],
        { stdio: 'ignore', windowsHide: true,
          env: Object.assign({}, process.env, { SZH_PIECE_JOINTE: chemin }) });
    } catch (e) { resolve(false); return; }
    // Un PowerShell qui ne rend jamais la main ne doit pas bloquer le brouillon ; et le
    // minuteur de garde est levé dès qu'il répond, sinon il tiendrait l'hôte d'extensions
    // éveillé quinze secondes de plus pour rien.
    let minuteur = null;
    let fini = false;
    const rendre = (ok) => {
      if (fini) { return; }
      fini = true;
      if (minuteur) { clearTimeout(minuteur); minuteur = null; }
      resolve(ok);
    };
    proc.on('error', () => rendre(false));
    proc.on('exit', (code) => rendre(code === 0));
    minuteur = setTimeout(() => rendre(false), 15000);
  });
}

// Les destinataires : toutes les adresses de la fiche, dans l'ordre des auteur·e·s. La
// version finale part à tout le monde, et une fiche sans adresse laisse le champ vide
// plutôt que d'inventer une adresse.
function adressesAuteurs(meta) {
  const vues = [];
  for (const a of ((meta && meta.author) || [])) {
    const v = String((a && a.email) || '').trim();
    // Même forme d'adresse que « Envoyer pour traduction » : une seule règle (archivage.js).
    if (FORME_MAIL.test(v) && vues.indexOf(v) === -1) { vues.push(v); }
  }
  return vues;
}

// Le brouillon : destinataires, sujet et corps. Séparé de son ouverture pour être
// éprouvable sans client de messagerie. La langue est celle de l'article — sa fiche le dit,
// à défaut le numéro — et jamais celle de l'interface : on écrit à un auteur, pas à soi.
function brouillonAuteur(langue, adresses, titreArticle, titreDuNumero) {
  return {
    destinataire: adresses.join(','),
    sujet: TL(langue, 'art.envoi.sujet', [titreArticle]),
    corps: TL(langue, 'art.envoi.corps', [titreArticle, titreDuNumero])
  };
}

async function envoyerAuteur(fournisseur, cible) {
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
  // Le PDF d'abord : c'est lui qu'on envoie, et il doit être celui du texte d'aujourd'hui.
  buildEnCours = true;
  const statut = vscode.window.setStatusBarMessage(T('art.envoi.compilation', [slug]));
  let code = null;
  try { code = await lancerTacheObjet(tacheMakeArticle(racine, slug)); }
  finally { statut.dispose(); buildEnCours = false; }
  const pdf = path.join(racine, 'out', slug, slug + '.pdf');
  // Compilation en échec : un PDF resté de la fois d'avant ne doit pas partir pour la
  // version du jour. Mieux vaut ne rien préparer que d'envoyer un document périmé.
  if (code !== 0 || !fs.existsSync(pdf)) {
    vscode.window.showErrorMessage(T('art.envoi.pdf.absent', [slug]));
    return;
  }

  const meta = lireMetaArticle(racine, slug);
  const langueArticle = normaliserLangueArticle(meta.lang) || langueRevue(racine);
  const adresses = adressesAuteurs(meta);
  const titreArticle = titreFiche(meta, langueArticle) || slug;
  const brouillon = brouillonAuteur(langueArticle, adresses, titreArticle, titreNumero(racine));
  if (adresses.length === 0) { vscode.window.showWarningMessage(T('art.envoi.sansmail', [slug])); }

  const copie = await copierFichierPressePapiers(pdf);
  const uri = vscode.Uri.file(pdf);
  try {
    await vscode.env.openExternal(vscode.Uri.parse(uriMailto(brouillon)));
  } catch (e) {
    // Aucun client de messagerie, ou refus de l'hôte : le PDF est au presse-papiers, et le
    // dossier reste la porte de sortie.
    const bouton = T('art.envoi.dossier');
    const choix = await vscode.window.showWarningMessage(T('art.envoi.mail.echec', [pdf]), bouton);
    if (choix === bouton) { await revelerDansExplorateur(uri); }
    return;
  }
  const bouton = T('art.envoi.dossier');
  const message = copie ? T('art.envoi.pret') : T('art.envoi.presse.echec');
  const choix = await vscode.window.showInformationMessage(message, bouton);
  if (choix === bouton) { await revelerDansExplorateur(uri); }
}

// Le dossier du PDF, fichier sélectionné. La commande de l'éditeur d'abord ; à défaut, le
// dossier ouvert par l'hôte — un poste sans intégration Explorateur ne doit pas rester sans
// pièce jointe.
async function revelerDansExplorateur(uri) {
  try { await vscode.commands.executeCommand('revealFileInOS', uri); return; }
  catch (e) { /* pas d'intégration Explorateur */ }
  try { await vscode.env.openExternal(vscode.Uri.file(path.dirname(uri.fsPath))); }
  catch (e) { /* rien de plus à tenter */ }
}

function textesTraduction() {
  return {
    source: T('trad.source'), sourceVide: T('trad.source.vide'), cible: T('trad.cible'),
    copier: T('trad.copier'), copie: T('trad.copie'), statut: T('trad.statut'),
    traduit: T('trad.traduit'), atraduire: T('trad.atraduire'),
    courtTraduction: T('trad.court.traduction'), courtRelecture: T('trad.court.relecture'),
    courtFinalise: T('trad.court.finalise'), toutTip: T('trad.tout.tip'),
    rien: T('trad.rien'), aucuneModif: T('form.rien'), enregistre: T('trad.enregistre'),
    commentaire: T('trad.commentaire'), commentaireAide: T('trad.commentaire.aide'),
    deepl: T('trad.deepl'), deeplTip: T('trad.deepl.tooltip'),
    envoyer: T('trad.envoyer'), envoyerTip: T('trad.envoyer.tooltip'),
    motCle: T('trad.motcle'), motCleSansEquiv: T('trad.motcle.sansequivalent'),
    motsClesAide: T('trad.motscles.aide')
  };
}

function htmlTraduction(nonce) {
  return construireHtml('traduction', nonce, {
    cssPartage: ['_design.css'],
    titre: T('trad.titre'),
    remplacements: { '__TXT__': JSON.stringify(textesTraduction()) }
  });
}

let panneauTraduction = null;
let slugTraduction = null;
let traductionModifiee = false;
let rechargementTraduction = null;

// Libellés résolus côté hôte : la webview ne connaît pas la langue d'interface.
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

// Le panneau suit ce qui vient d'être écrit ailleurs — sauf s'il porte une saisie non
// enregistrée : le re-rendu la jetterait sans un mot, et remettrait son témoin de
// modification à zéro. On le dit alors, et l'utilisateur tranche.
function rafraichirPanneauTraduction(fournisseur) {
  if (!panneauTraduction || !slugTraduction || !fournisseur.racine) { return; }
  if (fournisseur.listerArticles().indexOf(slugTraduction) === -1) { return; }
  if (traductionModifiee) { vscode.window.showWarningMessage(T('trad.perimee')); return; }
  envoyerValeursTraduction(panneauTraduction, fournisseur, slugTraduction, null);
}

// Enregistre ce que renvoie le panneau ; les textes passent par ecrireCartesArticles,
// qui relit la fiche et n'écrase donc pas une modification enregistrée ailleurs.
// metaChangee, dans le retour, pilote la recompilation de l'aperçu.
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
    // Pas la langue du numéro : ce panneau ne touche pas au texte source.
    if (LANGUES_META.indexOf(langue) === -1 || langue === source) { continue; }
    const s = statutValide(groupe.statut);
    for (const brut of (Array.isArray(groupe.champs) ? groupe.champs : [])) {
      const champ = String((brut && brut.champ) || '');
      if (CHAMPS_TRADUISIBLES.indexOf(champ) === -1) { continue; }
      // Sur chaque clé du groupe : le sidecar reste lisible sans notion de groupe.
      if (s) { statuts[cleChamp(champ, langue)] = s; }
      const avant = texteChamp(meta, champ, langue);
      let valeur;
      if (champ === 'keywords') {
        // alignerMotsCles tient la place des cases vides, ici du côté qui écrit.
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

// Le traducteur web accepte le texte dans le fragment de l'URL,
// https://www.deepl.com/translator#<source>/<cible>/<texte>, ouverte par le navigateur.
// Sans clé d'API, le retour se fait au copier-coller.
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

// L'argument de l'arbre ({slug[, cle]} ou slug), sinon le .md actif, sinon l'aperçu.
function cibleTraduction(fournisseur, cible) {
  if (typeof cible === 'string' && cible !== '') { return { slug: cible, cle: null }; }
  if (cible && cible.slug) { return { slug: String(cible.slug), cle: cible.cle ? String(cible.cle) : null }; }
  const ed = vscode.window.activeTextEditor;
  const actif = ed ? slugDepuisChemin(fournisseur.racine, ed.document.uri.fsPath) : null;
  return { slug: actif || apercuCourantSlug || null, cle: null };
}

// ---- « Envoyer pour traduction » : lien szh:// et e-mail -------------------------
// Le bouton fabrique un lien szh://traduction/<produit>/<numero>[/<article>]
// (lib/liens.js) qui ouvre le bon numéro sur le suivi de traduction, et le met dans le
// presse-papiers comme dans un brouillon d'e-mail. Le lien ne porte pas de chemin :
// c'est le lanceur qui retrouve le dossier sur le poste.

// Le brouillon, et le seul chemin : un `mailto:` en texte brut. Le corps d'un mailto
// n'accepte pas de HTML, le lien szh:// y arrive donc inerte — c'est le prix du retrait du
// composant COM d'Outlook, qui ne parlait qu'à l'ancien client. D'où deux compensations :
// le lien est seul sur sa ligne dans le corps, sélectionnable d'un double-clic, et le
// texte dit au destinataire quoi en faire. L'adresse n'est pas encodée : sa forme est
// vérifiée par adresseMailTraduction, qui n'en laisse passer aucun caractère réservé.
// Langue de l'e-mail : celle de l'équipe qui va traduire, jamais celle de l'interface. Un
// numéro de la Zeitschrift part vers les traducteurs francophones, une Revue vers les
// germanophones ; les textes de lib/i18n.js nomment la revue et le sens en conséquence.
const LANGUE_MAIL_TRADUCTION = { zeitschrift: 'fr', revue: 'de' };

// Le brouillon : destinataire, sujet et corps, tous trois déduits du seul jeton de revue.
// Séparé de son ouverture pour être éprouvable sans client de messagerie.
function brouillonTraduction(produit, quoi, lien) {
  const langue = LANGUE_MAIL_TRADUCTION[produit] || 'fr';
  return {
    destinataire: adresseMailTraduction(produit),
    sujet: TL(langue, 'trad.lien.sujet', [quoi]),
    corps: TL(langue, 'trad.lien.corps', [quoi, lien])
  };
}

// L'adresse n'est pas encodée : sa forme est vérifiée par adresseMailTraduction, qui ne
// laisse passer aucun caractère réservé. Sujet et corps le sont, eux : accents,
// guillemets et retours à la ligne d'un corps entier n'y survivraient pas autrement.
function uriMailto(brouillon) {
  return 'mailto:' + brouillon.destinataire +
    '?subject=' + encodeURIComponent(brouillon.sujet) +
    '&body=' + encodeURIComponent(brouillon.corps);
}

function ouvrirBrouillonMail(brouillon) {
  return vscode.env.openExternal(vscode.Uri.parse(uriMailto(brouillon)));
}

async function envoyerPourTraduction(fournisseur, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const vise = cibleTraduction(fournisseur, cible);   // sinon le lien vise le numéro
  const slug = (vise.slug && fournisseur.listerArticles().indexOf(vise.slug) !== -1) ? vise.slug : '';
  let produit = '';
  try {
    produit = normaliserRevue(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).revue);
  } catch (e) { produit = ''; }
  const lien = construireLienTraduction(produit, path.basename(racine), slug);
  if (lien === '') {
    vscode.window.showWarningMessage(T('trad.lien.impossible'));
    return;
  }
  try { await vscode.env.clipboard.writeText(lien); } catch (e) { /* presse-papiers refusé */ }

  const quoi = slug === '' ? titreNumero(racine) : titreNumero(racine) + ' — ' + slug;
  const brouillon = brouillonTraduction(produit, quoi, lien);
  try {
    await ouvrirBrouillonMail(brouillon);
    vscode.window.setStatusBarMessage(T('trad.lien.copie', [lien]), 8000);
  } catch (e) {
    // Aucun client de messagerie, ou refus de l'hôte : le lien est déjà au presse-papiers,
    // et le bouton laisse une seconde chance au brouillon.
    const bouton = T('trad.lien.mail');
    const choix = await vscode.window.showInformationMessage(T('trad.lien.copie.seul', [lien]), bouton);
    // Second échec : rien à ajouter, la notification a déjà dit l'essentiel. Mais il faut
    // l'attendre et l'avaler, sans quoi c'est un rejet non capturé de l'hôte d'extensions.
    if (choix === bouton) {
      try { await ouvrirBrouillonMail(brouillon); } catch (err) { /* déjà signalé */ }
    }
  }
}

// Atterrissage d'un lien reçu : le lanceur a déposé une intention à usage unique,
// consommée ici une fois l'arbre prêt ; celle qui vise une autre revue est laissée à une
// autre fenêtre. Ne lève pas : un lien ne doit pas bloquer l'ouverture.
async function honorerIntention(fournisseur, rafraichirTout) {
  try {
    const racine = fournisseur.racine;
    if (!racine) { return; }
    const intention = consommerIntention(racine);
    if (!intention || intention.vue !== 'traduction') { return; }
    const cible = (intention.article !== '' && fournisseur.listerArticles().indexOf(intention.article) !== -1)
      ? { slug: intention.article } : undefined;
    await ouvrirTraduction(fournisseur, rafraichirTout, cible);
    vscode.window.setStatusBarMessage(T('intention.ouverte'), 6000);
  } catch (e) { /* jamais bloquant */ }
}

// Formulaire en colonne 1, aperçu de l'article en colonne 2, ouvert sans le .md.
async function ouvrirTraduction(fournisseur, rafraichirTout, cible) {
  if (!fournisseur.racine) { return; }
  const vise = cibleTraduction(fournisseur, cible);
  if (!vise.slug || fournisseur.listerArticles().indexOf(vise.slug) === -1) {
    vscode.window.setStatusBarMessage(T('trad.horsarticle'), 4000);
    return;
  }
  const montrerApercu = (slug) => {
    // Une erreur de compilation est déjà signalée par ouvrirArticle.
    ouvrirArticle(fournisseur, slug, { sansTexte: true }).catch(() => { /* déjà signalé */ });
  };
  if (panneauTraduction) {
    panneauTraduction.reveal(vscode.ViewColumn.One);
    if (vise.slug === slugTraduction) {
      if (vise.cle) { repondrePanneau(panneauTraduction, { type: 'focus', cle: vise.cle }); }
      montrerApercu(vise.slug);
      return;
    }
    if (traductionModifiee) {
      // Le panneau porte un ● : le changement d'article se joue à la réponse.
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
    if (msg.type === 'lien') { envoyerPourTraduction(fournisseur, { slug: slugTraduction }); return; }
    if (msg.type === 'rechargement') {
      const attente = rechargementTraduction;
      rechargementTraduction = null;
      if (!attente) { return; }                    // réponse tardive : abandonné
      const choix = await vscode.window.showWarningMessage(
        T('trad.recharger.question'), { modal: true, detail: T('table.quitter.detail') },
        T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
      if (choix === undefined) { return; }         // Annuler : on reste sur l'article
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
    // Un enregistrement automatique ne renvoie rien : le re-rendu perdrait le curseur.
    if (!msg.auto) { envoyerValeursTraduction(panneau, fournisseur, slugTraduction, null); }
    // La fiche est une dépendance de compilation ; jamais en pleine frappe.
    if (res.metaChangee && !msg.auto) { montrerApercu(slugTraduction); }
  });
  panneau.webview.html = htmlTraduction(crypto.randomBytes(16).toString('hex'));
  montrerApercu(vise.slug);
}

// ---- Photos d'auteur·e·s ---------------------------------------------------------
// La modale dépose une image en base64 ; l'hôte écrit
// articles/<slug>/portraits/<slug-auteur>.original.<ext> puis appelle le pipeline WSL
// (lib/portraits.js), qui produit .avec-fond.png et .sans-fond.png ; les trois versions
// repartent en data: URIs, et « Valider » fige le champ `photo` de la fiche. `base`, le
// <slug-auteur>, est généré par l'hôte et revalidé quand la webview le renvoie.

const EXTENSIONS_PHOTO = ['png', 'jpg', 'jpeg', 'webp'];
const MIMES_PHOTO = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const TAILLE_MAX_PHOTO = 20 * 1024 * 1024;     // 20 Mo, vérifiés webview et hôte
const VERSIONS_PHOTO = ['original', 'avec-fond', 'sans-fond'];

let photoEnCours = false;                       // le pipeline est long : pas de doublon

function dossierPortraitsArticle(racine, slug) {
  return path.join(racine, 'articles', slug, 'portraits');
}

// Aperçus de la modale ; null si l'image est illisible.
function dataUriImage(chemin) {
  try {
    const ext = (chemin.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
    return 'data:' + (MIMES_PHOTO[ext] || 'image/png') + ';base64,' +
      fs.readFileSync(chemin).toString('base64');
  } catch (e) { return null; }
}

// Vignette d'un portrait pour la fiche d'auteur·e, sous un budget partagé : une revue
// entière porte facilement cinquante portraits, et le base64 de tous leurs originaux ferait
// un postMessage de plusieurs dizaines de mégaoctets. Au-delà, la fiche montre le
// pictogramme d'absence — la modale, elle, chargera la photo à la demande.
const TAILLE_MAX_VIGNETTE = 3 * 1024 * 1024;
const BUDGET_VIGNETTES = 8 * 1024 * 1024;

function vignetteAuteur(racine, slug, photo, budget) {
  const relatif = assainirCheminPhoto(photo);
  if (relatif === '') { return null; }
  const chemin = path.join(dossierPortraitsArticle(racine, slug), relatif.replace(/^portraits\//, ''));
  try {
    const taille = fs.statSync(chemin).size;
    if (taille > TAILLE_MAX_VIGNETTE || taille > budget.reste) { return null; }
    budget.reste -= taille;
  } catch (e) { return null; }
  return dataUriImage(chemin);
}

// <base>.original.<ext> présent dans `dossier`, dont la webview ignore l'extension.
function trouverOriginal(dossier, base) {
  let noms = [];
  try { noms = fs.readdirSync(dossier); } catch (e) { return null; }
  for (const n of noms) {
    if (n.indexOf(base + '.original.') === 0 && !n.startsWith('~$')) { return n; }
  }
  return null;
}

function versionsPhoto(dossier, base) {
  const original = trouverOriginal(dossier, base);
  return {
    original: original ? dataUriImage(path.join(dossier, original)) : null,
    avecFond: dataUriImage(path.join(dossier, base + '.avec-fond.png')),
    sansFond: dataUriImage(path.join(dossier, base + '.sans-fond.png'))
  };
}

// Champ `photo` déjà assaini -> { base, version } : une base, trois suffixes.
// La base n'est pas contrôlée ici : baseAuteurValide s'en charge chez les appelants, qui
// doivent tous répondre quelque chose — une modale qui a désactivé son bouton avant
// d'envoyer reste figée sur un silence.
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

// Un seul segment de chemin, alphabet sûr : pas de remontée hors de portraits/.
function baseAuteurValide(base) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(base || ''));
}

// postMessage tolérant : le panneau peut être fermé pendant le traitement WSL.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// ---- Auteur·e·s publiés : la liste pour l'autocomplétion --------------------------
//
// Le cache (C:\ProgramData\SZH\auteurs.json, lib/auteurs-ojs.js) part vers chaque vue qui
// porte la modale d'auteur·e — métadonnées, vérification d'import, médias — en même temps
// que ses valeurs. Seuls prénom et nom voyagent : la date de publication ne sert qu'à la
// fusion côté cache. Liste vide : rien n'est envoyé, la modale ne montre alors aucune UI.
function envoyerAuteursConnus(panneau) {
  let auteurs;
  try { auteurs = lireCacheAuteursPublies().auteurs; } catch (e) { return; }
  if (!Array.isArray(auteurs) || auteurs.length === 0) { return; }
  repondrePanneau(panneau, {
    type: 'auteurs-connus',
    auteurs: auteurs.map((a) => ({ prenom: a.prenom, nom: a.nom }))
  });
}

// Le rafraîchissement hebdomadaire, lancé à l'activation SANS l'attendre : hors ligne est
// un état normal du poste, rien n'est montré au rédacteur — seule une trace console reste
// pour le diagnostic (échec muet interdit, décision du dépôt).
function rafraichirAuteursPubliesEnFond() {
  rafraichirCacheAuteursPublies().then((res) => {
    if (!res.fait) { return; }                     // cache de moins de sept jours
    if (res.complet) {
      console.log('[auteurs-ojs] liste des auteur·e·s publiés rafraîchie : ' + res.nombre + ' nom(s)');
    } else {
      console.log('[auteurs-ojs] rafraîchissement incomplet (hors ligne ?) : ' + (res.erreur || '?'));
    }
  }).catch((e) => {
    console.log('[auteurs-ojs] rafraîchissement raté : ' + String((e && e.message) || e));
  });
}

// photo-ouvrir : renvoie les versions déjà présentes sur le disque.
function ouvrirVersionsPhoto(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }   // slug inconnu : ignoré
  const photo = assainirCheminPhoto(msg.photo);
  const d = photo === '' ? null : decomposerPhoto(photo);
  if (d && !baseAuteurValide(d.base)) {
    // Une base hors alphabet sûr ne pourra jamais être relue ni réécrite : mieux vaut le
    // dire que d'offrir des versions qu'un enregistrement refusera.
    repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  if (!d) {
    // Forme inattendue : plutôt que de laisser « Chargement… », on invite à redéposer.
    repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  repondrePanneau(panneau, {
    type: 'photo-versions', slug: slug, index: msg.index, base: d.base,
    versions: versionsPhoto(dossierPortraitsArticle(fournisseur.racine, slug), d.base),
    infos: null, actuelle: d.version
  });
}

// Écrit l'original par fichier « ~$ » puis rename, purge les anciens, lance le pipeline.
// Seul chemin d'écriture d'un portrait : le formulaire des fiches et le gestionnaire des
// médias y passent tous les deux. Rend { ok, message, visage, recadre, dossier } et ne
// lève jamais ; l'appelant décide de ce qu'il en dit à sa webview.
async function ecrirePortraitEtTraiter(fournisseur, slug, slugAuteur, ext, donneesBase64) {
  const echec = (message) => ({ ok: false, message: message });
  if (!new Set(fournisseur.listerArticles()).has(String(slug || ''))) { return echec(T('photo.err.introuvable')); }
  if (!baseAuteurValide(slugAuteur)) { return echec(T('photo.err.introuvable')); }
  if (photoEnCours) { return echec(T('photo.encours')); }
  if (EXTENSIONS_PHOTO.indexOf(String(ext || '').toLowerCase()) === -1) { return echec(T('photo.err.format')); }
  const donnees = Buffer.from(String(donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { return echec(T('photo.err.format')); }
  if (donnees.length > TAILLE_MAX_PHOTO) { return echec(T('photo.err.tropvolumineux')); }

  photoEnCours = true;
  try {
    const dossier = dossierPortraitsArticle(fournisseur.racine, slug);
    const nomOriginal = slugAuteur + '.original.' + ext;
    const chemin = path.join(dossier, nomOriginal);
    try {
      fs.mkdirSync(dossier, { recursive: true });
      // Un seul .original.* par auteur, sinon trouverOriginal devient ambigu.
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
      return echec(T('err.ecriture', [e.message]));
    }
    let resultats;
    try {
      resultats = await traiterPortraits({
        dossierPortraits: dossier,
        entrees: [{ slug: slugAuteur, cheminSource: chemin }]
      });
    } catch (e) {
      return echec(T(e && e.wsl ? 'photo.err.wsl' : 'photo.err.traitement', [e.message]));
    }
    const r = resultats.filter((x) => x && x.slug === slugAuteur)[0] || resultats[0] || {};
    if (!r.ok) { return echec(T('photo.err.traitement', [String(r.erreur || '?')])); }
    return { ok: true, visage: !!r.visage, recadre: !!r.recadre, dossier: dossier };
  } finally {
    photoEnCours = false;
  }
}

async function deposerPhotoAuteur(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  const index = msg.index;
  const erreur = (texte) => repondrePanneau(panneau, { type: 'photo-erreur', slug: slug, index: index, message: texte });
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }   // slug inconnu : ignoré
  // Écrit l'original et rejoue le pipeline : un panneau resté ouvert survit au
  // verrouillage du numéro, et la garde des commandes ne couvre que l'ouverture.
  if (refuserSiVerrouille()) { erreur(T('verrou.refuse')); return; }
  const prenom = String(msg.prenom || '').trim();
  const nom = String(msg.nom || '').trim();
  // Sans réponse, la modale reste figée sur « Traitement… » : elle a désactivé son bouton
  // avant d'envoyer, et rien ne la réveillerait.
  if (prenom === '' && nom === '') { erreur(T('photo.nomrequis')); return; }
  const slugAuteur = slugifier(prenom + '-' + nom);
  const ext = (String(msg.nomFichier || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  const r = await ecrirePortraitEtTraiter(fournisseur, slug, slugAuteur, ext, msg.donneesBase64);
  if (!r.ok) { erreur(r.message); return; }
  if (!r.visage) { vscode.window.showWarningMessage(T('photo.sansvisage')); }
  repondrePanneau(panneau, {
    type: 'photo-versions', slug: slug, index: index, base: slugAuteur,
    versions: versionsPhoto(r.dossier, slugAuteur),
    infos: { visage: !!r.visage, recadre: !!r.recadre },
    actuelle: null
  });
}

// Le champ `photo` d'une fiche peut désigner l'original, dont l'extension change avec le
// fichier déposé : sans cette retouche, remplacer un portrait JPEG par un PNG laisserait la
// fiche pointer un fichier effacé. Remplacement littéral d'un chemin que nous avons écrit,
// comme la promotion de pipeline/import-medias.py. Rend le nombre de champs corrigés.
function recalerPhotoOriginale(racine, slug, base, extAvant, extApres) {
  if (extAvant === extApres) { return 0; }
  const chemin = cheminMeta(racine, slug);
  let contenu;
  try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { return 0; }
  const ancien = 'photo: "portraits/' + base + '.original.' + extAvant + '"';
  if (contenu.indexOf(ancien) === -1) { return 0; }
  const sortie = contenu.split(ancien).join('photo: "portraits/' + base + '.original.' + extApres + '"');
  try { ecrireAtomique(chemin, sortie); } catch (e) { return 0; }
  return 1;
}

// photo-choisir : le chemin relatif de la version demandée, vérifié sur le disque. Rien
// n'est écrit ici — c'est la fiche d'auteur·e qui portera ce chemin dans son champ `photo`,
// et lui seul dit quelle image le rendu prendra. « Sans fond » par défaut, mais un fond
// clair ou une photo que le détourage abîme demandent l'une des deux autres.
function choisirPhotoAuteur(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }   // slug inconnu : ignoré
  const base = String(msg.base || '');
  const version = String(msg.version || '');
  const erreur = () => repondrePanneau(panneau,
    { type: 'photo-erreur', slug: slug, index: msg.index, message: T('photo.err.introuvable') });
  // Toujours une réponse : la modale attend celle-ci pour enregistrer, et un retour
  // silencieux lui ferait perdre les six champs qu'elle porte.
  if (!baseAuteurValide(base) || VERSIONS_PHOTO.indexOf(version) === -1) { erreur(); return; }
  const dossier = dossierPortraitsArticle(fournisseur.racine, slug);
  let nom = null;
  if (version === 'original') {
    nom = trouverOriginal(dossier, base);
  } else {
    nom = base + '.' + version + '.png';
    try { if (!fs.existsSync(path.join(dossier, nom))) { nom = null; } } catch (e) { nom = null; }
  }
  if (!nom) { erreur(); return; }
  repondrePanneau(panneau, { type: 'photo-valeur', slug: slug, index: msg.index, photo: 'portraits/' + nom });
}

// ---- Formulaire de fiches : tous les articles, ou un seul ------------------------
// Le formulaire liste tous les articles ; l'icône ✎ de l'arbre l'ouvre filtré sur un
// seul, avec la même webview et le même circuit d'écriture. Le panneau étant un
// singleton, changer de filtre le recharge et reconstruit les cartes : la webview annonce
// son état par « modifie », et l'hôte lui demande ses cartes pour jouer la garde.
let filtreArticles = null;           // tableau de slugs affichés, ou null = tous
let rafraichirFiches = null;         // renvoie les valeurs au panneau ouvert, s'il existe
let fichesModifie = false;           // ● côté webview : cartes modifiées non enregistrées
let rechargementEnAttente = null;    // { filtre } pendant l'aller-retour de la garde

// Filtre demandé -> slugs réels, ou null pour tous. Un slug inconnu ne doit pas donner
// un formulaire vide : on retombe sur la liste complète.
function filtreValide(fournisseur, slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) { return null; }
  const connus = new Set(fournisseur.listerArticles());
  const retenus = slugs.map(String).filter((s) => connus.has(s));
  return retenus.length > 0 ? retenus : null;
}

// Écrit un·e seul·e auteur·e dans <slug>.meta.yaml, à son rang, sans toucher au reste :
// c'est ce que la modale partagée demande depuis le gestionnaire des médias, où il n'y a
// pas de carte d'article à enregistrer. Relecture du fichier avant écriture — le formulaire
// des métadonnées peut être ouvert à côté.
// `photoAttendue` est le chemin que l'appelant croyait à ce rang : le rang seul ne désigne
// personne de façon sûre — le formulaire des métadonnées, ouvert à côté, peut avoir retiré
// quelqu'un entre-temps et décalé tous les suivants. Sans ce témoin, on écrirait sur la
// mauvaise personne.
// -> l'auteur·e écrit·e, ou null si la fiche est illisible, le rang inconnu, ou la photo
//    de ce rang n'est plus celle qu'on attendait.
function ecrireAuteur(fournisseur, slug, index, brut, photoAttendue) {
  if (!fournisseur.racine || !new Set(fournisseur.listerArticles()).has(slug)) { return null; }
  const chemin = cheminMeta(fournisseur.racine, slug);
  let meta;
  try { meta = analyserMeta(fs.readFileSync(chemin, 'utf8')); } catch (e) { return null; }
  if (!Array.isArray(meta.author)) { meta.author = []; }
  const rang = Number(index);
  // Un rang existant, jamais un ajout : créer quelqu'un passe par la carte de l'article,
  // qui écrit sa liste entière. Sans cette borne, un appelant sans témoin d'identité
  // ressusciterait la personne qu'on vient de retirer.
  if (!Number.isInteger(rang) || rang < 0 || rang >= meta.author.length) { return null; }
  // Le nettoyage de carte borne les longueurs et assainit le chemin de la photo : un seul
  // endroit décide de ce qui entre dans une fiche.
  const attendue = assainirCheminPhoto(photoAttendue);
  if (attendue !== '') {
    const surPlace = assainirCheminPhoto((meta.author[rang] || {}).photo);
    if (surPlace !== attendue) { return null; }    // la fiche a bougé sous nos pieds
  }
  const propre = nettoyerCarte({ author: [brut] }).author[0];
  if (!propre || (propre.prenom === '' && propre.nom === '')) { return null; }
  meta.author[rang] = propre;
  try { ecrireAtomique(chemin, serialiserMeta(meta)); } catch (e) { return null; }
  return propre;
}

// Une fiche écrite ailleurs — la modale d'auteur·e du gestionnaire des médias — rend le
// modèle du formulaire des métadonnées périmé : son enregistrement automatique réécrirait
// le fichier entier depuis l'ancienne version, et la correction disparaîtrait sans un mot.
// Panneau propre : on le recharge. Panneau portant des cartes modifiées : on ne jette rien
// en douce, on le dit et c'est à l'utilisateur de trancher.
function signalerFichesPerimees() {
  if (!panneauArticles || !rafraichirFiches) { return; }
  if (fichesModifie) { vscode.window.showWarningMessage(T('fiches.perimees')); return; }
  rafraichirFiches();
}

function titreFiches(filtre) {
  return (filtre && filtre.length === 1) ? T('fiches.titre.un', [filtre[0]]) : T('fiches.titre');
}

// La case « Définir manuellement le DOI » d'une carte : la webview n'a pas de boîte de
// dialogue à elle, c'est donc l'hôte qui pose la question — modale, comme les
// confirmations de fermeture — et qui répond. Cocher demande l'avertissement de
// l'échappatoire ; décocher un DOI qui diverge du calculé demande confirmation avant de
// l'effacer. Annuler (choix undefined) laisse la carte telle quelle.
async function confirmerDoiManuel(panneau, msg) {
  const retirer = msg.sens === 'retirer';
  const choix = await vscode.window.showWarningMessage(
    T(retirer ? 'fiches.doi.retirer.question' : 'fiches.doi.manuel.question'),
    { modal: true, detail: T(retirer ? 'fiches.doi.retirer.detail' : 'fiches.doi.manuel.detail') },
    T(retirer ? 'fiches.doi.retirer.oui' : 'fiches.doi.manuel.oui'));
  repondrePanneau(panneau, {
    type: 'doi-manuel-reponse', slug: String(msg.slug || ''),
    sens: retirer ? 'retirer' : 'activer', ok: choix !== undefined
  });
}

// Pleine page : les aperçus sont fermés avant, même pour un simple reveal.
async function ouvrirApercuMetadonnees(fournisseur, rafraichirTout, slugs) {
  if (!fournisseur.racine) { return; }
  const filtre = filtreValide(fournisseur, slugs);
  await fermerTousLesApercus();
  const envoyerValeurs = (panneau) => {
    const langue = langueRevue(fournisseur.racine);
    panneau.webview.postMessage({
      type: 'valeurs',
      articles: lireMetadonneesArticles(fournisseur, filtreArticles),
      filtre: filtreArticles,
      langue: langue,
      accent: lireCouleurAccent(fournisseur.racine),
      types: typesTraduits(langue),
      licences: licencesTraduites(), licenceDefaut: LICENCE_DEFAUT
    });
    envoyerAuteursConnus(panneau);
    fichesModifie = false;                         // les cartes viennent d'être reconstruites
  };
  rafraichirFiches = () => { if (panneauArticles) { envoyerValeurs(panneauArticles); } };
  const appliquerFiltre = (panneau, nouveau) => {
    filtreArticles = nouveau;
    panneau.title = titreFiches(filtreArticles);
    envoyerValeurs(panneau);
  };
  if (panneauArticles) {
    panneauArticles.reveal(vscode.ViewColumn.One);
    if (fichesModifie) {
      // Des cartes portent un ● : le rechargement se joue à la réponse de la webview.
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
    if (panneauArticles === panneau) {
      panneauArticles = null; fichesModifie = false; rechargementEnAttente = null;
      rafraichirFiches = null;
    }
  });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeurs(panneau); return; }
    if (msg.type === 'modifie') { fichesModifie = !!msg.modifie; return; }
    if (msg.type === 'tous') { await ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null); return; }
    if (msg.type === 'rechargement') {
      const attente = rechargementEnAttente;
      rechargementEnAttente = null;
      if (!attente) { return; }                    // réponse tardive : abandonné
      const choix = await vscode.window.showWarningMessage(
        T('fiches.recharger.question'), { modal: true, detail: T('table.quitter.detail') },
        T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
      if (choix === undefined) { return; }         // Annuler : on reste sur les cartes
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
    if (msg.type === 'photo-deposer') { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-ouvrir') { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-choisir') { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'doi-manuel-confirmer') { await confirmerDoiManuel(panneau, msg); return; }
    if (msg.type !== 'enregistrer' || !msg.articles) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles);
    if (res.erreurs.length > 0) {
      panneau.webview.postMessage({ type: 'erreur', message: T('err.ecriture', [res.erreurs.join(', ')]) });
    } else {
      panneau.webview.postMessage({ type: 'enregistre', n: res.n, auto: !!msg.auto });
      if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000); }
    }
    if (rafraichirTout) { rafraichirTout(); }
    // Un enregistrement automatique ne renvoie pas les cartes : le curseur sauterait.
    if (!msg.auto) { envoyerValeurs(panneau); }     // resynchronise et remet le ● à zéro
  });
  panneau.webview.html = htmlApercuMetadonnees(crypto.randomBytes(16).toString('hex'));
}

// Sans item, l'article visé est celui du .md actif, à défaut celui en aperçu.
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

// ---- Dialogue « Vérification de l'import » ---------------------------------------
// Ouvert à la fin de lancerConversion dès qu'un nouvel article est apparu. Une section
// par article : la carte de métadonnées du formulaire des fiches, avec des badges
// « détecté » ou « à compléter » ; les photos d'auteur·e·s ; et les images de
// articles/<slug>/media/, à remplacer par leur original en gardant leur nom.

const TAILLE_MAX_IMAGE_IMPORT = 50 * 1024 * 1024;  // 50 Mo, vérifiés webview et hôte
const EXTENSIONS_IMAGE_IMPORT = ['png', 'jpg', 'jpeg', 'gif', 'svg'];

// Chemin d'image reçu de la webview d'import : relatif à articles/<slug>/media/,
// segments sûrs, extension d'image. Aucun chemin n'est construit sans passer ici. Pure.
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
    sectionImages: T('importv.section.images'),
    imagesAucune: T('importv.images.aucune'), imageDeposer: T('importv.image.deposer'),
    imageRemplacee: T('importv.image.remplacee'),
    errImageTropVolumineuse: T('importv.err.tropvolumineux'),
    errImageFormat: T('importv.err.format')
  }));
  return construireHtml('import-verif', nonce, {
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    titre: T('importv.titre'),
    remplacements: { '__TXT__': txt },
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Articles de la dernière conversion, slugs revalidés.
function lireArticlesImport(fournisseur) {
  const budgetVignettes = { reste: BUDGET_VIGNETTES };
  const connus = new Set(fournisseur.listerArticles());
  const dois = doisCalculesArticles(fournisseur);
  const articles = [];
  for (const slug of slugsImportVerif) {
    if (!connus.has(slug)) { continue; }
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = analyserMeta('');                 // forme de la carte vide
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide, tout « à compléter » */ }
    delete valeurs._inconnues;                     // la webview n'a pas à les voir
    const base = path.join(fournisseur.racine, 'articles', slug, 'media');
    const images = fournisseur._imagesArticle(slug).map((relatif) => ({
      relatif: relatif,
      description: decrireImage(path.join(base, relatif))   // « L × H · poids »
    }));
    articles.push({
      slug: slug, valeurs: valeurs, images: images, doiCalcule: dois[slug] || '',
      apercusAuteurs: (valeurs.author || [])
        .map((a) => vignetteAuteur(fournisseur.racine, slug, a.photo, budgetVignettes))
    });
  }
  return articles;
}

function envoyerValeursImportVerif(panneau, fournisseur) {
  const langue = langueRevue(fournisseur.racine);
  repondrePanneau(panneau, {
    type: 'valeurs',
    articles: lireArticlesImport(fournisseur),
    langue: langue,
    accent: lireCouleurAccent(fournisseur.racine),
    types: typesTraduits(langue),
    licences: licencesTraduites(), licenceDefaut: LICENCE_DEFAUT
  });
  envoyerAuteursConnus(panneau);
}

// Le remplacement lui-même est celui du gestionnaire des médias ; ici, seul l'aller-retour
// avec la webview change. Une annulation est signalée, qui réactive la zone de dépôt.
async function remplacerImageImport(fournisseur, rafraichirTout, panneau, msg) {
  const slug = String(msg.slug || '');
  const relatif = String(msg.relatif || '');
  const res = await remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif,
    msg.nomFichier, msg.donneesBase64);
  if (res.etat === 'annule') {
    repondrePanneau(panneau, { type: 'image-annulee', slug: slug, relatif: relatif });
    return;
  }
  if (res.etat === 'erreur') {
    repondrePanneau(panneau, { type: 'image-erreur', slug: slug, relatif: relatif, message: res.message });
    return;
  }
  repondrePanneau(panneau, {
    type: 'image-remplacee', slug: slug, relatif: relatif,
    description: decrireImage(path.join(fournisseur.racine, 'articles', slug, 'media', relatif))
  });
}

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
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { envoyerValeursImportVerif(panneau, fournisseur); return; }
    if (msg.type === 'photo-deposer') { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-ouvrir') { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-choisir') { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'doi-manuel-confirmer') { await confirmerDoiManuel(panneau, msg); return; }
    if (msg.type === 'remplacer-image') { await remplacerImageImport(fournisseur, rafraichirTout, panneau, msg); return; }
    if (msg.type === 'fermer') {
      // Seul chemin de fermeture contrôlable : la croix de l'onglet est hors de portée.
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
    // Pas de re-rendu sur un enregistrement automatique : le curseur serait perdu.
    if (!msg.auto) { envoyerValeursImportVerif(panneau, fournisseur); }
  });
  panneau.webview.html = htmlImportVerif(crypto.randomBytes(16).toString('hex'));
}

// ---- Réglages « SZH » ------------------------------------------------------------
// Formulaire webview qui écrit au niveau utilisateur par getConfiguration().update(…,
// Global). Le choix français/allemand pilote les chaînes du cockpit (szh.langue) et la
// locale native (argv.json, effective au redémarrage, et qui suppose le pack de langue).

function REGL_TEXTES() {
  return JSON.stringify(REGL_LIBELLES());
}

function REGL_LIBELLES() {
  return {
  theme: T('regl.theme'),
  themeSysteme: T('regl.theme.systeme'), themeClair: T('regl.theme.clair'), themeSombre: T('regl.theme.sombre'),
  zoom: T('regl.zoom'),
  zoomNormal: T('regl.zoom.normal'), zoomGrand: T('regl.zoom.grand'), zoomTresGrand: T('regl.zoom.tresgrand'),
  policeMd: T('regl.policemd'),
  apercu: T('regl.apercu'),
  apercuHtml: T('regl.apercu.html'), apercuPdf: T('regl.apercu.pdf'),
  assets: T('regl.assets'), assetsOui: T('regl.assets.oui'), assetsNon: T('regl.assets.non'),
  cmyk: T('regl.cmyk'), cmykOui: T('regl.cmyk.oui'), cmykNon: T('regl.cmyk.non'),
  warnings: T('regl.warnings'),
  warningsComplets: T('regl.warnings.complets'), warningsReduits: T('regl.warnings.reduits'),
  langue: T('regl.langue'),
  dev: T('regl.dev'), devOui: T('regl.dev.oui'), devNon: T('regl.dev.non'),
  auteursMaj: T('regl.auteurs.maj'), auteursJamais: T('regl.auteurs.jamais'),
  ojsRevues: T('ojs.revues'), ojsVide: T('ojs.vide'),
  ojsRubriques: T('ojs.rubriques'), ojsRubriquesAide: T('ojs.rubriques.aide'),
  ojsColCle: T('ojs.col.cle'), ojsColAbbrev: T('ojs.col.abbrev'), ojsColTitre: T('ojs.col.titre'),
  ojsColResume: T('ojs.col.resume'), ojsColDoi: T('ojs.col.doi'),
  ojsAjouter: T('ojs.ajouter'), ojsCleNouvelle: T('ojs.cle.nouvelle'),
  ojsTypes: T('ojs.types'), ojsTypesAide: T('ojs.types.aide'),
  biblioTitre: T('biblio.titre'), biblioColLangue: T('biblio.col.langue'),
  biblioVide: T('biblio.vide')
  };
}

// Ce que le panneau doit connaître du titre de la bibliographie : les intitulés effectifs,
// les deux revues et les trois langues, avec leur nom lisible. Les listes viennent de
// lib/citations.js et de lib/yaml.js — le panneau n'en recopie aucune, et les valeurs par
// défaut vivent dans le filtre de composition, seul endroit où elles existent.
function donneesBiblio() {
  return {
    titres: configBiblio().titres,
    revues: REVUES_BIBLIO.map((cle) => ({
      cle: cle,
      libelle: T('ojs.revue.' + (REVUES.find((r) => r.cle === cle) || {}).langue)
    })),
    langues: LANGUES_BIBLIO.map((cle) => ({ cle: cle, libelle: T('meta.langue.' + cle) }))
  };
}

// L'état de la liste des auteur·e·s publiés, pour le groupe informatif des réglages :
// quand elle a été mise à jour, combien de noms elle porte. Rien ne se règle là — le
// rafraîchissement se fait seul, à l'activation (rafraichirAuteursPubliesEnFond).
function resumeAuteursPublies() {
  try {
    const cache = lireCacheAuteursPublies();
    return { dateFetch: cache.dateFetch, nombre: cache.auteurs.length };
  } catch (e) { return { dateFetch: null, nombre: 0 }; }
}

// Ce que le panneau doit connaître de l'export OJS : la configuration effective, la liste
// des champs par revue avec le libellé et l'endroit où relever la valeur, et les types
// d'article. Les listes viennent de lib/export-ojs.js et de lib/yaml.js — le panneau n'en
// recopie aucune.
function donneesOjs() {
  const langue = langueCockpit();
  const revues = {};
  for (const loc of LOCALES_REVUE) { revues[loc] = T('ojs.revue.' + loc); }
  return {
    config: configOjs(),
    locales: LOCALES_REVUE,
    revues: revues,
    // Les clés des rubriques livrées ne se renomment pas : une clé changée laisserait
    // l'ancienne en place et le type d'article pointerait dans le vide.
    clesDefaut: RUBRIQUES_DEFAUT.map((r) => r.cle),
    champs: CHAMPS_REVUE.map((c) => ({
      cle: c.cle, requis: c.requis, libelle: T(c.libelle), ou: T(c.ou)
    })),
    typesArticle: TYPES_ARTICLE.map((t) => ({
      valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t
    }))
  };
}

function htmlReglages(nonce) {
  return construireHtml('settings', nonce, {
    cssPartage: ['_design.css'], titre: T('regl.titre'), remplacements: { '__TXT__': REGL_TEXTES() }
  });
}

// Par expression régulière : argv.json accepte des commentaires, qu'un JSON.parse
// perdrait.
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
  } catch (e) { /* valeur par défaut : 16 */ }
  // La valeur écrite, et non modeApercu(), qui force « html » sur un profil sans PDF.
  let apercu = 'html';
  try {
    apercu = String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { /* valeur par défaut : html */ }
  return {
    theme: etatTheme, zoom: String(zoom), policeMd: String(policeMd), apercu: apercu,
    assets: replierAssetsAutres() ? 'oui' : 'non',
    cmyk: convertirCmykActif() ? 'oui' : 'non',
    warnings: reduireWarningsImpressionActif() ? 'reduits' : 'complets',
    langue: langueCockpit(),
    // Dans config.json : ses consommateurs sont les scripts PowerShell.
    dev: lireModeDeveloppeur() ? 'oui' : 'non'
  };
}

let panneauReglages = null;

function ouvrirReglages(rafraichirTout) {
  if (panneauReglages) {
    panneauReglages.reveal(vscode.ViewColumn.One);
    panneauReglages.webview.postMessage(
      { type: 'valeurs', valeurs: lireReglagesActuels(), ojs: donneesOjs(),
        biblio: donneesBiblio(), auteursOjs: resumeAuteursPublies() });
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhReglages', T('regl.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauReglages = panneau;
  panneau.onDidDispose(() => { if (panneauReglages === panneau) { panneauReglages = null; } });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') {
      panneau.webview.postMessage(
        { type: 'valeurs', valeurs: lireReglagesActuels(), ojs: donneesOjs(),
        biblio: donneesBiblio(), auteursOjs: resumeAuteursPublies() });
      return;
    }
    // La configuration de l'export OJS va dans config.json, comme le mode développeur :
    // ce sont des réglages de poste, partagés avec les scripts PowerShell.
    if (msg.type === 'reglerOjs') {
      const erreur = ecrireConfigOjs(msg.ojs || {});
      if (erreur) { vscode.window.showErrorMessage(T('ojs.err.ecriture', [erreur])); }
      else { repondrePanneau(panneau, { type: 'enregistre', bloc: 'ojs' }); }
      return;
    }
    // Le titre de la bibliographie, dans le même config.json et par les mêmes deux
    // fonctions. Illisible n'est pas absent : on n'écrase pas un fichier qu'on n'a pas su
    // lire, sans quoi l'emplacement des revues et la configuration OJS partiraient avec.
    if (msg.type === 'reglerBiblio') {
      const avant = lireConfigPoste();
      if (avant === null && fs.existsSync(CONFIG_POSTE)) {
        vscode.window.showErrorMessage(T('err.ecriture', [CONFIG_POSTE]));
        return;
      }
      const erreur = ecrireConfigPoste(configAvecTitresBiblio(avant, msg.titres || {}));
      if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [erreur])); }
      else { repondrePanneau(panneau, { type: 'enregistre', bloc: 'biblio' }); }
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
        // Limité à [markdown] : la taille d'affichage, pas le contenu.
        await vscode.workspace.getConfiguration('editor', { languageId: 'markdown' })
          .update('fontSize', Number(msg.valeur) || 16, Global, true);
      } else if (msg.cle === 'apercu') {
        // Même réglage szh.apercuMode que la bascule Ctrl+Alt+P et la barre d'état.
        await vscode.workspace.getConfiguration('szh')
          .update('apercuMode', msg.valeur === 'pdf' ? 'pdf' : 'html', Global);
        if (rafraichirTout) { rafraichirTout(); } // la barre d'état « Aperçu : … » suit
      } else if (msg.cle === 'assets') {
        // Les identités d'article changent avec le réglage : l'arbre doit suivre.
        await vscode.workspace.getConfiguration('szh')
          .update('replierAssetsAutres', msg.valeur !== 'non', vscode.ConfigurationTarget.Global);
        if (rafraichirTout) { rafraichirTout(); }
      } else if (msg.cle === 'cmyk') {
        await vscode.workspace.getConfiguration('szh')
          .update('convertirCmyk', msg.valeur !== 'non', Global);
      } else if (msg.cle === 'warnings') {
        // Le verdict recalculé arrive au prochain rendu du gestionnaire des médias.
        await vscode.workspace.getConfiguration('szh')
          .update('reduireWarningsImpression', msg.valeur === 'reduits', Global);
      } else if (msg.cle === 'dev') {
        // bootstrap.ps1 donne au groupe Utilisateurs le droit d'écrire ce fichier.
        const erreur = ecrireModeDeveloppeur(msg.valeur !== 'non');
        if (erreur) { vscode.window.showErrorMessage(T('err.dev.ecriture', [erreur])); }
      } else if (msg.cle === 'langue') {
        const langue = msg.valeur === 'de' ? 'de' : 'fr';
        await vscode.workspace.getConfiguration('szh').update('langue', langue, Global);
        ecrireLocaleArgv(langue);                  // langue native : au prochain démarrage
        vscode.window.showInformationMessage(T('info.redemarrer'));
        if (rafraichirTout) { rafraichirTout(); }  // libellés de l'arbre tout de suite
      }
    } catch (e) {
      vscode.window.showErrorMessage(T('err.ecriture', [e.message]));
    }
  });
  panneau.webview.html = htmlReglages(crypto.randomBytes(16).toString('hex'));
}

// ---- Éditeur de tableau (webview) ------------------------------------------------
// Un tableau est un <table class="szh-tableau"> autonome dans
// articles/<slug>/tables/table-NN.html : style porté par des attributs data-* sur <table>
// et <tr>, en-têtes par <th scope>, inline simple dans les cellules. Parseur et
// sérialiseur, purs, dans lib/table-model.js.

// Couleur annuelle d'ausgabe.yaml pour l'aperçu ; '' fait retomber sur le gris.
function lireCouleurAccent(racine) {
  try {
    const c = String(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).couleur || '').toUpperCase();
    return HEX_COULEURS.indexOf(c) !== -1 ? c : '';
  } catch (e) { return ''; }
}

// Teintes lues dans out/.szh-accent.css, écrit par accent-css.py, et jamais recalculées :
// l'éditeur doit montrer les hex que WeasyPrint appliquera.
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

function textesTable() {
  const cles = [
    'table.enregistrer', 'table.fusionner', 'table.scinder',
    'table.grpApercu', 'table.apercuVoir', 'table.apercuCacher',
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
    'table.section.a11y', 'table.coller',
    'table.ctx.alignGauche', 'table.ctx.alignCentre', 'table.ctx.alignDroite',
    'table.plusLigne', 'table.plusColonne', 'table.tirerReordonner', 'table.deplacementImpossible',
    'table.suppr.question', 'table.suppr.detail', 'table.suppr.bouton',
    'table.tip.entete', 'table.tip.enteteRetirer'
  ];
  const o = {};
  for (const c of cles) { o[c.slice('table.'.length)] = T(c); }
  return o;
}

// Le contenu du tableau n'est pas injecté dans le HTML : le modèle arrive par
// postMessage et la grille est construite en DOM, sans innerHTML.
function htmlEditeurTable(nonce) {
  // media/table-editor.{html,css,js} ; les libellés arrivent par postMessage.
  return construireHtml('table-editor', nonce, {
    cssPartage: ['_design.css'], titre: T('table.titre', [''])
  });
}

let panneauxTable = new Map();   // fsPath -> WebviewPanel (un éditeur par fichier)

async function ouvrirEditeurTable(fournisseur, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  const chemin = item.cheminAsset;
  const nom = path.basename(chemin);
  const slugArticle = item.slug || apercuCourantSlug;
  // L'éditeur a besoin de largeur ; « Voir dans l'aperçu » le rouvre à la demande.
  await fermerTousLesApercus();
  const existant = panneauxTable.get(chemin);
  if (existant) { existant.reveal(vscode.ViewColumn.One); return; }
  const panneau = vscode.window.createWebviewPanel(
    'szhEditeurTable', T('table.titre', [nom]), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauxTable.set(chemin, panneau);
  panneau.onDidDispose(() => { if (panneauxTable.get(chemin) === panneau) { panneauxTable.delete(chemin); } });
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
  // La webview ne demande confirmation que pour supprimer une ligne ou colonne non vide.
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
    ecrireAtomique(chemin, serialiserTable(normaliserModele(modele)));
    // L'enregistrement automatique reste silencieux.
    if (!auto) { vscode.window.setStatusBarMessage(T('statut.table.enregistree', [nom]), 5000); }
  };
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { charger(); return; }
    if (msg.type === 'operation') { await appliquer(msg); return; }
    if (msg.type === 'restaurer') {
      // La pile d'annulation vit dans la webview ; l'hôte calcule la disposition.
      const m = normaliserModele(msg.modele);
      panneau.webview.postMessage({ type: 'charger', modele: m, disposition: disposition(m),
        accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE });
      return;
    }
    if (msg.type === 'apercu-ouvrir') {
      // Cherche dans le .md la ligne de la référence ::: {.szh-tabelle src="…"}. Le
      // tableau inclus étant un bloc HTML brut, sans position source, la webview peut
      // n'avoir rien à surligner.
      if (!slugArticle) { return; }
      ouvrirApercuHtml(fournisseur, slugArticle);
      const md = path.join(fournisseur.racine, 'articles', slugArticle, slugArticle + '.md');
      let ligne = 0;
      try {
        const lignes = fs.readFileSync(md, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lignes.length; i++) {
          if (lignes[i].indexOf(nom) !== -1 && lignes[i].indexOf('szh-tabelle') !== -1) { ligne = i + 1; break; }
        }
      } catch (e) { /* .md illisible : l'aperçu est rouvert, cela suffit */ }
      if (ligne > 0) {
        // La webview vient d'être créée, son script n'écoute pas encore.
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
      panneau.title = (msg.modifie ? '● ' : '') + T('table.titre', [nom]);
      return;
    }
    if (msg.type === 'retourArticle') {
      // Garde « non enregistré » sur un chemin de fermeture que l'on contrôle.
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
  panneau.webview.html = htmlEditeurTable(crypto.randomBytes(16).toString('hex'));
}

// ---- Gestionnaire des médias d'un article ----------------------------------------
// Un formulaire pour tous les médias de l'article, ouvert par l'icône « médias » de
// l'arbre à côté de celle des métadonnées. Les images ne figurent plus sous l'article
// dans la barre latérale : elles se gèrent ici, où l'on voit d'un coup ce qui manque.
//
// La légende, le texte alternatif et les crédits d'une image vivent dans le texte de
// l'article : ![Légende](media/x.png){alt="…" copyright="…" source="…"}. Le formulaire lit
// et réécrit ces références par les fonctions pures de lib/references.js, en passant par
// WorkspaceEdit puis doc.save() pour rester annulable. Le fichier lui-même se remplace par
// dépôt, à nom conservé, et se retire avec ses insertions.
//
// Les portraits des auteur·e·s (articles/<slug>/portraits/) sont listés en pied : ce ne
// sont pas des figures, on n'y juge que la qualité et on les remplace, le pipeline de
// détourage étant rejoué au dépôt.

// Dans un <img>, un SVG ne peut ni exécuter de script ni charger de ressource externe.
const MIMES_APERCU_MEDIA = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp'
};
// Au-delà, pas d'aperçu : le base64 d'une grosse image gonflerait le postMessage.
const TAILLE_MAX_APERCU_MEDIA = 8 * 1024 * 1024;
// Et un plafond pour le message entier : le formulaire charge d'un coup les aperçus de
// toutes les images et de tous les portraits. Quinze photos d'impression suffiraient à
// envoyer plus de cent mégaoctets de base64 dans un seul postMessage et à figer l'hôte.
// Passé le budget, les cartes suivantes s'affichent sans aperçu.
const BUDGET_APERCUS_MEDIA = 24 * 1024 * 1024;

// `budget` (facultatif) = { reste: octets } décrémenté au fil des aperçus rendus.
function apercuMedia(chemin, budget) {
  try {
    const octets = fs.statSync(chemin).size;
    if (octets > TAILLE_MAX_APERCU_MEDIA) { return null; }
    if (budget) {
      if (budget.reste < octets) { return null; }
      budget.reste -= octets;
    }
    const ext = (chemin.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
    if (!MIMES_APERCU_MEDIA[ext]) { return null; }
    return 'data:' + MIMES_APERCU_MEDIA[ext] + ';base64,' + fs.readFileSync(chemin).toString('base64');
  } catch (e) { return null; }
}

function textesMedias() {
  return Object.assign({
    sectionImages: T('medias.section.images'), sectionPortraits: T('medias.section.portraits'),
    aucuneImage: T('medias.aucune.image'), aucunPortrait: T('medias.aucun.portrait'),
    resume: T('medias.resume'), rienAEcrire: T('medias.rienAEcrire'),
    legende: T('img.legende'), legendeIndice: T('img.legende.indice'),
    roleTitre: T('img.role.titre'),
    roleDecrit: T('img.role.decrit'), roleDeco: T('img.role.deco'),
    alt: T('img.alt'), altIndice: T('img.alt.indice'),
    copyright: T('img.copyright'), copyrightIndice: T('img.copyright.indice'),
    source: T('img.source'), sourceIndice: T('img.source.indice'),
    horsFigureTitre: T('medias.horsfigure.titre'), horsFigure: T('medias.horsfigure'),
    qualiteInsuffisant: T('medias.qualite.insuffisant'),
    qualiteJuste: T('medias.qualite.juste'),
    qualitePortraitInsuffisant: T('medias.qualite.portrait.insuffisant'),
    qualitePortraitJuste: T('medias.qualite.portrait.juste'),
    remplacer: T('medias.remplacer'), choisirFichier: T('medias.choisirFichier'),
    agrandir: T('medias.agrandir'), fermer: T('medias.fermer'),
    remplacee: T('medias.remplacee'),
    errFormat: T('medias.err.format'), errTropVolumineuse: T('medias.err.tropvolumineux'),
    retirerTip: T('medias.tip.retirer'),
    inserer: T('medias.inserer'), insererTip: T('medias.tip.inserer'),
    altManquant: T('medias.alt.manquant'), altDivergent: T('medias.alt.divergent'),
    doublonDe: T('medias.doublon'),
    retour: T('img.retour'), retourTip: T('img.tip.retour'),
    enregistrer: T('img.enregistrer'), enregistrerTip: T('medias.tip.enregistrer'),
    enregistre: T('medias.enregistre'), nonEnregistre: T('img.nonEnregistre'),
    occZero: T('img.occ.zero'), sectionAccessibilite: T('medias.section.a11y'),
    etatJamais: T('medias.etat.jamais'), etatInsertions: T('medias.etat.insertions'),
    etatHorsFigure: T('medias.etat.horsfigure'), etatDoublon: T('medias.etat.doublon'),
    etatOrphelin: T('medias.etat.orphelin'),
    apercuAbsent: T('img.apercu.absent'), portraitOrphelin: T('medias.portrait.orphelin'),
    auteurEnregistre: T('medias.auteur.enregistre')
  }, textesAuteur());
}

function htmlMedias(nonce) {
  return construireHtml('medias-article', nonce, {
    cssPartage: ['_design.css', '_auteurs.css'], jsPartage: ['_auteurs.js'],
    titre: T('medias.titre', ['']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Fichiers identiques sous deux noms : Word duplique volontiers la même image, et deux
// cartes pour un seul visuel se remplissent deux fois, avec deux légendes qui divergent.
// L'empreinte du contenu le dit, là où la taille seule se trompe.
function empreinteFichier(chemin) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(chemin)).digest('hex'); }
  catch (e) { return null; }
}

function tailleFichier(chemin) {
  try { return fs.statSync(chemin).size; } catch (e) { return -1; }
}

// relatif -> empreinte, pour les seuls fichiers dont la taille est partagée : deux contenus
// identiques ont forcément la même taille, et l'immense majorité des articles n'a aucun
// doublon. Sans ce tri, chaque chargement relisait tous les fichiers pour rien.
function empreintesPartagees(base, relatifs) {
  const parTaille = new Map();
  for (const relatif of relatifs) {
    const t = tailleFichier(path.join(base, relatif));
    if (t <= 0) { continue; }
    if (!parTaille.has(t)) { parTaille.set(t, []); }
    parTaille.get(t).push(relatif);
  }
  const empreintes = new Map();
  for (const memeTaille of parTaille.values()) {
    if (memeTaille.length < 2) { continue; }
    for (const relatif of memeTaille) {
      const e = empreinteFichier(path.join(base, relatif));
      if (e) { empreintes.set(relatif, e); }
    }
  }
  return empreintes;
}

// Un descripteur par image de media/, dans l'ordre du texte puis, pour celles qui n'y
// sont pas, dans l'ordre alphabétique de l'arbre.
function listerMediasArticle(fournisseur, slug, texteMd, budget) {
  const base = path.join(fournisseur.racine, 'articles', slug, 'media');
  const ordre = ordreImages(texteMd);
  // Le formulaire ne montre que les valeurs de la PREMIÈRE insertion ; l'export, lui, juge
  // toutes les insertions. Sans ce report, une image insérée deux fois dont la seconde n'a
  // ni alternative ni légende passait pour saine au formulaire et rouge à l'export.
  const sansAlternative = new Set(
    imagesSansAlternative(texteMd).map((i) => i.relatif).filter(Boolean));
  const relatifs = fournisseur._imagesArticle(slug);
  const empreintes = empreintesPartagees(base, relatifs);
  const liste = relatifs.map((relatif) => {
    const chemin = path.join(base, relatif);
    const v = lireAttributsImage(texteMd, relatif);
    return {
      relatif: relatif,
      description: decrireImage(chemin),
      apercu: apercuMedia(chemin, budget),
      occurrences: v.n,
      sansAlternative: sansAlternative.has(relatif.toLowerCase()),
      qualite: qualiteImage('figure', lireDimensionsImage(chemin), relatif,
        { reduit: reduireWarningsImpressionActif() }),
      valeurs: {
        legende: v.legende, alt: v.alt, altDefini: v.altDefini,
        copyright: v.copyright, source: v.source, horsFigure: v.horsFigure
      },
      _rang: ordre.has(relatif.toLowerCase()) ? ordre.get(relatif.toLowerCase()) : Number.MAX_SAFE_INTEGER,
      _empreinte: empreintes.get(relatif) || null
    };
  });
  liste.sort((a, b) => (a._rang !== b._rang ? a._rang - b._rang : a.relatif.localeCompare(b.relatif, 'fr')));
  const parEmpreinte = new Map();
  for (const m of liste) {
    if (!m._empreinte) { continue; }
    if (!parEmpreinte.has(m._empreinte)) { parEmpreinte.set(m._empreinte, []); }
    parEmpreinte.get(m._empreinte).push(m.relatif);
  }
  for (const m of liste) {
    const memes = m._empreinte ? parEmpreinte.get(m._empreinte) : [m.relatif];
    m.doublons = memes.filter((r) => r !== m.relatif);
    delete m._rang;
    delete m._empreinte;
  }
  return liste;
}

// Un descripteur par portrait, c'est-à-dire par base : <base>.original.<ext> et ses deux
// dérivés ne font qu'une photo. Le verdict de qualité porte sur l'original, seul endroit
// où la qualité se gagne ; l'aperçu montre la version que la fiche utilise.
function listerPortraitsArticle(fournisseur, slug, budget) {
  const dossier = dossierPortraitsArticle(fournisseur.racine, slug);
  let noms = [];
  try { noms = fs.readdirSync(dossier); } catch (e) { return []; }
  const bases = new Map();
  for (const nom of noms) {
    if (nom.indexOf('~$') === 0) { continue; }
    const d = decomposerPhoto(nom);
    if (!d || !baseAuteurValide(d.base)) { continue; }
    if (!bases.has(d.base)) { bases.set(d.base, {}); }
    bases.get(d.base)[d.version] = nom;
  }
  if (bases.size === 0) { return []; }
  // Auteur·e rattaché·e, et version retenue par la fiche : le champ `photo` du meta.yaml.
  // Le rang dans meta.author accompagne le nom : c'est par lui que la fiche d'auteur·e
  // s'édite, la modale et l'écriture ne connaissant que { slug, index }.
  const parPhoto = new Map();
  try {
    const meta = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    (meta.author || []).forEach((a, index) => {
      const photo = assainirCheminPhoto(a.photo);
      if (photo === '') { return; }
      const nom = (String(a.prenom || '').trim() + ' ' + String(a.nom || '').trim()).trim();
      parPhoto.set(photo.replace(/^portraits\//, ''), { nom: nom, index: index, fiche: a });
    });
  } catch (e) { /* pas de fiche : portraits sans auteur rattaché */ }
  const liste = [];
  for (const base of Array.from(bases.keys()).sort((a, b) => a.localeCompare(b, 'fr'))) {
    const versions = bases.get(base);
    // Version montrée : celle que la fiche désigne, sinon l'ordre de repli du formulaire.
    let utilisee = null;
    let auteur = null;
    for (const version of ['original', 'avec-fond', 'sans-fond']) {
      const nom = versions[version];
      if (nom && parPhoto.has(nom)) { utilisee = nom; auteur = parPhoto.get(nom); break; }
    }
    if (!utilisee) {
      for (const version of ['sans-fond', 'avec-fond', 'original']) {
        if (versions[version]) { utilisee = versions[version]; break; }
      }
    }
    const original = versions.original || utilisee;
    const cheminOriginal = path.join(dossier, original);
    liste.push({
      base: base,
      nom: utilisee,
      auteur: auteur ? auteur.nom : null,
      index: auteur ? auteur.index : -1,
      auteurFiche: auteur ? auteur.fiche : null,
      // Quelles versions existent, et laquelle sert : c'est la modale de la fiche
      // d'auteur·e qui le demande par photo-ouvrir, au moment où elle s'ouvre. La carte
      // n'en a pas besoin, et ces champs n'ont donc plus à voyager avec elle.
      rattache: auteur !== null,
      version: T('medias.portrait.version', ['portraits/' + utilisee]),
      description: T('medias.portrait.original', [decrireImage(cheminOriginal)]),
      apercu: apercuMedia(path.join(dossier, utilisee), budget),
      qualite: qualiteImage('portrait', lireDimensionsImage(cheminOriginal), original,
        { reduit: reduireWarningsImpressionActif() })
    });
  }
  return liste;
}

// Une image que le texte n'insère nulle part n'a aucun endroit où porter sa légende et ses
// crédits : sa carte se verrouille, et le seul geste utile qu'elle peut offrir est de
// l'insérer. Le choix de la place est dans lib/references.js (placeFigure), avec la liste
// des endroits où une image insérée ne serait pas une figure — ou disparaîtrait du rendu.
// -> { ok, auCurseur } ; auCurseur dit à l'appelant ce qu'il doit annoncer.
async function insererImageDansArticle(md, relatif) {
  let doc;
  try { doc = await vscode.workspace.openTextDocument(md); }
  catch (e) { return { ok: false }; }
  const lignes = [];
  for (let i = 0; i < doc.lineCount; i++) { lignes.push(doc.lineAt(i).text); }
  const editeur = vscode.window.visibleTextEditors
    .filter((e) => e.document.uri.fsPath === md)[0] || null;
  const place = editeur ? placeFigure(lignes, editeur.selection.active.line) : null;
  const auCurseur = place !== null;
  const ligne = auCurseur ? place.ligne : Math.max(0, lignes.length - 1);
  const colonne = auCurseur ? place.colonne : (lignes[lignes.length - 1] || '').length;
  const reference = '![' + T('fmt.figure.legende') + '](media/' + relatif + ')';
  try {
    const edition = new vscode.WorkspaceEdit();
    edition.insert(doc.uri, new vscode.Position(ligne, colonne),
      envelopperFigure(lignes, ligne, colonne, reference));
    if (!(await vscode.workspace.applyEdit(edition))) { return { ok: false }; }
    await doc.save();                              // déclenche la recompilation
  } catch (e) { return { ok: false }; }
  return { ok: true, auCurseur: auCurseur };
}

let panneauxMedias = new Map();   // slug -> WebviewPanel (un gestionnaire par article)

async function ouvrirGestionMedias(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine) { return; }
  const racine = fournisseur.racine;
  // Même cascade que le formulaire des fiches : l'item de l'arbre, l'éditeur actif, puis
  // l'aperçu courant — et un message quand il n'y a vraiment pas d'article en vue.
  let slug = (item && item.slug) ? String(item.slug) : null;
  if (!slug) {
    const ed = vscode.window.activeTextEditor;
    slug = ed ? slugDepuisChemin(racine, ed.document.uri.fsPath) : null;
  }
  if (!slug) { slug = apercuCourantSlug; }
  if (!slug || !new Set(fournisseur.listerArticles()).has(slug)) {
    vscode.window.setStatusBarMessage(T('fiches.horsarticle'), 4000);
    return;
  }
  // Mis à jour à chaque ouverture : le gestionnaire d'un panneau déjà ouvert le lit.
  let focus = String((item && item.focus) || '');
  const md = path.join(racine, 'articles', slug, slug + '.md');
  const existant = panneauxMedias.get(slug);
  if (existant) {
    // Pas de rechargement : il écraserait des saisies non encore écrites. Seule la carte
    // visée est amenée à l'écran.
    existant.reveal(vscode.ViewColumn.One);
    if (focus !== '') { repondrePanneau(existant, { type: 'focaliser', relatif: focus }); }
    return;
  }
  // Le formulaire prend toute la place ; sans cela la webview s'ouvre derrière un PDF.
  await fermerTousLesApercus();
  const panneau = vscode.window.createWebviewPanel(
    'szhMedias', T('medias.titre', [slug]), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauxMedias.set(slug, panneau);
  panneau.onDidDispose(() => { if (panneauxMedias.get(slug) === panneau) { panneauxMedias.delete(slug); } });

  // openTextDocument lit le tampon : l'écriture repart d'une frappe non enregistrée.
  async function texteArticle() {
    try {
      const doc = await vscode.workspace.openTextDocument(md);
      return doc.getText();
    } catch (e) { return ''; }
  }
  async function charger(cible) {
    const texteMd = await texteArticle();
    const budget = { reste: BUDGET_APERCUS_MEDIA };
    repondrePanneau(cible, {
      type: 'charger', slug: slug,
      medias: listerMediasArticle(fournisseur, slug, texteMd, budget),
      portraits: listerPortraitsArticle(fournisseur, slug, budget),
      focus: focus, accent: lireCouleurAccent(fournisseur.racine), i18n: textesMedias()
    });
    envoyerAuteursConnus(cible);
  }

  // Toutes les insertions de chaque image, qui n'ont qu'un jeu de légende et de crédits.
  // Rend le nombre d'insertions réécrites, ou -1 en cas d'échec déjà signalé.
  const enregistrer = async (liste) => {
    let doc;
    try { doc = await vscode.workspace.openTextDocument(md); }
    catch (e) { repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [e.message]) }); return -1; }
    const source = doc.getText();
    let texte = source;
    let total = 0;
    let disparues = 0;
    for (const m of (Array.isArray(liste) ? liste : [])) {
      const relatif = String((m && m.relatif) || '');
      if (!relatifImageValide(relatif)) { continue; }        // chemin refusé : ignoré
      const res = ecrireAttributsImage(texte, relatif, (m && m.valeurs) || {});
      if (res.n === 0) { disparues++; continue; }             // retirée du .md entre-temps
      texte = res.texte;
      total += res.n;
    }
    if (disparues > 0) {
      // Retirées du .md depuis le chargement : le dire, sinon leurs cartes se croient
      // enregistrées.
      vscode.window.setStatusBarMessage(T('medias.statut.disparues', [disparues]), 5000);
    }
    if (texte === source) { return total; }        // déjà à jour : pas d'édition
    try {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), texte);
      if (!(await vscode.workspace.applyEdit(edition))) {
        repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [md]) });
        return -1;
      }
      await doc.save();                              // déclenche la recompilation
    } catch (e) {
      repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [e.message]) });
      return -1;
    }
    return total;
  };

  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === 'pret') { await charger(panneau); return; }
    if (msg.type === 'modifie') {
      panneau.title = (msg.modifie ? '● ' : '') + T('medias.titre', [slug]);
      return;
    }
    if (msg.type === 'enregistrer') {
      const n = await enregistrer(msg.medias);
      // En échec, `enregistrer` a déjà posté « erreur », qui lève aussi le verrou
      // « écriture en vol » : poster « enregistre » par-dessus effacerait l'avertissement
      // et déclarerait propres des cartes dont rien n'a été écrit.
      if (n < 0) { return; }
      repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto });
      if (n > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('medias.statut.enregistrees', [n]), 5000); }
      return;
    }
    if (msg.type === 'remplacer') {
      // La garde de cmdEcriture ne couvre que l'ouverture : ces trois gestes écrivent par
      // fs, hors du système de fichiers de l'éditeur, et un panneau resté ouvert survit au
      // verrouillage du numéro.
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: 'media-annulee', relatif: String(msg.relatif || '') });
        return;
      }
      const relatif = String(msg.relatif || '');
      const res = await remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif,
        msg.nomFichier, msg.donneesBase64);
      if (res.etat === 'annule') { repondrePanneau(panneau, { type: 'media-annulee', relatif: relatif }); return; }
      if (res.etat === 'erreur') {
        repondrePanneau(panneau, { type: 'media-erreur', relatif: relatif, message: res.message });
        return;
      }
      const chemin = path.join(racine, 'articles', slug, 'media', relatif);
      repondrePanneau(panneau, {
        type: 'media-remplace', relatif: relatif, description: decrireImage(chemin),
        apercu: apercuMedia(chemin, { reste: BUDGET_APERCUS_MEDIA }),
        qualite: qualiteImage('figure', lireDimensionsImage(chemin), relatif,
          { reduit: reduireWarningsImpressionActif() })
      });
      return;
    }
    if (msg.type === 'inserer') {
      if (refuserSiVerrouille()) { return; }
      const relatif = String(msg.relatif || '');
      if (!relatifImageValide(relatif)) { return; }
      // Les saisies en cours d'abord : l'insertion réécrit le .md, et le formulaire est
      // rechargé juste après pour que la carte se déverrouille.
      if (Array.isArray(msg.medias) && msg.medias.length > 0 && await enregistrer(msg.medias) < 0) { return; }
      const pose = await insererImageDansArticle(md, relatif);
      if (!pose.ok) {
        repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [md]) });
        return;
      }
      // Dire où elle est allée : au curseur, ou en fin d'article quand le curseur était
      // dans une liste, un tableau, un bloc de code ou un bloc pandoc.
      vscode.window.setStatusBarMessage(
        T(pose.auCurseur ? 'medias.statut.inseree' : 'medias.statut.inseree.fin', [relatif]), 6000);
      if (rafraichirTout) { rafraichirTout(); }
      await charger(panneau);
      return;
    }
    if (msg.type === 'retirer') {
      if (refuserSiVerrouille()) { return; }
      const relatif = String(msg.relatif || '');
      if (!relatifImageValide(relatif)) { return; }
      const cheminAsset = path.join(racine, 'articles', slug, 'media', relatif);
      const retire = await supprimerAsset(fournisseur, rafraichirTout,
        { slug: slug, cheminAsset: cheminAsset }, false);
      if (retire) { repondrePanneau(panneau, { type: 'media-retire', relatif: relatif }); }
      return;
    }
    // La fiche d'auteur·e, éditée dans la modale partagée : écrite tout de suite, puis
    // l'état du portrait est relu sur le disque — la photo a pu changer de version.
    if (msg.type === 'auteur-enregistrer') {
      const index = Number(msg.index);
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: 'auteur-erreur', slug: slug, index: index, message: T('verrou.refuse') });
        return;
      }
      const propre = ecrireAuteur(fournisseur, slug, index, msg.auteur, msg.photoAttendue);
      if (!propre) {
        repondrePanneau(panneau, { type: 'auteur-erreur', slug: slug, index: index, message: T('auteur.err.decale') });
        return;
      }
      if (rafraichirTout) { rafraichirTout(); }     // le PDF porte le nom et la photo
      signalerFichesPerimees();                     // le formulaire des fiches, s'il est ouvert
      const budget = { reste: BUDGET_APERCUS_MEDIA };
      const portrait = listerPortraitsArticle(fournisseur, slug, budget)
        .filter((x) => x.index === index)[0] || null;
      repondrePanneau(panneau, {
        type: 'auteur-enregistre', slug: slug, index: index, auteur: propre, portrait: portrait
      });
      return;
    }
    // Photo : les trois messages du composant partagé, comme dans les deux formulaires de
    // métadonnées.
    if (msg.type === 'photo-deposer') { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-ouvrir') { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === 'photo-choisir') { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === 'retourArticle') {
      // Garde « non enregistré », comme dans l'éditeur de tableau.
      if (msg.modifie) {
        const choix = await vscode.window.showWarningMessage(
          T('medias.quitter.question', [slug]), { modal: true, detail: T('table.quitter.detail') },
          T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
        if (choix === undefined) { return; }          // Annuler : on reste
        if (choix === T('form.enregistrer')) {
          const n = await enregistrer(msg.medias);
          if (n < 0) { return; }                      // échec d'écriture : on reste
          if (n > 0) { vscode.window.setStatusBarMessage(T('medias.statut.enregistrees', [n]), 5000); }
        }
      }
      await ouvrirArticle(fournisseur, slug);
      panneau.dispose();
      return;
    }
  });
  panneau.webview.html = htmlMedias(crypto.randomBytes(16).toString('hex'));
}

function activate(context) {
  const fournisseur = new FournisseurRevue();
  const vue = vscode.window.createTreeView(ID_VUE, {
    treeDataProvider: fournisseur,
    showCollapseAll: false,
    // rafraichirTout est défini plus bas, d'où l'indirection.
    dragAndDropController: controleurDepotVue(fournisseur, () => rafraichirTout())
  });
  context.subscriptions.push(vue);

  let watchers = [];
  context.subscriptions.push({ dispose: () => { for (const w of watchers) { w.dispose(); } } });
  context.subscriptions.push({ dispose: arreterDormeurWsl });   // pas de dormeur orphelin

  const barreApercu = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  barreApercu.command = 'szh.basculerApercu';
  context.subscriptions.push(barreApercu);

  // N'apparaît que sur un numéro gelé, et passe avant l'aperçu : c'est ce qui explique
  // pourquoi l'éditeur ne répond plus aux frappes.
  // Le compteur des contrôles : à gauche de la bascule d'aperçu, masqué quand la dernière
  // compilation n'a rien relevé.
  barreControles = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
  barreControles.command = 'szh.vueControles';
  context.subscriptions.push(barreControles);

  const barreEtat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
  context.subscriptions.push(barreEtat);
  const majBarreApercu = () => {
    barreApercu.text = T(modeApercu() === 'html' ? 'apercu.barre.html' : 'apercu.barre.pdf');
    barreApercu.tooltip = T('apercu.barre.tooltip');
    if (fournisseur.racine) { barreApercu.show(); } else { barreApercu.hide(); }
  };

  // getChildren recalcule le compte des Word, le titre suit le numéro, et l'aperçu HTML
  // est rechargé si sa sortie a été régénérée.
  const rafraichirTout = () => {
    // Avant tout le reste : le titre de la vue et les boutons de l'arbre en dépendent.
    majEtatNumero(fournisseur, barreEtat);
    fournisseur.rafraichir();
    // Le fichier dérivé des DOI calculés suit chaque rafraîchissement : tout geste qui
    // change un rang passe par ici, et l'écriture ne se fait qu'au changement.
    ecrireDoisCalcules(fournisseur);
    vue.title = fournisseur.racine ? titreVue(fournisseur.racine) : T('arbre.titre.defaut');
    majBarreApercu();
    rechargerApercuHtmlSiChange(fournisseur);
  };

  // Regroupe les rafales du système de fichiers : OneDrive en émet plusieurs.
  let minuteur = null;
  const rafraichirBientot = () => {
    if (minuteur) { clearTimeout(minuteur); }
    minuteur = setTimeout(() => { minuteur = null; rafraichirTout(); }, 300);
  };

  const reinstallerWatchers = (racine) => {
    for (const w of watchers) { w.dispose(); }
    watchers = [];
    if (!racine) { return; }
    // Articles, Word déposés, sorties, et ausgabe.yaml dont dépend le titre de la vue.
    for (const motif of ['articles/**', 'articles-word/*', 'out/**', 'ausgabe.yaml']) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(racine, motif));
      w.onDidCreate(rafraichirBientot);
      w.onDidChange(rafraichirBientot);
      w.onDidDelete(rafraichirBientot);
      watchers.push(w);
    }
  };

  const majContexte = () => {
    const racine = trouverRacineRevue();
    fournisseur.definirRacine(racine);
    divergenceSignalee = false;                    // un avertissement par revue ouverte
    // Les constats appartiennent au numéro qui les a produits : changer de numéro les
    // périme, sinon le compteur de la barre d'état parlerait du précédent et un échec de
    // compilation ici se ferait taire par un bloquant venu d'ailleurs. On relit le journal
    // du nouveau numéro sans rien annoncer : ce que la dernière compilation avait relevé
    // est encore vrai à l'ouverture, mais ce n'est pas une nouvelle.
    if (dernierJournal.racine !== racine) {
      // `reimport` compris : les cinq autres affectations le posent, et lireControles le
      // concatène sans le tester. L'oublier ici suffisait à faire taire tous les constats.
      dernierJournal = { racine: racine, constats: lireJournalTache(racine), code: 0, reimport: [] };
    }
    majBarreControles();
    profilRevue = lireProfil(racine);            // pilote le mode d'aperçu
    vscode.commands.executeCommand('setContext', CLE_CONTEXTE, !!racine);
    reinstallerWatchers(racine);
    if (racine) { demarrerDormeurWsl(); } else { arreterDormeurWsl(); }
    rafraichirTout();
  };

  // `cmd` pour ce qui lit, `cmdEcriture` pour ce qui modifie le numéro et se voit refusé
  // quand il est verrouillé : la liste montre ce que le verrou protège.
  const cmd = (id, fn) => vscode.commands.registerCommand(id, fn);
  const cmdEcriture = (id, fn) => vscode.commands.registerCommand(id, function () {
    if (refuserSiVerrouille()) { return undefined; }
    return fn.apply(null, arguments);
  });

  context.subscriptions.push(
    cmd('szh.cockpit.rafraichir', majContexte),
    cmdEcriture('szh.metadonnees', () => ouvrirMetadonnees(fournisseur, rafraichirTout)),
    cmdEcriture('szh.apercuMetadonnees', () => ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null)),
    // Le même formulaire, filtré sur un article.
    cmdEcriture('szh.metadonneesArticle', (item) => ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.traduction', (item) => ouvrirTraduction(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.traductionsToutPret', () => marquerToutPretTraduction(fournisseur, rafraichirTout)),
    // Le tutoriel : neuf étapes dans la page d'accueil de l'éditeur, cochées à mesure que
    // les commandes correspondantes sont jouées. C'est le seul « calque » qu'une extension
    // puisse poser par-dessus l'interface — un webview vit dans son cadre et ne peut pas
    // dessiner sur la barre latérale ni sur les onglets.
    vscode.commands.registerCommand('szh.tutoriel', () => vscode.commands.executeCommand(
      'workbench.action.openWalkthrough', 'szh-csps.szh-cockpit#szhDemarrage', false)),
    vscode.commands.registerCommand('szh.vueTraductions',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'traductions')),
    cmd('szh.vueArticles', () => ouvrirVueArticles(fournisseur, rafraichirTout)),
    cmd('szh.envoyerAuteur', (item) => envoyerAuteur(fournisseur, item)),
    vscode.commands.registerCommand('szh.vueWord',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'word')),
    vscode.commands.registerCommand('szh.vueControles',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'controles')),
    // Fabriquer un lien ne modifie rien : disponible même sur un numéro verrouillé.
    cmd('szh.envoyerTraduction', (item) => envoyerPourTraduction(fournisseur, item)),
    cmd('szh.reglages', () => ouvrirReglages(rafraichirTout)),
    cmd('szh.basculerApercu', () => basculerApercu(fournisseur, majBarreApercu)),
    cmdEcriture('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    cmdEcriture('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    // Les exports restent ouverts sur un numéro gelé, dont l'archivage a supprimé out/.
    cmd('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    cmd('szh.exporterXml', () => exporterXml(fournisseur, rafraichirTout)),
    cmd('szh.exporterArticle', (item) => exporterArticle(fournisseur, rafraichirTout, item)),
    // Ces gestes posent et lèvent le verrou : ils restent hors de cmdEcriture.
    cmd('szh.archiverVerrouiller', () => archiverEtVerrouiller(fournisseur, rafraichirTout)),
    cmd('szh.deverrouiller', () => deverrouiller(fournisseur, rafraichirTout)),
    cmd('szh.desarchiver', () => desarchiver(fournisseur, rafraichirTout)),
    // Le second argument transmet les options (sansApercu depuis la vue Articles) ; les
    // appelants historiques (arbre, Contrôles, démarrage) n'en passent pas : rien ne change.
    cmd('szh.ouvrirArticle', (slug, opts) => ouvrirArticle(fournisseur, slug, opts)),
    cmdEcriture('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    // Le Word corrigé d'un article déjà publié, et le retour en arrière. Les deux
    // remplacent le texte : refusés sur un numéro verrouillé, comme la suppression.
    cmdEcriture('szh.reimporterArticle', (item) => reimporterArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.annulerReimport', (item) => annulerReimport(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.supprimerTable', (item) => supprimerAsset(fournisseur, rafraichirTout, item, true)),
    cmdEcriture('szh.editerTable', (item) => ouvrirEditeurTable(fournisseur, item)),
    // Le formulaire des médias de l'article : légendes, crédits, qualité, remplacement.
    cmdEcriture('szh.mediasArticle', (item) => ouvrirGestionMedias(fournisseur, rafraichirTout, item)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte),
    // L'avertissement part au démarrage d'une tâche : Ctrl+S, le chemin le plus fréquent,
    // ne passe pas par les fonctions du cockpit.
    vscode.tasks.onDidStartTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      const nomsSuivis = [NOM_TACHE_BUILD, NOM_TACHE_EXPORT, NOM_TACHE_IMPORT, NOM_TACHE_DOCX];
      const estNotre = (tache.definition && tache.definition.type === 'szh');
      if (nomsSuivis.indexOf(tache.name) === -1 && !estNotre) { return; }
      avertirVersionSiDivergente();
    }),
    // Et à la fin : ce que la chaîne a relevé. Même raison de passer par l'événement
    // plutôt que par lancerTache() — Ctrl+S, le chemin le plus fréquent, ne passe par
    // aucune fonction du cockpit, et c'est justement là que les avertissements naissent.
    vscode.tasks.onDidEndTaskProcess((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      const nomsSuivis = [NOM_TACHE_BUILD, NOM_TACHE_EXPORT, NOM_TACHE_IMPORT, NOM_TACHE_DOCX];
      const estNotre = (tache.definition && tache.definition.type === 'szh');
      if (nomsSuivis.indexOf(tache.name) === -1 && !estNotre) { return; }
      relireJournal(fournisseur, e.exitCode === undefined ? 0 : e.exitCode)
        .catch(() => { /* un avis raté ne casse pas la compilation */ });
    }),
    // Éditeur -> aperçu ; ignoré si l'événement vient de notre révélation de ligne.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!panneauApercuHtml || modeApercu() !== 'html' || defilementProgrammatiqueHote) { return; }
      if (!e.visibleRanges || !e.visibleRanges.length) { return; }
      const ed = editeurArticleCourant(fournisseur);
      if (!ed || e.textEditor !== ed) { return; }
      pousserDefilementVersApercu(e.visibleRanges[0].start.line);
    }),
    // Sens inverse : le curseur dans le .md surligne le bloc et le mot dans l'aperçu.
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!panneauApercuHtml || modeApercu() !== 'html') { return; }
      const ed = editeurArticleCourant(fournisseur);
      if (!ed || e.textEditor !== ed) { return; }
      pousserSurlignageVersApercu(fournisseur);
    })
  );

  // Contexte injecté dans lib/formatting.js : le collage de tableau (Ctrl+Alt+V) doit
  // savoir s'il est dans un article, et rafraîchir l'arbre.
  enregistrerCommandesMiseEnForme(context, {
    racine: () => fournisseur.racine,
    slugDepuisChemin: slugDepuisChemin,
    rafraichirTout: rafraichirTout,
    // Une image choisie à la main peut aussi sortir d'une chaîne d'imprimerie.
    convertirCmyk: (chemins) => convertirCmykSiBesoin(chemins),
    // Toute la mise en forme écrit dans le texte : refusée sur un numéro gelé.
    verrouillee: () => etatCourant().verrouillee,
    refuser: () => { refuserSiVerrouille(); }
  });

  // Les trois panneaux de la barre ; celui d'export s'adapte à l'état du numéro.
  enregistrerPanneaux(context, { etat: etatCourant });

  // Réveil de la machine WSL puis chargement de l'arbre, derrière un indicateur de
  // progression pour ne pas laisser une fenêtre qui semble figée.
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
          await reveillerWsl();                    // démarrage à froid de la machine
          progress.report({ message: T('demarrage.revue') });
          majContexte();                           // racine, contexte, watchers, dormeur, arbre
          await ouvrirArticleActifAuDemarrage(fournisseur);
          await honorerIntention(fournisseur, rafraichirTout); // un lien szh:// reçu
        });
    } finally { barre.dispose(); }
    proposerTutoriel(context);
  };
  // La liste des auteur·e·s publiés (OAI-PMH public d'ojs.szh.ch) se rafraîchit en tâche
  // de fond, au plus une fois par semaine — sans bloquer l'activation, et sans un mot en
  // cas d'échec réseau : hors ligne est un état normal du poste.
  rafraichirAuteursPubliesEnFond();
  demarrageInitial();
}

// Une seule fois, et seulement sur un numéro ouvert : la page d'accueil de l'éditeur est
// désactivée par nos réglages, et la barre d'activités masquée — sans cette invitation,
// le tutoriel n'existerait que pour qui pense à le chercher.
async function proposerTutoriel(context) {
  try {
    if (context.globalState.get(CLE_TUTORIEL_VU)) { return; }
    await context.globalState.update(CLE_TUTORIEL_VU, true);
    const ouvrir = T('tuto.invite.bouton');
    const choix = await vscode.window.showInformationMessage(T('tuto.invite'), ouvrir);
    if (choix === ouvrir) { await vscode.commands.executeCommand('szh.tutoriel'); }
  } catch (e) { /* invitation ratée : la commande et l'icône restent */ }
}

function deactivate() { arreterDormeurWsl(); }

// `_pur` : les fonctions pures, exposées aux harnais de test.
module.exports = {
  activate, deactivate,
  _pur: {
    titreNumero, slugDepuisChemin, lireProfil,
    separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
    analyserMeta, serialiserMeta, lignePos, plagePos, positionMot, jetonSource,
    analyserAusgabe, serialiserAusgabe,
    nettoyerCarte, assainirCheminPhoto, decomposerPhoto, relatifImageValide,
    analyserTraduction, serialiserTraduction, lignesTraduction, resumeTraduction,
    versionsDivergent, poidsLisible, construireLienTraduction,
    brouillonTraduction, uriMailto, brouillonAuteur, adressesAuteurs,
    ordonnerArticles, deplacerArticle, prefixeOrdre, libelleArticle, titreFiche,
    tachesRevue, tachesConfig, configAvecTaches, libelleTache, resumeTaches, basculerTache,
    analyserTachesFaites, serialiserTachesFaites, nomCouverture,
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
    // Pas pures — elles lisent et écrivent le numéro — mais exposées pour le même
    // contrôle : le fichier dérivé des DOI doit pouvoir s'éprouver sans hôte complet.
    doisCalculesArticles, ecrireDoisCalcules, permuterStatutsTraduction,
    TEXTES_COCKPIT
  }
};
