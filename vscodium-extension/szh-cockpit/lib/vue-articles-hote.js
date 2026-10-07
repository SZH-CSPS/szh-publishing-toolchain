// La vue « Articles » d'un numéro (ou « Chapitres » d'un livre) : ses cartes, ses gestes, et
// « Envoyer à l'auteur » / « Voir le PDF », que l'arbre et la carte partagent.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { T, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const {
  LIBELLES_TYPES, LANGUES_META, analyserAusgabe, langueRevue, langueDefaut, titreNumero,
  normaliserLangueArticle, LICENCE_DEFAUT, LICENCES_ARTICLE, normaliserLicence
} = require('./yaml');
const { lireConfigPoste, CONFIG_POSTE } = require('./archivage');
const { modifierConfigPoste } = require('./reglages-hote');
const {
  CLE_SANS_DOI, deplacerArticle, prefixeOrdre, prefixeDossier, titreFiche,
  libelleArticle, basculerSansDoi, trierParDoi, refusDeplacement, rangDoi, resumeImages,
  libelleTache, vueArticlesConfig, configAvecVueArticles, resumeTaches, basculerTache
} = require('./articles');
const { doiCalcule, FORME_DOI } = require('./export-ojs');
const { lireAttributsImage } = require('./references');
const { citationsParArticle } = require('./journal');
const tableConstats = require('./constats');
const { refuserSiArchivee, refuserSiVerrouille } = require('./cycle-vie');
const { refusCoedition, noterLectureCoedition, libererCoedition } = require('./coedition-hote');
const { fermerTousLesApercus } = require('./apercu');
const { construireHtml } = require('./webviews/util');
const { panneauUnique, panneauCourant } = require('./webviews/panneau');
const metadonneesHote = require('./metadonnees-hote');
const {
  textesNumero, chargeNumero, messageNumero, imprimerFeuilleVerifTous, envoyerAuteursConnus
} = metadonneesHote;
const { adressesAuteurs, brouillonAuteur, uriMailto } = require('./courriel');
const { ouvrirAvecSysteme } = require('./ouvrir-systeme');
const { cibleTraduction } = require('./traduction-hote');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés par extension.js. Les valeurs par défaut permettent de charger ce module seul
// dans un test.
let ctx = {
  // Le mode « Changer l'ordre » : { racine, slugs } pendant qu'on réordonne, null sinon.
  ordreEnCours: () => null,
  poserModeOrdre: () => {},
  alignerDossiersSurOrdre: () => ({ erreur: 'lib/vue-articles-hote.js non configuré', renommes: 0 }),
  articlesSansDoi: () => new Set(),
  slugsSansDoiVoulu: () => [],
  tachesDuNumero: () => [],
  lireTachesArticle: () => ({ faites: [] }),
  ecrireTachesArticle: () => {},
  lireMetaArticle: () => ({}),
  compilerLivre: async () => {},
  tacheMakeArticle: () => null,
  lancerTacheObjet: async () => null,
  constatsCourants: () => [],
  contexteConstats: () => ({}),
  ecrireClesAusgabe: () => 'lib/vue-articles-hote.js non configuré',
  lireCouleurAccent: () => '',
  // Mode « Trad » : voir repondreModeTrad.
  repondreModeTrad: require('./traduction-hote').repondreModeTrad
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

const VUE = 'szhVueArticles';

function profilCourant() { return profils.courant(); }
function dossierUnites() { return profilCourant().unites.dossier; }
function cheminConfig(racine) { return path.join(racine, profilCourant().config); }
function cleOrdre() { return profilCourant().unites.ordre; }

// postMessage tolérant : le panneau peut être fermé pendant le traitement.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// ---- Vue « Articles » -----------------------------------------------------------
//
// La vue qui monte un numéro : l'ordre des articles, l'avancement de chacun et les
// métadonnées du numéro. Sa page (media/articles.*) réutilise les cartes et la barre des
// autres vues d'ensemble (SZH.listeCartes, SZH.barreBoutons) et le formulaire de la page
// « Méta-données du numéro » (SZH.formulaireNumero).

function textesArticles() {
  const livre = profilCourant().cle === 'livre';
  // Un livre monte le formulaire de buch.yaml (SZH.formulaireLivre) à la place de celui du
  // numéro ; tout le reste de la table est commun.
  const texte = Object.assign(livre ? metadonneesHote.textesLivre() : textesNumero(), {
    // « Ouvrir l'article » ici ; `vue.ouvrir` (« Ouvrir ») sert aux vues « Traductions » et
    // « Word en attente ».
    ouvrir: T('art.ouvrir'),
    ouvrirTip: T('art.ouvrir.tip'),
    // `listeVide` : `rien` est déjà pris (« Aucune modification ») dans la table du
    // formulaire du numéro, que celle-ci étend.
    listeVide: T('art.vue.rien'),
    // Le titre compact de l'encadré des tâches, sur chaque carte.
    tachesEntete: T('art.taches.entete'),
    tachesFr: T('art.taches.fr'),
    tachesDe: T('art.taches.de'),
    tachesAjouter: T('art.taches.ajouter'),
    tachesRetirer: T('art.taches.retirer'),
    tachesEnregistrer: T('form.enregistrer'),
    tachesEnregistrees: T('art.taches.enregistrees'),
    tachesFermer: T('art.taches.fermer'),
    // Les deux groupes de constats de l'encadré « À faire » : à regarder, puis bloquants.
    constatsAttention: T('art.constats.attention'),
    constatsDanger: T('art.constats.danger'),
    // Le chevron qui replie l'aperçu des métadonnées (basculeApercu, media/articles.js) :
    // ces libellés servent d'infobulle et d'aria-label. Le titre de la carte fait de même.
    metaVoir: T('art.meta.voir'),
    metaCacher: T('art.meta.cacher'),
    revues: { revue: T('meta.revue.revue'), zeitschrift: T('meta.revue.zeitschrift') }
  });
  // La case « pas de DOI », seul texte que la page écrit elle-même. Les intitulés et
  // valeurs de l'aperçu arrivent tout faits dans chaque ligne.
  if (profilCourant().capacites.doi) {
    Object.assign(texte, { doiCase: T('art.doi.case'), doiCaseTip: T('art.doi.case.tip') });
  }
  if (livre) {
    Object.assign(texte, {
      estLivre: true,
      ouvrir: T('chap.ouvrir'),
      ouvrirTip: T('chap.ouvrir.tip'),
      listeVide: T('chap.vue.rien')
    });
  }
  return texte;
}

function htmlArticles(nonce) {
  // Le formulaire du livre porte l'éditeur de personnes (responsables) : mêmes fragments que
  // la page « Métadonnées du livre » (lib/metadonnees-hote.js, htmlMetadonneesLivre).
  const livre = profilCourant().cle === 'livre';
  return construireHtml('articles', nonce, {
    cssPartage: ['_design.css', '_liste.css', '_numero.css'].concat(livre ? ['_auteurs.css'] : []),
    jsPartage: ['_messages.js'].concat(livre ? ['_auteurs.js'] : [], ['_numero.js']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'",
    titre: T(profilCourant().cle === 'livre' ? 'chap.vue.titre' : 'art.vue.titre'),
    remplacements: { '__TXT__': JSON.stringify(textesArticles()) }
  });
}

// Le pied d'une carte ne porte pas de pastille : les défauts des images sont dans les
// constats (constatsCarte), l'avancement des tâches dans l'entête « À faire »
// (resumeTachesLigne).

// Le résumé de l'avancement des tâches d'une carte, pour l'entête « À faire » :
// -> { texte, toutes }, ou null si la revue ne définit aucune tâche (pas de compteur).
function resumeTachesLigne(avance) {
  if (!avance || avance.total === 0) { return null; }
  return {
    texte: avance.toutes ? T('art.taches.toutes') : T('art.taches.avancement', [avance.faites, avance.total]),
    toutes: !!avance.toutes
  };
}

// ---- L'aperçu des métadonnées, sur la carte --------------------------------------
//
// En lecture seule, pour éviter les effacements par mégarde ; les boutons du pied ouvrent
// les formulaires. Une ligne par champ, un badge de langue, et le résumé et les mots-clés
// (seuls champs sans limite de longueur) coupés.
const APERCU_COURT = 90;      // titre, sous-titre : un titre de la revue tient là-dedans
const APERCU_LONG = 130;      // résumé, mots-clés : de quoi reconnaître, pas de quoi relire

function couperApercu(texte, limite) {
  const t = String(texte === undefined || texte === null ? '' : texte).replace(/\s+/g, ' ').trim();
  return t.length <= limite ? t : t.slice(0, limite - 1).replace(/\s+\S*$/, '') + '…';
}

// Une ligne « un intitulé, une valeur par langue », pour les seules langues remplies.
// `langues` restreint l'affichage (la langue de l'article quand « Cacher les traductions »
// est actif) ; la fiche n'est pas modifiée.
function ligneApercuLangues(libelle, map, limite, langues) {
  const valeurs = [];
  for (const l of (langues || LANGUES_META)) {
    const t = couperApercu((map || {})[l], limite);
    if (t !== '') { valeurs.push({ marque: l.toUpperCase(), texte: t }); }
  }
  return { libelle: libelle, valeurs: valeurs };
}

// Les mots-clés : une ligne par langue, avec le séparateur des listes du cockpit.
function ligneApercuMotsCles(meta, langues) {
  const plat = {};
  for (const l of LANGUES_META) {
    const liste = ((meta.keywords || {})[l] || []).map((x) => String(x).trim()).filter((x) => x !== '');
    if (liste.length > 0) { plat[l] = liste.join(' · '); }
  }
  return ligneApercuLangues(T('trad.champ.keywords'), plat, APERCU_LONG, langues);
}

// Les auteur·e·s : le nom, puis ce qui situe la personne, puis des badges pour ce que la
// fiche porte (ORCID, adresse, photo). Les valeurs ne s'affichent pas : une adresse n'a
// pas sa place dans un aperçu ouvert à l'écran.
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
      // « Prénom Nom », puis ce qui situe la personne après le point médian.
      texte: couperApercu([identite.join(' ')].concat(situe).filter((x) => x !== '').join(' · '),
        APERCU_LONG),
      marques: marques
    });
  }
  return { libelle: T('fiches.auteurs'), valeurs: valeurs };
}

