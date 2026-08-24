// La bibliographie devenue une donnée : détachée à l'import dans <slug>.biblio.md, réinsérée
// à la compilation avec son titre, et lue telle quelle par l'export OJS.
//
//   node --test "test/js/*.test.js"
//
// Pourquoi ce fichier. La chaîne DEVINAIT où commençait la bibliographie : un lexique de
// dix-sept mots comparé par préfixe, et, faute de titre, un balayage de la seconde moitié du
// document. Une section « Literaturhinweise für die Praxis » suivie de prose, et tout ce qui
// suivait cessait d'être regardé — sans le moindre effet visible. Le remplaçant repose sur
// une donnée, le STYLE du .docx, et sur un fichier. Ce qui doit être tenu ici :
//
//   1. la clé qui apparie un paragraphe du .docx au bloc de pandoc se calcule PAREIL des
//      deux côtés — sinon l'étendue à détacher n'est pas retrouvée, et rien ne part ;
//   2. le lexique et les titres par défaut n'existent qu'à un endroit, le filtre ;
//   3. un champ vidé dans les Réglages vaut « aucun titre », pas « reprends le défaut » ;
//   4. le nom du fichier est le même partout — pipeline, cockpit, Makefile ;
//   5. la devinette est partie, et le repli des articles anciens est nommé comme tel.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

process.env.SZH_LANGUE = 'fr';

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const cit = require(path.join(COCKPIT, 'lib', 'citations.js'));

const DISTRO = 'SZH-Publishing';
const DETACHEUR = path.join(RACINE, 'pipeline', 'filters', 'szh-biblio-detacher.lua');
const DOCX_META = path.join(RACINE, 'pipeline', 'docx-meta.py');
const TRAVAIL = path.join(os.tmpdir(), 'szh-biblio-test');

function lire() {
  return fs.readFileSync(path.join.apply(path, [RACINE].concat(Array.from(arguments))), 'utf8');
}

// ---- la clé d'appariement, des deux côtés -------------------------------------------
//
// Les textes qui ont fait échouer l'ancienne chaîne, relevés dans l'audit du corpus des
// 421 galleys : ce que le .docx porte et ce que pandoc en fait ne sont pas la même chaîne.
// Tiret insécable, tiret conditionnel, moins de police Symbole, guillemets courbes : la clé
// ne doit voir aucun d'eux.
const TEXTES_CLE = [
  'Becker, H. (1997). Les variations, p. 257\u2011270. De Boeck.',
  'Becker, H. (1997). Les variations, p. 257270. De Boeck.',
  'Weiss, K. (2016). Recht \u2212 und Pflicht. Beltz.',
  '\u00c9bersold, S. (2013). L\u2019inclusion. \u00ab Titre \u00bb. PUF.',
  'Ü\u0308bereinkommen über die Rechte von Menschen mit Behinderungen (2006).',
  'insieme Schweiz (2024). Wahl\u00adanleitung. Bern.',
  'https://doi.org/10.1177/016502548100400101',
  'Court.'
];

function cheminVersWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function wsl(args) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe',
    ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

let pandocVu = null;
function pandocAbsent() {
  if (pandocVu !== null) { return pandocVu; }
  let r;
  try { r = wsl(['sh', '-c', 'command -v pandoc && command -v python3']); }
  catch (e) { pandocVu = 'wsl.exe injoignable : ' + e.message; return pandocVu; }
  if (r.error) { pandocVu = 'wsl.exe injoignable : ' + r.error.message; }
  else if (r.status !== 0) { pandocVu = 'pandoc ou python3 introuvable dans la distro ' + DISTRO; }
  else { pandocVu = null; }
  return pandocVu;
}

// Saut bruyant : le contrôle n'est pas vert, il est déclaré non fait. Même règle que
// test/js/ancrages.test.js, et le même interrupteur pour une intégration continue.
function sauterSansLua(t, raison) {
  const msg = 'Lua non vérifié : ' + raison;
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail(msg); }
  console.warn('\n*** ' + msg + ' — la clé d’appariement n’est PAS comparée ***\n');
  t.skip(msg);
}

