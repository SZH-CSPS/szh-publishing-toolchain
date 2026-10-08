// La newsletter (lib/secretariat.js, export-templates/newsletter-*.twig) et les adresses
// d'OJS fixées par Pronto (lib/ojs-adresses.js, écrites par lib/export-ojs.js).
//
// Les sorties attendues sont écrites en toutes lettres, d'après les modèles de la newsletter
// (Mailchimp) : balisage, ordre des lignes et liens de la rédaction, en UTF-8 sans entités.
// Les noms et les titres sont inventés.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SZH_LANGUE = 'fr';
process.env.SZH_RESEAU_INTERDIT = '1';
const CONFIG_ESSAI = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-news-cfg-')), 'config.json');
process.env.SZH_CONFIG_OJS = CONFIG_ESSAI;

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const secretariat = require(path.join(COCKPIT, 'lib', 'secretariat.js'));
const adresses = require(path.join(COCKPIT, 'lib', 'ojs-adresses.js'));
const ojs = require(path.join(COCKPIT, 'lib', 'export-ojs.js'));

const NB = ' ';   // l'insécable des guillemets et des deux-points français

// ---- Numéros d'essai ------------------------------------------------------------------

function ecrireNumero(nomDossier, ausgabe, articles) {
  const racine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-news-')), nomDossier);
  fs.mkdirSync(racine, { recursive: true });
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), ausgabe.concat(['']).join('\n'));
  for (const a of articles) {
    const dossier = path.join(racine, 'articles', a.slug);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, a.slug + '.md'), 'Texte.\n');
    fs.writeFileSync(path.join(dossier, a.slug + '.meta.yaml'), a.fiche.concat(['']).join('\n'));
  }
  return racine;
}

function fiche(type, lang, titreFr, titreDe, auteurs, sousTitre) {
  const l = ['type: ' + type, 'lang: ' + lang, 'title:', '  fr: "' + titreFr + '"', '  de: "' + titreDe + '"'];
  if (sousTitre) { l.push('subtitle:', '  fr: "' + sousTitre[0] + '"', '  de: "' + sousTitre[1] + '"'); }
  l.push('resume:', '  fr: "Un résumé."', '  de: "Eine Zusammenfassung."');
  l.push('author:');
  for (const a of auteurs) { l.push('- prenom: "' + a[0] + '"', '  nom: "' + a[1] + '"'); }
  return l;
}

function numeroRevue() {
  return ecrireNumero('2026-03', [
    'revue: "revue"', 'title: "Adaptation du PER"', 'lang: fr', 'volume: "16"', 'numero: "03"',
    'date: "2026-09-01"',
    'ordre-articles: ["00-editorial", "01-per", "02-evaluation", "08-varia", "09-tribune", "10-documentation"]',
    'articles-sans-doi: ["10-documentation"]'
  ], [
    { slug: '00-editorial', fiche: fiche('editorial', 'fr', 'Mot de la rédaction', 'Wort der Redaktion', [['Claire', 'Rossi']]) },
    { slug: '01-per', fiche: fiche('article', 'fr', 'Adapter le PER', 'Den PER anpassen',
      [['Anne', 'Dupont'], ['Bruno', 'Meyer']], ['Un sous-titre', 'Ein Untertitel']) },
    { slug: '02-evaluation', fiche: fiche('article', 'fr', 'Évaluer', 'Beurteilen',
      [['Anne', 'Dupont'], ['Bruno', 'Meyer'], ['Claire', 'Rossi']]) },
    { slug: '08-varia', fiche: fiche('varia', 'fr', 'Un texte libre', 'Ein freier Text', [['Bruno', 'Meyer']]) },
    { slug: '09-tribune', fiche: fiche('tribune-libre', 'fr', 'Le cordon', 'Das Band', [['Claire', 'Rossi'], ['Anne', 'Dupont']]) },
    { slug: '10-documentation', fiche: fiche('documentation', 'fr', 'Actualité et ressources',
      'Aktuelles und Ressourcen', [['', 'La rédaction']]) }
  ]);
}

