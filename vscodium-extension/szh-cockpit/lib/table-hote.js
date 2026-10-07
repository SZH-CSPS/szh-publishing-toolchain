// Éditeur de tableau : la webview d'un tableau d'article (articles/<slug>/tables/table-NN.html),
// un éditeur par fichier. Le modèle, pur, vit dans lib/table-model.js ; les images des
// cellules dans lib/table-images.js.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { panneauUnique } = require('./webviews/panneau');
const { fermerTousLesApercus, fermerApercuHtml, ouvrirApercuHtml } = require('./apercu');
const { annoncerMain, noterLectureCoedition, ecrireSousMain, libererCoedition } = require('./coedition-hote');
const { sousGarde, confirmerAbandon } = require('./interaction');
const { ecrireAtomique } = require('./yaml');
const { BUDGET_APERCUS_MEDIA } = require('./medias');
const tableImages = require('./table-images');
const { RE_DIV_OUVERTURE, fermetureDeDiv, retirerTable } = require('./references');
const {
  analyserTable, serialiserTable, disposition, normaliserModele, appliquerOperationTable,
  PRESETS_ORDRE
} = require('./table-model');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés par extension.js. Les valeurs par défaut permettent de charger ce module seul
// dans un test.
let ctx = {
  lireCouleurAccent: () => '',
  ouvrirArticle: async () => {},
  convertirCmykSiBesoin: async () => 0,
  repondreModeTrad: require('./traduction-hote').repondreModeTrad,
  // Un enregistrement a changé ce que la compilation de l'article lit (relanceDifferee).
  demanderCompilation: () => {},
  viderCompilation: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le dossier des unités de texte du profil actif (lib/profil.js#courant).
function dossierUnites() { return profils.courant().unites.dossier; }

// Un tableau est un <table class="szh-tableau"> seul dans
// articles/<slug>/tables/table-NN.html : style en attributs data-* sur <table> et <tr>,
// en-têtes en <th scope>, mise en forme simple dans les cellules (voir lib/table-model.js).


// Teintes lues dans out/.szh-accent.css (écrit par accent-css.py) plutôt que recalculées :
// l'éditeur montre les couleurs exactes du PDF.
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
    'table.entete', 'table.entete.lignes', 'table.entete.colonnes', 'table.enteteRetirer',
    'table.sectionTitre', 'table.sectionTitreRetirer',
    'table.legende', 'table.legende.indice',
    'table.alt', 'table.alt.indice', 'table.alt.aide',
    'table.copyright', 'table.copyright.indice', 'table.source', 'table.source.indice',
    'table.note', 'table.note.indice',
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
    'table.tip.entete', 'table.tip.enteteRetirer',
    'table.image.menuAlt', 'table.image.menuRemplacer', 'table.image.menuInserer',
    'table.image.introuvable', 'table.image.indisponible', 'table.image.altManquant',
    'table.image.saisieTitre', 'table.image.valider', 'table.image.annuler'
  ];
  const o = {};
  for (const c of cles) { o[c.slice('table.'.length)] = T(c); }
  // Libellés de la saisie du texte alternatif, partagés avec le gestionnaire des médias
  // (clés gardées sous leur nom entier, « img.role.deco »…).
  for (const c of ['img.role.titre', 'img.role.decrit', 'img.role.deco', 'img.alt', 'img.alt.indice']) { o[c] = T(c); }
  return o;
}

