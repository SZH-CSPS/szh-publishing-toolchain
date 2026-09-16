// Les quatre exports du secrétariat (lib/secretariat.js) : newsletter (local), edudoc et
// caractères (OAI-PMH), métadonnées (comparaison locale/OJS).
//
//   node --test "test/js/*.test.js"
//
// AUCUN réseau ici : les commandes qui en ont besoin (numeros-ojs, caracteres) prennent leur
// fonction de récupération en paramètre (opts.recuperer), comme moissonner()/rafraichir() de
// lib/auteurs-ojs.js — les tests lui donnent des fixtures XML/HTML, jamais ojs.szh.ch.
// SZH_RESEAU_INTERDIT est de toute façon posé plus bas pour prouver que newsletter et
// metadonnees s'en passent complètement, et que les deux autres échouent proprement sans
// `recuperer` injecté.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE_COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const secretariat = require(path.join(RACINE_COCKPIT, 'lib', 'secretariat.js'));

// config.json toujours détourné : aucun test ne doit lire ni écrire C:\ProgramData (même
// motif que test/js/export-ojs.test.js, dont lib/secretariat.js réutilise configOjs()).
const CONFIG_ESSAI = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-secr-cfg-')), 'config.json');
process.env.SZH_CONFIG_OJS = CONFIG_ESSAI;

function dossierTemp(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }

// ---- Fixtures : un numéro local jetable, avec accents, plusieurs auteurs et un titre à
// épreuve du CSV (point-virgule + guillemet) -----------------------------------------

function ecrireNumeroEssai() {
  const racine = dossierTemp('szh-secr-numero-');
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), [
    'revue: "Revue suisse de pedagogie specialisee"',
    'title: "Édition d\'essai"',
    'lang: fr',
    'volume: "16"',
    'numero: "03"',
    'date: "2026-09-01"',
    'ordre-articles: ["00-editorial", "08-varia-un", "09-varia-deux", "10-doc"]',
    'articles-sans-doi: ["10-doc"]',
    ''
  ].join('\n'));

  const article = (slug, lignes) => {
    const dossier = path.join(racine, 'articles', slug);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte.\n');
    fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'), lignes.concat(['']).join('\n'));
  };

  article('00-editorial', [
    'type: editorial', 'lang: fr',
    'title:', '  fr: "Mot de la rédaction"', '  de: "Wort der Redaktion"',
    'author:', '- prenom: "Robin"', '  nom: "Morand"'
  ]);
  article('08-varia-un', [
    'type: varia', 'lang: fr',
    'title:', '  fr: "Compensation des désavantages; regards croisés"', '  de: "Nachteilsausgleich"',
    'subtitle:', '  fr: "Un titre avec un \\"guillemet\\" et un point-virgule ; voilà"',
    'author:',
    '- prenom: "Amélie"', '  nom: "Dentz"', '  affiliation: "HEP Vaud"', '  email: "amelie.dentz@example.ch"',
    '- prenom: "Bianca"', '  nom: "Frank Baud"', '  affiliation: "Université de Fribourg"',
    '- prenom: "Nicolas"', '  nom: "Ruffieux"',
    '- prenom: "Chantal"', '  nom: "Martin Sölch"', '  fonction: "Professeure"'
  ]);
  article('09-varia-deux', [
    'type: varia', 'lang: fr',
    'title:', '  fr: "Adapter le curriculum"',
    'author:', '- prenom: "Bruno"', '  nom: "Meyer"'
  ]);
  article('10-doc', [
    'type: documentation', 'lang: fr',
    'title:', '  fr: "Comptes rendus"',
    'author:', '- prenom: ""', '  nom: "La rédaction"'
  ]);
  return racine;
}

// ---- Fixtures OAI-PMH (oai_dc) : un enregistrement complet, tous les champs du mandat --

function enveloppeOai(corps, token) {
  const queue = token === undefined ? '' :
    '\n\t\t<resumptionToken expirationDate="2026-09-14T12:00:00Z" completeListSize="2" cursor="0">' + token + '</resumptionToken>';
  return '<?xml version="1.0" encoding="UTF-8"?>\n<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">\n' +
    '\t<responseDate>2026-09-14T12:00:00Z</responseDate>\n' +
    '\t<ListRecords>\n' + corps + queue + '\n\t</ListRecords>\n</OAI-PMH>\n';
}

// `opts` : { id, setSpec, titreFr, titreDe, sujetsFr, sujetsDe, resumeFr, resumeDe,
//   creators, doi, urlPage, volume, numero, annee, titreNumero, pages, issn, pdf, html, docx }
function recordOaiDc(opts) {
  const o = opts || {};
  const dc = [];
  if (o.titreFr) { dc.push('<dc:title xml:lang="fr">' + o.titreFr + '</dc:title>'); }
  if (o.titreDe) { dc.push('<dc:title xml:lang="de">' + o.titreDe + '</dc:title>'); }
  for (const s of (o.sujetsFr || [])) { dc.push('<dc:subject xml:lang="fr">' + s + '</dc:subject>'); }
  for (const s of (o.sujetsDe || [])) { dc.push('<dc:subject xml:lang="de">' + s + '</dc:subject>'); }
  if (o.resumeFr) { dc.push('<dc:description xml:lang="fr">' + o.resumeFr + '</dc:description>'); }
  if (o.resumeDe) { dc.push('<dc:description xml:lang="de">' + o.resumeDe + '</dc:description>'); }
  for (const c of (o.creators || [])) { dc.push('<dc:creator>' + c + '</dc:creator>'); }
  if (o.urlPage) { dc.push('<dc:identifier>' + o.urlPage + '</dc:identifier>'); }
  if (o.doi) { dc.push('<dc:identifier>' + o.doi + '</dc:identifier>'); }
  const forme = 'Revue suisse de pédagogie spécialisée; Vol. ' + (o.volume || '16') + ' No ' + (o.numero || '03') +
    (o.annee ? ' (' + o.annee + ')' : '') + ': ' + (o.titreNumero || '') + (o.pages ? '; ' + o.pages : '');
  dc.push('<dc:source>' + forme + '</dc:source>');
  dc.push('<dc:source>' + (o.issn || '2813-4915') + '</dc:source>');
  if (o.pdf) { dc.push('<dc:relation>' + o.pdf + '</dc:relation>'); dc.push('<dc:format>application/pdf</dc:format>'); }
  if (o.html) { dc.push('<dc:relation>' + o.html + '</dc:relation>'); dc.push('<dc:format>text/html</dc:format>'); }
  if (o.docx) {
    dc.push('<dc:relation>' + o.docx + '</dc:relation>');
    dc.push('<dc:format>application/vnd.openxmlformats-officedocument.wordprocessingml.document</dc:format>');
  }
  return '\t\t<record>\n\t\t\t<header>\n\t\t\t\t<identifier>oai:ojs.szh.ch:article/' + (o.id || '1') + '</identifier>\n' +
    '\t\t\t\t<datestamp>2026-09-01T00:00:00Z</datestamp>\n\t\t\t\t<setSpec>' + (o.setSpec || 'revue:VA') + '</setSpec>\n\t\t\t</header>\n' +
    '\t\t\t<metadata><oai_dc:dc xmlns:dc="http://purl.org/dc/elements/1.1/">\n' + dc.join('\n') + '\n</oai_dc:dc></metadata>\n\t\t</record>';
}

// ---- Aides pures ----------------------------------------------------------------------

test('formerSignature : "et" en français, "und" en allemand, un seul nom sans jonction', () => {
  const auteurs = [{ prenom: 'Amélie', nom: 'Dentz' }, { prenom: 'Bianca', nom: 'Frank Baud' }, { prenom: 'Nicolas', nom: 'Ruffieux' }];
  assert.strictEqual(secretariat.formerSignature(auteurs, 'fr'), 'Amélie Dentz, Bianca Frank Baud et Nicolas Ruffieux');
  assert.strictEqual(secretariat.formerSignature(auteurs, 'de'), 'Amélie Dentz, Bianca Frank Baud und Nicolas Ruffieux');
  assert.strictEqual(secretariat.formerSignature([{ prenom: 'Bruno', nom: 'Meyer' }], 'fr'), 'Bruno Meyer');
  assert.strictEqual(secretariat.formerSignature([], 'fr'), '');
});