function numeroZeitschrift() {
  return ecrireNumero('2026-07', [
    'revue: "zeitschrift"', 'title: "Politische Teilhabe"', 'lang: de', 'volume: "32"', 'numero: "07"',
    'date: "2026-09-01"',
    'ordre-articles: ["00-editorial", "01-teilhabe", "02-abstimmen", "08-frei", "09-tribune", "10-dokumentation"]',
    'articles-sans-doi: ["10-dokumentation"]'
  ], [
    { slug: '00-editorial', fiche: fiche('editorial', 'de', 'Mot de la rédaction', 'Demokratie braucht alle', [['Claire', 'Rossi']]) },
    { slug: '01-teilhabe', fiche: fiche('article', 'de', 'Participation politique', 'Politische Teilhabe',
      [['Anne', 'Dupont']], ['Autoreprésentation', 'Selbstvertretung']) },
    { slug: '02-abstimmen', fiche: fiche('article', 'de', 'Voter', 'Abstimmen',
      [['Anne', 'Dupont'], ['Bruno', 'Meyer'], ['Claire', 'Rossi']]) },
    { slug: '08-frei', fiche: fiche('varia', 'de', 'Un texte libre', 'Ein freier Text', [['Bruno', 'Meyer']]) },
    { slug: '09-tribune', fiche: fiche('tribune-libre', 'de', 'Le cordon', 'Das Band', [['Claire', 'Rossi']]) },
    { slug: '10-dokumentation', fiche: fiche('documentation', 'de', 'Actualité et ressources',
      'Aktuelles und Ressourcen', [['', 'Die Redaktion']]) }
  ]);
}

async function produire(racine) {
  const sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-news-sortie-'));
  const evenements = [];
  const resultat = await secretariat.commandeNewsletter({
    racineNumero: racine, dossierSortie: sortie, emettre: (e) => evenements.push(e)
  });
  const lire = (nom) => fs.readFileSync(path.join(sortie, nom), 'utf8');
  return { sortie, evenements, resultat, lire, noms: fs.readdirSync(sortie).sort() };
}

const NOMS = ['0-intro.txt', '1-editorial.txt', '2-dossier-thematique.txt', '3-varia.txt',
  '4-tribune-libre.txt', '5-documentation.txt', 'auteurs.csv'];

// ---- Les chemins fixés par Pronto -----------------------------------------------------

test('normaliserCheminOjs : [a-z0-9-] seulement, jamais uniquement numérique', () => {
  const n = adresses.normaliserCheminOjs;
  assert.strictEqual(n('Éditorial & Cie !'), 'editorial-cie');
  assert.strictEqual(n('  Grüße aus Bern  '), 'grusse-aus-bern');
  assert.strictEqual(n('Straße'), 'strasse');
  assert.strictEqual(n('cœur'), 'coeur');
  assert.strictEqual(n('a__b--c'), 'a-b-c');
  assert.strictEqual(n('2026'), '', 'un chemin numérique serait pris pour un identifiant');
  assert.strictEqual(n('---'), '');
  assert.strictEqual(n(null), '');
  assert.ok(/^[a-z0-9-]+$/.test(n('Ça va très bien, merci (2026) !')));
});

test('cleNumero et cheminNumero : « 2026-03 », vide dès qu’un morceau manque', () => {
  assert.strictEqual(adresses.cleNumero('2026', '3'), '2026-03');
  assert.strictEqual(adresses.cleNumero('2026', '03'), '2026-03');
  assert.strictEqual(adresses.cleNumero('2026-09-01', 'N° 12'), '2026-12');
  assert.strictEqual(adresses.cleNumero('', '03'), '');
  assert.strictEqual(adresses.cleNumero('2026', ''), '');
  assert.strictEqual(adresses.cheminNumero('2026', '3'), '2026-03');
  // Le même numéro que celui du DOI : « …/r2026-03-00 ».
  assert.strictEqual(ojs.doiCalcule('fr', '2026', '3', 0).split('/r')[1].slice(0, 7), adresses.cleNumero('2026', '3'));
});

