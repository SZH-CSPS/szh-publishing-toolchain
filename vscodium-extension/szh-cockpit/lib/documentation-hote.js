// La Documentation d'un numéro : fiches et rubriques dans un seul formulaire, qui écrit
// désormais une arborescence Kirby (lib/kirby-contenu.js) — documentation.<lang>.txt pour
// les rubriques, un dossier <n>_<slug>/ par fiche. Il n'y a plus de <slug>.md pour cette
// page : voir docs/FORMAT-DOCUMENTATION-KIRBY.md.
//
// Moteur générique — une section par type de kirby.typesConnus() et une rubrique par
// kirby.rubriquesPourRevue() — plutôt qu'un formulaire par type : les champs viennent du
// contrat (pipeline/kirby/champs-documentation.json), ce fichier ne fait que les lire et
// composer leurs libellés dans la langue de l'interface. Aucun nom de champ n'est écrit en
// dur ici, hormis `title` et `canton` (le seul champ dont dépend l'ordre d'un autre menu —
// voir configChamp).
//
// Ce que la webview fait seule : ajouter une fiche, la retirer du DOM, taper dans ses
// champs, plier et déplier. Ce qui touche le disque : enregistrer (par lot), retirer une
// fiche déjà écrite, déposer une image de couverture, et les deux gestes de réserve.
//
// Une fiche incomplète s'enregistre (kirby.ficheEcrivable) : c'est le formulaire qui
// signale ce qui manque, par une pastille. Une rubrique vidée sort du fichier de page — un
// titre de rubrique sans rien dessous ne veut rien dire dans le PDF.
//
// ⚠ compterBlocsDocumentation() reste dans extension.js : le fournisseur d'arbre (classe
// FournisseurRevue) l'appelle pour le badge de la section « ACTUALITÉ », et rien ici n'en a
// besoin.
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
const { confirmerAbandon } = require('./interaction');
const { langueRevue, ecrireAtomique, serialiserMeta } = require('./yaml');
const { apercuMedia, BUDGET_APERCUS_MEDIA, nomImageAssaini, TAILLE_MAX_IMAGE_IMPORT } = require('./medias');
const kirby = require('./kirby-contenu');
const reserveLib = require('./reserve');

// Doivent rester alignées avec les constantes du même nom dans extension.js (le type de
// fiche de la page de Documentation, et le slug qu'elle prend par défaut).
const TYPE_ACTUALITE = 'documentation';
const SLUG_DOCUMENTATION = 'documentation';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  focaliserUnite: () => {},
  lireCouleurAccent: () => '',
  limitesMedias: () => ({}),
  // Partagés avec la réserve de fiches (lib/reserve.js), qui reste dans extension.js —
  // hors magasin, dans le dossier parent, commune aux deux revues.
  revueCourante: () => 'revue',
  nomRevueAffiche: (revue) => String(revue || ''),
  deposerFicheEnReserve: () => false,
  convertirCmykSiBesoin: async () => 0,
  // Mode « Trad » : le clic détourné vers le formulaire de suggestion. Un module non
  // configuré ne détourne rien — voir repondreModeTrad dans extension.js.
  repondreModeTrad: () => false
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le dossier des unités de texte du profil actif — même calcul que dossierUnites() dans
// extension.js.
function dossierUnites() {
  return (session.profilOuvrage() || profils.profilPour('revue')).unites.dossier;
}
function cheminMeta(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.meta.yaml');
}
function dossierArticleDoc(racine, slug) { return path.join(racine, dossierUnites(), slug); }

// postMessage tolérant : le panneau peut être fermé pendant le traitement WSL.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// ---- Libellés composés depuis le contrat -------------------------------------------