test('combinerTitre : titre seul, ou titre + sous-titre séparés par ". "', () => {
  const titres = { fr: 'Adapter le curriculum' };
  assert.strictEqual(secretariat.combinerTitre(titres, {}, 'fr'), 'Adapter le curriculum');
  assert.strictEqual(secretariat.combinerTitre(titres, { fr: 'Un sous-titre' }, 'fr'), 'Adapter le curriculum. Un sous-titre');
  assert.strictEqual(secretariat.combinerTitre(titres, {}, 'de'), '');
});

test('deuxChiffres : complète à deux chiffres, laisse le reste tel quel', () => {
  assert.strictEqual(secretariat.deuxChiffres('3'), '03');
  assert.strictEqual(secretariat.deuxChiffres('03'), '03');
  assert.strictEqual(secretariat.deuxChiffres(''), '');
});

test('versCsvFinal : BOM UTF-8 en tête, fins de ligne CRLF', () => {
  const sortie = secretariat.versCsvFinal('"a";"b"\n"c";"d"\n');
  assert.strictEqual(sortie.charAt(0), '\uFEFF');
  assert.strictEqual(sortie, '\uFEFF"a";"b"\r\n"c";"d"\r\n');
});

test('analyserSourceOjs : formes allemande et française, pages parfois absentes', () => {
  const de = secretariat.analyserSourceOjs('Revue …; Bd. 16 Nr. 03 (2023): Titre ; 27-32');
  assert.deepStrictEqual(de, { volume: '16', numero: '03', annee: '2023', titre: 'Titre', pages: '27-32' });
  const fr = secretariat.analyserSourceOjs('Revue …; Vol. 16 No 03 (2023): Titre; 27-32');
  assert.deepStrictEqual(fr, { volume: '16', numero: '03', annee: '2023', titre: 'Titre', pages: '27-32' });
  // Numéro récent : ni année ni pages.
  const recent = secretariat.analyserSourceOjs('Revue …; Vol. 16 No 03: Un titre');
  assert.strictEqual(recent.annee, '');
  assert.strictEqual(recent.pages, '');
  assert.strictEqual(recent.titre, 'Un titre');
  assert.strictEqual(secretariat.analyserSourceOjs('2813-4915'), null);
});

test('compterCaracteresHtml : retire script/style, décode les entités, compte le texte visible', () => {
  const html = '<html><head><style>.x{color:red}</style></head><body>' +
    '<script>alert(1)</script><p>Bonjour&nbsp;&amp; au revoir</p></body></html>';
  // "Bonjour & au revoir" -> 20 caractères.
  assert.strictEqual(secretariat.compterCaracteresHtml(html), 'Bonjour & au revoir'.length);
});

// ---- decoderRecordOai : un enregistrement complet, tous les champs du mandat ----------

test('decoderRecordOai : décode titres bilingues, mots-clés, résumé, source, galleys appariées', () => {
  const xml = recordOaiDc({
    id: '1758', setSpec: 'revue:VA',
    titreFr: 'Compensation des désavantages et universités', titreDe: 'Nachteilsausgleich',
    sujetsFr: ['compensation', 'université'], sujetsDe: ['Nachteilsausgleich'],
    resumeFr: 'Un résumé.', resumeDe: 'Eine Zusammenfassung.',
    creators: ['Dentz, Amélie', 'Frank Baud, Bianca'],
    doi: '10.57161/r2026-03-08', urlPage: 'https://ojs.szh.ch/index.php/revue/article/view/1758',
    volume: '16', numero: '03', annee: '2026', titreNumero: 'Adaptations du PER', pages: '',
    pdf: 'https://ojs.szh.ch/index.php/revue/article/view/1758/2817',
    html: 'https://ojs.szh.ch/index.php/revue/article/view/1758/2816',
    docx: 'https://ojs.szh.ch/index.php/revue/article/view/1758/2815'
  });
  const blocs = secretariat.extraireBlocsRecord(enveloppeOai(xml));
  assert.strictEqual(blocs.length, 1);
  const art = secretariat.decoderRecordOai(blocs[0], 'revue');
  assert.strictEqual(art.supprime, false);
  assert.strictEqual(art.rubriqueCle, 'VA');
  assert.strictEqual(art.revue, 'revue');
  assert.strictEqual(art.locale, 'fr');
  assert.strictEqual(art.doi, '10.57161/r2026-03-08');
  assert.strictEqual(art.urlDoi, 'https://doi.org/10.57161/r2026-03-08');
  assert.strictEqual(art.urlPage, 'https://ojs.szh.ch/index.php/revue/article/view/1758');
  assert.deepStrictEqual(art.titres, { fr: 'Compensation des désavantages et universités', de: 'Nachteilsausgleich' });
  assert.deepStrictEqual(art.sujets, { fr: ['compensation', 'université'], de: ['Nachteilsausgleich'] });
  assert.deepStrictEqual(art.descriptions, { fr: 'Un résumé.', de: 'Eine Zusammenfassung.' });
  assert.deepStrictEqual(art.auteurs, [{ prenom: 'Amélie', nom: 'Dentz' }, { prenom: 'Bianca', nom: 'Frank Baud' }]);
  assert.deepStrictEqual(art.auteursBruts, ['Dentz, Amélie', 'Frank Baud, Bianca']);
  assert.strictEqual(art.cleNumero, '2026-03');
  assert.strictEqual(art.annee, '2026');
  assert.strictEqual(art.numero, '03');
  assert.strictEqual(art.volume, '16');
  assert.strictEqual(art.rang, 8);
  assert.strictEqual(art.titreNumero, 'Adaptations du PER');
  assert.strictEqual(art.issn, '2813-4915');
  assert.deepStrictEqual(art.galleys, {
    pdf: 'https://ojs.szh.ch/index.php/revue/article/view/1758/2817',
    html: 'https://ojs.szh.ch/index.php/revue/article/view/1758/2816',
    docx: 'https://ojs.szh.ch/index.php/revue/article/view/1758/2815'
  });
});

test('decoderRecordOai : dc:source manquant de pages ni d’année (numéro récent), rang -1 côté « sans DOI »', () => {
  const xml = recordOaiDc({
    id: '1685', setSpec: 'zeitschrift:DC', titreFr: 'News & Ressourcen',
    creators: ['Wetter, Thomas'], volume: '32', numero: '03', annee: '', titreNumero: 'Psychische Gesundheit', pages: ''
  });
  const art = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(xml))[0], 'zeitschrift');
  assert.strictEqual(art.doi, '');
  assert.strictEqual(art.rang, null);
  // Sans DOI, la clé se retrouve par dc:source (l'année manque ici : cleNumero reste null).
  assert.strictEqual(art.cleNumero, null);
});

test('decoderRecordOai : un enregistrement supprimé (header status="deleted") est signalé, pas décodé', () => {
  const xml = '\t\t<record>\n\t\t\t<header status="deleted">\n\t\t\t\t<identifier>oai:ojs.szh.ch:article/1</identifier>\n' +
    '\t\t\t</header>\n\t\t</record>';
  const art = secretariat.decoderRecordOai(xml, 'revue');
  assert.strictEqual(art.supprime, true);
});

test('grouperNumeros : regroupe par cle, complète volume/titre/issn depuis n’importe quel article du groupe', () => {
  const a1 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:ED', titreFr: 'Éditorial', creators: ['Morand, Robin'],
    doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026', titreNumero: '', pages: ''
  })))[0], 'revue');
  const a2 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Varia', creators: ['Dupont, Anne'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026', titreNumero: 'Titre du numéro', pages: ''
  })))[0], 'revue');
  const table = secretariat.grouperNumeros([a1, a2]);
  assert.deepStrictEqual(Object.keys(table), ['2026-03']);
  const n = table['2026-03'];
  assert.strictEqual(n.titre, 'Titre du numéro');
  assert.strictEqual(n.articles.length, 2);
  assert.strictEqual(n.articles[0].rang, 0);
  assert.strictEqual(n.articles[1].rang, 1);
});

