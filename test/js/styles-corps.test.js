// Les styles de corps du gabarit Pronto survivent à l'import : docx-styles-corps.py marque
// les paragraphes, szh-styles-corps.lua en fait les blocs du cockpit.
//
//   node --test test/js/styles-corps.test.js
//
// Trois contrôles : la correspondance style -> bloc sur un .docx fabriqué (pièges compris :
// identifiant de style localisé, modification suivie, paragraphes consécutifs, paragraphe
// vide) ; la copie d'un document sans ces styles, identique à l'octet ; et la chaîne réelle
// dans la WSL sur le gabarit livré. Puis, à la compilation, l'exergue muette du HTML publié
// (szh-exergue.lua).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PYTHON, sansPython, sansPandoc, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPE = path.join(RACINE, 'pipeline');
const PREPASS = path.join(PIPE, 'docx-styles-corps.py');
const FILTRE = path.join(PIPE, 'filters', 'szh-styles-corps.lua');
const GABARIT = path.join(RACINE, 'revue-template', "Pronto - modele d'article.docx");

function jetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-styles-corps-'));
}

function lancer(commande, args) {
  return spawnSync(commande, args, {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
  });
}

// Un .docx minimal : les identifiants de style sont volontairement différents des noms,
// comme dans un Word localisé. `corps` est le XML des paragraphes.
const FABRICANTE = String.raw`
import sys, zipfile
sortie, corps = sys.argv[1], open(sys.argv[2], encoding='utf-8').read()
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
styles = ''.join('<w:style w:type="paragraph" w:styleId="%s"><w:name w:val="%s"/></w:style>' % s
                 for s in [('Normal', 'Normal'), ('EncadreX', 'SZH Important'),
                           ('MiseX', 'SZH Hervorhebung'), ('QuestionX', 'SZH Question (interview)'),
                           ('AuhorsX', 'Auhors')])
with zipfile.ZipFile(sortie, 'w') as z:
    z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
    z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    z.writestr('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    z.writestr('word/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><w:styles %s>%s</w:styles>' % (W, styles))
    z.writestr('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document %s><w:body>%s</w:body></w:document>' % (W, corps))
`;

function p(style, texte, change) {
  const ppr = style || change
    ? '<w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '')
      + (change ? '<w:pPrChange w:id="1" w:author="x"><w:pPr><w:pStyle w:val="' + change
        + '"/></w:pPr></w:pPrChange>' : '') + '</w:pPr>'
    : '';
  return '<w:p>' + ppr + (texte ? '<w:r><w:t xml:space="preserve">' + texte + '</w:t></w:r>' : '')
    + '</w:p>';
}

