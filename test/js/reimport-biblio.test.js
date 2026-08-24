// La bibliographie détachée face au réimport : « l'auteur renvoie son Word, ses références
// ont changé ».
//
//   node --test "test/js/*.test.js"
//
// LE DÉFAUT RÉPARÉ ICI, mesuré avant de l'écrire : depuis que l'import détache les
// références dans <slug>.biblio.md, un Word dont SEULE la bibliographie changeait était
// jugé « rien à faire » (code 3), son fichier consommé, et la correction de l'auteur jetée
// sans un mot. C'est exactement la perte silencieuse que le réimport existe pour empêcher.
//
// Ce fichier surveille les endroits où elle redeviendrait possible :
//   * « rien à faire » cesserait de comparer le fichier de bibliographie ;
//   * la liste blanche de ce que le Word possède l'oublierait — la bibliographie vient des
//     styles du Word, donc du Word, et c'est cette liste qui décide de ce qui est remplacé ;
//   * les empreintes noteraient la version INSTALLÉE et non celle que le Word a livrée :
//     une bibliographie gardée passerait au réimport suivant pour une correction de
//     l'auteur, et le même faux conflit se rouvrirait à chaque fois ;
//   * un conflit serait résolu en silence, alors que l'arborescence du cockpit invite
//     désormais à corriger ce fichier à la main ;
//   * l'encadré rouge de « bibliographie introuvable » perdrait son style, la règle de
//     print.css ne connaissant plus la classe que le filtre pose.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

const PY = lire('pipeline', 'reimporter.py');
const CSS = lire('pipeline', 'styles', 'print.css');
const CITATIONS = lire('pipeline', 'filters', 'szh-citations.lua');
const SH = lire('pipeline', 'import-docx.sh');

const LF = String.fromCharCode(10);
const SCRIPT = path.join(RACINE, 'pipeline', 'reimporter.py');
const SLUG = '01-essai';

// ---- Ce que le modèle exige d'être écrit ----

test('bibliographie : « rien à faire » la compare, sans quoi la correction est jetée', () => {
  const bloc = PY.slice(PY.indexOf('def rien_a_faire('), PY.indexOf('def pause_eventuelle('));
  assert.ok(bloc.length > 0, 'la comparaison « rien à faire » a disparu');
  assert.match(bloc, /memes_octets\(os\.path\.join\(vivant, nom_biblio\(slug\)\),\s*os\.path\.join\(temp, nom_biblio\(slug\)\)\)/,
    'la bibliographie n’est plus comparée : un Word dont seules les références changent '
    + 'serait jugé sans effet, consommé, et la correction de l’auteur jetée — c’est le '
    + 'défaut mesuré, il ne doit pas revenir');
  // Le fichier est nommé à un seul endroit, comme szh-biblio-detacher.lua le nomme à
  // l'import : deux formations du nom finiraient par diverger.
  assert.match(PY, /def nom_biblio\(slug\):\s*\n\s*return slug \+ '\.biblio\.md'/,
    'le nom du fichier de bibliographie n’est plus formé en un seul endroit');
  assert.match(SH, /<slug>\.biblio\.md/,
    'la chaîne d’import ne parle plus du fichier de bibliographie');
});

