// Rendu autonome du formulaire Documentation (media/documentation.html/.css/.js), hors
// toolkit — un outil de développement, jamais déployé sur un poste de rédaction. Écrit un
// HTML autonome sous os.tmpdir() : mêmes CSS et JS que la vraie webview (assemblés par
// lib/webviews/util.js#construireHtml, la fonction que l'hôte utilise réellement), avec des
// données factices réalistes et un shim `acquireVsCodeApi()` qui répond localement au lieu
// d'un vrai hôte VSCodium — jamais de vscode-resource:, un simple fichier à ouvrir.
//
// Sert à juger le rendu des vues (Documentation du numéro — par catégorie, Traductions à
// faire, Réservoir, Archive) sans ouvrir VSCodium — voir docs/notes de session « aperçu
// d'une webview hors de l'éditeur » (WSL/Edge headless, capture PNG avant/après). Depuis le
// 23.09.2026, la page n'a plus de barre d'onglets ni de sommaire : la navigation est
// simulée ici comme le ferait l'arbre (message ongletActiver), pas par un clic sur un bouton
// qui n'existe plus.
//
// Usage :
//   node outils-dev/apercu-documentation.js
//   node outils-dev/apercu-documentation.js reservoir   (ouvre directement cette vue)
//   node outils-dev/apercu-documentation.js traductions
//   node outils-dev/apercu-documentation.js archive     (bibliothèque de production factice, boutons en icônes)
//   node outils-dev/apercu-documentation.js numero livre   (Documentation du numéro, catégorie « Livres » seule)
//   node outils-dev/apercu-documentation.js propositions   (lots synthétiques ; SZH_LANGUE=de pour la Zeitschrift)
//     …?onglet=propositions&etat=liste|selection|detail-b|detail-b-applique|echec|detail-recherche|doublon|colonnes|annuler|largeur|recherche|vide
//     &theme=clair|sombre : les couleurs d’un thème de l’éditeur, sinon les replis de _design.css
//     SZH_APERCU_CRANS=1 : la finesse du tri (crans, notes, réglage de la rédaction au cran 6), avec
//     &etat=finesse-garder|finesse-garde|finesse-masquees|finesse-aide|finesse-large|finesse-pourquoi-large|finesse-identique|finesse-pourquoi|finesse-colonne
//     SZH_APERCU_CRAN_DEFAUT=2 : avec SZH_APERCU_CRANS, cran_defaut à 2 et pas de réglage de la rédaction
//     SZH_APERCU_MULTI=1 : les affaires fédérales en propositions multilingues (marque « fr · de », titres officiels)
//     SZH_APERCU_SANS_TERMES=1 : avec SZH_APERCU_CRANS, les notes sans les termes (ni vue Termes, ni demandes)
//     SZH_APERCU_REEL=<dossier> : un lot du parlement (lot et etat.json) à la place du lot synthétique, hors dépôt
//
// Capture (Edge headless, depuis Windows) :
//   msedge --headless --disable-gpu --screenshot=<sortie.png> --window-size=1400,1400 "<chemin-html>"
//   msedge --headless --disable-gpu --screenshot=<sortie.png> --window-size=1400,1400 "<chemin-html>?onglet=reservoir"
//   msedge --headless --disable-gpu --screenshot=<sortie.png> --window-size=1400,1400 "<chemin-html>?onglet=numero&categorie=livre"
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const COCKPIT = path.join(__dirname, '..', 'vscodium-extension', 'szh-cockpit');
const { construireHtml } = require(path.join(COCKPIT, 'lib', 'webviews', 'util.js'));
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
// Les libellés suivent la langue de l'interface, comme dans l'hôte, et non celle des fiches.
const LANGUE_UI = require(path.join(COCKPIT, 'lib', 'i18n.js')).langueCockpit();

// ---- Libellés : relus dans documentation-hote.js#textesDocumentation (pas de require('vscode')
// transitif ici) : la liste ne diverge jamais de celle de l'hôte.
function textesDocumentation() {
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'documentation-hote.js'), 'utf8');
  const debut = src.indexOf('function textesDocumentation()');
  const bloc = src.slice(debut, src.indexOf('\n}', debut));
  const res = {};
  for (const m of bloc.matchAll(/([A-Za-z][A-Za-z0-9]*): T\('([^']+)'\)/g)) { res[m[1]] = T(m[2]); }
  return res;
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
  if (champ.saisie === 'liste_multiple') {
    c.options = optionsListe(champ.liste, langue)
      .sort((a, b) => a.libelle.localeCompare(b.libelle, langue, { sensitivity: 'base', numeric: true }));
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
      valeur: type, libelleSection: kirby.libelleCockpitType(type, langue),
      libelleAjouter: T('ressource.ajouter.' + type), libelleAjouterTip: T('ressource.ajouter.' + type + '.tip'),
      avecImage: !!champFichier, champFichier: champFichier,
      plage: (kirby.definitionType(type) || {}).plage || null,
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
    descriptif: 'Une journée de conférences et d’ateliers pour les praticien·ne·s.', lien: '' } },
  { id: 'r6', type: 'recherche', apercu: null, valeurs: {
    title: 'Coenseignement en classe inclusive', institutions: 'HEP Exemple', debut: '2025-01',
    fin: '2027', lien: 'https://exemple.org/recherche', lien_libelle: '',
    descriptif: 'Observation de binômes enseignants dans vingt classes.' } }
];

const traductions = [
  { slug: 'demo-trad-1', type: 'livre', typeLibelle: kirby.libelleType('livre', LANGUE_UI),
    titre: 'Anders fähig', origine: T('doc.origine.numero', ['Zeitschrift', '2026-02']) },
  { slug: 'demo-trad-2', type: 'horizon', typeLibelle: kirby.libelleType('horizon', LANGUE_UI),
    titre: 'Neue Behindertenstrategie des Bundes', origine: T('doc.origine.numero', ['Zeitschrift', '2026-02']) }
];

// Réservoir : quatre fiches allemandes rattachées à un numéro de la Zeitschrift, dont une
// déjà ignorée — l'interrupteur « Afficher les ignorées » (RESERVOIR_FILTRE, géré par le
// shim plus bas) fait vraiment basculer entre les deux vues, comme le ferait l'hôte réel.
const reservoirNumeros = [{ id: 'demo-num-zeitschrift', nom: 'Zeitschrift 2026-02' }];
const reservoirActives = [
  { slug: 'demo-res-1', uuid: 'res-uuid-1', type: 'livre', typeLibelle: kirby.libelleType('livre', LANGUE_UI),
    titre: 'Vielfalt leben', ausgabeSource: 'demo-num-zeitschrift', ignoree: false },
  { slug: 'demo-res-2', uuid: 'res-uuid-2', type: 'film', typeLibelle: kirby.libelleType('film', LANGUE_UI),
    titre: 'Wege zur Inklusion', ausgabeSource: 'demo-num-zeitschrift', ignoree: false },
  { slug: 'demo-res-3', uuid: 'res-uuid-3', type: 'recherche', typeLibelle: kirby.libelleType('recherche', LANGUE_UI),
    titre: 'Frühförderung im Kanton Bern', ausgabeSource: 'demo-num-zeitschrift', ignoree: false }
];
const reservoirIgnorees = [
  { slug: 'demo-res-4', uuid: 'res-uuid-4', type: 'agenda', typeLibelle: kirby.libelleType('agenda', LANGUE_UI),
    titre: 'Weiterbildung Sonderpädagogik', ausgabeSource: 'demo-num-zeitschrift', ignoree: true }
];

