// pipeline/pagination.py : la pagination continue d'un numéro (folios de départ par
// article, feuilles .szh-folio.css passées à WeasyPrint en feuille utilisateur).
//
//   node --test test/js/pagination.test.js
//
// Ce que ce fichier tient :
//   1. les départs cumulés (dépendent de compter_pages(), donc de PDF réels — voir
//      fabriquerPdf ci-dessous) ;
//   2. le contenu de la feuille écrite pour un article qui ne part pas à 1 ;
//   3. l'idempotence d'un second `rafraichir` sans rien changer : la feuille est un
//      prérequis make du PDF, la réécrire à l'identique referait tous les PDF du numéro ;
//   4. la péremption, aux trois positions possibles dans l'ordre — jamais avant ;
//   5. `inconnus` (article sans PDF) et le refus en code 2 de `rafraichir`, sans qu'aucune
//      feuille ne soit écrite ;
//   6. `enregistre`, avant puis après un `rafraichir` ;
//   7. `feuilles`, reconstruite depuis .szh-pagination.json seul, identique au caractère
//      près, et son passage silencieux quand ce fichier est absent ;
//   8. le premier article (départ 1) reçoit lui aussi une feuille ;
//   9. UN cas avec WeasyPrint réel (WSL) : la feuille produite par pagination.py décale
//      vraiment les folios imprimés, pas seulement le JSON qui les annonce.
//  10. un article INSÉRÉ dans l'ordre : les suivants glissent sans qu'aucun nombre de
//      pages ne change, et doivent tous être signalés ;
//  10 bis. deux articles CONNUS permutés : le seul cas que la comparaison des départs
//      attrape toute seule — aucun slug neuf, aucune longueur changée ;
//  11. après un `make clean` : plus un seul PDF, et pourtant ni départ perdu ni fausse
//      alerte.
//  12. `rafraichir` exige --ordre, et `etat` sans lui relit l'ordre de la dernière
//      pagination : seul le cockpit connaît l'ordre de lecture d'un numéro.
//
// Les PDF de test ne sont jamais compilés par WeasyPrint (cas 1 à 8) : ce sont des PDF
// minimaux écrits à la main (un objet /Type /Pages /Count N et N objets /Type /Page, table
// xref non compressée). Vérifié avant d'en dépendre : pypdf 6.15.0 (celui de ce poste,
// `python -c "import pypdf"`) les relit avec le bon nombre de pages, et pipeline/pagination.py
// lui-même (compter_pages) les compte correctement — la première assertion du fichier
// (départs cumulés) l'exerce déjà.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PAGINATION = path.join(RACINE, 'pipeline', 'pagination.py');

// Toujours forcé : sys.stdout de python est en cp1252 par défaut sur ce poste (mesuré,
// `python -c "import sys; print(sys.stdout.encoding)"`), qui corromprait tout accent des
// messages d'erreur relus ensuite comme de l'UTF-8 par Node.
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe || 'szh-pagination-'));
}

// Un PDF minimal, non compressé, dont pypdf lit le vrai nombre de pages — jamais une
// compilation WeasyPrint (trop lente pour huit cas qui ne regardent que le comptage).
function fabriquerPdf(chemin, nPages) {
  const objets = ['<< /Type /Catalog /Pages 2 0 R >>'];
  const enfants = Array.from({ length: nPages }, (_, i) => (3 + i) + ' 0 R').join(' ');
  objets.push('<< /Type /Pages /Kids [' + enfants + '] /Count ' + nPages + ' >>');
  for (let i = 0; i < nPages; i++) {
    objets.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>');
  }
  let sortie = '%PDF-1.4\n';
  const decalages = [0];
  objets.forEach((corps, i) => {
    decalages.push(Buffer.byteLength(sortie, 'latin1'));
    sortie += (i + 1) + ' 0 obj\n' + corps + '\nendobj\n';
  });
  const posXref = Buffer.byteLength(sortie, 'latin1');
  sortie += 'xref\n0 ' + (objets.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < decalages.length; i++) {
    sortie += String(decalages[i]).padStart(10, '0') + ' 00000 n \n';
  }
  sortie += 'trailer\n<< /Size ' + (objets.length + 1) + ' /Root 1 0 R >>\n'
    + 'startxref\n' + posXref + '\n%%EOF';
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, Buffer.from(sortie, 'latin1'));
}

