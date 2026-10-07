// Gestionnaire des médias d'un article : un formulaire pour ses images et pour les
// portraits de ses auteur·e·s. Légende, alt et crédits des images sont écrits dans le .md
// (lib/references.js, par WorkspaceEdit). Les portraits peuvent seulement être remplacés.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { panneauUnique, revelerPanneau, fermerPanneaux } = require('./webviews/panneau');
const { refuserSiVerrouille } = require('./cycle-vie');
const { fermerTousLesApercus } = require('./apercu');
const { confirmerAbandon } = require('./interaction');
const {
  ordreImages, imagesSansAlternative, lireGrilles, lireAttributsImage, ecrireAttributsImage,
  placeFigure, envelopperFigure, GRILLE_AUTO, GRILLE_MAX, grilleDeImage,
  dispositionsPossibles, dispositionAutomatique, poserDansGrille, retirerDeGrille,
  ecrireDispositionGrille
} = require('./references');
const { qualiteImage } = require('./qualite-image');
const {
  EXTENSIONS_IMAGE_IMPORT, TAILLE_MAX_IMAGE_IMPORT, lireDimensionsImage, decrireImage,
  formatImage, nomImageAssaini, nomMediaLibre, relatifImageValide, assainirCheminPhoto,
  decomposerPhoto, baseAuteurValide, apercuMedia, BUDGET_APERCUS_MEDIA, empreintesPartagees
} = require('./medias');
const { analyserMeta, serialiserMeta, ecrireAtomique } = require('./yaml');
// Auteur·e·s et photos : mêmes fonctions que le formulaire des fiches.
const {
  envoyerAuteursConnus, textesAuteur, limitesMedias, nettoyerCarte, signalerFichesPerimees,
  deposerPhotoAuteur, ouvrirVersionsPhoto, choisirPhotoAuteur
} = require('./metadonnees-hote');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une fois par extension.js. Les valeurs par défaut permettent de charger le module
// seul dans un test.
let ctx = {
  focaliserUnite: () => {},
  slugDepuisChemin: () => null,
  ouvrirArticle: async () => {},
  lireCouleurAccent: () => '',
  remplacerFichierImage: async () => ({ etat: 'erreur', message: 'lib/medias-hote.js non configuré' }),
  supprimerAsset: async () => false,
  convertirCmykSiBesoin: async () => 0,
  // Mode « Trad » : le clic ouvre le formulaire de suggestion.
  repondreModeTrad: require('./traduction-hote').repondreModeTrad,
  // Relance la compilation de l'article en tâche de fond, après un anti-rebond
  // (relanceDifferee, lib/relance-compilation.js). Appelé seulement après une écriture.
  demanderCompilation: () => {},
  viderCompilation: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function dossierUnites() {
  return profils.courant().unites.dossier;
}

function cheminMeta(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.meta.yaml');
}

function dossierPortraitsArticle(racine, slug) {
  return path.join(racine, dossierUnites(), slug, 'portraits');
}

// Réglage szh.reduireWarningsImpression ; faux (avertissements complets) si la
// configuration ne répond pas.
function reduireWarningsImpressionActif() {
  try { return vscode.workspace.getConfiguration('szh').get('reduireWarningsImpression', false) === true; }
  catch (e) { return false; }
}

// postMessage sans erreur si le panneau a été fermé entre-temps.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

function textesMedias() {
  return Object.assign({
    sectionImages: T('medias.section.images'), sectionPortraits: T('medias.section.portraits'),
    aucuneImage: T('medias.aucune.image'), aucunPortrait: T('medias.aucun.portrait'),
    resume: T('medias.resume'), rienAEcrire: T('medias.rienAEcrire'),
    legende: T('img.legende'), legendeIndice: T('img.legende.indice'),
    legendeProvisoire: T('fmt.figure.legende'),
    roleTitre: T('img.role.titre'),
    roleDecrit: T('img.role.decrit'), roleDeco: T('img.role.deco'),
    alt: T('img.alt'), altIndice: T('img.alt.indice'),
    copyright: T('img.copyright'), copyrightIndice: T('img.copyright.indice'),
    source: T('img.source'), sourceIndice: T('img.source.indice'),
    note: T('img.note'), noteIndice: T('img.note.indice'),
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
    etatBasse: T('medias.etat.basse'), etatMuette: T('medias.etat.muette'),
    alerteDescription: T('medias.alerte.description'),
    formOuvrir: T('medias.form.ouvrir'), formFermer: T('medias.form.fermer'),
    apercuAbsent: T('img.apercu.absent'), portraitOrphelin: T('medias.portrait.orphelin'),
    auteurEnregistre: T('medias.auteur.enregistre'),
    grilleSection: T('medias.grille.section'), grilleAjouter: T('medias.grille.ajouter'),
    grilleAjouterTip: T('medias.grille.ajouter.tip'),
    grilleHorsTexte: T('medias.grille.ajouter.horstexte'),
    grillePleine: T('medias.grille.ajouter.pleine'),
    grilleAucune: T('medias.grille.ajouter.aucune'),
    grilleChoisir: T('medias.grille.choisir'), grilleValider: T('medias.grille.valider'),
    grilleAnnuler: T('medias.grille.annuler'),
    grilleCandidateJamais: T('medias.grille.candidate.jamais'),
    grilleCandidateDeplacee: T('medias.grille.candidate.deplacee'),
    grilleDisposition: T('medias.grille.disposition'),
    grilleDispositionTip: T('medias.grille.disposition.tip'),
    grilleMembres: T('medias.grille.membres'), grilleRetirer: T('medias.grille.retirer'),
    grilleRetirerTip: T('medias.grille.retirer.tip'),
    grilleOter: T('medias.grille.oter'), grilleOterTip: T('medias.grille.oter.tip'),
    grilleDeposer: T('medias.grille.deposer'), grilleDeposerTip: T('medias.grille.deposer.tip'),
    grilleDeposerArticle: T('medias.grille.deposer.article'),
    grilleLegende: T('medias.grille.legende'),
    grilleLegendeAbsente: T('medias.grille.legende.absente'),
    dispositionAuto: T('medias.disposition.auto'),
    dispositionAutoSimple: T('medias.disposition.auto.simple'),
    dispositionLigne: T('medias.disposition.ligne'),
    dispositionPile: T('medias.disposition.pile'),
    dispositionTableau: T('medias.disposition.tableau'),
    dispositionRangees: T('medias.disposition.rangees')
  }, textesAuteur());
}

function htmlMedias(nonce) {
  return construireHtml('medias-article', nonce, {
    cssPartage: ['_design.css', '_auteurs.css'], jsPartage: ['_messages.js', '_auteurs.js'],
    titre: T('medias.titre', ['']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Un descripteur par image de media/, dans l'ordre du texte, puis par ordre alphabétique
// pour celles que le texte n'insère pas.
function listerMediasArticle(fournisseur, slug, texteMd, budget) {
  const base = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
  const ordre = ordreImages(texteMd);
  // Le formulaire montre les valeurs de la première insertion, mais l'alerte « sans
  // alternative » porte sur toutes, comme à l'export.
  const sansAlternative = new Set(
    imagesSansAlternative(texteMd).map((i) => i.relatif).filter(Boolean));
  // Une entrée par bloc « ::: {.szh-grille} », dans l'ordre du document : chaque carte y
  // trouve sa grille et son rang.
  const grilles = lireGrilles(texteMd);
  const parImage = new Map();
  grilles.forEach((g, index) => {
    g.membres.forEach((m, rang) => {
      if (m.relatif) { parImage.set(m.relatif, { grille: index, rang: rang }); }
    });
  });
  const relatifs = fournisseur._imagesArticle(slug);
  const empreintes = empreintesPartagees(base, relatifs);
  const liste = relatifs.map((relatif) => {
    const chemin = path.join(base, relatif);
    const v = lireAttributsImage(texteMd, relatif);
    const dims = lireDimensionsImage(chemin);
    const place = parImage.get(relatif.toLowerCase()) || null;
    return {
      relatif: relatif,
      description: decrireImage(chemin),
      apercu: apercuMedia(chemin, budget),
      occurrences: v.n,
      sansAlternative: sansAlternative.has(relatif.toLowerCase()),
      // Pour le menu de disposition seulement : le rendu remesure les fichiers
      // (szh-grille.lua).
      largeur: dims ? dims.largeur : null,
      hauteur: dims ? dims.hauteur : null,
      grille: place ? place.grille : null,
      rangGrille: place ? place.rang : -1,
      qualite: qualiteImage('figure', dims, relatif,
        { reduit: reduireWarningsImpressionActif() }),
      valeurs: {
        legende: v.legende, alt: v.alt, altDefini: v.altDefini,
        copyright: v.copyright, source: v.source, note: v.note, horsFigure: v.horsFigure
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

// Les dispositions possibles, par nombre d'images (table de lib/references.js).
function dispositionsParCompte() {
  const res = {};
  for (let n = 2; n <= GRILLE_MAX; n++) { res[n] = dispositionsPossibles(n); }
  return res;
}

// Les grilles du texte, dans l'ordre du document (le même que l'indice des cartes de
// listerMediasArticle). Les noms sont rendus dans la casse du disque, car lireGrilles les
// rend en minuscules et le formulaire retrouve les cartes par leur nom exact.
function listerGrillesArticle(fournisseur, slug, texteMd) {
  const base = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
  const parMinuscule = new Map();
  for (const r of fournisseur._imagesArticle(slug)) { parMinuscule.set(r.toLowerCase(), r); }
  return lireGrilles(texteMd).map((g) => {
    const membres = g.membres.map((m) => (m.relatif && parMinuscule.get(m.relatif)) || m.cible);
    // Ce que « Automatique » choisirait, affiché dans le menu. szh-grille.lua applique la
    // même règle au rendu.
    const ratios = membres.map((nom) => {
      const dims = lireDimensionsImage(path.join(base, nom));
      return dims && dims.hauteur > 0 ? dims.largeur / dims.hauteur : null;
    });
    return {
      disposition: g.disposition,
      auto: dispositionAutomatique(membres.length, ratios),
      membres: membres
    };
  });
}

// Un descripteur par portrait, c'est-à-dire par base : <base>.original.<ext> et ses deux
// dérivés forment une seule photo. La qualité se juge sur l'original ; l'aperçu montre la
// version que la fiche utilise.
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
  // Auteur·e rattaché·e et version retenue, d'après le champ `photo` du meta.yaml. Le rang
  // dans meta.author sert à éditer la fiche, qui se désigne par { slug, index }.
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
    // Version montrée : celle que la fiche désigne, sinon sans-fond, avec-fond, original.
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
      // Les versions disponibles ne sont pas envoyées : la modale de la fiche les demande
      // par photo-ouvrir.
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

// Insère dans le texte une image qui n'y figure pas (sa carte est verrouillée tant qu'elle
// n'a pas de place pour sa légende). placeFigure (lib/references.js) choisit le curseur,
// ou la fin de l'article si le curseur est à un endroit où l'image ne serait pas une
// figure. -> { ok, auCurseur }.
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

// Fichier déposé sur la zone « ajouter une image à côté » : il entre dans media/ sous un
// nom libre (rien n'est écrasé), pour rejoindre ensuite la figure de `ancre`. La
// confirmation propose aussi de remplacer l'image à la place.
// -> { etat: 'ok' | 'annule' | 'erreur' | 'remplacer', message, nom }
async function ajouterImageACote(fournisseur, slug, ancre, nomFichier, donneesBase64, dejaDansGrille) {
  const echec = (message) => ({ etat: 'erreur', message: message });
  if (!fournisseur.racine) { return echec(T('err.copie', ['?', '?'])); }
  if (!new Set(fournisseur.listerArticles()).has(String(slug || ''))) { return { etat: 'annule' }; }
  if (!relatifImageValide(ancre)) { return { etat: 'annule' }; }
  if (session.buildEnCours() || session.importEnCours()) { return echec(T('statut.occupe')); }
  const nom = nomImageAssaini(nomFichier);
  if (!nom) { return echec(T('importv.err.format')); }
  const donnees = Buffer.from(String(donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { return echec(T('importv.err.format')); }
  if (donnees.length > TAILLE_MAX_IMAGE_IMPORT) { return echec(T('importv.err.tropvolumineux')); }
  // Grille pleine : refus avant d'écrire, pour ne pas laisser dans media/ une image que
  // rien n'insère.
  if (Number(dejaDansGrille) >= GRILLE_MAX) {
    return echec(T('modale.acote.detail.pleine'));
  }
  const dossier = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
  try { fs.mkdirSync(dossier, { recursive: true }); } catch (e) { /* existe déjà */ }
  const nomLibre = nomMediaLibre(dossier, nom);
  const reponse = await vscode.window.showWarningMessage(
    T('modale.acote.question', [path.basename(ancre), nomLibre]),
    { modal: true, detail: T('modale.acote.detail', [path.basename(ancre), nomLibre]) },
    T('modale.acote.bouton'), T('modale.remplacer.bouton')
  );
  if (reponse === T('modale.remplacer.bouton')) { return { etat: 'remplacer' }; }
  if (reponse !== T('modale.acote.bouton')) { return { etat: 'annule' }; }
  const cible = path.join(dossier, nomLibre);
  try {
    // Fichier temporaire « ~$… » puis renommage : une écriture interrompue ne laisse pas
    // un fichier partiel que la compilation lirait.
    const tmp = path.join(dossier, '~$' + nomLibre);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
  } catch (e) {
    return echec(T('err.copie', [nomLibre, e.message]));
  }
  await ctx.convertirCmykSiBesoin([cible]);       // un JPEG CMJN ne s'affiche pas
  return { etat: 'ok', nom: nomLibre };
}

// Écrit la fiche d'auteur·e éditée dans la modale partagée (media/_auteurs.js), au rang
// `index` de meta.author. Rend la fiche nettoyée, ou null.
function ecrireAuteur(fournisseur, slug, index, brut, photoAttendue) {
  if (!fournisseur.racine || !new Set(fournisseur.listerArticles()).has(slug)) { return null; }
  const chemin = cheminMeta(fournisseur.racine, slug);
  let meta;
  let avant;
  try { avant = fs.readFileSync(chemin, 'utf8'); meta = analyserMeta(avant); } catch (e) { return null; }
  if (!Array.isArray(meta.author)) { meta.author = []; }
  const rang = Number(index);
  // Un rang existant seulement : on ajoute une personne par la carte de l'article, qui
  // écrit toute la liste. Sinon, une personne qu'on vient de retirer pourrait revenir.
  if (!Number.isInteger(rang) || rang < 0 || rang >= meta.author.length) { return null; }
  // La photo attendue sert de témoin : si elle diffère, la liste a changé entre-temps.
  const attendue = assainirCheminPhoto(photoAttendue);
  if (attendue !== '') {
    const surPlace = assainirCheminPhoto((meta.author[rang] || {}).photo);
    if (surPlace !== attendue) { return null; }
  }
  // nettoyerCarte borne les longueurs et assainit le chemin de la photo.
  const propre = nettoyerCarte({ author: [brut] }).author[0];
  if (!propre || (propre.prenom === '' && propre.nom === '')) { return null; }
  meta.author[rang] = propre;
  const texte = serialiserMeta(meta);
  try { ecrireAtomique(chemin, texte); } catch (e) { return null; }
  // Le PDF porte le nom, l'affiliation et la photo : recompiler si la fiche a changé.
  if (texte !== avant) { ctx.demanderCompilation(fournisseur, slug); }
  return propre;
}

// Un panneau par article (viewType 'szhMedias', clé : le slug). Utilisé par
// fermerFormulairesEcriture (lib/cycle-vie.js).
function fermerPanneauxMediasDe(racine, slug) {
  fermerPanneaux('szhMedias', (!racine || !slug) ? undefined : slug);
}

// Chemin relatif exact sous media/ (« sous-dossier/Fig-01.png ») de l'image visée par un
// avertissement, qui ne porte parfois que le nom du fichier, en minuscules. Sans
// correspondance, `focus` est rendu tel quel et le formulaire n'ouvre aucune carte.
function relatifDuFocus(fournisseur, slug, focus) {
  if (focus === '' || typeof fournisseur._imagesArticle !== 'function') { return focus; }
  let images = [];
  try { images = fournisseur._imagesArticle(slug) || []; } catch (e) { return focus; }
  if (images.indexOf(focus) !== -1) { return focus; }
  const bas = focus.replace(/\\/g, '/').toLowerCase();
  const nom = bas.slice(bas.lastIndexOf('/') + 1);
  return images.find((r) => r.toLowerCase() === bas)
    || images.find((r) => { const b = r.toLowerCase(); return b.slice(b.lastIndexOf('/') + 1) === nom; })
    || focus;
}

async function ouvrirGestionMedias(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine) { return; }
  const racine = fournisseur.racine;
  // L'article : celui de l'arbre, sinon de l'éditeur actif, sinon de l'aperçu courant
  // (comme le formulaire des fiches).
  let slug = (item && item.slug) ? String(item.slug) : null;
  if (!slug) {
    const ed = vscode.window.activeTextEditor;
    slug = ed ? ctx.slugDepuisChemin(racine, ed.document.uri.fsPath) : null;
  }
  if (!slug) { slug = session.apercuCourantSlug(); }
  if (!slug || !new Set(fournisseur.listerArticles()).has(slug)) {
    vscode.window.setStatusBarMessage(T('fiches.horsarticle'), 4000);
    return;
  }
  ctx.focaliserUnite(fournisseur, slug);
  // Mis à jour à chaque ouverture ; le gestionnaire d'un panneau déjà ouvert le lit.
  let focus = relatifDuFocus(fournisseur, slug, String((item && item.focus) || ''));
  const md = path.join(racine, dossierUnites(), slug, slug + '.md');
  const existant = revelerPanneau({ viewType: 'szhMedias', cle: slug });
  if (existant) {
    // Sans rechargement, qui écraserait les saisies non enregistrées : seule la carte
    // visée est amenée à l'écran.
    if (focus !== '') { repondrePanneau(existant, { type: MSG.FOCALISER, relatif: focus }); }
    return;
  }
  // Sans cela, la webview s'ouvre derrière un PDF.
  await fermerTousLesApercus();
  // Les gestionnaires ne sont appelés qu'après la fin de cette fonction : ils peuvent
  // utiliser les fonctions déclarées plus bas.
  const { panneau } = panneauUnique({
    viewType: 'szhMedias', cle: slug, titre: T('medias.titre', [slug]),
    // La webview garde son état quand elle est masquée.
    retenir: true,
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlMedias,
    surPret: (msg) => charger(panneau, { requete: msg.requete }),
    surMessage: (msg) => traiterMessage(msg),
    // Une recompilation encore sous l'anti-rebond part maintenant.
    surFermeture: () => ctx.viderCompilation(slug)
  });
  // Appelé après toute écriture du .md, de media/ ou de la fiche : recompile l'article en
  // tâche de fond. Un .md enregistré déclenche aussi triggerTaskOnSave ; la relance
  // différée ne compile pas deux fois.
  const compilerArticle = () => ctx.demanderCompilation(fournisseur, slug);

  // openTextDocument lit le tampon, frappes non enregistrées comprises.
  async function texteArticle() {
    try {
      const doc = await vscode.workspace.openTextDocument(md);
      return doc.getText();
    } catch (e) { return ''; }
  }
  // `extra` : `{ requete }` en réponse à « pret », pour que la webview reconnaisse la
  // réponse à sa demande. Un rechargement après une action n'en a pas.
  async function charger(cible, extra) {
    const texteMd = await texteArticle();
    const budget = { reste: BUDGET_APERCUS_MEDIA };
    repondrePanneau(cible, Object.assign({
      type: MSG.CHARGER, slug: slug,
      medias: listerMediasArticle(fournisseur, slug, texteMd, budget),
      grilles: listerGrillesArticle(fournisseur, slug, texteMd),
      grilleMax: GRILLE_MAX, grilleAuto: GRILLE_AUTO,
      dispositions: dispositionsParCompte(),
      portraits: listerPortraitsArticle(fournisseur, slug, budget),
      focus: focus, accent: ctx.lireCouleurAccent(fournisseur.racine), i18n: textesMedias(),
      // Taille maximale des images et des photos, pour medias-article.js.
      limites: limitesMedias()
    }, extra || {}));
    envoyerAuteursConnus(cible, fournisseur.racine);
  }

  // Réécrit le .md entier par WorkspaceEdit puis doc.save(), ce qui reste annulable par
  // Ctrl+Z. Rend faux après avoir signalé l'erreur au panneau.
  const ecrireTexteArticle = async (texte) => {
    let doc;
    try { doc = await vscode.workspace.openTextDocument(md); }
    catch (e) {
      repondrePanneau(panneau,
        { type: MSG.ERREUR, message: T('err.ecriture', [path.basename(md), e.message]) });
      return false;
    }
    if (doc.getText() === texte) { return true; }
    try {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), texte);
      if (!(await vscode.workspace.applyEdit(edition))) {
        repondrePanneau(panneau, { type: MSG.ERREUR, message: T('err.ecriture', [path.basename(md), T('err.edition.refusee')]) });
        return false;
      }
      await doc.save();
    } catch (e) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: T('err.ecriture', [path.basename(md), e.message]) });
      return false;
    }
    compilerArticle();
    return true;
  };

  // Rend le nombre d'insertions réécrites, ou -1 en cas d'échec déjà signalé.
  const enregistrer = async (liste) => {
    let doc;
    try { doc = await vscode.workspace.openTextDocument(md); }
    catch (e) {
      repondrePanneau(panneau,
        { type: MSG.ERREUR, message: T('err.ecriture', [path.basename(md), e.message]) });
      return -1;
    }
    const source = doc.getText();
    let texte = source;
    let total = 0;
    let disparues = 0;
    for (const m of (Array.isArray(liste) ? liste : [])) {
      const relatif = String((m && m.relatif) || '');
      if (!relatifImageValide(relatif)) { continue; }
      const res = ecrireAttributsImage(texte, relatif, (m && m.valeurs) || {});
      if (res.n === 0) { disparues++; continue; }             // retirée du .md entre-temps
      texte = res.texte;
      total += res.n;
    }
    if (disparues > 0) {
      // Signalé, sinon leurs cartes se croiraient enregistrées.
      vscode.window.setStatusBarMessage(T('medias.statut.disparues', [disparues]), 5000);
    }
    if (texte === source) { return total; }
    try {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), texte);
      if (!(await vscode.workspace.applyEdit(edition))) {
        repondrePanneau(panneau, { type: MSG.ERREUR, message: T('err.ecriture', [path.basename(md), T('err.edition.refusee')]) });
        return -1;
      }
      await doc.save();
    } catch (e) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: T('err.ecriture', [path.basename(md), e.message]) });
      return -1;
    }
    compilerArticle();
    return total;
  };

  async function traiterMessage(msg) {
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + T('medias.titre', [slug]);
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const n = await enregistrer(msg.medias);
      // En échec, `enregistrer` a déjà envoyé « erreur » ; envoyer « enregistre » ensuite
      // effacerait l'avertissement et marquerait les cartes comme enregistrées.
      if (n < 0) { return; }
      repondrePanneau(panneau, { type: MSG.ENREGISTRE, auto: !!msg.auto });
      if (n > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('medias.statut.enregistrees', [n]), 5000); }
      return;
    }
    // Les deux zones de dépôt de la carte : « Remplacer » écrase le fichier, « à côté »
    // ajoute une image à la figure. Chaque dialogue propose l'autre action, au cas où le
    // fichier a été déposé sur la mauvaise zone, sans redemander le fichier.
    if (msg.type === MSG.REMPLACER || msg.type === MSG.AJOUTER_A_COTE) {
      // Verrou vérifié ici aussi : ces actions écrivent par fs, et un panneau ouvert reste
      // ouvert quand le numéro est verrouillé.
      const relatif = String(msg.relatif || '');
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: MSG.MEDIA_ANNULEE, relatif: relatif });
        return;
      }
      if (!relatifImageValide(relatif)) {
        repondrePanneau(panneau, { type: MSG.MEDIA_ANNULEE, relatif: relatif });
        return;
      }
      let source = await texteArticle();
      // Nombre d'images de la figure, pour refuser l'ajout à une grille pleine avant
      // d'écrire sur le disque.
      const dansGrille = () => {
        const g = grilleDeImage(source, relatif);
        return g ? g.grille.membres.length : 1;
      };
      let geste = msg.type;
      // Deux tours au plus : chaque dialogue peut renvoyer une fois vers l'autre.
      for (let tour = 0; tour < 2; tour++) {
        if (geste === MSG.REMPLACER) {
          const res = await ctx.remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif,
            msg.nomFichier, msg.donneesBase64, { offrirACote: true });
          if (res.etat === 'a-cote') { geste = MSG.AJOUTER_A_COTE; continue; }
          if (res.etat === 'annule') { repondrePanneau(panneau, { type: MSG.MEDIA_ANNULEE, relatif: relatif }); return; }
          if (res.etat === 'erreur') {
            repondrePanneau(panneau, { type: MSG.MEDIA_ERREUR, relatif: relatif, message: res.message });
            return;
          }
          // Seul le fichier de media/ a changé : aucun enregistrement du .md ne déclenche
          // triggerTaskOnSave.
          compilerArticle();
          const chemin = path.join(racine, dossierUnites(), slug, 'media', relatif);
          repondrePanneau(panneau, {
            type: MSG.MEDIA_REMPLACE, relatif: relatif, description: decrireImage(chemin),
            apercu: apercuMedia(chemin, { reste: BUDGET_APERCUS_MEDIA }),
            qualite: qualiteImage('figure', lireDimensionsImage(chemin), relatif,
              { reduit: reduireWarningsImpressionActif() })
          });
          return;
        }
        // Ajouter à côté : le fichier d'abord, car il fixe le nom que cite la référence,
        // puis la grille autour de l'ancre. Tout échec ensuite supprime le fichier, pour
        // ne pas laisser dans media/ une image que rien n'insère.
        const res = await ajouterImageACote(fournisseur, slug, relatif,
          msg.nomFichier, msg.donneesBase64, dansGrille());
        if (res.etat === 'remplacer') { geste = MSG.REMPLACER; continue; }
        if (res.etat === 'annule') { repondrePanneau(panneau, { type: MSG.MEDIA_ANNULEE, relatif: relatif }); return; }
        if (res.etat === 'erreur') {
          repondrePanneau(panneau, { type: MSG.MEDIA_ERREUR, relatif: relatif, message: res.message });
          return;
        }
        const reprendreFichier = () => {
          try { fs.unlinkSync(path.join(racine, dossierUnites(), slug, 'media', res.nom)); }
          catch (e) { /* déjà parti, ou tenu par un autre programme */ }
        };
        // Les saisies en cours d'abord, car la pose réécrit le .md et le formulaire est
        // rechargé ensuite.
        if (Array.isArray(msg.medias) && msg.medias.length > 0 && await enregistrer(msg.medias) < 0) {
          reprendreFichier();
          return;
        }
        source = await texteArticle();
        const pose = poserDansGrille(source, relatif, res.nom);
        if (!pose.ok) {
          reprendreFichier();
          const messages = {
            ancre: T('medias.err.grille.ancre', [relatif]),
            pleine: T('medias.grille.ajouter.pleine')
          };
          repondrePanneau(panneau, {
            type: MSG.MEDIA_ERREUR, relatif: relatif,
            message: messages[pose.motif] || T('medias.err.grille.ancre', [relatif])
          });
          return;
        }
        if (!(await ecrireTexteArticle(pose.texte))) { reprendreFichier(); return; }
        vscode.window.setStatusBarMessage(
          T('medias.statut.grille.deposee', [res.nom, relatif]), 6000);
        if (rafraichirTout) { rafraichirTout(); }
        focus = res.nom;                             // la carte de l'image ajoutée
        await charger(panneau);
        return;
      }
      return;
    }
    if (msg.type === MSG.INSERER) {
      if (refuserSiVerrouille()) { return; }
      const relatif = String(msg.relatif || '');
      if (!relatifImageValide(relatif)) { return; }
      // Les saisies en cours d'abord, car l'insertion réécrit le .md ; le formulaire est
      // ensuite rechargé pour déverrouiller la carte.
      if (Array.isArray(msg.medias) && msg.medias.length > 0 && await enregistrer(msg.medias) < 0) { return; }
      const pose = await insererImageDansArticle(md, relatif);
      if (!pose.ok) {
        repondrePanneau(panneau, { type: MSG.ERREUR, message: T('err.ecriture', [path.basename(md), T('err.edition.refusee')]) });
        return;
      }
      compilerArticle();
      // Au curseur, ou en fin d'article si le curseur était dans une liste, un tableau, un
      // bloc de code ou un bloc pandoc.
      vscode.window.setStatusBarMessage(
        T(pose.auCurseur ? 'medias.statut.inseree' : 'medias.statut.inseree.fin', [relatif]), 6000);
      if (rafraichirTout) { rafraichirTout(); }
      await charger(panneau);
      return;
    }
    // Les trois actions de grille. Chacune enregistre d'abord les saisies en cours, réécrit
    // le .md par une fonction de lib/references.js, puis recharge le formulaire, car les
    // grilles changent l'ordre et le verrouillage des cartes.
    if (msg.type === MSG.GRILLE_AJOUTER || msg.type === MSG.GRILLE_RETIRER
        || msg.type === MSG.GRILLE_DISPOSITION) {
      if (refuserSiVerrouille()) { return; }
      const relatif = String(msg.relatif || '');
      if (!relatifImageValide(relatif)) { return; }
      if (Array.isArray(msg.medias) && msg.medias.length > 0 && await enregistrer(msg.medias) < 0) { return; }
      const source = await texteArticle();
      let resultat = null;
      let annonce = null;
      if (msg.type === MSG.GRILLE_AJOUTER) {
        const ajout = String(msg.ajout || '');
        if (!relatifImageValide(ajout)) { return; }
        resultat = poserDansGrille(source, relatif, ajout);
        if (!resultat.ok) {
          // Chaque refus est nommé, sinon le bouton semble ne rien faire.
          const messages = {
            ancre: T('medias.err.grille.ancre', [relatif]),
            ajout: T('medias.err.grille.ajout', [ajout]),
            pleine: T('medias.grille.ajouter.pleine')
          };
          const dit = messages[resultat.motif];
          if (dit) { repondrePanneau(panneau, { type: MSG.ERREUR, message: dit }); }
          return;
        }
        annonce = resultat.legendePerdue
          ? T('medias.statut.grille.legende', [ajout])
          : T('medias.statut.grille.ajoutee', [ajout, relatif]);
      } else if (msg.type === MSG.GRILLE_RETIRER) {
        // « Sortir de la grille » fait de l'image une figure indépendante ; « Retirer de la
        // figure » l'ôte aussi du texte, le fichier restant dans media/. Les autres images
        // de la grille restent en place.
        const garder = msg.garder !== false;
        resultat = retirerDeGrille(source, relatif, { garderDansTexte: garder });
        annonce = garder ? T('medias.statut.grille.retiree', [relatif])
                         : T('medias.statut.grille.otee', [relatif]);
      } else {
        resultat = ecrireDispositionGrille(source, relatif, String(msg.disposition || ''));
      }
      if (!resultat.ok) { return; }                 // grille disparue entre-temps
      if (!(await ecrireTexteArticle(resultat.texte))) { return; }
      if (annonce) { vscode.window.setStatusBarMessage(annonce, 6000); }
      if (rafraichirTout) { rafraichirTout(); }
      focus = relatif;
      await charger(panneau);
      return;
    }
    if (msg.type === MSG.RETIRER) {
      if (refuserSiVerrouille()) { return; }
      const relatif = String(msg.relatif || '');
      if (!relatifImageValide(relatif)) { return; }
      // Retirer une image de grille modifie le bloc (membres, disposition) : le formulaire
      // est alors rechargé, après enregistrement des saisies en cours.
      const source = await texteArticle();
      const dansGrille = !!grilleDeImage(source, relatif);
      if (dansGrille && Array.isArray(msg.medias) && msg.medias.length > 0
          && await enregistrer(msg.medias) < 0) { return; }
      const cheminAsset = path.join(racine, dossierUnites(), slug, 'media', relatif);
      const retire = await ctx.supprimerAsset(fournisseur, rafraichirTout,
        { slug: slug, cheminAsset: cheminAsset }, false);
      if (!retire) { return; }
      compilerArticle();
      if (dansGrille) { focus = ''; await charger(panneau); return; }
      repondrePanneau(panneau, { type: MSG.MEDIA_RETIRE, relatif: relatif });
      return;
    }
    // Fiche d'auteur·e écrite tout de suite, puis portrait relu sur le disque : la photo a
    // pu changer de version.
    if (msg.type === MSG.AUTEUR_ENREGISTRER) {
      const index = Number(msg.index);
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: MSG.AUTEUR_ERREUR, slug: slug, index: index, message: T('verrou.refuse') });
        return;
      }
      const propre = ecrireAuteur(fournisseur, slug, index, msg.auteur, msg.photoAttendue);
      if (!propre) {
        repondrePanneau(panneau, { type: MSG.AUTEUR_ERREUR, slug: slug, index: index, message: T('auteur.err.decale') });
        return;
      }
      if (rafraichirTout) { rafraichirTout(); }     // le PDF porte le nom et la photo
      signalerFichesPerimees();                 // au formulaire des fiches, s'il est ouvert
      const budget = { reste: BUDGET_APERCUS_MEDIA };
      const portrait = listerPortraitsArticle(fournisseur, slug, budget)
        .filter((x) => x.index === index)[0] || null;
      repondrePanneau(panneau, {
        type: MSG.AUTEUR_ENREGISTRE, slug: slug, index: index, auteur: propre, portrait: portrait
      });
      return;
    }
    // Photo : les trois messages du composant partagé des auteur·e·s.
    if (msg.type === MSG.PHOTO_DEPOSER) { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_OUVRIR) { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_CHOISIR) { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.RETOUR_ARTICLE) {
      if (msg.modifie) {
        const choix = await confirmerAbandon(T('medias.quitter.question', [slug]));
        if (choix === 'annuler') { return; }
        if (choix === 'enregistrer') {
          const n = await enregistrer(msg.medias);
          if (n < 0) { return; }                      // échec d'écriture : on reste
          if (n > 0) { vscode.window.setStatusBarMessage(T('medias.statut.enregistrees', [n]), 5000); }
        }
      }
      await ctx.ouvrirArticle(fournisseur, slug);
      panneau.dispose();
      return;
    }
    console.warn('médias : type de message inconnu', msg.type);
  }
}

module.exports = {
  configurer,
  ouvrirGestionMedias, fermerPanneauxMediasDe,
  listerMediasArticle, listerGrillesArticle, listerPortraitsArticle
};
