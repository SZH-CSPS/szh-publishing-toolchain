// La structure d'un livre en maquette normal, côté livre-assembler.py : parties, sommaire,
// pièces de fin, dédicace, impressum, logo de la page de titre, éditeurs « (Hrsg.) ». Les
// clés du bloc mise-en-page viennent du contrat pipeline/livre/mise-en-page.json ; le
// rendu (pages, cotes) se juge sur les bancs test/livre-normal et test/livre-collectif.
//
//   node --test test/js/livre-structure.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gardes = require('./gardes');
const { sansPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const ASSEMBLEUR = path.join(RACINE, 'pipeline', 'livre-assembler.py');
const GABARIT = path.join(RACINE, 'pipeline', 'templates', 'szh-livre.html');
const ENV = { env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) };
// Un PNG gris de 1 × 1 : image factice pour les logos et illustrations.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==', 'base64');

// Un fragment de chapitre dans la forme de szh-livre-chapitre.html.
function fragment(slug, rang, titre, o) {
  const opts = o || {};
  const num = opts.num ? '<span class="szh-num-section">' + opts.num + ' </span>' : '';
  const h1 = titre === null ? '' : '<h1 id="' + slug + '-titre">' + num + titre + '</h1>\n';
  return '<section class="szh-chapitre" id="ch-' + slug + '" style="--c-chapitre: #4D869F;" data-rang="'
    + rang + '">\n<div class="szh-onglet" aria-hidden="true"></div>\n'
    + '<div class="szh-pastille" aria-hidden="true">' + rang + '</div>\n'
    + '<div class="szh-picto-entete" data-picto aria-hidden="true"></div>\n'
    + h1 + '<p>Texte.</p>\n<h2 id="' + slug + '-abschnitt">Abschnitt</h2>\n<p>Texte.</p>\n'
    + (opts.biblio ? '<h2 id="' + slug + '-szh-bibliographie">Literatur</h2>\n<p>Ref.</p>\n' : '')
    + '</section>\n';
}