// ---- collecterNumeroLocal : DOI calculé, rang, sans-DOI, bilingue ---------------------

test('collecterNumeroLocal : DOI par rang, sans-DOI en fin de compteur, titre + sous-titre', () => {
  const racine = ecrireNumeroEssai();
  const { numero, articles } = secretariat.collecterNumeroLocal(racine);
  assert.strictEqual(numero.cle, '2026-03');
  assert.strictEqual(numero.locale, 'fr');
  assert.strictEqual(numero.revue, 'revue');
  const parSlug = {};
  for (const a of articles) { parSlug[a.slug] = a; }
  assert.strictEqual(parSlug['00-editorial'].doi, '10.57161/r2026-03-00');
  assert.strictEqual(parSlug['08-varia-un'].doi, '10.57161/r2026-03-01');
  assert.strictEqual(parSlug['09-varia-deux'].doi, '10.57161/r2026-03-02');
  // Sans-DOI (articles-sans-doi) : rang -1, pas de DOI, malgré sa place dans l'ordre.
  assert.strictEqual(parSlug['10-doc'].rang, -1);
  assert.strictEqual(parSlug['10-doc'].doi, '');
  // Titre + sous-titre, séparés par ". " ; l'autre langue n'a pas de sous-titre.
  assert.strictEqual(parSlug['08-varia-un'].titre,
    'Compensation des désavantages; regards croisés. Un titre avec un "guillemet" et un point-virgule ; voilà');
  assert.strictEqual(parSlug['08-varia-un'].titreAutreLangue, 'Nachteilsausgleich');
  assert.strictEqual(parSlug['08-varia-un'].auteurs.length, 4);
  assert.strictEqual(parSlug['08-varia-un'].signature,
    'Amélie Dentz, Bianca Frank Baud, Nicolas Ruffieux et Chantal Martin Sölch');
});

// Un numéro pas encore paru : `date: ""`, comme TOUS les numéros au moment où la newsletter
// se prépare (avant parution). Le dossier est nommé « 2027-03 » — c'est le nom du dossier,
// et lui seul, qui doit donner l'année de repli (voir lib/yaml.js, titreNumero, et
// lib/metadonnees-hote.js, anneeNumero : même règle, trois endroits).
function ecrireNumeroSansDate() {
  const parent = dossierTemp('szh-secr-sansdate-');
  const racine = path.join(parent, '2027-03');
  fs.mkdirSync(racine, { recursive: true });
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), [
    'revue: "Revue suisse de pedagogie specialisee"',
    'title: "Numéro à paraître"',
    'lang: fr',
    'volume: "17"',
    'numero: "03"',
    'date: ""',
    ''
  ].join('\n'));
  const dossierArticle = path.join(racine, 'articles', 'compensation-des-desavantages-dans-la');
  fs.mkdirSync(dossierArticle, { recursive: true });
  fs.writeFileSync(path.join(dossierArticle, 'compensation-des-desavantages-dans-la.md'), 'Texte.\n');
  fs.writeFileSync(path.join(dossierArticle, 'compensation-des-desavantages-dans-la.meta.yaml'), [
    'type: article', 'lang: fr',
    'title:', '  fr: "Compensation des désavantages dans la formation"',
    'author:', '- prenom: "Anne"', '  nom: "Dupont"',
    ''
  ].join('\n'));
  return racine;
}

test('collecterNumeroLocal : date de publication vide (numéro pas encore paru) -> année reprise du nom du dossier', () => {
  const racine = ecrireNumeroSansDate();
  const { numero, articles } = secretariat.collecterNumeroLocal(racine);
  assert.strictEqual(numero.annee, '2027', 'annee doit venir du nom du dossier, pas de date: vide');
  assert.strictEqual(numero.cle, '2027-03');
  assert.strictEqual(articles[0].doi, '10.57161/r2027-03-00');
  assert.strictEqual(articles[0].urlDoi, 'https://doi.org/10.57161/r2027-03-00');
});

test('commandeNewsletter : un numéro sans date: produit quand même un DOI, donc un lien', async () => {
  const avant = process.env.SZH_RESEAU_INTERDIT;
  process.env.SZH_RESEAU_INTERDIT = '1';
  try {
    const racine = ecrireNumeroSansDate();
    const dossierSortie = dossierTemp('szh-secr-sansdate-sortie-');
    const evenements = [];
    const resultat = await secretariat.commandeNewsletter({
      racineNumero: racine, dossierSortie: dossierSortie,
      emettre: (e) => evenements.push(e)
    });
    assert.strictEqual(resultat.ok, true);
    // Le libellé (« fin ») porte l'année reprise du nom du dossier, jamais « /03 » tout seul.
    assert.ok(resultat.texte.indexOf('2027/03') !== -1, resultat.texte);
    assert.ok(!evenements.some((e) => e.t === 'avert' && e.texte.indexOf('pas de DOI') !== -1),
      'aucun avert "pas de DOI" attendu : le DOI doit se calculer malgré date: vide');
    const dossierThematique = fs.readFileSync(path.join(dossierSortie, 'dossier-thematique.txt'), 'utf8');
    assert.ok(dossierThematique.indexOf('<a href="https://doi.org/10.57161/r2027-03-00">') !== -1, dossierThematique);
  } finally {
    if (avant === undefined) { delete process.env.SZH_RESEAU_INTERDIT; } else { process.env.SZH_RESEAU_INTERDIT = avant; }
  }
});

// ---- commandeNewsletter : bout en bout, hors ligne -------------------------------------

test('commandeNewsletter : produit les .txt de rubrique et auteurs.csv, sans réseau', async () => {
  const avant = process.env.SZH_RESEAU_INTERDIT;
  process.env.SZH_RESEAU_INTERDIT = '1';
  try {
    const racine = ecrireNumeroEssai();
    const dossierSortie = dossierTemp('szh-secr-sortie-');
    const evenements = [];
    const resultat = await secretariat.commandeNewsletter({
      racineNumero: racine, dossierSortie: dossierSortie,
      emettre: (e) => evenements.push(e)
    });
    assert.strictEqual(resultat.ok, true);

    const varia = fs.readFileSync(path.join(dossierSortie, 'varia.txt'), 'utf8');
    assert.strictEqual(varia, [
      '<p><b>VARIA</b><br>',
      '<br>',
      'Amélie Dentz, Bianca Frank Baud, Nicolas Ruffieux et Chantal Martin Sölch<br>',
      '<a href="https://doi.org/10.57161/r2026-03-01">Compensation des désavantages; regards croisés. ' +
        'Un titre avec un "guillemet" et un point-virgule ; voilà</a><br>',
      '<i>Nachteilsausgleich</i><br>',
      '<br>',
      'Bruno Meyer<br>',
      '<a href="https://doi.org/10.57161/r2026-03-02">Adapter le curriculum</a></p>\n'
    ].join('\n'));

    const editorial = fs.readFileSync(path.join(dossierSortie, 'editorial.txt'), 'utf8');
    assert.ok(editorial.startsWith('<p><b>ÉDITORIAL</b><br>'), editorial);

    const documentation = fs.readFileSync(path.join(dossierSortie, 'documentation.txt'), 'utf8');
    // Sans DOI : le titre sort SANS lien.
    assert.ok(documentation.indexOf('<a href') === -1, documentation);
    assert.ok(documentation.indexOf('Comptes rendus') !== -1, documentation);

    // Aucune rubrique « Dossier thématique »/« Tribune libre » dans la fixture : pas de fichier.
    assert.ok(!fs.existsSync(path.join(dossierSortie, 'dossier-thematique.txt')));
    assert.ok(!fs.existsSync(path.join(dossierSortie, 'tribune-libre.txt')));

    const auteursCsv = fs.readFileSync(path.join(dossierSortie, 'auteurs.csv'));
    assert.strictEqual(auteursCsv.toString('utf8').charAt(0), '\uFEFF');
    assert.ok(auteursCsv.toString('utf8').indexOf('\r\n') !== -1, 'fins de ligne CRLF attendues');
    const lignesAuteurs = auteursCsv.toString('utf8').replace(/^\uFEFF/, '').split('\r\n').filter((l) => l !== '');
    assert.strictEqual(lignesAuteurs.length, 8); // en-tête + 7 auteur·e·s (1+4+1+1, dont "" prénom)
    // Le titre à double piège (point-virgule + guillemet) ressort bien entre guillemets doublés,
    // sur les quatre lignes des auteur·e·s de l'article concerné.
    assert.ok(lignesAuteurs.some((l) => l.indexOf('""guillemet""') !== -1), lignesAuteurs.join('\n'));

    assert.ok(evenements.some((e) => e.t === 'avert' && e.texte.indexOf('10-doc') !== -1));
  } finally {
    if (avant === undefined) { delete process.env.SZH_RESEAU_INTERDIT; } else { process.env.SZH_RESEAU_INTERDIT = avant; }
  }
});

