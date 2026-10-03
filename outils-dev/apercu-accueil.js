// Rendu autonome de l'Accueil dans l'éditeur (media/accueil.html/.css/.js), hors toolkit : un
// HTML par état, assemblé par construireHtml comme dans l'éditeur, avec un faux hôte qui
// répond à « pret » puis rejoue les gestes et les messages de l'état demandé.
//
// Usage :
//   node outils-dev/apercu-accueil.js [dossier]          tous les états
//   node outils-dev/apercu-accueil.js [dossier] S1 J2    quelques états seulement
// Les valeurs de l'onglet Paramètres sortent du VRAI hôte (lib/accueil-reglages-hote.js), joué sous
// un faux vscode et sur des fichiers jetables : aucun fichier du poste n'est lu ni écrit.
// Capture (Edge headless, depuis Windows) :
//   msedge --headless --disable-gpu --screenshot=<png> --window-size=1100,720 file:///<html>
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const COCKPIT = path.join(__dirname, '..', 'vscodium-extension', 'szh-cockpit');
const { construireHtml } = require(path.join(COCKPIT, 'lib', 'webviews', 'util.js'));
const { textesAccueil, produitParDefaut } = require(path.join(COCKPIT, 'lib', 'accueil-page.js'));
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

// ---- Le thème Default Light+ de l'éditeur, variable par variable ----------------------
const THEME_CLAIR = {
  'font-family': '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, Ubuntu, sans-serif',
  'font-size': '13px', 'font-weight': 'normal',
  'editor-font-family': 'Consolas, "Courier New", monospace', 'editor-font-size': '13px',
  'foreground': '#616161', 'descriptionForeground': '#717171', 'errorForeground': '#a1260d',
  'focusBorder': '#0090f1', 'contrastBorder': 'transparent', 'widget-shadow': 'rgba(0, 0, 0, 0.16)',
  'editor-background': '#ffffff', 'editor-foreground': '#000000',
  'editorWidget-background': '#f3f3f3', 'panel-border': 'rgba(128, 128, 128, 0.35)',
  'button-background': '#007acc', 'button-foreground': '#ffffff', 'button-hoverBackground': '#0062a3',
  'button-secondaryBackground': '#5f6a79', 'button-secondaryForeground': '#ffffff',
  'button-secondaryHoverBackground': '#4c5561',
  'input-background': '#ffffff', 'input-foreground': '#616161', 'input-border': '#cecece',
  'list-activeSelectionBackground': '#0060c0', 'list-activeSelectionForeground': '#ffffff',
  'list-inactiveSelectionBackground': '#e4e6f1', 'list-inactiveSelectionForeground': '#616161',
  'list-hoverBackground': '#e8e8e8', 'list-focusOutline': '#0090f1',
  'textLink-foreground': '#006ab1', 'textLink-activeForeground': '#006ab1',
  'toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)',
  'textBlockQuote-background': '#f2f2f2',
  'editorWarning-foreground': '#bf8803', 'charts-green': '#388a34', 'charts-blue': '#1a85ff',
  'inputValidation-warningBackground': '#f6f5d2', 'inputValidation-warningBorder': '#b89500',
  'inputValidation-errorBackground': '#f2dede', 'inputValidation-errorBorder': '#be1100'
};
function styleTheme() {
  const decl = Object.keys(THEME_CLAIR).map((k) => '  --vscode-' + k + ': ' + THEME_CLAIR[k] + ';').join('\n');
  return '<style>\n:root {\n' + decl + '\n}\n</style>\n';
}

