// test/js/encodage-sorties.test.js — le contrôle qui empêche la rechute du défaut mesuré le
// 18.09.2026 : un script pipeline/*.py qui écrit du non-ASCII (ensure_ascii=False, ou un
// littéral accentué passé à print) SANS avoir reconfiguré le flux visé (stdout/stderr) en
// UTF-8 crashe sur Windows dès qu'un accent combinant (nom de fichier venu d'un partage
// macOS/SharePoint, forme décomposée) atteint une console en cp1252 :
//
//   UnicodeEncodeError: 'charmap' codec can't encode character '́'
//
// Sur Linux (WSL, production) l'encodage par défaut est l'UTF-8 : rien n'explose, donc le
// défaut ne se voit JAMAIS depuis la WSL — seulement à chaque exécution locale sous Windows
// (harnais de tests, débogage). Reproduit à la main deux fois le 18.09.2026 sur
// tmp/corpus-relecture/lot-A/4_La méthode Flip Flap.docx, une fois par accident.
//
// La garde qui répare ça (patron : pipeline/apca.py, pipeline/manuscrit_modele.py,
// pipeline/manuscrit_regles.py) :
//
//   try:
//       sys.stdout.reconfigure(encoding='utf-8')
//       sys.stderr.reconfigure(encoding='utf-8')
//   except Exception:
//       pass
//
// posée dans le point d'entrée (principal()/main(), jamais au chargement du module — un
// module IMPORTÉ ne doit pas muter sys.stdout/stderr du processus appelant, voir
// pronto_modele.py importé par pronto-lire.py) et enveloppée (reconfigure() peut lever si
// l'appelant a détaché le flux — la garde ne doit jamais devenir une nouvelle panne).
//
// Analyse par ast (Python, stdlib), pas par regex sur le texte : un littéral accentué peut
// vivre dans un ast.BinOp ('%s' % …) ou une concaténation, pas seulement en tête d'argument
// de print(), et seul un vrai arbre syntaxique distingue « ce print vise stderr » de
// « ce print vise stdout » (file=sys.stderr) — la garde n'est exigée que sur le(s) flux
// réellement visés par un appel à risque, jamais les deux en aveugle (sans quoi
// pipeline/apca.py, qui n'écrit de littéral accentué que sur stdout et ne reconfigure que
// stdout, ressortirait à tort comme fautif).
//
//   node --test test/js/encodage-sorties.test.js
//
// Patron pour le contrôle qui balaye tout le dépôt : test/js/contrats.test.js. Patron pour
// un petit programme Python écrit au vol par un test JS : test/js/manuscrit-docx.test.js
// (FABRIQUE). Gardes de test/js/gardes.js : PYTHON (jamais `python3` en dur, qui tombe sur
// l'alias WindowsApps et fige toute la suite sous spawnSync).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');

// ---------------------------------------------------------------------------------------
// Exemption nommée et commentée — UNIQUEMENT des modules purement importables, qui n'ont
// aucun `if __name__ == '__main__':` et ne sont donc JAMAIS un point d'entrée. Pour ceux-là
// la garde n'a nulle part où vivre : la poser au chargement du module muterait sys.stdout/
// stderr d'un processus qui ne fait qu'IMPORTER le module (pronto_modele.py est importé par
// pronto-lire.py — un effet de bord à distance de cette sorte est très pénible à
// diagnostiquer, voir le § correspondant de outils-dev/). La garde vit chez l'appelant :
// pronto-lire.py, docx-meta.py, etc. la posent déjà dans leur propre principal().
//
//   szh_commun.py       — bibliothèque commune (avertir, lire_yaml…), importée par sept
//                          scripts ; son propre docstring dit « Rien ici n'a d'effet de
//                          bord au chargement. »
//   pronto_modele.py    — règles du gabarit Pronto ; principal() y est une fonction de
//                          BIBLIOTHÈQUE (appelée par pronto-lire.py), pas une CLI — voir le
//                          commentaire de manuscrit_modele.py qui le dit explicitement.
//   pronto_docx.py      — lecteur .docx du gabarit Pronto, importé par pronto-lire.py.
//   pronto_odt.py       — lecteur .odt du gabarit Pronto, importé par pronto-lire.py.
//   manuscrit_gabarit.py — écrivain du gabarit manuscrit (.ecrire), importé par les tests
//                          et par le nettoyeur ; aucune CLI.
//   manuscrit_typo.py   — règles typographiques maison, importées par manuscrit_regles.py
//                          et manuscrit_docx.py ; aucune CLI.
//
// Une exemption qui ne tiendrait plus (un __main__ ajouté un jour à l'un de ces modules)
// doit faire ÉCHOUER ce fichier plutôt que de continuer à couvrir un vrai point d'entrée en
// silence — voir le premier test ci-dessous.
const EXEMPTS = new Set([
  'szh_commun.py',
  'pronto_modele.py',
  'pronto_docx.py',
  'pronto_odt.py',
  'manuscrit_gabarit.py',
  'manuscrit_typo.py',
]);