test('bibliographie : les empreintes notent ce que le Word a livré', () => {
  // La subtilité qui évite un faux conflit perpétuel : l'empreinte décrit la version du
  // Word, jamais celle qui est installée quand la rédaction a gagné l'arbitrage.
  assert.match(PY, /def fusionner_biblio\(vivant, temp, empreintes, slug\)/,
    'la décision sur la bibliographie a disparu');
  assert.match(PY, /lignes\.append\('biblio\\t%s\\t%s' % \(biblio, nom_biblio\(slug\)\)\)/,
    'l’empreinte de la bibliographie n’est plus écrite : le réimport ne pourrait plus '
    + 'distinguer une correction de la rédaction d’une correction de l’auteur');
  assert.match(PY, /elif champs\[0\] == 'biblio' and len\(champs\) >= 2:/,
    'l’empreinte de la bibliographie n’est plus relue');
  // Sans empreinte, on ne peut pas savoir : toute différence est un conflit, et on le dit.
  assert.match(PY, /retravaillee = emp is None or emp != sha_ancien/,
    'sans empreinte, une bibliographie différente n’est plus comptée comme retravaillée : '
    + 'le travail de la rédaction disparaîtrait sans un mot');
  assert.match(PY, /'biblio-origine-inconnue'/,
    'le cas « importé avant ce suivi » n’est plus nommé : la rédaction serait accusée '
    + 'd’avoir retouché un fichier qu’elle n’a pas touché');
});

test('bibliographie : les trois états sont écrits, et le conflit est nommé', () => {
  const bloc = PY.slice(PY.indexOf('def fusionner_biblio('),
    PY.indexOf('def copier_preserves('));
  // Gardée : la version d'ici est recopiée dans le chantier. Sans cette copie, la
  // bibliographie disparaîtrait de l'article — la liste blanche l'exclut de la recopie.
  assert.match(bloc, /shutil\.copyfile\(ancien, neuf\)/,
    'la version de la rédaction n’est plus réinstallée dans le chantier : l’article '
    + 'perdrait sa bibliographie');
  assert.match(bloc, /bilan\['gardee'\] = 1/, 'l’état « gardée » a disparu');
  assert.match(bloc, /bilan\['remplacee'\] = 1/, 'l’état « remplacée » a disparu');
  assert.match(bloc, /bilan\['conflit'\] = 1/, 'l’état « conflit » a disparu');
  for (const code of ['biblio-conflit', 'biblio-retiree', 'biblio-origine-inconnue']) {
    assert.ok(PY.indexOf("'" + code + "'") !== -1,
      'le code « ' + code + ' » a disparu : la perte redeviendrait silencieuse');
  }
  // Chaque avertissement dit où retrouver la version d'avant.
  assert.ok(PY.indexOf("biblio_avant = resultat['rebut'] + '/article-avant/' + nom_biblio(slug)") !== -1,
    'les avertissements ne donnent plus le chemin de la bibliographie d’avant');
});

