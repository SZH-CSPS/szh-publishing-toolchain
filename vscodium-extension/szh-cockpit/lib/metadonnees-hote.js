// Formulaires de métadonnées : le numéro (ausgabe.yaml), le livre (buch.yaml) et les
// fiches des articles (meta.yaml). Les trois partagent la carte d'auteur·e et la photo.
// Les rappels vers l'hôte passent par configurer().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T, TP, langueCockpit } = require('./i18n');
const { toolkitPoste } = require('./poste');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { panneauUnique, panneauCourant, revelerPanneau } = require('./webviews/panneau');
const { refuserSiVerrouille, poidsLisible } = require('./cycle-vie');
const {
  mainCoedition, ecrireSousMain, annoncerMain, noterLectureCoedition, rafraichirEmpreinteCoedition,
  libererCoedition
} = require('./coedition-hote');
const { fermerTousLesApercus } = require('./apercu');
const { confirmerAbandon } = require('./interaction');
const { slugifier } = require('./slug');
const { traiterPortraits } = require('./portraits');
const { alignerMotsCles } = require('./traduction');
const {
  lireCache: lireCacheAuteursPublies, rafraichir: rafraichirCacheAuteursPublies
} = require('./auteurs-ojs');
const { lireCacheMotsCles, rafraichirMotsCles } = require('./mots-cles-edudoc');
const {
  CLES_METADONNEES, CLES_PERSONNES, CHAMPS_PERSONNE, COULEURS_NUMERO, HEX_COULEURS,
  normaliserRevue, estVraiYaml,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, ecrireAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, langueDefaut, normaliserLangueArticle, titreNumero,
  LICENCE_DEFAUT, LICENCES_ARTICLE, normaliserLicence, etatRevue
} = require('./yaml');
const {
  NOMS_COUVERTURE, EXTENSIONS_COUVERTURE, nomCouverture, MAX_COUVERTURE, rangDoi
} = require('./articles');
const { doiCalcule, FORME_DOI } = require('./export-ojs');
const { ouvrirAvecSysteme } = require('./ouvrir-systeme');
const verifMeta = require('./verif-meta');
const {
  EXTENSIONS_IMAGE_IMPORT, TAILLE_MAX_IMAGE_IMPORT,
  assainirCheminPhoto, decomposerPhoto, baseAuteurValide,
  dataUriImage, trouverOriginal, versionsPhoto
} = require('./medias');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés par extension.js. Ils font ce que ce module ne sait pas faire (relancer une
// compilation, focaliser l'arbre, ouvrir un onglet). Les défauts permettent de charger le
// module seul dans un test.
let ctx = {
  ecrireClesAusgabe: () => 'lib/metadonnees-hote.js non configuré',
  lireCouleurAccent: () => '',
  permuterStatutsTraduction: () => {},
  relancerCompilation: () => {},
  focaliserUnite: () => {},
  // Les onglets de l'éditeur, pour l'interrupteur « Markdown ». Non configuré, le bouton
  // reste éteint.
  ongletOuvert: () => false,
  fermerOnglets: async () => {},
  slugDepuisChemin: () => null,
  articlesSansDoi: () => new Set(),
  // Vérificateur de traduction : le réglage du poste, et le panneau de suggestion ouvert
  // par la pastille d'un champ. Éteint par défaut.
  lireVerifTraduction: () => false,
  ouvrirSuggestionTraduction: () => {},
  // Mode « Trad » : envoie le clic vers le formulaire de suggestion. Par défaut, celui de
  // lib/traduction-hote.js.
  repondreModeTrad: require('./traduction-hote').repondreModeTrad
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le profil du dossier ouvert (lib/profil.js#courant) et ce qui en découle.
function profilCourant() { return profils.courant(); }
function dossierUnites() { return profilCourant().unites.dossier; }
function cleOrdre() { return profilCourant().unites.ordre; }
function cheminConfig(racine) { return path.join(racine, profilCourant().config); }

// postMessage tolérant : le panneau peut être fermé pendant le traitement.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

function cheminMeta(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.meta.yaml');
}

// ---- Couverture du numéro ---------------------------------------------------------
// couverture.jpg à la racine du numéro, sous l'un des noms de NOMS_COUVERTURE.

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

// L'aperçu passe en data: dans le postMessage, car la webview n'a aucune racine locale
// autorisée (localResourceRoots: []). Au-delà de ce poids, seuls le nom et le poids sont
// montrés.
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

// -> null, ou le message de l'échec. Format et poids sont revérifiés ici, la webview
// n'étant pas une source sûre.
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
  } catch (e) { return T('err.ecriture', [nom, String((e && e.message) || e)]); }
  // Une seule couverture par numéro : les autres noms sont retirés, sinon l'export
  // prendrait le premier de sa liste au lieu de celui qu'on vient de déposer.
  for (const autre of NOMS_COUVERTURE) {
    if (autre === nom) { continue; }
    try {
      const c = path.join(racine, autre);
      if (fs.existsSync(c)) { fs.unlinkSync(c); }
    } catch (e) { /* verrouillé : le nom affiché dira lequel l'export voit */ }
  }
  return null;
}

// ---- Formulaire du numéro ---------------------------------------------------------
//
// La page « Méta-données du numéro » et la vue « Articles » montrent le même formulaire
// (SZH.formulaireNumero, media/_numero.js) ; toutes deux lisent et écrivent par ici.
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
    // Formats et poids acceptés, tirés de lib/articles.js. La webview s'en sert pour
    // refuser tout de suite ; l'hôte les revérifie.
    couvertureExtensions: Object.keys(EXTENSIONS_COUVERTURE),
    couvertureMax: MAX_COUVERTURE
  };
}

// `avecCouverture` : l'aperçu de la couverture pèse plusieurs mégaoctets en base64 ; il
// n'est envoyé qu'au premier chargement.
function chargeNumero(racine, avecCouverture) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* fichier illisible : formulaire vide */ }
  // En-tête condensé par défaut : une clé absente d'ausgabe.yaml coche la case, comme
  // szh-maquette.lua l'interprète. Sinon la case montrerait l'inverse de l'état réel, et
  // la toucher écrirait un `entete-condensee: false` que personne n'a voulu.
  valeurs['entete-condensee'] = valeurs['entete-condensee'] === undefined ? 'true'
    : (estVraiYaml(valeurs['entete-condensee']) ? 'true' : 'false');
  const charge = { valeurs: valeurs };
  if (avecCouverture) { charge.couverture = chargeCouverture(racine); }
  return charge;
}

// Seuls les champs modifiés arrivent, si bien qu'une valeur que le formulaire n'a pas su
// afficher n'est pas écrasée. -> null, ou le message de l'échec ; null aussi quand il n'y
// avait rien de recevable à écrire.
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
  // L'ordre des articles ne passe pas par ce formulaire.
  delete modifies[cleOrdre()];
  if (Object.keys(modifies).length === 0) { return null; }
  return ctx.ecrireClesAusgabe(racine, modifies);
}

// Traite les messages du formulaire du numéro pour les deux panneaux qui le portent.
// -> true quand le message a été traité. `recharger` relit le disque, après un refus
// « périmé » de la co-édition.
function messageNumero(panneau, racine, msg, rafraichirTout, recharger) {
  if (msg.type === MSG.ENREGISTRER) {
    if (session.etatNumero().verrouillee) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: T('verrou.refuse') });
      return true;
    }
    const refus = ecrireSousMain(panneau, racine, cheminConfig(racine),
      () => ecrireChampsNumero(racine, msg.modifies));
    if (refus) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: refus.message });
      if (refus.code === 'perime' && recharger) { recharger(); }
      return true;
    }
    repondrePanneau(panneau, { type: MSG.ENREGISTRE });
    vscode.window.setStatusBarMessage(T('statut.ausgabe'), 3000);
    if (rafraichirTout) { rafraichirTout(); }
    return true;
  }
  if (msg.type === MSG.COUVERTURE_DEPOSER) {
    if (refuserSiVerrouille()) { return true; }
    const erreur = ecrireCouverture(racine, String(msg.nomFichier || ''), msg.donneesBase64);
    if (erreur) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: erreur });
      return true;
    }
    repondrePanneau(panneau, Object.assign({ type: MSG.COUVERTURE }, chargeCouverture(racine)));
    vscode.window.setStatusBarMessage(T('art.couverture.enregistree'), 3000);
    return true;
  }
  return false;
}

function htmlMetadonnees(nonce) {
  return construireHtml('metadata-issue', nonce, {
    cssPartage: ['_design.css', '_numero.css'], jsPartage: ['_messages.js', '_numero.js'],
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'",
    titre: T('meta.titre'), remplacements: { '__TXT__': JSON.stringify(textesNumero()) }
  });
}

function envoyerValeursMetadonnees(panneau, racine) {
  repondrePanneau(panneau, Object.assign({ type: MSG.VALEURS }, chargeNumero(racine, true)));
  noterLectureCoedition(panneau, racine, cheminConfig(racine));
}

