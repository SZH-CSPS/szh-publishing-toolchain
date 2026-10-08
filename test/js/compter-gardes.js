#!/usr/bin/env node
'use strict';
// Analyse statique (sans exécution) de test/js/*.test.js, test/filtres-pandoc.test.js et
// test/filtres-import.test.js : compte les tests gardés par sansPowerShell, sansPython,
// sansPandocWsl, sansPandoc (test/js/gardes.js) et par sauterSiPliageCasse
// (filtres-pandoc.test.js). filtres-import.test.js n'a pas de garde : si pandoc manque, ses
// tests échouent ; il est lu pour les motifs résiduels.
//
// Le résultat est indicatif. La CI (.github/workflows/ci.yml) affiche ce JSON dans son
// journal ; ce qui fait échouer un job est l'étape « motifs des tests sautés », qui relit le
// TAP réel et vérifie que chaque `# SKIP` cite un motif reconnu pour ce runner.
//
//   node test/js/compter-gardes.js   -> JSON sur stdout, motifs résiduels sur stderr
//
// compterTout() et listerMotifsResiduels() sont exportés.
//
// Ce que ce compteur ne voit pas : il ne lit que les `{ skip: EXPRESSION }` posés en option
// de test(), plus les appels à sauterSiPliageCasse. Lui échappent :
//
//   1. l'abstention par `return` dans le corps du test (`if (!PYTHON) { return; }`,
//      `if (absent) { return sauterSansLua(t, absent); }`) : le test sort PASS, pas SKIP.
//      listerMotifsResiduels() liste ces sites sans les compter : savoir si l'outil sera
//      présent sur le runner est le rôle de gardes.js ;
//   2. un `t.skip()` dans le corps du test pour une autre raison (corpus absent dans
//      biblio.test.js, ACL contournée par un compte administrateur dans
//      raccourcis.test.js, VSCodium absent dans courriel-support.test.js). Ces sites sont
//      listés (motif RE_T_SKIP), pas comptés ; voir ci.yml pour les motifs admis par runner.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const DOSSIER_TESTS = path.join(RACINE, 'test', 'js');

const FICHIERS_TESTJS = fs.readdirSync(DOSSIER_TESTS)
  .filter((n) => n.endsWith('.test.js'))
  .sort()
  .map((n) => path.join('test', 'js', n));

const FICHIER_PLIAGE = path.join('test', 'filtres-pandoc.test.js');
// filtres-import.test.js : hors de test/js/ comme filtres-pandoc, sans garde (si pandoc
// manque, le test échoue), lancé dans la même étape (job pdf-ua, ci.yml). Il est lu pour
// les motifs résiduels.
const FICHIER_FILTRES_IMPORT = path.join('test', 'filtres-import.test.js');
const FICHIERS_HORS_JS = [FICHIER_PLIAGE, FICHIER_FILTRES_IMPORT];

// ---------------------------------------------------------------- lecture, par garde

// Un test peut combiner deux gardes (courriel-support.test.js : sansPowerShell ||
// sansVSCodium) : on classe sur la première garde de gardes.js trouvée dans l'expression.
function classifierExpressionSkip(expr) {
  if (/\bsansPandocWsl\b/.test(expr)) { return 'wsl'; }
  if (/\bsansPandoc\b/.test(expr)) { return 'pandoc'; }
  if (/\bsansPowerShell\b/.test(expr)) { return 'powershell'; }
  if (/\bsansPython\b/.test(expr)) { return 'python'; }
  // Forme ternaire `POWERSHELL ? false : 'raison'` (emplacements.test.js,
  // volume-numero.test.js).
  if (/\bPOWERSHELL\s*\?\s*false\b/.test(expr)) { return 'powershell'; }
  return null;
}

