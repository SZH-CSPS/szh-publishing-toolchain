// pipeline/manuscrit-nettoyer.py : la CLI du nettoyeur de manuscrit (article), §8 de
// outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md — le CHAÎNON qui branche les six modules
// (manuscrit_docx, manuscrit_modele, manuscrit_typo, manuscrit_regles, manuscrit_gabarit).
// Ce fichier éprouve les contrôles demandés pour ce chantier :
//   1. le refus du suivi de modifications (w:ins) : message clair, RIEN écrit sur le disque ;
//   2. le code de sortie : non nul dès qu'une alerte `error` existe, nul sinon ;
//   3. la chaîne complète sur un manuscrit fabriqué : le .docx produit se relit par
//      pronto-lire.py, le rapport JSON porte les traces de décision et les alertes ;
//   4. --analyse-seule : aucun .docx écrit, mais bien un rapport ;
//   5. le repli de seuil : au-delà de dix occurrences d'une même règle, dix détaillées, le
//      total donné (délégué à manuscrit_regles.grouper(), déjà éprouvé ailleurs — ici on
//      prouve que LA CLI le relaie tel quel jusqu'au rapport) ;
//   6. les flux ne se mélangent pas : une seule ligne sur stdout, la progression sur stderr ;
//   7. un nom de fichier accentué traverse toute la chaîne sans plantage d'encodage ;
//   8. les onze manuscrits réels de tmp/corpus-relecture/lot-A/ passent la chaîne complète
//      sans exception — sauté sous un motif nommé si le corpus (hors git) est absent ;
//   9. révision du 19.09.2026 — un fichier verrou `~$*.docx` est refusé proprement (code 2,
//      code_refus='fichier-verrou'), avant toute lecture ;
//   10. révision du 19.09.2026 — la langue de traitement vient du PRODUIT, jamais du document
//       déclaré ; un désaccord (ex. `de-CH` sur un article de la Revue) lève une alerte
//       warning, sans jamais changer la langue réellement utilisée ;
//   11. révision du 19.09.2026 — un repli typographique (pandoc/WSL indisponible) lève une
//       alerte warning ET porte `typographie: "repli"` sur la ligne stdout ; --sans-typo porte
//       aussi "repli" sur cette ligne, mais SANS lever l'alerte (choix explicite, pas une
//       panne) ;
//   12. LE test de production (révision du 19.09.2026) : la CLI tourne réellement DANS la WSL
//       (comme le lanceur en production), sur un manuscrit dont la typographie doit être
//       appliquée — la panne mesurée avant cette révision (repli silencieux car wsl.exe
//       n'existe pas dans la distro) ne peut être vue que là.
//   13. Révision du 21.09.2026 — branchement de manuscrit_vale.py, manuscrit_biblio.py et
//       manuscrit_annoter.py (jusque-là exposés en fonctions pures, jamais appelés d'ici) :
//       un manuscrit fabriqué qui porte les quatre origines d'alerte à la fois (structurel,
//       vocabulaire, bibliographie, typographie), `dans_docx` renseigné sur chacune, le .docx
//       produit porte bien w:ins/w:del (le DOI corrigé) et comments.xml (la forme épicène),
//       --analyse-seule n'écrit toujours rien, --sans-annotation n'écrit ni révision ni
//       commentaire, --sans-reseau porte bien jusqu'à bibliographie.crossref.indisponible.
//       Sauté proprement si vale est absent du poste (ni PATH ni WSL) ; SZH_VALE_OBLIGATOIRE=1
//       transforme ce saut en échec, comme test/js/manuscrit-vale.test.js.
//   14. Révision du 21.09.2026 (soir) — les trois défauts réels de manuscrit_annoter.py
//       (chevauchement de révisions, mésancrage d'un `found` court, frontière de
//       w:hyperlink) sont corrigés en amont : `2-dense_…`, le déclencheur réel de l'ancien
//       défaut, s'annote désormais pour de vrai (révisions/commentaires posés, XML bien
//       formé, jamais Annotation.Impossible).
//   15. Le FILET DE SÉCURITÉ de la CLI (try/except + validation XML + restauration autour de
//       manuscrit_annoter.annoter()) reste éprouvé indépendamment de l'état de ce module, par
//       injection de dépendance (mod.ma.annoter remplacé après chargement) — jamais une
//       modification du code de production pour le faire échouer.
//
//   node --test test/js/manuscrit-nettoyer.test.js
//
// Patron : test/js/manuscrit-gabarit.test.js (fabrication de fixtures .docx via un petit
// programme Python écrit au vol, jamais figées en binaire). Gardes de test/js/gardes.js :
// PYTHON (jamais `python3` en dur, voir son en-tête) et sansPandocWsl/SZH_WSL_OBLIGATOIRE
// (pandoc + WSL SZH-Publishing, contrôle n°12 seulement).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sansPandocWsl, sauter } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const NETTOYEUR = path.join(PIPELINE, 'manuscrit-nettoyer.py');
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');

