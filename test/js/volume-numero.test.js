// Créer un numéro par son année et son numéro, et non par un nom de dossier.
//
//   node --test test/js/volume-numero.test.js
//
// Deux sujets :
//   * la formule du volume. Le volume s'imprime sur la couverture (szh-maquette.lua) et part
//     dans OJS en <volume> ; une erreur d'un cran fausserait tous les numéros suivants sans
//     message. La formule est jugée contre un relevé de l'archive publique ;
//   * le refus du doublon. Un numéro s'identifie par son couple volume + numéro, pas par son
//     nom de dossier, et un numéro archivé compte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN = path.join(RACINE, 'windows', 'szh-common.ps1');
const PRODUITS = path.join(RACINE, 'windows', 'szh-produits.ps1');
// Le formulaire « Nouveau » de l'Accueil, qui appelle new-revue.ps1 par le socle.
const NOUVEAU = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'accueil-nouveau.js');
const CREATION = path.join(RACINE, 'windows', 'new-revue.ps1');

const psCommun = fs.readFileSync(COMMUN, 'utf8');
// Les ancres de volume et la formule vivent dans szh-produits.ps1, que szh-common.ps1
// dot-source.
const psProduits = fs.readFileSync(PRODUITS, 'utf8');
const jsNouveau = fs.readFileSync(NOUVEAU, 'utf8');
const psCreation = fs.readFileSync(CREATION, 'utf8');

// ---- Le relevé ---------------------------------------------------------------------
// Relevé sur https://ojs.szh.ch/index.php/revue/issue/archive et .../zeitschrift/...,
// jusqu'au plus ancien numéro en ligne : neuf millésimes de suite pour chaque revue.
const RELEVE = {
  // « Vol. 16 No 02 (2026) » … « Vol. 8 No 1 (2018) »
  revue: { 2018: 8, 2019: 9, 2020: 10, 2021: 11, 2022: 12, 2023: 13, 2024: 14, 2025: 15, 2026: 16 },
  // « Bd. 32 Nr. 06 (2026) » … « Bd. 24 Nr. 1 (2018) »
  zeitschrift: { 2018: 24, 2019: 25, 2020: 26, 2021: 27, 2022: 28, 2023: 29, 2024: 30, 2025: 31, 2026: 32 }
};

test('volume : les deux ancres déclarées reproduisent le relevé de ojs.szh.ch', () => {
  // L'année zéro est écrite une seule fois dans le dépôt, dans szh-produits.ps1.
  const bloc = psProduits.match(/\$script:SzhVolumeAnneeZero = @\{([^}]*)\}/);
  assert.ok(bloc, 'SzhVolumeAnneeZero a disparu de szh-produits.ps1');
  const ancres = {};
  for (const m of bloc[1].matchAll(/(revue|zeitschrift)\s*=\s*(\d{4})/g)) {
    ancres[m[1]] = Number(m[2]);
  }
  assert.deepStrictEqual(ancres, { revue: 2010, zeitschrift: 1994 },
    'les années zéro ont changé : le relevé ci-dessus doit être refait avant');
  // La soustraction rend, année par année, ce que l'archive publie.
  for (const produit of Object.keys(RELEVE)) {
    for (const [annee, volume] of Object.entries(RELEVE[produit])) {
      assert.strictEqual(Number(annee) - ancres[produit], volume,
        produit + ' ' + annee + ' : le relevé dit ' + volume);
    }
  }
});

// Le code sans ses lignes de commentaire : une année citée en commentaire ne calcule rien.
function codeSeul(source) {
  return source.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
}

test('volume : la formule ne se laisse pas écrire ailleurs', () => {
  // Une seconde copie de 1994 ou de 2010 pourrait diverger : Get-SzhVolumePour est le seul
  // chemin.
  const copies = (codeSeul(psProduits).match(/\b(1994|2010)\b/g) || []).length;
  assert.strictEqual(copies, 2, 'les années zéro apparaissent ' + copies + ' fois dans szh-produits.ps1');
  // Le formulaire de l'Accueil, et tout autre script de windows/.
  assert.strictEqual((jsNouveau.match(/\b(1994|2010)\b/g) || []).length, 0,
    'lib/accueil-nouveau.js recalcule le volume au lieu d’appeler Get-SzhVolumePour');
  for (const nom of fs.readdirSync(path.join(RACINE, 'windows')).filter((n) => n.endsWith('.ps1') && n !== 'szh-produits.ps1')) {
    const code = codeSeul(fs.readFileSync(path.join(RACINE, 'windows', nom), 'utf8'));
    assert.strictEqual((code.match(/\b(1994|2010)\b/g) || []).length, 0,
      nom + ' recalcule le volume au lieu d’appeler Get-SzhVolumePour');
  }
  assert.strictEqual((psCreation.match(/\b(1994|2010)\b/g) || []).length, 0,
    'new-revue.ps1 recalcule le volume au lieu d’appeler Get-SzhVolumePour');
});

