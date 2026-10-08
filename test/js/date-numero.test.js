// La date d'un numéro : `date:` d'ausgabe.yaml est la date de publication, complète
// (AAAA-MM-JJ) ou vide, jamais réduite à l'année.
//
//   node --test "test/js/*.test.js"
//
// La couverture n'en dépend pas : quand la clé est vide, szh-maquette.lua reprend l'année
// du nom du dossier (« 2027-03 ») ; une date complète passe devant. Une année seule ferait
// paraître le champ rempli, alors que l'export OJS la refuse.
//
// Trois familles de contrôle : le lanceur qui crée le numéro (source PowerShell), le gabarit
// livré aux rédactions, et le filtre Lua de la couverture, exécuté par pandoc dans la WSL.
// Sans pandoc dans la WSL, ces derniers contrôles sautent ; SZH_WSL_OBLIGATOIRE en fait des
// échecs.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

// Avant le premier require du cockpit : lib/i18n.js fixe la langue à son chargement, en
// finissant par l'état du poste (C:\ProgramData\SZH\state.json, langue du dernier lanceur
// ouvert). Ce fichier ne passe pas par hote-factice.js, qui neutralise cet état ; sans
// cela, les messages sortiraient en allemand sur un poste où la Zeitschrift a été ouverte
// en dernier.
process.env.SZH_ETAT_POSTE = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'szh-date-etat-')), 'state.json');
fs.writeFileSync(process.env.SZH_ETAT_POSTE, '{}\n');

const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
const { cheminVersWsl } = require(path.join(COCKPIT, 'lib', 'portraits.js'));

const LANCEUR = path.join(RACINE, 'windows', 'new-revue.ps1');
const GABARIT = path.join(RACINE, 'revue-template', 'ausgabe.yaml');
const MAQUETTE = path.join(RACINE, 'pipeline', 'filters', 'szh-maquette.lua');

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-date-numero-'));
}

// ---- le lanceur ----------------------------------------------------------------------

