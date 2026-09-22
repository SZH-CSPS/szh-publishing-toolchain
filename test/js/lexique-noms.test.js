// outils-dev/lexique/generer-noms.py : construit pipeline/lexique/noms-famille.txt, le
// lexique PUBLIC que manuscrit_noms.BaseNoms (lot A, contrat §3.2) lit en renfort de la base
// OJS du poste, absente sur les runners CI et sur un poste de développement sans
// C:\ProgramData\SZH. Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §5.
//
// ⚠ prenoms.txt (le champ `prenom` de la base OJS) a été SUPPRIMÉ le 22.09.2026 — décision de
// Robin : dérivé de C:\ProgramData\SZH\auteurs.json, il n'apportait rien de plus que cette
// base quand elle est présente, et son seul rôle (un repli quand elle est absente) est
// désormais couvert par le moissonnage déclenché au lancement de l'application. La base OJS
// (--base-auteurs) reste lue par le générateur, mais UNIQUEMENT pour immuniser un jeton de
// noms-famille.txt contre le seuil de bruit (§5.2, règle 4) — plus aucun fichier de prénoms
// n'est écrit sur disque.
//
//   node --test "test/js/lexique-noms.test.js"     (guillemets obligatoires)
//
// Patron repris de test/js/lexique.test.js (même dossier, même forme : un générateur CLI
// à tiret, un mini-corpus fabriqué plutôt que de dépendre d'une source hors dépôt) et de
// test/js/docx-meta-titre.test.js pour la fabrication d'un .docx minimal (docx-meta.py, et
// donc ce générateur, ne lisent que word/document.xml et word/styles.xml — un zip à deux
// entrées suffit, pas besoin de [Content_Types].xml ni de _rels pour ces deux lectures).
//
// Quatre blocs, du plus petit au plus grand :
//   1. les fonctions de pliage/extraction seules (plier, jeton de stockage, extraction APA) ;
//   2. le fichier RÉELLEMENT LIVRÉ pipeline/lexique/noms-famille.txt (trié, sans doublon,
//      sans ligne vide, sans jeton contenant @ ou un chiffre — la garde de confidentialité du
//      §5.1 du contrat) ;
//   3. le générateur sur un corpus FABRIQUÉ (2-3 .docx minimaux + un auteurs.json minimal),
//      qui prouve les quatre règles de filtrage du §5.2 sans dépendre de tmp/docx-dev ;
//   4. le générateur sur le VRAI corpus tmp/docx-dev (77 galleys, hors dépôt) — sauté via
//      sauter.corpus(t, chemin) s'il est absent (poste sans ce corpus, ou CI).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sauter } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const GENERATEUR = path.join(RACINE, 'outils-dev', 'lexique', 'generer-noms.py');
const NOMS_FAMILLE_LIVRE = path.join(RACINE, 'pipeline', 'lexique', 'noms-famille.txt');
const CORPUS_REEL = path.join(RACINE, 'tmp', 'docx-dev');

function python(args) {
  return cp.spawnSync(PYTHON, args, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
  });
}

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}

// ---- Fabricant de .docx minimal : word/document.xml + word/styles.xml seulement --------
//
// `styles` : [[styleId, nom], ...]. `paragraphes` : [[styleId, texte], ...] — un styleId
// vide donne un paragraphe "Normal" implicite (pas de w:pStyle), comme un Word réel qui
// n'a jamais reçu de style explicite sur ce paragraphe.