// Le nom court de la licence (« CC-BY 4.0 »), tiré de lib/yaml.js, sauf pour « droits
// réservés », qui n'en a pas.
function nomCourtLicence(valeur) {
  const cle = normaliserLicence(valeur) || LICENCE_DEFAUT;
  if (cle === 'droits-reserves') { return T('art.apercu.licence.reservee'); }
  for (const l of LICENCES_ARTICLE) { if (l.cle === cle) { return l.nom; } }
  return '';
}

// Année du numéro : celle de la date de publication, sinon celle du nom du dossier
// (« 2027-03 »). La date reste vide jusqu'à la parution, et le DOI a besoin de l'année.
function anneeNumero(racine, valeurs) {
  const annee = (String((valeurs || {}).date || '').match(/\d{4}/) || [''])[0];
  if (annee !== '') { return annee; }
  return (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
}

// La ligne DOI de l'aperçu, et ce qu'il faut dire à côté. -> { ligne, constats }
//
// Le DOI se calcule : rang de l'article parmi ceux qui en reçoivent un, à partir de zéro
// (l'éditorial est « 00 »). Un doi écrit sur la fiche a été défini à la main (« Définir
// manuellement le DOI ») et part vers OJS à la place du calculé.
// La carte affiche celui qui part, étiqueté « manuel » ou « calculé ». Une divergence entre
// les deux devient un constat. FORME_DOI vient de lib/export-ojs.js.

function apercuDoi(locale, annee, numeroRevue, rang, doiFiche, voulu) {
  const fiche = String(doiFiche || '').trim();
  const constats = [];
  if (rang === -1) {
    // DOI manuel sur un article qui n'en reçoit pas : la ligne dit « aucun », et un
    // constat signale le doi resté sur la fiche.
    if (fiche !== '') { constats.push({ ton: 'attention', texte: T('art.doi.fiche.inutile', [fiche]) }); }
    return {
      ligne: { marque: '', texte: T(voulu ? 'art.doi.aucun.voulu' : 'art.doi.aucun.rubrique') },
      constats: constats
    };
  }
  const calcule = doiCalcule(locale, annee, numeroRevue, rang);
  if (fiche !== '') {
    // Le DOI manuel s'affiche tel quel. La divergence ne se signale que s'il y a deux
    // valeurs, avec la même distinction que l'export (FORME_DOI, lib/export-ojs.js) : une
    // forme étrangère à la revue n'a pas pu être déposée, une forme de la maison a pu l'être.
    if (calcule !== '' && fiche !== calcule) {
      const forme = FORME_DOI[locale];
      constats.push({ ton: 'attention', texte: (forme && !forme.motif.test(fiche))
        ? T('art.doi.forme', [forme.exemple])
        : T('art.doi.fiche.autre', [fiche, calcule]) });
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

// L'état des images de l'article, lu comme le gestionnaire des médias (lireAttributsImage
// de lib/references.js, fichiers de media/). Les portraits (portraits/) n'en font pas partie.
function resumeImagesArticle(fournisseur, slug) {
  const md = path.join(fournisseur.racine, dossierUnites(), slug, slug + '.md');
  let texte = '';
  try { texte = fs.readFileSync(md, 'utf8'); } catch (e) { return resumeImages([]); }
  return resumeImages(fournisseur._imagesArticle(slug).map((relatif) => {
    const v = lireAttributsImage(texte, relatif);
    return { relatif: relatif, legende: v.legende, alt: v.alt,
             altDefini: v.altDefini, horsFigure: v.horsFigure };
  }));
}

// Les constats de l'encadré « À faire » de la carte : images incomplètes, puis état des
// références à la dernière compilation. Le ton vient de lib/constats.js, comme dans la
// liste « À corriger ».
//
// La carte résume (un constat par famille de défaut, avec son compte) ; la liste détaille
// (un constat par image ou par appel). L'intitulé est le même des deux côtés. Pas de
// bouton ici : ceux du pied de carte mènent aux formulaires où l'on corrige.
function constatsCarte(images, citations, contexte) {
  const constats = [];
  const langue = langueCockpit();
  const ajouter = (code, compte) => {
    if (compte <= 0) { return; }
    const brut = { source: 'cockpit', code: code, slug: '', champs: {}, args: [] };
    constats.push({ ton: tableConstats.ton(brut, contexte),
                    texte: tableConstats.phrase(brut, langue) + ' (' + compte + ')' });
  };
  ajouter('image-sans-alt', images.sansAlt);
  ajouter('image-sans-legende', images.sansLegende);
  const c = citations || null;
  if (c) {
    // Les codes de citations de la chaîne, avec l'intitulé et le ton de la liste ; le compte
    // remplace l'énumération des appels.
    for (const code of ['appel-sans-reference', 'appel-ambigu', 'reference-orpheline']) {
      if (c[code] > 0) {
        const brut = { source: 'citations', code: code, slug: '', champs: {}, args: [] };
        constats.push({ ton: tableConstats.ton(brut, contexte),
                        texte: tableConstats.phrase(brut, langue) + ' (' + c[code] + ')' });
      }
    }
  }
  return constats;
}

// L'aperçu complet d'un article : neuf lignes, dans l'ordre de lecture (ce qu'est
// l'article, ce qu'il dit, qui l'a écrit, ses conditions de parution).
//
// `langueSeule` (code de la langue de l'article, ou '') réduit les quatre lignes bilingues
// à cette langue : c'est le bouton « Cacher les traductions ».
function apercuArticle(meta, langue, doi, langueSeule) {
  const type = String(meta.type || '').trim();
  const langueArticle = normaliserLangueArticle(meta.lang);
  const vide = T('art.apercu.vide');
  // Une langue inconnue, ou aucune, ne restreint rien.
  const langues = LANGUES_META.indexOf(langueSeule) !== -1 ? [langueSeule] : LANGUES_META;
  const seule = (libelle, texte) => ({
    libelle: libelle,
    valeurs: [{ marque: '', texte: String(texte || '') !== '' ? String(texte) : vide }]
  });
  return {
    lignes: [
      seule(T('art.apercu.type'), (LIBELLES_TYPES[type] || {})[langue] || type),
      seule(T('art.apercu.langue'),
        langueArticle === '' ? T('art.apercu.langue.numero') : T('meta.langue.' + langueArticle)),
      ligneApercuLangues(T('trad.champ.title'), meta.title, APERCU_COURT, langues),
      ligneApercuLangues(T('trad.champ.subtitle'), meta.subtitle, APERCU_COURT, langues),
      ligneApercuLangues(T('trad.champ.resume'), meta.resume, APERCU_LONG, langues),
      ligneApercuMotsCles(meta, langues),
      ligneApercuAuteurs(meta),
      seule(T('art.apercu.licence'), nomCourtLicence(meta.licence)),
      { libelle: T('art.apercu.doi'), valeurs: [doi] }
    ].map((l) => (l.valeurs.length > 0 ? l : { libelle: l.libelle, valeurs: [{ marque: '', texte: vide }] }))
  };
}

// Le bandeau d'une unité dans le mode « Changer l'ordre » (articles ou chapitres) : son
// titre au rang à venir, et ses deux flèches. `titre` est celui de la fiche, sans numéro.
function bandeauOrdre(slug, index, slugs, titre) {
  const nom = titre || slug;
  return {
    cle: slug,
    // Le rang à venir, que « Terminer » écrira, et non le préfixe actuel du dossier.
    titre: libelleArticle(prefixeOrdre(index), slug, titre),
    ouvrir: false,
    actions: [],
    constats: [],
    taches: [],
    // Le rang visé vient de prefixeOrdre(), comme pour le DOI et l'arbre. En bord de
    // liste, le bouton reçoit l'aria-label générique.
    ordre: {
      monter: {
        desactive: index === 0,
        tip: T('art.monter.tip'),
        ariaLabel: index === 0 ? T('art.monter.tip')
          : T('art.ordre.aria.monter', [nom, prefixeOrdre(index - 1)])
      },
      descendre: {
        desactive: index === slugs.length - 1,
        tip: T('art.descendre.tip'),
        ariaLabel: index === slugs.length - 1 ? T('art.descendre.tip')
          : T('art.ordre.aria.descendre', [nom, prefixeOrdre(index + 1)])
      }
    }
  };
}

// L'aperçu d'une carte de chapitre : cinq lignes de <slug>.meta.yaml (titre, sous-titre,
// auteurs, résumé, hors sommaire). Les lignes bilingues se réduisent à la langue du livre,
// sauf si la fiche n'a rien dans cette langue.
function apercuChapitre(meta, langueLivre) {
  const langues = (map) => {
    const m = map || {};
    return String(m[langueLivre] || '').trim() !== '' ? [langueLivre] : LANGUES_META;
  };
  const ligne = (libelle, map, limite) => ligneApercuLangues(libelle, map, limite, langues(map));
  return {
    lignes: [
      ligne(T('trad.champ.title'), meta.title, APERCU_COURT),
      ligne(T('trad.champ.subtitle'), meta.subtitle, APERCU_COURT),
      ligneApercuAuteurs(meta),
      ligne(T('trad.champ.resume'), meta.resume, APERCU_LONG),
      { libelle: T('chap.apercu.sommaire'),
        valeurs: [{ marque: '', texte: T(meta.horsSommaire ? 'chap.apercu.oui' : 'chap.apercu.non') }] }
    ].map((l) => (l.valeurs.length > 0 ? l
      : { libelle: l.libelle, valeurs: [{ marque: '', texte: T('art.apercu.vide') }] }))
  };
}

// La vue CHAPITRES : les cartes de la vue ARTICLES (SZH.listeCartes), sans DOI, tâches ni
// traductions. L'ordre vient d'ordre-chapitres (buch.yaml, via listerArticles), le titre de
// la fiche. Les trois boutons de la barre portent sur le livre entier ; la page monte le
// formulaire du livre en tête.
function chargeChapitres(fournisseur) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const interface_ = langueCockpit();
  const vue = vueArticlesConfig(lireConfigPoste());
  // Mode « Changer l'ordre » : rien n'est écrit avant « Terminer », qui renomme les dossiers
  // et écrit ordre-chapitres dans buch.yaml.
  const enOrdre = ctx.ordreEnCours(racine);
  const slugs = enOrdre || fournisseur.listerArticles();
  const lignes = slugs.map((slug, index) => {
    const meta = ctx.lireMetaArticle(racine, slug);
    const titre = titreFiche(meta, langue);
    if (enOrdre) { return bandeauOrdre(slug, index, slugs, titre); }
    return {
      cle: slug,
      titre: libelleArticle(prefixeDossier(slug), slug, titre),
      ouvrir: false,
      apercu: apercuChapitre(meta, langue),
      // Sans titre, la compilation du chapitre est refusée : la carte le signale.
      constats: titre === '' ? [{ ton: 'danger', texte: T('art.sansfiche') }] : [],
      actions: [
        { id: 'metadonnees', libelle: T('art.meta.editer'), icone: 'info',
          tip: T('art.meta.editer.tip') },
        { id: 'medias', libelle: T('art.medias.editer'), icone: 'camera',
          tip: T('art.medias.editer.tip') },
        { id: 'ouvrir', libelle: T('chap.ouvrir'), icone: 'fleche', tip: T('chap.ouvrir.tip') }
      ],
      taches: []
    };
  });
  return {
    titre: T('chap.vue.titre'),
    livre: true,
    boutons: (enOrdre ? [
      // Dans le mode, la barre ne propose que d'en sortir.
      { id: 'ordre-terminer', groupe: 'action', libelle: T('art.ordre.terminer'), icone: 'ok',
        principal: true, tip: T('art.ordre.terminer.tip') },
      { id: 'ordre-annuler', groupe: 'action', libelle: T('art.ordre.annuler'), icone: 'fermer',
        tip: T('art.ordre.annuler.tip') }
    ] : [
      // Pour un livre, seul l'interrupteur « replier l'aperçu » a un sens.
      { id: 'cacher-meta', groupe: 'filtre', actif: !vue.cacherMeta,
        icone: vue.cacherMeta ? 'oeil-ferme' : 'oeil',
        libelle: T('art.meta.bouton'),
        tip: T(vue.cacherMeta ? 'art.meta.voir.tip' : 'art.meta.cacher.tip') },
      // Les trois actions sur le livre entier ; un clic sur un chapitre ne compile que lui.
      { id: 'livre-compiler', groupe: 'action', libelle: T('chap.bouton.compiler'), icone: 'ok',
        principal: true, tip: T('chap.bouton.compiler.tip') },
      { id: 'livre-pdf', groupe: 'action', libelle: T('chap.bouton.pdf'), icone: 'fleche',
        tip: T('chap.bouton.pdf.tip') },
      { id: 'livre-couverture', groupe: 'action', libelle: T('chap.bouton.couverture'),
        icone: 'camera', tip: T('chap.bouton.couverture.tip') },
      { id: 'ordre', groupe: 'action', libelle: T('art.ordre.mode'), icone: 'liste',
        tip: T('art.ordre.mode.tip') }
    ]),
    ordre: !!enOrdre,
    metaRepliees: vue.cacherMeta,
    lignes: lignes
  };
}

// « Paginer » et « Exporter pour OJS », selon les capacités du profil et l'état du numéro.
function boutonsFinNumero() {
  const cap = profilCourant().capacites;
  const etat = session.etatNumero();
  const boutons = [];
  if (cap.pagination && !etat.verrouillee && !etat.archivee) {
    boutons.push({ id: 'paginer', groupe: 'action', libelle: T('art.bouton.paginer'),
      icone: 'imprimante', tip: T('action.pagination.tip') });
  }
  if (cap.ojs) {
    boutons.push({ id: 'exporter-ojs', groupe: 'action', libelle: T('art.bouton.ojs'),
      icone: 'fleche', tip: T('art.bouton.ojs.tip') });
  }
  return boutons;
}

// Une carte par article, dans l'ordre du numéro : nom, aperçu des métadonnées, tâches
// cochables et constats. Les boutons du pied ouvrent les formulaires, seuls à écrire. Dans
// le mode « Changer l'ordre », la carte se réduit à un bandeau à flèches.
function chargeArticles(fournisseur) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const interface_ = langueCockpit();
  // Même contexte que la liste « À corriger » pour le ton des constats (validation PDF/UA
  // active ou non sur ce poste).
  const contexte = ctx.contexteConstats();
  // La configuration du poste : intitulés des tâches et interrupteurs d'affichage.
  const configPoste = lireConfigPoste();
  // Ce que les interrupteurs cachent n'est pas envoyé (plutôt que masqué en CSS).
  const vue = vueArticlesConfig(configPoste);
  const taches = ctx.tachesDuNumero(racine);
  // Dans le mode « Changer l'ordre », l'ordre affiché est celui en cours, encore en mémoire.
  const enOrdre = ctx.ordreEnCours(racine);
  const slugs = enOrdre || fournisseur.listerArticles();
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : le DOI sera dit incalculable, ce qui est vrai */ }
  const locale = langueDefaut(valeurs);
  const annee = anneeNumero(racine, valeurs);
  const numeroRevue = String(valeurs.numero || '').trim();
  // Fiches lues une fois : titre, aperçu, et rubriques sans DOI (qui décident de l'ordre).
  const metas = {};
  const types = {};
  for (const slug of slugs) {
    metas[slug] = ctx.lireMetaArticle(racine, slug);
    types[slug] = metas[slug].type;
  }
  // `voulus` : les articles cochés « pas de DOI » ; `sansDoi` y ajoute ceux dont la
  // rubrique n'en reçoit pas. Une case cochée par la rubrique est verrouillée.
  const voulus = new Set(ctx.slugsSansDoiVoulu(racine));
  const sansDoi = ctx.articlesSansDoi(racine, slugs, { types: types, voulus: [...voulus] });
  const citations = citationsParArticle(ctx.constatsCourants(racine));
  // Le DOI effectif de chaque article (celui de la fiche, sinon le calculé, comme collecter()
  // de lib/export-ojs.js), calculé avant les cartes pour signaler un doublon des deux côtés.
  const effectifs = {};
  for (const slug of slugs) {
    const fiche = String((metas[slug] && metas[slug].doi) || '').trim();
    effectifs[slug] = fiche !== ''
      ? fiche : doiCalcule(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi));
  }
  const parDoiEffectif = {};
  for (const slug of slugs) {
    const v = effectifs[slug];
    if (!v) { continue; }
    if (!parDoiEffectif[v]) { parDoiEffectif[v] = []; }
    parDoiEffectif[v].push(slug);
  }
  const lignes = slugs.map((slug, index) => {
    const meta = metas[slug];
    const titre = titreFiche(meta, langue);
    // Mode « Changer l'ordre » : la carte n'est qu'un bandeau (decorerBandeauOrdre,
    // media/articles.js), sans aperçu, DOI ni constats.
    if (enOrdre) { return bandeauOrdre(slug, index, slugs, titre); }
    const faites = ctx.lireTachesArticle(racine, slug).faites;
    const avance = resumeTaches(taches, faites);
    const images = resumeImagesArticle(fournisseur, slug);
    const doi = apercuDoi(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi),
      meta.doi, voulus.has(slug));
    const constats = doi.constats.concat(constatsCarte(images, citations.get(slug), contexte));
    // Un DOI qui désigne aussi un autre article : les deux cartes le disent, chacune
    // nommant l'autre.
    const autresMemeDoi = (parDoiEffectif[effectifs[slug]] || []).filter((s) => s !== slug);
    // Bloquant : l'export refuse deux articles au même DOI (ojs.err.doi.double).
    if (autresMemeDoi.length > 0) {
      constats.push({ ton: 'danger', texte: T('art.doi.double', [autresMemeDoi[0]]) });
    }
    // Un article sans titre reste dans la liste, nommé par son slug. Bloquant : sa
    // compilation est refusée.
    if (titre === '') { constats.unshift({ ton: 'danger', texte: T('art.sansfiche') }); }
    return {
      cle: slug,
      // Le numéro du dossier, pas le rang dans l'ordre : il sert à retrouver l'article dans
      // l'Explorateur. Un dossier sans préfixe n'affiche pas de numéro (libelleArticle).
      titre: libelleArticle(prefixeDossier(slug), slug, titre),
      // Le slug s'affiche en infobulle du titre, à partir de `cle` (media/articles.js).
      // Le bouton « Ouvrir » est ajouté en dernier dans `actions`, pas en tête par le
      // composant.
      ouvrir: false,
      // La langue de l'article, sinon celle du numéro : le même repli que la compilation.
      apercu: apercuArticle(meta, interface_, doi.ligne,
        vue.cacherTraductions ? (normaliserLangueArticle(meta.lang) || langue) : ''),
      // Les constats sont toujours calculés (la frontière du DOI en dépend), mais ne sont
      // envoyés que si l'interrupteur les montre.
      constats: vue.cacherConstats ? [] : constats,
      // La case « pas de DOI », verrouillée quand la rubrique décide.
      sansDoi: {
        coche: sansDoi.has(slug),
        verrouille: !voulus.has(slug) && sansDoi.has(slug)
      },
      // L'avancement des tâches, pour l'entête « À faire ».
      tachesResume: resumeTachesLigne(avance),
      // Les boutons du pied, dans l'ordre du travail : formulaires, envoi à l'auteur,
      // ouverture. Le classement se fait dans le mode « Changer l'ordre ».
      actions: [
        { id: 'metadonnees', libelle: T('art.meta.editer'), icone: 'info',
          tip: T('art.meta.editer.tip') },
        { id: 'medias', libelle: T('art.medias.editer'), icone: 'camera',
          tip: T('art.medias.editer.tip') },
        { id: 'envoyer', libelle: T('art.envoyer'), icone: 'traduction', tip: T('art.envoyer.tip') },
        { id: 'ouvrir', libelle: T('art.ouvrir'), icone: 'fleche', tip: T('art.ouvrir.tip') }
      ],
      taches: vue.cacherTaches ? [] : taches.map((t) => ({
        id: t.id, libelle: libelleTache(t, interface_), faite: faites.indexOf(t.id) !== -1
      }))
    };
  });
  return {
    titre: T('art.vue.titre'),
    boutons: [
      // Les quatre interrupteurs d'affichage, sur la ligne du haut : media/articles.js range
      // les boutons `groupe: 'filtre'` en haut, les autres en bas. Le libellé nomme ce qui
      // s'affiche ; `actif` dit si c'est visible (fond plein, œil ouvert, aria-pressed :
      // boutonCommande, media/_commun.js). L'infobulle dit ce que fera le clic.
      //
      // La configuration retient ce qui est caché (cacherTaches…) : `actif` en est la
      // négation.
      { id: 'cacher-taches', groupe: 'filtre', actif: !vue.cacherTaches,
        icone: vue.cacherTaches ? 'oeil-ferme' : 'oeil',
        libelle: T('art.taches.bouton'),
        tip: T(vue.cacherTaches ? 'art.taches.afficher.tip' : 'art.taches.cacher.tip') },
      { id: 'cacher-traductions', groupe: 'filtre', actif: !vue.cacherTraductions,
        icone: vue.cacherTraductions ? 'oeil-ferme' : 'oeil',
        libelle: T('art.trad.bouton'),
        tip: T(vue.cacherTraductions ? 'art.trad.afficher.tip' : 'art.trad.cacher.tip') },
      { id: 'cacher-meta', groupe: 'filtre', actif: !vue.cacherMeta,
        icone: vue.cacherMeta ? 'oeil-ferme' : 'oeil',
        libelle: T('art.meta.bouton'),
        tip: T(vue.cacherMeta ? 'art.meta.voir.tip' : 'art.meta.cacher.tip') },
      { id: 'cacher-constats', groupe: 'filtre', actif: !vue.cacherConstats,
        icone: vue.cacherConstats ? 'oeil-ferme' : 'oeil',
        libelle: T('art.constats.bouton'),
        tip: T(vue.cacherConstats ? 'art.constats.afficher.tip' : 'art.constats.cacher.tip') }
    ].concat(enOrdre
      // Dans le mode, la barre ne propose que d'en sortir. Ces boutons sont des actions :
      // ligne du bas (`groupe: 'action'`).
      ? [{ id: 'ordre-terminer', groupe: 'action', libelle: T('art.ordre.terminer'), icone: 'ok',
           principal: true, tip: T('art.ordre.terminer.tip') },
         { id: 'ordre-annuler', groupe: 'action', libelle: T('art.ordre.annuler'), icone: 'fermer',
           tip: T('art.ordre.annuler.tip') }]
      : [{ id: 'ordre', groupe: 'action', libelle: T('art.ordre.mode'), icone: 'liste',
           tip: T('art.ordre.mode.tip') }])
      // La feuille de vérification de tout le numéro (le formulaire des fiches tire celle
      // d'un article). Dernier bouton de la ligne des actions.
      //
      // Absent du mode « Changer l'ordre » : « Terminer » va renommer les dossiers, et la
      // feuille porterait des slugs et une empreinte périmés.
      .concat(enOrdre ? [] : [{ id: 'verif-meta', groupe: 'action', libelle: T('verif.bouton'),
                 icone: 'imprimante', tip: T('verif.tous.tip') }])
      // Les deux actions de fin de numéro. Paginer disparaît sur un numéro gelé
      // (rafraichirPagination le refuse) ; l'export OJS reste.
      .concat(enOrdre ? [] : boutonsFinNumero()),
    // La page gèle ce qui n'a pas de sens pendant qu'on réordonne.
    ordre: !!enOrdre,
    // L'aperçu est toujours envoyé : l'interrupteur ne fixe que l'état de départ des
    // cartes, et le chevron de chacune la déplie sans passer par l'hôte.
    metaRepliees: vue.cacherMeta,
    lignes: lignes
  };
}

