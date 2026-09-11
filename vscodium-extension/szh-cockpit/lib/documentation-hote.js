// La Documentation d'un numéro : fiches et rubriques dans un seul formulaire, qui écrit les
// blocs ::: {.szh-ressource type="…"} … et ::: {.szh-rubrique type="…"} …, lus par
// pipeline/filters/szh-ressource.lua et szh-rubrique.lua. Moteur générique — une section par
// type de ressourcesLib.typesConnus() et de rubriquesLib.typesConnus(), plutôt qu'un
// formulaire par type : les tables de champs vivent dans lib/ressources.js et
// lib/rubriques.js, ce fichier ne fait que les lire. Les rubriques ne s'affichent que sur
// une page de Documentation — un article ordinaire peut porter des fiches, jamais un
// « Tour d'horizon ».
//
// Ce que la webview fait seule : ajouter une fiche, la retirer, taper dans ses champs,
// plier et déplier. Ce qui touche le disque : enregistrer (par lot, comme le gestionnaire
// des médias), retirer un bloc déjà écrit, déposer une image de couverture, et les deux
// gestes de réserve.
//
// Une fiche incomplète s'enregistre (lib/ressources.js, ressourceEcrivable) : c'est le
// formulaire qui signale ce qui manque, par une pastille, et non plus l'hôte qui refuse
// d'écrire. Une rubrique vidée, en revanche, sort du .md — un titre de rubrique sans rien
// dessous ne veut rien dire dans le PDF.
//
// ⚠ compterBlocsDocumentation() reste dans extension.js : le fournisseur d'arbre (classe
// FournisseurRevue) l'appelle pour le badge de la section « ACTUALITÉ », et rien ici n'en a
// besoin.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { T, TL, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { refuserSiVerrouille } = require('./cycle-vie');
const { fermerTousLesApercus } = require('./apercu');
const { langueRevue, serialiserMeta, ecrireAtomique } = require('./yaml');
const {
  relatifImageValide, apercuMedia, BUDGET_APERCUS_MEDIA, nomImageAssaini, nomMediaLibre,
  TAILLE_MAX_IMAGE_IMPORT
} = require('./medias');
const cantonsLib = require('./cantons');
const ressourcesLib = require('./ressources');
const rubriquesLib = require('./rubriques');
const reserveLib = require('./reserve');

// Doivent rester alignées avec les constantes du même nom dans extension.js (le type de
// fiche de la page de Documentation, et le slug qu'elle prend par défaut).
const TYPE_ACTUALITE = 'documentation';
const SLUG_DOCUMENTATION = 'documentation';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  focaliserUnite: () => {},
  slugDepuisChemin: () => null,
  ouvrirArticle: async () => {},
  lireCouleurAccent: () => '',
  limitesMedias: () => ({}),
  // Partagés avec la réserve de fiches (lib/reserve.js), qui reste dans extension.js —
  // hors magasin, dans le dossier parent, commune aux deux revues.
  revueCourante: () => 'revue',
  nomRevueAffiche: (revue) => String(revue || ''),
  deposerFicheEnReserve: () => false,
  convertirCmykSiBesoin: async () => 0
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le dossier des unités de texte du profil actif — même calcul que dossierUnites() dans
// extension.js, mais tiré directement de session.profilOuvrage() : ce module n'a pas à le
// recevoir en rappel, lib/profil.js suffit (comme lib/apercu.js et lib/medias-hote.js).
function dossierUnites() {
  return (session.profilOuvrage() || profils.profilPour('revue')).unites.dossier;
}

function cheminMeta(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.meta.yaml');
}

