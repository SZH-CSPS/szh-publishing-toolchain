// Deux familles de règles Vale : CSPS.TraitUnion (huit règles écrites à la main,
// pipeline/vale/styles/CSPS/TraitUnion/*.yml) et CSPS.Orthographe.Rectifiee-* (neuf
// catégories générées par outils-dev/lexique/generer-orthographe.py depuis
// pipeline/vale/lexique/orthographe-rectifiee.csv). Voir
// docs/ARCHITECTURE-nettoyeur-manuscrit.md.
//
// vale est cherché sur le PATH, puis dans la WSL. Absent, les tests sautent, sauf si
// SZH_VALE_OBLIGATOIRE=1.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const gardes = require('./gardes');
const { sansPython, sansPandocWsl } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const MANUSCRIT_VALE = path.join(RACINE, 'pipeline', 'manuscrit_vale.py');
const NETTOYEUR = path.join(RACINE, 'pipeline', 'manuscrit-nettoyer.py');
const GENERER_ORTHOGRAPHE = path.join(RACINE, 'outils-dev', 'lexique', 'generer-orthographe.py');
const CSV_ORTHOGRAPHE = path.join(RACINE, 'pipeline', 'vale', 'lexique', 'orthographe-rectifiee.csv');
const STYLES_ORTHOGRAPHE = path.join(RACINE, 'pipeline', 'vale', 'styles', 'CSPS', 'Orthographe');
const DISTRO = 'SZH-Publishing';

function python(args, entree) {
  return gardes.python(args, { input: entree, maxBuffer: 64 * 1024 * 1024 });
}

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

// La Revue écrit en orthographe rectifiée : une graphie traditionnelle est une faute
// (warning, corrigée en révision Word).
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

// Ces exceptions sont simplement absentes du CSV. accroître et décroître, eux, perdent
// l'accent.
test('les exceptions du circonflexe (dû, sûr, mûr, jeûne, croître nu) ne lèvent jamais rien',
  { skip: sansVale }, () => {
    const sortie = analyserCorps(
      "Le résultat est dû à un effort soutenu, et il est sûr que le fruit est mûr avant le "
      + "jeûne, alors que la rivière continue de croître année après année.");
    const orthographe = sortie.alertes.filter((a) => a.rule.startsWith('CSPS.Orthographe.'));
    assert.deepStrictEqual(orthographe, [],
      'aucune règle Orthographe ne doit toucher ces mots : ' + JSON.stringify(orthographe));

    // Contre-épreuve : la règle fonctionne sur les dérivés.
    const derives = analyserCorps('Ce phénomène va décroître puis accroître à nouveau.');
    const trouves = derives.alertes.filter(
      (a) => a.rule === 'CSPS.Orthographe.Rectifiee-Circonflexe');
    assert.strictEqual(trouves.length, 2,
      'accroître et décroître doivent être signalés (pas des exceptions) : '
      + JSON.stringify(derives.alertes));
  });

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

// Le YAML est généré dans un dossier temporaire ; le cas fautif retire un mot de sa copie en
// mémoire.
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

      // Le YAML porte les mots échappés : re.escape() devant l'espace et le trait d'union
      // (`vingt\ et\ un`, `week\-end`), apostrophe doublée entre guillemets simples
      // (`presqu''île`). On défait ces échappements avant de chercher le mot brut du CSV.
      function normaliser(contenu) {
        return contenu.replace(/''/g, "'").replace(/\\(.)/g, '$1');
      }

      function completude(contenu) {
        const normalise = normaliser(contenu);
        return lignesCsv.filter((mot) => !normalise.includes(mot));
      }

      assert.deepStrictEqual(completude(contenuComplet), [],
        'chaque paire du CSV doit apparaître dans le YAML généré');

      // Cas fautif : « coût » retiré de la copie, comme par un générateur qui l'oublierait.
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

// Chaîne complète, par la CLI du nettoyeur dans la WSL. Le .docx fabriqué reprend un
// paragraphe d'un manuscrit réel, suivi d'un paragraphe qui déclenche les deux familles.

const PARAGRAPHE_REEL_3VF = "Depuis l'accord intercantonal (CDIP, 2007) en faveur de mesures "
  + "dites inclusives à l'école, de nombreux élèves, autrefois scolarisés dans la filière "
  + "spécialisée, fréquentent désormais les classes régulières.";

function versCheminWindows(cheminWsl) {
  const m = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(cheminWsl);
  return m ? m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\') : cheminWsl;
}

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
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vale-orthographe-chaine-'));
    try {
      const entree = path.join(base, 'article.docx');
      fabriquerDocx(entree, [
        { texte: "Scolariser en classe régulière : reprise d'un extrait du corpus", style: 'Heading1' },
        { texte: 'Introduction', style: 'Heading1' },
        { texte: PARAGRAPHE_REEL_3VF },
        // Un déclencheur par famille, sur des passages distincts.
        { texte: "Le dossier se trouve au dessus de l'armoire, et le coût de la mesure reste élevé." },
        { texte: 'References', style: 'Heading1' },
        { texte: 'Dupont, J. (2020). Un ouvrage important. Editions Test.' },
      ]);
      const sortie = path.join(base, 'sortie');
      fs.mkdirSync(sortie);

      const r = gardes.python([NETTOYEUR, entree, '--produit', 'revue', '--sortie', sortie,
        '--sans-reseau'], { maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
      // La CLI sort en 1 dès qu'une alerte error existe ; ce .docx minimal en lève
      // (résumé absent). Seul un autre code est un plantage.
      assert.ok(r.status === 0 || r.status === 1,
        'la CLI doit rendre 0 ou 1 dans la WSL, jamais planter : ' + r.stderr + ' / ' + r.stdout);
      const obj = ligneUniqueJson(r.stdout);

      // stdout ne porte que le résumé. La liste des alertes est dans le rapport JSON, dont
      // le chemin WSL se convertit en chemin Windows pour Node.
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