// Les types de message que traite actionArticle. Un type inconnu est écarté avant, sans
// recharger la liste.
const TYPES_ACTION_ARTICLE = [MSG.COMMANDE, MSG.TACHE, MSG.SANSDOI, MSG.ACTION];

// Les actions de la vue. -> le message à afficher dans la barre, ou null.
async function actionArticle(fournisseur, rafraichirTout, msg) {
  const racine = fournisseur.racine;
  if (msg.type === MSG.COMMANDE) {
    // Les trois actions sur le livre entier (vue CHAPITRES). Compiler recompose tout le
    // livre, ce que le clic sur un chapitre ne fait pas.
    if (msg.id === 'livre-compiler') { await ctx.compilerLivre(fournisseur); return null; }
    if (msg.id === 'livre-pdf') { await vscode.commands.executeCommand('szh.apercuLivre'); return null; }
    if (msg.id === 'livre-couverture') { await vscode.commands.executeCommand('szh.livreCouverture'); return null; }
    if (msg.id === 'verif-meta') { await imprimerFeuilleVerifTous(fournisseur); return null; }
    // Fin de numéro : les commandes gardent leurs propres refus (gel, compilation en cours).
    if (msg.id === 'paginer') { await vscode.commands.executeCommand('szh.rafraichirPagination'); return null; }
    if (msg.id === 'exporter-ojs') { await vscode.commands.executeCommand('szh.exporterXml'); return null; }
    // Les quatre interrupteurs d'affichage : un réglage du poste, que le verrou du numéro
    // n'empêche pas.
    // Le mode « Changer l'ordre ». Entrer et sortir n'écrit rien ; seul « Terminer »
    // renomme, et d'un seul lot.
    if (msg.id === 'ordre') {
      if (refuserSiVerrouille()) { return null; }
      ctx.poserModeOrdre({ racine: racine, slugs: fournisseur.listerArticles() });
      return null;
    }
    if (msg.id === 'ordre-annuler') { ctx.poserModeOrdre(null); return null; }
    if (msg.id === 'ordre-terminer') {
      const voulu = ctx.ordreEnCours(racine);
      ctx.poserModeOrdre(null);
      if (!voulu) { return null; }
      const r = ctx.alignerDossiersSurOrdre(racine, voulu);
      if (r.erreur) { return T('art.ordre.echec', [r.erreur]); }
      if (rafraichirTout) { rafraichirTout(); }
      return r.renommes === 0 ? null : T('art.ordre.fait', [r.renommes]);
    }
    const bascules = {
      'cacher-taches': 'cacherTaches',
      'cacher-traductions': 'cacherTraductions',
      'cacher-constats': 'cacherConstats',
      'cacher-meta': 'cacherMeta'
    };
    const cle = bascules[String(msg.id || '')];
    if (cle) {
      const erreur = modifierConfigPoste((avant) => configAvecVueArticles(avant, cle, !vueArticlesConfig(avant)[cle]));
      if (erreur) { return T('err.ecriture', [path.basename(CONFIG_POSTE), erreur]); }
      return null;                                 // la vue se repose, les cartes suivent
    }
    return null;
  }
  if (msg.type === MSG.TACHE) {
    if (refuserSiVerrouille()) { return null; }
    const slug = String(msg.cle || '');
    if (fournisseur.listerArticles().indexOf(slug) === -1) { return null; }
    const taches = ctx.tachesDuNumero(racine);
    const suivi = ctx.lireTachesArticle(racine, slug);
    const faites = basculerTache(suivi.faites, String(msg.id || ''), !!msg.cochee, taches);
    try { ctx.ecrireTachesArticle(racine, slug, { faites: faites, _inconnues: suivi._inconnues }); }
    catch (e) { return T('err.ecriture', [slug + '.taches.yaml', String((e && e.message) || e)]); }
    if (rafraichirTout) { rafraichirTout(); }      // l'arbre porte le même avancement
    const avance = resumeTaches(taches, faites);
    return { dit: T('art.taches.avancement', [avance.faites, avance.total]),
             avancement: { cle: slug,
                           // Seul le compteur de l'entête est mis à jour : reconstruire la
                           // carte ferait perdre le focus clavier de la case.
                           tachesResume: resumeTachesLigne(avance) } };
  }
  // La case « pas de DOI » : l'article ne reçoit pas de DOI et passe en fin de numéro,
  // donc l'ordre est réécrit en même temps. Comme pour les déplacements : refusée sur un
  // numéro archivé, acceptée sur un numéro verrouillé.
  if (msg.type === MSG.SANSDOI) {
    if (refuserSiArchivee()) { return null; }
    const slug = String(msg.cle || '');
    const slugs = fournisseur.listerArticles();
    if (slugs.indexOf(slug) === -1) { return null; }
    const voulus = basculerSansDoi(ctx.slugsSansDoiVoulu(racine), slug, !!msg.coche, slugs);
    const modifies = {};
    modifies[CLE_SANS_DOI] = voulus;
    // L'ordre est écrit aussi : listerArticles() applique la règle à la lecture, mais le
    // fichier se lit aussi à la main.
    modifies[cleOrdre()] = trierParDoi(slugs, ctx.articlesSansDoi(racine, slugs, { voulus: voulus }));
    // Un clic isolé ne prend pas de bail : il s'abstient si quelqu'un modifie ausgabe.yaml.
    const refusBail = refusCoedition(racine, cheminConfig(racine));
    if (refusBail) { return refusBail; }
    const erreur = ctx.ecrireClesAusgabe(racine, modifies);
    if (erreur) { return T('err.ecriture', ['ausgabe.yaml', erreur]); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('art.doi.enregistre', [voulus.length]);
  }
  if (msg.type !== MSG.ACTION) { return null; }
  const slug = String(msg.cle || '');
  if (msg.id === 'envoyer') {
    await envoyerAuteur(fournisseur, { slug: slug });
    return null;
  }
  // Les deux formulaires de l'article, ouverts par leur commande, qui réutilise le panneau
  // existant et vérifie le verrou.
  if (msg.id === 'metadonnees') {
    await vscode.commands.executeCommand('szh.metadonneesArticle', { slug: slug });
    return null;
  }
  if (msg.id === 'medias') {
    await vscode.commands.executeCommand('szh.mediasArticle', { slug: slug });
    return null;
  }
  if (msg.id !== 'monter' && msg.id !== 'descendre') { return null; }
  // Dans le mode, le déplacement reste en mémoire jusqu'à « Terminer ».
  const enOrdre = ctx.ordreEnCours(fournisseur.racine);
  if (enOrdre) {
    ctx.poserModeOrdre({ racine: fournisseur.racine,
      slugs: deplacerArticle(enOrdre, slug, msg.id === 'monter' ? -1 : 1) });
    return null;
  }
  return deplacerUnite(fournisseur, slug, msg.id === 'monter' ? -1 : 1, rafraichirTout);
}

// La réponse de deplacerUnite() dans la barre d'état ; null n'affiche rien.
function messageDeplacement(message) {
  if (message) { vscode.window.setStatusBarMessage(message, 4000); }
}

// Déplace une unité d'un cran dans le sommaire (article ou chapitre), pour la vue en
// cartes et le menu contextuel de l'arbre. Rend le message à afficher, ou null (par
// exemple en bout de liste).
function deplacerUnite(fournisseur, slug, delta, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return null; }
  // refuserSiArchivee() et non refuserSiVerrouille() : un numéro verrouillé a ses textes
  // figés, mais son sommaire peut encore changer.
  if (refuserSiArchivee()) { return null; }
  const slugs = fournisseur.listerArticles();
  if (slugs.indexOf(slug) === -1) { return null; }
  // Un déplacement qui franchit la frontière DOI / sans DOI est refusé, avec un message.
  // Un livre n'a pas cette frontière.
  const refus = refusDeplacement(slugs, slug, delta, ctx.articlesSansDoi(racine, slugs));
  if (refus === 'frontiere') { return T('art.ordre.frontiere'); }
  if (refus !== '') { return null; }
  const nouveau = deplacerArticle(slugs, slug, delta);
  if (nouveau.join(' ') === slugs.join(' ')) { return null; }   // déjà au bord
  // La liste entière est écrite dans le fichier de configuration.
  const modifies = {};
  modifies[cleOrdre()] = nouveau;
  const refusBail = refusCoedition(racine, cheminConfig(racine));
  if (refusBail) { return refusBail; }             // quelqu'un modifie le fichier en ce moment
  const erreur = ctx.ecrireClesAusgabe(racine, modifies);
  if (erreur) { return T('err.ecriture', ['ausgabe.yaml', erreur]); }
  if (rafraichirTout) { rafraichirTout(); }
  return T('art.ordre.enregistre', [prefixeOrdre(nouveau.indexOf(slug))]);
}