test('date : le lanceur ne fabrique pas de date à partir du nom du dossier', () => {
  const src = fs.readFileSync(LANCEUR, 'utf8');
  // Le bloc qui lit l'identité dans le nom du dossier (« 2027-03 »).
  const i = src.indexOf("$leaf -match '^(\\d{4})-(\\d{1,3})$'");
  assert.notStrictEqual(i, -1, 'le lanceur ne déduit plus l’identité du nom du dossier');
  const bloc = src.slice(i, src.indexOf("'title'", i));
  // Le numéro vient du dossier.
  assert.match(bloc, /'numero'\s+\$rang/, 'le numéro ne vient plus du nom du dossier');
  // La date, non : aucun appel ne pose 'date' avec une valeur.
  const posesDeDate = [...src.matchAll(/Set-SzhAusgabeCle\s+\$chemin\s+'date'\s+(\S+)/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(posesDeDate, ["''"],
    'le lanceur écrit une valeur dans `date:` : une année tronquée ne doit plus revenir');
  assert.ok(!/'date'\s+\$Matches|'date'\s+\$annee/.test(src),
    'l’année du dossier repart dans `date:`');
  // Le lanceur dit où saisir la date.
  assert.match(src, /Métadonnées du numéro/,
    'le lanceur ne dit pas où saisir la date de publication');
});

test('date : le fichier du lanceur reste analysable, avec BOM et CRLF', (t) => {
  const octets = fs.readFileSync(LANCEUR);
  assert.deepStrictEqual([...octets.slice(0, 3)], [0xEF, 0xBB, 0xBF],
    'new-revue.ps1 a perdu son BOM UTF-8');
  const texte = octets.toString('utf8');
  const lf = (texte.match(/\n/g) || []).length;
  const crlf = (texte.match(/\r\n/g) || []).length;
  assert.strictEqual(lf, crlf, 'new-revue.ps1 porte des fins de ligne LF : .gitattributes exige CRLF');
  // L'analyse demande powershell.exe ; sans lui (y compris sous Windows simulé), seule la
  // forme ci-dessus est vérifiée.
  if (sansPowerShell) { sauter.powershell(t); return; }
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$e=$null; $t=$null; ' +
    '[void][System.Management.Automation.Language.Parser]::ParseFile(' +
    "'" + LANCEUR.replace(/'/g, "''") + "', [ref]$t, [ref]$e); " +
    'if ($e.Count -gt 0) { $e | ForEach-Object { $_.Message }; exit 1 } else { exit 0 }'],
  { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.strictEqual(r.status, 0, 'new-revue.ps1 ne s’analyse plus : ' + r.stdout + r.stderr);
});

// ---- le gabarit ----------------------------------------------------------------------

test('date : le gabarit ne livre aucune date de publication, pas même plausible', () => {
  const brut = fs.readFileSync(GABARIT, 'utf8');
  const valeurs = yaml.analyserAusgabe(brut);
  // La clé existe, pour que le formulaire du numéro la montre.
  assert.match(brut, /^date:/m, 'la clé `date:` a disparu du gabarit');
  // Elle est vide : une date d'exemple crédible partirait telle quelle et désarmerait le
  // refus de l'export.
  assert.strictEqual(String(valeurs.date || ''), '',
    'le gabarit livre une date de publication : elle voyagera dans un numéro qui n’est pas le sien');
  // Pas d'année seule non plus.
  assert.ok(!/^date:\s*"?\d{4}"?\s*$/m.test(brut), 'année seule revenue dans le gabarit');
});

// ---- le titre de la barre ------------------------------------------------------------

test('barre : le titre d’un numéro sans date de publication garde son année', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-titre-'));
  let compteur = 0;
  // `revue` : le jeton `revue:` à écrire, ou '' pour omettre la clé. `lang` : repli de
  // langue à écrire quand aucun jeton n'est fourni.
  const poser = (dossier, date, revue, lang) => {
    const racine = path.join(base, dossier + '-' + (compteur++));
    fs.mkdirSync(racine, { recursive: true });
    const lignes = [];
    if (revue !== '') { lignes.push('revue: ' + (revue === undefined ? 'revue' : revue)); }
    lignes.push('title: "Autodétermination"', 'numero: "03"', 'date: "' + date + '"',
      'lang: ' + (lang || 'fr'), '');
    fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), lignes.join('\n'));
    return racine;
  };
  // Sans date : l'année vient du dossier.
  assert.strictEqual(yaml.titreNumero(poser('2027-03', '')), 'Revue 2027/03 | Autodétermination');
  // Avec une date : elle fait foi, comme sur la couverture.
  assert.strictEqual(yaml.titreNumero(poser('2027-04', '2028-01-20')), 'Revue 2028/03 | Autodétermination');
  // Dossier hors convention : pas d'année inventée, et le titre reste lisible.
  assert.strictEqual(yaml.titreNumero(poser('numero-de-printemps', '')), 'Revue 03 | Autodétermination');
  // `revue: zeitschrift` décide seul du nom, même avec lang: fr.
  assert.strictEqual(yaml.titreNumero(poser('2027-03', '', 'zeitschrift')),
    'Zeitschrift 2027/03 | Autodétermination');
  // Sans clé `revue:` du tout (ausgabe.yaml ancien) : repli sur la langue par défaut.
  assert.strictEqual(yaml.titreNumero(poser('2027-03', '', '', 'de')),
    'Zeitschrift 2027/03 | Autodétermination');
  assert.strictEqual(yaml.titreNumero(poser('2027-03', '', '', 'fr')),
    'Revue 2027/03 | Autodétermination');
  // Sans numéro : l'année seule, pas de barre oblique orpheline.
  const sansNumero = path.join(base, 'sans-numero-' + (compteur++));
  fs.mkdirSync(sansNumero, { recursive: true });
  fs.writeFileSync(path.join(sansNumero, 'ausgabe.yaml'),
    ['revue: revue', 'title: "Autodétermination"', 'numero: ""', 'date: "2027-05-01"',
      'lang: fr', ''].join('\n'));
  assert.strictEqual(yaml.titreNumero(sansNumero), 'Revue 2027 | Autodétermination');
});

// ---- la couverture, composée pour de vrai --------------------------------------------

// pandoc appelle le filtre avec un template d'une seule variable : la sortie est la ligne
// que la couverture imprime.
const TEMPLATE = '$vol-ligne$\n';
// La ligne est faite d'inlines (szh-maquette.lua, ABREV_NUMERO) : le « o » français est en
// exposant, et un <sup> ne passe pas par une MetaString, que pandoc échappe. On lit donc le
// balisage ; un « ° » ou un U+00BA à la place serait une erreur.
// L'insécable ne sert qu'à l'allemand et à l'italien, dont l'abréviation finit par un point
// (« Nr.02 » se lirait comme un nombre décimal). Le français n'a pas d'espace : « Nᵒ02/2027 ».
const NBSP = '\u00A0';
const NO_FR = 'N<sup>o</sup>';