// ---- Données factices ----------------------------------------------------------------
const BASE = 'C:\\Users\\redaction\\SZH\\54_Pronto';
function entree(jeton, nom, titre, modifie, verrouillee, archive) {
  const dossier = archive ? BASE + '\\_Archive\\' + jeton : BASE + '\\' + jeton;
  return { nom: nom, titre: titre, chemin: dossier + '\\' + nom, modifie: modifie, verrouillee: !!verrouillee };
}
function produits() {
  return [
    { jeton: 'revue', libelle: 'Revue', type: 'numero', racine: BASE + '\\Revue', anneeZeroVolume: 2010,
      enCours: [
        entree('Revue', '2026-03', 'École inclusive : vingt ans après', '29.09.2026'),
        entree('Revue', '2026-02', 'Troubles du spectre de l’autisme à l’âge adulte', '14.07.2026', true),
        entree('Revue', '2026-01', 'Communication alternative et améliorée', '02.04.2026', true)
      ],
      archives: [
        entree('Revue', '2025-04', 'Transitions vers la formation professionnelle', '18.12.2025', true, true),
        entree('Revue', '2025-03', 'Pédagogie spécialisée et numérique', '25.09.2025', true, true),
        entree('Revue', '2025-02', 'Les familles face au diagnostic', '30.06.2025', true, true),
        entree('Revue', '2025-01', 'Évaluer sans exclure', '28.03.2025', true, true),
        entree('Revue', '2024-04', 'Enseignement spécialisé en milieu rural', '16.12.2024', true, true)
      ] },
    { jeton: 'zeitschrift', libelle: 'Zeitschrift', type: 'numero', racine: BASE + '\\Zeitschrift', anneeZeroVolume: 1994,
      enCours: [
        entree('Zeitschrift', '2026-05', 'Inklusive Bildung im Kindergarten', '30.09.2026'),
        entree('Zeitschrift', '2026-04', 'Unterstützte Kommunikation', '22.08.2026', true)
      ],
      archives: [
        entree('Zeitschrift', '2026-03', 'Frühförderung', '20.05.2026', true, true),
        entree('Zeitschrift', '2026-02', 'Schulische Heilpädagogik heute', '18.03.2026', true, true)
      ] },
    { jeton: 'livre', libelle: 'Book', type: 'livre', racine: BASE + '\\Book',
      enCours: [entree('Book', '2026-B13-ecole-et-handicap', 'École et handicap : guide pratique', '27.09.2026')],
      archives: [entree('Book', '2025-B12-leichte-sprache', 'Leichte Sprache im Alltag', '10.11.2025', true, true)] }
  ];
}
const HISTORIQUE = {
  edudoc: { revue: { '2025-04': '14.01.2026', '2026-01': '09.04.2026' } },
  caracteres: { revue: { '2025-04': '14.01.2026', '2026-01': '09.04.2026' } }
};
// Les numéros publiés en ligne, tels que la commande numeros-ojs les émet (plus récent d'abord).
const OJS = {
  revue: [
    [2026, 3, 'École inclusive : vingt ans après'], [2026, 2, 'Troubles du spectre de l’autisme à l’âge adulte'],
    [2026, 1, 'Communication alternative et améliorée']
  ],
  zeitschrift: [
    [2026, 5, 'Inklusive Bildung im Kindergarten'], [2026, 4, 'Unterstützte Kommunikation'],
    [2026, 3, 'Frühförderung'], [2026, 2, 'Schulische Heilpädagogik heute']
  ]
};
const JOURNAUX = [
  { date: '01.10.2026 08:12', verdict: 'ok', ko: 14 },
  { date: '24.09.2026 08:05', verdict: 'echec', ko: 22 },
  { date: '23.09.2026 17:41', verdict: 'ok', ko: 13 },
  { date: '16.09.2026 08:09', verdict: 'inconnu', ko: 1 },
  { date: '09.09.2026 08:02', verdict: 'ok', ko: 12 },
  { date: '02.09.2026 08:11', verdict: 'ok', ko: 12 },
  { date: '26.08.2026 08:03', verdict: 'ok', ko: 15 },
  { date: '19.08.2026 08:07', verdict: 'ok', ko: 12 }
].map((j, i) => Object.assign({ rang: i }, j));

function transcript() {
  return [
    '**********************',
    'Début de la transcription Windows PowerShell',
    'Heure de début : 20261001081203',
    'Nom d’utilisateur : POSTE-07\\redaction',
    'Ordinateur : POSTE-07 (Microsoft Windows NT 10.0.26200.0)',
    '**********************',
    '[08:12:03] Version cible : 2026.10.1',
    '[08:12:04] 1/5  Maquette et réglages…',
    '[08:12:09] Maquette et réglages à jour.',
    '[08:12:09] 2/5  Environnement de fabrication du PDF…',
    '[08:12:10] Déjà à jour (2026.09.8).',
    '[08:12:10] 3/5  Extensions de l’éditeur…',
    '[08:12:14]   szh-cockpit-3.1.0.vsix          posée',
    '[08:12:15]   szh-markdown-1.4.2.vsix         déjà à jour',
    '[08:12:15] Extensions à jour.',
    '[08:12:15] 4/5  Réglages de l’éditeur…',
    '[08:12:16] Réglages appliqués, raccourcis du menu Démarrer à jour.',
    '[08:12:16] 5/5  Nettoyage…',
    '[08:12:17] Terminé.',
    '[08:12:17] ✓ Tout est à jour (version 2026.10.1).',
    '**********************',
    'Fin de la transcription Windows PowerShell',
    'Heure de fin : 20261001081217',
    '**********************'
  ].join('\n');
}

