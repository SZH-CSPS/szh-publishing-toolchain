#!/usr/bin/env node
'use strict';
// compter-gardes.js — analyse STATIQUE (grep, pas d'exécution) de test/js/*.test.js,
// test/filtres-pandoc.test.js et test/filtres-import.test.js : combien de tests sont
// gardés par sansPowerShell, sansPython, sansPandocWsl, sansPandoc (test/js/gardes.js)
// et par sauterSiPliageCasse (filtres-pandoc.test.js — filtres-import.test.js suit le
// même patron mais n'a AUCUNE garde : si pandoc manque, ses tests échouent au lieu de
// sauter, donc rien à y compter ; il est lu quand même pour les motifs résiduels).
// Sert la CI (.github/workflows/ci.yml, lot 6) à comparer le
// « # skipped » d'un run TAP réel au nombre ATTENDU sur un runner donné, À L'ÉGALITÉ —
// pour qu'une garde qui cesse de sauter (régression) ou se met à sauter en plus (outil
// disparu du runner) se voie tout de suite, au lieu de se perdre dans un plancher
// approximatif (l'ancien « >= 950 » de ci.yml, posé ~725 tests sous la réalité mesurée :
// voir revue-E.json, constat 1).
//
//   node test/js/compter-gardes.js                  -> JSON sur stdout
//   node test/js/compter-gardes.js --attendu ubuntu  -> un entier (skips attendus)
//   node test/js/compter-gardes.js --attendu windows
//   node test/js/compter-gardes.js --attendu poste
//
// Les motifs résiduels (voir plus bas) sont toujours imprimés sur STDERR, jamais sur
// stdout : un `attendu="$(node compter-gardes.js --attendu ubuntu)"` en CI doit pouvoir
// lire un entier seul, sans avoir à le trier d'un journal.
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
//      lot 8) et des 8 `if (!PYTHON) { return; }` de szh-commun.test.js (lot 3). Cette
//      famille est listée par --motifs-residuels (voir listerMotifsResiduels ci-dessous)
//      mais N'EST PAS comptée dans le total : la compter reviendrait à deviner, au
//      moment de l'analyse statique, si l'outil qu'elle teste sera présent ou non sur le
//      runner qui exécutera le test — exactement ce que gardes.js sait faire et que ce
//      script ne réimplémente pas.
//   2. Un `t.skip()` appelé au corps d'un test pour une raison qui n'est NI PowerShell,
//      ni Python, ni WSL/pandoc, ni le pliage des accents — par exemple
//      biblio.test.js:512, sauté quand `tmp/corpus-ojs` (750 Mo, hors dépôt) est absent.
//      Repéré et compté à part (voir AUTRES_CONNUS plus bas) parce qu'il est trivial à
//      évaluer sans deviner (une existence de dossier), mais tout NOUVEAU t.skip() de ce
//      genre échappera au compteur tant qu'il n'aura pas été ajouté ici à la main.
//
// Conclusion, à ne pas oublier en lisant --attendu : ce compteur ne garantit l'égalité
// que pour ce qui est passé par gardes.js (+ sauterSiPliageCasse, + les deux motifs
// listés dans AUTRES_CONNUS). Tant que les lots 3 et 8 n'ont pas fini leur migration,
// un écart entre --attendu et un run réel peut venir de là — raison de plus pour que la
// CI l'affiche (histogramme des motifs SKIP) plutôt que de le cacher derrière un
// plancher.

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..');
const DOSSIER_TESTS = path.join(RACINE, 'test', 'js');

const FICHIERS_TESTJS = fs.readdirSync(DOSSIER_TESTS)
  .filter((n) => n.endsWith('.test.js'))
  .sort()
  .map((n) => path.join('test', 'js', n));

const FICHIER_PLIAGE = path.join('test', 'filtres-pandoc.test.js');
// filtres-import.test.js (lot 5) : même patron, même emplacement hors test/js/, même
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
// littéralement par le lot 6 : une garde au corps du test (`if (!X) { return; }` près
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

// --------------------------------------------------------- « autres » gardes connues
//
// Deux motifs hors du système gardes.js, mais suffisamment stables et documentés pour
// être évalués sans deviner (voir la note de tête). Ni l'un ni l'autre ne relève d'un
// lot en cours (rapport-erreur.test.js et biblio.test.js n'appartiennent à aucun des
// lots 3/8) : les compter ici ne se périmera pas au fil des migrations en cours.