// ---- Formulaire « Métadonnées du livre » -----------------------------------------
//
// Le pendant du bloc ci-dessus pour buch.yaml (SZH.formulaireLivre, media/_numero.js),
// avec sa propre validation.
//
// Les six dernières clés sont celles du bloc `impression:` de buch.yaml : grammage, main,
// dos imposé, fond perdu, traits de coupe, profil CMJN.
const LIBELLES_LIVRE = ['meta.livre.titre', 'meta.livre.soustitre', 'meta.livre.ouvrage',
  'meta.livre.ouvrage.monographie', 'meta.livre.ouvrage.collectif', 'meta.livre.langue',
  'meta.langue.fr', 'meta.langue.de', 'meta.langue.it', 'meta.langue.en',
  'meta.livre.maquette', 'meta.livre.maquette.normal', 'meta.livre.maquette.falc',
  'meta.livre.format', 'meta.livre.format.standard', 'meta.livre.format.a4',
  'meta.livre.collection', 'meta.livre.tome', 'meta.livre.annee',
  'meta.livre.isbnPrint', 'meta.livre.isbnEbook', 'meta.livre.doi',
  'meta.livre.licence', 'meta.livre.couleur',
  'meta.livre.grammage', 'meta.livre.main', 'meta.livre.dosMm', 'meta.livre.fondPerduMm',
  'meta.livre.traitsDeCoupe', 'meta.livre.profilCmjn',
  // Responsables, couleurs de l’imprimé, fond, papier de couverture, dos calculé,
  // illustration et 4e de couverture. (Pas d’apostrophe droite dans ce tableau : un test
  // en extrait les clés entre apostrophes droites.)
  'fiches.auteur.ajouter', 'meta.livre.auteurs', 'meta.livre.editeurs', 'meta.livre.mention',
  'meta.livre.mention.defaut.fr', 'meta.livre.mention.defaut.de',
  'meta.livre.mention.defaut.it', 'meta.livre.mention.defaut.en',
  'meta.livre.couleurImpression', 'meta.livre.fond', 'meta.livre.fondTeinte',
  'meta.livre.illusX', 'meta.livre.illusY', 'meta.livre.illusAide', 'meta.livre.brAide',
  'meta.livre.couvVolume', 'meta.livre.couvGrammage', 'meta.livre.colleMm',
  'meta.livre.dos', 'meta.livre.dos.valeur', 'meta.livre.dos.absent',
  'meta.livre.illustration', 'meta.livre.quatrieme', 'meta.livre.quatrieme.ouvrir',
  // Modèle de couverture, illustration pleine page, titre et sous-titre voisins.
  'livre.couverture.modele', 'livre.couverture.modele.defaut', 'livre.couverture.modele.falc',
  'livre.couverture.modele.classique', 'livre.couverture.modele.recherche',
  'livre.couverture.modele.prospectrum', 'livre.couverture.illustrationPlein',
  'livre.couverture.illustrationPlein.aide', 'livre.couverture.titre2',
  'livre.couverture.sousTitre2', 'livre.couverture.voisinAide'];

// Valeurs permises des listes fermées du formulaire, contrôlées ici et par la webview.
const OUVRAGES_VALIDES = ['monographie', 'collectif'];
const MAQUETTES_LIVRE_VALIDES = ['normal', 'falc'];
const FORMATS_LIVRE_VALIDES = ['standard', 'a4'];
const MODELES_COUVERTURE_VALIDES = ['falc', 'classique', 'recherche', 'prospectrum'];
// Titres de couverture à plusieurs lignes : « // » dans le fichier.
const CLES_TITRES_LIGNES = ['titre', 'sous-titre', 'couverture.titre-2', 'couverture.sous-titre-2'];

// Couleurs de référence de l'imprimé, lues dans pipeline/styles/couleurs-reference.json :
// la même table donne le CMJN du PDF d'impression et le RGB de la couverture. Cherchée dans
// le dépôt, puis dans le toolkit installé.
function couleursReference() {
  const relatif = ['pipeline', 'styles', 'couleurs-reference.json'];
  const candidats = [path.resolve(__dirname, '..', '..', '..', ...relatif), path.join(toolkitPoste(), ...relatif)];
  for (const c of candidats) {
    try {
      const json = JSON.parse(fs.readFileSync(c, 'utf8'));
      const sortie = {};
      for (const cle of Object.keys(json)) {
        const e = json[cle] || {};
        if (/^[a-z][a-z0-9-]*$/.test(cle) && /^#[0-9A-Fa-f]{6}$/.test(String(e.rgb || ''))) {
          sortie[cle] = { nom: String(e.nom || cle), rgb: String(e.rgb).toUpperCase() };
        }
      }
      if (Object.keys(sortie).length > 0) { return sortie; }
    } catch (e) { /* emplacement suivant */ }
  }
  return {};
}

// couverture/illustration.<ext> : l'image de la 1re de couverture. Formats de l'ouvrage,
// plus larges que ceux de la couverture d'un numéro (JPEG et PNG seuls).
const EXTENSIONS_ILLUSTRATION = { jpg: 'jpg', jpeg: 'jpg', png: 'png', svg: 'svg', webp: 'webp' };
const MIME_ILLUSTRATION = { jpg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' };

function textesLivre() {
  const libelles = {};
  for (const cle of LIBELLES_LIVRE) { libelles[cle] = T(cle); }
  // Le reste vient de textesNumero(), le formulaire partageant _numero.js. La
  // « couverture » y désigne ici l'illustration de couverture.
  return Object.assign({}, textesNumero(), textesAuteur(), {
    libelles: libelles,
    licences: [{ valeur: '', libelle: T('meta.livre.licence.aucune') }].concat(licencesTraduites()),
    couverture: T('meta.livre.illustration'),
    couvertureAbsente: T('meta.livre.illustration.absente'),
    couvertureDeposer: T('meta.livre.illustration.deposer'),
    couvertureFormat: T('meta.livre.illustration.format'),
    couvertureEnregistree: T('meta.livre.illustration.enregistree'),
    couvertureExtensions: Object.keys(EXTENSIONS_ILLUSTRATION)
  });
}

function htmlMetadonneesLivre(nonce) {
  return construireHtml('metadata-book', nonce, {
    cssPartage: ['_design.css', '_numero.css', '_auteurs.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_numero.js'],
    titre: T('meta.livre.panneau'), remplacements: { '__TXT__': JSON.stringify(textesLivre()) }
  });
}

// ---- Dos calculé, illustration et 4e de couverture ----

// out/<livre>-dos.json, écrit par la compilation de la couverture : {nb_pages, dos_mm,
// grammage_couverture, source}. null s'il manque ou ne se lit pas ; la page invite alors à
// compiler la couverture.
function chargeDos(racine) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(racine, 'out', path.basename(racine) + '-dos.json'), 'utf8'));
    const nb = Number(j.nb_pages);
    const dos = Number(j.dos_mm);
    const gram = Number(j.grammage_couverture);
    if (!isFinite(nb) || !isFinite(dos) || !isFinite(gram)) { return null; }
    return { nb_pages: nb, dos_mm: dos, grammage_couverture: gram, source: String(j.source || '') };
  } catch (e) { return null; }
}

