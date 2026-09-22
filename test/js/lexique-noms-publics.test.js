// outils-dev/lexique/moissonner-noms-publics.py : construit les DEUX index de fréquence
// publics du lexique — pipeline/lexique/noms-frequents.txt et prenoms-frequents.txt — lus par
// manuscrit_noms.BaseNoms en renfort de la base OJS du poste. Contrat :
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §5.5 quater. Cadrage :
// outils-dev/BRIEF-lexique-noms-elargi.md.
//
// ⚠ Ce que ces tests gardent avant tout, c'est une contrainte de PROVENANCE, pas une
// contrainte de forme. `prenoms.txt` a été supprimé le 22.09.2026 au matin parce qu'il
// dérivait de C:\ProgramData\SZH\auteurs.json, la base d'auteurs de la maison, dans un dépôt
// destiné à devenir public. `prenoms-frequents.txt` est demandé par Robin le même jour, mais
// de SOURCE PUBLIQUE et de source publique seulement. Un fichier bien trié dont les jetons
// viendraient d'auteurs.json passerait toutes les vérifications de forme et violerait
// pourtant la seule chose qui compte ici — d'où les deux tests de provenance plus bas, qui
// regardent le script et non le fichier.
//
//   node --test "test/js/lexique-noms-publics.test.js"     (guillemets obligatoires)
//
// Aucun test ne touche au réseau : le moissonneur ne télécharge que sur --telecharger, et
// aucun test ne le lui demande. Les CSV bruts (38 Mo) vivent dans tmp/lexique-sources/, hors
// dépôt ; les tests qui en auraient besoin sont sautés quand ils sont absents.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sauter } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MOISSONNEUR = path.join(RACINE, 'outils-dev', 'lexique', 'moissonner-noms-publics.py');
const BANC = path.join(RACINE, 'outils-dev', 'lexique', 'banc-noms.py');
const LEXIQUE = path.join(RACINE, 'pipeline', 'lexique');
const NOMS_FREQUENTS = path.join(LEXIQUE, 'noms-frequents.txt');
const PRENOMS_FREQUENTS = path.join(LEXIQUE, 'prenoms-frequents.txt');
const CACHE_SOURCES = path.join(RACINE, 'tmp', 'lexique-sources');

const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function python(args, opts) {
  return cp.spawnSync(PYTHON, args,
    Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 }, opts || {}));
}

function lireJetons(chemin) {
  return fs.readFileSync(chemin, 'utf8').split('\n')
    .filter((l) => l !== '' && !l.startsWith('#'));
}

// ---------------------------------------------------------------------------------------
// 1. Les deux fichiers LIVRÉS — forme, et surtout confidentialité.

