// Contrat de balisage entre pipeline/templates/szh-livre-chapitre.html et les deux scripts qui
// en relisent le HTML par expressions régulières : pipeline/livre-assembler.py (RE_COULEUR_
// CHAPITRE, RE_ONGLET_HAUTEUR, RE_HORS_SOMMAIRE, RE_NUMERO_CHAPITRE, RE_NUM_SECTION, RE_TITRE)
// et pipeline/livre-epub-prepare.py (RE_CHAPITRE, RE_CHAPITRE_ID, RE_ONGLET, RE_PASTILLE,
// RE_PICTO). Un attribut qui change d'ordre dans le gabarit ferait taire ces lectures sans
// aucune erreur : ce test compile un vrai chapitre du banc avec le vrai gabarit, puis fait
// relire le fragment par les VRAIES fonctions des deux scripts (importées, pas recopiées).
//
//   node --test test/js/contrat-gabarit-chapitre.test.js
//
// Le chapitre est copié dans un dossier jetable : rien n'est écrit sous test/livre-normal.
// La chaîne de filtres est réduite à ce qui écrit les balises lues (titre de fiche, numéro de
// section) ; les attributs --metadata sont ceux que pipeline/profils/livre.mk passe. Ni
// szh-numerotation.lua (RE_REGLE_DECOR, bloc <style> de décors) ni les règles d'URL CSS ne
// sont éprouvés ici : leur balisage ne vient pas de ce gabarit.
//
// Sonde de mutation : le même contrôle, sur une COPIE du gabarit dont deux attributs de la
// pastille sont intervertis, doit échouer.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { python, sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const GABARIT = path.join(RACINE, 'pipeline', 'templates', 'szh-livre-chapitre.html');
const BANC = path.join(RACINE, 'test', 'livre-normal');
const DISTRO = 'SZH-Publishing';

function versWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function wsl(args, cwd) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const prefixe = ['-d', DISTRO].concat(cwd ? ['--cd', versWsl(cwd)] : [], ['--']);
  return spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe', prefixe.concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 180000 });
}

// Les trois états que livre.mk sait produire : chapitre du sommaire avec picto, sans picto,
// et retiré du sommaire (`sommaire: non`).
const CAS = {
  'sommaire-avec-picto': ['--metadata', 'onglet-haut=30mm', '--metadata', 'onglet-hauteur=22.857mm',
    '--metadata', 'numero-chapitre=1', '--metadata', 'picto-entete=ecouter'],
  'sommaire-sans-picto': ['--metadata', 'onglet-haut=30mm', '--metadata', 'onglet-hauteur=22.857mm',
    '--metadata', 'numero-chapitre=1'],
  'hors-sommaire': ['--metadata', 'hors-sommaire=1']
};

function compiler(dossier, nom, gabarit, extras) {
  const sortie = path.join(dossier, nom + '.html');
  const f = (n) => versWsl(path.join(RACINE, 'pipeline', 'filters', n));
  const buch = versWsl(path.join(BANC, 'buch.yaml'));
  const args = ['env', 'SZH_LIVRE=1', 'SZH_CHAPITRE=2', 'SZH_AUSGABE=' + buch,
    'pandoc', '02-konzepte.md', '--from=markdown', '--to=html5', '--id-prefix=02-konzepte-',
    '--metadata-file=' + buch, '--metadata-file=02-konzepte.meta.yaml',
    '--metadata', 'slug=02-konzepte', '--metadata', 'couleur-chapitre=#949A00',
    '--metadata', 'rang-chapitre=2'].concat(extras, [
    '--standalone', '--embed-resources', '--template=' + versWsl(gabarit),
    '--lua-filter=' + f('szh-livre-titre.lua'), '--lua-filter=' + f('szh-sections.lua'),
    '-o', nom + '.html']);
  const r = wsl(args, dossier);
  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  return sortie;
}

// Fait relire le fragment par les vraies fonctions des deux scripts et rend ce qu'elles
// trouvent (JSON). Python passe par python() de gardes.js (la WSL sous Windows).
const LECTEUR = [
  'import importlib.util, json, sys',
  'def charger(nom, chemin):',
  '    spec = importlib.util.spec_from_file_location(nom, chemin)',
  '    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m',
  'racine, fragment = sys.argv[1], sys.argv[2]',
  "sys.path.insert(0, racine + '/pipeline')",
  "la = charger('livre_assembler', racine + '/pipeline/livre-assembler.py')",
  "ep = charger('livre_epub_prepare', racine + '/pipeline/livre-epub-prepare.py')",
  "html = open(fragment, encoding='utf-8').read()",
  'segs = ep._segments(html)',
  'nu = ep.retirer_onglets(html)',
  'print(json.dumps({',
  "  'couleur': la.couleur_du_fragment(html),",
  "  'hauteur': la.onglet_hauteur_du_fragment(html),",
  "  'numero': la.numero_chapitre_du_fragment(html),",
  "  'hors': la.hors_sommaire(html),",
  "  'titres': la.titres_du_fragment(html),",
  "  'chapitres': [s for e, s, t in segs if e],",
  "  'reste': [m for m in ('szh-onglet', 'szh-pastille', 'szh-picto-entete') if m in nu],",
  "  'num_section': bool(la.RE_NUM_SECTION.search(html)),",
  '}))'
].join('\n') + '\n';