// Les instruments d'une intervention parlementaire, triés pour un canton donné (celui déjà
// choisi sur la même fiche) : ceux qui l'observent en tête, dans l'ordre du contrat, les
// autres ensuite. Le libellé d'un instrument `local` porte ses cantons entre parenthèses
// (jamais dans la valeur écrite) — kirby.instrumentEstLocal/cantonsInstrument le disent.
function optionsInstrument(canton, langue) {
  return kirby.ordreInstruments(canton).map((jeton) => {
    const libelle = ((kirby.valeursListe('instrument').find((x) => x.jeton === jeton) || {})[langue]) || jeton;
    const suffixe = kirby.instrumentEstLocal(jeton) ? ' (' + kirby.cantonsInstrument(jeton).join(', ') + ')' : '';
    return { valeur: jeton, libelle: libelle + suffixe };
  });
}
// Une table complète, un jeu d'options par canton possible (dont '' = aucun canton choisi) :
// la webview n'a ainsi jamais à rappeler l'hôte pour recomposer ce menu quand on choisit un
// canton — voir media/documentation.js.
function tableInstrumentsParCanton(langue) {
  const table = { '': optionsInstrument('', langue) };
  for (const c of kirby.valeursListe('canton')) { table[c.jeton] = optionsInstrument(c.jeton, langue); }
  return table;
}

// Les options d'une liste fermée du contrat, dans la langue de l'interface — dans l'ordre
// du contrat (jamais alphabétique : c'est cet ordre qui range aussi les fiches, voir
// kirby.calculerOrdreFiches).
function optionsListe(nomListe, langue) {
  return kirby.valeursListe(nomListe).map((v) => ({ valeur: v.jeton, libelle: v[langue] || v.fr }));
}

// La configuration d'un champ, telle qu'envoyée à la webview : rien n'y est un nom de champ
// en dur, tout vient de sa définition dans le contrat.
function configChamp(champ, langue) {
  const c = {
    cle: champ.cle, libelle: champ.libelle[langue] || champ.libelle.fr, saisie: champ.saisie,
    requis: !!champ.requis
  };
  if (champ.quand) { c.quand = champ.quand; }
  if (champ.saisie === 'liste') {
    c.options = optionsListe(champ.liste, langue);
    // Seul le menu des instruments dépend d'un autre champ de la même fiche (le canton) —
    // voir l'en-tête du fichier.
    if (champ.liste === 'instrument') { c.dependDe = 'canton'; c.optionsParCanton = tableInstrumentsParCanton(langue); }
  }
  if (champ.saisie === 'structure') {
    c.structureChamps = champ.champs.map((sc) => configChamp(sc, langue));
  }
  if (champ.saisie === 'fichier') { c.extensions = champ.extensions || []; }
  if (champ.saisie === 'derive') {
    // La table complète depuis->valeur, pour que la webview affiche la valeur dérivée sans
    // repasser par l'hôte à chaque choix (curia, par exemple, suit la catégorie choisie).
    c.depuis = champ.depuis;
    c.table = {};
    const source = champDuTypeParCle(langue, champ.depuis);
    if (source && source.saisie === 'liste') {
      for (const opt of optionsListe(source.liste, langue)) { c.table[opt.valeur] = kirby.valeurDerive(champ, { [champ.depuis]: opt.valeur }); }
    }
  }
  return c;
}

// Le champ `depuis` d'un `derive` peut appartenir à n'importe quel type — configChamp() ne
// sait pas duquel il est appelé. On le cherche dans tous les types plutôt que de faire
// porter le type courant en paramètre : un seul champ `derive` existe aujourd'hui (curia),
// et cette recherche reste bon marché (sept types, une poignée de champs chacun).
function champDuTypeParCle(langue, cle) {
  for (const type of kirby.typesConnus()) {
    const c = kirby.champDuType(type, cle);
    if (c) { return c; }
  }
  return null;
}

// typesRessourceConfig() : une entrée par type de fiche connu du contrat, ses champs dans
// l'ordre du contrat (title compris — c'est un champ comme un autre, à sa place déclarée).
function typesRessourceConfig(langue) {
  return kirby.typesConnus().map((type) => {
    const champFichier = kirby.champFichierDuType(type);
    return {
      valeur: type,
      libelleSection: kirby.libelleType(type, langue),
      libelleAjouter: T('ressource.ajouter.' + type),
      libelleAjouterTip: T('ressource.ajouter.' + type + '.tip'),
      avecImage: !!champFichier,
      champFichier: champFichier,
      champs: kirby.champsDuType(type).map((c) => configChamp(c, langue))
    };
  });
}

// Les rubriques, pour le même formulaire : un type (= une clé du contrat), un titre pris
// dans le contrat — jamais saisi, il se déduit de la langue au rendu. `revues` filtre déjà
// « ressources », propre à la Revue (kirby.rubriquesPourRevue).
function typesRubriqueConfig(revueJeton, langue) {
  return kirby.rubriquesPourRevue(revueJeton).map((r) => ({ valeur: r.cle, libelleSection: r.titre[langue] || r.titre.fr }));
}