function sauterSansLua(t, raison) {
  console.warn("\n*** Lua non vérifié : " + raison + " — la ligne « n°/année » de la "
    + "couverture n’est PAS composée ***\n");
  sauter.wsl(t);
}

// Compose la ligne de couverture d'un numéro posé dans un dossier nommé `dossier`, avec la
// valeur `date` dans son ausgabe.yaml. Rend la chaîne imprimée, telle quelle.
// `revue` : le jeton de revue, « revue » par défaut. Il fixe la langue de composition, donc
// l'abréviation du numéro.
function ligneCouverture(dossier, date, revue) {
  const travail = dossierJetable();
  const numero = path.join(travail, dossier);
  const article = path.join(numero, 'articles', '01-essai');
  fs.rmSync(numero, { recursive: true, force: true });
  fs.mkdirSync(article, { recursive: true });
  fs.writeFileSync(path.join(numero, 'ausgabe.yaml'),
    ['revue: ' + (revue || 'revue'), 'title: "Un dossier"', 'volume: "44"',
      'numero: "03"', 'date: "' + date + '"', ''].join('\n'), 'utf8');
  // Pas de `lang:` dans la fiche : c'est le jeton de revue qui décide de la langue.
  fs.writeFileSync(path.join(article, '01-essai.meta.yaml'),
    ['type: article', 'title:', '  fr: "Un titre"', '  de: "Ein Titel"',
      ''].join('\n'), 'utf8');
  fs.writeFileSync(path.join(article, '01-essai.md'), 'Un paragraphe.\n', 'utf8');
  const modele = path.join(travail, 'vol-ligne.txt');
  fs.writeFileSync(modele, TEMPLATE, 'utf8');

  const ausgabe = cheminVersWsl(path.join(numero, 'ausgabe.yaml'));
  // Depuis le dossier de l'article, comme le Makefile : le filtre y cherche la fiche.
  const commande = 'cd "' + cheminVersWsl(article) + '" && SZH_AUSGABE="' + ausgabe + '" '
    + 'pandoc 01-essai.md --metadata-file="' + ausgabe + '" '
    + '--metadata-file=01-essai.meta.yaml '
    + '--lua-filter="' + cheminVersWsl(MAQUETTE) + '" '
    + '--template="' + cheminVersWsl(modele) + '" --to=html';
  const r = spawnSync(cheminWsl(), ['-d', DISTRO, '--', 'sh', '-c', commande],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.ok(!r.error, 'pandoc : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
  return String(r.stdout).replace(/\r/g, '').trim();
}

test("couverture : sans date de publication, l’année vient du nom du dossier", (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  const ligne = ligneCouverture('2027-03', '');
  t.diagnostic('dossier « 2027-03 », date vide -> « ' + ligne + ' »');
  assert.strictEqual(ligne, 'Vol. 44 · ' + NO_FR + '03/2027',
    'la couverture d’un numéro sans date de publication a perdu son année');
});

test('couverture : une date de publication complète passe devant le dossier', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  // Dossier et date en désaccord, pour voir laquelle des deux l'emporte.
  const ligne = ligneCouverture('2027-03', '2028-01-20');
  t.diagnostic('dossier « 2027-03 », date « 2028-01-20 » -> « ' + ligne + ' »');
  assert.strictEqual(ligne, 'Vol. 44 · ' + NO_FR + '03/2028',
    'la date saisie ne fait plus foi sur la couverture');
});

test("couverture : un dossier hors convention laisse l’année absente, pas fausse", (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  // « numero-de-printemps » ne porte pas d'année : la ligne n'en a pas.
  const ligne = ligneCouverture('numero-de-printemps', '');
  t.diagnostic('dossier « numero-de-printemps », date vide -> « ' + ligne + ' »');
  assert.strictEqual(ligne, 'Vol. 44 · ' + NO_FR + '03',
    'une année a été inventée pour un dossier qui n’en porte pas');
});

test('couverture : en allemand, « Jg. » et « Nr. » avec son insécable, jamais le o en exposant', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  // En allemand : « Jg. » (Jahrgang), et « Nr. » suivi d'une insécable, sans <sup>.
  const ligne = ligneCouverture('2027-03', '', 'zeitschrift');
  t.diagnostic('revue: zeitschrift -> « ' + ligne + ' »');
  assert.strictEqual(ligne, 'Jg. 44 · Nr.' + NBSP + '03/2027',
    'la forme allemande du volume ou du numéro a changé');
  assert.ok(!/<sup>/.test(ligne), 'un exposant est parti dans la ligne allemande : ' + ligne);
});