test('cheminsArticlesSansDoi : clé du numéro + slug sans préfixe d’ordre', () => {
  const c = adresses.cheminsArticlesSansDoi('2026-03', ['10-documentation', '11-Comptes rendus']);
  assert.deepStrictEqual(c, { '10-documentation': '2026-03-documentation', '11-Comptes rendus': '2026-03-comptes-rendus' });
});

test('cheminsArticlesSansDoi : un slug numérique garde son numéro, deux slugs confondus se distinguent', () => {
  assert.deepStrictEqual(adresses.cheminsArticlesSansDoi('2026-03', ['12']), { '12': '2026-03-12' });
  const c = adresses.cheminsArticlesSansDoi('2026-03', ['10-doc', '11-doc']);
  assert.deepStrictEqual(c, { '10-doc': '2026-03-10-doc', '11-doc': '2026-03-11-doc' });
  assert.deepStrictEqual(adresses.cheminsArticlesSansDoi('', ['10-doc']), {}, 'sans clé de numéro, aucun chemin');
  for (const v of Object.values(adresses.cheminsArticlesSansDoi('2026-03', ['10-é', '11-é', '12-É']))) {
    assert.ok(/^[a-z0-9-]+$/.test(v) && !/^\d+$/.test(v), v);
  }
});

test('urlNumero et urlArticle : la base d’OJS, la langue de la revue, le chemin', () => {
  assert.strictEqual(adresses.urlNumero('fr', '2026-03'), 'https://ojs.szh.ch/index.php/revue/fr/issue/view/2026-03');
  assert.strictEqual(adresses.urlArticle('de', '2026-07-dokumentation'),
    'https://ojs.szh.ch/index.php/zeitschrift/de/article/view/2026-07-dokumentation');
  assert.strictEqual(adresses.urlNumero('it', '2026-03'), '');
  assert.strictEqual(adresses.urlArticle('fr', ''), '');
});

