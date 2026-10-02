// lib/controles-hote.js et lib/pdfua-hote.js configurés seuls : ce que la vue « Contrôles »
// dit et propose, et l'avis qui suit un verdict PDF/UA.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Les notifications sorties, avec leurs boutons ; les commandes lancées ; la réponse à donner.
const notifs = [];
const commandes = [];
let reponse;

function charger() {
  const Module = require('module');
  const orig = Module._load;
  const notifier = (ton) => async (m, ...boutons) => {
    // Les espaces insécables que typo-check pose se lisent ici comme des espaces simples.
    notifs.push({ ton: ton, texte: String(m).replace(/[\u00a0\u202f]/g, ' '), boutons: boutons.filter((b) => typeof b === 'string') });
    return reponse;
  };
  const faux = {
    version: '1.0.0-essai',
    Uri: { file: (p) => ({ fsPath: p }) },
    window: {
      showErrorMessage: notifier('erreur'),
      showWarningMessage: notifier('avert'),
      showInformationMessage: notifier('info'),
      createStatusBarItem: () => ({ show() {}, hide() {} })
    },
    StatusBarAlignment: { Left: 1 },
    commands: { executeCommand: async (...args) => { commandes.push(args); } },
    workspace: { getConfiguration: () => ({ get: (cle, defaut) => defaut }) },
    env: { language: 'fr' },
    ThemeColor: function ThemeColor(id) { this.id = id; }
  };
  Module._load = function (r, pp, i) { return r === 'vscode' ? faux : orig(r, pp, i); };
  try {
    return {
      controles: require(path.join(COCKPIT, 'lib', 'controles-hote.js')),
      pdfua: require(path.join(COCKPIT, 'lib', 'pdfua-hote.js'))
    };
  } finally { Module._load = orig; }
}
const { controles, pdfua } = charger();

// Un numéro jetable : un article avec sa fiche et son PDF.
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-controles-gestes-'));
const SLUG = '03-massie';
fs.mkdirSync(path.join(racine, 'articles', SLUG), { recursive: true });
fs.writeFileSync(path.join(racine, 'articles', SLUG, SLUG + '.meta.yaml'),
  'type: article\nlang: fr\ntitle:\n  fr: "Inclusion et participation"\n', 'utf8');
fs.writeFileSync(path.join(racine, 'articles', SLUG, SLUG + '.md'), '# Introduction\n\nTexte.\n', 'utf8');
const PDF = path.join(racine, 'out', SLUG, SLUG + '.pdf');
fs.mkdirSync(path.dirname(PDF), { recursive: true });
test.after(() => { fs.rmSync(racine, { recursive: true, force: true }); });

const fournisseur = { racine: racine, listerArticles: () => [SLUG],
  _tablesArticle: () => [], _imagesArticle: () => [] };

// La sortie de rapport-ua.py pour un PDF : conforme, ou non conforme avec ces repères.
function sortieValidateur(reperes) {
  const nom = SLUG + '.pdf';
  if (reperes.length === 0) { return ['[pdf-ua] PDF/UA-1 : ' + nom + ' — conforme.']; }
  const lignes = ['[pdf-ua] PDF/UA-1 : ' + nom + ' — NON conforme, ' + reperes.length + ' règle(s) en échec.'];
  for (const r of reperes) {
    lignes.push('[pdf-ua]   • Règle ' + r + ' (1 fois, page(s) 2)');
    lignes.push('[pdf-ua]       En cause : une cause.');
    lignes.push('[pdf-ua]       À faire  : un geste.');
    lignes.push('[pdf-ua]   ISO 14289-1 ' + r);
  }
  return lignes;
}

let reperesRendus = [];
pdfua.configurer({
  lancerValidateur: async () => ({ lignes: sortieValidateur(reperesRendus), code: reperesRendus.length ? 1 : 0, erreur: null }),
  listerArticles: () => [SLUG],
  profilOuvrage: () => null,
  racine: () => racine,
  surChangement: () => controles.rafraichirPdfUa(fournisseur)
});

// Une compilation : un PDF neuf sur le disque, puis sa validation.
let tour = 0;
async function compilerEtValider(reperes) {
  tour++;
  fs.writeFileSync(PDF, '%PDF-1.7 essai ' + tour + '\n', 'utf8');
  reperesRendus = reperes;
  await pdfua.planifier(racine);
  await new Promise((r) => setImmediate(r));
}

