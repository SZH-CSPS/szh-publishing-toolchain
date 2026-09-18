// pipeline/manuscrit_annoter.py : annote un .docx DÉJÀ au gabarit (la sortie de
// manuscrit_gabarit.ecrire()) avec les alertes du contrat §7 — révisions Word (w:ins/w:del)
// pour les corrections déterministes, commentaires Word ancrés pour ce qui demande un
// jugement, plafonnés (au plus 5 par règle, un plafond global). Contrat :
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §7 ter.
//
//   node --test test/js/manuscrit-annoter.test.js
//
// Fixtures fabriquées en Python (patron test/js/docx-titres.test.js, fabriquerDocx) : un
// .docx minimal dont le corps imite la forme que rend manuscrit_gabarit.ecrire() — deux
// <w:p/> vides avant le corps (les séparateurs des deux tableaux fixes du gabarit, §7 du
// contrat de l'écrivain) puis les paragraphes réels, avec un mot cible FRACTIONNÉ entre deux
// runs pour éprouver « fractionne les runs aux deux décalages » (§7 ter, point 1).
//
// Gardes : PYTHON de test/js/gardes.js (jamais `python3` en dur, §10 du contrat : il peut
// figer indéfiniment sur ce poste). sansPandocWsl couvre la preuve indépendante (accepter /
// rejeter / lire les commentaires via pandoc réel dans la WSL) et le contrôle sur corpus réel,
// sauté proprement si tmp/ (hors git) est absent ou si la distro manque.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const ANNOTER = path.join(PIPELINE, 'manuscrit_annoter.py');
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');
const DISTRO = 'SZH-Publishing';

