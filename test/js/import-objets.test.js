// Les objets Word que pandoc ne rend pas en image : graphique, SmartArt, objet incorporé,
// dessin, forme. L'import pose une image de remplacement à leur place et le signale.
//
//   node --test test/js/import-objets.test.js
//
// Les .docx sont fabriqués par test/js/figures-fabrique.js, puis la première image (photoA)
// est remplacée par l'objet voulu (OBJETISER_PY). Trois étages :
//   1. pipeline/docx-objets.py seul : quel objet reçoit une image de remplacement, et
//      lequel est laissé (image, zone de texte, filet, forme invisible) ;
//   2. pipeline/docx-controle-import.py --apres-medias : l'avertissement nomme l'article,
//      l'objet, l'image sous son nom définitif et la légende voisine ;
//   3. la vraie chaîne, import-docx.sh dans la WSL : la figure existe, avec sa légende et
//      un texte alternatif qui dit qu'il manque une image, sur un Word ordinaire et dans un
//      bloc figure du gabarit Pronto.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { python: pythonGardes, sansPython, sansPandocWsl } = require('./gardes');
const F = require('./figures-fabrique');

const PIPELINE = path.join(F.RACINE, 'pipeline');
const OBJETS = path.join(PIPELINE, 'docx-objets.py');
const CONTROLE = path.join(PIPELINE, 'docx-controle-import.py');
const REMPLACEMENT = path.join(PIPELINE, 'media', 'image-a-remplacer.svg');
const LEGENDE = 'Figure 1 : Participation par domaine';

// Remplace la première image du Word (son <w:drawing>) par un objet. Les espaces de noms
// sont déclarés sur l'objet : le document d'origine ne les a pas tous.
const OBJETISER_PY = String.raw`
import sys, zipfile
entree, sortie, genre = sys.argv[1], sys.argv[2], sys.argv[3]
NS = ('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
      'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" '
      'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
      'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
      'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
      'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"')
T = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
rels, parties = [], {}

def inline(donnees, nom, descr=''):
    d = ' descr="%s"' % descr if descr else ''
    return ('<w:drawing %s><wp:inline><wp:extent cx="3000000" cy="2000000"/><wp:docPr id="77" name="%s"%s/>'
            '<a:graphic><a:graphicData uri="%s</a:graphicData></a:graphic></wp:inline></w:drawing>' % (NS, nom, d, donnees))

def alternance(choix, secours):
    return ('<mc:AlternateContent %s><mc:Choice Requires="wps"><w:drawing><wp:anchor simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
            '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>'
            '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="2000000" cy="1000000"/>'
            '<wp:wrapTopAndBottom/><wp:docPr id="78" name="Forme 1"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/%s'
            '</a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict>%s</w:pict></mc:Fallback></mc:AlternateContent>'
            % (NS, choix, secours))

def wsp(sppr, txbx=''):
    return 'wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr>%s</wps:spPr>%s<wps:bodyPr/></wps:wsp>' % (sppr, txbx)

RECT = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
if genre == 'graphique':
    rels.append(('rIdObj1', 'chart', 'charts/chart1.xml'))
    parties['word/charts/chart1.xml'] = b'<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'
    objet = inline('http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdObj1"/>', 'Graphique 1', 'Barres par domaine')
elif genre == 'smartart':
    for i, n in enumerate(('data', 'layout', 'quickStyle', 'colors')):
        rels.append(('rIdObj%d' % i, 'diagram' + n[0].upper() + n[1:], 'diagrams/%s1.xml' % n))
        parties['word/diagrams/%s1.xml' % n] = b'<?xml version="1.0"?><x/>'
    objet = inline('http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds r:dm="rIdObj0" r:lo="rIdObj1" r:qs="rIdObj2" r:cs="rIdObj3"/>', 'Diagramme 1')
elif genre in ('ole', 'ole-apercu'):
    rels.append(('rIdObj1', 'oleObject', 'embeddings/oleObject1.bin'))
    parties['word/embeddings/oleObject1.bin'] = b'\xd0\xcf\x11\xe0' + bytes(60)
    apercu = ''
    if genre == 'ole-apercu':
        rels.append(('rIdObj2', 'image', 'media/image9.emf'))
        parties['word/media/image9.emf'] = b'\x01\x00\x00\x00' + bytes(36) + b' EMF' + bytes(40)
        apercu = '<v:imagedata r:id="rIdObj2" o:title=""/>'
    objet = ('<w:object %s w:dxaOrig="4000" w:dyaOrig="2000"><v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:200pt;height:100pt" o:ole="">%s</v:shape>'
             '<o:OLEObject Type="Embed" ProgID="Excel.Sheet.12" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_17" r:id="rIdObj1"/></w:object>' % (NS, apercu))
elif genre == 'groupe':
    objet = inline('http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr/>'
                   '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp>'
                   '<wps:wsp><wps:cNvSpPr/><wps:spPr><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp></wpg:wgp>', 'Groupe 1')
elif genre == 'forme':
    objet = alternance(wsp(RECT), '<v:rect style="width:157pt;height:78pt"/>')
elif genre == 'forme-vml':
    objet = '<w:pict %s><v:shape style="width:100pt;height:60pt" path="m0,0l100,0,100,60xe" fillcolor="red"/></w:pict>' % NS
elif genre == 'zone-texte':
    objet = alternance(wsp(RECT, '<wps:txbx><w:txbxContent><w:p><w:r><w:t>Texte de la zone</w:t></w:r></w:p></w:txbxContent></wps:txbx>'),
                       '<v:rect style="width:157pt;height:78pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Texte de la zone</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect>')
elif genre == 'forme-invisible':
    objet = alternance(wsp(RECT + '<a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:ln><a:noFill/></a:ln>'),
                       '<v:rect style="width:157pt;height:78pt" fillcolor="white [3212]" stroked="f"/>')
elif genre == 'filet':
    objet = alternance(wsp('<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'), '<v:line from="0,0" to="200pt,0"/>')
elif genre == 'filet-vml':
    objet = '<w:pict %s><v:rect style="width:400pt;height:1.5pt" o:hr="t" o:hrstd="t" fillcolor="#a0a0a0" stroked="f"/></w:pict>' % NS
else:
    objet = None

with zipfile.ZipFile(entree) as zi:
    noms = zi.namelist()
    donnees = {n: zi.read(n) for n in noms}
doc = donnees['word/document.xml'].decode('utf-8')
if objet is not None:
    i = doc.find('<w:drawing>')
    j = doc.find('</w:drawing>', i) + len('</w:drawing>')
    doc = doc[:i] + objet + doc[j:]
donnees['word/document.xml'] = doc.encode('utf-8')
r = donnees['word/_rels/document.xml.rels'].decode('utf-8')
r = r.replace('</Relationships>', ''.join('<Relationship Id="%s" Type="%s%s" Target="%s"/>' % (i, T, t, c) for i, t, c in rels) + '</Relationships>')
donnees['word/_rels/document.xml.rels'] = r.encode('utf-8')
donnees.update(parties)
with zipfile.ZipFile(sortie, 'w', zipfile.ZIP_DEFLATED) as zo:
    for n, d in donnees.items():
        zo.writestr(n, d)
`;

