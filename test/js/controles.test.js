// Les contrôles de la compilation : ce que la chaîne relève, et comment cela arrive à
// l'écran.
//
//   node --test "test/js/*.test.js"
//
// Le défaut corrigé ici est un silence : la chaîne détectait une dizaine de choses et les
// écrivait sur la sortie d'erreur d'un terminal que « reveal: silent » n'ouvre jamais. Un
// silence ne se prouve pas en lisant le code, il se prouve en montrant la phrase à l'écran.
//
// Trois familles de contrôle, du plus pur au plus complet :
//
//   1. lib/journal.js sur de la VRAIE sortie de chaîne. Le corpus ci-dessous n'est pas
//      écrit à la main : il est copié de tmp/controles-essai/.szh-journal.log, produit en
//      lançant la commande exacte de vscodium-user/tasks.json sur un numéro monté pour
//      l'occasion (un appel de citation sans référence, un appel ambigu, une référence
//      jamais appelée, une image absente) et de la porte du Makefile sur un article sans
//      titre. Les lignes « [citations-…] » ont été régénérées telles quelles en relançant
//      szh-citations.lua sur le même article, le jour où le filtre est passé au format à
//      codes. Un motif qui se met à mentir se voit ici.
//   2. La page. Le journal traversé jusqu'aux cartes de media/vue-ensemble.js, réellement
//      exécutée : c'est le seul contrôle qui prouve que la phrase s'affiche.
//   3. L'hôte, réellement activé : un journal sur le disque, la fin d'une tâche, et l'avis
//      qui doit sortir — avec le bon ton, et sans terminal.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');
const { revueDEssai, activerHote, sourceExtensionEtLib } = require('./hote-factice');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const journal = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'journal.js'));

const LF = String.fromCharCode(10);

// ---- Le corpus : sortie réelle de la chaîne, telle que `tee` l'a écrite ----

// Compilation d'un article dont trois appels de citation boitent. Sortie de `make all`,
// code de sortie 0 : rien n'est bloqué, et rien n'est bloquant.
const JOURNAL_CITATIONS = [
  'pandoc articles/01-inclusion/01-inclusion.md -> out/01-inclusion/01-inclusion.html',
  '[citations-info] bilan | article « 01-inclusion » | references 4 | appels 3 | lies 1 | ambigus 1 | sansref 1 | 4 référence(s), 3 appel(s) : 1 lié(s), 1 ambigu(s), 1 sans référence. | [de] 4 Eintrag/Einträge, 3 Verweis(e): 1 verknüpft, 1 mehrdeutig, 1 ohne Eintrag.',
  '[citations-avertissement] appel-sans-reference | article « 01-inclusion » | appel « (Shaw et al., 2023) » | Appel sans référence : (Shaw et al., 2023). | [de] Zitatverweis ohne Eintrag im Verzeichnis: (Shaw et al., 2023).',
  '[citations-avertissement] appel-ambigu | article « 01-inclusion » | appel « (Sen, 2001) » | Appel ambigu, à lier à la main : (Sen, 2001). | [de] Mehrdeutiger Zitatverweis, von Hand zu verknüpfen: (Sen, 2001).',
  '[citations-avertissement] reference-orpheline | article « 01-inclusion » | reference « Ricœur, P. (1990). Soi-même comme un autre. Seuil.… » | Référence jamais appelée : Ricœur, P. (1990). Soi-même comme un autre. Seuil.… | [de] Nie zitierter Eintrag: Ricœur, P. (1990). Soi-même comme un autre. Seuil.…',
  'pandoc articles/01-inclusion/01-inclusion.md -> out/01-inclusion/01-inclusion.apercu.html (aperçu sourcepos)',
  '[citations-info] bilan | article « 01-inclusion » | references 0 | appels 0 | lies 0 | ambigus 0 | sansref 0 | 0 référence(s), 0 appel(s) : 0 lié(s), 0 ambigu(s), 0 sans référence. | [de] 0 Eintrag/Einträge, 0 Verweis(e): 0 verknüpft, 0 mehrdeutig, 0 ohne Eintrag.',
  '[WARNING] This document format requires a nonempty <title> element.',
  "  Defaulting to '01-inclusion' as the title.",
  '  To specify a title, use \'title\' in metadata or --metadata title="...".'
].join(LF) + LF;

// Le même article, sa figure renommée en plus : un document sorti mais impubliable.
const JOURNAL_AVERTISSEMENTS = [
  'pandoc articles/01-inclusion/01-inclusion.md -> out/01-inclusion/01-inclusion.html',
  '[citations-info] bilan | article « 01-inclusion » | references 4 | appels 3 | lies 1 | ambigus 1 | sansref 1 | 4 référence(s), 3 appel(s) : 1 lié(s), 1 ambigu(s), 1 sans référence. | [de] 4 Eintrag/Einträge, 3 Verweis(e): 1 verknüpft, 1 mehrdeutig, 1 ohne Eintrag.',
  '[citations-avertissement] appel-sans-reference | article « 01-inclusion » | appel « (Shaw et al., 2023) » | Appel sans référence : (Shaw et al., 2023). | [de] Zitatverweis ohne Eintrag im Verzeichnis: (Shaw et al., 2023).',
  '[citations-avertissement] appel-ambigu | article « 01-inclusion » | appel « (Sen, 2001) » | Appel ambigu, à lier à la main : (Sen, 2001). | [de] Mehrdeutiger Zitatverweis, von Hand zu verknüpfen: (Sen, 2001).',
  '[citations-avertissement] reference-orpheline | article « 01-inclusion » | reference « Ricœur, P. (1990). Soi-même comme un autre. Seuil.… » | Référence jamais appelée : Ricœur, P. (1990). Soi-même comme un autre. Seuil.… | [de] Nie zitierter Eintrag: Ricœur, P. (1990). Soi-même comme un autre. Seuil.…',
  '[WARNING] Could not fetch resource media/fig-absente.png',
  'pandoc articles/01-inclusion/01-inclusion.md -> out/01-inclusion/01-inclusion.apercu.html (aperçu sourcepos)',
  '[citations-info] bilan | article « 01-inclusion » | references 0 | appels 0 | lies 0 | ambigus 0 | sansref 0 | 0 référence(s), 0 appel(s) : 0 lié(s), 0 ambigu(s), 0 sans référence. | [de] 0 Eintrag/Einträge, 0 Verweis(e): 0 verknüpft, 0 mehrdeutig, 0 ohne Eintrag.',
  '[WARNING] This document format requires a nonempty <title> element.',
  "  Defaulting to '01-inclusion' as the title.",
  '  To specify a title, use \'title\' in metadata or --metadata title="...".',
  '[WARNING] Could not fetch resource media/fig-absente.png',
  'WARNING: Ignored `overflow-x: auto` at 5:24, unknown property.',
  'WARNING: Ignored `stroke: #ffffff` at 109:40, unknown property.'
].join(LF) + LF;

