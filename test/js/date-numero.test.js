// La date d'un numéro : une clé, un sens. `date:` d'ausgabe.yaml est la date de
// PUBLICATION, complète (AAAA-MM-JJ) ou vide, jamais tronquée à l'année.
//
//   node --test "test/js/*.test.js"
//
// Pourquoi ce fichier. La clé servait à deux besoins incompatibles : la couverture voulait
// l'année, connue dès la création du dossier, et l'export OJS voulait le jour, qui ne l'est
// pas. Le lanceur écrivait donc l'année seule — un champ qui paraît rempli alors qu'il ne
// l'est pas, le pire des trois états : l'export la refusait, et le rédacteur ne voyait pas
// pourquoi puisque la couverture affichait bien quelque chose.
//
// La règle posée : `date:` ne porte que la vraie date de publication. La couverture n'en
// dépend plus — szh-maquette.lua reprend l'année du nom du dossier du numéro (« 2027-03 »)
// quand la clé est vide, et une date complète saisie passe devant.
//
// Trois côtés à tenir ensemble, donc trois familles de contrôle : le lanceur qui crée le
// numéro (source PowerShell), le gabarit livré aux rédactions, et le filtre Lua qui compose
// la couverture — celui-là exécuté pour de vrai, pandoc étant le seul juge de ce qu'il fait.
//
// Le Lua tourne dans la WSL : pandoc n'existe pas côté Windows. S'il est introuvable, les
// contrôles qui en dépendent sont sautés en le disant — jamais verts par défaut. Poser
// SZH_LUA_OBLIGATOIRE=1 en fait des échecs, ce qu'une CI doit faire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
const { cheminVersWsl } = require(path.join(COCKPIT, 'lib', 'portraits.js'));

const LANCEUR = path.join(RACINE, 'windows', 'new-revue.ps1');
const GABARIT = path.join(RACINE, 'revue-template', 'ausgabe.yaml');
const MAQUETTE = path.join(RACINE, 'pipeline', 'filters', 'szh-maquette.lua');
const TRAVAIL = path.join(os.tmpdir(), 'szh-date-numero');

// ---- le lanceur ----------------------------------------------------------------------

test('date : le lanceur ne fabrique pas de date à partir du nom du dossier', () => {
  const src = fs.readFileSync(LANCEUR, 'utf8');
  // Le bloc d'identité, celui qui lit « 2027-03 ». Tout ce qui suit s'y juge.
  const i = src.indexOf("$leaf -match '^(\\d{4})-(\\d{1,3})$'");
  assert.notStrictEqual(i, -1, 'le lanceur ne déduit plus l’identité du nom du dossier');
  const bloc = src.slice(i, src.indexOf("'title'", i));
  // Le numéro vient bien du dossier : c'est la moitié qui doit rester.
  assert.match(bloc, /'numero'\s+\$rang/, 'le numéro ne vient plus du nom du dossier');
  // La date, elle, ne s'invente pas. Aucun appel qui pose 'date' avec une valeur.
  const posesDeDate = [...src.matchAll(/Set-SzhAusgabeCle\s+\$chemin\s+'date'\s+(\S+)/g)]
    .map((m) => m[1]);
  assert.deepStrictEqual(posesDeDate, ["''"],
    'le lanceur écrit une valeur dans `date:` : une année tronquée ne doit plus revenir');
  assert.ok(!/'date'\s+\$Matches|'date'\s+\$annee/.test(src),
    'l’année du dossier repart dans `date:`');
  // Et il dit où saisir la vraie : sans ce mot, le rédacteur découvre le manque à l'export.
  assert.match(src, /Métadonnées du numéro/,
    'le lanceur ne dit pas où saisir la date de publication');
});

test('date : le fichier du lanceur reste analysable, avec BOM et CRLF', () => {
  const octets = fs.readFileSync(LANCEUR);
  assert.deepStrictEqual([...octets.slice(0, 3)], [0xEF, 0xBB, 0xBF],
    'new-revue.ps1 a perdu son BOM UTF-8');
  const texte = octets.toString('utf8');
  const lf = (texte.match(/\n/g) || []).length;
  const crlf = (texte.match(/\r\n/g) || []).length;
  assert.strictEqual(lf, crlf, 'new-revue.ps1 porte des fins de ligne LF : .gitattributes exige CRLF');
  // L'analyse PowerShell n'est possible que sous Windows ; ailleurs, la forme suffit.
  if (process.platform !== 'win32') { return; }
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
  // La clé existe — le formulaire du numéro doit la montrer, et son absence se lirait
  // comme un oubli plutôt que comme un champ à remplir.
  assert.match(brut, /^date:/m, 'la clé `date:` a disparu du gabarit');
  // Mais elle est vide. Une date d'exemple crédible (« 2026-06-15 ») partirait telle quelle
  // dans un numéro de 2027 sans que personne ne la relise : une date fausse et crédible est
  // pire qu'une date absente, parce qu'elle désarme le refus de l'export.
  assert.strictEqual(String(valeurs.date || ''), '',
    'le gabarit livre une date de publication : elle voyagera dans un numéro qui n’est pas le sien');
  // Et pas non plus une année seule, qui ferait paraître le champ rempli.
  assert.ok(!/^date:\s*"?\d{4}"?\s*$/m.test(brut), 'année seule revenue dans le gabarit');
});

// ---- le titre de la barre ------------------------------------------------------------

