// Contrôles du réimport d'un article : « l'auteur renvoie son Word corrigé ».
//
//   node --test "test/js/*.test.js"
//
// Le défaut réparé : l'original était supprimé à l'import, et republier une correction
// voulait dire renommer, réimporter, puis recopier la fiche à la main. La cible
// `reimporter` remplace le corps et laisse tout le reste en place.
//
// Ce fichier surveille les endroits où la fonction redeviendrait dangereuse en silence :
//   * la conversion écrirait dans l'article vivant au lieu du chantier ($SZH_IMPORT_DIR) ;
//   * les empreintes noteraient l'état INSTALLÉ et non ce que le Word a livré — chaque
//     réimport rouvrirait alors le même faux conflit sur un tableau gardé ;
//   * la liste blanche de ce que le Word possède s'élargirait, et un sidecar de la
//     rédaction (tâches, traduction) partirait avec le corps ;
//   * le chantier perdrait son point de tête et le Makefile compilerait un demi-article ;
//   * la reprise passerait après l'appariement : un réimport tué en pleine bascule laisse
//     articles/<slug> absent, on répondrait « cet article n'existe pas » au lieu de le
//     secourir. C'est arrivé, et c'est la raison de ce contrôle ;
//   * un message partirait sans son allemand, ou la ligne JSON du cockpit se retrouverait
//     noyée dans du bavardage sur stdout.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

const PY = lire('pipeline', 'reimporter.py');
const SH = lire('pipeline', 'import-docx.sh');
const MK = lire('pipeline', 'Makefile');
const MEDIAS = lire('pipeline', 'import-medias.py');
const TABLES = lire('pipeline', 'docx-tables.py');

// ---- Une seule chaîne d'import, deux destinations ----

test('réimport : la conversion se fait dans un chantier, jamais dans l’article vivant', () => {
  assert.match(SH, /^DIR="\$\{SZH_IMPORT_DIR:-articles\/\$SLUG\}"$/m,
    'import-docx.sh n’accepte plus de destination surchargée : le réimport écrirait dans '
    + 'l’article vivant, et une conversion ratée le laisserait à moitié remplacé');
  assert.match(PY, /env\['SZH_IMPORT_DIR'\] = os\.path\.relpath\(temp, revue\)/,
    'le réimport ne pose plus la destination du chantier');
  assert.match(PY, /'import-docx\.sh'/,
    'le réimport n’appelle plus la chaîne d’import : il y en aurait deux à garder d’accord');
});