// Retour à la ligne forcé dans un titre : le formulaire montre des lignes, buch.yaml et les
// fiches écrivent « // » sur une seule ligne. La découpe retire les lignes vides et les
// espaces de bord ; « A//B » donne deux lignes.
function lignesTitre(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .split(/\r\n|\r|\n|\/\//).map((l) => l.trim()).filter((l) => l !== '');
}
function titreVersLignes(texte) { return lignesTitre(texte).join('\n'); }
function lignesVersTitre(texte) { return lignesTitre(texte).join(' // '); }

function dossierCouvertureLivre(racine) { return path.join(racine, 'couverture'); }

function illustrationExistante(racine) {
  for (const ext of ['jpg', 'png', 'svg', 'webp']) {
    const chemin = path.join(dossierCouvertureLivre(racine), 'illustration.' + ext);
    try {
      const st = fs.statSync(chemin);
      if (st.isFile()) { return { nom: 'illustration.' + ext, ext: ext, chemin: chemin, taille: st.size }; }
    } catch (e) { /* extension suivante */ }
  }
  return null;
}

// Même forme que chargeCouverture : la page traite l'illustration comme la couverture d'un
// numéro, avec les mêmes messages.
function chargeIllustration(racine) {
  const trouvee = illustrationExistante(racine);
  if (!trouvee) { return { nom: '', description: '', apercu: null }; }
  let apercu = null;
  if (trouvee.taille <= MAX_APERCU_COUVERTURE) {
    try {
      apercu = 'data:' + MIME_ILLUSTRATION[trouvee.ext] + ';base64,'
        + fs.readFileSync(trouvee.chemin).toString('base64');
    } catch (e) { apercu = null; }
  }
  return { nom: trouvee.nom, description: poidsLisible(trouvee.taille), apercu: apercu };
}

// -> { erreur } ou { ext, donnees }. Format et poids sont revérifiés ici.
function illustrationRecevable(nomFichier, donneesBase64) {
  const m = String(nomFichier || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? EXTENSIONS_ILLUSTRATION[m[1]] : undefined;
  if (!ext) { return { erreur: T('meta.livre.illustration.format') }; }
  let donnees;
  try { donnees = Buffer.from(String(donneesBase64 || ''), 'base64'); }
  catch (e) { return { erreur: T('meta.livre.illustration.format') }; }
  if (donnees.length === 0) { return { erreur: T('meta.livre.illustration.format') }; }
  if (donnees.length > MAX_COUVERTURE) { return { erreur: T('art.couverture.poids') }; }
  return { ext: ext, donnees: donnees };
}

// -> null, ou le message de l'échec. Une seule illustration par livre : les autres
// extensions sont retirées, sinon la compilation prendrait la première de sa liste.
function ecrireIllustration(racine, ext, donnees) {
  const dossier = dossierCouvertureLivre(racine);
  const cible = path.join(dossier, 'illustration.' + ext);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    const tmp = path.join(dossier, '~$illustration.' + ext);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
  } catch (e) { return T('err.ecriture', ['illustration.' + ext, String((e && e.message) || e)]); }
  for (const autre of ['jpg', 'png', 'svg', 'webp']) {
    if (autre === ext) { continue; }
    try {
      const c = path.join(dossier, 'illustration.' + autre);
      if (fs.existsSync(c)) { fs.unlinkSync(c); }
    } catch (e) { /* verrouillé : le nom affiché dira laquelle la compilation voit */ }
  }
  return null;
}

// Dépôt d'une illustration : confirmation avant d'en remplacer une, puis réponse à la page
// par le message « couverture » (nom, poids, aperçu).
async function deposerIllustration(panneau, racine, msg) {
  if (refuserSiVerrouille()) { return; }
  const recu = illustrationRecevable(msg.nomFichier, msg.donneesBase64);
  if (recu.erreur) { repondrePanneau(panneau, { type: MSG.ERREUR, message: recu.erreur }); return; }
  const ancienne = illustrationExistante(racine);
  if (ancienne) {
    const oui = T('meta.livre.illustration.remplacer.oui');
    const choix = await vscode.window.showWarningMessage(
      T('meta.livre.illustration.remplacer', [ancienne.nom]), { modal: true }, oui);
    if (choix !== oui) {
      repondrePanneau(panneau, Object.assign({ type: MSG.COUVERTURE, inchangee: true }, chargeIllustration(racine)));
      return;
    }
  }
  const erreur = ecrireIllustration(racine, recu.ext, recu.donnees);
  if (erreur) { repondrePanneau(panneau, { type: MSG.ERREUR, message: erreur }); return; }
  repondrePanneau(panneau, Object.assign({ type: MSG.COUVERTURE }, chargeIllustration(racine)));
  vscode.window.setStatusBarMessage(T('meta.livre.illustration.enregistree'), 3000);
}

// Ouvre couverture/quatrieme.md dans l'éditeur, en le créant vide s'il manque.
async function ouvrirQuatrieme(racine) {
  const chemin = path.join(dossierCouvertureLivre(racine), 'quatrieme.md');
  if (!fs.existsSync(chemin)) {
    try {
      fs.mkdirSync(path.dirname(chemin), { recursive: true });
      fs.writeFileSync(chemin, '');
    } catch (e) {
      vscode.window.showErrorMessage(T('err.ecriture', ['quatrieme.md', String((e && e.message) || e)]));
      return;
    }
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(chemin));
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
}

// Les valeurs de buch.yaml, plus ce que la page montre sans le saisir : le dos calculé et
// l'illustration de couverture. Les listes de personnes absentes sont des listes vides.
function chargeLivre(racine) {
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8')); }
  catch (e) { /* fichier illisible : formulaire vide */ }
  for (const cle of CLES_METADONNEES) {
    if (valeurs[cle] === undefined) { valeurs[cle] = CLES_PERSONNES.indexOf(cle) !== -1 ? [] : ''; }
  }
  valeurs['impression.traits-de-coupe'] = estVraiYaml(valeurs['impression.traits-de-coupe']) ? 'true' : 'false';
  valeurs['couverture.illustration-plein'] = estVraiYaml(valeurs['couverture.illustration-plein']) ? 'true' : 'false';
  for (const cle of CLES_TITRES_LIGNES) { valeurs[cle] = titreVersLignes(valeurs[cle]); }
  const reference = couleursReference();
  return {
    valeurs: valeurs, dos: chargeDos(racine), couverture: chargeIllustration(racine),
    // Couleurs de référence de l'imprimé pour les pastilles, relues à chaque chargement.
    couleursImpression: Object.keys(reference).map((cle) => ({
      cle: cle, nom: reference[cle].nom, rgb: reference[cle].rgb
    }))
  };
}

// -> null, ou le message de l'échec. Pendant d'ecrireChampsNumero, avec sa propre
// validation : ouvrage, maquette et format sont des listes fermées.
function ecrireChampsLivre(racine, brut) {
  const modifies = {};
  for (const cle of CLES_METADONNEES) {
    if (CLES_PERSONNES.indexOf(cle) !== -1) {
      // Liste de personnes : champs du schéma seuls, texte sur une ligne, personnes sans
      // nom écartées.
      if (brut && Array.isArray(brut[cle])) {
        modifies[cle] = brut[cle].slice(0, 100).map((p) => {
          const propre = {};
          for (const champ of CHAMPS_PERSONNE) {
            const v = p && p[champ] !== undefined && p[champ] !== null ? p[champ] : '';
            propre[champ] = String(v).replace(/[\r\n]+/g, ' ').slice(0, 300).trim();
          }
          return propre;
        }).filter((p) => p.prenom !== '' || p.nom !== '');
      }
      continue;
    }
    if (brut && typeof brut[cle] === 'string') {
      modifies[cle] = (CLES_TITRES_LIGNES.indexOf(cle) !== -1 ? lignesVersTitre(brut[cle]) : brut[cle])
        .replace(/[\r\n]+/g, ' ').slice(0, 500).trim();
    }
  }
  // Couleur d'impression et fond de couverture : la liste fermée de la référence.
  const reference = couleursReference();
  for (const cle of ['couleur-impression', 'couverture.fond']) {
    if (cle in modifies && !Object.prototype.hasOwnProperty.call(reference, modifies[cle])) { delete modifies[cle]; }
  }
  // Teinte du fond : de 1 à 100 %, ou vide (retour au défaut).
  if ('couverture.fond-teinte' in modifies && modifies['couverture.fond-teinte'] !== '') {
    const n = Number(modifies['couverture.fond-teinte']);
    if (!isFinite(n) || n < 1 || n > 100) { delete modifies['couverture.fond-teinte']; }
  }
  if ('ouvrage' in modifies && OUVRAGES_VALIDES.indexOf(modifies.ouvrage) === -1) { delete modifies.ouvrage; }
  if ('maquette' in modifies && MAQUETTES_LIVRE_VALIDES.indexOf(modifies.maquette) === -1) { delete modifies.maquette; }
  if ('couverture.modele' in modifies && modifies['couverture.modele'] !== ''
    && MODELES_COUVERTURE_VALIDES.indexOf(modifies['couverture.modele']) === -1) { delete modifies['couverture.modele']; }
  if ('format' in modifies && FORMATS_LIVRE_VALIDES.indexOf(modifies.format) === -1) { delete modifies.format; }
  if ('licence' in modifies && modifies.licence !== '' && normaliserLicence(modifies.licence) === '') {
    delete modifies.licence;
  }
  if ('couleur' in modifies) {
    const c = modifies.couleur.toUpperCase();
    if (c !== '' && !/^#[0-9A-F]{6}$/.test(c)) { delete modifies.couleur; } else { modifies.couleur = c; }
  }
  // Décalage de l'illustration, en mm : un nombre (négatif et décimales permis), ou vide (0).
  for (const cle of ['couverture.illustration-x-mm', 'couverture.illustration-y-mm']) {
    if (cle in modifies && modifies[cle] !== '') {
      const texte = modifies[cle].replace(',', '.');
      const n = Number(texte);
      if (!/^-?\d+(\.\d+)?$/.test(texte) || !isFinite(n) || Math.abs(n) > 500) { delete modifies[cle]; }
      else { modifies[cle] = texte; }
    }
  }
  if ('impression.traits-de-coupe' in modifies) {
    const t = modifies['impression.traits-de-coupe'].toLowerCase();
    if (t !== 'true' && t !== 'false') { delete modifies['impression.traits-de-coupe']; }
    else { modifies['impression.traits-de-coupe'] = t; }
  }
  if ('couverture.illustration-plein' in modifies) {
    const t = modifies['couverture.illustration-plein'].toLowerCase();
    if (t !== 'true' && t !== 'false') { delete modifies['couverture.illustration-plein']; }
    else { modifies['couverture.illustration-plein'] = t; }
  }
  delete modifies[cleOrdre()];
  if (Object.keys(modifies).length === 0) { return null; }
  return ctx.ecrireClesAusgabe(racine, modifies);
}

// Pendant de messageNumero, avec l'illustration et la 4e de couverture en plus.
function messageLivre(panneau, racine, msg, rafraichirTout, recharger) {
  if (msg.type === MSG.ENREGISTRER) {
    if (session.etatNumero().verrouillee) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: T('verrou.refuse') });
      return true;
    }
    const refus = ecrireSousMain(panneau, racine, cheminConfig(racine),
      () => ecrireChampsLivre(racine, msg.modifies));
    if (refus) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: refus.message });
      if (refus.code === 'perime' && recharger) { recharger(); }
      return true;
    }
    repondrePanneau(panneau, { type: MSG.ENREGISTRE });
    vscode.window.setStatusBarMessage(T('statut.ausgabe'), 3000);
    if (rafraichirTout) { rafraichirTout(); }
    return true;
  }
  // L'illustration de couverture : mêmes messages que la couverture d'un numéro. Rend la
  // promesse (truthy), car le dépôt peut attendre une confirmation.
  if (msg.type === MSG.COUVERTURE_DEPOSER) {
    return deposerIllustration(panneau, racine, msg).catch((e) => {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: String((e && e.message) || e) });
    });
  }
  if (msg.type === MSG.OUVRIR && msg.cible === 'quatrieme') {
    return ouvrirQuatrieme(racine).catch((e) => console.warn('4e de couverture : ' + ((e && e.message) || e)));
  }
  return false;
}