// Ce que secretariat-cli.js devrait écrire : des textes cibles, en langage clair et au vrai
// pluriel, que le contrat actuel ne donne pas encore (voir la planche).
const PHRASES = {
  fr: {
    lecture: 'Lecture du numéro 2026-03…', ed: 'Éditorial : 1 article', dt: 'Dossier thématique : 4 articles',
    va: 'Varia : 2 articles', auteurs: 'Liste des auteurs : 11 personnes',
    newsletterOk: '6 fichiers produits pour le numéro 2026-03.',
    comparaison: 'Comparaison avec le site de la Revue…',
    siteKo: 'Le site de la Revue (ojs.szh.ch) ne répond pas depuis 30 secondes. Vérifiez la connexion, puis réessayez.',
    edudocLecture: 'Lecture du numéro 2026-02 (1 sur 2)…',
    phrase: 'Le PDF de la Revue 2026-03 sort sans les portraits des auteurs.'
  },
  de: {
    phrase: 'Das PDF der Zeitschrift 2026-05 erscheint ohne die Porträts der Autorenschaft.'
  }
};

// ---- Les valeurs des réglages : le vrai hôte, sous un faux vscode -----------------------
// Un hôte unique par processus : le crochet de require ne se défait pas. Les fichiers du poste
// (config.json, état du compte, cache des auteur·e·s) sont détournés vers un dossier jetable.
let hoteReglages = null;
function chargerHote() {
  if (hoteReglages) { return hoteReglages; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-apercu-reglages-'));
  process.on('exit', () => { try { fs.rmSync(travail, { recursive: true, force: true }); } catch (e) { /* débris */ } });
  const ecrire = (nom, contenu) => { const c = path.join(travail, nom); fs.writeFileSync(c, contenu); return c; };
  process.env.SZH_CONFIG_OJS = ecrire('config.json', JSON.stringify({ emplacementRevues: 'production' }));
  process.env.SZH_ETAT_POSTE = ecrire('state.json', '{}');
  process.env.LOCALAPPDATA = path.join(travail, 'Local');
  const auteurs = [];
  for (let i = 0; i < 1412; i++) { auteurs.push({ prenom: 'P' + i, nom: 'N' + i, datePublication: '2026-01-01T00:00:00Z' }); }
  const ror = {};
  for (let i = 0; i < 187; i++) { ror['ror' + i] = 'Institution ' + i; }
  process.env.SZH_AUTEURS_CACHE = ecrire('auteurs.json', JSON.stringify({
    version: 2, dateFetch: '2026-10-01T08:00:00Z', dateCorpus: '2026-10-01T08:00:00Z', ror: ror, vus: {}, auteurs: auteurs }));
  const configuration = { 'workbench.colorTheme': 'Default Light Modern', 'window.zoomLevel': 0,
    'szh.shlinkUrl': 'https://link.szh-csps.ch' };
  const faux = {
    Uri: { file: (p) => ({ fsPath: p }) }, window: {}, env: { language: 'fr' },
    ConfigurationTarget: { Global: 1 }, EventEmitter: class { constructor() { this.event = () => ({}); } fire() {} },
    workspace: { getConfiguration: (section) => ({
      get: (cle, defaut) => { const k = (section ? section + '.' : '') + cle; return k in configuration ? configuration[k] : defaut; },
      update: () => Promise.resolve(), inspect: () => ({}) }) }
  };
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (requete) { return requete === 'vscode' ? faux : orig.apply(this, arguments); };
  try {
    const reglages = require(path.join(COCKPIT, 'lib', 'reglages-hote.js'));
    reglages.configurer({ compterSuggestionsInterface: () => 3 });
    hoteReglages = {
      accueil: require(path.join(COCKPIT, 'lib', 'accueil-reglages-hote.js')),
      session: require(path.join(COCKPIT, 'lib', 'session.js')),
      coedition: require(path.join(COCKPIT, 'lib', 'coedition.js')),
      profils: require(path.join(COCKPIT, 'lib', 'profil.js')),
      services: require(path.join(COCKPIT, 'lib', 'services-env.js'))
    };
  } finally { Module._load = orig; }
  hoteReglages.services.poser({ url: 'https://link.szh-csps.ch', shlinkCle: 'x', ojsCle: '' });
  return hoteReglages;
}
// Une racine active jetable : vide, ou avec deux moissonneurs synthétiques (`moissons`), l'un
// avec ses crans et un réglage par revue, l'autre sans crans. `avec` vaut 'demandes' pour ajouter
// des demandes sur le lexique de chaque statut, avec la réponse du moissonneur.
function racineMoissons(avec, langue) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-apercu-moissons-'));
  process.on('exit', () => { try { fs.rmSync(racine, { recursive: true, force: true }); } catch (e) { /* débris */ } });
  if (!avec) { return racine; }
  const base = path.join(racine, '_NewsUndActu', '_Moissons');
  const ecrire = (dossier, nom, contenu) => { fs.mkdirSync(path.join(base, dossier), { recursive: true }); fs.writeFileSync(path.join(base, dossier, nom), contenu); };
  const seuils = [0, 5, 9, 12, 12, 18, 29, 38, 56, 78];
  const par = [81, 75, 66, 63, 63, 41, 34, 25, 16, 9], rappel = [73, 72, 70, 69, 69, 65, 57, 50, 37, 18];
  const crans = seuils.map((s, i) => ({ cran: i + 1, seuil: s, par_mois: par[i], rappel: rappel[i], rappel_sur: 79,
    identique_au_cran_precedent: i > 0 && seuils[i - 1] === s }));
  ecrire('parlement', 'etat.json', JSON.stringify({ format: 'pronto-etat/1', moissonneur: 'parlement',
    derniere_moisson: '2026-10-01T05:12:00Z', crans: { fr: crans, de: crans }, crans_calcules_le: '2026-10-01',
    crans_source: { fr: 'langue', de: 'commun' }, crans_fenetre: { du: '2026-04-01', au: '2026-09-30' } }));
  const ligne = (id, categorie) => JSON.stringify({ format: 'pronto-proposition/1', cle: 'parlement:exemple:' + id,
    moissonneur: 'parlement', type: 'intervention', langue: 'fr', valeurs: { title: 'Objet ' + id },
    pertinence: { score: 20, categorie: categorie } });
  ecrire('parlement', '2026-10-01-1.jsonl', ['titre', 'texte-dense', 'signal-faible', 'ecole', 'theme']
    .map((c, i) => ligne(String(i), c)).join('\n') + '\n');
  ecrire('isbn', 'etat.json', JSON.stringify({ format: 'pronto-etat/1', moissonneur: 'isbn', derniere_moisson: '2026-09-30T06:05:00Z' }));
  ecrire('_Reglages', 'fr.json', JSON.stringify({ parlement: { intervention: { cran: 6, par: 'Claire Exemple', le: '2026-10-01' } } }));
  ecrire('_Reglages', 'de.json', JSON.stringify({ parlement: { intervention: { cran: 5, par: 'Jonas Beispiel', le: '2026-09-24' } } }));
  if (avec === 'demandes') { demandesSynthetiques(base, ecrire, langue, crans); }
  return racine;
}