// ---------------------------------------------------------------------------------------
// Petit analyseur Python (stdlib ast, pas de regex) écrit au vol — patron FABRIQUE de
// manuscrit-docx.test.js. Pour chaque fichier passé en argument, rend :
//   risques : [[ligne, motif, flux]...]   flux = 'stdout' | 'stderr' (celui visé par le
//             print() à risque — file=sys.stderr, sinon stdout, défaut du print builtin) ;
//             motif = 'print-litteral-non-ascii' | 'json.dumps-ensure_ascii-False'.
//   gardes  : les flux (sys.stdout/stdin/stderr) sur lesquels un .reconfigure(encoding=
//             'utf-8') a été repéré n'importe où dans le fichier.
// Un littéral non-ASCII peut vivre dans un ast.BinOp ('%s' % …) ou une concaténation
// implicite : on parcourt tout le sous-arbre de chaque argument positionnel de print(),
// pas seulement l'argument lui-même.
const ANALYSEUR = [
  'import ast, json, sys',
  '',
  'def flux_de_print(noeud):',
  "    for kw in noeud.keywords:",
  "        if kw.arg == 'file' and isinstance(kw.value, ast.Attribute) \\",
  "                and isinstance(kw.value.value, ast.Name) and kw.value.value.id == 'sys':",
  "            if kw.value.attr in ('stdout', 'stderr'):",
  '                return kw.value.attr',
  "    return 'stdout'",
  '',
  'def analyser(chemin):',
  "    with open(chemin, 'r', encoding='utf-8') as f:",
  '        source = f.read()',
  '    arbre = ast.parse(source, filename=chemin)',
  '    risques, gardes = [], set()',
  '    non_ascii = lambda s: any(ord(c) > 127 for c in s)',
  '    for noeud in ast.walk(arbre):',
  '        if not isinstance(noeud, ast.Call):',
  '            continue',
  '        fonc = noeud.func',
  '        nom = fonc.id if isinstance(fonc, ast.Name) else \\',
  '            (fonc.attr if isinstance(fonc, ast.Attribute) else None)',
  "        if nom == 'print':",
  '            flux = flux_de_print(noeud)',
  '            for arg in noeud.args:',
  '                for sn in ast.walk(arg):',
  '                    if isinstance(sn, ast.Constant) and isinstance(sn.value, str) '
    + 'and non_ascii(sn.value):',
  "                        risques.append([noeud.lineno, 'print-litteral-non-ascii', flux])",
  '                        break',
  '                    if isinstance(sn, ast.Call):',
  '                        sf = sn.func',
  '                        snom = sf.attr if isinstance(sf, ast.Attribute) else \\',
  '                            (sf.id if isinstance(sf, ast.Name) else None)',
  "                        if snom == 'dumps':",
  '                            for kw in sn.keywords:',
  "                                if kw.arg == 'ensure_ascii' "
    + 'and isinstance(kw.value, ast.Constant) and kw.value.value is False:',
  '                                    risques.append([noeud.lineno, '
    + "'json.dumps-ensure_ascii-False', flux])",
  "        if nom == 'reconfigure' and isinstance(fonc, ast.Attribute) \\",
  '                and isinstance(fonc.value, ast.Attribute):',
  '            obj = fonc.value.attr',
  '            for kw in noeud.keywords:',
  "                if kw.arg == 'encoding' and isinstance(kw.value, ast.Constant) \\",
  "                        and str(kw.value.value).lower().replace('_', '-') == 'utf-8':",
  '                    gardes.add(obj)',
  "    return {'risques': risques, 'gardes': sorted(gardes)}",
  '',
  'resultat = {}',
  'for chemin in sys.argv[1:]:',
  '    resultat[chemin] = analyser(chemin)',
  'print(json.dumps(resultat, ensure_ascii=True))',
].join('\n');