// La même chaîne, sur un article dont le titre a été vidé. Code de sortie 2 : la porte du
// Makefile a fermé. Quatre lignes de prose, dont la moitié allemande, pour un seul fait.
const JOURNAL_BLOQUANT = [
  "[pipeline] ⚠ L'article « 01-inclusion » n'a pas de titre : la fiche articles/01-inclusion/01-inclusion.meta.yaml est absente, ou son titre est vide.",
  '[pipeline] À faire : ouvrez « Métadonnées des articles » dans le cockpit, saisissez le titre de cet article, enregistrez, puis relancez la compilation (Ctrl+S).',
  "[pipeline] Pourquoi la compilation s'arrête : sans titre, le PDF sortirait avec un titre de document vide tout en s'annonçant conforme PDF/UA. Un lecteur d'écran n'aurait rien à annoncer.",
  '[pipeline] [de] Der Artikel « 01-inclusion » hat keinen Titel: articles/01-inclusion/01-inclusion.meta.yaml fehlt, oder der Titel ist leer. Öffnen Sie « Metadaten der Artikel » im Cockpit, geben Sie den Titel ein, speichern Sie und kompilieren Sie erneut (Ctrl+S).',
  'make[1]: *** [/mnt/c/…/pipeline/Makefile:265: verifie-dossier] Error 1',
  'make: *** [/mnt/c/…/pipeline/Makefile:123: all] Error 2'
].join(LF) + LF;

// Le format posé exprès pour cette interface : un code stable, les champs, puis les deux
// langues sur la même ligne. Aucun « ⚠ », justement pour ne pas se faire prendre pour un
// échec.
const JOURNAL_IMPORT = [
  '[import] converti : 3_Autre.docx -> articles/03-autre/03-autre.md',
  "[import-avertissement] tableau-sans-entete | article « 03-autre » | tableau 2 | tables/table-02.html | Ce tableau ne semble pas avoir de rangée d'en-tête : désignez-la dans l'éditeur de tableaux, sinon un lecteur d'écran ne pourra pas relier une cellule à sa colonne. | [de] Diese Tabelle scheint keine Kopfzeile zu haben: legen Sie sie im Tabellen-Editor fest, sonst kann ein Screenreader eine Zelle nicht ihrer Spalte zuordnen.",
  "[import-avertissement] word-redepose | article « 02-ecole » | fichier « 2_Die Schule 2050.docx » | Cet article a déjà été importé depuis ce même fichier Word. | [de] Dieser Artikel wurde schon aus derselben Word-Datei importiert.",
  '[import] terminé : 1 converti(s), 0 renommé(s), 1 redéposé(s), 0 échec(s).'
].join(LF) + LF;

const cles = (constats) => constats.map((c) => c.source + '/' + c.code);

// ---- 1. Le journal, lu ----

// Les champs nommés de la ligne survivent au constat : lib/constats.js y prend l'objet à
// nommer dans la phrase ET la cible du bouton — l'image à ouvrir, le champ à remplir. Ils
// étaient jusqu'ici consommés par ARGS puis jetés, et un bouton ne pouvait donc mener
// qu'à la page, jamais à l'endroit exact.
test('journal : les champs nommés de la ligne restent sur le constat', () => {
  const ligne = '[numerotation-blocage] figure-sans-alt | article « 01-inclusion » '
    + '| image « media/fig-01.png » | Image sans alternative. | [de] Bild ohne Alternative.';
  const c = journal.analyserJournal(ligne + LF, 'fr')[0];
  assert.ok(c, 'la ligne n’est pas lue');
  assert.strictEqual(c.code, 'figure-sans-alt');
  assert.ok(c.champs, 'le constat ne porte pas ses champs nommés');
  assert.strictEqual(c.champs.image, 'media/fig-01.png');
  assert.strictEqual(c.champs.article, '01-inclusion');
});

// Le cas le plus fréquent des compilations qui « s'arrêtent sans rien dire » : un lecteur
// de PDF tient le fichier ouvert, WeasyPrint a bien produit son document, et c'est le
// déplacement final qui refuse. Mesuré : `mv` rend 1, l'ancien PDF garde son contenu, et
// la ligne d'erreur ne porte aucun préfixe de la maison — elle était donc jetée en
// silence, et la personne ne voyait qu'un échec sans cause.
test('journal : un PDF tenu ouvert se dit, par le code comme par la ligne brute', () => {
  const code = '[pipeline-blocage] pdf-verrouille | fichier « out/01-inclusion/01-inclusion.pdf » '
    + '| Le PDF est ouvert ailleurs. | [de] Das PDF ist anderswo geöffnet.';
  const parCode = journal.analyserJournal(code + LF, 'fr')[0];
  assert.ok(parCode, 'la ligne à code n’est pas lue');
  assert.strictEqual(parCode.source, 'pipeline');
  assert.strictEqual(parCode.code, 'pdf-verrouille');
  assert.strictEqual(parCode.ton, 'danger');
  assert.strictEqual(parCode.champs.fichier, 'out/01-inclusion/01-inclusion.pdf');

  // Le repli. Le Makefile vit dans le toolkit déployé, le cockpit se met à jour de son
  // côté : un poste dont le cockpit est neuf et le toolkit ancien doit quand même le dire.
  const brut = "mv: cannot move '~01-inclusion.pdf' to 'out/01-inclusion/01-inclusion.pdf': Permission denied";
  const parLigne = journal.analyserJournal(brut + LF, 'fr')[0];
  assert.ok(parLigne, 'la ligne brute de mv est encore jetée en silence');
  assert.strictEqual(parLigne.code, 'pdf-verrouille');
  assert.strictEqual(parLigne.ton, 'danger');
  assert.strictEqual(parLigne.champs.fichier, 'out/01-inclusion/01-inclusion.pdf',
    'le fichier tenu ouvert n’est pas relevé : ' + JSON.stringify(parLigne.champs));
  // Et une erreur de déplacement qui n'a rien à voir avec un PDF ne prend pas ce code.
  const autre = "mv: cannot move 'a.txt' to 'b.txt': Permission denied";
  const c = journal.analyserJournal(autre + LF, 'fr')[0];
  assert.ok(!c || c.code !== 'pdf-verrouille', 'tout échec de mv passe pour un PDF verrouillé');
});

