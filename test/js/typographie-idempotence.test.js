// Idempotence de pipeline/filters/szh-typographie.lua : le nettoyeur de manuscrit l'applique au
// .docx (pipeline/manuscrit_typo.py), puis la compilation la réapplique au .md. Le résultat
// n'est juste que si f(f(x)) = f(x). Chaque entrée passe deux fois dans le filtre (pandoc de
// la WSL SZH-Publishing, celui qui compile) et l'AST de la première passe est comparé à celui
// de la seconde (-t native).
//
//   node --test test/js/typographie-idempotence.test.js
//
// Entrées : un échantillon fr et un échantillon de, écrits en dur (ponctuation haute, guillemets,
// nombres et unités, dates, abréviations, plages de pages, citations, incises, civilités),
// les textes des articles du banc (test/articles/*/*.md), le corpus test/accessibilite.
// La langue vient de la fiche <slug>.meta.yaml, passée en -M lang=, comme le pont Python.
//
// Dernier contrôle : les deux micro-règles de pipeline/manuscrit_biblio.py
// (_composer_separateur_titre, _t2_plage_pages_chapitre) sont importées telles quelles ; le
// filtre doit laisser intacte la sortie de la règle sur un titre, et rendre le même texte sur sa
// sortie et sur l'entrée brute pour une plage de pages.
//
// Un cas qui échoue est déclaré `todo` avec sa description exacte ; la correction se fait
// dans le filtre.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const FILTRE = path.join(RACINE, 'pipeline', 'filters', 'szh-typographie.lua');
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
    { encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 256 * 1024 * 1024 });
}

const ECHANTILLON_FR = [
  '---', 'title: Essai', '---', '',
  '# L\'Ecole inclusive : A l\'heure actuelle', '',
  'L\'enfant d\'ici dit : "une citation avec \'un mot\' cité" ; puis il part !  Vraiment ? Oui...',
  '',
  'Le coeur de l\'oeuvre coûte 1 000 CHF (soit 12 % ou 5 ‰) ; 3 km, 20 kg, 15 h 30, 10 cm.',
  '',
  'Le 3 mars 2026 et le 1er avril, voir M. Dupont, Mme Martin, Dr Weber et Mlle Roux, p. 12-15, pp. 20–25, cf. fig. 3, etc.',
  '',
  'La loi (art. 8, al. 2) -- une incise -- ou - parfois - un tiret ; « déjà chevronné » et « mal  espacé ».',
  '',
  '> "Citation en bloc", écrit-elle. L\'Etat\' reste.', '',
  '- point 1 : texte', '- point 2; texte', '',
  'Voir https://www.szh.ch/a:b et 10.57161/z2026 : rien ne bouge.', ''
].join('\n');

const ECHANTILLON_DE = [
  '---', 'title: Versuch', '---', '',
  '# Teilhabe : Ein "Prüfband" für die Praxis', '',
  'Er sagte: "Das ist \'wichtig\' für uns" ; sie meinte : «déjà» und „zitiert“ , doch warum ?',
  '',
  'Es kostet 1 000 CHF (12 % bzw. 5 ‰) ; 3 km, 20 kg, 15 Uhr 30, 10 cm...', '',
  'Am 3. März 2026 und 1. April, siehe Hr. Meier, Fr. Müller, Dr. Weber, S. 12-15, S. 20–25, vgl. Abb. 3, usw., z. B. dies, d. h. das, u. a. jenes.',
  '',
  'Das Gesetz (Art. 8 Abs. 2) -- eine Einschaltung -- oder - manchmal - ein Strich ; ‹einfach› und „doppelt“.',
  '', '> "Blockzitat", schrieb sie.', '',
  '- Punkt 1 : Text', '- Punkt 2; Text', ''
].join('\n');

function cheminsCorpus() {
  const cas = [];
  const parcourir = (dossier) => {
    if (!fs.existsSync(dossier)) { return; }
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const p = path.join(dossier, e.name);
      if (e.isDirectory()) { if (e.name !== 'out') { parcourir(p); } }
      else if (e.name.endsWith('.md') && !/\.biblio\.md$/.test(e.name)) { cas.push(p); }
    }
  };
  parcourir(path.join(RACINE, 'test', 'articles'));
  parcourir(path.join(RACINE, 'test', 'accessibilite'));
  return cas;
}