// Tous les libellés du formulaire de Documentation qui ne sont pas des noms de champ — ceux-
// là viennent du contrat (configChamp ci-dessus). `revueCible` est le nom affiché de la
// revue vers laquelle « Envoyer » dépose une copie.
//
// ⚠ Une clé oubliée ici ne casse rien : la page affiche « undefined » à sa place. C'est
//   test/js/contrats.test.js qui l'attrape.
function textesDocumentation(revueCible) {
  return {
    detacherTip: T('ressource.detacher.tip'),
    envoyerTip: T('ressource.envoyer.tip', [revueCible || '']),
    choisirFichier: T('medias.choisirFichier'),
    imageAbsente: T('ressource.image.absente'), imageDeposee: T('ressource.image.deposee'),
    errFormat: T('medias.err.format'), errTropVolumineuse: T('medias.err.tropvolumineux'),
    retirerTip: T('ressource.retirer.tip'),
    sansTitre: T('ressource.sansTitre'),
    manque: T('ressource.manque'),
    optionVide: T('ressource.option.vide'),
    badgeIncomplet: T('doc.badge.incomplet'), badgeVide: T('doc.badge.vide'),
    sommaire: T('doc.sommaire'),
    groupeRubriques: T('doc.groupe.rubriques'), groupeFiches: T('doc.groupe.fiches'),
    viderTip: T('rubrique.vider.tip'),
    champContenu: T('rubrique.champ.contenu'),
    champContenuIndice: T('rubrique.champ.contenu.indice'),
    gras: T('rubrique.gras'), grasTip: T('rubrique.gras.tip'),
    italique: T('rubrique.italique'), italiqueTip: T('rubrique.italique.tip'),
    lien: T('rubrique.lien'), lienTip: T('rubrique.lien.tip'),
    liste: T('rubrique.liste'), listeTip: T('rubrique.liste.tip'),
    ajouterLigne: T('doc.suivi.ajouter'), ajouterLigneTip: T('doc.suivi.ajouter.tip'),
    retirerLigneTip: T('doc.suivi.retirer.tip'),
    enregistrer: T('img.enregistrer'), enregistrerTip: T('doc.enregistrer.tip'),
    enregistre: T('doc.enregistre'), nonEnregistre: T('img.nonEnregistre'),
    rienAEcrire: T('doc.rienAEcrire'),
    retour: T('img.retour'), retourTip: T('doc.retour.tip')
  };
}

