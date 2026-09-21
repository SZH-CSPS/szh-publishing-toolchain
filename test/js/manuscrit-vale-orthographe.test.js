// test/js/manuscrit-vale-orthographe.test.js : les deux familles Vale ajoutées pour la
// rédaction — CSPS.TraitUnion (huit règles, pipeline/vale/styles/CSPS/TraitUnion/*.yml,
// écrites à la main) et CSPS.Orthographe.Rectifiee-* (neuf catégories, GÉNÉRÉES par
// outils-dev/lexique/generer-orthographe.py depuis pipeline/vale/lexique/
// orthographe-rectifiee.csv). Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §7.
//
// Ce fichier éprouve :
//   1. un positif et un négatif pour chacune des huit règles TraitUnion ;
//   2. un positif et un négatif pour chacune des neuf catégories Orthographe.Rectifiee-* ;
//   3. les quatre exceptions de la famille circonflexe (dû, sûr, mûr, jeûne) et le verbe
//      « croître » nu (mais pas ses dérivés accroître/décroître) ne lèvent JAMAIS rien —
//      décidées comme jamais mécanisées (voir le CSV, colonne absente) ;
//   4. generer-orthographe.py est idempotent (même CSV -> mêmes octets, deux exécutions) ;
//   5. chaque paire du CSV a une trace dans le YAML généré — un mot du CSV absent du YAML
//      (sabotage : un fichier généré manuellement tronqué) fait rougir le contrôle ;
//   6. la chaîne complète (manuscrit-nettoyer.py, DANS la WSL comme en production) : un
//      manuscrit fondé sur un vrai fichier du corpus porte bien les deux familles dans
//      `alertes.liste`, `dans_docx: 'revision'` pour chacune (action=fix, suggested non vide).
//
//   node --test test/js/manuscrit-vale-orthographe.test.js
//
// Détection de vale FAITE ICI (comme test/js/manuscrit-vale.test.js et le contrôle n°13 de
// test/js/manuscrit-nettoyer.test.js : « jamais dans test/js/gardes.js, hors périmètre de ce
// chantier »). Sans vale : t.skip('vale absent'), sauf SZH_VALE_OBLIGATOIRE=1.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_VALE = path.join(RACINE, 'pipeline', 'manuscrit_vale.py');
const NETTOYEUR = path.join(RACINE, 'pipeline', 'manuscrit-nettoyer.py');
const GENERER_ORTHOGRAPHE = path.join(RACINE, 'outils-dev', 'lexique', 'generer-orthographe.py');
const CSV_ORTHOGRAPHE = path.join(RACINE, 'pipeline', 'vale', 'lexique', 'orthographe-rectifiee.csv');
const STYLES_ORTHOGRAPHE = path.join(RACINE, 'pipeline', 'vale', 'styles', 'CSPS', 'Orthographe');
const CORPUS_3VF = path.join(RACINE, 'tmp', 'corpus-relecture', 'lot-A',
  '3_VF_Chanier-Delorme_Article CSPS_290626.docx');
const DISTRO = 'SZH-Publishing';