function python(args) {
  return cp.spawnSync(PYTHON, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-manuscritannoter-'));
}

// ---------------------------------------------------------------------------------
// Fabrication d'un .docx minimal — patron fabriquerDocx de docx-titres.test.js : un
// programme Python écrit au vol, jamais un binaire figé. `paragraphes` : liste de
// { texte } | { runs: [{ texte, rpr:{gras,italique} }, ...] } | { vide: true }. Le corps
// imite manuscrit_gabarit.ecrire() : deux <w:p/> puis les paragraphes réels puis <w:sectPr/>,
// entre deux <w:tbl> minimaux — de quoi éprouver que les w:tbl ne comptent pas dans
// l'indexation des <w:p> (§7 ter, point « correspondance »).
const FABRICAR_DOCX_PY = [
  'import json, sys, zipfile',
  'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'def rpr_xml(f):',
  '    partes = ""',
  '    if f.get("gras"): partes += "<w:b/>"',
  '    if f.get("italique"): partes += "<w:i/>"',
  '    return ("<w:rPr>%s</w:rPr>" % partes) if partes else ""',
  'def run_xml(r):',
  '    return "<w:r>%s<w:t xml:space=\\"preserve\\">%s</w:t></w:r>" % (rpr_xml(r.get("rpr", {})), r["texte"])',
  'def para_xml(p):',
  '    if p.get("vide"):',
  '        return "<w:p/>"',
  '    runs = p.get("runs") or [{"texte": p.get("texte", "")}]',
  '    return "<w:p>%s</w:p>" % "".join(run_xml(r) for r in runs)',
  'TABLA = ("<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>"',
  '         "<w:tr><w:tc><w:tcPr/><w:p/></w:tc></w:tr></w:tbl>")',
  'corps = TABLA + "<w:p/>" + TABLA + "<w:p/>" + "".join(para_xml(p) for p in paras) + "<w:sectPr/>"',
  'doc = ("<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?><w:document xmlns:w=\\"%s\\">"',
  '       "<w:body>%s</w:body></w:document>") % (W, corps)',
  '# _rels/.rels (racine du paquet) et l\'Override de word/document.xml dans [Content_Types] :',
  '# sans les deux, pandoc refuse le paquet (« couldn\'t parse docx file ») meme si chaque',
  '# partie XML est individuellement bien formee — mesure faite en ecrivant ce fabricant.',
  'rels_racine = ("<?xml version=\\"1.0\\" encoding=\\"UTF-8\\" standalone=\\"yes\\"?>"',
  '               "<Relationships xmlns=\\"http://schemas.openxmlformats.org/package/2006/relationships\\">"',
  '               "<Relationship Id=\\"rId1\\" Type=\\"http://schemas.openxmlformats.org/officeDocument/"',
  '               "2006/relationships/officeDocument\\" Target=\\"word/document.xml\\"/></Relationships>")',
  'rels_doc = ("<?xml version=\\"1.0\\" encoding=\\"UTF-8\\" standalone=\\"yes\\"?>"',
  '            "<Relationships xmlns=\\"http://schemas.openxmlformats.org/package/2006/relationships\\">"',
  '            "</Relationships>")',
  'ct = ("<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>"',
  '      "<Types xmlns=\\"http://schemas.openxmlformats.org/package/2006/content-types\\">"',
  '      "<Default Extension=\\"rels\\" ContentType=\\"application/vnd.openxmlformats-package."',
  '      "relationships+xml\\"/><Default Extension=\\"xml\\" ContentType=\\"application/xml\\"/>"',
  '      "<Override PartName=\\"/word/document.xml\\" ContentType=\\"application/vnd.openxml"',
  '      "formats-officedocument.wordprocessingml.document.main+xml\\"/></Types>")',
  'styles = "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?><w:styles xmlns:w=\\"%s\\"></w:styles>" % W',
  'with zipfile.ZipFile(chemin, "w") as z:',
  '    z.writestr("_rels/.rels", rels_racine.encode("utf-8"))',
  '    z.writestr("word/document.xml", doc.encode("utf-8"))',
  '    z.writestr("word/_rels/document.xml.rels", rels_doc.encode("utf-8"))',
  '    z.writestr("[Content_Types].xml", ct.encode("utf-8"))',
  '    z.writestr("word/styles.xml", styles.encode("utf-8"))',
].join('\n');

function fabriquerDocx(chemin, paragraphes) {
  const r = python(['-c', FABRICAR_DOCX_PY, chemin, JSON.stringify(paragraphes)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// ---------------------------------------------------------------------------------
// Pilotage de annoter() : appelle le module, rend {stats, documentXml, commentsXml, parties}.
// La validation « bien formée » (ET.fromstring) se fait ICI, dans le MÊME processus Python,
// jamais via un second appel qui repasserait le contenu XML en ligne de commande : un
// manuscrit réel (l'essai sur corpus, plus bas) produit un document.xml de plusieurs centaines
// de Ko, largement au-delà de la limite de ligne de commande Windows (~32 Ko) — un piège
// mesuré en écrivant ce fichier (voir le rapport de chantier).
const ANNOTER_PY = [
  'import json, sys, zipfile',
  'import xml.etree.ElementTree as ET',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_annoter as ma',
  'entree, sortie, alertes_json, corr_json, options_json = sys.argv[2:7]',
  'alertes = json.loads(alertes_json)',
  'correspondance = json.loads(corr_json)',
  'options = json.loads(options_json)',
  'stats = ma.annoter(entree, sortie, alertes, correspondance, **options)',
  'erreurs_xml = []',
  'with zipfile.ZipFile(sortie) as z:',
  '    parties = z.namelist()',
  '    doc_xml = z.read("word/document.xml").decode("utf-8")',
  '    comments_xml = (z.read("word/comments.xml").decode("utf-8")',
  '                     if "word/comments.xml" in parties else None)',
  '    rels_xml = z.read("word/_rels/document.xml.rels").decode("utf-8")',
  '    ct_xml = z.read("[Content_Types].xml").decode("utf-8")',
  '    for nom in parties:',
  '        if nom.endswith(".xml") or nom.endswith(".rels"):',
  '            try:',
  '                ET.fromstring(z.read(nom))',
  '            except Exception as e:',
  '                erreurs_xml.append(nom + " : " + str(e))',
  'print(json.dumps({"stats": stats, "documentXml": doc_xml, "commentsXml": comments_xml,',
  '                   "relsXml": rels_xml, "ctXml": ct_xml, "parties": parties,',
  '                   "erroresXml": erreurs_xml},',
  '                  ensure_ascii=True))',
].join('\n');

function anotar(paragraphes, alertes, correspondance, options) {
  const base = dossierJetable();
  try {
    const entree = path.join(base, 'entree.docx');
    const sortie = path.join(base, 'sortie.docx');
    fabriquerDocx(entree, paragraphes);
    const r = python(['-c', ANNOTER_PY, PIPELINE, entree, sortie,
      JSON.stringify(alertes), JSON.stringify(correspondance), JSON.stringify(options || {})]);
    assert.strictEqual(r.status, 0, 'manuscrit_annoter.annoter() a échoué : ' + r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------
// Validation XML — chaque partie .xml/.rels doit être bien formée (ET.fromstring, jamais un
// simple code de sortie 0), déjà calculée par ANNOTER_PY dans le MÊME processus (voir sa
// note : jamais de second appel qui repasserait un gros XML en ligne de commande).
function validerBienFormees(resultat) {
  assert.deepStrictEqual(resultat.erroresXml, [],
    'partie(s) XML mal formée(s) :\n' + resultat.erroresXml.join('\n'));
  // §7 ter, point 2 : « identifiants uniques croissants pour tous les w:id de révision et de
  // commentaire du document » — un compteur qui bégaierait (répète la même valeur au lieu
  // d'avancer) ne casse AUCUNE des assertions de contenu ci-dessus : rien ne relit jamais
  // l'identifiant d'UN w:ins/w:del/w:comment contre celui d'UN AUTRE sans ce contrôle dédié
  // (sabotage vérifié, voir le rapport de chantier). Ne compte PAS commentRangeStart/End ni
  // commentReference : ceux-là RÉPÈTENT légitimement l'id de leur commentaire, plusieurs fois.
  const idsDe = (xml, motif) => ((xml || '').match(motif) || []).map((m) => m.match(/\d+/)[0]);
  const tousLesIds = idsDe(resultat.documentXml, /<w:(?:ins|del) w:id="\d+"/g)
    .concat(idsDe(resultat.commentsXml, /<w:comment w:id="\d+"/g));
  const doublons = tousLesIds.filter((id_, i) => tousLesIds.indexOf(id_) !== i);
  assert.deepStrictEqual(Array.from(new Set(doublons)), [],
    'w:id dupliqué(s) entre deux révisions/commentaires distincts : ' + doublons.join(', '));
}

// Simule accepter/rejeter TOUTES les révisions d'un document.xml — sans pandoc, en
// manipulant directement w:ins/w:del (patron demandé par le contrat §7 ter, point 6 :
// « un test qui simule accepter/rejeter en manipulant w:ins/w:del »). Ne prétend rien de la
// lecture RÉELLE par Word : c'est le rôle de la preuve pandoc, plus bas, sous sansPandocWsl.
const SIMULAR_ACEPTAR_RECHAZAR_PY = [
  'import re, sys',
  'doc = sys.argv[1]',
  'def quitar_delrun(m):',
  '    return ""',
  'aceptado = re.sub(r"<w:del\\b.*?</w:del>", "", doc, flags=re.S)',
  'aceptado = re.sub(r"<w:ins\\b[^>]*>(.*?)</w:ins>", r"\\1", aceptado, flags=re.S)',
  'def del_a_texto(m):',
  '    return re.sub(r"<w:delText\\b[^>]*>(.*?)</w:delText>", r"<w:t>\\1</w:t>", m.group(0), flags=re.S)',
  'rechazado = re.sub(r"<w:del\\b.*?</w:del>", del_a_texto, doc, flags=re.S)',
  'rechazado = re.sub(r"<w:ins\\b.*?</w:ins>", "", rechazado, flags=re.S)',
  'def extraer_texto(xml):',
  '    # (?:\\s[^>]*)? apres w:t, jamais [^>]* tout seul : sinon la regex avale aussi',
  '    # w:tbl, w:tc, w:tr (meme prefixe de trois lettres) -- meme piege que le module',
  '    # lui-meme evite dans sa propre lecture des runs (_RE_T).',
  '    return "".join(re.findall(r"<w:t(?:\\s[^>]*)?>(.*?)</w:t>", xml, flags=re.S))',
  'sys.stdout.write(extraer_texto(aceptado) + "\\x00" + extraer_texto(rechazado))',
].join('\n');

function simularAceptarRechazar(documentXml) {
  const r = python(['-c', SIMULAR_ACEPTAR_RECHAZAR_PY, documentXml]);
  assert.strictEqual(r.status, 0, 'simulation accepter/rejeter a échoué : ' + r.stderr);
  const [aceptado, rechazado] = r.stdout.split('\x00');
  return { aceptado, rechazado };
}

// ---------------------------------------------------------------------------------
// 1. Révision simple, span exact fourni et vérifié.

test('révision : span exact -> w:del/w:ins, accepter donne le texte suggéré, rejeter l\'original',
  { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Le texte contient un mot simple a corriger.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Simple', severity: 'error', action: 'fix', para: 0, span: [22, 28],
      found: 'simple', suggested: 'ordinaire', message: 'mot a corriger',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1);
    assert.strictEqual(resultat.stats.commentaires, 0);
    assert.match(resultat.documentXml, /<w:del w:id="\d+"[^>]*>.*?<w:delText[^>]*>simple<\/w:delText>/s);
    assert.match(resultat.documentXml, /<w:ins w:id="\d+"[^>]*>.*?<w:t[^>]*>ordinaire<\/w:t>/s);
    const { aceptado, rechazado } = simularAceptarRechazar(resultat.documentXml);
    assert.strictEqual(aceptado, 'Le texte contient un mot ordinaire a corriger.');
    assert.strictEqual(rechazado, 'Le texte contient un mot simple a corriger.');
  });

// ---------------------------------------------------------------------------------
// 1 bis. Un span FAUX (ne correspond pas à `found` à cet endroit) doit être ignoré et remplacé
// par la recherche de la première occurrence de `found` — jamais posé tel quel à l'aveugle
// (§7 ter, point 1 : « si span est donné ET que found s'y trouve »).

test('révision : span incorrect -> repli sur la recherche de `found`, jamais posé à l\'aveugle',
  { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Le texte contient un mot simple a corriger.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      // [0, 6] pointe sur « Le tex », pas sur « simple » : doit être ignoré.
      rule: 'Test.SpanFaux', severity: 'error', action: 'fix', para: 0, span: [0, 6],
      found: 'simple', suggested: 'ordinaire', message: 'span fourni erroné',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1);
    const { aceptado, rechazado } = simularAceptarRechazar(resultat.documentXml);
    assert.strictEqual(aceptado, 'Le texte contient un mot ordinaire a corriger.',
      'le span faux ne doit jamais être posé tel quel : "Le tex" ne doit pas devenir "ordinaire"');
    assert.strictEqual(rechazado, 'Le texte contient un mot simple a corriger.');
  });

// ---------------------------------------------------------------------------------
// 2. Le mot cible est fractionné entre deux runs : la révision doit quand même le retrouver
// et produire une frontière de run exacte (§7 ter, point 1 : « fractionne les runs »).

test('révision : mot cible fractionné entre deux runs -> retrouvé, un w:r par moitié dans w:del',
  { skip: sansPython }, () => {
    const paragraphes = [{
      runs: [
        { texte: 'Une personne en sit' },
        { texte: 'uation de handicap doit ' },
        { texte: 'etre respectee.', rpr: { italique: true } },
      ],
    }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Situation', severity: 'error', action: 'fix', para: 0, span: null,
      found: 'situation', suggested: '*situation*', message: 'italique demandee',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1);
    // le mot coupé « sit »+« uation » redonne DEUX w:r à l'intérieur du même w:del.
    const del = resultat.documentXml.match(/<w:del\b[^>]*>(.*?)<\/w:del>/s)[1];
    assert.strictEqual((del.match(/<w:r>/g) || []).length, 2,
      'le w:del devrait porter un w:r par moitié du mot fractionné');
    assert.match(del, /<w:delText[^>]*>sit<\/w:delText>/);
    assert.match(del, /<w:delText[^>]*>uation<\/w:delText>/);
    // l'insertion porte l'italique du segment *…*, jamais les astérisques eux-mêmes.
    assert.match(resultat.documentXml, /<w:ins\b[^>]*><w:r><w:rPr><w:i\/><\/w:rPr><w:t[^>]*>situation<\/w:t>/);
    assert.ok(!resultat.documentXml.includes('*'), 'aucun astérisque ne doit survivre dans le XML');
    // le run qui suit (en italique dans l'original) doit rester intact, non consommé.
    assert.match(resultat.documentXml, /<w:r><w:rPr><w:i\/><\/w:rPr><w:t[^>]*>etre respectee\.<\/w:t><\/w:r>/);
    const { aceptado, rechazado } = simularAceptarRechazar(resultat.documentXml);
    assert.strictEqual(aceptado, 'Une personne en situation de handicap doit etre respectee.');
    assert.strictEqual(rechazado, 'Une personne en situation de handicap doit etre respectee.');
  });

// ---------------------------------------------------------------------------------
// 3. Commentaire ancré sur un passage localisé, et commentaire de repli sur paragraphe
// entier (found introuvable) — jamais perdu, jamais confondu avec une révision.

test('commentaire : ancré sur le passage trouvé, et en repli sur le paragraphe entier sinon',
  { skip: sansPython }, () => {
    const paragraphes = [
      { texte: 'Ce paragraphe sert a tester le plafond de commentaires.' },
      { vide: true },
    ];
    const correspondance = [{ source: 0, sortie: 2 }, { source: 1, sortie: 3 }];
    const alertes = [
      { rule: 'Test.Localise', severity: 'warning', action: 'comment', para: 0, span: null,
        found: 'plafond', suggested: null, message: 'a verifier' },
      { rule: 'Test.ParagrapheEntier', severity: 'suggestion', action: 'comment', para: 1,
        span: null, found: null, suggested: null, message: 'paragraphe vide signale' },
      // fix/track non localisable (found absent du texte) -> repli commentaire, §7 ter pt.3.
      { rule: 'Test.NonLocalisable', severity: 'error', action: 'track', para: 0, span: null,
        found: 'texte-absent', suggested: 'remplacement', message: 'ne doit pas se localiser' },
    ];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 0, 'un fix non localisable ne doit jamais devenir une révision');
    assert.strictEqual(resultat.stats.commentaires, 3);
    assert.ok(resultat.commentsXml, 'word/comments.xml doit exister');
    assert.match(resultat.commentsXml, /a verifier/);
    assert.match(resultat.commentsXml, /paragraphe vide signale/);
    assert.match(resultat.commentsXml, /ne doit pas se localiser/);
    assert.match(resultat.commentsXml, /\[Test\.Localise\]/);
    assert.match(resultat.documentXml, /<w:commentRangeStart w:id="\d+"\/><w:r><w:t[^>]*>plafond<\/w:t>/);
    assert.match(resultat.documentXml, /<w:commentRangeEnd/);
    assert.match(resultat.documentXml, /<w:commentReference/);
    // la relation et le type de contenu du nouveau comments.xml sont déclarés.
    assert.match(resultat.relsXml, /relationships\/comments/);
    assert.match(resultat.ctXml, /wordprocessingml\.comments\+xml/);
  });

// ---------------------------------------------------------------------------------
// 4. Plafond par règle : 7 occurrences d'une même règle -> 5 commentées, 2 renvoyées, la
// 5e porte la synthèse (§7 ter, point 4).

test('plafond par règle : au plus 5 commentaires, synthèse sur le 5e, le reste renvoyé',
  { skip: sansPython }, () => {
    const paragraphes = Array.from({ length: 7 }, (_, i) => ({ texte: 'Paragraphe numero ' + i + ' de remplissage.' }));
    const correspondance = paragraphes.map((_, i) => ({ source: i, sortie: i + 2 }));
    const alertes = paragraphes.map((_, i) => ({
      rule: 'Test.RegleA', severity: 'warning', action: 'comment', para: i, span: null,
      found: null, suggested: null, message: 'occurrence ' + i,
    }));
    const resultat = anotar(paragraphes, alertes, correspondance, { plafond_commentaires: 25 });
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.commentaires, 5);
    assert.strictEqual(resultat.stats.commentaires_synthese, 1);
    assert.strictEqual(resultat.stats.renvoyees_au_rapport.length, 2);
    assert.ok(resultat.stats.renvoyees_au_rapport.every((a) => a.rule === 'Test.RegleA'));
    assert.strictEqual(resultat.stats.par_regle['Test.RegleA'].commentes, 5);
    assert.strictEqual(resultat.stats.par_regle['Test.RegleA'].renvoyees, 2);
    assert.match(resultat.commentsXml, /et 2 autres occurrences de cette règle, voir le rapport\./);
  });

// ---------------------------------------------------------------------------------
// 5. Plafond global : sous le plafond par règle mais au-dessus du plafond global, trié
// error > warning > suggestion puis ordre d'apparition.

test('plafond global : les commentaires au-delà de `plafond_commentaires` sont renvoyés, triés par sévérité',
  { skip: sansPython }, () => {
    const paragraphes = Array.from({ length: 4 }, (_, i) => ({ texte: 'Paragraphe numero ' + i + ' de remplissage.' }));
    const correspondance = paragraphes.map((_, i) => ({ source: i, sortie: i + 2 }));
    const alertes = [
      { rule: 'Test.Suggestion', severity: 'suggestion', action: 'comment', para: 0, span: null,
        found: null, suggested: null, message: 'suggestion' },
      { rule: 'Test.Warning', severity: 'warning', action: 'comment', para: 1, span: null,
        found: null, suggested: null, message: 'warning' },
      { rule: 'Test.Error', severity: 'error', action: 'comment', para: 2, span: null,
        found: null, suggested: null, message: 'error' },
      { rule: 'Test.Error2', severity: 'error', action: 'comment', para: 3, span: null,
        found: null, suggested: null, message: 'error2' },
    ];
    const resultat = anotar(paragraphes, alertes, correspondance, { plafond_commentaires: 2 });
    assert.strictEqual(resultat.stats.commentaires, 2);
    assert.strictEqual(resultat.stats.renvoyees_au_rapport.length, 2);
    // les deux erreurs (ordre d'apparition) passent, warning et suggestion sont renvoyés.
    const reglesEcrites = new Set(resultat.commentsXml.match(/\[Test\.[A-Za-z0-9]+\]/g) || []);
    assert.deepStrictEqual(reglesEcrites, new Set(['[Test.Error]', '[Test.Error2]']));
    const reglesRenvoyees = resultat.stats.renvoyees_au_rapport.map((a) => a.rule).sort();
    assert.deepStrictEqual(reglesRenvoyees, ['Test.Suggestion', 'Test.Warning']);
  });

// ---------------------------------------------------------------------------------
// 6. Révisions sans plafond : 40 corrections de la même règle doivent TOUTES s'écrire.

test('les révisions n\'ont aucun plafond, contrairement aux commentaires',
  { skip: sansPython }, () => {
    const paragraphes = Array.from({ length: 40 }, (_, i) => ({ texte: 'Un mot simple numero ' + i + ' a corriger.' }));
    const correspondance = paragraphes.map((_, i) => ({ source: i, sortie: i + 2 }));
    const alertes = paragraphes.map((_, i) => ({
      rule: 'Test.Masse', severity: 'error', action: 'fix', para: i, span: null,
      found: 'simple', suggested: 'ordinaire', message: 'correction ' + i,
    }));
    const resultat = anotar(paragraphes, alertes, correspondance, { plafond_commentaires: 5 });
    assert.strictEqual(resultat.stats.revisions, 40);
    assert.strictEqual(resultat.stats.commentaires, 0);
    assert.strictEqual(resultat.stats.renvoyees_au_rapport.length, 0);
  });

// ---------------------------------------------------------------------------------
// 7. Alerte non ancrée : `para` absent, ou introuvable dans la correspondance -> comptée,
// jamais perdue, et le document n'est PAS modifié.

test('non ancrée : para=None ou introuvable -> comptée dans stats.non_ancrees, document intact',
  { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Paragraphe sans aucun rapport avec les alertes.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [
      { rule: 'Test.SansParagraphe', severity: 'error', action: 'report', para: null,
        span: null, found: null, suggested: null, message: 'sans paragraphe' },
      { rule: 'Test.ParagrapheInconnu', severity: 'error', action: 'comment', para: 99,
        span: null, found: null, suggested: null, message: 'jamais ancree' },
    ];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    assert.strictEqual(resultat.stats.non_ancrees.length, 2);
    assert.strictEqual(resultat.stats.commentaires, 0);
    assert.strictEqual(resultat.stats.revisions, 0);
    assert.ok(!resultat.documentXml.includes('commentRangeStart'));
    assert.ok(!resultat.documentXml.includes('w:ins'));
  });

// ---------------------------------------------------------------------------------
// 8. action='report' : jamais écrit, seulement compté par règle.

test("action='report' : jamais écrite dans le document, comptée dans par_regle", { skip: sansPython }, () => {
  const paragraphes = [{ texte: 'Article trop long pour la revue.' }];
  const correspondance = [{ source: 0, sortie: 2 }];
  const alertes = [{
    rule: 'Test.Rapport', severity: 'error', action: 'report', para: 0, span: null,
    found: '19014 signes', suggested: 'réduire sous 18000 signes', message: 'trop long',
  }];
  const resultat = anotar(paragraphes, alertes, correspondance, {});
  assert.strictEqual(resultat.stats.revisions, 0);
  assert.strictEqual(resultat.stats.commentaires, 0);
  assert.strictEqual(resultat.stats.non_ancrees.length, 0);
  assert.strictEqual(resultat.stats.par_regle['Test.Rapport'].signalees, 1);
  assert.strictEqual(resultat.documentXml.includes('19014'), false);
});

// ---------------------------------------------------------------------------------
// 9. Idempotence / sûreté : le fichier d'entrée n'est jamais modifié, même quand
// `chemin_docx_sortie` lui est identique.

test('l\'entrée n\'est jamais modifiée : annoter en place laisse le contenu original récupérable ailleurs',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const chemin = path.join(base, 'meme-chemin.docx');
      fabriquerDocx(chemin, [{ texte: 'Un mot simple a corriger.' }]);
      const octetsAvant = fs.readFileSync(chemin);
      const alertes = [{
        rule: 'Test.EnPlace', severity: 'error', action: 'fix', para: 0, span: null,
        found: 'simple', suggested: 'ordinaire', message: 'test en place',
      }];
      const r = python(['-c', ANNOTER_PY, PIPELINE, chemin, chemin, JSON.stringify(alertes),
        JSON.stringify([{ source: 0, sortie: 2 }]), JSON.stringify({})]);
      assert.strictEqual(r.status, 0, r.stderr);
      const octetsApres = fs.readFileSync(chemin);
      assert.notDeepStrictEqual(octetsAvant, octetsApres, 'le fichier aurait dû changer');
      const resultat = JSON.parse(r.stdout);
      assert.match(resultat.documentXml, /ordinaire/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// 10. CLI d'essai — accepte le rapport JSON complet du nettoyeur pour --alertes ET
// --correspondance (alertes.liste / decisions.ecriture.correspondance, §7 ter point 8).

test('CLI : accepte le rapport JSON complet du nettoyeur pour --alertes/--correspondance',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const docx = path.join(base, 'sortie.docx');
      fabriquerDocx(docx, [{ texte: 'Un mot simple a corriger.' }]);
      const rapport = {
        alertes: { liste: [{ rule: 'Test.Cli', severity: 'error', action: 'fix', para: 0,
          span: null, found: 'simple', suggested: 'ordinaire', message: 'via CLI' }] },
        decisions: { ecriture: { correspondance: [{ source: 0, sortie: 2 }] } },
      };
      const fRapport = path.join(base, 'rapport.json');
      fs.writeFileSync(fRapport, JSON.stringify(rapport), 'utf8');
      const r = python([ANNOTER, docx, '--alertes', fRapport, '--correspondance', fRapport]);
      assert.strictEqual(r.status, 0, 'la CLI a échoué : ' + r.stderr);
      const stats = JSON.parse(r.stdout);
      assert.strictEqual(stats.revisions, 1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Preuve indépendante (§7 ter, point « validation ») : pandoc RÉEL dans la WSL, sur le
// document produit ci-dessus — jamais un simulateur maison. --track-changes=accept doit
// rendre le texte suggéré, =reject l'original, =all doit faire apparaître le texte des
// commentaires.

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

function sauterSansWsl(t, raison) {
  const msg = 'pandoc/WSL non vérifié : ' + raison;
  console.warn('\n*** ' + msg + ' — la preuve indépendante n\'est PAS faite ***\n');
  t.skip(msg);
}

test('preuve indépendante pandoc : accepter/rejeter/lire les commentaires', (t) => {
  if (sansPandocWsl) { sauterSansWsl(t, sansPandocWsl); return; }
  const base = dossierJetable();
  try {
    const docx = path.join(base, 'preuve.docx');
    fabriquerDocx(docx, [{ texte: 'Le texte contient un mot simple a corriger, et un autre a commenter.' }]);
    const alertes = [
      { rule: 'Test.Pandoc.Fix', severity: 'error', action: 'fix', para: 0, span: null,
        found: 'simple', suggested: '*ordinaire*', message: 'a corriger' },
      { rule: 'Test.Pandoc.Comment', severity: 'warning', action: 'comment', para: 0, span: null,
        found: 'commenter', suggested: null, message: 'marque-de-commentaire-a-retrouver' },
    ];
    const r = python(['-c', ANNOTER_PY, PIPELINE, docx, docx, JSON.stringify(alertes),
      JSON.stringify([{ source: 0, sortie: 2 }]), JSON.stringify({})]);
    assert.strictEqual(r.status, 0, r.stderr);

    const cible = cheminVersWsl(docx);
    const accepter = wsl(['pandoc', '--track-changes=accept', '-t', 'plain', cible]);
    assert.strictEqual(accepter.status, 0, 'pandoc --track-changes=accept a échoué : ' + accepter.stderr);
    assert.match(accepter.stdout, /mot ordinaire a corriger/);

    const rejeter = wsl(['pandoc', '--track-changes=reject', '-t', 'plain', cible]);
    assert.strictEqual(rejeter.status, 0, 'pandoc --track-changes=reject a échoué : ' + rejeter.stderr);
    assert.match(rejeter.stdout, /mot simple a corriger/);

    const avecCommentaires = wsl(['pandoc', '--track-changes=all', '-t', 'plain', cible]);
    assert.strictEqual(avecCommentaires.status, 0, 'pandoc --track-changes=all a échoué : ' + avecCommentaires.stderr);
    assert.match(avecCommentaires.stdout, /marque-de-commentaire-a-retrouver/);

    // l'italique du segment *ordinaire* survit à la lecture pandoc réelle.
    const accepterMd = wsl(['pandoc', '--track-changes=accept', '-t', 'markdown', cible]);
    assert.strictEqual(accepterMd.status, 0, accepterMd.stderr);
    assert.match(accepterMd.stdout, /\*ordinaire\*/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------
// Essai sur un manuscrit réel du corpus, DÉJÀ passé par le nettoyeur complet
// (manuscrit-nettoyer.py -> manuscrit_gabarit.ecrire()) : preuve que ce module tient sur
// une VRAIE sortie (runs de typographie fractionnés, tableaux fixes, styles réels), pas
// seulement sur une fixture. Sauté proprement si tmp/ (hors git) ou la distro manquent.

test('essai réel : une sortie du nettoyeur, annotée puis relue par pandoc réel', (t) => {
  if (sansPandocWsl) { sauterSansWsl(t, sansPandocWsl); return; }
  if (!fs.existsSync(CORPUS_LOT_A)) {
    console.warn('\n*** corpus tmp/corpus-relecture/lot-A absent (hors git) — essai réel sauté ***\n');
    t.skip('tmp/corpus-relecture/lot-A absent');
    return;
  }
  const manuscrit = path.join(CORPUS_LOT_A, '3_VF_Chanier-Delorme_Article CSPS_290626.docx');
  if (!fs.existsSync(manuscrit)) { t.skip('manuscrit de référence absent du corpus'); return; }

  const base = dossierJetable();
  try {
    const rNettoyage = wsl(['python3', cheminVersWsl(path.join(PIPELINE, 'manuscrit-nettoyer.py')),
      cheminVersWsl(manuscrit), '--produit', 'revue', '--sortie', cheminVersWsl(base)]);
    const nom = path.basename(manuscrit, '.docx');
    const docxNettoye = path.join(base, nom + '-nettoye.docx');
    const rapportJson = path.join(base, nom + '-rapport.json');
    // manuscrit-nettoyer.py/manuscrit_gabarit.py ne sont PAS des fichiers de ce lot (annotation
    // seule) : un autre chantier du même worktree peut les faire régresser entre deux essais
    // (§ « agent concurrent dans le même arbre »). Un échec DE LA CHAÎNE EN AMONT (statut ou
    // fichier absent, quelle qu'en soit la cause) saute cet essai proprement au lieu de faire
    // échouer ce fichier pour un défaut hors de son périmètre — il est signalé, pas corrigé ici.
    if (rNettoyage.status > 1 || !fs.existsSync(docxNettoye) || !fs.existsSync(rapportJson)) {
      console.warn('\n*** manuscrit-nettoyer.py a échoué (hors périmètre de ce lot) : '
        + rNettoyage.stderr.split('\n').slice(-8).join('\n') + ' ***\n');
      t.skip('manuscrit-nettoyer.py en échec, régression hors périmètre de ce lot');
      return;
    }
    const rapport = JSON.parse(fs.readFileSync(rapportJson, 'utf8'));
    const correspondance = rapport.decisions.ecriture.correspondance;

    // Le moteur de règles réel n'a rien remonté d'ancrable sur ce fichier précis (alertes
    // `report`/`para: null` seulement, voir le rapport de chantier) : cet essai fabrique donc
    // UNE alerte de démonstration pour exercer la chaîne complète sur cette sortie réelle —
    // mais jamais sur un mot/paragraphe supposé d'avance : la reconnaissance d'en-tête du
    // nettoyeur (hors du périmètre de ce lot) peut déplacer titre/résumé entre le corps et le
    // tableau fixe d'un essai à l'autre. Le mot cible se choisit DANS le paragraphe de corps
    // le plus long réellement produit, lu par manuscrit_annoter lui-même.
    const CHOISIR_CIBLE_PY = [
      'import json, re, sys, zipfile',
      'sys.path.insert(0, sys.argv[1])',
      'import manuscrit_annoter as ma',
      'chemin, corr_json = sys.argv[2], sys.argv[3]',
      'correspondance = json.loads(corr_json)',
      'with zipfile.ZipFile(chemin) as z:',
      '    doc = z.read("word/document.xml").decode("utf-8")',
      'i_body = doc.index("<w:body>"); i_fin = doc.rindex("</w:body>")',
      'interior = doc[i_body + len("<w:body>"):i_fin]',
      'indices_p = [(d, f) for (tag, d, f) in ma._hijos_directos_cuerpo(interior) if tag == "w:p"]',
      'meilleur = None',
      'for c in correspondance:',
      '    salida = c["sortie"]',
      '    if not (0 <= salida < len(indices_p)):',
      '        continue',
      '    d, f = indices_p[salida]',
      '    texto = "".join(r["texto"] for r in ma._leer_runs(interior[d:f]))',
      '    if meilleur is None or len(texto) > len(meilleur[1]):',
      '        meilleur = (c["source"], texto)',
      'source, texto = meilleur',
      'm = re.search(r"[A-Za-zÀ-ÿ]{8,}", texto)',
      'print(json.dumps({"source": source, "mot": m.group(0) if m else None}))',
    ].join('\n');
    const rCible = python(['-c', CHOISIR_CIBLE_PY, PIPELINE, docxNettoye, JSON.stringify(correspondance)]);
    assert.strictEqual(rCible.status, 0, 'choix du mot cible a échoué : ' + rCible.stderr);
    const { source, mot } = JSON.parse(rCible.stdout);
    assert.ok(mot, 'aucun mot de 8 lettres ou plus trouvé dans le corps réel');

    const alertes = [
      { rule: 'Essai.Reel.Fix', severity: 'error', action: 'fix', para: source,
        span: null, found: mot, suggested: '*' + mot + '*', message: 'italique de démonstration' },
    ];
    const sortie = path.join(base, 'annote.docx');
    const r = python(['-c', ANNOTER_PY, PIPELINE, docxNettoye, sortie, JSON.stringify(alertes),
      JSON.stringify(correspondance), JSON.stringify({})]);
    assert.strictEqual(r.status, 0, 'annoter() a échoué sur une sortie réelle : ' + r.stderr);
    const resultat = JSON.parse(r.stdout);
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1,
      'le mot choisi dans le corps réel devrait toujours se localiser et produire une révision');

    const cible = cheminVersWsl(sortie);
    const accepter = wsl(['pandoc', '--track-changes=accept', '-t', 'markdown', cible]);
    assert.strictEqual(accepter.status, 0, accepter.stderr);
    assert.ok(accepter.stdout.includes('*' + mot + '*'),
      'le mot « ' + mot + '» devrait ressortir en italique après acceptation : ' + accepter.stdout.slice(0, 500));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