// rapport-erreur.test.js : `{ skip: HORS_WINDOWS }`, HORS_WINDOWS = process.platform
// !== 'win32'. Ces sites sont déjà classés dans `autres` par compterTout() (aucune des
// 4 gardes de gardes.js n'y correspond) ; attendu() les reconnaît par leur expression
// littérale (voir la boucle plus bas) plutôt que de les recompter ici séparément.

function corpusOjsAbsent() {
  // biblio.test.js:509-512 : `if (!fs.existsSync(CORPUS)) { return t.skip(...); }` où
  // CORPUS = tmp/corpus-ojs (750 Mo, gitignored, jamais dans un checkout CI). Une seule
  // vérification d'existence, pas une exécution : sûr à faire ici.
  return !fs.existsSync(path.join(RACINE, 'tmp', 'corpus-ojs'));
}

// -------------------------------------------------------------------- --attendu <runner>

// Disponibilité des outils par runner : reflète EXACTEMENT ce que ci.yml installe pour
// les jobs contrats (ubuntu-latest) et contrats-windows (windows-latest) — ni l'un ni
// l'autre n'installent pandoc ou une distro WSL ; seul contrats-windows a PowerShell
// (le runner lui-même) ; python3 est présent de base sur ubuntu-latest (Ubuntu le
// fournit), pas garanti sur windows-latest sans étape dédiée (aucune ici). `poste`
// reflète un poste de développement complet : mesuré le 17.09.2026 sur CE poste
// (PowerShell, WSL SZH-Publishing, pandoc et python3 tous présents).
const RUNNERS = {
  ubuntu: {
    inclutPliage: false, // job `contrats` : test/js/*.test.js seulement
    powershell: false, python: true, wsl: false, pandoc: false,
    plateforme: 'linux',
  },
  windows: {
    inclutPliage: false, // job `contrats-windows` : test/js/*.test.js seulement
    powershell: true, python: false, wsl: false, pandoc: false,
    plateforme: 'win32',
  },
  poste: {
    // Vérification locale (lot 6) : test/js/*.test.js ET test/filtres-pandoc.test.js.
    inclutPliage: true,
    powershell: true, python: true, wsl: true, pandoc: true,
    plateforme: process.platform,
    // Le pliage des accents dépend du BUILD pandoc, pas seulement de sa présence (voir
    // filtres-pandoc.test.js, pliageCasse()) : mesuré CASSÉ sur ce poste le 17.09.2026.
    // À revoir si le pandoc du poste change — ce script ne relance pas pandoc pour le
    // vérifier lui-même, ce serait dupliquer sauterSiPliageCasse plutôt que le lire.
    pliageCasseSurCePoste: true,
  },
};

function attendu(nomRunner) {
  const r = RUNNERS[nomRunner];
  if (!r) {
    throw new Error('runner inconnu : ' + nomRunner + ' (ubuntu, windows, poste)');
  }
  const { total, autres } = compterTout();
  let n = 0;
  if (!r.powershell) { n += total.powershell; }
  if (!r.python) { n += total.python; }
  if (!r.wsl) { n += total.wsl; }
  if (!r.pandoc) { n += total.pandoc; }
  if (r.inclutPliage && r.pliageCasseSurCePoste) { n += total.pliage; }
  // « autres » : chaque site classé par fichier/expression, évalué un par un plutôt que
  // par catégorie globale — HORS_WINDOWS ne concerne qu'un fichier, pas tout `autres`.
  for (const a of autres) {
    if (/HORS_WINDOWS/.test(a.expr)) {
      if (r.plateforme !== 'win32') { n += 1; }
    } else {
      // Expression non reconnue AILLEURS que rapport-erreur.test.js : on ne sait pas la
      // trancher, elle reste listée (stderr) mais n'entre pas dans --attendu — mieux
      // vaut un chiffre légèrement bas et expliqué qu'un chiffre inventé.
    }
  }
  if (corpusOjsAbsent()) { n += 1; } // biblio.test.js : identique sur les trois runners
  return n;
}

// -------------------------------------------------------------------------------- main

function main(argv) {
  const motifs = listerMotifsResiduels();
  if (motifs.length) {
    console.error('--- motifs résiduels (abstentions hors gardes.js, non comptés) ---');
    for (const l of motifs) { console.error('  ' + l); }
    console.error('(' + motifs.length + ' ligne(s) — voir l’en-tête de compter-gardes.js)');
  }

  const ideeAttendu = argv.indexOf('--attendu');
  if (ideeAttendu !== -1) {
    const runner = argv[ideeAttendu + 1];
    console.log(String(attendu(runner)));
    return 0;
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
  }));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { compterTout, attendu, listerMotifsResiduels };