function fabriquer(dossier, corps) {
  const script = path.join(dossier, 'fabricante.py');
  const xml = path.join(dossier, 'corps.xml');
  const docx = path.join(dossier, 'essai.docx');
  fs.writeFileSync(script, FABRICANTE, 'utf8');
  fs.writeFileSync(xml, corps, 'utf8');
  const r = lancer(PYTHON, [script, docx, xml]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
  return docx;
}

function versMarkdown(docx) {
  const r = lancer('pandoc', [docx, '--from=docx', '--to=markdown', '--wrap=none',
    '--lua-filter=' + FILTRE]);
  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  return r.stdout.replace(/\r\n/g, '\n');
}

test('chaque style de corps devient son bloc, et seulement le style en vigueur compte',
  { skip: sansPython || sansPandoc }, () => {
    const d = jetable();
    try {
      const docx = fabriquer(d, [
        p('Normal', 'Avant.'),
        p('MiseX', 'Premier fragment.'),
        p('MiseX', 'Second fragment.'),
        p('Normal', 'Entre deux.'),
        p('EncadreX', ''),
        p('EncadreX', 'Un encadré.'),
        p('QuestionX', 'Une question ?'),
        // Modification suivie : le style en vigueur est Normal, l'ancien était un encadré.
        p('Normal', 'Ancien encadré.', 'EncadreX'),
        // L'inverse : devenu mise en évidence, et c'est ce qui compte.
        p('MiseX', 'Nouvelle mise en évidence.', 'Normal'),
        p('Normal', 'Après.')
      ].join(''));
      const marque = path.join(d, 'marque.docx');
      const r = lancer(PYTHON, [PREPASS, docx, marque]);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.deepStrictEqual(JSON.parse(r.stdout).blocs,
        { highlight: 3, important: 2, question: 1 });

      const md = versMarkdown(marque);
      assert.ok(!/[\uE000\uE001]/.test(md), 'un marqueur a fui dans le .md :\n' + md);
      const blocs = md.split('\n\n');
      assert.deepStrictEqual(blocs.map((b) => b.trim()), [
        'Avant.',
        '::: highlight\nPremier fragment.',
        'Second fragment.\n:::',
        'Entre deux.',
        '::: important\nUn encadré.\n:::',
        '::: question\nUne question ?\n:::',
        'Ancien encadré.',
        '::: highlight\nNouvelle mise en évidence.\n:::',
        'Après.'
      ]);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

test('un document sans ces styles ressort identique à l\'octet',
  { skip: sansPython }, () => {
    const d = jetable();
    try {
      const docx = fabriquer(d, p('Normal', 'Rien à marquer.') + p('', 'Sans style.'));
      const marque = path.join(d, 'marque.docx');
      const r = lancer(PYTHON, [PREPASS, docx, marque]);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.deepStrictEqual(JSON.parse(r.stdout).blocs, {});
      const lire = lancer(PYTHON, ['-c', 'import sys,zipfile; a,b=(zipfile.ZipFile(f) for f in sys.argv[1:]);'
        + 'print(all(a.read(n)==b.read(n) for n in a.namelist()) and a.namelist()==b.namelist())',
      docx, marque]);
      assert.strictEqual(lire.stdout.trim(), 'True', lire.stderr);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

// ── Livre : la ligne d'auteur·e·s d'un chapitre (style Word « Auhors ») ────────────────
// Même mécanisme que ci-dessus (marqueur -> bloc), mais une classe et une règle de fusion
// différentes : voir docx-styles-corps.py (STYLES_AUTEURS_CHAPITRE) et szh-styles-corps.lua
// (FUSIONNABLES).

test('le style Word « Auhors » devient ::: {.szh-auteurs}, au même titre que les blocs du cockpit',
  { skip: sansPython || sansPandoc }, () => {
    const d = jetable();
    try {
      const docx = fabriquer(d, [
        p('Normal', 'Avant le titre.'),
        p('AuhorsX', 'Barbara Egloff &amp; Cornelia Müller Bösch'),
        p('Normal', 'Corps du chapitre.')
      ].join(''));
      const marque = path.join(d, 'marque.docx');
      const r = lancer(PYTHON, [PREPASS, docx, marque]);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.deepStrictEqual(JSON.parse(r.stdout).blocs, { 'szh-auteurs': 1 });

      const md = versMarkdown(marque);
      assert.ok(!/[]/.test(md), 'un marqueur a fui dans le .md :\n' + md);
      assert.match(md, /^::: szh-auteurs\nBarbara Egloff & Cornelia Müller Bösch\n:::$/m,
        'le bloc szh-auteurs n’est pas au format attendu :\n' + md);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

test('deux paragraphes « Auhors » consécutifs NE fusionnent PAS (contrairement aux blocs du cockpit)',
  { skip: sansPython || sansPandoc }, () => {
    // Constaté sur redf_Lerngeschichten_clean.docx : un chapitre gardait par mégarde le
    // style « Auhors » sur son premier paragraphe de corps. Fusionner l'aurait avalé dans
    // la ligne d'auteur·e·s, en silence. Deux blocs distincts, eux, se voient — et se
    // corrigent — à la relecture du .md.
    const d = jetable();
    try {
      const docx = fabriquer(d, [
        p('Normal', 'Avant le titre.'),
        p('AuhorsX', 'Anna Farner &amp; Eva Bär'),
        p('AuhorsX', 'Paragraphe de récit resté au mauvais style.'),
        p('Normal', 'Suite normale.')
      ].join(''));
      const marque = path.join(d, 'marque.docx');
      const r = lancer(PYTHON, [PREPASS, docx, marque]);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.deepStrictEqual(JSON.parse(r.stdout).blocs, { 'szh-auteurs': 2 });

      const md = versMarkdown(marque);
      const blocs = (md.match(/^::: szh-auteurs$/gm) || []).length;
      assert.strictEqual(blocs, 2, 'les deux paragraphes ont fusionné en un seul bloc :\n' + md);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

// La chaîne réelle, dans la WSL (pandoc 3.5, celui de la production), sur le gabarit livré.
function cheminVersWsl(x) {
  const abs = path.resolve(x).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

test('import réel du gabarit Pronto : encadré, mise en évidence et question arrivent en blocs',
  { skip: sansPandocWsl }, () => {
    const chantier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-styles-corps-wsl-'));
    try {
      const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
      const rr = spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe',
        ['-d', 'SZH-Publishing', '--', 'sh', '-c',
          'cd ' + JSON.stringify(cheminVersWsl(chantier))
          + ' && PYTHONIOENCODING=utf-8 SZH_PRODUIT=revue bash '
          + JSON.stringify(cheminVersWsl(path.join(PIPE, 'import-docx.sh')))
          + ' ' + JSON.stringify(cheminVersWsl(GABARIT)) + ' essai '
          + JSON.stringify(cheminVersWsl(PIPE))],
        { encoding: 'utf8', windowsHide: true, timeout: 120000 });
      assert.strictEqual(rr.status, 0, 'import-docx.sh a échoué : ' + rr.stderr);
      const md = fs.readFileSync(path.join(chantier, 'articles', 'essai', 'essai.md'), 'utf8')
        .replace(/\r\n/g, '\n');
      assert.ok(!/[\uE000\uE001]/.test(md), 'un marqueur a fui dans le .md');
      assert.match(md, /^::: \{\.highlight\}\nHervorhebung\n:::$/m);
      assert.match(md, /^::: \{\.important\}\nEncadré information : [^\n]+\n:::$/m);
      assert.match(md, /^::: \{\.question\}\nQuestion \(interview\)\n:::$/m);
      assert.match(md, /^> Citation d.un auteur/m, 'la citation n\'est plus un bloc de citation');
    } finally {
      fs.rmSync(chantier, { recursive: true, force: true });
    }
  });

// ---- L'exergue muette dans le HTML publié (szh-exergue.lua) ----------------------------

const EXERGUE = path.join(PIPE, 'filters', 'szh-exergue.lua');

test('l\'exergue est aria-hidden, ses liens hors du clavier, les autres blocs intacts',
  { skip: sansPandoc }, () => {
    const d = jetable();
    try {
      const md = path.join(d, 'e.md');
      fs.writeFileSync(md, '::: {.highlight}\nUne [exergue](https://x.ch).\n:::\n\n'
        + '::: {.hervorhebung}\nAncienne classe.\n:::\n\n'
        + '::: {.important}\nUn [encadré](https://y.ch).\n:::\n', 'utf8');
      const r = lancer('pandoc', [md, '--to=html5', '--lua-filter=' + EXERGUE]);
      assert.strictEqual(r.status, 0, r.stderr);
      const html = r.stdout.replace(/\r\n/g, '\n');
      assert.match(html, /<div class="highlight" aria-hidden="true">/);
      assert.match(html, /<div class="hervorhebung" aria-hidden="true">/);
      // Le lien reste (il se voit dans le PDF), mais le clavier ne s'y arrête plus.
      assert.match(html, /<a href="https:\/\/x\.ch" tabindex="-1">exergue<\/a>/);
      assert.match(html, /<div class="important">\n<p>Un <a href="https:\/\/y\.ch">encadré<\/a>/);
    } finally {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

// L'aperçu sert à relire son article : une rédactrice aveugle doit y entendre l'exergue.
test('szh-exergue est dans la chaîne du HTML publié, et pas dans celle de l\'aperçu', () => {
  const mk = fs.readFileSync(path.join(PIPE, 'Makefile'), 'utf8');
  const recette = (cible) => {
    const i = mk.indexOf('\n' + cible + ':');
    assert.ok(i !== -1, 'règle introuvable : ' + cible);
    const fin = mk.indexOf('\n\n', i + 1);
    return mk.slice(i, fin === -1 ? undefined : fin);
  };
  assert.match(recette('$(OUT)/%.html'), /szh-exergue\.lua/);
  assert.doesNotMatch(recette('$(OUT)/%.apercu.html'), /szh-exergue\.lua/);
});