// Le filtre expose cle() dans SZH_BIBLIO_DETACHER pour être éprouvé sur son résultat.
const HARNAIS = [
  'local filtre, textes = arg[1], arg[2]',
  'dofile(filtre)',
  'local S = SZH_BIBLIO_DETACHER',
  'for l in io.lines(textes) do',
  '  l = l:gsub("\\r$", "")',
  '  if l ~= "" then io.write(S.cle(l), "\\n") end',
  'end'
].join('\n') + '\n';

test('bibliographie : la clé d’appariement est la même en Lua et en Python', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const fTextes = path.join(TRAVAIL, 'textes.txt');
  fs.writeFileSync(fTextes, TEXTES_CLE.join('\n') + '\n', 'utf8');
  const harnais = path.join(TRAVAIL, 'harnais.lua');
  fs.writeFileSync(harnais, HARNAIS, 'utf8');

  const rLua = wsl(['pandoc', 'lua', cheminVersWsl(harnais), cheminVersWsl(DETACHEUR),
    cheminVersWsl(fTextes)]);
  assert.ok(!rLua.error, 'harnais Lua : ' + (rLua.error && rLua.error.message));
  assert.strictEqual(rLua.status, 0, 'harnais Lua sorti en ' + rLua.status + ' : ' + rLua.stderr);

  const programme = [
    'import importlib.util, io, sys',
    's = importlib.util.spec_from_file_location("dm", sys.argv[1])',
    'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
    'for l in io.open(sys.argv[2], encoding="utf-8"):',
    '    l = l.rstrip("\\n").rstrip("\\r")',
    '    if l:',
    '        sys.stdout.write(m.cle_comparaison(l) + "\\n")'
  ].join('\n');
  const fPy = path.join(TRAVAIL, 'cle.py');
  fs.writeFileSync(fPy, programme, 'utf8');
  const rPy = wsl(['env', 'PYTHONIOENCODING=utf-8', 'python3', cheminVersWsl(fPy),
    cheminVersWsl(DOCX_META), cheminVersWsl(fTextes)]);
  assert.strictEqual(rPy.status, 0, 'harnais Python sorti en ' + rPy.status + ' : ' + rPy.stderr);

  const lignes = (s) => String(s).split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
  const luaCles = lignes(rLua.stdout);
  const pyCles = lignes(rPy.stdout);
  assert.strictEqual(luaCles.length, TEXTES_CLE.length, 'le harnais Lua n’a pas tout rendu');
  const ecarts = [];
  TEXTES_CLE.forEach((texte, i) => {
    if (luaCles[i] !== pyCles[i]) {
      ecarts.push(texte + ' : pipeline « ' + luaCles[i] + ' » ≠ import « ' + pyCles[i] + ' »');
    }
  });
  assert.deepStrictEqual(ecarts, [], 'clés divergentes :\n' + ecarts.join('\n'));
  // Et la clé fait bien ce qu'on attend d'elle : les deux formes du même paragraphe, celle
  // du .docx et celle de pandoc, se retrouvent sous la même clé.
  assert.strictEqual(luaCles[0], luaCles[1],
    'le tiret insécable sépare encore les deux lectures du même paragraphe');
});

// ---- les entrées du fichier ----------------------------------------------------------

const REFS = [
  'Ebersold, S. (2013). *L’inclusion*. Bruxelles : De Boeck.',
  'Ricœur, P. (1990). *Soi-même comme un autre*. Seuil.',
  'https://doi.org/10.1234/x',
  'insieme Schweiz (2024). Wahlanleitung.',
  'Sen, A. (2001). Éthique. PUF.',
  'Sen, A. (2001). Autre texte, même année. PUF.'
];