// Une demande de chaque statut, aux noms et titres fictifs ; la personne du poste est la première.
function demandesSynthetiques(base, ecrire, langue, crans) {
  const de = langue === 'de';
  const moi = de ? 'Jonas Beispiel' : 'Claire Exemple', autre = de ? 'Claire Exemple' : 'Jonas Beispiel';
  const t = (fr, all) => (de ? all : fr);
  const effet = (a, b, c, d, complet) => ({ rappel_avant: a, rappel_apres: b, par_mois_avant: c, par_mois_apres: d, complet: complet });
  const liste = [
    ['20261002-091500-a1b2c3d4', t('harcèlement', 'Mobbing'), 'exclusion', moi, '2026-10-02T09:15:00Z', null],
    ['20260903-140000-b2c3d4e5', t('jeux vidéo', 'Videospiele'), 'exclusion', autre, '2026-09-03T14:00:00Z',
      { statut: 'applique', mesure_le: '2026-09-15', effet: effet(73, 73, 84, 81, true) }],
    ['20260922-101000-c3d4e5f6', t('classe ressource', 'Förderklasse'), 'ajout', moi, '2026-09-22T10:10:00Z',
      { statut: 'applique-partiel', mesure_le: '2026-10-01', effet: effet(73, 74, 81, 82, false) }],
    ['20260910-083000-d4e5f6a7', t('intégration', 'Integration'), 'exclusion', moi, '2026-09-10T08:30:00Z',
      { statut: 'refuse-perte', mesure_le: '2026-09-15', effet: effet(73, 70, 81, 69, true),
        fiches_perdues: t(['Intégration au cycle 3 : bilan après dix ans', 'Intégration à l’école enfantine : quelles ressources ?',
          'Transition vers le secondaire : garantir l’intégration'], ['Integration im Zyklus 3: Bilanz nach zehn Jahren',
          'Integration im Kindergarten: welche Ressourcen?', 'Übergang in die Sekundarstufe: Integration sichern']) }],
    ['20260911-160000-e5f6a7b8', t('participation', 'Teilhabe'), 'exclusion', autre, '2026-09-11T16:00:00Z',
      { statut: 'refuse-perte', mesure_le: '2026-09-15', effet: effet(73, 72, 81, 76, true),
        fiches_perdues: [t('Participation des familles à l’école spécialisée', 'Teilhabe der Familien an der Sonderschule')] }],
    ['20260912-110000-f6a7b8c9', t('école', 'Schule'), 'ajout', moi, '2026-09-12T11:00:00Z',
      { statut: 'refuse-bruit', mesure_le: '2026-09-15', effet: effet(73, 75, 81, 115, true) }],
    ['20260928-090000-a7b8c9d0', t('logopédie', 'Logopädie'), 'ajout', autre, '2026-09-28T09:00:00Z',
      { statut: 'doublon', mesure_le: '2026-10-01' }],
    ['20260830-120000-b8c9d0e1', t('autonomie', 'Selbstständigkeit'), 'exclusion', moi, '2026-08-30T12:00:00Z',
      { statut: 'a-confirmer', mesure_le: '2026-09-15',
        fiches_perdues: [t('Autonomie des élèves en classe spécialisée', 'Selbstständigkeit in der Sonderklasse')] }],
    ['20260825-080000-c9d0e1f2', t('inclusion', 'Inklusion'), 'exclusion', moi, '2026-08-25T08:00:00Z',
      { statut: 'refuse-perte', mesure_le: '2026-09-01',
        fiches_perdues: [t('École inclusive : un état des lieux', 'Inklusive Schule: eine Bestandsaufnahme')] },
      { confirme_par: moi, confirme_le: '2026-09-02T07:45:00Z' }],
    ['20260820-150000-d0e1f2a3', t('devoirs', 'Hausaufgaben'), 'exclusion', autre, '2026-08-20T15:00:00Z',
      { statut: 'applique', mesure_le: '2026-09-01', effet: effet(73, 73, 88, 84, true) }],
    ['20261003-081500-e1f2a3b4', t('devoirs', 'Hausaufgaben'), 'retrait', moi, '2026-10-03T08:15:00Z', null]
  ];
  const reponses = [];
  for (const [id, terme, sens, par, le, reponse, extra] of liste) {
    ecrire(path.join('parlement', 'demandes'), id + '.json',
      JSON.stringify(Object.assign({ id: id, terme: terme, langue: langue, sens: sens, par: par, le: le }, extra || {})));
    if (reponse) { reponses.push(Object.assign({ id: id, fiches_perdues: [] }, reponse)); }
  }
  // Un fichier que le moissonneur a écarté : son nom n'est pas sûr.
  const etat = JSON.parse(fs.readFileSync(path.join(base, 'parlement', 'etat.json'), 'utf8'));
  etat.demandes = reponses;
  etat.demandes_ignorees = [{ fichier: 'demande (copie).json', raison: t('nom de fichier non sûr', 'unsicherer Dateiname') }];
  void crans;
  ecrire('parlement', 'etat.json', JSON.stringify(etat));
}