const orphelines = [
  { slug: 'demo-orph-1', uuid: 'orph-uuid-1', type: 'livre', typeLibelle: kirby.libelleType('livre', LANGUE_UI),
    titre: 'Un livre détaché d’un ancien numéro' },
  { slug: 'demo-orph-2', uuid: 'orph-uuid-2', type: 'reprise', typeLibelle: kirby.libelleType('reprise', LANGUE_UI),
    titre: 'Une reprise jamais rattachée' }
];

// Onglet Archive : une vingtaine de fiches de la bibliothèque de PRODUCTION (docs/FORMAT-
// DOCUMENTATION-KIRBY.md), toutes langues et tous numéros confondus — même forme que
// ligneArchive() dans lib/documentation-hote.js. Quelques-unes bilingues (les deux langues
// présentes), certaines sans numéro de rattachement (orphelines côté production), pour que
// l'aperçu montre chaque cas de la liste et des filtres.
function ficheArchiveDemo(n) {
  const base = {
    r1: { type: 'livre', titreFr: 'Grandir avec un handicap', titreDe: 'Mit Behinderung aufwachsen',
      champs: { categorie: 'manuel', auteurs: 'A. Dupont, B. Martin', annee: '2024', editeur: 'Editions SZH',
        descriptif: 'Un manuel de référence pour les professionnel·le·s.' },
      numero: { id: 'arch-r-2024-02', label: 'Revue 2024/2', revue: 'revue', annee: '2024' } },
    r2: { type: 'livre', titreFr: '', titreDe: 'Vielfalt leben', langues: ['de'],
      champs: { categorie: 'recit', auteurs: 'S. Keller', annee: '2023', editeur: 'Beltz',
        descriptif: 'Ein Erfahrungsbericht aus dem Familienalltag.' },
      numero: { id: 'arch-z-2023-04', label: 'Zeitschrift 2023/4', revue: 'zeitschrift', annee: '2023' } },
    r3: { type: 'film', titreFr: 'Autrement capable', titreDe: '', langues: ['fr'],
      champs: { categorie: 'documentaire', realisateur: 'C. Perret', annee: '2025', distributeur: 'Trigon-Film',
        descriptif: 'Portrait de trois jeunes en situation de handicap.' },
      numero: { id: 'arch-r-2025-01', label: 'Revue 2025/1', revue: 'revue', annee: '2025' } },
    r4: { type: 'intervention', titreFr: 'Pour un renforcement de la pédagogie spécialisée', titreDe: '', langues: ['fr'],
      champs: { canton: 'ZH', categorie: 'motion', numero: '24.3456', date: '2024-03-12',
        etat: 'adopte', source: 'curia', descriptif: 'Demande une meilleure dotation des cantons.' },
      numero: { id: 'arch-r-2024-04', label: 'Revue 2024/4', revue: 'revue', annee: '2024' } },
    r5: { type: 'horizon', titreFr: 'Nouvelle stratégie nationale sur le handicap',
      titreDe: 'Neue Behindertenstrategie des Bundes',
      champs: { portee: 'national', descriptif: 'Le Conseil fédéral publie sa stratégie.' },
      numero: { id: 'arch-r-2023-01', label: 'Revue 2023/1', revue: 'revue', annee: '2023' } },
    r6: { type: 'agenda', titreFr: 'Journée romande de la pédagogie spécialisée', titreDe: '', langues: ['fr'],
      champs: { evenement: 'colloque', debut: '2023-11-05', fin: '2023-11-05', lieu: 'Lausanne', organisateur: 'CSPS',
        descriptif: 'Une journée de conférences et d’ateliers.' },
      numero: { id: 'arch-r-2023-05', label: 'Revue 2023/5', revue: 'revue', annee: '2023' } },
    r7: { type: 'recherche', titreFr: 'La détection précoce dans le canton de Berne', titreDe: '', langues: ['fr'],
      champs: { institutions: 'Université de Berne', debut: '2022', fin: '2026',
        descriptif: 'Un projet longitudinal sur le dépistage précoce.' },
      // Orpheline côté production : jamais rattachée à un numéro.
      numero: null },
    r8: { type: 'reprise', titreFr: 'D’une revue à l’autre : un article marquant', titreDe: '', langues: ['fr'],
      champs: { revue: 'zeitschrift', auteurs: 'M. Weber', reference: 'Vol. 40, no 2, p. 14–22',
        descriptif: 'Un article à faire connaître aussi côté francophone.' },
      numero: { id: 'arch-r-2022-03', label: 'Revue 2022/3', revue: 'revue', annee: '2022' } }
  }[n.cle];
  const langues = base.langues || ['fr', 'de'];
  const valeurs = {};
  const titres = { fr: langues.includes('fr') ? base.titreFr : '', de: langues.includes('de') ? base.titreDe : '' };
  for (const l of langues) {
    valeurs[l] = Object.assign({ title: l === 'fr' ? base.titreFr : base.titreDe }, base.champs);
  }
  for (const l of ['fr', 'de']) { if (!langues.includes(l)) { valeurs[l] = null; } }
  const numeros = [];
  if (base.numero) { for (const l of langues) { numeros.push(Object.assign({ langue: l }, base.numero)); } }
  const recherche = langues.map((l) => Object.values(valeurs[l]).join(' ')).join(' ').toLowerCase();
  return { type: base.type, slug: n.slug, langues: langues, titres: titres, valeurs: valeurs, numeros: numeros, recherche: recherche };
}
const archive = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'].map((cle, i) =>
  ficheArchiveDemo({ cle: cle, slug: 'demo-arch-' + (i + 1) }));
// Complète à une vingtaine de fiches (Robin : « une vingtaine ») en variant le millésime des
// huit fiches ci-dessus — assez pour juger la liste, la recherche et les quatre filtres sans
// recopier vingt fiches à la main.
for (let i = 0; i < 12; i++) {
  const modele = archive[i % 8];
  const annee = String(2018 + (i % 6));
  archive.push(Object.assign({}, modele, {
    slug: modele.slug + '-var' + i,
    numeros: modele.numeros.map((n) => Object.assign({}, n, { id: n.id + '-var' + i, annee: annee,
      label: n.label.replace(/\d{4}/, annee) }))
  }));
}

// ---- Vue « Propositions » : lots synthétiques, classés par lib/propositions.js -------------
//
// Aucune personne ni aucun objet réels. Les lots sont écrits dans une bibliothèque jetable, puis
// relus, classés et ordonnés par lib/propositions.js, comme le ferait l'hôte ; la mise en forme
// reprend celle de documentation-hote.js#donneesPropositions. La langue du numéro est celle de
// l'interface (SZH_LANGUE=de pour la Zeitschrift).
const pr = require(path.join(COCKPIT, 'lib', 'propositions.js'));
const { langueCockpit } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const LANGUE_PROP = langueCockpit();