test('bibliographie : le fichier donne les mêmes entrées que le corps les donnait', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-biblio-'));
  const article = path.join(dossier, 'articles', '01-essai');
  fs.mkdirSync(article, { recursive: true });
  fs.writeFileSync(path.join(article, '01-essai.biblio.md'), REFS.join('\n\n') + '\n');

  const duFichier = cit.referencesDuFichier(dossier, '01-essai');
  // Le corps, tel qu'un article importé avant ce changement le porte encore.
  const duTexte = cit.referencesDuTexte(['# Titre', '', 'Un appel (Sen, 2001).', '',
    '# Références', ''].concat(REFS.map((r) => r + '\n')).join('\n'));
  assert.deepStrictEqual(duFichier.map((e) => e.id), duTexte.map((e) => e.id));
  // Les identifiants relevés sur la sortie réelle du filtre : la ligne d'URL seule est une
  // suite, pas une entrée, et deux fois le même auteur la même année se départagent.
  assert.deepStrictEqual(duFichier.map((e) => e.id), [
    'ref-ebersold-2013', 'ref-ricoeur-1990', 'ref-insieme-2024',
    'ref-sen-2001', 'ref-sen-2001-b'
  ]);
  assert.match(duFichier[1].texte, /Seuil\. https:/);
});

test('bibliographie : pas de fichier n’est pas une liste vide', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-biblio-'));
  fs.mkdirSync(path.join(dossier, 'articles', '01-essai'), { recursive: true });
  // null, et non [] : l'appelant a un repli à tenter sur le corps, et il doit pouvoir le
  // distinguer d'un article dont la bibliographie est vide.
  assert.strictEqual(cit.referencesDuFichier(dossier, '01-essai'), null);
  assert.strictEqual(cit.nomFichierBiblio('01-essai'), '01-essai.biblio.md');
});

// ---- le titre : un réglage, et une seule source pour ses défauts ---------------------

test('titre de la bibliographie : les défauts viennent du filtre, pas d’une copie', () => {
  const defauts = cit.titresBiblioDefaut();
  // Les valeurs relevées sur le corpus des 421 galleys : « Literatur » dans les 230 articles
  // à bibliographie de la Zeitschrift, « Références » dans 69 des 73 de la Revue.
  assert.strictEqual(defauts.revue.fr, 'Références');
  assert.strictEqual(defauts.zeitschrift.de, 'Literatur');
  for (const revue of cit.REVUES_BIBLIO) {
    for (const langue of cit.LANGUES_BIBLIO) {
      assert.ok(String((defauts[revue] || {})[langue] || '').length > 2,
        'aucun titre par défaut pour ' + revue + '/' + langue);
    }
  }
  // Et le cockpit n'en tient pas de copie : c'est la faute qui a déjà coûté un repli
  // divergent entre les deux langages.
  // Les commentaires ont le droit de nommer un titre — c'est le code qui n'a pas le droit
  // d'en porter un.
  const src = lire('vscodium-extension', 'szh-cockpit', 'lib', 'citations.js')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const titre of ['Références', 'Literatur', 'Bibliografia']) {
    assert.strictEqual(src.indexOf(titre), -1,
      'lib/citations.js recopie le titre par défaut « ' + titre + ' »');
  }
  const filtre = lire('pipeline', 'filters', 'szh-citations.lua');
  assert.match(filtre, /local TITRES_BIBLIO_DEFAUT = \{/);
});

test('titre de la bibliographie : un champ vidé vaut « aucun titre »', () => {
  const pose = cit.normaliserConfigBiblio({
    biblio: { titres: { revue: { fr: 'Bibliographie', de: '' } } }
  });
  assert.strictEqual(pose.titres.revue.fr, 'Bibliographie');
  assert.strictEqual(pose.titres.revue.de, '', 'un champ vidé est revenu à son défaut');
  // L'autre revue n'a pas bougé : la fusion est clé par clé.
  assert.strictEqual(pose.titres.zeitschrift.de, cit.titresBiblioDefaut().zeitschrift.de);
});

test('titre de la bibliographie : l’écriture ne touche pas au reste de la configuration', () => {
  const avant = { emplacementRevues: 'onedrive', devMode: true,
    ojs: { revues: { fr: { televerseur: 'redaction' } } },
    biblio: { autreChose: 42 } };
  const apres = cit.configAvecTitresBiblio(avant, { revue: { fr: 'Sources' } });
  assert.strictEqual(apres.emplacementRevues, 'onedrive');
  assert.strictEqual(apres.devMode, true);
  assert.deepStrictEqual(apres.ojs, avant.ojs);
  assert.strictEqual(apres.biblio.autreChose, 42);
  assert.strictEqual(apres.biblio.titres.revue.fr, 'Sources');
  // Et l'objet d'origine n'est pas modifié : l'appelant relit config.json avant d'écrire.
  assert.strictEqual(avant.biblio.titres, undefined);
});