// Panneau unique : rouvrir la commande révèle le formulaire, valeurs relues du disque. Le
// même panneau sert à la revue et au livre, avec deux formulaires.
//
// `item` porte { slug, focus } quand la commande vient du bouton d'un constat. focus
// nomme un champ de CHAMPS/CHAMPS_LIVRE (media/_numero.js) ; il est envoyé avec les
// valeurs à chaque ouverture. Un focus vide ou inconnu est ignoré.
async function ouvrirMetadonnees(fournisseur, rafraichirTout, item) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const focus = String((item && item.focus) || '');
  await fermerTousLesApercus();
  const estLivre = profilCourant().cle === 'livre';
  const titre = estLivre ? T('meta.livre.panneau') : T('meta.titre');
  const envoyerValeurs = (panneau) => {
    const extra = focus ? { focus: focus } : {};
    if (estLivre) {
      repondrePanneau(panneau, Object.assign({ type: MSG.VALEURS }, chargeLivre(racine), extra));
      envoyerAuteursConnus(panneau, racine);
    }
    else { repondrePanneau(panneau, Object.assign({ type: MSG.VALEURS }, chargeNumero(racine, true), extra)); }
    noterLectureCoedition(panneau, racine, cheminConfig(racine));
  };
  // Panneau neuf (PRET) ou déjà ouvert : mêmes valeurs, même annonce de bail.
  const accueillir = (panneau) => {
    envoyerValeurs(panneau);
    annoncerMain(panneau, racine, cheminConfig(racine));
  };
  const { panneau, nouveau } = panneauUnique({
    viewType: 'szhMetadonnees', titre: titre, retenir: true,
    // Mode « Trad » : l'état du mode, et le clic détourné — voir repondreModeTrad.
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: estLivre ? htmlMetadonneesLivre : htmlMetadonnees,
    surPret: (msg, p) => accueillir(p),
    surMessage: (msg, p) => {
      const traite = estLivre
        ? messageLivre(p, racine, msg, rafraichirTout, () => envoyerValeurs(p))
        : messageNumero(p, racine, msg, rafraichirTout, () => envoyerValeurs(p));
      if (!traite) { console.warn('métadonnées : type de message inconnu', msg.type); }
      return traite && typeof traite.then === 'function' ? traite : undefined;
    },
    surFermeture: (p) => libererCoedition(p)
  });
  if (!nouveau) { accueillir(panneau); }
}

// ---- Éditeur des métadonnées de tous les articles --------------------------------
// Une carte par article : type, doi, title/subtitle/keywords traduisibles, auteurs. Le
// gabarit est partagé avec le dialogue d'import.
function textesCarteArticle() {
  return Object.assign({
    type: T('fiches.type'), typeAucun: T('fiches.type.aucun'),
    langueArticle: TP('fiches.langue.article', profilCourant()),
    langueFr: T('meta.langue.fr'), langueDe: T('meta.langue.de'), langueIt: T('meta.langue.it'),
    licence: T('fiches.licence'),
    titreChamp: T('fiches.titre.champ'), sousTitre: T('fiches.soustitre'),
    resume: T('fiches.resume'),
    resumeCompteur: T('fiches.resume.compteur'),
    auteurs: T('fiches.auteurs'),
    motsCles: T('fiches.motscles'),
    ajoutFr: T('fiches.ajout.fr'), ajoutDe: T('fiches.ajout.de'), ajoutIt: T('fiches.ajout.it'),
    motsClesTitre: T('fiches.motscles.titre'),
    motCleAjouter: T('fiches.motcle.ajouter'), motCleRetirer: T('fiches.motcle.retirer'),
    motCleATraduire: T('mc.aTraduire'),
    motsClesSuggestions: T('fiches.motscles.suggestions'),
    // La pastille « hors thésaurus » et le second rideau de la boîte de suggestions
    // (media/_fiches.js) : voir le commentaire de ces deux clés dans lib/i18n.js.
    motsClesHorsThesaurus: T('mc.horsThesaurus'),
    motsClesAjouterHorsThesaurus: T('mc.ajouterHorsThesaurus'),
    rien: T('form.rien'), enregistre: TP('fiches.enregistre', profilCourant()),
    // L'interrupteur des traductions : un libellé fixe et deux infobulles selon l'action à
    // venir. L'œil ouvert ou fermé est redessiné par traductions().
    tradBouton: T('fiches.trad.bouton'),
    mdBouton: T('fiches.md.bouton'),
    mdAfficher: TP('fiches.md.afficher', profilCourant()), mdMasquer: TP('fiches.md.masquer', profilCourant()),
    tradAfficher: T('fiches.trad.afficher'), tradMasquer: T('fiches.trad.masquer'),
    langueAvenir: TP('fiches.langue.avenir', profilCourant()),
    doiVerrouTip: T('fiches.doi.tip'), doiManuel: T('fiches.doi.manuel'),
    // Deux notes non bloquantes : la forme attendue d'un DOI saisi à la main, et
    // l'avertissement quand deux cartes portent le même. Voir champDoi() et
    // verifierDoublonsDoi() dans media/_fiches.js.
    doiForme: T('fiches.doi.forme'), doiDouble: T('fiches.doi.double'),
    // Vérificateur de traduction : l'infobulle de la pastille de chaque intitulé
    // traduisible. Le mode arrive dans le message « valeurs ».
    suggPastille: T('sugg.pastille'),
    // Case « hors sommaire » : livre seulement (capacites.horsSommaire). Voir
    // construireCarte() dans media/_fiches.js.
    sommaireCase: T('fiches.sommaire'), sommaireAide: T('fiches.sommaire.aide'),
    // Aide sous titre et sous-titre d'un chapitre (livre seulement, media/_fiches.js).
    brAide: T('meta.livre.brAide')
  }, textesAuteur());
}