function lotsSynthetiques(l) {
  const t = (fr, de) => (l === 'de' ? de : fr);
  const p = (o) => Object.assign({ format: 'pronto-proposition/1', langue: l, recolte: '2026-10-01T05:12:00Z', doutes: [], brut: {},
    pertinence: { verdict: 'retenu', raison: t('ancrage « pédagogie spécialisée »', 'Anker «Sonderpädagogik»') }, doublon: null }, o);
  const inter = (id, canton, categorie, titre, extra) => p(Object.assign({
    cle: 'parlement:exemple:' + canton + ':' + id, moissonneur: 'parlement', type: 'intervention',
    lien_source: 'https://parlement.exemple.ch/objets/' + id,
    valeurs: { canton: canton, categorie: categorie, numero: id, date: '2026-09-11', title: titre,
      lien: 'https://parlement.exemple.ch/objets/' + id, etat: 'depose', source: 'openparldata' }
  }, extra || {}));
  const interventions = [
    inter('26-POS-041', 'VD', 'postulat', t('Pour un accueil inclusif dans les structures parascolaires', 'Für eine inklusive Betreuung in Tagesstrukturen'), {
      doutes: [{ champ: 'date', code: 'date-illisible', detail: t('jour et mois lus, année déduite de la session', 'Tag und Monat gelesen, Jahr aus der Session abgeleitet'), suggestion: '2026-03-04' }],
      brut: { date: t('séance du 4 mars', 'Sitzung vom 4. März'), type_harmonise: 'Postulat', session: t('printemps 2026', 'Frühjahr 2026') } }),
    inter('M-3120', 'GE', 'motion', t('Garantir des places en enseignement spécialisé à la rentrée', 'Genügend Plätze in der Sonderschulung zum Schulbeginn'), {
      doutes: [{ champ: 'categorie', code: 'correspondance-incertaine', detail: t('type harmonisé « Proposition de motion », rapproché de « Motion »', 'harmonisierter Typ «Motionsvorschlag», der «Motion» zugeordnet') }],
      brut: { categorie: t('Proposition de motion', 'Motionsvorschlag') },
      pertinence: { verdict: 'a-relire', raison: t('ancrage « enseignement spécialisé » seul', 'nur Anker «Sonderschulung»') } }),
    inter('26.3712', 'CH', 'motion', t('Renforcer la formation continue en pédagogie spécialisée', 'Weiterbildung in Sonderpädagogik stärken'), {
      lien_source: 'https://curia.exemple.ch/objets/26.3712', doublon: { uuid: '', slug: '', certitude: 'probable' } }),
    inter('26.4021', 'CH', 'postulat', t('Évaluer l’accès aux mesures de pédagogie spécialisée dans le préscolaire', 'Zugang zu sonderpädagogischen Massnahmen im Vorschulalter prüfen')),
    inter('26.4105', 'CH', 'interpellation', t('Quelles données sur les élèves à besoins éducatifs particuliers ?', 'Welche Daten zu Lernenden mit besonderem Bildungsbedarf?'), {
      pertinence: { verdict: 'a-relire', raison: t('ancrage « besoins éducatifs particuliers » seul', 'nur Anker «besonderer Bildungsbedarf»') } }),
    inter('26.7533', 'CH', 'question', t('Langue des signes à l’école obligatoire', 'Gebärdensprache in der obligatorischen Schule')),
    inter('2026-GC-118', 'FR', 'motion', t('Logopédie en milieu scolaire : réduire les délais d’attente', 'Logopädie in der Schule: Wartezeiten verkürzen')),
    inter('2026.09.204', 'VS', 'question', t('Transport scolaire des élèves en situation de handicap', 'Schultransport für Lernende mit Behinderung')),
    inter('26.412', 'JU', 'postulat', t('Soutien au personnel enseignant spécialisé en début de carrière', 'Unterstützung für schulische Heilpädagoginnen und Heilpädagogen beim Berufseinstieg')),
    inter('311-2026', 'BE', 'interpellation', t('Écoles spécialisées du Jura bernois : quelle planification ?', 'Sonderschulen im Berner Jura: welche Planung?'))
  ];
  const rech = (id, titre, inst, debut, fin, desc, extra) => p(Object.assign({
    cle: 'recherche:exemple:' + id, moissonneur: 'recherche', type: 'recherche', recolte: '2026-09-28T04:40:00Z',
    lien_source: 'https://recherche.exemple.ch/projets/' + id,
    valeurs: { title: titre, institutions: inst, debut: debut, fin: fin, lien: 'https://recherche.exemple.ch/projets/' + id, descriptif: desc }
  }, extra || {}));
  const recherches = [
    rech('2024-17', t('Parcours scolaires des élèves avec un trouble du spectre de l’autisme', 'Schullaufbahnen von Lernenden mit Autismus-Spektrum-Störung'),
      t('HEP Exemple', 'PH Beispiel'), '', '2027', t('Étude longitudinale des transitions entre degrés.', 'Längsschnittstudie zu den Übergängen zwischen den Stufen.'), {
        doutes: [{ champ: 'debut', code: 'date-illisible', detail: t('période en toutes lettres', 'Zeitraum ausgeschrieben'), suggestion: '2024-09' }],
        brut: { debut: t('septembre 2024 – …', 'September 2024 – …') } }),
    rech('2025-03', t('Coenseignement en classe inclusive : effets sur les apprentissages', 'Teamteaching in inklusiven Klassen: Wirkung auf das Lernen'),
      t('HEP Exemple', 'PH Beispiel'), '2025-01', '2027-12', t('Observation de binômes enseignants dans vingt classes.', 'Beobachtung von Lehrpersonen-Tandems in zwanzig Klassen.')),
    rech('p-1012', t('Littératie et déficience intellectuelle à l’adolescence', 'Literalität und geistige Behinderung im Jugendalter'),
      t('Université Exemple', 'Universität Beispiel'), '2024', '2026', t('Évaluation d’un programme de lecture adapté.', 'Evaluation eines angepassten Leseprogramms.'), {
        pertinence: { verdict: 'a-relire', raison: t('ancrage « déficience » seul', 'nur Anker «Behinderung»') } }),
    rech('p-1044', t('Accessibilité numérique des moyens d’enseignement', 'Digitale Barrierefreiheit von Lehrmitteln'),
      t('Université Exemple', 'Universität Beispiel'), '2025-09', '2027-08', t('Audit de manuels numériques.', 'Prüfung digitaler Lehrmittel.'))
  ];
  const livres = [
    p({ cle: 'isbn:exemple:978-2-0000-0001-1', moissonneur: 'isbn', type: 'livre', recolte: '2026-09-30T06:05:00Z',
      lien_source: 'https://catalogue.exemple.ch/isbn/9782000000011',
      valeurs: { categorie: 'manuel', title: t('Enseigner dans une classe hétérogène', 'Unterrichten in heterogenen Klassen'), auteurs: 'A. Exemple',
        annee: '2026', editeur: t('Éditions Exemple', 'Beispiel Verlag'), descriptif: t('Un guide pratique.', 'Ein Praxisleitfaden.') } })
  ];
  // La date de la première est celle que le moissonneur n'a pas su lire.
  interventions[0].valeurs.date = '';
  if (AVEC_CRANS) { noterInterventions(interventions, l, inter, t); }
  return interventions.concat(recherches, livres);
}