// ---- la devinette est partie ---------------------------------------------------------

test('la bibliographie ne se devine plus : ni préfixe, ni seconde moitié', () => {
  const filtre = lire('pipeline', 'filters', 'szh-citations.lua');
  // Le balayage de la seconde moitié du document n'existe plus. Il se reconnaissait à sa
  // borne, et c'est elle qu'on interdit de revenir.
  assert.ok(!/#blocs \* 0%.5|math%.floor\(#blocs/.test(filtre.replace(/%/g, '%')),
    'le filtre balaie encore la seconde moitié du document');
  assert.ok(filtre.indexOf('math.floor(#blocs') === -1,
    'le filtre balaie encore la seconde moitié du document');
  // La comparaison des titres est exacte : « Literaturhinweise für die Praxis » n'est pas un
  // titre de bibliographie, et la prose qui le suit doit rester du texte.
  assert.strictEqual(cit.estTitreBib('Literaturhinweise für die Praxis'), false);
  assert.strictEqual(cit.estTitreBib('Literaturhinweise'), true);
  assert.strictEqual(cit.estTitreBib('Références bibliographiques'), true);
  assert.strictEqual(cit.estTitreBib('Introduction'), false);
  // Le repli sur le corps existe encore, pour les articles importés avant ce changement,
  // mais il AVERTIT : ce n'est pas un chemin normal.
  assert.match(filtre, /biblio-dans-le-corps/);
});

test('la chaîne connaît le fichier de bibliographie de bout en bout', () => {
  const nom = cit.nomFichierBiblio('$(notdir $*)');
  assert.ok(nom.endsWith('.biblio.md'));
  // L'import le produit…
  const sh = lire('pipeline', 'import-docx.sh');
  assert.match(sh, /szh-biblio-detacher\.lua/);
  assert.match(sh, /\.biblio\.md/);
  const detacheur = lire('pipeline', 'filters', 'szh-biblio-detacher.lua');
  assert.match(detacheur, /'\.biblio\.md'/);
  // …docx-meta.py en décide l'étendue par les STYLES, et l'écrit en lignes B…
  const meta = lire('pipeline', 'docx-meta.py');
  assert.match(meta, /def etendue_biblio/);
  assert.match(meta, /'B\\t%s\\n'/);
  // …le Makefile en fait un prérequis des deux rendus, sinon l'éditer ne recompilerait rien…
  const mk = lire('pipeline', 'Makefile');
  assert.strictEqual((mk.match(/\.biblio\.md\)/g) || []).length, 2,
    'le fichier de bibliographie n’est pas prérequis des deux rendus');
  // …et szh-citations le résout en dernier, après la numérotation des sections : le titre
  // d'une bibliographie ne porte pas de numéro.
  const ordre = mk.indexOf('szh-sections.lua" \\\n\t  --lua-filter="$(PIPELINE_DIR)/filters/szh-citations.lua"');
  assert.ok(ordre !== -1, 'szh-citations ne ferme plus la chaîne après szh-sections');
});

// ---- la bibliographie dans l'arbre ---------------------------------------------------

test('arbre : la bibliographie est un enfant de l’article, sans description', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  // Elle est rendue à côté des tableaux, par le même fournisseur d'enfants.
  assert.match(src, /_itemBiblio\(slug\)/);
  assert.match(src, /const biblio = this\._itemBiblio\(slug\);/);
  // Aucune description : ni le poids d'un tableau, ni un compteur de références. La colonne
  // reste vide, et ce qui s'y affichera un jour aura donc du sens.
  const bloc = src.slice(src.indexOf('_itemsTables(slug) {'), src.indexOf('_itemBiblio(slug) {'));
  assert.ok(bloc.indexOf('it.description') === -1, 'le tableau porte encore une description');
  const blocBiblio = src.slice(src.indexOf('_itemBiblio(slug) {'),
    src.indexOf('_itemBiblio(slug) {') + 1200);
  assert.ok(blocBiblio.indexOf('it.description') === -1,
    'l’entrée de bibliographie porte une description');
  // Sans fichier, pas d'entrée : une entrée morte ferait croire à une liste vide.
  assert.match(blocBiblio, /if \(!fs\.existsSync\(chemin\)\) \{ return null; \}/);
  // Et l'article devient dépliable pour elle, même sans tableau.
  assert.match(src, /\|\| fs\.existsSync\(cheminBiblio\(this\.racine, slug\)\)/);
});