function objetiser(base, docx, genre) {
  const script = path.join(base, 'objetiser.py');
  if (!fs.existsSync(script)) { fs.writeFileSync(script, OBJETISER_PY, 'utf8'); }
  const sortie = path.join(base, path.basename(docx, '.docx') + '-' + genre + '.docx');
  const r = pythonGardes([script, docx, sortie, genre], { encoding: 'utf8', env: F.ENV_UTF8 });
  assert.strictEqual(r.status, 0, 'fabrication de l’objet « ' + genre + ' » : ' + r.stderr);
  return sortie;
}

// Un Word ordinaire : un paragraphe, l'image A seule, sa légende, un paragraphe.
function wordOrdinaire(base, nom) {
  return F.fabriquer(base, nom, F.manuscritBrut('a', { cles: false,
    contenu: [{ p: [{ img: 'A', descr: '' }] }, F.p(LEGENDE)] }));
}

// Lit le document.xml et l'état écrits par docx-objets.py.
const LIRE_COPIE_PY = 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\n'
  + 'print(z.read("word/document.xml").decode())\nprint("@@RELS@@")\n'
  + 'print(z.read("word/_rels/document.xml.rels").decode())\nprint("@@MEDIA@@")\n'
  + 'print(" ".join(n for n in z.namelist() if n.startswith("word/media/")))\n'
  + 'print("@@SVG@@")\nprint(z.read("word/media/szh-objet-01.svg").decode() if "word/media/szh-objet-01.svg" in z.namelist() else "")';