// ---- Finesse du tri (SZH_APERCU_CRANS=1) : une note par intervention, des crans par langue ----
// Des objets synthétiques en plus, pour qu'un cran masque assez de lignes pour se voir.
const AVEC_CRANS = !!process.env.SZH_APERCU_CRANS;
const SEUILS_DEMO = [0, 5, 9, 12, 12, 18, 29, 38, 56, 78];
function cransDemo() {
  const par = [81, 75, 66, 63, 63, 41, 34, 25, 16, 9], rappel = [73, 72, 70, 69, 69, 65, 57, 50, 37, 18];
  return SEUILS_DEMO.map((s, i) => ({ cran: i + 1, seuil: s, par_mois: par[i], rappel: rappel[i], rappel_sur: 79,
    identique_au_cran_precedent: i > 0 && SEUILS_DEMO[i - 1] === s }));
}
const SANS_TERMES = !!process.env.SZH_APERCU_SANS_TERMES;
// Avec SZH_APERCU_CRANS, un cran par défaut (cran_defaut) et pas de réglage de la rédaction.
const CRAN_DEFAUT = Number(process.env.SZH_APERCU_CRAN_DEFAUT || 0);
// Le vocabulaire du moissonneur parlementaire, synthétique : un terme, sa langue, son rôle, et ses
// fiches de référence (ref, ref_seul) ; le dernier n'en a pas, pour montrer « – ».
function vocabulaireDemo(l) {
  const fr = [['pédagogie spécialisée', 'ancrage', 15, 1], ['handicap', 'ancrage', 5, 0], ['enseignement spécialisé', 'ancrage', 6, 0],
    ['besoins éducatifs particuliers', 'ancrage', 3, 0], ['logopédie', 'ancrage', 2, 1], ['surdité', 'ancrage', 6, 0],
    ['intégration scolaire', 'ancrage', 6, 0], ['accompagnement', 'ambigu', 3, 0], ['égalité des chances', 'ambigu', 1, 0],
    ['autonomie', 'ambigu', 2, 0], ['différenciation', 'ambigu', 3, 0], ['harcèlement', 'ambigu', 2, 0],
    ['participation', 'ambigu', 3, 1], ['élèves', 'ecole', 9, 0], ['pénurie d’enseignants', 'ecole', 6, 0],
    ['petite enfance', 'theme', 1, 0]];
  const de = [['Sonderpädagogik', 'ancrage', 15, 1], ['Behinderung', 'ancrage', 5, 0], ['Sonderschulung', 'ancrage', 6, 0],
    ['besonderer Bildungsbedarf', 'ancrage', 3, 0], ['Logopädie', 'ancrage', 2, 1], ['Gehörlosigkeit', 'ancrage', 6, 0],
    ['schulische Integration', 'ancrage', 6, 0], ['Begleitung', 'ambigu', 3, 0], ['Chancengleichheit', 'ambigu', 1, 0],
    ['Selbstständigkeit', 'ambigu', 2, 0], ['Differenzierung', 'ambigu', 3, 0], ['Mobbing', 'ambigu', 2, 0],
    ['Teilhabe', 'ambigu', 3, 1], ['Lernende', 'ecole', 9, 0], ['Lehrpersonenmangel', 'ecole', 6, 0],
    ['frühe Kindheit', 'theme', 1, 0]];
  const liste = (l === 'de' ? de : fr).map((x) => ({ terme: x[0], langue: l, role: x[1], ref: x[2], ref_seul: x[3] }));
  liste.push({ terme: 'scuola speciale', langue: 'it', role: 'ancrage', ref: 4, ref_seul: 0 });
  liste.push({ terme: 'docente di sostegno', langue: 'it', role: 'ancrage', ref: null, ref_seul: null });
  liste[5].sansNote = true;
  return liste;
}
function noterInterventions(interventions, l, inter, t) {
  const sujets = t(['Repas à l’école', 'Horaires des transports scolaires', 'Devoirs surveillés', 'Bâtiments scolaires',
    'Rentrée scolaire', 'Cantines', 'Numérique à l’école', 'Éducation physique', 'Classes d’accueil', 'Écoles de musique'],
  ['Schulverpflegung', 'Fahrpläne im Schulverkehr', 'Betreute Hausaufgaben', 'Schulhäuser', 'Schulbeginn', 'Mensen',
    'Digitalisierung in der Schule', 'Sportunterricht', 'Aufnahmeklassen', 'Musikschulen']);
  const cantons = ['GE', 'VD', 'NE', 'FR', 'VS', 'JU', 'BE', 'CH'];
  for (let i = 0; i < 30; i++) {
    interventions.push(inter('26.' + (5000 + i), cantons[i % cantons.length], ['question', 'postulat', 'interpellation'][i % 3],
      t(['Question', 'Postulat', 'Interpellation'][i % 3] + ' : ' + sujets[i % sujets.length].toLowerCase(),
        sujets[i % sujets.length] + ': ' + ['Anfrage', 'Postulat', 'Interpellation'][i % 3])));
  }
  const vocabulaire = vocabulaireDemo(l);
  const ous = ['titre', 'texte', 'extrait'];
  const poids = { ancrage: 22, ambigu: 7, ecole: 4, theme: 2 };
  // Un à quatre termes par intervention, tirés du vocabulaire sans hasard ; « surdité » / « Gehörlosigkeit »
  // n'a pas de note_sans, pour montrer un compte approché.
  const termes = (score, i) => {
    const n = 1 + (i % 4), res = [];
    for (let k = 0; k < n; k++) {
      const v = vocabulaire[(i * 5 + k * 3) % vocabulaire.length];
      if (res.some((x) => x.terme === v.terme)) { continue; }
      const x = { terme: v.terme, langue: v.langue, role: v.role, ou: ous[(i + k) % 3] };
      if (!v.sansNote) { x.note_sans = Math.max(0, score - poids[v.role] - k * 3); }
      res.push(x);
    }
    return res;
  };
  // Avec un cran par défaut, la bande sous 5 est le vivier élargi (texte-large), comme chez le parlement.
  const categorie = (s) => (s >= 56 ? 'titre' : s >= 29 ? 'texte-dense' : s >= 12 ? 'signal-faible' : s >= 5 ? 'ecole'
    : CRAN_DEFAUT && s < 5 ? 'texte-large' : 'theme');
  interventions.forEach((x, i) => {
    // Les dix premières, sujets du handicap, notées haut ; les objets d'école, bas.
    const score = i < 10 ? [62, 88, 79, 41, 33, 91, 58, 30, 47, 66][i] : [2, 3, 7, 8, 11, 12, 14, 19, 22, 26][i % 10] + (i % 3);
    x.pertinence = Object.assign({}, x.pertinence, { score: score, categorie: categorie(score) });
    if (!SANS_TERMES) { x.pertinence.termes = termes(score, i); }
  });
}