// ---- Le doublon, sur une vraie arborescence -----------------------------------------

const { POWERSHELL, sansPowerShell } = require('./gardes');

// Les quatre dossiers du poste, sous une racine jetable, avec les numéros demandés. Leurs
// chemins viennent de $SzhSousDossiers (windows/szh-produits.ps1) : un numéro en cours
// directement sous son dossier produit, les archives sous un « _Archive » commun. Le livre
// n'a pas de volume.
const SOUS = {};
{
  const source = fs.readFileSync(PRODUITS, 'utf8');
  const re = /^\s*(revue|zeitschrift)\s*=\s*@\{\s*encours\s*=\s*'([^']+)';\s*archive\s*=\s*'([^']+)'\s*\}/gm;
  let m;
  while ((m = re.exec(source)) !== null) { SOUS[m[1]] = { encours: m[2], archive: m[3] }; }
  assert.deepStrictEqual(Object.keys(SOUS).sort(), ['revue', 'zeitschrift'],
    '$SzhSousDossiers ne se lit plus dans szh-produits.ps1');
}

function poserArbre(numeros) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-volume-'));
  for (const produit of Object.keys(SOUS)) {
    for (const etat of Object.keys(SOUS[produit])) {
      fs.mkdirSync(path.join(base, SOUS[produit][etat]), { recursive: true });
    }
  }
  for (const n of numeros) {
    const dossier = path.join(base, SOUS[n.produit][n.etat], n.nom);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, 'ausgabe.yaml'), [
      'revue: ' + n.produit,
      'title: "' + n.nom + '"',
      'volume: "' + n.volume + '"',
      'numero: "' + n.numero + '"',
      'date: ""', ''
    ].join('\n'));
  }
  return base;
}

// Un numéro d'exemple par cas de figure. Les noms de dossier varient exprès : seul le couple
// volume + numéro identifie.
const NUMEROS = [
  { produit: 'revue', etat: 'encours', nom: '2026-02', volume: 16, numero: '02' },
  { produit: 'revue', etat: 'encours', nom: 'numero-de-printemps', volume: 16, numero: '4' },
  { produit: 'revue', etat: 'archive', nom: '2025-04', volume: 15, numero: '04' },
  { produit: 'zeitschrift', etat: 'encours', nom: '2026-05', volume: 32, numero: '05' },
  { produit: 'zeitschrift', etat: 'archive', nom: '2025-09', volume: 31, numero: '09' },
  // Un numéro sans volume : il ne doit ressembler à aucun.
  { produit: 'revue', etat: 'encours', nom: 'brouillon', volume: '', numero: '' }
];

const CAS = [
  { produit: 'revue', volume: 16, numero: 2, attendu: '2026-02', archive: false,
    quoi: 'le numéro en cours, même nom' },
  { produit: 'revue', volume: 16, numero: 4, attendu: 'numero-de-printemps', archive: false,
    quoi: 'un dossier d’un AUTRE nom portant le même couple' },
  { produit: 'revue', volume: 15, numero: 4, attendu: '2025-04', archive: true,
    quoi: 'un numéro ARCHIVÉ : il reste publié' },
  { produit: 'zeitschrift', volume: 32, numero: 5, attendu: '2026-05', archive: false,
    quoi: 'la Zeitschrift a ses propres volumes' },
  { produit: 'zeitschrift', volume: 31, numero: 9, attendu: '2025-09', archive: true,
    quoi: 'la Zeitschrift, archivée' },
  { produit: 'revue', volume: 32, numero: 5, attendu: '', archive: false,
    quoi: 'vol 32 n5 est à la Zeitschrift, pas à la Revue' },
  { produit: 'zeitschrift', volume: 16, numero: 2, attendu: '', archive: false,
    quoi: 'et réciproquement' },
  { produit: 'revue', volume: 16, numero: 3, attendu: '', archive: false,
    quoi: 'numéro libre dans un volume pris' },
  { produit: 'revue', volume: 18, numero: 2, attendu: '', archive: false,
    quoi: 'volume libre' },
  { produit: 'revue', volume: 0, numero: 2, attendu: '', archive: false,
    quoi: 'un volume nul n’est le doublon de personne' },
  { produit: 'revue', volume: 16, numero: 0, attendu: '', archive: false,
    quoi: 'un numéro nul non plus' }
];