test('la base d’OJS n’est écrite qu’une fois : l’OAI-PMH en part', () => {
  assert.strictEqual(secretariat.BASES_OAI.revue, adresses.urlJournal('fr') + '/oai');
  assert.strictEqual(secretariat.BASES_OAI.zeitschrift, adresses.urlJournal('de') + '/oai');
  const auteursOjs = require(path.join(COCKPIT, 'lib', 'auteurs-ojs.js'));
  assert.deepStrictEqual(auteursOjs.ENDPOINTS_OAI_DEFAUT,
    [adresses.urlJournal('fr') + '/fr/oai', adresses.urlJournal('de') + '/de/oai']);
  // Aucun autre fichier de lib/ ne recopie la base.
  const gardes = fs.readdirSync(path.join(COCKPIT, 'lib')).filter((f) => f.endsWith('.js') && f !== 'ojs-adresses.js' && f !== 'i18n.js');
  for (const f of gardes) {
    const src = fs.readFileSync(path.join(COCKPIT, 'lib', f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(src.indexOf('https://ojs.szh.ch/index.php') === -1, f + ' recopie la base d’OJS');
  }
});

// ---- L'export OJS écrit ces chemins ---------------------------------------------------

function exporterOjs(racine) {
  const cfg = {
    revues: {
      fr: { genreFichier: "Texte de l'article", groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: '' },
      de: { genreFichier: 'Artikeltext', groupeAuteur: 'Autor/in', televerseur: 'redaktion', paysAuteur: '' }
    }
  };
  fs.writeFileSync(path.join(racine, 'couverture.jpg'), Buffer.from('JPEG'));
  for (const slug of fs.readdirSync(path.join(racine, 'articles'))) {
    const sortie = path.join(racine, 'out', slug);
    fs.mkdirSync(sortie, { recursive: true });
    for (const ext of ['pdf', 'html', 'docx']) { fs.writeFileSync(path.join(sortie, slug + '.' + ext), Buffer.from(slug)); }
  }
  const r = ojs.genererExportOjs(racine, { maintenant: new Date(2026, 7, 21, 9, 30, 0), config: cfg });
  return fs.readFileSync(r.chemin, 'utf8').replace(/(<embed encoding="base64">)[^<]*/g, '$1');
}

test('export OJS : le numéro reçoit sa clé, l’article sans DOI son chemin, les autres rien', () => {
  const xml = exporterOjs(numeroRevue());
  assert.ok(/<issue [^>]*url_path="2026-03"/.test(xml), 'url_path du numéro');
  const publications = xml.split('<publication ').slice(1).map((p) => p.slice(0, p.indexOf('>')));
  assert.strictEqual(publications.length, 6);
  const chemins = publications.map((p) => (p.match(/url_path="([^"]*)"/) || [])[1]);
  assert.deepStrictEqual(chemins, ['', '', '', '', '', '2026-03-documentation']);
  assert.strictEqual((xml.match(/type="doi"/g) || []).length, 5, 'les DOI ne bougent pas');
});

test('export OJS : même chemin pour la Zeitschrift, et le même que celui de la newsletter', async () => {
  const racine = numeroZeitschrift();
  const xml = exporterOjs(racine);
  assert.ok(/<issue [^>]*url_path="2026-07"/.test(xml));
  assert.ok(/<publication [^>]*url_path="2026-07-dokumentation"/.test(xml));
  const { lire } = await produire(racine);
  assert.ok(lire('5-documentation.txt').indexOf('zeitschrift/de/article/view/2026-07-dokumentation') !== -1);
  assert.ok(lire('0-intro.txt').indexOf('zeitschrift/de/issue/view/2026-07') !== -1);
});

// ---- La newsletter de la Revue --------------------------------------------------------

test('newsletter Revue : sept fichiers, dans l’ordre des rubriques, intro d’abord', async () => {
  const { noms, evenements, resultat } = await produire(numeroRevue());
  assert.deepStrictEqual(noms, NOMS);
  assert.deepStrictEqual(evenements.filter((e) => e.t === 'fichier').map((e) => e.nom), NOMS);
  assert.strictEqual(resultat.texte, '7 fichiers produits pour le numéro 2026-03.');
});

test('newsletter Revue : l’intro, français puis allemand', async () => {
  const { lire } = await produire(numeroRevue());
  assert.strictEqual(lire('0-intro.txt'), [
    '<p>Le numéro actuel de la <em>Revue suisse de pédagogie spécialisée</em> sur le thème «' + NB +
      '<strong>Adaptation du PER</strong>' + NB + '» est disponible dès aujourd’hui' + NB +
      ': <a href="https://ojs.szh.ch/index.php/revue/fr/issue/view/2026-03" target="_blank">Vol. 16, 03/2026</a><br />',
    '<br />',
    'Die aktuelle Ausgabe der <em>Revue suisse de pédagogie spécialisée</em> zum Thema ' +
      '<strong>«[À COMPLÉTER' + NB + ': titre en allemand]»</strong> steht ab heute zur Verfügung: ' +
      '<a href="https://ojs.szh.ch/index.php/revue/fr/issue/view/2026-03" target="_blank">Jg. 16, 03/2026</a><br />',
    '(Französische Artikel mit Abstracts auf Deutsch)</p>',
    ''
  ].join('\n'));
});

test('newsletter Revue : éditorial, dossier, varia, tribune, documentation', async () => {
  const { lire } = await produire(numeroRevue());
  assert.strictEqual(lire('1-editorial.txt'), [
    '<p><strong>ÉDITORIAL</strong><br />',
    '<br />',
    'Claire Rossi<br />',
    '<a href="https://doi.org/10.57161/r2026-03-00" target="_blank">Mot de la rédaction</a><br />',
    '<em>Wort der Redaktion</em></p>',
    ''
  ].join('\n'));
  assert.strictEqual(lire('2-dossier-thematique.txt'), [
    '<p><strong>DOSSIER THÉMATIQUE</strong><br />',
    '<br />',
    'Anne Dupont et Bruno Meyer<br />',
    '<a href="https://doi.org/10.57161/r2026-03-01" target="_blank">Adapter le PER. Un sous-titre</a><br />',
    '<em>Den PER anpassen. Ein Untertitel</em><br />',
    '<br />',
    'Anne Dupont, Bruno Meyer et Claire Rossi<br />',
    '<a href="https://doi.org/10.57161/r2026-03-02" target="_blank">Évaluer</a><br />',
    '<em>Beurteilen</em></p>',
    ''
  ].join('\n'));
  assert.strictEqual(lire('3-varia.txt'), [
    '<p><strong>VARIA</strong><br />',
    '<br />',
    'Bruno Meyer<br />',
    '<a href="https://doi.org/10.57161/r2026-03-03" target="_blank">Un texte libre</a><br />',
    '<em>Ein freier Text</em></p>',
    ''
  ].join('\n'));
  assert.strictEqual(lire('4-tribune-libre.txt'), [
    '<p><strong>TRIBUNE LIBRE</strong><br />',
    '<br />',
    'Claire Rossi et Anne Dupont<br />',
    '<a href="https://doi.org/10.57161/r2026-03-04" target="_blank">Le cordon</a><br />',
    '<em>Das Band</em></p>',
    ''
  ].join('\n'));
  // Sans DOI : le lien est la page de l'article sur OJS, à l'adresse que l'export fixe.
  assert.strictEqual(lire('5-documentation.txt'), [
    '<p><strong>DOCUMENTATION</strong><br />',
    '<br />',
    'La rédaction<br />',
    '<a href="https://ojs.szh.ch/index.php/revue/fr/article/view/2026-03-documentation" target="_blank">Actualité et ressources</a><br />',
    '<em>Aktuelles und Ressourcen</em></p>',
    ''
  ].join('\n'));
});

// ---- La newsletter de la Zeitschrift --------------------------------------------------

test('newsletter Zeitschrift : l’intro, allemand puis français', async () => {
  const { lire } = await produire(numeroZeitschrift());
  assert.strictEqual(lire('0-intro.txt'), [
    '<p>Die aktuelle Ausgabe der <em>Schweizerischen Zeitschrift für Heilpädagogik</em> zum Thema ' +
      '<strong>«Politische Teilhabe»</strong> steht ab heute zur Verfügung: ' +
      '<a href="https://ojs.szh.ch/index.php/zeitschrift/de/issue/view/2026-07" target="_blank">Jg. 32, 07/2026</a><br />',
    '<br />',
    'Le numéro actuel de la <em>Schweizerische Zeitschrift für Heilpädagogik</em> sur le thème «' + NB +
      '<strong>[À COMPLÉTER' + NB + ': titre en français]</strong>' + NB + '» est disponible dès aujourd’hui' + NB +
      ': <a href="https://ojs.szh.ch/index.php/zeitschrift/de/issue/view/2026-07" target="_blank">Vol. 32, 07/2026</a><br />',
    '(articles en allemand avec résumés en français)</p>',
    ''
  ].join('\n'));
});

test('newsletter Zeitschrift : les rubriques, « ZUM SCHWERPUNKT » pour le dossier, « und » des signatures', async () => {
  const { lire, noms } = await produire(numeroZeitschrift());
  assert.deepStrictEqual(noms, NOMS);
  assert.strictEqual(lire('1-editorial.txt'), [
    '<p><strong>EDITORIAL</strong><br />',
    '<br />',
    'Claire Rossi<br />',
    '<a href="https://doi.org/10.57161/z2026-07-00" target="_blank">Demokratie braucht alle</a><br />',
    '<em>Mot de la rédaction</em></p>',
    ''
  ].join('\n'));
  assert.strictEqual(lire('2-dossier-thematique.txt'), [
    '<p><strong>ZUM SCHWERPUNKT</strong><br />',
    '<br />',
    'Anne Dupont<br />',
    '<a href="https://doi.org/10.57161/z2026-07-01" target="_blank">Politische Teilhabe. Selbstvertretung</a><br />',
    '<em>Participation politique. Autoreprésentation</em><br />',
    '<br />',
    'Anne Dupont, Bruno Meyer und Claire Rossi<br />',
    '<a href="https://doi.org/10.57161/z2026-07-02" target="_blank">Abstimmen</a><br />',
    '<em>Voter</em></p>',
    ''
  ].join('\n'));
  assert.strictEqual(lire('3-varia.txt'), [
    '<p><strong>VARIA</strong><br />',
    '<br />',
    'Bruno Meyer<br />',
    '<a href="https://doi.org/10.57161/z2026-07-03" target="_blank">Ein freier Text</a><br />',
    '<em>Un texte libre</em></p>',
    ''
  ].join('\n'));
  assert.strictEqual(lire('4-tribune-libre.txt'), [
    '<p><strong>TRIBUNE LIBRE</strong><br />',
    '<br />',
    'Claire Rossi<br />',
    '<a href="https://doi.org/10.57161/z2026-07-04" target="_blank">Das Band</a><br />',
    '<em>Le cordon</em></p>',
    ''
  ].join('\n'));
  assert.strictEqual(lire('5-documentation.txt'), [
    '<p><strong>DOKUMENTATION</strong><br />',
    '<br />',
    'Die Redaktion<br />',
    '<a href="https://ojs.szh.ch/index.php/zeitschrift/de/article/view/2026-07-dokumentation" target="_blank">Aktuelles und Ressourcen</a><br />',
    '<em>Actualité et ressources</em></p>',
    ''
  ].join('\n'));
});

// ---- Les replis -----------------------------------------------------------------------

test('newsletter : sans année ni numéro, ni lien de numéro ni lien d’article, et on le dit', async () => {
  const racine = ecrireNumero('essai', ['revue: "revue"', 'title: "Un thème"', 'lang: fr', 'date: ""',
    'articles-sans-doi: ["10-documentation"]'], [
    { slug: '10-documentation', fiche: fiche('documentation', 'fr', 'Actualité', 'Aktuell', [['', 'La rédaction']]) }
  ]);
  const { lire, evenements } = await produire(racine);
  const intro = lire('0-intro.txt');
  assert.ok(intro.indexOf('<a ') === -1, intro);
  assert.ok(intro.indexOf('Un thème') !== -1);
  const doc = lire('5-documentation.txt');
  assert.ok(doc.indexOf('<a ') === -1, doc);
  assert.ok(doc.indexOf('Actualité</') !== -1 || doc.indexOf('Actualité<br') !== -1, doc);
  const avert = evenements.filter((e) => e.t === 'avert').map((e) => e.texte);
  assert.ok(avert.some((t) => t.indexOf('10-documentation') !== -1 && t.indexOf('sans lien') !== -1), avert.join(' | '));
  assert.ok(avert.some((t) => t.indexOf('Introduction') !== -1), avert.join(' | '));
});

test('newsletter : un numéro complet ne signale ni lien manquant ni DOI absent, mais le titre à compléter', async () => {
  const { evenements } = await produire(numeroRevue());
  const avert = evenements.filter((e) => e.t === 'avert').map((e) => e.texte);
  assert.ok(!avert.some((t) => t.indexOf('sans lien') !== -1), avert.join(' | '));
  assert.ok(avert.some((t) => t.indexOf('Introduction') !== -1 && t.toLowerCase().indexOf('allemand') !== -1), avert.join(' | '));
});

test('les gabarits livrés : le gabarit d’introduction est livré avec les autres', () => {
  for (const nom of secretariat.NOMS_GABARITS_DEFAUT) {
    assert.ok(fs.existsSync(path.join(secretariat.dossierGabaritsSource(), nom)), nom);
  }
  assert.ok(secretariat.NOMS_GABARITS_DEFAUT.indexOf('newsletter-intro.twig') !== -1);
});
