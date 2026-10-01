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
const { sousGarde, confirmerAbandon } = require('./interaction');
const { ecrireAtomique } = require('./yaml');
const { BUDGET_APERCUS_MEDIA } = require('./medias');
const tableImages = require('./table-images');
const {
  analyserTable, serialiserTable, disposition, normaliserModele, appliquerOperationTable,
  PRESETS_ORDRE
} = require('./table-model');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois, dans extension.js. Les valeurs par défaut ne servent qu'à ne pas
// planter un test qui require ce module seul.
let ctx = {
  lireCouleurAccent: () => '',
  ouvrirArticle: async () => {},
  convertirCmykSiBesoin: async () => 0,
  repondreModeTrad: require('./traduction-hote').repondreModeTrad,
  // Co-édition : le bail d'un fichier, tenu tant que le panneau est ouvert.
  annoncerMain: () => null,
  noterLectureCoedition: () => {},
  ecrireSousMain: (panneau, racine, chemin, ecrire) => {
    const erreur = ecrire();
    return erreur ? { code: 'echec', message: String(erreur) } : null;
  },
  libererCoedition: () => {},
  // Un enregistrement a changé ce que la compilation de l'article lit (relanceDifferee).
  demanderCompilation: () => {},
  viderCompilation: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le dossier des unités de texte du profil actif (lib/profil.js#courant).
function dossierUnites() { return profils.courant().unites.dossier; }

// Un tableau est un <table class="szh-tableau"> autonome dans
// articles/<slug>/tables/table-NN.html : style porté par des attributs data-* sur <table>
// et <tr>, en-têtes par <th scope>, inline simple dans les cellules. Parseur et
// sérialiseur, purs, dans lib/table-model.js.


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
  // La saisie du texte alternatif d'une image de cellule parle comme le gestionnaire des
  // médias : mêmes clés, gardées sous leur nom entier (« img.role.deco »…).
  for (const c of ['img.role.titre', 'img.role.decrit', 'img.role.deco', 'img.alt', 'img.alt.indice']) { o[c] = T(c); }
  return o;
}

// Le contenu du tableau n'est pas injecté dans le HTML : le modèle arrive par
// postMessage et la grille est construite en DOM, sans innerHTML.
function htmlEditeurTable(nonce) {
  // media/table-editor.{html,css,js} ; les libellés arrivent par postMessage.
  // img-src data: : les aperçus des images de cellule arrivent en data: (lib/table-images.js),
  // comme partout dans le cockpit — la webview n'a aucune racine locale autorisée.
  return construireHtml('table-editor', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'], titre: T('table.titre', ['']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

let panneauxTable = new Map();   // fsPath -> WebviewPanel (un éditeur par fichier)

// Rappel donné à lib/cycle-vie.js (fermerFormulairesEcriture) : lui seul connaît la forme
// de ses clés (un chemin de fichier, ici, pas un slug). `slug` absent ou `racine` absente
// -> tout fermer (verrouillage du numéro).
function fermerPanneauxTableDe(racine, slug) {
  const tout = !racine || !slug;
  const dossier = tout ? null : path.join(racine, dossierUnites(), slug) + path.sep;
  for (const [cle, panneau] of Array.from(panneauxTable.entries())) {
    if (!tout && String(cle).indexOf(dossier) !== 0) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    panneauxTable.delete(cle);
  }
}

// Le tableau que vise un bouton de constat (lib/constats.js, lieu « table ») : il arrive
// en { slug, focus }, focus nommant le fichier (table-02.html) — ou rien, quand veraPDF n'a
// dit que des numéros de page. Le seul tableau de l'article s'ouvre alors directement ;
// plusieurs, on demande lequel ; aucun, l'article s'ouvre à la place, où le rédacteur voit
// au moins de quoi il retourne. -> un item { cheminAsset, slug } ou null.
async function tableDuConstat(fournisseur, item) {
  const slug = String((item && item.slug) || '');
  if (slug === '' || !new Set(fournisseur.listerArticles()).has(slug)) { return null; }
  const tables = fournisseur._tablesArticle(slug);
  const dossier = path.join(fournisseur.racine, dossierUnites(), slug, 'tables');
  // « table-02.html|portrait.jpeg » : le tableau, puis l'image qu'il faut y décrire
  // (constatsPourControles). L'éditeur lit item.focusImage pour amener cette image à
  // l'écran ; sans elle, il s'ouvre comme d'habitude.
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

// `item.focusImage` (facultatif) : le NOM DE FICHIER d'une image de cellule
// (« origf-massie-fig-01.jpeg », un chemin est ramené à son nom). L'éditeur sélectionne la
// cellule qui la contient, l'amène à l'écran et, si l'image n'a ni texte alternatif ni rôle
// décoratif, ouvre aussitôt sa saisie (media/table-editor.js, focaliserImage).
async function ouvrirEditeurTable(fournisseur, item) {
  if (!fournisseur.racine || !item) { return; }
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
  // L'article que l'enregistrement recompile : celui du dossier qui contient le tableau
  // (<unités>/<slug>/tables/), jamais l'aperçu courant, qui peut montrer un autre article.
  const slugCompile = (() => {
    const s = item.slug ? String(item.slug) : path.basename(dossierArticle);
    return new Set(fournisseur.listerArticles()).has(s) ? s : null;
  })();
  // L'éditeur a besoin de largeur ; « Voir dans l'aperçu » le rouvre à la demande.
  await fermerTousLesApercus();
  // Les gestionnaires ne sont appelés qu'une fois cette fonction finie : ils peuvent lire
  // les fonctions déclarées plus bas. panneauxTable reste la garde, lue ailleurs dans ce fichier.
  let focusEnAttente = focusImage;   // servi au premier chargement seulement
  const { panneau, nouveau } = panneauUnique({
    viewType: 'szhEditeurTable', cle: chemin, titre: T('table.titre', [nom]), garde: panneauxTable,
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    retenir: true,
    // Mode « Trad » : l'état du mode, et le clic détourné — voir repondreModeTrad.
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlEditeurTable,
    surPret: () => traiterPret(),
    surMessage: (msg) => traiterMessage(msg),
    surFermeture: (p) => {
      ctx.libererCoedition(p);
      // Un enregistrement encore sous l'anti-rebond part à la fermeture, sans attendre.
      if (slugCompile) { ctx.viderCompilation(slugCompile); }
    }
  });
  if (!nouveau) {
    ctx.annoncerMain(panneau, fournisseur.racine, chemin);
    if (focusImage) { panneau.webview.postMessage({ type: MSG.FOCALISER, focusImage: focusImage }); }
    return;
  }
  const charger = () => {
    let html = '';
    try { html = fs.readFileSync(chemin, 'utf8'); } catch (e) { html = '<table><tr><td></td></tr></table>'; }
    ctx.noterLectureCoedition(panneau, fournisseur.racine, chemin);
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
  // « Insérer une image… » / « Remplacer l'image… » : le sélecteur de fichier, puis la copie
  // dans media/ (nom libre, conversion CMJN — comme fmtFigure). La réponse ne porte que le
  // src et son aperçu : l'opération part de la webview, pour entrer dans son historique.
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
  // -> null quand le tableau est écrit, sinon { code, message } : le bail de co-édition
  //    tenu par un autre poste, une saisie périmée, ou l'échec de l'écriture elle-même.
  // Un tableau écrit à l'identique (l'enregistrement automatique repart à chaque sortie de
  // champ) ne recompile rien : seul un fichier qui a changé relance la compilation.
  const enregistrer = (modele, auto) => {
    let change = false;
    const refus = ctx.ecrireSousMain(panneau, fournisseur.racine, chemin, () => {
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
    ctx.annoncerMain(panneau, fournisseur.racine, chemin);
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
      // Cherche dans le .md la ligne de la référence ::: {.szh-tabelle src="…"}. Le
      // tableau inclus étant un bloc HTML brut, sans position source, la webview peut
      // n'avoir rien à surligner.
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

// Le panneau de l'éditeur ouvert sur ce fichier, ou undefined : l'hôte ferme celui d'un
// tableau qu'il supprime.
function panneauTableOuvert(chemin) { return panneauxTable.get(chemin); }

module.exports = {
  configurer, ouvrirEditeurTable, tableDuConstat, fermerPanneauxTableDe, panneauTableOuvert,
  lireTeintesAccent, textesTable, htmlEditeurTable
};
