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
const { lireConfigPoste, ecrireConfigPoste, CONFIG_POSTE } = require('./archivage');
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
const { fermerTousLesApercus } = require('./apercu');
const { construireHtml } = require('./webviews/util');
const { panneauUnique, panneauCourant } = require('./webviews/panneau');
const metadonneesHote = require('./metadonnees-hote');
const {
  textesNumero, chargeNumero, messageNumero, imprimerFeuilleVerifTous, envoyerAuteursConnus
} = metadonneesHote;
const { adressesAuteurs, brouillonAuteur, uriMailto } = require('./courriel');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois par extension.js. Les valeurs par défaut ne servent qu'à ne pas
// planter un test qui require ce module seul.
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
  cibleTraduction: () => ({ slug: null, cle: null }),
  constatsCourants: () => [],
  contexteConstats: () => ({}),
  ecrireClesAusgabe: () => 'lib/vue-articles-hote.js non configuré',
  refusCoedition: () => null,
  noterLectureCoedition: () => {},
  libererCoedition: () => {},
  lireCouleurAccent: () => '',
  // Mode « Trad » : l'état du mode, et le clic détourné, sans relais par l'hôte.
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
// La vue qui monte un numéro : l'ordre des articles, l'avancement de chacun, et les
// métadonnées du numéro au même endroit, parce qu'on les regarde ensemble. Elle a sa page
// (media/articles.*) parce qu'elle porte un formulaire, mais rien n'y est recopié : ses
// cartes et sa barre sont celles des autres vues d'ensemble (SZH.listeCartes,
// SZH.barreBoutons) et son formulaire du numéro est celui de la page « Méta-données du
// numéro » (SZH.formulaireNumero).