// ---- Sans --gabarits : lecture directe d'export-templates/, rien écrit hors de la sortie --
//
// Il n'existe plus de dossier « installé » sur le poste : un gabarit se modifie dans le
// dépôt, part dans le VSIX, et se lit toujours depuis export-templates/ de l'extension —
// une copie locale figerait une version périmée qu'aucune mise à jour ne rattraperait.

test('commandeNewsletter : sans --gabarits, lit export-templates/ et n’écrit rien hors de sa sortie', async () => {
  const avant = process.env.SZH_RESEAU_INTERDIT;
  process.env.SZH_RESEAU_INTERDIT = '1';
  const source = secretariat.dossierGabaritsSource();
  const avantListe = fs.readdirSync(source).sort();
  const avantMtimes = avantListe.map((n) => fs.statSync(path.join(source, n)).mtimeMs);
  try {
    const racine = ecrireNumeroEssai();
    const dossierSortie = dossierTemp('szh-secr-defaut-sortie-');
    // Aucun dossierGabarits dans les options : le défaut de commandeNewsletter doit suffire.
    const resultat = await secretariat.commandeNewsletter({ racineNumero: racine, dossierSortie: dossierSortie });
    assert.strictEqual(resultat.ok, true);
    // Le rendu a bien eu lieu, avec les gabarits livrés — sans qu'aucun --gabarits ne soit passé.
    assert.ok(fs.existsSync(path.join(dossierSortie, 'varia.txt')));
    assert.ok(fs.existsSync(path.join(dossierSortie, 'auteurs.csv')));
    // Les neuf gabarits attendus sont bien tous là où ils sont lus, à la source.
    for (const nom of secretariat.NOMS_GABARITS_DEFAUT) {
      assert.ok(fs.existsSync(path.join(source, nom)), nom + ' absent de export-templates/');
    }
    // export-templates/ n'a pas bougé : ni fichier ajouté, ni fichier touché — la lecture
    // est seule en jeu, rien n'y est jamais écrit.
    assert.deepStrictEqual(fs.readdirSync(source).sort(), avantListe);
    assert.deepStrictEqual(avantListe.map((n) => fs.statSync(path.join(source, n)).mtimeMs), avantMtimes);
  } finally {
    if (avant === undefined) { delete process.env.SZH_RESEAU_INTERDIT; } else { process.env.SZH_RESEAU_INTERDIT = avant; }
  }
});

// ---- commandeNumerosOjs : moisson paginée, groupement, cache, fusion par revue ---------