const avisPdfUa = () => notifs.filter((n) => /pas encore accessible/.test(n.texte));

test('verdict PDF/UA : un avis quand la validation ajoute des bloquants, une seule fois par état', async () => {
  controles.reinitialiser();
  notifs.length = 0;
  await compilerEtValider([]);
  assert.strictEqual(avisPdfUa().length, 0, 'un PDF conforme ne mérite pas d’avis');

  await compilerEtValider(['7.4.2-1', '7.1-9']);
  assert.strictEqual(avisPdfUa().length, 1, 'aucun avis pour deux bloquants neufs');
  const avis = avisPdfUa()[0];
  assert.strictEqual(avis.ton, 'erreur');
  assert.strictEqual(avis.texte,
    'Le PDF de « 03 · Inclusion et participation » n’est pas encore accessible : 2 point(s) à corriger.');
  assert.deepStrictEqual(avis.boutons, ['Voir']);

  // Recompilé sans rien corriger : les mêmes règles, pas un second avis.
  await compilerEtValider(['7.4.2-1', '7.1-9']);
  assert.strictEqual(avisPdfUa().length, 1, 'le même état annoncé deux fois');

  // Une règle de moins : rien de neuf à dire.
  await compilerEtValider(['7.1-9']);
  assert.strictEqual(avisPdfUa().length, 1, 'un progrès ne s’annonce pas comme un défaut');

  // Une règle nouvelle : un avis, avec le compte de ce qui reste.
  await compilerEtValider(['7.1-9', '7.5-1']);
  assert.strictEqual(avisPdfUa().length, 2);
  assert.match(avisPdfUa()[1].texte, /: 2 point\(s\) à corriger\.$/);
});

test('verdict PDF/UA : « Voir » ouvre la vue des contrôles', async () => {
  controles.reinitialiser();
  notifs.length = 0;
  commandes.length = 0;
  await compilerEtValider([]);
  reponse = 'Voir';
  try {
    await compilerEtValider(['7.3-1']);
    await new Promise((r) => setImmediate(r));
  } finally { reponse = undefined; }
  assert.strictEqual(avisPdfUa().length, 1);
  assert.ok(commandes.some((c) => c[0] === 'szh.vueControles'), 'le bouton ne mène nulle part');
});

// ---- Les cartes de la vue « Contrôles » --------------------------------------------

function constat(source, code, slug, champs) {
  return { source: source, code: code, ton: 'attention', cle: '', args: [], champs: champs || {}, slug: slug };
}

function cartes(constats) {
  controles.reinitialiser();
  controles.poserConstats(racine, 'reimport', constats);
  return controles.vueControles(fournisseur).lignes;
}

test('carte : le titre porte le nom de l’article, comme la vue Articles', () => {
  const carte = cartes([constat('citations', 'appel-ambigu', SLUG, { appel: '(Sen, 2001)' })])
    .find((l) => l.cle === SLUG);
  assert.strictEqual(carte.titre.replace(/[\u00a0\u202f]/g, ' '), '03 · Inclusion et participation');
  // Un slug qu'aucun dossier ne porte (un Word jamais converti) garde son ancien titre.
  const orphelin = cartes([constat('citations', 'appel-ambigu', '09-word', { appel: '(Sen, 2001)' })])
    .find((l) => /09-word/.test(l.titre));
  assert.strictEqual(orphelin.titre.replace(/[\u00a0\u202f]/g, ' '), 'Article « 09-word »');
});

