// windows/szh-compteurs.ps1 : l'écrivain PowerShell des compteurs d'usage (contrat : un fichier
// CSV par événement dans _Systeme\compteurs, jamais un mot du manuscrit). Contrepartie de
// vscodium-extension/szh-cockpit/lib/compteurs.js, dont il doit appliquer EXACTEMENT les mêmes
// règles : ce fichier en garde la parité (en-tête, listes blanches, normalisation des noms de
// mesure) et éprouve ce que l'écrivain promet seul :
//
//   - jamais de texte du manuscrit : une mesure dont le nom ou la valeur n'est pas de la forme
//     du contrat est écartée, quel que soit le producteur (sentinelles) ;
//   - UTF-8 avec BOM, `;`, CRLF, en-tête exacte, date locale SANS heure, valeurs `^\d+$` ;
//   - écriture dans `~$<nom>.<pid>` puis renommage, le temporaire supprimé même en cas d'échec ;
//   - deux écritures simultanées = deux fichiers, jamais un écrasement ;
//   - hors ligne : file d'attente locale, vidée au lancement suivant (plafonds 200 / 90 jours) ;
//   - aucun fichier en simulation ou sans réseau, sauf vers un dossier de test explicite ;
//   - ancrage résolu PASSIVEMENT (aucune fenêtre), jamais d'exception vers l'interface.
//
//   node --test test/js/compteurs-ps.test.js
//
// Aucun test ne touche le vrai dossier partagé ni le vrai %LOCALAPPDATA% : SZH_BASE,
// LOCALAPPDATA, USERPROFILE, SZH_COMPTEURS et SZH_ANCRAGE visent toujours des dossiers jetables.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { POWERSHELL, sansPowerShell, sauter } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const SOURCE_PS = path.join(RACINE, 'windows', 'szh-compteurs.ps1');
const SZH_COMMON = path.join(RACINE, 'windows', 'szh-common.ps1');
const COMPTEURS_JS = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'compteurs.js');
const NETTOYEUR_PY = path.join(RACINE, 'pipeline', 'manuscrit-nettoyer.py');
const TEXTE_PS = fs.readFileSync(SOURCE_PS, 'utf8');

const ENTETE = 'date;poste;contexte;version_toolkit;version_rootfs;source;passage;mesure;valeur';
const SENTINELLE = 'SENTINELLE-MANUSCRIT-8c41f2';

function psChaine(v) { return "'" + String(v).replace(/['\u2018\u2019\u201A\u201B]/g, (m) => m + m) + "'"; }

function dossierJetable(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }

// L'environnement d'un pilote : tout ce qui pourrait viser le vrai poste est retiré, puis les
// dossiers jetables posés.
function environnement(travail, extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['OneDrive', 'OneDriveCommercial', 'SZH_ANCRAGE', 'SZH_RAPPORTS', 'SZH_COMPTEURS',
    'SZH_LANCEUR_SIMULE', 'SZH_OPENMD_SIMULE', 'SZH_RESEAU_INTERDIT', 'SZH_MANUSCRIT_CLI',
    'SZH_CODIUM_PROFIL', 'SZH_TOOLKIT']) { delete env[k]; }
  Object.assign(env, {
    SZH_BASE: path.join(travail, 'programdata'),
    LOCALAPPDATA: path.join(travail, 'localappdata'),
    USERPROFILE: path.join(travail, 'profil'),
    SZH_LANGUE: 'fr',
    COMPUTERNAME: 'rmo-test_é1'
  }, extra || {});
  for (const k of ['SZH_BASE', 'LOCALAPPDATA', 'USERPROFILE']) { fs.mkdirSync(env[k], { recursive: true }); }
  return env;
}

function ecrirePilote(travail, script) {
  const pilote = path.join(travail, 'pilote-' + Math.random().toString(16).slice(2) + '.ps1');
  fs.writeFileSync(pilote, '\ufeff' + ["$ErrorActionPreference = 'Stop'", '. ' + psChaine(SZH_COMMON), script].join('\r\n') + '\r\n', 'utf8');
  return pilote;
}

function lancer(travail, env, script) {
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ecrirePilote(travail, script)],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function lancerAsync(travail, env, script) {
  return new Promise((resolve) => {
    const enfant = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ecrirePilote(travail, script)],
      { windowsHide: true, env });
    let err = '';
    enfant.stderr.on('data', (d) => { err += d; });
    enfant.on('close', (code) => resolve({ status: code, stderr: err }));
  });
}