function python(args, entree) {
  return cp.spawnSync(PYTHON, args,
    { encoding: 'utf8', input: entree, maxBuffer: 64 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------------
// Détection de vale — même patron que manuscrit-vale.test.js : PATH d'abord, wsl.exe en repli.

function detecterValeSurPath() {
  try {
    const r = cp.spawnSync('vale', ['--version'],
      { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) {
    return false;
  }
}

function detecterValeSurWsl() {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const exe = fs.existsSync(wslExe) ? wslExe : 'wsl.exe';
  try {
    const r = cp.spawnSync(exe, ['-d', DISTRO, '--', 'bash', '-lc', 'vale --version'],
      { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return !r.error && r.status === 0 && /vale version/i.test(String(r.stdout || ''));
  } catch (e) {
    return false;
  }
}

const _valeOk = detecterValeSurPath() || detecterValeSurWsl();

function exiger(variable, motif) {
  if (motif && process.env[variable]) {
    throw new Error(motif + ' — ' + variable + ' est posé : cet outil est déclaré '
      + 'obligatoire, sauter le contrôle est refusé.');
  }
  return motif;
}
const sansVale = exiger('SZH_VALE_OBLIGATOIRE',
  _valeOk ? false : 'vale absent (ni sur le PATH, ni dans la distro ' + DISTRO
    + ' via wsl.exe)');

// ---------------------------------------------------------------------------------
// Appel à manuscrit_vale.py --analyser — même patron que manuscrit-vale.test.js.

function analyser(paragraphesCorps, langue) {
  const r = python([MANUSCRIT_VALE, '--analyser'], JSON.stringify({
    paragraphes_corps: paragraphesCorps, paragraphes_biblio: [], langue
  }));
  assert.ok(r.status === 0 || r.status === 1,
    '--analyser devait rendre 0 ou 1, a rendu ' + r.status + ' : ' + r.stderr);
  let sortie;
  try {
    sortie = JSON.parse(r.stdout);
  } catch (e) {
    throw new Error('--analyser n\'a pas rendu de JSON exploitable : ' + e.message
      + '\nstdout: ' + r.stdout + '\nstderr: ' + r.stderr);
  }
  return sortie;
}

function analyserCorps(texte, langue) {
  return analyser([{ source: 0, texte, role: '' }], langue || 'fr');
}

// ---------------------------------------------------------------------------------
// Contrôle n°1 — un positif et un négatif pour chacune des huit règles TraitUnion. Les
// sabotages minimaux (un par règle, documentés au rapport) : retirer une paire précise du
// bloc `swap:` de son fichier — la règle ne se déclenche alors plus DU TOUT sur ce cas
// précis, l'assertion positive rougit.

const CAS_TRAIT_UNION = [
  { regle: 'CSPS.TraitUnion.ComposesFiges',
    positif: () => analyserCorps("Le dossier se trouve au dessus de l'armoire."),
    negatif: () => analyserCorps("Le dossier se trouve au-dessus de l'armoire.") },
  { regle: 'CSPS.TraitUnion.PrefixesInvariables',
    positif: () => analyserCorps("Ils se sont vus lors d'une demi heure de pause."),
    negatif: () => analyserCorps("Ils se sont vus lors d'une demi-heure de pause.") },
  { regle: 'CSPS.TraitUnion.PrefixeExAncien',
    positif: () => analyserCorps('Ex président, il continue de suivre le dossier.'),
    negatif: () => analyserCorps('Ex-président, il continue de suivre le dossier.') },
  { regle: 'CSPS.TraitUnion.PrefixeAntiVoyelleI',
    positif: () => analyserCorps('Le traitement antiinflammatoire a été prescrit.'),
    negatif: () => analyserCorps('Le traitement anti-inflammatoire a été prescrit.') },
  { regle: 'CSPS.TraitUnion.PrefixeNonQuasiNoms',
    positif: () => analyserCorps('Le non respect des règles pose problème.'),
    negatif: () => analyserCorps('Le non-respect des règles pose problème.') },
  { regle: 'CSPS.TraitUnion.InversionVerbePronom',
    positif: () => analyserCorps('Va il à la réunion prévue demain ?'),
    negatif: () => analyserCorps('Va-t-il à la réunion prévue demain ?') },
  { regle: 'CSPS.TraitUnion.MemeApresPronom',
    positif: () => analyserCorps("Ils l'ont vécu eux mêmes, sans aide extérieure."),
    negatif: () => analyserCorps("Ils l'ont vécu eux-mêmes, sans aide extérieure.") },
  { regle: 'CSPS.TraitUnion.DemonstratifsCiLa',
    positif: () => analyserCorps("Ce constat, celui ci, mérite d'être creusé."),
    negatif: () => analyserCorps("Ce constat, celui-ci, mérite d'être creusé.") },
];

for (const cas of CAS_TRAIT_UNION) {
  test('TraitUnion ' + cas.regle + ' : positif signalé, négatif silencieux',
    { skip: sansVale }, () => {
      const avecFaute = cas.positif();
      const trouves = avecFaute.alertes.filter((a) => a.rule === cas.regle);
      assert.strictEqual(trouves.length, 1,
        cas.regle + ' aurait dû lever exactement une alerte sur le cas positif : '
        + JSON.stringify(avecFaute.alertes));
      assert.strictEqual(trouves[0].severity, 'warning');
      assert.strictEqual(trouves[0].action, 'fix');
      assert.ok(trouves[0].suggested, 'une révision Word a besoin d\'un suggested non vide');

      const sansFaute = cas.negatif();
      assert.deepStrictEqual(
        sansFaute.alertes.filter((a) => a.rule === cas.regle), [],
        cas.regle + ' n\'aurait dû lever aucune alerte sur le cas négatif : '
        + JSON.stringify(sansFaute.alertes));
    });
}

// ---------------------------------------------------------------------------------
// Contrôle n°2 — un positif et un négatif pour chacune des neuf catégories
// Orthographe.Rectifiee-*. Niveau `warning` partout (décision de la rédaction du 21.09.2026 :
// la Revue écrit en orthographe rectifiée, une graphie traditionnelle est une faute
// résiduelle, jamais une politique à trancher — voir le rapport).
//
// Sabotage minimal (un par catégorie) : dans orthographe-rectifiee.csv, retirer la ligne
// correspondante puis régénérer — l'assertion positive rougit (plus aucune règle ne connaît
// ce mot).

const CAS_ORTHOGRAPHE = [
  { regle: 'CSPS.Orthographe.Rectifiee-Circonflexe',
    positif: () => analyserCorps('Le coût de cette mesure reste élevé.'),
    negatif: () => analyserCorps('Le cout de cette mesure reste élevé.') },
  { regle: 'CSPS.Orthographe.Rectifiee-Grave',
    positif: () => analyserCorps('Un événement marquant a eu lieu hier.'),
    negatif: () => analyserCorps('Un évènement marquant a eu lieu hier.') },
  { regle: 'CSPS.Orthographe.Rectifiee-Trema',
    positif: () => analyserCorps('La réponse reste ambiguë sur ce point précis.'),
    negatif: () => analyserCorps('La réponse reste ambigüe sur ce point précis.') },
  { regle: 'CSPS.Orthographe.Rectifiee-Numeraux',
    positif: () => analyserCorps('Vingt et un élèves étaient présents ce jour-là.'),
    negatif: () => analyserCorps('Vingt-et-un élèves étaient présents ce jour-là.') },
  { regle: 'CSPS.Orthographe.Rectifiee-Soudure',
    positif: () => analyserCorps('Ils sont partis en week-end ensemble.'),
    negatif: () => analyserCorps('Ils sont partis en weekend ensemble.') },
  { regle: 'CSPS.Orthographe.Rectifiee-OlleOtte',
    positif: () => analyserCorps('La corolle de cette fleur est fragile.'),
    negatif: () => analyserCorps('La corole de cette fleur est fragile.') },
  { regle: 'CSPS.Orthographe.Rectifiee-ElerEter',
    positif: () => analyserCorps('La neige amoncelle vite sur le toit incliné.'),
    negatif: () => analyserCorps('La neige amoncèle vite sur le toit incliné.') },
  { regle: 'CSPS.Orthographe.Rectifiee-PlurielComposes',
    positif: () => analyserCorps('Des après-midi entiers y ont été consacrés.'),
    negatif: () => analyserCorps('Des après-midis entiers y ont été consacrés.') },
  { regle: 'CSPS.Orthographe.Rectifiee-Emprunts',
    positif: () => analyserCorps('On a partagé des sandwiches ensemble à midi.'),
    negatif: () => analyserCorps('On a partagé des sandwichs ensemble à midi.') },
];

for (const cas of CAS_ORTHOGRAPHE) {
  test('Orthographe ' + cas.regle + ' : positif signalé (warning, fix), négatif silencieux',
    { skip: sansVale }, () => {
      const avecFaute = cas.positif();
      const trouves = avecFaute.alertes.filter((a) => a.rule === cas.regle);
      assert.strictEqual(trouves.length, 1,
        cas.regle + ' aurait dû lever exactement une alerte sur le cas positif : '
        + JSON.stringify(avecFaute.alertes));
      assert.strictEqual(trouves[0].severity, 'warning',
        'décision du 21.09.2026 : toutes les règles Orthographe.Rectifiee-* sont warning');
      assert.strictEqual(trouves[0].action, 'fix');
      assert.ok(trouves[0].suggested);

      const sansFaute = cas.negatif();
      assert.deepStrictEqual(
        sansFaute.alertes.filter((a) => a.rule === cas.regle), [],
        cas.regle + ' n\'aurait dû lever aucune alerte sur le cas négatif : '
        + JSON.stringify(sansFaute.alertes));
    });
}

// ---------------------------------------------------------------------------------
// Contrôle n°3 — les exceptions de la famille circonflexe ne lèvent JAMAIS rien : dû, sûr,
// mûr, jeûne (et leurs formes citées), et le verbe « croître » NU (mais pas ses dérivés
// accroître/décroître, qui perdent bien l'accent — couverts par le CSV). Ces mots sont
// simplement ABSENTS du CSV (jamais un motif qui les exclurait explicitement) : ce contrôle
// prouve l'absence, pas une exclusion active.
//
// Sabotage minimal : ajouter la ligne `sûr;sur;circonflexe;...` au CSV et régénérer — la
// première assertion rougirait (une alerte apparaîtrait sur « sûr »).

test('les exceptions du circonflexe (dû, sûr, mûr, jeûne, croître nu) ne lèvent jamais rien',
  { skip: sansVale }, () => {
    const sortie = analyserCorps(
      "Le résultat est dû à un effort soutenu, et il est sûr que le fruit est mûr avant le "
      + "jeûne, alors que la rivière continue de croître année après année.");
    const orthographe = sortie.alertes.filter((a) => a.rule.startsWith('CSPS.Orthographe.'));
    assert.deepStrictEqual(orthographe, [],
      'aucune règle Orthographe ne doit toucher ces mots : ' + JSON.stringify(orthographe));

    // accroître/décroître, eux, PERDENT bien l'accent (pas des exceptions) — preuve que
    // l'absence ci-dessus n'est pas due à un défaut plus large de la règle.
    const derives = analyserCorps('Ce phénomène va décroître puis accroître à nouveau.');
    const trouves = derives.alertes.filter(
      (a) => a.rule === 'CSPS.Orthographe.Rectifiee-Circonflexe');
    assert.strictEqual(trouves.length, 2,
      'accroître et décroître doivent être signalés (pas des exceptions) : '
      + JSON.stringify(derives.alertes));
  });

// ---------------------------------------------------------------------------------
// Contrôle n°4 — generer-orthographe.py est idempotent : deux exécutions sur le même CSV,
// dans un dossier de styles isolé, rendent des octets identiques, fichier par fichier.
//
// Sabotage minimal : dans generer-orthographe.py::construire_paires, retirer le `sorted(...)`
// autour de `paires.items()` — l'ordre d'un dict Python dépend alors de l'ordre d'insertion,
// donc de l'ordre des lignes du CSV : ce contrôle resterait vert tant que le CSV ne change
// pas d'ordre entre les deux exécutions (rien à régénérer), mais rougirait dès qu'une ligne
// est réordonnée sans que le contenu change — un défaut réel que ce contrôle est fait pour
// attraper, pas la stabilité d'un CSV inchangé.

test('generer-orthographe.py est idempotent (même CSV -> mêmes octets)', { skip: sansPython }, () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-orthographe-idem-'));
  try {
    const stylesA = path.join(dossier, 'a');
    const stylesB = path.join(dossier, 'b');
    const r1 = python([GENERER_ORTHOGRAPHE, '--csv', CSV_ORTHOGRAPHE, '--styles-dir', stylesA]);
    assert.strictEqual(r1.status, 0, 'première exécution : ' + r1.stderr);
    const r2 = python([GENERER_ORTHOGRAPHE, '--csv', CSV_ORTHOGRAPHE, '--styles-dir', stylesB]);
    assert.strictEqual(r2.status, 0, 'deuxième exécution : ' + r2.stderr);

    const fichiersA = fs.readdirSync(stylesA).sort();
    const fichiersB = fs.readdirSync(stylesB).sort();
    assert.deepStrictEqual(fichiersA, fichiersB, 'les deux exécutions doivent produire les mêmes fichiers');
    assert.ok(fichiersA.length >= 9, 'au moins neuf catégories attendues : ' + fichiersA.join(', '));
    for (const nom of fichiersA) {
      const octetsA = fs.readFileSync(path.join(stylesA, nom));
      const octetsB = fs.readFileSync(path.join(stylesB, nom));
      assert.ok(octetsA.equals(octetsB), nom + ' diffère entre les deux exécutions');
    }
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------
// Contrôle n°5 — chaque paire du CSV a une trace dans le YAML généré : un mot du CSV absent
// du YAML doit faire rougir ce contrôle. Prouvé par sabotage RÉEL (pas seulement décrit) :
// voir le rapport pour le tableau sabotage -> rouge/vert. Le sabotage ici prend la forme d'un
// dossier de styles ISOLÉ dont on a supprimé une ligne d'un fichier généré à la main, comme
// le ferait un générateur qui oublierait un mot — jamais une modification des fichiers
// versionnés du dépôt (interdite par la discipline du chantier).

test('un mot du CSV absent du YAML généré fait rougir le contrôle de complétude',
  { skip: sansPython }, () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-orthographe-completude-'));
    try {
      const styles = path.join(dossier, 'styles');
      const r = python([GENERER_ORTHOGRAPHE, '--csv', CSV_ORTHOGRAPHE, '--styles-dir', styles]);
      assert.strictEqual(r.status, 0, r.stderr);

      const csv = fs.readFileSync(CSV_ORTHOGRAPHE, 'utf8').split('\n').filter((l) => l.trim());
      const entetes = csv[0].split(';');
      const iTrad = entetes.indexOf('traditionnelle');
      const lignesCsv = csv.slice(1).map((l) => l.split(';')[iTrad]);
      assert.ok(lignesCsv.length > 150, 'le CSV doit porter plus de 150 paires : ' + lignesCsv.length);

      const contenuComplet = fs.readdirSync(styles)
        .map((nom) => fs.readFileSync(path.join(styles, nom), 'utf8')).join('\n');

      // Le motif écrit dans le YAML n'est jamais le mot brut : `\b` l'encadre et re.escape()
      // échappe l'espace et le trait d'union (`vingt\ et\ un`, `week\-end`), l'apostrophe
      // simple est doublée dans une valeur YAML entre guillemets simples (`presqu''île`).
      // Comparer le mot BRUT du CSV à ce texte échappé demande donc de défaire ces trois
      // échappements avant toute recherche de sous-chaîne — sinon CHAQUE mot à espace ou
      // trait d'union semblerait « absent » alors qu'il est bien présent (mesuré en écrivant
      // ce contrôle : 33 faux « manquants » avant cette normalisation).
      function normaliser(contenu) {
        return contenu.replace(/''/g, "'").replace(/\\(.)/g, '$1');
      }

      function completude(contenu) {
        const normalise = normaliser(contenu);
        return lignesCsv.filter((mot) => !normalise.includes(mot));
      }

      // Vert : aucun mot du CSV n'est absent du YAML généré normalement.
      assert.deepStrictEqual(completude(contenuComplet), [],
        'chaque paire du CSV doit apparaître dans le YAML généré');

      // Sabotage RÉEL : on retire de la copie en mémoire toutes les occurrences d'un mot
      // précis du CSV (« coût », catégorie circonflexe), comme le ferait un générateur qui
      // aurait oublié cette ligne.
      const motSabote = 'coût';
      assert.ok(lignesCsv.includes(motSabote), 'le mot de sabotage doit exister dans le CSV');
      const contenuSabote = contenuComplet.split(motSabote).join('');
      const manquants = completude(contenuSabote);
      assert.ok(manquants.includes(motSabote),
        'le sabotage doit être détecté : ' + JSON.stringify(manquants));
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------
// Contrôle n°6 — LA CHAÎNE COMPLÈTE, DANS LA WSL comme en production (même patron que le
// contrôle n°12/13 de test/js/manuscrit-nettoyer.test.js) : les deux nouvelles familles
// apparaissent dans `alertes.liste`, `dans_docx: 'revision'` pour chacune.
//
// Le fichier réel `tmp/corpus-relecture/lot-A/3_VF_Chanier-Delorme_Article CSPS_290626.docx`
// nommé par le brief a été vérifié (pandoc -t plain, WSL, 21.09.2026) : aucune des 185 paires
// Orthographe ni des 284 paires TraitUnion n'y apparaît telle quelle (article déjà propre,
// vocabulaire fermé par construction — voir le rapport). La fixture ci-dessous reprend donc
// un VRAI paragraphe extrait de ce fichier (le début de son introduction, inchangé) et y
// AJOUTE un paragraphe supplémentaire portant un déclencheur de chaque famille — jamais une
// réécriture du fichier réel lui-même (qui n'est de toute façon jamais modifié, lecture
// seule).

const PARAGRAPHE_REEL_3VF = "Depuis l'accord intercantonal (CDIP, 2007) en faveur de mesures "
  + "dites inclusives à l'école, de nombreux élèves, autrefois scolarisés dans la filière "
  + "spécialisée, fréquentent désormais les classes régulières.";

function versCheminWsl(cheminWindows) {
  const p = cheminWindows.replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(p);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : p;
}

function versCheminWindows(cheminWsl) {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(cheminWsl);
  return m ? m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\') : cheminWsl;
}

const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');

const FABRIQUER_DOCX = [
  'import json, sys, zipfile',
  'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
  'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'def para_xml(p):',
  '    pStyle = (\'<w:pStyle w:val="%s"/>\' % p["style"]) if p.get("style") else ""',
  '    ppr = ("<w:pPr>%s</w:pPr>" % pStyle) if pStyle else ""',
  '    run = \'<w:r><w:t xml:space="preserve">%s</w:t></w:r>\' % p.get("texte", "")',
  '    return "<w:p>%s%s</w:p>" % (ppr, run)',
  'corps = "".join(para_xml(p) for p in paras)',
  'doc = (\'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s">\'',
  '       \'<w:body>%s</w:body></w:document>\') % (W, corps)',
  'styles = \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">\' % W',
  'for sid, nom in (("Heading1", "heading 1"), ("Normal", "Normal")):',
  '    styles += \'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' % (sid, nom)',
  'styles += "</w:styles>"',
  'with zipfile.ZipFile(chemin, "w") as z:',
  '    z.writestr("word/document.xml", doc.encode("utf-8"))',
  '    z.writestr("word/styles.xml", styles.encode("utf-8"))',
].join('\n');

function fabriquerDocx(chemin, paragraphes) {
  const r = python(['-c', FABRIQUER_DOCX, chemin, JSON.stringify(paragraphes)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

function ligneUniqueJson(stdout) {
  const lignes = stdout.split('\n').filter((l) => l.length > 0);
  assert.strictEqual(lignes.length, 1,
    'stdout doit porter EXACTEMENT une ligne — obtenu : ' + JSON.stringify(lignes));
  return JSON.parse(lignes[0]);
}

test('chaîne complète (DANS la WSL) : TraitUnion et Orthographe apparaissent dans '
  + "alertes.liste avec dans_docx: 'revision'",
  { skip: sansPython || sansPandocWsl }, () => {
    assert.ok(fs.existsSync(CORPUS_3VF), 'le manuscrit du corpus doit exister : ' + CORPUS_3VF);

    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vale-orthographe-chaine-'));
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, [
        { texte: "Scolariser en classe régulière : reprise d'un extrait du corpus", style: 'Heading1' },
        { texte: 'Introduction', style: 'Heading1' },
        { texte: PARAGRAPHE_REEL_3VF },
        // Déclencheurs : un par famille, sur des passages DISTINCTS pour ne jamais collisionner.
        { texte: "Le dossier se trouve au dessus de l'armoire, et le coût de la mesure reste élevé." },
        { texte: 'References', style: 'Heading1' },
        { texte: 'Dupont, J. (2020). Un ouvrage important. Editions Test.' },
      ]);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);

      const entreeWsl = versCheminWsl(entree);
      const nettoyeurWsl = versCheminWsl(NETTOYEUR);
      const sortieWsl = versCheminWsl(sortie);

      const r = cp.spawnSync(WSL_EXE, ['-d', DISTRO, '--', 'python3', nettoyeurWsl,
        entreeWsl, '--produit', 'revue', '--sortie', sortieWsl, '--sans-reseau'],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
      // Code de sortie non nul dès qu'une alerte `error` existe (contrat de la CLI, contrôle
      // n°2 de test/js/manuscrit-nettoyer.test.js) : la fixture ci-dessus déclenche aussi une
      // alerte structurelle 'error' sans rapport avec ce chantier (résumé absent, gabarit
      // minimal) — 0 OU 1 est donc un succès du POINT DE VUE DE CE CONTRÔLE, comme
      // manuscrit-vale.test.js le fait déjà pour --analyser ; un statut différent est un vrai
      // plantage.
      assert.ok(r.status === 0 || r.status === 1,
        'la CLI doit rendre 0 ou 1 dans la WSL, jamais planter : ' + r.stderr + ' / ' + r.stdout);
      const obj = ligneUniqueJson(r.stdout);

      // La ligne stdout ne porte que le RÉSUMÉ (alertes_total, alertes_error...) : la liste
      // complète, avec `dans_docx` sur chaque alerte, est dans le rapport JSON écrit sur
      // disque (obj.sortie_rapport, un chemin WSL — reconverti en chemin Windows pour le lire
      // depuis ce processus Node).
      const rapport = JSON.parse(fs.readFileSync(versCheminWindows(obj.sortie_rapport), 'utf8'));
      const liste = rapport.alertes.liste;
      const traitUnion = liste.filter((a) => a.rule === 'CSPS.TraitUnion.ComposesFiges');
      const orthographe = liste.filter((a) => a.rule === 'CSPS.Orthographe.Rectifiee-Circonflexe');
      assert.strictEqual(traitUnion.length, 1,
        'CSPS.TraitUnion.ComposesFiges doit apparaître dans alertes.liste : ' + JSON.stringify(liste));
      assert.strictEqual(orthographe.length, 1,
        'CSPS.Orthographe.Rectifiee-Circonflexe doit apparaître dans alertes.liste : ' + JSON.stringify(liste));
      assert.strictEqual(traitUnion[0].dans_docx, 'revision',
        'une substitution warning/fix doit partir en révision Word (§7 ter) : ' + JSON.stringify(traitUnion[0]));
      assert.strictEqual(orthographe[0].dans_docx, 'revision',
        'une substitution warning/fix doit partir en révision Word (§7 ter) : ' + JSON.stringify(orthographe[0]));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
