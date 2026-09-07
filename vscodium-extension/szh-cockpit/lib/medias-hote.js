// Gestionnaire des médias d'un article : un formulaire pour ses images et les portraits de
// ses auteur·e·s. Légende, alt et crédits vivent dans le texte, réécrits via
// lib/references.js et WorkspaceEdit ; les portraits ne sont que remplacés, jamais mis en figure.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { refuserSiVerrouille } = require('./cycle-vie');
const { fermerTousLesApercus } = require('./apercu');
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

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois, à la fin d'extension.js. Les valeurs par défaut ne servent qu'à ne
// pas planter un test qui require ce module seul.
let ctx = {
  focaliserUnite: () => {},
  slugDepuisChemin: () => null,
  ouvrirArticle: async () => {},
  lireCouleurAccent: () => '',
  envoyerAuteursConnus: () => {},
  textesAuteur: () => ({}),
  limitesMedias: () => ({}),
  nettoyerCarte: (brut) => brut,
  signalerFichesPerimees: () => {},
  remplacerFichierImage: async () => ({ etat: 'erreur', message: 'lib/medias-hote.js non configuré' }),
  supprimerAsset: async () => false,
  deposerPhotoAuteur: async () => {},
  ouvrirVersionsPhoto: () => {},
  choisirPhotoAuteur: () => {},
  convertirCmykSiBesoin: async () => 0
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le dossier des unités de texte du profil actif — même calcul que dossierUnites() dans
// extension.js, mais tiré directement de session.profilOuvrage() : ce module n'a pas à le
// recevoir en rappel, lib/profil.js suffit (comme lib/apercu.js et lib/import-hote.js).
function dossierUnites() {
  return (session.profilOuvrage() || profils.profilPour('revue')).unites.dossier;
}

function cheminMeta(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.meta.yaml');
}

function dossierPortraitsArticle(racine, slug) {
  return path.join(racine, dossierUnites(), slug, 'portraits');
}

// Réglage szh.reduireWarningsImpression : lu ici comme dans extension.js (repli prudent,
// warnings complets, si la configuration ne répond pas).
function reduireWarningsImpressionActif() {
  try { return vscode.workspace.getConfiguration('szh').get('reduireWarningsImpression', false) === true; }
  catch (e) { return false; }
}

// postMessage tolérant : le panneau peut être fermé pendant le traitement WSL.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
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
    etatBasse: T('medias.etat.basse'), etatMuette: T('medias.etat.muette'),
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
  }, ctx.textesAuteur());
}

