// Créer un numéro par son année et son numéro, et non par un nom de dossier.
//
//   node --test "test/js/*.test.js"
//
// Ce que ce fichier garde :
//   * la FORMULE DU VOLUME. Le volume s'imprime sur la couverture (szh-maquette.lua) et
//     part dans OJS en <volume>. Se tromper d'un cran étiquetterait faux tous les numéros
//     à venir sans qu'aucun message le dise — c'est le genre d'erreur qu'on ne découvre
//     qu'imprimée. Les deux tables ci-dessous sont un relevé de l'archive publique, pas une
//     déduction ; la formule est jugée contre elles.
//   * le REFUS DU DOUBLON. Un numéro s'identifie par son couple volume + numéro, jamais par
//     son nom de dossier : deux dossiers de noms différents peuvent porter le même couple, et
//     c'est exactement ce qu'il faut refuser. Les archives comptent — un numéro archivé reste
//     un numéro publié.
//   * les TEXTES du formulaire et du lanceur, dans les trois langues.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN = path.join(RACINE, 'windows', 'szh-common.ps1');
const LANCEUR = path.join(RACINE, 'windows', 'open-revue.ps1');
const CREATION = path.join(RACINE, 'windows', 'new-revue.ps1');

const psCommun = fs.readFileSync(COMMUN, 'utf8');
const psLanceur = fs.readFileSync(LANCEUR, 'utf8');
const psCreation = fs.readFileSync(CREATION, 'utf8');

// ---- Le relevé, et lui seul --------------------------------------------------------
// Relevé sur https://ojs.szh.ch/index.php/revue/issue/archive et .../zeitschrift/... le
// 24.08.2026, page par page jusqu'au plus ancien numéro en ligne. Neuf millésimes de suite
// pour chacune des deux revues, sans trou. Deux points ne prouvent pas une droite ; neuf,
// oui — et si un jour le compte se décale, c'est ici que cela doit se voir d'abord.
const RELEVE = {
  // « Vol. 16 No 02 (2026) » … « Vol. 8 No 1 (2018) »
  revue: { 2018: 8, 2019: 9, 2020: 10, 2021: 11, 2022: 12, 2023: 13, 2024: 14, 2025: 15, 2026: 16 },
  // « Bd. 32 Nr. 06 (2026) » … « Bd. 24 Nr. 1 (2018) »
  zeitschrift: { 2018: 24, 2019: 25, 2020: 26, 2021: 27, 2022: 28, 2023: 29, 2024: 30, 2025: 31, 2026: 32 }
};

test('volume : les deux ancres déclarées reproduisent le relevé de ojs.szh.ch', () => {
  // L'année zéro est écrite une seule fois dans le dépôt, ici.
  const bloc = psCommun.match(/\$script:SzhVolumeAnneeZero = @\{([^}]*)\}/);
  assert.ok(bloc, 'SzhVolumeAnneeZero a disparu de szh-common.ps1');
  const ancres = {};
  for (const m of bloc[1].matchAll(/(revue|zeitschrift)\s*=\s*(\d{4})/g)) {
    ancres[m[1]] = Number(m[2]);
  }
  assert.deepStrictEqual(ancres, { revue: 2010, zeitschrift: 1994 },
    'les années zéro ont changé : le relevé ci-dessus doit être refait avant');
  // Et la soustraction rend bien, année par année, ce que l'archive publie.
  for (const produit of Object.keys(RELEVE)) {
    for (const [annee, volume] of Object.entries(RELEVE[produit])) {
      assert.strictEqual(Number(annee) - ancres[produit], volume,
        produit + ' ' + annee + ' : le relevé dit ' + volume);
    }
  }
});

// Le code seul, commentaires retirés : une année citée en commentaire documente, elle ne
// calcule pas.
function codeSeul(source) {
  return source.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
}

test('volume : la formule ne se laisse pas écrire ailleurs', () => {
  // Une deuxième copie de 1994 ou de 2010 quelque part, et les deux se décaleraient
  // séparément. Get-SzhVolumePour est le seul chemin.
  const copies = (codeSeul(psCommun).match(/\b(1994|2010)\b/g) || []).length;
  assert.strictEqual(copies, 2, 'les années zéro apparaissent ' + copies + ' fois dans szh-common.ps1');
  assert.strictEqual((psLanceur.match(/\b(1994|2010)\b/g) || []).length, 0,
    'open-revue.ps1 recalcule le volume au lieu d’appeler Get-SzhVolumePour');
  assert.strictEqual((psCreation.match(/\b(1994|2010)\b/g) || []).length, 0,
    'new-revue.ps1 recalcule le volume au lieu d’appeler Get-SzhVolumePour');
});