test('carte : « Recompiler cet article » sur une carte d’article, relancé par le rappel de l’hôte', async () => {
  const relances = [];
  const lignes = cartes([constat('citations', 'appel-ambigu', SLUG, { appel: '(Sen, 2001)' }),
    constat('rendu', 'police-manquante', '')]);
  const carte = lignes.find((l) => l.cle === SLUG);
  const numero = lignes.find((l) => l.titre === 'Ce numéro');
  const bouton = carte.actions.find((a) => a.id === 'recompiler-article');
  assert.ok(bouton, 'pas de bouton de recompilation sur la carte : ' + JSON.stringify(carte.actions));
  assert.strictEqual(bouton.libelle, 'Recompiler cet article');
  assert.ok(!numero.actions.some((a) => a.id === 'recompiler-article'), 'le numéro entier n’est pas un article');
  controles.configurer({ relancerCompilation: (f, slug) => relances.push(slug) });
  try {
    await controles.actionControles(fournisseur, 'recompiler-article', SLUG);
    await controles.actionControles(fournisseur, 'recompiler-article', '');
    await controles.actionControles(fournisseur, 'recompiler-article', '09-word');
  } finally { controles.configurer({ relancerCompilation: () => {} }); }
  assert.deepStrictEqual(relances, [SLUG], 'seul un article qui existe se recompile');
});

test('carte : la règle 7.4.2-1 mène au premier titre qui saute un niveau', async () => {
  const md = path.join(racine, 'articles', SLUG, SLUG + '.md');
  const avant = fs.readFileSync(md, 'utf8');
  fs.writeFileSync(md, '# Introduction\n\n### Méthode\n\n## Résultats\n', 'utf8');
  try {
    await compilerEtValider(['7.4.2-1']);
    controles.reinitialiser();
    const messages = controles.vueControles(fournisseur).lignes
      .filter((l) => l.cle === SLUG).flatMap((l) => l.messages);
    const regle = messages.find((m) => /7\.4\.2-1/.test(m.texte));
    assert.ok(regle, 'aucun message pour la règle : ' + JSON.stringify(messages.map((m) => m.texte)));
    assert.ok(regle.action, 'la règle n’a plus de bouton vers l’article');
    assert.strictEqual(regle.action.id, 'article:### Méthode');
  } finally { fs.writeFileSync(md, avant, 'utf8'); }
});

// ---- Les textes ----------------------------------------------------------------------

const { TL } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const plat = (s) => String(s).replace(/[  ]/g, ' ');

test('tableau enregistré : le message dit que le PDF se met à jour, sans rien demander', () => {
  // La recompilation part d'elle-même (relance différée de l'éditeur de tableaux).
  assert.strictEqual(plat(TL('fr', 'statut.table.enregistree', ['table-01.html'])),
    'Tableau « table-01.html » enregistré – le PDF se met à jour.');
  assert.strictEqual(plat(TL('de', 'statut.table.enregistree', ['table-01.html'])),
    'Tabelle «table-01.html» gespeichert – das PDF wird aktualisiert.');
});

test('messages pour une rédaction non technique, en fr et en de', () => {
  const attendus = {
    'ctl.pdfua.outillage': ['Le contrôle d’accessibilité n’a pas pu se faire cette fois. Enregistrez à nouveau ; si cela se répète, signalez-le.',
      'Die Barrierefreiheitsprüfung konnte diesmal nicht durchgeführt werden. Speichern Sie erneut; wiederholt sich das, melden Sie es.'],
    'pdfua.badge.nonconforme': ['PDF pas encore accessible : 3 point(s) à corriger. Cliquez pour voir lesquels.',
      'PDF noch nicht barrierefrei: 3 Punkt(e) zu beheben. Klicken Sie, um sie anzuzeigen.'],
    'defaut.balisage-simple': ['PDF moins accessible que prévu', 'PDF weniger barrierefrei als vorgesehen'],
    'consigne.niveaux-ecrases': ['Transformez les titres de niveau 4 ou plus en « Titre 3 » (Mise en forme).',
      'Wandeln Sie Überschriften ab Ebene 4 in «Überschrift 3» um (Formatierung).'],
    'detail.dossier-espaces': ['Renommez le dossier sans espaces : l’outil ne sait pas lire un nom de dossier qui contient des espaces.',
      'Benennen Sie den Ordner ohne Leerzeichen um: das Werkzeug kann keinen Ordnernamen mit Leerzeichen lesen.']
  };
  for (const cle of Object.keys(attendus)) {
    assert.strictEqual(plat(TL('fr', cle, ['3'])), attendus[cle][0], cle + ' (fr)');
    assert.strictEqual(plat(TL('de', cle, ['3'])), attendus[cle][1], cle + ' (de)');
  }
});

// ---- « Signaler » ----------------------------------------------------------------------