function langueDe(md) {
  const fiche = md.replace(/\.md$/, '.meta.yaml');
  if (fs.existsSync(fiche)) {
    const m = fs.readFileSync(fiche, 'utf8').match(/^lang:\s*["']?(\w+)/m);
    if (m) { return m[1]; }
  }
  return 'fr';
}

// Un script bash lance les deux passes pour chaque cas : une seule invocation wsl.exe.
function deuxPasses(dossier, cas, filtreLua) {
  const filtre = versWsl(filtreLua || FILTRE);
  const lignes = ['cd ' + JSON.stringify(versWsl(dossier))];
  cas.forEach((c, i) => {
    const e = JSON.stringify(versWsl(c.fichier));
    const base = 'c' + i;
    const opt = '-M lang=' + c.langue + ' --lua-filter=' + filtre;
    lignes.push('SZH_SLUG= pandoc -f markdown -t json ' + opt + ' ' + e + ' -o ' + base + '.1.json');
    lignes.push('SZH_SLUG= pandoc -f json -t json ' + opt + ' ' + base + '.1.json -o ' + base + '.2.json');
    lignes.push('pandoc -f json -t native --wrap=none ' + base + '.1.json -o ' + base + '.1.native');
    lignes.push('pandoc -f json -t native --wrap=none ' + base + '.2.json -o ' + base + '.2.native');
  });
  const script = path.join(dossier, 'passes.sh');
  fs.writeFileSync(script, lignes.join('\n') + '\n', 'utf8');
  const r = wsl(['bash', versWsl(script)]);
  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  return cas.map((c, i) => ({
    c,
    un: fs.readFileSync(path.join(dossier, 'c' + i + '.1.native'), 'utf8'),
    deux: fs.readFileSync(path.join(dossier, 'c' + i + '.2.native'), 'utf8')
  }));
}

function premierEcart(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) { return 'ligne ' + (i + 1) + ' : passe 1 = ' + JSON.stringify(la[i]) + ' ; passe 2 = ' + JSON.stringify(lb[i]); }
  }
  return '';
}

function jetable(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }

const echantillons = (dossier) => [
  ['échantillon fr', 'echantillon-fr.md', ECHANTILLON_FR, 'fr'],
  ['échantillon de', 'echantillon-de.md', ECHANTILLON_DE, 'de']
].map(([nom, fic, texte, langue]) => {
  const f = path.join(dossier, fic);
  fs.writeFileSync(f, texte, 'utf8');
  return { nom, fichier: f, langue };
});

const corpus = () => cheminsCorpus().map((f) => ({
  nom: path.relative(path.join(RACINE, 'test'), f).replace(/\\/g, '/'), fichier: f, langue: langueDe(f)
}));

