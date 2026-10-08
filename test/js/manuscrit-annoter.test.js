// pipeline/manuscrit_annoter.py : annote un .docx déjà au gabarit (la sortie de
// manuscrit_gabarit.ecrire()) avec les alertes : révisions Word (w:ins/w:del) pour les
// corrections déterministes, commentaires Word ancrés pour ce qui demande un jugement,
// plafonnés (au plus 5 par règle, plus un plafond global). Voir
// docs/ARCHITECTURE-nettoyeur-manuscrit.md.
//
//   node --test test/js/manuscrit-annoter.test.js
//
// Les fixtures sont fabriquées en Python : un .docx minimal dont le corps imite la sortie de
// manuscrit_gabarit.ecrire() (deux <w:p/> vides, séparateurs des deux tableaux fixes, puis
// les paragraphes réels).
//
// Python passe par python() de test/js/gardes.js (la WSL sous Windows). sansPandocWsl garde la
// preuve par pandoc (accepter, rejeter, lire les commentaires) et l'essai sur corpus réel, qui
// est sauté si tmp/ (hors git) ou la distribution WSL manquent.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { python, cheminPython, sansPython, sansPandocWsl, sauter } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const ANNOTER = path.join(PIPELINE, 'manuscrit_annoter.py');
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');
const DISTRO = 'SZH-Publishing';

// PYTHONIOENCODING=utf-8 : sans elle, Python sous Windows écrit stdout en cp1252 et les
// accents reviennent abîmés (« démarche » -> « d�marche »).
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
const PYTHON_OPTS = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 };

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-manuscritannoter-'));
}

// ---------------------------------------------------------------------------------
// Fabrication d'un .docx minimal par un programme Python écrit au vol. `paragraphes` : liste
// de { texte } | { runs: [{ texte, rpr:{gras,italique} }, ...] } | { vide: true }. Le corps
// imite manuscrit_gabarit.ecrire() : deux <w:tbl> minimaux suivis chacun d'un <w:p/>, puis
// les paragraphes réels et <w:sectPr/>. Les w:tbl éprouvent que l'indexation des <w:p> les
// ignore.
const FABRICAR_DOCX_PY = [
  'import json, sys, zipfile',
  'chemin, paras, notas = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'def rpr_xml(f):',
  '    partes = ""',
  '    if f.get("gras"): partes += "<w:b/>"',
  '    if f.get("italique"): partes += "<w:i/>"',
  '    return ("<w:rPr>%s</w:rPr>" % partes) if partes else ""',
  '# notaAppel (§7 ter, ancrage de note) : un w:footnoteReference, superscript, sans w:t —',
  '# meme forme que manuscrit_gabarit._RegistreNotes.run_appel_xml().',
  'def run_xml(r):',
  '    if r.get("notaAppel") is not None:',
  '        return ("<w:r><w:rPr><w:vertAlign w:val=\\"superscript\\"/></w:rPr>"',
  '                "<w:footnoteReference w:id=\\"%d\\"/></w:r>" % r["notaAppel"])',
  '    return "<w:r>%s<w:t xml:space=\\"preserve\\">%s</w:t></w:r>" % (rpr_xml(r.get("rpr", {})), r["texte"])',
  'def grupos_por_enlace(runs):',
  '    # runs consecutifs qui partagent enlace=True -> un seul <w:hyperlink> les enveloppe.',
  '    grupos, actuel = [], None',
  '    for r in runs:',
  '        en = bool(r.get("enlace"))',
  '        if actuel is not None and actuel[0] == en:',
  '            actuel[1].append(r)',
  '        else:',
  '            actuel = (en, [r]); grupos.append(actuel)',
  '    return grupos',
  'def para_xml(p):',
  '    if p.get("vide"):',
  '        return "<w:p/>"',
  '    runs = p.get("runs") or [{"texte": p.get("texte", "")}]',
  '    piezas = []',
  '    for en_lien, grupo in grupos_por_enlace(runs):',
  '        contenido = "".join(run_xml(r) for r in grupo)',
  '        if en_lien:',
  '            piezas.append(',
  '                "<w:hyperlink xmlns:r=\\"http://schemas.openxmlformats.org/officeDocument/"',
  '                "2006/relationships\\" r:id=\\"rIdLien\\">%s</w:hyperlink>" % contenido)',
  '        else:',
  '            piezas.append(contenido)',
  '    return "<w:p>%s</w:p>" % "".join(piezas)',
  'TABLA = ("<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>"',
  '         "<w:tr><w:tc><w:tcPr/><w:p/></w:tc></w:tr></w:tbl>")',
  'corps = TABLA + "<w:p/>" + TABLA + "<w:p/>" + "".join(para_xml(p) for p in paras) + "<w:sectPr/>"',
  '# footnotes.xml (§7 ter, révisions/commentaires de note) : un <w:footnote w:id="N"> par clé',
  '# de `notas` ({"1": [{texte:...}|{runs:...}, ...], ...}), même forme de paragraphe que corps.',
  'footnotes_xml = None',
  'if notas:',
  '    fn = "".join(',
  '        "<w:footnote w:id=\\"%s\\">%s</w:footnote>"',
  '        % (nid, "".join(para_xml(p) for p in paras_nota))',
  '        for nid, paras_nota in notas.items())',
  '    footnotes_xml = ("<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>"',
  '                      "<w:footnotes xmlns:w=\\"%s\\">%s</w:footnotes>" % (W, fn))',
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
  '    if footnotes_xml is not None:',
  '        z.writestr("word/footnotes.xml", footnotes_xml.encode("utf-8"))',
].join('\n');

function fabriquerDocx(chemin, paragraphes, notes) {
  const r = python(['-c', FABRICAR_DOCX_PY, chemin, JSON.stringify(paragraphes), JSON.stringify(notes || {})], PYTHON_OPTS);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// ---------------------------------------------------------------------------------
// Pilotage de annoter() : appelle le module, rend {stats, documentXml, commentsXml, parties}.
// La validation « bien formée » (ET.fromstring) se fait dans le même processus Python : le
// document.xml d'un manuscrit réel pèse plusieurs centaines de Ko, au-delà de la limite de
// ligne de commande Windows (~32 Ko).
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
  '    footnotes_xml = (z.read("word/footnotes.xml").decode("utf-8")',
  '                      if "word/footnotes.xml" in parties else None)',
  '    rels_xml = z.read("word/_rels/document.xml.rels").decode("utf-8")',
  '    ct_xml = z.read("[Content_Types].xml").decode("utf-8")',
  '    for nom in parties:',
  '        if nom.endswith(".xml") or nom.endswith(".rels"):',
  '            try:',
  '                ET.fromstring(z.read(nom))',
  '            except Exception as e:',
  '                erreurs_xml.append(nom + " : " + str(e))',
  'print(json.dumps({"stats": stats, "documentXml": doc_xml, "commentsXml": comments_xml,',
  '                   "footnotesXml": footnotes_xml,',
  '                   "relsXml": rels_xml, "ctXml": ct_xml, "parties": parties,',
  '                   "erroresXml": erreurs_xml},',
  '                  ensure_ascii=True))',
].join('\n');