test('doublon : le couple volume + numéro est cherché en cours ET dans les archives',
  { skip: POWERSHELL ? false : 'powershell.exe indisponible' }, () => {
    const base = poserArbre(NUMEROS);
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-pilote-'));
    const casJson = path.join(travail, 'cas.json');
    const pilote = path.join(travail, 'chercher.ps1');
    fs.writeFileSync(casJson, JSON.stringify(CAS), 'utf8');
    // Get-SzhBaseRevuesPour, seule fonction qui connaît la racine, est remplacée : config.json
    // n'est pas lu.
    fs.writeFileSync(pilote, [
      '$ErrorActionPreference = \'Stop\'',
      '. "' + COMMUN + '"',
      'function Get-SzhBaseRevuesPour([string]$Emplacement) { return $args0Base }',
      'function Write-SzhLog([string]$Message) { }',
      '$args0Base = $args[1]',
      '$cas = Get-Content $args[0] -Raw -Encoding UTF8 | ConvertFrom-Json',
      'foreach ($c in $cas) {',
      '  $t = Find-SzhNumeroVolume $c.produit ([int]$c.volume) ([int]$c.numero)',
      '  if ($t) { Write-Output ($t.nom + \'|\' + $t.archive + \'|\' + $t.chemin) }',
      '  else { Write-Output \'|False|\' }',
      '}'
    ].join('\r\n') + '\r\n', 'utf8');
    const sortie = spawnSync(POWERSHELL,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, casJson, base],
      { encoding: 'utf8' });
    assert.strictEqual(sortie.status, 0, 'le pilote PowerShell a échoué : ' + (sortie.stderr || ''));
    const rendus = String(sortie.stdout).split(/\r?\n/).filter((l) => l.trim() !== '');
    assert.strictEqual(rendus.length, CAS.length, 'PowerShell n’a pas répondu à tous les cas');
    // `base` vient de Node et peut être en forme courte 8.3 sur un runner de CI
    // (C:\Users\RUNNER~1\...) ; `chemin` vient de PowerShell, en forme longue.
    // fs.realpathSync.native ramène les deux à la même forme.
    const baseLongue = fs.realpathSync.native(base);
    for (let i = 0; i < CAS.length; i++) {
      const [nom, archive, chemin] = rendus[i].split('|');
      assert.strictEqual(nom, CAS[i].attendu, 'cas : ' + CAS[i].quoi);
      if (CAS[i].attendu) {
        assert.strictEqual(archive, CAS[i].archive ? 'True' : 'False',
          'l’état d’archive est mal rapporté, cas : ' + CAS[i].quoi);
        const cheminLong = fs.realpathSync.native(chemin);
        // Le chemin complet permet au message de nommer le dossier et son état.
        assert.ok(cheminLong.indexOf(nom) !== -1 && cheminLong.indexOf(baseLongue) === 0,
          'le chemin rendu ne mène pas au numéro trouvé : ' + chemin);
        // Les deux racines finissent par le même nom de produit (« Revue » / « _Archive\Revue ») :
        // seul le segment `_Archive` distingue une archive.
        assert.strictEqual(/[\\/]_Archive[\\/]/.test(cheminLong), CAS[i].archive,
          'le chemin ne dit pas si le numéro est archivé : ' + chemin);
      }
    }
    fs.rmSync(travail, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  });

test('nom de dossier et lecture des nombres : la convention AAAA-NN, et « 01 » = « 1 »',
  { skip: POWERSHELL ? false : 'powershell.exe indisponible' }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nom-'));
    const pilote = path.join(travail, 'nommer.ps1');
    fs.writeFileSync(pilote, [
      '$ErrorActionPreference = \'Stop\'',
      '. "' + COMMUN + '"',
      'foreach ($p in @(2026, 2), @(2026, 12), @(2027, 5), @(2031, 99)) {',
      '  Write-Output (Get-SzhNomNumero $p[0] $p[1])',
      '}',
      'foreach ($v in \'01\', \'1\', \'007\', \'\', \'abc\', \'1-2\') {',
      '  Write-Output ([string](Get-SzhEntierYaml $v))',
      '}',
      'foreach ($a in 2018, 2026, 2027, 2005) {',
      '  Write-Output ([string](Get-SzhVolumePour \'revue\' $a) + \',\' + [string](Get-SzhVolumePour \'zeitschrift\' $a))',
      '}',
      'Write-Output ([string](Get-SzhPremiereAnnee \'revue\') + \',\' + [string](Get-SzhPremiereAnnee \'zeitschrift\'))',
      'Write-Output ([string](Get-SzhVolumePour \'canard\' 2026))'
    ].join('\r\n') + '\r\n', 'utf8');
    const s = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
      { encoding: 'utf8' });
    assert.strictEqual(s.status, 0, 'le pilote a échoué : ' + (s.stderr || ''));
    const l = String(s.stdout).split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== '');
    // Le numéro sur deux chiffres, l'année sur quatre : c'est ce nom que lisent
    // szh-maquette.lua (l'année, quand `date:` est vide) et lib/yaml.js (le titre de la barre).
    assert.deepStrictEqual(l.slice(0, 4), ['2026-02', '2026-12', '2027-05', '2031-99']);
    // « 01 » et « 1 » sont le même numéro ; ce qui n'est pas un nombre ne ressemble à rien.
    assert.deepStrictEqual(l.slice(4, 10), ['1', '1', '7', '0', '0', '0']);
    // Le relevé, cette fois par la fonction elle-même.
    assert.deepStrictEqual(l.slice(10, 14), ['8,24', '16,32', '17,33', '0,11']);
    // Première année de chaque revue, pour ne pas proposer de volume nul.
    assert.strictEqual(l[14], '2011,1995');
    // Un produit inconnu ne donne pas un volume au hasard.
    assert.strictEqual(l[15], '0');
    fs.rmSync(travail, { recursive: true, force: true });
  });