// Le message « valeurs » que l'hôte enverrait : `livre` ouvre un livre dans la fenêtre (les blocs
// d'une revue ne sont alors pas envoyés), `deverrouille` rejoue le verrou ouvert.
function valeursReglages(langue, opts) {
  const o = opts || {};
  const hote = chargerHote();
  hote.session.poserProfilOuvrage(o.livre ? hote.profils.PROFILS.livre : null);
  // La racine active de l'aperçu est toujours jetable : jamais les moissons du poste.
  process.env.SZH_RACINE_PROD = racineMoissons(o.moissons, langue);
  // Les demandes : le poste porte un nom fictif, celui de la personne qui en a fait certaines.
  if (o.moissons === 'demandes') {
    hote.session.poserIdentiteCoedition(hote.coedition.identite(langue === 'de' ? 'Jonas Beispiel' : 'Claire Exemple'));
  }
  const msg = hote.accueil.messageValeurs();
  hote.session.poserIdentiteCoedition(null);
  msg.poste.produitAuto = produitParDefaut(langue, '', '', ['revue', 'zeitschrift', 'livre']);
  if (o.deverrouille) { msg.proteges = Object.assign({}, msg.proteges, { deverrouille: true }); }
  return msg;
}

// Le Préprocessing : un dossier de manuscrits reçus, un manuscrit fictif, et les textes que
// l'hôte devra rendre (le refus au vrai pluriel, que la CLI n'écrit pas encore ainsi).
const PREPROC = {
  fr: {
    dossier: 'C:\\Users\\redaction\\OneDrive - SZH\\Revue\\Manuscrits reçus\\2026-04',
    nom: 'Martin-cooperation-ecole-familles.docx', sortie: 'Martin-cooperation-ecole-familles-nettoye.docx',
    refus: '12 modifications suivies ne sont pas acceptées. Acceptez-les ou refusez-les dans Word, puis relancez.',
    echec: 'Le nettoyeur s’est arrêté pendant le contrôle de la bibliographie. Réessayez ; si cela se répète, écrivez au support de Pronto.'
  },
  de: {
    dossier: 'C:\\Users\\redaktion\\OneDrive - SZH\\Zeitschrift\\Manuskripte\\2026-06',
    nom: 'Keller-Kooperation-Schule-Familie.docx', sortie: 'Keller-Kooperation-Schule-Familie-nettoye.docx',
    refus: '12 nachverfolgte Änderungen sind nicht angenommen. Nehmen Sie sie in Word an oder lehnen Sie sie ab und starten Sie dann erneut.',
    echec: 'Der Bereiniger hat bei der Prüfung des Literaturverzeichnisses angehalten. Versuchen Sie es erneut; wenn es sich wiederholt, schreiben Sie an den Pronto-Support.'
  }
};