function fichiersPipeline() {
  return fs.readdirSync(PIPELINE)
    .filter((f) => f.endsWith('.py'))
    .sort();
}

function analyserTous(fichiers) {
  const chemins = fichiers.map((f) => path.join(PIPELINE, f));
  const r = cp.spawnSync(PYTHON, ['-c', ANALYSEUR, ...chemins],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.strictEqual(r.status, 0,
    `l'analyseur ast a échoué (${r.status}) :\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------------------
// 1. L'exemption elle-même ne doit jamais couvrir un vrai point d'entrée : si l'un de ces
// six modules gagne un jour un `if __name__ == '__main__':`, ce test rougit plutôt que de
// laisser un script sans garde se cacher derrière la liste.
test('encodage-sorties : les modules exemptés n\'ont aucun point d\'entrée (__main__)',
  { skip: sansPython }, () => {
    for (const nom of EXEMPTS) {
      const chemin = path.join(PIPELINE, nom);
      assert.ok(fs.existsSync(chemin), `exemption obsolète, le fichier n'existe plus : ${nom}`);
      const source = fs.readFileSync(chemin, 'utf8');
      assert.ok(!/if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(source),
        `${nom} est exempté comme bibliothèque pure mais porte désormais un `
        + `__main__ : retire-le de EXEMPTS et pose-lui sa propre garde.`);
    }
  });

// ---------------------------------------------------------------------------------------
// 2. Chaque script pipeline/*.py non exempté : tout flux (stdout/stderr) sur lequel il
// écrit du non-ASCII doit avoir été reconfiguré en UTF-8 quelque part dans le fichier.
// Un test par fichier, pour qu'un sabotage nomme exactement le fichier fautif.
test('encodage-sorties : chaque script pipeline/*.py qui écrit du non-ASCII déclare sa garde',
  { skip: sansPython }, () => {
    const fichiers = fichiersPipeline().filter((f) => !EXEMPTS.has(f));
    const resultats = analyserTous(fichiers);

    for (const f of fichiers) {
      const chemin = path.join(PIPELINE, f);
      const { risques, gardes } = resultats[chemin];
      const fluxRequis = new Set(risques.map((r) => r[2]));
      const manquants = [...fluxRequis].filter((flux) => !gardes.includes(flux));
      assert.deepStrictEqual(manquants, [],
        `${f} écrit du non-ASCII sur ${manquants.join(', ')} sans reconfigure(encoding=`
        + `'utf-8') sur ce flux — risque de UnicodeEncodeError sous Windows/cp1252 dès `
        + `qu'un accent combinant (nom de fichier venu d'un partage) l'atteint. `
        + `Détail : ${JSON.stringify(risques)}`);
    }
  });

// ---------------------------------------------------------------------------------------
// 3. Contre-épreuve du contrôle lui-même (pas un test qui tourne en CI — un aide-mémoire
// exécutable) : sans AUCUNE garde déclarée, un fichier qui écrit un littéral accentué à
// print() est bien vu comme « à risque ». Si ce test rougissait, l'analyseur serait devenu
// aveugle à la forme la plus simple du défaut.
test('encodage-sorties : l\'analyseur détecte un script sans aucune garde (témoin)',
  { skip: sansPython }, () => {
    const dossier = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-encodage-'));
    const script = path.join(dossier, 'temoin.py');
    fs.writeFileSync(script,
      "import sys\nprint('Ceci contient un é accentué', file=sys.stderr)\n", 'utf8');
    const r = cp.spawnSync(PYTHON, ['-c', ANALYSEUR, script], { encoding: 'utf8' });
    const sortie = JSON.parse(r.stdout);
    const { risques, gardes } = sortie[script];
    assert.ok(risques.length >= 1, 'le témoin sans garde doit être vu comme à risque');
    assert.deepStrictEqual(gardes, [], 'le témoin ne déclare aucune garde');
    fs.rmSync(dossier, { recursive: true, force: true });
  });