test('réimport : le chantier et la bascule sont invisibles du build', () => {
  // SLUGS passe par $(wildcard articles/*), qui ignore les noms à point de tête. Sans ce
  // point, make compilerait le chantier comme un article, et le cockpit l'afficherait.
  const constantes = /PREFIXE_TEMP = '([^']+)'[\s\S]*?PREFIXE_BASCULE = '([^']+)'/.exec(PY);
  assert.ok(constantes, 'les préfixes du chantier et de la bascule ont disparu');
  assert.strictEqual(constantes[1].charAt(0), '.', 'le chantier n’a plus son point de tête');
  assert.strictEqual(constantes[2].charAt(0), '.', 'la bascule n’a plus son point de tête');
  assert.match(MK, /SLUGS\s*:= \$\(sort \$\(foreach d,\$\(wildcard articles\/\*\)/,
    'SLUGS ne passe plus par wildcard : les dossiers à point de tête pourraient entrer');
  // Le dossier de sauvegarde vit à la racine du numéro, pas dans articles/.
  assert.match(PY, /DOSSIER_REBUT = '\.szh-avant-reimport'/, 'le dossier de rebut a changé de nom');
  assert.match(PY, /os\.path\.join\(revue, DOSSIER_REBUT\)/,
    'le dossier de rebut n’est plus à la racine du numéro : sous articles/, il passerait '
    + 'pour un article');
});

// ---- Empreintes : ce que le Word a livré, pas ce qui est installé ----

test('empreintes : la conversion les écrit, et le réimport note la version du Word', () => {
  assert.match(SH, /reimporter\.py" --empreintes --dossier \. --slug "\$SLUG"/,
    'la conversion ne note plus ce qu’elle a livré : le réimport ne pourrait plus '
    + 'distinguer un tableau retravaillé d’un tableau tel que le Word l’avait donné');
  assert.match(PY, /def ecrire_empreintes\(dossier, slug, nom_word, tableaux=None, biblio=None\)/,
    'ecrire_empreintes ne prend plus les empreintes du Word en argument');
  assert.match(PY, /ecrire_empreintes\(temp, slug, nom_word, empreintes_du_word, biblio_du_word\)/,
    'le réimport note l’état installé au lieu de celui du Word : un tableau ou une '
    + 'bibliographie gardés passeraient au réimport suivant pour une modification de '
    + 'l’auteur, à chaque fois');
  // Un seul nom de fichier, des deux côtés de la chaîne.
  assert.match(PY, /NOM_EMPREINTES = '\.szh-import\.empreintes'/,
    'le nom du fichier d’empreintes a changé — les articles déjà importés deviendraient '
    + 'tous d’origine inconnue');
  // La numérotation des tableaux est celle de docx-tables.py, des deux côtés.
  assert.match(TABLES, /'table-%02d\.html' % n/, 'docx-tables.py ne numérote plus ainsi');
  assert.ok(PY.indexOf('tables/table-%02d.html') !== -1,
    'le réimport ne nomme plus les tableaux comme docx-tables.py');
  assert.ok(PY.indexOf("r'^table-(\\d+)\\.html$'") !== -1,
    'le réimport ne reconnaît plus les tableaux de tables/');
});

test('empreintes absentes : on se montre prudent, et on le dit', () => {
  // Un article importé avant ce suivi ne doit pas voir son travail écrasé en silence.
  assert.match(PY, /if tables_vivantes and not empreintes\['present'\]:/,
    'l’article d’origine inconnue n’est plus traité à part');
  assert.match(PY, /'tableaux-origine-inconnue'/, 'le code de ce cas a changé');
  assert.match(PY, /travaille = \(not empreintes\['present'\]\) or emp\.get\(k\) != sha_vivantes\[k\]/,
    'sans empreintes, un tableau différent n’est plus compté comme retravaillé : le '
    + 'travail de la rédaction disparaîtrait sans un mot');
});

// ---- Ce que le Word possède, et rien d'autre ----

test('réimport : seuls le corps, la bibliographie, media/ et tables/ sont remplacés', () => {
  const bloc = /def possede_par_le_word\(slug\):\s*\n\s*return \{([^}]*)\}/.exec(PY);
  assert.ok(bloc, 'la liste blanche de ce que le Word possède a disparu');
  const noms = bloc[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
  // La bibliographie détachée en fait partie : elle est écrite à l'import depuis les styles
  // du Word, donc elle en vient. L'omettre ferait mentir la liste blanche, et c'est elle
  // qui décide de ce qui est remplacé.
  assert.deepStrictEqual(noms,
    ["'media'", "'tables'", 'NOM_EMPREINTES', 'nom_biblio(slug)', "slug + '.md'"],
    'la liste de ce que le réimport remplace a changé — la fiche, les tâches, le suivi de '
    + 'traduction ou les portraits pourraient partir avec le corps');
  // Le reste est recopié sans énumération : un sidecar inventé demain survivra seul.
  assert.match(PY, /def copier_preserves\(vivant, temp, slug\)/,
    'la recopie de ce que le Word ne possède pas a disparu');
  assert.match(PY, /reserves = possede_par_le_word\(slug\)/,
    'la recopie n’est plus commandée par la liste blanche');
});

test('réimport : la fiche n’est jamais écrasée, et ce que le Word en disait est déposé', () => {
  // docx-meta.py garde déjà la fiche existante ; ici la fiche du Word est écrite dans le
  // chantier (aucune fiche à côté), puis mise de côté sans jamais rejoindre l'article.
  assert.match(PY, /shutil\.move\(fiche_word, depot\)/,
    'la fiche que le Word aurait produite n’est plus mise de côté');
  assert.match(PY, /'fiche-du-word-differente'/, 'le code de ce cas a changé');
  assert.match(PY, /def champs_divergents\(fiche_vivante, fiche_du_word\)/,
    'la comparaison des champs de fiche a disparu');
  // Les portraits appartiennent au formulaire des auteur·e·s : jamais réinstallés, et le
  // détourage de ceux du Word n'est pas payé pour rien.
  assert.match(PY, /env\['SZH_SANS_DETOURAGE'\] = '1'/,
    'le réimport paie le détourage de portraits qu’il met au rebut');
  assert.match(MEDIAS, /if os\.environ\.get\('SZH_SANS_DETOURAGE'\):/,
    'import-medias.py ne sait plus sauter le détourage');
  assert.match(PY, /'portraits-du-word'/,
    'les portraits du Word ne sont plus déposés au rebut : une nouvelle autrice y '
    + 'perdrait sa photo');
});

// ---- Interruption et réversibilité ----

test('réimport : la bascule est deux renommages, et l’état d’avant est déplacé, pas copié', () => {
  const bloc = PY.slice(PY.indexOf('bascule = os.path.join(articles, PREFIXE_BASCULE + slug)'),
    PY.indexOf("voix.dire(\n        'article « %s » : le texte vient"));
  assert.ok(bloc.length > 0, 'la bascule a disparu du réimport');
  assert.match(bloc, /os\.rename\(vivant, bascule\)[\s\S]*os\.rename\(temp, vivant\)/,
    'la bascule ne se fait plus par deux renommages : une copie laisserait un article à '
    + 'moitié remplacé si elle était interrompue');
  assert.ok(bloc.indexOf('os.rename(temp, vivant)')
    < bloc.indexOf("shutil.move(bascule, os.path.join(rebut, 'article-avant'))"),
    'l’état d’avant rejoint le rebut avant la bascule : l’article resterait absent');
  assert.ok(bloc.indexOf("shutil.move(chemin_docx")
    > bloc.indexOf("shutil.move(bascule"),
    'le Word est consommé avant que l’état d’avant ne soit rangé');
});

test('réimport : la reprise passe avant l’appariement, et la compilation l’appelle', () => {
  const iReprise = PY.indexOf('reprendre_tout(revue, voix)\n\n    articles =');
  const iApparie = PY.indexOf('articles = articles_de_la_revue(revue)');
  assert.ok(iReprise !== -1 && iReprise < iApparie,
    'la reprise ne passe plus avant l’appariement : après un kill en pleine bascule, '
    + 'articles/<slug> n’existe pas et le script répondrait que l’article est inconnu');
  assert.match(PY, /'reimport-reprise'/, 'le code de la reprise a changé');
  // Sans cet appel, un article resté sous .szh-bascule-<slug> serait hors de SLUGS et le
  // numéro se publierait sans lui, sortie 0.
  assert.match(MK, /reimporter\.py" --reprise \|\| true/,
    'la cible import ne remet plus d’aplomb un réimport interrompu');
  assert.ok(MK.indexOf('--reprise') < MK.indexOf('files=("$(WORD_DIR)"/*.docx)'),
    'la reprise passe après la boucle d’import');
});

test('réimport : on peut revenir à l’état d’avant, et annuler l’annulation', () => {
  assert.match(PY, /def annuler\(revue, slug, voix, resultat\)/, 'l’annulation a disparu');
  assert.match(PY, /creer_rebut\(revue, slug, '-annule'\)/,
    'l’annulation n’met plus de côté l’état qu’elle remplace : elle serait irréversible');
  assert.match(PY, /'annuler-sans-etat'/, 'le refus sans sauvegarde a changé de code');
  assert.match(MK, /^annuler-reimport:$/m, 'la cible annuler-reimport a disparu du Makefile');
  // Le mode d'emploi du rebut est écrit sur place, dans les deux langues.
  const lisez = PY.slice(PY.indexOf('LISEZ_MOI = '), PY.indexOf('def horodatage'));
  assert.match(lisez, /--annuler --article/, 'le LISEZ-MOI ne donne plus la manœuvre');
  assert.match(lisez, /\[de\] /, 'le LISEZ-MOI n’existe qu’en français');
  assert.ok(lisez.indexOf('ß') === -1, 'orthographe allemande : « ß » au lieu de « ss »');
});

// ---- Ce que le rédacteur lit, et ce que le cockpit lit ----

test('réimport : aucun message ne part sans son allemand', () => {
  // Les deux langues sont exigées par la signature, non par la discipline de l'appelant.
  assert.match(PY, /def dire\(self, fr, de\):/,
    'l’allemand est redevenu optionnel dans les lignes d’information');
  assert.match(PY, /def avertir\(self, code, champs, fr, de\):/,
    'la forme des avertissements a changé');
  assert.match(PY, /'\[de\] ' \+ de/, 'l’allemand n’est plus préfixé « [de] »');
  // Même préfixe que les autres maillons : l'interface n'a qu'un motif à reconnaître.
  assert.match(PY, /PREFIXE_AVERT = '\[import-avertissement\]'/,
    'le préfixe des avertissements a changé — l’interface ne les retrouvera plus');
  assert.ok(PY.indexOf('ß') === -1, 'orthographe allemande : « ß » au lieu de « ss »');
  // Aucun message ne nomme un code de sortie, un chemin de venv ni une table Lua.
  for (const bruit of ['SZH_IMPORT_DIR', 'os.rename', 'sha256']) {
    const messages = PY.split('\n').filter((l) => /^\s+(?:"|')[A-ZÀ-Ý]/.test(l));
    assert.ok(!messages.join('\n').includes(bruit),
      'un message destiné au rédacteur nomme « ' + bruit + ' »');
  }
});

test('réimport : les quatre issues sont distinctes, et stdout ne porte que le JSON', () => {
  const codes = /CODES = \{([^}]*)\}/.exec(PY);
  assert.ok(codes, 'la table des issues a disparu');
  for (const attendu of ["0: 'reussi'", "3: 'rien'", "4: 'refuse'", "1: 'echec'"]) {
    assert.ok(codes[1].indexOf(attendu) !== -1,
      'l’issue ' + attendu + ' n’est plus distincte : le cockpit ne saurait plus quoi dire');
  }
  // Le cockpit lit une ligne JSON, comme pour portraits.py : tout le reste va sur stderr.
  // Deux écritures seulement sur stdout, et toutes deux terminales : celle de rendre(),
  // et celle des filets du sommet (Ctrl+C, panne) — pour que le cockpit ne soit jamais
  // laissé sans réponse lisible.
  const prints = (PY.match(/print\(/g) || []).length;
  const surStderr = (PY.match(/file=sys\.stderr/g) || []).length;
  assert.strictEqual((PY.match(/print\(json\.dumps\(/g) || []).length, 2,
    'le nombre de lignes JSON sur stdout a changé : le contrat du cockpit ne tient plus');
  assert.strictEqual(prints - surStderr, 2,
    'un print() ne va pas sur stderr : il polluerait la ligne JSON du cockpit');
  // Un refus n'est pas un échec : il ne doit pas s'afficher en rouge dans l'éditeur.
  for (const code of ['reimport-sans-article', 'reimport-sans-word',
    'reimport-fiche-sans-source', 'reimport-plusieurs-articles']) {
    assert.ok(PY.indexOf("'" + code + "'") !== -1, 'le code de refus ' + code + ' a changé');
  }
});

test('réimport : les conflits sont nommés, jamais résolus en silence', () => {
  for (const code of ['tableau-conflit', 'image-non-reimportee', 'corps-retravaille']) {
    assert.ok(PY.indexOf("'" + code + "'") !== -1,
      'le code « ' + code + ' » a disparu : la perte redeviendrait silencieuse');
  }
  // Chacun de ces messages donne le chemin où retrouver l'ancien état.
  for (const ancre of ["/article-avant/tables", "/article-avant/media",
    "'/article-avant/' + slug + '.md'"]) {
    assert.ok(PY.indexOf(ancre) !== -1,
      'un avertissement ne dit plus où retrouver le travail d’avant (' + ancre + ')');
  }
});

// ---- Le redépôt, côté cible import ----

test('Makefile : le redépôt d’un Word nomme un geste qui existe', () => {
  assert.ok(MK.indexOf('« Réimporter cet article » (à venir)') === -1,
    'le message du redépôt promet encore une fonction absente');
  assert.match(MK, /^reimporter:$/m, 'la cible reimporter a disparu');
  // La cible `import` ne réimporte jamais d'elle-même : c'est une opération destructive,
  // elle se demande.
  // ⚠ La borne de fin est le nom d'une VARIABLE depuis que l'import sert aussi aux
  //   chapitres d'un livre. Écrite en dur, `indexOf` rendait -1, `slice` prenait tout le
  //   fichier, et le contrôle accusait la cible `import` d'un `reimporter.py` qui vit
  //   ailleurs. Un contrôle qui se trompe de bloc n'est pas plus sûr qu'un contrôle absent.
  const finBloc = MK.indexOf('while [ -e "$(UNITES_DIR)/$$slug/$$slug.md" ]; do');
  assert.ok(finBloc !== -1, 'la boucle de désambiguïsation a disparu : le bloc n’a plus de fin');
  const bloc = MK.slice(MK.indexOf('venu_de=""'), finBloc);
  assert.ok(bloc.indexOf('reimporter.py') === -1,
    'la cible import lance le réimport toute seule : elle remplacerait le travail de la '
    + 'rédaction sans qu’on le lui demande');
  assert.match(MK, /Réimporter cet article/, 'le geste n’est plus nommé au rédacteur');

  // La cible garde le code du script, à une exception près : « rien à faire » n'est pas
  // une panne, et la règle du dossier est de n'échouer que si la configuration ne peut pas
  // être honorée. Sans ce c=$? / exit $c, la cible réussirait quoi qu'il arrive.
  const recette = MK.slice(MK.indexOf('\nreimporter:'), MK.indexOf('\nannuler-reimport:'));
  assert.ok(recette.indexOf('c=$$?;') !== -1,
    'la cible reimporter ne relève plus le code du script : elle réussirait toujours');
  assert.ok(recette.indexOf('if [ $$c -eq 3 ]; then exit 0; fi;') !== -1,
    '« rien à faire » n’est plus traité à part : la cible s’afficherait en rouge pour rien');
  assert.ok(recette.indexOf('exit $$c') !== -1,
    'la cible ne propage plus l’échec du script');
});

// ---- Les cinq issues, mesurées en EXÉCUTANT le script ----
//
// Ce contrôle est né d'un défaut réel : le contrat annonçait « code de sortie et champ
// resultat, redondants exprès », et rien ne mesurait le code de sortie. Un contrôle qui
// n'aurait lu que le JSON n'aurait rien vu — c'est exactement ce qui s'est passé.
//
// Piège d'appel, à connaître avant de conclure qu'un script « rend toujours 0 » : dans un
// tube (« … | tail »), $? est le code du DERNIER maillon. Il faut ${PIPESTATUS[0]}, ou pas
// de tube. Mesuré : sans tube, ce script rend 0/1/2/3/4 ; avec un tube, 0 toujours.
//
// Les quatre premières issues sont atteintes sans conversion : pas de pandoc, pas de bash,
// donc mesurables partout, y compris sous Windows. La cinquième (« rien à faire ») demande
// une conversion : elle passe par un import-docx.sh factice, ce que permet --pipeline, et
// n'est mesurée que là où un bash sait lire les chemins de ce dépôt (CI Linux, WSL).

const os = require('os');
const cp = require('child_process');

const SCRIPT = path.join(RACINE, 'pipeline', 'reimporter.py');

// python3, puis python. Aucun saut silencieux : un contrôle qui mesure des codes de sortie
// ne doit pas pouvoir passer au vert sans avoir rien lancé.
function interpretePython() {
  for (const commande of ['python3', 'python']) {
    const r = cp.spawnSync(commande, ['--version'], { encoding: 'utf8' });
    if (!r.error && /Python 3/.test(String(r.stdout || '') + String(r.stderr || ''))) {
      return commande;
    }
  }
  return null;
}

// Un bash qui comprend les chemins que Python lui passera. Sous Windows, `bash` est
// souvent la passerelle WSL : elle ne sait rien d'un chemin « C:\… », et la conversion
// échouerait pour une raison de chemin, non de contrat.
function bashCompatible() {
  // On mesure l'opération réelle, pas une approximation : Python lancera
  // « bash <chemin>/import-docx.sh » avec un chemin de cette forme-là.
  let dossier = null;
  try {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-sonde-'));
    const script = path.join(dossier, 'sonde.sh');
    const LF = String.fromCharCode(10);
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

function revueJetable(slug) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-reimport-'));
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), 'nummer: "2026-03"\n');
  fs.mkdirSync(path.join(racine, 'articles-word'), { recursive: true });
  const dossier = path.join(racine, 'articles', slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), '# Essai\n\nUn corps.\n');
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'lang: fr', 'source: "essai.docx"', 'title:', '  fr: "Un essai"', ''].join('\n'));
  return racine;
}

function lancer(racine, args) {
  const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
  return cp.spawnSync(PYTHON, [SCRIPT].concat(args),
    { cwd: racine, encoding: 'utf8', env: env });
}

function jsonDeLaSortie(sortie) {
  const ligne = String(sortie || '').split(/\r?\n/).filter((l) => l.trim().charAt(0) === '{');
  return ligne.length === 1 ? JSON.parse(ligne[0]) : null;
}

test('les issues du réimport : le processus sort sur le code que le JSON annonce', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé (python3, puis python) : ce contrôle '
    + 'mesure des codes de sortie, il ne peut pas être sauté en silence');
  const slug = '01-essai';

  // --- refusé (4) : aucun article de ce nom
  let racine = revueJetable(slug);
  try {
    const r = lancer(racine, ['--article', 'zzz-inexistant']);
    const j = jsonDeLaSortie(r.stdout);
    assert.strictEqual(r.status, 4, 'un refus ne sort pas sur 4 : tout appelant qui teste '
      + '$? lira une réussite (sortie ' + r.status + ')');
    assert.ok(j, 'aucune ligne JSON unique sur stdout');
    assert.strictEqual(j.resultat, 'refuse');
    assert.strictEqual(j.code, r.status, 'le code du JSON et celui du processus divergent');
    assert.deepStrictEqual(j.avertissements, ['reimport-sans-article']);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }

  // --- refusé (4) : l'article existe, mais aucun Word n'attend. Volontairement distinct
  // de « rien à faire » : là, aucun document n'a été examiné, et le geste à faire n'est
  // pas le même (déposer le Word corrigé).
  racine = revueJetable(slug);
  try {
    const r = lancer(racine, ['--article', slug]);
    const j = jsonDeLaSortie(r.stdout);
    assert.strictEqual(r.status, 4, 'article réel sans Word en attente : sortie ' + r.status);
    assert.strictEqual(j.resultat, 'refuse');
    assert.strictEqual(j.code, r.status);
    assert.deepStrictEqual(j.avertissements, ['reimport-sans-word']);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }

  // --- appel mal formé (2) : un argument inconnu ne doit pas passer pour un succès, sans
  // quoi un bug d'appel du cockpit se lirait comme une réussite.
  racine = revueJetable(slug);
  try {
    const r = lancer(racine, ['--zzz']);
    assert.strictEqual(r.status, 2, 'un argument inconnu sort sur ' + r.status
      + ' : un appel fautif passerait pour un succès');
    assert.strictEqual(jsonDeLaSortie(r.stdout), null,
      'un appel mal formé ne doit pas produire de ligne JSON de résultat');
    // Et l'usage part sur stderr, jamais sur stdout, qui appartient au JSON.
    assert.ok(String(r.stderr).indexOf('usage : reimporter.py') !== -1,
      'l’usage ne s’affiche plus');
    assert.strictEqual(String(r.stdout).trim(), '');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }

  // --- réussi (0) : l'annulation, seule issue « réussie » qu'on atteigne sans conversion.
  racine = revueJetable(slug);
  try {
    const garde = path.join(racine, '.szh-avant-reimport', slug, '2026-01-01_00-00-00',
      'article-avant');
    fs.mkdirSync(garde, { recursive: true });
    fs.writeFileSync(path.join(garde, slug + '.md'), '# Essai\n\nLe corps d’avant.\n');
    fs.writeFileSync(path.join(garde, slug + '.meta.yaml'), 'type: article\n');
    const r = lancer(racine, ['--annuler', '--article', slug]);
    const j = jsonDeLaSortie(r.stdout);
    assert.strictEqual(r.status, 0, 'une annulation réussie sort sur ' + r.status);
    assert.strictEqual(j.resultat, 'reussi');
    assert.strictEqual(j.code, 0);
    assert.strictEqual(fs.readFileSync(path.join(racine, 'articles', slug, slug + '.md'),
      'utf8').indexOf('Le corps d’avant.') !== -1, true,
      'l’état d’avant n’a pas été remis en place');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }

  // --- échoué (1) : le chantier ne peut pas être créé (un fichier occupe sa place). Rien
  // n'est touché, et le code doit dire « échec », pas « réussi ».
  racine = revueJetable(slug);
  try {
    fs.writeFileSync(path.join(racine, 'articles-word', 'essai.docx'), 'pas un docx');
    fs.writeFileSync(path.join(racine, 'articles', '.szh-reimport-' + slug), 'obstacle');
    const r = lancer(racine, ['--article', slug]);
    const j = jsonDeLaSortie(r.stdout);
    assert.strictEqual(r.status, 1, 'un échec sort sur ' + r.status);
    assert.strictEqual(j.resultat, 'echec');
    assert.strictEqual(j.code, 1);
    assert.deepStrictEqual(j.avertissements, ['reimport-echec']);
    // L'article n'a pas bougé.
    assert.ok(fs.readFileSync(path.join(racine, 'articles', slug, slug + '.md'), 'utf8')
      .indexOf('Un corps.') !== -1, 'l’article a été touché par un réimport en échec');
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('issue « rien à faire » : sortie 3, et le Word cesse d’attendre', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');
  if (!bashCompatible()) {
    // Ni un saut silencieux ni un faux vert : on dit pourquoi, et où la mesure se fait.
    assert.ok(SH.indexOf('SZH_IMPORT_DIR') !== -1,
      'la couture de la conversion a disparu, et ce poste ne peut pas la mesurer');
    return;
  }
  const slug = '01-essai';
  const racine = revueJetable(slug);
  try {
    fs.writeFileSync(path.join(racine, 'articles-word', 'essai.docx'), 'pas un docx');
    // Une conversion factice qui rend le corps inchangé : c'est la définition de « rien
    // à faire ». --pipeline permet de la substituer sans toucher à la chaîne réelle.
    const faux = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pipeline-'));
    fs.writeFileSync(path.join(faux, 'import-docx.sh'), [
      '#!/bin/bash',
      'set -u',
      'DIR="${SZH_IMPORT_DIR:?}"',
      'mkdir -p "$DIR/media" "$DIR/tables"',
      'cp "articles/$2/$2.md" "$DIR/$2.md"',
      ''].join('\n'));
    const r = lancer(racine, ['--article', slug, '--pipeline', faux]);
    const j = jsonDeLaSortie(r.stdout);
    assert.strictEqual(r.status, 3, 'un « rien à faire » sort sur ' + r.status
      + ' : le cockpit peindrait un échec, ou une réussite, à la place');
    assert.strictEqual(j.resultat, 'rien');
    assert.strictEqual(j.code, 3);
    // Le Word a été examiné : il ne doit plus être signalé comme en attente.
    assert.deepStrictEqual(fs.readdirSync(path.join(racine, 'articles-word'))
      .filter((n) => n.endsWith('.docx')), [],
      'le Word reste en attente : il serait signalé à chaque compilation');
    fs.rmSync(faux, { recursive: true, force: true });
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test('réimport : Ctrl+C et panne imprévue sortent sur un code, pas sur une trace', () => {
  // KeyboardInterrupt et SystemExit dérivent de BaseException : `except Exception` ne les
  // attrape pas, et le code de sortie de principal() passe intact. C'est la seule raison
  // pour laquelle un filet large est tolérable ici — et il n'est tolérable qu'au sommet.
  assert.strictEqual((PY.match(/^\s*except\s*:/gm) || []).length, 0,
    'un except nu est apparu : il avalerait SystemExit et KeyboardInterrupt');
  assert.strictEqual((PY.match(/except BaseException/g) || []).length, 0,
    'un except BaseException avalerait le code de sortie et le Ctrl+C');
  assert.strictEqual((PY.match(/^    except Exception:/gm) || []).length, 1,
    'le filet large n’est plus unique, ou n’est plus au sommet du fichier');
  const sommet = PY.slice(PY.indexOf("if __name__ == '__main__':"));
  assert.ok(sommet.indexOf('except KeyboardInterrupt:') !== -1
    && sommet.indexOf('except Exception:') !== -1,
    'les deux filets ne sont pas dans le bloc __main__');
  assert.match(PY, /'reimport-interrompu'/, 'le code du Ctrl+C a changé');
  assert.match(PY, /'reimport-panne'/, 'le code de la panne a changé');
  // Ctrl+C tente la reprise : l'article ne doit pas rester sous .szh-bascule-<slug>.
  assert.ok(sommet.indexOf('reprendre_tout(revue, voix)') !== -1,
    'un Ctrl+C ne remet plus l’article en place');
  assert.strictEqual((PY.match(/sys\.exit\(principal\(sys\.argv\)\)/g) || []).length, 1,
    'le point de sortie unique du processus a bougé');
});