// ---- Les états -----------------------------------------------------------------------
// Une étape : ['hote', message] rejoue un message de l'hôte ; ['clic', sélecteur] un clic ;
// ['saisir', sélecteur, texte] une frappe dans un champ ; ['ouvrirTous', sélecteur] ouvre des <details>.
function etats(langue) {
  const P = PHRASES[langue] || PHRASES.fr;
  const L = (commande, ligne) => ['hote', { type: MSG.ACCUEIL_LIGNE, commande: commande, ligne: ligne }];
  const debut = (commande) => ['hote', { type: MSG.ACCUEIL_DEBUT, commande: commande }];
  const fin = (commande, o) => ['hote', Object.assign({ type: MSG.ACCUEIL_FIN, commande: commande }, o)];
  const ojs = (revue) => OJS[revue].map((n) => L('numeros-ojs', { t: 'numero', cle: n[0] + '-0' + n[1],
    libelle: n[2], annee: n[0], numero: n[1] })).concat([fin('numeros-ojs', { ok: true, texte: '' })]);
  const revue = langue === 'de' ? 'zeitschrift' : 'revue';
  const secretariat = [['clic', '#onglet-secretariat']].concat(ojs(revue));
  const enCours = secretariat.concat([['clic', '#sec-newsletter'], debut('newsletter'),
    L('newsletter', { t: 'etape', texte: P.lecture }), L('newsletter', { t: 'etape', texte: P.ed }),
    L('newsletter', { t: 'etape', texte: P.dt }), L('newsletter', { t: 'progres', fait: 3, total: 6 })]);
  const fichiers = ['0-intro.txt', '1-editorial.txt', '2-dossier-thematique.txt', '3-varia.txt', '4-tribune-libre.txt', '5-documentation.txt', 'auteurs.csv']
    .map((f) => L('newsletter', { t: 'fichier', chemin: BASE + '\\Exports\\Newsletter\\2026-03\\' + f, nom: f }));
  const journal = [['clic', '#onglet-journal'],
    ['hote', { type: MSG.ACCUEIL_JOURNAL_TEXTE, rang: 0, texte: transcript(), lignes: 200 }]];
  const signaler = journal.concat([['clic', '#jrn-signaler'], ['saisir', '#jrn-phrase', P.phrase]]);
  const PP = PREPROC[langue] || PREPROC.fr;
  const preproc = [['clic', '#onglet-preproc'], ['hote', { type: MSG.ACCUEIL_PREPROC_ETAT, produit: revue,
    format: 'docx', dossier: PP.dossier, depot: true, tailleMax: 50 * 1024 * 1024 }]];
  const ppEtapes = (jusqua) => ['preparation', 'lecture', 'entete', 'identifiants', 'titres', 'formatage',
    'typographie', 'regles', 'bibliographie', 'ecriture', 'annotation', 'rapport']
    .slice(0, jusqua).map((e) => ['hote', { type: MSG.ACCUEIL_PREPROC_ETAPE, etape: e }]);
  const ppDebut = preproc.concat([['clic', '#pp-choisir'],
    ['hote', { type: MSG.ACCUEIL_PREPROC_DEBUT, nom: PP.nom, produit: revue, format: 'docx' }]]);
  const ppFin = (jusqua, o) => ppDebut.concat(ppEtapes(jusqua),
    [['hote', Object.assign({ type: MSG.ACCUEIL_PREPROC_FIN }, o)]]);
  const ppReussi = { document: PP.sortie, rapport: true, rapportOuvert: true };
  return {
    'P1-repos': { etapes: [] },
    'P2-archives': { etapes: [['clic', '#prod-archives'], ['clic', '#archive-1']] },
    'P3-vide': { produits: (p) => p.map((x) => (x.jeton === 'revue' ? Object.assign({}, x, { enCours: [], archives: [] }) : x)),
      etapes: [] },
    'N1-repos': { etapes: [['clic', '#onglet-nouveau']] },
    'N2-erreur': { etapes: [['clic', '#onglet-nouveau'], ['saisir', '#nv-numero', '3']] },
    'N3-livre': { etapes: [['clic', '#onglet-nouveau'], ['clic', '#produit-nv-livre']] },
    'PP1-repos': { etapes: preproc },
    'PP2-choisi': { etapes: ppDebut.concat(ppEtapes(1)) },
    'PP3-en-cours': { etapes: ppDebut.concat(ppEtapes(8)) },
    'PP4-reussite': { etapes: ppFin(12, Object.assign({ issue: 'ok', alertes: { suggestions: 3 } }, ppReussi)) },
    'PP5-alertes': { etapes: ppFin(12, Object.assign({ issue: 'alertes',
      alertes: { erreurs: 2, avertissements: 5, suggestions: 7 } }, ppReussi)) },
    'PP6-refus': { etapes: ppFin(2, { issue: 'refus', texte: PP.refus, rapport: true }) },
    'PP7-echec': { etapes: ppFin(9, { issue: 'echec', texte: PP.echec }) },
    'PP8-options': { etapes: preproc.concat([['clic', '#pp-options']]) },
    'PP9-interrompu': { etapes: ppFin(5, { issue: 'interrompu' }) },
    'S1-repos': { etapes: secretariat },
    'S2-chargement': { etapes: [['clic', '#onglet-secretariat']] },
    'S3-edudoc': { etapes: secretariat.concat([['clic', '#sec-edudoc-modifier']]) },
    'S4-en-cours': { etapes: enCours },
    'S5-reussite': { etapes: enCours.concat([L('newsletter', { t: 'etape', texte: P.va }),
      L('newsletter', { t: 'etape', texte: P.auteurs })], fichiers,
      [fin('newsletter', { ok: true, texte: P.newsletterOk, dossier: BASE + '\\Exports\\Newsletter\\2026-03' })]) },
    'S6-echec': { etapes: secretariat.concat([['clic', '#sec-metadonnees'], debut('metadonnees'),
      L('metadonnees', { t: 'etape', texte: P.lecture }), L('metadonnees', { t: 'etape', texte: P.comparaison }),
      fin('metadonnees', { ok: false, texte: P.siteKo })]) },
    'S7-interrompu': { etapes: secretariat.concat([['clic', '#sec-edudoc'], debut('edudoc'),
      L('edudoc', { t: 'etape', texte: P.edudocLecture }), L('edudoc', { t: 'progres', fait: 1, total: 2 }),
      ['clic', '#sec-edudoc-interrompre'], fin('edudoc', { ok: false, annule: true, texte: '' })]) },
    'R1-reglages-fr': { valeurs: {}, etapes: [['clic', '#onglet-reglages']] },
    'R1-reglages-de': { valeurs: {}, etapes: [['clic', '#onglet-reglages']] },
    'R2-deverrouille': { valeurs: { deverrouille: true }, etapes: [['clic', '#onglet-reglages'],
      ['ouvrirTous', '#panneau-reglages .accueil-details']] },
    'R3-livre': { valeurs: { livre: true }, etapes: [['clic', '#onglet-reglages']] },
    // La section Moissonnage, mise en tête de la capture : ce qui la précède est masqué.
    'R4-moissonnage-fr': { valeurs: { moissons: true }, etapes: [['clic', '#onglet-reglages'], ['masquerAvant', '#regl-moissonnage']] },
    'R4-moissonnage-de': { valeurs: { moissons: true }, etapes: [['clic', '#onglet-reglages'], ['masquerAvant', '#regl-moissonnage']] },
    // Les demandes sur le lexique, un exemple de chaque statut.
    'R5-demandes-fr': { valeurs: { moissons: 'demandes' }, etapes: [['clic', '#onglet-reglages'], ['masquerAvant', '#regl-moissonnage']] },
    'R5-demandes-de': { valeurs: { moissons: 'demandes' }, etapes: [['clic', '#onglet-reglages'], ['masquerAvant', '#regl-moissonnage']] },
    'J1-ouvert': { etapes: journal },
    'J2-signaler': { etapes: signaler },
    'J3-envoye': { etapes: signaler.concat([['clic', '#jrn-signal-envoyer'],
      ['hote', { type: MSG.ACCUEIL_SIGNALE, issue: 'fait', courriel: true }]]) }
  };
}

