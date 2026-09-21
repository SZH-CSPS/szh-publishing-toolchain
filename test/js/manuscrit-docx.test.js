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
const { PYTHON, sansPython, sauter } = require('./gardes');

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
//   endnotes    : XML brut des w:endnote (déjà formés), optionnel (ajouté le 19.09.2026) ;
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
  '    if spec.get("endnotes"):',
  '        # Ajouté le 19.09.2026 (§4 du contrat, notes de fin) — purement additif, sur le',
  '        # même patron que "footnotes" ci-dessus.',
  '        en = (',
  '            \'<?xml version="1.0" encoding="UTF-8"?><w:endnotes xmlns:w="%s">%s\'',
  '            \'</w:endnotes>\' % (W, spec["endnotes"]))',
  '        z.writestr("word/endnotes.xml", en.encode("utf-8"))',
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
// Chiffres révisés le 19.09.2026 : ce fichier réel porte 21 médias DISTINCTS, pas 16 — 5 de
// plus, récupérés depuis les mc:Fallback VML de 4 de ses 10 ancrages flottants (voir le
// contrôle suivant). Mesuré : ces 5 médias (rId20-24) sont référencés IDENTIQUEMENT par les 4
// ancrages (le même groupe de 5 photos redit 4 fois, une structure réelle de ce fichier, pas
// un artefact de comptage — vérifié XML en main) : 16 images modernes + 5 images VML × 4
// occurrences = 36 Image rendues au total, mais 21 noms de fichier distincts.
//
// Sabotage minimal : ajouter `return 0, 0` en toute première ligne de _dimensions_image() —
// toutes les images du document, y compris ces 36, rendraient 0,0.

test('manuscrit_docx.py --images : le corpus réel (lot-A/4_*.docx) rend 36 occurrences pour 21 médias distincts, toutes avec des dimensions en pixels non nulles',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A)
      .filter((n) => n.startsWith('4_') && n.toLowerCase().endsWith('.docx'));
    if (fichiers.length === 0) {
      t.skip('corpus hors dépôt absent : aucun fichier "4_*.docx" dans lot-A');
      return;
    }
    const chemin = path.join(CORPUS_LOT_A, fichiers[0]);
    const r = python([MANUSCRIT_DOCX, '--images', chemin]);
    assert.strictEqual(r.status, 0, '--images a échoué sur ' + chemin + ' : ' + r.stderr);
    const images = JSON.parse(r.stdout);
    assert.strictEqual(images.length, 36,
      'ce fichier réel rend 36 occurrences d\'image (16 modernes + 5 VML récupérées x 4 '
      + 'ancrages, mesuré le 19.09.2026)');
    const noms = new Set(images.map((img) => img.nom));
    assert.strictEqual(noms.size, 21, 'ces 36 occurrences pointent vers 21 médias distincts');
    const sansDimensions = images.filter((img) => img.largeur_px === 0 || img.hauteur_px === 0);
    assert.deepStrictEqual(sansDimensions.map((img) => img.nom), [],
      'toutes les images incorporées de ce fichier réel, modernes ou VML récupérées, doivent '
      + 'avoir des dimensions en pixels non nulles');
  });

// ---------------------------------------------------------------------------------
// Contrôle réécrit le 19.09.2026 (revue de chantier) : compter les OCCURRENCES de
// v:imagedata (comme avant cette date) surcomptait d'un facteur mesuré de 5 sur lot-A/4_La
// méthode Flip Flap.docx (un même r:id peut être répété plusieurs fois dans un même groupe).
// Ce lecteur compte désormais les r:id DISTINCTS, et RÉCUPÈRE les images correspondantes
// (5 des 21 médias de ce fichier réel n'apparaissaient dans AUCUNE sortie avant cette
// révision) plutôt que de se contenter de les compter comme perdues.
//
// Sabotage minimal : dans _images_depuis_vml(), retirer la ligne `if rid and rid in vus:
// continue` (le dédoublonnage) — la seconde des deux assertions ci-dessous (rId répété deux
// fois ne donne qu'UNE image) rougit : deux Image identiques seraient rendues.

