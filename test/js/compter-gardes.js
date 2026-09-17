#!/usr/bin/env node
'use strict';
// compter-gardes.js — analyse STATIQUE (grep, pas d'exécution) de test/js/*.test.js,
// test/filtres-pandoc.test.js et test/filtres-import.test.js : combien de tests sont
// gardés par sansPowerShell, sansPython, sansPandocWsl, sansPandoc (test/js/gardes.js)
// et par sauterSiPliageCasse (filtres-pandoc.test.js — filtres-import.test.js suit le
// même patron mais n'a AUCUNE garde : si pandoc manque, ses tests échouent au lieu de
// sauter, donc rien à y compter ; il est lu quand même pour les motifs résiduels).
//
// PUREMENT INDICATIF — plus un plancher, plus une référence à l'égalité. La CI
// (.github/workflows/ci.yml) l'appelle et affiche son JSON dans le journal pour donner
// une idée de ce qui est gardé DÉCLARATIVEMENT (`{ skip: … }` en option de test()), mais
// la porte qui fait vraiment échouer un job relit le TAP réel ligne à ligne et vérifie
// que chaque `# SKIP` cite un motif reconnu pour CE runner (voir ci.yml, step « motifs
// des tests sautés ») — pas ce script. Cette porte-là voit tout ce qui saute pour de
// vrai, y compris ce que ce compteur ne voit pas (section suivante). Elle remplace une
// ancienne comparaison à l'égalité stricte entre `# skipped` et un entier « attendu »
// que rendait ce script (option --attendu <runner>, retirée) : cette égalité supposait
// à tort que seules des gardes déclaratives existaient, alors que huit fichiers sautent
// en réalité par `t.skip()` AU CORPS du test (invisibles pour ce script — voir plus bas)
// et que le comptage mélangeait par endroits des fichiers hors du glob réellement lancé
// par un job donné (filtres-pandoc.test.js n'entre pas dans test/js/*.test.js).
//
//   node test/js/compter-gardes.js   -> JSON sur stdout, motifs résiduels sur stderr
//
// (compterTout() et listerMotifsResiduels() restent exportés pour qui voudrait rejouer
// l'analyse statique ailleurs ; rien ne compare plus leur résultat à un total mesuré.)
//
// ============================================================================
// CE QUE CE COMPTEUR NE VOIT PAS (à lire avant de lui faire confiance)
// ============================================================================
// Il ne lit que des `{ skip: EXPRESSION }` posés en option de test() (plus l'appel
// explicite à sauterSiPliageCasse, nommé en dur). Deux familles d'abstention lui
// échappent ENTIÈREMENT, et aucune magie ne les récupère :
//
//   1. Une ABSTENTION PAR `return` AU CORPS du test : `if (!PYTHON) { return; }`,
//      `if (absent) { return sauterSansLua(t, absent); }`. Le test s'exécute, ressort
//      PASS dans le TAP — jamais SKIP. Au 17.09.2026, c'est le cas d'environ 25 tests de
//      la famille WSL/pandoc locale (ancrages, biblio, date-numero, fleche-retour,
//      journal-codes, lire-config, metafichier, reimport, reimport-biblio,
//      import-numerotation-titres — pas encore migrés vers `{ skip: sansPandocWsl }`,
//      17.09.2026) et des 8 `if (!PYTHON) { return; }` de szh-commun.test.js. Cette
//      famille est listée par listerMotifsResiduels() ci-dessous mais N'EST PAS comptée
//      dans le total : la compter reviendrait à deviner, au moment de l'analyse
//      statique, si l'outil qu'elle teste sera présent ou non sur le runner qui
//      exécutera le test — exactement ce que gardes.js sait faire et que ce script ne
//      réimplémente pas.
//   2. Un `t.skip()` appelé au corps d'un test pour une raison qui n'est NI PowerShell,
//      ni Python, ni WSL/pandoc, ni le pliage des accents — par exemple
//      biblio.test.js:499 (corpus `tmp/corpus-ojs`, 750 Mo, hors dépôt, absent),
//      raccourcis.test.js:567 (ACL contournée par un compte élevé — le cas du runner CI
//      Windows, qui tourne administrateur) ou courriel-support.test.js (VSCodium absent
//      du runner). Ces sites sont listés par listerMotifsResiduels() (motif RE_T_SKIP)
//      mais jamais devinés ni comptés : voir ci.yml pour la liste des motifs que la
//      porte reconnaît vraiment, runner par runner.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const DOSSIER_TESTS = path.join(RACINE, 'test', 'js');