function csvs(dossier) {
  try { return fs.readdirSync(dossier).filter((f) => f.endsWith('.csv')).sort(); } catch (e) { return []; }
}

// Un fichier CSV lu en octets : BOM, CRLF, contenu.
function lireCsv(chemin) {
  const octets = fs.readFileSync(chemin);
  const texte = octets.toString('utf8');
  return { octets, texte, sansBom: texte.replace(/^\uFEFF/, '') };
}

function lignesDonnees(csv) {
  return csv.sansBom.split('\r\n').filter((l) => l !== '').slice(1).map((l) => {
    const c = l.split(';');
    return { date: c[0], poste: c[1], contexte: c[2], version_toolkit: c[3], version_rootfs: c[4],
      source: c[5], passage: c[6], mesure: c[7], valeur: c[8], champs: c.length };
  });
}

function litteraux(texte) { return [...texte.matchAll(/'([^']*)'/g)].map((m) => m[1]); }

// La liste de chaînes d'une constante JS / Python / PowerShell : les littéraux entre la
// déclaration et la parenthèse ou le crochet fermant.
function listeJs(source, nom) {
  const m = new RegExp(nom + '\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)').exec(source);
  assert.ok(m, nom + ' introuvable dans lib/compteurs.js');
  return litteraux(m[1]);
}

const JS_PRESENT = fs.existsSync(COMPTEURS_JS);

// ---------------------------------------------------------------------------------------
// Parité avec lib/compteurs.js
// ---------------------------------------------------------------------------------------

test('l’en-tête du CSV : exactement celle du contrat, dans PowerShell comme dans lib/compteurs.js', (t) => {
  const m = /\$script:SzhCompteursEntete = '([^']*)'/.exec(TEXTE_PS);
  assert.ok(m, 'SzhCompteursEntete introuvable dans szh-compteurs.ps1');
  assert.strictEqual(m[1], ENTETE);
  if (!JS_PRESENT) { return sauter.corpus(t, COMPTEURS_JS + ' (écrit par le chantier cockpit, pas encore fusionné)'); }
  const js = /const ENTETE_COMPTEURS = '([^']*)'/.exec(fs.readFileSync(COMPTEURS_JS, 'utf8'));
  assert.ok(js, 'ENTETE_COMPTEURS introuvable dans lib/compteurs.js');
  assert.strictEqual(m[1], js[1], 'l’en-tête PowerShell diverge de ENTETE_COMPTEURS');
});

test('listes blanches : MESURES_NETTOYEUR et MESURES_IMPORT identiques dans lib/compteurs.js, PowerShell et la CLI Python', (t) => {
  const ps = (nom) => {
    const m = new RegExp('\\$script:' + nom + ' = @\\(([\\s\\S]*?)\\)\\r?\\n').exec(TEXTE_PS);
    assert.ok(m, nom + ' introuvable dans szh-compteurs.ps1');
    return litteraux(m[1]);
  };
  const py = /MESURES_NETTOYEUR = \(([\s\S]*?)\)\n/.exec(fs.readFileSync(NETTOYEUR_PY, 'utf8'));
  assert.ok(py, 'MESURES_NETTOYEUR introuvable dans manuscrit-nettoyer.py');
  const nettoyeurPs = ps('SzhCompteursMesuresNettoyeur');
  const nettoyeurPy = litteraux(py[1]);
  assert.ok(nettoyeurPs.length > 30);
  assert.deepStrictEqual(nettoyeurPs.slice().sort(), nettoyeurPy.slice().sort(), 'PowerShell et Python divergent');
  if (!JS_PRESENT) { return sauter.corpus(t, COMPTEURS_JS + ' (écrit par le chantier cockpit, pas encore fusionné)'); }
  const src = fs.readFileSync(COMPTEURS_JS, 'utf8');
  assert.deepStrictEqual(nettoyeurPs.slice().sort(), listeJs(src, 'MESURES_NETTOYEUR').slice().sort(),
    'MESURES_NETTOYEUR diverge de lib/compteurs.js');
  assert.deepStrictEqual(ps('SzhCompteursMesuresImport').slice().sort(), listeJs(src, 'MESURES_IMPORT').slice().sort(),
    'MESURES_IMPORT diverge de lib/compteurs.js');
});

