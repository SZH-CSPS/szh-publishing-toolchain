// Rendu autonome du formulaire Documentation (media/documentation.html/.css/.js), hors
// toolkit — un outil de développement, jamais déployé sur un poste de rédaction. Écrit un
// HTML autonome sous os.tmpdir() : mêmes CSS et JS que la vraie webview (assemblés par
// lib/webviews/util.js#construireHtml, la fonction que l'hôte utilise réellement), avec des
// données factices réalistes et un shim `acquireVsCodeApi()` qui répond localement au lieu
// d'un vrai hôte VSCodium — jamais de vscode-resource:, un simple fichier à ouvrir.
//
// Sert à juger le rendu des trois onglets (Traductions à faire, Réservoir, Documentation du
// numéro) sans ouvrir VSCodium — voir docs/notes de session « aperçu d'une webview hors de
// l'éditeur » (WSL/Edge headless, capture PNG avant/après).
//
// Usage :
//   node outils-dev/apercu-documentation.js
//   node outils-dev/apercu-documentation.js reservoir   (ouvre directement cet onglet)
//   node outils-dev/apercu-documentation.js traductions
//
// Capture (Edge headless, depuis Windows) :
//   msedge --headless --disable-gpu --screenshot=<sortie.png> --window-size=1400,1400 "<chemin-html>"
//   msedge --headless --disable-gpu --screenshot=<sortie.png> --window-size=1400,1400 "<chemin-html>?onglet=reservoir"
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const COCKPIT = path.join(__dirname, '..', 'vscodium-extension', 'szh-cockpit');
const { construireHtml } = require(path.join(COCKPIT, 'lib', 'webviews', 'util.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));

// ---- Libellés : la même fonction que l'hôte, mais lue directement (pas de require('vscode')
// transitif dans documentation-hote.js à ce point du fichier — cycle-vie.js, apercu.js…) :
// on rejoue ici exactement ce que textesDocumentation() compose, champ par champ.
function textesDocumentation() {
  return {
    choisirFichier: T('medias.choisirFichier'),
    imageAbsente: T('ressource.image.absente'), imageDeposee: T('ressource.image.deposee'),
    errFormat: T('medias.err.format'), errTropVolumineuse: T('medias.err.tropvolumineux'),
    retirerTip: T('ressource.retirer.tip'), supprimerTip: T('ressource.supprimer.tip'),
    sansTitre: T('ressource.sansTitre'), manque: T('ressource.manque'), optionVide: T('ressource.option.vide'),
    badgeIncomplet: T('doc.badge.incomplet'), badgeVide: T('doc.badge.vide'),
    sommaire: T('doc.sommaire'), groupeRubriques: T('doc.groupe.rubriques'), groupeFiches: T('doc.groupe.fiches'),
    viderTip: T('rubrique.vider.tip'),
    champContenu: T('rubrique.champ.contenu'), champContenuIndice: T('rubrique.champ.contenu.indice'),
    gras: T('rubrique.gras'), grasTip: T('rubrique.gras.tip'),
    italique: T('rubrique.italique'), italiqueTip: T('rubrique.italique.tip'),
    lien: T('rubrique.lien'), lienTip: T('rubrique.lien.tip'),
    liste: T('rubrique.liste'), listeTip: T('rubrique.liste.tip'),
    ajouterLigne: T('doc.suivi.ajouter'), ajouterLigneTip: T('doc.suivi.ajouter.tip'),
    retirerLigneTip: T('doc.suivi.retirer.tip'),
    enregistrer: T('img.enregistrer'), enregistrerTip: T('doc.enregistrer.tip'),
    enregistre: T('doc.enregistre'), nonEnregistre: T('img.nonEnregistre'), rienAEcrire: T('doc.rienAEcrire'),
    retour: T('img.retour'), retourTip: T('doc.retour.tip'),
    ongletTraductions: T('doc.onglet.traductions'), ongletReservoir: T('doc.onglet.reservoir'),
    ongletNumero: T('doc.onglet.numero'),
    traductionsVide: T('doc.traductions.vide'),
    traduireDansNumero: T('doc.traductions.traduire'), traduireDansNumeroTip: T('doc.traductions.traduire.tip'),
    reservoirFiltre: T('doc.reservoir.filtre'), reservoirFiltreTous: T('doc.reservoir.filtre.tous'),
    reservoirVide: T('doc.reservoir.vide'),
    reservoirATraduire: T('doc.reservoir.atraduire'), reservoirATraduireTip: T('doc.reservoir.atraduire.tip'),
    reservoirIgnorer: T('doc.reservoir.ignorer'), reservoirIgnorerTip: T('doc.reservoir.ignorer.tip'),
    reservoirAfficherIgnorees: T('doc.reservoir.afficherIgnorees'),
    reservoirToutSelectionner: T('doc.reservoir.toutSelectionner'),
    reservoirAnnuler: T('doc.reservoir.annuler'), reservoirAnnulerTip: T('doc.reservoir.annuler.tip'),
    orphelinesTitre: T('doc.orphelines.titre'), orphelinesVide: T('doc.orphelines.vide'),
    tirerDansNumero: T('doc.orphelines.tirer'), tirerDansNumeroTip: T('doc.orphelines.tirer.tip')
  };
}

// ---- typesConfig / typesRubrique : composés depuis le contrat réel, comme configChamp() /
// typesRessourceConfig() de lib/documentation-hote.js — jamais recopiés à la main, pour ne
// jamais montrer un formulaire que le contrat ne produirait pas vraiment.
function optionsInstrument(canton, langue) {
  return kirby.ordreInstruments(canton).map((jeton) => {
    const libelle = ((kirby.valeursListe('instrument').find((x) => x.jeton === jeton) || {})[langue]) || jeton;
    const suffixe = kirby.instrumentEstLocal(jeton) ? ' (' + kirby.cantonsInstrument(jeton).join(', ') + ')' : '';
    return { valeur: jeton, libelle: libelle + suffixe };
  });
}
function tableInstrumentsParCanton(langue) {
  const table = { '': optionsInstrument('', langue) };
  for (const c of kirby.valeursListe('canton')) { table[c.jeton] = optionsInstrument(c.jeton, langue); }
  return table;
}
function optionsListe(nom, langue) {
  return kirby.valeursListe(nom).map((v) => ({ valeur: v.jeton, libelle: v[langue] || v.fr }));
}
function champDuTypeParCle(cle) {
  for (const type of kirby.typesConnus()) { const c = kirby.champDuType(type, cle); if (c) { return c; } }
  return null;
}
function configChamp(champ, langue) {
  const c = { cle: champ.cle, libelle: champ.libelle[langue] || champ.libelle.fr, saisie: champ.saisie, requis: !!champ.requis };
  if (champ.quand) { c.quand = champ.quand; }
  if (champ.saisie === 'liste') {
    c.options = optionsListe(champ.liste, langue);
    if (champ.liste === 'instrument') { c.dependDe = 'canton'; c.optionsParCanton = tableInstrumentsParCanton(langue); }
  }
  if (champ.saisie === 'structure') { c.structureChamps = champ.champs.map((sc) => configChamp(sc, langue)); }
  if (champ.saisie === 'fichier') { c.extensions = champ.extensions || []; }
  if (champ.saisie === 'derive') {
    c.depuis = champ.depuis;
    c.table = {};
    const source = champDuTypeParCle(champ.depuis);
    if (source && source.saisie === 'liste') {
      for (const opt of optionsListe(source.liste, langue)) { c.table[opt.valeur] = kirby.valeurDerive(champ, { [champ.depuis]: opt.valeur }); }
    }
  }
  return c;
}
function typesRessourceConfig(langue) {
  return kirby.typesConnus().map((type) => {
    const champFichier = kirby.champFichierDuType(type);
    return {
      valeur: type, libelleSection: kirby.libelleType(type, langue),
      libelleAjouter: T('ressource.ajouter.' + type), libelleAjouterTip: T('ressource.ajouter.' + type + '.tip'),
      avecImage: !!champFichier, champFichier: champFichier,
      champs: kirby.champsDuType(type).map((c) => configChamp(c, langue))
    };
  });
}
function typesRubriqueConfig(langue) {
  return kirby.rubriquesPourRevue('revue').map((r) => ({ valeur: r.cle, libelleSection: r.titre[langue] || r.titre.fr }));
}

// ---- Données factices réalistes ------------------------------------------------------

const rubriques = [
  { id: 'dossier_references', type: 'dossier_references',
    contenu: 'Dupont, A. (2025). *Le développement du langage chez l’enfant.* Editions SZH.\n\nMorand, R. (2026). L’inclusion scolaire en pratique. [Lire en ligne](https://exemple.org/a)' },
  { id: 'dossier_liens', type: 'dossier_liens',
    contenu: '[Office fédéral des assurances sociales](https://www.bsv.admin.ch)\n\n[Centre suisse de pédagogie spécialisée](https://www.csps.ch)' },
  { id: 'ressources', type: 'ressources', contenu: '' },
  { id: 'podcasts', type: 'podcasts', contenu: 'Une série de trois épisodes sur l’inclusion scolaire, produite par la RTS.' }
];

const ressources = [
  { id: 'r1', type: 'livre', apercu: null, valeurs: {
    categorie: 'manuel', title: 'Grandir avec un handicap', auteurs: 'A. Dupont, B. Martin',
    annee: '2026', editeur: 'Editions SZH', lien: 'https://exemple.org/livre', lien_libelle: '',
    descriptif: 'Un manuel de référence pour les professionnel·le·s de la pédagogie spécialisée.',
    couverture: '' } },
  { id: 'r2', type: 'film', apercu: null, valeurs: {
    title: 'Autrement capable', categorie: 'documentaire', realisateur: 'C. Perret', annee: '2025',
    distributeur: 'Trigon-Film', lien: 'https://exemple.org/film', lien_libelle: '',
    descriptif: 'Portrait de trois jeunes en situation de handicap et de leur parcours scolaire.',
    couverture: '' } },
  { id: 'r3', type: 'intervention', apercu: null, valeurs: {
    canton: 'ZH', categorie: 'motion', curia: '5', numero: '26.3456', date: '2026-03-12',
    title: 'Pour un renforcement de la pédagogie spécialisée', lien: 'https://curia.example/26.3456',
    etat: 'en-traitement', etat_date: '2026-06-01', suivi: [
      { date: '2026-06-01', genre: 'prise-position', libelle: 'Le Conseil fédéral propose le rejet', lien: '' }
    ], source: 'curia',
    descriptif: 'Demande une meilleure dotation des cantons pour la pédagogie spécialisée.' } },
  { id: 'r4', type: 'horizon', apercu: null, valeurs: {
    portee: 'national', canton: '', title: 'Nouvelle stratégie nationale sur le handicap',
    descriptif: 'Le Conseil fédéral publie sa stratégie 2026-2030.', lien: 'https://exemple.org/horizon',
    lien_libelle: '' } },
  { id: 'r5', type: 'agenda', apercu: null, valeurs: {
    evenement: 'colloque', title: 'Journée romande de la pédagogie spécialisée', debut: '2026-11-05',
    fin: '2026-11-05', lieu: 'Lausanne', organisateur: 'CSPS',
    descriptif: 'Une journée de conférences et d’ateliers pour les praticien·ne·s.', lien: '' } }
];

const traductions = [
  { slug: 'demo-trad-1', type: 'livre', typeLibelle: kirby.libelleType('livre', 'fr'),
    titre: 'Anders fähig', origine: 'Zeitschrift, numéro 2026-02' },
  { slug: 'demo-trad-2', type: 'horizon', typeLibelle: kirby.libelleType('horizon', 'fr'),
    titre: 'Neue Behindertenstrategie des Bundes', origine: 'Zeitschrift, numéro 2026-02' }
];

// Réservoir : quatre fiches allemandes rattachées à un numéro de la Zeitschrift, dont une
// déjà ignorée — l'interrupteur « Afficher les ignorées » (RESERVOIR_FILTRE, géré par le
// shim plus bas) fait vraiment basculer entre les deux vues, comme le ferait l'hôte réel.
const reservoirNumeros = [{ id: 'demo-num-zeitschrift', nom: 'Zeitschrift 2026-02' }];
const reservoirActives = [
  { slug: 'demo-res-1', uuid: 'res-uuid-1', type: 'livre', typeLibelle: kirby.libelleType('livre', 'fr'),
    titre: 'Vielfalt leben', ausgabeSource: 'demo-num-zeitschrift', ignoree: false },
  { slug: 'demo-res-2', uuid: 'res-uuid-2', type: 'film', typeLibelle: kirby.libelleType('film', 'fr'),
    titre: 'Wege zur Inklusion', ausgabeSource: 'demo-num-zeitschrift', ignoree: false },
  { slug: 'demo-res-3', uuid: 'res-uuid-3', type: 'recherche', typeLibelle: kirby.libelleType('recherche', 'fr'),
    titre: 'Frühförderung im Kanton Bern', ausgabeSource: 'demo-num-zeitschrift', ignoree: false }
];
const reservoirIgnorees = [
  { slug: 'demo-res-4', uuid: 'res-uuid-4', type: 'agenda', typeLibelle: kirby.libelleType('agenda', 'fr'),
    titre: 'Weiterbildung Sonderpädagogik', ausgabeSource: 'demo-num-zeitschrift', ignoree: true }
];

const orphelines = [
  { slug: 'demo-orph-1', uuid: 'orph-uuid-1', type: 'livre', typeLibelle: kirby.libelleType('livre', 'fr'),
    titre: 'Un livre détaché d’un ancien numéro' },
  { slug: 'demo-orph-2', uuid: 'orph-uuid-2', type: 'reprise', typeLibelle: kirby.libelleType('reprise', 'fr'),
    titre: 'Une reprise jamais rattachée' }
];

const txt = textesDocumentation();
const messageCharger = {
  type: 'charger', slug: 'documentation', accent: 'bleuacier', i18n: txt,
  typesConfig: typesRessourceConfig('fr'), typesRubrique: typesRubriqueConfig('fr'),
  rubriques: rubriques, ressources: ressources,
  traductions: traductions, reservoirNumeros: reservoirNumeros, reservoir: reservoirActives,
  orphelines: orphelines,
  limites: { image: { extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'], maxi: 8 * 1024 * 1024 } }
};

// ---- Assemblage : le même appel que documentation-hote.js#htmlDocumentation -----------
const nonce = crypto.randomBytes(16).toString('hex');
const html = construireHtml('documentation', nonce, {
  cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
  titre: 'Documentation – aperçu autonome',
  csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
});

// ---- Shim : un faux hôte, dans la page elle-même ---------------------------------------
//
// Répond de façon SYNCHRONE à « pret » (dispatchEvent, pas postMessage — qui serait
// asynchrone) : le rendu est donc déjà complet avant que le script principal ne rende la
// main, aucune capture d'écran ne peut arriver « trop tôt ». Le même nonce que le script
// principal, exigé par la CSP `script-src 'nonce-…'`. `?onglet=reservoir|traductions|numero`
// bascule directement sur cet onglet, pour capturer chaque onglet séparément.
const shim = '<script nonce="' + nonce + '">\n' +
  '(function () {\n' +
  '  var CHARGER = ' + JSON.stringify(messageCharger) + ';\n' +
  '  var RESERVOIR = { actives: ' + JSON.stringify(reservoirActives) + ', ignorees: ' + JSON.stringify(reservoirIgnorees) + ' };\n' +
  '  var vraiApi = null;\n' +
  '  window.acquireVsCodeApi = function () {\n' +
  '    if (vraiApi) { return vraiApi; }\n' +
  '    vraiApi = {\n' +
  '      postMessage: function (msg) {\n' +
  '        if (!msg) { return; }\n' +
  '        if (msg.type === "pret") {\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: CHARGER }));\n' +
  '        } else if (msg.type === "reservoirFiltre") {\n' +
  '          var entrees = msg.avecIgnorees ? RESERVOIR.ignorees : RESERVOIR.actives;\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: { type: "reservoir", avecIgnorees: !!msg.avecIgnorees, entrees: entrees } }));\n' +
  '        }\n' +
  '      },\n' +
  '      setState: function () {}, getState: function () { return null; }\n' +
  '    };\n' +
  '    return vraiApi;\n' +
  '  };\n' +
  '  window.addEventListener("load", function () {\n' +
  '    var params = new URLSearchParams(location.search);\n' +
  '    var onglet = params.get("onglet");\n' +
  '    var index = { traductions: 0, reservoir: 1, numero: 2 }[onglet];\n' +
  '    if (index === undefined) { return; }\n' +
  '    var boutons = document.querySelectorAll("#onglets .doc-onglet");\n' +
  '    if (boutons[index]) { boutons[index].click(); }\n' +
  '    // ?onglet=reservoir&selection=1 : coche les deux premières lignes ACTIVES du\n' +
  '    // réservoir (jamais « Mes orphelines », qui a sa propre liste plus bas) pour montrer\n' +
  '    // la barre d\'actions en lot déjà active — sans quoi une capture d\'écran de l\'onglet\n' +
  '    // Réservoir ne montrerait jamais la sélection multiple à l\'oeuvre.\n' +
  '    if (onglet === "reservoir" && params.get("selection") !== "0") {\n' +
  '      var panneauReservoir = document.getElementById("panel-reservoir");\n' +
  '      var listeReservoir = panneauReservoir ? panneauReservoir.querySelector(".doc-vue-liste") : null;\n' +
  '      var cases = listeReservoir ? listeReservoir.querySelectorAll(".doc-vue-case") : [];\n' +
  '      for (var i = 0; i < Math.min(2, cases.length); i++) {\n' +
  '        cases[i].checked = true;\n' +
  '        cases[i].dispatchEvent(new Event("change"));\n' +
  '      }\n' +
  '    }\n' +
  '  });\n' +
  '})();\n' +
  '</script>\n';
const htmlAutonome = html.replace('<script nonce="' + nonce + '">', shim + '<script nonce="' + nonce + '">');

// ---- Écriture ---------------------------------------------------------------------------
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-apercu-documentation-'));
const cible = path.join(dossier, 'documentation.html');
fs.writeFileSync(cible, htmlAutonome, 'utf8');

const ongletDemande = process.argv[2] || '';
const url = 'file:///' + cible.replace(/\\/g, '/') + (ongletDemande ? '?onglet=' + encodeURIComponent(ongletDemande) : '');
console.log('Aperçu autonome écrit : ' + cible);
console.log('URL (onglet par défaut « Documentation du numéro ») : file:///' + cible.replace(/\\/g, '/'));
console.log('URL onglet Traductions à faire : file:///' + cible.replace(/\\/g, '/') + '?onglet=traductions');
console.log('URL onglet Réservoir (+ Mes orphelines), sélection multiple déjà démontrée (2 lignes cochées) : '
  + 'file:///' + cible.replace(/\\/g, '/') + '?onglet=reservoir');
console.log('  … la même sans rien cocher : file:///' + cible.replace(/\\/g, '/') + '?onglet=reservoir&selection=0');
if (ongletDemande) { console.log('Onglet demandé sur la ligne de commande : ' + url); }