function anotar(paragraphes, alertes, correspondance, options, notas) {
  const base = dossierJetable();
  try {
    const entree = path.join(base, 'entree.docx');
    const sortie = path.join(base, 'sortie.docx');
    fabriquerDocx(entree, paragraphes, notas);
    const r = python(['-c', ANNOTER_PY, PIPELINE, entree, sortie,
      JSON.stringify(alertes), JSON.stringify(correspondance), JSON.stringify(options || {})], PYTHON_OPTS);
    assert.strictEqual(r.status, 0, 'manuscrit_annoter.annoter() a échoué : ' + r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------
// Validation XML : chaque partie .xml/.rels doit être bien formée (calculé par ANNOTER_PY).
function validerBienFormees(resultat) {
  assert.deepStrictEqual(resultat.erroresXml, [],
    'partie(s) XML mal formée(s) :\n' + resultat.erroresXml.join('\n'));
  // Les w:id de révision et de commentaire sont uniques dans tout le document. Aucune autre
  // assertion ne verrait un compteur qui répète la même valeur. commentRangeStart/End et
  // commentReference répètent légitimement l'id de leur commentaire : ils ne sont pas comptés.
  const idsDe = (xml, motif) => ((xml || '').match(motif) || []).map((m) => m.match(/\d+/)[0]);
  // Les révisions de note partagent le même compteur que celles du corps.
  const tousLesIds = idsDe(resultat.documentXml, /<w:(?:ins|del) w:id="\d+"/g)
    .concat(idsDe(resultat.footnotesXml, /<w:(?:ins|del) w:id="\d+"/g))
    .concat(idsDe(resultat.commentsXml, /<w:comment w:id="\d+"/g));
  const doublons = tousLesIds.filter((id_, i) => tousLesIds.indexOf(id_) !== i);
  assert.deepStrictEqual(Array.from(new Set(doublons)), [],
    'w:id dupliqué(s) entre deux révisions/commentaires distincts : ' + doublons.join(', '));
}

// Simule accepter, puis rejeter, toutes les révisions d'un document.xml en manipulant
// directement w:ins/w:del, sans pandoc. La lecture réelle est éprouvée plus bas par pandoc.
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
  const r = python(['-c', SIMULAR_ACEPTAR_RECHAZAR_PY, documentXml], PYTHON_OPTS);
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
// 1 bis. Un span faux (`found` ne s'y trouve pas) est ignoré : `found` est cherché dans le
// paragraphe.

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
// 2. Le mot cible est fractionné entre deux runs : la révision le retrouve et coupe les runs
// aux bons décalages.

test('révision : mot cible fractionné entre deux runs -> retrouvé, un w:r par moitié dans w:del', { skip: sansPython }, () => {
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
    // le mot coupé « sit »+« uation » donne deux w:r dans le même w:del.
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
// 2 bis. Chevauchements, found ambigus et liens.

// Deux révisions du même paragraphe dont les spans se chevauchent : la seconde fusionnerait un
// atome déjà fusionné par la première (KeyError('texto')). Cas réel : deux règles sur un DOI.
test('chevauchement de révisions dans un même paragraphe : la plus sévère devient révision, l\'autre un commentaire au même endroit',
  { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Un lien https://exemple.org/rapport-2026 est cite deux fois.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [
      // Span plus large, contenant le second, mais moins sévère (warning) : posée en premier
      // pour prouver que la sévérité décide, pas l'ordre de la liste.
      { rule: 'Test.Chevauchement.Large', severity: 'warning', action: 'fix', para: 0,
        span: null, found: 'lien https://exemple.org/rapport-2026 est',
        suggested: 'lien *https://exemple.org/rapport-2026* est', message: 'reformulation large' },
      // Span plus étroit, contenu dans le premier, plus sévère (error) : l'emporte.
      { rule: 'Test.Chevauchement.Etroit', severity: 'error', action: 'fix', para: 0,
        span: null, found: 'https://exemple.org/rapport-2026', suggested: 'URL-CORRIGEE',
        message: 'DOI/URL mal formé' },
    ];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    // Une seule révision retenue.
    assert.strictEqual(resultat.stats.revisions, 1);
    assert.strictEqual(resultat.stats.commentaires, 1);
    assert.strictEqual(resultat.stats.par_regle['Test.Chevauchement.Etroit'].revisions, 1,
      'la règle la plus sévère (error) doit devenir la révision');
    assert.strictEqual(resultat.stats.par_regle['Test.Chevauchement.Large'].commentes, 1,
      'la règle la moins sévère doit devenir un commentaire, jamais une seconde révision imbriquée');
    assert.match(resultat.documentXml, /<w:delText[^>]*>https:\/\/exemple\.org\/rapport-2026<\/w:delText>/);
    assert.match(resultat.documentXml, /<w:t[^>]*>URL-CORRIGEE<\/w:t>/);
  });

// Le DOI retrouvé part toujours en suivi de modifications. La mise en forme APA (principal)
// le porte ; si elle perd un chevauchement, son repli (l'insertion du seul DOI en fin de
// référence) devient la révision ; si elle passe, le repli ne s'écrit pas.
const REF_DOI = 'Martin, A. (2020). Un titre. Revue X, 12(3), 45-67.';
function alertesGroupeDoi(avecConcurrente) {
  const alertes = [
    { rule: 'APA.MiseEnForme', severity: 'warning', action: 'track', para: 0, span: null,
      found: REF_DOI, suggested: 'Martin, A. (2020). Un titre. *Revue X*, *12*(3), 45-67. '
        + 'https://doi.org/10.1/x', message: 'mise en forme', groupe: 'doi:0',
      role_groupe: 'principal' },
    { rule: 'APA.DoiRetrouve', severity: 'suggestion', action: 'track', para: 0, span: null,
      found: '45-67.', suggested: '45-67. https://doi.org/10.1/x', message: 'DOI',
      groupe: 'doi:0', role_groupe: 'repli' },
  ];
  if (avecConcurrente) {
    alertes.push({ rule: 'Test.Erreur', severity: 'error', action: 'fix', para: 0, span: null,
      found: 'Un titre', suggested: 'Un autre titre', message: 'plus sévère' });
  }
  return alertes;
}

test('DOI retrouvé : la mise en forme perd un chevauchement, le DOI part quand même en révision', { skip: sansPython }, () => {
    const resultat = anotar([{ texte: REF_DOI }], alertesGroupeDoi(true),
      [{ source: 0, sortie: 2 }], {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.par_regle['APA.DoiRetrouve'].revisions, 1,
      'le DOI doit être une révision : ' + JSON.stringify(resultat.stats.par_regle));
    assert.strictEqual(resultat.stats.par_regle['APA.MiseEnForme'].commentes, 1);
    assert.match(resultat.documentXml, /<w:ins\b[\s\S]*?https:\/\/doi\.org\/10\.1\/x/);
  });

test('DOI retrouvé : la mise en forme passe, le repli ne s\'écrit ni en révision ni en commentaire',
  { skip: sansPython }, () => {
    const resultat = anotar([{ texte: REF_DOI }], alertesGroupeDoi(false),
      [{ source: 0, sortie: 2 }], {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1);
    assert.strictEqual(resultat.stats.commentaires, 0);
    assert.deepStrictEqual(resultat.stats.devenir, ['revision', 'revision']);
    assert.strictEqual((resultat.documentXml.match(/doi\.org\/10\.1\/x/g) || []).length, 1,
      'le DOI ne doit figurer qu’une fois');
  });

// Seul un vrai doublon n'est pas posé en commentaire : une règle de DOUBLON_DE_REVISION dont
// le constat est déjà dit par la révision qui la chevauche.
// Un constat différent qui chevauche une révision (ReferenceNonCitee) reste un commentaire.
const REF_DOUBLON = 'Martin, A. et Durand, B. (2020). Un titre. Revue X, 12(3), 45-67. 10.1/x';
function alertesDoublon(regleCommentaire, suggested) {
  return [
    { rule: 'APA.MiseEnForme', severity: 'warning', action: 'track', para: 0, span: null,
      found: REF_DOUBLON, suggested: 'Martin, A., & Durand, B. (2020). Un titre. *Revue X*, *12*(3), '
        + '45-67. https://doi.org/10.1/x', message: 'mise en forme' },
    { rule: regleCommentaire, severity: 'warning', action: 'comment', para: 0, span: null,
      found: ' et Durand', suggested, message: 'constat' },
  ];
}

test('doublon d\'une révision (Esperluette) : retiré de Word, gardé au rapport',
  { skip: sansPython }, () => {
    const resultat = anotar([{ texte: REF_DOUBLON }],
      alertesDoublon('CSPS-Biblio.APA.Esperluette', ' & Durand'), [{ source: 0, sortie: 2 }], {});
    validerBienFormees(resultat);
    assert.deepStrictEqual(resultat.stats.devenir, ['revision', 'rapport']);
    assert.strictEqual(resultat.stats.commentaires, 0);
    assert.strictEqual(resultat.stats.par_regle['CSPS-Biblio.APA.Esperluette'].renvoyees, 1);
    assert.ok(resultat.stats.renvoyees_au_rapport.some((a) => a.rule === 'CSPS-Biblio.APA.Esperluette'));
  });

test('doublon déclaré mais révision qui ne dit pas la même chose : reste un commentaire', { skip: sansPython }, () => {
    const resultat = anotar([{ texte: REF_DOUBLON }],
      alertesDoublon('CSPS-Biblio.APA.Esperluette', ' & Autre'), [{ source: 0, sortie: 2 }], {});
    validerBienFormees(resultat);
    assert.deepStrictEqual(resultat.stats.devenir, ['revision', 'commentaire']);
  });

test('constat différent qui chevauche une révision (ReferenceNonCitee) : reste un commentaire', { skip: sansPython }, () => {
    const resultat = anotar([{ texte: REF_DOUBLON }],
      alertesDoublon('APA.ReferenceNonCitee', ' & Durand'), [{ source: 0, sortie: 2 }], {});
    validerBienFormees(resultat);
    assert.deepStrictEqual(resultat.stats.devenir, ['revision', 'commentaire']);
    assert.strictEqual(resultat.stats.commentaires, 1);
    assert.strictEqual(resultat.stats.par_regle['APA.ReferenceNonCitee'].commentes, 1);
  });

test('retrait des doublons : fait avant le plafond (ni place prise, ni synthèse)', { skip: sansPython }, () => {
    const alertes = [{ rule: 'APA.MiseEnForme', severity: 'warning', action: 'track', para: 0,
      span: null, found: 'Martin, A. et Durand, B.', suggested: 'Martin, A., & Durand, B.',
      message: 'mise en forme' }];
    // Six doublons Esperluette (error), puis un constat de la même règle hors de la révision.
    for (let i = 0; i < 6; i++) {
      alertes.push({ rule: 'CSPS-Biblio.APA.Esperluette', severity: 'error', action: 'comment',
        para: 0, span: null, found: ' et Durand', suggested: ' & Durand', message: 'doublon ' + i });
    }
    alertes.push({ rule: 'CSPS-Biblio.APA.Esperluette', severity: 'suggestion', action: 'comment',
      para: 0, span: null, found: 'Un titre', suggested: ' & Durand', message: 'libre' });
    const resultat = anotar([{ texte: REF_DOUBLON }], alertes, [{ source: 0, sortie: 2 }], {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.commentaires, 1, 'le libre garde sa place');
    assert.strictEqual(resultat.stats.commentaires_synthese, 0);
    assert.strictEqual(resultat.stats.devenir[7], 'commentaire');
    assert.strictEqual(resultat.stats.par_regle['CSPS-Biblio.APA.Esperluette'].renvoyees, 6);
  });

// Un commentaire DOI qui chevauche le commentaire APA.MiseEnForme de la même référence ne fait
// qu'un dans Word : celui de mise en forme, avec la forme attendue du DOI à la suite (sauf si
// sa suggestion la contient déjà) ; le commentaire DOI reste au rapport. Sans ancrage commun,
// les deux restent.
const REF_FUSION = 'Martin, A. (2020). Un titre. Revue X, 12(3), 45-67. 10.1/x';
const DOI_NORME = 'https://doi.org/10.1/x';
function alertesFusion(regleDoi, suggestedMef, spanDoi) {
  const debut = REF_FUSION.indexOf('10.1/x');
  return [
    { rule: 'APA.MiseEnForme', severity: 'warning', action: 'comment', para: 0, span: [0, REF_FUSION.length],
      found: REF_FUSION, suggested: suggestedMef, message: 'La mise en forme diverge.' },
    { rule: regleDoi, severity: 'warning', action: 'comment', para: 0,
      span: spanDoi || [debut, REF_FUSION.length], found: '10.1/x', suggested: DOI_NORME, message: 'DOI.' },
  ];
}
const MEF_SANS_DOI = 'Martin, A. (2020). Un titre. *Revue X*, *12*(3), 45-67.';
const MEF_AVEC_DOI = MEF_SANS_DOI + ' ' + DOI_NORME;

test('fusion DOI / mise en forme : un seul commentaire dans Word, la forme du DOI à la suite, le DOI au rapport', { skip: sansPython }, () => {
    for (const regle of ['APA.DoiForme', 'CSPS-Biblio.APA.DoiForme']) {
      const resultat = anotar([{ texte: REF_FUSION }], alertesFusion(regle, MEF_SANS_DOI),
        [{ source: 0, sortie: 2 }], {});
      validerBienFormees(resultat);
      assert.strictEqual(resultat.stats.commentaires, 1, regle);
      assert.deepStrictEqual(resultat.stats.devenir, ['commentaire', 'rapport']);
      assert.deepStrictEqual(resultat.stats.fusion_doi, { fusionnees: 1, deja_dans_la_forme: 0, separees: 0 });
      assert.match(resultat.commentsXml, /La mise en forme diverge\. DOI : forme attendue https:\/\/doi\.org\/10\.1\/x/);
      assert.ok(resultat.stats.renvoyees_au_rapport.some((a) => a.rule === regle));
    }
    const de = anotar([{ texte: REF_FUSION }], alertesFusion('APA.DoiForme', MEF_SANS_DOI),
      [{ source: 0, sortie: 2 }], { langue: 'de' });
    assert.match(de.commentsXml, /DOI: erwartete Form https:\/\/doi\.org\/10\.1\/x/);
    // Le message du rapport (l'alerte d'origine) n'est pas modifié.
    assert.ok(!de.stats.renvoyees_au_rapport.some((a) => /erwartete/.test(a.message || '')));
  });

test('fusion DOI / mise en forme : le DOI déjà dans la forme APA n\'ajoute rien ; sans ancrage commun, les deux restent',
  { skip: sansPython }, () => {
    const deja = anotar([{ texte: REF_FUSION }], alertesFusion('APA.DoiForme', MEF_AVEC_DOI),
      [{ source: 0, sortie: 2 }], {});
    assert.strictEqual(deja.stats.commentaires, 1);
    assert.deepStrictEqual(deja.stats.devenir, ['commentaire', 'rapport']);
    assert.deepStrictEqual(deja.stats.fusion_doi, { fusionnees: 0, deja_dans_la_forme: 1, separees: 0 });
    assert.ok(!/forme attendue/.test(deja.commentsXml));

    // Le DOI porte sur un autre passage du paragraphe que la mise en forme (span étroit
    // ailleurs que la référence entière) : aucun chevauchement, les deux commentaires restent.
    const alertes = alertesFusion('APA.DoiForme', MEF_SANS_DOI);
    alertes[0].span = [0, 8];
    alertes[0].found = REF_FUSION.slice(0, 8);
    const separes = anotar([{ texte: REF_FUSION }], alertes, [{ source: 0, sortie: 2 }], {});
    assert.strictEqual(separes.stats.commentaires, 2);
    assert.deepStrictEqual(separes.stats.devenir, ['commentaire', 'commentaire']);
    assert.deepStrictEqual(separes.stats.fusion_doi, { fusionnees: 0, deja_dans_la_forme: 0, separees: 1 });
    assert.ok(!/forme attendue/.test(separes.commentsXml));
  });

// Un found court ou ambigu sans span valide ne s'ancre pas sur sa première occurrence, qui
// peut être à l'intérieur d'un autre mot (« et » dans « Cette » -> « C&te »).
test('found court ou ambigu sans span valide : jamais remplacé, repli sur un commentaire du paragraphe entier', { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Cette approche associe recherche et pratique, et convainc.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [
      // "et" est caché dans "Cette" et apparaît deux fois par ailleurs : ambigu.
      { rule: 'Test.EtCourt', severity: 'error', action: 'fix', para: 0, span: null,
        found: 'et', suggested: '&', message: 'liaison et/&' },
      // "approche" est court mais unique : révision normale.
      { rule: 'Test.Unique', severity: 'error', action: 'fix', para: 0, span: null,
        found: 'approche', suggested: 'démarche', message: 'reformulation' },
    ];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1, 'seul le found unique et assez long devient une révision');
    assert.strictEqual(resultat.stats.par_regle['Test.EtCourt'].commentes, 1,
      'un found court/ambigu sans span devient un commentaire, jamais un remplacement');
    const { aceptado, rechazado } = simularAceptarRechazar(resultat.documentXml);
    assert.strictEqual(aceptado, 'Cette démarche associe recherche et pratique, et convainc.',
      'le texte réel ("Cette", "et") ne doit JAMAIS être corrompu par le repli sur "et"');
    assert.strictEqual(rechazado, 'Cette approche associe recherche et pratique, et convainc.');
  });

// Une révision qui touche un run dans <w:hyperlink> perdrait l'ouverture ou la fermeture du
// lien en fusionnant les runs, et laisserait un document.xml mal formé sans erreur.
test('révision touchant un run de lien : jamais fusionnée, repli sur un commentaire, XML toujours bien formé', { skip: sansPython }, () => {
    const paragraphes = [{
      runs: [
        { texte: 'Voir le lien ' },
        { texte: 'https://exemple.org/rapport-cdph', enlace: true },
        { texte: ' pour plus de détails.' },
      ],
    }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      // Le span commence avant le lien et se termine dedans.
      rule: 'Test.SpanSurLien', severity: 'error', action: 'fix', para: 0, span: null,
      found: 'lien https://exemple.org/rapport-cdph', suggested: 'REMPLACEMENT-REFUSE',
      message: 'ne doit jamais toucher le lien',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 0, 'un span qui touche un run de lien ne doit jamais devenir une révision');
    assert.strictEqual(resultat.stats.commentaires, 1);
    assert.ok(!resultat.documentXml.includes('REMPLACEMENT-REFUSE'),
      'le texte suggéré ne doit jamais être écrit quand la cible touche un lien');
    // <w:hyperlink> reste équilibré (ouvertures == fermetures).
    const ouvertures = (resultat.documentXml.match(/<w:hyperlink\b/g) || []).length;
    const fermetures = (resultat.documentXml.match(/<\/w:hyperlink>/g) || []).length;
    assert.strictEqual(ouvertures, 1);
    assert.strictEqual(fermetures, 1);
  });

// ---------------------------------------------------------------------------------
// 2 ter. Révisions par jeton, localisation tolérante, chevauchements à sévérité égale.

// Diff par jeton : trois changements distincts (« et » -> « & », italique sur le nom de
// revue, italique sur le volume) donnent plusieurs petites paires w:del/w:ins, et le texte
// inchangé entre elles reste en runs normaux.
test('révision par jeton : plusieurs petits changements dans une longue référence ne barrent '
  + 'pas tout le texte, seuls les segments qui changent deviennent w:del/w:ins',
  { skip: sansPython }, () => {
    const original = 'Scruggs, T. E., Mastropieri, M. A. et McDuffie, K. A. (2007). '
      + 'Co-teaching in inclusive classrooms: A metasynthesis of qualitative research. '
      + 'Exceptional children, 73(4), 392-416.';
    const suggere = 'Scruggs, T. E., Mastropieri, M. A., & McDuffie, K. A. (2007). '
      + 'Co-teaching in inclusive classrooms: A metasynthesis of qualitative research. '
      + '*Exceptional children*, *73*(4), 392-416.';
    const paragraphes = [{ texte: original }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Jeton', severity: 'warning', action: 'track', para: 0, span: null,
      found: original, suggested: suggere, message: 'mise en forme',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1, 'une seule ALERTE convertie en révision');
    // Au moins un w:del pour « et » -> « & », un autre pour l'italique du nom de revue et du
    // volume.
    const nbDel = (resultat.documentXml.match(/<w:del\b/g) || []).length;
    assert.ok(nbDel >= 2, 'attendu plusieurs w:del distincts (un par changement), trouvé '
      + nbDel + ' : ' + resultat.documentXml);
    // Le texte inchangé du milieu reste un run normal, hors de w:del/w:ins.
    assert.match(resultat.documentXml,
      /<w:r><w:t[^>]*>[^<]*Co-teaching in inclusive classrooms: A metasynthesis of qualitative research\.[^<]*<\/w:t><\/w:r>/,
      'le texte inchangé au milieu de la référence devrait rester un run normal, non marqué');
    // simularAceptarRechazar() laisse les entités XML telles quelles (&amp;), et les
    // astérisques deviennent <w:i/> dans le document : on compare à la forme sans astérisque,
    // entité brute.
    const { aceptado, rechazado } = simularAceptarRechazar(resultat.documentXml);
    assert.strictEqual(aceptado, suggere.replace(/\*/g, '').replace('&', '&amp;'));
    assert.strictEqual(rechazado, original);
  });

// Repli : une reformulation profonde (plus de 60 % des jetons changés) donne un seul
// w:del/w:ins couvrant tout le span.
test('révision par jeton : une reformulation trop profonde (>60% des jetons) retombe sur un '
  + 'seul w:del/w:ins pour tout le span', { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Un texte tout à fait différent du résultat attendu ici.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Profond', severity: 'warning', action: 'track', para: 0, span: null,
      found: 'Un texte tout à fait différent du résultat attendu ici.',
      suggested: 'Une phrase entièrement récrite sans aucun rapport avec la précédente.',
      message: 'reformulation complète',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1);
    assert.strictEqual((resultat.documentXml.match(/<w:del\b/g) || []).length, 1,
      'un seul w:del attendu pour une reformulation aussi profonde');
    assert.strictEqual((resultat.documentXml.match(/<w:ins\b/g) || []).length, 1);
  });

// Cas italique : un segment au texte égal qui doit devenir italique (marquage *…* du
// suggested) donne w:del + w:ins de ce seul segment ; un segment déjà italique qui le reste
// n'est pas touché.
test('révision par jeton : un segment à texte égal qui doit devenir italique est del+ins ; '
  + 'un segment déjà italique qui le reste n\'est pas touché', { skip: sansPython }, () => {
    const paragraphes = [{
      runs: [
        { texte: 'Titre ' },
        { texte: 'Revue X' },
        { texte: ' et ' },
        { texte: 'Sous-titre', rpr: { italique: true } },
        { texte: ' fin.' },
      ],
    }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Italique', severity: 'warning', action: 'track', para: 0, span: null,
      found: 'Titre Revue X et Sous-titre fin.',
      suggested: 'Titre *Revue X* et *Sous-titre* fin.', message: 'italique manquant',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    // « Revue X » (devient italique) : del+ins. « Sous-titre » (déjà italique) : run intact
    // avec son rPr d'origine.
    assert.match(resultat.documentXml, /<w:delText[^>]*>Revue X<\/w:delText>/);
    assert.match(resultat.documentXml,
      /<w:ins\b[^>]*><w:r><w:rPr><w:i\/><\/w:rPr><w:t[^>]*>Revue X<\/w:t>/);
    assert.ok(!resultat.documentXml.includes('<w:delText'.concat('>Sous-titre<')),
      'Sous-titre était déjà italique et le reste : il ne doit jamais être supprimé/réinséré');
    assert.match(resultat.documentXml,
      /<w:r><w:rPr><w:i\/><\/w:rPr><w:t[^>]*>Sous-titre<\/w:t><\/w:r>/,
      'Sous-titre doit rester un run normal intact, inchangé');
    const { aceptado, rechazado } = simularAceptarRechazar(resultat.documentXml);
    assert.strictEqual(aceptado, 'Titre Revue X et Sous-titre fin.');
    assert.strictEqual(rechazado, 'Titre Revue X et Sous-titre fin.');
  });

// Repli tolérant à la typographie : le paragraphe porte une apostrophe typographique (’),
// `found` l'apostrophe droite ('). Sans ce repli, l'alerte finirait en commentaire.
test('localisation tolérante à la typographie : apostrophe droite dans found, typographique '
  + 'dans le texte -> quand même une révision', { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Les enseignants’ pratiques évoluent avec le temps.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Tolerant', severity: 'warning', action: 'fix', para: 0, span: null,
      found: "enseignants' pratiques", suggested: 'pratiques enseignantes',
      message: 'reformulation',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1,
      'le repli tolérant devrait localiser found malgré la différence d\'apostrophe');
    assert.strictEqual(resultat.stats.commentaires, 0);
  });

// Chevauchement à sévérité égale : le span le plus large gagne, quelle que soit sa place dans
// la liste. APA.MiseEnForme (la référence entière) couvre souvent le détail qu'une règle Vale
// plus étroite corrige.
test('chevauchement à sévérité égale : le span le plus large gagne (la révision la plus '
  + 'large a plus de chances d\'englober la plus étroite que l\'inverse)', { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Dupont, A. et Martin, B. (2020). Un titre. Revue Y, 1, 1-9.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [
      // Posée en premier, span étroit.
      { rule: 'Test.Etroit', severity: 'warning', action: 'fix', para: 0, span: null,
        found: 'et Martin', suggested: '& Martin', message: 'liaison' },
      // Posée ensuite, span large (toute la référence) : l'emporte.
      { rule: 'Test.Large', severity: 'warning', action: 'track', para: 0, span: null,
        found: 'Dupont, A. et Martin, B. (2020). Un titre. Revue Y, 1, 1-9.',
        suggested: 'Dupont, A., & Martin, B. (2020). Un titre. *Revue Y*, 1, 1-9.',
        message: 'mise en forme complète' },
    ];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1);
    assert.strictEqual(resultat.stats.par_regle['Test.Large'].revisions, 1,
      'la révision au span le plus large doit gagner le chevauchement');
    assert.strictEqual(resultat.stats.par_regle['Test.Etroit'].commentes, 1,
      'la révision au span le plus étroit doit devenir un commentaire au même endroit');
  });

// Un commentaire dont le `suggested` porte un marquage *…* n'affiche pas d'astérisque : une
// note signale l'italique.
test('commentaire : le texte plat ne porte jamais d\'astérisque littéral quand suggested est '
  + 'marqué en italique', { skip: sansPython }, () => {
    const paragraphes = [{ texte: 'Une référence mal formée dans le texte.' }];
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.CommentaireItalique', severity: 'suggestion', action: 'comment', para: 0,
      span: null, found: null, suggested: '*Revue X*, *12*(3), 45-67.',
      message: 'suggestion de mise en forme',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.ok(!resultat.commentsXml.includes('*'),
      'aucun astérisque littéral ne doit apparaître dans le commentaire : ' + resultat.commentsXml);
    assert.match(resultat.commentsXml, /Revue X, 12\(3\), 45-67\./);
    assert.match(resultat.commentsXml, /italique/);
  });

// ---------------------------------------------------------------------------------
// 3. Commentaire ancré sur un passage localisé, ou sur le paragraphe entier si found est
// introuvable.

test('commentaire : ancré sur le passage trouvé, et en repli sur le paragraphe entier sinon', { skip: sansPython }, () => {
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
      // fix/track non localisable (found absent du texte) -> repli commentaire.
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
// 5e porte la synthèse.

test('plafond par règle : au plus 5 commentaires, synthèse sur le 5e, le reste renvoyé', { skip: sansPython }, () => {
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

test('plafond global : les commentaires au-delà de `plafond_commentaires` sont renvoyés, triés par sévérité', { skip: sansPython }, () => {
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
// `stats.plafond_global` ne compte que les commentaires refusés par le plafond global : ni les
// doublons retirés, ni le plafond par règle.
test('plafond_global : 25 commentaires pile et un doublon retiré = 0 ; un 26e commentaire = 1', { skip: sansPython }, () => {
    const paragraphes = [{ texte: REF_DOUBLON }].concat(
      Array.from({ length: 26 }, (_, i) => ({ texte: 'Paragraphe numero ' + i + ' de remplissage.' })));
    const correspondance = paragraphes.map((_, i) => ({ source: i, sortie: i + 2 }));
    const alertes = [{ rule: 'APA.MiseEnForme', severity: 'warning', action: 'track', para: 0,
      span: null, found: 'Martin, A. et Durand, B.', suggested: 'Martin, A., & Durand, B.',
      message: 'mise en forme' },
    { rule: 'CSPS-Biblio.APA.Esperluette', severity: 'error', action: 'comment', para: 0,
      span: null, found: ' et Durand', suggested: ' & Durand', message: 'doublon' }];
    const libres = (n) => Array.from({ length: n }, (_, i) => ({ rule: 'Test.R' + i,
      severity: 'warning', action: 'comment', para: i + 1, span: null, found: null,
      suggested: null, message: 'm' + i }));
    const pile = anotar(paragraphes, alertes.concat(libres(25)), correspondance, { plafond_commentaires: 25 });
    assert.strictEqual(pile.stats.commentaires, 25);
    assert.strictEqual(pile.stats.renvoyees_au_rapport.length, 1, 'le doublon seul est renvoyé');
    assert.strictEqual(pile.stats.plafond_global, 0);
    const trop = anotar(paragraphes, alertes.concat(libres(26)), correspondance, { plafond_commentaires: 25 });
    assert.strictEqual(trop.stats.commentaires, 25);
    assert.strictEqual(trop.stats.plafond_global, 1);
  });

// 6. Révisions sans plafond : 40 corrections de la même règle s'écrivent toutes.

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
// 7. Alerte non ancrée : `para` absent, ou introuvable dans la correspondance -> comptée, et
// le document reste intact.

test('non ancrée : para=None ou introuvable -> comptée dans stats.non_ancrees, document intact', { skip: sansPython }, () => {
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
// 8. action='report' : compté par règle, rien d'écrit dans le document.

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
// 9. Annoter en place : `chemin_docx_sortie` égal au fichier d'entrée.

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
// 10. CLI d'essai : accepte le rapport JSON complet du nettoyeur pour --alertes et
// --correspondance (alertes.liste / decisions.ecriture.correspondance).

test('CLI : accepte le rapport JSON complet du nettoyeur pour --alertes/--correspondance', { skip: sansPython }, () => {
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
      const r = python([ANNOTER, docx, '--alertes', fRapport, '--correspondance', fRapport], PYTHON_OPTS);
      assert.strictEqual(r.status, 0, 'la CLI a échoué : ' + r.stderr);
      const stats = JSON.parse(r.stdout);
      assert.strictEqual(stats.revisions, 1);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// 11. Notes de bas de page : une alerte sur le texte d'une note s'ancre sur le dernier mot
// avant w:footnoteReference (barre oblique et trait d'union intérieurs conservés, ponctuation
// finale exclue), pas sur tout le paragraphe qui porte l'appel. Texte du commentaire :
// « Note N : <message> » puis « Passage : « <found> » ».

const PARA_AVEC_APPEL_NOTE = [{
  runs: [
    { texte: 'Une personne en in/capacités' },
    { notaAppel: 1 },
    { texte: ' doit être accompagnée.' },
  ],
}];
const NOTE_RECONNAITRE = { '1': [{ texte: 'Reconnaître les personnes en situation de handicap est essentiel.' }] };

test('note : commentaire ancré sur le seul mot qui précède l\'appel (barre oblique intérieure '
  + 'conservée), jamais sur le paragraphe entier', { skip: sansPython }, () => {
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Note.Comment', severity: 'warning', action: 'comment', para: 0, span: null,
      found: 'Reconnaître', suggested: null, message: 'orthographe rectifiée',
      note_id: 1, note_numero: 1,
    }];
    const resultat = anotar(PARA_AVEC_APPEL_NOTE, alertes, correspondance, {}, NOTE_RECONNAITRE);
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.commentaires, 1);
    assert.strictEqual(resultat.stats.notes.commentaires, 1);
    assert.strictEqual(resultat.stats.notes.repli_paragraphe_entier, 0);
    // le passage encerclé est exactement « in/capacités ».
    const m = resultat.documentXml.match(
      /<w:commentRangeStart w:id="\d+"\/>(.*?)<w:commentRangeEnd/s);
    assert.ok(m, 'commentRangeStart/End introuvables');
    const texteEncercle = (m[1].match(/<w:t[^>]*>([^<]*)<\/w:t>/) || [])[1];
    assert.strictEqual(texteEncercle, 'in/capacités',
      'seul le mot précédant l\'appel doit être encerclé : ' + m[1]);
    // le commentReference suit le commentRangeEnd, avant le footnoteReference : l'icône de
    // commentaire colle au mot annoté, le chiffre d'appel vient juste après.
    assert.match(resultat.documentXml,
      /<w:commentRangeEnd w:id="\d+"\/><w:r>.*?<w:commentReference w:id="\d+"\/><\/w:r>.*?<w:footnoteReference/s);
    assert.match(resultat.commentsXml, /Note 1 :/);
    assert.match(resultat.commentsXml, /Passage : « Reconnaître »/);
    assert.match(resultat.commentsXml, /\[Test\.Note\.Comment\]/);
  });

test('note : alerte fix avec `found` dans le texte de la note -> révision DANS footnotes.xml, '
  + 'jamais dans document.xml, accepter/rejeter changent le texte de la note',
  { skip: sansPython }, () => {
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Note.Fix', severity: 'error', action: 'fix', para: 0, span: null,
      found: 'Reconnaître', suggested: 'Reconnaitre', message: 'orthographe rectifiée',
      note_id: 1, note_numero: 1,
    }];
    const resultat = anotar(PARA_AVEC_APPEL_NOTE, alertes, correspondance, {}, NOTE_RECONNAITRE);
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 1);
    assert.strictEqual(resultat.stats.notes.revisions, 1);
    assert.ok(resultat.footnotesXml, 'word/footnotes.xml doit exister');
    assert.match(resultat.footnotesXml, /<w:delText[^>]*>Reconnaître<\/w:delText>/);
    assert.match(resultat.footnotesXml, /<w:ins\b[^>]*><w:r><w:t[^>]*>Reconnaitre<\/w:t>/);
    // rien dans document.xml : ni commentaire (Word n'en accepte pas dans une note), ni
    // révision (elle est dans la note).
    assert.ok(!resultat.documentXml.includes('commentRangeStart'),
      'aucun commentaire ne doit être posé dans le corps pour une révision de note réussie');
    assert.ok(!resultat.documentXml.includes('<w:ins'), 'la révision ne doit pas être dans document.xml');
    const { aceptado, rechazado } = simularAceptarRechazar(resultat.footnotesXml);
    assert.match(aceptado, /Reconnaitre les personnes/);
    assert.match(rechazado, /Reconnaître les personnes/);
  });

test('note : `note_numero` qui ne correspond à aucun appel réel -> repli sur le paragraphe '
  + 'entier, compté dans stats.notes.repli_paragraphe_entier', { skip: sansPython }, () => {
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Note.NumeroFaux', severity: 'warning', action: 'comment', para: 0, span: null,
      found: 'Reconnaître', suggested: null, message: 'numéro de note faux',
      note_id: 1, note_numero: 99,
    }];
    const resultat = anotar(PARA_AVEC_APPEL_NOTE, alertes, correspondance, {}, NOTE_RECONNAITRE);
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.notes.repli_paragraphe_entier, 1);
    assert.strictEqual(resultat.stats.notes.commentaires, 0);
    assert.strictEqual(resultat.stats.commentaires, 1);
    // repli : le commentaire encercle tout le texte du paragraphe.
    const m = resultat.documentXml.match(
      /<w:commentRangeStart w:id="\d+"\/>(.*?)<w:commentRangeEnd/s);
    const texteEncercle = (m[1].match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).join('');
    assert.match(texteEncercle, /Une personne en in\/capacités/,
      'le repli doit encercler le paragraphe entier : ' + m[1]);
  });

test('note : `found` introuvable dans le texte de la note -> repli commentaire sur le mot '
  + 'avant l\'appel (jamais une révision à l\'aveugle dans la note)', { skip: sansPython }, () => {
    const correspondance = [{ source: 0, sortie: 2 }];
    const alertes = [{
      rule: 'Test.Note.FoundIntrouvable', severity: 'error', action: 'fix', para: 0, span: null,
      found: 'texte-absent-de-la-note', suggested: 'remplacement', message: 'ne doit pas se localiser',
      note_id: 1, note_numero: 1,
    }];
    const resultat = anotar(PARA_AVEC_APPEL_NOTE, alertes, correspondance, {}, NOTE_RECONNAITRE);
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.revisions, 0, 'jamais de révision à l\'aveugle dans la note');
    assert.strictEqual(resultat.stats.notes.commentaires, 1);
    assert.ok(!(resultat.footnotesXml || '').includes('<w:ins'));
    const texteEncercle = (resultat.documentXml.match(
      /<w:commentRangeStart w:id="\d+"\/>(.*?)<w:commentRangeEnd/s) || [])[1];
    assert.strictEqual((texteEncercle.match(/<w:t[^>]*>([^<]*)<\/w:t>/) || [])[1], 'in/capacités',
      'le repli (found introuvable DANS la note) reste ancré sur le mot avant l\'appel, pas le paragraphe entier');
  });

// ---------------------------------------------------------------------------------
// Preuve indépendante : pandoc dans la WSL lit le document produit. --track-changes=accept
// rend le texte suggéré, =reject l'original, =all fait apparaître le texte des commentaires.

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
  console.warn('\n*** pandoc/WSL non vérifié : ' + raison + ' — la preuve indépendante n\'est '
    + 'PAS faite ***\n');
  sauter.wsl(t);
}

test('preuve indépendante pandoc : accepter/rejeter/lire les commentaires', { skip: sansPython }, (t) => {
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

// Preuve pandoc pour les notes : une révision dans footnotes.xml s'accepte et se rejette
// comme une révision du corps (Word affiche le suivi de modifications dans les notes).
test('preuve indépendante pandoc, notes : accepter/rejeter une révision DANS footnotes.xml, '
  + 'lire un commentaire ancré sur le mot avant l\'appel', (t) => {
  if (sansPandocWsl) { sauterSansWsl(t, sansPandocWsl); return; }
  const base = dossierJetable();
  try {
    const docx = path.join(base, 'preuve-notes.docx');
    fabriquerDocx(docx, PARA_AVEC_APPEL_NOTE, NOTE_RECONNAITRE);
    const alertes = [
      { rule: 'Test.Pandoc.Note.Fix', severity: 'error', action: 'fix', para: 0, span: null,
        found: 'Reconnaître', suggested: 'Reconnaitre', message: 'orthographe rectifiée',
        note_id: 1, note_numero: 1 },
    ];
    const r = python(['-c', ANNOTER_PY, PIPELINE, docx, docx, JSON.stringify(alertes),
      JSON.stringify([{ source: 0, sortie: 2 }]), JSON.stringify({})]);
    assert.strictEqual(r.status, 0, r.stderr);

    const cible = cheminVersWsl(docx);
    const accepter = wsl(['pandoc', '--track-changes=accept', '-t', 'markdown', cible]);
    assert.strictEqual(accepter.status, 0, 'pandoc --track-changes=accept a échoué : ' + accepter.stderr);
    assert.match(accepter.stdout, /Reconnaitre les personnes/,
      'la note acceptée doit porter la correction : ' + accepter.stdout);

    const rejeter = wsl(['pandoc', '--track-changes=reject', '-t', 'markdown', cible]);
    assert.strictEqual(rejeter.status, 0, 'pandoc --track-changes=reject a échoué : ' + rejeter.stderr);
    assert.match(rejeter.stdout, /Reconnaître les personnes/,
      'la note rejetée doit garder le texte d\'origine : ' + rejeter.stdout);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------
// Essai sur un manuscrit réel du corpus passé par le nettoyeur complet : le module tient sur
// une vraie sortie (runs de typographie fractionnés, tableaux fixes, styles réels). Sauté si
// tmp/ (hors git) ou la distribution WSL manquent.

test('essai réel : une sortie du nettoyeur, annotée puis relue par pandoc réel', { skip: sansPython }, (t) => {
  if (sansPandocWsl) { sauterSansWsl(t, sansPandocWsl); return; }
  if (!fs.existsSync(CORPUS_LOT_A)) {
    console.warn('\n*** corpus tmp/corpus-relecture/lot-A absent (hors git) — essai réel sauté ***\n');
    sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
    return;
  }
  const manuscrit = path.join(CORPUS_LOT_A, '3_VF_Chanier-Delorme_Article CSPS_290626.docx');
  if (!fs.existsSync(manuscrit)) { sauter.corpus(t, 'manuscrit de référence lot-A'); return; }

  const base = dossierJetable();
  try {
    const rNettoyage = python([path.join(PIPELINE, 'manuscrit-nettoyer.py'),
      manuscrit, '--produit', 'revue', '--sortie', base], { timeout: 120000 });
    const nom = path.basename(manuscrit, '.docx');
    const docxNettoye = path.join(base, nom + '-nettoye.docx');
    const rapportJson = path.join(base, nom + '-rapport.json');
    // Un échec du nettoyeur en amont saute cet essai avec un avertissement : ce fichier ne
    // teste que l'annotation.
    if (rNettoyage.status > 1 || !fs.existsSync(docxNettoye) || !fs.existsSync(rapportJson)) {
      console.warn('\n*** manuscrit-nettoyer.py a échoué (hors périmètre de ce lot) : '
        + rNettoyage.stderr.split('\n').slice(-8).join('\n') + ' ***\n');
      t.skip('manuscrit-nettoyer.py en échec, régression hors périmètre de ce lot');
      return;
    }
    const rapport = JSON.parse(fs.readFileSync(rapportJson, 'utf8'));
    const correspondance = rapport.decisions.ecriture.correspondance;

    // Le moteur de règles ne remonte rien d'ancrable sur ce fichier : l'essai fabrique une
    // alerte de démonstration. Le mot cible se choisit dans le plus long paragraphe de corps
    // produit, lu par manuscrit_annoter lui-même, car la reconnaissance d'en-tête peut
    // déplacer titre et résumé entre le corps et le tableau fixe.
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
    const rCible = python(['-c', CHOISIR_CIBLE_PY, PIPELINE, docxNettoye, JSON.stringify(correspondance)], PYTHON_OPTS);
    assert.strictEqual(rCible.status, 0, 'choix du mot cible a échoué : ' + rCible.stderr);
    const { source, mot } = JSON.parse(rCible.stdout);
    assert.ok(mot, 'aucun mot de 8 lettres ou plus trouvé dans le corps réel');

    const alertes = [
      { rule: 'Essai.Reel.Fix', severity: 'error', action: 'fix', para: source,
        span: null, found: mot, suggested: '*' + mot + '*', message: 'italique de démonstration' },
    ];
    const sortie = path.join(base, 'annote.docx');
    const r = python(['-c', ANNOTER_PY, PIPELINE, docxNettoye, sortie, JSON.stringify(alertes),
      JSON.stringify(correspondance), JSON.stringify({})], PYTHON_OPTS);
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

// ---------------------------------------------------------------------------------
// 12. Ancrage sur une entrée `bloc` : une alerte A11y.TexteAlternatif.* (para = source du
// paragraphe porteur de l'image) s'ancre sur le paragraphe entier de la clé « Texte
// alternatif : » que désigne l'entrée `correspondance` marquée `bloc`. manuscrit_gabarit.py
// écrit cette entrée pour chaque bloc figure ou tableau. Pas de recherche de `found`, pas de
// révision.

test('bloc : une alerte dont `para` a une entrée `correspondance.bloc` s\'ancre sur le '
  + 'paragraphe ENTIER de la clé, jamais une recherche de `found`', { skip: sansPython }, () => {
    const paragraphes = [
      { texte: 'Légende : ' },
      { texte: 'Texte alternatif : ' },
    ];
    // source=5 : le paragraphe porteur de l'image dans le modèle (voir la docstring de
    // _convertir_niveau_racine). Seule l'entrée `bloc` le référence.
    const correspondance = [{ source: 5, sortie: 3, bloc: 'figure' }];
    const alertes = [{
      rule: 'A11y.TexteAlternatif.Revue', severity: 'warning', action: 'comment', para: 5,
      span: null, found: null, suggested: null, message: 'Image sans texte alternatif.',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.commentaires, 1);
    assert.strictEqual(resultat.stats.revisions, 0);
    assert.strictEqual(resultat.stats.non_ancrees.length, 0, 'para=5 doit résoudre via `bloc`');
    const m = resultat.documentXml.match(
      /<w:commentRangeStart w:id="\d+"\/>(.*?)<w:commentRangeEnd/s);
    assert.ok(m, 'commentaire introuvable');
    const texteEncercle = (m[1].match(/<w:t[^>]*>([^<]*)<\/w:t>/) || [])[1];
    assert.strictEqual(texteEncercle, 'Texte alternatif : ',
      'le commentaire doit encercler tout le paragraphe de la clé, pas un passage : ' + m[1]);
    assert.match(resultat.commentsXml, /Image sans texte alternatif\./);
  });

test('bloc : l\'entrée `bloc` l\'emporte sur une entrée NORMALE qui partagerait la même '
  + '`source` (un paragraphe qui porte à la fois du texte et une image)', { skip: sansPython }, () => {
    const paragraphes = [
      { texte: 'Paragraphe de corps ordinaire, avec texte ET image.' },
      { texte: 'Texte alternatif : ' },
    ];
    // Deux entrées de même source (5) : une normale (le texte du paragraphe porteur), une
    // `bloc` (la clé de son image). L'alerte se résout vers la seconde.
    const correspondance = [
      { source: 5, sortie: 2 },
      { source: 5, sortie: 3, bloc: 'figure' },
    ];
    const alertes = [{
      rule: 'A11y.TexteAlternatif.Revue', severity: 'warning', action: 'comment', para: 5,
      span: null, found: null, suggested: null, message: 'Image sans texte alternatif.',
    }];
    const resultat = anotar(paragraphes, alertes, correspondance, {});
    validerBienFormees(resultat);
    assert.strictEqual(resultat.stats.commentaires, 1);
    const m = resultat.documentXml.match(
      /<w:commentRangeStart w:id="\d+"\/>(.*?)<w:commentRangeEnd/s);
    const texteEncercle = (m[1].match(/<w:t[^>]*>([^<]*)<\/w:t>/) || [])[1];
    assert.strictEqual(texteEncercle, 'Texte alternatif : ',
      'la clé du bloc doit l\'emporter sur le paragraphe de texte ordinaire : ' + m[1]);
    // Un seul commentaire, sur la clé : le paragraphe ordinaire n'en porte aucun.
    assert.strictEqual((resultat.documentXml.match(/<w:commentRangeStart/g) || []).length, 1);
  });

// ---------------------------------------------------------------------------------
// Langue des textes que le module ajoute lui-même (synthèse du plafond, « Note N », étiquettes,
// remarque d'italique) : français pour la Revue, allemand pour la Zeitschrift.

test('langue de : synthèse du plafond, étiquettes et note en allemand, sans espace avant « : »', { skip: sansPython }, () => {
    const paragraphes = Array.from({ length: 7 }, (_, i) => ({ texte: 'Absatz Nummer ' + i + ' zum Füllen.' }));
    const correspondance = paragraphes.map((_, i) => ({ source: i, sortie: i + 2 }));
    const alertes = paragraphes.map((_, i) => ({
      rule: 'Test.RegelA', severity: 'warning', action: 'comment', para: i, span: null,
      found: null, suggested: i === 0 ? '*Titel* neu' : null, message: 'Vorkommen ' + i,
    }));
    const resultat = anotar(paragraphes, alertes, correspondance, { langue: 'de' });
    validerBienFormees(resultat);
    assert.match(resultat.commentsXml, /… und 2 weitere Vorkommen dieser Regel, siehe Bericht\./);
    assert.ok(!/autres occurrences|voir le rapport/.test(resultat.commentsXml));
    assert.match(resultat.commentsXml, /Vorschlag: Titel neu \(Kursivteile in der Änderung\)/);
    assert.ok(!/élément/.test(resultat.commentsXml));

    const note = anotar(PARA_AVEC_APPEL_NOTE, [{
      rule: 'Test.Note.Comment', severity: 'warning', action: 'comment', para: 0, span: null,
      found: 'Reconnaître', suggested: null, message: 'Rechtschreibung',
      note_id: 1, note_numero: 1 }], [{ source: 0, sortie: 2 }], { langue: 'de' }, NOTE_RECONNAITRE);
    validerBienFormees(note);
    assert.match(note.commentsXml, /Fussnote 1: Rechtschreibung/);
    assert.match(note.commentsXml, /Textstelle: «Reconnaître»/);
  });