// Un livre jetable : buch.yaml, fragments (slug -> [titre, opts]), pièces compilées
// (out/liminaires/<nom>.html), fichiers (chemin -> contenu), fiches de chapitre.
function livre(buch, o) {
  const opts = o || {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-structure-'));
  try {
    fs.writeFileSync(path.join(d, 'buch.yaml'), buch, 'utf8');
    for (const [nom, contenu] of Object.entries(opts.fichiers || {})) {
      fs.mkdirSync(path.dirname(path.join(d, nom)), { recursive: true });
      fs.writeFileSync(path.join(d, nom), contenu);
    }
    for (const [nom, contenu] of Object.entries(opts.pieces || {})) {
      fs.mkdirSync(path.join(d, 'out', 'liminaires'), { recursive: true });
      fs.writeFileSync(path.join(d, 'out', 'liminaires', nom + '.html'), contenu, 'utf8');
    }
    const chapitres = opts.chapitres || { '01-eins': ['Erstes Kapitel'], '02-zwei': ['Zweites Kapitel'] };
    const frags = Object.entries(chapitres).map(([slug, [titre, f]], i) => {
      const chemin = path.join(d, slug + '.frag.html');
      fs.writeFileSync(chemin, fragment(slug, i + 1, titre, f), 'utf8');
      return chemin;
    });
    const sortie = path.join(d, 'livre.html');
    const args = opts.numeros
      ? [ASSEMBLEUR, '--meta', path.join(d, 'buch.yaml'), '--numeros-chapitres'].concat(Object.keys(chapitres))
      : [ASSEMBLEUR, '--meta', path.join(d, 'buch.yaml'), '--gabarit', GABARIT, '--sortie', sortie,
        '--out', path.join(d, 'out')].concat(frags);
    const r = gardes.pythonGroupe(args, ENV);
    return {
      status: r.status, stderr: String(r.stderr || ''), stdout: String(r.stdout || ''),
      html: fs.existsSync(sortie) ? fs.readFileSync(sortie, 'utf8') : null,
    };
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

const TETE = 'titre: "Ein Buch"\nlang: de\nmaquette: normal\n';
function buch(extra, liminaires) {
  return TETE + 'liminaires: [' + (liminaires || 'sommaire') + ']\n' + (extra || '');
}
function bloc(lignes) {
  return 'mise-en-page:\n' + Object.entries(lignes).map(([c, v]) => '  ' + c + ': ' + v + '\n').join('');
}
const PARTIES = 'parties:\n'
  + '- titre: "Grundlagen // und Begriffe"\n  numero: "1"\n  chapitres: [01-eins, 02-zwei]\n'
  + '  page-seule: oui\n  numeroter: oui\n';

function exigerRefus(r, code, champ) {
  assert.strictEqual(r.status, 1, 'le livre doit être refusé : ' + r.stderr);
  assert.strictEqual(r.html, null, 'un HTML a été écrit malgré le refus');
  const ligne = r.stderr.split(/\r?\n/).find((l) => l.startsWith('[livre-blocage] ' + code + ' | ' + champ));
  assert.ok(ligne, 'refus ' + code + ' absent : ' + r.stderr);
  const champs = ligne.split(' | ');
  assert.ok(champs[champs.length - 1].startsWith('[de] ') && champs[champs.length - 1].length > 10, ligne);
  assert.ok(champs[champs.length - 2].length > 10, 'phrase française absente : ' + ligne);
}

function sommaire(html) {
  const s = /<section class="szh-sommaire"[\s\S]*?<\/section>/.exec(html || '');
  return s ? s[0].match(/<li[\s\S]*?<\/li>/g) || [] : [];
}

// ── Parties ───────────────────────────────────────────────────────────────────────────

test('parties : la section de partie précède son premier chapitre, ses chapitres portent data-partie', { skip: sansPython }, () => {
  const r = livre(buch(PARTIES), { chapitres: { '00-vorwort': ['Vorwort'], '01-eins': ['Eins'], '02-zwei': ['Zwei'] } });
  assert.strictEqual(r.status, 0, r.stderr);
  const iPartie = r.html.indexOf('<section class="szh-partie" id="partie-1" data-page-seule="oui">');
  assert.ok(iPartie > r.html.indexOf('id="ch-00-vorwort"') && iPartie < r.html.indexOf('id="ch-01-eins"'), r.html);
  assert.match(r.html, /<h1 id="partie-1-titre" data-signet="Grundlagen und Begriffe">Grundlagen<br>und Begriffe<\/h1>/);
  assert.match(r.html, /<section class="szh-chapitre" data-partie="1" id="ch-01-eins"/);
  assert.match(r.html, /<section class="szh-chapitre" data-partie="1" id="ch-02-zwei"/);
  assert.match(r.html, /<section class="szh-chapitre" id="ch-00-vorwort"/);
});

test('parties : page-seule non, la section le dit ; une illustration y est refusée', { skip: sansPython }, () => {
  const p = 'parties:\n- titre: "Einführung"\n  numero: "II"\n  chapitres: [01-eins]\n  page-seule: non\n';
  const r = livre(buch(p));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.html, /<section class="szh-partie" id="partie-1" data-page-seule="non">/);
  exigerRefus(livre(buch(p + '  illustration: x.png\n'), { fichiers: { 'x.png': PNG } }),
    'partie-illustration-page', 'parties[1].illustration');
});

test('parties (titre-partie) : le numéro s’imprime avec titre, jamais en intercalaire', { skip: sansPython }, () => {
  const titre = livre(buch(PARTIES + bloc({ 'titre-partie': 'titre' })));
  assert.strictEqual(titre.status, 0, titre.stderr);
  assert.match(titre.html, /<h1 id="partie-1-titre" data-signet="1 Grundlagen und Begriffe"><span class="szh-num-partie">1 <\/span>Grundlagen/);
  assert.match(titre.html, / data-titre-partie="titre"/);
  const inter = livre(buch(PARTIES));
  assert.strictEqual(inter.status, 0, inter.stderr);
  assert.doesNotMatch(inter.html, /szh-num-partie/);
  assert.match(inter.html, / data-titre-partie="intercalaire"/);
});

test('parties : l’illustration est incorporée, son alt vient de illustration-alt, vide sinon', { skip: sansPython }, () => {
  const p = PARTIES + '  illustration: parties/bild.png\n';
  const sans = livre(buch(p), { fichiers: { 'parties/bild.png': PNG } });
  assert.strictEqual(sans.status, 0, sans.stderr);
  // Décorative : un fond CSS dans deux <span>, jamais un <img> sans alt (PDF/UA).
  assert.match(sans.html, /<p class="szh-partie-illustration"><span class="szh-decor-livre szh-partie-image" role="presentation" style="--ratio: 1\.0000"><span style="background-image: url\(&quot;data:image\/png;base64,[^&]+&quot;\)"><\/span><\/span><\/p>/);
  assert.doesNotMatch(sans.html, /<img[^>]*alt=""/);
  const avec = livre(buch(p + '  illustration-alt: "Ein Kind mit Ball"\n'), { fichiers: { 'parties/bild.png': PNG } });
  assert.match(avec.html, /alt="Ein Kind mit Ball"/);
  exigerRefus(livre(buch(p)), 'fichier-introuvable', 'parties[1].illustration');
});

test('parties : chaque erreur de structure est refusée, en fr et en de', { skip: sansPython }, () => {
  const cas = [
    ['parties:\n- titre: "A"\n  chapitres: [01-eins, 99-fehlt]\n', 'partie-chapitre-inconnu', 'parties[1].chapitres'],
    ['parties:\n- titre: "A"\n  chapitres: [02-zwei, 01-eins]\n', 'partie-non-contigue', 'parties[1].chapitres'],
    ['parties:\n- titre: "A"\n  chapitres: [01-eins, 03-drei]\n', 'partie-non-contigue', 'parties[1].chapitres'],
    ['parties:\n- titre: "A"\n  chapitres: [01-eins]\n- titre: "B"\n  chapitres: [01-eins]\n', 'partie-chapitre-double', 'parties[2].chapitres'],
    ['parties:\n- numero: "1"\n  chapitres: [01-eins]\n', 'partie-sans-titre', 'parties[1].titre'],
    ['parties:\n- titre: "A"\n  chapitres: []\n', 'partie-sans-chapitre', 'parties[1].chapitres'],
    ['parties:\n- titre: "A"\n  chapitres: [01-eins]\n  page-seule: vielleicht\n', 'partie-valeur', 'parties[1].page-seule'],
    ['parties:\n- titre: "A"\n  chapitres: [01-eins]\n  farbe: rot\n', 'partie-cle-inconnue', 'parties[1].farbe'],
  ];
  const chapitres = { '01-eins': ['Eins'], '02-zwei': ['Zwei'], '03-drei': ['Drei'] };
  for (const [extra, code, champ] of cas) { exigerRefus(livre(buch(extra), { chapitres }), code, champ); }
});

test('parties : la maquette falc ignore parties, pièces de fin et dédicace', { skip: sansPython }, () => {
  const r = livre('titre: "Ein Buch"\nlang: fr\nmaquette: falc\nliminaires: [sommaire, dedicace]\n'
    + 'pieces-fin: [fehlt.md]\n' + PARTIES);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.html, /szh-partie|data-partie|szh-dedicace|szh-piece-fin/);
});

// ── Numéros de chapitre par partie ────────────────────────────────────────────────────

test('numeros-chapitres partie : « 1.1 », « 1.2 » pour une partie numerotee, rien ailleurs', { skip: sansPython }, () => {
  const p = PARTIES + '- titre: "Anhang"\n  numero: "2"\n  chapitres: [03-drei]\n';
  const fiches = {
    'chapitres/01-eins/01-eins.meta.yaml': 'title:\n  de: "Eins"\n',
    'chapitres/02-zwei/02-zwei.meta.yaml': 'title:\n  de: "Zwei"\n',
    'chapitres/03-drei/03-drei.meta.yaml': 'title:\n  de: "Drei"\n',
  };
  const chapitres = { '00-vor': ['Vor'], '01-eins': ['Eins'], '02-zwei': ['Zwei'], '03-drei': ['Drei'] };
  const r = livre(buch(p + bloc({ 'numeros-chapitres': 'partie' })), { numeros: true, fichiers: fiches, chapitres });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.stdout.trim().split(/\r?\n/), ['01-eins=1.1', '02-zwei=1.2']);
  const continu = livre(buch(p + bloc({ 'numeros-chapitres': 'continu' })), { numeros: true, fichiers: fiches, chapitres });
  assert.strictEqual(continu.status, 0, continu.stderr);
  assert.strictEqual(continu.stdout.trim(), '');
});

