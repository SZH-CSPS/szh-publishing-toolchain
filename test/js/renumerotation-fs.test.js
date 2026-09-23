// L'exécution du plan de renumérotation, sur un vrai dossier.
//
//   node --test "test/js/*.test.js"
//
// Le plan lui-même est éprouvé sans disque (renumerotation.test.js). Ici on éprouve ce qui
// ne se simule pas : des dossiers réellement renommés, un lot interrompu au milieu, et
// l'ordre du numéro réécrit APRÈS que tout soit passé — jamais avant, sinon ausgabe.yaml
// désignerait des dossiers qui n'existent pas.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const hote = require(path.join(COCKPIT, 'lib', 'renumerotation-fs.js'));

const LF = String.fromCharCode(10);

// Un numéro d'essai : des dossiers d'article, leurs sidecars, un ausgabe.yaml qui porte
// l'ordre, et de quoi vérifier que le reste ne bouge pas.
function numero(slugs) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-renum-'));
  // L'ordre s'écrit en séquence EN LIGNE, comme le sérialiseur du cockpit la pose :
  // ordre-articles: ["01-a", "02-b"]. Le corpus d'essai doit parler la même langue que
  // lui, sinon le contrôle prouve autre chose que ce qu'il croit.
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'),
    ['revue: revue',
     'ordre-articles: [' + slugs.map((s) => '"' + s + '"').join(', ') + ']'].join(LF) + LF);
  for (const slug of slugs) {
    const d = path.join(racine, 'articles', slug);
    fs.mkdirSync(path.join(d, 'media'), { recursive: true });
    fs.writeFileSync(path.join(d, slug + '.md'), '# ' + slug + LF + '![](media/fig.png)' + LF);
    fs.writeFileSync(path.join(d, slug + '.meta.yaml'), 'title:' + LF + '  fr: "' + slug + '"' + LF);
    fs.writeFileSync(path.join(d, 'media', 'fig.png'), 'PNG');
    fs.writeFileSync(path.join(d, 'notes.txt'), 'pense-bête');
  }
  return racine;
}

const dossiers = (racine) => fs.readdirSync(path.join(racine, 'articles')).sort();
const ordreEcrit = (racine) => ((fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')
  .match(/^ordre-articles:\s*\[(.*)\]/m) || [null, ''])[1])
  .split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter((x) => x !== '');

// Ajoute au numéro un article de Documentation Kirby (lib/kirby-contenu.js) : pas de
// <slug>.md du tout, seulement sa fiche, sa page (documentation.<lang>.txt) et un dossier
// de fiche par entrée de `fichesDossiers` — la même forme qu'écrit le cockpit
// (<n>_<slug-fiche>/<type>.<lang>.txt). ausgabe.yaml doit déjà exister (numero() l'écrit).
function ajouterDocumentation(racine, slug, fichesDossiers) {
  const d = path.join(racine, 'articles', slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, slug + '.meta.yaml'), 'type: documentation' + LF + 'lang: fr' + LF);
  fs.writeFileSync(path.join(d, 'documentation.fr.txt'),
    'Title: Actualité et ressources' + LF + LF + '----' + LF + LF + 'Uuid: pageuuid0000001' + LF);
  for (const nomDossierFiche of (fichesDossiers || [])) {
    const df = path.join(d, nomDossierFiche);
    fs.mkdirSync(df, { recursive: true });
    fs.writeFileSync(path.join(df, 'livre.fr.txt'),
      'Title: Une fiche' + LF + LF + '----' + LF + LF + 'Uuid: ficheuuid00000001' + LF);
  }
}

// Pose une bibliographie détachée sur un article déjà écrit par numero() : le fichier à
// part, et le marqueur qui l'y renvoie dans le .md — la forme exacte que laisse l'import
// (pipeline/filters/szh-biblio-detacher.lua). `phraseCorps`, si fournie, s'ajoute dans le
// corps de l'article — pour éprouver qu'un ancien slug qui y traînerait par hasard
// (légende, URL) n'est jamais touché par la réparation du marqueur.
function ajouterBiblio(racine, slug, phraseCorps) {
  const d = path.join(racine, 'articles', slug);
  fs.writeFileSync(path.join(d, slug + '.biblio.md'), 'Dupont, A. (2024). Un titre.' + LF);
  const md = path.join(d, slug + '.md');
  let ajout = LF + '::: {.szh-biblio src="' + slug + '.biblio.md"}' + LF + ':::' + LF;
  if (phraseCorps) { ajout = LF + phraseCorps + LF + ajout; }
  fs.appendFileSync(md, ajout);
}

