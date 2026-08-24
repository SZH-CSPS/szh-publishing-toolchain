// Le format à codes du journal de compilation : ce que l'interface reconnaît d'un message
// du pipeline, et ce qu'elle ne reconnaît plus.
//
//   node --test test/js
//
// Le défaut corrigé ici n'était pas un bogue, c'était une bombe à retardement. Deux filtres
// écrivaient de la prose — szh-maquette.lua dans la seule langue du numéro,
// szh-citations.lua en français seulement — et lib/journal.js reconnaissait leurs PHRASES,
// dans les deux langues, pour pouvoir les redire dans celle du cockpit. Reformuler un
// message du pipeline, ne serait-ce qu'en déplaçant un mot, coupait la remontée à l'écran :
// l'avertissement continuait de partir, plus rien ne l'affichait, et aucun test ne le
// voyait venir. szh-citations.lua, en plus, ne nommait pas son article : le cockpit le
// prenait sur la ligne « pandoc articles/<slug>/… » qui précédait, ce qui marche par
// hasard, parce que la chaîne est séquentielle.
//
// Les deux filtres écrivent désormais le format à codes, celui de « [import-avertissement] » :
//
//   [<source>-<ton>] <code> | <champ> | … | <phrase fr> | [de] <Satz de>
//
// Ce fichier prouve les trois choses qui en découlent :
//   1. une reformulation de la prose du pipeline ne change RIEN à l'écran ;
//   2. un avertissement nomme son article, et le journal peut être dans n'importe quel ordre ;
//   3. un blocage reste un blocage — la compilation s'arrête, avec son code de sortie.
//
// Le point 3 fait réellement tourner pandoc dans la WSL. S'il est introuvable, le contrôle
// est déclaré non fait plutôt que vert ; SZH_LUA_OBLIGATOIRE=1 en fait un échec, ce qu'une
// CI doit faire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const journal = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'journal.js'));
const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
const { cheminVersWsl } = require(path.join(COCKPIT, 'lib', 'portraits.js'));

const LF = String.fromCharCode(10);
const MAQUETTE = path.join(RACINE, 'pipeline', 'filters', 'szh-maquette.lua');
const CITATIONS = path.join(RACINE, 'pipeline', 'filters', 'szh-citations.lua');
const TRAVAIL = path.join(os.tmpdir(), 'szh-journal-codes');

// Une ligne du format à codes, écrite comme le pipeline l'écrit.
function ligne(prefixe, code, champs, fr, de) {
  return ['[' + prefixe + '] ' + code].concat(champs, [fr, '[de] ' + de]).join(' | ');
}

// Le même journal, avec la prose qu'on veut. C'est tout l'enjeu : les champs et les codes
// sont fixes, les phrases sont libres.
function journalDEssai(prose) {
  const p = (n) => prose + ' — ' + n + '.';
  return [
    'pandoc articles/01-inclusion/01-inclusion.md -> out/01-inclusion/01-inclusion.html',
    ligne('citations-info', 'bilan',
      ['article « 01-inclusion »', 'references 4', 'appels 3', 'lies 1', 'ambigus 1',
       'sansref 1'], p('bilan'), p('Bilanz')),
    ligne('citations-avertissement', 'appel-sans-reference',
      ['article « 01-inclusion »', 'appel « (Shaw et al., 2023) »'], p('orphelin'), p('ohne')),
    ligne('citations-avertissement', 'appel-ambigu',
      ['article « 01-inclusion »', 'appel « (Sen, 2001) »'], p('ambigu'), p('mehrdeutig')),
    ligne('citations-avertissement', 'reference-orpheline',
      ['article « 01-inclusion »', 'reference « Ricœur, P. (1990). Soi-même… »'],
      p('jamais'), p('nie')),
    ligne('citations-avertissement', 'ancrage-inconnu',
      ['article « 01-inclusion »', 'ancrage « #ref-shaw-2023 »'], p('ancrage'), p('Marke')),
    ligne('citations-avertissement', 'caractere-sans-repli',
      ['article « 01-inclusion »', 'caractere « Ş »', 'point U+015E'], p('repli'), p('Ersatz')),
    ligne('meta-avertissement', 'sans-langue', ['article « 02-ecole »'], p('langue'), p('Sprache')),
    ligne('meta-blocage', 'champ-vide',
      ['article « 02-ecole »', 'champ « title »', 'langue « de »'], p('vide'), p('leer')),
    ligne('meta-blocage', 'marque-champ',
      ['article « 02-ecole »', 'champ « subtitle »', 'langue « fr »'], p('marque'), p('Marke')),
    ligne('meta-blocage', 'marque-motcle',
      ['article « 02-ecole »', 'motcle 3', 'langue « it »'], p('motcle'), p('Schlagwort')),
    ligne('meta-blocage', 'langue-inconnue',
      ['article « 02-ecole »', 'langue « xx »'], p('inconnue'), p('unbekannt'))
  ].join(LF) + LF;
}