// Le modèle du tableau arrive par postMessage ; la grille est construite en DOM, sans
// innerHTML.
function htmlEditeurTable(nonce) {
  // media/table-editor.{html,css,js} ; les libellés arrivent par postMessage.
  // img-src data: : les aperçus des images de cellule arrivent en data: (lib/table-images.js),
  // la webview n'ayant aucune racine locale autorisée.
  return construireHtml('table-editor', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'], titre: T('table.titre', ['']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

let panneauxTable = new Map();   // fsPath -> WebviewPanel (un éditeur par fichier)

// Rappel pour lib/cycle-vie.js (fermerFormulairesEcriture). Les clés sont ici des chemins
// de fichier. Sans `slug` ou sans `racine`, tout se ferme (verrouillage du numéro).
function fermerPanneauxTableDe(racine, slug) {
  const tout = !racine || !slug;
  const dossier = tout ? null : path.join(racine, dossierUnites(), slug) + path.sep;
  for (const [cle, panneau] of Array.from(panneauxTable.entries())) {
    if (!tout && String(cle).indexOf(dossier) !== 0) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    panneauxTable.delete(cle);
  }
}

// Le tableau visé par le bouton d'un constat (lib/constats.js, lieu « table »), reçu en
// { slug, focus } où focus nomme le fichier (table-02.html). Sans focus (veraPDF ne donne
// parfois que des numéros de page) : un seul tableau s'ouvre directement, plusieurs font
// poser la question, aucun ouvre l'article. -> { cheminAsset, slug } ou null.
async function tableDuConstat(fournisseur, item) {
  const slug = String((item && item.slug) || '');
  if (slug === '' || !new Set(fournisseur.listerArticles()).has(slug)) { return null; }
  const tables = fournisseur._tablesArticle(slug);
  const dossier = path.join(fournisseur.racine, dossierUnites(), slug, 'tables');
  // « table-02.html|portrait.jpeg » : le tableau, puis l'image à y décrire
  // (constatsPourControles), transmise à l'éditeur dans item.focusImage.
  const [focusTable, focusImage] = String((item && item.focus) || '').split('|');
  const focus = path.basename(focusTable || '');
  const vise = focus === '' ? null : tables.find((n) => n.toLowerCase() === focus.toLowerCase());
  if (vise) {
    return { cheminAsset: path.join(dossier, vise), slug: slug, focusImage: focusImage || '' };
  }
  if (tables.length === 1) { return { cheminAsset: path.join(dossier, tables[0]), slug: slug }; }
  if (tables.length === 0) {
    await vscode.commands.executeCommand('szh.ouvrirArticle', { slug: slug, focus: '' });
    return null;
  }
  // Sous garde : la fin d'une compilation (aperçu rafraîchi, voile levé) fermerait le choix.
  const choix = await sousGarde(() =>
    vscode.window.showQuickPick(tables, { placeHolder: T('table.choisir', [slug]) }));
  return choix ? { cheminAsset: path.join(dossier, choix), slug: slug } : null;
}

// Le texte du bloc ::: {.szh-tabelle …} qui contient la ligne `ligne` (0-based), de son
// ouverture à sa fermeture, ou null. Pure.
function blocTableAutour(lignes, ligne) {
  for (let i = Math.min(ligne, lignes.length - 1); i >= 0; i--) {
    const ouverture = RE_DIV_OUVERTURE.exec(lignes[i]);
    if (!ouverture) { continue; }
    if (ouverture[1].indexOf('szh-tabelle') === -1) { return null; }
    const fin = fermetureDeDiv(lignes, i);
    if (i !== ligne && fin < ligne) { return null; }
    return lignes.slice(i, fin === -1 ? i + 1 : fin + 1).join('\n');
  }
  return null;
}

// Sans élément de l'arbre (palette, panneau Édition) : le tableau dont la référence entoure
// le curseur de l'éditeur actif, ou null. Le src se lit par retirerTable.
async function tableSousCurseur(fournisseur) {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !ed.document || !ed.selection) { return null; }
  const rel = path.relative(path.join(fournisseur.racine, dossierUnites()), ed.document.uri.fsPath).split(path.sep);
  if (rel.length !== 2 || rel[1].toLowerCase() !== (rel[0] + '.md').toLowerCase()) { return null; }
  const bloc = blocTableAutour(ed.document.getText().split(/\r?\n/), ed.selection.active.line);
  if (!bloc) { return null; }
  const nom = fournisseur._tablesArticle(rel[0]).find((n) => retirerTable(bloc, n).n > 0);
  return nom ? tableDuConstat(fournisseur, { slug: rel[0], focus: nom }) : null;
}

// `item.focusImage` (facultatif) : le nom de fichier d'une image de cellule (un chemin
// est ramené à son nom). L'éditeur sélectionne sa cellule et, si l'image n'a ni texte
// alternatif ni rôle décoratif, ouvre sa saisie (focaliserImage, media/table-editor.js).
async function ouvrirEditeurTable(fournisseur, item) {
  if (!fournisseur.racine) { return; }
  if (!item) {
    item = await tableSousCurseur(fournisseur);
    if (!item) { vscode.window.setStatusBarMessage(T('table.curseur.aucun'), 5000); return; }
  }
  const focusImage = path.basename(String(item.focusImage || '').replace(/\\/g, '/'));
  if (!item.cheminAsset) {
    item = await tableDuConstat(fournisseur, item);
    if (!item) { return; }
  }
  const chemin = item.cheminAsset;
  const nom = path.basename(chemin);
  const slugArticle = item.slug || session.apercuCourantSlug();
  // Les images des cellules sont relatives au dossier de l'article, pas à tables/.
  const dossierArticle = tableImages.dossierArticleDeTable(chemin);
  // L'article à recompiler est celui du dossier du tableau (<unités>/<slug>/tables/) :
  // l'aperçu courant peut montrer un autre article.
  const slugCompile = (() => {
    const s = item.slug ? String(item.slug) : path.basename(dossierArticle);
    return new Set(fournisseur.listerArticles()).has(s) ? s : null;
  })();
  // L'éditeur a besoin de largeur ; « Voir dans l'aperçu » le rouvre à la demande.
  await fermerTousLesApercus();
  // Les gestionnaires ne sont appelés qu'après la fin de cette fonction : ils peuvent
  // utiliser les fonctions déclarées plus bas.
  let focusEnAttente = focusImage;   // servi au premier chargement seulement
  const { panneau, nouveau } = panneauUnique({
    viewType: 'szhEditeurTable', cle: chemin, titre: T('table.titre', [nom]), garde: panneauxTable,
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    retenir: true,
    // Mode « Trad » : voir repondreModeTrad.
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlEditeurTable,
    surPret: () => traiterPret(),
    surMessage: (msg) => traiterMessage(msg),
    surFermeture: (p) => {
      libererCoedition(p);
      // Un enregistrement encore sous l'anti-rebond part à la fermeture, sans attendre.
      if (slugCompile) { ctx.viderCompilation(slugCompile); }
    }
  });
  if (!nouveau) {
    annoncerMain(panneau, fournisseur.racine, chemin);
    if (focusImage) { panneau.webview.postMessage({ type: MSG.FOCALISER, focusImage: focusImage }); }
    return;
  }
  const charger = () => {
    let html = '';
    try { html = fs.readFileSync(chemin, 'utf8'); } catch (e) { html = '<table><tr><td></td></tr></table>'; }
    noterLectureCoedition(panneau, fournisseur.racine, chemin);
    const modele = analyserTable(html);
    panneau.webview.postMessage({
      type: MSG.CHARGER, modele: modele, disposition: disposition(modele),
      accent: ctx.lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE,
      i18n: textesTable(),
      apercus: tableImages.apercusImagesTable(dossierArticle, modele),
      focusImage: focusEnAttente || undefined
    });
    focusEnAttente = '';
  };
  // « Insérer une image… » / « Remplacer l'image… » : sélecteur de fichier, puis copie dans
  // media/. La réponse ne porte que le src et son aperçu : la webview applique l'opération
  // elle-même, pour qu'elle entre dans son historique d'annulation.
  const choisirImage = async (msg) => {
    const filtres = {};
    filtres[T('fmt.figure.filtre')] = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
    const remplacer = msg.action === 'remplacer';
    const choix = await vscode.window.showOpenDialog({
      canSelectMany: false, filters: filtres,
      openLabel: T(remplacer ? 'table.image.boutonRemplacer' : 'fmt.figure.bouton'),
      title: T(remplacer ? 'table.image.titreRemplacer' : 'fmt.figure.titre')
    });
    if (!choix || choix.length === 0) { return; }      // dialogue annulé : rien ne change
    const source = choix[0].fsPath;
    let copie;
    try { copie = await tableImages.copierImageDansArticle(dossierArticle, source, ctx.convertirCmykSiBesoin); }
    catch (e) {
      const message = e && e.code === 'format'
        ? T('table.image.format', [path.basename(source)])
        : T('err.copie', [path.basename(source), String((e && e.message) || e)]);
      vscode.window.showErrorMessage(message);
      panneau.webview.postMessage({ type: MSG.ERREUR, message: message });
      return;
    }
    vscode.window.setStatusBarMessage(T('fmt.figure.copiee', [copie.nom]), 4000);
    panneau.webview.postMessage({
      type: MSG.TABLE_IMAGE_CHOISIE, action: remplacer ? 'remplacer' : 'inserer',
      li: msg.li, ci: msg.ci, n: msg.n, src: copie.src,
      apercu: tableImages.apercuImageTable(dossierArticle, copie.src, { reste: BUDGET_APERCUS_MEDIA })
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
    if (res && res.erreur) { panneau.webview.postMessage({ type: MSG.ERREUR, message: T(res.erreur) }); return; }
    panneau.webview.postMessage({ type: MSG.CHARGER, modele: res, disposition: disposition(res),
      accent: ctx.lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE });
  };
  // -> null quand le tableau est écrit, sinon { code, message } : bail de co-édition tenu
  //    par un autre poste, saisie périmée, ou échec d'écriture.
  // Seul un fichier qui a changé relance la compilation : l'enregistrement automatique
  // repart à chaque sortie de champ.
  const enregistrer = (modele, auto) => {
    let change = false;
    const refus = ecrireSousMain(panneau, fournisseur.racine, chemin, () => {
      try {
        const texte = serialiserTable(normaliserModele(modele));
        let avant = null;
        try { avant = fs.readFileSync(chemin, 'utf8'); } catch (e) { avant = null; }
        ecrireAtomique(chemin, texte);
        change = avant !== texte;
        return null;
      }
      catch (e) { return String((e && e.message) || e); }
    });
    if (refus) { return refus; }
    if (change && slugCompile) { ctx.demanderCompilation(fournisseur, slugCompile); }
    // L'enregistrement automatique reste silencieux.
    if (!auto) { vscode.window.setStatusBarMessage(T('statut.table.enregistree', [nom]), 5000); }
    return null;
  };
  function traiterPret() {
    charger();
    // Un éditeur de tableau ne s'ouvre pas pour lire : le bail se prend tout de suite.
    annoncerMain(panneau, fournisseur.racine, chemin);
  }
  async function traiterMessage(msg) {
    if (msg.type === MSG.OPERATION) { await appliquer(msg); return; }
    if (msg.type === MSG.TABLE_IMAGE_CHOISIR) { await choisirImage(msg); return; }
    if (msg.type === MSG.RESTAURER) {
      // La pile d'annulation vit dans la webview ; l'hôte calcule la disposition.
      const m = normaliserModele(msg.modele);
      panneau.webview.postMessage({ type: MSG.CHARGER, modele: m, disposition: disposition(m),
        accent: ctx.lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE });
      return;
    }
    if (msg.type === MSG.APERCU_OUVRIR) {
      // Cherche dans le .md la ligne de la référence ::: {.szh-tabelle src="…"}. Le tableau
      // inclus est du HTML brut sans position source : il peut n'y avoir rien à surligner.
      if (!slugArticle) { return; }
      ouvrirApercuHtml(fournisseur, slugArticle);
      const md = path.join(fournisseur.racine, dossierUnites(), slugArticle, slugArticle + '.md');
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
          if (!session.panneauApercuHtml()) { return; }
          try { session.panneauApercuHtml().webview.postMessage({ type: MSG.SURLIGNER, ligne: ligne, mot: '' }); }
          catch (e) { /* aperçu refermé entre-temps */ }
        }, 400);
      }
      return;
    }
    if (msg.type === MSG.APERCU_FERMER) { fermerApercuHtml(); return; }
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + T('table.titre', [nom]);
      return;
    }
    if (msg.type === MSG.RETOUR_ARTICLE) {
      // Garde « non enregistré » sur un chemin de fermeture que l'on contrôle.
      if (msg.modifie) {
        const choix = await confirmerAbandon(T('table.quitter.question', [nom]));
        if (choix === 'annuler') { return; }                       // Annuler : on reste
        if (choix === 'enregistrer') {
          const refus = enregistrer(msg.modele);
          if (refus) { panneau.webview.postMessage({ type: MSG.ERREUR, message: refus.message }); return; }
        }
      }
      if (item.slug) { await ctx.ouvrirArticle(fournisseur, item.slug); }
      panneau.dispose();
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const refus = enregistrer(msg.modele, !!msg.auto);
      if (refus) {
        panneau.webview.postMessage({ type: MSG.ERREUR, message: refus.message });
        // Périmé : la grille à l'écran n'est plus celle du fichier, elle repart du disque.
        if (refus.code === 'perime') { charger(); }
        return;
      }
      panneau.webview.postMessage({ type: MSG.ENREGISTRE, auto: !!msg.auto });
      return;
    }
    console.warn('éditeur de tableau : type de message inconnu', msg.type);
  }
}

// Le panneau de l'éditeur ouvert sur ce fichier, ou undefined (pour fermer celui d'un
// tableau supprimé).
function panneauTableOuvert(chemin) { return panneauxTable.get(chemin); }

module.exports = {
  configurer, ouvrirEditeurTable, tableDuConstat, fermerPanneauxTableDe, panneauTableOuvert,
  lireTeintesAccent, textesTable, htmlEditeurTable
};