test('commandeNumerosOjs : suit le resumptionToken, groupe en numéros, écrit le cache, émet du plus récent au plus ancien', async () => {
  const base = secretariat.BASES_OAI.revue;
  const pages = {};
  pages[base + '?verb=ListRecords&metadataPrefix=oai_dc'] = enveloppeOai(
    recordOaiDc({ id: '1', setSpec: 'revue:ED', titreFr: 'Éditorial 2026', creators: ['Morand, Robin'],
      doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro 2026' }),
    'jeton-1');
  pages[base + '?verb=ListRecords&resumptionToken=jeton-1'] = enveloppeOai(
    recordOaiDc({ id: '2', setSpec: 'revue:ED', titreFr: 'Éditorial 2025', creators: ['Morand, Robin'],
      doi: '10.57161/r2025-04-00', volume: '15', numero: '04', annee: '2025', titreNumero: 'Numéro 2025' }));

  const cheminCache = path.join(dossierTemp('szh-secr-cache-'), 'cache.json');
  const evenements = [];
  const resultat = await secretariat.commandeNumerosOjs({
    revue: 'revue', cheminCache: cheminCache, emettre: (e) => evenements.push(e),
    recuperer: async (url) => { if (!(url in pages)) { throw new Error('URL inattendue : ' + url); } return pages[url]; }
  });
  assert.strictEqual(resultat.ok, true);
  const numeros = evenements.filter((e) => e.t === 'numero');
  assert.deepStrictEqual(numeros.map((n) => n.cle), ['2026-03', '2025-04']); // du plus récent au plus ancien

  const cache = secretariat.lireCacheNumeros(cheminCache);
  assert.deepStrictEqual(Object.keys(cache.numeros).sort(), ['2025-04', '2026-03']);
  assert.strictEqual(cache.numeros['2026-03'][0].revue, 'revue');

  // Un second appel pour l'AUTRE revue ne doit pas effacer ce qui précède.
  const baseZ = secretariat.BASES_OAI.zeitschrift;
  const recuperer2 = async (url) => {
    if (url === baseZ + '?verb=ListRecords&metadataPrefix=oai_dc') {
      return enveloppeOai(recordOaiDc({ id: '3', setSpec: 'zeitschrift:ED', titreFr: 'Editorial DE', creators: ['Muster, Hans'],
        doi: '10.57161/z2026-03-00', volume: '32', numero: '03', annee: '2026', titreNumero: 'Ausgabe 2026' }));
    }
    throw new Error('URL inattendue : ' + url);
  };
  await secretariat.commandeNumerosOjs({ revue: 'zeitschrift', cheminCache: cheminCache, recuperer: recuperer2 });
  const cacheApres = secretariat.lireCacheNumeros(cheminCache);
  // "2026-03" porte maintenant DEUX numéros (revue ET zeitschrift), l'ancien "2025-04" reste.
  assert.strictEqual(cacheApres.numeros['2026-03'].length, 2);
  assert.ok(cacheApres.numeros['2026-03'].some((n) => n.revue === 'revue'));
  assert.ok(cacheApres.numeros['2026-03'].some((n) => n.revue === 'zeitschrift'));
  assert.deepStrictEqual(Object.keys(cacheApres.numeros).sort(), ['2025-04', '2026-03']);
});

test('commandeNumerosOjs : revue inconnue refusée, --cache requis', async () => {
  await assert.rejects(() => secretariat.commandeNumerosOjs({ revue: 'autre', cheminCache: 'x.json' }), /revue/);
  await assert.rejects(() => secretariat.commandeNumerosOjs({ revue: 'revue' }), /--cache/);
});

// ---- --depuis-annee : from=AAAA-01-01 sur la première page seulement, numéros trop anciens
// écartés (from filtre la date de MODIFICATION, pas de parution — voir le commentaire de
// commandeNumerosOjs pour le cas réel r2025-04) -----------------------------------------

test('commandeNumerosOjs : --depuis-annee pose &from=AAAA-01-01 sur la première page, jamais sur la page suivante (resumptionToken)', async () => {
  const base = secretariat.BASES_OAI.revue;
  const pages = {};
  pages[base + '?verb=ListRecords&metadataPrefix=oai_dc&from=2026-01-01'] = enveloppeOai(
    recordOaiDc({ id: '1', setSpec: 'revue:ED', titreFr: 'Éditorial', creators: ['Morand, Robin'],
      doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro' }),
    'jeton-1');
  // Pas de `from` ici : une page de resumptionToken ne porte QUE le jeton. Si le code le
  // répétait, cette URL ne serait pas dans `pages` et le test échouerait sur « URL inattendue ».
  pages[base + '?verb=ListRecords&resumptionToken=jeton-1'] = enveloppeOai(
    recordOaiDc({ id: '2', setSpec: 'revue:VA', titreFr: 'Varia', creators: ['Dupont, Anne'],
      doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro' }));

  const resultat = await secretariat.commandeNumerosOjs({
    revue: 'revue', cheminCache: path.join(dossierTemp('szh-secr-depuis-'), 'cache.json'), depuisAnnee: '2026',
    recuperer: async (url) => { if (!(url in pages)) { throw new Error('URL inattendue : ' + url); } return pages[url]; }
  });
  assert.strictEqual(resultat.ok, true);
  assert.strictEqual(resultat.anneePlancher, '2026');
});

test('commandeNumerosOjs : sans --depuis-annee, aucun `from` dans l’URL et le champ `anneePlancher` vaut null (comportement d’hier, inchangé)', async () => {
  let urlVue = '';
  const resultat = await secretariat.commandeNumerosOjs({
    revue: 'revue', cheminCache: path.join(dossierTemp('szh-secr-sans-depuis-'), 'cache.json'),
    recuperer: async (url) => {
      urlVue = url;
      return enveloppeOai(recordOaiDc({ id: '1', setSpec: 'revue:ED', titreFr: 'Éditorial', creators: ['Morand, Robin'],
        doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro' }));
    }
  });
  assert.strictEqual(resultat.ok, true);
  assert.strictEqual(resultat.anneePlancher, null);
  assert.strictEqual(urlVue.indexOf('from='), -1);
});

test('commandeNumerosOjs : --depuis-annee écarte un numéro d’année antérieure ramené par `from` (r2025-04, 1 article sur 9 — cas réel du 15.09.2026)', async () => {
  const xml = enveloppeOai(
    recordOaiDc({ id: '1', setSpec: 'revue:ED', titreFr: 'Éditorial 2026', creators: ['Morand, Robin'],
      doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro 2026' }) + '\n' +
    // Le seul des neuf articles de r2025-04 retouché après le 01.01.2026 : `from` le ramène
    // seul, sans les huit autres — le numéro serait donc amputé s'il n'était pas écarté.
    recordOaiDc({ id: '2', setSpec: 'revue:VA', titreFr: 'Article retouché', creators: ['Dupont, Anne'],
      doi: '10.57161/r2025-04-03', volume: '15', numero: '04', annee: '2025', titreNumero: 'Numéro 2025' })
  );
  const cheminCache = path.join(dossierTemp('szh-secr-depuis-ecarte-'), 'cache.json');
  const evenements = [];
  const resultat = await secretariat.commandeNumerosOjs({
    revue: 'revue', cheminCache: cheminCache, depuisAnnee: '2026', emettre: (e) => evenements.push(e),
    recuperer: async () => xml
  });
  assert.strictEqual(resultat.ok, true);
  const numeros = evenements.filter((e) => e.t === 'numero');
  assert.deepStrictEqual(numeros.map((n) => n.cle), ['2026-03']); // aucune ligne `numero` pour 2025-04
  assert.ok(evenements.some((e) => e.t === 'avert' && e.texte.indexOf('2025-04') !== -1));

  const cache = secretariat.lireCacheNumeros(cheminCache);
  assert.deepStrictEqual(Object.keys(cache.numeros), ['2026-03']); // aucune entrée de cache pour 2025-04
});

// ---- Progression pendant le moissonnage : étape AVANT la requête, total toujours 0 ----
//
// Le point du correctif n'est pas seulement « une étape existe » (elle existait déjà, mais
// APRÈS la page reçue) : c'est l'ORDRE qui compte, puisque c'est pendant les ~4,6 s d'attente
// réseau que l'utilisateur a besoin d'un signe de vie. La vérification se fait donc DANS
// `recuperer`, avant qu'il ne rende la main — le seul endroit qui voit vraiment l'ordre.

test('commandeNumerosOjs : une étape "page N" est émise AVANT chaque requête réseau, pas seulement après', async () => {
  const xmlPage1 = enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:ED', titreFr: 'Éditorial', creators: ['Morand, Robin'],
    doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro'
  }), 'jeton-1');
  const xmlPage2 = enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Varia', creators: ['Dupont, Anne'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro'
  }));
  const evenements = [];
  let appels = 0;
  const resultat = await secretariat.commandeNumerosOjs({
    revue: 'revue', cheminCache: path.join(dossierTemp('szh-secr-progres-ordre-'), 'cache.json'),
    emettre: (e) => evenements.push(e),
    recuperer: async () => {
      appels++;
      // Au moment de la requête, l'étape « page <n> » doit DÉJÀ avoir été émise — avec le
      // code d'avant le correctif, elle n'arrivait qu'après ce retour, cette assertion aurait
      // donc échoué.
      assert.ok(
        evenements.some((e) => e.t === 'etape' && e.texte.indexOf('page ' + appels) !== -1),
        'l’étape « page ' + appels + ' » doit précéder la requête, pas la suivre'
      );
      return appels === 1 ? xmlPage1 : xmlPage2;
    }
  });
  assert.strictEqual(resultat.ok, true);
  assert.strictEqual(appels, 2);
});

test('commandeNumerosOjs : total toujours 0 pendant le moissonnage (completeListSize absent des réponses d’ojs.szh.ch)', async () => {
  const xmlPage1 = enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:ED', titreFr: 'Éditorial', creators: ['Morand, Robin'],
    doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro'
  }), 'jeton-1');
  const xmlPage2 = enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Varia', creators: ['Dupont, Anne'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro'
  }));
  const evenements = [];
  let appels = 0;
  await secretariat.commandeNumerosOjs({
    revue: 'revue', cheminCache: path.join(dossierTemp('szh-secr-progres-total0-'), 'cache.json'),
    emettre: (e) => evenements.push(e),
    recuperer: async () => { appels++; return appels === 1 ? xmlPage1 : xmlPage2; }
  });
  const progres = evenements.filter((e) => e.t === 'progres');
  assert.strictEqual(progres.length, 2);
  assert.deepStrictEqual(progres.map((e) => e.fait), [1, 2]);
  assert.ok(progres.every((e) => e.total === 0), 'total doit rester à 0, il est inconnu sur cet OAI : ' + JSON.stringify(progres));
});

// ---- commandeEdudoc : colonnes, padding des auteur·e·s, view -> download, sans-DOI -----

function cacheEdudocEssai(cheminCache) {
  const art1 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:VA', titreFr: 'Un article', creators: ['Dentz, Amélie', 'Frank Baud, Bianca'],
    doi: '10.57161/r2026-03-01', resumeFr: 'Un résumé.', volume: '16', numero: '03', annee: '2026',
    titreNumero: 'Numéro', pages: '27-32', pdf: 'https://ojs.szh.ch/index.php/revue/article/view/1/2'
  })))[0], 'revue');
  const art2 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:DC', titreFr: 'Sans DOI', creators: ['Meyer, Bruno'],
    volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro'
  })))[0], 'revue');
  const cache = { version: 1, dateRecolte: null, numeros: { '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026', numero: '03', volume: '16', titre: 'Numéro', issn: '2813-4915', articles: [art1, art2] }] } };
  secretariat.ecrireCacheNumeros(cheminCache, cache);
}