const cles = (constats) => constats.map((c) => c.source + '/' + c.code);
const sansProse = (constats) => constats.map(
  (c) => ({ source: c.source, code: c.code, ton: c.ton, slug: c.slug, cle: c.cle, args: c.args }));

// ---- 1. Le cœur : une reformulation ne casse rien ----

test('codes : reformuler un message du pipeline ne change rien à l’écran', () => {
  // Deux versions du MÊME journal, dont toutes les phrases ont été réécrites — jusqu'à ne
  // plus rien vouloir dire. C'est exactement ce qu'un correctif de style fait à un filtre.
  const avant = journal.analyserJournal(journalDEssai('Première rédaction du message'), 'fr');
  const apres = journal.analyserJournal(journalDEssai('Ganz anders umformuliert'), 'fr');

  assert.deepStrictEqual(cles(avant), [
    'citations/bilan', 'citations/appel-sans-reference', 'citations/appel-ambigu',
    'citations/reference-orpheline', 'citations/ancrage-inconnu',
    'citations/caractere-sans-repli', 'meta/sans-langue', 'meta/champ-vide',
    'meta/marque-champ', 'meta/marque-motcle', 'meta/langue-inconnue'
  ], 'un cas du pipeline n’arrive plus');
  // Tout ce qui compte est identique : la source, le code, le ton, l'article, la clé
  // d'i18n et ses substitutions. Seule la prose du pipeline diffère, et elle ne sert plus.
  assert.deepStrictEqual(sansProse(apres), sansProse(avant),
    'la reformulation a changé un constat : la remontée dépend encore des phrases');
  // Et les phrases affichées, elles, ne bougent pas d'un caractère : elles viennent de la
  // maison, dans les deux langues.
  for (const langue of ['fr', 'de']) {
    const a = journal.analyserJournal(journalDEssai('Première rédaction du message'), langue);
    const b = journal.analyserJournal(journalDEssai('Ganz anders umformuliert'), langue);
    assert.deepStrictEqual(b.map((c) => journal.phraseConstat(c, langue)),
      a.map((c) => journal.phraseConstat(c, langue)),
      'la phrase à l’écran (' + langue + ') suit la prose du pipeline');
    // La prose du pipeline n'arrive nulle part : ni la version d'avant, ni celle d'après.
    const tout = b.map((c) => journal.phraseConstat(c, langue)).join(' | ');
    assert.ok(tout.indexOf('umformuliert') === -1, 'la prose du pipeline est affichée telle quelle');
    assert.ok(tout.indexOf('[de]') === -1, 'la moitié allemande a suivi');
  }
});