// ---- Assemblage ----------------------------------------------------------------------
function htmlEtat(nom, langue) {
  const ancienne = process.env.SZH_LANGUE;
  process.env.SZH_LANGUE = langue;
  try {
    const etat = etats(langue)[nom];
    if (!etat) { throw new Error('état inconnu : ' + nom); }
    const nonce = crypto.randomBytes(16).toString('hex');
    const html = construireHtml('accueil', nonce, {
      cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
      titre: 'Pronto – ' + nom,
      remplacements: { '__TXT__': JSON.stringify(textesAccueil()) },
      csp: "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
    });
    const liste = etat.produits ? etat.produits(produits()) : produits();
    const reglages = etat.valeurs ? valeursReglages(langue, etat.valeurs) : null;
    const charger = {
      type: MSG.CHARGER, langue: langue, anneeCourante: 2026, modeTest: false, ancrageAbsent: false,
      version: '2026.10.1', exports: BASE + '\\Exports', produits: liste,
      produit: produitParDefaut(langue, '', '', liste.map((p) => p.jeton)),
      dernierOuvert: langue === 'de' ? BASE + '\\Zeitschrift\\2026-05' : BASE + '\\Revue\\2026-03',
      historique: HISTORIQUE, journaux: JOURNAUX
    };
    const suite = reglages ? [reglages] : [];
    const shim = '<script nonce="' + nonce + '">\n' +
      '(function () {\n' +
      '  var CHARGER = ' + JSON.stringify(charger) + ';\n' +
      '  var SUITE = ' + JSON.stringify(suite) + ';\n' +
      '  var ETAPES = ' + JSON.stringify(etat.etapes) + ';\n' +
      '  window.__postes = [];\n' +
      '  var api = null;\n' +
      '  window.acquireVsCodeApi = function () {\n' +
      '    if (api) { return api; }\n' +
      '    api = { postMessage: function (m) {\n' +
      '      window.__postes.push(m);\n' +
      '      if (m && m.type === "pret") {\n' +
      '        window.dispatchEvent(new MessageEvent("message", { data: CHARGER }));\n' +
      '        SUITE.forEach(function (d) { window.dispatchEvent(new MessageEvent("message", { data: d })); });\n' +
      '      }\n' +
      '    }, setState: function () {}, getState: function () { return null; } };\n' +
      '    return api;\n' +
      '  };\n' +
      // Une erreur s'écrit en tête de page : une capture ratée doit se voir sur l'image.
      '  window.addEventListener("error", function (ev) {\n' +
      '    var p = document.createElement("pre"); p.textContent = "ERREUR APERÇU : " + ev.message;\n' +
      '    document.body.insertBefore(p, document.body.firstChild);\n' +
      '  });\n' +
      '  window.addEventListener("load", function () {\n' +
      '    ETAPES.forEach(function (e) {\n' +
      '      if (e[0] === "hote") { window.dispatchEvent(new MessageEvent("message", { data: e[1] })); return; }\n' +
      '      if (e[0] === "masquerAvant") { var z = document.querySelector(e[1]); Array.prototype.forEach.call(z.parentNode.children, function (x) { if (x !== z && (x.compareDocumentPosition(z) & 4)) { x.style.display = "none"; } }); return; }\n' +
      '      if (e[0] === "ouvrirTous") { document.querySelectorAll(e[1]).forEach(function (d) { d.open = true; }); return; }\n' +
      '      var el = document.querySelector(e[1]);\n' +
      '      if (!el) { throw new Error("aperçu : élément introuvable " + e[1]); }\n' +
      '      if (e[0] === "clic") { el.click(); }\n' +
      '      else if (e[0] === "saisir") { el.value = e[2]; el.dispatchEvent(new Event("input", { bubbles: true })); }\n' +
      '    });\n' +
      '  });\n' +
      '})();\n' +
      '</script>\n';
    return html.replace('</head>', styleTheme() + '</head>')
      .replace('<script nonce="' + nonce + '">', shim + '<script nonce="' + nonce + '">');
  } finally {
    if (ancienne === undefined) { delete process.env.SZH_LANGUE; } else { process.env.SZH_LANGUE = ancienne; }
  }
}

