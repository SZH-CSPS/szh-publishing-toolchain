// Le format à codes du journal de compilation : ce que l'interface reconnaît d'un message
// du pipeline.
//
//   node --test test/js
//
// Les filtres écrivent leurs constats dans ce format :
//
//   [<source>-<ton>] <code> | <champ> | … | <phrase fr> | [de] <Satz de>
//
// lib/journal.js lit le code et les champs, jamais la phrase : l'interface affiche ses
// propres textes, dans la langue du cockpit. Ce fichier vérifie que :
//   1. une reformulation de la prose du pipeline ne change rien à l'écran ;
//   2. un avertissement nomme son article, quel que soit l'ordre du journal ;
//   3. un blocage arrête la compilation, avec son code de sortie.
//
// Le point 3 fait tourner pandoc dans la WSL. S'il est introuvable, le contrôle est
// déclaré non fait ; SZH_WSL_OBLIGATOIRE en fait un échec, comme en CI.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { chargerAvecVscodeFactice } = require('./dom-minimal');
const { sauter, sansPandocWsl } = require('./gardes');

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

// Le même journal, avec la prose qu'on veut : les champs et les codes sont fixes, les
// phrases libres.
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
  // Deux versions du même journal, dont toutes les phrases ont été réécrites, jusqu'à ne
  // plus rien vouloir dire.
  const avant = journal.analyserJournal(journalDEssai('Première rédaction du message'), 'fr');
  const apres = journal.analyserJournal(journalDEssai('Ganz anders umformuliert'), 'fr');

  assert.deepStrictEqual(cles(avant), [
    'citations/bilan', 'citations/appel-sans-reference', 'citations/appel-ambigu',
    'citations/reference-orpheline', 'citations/ancrage-inconnu',
    'citations/caractere-sans-repli', 'meta/sans-langue', 'meta/champ-vide',
    'meta/marque-champ', 'meta/marque-motcle', 'meta/langue-inconnue'
  ], 'un cas du pipeline n’arrive plus');
  // La source, le code, le ton, l'article, la clé d'i18n et ses substitutions sont
  // identiques. Seule la prose du pipeline diffère, et elle ne sert pas.
  assert.deepStrictEqual(sansProse(apres), sansProse(avant),
    'la reformulation a changé un constat : la remontée dépend encore des phrases');
  // Les phrases affichées ne bougent pas d'un caractère : elles viennent de i18n.js, dans
  // les deux langues.
  for (const langue of ['fr', 'de']) {
    const a = journal.analyserJournal(journalDEssai('Première rédaction du message'), langue);
    const b = journal.analyserJournal(journalDEssai('Ganz anders umformuliert'), langue);
    assert.deepStrictEqual(b.map((c) => journal.phraseConstat(c, langue)),
      a.map((c) => journal.phraseConstat(c, langue)),
      'la phrase à l’écran (' + langue + ') suit la prose du pipeline');
    // La prose du pipeline n'apparaît pas à l'écran, dans aucune des deux versions.
    const tout = b.map((c) => journal.phraseConstat(c, langue)).join(' | ');
    assert.ok(tout.indexOf('umformuliert') === -1, 'la prose du pipeline est affichée telle quelle');
    assert.ok(tout.indexOf('[de]') === -1, 'la moitié allemande a suivi');
  }
});

test('codes : la prose des deux filtres n’est plus reconnue du tout', () => {
  // Des phrases en prose, sans code. Aucune ne produit de constat reconnu : c'est le code
  // qui porte l'information. Le repli générique les montre brutes, sous « autre », sans
  // clé d'i18n, pour qu'un ancien journal ne devienne pas muet.
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
  // Le module ne contient aucun motif de phrase de ces deux filtres.
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
  // Le format est général (« <source>-<ton> ») : un émetteur inconnu remonte avec le ton
  // de son préfixe et sa propre phrase, dans la bonne langue.
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
  // Le ton vient du préfixe seul : trois tons, trois préfixes.
  const tons = {};
  for (const t of ['blocage', 'avertissement', 'info']) {
    const c = journal.analyserJournal(
      ligne('galley-' + t, 'x', ['article « 03-autre »'], 'Fr.', 'De.'), 'fr');
    tons[t] = c[0].ton;
  }
  assert.deepStrictEqual(tons, { blocage: 'danger', avertissement: 'attention', info: 'info' });
  // Un quatrième ton n'existe pas : la ligne n'est pas du format, et ne s'affiche que si
  // elle signale un problème (silence par défaut).
  assert.deepStrictEqual(
    journal.analyserJournal(ligne('galley-remarque', 'x', [], 'Fr.', 'De.'), 'fr'), []);
});

// ---- 2. L'article est nommé, et l'ordre du journal n'y fait rien ----