function htmlMedias(nonce) {
  return construireHtml('medias-article', nonce, {
    cssPartage: ['_design.css', '_auteurs.css'], jsPartage: ['_messages.js', '_auteurs.js'],
    titre: T('medias.titre', ['']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Un descripteur par image de media/, dans l'ordre du texte puis, pour celles qui n'y
// sont pas, dans l'ordre alphabétique de l'arbre.
function listerMediasArticle(fournisseur, slug, texteMd, budget) {
  const base = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
  const ordre = ordreImages(texteMd);
  // Le formulaire ne montre que les valeurs de la première insertion ; l'export, lui, juge
  // toutes les insertions. Sans ce report, une image insérée deux fois dont la seconde n'a
  // ni alternative ni légende passait pour saine au formulaire et rouge à l'export.
  const sansAlternative = new Set(
    imagesSansAlternative(texteMd).map((i) => i.relatif).filter(Boolean));
  // Les grilles du texte, une entrée par bloc « ::: {.szh-grille} », numérotées dans
  // l'ordre du document : la carte de chaque image y lit celle à laquelle elle appartient,
  // le rang qu'elle y tient, et de qui elle est voisine.
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
      // Le rapport largeur/hauteur sert au menu de disposition, qui montre ce que le mode
      // automatique choisirait. Le rendu, lui, remesure les fichiers (szh-grille.lua) :
      // ceci n'est qu'un aperçu, jamais la source de la mise en page.
      largeur: dims ? dims.largeur : null,
      hauteur: dims ? dims.hauteur : null,
      grille: place ? place.grille : null,
      rangGrille: place ? place.rang : -1,
      qualite: qualiteImage('figure', dims, relatif,
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

// Les dispositions offertes, par nombre d'images. La table vit dans lib/references.js,
// avec le mode automatique et l'écriture ; le formulaire n'en garde que le menu.
function dispositionsParCompte() {
  const res = {};
  for (let n = 2; n <= GRILLE_MAX; n++) { res[n] = dispositionsPossibles(n); }
  return res;
}

// Les grilles du texte, dans l'ordre du document — le même que celui dont
// listerMediasArticle tire l'indice porté par chaque carte. Les noms de fichiers sont
// rendus dans la casse du disque : le .md est lu en minuscules, les cartes ne le sont pas,
// et le formulaire retrouve ses voisines par ce nom-là.
function listerGrillesArticle(fournisseur, slug, texteMd) {
  const base = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
  const parMinuscule = new Map();
  for (const r of fournisseur._imagesArticle(slug)) { parMinuscule.set(r.toLowerCase(), r); }
  return lireGrilles(texteMd).map((g) => {
    const membres = g.membres.map((m) => (m.relatif && parMinuscule.get(m.relatif)) || m.cible);
    // Ce que « Automatique » choisirait, pour que le menu le nomme : un mode dont on ne
    // voit pas le résultat ne se choisit pas de confiance. Le rendu remesure les fichiers
    // (szh-grille.lua) et retombe sur la même valeur, la règle étant la même.
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

// Un fichier déposé sur la zone « ajouter une image à côté » : il entre dans media/ sous
// un nom neuf — rien n'est écrasé, c'est toute la différence avec « remplacer » — puis il
// rejoint la figure de `ancre`. La confirmation offre les deux issues opposées : à côté, ou
// bien écraser après tout. -> { etat: 'ok' | 'annule' | 'erreur' | 'remplacer', message, nom }
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
  // Grille pleine : on le dit avant d'écrire le fichier, sinon media/ gagnerait une image
  // que rien n'insère et que personne n'a demandée.
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
    // Temporaire « ~$… » puis rename, comme le remplacement : une écriture interrompue ne
    // laisse pas un demi-fichier que la compilation lirait.
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
  await ctx.convertirCmykSiBesoin([cible]);       // un JPEG d'imprimerie ne s'affiche pas
  return { etat: 'ok', nom: nomLibre };
}

// La fiche d'auteur·e, éditée dans la modale partagée (media/_auteurs.js) : écrite tout de
// suite, l'index désignant un rang existant — créer quelqu'un passe par la carte de
// l'article, qui écrit sa liste entière.
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
  const propre = ctx.nettoyerCarte({ author: [brut] }).author[0];
  if (!propre || (propre.prenom === '' && propre.nom === '')) { return null; }
  meta.author[rang] = propre;
  try { ecrireAtomique(chemin, serialiserMeta(meta)); } catch (e) { return null; }
  return propre;
}

let panneauxMedias = new Map();   // slug -> WebviewPanel (un gestionnaire par article)

// Rappel donné à lib/cycle-vie.js (fermerFormulairesEcriture).
function fermerPanneauxMediasDe(racine, slug) {
  const tout = !racine || !slug;
  for (const [cle, panneau] of Array.from(panneauxMedias.entries())) {
    if (!tout && cle !== slug) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    panneauxMedias.delete(cle);
  }
}

async function ouvrirGestionMedias(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine) { return; }
  const racine = fournisseur.racine;
  // Même cascade que le formulaire des fiches : l'item de l'arbre, l'éditeur actif, puis
  // l'aperçu courant — et un message quand il n'y a vraiment pas d'article en vue.
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
  ctx.focaliserUnite(fournisseur, slug);   // le focus suit le clic, aperçu fermé plus bas
  // Mis à jour à chaque ouverture : le gestionnaire d'un panneau déjà ouvert le lit.
  let focus = String((item && item.focus) || '');
  const md = path.join(racine, dossierUnites(), slug, slug + '.md');
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
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
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
  // `extra` porte le jeton de la course pret/charger : `{ requete }` en réponse
  // à « pret », jamais consulté ailleurs — un rechargement déclenché par un geste (grille,
  // insertion…) répond directement à ce geste, hors de toute course avec « pret ».
  async function charger(cible, extra) {
    const texteMd = await texteArticle();
    const budget = { reste: BUDGET_APERCUS_MEDIA };
    repondrePanneau(cible, Object.assign({
      type: 'charger', slug: slug,
      medias: listerMediasArticle(fournisseur, slug, texteMd, budget),
      grilles: listerGrillesArticle(fournisseur, slug, texteMd),
      grilleMax: GRILLE_MAX, grilleAuto: GRILLE_AUTO,
      dispositions: dispositionsParCompte(),
      portraits: listerPortraitsArticle(fournisseur, slug, budget),
      focus: focus, accent: ctx.lireCouleurAccent(fournisseur.racine), i18n: textesMedias(),
      // Plafond des images et des photos : plus de littéral côté webview (medias-article.js).
      limites: ctx.limitesMedias()
    }, extra || {}));
    ctx.envoyerAuteursConnus(cible, fournisseur.racine);
  }

  // Réécrit le .md entier, par WorkspaceEdit puis doc.save() : annulable d'un Ctrl+Z, et
  // l'enregistrement déclenche la recompilation. Rend faux après avoir posté l'erreur.
  // Partagé par les gestes de grille, qui remanient tous le texte d'un bloc.
  const ecrireTexteArticle = async (texte) => {
    let doc;
    try { doc = await vscode.workspace.openTextDocument(md); }
    catch (e) { repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [e.message]) }); return false; }
    if (doc.getText() === texte) { return true; }   // déjà à jour : pas d'édition
    try {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), texte);
      if (!(await vscode.workspace.applyEdit(edition))) {
        repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [md]) });
        return false;
      }
      await doc.save();
    } catch (e) {
      repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [e.message]) });
      return false;
    }
    return true;
  };

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
    if (msg.type === MSG.PRET) { await charger(panneau, { requete: msg.requete }); return; }
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + T('medias.titre', [slug]);
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const n = await enregistrer(msg.medias);
      // En échec, `enregistrer` a déjà posté « erreur », qui lève aussi le verrou
      // « écriture en vol » : poster « enregistre » par-dessus effacerait l'avertissement
      // et déclarerait propres des cartes dont rien n'a été écrit.
      if (n < 0) { return; }
      repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto });
      if (n > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('medias.statut.enregistrees', [n]), 5000); }
      return;
    }
    // Les deux dépôts de fichier de la carte, et ils se renvoient l'un à l'autre : chaque
    // dialogue offre l'issue de son voisin, parce que l'erreur qu'on veut rattraper est
    // toujours la même — le fichier lâché sur la mauvaise des deux zones. « Remplacer »
    // écrase et ne se défait pas ; « à côté » n'écrase rien. Le passage d'un geste à
    // l'autre se fait sans redemander le fichier, qui est déjà là.
    if (msg.type === MSG.REMPLACER || msg.type === MSG.AJOUTER_A_COTE) {
      // La garde de cmdEcriture ne couvre que l'ouverture : ces gestes écrivent par fs,
      // hors du système de fichiers de l'éditeur, et un panneau resté ouvert survit au
      // verrouillage du numéro.
      const relatif = String(msg.relatif || '');
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: 'media-annulee', relatif: relatif });
        return;
      }
      if (!relatifImageValide(relatif)) {
        repondrePanneau(panneau, { type: 'media-annulee', relatif: relatif });
        return;
      }
      let source = await texteArticle();
      // Combien d'images la figure de cette carte porte déjà : le dialogue « à côté » le
      // demande pour refuser une septième avant d'écrire quoi que ce soit sur le disque.
      const dansGrille = () => {
        const g = grilleDeImage(source, relatif);
        return g ? g.grille.membres.length : 1;
      };
      let geste = msg.type;
      // Deux tours au plus : chaque dialogue peut renvoyer vers l'autre, jamais en boucle.
      for (let tour = 0; tour < 2; tour++) {
        if (geste === MSG.REMPLACER) {
          const res = await ctx.remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif,
            msg.nomFichier, msg.donneesBase64, { offrirACote: true });
          if (res.etat === 'a-cote') { geste = MSG.AJOUTER_A_COTE; continue; }
          if (res.etat === 'annule') { repondrePanneau(panneau, { type: 'media-annulee', relatif: relatif }); return; }
          if (res.etat === 'erreur') {
            repondrePanneau(panneau, { type: 'media-erreur', relatif: relatif, message: res.message });
            return;
          }
          const chemin = path.join(racine, dossierUnites(), slug, 'media', relatif);
          repondrePanneau(panneau, {
            type: 'media-remplace', relatif: relatif, description: decrireImage(chemin),
            apercu: apercuMedia(chemin, { reste: BUDGET_APERCUS_MEDIA }),
            qualite: qualiteImage('figure', lireDimensionsImage(chemin), relatif,
              { reduit: reduireWarningsImpressionActif() })
          });
          return;
        }
        // Ajouter à côté : le fichier entre dans media/ sous un nom neuf, puis la figure
        // se construit autour de l'ancre. Le fichier d'abord, parce que c'est lui qui
        // fixe le nom que la référence doit citer — mais tout échec après lui le reprend :
        // une image dans media/ que rien n'insère est un déchet muet, et le rédacteur
        // n'aurait aucune raison de la chercher.
        const res = await ajouterImageACote(fournisseur, slug, relatif,
          msg.nomFichier, msg.donneesBase64, dansGrille());
        if (res.etat === 'remplacer') { geste = MSG.REMPLACER; continue; }
        if (res.etat === 'annule') { repondrePanneau(panneau, { type: 'media-annulee', relatif: relatif }); return; }
        if (res.etat === 'erreur') {
          repondrePanneau(panneau, { type: 'media-erreur', relatif: relatif, message: res.message });
          return;
        }
        const reprendreFichier = () => {
          try { fs.unlinkSync(path.join(racine, dossierUnites(), slug, 'media', res.nom)); }
          catch (e) { /* déjà parti, ou tenu par un autre programme */ }
        };
        // Les saisies en cours d'abord : la pose réécrit le .md, et le formulaire est
        // rechargé juste après.
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
            type: 'media-erreur', relatif: relatif,
            message: messages[pose.motif] || T('medias.err.grille.ancre', [relatif])
          });
          return;
        }
        if (!(await ecrireTexteArticle(pose.texte))) { reprendreFichier(); return; }
        vscode.window.setStatusBarMessage(
          T('medias.statut.grille.deposee', [res.nom, relatif]), 6000);
        if (rafraichirTout) { rafraichirTout(); }
        focus = res.nom;                             // la carte de l'image qui arrive
        await charger(panneau);
        return;
      }
      return;
    }
    if (msg.type === MSG.INSERER) {
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
    // Les trois gestes de grille. Chacun réécrit le .md par une fonction pure de
    // lib/references.js, puis recharge le formulaire : les grilles changent l'ordre et le
    // verrouillage des cartes, et rejouer le calcul dans la webview le referait mal.
    // Les saisies en cours partent d'abord, comme pour « insérer » : la réécriture les
    // écraserait sans cela.
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
          // Chaque refus a sa cause, et chacune se répare autrement : la nommer, sinon le
          // bouton semble ne rien faire.
          const messages = {
            ancre: T('medias.err.grille.ancre', [relatif]),
            ajout: T('medias.err.grille.ajout', [ajout]),
            pleine: T('medias.grille.ajouter.pleine')
          };
          const dit = messages[resultat.motif];
          if (dit) { repondrePanneau(panneau, { type: 'erreur', message: dit }); }
          return;
        }
        annonce = resultat.legendePerdue
          ? T('medias.statut.grille.legende', [ajout])
          : T('medias.statut.grille.ajoutee', [ajout, relatif]);
      } else if (msg.type === MSG.GRILLE_RETIRER) {
        // Deux sorties, et elles ne disent pas la même chose. « Sortir de la grille » rend
        // à l'image sa place de figure indépendante ; « Retirer de la figure » l'ôte aussi
        // du texte, le fichier restant dans l'article. Dans les deux cas, ni l'image
        // voisine ni la figure ne sont touchées.
        const garder = msg.garder !== false;
        resultat = retirerDeGrille(source, relatif, { garderDansTexte: garder });
        annonce = garder ? T('medias.statut.grille.retiree', [relatif])
                         : T('medias.statut.grille.otee', [relatif]);
      } else {
        resultat = ecrireDispositionGrille(source, relatif, String(msg.disposition || ''));
      }
      if (!resultat.ok) { return; }                 // grille disparue entre-temps : silence
      if (!(await ecrireTexteArticle(resultat.texte))) { return; }
      if (annonce) { vscode.window.setStatusBarMessage(annonce, 6000); }
      if (rafraichirTout) { rafraichirTout(); }
      focus = relatif;                               // la carte d'où le geste est parti
      await charger(panneau);
      return;
    }
    if (msg.type === MSG.RETIRER) {
      if (refuserSiVerrouille()) { return; }
      const relatif = String(msg.relatif || '');
      if (!relatifImageValide(relatif)) { return; }
      // Une image de grille emporte le bloc avec elle : supprimerAsset le normalise
      // (membres, disposition), et le formulaire ne saurait pas rejouer ce calcul. Il
      // repart donc du disque — mais les saisies en cours doivent partir avant, comme
      // pour les autres gestes de grille, sinon le rechargement les écraserait.
      const source = await texteArticle();
      const dansGrille = !!grilleDeImage(source, relatif);
      if (dansGrille && Array.isArray(msg.medias) && msg.medias.length > 0
          && await enregistrer(msg.medias) < 0) { return; }
      const cheminAsset = path.join(racine, dossierUnites(), slug, 'media', relatif);
      const retire = await ctx.supprimerAsset(fournisseur, rafraichirTout,
        { slug: slug, cheminAsset: cheminAsset }, false);
      if (!retire) { return; }
      if (dansGrille) { focus = ''; await charger(panneau); return; }
      repondrePanneau(panneau, { type: 'media-retire', relatif: relatif });
      return;
    }
    // La fiche d'auteur·e, éditée dans la modale partagée : écrite tout de suite, puis
    // l'état du portrait est relu sur le disque — la photo a pu changer de version.
    if (msg.type === MSG.AUTEUR_ENREGISTRER) {
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
      ctx.signalerFichesPerimees();                 // le formulaire des fiches, s'il est ouvert
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
    if (msg.type === MSG.PHOTO_DEPOSER) { await ctx.deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_OUVRIR) { ctx.ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_CHOISIR) { ctx.choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.RETOUR_ARTICLE) {
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
      await ctx.ouvrirArticle(fournisseur, slug);
      panneau.dispose();
      return;
    }
    console.warn('médias : type de message inconnu', msg.type);
  });
  panneau.webview.html = htmlMedias(crypto.randomBytes(16).toString('hex'));
}

module.exports = {
  configurer,
  ouvrirGestionMedias, fermerPanneauxMediasDe,
  listerMediasArticle, listerGrillesArticle, listerPortraitsArticle
};