test('journal : les avertissements d’une vraie compilation arrivent tous, et rien d’autre', () => {
  const constats = journal.analyserJournal(JOURNAL_AVERTISSEMENTS, 'fr');
  assert.deepStrictEqual(cles(constats), [
    'citations/bilan',
    'citations/appel-sans-reference',
    'citations/appel-ambigu',
    'citations/reference-orpheline',
    'rendu/image-manquante'
  ]);
  // La chaîne compile chaque article deux fois, le PDF et l'aperçu : un même fait ne doit
  // pas se dédoubler à l'écran. L'image manquante est signalée deux fois par pandoc.
  assert.strictEqual(constats.filter((c) => c.code === 'image-manquante').length, 1);
  // Le bilan tout à zéro de la passe d'aperçu n'a rien à dire et ne dit rien.
  assert.strictEqual(constats.filter((c) => c.code === 'bilan').length, 1);
  // Chaque constat sait de quel article il parle : les lignes de citations le nomment
  // elles-mêmes, et l'image manquante — vue par pandoc, qui ne connaît pas nos articles —
  // le tient de la ligne de commande qui précède.
  for (const c of constats) { assert.strictEqual(c.slug, '01-inclusion'); }
  // Et le bruit d'outillage n'entre pas : ni les propriétés CSS ignorées de la feuille de
  // style du toolkit, ni le <title> que pandoc réclame sur la passe d'aperçu.
  const phrases = constats.map((c) => journal.phraseConstat(c, 'fr')).join(' ');
  assert.ok(phrases.indexOf('overflow-x') === -1, 'une propriété CSS a fini sous les yeux du rédacteur');
  assert.ok(phrases.indexOf('nonempty') === -1, 'un avertissement de gabarit pandoc a filé');
});

test('journal : un appel sans référence arrive avec le geste de correction', () => {
  const c = journal.analyserJournal(JOURNAL_AVERTISSEMENTS, 'fr')
    .find((x) => x.code === 'appel-sans-reference');
  assert.ok(c, 'l’appel sans référence n’arrive pas');
  const phrase = journal.phraseConstat(c, 'fr');
  // L'appel fautif, pour le retrouver dans le texte.
  assert.ok(phrase.indexOf('(Shaw et al., 2023)') !== -1, 'l’appel fautif n’est pas nommé');
  // Le geste, et non seulement le constat : c'est ce qui manquait.
  assert.ok(/Ajoutez la référence/.test(phrase), 'aucun geste de correction');
  // Et la conséquence, pour savoir si cela mérite d'être corrigé maintenant.
  assert.ok(/remonter à la source/.test(phrase), 'aucune conséquence énoncée');
  // Rien qui ressemble à de la plomberie : ni nom de filtre, ni chemin, ni code de sortie.
  assert.ok(!/\.lua|szh-|stderr|exit|venv|out\//.test(phrase), 'le message parle technique : ' + phrase);
});

test('journal : le ton ne ment pas — un avertissement n’est pas un échec', () => {
  const doux = journal.resumeJournal(journal.analyserJournal(JOURNAL_CITATIONS, 'fr'));
  // Trois citations à reprendre, et rien de bloquant : la compilation a produit ses
  // documents, ils sont publiables, il reste du travail d'édition.
  assert.strictEqual(doux.avertissements, 3);
  assert.strictEqual(doux.bloquants, 0);
  // La figure absente, elle, ne se rattrape pas après impression : elle est bloquante,
  // alors même que la compilation a rendu 0.
  const mele = journal.resumeJournal(journal.analyserJournal(JOURNAL_AVERTISSEMENTS, 'fr'));
  assert.strictEqual(mele.avertissements, 3);
  assert.strictEqual(mele.bloquants, 1);

  const dur = journal.analyserJournal(JOURNAL_BLOQUANT, 'fr');
  assert.deepStrictEqual(cles(dur), ['pipeline/titre-manquant']);
  assert.strictEqual(dur[0].ton, 'danger');
  assert.strictEqual(dur[0].slug, '01-inclusion');
  // Quatre lignes de prose du pipeline, dont une en allemand, pour un seul fait à l'écran.
  assert.strictEqual(journal.resumeJournal(dur).total, 1);
  // Les lignes de make ne sont pas des messages : un numéro de ligne de Makefile n'aide
  // personne.
  assert.ok(!/Makefile/.test(journal.phraseConstat(dur[0], 'fr')));
});

test('journal : une seule langue à l’écran, celle du cockpit', () => {
  for (const [source, code] of [[JOURNAL_BLOQUANT, 'titre-manquant'],
                                [JOURNAL_AVERTISSEMENTS, 'appel-sans-reference'],
                                [JOURNAL_IMPORT, 'tableau-sans-entete']]) {
    const fr = journal.analyserJournal(source, 'fr').find((c) => c.code === code);
    const de = journal.analyserJournal(source, 'de').find((c) => c.code === code);
    assert.ok(fr && de, 'le constat « ' + code + ' » manque dans une des deux langues');
    const phraseFr = journal.phraseConstat(fr, 'fr');
    const phraseDe = journal.phraseConstat(de, 'de');
    assert.notStrictEqual(phraseFr, phraseDe, 'les deux langues rendent le même texte : ' + code);
    // Chacune est entière et seule : jamais la marque de l'autre moitié, jamais un mot de
    // l'autre langue laissé au passage.
    assert.ok(phraseFr.indexOf('[de]') === -1, 'la moitié allemande a suivi : ' + code);
    assert.ok(phraseDe.indexOf('[de]') === -1, 'la marque de langue a suivi : ' + code);
    assert.ok(/^[A-ZÀ-Ü«]/.test(phraseFr) && /^[A-ZÄÖÜ«]/.test(phraseDe),
      'phrase tronquée : ' + code);
    assert.ok(phraseDe.indexOf('ß') === -1, 'l’allemand doit être en orthographe suisse');
  }
  // Le cas qui a motivé la règle : szh-citations.lua n'écrit qu'en français, et pourtant
  // l'allemand doit sortir en allemand. C'est la clé d'i18n qui le permet.
  const de = journal.analyserJournal(JOURNAL_AVERTISSEMENTS, 'de')
    .find((c) => c.code === 'appel-sans-reference');
  assert.match(journal.phraseConstat(de, 'de'), /^Der Zitatverweis \(Shaw et al\., 2023\)/);
});

test('journal : un avertissement d’import garde son code et son ton propre', () => {
  const constats = journal.analyserJournal(JOURNAL_IMPORT, 'fr');
  assert.deepStrictEqual(cles(constats), ['import/tableau-sans-entete', 'import/word-redepose']);
  // Le piège que ce format évite : lireRapportImport() classe « danger » toute ligne
  // portant ⚠, et un avertissement non bloquant s'y déguiserait en import raté. Aucune de
  // ces deux lignes n'a de ⚠, et aucune n'est un échec.
  for (const c of constats) { assert.strictEqual(c.ton, 'attention'); }
  assert.ok(JOURNAL_IMPORT.indexOf('[import-avertissement] tableau-sans-entete') !== -1);
  assert.ok(!/\[import-avertissement\][^\n]*⚠/.test(JOURNAL_IMPORT),
    'le pipeline a remis un ⚠ sur une ligne d’avertissement : le ton va se perdre');
  // Le code stable est le seul ancrage : le ton en vient, pas de la phrase.
  assert.strictEqual(journal.TONS_IMPORT['tableau-sans-entete'], 'attention');
  assert.strictEqual(journal.TONS_IMPORT['homonymes-epuises'], 'danger');
  // Les champs de la ligne se retrouvent dans la phrase de la maison.
  const t = constats[0];
  assert.strictEqual(t.slug, '03-autre');
  // Ancré sur la substitution, pas sur la formulation : le texte a déjà été réécrit une
  // fois (il disait de désigner la première rangée, ce qui aurait posé une relation fausse).
  assert.match(journal.phraseConstat(t, 'fr'), /tableau 2 /);
});

test('journal : une plainte inconnue passe quand même, plutôt que de se taire', () => {
  // Le pipeline gagnera d'autres avertissements. Sans règle ici, un « ⚠ » sous un préfixe
  // de la maison doit tout de même arriver à l'écran — c'est le silence qu'on corrige.
  const c = journal.analyserJournal(
    '[pipeline] ⚠ Quelque chose de neuf et de fâcheux. [de] Etwas Neues und Ärgerliches.', 'fr');
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].ton, 'attention');
  assert.strictEqual(journal.phraseConstat(c[0], 'fr'), 'Quelque chose de neuf et de fâcheux.');
  // Et en allemand, la moitié allemande de la même ligne.
  const d = journal.analyserJournal(
    '[pipeline] ⚠ Quelque chose de neuf et de fâcheux. [de] Etwas Neues und Ärgerliches.', 'de');
  assert.strictEqual(journal.phraseConstat(d[0], 'de'), 'Etwas Neues und Ärgerliches.');
  // Une ligne sans plainte et sans règle ne dit rien : la vue n'est pas un terminal.
  assert.deepStrictEqual(journal.analyserJournal('[pipeline] Tout va bien, merci.', 'fr'), []);
  // Un journal vide ou absent non plus.
  assert.deepStrictEqual(journal.analyserJournal('', 'fr'), []);
  assert.deepStrictEqual(journal.analyserJournal(null, 'fr'), []);
});