function textesArticles() {
  const livre = profilCourant().cle === 'livre';
  // Un livre monte le formulaire de buch.yaml (SZH.formulaireLivre) à la place de celui du
  // numéro ; tout le reste de la table est commun.
  const texte = Object.assign(livre ? metadonneesHote.textesLivre() : textesNumero(), {
    // « Ouvrir l'article » et non « Ouvrir » : sur cette vue, la carte EST un article, et
    // le bouton se lit aussi bien dans la barre de titre que dans le pied. `vue.ouvrir`
    // reste « Ouvrir » pour « Traductions » et « Word en attente », où la carte est un bloc
    // de traduction ou un fichier.
    ouvrir: T('art.ouvrir'),
    ouvrirTip: T('art.ouvrir.tip'),
    // `listeVide` et non `rien` : `rien` est déjà « Aucune modification » dans la table du
    // formulaire du numéro, que cette table étend.
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
    // Les deux titres des groupes de constats, dans l'encadré « À faire » de la carte :
    // ce qui mérite un regard, puis ce qui arrêtera la publication.
    constatsAttention: T('art.constats.attention'),
    constatsDanger: T('art.constats.danger'),
    // Le bouton qui replie l'aperçu des métadonnées d'une carte — réduit au chevron seul
    // (media/articles.js, basculeApercu) : ces deux libellés ne s'affichent donc plus,
    // ils vivent dans son infobulle et son aria-label. Le titre de la carte porte le même
    // geste, en second bouton, et partage le même état.
    metaVoir: T('art.meta.voir'),
    metaCacher: T('art.meta.cacher'),
    revues: { revue: T('meta.revue.revue'), zeitschrift: T('meta.revue.zeitschrift') }
  });
  // La case « pas de DOI » : le seul texte que la page écrit elle-même, et seulement là où
  // l'unité reçoit un DOI. Les intitulés et les valeurs de l'aperçu, eux, arrivent tout
  // faits dans chaque ligne — c'est l'hôte qui sait dire une licence ou une rubrique.
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

// Plus aucune pastille dans le pied d'une carte d'article — ni compteur d'images, ni
// avancement des tâches.
//
// Le compteur d'images redisait en abrégé ce que l'encadré « À faire » écrit déjà en
// toutes lettres : « ⚠ 1 image(s) » dans le pied, juste sous « 1 image(s) apportent une
// information et n'ont pas de texte alternatif ». Le même reproche montré deux fois se
// compte deux fois à la lecture, et l'abrégé ne disait pas ce qui manquait. Ce qui manque
// se lit donc dans les constats (constatsCarte), et l'avancement des tâches dans
// l'entête « À faire » (resumeTachesLigne), à côté des cases qu'il résume.
//
// Rien n'est perdu au passage : le nombre total d'images n'était un reproche que par
// accident, quand il portait le ton « attention » d'un manque décrit en dessous.

// Le résumé de l'avancement des tâches d'une carte, pour l'entête « À faire » :
// -> { texte, toutes } ou null quand la revue ne définit aucune tâche — l'entête ne
// montre alors pas de compteur, il n'y a rien à compter.
function resumeTachesLigne(avance) {
  if (!avance || avance.total === 0) { return null; }
  return {
    texte: avance.toutes ? T('art.taches.toutes') : T('art.taches.avancement', [avance.faites, avance.total]),
    toutes: !!avance.toutes
  };
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
//
// `langues` restreint la ligne à ce qui doit se lire — la seule langue de l'article quand
// « Cacher les traductions » est en service. Une restriction d'AFFICHAGE, et rien d'autre :
// les textes des autres langues sont toujours là, dans la fiche, et l'article s'exporte
// avec eux.
function ligneApercuLangues(libelle, map, limite, langues) {
  const valeurs = [];
  for (const l of (langues || LANGUES_META)) {
    const t = couperApercu((map || {})[l], limite);
    if (t !== '') { valeurs.push({ marque: l.toUpperCase(), texte: t }); }
  }
  return { libelle: libelle, valeurs: valeurs };
}

// Les mots-clés : une ligne par langue, la liste mise à plat. Le séparateur est celui des
// listes du cockpit.
function ligneApercuMotsCles(meta, langues) {
  const plat = {};
  for (const l of LANGUES_META) {
    const liste = ((meta.keywords || {})[l] || []).map((x) => String(x).trim()).filter((x) => x !== '');
    if (liste.length > 0) { plat[l] = liste.join(' · '); }
  }
  return ligneApercuLangues(T('trad.champ.keywords'), plat, APERCU_LONG, langues);
}

// Les auteur·e·s : l'identité d'abord, puis ce qui la situe, puis en badges ce que la fiche
// porte déjà — l'ORCID, l'adresse, la photo. Les valeurs elles-mêmes ne sont pas affichées :
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
// Le DOI est un calcul : le rang de l'article parmi ceux qui en portent un, compté à partir
// de zéro, d'où l'éditorial en « 00 ». Rien ne le stocke — sauf l'échappatoire : un doi
// resté sur la fiche y a été défini à la main (case « Définir manuellement le DOI » du
// formulaire des métadonnées), et c'est lui qui part vers OJS à la place du calculé.
// La carte affiche ce qui part : le manuel quand il existe, étiqueté « manuel » pour que
// la provenance se voie d'un coup d'œil, le calculé sinon, étiqueté « calculé » comme
// avant. La divergence entre les deux reste un constat : elle ne se devine pas.
// FORME_DOI (motif + exemple par revue) vient de l'import de tête de lib/export-ojs
// (doiCalcule et consorts) : pas de second require ici.

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
    // y a deux valeurs à comparer — et c'est alors seulement qu'il faut départager les deux
    // causes, miroir exact de la logique de l'export (voir FORME_DOI, export-ojs.js ~152) :
    // une forme étrangère à la revue n'a jamais pu être déposée telle quelle, une forme de
    // la maison a pu l'être pour de bon.
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

// Ce que les images de l'article disent sans qu'on ouvre leur gestionnaire. La lecture est
// la sienne — lireAttributsImage, celle de lib/references.js, et la liste de fichiers de
// media/ — ce qui laisse dehors les photos des autrices et auteurs, rangées dans portraits/.
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

// Ce que la carte doit signaler, en toutes lettres et dans son encadré « À faire » —
// jamais dans une infobulle : les images incomplètes, puis l'état des références relevé à
// la dernière compilation.
//
// Le ton ne se décide plus ici : il vient de lib/constats.js, comme dans la liste
// « À corriger ». Ces constats-là forçaient tous « attention », et une image muette
// paraissait donc bénigne sur la carte au moment même où elle arrêtait l'export deux
// écrans plus loin.
//
// La carte résume, la liste détaille : ici un constat par FAMILLE de défaut avec son
// compte entre parenthèses, là-bas un constat par image et par appel, chacun avec son
// bouton. Les deux partagent l'intitulé — « Figure sans texte alternatif » — pour qu'on
// reconnaisse le même défaut d'un écran à l'autre. Et aucun bouton sur ces constats-ci :
// le pied de la carte porte déjà « Éditer les médias » et « Éditer les métadonnées », qui
// mènent exactement là où ces défauts se corrigent.
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
    // Les trois codes de citations sont ceux de la chaîne : même table, même intitulé, même
    // ton que dans la liste — seul le compte remplace l'appel fautif, qu'une carte n'a pas
    // à énumérer.
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

// L'aperçu complet d'un article : neuf lignes, dans l'ordre où on les lit — ce que
// l'article est, ce qu'il dit, qui l'a écrit, sous quelles conditions il paraît.
//
// `langueSeule` — le code de la langue de l'article, ou '' — réduit les quatre lignes
// bilingues (titre, sous-titre, résumé, mots-clés) à cette seule langue : c'est le bouton
// « Cacher les traductions » de la vue. Les cinq autres lignes n'ont pas de langue et ne
// bougent pas. Rien n'est perdu ni modifié : l'autre langue est toujours dans la fiche, et
// le bouton la remontre.
function apercuArticle(meta, langue, doi, langueSeule) {
  const type = String(meta.type || '').trim();
  const langueArticle = normaliserLangueArticle(meta.lang);
  const vide = T('art.apercu.vide');
  // Une langue hors des trois de la revue, ou aucune, ne restreint rien : mieux vaut
  // montrer les quatre lignes en entier que les vider en silence.
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

// Le bandeau d'une unité dans le mode « Changer l'ordre » (vue ARTICLES comme vue CHAPITRES) :
// son titre au rang à venir, et ses deux flèches. `titre` est celui de la fiche, jamais le
// libellé numéroté — « 02 » y figure déjà.
function bandeauOrdre(slug, index, slugs, titre) {
  const nom = titre || slug;
  return {
    cle: slug,
    // Rang à venir, et non le préfixe du dossier : c'est ce mode-ci qui va l'écrire
    // (« Terminer »), les flèches doivent donc annoncer la même chose que le titre.
    titre: libelleArticle(prefixeOrdre(index), slug, titre),
    ouvrir: false,
    actions: [],
    constats: [],
    taches: [],
    // Le rang visé vient de prefixeOrdre(), la même fonction que le DOI et
    // l'arborescence : le redire ici à la main finirait par diverger. Un bouton en
    // bord de liste reçoit le générique en aria-label lui aussi — il n'annonce jamais
    // un rang qui n'existe pas.
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

// L'aperçu d'une carte de chapitre : cinq lignes lues dans <slug>.meta.yaml — titre,
// sous-titre, auteurs, résumé, et si le chapitre est hors sommaire. Ni DOI, ni type, ni
// licence, ni mots-clés : un chapitre n'a rien de tout cela (il n'hérite de rien du livre).
// Un livre est écrit dans une langue : les lignes bilingues se réduisent à celle du livre,
// sauf quand la fiche ne l'a pas écrite — mieux vaut montrer ce qui existe que du vide.
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

// La vue CHAPITRES : les mêmes cartes que la vue ARTICLES (SZH.listeCartes), sans rien de ce
// qu'un livre n'a pas — ni DOI et ses rangs, ni tâches de revue, ni traductions, ni
// ausgabe.yaml. L'ordre est celui d'ordre-chapitres (buch.yaml, via listerArticles), le
// titre celui de la fiche : le .md ne le porte plus. Les trois boutons de la barre sont
// ceux du livre entier ; le formulaire du livre est monté en tête par la page.
function chargeChapitres(fournisseur) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const interface_ = langueCockpit();
  const vue = vueArticlesConfig(lireConfigPoste());
  // Le mode « Changer l'ordre » de la vue ARTICLES vaut pour les chapitres : rien n'est écrit
  // avant « Terminer », qui renomme les dossiers et écrit ordre-chapitres dans buch.yaml.
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
      // La compilation d'un chapitre refuse de partir sans titre : la carte le dit.
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
      // Dans le mode, la barre ne propose plus que d'en sortir, comme la vue ARTICLES.
      { id: 'ordre-terminer', groupe: 'action', libelle: T('art.ordre.terminer'), icone: 'ok',
        principal: true, tip: T('art.ordre.terminer.tip') },
      { id: 'ordre-annuler', groupe: 'action', libelle: T('art.ordre.annuler'), icone: 'fermer',
        tip: T('art.ordre.annuler.tip') }
    ] : [
      // Seul interrupteur qui garde un sens pour un livre : replier l'aperçu des cartes.
      { id: 'cacher-meta', groupe: 'filtre', actif: !vue.cacherMeta,
        icone: vue.cacherMeta ? 'oeil-ferme' : 'oeil',
        libelle: T('art.meta.bouton'),
        tip: T(vue.cacherMeta ? 'art.meta.voir.tip' : 'art.meta.cacher.tip') },
      // Les trois gestes du livre entier. Le clic sur un chapitre, lui, ne compile que lui.
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

// Une carte par article, dans l'ordre du numéro : son nom, son slug, l'aperçu complet de
// ses métadonnées, ses tâches cochables, et ce qui lui manque. Tout se lit sans rien
// ouvrir ; les boutons du pied mènent aux formulaires qui écrivent, et sont les seuls à
// écrire. Le classement, lui, ne vit plus ici : voir le mode « Changer l'ordre » plus bas,
// où la carte se réduit à un bandeau porté par ses seules flèches.
function chargeArticles(fournisseur) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const interface_ = langueCockpit();
  // Les cartes tirent leur ton de la même table que la liste « À corriger » : il faut donc
  // le même contexte, celui qui dit si la validation PDF/UA tourne sur ce poste.
  const contexte = ctx.contexteConstats();
  // La configuration du poste, lue une fois : elle porte les intitulés des tâches ET les
  // deux interrupteurs d'affichage de la vue.
  const configPoste = lireConfigPoste();
  // Ce que les interrupteurs cachent n'est pas envoyé du tout — pas envoyé puis masqué en
  // CSS : une carte sans tâches et sans traductions est vraiment plus courte, et le message
  // qui la porte aussi.
  const vue = vueArticlesConfig(configPoste);
  const taches = ctx.tachesDuNumero(racine);
  // Dans le mode « Changer l'ordre », l'ordre affiché est celui qu'on est en train de
  // composer : rien n'a encore été écrit, ni dans ausgabe.yaml ni sur le disque.
  const enOrdre = ctx.ordreEnCours(racine);
  const slugs = enOrdre || fournisseur.listerArticles();
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : le DOI sera dit incalculable, ce qui est vrai */ }
  const locale = langueDefaut(valeurs);
  const annee = anneeNumero(racine, valeurs);
  const numeroRevue = String(valeurs.numero || '').trim();
  // Les fiches sont lues une fois : elles servent au titre, à l'aperçu, et au verdict
  // « cette rubrique ne reçoit pas de DOI » qui décide de l'ordre.
  const metas = {};
  const types = {};
  for (const slug of slugs) {
    metas[slug] = ctx.lireMetaArticle(racine, slug);
    types[slug] = metas[slug].type;
  }
  // Deux jeux, et la nuance compte pour la case : `voulus` est ce que la rédaction a
  // coché, `sansDoi` y ajoute les rubriques qui n'en reçoivent jamais. Une case cochée par
  // la rubrique se montre verrouillée, puisque la décocher ne changerait rien.
  const voulus = new Set(ctx.slugsSansDoiVoulu(racine));
  const sansDoi = ctx.articlesSansDoi(racine, slugs, { types: types, voulus: [...voulus] });
  const citations = citationsParArticle(ctx.constatsCourants(racine));
  // Le DOI EFFECTIF de chaque article — sa fiche si elle n'est pas vide, sinon le calculé,
  // exactement ce que collecter() envoie à l'export (lib/export-ojs.js) — calculé pour tous
  // les articles avant la boucle qui construit les cartes : un doublon se voit des DEUX
  // côtés, et le second article de la paire n'a pas encore sa carte quand le premier
  // construit la sienne.
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
    // Le mode « Changer l'ordre » réduit la carte à un bandeau : rien à lire, rien à cocher,
    // rien à ouvrir — seulement à classer. On ne calcule donc ni l'aperçu, ni le DOI, ni les
    // constats : ce que la webview ne reçoit pas ne peut pas réapparaître par accident
    // (media/articles.js, decorerBandeauOrdre). Le nom qui nomme la destination des deux
    // flèches est le titre de la fiche, jamais le libellé numéroté — « 02 » y figure déjà.
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
    // Bloquant, et c'est l'export qui le dit : deux articles au même DOI comptent parmi
    // ses `bloquants` (lib/export-ojs.js, ojs.err.doi.double), rien ne part du tout.
    if (autresMemeDoi.length > 0) {
      constats.push({ ton: 'danger', texte: T('art.doi.double', [autresMemeDoi[0]]) });
    }
    // Un article sans titre reste dans la liste, et la carte dit pourquoi elle montre un
    // slug : la compilation refusera de partir sur cet article, et il faut le savoir ici.
    // Bloquant aussi, et le message le dit déjà : sans titre dans sa fiche, la compilation
    // de cet article refuse de partir.
    if (titre === '') { constats.unshift({ ton: 'danger', texte: T('art.sansfiche') }); }
    return {
      cle: slug,
      // Le numéro du DOSSIER, pas le rang dans l'ordre : ce nombre sert à retrouver
      // l'article dans l'Explorateur de fichiers, il ne doit donc jamais promettre un
      // rangement que le disque n'a pas. Un dossier sans préfixe n'affiche ni numéro ni
      // séparateur (libelleArticle) — la carte dit la vérité du disque, trous compris.
      titre: libelleArticle(prefixeDossier(slug), slug, titre),
      // Plus de `meta: slug` : le slug redisait dans l'entête ce que le titre numéroté
      // vient de dire. Il reste l'identifiant technique de l'article — la carte le
      // porte encore en infobulle du titre, côté webview (media/articles.js), à partir de
      // `cle` ci-dessus, qui vaut toujours ce même slug.
      // Pas de bouton « Ouvrir » posé par le composant : il le mettrait en tête du pied,
      // alors qu'il ferme la série des gestes de la carte. Il est ajouté en dernier dans
      // `actions` ci-dessous.
      ouvrir: false,
      // La langue de l'article, ou celle du numéro quand la fiche n'en déclare pas : c'est
      // exactement le repli que la compilation applique, donc la langue dans laquelle
      // l'article paraîtra.
      apercu: apercuArticle(meta, interface_, doi.ligne,
        vue.cacherTraductions ? (normaliserLangueArticle(meta.lang) || langue) : ''),
      // Le quatrième interrupteur : les avertissements sont calculés dans tous les cas — la
      // frontière du DOI et le refus de déplacement en dépendent ailleurs — mais la carte ne
      // les reçoit pas quand on a choisi de ne pas les lire.
      constats: vue.cacherConstats ? [] : constats,
      // La case « pas de DOI ». Verrouillée quand c'est la rubrique qui décide : cocher ou
      // décocher n'y changerait rien, et un interrupteur sans effet est un mensonge.
      sansDoi: {
        coche: sansDoi.has(slug),
        verrouille: !voulus.has(slug) && sansDoi.has(slug)
      },
      // L'avancement de ses tâches, pour l'entête « À faire » de la carte — jamais en
      // pastille du pied, qui n'en porte plus aucune (voir le bloc au-dessus de
      // resumeTachesLigne).
      tachesResume: resumeTachesLigne(avance),
      // Le classement ne se fait plus ici : « Monter »/« Descendre » ont quitté le pied de
      // la carte complète, et ne vivent plus que dans le bandeau du mode « Changer l'ordre »
      // (ligne.ordre, ci-dessus) — nulle part ailleurs. L'ordre du pied suit celui du
      // travail qui reste : remplir les formulaires, envoyer à l'auteur, ouvrir.
      actions: [
        // Les deux formulaires, ouverts sur cet article. Le pied de carte est le seul
        // endroit d'où l'on écrit : l'aperçu au-dessus ne se modifie pas.
        { id: 'metadonnees', libelle: T('art.meta.editer'), icone: 'info',
          tip: T('art.meta.editer.tip') },
        { id: 'medias', libelle: T('art.medias.editer'), icone: 'camera',
          tip: T('art.medias.editer.tip') },
        { id: 'envoyer', libelle: T('art.envoyer'), icone: 'traduction', tip: T('art.envoyer.tip') },
        // Ferme la série au lieu de l'ouvrir : c'est le geste qu'on fait après avoir lu la
        // carte, pas avant.
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
      // Les quatre interrupteurs d'affichage, LIGNE DU HAUT de la barre : `groupe: 'filtre'`
      // est le seul contrat qui le dit — media/articles.js répartit `boutons` sur ses deux
      // lignes selon ce champ, et pose la ligne du bas (les gestes, ci-dessous) avec ce qui
      // n'en porte pas. Le libellé nomme la chose et ne bouge pas ; c'est `actif` qui dit si
      // elle est à l'écran — fond plein, oeil ouvert, aria-pressed (voir boutonCommande,
      // media/_commun.js). Le libellé disait auparavant le geste à venir, ce qui
      // contredisait le fond dès qu'un fond a existé : il fallait lire les deux pour savoir
      // où l'on en était. L'infobulle a gardé ce rôle, et elle seule.
      //
      // ⚠ La configuration retient ce qui est CACHÉ (cacherTaches…) : `actif` est donc sa
      //   négation, et non sa valeur. Les recopier telles quelles allumerait exactement les
      //   quatre boutons dont le contenu ne s'affiche pas.
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
      // Dans le mode, la barre ne propose plus que d'en sortir : par le haut ou par le bas.
      // LIGNE DU BAS (`groupe: 'action'`, comme « Vérifier les méta » ci-dessous) : ce sont
      // des gestes, jamais des réglages d'affichage — ils gardent leur ligne à eux, que la
      // vue soit en mode normal ou en mode « Changer l'ordre ».
      ? [{ id: 'ordre-terminer', groupe: 'action', libelle: T('art.ordre.terminer'), icone: 'ok',
           principal: true, tip: T('art.ordre.terminer.tip') },
         { id: 'ordre-annuler', groupe: 'action', libelle: T('art.ordre.annuler'), icone: 'fermer',
           tip: T('art.ordre.annuler.tip') }]
      : [{ id: 'ordre', groupe: 'action', libelle: T('art.ordre.mode'), icone: 'liste',
           tip: T('art.ordre.mode.tip') }])
      // La feuille de relecture de TOUT le numéro, d'un coup — le pendant du bouton du
      // formulaire des fiches, qui ne tire que ce qu'il montre. Dernier bouton de la ligne
      // des ACTIONS (les quatre interrupteurs vivent sur leur propre ligne, `groupe: 'filtre'`
      // ci-dessus) : ni un réglage d'affichage, ni un geste sur le sommaire, mais
      // l'aboutissement des deux — on y recourt une fois le numéro monté et relu.
      //
      // Absent du mode « Changer l'ordre » : pendant qu'on réordonne, les dossiers sont sur
      // le point d'être renommés par « Terminer ». Une feuille tirée à ce moment porterait
      // des slugs et une empreinte déjà périmés au moment où elle sort de l'imprimante —
      // exactement ce que l'empreinte en pied de feuille est censée empêcher.
      .concat(enOrdre ? [] : [{ id: 'verif-meta', groupe: 'action', libelle: T('verif.bouton'),
                 icone: 'imprimante', tip: T('verif.tous.tip') }]),
    // La page gèle ce qui n'a pas de sens pendant qu'on réordonne.
    ordre: !!enOrdre,
    // L'aperçu part toujours, même replié : contrairement aux tâches, que l'interrupteur
    // vide pour de bon, celui-ci ne fait que décider l'état de départ des cartes. Le
    // chevron de chaque carte reste donc capable d'en déplier une seule, sans aller-retour
    // avec l'hôte.
    metaRepliees: vue.cacherMeta,
    lignes: lignes
  };
}

// Les seuls types que actionArticle (ci-dessous) sait traiter : la vue Articles s'en sert
// pour reconnaître un message inconnu avant de l'appeler, plutôt que de laisser un type
// jamais vu retomber sur « rien à faire » et recharger toute la liste pour rien.
const TYPES_ACTION_ARTICLE = [MSG.COMMANDE, MSG.TACHE, MSG.SANSDOI, MSG.ACTION];

// Les gestes de la vue. -> le message à afficher dans la barre, ou null.
async function actionArticle(fournisseur, rafraichirTout, msg) {
  const racine = fournisseur.racine;
  if (msg.type === MSG.COMMANDE) {
    // Les trois gestes du livre entier (vue CHAPITRES). Compiler recompose TOUT le livre ;
    // c'est ici, et par l'aperçu du livre, qu'il se fait — plus au clic d'un chapitre.
    if (msg.id === 'livre-compiler') { await ctx.compilerLivre(fournisseur); return null; }
    if (msg.id === 'livre-pdf') { await vscode.commands.executeCommand('szh.apercuLivre'); return null; }
    if (msg.id === 'livre-couverture') { await vscode.commands.executeCommand('szh.livreCouverture'); return null; }
    if (msg.id === 'verif-meta') { await imprimerFeuilleVerifTous(fournisseur); return null; }
    // Les quatre interrupteurs d'affichage. Réglage de poste et non de numéro — ce qu'on
    // choisit de lire ne dépend pas du numéro ouvert — donc le verrou du numéro ne s'y
    // applique pas.
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
      const avant = lireConfigPoste();
      // Illisible n'est pas absent : on n'écrase pas ce qu'on n'a pas su lire, sans quoi
      // l'emplacement des revues et la configuration OJS partiraient avec.
      if (avant === null && fs.existsSync(CONFIG_POSTE)) { return T('err.ecriture', [path.basename(CONFIG_POSTE), CONFIG_POSTE]); }
      const etat = vueArticlesConfig(avant);
      const erreur = ecrireConfigPoste(configAvecVueArticles(avant, cle, !etat[cle]));
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
                           // Le compteur de l'entête « À faire » suit la case cochée sans
                           // reconstruire la carte : reposer la liste entière ferait perdre
                           // au clavier le focus de la case qu'il vient d'utiliser. Plus de
                           // pastille à renvoyer avec lui, donc plus de relecture des images
                           // de l'article à chaque case cochée.
                           tachesResume: resumeTachesLigne(avance) } };
  }
  // La case « pas de DOI » d'un article. Elle décide de deux choses d'un seul coup : que
  // l'article ne reçoit pas de DOI, et qu'il passe en fin de numéro — donc l'ordre est
  // réécrit avec elle, sinon le fichier dirait une chose et l'écran une autre.
  //
  // C'est l'ordre du numéro qu'elle touche : elle suit donc la même règle que les boutons
  // de déplacement, refusée sur un numéro archivé et acceptée sur un numéro verrouillé.
  if (msg.type === MSG.SANSDOI) {
    if (refuserSiArchivee()) { return null; }
    const slug = String(msg.cle || '');
    const slugs = fournisseur.listerArticles();
    if (slugs.indexOf(slug) === -1) { return null; }
    const voulus = basculerSansDoi(ctx.slugsSansDoiVoulu(racine), slug, !!msg.coche, slugs);
    const modifies = {};
    modifies[CLE_SANS_DOI] = voulus;
    // L'ordre part avec. listerArticles() applique déjà la règle à la lecture, mais le
    // fichier doit finir par dire la même chose que l'écran : il se relit à la main, et il
    // voyage seul sur SharePoint.
    modifies[cleOrdre()] = trierParDoi(slugs, ctx.articlesSansDoi(racine, slugs, { voulus: voulus }));
    // Un clic isolé ne garde pas de main : il regarde le bail de co-édition et s'abstient
    // si quelqu'un modifie ausgabe.yaml en ce moment.
    const refusBail = ctx.refusCoedition(racine, cheminConfig(racine));
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
  // Dans le mode, le déplacement ne vit qu'en mémoire : ni ausgabe.yaml ni le disque ne
  // bougent avant « Terminer ».
  const enOrdre = ctx.ordreEnCours(fournisseur.racine);
  if (enOrdre) {
    ctx.poserModeOrdre({ racine: fournisseur.racine,
      slugs: deplacerArticle(enOrdre, slug, msg.id === 'monter' ? -1 : 1) });
    return null;
  }
  return deplacerUnite(fournisseur, slug, msg.id === 'monter' ? -1 : 1, rafraichirTout);
}

// Ce que deplacerUnite() a répondu, dans la barre d'état. null veut dire « rien à dire » :
// on ne le transforme pas en message vide, qui clignoterait pour rien.
function messageDeplacement(message) {
  if (message) { vscode.window.setStatusBarMessage(message, 4000); }
}

// Déplacer une unité d'un cran dans le sommaire — un article dans son numéro, un chapitre
// dans son livre. Partagée par la vue en cartes et par le menu contextuel de l'arbre :
// deux chemins qui écriraient chacun leur ordre finiraient par ne plus dire la même chose.
// Rend le message à afficher, ou null quand il n'y a rien à dire — être au bout de la
// liste ne se signale pas, c'est une évidence à l'écran.
function deplacerUnite(fournisseur, slug, delta, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return null; }
  // ⚠ refuserSiArchivee() et non refuserSiVerrouille() : voir la garde elle-même. Un
  // numéro verrouillé a ses textes figés, mais son sommaire peut encore se décider.
  if (refuserSiArchivee()) { return null; }
  const slugs = fournisseur.listerArticles();
  if (slugs.indexOf(slug) === -1) { return null; }
  // La règle du tri passe avant le déplacement : franchir la frontière DOI / sans DOI se
  // refuse en le disant. Sur un livre le jeu est vide — un chapitre n'a pas de DOI — et la
  // frontière n'existe donc pas.
  const refus = refusDeplacement(slugs, slug, delta, ctx.articlesSansDoi(racine, slugs));
  if (refus === 'frontiere') { return T('art.ordre.frontiere'); }
  if (refus !== '') { return null; }
  const nouveau = deplacerArticle(slugs, slug, delta);
  if (nouveau.join(' ') === slugs.join(' ')) { return null; }   // déjà au bord
  // La liste entière part dans le fichier de configuration : une liste partielle laisserait
  // les autres unités à réparer au prochain rendu.
  const modifies = {};
  modifies[cleOrdre()] = nouveau;
  const refusBail = ctx.refusCoedition(racine, cheminConfig(racine));
  if (refusBail) { return refusBail; }             // quelqu'un modifie le fichier en ce moment
  const erreur = ctx.ecrireClesAusgabe(racine, modifies);
  if (erreur) { return T('err.ecriture', ['ausgabe.yaml', erreur]); }
  if (rafraichirTout) { rafraichirTout(); }
  return T('art.ordre.enregistre', [prefixeOrdre(nouveau.indexOf(slug))]);
}

// Panneau singleton, comme les autres vues : rouvrir la commande révèle celui qui existe,
// valeurs relues du disque.
async function ouvrirVueArticles(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Ouvrir la vue d'ensemble ferme l'aperçu de la colonne 2 (HTML ou PDF) — on vient
  // embrasser le numéro, l'article quitté n'a plus à occuper l'écran. Même geste que
  // la vue Métadonnées. Les rafraîchissements en
  // tâche de fond passent par envoyerVue, pas par ici : ils ne ferment rien.
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
    ctx.noterLectureCoedition(panneau, racine, cheminConfig(racine));
  };
  // Le formulaire du numéro d'abord : c'est le même code que la page « Méta-données du
  // numéro », et il répond lui-même au panneau. Aucun bail n'est posé à l'ouverture de
  // cette vue — elle se consulte, et geler ausgabe.yaml pour une consultation bloquerait
  // les autres ; il se prend à la première écriture, dans messageNumero.
  const messageVue = async (panneau, msg) => {
    const recharger = () => envoyer(panneau, false);
    // messageLivre rend une promesse pour le dépôt de l'illustration et le bouton « 4e de
    // couverture » : on l'attend, comme le fait la page « Métadonnées du livre ».
    if (livre ? await metadonneesHote.messageLivre(panneau, racine, msg, rafraichirTout, recharger)
      : messageNumero(panneau, racine, msg, rafraichirTout, recharger)) { return; }
    if (msg.type === MSG.OUVRIR) {
      // Par la commande, pour rester sur le point d'entrée unique. sansApercu : depuis la
      // vue d'ensemble, on vient lire ou corriger le texte, pas mettre en page ; seul le
      // .md s'ouvre, sans compilation ni aperçu.
      await vscode.commands.executeCommand('szh.ouvrirArticle', String(msg.cle || ''),
        { sansApercu: true });
      return;
    }
    // Un type inconnu ne doit pas tomber dans actionArticle : celui-ci répondrait null, et
    // envoyer(panneau) plus bas rechargerait la liste entière pour un message qu'elle ne
    // connaît pas, alors qu'elle n'a rien à en faire.
    if (TYPES_ACTION_ARTICLE.indexOf(msg.type) === -1) {
      console.warn('vue Articles : type de message inconnu', msg.type);
      return;
    }
    // L'état part après le re-rendu : « valeurs » reconstruit la barre, et donc efface la
    // zone d'état.
    let dit = null;
    let avancement = null;
    try {
      const reponse = await actionArticle(fournisseur, rafraichirTout, msg);
      // Cocher une tâche rend un avancement, les autres gestes une phrase.
      if (reponse && typeof reponse === 'object') { dit = reponse.dit; avancement = reponse.avancement; }
      else { dit = reponse; }
    } catch (e) { dit = T('err.commande', [e && e.message ? e.message : String(e)]); }
    if (panneauCourant(VUE) !== panneau) { return; }
    // Une case cochée ne fait reposer que sa pastille : « valeurs » reconstruirait la liste
    // entière, et le focus clavier quitterait la case qu'on vient d'utiliser. Dans un outil
    // dont le sujet est l'accessibilité, cela compte.
    if (avancement) { repondrePanneau(panneau, Object.assign({ type: MSG.AVANCEMENT }, avancement)); }
    else { envoyer(panneau); }
    if (dit) { repondrePanneau(panneau, { type: MSG.ETAT, message: dit }); }
  };
  const { panneau, nouveau } = panneauUnique({
    viewType: VUE,
    titre: T(livre ? 'chap.vue.titre' : 'art.vue.titre'),
    // Mode « Trad » : l'état du mode, et le clic détourné — voir repondreModeTrad.
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlArticles,
    surPret: (msg, p) => envoyer(p, true),
    surMessage: (msg, p) => messageVue(p, msg),
    surFermeture: (p) => ctx.libererCoedition(p)
  });
  // Déjà ouverte : la fabrique l'a révélée sans la recréer, et ses valeurs sont relues du disque.
  if (!nouveau) { envoyer(panneau, true); }
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

// Le PDF au presse-papiers comme fichier, ce que vscode.env.clipboard ne sait pas faire :
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

async function envoyerAuteur(fournisseur, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const slug = ctx.cibleTraduction(fournisseur, cible).slug;
  if (!slug || fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Le PDF d'abord : c'est lui qu'on envoie, et il doit être celui du texte d'aujourd'hui.
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('art.envoi.compilation', [slug]));
  let code = null;
  try { code = await ctx.lancerTacheObjet(ctx.tacheMakeArticle(racine, slug)); }
  finally { statut.dispose(); session.poserBuildEnCours(false); }
  const pdf = path.join(racine, 'out', slug, slug + '.pdf');
  // Compilation en échec : un PDF resté de la fois d'avant ne doit pas partir pour la
  // version du jour. Mieux vaut ne rien préparer que d'envoyer un document périmé.
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

// « Voir le PDF (Explorateur) » : un geste de LECTURE — rien n'est compilé, rien n'est
// écrit — donc offert même sur un numéro verrouillé ou archivé : c'est justement là qu'on
// cherche à remettre la main sur un document déjà sorti. Ne montre jamais un chemin qui
// n'existe pas : un article jamais exporté, ou dont la dernière compilation a échoué, n'a
// pas de PDF, et révéler un chemin absent ne ferait qu'ouvrir l'Explorateur sur du vide.
// On se rabat alors sur le dossier out/<slug>/ s'il existe (une compilation en échec y
// laisse parfois un reste), et à défaut on le dit au rédacteur plutôt que de rester muet.
async function voirPdfArticle(fournisseur, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const slug = ctx.cibleTraduction(fournisseur, cible).slug;
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

// Le dossier du PDF, fichier sélectionné. La commande de l'éditeur d'abord ; à défaut, le
// dossier ouvert par l'hôte — un poste sans intégration Explorateur ne doit pas rester sans
// pièce jointe.
async function revelerDansExplorateur(uri) {
  try { await vscode.commands.executeCommand('revealFileInOS', uri); return; }
  catch (e) { /* pas d'intégration Explorateur */ }
  try { await vscode.env.openExternal(vscode.Uri.file(path.dirname(uri.fsPath))); }
  catch (e) { /* rien de plus à tenter */ }
}

module.exports = {
  configurer,
  textesArticles, htmlArticles, chargeArticles, chargeChapitres, actionArticle, TYPES_ACTION_ARTICLE,
  apercuArticle, apercuChapitre, apercuDoi, constatsCarte, resumeTachesLigne, couperApercu,
  deplacerUnite, messageDeplacement, ouvrirVueArticles,
  envoyerAuteur, voirPdfArticle, revelerDansExplorateur
};