// Mêmes garanties que verifierFichierLexique() de lexique-noms.test.js, redite ici plutôt
// qu'importée : ce fichier-ci doit pouvoir être lancé seul, et la vérification tient en
// quinze lignes.
function verifierIndex(chemin) {
  assert.ok(fs.existsSync(chemin), 'fichier attendu absent : ' + chemin);
  const brut = fs.readFileSync(chemin, 'utf8');
  const lignes = brut.split('\n');
  assert.strictEqual(lignes[lignes.length - 1], '', chemin + ' doit finir par une fin de ligne');
  const corps = lignes.slice(0, -1);
  const jetons = corps.filter((l) => !l.startsWith('#'));
  assert.ok(jetons.length > 0, chemin + ' ne doit pas être vide');
  assert.ok(jetons.every((j) => j.trim() !== ''), chemin + ' : aucune ligne vide');
  assert.deepStrictEqual(jetons, jetons.slice().sort(), chemin + ' doit être trié');
  assert.strictEqual(new Set(jetons).size, jetons.length, chemin + ' : aucun doublon');
  const suspects = jetons.filter((j) => j.includes('@') || /\d/.test(j) || j.includes(' '));
  assert.deepStrictEqual(suspects, [],
    chemin + ' : jeton(s) avec @, chiffre ou espace (un couple prénom+nom resté accolé '
    + 'trahirait une donnée personnelle) : ' + suspects.slice(0, 10));
  // Les jetons sont DÉJÀ pliés : c'est ce que _charger_fichier_lexique() suppose pour son
  // chemin rapide (manuscrit_noms.py). Une majuscule ou un accent ici ne casserait rien
  // (le repli par _plier() reste branché) mais ferait mentir l'en-tête du fichier.
  const malPlies = jetons.filter((j) => j !== j.toLowerCase()
    || j.normalize('NFD') !== j.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  assert.deepStrictEqual(malPlies.slice(0, 10), [],
    chemin + ' : jeton(s) non pliés (majuscule ou accent) : ' + malPlies.slice(0, 10));
}

test('pipeline/lexique/noms-frequents.txt livré : trié, sans doublon, plié, sans @ ni chiffre '
  + 'ni espace', () => {
  verifierIndex(NOMS_FREQUENTS);
});

test('pipeline/lexique/prenoms-frequents.txt livré : trié, sans doublon, plié, sans @ ni '
  + 'chiffre ni espace', () => {
  verifierIndex(PRENOMS_FREQUENTS);
});

test('les deux index sont DISJOINTS : un même jeton n\'est jamais à la fois prénom et nom '
  + '(filtre de discrimination, §5.5 quater)', () => {
  const noms = new Set(lireJetons(NOMS_FREQUENTS));
  const communs = lireJetons(PRENOMS_FREQUENTS).filter((j) => noms.has(j));
  assert.deepStrictEqual(communs.slice(0, 20), [],
    'jeton(s) présents des deux côtés : ' + communs.slice(0, 20)
    + ' — un jeton connu des deux index annule sa propre contribution au signal '
    + '(score_direct == score_inverse), le filtre doit l\'attribuer à un seul côté');
});

test('l\'en-tête de chaque index cite ses sources et leur licence (obligation de licence, '
  + 'le fichier voyage seul)', () => {
  for (const chemin of [NOMS_FREQUENTS, PRENOMS_FREQUENTS]) {
    const entete = fs.readFileSync(chemin, 'utf8').split('\n')
      .filter((l) => l.startsWith('#')).join('\n');
    assert.match(entete, /OFS/, chemin + ' : l\'en-tête doit citer l\'OFS');
    assert.match(entete, /opendata\.swiss|indiquer la source/,
      chemin + ' : l\'en-tête doit porter la condition de licence de l\'OFS');
    assert.match(entete, /moissonner-noms-publics\.py/,
      chemin + ' : l\'en-tête doit nommer le script qui le fabrique');
    assert.match(entete, /ne pas\s*\n?#?\s*éditer à la main/,
      chemin + ' : l\'en-tête doit interdire l\'édition à la main');
  }
});

// ---------------------------------------------------------------------------------------
// 2. PROVENANCE — le cœur du lot. Deux gardes, sur le script plutôt que sur le fichier :
// c'est le script qui pourrait un jour se remettre à lire la base de la maison, et un
// fichier propre produit par un script fautif est exactement ce qu'on cherche à empêcher.

test('le moissonneur ne connaît pas auteurs.json : ni le chemin de la base OJS, ni son nom, '
  + 'nulle part dans le script (§5.4 du brief)', () => {
  const source = fs.readFileSync(MOISSONNEUR, 'utf8');
  // Le nom du fichier peut apparaître dans un commentaire qui EXPLIQUE qu'on ne le lit pas ;
  // ce qui est interdit, c'est de l'ouvrir. On cherche donc les formes exécutables.
  const lignesDeCode = source.split('\n')
    .filter((l) => !l.trim().startsWith('#'));
  const fautives = lignesDeCode.filter((l) => /auteurs\.json|ProgramData|base_auteurs/i.test(l));
  assert.deepStrictEqual(fautives, [],
    'le moissonneur touche à la base d\'auteurs de la maison : ' + fautives.join(' | ')
    + ' — l\'index de prénoms doit venir de sources publiques et d\'elles seules, c\'est la '
    + 'raison même pour laquelle prenoms.txt a été supprimé le 22.09.2026');
});

test('toutes les sources déclarées du moissonneur sont publiques (OFS, INSEE) et portent une '
  + 'citation de licence', { skip: sansPython }, () => {
  const r = python(['-c', [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("mo", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([{"url": s["url"], "citation": s["citation"], "cible": s["cible"]}',
    '                  for s in m.SOURCES]))',
  ].join('\n'), MOISSONNEUR]);
  assert.strictEqual(r.status, 0, 'lecture de SOURCES impossible : ' + r.stderr);
  const sources = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.ok(sources.length >= 3, 'au moins trois sources attendues');
  for (const s of sources) {
    assert.match(s.url, /^https:\/\/(dam-api\.bfs\.admin\.ch|static\.data\.gouv\.fr)\//,
      'source non publique ou inattendue : ' + s.url);
    assert.ok(s.citation && s.citation.length > 30,
      'source sans citation de licence utilisable : ' + s.url);
    assert.ok(s.cible === 'nom' || s.cible === 'prenom', 'cible inconnue : ' + s.cible);
  }
  assert.ok(sources.some((s) => s.cible === 'nom'), 'aucune source de noms de famille');
  assert.ok(sources.some((s) => s.cible === 'prenom'), 'aucune source de prénoms');
});

// ---------------------------------------------------------------------------------------
// 3. Le filtre de discrimination, sur des compteurs FABRIQUÉS — aucune source réelle, donc
// aucun besoin du cache tmp/ ni du réseau.

test('discriminer() : un jeton va du côté qui domine, jamais des deux ; la zone neutre se '
  + 'tait', { skip: sansPython }, () => {
  const r = python(['-c', [
    'import importlib.util, json, sys',
    'from collections import Counter',
    'spec = importlib.util.spec_from_file_location("mo", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    // muller : nom franc. peter : prenom largement dominant. ahmed : les deux, au coude a
    // coude -> zone neutre des que le rapport depasse 1,1.
    'pn = Counter({"muller": 48000, "peter": 7000, "ahmed": 2875})',
    'pp = Counter({"edith": 9000, "peter": 52000, "ahmed": 2898})',
    'sortie = {}',
    'for r in (1.0, 2.0):',
    '    n, p, e = m.discriminer(pn, pp, r)',
    '    sortie[str(r)] = {"noms": sorted(n), "prenoms": sorted(p), "neutres": sorted(e)}',
    'print(json.dumps(sortie))',
  ].join('\n'), MOISSONNEUR]);
  assert.strictEqual(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout.trim().split('\n').pop());

  // rapport 1 : tout jeton est attribué, la zone neutre est vide.
  assert.deepStrictEqual(s['1.0'].neutres, []);
  assert.ok(s['1.0'].noms.includes('muller'), 'muller est un nom de famille');
  assert.ok(s['1.0'].prenoms.includes('edith'), 'edith est un prénom');
  assert.ok(s['1.0'].prenoms.includes('peter'),
    'peter pèse 7,5 fois plus comme prénom : il doit aller aux prénoms, jamais aux noms — '
    + 'c\'est précisément ce jeton-là qui fabrique les inversions décrites au §3 du brief');
  assert.ok(!s['1.0'].noms.includes('peter'), 'peter ne doit pas rester du côté des noms');

  // rapport 2 : « ahmed » (2875 contre 2898, aucun des deux ne domine deux fois l'autre)
  // sort des DEUX index — « en cas de doute, rien ».
  assert.ok(s['2.0'].neutres.includes('ahmed'), 'ahmed doit tomber en zone neutre à rapport 2');
  assert.ok(!s['2.0'].noms.includes('ahmed') && !s['2.0'].prenoms.includes('ahmed'),
    'un jeton en zone neutre n\'entre dans AUCUN des deux index');
  assert.ok(s['2.0'].noms.includes('muller') && s['2.0'].prenoms.includes('peter'),
    'les jetons franchement discriminants restent attribués à rapport 2');
});

test('moissonner-noms-publics.py refuse d\'écrire quand une famille de sources manque '
  + '(jamais un fichier écrasé par du vide, §7 du brief)', { skip: sansPython }, () => {
  const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-moisson-vide-'));
  const sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-moisson-sortie-'));
  const temoin = path.join(sortie, 'noms-frequents.txt');
  fs.writeFileSync(temoin, '# temoin\nmuller\n', 'utf8');
  const r = python([MOISSONNEUR, '--cache', vide, '--sortie', sortie]);
  assert.notStrictEqual(r.status, 0,
    'un cache vide doit faire échouer le moissonneur, pas produire un lexique vide');
  assert.match(r.stdout + r.stderr, /Rien n'est écrit|ERREUR/);
  assert.strictEqual(fs.readFileSync(temoin, 'utf8'), '# temoin\nmuller\n',
    'le fichier déjà en place ne doit pas avoir été touché');
});

// ---------------------------------------------------------------------------------------
// 4. Le banc de mesure. Il a besoin de la base OJS du poste (C:\ProgramData\SZH\auteurs.json),
// absente d'un runner CI : sauté sans elle, jamais en échec.

const BASE_OJS = process.platform === 'win32'
  ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'SZH', 'auteurs.json') : '';
const sansBaseOjs = BASE_OJS && fs.existsSync(BASE_OJS) ? false : 'base OJS du poste absente';

test('banc-noms.py : sans base d\'auteurs, échoue proprement et le dit, jamais une trace '
  + 'Python', { skip: sansPython }, () => {
  const r = python([BANC, '--auteurs', path.join(os.tmpdir(), 'szh-base-qui-nexiste-pas.json')]);
  assert.notStrictEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /Traceback/, 'aucune trace Python ne doit sortir');
  assert.match(r.stdout, /introuvable/);
});

test('banc-noms.py sur le lexique livré : les deux index font baisser « muet » et ne font pas '
  + 'monter « à l\'envers » (critère d\'acceptation, §6 du brief)',
  { skip: sansPython || sansBaseOjs }, (t) => {
    if (sansBaseOjs) { return sauter.fichier(t, BASE_OJS); }
    const tsv = (args) => {
      const r = python([BANC, '--tsv'].concat(args));
      assert.strictEqual(r.status, 0, 'banc-noms.py a échoué : ' + r.stderr);
      const c = r.stdout.trim().split('\n').pop().split('\t');
      return { total: +c[1], juste: +c[2], envers: +c[3], indecis: +c[4], muet: +c[5] };
    };
    const temoin = tsv(['--sans-lexique']);
    const livre = tsv(['--noms', path.join(LEXIQUE, 'noms-famille.txt'),
      '--noms', NOMS_FREQUENTS, '--prenoms', PRENOMS_FREQUENTS]);

    assert.ok(livre.total === temoin.total && livre.total > 1000,
      'les deux passages doivent juger la même population');
    assert.ok(livre.muet < temoin.muet / 4,
      'le lexique livré doit faire chuter la colonne « muet » : ' + temoin.muet
      + ' -> ' + livre.muet);
    assert.ok(livre.juste > temoin.juste + 200,
      'le lexique livré doit faire gagner beaucoup de décisions justes : ' + temoin.juste
      + ' -> ' + livre.juste);
    // Le critère DUR du §6 : une inversion se propage et retourne un article entier, un
    // silence ne coûte qu'une convention par défaut. Le plafond est le chiffre mesuré sur
    // l'état du 22.09.2026 (10 fiches sur 1152, 0,9 %), jamais un pourcentage rond.
    assert.ok(livre.envers <= 10,
      'colonne « à l\'envers » au-dessus du plafond mesuré du contrat (10 fiches) : '
      + livre.envers + ' — un palier qui paie des inversions ne s\'adopte pas en silence');
  });

// ---------------------------------------------------------------------------------------
// 5. Le chemin rapide de chargement (manuscrit_noms._charger_fichier_lexique) : un fichier
// DÉJÀ plié saute la normalisation NFD. Ce qui doit être prouvé n'est pas le gain de temps,
// c'est que le raccourci ne change RIEN au résultat — y compris sur un fichier mal plié,
// édité à la main contre la consigne.

test('_charger_fichier_lexique : le chemin rapide donne exactement le même résultat que le '
  + 'pliage complet, y compris sur des lignes non pliées', { skip: sansPython }, () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lexrapide-'));
  fs.writeFileSync(path.join(dossier, 'melange.txt'),
    // pliées (chemin rapide) puis non pliées (repli par _plier) : accents, majuscules,
    // ponctuation de bord, tiret interne à conserver.
    ['muller', 'silva', '# un commentaire', 'MÜLLER', 'Guilley', '  Sermier-Dessemontet  ',
      '«Aebischer»', ''].join('\n'), 'utf8');
  const r = python(['-c', [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("mn", sys.argv[1])',
    'mn = importlib.util.module_from_spec(spec); sys.modules["mn"] = mn',
    'spec.loader.exec_module(mn)',
    'cible = {}',
    'n = mn._charger_fichier_lexique(sys.argv[2], "melange.txt", cible)',
    'print(json.dumps({"n": n, "jetons": sorted(cible)}))',
  ].join('\n'), path.join(RACINE, 'pipeline', 'manuscrit_noms.py'), dossier]);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.n, 6, 'six jetons, le commentaire et la ligne vide exclus');
  assert.deepStrictEqual(out.jetons,
    ['aebischer', 'guilley', 'muller', 'sermier-dessemontet', 'silva'],
    'MÜLLER et muller se replient sur le même jeton : cinq jetons distincts pour six lignes');
});

// ---------------------------------------------------------------------------------------
// 6. Le moissonneur sur les VRAIES sources (tmp/lexique-sources, hors dépôt) — sauté quand
// le cache est absent, comme lexique-noms.test.js le fait pour tmp/docx-dev.

test('moissonner-noms-publics.py --statistiques sur le cache réel : n\'écrit rien et annonce '
  + 'ses cinq sources', { skip: sansPython }, (t) => {
  if (!fs.existsSync(CACHE_SOURCES)) { return sauter.corpus(t, CACHE_SOURCES); }
  const avant = fs.readFileSync(NOMS_FREQUENTS, 'utf8');
  const r = python([MOISSONNEUR, '--statistiques']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /--statistiques : aucun fichier écrit/);
  assert.match(r.stdout, /discrimination \(rapport/);
  assert.strictEqual(fs.readFileSync(NOMS_FREQUENTS, 'utf8'), avant,
    '--statistiques ne doit toucher à aucun fichier livré');
});
