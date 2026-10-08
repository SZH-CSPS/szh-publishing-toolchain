// Un .odt passé à import-docx.sh produit le même article qu'un .docx de même contenu :
// pipeline/conversion_odt.py le convertit au tout début de la chaîne, et SZH_SOURCE garde
// le nom d'origine (.odt compris) dans `source:` de la fiche et pour
// reimporter.py --empreintes --word.
//
// Chaîne réelle (bash import-docx.sh, pandoc, LibreOffice) : c'est la seule façon de
// vérifier que $SZH_PHOTOS et la numérotation des figures survivent à LibreOffice, qui ne
// nomme pas forcément les images comme Word.
//
// Le gabarit est rempli par script (comme test/js/pronto-lire.test.js) : titre, un auteur
// avec une photo PNG dans la cellule de gauche, et les quatre clés du premier bloc figure
// (dont l'image est celle du gabarit livré). L'ancrage se fait par le libellé du champ
// (« Titre (FR) », « Prénom : »…), pas par w14:paraId, que Word régénère à chaque
// enregistrement.
//
//   node --test test/js/import-odt.test.js
//
// Tout tourne dans la WSL. Le test saute si Python, pandoc ou LibreOffice y manquent ;
// sansPython et sansPandocWsl viennent de gardes.js, la détection de soffice est ici.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const gardes = require('./gardes');
const { sansPython, sansPandocWsl, cheminPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const PIPE = path.join(RACINE, 'pipeline');
const GABARIT_FR = path.join(RACINE, 'revue-template', "Pronto - modele d'article_FR.docx");

// ---- soffice : détecté là où conversion_odt.py le cherche ----
function detecterSoffice() {
  if (sansPython) { return false; }
  const r = gardes.python(['-c', 'import shutil, sys; '
    + 'sys.exit(0 if (shutil.which("soffice") or shutil.which("libreoffice")) else 1)'],
  { timeout: 30000 });
  return !r.error && r.status === 0;
}
const sansSoffice = detecterSoffice() ? false
  : 'LibreOffice (soffice) introuvable à côté de Python (dans la distro SZH-Publishing sous Windows)';

const SAUT = sansPython || (process.platform === 'win32' ? sansPandocWsl : gardes.sansPandoc) || sansSoffice;

function python(args, env) {
  return gardes.python(args, {
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, env || {})
  });
}