function htmlDocumentation(nonce) {
  return construireHtml('documentation', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    titre: T('doc.titre', ['']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Dépose l'image d'une fiche AVANT qu'elle n'ait de dossier (elle n'existe encore que dans
// la webview) : mise de côté dans .depot-images/ de l'article, installée dans le dossier de
// la fiche au moment où enregistrer() l'écrit (kirby.ajouterFiche/ecrireFiche, paramètre
// imageSource).
async function deposerImageRessource(fournisseur, panneau, slug, msg) {
  const id = String(msg.id || '');
  const echec = (message) => repondrePanneau(panneau, { type: 'image-erreur', id: id, message: message });
  if (!fournisseur.racine) { echec(T('err.copie', ['?', '?'])); return; }
  if (session.buildEnCours() || session.importEnCours()) { echec(T('statut.occupe')); return; }
  const nom = nomImageAssaini(msg.nomFichier);
  if (!nom) { echec(T('importv.err.format')); return; }
  const donnees = Buffer.from(String(msg.donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { echec(T('importv.err.format')); return; }
  if (donnees.length > TAILLE_MAX_IMAGE_IMPORT) { echec(T('importv.err.tropvolumineux')); return; }
  let cible;
  try { cible = kirby.deposerImageProvisoire(dossierArticleDoc(fournisseur.racine, slug), id, nom, donnees); }
  catch (e) { echec(T('err.copie', [nom, e.message])); return; }
  await ctx.convertirCmykSiBesoin([cible]);       // un JPEG d'imprimerie ne s'affiche pas
  repondrePanneau(panneau, {
    type: 'image-deposee', id: id, image: path.basename(cible).replace(/^[^_]*__/, ''),
    apercu: apercuMedia(cible, { reste: BUDGET_APERCUS_MEDIA })
  });
}

// Crée la page de Documentation du numéro : son dossier, sa fiche de métadonnées de type
// « documentation » et son documentation.<lang>.txt (les rubriques naissent vides). Rend
// le slug, ou null si l'écriture a échoué.
function creerPageDocumentation(fournisseur) {
  const racine = fournisseur.racine;
  const base = path.join(racine, dossierUnites());
  // Un dossier « documentation » déjà pris par autre chose ne doit pas être écrasé : on
  // prend le nom libre suivant.
  let slug = SLUG_DOCUMENTATION;
  let n = 2;
  while (fs.existsSync(path.join(base, slug))) { slug = SLUG_DOCUMENTATION + '-' + n; n++; }
  const langue = langueRevue(racine);
  const titre = {};
  titre[langue] = T('doc.titre.page');
  try {
    fs.mkdirSync(path.join(base, slug), { recursive: true });
    ecrireAtomique(cheminMeta(racine, slug), serialiserMeta({
      type: TYPE_ACTUALITE, lang: langue, doi: '',
      title: titre, subtitle: {}, keywords: {}, author: []
    }));
    kirby.ecrirePage(path.join(base, slug), langue, { title: titre[langue], rubriques: {} });
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [slug, e.message]));
    return null;
  }
  vscode.window.setStatusBarMessage(T('doc.creee'), 5000);
  return slug;
}

// L'en-tête « ACTUALITÉ » cliqué, ou la commande appelée depuis la palette : le formulaire
// de la page de Documentation s'ouvre, et la page se crée si le numéro n'en a pas encore.
async function ouvrirPageDocumentation(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  const profil = session.profilOuvrage() || profils.profilPour('revue');
  if (profil.cle !== 'revue') { return; }      // un livre n'a pas de Documentation
  let slug = fournisseur.slugDocumentation();
  if (!slug) {
    if (refuserSiVerrouille()) { return; }
    slug = creerPageDocumentation(fournisseur);
    if (!slug) { return; }
    if (rafraichirTout) { rafraichirTout(); }
  }
  await ouvrirDocumentation(fournisseur, rafraichirTout, slug);
}

let panneauxDocumentation = new Map();   // slug -> WebviewPanel (un formulaire par unité)

function fermerPanneauxDocumentationDe(racine, slug) {
  const tout = !racine || !slug;
  for (const [cle, panneau] of Array.from(panneauxDocumentation.entries())) {
    if (!tout && cle !== slug) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    panneauxDocumentation.delete(cle);
  }
}

// Les fiches et les rubriques n'existent plus que sur LA page de Documentation du numéro
// (décision de Robin) : `slug` est toujours le sien, fourni par ouvrirPageDocumentation —
// ce formulaire n'a plus de second usage sur un article ordinaire.
async function ouvrirDocumentation(fournisseur, rafraichirTout, slug) {
  if (!fournisseur.racine || !slug) { return; }
  const racine = fournisseur.racine;
  if (!new Set(fournisseur.listerArticles()).has(slug)) {
    vscode.window.setStatusBarMessage(T('ressource.horsarticle'), 4000);
    return;
  }
  ctx.focaliserUnite(fournisseur, slug);
  const dossierArticle = dossierArticleDoc(racine, slug);
  const langue = langueRevue(racine);
  const revueJeton = ctx.revueCourante(racine);
  const existant = panneauxDocumentation.get(slug);
  if (existant) { existant.reveal(vscode.ViewColumn.One); return; }
  await fermerTousLesApercus();
  const titrePanneau = T('doc.titre.page');
  const panneau = vscode.window.createWebviewPanel(
    'szhDocumentation', titrePanneau, vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
  );
  panneauxDocumentation.set(slug, panneau);
  panneau.onDidDispose(() => {
    if (panneauxDocumentation.get(slug) === panneau) { panneauxDocumentation.delete(slug); }
    // Tout ce qui reste dans le dépôt provisoire d'images à la fermeture appartient à une
    // fiche jamais enregistrée (créée puis retirée avant sauvegarde, panneau fermé sans
    // enregistrer) : un .txt ou une image en trop dans l'arborescence serait lu comme
    // contenu par le site Kirby.
    kirby.viderDepotImages(dossierArticle);
  });

  // Un descripteur par fiche d'un type que ce cockpit connaît (kirby.typesConnus()). Une
  // fiche d'un type encore inconnu ici reste sur le disque, invisible à ce panneau.
  function listerRessources(budget) {
    return kirby.listerFiches(dossierArticle, langue).map((f) => {
      const cle = kirby.champFichierDuType(f.type);
      const nomImage = cle ? f.valeurs[cle] : '';
      const apercu = nomImage
        ? apercuMedia(path.join(dossierArticle, f.dossier, nomImage), budget) : null;
      return { id: f.uuid, type: f.type, valeurs: f.valeurs, apercu: apercu };
    });
  }
  function listerRubriques() {
    const page = kirby.lirePage(dossierArticle, langue);
    return kirby.rubriquesPourRevue(revueJeton).map((r) =>
      ({ id: r.cle, type: r.cle, contenu: page.rubriques[r.cle] || '' }));
  }

  async function charger(vers, extra) {
    const budget = { reste: BUDGET_APERCUS_MEDIA };
    repondrePanneau(vers, Object.assign({
      type: 'charger', slug: slug,
      ressources: listerRessources(budget),
      rubriques: listerRubriques(),
      typesConfig: typesRessourceConfig(langue),
      typesRubrique: typesRubriqueConfig(revueJeton, langue),
      accent: ctx.lireCouleurAccent(racine),
      i18n: textesDocumentation(ctx.nomRevueAffiche(reserveLib.autreRevue(revueJeton))),
      limites: ctx.limitesMedias()
    }, extra || {}));
  }

  // Écrit ce que la webview envoie : les fiches, puis les rubriques (si la page en porte).
  // Rend { total, correspondances } — correspondances = les uuid neufs des fiches créées
  // dans ce lot, pour que la webview mette à jour l'identifiant de ses cartes ; ou null en
  // cas d'échec déjà signalé.
  const enregistrer = async (liste, listeRubriques) => {
    let total = 0;
    const correspondances = [];
    for (const r of (Array.isArray(liste) ? liste : [])) {
      const id = String((r && r.id) || '');
      const type = String((r && r.type) || '');
      if (id === '' || !kirby.typeConnu(type)) { continue; }
      const valeurs = Object.assign({}, (r && r.valeurs) || {});
      const dejaLa = kirby.trouverDossierParUuid(dossierArticle, langue, id) !== null;
      if (!dejaLa && !kirby.ficheEcrivable(type, valeurs)) { continue; }
      const imageSource = kirby.imageProvisoire(dossierArticle, id);
      try {
        if (dejaLa) {
          kirby.ecrireFiche(dossierArticle, langue, id, type, valeurs, imageSource);
        } else {
          const cree = kirby.ajouterFiche(dossierArticle, langue, type, valeurs, imageSource);
          correspondances.push({ avant: id, apres: cree.uuid });
        }
      } finally {
        if (imageSource) { kirby.nettoyerImageProvisoire(dossierArticle, id); }
      }
      total++;
    }
    // Les fiches se rangent d'elles-mêmes — une seule fois, après la boucle : leur ordre est
    // un calcul du contrat (kirby.calculerOrdreFiches), jamais l'ordre de saisie.
    if (total > 0) { kirby.reordonnerFiches(dossierArticle, langue); }

    // Les rubriques ensuite, sans tri d'aucune sorte — leur ordre est un choix éditorial.
    if (Array.isArray(listeRubriques) && listeRubriques.length > 0) {
      const pageActuelle = kirby.lirePage(dossierArticle, langue);
      const rubriques = Object.assign({}, pageActuelle.rubriques);
      let touche = false;
      for (const r of listeRubriques) {
        const cle = String((r && r.id) || (r && r.type) || '');
        if (cle === '' || !kirby.rubriquesDuContrat().some((x) => x.cle === cle)) { continue; }
        const contenu = String((r && r.contenu) !== undefined && r.contenu !== null ? r.contenu : '');
        if (rubriques[cle] !== contenu) { touche = true; }
        rubriques[cle] = contenu;
      }
      if (touche) {
        kirby.ecrirePage(dossierArticle, langue,
          { title: pageActuelle.title, uuid: pageActuelle.uuid, rubriques: rubriques });
        total++;
      }
    }
    if (total > 0 && rafraichirTout) { rafraichirTout(); }
    return { total: total, correspondances: correspondances };
  };

  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (ctx.repondreModeTrad(panneau, msg)) { return; }
    if (msg.type === MSG.PRET) { await charger(panneau, { requete: msg.requete }); return; }
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + titrePanneau;
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const resultat = await enregistrer(msg.ressources, msg.rubriques);
      repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto, correspondances: resultat.correspondances });
      if (resultat.total > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('doc.statut.enregistres', [resultat.total]), 5000); }
      return;
    }
    // Une fiche retirée sort de l'arborescence (son dossier entier, image comprise) ; une
    // rubrique vidée reste dans le fichier de page — c'est enregistrer() qui la vide, pas
    // ce message (voir le formulaire).
    if (msg.type === MSG.RETIRER) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: 'erreur', message: T('verrou.refuse') });
        return;
      }
      const id = String(msg.id || '');
      if (id === '' || msg.famille !== 'fiche') { return; }
      const resultat = kirby.retirerFiche(dossierArticle, langue, id);
      if (!resultat.ok) { return; }                  // déjà partie : rien à faire
      kirby.reordonnerFiches(dossierArticle, langue);
      if (rafraichirTout) { rafraichirTout(); }
      return;
    }
    if (msg.type === MSG.DEPOSER_IMAGE) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: 'image-erreur', id: msg.id, message: T('verrou.refuse') });
        return;
      }
      await deposerImageRessource(fournisseur, panneau, slug, msg);
      return;
    }
    // « Mettre en réserve » : la fiche sort de l'article. « Envoyer à l'autre revue » : elle
    // y reste, et c'est une copie qui part.
    if (msg.type === MSG.DETACHER || msg.type === MSG.ENVOYER) {
      if (refuserSiVerrouille()) { return; }
      const id = String(msg.id || '');
      if (id === '') { return; }
      const entree = kirby.trouverDossierParUuid(dossierArticle, langue, id);
      if (!entree) { return; }                        // déjà partie : rien à déposer
      const versAutre = msg.type === MSG.ENVOYER;
      const vers = versAutre ? reserveLib.autreRevue(revueJeton) : revueJeton;
      if (!vers) { return; }
      const ok = ctx.deposerFicheEnReserve(racine, slug, {
        type: entree.type, dossier: path.join(dossierArticle, entree.dossier), langue: langue
      }, vers, versAutre);
      if (!ok) { return; }
      if (versAutre) {
        vscode.window.setStatusBarMessage(T('ressource.envoye'), 5000);
        await charger(panneau);                      // rien n'a bougé sur ce disque : on recharge tel quel
        return;
      }
      kirby.retirerFiche(dossierArticle, langue, id);
      kirby.reordonnerFiches(dossierArticle, langue);
      vscode.window.setStatusBarMessage(T('ressource.detache'), 5000);
      await charger(panneau);
      if (rafraichirTout) { rafraichirTout(); }
      return;
    }
    if (msg.type === MSG.RETOUR_ARTICLE) {
      if (msg.modifie) {
        const choix = await confirmerAbandon(T('doc.quitter.page'));
        if (choix === 'annuler') { return; }          // Annuler : on reste
        if (choix === 'enregistrer') { await enregistrer(msg.ressources, msg.rubriques); }
      }
      // La page de Documentation n'a pas de texte à relire : son arborescence n'est qu'un
      // magasin de fiches et de rubriques, jamais ouverte à la main — le panneau se ferme
      // sur l'arbre.
      panneau.dispose();
      if (rafraichirTout) { rafraichirTout(); }
      return;
    }
    console.warn('documentation : type de message inconnu', msg.type);
  });
  panneau.webview.html = htmlDocumentation(crypto.randomBytes(16).toString('hex'));
}

module.exports = {
  configurer,
  ouvrirDocumentation, ouvrirPageDocumentation, fermerPanneauxDocumentationDe,
  dossierArticleDoc,
  // Les fabriques de libellés du formulaire, exposées pour le contrôle. Elles ne sont pas
  // pures — elles lisent la langue et le contrat — et c'est précisément ce qu'il faut
  // éprouver : test/js/actualite.test.js les appelle dans les deux langues et exige que
  // tout diffère.
  _libelles: { textesDocumentation, typesRessourceConfig, typesRubriqueConfig, optionsInstrument }
};