// ---- 2. La page : les constats jusqu'aux cartes ----

test('page : les constats deviennent des cartes, bloquants d’abord', () => {
  const page = ouvrir({
    racine: RACINE, page: 'vue-ensemble', cssPartage: ['_design.css', '_liste.css'],
    jsPartage: ['_messages.js']
  });
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  // La charge que l'hôte envoie : deux tons, pour vérifier qu'ils se distinguent à l'œil.
  page.envoyer({
    type: 'valeurs', titre: 'Contrôles de la compilation',
    i18n: { ouvrir: 'Ouvrir', listeVide: 'Rien à signaler.' },
    boutons: [{ id: 'recompiler', libelle: 'Tout recompiler', principal: true }],
    lignes: [
      { cle: '01-inclusion', groupe: 'Ce qui empêche de publier',
        titre: 'Article « 01-inclusion »', meta: 'Mise en page',
        notif: { ton: 'danger', texte: 'L’image « fig-absente.png » est appelée par le texte mais introuvable.' },
        pastilles: [{ texte: 'bloquant', ton: 'danger', icone: 'danger' }], ouvrir: true },
      { cle: '01-inclusion', groupe: 'À regarder avant de publier',
        titre: 'Article « 01-inclusion »', meta: 'Citations et références',
        notif: { ton: 'attention', texte: 'L’appel (Shaw et al., 2023) ne mène à aucune référence.' },
        pastilles: [{ texte: 'à vérifier', ton: 'attention', icone: 'attention' }], ouvrir: true }
    ]
  });
  assert.strictEqual(page.compter('.szh-carte'), 2, 'les cartes ne sont pas posées');
  // Les deux tons se distinguent : c'est tout ce qui sépare, à l'œil, un blocage d'un détail.
  assert.strictEqual(page.compter('.szh-notif--danger'), 1);
  assert.strictEqual(page.compter('.szh-notif--attention'), 1);
  assert.strictEqual(page.compter('.szh-pastille--danger'), 1);
  assert.strictEqual(page.compter('.szh-pastille--attention'), 1);
  // Les deux groupes ont leur titre : l'ordre de lecture est celui des gestes à faire.
  const textes = page.textes();
  assert.strictEqual(textes.indexOf('Ce qui empêche de publier'), 0,
    'les bloquants ne sont pas en tête');
  assert.ok(textes.indexOf('À regarder avant de publier') > 0);
  // Et la phrase elle-même est là, dans le corps de la carte et non dans une infobulle.
  const joint = textes.join(' | ');
  assert.ok(joint.indexOf('fig-absente.png') !== -1, 'la phrase du constat n’est pas affichée');
  assert.ok(joint.indexOf('(Shaw et al., 2023)') !== -1, 'l’appel fautif n’est pas affiché');
  // « Ouvrir » mène à l'article nommé.
  assert.strictEqual(page.compter('.ligne-pied button') >= 2, true, 'aucun bouton « Ouvrir »');
});

// ---- 3. L'hôte, réellement activé ----

const REVUE = revueDEssai();
const JOURNAL = path.join(REVUE, '.szh-journal.log');

function poserJournal(texte) {
  fs.writeFileSync(JOURNAL, texte, 'utf8');
}

// Le journal est en place AVANT l'activation : c'est le cas d'un numéro qu'on rouvre le
// lendemain, sans avoir rien recompilé.
poserJournal(JOURNAL_CITATIONS);
const HOTE = activerHote(REVUE);

test('hôte : la commande et la vue des contrôles existent', () => {
  assert.ok(HOTE.commandes().indexOf('szh.vueControles') !== -1,
    'aucune commande n’ouvre les contrôles : la vue serait inatteignable');
});

test('hôte : rouvrir un numéro retrouve ses contrôles, sans les annoncer', async () => {
  await HOTE.executer('szh.cockpit.rafraichir');    // ce que fait l'ouverture du numéro
  // Le compteur est là : ce que la dernière compilation avait relevé est encore vrai.
  assert.ok(HOTE.barreQuiDit('à vérifier'), 'le journal du numéro n’est pas relu à l’ouverture');
  // Mais ce n'est pas une nouvelle : aucune notification ne surgit à l'ouverture.
  assert.strictEqual(HOTE.avertissements.length, 0, 'un avis surgit à la simple ouverture');
  assert.strictEqual(HOTE.erreurs.length, 0);
  // Et la vue montre bien les constats du disque.
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.strictEqual(charge.lignes.length, 4);
});