// bash de la distro (ou du système hors Windows), comme la chaîne réelle.
function bash(args, cwd) {
  if (process.platform !== 'win32') {
    return cp.spawnSync('bash', args, { cwd, encoding: 'utf8', timeout: 120000,
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
  }
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return cp.spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe',
    ['-d', 'SZH-Publishing', '--cd', cheminPython(cwd), '-e', 'env', 'PYTHONIOENCODING=utf-8',
      'bash'].concat(args.map(gardes.cheminVersWsl)),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

// ---- Remplisseur : chirurgie XML ciblée sur le gabarit FR livré -----------------------
// Ancrage par libellé (texte du <w:t>). `valeur_cellule_suivante` pose une valeur dans la
// cellule valeur d'une rangée « Champ | Valeur » (tableau des métadonnées) ;
// `cellule_gauche_de` pose une image dans la cellule photo d'une rangée d'auteur, repérée
// par le libellé du premier champ de sa cellule voisine (« Prénom : »).
const REMPLISSEUR_PY = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re, sys, zipfile

SRC, DST = sys.argv[1], sys.argv[2]

with zipfile.ZipFile(SRC) as z:
    noms = z.namelist()
    contenu = {n: z.read(n) for n in noms}

doc = contenu['word/document.xml'].decode('utf-8')
rels = contenu['word/_rels/document.xml.rels'].decode('utf-8')


def valeur_cellule_suivante(doc, label, injection):
    motif = re.compile(r'<w:t[^>]*>%s</w:t>' % re.escape(label))
    m = motif.search(doc)
    assert m, 'etiquette introuvable (le gabarit a change ?) : %r' % label
    fin_tc = doc.index('</w:tc>', m.end())
    debut_tc2 = doc.index('<w:tc>', fin_tc)
    fin_p = doc.index('</w:p>', debut_tc2)
    return doc[:fin_p] + injection + doc[fin_p:]


def cellule_gauche_de(doc, label, injection):
    motif = re.compile(r'<w:t[^>]*>%s</w:t>' % re.escape(label))
    m = motif.search(doc)
    assert m, 'etiquette introuvable (le gabarit a change ?) : %r' % label
    debut_tr = doc.rindex('<w:tr ', 0, m.start())
    debut_tc1 = doc.index('<w:tc>', debut_tr)
    fin_p = doc.index('</w:p>', debut_tc1)
    return doc[:fin_p] + injection + doc[fin_p:]


def remplir_champ(texte, etiquette, valeur):
    motif = '<w:t xml:space="preserve">%s</w:t>' % etiquette
    assert texte.count(motif) >= 1, 'etiquette introuvable : %r' % etiquette
    remplace = '<w:t xml:space="preserve">%s%s</w:t>' % (etiquette, valeur)
    return texte.replace(motif, remplace, 1)


TITRE = "Article d\\u2019essai \\u2014 import ODT (test)"
doc = valeur_cellule_suivante(doc, 'Titre (FR)', '<w:r><w:t>%s</w:t></w:r>' % TITRE)

PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108020000009077'
    '53de0000000c4944415478da6360646060000000050001a5f645400000000049454e44ae426082')
contenu['word/media/image3.png'] = PNG
noms.append('word/media/image3.png')
RID_PHOTO = 'rIdSzhTestPhoto'
rels = rels.replace(
    '</Relationships>',
    '<Relationship Id="%s" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
    'Target="media/image3.png"/></Relationships>' % RID_PHOTO)

DRAWING = (
    '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>'
    '<wp:inline distT="0" distB="0" distL="0" distR="0" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
    '<wp:extent cx="360000" cy="360000"/>'
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
    '<wp:docPr id="900001" name="PhotoAuteurTest"/>'
    '<wp:cNvGraphicFramePr>'
    '<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    '<pic:nvPicPr><pic:cNvPr id="900001" name="PhotoAuteurTest"/><pic:cNvPicPr/></pic:nvPicPr>'
    '<pic:blipFill><a:blip r:embed="%s" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="360000" cy="360000"/></a:xfrm>'
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
) % RID_PHOTO

doc = cellule_gauche_de(doc, 'Pr\\u00e9nom : ', DRAWING)

doc = remplir_champ(doc, 'Pr\\u00e9nom : ', 'Jeanne')
doc = remplir_champ(doc, 'Nom : ', 'Dupont')
doc = remplir_champ(doc, 'Fonction : ', 'Chercheuse')
doc = remplir_champ(doc, 'Institution : ', 'Universit\\u00e9 de Test')

doc = remplir_champ(doc, 'L\\u00e9gende\\u00a0: ', "Vue d\\u2019ensemble du dispositif (test)")
doc = remplir_champ(doc, 'Texte alternatif\\u00a0: ', 'Description alternative de test')
doc = remplir_champ(doc, 'Copyright\\u00a0: ', 'Studio Test')
doc = remplir_champ(doc, 'Source\\u00a0: ', 'Phototh\\u00e8que SZH')
doc = remplir_champ(doc, 'Note\\u00a0: ', 'Note de test')

contenu['word/document.xml'] = doc.encode('utf-8')
contenu['word/_rels/document.xml.rels'] = rels.encode('utf-8')

with zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in noms:
        z.writestr(n, contenu[n])

print(DST)
`;

let DOSSIER_REMPLISSEUR = null;
let CHEMIN_REMPLISSEUR = null;
function remplisseurPy() {
  if (!CHEMIN_REMPLISSEUR) {
    DOSSIER_REMPLISSEUR = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-remplisseur-'));
    CHEMIN_REMPLISSEUR = path.join(DOSSIER_REMPLISSEUR, 'remplisseur.py');
    fs.writeFileSync(CHEMIN_REMPLISSEUR, REMPLISSEUR_PY, 'utf8');
  }
  return CHEMIN_REMPLISSEUR;
}
test.after(() => {
  if (DOSSIER_REMPLISSEUR) { fs.rmSync(DOSSIER_REMPLISSEUR, { recursive: true, force: true }); }
});

// ---- Normalisation avant comparaison ----------------------------------------------------
// Deux écarts dus à LibreOffice, sans effet sur le contenu :
//   * les dimensions des images (en pouces) diffèrent de quelques dix-millièmes,
//     LibreOffice recalculant l'étendue autrement que Word ;
//   * un titre vide du gabarit (style « Titre niveau 3 ») ressort en `#`, `###` ou
//     disparaît, sans régularité d'une conversion à l'autre. Il est retiré des deux côtés.
function normaliserMd(texte, slug) {
  return texte
    .split(new RegExp(slug, 'g')).join('SLUG')
    .replace(/width="[^"]*" height="[^"]*"/g, 'width="?" height="?"')
    .split(/\r?\n/)
    .filter((ligne) => !/^#{1,6}\s*$/.test(ligne))
    .join('\n');
}

function sansLigneSource(texteYaml) {
  return texteYaml.split(/\r?\n/).filter((l) => !l.startsWith('source:')).join('\n');
}

test('import .odt vs .docx : même article (titre, auteur+photo, bloc figure)',
  { skip: SAUT }, () => {
    const chantier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-import-odt-'));
    try {
      // 1. Gabarit FR rempli, en .docx.
      const docx = path.join(chantier, 'essai.docx');
      const rFill = python([remplisseurPy(), GABARIT_FR, docx]);
      assert.strictEqual(rFill.status, 0,
        'remplissage du gabarit impossible : ' + rFill.stderr);
      assert.ok(fs.existsSync(docx));

      // 2. Le même contenu, en .odt (conversion_odt.py — le module que la chaîne réelle
      //    appelle aussi).
      const rConv = python([path.join(PIPE, 'conversion_odt.py'), docx, 'odt', chantier]);
      assert.strictEqual(rConv.status, 0,
        'conversion .odt impossible : ' + rConv.stderr);
      const odt = path.join(chantier, 'essai.odt');
      assert.ok(fs.existsSync(odt), 'essai.odt non produit : ' + rConv.stdout);

      // 3. Numéro jetable (ausgabe.yaml minimal, produit = revue -> langue fr).
      const numero = path.join(chantier, 'numero');
      fs.mkdirSync(numero, { recursive: true });
      fs.writeFileSync(path.join(numero, 'ausgabe.yaml'), 'revue: revue\nlang: fr\n', 'utf8');

      function importer(fichier, slug) {
        const r = bash([path.join(PIPE, 'import-docx.sh'), fichier, slug, PIPE], numero);
        assert.strictEqual(r.status, 0,
          'import-docx.sh a échoué sur ' + path.basename(fichier) + ' :\n' + r.stderr);
        return path.join(numero, 'articles', slug);
      }

      const dirDocx = importer(docx, 'essai-docx');
      const dirOdt = importer(odt, 'essai-odt');

      // ---- Comparaisons ----
      const lire = (p) => fs.readFileSync(p, 'utf8');

      // source: porte le nom d'origine, .odt compris, et non celui du .docx intermédiaire.
      const metaDocx = lire(path.join(dirDocx, 'essai-docx.meta.yaml'));
      const metaOdt = lire(path.join(dirOdt, 'essai-odt.meta.yaml'));
      assert.match(metaDocx, /^source: "essai\.docx"$/m);
      assert.match(metaOdt, /^source: "essai\.odt"$/m);
      // Le reste de la fiche (titre, auteur, langue…) doit être identique.
      assert.strictEqual(sansLigneSource(metaOdt), sansLigneSource(metaDocx));

      // Le corps : identique une fois les deux écarts connus retirés (voir normaliserMd).
      const mdDocx = normaliserMd(lire(path.join(dirDocx, 'essai-docx.md')), 'essai-docx');
      const mdOdt = normaliserMd(lire(path.join(dirOdt, 'essai-odt.md')), 'essai-odt');
      assert.strictEqual(mdOdt, mdDocx);

      // Le bloc figure (légende, alt, crédit, source) doit être au complet, des deux côtés.
      const ligneFigureDocx = mdDocx.split('\n').find((l) => l.indexOf('![Vue') === 0) || '';
      const ligneFigureOdt = mdOdt.split('\n').find((l) => l.indexOf('![Vue') === 0) || '';
      for (const ligne of [ligneFigureDocx, ligneFigureOdt]) {
        assert.match(ligne, /alt="Description alternative de test"/);
        assert.match(ligne, /copyright="Studio Test"/);
        assert.match(ligne, /source="Photothèque SZH"/);
      }

      // La bibliographie détachée et les tableaux : identiques au caractère près.
      assert.strictEqual(
        lire(path.join(dirOdt, 'essai-odt.biblio.md')),
        lire(path.join(dirDocx, 'essai-docx.biblio.md')));
      assert.strictEqual(
        lire(path.join(dirOdt, 'tables', 'table-01.html')),
        lire(path.join(dirDocx, 'tables', 'table-01.html')));

      // Le portrait de l'auteur·e : présent et non vide des deux côtés. Les octets diffèrent,
      // LibreOffice réencodant le PNG.
      const portraitDocx = path.join(dirDocx, 'portraits', 'jeanne-dupont.original.png');
      const portraitOdt = path.join(dirOdt, 'portraits', 'jeanne-dupont.original.png');
      assert.ok(fs.statSync(portraitDocx).size > 0, 'portrait absent côté .docx');
      assert.ok(fs.statSync(portraitOdt).size > 0, 'portrait absent côté .odt');
    } finally {
      fs.rmSync(chantier, { recursive: true, force: true });
    }
  });