// ---- WSL, pour LE test de production (n°12) — patron de test/js/manuscrit-gabarit.test.js
// et de pipeline/manuscrit_typo.py (même piège des antislashs : wsl.exe les avale dans un
// argument de tableau, on convertit en barres obliques AVANT l'appel).
const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
const DISTRO_WSL = 'SZH-Publishing';

function versCheminWsl(cheminWindows) {
  const p = cheminWindows.replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(p);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : p;
}

function versCheminWindows(cheminWsl) {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(cheminWsl);
  return m ? m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\') : cheminWsl;
}

// ---- vale, détecté comme dans test/js/manuscrit-vale.test.js (patron recopié à l'identique,
// pas importé : sa propre en-tête dit pourquoi — « jamais dans test/js/gardes.js, hors
// périmètre de ce chantier »). PATH d'abord, wsl.exe -d SZH-Publishing en repli.
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

// Lit word/document.xml tel quel (XML brut), avec le Python de CE poste (Windows) — le
// fichier produit DANS la WSL reste lisible tel quel depuis Windows, même système de
// fichiers (patron de test/js/manuscrit-gabarit.test.js).
const LIRE_DOCUMENT_XML = 'import sys, zipfile\n'
  + 'z = zipfile.ZipFile(sys.argv[1])\n'
  + 'sys.stdout.write(z.read("word/document.xml").decode("utf-8"))\n';

function lireDocumentXml(chemin) {
  return cp.execFileSync(PYTHON, ['-c', LIRE_DOCUMENT_XML, chemin],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 });
}

// Aplatit tout le texte visible de word/document.xml (concaténation de tous les <w:t>), pour
// des contrôles qui ne dépendent pas de la façon dont la typographie a redécoupé les runs.
function extraireTexteBrut(xml) {
  const morceaux = [];
  // (?:\s[^>]*)? borne le nom de balise : sans elle, `<w:t[^>]*>` reconnait aussi
  // `<w:tcPr>`, `<w:tblPr>`, `<w:tab/>`... (tout ce qui commence par les 4 memes caracteres)
  // et avale tout le XML jusqu'au PROCHAIN `</w:t>` comme s'il s'agissait de texte -- mesure
  // en ecrivant ce test : le texte extrait contenait alors des fragments de balises entieres.
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    morceaux.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
  }
  return morceaux.join('');
}
const CORPUS_LOT_A = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A');

// PYTHONIOENCODING=utf-8 : même piège que test/js/manuscrit-gabarit.test.js (voir son
// en-tête) — sans elle, l'interprète Python de ce poste écrit son stdout dans l'encodage de
// la console Windows (cp1252), et un accent dans un nom de fichier ou dans la progression
// fait planter le processus au lieu de simplement s'afficher.
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function python(args, opts) {
  return cp.spawnSync(PYTHON, args,
    Object.assign({ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_UTF8 }, opts || {}));
}

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe || 'szh-manuscritnettoyer-'));
}

// ---------------------------------------------------------------------------------
// Fabrication d'un .docx minimal — patron fabriquerDocx de test/js/docx-titres.test.js,
// étendu d'un champ `revision` par paragraphe : true l'enveloppe dans un <w:ins>, comme un
// texte accepté en suivi de modifications par Word. `paragraphes` :
//   [{ texte, style|undefined, gras|false, taille|undefined, revision|false }, ...]
// Le 3e argument optionnel `langue` (ex. 'de-CH') pose w:docDefaults/w:rPrDefault/w:rPr/w:lang
// dans styles.xml — ce que manuscrit_docx._langue_declaree() lit (contrôle n°10, langue).
// Un paragraphe peut porter `image: { nom }` (patron minimal, un seul champ utile ici :
// AUCUN `descr` sur `wp:docPr` — donc AUCUN texte alternatif, §11 « A11y.TexteAlternatif ») —
// une image RÉELLE (1x1 PNG transparent), avec sa relation et sa déclaration
// [Content_Types].xml, pour que manuscrit_docx._image_depuis_drawing() (r:embed, wp:docPr, un
// media/ résolu) la reconnaisse comme une VRAIE image, pas une forme vectorielle ignorée.
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