// Panneau unique : rouvrir la commande révèle celui qui existe, valeurs relues du disque.
async function ouvrirVueArticles(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Ouvrir la vue ferme l'aperçu de la colonne 2 (HTML ou PDF), comme la vue Métadonnées.
  // Les rafraîchissements passent par envoyerVue et ne ferment rien.
  await fermerTousLesApercus();
  // Un livre montre ses chapitres et le formulaire de buch.yaml, sans couverture-image ni DOI
  // (chargeChapitres) ; une revue, ses articles et le formulaire du numéro.
  const livre = profilCourant().cle === 'livre';
  const envoyer = (panneau, avecCouverture) => {
    const charge = livre ? chargeChapitres(fournisseur) : chargeArticles(fournisseur);
    repondrePanneau(panneau, Object.assign({ type: MSG.VALEURS }, charge,
      livre ? metadonneesHote.chargeLivre(racine) : chargeNumero(racine, avecCouverture),
      { accent: ctx.lireCouleurAccent(racine) }));
    // L'autocomplétion des responsables du livre, comme sur la page « Métadonnées du livre ».
    if (livre) { envoyerAuteursConnus(panneau, racine); }
    panneau.title = charge.titre;
    noterLectureCoedition(panneau, racine, cheminConfig(racine));
  };
  // Le formulaire du numéro d'abord, le même que la page « Méta-données du numéro ». Le bail
  // sur ausgabe.yaml se prend à la première écriture (messageNumero), pas à l'ouverture.
  const messageVue = async (panneau, msg) => {
    const recharger = () => envoyer(panneau, false);
    // messageLivre rend une promesse pour le dépôt de l'illustration et le bouton « 4e de
    // couverture » : on l'attend, comme le fait la page « Métadonnées du livre ».
    if (livre ? await metadonneesHote.messageLivre(panneau, racine, msg, rafraichirTout, recharger)
      : messageNumero(panneau, racine, msg, rafraichirTout, recharger)) { return; }
    if (msg.type === MSG.OUVRIR) {
      // Par la commande. sansApercu : seul le .md s'ouvre, sans compilation ni aperçu.
      await vscode.commands.executeCommand('szh.ouvrirArticle', String(msg.cle || ''),
        { sansApercu: true });
      return;
    }
    // Un type inconnu n'atteint pas actionArticle, pour ne pas recharger toute la liste.
    if (TYPES_ACTION_ARTICLE.indexOf(msg.type) === -1) {
      console.warn('vue Articles : type de message inconnu', msg.type);
      return;
    }
    // L'état part après le re-rendu, car « valeurs » efface la zone d'état.
    let dit = null;
    let avancement = null;
    try {
      const reponse = await actionArticle(fournisseur, rafraichirTout, msg);
      // Cocher une tâche rend un avancement, les autres gestes une phrase.
      if (reponse && typeof reponse === 'object') { dit = reponse.dit; avancement = reponse.avancement; }
      else { dit = reponse; }
    } catch (e) { dit = T('err.commande', [e && e.message ? e.message : String(e)]); }
    if (panneauCourant(VUE) !== panneau) { return; }
    // Une case cochée ne met à jour que son compteur : « valeurs » reconstruirait la liste
    // et le focus clavier quitterait la case.
    if (avancement) { repondrePanneau(panneau, Object.assign({ type: MSG.AVANCEMENT }, avancement)); }
    else { envoyer(panneau); }
    if (dit) { repondrePanneau(panneau, { type: MSG.ETAT, message: dit }); }
  };
  const { panneau, nouveau } = panneauUnique({
    viewType: VUE,
    titre: T(livre ? 'chap.vue.titre' : 'art.vue.titre'),
    // Mode « Trad » : voir repondreModeTrad.
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlArticles,
    surPret: (msg, p) => envoyer(p, true),
    surMessage: (msg, p) => messageVue(p, msg),
    surFermeture: (p) => libererCoedition(p)
  });
  // Déjà ouverte : la fabrique l'a révélée sans la recréer, et ses valeurs sont relues du disque.
  if (!nouveau) { envoyer(panneau, true); }
}

