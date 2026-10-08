// L'import des figures à plusieurs images, et le filet de sécurité qui garantit que rien ne
// disparaît.
//
//   node --test test/js/import-figures.test.js
//
// Deux étages :
//   1. pipeline/docx-controle-import.py seul, sur un article fabriqué à la main (sans WSL) :
//      une valeur lue dans le Word mais absente de l'article est remise dans le texte et
//      signalée ; une image du Word absente est remise (avant la purge d'import-medias.py)
//      et nommée sous son nom définitif ; une image de groupe sans texte alternatif est
//      nommée. Un article complet ne déclenche rien.
//   2. la vraie chaîne, import-docx.sh dans la WSL (comme smoke-import-docx.test.js) :
//      deux images dans un paragraphe sous un en-tête du gabarit donnent un groupe, lisible
//      par le formulaire Médias ; une image au milieu d'une phrase garde ses clés visibles et
//      le signale ; la chaîne nettoyeur -> import d'un manuscrit brut.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { python: pythonGardes, sansPython, sansPandoc, sansPandocWsl } = require('./gardes');
const F = require('./figures-fabrique');

const PIPELINE = path.join(F.RACINE, 'pipeline');
const CONTROLE = path.join(PIPELINE, 'docx-controle-import.py');
const refs = require(path.join(F.RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'references.js'));

// Un article « déjà converti », tel que pandoc l'a laissé : le .md, media/, les instructions.
function articleConverti(base, md, instructions) {
  const dossier = path.join(base, 'article');
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  const docx = F.fabriquer(base, 'source', F.manuscritBrut('a', { cles: false }));
  // Les deux fichiers d'image de la source, extraits comme pandoc les extrait.
  const lire = pythonGardes(['-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\n'
    + 'for n in ("photoA.png","photoB.png"):\n    open(sys.argv[2]+"/"+n,"wb").write(z.read("word/media/"+n))',
    docx, path.join(dossier, 'media')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: F.ENV_UTF8 });
  assert.strictEqual(lire.status, 0, lire.stderr);
  fs.writeFileSync(path.join(dossier, 'essai.md'), md, 'utf8');
  const meta = path.join(base, 'instructions.txt');
  fs.writeFileSync(meta, instructions, 'utf8');
  const etat = path.join(base, 'etat.json');
  return { dossier, docx, meta, etat, md: () => fs.readFileSync(path.join(dossier, 'essai.md'), 'utf8') };
}

function passe1(a) {
  return pythonGardes([CONTROLE, '--avant-medias', a.docx, 'essai', a.dossier, a.etat],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, F.ENV_UTF8, { SZH_META: a.meta, SZH_SLUG: 'essai' }) });
}
function passe2(a, statsMedias) {
  return pythonGardes([CONTROLE, '--apres-medias', 'essai', a.dossier, a.etat, statsMedias || '{}'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, F.ENV_UTF8, { SZH_SLUG: 'essai' }) });
}

const GRILLE_COMPLETE = '::: {.szh-grille disposition="2"}\n'
  + '  ![Deux vues](media/photoA.png){alt="Vue nord" copyright="(c) X"}\n'
  + '  ![](media/photoB.png){alt="Vue sud" copyright="(c) X"}\n:::\n';