test('bibliographie : aucun message du réimport ne part sans son allemand', () => {
  // Les trois codes neufs passent par avertir(code, champs, fr, de) : la signature exige
  // les deux langues. On vérifie ici l'orthographe suisse et le format à codes.
  const bloc = PY.slice(PY.indexOf("biblio_avant = resultat['rebut']"),
    PY.indexOf('# 6. Tout ce que le Word ne possède pas revient'));
  assert.ok(bloc.length > 0, 'les messages de la bibliographie ont disparu');
  assert.strictEqual((bloc.match(/\[de\] |voix\.dire\(|voix\.avertir\(/g) || []).length > 0, true);
  assert.strictEqual(bloc.indexOf('ß'), -1, 'orthographe allemande : « ss », jamais « ß »');
  // Un message qui nomme un chemin de venv, un filtre .lua ou un code de sortie a échoué.
  for (const bruit of ['.lua', 'sha256', 'SZH_', 'code 3', 'venv']) {
    assert.strictEqual(bloc.indexOf(bruit), -1,
      'un message destiné au rédacteur nomme « ' + bruit + ' »');
  }
});

test('bibliographie introuvable : l’encadré rouge est bien celui de print.css', () => {
  // Le filtre pose les classes ; print.css doit les habiller. Sans ce contrôle, la classe
  // juste (szh-biblio-manquante) pouvait rester sans style, et l'avertissement se lisait
  // comme une phrase de l'article.
  const marqueur = /pandoc\.Attr\('',\s*\{([^}]*)\},\s*\{\}\)\s*\)\s*\nend/.exec(
    CITATIONS.slice(CITATIONS.indexOf('local function bloc_manquant')));
  assert.ok(marqueur, 'le marqueur de bibliographie non résolue a changé de forme');
  const classes = marqueur[1].split(',').map((s) => s.trim().replace(/'/g, ''))
    .filter(Boolean);
  assert.ok(classes.indexOf('szh-biblio-manquante') !== -1,
    'le marqueur ne porte plus la classe qui le nomme');
  // Le sélecteur de la règle, tel que print.css l'écrit : chaque classe posée doit y être.
  const regle = /((?:\.[\w-]+,\s*)*\.[\w-]+)\s*\{\s*\n\s*border-left: 4px solid #b3261e;/
    .exec(CSS);
  assert.ok(regle, 'la règle de l’encadré « fichier introuvable » a disparu de print.css');
  const selecteurs = regle[1].split(',').map((s) => s.trim().replace(/^\./, ''));
  for (const classe of classes) {
    assert.ok(selecteurs.indexOf(classe) !== -1,
      'print.css n’habille pas « ' + classe + ' » : l’encadré rouge de « bibliographie '
      + 'introuvable » passerait pour du texte courant');
  }
  // Les couleurs de la paire d'alerte sont mesurées par test/apca-check.py : la règle les
  // garde, on ne fait que lui joindre un sélecteur.
  assert.match(CSS, /background: #fdecea;/,
    'la paire d’alerte a changé de couleur : test/apca-check.py la mesure');
});

// ---- Les états, mesurés en EXÉCUTANT le script ----
//
// Une conversion factice joue le Word corrigé : elle recopie un corps et une bibliographie
// depuis un dossier de fixtures. --pipeline permet de la substituer sans toucher à la
// chaîne réelle, et $SZH_IMPORT_DIR est la seule couture nécessaire.

function interpretePython() {
  for (const commande of ['python3', 'python']) {
    const r = cp.spawnSync(commande, ['--version'], { encoding: 'utf8' });
    if (!r.error && /Python 3/.test(String(r.stdout || '') + String(r.stderr || ''))) {
      return commande;
    }
  }
  return null;
}

// Un bash qui comprend les chemins que Python lui passera : sous Windows, `bash` est
// souvent la passerelle WSL, qui ne sait rien d'un chemin « C:\… ».
function bashCompatible() {
  let dossier = null;
  try {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-sonde-'));
    const script = path.join(dossier, 'sonde.sh');
    fs.writeFileSync(script, '#!/bin/bash' + LF + 'exit 7' + LF);
    const r = cp.spawnSync('bash', [script], { encoding: 'utf8' });
    return !r.error && r.status === 7;
  } catch (e) {
    return false;
  } finally {
    if (dossier) { fs.rmSync(dossier, { recursive: true, force: true }); }
  }
}

const PYTHON = interpretePython();

const REFS_IMPORT = ['Aeschlimann, B. (2020). Un titre.', '',
  'Baumgartner, C. (2021). Un autre.', ''].join(LF);
const REFS_CORRIGEE = ['Aeschlimann, B. (2021). Un titre corrigé.', '',
  'Baumgartner, C. (2021). Un autre.', ''].join(LF);
const REFS_MAIN = ['Aeschlimann, B. (2020). Un titre.', '',
  'Baumgartner, C. (2021). Un autre.', '',
  'Zwahlen, D. (2022). Ajoutée à la main par la rédaction.', ''].join(LF);
const CORPS = ['# Essai', '', 'Un corps.', '',
  '::: {.szh-biblio src="' + SLUG + '.biblio.md"}', ':::', ''].join(LF);

function lancer(racine, args, extra) {
  const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, extra || {});
  return cp.spawnSync(PYTHON, [SCRIPT].concat(args),
    { cwd: racine, encoding: 'utf8', env: env });
}

function jsonDeLaSortie(sortie) {
  const lignes = String(sortie || '').split(/\r?\n/).filter((l) => l.trim().charAt(0) === '{');
  return lignes.length === 1 ? JSON.parse(lignes[0]) : null;
}

// Une revue jetable dont l'article a été importé : c'est le script lui-même qui note les
// empreintes, comme la conversion le fait en fin d'import.
function revueImportee(bibliolivree, bibliolInstallee) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-biblio-'));
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), 'nummer: "2026-03"' + LF);
  fs.mkdirSync(path.join(racine, 'articles-word'), { recursive: true });
  const dossier = path.join(racine, 'articles', SLUG);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, SLUG + '.md'), CORPS);
  fs.writeFileSync(path.join(dossier, SLUG + '.meta.yaml'),
    ['type: article', 'lang: fr', 'source: "essai.docx"', 'title:', '  fr: "Un essai"', '']
      .join(LF));
  if (bibliolivree !== null) {
    fs.writeFileSync(path.join(dossier, SLUG + '.biblio.md'), bibliolivree);
  }
  const r = lancer(racine, ['--empreintes', '--dossier', path.join('articles', SLUG),
    '--slug', SLUG, '--word', 'essai.docx']);
  assert.strictEqual(r.status, 0, 'les empreintes de l’import ne s’écrivent plus');
  // Puis la rédaction corrige le fichier à la main, si le cas le demande.
  if (bibliolInstallee) {
    fs.writeFileSync(path.join(dossier, SLUG + '.biblio.md'), bibliolInstallee);
  }
  return racine;
}