// Un manuscrit minimal : un titre, un corps propre, une bibliographie de deux entrées — sert
// de base à plusieurs contrôles. `avecAlerte` ajoute, juste sous le titre, un résumé bien en
// dessous de la fourchette attendue (400-600 signes en Revue) : Forme.LongueurResume.Revue,
// sévérité `error`. Un « Mots-cles » suit immédiatement pour borner la capture du résumé à
// cette seule ligne (pipeline/manuscrit_entete.py, §5.5 : un résumé se poursuit jusqu'au
// marqueur suivant). Remplace Epicene.FormesContracteesProscrites (migré vers Vale,
// pipeline/manuscrit_vale.py, commit 6ddd429 : ce module ne le détecte plus).
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
  return JSON.parse(lignes[0]);
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 — le refus du suivi de modifications : message clair, RIEN écrit sur le
// disque (ni le .docx, ni le rapport — §8 : « avant tout travail... sans rien écrire »).
//
// Sabotage minimal, atterrissage vérifié plus bas (§ rapport final) : dans principal(),
// remplacer `if document.revisions > 0:` par `if False:` — le refus ne se déclenche plus,
// le document en suivi de modifications est nettoyé comme n'importe quel autre.

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
// Contrôle n°2 — le code de sortie : non nul dès qu'une alerte `error` existe (ici
// Forme.LongueurResume.Revue, déclenchée par un résumé trop court), nul sur un manuscrit
// qui n'en déclenche aucune (aucun paragraphe de rôle 'resume' du tout).
//
// Sabotage minimal : dans principal(), remplacer
// `code_sortie = CODE_ALERTE_ERROR if n_error > 0 else CODE_OK` par `code_sortie = CODE_OK`
// — le code de sortie reste 0 même avec une alerte `error` dans le rapport.

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
// Contrôle n°3 — la chaîne complète : le .docx produit se relit par pronto-lire.py (le
// lecteur de PRODUCTION), et le rapport JSON porte les traces de décision et les alertes.
//
// Sabotage minimal : dans principal(), ne jamais appeler mg.ecrire() (commenter l'appel et
// laisser sortie_docx = None même hors --analyse-seule) — le test rougit sur
// `fs.existsSync(sortieDocx)`.

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

      // Relecture par le lecteur de PRODUCTION.
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

      // Le rapport JSON porte les traces de décision ET les alertes.
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
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
// Contrôle n°4 — --analyse-seule : aucun .docx écrit, mais bien un rapport.
//
// Sabotage minimal : dans principal(), inverser la condition
// `if args['analyse_seule']:` en `if not args['analyse_seule']:` (et son `else` symétrique)
// — un .docx est écrit MALGRÉ --analyse-seule.

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
// Contrôle n°5 — le repli de seuil : au-delà de dix occurrences d'une même règle, dix sont
// détaillées et le total est donné (§7/§10 du contrat — relayé par
// manuscrit_regles.grouper(), ici on prouve que la CLI le porte tel quel jusqu'au rapport).
// APA.TroisAuteursPlus (sévérité `warning`, « et al » sans point final) remplace
// Epicene.FormesContracteesProscrites (migré vers Vale, hors de ce module) : le mécanisme
// éprouvé ici (grouper() par identifiant de règle) ne dépend d'aucune sévérité particulière.
//
// Sabotage minimal : dans principal(), construire `groupes` à la main avec
// `{'par_famille': {}, 'par_regle': {r['rule']: {'total': 1, 'exemples': [r]} for r in
// alertes}}` au lieu d'appeler `_grouper_toutes_alertes(alertes)` — chaque occurrence
// redevient son propre groupe de taille 1, le total de 12 disparaît.
//
// ⚠ Révision du 21.09.2026 (branchement de Vale/manuscrit_biblio.py) : `obj.alertes_warning`
// n'est plus un compte STRICT de 12 — Vale (s'il est indisponible sur ce poste) ajoute
// `Vale.Indisponible`, une warning DE PLUS, sans rapport avec ce contrôle. L'assertion qui
// comptait EXACTEMENT 12 devient `>= 12` (rien n'est PERDU, ce que ce contrôle prouve) ; le
// compte EXACT reste vérifié, lui, sur le GROUPE de la seule règle qui nous intéresse ici.

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
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
      const groupe = rapport.alertes.groupes.par_regle['APA.TroisAuteursPlus'];
      assert.ok(groupe, 'le groupe de cette règle doit exister');
      assert.strictEqual(groupe.total, 12, 'le TOTAL doit rester 12');
      assert.strictEqual(groupe.exemples.length, 10, 'AU PLUS dix exemples détaillés');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 — les flux ne se mélangent pas : stdout ne porte QU'UNE ligne, analysable en