test('contrôle d’import : un article complet ne déclenche rien, et reste octet pour octet', { skip: sansPython || sansPandoc }, () => {
  const base = F.dossierJetable();
  try {
    const md = 'Avant.\n\n' + GRILLE_COMPLETE + '\nApres.\n';
    const a = articleConverti(base, md, 'FI\tphotoA.png;photoB.png\tDeux vues\tVue nord\t(c) X\t\n');
    const r1 = passe1(a);
    const r2 = passe2(a);
    assert.ok(!/import-avertissement/.test(r1.stderr + r2.stderr), r1.stderr + r2.stderr);
    assert.strictEqual(a.md(), md, 'le .md a été touché sans raison');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('contrôle d’import : une valeur lue dans le Word et absente de l’article est remise, visible, et dite', { skip: sansPython || sansPandoc }, () => {
  const base = F.dossierJetable();
  try {
    // Cas imprévu : la grille est là, sans sa légende ni son texte alternatif.
    const md = 'Avant.\n\n::: {.szh-grille disposition="2"}\n  ![](media/photoA.png)\n'
      + '  ![](media/photoB.png){alt="Vue sud"}\n:::\n\nApres.\n';
    const a = articleConverti(base, md,
      'FI\tphotoA.png;photoB.png\tUne legende perdue\tUn alt perdu *important*\t\t\n');
    const r = passe1(a);
    const apres = a.md();
    assert.match(apres, /Légende : Une legende perdue\n\nTexte alternatif : Un alt perdu \\\*important\\\*\n\n::: \{\.szh-grille/,
      'les valeurs doivent revenir juste avant leur figure, markdown échappé : ' + apres);
    assert.strictEqual((r.stderr.match(/bloc-valeur-non-reprise/g) || []).length, 2, r.stderr);
    assert.match(r.stderr, /\| article « essai » \| valeur « Une legende perdue » \|/, r.stderr);
    assert.match(apres, /Avant\.[\s\S]*Apres\./, 'le reste de l’article a bougé');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('contrôle d’import : une image du Word absente de l’article est remise avant la purge, puis nommée sous son nom final', { skip: sansPython || sansPandoc }, () => {
  const base = F.dossierJetable();
  try {
    const md = 'Avant.\n\n![Une](media/photoA.png){alt="a"}\n\nApres.\n\n::: {.szh-biblio src="essai.biblio.md"}\n:::\n';
    const a = articleConverti(base, md, '');
    const r1 = passe1(a);
    const apres = a.md();
    assert.match(apres, /Apres\.\n\n!\[\]\(media\/photoB\.png\)\n\n::: \{\.szh-biblio/,
      'l’image oubliée doit revenir, avant la bibliographie : ' + apres + r1.stderr);
    const r2 = passe2(a, JSON.stringify({ images_renommees: ['photoA.png -> essai-fig-01.png',
      'photoB.png -> essai-fig-02.png'] }));
    assert.match(r2.stderr, /image-absente-import \| article « essai » \| image « media\/essai-fig-02\.png »/,
      'l’avertissement doit nommer l’image sous son nom définitif : ' + r2.stderr);
    assert.match(r2.stderr, /descr Word B/, 'et la désigner comme dans le Word : ' + r2.stderr);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('contrôle d’import : une image de groupe sans texte alternatif est nommée, et elle seule', { skip: sansPython || sansPandoc }, () => {
  const base = F.dossierJetable();
  try {
    const md = '::: {.szh-grille disposition="2"}\n  ![Deux vues](media/photoA.png){alt="Vue nord"}\n'
      + '  ![](media/photoB.png)\n:::\n';
    const a = articleConverti(base, md, '');
    passe1(a);
    const r2 = passe2(a);
    const lignes = (r2.stderr.match(/figure-alt-a-completer[^\n]*/g) || []);
    assert.strictEqual(lignes.length, 1, r2.stderr);
    assert.match(lignes[0], /image « media\/photoB\.png »/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---- Le lecteur du gabarit : 0, 1 ou 2 paragraphes vides entre deux images -------------
//
// Après une série de clés, les images qui se suivent, séparées d'au plus deux paragraphes
// vides, forment une seule figure (une ligne FI à deux images, que szh-legendes.lua compose
// en groupe). Un troisième vide, un texte ou une nouvelle série de clés ouvrent une autre
// figure.

const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');

function lignesFI(docx, base) {
  const instr = path.join(base, 'instructions.txt');
  const r = pythonGardes([PRONTO_LIRE, docx, 'essai', base], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, F.ENV_UTF8, { SZH_META: instr, SZH_PRODUIT: 'revue' }) });
  assert.strictEqual(r.status, 0, r.stderr);
  return fs.readFileSync(instr, 'utf8').split('\n').filter((l) => /^FI\t/.test(l)).map((l) => l.split('\t'));
}

const ENCHAINEMENTS = [
  { nom: '0 vide', entre: [], groupe: true },
  { nom: '1 vide', entre: [F.vide()], groupe: true },
  { nom: '2 vides', entre: [F.vide(), F.vide()], groupe: true },
  { nom: '3 vides', entre: [F.vide(), F.vide(), F.vide()], groupe: false },
  { nom: 'un texte', entre: [F.p('Un texte court qui sépare les deux images.')], groupe: false },
  { nom: 'une nouvelle série de clés', entre: F.clesSecondes('SZHCleAbbTab'), groupe: false,
    clesSecondes: true },
];

for (const cas of ENCHAINEMENTS) {
  test('import (lecteur du gabarit) : deux images séparées par ' + cas.nom + ' -> '
    + (cas.groupe ? 'UN groupe' : 'deux figures'), { skip: sansPython }, () => {
    const base = F.dossierJetable();
    try {
      const docx = F.fabriquer(base, 'enchainement',
        F.documentPronto('b', { contenu: F.deuxImagesSeparees(cas.entre) }));
      const fi = lignesFI(docx, base);
      // Le gabarit livré porte, après notre bloc, son propre bloc tableau d'exemple : il n'a
      // pas de ligne FI. Les lignes FI sont donc exactement celles de nos figures.
      if (cas.groupe) {
        assert.strictEqual(fi.length, 1, JSON.stringify(fi));
        assert.deepStrictEqual(fi[0][1].split(';'), ['photoA.png', 'photoB.png']);
        assert.strictEqual(fi[0][2], F.LEGENDE);
      } else {
        assert.strictEqual(fi[0][1], 'photoA.png', 'la première figure ne garde que son image : '
          + JSON.stringify(fi));
        assert.strictEqual(fi[0][2], F.LEGENDE);
        if (cas.clesSecondes) {
          assert.strictEqual(fi.length, 2, JSON.stringify(fi));
          assert.deepStrictEqual([fi[1][1], fi[1][2], fi[1][4]], ['photoB.png', F.LEGENDE_2, '© Autre'],
            'la seconde figure porte SES clés');
        } else {
          // Sans clé devant elle, la seconde image est une figure ordinaire : aucune ligne FI.
          assert.strictEqual(fi.length, 1, JSON.stringify(fi));
        }
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
}

// ---- La vraie chaîne, dans la WSL -------------------------------------------------------

const DISTRO = 'SZH-Publishing';
const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');

function versWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function importer(base, docx, slug) {
  const chantier = path.join(base, 'revue');
  fs.mkdirSync(chantier, { recursive: true });
  fs.copyFileSync(path.join(F.RACINE, 'test', 'ausgabe.yaml'), path.join(chantier, 'ausgabe.yaml'));
  const journal = path.join(base, slug + '.log');
  const r = cp.spawnSync(fs.existsSync(WSL_EXE) ? WSL_EXE : 'wsl.exe', ['-d', DISTRO, '--', 'sh', '-c',
    'cd ' + JSON.stringify(versWsl(chantier)) + ' && SZH_IMPORT_LOG=' + JSON.stringify(versWsl(journal))
    + ' PYTHONIOENCODING=utf-8 bash ' + JSON.stringify(versWsl(path.join(PIPELINE, 'import-docx.sh')))
    + ' ' + JSON.stringify(versWsl(docx)) + ' ' + slug + ' ' + JSON.stringify(versWsl(PIPELINE))],
  { encoding: 'utf8', windowsHide: true, timeout: 240000 });
  assert.strictEqual(r.status, 0, 'import-docx.sh a échoué : ' + r.stderr);
  const dossier = path.join(chantier, 'articles', slug);
  return { md: fs.readFileSync(path.join(dossier, slug + '.md'), 'utf8').replace(/\r\n/g, '\n'),
    journal: fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8') : '', dossier };
}

test('import (WSL) : deux images dans un paragraphe sous un en-tête du gabarit -> UN groupe, relu par le formulaire Médias',
  { skip: sansPandocWsl }, () => {
    const base = F.dossierJetable();
    try {
      const docx = F.fabriquer(base, 'pronto-a', F.documentPronto('a', { descrB: '' }));
      const vu = importer(base, docx, 'essai-a');
      const grilles = refs.lireGrilles(vu.md);
      assert.strictEqual(grilles.length, 1, vu.md);
      assert.strictEqual(grilles[0].membres.length, 2);
      assert.strictEqual(grilles[0].disposition, '2');
      assert.match(vu.md, new RegExp('!\\[' + F.LEGENDE + '\\]\\(media/essai-a-fig-01\\.png\\)\\{[^}]*alt="'
        + F.ALT + '"[^}]*copyright="' + F.CREDIT + '"'), vu.md);
      assert.ok(!/Légende\s*:|Texte alternatif\s*:|Crédit\s*:/.test(vu.md), 'une clé est restée : ' + vu.md);
      // La seconde image n'a pas de description Word : elle est nommée, sous son nom final.
      assert.match(vu.journal, /figure-alt-a-completer \| article « essai-a » \| image « media\/essai-a-fig-02\.png »/,
        vu.journal);
      assert.ok(fs.existsSync(path.join(vu.dossier, 'media', 'essai-a-fig-02.png')));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('import (WSL) : deux images séparées par 2 paragraphes vides -> UN groupe ; par 3 -> deux figures',
  { skip: sansPandocWsl }, () => {
    const base = F.dossierJetable();
    try {
      const deux = importer(base, F.fabriquer(base, 'vides-2',
        F.documentPronto('b', { contenu: F.deuxImagesSeparees([F.vide(), F.vide()]) })), 'vides-2');
      const g2 = refs.lireGrilles(deux.md);
      assert.strictEqual(g2.length, 1, deux.md);
      assert.strictEqual(g2[0].membres.length, 2, deux.md);
      assert.strictEqual(g2[0].disposition, '2', 'deux paragraphes d’images = côte à côte : ' + deux.md);
      const trois = importer(base, F.fabriquer(base, 'vides-3',
        F.documentPronto('b', { contenu: F.deuxImagesSeparees([F.vide(), F.vide(), F.vide()]) })), 'vides-3');
      assert.strictEqual(refs.lireGrilles(trois.md).length, 0, trois.md);
      assert.match(trois.md, new RegExp('!\\[' + F.LEGENDE + '\\]\\((\\./)?media/vides-3-fig-01\\.png\\)'), trois.md);
      assert.match(trois.md, /!\[\]\(\.?\/?media\/vides-3-fig-02\.png\)/, 'la seconde image, figure à part : ' + trois.md);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('import (WSL) : une image au milieu d’une phrase — cas imprévu — garde les clés VISIBLES et le dit',
  { skip: sansPandocWsl }, () => {
    const base = F.dossierJetable();
    try {
      const docx = F.fabriquer(base, 'pronto-phrase', F.documentPronto('a', {
        contenu: [{ p: [{ t: 'Voir ' }, { img: 'A', descr: 'descr Word A' }, { t: ' ci-contre.' }] }] }));
      const vu = importer(base, docx, 'essai-phrase');
      for (const valeur of [F.LEGENDE, F.ALT, F.CREDIT]) {
        assert.ok(vu.md.indexOf(valeur) !== -1, 'la valeur « ' + valeur + ' » a disparu : ' + vu.md);
      }
      assert.match(vu.journal, /bloc-valeur-non-reprise \| article « essai-phrase »/, vu.journal);
      assert.match(vu.md, /media\/essai-phrase-fig-01\.png/, 'l’image a disparu : ' + vu.md);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('import (WSL) : (c) un tableau 1×2 d’images sous un en-tête du gabarit -> UN groupe, pas un « Tableau N »',
  { skip: sansPandocWsl }, () => {
    const base = F.dossierJetable();
    try {
      const docx = F.fabriquer(base, 'pronto-c', F.documentPronto('c'));
      const vu = importer(base, docx, 'essai-c');
      const grilles = refs.lireGrilles(vu.md);
      assert.strictEqual(grilles.length, 1, vu.md);
      assert.strictEqual(grilles[0].disposition, '2', vu.md);
      // Le seul tableau restant est celui d'exemple du gabarit, qui ne porte pas d'image.
      const tables = fs.readdirSync(path.join(vu.dossier, 'tables'));
      for (const t of tables) {
        assert.ok(!/<img/.test(fs.readFileSync(path.join(vu.dossier, 'tables', t), 'utf8')),
          'les images sont restées dans un tableau : ' + t);
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
