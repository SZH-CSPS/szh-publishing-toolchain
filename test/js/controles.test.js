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
const { revueDEssai, activerHote } = require('./hote-factice');

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
    racine: RACINE, page: 'vue-ensemble', cssPartage: ['_design.css', '_liste.css']
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
  assert.match(charge.titre, /Contrôles/);
  const corps = charge.lignes.map((l) => l.notif.texte).join(' | ');
  assert.ok(corps.indexOf('(Shaw et al., 2023)') !== -1, 'l’appel sans référence n’est pas à l’écran');
  assert.ok(corps.indexOf('fig-absente.png') !== -1, 'l’image absente n’est pas à l’écran');
  // Les bloquants en tête, et les tons portés par les cartes.
  assert.strictEqual(charge.lignes[0].notif.ton, 'danger');
  assert.deepStrictEqual(charge.lignes.map((l) => l.notif.ton),
    ['danger', 'attention', 'attention', 'attention', 'info']);
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
  poserJournal('pandoc articles/01-essai/01-essai.md -> out/01-essai/01-essai.html' + LF);
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
});

test('relecture : le lanceur Windows non plus, dans ses trois langues', () => {
  // Le cockpit a été relu et verrouillé ; windows/szh-common.ps1 ne l'avait pas été, et il
  // portait encore quatre messages de développeur : un nom de script d'installation, une
  // clé de configuration, et deux causes sans le moindre geste. Ses textes sont lus par les
  // mêmes personnes, sur le même poste, et parfois avant même que le cockpit existe.
  const ps = fs.readFileSync(path.join(RACINE, 'windows', 'szh-common.ps1'), 'utf8');
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
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
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
