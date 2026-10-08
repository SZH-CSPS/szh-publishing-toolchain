// Tests de pipeline/manuscrit-nettoyer.py, la CLI du nettoyeur de manuscrit, qui enchaîne
// manuscrit_docx, manuscrit_modele, manuscrit_typo, manuscrit_regles et manuscrit_gabarit
// (voir docs/ARCHITECTURE-nettoyeur-manuscrit.md). Contrôles :
//   1. un .docx en suivi de modifications (w:ins) est refusé, sans rien écrire ;
//   2. le code de sortie est non nul dès qu'une alerte `error` existe, nul sinon ;
//   3. chaîne complète sur un manuscrit fabriqué : le .docx produit se relit par
//      pronto-lire.py, le rapport JSON porte les traces de décision et les alertes ;
//   4. --analyse-seule n'écrit aucun .docx, mais un rapport ;
//   5. au-delà de dix occurrences d'une règle, dix sont détaillées et le total donné
//      (manuscrit_regles.grouper(), relayé tel quel jusqu'au rapport) ;
//   6. stdout porte une seule ligne, la progression va sur stderr ;
//   7. un nom de fichier accentué traverse la chaîne ;
//   8. les onze manuscrits de tmp/corpus-relecture/lot-A/ passent la chaîne sans exception
//      (sauté sous un motif nommé si le corpus est absent) ;
//   9. un fichier verrou `~$*.docx` est refusé (code 2, code_refus='fichier-verrou') avant
//      toute lecture ;
//   10. la langue de traitement vient du produit ; une langue déclarée différente (`de-CH`
//       pour la Revue) lève une alerte warning sans changer la langue utilisée ;
//   11. un repli typographique (pandoc ou WSL indisponible) lève une alerte warning et porte
//       `typographie: "repli"` sur la ligne stdout ; --sans-typo porte aussi "repli", sans
//       alerte ;
//   12. la CLI tourne dans la WSL, comme en production, et applique la typographie : c'est le
//       seul endroit où un repli silencieux se verrait ;
//   13. manuscrit_vale.py, manuscrit_biblio.py et manuscrit_annoter.py sont branchés : un
//       manuscrit porte des alertes des quatre origines (structurel, vocabulaire,
//       bibliographie, typographie), chacune avec `dans_docx` ; le .docx porte w:ins/w:del et
//       comments.xml ; --analyse-seule, --sans-annotation et --sans-reseau sont respectés.
//       Sauté si vale est absent (ni PATH ni WSL) ; SZH_VALE_OBLIGATOIRE=1 en fait un échec ;
//   14. `2-dense_…` s'annote (révisions ou commentaires posés, XML bien formé) ;
//   15. le filet de sécurité de la CLI (try/except, validation XML et restauration autour de
//       manuscrit_annoter.annoter()) est éprouvé en remplaçant mod.ma.annoter après chargement ;
//   16. `_marquer_dans_docx()` recopie `stats['devenir']` : une alerte `fix`/`track` changée en
//       commentaire par un chevauchement ressort `dans_docx: 'commentaire'`.
//
// Les .docx de test sont fabriqués par un programme Python écrit à la volée. Gardes de
// test/js/gardes.js : python() et sansPandocWsl/SZH_WSL_OBLIGATOIRE (contrôle n°12).
//
// Les commentaires « Sabotage » indiquent la modification du module qui doit faire rougir
// le test.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const gardes = require('./gardes');
const { sansPython, sansPandocWsl, sauter, cheminDepuisPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const NETTOYEUR = path.join(PIPELINE, 'manuscrit-nettoyer.py');
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');

// ---- WSL, pour le contrôle n°12. wsl.exe avale les barres inverses d'un argument de
// tableau : les chemins sont convertis en barres obliques avant l'appel.
const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
const DISTRO_WSL = 'SZH-Publishing';

// ---- vale, détecté comme dans test/js/manuscrit-vale.test.js : PATH d'abord,
// wsl.exe -d SZH-Publishing en repli.
function _valeSurPath() {
  try {
    const r = cp.spawnSync('vale', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) { return false; }
}
function _valeSurWsl() {
  try {
    const r = cp.spawnSync(WSL_EXE, ['-d', DISTRO_WSL, '--', 'bash', '-lc', 'vale --version'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) { return false; }
}
const _valeOk = _valeSurPath() || _valeSurWsl();
const sansVale = (() => {
  const motif = _valeOk ? false
    : 'vale introuvable (ni sur le PATH, ni dans la distro ' + DISTRO_WSL + ' via wsl.exe)';
  if (motif && process.env.SZH_VALE_OBLIGATOIRE) {
    throw new Error(motif + ' — SZH_VALE_OBLIGATOIRE est posé : cet outil est déclaré '
      + 'obligatoire, sauter le contrôle est refusé.');
  }
  return motif;
})();

// Lit word/document.xml brut. Le fichier produit dans la WSL se lit depuis Windows, même
// système de fichiers.
const LIRE_DOCUMENT_XML = 'import sys, zipfile\n'
  + 'z = zipfile.ZipFile(sys.argv[1])\n'
  + 'sys.stdout.write(z.read("word/document.xml").decode("utf-8"))\n';

function lireDocumentXml(chemin) {
  return gardes.pythonGroupeSortie(['-c', LIRE_DOCUMENT_XML, chemin],
    { maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
}

// Aplatit tout le texte visible de word/document.xml (concaténation de tous les <w:t>), pour
// des contrôles qui ne dépendent pas de la façon dont la typographie a redécoupé les runs.
function extraireTexteBrut(xml) {
  const morceaux = [];
  // (?:\s[^>]*)? borne le nom de balise : sans elle, `<w:t[^>]*>` reconnaît aussi `<w:tcPr>`,
  // `<w:tblPr>`, `<w:tab/>`… et avale le XML jusqu'au `</w:t>` suivant.
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    morceaux.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
  }
  return morceaux.join('');
}
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');

// PYTHONIOENCODING=utf-8 : sans elle, Python écrit son stdout dans l'encodage de la console
// Windows (cp1252), et un accent dans un nom de fichier ou dans la progression fait planter le
// processus.
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function python(args, opts) {
  return gardes.pythonGroupe(args,
    Object.assign({ maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 }, opts || {}));
}

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe || 'szh-manuscritnettoyer-'));
}

// ---------------------------------------------------------------------------------
// Fabrique un .docx minimal. `paragraphes` :
//   [{ texte, style|undefined, gras|false, taille|undefined, revision|false }, ...]
// `revision: true` enveloppe le paragraphe dans un <w:ins>, comme un texte en suivi de
// modifications. Le 3e argument facultatif `langue` (ex. 'de-CH') pose
// w:docDefaults/w:rPrDefault/w:rPr/w:lang dans styles.xml, que lit
// manuscrit_docx._langue_declaree() (contrôle n°10).
// Un paragraphe peut porter `image: { nom }` : une vraie image PNG 1x1 avec sa relation et sa
// déclaration dans [Content_Types].xml, sans `descr` sur `wp:docPr` (donc sans texte
// alternatif), que manuscrit_docx._image_depuis_drawing() reconnaît comme une image.
const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const FABRIQUER_DOCX = [
  'import base64, json, sys, zipfile',
  'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
  'langue = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'A = "http://schemas.openxmlformats.org/drawingml/2006/main"',
  'PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture"',
  'R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'medias = []   # (rid, nom, octets) — une entree par image rencontree',
  'def image_run(img):',
  '    rid = "rIdImg%d" % (len(medias) + 1)',
  '    medias.append((rid, img["nom"], base64.b64decode(img.get("octets_base64", ""))))',
  '    descr = (\' descr="%s"\' % img["alt"]) if img.get("alt") else ""',
  '    return (',
  '        \'<w:r><w:drawing><wp:inline xmlns:wp="%s">\'',
  '        \'<wp:extent cx="990000" cy="792000"/>\'',
  '        \'<wp:docPr id="1" name="Image1"%s/>\'',
  '        \'<a:graphic xmlns:a="%s"><a:graphicData uri="%s">\'',
  '        \'<pic:pic xmlns:pic="%s"><pic:blipFill><a:blip r:embed="%s" '
  + 'xmlns:r="%s"/></pic:blipFill></pic:pic>\'',
  '        \'</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>\'',
  '    ) % (WP, descr, A, PIC, PIC, rid, R)',
  'def para_xml(p):',
  '    pStyle = (\'<w:pStyle w:val="%s"/>\' % p["style"]) if p.get("style") else ""',
  '    ppr = ("<w:pPr>%s</w:pPr>" % pStyle) if pStyle else ""',
  '    if p.get("image"):',
  '        return "<w:p>%s%s</w:p>" % (ppr, image_run(p["image"]))',
  '    bits = ""',
  '    if p.get("gras"):',
  '        bits += "<w:b/>"',
  '    if p.get("taille"):',
  '        bits += \'<w:sz w:val="%d"/>\' % p["taille"]',
  '    rpr = ("<w:rPr>%s</w:rPr>" % bits) if bits else ""',
  '    run = \'<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>\' % (rpr, p.get("texte", ""))',
  '    if p.get("revision"):',
  '        run = (\'<w:ins w:id="1" w:author="essai" w:date="2026-01-01T00:00:00Z">%s</w:ins>\'',
  '               % run)',
  '    return "<w:p>%s%s</w:p>" % (ppr, run)',
  'corps = "".join(para_xml(p) for p in paras)',
  'doc = (\'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s">\'',
  '       \'<w:body>%s</w:body></w:document>\') % (W, corps)',
  'styles = \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">\' % W',
  'if langue:',
  '    styles += (\'<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="%s"/>\'',
  '               \'</w:rPr></w:rPrDefault></w:docDefaults>\') % langue',
  'for sid, nom in (("Heading1", "heading 1"), ("Normal", "Normal")):',
  '    styles += \'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' % (sid, nom)',
  'styles += "</w:styles>"',
  'extensions = {"png"}',
  'ct = (\'<?xml version="1.0"?><Types \'',
  '      \'xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\'',
  '      + "".join(\'<Default Extension="%s" ContentType="image/%s"/>\' % (e, e) for e in extensions)',
  '      + "</Types>")',
  'rels = (\'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\'',
  '        \'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\'',
  '        + "".join(\'<Relationship Id="%s" Type="http://schemas.openxmlformats.org/\'',
  '                  \'officeDocument/2006/relationships/image" Target="media/%s"/>\' % (rid, nom)',
  '                  for rid, nom, _octets in medias)',
  '        + "</Relationships>")',
  'with zipfile.ZipFile(chemin, "w") as z:',
  '    z.writestr("word/document.xml", doc.encode("utf-8"))',
  '    z.writestr("word/styles.xml", styles.encode("utf-8"))',
  '    z.writestr("[Content_Types].xml", ct)',
  '    if medias:',
  '        z.writestr("word/_rels/document.xml.rels", rels.encode("utf-8"))',
  '        for _rid, nom, octets in medias:',
  '            z.writestr("word/media/" + nom, octets)',
].join('\n');

function fabriquerDocx(chemin, paragraphes, langue) {
  const r = python(['-c', FABRIQUER_DOCX, chemin, JSON.stringify(paragraphes), langue || '']);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Un manuscrit minimal : un titre, un corps, une bibliographie de deux entrées. `avecAlerte`
// ajoute sous le titre un résumé bien trop court (400-600 signes attendus en Revue) :
// Forme.LongueurResume.Revue, sévérité `error`. Un « Mots-cles » le suit pour borner la
// capture du résumé à cette ligne (un résumé se poursuit jusqu'au marqueur suivant).
function manuscritMinimal(avecAlerte) {
  const paras = [
    { texte: "Titre de l'article sur la pedagogie specialisee", style: 'Heading1' },
  ];
  if (avecAlerte) {
    paras.push({ texte: 'Resume : Un texte beaucoup trop court pour la fourchette attendue.' });
    paras.push({ texte: 'Mots-cles : pedagogie, inclusion.' });
  }
  paras.push({ texte: 'Un premier paragraphe de corps tout a fait ordinaire et sans probleme.', taille: 24 });
  paras.push({ texte: 'References', style: 'Heading1' });
  paras.push({ texte: 'Dupont, J. (2020). Un ouvrage important. Editions Test.' });
  paras.push({ texte: 'Martin, A. (2018). Un autre ouvrage. Editions Test.' });
  return paras;
}

function nettoyer(args) {
  return python([NETTOYEUR].concat(args));
}

function ligneUniqueJson(stdout) {
  const lignes = stdout.split('\n').filter((l) => l.length > 0);
  assert.strictEqual(lignes.length, 1,
    'stdout doit porter EXACTEMENT une ligne — obtenu : ' + JSON.stringify(lignes));
  return cheminDepuisPython(JSON.parse(lignes[0]));
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 : un .docx en suivi de modifications est refusé, sans rien écrire (ni .docx ni
// rapport).
//
// Sabotage : dans principal(), remplacer `if document.revisions > 0:` par `if False:`.

test('manuscrit-nettoyer.py : refuse un .docx en suivi de modifications, sans rien écrire sur le disque',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'suivi.docx');
      fabriquerDocx(entree, [
        { texte: 'Titre' },
        { texte: 'Un texte ajoute en suivi de modifications.', revision: true },
      ]);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      assert.notStrictEqual(r.status, 0, 'le code de sortie doit être non nul');
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.refus, true);
      assert.strictEqual(obj.code_refus, 'suivi-modifications');
      assert.ok(obj.message && obj.message.length > 0, 'le message de refus doit être clair');
      assert.deepStrictEqual(fs.readdirSync(sortie), [],
        'le dossier de sortie doit rester VIDE — aucun .docx, aucun rapport');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Le refus du suivi de modifications dit, en phrases courtes, le nombre de révisions et quoi
// faire, dans la langue du produit. Cas fréquent : le fichier renvoyé est la sortie du
// nettoyeur (nom en -nettoye, ou révisions de l'auteur que pose le nettoyeur).
//
// Sabotage : dans _message_suivi_modifications(), retirer la branche `if sortie_nettoyeur`
// (ou forcer `sortie_nettoyeur = False` dans principal()) ; les trois derniers cas échouent.

function ecrireParties(chemin, remplacements, ajouts) {
  const r = python(['-c', [
    'import json, shutil, sys, zipfile',
    'chemin, rempl, ajouts = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])',
    'lu = zipfile.ZipFile(chemin)',
    'parties = {n: lu.read(n) for n in lu.namelist()}',
    'lu.close()',
    'for a, b in rempl:',
    '    parties["word/document.xml"] = parties["word/document.xml"].replace(a.encode(), b.encode())',
    'for nom, contenu in ajouts:',
    '    parties[nom] = contenu.encode()',
    'with zipfile.ZipFile(chemin, "w") as z:',
    '    for n, c in parties.items():',
    '        z.writestr(n, c)',
  ].join('\n'), chemin, JSON.stringify(remplacements || []), JSON.stringify(ajouts || [])]);
  assert.strictEqual(r.status, 0, 'retouche du .docx impossible : ' + r.stderr);
}

function refusSuivi(nomFichier, produit, remplacements) {
  const base = dossierJetable();
  try {
    const entree = path.join(base, nomFichier);
    fabriquerDocx(entree, [
      { texte: 'Titre' },
      { texte: 'Un texte ajoute en suivi de modifications.', revision: true },
    ]);
    if (remplacements) { ecrireParties(entree, remplacements); }
    const sortie = path.join(base, 'sortie');
    fs.mkdirSync(sortie);
    const r = nettoyer([entree, '--produit', produit, '--sortie', sortie, '--sans-reseau']);
    return { obj: ligneUniqueJson(r.stdout), sortie: fs.readdirSync(sortie), stderr: r.stderr };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('manuscrit-nettoyer.py : refus du suivi de modifications en une phrase qui dit quoi faire (fr)',
  { skip: sansPython }, () => {
    const { obj, sortie } = refusSuivi('suivi.docx', 'revue');
    assert.strictEqual(obj.code_refus, 'suivi-modifications');
    assert.strictEqual(obj.revisions, 1);
    assert.strictEqual(obj.sortie_nettoyeur, false);
    assert.strictEqual(obj.message,
      '1 modification(s) suivie(s) non acceptée(s). Acceptez-les ou refusez-les dans Word, puis relancez.');
    assert.doesNotMatch(obj.message, /w:ins|w:del|nettoyeur|univoque/, 'plomberie dans le message : ' + obj.message);
    assert.deepStrictEqual(sortie, []);
  });

test('manuscrit-nettoyer.py : refus du suivi de modifications, produit zeitschrift : phrase allemande',
  { skip: sansPython }, () => {
    const { obj } = refusSuivi('suivi.docx', 'zeitschrift');
    assert.strictEqual(obj.code_refus, 'suivi-modifications');
    assert.strictEqual(obj.message,
      '1 nachverfolgte Änderung(en) nicht angenommen. Nehmen Sie sie in Word an oder lehnen Sie sie ab und starten Sie dann erneut.');
  });

test('manuscrit-nettoyer.py : un fichier -nettoye.docx refusé dit que c\'est déjà la sortie du nettoyeur',
  { skip: sansPython }, () => {
    const { obj } = refusSuivi('origine-nettoye.docx', 'revue');
    assert.strictEqual(obj.code_refus, 'suivi-modifications', 'la règle de refus ne change pas');
    assert.strictEqual(obj.sortie_nettoyeur, true);
    assert.strictEqual(obj.message,
      'Ce fichier est déjà la sortie du nettoyeur : ouvrez le manuscrit d’origine.');
    assert.strictEqual(refusSuivi('origine-nettoye.docx', 'zeitschrift').obj.message,
      'Diese Datei ist bereits das Ergebnis der Bereinigung: Öffnen Sie das ursprüngliche Manuskript.');
  });

test('manuscrit-nettoyer.py : des révisions signées par le nettoyeur suffisent, même sous un autre nom',
  { skip: sansPython }, () => {
    for (const auteur of ['Relecture automatique', 'Recherche ROR/ORCID — à vérifier', 'ROR/ORCID-Suche — bitte prüfen']) {
      const { obj } = refusSuivi('renomme.docx', 'revue', [['w:author="essai"', 'w:author="' + auteur + '"']]);
      assert.strictEqual(obj.sortie_nettoyeur, true, 'auteur non reconnu : ' + auteur);
    }
    const { obj } = refusSuivi('renomme.docx', 'revue', [['w:author="essai"', 'w:author="Marie Dupont"']]);
    assert.strictEqual(obj.sortie_nettoyeur, false, 'un autre auteur ne doit pas passer pour le nettoyeur');
    assert.match(obj.message, /^1 modification\(s\) suivie\(s\)/);
  });

// ---------------------------------------------------------------------------------
// Les avertissements d'import (`[import-avertissement]`, émis par manuscrit_docx via
// szh_commun) vont dans le rapport JSON, avec leurs deux langues, et pas sur stderr. Un .docx
// qui porte un en-tête de page déclenche entetes-pieds-non-lus.
//
// Sabotage : dans principal(), retirer `szh_commun.avertir = _avertir_capture`.

test('manuscrit-nettoyer.py : les avertissements d\'import vont dans le rapport JSON, pas sur stderr',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      ecrireParties(entree, [], [['word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>']]);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau', '--sans-typo']);
      assert.ok(r.status === 0 || r.status === 1, 'statut inattendu : ' + r.status + ' ' + r.stderr);
      ligneUniqueJson(r.stdout);
      assert.doesNotMatch(r.stderr, /import-avertissement/, 'le constat fuit encore sur stderr : ' + r.stderr);
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(path.join(sortie, 'article-rapport.json'), 'utf8')));
      const constat = rapport.avertissements_import.find((a) => a.code === 'entetes-pieds-non-lus');
      assert.ok(constat, 'entetes-pieds-non-lus absent du rapport : ' + JSON.stringify(rapport.avertissements_import));
      assert.match(constat.fr, /1 en-tête\(s\)\/pied\(s\) de page/);
      assert.match(constat.de, /1 Kopf-\/Fußzeile\(n\)/);
      assert.ok(Array.isArray(rapport.journal) && rapport.journal.length >= 5,
        'la progression doit être gardée dans le rapport');
      assert.ok(rapport.journal.every((l) => l.indexOf('[manuscrit-nettoyer]') === -1),
        'le préfixe de la CLI ne doit pas être dans le rapport');
      // Un seul avertissement : la relecture de contrôle du .docx écrit ne le compte pas une
      // seconde fois.
      assert.strictEqual(rapport.avertissements_import.filter((a) => a.code === 'entetes-pieds-non-lus').length, 1,
        JSON.stringify(rapport.avertissements_import));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°2 : code de sortie non nul avec une alerte `error` (ici
// Forme.LongueurResume.Revue, résumé trop court), nul sans alerte (aucun résumé).
//
// Sabotage : dans principal(), remplacer
// `code_sortie = CODE_ALERTE_ERROR if n_error > 0 else CODE_OK` par `code_sortie = CODE_OK`.

test('manuscrit-nettoyer.py : code de sortie non nul avec une alerte error, nul sinon',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const propre = path.join(base, 'propre.docx');
      fabriquerDocx(propre, manuscritMinimal(false));
      const sortiePropre = path.join(base, 'sortie-propre');
      fs.mkdirSync(sortiePropre);
      const rPropre = nettoyer([propre, '--produit', 'revue', '--sortie', sortiePropre, '--sans-reseau']);
      const objPropre = ligneUniqueJson(rPropre.stdout);
      assert.strictEqual(objPropre.alertes_error, 0);
      assert.strictEqual(rPropre.status, 0, 'aucune alerte error : code de sortie nul');

      const fautif = path.join(base, 'fautif.docx');
      fabriquerDocx(fautif, manuscritMinimal(true));
      const sortieFautif = path.join(base, 'sortie-fautif');
      fs.mkdirSync(sortieFautif);
      const rFautif = nettoyer([fautif, '--produit', 'revue', '--sortie', sortieFautif, '--sans-reseau']);
      const objFautif = ligneUniqueJson(rFautif.stdout);
      assert.ok(objFautif.alertes_error >= 1, 'une alerte error est attendue');
      assert.notStrictEqual(rFautif.status, 0, 'au moins une alerte error : code de sortie non nul');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°3 : chaîne complète. Le .docx produit se relit par pronto-lire.py, et le rapport
// JSON porte les traces de décision et les alertes.
//
// Sabotage : dans principal(), ne pas appeler mg.ecrire().

test('manuscrit-nettoyer.py : chaîne complète — le .docx produit se relit par pronto-lire.py, le rapport porte traces et alertes',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(true));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.gabarit, 'B');
      assert.ok(fs.existsSync(obj.sortie_docx), 'le .docx nettoyé doit exister');
      assert.ok(fs.existsSync(obj.sortie_rapport), 'le rapport JSON doit exister');

      // Relecture par le lecteur de production.
      const dossierPronto = path.join(base, 'article-pronto');
      fs.mkdirSync(dossierPronto);
      const rl = python([PRONTO_LIRE, obj.sortie_docx, 'essai', dossierPronto]);
      assert.strictEqual(rl.status, 0, 'pronto-lire.py doit relire la sortie sans erreur : ' + rl.stderr);
      const statsPronto = JSON.parse(rl.stdout);
      assert.strictEqual(statsPronto.tableau1_consomme, true,
        'le premier tableau fixe du gabarit (métadonnées) doit être reconnu');
      assert.strictEqual(statsPronto.tableau2_consomme, true,
        'le second tableau fixe du gabarit (autrices et auteurs) doit être reconnu');
      assert.strictEqual(statsPronto.biblio.titre, true,
        'la bibliographie doit être reconnue par son titre à la relecture');
      assert.strictEqual(statsPronto.biblio.paragraphes, 2, 'les deux entrées doivent être détachées');

      // Le rapport JSON porte les traces de décision et les alertes.
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.ok(Array.isArray(rapport.decisions.titres.trace) && rapport.decisions.titres.trace.length > 0,
        'la trace de classement des titres doit être présente');
      assert.ok(Array.isArray(rapport.decisions.formatage.trace),
        'la trace de nettoyage de la mise en forme doit être présente');
      assert.ok(rapport.decisions.ecriture && rapport.decisions.ecriture.stats,
        'les stats de l\'écrivain doivent être recopiées dans le rapport');
      assert.strictEqual(rapport.compteurs.nb_references, 2);
      assert.ok(rapport.alertes.total >= 1, 'au moins une alerte (le résumé trop court) est attendue');
      assert.ok(rapport.alertes.liste.some((a) => a.rule === 'Forme.LongueurResume.Revue'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 : --analyse-seule n'écrit aucun .docx, mais un rapport.
//
// Sabotage : dans principal(), inverser `if args['analyse_seule']:` et son `else`.

test('manuscrit-nettoyer.py : --analyse-seule n\'écrit aucun .docx, mais bien un rapport',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--analyse-seule', '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.sortie_docx, null, 'sortie_docx doit être null en --analyse-seule');
      const fichiers = fs.readdirSync(sortie);
      assert.ok(!fichiers.some((f) => f.endsWith('.docx')), 'aucun .docx ne doit être écrit');
      assert.ok(fichiers.some((f) => f.endsWith('.json')), 'le rapport JSON doit bien être écrit');
      assert.ok(fs.existsSync(obj.sortie_rapport));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°5 : au-delà de dix occurrences d'une règle, dix sont détaillées et le total
// donné. La règle utilisée est APA.TroisAuteursPlus (warning, « et al » sans point) ; le
// mécanisme ne dépend pas de la sévérité.
//
// Sabotage : dans principal(), construire `groupes` à la main avec
// `{'par_famille': {}, 'par_regle': {r['rule']: {'total': 1, 'exemples': [r]} for r in
// alertes}}` au lieu d'appeler `_grouper_toutes_alertes(alertes)`.
//
// `obj.alertes_warning` vaut au moins 12 : si Vale manque sur le poste, Vale.Indisponible
// ajoute une warning. Le compte exact est vérifié sur le groupe de la règle.

test('manuscrit-nettoyer.py : au-delà de dix occurrences d\'une même règle, dix détaillées et le total donné',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const paras = [{ texte: "Titre de l'article", style: 'Heading1' }];
      for (let i = 0; i < 12; i += 1) {
        paras.push({ texte: 'Selon Dupont et al ' + (2000 + i) + ', ceci est le paragraphe numero ' + i + '.', taille: 24 });
      }
      const entree = path.join(base, 'seuil.docx');
      fabriquerDocx(entree, paras);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.ok(obj.alertes_warning >= 12,
        'les douze occurrences doivent toutes être comptées : ' + obj.alertes_warning);
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      const groupe = rapport.alertes.groupes.par_regle['APA.TroisAuteursPlus'];
      assert.ok(groupe, 'le groupe de cette règle doit exister');
      assert.strictEqual(groupe.total, 12, 'le TOTAL doit rester 12');
      assert.strictEqual(groupe.exemples.length, 10, 'AU PLUS dix exemples détaillés');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 : stdout porte une seule ligne, en JSON ; la progression va sur stderr, en
// plusieurs lignes.
//
// Sabotage : dans progres(), remplacer `file=sys.stderr` par `file=sys.stdout`.

test('manuscrit-nettoyer.py : stdout ne porte qu\'une seule ligne JSON, la progression est sur stderr',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout); // lève déjà si stdout porte plus d'une ligne
      assert.strictEqual(typeof obj.code_sortie, 'number');

      const lignesErr = r.stderr.split('\n').filter((l) => l.length > 0);
      assert.ok(lignesErr.length >= 3, 'la progression doit compter plusieurs lignes sur stderr');
      for (const ligne of lignesErr) {
        assert.ok(ligne.startsWith('[manuscrit-nettoyer]'),
          'chaque ligne de progression doit porter le préfixe attendu : ' + JSON.stringify(ligne));
        assert.throws(() => JSON.parse(ligne), 'une ligne de progression ne doit jamais être du JSON analysable');
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°7 : un nom de fichier accentué traverse la chaîne sans erreur d'encodage. Le
// script reconfigure stdout et stderr en UTF-8 (pipeline/pronto-lire.py ne le fait pas).
//
// Ce test tourne sans PYTHONIOENCODING (ENV_SANS_PIOE) : avec ENV_UTF8, Python partirait déjà
// en UTF-8 et le test ne verrait pas l'absence de reconfigure(). Sans elle, Python retombe
// sur l'encodage de la console (cp1252).
//
// Sabotage : dans _forcer_utf8(), ne reconfigurer que sys.stdout ; la progression sur stderr
// sort en cp1252 (« entr\xe9e » au lieu de « entr\xc3\xa9e »). Il ne rougit que sous
// ENV_SANS_PIOE.

const ENV_SANS_PIOE = Object.assign({}, process.env);
delete ENV_SANS_PIOE.PYTHONIOENCODING;

test('manuscrit-nettoyer.py : un nom de fichier accentué traverse toute la chaîne sans plantage d\'encodage',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'Étude accentuée été à côté.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      const sortie = path.join(base, 'sortie accentuée');
      fs.mkdirSync(sortie);
      const r = gardes.pythonGroupe(
        [NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau'],
        { maxBuffer: 64 * 1024 * 1024, env: ENV_SANS_PIOE });
      assert.strictEqual(r.status, 0, 'ne doit pas planter sur un nom accentué : ' + r.stderr);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.entree, entree);
      assert.ok(fs.existsSync(obj.sortie_docx), 'le .docx accentué doit exister : ' + obj.sortie_docx);
      assert.ok(path.basename(obj.sortie_docx).startsWith('Étude accentuée'));
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.strictEqual(rapport.entree, entree);
      // La progression accentuée est lisible sans PYTHONIOENCODING : c'est reconfigure() qui
      // le garantit.
      assert.ok(r.stderr.includes(gardes.cheminPython(entree)), 'la progression doit reproduire le nom accentué '
        + 'intact, sans PYTHONIOENCODING dans l\'environnement');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°8 : les onze manuscrits du corpus passent la chaîne sans exception. tmp/ est
// hors git et peut être effacé : le test est alors sauté sous un motif nommé.

test('manuscrit-nettoyer.py : les onze manuscrits réels de lot-A passent la chaîne complète sans exception',
  { skip: sansPython }, (t) => {
    if (!fs.existsSync(CORPUS_LOT_A)) {
      sauter.corpus(t, 'tmp/corpus-relecture/lot-A (hors git, effacé sans prévenir)');
      return;
    }
    const fichiers = fs.readdirSync(CORPUS_LOT_A).filter((n) => n.toLowerCase().endsWith('.docx'));
    assert.ok(fichiers.length > 0, 'aucun .docx trouvé dans lot-A alors que le dossier existe');
    const base = dossierJetable();
    try {
      const echecs = [];
      const resumes = [];
      const debut = Date.now();
      for (const nomFichier of fichiers) {
        const entree = path.join(CORPUS_LOT_A, nomFichier);
        const dossierSortie = path.join(base, path.basename(nomFichier, '.docx'));
        fs.mkdirSync(dossierSortie, { recursive: true });
        // --sans-reseau : le contrôle porte sur la chaîne, pas sur Crossref ; il reste rapide
        // et déterministe.
        const r = nettoyer([entree, '--produit', 'revue', '--sortie', dossierSortie, '--sans-reseau']);
        // Un refus (suivi de modifications…) est un résultat légitime. Seuls un code de
        // sortie inattendu (ni 0, ni 1 alerte error, ni 2 refus) ou un traceback Python
        // comptent comme un échec.
        const traceback = /Traceback \(most recent call last\)/.test(r.stderr);
        if (traceback || ![0, 1, 2].includes(r.status)) {
          echecs.push(nomFichier + ' (code ' + r.status + ') : ' + r.stderr.slice(-500));
          continue;
        }
        let obj;
        try {
          obj = ligneUniqueJson(r.stdout);
        } catch (e) {
          echecs.push(nomFichier + ' (stdout non conforme) : ' + e.message);
          continue;
        }
        resumes.push({ fichier: nomFichier, refus: !!obj.refus, code_refus: obj.code_refus || null,
          gabarit: obj.gabarit || null, alertes_error: obj.alertes_error });
      }
      const dureeMs = Date.now() - debut;
      t.diagnostic('lot-A : ' + fichiers.length + ' fichier(s) en ' + dureeMs + ' ms ; résumés : '
        + JSON.stringify(resumes));
      assert.deepStrictEqual(echecs, [], 'ces manuscrits ont fait planter la chaîne complète');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°9 : un fichier verrou `~$*.docx` est refusé avant toute lecture (code 2), sans
// l'exception « File is not a zip file ».
//
// Sabotage : dans principal(), retirer le bloc
// `if os.path.basename(entree).startswith('~$'): return refuser(...)`.

test('manuscrit-nettoyer.py : refuse un fichier verrou ~$*.docx avant toute lecture',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, '~$verrou.docx');
      // Un verrou Word n'est pas un zip valide : quelques octets suffisent.
      fs.writeFileSync(entree, Buffer.from([0, 1, 2, 3]));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      assert.notStrictEqual(r.status, 0, 'le code de sortie doit être non nul');
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.refus, true);
      assert.strictEqual(obj.code_refus, 'fichier-verrou');
      assert.strictEqual(obj.code_sortie, 2);
      assert.ok(obj.message && obj.message.length > 0, 'le message de refus doit être clair');
      assert.deepStrictEqual(fs.readdirSync(sortie), [],
        'le dossier de sortie doit rester VIDE — aucun .docx, aucun rapport');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°10 : la langue de traitement vient du produit, pas de la langue déclarée du
// document ; un désaccord lève une alerte warning sans changer la langue utilisée.
//
// Sabotage : dans principal(), remplacer `langue = 'fr' if args['produit'] == 'revue' else 'de'`
// par `langue = document.langue or 'fr'` ; Langue.DesaccordProduit disparaît.

test('manuscrit-nettoyer.py : la langue de traitement vient du produit ; un désaccord lève une alerte warning sans changer la langue utilisée',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      // Document déclaré en allemand (de-CH), traité comme un article de la Revue (fr).
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false), 'de-CH');
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      // --sans-typo : le contrôle porte sur la langue et l'alerte ; il ne dépend pas de
      // pandoc ni de la WSL.
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-typo', '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.strictEqual(rapport.langue, 'fr',
        'la langue UTILISÉE doit rester celle du produit (fr), jamais celle du document');
      const alerteLangue = rapport.alertes.liste.find((a) => a.rule === 'Langue.DesaccordProduit');
      assert.ok(alerteLangue, 'aucune alerte de désaccord de langue : ' + JSON.stringify(rapport.alertes.liste));
      assert.strictEqual(alerteLangue.severity, 'warning');
      assert.ok(alerteLangue.message && alerteLangue.message.length > 0);

      // Un document déclaré dans la langue du produit ne lève rien.
      const entreeCoherente = path.join(base, 'coherent.docx');
      fabriquerDocx(entreeCoherente, manuscritMinimal(false), 'fr-CH');
      const sortieCoherente = path.join(base, 'sortie-coherente');
      fs.mkdirSync(sortieCoherente);
      const rCoherent = nettoyer([entreeCoherente, '--produit', 'revue', '--sortie', sortieCoherente, '--sans-typo', '--sans-reseau']);
      const objCoherent = ligneUniqueJson(rCoherent.stdout);
      const rapportCoherent = cheminDepuisPython(JSON.parse(fs.readFileSync(objCoherent.sortie_rapport, 'utf8')));
      assert.ok(!rapportCoherent.alertes.liste.some((a) => a.rule === 'Langue.DesaccordProduit'),
        'fr-CH sur un article de la Revue ne doit lever aucune alerte de langue');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°11 : un repli typographique lève une alerte warning et porte
// `typographie: "repli"` sur la ligne stdout ; --sans-typo porte aussi "repli", sans alerte.
//
// Pour provoquer un vrai repli sans toucher à wsl.exe ni au PATH (python en dépend aussi), le
// test copie le pipeline sans le filtre typographique : pandoc échoue alors sur
// `--lua-filter <introuvable>`. sansPandocWsl garantit que l'échec vient du filtre manquant.
//
// Sabotages : (a) dans principal(), retirer
// `if statut_typo == 'repli': alertes_manuelles.append(_alerte_repli_typo())` ; (b) ajouter
// `statut_typo = 'appliquee'` juste avant la ligne stdout.

test('manuscrit-nettoyer.py : un repli typographique réel lève une alerte warning et porte typographie: "repli"',
  { skip: sansPython || sansPandocWsl }, () => {
    const base = dossierJetable();
    try {
      const pipelineCopie = path.join(base, 'pipeline');
      fs.cpSync(PIPELINE, pipelineCopie, { recursive: true });
      fs.rmSync(path.join(pipelineCopie, 'filters', 'szh-typographie.lua'));
      const nettoyeurCopie = path.join(pipelineCopie, 'manuscrit-nettoyer.py');

      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      // --analyse-seule : le contrôle porte sur le repli, pas sur l'écriture au gabarit (qui
      // a besoin de revue-template/, non copié ici).
      const r = python([nettoyeurCopie, entree, '--produit', 'revue', '--sortie', sortie,
        '--analyse-seule', '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.typographie, 'repli',
        'la ligne stdout doit porter typographie: "repli" : ' + JSON.stringify(obj));
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.strictEqual(rapport.decisions.typographie.statut, 'repli');
      const alerteRepli = rapport.alertes.liste.find((a) => a.rule === 'Typo.ApplicationImpossible');
      assert.ok(alerteRepli, 'aucune alerte de repli typographique : ' + JSON.stringify(rapport.alertes.liste));
      assert.strictEqual(alerteRepli.severity, 'warning');
      assert.ok(alerteRepli.message
        && !/wsl|\.py\b|\.lua\b|code de sortie|stderr|stdout/i.test(alerteRepli.message),
        'le message ne doit nommer aucune plomberie : ' + alerteRepli.message);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit-nettoyer.py : --sans-typo porte "repli" sur la ligne stdout mais ne lève PAS l’alerte (choix explicite, pas une panne)',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-typo', '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.typographie, 'repli');
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.strictEqual(rapport.sans_typo, true);
      assert.ok(!rapport.alertes.liste.some((a) => a.rule === 'Typo.ApplicationImpossible'),
        '--sans-typo ne doit pas produire l’alerte de repli : ' + JSON.stringify(rapport.alertes.liste));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°12 : la CLI tourne dans la WSL, comme en production
// (`wsl -d SZH-Publishing -e python3 pipeline/manuscrit-nettoyer.py`), sur un manuscrit dont
// la typographie française doit être appliquée. Un repli rendrait `typographie: "repli"`.

test('manuscrit-nettoyer.py : LE test de production — la CLI tourne DANS la WSL et applique la typographie française',
  { skip: sansPython || sansPandocWsl }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, [
        { texte: "Titre de l'article", style: 'Heading1' },
        // Guillemets courbes en entrée, comme les pose l'autocorrection de Word : le filtre ne
        // construit pas de nœud Quoted pandoc (voir l'en-tête de manuscrit_typo.py), et des
        // guillemets droits restent inchangés.
        { texte: 'Voir p. 5 : l\'exemple “cité” ?', taille: 24 },
        { texte: 'References', style: 'Heading1' },
        { texte: 'Dupont, J. (2020). Un ouvrage important. Editions Test.' }
      ]);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);

      const r = gardes.pythonGroupe([NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie,
        '--sans-reseau'], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
      assert.strictEqual(r.status, 0,
        'la CLI doit réussir dans la WSL : ' + r.stderr + ' / ' + r.stdout);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.typographie, 'appliquee',
        'la typographie doit vraiment s’appliquer DANS la WSL, pas un repli silencieux : '
        + JSON.stringify(obj));

      const cheminDocxWindows = cheminDepuisPython(obj.sortie_docx);
      const xml = lireDocumentXml(cheminDocxWindows);
      const texte = extraireTexteBrut(xml);
      assert.match(texte, /[  ]:/, 'aucune insécable devant « : »');
      assert.match(texte, /[  ]\?/, 'aucune insécable devant « ? »');
      assert.match(texte, /l’exemple/, 'l’apostrophe n’a pas été rendue typographique');
      assert.match(texte, /«[  ]cité[  ]»/,
        'les chevrons français avec insécables sont absents : ' + JSON.stringify(texte));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Les alertes que la CLI émet elle-même (ici Langue.DesaccordProduit) portent l'origine
// `nettoyage` : la somme des origines vaut le total, chaque alerte porte la sienne.
// Sabotage : retirer l'appel _etiqueter d'un lot d'alertes de la CLI ; la somme passe sous le
// total, ou `a['origine']` lève KeyError.
test('manuscrit-nettoyer.py : la somme de alertes.origine vaut alertes.total, les alertes de la CLI sont comptées sous `nettoyage`',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false), 'de-CH');
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-typo', '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      const origine = rapport.alertes.origine;
      assert.ok(origine.nettoyage >= 1, 'Langue.DesaccordProduit doit compter sous nettoyage : ' + JSON.stringify(origine));
      assert.strictEqual(Object.values(origine).reduce((x, y) => x + y, 0), rapport.alertes.total,
        'somme des origines différente du total : ' + JSON.stringify(origine));
      for (const a of rapport.alertes.liste) {
        assert.ok(a.origine in origine, 'alerte sans origine reconnue : ' + JSON.stringify(a));
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Les trois alertes que la CLI émet sans passer par un moteur (repli typographique, Vale
// indisponible, annotation impossible) suivent la langue de traitement : français pour la
// Revue, allemand pour la Zeitschrift. Sabotage : retirer la branche allemande d'une des trois.
// Les trois fonctions n'ont pas de langue par défaut ; le test suivant vérifie les appels.
test('manuscrit-nettoyer.py : les alertes propres à la CLI (repli typo, Vale indisponible, annotation impossible) sortent en allemand pour la Zeitschrift',
  { skip: sansPython }, () => {
    const PONT = [
      'import importlib.util, json, sys',
      'dossier_pipeline, chemin_nettoyeur = sys.argv[1], sys.argv[2]',
      'sys.path.insert(0, dossier_pipeline)',
      'spec = importlib.util.spec_from_file_location("nettoyeur_langue", chemin_nettoyeur)',
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'sys.stdout.reconfigure(encoding="utf-8")',
      'print(json.dumps({l: [mod._alerte_repli_typo(l)["message"],',
      '                      mod._alerte_vale_indisponible(l)["message"],',
      '                      mod._alerte_annotation_impossible(l)["message"]]',
      '                  for l in ("fr", "de")}, ensure_ascii=False))',
    ].join(String.fromCharCode(10));
    const r = python(['-c', PONT, PIPELINE, NETTOYEUR]);
    assert.strictEqual(r.status, 0, r.stderr);
    const m = JSON.parse(r.stdout);
    assert.match(m.fr[0], /^La typographie/);
    assert.match(m.fr[1], /^Le contrôle/);
    assert.match(m.fr[2], /^Les corrections/);
    assert.match(m.de[0], /^Die Typografie/);
    assert.match(m.de[1], /^Die Prüfung/);
    assert.match(m.de[2], /^Die Korrekturen/);
  });

// Chaque site d'appel des trois alertes passe la langue : un oubli rendrait du français dans la
// Zeitschrift sur des chemins rares (Vale absent, annotation en échec), d'où un contrôle par
// l'arbre syntaxique. Sabotage : retirer `langue` d'un des appels, ou remettre `langue='fr'` en
// défaut.
test('manuscrit-nettoyer.py : les trois alertes de la CLI reçoivent la langue à chaque site d’appel, sans défaut',
  { skip: sansPython }, () => {
    const PONT = [
      'import ast, json, sys',
      'arbre = ast.parse(open(sys.argv[1], encoding="utf-8").read())',
      'noms = ("_alerte_repli_typo", "_alerte_vale_indisponible", "_alerte_annotation_impossible")',
      'defauts = {n.name: len(n.args.defaults) for n in ast.walk(arbre)',
      '           if isinstance(n, ast.FunctionDef) and n.name in noms}',
      'appels = {n: [] for n in noms}',
      'for n in ast.walk(arbre):',
      '    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in noms:',
      '        appels[n.func.id].append(len(n.args) + len(n.keywords))',
      'print(json.dumps({"defauts": defauts, "appels": appels}))',
    ].join(String.fromCharCode(10));
    const r = python(['-c', PONT, NETTOYEUR]);
    assert.strictEqual(r.status, 0, r.stderr);
    const m = JSON.parse(r.stdout);
    for (const nom of ['_alerte_repli_typo', '_alerte_vale_indisponible', '_alerte_annotation_impossible']) {
      assert.strictEqual(m.defauts[nom], 0, nom + ' ne doit pas avoir de langue par défaut');
      assert.ok(m.appels[nom].length >= 1, nom + ' n’est plus appelée par la CLI');
      assert.ok(m.appels[nom].every((n) => n === 1), nom + ' appelée sans langue : ' + JSON.stringify(m.appels[nom]));
    }
  });

// ---------------------------------------------------------------------------------
// Origine des alertes : chaque lot est étiqueté là où il rejoint la liste, et l'étiquette est
// vérifiée sur une exécution réelle, règle par règle. Les sources rares (identifiants, perte,
// écartés, notes reprises, réseau, annotation, conversion .odt, Vale absent, repli typo) sont
// provoquées par injection au chargement du module, comme au contrôle n°15. Sabotage :
// étiqueter un lot d'un mauvais nom, ou l'oublier, dans manuscrit-nettoyer.py.
function origineAttendue(regle) {
  if (/^Typo\./.test(regle)) return 'typographie';
  if (/^(Langue|Annotation|Nettoyage|Reseau)\./.test(regle)) return 'nettoyage';
  if (/^Identifiants\./.test(regle)) return 'identifiants';
  if (/^(CSPS|SZH)[.-]/.test(regle) || regle === 'Vale.Indisponible') return 'vale';
  if (/^APA\./.test(regle)) return 'bibliographie';
  return 'regles';
}

function lancerAvecInjections(injections, entree, sortie, argsCli) {
  const PONT = [
    'import importlib.util, sys',
    'dossier_pipeline, chemin_nettoyeur = sys.argv[1], sys.argv[2]',
    'sys.path.insert(0, dossier_pipeline)',
    'spec = importlib.util.spec_from_file_location("nettoyeur_origine", chemin_nettoyeur)',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'def alerte(regle):',
    '    return {"rule": regle, "severity": "warning", "action": "report", "para": None,',
    '            "span": None, "found": None, "suggested": None, "message": "injectee"}',
  ].concat(injections, [
    'sys.argv = [chemin_nettoyeur] + sys.argv[3:]',
    'sys.exit(mod.principal(sys.argv))',
  ]).join(String.fromCharCode(10));
  const r = python(['-c', PONT, PIPELINE, NETTOYEUR, entree, '--sortie', sortie, '--sans-reseau'].concat(argsCli));
  const obj = ligneUniqueJson(r.stdout);
  return cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
}

function verifierOrigines(rapport) {
  const origine = rapport.alertes.origine;
  assert.ok(!('inconnue' in origine), 'alerte sans origine valide : ' + JSON.stringify(origine));
  assert.strictEqual(Object.values(origine).reduce((x, y) => x + y, 0), rapport.alertes.total);
  for (const a of rapport.alertes.liste) {
    assert.strictEqual(a.origine, origineAttendue(a.rule),
      a.rule + ' étiquetée ' + a.origine + ' au lieu de ' + origineAttendue(a.rule));
  }
}

test('manuscrit-nettoyer.py : chaque lot d’alertes porte la bonne origine sur une exécution réelle (regles, vale, bibliographie, identifiants, typographie, nettoyage)',
  { skip: sansPython || sansVale }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'origines.docx');
      fabriquerDocx(entree, fixtureQuatreOrigines(), 'de-CH');
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const rapport = lancerAvecInjections([
        'def _ident(auteurs, *a, **k):',
        '    alertes, stats = _ident_reel(auteurs, *a, **k)',
        '    return alertes + [alerte("Identifiants.Injection")], stats',
        '_ident_reel = mod.mi.enrichir_auteurs',
        'mod.mi.enrichir_auteurs = _ident',
        'def _perte(*a, **k):',
        '    _, mesure = _perte_reelle(*a, **k)',
        '    return alerte("Nettoyage.ContenuPerdu"), mesure',
        '_perte_reelle = mod._controler_perte',
        'mod._controler_perte = _perte',
        'mod._alerte_ecartes = lambda e, l: alerte("Nettoyage.ContenuEcarte")',
        'mod.mg.alerte_notes_reprises = lambda t, l: alerte("Nettoyage.NoteReprise")',
        '_reseau = mod._alerte_recherche_impossible',
        'mod._alerte_recherche_impossible = lambda a, b, l: _reseau(True, True, l)',
        'def _annoter_sabote(*a, **k):',
        '    raise ValueError("injection")',
        'mod.ma.annoter = _annoter_sabote',
        'def _convertir_sabote(*a, **k):',
        '    raise mod.conversion_odt.ConversionImpossible("injection")',
        'mod.conversion_odt.convertir = _convertir_sabote',
      ], entree, sortie, ['--produit', 'revue', '--format', 'odt']);
      verifierOrigines(rapport);
      const origine = rapport.alertes.origine;
      for (const cle of ['regles', 'vale', 'bibliographie', 'identifiants', 'typographie', 'nettoyage']) {
        assert.ok(origine[cle] >= 1, 'aucune alerte d’origine "' + cle + '" : ' + JSON.stringify(origine));
      }
      const regles = rapport.alertes.liste.map((a) => a.rule);
      for (const r of ['Langue.DesaccordProduit', 'Reseau.RechercheImpossible', 'Nettoyage.ContenuPerdu',
        'Nettoyage.ContenuEcarte', 'Nettoyage.NoteReprise', 'Annotation.Impossible',
        'Nettoyage.ConversionOdtImpossible']) {
        assert.ok(regles.includes(r), r + ' absente : ' + JSON.stringify(regles));
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit-nettoyer.py : Vale indisponible et repli typographique portent leur origine (vale, typographie)',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'panne.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const rapport = lancerAvecInjections([
        'mod.mv.analyser = lambda *a, **k: ([], True)',
        'mod.mt.normaliser_paragraphes = lambda paras, *a, **k: (paras, [], [], [], "repli")',
      ], entree, sortie, ['--produit', 'revue']);
      verifierOrigines(rapport);
      const regles = rapport.alertes.liste.map((a) => a.rule);
      assert.ok(regles.includes('Vale.Indisponible') && regles.includes('Typo.ApplicationImpossible'),
        JSON.stringify(regles));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

test('manuscrit-nettoyer.py : une alerte sans origine valide est comptée sous `inconnue` et tracée, jamais un plantage',
  { skip: sansPython }, () => {
    const PONT = [
      'import importlib.util, json, sys',
      'sys.path.insert(0, sys.argv[1])',
      'spec = importlib.util.spec_from_file_location("nettoyeur_inconnue", sys.argv[2])',
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'sys.stderr = open(__import__("os").devnull, "w")',
      'al = [{"rule": "A", "origine": "regles"}, {"rule": "B"}, {"rule": "C", "origine": "faute"}]',
      'bon = mod._compter_origines([{"rule": "A", "origine": "vale"}])',
      'mal = mod._compter_origines(al)',
      'print(json.dumps({"bon": bon, "mal": mal, "etiquettes": [a["origine"] for a in al],',
      '                  "journal": mod._JOURNAL_PROGRES}))',
    ].join(String.fromCharCode(10));
    const r = python(['-c', PONT, PIPELINE, NETTOYEUR]);
    assert.strictEqual(r.status, 0, r.stderr);
    const m = JSON.parse(r.stdout);
    assert.ok(!('inconnue' in m.bon), 'la clé inconnue ne doit apparaître qu’en cas de défaut');
    assert.strictEqual(m.mal.inconnue, 2);
    assert.strictEqual(m.mal.regles, 1);
    assert.deepStrictEqual(m.etiquettes, ['regles', 'inconnue', 'inconnue']);
    assert.strictEqual(m.journal.length, 2);
  });

// `plafond_commentaires_atteint` suit le plafond global de l'annoteur (`plafond_global`), pas le
// nombre de commentaires écrits : 25 commentaires et un doublon retiré ne sont pas un plafond.
// Sabotage : revenir à `ecrits >= 25 and renvoyees_au_rapport`.
test('manuscrit-nettoyer.py : plafond_commentaires_atteint suit le plafond global, pas les doublons retirés',
  { skip: sansPython }, () => {
    const PONT = [
      'import importlib.util, json, sys',
      'sys.path.insert(0, sys.argv[1])',
      'spec = importlib.util.spec_from_file_location("nettoyeur_plafond", sys.argv[2])',
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'al = [{"rule": "R", "dans_docx": "commentaire"} for _ in range(25)]',
      'def mesure(stats):',
      '    m = mod._mesures_passage("ok", 1, {"produit": "revue", "sans_typo": False}, "B", "docx",',
      '        "docx", al, None, 0, 0, 0, 0, 0, 0, 0, stats, False, None, None, False, "appliquee",',
      '        None, None, None, None)',
      '    return m.get("plafond_commentaires_atteint", 0)',
      'print(json.dumps({"doublon": mesure({"renvoyees_au_rapport": [{}], "plafond_global": 0}),',
      '                  "plafond": mesure({"renvoyees_au_rapport": [{}], "plafond_global": 1})}))',
    ].join(String.fromCharCode(10));
    const r = python(['-c', PONT, PIPELINE, NETTOYEUR]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(r.stdout), { doublon: 0, plafond: 1 });
  });

// ---------------------------------------------------------------------------------
// Contrôle n°13 : branchement de manuscrit_vale.py, manuscrit_biblio.py et
// manuscrit_annoter.py. La fixture porte une alerte de chaque origine, chacune sur son
// paragraphe, sans que deux alertes visent le même passage. La phrase de la citation ne
// contient pas « et » avant la citation : un `found` court et banal pourrait s'ancrer sur sa
// première occurrence. « Introduction » (Heading1) après le titre referme la zone d'en-tête :
// sans lui, la phrase épicène serait prise pour un sous-titre et n'atteindrait pas Vale.

function fixtureQuatreOrigines() {
  return [
    { texte: "Titre de l'article sur l'inclusion scolaire", style: 'Heading1' },
    { texte: 'Introduction', style: 'Heading1' },
    // Vale, CSPS.Epicene.FormesContractees (error, action=comment).
    { texte: 'Les enseignant(e)s accompagnent les eleves au quotidien.' },
    // Vale (CSPS.APA.EtDansParentheses, fix) et manuscrit_biblio (APA.CitationAbsente,
    // comment) sur la même parenthèse, sans collision : l'un corrige, l'autre commente.
    { texte: 'Plusieurs travaux le confirment (Dupont et Martin, 2020).' },
    // Typo.guillemets-droits (C2) : un guillemet droit isolé, que pandoc n'apparie pas.
    { texte: 'Il ecrit "quelque chose de curieux, sans doute avoir raison.' },
    // A11y.TexteAlternatif.Revue (structurel) : image sans alt.
    { image: { nom: 'fig1.png', octets_base64: PNG_1X1_B64 } },
    { texte: 'References', style: 'Heading1' },
    // manuscrit_biblio : APA.ReferenceNonCitee et APA.DoiForme (DOI nu, sans préfixe). La
    // forme « doi: » ferait aussi lever CSPS-Biblio.APA.DoiForme de Vale sur le même texte.
    { texte: 'Muster, E. (2020). Un document. 10.1000/x' },
  ];
}

test('manuscrit-nettoyer.py : les quatre origines (structurel, vocabulaire, bibliographie, typographie) sont branchées, dans_docx renseigné, révisions et commentaires posés',
  { skip: sansPython || sansVale }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'quatre-origines.docx');
      fabriquerDocx(entree, fixtureQuatreOrigines());
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie]);
      const obj = ligneUniqueJson(r.stdout);
      assert.ok(fs.existsSync(obj.sortie_docx));
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));

      // Les quatre origines, chacune avec au moins une alerte.
      const origine = rapport.alertes.origine;
      for (const cle of ['regles', 'vale', 'bibliographie', 'typographie']) {
        assert.ok(origine[cle] >= 1, 'origine "' + cle + '" absente : ' + JSON.stringify(origine));
      }
      assert.strictEqual(
        Object.values(origine).reduce((x, y) => x + y, 0),
        rapport.alertes.total, 'la somme des origines doit couvrir TOUTES les alertes');

      // controles.vale dit si le contrôle a vraiment tourné.
      assert.strictEqual(rapport.controles.vale, 'effectue');

      // Chaque alerte porte `dans_docx`.
      for (const a of rapport.alertes.liste) {
        assert.ok(['revision', 'commentaire', 'rapport'].includes(a.dans_docx),
          'alerte ' + a.rule + ' sans dans_docx exploitable : ' + JSON.stringify(a));
      }
      const epicene = rapport.alertes.liste.find((a) => a.rule === 'CSPS.Epicene.FormesContractees');
      assert.ok(epicene, 'CSPS.Epicene.FormesContractees absente : '
        + JSON.stringify(rapport.alertes.liste.map((a) => a.rule)));
      assert.strictEqual(epicene.dans_docx, 'commentaire');
      const doi = rapport.alertes.liste.find((a) => a.rule === 'APA.DoiForme');
      assert.ok(doi, 'APA.DoiForme absente');
      assert.strictEqual(doi.dans_docx, 'revision');
      assert.strictEqual(doi.suggested, 'https://doi.org/10.1000/x');

      // --sans-reseau (posé par nettoyer()) : aucune tentative Crossref.
      assert.strictEqual(rapport.bibliographie.crossref.indisponible, true);

      // Le .docx produit porte w:del/w:ins (le DOI) et comments.xml (la forme épicène), lus
      // par zipfile.
      const LIRE_MARQUES = [
        'import sys, zipfile',
        'z = zipfile.ZipFile(sys.argv[1])',
        'doc = z.read("word/document.xml").decode("utf-8")',
        'import json',
        'print(json.dumps({',
        '    "w_ins": doc.count("<w:ins "),',
        '    "w_del": doc.count("<w:del "),',
        '    "comments_xml": "word/comments.xml" in z.namelist(),',
        '    "comments_text": z.read("word/comments.xml").decode("utf-8")',
        '                     if "word/comments.xml" in z.namelist() else "",',
        '}))',
      ].join('\n');
      const rMarques = python(['-c', LIRE_MARQUES, obj.sortie_docx]);
      assert.strictEqual(rMarques.status, 0, 'lecture des marques a échoué : ' + rMarques.stderr);
      const marques = JSON.parse(rMarques.stdout);
      // « 10.1000/x » -> « https://doi.org/10.1000/x » est une insertion pure (diff par
      // jeton) : un w:ins sans w:del est le résultat attendu. Cette fixture ne garantit que
      // w:ins.
      assert.ok(marques.w_ins >= 1,
        'le DOI corrigé doit apparaître en révision (w:ins) : ' + JSON.stringify(marques));
      assert.ok(marques.comments_xml, 'comments.xml doit exister (la forme épicène commentée)');
      assert.ok(marques.comments_text.indexOf('CSPS.Epicene.FormesContractees') !== -1,
        'le commentaire ne cite pas la règle : ' + marques.comments_text);

      // --analyse-seule n'écrit que le rapport, vérifié aussi sur cette fixture aux quatre
      // moteurs.
      const sortieAs = path.join(base, 'sortie-analyse-seule');
      fs.mkdirSync(sortieAs);
      const rAs = nettoyer([entree, '--produit', 'revue', '--sortie', sortieAs, '--analyse-seule']);
      const objAs = ligneUniqueJson(rAs.stdout);
      assert.strictEqual(objAs.sortie_docx, null);
      assert.ok(!fs.readdirSync(sortieAs).some((f) => f.endsWith('.docx')));

      // --sans-annotation : le .docx est écrit, sans révision ni commentaire.
      const sortieSa = path.join(base, 'sortie-sans-annotation');
      fs.mkdirSync(sortieSa);
      const rSa = nettoyer([entree, '--produit', 'revue', '--sortie', sortieSa, '--sans-annotation']);
      const objSa = ligneUniqueJson(rSa.stdout);
      const rapportSa = cheminDepuisPython(JSON.parse(fs.readFileSync(objSa.sortie_rapport, 'utf8')));
      assert.strictEqual(rapportSa.annotation, null);
      assert.ok(!rapportSa.alertes.liste.some((a) => a.dans_docx),
        '--sans-annotation ne doit jamais poser dans_docx');
      const rMarquesSa = python(['-c', LIRE_MARQUES, objSa.sortie_docx]);
      const marquesSa = JSON.parse(rMarquesSa.stdout);
      assert.strictEqual(marquesSa.w_ins, 0, '--sans-annotation ne doit poser aucune révision');
      assert.strictEqual(marquesSa.w_del, 0);
      assert.strictEqual(marquesSa.comments_xml, false,
        '--sans-annotation ne doit poser aucun commentaire');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°14 : `2-dense_…`, qui combine chevauchement de révisions, `found` court et
// frontière de w:hyperlink, s'annote : révisions ou commentaires posés, XML bien formé sur
// toutes les parties, jamais Annotation.Impossible. Les cas eux-mêmes sont testés dans
// test/js/manuscrit-annoter.test.js ; le filet de sécurité de la CLI, au contrôle n°15.

test('manuscrit-nettoyer.py : sur 2-dense_… (déclencheur réel de l’ancien défaut), l’annotation réussit et le XML reste bien formé',
  { skip: sansPython }, () => {
    const CORPUS_2_DENSE = path.join(CORPUS_LOT_A,
      '2-dense_20250404_Quelle inclusion pour les personnes en situation de handicap.docx');
    if (!fs.existsSync(CORPUS_2_DENSE)) {
      return; // tmp/ hors git, effacé sans prévenir — déjà couvert au motif du contrôle n°8.
    }
    const base = dossierJetable();
    try {
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([CORPUS_2_DENSE, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.ok(fs.existsSync(obj.sortie_docx));

      const VALIDER_XML = [
        'import sys, zipfile, json',
        'import xml.etree.ElementTree as ET',
        'z = zipfile.ZipFile(sys.argv[1])',
        'erreurs = []',
        'for nom in z.namelist():',
        '    if nom.endswith((".xml", ".rels")):',
        '        try: ET.fromstring(z.read(nom))',
        '        except Exception as e: erreurs.append(nom + " : " + str(e))',
        'print(json.dumps(erreurs))',
      ].join('\n');
      const rValide = python(['-c', VALIDER_XML, obj.sortie_docx]);
      assert.strictEqual(rValide.status, 0, 'validation XML a échoué : ' + rValide.stderr);
      assert.deepStrictEqual(JSON.parse(rValide.stdout), [],
        'le .docx produit doit rester un XML bien formé sur toutes ses parties');

      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.ok(rapport.annotation, 'l’annotation doit désormais réussir sur ce fichier : '
        + JSON.stringify(rapport.annotation));
      assert.ok(rapport.annotation.revisions + rapport.annotation.commentaires > 0,
        'au moins une révision ou un commentaire doit être posé : '
        + JSON.stringify(rapport.annotation));
      assert.ok(!rapport.alertes.liste.some((a) => a.rule === 'Annotation.Impossible'),
        'Annotation.Impossible ne doit plus apparaître, le défaut est corrigé : '
        + JSON.stringify(rapport.alertes.liste.map((a) => a.rule)));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°15 : le filet de sécurité de la CLI (try/except autour de
// manuscrit_annoter.annoter(), _valider_docx_bien_forme() et restauration de la version
// d'avant l'annotation, voir principal()). Une régression future de l'annoteur doit être
// rattrapée sans corrompre le .docx ni faire planter la CLI.
//
// Aucune entrée normale ne fait échouer annoter(), et --sans-annotation ne l'appelle pas. Le
// test charge donc manuscrit-nettoyer.py comme module Python (comme manuscrit-vale.test.js)
// et remplace son attribut `ma.annoter` par une fonction qui lève.

test('manuscrit-nettoyer.py : le filet de sécurité (annotation qui échoue) restaure la version pré-annotation et pose Annotation.Impossible — même moteur d’injection que manuscrit-vale.test.js n°7',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);

      const PONT_ANNOTER_SABOTE = [
        'import importlib.util, sys',
        'dossier_pipeline, chemin_nettoyeur = sys.argv[1], sys.argv[2]',
        'sys.path.insert(0, dossier_pipeline)',
        'spec = importlib.util.spec_from_file_location("nettoyeur_sabote", chemin_nettoyeur)',
        'mod = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(mod)',
        'def _annoter_sabote(*a, **k):',
        '    raise ValueError("SABOTAGE test filet de securite : annoter() indisponible")',
        'mod.ma.annoter = _annoter_sabote',
        'sys.argv = [chemin_nettoyeur] + sys.argv[3:]',
        'sys.exit(mod.principal(sys.argv))',
      ].join('\n');

      const r = python(['-c', PONT_ANNOTER_SABOTE, PIPELINE, NETTOYEUR,
        entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.ok(fs.existsSync(obj.sortie_docx),
        'le .docx pré-annotation doit rester livré malgré la panne : ' + r.stderr);

      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.strictEqual(rapport.annotation, null,
        'annotation ratée injectée : rapport.annotation doit être None, jamais à moitié fait');
      const alerteImpossible = rapport.alertes.liste.find((a) => a.rule === 'Annotation.Impossible');
      assert.ok(alerteImpossible,
        'aucune alerte Annotation.Impossible malgré la panne injectée : '
        + JSON.stringify(rapport.alertes.liste.map((a) => a.rule)));
      assert.strictEqual(alerteImpossible.severity, 'warning');

      // Le .docx livré est celui d'avant l'annotation : ni révision ni commentaire.
      const LIRE_MARQUES_SABOTE = [
        'import sys, zipfile, json',
        'z = zipfile.ZipFile(sys.argv[1])',
        'print(json.dumps({',
        '    "w_ins": z.read("word/document.xml").decode("utf-8").count("<w:ins "),',
        '    "w_del": z.read("word/document.xml").decode("utf-8").count("<w:del "),',
        '    "comments_xml": "word/comments.xml" in z.namelist(),',
        '}))',
      ].join('\n');
      const rMarques = python(['-c', LIRE_MARQUES_SABOTE, obj.sortie_docx]);
      assert.strictEqual(rMarques.status, 0, 'lecture des marques a échoué : ' + rMarques.stderr);
      const marques = JSON.parse(rMarques.stdout);
      assert.strictEqual(marques.w_ins, 0);
      assert.strictEqual(marques.w_del, 0);
      assert.strictEqual(marques.comments_xml, false);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°16 : `dans_docx` recopie `stats['devenir']`, il ne se déduit pas de `action`.
//
// `APA.DoiForme` (action='fix', suggested renseigné) vient de fixtureQuatreOrigines().
// `mod.ma.annoter` est remplacée (comme au contrôle n°15) par une fonction qui simule un
// chevauchement : elle passe APA.DoiForme en commentaire par `devenir`, sans toucher au .docx
// déjà écrit. `dans_docx` doit valoir 'commentaire'.

test('manuscrit-nettoyer.py : dans_docx recopie stats.devenir — une alerte fix/track démotée '
  + 'en commentaire par le chevauchement ne ressort jamais "revision"', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'devenir.docx');
      fabriquerDocx(entree, fixtureQuatreOrigines());
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);

      const PONT_DEVENIR_SABOTE = [
        'import importlib.util, sys',
        'dossier_pipeline, chemin_nettoyeur = sys.argv[1], sys.argv[2]',
        'sys.path.insert(0, dossier_pipeline)',
        'spec = importlib.util.spec_from_file_location("nettoyeur_devenir", chemin_nettoyeur)',
        'mod = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(mod)',
        'def _annoter_devenir_sabote(*a, **k):',
        '    alertes = a[2]',
        "    devenir = ['rapport'] * len(alertes)",
        "    idx_doi = next(i for i, al in enumerate(alertes) if al.get('rule') == 'APA.DoiForme')",
        "    devenir[idx_doi] = 'commentaire'",  // simule la démotion par chevauchement
        "    return {'revisions': 0, 'commentaires': 0, 'commentaires_synthese': 0,",
        "            'renvoyees_au_rapport': [], 'non_ancrees': [], 'par_regle': {},",
        "            'devenir': devenir}",
        'mod.ma.annoter = _annoter_devenir_sabote',
        'sys.argv = [chemin_nettoyeur] + sys.argv[3:]',
        'sys.exit(mod.principal(sys.argv))',
      ].join('\n');

      const r = python(['-c', PONT_DEVENIR_SABOTE, PIPELINE, NETTOYEUR,
        entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.ok(fs.existsSync(obj.sortie_docx), 'le .docx doit rester livré : ' + r.stderr);

      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      const doi = rapport.alertes.liste.find((a) => a.rule === 'APA.DoiForme');
      assert.ok(doi, 'APA.DoiForme absente : '
        + JSON.stringify(rapport.alertes.liste.map((a) => a.rule)));
      assert.strictEqual(doi.action, 'fix');
      assert.ok(doi.suggested, 'suggested doit rester renseigné (sous l’ancien code, cela '
        + 'suffisait à lui seul à déduire "revision")');
      assert.strictEqual(doi.dans_docx, 'commentaire',
        'dans_docx doit porter le verdict RÉEL de l’annotation (devenir), jamais une '
        + 'déduction depuis action : ' + JSON.stringify(doi));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°17 : du numéro de note à son appel. `_numeros_notes()` donne le numéro de sortie
// (ordre de première rencontre, cellules de tableau comprises) ;
// `_paragraphes_notes_pour_vale()` et `_marquer_notes_dans_alertes()` reportent sur l'alerte
// note_id, note_numero et le para réel d'un paragraphe de note, après Vale. Le test construit
// un mm.Document à la main, sans .docx.
//
// Fixture : un appel de la note 5 dans un paragraphe de premier niveau (source=1, ancrable),
// un appel de la note 2 dans une cellule de tableau (non ancrable, comme dans
// _paragraphe_source_appelant_note), et un second appel de la note 5 plus loin, qui ne prend
// pas de second numéro.

const PONT_NOTES_MODELE = [
  'import importlib.util, json, sys',
  'dossier_pipeline, chemin_nettoyeur = sys.argv[1], sys.argv[2]',
  'sys.path.insert(0, dossier_pipeline)',
  'spec = importlib.util.spec_from_file_location("nettoyeur_notes", chemin_nettoyeur)',
  'mod = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(mod)',
  'import manuscrit_modele as mm',
  '',
  'def frag(t, note=None):',
  '    return mm.Fragment(texte=t, note=note)',
  '',
  'p0 = mm.Paragraphe(fragments=[frag("Titre")], source=0)',
  'p1 = mm.Paragraphe(fragments=[frag("Corps un "), frag("", note=5), frag(" fin.")], source=1)',
  '# note=2 appelee DANS UNE CELLULE (source LOCAL a la cellule, jamais un Paragraphe.source',
  '# de premier niveau) : jamais ancrable, meme regle que Vale pour le corps/la bibliographie.',
  'p_cellule = mm.Paragraphe(fragments=[frag("Dans cellule "), frag("", note=2)], source=0)',
  'cellule = mm.Cellule(blocs=[p_cellule])',
  'tableau = mm.Tableau(rangees=[[cellule]], source=2)',
  '# second appel de la note 5 : ne doit RIEN changer au numero deja attribue (5 -> 1).',
  'p2 = mm.Paragraphe(fragments=[frag("Encore appel "), frag("", note=5)], source=3)',
  '',
  'document = mm.Document(',
  '    blocs=[p0, p1, tableau, p2],',
  '    notes={5: [mm.Paragraphe(fragments=[frag("Contenu note cinq")])],',
  '           2: [mm.Paragraphe(fragments=[frag("Contenu note deux")])]})',
  '',
  'numeros = mod._numeros_notes(document)',
  'paragraphes, correspondance_notes = mod._paragraphes_notes_pour_vale(document, numeros)',
  '',
  '# Une alerte Vale (imite mv.analyser() : `para` = le `source`, synthétique ou réel, du',
  '# paragraphe qui a produit la ligne) sur CHAQUE paragraphe de note rendu, plus une alerte',
  '# sur un paragraphe de CORPS ordinaire (jamais une note) qui ne doit JAMAIS être touchée.',
  'alertes = [{"rule": "Vale.Note%d" % i, "severity": "warning", "action": "comment",',
  '            "para": p["source"], "span": None, "found": None, "suggested": None,',
  '            "message": "m%d" % i} for i, p in enumerate(paragraphes)]',
  'alertes.append({"rule": "Vale.CorpsOrdinaire", "severity": "warning", "action": "comment",',
  '                 "para": 1, "span": None, "found": None, "suggested": None, "message": "corps"})',
  'mod._marquer_notes_dans_alertes(alertes, correspondance_notes)',
  '',
  'print(json.dumps({"numeros": numeros, "paragraphes": paragraphes,',
  '                   "correspondance_notes": {str(k): v for k, v in correspondance_notes.items()},',
  '                   "alertes": alertes}, default=str))',
].join('\n');

test('manuscrit-nettoyer.py : traçabilité note -> appel — numéro de sortie, cellules de '
  + 'tableau jamais ancrables, alertes de note marquées après Vale', { skip: sansPython }, () => {
    const r = python(['-c', PONT_NOTES_MODELE, PIPELINE, NETTOYEUR]);
    assert.strictEqual(r.status, 0, r.stderr);
    const obj = JSON.parse(r.stdout);

    // Numéros de sortie : note 5 (rencontrée d'abord, p1) -> 1 ; note 2 (en cellule, ensuite)
    // -> 2. C'est l'ordre de rencontre qui décide, comme dans manuscrit_gabarit.py.
    assert.deepStrictEqual(obj.numeros, { '5': 1, '2': 2 });

    // La note 2 est appelée depuis une cellule, non ancrable : son paragraphe de note ne porte
    // pas de `source`.
    const paraNote2 = obj.paragraphes.find((p) => p.texte === 'Contenu note deux');
    assert.strictEqual(paraNote2.source, null,
      'une note appelée depuis une cellule ne doit jamais recevoir de source synthétique');
    assert.strictEqual(Object.keys(obj.correspondance_notes).length, 1,
      'une seule note (5, appelée au premier niveau) doit avoir une correspondance');

    const alerteNote5 = obj.alertes.find((a) => a.rule === 'Vale.Note0');
    assert.strictEqual(alerteNote5.note_id, 5);
    assert.strictEqual(alerteNote5.note_numero, 1);
    assert.strictEqual(alerteNote5.para, 1, 'para doit redevenir le paragraphe RÉEL (source=1 de p1)');

    const alerteNote2 = obj.alertes.find((a) => a.rule === 'Vale.Note1');
    assert.strictEqual(alerteNote2.note_id, undefined,
      'une alerte sur la note 2 (jamais ancrable) ne doit jamais recevoir note_id/note_numero');
    assert.strictEqual(alerteNote2.para, null);

    const alerteCorps = obj.alertes.find((a) => a.rule === 'Vale.CorpsOrdinaire');
    assert.strictEqual(alerteCorps.note_id, undefined,
      'une alerte sur un paragraphe de corps ORDINAIRE (para=1, jamais synthétique) ne doit '
      + 'jamais être prise pour une alerte de note');
    assert.strictEqual(alerteCorps.para, 1);
  });

// ROR/ORCID (manuscrit_identifiants) : le rapport porte une clé `identifiants` en cas B, et
// --sans-reseau ne tente aucune requête (le réseau est testé dans
// manuscrit-identifiants.test.js, avec un annuaire simulé).
test('manuscrit-nettoyer.py : rapport.identifiants présent en cas B, aucune requête avec --sans-reseau',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(true));
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      const rapport = cheminDepuisPython(JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8')));
      assert.ok(rapport.identifiants, 'la clé identifiants doit exister en cas B');
      assert.strictEqual(rapport.identifiants.reseau, false);
      assert.strictEqual(rapport.identifiants.requetes, 0);
      assert.strictEqual(rapport.alertes.origine.identifiants, 0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// Une recherche en ligne en panne ne bloque pas le nettoyage, mais elle doit se voir au
// rapport : sans cela, « aucun DOI trouvé » passe pour un résultat.
test('manuscrit-nettoyer.py : recherche en ligne en panne -> un avertissement au rapport, '
  + 'rien sinon', { skip: sansPython }, () => {
  const programme = [
    'import importlib.util, json, sys',
    'sys.path.insert(0, sys.argv[1])',
    'spec = importlib.util.spec_from_file_location("nettoyeur_reseau", sys.argv[2])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'print(json.dumps({',
    '  "rien": mod._alerte_recherche_impossible(False, False, "fr"),',
    '  "doi": mod._alerte_recherche_impossible(True, False, "fr"),',
    '  "tout_de": mod._alerte_recherche_impossible(True, True, "de")}))',
  ].join('\n');
  const r = python(['-c', programme, PIPELINE, NETTOYEUR]);
  assert.strictEqual(r.status, 0, r.stderr);
  const obj = JSON.parse(r.stdout);
  assert.strictEqual(obj.rien, null);
  assert.strictEqual(obj.doi.rule, 'Reseau.RechercheImpossible');
  assert.strictEqual(obj.doi.action, 'report');
  assert.ok(obj.doi.message.indexOf('DOI') !== -1 && obj.doi.message.indexOf('ORCID') === -1,
    obj.doi.message);
  assert.ok(obj.tout_de.message.indexOf('DOI sowie ROR und ORCID') !== -1, obj.tout_de.message);
});