// Les états rendus : tous en français, et le repos de Produits et du Secrétariat en allemand.
function liste() {
  const fr = Object.keys(etats('fr')).filter((n) => !/-de$/.test(n)).map((n) => ({ nom: n, langue: 'fr' }));
  // Le Préprocessing en allemand : la Zeitschrift d'office, et une réussite.
  const preprocDe = [{ nom: 'PP1-repos', langue: 'de' }, { nom: 'PP5-alertes', langue: 'de' }];
  return fr.concat([{ nom: 'P1-repos', langue: 'de' }, { nom: 'S1-repos', langue: 'de' }, { nom: 'R1-reglages-de', langue: 'de' }, { nom: 'R4-moissonnage-de', langue: 'de' }, { nom: 'R5-demandes-de', langue: 'de' }], preprocDe);
}

function ecrire(dossier, filtres) {
  fs.mkdirSync(dossier, { recursive: true });
  const sortie = [];
  for (const e of liste()) {
    if (filtres.length && !filtres.some((p) => e.nom.indexOf(p) === 0)) { continue; }
    const cible = path.join(dossier, (/-(fr|de)$/.test(e.nom) ? e.nom : e.nom + '-' + e.langue) + '.html');
    fs.writeFileSync(cible, htmlEtat(e.nom, e.langue), 'utf8');
    sortie.push(cible);
  }
  return sortie;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dossier = args[0] && !/^[SJPNR]\d/.test(args[0]) ? args.shift()
    : fs.mkdtempSync(path.join(os.tmpdir(), 'szh-apercu-accueil-'));
  for (const f of ecrire(dossier, args)) { console.log(f); }
}

module.exports = { etats, htmlEtat, liste, ecrire };