// ---- « Envoyer à l'auteur » -----------------------------------------------------
//
// Compile le PDF de l'article, ouvre un brouillon adressé, et met le PDF au presse-papiers.
//
// Le brouillon passe par `mailto:` (ouvert par le nouvel Outlook), qui ne porte pas de
// pièce jointe. Le PDF est posé au presse-papiers en CF_HDROP (`Set-Clipboard
// -LiteralPath`) : un Ctrl+V dans le brouillon l'attache. Le corps ne peut pas passer par
// le même presse-papiers, car Outlook prendrait le fichier et perdrait le texte. Un .eml
// n'est pas utilisé : Windows n'a pas d'application associée sûre pour l'ouvrir.
//
// La notification dit de coller, et propose le dossier du PDF si le presse-papiers est
// refusé. Le corps de l'e-mail part tel quel à l'auteur.

// Met le PDF au presse-papiers comme fichier (vscode.env.clipboard n'écrit que du texte).
// Le chemin passe par une variable d'environnement, pour n'avoir rien à échapper.
// -> true si PowerShell est sorti sans erreur.
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
    // Un minuteur borne l'attente de PowerShell ; il est levé dès que PowerShell répond.
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

async function envoyerAuteur(fournisseur, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const slug = cibleTraduction(fournisseur, cible).slug;
  if (!slug || fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Le PDF d'abord, recompilé sur le texte actuel.
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('art.envoi.compilation', [slug]));
  let code = null;
  try { code = await ctx.lancerTacheObjet(ctx.tacheMakeArticle(racine, slug)); }
  finally { statut.dispose(); session.poserBuildEnCours(false); }
  const pdf = path.join(racine, 'out', slug, slug + '.pdf');
  // Compilation en échec : on s'arrête, pour ne pas envoyer un PDF périmé.
  if (code !== 0 || !fs.existsSync(pdf)) {
    vscode.window.showErrorMessage(T('art.envoi.pdf.absent', [slug]));
    return;
  }

  const meta = ctx.lireMetaArticle(racine, slug);
  const langueArticle = normaliserLangueArticle(meta.lang) || langueRevue(racine);
  const adresses = adressesAuteurs(meta);
  const titreArticle = titreFiche(meta, langueArticle) || slug;
  const nomsAuteurs = (meta.author || [])
    .map((a) => [a.prenom, a.nom].map((x) => String(x || '').trim()).filter((x) => x !== '').join(' '))
    .filter((x) => x !== '');
  const brouillon = brouillonAuteur(langueArticle, adresses, titreArticle, titreNumero(racine), nomsAuteurs);
  if (adresses.length === 0) { vscode.window.showWarningMessage(T('art.envoi.sansmail', [slug])); }

  const copie = await copierFichierPressePapiers(pdf);
  const uri = vscode.Uri.file(pdf);
  try {
    await vscode.env.openExternal(vscode.Uri.parse(uriMailto(brouillon)));
  } catch (e) {
    // Pas de client de messagerie, ou refus de l'hôte : le PDF est au presse-papiers, et
    // on propose son dossier.
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

// « Voir le PDF (Explorateur) » : lecture seule, donc permis sur un numéro verrouillé ou
// archivé. Sans PDF, on montre le dossier out/<slug>/ s'il existe, sinon on le dit.
async function voirPdfArticle(fournisseur, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const slug = cibleTraduction(fournisseur, cible).slug;
  if (!slug || fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  const dossier = path.join(racine, 'out', slug);
  const pdf = path.join(dossier, slug + '.pdf');
  if (fs.existsSync(pdf)) { await revelerDansExplorateur(vscode.Uri.file(pdf)); return; }
  if (fs.existsSync(dossier)) { await revelerDansExplorateur(vscode.Uri.file(dossier)); return; }
  vscode.window.showInformationMessage(T('art.pdf.absent', [slug]));
}

// Ouvre le dossier du PDF, fichier sélectionné : par la commande de l'éditeur, sinon par
// l'hôte (poste sans intégration de l'Explorateur).
async function revelerDansExplorateur(uri) {
  try { await vscode.commands.executeCommand('revealFileInOS', uri); return; }
  catch (e) { /* pas d'intégration Explorateur */ }
  try { await ouvrirAvecSysteme(path.dirname(uri.fsPath), vscode); }
  catch (e) { /* rien de plus à tenter */ }
}

module.exports = {
  configurer,
  textesArticles, htmlArticles, chargeArticles, chargeChapitres, actionArticle, TYPES_ACTION_ARTICLE,
  apercuArticle, apercuChapitre, apercuDoi, constatsCarte, resumeTachesLigne, couperApercu,
  deplacerUnite, messageDeplacement, ouvrirVueArticles,
  envoyerAuteur, voirPdfArticle, revelerDansExplorateur
};
