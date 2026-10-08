// Un script pipeline/*.py qui écrit du non-ASCII (ensure_ascii=False, ou un littéral
// accentué passé à print) sans avoir reconfiguré le flux visé en UTF-8 plante sous Windows
// dès qu'un accent combinant (nom de fichier en forme décomposée) atteint une console en
// cp1252 :
//
//   UnicodeEncodeError: 'charmap' codec can't encode character '́'
//
// Dans la WSL, l'encodage par défaut est l'UTF-8 : le défaut n'y apparaît pas.
//
// La garde attendue (voir pipeline/apca.py, pipeline/manuscrit_modele.py,
// pipeline/manuscrit_regles.py) :
//
//   try:
//       sys.stdout.reconfigure(encoding='utf-8')
//       sys.stderr.reconfigure(encoding='utf-8')
//   except Exception:
//       pass
//
// Elle se pose dans le point d'entrée (principal() ou main()), et non au chargement : un
// module importé ne doit pas modifier les flux du processus appelant. Le try la protège
// quand l'appelant a détaché le flux.
//
// L'analyse passe par ast, et non par des regex : un littéral accentué peut se trouver dans
// un ast.BinOp ('%s' % …) ou une concaténation, et seul l'arbre dit quel flux vise un print
// (file=sys.stderr). La garde n'est exigée que sur les flux visés : pipeline/apca.py, qui
// n'écrit d'accents que sur stdout, ne reconfigure que stdout.
//
// Python passe par python() de test/js/gardes.js (la WSL sous Windows).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { python, sansPython, cheminPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');

// ---------------------------------------------------------------------------------------
// Modules exemptés : des bibliothèques sans `if __name__ == '__main__':`, donc sans point
// d'entrée où poser la garde. La poser au chargement modifierait les flux de tout
// processus qui les importe. La garde est chez l'appelant (pronto-lire.py, docx-meta.py…).
//
//   szh_commun.py       — bibliothèque commune (avertir, lire_yaml…), sans effet de bord
//                          au chargement.
//   pronto_modele.py    — règles du gabarit Pronto ; son principal() est une fonction de
//                          bibliothèque, appelée par pronto-lire.py.
//   pronto_docx.py      — lecteur .docx du gabarit Pronto, importé par pronto-lire.py.
//   manuscrit_gabarit.py — écrivain du gabarit manuscrit (.ecrire), importé par les tests
//                          et par le nettoyeur ; aucune CLI.
//   manuscrit_typo.py   — règles typographiques maison, importées par manuscrit_regles.py
//                          et manuscrit_docx.py ; aucune CLI.
//
// Si l'un de ces modules gagne un __main__, le premier test échoue.
const EXEMPTS = new Set([
  'szh_commun.py',
  'pronto_modele.py',
  'pronto_docx.py',
  'manuscrit_gabarit.py',
  'manuscrit_typo.py',
]);

// ---------------------------------------------------------------------------------------
// Petit analyseur Python (module ast), passé par -c. Pour chaque fichier en argument, rend :
//   risques : [[ligne, motif, flux]...]   flux = 'stdout' | 'stderr' (celui visé par le
//             print() à risque — file=sys.stderr, sinon stdout, défaut du print builtin) ;
//             motif = 'print-litteral-non-ascii' | 'json.dumps-ensure_ascii-False'.
//   gardes  : les flux (sys.stdout/stdin/stderr) sur lesquels un .reconfigure(encoding=
//             'utf-8') a été repéré n'importe où dans le fichier.
// Un littéral non-ASCII peut se trouver dans un ast.BinOp ('%s' % …) ou une concaténation
// implicite : on parcourt tout le sous-arbre de chaque argument positionnel de print().
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
  const r = python(['-c', ANALYSEUR, ...chemins],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.strictEqual(r.status, 0,
    `l'analyseur ast a échoué (${r.status}) :\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------------------
// 1. Aucun module exempté n'a de `if __name__ == '__main__':`.
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
// 2. Chaque script pipeline/*.py non exempté reconfigure en UTF-8 tout flux (stdout,
// stderr) sur lequel il écrit du non-ASCII. Le message d'échec nomme le fichier fautif.
test('encodage-sorties : chaque script pipeline/*.py qui écrit du non-ASCII déclare sa garde',
  { skip: sansPython }, () => {
    const fichiers = fichiersPipeline().filter((f) => !EXEMPTS.has(f));
    const resultats = analyserTous(fichiers);

    for (const f of fichiers) {
      const chemin = path.join(PIPELINE, f);
      const { risques, gardes } = resultats[cheminPython(chemin)];
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
// 3. Témoin : un fichier sans garde qui passe un littéral accentué à print() est vu comme
// « à risque ». S'il ne l'est plus, l'analyseur est devenu aveugle au cas le plus simple.
test('encodage-sorties : l\'analyseur détecte un script sans aucune garde (témoin)',
  { skip: sansPython }, () => {
    const dossier = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-encodage-'));
    const script = path.join(dossier, 'temoin.py');
    fs.writeFileSync(script,
      "import sys\nprint('Ceci contient un é accentué', file=sys.stderr)\n", 'utf8');
    const r = python(['-c', ANALYSEUR, script], { encoding: 'utf8' });
    const sortie = JSON.parse(r.stdout);
    const { risques, gardes } = sortie[cheminPython(script)];
    assert.ok(risques.length >= 1, 'le témoin sans garde doit être vu comme à risque');
    assert.deepStrictEqual(gardes, [], 'le témoin ne déclare aucune garde');
    fs.rmSync(dossier, { recursive: true, force: true });
  });