function passerObjets(base, docx, env) {
  const sortie = path.join(base, 'copie.docx');
  const etat = path.join(base, 'objets.tsv');
  fs.rmSync(sortie, { force: true });
  const r = pythonGardes([OBJETS, docx, sortie, etat], { encoding: 'utf8',
    env: Object.assign({}, F.ENV_UTF8, env || {}) });
  const lignes = fs.existsSync(etat) ? fs.readFileSync(etat, 'utf8').split('\n').filter(Boolean)
    .map((l) => l.split('\t')) : [];
  let copie = null;
  if (r.status === 0) {
    const l = pythonGardes(['-c', LIRE_COPIE_PY, sortie], { encoding: 'utf8', env: F.ENV_UTF8,
      maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(l.status, 0, l.stderr);
    const [doc, reste] = l.stdout.split('@@RELS@@');
    const [rels, reste2] = reste.split('@@MEDIA@@');
    const [media, svg] = reste2.split('@@SVG@@');
    copie = { doc, rels, media: media.trim().split(' '), svg: svg.trim() };
  }
  return { status: r.status, stderr: r.stderr, lignes, copie };
}

// ---- 1. docx-objets.py seul ---------------------------------------------------------

const REMPLACES = [
  { genre: 'graphique', type: 'graphique', nom: 'Graphique 1' },
  { genre: 'smartart', type: 'smartart', nom: 'Diagramme 1' },
  { genre: 'ole', type: 'ole', nom: '' },
  { genre: 'groupe', type: 'dessin', nom: 'Groupe 1' },
  { genre: 'forme', type: 'forme', nom: 'Forme 1' },
  { genre: 'forme-vml', type: 'forme', nom: '' },
];

for (const cas of REMPLACES) {
  test('objets Word : « ' + cas.genre + ' » reçoit une image de remplacement, à sa place, avec un texte alternatif',
    { skip: sansPython }, () => {
      const base = F.dossierJetable('szh-objets-');
      try {
        const docx = objetiser(base, wordOrdinaire(base, 'ordinaire'), cas.genre);
        const r = passerObjets(base, docx, { SZH_PRODUIT: 'revue' });
        assert.strictEqual(r.status, 0, r.stderr);
        assert.strictEqual(r.lignes.length, 1, JSON.stringify(r.lignes));
        const [fichier, type, , nom, repere, texteRepere, remplace] = r.lignes[0];
        assert.deepStrictEqual([fichier, type, nom, repere, texteRepere, remplace],
          ['szh-objet-01.svg', cas.type, cas.nom, 'legende', LEGENDE, '1']);
        assert.ok(r.copie.media.includes('word/media/szh-objet-01.svg'), r.copie.media.join(' '));
        assert.strictEqual(r.copie.svg, fs.readFileSync(REMPLACEMENT, 'utf8').trim());
        assert.match(r.copie.rels, /Id="rIdSzhObjet1"[^>]*Target="media\/szh-objet-01\.svg"/);
        // L'image précède l'objet, dans le même paragraphe, et la légende suit.
        const i = r.copie.doc.indexOf('r:embed="rIdSzhObjet1"');
        assert.ok(i !== -1 && i < r.copie.doc.indexOf(LEGENDE), 'image de remplacement mal placée');
        assert.match(r.copie.doc, /descr="Image à remplacer\u202f: objet Word non converti \([^"]+\)/);
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });
}

test('objets Word : le texte alternatif suit la langue du produit et garde la description Word', { skip: sansPython }, () => {
  const base = F.dossierJetable('szh-objets-');
  try {
    const docx = objetiser(base, wordOrdinaire(base, 'ordinaire'), 'graphique');
    const r = passerObjets(base, docx, { SZH_PRODUIT: 'zeitschrift' });
    assert.match(r.copie.doc, /descr="Bild zu ersetzen: nicht umgewandeltes Word-Objekt \(Diagramm\)\. Barres par domaine"/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('objets Word : un objet incorporé avec son aperçu garde l’aperçu et il est seulement noté', { skip: sansPython }, () => {
  const base = F.dossierJetable('szh-objets-');
  try {
    const docx = objetiser(base, wordOrdinaire(base, 'ordinaire'), 'ole-apercu');
    const r = passerObjets(base, docx);
    assert.strictEqual(r.status, 10, 'aucune copie n’est attendue : ' + r.stderr);
    assert.deepStrictEqual(r.lignes.map((l) => [l[0], l[1], l[2], l[6]]), [['image9.emf', 'ole', 'Excel', '0']]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

for (const genre of ['image', 'zone-texte', 'forme-invisible', 'filet', 'filet-vml']) {
  test('objets Word : « ' + genre + ' » est laissé tel quel, sans copie ni note', { skip: sansPython }, () => {
    const base = F.dossierJetable('szh-objets-');
    try {
      const docx = objetiser(base, wordOrdinaire(base, 'ordinaire'), genre);
      const r = passerObjets(base, docx);
      assert.strictEqual(r.status, 10, r.stderr);
      assert.deepStrictEqual(r.lignes, []);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
}

test('objets Word : un objet dans un paragraphe de texte reçoit son image dans un paragraphe à lui, juste après', { skip: sansPython }, () => {
  const base = F.dossierJetable('szh-objets-');
  try {
    const docx = objetiser(base, F.fabriquer(base, 'phrase', F.manuscritBrut('a', { cles: false,
      contenu: [{ p: [{ t: 'Voir le schéma ' }, { img: 'A', descr: '' }, { t: ' ci-contre.' }] }] })), 'forme');
    const r = passerObjets(base, docx);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual([r.lignes[0][4], r.lignes[0][5]], ['paragraphe', 'Voir le schéma ci-contre.']);
    assert.match(r.copie.doc, /ci-contre\.<\/w:t><\/w:r><\/w:p><w:p><w:r><w:drawing><wp:inline[^>]*>[\s\S]*?rIdSzhObjet1/,
      'l’image doit ouvrir le paragraphe qui suit la phrase');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---- 2. L'avertissement --------------------------------------------------------------

test('contrôle d’import : un objet remplacé est signalé sous le nom définitif de son image, avec sa légende', { skip: sansPython }, () => {
  const base = F.dossierJetable('szh-objets-');
  try {
    const dossier = path.join(base, 'article');
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, 'essai.md'), 'Texte.\n', 'utf8');
    const etat = path.join(base, 'etat.json');
    fs.writeFileSync(etat, '{"images": []}', 'utf8');
    const objets = path.join(base, 'objets.tsv');
    fs.writeFileSync(objets, ['szh-objet-01.svg\tgraphique\t\tGraphique 1\tlegende\t' + LEGENDE + '\t1',
      'image9.emf\tole\tExcel\t\tparagraphe\tVoir | ici\t0'].join('\n') + '\n', 'utf8');
    const r = pythonGardes([CONTROLE, '--apres-medias', 'essai', dossier, etat,
      JSON.stringify({ images_renommees: ['szh-objet-01.svg -> essai-fig-01.svg', 'image9.emf -> essai-fig-02.emf'] })],
    { encoding: 'utf8', env: Object.assign({}, F.ENV_UTF8, { SZH_SLUG: 'essai', SZH_OBJETS: objets }) });
    assert.strictEqual(r.status, 0, r.stderr);
    const lignes = r.stderr.split('\n').filter((l) => /objet-word/.test(l));
    assert.strictEqual(lignes.length, 2, r.stderr);
    assert.match(lignes[0], /^\[import-avertissement\] objet-word-remplace \| article « essai » \| objet « graphique » \| image « media\/essai-fig-01\.svg » \| repère « légende « Figure 1 : Participation par domaine » » \| Le graphique Word « Graphique 1 » [^|]+ \| \[de\] /);
    assert.match(lignes[1], /^\[import-avertissement\] objet-word-apercu \| article « essai » \| objet « ole » \| image « media\/essai-fig-02\.emf » \| repère « dans le paragraphe « Voir \/ ici » » \|/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---- 3. La vraie chaîne, dans la WSL ------------------------------------------------

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

test('import (WSL) : un graphique Word devient une figure légendée à image de remplacement, et c’est dit',
  { skip: sansPandocWsl }, () => {
    const base = F.dossierJetable('szh-objets-');
    try {
      const docx = objetiser(base, wordOrdinaire(base, 'ordinaire'), 'graphique');
      const vu = importer(base, docx, 'graphe');
      assert.match(vu.md, /!\[Participation par domaine\]\((\.\/)?media\/graphe-fig-01\.svg\)\{[^}]*alt="Image à remplacer[^"]*objet Word non converti \(graphique\)/,
        vu.md);
      assert.ok(!/^Figure 1 :/m.test(vu.md), 'la légende est restée un paragraphe : ' + vu.md);
      assert.strictEqual(fs.readFileSync(path.join(vu.dossier, 'media', 'graphe-fig-01.svg'), 'utf8'),
        fs.readFileSync(REMPLACEMENT, 'utf8'));
      assert.match(vu.journal, /objet-word-remplace \| article « graphe » \| objet « graphique » \| image « media\/graphe-fig-01\.svg » \| repère « légende « Figure 1 : Participation par domaine » »/,
        vu.journal);
      assert.ok(!/image-absente-import/.test(vu.journal), vu.journal);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('import (WSL) : un SmartArt dans un bloc figure du gabarit Pronto prend la légende et le texte alternatif du bloc',
  { skip: sansPandocWsl }, () => {
    const base = F.dossierJetable('szh-objets-');
    try {
      const pronto = F.fabriquer(base, 'pronto', F.documentPronto('a', { contenu: [{ p: [{ img: 'A', descr: '' }] }] }));
      const vu = importer(base, objetiser(base, pronto, 'smartart'), 'smart');
      assert.match(vu.md, new RegExp('!\\[' + F.LEGENDE + '\\]\\((\\./)?media/smart-fig-01\\.svg\\)\\{[^}]*alt="' + F.ALT + '"'), vu.md);
      assert.ok(!/Légende\s*:|Texte alternatif\s*:/.test(vu.md), 'une clé est restée : ' + vu.md);
      assert.match(vu.journal, /objet-word-remplace \| article « smart » \| objet « smartart » \| image « media\/smart-fig-01\.svg »/, vu.journal);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