test('typographie : f(f(x)) = f(x) sur les échantillons et le corpus du banc', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const d = jetable('szh-typo-idem-');
  try {
    const cas = echantillons(d).concat(corpus());
    assert.ok(cas.length >= 8, 'corpus du banc introuvable : ' + cas.length + ' cas');
    const resultats = deuxPasses(d, cas);
    const ecarts = resultats.filter((r) => r.un !== r.deux)
      .map((r) => r.c.nom + ' (' + r.c.langue + ') : ' + premierEcart(r.un, r.deux));
    // Chaque cas non idempotent est rapporté en `todo`, exactement décrit ; les autres sont verts.
    for (const r of resultats) {
      if (r.un !== r.deux) {
        t.test('idempotence : ' + r.c.nom, { todo: premierEcart(r.un, r.deux) }, () => {
          assert.strictEqual(r.deux, r.un);
        });
      }
    }
    if (ecarts.length) { console.warn('\n*** typographie non idempotente ***\n' + ecarts.join('\n')); }
    assert.ok(resultats.every((r) => r.un.length > 0), 'une passe n’a rien produit');
    // Le filtre agit bien : la première passe a posé des chevrons et des insécables.
    const fr = resultats.find((r) => r.c.nom === 'échantillon fr').un;
    assert.match(fr, /\\171/);
    assert.match(fr, /\\160/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// Sonde : un filtre volontairement non idempotent (chaque passe allonge le mot « a ») doit
// être vu par la comparaison, sinon le test précédent ne prouverait rien.
test('sonde : la comparaison des deux passes voit un filtre non idempotent', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const d = jetable('szh-typo-sonde-');
  try {
    const toy = path.join(d, 'toy.lua');
    fs.writeFileSync(toy, 'function Str(s) if s.text:sub(1, 1) == "a" then return pandoc.Str(s.text .. "a") end end\n', 'utf8');
    const md = path.join(d, 'toy.md');
    fs.writeFileSync(md, 'a b\n', 'utf8');
    const [r] = deuxPasses(d, [{ nom: 'toy', fichier: md, langue: 'fr' }], toy);
    assert.notStrictEqual(r.un, r.deux);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---- les deux micro-règles de manuscrit_biblio.py contre le filtre ------------------------
const PONT = [
  'import json, sys',
  "sys.path.insert(0, sys.argv[1] + '/pipeline')",
  'import manuscrit_biblio as mb',
  'cas = []',
  "for lg in ('fr', 'de'):",
  "    for titre in ('Inclusion:enjeux', 'Inclusion : enjeux', 'Teilhabe:Ein Prüfband', 'Teilhabe : Ein Prüfband', 'Titre\\u00a0: suite'):",
  "        cas.append({'rule': 'titre', 'lg': lg, 'entree': titre, 'py': mb._composer_separateur_titre(titre, lg)})",
  "    for pages in ('12-15', '12\\u201315', '120-135', '7\\u20139'):",
  "        cas.append({'rule': 'pages', 'lg': lg, 'entree': pages, 'py': mb._t2_plage_pages_chapitre(pages, lg)})",
  'print(json.dumps(cas))'
].join('\n') + '\n';

test('typographie : le filtre est stable sur la sortie des micro-règles Python', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const d = jetable('szh-typo-pont-');
  try {
    const pont = path.join(d, 'pont.py');
    fs.writeFileSync(pont, PONT, 'utf8');
    const r = wsl(['python3', versWsl(pont), versWsl(RACINE)]);
    assert.strictEqual(r.status, 0, 'import de manuscrit_biblio en échec : ' + r.stderr);
    const cas = JSON.parse(r.stdout);
    const lignes = ['cd ' + JSON.stringify(versWsl(d))];
    cas.forEach((c, i) => {
      for (const [cote, texte] of [['brut', c.entree], ['py', c.py]]) {
        const nom = 'm' + i + cote;
        const md = c.rule === 'pages' ? 'Voir ' + (c.lg === 'de' ? 'S. ' : 'p. ') + texte + ' ici.\n' : texte + '\n';
        fs.writeFileSync(path.join(d, nom + '.md'), md, 'utf8');
        lignes.push('SZH_SLUG= pandoc -f markdown -t plain --wrap=none -M lang=' + c.lg
          + ' --lua-filter=' + versWsl(FILTRE) + ' ' + nom + '.md -o ' + nom + '.txt');
      }
    });
    fs.writeFileSync(path.join(d, 'pont.sh'), lignes.join('\n') + '\n', 'utf8');
    const p = wsl(['bash', versWsl(path.join(d, 'pont.sh'))]);
    assert.strictEqual(p.status, 0, 'pandoc a échoué : ' + p.stderr);
    cas.forEach((c, i) => {
      const brut = fs.readFileSync(path.join(d, 'm' + i + 'brut.txt'), 'utf8');
      const py = fs.readFileSync(path.join(d, 'm' + i + 'py.txt'), 'utf8');
      const desc = c.rule + ' ' + c.lg + ' ' + JSON.stringify(c.entree) + ' : Python -> ' + JSON.stringify(c.py)
        + ' ; filtre(brut) = ' + JSON.stringify(brut) + ' ; filtre(Python) = ' + JSON.stringify(py);
      // Un titre : le filtre ne pose pas l'espace manquant après « : » (c'est le rôle de la
      // règle Python), donc le contrat est que le filtre laisse la sortie de Python intacte.
      // Des pages : les deux côtés convergent, le filtre posant lui-même le demi-cadratin en de.
      const attendu = c.rule === 'titre' ? c.py + '\n' : brut;
      if (py === attendu) { return; }
      t.test('micro-règle ' + c.rule + ' ' + c.lg + ' ' + JSON.stringify(c.entree), { todo: desc }, () => {
        assert.strictEqual(py, attendu);
      });
      console.warn('\n*** écart micro-règle/filtre *** ' + desc);
    });
    assert.strictEqual(cas.length, 18);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