// ---- le panneau des Réglages, réellement rendu ---------------------------------------

test('réglages : une case par revue et par langue, et un champ vidé se voit', () => {
  const { ouvrir, libellesHote } = require('./dom-minimal');
  const page = ouvrir({
    racine: RACINE, page: 'settings', cssPartage: ['_design.css'],
    txt: libellesHote(RACINE, ['REGL_LIBELLES'])
  });
  // Même charge utile que donneesBiblio() de extension.js.
  const biblio = {
    titres: cit.normaliserConfigBiblio({ biblio: { titres: { revue: { de: '' } } } }).titres,
    revues: cit.REVUES_BIBLIO.map((cle) => ({ cle: cle, libelle: cle })),
    langues: cit.LANGUES_BIBLIO.map((cle) => ({ cle: cle, libelle: cle }))
  };
  page.envoyer({ type: 'valeurs', valeurs: { langue: 'fr' }, biblio: biblio });
  const bloc = page.parId.biblio;
  assert.ok(bloc, 'le bloc « Bibliographie » n’est pas dans la page');
  const cases = bloc.querySelectorAll('[data-biblio-revue]');
  assert.strictEqual(cases.length, cit.REVUES_BIBLIO.length * cit.LANGUES_BIBLIO.length,
    'une case par revue et par langue attendue');
  const valeurs = cases.map((e) => e.value);
  assert.ok(valeurs.indexOf('Références') !== -1 && valeurs.indexOf('Literatur') !== -1,
    'les titres par défaut ne sont pas dans le panneau : ' + valeurs.join(' | '));
  // Un champ vidé se voit : c'est une bibliographie sans titre, pas une valeur oubliée.
  assert.strictEqual(bloc.querySelectorAll('input.vide').length, 1,
    'le champ vidé n’est pas marqué');
});

// ---- l'arbre, réellement construit ---------------------------------------------------