// Le compteur de la barre d'état ne se regarde pas : la liste a donc son raccourci dans
// l'arbre, sous « Word en attente ». Son icône porte la gravité — c'est le seul endroit
// visible en permanence, il doit dire s'il y a un blocage sans qu'on l'ouvre.
test('arbre : le raccourci « À corriger » suit l’état, sous « Word en attente »', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const dernier = racine[racine.length - 1];
  assert.strictEqual(dernier.contextValue, 'controles',
    'le raccourci ne ferme pas la liste des sections');
  assert.strictEqual(racine[racine.length - 2].contextValue, 'section-word',
    'le raccourci ne suit pas « Word en attente »');
  assert.strictEqual(dernier.collapsibleState, 0, 'le raccourci ne doit pas se déplier');
  assert.ok(dernier.command && dernier.command.command === 'szh.vueControles',
    'le raccourci n’ouvre pas la vue');
  assert.ok(dernier.tooltip, 'raccourci sans infobulle');
  // JOURNAL_CITATIONS ne porte que des avertissements : ambre, et leur compte.
  assert.strictEqual(dernier.iconPath.id, 'warning',
    'trois points à vérifier, et l’icône ne les annonce pas : ' + dernier.iconPath.id);
  assert.match(String(dernier.description), /3/);

  // Un journal qui bloque : l'icône passe au rouge et compte les seuls bloquants.
  poserJournal(JOURNAL_AVERTISSEMENTS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  const bloquants = (await arbre.getChildren()).pop();
  assert.strictEqual(bloquants.iconPath.id, 'error',
    'un blocage ne se voit pas dans l’arbre : ' + bloquants.iconPath.id);
  assert.match(String(bloquants.description), /^\(\d+\)$/);
  poserJournal(JOURNAL_CITATIONS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
});

test('hôte : une compilation qui avertit le dit sans ouvrir de terminal', async () => {
  poserJournal(JOURNAL_CITATIONS);
  const avant = HOTE.avertissements.length;
  const erreursAvant = HOTE.erreurs.length;
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  await new Promise((r) => setImmediate(r));         // la notification est asynchrone

  // Un avertissement, et pas une erreur : rien n'est bloqué, et le ton doit le dire.
  assert.ok(HOTE.avertissements.length > avant, 'aucun avis à l’écran après la compilation');
  assert.strictEqual(HOTE.erreurs.length, erreursAvant,
    'trois citations à reprendre sont sorties en erreur : un avertissement présenté comme un échec');
  const avis = HOTE.avertissements[HOTE.avertissements.length - 1];
  assert.match(avis, /Compilation terminée/);
  assert.ok(/3 point/.test(avis), 'le compte des points à voir manque : ' + avis);

  // Et un compteur reste visible dans la barre d'état quand l'avis a disparu.
  assert.ok(HOTE.barreQuiDit('à vérifier'),
    'rien dans la barre d’état : l’avis disparu, tout serait reperdu');

  // La vue, ouverte, montre les constats. C'est la vue d'ensemble des autres sections :
  // aucun composant n'a été dupliqué pour l'occasion.
  poserJournal(JOURNAL_AVERTISSEMENTS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  await new Promise((r) => setImmediate(r));
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  assert.ok(p, 'la vue des contrôles ne s’ouvre pas');
  await p._recepteur({ type: 'pret' });              // la page s'annonce, comme dans l'éditeur
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.strictEqual(charge.lignes.length, 5, 'les cartes ne portent pas tous les constats');
  assert.match(charge.titre, /À corriger/);
  const corps = charge.lignes.map((l) => l.notif.texte).join(' | ');
  assert.ok(corps.indexOf('(Shaw et al., 2023)') !== -1, 'l’appel sans référence n’est pas à l’écran');
  assert.ok(corps.indexOf('fig-absente.png') !== -1, 'l’image absente n’est pas à l’écran');
  // Aucun bloquant ici : une image introuvable laisse sortir le PDF, elle ne ferme ni la
  // compilation, ni la validation PDF/UA, ni l'export. Elle etait rouge par principe, elle
  // est ambre par mesure -- et l'info ferme la marche.
  assert.deepStrictEqual(charge.lignes.map((l) => l.notif.ton),
    ['attention', 'attention', 'attention', 'attention', 'info']);
});

test('hôte : une compilation arrêtée le dit autrement', async () => {
  poserJournal(JOURNAL_BLOQUANT);
  const avant = HOTE.erreurs.length;
  await HOTE.finirTache('Aperçu / Export PDF', 2);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(HOTE.erreurs.length, avant + 1, 'un arrêt de compilation doit sortir en erreur');
  const avis = HOTE.erreurs[HOTE.erreurs.length - 1];
  // Le code de sortie sépare les deux phrases : « arrêtée » n'est vrai que s'il est non nul.
  assert.match(avis, /La compilation s’est arrêtée/);
  assert.match(avis, /1 point/);
  assert.ok(HOTE.barreQuiDit('1 à corriger'), 'le compteur de la barre d’état ne suit pas');
});

test('hôte : un journal muet ne dérange personne', async () => {
  // Le journal traverse les DEUX articles dont les contrôles précédents ont parlé, et n'a
  // rien à dire d'eux : c'est ce que fait une recompilation complète propre. Les constats
  // sont retenus par article (fusionnerConstats), un journal qui ne parlerait que du premier
  // laisserait donc ceux du second — et le compteur ne serait pas vide.
  poserJournal(['pandoc articles/01-essai/01-essai.md -> out/01-essai/01-essai.html',
    'pandoc articles/01-inclusion/01-inclusion.md -> out/01-inclusion/01-inclusion.html',
    'pandoc articles/02-sans-fiche/02-sans-fiche.md -> out/02-sans-fiche/02-sans-fiche.html'].join(LF) + LF);
  const avert = HOTE.avertissements.length;
  const err = HOTE.erreurs.length;
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(HOTE.avertissements.length, avert, 'un avis est sorti sans rien à dire');
  assert.strictEqual(HOTE.erreurs.length, err);
  assert.strictEqual(HOTE.barreQuiDit('à corriger'), null, 'le compteur reste sur l’ancien état');
  assert.strictEqual(HOTE.barreQuiDit('à vérifier'), null);
});

test('hôte : une tâche étrangère au cockpit ne déclenche rien', async () => {
  poserJournal(JOURNAL_BLOQUANT);
  const err = HOTE.erreurs.length;
  await HOTE.finirTache('npm: build', 1);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(HOTE.erreurs.length, err, 'le cockpit parle pour une tâche qui n’est pas la sienne');
});

test('hôte : un avertissement d’import n’est plus une ligne brute dans « Word en attente »', async () => {
  fs.writeFileSync(path.join(REVUE, 'articles-word', '.import.log'), JOURNAL_IMPORT, 'utf8');
  await HOTE.executer('szh.vueWord');
  const p = HOTE.panneauDeType('szhVueWord');
  assert.ok(p, 'la vue « Word en attente » ne s’ouvre pas');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  const rapport = charge.lignes.filter((l) => l.groupe === 'Dernière conversion');
  const titres = rapport.map((l) => l.titre).join(' | ');
  // Avant : la ligne entière, code et deux langues comprises, servait de titre de carte, et
  // le badge disait « converti ».
  assert.ok(titres.indexOf('[import-avertissement]') === -1,
    'la ligne brute du pipeline sert encore de titre de carte');
  assert.ok(titres.indexOf('[de]') === -1, 'les deux langues arrivent à l’écran');
  const tableau = rapport.find((l) => /03-autre/.test(l.titre));
  assert.ok(tableau, 'l’avertissement de tableau ne trouve pas son article');
  assert.strictEqual(tableau.pastilles[0].ton, 'attention',
    'un avertissement non bloquant est présenté comme un échec');
  assert.match(tableau.notif.texte, /en-tête/);
});

// La ligne réelle de szh-numerotation.lua (voir test/filtres-pandoc.test.js et
// test/js/journal-codes.test.js, qui la font sortir de pandoc et la lisent mot pour mot) :
// une image sans texte alternatif ni légende, sur l'article « 01-essai » de la revue
// d'essai — le seul dont fournisseur.listerArticles() connaît le slug ici.
const JOURNAL_FIGURES = [
  '[numerotation-avertissement] figure-sans-alt | article « 01-essai » | image « fig-1.png » | '
    + 'L’image fig-1.png n’a ni texte alternatif ni légende : un lecteur d’écran n’en dira rien. | '
    + '[de] Das Bild fig-1.png hat weder Alternativtext noch Legende: ein Screenreader sagt dazu nichts.'
].join(LF) + LF;

test('hôte : une image sans texte alternatif ouvre le formulaire des médias de son article', async () => {
  poserJournal(JOURNAL_FIGURES);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  await new Promise((r) => setImmediate(r));
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  assert.ok(p, 'la vue des contrôles ne s’ouvre pas');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  const carte = charge.lignes.find((l) => l.cle === '01-essai');
  assert.ok(carte, 'la carte de l’image sans alt n’apparaît pas : '
    + JSON.stringify(charge.lignes.map((l) => l.titre)));
  assert.strictEqual(carte.meta, 'Figures', 'la source « numerotation » ne montre pas son libellé');
  // Le gabarit : l'intitule du defaut, puis l'objet. Le geste est passe dans le bouton.
  assert.match(carte.notif.texte, /^Figure sans texte alternatif.*fig-1.png$/);
  assert.ok(carte.actions && carte.actions.some((a) => a.id === 'medias:fig-1.png'),
    'le bouton « Décrire les images » manque sur la carte : ' + JSON.stringify(carte.actions));

  // Le bouton mène au bon formulaire, sur le bon article — même contrôle que pour la vue
  // Articles (carte-article.test.js), avec le même geste et la même commande.
  const avant = HOTE.panneaux.length;
  await p._recepteur({ type: 'action', cle: '01-essai', id: 'medias:fig-1.png' });
  const medias = HOTE.panneauDeType('szhMedias');
  assert.ok(medias, 'le bouton « Décrire les images » n’ouvre rien');
  assert.ok(String(medias.title).indexOf('01-essai') !== -1,
    'le gestionnaire des médias ne s’ouvre pas sur le bon article : ' + medias.title);
  assert.ok(HOTE.panneaux.length > avant, 'aucun panneau supplémentaire ne s’est ouvert');
});

// ---- La relecture des messages, verrouillée ----

const i18n = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

// Le propriétaire l'a demandé en clair : que les messages soient compréhensibles par un
// utilisateur normal. Ce contrôle ne juge pas le style, il interdit ce qui a été trouvé et
// retiré — un message qui nomme une cible make, un filtre Lua, une machine virtuelle, un
// code de sortie ou un panneau de terminal a échoué, et n'a pas à revenir.
// Les mêmes interdits pour tout ce qu'un utilisateur lit, cockpit ou lanceur Windows.
const INTERDITS = [
    [/\bmake\b/i, 'une cible make'],
    [/\.lua\b/, 'un filtre Lua'],
    [/venv|PYTHONPATH|stderr|stdout/i, 'de la plomberie de sortie'],
    [/\bWSL\b/i, 'la machine virtuelle par son sigle'],
    [/code de sortie|exit ?code/i, 'un code de sortie'],
    [/<slug>/, 'un motif de chemin'],
    [/\.ps1\b|\.py\b/, 'un script du poste'],
    [/Ouvrez le panneau|Öffnen Sie das Panel|Aufgabenfenster/, 'le panneau du terminal'],
    [/ausgabe\.yaml|\.meta\.yaml|\.taches\.yaml/, 'un fichier de données par son nom'],
    [/basesRevues|config\.json/, 'une clé de configuration']
];

test('relecture : aucun message du cockpit ne parle la langue des développeurs', () => {
  const interdits = INTERDITS;
  for (const langue of ['fr', 'de']) {
    for (const cle of Object.keys(i18n.TEXTES_COCKPIT[langue])) {
      const texte = String(i18n.TEXTES_COCKPIT[langue][cle]);
      for (const [motif, quoi] of interdits) {
        assert.ok(!motif.test(texte),
          'le message « ' + cle + ' » (' + langue + ') nomme ' + quoi + ' : ' + texte);
      }
    }
  }
  // Les gabarits de courriel (mail-templates/*.twig) : même relecture, hors constructions
  // Twig — {# commentaire #} n'est pas un message, {{ variable }} et {% tag %} non plus.
  // Le cockpit et le lanceur Windows portent chacun leur dossier.
  const dossiersGabarits = [path.join(COCKPIT, 'mail-templates'), path.join(RACINE, 'windows', 'mail-templates')];
  for (const dossierGabarits of dossiersGabarits) {
    for (const nom of fs.readdirSync(dossierGabarits)) {
      if (!nom.endsWith('.twig')) { continue; }
      const source = fs.readFileSync(path.join(dossierGabarits, nom), 'utf8')
        .replace(/\{#[\s\S]*?#\}/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, '')
        .replace(/\{%[\s\S]*?%\}/g, '');
      for (const [motif, quoi] of INTERDITS) {
        assert.ok(!motif.test(source), 'le gabarit « ' + nom + ' » nomme ' + quoi);
      }
    }
  }
});

test('relecture : le lanceur Windows non plus, dans ses trois langues', () => {
  // Le cockpit a été relu et verrouillé ; windows/szh-common.ps1 ne l'avait pas été, et il
  // portait encore quatre messages de développeur : un nom de script d'installation, une
  // clé de configuration, et deux causes sans le moindre geste. Ses textes sont lus par les
  // mêmes personnes, sur le même poste, et parfois avant même que le cockpit existe.
  // La table $SzhTextes vit maintenant dans windows/szh-textes.ps1, dot-sourcée par
  // szh-common.ps1.
  const ps = fs.readFileSync(path.join(RACINE, 'windows', 'szh-textes.ps1'), 'utf8');
  const textes = [];
  for (const ligne of ps.split(/\r?\n/)) {
    // Les lignes « 'cle' = 'texte' » des trois tables $SzhTextes (fr, de, en).
    const m = ligne.match(/^\s{2,}'([a-z0-9.]+)'\s*=\s*(.*)$/i);
    if (m) { textes.push([m[1], m[2]]); }
  }
  assert.ok(textes.length > 250, 'les tables de textes du lanceur ne sont plus trouvées : '
    + textes.length + ' lignes');
  for (const [cle, texte] of textes) {
    for (const [motif, quoi] of INTERDITS) {
      assert.ok(!motif.test(texte), 'le message « ' + cle + ' » du lanceur nomme ' + quoi
        + ' : ' + texte);
    }
  }
  // Et les quatre réécrits disent tous ce qu'il faut faire, pas seulement ce qui s'est
  // passé : un verbe d'action, dans chacune des trois langues.
  const gestes = /Relancez|Ouvrez|Fermez|Faites|Starten|Öffnen|Schliessen|Lassen|Start|Open|Close|Have/;
  for (const cle of ['maj.codium.absent', 'err.empreinte', 'err.wsl', 'arch.err.emplacement']) {
    const dits = textes.filter((t) => t[0] === cle);
    assert.strictEqual(dits.length, 3, 'le message « ' + cle + ' » n’existe pas en trois langues');
    for (const [, texte] of dits) {
      assert.match(texte, gestes, 'le message « ' + cle + ' » ne dit aucun geste : ' + texte);
      assert.ok(texte.indexOf('ß') === -1, 'orthographe suisse : « ß » dans ' + cle);
    }
  }
});

test('relecture : un échec de compilation ne double pas le précis par le vague', () => {
  // Concaténé à lib/ : préalable au découpage d'extension.js, voir hote-factice.js.
  const src = sourceExtensionEtLib(COCKPIT);
  // Ces quatre messages sont des replis : quand la chaîne a nommé une cause, la vue des
  // contrôles vient de la dire avec son geste, et un « la compilation a échoué » par-dessus
  // recouvrirait le précis par le vague.
  for (const cle of ['err.build', 'err.export', 'err.import', 'err.exportArticle']) {
    assert.ok(src.indexOf("avertirEchecCompilation('" + cle + "'") !== -1,
      'le message « ' + cle + ' » ne passe pas par le repli');
    assert.ok(src.indexOf("showErrorMessage(T('" + cle + "'") === -1,
      'le message « ' + cle + ' » sort encore par-dessus le message précis');
  }
});

// ---- La configuration de tâches : sans elle, tout ce qui précède est mort ----

test('les tâches livrées écrivent bien le journal que le cockpit relit', () => {
  const src = fs.readFileSync(path.join(RACINE, 'vscodium-user', 'tasks.json'), 'utf8');
  const taches = JSON.parse(src.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*/g,
    (m) => (m[0] === '"' ? m : ''))).tasks;
  assert.ok(taches.length >= 4);
  for (const t of taches) {
    const commande = t.args.join(' ');
    // Le nom du journal est le seul lien entre la tâche et lib/journal.js : s'il change
    // d'un côté, le cockpit relit un fichier qui n'existe pas et ne dit plus rien.
    assert.ok(commande.indexOf('tee .szh-journal.log') !== -1,
      'la tâche « ' + t.label + ' » n’écrit pas le journal');
    assert.ok(commande.indexOf('2>&1') !== -1,
      'la tâche « ' + t.label + ' » laisse la sortie d’erreur au terminal');
    // Sans pipefail, le code de sortie serait celui de `tee` : toujours 0. Une compilation
    // en échec passerait pour réussie, et l'avis sortirait avec le mauvais ton.
    assert.ok(commande.indexOf('set -o pipefail') !== -1,
      'la tâche « ' + t.label + ' » perdrait son code de sortie dans le tuyau');
  }
  // Le journal vit à la racine du numéro : `tout-exporter` commence par supprimer out/, et
  // `tee` continuerait d'écrire dans un fichier effacé.
  assert.ok(src.indexOf('tee out/') === -1, 'le journal est sous out/, que le clean supprime');
  // Et le terminal reste fermé : c'est l'interface qui parle.
  assert.ok(src.indexOf('"reveal": "silent"') !== -1, 'un terminal s’ouvre sous le nez du rédacteur');
});

// ---- La vue branchée sur lib/constats.js -------------------------------------------
//
// Jusqu'ici, un seul constat sur cinquante-cinq portait un bouton — un `if` en dur sur
// `figure-sans-alt` — et le ton venait de sept endroits différents. La vue lit désormais la
// table : la couleur se déduit de la barrière que le défaut ferme, et le bouton de sa cible.

// Un journal qui porte, en une compilation, un défaut par famille de destination : une
// image muette (formulaire des médias, sur CETTE image), un champ vide (la fiche, sur CE
// champ), un profil inconnu (les métadonnées du numéro), un dossier à espaces (aucun geste
// dans l'application).
const JOURNAL_CIBLES = [
  '[numerotation-blocage] figure-sans-alt | article « 01-essai » | image « media/fig-01.png » | Image sans alternative. | [de] Bild ohne Alternative.',
  '[meta-blocage] champ-vide | article « 01-essai » | champ « title » | langue « de » | Champ vide. | [de] Feld leer.',
  '[pipeline] ⚠ Le profil de production « bizarre » du numéro n’est pas reconnu.',
  "[pipeline] ⚠ Le dossier d'article « 01 essai » contient des espaces."
].join(LF) + LF;

test('vue : chaque constat porte le bouton de sa destination, et l’endroit exact', async () => {
  poserJournal(JOURNAL_CIBLES);
  await HOTE.finirTache('Aperçu / Export PDF', 2);
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });
  const lignes = p.messages.filter((m) => m.type === 'valeurs').pop().lignes;

  const parTexte = (motif) => lignes.find((l) => motif.test(l.notif.texte));
  const muette = parTexte(/alternatif/);
  assert.ok(muette, 'l’image muette n’est pas dans la liste');
  assert.strictEqual(muette.actions.length, 1, 'un bouton et un seul');
  // L'identifiant porte la destination ET l'objet : la page le renvoie tel quel, l'hôte n'a
  // donc pas à retrouver de quel constat venait le clic.
  assert.strictEqual(muette.actions[0].id, 'medias:fig-01.png');
  assert.ok(muette.actions[0].libelle && muette.actions[0].tip, 'bouton sans libellé ni tip');

  const champ = parTexte(/Champ vide/);
  assert.ok(champ, 'le champ vide n’est pas dans la liste');
  assert.strictEqual(champ.actions[0].id, 'fiche:title');

  // Un défaut qui ne se corrige nulle part dans l'application n'a pas de bouton : renommer
  // un dossier se fait dans l'explorateur de Windows.
  const espaces = parTexte(/[Ee]space/);
  assert.ok(espaces, 'le dossier à espaces n’est pas dans la liste');
  assert.strictEqual(espaces.actions.length, 0, 'un bouton mène « quelque part » : mensonge');

  poserJournal(JOURNAL_CITATIONS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
});

test('vue : le bouton ouvre le formulaire sur l’image en cause', async () => {
  poserJournal(JOURNAL_CIBLES);
  await HOTE.finirTache('Aperçu / Export PDF', 2);
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });
  const ligne = p.messages.filter((m) => m.type === 'valeurs').pop()
    .lignes.find((l) => /alternatif/.test(l.notif.texte));

  await p._recepteur({ type: 'action', cle: ligne.cle, id: ligne.actions[0].id });
  const medias = HOTE.panneauDeType('szhMedias');
  assert.ok(medias, 'le bouton n’a pas ouvert le formulaire des médias');
  // Deux chemins, selon que le formulaire était déjà ouvert : une charge neuve qui porte
  // « focus », ou un message « focaliser » sur le panneau qui vivait déjà. L'un des deux
  // doit désigner l'image du constat, et pas seulement son article. On ne réveille pas la
  // page par un « pret » : elle se rechargerait avec le focus qu'elle gardait d'avant.
  const vise = medias.messages.map((m) => m.focus || m.relatif).filter((x) => x);
  assert.ok(vise.indexOf('fig-01.png') !== -1,
    'le formulaire ne vise pas l’image du constat : ' + JSON.stringify(vise));

  poserJournal(JOURNAL_CITATIONS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
});

test('vue : la couleur suit la barrière, et la barrière suit le réglage', async () => {
  poserJournal(JOURNAL_CIBLES);
  await HOTE.finirTache('Aperçu / Export PDF', 2);
  const muette = () => {
    const p = HOTE.panneauDeType('szhVueControles');
    return p.messages.filter((m) => m.type === 'valeurs').pop()
      .lignes.find((l) => /alternatif/.test(l.notif.texte));
  };
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });
  // Validation PDF/UA active : une image muette fait échouer le PDF, donc l'export.
  assert.strictEqual(muette().notif.ton, 'danger');

  // Éteinte, plus rien ne refuse ce PDF : le défaut reste, la couleur retombe.
  await HOTE.stub.workspace.getConfiguration('szh').update('controlePdfUa', false);
  await p._recepteur({ type: 'pret' });
  assert.strictEqual(muette().notif.ton, 'attention',
    'la couleur ne suit pas le réglage : elle annonce un refus qui n’aura pas lieu');
  await HOTE.stub.workspace.getConfiguration('szh').update('controlePdfUa', true);

  poserJournal(JOURNAL_CITATIONS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
});