test('numeros-chapitres partie : un chapitre sans titre n’est ni numéroté ni compté', { skip: sansPython }, () => {
  const p = 'parties:\n- titre: "Teil"\n  numero: "3"\n  numeroter: oui\n  chapitres: [01-intro, 02-eins]\n';
  const r = livre(buch(p + bloc({ 'numeros-chapitres': 'partie' })), {
    numeros: true, chapitres: { '01-intro': [null], '02-eins': ['Eins'] },
    fichiers: { 'chapitres/01-intro/01-intro.md': 'Nur Text.\n', 'chapitres/02-eins/02-eins.md': '# Eins\n\nText.\n' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), '02-eins=3.1');
});

test('numeros-chapitres partie : le sommaire reprend le numéro du titre, pas la pastille', { skip: sansPython }, () => {
  const r = livre(buch(PARTIES + bloc({ 'numeros-chapitres': 'partie', sommaire: 'hierarchique' })),
    { chapitres: { '01-eins': ['Eins', { num: '1.1' }], '02-zwei': ['Zwei', { num: '1.2' }] } });
  assert.strictEqual(r.status, 0, r.stderr);
  const li = sommaire(r.html);
  assert.match(li[1], /<a href="#01-eins-titre">1\.1 Eins<\/a>/, li[1]);
  assert.match(li[2], /<a href="#02-zwei-titre">1\.2 Zwei<\/a>/, li[2]);
});

// ── Sommaire ─────────────────────────────────────────────────────────────────────────

test('sommaire : la partie entre au niveau 0, ses chapitres sont marqués dans-partie', { skip: sansPython }, () => {
  const r = livre(buch(PARTIES + bloc({ 'titre-partie': 'titre' })), { chapitres: { '00-vor': ['Vor'], '01-eins': ['Eins'], '02-zwei': ['Zwei'] } });
  assert.strictEqual(r.status, 0, r.stderr);
  const li = sommaire(r.html);
  assert.strictEqual(li.length, 4, li.join('\n'));
  assert.match(li[0], /^<li class="niveau-1" [^>]*><span><a href="#00-vor-titre">Vor</);
  // Le numéro hors du lien : un bloc en ligne dans un <a> lui ôte son balisage /Link.
  assert.strictEqual(li[1], '<li class="niveau-0 partie-seule"><span><span class="szh-sommaire-num">1</span>'
    + '<a href="#partie-1-titre">Grundlagen und Begriffe</a></span></li>');
  assert.match(li[2], /^<li class="niveau-1 dans-partie" /);
});

test('sommaire : une partie page-seule non est marquée partie-partagee', { skip: sansPython }, () => {
  const r = livre(buch('parties:\n- titre: "Vorwort"\n  numero: "I"\n  chapitres: [01-eins]\n  page-seule: non\n'));
  assert.match(sommaire(r.html)[0], /^<li class="niveau-0 partie-partagee">/);
});

test('sommaire (sommaire-niveaux) : 1 par défaut, les chapitres seuls ; 2 ajoute leurs intertitres', { skip: sansPython }, () => {
  const un = livre(buch(''));
  assert.strictEqual(un.status, 0, un.stderr);
  assert.ok(sommaire(un.html).every((l) => /niveau-1/.test(l)), sommaire(un.html).join('\n'));
  assert.match(un.html, / data-sommaire-niveaux="1"/);
  const deux = livre(buch(bloc({ 'sommaire-niveaux': 2 })));
  assert.strictEqual(deux.status, 0, deux.stderr);
  assert.ok(sommaire(deux.html).some((l) => /niveau-2.*Abschnitt/.test(l)), sommaire(deux.html).join('\n'));
});

test('sommaire : la bibliographie n’y entre jamais, même avec sommaire-niveaux 2', { skip: sansPython }, () => {
  const r = livre(buch(bloc({ 'sommaire-niveaux': 2 })), { chapitres: { '01-eins': ['Eins', { biblio: true }] } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!sommaire(r.html).some((l) => /Literatur/.test(l)), sommaire(r.html).join('\n'));
});

test('sommaire : un liminaire écrit qui suit le sommaire y entre, celui qui le précède non', { skip: sansPython }, () => {
  const r = livre(buch('', 'vorab.md, sommaire, vorwort.md'), {
    pieces: { vorab: '<h1 id="vorab">Vorab</h1>\n<p>x</p>', vorwort: '<h1 id="vorwort">Vorwort</h1>\n<p>x</p>' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const li = sommaire(r.html);
  assert.strictEqual(li[0], '<li class="niveau-1"><span><a href="#vorwort">Vorwort</a></span></li>');
  assert.ok(!li.some((l) => /Vorab/.test(l)), li.join('\n'));
});

test('sommaire : un chapitre sans titre n’a pas d’entrée', { skip: sansPython }, () => {
  const r = livre(buch(''), { chapitres: { '01-intro': [null], '02-eins': ['Eins'] } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(sommaire(r.html).map((l) => /href="#([^"]+)"/.exec(l)[1]), ['02-eins-titre']);
});

// ── Pièces de fin ─────────────────────────────────────────────────────────────────────

test('pieces-fin : après le dernier chapitre, chacune au sommaire', { skip: sansPython }, () => {
  const r = livre(buch('pieces-fin: [autorinnen.md]\n'),
    { pieces: { autorinnen: '<h1 id="autorinnen">Autorinnen</h1>\n<div class="notices"><p>x</p></div>' } });
  assert.strictEqual(r.status, 0, r.stderr);
  const i = r.html.indexOf('<section class="szh-liminaire szh-romain szh-piece-fin"><h1 id="autorinnen">');
  assert.ok(i > r.html.indexOf('id="ch-02-zwei"'), r.html);
  const li = sommaire(r.html);
  assert.strictEqual(li[li.length - 1], '<li class="niveau-1"><span><a href="#autorinnen">Autorinnen</a></span></li>');
});

test('pieces-fin : une pièce non compilée arrête l’assemblage, un nom sans .md est refusé', { skip: sansPython }, () => {
  const absente = livre(buch('pieces-fin: [fehlt.md]\n'));
  assert.strictEqual(absente.status, 1);
  assert.match(absente.stderr, /\[livre-blocage\] liminaire-introuvable \| pièce « fehlt\.md » \|.*\| \[de\] /);
  exigerRefus(livre(buch('pieces-fin: [autorinnen]\n')), 'piece-fin-inconnue', 'pieces-fin');
});

// ── Dédicace ─────────────────────────────────────────────────────────────────────────

test('dedicace : le jeton compose la dédicace de buch.yaml, « // » en saut de ligne', { skip: sansPython }, () => {
  const r = livre(buch('dedicace: "Für A, B, C,//D und E"\n', 'page-titre, dedicace, sommaire'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.html, /<section class="szh-liminaire szh-dedicace"><p>Für A, B, C,<br>D und E<\/p><\/section>/);
  assert.ok(r.html.indexOf('szh-dedicace') < r.html.indexOf('szh-sommaire'));
  exigerRefus(livre(buch('', 'dedicace, sommaire')), 'dedicace-vide', 'dedicace');
});

// ── Impressum ────────────────────────────────────────────────────────────────────────

const IMPRESSUM = 'annee: 2026\nisbn-print: "978-0-00"\nlicence: cc-by-4.0\nimpressum:\n'
  + '  logo-soutien: logos/soutien.png\n  logo-soutien-alt: "Logo der Stiftung"\n'
  + '  soutien: "Mit Unterstützung der Stiftung."\n  credits: "Layout: A//Lektorat: B"\n'
  + '  responsabilite: oui\n  reserve: "Alle Rechte vorbehalten."\n  imprimeur: "Druck: C"\n'
  + '  logos-imprimeur: [logos/a.png, logos/b.png]\n';
const LOGOS = { 'logos/soutien.png': PNG, 'logos/a.png': PNG, 'logos/b.png': PNG };

test('impressum : les blocs dans l’ordre des livres publiés', { skip: sansPython }, () => {
  const r = livre(buch(IMPRESSUM, 'impressum, sommaire'), { fichiers: LOGOS });
  assert.strictEqual(r.status, 0, r.stderr);
  const s = /<section class="szh-liminaire szh-impressum">[\s\S]*?<\/section>/.exec(r.html)[0];
  const ordre = ['© 2026<br>Edition SZH/CSPS', 'Stiftung Schweizer Zentrum', 'class="szh-impressum-logo"',
    'Mit Unterstützung', 'Layout: A<br>Lektorat: B', 'ISBN Print on demand: 978-0-00',
    'Die Verantwortung für den Inhalt der Texte liegt bei den jeweiligen Autor:innen.',
    'Dieses Werk ist lizenziert', 'Alle Rechte vorbehalten.', 'Druck: C', 'class="szh-impressum-logos-imprimeur"'];
  const positions = ordre.map((t) => s.indexOf(t));
  assert.ok(positions.every((p) => p >= 0), ordre.filter((t, i) => positions[i] < 0).join(' | ') + '\n' + s);
  assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b), s);
});

test('impressum : alt de <clé>-alt, vide sinon ; deux logos d’imprimeur sur une rangée', { skip: sansPython }, () => {
  const r = livre(buch(IMPRESSUM, 'impressum'), { fichiers: LOGOS });
  assert.match(r.html, /<p class="szh-impressum-logo"><img class="szh-impressum-image" src="data:image\/png;base64,[^"]+" alt="Logo der Stiftung" \/><\/p>/);
  const rangee = /<p class="szh-impressum-logos-imprimeur">([\s\S]*?)<\/p>/.exec(r.html)[1];
  assert.strictEqual((rangee.match(/<span class="szh-decor-livre szh-impressum-image" role="presentation"/g) || []).length, 2, rangee);
  assert.doesNotMatch(rangee, /<img/, rangee);
});

test('impressum : sans le bloc, les mentions fixes seules, l’année et l’éditeur en un bloc ; le FALC inchangé', { skip: sansPython }, () => {
  const r = livre(buch('annee: 2026\n', 'impressum'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.html, /<section class="szh-liminaire szh-impressum"><p>© 2026<br>Edition SZH\/CSPS<\/p>\n<p>Stiftung/);
  const falc = livre(buch('annee: 2026\n', 'impressum').replace('maquette: normal', 'maquette: falc'));
  assert.match(falc.html, /<section class="szh-liminaire szh-impressum"><p>© 2026<\/p>\n<p>Edition SZH\/CSPS<\/p>\n<p>Stiftung/);
  assert.doesNotMatch(r.html, /Verantwortung|szh-impressum-image/);
  exigerRefus(livre(buch('impressum:\n  druckerei: "X"\n', 'impressum')), 'impressum-cle-inconnue', 'impressum.druckerei');
  exigerRefus(livre(buch('impressum:\n  logo-soutien: fehlt.png\n', 'impressum')), 'fichier-introuvable', 'impressum.logo-soutien');
});

test('impressum : les ISBN et le DOI en un seul bloc ; le FALC garde un bloc chacun', { skip: sansPython }, () => {
  const ids = 'isbn-print: "978-0-00"\nisbn-ebook: "978-0-01"\ndoi: "10.0/x"\n';
  const r = livre(buch(ids, 'impressum'));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.html, /<p>ISBN Print on demand: 978-0-00<br>ISBN E-Book: 978-0-01<br>https:\/\/doi\.org\/10\.0\/x<\/p>/);
  const falc = livre(buch(ids, 'impressum').replace('maquette: normal', 'maquette: falc'));
  assert.match(falc.html, /<p>ISBN Print on demand: 978-0-00<\/p>\n<p>ISBN E-Book: 978-0-01<\/p>\n<p>https:\/\/doi\.org\/10\.0\/x<\/p>/);
});

test('impressum : logo-soutien-hauteur-mm règle la hauteur du logo de soutien, refusée hors bornes', { skip: sansPython }, () => {
  for (const [brut, attendu] of [['8.7', '8.7mm'], ['8,7', '8.7mm'], ['12', '12mm'], ['"4"', '4mm'], ['30', '30mm']]) {
    const r = livre(buch(IMPRESSUM + '  logo-soutien-hauteur-mm: ' + brut + '\n', 'impressum'), { fichiers: LOGOS });
    assert.strictEqual(r.status, 0, brut + ' : ' + r.stderr);
    assert.match(r.html, new RegExp('<section class="szh-liminaire szh-impressum" style="--impressum-logo-soutien: '
      + attendu.replace('.', '\\.') + '">'), brut);
  }
  // Sans la clé, aucun style : la hauteur de normal.css.
  const sans = livre(buch(IMPRESSUM, 'impressum'), { fichiers: LOGOS });
  assert.match(sans.html, /<section class="szh-liminaire szh-impressum"><p>/);
  for (const brut of ['3', '31', 'gross', '8mm', '-5']) {
    exigerRefus(livre(buch(IMPRESSUM + '  logo-soutien-hauteur-mm: ' + brut + '\n', 'impressum'), { fichiers: LOGOS }),
      'impressum-valeur-mm', 'impressum.logo-soutien-hauteur-mm');
  }
});

// ── Page de titre et demi-titre ───────────────────────────────────────────────────────

test('page de titre (logo-page-titre) : le logo de l’éditeur par défaut, alt vide ; non le retire', { skip: sansPython }, () => {
  const oui = livre(buch('', 'page-titre'));
  assert.strictEqual(oui.status, 0, oui.stderr);
  assert.match(oui.html, /<p class="szh-logo-editeur"><span class="szh-decor-livre szh-logo-editeur-image" role="presentation" style="--ratio: 0\.3904"><span style="background-image: url\(&quot;data:image\/svg\+xml;base64,[^&]+&quot;\)"><\/span><\/span><\/p><\/section>/);
  assert.match(oui.html, / data-logo-page-titre="oui"/);
  const non = livre(buch(bloc({ 'logo-page-titre': 'non' }), 'page-titre'));
  assert.strictEqual(non.status, 0, non.stderr);
  assert.doesNotMatch(non.html, /szh-logo-editeur/);
});

test('éditeurs : en ouvrage collectif, demi-titre et page de titre portent les éditeurs et (Hrsg.)', { skip: sansPython }, () => {
  const editeurs = 'ouvrage: collectif\nauteurs: []\nediteurs:\n- prenom: "Mira"\n  nom: "Beispiel"\n'
    + '- prenom: "Jonas"\n  nom: "Muster"\n';
  const de = livre(buch(editeurs, 'demi-titre, page-titre'));
  assert.strictEqual(de.status, 0, de.stderr);
  assert.strictEqual((de.html.match(/<p class="szh-auteurs">Mira Beispiel und Jonas Muster \(Hrsg\.\)<\/p>/g) || []).length, 2, de.html);
  const fr = livre(buch(editeurs, 'demi-titre').replace('lang: de', 'lang: fr'));
  assert.match(fr.html, /<p class="szh-auteurs">Mira Beispiel et Jonas Muster \(éd\.\)<\/p>/);
  const mono = livre(buch('ouvrage: monographie\nauteurs:\n- prenom: "Lea"\n  nom: "Probe"\n', 'demi-titre'));
  assert.match(mono.html, /<p class="szh-auteurs">Lea Probe<\/p>/);
  const falc = livre(buch(editeurs, 'demi-titre').replace('maquette: normal', 'maquette: falc'));
  assert.match(falc.html, /<p class="szh-auteurs"><\/p>/, 'le FALC change de demi-titre');
});

// ── Lecteur YAML : une liste en ligne dans un item ou un sous-bloc ────────────────────

test('lire_yaml : « chapitres: [a, b] » dans un item de liste et dans un sous-bloc rend une liste', { skip: sansPython }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-yaml-'));
  try {
    const y = path.join(d, 'buch.yaml');
    fs.writeFileSync(y, 'parties:\n- titre: "A"\n  chapitres: [01-a, "02-b"]\n- chapitres: [03-c]\n  titre: B\n'
      + 'impressum:\n  logos-imprimeur: [x.png, y.png]\n  imprimeur: "[pas une liste"\n', 'utf8');
    const script = path.join(d, 'lire.py');
    fs.writeFileSync(script, 'import json, sys\nsys.path.insert(0, sys.argv[1])\nimport szh_commun\n'
      + 'print(json.dumps(szh_commun.lire_yaml(sys.argv[2])))\n', 'utf8');
    const r = gardes.pythonGroupe([script, path.join(RACINE, 'pipeline'), y], ENV);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), {
      parties: [{ titre: 'A', chapitres: ['01-a', '02-b'] }, { chapitres: ['03-c'], titre: 'B' }],
      impressum: { 'logos-imprimeur': ['x.png', 'y.png'], imprimeur: '[pas une liste' },
    });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