// Le src= du marqueur .szh-biblio d'un article, ou null s'il n'en a pas.
function marqueurSrc(racine, slug) {
  const texte = fs.readFileSync(path.join(racine, 'articles', slug, slug + '.md'), 'utf8');
  const m = texte.match(/\.szh-biblio\b[^}]*\bsrc="([^"]*)"/);
  return m ? m[1] : null;
}

test('exécution : un échange de rangs renomme les deux dossiers et leurs fichiers', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  const r = hote.renumeroter(racine, ['01-inclusion', '00-edito']);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  assert.deepStrictEqual(dossiers(racine), ['00-inclusion', '01-edito']);
  // Les fichiers suivent le dossier : le Makefile exige que le .md porte son nom.
  assert.ok(fs.existsSync(path.join(racine, 'articles', '00-inclusion', '00-inclusion.md')));
  assert.ok(fs.existsSync(path.join(racine, 'articles', '00-inclusion', '00-inclusion.meta.yaml')));
  // Ce qui est désigné en chemin relatif depuis le .md ne bouge pas.
  assert.ok(fs.existsSync(path.join(racine, 'articles', '00-inclusion', 'media', 'fig.png')));
  assert.strictEqual(
    fs.readFileSync(path.join(racine, 'articles', '00-inclusion', '00-inclusion.md'), 'utf8')
      .indexOf('![](media/fig.png)') !== -1, true, 'le texte de l’article a été touché');
  // Et le fichier étranger au slug reste tranquille.
  assert.ok(fs.existsSync(path.join(racine, 'articles', '00-inclusion', 'notes.txt')));
  // L'ordre du numéro parle des nouveaux noms.
  assert.deepStrictEqual(ordreEcrit(racine), ['00-inclusion', '01-edito']);
  fs.rmSync(racine, { recursive: true, force: true });
});