// postMessage tolérant : le panneau peut être fermé pendant le traitement WSL.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// Les libellés des champs bibliographiques, communs aux types qui les partagent (« annee »
// sert à livre ET film) : une seule clé i18n par champ, jamais une par type.
const LIBELLES_CHAMP_RESSOURCE = {
  auteurs: 'ressource.champ.auteurs', annee: 'ressource.champ.annee',
  editeur: 'ressource.champ.editeur', realisateur: 'ressource.champ.realisateur',
  genre: 'ressource.champ.genre', pays: 'ressource.champ.pays',
  distributeur: 'ressource.champ.distributeur',
  canton: 'ressource.champ.canton', categorie: 'ressource.champ.categorie',
  numero: 'ressource.champ.numero', date: 'ressource.champ.date',
  institutions: 'ressource.champ.institutions', debut: 'ressource.champ.debut',
  fin: 'ressource.champ.fin',
  // Champs de la fiche « reprise » (D'une revue à l'autre / Blick in die Revue). `auteurs`
  // est déjà là, partagé avec le livre : une seule clé par champ, jamais une par type.
  revue: 'ressource.champ.revue', reference: 'ressource.champ.reference',
  doi: 'ressource.champ.doi',
  // Champs de la fiche « agenda » (manifestations et formation continue). `debut` et `fin`
  // sont déjà là, partagés avec la recherche en cours — « Début » et « Fin » disent la même
  // chose d'une plage d'années et d'une plage de dates, et la règle du fichier reste une
  // seule clé par nom de champ, jamais une par type.
  evenement: 'ressource.champ.evenement', lieu: 'ressource.champ.lieu',
  organisateur: 'ressource.champ.organisateur'
};

// Les listes fermées offertes à la saisie, par nom. C'est la jonction que lib/ressources.js
// ne fait pas exprès : sa table CHOIX dit quelle liste porte un champ, jamais où cette liste
// vit. Les deux d'aujourd'hui viennent d'endroits différents — les cantons d'un module à
// eux (lib/cantons.js, 26 cantons et la Confédération), les types d'événement d'une liste de
// jetons de lib/ressources.js dont les libellés sont ici traduits — et c'est précisément ce
// que cette indirection permet.
const LISTES_RESSOURCE = {
  canton: () => cantonsLib.optionsCanton(langueCockpit()),
  evenement: () => ressourcesLib.valeursListe('evenement')
    .map((v) => ({ valeur: v, libelle: T('ressource.option.evenement.' + v) }))
};
function optionsChamp(type, cle) {
  const nom = ressourcesLib.listeChamp(type, cle);
  const fabrique = nom ? LISTES_RESSOURCE[nom] : null;
  return fabrique ? fabrique() : null;
}

// La configuration envoyée à la webview : un type par entrée, ses champs bibliographiques
// dans l'ordre de lib/ressources.js (source unique — jamais recopiés ici), chacun avec son
// libellé traduit. C'est ce qui rend le formulaire générique : ajouter un type à
// ressourcesLib.TYPES lui donne une section sans qu'une ligne de ce fichier ne change,
// pourvu que LIBELLES_CHAMP_RESSOURCE connaisse ses champs. `avecImage` (lib/ressources.js,
// typeAvecImage()) dit à la webview si ce type affiche une zone de dépôt — intervention et
// recherche n'en ont pas.
function typesRessourceConfig() {
  return ressourcesLib.typesConnus().map((type) => ({
    valeur: type,
    libelleSection: T('ressource.section.' + type),
    libelleAjouter: T('ressource.ajouter.' + type),
    libelleAjouterTip: T('ressource.ajouter.' + type + '.tip'),
    avecImage: ressourcesLib.typeAvecImage(type),
    champs: ressourcesLib.champsBiblio(type).map((cle) => {
      // `options` et `saisie` n'accompagnent le champ que s'il en a : une liste fermée
      // (canton, type d'événement) ou une date ISO. La webview ne connaît donc aucun nom de
      // champ pour décider de rendre un <select> ou un <input type="date">.
      const champ = { cle: cle, libelle: T(LIBELLES_CHAMP_RESSOURCE[cle] || '') };
      const options = optionsChamp(type, cle);
      if (options) { champ.options = options; }
      const saisie = ressourcesLib.saisieChamp(type, cle);
      if (saisie) { champ.saisie = saisie; }
      return champ;
    })
  }));
}

// Les rubriques, pour le même formulaire : un type, un titre. Ni bouton d'ajout ni compteur
// — chaque type a UN bloc, toujours présent (media/documentation.js). Le titre imprimé,
// lui, ne se saisit jamais : il se déduit du type et de la langue au rendu
// (pipeline/filters/szh-rubrique.lua), et c'est le même titre qui sert ici d'en-tête.
function typesRubriqueConfig() {
  return rubriquesLib.typesConnus().map((type) => ({
    valeur: type,
    libelleSection: T('rubrique.section.' + type)
  }));
}