// ---- Ce qui part dans ausgabe.yaml -------------------------------------------------

test('création : le volume est écrit, et le « 44 » du gabarit ne survit jamais', () => {
  // L'Accueil passe les trois valeurs qu'il a fait saisir.
  for (const p of [" -Annee '", " -Numero '", ' -Volume $volume']) {
    assert.ok(jsNouveau.indexOf(p) !== -1, 'l’identité du numéro ne circule plus : ' + p);
  }
  assert.match(psCreation, /\[int\]\$Annee = 0/);
  assert.match(psCreation, /\[int\]\$Numero = 0/);
  assert.match(psCreation, /\[int\]\$Volume = 0/);
  // Le volume est posé dans les deux cas : calculé s'il est connu, vidé sinon, pour que le
  // « volume: "44" » du gabarit ne reste pas sur un numéro neuf.
  assert.match(psCreation, /Set-SzhAusgabeCle \$chemin 'volume' \(\[string\]\$vol\) \$true \$false/,
    'le volume calculé n’est plus écrit');
  assert.match(psCreation, /Set-SzhAusgabeCle \$chemin 'volume' '' \$true \$true/,
    'un volume inconnu doit vider la clé, pas laisser celle du gabarit');
  // Le repli est un calcul, pas une valeur en dur.
  assert.match(psCreation, /\$vol = Get-SzhVolumePour \$jetonVolume \$annee/);
  // La date reste vide (voir test/js/date-numero.js) ; le même bloc l'écrit.
  const poses = [...psCreation.matchAll(/Set-SzhAusgabeCle\s+\$chemin\s+'date'\s+(\S+)/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(poses, ["''"], 'une date est revenue à la création du numéro');
});

test('gabarit : le fichier livré documente le volume', () => {
  const brut = fs.readFileSync(path.join(RACINE, 'revue-template', 'ausgabe.yaml'), 'utf8');
  assert.match(brut, /^volume:/m, 'la clé `volume:` a disparu du gabarit');
  // Le commentaire dit d'où vient le volume : sans lui, la valeur d'exemple se lirait comme
  // une valeur à garder.
  assert.match(brut, /#\s+volume\s+:/, 'le gabarit ne documente pas `volume`');
  assert.match(brut, /ann\u00e9e - 1994/, 'le gabarit ne dit pas comment le volume se calcule');
  assert.match(brut, /ann\u00e9e - 2010/);
});

// ---- La forme des fichiers ----------------------------------------------------------

// La forme (BOM, CRLF) se vérifie partout ; seule l'analyse syntaxique demande
// powershell.exe et se saute sans lui.
test('forme : les trois scripts gardent leur BOM et leurs CRLF', () => {
  for (const fichier of [COMMUN, PRODUITS, CREATION]) {
    const octets = fs.readFileSync(fichier);
    assert.deepStrictEqual([...octets.slice(0, 3)], [0xEF, 0xBB, 0xBF],
      path.basename(fichier) + ' a perdu son BOM UTF-8');
    const texte = octets.toString('utf8');
    const lf = (texte.match(/\n/g) || []).length;
    const crlf = (texte.match(/\r\n/g) || []).length;
    assert.strictEqual(lf, crlf,
      path.basename(fichier) + ' porte des fins de ligne LF : .gitattributes exige CRLF');
  }
});

test('forme : les trois scripts s’analysent encore avec le parseur PowerShell',
  { skip: sansPowerShell }, () => {
    for (const fichier of [COMMUN, PRODUITS, CREATION]) {
      const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
        '$e=$null; $t=$null; ' +
        '[void][System.Management.Automation.Language.Parser]::ParseFile(' +
        "'" + fichier.replace(/'/g, "''") + "', [ref]$t, [ref]$e); " +
        'if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { exit 0 }'],
      { encoding: 'utf8', windowsHide: true, timeout: 120000 });
      assert.strictEqual(r.status, 0,
        path.basename(fichier) + ' ne s’analyse plus : ' + r.stdout + r.stderr);
    }
  });