// La règle métier : le premier article de l'ordre écran (prefixeOrdre(0),
// lib/articles.js) doit porter « 00- » sur le disque, jamais « 01- ».
test('exécution : le premier article de l’ordre prend « 00 » sur le disque', () => {
  const racine = numero(['edito', 'inclusion']);
  const r = hote.renumeroter(racine, ['edito', 'inclusion']);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  assert.deepStrictEqual(dossiers(racine), ['00-edito', '01-inclusion']);
  assert.ok(fs.existsSync(path.join(racine, 'articles', '00-edito', '00-edito.md')),
    'le premier article de l’ordre n’a pas pris « 00 »');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('exécution : rien à faire ne touche rien, pas même ausgabe.yaml', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  const avant = fs.statSync(path.join(racine, 'ausgabe.yaml')).mtimeMs;
  const r = hote.renumeroter(racine, ['00-edito', '01-inclusion']);
  assert.strictEqual(r.erreur, null);
  assert.strictEqual(r.renommes, 0);
  assert.strictEqual(fs.statSync(path.join(racine, 'ausgabe.yaml')).mtimeMs, avant,
    'ausgabe.yaml réécrit alors que rien ne changeait');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('exécution : les documents produits des articles renommés sont retirés', () => {
  // out/<slug>/ porte le nom d'avant : le laisser ferait cohabiter deux PDF pour un même
  // article, dont un périmé que l'export pourrait reprendre.
  const racine = numero(['00-edito', '01-inclusion']);
  for (const slug of ['00-edito', '01-inclusion']) {
    fs.mkdirSync(path.join(racine, 'out', slug), { recursive: true });
    fs.writeFileSync(path.join(racine, 'out', slug, slug + '.pdf'), 'PDF');
  }
  hote.renumeroter(racine, ['01-inclusion', '00-edito']);
  assert.deepStrictEqual(fs.readdirSync(path.join(racine, 'out')), [],
    'les documents produits sous l’ancien nom sont restés');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('exécution : un ordre qui ne parle pas des mêmes articles est refusé, sans rien toucher', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  const r = hote.renumeroter(racine, ['00-edito']);
  assert.ok(r.erreur, 'un ordre incomplet doit être refusé');
  assert.deepStrictEqual(dossiers(racine), ['00-edito', '01-inclusion'], 'des dossiers ont bougé malgré le refus');
  assert.deepStrictEqual(ordreEcrit(racine), ['00-edito', '01-inclusion']);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reprise : un lot interrompu se termine, et l’ordre s’écrit alors seulement', () => {
  // On simule l'interruption : les dossiers sont passés par leur nom temporaire, et la
  // seconde passe n'a pas eu lieu. C'est l'état que laisse une fermeture de fenêtre.
  const racine = numero(['00-edito', '01-inclusion']);
  const base = path.join(racine, 'articles');
  fs.renameSync(path.join(base, '00-edito'), path.join(base, '~ordre-01-edito'));
  fs.renameSync(path.join(base, '01-inclusion'), path.join(base, '~ordre-00-inclusion'));

  const r = hote.reprendre(racine);
  assert.strictEqual(r.erreur, null, 'reprise refusée : ' + r.erreur);
  assert.deepStrictEqual(dossiers(racine), ['00-inclusion', '01-edito']);
  // Les fichiers portaient encore l'ancien nom : la reprise les aligne aussi.
  assert.ok(fs.existsSync(path.join(base, '00-inclusion', '00-inclusion.md')),
    'la reprise a laissé les fichiers sous leur ancien nom : ' +
    fs.readdirSync(path.join(base, '00-inclusion')).join(', '));
  assert.deepStrictEqual(ordreEcrit(racine), ['00-inclusion', '01-edito']);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reprise : rien à reprendre ne fait rien', () => {
  const racine = numero(['00-edito']);
  const r = hote.reprendre(racine);
  assert.strictEqual(r.erreur, null);
  assert.strictEqual(r.renommes, 0);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reprise : une destination occupée est refusée, et rien ne s’écrase', () => {
  const racine = numero(['00-edito']);
  const base = path.join(racine, 'articles');
  fs.mkdirSync(path.join(base, '~ordre-00-edito'));
  fs.writeFileSync(path.join(base, '~ordre-00-edito', 'marqueur.txt'), 'temporaire');
  const r = hote.reprendre(racine);
  assert.ok(r.erreur, 'la reprise devait refuser une destination occupée');
  assert.ok(fs.existsSync(path.join(base, '00-edito', '00-edito.md')),
    'le dossier en place a été écrasé');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('état : on sait dire qu’un lot a été interrompu', () => {
  // Ce que l'interface lira pour proposer la reprise plutôt que de laisser un numéro
  // dans un état que personne ne sait nommer.
  const racine = numero(['00-edito']);
  assert.strictEqual(hote.repriseEnAttente(racine), false);
  fs.renameSync(path.join(racine, 'articles', '00-edito'),
    path.join(racine, 'articles', '~ordre-00-edito'));
  assert.strictEqual(hote.repriseEnAttente(racine), true);
  fs.rmSync(racine, { recursive: true, force: true });
});

// ---- le marqueur de bibliographie suit le renommage -----------------------------------
//
// Le défaut constaté sur le poste du propriétaire : un article renommé garde un marqueur
// « ::: {.szh-biblio src=…} » qui nomme l'ANCIEN fichier, alors que celui-ci vient d'être
// renommé sous les yeux d'alignerFichiers(). Les trois chemins qui renomment (Terminer,
// la reprise, l'import — ce dernier via prefixerNouveauxArticles, éprouvé à part dans
// test/js/import-prefixe.test.js) passent tous par alignerFichiers() : un seul contrôle
// ici couvre « Terminer » et la reprise.

test('renumeroter : le marqueur de bibliographie suit le dossier renommé', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  ajouterBiblio(racine, '01-inclusion');
  const r = hote.renumeroter(racine, ['01-inclusion', '00-edito']);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  // « 01-inclusion » devient « 00-inclusion » : son fichier de bibliographie suit (comme
  // n'importe quel sidecar), et le marqueur doit désormais le nommer, lui.
  assert.ok(fs.existsSync(path.join(racine, 'articles', '00-inclusion', '00-inclusion.biblio.md')));
  assert.strictEqual(marqueurSrc(racine, '00-inclusion'), '00-inclusion.biblio.md',
    'le marqueur désigne encore l’ancien fichier : la bibliographie ne se résout plus');
  fs.rmSync(racine, { recursive: true, force: true });
});

// Le chemin réel renumeroter() -> alignerFichiers() -> reparerMarqueurApresAlignement() ->
// reecrireMarqueurBiblio() n'exerçait jusqu'ici que le cas d'un marqueur PÉRIMÉ (le test
// ci-dessus) : reecrireMarqueurBiblio() a pourtant sa propre garde contre un marqueur DÉJÀ
// juste (ligne « m[2] === versNom »), pour ne pas dater le .md à chaque renumérotation. Ce
// cas — rare mais réel (une retouche à la main juste avant « Terminer ») — n'était exercé
// nulle part par ce chemin.
test('renumeroter : un marqueur déjà pointé sur sa future place n’est pas réécrit', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  ajouterBiblio(racine, '01-inclusion');
  const md = path.join(racine, 'articles', '01-inclusion', '01-inclusion.md');
  // Le marqueur porte déjà le nom que le fichier de bibliographie prendra APRÈS le
  // renommage à venir — le fichier lui-même, lui, n'a pas encore bougé.
  fs.writeFileSync(md, fs.readFileSync(md, 'utf8')
    .replace('01-inclusion.biblio.md', '00-inclusion.biblio.md'));
  const avant = fs.statSync(md).mtimeMs;
  const r = hote.renumeroter(racine, ['01-inclusion', '00-edito']);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  const mdApres = path.join(racine, 'articles', '00-inclusion', '00-inclusion.md');
  assert.ok(fs.existsSync(path.join(racine, 'articles', '00-inclusion', '00-inclusion.biblio.md')));
  assert.strictEqual(marqueurSrc(racine, '00-inclusion'), '00-inclusion.biblio.md');
  assert.strictEqual(fs.statSync(mdApres).mtimeMs, avant,
    'le .md a été réécrit alors que son marqueur pointait déjà sur sa future place');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reprise : le marqueur de bibliographie suit aussi', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  ajouterBiblio(racine, '01-inclusion');
  const base = path.join(racine, 'articles');
  // Lot interrompu à mi-chemin, comme le test de reprise plus haut : les dossiers sont
  // déjà sous leur nom temporaire, portant leur destination.
  fs.renameSync(path.join(base, '00-edito'), path.join(base, '~ordre-01-edito'));
  fs.renameSync(path.join(base, '01-inclusion'), path.join(base, '~ordre-00-inclusion'));
  const r = hote.reprendre(racine);
  assert.strictEqual(r.erreur, null, 'reprise refusée : ' + r.erreur);
  assert.strictEqual(marqueurSrc(racine, '00-inclusion'), '00-inclusion.biblio.md',
    'la reprise n’a pas réparé le marqueur de bibliographie');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('renumeroter : un .md sans marqueur n’est jamais réécrit', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  // Pas d'appel à ajouterBiblio() ici : l'article n'a pas de bibliographie détachée.
  const avant = fs.readFileSync(path.join(racine, 'articles', '01-inclusion', '01-inclusion.md'), 'utf8');
  const r = hote.renumeroter(racine, ['01-inclusion', '00-edito']);
  assert.strictEqual(r.erreur, null);
  const apres = fs.readFileSync(path.join(racine, 'articles', '00-inclusion', '00-inclusion.md'), 'utf8');
  assert.strictEqual(apres, avant, 'le .md a été réécrit alors qu’il ne portait aucun marqueur');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('renumeroter : un ancien slug resté dans le corps du texte n’est jamais touché', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  ajouterBiblio(racine, '01-inclusion',
    'Voir aussi l’article voisin, 01-inclusion, pour le contexte.');
  const r = hote.renumeroter(racine, ['01-inclusion', '00-edito']);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  const texte = fs.readFileSync(path.join(racine, 'articles', '00-inclusion', '00-inclusion.md'), 'utf8');
  assert.ok(texte.indexOf('Voir aussi l’article voisin, 01-inclusion, pour le contexte.') !== -1,
    'le corps du texte a été touché par la réparation du marqueur — une substitution '
    + 'globale du slug aurait fait ce dégât');
  assert.strictEqual(marqueurSrc(racine, '00-inclusion'), '00-inclusion.biblio.md',
    'le marqueur, lui, n’a pas suivi le renommage');
  fs.rmSync(racine, { recursive: true, force: true });
});

// ---- guérison des marqueurs déjà périmés, sans aucun renommage -----------------------

test('reparerMarqueursOrphelins : un marqueur périmé guérit quand un seul candidat existe', () => {
  const racine = numero(['00-edito']);
  ajouterBiblio(racine, '00-edito');
  // Le marqueur pointe vers un fichier qui n'existe plus — exactement le défaut constaté :
  // un renommage antérieur à ce correctif, jamais réparé.
  const md = path.join(racine, 'articles', '00-edito', '00-edito.md');
  fs.writeFileSync(md, fs.readFileSync(md, 'utf8')
    .replace('00-edito.biblio.md', 'ancien-nom.biblio.md'));
  const n = hote.reparerMarqueursOrphelins(racine);
  assert.strictEqual(n, 1, 'la guérison n’a rien réparé');
  assert.strictEqual(marqueurSrc(racine, '00-edito'), '00-edito.biblio.md');
});

test('reparerMarqueursOrphelins : zéro candidat, on ne devine pas', () => {
  const racine = numero(['00-edito']);
  ajouterBiblio(racine, '00-edito');
  const md = path.join(racine, 'articles', '00-edito', '00-edito.md');
  const texte = fs.readFileSync(md, 'utf8').replace('00-edito.biblio.md', 'ancien-nom.biblio.md');
  fs.writeFileSync(md, texte);
  fs.rmSync(path.join(racine, 'articles', '00-edito', '00-edito.biblio.md'));   // zéro candidat
  const n = hote.reparerMarqueursOrphelins(racine);
  assert.strictEqual(n, 0);
  assert.strictEqual(marqueurSrc(racine, '00-edito'), 'ancien-nom.biblio.md',
    'le marqueur a été réécrit sans candidat sûr : c’est deviner');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reparerMarqueursOrphelins : plusieurs candidats, on ne devine pas non plus', () => {
  const racine = numero(['00-edito']);
  ajouterBiblio(racine, '00-edito');
  const dossier = path.join(racine, 'articles', '00-edito');
  const md = path.join(dossier, '00-edito.md');
  fs.writeFileSync(md, fs.readFileSync(md, 'utf8')
    .replace('00-edito.biblio.md', 'ancien-nom.biblio.md'));
  // Un second fichier *.biblio.md apparaît : deux candidats, on ne choisit pas pour le
  // rédacteur.
  fs.writeFileSync(path.join(dossier, 'autre.biblio.md'), 'Une autre liste.' + LF);
  const n = hote.reparerMarqueursOrphelins(racine);
  assert.strictEqual(n, 0);
  assert.strictEqual(marqueurSrc(racine, '00-edito'), 'ancien-nom.biblio.md');
  fs.rmSync(racine, { recursive: true, force: true });
});

// ---- Un numéro qui porte une Documentation Kirby -------------------------------------
//
// Un dossier de Documentation n'a plus de <slug>.md (lib/kirby-contenu.js) : son fichier de
// page (documentation.<lang>.txt) porte un nom FIXE, pas celui du dossier — à la différence
// de <slug>.meta.yaml, qui le suit toujours. Défaut réel, reproduit avant correctif : quand
// ce dossier s'appelle « documentation » (le nom par défaut, SLUG_DOCUMENTATION côté
// cockpit), la tige de son nom de dossier ET le nom du fichier de page coïncident
// (« documentation ») — la règle générale d'alignement des sidecars (alignerFichiers)
// prenait alors le fichier de page pour un sidecar du dossier et le renommait en
// « 0X-documentation.fr.txt », un nom que plus rien ne sait relire.
test('exécution : une Documentation Kirby présente — son fichier de page n’est jamais pris pour un sidecar', () => {
  const racine = numero(['00-edito']);
  ajouterDocumentation(racine, '01-documentation', ['1_un-livre', '2_un-film']);

  const r = hote.renumeroter(racine, ['01-documentation', '00-edito']);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  assert.deepStrictEqual(dossiers(racine), ['00-documentation', '01-edito']);

  const docApres = path.join(racine, 'articles', '00-documentation');
  // Le fichier de page garde son nom fixe — jamais « 00-documentation.fr.txt ».
  assert.ok(fs.existsSync(path.join(docApres, 'documentation.fr.txt')),
    'le fichier de page a disparu ou a été renommé');
  assert.ok(!fs.existsSync(path.join(docApres, '00-documentation.fr.txt')),
    'le fichier de page a été pris pour un sidecar du dossier');
  assert.strictEqual(
    fs.readFileSync(path.join(docApres, 'documentation.fr.txt'), 'utf8').indexOf('Uuid: pageuuid0000001') !== -1,
    true, 'le contenu de la page a été touché');
  // La fiche de métadonnées, elle, suit bien le dossier — c'est la règle normale.
  assert.ok(fs.existsSync(path.join(docApres, '00-documentation.meta.yaml')),
    'la fiche de métadonnées n’a pas suivi le renommage du dossier');
  // Les dossiers de fiches ne sont pas des articles : ni renommés, ni vidés.
  assert.deepStrictEqual(
    fs.readdirSync(docApres, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(),
    ['1_un-livre', '2_un-film']);
  assert.ok(fs.existsSync(path.join(docApres, '1_un-livre', 'livre.fr.txt')),
    'le contenu d’un dossier de fiche a disparu');
  assert.strictEqual(
    fs.readFileSync(path.join(docApres, '1_un-livre', 'livre.fr.txt'), 'utf8').indexOf('Uuid: ficheuuid00000001') !== -1,
    true, 'le contenu d’une fiche a été touché');

  assert.deepStrictEqual(ordreEcrit(racine), ['00-documentation', '01-edito']);
  fs.rmSync(racine, { recursive: true, force: true });
});

// Le même défaut, vu depuis reparerMarqueursOrphelins : un balayage qui lirait le fichier de
// page comme un .md d'article planterait sur un dossier de Documentation. Il ne doit ni
// lever, ni y toucher.
test('reparerMarqueursOrphelins : une Documentation Kirby dans le lot ne le fait pas lever, et n’y touche pas', () => {
  const racine = numero(['00-edito']);
  ajouterDocumentation(racine, '01-documentation', ['1_un-livre']);
  const avant = fs.readFileSync(path.join(racine, 'articles', '01-documentation', 'documentation.fr.txt'), 'utf8');
  assert.doesNotThrow(() => hote.reparerMarqueursOrphelins(racine));
  const apres = fs.readFileSync(path.join(racine, 'articles', '01-documentation', 'documentation.fr.txt'), 'utf8');
  assert.strictEqual(apres, avant, 'le fichier de page a été modifié par le balayage des marqueurs');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reparerMarqueursOrphelins : un marqueur déjà juste n’est pas réécrit', () => {
  const racine = numero(['00-edito']);
  ajouterBiblio(racine, '00-edito');
  const md = path.join(racine, 'articles', '00-edito', '00-edito.md');
  const avant = fs.statSync(md).mtimeMs;
  const n = hote.reparerMarqueursOrphelins(racine);
  assert.strictEqual(n, 0);
  assert.strictEqual(fs.statSync(md).mtimeMs, avant, 'le .md a été réécrit pour rien');
  fs.rmSync(racine, { recursive: true, force: true });
});

// ---- options.config / options.cle : le profil livre --------------------------------
//
// ecrireOrdre() (dans hote, ci-dessus) écrivait ausgabe.yaml/ordre-articles en dur : un
// livre passé par ce même chemin (« Terminer », extension.js) aurait créé un ausgabe.yaml
// parasite au lieu d'écrire dans son buch.yaml. Fixture minimale, à la forme d'un livre
// (chapitres/, buch.yaml, ordre-chapitres) plutôt que numero() ci-dessus, qui est câblée
// sur celle d'une revue.
function livre(slugs) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-renum-livre-'));
  fs.writeFileSync(path.join(racine, 'buch.yaml'),
    ['titre: "Essai"',
     'ordre-chapitres: [' + slugs.map((s) => '"' + s + '"').join(', ') + ']'].join(LF) + LF);
  for (const slug of slugs) {
    const d = path.join(racine, 'chapitres', slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, slug + '.md'), '# ' + slug + LF);
  }
  return racine;
}

const optionsLivre = { dossier: 'chapitres', config: 'buch.yaml', cle: 'ordre-chapitres' };

test('options.config/cle : un échange de rangs écrit ordre-chapitres dans buch.yaml, pas ausgabe.yaml', () => {
  const racine = livre(['00-ouverture', '01-suite']);
  const r = hote.renumeroter(racine, ['01-suite', '00-ouverture'], optionsLivre);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  assert.deepStrictEqual(fs.readdirSync(path.join(racine, 'chapitres')).sort(),
    ['00-suite', '01-ouverture']);
  const buch = fs.readFileSync(path.join(racine, 'buch.yaml'), 'utf8');
  assert.match(buch, /ordre-chapitres:\s*\["00-suite",\s*"01-ouverture"\]/,
    'ordre-chapitres n’a pas été réécrit dans l’ordre voulu : ' + buch);
  assert.ok(!fs.existsSync(path.join(racine, 'ausgabe.yaml')),
    'un ausgabe.yaml parasite a été créé par renumeroter() sur un livre');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('options.config/cle : sans eux, ecrireOrdre() garde son défaut de revue (non-régression)', () => {
  const racine = numero(['00-edito', '01-inclusion']);
  const r = hote.renumeroter(racine, ['01-inclusion', '00-edito']);
  assert.strictEqual(r.erreur, null);
  assert.deepStrictEqual(ordreEcrit(racine), ['00-inclusion', '01-edito']);
  fs.rmSync(racine, { recursive: true, force: true });
});