test('vue : la phrase nomme le défaut et son objet, et s’arrête là', async () => {
  poserJournal(JOURNAL_CIBLES);
  await HOTE.finirTache('Aperçu / Export PDF', 2);
  await HOTE.executer('szh.vueControles');
  const p = HOTE.panneauDeType('szhVueControles');
  await p._recepteur({ type: 'pret' });
  const textes = p.messages.filter((m) => m.type === 'valeurs').pop()
    .lignes.map((l) => l.notif.texte);

  assert.ok(textes.some((t) => /^Figure sans texte alternatif\b.*fig-01\.png$/.test(t)),
    'le gabarit « {défaut} : {objet} » n’est pas appliqué : ' + textes.join(' | '));
  // Le geste est dans le bouton : plus une phrase ne dit où cliquer.
  for (const t of textes) {
    assert.ok(!/Ouvrez « |Ouvrez le |puis recompilez|Cliquez/.test(t),
      'une phrase explique encore où cliquer : ' + t);
  }

  poserJournal(JOURNAL_CITATIONS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
});

// ---- Le journal est réécrit à chaque compilation, et `make` est incrémental ----------
//
// Corriger l’article 3 et enregistrer ne recompile que lui : le journal ne contient plus
// que ses lignes. La liste effaçait alors les constats des articles 1 et 2, dont les
// défauts étaient pourtant toujours là — elle mentait par omission, et dans le sens
// rassurant. Les constats sont donc retenus par article, et remplacés article par article :
// seuls ceux d’un article que la compilation vient de traverser sont jetés.
const JOURNAL_UN_SEUL = (slug, avecDefaut) => [
  'pandoc articles/' + slug + '/' + slug + '.md -> out/' + slug + '/' + slug + '.html'
].concat(avecDefaut
  ? ['[citations-avertissement] appel-sans-reference | article « ' + slug + ' » | appel « (Untel, 2020) »'
     + ' | Appel sans référence. | [de] Verweis ohne Eintrag.']
  : []).join(LF) + LF;

test('journal : recompiler un seul article n’efface pas les constats des autres', async () => {
  const lignesDe = async () => {
    await HOTE.executer('szh.vueControles');
    const p = HOTE.panneauDeType('szhVueControles');
    await p._recepteur({ type: 'pret' });
    // Les seules cartes qui nous concernent : ce fichier laisse derrière lui des constats
    // de réimport et de numéro entier, qui survivent aux compilations par construction.
    return p.messages.filter((m) => m.type === 'valeurs').pop()
      .lignes.filter((l) => l.cle === '01-essai' || l.cle === '02-sans-fiche');
  };

  // Deux articles fautifs, en une compilation complète.
  poserJournal(JOURNAL_UN_SEUL('01-essai', true) + JOURNAL_UN_SEUL('02-sans-fiche', true));
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  assert.deepStrictEqual((await lignesDe()).map((l) => l.cle).sort(), ['01-essai', '02-sans-fiche']);

  // On enregistre le seul article 01 : la chaîne ne recompile que lui, et son défaut est
  // corrigé. Celui de 02, que rien n’a recompilé, doit rester.
  poserJournal(JOURNAL_UN_SEUL('01-essai', false));
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  assert.deepStrictEqual((await lignesDe()).map((l) => l.cle), ['02-sans-fiche'],
    'la compilation d’un seul article a emporté les constats des autres');

  // Et l’inverse tient : recompiler 02 sans défaut le fait disparaître pour de bon.
  poserJournal(JOURNAL_UN_SEUL('02-sans-fiche', false));
  await HOTE.finirTache('Aperçu / Export PDF', 0);
  assert.deepStrictEqual((await lignesDe()).map((l) => l.cle), [],
    'un défaut corrigé reste affiché : le constat ne part jamais');

  poserJournal(JOURNAL_CITATIONS);
  await HOTE.finirTache('Aperçu / Export PDF', 0);
});