test('barre : le titre d’un numéro sans date de publication garde son année', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-titre-'));
  const poser = (dossier, date) => {
    const racine = path.join(base, dossier);
    fs.mkdirSync(racine, { recursive: true });
    fs.writeFileSync(path.join(racine, 'ausgabe.yaml'),
      ['revue: revue', 'title: "Autodétermination"', 'numero: "03"',
        'date: "' + date + '"', 'lang: fr', ''].join('\n'));
    return racine;
  };
  // Sans date : l'année vient du dossier. Sans ce repli la barre annonçait « R-03 », ce
  // qu'aucun rédacteur ne reconnaît comme son numéro.
  assert.strictEqual(yaml.titreNumero(poser('2027-03', '')), 'R2027-03 | Autodétermination');
  // Avec une date : c'est elle qui fait foi, comme sur la couverture.
  assert.strictEqual(yaml.titreNumero(poser('2027-04', '2028-01-20')), 'R2028-03 | Autodétermination');
  // Dossier hors convention : pas d'année inventée, et le titre reste lisible.
  assert.strictEqual(yaml.titreNumero(poser('numero-de-printemps', '')), 'R-03 | Autodétermination');
});

// ---- la couverture, composée pour de vrai --------------------------------------------

// Le filtre est appelé par pandoc avec un template d'une seule variable : ce qui sort est
// exactement la ligne que la couverture imprime. Lire la source ne dirait rien.
const TEMPLATE = '$vol-ligne$\n';

let pandocVu = null;

function pandocAbsent() {
  if (pandocVu !== null) { return pandocVu; }
  let r;
  try { r = spawnSync(cheminWsl(), ['-d', DISTRO, '--', 'sh', '-c', 'command -v pandoc'],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 }); }
  catch (e) { pandocVu = 'wsl.exe injoignable : ' + e.message; return pandocVu; }
  if (r.error) { pandocVu = 'wsl.exe injoignable : ' + r.error.message; }
  else if (r.status !== 0) { pandocVu = 'pandoc introuvable dans la distro ' + DISTRO; }
  else { pandocVu = null; }
  return pandocVu;
}

function sauterSansLua(t, raison) {
  const msg = 'Lua non vérifié : ' + raison;
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail(msg); }
  console.warn('\n*** ' + msg + ' — la ligne « n°/année » de la couverture n’est PAS composée ***\n');
  t.skip(msg);
}

// Compose la ligne de couverture d'un numéro posé dans un dossier nommé `dossier`, avec la
// valeur `date` dans son ausgabe.yaml. Rend la chaîne imprimée, telle quelle.
function ligneCouverture(dossier, date) {
  const numero = path.join(TRAVAIL, dossier);
  const article = path.join(numero, 'articles', '01-essai');
  fs.rmSync(numero, { recursive: true, force: true });
  fs.mkdirSync(article, { recursive: true });
  fs.writeFileSync(path.join(numero, 'ausgabe.yaml'),
    ['revue: revue', 'title: "Un dossier"', 'volume: "44"', 'numero: "03"',
      'date: "' + date + '"', 'lang: fr', ''].join('\n'), 'utf8');
  fs.writeFileSync(path.join(article, '01-essai.meta.yaml'),
    ['type: article', 'lang: fr', 'title:', '  fr: "Un titre"', ''].join('\n'), 'utf8');
  fs.writeFileSync(path.join(article, '01-essai.md'), 'Un paragraphe.\n', 'utf8');
  const modele = path.join(TRAVAIL, 'vol-ligne.txt');
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

test('couverture : sans date de publication, l’année vient du nom du dossier', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const ligne = ligneCouverture('2027-03', '');
  t.diagnostic('dossier « 2027-03 », date vide -> « ' + ligne + ' »');
  assert.strictEqual(ligne, 'Vol. 44 · 03/2027',
    'la couverture d’un numéro sans date de publication a perdu son année');
});

test('couverture : une date de publication complète passe devant le dossier', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  // Dossier et date en désaccord : le seul cas où l'on voit laquelle des deux fait loi.
  const ligne = ligneCouverture('2027-03', '2028-01-20');
  t.diagnostic('dossier « 2027-03 », date « 2028-01-20 » -> « ' + ligne + ' »');
  assert.strictEqual(ligne, 'Vol. 44 · 03/2028',
    'la date saisie ne fait plus foi sur la couverture');
});

test('couverture : un dossier hors convention laisse l’année absente, pas fausse', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  // « Numero de printemps » ne porte pas d'année : mieux vaut une ligne sans année qu'une
  // année prise ailleurs. Le lanceur laisse aussi le numéro à remplir dans ce cas.
  const ligne = ligneCouverture('numero-de-printemps', '');
  t.diagnostic('dossier « numero-de-printemps », date vide -> « ' + ligne + ' »');
  assert.strictEqual(ligne, 'Vol. 44 · 03',
    'une année a été inventée pour un dossier qui n’en porte pas');
});

// ---- l'export OJS --------------------------------------------------------------------

test('date : l’export refuse le numéro tant que la date n’est pas saisie', () => {
  // Le config.json du poste n'est jamais touché : SZH_CONFIG_OJS détourne la lecture.
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

  // Année seule : refusée aussi. C'est ce que le lanceur écrivait, et c'est le cas qui
  // trompait — le champ paraissait rempli.
  monter('2027');
  assert.throws(() => ojs.genererExportOjs(racine, options), /2027/);
  assert.deepStrictEqual(xmlPresents(), []);

  // Date complète : accepté, et c'est elle qui part, avec l'année qu'elle porte.
  monter('2027-03-31');
  const r = ojs.genererExportOjs(racine, options);
  const xml = fs.readFileSync(r.chemin, 'utf8');
  assert.ok(xml.indexOf('<date_published>2027-03-31</date_published>') !== -1,
    'date du numéro absente de l’XML');
  assert.ok(xml.indexOf('date_published="2027-03-31"') !== -1,
    'date absente des publications');
  assert.ok(xml.indexOf('<year>2027</year>') !== -1, 'année du numéro absente');
});