// Le Word corrigé : un dossier de fixtures et une conversion factice qui les recopie.
function reimporter(racine, corps, biblio) {
  const faux = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pipeline-'));
  fs.writeFileSync(path.join(faux, 'import-docx.sh'), [
    '#!/bin/bash',
    'set -u',
    'DIR="${SZH_IMPORT_DIR:?}"',
    'SRC="${SZH_FIXTURES:?}"',
    'mkdir -p "$DIR/media" "$DIR/tables"',
    'cp "$SRC/corps.md" "$DIR/$2.md"',
    'if [ -f "$SRC/biblio.md" ]; then cp "$SRC/biblio.md" "$DIR/$2.biblio.md"; fi',
    'exit 0', ''].join(LF));
  const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-word-'));
  fs.writeFileSync(path.join(fixtures, 'corps.md'), corps);
  if (biblio !== null) { fs.writeFileSync(path.join(fixtures, 'biblio.md'), biblio); }
  fs.writeFileSync(path.join(racine, 'articles-word', 'essai.docx'), 'pas un docx');
  const r = lancer(racine, ['--article', SLUG, '--pipeline', faux],
    { SZH_FIXTURES: fixtures.split(path.sep).join('/') });
  fs.rmSync(faux, { recursive: true, force: true });
  fs.rmSync(fixtures, { recursive: true, force: true });
  return { r: r, j: jsonDeLaSortie(r.stdout) };
}

const biblioVivante = (racine) => {
  try {
    return fs.readFileSync(path.join(racine, 'articles', SLUG, SLUG + '.biblio.md'), 'utf8');
  } catch (e) { return null; }
};

const empreintesDe = (racine) => {
  try {
    return fs.readFileSync(path.join(racine, 'articles', SLUG, '.szh-import.empreintes'),
      'utf8');
  } catch (e) { return ''; }
};

// Le sha noté pour la bibliographie, tel que le fichier d'empreintes le porte.
function shaBiblioNote(racine) {
  const m = /^biblio\t([0-9a-f]{64})\t/m.exec(empreintesDe(racine));
  return m ? m[1] : null;
}