function relire(dossier, fragment) {
  const lecteur = path.join(dossier, 'lecteur.py');
  fs.writeFileSync(lecteur, LECTEUR, 'utf8');
  const r = python([lecteur, RACINE, fragment], { cwd: dossier });
  assert.strictEqual(r.status, 0, 'lecture des fragments en échec : ' + r.stderr);
  return JSON.parse(r.stdout);
}

// Ce que chaque cas doit faire trouver aux motifs de lecture. Liste de [description, ok].
function verifier(cas, lu) {
  const echecs = [];
  const exige = (desc, ok) => { if (!ok) { echecs.push(cas + ' : ' + desc); } };
  exige('RE_CHAPITRE/RE_CHAPITRE_ID : slug 02-konzepte', JSON.stringify(lu.chapitres) === '["02-konzepte"]');
  exige('RE_COULEUR_CHAPITRE : #949A00', lu.couleur === '#949A00');
  exige('RE_NUM_SECTION : balise présente dans le h1', lu.num_section);
  exige('RE_ONGLET, RE_PASTILLE, RE_PICTO : tous retirés', lu.reste.length === 0);
  if (cas === 'hors-sommaire') {
    exige('RE_HORS_SOMMAIRE : vrai', lu.hors === true);
    exige('RE_NUMERO_CHAPITRE : rien (pastille vide)', lu.numero === null);
    exige('RE_ONGLET_HAUTEUR : rien', lu.hauteur === null);
    exige('RE_TITRE : aucune entrée de sommaire', lu.titres.length === 0);
  } else {
    exige('RE_HORS_SOMMAIRE : faux', lu.hors === false);
    exige('RE_NUMERO_CHAPITRE : 1', lu.numero === '1');
    exige('RE_ONGLET_HAUTEUR : 22.857mm', lu.hauteur === '22.857mm');
    const h1 = lu.titres.find((t) => t[0] === 1);
    exige('RE_TITRE + RE_NUM_SECTION : h1 préfixé du numéro du sommaire',
      !!h1 && h1[2] === '1 Theoretische Konzepte und Vorannahmen');
    exige('RE_TITRE : au moins un h2 relevé', lu.titres.some((t) => t[0] === 2));
  }
  return echecs;
}

function contrat(dossier, gabarit, suffixe) {
  const echecs = [];
  for (const [cas, extras] of Object.entries(CAS)) {
    const frag = compiler(dossier, cas + suffixe, gabarit, extras);
    echecs.push(...verifier(cas, relire(dossier, frag)));
  }
  return echecs;
}

function dossierJetable() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-contrat-chapitre-'));
  fs.cpSync(path.join(BANC, 'chapitres', '02-konzepte'), d, { recursive: true });
  return d;
}

test('gabarit de chapitre : chaque motif de lecture des deux scripts trouve son balisage', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const d = dossierJetable();
  try {
    const frag = fs.readFileSync(compiler(d, 'controle', GABARIT, CAS['sommaire-avec-picto']), 'utf8');
    assert.match(frag, /<div class="szh-pastille" aria-hidden="true">1<\/div>/,
      'la pastille doit rester dans la forme que RE_NUMERO_CHAPITRE attend');
    assert.deepStrictEqual(contrat(d, GABARIT, ''), []);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('sonde de mutation : deux attributs de la pastille intervertis font échouer le contrat', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const d = dossierJetable();
  try {
    const source = fs.readFileSync(GABARIT, 'utf8');
    const avant = '<div class="szh-pastille" aria-hidden="true">';
    assert.ok(source.includes(avant), 'le gabarit n’a plus la pastille attendue : sonde périmée');
    const copie = path.join(d, 'gabarit-mute.html');
    fs.writeFileSync(copie, source.replace(avant, '<div aria-hidden="true" class="szh-pastille">'), 'utf8');
    const echecs = contrat(d, copie, '-mute');
    assert.ok(echecs.some((e) => /RE_NUMERO_CHAPITRE/.test(e)), 'la mutation aurait dû être vue : ' + echecs.join(' | '));
    assert.ok(echecs.some((e) => /RE_PASTILLE/.test(e)));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