test('commandeEdudoc : colonnes MARC, padding des colonnes auteur·e·s, view->download, sans-DOI écarté', async () => {
  const cheminCache = path.join(dossierTemp('szh-secr-edu-'), 'cache.json');
  cacheEdudocEssai(cheminCache);
  const dossierSortie = dossierTemp('szh-secr-edu-sortie-');
  const evenements = [];
  const resultat = await secretariat.commandeEdudoc({
    cheminCache: cheminCache, cles: ['2026-03'], dossierSortie: dossierSortie,
    emettre: (e) => evenements.push(e)
  });
  assert.strictEqual(resultat.ok, true);
  assert.ok(evenements.some((e) => e.t === 'avert' && e.texte.indexOf('sans DOI') !== -1));

  const csv = fs.readFileSync(path.join(dossierSortie, 'edudoc.csv'), 'utf8');
  assert.strictEqual(csv.charAt(0), '\uFEFF');
  const lignes = csv.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l !== '');
  assert.strictEqual(lignes.length, 2); // en-tête + 1 article (le second, sans DOI, est écarté)
  assert.ok(lignes[0].indexOf('"7001_a-1"') !== -1 && lignes[0].indexOf('"7001_a-2"') !== -1);
  assert.ok(lignes[1].indexOf('"fre"') !== -1);
  assert.ok(lignes[1].indexOf('"Un article"') !== -1);
  assert.ok(lignes[1].indexOf('"Amélie Dentz et Bianca Frank Baud"') !== -1);
  assert.ok(lignes[1].indexOf('"Dentz, Amélie"') !== -1 && lignes[1].indexOf('"Frank Baud, Bianca"') !== -1);
  assert.ok(lignes[1].indexOf('/article/download/1/2') !== -1, 'view -> download attendu : ' + lignes[1]);
  assert.ok(lignes[1].indexOf('"27-32"') !== -1);
});

test('commandeEdudoc : progres monotone, un total connu d’avance (nombre de numéros), fait qui finit à total', async () => {
  const art1 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:VA', titreFr: 'Article A', creators: ['Dentz, Amélie'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numéro 3'
  })))[0], 'revue');
  const art2 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Article B', creators: ['Meyer, Bruno'],
    doi: '10.57161/r2026-04-01', volume: '16', numero: '04', annee: '2026', titreNumero: 'Numéro 4'
  })))[0], 'revue');
  const cheminCache = path.join(dossierTemp('szh-secr-edu-progres-'), 'cache.json');
  secretariat.ecrireCacheNumeros(cheminCache, {
    version: 1, dateRecolte: null,
    numeros: {
      '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026', numero: '03', volume: '16', titre: '', issn: '', articles: [art1] }],
      '2026-04': [{ cle: '2026-04', revue: 'revue', locale: 'fr', annee: '2026', numero: '04', volume: '16', titre: '', issn: '', articles: [art2] }]
    }
  });
  const dossierSortie = dossierTemp('szh-secr-edu-progres-sortie-');
  const evenements = [];
  const resultat = await secretariat.commandeEdudoc({
    cheminCache: cheminCache, cles: ['2026-03', '2026-04'], dossierSortie: dossierSortie,
    emettre: (e) => evenements.push(e)
  });
  assert.strictEqual(resultat.ok, true);
  const progres = evenements.filter((e) => e.t === 'progres');
  assert.strictEqual(progres.length, 2); // un par numéro demandé, ici deux
  assert.ok(progres.every((e) => e.total === 2), 'même total partout : ' + JSON.stringify(progres));
  assert.deepStrictEqual(progres.map((e) => e.fait), [1, 2]); // strictement croissant, finit à total
});

// ---- commandeEdudoc + mots-clés (690) : jointure par DOI depuis un numéro local ---------
//
// Décision de Robin : la source des mots-clés edudoc est le .meta.yaml de l'article dans le
// numéro local, jamais l'OAI. Le thésaurus est injecté via opts.motsClesConnus, jamais lu
// sur C:\ProgramData — même façon de faire que opts.recuperer pour le réseau ailleurs dans
// ce fichier. Les fonctions d'appariement (indexerThesaurus, apparierDescripteurs) viennent
// de lib/mots-cles-edudoc.js : ce fichier ne fait que les appeler, jamais les réimplémenter.

const THESAURUS_EDUDOC_ESSAI = [
  { de: 'Inklusion', fr: 'inclusion' },
  { de: 'Nachteilsausgleich', fr: 'compensation' },
  { de: 'Differenzierung', fr: 'differenciation' },
  { de: 'Heilpaedagogik', fr: 'pedagogie specialisee' },
  { de: 'Fruehfoerderung', fr: 'intervention precoce' }
];

// Un numéro local avec deux articles : l'un à deux mots-clés reconnus (+ un non reconnu),
// l'autre à cinq — bornes mesurées en vrai sur les numéros du poste (« de 3 à 7 »). Le DOI
// est posé explicitement dans la fiche (`doi:`) : c'est lui, pas le rang, qui doit faire la
// jointure avec le cache OAI, exactement comme comparerArticle/comparerNumero.
function ecrireNumeroEdudocMotsCles() {
  const racine = dossierTemp('szh-secr-edu-local-');
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), [
    'revue: "Revue suisse de pedagogie specialisee"',
    'title: "Numero edudoc"',
    'lang: fr',
    'volume: "16"',
    'numero: "03"',
    'date: "2026-09-01"',
    ''
  ].join('\n'));

  const article = (slug, lignes) => {
    const dossier = path.join(racine, 'articles', slug);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte.\n');
    fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'), lignes.concat(['']).join('\n'));
  };

  article('a-deux-mots-cles', [
    'type: varia', 'lang: fr',
    'doi: "10.57161/r2026-03-01"',
    'title:', '  fr: "Article a deux mots-cles"',
    'author:', '- prenom: "Amelie"', '  nom: "Dentz"',
    'keywords:',
    '  fr: ["inclusion", "compensation", "terme inconnu du thesaurus"]',
    '  de: ["Inklusion", "Nachteilsausgleich"]'
  ]);
  article('b-cinq-mots-cles', [
    'type: varia', 'lang: fr',
    'doi: "10.57161/r2026-03-02"',
    'title:', '  fr: "Article a cinq mots-cles"',
    'author:', '- prenom: "Bruno"', '  nom: "Meyer"',
    'keywords:',
    '  fr: ["inclusion", "compensation", "differenciation", "pedagogie specialisee", "intervention precoce"]',
    '  de: ["Inklusion", "Nachteilsausgleich", "Differenzierung", "Heilpaedagogik", "Fruehfoerderung"]'
  ]);
  return racine;
}

// Cache OAI/edudoc avec trois articles : deux ont un pendant local (les DOI ci-dessus), le
// troisième n'en a aucun — sa ligne doit sortir sans descripteurs, avec un avertissement.
function cacheEdudocMotsClesEssai(cheminCache) {
  const art1 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:VA', titreFr: 'Article a deux mots-cles', creators: ['Dentz, Amelie'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numero'
  })))[0], 'revue');
  const art2 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Article a cinq mots-cles', creators: ['Meyer, Bruno'],
    doi: '10.57161/r2026-03-02', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numero'
  })))[0], 'revue');
  const art3 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '3', setSpec: 'revue:VA', titreFr: 'Article publie mais pas encore rapatrie', creators: ['Inconnu, Personne'],
    doi: '10.57161/r2026-03-03', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numero'
  })))[0], 'revue');
  secretariat.ecrireCacheNumeros(cheminCache, {
    version: 1, dateRecolte: null,
    numeros: { '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026', numero: '03', volume: '16', titre: 'Numero', issn: '', articles: [art1, art2, art3] }] }
  });
}