const FICHIERS_TESTJS = fs.readdirSync(DOSSIER_TESTS)
  .filter((n) => n.endsWith('.test.js'))
  .sort()
  .map((n) => path.join('test', 'js', n));

const FICHIER_PLIAGE = path.join('test', 'filtres-pandoc.test.js');
// filtres-import.test.js : même patron, même emplacement hors test/js/, même
// convention « aucun saut silencieux, si pandoc manque le test ÉCHOUE » — donc aucune
// garde `{ skip: … }` à y compter, mais il tourne dans le même pas que filtres-pandoc
// (job pdf-ua, ci.yml) et doit être lu par les motifs résiduels comme le reste.
const FICHIER_FILTRES_IMPORT = path.join('test', 'filtres-import.test.js');
const FICHIERS_HORS_JS = [FICHIER_PLIAGE, FICHIER_FILTRES_IMPORT];

// ---------------------------------------------------------------- lecture, par garde

// Un test peut combiner deux gardes (courriel-support.test.js : sansPowerShell ||
// sansVSCodium) : on classe sur la première garde CONNUE trouvée dans l'expression, pas
// sur sansVSCodium (propre à ce fichier, pas une garde de gardes.js).
function classifierExpressionSkip(expr) {
  if (/\bsansPandocWsl\b/.test(expr)) { return 'wsl'; }
  if (/\bsansPandoc\b/.test(expr)) { return 'pandoc'; }
  if (/\bsansPowerShell\b/.test(expr)) { return 'powershell'; }
  if (/\bsansPython\b/.test(expr)) { return 'python'; }
  // Forme ternaire historique (emplacements.test.js, volume-numero.test.js) : avant le
  // passage à gardes.js, la même idée s'écrivait `POWERSHELL ? false : 'raison'`.
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
    // Un appel par test gardé, pas la définition de la fonction elle-même (qui contient
    // aussi le littéral "sauterSiPliageCasse" dans son propre nom/commentaire) : on
    // compte les APPELS `sauterSiPliageCasse(t)`, pas les occurrences du nom.
    RE_SAUTER_PLIAGE.lastIndex = 0;
    while ((m = RE_SAUTER_PLIAGE.exec(contenu))) {
      // Exclut la définition `function sauterSiPliageCasse(t) {` elle-même : un appel
      // commence par un espace ou un `(` avant, jamais par le mot-clé `function`.
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
  // filtres-import.test.js : lu pour les mêmes raisons (autres/résiduels), mais n'a
  // aujourd'hui aucun `{ skip: … }` ni sauterSiPliageCasse — sa contribution est donc
  // 0 sur toutes les catégories, sans branche spéciale à écrire.
  const rImport = compterFichier(FICHIER_FILTRES_IMPORT);
  total.powershell += rImport.comptes.powershell;
  total.python += rImport.comptes.python;
  total.wsl += rImport.comptes.wsl;
  total.pandoc += rImport.comptes.pandoc;
  autres.push(...rImport.comptes.autres);
  return { total: total, autres: autres };
}

// ---------------------------------------------------------- motifs résiduels (journal)

// Grep, pas d'exécution : liste ce que le compte ci-dessus NE voit pas, pour que la CI
// l'affiche plutôt que de laisser croire à une couverture totale. Deux motifs, cités
// littéralement, un temps, par la CI : une garde au corps du test (`if (!X) { return; }` près
// d'une détection d'outil), et un `t.skip(` appelé hors de sauterSiPliageCasse.
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
      // .test régulières globales gardent un lastIndex : sans reset, une ligne SANS
      // match après une ligne AVEC match serait sautée à tort.
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