test('codes : la prose des deux filtres n’est plus reconnue du tout', () => {
  // Les phrases d'avant, mot pour mot. Aucune ne doit produire son ancien constat : c'est
  // le code, désormais, qui porte l'information. Le repli générique les montre brutes —
  // c'est voulu, un journal d'hier ne doit pas devenir muet — mais sous « autre », sans
  // clé d'i18n et sans prétendre savoir de quoi il parle.
  const ancien = [
    'pandoc articles/01-inclusion/01-inclusion.md -> out/01-inclusion/01-inclusion.html',
    '[citations] ⚠ appel sans référence : (Shaw et al., 2023)',
    '[citations] ⚠ appel ambigu, à lier à la main : (Sen, 2001)',
    '[citations] ⚠ référence jamais appelée : Ricœur, P. (1990).…',
    "[szh] Article « 02-ecole » : la langue déclarée est l'allemand, mais title.de est vide.",
    '[szh] Artikel « 02-ecole »: das Schlagwort Nr. 3 von keywords.it steht noch auf der Marke « TO BE TRANSLATED ».'
  ].join(LF) + LF;
  const constats = journal.analyserJournal(ancien, 'fr');
  for (const c of constats) {
    assert.strictEqual(c.code, 'autre', 'une phrase est encore reconnue : ' + c.code);
    assert.strictEqual(c.cle, '', 'une phrase mène encore à une clé d’i18n');
  }
  // Et le module ne porte plus un seul motif de phrase de ces deux filtres.
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'journal.js'), 'utf8');
  for (const bout of ['est resté sur la marque', 'steht noch auf der Marke', 'est vide',
    'ist leer', 'appel sans référence', 'appel ambigu', 'référence jamais appelée',
    'aucune langue déclarée', 'keine Sprache', 'caractère sans repli',
    'lien manuel vers un ancrage', 'mot-clé n°', 'Schlagwort Nr']) {
    assert.ok(src.indexOf(bout) === -1,
      'lib/journal.js reconnaît encore la phrase « ' + bout + ' »');
  }
});

test('codes : une source neuve arrive sans qu’on soit repassé dans le module', () => {
  // Le format se généralise : « <source>-<ton> ». Un émetteur qui n'existe pas encore
  // remonte avec le ton de son préfixe et sa propre phrase, dans la bonne langue.
  const neuf = ligne('galley-avertissement', 'note-perdue', ['article « 03-autre »'],
    'Une note de bas de page n’a pas suivi.', 'Eine Fussnote ist nicht mitgekommen.');
  const fr = journal.analyserJournal(neuf, 'fr');
  assert.strictEqual(fr.length, 1);
  assert.strictEqual(fr[0].source, 'galley');
  assert.strictEqual(fr[0].code, 'note-perdue');
  assert.strictEqual(fr[0].ton, 'attention');
  assert.strictEqual(fr[0].slug, '03-autre');
  assert.strictEqual(journal.phraseConstat(fr[0], 'fr'), 'Une note de bas de page n’a pas suivi.');
  const de = journal.analyserJournal(neuf, 'de');
  assert.strictEqual(journal.phraseConstat(de[0], 'de'), 'Eine Fussnote ist nicht mitgekommen.');
  // Le ton vient du préfixe, et de rien d'autre : trois tons, trois préfixes.
  const tons = {};
  for (const t of ['blocage', 'avertissement', 'info']) {
    const c = journal.analyserJournal(
      ligne('galley-' + t, 'x', ['article « 03-autre »'], 'Fr.', 'De.'), 'fr');
    tons[t] = c[0].ton;
  }
  assert.deepStrictEqual(tons, { blocage: 'danger', avertissement: 'attention', info: 'info' });
  // Un quatrième ton n'existe pas : la ligne n'est pas du format, et ne passe que si elle
  // se plaint (règle du silence par défaut).
  assert.deepStrictEqual(
    journal.analyserJournal(ligne('galley-remarque', 'x', [], 'Fr.', 'De.'), 'fr'), []);
});

// ---- 2. L'article est nommé, et l'ordre du journal n'y fait rien ----