// Libellés de la fiche d'auteur·e et de sa modale (media/_auteurs.js), partagés par
// plusieurs vues.
function textesAuteur() {
  return {
    aPrenom: T('fiches.auteur.prenom'), aNom: T('fiches.auteur.nom'),
    aFonction: T('fiches.auteur.fonction'), aAffiliation: T('fiches.auteur.affiliation'),
    aRor: T('fiches.auteur.ror'),
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

// Le choix de licence de la carte, dans la langue de l'interface.
function licencesTraduites() {
  return LICENCES_ARTICLE.map((l) => ({ valeur: l.cle, libelle: T('licence.' + l.cle) }));
}

// Deux groupes, dans la langue de l'interface ; la fiche n'enregistre que le code.
function typesTraduits() {
  const langue = langueCockpit();
  const options = (liste, groupe) => liste.map((t) => ({
    valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t,
    groupe: (GROUPES_TYPES[groupe] || {})[langue] || (GROUPES_TYPES[groupe] || {}).fr || ''
  }));
  return options(TYPES_DOSSIER, 'dossier').concat(options(TYPES_HORS, 'hors'));
}

// Écrit les cartes reçues d'une webview de fiches : nettoyage, conservation des clés
// inconnues, écriture atomique. `slugsAutorises` restreint à la liste du panneau.
// `panneau` sert au bail de co-édition, pris fiche par fiche, sur celles qui changent.
function ecrireCartesArticles(fournisseur, cartes, slugsAutorises, panneau) {
  const connus = new Set(fournisseur.listerArticles());
  const langueNumero = langueRevue(fournisseur.racine);
  let n = 0;
  const erreurs = [];
  const refus = [];
  const ecrits = [];
  let recharger = false;
  for (const slug of Object.keys(cartes || {})) {
    if (!connus.has(slug)) { continue; }
    if (slugsAutorises && slugsAutorises.indexOf(slug) === -1) { continue; }
    const fichierMeta = cheminMeta(fournisseur.racine, slug);
    const barre = mainCoedition(panneau, fournisseur.racine, fichierMeta, { ecriture: true });
    if (barre) {
      refus.push(barre.code === 'pris'
        ? T('coedition.fiche.prise', [slug, barre.titulaire])
        : barre.message);
      if (barre.code === 'perime') { recharger = true; }
      continue;
    }
    try {
      const carte = nettoyerCarte(cartes[slug]);
      let langAvant = null;
      try {
        const ancien = analyserMeta(fs.readFileSync(fichierMeta, 'utf8'));
        carte._inconnues = ancien._inconnues;
        if (carte.source === '') { carte.source = ancien.source; }
        // Un champ que le profil n'affiche pas (type, licence, DOI, mots-clés d'un
        // chapitre) revient vide de la webview : on garde la valeur du disque, qu'elle
        // vienne d'une migration ou d'une saisie à la main.
        const cap = profilCourant().capacites;
        if (!cap.typeArticle && carte.type === '') { carte.type = ancien.type; }
        if (!cap.licence && carte.licence === '') { carte.licence = ancien.licence; }
        if (!cap.doi && carte.doi === '') { carte.doi = ancien.doi; }
        if (!cap.motsCles && Object.keys(carte.keywords).length === 0) { carte.keywords = ancien.keywords; }
        langAvant = ancien.lang || langueNumero;
      } catch (e) { /* pas de fiche existante */ }
      ecrireAtomique(fichierMeta, serialiserMeta(carte));
      rafraichirEmpreinteCoedition(fournisseur.racine, fichierMeta);
      n++;
      ecrits.push(slug);
      // La langue a changé : les statuts du suivi de traduction suivent leurs contenus.
      if (langAvant && carte.lang && carte.lang !== langAvant) {
        try { ctx.permuterStatutsTraduction(fournisseur.racine, slug, langAvant, carte.lang); }
        catch (e) { vscode.window.showWarningMessage(T('fiches.statuts.echec', [slug])); }
      }
    } catch (e) {
      erreurs.push(slug + ' (' + e.message + ')');
    }
  }
  return { n: n, erreurs: erreurs, refus: refus, recharger: recharger, ecrits: ecrits };
}

// Le message à afficher après ecrireCartesArticles, ou null quand tout est passé.
function messageCartes(res) {
  const morceaux = (res.refus || []).slice();
  if (res.erreurs.length > 0) { morceaux.push(T('err.ecriture', [res.erreurs.join(', ')])); }
  return morceaux.length > 0 ? morceaux.join(' ') : null;
}

// Relance en tâche de fond la compilation de chaque article enregistré.
function relancerCompilationCartes(fournisseur, res) {
  for (const slug of (res && res.ecrits) || []) {
    ctx.relancerCompilation(fournisseur, slug, { sansAffichage: true });
  }
}

function htmlApercuMetadonnees(nonce) {
  const txt = JSON.stringify(Object.assign(textesCarteArticle(), {
    filtreNote: TP('fiches.filtre.note', profilCourant()), tous: TP('fiches.tous', profilCourant()),
    retour: TP('fiches.retour', profilCourant()), retourTip: TP('fiches.retour.tip', profilCourant())
  }));
  return construireHtml('metadata-articles', nonce, {
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
    titre: TP('fiches.titre', profilCourant()),
    remplacements: { '__TXT__': txt },
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Migration idempotente : les métadonnées encore en frontmatter partent vers
// <slug>.meta.yaml, sous la langue de la revue.
function migrerFrontmatterVersMeta(racine, slug) {
  const fichierMeta = cheminMeta(racine, slug);
  if (fs.existsSync(fichierMeta)) { return; }
  const fichierMd = path.join(racine, dossierUnites(), slug, slug + '.md');
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

// Année du numéro : celle de la date de publication si elle y est, sinon celle du nom du
// dossier (« 2027-03 »).
function anneeNumero(racine, valeurs) {
  const annee = (String((valeurs || {}).date || '').match(/\d{4}/) || [''])[0];
  if (annee !== '') { return annee; }
  return (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
}

// Le DOI calculé de chaque article (locale, année, numéro, rang parmi les articles qui en
// portent). -> { slug: DOI }, '' quand il est incalculable ou que l'article n'en reçoit pas.
function doisCalculesArticles(fournisseur) {
  // Un chapitre de livre n'a pas de DOI.
  if (!profilCourant().capacites.doi) { return {}; }
  const racine = fournisseur.racine;
  const slugs = fournisseur.listerArticles();
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : DOI incalculable, et le champ le dira par « — » */ }
  const locale = langueDefaut(valeurs);
  const annee = anneeNumero(racine, valeurs);
  const numeroRevue = String(valeurs.numero || '').trim();
  const sansDoi = ctx.articlesSansDoi(racine, slugs);
  const dois = {};
  for (const slug of slugs) {
    dois[slug] = doiCalcule(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi));
  }
  return dois;
}

// Le fichier dérivé des DOI calculés, écrit à côté d'ausgabe.yaml.
const NOM_DOIS_CALCULES = 'dois-calcules.yaml';
function ecrireDoisCalcules(fournisseur) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Un livre n'a pas de DOI : pas de dois-calcules.yaml, que szh-maquette.lua ne lit que
  // pour le bandeau DOI d'une revue.
  if (!profilCourant().capacites.doi) { return; }
  if (etatRevue(racine).archivee) { return; }
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
    let valeurs = analyserMeta('');
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide */ }
    delete valeurs._inconnues;
    // Chapitre : les « // » d'un titre se montrent en lignes (voir lignesTitre).
    if (profilCourant().capacites.titreEnLignes) {
      for (const cle of ['title', 'subtitle']) {
        for (const l of Object.keys(valeurs[cle] || {})) { valeurs[cle][l] = titreVersLignes(valeurs[cle][l]); }
      }
    }
    articles.push({
      slug: slug, valeurs: valeurs, doiCalcule: dois[slug] || '',
      apercusAuteurs: (valeurs.author || [])
        .map((a) => vignetteAuteur(fournisseur.racine, slug, a.photo, budget))
    });
  }
  return articles;
}

function nettoyerCarte(brut) {
  const texteCourt = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, max).trim();
  // trim avant la troncature : la forme attendue est ancrée (^...$), et un espace resté en
  // bout de chaîne la rendrait fausse.
  const doiPropre = (v) => String(v === undefined || v === null ? '' : v).trim().replace(/[\r\n]+/g, ' ').slice(0, 200);
  const carte = { type: '', lang: '', source: '', licence: '', doi: doiPropre(brut && brut.doi), horsSommaire: false, title: {}, subtitle: {}, resume: {}, keywords: {}, author: [] };
  const type = texteCourt(brut && brut.type, 40);
  if (TYPES_ARTICLE.indexOf(type) !== -1) { carte.type = type; }
  carte.lang = normaliserLangueArticle(brut && brut.lang);
  carte.source = texteCourt(brut && brut.source, 300);
  carte.licence = normaliserLicence(brut && brut.licence);
  // Case « hors sommaire » : écrite pour un livre seulement, quoi que la carte envoie.
  if (profilCourant().capacites.horsSommaire) { carte.horsSommaire = (brut && brut.horsSommaire) === true; }
  for (const cle of ['title', 'subtitle', 'resume']) {
    const map = (brut && brut[cle]) || {};
    const max = cle === 'resume' ? 2000 : 500;
    for (const l of LANGUES_META) {
      const enLignes = profilCourant().capacites.titreEnLignes && cle !== 'resume';
      const t = texteCourt(enLignes ? lignesVersTitre(map[l]) : map[l], max);
      if (t !== '') { carte[cle][l] = t; }
    }
  }
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
      for (const c of CHAMPS_AUTEUR) { propre[c] = texteCourt(a && a[c], c === 'email' ? 200 : 300); }
      propre.photo = assainirCheminPhoto(propre.photo);
      carte.author.push(propre);
    }
  }
  return carte;
}

// ---- Auteur·e·s et photos : les cartes des fiches --------------------------------
// Limites envoyées en SZH.LIMITES (media/_commun.js) aux webviews médias, documentation,
// vérification d'import et fiches.
const EXTENSIONS_PHOTO = ['png', 'jpg', 'jpeg', 'webp'];
const TAILLE_MAX_PHOTO = 20 * 1024 * 1024;     // 20 Mo, vérifiés webview et hôte
const VERSIONS_PHOTO = ['original', 'avec-fond', 'sans-fond'];

function limitesMedias() {
  return {
    imageMax: TAILLE_MAX_IMAGE_IMPORT, imageExtensions: EXTENSIONS_IMAGE_IMPORT,
    photoMax: TAILLE_MAX_PHOTO, photoExtensions: EXTENSIONS_PHOTO
  };
}

let photoEnCours = false;                       // un traitement à la fois

