// pipeline/manuscrit_docx.py : le lecteur .docx du nettoyeur de manuscrit (article), §3/§4/
// §10/§11 de outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md. Ce fichier éprouve les sept
// contrôles posés au §11 pour manuscrit-docx.test.js :
//   1. un paragraphe dont Word a coupé les runs au milieu d'un mot (et sur une espace) rend
//      N Fragment, dans l'ordre, et leur concaténation est le texte exact ;
//   2. None (non déclaré) et False (déclaré éteint) ne sont jamais confondus pour `gras` ;
//   3. un style localisé (Titre 1, Überschrift 1) est résolu au même nom humain que
//      heading 1, et niveau_declare vaut 1 ;
//   4. une image w:inline rend flottante=False, une w:anchor rend flottante=True, et les
//      OCTETS rendus sont exactement ceux de l'archive ;
//   5. un tableau à cellule fusionnée : la cellule masquée n'apparaît pas, le colspan de la
//      cellule qui la couvre est juste ;
//   6. un .docx portant des w:ins rend revisions > 0 ;
//   7. projeter_pronto() et pronto_docx.lire() s'accordent sur le gabarit livré.
// Plus le contrôle le moins cher et le plus utile (§11, note finale) : les onze manuscrits
// réels de tmp/corpus-relecture/lot-A/ ne lèvent aucune exception à la lecture — sauté sous
// un motif nommé quand tmp/ (hors git) est absent.
//
//   node --test test/js/manuscrit-docx.test.js
//
// Patron : test/js/docx-titres.test.js (fixtures .docx fabriquées ICI par un petit programme
// Python écrit au vol, jamais figées en binaire). Gardes de test/js/gardes.js : PYTHON
// (jamais `python3` en dur, qui tombe sur l'alias WindowsApps et fige toute la suite).
//
// manuscrit_docx.py n'est piloté que par sa CLI de diagnostic (--diagnostic/--images/
// --projeter-pronto/--pronto-brut <fichier.docx>) : Node ne peut pas l'importer directement.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_DOCX = path.join(RACINE, 'pipeline', 'manuscrit_docx.py');
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');
const GABARIT_LIVRE = path.join(RACINE, "revue-template", "Pronto - modele d'article.docx");