test('codes : un avertissement nomme son article, journal en désordre compris', () => {
  // Ce que « make -j » produira : les lignes de deux articles mêlées, et une ligne de
  // contexte pandoc qui parle d'un TROISIÈME. L'ancien module attribuait tout à celui-là.
  const desordre = [
    'pandoc articles/99-editorial/99-editorial.md -> out/99-editorial/99-editorial.html',
    ligne('citations-avertissement', 'appel-sans-reference',
      ['article « 01-inclusion »', 'appel « (Shaw et al., 2023) »'], 'Fr 1.', 'De 1.'),
    ligne('meta-avertissement', 'sans-langue', ['article « 02-ecole »'], 'Fr 2.', 'De 2.'),
    ligne('citations-avertissement', 'appel-ambigu',
      ['article « 02-ecole »', 'appel « (Sen, 2001) »'], 'Fr 3.', 'De 3.'),
    ligne('citations-avertissement', 'appel-sans-reference',
      ['article « 99-editorial »', 'appel « (Kunz, 2016) »'], 'Fr 4.', 'De 4.')
  ].join(LF) + LF;
  assert.deepStrictEqual(
    journal.analyserJournal(desordre, 'fr').map((c) => c.slug),
    ['01-inclusion', '02-ecole', '02-ecole', '99-editorial'],
    'un avertissement est attribué au mauvais article');

  // Et sans aucune ligne de contexte : chaque constat se suffit à lui-même.
  const seules = desordre.split(LF).filter((l) => l.indexOf('pandoc ') !== 0).join(LF);
  assert.deepStrictEqual(
    journal.analyserJournal(seules, 'fr').map((c) => c.slug),
    ['01-inclusion', '02-ecole', '02-ecole', '99-editorial'],
    'un constat a perdu son article faute de ligne de contexte');

  // Deux articles, le même code, la même clé : ce sont deux constats, pas un dédoublonné.
  const deux = journal.analyserJournal(desordre, 'fr')
    .filter((c) => c.code === 'appel-sans-reference');
  assert.strictEqual(deux.length, 2);
});

test('codes : les champs sont nommés, donc leur ordre est libre', () => {
  // Le pipeline peut ajouter un champ ou les écrire dans un autre ordre : les
  // substitutions de la phrase se prennent au nom, jamais à la position.
  const ordre = journal.analyserJournal(ligne('meta-blocage', 'champ-vide',
    ['article « 02-ecole »', 'champ « resume »', 'langue « de »'], 'Fr.', 'De.'), 'fr')[0];
  const desordre = journal.analyserJournal(ligne('meta-blocage', 'champ-vide',
    ['langue « de »', 'champ « resume »', 'tables/table-02.html', 'article « 02-ecole »'],
    'Fr.', 'De.'), 'fr')[0];
  assert.deepStrictEqual(desordre, ordre, 'l’ordre des champs change le constat');
  // Le champ et la langue sortent avec leur nom de formulaire, pas leur clé YAML.
  const phrase = journal.phraseConstat(ordre, 'fr');
  assert.ok(phrase.indexOf('Résumé') !== -1, 'le champ est nommé par sa clé YAML : ' + phrase);
  assert.ok(phrase.indexOf('allemand') !== -1, 'la langue est nommée par son jeton : ' + phrase);
});

// ---- 3. Les filtres, pour de vrai : le blocage reste un blocage ----

function wsl(args) {
  return spawnSync(cheminWsl(), ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

let pandocVu = null;

function pandocAbsent() {
  if (pandocVu !== null) { return pandocVu; }
  let r;
  try { r = wsl(['sh', '-c', 'command -v pandoc']); }
  catch (e) { pandocVu = 'wsl.exe injoignable : ' + e.message; return pandocVu; }
  if (r.error) { pandocVu = 'wsl.exe injoignable : ' + r.error.message; }
  else if (r.status !== 0) { pandocVu = 'pandoc introuvable dans la distro ' + DISTRO; }
  else { pandocVu = null; }
  return pandocVu;
}

// Saut bruyant : le contrôle n'est pas vert, il est déclaré non fait.
function sauterSansLua(t, raison) {
  const msg = 'Filtres non exécutés : ' + raison;
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail(msg); }
  console.warn('\n*** ' + msg + ' — les blocages du pipeline ne sont PAS vérifiés ***\n');
  t.skip(msg);
}

// Compile un article factice avec un filtre, depuis son dossier : szh-maquette.lua relit
// « <slug>.meta.yaml » dans le répertoire courant, comme le fait le Makefile.
function compiler(nom, filtre, fiche, corps) {
  const dossier = path.join(TRAVAIL, nom);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'essai.md'), corps, 'utf8');
  if (fiche !== null) { fs.writeFileSync(path.join(dossier, 'essai.meta.yaml'), fiche, 'utf8'); }
  const r = wsl(['sh', '-c', 'cd ' + JSON.stringify(cheminVersWsl(dossier))
    + ' && pandoc essai.md --lua-filter=' + JSON.stringify(cheminVersWsl(filtre))
    + ' -t html -o /dev/null']);
  assert.ok(!r.error, 'pandoc injoignable : ' + (r.error && r.error.message));
  return { code: r.status, err: String(r.stderr) };
}