function dossierPortraitsArticle(racine, slug) {
  return path.join(racine, dossierUnites(), slug, 'portraits');
}

// Vignette d'un portrait pour la fiche d'auteur·e, dans un budget partagé. Au-delà, la
// fiche montre le pictogramme d'absence et la modale charge la photo à la demande.
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

// Le cache auteurs.json (lib/auteurs-ojs.js), envoyé avec les valeurs aux vues qui portent
// la modale d'auteur·e : métadonnées, vérification d'import, médias.
function envoyerAuteursConnus(panneau, racine) {
  let cache;
  try { cache = lireCacheAuteursPublies(); } catch (e) { return; }
  const auteurs = cache.auteurs;
  if (!Array.isArray(auteurs) || auteurs.length === 0) { return; }
  const langue = langueRevue(racine) === 'de' ? 'de' : 'fr';
  const nomsRor = (cache.ror && typeof cache.ror === 'object') ? cache.ror : {};
  repondrePanneau(panneau, {
    type: MSG.AUTEURS_CONNUS,
    auteurs: auteurs.map((a) => ({
      prenom: a.prenom, nom: a.nom,
      fonction: a.fonction || '',
      affiliation: a.affiliation || libelleRor(nomsRor, a.ror, langue),
      ror: a.ror || '', orcid: a.orcid || '', email: a.email || ''
    }))
  });
}

// Le libellé d'un ROR dans la langue de la revue.
function libelleRor(nomsRor, ror, langue) {
  const id = String(ror || '').split('/').pop();
  const e = id === '' ? null : nomsRor[id];
  if (!e) { return ''; }
  return String(e[langue] || e.en || e.fr || e.de || '');
}

// Le cache mots-cles.json (lib/mots-cles-edudoc.js), envoyé aux vues qui portent la grille
// de mots-clés : métadonnées, vérification d'import.
function envoyerMotsClesConnus(panneau) {
  let cache;
  try { cache = lireCacheMotsCles(); } catch (e) { return; }
  const motsCles = cache.motsCles;
  if (!Array.isArray(motsCles) || motsCles.length === 0) { return; }
  repondrePanneau(panneau, {
    type: MSG.MOTS_CLES_CONNUS,
    motsCles: motsCles.map((m) => ({ de: (m && m.de) || '', fr: (m && m.fr) || '' }))
  });
}

// Rafraîchi tous les 7 jours à l'activation. Un échec réseau est silencieux : le poste
// peut être hors ligne.
const JOURS_FRAICHEUR_MOTS_CLES_ACTIVATION = 7;

function rafraichirMotsClesConnusEnFond() {
  let cache;
  try { cache = lireCacheMotsCles(); } catch (e) { return; }
  const t = cache.dateFetch ? Date.parse(cache.dateFetch) : NaN;
  const perime = !isFinite(t) ||
    (Date.now() - t) >= JOURS_FRAICHEUR_MOTS_CLES_ACTIVATION * 24 * 3600 * 1000;
  if (!perime) { return; }
  rafraichirMotsCles({ forcer: true }).then((res) => {
    if (res.fait && res.complet) {
      console.log('[mots-cles-edudoc] edudoc.ch : ' + res.nombre + ' descripteur(s)');
    } else if (res.fait) {
      console.log('[mots-cles-edudoc] rafraîchissement incomplet (hors ligne ?) : ' +
        (res.erreur || '?'));
    }
  }).catch((e) => {
    console.log('[mots-cles-edudoc] rafraîchissement raté : ' + String((e && e.message) || e));
  });
}

// Le rafraîchissement hebdomadaire, lancé à l'activation sans l'attendre.
function rafraichirAuteursPubliesEnFond() {
  const { rafraichirCorpus: rafraichirCorpusAuteurs } = require('./auteurs-corpus');
  rafraichirCacheAuteursPublies().then((res) => {
    if (res.fait && res.complet) {
      console.log('[auteurs-ojs] OJS : ' + res.nombre + ' nom(s), ' +
        (res.nombreRor || 0) + ' institution(s) ROR' +
        (res.rorRates ? ' (' + res.rorRates + ' ROR non résolu(s), on réessaiera)' : ''));
    } else if (res.fait) {
      console.log('[auteurs-ojs] rafraîchissement incomplet (hors ligne ?) : ' + (res.erreur || '?'));
    }
    return rafraichirCorpusAuteurs();
  }).then((res) => {
    if (!res || !res.fait) { return; }
    if (res.complet) {
      console.log('[auteurs-corpus] corpus balayé : ' + res.fichiers + ' fiche(s) lue(s), ' +
        res.nombre + ' nom(s) au total');
    } else {
      console.log('[auteurs-corpus] balayage incomplet, on reprendra : ' + (res.erreur || 'borne atteinte'));
    }
  }).catch((e) => {
    console.log('[auteurs] rafraîchissement raté : ' + String((e && e.message) || e));
  });
}

// photo-ouvrir : renvoie les versions déjà présentes sur le disque.
function ouvrirVersionsPhoto(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }
  const photo = assainirCheminPhoto(msg.photo);
  const d = photo === '' ? null : decomposerPhoto(photo);
  if (d && !baseAuteurValide(d.base)) {
    repondrePanneau(panneau, { type: MSG.PHOTO_ERREUR, slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  if (!d) {
    repondrePanneau(panneau, { type: MSG.PHOTO_ERREUR, slug: slug, index: msg.index, message: T('photo.err.introuvable') });
    return;
  }
  repondrePanneau(panneau, {
    type: MSG.PHOTO_VERSIONS, slug: slug, index: msg.index, base: d.base,
    versions: versionsPhoto(dossierPortraitsArticle(fournisseur.racine, slug), d.base),
    infos: null, actuelle: d.version
  });
}

// Écrit l'original dans un fichier « ~$ » puis le renomme, purge les anciens et lance le
// traitement. Le formulaire des fiches et le gestionnaire des médias passent tous deux ici.
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
      return echec(T('err.ecriture', [nomOriginal, e.message]));
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
  const erreur = (texte) => repondrePanneau(panneau, { type: MSG.PHOTO_ERREUR, slug: slug, index: index, message: texte });
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }
  if (refuserSiVerrouille()) { erreur(T('verrou.refuse')); return; }
  const prenom = String(msg.prenom || '').trim();
  const nom = String(msg.nom || '').trim();
  if (prenom === '' && nom === '') { erreur(T('photo.nomrequis')); return; }
  const slugAuteur = slugifier(prenom + '-' + nom);
  const ext = (String(msg.nomFichier || '').match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  const r = await ecrirePortraitEtTraiter(fournisseur, slug, slugAuteur, ext, msg.donneesBase64);
  if (!r.ok) { erreur(r.message); return; }
  if (!r.visage) { vscode.window.showWarningMessage(T('photo.sansvisage')); }
  repondrePanneau(panneau, {
    type: MSG.PHOTO_VERSIONS, slug: slug, index: index, base: slugAuteur,
    versions: versionsPhoto(r.dossier, slugAuteur),
    infos: { visage: !!r.visage, recadre: !!r.recadre },
    actuelle: null
  });
}

// Le champ `photo` d'une fiche peut désigner l'original, dont l'extension change avec le
// fichier déposé.
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

// photo-choisir : le chemin relatif de la version demandée, vérifié sur le disque.
function choisirPhotoAuteur(fournisseur, panneau, msg) {
  const slug = String(msg.slug || '');
  if (!new Set(fournisseur.listerArticles()).has(slug)) { return; }
  const base = String(msg.base || '');
  const version = String(msg.version || '');
  const erreur = () => repondrePanneau(panneau,
    { type: MSG.PHOTO_ERREUR, slug: slug, index: msg.index, message: T('photo.err.introuvable') });
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
  repondrePanneau(panneau, { type: MSG.PHOTO_VALEUR, slug: slug, index: msg.index, photo: 'portraits/' + nom });
}

// ---- Formulaire de fiches : tous les articles, ou un seul ------------------------
// Le formulaire liste tous les articles ; l'icône ✎ de l'arbre l'ouvre filtré sur un seul.
let filtreArticles = null;           // tableau de slugs affichés, ou null = tous
let rafraichirFiches = null;         // renvoie les valeurs au panneau ouvert, s'il existe
let fichesModifie = false;           // ● côté webview : cartes modifiées non enregistrées
let rechargementEnAttente = null;    // { filtre } pendant l'aller-retour de la garde

function filtreValide(fournisseur, slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) { return null; }
  const connus = new Set(fournisseur.listerArticles());
  const retenus = slugs.map(String).filter((s) => connus.has(s));
  return retenus.length > 0 ? retenus : null;
}

// Une fiche écrite ailleurs rend le formulaire périmé. Sans modification en cours, il est
// rechargé ; sinon, la personne choisit.
function signalerFichesPerimees() {
  if (!panneauCourant('szhApercuMetadonnees') || !rafraichirFiches) { return; }
  if (fichesModifie) { vscode.window.showWarningMessage(T('fiches.perimees')); return; }
  rafraichirFiches();
}