const RE_SKIP_OPTION = /\{\s*skip:\s*([^}]*)\}/g;
const RE_SAUTER_PLIAGE = /\bsauterSiPliageCasse\(/g;

function compterFichier(cheminRelatif) {
  const contenu = fs.readFileSync(path.join(RACINE, cheminRelatif), 'utf8');
  const comptes = { powershell: 0, python: 0, wsl: 0, pandoc: 0, autres: [] };
  let m;
  RE_SKIP_OPTION.lastIndex = 0;
  while ((m = RE_SKIP_OPTION.exec(contenu))) {
    const cat = classifierExpressionSkip(m[1]);
    if (cat) {
      comptes[cat] += 1;
    } else {
      const ligne = contenu.slice(0, m.index).split('\n').length;
      comptes.autres.push({ fichier: cheminRelatif, ligne: ligne, expr: m[1].trim() });
    }
  }
  let pliage = 0;
  if (cheminRelatif === FICHIER_PLIAGE) {
    // On compte les appels `sauterSiPliageCasse(t)`, un par test gardé, pas les
    // occurrences du nom.
    RE_SAUTER_PLIAGE.lastIndex = 0;
    while ((m = RE_SAUTER_PLIAGE.exec(contenu))) {
      // Exclut la définition `function sauterSiPliageCasse(t) {`.
      const avant = contenu.slice(Math.max(0, m.index - 9), m.index);
      if (!/function\s+$/.test(avant)) { pliage += 1; }
    }
  }
  return { comptes: comptes, pliage: pliage };
}

function compterTout() {
  const total = { powershell: 0, python: 0, wsl: 0, pandoc: 0, pliage: 0 };
  const autres = [];
  for (const f of FICHIERS_TESTJS) {
    const r = compterFichier(f);
    total.powershell += r.comptes.powershell;
    total.python += r.comptes.python;
    total.wsl += r.comptes.wsl;
    total.pandoc += r.comptes.pandoc;
    autres.push(...r.comptes.autres);
  }
  const rPliage = compterFichier(FICHIER_PLIAGE);
  total.pliage = rPliage.pliage;
  total.powershell += rPliage.comptes.powershell;
  total.python += rPliage.comptes.python;
  total.wsl += rPliage.comptes.wsl;
  total.pandoc += rPliage.comptes.pandoc;
  autres.push(...rPliage.comptes.autres);
  // filtres-import.test.js n'a ni `{ skip: … }` ni sauterSiPliageCasse : il compte 0
  // partout, sans branche spéciale.
  const rImport = compterFichier(FICHIER_FILTRES_IMPORT);
  total.powershell += rImport.comptes.powershell;
  total.python += rImport.comptes.python;
  total.wsl += rImport.comptes.wsl;
  total.pandoc += rImport.comptes.pandoc;
  autres.push(...rImport.comptes.autres);
  return { total: total, autres: autres };
}

// ---------------------------------------------------------- motifs résiduels (journal)

// Liste, par recherche de texte, ce que le compte ci-dessus ne voit pas, pour que la CI
// l'affiche : une garde dans le corps du test (`if (!X) { return; }`), et un `t.skip(`
// appelé hors de sauterSiPliageCasse.
const RE_RETURN_GARDE = /if\s*\(\s*!\w+\s*\)\s*\{\s*return;?\s*\}/g;
const RE_RETURN_SAUTER = /return\s+sauter\w*\(/g;
const RE_T_SKIP = /\bt\.skip\(/g;

function listerMotifsResiduels() {
  const lignes = [];
  const fichiers = FICHIERS_TESTJS.concat(FICHIERS_HORS_JS);
  for (const f of fichiers) {
    const contenu = fs.readFileSync(path.join(RACINE, f), 'utf8');
    const parLigne = contenu.split('\n');
    for (let i = 0; i < parLigne.length; i++) {
      const l = parLigne[i];
      if (RE_RETURN_GARDE.test(l) || RE_RETURN_SAUTER.test(l) || RE_T_SKIP.test(l)) {
        lignes.push(f + ':' + (i + 1) + ': ' + l.trim());
      }
      // Une expression régulière globale garde son lastIndex entre deux .test() : on le
      // remet à zéro pour chaque ligne.
      RE_RETURN_GARDE.lastIndex = 0;
      RE_RETURN_SAUTER.lastIndex = 0;
      RE_T_SKIP.lastIndex = 0;
    }
  }
  return lignes;
}

// -------------------------------------------------------------------------------- main

function main() {
  const motifs = listerMotifsResiduels();
  if (motifs.length) {
    console.error('--- motifs résiduels (abstentions hors gardes.js, non comptés) ---');
    for (const l of motifs) { console.error('  ' + l); }
    console.error('(' + motifs.length + ' ligne(s) — voir l’en-tête de compter-gardes.js)');
  }

  const { total, autres } = compterTout();
  const totalGeneral = total.powershell + total.python + total.wsl + total.pandoc + total.pliage;
  if (autres.length) {
    console.error('--- « skip: » reconnus mais hors des 4 gardes de gardes.js ---');
    for (const a of autres) {
      console.error('  ' + a.fichier + ':' + a.ligne + ': skip: ' + a.expr);
    }
  }
  console.log(JSON.stringify({
    powershell: total.powershell,
    python: total.python,
    wsl: total.wsl,
    pandoc: total.pandoc,
    pliage: total.pliage,
    total: totalGeneral,
    indicatif: true,
  }));
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { compterTout, listerMotifsResiduels };
