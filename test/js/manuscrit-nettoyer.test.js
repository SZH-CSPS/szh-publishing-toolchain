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
const { PYTHON, sansPython, sansPandocWsl } = require('./gardes');

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
const FABRIQUER_DOCX = [
  'import json, sys, zipfile',
  'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
  'langue = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'def para_xml(p):',
  '    pStyle = (\'<w:pStyle w:val="%s"/>\' % p["style"]) if p.get("style") else ""',
  '    ppr = ("<w:pPr>%s</w:pPr>" % pStyle) if pStyle else ""',
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
  'ct = (\'<?xml version="1.0"?><Types \'',
  '      \'xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>\')',
  'with zipfile.ZipFile(chemin, "w") as z:',
  '    z.writestr("word/document.xml", doc.encode("utf-8"))',
  '    z.writestr("word/styles.xml", styles.encode("utf-8"))',
  '    z.writestr("[Content_Types].xml", ct)',
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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie]);
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
      const rPropre = nettoyer([propre, '--produit', 'revue', '--sortie', sortiePropre]);
      const objPropre = ligneUniqueJson(rPropre.stdout);
      assert.strictEqual(objPropre.alertes_error, 0);
      assert.strictEqual(rPropre.status, 0, 'aucune alerte error : code de sortie nul');

      const fautif = path.join(base, 'fautif.docx');
      fabriquerDocx(fautif, manuscritMinimal(true));
      const sortieFautif = path.join(base, 'sortie-fautif');
      fs.mkdirSync(sortieFautif);
      const rFautif = nettoyer([fautif, '--produit', 'revue', '--sortie', sortieFautif]);
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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie]);
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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--analyse-seule']);
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
// alertes}}` au lieu d'appeler `mr.grouper(alertes)` — chaque occurrence redevient son
// propre groupe de taille 1, le total de 12 disparaît.

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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie]);
      const obj = ligneUniqueJson(r.stdout);
      assert.strictEqual(obj.alertes_warning, 12, 'les douze occurrences doivent toutes être comptées');
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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie]);
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
      const r = cp.spawnSync(PYTHON, [NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie],
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
      t.skip('corpus tmp/corpus-relecture/lot-A absent (tmp/ est hors git, effacé sans prévenir)');
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
        const r = nettoyer([entree, '--produit', 'revue', '--sortie', dossierSortie]);
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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie]);
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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-typo']);
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
      const rCoherent = nettoyer([entreeCoherente, '--produit', 'revue', '--sortie', sortieCoherente, '--sans-typo']);
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
      const r = python([nettoyeurCopie, entree, '--produit', 'revue', '--sortie', sortie, '--analyse-seule']);
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
      const r = nettoyer([entree, '--produit', 'revue', '--sortie', sortie, '--sans-typo']);
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
        entreeWsl, '--produit', 'revue', '--sortie', sortieWsl],
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