// JSON ; la progression est sur stderr, plusieurs lignes, aucune n'est du JSON de stats.
//
// Sabotage minimal : dans progres(), remplacer `file=sys.stderr` par `file=sys.stdout` —
// les lignes de progression se mêlent à la ligne JSON finale sur stdout.

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
// Contrôle n°7 — un nom de fichier accentué traverse toute la chaîne sans plantage
// d'encodage (§8 : `sys.stdout.reconfigure`/`sys.stderr.reconfigure` sur les DEUX flux —
// pipeline/pronto-lire.py, lui, n'a pas cette clause et plante sur ce cas précis, voir
// l'en-tête de test/js/manuscrit-gabarit.test.js).
//
// ⚠ ENV_UTF8 (PYTHONIOENCODING=utf-8, ci-dessus) rendrait ce contrôle AVEUGLE à son propre
// sabotage : Python part alors DÉJÀ en UTF-8 sur ses deux flux, avec ou sans l'appel
// `reconfigure()` du script — mesuré en écrivant ce fichier (voir le rapport final). Ce
// test-ci utilise donc un environnement délibérément PRIVÉ de cette variable (ENV_SANS_PIOE),
// pour retomber sur l'encodage par défaut du poste (cp1252 mesuré ici) si le script ne
// reconfigurait pas ses flux lui-même — la seule façon de vraiment exercer §8.
//
// Sabotage minimal, vérifié rouge SEULEMENT sous cet environnement précis (vert, à tort,
// sous ENV_UTF8 — l'écart est décrit au rapport final) : dans _forcer_utf8(), ne
// reconfigurer QUE sys.stdout (retirer sys.stderr de la boucle) — la progression accentuée
// sur stderr redevient tributaire de l'encodage de la console de ce poste (cp1252 ici, «
// entr\xe9e » au lieu de « entr\xc3\xa9e »), et n'est plus décodable comme de l'UTF-8 propre.

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
      const r = cp.spawnSync(PYTHON,
        [NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie, '--sans-reseau'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV_SANS_PIOE });
      assert.strictEqual(r.status, 0, 'ne doit pas planter sur un nom accentué : ' + r.stderr);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.entree, entree);
      assert.ok(fs.existsSync(obj.sortie_docx), 'le .docx accentué doit exister : ' + obj.sortie_docx);
      assert.ok(path.basename(obj.sortie_docx).startsWith('Étude accentuée'));
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
      assert.strictEqual(rapport.entree, entree);
      // La progression accentuée doit aussi être lisible (pas de mojibake, pas de '?') —
      // SANS PYTHONIOENCODING dans l'environnement : c'est le script lui-même, par
      // reconfigure(), qui doit garantir ceci, pas une variable posée par le harnais.
      assert.ok(r.stderr.includes(entree), 'la progression doit reproduire le nom accentué '
        + 'intact, sans PYTHONIOENCODING dans l\'environnement');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°8 — le plus utile (§11 du contrat, note finale) : les onze manuscrits réels de
// lot-A passent la chaîne complète sans exception. tmp/ est hors git, effacé sans prévenir :
// sauté sous un motif nommé, jamais en silence, si le corpus est absent.

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
        // --sans-reseau (consigne du chantier de branchement : « les tests la passent
        // toujours ») : ce contrôle porte sur la chaîne complète, pas sur Crossref — l'isoler
        // du réseau le garde rapide et déterministe, jamais tributaire d'internet en CI.
        const r = nettoyer([entree, '--produit', 'revue', '--sortie', dossierSortie, '--sans-reseau']);
        // Refus (ex. suivi de modifications) est un résultat LÉGITIME, distinct d'un
        // plantage : seul un code de sortie inattendu (ni 0, ni 1 alerte-error, ni 2 refus)
        // ou une exception non gérée (traceback Python sur stderr) compte comme un échec.
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
// Contrôle n°9 — fichier verrou `~$*.docx` : refus propre AVANT toute lecture, jamais
// l'exception « File is not a zip file » d'avant cette révision (code 2, pas 3).
//
// Sabotage minimal : dans principal(), retirer le bloc `if os.path.basename(entree).
// startswith('~$'): return refuser(...)` — le test rougit sur `obj.code_refus`.