function cheminPdf(base, slug) { return path.join(base, 'out', slug, slug + '.pdf'); }
function cheminFolio(base, slug) { return path.join(base, 'out', slug, '.szh-folio.css'); }
function cheminJsonPagination(base) { return path.join(base, '.szh-pagination.json'); }

function creerArticle(base, slug, pages) { fabriquerPdf(cheminPdf(base, slug), pages); }

// Un numéro à N articles a1..aN, un par entrée de `pagesParArticle`.
function preparerNumero(prefixe, pagesParArticle) {
  const base = dossierJetable(prefixe);
  const ordre = pagesParArticle.map((_, i) => 'a' + (i + 1));
  pagesParArticle.forEach((pages, i) => creerArticle(base, ordre[i], pages));
  return { base, ordre };
}

function executer(sousCommande, args, base) {
  return cp.spawnSync(PYTHON, [PAGINATION, sousCommande].concat(args || []).concat(['--dossier', base]),
    { encoding: 'utf8', env: ENV_UTF8 });
}
function etat(base, ordre) { return executer('etat', ['--ordre', ordre.join(',')], base); }
function rafraichir(base, ordre) { return executer('rafraichir', ['--ordre', ordre.join(',')], base); }
function feuilles(base) { return executer('feuilles', [], base); }

// stdout est toujours une seule ligne JSON (etat/rafraichir/feuilles impriment un seul
// json.dumps) : une deuxième ligne dénoncerait une sortie de debug oubliée dans le script.
function sortieJson(r) {
  assert.strictEqual(r.status, 0, 'sortie inattendue (' + r.status + ') : ' + r.stderr);
  const lignes = r.stdout.split('\n').filter((l) => l.length > 0);
  assert.strictEqual(lignes.length, 1, 'stdout doit porter une seule ligne JSON : ' + JSON.stringify(lignes));
  return JSON.parse(lignes[0]);
}

const dormirSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// ---------------------------------------------------------------------------------------
// 1. Départs cumulés
// ---------------------------------------------------------------------------------------