// Tous les libellés du formulaire de Documentation, les deux familles ensemble.
//
// `revueCible` est le nom affiché de la revue vers laquelle « Envoyer » dépose une copie —
// la revue sœur de celle du numéro ouvert. Il vient de l'appelant, seul à connaître la
// racine, et il est composé ici plutôt que dans la webview : la page ne connaît ni les
// jetons de revue ni la table qui les nomme.
//
// ⚠ Une clé oubliée ici ne casse rien : la page affiche « undefined » à sa place. C'est
//   test/js/contrats.test.js qui l'attrape, en relevant tous les TXT.xxx de
//   media/documentation.js et en exigeant que cette fonction les fournisse.
function textesDocumentation(revueCible) {
  return {
    detacherTip: T('ressource.detacher.tip'),
    envoyerTip: T('ressource.envoyer.tip', [revueCible || '']),
    champTitre: T('ressource.champ.titre'), champTitreIndice: T('ressource.champ.titre.indice'),
    champDescriptif: T('ressource.champ.descriptif'),
    champDescriptifIndice: T('ressource.champ.descriptif.indice'),
    champLien: T('ressource.champ.lien'), champLienIndice: T('ressource.champ.lien.indice'),
    champImage: T('ressource.champ.image'),
    imageAbsente: T('ressource.image.absente'), imageDeposee: T('ressource.image.deposee'),
    choisirFichier: T('medias.choisirFichier'),
    errFormat: T('medias.err.format'), errTropVolumineuse: T('medias.err.tropvolumineux'),
    retirerTip: T('ressource.retirer.tip'),
    sansTitre: T('ressource.sansTitre'),
    manque: T('ressource.manque'),
    optionVide: T('ressource.option.vide'),
    // Les deux pastilles d'en-tête, qui ont remplacé le pavé « À compléter avant
    // l'enregistrement » : une fiche s'écrit incomplète, une rubrique vide ne s'imprime pas.
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

// Dépose l'image de couverture d'une fiche : toujours un fichier neuf dans media/, jamais
// un remplacement — une fiche n'a rien à écraser, à la différence d'une image déjà
// insérée dans le texte de l'article. Redéposer une image sur une fiche qui en portait
// déjà une laisse l'ancien fichier orphelin dans media/, comme « Retirer de la figure »
// ailleurs dans ce fichier (lib/references.js, retirerDeGrille) : le texte se nettoie, pas
// le disque, et rien n'empêche de reprendre ce fichier plus tard.
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
  const dossier = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
  try { fs.mkdirSync(dossier, { recursive: true }); } catch (e) { /* existe déjà */ }
  const nomLibre = nomMediaLibre(dossier, nom);
  const cible = path.join(dossier, nomLibre);
  try {
    // Temporaire « ~$… » puis rename, comme tout dépôt d'image de ce fichier : une
    // écriture interrompue ne doit pas laisser un demi-fichier que la compilation lirait.
    const tmp = path.join(dossier, '~$' + nomLibre);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
  } catch (e) {
    echec(T('err.copie', [nomLibre, e.message]));
    return;
  }
  await ctx.convertirCmykSiBesoin([cible]);       // un JPEG d'imprimerie ne s'affiche pas
  repondrePanneau(panneau, {
    type: 'image-deposee', id: id, image: nomLibre,
    apercu: apercuMedia(cible, { reste: BUDGET_APERCUS_MEDIA })
  });
}

// Crée la page de Documentation du numéro : son dossier, son .md vide et sa fiche de
// métadonnées de type « documentation ». Rend le slug, ou null si l'écriture a échoué.
//
// Le .md naît vide et le reste : ce n'est plus un texte à écrire, seulement le magasin où
// les blocs de fiches et de rubriques s'accumulent. Il faut bien qu'il existe — c'est lui
// que la chaîne compile, et l'ordre du numéro se lit sur les dossiers d'articles — mais
// personne n'a plus à l'ouvrir.
function creerPageDocumentation(fournisseur) {
  const racine = fournisseur.racine;
  const base = path.join(racine, dossierUnites());
  // Un dossier « documentation » déjà pris par autre chose (page importée d'un Word sous ce
  // nom, essai laissé là) ne doit pas être écrasé : on prend le nom libre suivant.
  let slug = SLUG_DOCUMENTATION;
  let n = 2;
  while (fs.existsSync(path.join(base, slug))) { slug = SLUG_DOCUMENTATION + '-' + n; n++; }
  const langue = langueRevue(racine);
  const titre = {};
  titre[langue] = TL(langue, 'doc.titre.page');
  try {
    fs.mkdirSync(path.join(base, slug), { recursive: true });
    ecrireAtomique(path.join(base, slug, slug + '.md'), '');
    ecrireAtomique(cheminMeta(racine, slug), serialiserMeta({
      type: TYPE_ACTUALITE, lang: langue, doi: '',
      title: titre, subtitle: {}, keywords: {}, author: []
    }));
  } catch (e) {
    vscode.window.showWarningMessage(T('err.ecriture', [e.message]));
    return null;
  }
  vscode.window.setStatusBarMessage(T('doc.creee'), 5000);
  return slug;
}

// L'en-tête « ACTUALITÉ » cliqué, ou la commande appelée depuis la palette : le formulaire
// de la page de Documentation s'ouvre, et la page se crée si le numéro n'en a pas encore.
//
// La création seule est refusée sur un numéro verrouillé — la consultation, non : on doit
// pouvoir relire la Documentation d'un numéro déjà bouclé.
async function ouvrirPageDocumentation(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  // ⚠ Un livre n'a pas de Documentation, comme il n'a pas de traductions : la section
  //   n'existe pas dans son arbre, et la commande ne doit pas en fabriquer une par la
  //   palette.
  const profil = session.profilOuvrage() || profils.profilPour('revue');
  if (profil.cle !== 'revue') { return; }
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

// Rappel donné à lib/cycle-vie.js (fermerFormulairesEcriture).
function fermerPanneauxDocumentationDe(racine, slug) {
  const tout = !racine || !slug;
  for (const [cle, panneau] of Array.from(panneauxDocumentation.entries())) {
    if (!tout && cle !== slug) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    panneauxDocumentation.delete(cle);
  }
}

// `cible` est soit un item de l'arbre ({ slug }), soit un slug tout court — c'est par là que
// l'en-tête « ACTUALITÉ » ouvre la page de Documentation du numéro, sans passer par un item.
async function ouvrirDocumentation(fournisseur, rafraichirTout, cible) {
  if (!fournisseur.racine) { return; }
  const racine = fournisseur.racine;
  // Même cascade que les autres formulaires d'article : le slug reçu, l'item de l'arbre,
  // l'éditeur actif, puis l'aperçu courant.
  let slug = (typeof cible === 'string' && cible) ? cible
    : ((cible && cible.slug) ? String(cible.slug) : null);
  if (!slug) {
    const ed = vscode.window.activeTextEditor;
    slug = ed ? ctx.slugDepuisChemin(racine, ed.document.uri.fsPath) : null;
  }
  if (!slug) { slug = session.apercuCourantSlug(); }
  if (!slug || !new Set(fournisseur.listerArticles()).has(slug)) {
    vscode.window.setStatusBarMessage(T('ressource.horsarticle'), 4000);
    return;
  }
  // Les rubriques n'ont de sens que sur une page de Documentation : un article ordinaire
  // peut relever un livre, jamais tenir le « Tour d'horizon » du numéro. C'est aussi ce qui
  // décide du titre du panneau et de ce que fait le bouton « Retour ».
  const pageDoc = fournisseur.estActualite(slug);
  ctx.focaliserUnite(fournisseur, slug);
  const md = path.join(racine, dossierUnites(), slug, slug + '.md');
  const existant = panneauxDocumentation.get(slug);
  if (existant) { existant.reveal(vscode.ViewColumn.One); return; }
  await fermerTousLesApercus();
  const titrePanneau = pageDoc ? T('doc.titre.page') : T('doc.titre', [slug]);
  const panneau = vscode.window.createWebviewPanel(
    'szhDocumentation', titrePanneau, vscode.ViewColumn.One,
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
  );
  panneauxDocumentation.set(slug, panneau);
  panneau.onDidDispose(() => { if (panneauxDocumentation.get(slug) === panneau) { panneauxDocumentation.delete(slug); } });

  async function texteArticle() {
    try {
      const doc = await vscode.workspace.openTextDocument(md);
      return doc.getText();
    } catch (e) { return ''; }
  }

  // Un descripteur par fiche d'un type que ce cockpit connaît (ressourcesLib.typesConnus()).
  // Une fiche d'un type encore inconnu ici (un .md plus récent que l'extension installée,
  // ou un type ajouté côté rendu avant de l'être côté formulaire) reste dans le texte,
  // invisible à ce panneau, et n'est jamais réécrite : enregistrer() ne touche que les
  // identifiants que la webview lui rend, jamais tout le fichier d'un coup.
  function listerRessources(texteMd, budget) {
    const connus = new Set(ressourcesLib.typesConnus());
    const base = path.join(racine, dossierUnites(), slug, 'media');
    return ressourcesLib.lireRessources(texteMd)
      .filter((r) => connus.has(r.type))
      .map((r) => ({
        id: r.id, type: r.type, valeurs: r.valeurs,
        apercu: (r.valeurs.image && relatifImageValide(r.valeurs.image))
          ? apercuMedia(path.join(base, r.valeurs.image), budget) : null
      }));
  }

  // Une rubrique d'un type que ce cockpit ne connaît pas encore (un .md plus récent que
  // l'extension installée, ou l'ancien bloc `agenda` devenu une fiche) reste dans le texte,
  // invisible à ce panneau, et n'est jamais réécrite : enregistrer() ne touche que les
  // identifiants que la webview lui rend.
  function listerRubriques(texteMd) {
    const connus = new Set(rubriquesLib.typesConnus());
    return rubriquesLib.lireRubriques(texteMd)
      .filter((r) => connus.has(r.type))
      .map((r) => ({ id: r.id, type: r.type, contenu: r.contenu }));
  }

  // `extra` porte le jeton de la course pret/charger : `{ requete }` en réponse
  // à « pret ».
  async function charger(vers, extra) {
    const texteMd = await texteArticle();
    const budget = { reste: BUDGET_APERCUS_MEDIA };
    repondrePanneau(vers, Object.assign({
      type: 'charger', slug: slug,
      ressources: listerRessources(texteMd, budget),
      rubriques: pageDoc ? listerRubriques(texteMd) : [],
      typesConfig: typesRessourceConfig(),
      typesRubrique: pageDoc ? typesRubriqueConfig() : [],
      accent: ctx.lireCouleurAccent(racine),
      i18n: textesDocumentation(ctx.nomRevueAffiche(reserveLib.autreRevue(ctx.revueCourante(racine)))),
      // Plafond des images déposées sur une fiche : plus de littéral côté webview.
      limites: ctx.limitesMedias()
    }, extra || {}));
  }

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
      await doc.save();                              // déclenche la recompilation
    } catch (e) {
      repondrePanneau(panneau, { type: 'erreur', message: T('err.ecriture', [e.message]) });
      return false;
    }
    return true;
  };

  // Écrit ce que la webview envoie : les fiches, puis les rubriques. Un bloc dont
  // l'identifiant existe déjà dans le .md est réécrit en place, un autre est ajouté à la
  // suite des blocs de sa famille. Rend le nombre de blocs écrits, ou -1 en cas d'échec
  // déjà signalé.
  //
  // Deux règles distinctes, et la différence est voulue :
  //   - une fiche incomplète s'écrit (ressourceEcrivable), c'est la pastille du formulaire
  //     qui dit ce qui manque. Seule une carte entièrement vide — celle que « Ajouter »
  //     vient de créer — est ignorée ;
  //   - une rubrique vidée sort du .md. Un titre de rubrique sans rien dessous ne veut rien
  //     dire dans le PDF, et c'est ainsi que la corbeille du formulaire opère : elle vide le
  //     texte, elle ne supprime pas un bloc qui doit rester présent à l'écran.
  const enregistrer = async (liste, listeRubriques) => {
    const texte = await texteArticle();
    let travail = texte;
    let total = 0;
    for (const r of (Array.isArray(liste) ? liste : [])) {
      const id = String((r && r.id) || '');
      const type = String((r && r.type) || '');
      if (id === '' || !ressourcesLib.typeValide(type)) { continue; }
      const valeurs = (r && r.valeurs) || {};
      // Une image reçue doit rester un chemin sûr sous media/ ; sinon traitée comme
      // absente plutôt que d'écrire une référence qui casserait le rendu.
      const propre = Object.assign({}, valeurs, {
        image: (valeurs.image && relatifImageValide(valeurs.image)) ? valeurs.image : ''
      });
      const dejaLa = ressourcesLib.lireRessources(travail).some((x) => x.id === id);
      if (!dejaLa && !ressourcesLib.ressourceEcrivable(type, propre)) { continue; }
      const resultat = dejaLa
        ? ressourcesLib.ecrireRessource(travail, id, type, propre)
        : { texte: ressourcesLib.ajouterRessource(travail, id, type, propre), ok: true };
      if (!resultat.ok) { continue; }                // disparue entre-temps : ignorée
      travail = resultat.texte;
      total++;
    }
    // Les fiches se rangent d'elles-mêmes — livres, films et recherches par titre,
    // interventions par canton (lib/ressources.js). Une seule fois, après la boucle : trier
    // à chaque écriture permuterait les blocs entre deux fiches d'un même enregistrement,
    // pour le même résultat. Le tri porte sur le .md et pas sur le seul affichage, parce que
    // le formulaire montre la position de chaque fiche : une position que le document ne
    // respecterait pas mentirait sur l'ordre du PDF.
    // langueRevue() suit désormais le profil (lib/profil.js) : plus besoin du détour par
    // cheminConfig() pour qu'un livre trie dans sa propre langue.
    if (total > 0) {
      const langue = langueRevue(racine);
      travail = ressourcesLib.reordonnerRessources(travail, langue);
    }
    // Les rubriques ensuite, et sans tri d'aucune sorte : leur ordre est un choix éditorial
    // (le Tour d'horizon avant les Références, ou l'inverse, selon le numéro) et non un
    // classement mécanique. Les réordonner dans le dos du rédacteur changerait l'ordre du
    // PDF sans qu'il l'ait demandé.
    for (const r of (Array.isArray(listeRubriques) ? listeRubriques : [])) {
      const id = String((r && r.id) || '');
      const type = String((r && r.type) || '');
      if (id === '' || !rubriquesLib.typeValide(type)) { continue; }
      const contenu = String((r && r.contenu) !== undefined && r.contenu !== null ? r.contenu : '');
      const dejaLa = rubriquesLib.lireRubriques(travail).some((x) => x.id === id);
      if (contenu.trim() === '') {
        if (!dejaLa) { continue; }                   // vide et absente : rien à faire
        const ote = rubriquesLib.retirerRubrique(travail, id);
        if (ote.ok) { travail = ote.texte; total++; }
        continue;
      }
      const resultat = dejaLa
        ? rubriquesLib.ecrireRubrique(travail, id, type, contenu)
        : { texte: rubriquesLib.ajouterRubrique(travail, id, type, contenu), ok: true };
      if (!resultat.ok) { continue; }                // disparue entre-temps : ignorée
      travail = resultat.texte;
      total++;
    }
    if (travail === texte) { return total; }
    if (!(await ecrireTexteArticle(travail))) { return -1; }
    if (rafraichirTout) { rafraichirTout(); }
    return total;
  };

  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) { await charger(panneau, { requete: msg.requete }); return; }
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + titrePanneau;
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const n = await enregistrer(msg.ressources, msg.rubriques);
      if (n < 0) { return; }
      repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto });
      if (n > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('doc.statut.enregistres', [n]), 5000); }
      return;
    }
    // Une fiche retirée sort du .md ; une rubrique aussi, mais son bloc de saisie reste à
    // l'écran (voir le formulaire) : c'est bien le même geste côté disque.
    if (msg.type === MSG.RETIRER) {
      if (refuserSiVerrouille()) {
        // La carte est déjà retirée du DOM côté webview (retrait optimiste) : sans ce
        // message, plus rien ne dit à la page que rien n'a été écrit, et la carte reste
        // disparue pour de bon.
        repondrePanneau(panneau, { type: 'erreur', message: T('verrou.refuse') });
        return;
      }
      const id = String(msg.id || '');
      if (id === '') { return; }
      const texte = await texteArticle();
      const resultat = msg.famille === 'rubrique'
        ? rubriquesLib.retirerRubrique(texte, id)
        : ressourcesLib.retirerRessource(texte, id);
      if (!resultat.ok) { return; }                  // déjà partie : rien à faire
      if (!(await ecrireTexteArticle(resultat.texte))) { return; }
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
    // y reste, et c'est une copie qui part. Les deux passent par le même dépôt, la
    // différence tient aux deux derniers arguments (revue visée, à traduire) et au retrait.
    if (msg.type === MSG.DETACHER || msg.type === MSG.ENVOYER) {
      if (refuserSiVerrouille()) { return; }
      const id = String(msg.id || '');
      if (id === '') { return; }
      const texte = await texteArticle();
      const fiche = ressourcesLib.lireRessources(texte).find((f) => f.id === id);
      if (!fiche) { return; }                        // déjà partie du .md : rien à déposer
      const versAutre = msg.type === MSG.ENVOYER;
      const vers = versAutre ? reserveLib.autreRevue(ctx.revueCourante(racine)) : ctx.revueCourante(racine);
      if (!vers) { return; }
      if (!ctx.deposerFicheEnReserve(racine, slug, fiche, vers, versAutre)) { return; }
      if (versAutre) {
        vscode.window.setStatusBarMessage(T('ressource.envoye'), 5000);
        await charger(panneau);                      // rien n'a bougé dans le .md : on recharge tel quel
        return;
      }
      const resultat = ressourcesLib.retirerRessource(texte, id);
      if (resultat.ok && !(await ecrireTexteArticle(resultat.texte))) { return; }
      vscode.window.setStatusBarMessage(T('ressource.detache'), 5000);
      await charger(panneau);
      if (rafraichirTout) { rafraichirTout(); }
      return;
    }
    if (msg.type === MSG.RETOUR_ARTICLE) {
      // Garde « non enregistré », comme dans le gestionnaire des médias.
      if (msg.modifie) {
        const choix = await vscode.window.showWarningMessage(
          pageDoc ? T('doc.quitter.page') : T('doc.quitter.question', [slug]),
          { modal: true, detail: T('table.quitter.detail') },
          T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
        if (choix === undefined) { return; }          // Annuler : on reste
        if (choix === T('form.enregistrer')) {
          const n = await enregistrer(msg.ressources, msg.rubriques);
          if (n < 0) { return; }                      // échec d'écriture : on reste
          if (n > 0) { vscode.window.setStatusBarMessage(T('doc.statut.enregistres', [n]), 5000); }
        }
      }
      // Une page de Documentation n'a pas de texte à relire : son .md n'est plus qu'un
      // magasin de blocs, jamais ouvert à la main. Le panneau se ferme donc sur l'arbre,
      // et non sur un éditeur de markdown.
      if (!pageDoc) { await ctx.ouvrirArticle(fournisseur, slug); }
      panneau.dispose();
      if (pageDoc && rafraichirTout) { rafraichirTout(); }
      return;
    }
    console.warn('documentation : type de message inconnu', msg.type);
  });
  panneau.webview.html = htmlDocumentation(crypto.randomBytes(16).toString('hex'));
}

module.exports = {
  configurer,
  ouvrirDocumentation, ouvrirPageDocumentation, fermerPanneauxDocumentationDe,
  // Les trois fabriques de libellés du formulaire, exposées pour le contrôle. Elles ne
  // sont pas pures — elles lisent la langue du cockpit — et c'est précisément ce qu'il
  // faut éprouver : test/js/actualite.test.js les appelle dans les deux langues et exige
  // que tout diffère. Un libellé écrit en dur ici, ou resté français dans la table
  // allemande, ne se voit d'aucune autre façon : la parité des clés (contrats.test.js) ne
  // regarde pas les valeurs, et le formulaire, lui, n'est lu que par la rédaction.
  _libelles: { textesDocumentation, typesRessourceConfig, typesRubriqueConfig }
};