function fabriquerDocx(chemin, styles, paragraphes) {
  const programme = [
    'import json, sys, zipfile',
    'chemin, styles, paras = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])',
    'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'def esc(s):',
    '    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")'
      + '.replace(chr(34), "&quot;"))',
    'def para(sid, texte):',
    '    pstyle = (\'<w:pPr><w:pStyle w:val="%s"/></w:pPr>\' % esc(sid)) if sid else ""',
    '    return \'<w:p>%s<w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>\' '
      + '% (pstyle, esc(texte))',
    'corps = "".join(para(sid, t) for sid, t in paras)',
    'doc = (\'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s"><w:body>%s\'',
    '       \'</w:body></w:document>\') % (W, corps)',
    'sxml = [\'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">\' % W]',
    'for sid, nom in styles:',
    '    sxml.append(\'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' '
      + '% (esc(sid), esc(nom)))',
    'sxml.append("</w:styles>")',
    'with zipfile.ZipFile(chemin, "w") as z:',
    '    z.writestr("word/document.xml", doc.encode("utf-8"))',
    '    z.writestr("word/styles.xml", "".join(sxml).encode("utf-8"))',
  ].join('\n');
  const r = python(['-c', programme, chemin, JSON.stringify(styles), JSON.stringify(paragraphes)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Style "Bibliographie" : styleId dont la forme pliée est reconnue par
// docx-meta.Classeur.famille() (i in ('bibliographie', ...)) sans dépendre d'un nom
// localisé — voir docx-meta.py, Classeur.famille().
const STYLES_STD = [['Bibliographie', 'Bibliographie'], ['Titre', 'Titre'], ['Normal', 'Normal']];

function lancerGenerer(args) {
  return python([GENERATEUR].concat(args));
}

// ---------------------------------------------------------------------------------------
// 1. Les fonctions seules — chargées par chemin (generer-noms.py n'est pas un module
// importable par son nom : convention à tiret du dépôt, comme docx-meta.py).

function appelerFonction(nomFonction, argsJson) {
  const programme = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("gn", ' + JSON.stringify(GENERATEUR) + ')',
    'gn = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(gn)',
    'args = json.loads(sys.argv[1])',
    'fn = getattr(gn, ' + JSON.stringify(nomFonction) + ')',
    'resultat = fn(*args)',
    'if isinstance(resultat, set):',
    '    resultat = sorted(resultat)',
    'print(json.dumps(resultat, ensure_ascii=False))',
  ].join('\n');
  const r = python(['-c', programme, JSON.stringify(argsJson)]);
  assert.strictEqual(r.status, 0, nomFonction + ' a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('plier() : accents et casse retirés, ponctuation de bord seule, tiret interne gardé',
  { skip: sansPython }, () => {
    assert.strictEqual(appelerFonction('plier', ['Guilley']), 'guilley');
    assert.strictEqual(appelerFonction('plier', ['GUILLEY']), 'guilley');
    assert.strictEqual(appelerFonction('plier', ['Sermier-Dessemontet']), 'sermier-dessemontet');
    assert.strictEqual(appelerFonction('plier', ['François,']), 'francois');
    assert.strictEqual(appelerFonction('plier', ['«Müller»']), 'muller');
  });

test('valide() : au moins 2 lettres, jamais un chiffre ni une arobase',
  { skip: sansPython }, () => {
    assert.strictEqual(appelerFonction('valide', ['dupont']), true);
    assert.strictEqual(appelerFonction('valide', ['a']), false);
    assert.strictEqual(appelerFonction('valide', ['m2']), false);
    assert.strictEqual(appelerFonction('valide', ['a@b']), false);
    assert.strictEqual(appelerFonction('valide', ['de']), true);
  });

test('_jeton_stockage() : dernier mot non-particule d\'un nom composé',
  { skip: sansPython }, () => {
    assert.strictEqual(appelerFonction('_jeton_stockage', ['Sahli Lozano']), 'lozano');
    assert.strictEqual(appelerFonction('_jeton_stockage', ['de Chambrier']), 'chambrier');
    assert.strictEqual(appelerFonction('_jeton_stockage', ['von Arx']), 'arx');
    assert.strictEqual(appelerFonction('_jeton_stockage', ['Dupont']), 'dupont');
  });

test('_noms_de_reference() : reconnaît « Nom, P. » (direct, particule, plusieurs auteurs), '
  + 'jamais un auteur institutionnel', { skip: sansPython }, () => {
    assert.deepStrictEqual(
      appelerFonction('_noms_de_reference', ['Dupont, M. (2020). Titre. Éditeur.']),
      ['dupont']);
    assert.deepStrictEqual(
      appelerFonction('_noms_de_reference',
        ['Martin, J., & Bernard, L. (2019). Un autre titre. Revue X, 3-12.']),
      ['bernard', 'martin']);
    assert.deepStrictEqual(
      appelerFonction('_noms_de_reference', ['von Arx, M.-C. (2021). Titre composé.']),
      ['arx']);
    // « Bieling, T., Gollner, U. & Joost, G. » : trois auteurs, joints sans « & » avant
    // les deux premiers (forme mesurée sur le corpus réel, voir le rapport de livraison).
    assert.deepStrictEqual(
      appelerFonction('_noms_de_reference',
        ['Bieling, T., Gollner, U. & Joost, G. (2012). Titre. Revue, 1(2), 2-36.']),
      ['bieling', 'gollner', 'joost']);
    // Un auteur institutionnel s'écrit « SIGLE (année). », jamais « SIGLE, X. (année) » —
    // aucune virgule + initiale à trouver, donc aucun nom extrait (mesuré, voir le rapport).
    assert.deepStrictEqual(
      appelerFonction('_noms_de_reference',
        ['OMS (2018). Rapport annuel sur la santé mondiale. OMS.']),
      []);
    // Un éditeur cité en "In A. Untel (Ed.), ..." est écrit PRÉNOM NOM, pas "Nom, P." :
    // jamais confondu avec un auteur.
    assert.deepStrictEqual(
      appelerFonction('_noms_de_reference',
        ['Dupont, M. (2020). Chapitre. In A. Untel (Ed.), Ouvrage collectif (pp. 3-20).']),
      ['dupont']);
  });

// ---------------------------------------------------------------------------------------
// 2. Le fichier RÉELLEMENT LIVRÉ — pipeline/lexique/noms-famille.txt.

function verifierFichierLexique(chemin) {
  if (!fs.existsSync(chemin)) {
    assert.ok(false, 'fichier attendu absent : ' + chemin
      + ' (voir le rapport de livraison : généré mais non committé)');
    return;
  }
  const brut = fs.readFileSync(chemin, 'utf8');
  const lignes = brut.split('\n');
  assert.strictEqual(lignes[lignes.length - 1], '', chemin + ' doit finir par une fin de ligne');
  const corps = lignes.slice(0, -1);
  const commentaires = corps.filter((l) => l.startsWith('#'));
  const jetons = corps.filter((l) => !l.startsWith('#'));
  assert.ok(commentaires.length >= 2, chemin + ' doit porter un en-tête commenté (source, date)');
  assert.ok(jetons.length > 0, chemin + ' ne doit pas être vide');
  assert.ok(jetons.every((j) => j.trim() !== ''), chemin + ' : aucune ligne vide parmi les jetons');
  assert.deepStrictEqual(jetons, jetons.slice().sort(), chemin + ' doit être trié');
  assert.strictEqual(new Set(jetons).size, jetons.length, chemin + ' : aucun doublon');
  const suspects = jetons.filter((j) => j.includes('@') || /\d/.test(j));
  assert.deepStrictEqual(suspects, [], chemin + ' : jeton(s) contenant @ ou un chiffre : ' + suspects);
  // confidentialité (§5.1) : un jeton de nom est UN mot, jamais une paire — aucune ligne ne
  // doit porter d'espace (qui trahirait un couple prénom+nom resté accolé).
  const avecEspace = jetons.filter((j) => j.includes(' '));
  assert.deepStrictEqual(avecEspace, [], chemin + ' : jeton(s) avec un espace (couple non réduit) : ' + avecEspace);
}

test('pipeline/lexique/noms-famille.txt livré : trié, sans doublon, sans ligne vide, '
  + 'sans @ ni chiffre', () => {
  verifierFichierLexique(NOMS_FAMILLE_LIVRE);
});

test('pipeline/lexique/prenoms.txt n\'est plus livré (supprimé le 22.09.2026, décision de '
  + 'Robin — dérivé de la base OJS du poste, voir le rapport de livraison)', () => {
  assert.ok(!fs.existsSync(path.join(RACINE, 'pipeline', 'lexique', 'prenoms.txt')),
    'prenoms.txt existe encore sur le disque, il doit être supprimé');
});

// ---------------------------------------------------------------------------------------
// 3. Le générateur sur un corpus FABRIQUÉ — preuve des règles de filtrage du §5.2 sans
// dépendre de tmp/docx-dev.

function fabriquerCorpus(dossier) {
  // article1.docx : bibliographie stylée, un cas par règle de filtrage.
  fabriquerDocx(path.join(dossier, 'article1.docx'), STYLES_STD, [
    ['Titre', 'Un article de test'],
    ['Bibliographie', 'Dupont, M. (2020). Titre. Éditeur.'],
    ['Bibliographie', 'Martin, J., & Bernard, L. (2019). Un autre titre. Revue X, 3-12.'],
    // institution : aucun nom ne doit en sortir (pas de virgule + initiale).
    ['Bibliographie', 'OMS (2018). Rapport annuel sur la santé mondiale. OMS.'],
    // vu une seule fois dans tout le corpus ET < 4 lettres : écarté par la règle 3, SAUF
    // que la base auteurs (fabriquée plus bas) porte « Wu » comme nom -> gardé (règle 4).
    ['Bibliographie', 'Wu, X. (2021). Un article très court.'],
    // vu une seule fois ET < 4 lettres, ABSENT de la base auteurs -> écarté.
    ['Bibliographie', 'Ha, T. (2022). Encore un article court.'],
  ]);
  // article2.docx : nom de fichier « documentation » -> tout le fichier est écarté (voir
  // docx-meta.detecter_type() et le commentaire d'etendue_biblio() sur la documentation).
  fabriquerDocx(path.join(dossier, '2_Dokumentation.docx'), STYLES_STD, [
    ['Titre', 'Dokumentation'],
    ['Bibliographie', 'Should, N. (2099). Ce nom ne doit jamais apparaître.'],
  ]);
  // article3.docx : aucune bibliographie stylée -> ne contribue rien, ne doit pas planter.
  fabriquerDocx(path.join(dossier, 'article3.docx'), STYLES_STD, [
    ['Titre', 'Un éditorial sans bibliographie'],
    ['Normal', 'Rien à moissonner ici.'],
  ]);
}

function fabriquerBaseAuteurs(chemin) {
  fs.writeFileSync(chemin, JSON.stringify({
    auteurs: [
      // « Wu » comme NOM : exempte le jeton « wu » de la règle 3 (occurrence unique + court)
      // pour noms-famille.txt (règle 4, "jamais écarter un jeton présent dans la base OJS").
      // C'est désormais le SEUL usage de cette base par le générateur (voir l'en-tête) : le
      // prénom des fiches n'est plus lu pour lui-même, il ne sert plus qu'à décider si la
      // fiche compte comme « propre » (nom ET prénom non vides, non bruités).
      { prenom: 'Wei', nom: 'Wu', affiliation: '', email: '', orcid: '' },
      { prenom: 'Anne-Françoise', nom: 'de Chambrier', affiliation: '', email: '', orcid: '' },
      { prenom: 'Isabelle', nom: 'Martin', affiliation: '', email: '', orcid: '' },
      // fiche bruitée (barre oblique) : écartée ENTIÈREMENT (§3.2 du contrat) — ne doit
      // immuniser aucun jeton, ni « szh/csps » ni « edition ».
      { prenom: 'Edition', nom: 'SZH/CSPS', affiliation: '', email: '', orcid: '' },
      // fiche sans prénom : écartée (ne compte pas comme « propre », n'immunise rien).
      { prenom: '', nom: 'SansPrenom', affiliation: '', email: '', orcid: '' },
    ],
  }), 'utf8');
}

test('generer-noms.py sur un corpus fabriqué : les quatre règles de filtrage du §5.2, '
  + 'et plus aucun prenoms.txt écrit', { skip: sansPython }, () => {
    const corpus = dossierJetable('szh-lexique-noms-corpus-');
    const sortie = dossierJetable('szh-lexique-noms-sortie-');
    const baseAuteurs = path.join(dossierJetable('szh-lexique-noms-base-'), 'auteurs.json');
    fabriquerCorpus(corpus);
    fabriquerBaseAuteurs(baseAuteurs);

    const r = lancerGenerer(['--corpus', corpus, '--base-auteurs', baseAuteurs, '--sortie', sortie]);
    assert.strictEqual(r.status, 0, 'generer-noms.py a échoué : ' + r.stderr);

    const noms = fs.readFileSync(path.join(sortie, 'noms-famille.txt'), 'utf8')
      .split('\n').filter((l) => l && !l.startsWith('#'));

    // règle 1+APA : noms directement certifiés par la forme.
    assert.ok(noms.includes('dupont'), 'dupont doit être retenu');
    assert.ok(noms.includes('martin'), 'martin doit être retenu');
    assert.ok(noms.includes('bernard'), 'bernard doit être retenu');
    // règle 2 (institution) : OMS n'a produit aucun nom du tout.
    assert.ok(!noms.includes('oms'), 'un sigle institutionnel ne doit jamais être un nom');
    // règle 4 : « wu » gardé malgré occurrence unique + 2 lettres, car connu de la base OJS.
    assert.ok(noms.includes('wu'), 'wu doit être gardé (présent dans la base OJS)');
    // règle 3 : « ha » écarté, occurrence unique + 2 lettres, absent de la base OJS.
    assert.ok(!noms.includes('ha'), 'ha doit être écarté (bruit : occurrence unique, court)');
    // fichier "documentation" entièrement écarté.
    assert.ok(!noms.includes('should'), 'un fichier de type documentation ne doit rien fournir');

    // plus aucun fichier de prénoms écrit sur disque (supprimé le 22.09.2026).
    assert.ok(!fs.existsSync(path.join(sortie, 'prenoms.txt')),
      'prenoms.txt ne doit plus être écrit par le générateur');

    // confidentialité générale : aucun jeton multi-mots, aucune arobase, aucun chiffre.
    for (const j of noms) {
      assert.ok(!j.includes(' '), 'jeton avec espace : ' + j);
      assert.ok(!j.includes('@'), 'jeton avec arobase : ' + j);
      assert.ok(!/\d/.test(j), 'jeton avec chiffre : ' + j);
    }
  });

test('generer-noms.py --statistiques : n\'écrit rien', { skip: sansPython }, () => {
  const corpus = dossierJetable('szh-lexique-noms-corpus-stats-');
  const sortie = dossierJetable('szh-lexique-noms-sortie-stats-');
  const baseAuteurs = path.join(dossierJetable('szh-lexique-noms-base-stats-'), 'auteurs.json');
  fabriquerCorpus(corpus);
  fabriquerBaseAuteurs(baseAuteurs);
  const r = lancerGenerer(['--corpus', corpus, '--base-auteurs', baseAuteurs, '--sortie', sortie,
    '--statistiques']);
  assert.strictEqual(r.status, 0, 'generer-noms.py --statistiques a échoué : ' + r.stderr);
  assert.ok(!fs.existsSync(path.join(sortie, 'noms-famille.txt')),
    '--statistiques ne doit écrire aucun fichier');
  assert.match(r.stdout, /jetons de nom retenus/);
});

test('generer-noms.py : corpus absent -> pas de plantage, noms-famille.txt vide de jetons',
  { skip: sansPython }, () => {
    const corpusVide = dossierJetable('szh-lexique-noms-corpus-vide-');
    fs.rmdirSync(corpusVide); // dossier inexistant, comme un tmp/docx-dev jamais moissonné.
    const sortie = dossierJetable('szh-lexique-noms-sortie-vide-');
    const r = lancerGenerer(['--corpus', corpusVide, '--sortie', sortie]);
    assert.strictEqual(r.status, 0, 'un corpus absent ne doit jamais faire échouer le script');
    const noms = fs.readFileSync(path.join(sortie, 'noms-famille.txt'), 'utf8')
      .split('\n').filter((l) => l && !l.startsWith('#'));
    assert.deepStrictEqual(noms, []);
  });

// ---------------------------------------------------------------------------------------
// 4. Le VRAI corpus tmp/docx-dev (77 galleys, hors dépôt) — sauté s'il est absent.

test('generer-noms.py sur le corpus réel tmp/docx-dev : ne plante pas, produit un lexique '
  + 'substantiel, tous les jetons sont valides', (t) => {
  if (!fs.existsSync(CORPUS_REEL)) { return sauter.corpus(t, CORPUS_REEL); }
  if (sansPython) { return t.skip(sansPython); }
  const sortie = dossierJetable('szh-lexique-noms-sortie-reel-');
  const r = lancerGenerer(['--corpus', CORPUS_REEL, '--sortie', sortie]);
  assert.strictEqual(r.status, 0, 'generer-noms.py a échoué sur le corpus réel : ' + r.stderr);
  const noms = fs.readFileSync(path.join(sortie, 'noms-famille.txt'), 'utf8')
    .split('\n').filter((l) => l && !l.startsWith('#'));
  // mesuré le 22.09.2026 : 1282 jetons retenus sur ce corpus — une borne basse large (500)
  // couvre une évolution future du corpus (plus de galleys moissonnées) sans re-figer un
  // chiffre exact à chaque régénération.
  assert.ok(noms.length > 500, 'lexique de noms de famille anormalement petit : ' + noms.length);
  for (const j of noms) {
    assert.ok(!j.includes(' ') && !j.includes('@') && !/\d/.test(j),
      'jeton invalide dans le lexique réel : ' + j);
  }
});