test('pagination : départs cumulés de trois articles (2, 3, 1 pages) et total', { skip: sansPython }, () => {
  const { base, ordre } = preparerNumero('szh-pagination-departs-', [2, 3, 1]);
  try {
    const obj = sortieJson(etat(base, ordre));
    assert.deepStrictEqual(obj.articles.map((a) => [a.slug, a.depart, a.pages, a.pdf]), [
      ['a1', 1, 2, true],
      ['a2', 3, 3, true],
      ['a3', 6, 1, true]
    ]);
    assert.strictEqual(obj.total, 6);
    assert.deepStrictEqual(obj.perimes, []);
    assert.deepStrictEqual(obj.inconnus, []);
    assert.strictEqual(obj.enregistre, false, 'aucun rafraichir n’a encore eu lieu');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// 2. Contenu de la feuille du deuxième article
// ---------------------------------------------------------------------------------------

test('pagination : la feuille du deuxième article porte counter-reset: page 3', { skip: sansPython }, () => {
  const { base, ordre } = preparerNumero('szh-pagination-feuille-', [2, 3, 1]);
  try {
    const obj = sortieJson(rafraichir(base, ordre));
    assert.deepStrictEqual(obj.ecrites.slice().sort(), ordre.slice().sort());
    const contenu = fs.readFileSync(cheminFolio(base, 'a2'), 'utf8');
    // Tolérant aux espaces : ce n'est pas au script de figer l'espacement, seulement la
    // valeur — départ lui-même, pas départ − 1 (mesuré sur WeasyPrint, voir l'en-tête du
    // script).
    assert.match(contenu, /counter-reset:\s*page\s+3\s*;/);
    assert.match(contenu, /@page\s*:first/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// 3. Idempotence : un second rafraichir sans rien changer ne réécrit rien
// ---------------------------------------------------------------------------------------

test('pagination : un second rafraichir identique rend ecrites: [] et ne touche aucune feuille',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-idempotence-', [2, 3, 1]);
    try {
      sortieJson(rafraichir(base, ordre));
      const avant = ordre.map((slug) => fs.statSync(cheminFolio(base, slug)).mtimeMs);
      const jsonAvant = fs.statSync(cheminJsonPagination(base)).mtimeMs;
      dormirSync(20); // rendrait visible un mtime qui bougerait à tort
      const obj = sortieJson(rafraichir(base, ordre));
      // Piège que ce cas protège : la feuille est un prérequis make du PDF, la réécrire à
      // l'identique referait tous les PDF du numéro à chaque rafraîchissement.
      assert.deepStrictEqual(obj.ecrites, []);
      const apres = ordre.map((slug) => fs.statSync(cheminFolio(base, slug)).mtimeMs);
      assert.deepStrictEqual(apres, avant, 'au moins une feuille a été réécrite sans changement de contenu');
      assert.strictEqual(fs.statSync(cheminJsonPagination(base)).mtimeMs, jsonAvant);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 4. Péremption aux trois positions — jamais un article avant celui qui diverge
// ---------------------------------------------------------------------------------------

test('pagination : la péremption démarre au premier article dont les pages divergent, jamais avant',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-perimes-', [2, 3, 1]);
    try {
      sortieJson(rafraichir(base, ordre));

      creerArticle(base, 'a1', 3); // 2 -> 3 pages
      assert.deepStrictEqual(sortieJson(etat(base, ordre)).perimes, ['a1', 'a2', 'a3']);
      creerArticle(base, 'a1', 2); // restauré, retour à l'état enregistré

      creerArticle(base, 'a2', 4); // 3 -> 4 pages
      assert.deepStrictEqual(sortieJson(etat(base, ordre)).perimes, ['a2', 'a3']);
      creerArticle(base, 'a2', 3);

      creerArticle(base, 'a3', 2); // 1 -> 2 pages
      assert.deepStrictEqual(sortieJson(etat(base, ordre)).perimes, ['a3']);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 5. inconnus et le refus en code 2 de rafraichir, sans rien écrire
// ---------------------------------------------------------------------------------------

test('pagination : un article sans PDF est "inconnu", jamais "périmé", et bloque rafraichir (code 2) sans écrire',
  { skip: sansPython }, () => {
    const base = dossierJetable('szh-pagination-inconnu-');
    try {
      creerArticle(base, 'a1', 2);
      // a2 n'a pas de PDF compilé.
      const obj = sortieJson(etat(base, ['a1', 'a2']));
      assert.deepStrictEqual(obj.inconnus, ['a2']);
      assert.deepStrictEqual(obj.perimes, [], 'un article inconnu n’est pas un article périmé');

      const r = rafraichir(base, ['a1', 'a2']);
      assert.strictEqual(r.status, 2);
      assert.deepStrictEqual(fs.readdirSync(path.join(base, 'out', 'a1')), ['a1.pdf'],
        'aucune feuille ne doit apparaître à côté du PDF compilé');
      assert.ok(!fs.existsSync(path.join(base, 'out', 'a2')), 'aucun dossier créé pour l’article sans PDF');
      assert.ok(!fs.existsSync(cheminJsonPagination(base)), '.szh-pagination.json ne doit pas apparaître');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 6. enregistre : false puis true
// ---------------------------------------------------------------------------------------

test('pagination : enregistre vaut false sans .szh-pagination.json, true après un rafraichir',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-enregistre-', [2, 3]);
    try {
      assert.strictEqual(sortieJson(etat(base, ordre)).enregistre, false);
      sortieJson(rafraichir(base, ordre));
      assert.strictEqual(sortieJson(etat(base, ordre)).enregistre, true);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 7. feuilles : reconstruction identique, et passage silencieux sans JSON
// ---------------------------------------------------------------------------------------

test('pagination : feuilles régénère des feuilles identiques au caractère près depuis le JSON seul',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-feuilles-', [2, 3, 1]);
    try {
      sortieJson(rafraichir(base, ordre));
      const avant = {};
      for (const slug of ordre) { avant[slug] = fs.readFileSync(cheminFolio(base, slug), 'utf8'); }

      for (const slug of ordre) { fs.rmSync(cheminFolio(base, slug)); }
      const obj = sortieJson(feuilles(base));
      assert.deepStrictEqual(obj.ecrites.slice().sort(), ordre.slice().sort());
      assert.strictEqual(obj.articles, ordre.length);
      // .szh-pagination.json seul a suffi : aucun PDF n'a été regardé pour ce résultat —
      // le cas d'usage réel est make clean, qui efface out/ (donc les feuilles) sans
      // toucher .szh-pagination.json.
      for (const slug of ordre) {
        assert.strictEqual(fs.readFileSync(cheminFolio(base, slug), 'utf8'), avant[slug],
          'feuille de ' + slug + ' différente après reconstruction');
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('pagination : feuilles sort en code 0 sans rien écrire quand .szh-pagination.json est absent',
  { skip: sansPython }, () => {
    const base = dossierJetable('szh-pagination-feuilles-absent-');
    try {
      const r = feuilles(base);
      assert.strictEqual(r.status, 0);
      const obj = JSON.parse(r.stdout.trim());
      assert.deepStrictEqual(obj.ecrites, []);
      // Numéro jamais paginé : cas normal, pas une panne — rien à créer.
      assert.deepStrictEqual(fs.readdirSync(base), []);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 8. Le premier article, départ 1, reçoit lui aussi une feuille
// ---------------------------------------------------------------------------------------

test('pagination : le premier article (départ 1) reçoit lui aussi une feuille', { skip: sansPython }, () => {
  const { base, ordre } = preparerNumero('szh-pagination-premier-', [2, 3, 1]);
  try {
    const obj = sortieJson(rafraichir(base, ordre));
    assert.ok(obj.ecrites.includes('a1'), 'le premier article doit figurer parmi les feuilles écrites');
    // Retirer sa feuille ne ramènerait pas le PDF au folio 1 : make ne verrait alors plus
    // aucun prérequis avoir bougé pour ce PDF (mesuré). « Départ 1, donc pas besoin de
    // feuille » serait un raccourci qui laisse le folio dériver en silence.
    const contenu = fs.readFileSync(cheminFolio(base, 'a1'), 'utf8');
    assert.match(contenu, /counter-reset:\s*page\s+1\s*;/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// 9. Avec WSL : la feuille produite par le script décale vraiment les folios imprimés
// ---------------------------------------------------------------------------------------

const DISTRO = 'SZH-Publishing';

function cheminVersWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function wsl(args) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return cp.spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe', ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

// Patron minimal de la maquette réelle (pipeline/styles/print.css) : pied courant en
// position: running(), folio en ::after { content: counter(page) }, trois blocs séparés
// par un saut de page — juste assez pour lire trois folios consécutifs.
const HTML_PATRON = [
  '<!doctype html><html><head><meta charset="utf-8"><style>',
  '@page { size: 100mm 100mm; margin: 15mm; @bottom-center { content: element(piedCourant); } }',
  '.pied { position: running(piedCourant); }',
  '.folio::after { content: counter(page); }',
  '.bloc { break-after: page; }',
  '</style></head><body>',
  '<div class="pied"><span class="folio"></span></div>',
  '<div class="bloc">Section un</div>',
  '<div class="bloc">Section deux</div>',
  '<div class="bloc">Section trois</div>',
  '</body></html>'
].join('\n');

// Lit, dans le venv WeasyPrint (seul python de la distro à porter pypdf — voir l'en-tête de
// pagination.py), le dernier mot non vide de chaque page : c'est le folio, `extract_text()`
// rendant "Section un\n1".
const EXTRAIRE_FOLIOS = [
  'import json, sys',
  'from pypdf import PdfReader',
  'resultat = []',
  'for chemin in sys.argv[1:]:',
  '    r = PdfReader(chemin)',
  '    folios = []',
  '    for p in r.pages:',
  '        lignes = [l for l in (p.extract_text() or "").split("\\n") if l.strip()]',
  '        folios.append(lignes[-1].strip() if lignes else "")',
  '    resultat.append(folios)',
  'print(json.dumps(resultat))'
].join('\n');

test('pagination + WeasyPrint (WSL) : une feuille produite par le script décale vraiment les folios imprimés',
  (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }

    // La feuille vient réellement de pagination.py : un numéro à deux articles (10 puis 1
    // page), pour que le second parte au folio 11.
    const numero = dossierJetable('szh-pagination-wsl-numero-');
    const travail = dossierJetable('szh-pagination-wsl-html-');
    try {
      creerArticle(numero, 'avant', 10);
      creerArticle(numero, 'decale', 1);
      const obj = sortieJson(rafraichir(numero, ['avant', 'decale']));
      const depart = obj.articles.find((a) => a.slug === 'decale').depart;
      assert.strictEqual(depart, 11);
      const feuilleDecale = fs.readFileSync(cheminFolio(numero, 'decale'), 'utf8');
      assert.match(feuilleDecale, /counter-reset:\s*page\s+11\s*;/);

      const html = path.join(travail, 'essai.html');
      const feuille = path.join(travail, 'decalage.css');
      const sansPdf = path.join(travail, 'sans.pdf');
      const avecPdf = path.join(travail, 'avec.pdf');
      fs.writeFileSync(html, HTML_PATRON, 'utf8');
      fs.writeFileSync(feuille, feuilleDecale, 'utf8');

      const rSans = wsl(['weasyprint', cheminVersWsl(html), cheminVersWsl(sansPdf)]);
      assert.ok(!rSans.error, 'weasyprint (sans feuille) injoignable : ' + (rSans.error && rSans.error.message));
      assert.strictEqual(rSans.status, 0, 'weasyprint (sans feuille) a échoué : ' + rSans.stderr);

      const rAvec = wsl(['weasyprint', '-s', cheminVersWsl(feuille), cheminVersWsl(html), cheminVersWsl(avecPdf)]);
      assert.strictEqual(rAvec.status, 0, 'weasyprint (avec feuille) a échoué : ' + rAvec.stderr);

      const rLire = wsl(['/opt/weasyprint/bin/python3', '-c', EXTRAIRE_FOLIOS,
        cheminVersWsl(sansPdf), cheminVersWsl(avecPdf)]);
      assert.strictEqual(rLire.status, 0, 'lecture des folios par pypdf a échoué : ' + rLire.stderr);
      const [foliosSans, foliosAvec] = JSON.parse(rLire.stdout.trim());
      assert.deepStrictEqual(foliosSans, ['1', '2', '3']);
      assert.deepStrictEqual(foliosAvec, ['11', '12', '13'],
        'la feuille écrite par pagination.py ne décale pas les folios réellement imprimés');
    } finally {
      fs.rmSync(numero, { recursive: true, force: true });
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 10. Un article inséré dans l'ordre
// ---------------------------------------------------------------------------------------

// Le piège : mesurer la péremption au seul nombre de pages laisse passer l'insertion, le
// retrait et le déplacement — les folios des suivants glissent alors qu'aucun article n'a
// changé de longueur. C'est pour ce cas que l'état retient aussi le départ de chacun.
test('pagination : un article inséré périme les suivants, jamais celui qui le précède',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-insere-', [2, 3, 1]);
    try {
      sortieJson(rafraichir(base, ordre));           // état posé : départs 1, 3, 6

      creerArticle(base, 'neuf', 2);
      const obj = sortieJson(etat(base, ['a1', 'neuf', 'a2', 'a3']));

      assert.deepStrictEqual(obj.articles.map((a) => [a.slug, a.depart]), [
        ['a1', 1], ['neuf', 3], ['a2', 5], ['a3', 8]
      ], 'a2 et a3 ont glissé de 3 et 6 à 5 et 8');
      assert.deepStrictEqual(obj.perimes, ['neuf', 'a2', 'a3'],
        'l\'inséré et tout ce qui le suit ; a1, qui n\'a pas bougé, reste muet');
      assert.deepStrictEqual(obj.inconnus, [], 'tous les PDF sont l\u00e0');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 11. Après un `make clean`
// ---------------------------------------------------------------------------------------

// `make clean` efface out/, donc les PDF ET les feuilles de folio ; .szh-pagination.json,
// lui, vit dans le dossier du numéro et survit. Deux façons de rater ce cas, toutes deux
// mesurées sur une vraie mini-revue : compter un article non compilé pour zéro page, et le
// numéro entier se déclare périmé alors que rien n'a changé ; ne pas savoir rebâtir les
// feuilles sans les PDF, et tous les folios repartent à 1 en silence à la recompilation.
test('pagination : après un clean, les départs tiennent et les feuilles se rebâtissent',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-clean-', [2, 3, 1]);
    try {
      sortieJson(rafraichir(base, ordre));
      const feuilleAvant = fs.readFileSync(cheminFolio(base, 'a2'), 'utf8');

      fs.rmSync(path.join(base, 'out'), { recursive: true, force: true });

      const obj = sortieJson(etat(base, ordre));
      assert.deepStrictEqual(obj.articles.map((a) => a.depart), [1, 3, 6],
        'les départs viennent de l\'état enregistré, pas d\'un cumul de zéros');
      assert.deepStrictEqual(obj.perimes, [], 'rien n\'a changé : rien n\'est périmé');
      assert.deepStrictEqual(obj.inconnus, ordre, 'plus aucun PDF, en revanche');

      sortieJson(feuilles(base));
      assert.strictEqual(fs.readFileSync(cheminFolio(base, 'a2'), 'utf8'), feuilleAvant,
        'la feuille revient identique, sans qu\'aucun PDF n\'ait été relu');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 10 bis. Deux articles connus, permutés
// ---------------------------------------------------------------------------------------

// Le cas ci-dessus ne prouve pas ce qu'on croit : un article inséré est NEUF, donc absent
// de l'état enregistré, et cette absence suffit à le dénoncer. Mesuré en sabotant le
// script : retirer la comparaison des départs le laissait vert. Une permutation, elle, ne
// présente que des slugs connus dont pas un n'a changé de longueur — seul le départ bouge,
// et c'est le seul cas qui l'exige vraiment.
test('pagination : permuter deux articles connus périme le premier déplacé et la suite',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-permute-', [2, 3, 1]);
    try {
      sortieJson(rafraichir(base, ordre));           // départs a1=1, a2=3, a3=6

      const obj = sortieJson(etat(base, ['a1', 'a3', 'a2']));

      assert.deepStrictEqual(obj.articles.map((a) => [a.slug, a.depart, a.pages]), [
        ['a1', 1, 2], ['a3', 3, 1], ['a2', 4, 3]
      ], 'a3 passe de 6 à 3 et a2 de 3 à 4 ; les longueurs, elles, sont inchangées');
      assert.deepStrictEqual(obj.perimes, ['a3', 'a2'],
        'a1 n\'a pas bougé et reste muet ; les deux permutés sont signalés');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// 12. Seul le cockpit dit l'ordre
// ---------------------------------------------------------------------------------------

// Le cockpit trie le disque par collation française et ramène en fin de numéro les articles
// sans DOI — ceux de `articles-sans-doi`, mais aussi ceux dont le TYPE n'en reçoit pas
// selon la configuration OJS. Une première version reconstituait l'ordre depuis
// ausgabe.yaml et ne voyait que la clé : elle aurait paginé un agenda au milieu du numéro
// sans rien dire. Paginer sans l'ordre du cockpit est donc refusé, pas deviné.
test('pagination : rafraichir refuse sans --ordre, en code 2, sans rien écrire',
  { skip: sansPython }, () => {
    const { base } = preparerNumero('szh-pagination-sans-ordre-', [2, 3]);
    try {
      const r = executer('rafraichir', [], base);
      assert.strictEqual(r.status, 2, 'code de sortie : ' + r.status + ' — ' + r.stderr);
      assert.match(r.stderr, /--ordre/, 'le message doit nommer ce qui manque');
      assert.ok(!fs.existsSync(cheminJsonPagination(base)), 'aucun état ne doit être écrit');
      assert.ok(!fs.existsSync(cheminFolio(base, 'a1')), 'aucune feuille ne doit être écrite');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Sans --ordre, `etat` sert au diagnostic : il relit l'ordre enregistré. Et il refuse
// quand rien n'a jamais été paginé, plutôt que d'inventer un ordre depuis le disque.
test('pagination : etat sans --ordre relit l\'ordre de la dernière pagination',
  { skip: sansPython }, () => {
    const { base, ordre } = preparerNumero('szh-pagination-ordre-relu-', [2, 3, 1]);
    try {
      const jamais = executer('etat', [], base);
      assert.strictEqual(jamais.status, 2, 'rien d\'enregistré : refus attendu');

      // Un ordre qui n'est PAS l'ordre alphabétique : s'il revient tel quel, c'est bien
      // l'enregistrement qui a été relu, et non le disque.
      const voulu = ['a3', 'a1', 'a2'];
      sortieJson(rafraichir(base, voulu));
      const obj = sortieJson(executer('etat', [], base));
      assert.deepStrictEqual(obj.articles.map((a) => a.slug), voulu);
      assert.deepStrictEqual(obj.perimes, []);
      void ordre;
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