test('manuscrit-nettoyer.py : refuse un fichier verrou ~$*.docx avant toute lecture',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, '~$verrou.docx');
      // Un vrai verrou Word n'est pas un zip valide : quelques octets suffisent, le refus
      // doit intervenir avant que quiconque n'essaie de l'ouvrir.
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
// Contrôle n°10 — la langue de traitement vient du PRODUIT, pas du document déclaré ; un
// désaccord lève une alerte warning SANS changer la langue réellement utilisée.
//
// Sabotage minimal : dans principal(), remplacer
// `langue = 'fr' if args['produit'] == 'revue' else 'de'` par `langue = document.langue or 'fr'`
// — un document déclaré `de-CH` reçoit la typographie/les règles allemandes sur un article
// de la Revue, et aucune alerte Langue.DesaccordProduit n'apparaît plus jamais (elle dépend
// justement de la comparaison entre les deux).

test('manuscrit-nettoyer.py : la langue de traitement vient du produit ; un désaccord lève une alerte warning sans changer la langue utilisée',
  { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      // Document déclaré en allemand (de-CH) mais traité comme un article de la Revue (fr).
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, manuscritMinimal(false), 'de-CH');
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);
      // --sans-typo : ce contrôle porte sur la langue et l'alerte, pas sur le filtre —
      // l'isoler évite toute dépendance à pandoc/WSL ici.
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-typo', '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
      assert.strictEqual(rapport.langue, 'fr',
        'la langue UTILISÉE doit rester celle du produit (fr), jamais celle du document');
      const alerteLangue = rapport.alertes.liste.find((a) => a.rule === 'Langue.DesaccordProduit');
      assert.ok(alerteLangue, 'aucune alerte de désaccord de langue : ' + JSON.stringify(rapport.alertes.liste));
      assert.strictEqual(alerteLangue.severity, 'warning');
      assert.ok(alerteLangue.message && alerteLangue.message.length > 0);

      // Négatif : un document déclaré cohérent avec le produit ne lève rien.
      const entreeCoherente = path.join(base, 'coherent.docx');
      fabriquerDocx(entreeCoherente, manuscritMinimal(false), 'fr-CH');
      const sortieCoherente = path.join(base, 'sortie-coherente');
      fs.mkdirSync(sortieCoherente);
      const rCoherent = nettoyer([entreeCoherente, '--produit', 'revue', '--sortie', sortieCoherente, '--sans-typo', '--sans-reseau']);
      const objCoherent = ligneUniqueJson(rCoherent.stdout);
      const rapportCoherent = JSON.parse(fs.readFileSync(objCoherent.sortie_rapport, 'utf8'));
      assert.ok(!rapportCoherent.alertes.liste.some((a) => a.rule === 'Langue.DesaccordProduit'),
        'fr-CH sur un article de la Revue ne doit lever aucune alerte de langue');
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°11 — un repli typographique lève une alerte warning ET porte
// `typographie: "repli"` sur la ligne stdout ; --sans-typo porte aussi "repli" sur cette
// ligne mais SANS lever l'alerte (choix explicite, pas une panne d'outillage).
//
// Le seul levier sûr pour forcer un VRAI repli de bout en bout sans toucher wsl.exe ni au
// PATH du poste (qui casserait aussi le lancement de python lui-même) : une copie isolée du
// pipeline PRIVÉE du filtre typographique — pandoc, alors joignable pour de vrai, échoue
// réellement sur `--lua-filter <introuvable>`. sansPandocWsl garantit que l'échec vient bien
// du filtre manquant, pas d'une WSL absente sur ce poste.
//
// Sabotage minimal, deux volets : (a) dans principal(), retirer
// `if statut_typo == 'repli': alertes_manuelles.append(_alerte_repli_typo())` — le repli
// reste invisible dans les alertes ; (b) ajouter `statut_typo = 'appliquee'` juste avant la
// ligne stdout — la ligne ment sur ce qui s'est vraiment passé.

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
      // --analyse-seule : ce contrôle porte sur le repli, pas sur l'écriture du gabarit
      // (qui a besoin de revue-template/, non copié ici).
      const r = python([nettoyeurCopie, entree, '--produit', 'revue', '--sortie', sortie,
        '--analyse-seule', '--sans-reseau']);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.typographie, 'repli',
        'la ligne stdout doit porter typographie: "repli" : ' + JSON.stringify(obj));
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
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
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
      assert.strictEqual(rapport.sans_typo, true);
      assert.ok(!rapport.alertes.liste.some((a) => a.rule === 'Typo.ApplicationImpossible'),
        '--sans-typo ne doit pas produire l’alerte de repli : ' + JSON.stringify(rapport.alertes.liste));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°12 — LE test de production : la CLI tourne réellement DANS la WSL, comme le
