// Les vues d'ensemble des sections (traductions, Word, contrôles) : une page par section,
// la même webview pour toutes. Les rappels vers l'hôte passent par configurer().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { panneauUnique, revelerPanneau } = require('./webviews/panneau');
const { langueRevue } = require('./yaml');
const { slugifierArticle } = require('./slug');
const { libelleArticle, prefixeDossier, titreFiche } = require('./articles');
const { analyserJournal } = require('./journal');
const tableConstats = require('./constats');
const { refuserSiVerrouille } = require('./cycle-vie');
const { repondreModeTrad } = require('./traduction-hote');
const controlesHote = require('./controles-hote');

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois dans extension.js. Les valeurs par défaut ne servent qu'à ne pas
// planter un test qui require ce module seul.
let ctx = {
  // Le suivi de traduction d'un article, et la campagne de statut sur tout le numéro.
  etatTraduction: () => ({ meta: {}, suivi: { commentaire: '' }, lignes: [], resume: null }),
  marquerToutStatutRevue: () => 0,
  lireCouleurAccent: () => ''
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function profilCourant() { return profils.courant(); }

// postMessage tolérant : le panneau peut être fermé pendant le traitement.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// Cliquer l'onglet d'une section de la barre latérale ouvre une page : les commandes
// globales y ont un bouton avec un texte, au lieu des pictogrammes muets que l'arbre
// alignait dans sa marge. La webview est la même pour toutes les sections
// (media/vue-ensemble.*) : elle ne fait que poser ce que l'hôte lui envoie.

const panneauxVue = new Map();       // type -> panneau, un seul par section

function htmlVueEnsemble(nonce, titre) {
  return construireHtml('vue-ensemble', nonce, {
    cssPartage: ['_design.css', '_liste.css'], jsPartage: ['_messages.js'], titre: titre
  });
}

function textesVueEnsemble() {
  return { ouvrir: T('vue.ouvrir'), listeVide: T('vue.rien'),
           fermerConstat: T('ctl.constat.fermer') };
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
  // Jamais la page de Documentation : voir slugsTraduisibles().
  const slugs = fournisseur.slugsTraduisibles();
  for (const slug of slugs) {
    const etat = ctx.etatTraduction(racine, slug, source);
    // Le titre de l'article, et son slug juste à côté : le même nom que partout ailleurs —
    // le numéro du dossier, pas un rang. La fiche vient d'etatTraduction, qui l'a déjà lue.
    const nom = libelleArticle(prefixeDossier(slug), slug, titreFiche(etat.meta, source));
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
  const noms = fournisseur._docxEnAttente(path.join(racine, profilCourant().depot));
  // Un import refusé dont le Word a été retiré du dépôt n'a plus rien à dire.
  const words = new Set(noms.map(slugifierArticle));
  for (const entree of lireRapportImport(racine)) {
    if (entree.slug && !words.has(entree.slug) && !fournisseur._articleExiste(entree.slug)) { continue; }
    lignes.push({
      cle: '', groupe: T('word.vue.rapport'), titre: entree.nom,
      pastilles: [{ texte: entree.libelle, ton: entree.ton, icone: entree.icone }],
      notif: entree.ligne === '' ? null : { ton: entree.ton === '' ? 'info' : entree.ton, texte: entree.ligne },
      messages: entree.messages || [],
      ouvrir: false
    });
  }
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

const RANG_TON = { danger: 0, attention: 1, info: 2 };

// Les avertissements de l'import, une carte par article : chaque défaut y dit ce qui est en
// cause (« Étiquette inconnue dans les métadonnées : Mots-clés (FR) »), le geste à faire, et
// l'explication complète derrière « Pourquoi ? » — la même forme que la vue Contrôles. Les
// champs laissés vides n'en font qu'un, qui les nomme tous. Le lecteur écrit chaque ligne
// deux fois dans le journal : une seule est gardée. Chacun se ferme d'une croix, comme dans
// la vue Contrôles et avec la même mémoire (controlesHote.fermerConstat).
function avertissementsImport(racine, texte, langue) {
  const fermes = controlesHote.constatsFermes();
  const vus = new Set();
  const constats = analyserJournal(texte, langue).filter((c) => {
    if (c.source !== 'import' || c.code === 'echec' || c.code === 'restes') { return false; }
    const k = c.slug + '\u0001' + c.code + '\u0001' + JSON.stringify(c.args || []);
    if (vus.has(k)) { return false; }
    vus.add(k);
    return true;
  });
  const parArticle = new Map();
  for (const c of tableConstats.regrouper(constats, () => null)) {
    const ton = c.ton || tableConstats.ton(c, {});
    const noms = tableConstats.elements(c, langue).map((el) => el.libelle);
    const titre = tableConstats.phrase(c, langue) + (noms.length > 0 ? (langue === 'de' ? ': ' : ' : ') + noms.join(', ') : '');
    const consigne = tableConstats.consigne(c, langue);
    const texteMsg = titre + (consigne ? ' ' + consigne : '');
    // La même empreinte que dans la vue Contrôles : fermé ici, fermé là-bas.
    const empreinte = controlesHote.empreinteConstat(racine, c, controlesHote.texteConstat(c, langue));
    if (fermes.has(empreinte)) { continue; }
    if (!parArticle.has(c.slug)) { parArticle.set(c.slug, []); }
    parArticle.get(c.slug).push({
      ton: ton, titre: titre, elements: [], consigne: consigne,
      infobulle: tableConstats.infobulle(c, langue), pourquoi: T('ctl.pourquoi'),
      texte: texteMsg, action: null, fermable: true, empreinte: empreinte
    });
  }
  const entrees = [];
  for (const [slug, messages] of parArticle) {
    messages.sort((a, b) => (RANG_TON[a.ton] ?? 3) - (RANG_TON[b.ton] ?? 3));
    const pire = messages[0].ton;
    entrees.push({
      nom: slug === '' ? T('ctl.numero') : T('ctl.article', [slug]),
      slug: slug, ligne: '', messages: messages,
      libelle: T(pire === 'danger' ? 'ctl.badge.bloquant' : 'ctl.badge.avert'),
      ton: pire, icone: pire
    });
  }
  return entrees;
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
  try { texte = fs.readFileSync(path.join(racine, profilCourant().depot, '.import.log'), 'utf8'); }
  catch (e) { return []; }
  const entrees = avertissementsImport(racine, texte, langueCockpit());
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
    // Les Word livrés portent presque toujours des espaces : on prend tout ce qui suit le
    // deux-points jusqu'à l'extension (.docx ou .odt), sans quoi le titre de la carte
    // serait un fragment.
    const m = ligne.match(/:\s*(.+?\.(?:docx|odt))/i);
    entrees.push({ nom: m ? m[1] : ligne, ligne: m ? ligne : '', libelle: libelle, ton: ton, icone: icone });
  }
  return entrees;
}

// ---- Envoi, ouverture et gestes des sections --------------------------------------
const VUES = {
  traductions: { charge: vueTraductions, id: 'szhVueTraductions' },
  word: { charge: vueWord, id: 'szhVueWord' },
  controles: { charge: controlesHote.vueControles, id: 'szhVueControles' }
};

// Hors de ouvrirVueEnsemble : la fin d'une compilation doit pouvoir rafraîchir une vue
// déjà ouverte sans repasser par la commande, qui la révélerait sous les yeux du rédacteur.
// `focus` ne voyage que dans LA charge initiale d'un panneau qui vient de s'ouvrir (voir
// ouvrirVueEnsemble) : un rafraîchissement ordinaire (action, croix fermée) n'en porte pas,
// et la page ne remarque donc jamais un focus périmé.
function envoyerVue(panneau, fournisseur, type, focus) {
  const charge = VUES[type].charge(fournisseur);
  const valeurs = Object.assign({ type: MSG.VALEURS }, charge, {
    accent: ctx.lireCouleurAccent(fournisseur.racine), i18n: textesVueEnsemble()
  });
  if (focus) { valeurs.focus = focus; }
  repondrePanneau(panneau, valeurs);
  panneau.title = charge.titre;
}

// `item` ({ slug, focus }) vient d'un bouton de constat (lib/constats.js, lieu 'word') :
// focus nomme un fichier Word que la vue doit amener à l'écran et marquer. Les deux chemins
// du rédacteur qui clique deux fois de suite doivent marcher : le panneau est déjà ouvert
// (un message FOCALISER dédié lui parvient, la vue tournant déjà) ou il s'ouvre à l'instant
// (le focus voyage dans la toute première « valeurs », avant que PRET ne reparte).
async function ouvrirVueEnsemble(fournisseur, rafraichirTout, type, item) {
  if (!fournisseur.racine || !VUES[type]) { return; }
  const def = VUES[type];
  const focus = item && typeof item === 'object' ? String(item.focus || '') : '';
  const envoyer = (panneau) => envoyerVue(panneau, fournisseur, type);
  // panneauxVue reste la garde : les rafraîchissements de la vue Contrôles y lisent le panneau.
  const ouvert = revelerPanneau({ viewType: def.id, cle: type, garde: panneauxVue });
  if (ouvert) {
    envoyer(ouvert);
    if (focus !== '') { repondrePanneau(ouvert, { type: MSG.FOCALISER, focus: focus }); }
    return;
  }
  const charge = def.charge(fournisseur);
  // Les gestionnaires ne sont appelés qu'une fois cette fonction finie.
  const { panneau } = panneauUnique({
    viewType: def.id, cle: type, titre: charge.titre, garde: panneauxVue,
    // Mode « Trad » : l'état du mode, et le clic détourné — voir repondreModeTrad.
    modeTrad: (panneau, msg) => repondreModeTrad(panneau, msg),
    html: (nonce) => htmlVueEnsemble(nonce, charge.titre),
    // Seule réponse au tout premier PRET de ce panneau : `focus` (capturé ci-dessus) part
    // avec cette « valeurs »-là, jamais avec celles qui suivent (envoyer(), plus bas, n'en
    // porte pas).
    surPret: (msg, p) => envoyerVue(p, fournisseur, type, focus),
    surMessage: (msg) => traiterMessage(msg)
  });
  async function traiterMessage(msg) {
    // La croix d'un constat gris. Retenue, puis la vue est renvoyée : la page l'a déjà
    // retirée de son côté, mais c'est l'hôte qui décide de ce qu'elle montre, et le lot
    // « Pour information » peut s'être vidé en entier.
    if (msg.type === MSG.CONSTAT_FERMER) {
      if (await controlesHote.fermerConstat(msg.empreinte)) {
        envoyer(panneau);
        // Un avertissement d'import se lit dans « Word en attente » ET dans « Contrôles » :
        // fermé dans l'une, il quitte l'autre.
        for (const autre of ['word', 'controles']) {
          if (autre !== type) { rafraichirVueOuverte(fournisseur, autre); }
        }
      }
      return;
    }
    if (msg.type === MSG.OUVRIR) {
      // Par la commande, et non par la fonction : c'est cmdEcriture qui porte la garde du
      // verrou. Ouvrir en direct laissait écrire un numéro verrouillé, l'enregistrement
      // automatique du panneau de traduction s'en chargeant trois secondes plus tard.
      if (type === 'traductions') {
        await vscode.commands.executeCommand('szh.traduction', { slug: String(msg.cle || '') });
      }
      // La vue Contrôles n'envoie plus « ouvrir » : son bouton doublait celui du constat,
      // qui mène au même endroit et plus précisément (vueControles).
      return;
    }
    if (msg.type !== MSG.ACTION) {
      console.warn('vue d’ensemble : type de message inconnu', msg.type);
      return;
    }
    // L'état part après le re-rendu : « valeurs » reconstruit la barre, et donc efface la
    // zone d'état. Une commande déléguée qui lève ne doit pas laisser la vue périmée.
    let dit = null;
    try {
      dit = await actionVue(fournisseur, rafraichirTout, type, String(msg.id || ''),
        String(msg.cle || ''));
    }
    catch (e) { dit = T('err.commande', [e && e.message ? e.message : String(e)]); }
    if (panneauxVue.get(type) !== panneau) { return; }
    envoyer(panneau);
    if (dit) { repondrePanneau(panneau, { type: MSG.ETAT, message: dit }); }
  }
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
    return T('vue.faits', [ctx.marquerToutStatutRevue(fournisseur, rafraichirTout, statut, false)]);
  }
  if (type === 'controles') {
    // Recompiler refait tous les contrôles : c'est le seul geste global de cette vue, le
    // reste se corrige article par article (controlesHote.actionControles).
    if (id === 'recompiler') { await vscode.commands.executeCommand('szh.toutExporter'); return null; }
    return controlesHote.actionControles(fournisseur, id, cle);
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
    if (session.buildEnCours() || session.importEnCours()) { return T('statut.occupe'); }
    const dossierWord = path.join(fournisseur.racine, profilCourant().depot);
    const noms = fournisseur._docxEnAttente(dossierWord);
    if (noms.length === 0) { return null; }
    const bouton = T('word.vue.vider.bouton');
    const choix = await vscode.window.showWarningMessage(
      T('word.vue.vider.question', [noms.length]),
      { modal: true, detail: T('word.vue.vider.detail') }, bouton);
    if (choix !== bouton) { return null; }
    const erreurs = [];
    for (const nom of noms) {
      try { fs.unlinkSync(path.join(dossierWord, nom)); }
      catch (e) { erreurs.push(nom); }
    }
    if (erreurs.length > 0) { vscode.window.showErrorMessage(T('word.vue.vider.erreur', [erreurs.join(', ')])); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('word.vue.vide', [noms.length - erreurs.length]);
  }
  return null;
}

// La fin d'une compilation rafraîchit la vue de cette section si elle est ouverte, sans la
// révéler.
function rafraichirVueOuverte(fournisseur, type) {
  const ouverte = panneauxVue.get(type);
  if (ouverte) { envoyerVue(ouverte, fournisseur, type); }
}

function envoyerAVueOuverte(type, message) {
  const ouverte = panneauxVue.get(type);
  if (ouverte) { repondrePanneau(ouverte, message); }
}

module.exports = {
  configurer, ouvrirVueEnsemble, rafraichirVueOuverte, envoyerAVueOuverte,
  vueTraductions, vueWord, lireRapportImport
};