function python(args) {
  return cp.spawnSync(PYTHON, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-manuscritdocx-'));
}

// ---------------------------------------------------------------------------------
// Fabrication d'un .docx minimal, au vol, par un petit programme Python (jamais figé en
// binaire — patron docx-titres.test.js/fabriquerDocx). `spec` :
//   corps       : XML brut des enfants de w:body (w:p / w:tbl), déjà entièrement formé ;
//   styles      : [[styleId, "w:name"], ...] ;
//   lang        : w:val de w:docDefaults/w:rPrDefault/w:rPr/w:lang, optionnel ;
//   media       : {"image1.png": "<base64>", ...} -> écrit sous word/media/ ;
//   rels        : [[rId, target, external?], ...] -> word/_rels/document.xml.rels ;
//   footnotes   : XML brut des w:footnote (déjà formés), optionnel ;
//   comments    : nombre de commentaires à fabriquer, optionnel.
const FABRIQUE = [
  'import base64, json, sys, zipfile',
  'chemin, spec = sys.argv[1], json.loads(sys.argv[2])',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'corps = spec.get("corps", "")',
  'doc = ((',
  '    \'<?xml version="1.0" encoding="UTF-8"?>\'',
  '    \'<w:document xmlns:w="%s" \'',
  '    \'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" \'',
  '    \'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" \'',
  '    \'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" \'',
  '    \'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" \'',
  '    \'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" \'',
  '    \'xmlns:v="urn:schemas-microsoft-com:vml">\'',
  '    \'<w:body>%s</w:body></w:document>\') % (W, corps))',
  'styles_body = "".join(',
  '    \'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' % (sid, nom)',
  '    for sid, nom in spec.get("styles", []))',
  'lang = spec.get("lang")',
  'docdefaults = ""',
  'if lang:',
  '    docdefaults = (',
  '        \'<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="%s"/></w:rPr>\'',
  '        \'</w:rPrDefault></w:docDefaults>\' % lang)',
  'styles_xml = (',
  '    \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">%s%s</w:styles>\'',
  '    % (W, docdefaults, styles_body))',
  'media = spec.get("media", {})',
  'rels_extra = [tuple(r) for r in spec.get("rels", [])]',
  'rels_bits = []',
  'for r in rels_extra:',
  '    rid, tgt = r[0], r[1]',
  '    externe = \' TargetMode="External"\' if (len(r) > 2 and r[2]) else ""',
  '    rels_bits.append(\'<Relationship Id="%s" Type="x" Target="%s"%s/>\'',
  '                      % (rid, tgt, externe))',
  'rels_xml = (',
  '    \'<?xml version="1.0" encoding="UTF-8"?><Relationships \'',
  '    \'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s\'',
  '    \'</Relationships>\' % "".join(rels_bits))',
  'with zipfile.ZipFile(chemin, "w") as z:',
  '    z.writestr("word/document.xml", doc.encode("utf-8"))',
  '    z.writestr("word/styles.xml", styles_xml.encode("utf-8"))',
  '    z.writestr("word/_rels/document.xml.rels", rels_xml.encode("utf-8"))',
  '    for nom, b64 in media.items():',
  '        z.writestr("word/media/%s" % nom, base64.b64decode(b64))',
  '    if spec.get("footnotes"):',
  '        fn = (',
  '            \'<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="%s">%s\'',
  '            \'</w:footnotes>\' % (W, spec["footnotes"]))',
  '        z.writestr("word/footnotes.xml", fn.encode("utf-8"))',
  '    if spec.get("comments"):',
  '        c = "".join(\'<w:comment w:id="%d"><w:p/></w:comment>\' % i',
  '                     for i in range(spec["comments"]))',
  '        cx = (\'<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="%s">%s\'',
  '              \'</w:comments>\' % (W, c))',
  '        z.writestr("word/comments.xml", cx.encode("utf-8"))',
  '    if spec.get("numbering") is not None:',
  '        # Ajouté le 18.09.2026 (§5.4 du contrat, résolution numFmt) — purement additif :',
  '        # absent de tous les tests déjà écrits avant ce jour, leur comportement ne change pas.',
  '        nx = (\'<?xml version="1.0" encoding="UTF-8"?><w:numbering xmlns:w="%s">%s\'',
  '              \'</w:numbering>\' % (W, spec["numbering"]))',
  '        z.writestr("word/numbering.xml", nx.encode("utf-8"))'
].join('\n');

function fabriquerDocx(chemin, spec) {
  const r = python(['-c', FABRIQUE, chemin, JSON.stringify(spec)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Lance manuscrit_docx.py en mode `mode` sur `chemin`, rend le JSON déjà parsé.
function diagnostiquer(mode, chemin) {
  const r = python([MANUSCRIT_DOCX, mode, chemin]);
  assert.strictEqual(r.status, 0, mode + ' a échoué sur ' + chemin + ' : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 — mot coupé au milieu d'un run, ET coupure sur une espace de run : la
// concaténation des Fragment doit reconstruire le texte EXACT, jamais rogné à la frontière.
//
// Sabotage minimal : dans _texte_depuis_enfants(), remplacer
// `_normaliser_run(''.join(morceaux))` par `_normaliser_run(''.join(morceaux).strip())`
// (rogner chaque run isolément, comme le ferait pronto_modele.normaliser() appelé par
// Fragment) — la seconde assertion (coupure sur une espace) rougit : « Bonjour »+« le monde »
// devient « Bonjourle monde ».

test('manuscrit_docx.py --diagnostic : un mot coupé au milieu d\'un run se reconstruit exactement',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Le mot anticonstitu</w:t></w:r>' +
        '<w:r><w:t xml:space="preserve">tionnellement est long.</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const p = document.blocs[0];
      assert.strictEqual(p.fragments.length, 2, 'deux w:r doivent rendre deux Fragment');
      const texte = p.fragments.map((f) => f.texte).join('');
      assert.strictEqual(texte, 'Le mot anticonstitutionnellement est long.');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_docx.py --diagnostic : une coupure de run sur une espace ne perd pas l\'espace',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      // La coupure tombe exactement après l'espace qui suit "Bonjour" : un rognage par
      // Fragment isolé ("Bonjour " -> "Bonjour") perdrait cette espace à la concaténation.
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Bonjour </w:t></w:r>' +
        '<w:r><w:t xml:space="preserve">le monde</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const texte = document.blocs[0].fragments.map((f) => f.texte).join('');
      assert.strictEqual(texte, 'Bonjour le monde');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 — None (non déclaré) contre False (déclaré éteint), jamais confondus.
//
// _lire_onoff() a DEUX clauses de sortie None, sur deux branches distinctes :
//   - rpr est None (AUCUN w:rPr sur le run) — ligne `if rpr is None: return None` ;
//   - rpr existe mais ne porte pas la balise demandée (ex. w:b absent d'un w:rPr qui porte
//     autre chose, comme de l'italique) — ligne `if el is None: return None`.
// Le premier jet de ce contrôle (18.09.2026) n'exerçait QUE la première branche (son run
// « sans declaration » n'a AUCUN w:rPr du tout) : un sabotage de la seconde branche
// (`if el is None: return False`) — celle que son propre commentaire prétendait viser —
// laissait les 10 tests verts. Mesuré par sabotage réel, pas supposé : un défaut de
// couverture confirmé le 18.09.2026 (revue adverse), plus grave qu'il n'y paraît, car c'est
// la branche qui se déclenche sur PRESQUE TOUS les runs réels — Word écrit un w:rPr dès qu'il
// y a une langue de correction, une police ou de l'italique, et n'y met un w:b que si le gras
// est explicite ; « rPr présent, w:b absent » est donc le cas normal, « aucun rPr » le cas
// rare. Une confusion ici ferait annoncer par nettoyer_mise_en_forme() « gras retiré » sur des
// milliers de fragments qui n'ont jamais été gras.
//
// Le run ajouté ci-dessous porte un w:rPr NON VIDE (de l'italique) mais SANS w:b : il exerce
// la seconde branche. Les deux sabotages sont maintenant prouvés dans les deux sens :
//   - ligne `if rpr is None: return None` → `return False` : rougit (fr[0]) ;
//   - ligne `if el is None: return None` → `return False`  : rougit maintenant AUSSI (fr[3]).

test('manuscrit_docx.py --diagnostic : gras=None (non déclaré) ≠ gras=False (déclaré éteint)',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p>' +
        '<w:r><w:t xml:space="preserve">sans declaration</w:t></w:r>' +
        '<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t xml:space="preserve">gras eteint</w:t></w:r>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">gras actif</w:t></w:r>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">italique sans gras declare</w:t></w:r>' +
        '</w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const fr = document.blocs[0].fragments;
      assert.strictEqual(fr[0].forme.gras, null, 'aucun w:b : non déclaré');
      assert.strictEqual(fr[1].forme.gras, false, 'w:b val="0" : déclaré éteint');
      assert.strictEqual(fr[2].forme.gras, true, 'w:b sans val : déclaré actif');
      assert.strictEqual(fr[3].forme.gras, null,
        'w:rPr présent (italique) mais sans w:b : non déclaré, pas éteint — le cas réel le plus fréquent');
      assert.strictEqual(fr[3].forme.italique, true, 'l\'italique déclaré sur ce même run doit rester lu');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°3 — un style localisé résolu au même nom humain, et niveau_declare correct.
// « heading 1 » (styles.xml complet) et « Titre 1 » (styles.xml complet, nom français) sont
// les deux formes qu'un manuscrit RÉEL de ce corpus (français) peut porter ; « berschrift1 »
// exerce le repli sur le styleId brut que pronto_docx.resoudre_style garde pour un style
// hérité, sans entrée dans styles.xml (docx-pronto.py, ⚠ voir le rapport final : la forme
// PLEINEMENT localisée « Überschrift 1», résolue via un w:name présent dans styles.xml, ne
// passe PAS par ce repli et n'est pas couverte ici pour cette raison précise).
//
// Sabotage minimal : dans _paragraphe_depuis(), appeler `pm.niveau_depuis_style('')` au lieu
// de `pm.niveau_depuis_style(style_resolu)` — tous les niveau_declare tombent à 0, la
// dernière assertion de chaque bloc rougit.

test('manuscrit_docx.py --diagnostic : styles localisés résolus au bon niveau de titre',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:pPr><w:pStyle w:val="H1EN"/></w:pPr>' +
        '<w:r><w:t xml:space="preserve">Titre en anglais</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="H1FR"/></w:pPr>' +
        '<w:r><w:t xml:space="preserve">Titre en francais</w:t></w:r></w:p>' +
        '<w:p><w:pPr><w:pStyle w:val="berschrift1"/></w:pPr>' +
        '<w:r><w:t xml:space="preserve">Titre en allemand (repli styleId)</w:t></w:r></w:p>';
      fabriquerDocx(docx, {
        corps,
        styles: [['H1EN', 'heading 1'], ['H1FR', 'Titre 1']]
        // berschrift1 : AUCUNE entree dans styles.xml -> repli sur le styleId brut.
      });
      const { document } = diagnostiquer('--diagnostic', docx);
      const [p1, p2, p3] = document.blocs;
      assert.strictEqual(p1.style, 'heading 1');
      assert.strictEqual(p1.niveau_declare, 1);
      assert.strictEqual(p2.style, 'titre 1');
      assert.strictEqual(p2.niveau_declare, 1);
      assert.strictEqual(p3.style, 'berschrift1');
      assert.strictEqual(p3.niveau_declare, 1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 — w:inline -> flottante=False, w:anchor -> flottante=True, et les OCTETS
// rendus sont exactement ceux de l'archive (comparaison par sha256, --images).
//
// Sabotage minimal : dans _image_depuis_drawing(), inverser `flottante = False` / la
// détection wp:anchor (mettre flottante = True dans les deux branches) — la première
// assertion (flottante===false pour l'image inline) rougit.

test('manuscrit_docx.py --images : inline non flottante, anchor flottante, octets exacts',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const octetsInline = Buffer.from('PNG-FAUX-OCTETS-INLINE-0123456789');
      const octetsAncre = Buffer.from('PNG-FAUX-OCTETS-ANCRE-abcdefghijklmnop');
      const drawingInline =
        '<w:drawing><wp:inline><wp:extent cx="1000" cy="2000"/>' +
        '<wp:docPr descr="alt inline"/>' +
        '<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/>' +
        '</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
      const drawingAncre =
        '<w:drawing><wp:anchor><wp:extent cx="3000" cy="4000"/>' +
        '<wp:docPr descr="alt ancre"/>' +
        '<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId2"/>' +
        '</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>';
      const corps =
        '<w:p><w:r>' + drawingInline + '</w:r></w:p>' +
        '<w:p><w:r>' + drawingAncre + '</w:r></w:p>';
      fabriquerDocx(docx, {
        corps,
        media: {
          'image1.png': octetsInline.toString('base64'),
          'image2.png': octetsAncre.toString('base64')
        },
        rels: [['rId1', 'media/image1.png'], ['rId2', 'media/image2.png']]
      });
      const { document } = diagnostiquer('--diagnostic', docx);
      const imgInline = document.blocs[0].fragments.find((f) => f.image).image;
      const imgAncre = document.blocs[1].fragments.find((f) => f.image).image;
      assert.strictEqual(imgInline.flottante, false);
      assert.strictEqual(imgAncre.flottante, true);
      assert.strictEqual(imgInline.surface, 1000 * 2000);
      assert.strictEqual(imgInline.alt, 'alt inline');

      const images = diagnostiquer('--images', docx);
      const parNom = {};
      for (const img of images) { parNom[img.nom] = img; }
      assert.strictEqual(parNom['image1.png'].sha256,
        crypto.createHash('sha256').update(octetsInline).digest('hex'),
        'les octets rendus doivent être exactement ceux de l\'archive (image1)');
      assert.strictEqual(parNom['image2.png'].sha256,
        crypto.createHash('sha256').update(octetsAncre).digest('hex'),
        'les octets rendus doivent être exactement ceux de l\'archive (image2)');
      assert.strictEqual(parNom['image1.png'].longueur, octetsInline.length);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôles ajoutés le 18.09.2026 — dimensions en PIXELS du FICHIER, lues dans SES OCTETS
// (jamais dans wp:extent/cx/cy, qui ne décrit que la boîte d'AFFICHAGE de Word ; voir
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md §4). Les fabriques ci-dessous assemblent
// des octets PNG/JPEG minimaux à la main (Buffer), jamais figés en binaire — même esprit que
// fabriquerDocx() pour le conteneur .docx qui les enveloppe.

function fabriquerPng(largeur, hauteur) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const longueurChunk = Buffer.alloc(4);
  longueurChunk.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'latin1');
  const donnees = Buffer.alloc(13);
  donnees.writeUInt32BE(largeur, 0);
  donnees.writeUInt32BE(hauteur, 4);
  donnees[8] = 8; donnees[9] = 2; donnees[10] = 0; donnees[11] = 0; donnees[12] = 0;
  const crc = Buffer.alloc(4); // jamais vérifié par _dimensions_png : hors sujet ici
  return Buffer.concat([signature, longueurChunk, type, donnees, crc]);
}

// SOI, puis un DHT (0xFFC4, table de Huffman) dont les octets — pris À TORT pour un SOF —
// rendraient les dimensions absurdes 0xBBCC x 0xDDEE, puis le VRAI SOF0 (0xFFC0) qui porte
// les dimensions demandées. C'est l'erreur que le contrôle suivant doit prouver absente :
// le contrat la nomme explicitement (0xFFC4/0xFFC8/0xFFCC partagent la plage numérique des
// SOF sans en être).
function fabriquerJpegAvecPiegeDht(largeur, hauteur) {
  const dhtDonnees = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
  const dhtLongueur = Buffer.alloc(2);
  dhtLongueur.writeUInt16BE(2 + dhtDonnees.length, 0);
  const dht = Buffer.concat([Buffer.from([0xff, 0xc4]), dhtLongueur, dhtDonnees]);

  const sofDonnees = Buffer.alloc(6); // précision(1) + hauteur(2) + largeur(2) + Nf(1)
  sofDonnees[0] = 8;
  sofDonnees.writeUInt16BE(hauteur, 1);
  sofDonnees.writeUInt16BE(largeur, 3);
  sofDonnees[5] = 1;
  const sofLongueur = Buffer.alloc(2);
  sofLongueur.writeUInt16BE(2 + sofDonnees.length, 0);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0]), sofLongueur, sofDonnees]);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), dht, sof]);
}

// Un .docx à un seul paragraphe portant une unique image w:inline, avec `cx`/`cy` (EMU) et
// les octets d'image donnés — patron du drawing de contrôle n°4, réduit à l'essentiel.
function fabriquerDocxAvecImage(chemin, octetsImage, cx, cy, nomFichier) {
  const drawing =
    '<w:drawing><wp:inline><wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
    '<wp:docPr descr="alt"/>' +
    '<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/>' +
    '</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  const corps = '<w:p><w:r>' + drawing + '</w:r></w:p>';
  fabriquerDocx(chemin, {
    corps,
    media: { [nomFichier]: octetsImage.toString('base64') },
    rels: [['rId1', 'media/' + nomFichier]]
  });
}

// Sabotage minimal : dans _dimensions_png(), échanger `largeur, hauteur = struct.unpack(...)`
// en `hauteur, largeur = struct.unpack(...)` — largeur et hauteur étant différentes (120≠80)
// dans cette fixture, l'assertion sur largeur_px rougit.

test('manuscrit_docx.py --diagnostic : un PNG fabriqué en 120 x 80 rend ses vraies dimensions en pixels',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      fabriquerDocxAvecImage(docx, fabriquerPng(120, 80), 1000, 2000, 'image1.png');
      const { document } = diagnostiquer('--diagnostic', docx);
      const img = document.blocs[0].fragments.find((f) => f.image).image;
      assert.strictEqual(img.largeur_px, 120);
      assert.strictEqual(img.hauteur_px, 80);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Sabotage minimal : retirer 0xC4 de _SOF_JPEG_EXCLUS — le parcours prend alors le DHT pour
// un SOF et rend les dimensions de sa charge de table de Huffman (0xBBCC x 0xDDEE), pas
// 120 x 80.

test('manuscrit_docx.py --diagnostic : un JPEG rend ses vraies dimensions, pas celles d\'un 0xFFC4 pris à tort pour un SOF',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      fabriquerDocxAvecImage(docx, fabriquerJpegAvecPiegeDht(120, 80), 1000, 2000, 'image1.jpg');
      const { document } = diagnostiquer('--diagnostic', docx);
      const img = document.blocs[0].fragments.find((f) => f.image).image;
      assert.strictEqual(img.largeur_px, 120,
        'doit lire le VRAI SOF0, pas la table de Huffman (0xFFC4) prise à tort pour un SOF');
      assert.strictEqual(img.hauteur_px, 80);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Un fichier tronqué (signature PNG et étiquette IHDR présentes, mais coupé avant la fin de
// la charge largeur/hauteur — cas réel d'un transfert interrompu) doit rendre (0, 0) SANS
// jamais lever, et le document doit quand même se lire (code de sortie 0, déjà vérifié par
// diagnostiquer() ci-dessous).
//
// Sabotage minimal : dans _dimensions_image(), remplacer `except Exception:` par
// `except ValueError:` — struct.error n'est PAS une ValueError, l'exception remonte alors
// non rattrapée jusqu'à la CLI, qui échoue tout le document (code 1) au lieu de rendre (0, 0)
// pour cette seule image : l'assertion `r.status === 0` de diagnostiquer() rougit.

test('manuscrit_docx.py --diagnostic : un fichier image tronqué rend 0,0 sans jamais lever, et le document se lit quand même',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const pngTronque = fabriquerPng(120, 80).subarray(0, 20); // 33 octets normalement
      fabriquerDocxAvecImage(docx, pngTronque, 1000, 2000, 'image1.png');
      const { document } = diagnostiquer('--diagnostic', docx);
      const img = document.blocs[0].fragments.find((f) => f.image).image;
      assert.strictEqual(img.largeur_px, 0);
      assert.strictEqual(img.hauteur_px, 0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Un format entièrement inconnu de ce lecteur (SVG, ici un extrait littéral, ni PNG ni
// JPEG ni GIF ni BMP) rend (0, 0) de la même façon — c'est un résultat correct, pas une
// panne : un vectoriel n'a pas de résolution.

test('manuscrit_docx.py --diagnostic : un format inconnu (SVG) rend 0,0, sans lever, distinct d\'un fichier abîmé',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>', 'utf8');
      fabriquerDocxAvecImage(docx, svg, 1000, 2000, 'image1.svg');
      const { document } = diagnostiquer('--diagnostic', docx);
      const img = document.blocs[0].fragments.find((f) => f.image).image;
      assert.strictEqual(img.largeur_px, 0);
      assert.strictEqual(img.hauteur_px, 0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// cx et cy (§4 du contrat) : rendus SÉPARÉMENT, jamais fondus dans le seul produit `surface`
// — c'est ce qui garantit qu'on n'a rien cassé chez qui lit déjà `surface`.
//
// Sabotage minimal : dans _image_depuis_drawing(), remplacer `surface = cx * cy` par
// `surface = cx + cy` — cx et cy restent corrects (lecture inchangée), seule l'assertion sur
// `surface` (le produit) rougit.

test('manuscrit_docx.py --diagnostic : cx et cy sont rendus séparément, et leur produit reste égal à surface',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      fabriquerDocxAvecImage(docx, fabriquerPng(10, 10), 1234567, 987654, 'image1.png');
      const { document } = diagnostiquer('--diagnostic', docx);
      const img = document.blocs[0].fragments.find((f) => f.image).image;
      assert.strictEqual(img.cx, 1234567);
      assert.strictEqual(img.cy, 987654);
      assert.strictEqual(img.surface, 1234567 * 987654,
        'le produit de cx et cy doit toujours valoir surface, pour ne rien casser chez qui '
        + 'lit déjà ce champ');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Le contrôle le plus proche du besoin réel qui motive ce chantier (§ du rapport de mission) :
// sur le corpus réel, TOUTES les images incorporées doivent porter des dimensions en pixels
// non nulles — sans quoi rien ne peut se calculer sur leur qualité. Sauté sous un motif
// nommé si tmp/ (hors git) est absent, jamais en silence.
//
// Sabotage minimal : ajouter `return 0, 0` en toute première ligne de _dimensions_image() —
// toutes les images du document, y compris ces 16 images réelles, rendraient 0,0.

test('manuscrit_docx.py --images : les 16 images incorporées du corpus réel (lot-A/4_*.docx) ont toutes des dimensions en pixels non nulles',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      t.skip('corpus tmp/corpus-relecture/lot-A absent (tmp/ est hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A)
      .filter((n) => n.startsWith('4_') && n.toLowerCase().endsWith('.docx'));
    if (fichiers.length === 0) {
      t.skip('aucun fichier "4_*.docx" dans lot-A (corpus incomplet)');
      return;
    }
    const chemin = path.join(CORPUS_LOT_A, fichiers[0]);
    const r = python([MANUSCRIT_DOCX, '--images', chemin]);
    assert.strictEqual(r.status, 0, '--images a échoué sur ' + chemin + ' : ' + r.stderr);
    const images = JSON.parse(r.stdout);
    assert.strictEqual(images.length, 16,
      'ce fichier réel porte 16 images incorporées (mesuré le 18.09.2026)');
    const sansDimensions = images.filter((img) => img.largeur_px === 0 || img.hauteur_px === 0);
    assert.deepStrictEqual(sansDimensions.map((img) => img.nom), [],
      'toutes les images incorporées de ce fichier réel doivent avoir des dimensions en '
      + 'pixels non nulles');
  });

// ---------------------------------------------------------------------------------
// Contrôle ajouté le 18.09.2026 (revue adverse, sur le relevé chiffré du corpus réel) — le
// compteur d'images héritées (VML, w:pict) incrémentait de 1 par w:pict RENCONTRÉ, jamais par
// image qu'il contient réellement : un w:pict groupant plusieurs v:imagedata (v:group imbriqué,
// ce que Word écrit pour un collage de plusieurs images en une seule forme héritée) était donc
// sous-compté. Un tel chiffre est lu par une relectrice pour juger si elle doit aller chercher
// une image à la main — un sous-comptage la trompe sur le nombre réel d'images perdues.
//
// Sabotage minimal : dans _fragments_de_run(), remplacer
// `recensement['image_vml_ignoree'] += n_images_vml if n_images_vml else 1` par
// `recensement['image_vml_ignoree'] += 1` (l'ancien comportement) — l'avertissement annoncerait
// « occurrences 1 » au lieu de 2, l'assertion sur le message rougit.

test('manuscrit_docx.py --diagnostic : un w:pict groupant plusieurs v:imagedata compte chaque image, pas l\'enveloppe',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:pict><v:group>' +
        '<v:shape><v:imagedata/></v:shape>' +
        '<v:shape><v:imagedata/></v:shape>' +
        '</v:group></w:pict></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      assert.ok(
        /\[import-avertissement\] images-vml-ignorees \| article \| occurrences 2 \|/.test(r.stderr),
        'un seul w:pict portant 2 v:imagedata doit annoncer 2 images ignorées, pas 1 enveloppe. ' +
        'stderr obtenu : ' + r.stderr);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle ajouté le 18.09.2026 (revue adverse, défaut trouvé par recoupement direct sur
// lot-A/4_La méthode Flip Flap.docx, PAS par sabotage) — _enfants_utiles() ne regarde que la
// branche mc:Choice d'un mc:AlternateContent, pour ne pas compter deux fois LA MÊME forme
// redite en VML dans mc:Fallback (voir le point 2 de l'en-tête du module). Mais sur ce fichier
// réel, 4 des 10 ancrages flottants ont une branche Choice qui est un pur groupe de formes SANS
// image (recensé, correctement, en 'forme_vectorielle_ignoree') — et une branche Fallback qui,
// elle, porte un VRAI groupe d'images embarquées (<v:imagedata>). Avant correction, ces images
// n'apparaissaient dans AUCUN recensement : ni ici (Fallback jamais visité), ni sous
// 'forme_vectorielle_ignoree' (qui ne dit que « c'est une forme sans image », faux dès qu'elle
// porte des photos dans son repli) — le silence que le §10 du contrat interdit.
//
// Sabotage minimal : dans _images_fantomes_du_repli(), retirer l'appel à cette fonction (ou son
// corps) — l'avertissement 'images-vml-ignorees' redescend à « occurrences 1 » (le seul w:pict
// direct de cette fixture, sans rapport avec l'AlternateContent), et les 2 images du Fallback
// disparaissent de tout recensement.

test('manuscrit_docx.py --diagnostic : les vraies images d\'un mc:Fallback ne disparaissent plus derrière une forme Choice sans image',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      // Choice : un dessin flottant SANS <a:blip> (pure forme, comme les 10 ancrages réels).
      // Fallback : la même forme en VML, mais avec un groupe de 2 v:imagedata — les vraies
      // images que le Choice moderne ne porte pas.
      const corps =
        '<w:p><w:r><mc:AlternateContent>' +
        '<mc:Choice Requires="wps">' +
        '<w:drawing><wp:anchor><wp:extent cx="1000" cy="1000"/>' +
        '<wp:docPr descr="forme sans image"/>' +
        '<a:graphic><a:graphicData></a:graphicData></a:graphic></wp:anchor></w:drawing>' +
        '</mc:Choice>' +
        '<mc:Fallback>' +
        '<w:pict><v:group>' +
        '<v:shape><v:imagedata/></v:shape>' +
        '<v:shape><v:imagedata/></v:shape>' +
        '</v:group></w:pict>' +
        '</mc:Fallback>' +
        '</mc:AlternateContent></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      assert.ok(
        /\[import-avertissement\] images-vml-ignorees \| article \| occurrences 2 \|/.test(r.stderr),
        'les 2 images du Fallback doivent être recensées, alors même que le Choice n\'en a ' +
        'aucune. stderr obtenu : ' + r.stderr);
      assert.ok(
        /\[import-avertissement\] formes-vectorielles-ignorees \| article \| occurrences 1 \|/
          .test(r.stderr),
        'la forme du Choice, elle, reste recensée séparément comme forme sans image. ' +
        'stderr obtenu : ' + r.stderr);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°5 — cellule fusionnée horizontalement : la cellule masquée n'apparaît pas dans
// les rangées, et le colspan de la cellule qui la couvre est juste. (Une rangée de 3
// colonnes-grille où la première cellule porte gridSpan=2 : Word n'écrit AUCUNE cellule pour
// la seconde colonne couverte — il n'y a donc qu'une seule w:tc de moins à vérifier : le
// nombre de cellules de la rangée.)
//
// Sabotage minimal : dans _colspan(), rendre toujours 1 (ignorer gridSpan) — l'assertion sur
// colspan===2 rougit.

test('manuscrit_docx.py --diagnostic : cellule fusionnée (gridSpan), colspan correct',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:tbl>' +
        '<w:tr>' +
        '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>' +
        '<w:p><w:r><w:t xml:space="preserve">fusionnee</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t xml:space="preserve">colonne 3</w:t></w:r></w:p></w:tc>' +
        '</w:tr>' +
        '<w:tr>' +
        '<w:tc><w:p><w:r><w:t xml:space="preserve">a</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t xml:space="preserve">b</w:t></w:r></w:p></w:tc>' +
        '<w:tc><w:p><w:r><w:t xml:space="preserve">c</w:t></w:r></w:p></w:tc>' +
        '</w:tr>' +
        '</w:tbl>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const tbl = document.blocs[0];
      assert.strictEqual(tbl.type, 'tableau');
      assert.strictEqual(tbl.rangees[0].length, 2, 'la cellule masquée ne doit pas apparaître');
      assert.strictEqual(tbl.rangees[0][0].colspan, 2);
      assert.strictEqual(tbl.rangees[1].length, 3, 'la rangée non fusionnée garde ses 3 cellules');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 — un .docx portant des w:ins rend revisions > 0.
//
// Sabotage minimal : dans _compter_revisions(), ne compter que les w:del (retirer le terme
// `+ sum(1 for _ in racine.iter(W + 'ins'))`) — un document qui n'a QUE des w:ins (celui-ci)
// rendrait revisions=0, l'assertion `> 0` rougit.
//
// Scindé en deux tests le 18.09.2026 (revue adverse) : un même test vérifiait à la fois le
// COMPTEUR de révisions et la RECONSTRUCTION du texte — un sabotage touchant la seconde moitié
// (ex. la normalisation du texte) le faisait rougir pour une raison étrangère au compteur qu'il
// annonce garder. Séparé pour que chaque test tombe pour la raison qu'il dit garder.

test('manuscrit_docx.py --diagnostic : un document en suivi de modifications rend revisions > 0',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Texte propre. </w:t></w:r>' +
        '<w:ins w:id="1" w:author="R" w:date="2026-09-18T00:00:00Z">' +
        '<w:r><w:t xml:space="preserve">Texte insere.</w:t></w:r></w:ins></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      assert.ok(document.revisions > 0, 'un w:ins doit être compté');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_docx.py --diagnostic : le texte inséré en suivi de modifications reste lisible',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Texte propre. </w:t></w:r>' +
        '<w:ins w:id="1" w:author="R" w:date="2026-09-18T00:00:00Z">' +
        '<w:r><w:t xml:space="preserve">Texte insere.</w:t></w:r></w:ins></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      // Pas de plantage sur w:ins (voir le §8 du contrat : c'est la CLI qui refusera le
      // document, pas le lecteur qui doit planter), et le texte inséré reste lisible.
      const texte = document.blocs[0].fragments.map((f) => f.texte).join('');
      assert.strictEqual(texte, 'Texte propre. Texte insere.');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_docx.py --diagnostic : sans w:ins/w:del, revisions vaut 0',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      fabriquerDocx(docx, {
        corps: '<w:p><w:r><w:t xml:space="preserve">Rien a signaler.</w:t></w:r></w:p>'
      });
      const { document } = diagnostiquer('--diagnostic', docx);
      assert.strictEqual(document.revisions, 0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°7 — projeter_pronto() et pronto_docx.lire() s'accordent EXACTEMENT sur le
// gabarit livré (§3 du contrat, dette assumée).
//
// Sabotage minimal : dans projeter_pronto()/texte_paragraphe(), omettre le second appel à
// pm.normaliser() (rendre `brut` tel quel) — sur un paragraphe du gabarit qui contient un
// tiret cadratin ou une espace multiple, `texte` diffère de celui de pronto_docx.lire(),
// deepStrictEqual rougit.

test('manuscrit_docx.py : projeter_pronto() == pronto_docx.lire() sur le gabarit livré',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(GABARIT_LIVRE)) {
      t.skip('gabarit livré absent : ' + GABARIT_LIVRE);
      return;
    }
    const projection = diagnostiquer('--projeter-pronto', GABARIT_LIVRE);
    const reference = diagnostiquer('--pronto-brut', GABARIT_LIVRE);
    assert.deepStrictEqual(projection, reference,
      'projeter_pronto() doit rendre EXACTEMENT ce que pronto_docx.lire() rend sur le même fichier');
  });

// ---------------------------------------------------------------------------------
// Le contrôle le moins cher et le plus utile (§11, note finale) : les onze manuscrits réels
// ne lèvent aucune exception à la lecture. tmp/ est hors git et peut être effacé sans
// prévenir : sauté proprement, sous un motif nommé, quand il est absent — jamais en silence.

test('manuscrit_docx.py --diagnostic : les onze manuscrits réels de lot-A se lisent sans exception',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      t.skip('corpus tmp/corpus-relecture/lot-A absent (tmp/ est hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A).filter((n) => n.toLowerCase().endsWith('.docx'));
    assert.ok(fichiers.length > 0, 'aucun .docx trouvé dans lot-A alors que le dossier existe');
    const echecs = [];
    for (const nom of fichiers) {
      const r = python([MANUSCRIT_DOCX, '--diagnostic', path.join(CORPUS_LOT_A, nom)]);
      if (r.status !== 0) { echecs.push(nom + ' : ' + r.stderr); }
    }
    assert.deepStrictEqual(echecs, [], 'ces fichiers ont levé une exception à la lecture');
  });

// ---------------------------------------------------------------------------------
// §5.4 du contrat (ajouté le 18.09.2026, décidé avec Robin après mesure) : résolution du
// FORMAT d'une liste ('puce'/'numero'/'') en trois sauts — w:numPr (numId) -> word/
// numbering.xml w:num (abstractNumId) -> w:abstractNum w:lvl (w:numFmt), avec w:lvlOverride
// qui l'emporte quand il porte lui-même un w:lvl. Jamais deviné : numbering.xml absent ou
// format non catalogué rend '' (voir manuscrit_gabarit.py pour qui choisit alors un repli).
//
// Fixture : `numbering` sur la spec de fabriquerDocx (ajouté à FABRIQUE ci-dessus, purement
// additif — absent de tous les tests précédents, leur comportement ne change pas).

function collecterListes(document) {
  const trouvees = [];
  function creuserBlocs(blocs) {
    for (const b of blocs) {
      if (b.type === 'tableau') {
        for (const rangee of b.rangees) {
          for (const c of rangee) { creuserBlocs(c.blocs); }
        }
      } else if (b.liste) {
        trouvees.push(b.liste);
      }
    }
  }
  creuserBlocs(document.blocs);
  return trouvees;
}

test('manuscrit_docx.py --diagnostic : un numId dont l\'abstractNum dit "bullet" rend puce, un autre "decimal" rend numero',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const numbering =
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/>'
        + '<w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
        + '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/>'
        + '<w:lvlText w:val="%1."/></w:lvl></w:abstractNum>'
        + '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>'
        + '<w:num w:numId="6"><w:abstractNumId w:val="1"/></w:num>';
      const corps =
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr>'
        + '<w:r><w:t xml:space="preserve">item a puces</w:t></w:r></w:p>'
        + '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="6"/></w:numPr></w:pPr>'
        + '<w:r><w:t xml:space="preserve">item numerote</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps, numbering });
      const { document } = diagnostiquer('--diagnostic', docx);
      const [p1, p2] = document.blocs;
      assert.deepStrictEqual(p1.liste, [5, 0, 'puce']);
      assert.deepStrictEqual(p2.liste, [6, 0, 'numero']);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_docx.py --diagnostic : un w:lvlOverride qui porte son propre w:lvl (numFmt) l\'emporte sur l\'abstractNum',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      // abstractNum : ilvl0 = bullet. Le num qui le référence redéfinit ce même niveau en
      // decimal via lvlOverride/w:lvl — le cas d'usage documenté (§5.4) : une autrice repart
      // d'une liste existante en changeant la puce d'un niveau.
      const numbering =
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/>'
        + '<w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
        + '<w:num w:numId="9"><w:abstractNumId w:val="0"/>'
        + '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>'
        + '<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
        + '</w:lvlOverride></w:num>';
      const corps =
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="9"/></w:numPr></w:pPr>'
        + '<w:r><w:t xml:space="preserve">item</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps, numbering });
      const { document } = diagnostiquer('--diagnostic', docx);
      assert.deepStrictEqual(document.blocs[0].liste, [9, 0, 'numero'],
        'le w:lvlOverride (decimal) doit l\'emporter sur le numFmt bullet de l\'abstractNum');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_docx.py --diagnostic : un w:lvlOverride sans w:lvl (simple startOverride) ne change PAS le format',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const numbering =
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/>'
        + '<w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
        + '<w:num w:numId="9"><w:abstractNumId w:val="0"/>'
        + '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
      const corps =
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="9"/></w:numPr></w:pPr>'
        + '<w:r><w:t xml:space="preserve">item</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps, numbering });
      const { document } = diagnostiquer('--diagnostic', docx);
      assert.deepStrictEqual(document.blocs[0].liste, [9, 0, 'puce'],
        'un simple w:startOverride ne redéfinit pas le numFmt : celui de l\'abstractNum tient');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_docx.py --diagnostic : numbering.xml absent rend un format vide, sans lever',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
        + '<w:r><w:t xml:space="preserve">item sans numbering.xml</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });               // pas de clé "numbering" : fichier absent
      const { document } = diagnostiquer('--diagnostic', docx);
      assert.deepStrictEqual(document.blocs[0].liste, [1, 0, ''],
        'sans numbering.xml, le format doit être vide (non déterminé) — jamais deviné, et '
        + 'la lecture ne doit pas lever');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Fige la mesure du 18.09.2026 en contrôle (revue adverse : « la différence entre observer et
// garder n'est pas cosmétique ») — la seule liste réelle qu'on ait, sur les trois manuscrits
// qui en portent (§5.4) : 20 paragraphes de liste au total, tous à puces sur 3_ et 3bis_, et
// 4_ qui porte les deux formes (numéros de section ET puces d'une sous-liste).
test('manuscrit_docx.py --diagnostic : sur le corpus réel, 3_ et 3bis_ résolvent en puce, 4_ porte les deux formes (20 paragraphes au total)',
  { skip: sansPython }, (t) => {
    const fichiers = ['3_VF_Chanier-Delorme_Article CSPS_290626.docx',
      '3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx'];
    if (!fs.existsSync(CORPUS_LOT_A)) {
      t.skip('corpus tmp/corpus-relecture/lot-A absent (tmp/ est hors git, effacé sans prévenir)');
      return;
    }
    const nom4 = fs.readdirSync(CORPUS_LOT_A).find((n) => n.startsWith('4_'));
    assert.ok(nom4, 'le manuscrit "4_..." attendu dans lot-A est introuvable');

    let total = 0;
    const formats3 = new Set();
    for (const nom of fichiers) {
      const { document } = diagnostiquer('--diagnostic', path.join(CORPUS_LOT_A, nom));
      const listes = collecterListes(document);
      total += listes.length;
      for (const l of listes) { formats3.add(l[2]); }
    }
    assert.deepStrictEqual(formats3, new Set(['puce']),
      '3_ et 3bis_ ne portent, mesuré, que des listes à puces');

    const { document: doc4 } = diagnostiquer('--diagnostic', path.join(CORPUS_LOT_A, nom4));
    const listes4 = collecterListes(doc4);
    total += listes4.length;
    const formats4 = new Set(listes4.map((l) => l[2]));
    assert.ok(formats4.has('puce'), '4_ doit porter au moins une liste à puces (mesuré)');
    assert.ok(formats4.has('numero'), '4_ doit porter au moins une liste numérotée (mesuré)');
    assert.ok(!formats4.has(''), '4_ ne doit avoir aucune liste de format non déterminé');

    assert.strictEqual(total, 20,
      'mesure figée le 18.09.2026 : 20 paragraphes de liste au total sur ces trois manuscrits');
  });