test('filtres : un champ porteur vide arrête la compilation, et le dit par son code', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  // Article déclaré en allemand, titre saisi en français seulement : rien ne s'imprimerait
  // à cette place, et le PDF s'annoncerait conforme.
  const r = compiler('champ-vide', MAQUETTE, 'lang: de\n',
    '---\ntitle:\n  fr: "Un titre français"\n---\n\nUn corps.\n');
  assert.notStrictEqual(r.code, 0, 'la compilation a continué : le blocage ne bloque plus');
  assert.match(r.err, /^\[meta-blocage\] champ-vide \|/m, 'pas de constat codé : ' + r.err);
  // Le constat de la vraie sortie traverse le module : code, ton, article, phrase.
  const c = journal.analyserJournal(r.err, 'fr')[0];
  assert.strictEqual(c.code, 'champ-vide');
  assert.strictEqual(c.ton, 'danger');
  assert.strictEqual(c.slug, 'essai');
  assert.match(journal.phraseConstat(c, 'fr'), /^Cet article est déclaré en allemand/);
  assert.match(journal.phraseConstat(journal.analyserJournal(r.err, 'de')[0], 'de'),
    /^Dieser Artikel ist auf Deutsch deklariert/);
});

test('filtres : la marque de traduction arrête la compilation, elle aussi', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const r = compiler('marque', MAQUETTE, 'lang: fr\n',
    '---\ntitle:\n  fr: "Un titre"\nkeywords:\n  fr:\n  - "inclusion"\n'
    + '  - "TO BE TRANSLATED"\n---\n\nUn corps.\n');
  assert.notStrictEqual(r.code, 0, 'la marque « TO BE TRANSLATED » ne bloque plus');
  assert.match(r.err, /^\[meta-blocage\] marque-motcle \|/m, 'pas de constat codé : ' + r.err);
  const c = journal.analyserJournal(r.err, 'fr')[0];
  assert.strictEqual(c.ton, 'danger');
  assert.deepStrictEqual(c.args, ['2', 'français'], 'le rang du mot-clé s’est perdu');
});

test('filtres : une fiche sans langue avertit, et laisse la compilation finir', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const r = compiler('sans-langue', MAQUETTE, null,
    '---\ntitle:\n  fr: "Un titre"\n---\n\nUn corps.\n');
  assert.strictEqual(r.code, 0, 'un avertissement a arrêté la compilation : ' + r.err);
  assert.match(r.err, /^\[meta-avertissement\] sans-langue \|/m, 'pas de constat codé : ' + r.err);
  const c = journal.analyserJournal(r.err, 'fr')[0];
  assert.strictEqual(c.ton, 'attention', 'un avertissement se présente comme un échec');
  assert.strictEqual(c.slug, 'essai');
});

test('filtres : un appel de citation boiteux nomme son article de lui-même', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const r = compiler('citations', CITATIONS, null,
    'Un appel (Shaw et al., 2023) qui ne mène nulle part.\n\n'
    + '# Bibliographie\n\nBovey, L. (2022). Un titre. Editions SZH.\n');
  assert.strictEqual(r.code, 0, 'un avertissement de citation a arrêté la compilation');
  // Aucune ligne de contexte n'est passée : l'article vient du filtre, et de lui seul.
  const constats = journal.analyserJournal(r.err, 'fr');
  const orphelin = constats.find((c) => c.code === 'appel-sans-reference');
  assert.ok(orphelin, 'l’appel sans référence n’arrive pas : ' + r.err);
  assert.strictEqual(orphelin.slug, 'essai');
  assert.strictEqual(orphelin.ton, 'attention');
  assert.match(journal.phraseConstat(orphelin, 'fr'), /^L’appel \(Shaw et al\., 2023\)/);
  // Le message le plus vu de la chaîne (~27 % des appels du corpus) porte son geste.
  assert.match(journal.phraseConstat(orphelin, 'fr'), /Ajoutez la référence/);
  assert.match(journal.phraseConstat(orphelin, 'de'), /^Der Zitatverweis/);
});