test('couverture : en français, le millésime reste « Vol. »', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  // Vérifie que la condition de la forme allemande ne s'applique pas au français.
  const ligne = ligneCouverture('2027-03', '', 'revue');
  t.diagnostic('revue: revue -> « ' + ligne + ' »');
  assert.ok(ligne.startsWith('Vol. 44 · '),
    'le millésime français a changé de forme : ' + ligne);
});

// ---- l'export OJS --------------------------------------------------------------------

test('date : l’export refuse le numéro tant que la date n’est pas saisie', () => {
  // SZH_CONFIG_OJS détourne la lecture du config.json du poste.
  process.env.SZH_CONFIG_OJS = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'szh-date-cfg-')), 'config.json');
  const ojs = require(path.join(COCKPIT, 'lib', 'export-ojs.js'));
  const config = {
    revues: {
      fr: { genreFichier: "Texte de l'article", groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: '' },
      de: { genreFichier: 'Artikeltext', groupeAuteur: 'Autor/in', televerseur: 'redaktion', paysAuteur: '' }
    }
  };

  // Un numéro complet, monté sur le gabarit livré : la date est la seule variable.
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-date-ojs-'));
  const gabarit = fs.readFileSync(GABARIT, 'utf8');
  const monter = (date) => fs.writeFileSync(path.join(racine, 'ausgabe.yaml'),
    yaml.serialiserAusgabe(gabarit, { revue: 'revue', lang: 'fr', date: date }));
  fs.writeFileSync(path.join(racine, 'couverture.jpg'), Buffer.from('JPEG'));
  const slug = '01-essai';
  const dossier = path.join(racine, 'articles', slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), '# Titre\n\nUn paragraphe.\n');
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'lang: fr', 'doi: "10.57161/r2027-03-01"', 'title:', '  fr: "Un titre"',
      'resume:', '  fr: "Un résumé."', 'author:', '- nom: "SZH/CSPS"', ''].join('\n'));
  const out = path.join(racine, 'out', slug);
  fs.mkdirSync(out, { recursive: true });
  for (const ext of ['pdf', 'html', 'docx']) {
    fs.writeFileSync(path.join(out, slug + '.' + ext), Buffer.from(slug + ':' + ext));
  }
  const options = { maintenant: new Date(2027, 2, 15, 9, 30, 0), config: config };
  const xmlPresents = () => fs.readdirSync(racine).filter((f) => f.endsWith('.xml'));

  // Vide : refusé, et rien d'écrit — un export refusé ne laisse pas de fichier à moitié fait.
  monter('');
  assert.throws(() => ojs.genererExportOjs(racine, options), (e) => {
    assert.match(e.message, /AAAA-MM-JJ/);
    assert.match(e.message, /Métadonnées du numéro/);
    return true;
  }, 'un numéro sans date de publication est parti quand même');
  assert.deepStrictEqual(xmlPresents(), []);

  // Année seule : refusée aussi.
  monter('2027');
  assert.throws(() => ojs.genererExportOjs(racine, options), /2027/);
  assert.deepStrictEqual(xmlPresents(), []);

  // Date complète : acceptée, elle part avec son année.
  monter('2027-03-31');
  const r = ojs.genererExportOjs(racine, options);
  const xml = fs.readFileSync(r.chemin, 'utf8');
  assert.ok(xml.indexOf('<date_published>2027-03-31</date_published>') !== -1,
    'date du numéro absente de l’XML');
  assert.ok(xml.indexOf('date_published="2027-03-31"') !== -1,
    'date absente des publications');
  assert.ok(xml.indexOf('<year>2027</year>') !== -1, 'année du numéro absente');
});