test('commandeEdudoc : avec --numero (racines locales), colonnes 690 en forme canonique du thésaurus, remplissage à droite', async () => {
  const cheminCache = path.join(dossierTemp('szh-secr-edu-mc-'), 'cache.json');
  cacheEdudocMotsClesEssai(cheminCache);
  const racineLocale = ecrireNumeroEdudocMotsCles();
  const dossierSortie = dossierTemp('szh-secr-edu-mc-sortie-');
  const evenements = [];
  const resultat = await secretariat.commandeEdudoc({
    cheminCache: cheminCache, cles: ['2026-03'], dossierSortie: dossierSortie,
    racinesNumeros: [racineLocale], motsClesConnus: THESAURUS_EDUDOC_ESSAI,
    emettre: (e) => evenements.push(e)
  });
  assert.strictEqual(resultat.ok, true);

  const csv = fs.readFileSync(path.join(dossierSortie, 'edudoc.csv'), 'utf8');
  const lignes = csv.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l !== '');
  assert.strictEqual(lignes.length, 4); // en-tête + 3 articles (dont celui sans pendant local)

  // En-tête : cinq paires 690__a-N/690__b-N — le maximum rencontré, porté par l'article à
  // cinq mots-clés reconnus.
  assert.ok(lignes[0].indexOf('"690__a-1"') !== -1 && lignes[0].indexOf('"690__b-1"') !== -1, lignes[0]);
  assert.ok(lignes[0].indexOf('"690__a-5"') !== -1 && lignes[0].indexOf('"690__b-5"') !== -1, lignes[0]);
  assert.ok(lignes[0].indexOf('"690__a-6"') === -1, 'pas de sixième paire : le maximum est cinq');
  const nbColonnesEntete = lignes[0].split(';').length;

  const ligneA = lignes.find((l) => l.indexOf('Article a deux mots-cles') !== -1);
  const ligneB = lignes.find((l) => l.indexOf('Article a cinq mots-cles') !== -1);
  const ligneC = lignes.find((l) => l.indexOf('pas encore rapatrie') !== -1);
  assert.ok(ligneA, 'ligne de l’article à deux mots-clés introuvable : ' + lignes.join('\n'));
  assert.ok(ligneB, 'ligne de l’article à cinq mots-clés introuvable : ' + lignes.join('\n'));
  assert.ok(ligneC, 'ligne du troisième article introuvable : ' + lignes.join('\n'));

  // Forme canonique du thésaurus (ici identique à la saisie, mais la colonne allemande
  // prouve que l'appariement passe bien par l'index, jamais par la position dans la liste).
  assert.ok(ligneA.indexOf('"Inklusion"') !== -1 && ligneA.indexOf('"inclusion"') !== -1, ligneA);
  assert.ok(ligneA.indexOf('"Nachteilsausgleich"') !== -1 && ligneA.indexOf('"compensation"') !== -1, ligneA);

  // Remplissage à droite : les trois lignes ont exactement le même nombre de colonnes que
  // l'en-tête, quel que soit leur nombre réel de descripteurs (2, 5, ou 0).
  assert.strictEqual(ligneA.split(';').length, nbColonnesEntete);
  assert.strictEqual(ligneB.split(';').length, nbColonnesEntete);
  assert.strictEqual(ligneC.split(';').length, nbColonnesEntete);

  // Le troisième article (OAI) n'a pas de pendant local : ligne sans descripteurs, avec un
  // avertissement explicite — le CSV reste valide (colonnes toutes présentes, vides).
  assert.ok(evenements.some((e) => e.t === 'avert' &&
    e.texte.indexOf('10.57161/r2026-03-03') !== -1 && e.texte.indexOf('aucun article local') !== -1),
    evenements.map((e) => e.texte).join('\n'));

  // Bilan chiffré : 2 + 5 = 7 descripteurs exportés, un mot-clé saisi non reconnu par le
  // thésaurus, compté et listé plutôt que perdu en silence.
  assert.ok(evenements.some((e) => e.t === 'etape' && e.texte.indexOf('7 descripteur') !== -1),
    evenements.map((e) => e.texte).join('\n'));
  assert.ok(evenements.some((e) => e.t === 'avert' &&
    e.texte.indexOf('1 mot') !== -1 && e.texte.indexOf('terme inconnu du thesaurus') !== -1),
    evenements.map((e) => e.texte).join('\n'));
});

test('commandeEdudoc : un même mot-clé non reconnu saisi par deux articles ne compte, et n’apparaît, qu’une fois dans le bilan', async () => {
  const cheminCache = path.join(dossierTemp('szh-secr-edu-dup-'), 'cache.json');
  const art1 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:VA', titreFr: 'Premier article', creators: ['Dentz, Amelie'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numero'
  })))[0], 'revue');
  const art2 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Second article', creators: ['Meyer, Bruno'],
    doi: '10.57161/r2026-03-02', volume: '16', numero: '03', annee: '2026', titreNumero: 'Numero'
  })))[0], 'revue');
  secretariat.ecrireCacheNumeros(cheminCache, {
    version: 1, dateRecolte: null,
    numeros: { '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026', numero: '03', volume: '16', titre: 'Numero', issn: '', articles: [art1, art2] }] }
  });

  const racine = dossierTemp('szh-secr-edu-dup-local-');
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), [
    'revue: "Revue suisse de pedagogie specialisee"',
    'title: "Numero"', 'lang: fr', 'volume: "16"', 'numero: "03"', 'date: "2026-09-01"', ''
  ].join('\n'));
  const article = (slug, lignes) => {
    const dossier = path.join(racine, 'articles', slug);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte.\n');
    fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'), lignes.concat(['']).join('\n'));
  };
  // Même terme, deux graphies différentes (casse) — même clé pliée (plierDescripteur), doit
  // compter et s'afficher une seule fois, sous la première graphie rencontrée.
  article('premier', [
    'type: varia', 'lang: fr', 'doi: "10.57161/r2026-03-01"',
    'title:', '  fr: "Premier article"',
    'author:', '- prenom: "Amelie"', '  nom: "Dentz"',
    'keywords:', '  fr: ["Terme Partage Inconnu"]'
  ]);
  article('second', [
    'type: varia', 'lang: fr', 'doi: "10.57161/r2026-03-02"',
    'title:', '  fr: "Second article"',
    'author:', '- prenom: "Bruno"', '  nom: "Meyer"',
    'keywords:', '  fr: ["terme partage inconnu"]'
  ]);

  const dossierSortie = dossierTemp('szh-secr-edu-dup-sortie-');
  const evenements = [];
  const resultat = await secretariat.commandeEdudoc({
    cheminCache: cheminCache, cles: ['2026-03'], dossierSortie: dossierSortie,
    racinesNumeros: [racine], motsClesConnus: THESAURUS_EDUDOC_ESSAI,
    emettre: (e) => evenements.push(e)
  });
  assert.strictEqual(resultat.ok, true);

  // Aucun descripteur (le terme n'est pas dans le thésaurus) : seul le bilan des non reconnus
  // est en jeu ici.
  assert.ok(evenements.some((e) => e.t === 'etape' && e.texte.indexOf('0 descripteur') !== -1),
    evenements.map((e) => e.texte).join('\n'));

  // Un seul avertissement de bilan, et le compte qu'il annonce dit bien « 1 » — le terme
  // saisi deux fois (une par article, sous deux casses) ne doit compter qu'une fois.
  const bilans = evenements.filter((e) => e.t === 'avert' && e.texte.indexOf('non reconnu') !== -1);
  assert.strictEqual(bilans.length, 1, 'un seul avertissement de bilan attendu : ' + evenements.map((e) => e.texte).join('\n'));
  assert.ok(bilans[0].texte.indexOf('1 mot') !== -1, bilans[0].texte);
  assert.ok(bilans[0].texte.indexOf('distinct') !== -1, bilans[0].texte);

  // Et il n'apparaît qu'une fois dans la liste affichée, quelle que soit sa casse.
  const occurrences = bilans[0].texte.toLowerCase().split('terme partage inconnu').length - 1;
  assert.strictEqual(occurrences, 1, bilans[0].texte);
  // La première graphie rencontrée est celle qui est gardée.
  assert.ok(bilans[0].texte.indexOf('Terme Partage Inconnu') !== -1, bilans[0].texte);
});

test('commandeEdudoc : sans --numero, comportement d’avant — pas de colonnes 690, rien ne casse', async () => {
  const cheminCache = path.join(dossierTemp('szh-secr-edu-sansmc-'), 'cache.json');
  cacheEdudocEssai(cheminCache);
  const dossierSortie = dossierTemp('szh-secr-edu-sansmc-sortie-');
  const evenements = [];
  const resultat = await secretariat.commandeEdudoc({
    cheminCache: cheminCache, cles: ['2026-03'], dossierSortie: dossierSortie,
    emettre: (e) => evenements.push(e)
  });
  assert.strictEqual(resultat.ok, true);
  const csv = fs.readFileSync(path.join(dossierSortie, 'edudoc.csv'), 'utf8');
  assert.strictEqual(csv.indexOf('690__'), -1, 'aucune colonne 690 attendue sans --numero (comportement d’avant)');
  assert.ok(!evenements.some((e) => e.texte && e.texte.indexOf('690') !== -1), 'aucun bilan de mots-clés sans --numero');
});

// ---- commandeCaracteres : téléchargement (factice), comptage, galley absente -----------