function libelleMoissonneurDemo(id) { const v = T('doc.prop.moissonneur.' + id); return v === 'doc.prop.moissonneur.' + id ? id : v; }
// Des demandes synthétiques, de chaque statut, avec la réponse du moissonneur dans etat.json.
function demandesDemo(racine, l) {
  const t = (fr, de) => (l === 'de' ? de : fr);
  const ecrire = (terme, sens, par) => pr.ecrireDemande(racine, 'parlement', { terme: terme, langue: l, sens: sens, par: par }).demande;
  const a = ecrire(t('harcèlement', 'Mobbing'), 'exclusion', t('Claire Exemple', 'Jonas Beispiel'));
  const b = ecrire(t('jeux vidéo', 'Videospiele'), 'exclusion', 'Jonas Beispiel');
  const chemin = path.join(pr.cheminMoissons(racine), 'parlement', 'etat.json');
  const etat = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  etat.demandes = [{ id: b.id, statut: 'applique', mesure_le: '2026-09-15',
    effet: { rappel_avant: 73, rappel_apres: 73, par_mois_avant: 84, par_mois_apres: 81, complet: true } }];
  void a;
  fs.writeFileSync(chemin, JSON.stringify(etat));
}
function donneesPropositionsDemo(l) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-apercu-propositions-'));
  const lots = lotsSynthetiques(l);
  // SZH_APERCU_MULTI=1 : les affaires fédérales deviennent multilingues, titres des deux revues.
  if (process.env.SZH_APERCU_MULTI) {
    const autre = l === 'de' ? 'fr' : 'de';
    const autres = lotsSynthetiques(autre);
    for (const x of lots) {
      const y = autres.find((z) => z.cle === x.cle);
      if (!y || x.valeurs.canton !== 'CH' || !x.valeurs.title) { continue; }
      x.langues = ['fr', 'de'];
      x.titres = { [l]: x.valeurs.title, [autre]: y.valeurs.title, it: 'Titolo d’esempio' };
      delete x.langue;
      delete x.valeurs.title;
    }
  }
  // La fiche qui ressemble à la proposition marquée doublon : une vraie fiche de la bibliothèque jetable.
  const marquee = lots.find((x) => x.doublon);
  const fiche = kirby.creerFiche(racine, l, 'intervention', Object.assign({}, marquee.valeurs,
    { title: l === 'de' ? 'Weiterbildung Sonderpädagogik: Angebot stärken' : 'Formation continue en pédagogie spécialisée : renforcer l’offre',
      date: '2026-06-16' }), 'id-demo-numero');
  marquee.doublon = { uuid: fiche.uuid, slug: fiche.slug, certitude: 'probable' };
  for (const m of ['parlement', 'recherche', 'isbn']) {
    const dossier = path.join(pr.cheminMoissons(racine), m);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, '2026-10-01-1.jsonl'),
      lots.filter((x) => x.moissonneur === m).map((x) => JSON.stringify(x)).join('\n') + '\n');
  }
  // SZH_APERCU_REEL=<dossier> : un lot réel du parlement (lot et etat.json), lu sur place et
  // copié dans la bibliothèque jetable ; il ne quitte jamais le poste de développement.
  if (process.env.SZH_APERCU_REEL) {
    const dossier = path.join(pr.cheminMoissons(racine), 'parlement');
    for (const n of fs.readdirSync(dossier)) { fs.unlinkSync(path.join(dossier, n)); }
    for (const n of fs.readdirSync(process.env.SZH_APERCU_REEL)) {
      fs.copyFileSync(path.join(process.env.SZH_APERCU_REEL, n), path.join(dossier, n));
    }
  }
  if (AVEC_CRANS) {
    fs.writeFileSync(path.join(pr.cheminMoissons(racine), 'parlement', 'etat.json'), JSON.stringify({
      format: 'pronto-etat/1', moissonneur: 'parlement', derniere_moisson: '2026-10-01T05:12:00Z',
      crans: { fr: cransDemo(), de: cransDemo() }, crans_calcules_le: '2026-10-01',
      crans_source: { fr: 'langue', de: 'commun' }, crans_fenetre: { du: '2026-04-01', au: '2026-09-30' },
      rappel_sur: 79, cran_defaut: CRAN_DEFAUT || undefined,
      termes: SANS_TERMES ? undefined : vocabulaireDemo(l).filter((v) => v.ref !== null)
        .map((v) => ({ terme: v.terme, langue: v.langue, role: v.role, ref: v.ref, ref_seul: v.ref_seul })) }));
    if (!SANS_TERMES) { demandesDemo(racine, l); }
    fs.mkdirSync(path.join(pr.cheminMoissons(racine), '_Reglages'), { recursive: true });
    fs.writeFileSync(pr.cheminReglages(racine, l), JSON.stringify(CRAN_DEFAUT ? {} : { parlement: { intervention: {
      cran: 6, par: l === 'de' ? 'Jonas Beispiel' : 'Claire Exemple', le: '2026-10-01' } } }));
  }
  const etats = {
    parlement: { derniere_moisson: '2026-10-01T05:12:00Z', propositions_ecrites: 10,
      sources_en_echec: [{ source: l === 'de' ? 'Grosser Rat NE (OpenParlData)' : 'Grand Conseil NE (OpenParlData)',
        raison: l === 'de' ? 'Zeitüberschreitung nach drei Versuchen' : 'délai dépassé après trois essais' }] },
    recherche: { derniere_moisson: '2026-09-28T04:40:00Z', propositions_ecrites: 4, sources_en_echec: [] },
    isbn: { derniere_moisson: '2026-09-30T06:05:00Z', propositions_ecrites: 1, sources_en_echec: [] }
  };
  const libelleMoissonneur = libelleMoissonneurDemo;
  const types = kirby.typesConnus().map((type) => {
    const def = kirby.definitionType(type) || {};
    return { type: type, libelle: kirby.libelleCockpitType(type, l),
      tri: (def.tri || ['title']).filter((k) => k !== 'title'), categorie: !!kirby.champDuType(type, 'categorie'),
      champs: kirby.champsDuType(type).map((c) => {
        const x = { cle: c.cle, libelle: c.libelle[l] || c.libelle.fr, saisie: c.saisie };
        if (c.saisie === 'liste' || c.saisie === 'liste_multiple') {
          x.libelles = {};
          for (const v of kirby.valeursListe(c.liste)) { x.libelles[v.jeton] = v[l] || v.fr; }
        }
        return x;
      }) };
  });
  const lu = pr.listerPropositions(racine, l);
  // La finesse, mise en forme comme documentation-hote.js#finesseParType.
  const vue = pr.finessePourVue(racine, l, lu.etats, {});
  const finesse = {};
  for (const x of lu.propositions) {
    const m = x.dossier || x.moissonneur;
    if (!vue.crans[m] || finesse[x.type]) { continue; }
    const e = lu.etats[m] || {};
    finesse[x.type] = { moissonneurs: [m], crans: vue.crans[m], source: String((e.crans_source || {})[l] || ''),
      calculeLe: String(e.crans_calcules_le || ''), fenetre: e.crans_fenetre || null,
      reglage: (vue.reglages[m] || {})[x.type] || null, cranDefaut: vue.defauts[m] || 1, apercu: null };
  }
  // Les termes et les demandes, comme documentation-hote.js#termesEtDemandes ; les filtres d'avance,
  // pour que le faux hôte réponde à propFiltreTerme sans la règle.
  const termes = pr.comptesTermes(racine, l, {}, lu);
  const demandes = {};
  const filtres = {};
  for (const m of Object.keys(termes)) {
    termes[m].libelle = libelleMoissonneurDemo(m);
    demandes[m] = pr.listerDemandes(racine, m).demandes;
    for (const x of termes[m].termes) {
      for (const ty of Object.keys(termes[m].types)) {
        filtres[[ty, x.terme, x.role, x.langue].join('|')] = pr.filtrerSurTerme(lu.propositions.filter((p) => p.type === ty), x).map((p) => p.cle);
      }
    }
  }
  const pourVue = (x) => {
    const f = x.doublon ? pr.ficheDoublon(racine, x) : null;
    return { cle: x.cle, type: x.type, moissonneur: x.moissonneur, recolte: x.recolte, source: x.cle.split(':')[1],
      valeurs: x.valeurs, doutes: x.doutes, brut: x.brut, pertinence: x.pertinence, doublon: x.doublon, motif: x.motif || '',
      cas: x.cas, raisons: x.raisons, bloquants: pr.bloquants(x), aussi: x.valeurs.canton === 'CH', dossier: x.dossier,
      langues: pr.languesDe(x), titres: x.titres || null,
      cranMax: pr.cranMax(x, vue.crans[x.dossier || x.moissonneur] || null),
      doublonFiche: f ? { valeurs: f.valeurs, numero: l === 'de' ? 'Zeitschrift 2026/3' : 'Revue 2026/3' } : null };
  };
  const donnees = {
    type: 'propDonnees', langue: l, cible: l === 'de' ? 'fr' : 'de', revueAutre: l === 'de' ? 'Revue' : 'Zeitschrift',
    revue: l === 'de' ? 'Zeitschrift' : 'Revue', finesse: finesse,
    types: types, propositions: pr.ordonner(lu.propositions, l).map(pourVue), refusees: [],
    etats: Object.keys(etats).map((m) => ({ moissonneur: m, libelle: libelleMoissonneur(m), connu: true,
      derniere: etats[m].derniere_moisson, propositions: etats[m].propositions_ecrites, echecs: etats[m].sources_en_echec })),
    colonnes: {},
    termes: termes, demandes: demandes, filtre: null, regleTerme: pr.REGLE_TERME, filtres: filtres,
    // Ce que bloquants() rend, d'avance : avant toute saisie, et une fois les recommandations
    // appliquées (le faux hôte n'a pas la règle, il la rejoue).
    verifications: Object.fromEntries(lu.propositions.map((x) => {
      const champs = (x.doutes || []).map((d) => d.champ);
      const appliquees = Object.assign({}, x.valeurs);
      (x.doutes || []).forEach((d) => { if (d.suggestion) { appliquees[d.champ] = d.suggestion; } });
      return [x.cle, { avant: pr.bloquants(x), apres: pr.bloquants(x, appliquees, champs), champs: champs }];
    }))
  };
  fs.rmSync(racine, { recursive: true, force: true });
  return donnees;
}
const PROPOSITIONS = donneesPropositionsDemo(LANGUE_PROP);