// ---- Ce que le formulaire demande, et ce qu'il montre -------------------------------

test('formulaire : l’année et le numéro se saisissent, le volume et le dossier se lisent', () => {
  const i = psLanceur.indexOf('function Read-SzhNouveauNumero');
  assert.notStrictEqual(i, -1, 'le formulaire d’année et de numéro a disparu du lanceur');
  const corps = psLanceur.slice(i, psLanceur.indexOf('\r\n$boutonNouvelle', i));

  // Trois NumericUpDown : année, numéro, volume. Pas de champ de texte libre — c'est
  // précisément ce dont on sort.
  assert.strictEqual((corps.match(/System\.Windows\.Forms\.NumericUpDown/g) || []).length, 3,
    'il faut trois compteurs : année, numéro, volume');
  assert.strictEqual((corps.match(/System\.Windows\.Forms\.TextBox/g) || []).length, 0,
    'un champ de texte libre est revenu dans le formulaire');

  // Le volume s'affiche grisé : un NumericUpDown désactivé, flèches comprises.
  assert.match(corps, /\$champVolume\.Enabled = \$false/,
    'le volume n’est plus grisé à l’ouverture');
  // Et il suit l'année, tant que le réglage manuel n'a pas été demandé.
  assert.match(corps, /if \(-not \$etat\.manuel\) \{[\s\S]{0,200}Get-SzhVolumePour/,
    'le volume ne se calcule plus d’après l’année');

  // Le nom du dossier est un LIBELLÉ : montré, impossible à changer.
  assert.match(corps, /\$etiqDossier = New-Object System\.Windows\.Forms\.Label/,
    'le nom du dossier doit être un libellé, pas un champ');
  assert.match(corps, /\$etiqDossier\.Text = \(T 'lanceur\.nouvelle\.dossier'/);
  assert.match(corps, /Get-SzhNomNumero \$anneeVue \$numeroVue/,
    'le nom du dossier ne se déduit plus de l’année et du numéro');

  // La borne basse de l'année est celle du premier volume : jamais de volume nul.
  assert.match(corps, /\$anneeMin = Get-SzhPremiereAnnee \$produitFiltre/);
  assert.match(corps, /\$champAnnee\.Minimum = \$anneeMin/);
  // Deux chiffres pour le numéro, comme la convention de nom de dossier.
  assert.match(corps, /\$champNumero\.Maximum = 99/);

  // Le bouton de réglage manuel existe, et il rend la main.
  assert.match(corps, /\$boutonManuel\.Text = \(T 'lanceur\.nouvelle\.volume\.manuel'\)/);
  assert.match(corps, /\$etat\.manuel = \$true[\s\S]{0,120}\$champVolume\.Enabled = \$true/,
    'le bouton manuel ne déverrouille plus le volume');
  assert.match(corps, /\$etat\.manuel = \$false[\s\S]{0,120}\$champVolume\.Enabled = \$false/,
    'on ne peut plus revenir au volume calculé');
});

test('formulaire : les deux refus se font la boîte ouverte, et ne suppriment rien', () => {
  const i = psLanceur.indexOf('$okBouton.Add_Click(');
  assert.notStrictEqual(i, -1, 'le bouton OK ne vérifie plus rien');
  const corps = psLanceur.slice(i, psLanceur.indexOf('& $rafraichir', i));
  // Le dossier homonyme, puis le couple volume + numéro.
  assert.match(corps, /lanceur\.nouvelle\.existe/, 'le dossier homonyme n’est plus refusé');
  assert.match(corps, /Find-SzhNumeroVolume \$produitFiltre \$volumeOk \$numeroOk/,
    'le doublon de volume + numéro n’est plus cherché');
  assert.match(corps, /lanceur\.nouvelle\.doublon/);
  // Le refus garde la boîte ouverte : le remède est à un chiffre près.
  assert.strictEqual((corps.match(/DialogResult\]::None/g) || []).length, 2,
    'un refus referme le formulaire et fait tout resaisir');
  // Et rien n'est détruit à la place du rédacteur : aucun geste destructeur ici.
  assert.ok(!/Remove-Item|Move-Item|\[System\.IO\.Directory\]::Delete/.test(corps),
    'le refus supprime ou déplace quelque chose : il doit seulement refuser');
});

// ---- Le doublon, sur une vraie arborescence -----------------------------------------

const POWERSHELL = (function () {
  if (process.platform !== 'win32') { return ''; }
  const candidats = [path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe'];
  for (const c of candidats) {
    const essai = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) { return c; }
  }
  return '';
})();

// Les quatre dossiers du poste, sous une racine jetable, avec les numéros demandés.
// `Get-SzhBaseRevuesPour` est remplacée dans le pilote : rien n'est lu de config.json et
// aucune racine réelle n'est touchée.
const SOUS = {
  revue: { encours: '52_Revue\\RV02_Redaction', archive: '52_Revue\\RV99_Archives' },
  zeitschrift: { encours: '53_Zeitschrift\\ZS02_Redaktion', archive: '53_Zeitschrift\\ZS99_Archives' }
};

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

// Un numéro d'exemple par cas de figure. Les noms de dossier sont volontairement variés :
// c'est le couple volume + numéro qui identifie, et rien d'autre.
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
    // La racine est impos\u00e9e au socle en rempla\u00e7ant la seule fonction qui la connaît :
    // config.json n'est pas lu, et aucune racine réelle n'entre dans le test.
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
    for (let i = 0; i < CAS.length; i++) {
      const [nom, archive, chemin] = rendus[i].split('|');
      assert.strictEqual(nom, CAS[i].attendu, 'cas : ' + CAS[i].quoi);
      if (CAS[i].attendu) {
        assert.strictEqual(archive, CAS[i].archive ? 'True' : 'False',
          'l’état d’archive est mal rapporté, cas : ' + CAS[i].quoi);
        // Le message doit pouvoir dire OÙ : le chemin complet nomme le dossier ET son état.
        assert.ok(chemin.indexOf(nom) !== -1 && chemin.indexOf(base) === 0,
          'le chemin rendu ne mène pas au numéro trouvé : ' + chemin);
        assert.strictEqual(/RV99_Archives|ZS99_Archives/.test(chemin), CAS[i].archive,
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
    // Première année de chaque revue : jamais un volume nul proposé.
    assert.strictEqual(l[14], '2011,1995');
    // Un produit inconnu ne donne pas un volume au hasard.
    assert.strictEqual(l[15], '0');
    fs.rmSync(travail, { recursive: true, force: true });
  });

// ---- Ce qui part dans ausgabe.yaml -------------------------------------------------

test('création : le volume est écrit, et le « 44 » du gabarit ne survit jamais', () => {
  // Le lanceur passe les trois valeurs qu'il a fait saisir.
  for (const p of ['-Annee', '-Numero', '-Volume', 'Annee   = $neuf.annee',
    'Numero  = $neuf.numero', 'Volume  = $neuf.volume']) {
    assert.ok(psLanceur.indexOf(p) !== -1 || psCreation.indexOf(p) !== -1,
      'l’identité du numéro ne circule plus : ' + p);
  }
  assert.match(psCreation, /\[int\]\$Annee = 0/);
  assert.match(psCreation, /\[int\]\$Numero = 0/);
  assert.match(psCreation, /\[int\]\$Volume = 0/);
  // Le volume est posé dans les deux cas : calculé s'il est connu, vidé sinon. Sans le
  // second, le « volume: "44" » du gabarit resterait sur un numéro neuf.
  assert.match(psCreation, /Set-SzhAusgabeCle \$chemin 'volume' \(\[string\]\$vol\) \$true \$false/,
    'le volume calculé n’est plus écrit');
  assert.match(psCreation, /Set-SzhAusgabeCle \$chemin 'volume' '' \$true \$true/,
    'un volume inconnu doit vider la clé, pas laisser celle du gabarit');
  // Et le repli est bien un calcul, non une valeur en dur.
  assert.match(psCreation, /\$vol = Get-SzhVolumePour \$jetonVolume \$annee/);
  // La date, elle, reste vide : c'est la règle de test/js/date-numero.js, rappelée ici
  // parce que le même bloc l'écrit.
  const poses = [...psCreation.matchAll(/Set-SzhAusgabeCle\s+\$chemin\s+'date'\s+(\S+)/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(poses, ["''"], 'une date est revenue à la création du numéro');
});

test('gabarit : le fichier livré documente le volume', () => {
  const brut = fs.readFileSync(path.join(RACINE, 'revue-template', 'ausgabe.yaml'), 'utf8');
  assert.match(brut, /^volume:/m, 'la clé `volume:` a disparu du gabarit');
  // Le commentaire dit d'où vient le volume : sans lui, la valeur d'exemple se lit comme
  // une valeur à garder, et c'est ainsi que « 44 » a voyagé.
  assert.match(brut, /#\s+volume\s+:/, 'le gabarit ne documente pas `volume`');
  assert.match(brut, /ann\u00e9e - 1994/, 'le gabarit ne dit pas comment le volume se calcule');
  assert.match(brut, /ann\u00e9e - 2010/);
});

// ---- Les textes, dans les trois langues --------------------------------------------

// Les tables de szh-common.ps1, une par langue, dans l'ordre fr, de, en.
function textes(cle) {
  const motif = new RegExp("'" + cle.replace(/\./g, '\\.') + "'\\s*=\\s*(\"[^\"]*\"|'(?:[^']|'')*')", 'g');
  return (psCommun.match(motif) || []).map((m) => m.slice(m.indexOf('=') + 1).trim());
}

test('textes : chaque clé du formulaire existe dans les trois langues', () => {
  for (const cle of ['lanceur.nouvelle.annee', 'lanceur.nouvelle.numero', 'lanceur.nouvelle.volume',
    'lanceur.nouvelle.volume.manuel', 'lanceur.nouvelle.volume.auto', 'lanceur.nouvelle.dossier',
    'lanceur.nouvelle.doublon', 'lanceur.nouvelle.doublon.arch', 'lanceur.nouvelle.doublon.suite',
    'lanceur.version', 'lanceur.version.inconnue', 'lanceur.test', 'lanceur.test.zs']) {
    assert.strictEqual(textes(cle).length, 3, 'il manque une traduction de ' + cle);
  }
  // Les deux clés de l'ancien formulaire n'ont plus de sens : on ne demande plus de nom.
  for (const morte of ['lanceur.nouvelle.nom', 'lanceur.nouvelle.invalide']) {
    assert.strictEqual(textes(morte).length, 0, morte + ' est restée alors que rien ne l’affiche');
  }
});

test('textes : le réglage manuel est dit déconseillé dans les trois langues', () => {
  const dits = textes('lanceur.nouvelle.volume.manuel');
  const attendus = ['(déconseillé)', '(nicht empfohlen)', '(not recommended)'];
  for (let i = 0; i < 3; i++) {
    assert.ok(dits[i].indexOf(attendus[i]) !== -1,
      'le libellé ne porte pas ' + attendus[i] + ' : ' + dits[i]);
  }
});

test('textes : le doublon dit quel numéro et où il est', () => {
  for (const dit of textes('lanceur.nouvelle.doublon')) {
    // Volume, numéro, nom du numéro, puis son chemin sur sa propre ligne.
    for (const jeton of ['{0}', '{1}', '{2}', '{3}']) {
      assert.ok(dit.indexOf(jeton) !== -1, 'le message perd une information (' + jeton + ') : ' + dit);
    }
    assert.ok(dit.indexOf('`n{3}') !== -1, 'le chemin doit être sur sa propre ligne : ' + dit);
  }
  // Et il demande de supprimer d'abord, sans le faire à la place du rédacteur.
  const suites = textes('lanceur.nouvelle.doublon.suite');
  const verbes = [/Supprimez/, /L\u00f6schen/, /Delete/];
  for (let i = 0; i < 3; i++) {
    assert.match(suites[i], verbes[i], 'le message ne dit pas de supprimer l’ancien : ' + suites[i]);
  }
});

test('textes : la version se dit « Version », plus « Logiciel v. »', () => {
  for (const dit of textes('lanceur.version')) {
    assert.match(dit, /^'Version\s?:\s\{0\}'$/, 'libellé de version inattendu : ' + dit);
  }
  for (const dit of textes('lanceur.version.inconnue')) {
    assert.ok(dit.indexOf('Version') === 1, 'libellé inattendu : ' + dit);
    assert.ok(!/Logiciel|Software/.test(dit), 'le mot « logiciel » est resté : ' + dit);
  }
  assert.ok(!/'Logiciel v\.|'Software v\./.test(psCommun), 'un « v. » a survécu');
});

test('textes : la racine active se dit par le nom du produit, dans les deux racines', () => {
  // « Revue dans : … » / « Zeitschrift dans : … » — plus « Dossier de test », qui ne se
  // disait qu'en test et taisait la racine de production.
  const revue = textes('lanceur.test');
  const zs = textes('lanceur.test.zs');
  for (const dit of revue) {
    assert.ok(dit.indexOf('Revue') !== -1, 'le produit n’est plus nommé : ' + dit);
    assert.ok(dit.indexOf('{0}') !== -1, 'le chemin de la racine a disparu : ' + dit);
    assert.ok(!/test|Test/.test(dit), '« test » est resté dans le libellé : ' + dit);
  }
  for (const dit of zs) {
    assert.ok(dit.indexOf('Zeitschrift') !== -1, 'le produit n’est plus nommé : ' + dit);
    assert.ok(dit.indexOf('{0}') !== -1, 'le chemin de la racine a disparu : ' + dit);
  }
});

test('textes : orthographe suisse, jamais de ß', () => {
  for (const cle of ['lanceur.nouvelle.volume.manuel', 'lanceur.nouvelle.volume.auto',
    'lanceur.nouvelle.doublon', 'lanceur.nouvelle.doublon.arch', 'lanceur.nouvelle.doublon.suite',
    'lanceur.test', 'lanceur.test.zs', 'lanceur.version']) {
    for (const dit of textes(cle)) {
      assert.strictEqual(dit.indexOf('\u00df'), -1, 'ß dans ' + cle + ' : ' + dit);
    }
  }
});

// ---- Ce que le lanceur montre sous ses listes ---------------------------------------

test('lanceur : la racine active s’affiche dans les DEUX racines', () => {
  // C'était le correctif d'un danger réel : `emplacementRevues` déplace la racine de tout
  // le travail, et un lanceur aux listes vides ne se comprend pas sans elle. Le dire en
  // mode test seulement laissait justement le cas grave — la production — sans un mot.
  const i = psLanceur.indexOf('$lignesInfo = @()');
  assert.notStrictEqual(i, -1, 'le bloc d’informations a disparu');
  const corps = psLanceur.slice(i, psLanceur.indexOf('$form = New-Object', i));
  assert.match(corps, /\$lignesInfo \+= \(T \$cleRacine @\(\$emplacements\.base\)\)/,
    'la ligne de racine ne s’ajoute plus');
  // Sans condition : aucune garde de mode test autour de cette ligne.
  assert.ok(!/devMode/.test(corps),
    'la ligne de racine est redevenue conditionnelle au mode test');
  // Et le libellé suit le produit du lanceur ouvert.
  assert.match(corps, /\$cleRacine = 'lanceur\.test'/);
  assert.match(corps, /if \(\$produitFiltre -eq 'zeitschrift'\) \{ \$cleRacine = 'lanceur\.test\.zs' \}/);
  // La hauteur du bloc est mesurée : un chemin long revient à la ligne, et tronqué il ne
  // dirait plus rien. Mesurée par le libellé lui-même — TextRenderer ne coupe qu'aux
  // espaces, et un chemin Windows n'en a pas.
  assert.match(corps, /\$infos\.GetPreferredSize/, 'la hauteur du bloc n’est plus mesurée');
  assert.match(psLanceur, /\$yBoutons = \$yInfos \+ \$hInfos \+ 2/,
    'les boutons ne suivent plus la hauteur du bloc');
  // Le titre de la fenêtre garde le jeton {racine} : deux endroits, pas un.
  assert.match(psCommun, /'lanceur\.titre'\s*=\s*'[^']*\{racine\}/);
});

// ---- La forme des fichiers ----------------------------------------------------------

test('forme : les trois scripts gardent leur BOM, leurs CRLF, et s’analysent', () => {
  for (const fichier of [COMMUN, LANCEUR, CREATION]) {
    const octets = fs.readFileSync(fichier);
    assert.deepStrictEqual([...octets.slice(0, 3)], [0xEF, 0xBB, 0xBF],
      path.basename(fichier) + ' a perdu son BOM UTF-8');
    const texte = octets.toString('utf8');
    const lf = (texte.match(/\n/g) || []).length;
    const crlf = (texte.match(/\r\n/g) || []).length;
    assert.strictEqual(lf, crlf,
      path.basename(fichier) + ' porte des fins de ligne LF : .gitattributes exige CRLF');
  }
  if (!POWERSHELL) { return; }
  for (const fichier of [COMMUN, LANCEUR, CREATION]) {
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