test('commandeCaracteres : compte les caractères de la galley HTML, signale l’absence de galley', async () => {
  const art1 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:VA', titreFr: 'Article avec HTML', creators: ['Dupont, Anne'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026',
    html: 'https://ojs.szh.ch/index.php/revue/article/view/1/html'
  })))[0], 'revue');
  const art2 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Article sans HTML', creators: ['Meyer, Bruno'],
    doi: '10.57161/r2026-03-02', volume: '16', numero: '03', annee: '2026'
  })))[0], 'revue');
  const cheminCache = path.join(dossierTemp('szh-secr-car-'), 'cache.json');
  secretariat.ecrireCacheNumeros(cheminCache, { version: 1, dateRecolte: null, numeros: { '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026', numero: '03', volume: '16', titre: '', issn: '', articles: [art1, art2] }] } });

  const dossierSortie = dossierTemp('szh-secr-car-sortie-');
  const evenements = [];
  const resultat = await secretariat.commandeCaracteres({
    cheminCache: cheminCache, cles: ['2026-03'], dossierSortie: dossierSortie,
    emettre: (e) => evenements.push(e),
    recuperer: async (url) => {
      assert.strictEqual(url, 'https://ojs.szh.ch/index.php/revue/article/view/1/html');
      return '<html><body><p>Douze caractères</p></body></html>';
    }
  });
  assert.strictEqual(resultat.ok, true);
  assert.ok(evenements.some((e) => e.t === 'avert' && e.texte.indexOf('pas de galley HTML') !== -1));
  const csv = fs.readFileSync(path.join(dossierSortie, 'caracteres.csv'), 'utf8');
  const lignes = csv.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l !== '');
  assert.strictEqual(lignes.length, 2); // en-tête + 1 (le second article est écarté, pas de galley)
  assert.ok(lignes[1].indexOf('"16"') !== -1 && lignes[1].indexOf('"03"') !== -1);
  assert.ok(lignes[1].indexOf('"' + 'Douze caractères'.length + '"') !== -1, lignes[1]);
});

test('commandeCaracteres : progres monotone, total = seuls les articles à galley HTML (calculé avant la boucle)', async () => {
  const art1 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:VA', titreFr: 'Avec HTML un', creators: ['Dupont, Anne'],
    doi: '10.57161/r2026-03-01', volume: '16', numero: '03', annee: '2026',
    html: 'https://ojs.szh.ch/index.php/revue/article/view/1/html'
  })))[0], 'revue');
  const art2 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '2', setSpec: 'revue:VA', titreFr: 'Sans HTML', creators: ['Meyer, Bruno'],
    doi: '10.57161/r2026-03-02', volume: '16', numero: '03', annee: '2026'
  })))[0], 'revue');
  const art3 = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '3', setSpec: 'revue:VA', titreFr: 'Avec HTML deux', creators: ['Ruffieux, Nicolas'],
    doi: '10.57161/r2026-03-03', volume: '16', numero: '03', annee: '2026',
    html: 'https://ojs.szh.ch/index.php/revue/article/view/3/html'
  })))[0], 'revue');
  const cheminCache = path.join(dossierTemp('szh-secr-car-progres-'), 'cache.json');
  secretariat.ecrireCacheNumeros(cheminCache, {
    version: 1, dateRecolte: null,
    numeros: { '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026', numero: '03', volume: '16', titre: '', issn: '', articles: [art1, art2, art3] }] }
  });
  const dossierSortie = dossierTemp('szh-secr-car-progres-sortie-');
  const evenements = [];
  const resultat = await secretariat.commandeCaracteres({
    cheminCache: cheminCache, cles: ['2026-03'], dossierSortie: dossierSortie,
    emettre: (e) => evenements.push(e),
    recuperer: async () => '<html><body><p>Texte</p></body></html>'
  });
  assert.strictEqual(resultat.ok, true);
  const progres = evenements.filter((e) => e.t === 'progres');
  // Seuls les deux articles à galley HTML comptent, l'article sans galley n'entre jamais
  // dans le total (il n'est jamais téléchargé, donc jamais compté « à télécharger »).
  assert.strictEqual(progres.length, 2);
  assert.ok(progres.every((e) => e.total === 2), 'même total partout : ' + JSON.stringify(progres));
  assert.deepStrictEqual(progres.map((e) => e.fait), [1, 2]);
});

// ---- commandeMetadonnees : concordance, divergence, absent des deux côtés --------------

test('commandeMetadonnees : compare et rapporte concordances/divergences/absences', async () => {
  const racine = ecrireNumeroEssai();
  const artEd = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '1', setSpec: 'revue:ED', titreFr: 'Mot de la rédaction', titreDe: 'Wort der Redaktion',
    creators: ['Morand, Robin'], doi: '10.57161/r2026-03-00', volume: '16', numero: '03', annee: '2026'
  })))[0], 'revue');
  const artAutre = secretariat.decoderRecordOai(secretariat.extraireBlocsRecord(enveloppeOai(recordOaiDc({
    id: '99', setSpec: 'revue:VA', titreFr: 'Un article publié mais pas encore rapatrié localement',
    creators: ['Inconnu, Personne'], doi: '10.57161/r2026-03-99', volume: '16', numero: '03', annee: '2026'
  })))[0], 'revue');
  const cheminCache = path.join(dossierTemp('szh-secr-meta-'), 'cache.json');
  secretariat.ecrireCacheNumeros(cheminCache, { version: 1, dateRecolte: null, numeros: { '2026-03': [{ cle: '2026-03', revue: 'revue', locale: 'fr', annee: '2026', numero: '03', volume: '16', titre: '', issn: '', articles: [artEd, artAutre] }] } });

  const dossierSortie = dossierTemp('szh-secr-meta-sortie-');
  const resultat = await secretariat.commandeMetadonnees({
    racinesNumeros: [racine], cheminCache: cheminCache, dossierSortie: dossierSortie
  });
  assert.strictEqual(resultat.ok, true);
  const rapport = fs.readFileSync(path.join(dossierSortie, 'metadonnees.txt'), 'utf8');
  // L'éditorial concorde (mêmes titres fr/de, même auteur).
  assert.ok(rapport.indexOf('00-editorial') !== -1 && rapport.indexOf('concorde') !== -1, rapport);
  // Les deux varia locaux n'ont pas de contrepartie OAI (DOI différents dans la fixture).
  assert.ok(rapport.indexOf('aucun article OJS ne porte ce DOI') !== -1, rapport);
  // 10-doc n'a pas de DOI local : comparaison impossible, le dit explicitement.
  assert.ok(rapport.indexOf('pas de DOI local') !== -1, rapport);
  // L'article OAI 99 n'a pas de pendant local.
  assert.ok(rapport.indexOf('sans correspondance locale') !== -1 && rapport.indexOf('10.57161/r2026-03-99') !== -1, rapport);
  // Le rappel sur l'affiliation, non vérifiable via oai_dc.
  assert.ok(rapport.indexOf('non vérifiable') !== -1, rapport);
});

// ---- SZH_RESEAU_INTERDIT : les commandes réseau échouent net, newsletter/metadonnees non ---

test('SZH_RESEAU_INTERDIT : numeros-ojs échoue sans recuperer injecté, newsletter fonctionne quand même', async () => {
  const avant = process.env.SZH_RESEAU_INTERDIT;
  process.env.SZH_RESEAU_INTERDIT = '1';
  try {
    await assert.rejects(
      () => secretariat.commandeNumerosOjs({ revue: 'revue', cheminCache: path.join(dossierTemp('szh-secr-net-'), 'c.json') }),
      /SZH_RESEAU_INTERDIT/);

    const racine = ecrireNumeroEssai();
    const resultat = await secretariat.commandeNewsletter({
      racineNumero: racine, dossierSortie: dossierTemp('szh-secr-net-sortie-')
    });
    assert.strictEqual(resultat.ok, true);
  } finally {
    if (avant === undefined) { delete process.env.SZH_RESEAU_INTERDIT; } else { process.env.SZH_RESEAU_INTERDIT = avant; }
  }
});