function titreFiches(filtre) {
  return (filtre && filtre.length === 1) ? T('fiches.titre.un', [filtre[0]]) : T('fiches.titre');
}

// Case « Définir manuellement le DOI » d'une carte : l'hôte demande confirmation et répond.
async function confirmerDoiManuel(panneau, msg) {
  const retirer = msg.sens === 'retirer';
  const choix = await vscode.window.showWarningMessage(
    T(retirer ? 'fiches.doi.retirer.question' : 'fiches.doi.manuel.question'),
    { modal: true, detail: T(retirer ? 'fiches.doi.retirer.detail' : 'fiches.doi.manuel.detail') },
    T(retirer ? 'fiches.doi.retirer.oui' : 'fiches.doi.manuel.oui'));
  repondrePanneau(panneau, {
    type: MSG.DOI_MANUEL_REPONSE, slug: String(msg.slug || ''),
    sens: retirer ? 'retirer' : 'activer', ok: choix !== undefined
  });
}

// ---- « Markdown » : le texte de l'article à droite de sa fiche ---------------------
//
// Le formulaire occupe la colonne 1, le .md s'ouvre en colonne 2, dans l'éditeur ordinaire.
//
// L'état est relu dans les onglets à chaque bascule, car un onglet peut être fermé à la
// croix. La page demande et s'affiche selon la réponse.
function estOngletDu(entree, chemin) {
  return !!(entree && entree.uri && entree.uri.fsPath
    && entree.uri.fsPath.toLowerCase() === String(chemin).toLowerCase());
}

async function basculerMarkdownFiche(fournisseur, panneau, msg) {
  const racine = fournisseur.racine;
  const connus = racine ? new Set(fournisseur.listerArticles()) : new Set();
  // L'article visé par la page, sinon celui du filtre quand il n'en désigne qu'un.
  let slug = String((msg && msg.slug) || '');
  if (!connus.has(slug) && filtreArticles && filtreArticles.length === 1) { slug = filtreArticles[0]; }
  if (!connus.has(slug)) {
    repondrePanneau(panneau, { type: MSG.MARKDOWN, visible: false, message: T('fiches.md.horsarticle') });
    return;
  }
  const md = path.join(racine, dossierUnites(), slug, slug + '.md');
  if (ctx.ongletOuvert((e) => estOngletDu(e, md))) {
    await ctx.fermerOnglets((e) => estOngletDu(e, md));
    repondrePanneau(panneau, { type: MSG.MARKDOWN, visible: false, slug: slug });
    return;
  }
  if (!fs.existsSync(md)) {
    repondrePanneau(panneau, { type: MSG.MARKDOWN, visible: false, message: T('fiches.md.horsarticle') });
    return;
  }
  // `preserveFocus` : le curseur reste dans la fiche.
  try {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md),
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true });
  } catch (e) {
    repondrePanneau(panneau, { type: MSG.MARKDOWN, visible: false, message: String((e && e.message) || e) });
    return;
  }
  repondrePanneau(panneau, { type: MSG.MARKDOWN, visible: true, slug: slug });
}

// Pleine page : les aperçus sont fermés avant, même pour un simple reveal.
//
// `focus` nomme un champ de la carte ([data-cle], media/_fiches.js : title, subtitle,
// resume, lang, licence, doi ; 'keywords' vise la grille de mots-clés). Il part avec chaque
// message « valeurs ». Un focus vide ou inconnu est ignoré.
async function ouvrirApercuMetadonnees(fournisseur, rafraichirTout, slugs, focus) {
  if (!fournisseur.racine) { return; }
  const filtre = filtreValide(fournisseur, slugs);
  const focusNorme = String(focus || '');
  await fermerTousLesApercus();
  const envoyerValeurs = (panneau, extra) => {
    const langue = langueRevue(fournisseur.racine);
    // La forme attendue des DOI de cette revue (motif et exemple, FORME_DOI de
    // lib/export-ojs.js), envoyée une fois pour toutes les cartes.
    const forme = FORME_DOI[langue] || FORME_DOI.fr;
    panneau.webview.postMessage(Object.assign({
      type: MSG.VALEURS,
      articles: lireMetadonneesArticles(fournisseur, filtreArticles),
      filtre: filtreArticles,
      langue: langue,
      // Les champs que la carte construit selon le profil (construireCarte(), media/_fiches.js).
      capacites: profilCourant().capacites,
      accent: ctx.lireCouleurAccent(fournisseur.racine),
      types: typesTraduits(),
      licences: licencesTraduites(), licenceDefaut: LICENCE_DEFAUT,
      limites: limitesMedias(),
      formeDoi: { motif: forme.motif.source, exemple: forme.exemple },
      // Réglage du vérificateur de traduction, relu à chaque envoi. Un panneau ouvert le
      // prend en compte à sa prochaine reconstruction.
      verifTrad: ctx.lireVerifTraduction()
    }, extra || {}));
    envoyerAuteursConnus(panneau, fournisseur.racine);
    envoyerMotsClesConnus(panneau);
    fichesModifie = false;
  };
  rafraichirFiches = () => {
    const ouvert = panneauCourant('szhApercuMetadonnees');
    if (ouvert) { envoyerValeurs(ouvert); }
  };
  const appliquerFiltre = (panneau, nouveau, extra) => {
    filtreArticles = nouveau;
    panneau.title = titreFiches(filtreArticles);
    envoyerValeurs(panneau, extra);
  };
  const existant = revelerPanneau({ viewType: 'szhApercuMetadonnees' });
  if (existant) {
    if (fichesModifie) {
      // Des cartes portent une saisie non enregistrée : le focus attend la réponse à la
      // question de rechargement (RECHARGEMENT ci-dessous).
      rechargementEnAttente = { filtre: filtre, focus: focusNorme };
      repondrePanneau(existant, { type: MSG.DEMANDE_RECHARGEMENT });
      return;
    }
    appliquerFiltre(existant, filtre, focusNorme ? { focus: focusNorme } : undefined);
    return;
  }
  filtreArticles = filtre;
  fichesModifie = false;
  const { panneau } = panneauUnique({
    viewType: 'szhApercuMetadonnees', titre: titreFiches(filtreArticles), retenir: true,
    // Mode « Trad » : l'état du mode, et le clic détourné — voir repondreModeTrad.
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlApercuMetadonnees,
    surPret: (msg, p) => envoyerValeurs(p, Object.assign({ requete: msg.requete },
      focusNorme ? { focus: focusNorme } : {})),
    surMessage: (msg) => traiterMessage(msg),
    surFermeture: (p, courant) => {
      libererCoedition(p);
      if (courant) {
        fichesModifie = false; rechargementEnAttente = null;
        rafraichirFiches = null;
      }
    }
  });
  async function traiterMessage(msg) {
    if (msg.type === MSG.MODIFIE) { fichesModifie = !!msg.modifie; return; }
    if (msg.type === MSG.TOUS) { await ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null); return; }
    if (msg.type === MSG.MARKDOWN) { await basculerMarkdownFiche(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.VERIF_META) { await imprimerFeuilleVerif(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.RECHARGEMENT) {
      const attente = rechargementEnAttente;
      rechargementEnAttente = null;
      if (!attente) { return; }
      const choix = await confirmerAbandon(T('fiches.recharger.question'));
      if (choix === 'annuler') { return; }
      if (choix === 'enregistrer') {
        const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles, panneau);
        const refusCartes = messageCartes(res);
        if (refusCartes) {
          repondrePanneau(panneau, { type: MSG.ERREUR, message: refusCartes });
          return;
        }
        vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000);
        if (rafraichirTout) { rafraichirTout(); }
        relancerCompilationCartes(fournisseur, res);
      }
      appliquerFiltre(panneau, attente.filtre, Object.assign({ rechargement: true },
        attente.focus ? { focus: attente.focus } : {}));
      return;
    }
    if (msg.type === MSG.PHOTO_DEPOSER) { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_OUVRIR) { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_CHOISIR) { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.DOI_MANUEL_CONFIRMER) { await confirmerDoiManuel(panneau, msg); return; }
    if (msg.type === MSG.SUGGERER_TRADUCTION) { ctx.ouvrirSuggestionTraduction(fournisseur, msg); return; }
    if (msg.type === MSG.RETOUR_ARTICLE) { await retourArticle(msg); return; }
    if (msg.type !== MSG.ENREGISTRER) {
      console.warn('métadonnées des articles (hôte) : type de message inconnu', msg.type);
      return;
    }
    if (!msg.articles) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles, panneau);
    const refusCartes = messageCartes(res);
    if (refusCartes) {
      panneau.webview.postMessage({ type: MSG.ERREUR, message: refusCartes });
    } else {
      panneau.webview.postMessage({ type: MSG.ENREGISTRE, n: res.n, auto: !!msg.auto });
      if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000); }
    }
    if (rafraichirTout) { rafraichirTout(); }
    relancerCompilationCartes(fournisseur, res);
    if (!msg.auto || res.recharger) { envoyerValeurs(panneau, res.recharger ? { rechargement: true } : undefined); }
  }
  // « ← Retour à l'article » : même garde « non enregistré » que les Médias, puis
  // l'article du filtre se rouvre et le formulaire se ferme.
  async function retourArticle(msg) {
    if (!filtreArticles || filtreArticles.length !== 1) { return; }
    const slug = filtreArticles[0];
    if (msg.modifie) {
      const choix = await confirmerAbandon(T('fiches.quitter.question', [slug]));
      if (choix === 'annuler') { return; }
      if (choix === 'enregistrer') {
        const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles, panneau);
        const refusCartes = messageCartes(res);
        if (refusCartes) {                         // échec d'écriture : on reste
          repondrePanneau(panneau, { type: MSG.ERREUR, message: refusCartes });
          return;
        }
        vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000);
        if (rafraichirTout) { rafraichirTout(); }
        relancerCompilationCartes(fournisseur, res);
      }
    }
    await vscode.commands.executeCommand('szh.ouvrirArticle', slug);
    panneau.dispose();
  }
}