test('codes : un avertissement nomme son article, journal en désordre compris', () => {
  // Ce que produit « make -j » : les lignes de deux articles mêlées, et une ligne de
  // contexte pandoc qui parle d'un troisième, à qui rien ne doit être attribué.
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

  // Sans ligne de contexte : chaque constat se suffit à lui-même.
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

// ---- 2 bis. Le livre : source « livre », trois codes, et « chapitre » = « article » ----
//
// Les unités d'un livre sont des chapitres : pipeline/livre-assembler.py
// (liminaire-introuvable) et pipeline/profils/livre.mk (chapitre-ecarte,
// chapitre-introuvable) nomment leur champ « chapitre ». lib/journal.js le lit comme
// « article », pour que la carte ait un slug à ouvrir.

test('codes : la source « livre » est reconnue, avec ses trois codes et leurs tons', () => {
  const blocage = journal.analyserJournal(ligne('livre-blocage', 'liminaire-introuvable',
    ['pièce « demi-titre.md »'], 'Fr.', 'De.'), 'fr')[0];
  assert.strictEqual(blocage.source, 'livre');
  assert.strictEqual(blocage.ton, 'danger');
  assert.notStrictEqual(blocage.cle, '', 'liminaire-introuvable n’a pas de clé d’i18n maison');

  const ecarte = journal.analyserJournal(ligne('livre-avertissement', 'chapitre-ecarte',
    ['chapitre « _brouillon »'], 'Fr.', 'De.'), 'fr')[0];
  assert.strictEqual(ecarte.ton, 'attention');
  assert.strictEqual(ecarte.slug, '_brouillon',
    'le champ « chapitre » doit nommer l’unité, comme le fait « article » ailleurs');
  assert.notStrictEqual(ecarte.cle, '');

  const introuvable = journal.analyserJournal(ligne('livre-avertissement', 'chapitre-introuvable',
    ['chapitre « 05-conclusion »'], 'Fr.', 'De.'), 'fr')[0];
  assert.strictEqual(introuvable.ton, 'attention');
  assert.strictEqual(introuvable.slug, '05-conclusion');
  assert.notStrictEqual(introuvable.cle, '');
});

test('codes : les trois codes du livre ont une phrase maison, en français et en allemand', () => {
  for (const [code, champ, valeur] of [
    ['liminaire-introuvable', 'pièce', 'demi-titre.md'],
    ['chapitre-ecarte', 'chapitre', '_brouillon'],
    ['chapitre-introuvable', 'chapitre', '05-conclusion']
  ]) {
    const prefixe = code === 'liminaire-introuvable' ? 'livre-blocage' : 'livre-avertissement';
    const l = ligne(prefixe, code, [champ + ' « ' + valeur + ' »'],
      'Prose française oubliable.', 'Vergessliche deutsche Prosa.');
    for (const langue of ['fr', 'de']) {
      const c = journal.analyserJournal(l, langue)[0];
      const phrase = journal.phraseConstat(c, langue);
      assert.ok(phrase.indexOf(valeur) !== -1,
        code + ' (' + langue + ') ne substitue pas ' + champ + ' dans sa phrase : ' + phrase);
      assert.ok(phrase.indexOf('oubliable') === -1 && phrase.indexOf('Vergessliche') === -1,
        code + ' (' + langue + ') affiche encore la prose du pipeline au lieu de la sienne');
    }
  }
});

// Sur les lignes réelles du pipeline (pipeline/livre-assembler.py et
// pipeline/profils/livre.mk).
test('codes : les trois lignes réelles du pipeline pour le livre sont reconnues', () => {
  const reelles = [
    '[livre-blocage] liminaire-introuvable | pièce « demi-titre » | '
      + "La pièce liminaire « demi-titre » est annoncée dans buch.yaml (liminaires:) mais "
      + "n'a pas été compilée : out/liminaires/demi-titre.html est introuvable. Vérifiez "
      + "qu'elle existe dans liminaires/, puis relancez la compilation. | "
      + '[de] Das im buch.yaml angekündigte Vorsatzstück « demi-titre » (liminaires:) wurde '
      + 'nicht kompiliert: out/liminaires/demi-titre.html fehlt. Prüfen Sie, ob es in '
      + 'liminaires/ liegt, und kompilieren Sie danach neu.',
    "[livre-avertissement] chapitre-ecarte | chapitre « _brouillon » | Ce dossier n'est pas "
      + "imprimé : un dossier préfixé « _ » est une pièce de travail, à relire et à "
      + "replacer. Retirez le « _ » pour en faire un chapitre. | [de] Dieser Ordner wird "
      + 'nicht gedruckt: ein Ordner mit Präfix « _ » ist ein Arbeitsstück. Entfernen Sie das '
      + '« _ », um daraus ein Kapitel zu machen.',
    '[livre-avertissement] chapitre-introuvable | chapitre « 05-conclusion » | Ce chapitre '
      + 'est listé dans ordre-chapitres mais introuvable dans chapitres/ : vérifiez le nom '
      + 'du dossier, ou retirez-le de la liste. | [de] Dieses Kapitel steht in '
      + 'ordre-chapitres, wurde aber in chapitres/ nicht gefunden: prüfen Sie den '
      + 'Ordnernamen, oder entfernen Sie es aus der Liste.'
  ].join(LF) + LF;
  const constats = journal.analyserJournal(reelles, 'fr');
  assert.deepStrictEqual(constats.map((c) => c.code),
    ['liminaire-introuvable', 'chapitre-ecarte', 'chapitre-introuvable']);
  assert.deepStrictEqual(constats.map((c) => c.ton), ['danger', 'attention', 'attention']);
  assert.deepStrictEqual(constats.map((c) => c.slug), ['', '_brouillon', '05-conclusion']);
  for (const c of constats) { assert.notStrictEqual(c.cle, '', c.code + ' sans clé d’i18n'); }
});

// ---- 2 ter. La numérotation : szh-numerotation.lua, le code « figure-sans-alt » ----
//
// La ligne réelle du filtre, recopiée mot pour mot (test/filtres-pandoc.test.js la fait
// sortir de pandoc, sous SZH_APERCU) : espace fine insécable devant le deux-points en
// français (comme LIBELLE_SOURCE de szh-numerotation.lua), aucune espace en allemand.
const LIGNE_FIGURE_SANS_ALT =
  '[numerotation-avertissement] figure-sans-alt | article « essai » | image « x.png » | '
  + 'L’image x.png n’a ni texte alternatif ni légende : un lecteur '
  + 'd’écran n’en dira rien. | [de] Das Bild x.png hat weder Alternativtext '
  + 'noch Legende: ein Screenreader sagt dazu nichts.';

test('codes : la ligne réelle de szh-numerotation.lua (figure-sans-alt) est reconnue', () => {
  const c = journal.analyserJournal(LIGNE_FIGURE_SANS_ALT, 'fr')[0];
  assert.strictEqual(c.source, 'numerotation');
  assert.strictEqual(c.code, 'figure-sans-alt');
  assert.strictEqual(c.ton, 'attention');
  assert.strictEqual(c.slug, 'essai');
  assert.strictEqual(c.cle, 'ctl.figure.sansalt');
  assert.deepStrictEqual(c.args, ['x.png']);
  // La phrase à l'écran vient de i18n.js (ctl.figure.sansalt), pas de la prose du
  // pipeline recopiée ci-dessus.
  assert.match(journal.phraseConstat(c, 'fr'), /^L’image x\.png n’a ni texte alternatif/);
  const d = journal.analyserJournal(LIGNE_FIGURE_SANS_ALT, 'de')[0];
  assert.match(journal.phraseConstat(d, 'de'), /^Das Bild x\.png hat weder Alternativtext/);
});

test('codes : figure-sans-alt en mode livre nomme le chapitre, pas l’article', () => {
  // Même alias que szh-citations.lua : SZH_LIVRE fait écrire « chapitre « … » » au lieu de
  // « article « … » », et lireConstatCode() accepte l’un ou l’autre pour le slug.
  const ligneChapitre = LIGNE_FIGURE_SANS_ALT.replace('article « essai »', 'chapitre « 03-annexes »');
  const c = journal.analyserJournal(ligneChapitre, 'fr')[0];
  assert.strictEqual(c.source, 'numerotation');
  assert.strictEqual(c.code, 'figure-sans-alt');
  assert.strictEqual(c.slug, '03-annexes');
  assert.strictEqual(c.cle, 'ctl.figure.sansalt');
  assert.deepStrictEqual(c.args, ['x.png']);
});

// La ligne de szh-image-introuvable.lua, telle qu'il l'écrit. Le filtre remplace l'image
// absente par un cadre, si bien que pandoc et WeasyPrint n'en disent rien.
const LIGNE_IMAGE_MANQUANTE =
  '[rendu-avertissement] image-manquante | article « essai » | image « media/x.png » | '
  + 'L’image « x.png » est appelée par le texte mais introuvable sur le disque. '
  + '| [de] Das Bild «x.png» wird im Text aufgerufen, ist aber nicht zu finden.';

test('codes : l’image introuvable du filtre est lue sous rendu/image-manquante, en avertissement', () => {
  const constats = require(path.join(COCKPIT, 'lib', 'constats.js'));
  for (const langue of ['fr', 'de']) {
    const liste = journal.analyserJournal(LIGNE_IMAGE_MANQUANTE, langue);
    assert.strictEqual(liste.length, 1, JSON.stringify(liste));
    const c = liste[0];
    assert.strictEqual(c.source, 'rendu');
    assert.strictEqual(c.code, 'image-manquante');
    assert.strictEqual(c.slug, 'essai');
    assert.strictEqual(c.cle, 'ctl.image.manquante');
    assert.deepStrictEqual(c.args, ['x.png']);
    // Le champ « image » mène la carte au gestionnaire de médias, sur ce fichier.
    assert.strictEqual(c.champs.image, 'media/x.png');
    assert.deepStrictEqual(constats.cible(c), { lieu: 'medias', slug: 'essai', focus: 'x.png' });
    // Un avertissement : la compilation a produit son PDF, avec le cadre.
    assert.strictEqual(constats.gravite(c, {}), 'avert');
    assert.strictEqual(journal.resumeJournal([c]).bloquants, 0);
  }
  // Les messages de pandoc et de WeasyPrint sur une image absente donnent le même constat :
  // un seul à l'écran.
  const mele = journal.analyserJournal('pandoc articles/essai/essai.md -> out/essai/essai.html'
    + LF + LIGNE_IMAGE_MANQUANTE + LF + '[WARNING] Could not fetch resource media/x.png', 'fr');
  assert.strictEqual(mele.filter((c) => c.code === 'image-manquante').length, 1, JSON.stringify(mele));
});

// ---- 3. Les filtres, pour de vrai : le blocage reste un blocage ----

function wsl(args) {
  return spawnSync(cheminWsl(), ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

// Saut bruyant : le contrôle n'est pas vert, il est déclaré non fait.
// SZH_WSL_OBLIGATOIRE via gardes.js en fait un échec au chargement du module.
function sauterSansLua(t, raison) {
  console.warn('\n*** Filtres non exécutés : ' + raison + ' — les blocages du pipeline ne '
    + 'sont PAS vérifiés ***\n');
  sauter.wsl(t);
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
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  // Article déclaré en allemand, titre saisi en français seulement : la place du titre
  // resterait vide.
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
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
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
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  const r = compiler('sans-langue', MAQUETTE, null,
    '---\ntitle:\n  fr: "Un titre"\n---\n\nUn corps.\n');
  assert.strictEqual(r.code, 0, 'un avertissement a arrêté la compilation : ' + r.err);
  assert.match(r.err, /^\[meta-avertissement\] sans-langue \|/m, 'pas de constat codé : ' + r.err);
  const c = journal.analyserJournal(r.err, 'fr')[0];
  assert.strictEqual(c.ton, 'attention', 'un avertissement se présente comme un échec');
  assert.strictEqual(c.slug, 'essai');
});

test('filtres : un appel de citation boiteux nomme son article de lui-même', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
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

// Le journal d'un export qui a validé ses PDF : le verdict « NON conforme, N règle(s) »
// puis les règles une par une. Le résumé n'est gardé que s'il est seul : sinon il
// redirait les règles et compterait une fois de plus dans la barre d'état.
test('journal : le résumé PDF/UA ne double pas les règles qui le suivent', () => {
  const bloc = [
    '[pdf-ua] PDF/UA-1 : 01-inclusion.pdf — NON conforme, 1 règle(s) en échec.',
    '[pdf-ua]   • Le document n’a pas de titre (1 fois)',
    '[pdf-ua]   ISO 14289-1 7.1-9',
    '[pdf-ua] [de] PDF/UA-1: 01-inclusion.pdf — NICHT konform, 1 Regel(n) nicht erfüllt.',
    '[pdf-ua] [de]   • Das Dokument hat keinen Titel (1 Mal)',
    '[pdf-ua] [de]   ISO 14289-1 7.1-9'
  ];
  for (const langue of ['fr', 'de']) {
    const codes = journal.analyserJournal(bloc.join('\n') + '\n', langue)
      .filter((c) => c.source === 'pdfua').map((c) => c.code);
    assert.deepStrictEqual(codes, ['regle'], langue + ' : le résumé est resté à côté de sa règle');
  }
  // Seul (bloc tronqué) : il reste, sinon l'article non conforme disparaîtrait de la liste.
  const seul = journal.analyserJournal(bloc[0] + '\n', 'fr').filter((c) => c.source === 'pdfua');
  assert.deepStrictEqual(seul.map((c) => c.code), ['non-conforme']);
  // Les deux sources réunies (journal d'export + cache PDF/UA) : même règle, par article.
  const reunis = journal.sansResumePdfUaRedondant([
    { source: 'pdfua', code: 'non-conforme', slug: '01-a' },
    { source: 'pdfua', code: 'non-conforme', slug: '02-b' },
    { source: 'pdfua', code: 'regle', slug: '01-a' }
  ]);
  assert.deepStrictEqual(reunis.map((c) => c.code + ':' + c.slug), ['non-conforme:02-b', 'regle:01-a'],
    'le résumé d’un autre article, sans règle, a été emporté');
});