test('normalisation d’un nom de mesure : PowerShell == normaliserMesure de lib/compteurs.js, sur des cas limites',
  { skip: sansPowerShell }, (t) => {
    if (!JS_PRESENT) { return sauter.corpus(t, COMPTEURS_JS + ' (écrit par le chantier cockpit, pas encore fusionné)'); }
    const compteurs = require(COMPTEURS_JS);
    const grand = 'A' + 'b'.repeat(30) + '.C' + 'd'.repeat(30); // Id de 63 signes
    const trop = 'A' + 'b'.repeat(40) + '.C' + 'd'.repeat(30); // Id de 73 signes : devient Autre
    const candidats = [
      'issue.ok', 'issue.alertes', 'issue.refus:suivi-modifications', 'issue.refus:' + 'a'.repeat(48),
      'issue.refus:' + 'a'.repeat(49), 'issue.refus:Majuscule', 'issue.refus:', 'titres.promus',
      'titres.' + 'a'.repeat(40), 'titres.' + 'a'.repeat(41), 'titres.Promus', 'titres.', 'signes',
      'Signes', 'signes.extra', 'issue.ok\n', 'produit.revue', 'produit.inconnu', 'cas.a', 'cas.c',
      'regle:APA.CitationAbsente:revision', 'regle:APA.CitationAbsente:commentaire',
      'regle:APA.CitationAbsente:rapport', 'regle:APA.CitationAbsente:inconnu',
      'regle:APA:revision', 'regle:x.y:revision', 'regle:texte libre:rapport', 'regle::revision',
      'regle:revision', 'regle:' + grand + ':revision', 'regle:' + trop + ':revision',
      'regle:Autre:revision', 'regle:A.B.C:commentaire', 'regle:a.B:revision', 'auteurs',
      'auteurs_orcid', 'langue_deduite', 'import.code:langue-deduite', 'import.code:Mauvais',
      'import.code:', 'import.code:' + 'a'.repeat(41), 'duree_ms', SENTINELLE.toLowerCase(), '', 'a b'
    ];
    const sources = ['nettoyeur', 'import'];
    const travail = dossierJetable('szh-compteurs-parite-');
    try {
      const sortie = path.join(travail, 'sortie.json');
      // Les noms à saut de ligne final passent par une construction explicite (entre
      // parenthèses : la virgule lie plus fort que +) : un littéral simple-quote ne peut pas le porter.
      const lignesPs = candidats.map((c) => (c.endsWith('\n') ? '(' + psChaine(c.slice(0, -1)) + ' + "`n")' : psChaine(c)));
      const script = [
        '$candidats = @(', lignesPs.join(",\r\n"), ')',
        '$resultat = @()',
        'foreach ($source in @(' + sources.map(psChaine).join(', ') + ')) {',
        '  foreach ($c in $candidats) {',
        '    $r = ConvertTo-SzhCompteursMesure $c $source',
        '    $resultat += ,@($source, $c, $(if ($null -eq $r) { "__NULL__" } else { $r }))',
        '  }',
        '}',
        '[System.IO.File]::WriteAllText(' + psChaine(sortie) + ', (ConvertTo-Json -InputObject $resultat -Compress), (New-Object System.Text.UTF8Encoding($false)))'
      ].join('\r\n');
      const r = lancer(travail, environnement(travail), script);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const ps = JSON.parse(fs.readFileSync(sortie, 'utf8'));
      assert.equal(ps.length, candidats.length * sources.length);
      for (const [source, candidat, attendu] of ps) {
        const js = compteurs.normaliserMesure(candidat, source);
        assert.strictEqual(attendu, js === null ? '__NULL__' : js,
          'divergence sur ' + JSON.stringify(candidat) + ' (source ' + source + ')');
      }
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

// ---------------------------------------------------------------------------------------
// Ce que le fichier contient
// ---------------------------------------------------------------------------------------

test('un fichier : nom, BOM, CRLF, en-tête exacte, neuf champs, date sans heure, valeurs entières ; les mesures hors contrat sont écartées',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-ecrit-');
    try {
      const dossier = path.join(travail, 'compteurs');
      fs.mkdirSync(path.join(travail, 'programdata', 'toolkit'), { recursive: true });
      fs.writeFileSync(path.join(travail, 'programdata', 'toolkit', 'VERSION'), '2026.9.9\r\n', 'utf8');
      fs.writeFileSync(path.join(travail, 'programdata', 'state.json'), JSON.stringify({ rootfs: '20260901.1' }), 'utf8');
      const env = environnement(travail, { SZH_COMPTEURS: dossier });
      const script = [
        '$m = [ordered]@{',
        "  'issue.ok' = 1; 'duree_ms' = 1234; 'signes' = '5000'; 'notes' = 2",
        "  'regle:APA.CitationAbsente:revision' = 3",
        "  'regle:texte libre avec espaces:revision' = 2",
        "  'regle:x.y:revision' = 1",
        "  'regle:Forme.Autre2:rapport' = 1",
        "  'titres.promus' = 2; 'issue.refus:suivi-modifications' = 1",
        "  'Majuscule' = 4; 'issue.ok.extra' = 1; 'images' = 1.5; 'references' = -3; 'cas.b' = $true",
        "  'titres.Autre Feuille' = 1; 'tres.x' = 2; 'paragraphes' = 'douze'; 'images_sans_alt' = $null",
        "  '" + SENTINELLE + "' = 7; 'issue.refus:" + SENTINELLE + "' = 7",
        '}',
        "Write-SzhCompteurs -Source 'nettoyeur' -Passage 'abcdef012345' -Mesures $m"
      ].join('\r\n');
      const r = lancer(travail, env, script);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const fichiers = csvs(dossier);
      assert.equal(fichiers.length, 1, JSON.stringify(fs.readdirSync(dossier)));
      assert.match(fichiers[0], /^\d{8}-RMO-TEST1-nettoyeur-[0-9a-f]{6}\.csv$/);
      assert.deepStrictEqual(fs.readdirSync(dossier), fichiers, 'aucun temporaire ~$ ne doit rester');

      const csv = lireCsv(path.join(dossier, fichiers[0]));
      assert.deepStrictEqual([...csv.octets.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 avec BOM');
      assert.ok(!/[^\r]\n/.test(csv.texte) && !/^\n/.test(csv.texte), 'fins de ligne CRLF partout');
      assert.ok(csv.texte.endsWith('\r\n'));
      assert.strictEqual(csv.sansBom.split('\r\n')[0], ENTETE);
      assert.ok(!csv.texte.includes(SENTINELLE) && !csv.texte.toLowerCase().includes(SENTINELLE.toLowerCase()),
        'aucune sentinelle dans le fichier');

      const lignes = lignesDonnees(csv);
      const aujourdhui = new Date();
      const jour = aujourdhui.getFullYear() + '-' + String(aujourdhui.getMonth() + 1).padStart(2, '0') + '-'
        + String(aujourdhui.getDate()).padStart(2, '0');
      for (const l of lignes) {
        assert.equal(l.champs, 9);
        assert.strictEqual(l.date, jour, 'date locale, sans heure');
        assert.strictEqual(l.poste, 'RMO-TEST1');
        assert.strictEqual(l.contexte, 'prod');
        assert.strictEqual(l.version_toolkit, '2026.9.9');
        assert.strictEqual(l.version_rootfs, '20260901.1');
        assert.strictEqual(l.source, 'nettoyeur');
        assert.strictEqual(l.passage, 'abcdef012345');
        assert.match(l.valeur, /^\d+$/);
        assert.ok(/^[a-z0-9_.:-]{1,96}$/.test(l.mesure) || /^regle:(Autre|[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+):(revision|commentaire|rapport)$/.test(l.mesure), l.mesure);
      }
      const table = {};
      for (const l of lignes) { table[l.mesure] = l.valeur; }
      assert.deepStrictEqual(table, {
        'issue.ok': '1', 'duree_ms': '1234', 'signes': '5000', 'notes': '2',
        'regle:APA.CitationAbsente:revision': '3', 'regle:Autre:revision': '3',
        'regle:Forme.Autre2:rapport': '1', 'titres.promus': '2', 'issue.refus:suivi-modifications': '1'
      });
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('passage invalide : remplacé par 12 hexadécimaux au hasard, jamais recopié', { skip: sansPowerShell }, () => {
  const travail = dossierJetable('szh-compteurs-passage-');
  try {
    const dossier = path.join(travail, 'compteurs');
    const env = environnement(travail, { SZH_COMPTEURS: dossier });
    const r = lancer(travail, env, [
      "Write-SzhCompteurs -Source 'nettoyeur' -Passage '" + SENTINELLE + "' -Mesures @{ 'issue.ok' = 1 }",
      "Write-SzhCompteurs -Source 'nettoyeur' -Passage \"abcdef012345`n\" -Mesures @{ 'issue.ok' = 1 }"
    ].join('\r\n'));
    assert.equal(r.status, 0, r.stderr);
    const passages = csvs(dossier).map((f) => lignesDonnees(lireCsv(path.join(dossier, f)))[0].passage);
    assert.equal(passages.length, 2);
    for (const p of passages) { assert.match(p, /^[0-9a-f]{12}$/); assert.notStrictEqual(p, 'abcdef012345'); }
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('le poste : majuscules, réduit à [A-Z0-9-] (accents, espaces et tirets bas retirés)', { skip: sansPowerShell }, () => {
  const travail = dossierJetable('szh-compteurs-poste-');
  try {
    const dossier = path.join(travail, 'compteurs');
    const env = environnement(travail, { SZH_COMPTEURS: dossier, COMPUTERNAME: 'Poste de Zoé_2-b' });
    const r = lancer(travail, env, "Write-SzhCompteurs -Source 'nettoyeur' -Mesures @{ 'issue.ok' = 1 }");
    assert.equal(r.status, 0, r.stderr);
    const f = csvs(dossier);
    assert.equal(f.length, 1);
    assert.match(f[0], /^\d{8}-POSTEDEZO2-B-nettoyeur-[0-9a-f]{6}\.csv$/);
    assert.strictEqual(lignesDonnees(lireCsv(path.join(dossier, f[0])))[0].poste, 'POSTEDEZO2-B');
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// Le contexte : dev ou prod
// ---------------------------------------------------------------------------------------

function contexteEcrit(variante) {
  const travail = dossierJetable('szh-compteurs-contexte-');
  try {
    const dossier = path.join(travail, 'compteurs');
    const extra = Object.assign({ SZH_COMPTEURS: dossier }, variante.env || {});
    const env = environnement(travail, extra);
    if (variante.preparer) { variante.preparer(travail, env); }
    const r = lancer(travail, env, "Write-SzhCompteurs -Source 'nettoyeur' -Mesures @{ 'issue.ok' = 1 }");
    assert.equal(r.status, 0, r.stderr);
    const f = csvs(dossier);
    assert.equal(f.length, 1);
    return lignesDonnees(lireCsv(path.join(dossier, f[0])))[0].contexte;
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
}

test('contexte : prod par défaut ; dev si SZH_MANUSCRIT_CLI, SZH_CODIUM_PROFIL, config.json "compteurs": "dev" ou un toolkit en jonction',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(contexteEcrit({}), 'prod');
    assert.strictEqual(contexteEcrit({ env: { SZH_MANUSCRIT_CLI: 'C:\\x\\manuscrit-nettoyer.py' } }), 'dev');
    assert.strictEqual(contexteEcrit({ env: { SZH_CODIUM_PROFIL: 'C:\\profil-dev' } }), 'dev');
    assert.strictEqual(contexteEcrit({
      preparer: (travail, env) => fs.writeFileSync(path.join(env.SZH_BASE, 'config.json'), '{"compteurs": "dev"}', 'utf8')
    }), 'dev');
    assert.strictEqual(contexteEcrit({
      preparer: (travail, env) => fs.writeFileSync(path.join(env.SZH_BASE, 'config.json'), '{"compteurs": "prod"}', 'utf8')
    }), 'prod');
    assert.strictEqual(contexteEcrit({
      preparer: (travail, env) => {
        const depot = path.join(travail, 'depot');
        fs.mkdirSync(depot, { recursive: true });
        fs.symlinkSync(depot, path.join(env.SZH_BASE, 'toolkit'), 'junction');
      }
    }), 'dev');
  });

// ---------------------------------------------------------------------------------------
// Atomicité, simultanéité
// ---------------------------------------------------------------------------------------

// Sabotage : retirer le bloc finally de Write-SzhCompteursOctets -- le temporaire `~$` reste.
test('échec du renommage : le temporaire ~$ est supprimé, aucun fichier n’apparaît', { skip: sansPowerShell }, () => {
  const travail = dossierJetable('szh-compteurs-tmp-');
  try {
    const dossier = path.join(travail, 'compteurs');
    const env = environnementAvec(travail, dossier);
    const r = lancer(travail, env, [
      "function Move-Item { throw 'renommage impossible' }",
      "$ok = Write-SzhCompteursOctets -Dossier " + psChaine(dossier) + " -Nom '20260930-P-nettoyeur-abcdef.csv' -Octets ([byte[]](1,2,3))",
      "if ($ok) { throw 'aurait du echouer' }"
    ].join('\r\n'));
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepStrictEqual(fs.readdirSync(dossier), [], 'le dossier doit être vide : ni fichier ni ~$');
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

function environnementAvec(travail, dossier) { return environnement(travail, { SZH_COMPTEURS: dossier }); }

test('le temporaire porte le préfixe ~$ et le pid, et la cible existante n’est jamais réécrite', { skip: sansPowerShell }, () => {
  const travail = dossierJetable('szh-compteurs-jamais-');
  try {
    const dossier = path.join(travail, 'compteurs');
    fs.mkdirSync(dossier, { recursive: true });
    const cible = path.join(dossier, '20260930-P-nettoyeur-abcdef.csv');
    fs.writeFileSync(cible, 'ORIGINAL', 'utf8');
    const r = lancer(travail, environnementAvec(travail, dossier), [
      "$ok = Write-SzhCompteursOctets -Dossier " + psChaine(dossier) + " -Nom '20260930-P-nettoyeur-abcdef.csv' -Octets ([byte[]](1,2,3))",
      "if ($ok) { throw 'une cible existante a ete reecrite' }"
    ].join('\r\n'));
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.strictEqual(fs.readFileSync(cible, 'utf8'), 'ORIGINAL');
    assert.match(TEXTE_PS, /'~\$' \+ \$Nom \+ '\.' \+ \$PID/);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('deux écritures simultanées (deux processus) : deux fichiers, aucun écrasé, aucun temporaire', { skip: sansPowerShell }, async () => {
  const travail = dossierJetable('szh-compteurs-simultane-');
  try {
    const dossier = path.join(travail, 'compteurs');
    const env = environnementAvec(travail, dossier);
    const script = "Write-SzhCompteurs -Source 'nettoyeur' -Passage 'abcdef012345' -Mesures @{ 'issue.ok' = 1; 'signes' = 10 }";
    const [a, b] = await Promise.all([lancerAsync(travail, env, script), lancerAsync(travail, env, script)]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    const fichiers = fs.readdirSync(dossier);
    assert.equal(fichiers.length, 2, JSON.stringify(fichiers));
    assert.ok(fichiers.every((f) => /\.csv$/.test(f)), 'aucun ~$ ne doit rester : ' + JSON.stringify(fichiers));
    for (const f of fichiers) { assert.equal(lignesDonnees(lireCsv(path.join(dossier, f))).length, 2); }
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// Hors ligne : la file d'attente, puis son vidage
// ---------------------------------------------------------------------------------------

test('sans dossier joignable : le fichier va dans %LOCALAPPDATA%\\SZH\\compteurs-en-attente ; le lancement suivant le vide vers le dossier partagé',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-attente-');
    try {
      const env = environnement(travail);
      const attente = path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente');
      const r1 = lancer(travail, env, "Write-SzhCompteurs -Source 'nettoyeur' -Passage 'abcdef012345' -Mesures @{ 'issue.ok' = 1; 'signes' = 10 }");
      assert.equal(r1.status, 0, r1.stderr);
      const enAttente = csvs(attente);
      assert.equal(enAttente.length, 1, 'un fichier en attente : ' + JSON.stringify(fs.existsSync(attente) ? fs.readdirSync(attente) : 'dossier absent'));
      const avant = fs.readFileSync(path.join(attente, enAttente[0]));

      // Un fichier étranger dans la file (mauvaise en-tête) : supprimé, jamais transmis.
      fs.writeFileSync(path.join(attente, 'intrus.csv'), 'colonne;autre\r\n1;2\r\n', 'utf8');

      // Le lancement suivant : le dossier existe maintenant.
      const dossier = path.join(travail, 'partage', 'compteurs');
      const env2 = Object.assign({}, env, { SZH_COMPTEURS: dossier });
      const r2 = lancer(travail, env2, 'Clear-SzhCompteursEnAttente');
      assert.equal(r2.status, 0, r2.stderr);
      assert.deepStrictEqual(csvs(attente), [], 'la file est vide');
      assert.deepStrictEqual(fs.readdirSync(dossier), enAttente, 'seul le vrai fichier est arrivé, sous le même nom');
      assert.ok(Buffer.compare(avant, fs.readFileSync(path.join(dossier, enAttente[0]))) === 0, 'contenu identique');
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('un dossier partagé injoignable (un fichier à la place du dossier) : la file prend le relais, rien ne lève',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-injoignable-');
    try {
      const obstacle = path.join(travail, 'obstacle');
      fs.writeFileSync(obstacle, 'je suis un fichier', 'utf8');
      const env = environnement(travail, { SZH_COMPTEURS: path.join(obstacle, 'compteurs') });
      const r = lancer(travail, env, "Write-SzhCompteurs -Source 'nettoyeur' -Mesures @{ 'issue.ok' = 1 }");
      assert.equal(r.status, 0, r.stderr);
      assert.equal(csvs(path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente')).length, 1);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('la file : plafond de 200 fichiers et de 90 jours, le reste part sans être transmis', { skip: sansPowerShell }, () => {
  const travail = dossierJetable('szh-compteurs-plafond-');
  try {
    const env = environnement(travail);
    const attente = path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente');
    fs.mkdirSync(attente, { recursive: true });
    const maintenant = Date.now();
    const vieux = path.join(attente, 'vieux.csv');
    fs.writeFileSync(vieux, ENTETE + '\r\n', 'utf8');
    const tVieux = new Date(maintenant - 100 * 24 * 3600 * 1000);
    fs.utimesSync(vieux, tVieux, tVieux);
    for (let i = 0; i < 205; i++) {
      const p = path.join(attente, 'recent-' + String(i).padStart(3, '0') + '.csv');
      fs.writeFileSync(p, ENTETE + '\r\n', 'utf8');
      const t = new Date(maintenant - (205 - i) * 1000);
      fs.utimesSync(p, t, t);
    }
    const r = lancer(travail, env, '$n = @(Limit-SzhCompteursEnAttente -Dossier ' + psChaine(attente) + ').Count; Write-Output ("RESTE=" + $n)');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /RESTE=200/);
    const restants = csvs(attente);
    assert.equal(restants.length, 200);
    assert.ok(!restants.includes('vieux.csv'), 'plus de 90 jours : supprimé');
    assert.ok(!restants.includes('recent-000.csv') && restants.includes('recent-204.csv'), 'les plus anciens partent d’abord');
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// Les gardes : simulation, réseau interdit, ancrage passif
// ---------------------------------------------------------------------------------------

// Sabotage : retirer `if (Test-SzhCompteursInterdit) { ... return }` de Write-SzhCompteurs -- les
// fichiers apparaissent dans la file et, avec un ancrage, dans le vrai dossier.
test('SZH_LANCEUR_SIMULE=1 ou SZH_RESEAU_INTERDIT sans SZH_COMPTEURS : aucun fichier, ni dans l’ancrage ni dans la file',
  { skip: sansPowerShell }, () => {
    for (const garde of [{ SZH_LANCEUR_SIMULE: '1' }, { SZH_RESEAU_INTERDIT: '1' }]) {
      const travail = dossierJetable('szh-compteurs-garde-');
      try {
        const ancrage = path.join(travail, 'SZH CSPS', 'Daten_Allgemein - General');
        fs.mkdirSync(path.join(ancrage, '2_Produkte'), { recursive: true });
        const env = environnement(travail, Object.assign({ SZH_ANCRAGE: ancrage }, garde));
        const r = lancer(travail, env, "Write-SzhCompteurs -Source 'nettoyeur' -Mesures @{ 'issue.ok' = 1 }");
        assert.equal(r.status, 0, r.stderr);
        assert.ok(!fs.existsSync(path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente')), 'rien dans la file (' + Object.keys(garde)[0] + ')');
        const sys = path.join(ancrage, '2_Produkte', '54_Pronto', '_Systeme');
        assert.ok(!fs.existsSync(sys), 'rien sous l’ancrage (' + Object.keys(garde)[0] + ')');
        const vidage = lancer(travail, env, 'Clear-SzhCompteursEnAttente');
        assert.equal(vidage.status, 0, vidage.stderr);
      } finally {
        fs.rmSync(travail, { recursive: true, force: true });
      }
    }
  });

test('SZH_COMPTEURS lève la garde de banc : un dossier de test explicite reçoit le fichier même en simulation',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-banc-');
    try {
      const dossier = path.join(travail, 'compteurs');
      const env = environnementAvec(travail, dossier);
      env.SZH_LANCEUR_SIMULE = '1';
      env.SZH_RESEAU_INTERDIT = '1';
      const r = lancer(travail, env, "Write-SzhCompteurs -Source 'nettoyeur' -Mesures @{ 'issue.ok' = 1 }");
      assert.equal(r.status, 0, r.stderr);
      assert.equal(csvs(dossier).length, 1);
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('l’ancrage est résolu passivement : le dossier est dérivé de SZH_ANCRAGE, et le module n’appelle ni fenêtre ni question',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-ancrage-');
    try {
      const ancrage = path.join(travail, 'SZH CSPS', 'Daten_Allgemein - General');
      fs.mkdirSync(path.join(ancrage, '2_Produkte'), { recursive: true });
      const env = environnement(travail, { SZH_ANCRAGE: ancrage });
      const r = lancer(travail, env, "Write-SzhCompteurs -Source 'nettoyeur' -Mesures @{ 'issue.ok' = 1 }");
      assert.equal(r.status, 0, r.stderr);
      const dossier = path.join(ancrage, '2_Produkte', '54_Pronto', '_Systeme', 'compteurs');
      assert.equal(csvs(dossier).length, 1, 'le fichier est sous _Systeme\\compteurs de l’ancrage');
      assert.ok(!fs.existsSync(path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente')));
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
    // Analyse statique : aucune des fonctions qui ouvrent une fenêtre ou posent une question.
    const code = TEXTE_PS.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const interdit of ['Request-SzhAncrageUtilisateur', 'Initialize-SzhAncrage', 'Read-Host', 'ShowDialog',
      'MessageBox', 'FolderBrowserDialog', 'Write-SzhRapport', 'USERNAME', 'USERPROFILE']) {
      assert.ok(!code.includes(interdit), 'szh-compteurs.ps1 ne doit pas contenir ' + interdit);
    }
    assert.match(code, /Get-SzhDossierSysteme 'compteurs'/, 'le dossier vient de Get-SzhDossierSysteme (résolution passive)');
  });

test('ne lève jamais : mesures absentes ou de la mauvaise forme, source inconnue, dossier impossible', { skip: sansPowerShell }, () => {
  const travail = dossierJetable('szh-compteurs-leve-');
  try {
    const dossier = path.join(travail, 'compteurs');
    const env = environnementAvec(travail, dossier);
    const r = lancer(travail, env, [
      "Write-SzhCompteurs -Source 'nettoyeur' -Mesures $null",
      "Write-SzhCompteurs -Source 'nettoyeur' -Mesures 'pas une table'",
      "Write-SzhCompteurs -Source 'nettoyeur' -Mesures @{ 'Majuscule' = 1 }",
      "Write-SzhCompteurs -Source 'inconnue' -Mesures @{ 'issue.ok' = 1 }",
      "Write-SzhCompteurs -Source 'nettoyeur' -Mesures ([pscustomobject]@{ 'issue.ok' = 1 })",
      "Write-Output 'FIN'"
    ].join('\r\n'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FIN/);
    assert.equal(csvs(dossier).length, 1, 'seul l’objet de la forme attendue a produit un fichier');
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// Le branchement : le module est chargé par le socle, la file est vidée au lancement (juste après
// celle des rapports), et le dossier windows/ part tel quel dans le toolkit (release.yml copie le
// dossier entier : aucun fichier à y déclarer un par un).
//
// Sabotage : retirer la ligne `. "$PSScriptRoot\szh-compteurs.ps1"` de szh-common.ps1, ou
// l'appel `Clear-SzhCompteursEnAttente` d'open-produit.ps1.
test('branchement : szh-common.ps1 charge szh-compteurs.ps1, open-produit.ps1 vide la file au lancement, release.yml copie windows/',
  () => {
    const commun = fs.readFileSync(SZH_COMMON, 'utf8');
    assert.match(commun, /^\. "\$PSScriptRoot\\szh-compteurs\.ps1"\r?$/m);
    assert.ok(commun.indexOf('szh-checkin.ps1"') < commun.indexOf('szh-compteurs.ps1"'), 'après le check-in');
    const lanceur = fs.readFileSync(path.join(RACINE, 'windows', 'open-produit.ps1'), 'utf8');
    const rapports = lanceur.indexOf('try { Clear-SzhRapportsEnAttente } catch { }');
    const compteurs = lanceur.indexOf('try { Clear-SzhCompteursEnAttente } catch { }');
    assert.ok(rapports !== -1 && compteurs > rapports, 'la file des compteurs se vide juste après celle des rapports');
    const release = fs.readFileSync(path.join(RACINE, '.github', 'workflows', 'release.yml'), 'utf8');
    assert.match(release, /cp -r pipeline vscodium-user revue-template livre-template windows toolkit\//);
  });

test('Get-SzhCompteursPassage : les 12 premiers hexadécimaux du SHA-256, comme la CLI', { skip: sansPowerShell }, () => {
  const travail = dossierJetable('szh-compteurs-sha-');
  try {
    const fichier = path.join(travail, SENTINELLE + '.docx');
    fs.writeFileSync(fichier, 'contenu du manuscrit', 'utf8');
    const attendu = require('crypto').createHash('sha256').update('contenu du manuscrit').digest('hex').slice(0, 12);
    const r = lancer(travail, environnement(travail),
      'Write-Output ("PASSAGE=" + (Get-SzhCompteursPassage ' + psChaine(fichier) + ')); Write-Output ("ABSENT=[" + (Get-SzhCompteursPassage ' + psChaine(path.join(travail, 'nexiste-pas')) + ') + "]")');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp('PASSAGE=' + attendu));
    assert.match(r.stdout, /ABSENT=\[\]/);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});