test('arbre : l’hôte activé montre la bibliographie sous son article, et rien sans elle',
  async () => {
    const { revueDEssai, activerHote } = require('./hote-factice');
    const revue = revueDEssai();
    const hote = activerHote(revue);
    const arbre = hote.arbre();
    assert.ok(arbre, 'aucun fournisseur d’arbre');
    // L'activation pose la racine sur une promesse : sans ce tour de boucle, l'arbre est
    // encore vide et le contrôle ne mesurerait rien.
    for (let i = 0; i < 20 && (await arbre.getChildren()).length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    const racine = await arbre.getChildren();
    const section = racine.find((it) => it.contextValue === 'section-articles');
    const articles = await arbre.getChildren(section);
    const avec = articles.find((it) => it.slug === '01-essai');
    const sans = articles.find((it) => it.slug === '02-sans-fiche');
    assert.ok(avec && sans, 'les deux articles d’essai ne sont pas dans l’arbre');

    const enfants = await arbre.getChildren(avec);
    const biblio = enfants.find((it) => it.contextValue === 'biblio');
    assert.ok(biblio, 'aucune entrée de bibliographie : '
      + enfants.map((e) => e.contextValue).join(', '));
    // À côté des tableaux, et après eux.
    assert.strictEqual(enfants[0].contextValue, 'table');
    assert.strictEqual(enfants[enfants.length - 1], biblio);
    assert.strictEqual(biblio.label, '01-essai.biblio.md');
    // Aucune description, ni sur elle ni sur les tableaux.
    for (const it of enfants) {
      assert.ok(!it.description, 'description inattendue sur « ' + it.label + ' »');
    }
    // Un clic l'ouvre en texte, dans la colonne du .md — la colonne 2 appartient à l'aperçu.
    assert.strictEqual(biblio.command.command, 'vscode.open');
    assert.strictEqual(biblio.command.arguments[0].fsPath,
      path.join(revue, 'articles', '01-essai', '01-essai.biblio.md'));
    assert.strictEqual(biblio.command.arguments[1].viewColumn, 1);

    // L'article sans bibliographie : pas d'entrée, et rien qui laisse croire à une liste
    // vide. Il n'a pas de tableau non plus, il n'est donc même pas dépliable.
    assert.deepStrictEqual(await arbre.getChildren(sans), []);
  });

// ---- l'intégrité, mesurée sur un vrai document ---------------------------------------
//
// Le contrôle qui compte : sur un .docx du corpus, le compte de références détachées est
// celui que les styles annoncent. C'est la règle d'or de la chaîne — aucune référence
// perdue — et elle se mesure, elle ne se raisonne pas.
const CORPUS = path.join(RACINE, 'tmp', 'corpus-ojs');

test('intégrité : sur un .docx réel, tout ce que les styles annoncent est détaché', (t) => {
  if (!fs.existsSync(CORPUS)) {
    // Le corpus vit hors du dépôt (750 Mo). Sans lui, ce contrôle ne peut pas se faire, et
    // il le dit plutôt que de passer.
    return t.skip('corpus hors dépôt absent : ' + CORPUS);
  }
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const docx = trouverUnDocx(CORPUS);
  if (!docx) { return t.skip('aucun .docx dans ' + CORPUS); }

  const revue = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-biblio-import-'));
  fs.mkdirSync(path.join(revue, 'articles-word'), { recursive: true });
  fs.copyFileSync(docx, path.join(revue, 'articles-word', 'essai.docx'));
  fs.copyFileSync(path.join(RACINE, 'revue-template', 'ausgabe.yaml'),
    path.join(revue, 'ausgabe.yaml'));
  // import-docx.sh travaille depuis la racine du numéro : on l'y emmène par un sous-shell,
  // comme le fait la cible d'import.
  const pipe = cheminVersWsl(path.join(RACINE, 'pipeline'));
  const rr = wsl(['sh', '-c',
    'cd ' + JSON.stringify(cheminVersWsl(revue))
    + ' && PYTHONIOENCODING=utf-8 bash ' + JSON.stringify(pipe + '/import-docx.sh')
    + ' articles-word/essai.docx essai ' + JSON.stringify(pipe)]);
  assert.strictEqual(rr.status, 0, 'import en échec : ' + rr.stderr);
  const journal = String(rr.stderr) + String(rr.stdout);
  const m = journal.match(/biblio-detachee \| [^|]*\| attendus (\d+) \| detaches (\d+)/);
  assert.ok(m, 'aucun compte de détachement dans le journal de l’import :\n' + journal);
  assert.strictEqual(m[2], m[1], 'des paragraphes de bibliographie sont restés en arrière');
  const fichier = path.join(revue, 'articles', 'essai', 'essai.biblio.md');
  assert.ok(fs.existsSync(fichier), 'le fichier de bibliographie n’a pas été écrit');
  // Le corps ne la porte plus, et il porte la référence à sa place.
  const corps = fs.readFileSync(path.join(revue, 'articles', 'essai', 'essai.md'), 'utf8');
  assert.match(corps, /::: \{\.szh-biblio src="essai\.biblio\.md"\}/);
  const entrees = cit.referencesDuFichier(revue, 'essai');
  assert.ok(entrees.length > 0, 'le fichier détaché ne porte aucune entrée');
  console.log('  ' + path.basename(docx) + ' : ' + m[1] + ' paragraphe(s) annoncé(s), '
    + m[2] + ' détaché(s), ' + entrees.length + ' entrée(s)');
});

// Un .docx du corpus qui a une bibliographie stylée : le premier dont docx-meta.py annonce
// une étendue. Cherché, et non écrit en dur : le corpus n'est pas dans le dépôt.
function trouverUnDocx(base) {
  const pile = [base];
  while (pile.length > 0) {
    const d = pile.pop();
    let entrees;
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
      const complet = path.join(d, e.name);
      if (e.isDirectory()) { pile.push(complet); }
      else if (/\.docx$/i.test(e.name)) { return complet; }
    }
  }
  return null;
}