test('bibliographie : un Word dont SEULES les références changent est réimporté', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé (python3, puis python) : ce contrôle '
    + 'mesure un code de sortie, il ne peut pas être sauté en silence');
  if (!bashCompatible()) {
    assert.ok(SH.indexOf('SZH_IMPORT_DIR') !== -1,
      'la couture de la conversion a disparu, et ce poste ne peut pas la mesurer');
    return;
  }
  const racine = revueImportee(REFS_IMPORT, null);
  try {
    const { r, j } = reimporter(racine, CORPS, REFS_CORRIGEE);
    assert.strictEqual(r.status, 0, 'sortie ' + r.status + ' : un Word dont seule la '
      + 'bibliographie change est encore jugé sans effet, et la correction de l’auteur est '
      + 'jetée — c’est le défaut mesuré');
    assert.strictEqual(j.resultat, 'reussi');
    assert.ok(biblioVivante(racine).indexOf('Un titre corrigé') !== -1,
      'la correction de l’auteur n’est pas arrivée dans l’article');
    assert.deepStrictEqual(j.biblio,
      { gardee: 0, remplacee: 1, conflit: 0, retiree: 0, nouvelle: 0, inconnue: 0 },
      'l’état de la bibliographie n’est pas « remplacée » : personne n’avait retouché ici');
    assert.deepStrictEqual(j.avertissements, [],
      'un remplacement sans perte ne doit rien signaler');
    // La version d'avant reste retrouvable, même quand rien ne la réclame.
    assert.ok(fs.readFileSync(path.join(racine, j.rebut, 'article-avant',
      SLUG + '.biblio.md'), 'utf8').indexOf('Un titre.') !== -1,
      'la bibliographie d’avant n’est pas dans la sauvegarde');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliographie : « rien à faire » reste « rien à faire » quand rien ne change', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');
  if (!bashCompatible()) { return; }
  const racine = revueImportee(REFS_IMPORT, null);
  try {
    const { r, j } = reimporter(racine, CORPS, REFS_IMPORT);
    assert.strictEqual(r.status, 3, 'sortie ' + r.status + ' : un Word qui ne change rien '
      + 'doit rendre 3, sans quoi le cockpit peindrait un remplacement qui n’a pas eu lieu');
    assert.strictEqual(j.resultat, 'rien');
    assert.deepStrictEqual(fs.readdirSync(path.join(racine, 'articles-word'))
      .filter((n) => n.endsWith('.docx')), [],
      'le Word examiné reste en attente : il serait signalé à chaque compilation');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliographie gardée : le Word livre les mêmes références qu’à l’import', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');
  if (!bashCompatible()) { return; }
  const racine = revueImportee(REFS_IMPORT, REFS_MAIN);
  try {
    const shaImport = shaBiblioNote(racine);
    const { r, j } = reimporter(racine, CORPS + LF + 'Un paragraphe de plus.' + LF,
      REFS_IMPORT);
    assert.strictEqual(r.status, 0, 'sortie ' + r.status);
    assert.strictEqual(j.biblio.gardee, 1, 'la version de la rédaction n’a pas été gardée');
    assert.ok(biblioVivante(racine).indexOf('Ajoutée à la main') !== -1,
      'la référence ajoutée à la main a disparu alors que l’auteur n’avait rien changé');
    assert.deepStrictEqual(j.avertissements, [],
      'une bibliographie gardée n’a rien à signaler');
    // ⚠ Le point qui compte : l'empreinte notée est celle du WORD, pas celle du fichier
    // installé. Sinon le réimport suivant croirait à une correction de l'auteur.
    assert.strictEqual(shaBiblioNote(racine), shaImport,
      'l’empreinte notée est celle du fichier installé : le prochain réimport rouvrirait '
      + 'le même faux conflit, et à chaque fois');
    const deux = reimporter(racine, CORPS + LF + 'Un paragraphe de plus.' + LF, REFS_IMPORT);
    assert.strictEqual(deux.r.status, 3, 'le même Word, une deuxième fois, ne rend plus 3');
    assert.deepStrictEqual(deux.j.avertissements, [],
      'un faux conflit s’est rouvert au réimport suivant');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliographie en conflit : les deux ont bougé, le Word gagne et on le dit', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');
  if (!bashCompatible()) { return; }
  const racine = revueImportee(REFS_IMPORT, REFS_MAIN);
  try {
    const { r, j } = reimporter(racine, CORPS, REFS_CORRIGEE);
    assert.strictEqual(r.status, 0, 'sortie ' + r.status);
    assert.strictEqual(j.biblio.conflit, 1, 'le conflit n’est pas compté');
    assert.deepStrictEqual(j.avertissements, ['biblio-conflit'],
      'le conflit n’est pas nommé : la rédaction perdrait son travail sans un mot');
    assert.ok(biblioVivante(racine).indexOf('Un titre corrigé') !== -1,
      'ce n’est pas la version du Word qui est en place, alors que le texte parle d’elle');
    // La version d'avant est retrouvable, et le message donne son chemin.
    const avant = path.join(racine, j.rebut, 'article-avant', SLUG + '.biblio.md');
    assert.ok(fs.readFileSync(avant, 'utf8').indexOf('Ajoutée à la main') !== -1,
      'la version de la rédaction n’est pas dans la sauvegarde');
    const ligne = String(r.stderr).split(/\r?\n/)
      .filter((l) => l.indexOf('biblio-conflit') !== -1)[0] || '';
    assert.ok(ligne.indexOf(j.rebut.split('/').join('/')) !== -1,
      'l’avertissement ne dit pas où retrouver la version d’avant');
    assert.ok(ligne.indexOf('[de] ') !== -1, 'l’avertissement part sans son allemand');
    assert.ok(ligne.indexOf('[import-avertissement] biblio-conflit | ') === 0,
      'l’avertissement ne suit plus le format à codes que l’interface reconnaît');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliographie retirée : le Word n’en détache plus, et la perte est nommée', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');
  if (!bashCompatible()) { return; }
  const racine = revueImportee(REFS_IMPORT, REFS_MAIN);
  try {
    // Les références de ce Word ne portent plus le style : leur liste reste dans le corps.
    const { r, j } = reimporter(racine,
      ['# Essai', '', 'Un corps.', '', 'Aeschlimann, B. (2020). Un titre.', ''].join(LF),
      null);
    assert.strictEqual(r.status, 0, 'sortie ' + r.status);
    assert.strictEqual(j.biblio.retiree, 1, 'le retrait n’est pas compté');
    assert.deepStrictEqual(j.avertissements, ['biblio-retiree'],
      'le fichier de bibliographie s’en va sans que rien ne le nomme');
    assert.strictEqual(biblioVivante(racine), null,
      'le fichier de bibliographie survit alors que le Word ne le livre plus : il ne '
      + 'serait plus référencé par personne');
    assert.ok(fs.readFileSync(path.join(racine, j.rebut, 'article-avant',
      SLUG + '.biblio.md'), 'utf8').indexOf('Ajoutée à la main') !== -1,
      'la bibliographie retirée n’est pas dans la sauvegarde');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('bibliographie : « Annuler le réimport » la remet avec le reste', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');
  if (!bashCompatible()) { return; }
  const racine = revueImportee(REFS_IMPORT, REFS_MAIN);
  try {
    const { r } = reimporter(racine, CORPS, REFS_CORRIGEE);
    assert.strictEqual(r.status, 0, 'sortie ' + r.status);
    const annule = lancer(racine, ['--annuler', '--article', SLUG]);
    assert.strictEqual(annule.status, 0, 'l’annulation sort sur ' + annule.status);
    assert.ok(biblioVivante(racine).indexOf('Ajoutée à la main') !== -1,
      'l’annulation ne remet pas la bibliographie d’avant : la réversibilité serait '
      + 'partielle, et c’est le pire des états');
    assert.match(empreintesDe(racine), /^biblio\t/m,
      'les empreintes revenues ne portent plus la bibliographie');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});