test('manuscrit_docx.py --diagnostic : un w:pict groupant 2 images VML DISTINCTES les récupère toutes les deux',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const octets1 = fabriquerPng(30, 20);
      const octets2 = fabriquerPng(40, 25);
      const corps =
        '<w:p><w:r><w:pict><v:group>' +
        '<v:shape><v:imagedata r:id="rId1"/></v:shape>' +
        '<v:shape><v:imagedata r:id="rId2"/></v:shape>' +
        '</v:group></w:pict></w:r></w:p>';
      fabriquerDocx(docx, {
        corps,
        media: { 'image1.png': octets1.toString('base64'), 'image2.png': octets2.toString('base64') },
        rels: [['rId1', 'media/image1.png'], ['rId2', 'media/image2.png']]
      });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      assert.ok(!/images-vml-ignorees/.test(r.stderr),
        'les deux images sont récupérées : aucune ne doit rester "ignorée". stderr obtenu : '
        + r.stderr);
      const { document } = JSON.parse(r.stdout.trim().split('\n').pop());
      const images = document.blocs[0].fragments.filter((f) => f.image).map((f) => f.image);
      assert.strictEqual(images.length, 2, 'les 2 images VML distinctes doivent être récupérées');
      const parNom = Object.fromEntries(images.map((img) => [img.nom, img]));
      assert.strictEqual(parNom['image1.png'].largeur_px, 30);
      assert.strictEqual(parNom['image2.png'].largeur_px, 40);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit_docx.py --diagnostic : un w:pict qui référence deux fois le MÊME r:id ne récupère l\'image qu\'une fois',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const octets = fabriquerPng(50, 60);
      const corps =
        '<w:p><w:r><w:pict><v:group>' +
        '<v:shape><v:imagedata r:id="rId1"/></v:shape>' +
        '<v:shape><v:imagedata r:id="rId1"/></v:shape>' +
        '</v:group></w:pict></w:r></w:p>';
      fabriquerDocx(docx, {
        corps,
        media: { 'image1.png': octets.toString('base64') },
        rels: [['rId1', 'media/image1.png']]
      });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      const { document } = JSON.parse(r.stdout.trim().split('\n').pop());
      const images = document.blocs[0].fragments.filter((f) => f.image).map((f) => f.image);
      assert.strictEqual(images.length, 1,
        'le même r:id répété deux fois dans le même groupe est UNE seule image, pas deux');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Régression : un w:pict SANS AUCUNE image (pure forme vectorielle héritée — rectangle,
// connecteur…) doit toujours être compté 1 fois dans 'images-vml-ignorees', jamais 0 (rien ne
// doit disparaître du décompte) et jamais récupéré (rien à récupérer).
//
// Sabotage minimal : dans _images_depuis_vml(), remplacer `if not trouve_imagedata:
// recensement['image_vml_ignoree'] += 1` par `pass` — l'avertissement ne apparaît plus du
// tout, l'assertion ci-dessous rougit.

test('manuscrit_docx.py --diagnostic : un w:pict sans aucune image reste compté comme ignoré, jamais 0',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps = '<w:p><w:r><w:pict><v:rect/></w:pict></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      assert.ok(
        /\[import-avertissement\] images-vml-ignorees \| article \| occurrences 1 \|/.test(r.stderr),
        'une pure forme vectorielle héritée doit compter pour 1 forme ignorée. stderr obtenu : '
        + r.stderr);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle du 18.09.2026 (revue adverse, défaut trouvé par recoupement direct sur
// lot-A/4_La méthode Flip Flap.docx, PAS par sabotage), RÉÉCRIT le 19.09.2026 pour vérifier la
// RÉCUPÉRATION et non plus seulement le comptage — _enfants_utiles() ne regarde que la branche
// mc:Choice d'un mc:AlternateContent, pour ne pas compter deux fois LA MÊME forme redite en
// VML dans mc:Fallback (voir le point 2 de l'en-tête du module). Mais sur ce fichier réel, 4
// des 10 ancrages flottants ont une branche Choice qui est un pur groupe de formes SANS image
// (recensé, correctement, en 'forme_vectorielle_ignoree') — et une branche Fallback qui, elle,
// porte un VRAI groupe d'images embarquées (<v:imagedata>). Avant la toute première correction,
// ces images n'apparaissaient dans AUCUN recensement ; avant celle du 19.09.2026, elles étaient
// comptées comme "ignorées" sans être RÉCUPÉRÉES.
//
// Sabotage minimal : dans _images_du_repli_fantome(), retirer l'appel à _images_depuis_vml()
// (ou son corps) — les 2 images du Fallback disparaissent de la sortie ET l'avertissement
// 'images-vml-ignorees' cesse d'apparaître pour une raison différente (rien à ignorer non
// plus) : la première assertion (2 images récupérées) rougit dans les deux cas.

test('manuscrit_docx.py --diagnostic : les vraies images d\'un mc:Fallback sont RÉCUPÉRÉES, pas seulement comptées, même quand le Choice n\'a aucune image',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const octets1 = fabriquerPng(12, 18);
      const octets2 = fabriquerPng(22, 28);
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
        '<v:shape><v:imagedata r:id="rId1"/></v:shape>' +
        '<v:shape><v:imagedata r:id="rId2"/></v:shape>' +
        '</v:group></w:pict>' +
        '</mc:Fallback>' +
        '</mc:AlternateContent></w:r></w:p>';
      fabriquerDocx(docx, {
        corps,
        media: { 'image1.png': octets1.toString('base64'), 'image2.png': octets2.toString('base64') },
        rels: [['rId1', 'media/image1.png'], ['rId2', 'media/image2.png']]
      });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      const { document } = JSON.parse(r.stdout.trim().split('\n').pop());
      const images = document.blocs[0].fragments.filter((f) => f.image).map((f) => f.image);
      assert.strictEqual(images.length, 2,
        'les 2 images du Fallback doivent être RÉCUPÉRÉES, alors même que le Choice n\'en a '
        + 'aucune');
      const parNom = Object.fromEntries(images.map((img) => [img.nom, img]));
      assert.strictEqual(parNom['image1.png'].largeur_px, 12);
      assert.strictEqual(parNom['image2.png'].largeur_px, 22);
      assert.ok(!/images-vml-ignorees/.test(r.stderr),
        'les deux images étant récupérées, elles ne doivent plus être comptées comme '
        + '"ignorées". stderr obtenu : ' + r.stderr);
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
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
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
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
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

// ===================================================================================
// Contrôles ajoutés le 19.09.2026 (revue de chantier) — un par défaut du relevé, chacun
// prouvé par un sabotage minimal décrit dans son commentaire (rejoué à la main, voir le
// rapport de chantier pour le tableau sabotage -> rouge/vert).

// ---------------------------------------------------------------------------------
// Les tirets ne sont plus détruits à la lecture (défaut n°1) : cadratin, demi-cadratin ET
// trait d'union insécable (w:noBreakHyphen) doivent tous trois traverser _texte_depuis_enfants
// intacts — jamais réduits à un simple '-'.
//
// Sabotage minimal : dans _texte_depuis_enfants(), remplacer
// `morceaux.append('‑')` par `morceaux.append('-')` pour noBreakHyphen, ET réintroduire
// une boucle `for a, b in (('–', '-'), ('—', '-'), ('‑', '-')):
// t = t.replace(a, b)` avant le `return`. Les trois assertions ci-dessous rougissent.

test('manuscrit_docx.py --diagnostic : cadratin, demi-cadratin et trait d\'union insécable traversent la lecture intacts',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">pp. 12–25 (cadratin—ici)</w:t></w:r>' +
        '<w:r><w:t>avant</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:t>apres</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const texte = document.blocs[0].fragments.map((f) => f.texte).join('');
      assert.ok(texte.includes('–'), 'le demi-cadratin (–) doit survivre tel quel');
      assert.ok(texte.includes('—'), 'le cadratin (—) doit survivre tel quel');
      assert.ok(texte.includes('avant‑apres'),
        'w:noBreakHyphen doit rendre le VRAI trait d\'union insécable (U+2011), jamais un '
        + 'simple trait d\'union');
      assert.ok(!texte.includes('avant-apres'),
        'le trait d\'union insécable ne doit jamais être dégradé en trait d\'union banal');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// w:tab et w:br rendent désormais de VRAIS caractères ('\t' / '\n'), plus une simple espace
// (défaut n°8c — condition pour que nettoyer_mise_en_forme() puisse un jour les nettoyer pour
// de vrai). projeter_pronto() reste inchangé malgré ça (contrôle n°7 plus haut) : normaliser()
// traite '\t'/'\n' comme un blanc, exactement comme l'espace qu'ils remplaçaient avant.
//
// Sabotage minimal : dans _texte_depuis_enfants(), remplacer les deux branches w:tab/w:br par
// `elif e.tag in (W + 'tab', W + 'br', W + 'cr'): morceaux.append(' ')` (l'ancien comportement)
// — les deux assertions ci-dessous rougissent.

test('manuscrit_docx.py --diagnostic : w:tab rend une vraie tabulation, w:br un vrai saut de ligne, jamais une simple espace',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Avant</w:t></w:r><w:r><w:tab/></w:r>' +
        '<w:r><w:t xml:space="preserve">Apres</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t xml:space="preserve">Ligne1</w:t></w:r><w:r><w:br/></w:r>' +
        '<w:r><w:t xml:space="preserve">Ligne2</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const t0 = document.blocs[0].fragments.map((f) => f.texte).join('');
      const t1 = document.blocs[1].fragments.map((f) => f.texte).join('');
      assert.strictEqual(t0, 'Avant\tApres', 'w:tab doit rendre une vraie tabulation');
      assert.strictEqual(t1, 'Ligne1\nLigne2', 'w:br doit rendre un vrai saut de ligne');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// w:sym (Insertion > Symbole, défaut n°2) : une puce Wingdings/Symbol courante (U+F0B7) est
// convertie en puce Unicode réelle ; tout autre caractère d'une police à correspondance
// spéciale est rendu tel quel ET signalé (jamais un silence total sur un caractère visible).
//
// Sabotage minimal : dans _rendu_sym(), remplacer tout le corps par `return ''` — les deux
// assertions de texte rougissent (plus rien n'apparaît du tout), ET l'avertissement
// 'symboles-police-speciale' disparaît (rien à signaler si rien n'est jamais rendu).

test('manuscrit_docx.py --diagnostic : w:sym rend la puce Wingdings usuelle en Unicode, et signale le reste sans le taire',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Avant </w:t></w:r>' +
        '<w:r><w:sym w:font="Wingdings" w:char="F0B7"/></w:r>' +
        '<w:r><w:t xml:space="preserve"> Apres</w:t></w:r></w:p>' +
        '<w:p><w:r><w:sym w:font="Wingdings" w:char="F0C8"/></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      const { document } = JSON.parse(r.stdout.trim().split('\n').pop());
      const t0 = document.blocs[0].fragments.map((f) => f.texte).join('');
      assert.strictEqual(t0, 'Avant • Apres',
        'U+F0B7 en police Wingdings doit devenir la puce Unicode réelle (•)');
      const t1 = document.blocs[1].fragments.map((f) => f.texte).join('');
      assert.strictEqual(t1, '',
        'un autre caractère Wingdings, sans correspondance connue, est repris tel quel');
      assert.ok(
        /\[import-avertissement\] symboles-police-speciale \| article \| occurrences 1 \|/
          .test(r.stderr),
        'le caractère non mappé doit être signalé, jamais en silence. stderr obtenu : '
        + r.stderr);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// w:fldSimple (défaut n°2/n°5 de l'en-tête) : sa valeur affichée, mise en cache par Word dans
// un w:r ordinaire enfant, doit être lue comme du texte normal — l'avertissement
// 'champs-word-non-resolus' l'affirmait déjà avant cette correction, à tort.
//
// Sabotage minimal : retirer `W + 'fldSimple'` de _CONTENEURS_PASSE_PLAT — le texte
// « 3 » du champ disparaît de la lecture (le paragraphe ne rend plus que « Page  sur 10 »).

test('manuscrit_docx.py --diagnostic : la valeur mise en cache d\'un w:fldSimple est lue comme du texte normal',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r>' +
        '<w:fldSimple w:instr="PAGE"><w:r><w:t>3</w:t></w:r></w:fldSimple>' +
        '<w:r><w:t xml:space="preserve"> sur 10</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const texte = document.blocs[0].fragments.map((f) => f.texte).join('');
      assert.strictEqual(texte, 'Page 3 sur 10',
        'la valeur en cache du champ (« 3 ») doit apparaître dans le texte lu');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// w:sdt de niveau BLOC (défaut n°2/n°5 de l'en-tête) : un contrôle de contenu enveloppant un
// w:p ENTIER, enfant direct du corps, ne doit plus faire disparaître ce paragraphe.
//
// Sabotage minimal : dans _deplier_sdt_niveau_bloc(), remplacer le corps de la fonction par
// `return container` (rien à déplier) — le paragraphe encapsulé disparaît de document.blocs.

test('manuscrit_docx.py --diagnostic : un w:sdt de niveau bloc ne fait plus disparaître le paragraphe qu\'il enveloppe',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Avant le controle</w:t></w:r></w:p>' +
        '<w:sdt><w:sdtPr/><w:sdtContent>' +
        '<w:p><w:r><w:t xml:space="preserve">Dans le controle de contenu</w:t></w:r></w:p>' +
        '</w:sdtContent></w:sdt>' +
        '<w:p><w:r><w:t xml:space="preserve">Apres le controle</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      const textes = document.blocs.map((b) => b.fragments.map((f) => f.texte).join(''));
      assert.deepStrictEqual(textes,
        ['Avant le controle', 'Dans le controle de contenu', 'Apres le controle'],
        'les trois paragraphes doivent apparaître, y compris celui enveloppé par le sdt');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Notes de bas de page ET de fin, cohabitation sans collision d'identifiant (défaut n°2/n°5,
// §4 du contrat) : Document.notes devient dict{id: contenu} ; une note de fin reçoit son
// identifiant brut PLUS le plus grand identifiant de footnote (ici 2), jamais le même que la
// footnote 1 ou 2.
//
// Sabotage minimal : dans lire(), remplacer `decalage=decalage` par `decalage=0` sur l'appel à
// _notes_depuis_racine() pour les endnotes — la note de fin (id brut 1) écrase alors la
// footnote 1 dans le dict : il n'en reste plus que 2 clés au lieu de 3.

test('manuscrit_docx.py --diagnostic : notes de bas de page et de fin cohabitent, la note de fin reçoit un identifiant décalé',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Appel un</w:t></w:r>' +
        '<w:r><w:rPr/><w:footnoteReference w:id="1"/></w:r>' +
        '<w:r><w:t xml:space="preserve"> et deux</w:t></w:r>' +
        '<w:r><w:rPr/><w:footnoteReference w:id="2"/></w:r>' +
        '<w:r><w:t xml:space="preserve"> et une fin</w:t></w:r>' +
        '<w:r><w:rPr/><w:endnoteReference w:id="1"/></w:r></w:p>';
      const footnotes =
        '<w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">Contenu footnote un</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="2"><w:p><w:r><w:t xml:space="preserve">Contenu footnote deux</w:t></w:r></w:p></w:footnote>';
      fabriquerDocx(docx, { corps, footnotes, endnotes: '<w:endnote w:id="1"><w:p>'
        + '<w:r><w:t xml:space="preserve">Contenu endnote un</w:t></w:r></w:p></w:endnote>' });
      const { document } = diagnostiquer('--diagnostic', docx);
      const cles = Object.keys(document.notes).map(Number).sort((a, b) => a - b);
      assert.deepStrictEqual(cles, [1, 2, 3],
        'footnote 1, footnote 2, et endnote 1 décalée à 1+2=3 : trois clés distinctes, '
        + 'jamais de collision');
      assert.strictEqual(document.notes['3'][0].fragments[0].texte, 'Contenu endnote un',
        'la note d\'identifiant final 3 doit être le contenu de l\'endnote, pas une footnote');
      const fragments = document.blocs[0].fragments;
      const idsAppeles = fragments.filter((f) => f.note !== null).map((f) => f.note);
      assert.deepStrictEqual(idsAppeles.sort((a, b) => a - b), [1, 2, 3],
        'les trois appels de note (deux footnoteReference, un endnoteReference décalé) '
        + 'doivent apparaître dans les fragments du paragraphe qui les porte');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Notes ORPHELINES (ajout du superviseur, 19.09.2026, sur mesure de l'agent de l'écrivain) :
// une note présente dans footnotes.xml mais qu'AUCUN w:footnoteReference n'appelle dans
// document.xml n'est pas une vraie note de ce document. Mesuré : 1bis, 2-dense, 2-grappes et
// 5bis portaient chacun une note technique 'continuationNotice' orpheline (aucun renvoi) —
// document.notes doit désormais y être vide sur ces quatre fichiers réels ; ce contrôle-ci
// prouve le mécanisme GÉNÉRAL (pas seulement le filtre par type) avec une note ORDINAIRE
// jamais appelée.
//
// Sabotage minimal : dans lire(), remplacer `notes = {i: c for i, c in notes.items() if i in
// ids_appelees}` par `pass` (ne rien filtrer) — la note orpheline (id 5) réapparaît dans
// document.notes, la première assertion rougit.

test('manuscrit_docx.py --diagnostic : une note jamais appelée par un renvoi (footnoteReference) est retirée, signalée',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Un appel</w:t></w:r>' +
        '<w:r><w:rPr/><w:footnoteReference w:id="1"/></w:r></w:p>';
      const footnotes =
        '<w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">Contenu appele</w:t></w:r></w:p></w:footnote>' +
        '<w:footnote w:id="5"><w:p><w:r><w:t xml:space="preserve">Contenu jamais appele</w:t></w:r></w:p></w:footnote>';
      fabriquerDocx(docx, { corps, footnotes });
      const r = python([MANUSCRIT_DOCX, '--diagnostic', docx]);
      assert.strictEqual(r.status, 0, '--diagnostic a échoué : ' + r.stderr);
      const { document } = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.deepStrictEqual(Object.keys(document.notes), ['1'],
        'seule la note 1 (appelée) doit rester ; la note 5 (jamais appelée) doit disparaître');
      assert.ok(
        /\[import-avertissement\] notes-orphelines \| article \| occurrences 1 \|/.test(r.stderr),
        'la note orpheline retirée doit être signalée, jamais en silence. stderr obtenu : '
        + r.stderr);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Régression sur le corpus réel (défaut n°2/n°5) : 2-fin-de-document_Article_RSPS.docx porte
// 12 footnotes réelles (word/endnotes.xml, lui, est absent de ce fichier précis — mesuré le
// 19.09.2026 : le nom du fichier trompe, ce sont bien des NOTES DE BAS DE PAGE ici). Avant
// cette révision, Document.notes existait déjà pour les footnotes (elles n'étaient pas
// « jamais lues ») mais en LISTE PLATE, sans savoir laquelle appelle quoi ; ce contrôle fige
// la nouvelle forme (dict par identifiant) sur un fichier réel.
//
// Sabotage minimal : dans lire(), remplacer l'appel à _notes_depuis_racine() pour les
// footnotes par `notes = {}` — la clé 'notes' rend un dict vide, l'assertion rougit (12 -> 0).

test('manuscrit_docx.py --diagnostic : sur le corpus réel, 2-fin-de-document_Article_RSPS.docx porte 12 notes distinctes',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const nom = fs.readdirSync(CORPUS_LOT_A).find((n) => n.startsWith('2-fin'));
    if (!nom) {
      t.skip('corpus hors dépôt absent : aucun fichier "2-fin*.docx" dans lot-A');
      return;
    }
    const { document } = diagnostiquer('--diagnostic', path.join(CORPUS_LOT_A, nom));
    assert.strictEqual(Object.keys(document.notes).length, 12,
      'mesuré le 19.09.2026 : 12 notes distinctes sur ce fichier réel (0 avant cette révision '
      + 'si la lecture des notes était coupée)');
  });

// Ajout du superviseur (19.09.2026, sur mesure de l'agent de l'écrivain) : 1bis, 2-dense,
// 2-grappes et 5bis portent chacun, dans footnotes.xml ET endnotes.xml, une note de type
// 'continuationNotice' SANS AUCUN renvoi correspondant dans document.xml — des notes
// fantômes. Sur ces quatre fichiers réels, document.notes doit être vide.
//
// ⚠ Ce contrôle exerce en réalité le filtre ORPHELINES GÉNÉRAL (voir le contrôle précédent),
// pas spécifiquement l'ajout de 'continuationNotice' à _TYPES_NOTE_TECHNIQUES : vérifié par
// sabotage (retirer 'continuationNotice' de la liste, SANS toucher au filtre orphelines) —
// ce contrôle-ci reste VERT, parce qu'une note 'continuationNotice' n'est de toute façon
// jamais appelée par un renvoi et se fait retirer par le filtre général. L'entrée dans
// _TYPES_NOTE_TECHNIQUES reste utile en documentation et en défense en profondeur (si le
// filtre général devait un jour changer de forme), mais n'est plus, à elle seule, ce qui fait
// ce test. Le contrôle qui, lui, exerce VRAIMENT le filtre général avec une note ORDINAIRE
// (jamais technique) est celui juste au-dessus.

test('manuscrit_docx.py --diagnostic : sur le corpus réel, 1bis/2-dense/2-grappes/5bis n\'ont AUCUNE vraie note (continuationNotice fantôme)',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    for (const prefixe of ['1bis', '2-dense', '2-grappes', '5bis']) {
      const nom = fs.readdirSync(CORPUS_LOT_A).find((n) => n.startsWith(prefixe));
      if (!nom) {
        t.skip('corpus hors dépôt absent : fichier "' + prefixe + '*.docx" dans lot-A');
        continue;
      }
      const { document } = diagnostiquer('--diagnostic', path.join(CORPUS_LOT_A, nom));
      assert.strictEqual(Object.keys(document.notes).length, 0,
        'mesuré le 19.09.2026 : ' + nom + ' ne porte aucune vraie note (seulement une '
        + 'continuationNotice fantôme, jamais appelée)');
    }
  });

// ---------------------------------------------------------------------------------
// Régression hyperliens sur le corpus réel — non touché par ce chantier, mais couvert ici
// faute de l'être ailleurs (§11 : un mécanisme sans le moindre contrôle n'est pas prouvé).
//
// Sabotage minimal : dans _resoudre_lien_hyperlink(), `return None` en première ligne — les
// 24 liens de ce fichier réel disparaissent tous, l'assertion rougit (24 -> 0).

test('manuscrit_docx.py --diagnostic : sur le corpus réel, 5bis_...BEP.docx porte 24 hyperliens',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const nom = fs.readdirSync(CORPUS_LOT_A).find((n) => n.startsWith('5bis'));
    if (!nom) {
      t.skip('corpus hors dépôt absent : aucun fichier "5bis*.docx" dans lot-A');
      return;
    }
    const { document } = diagnostiquer('--diagnostic', path.join(CORPUS_LOT_A, nom));
    let liens = 0;
    (function creuser(blocs) {
      for (const b of blocs) {
        if (b.type === 'tableau') {
          for (const rangee of b.rangees) { for (const c of rangee) creuser(c.blocs); }
        } else {
          for (const f of b.fragments) { if (f.lien) liens++; }
        }
      }
    })(document.blocs);
    assert.strictEqual(liens, 24, 'mesuré le 19.09.2026 : 24 hyperliens sur ce fichier réel');
  });

// ---------------------------------------------------------------------------------
// numId="0" signifie « pas de liste », jamais une liste de format indéterminé (défaut n°5).
//
// Sabotage minimal : dans _liste_depuis(), retirer la clause `if numid_brut == '0': return
// None` — le paragraphe rendrait [0, 0, ''] au lieu de null.

test('manuscrit_docx.py --diagnostic : numId="0" rend liste=null, jamais une liste de format indéterminé',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr>'
        + '<w:r><w:t xml:space="preserve">numerotation explicitement retiree</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps });
      const { document } = diagnostiquer('--diagnostic', docx);
      assert.strictEqual(document.blocs[0].liste, null,
        'numId="0" doit rendre null : "pas de liste", jamais un format indéterminé');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Un numPr HÉRITÉ D'UN STYLE (jamais posé directement sur le paragraphe) doit résoudre la
// liste — défaut n°4 : une autrice qui applique un style de liste sans reposer numPr sur
// chaque paragraphe voyait sa liste disparaître.
//
// Sabotage minimal : dans _liste_depuis(), retirer les deux lignes qui appellent
// _numpr_depuis_style() en repli — le paragraphe rendrait liste=null au lieu de [7, 0, 'puce'].

test('manuscrit_docx.py --diagnostic : un numPr hérité du STYLE (jamais posé sur le paragraphe) résout la liste',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const numbering =
        '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/>'
        + '<w:lvlText w:val="•"/></w:lvl></w:abstractNum>'
        + '<w:num w:numId="7"><w:abstractNumId w:val="0"/></w:num>';
      const corps =
        '<w:p><w:pPr><w:pStyle w:val="ListeStyle"/></w:pPr>'
        + '<w:r><w:t xml:space="preserve">item sans numPr direct</w:t></w:r></w:p>';
      fabriquerDocx(docx, {
        corps, numbering,
        styles: [['ListeStyle', 'Liste a puces maison']]
      });
      // fabriquerDocx() n'a pas de clé dédiée pour le pPr d'un style : on l'écrit ici en
      // réouvrant l'archive, plus simple que d'étendre FABRIQUE pour ce seul contrôle.
      const patch = [
        'import re, zipfile, sys',
        'chemin = sys.argv[1]',
        'with zipfile.ZipFile(chemin) as z:',
        '    noms = {n: z.read(n) for n in z.namelist()}',
        'styles = noms["word/styles.xml"].decode("utf-8")',
        'ppr = (\'<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr>\')',
        'styles = styles.replace(\'<w:name w:val="Liste a puces maison"/></w:style>\',',
        '                        \'<w:name w:val="Liste a puces maison"/>\' + ppr + \'</w:style>\')',
        'noms["word/styles.xml"] = styles.encode("utf-8")',
        'with zipfile.ZipFile(chemin, "w") as z:',
        '    for n, d in noms.items():',
        '        z.writestr(n, d)'
      ].join('\n');
      const rp = python(['-c', patch, docx]);
      assert.strictEqual(rp.status, 0, 'patch du styles.xml impossible : ' + rp.stderr);
      const { document } = diagnostiquer('--diagnostic', docx);
      assert.deepStrictEqual(document.blocs[0].liste, [7, 0, 'puce'],
        'le numPr du STYLE (jamais posé sur le paragraphe lui-même) doit résoudre la liste');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Image.source porte l'indice du PARAGRAPHE porteur dans le corps, jamais celui du w:r
// (défaut n°3) : l'image est le PREMIER run (indice 0) du TROISIÈME paragraphe (indice 2) —
// run-index et paragraphe-index divergent délibérément, pour qu'une confusion entre les deux
// se voie (un premier jet de ce contrôle, où l'image était le second run d'un paragraphe
// d'indice 1, laissait le sabotage vert par coïncidence : 1 == 1).
//
// Sabotage minimal : dans _fragments_de_run(), remplacer `img.source = indice_paragraphe` par
// `img.source = indice` — l'image rendrait source=0 (l'indice de son run, puisqu'elle est le
// PREMIER run de son paragraphe), pas 2 (l'indice de son paragraphe dans le corps).

test('manuscrit_docx.py --diagnostic : Image.source porte l\'indice du paragraphe porteur, jamais celui du run',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const drawing =
        '<w:drawing><wp:inline><wp:extent cx="100" cy="100"/><wp:docPr descr="alt"/>'
        + '<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/>'
        + '</pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
      const corps =
        '<w:p><w:r><w:t xml:space="preserve">Premier paragraphe sans image.</w:t></w:r></w:p>'
        + '<w:p><w:r><w:t xml:space="preserve">Second paragraphe sans image non plus.</w:t></w:r></w:p>'
        + '<w:p><w:r>' + drawing + '</w:r>'
        + '<w:r><w:t xml:space="preserve"> texte apres l\'image</w:t></w:r></w:p>';
      fabriquerDocx(docx, {
        corps,
        media: { 'image1.png': fabriquerPng(5, 5).toString('base64') },
        rels: [['rId1', 'media/image1.png']]
      });
      const { document } = diagnostiquer('--diagnostic', docx);
      const img = document.blocs[2].fragments.find((f) => f.image).image;
      assert.strictEqual(img.source, 2,
        'l\'image est dans le troisième paragraphe (indice 2 dans le corps) : Image.source '
        + 'doit valoir 2, jamais l\'indice de son run (0, puisqu\'elle est le premier run de '
        + 'ce paragraphe)');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Fragment.effectif (§4 du contrat, défaut listé) : directe sinon style de caractère sinon
// chaîne des styles de paragraphe sinon docDefaults. Un run SANS mise en forme directe, dont
// le style de PARAGRAPHE porte le gras, doit voir `forme.gras` rester None (jamais deviné)
// alors que `effectif.gras` vaut True.
//
// Sabotage minimal : dans _forme_effective(), `return dict(forme_directe)` en première ligne
// (jamais consulter aucun style) — `effectif.gras` resterait None comme `forme.gras`.

test('manuscrit_docx.py --diagnostic : Fragment.effectif remonte le gras du style de paragraphe, forme reste None',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'essai.docx');
      const corps =
        '<w:p><w:pPr><w:pStyle w:val="TitreGras"/></w:pPr>'
        + '<w:r><w:t xml:space="preserve">Texte sans mise en forme directe</w:t></w:r></w:p>';
      fabriquerDocx(docx, { corps, styles: [['TitreGras', 'Titre gras maison']] });
      const patch = [
        'import zipfile, sys',
        'chemin = sys.argv[1]',
        'with zipfile.ZipFile(chemin) as z:',
        '    noms = {n: z.read(n) for n in z.namelist()}',
        'styles = noms["word/styles.xml"].decode("utf-8")',
        'rpr = "<w:rPr><w:b/></w:rPr>"',
        'styles = styles.replace(\'<w:name w:val="Titre gras maison"/></w:style>\',',
        '                        \'<w:name w:val="Titre gras maison"/>\' + rpr + \'</w:style>\')',
        'noms["word/styles.xml"] = styles.encode("utf-8")',
        'with zipfile.ZipFile(chemin, "w") as z:',
        '    for n, d in noms.items(): z.writestr(n, d)'
      ].join('\n');
      const rp = python(['-c', patch, docx]);
      assert.strictEqual(rp.status, 0, 'patch du styles.xml impossible : ' + rp.stderr);
      const { document } = diagnostiquer('--diagnostic', docx);
      const f = document.blocs[0].fragments[0];
      assert.strictEqual(f.forme.gras, null,
        '`forme` reste la mise en forme DIRECTE : aucun w:b sur ce run, donc None');
      assert.strictEqual(f.effectif.gras, true,
        '`effectif` doit remonter le gras déclaré par le style de paragraphe');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