test('« Signaler » sur les cartes qui disent « signalez-le », et sur l’échec sans cause', () => {
  const lignes = cartes([
    Object.assign(constat('pipeline', 'balisage-simple', SLUG), { brut: 'TEXTE-DE-L-ARTICLE' }),
    constat('cockpit', 'compilation-echec', ''),
    constat('citations', 'appel-ambigu', SLUG, { appel: '(Sen, 2001)' })]);
  const messages = lignes.flatMap((l) => l.messages);
  const signaler = messages.filter((m) => m.action && m.action.id.indexOf('signaler:') === 0);
  assert.deepStrictEqual(signaler.map((m) => m.action.id).sort(),
    ['signaler:cockpit/compilation-echec:', 'signaler:pipeline/balisage-simple:' + SLUG]);
  assert.ok(signaler.every((m) => m.action.libelle === 'Signaler'));
  // Un défaut qui a son geste garde son bouton, sans « Signaler » à côté.
  const appel = messages.find((m) => /Sen, 2001/.test(m.texte));
  assert.ok(appel.action && appel.action.id.indexOf('article:') === 0);
  assert.strictEqual(plat(TL('fr', 'consigne.signaler')),
    'Recompilez ; si le message revient, cliquez « Signaler ».');
});

test('« Signaler » écrit un rapport COCKPIT-SIGNALEMENT, sans texte d’article, et dit ce qui est vrai', async () => {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-signalement-'));
  const avant = { SZH_RAPPORTS: process.env.SZH_RAPPORTS, LOCALAPPDATA: process.env.LOCALAPPDATA,
                  SZH_BASE: process.env.SZH_BASE, SZH_ANCRAGE: process.env.SZH_ANCRAGE };
  process.env.SZH_RAPPORTS = path.join(bac, 'rapports');
  process.env.LOCALAPPDATA = path.join(bac, 'local');
  process.env.SZH_BASE = path.join(bac, 'base');
  delete process.env.SZH_ANCRAGE;
  const journal = path.join(racine, '.szh-journal.log');
  fs.writeFileSync(journal, 'make: *** [Makefile:142] Error 1\n', 'utf8');
  try {
    cartes([Object.assign(constat('pipeline', 'balisage-simple', SLUG), { brut: 'TEXTE-DE-L-ARTICLE' })]);
    const dit = await controles.actionControles(fournisseur, 'signaler:pipeline/balisage-simple:' + SLUG, SLUG);
    assert.strictEqual(plat(dit), 'Signalement enregistré.');
    const fichiers = fs.readdirSync(process.env.SZH_RAPPORTS).filter((n) => n.endsWith('.json'));
    assert.strictEqual(fichiers.length, 1, 'aucun rapport écrit');
    const texte = fs.readFileSync(path.join(process.env.SZH_RAPPORTS, fichiers[0]), 'utf8');
    const rapport = JSON.parse(texte);
    assert.strictEqual(rapport.code, 'COCKPIT-SIGNALEMENT');
    assert.strictEqual(rapport.source, 'cockpit');
    assert.deepStrictEqual(rapport.constats, [{ source: 'pipeline', code: 'balisage-simple', ton: 'attention', slug: SLUG }]);
    assert.match(rapport.message, new RegExp(SLUG));
    assert.ok(rapport.journal && rapport.journal.extrait.some((l) => /Error 1/.test(l)), 'le journal manque');
    assert.strictEqual(rapport.versions.vscodium, '1.0.0-essai');
    assert.ok(texte.indexOf('TEXTE-DE-L-ARTICLE') === -1, 'du texte d’article dans le rapport');
    // Le même clic juste après : l'anti-inondation le retient, et l'écran ne prétend rien.
    const encore = await controles.actionControles(fournisseur, 'signaler:pipeline/balisage-simple:' + SLUG, SLUG);
    assert.notStrictEqual(plat(encore), 'Signalement enregistré.');
    assert.strictEqual(fs.readdirSync(process.env.SZH_RAPPORTS).filter((n) => n.endsWith('.json')).length, 1);
  } finally {
    fs.rmSync(journal, { force: true });
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; } }
    fs.rmSync(bac, { recursive: true, force: true });
  }
});