// Les libellés de la vue, relus dans documentation-hote.js#textesDocumentation : la liste est
// longue et ne doit pas diverger de celle de l'hôte.
function textesPropositions() {
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'documentation-hote.js'), 'utf8');
  const res = {};
  for (const m of src.matchAll(/(prop[A-Za-z0-9]*): T\('([^']+)'\)/g)) { res[m[1]] = T(m[2]); }
  return res;
}

const txt = Object.assign(textesDocumentation(), textesPropositions());
const messageCharger = {
  type: 'charger', slug: 'documentation', accent: 'bleuacier', i18n: txt,
  typesConfig: typesRessourceConfig(LANGUE_PROP), typesRubrique: typesRubriqueConfig(LANGUE_PROP),
  rubriques: rubriques, ressources: ressources,
  traductions: traductions, reservoirNumeros: reservoirNumeros, reservoir: reservoirActives,
  orphelines: orphelines,
  limites: { image: { extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'], maxi: 8 * 1024 * 1024 } }
};

// ---- Dates imprimées : formées d'avance par lib/date-apercu.js (le seul moteur), pour que le
// faux hôte réponde aussitôt à docDateFormer. Une demande hors de cette table reste sans forme.
function demandesDates() {
  const res = [];
  const typeDe = (t) => typesRessourceConfig(LANGUE_PROP).find((x) => x.valeur === t) || { champs: [] };
  for (const r of ressources) {
    const t = typeDe(r.type);
    for (const c of t.champs) {
      const v = r.valeurs[c.cle];
      if ((c.saisie === 'date' || c.saisie === 'date_partielle') && v) {
        if (t.plage && t.plage.indexOf(c.cle) !== -1) { res.push(['plage', t.plage.map((k) => String(r.valeurs[k] || ''))]); }
        else { res.push([c.saisie, [v]]); }
      }
      if (c.saisie === 'structure') {
        for (const l of (v || [])) {
          for (const sc of c.structureChamps) { if (sc.saisie === 'date' && l[sc.cle]) { res.push(['date', [l[sc.cle]]]); } }
        }
      }
    }
  }
  // Le lot réel en compte des centaines : ses dates restent sans forme imprimée.
  for (const x of process.env.SZH_APERCU_REEL ? [] : PROPOSITIONS.propositions) {
    for (const d of x.doutes || []) {
      const c = kirby.champsDuType(x.type).find((k) => k.cle === d.champ);
      if (c && d.suggestion) { res.push([c.saisie, [d.suggestion]]); }
    }
  }
  return res;
}
function formesDates() {
  const code = 'const d = require(' + JSON.stringify(path.join(COCKPIT, 'lib', 'date-apercu.js')) + ');'
    + 'const q = ' + JSON.stringify(demandesDates()) + ';'
    // Une à une : date-apercu.js refuse au-delà de quatre demandes en vol.
    + '(async () => { const t = {}; for (const x of q) { t[JSON.stringify(x)] = await d.former({ saisie: x[0], lang: '
    + JSON.stringify(LANGUE_PROP) + ', valeurs: x[1] }, { delaiMs: 20000 }); } process.stdout.write(JSON.stringify(t)); })();';
  try { return JSON.parse(require('child_process').execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' })); }
  catch (e) { return {}; }
}
const FORMES = formesDates();

// ---- Assemblage : le même appel que documentation-hote.js#htmlDocumentation -----------
const nonce = crypto.randomBytes(16).toString('hex');
const html = construireHtml('documentation', nonce, {
  cssPartage: ['_design.css', '_propositions.css'], jsPartage: ['_messages.js', '_fiche-doc.js', '_propositions.js'],
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
  '  var ARCHIVE = ' + JSON.stringify(archive) + ';\n' +
  '  var PROP = ' + JSON.stringify(PROPOSITIONS) + ';\n' +
  '  var FORMES = ' + JSON.stringify(FORMES) + ';\n' +
  '  var VERIF = PROP.verifications;\n' +
  // La vue Propositions : un faux hôte qui retire et rend les propositions comme le vrai.
  '  var ORDRE = PROP.propositions.map(function (p) { return p.cle; }), DECIDEES = {};\n' +
  '  var paramsProp = new URLSearchParams(location.search);\n' +
  '  if (paramsProp.get("etat") === "vide") { PROP.propositions = []; }\n' +
  '  function envoyerPropositions(resultat) {\n' +
  '    var d = JSON.parse(JSON.stringify(PROP));\n' +
  '    if (resultat) { d.resultat = resultat; }\n' +
  '    window.dispatchEvent(new MessageEvent("message", { data: d }));\n' +
  '  }\n' +
  '  function repondreGeste(msg) {\n' +
  '    var cles = msg.type === "propAccepter" ? msg.demandes.map(function (d) { return d.cle; }) : msg.cles;\n' +
  '    var geste = msg.type === "propAccepter" ? (msg.dansNumero ? "accepte" : "garde") : (msg.type === "propRefuser" ? "refuse" : "annule");\n' +
  '    var faites = [];\n' +
  '    if (geste === "annule") {\n' +
  '      cles.forEach(function (c) { if (DECIDEES[c]) { PROP.propositions.push(DECIDEES[c]); delete DECIDEES[c]; faites.push(c); } });\n' +
  '      PROP.propositions.sort(function (a, b) { return ORDRE.indexOf(a.cle) - ORDRE.indexOf(b.cle); });\n' +
  '    } else {\n' +
  '      PROP.propositions = PROP.propositions.filter(function (p) {\n' +
  '        if (cles.indexOf(p.cle) === -1 || (geste !== "refuse" && p.cas === "B" && !msg.depuisDetail)) { return true; }\n' +
  '        DECIDEES[p.cle] = p; faites.push(p.cle); return false;\n' +
  '      });\n' +
  '    }\n' +
  // ?etat=echec : la création de la fiche échoue, la décision reste (raison fiche-introuvable).
  '    if (paramsProp.get("etat") === "echec" && geste === "accepte") {\n' +
  '      envoyerPropositions({ geste: geste, faites: [], ignorees: [], echecs: faites.map(function (c) { return { cle: c, raison: "fiche-introuvable" }; }), motif: "" });\n' +
  '      return;\n' +
  '    }\n' +
  '    envoyerPropositions({ geste: geste, faites: faites, ignorees: [], echecs: [], motif: msg.motif || "" });\n' +
  '  }\n' +
  // La finesse : le faux hôte range l'aperçu, « Garder » en fait le réglage de la rédaction.
  '  var GARDE = null;\n' +
  '  function repondreFinesse(msg) {\n' +
  '    var f = PROP.finesse[msg.typeFiche]; if (!f) { return; }\n' +
  '    var partage = f.reglage ? f.reglage.cran : (f.cranDefaut || 1), geste = null;\n' +
  '    if (msg.type === "propFinesseApercu") { f.apercu = msg.cran === partage ? null : msg.cran; }\n' +
  '    else if (msg.type === "propFinesseGarder") { GARDE = { reglage: f.reglage, apercu: f.apercu }; f.reglage = { cran: f.apercu, par: "Poste Essai", le: "2026-10-03" }; geste = { geste: "garde", typeFiche: msg.typeFiche, cran: f.apercu }; f.apercu = null; }\n' +
  '    else if (GARDE) { f.reglage = GARDE.reglage; f.apercu = GARDE.apercu; GARDE = null; geste = { geste: "annule", typeFiche: msg.typeFiche }; }\n' +
  '    var d = JSON.parse(JSON.stringify(PROP)); if (geste) { d.finesseGeste = geste; }\n' +
  '    window.dispatchEvent(new MessageEvent("message", { data: d }));\n' +
  '  }\n' +
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
  '        } else if (msg.type === "archiveCharger" || msg.type === "archiveActualiser") {\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: { type: "archiveDonnees", ok: true, fiches: ARCHIVE } }));\n' +
  '        } else if (msg.type === "archiveImage") {\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: { type: "archiveImageDonnee", ficheType: msg.ficheType, slug: msg.slug, apercu: null } }));\n' +
  '        } else if (msg.type === "propVerifier") {\n' +
  '          var v = VERIF[msg.cle] || { avant: [], apres: [], champs: [] };\n' +
  '          var tous = v.champs.every(function (c) { return msg.touches.indexOf(c) !== -1; });\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: { type: "propVerifie", cle: msg.cle, jeton: msg.jeton, bloquants: tous ? v.apres : v.avant } }));\n' +
  '        } else if (msg.type === "docDateFormer") {\n' +
  '          var forme = FORMES[JSON.stringify([msg.saisie, msg.valeurs])] || { indisponible: true };\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: Object.assign({ type: "docDateFormee", jeton: msg.jeton }, forme) }));\n' +
  '        } else if (msg.type === "propCharger") {\n' +
  '          envoyerPropositions(null);\n' +
  '        } else if (msg.type === "propFinesseApercu" || msg.type === "propFinesseGarder" || msg.type === "propFinesseAnnuler") {\n' +
  '          repondreFinesse(msg);\n' +
  '        } else if (msg.type === "propAccepter" || msg.type === "propRefuser" || msg.type === "propAnnuler") {\n' +
  '          repondreGeste(msg);\n' +
  '        } else if (msg.type === "propFiltreTerme") {\n' +
  '          PROP.filtre = msg.terme ? { typeFiche: msg.typeFiche, terme: msg.terme, role: msg.role, langue: msg.langue,\n' +
  '            cles: PROP.filtres[[msg.typeFiche, msg.terme, msg.role, msg.langue].join("|")] || [] } : null;\n' +
  '          envoyerPropositions(null);\n' +
  '        } else if (msg.type === "propDemandeEcrire") {\n' +
  '          (PROP.demandes[msg.moissonneur] = PROP.demandes[msg.moissonneur] || []).unshift({ id: "demo-" + Date.now(), terme: msg.terme,\n' +
  '            langue: msg.langue, sens: msg.sens, par: "Claire Exemple", le: "2026-10-03T09:00:00Z", statut: "en-attente", effet: null, fiches_perdues: [], mesure_le: "" });\n' +
  '          var dg = JSON.parse(JSON.stringify(PROP)); dg.demandeGeste = { ok: true, moissonneur: msg.moissonneur, terme: msg.terme, langue: msg.langue, sens: msg.sens };\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: dg }));\n' +
  '        } else if (msg.type === "archiveReprendre") {\n' +
  '          window.dispatchEvent(new MessageEvent("message", { data: { type: "archiveReprise", ok: true } }));\n' +
  '        }\n' +
  '      },\n' +
  '      setState: function () {}, getState: function () { return null; }\n' +
  '    };\n' +
  '    return vraiApi;\n' +
  '  };\n' +
  '  window.addEventListener("load", function () {\n' +
  '    var params = new URLSearchParams(location.search);\n' +
  '    var onglet = params.get("onglet");\n' +
  '    // Plus de barre d\'onglets à cliquer (23.09.2026) : la même bascule que l\'arbre\n' +
  '    // enverrait à un panneau déjà ouvert (documentation-hote.js, MSG.ONGLET_ACTIVER).\n' +
  '    if (onglet) {\n' +
  '      window.dispatchEvent(new MessageEvent("message",\n' +
  '        { data: { type: "ongletActiver", cle: onglet, categorie: params.get("categorie") || undefined } }));\n' +
  '    }\n' +
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
  // ?onglet=propositions&etat=… : l'état de la vue à capturer.
  '    if (onglet === "propositions") { etatPropositions(params.get("etat") || "liste"); }\n' +
  // ?ouvrir=1 : la première carte de la catégorie affichée, dépliée, ses dates formées.
  '    if (params.get("ouvrir")) {\n' +
  '      var sections = Array.prototype.filter.call(document.querySelectorAll(".doc-section"), function (x) { return !x.hidden; });\n' +
  '      var bascule = sections[0] && sections[0].querySelector(".doc-bascule");\n' +
  '      if (bascule) {\n' +
  '        bascule.click();\n' +
  '        var corps = bascule.closest(".doc-carte").querySelector(".doc-corps");\n' +
  '        Array.prototype.forEach.call(corps.querySelectorAll("input"), function (i) { i.dispatchEvent(new Event("blur")); });\n' +
  '      }\n' +
  '    }\n' +
  '  });\n' +
  '  function etatPropositions(etat) {\n' +
  '    var panel = document.getElementById("panel-propositions");\n' +
  '    var tab = function (t) { var b = document.querySelector("#barreCategories [data-type=\\"" + t + "\\"]"); if (b) { b.click(); } };\n' +
  '    var ligne = function (fragment) { return Array.prototype.filter.call(panel.querySelectorAll("tr[data-cle]"), function (tr) { return tr.dataset.cle.indexOf(fragment) !== -1; })[0]; };\n' +
  '    var rangs = function () { return panel.querySelectorAll("tr[data-cle]"); };\n' +
  '    if (etat === "recherche") { tab("recherche"); return; }\n' +
  '    if (etat === "vide") { return; }\n' +
  '    tab("intervention");\n' +
  '    if (etat === "selection") { [0, 3, 4].forEach(function (i) { rangs()[i].querySelector(".prop-case").click(); }); }\n' +
  '    if (etat === "detail-b" || etat === "detail-b-applique") { ligne("26-POS-041").querySelector(".prop-bouton-verifier").click(); }\n' +
  '    if (etat === "detail-b-applique") { panel.querySelector(".prop-appliquer").click(); }\n' +
  '    if (etat === "echec") { ligne("26.4021").querySelector(".prop-titre").click(); panel.querySelector(".prop-detail-accepter").click(); }\n' +
  '    if (etat === "detail-recherche") { tab("recherche"); rangs()[0].querySelector(".prop-bouton-verifier").click(); }\n' +
  '    if (etat === "doublon") { ligne("26.3712").querySelector(".prop-bouton-verifier").click(); }\n' +
  '    if (etat === "colonnes") { panel.querySelector(".prop-bouton-colonnes").click(); }\n' +
  '    if (etat === "annuler") { ligne("2026-GC-118").querySelector(".prop-bouton-refuser").click(); }\n' +
  '    var curseur = function (k) { var c = panel.querySelector(".prop-finesse-curseur"); c.value = String(k); c.dispatchEvent(new Event("input")); c.dispatchEvent(new Event("change")); };\n' +
  '    if (etat === "finesse-garder" || etat === "finesse-garde") { curseur(9); }\n' +
  '    if (etat === "finesse-garde") { panel.querySelector(".prop-finesse-garder").click(); }\n' +
  '    if (etat === "finesse-masquees") { panel.querySelector(".prop-finesse-voir").click(); }\n' +
  '    if (etat === "finesse-aide") { panel.querySelector(".prop-finesse-aide").click(); }\n' +
  '    if (etat === "finesse-large") { curseur(1); panel.querySelector(".prop-finesse-aide").click(); }\n' +
  '    if (etat === "finesse-pourquoi-large") { curseur(1); var pl = PROP.propositions.filter(function (x) { return x.pertinence && x.pertinence.categorie === "texte-large"; })[0]; if (pl) { ligne(pl.cle).querySelector(".prop-titre").click(); } }\n' +
  '    if (etat === "finesse-identique") { curseur(5); panel.querySelector(".prop-finesse-aide").click(); }\n' +
  '    if (etat === "finesse-pourquoi") { ligne("26.4021").querySelector(".prop-titre").click(); }\n' +
  '    if (etat === "finesse-colonne") { panel.querySelector(".prop-bouton-colonnes").click(); Array.prototype.filter.call(document.querySelectorAll(".prop-menu-colonnes button"), function (b) { return b.dataset.col === "cran"; })[0].click(); }\n' +
  '    var termes = function () { tab("_termes"); };\n' +
  '    var ligneTerme = function (mot) { return Array.prototype.filter.call(panel.querySelectorAll("tr[data-terme]"), function (tr) { return tr.dataset.terme === mot; })[0]; };\n' +
  '    var refSeul = function () { return panel.querySelector(".prop-ne-plus--ref"); };\n' +
  '    var sansRef = function () { return Array.prototype.filter.call(panel.querySelectorAll(".prop-ne-plus"), function (b) { return !b.classList.contains("prop-ne-plus--ref") && !b.disabled; })[0]; };\n' +
  '    if (etat === "termes") { termes(); }\n' +
  '    if (etat === "termes-role") { termes(); var sr = panel.querySelector(".prop-termes-role"); sr.value = "ambigu"; sr.dispatchEvent(new Event("change")); }\n' +
  '    if (etat === "termes-filtre") { termes(); panel.querySelector(".prop-terme").click(); }\n' +
  '    if (etat === "termes-neplus-ref") { termes(); refSeul().click(); }\n' +
  '    if (etat === "termes-neplus") { termes(); sansRef().click(); }\n' +
  '    if (etat === "termes-ajouter-erreur") { termes(); panel.querySelector(".prop-termes-ajouter").click(); var c = document.getElementById("prop-termes-form-terme"); c.value = "classe(s)"; c.dispatchEvent(new Event("input")); }\n' +
  '    if (etat === "termes-demande") { termes(); sansRef().click(); panel.querySelector(".prop-termes-demander").click(); }\n' +
  '    if (etat === "pourquoi-menu") { ligne("26.4021").querySelector(".prop-titre").click(); panel.querySelector(".prop-pourquoi-puce").click(); }\n' +
  '    if (etat === "largeur") { var s = panel.querySelector("th.prop-th-titre .prop-poignee"); for (var k = 0; k < 6; k++) { s.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); } s.focus(); }\n' +
  '  }\n' +
  '})();\n' +
  '</script>\n';
// Deux thèmes de l'éditeur, posés comme le ferait VSCodium (?theme=clair|sombre) ; sans
// paramètre, les replis de _design.css.
const PALETTES = {
  clair: '--vscode-font-family: "Segoe WPC", "Segoe UI", sans-serif; --vscode-font-size: 13px;'
    + '--vscode-editor-background: #ffffff; --vscode-foreground: #616161; --vscode-descriptionForeground: #717171;'
    + '--vscode-editorWidget-background: #f3f3f3; --vscode-panel-border: rgba(128, 128, 128, 0.35); --vscode-focusBorder: #0090f1;'
    + '--vscode-button-background: #007acc; --vscode-button-foreground: #ffffff; --vscode-button-hoverBackground: #0062a3;'
    + '--vscode-button-secondaryBackground: #5f6a79; --vscode-button-secondaryForeground: #ffffff;'
    + '--vscode-input-background: #ffffff; --vscode-input-foreground: #616161; --vscode-input-border: #cecece;'
    + '--vscode-editorWarning-foreground: #bf8803; --vscode-errorForeground: #a1260d; --vscode-charts-green: #388a34;'
    + '--vscode-textLink-foreground: #006ab1; --vscode-toolbar-hoverBackground: rgba(184, 184, 184, 0.31); --vscode-widget-shadow: rgba(0, 0, 0, 0.16);',
  sombre: '--vscode-font-family: "Segoe WPC", "Segoe UI", sans-serif; --vscode-font-size: 13px;'
    + '--vscode-editor-background: #1f1f1f; --vscode-foreground: #cccccc; --vscode-descriptionForeground: #9d9d9d;'
    + '--vscode-editorWidget-background: #202020; --vscode-panel-border: #2b2b2b; --vscode-focusBorder: #0078d4;'
    + '--vscode-button-background: #0078d4; --vscode-button-foreground: #ffffff; --vscode-button-hoverBackground: #026ec1;'
    + '--vscode-button-secondaryBackground: #313131; --vscode-button-secondaryForeground: #cccccc;'
    + '--vscode-input-background: #313131; --vscode-input-foreground: #cccccc; --vscode-input-border: #3c3c3c;'
    + '--vscode-editorWarning-foreground: #cca700; --vscode-errorForeground: #f85149; --vscode-charts-green: #89d185;'
    + '--vscode-textLink-foreground: #4daafc; --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31); --vscode-widget-shadow: rgba(0, 0, 0, 0.36);'
};
const palettes = Object.keys(PALETTES).map((nom) =>
  '<style id="palette-' + nom + '" media="not all">:root { color-scheme: ' + (nom === 'clair' ? 'light' : 'dark') + '; ' + PALETTES[nom] + ' }</style>\n').join('')
  + '<script nonce="' + nonce + '">(function () { var t = new URLSearchParams(location.search).get("theme");'
  + ' var s = t && document.getElementById("palette-" + t); if (s) { s.media = "all"; } })();</script>\n';
const htmlAutonome = html.replace('<script nonce="' + nonce + '">', shim + '<script nonce="' + nonce + '">')
  .replace('</head>', palettes + '</head>');

// ---- Écriture ---------------------------------------------------------------------------
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-apercu-documentation-'));
const cible = path.join(dossier, 'documentation.html');
fs.writeFileSync(cible, htmlAutonome, 'utf8');

const ongletDemande = process.argv[2] || '';
const categorieDemandee = process.argv[3] || '';
const paramsUrl = ongletDemande
  ? '?onglet=' + encodeURIComponent(ongletDemande) + (categorieDemandee ? '&categorie=' + encodeURIComponent(categorieDemandee) : '')
  : '';
const url = 'file:///' + cible.replace(/\\/g, '/') + paramsUrl;
console.log('Aperçu autonome écrit : ' + cible);
console.log('URL (vue par défaut « Documentation du numéro » sur « Rubriques ») : file:///' + cible.replace(/\\/g, '/'));
console.log('URL vue Traductions à faire : file:///' + cible.replace(/\\/g, '/') + '?onglet=traductions');
console.log('URL vue Réservoir (+ Mes orphelines), sélection multiple déjà démontrée (2 lignes cochées) : '
  + 'file:///' + cible.replace(/\\/g, '/') + '?onglet=reservoir');
console.log('  … la même sans rien cocher : file:///' + cible.replace(/\\/g, '/') + '?onglet=reservoir&selection=0');
console.log('URL Documentation du numéro, UNE catégorie de fiches (ex. Livres) : '
  + 'file:///' + cible.replace(/\\/g, '/') + '?onglet=numero&categorie=livre');
console.log('URL vue Archive (bibliothèque de production, ~20 fiches factices, boutons en icônes Reprendre/Aperçu/Éditer) : '
  + 'file:///' + cible.replace(/\\/g, '/') + '?onglet=archive');
if (ongletDemande) { console.log('Vue demandée sur la ligne de commande : ' + url); }