// lanceur en production (`wsl -d SZH-Publishing -e python3 pipeline/manuscrit-nettoyer.py`),
// sur un manuscrit dont la typographie française doit être appliquée. C'est la panne mesurée
// avant cette révision (repli silencieux, wsl.exe absent de la distro) qu'AUCUN autre test de
// ce fichier ne peut voir, puisqu'ils tournent tous depuis le Python de Windows.
//
// Sabotage minimal, vérifié rouge SEULEMENT ici (vert à tort partout ailleurs dans ce
// fichier, puisqu'ils passent par le Python de Windows) : dans
// pipeline/manuscrit_typo.py::_executer_pandoc, retirer la condition `sys.platform !=
// 'win32'` et appeler INCONDITIONNELLEMENT la branche wsl.exe — DANS la WSL, `wsl.exe`
// n'existe pas : `subprocess.run` lève `FileNotFoundError`, capturée comme
// `_PandocIndisponible`, repli silencieux, `typographie: "repli"` au lieu de "appliquee".

test('manuscrit-nettoyer.py : LE test de production — la CLI tourne DANS la WSL et applique la typographie française',
  { skip: sansPython || sansPandocWsl }, () => {
    const base = dossierJetable();
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, [
        { texte: "Titre de l'article", style: 'Heading1' },
        // Guillemets COURBES en entree (ce que l'autocorrection de Word produit reellement,
        // pas des guillemets droits) : le filtre ne construit jamais de noeud Quoted pandoc
        // lui-meme (voir l'en-tete de manuscrit_typo.py, point 3) -- des guillemets droits,
        // meme apparies, restent inchanges. Mesure en ecrivant ce test.
        { texte: 'Voir p. 5 : l\'exemple “cité” ?', taille: 24 },
        { texte: 'References', style: 'Heading1' },
        { texte: 'Dupont, J. (2020). Un ouvrage important. Editions Test.' }
      ]);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);

      const entreeWsl = versCheminWsl(entree);
      const nettoyeurWsl = versCheminWsl(NETTOYEUR);
      const sortieWsl = versCheminWsl(sortie);

      const r = cp.spawnSync(WSL_EXE, ['-d', DISTRO_WSL, '--', 'python3', nettoyeurWsl,
        entreeWsl, '--produit', 'revue', '--sortie', sortieWsl, '--sans-reseau'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
      assert.strictEqual(r.status, 0,
        'la CLI doit réussir dans la WSL : ' + r.stderr + ' / ' + r.stdout);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.typographie, 'appliquee',
        'la typographie doit vraiment s’appliquer DANS la WSL, pas un repli silencieux : '
        + JSON.stringify(obj));

      const cheminDocxWindows = versCheminWindows(obj.sortie_docx);
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

// ---------------------------------------------------------------------------------
// Contrôle n°13 — le branchement de manuscrit_vale.py/manuscrit_biblio.py/manuscrit_annoter.py
// (révision du 21.09.2026). Fixture construite pour porter, chacune sur son propre
// paragraphe, une alerte de chaque origine SANS EN FAIRE COLLISIONNER DEUX sur le même passage
// de texte (piège réel, mesuré en écrivant ce test — voir le rapport de chantier :
// manuscrit_annoter.py mésancre une révision `fix` dont le `found` est un mot COURT et banal,
// comme "et", sur sa PREMIÈRE occurrence dans le paragraphe entier plutôt que sur celle visée
// par `span` dès que les deux ne coïncident pas EXACTEMENT — un paragraphe qui contiendrait
// "et" AVANT la citation à corriger se ferait donc corrompre au mauvais endroit. Ce fichier ne
// touche pas manuscrit_annoter.py (hors des deux fichiers autorisés) : la phrase de la fixture
// est choisie pour ne JAMAIS contenir "et" avant la citation, pas pour cacher le défaut —
// signalé au rapport de chantier, à corriger ailleurs). « Introduction » (Heading1) juste
// après le titre referme la zone d'en-tête (§5.5) : sans lui, la phrase épicène qui suit
// serait avalée comme SOUS-TITRE (même signature que le titre, aucune ponctuation finale sur
// la première ligne) et n'atteindrait jamais Vale — mesuré en écrivant ce test.

function fixtureQuatreOrigines() {
  return [
    { texte: "Titre de l'article sur l'inclusion scolaire", style: 'Heading1' },
    { texte: 'Introduction', style: 'Heading1' },
    // Vale, CSPS.Epicene.FormesContractees (error, action=comment).
    { texte: 'Les enseignant(e)s accompagnent les eleves au quotidien.' },
    // Vale (CSPS.APA.EtDansParentheses, fix) ET manuscrit_biblio (APA.CitationAbsente,
    // comment) sur la MÊME parenthèse — sans collision (l'un fixe, l'autre commente, voir
    // l'en-tête). Aucun « et » avant la citation dans cette phrase (vérifié caractère par
    // caractère en écrivant ce test).
    { texte: 'Plusieurs travaux le confirment (Dupont et Martin, 2020).' },
    // Typo.guillemets-droits (repris tel quel du filtre, C2) : un guillemet droit isolé,
    // jamais apparié par pandoc.
    { texte: 'Il ecrit "quelque chose de curieux, sans doute avoir raison.' },
    // A11y.TexteAlternatif.Revue (structurel, catalogue Python) : image sans alt.
    { image: { nom: 'fig1.png', octets_base64: PNG_1X1_B64 } },
    { texte: 'References', style: 'Heading1' },
    // manuscrit_biblio : APA.ReferenceNonCitee (jamais citée sous ce nom) ET APA.DoiForme
    // (DOI nu, sans préfixe — jamais « doi: » : cette forme-là fait aussi lever
    // CSPS-Biblio.APA.DoiForme de Vale sur le MÊME texte, collision jumelle du piège
    // ci-dessus, évitée pour la même raison).
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
      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));

      // Les quatre origines, chacune avec au moins une alerte.
      const origine = rapport.alertes.origine;
      for (const cle of ['regles', 'vale', 'bibliographie', 'typographie']) {
        assert.ok(origine[cle] >= 1, 'origine "' + cle + '" absente : ' + JSON.stringify(origine));
      }
      assert.strictEqual(
        origine.regles + origine.vale + origine.bibliographie + origine.typographie,
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

      // --sans-reseau (posé par nettoyer(), voir la fonction) → jamais de tentative Crossref.
      assert.strictEqual(rapport.bibliographie.crossref.indisponible, true);

      // Le .docx produit porte bien w:del/w:ins (le DOI) ET comments.xml (la forme épicène) —
      // lu directement par zipfile Python, sans dépendance externe.
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
      assert.ok(marques.w_ins >= 1 && marques.w_del >= 1,
        'le DOI corrigé doit apparaître en révision (w:ins/w:del) : ' + JSON.stringify(marques));
      assert.ok(marques.comments_xml, 'comments.xml doit exister (la forme épicène commentée)');
      assert.ok(marques.comments_text.indexOf('CSPS.Epicene.FormesContractees') !== -1,
        'le commentaire ne cite pas la règle : ' + marques.comments_text);

      // --analyse-seule : toujours rien écrit à part le rapport (déjà éprouvé au contrôle
      // n°4, revérifié ici sur CETTE fixture qui exerce les quatre moteurs).
      const sortieAs = path.join(base, 'sortie-analyse-seule');
      fs.mkdirSync(sortieAs);
      const rAs = nettoyer([entree, '--produit', 'revue', '--sortie', sortieAs, '--analyse-seule']);
      const objAs = ligneUniqueJson(rAs.stdout);
      assert.strictEqual(objAs.sortie_docx, null);
      assert.ok(!fs.readdirSync(sortieAs).some((f) => f.endsWith('.docx')));

      // --sans-annotation : le .docx est écrit, mais aucune révision ni commentaire.
      const sortieSa = path.join(base, 'sortie-sans-annotation');
      fs.mkdirSync(sortieSa);
      const rSa = nettoyer([entree, '--produit', 'revue', '--sortie', sortieSa, '--sans-annotation']);
      const objSa = ligneUniqueJson(rSa.stdout);
      const rapportSa = JSON.parse(fs.readFileSync(objSa.sortie_rapport, 'utf8'));
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
// Contrôle n°14 — révisé le 21.09.2026 (soir) : les trois défauts réels de
// manuscrit_annoter.py (chevauchement de révisions, mésancrage d'un `found` court, révision à
// la frontière d'un w:hyperlink) ont été CORRIGÉS et commités (voir
// test/js/manuscrit-annoter.test.js pour ses propres contrôles). `2-dense_…` — le déclencheur
// RÉEL qui rendait un XML mal formé avant cette correction — doit désormais s'ANNOTER pour de
// vrai : des révisions et/ou des commentaires posés, un XML bien formé sur toutes les parties,
// jamais Annotation.Impossible. Ce contrôle ne rejoue donc plus un échec, il prouve que le
// déclencheur réel ne l'est plus.
//
// Sabotage minimal : dans manuscrit_annoter._localizar(), remplacer `_LONGUEUR_MIN_FOUND_SANS_SPAN`
// par 0 (défaut n°2 réintroduit) — ce contrôle ne rougit pas nécessairement lui-même (le XML
// reste bien formé même avec un mésancrage), mais `test/js/manuscrit-annoter.test.js` le fait ;
// voir plutôt le contrôle n°15 ci-dessous pour le filet de sécurité PROPRE à cette CLI.

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

      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
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
// Contrôle n°15 — le FILET DE SÉCURITÉ de la CLI elle-même (try/except autour de
// manuscrit_annoter.annoter() + _valider_docx_bien_forme() + restauration de la version
// pré-annotation, voir le point d'appel dans principal()) reste éprouvé MÊME MAINTENANT que
// les trois défauts connus de manuscrit_annoter.py sont corrigés — un filet ne se retire pas
// parce que le trapèze n'est, pour l'instant, plus tombé : une régression future dans ce
// module, ou tout autre module, doit encore être rattrapée sans corrompre le .docx ni faire
// planter la CLI.
//
// Aucune fixture normale ne fait plus lever manuscrit_annoter.annoter() (c'est justement ce
// que corrige le commit relu) : ni un `suggested` avec des caractères XML spéciaux (échappés
// par _escapar()/_escapar_attr(), vérifié en lisant le module), ni un chevauchement de spans
// (résolu, le plus sévère devient révision, l'autre commentaire), ni un `found` court sans
// span (rejeté, jamais localisé), ni une frontière de w:hyperlink (jamais révisée). La CLI
// n'offre aucune variable d'environnement pour injecter une panne (ni --sans-annotation, qui
// n'APPELLE PAS annoter() du tout, ce n'est donc pas ce filet-ci qu'il éprouve). Le seul levier
// qui reste, SANS toucher pipeline/manuscrit-nettoyer.py ni pipeline/manuscrit_annoter.py :
// charger manuscrit-nettoyer.py comme un module Python (patron déjà utilisé par
// test/js/manuscrit-vale.test.js, contrôle n°7, pour la même raison) et remplacer SON
// attribut `ma.annoter` par une fonction qui lève — une injection de dépendance au niveau du
// test, jamais une modification du code de production.

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

      const rapport = JSON.parse(fs.readFileSync(obj.sortie_rapport, 'utf8'));
      assert.strictEqual(rapport.annotation, null,
        'annotation ratée injectée : rapport.annotation doit être None, jamais à moitié fait');
      const alerteImpossible = rapport.alertes.liste.find((a) => a.rule === 'Annotation.Impossible');
      assert.ok(alerteImpossible,
        'aucune alerte Annotation.Impossible malgré la panne injectée : '
        + JSON.stringify(rapport.alertes.liste.map((a) => a.rule)));
      assert.strictEqual(alerteImpossible.severity, 'warning');

      // Le .docx livré est celui d'AVANT l'annotation : ni révision ni commentaire posé —
      // la panne injectée n'a jamais pu toucher le fichier sur le disque.
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