// ---- « Vérifier les méta (print) » ------------------------------------------------
//
// Une page A4 par article, à imprimer et à relire à côté de la source. Le HTML est
// autonome et s'ouvre dans le navigateur par défaut, qui l'imprime : une webview ne sait
// pas imprimer, et passer par la WSL pour un PDF serait lent.
//
// La feuille est lue du disque, après enregistrement de ce que le panneau porte de
// modifié : l'empreinte du pied de page correspond ainsi à un fichier.

// Fichier jetable dans out/, réécrit à chaque clic. La feuille d'un seul article a son
// propre nom, pour ne pas écraser celle du numéro entier.
function cheminFeuilleVerif(racine, filtre) {
  const nom = (filtre && filtre.length === 1)
    ? 'verification-' + filtre[0] + '.html'
    : 'verification-metadonnees.html';
  return path.join(racine, 'out', nom);
}

// Libellés passés au module de rendu, qui n'en a aucun. Tout suit la langue de
// l'interface, comme le formulaire.
function libellesFeuilleVerif() {
  const types = {};
  for (const t of TYPES_ARTICLE) { types[t] = (LIBELLES_TYPES[t] || {})[langueCockpit()] || t; }
  const licences = {};
  for (const l of LICENCES_ARTICLE) { licences[l.cle] = T('licence.' + l.cle); }
  return {
    types: types, licences: licences,
    langues: { fr: T('meta.langue.fr'), de: T('meta.langue.de'), it: T('meta.langue.it') }
  };
}

// Les trois intitulés traduisibles du formulaire portent la langue entre parenthèses
// (« Titre ({0}) »). Sur la feuille, la langue a sa colonne : on garde l'intitulé nu.
function sansLangue(texte) { return String(texte).replace(/\s*\(\{0\}\)\s*$/, ''); }

function textesFeuilleVerif() {
  return {
    titrePage: T('verif.titre'), article: T('verif.article'), consigne: T('verif.consigne'),
    empreinte: T('verif.empreinte'),
    sectionIdentification: T('verif.section.identification'),
    sectionTextes: T('verif.section.textes'),
    sectionMotsCles: T('verif.section.motscles'),
    sectionAuteurs: T('verif.section.auteurs'),
    doiCalcule: T('verif.doi.calcule'), doiManuel: T('verif.doi.manuel'),
    // La feuille reprend les intitulés et l'ordre du formulaire, pour faciliter la
    // correction.
    type: T('fiches.type'), langue: T('fiches.langue.article'), licence: T('fiches.licence'),
    doi: 'DOI', titre: sansLangue(T('fiches.titre.champ')),
    sousTitre: sansLangue(T('fiches.soustitre')), resume: sansLangue(T('fiches.resume')),
    prenom: T('fiches.auteur.prenom'), nom: T('fiches.auteur.nom'),
    fonction: T('fiches.auteur.fonction'), affiliation: T('fiches.auteur.affiliation'),
    courriel: T('fiches.auteur.email'), orcid: T('fiches.auteur.orcid'),
    ror: T('fiches.auteur.ror')
  };
}

// Horodatage au format suisse : 07.10.2026 14:05.
function horodatageFeuille(quand) {
  const d = quand || new Date();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear()
    + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

// Lit le disque, écrit dans out/ et ouvre le navigateur. `panneau` reçoit un éventuel
// échec d'écriture ; il est absent depuis la vue « Articles », qui n'attend pas de réponse.
async function genererFeuilleVerif(fournisseur, filtre, panneau) {
  const racine = fournisseur.racine;
  const modele = verifMeta.construireModele(
    lireMetadonneesArticles(fournisseur, filtre), {
      numero: titreNumero(racine),
      horodatage: horodatageFeuille(),
      libelles: libellesFeuilleVerif(),
      textes: textesFeuilleVerif()
    });
  if (modele.total === 0) {
    vscode.window.setStatusBarMessage(T('verif.aucun'), 4000);
    return;
  }
  const cible = cheminFeuilleVerif(racine, filtre);
  try {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'print-templates', 'verification-meta.twig'), 'utf8');
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    ecrireAtomique(cible, verifMeta.rendre(source, modele));
  } catch (e) {
    const message = T('verif.err', [String((e && e.message) || e)]);
    if (panneau) { repondrePanneau(panneau, { type: MSG.ERREUR, message: message }); }
    else { vscode.window.showErrorMessage(message); }
    return;
  }
  await ouvrirAvecSysteme(cible, vscode);
  vscode.window.setStatusBarMessage(T('verif.ouverte', [modele.total]), 5000);
}

// Depuis le formulaire des fiches : ce que le panneau montre, filtre compris.
async function imprimerFeuilleVerif(fournisseur, panneau, msg) {
  if (!fournisseur || !fournisseur.racine) { return; }
  // Enregistrement d'abord. Un refus (numéro verrouillé, fiche périmée) arrête tout : la
  // feuille ne correspondrait pas à l'écran.
  if (msg && msg.articles && Object.keys(msg.articles).length) {
    if (refuserSiVerrouille()) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, filtreArticles, panneau);
    const refus = messageCartes(res);
    if (refus) {
      repondrePanneau(panneau, { type: MSG.ERREUR, message: refus });
      return;
    }
    repondrePanneau(panneau, { type: MSG.ENREGISTRE, n: res.n });
    relancerCompilationCartes(fournisseur, res);
  }
  await genererFeuilleVerif(fournisseur, filtreArticles, panneau);
}

// Depuis la vue « Articles » : tout le numéro, sans tenir compte du filtre des fiches.
//
// Les cartes en cours de saisie ne peuvent pas être enregistrées d'ici : s'il y en a, on
// le signale et on s'arrête.
async function imprimerFeuilleVerifTous(fournisseur) {
  if (!fournisseur || !fournisseur.racine) { return; }
  if (fichesModifie) {
    vscode.window.showInformationMessage(T('verif.nonenregistre'));
    return;
  }
  await genererFeuilleVerif(fournisseur, null, null);
}

// Sans item, l'article visé est celui du .md actif, à défaut celui en aperçu.
async function ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item) {
  if (!fournisseur.racine) { return; }
  let slug = (item && item.slug) ? String(item.slug) : null;
  if (!slug) {
    const ed = vscode.window.activeTextEditor;
    slug = ed ? ctx.slugDepuisChemin(fournisseur.racine, ed.document.uri.fsPath) : null;
  }
  if (!slug) { slug = session.apercuCourantSlug(); }
  if (!slug) {
    vscode.window.setStatusBarMessage(T('fiches.horsarticle'), 4000);
    return;
  }
  ctx.focaliserUnite(fournisseur, slug);
  // item.focus : un champ de la carte, voir ouvrirApercuMetadonnees.
  await ouvrirApercuMetadonnees(fournisseur, rafraichirTout, [slug], item && item.focus);
}

module.exports = {
  configurer,
  textesNumero, chargeNumero, ecrireChampsNumero, messageNumero,
  cheminMeta, migrerFrontmatterVersMeta, doisCalculesArticles, ecrireDoisCalcules,
  lireMetadonneesArticles, nettoyerCarte, ecrireCartesArticles, messageCartes,
  imprimerFeuilleVerifTous,
  relancerCompilationCartes, textesCarteArticle, textesAuteur, licencesTraduites, typesTraduits,
  lignesTitre, titreVersLignes, lignesVersTitre, textesLivre, chargeLivre, ecrireChampsLivre, messageLivre, couleursReference, filtreValide, signalerFichesPerimees, titreFiches,
  confirmerDoiManuel, ouvrirMetadonnees, ouvrirApercuMetadonnees, ouvrirMetadonneesArticle,
  basculerMarkdownFiche,
  limitesMedias, BUDGET_VIGNETTES, vignetteAuteur, envoyerAuteursConnus, envoyerMotsClesConnus,
  rafraichirMotsClesConnusEnFond, rafraichirAuteursPubliesEnFond,
  deposerPhotoAuteur, ouvrirVersionsPhoto, choisirPhotoAuteur, recalerPhotoOriginale
};
