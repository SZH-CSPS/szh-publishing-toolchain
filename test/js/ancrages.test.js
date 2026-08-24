// Ancrages de références : le cockpit et le pipeline doivent tomber sur le même
// identifiant, et c'est vérifié en exécutant les deux.
//
//   node --test test/js
//
// Le cockpit pose des liens « [(Shaw, 2023)](#ref-shaw-2023) » ; le pipeline pose les
// ancres correspondantes. Tant que chacun repliait les accents de son côté, ils
// divergeaient sans bruit : « Zieliński » donnait « ref-zielinski » au cockpit et
// « ref-zieliski » à la compilation. Le lien mourait dans le PDF, et le seul signe était
// une ligne sur stderr que personne ne lit. contrats.test.js comparait les deux lexiques
// par expression régulière sur le texte source — ce qui ne dit rien du résultat, et n'a
// rien vu pendant deux ans.
//
// Ici, les deux implémentations tournent pour de vrai sur les mêmes entrées : les noms
// accentués, tout le latin point de code par point de code, les titres de bibliographie,
// les règles de continuation, et l'identifiant complet d'une liste de références passée
// dans pandoc.
//
// Le Lua tourne dans la WSL : pandoc n'existe pas côté Windows. S'il est introuvable, les
// contrôles à deux côtés sont sautés en le disant — jamais verts par défaut. Poser
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
const cit = require(path.join(COCKPIT, 'lib', 'citations.js'));
const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
const { cheminVersWsl } = require(path.join(COCKPIT, 'lib', 'portraits.js'));

const FILTRE = path.join(RACINE, 'pipeline', 'filters', 'szh-citations.lua');
const TRAVAIL = path.join(os.tmpdir(), 'szh-ancrages');

// Les noms qui ont motivé ce contrôle : polonais, turc, croate, roumain, serbe, allemand,
// français, plus les quatre cas que l'ancien test couvrait déjà et qui doivent tenir.
const NOMS = [
  'Zieliński', 'Şahin', 'Đurić', 'Łukasz', 'Ştefan', 'Ćirić', 'Ricœur', 'Müller',
  'Weiß', 'van der Aa', 'insieme', 'Sen', 'Ölmez', 'Ðordević',
  'Übereinkommen', 'Ebersold, S., & Detraux, J.-J.', 'Ríos-Aguilar', 'Þórsdóttir',
  'Kalniņš', 'Škoda', 'Ægir', 'Straße'
];

const TITRES = [
  'Literatur', 'Literaturverzeichnis', 'Références bibliographiques', 'Bibliographie',
  'Références', 'Quellen', 'Ouvrages cités', 'Weiterführende Literatur',
  'Introduction', 'Méthode', 'Referenzen', 'Bibliografía'
];

const CONTINUATIONS = [
  'https://doi.org/10.1234/x',
  'www.szh.ch/article',
  'mit Behinderungen nach Geschlecht, ohne année',
  'van der Aa, H. (2023). Un titre.',
  'Übereinkommen über die Rechte, vom 13. Dezember 2006',
  '*Bathelt, J. (2019). Adaptive behaviour.',
  'insieme Schweiz (2024). Wahlanleitung.',
  'Şahin, K. (2021). Kaynaklar. Dergi.',
  'zieliński ohne Jahr im Titel',
  '2. Auflage, Beltz.'
];

// Tout le latin, les marques combinantes, et un échantillon de ce qui n'a pas de base
// ASCII : un caractère non replié doit l'être — ou être signalé — identiquement des deux
// côtés.
function pointsDeCode() {
  const cps = [];
  const plages = [[0x00A0, 0x024F], [0x0300, 0x036F], [0x1E00, 0x1EFF]];
  for (const [a, b] of plages) {
    for (let cp = a; cp <= b; cp++) { cps.push(cp); }
  }
  // Grec, cyrillique, arabe, chinois, tirets et guillemets typographiques, émoji.
  for (const cp of [0x03A9, 0x03B5, 0x0416, 0x0627, 0x4E2D, 0x2013, 0x2019, 0x00AB,
    0x2026, 0x1F600, 0x20AC]) {
    cps.push(cp);
  }
  return cps;
}

// ---- exécution du filtre Lua ----

// Petit programme qui charge le filtre et appelle ses fonctions. Le filtre les expose dans
// SZH_CITATIONS pour cela : c'est le seul moyen d'éprouver son comportement plutôt que son
// texte.
const HARNAIS = [
  'local filtre, noms, points, titres, suites = arg[1], arg[2], arg[3], arg[4], arg[5]',
  'dofile(filtre)',
  'local S = SZH_CITATIONS',
  'local function lignes(f)',
  '  local out = {}',
  '  for l in io.lines(f) do',
  '    l = l:gsub("\\r$", "")',
  '    if l ~= "" then out[#out + 1] = l end',
  '  end',
  '  return out',
  'end',
  'for _, n in ipairs(lignes(noms)) do',
  '  io.write("NOM\\t", n, "\\t", S.plat(n), "\\t", S.nom_pour_id(n), "\\n")',
  'end',
  'for _, h in ipairs(lignes(points)) do',
  '  local c = utf8.char(tonumber(h, 16))',
  '  io.write("CP\\t", h, "\\t", S.replier(c), "\\n")',
  'end',
  'for _, t in ipairs(lignes(titres)) do',
  '  io.write("TITRE\\t", t, "\\t", S.est_titre_bib(t) and "1" or "0", "\\n")',
  'end',
  'for _, s in ipairs(lignes(suites)) do',
  '  io.write("SUITE\\t", s, "\\t", S.est_continuation(s) and "1" or "0", "\\n")',
  'end'
].join('\n') + '\n';

function wsl(args, options) {
  return spawnSync(cheminWsl(), ['-d', DISTRO, '--'].concat(args),
    Object.assign({ encoding: 'utf8', windowsHide: true, timeout: 120000 }, options || {}));
}

let pandocVu = null;

// Pourquoi pandoc manque, ou null s'il répond.
function pandocAbsent() {
  if (pandocVu !== null) { return pandocVu; }
  let r;
  try {
    r = wsl(['sh', '-c', 'command -v pandoc']);
  } catch (e) {
    pandocVu = 'wsl.exe injoignable : ' + e.message;
    return pandocVu;
  }
  if (r.error) { pandocVu = 'wsl.exe injoignable : ' + r.error.message; }
  else if (r.status !== 0) { pandocVu = 'pandoc introuvable dans la distro ' + DISTRO; }
  else { pandocVu = null; }
  return pandocVu;
}

// Saut bruyant : le contrôle n'est pas vert, il est déclaré non fait. Avec
// SZH_LUA_OBLIGATOIRE=1 il échoue, pour qu'une CI ne se contente pas d'un saut.
function sauterSansLua(t, raison) {
  const msg = 'Lua non vérifié : ' + raison;
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail(msg); }
  console.warn('\n*** ' + msg + ' — les ancrages du pipeline ne sont PAS comparés ***\n');
  t.skip(msg);
}

let sortieLua = null;

// Lance le harnais une fois pour tous les contrôles et range sa sortie par famille.
function resultatsLua() {
  if (sortieLua) { return sortieLua; }
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const ecrire = (nom, lignes) => {
    const f = path.join(TRAVAIL, nom);
    fs.writeFileSync(f, lignes.join('\n') + '\n', 'utf8');
    return cheminVersWsl(f);
  };
  const harnais = path.join(TRAVAIL, 'harnais.lua');
  fs.writeFileSync(harnais, HARNAIS, 'utf8');
  const args = ['pandoc', 'lua', cheminVersWsl(harnais), cheminVersWsl(FILTRE),
    ecrire('noms.txt', NOMS),
    ecrire('points.txt', pointsDeCode().map((c) => c.toString(16))),
    ecrire('titres.txt', TITRES),
    ecrire('suites.txt', CONTINUATIONS)];
  const r = wsl(args);
  assert.ok(!r.error, 'harnais Lua : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'harnais Lua sorti en ' + r.status + ' : ' + r.stderr);
  const par = { NOM: new Map(), CP: new Map(), TITRE: new Map(), SUITE: new Map() };
  for (const ligne of String(r.stdout).split('\n')) {
    const champs = ligne.replace(/\r$/, '').split('\t');
    if (champs.length === 4 && champs[0] === 'NOM') {
      par.NOM.set(champs[1], { plat: champs[2], nomPourId: champs[3] });
    } else if (champs.length === 3 && par[champs[0]]) {
      par[champs[0]].set(champs[1], champs[2]);
    }
  }
  sortieLua = { par: par, stderr: String(r.stderr) };
  return sortieLua;
}

// ---- les contrôles ----

test('ancrages : les mêmes noms donnent le même identifiant des deux côtés', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const lua = resultatsLua().par.NOM;
  const rangees = [];
  const ecarts = [];
  for (const nom of NOMS) {
    const cote = lua.get(nom);
    assert.ok(cote, 'le harnais Lua n’a rien rendu pour ' + nom);
    const js = { plat: cit.aplatir(nom), nomPourId: cit.nomPourId(nom) };
    const ok = js.plat === cote.plat && js.nomPourId === cote.nomPourId;
    rangees.push((ok ? '  ' : '! ') + nom.padEnd(30) + 'cockpit ' + js.nomPourId.padEnd(14)
      + 'pipeline ' + cote.nomPourId);
    if (!ok) {
      ecarts.push(nom + ' : cockpit ' + JSON.stringify(js)
        + ' ≠ pipeline ' + JSON.stringify(cote));
    }
  }
  for (const l of rangees) { t.diagnostic(l); }
  assert.deepStrictEqual(ecarts, [], 'identifiants divergents :\n' + ecarts.join('\n'));
  // Le Đ ne se perd plus : NFD ne le décompose pas, la table du filtre le replie.
  assert.strictEqual(lua.get('Đurić').nomPourId, 'duric');
  assert.strictEqual(lua.get('Ðordević').nomPourId, 'dordevic');
});

test('ancrages : tout le latin se replie de la même façon des deux côtés', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const lua = resultatsLua().par.CP;
  const ecarts = [];
  for (const cp of pointsDeCode()) {
    const hex = cp.toString(16);
    const cote = lua.get(hex);
    assert.notStrictEqual(cote, undefined, 'point de code absent de la sortie Lua : ' + hex);
    const js = cit.replier(String.fromCodePoint(cp));
    if (js !== cote) {
      ecarts.push('U+' + hex.toUpperCase() + ' ' + String.fromCodePoint(cp)
        + ' : cockpit « ' + js + ' » ≠ pipeline « ' + cote + ' »');
    }
  }
  t.diagnostic(lua.size + ' points de code comparés');
  assert.deepStrictEqual(ecarts, [], 'replis divergents :\n' + ecarts.join('\n'));
});

test('ancrages : un caractère sans repli est consigné, pas avalé', (t) => {
  // Côté cockpit : le journal de l'hôte, relisible par caracteresSansRepli().
  cit.aplatir('Ω中');
  const journal = cit.caracteresSansRepli().join('\n');
  assert.match(journal, /U\+03A9/, 'Ω retiré sans être consigné côté cockpit');
  assert.match(journal, /U\+4E2D/, '中 retiré sans être consigné côté cockpit');
  // Un caractère replié ou volontairement ignoré ne doit pas encombrer le journal.
  cit.aplatir('Zieliński — « Ölmez »');
  assert.doesNotMatch(cit.caracteresSansRepli().join('\n'), /U\+0144|U\+2014|U\+00D6/);
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  // Côté pipeline : stderr, où le journal de compilation le montre au rédacteur.
  const err = resultatsLua().stderr;
  // Sur le CODE du constat, pas sur sa phrase : le filtre écrit « caractere-sans-repli »
  // et le cockpit s'ancre là aussi. Une reformulation du message ne doit rien casser ici.
  assert.match(err, /caractere-sans-repli[\s\S]*U\+03A9/,
    'le filtre a retiré Ω sans le dire : ' + err);
  assert.match(err, /U\+4E2D/, 'le filtre a retiré 中 sans le dire : ' + err);
});

test('ancrages : titres de bibliographie et suites d’entrée, mêmes réponses', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const res = resultatsLua().par;
  const ecarts = [];
  for (const titre of TITRES) {
    const cote = res.TITRE.get(titre) === '1';
    const js = cit.estTitreBib(titre);
    if (js !== cote) { ecarts.push('titre « ' + titre + ' » : ' + js + ' ≠ ' + cote); }
  }
  for (const suite of CONTINUATIONS) {
    const cote = res.SUITE.get(suite) === '1';
    const js = cit.estContinuation(suite);
    if (js !== cote) { ecarts.push('suite « ' + suite + ' » : ' + js + ' ≠ ' + cote); }
  }
  assert.deepStrictEqual(ecarts, [], 'découpage divergent :\n' + ecarts.join('\n'));
});

test('ancrages : les ancres posées par pandoc sont celles que le cockpit propose', (t) => {
  const absent = pandocAbsent();
  if (absent) { return sauterSansLua(t, absent); }
  const md = [
    'On le lit chez Zieliński (2019) et ailleurs (Şahin, 2021 ; Đurić, 2020).',
    '',
    '# Références',
    '',
    'Zieliński, T. (2019). Edukacja włączająca. Wydawnictwo.',
    '',
    'Şahin, K. (2021). Kaynaştırma eğitimi. Dergi, 12(3), 44-59.',
    '',
    'Đurić, M. (2020). Inkluzivno obrazovanje. Zavod.',
    '',
    'Ðordević, V. (2018). Podrška učenicima. Institut.',
    '',
    'Ölmez, S. (2022). Öğretmen görüşleri. Yayın.',
    '',
    'Ricœur, P. (1990). Soi-même comme un autre. Seuil.',
    '',
    'Weiß, H. (2016). Frühförderung. Reinhardt.',
    '',
    'insieme Schweiz (2024). Wahlanleitung. Insieme.',
    '',
    'van der Aa, H. (2023). Un titre. Revue.',
    '',
    'Sen, A. (2001). Éthique. PUF.',
    '',
    'Sen, A. (2001). Autre texte, même année. PUF.'
  ].join('\n');
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const source = path.join(TRAVAIL, 'liste.md');
  fs.writeFileSync(source, md, 'utf8');
  const r = wsl(['pandoc', '--from=markdown', '--to=html',
    '--lua-filter=' + cheminVersWsl(FILTRE), cheminVersWsl(source)]);
  assert.ok(!r.error, 'pandoc : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
  const posees = [...String(r.stdout).matchAll(/id="(ref-[^"]+)"/g)].map((m) => m[1]);
  const proposees = cit.referencesDuTexte(md).map((e) => e.id);
  t.diagnostic('ancres du pipeline : ' + posees.join(' '));
  assert.deepStrictEqual(proposees, posees,
    'le cockpit proposerait des ancrages que la compilation ne pose pas');
  // Et ce sont bien les identifiants attendus, repli compris.
  assert.deepStrictEqual(posees.slice(0, 5), ['ref-zielinski-2019', 'ref-sahin-2021',
    'ref-duric-2020', 'ref-dordevic-2018', 'ref-olmez-2022']);
});

test('ancrages : le cockpit lit la table du filtre au lieu d’en tenir une copie', () => {
  assert.strictEqual(cit.cheminDuFiltre(), FILTRE,
    'le cockpit doit lire szh-citations.lua du dépôt quand il est là');
  // Sans les commentaires : c'est le code qu'on interroge, pas ce qu'il raconte.
  const code = fs.readFileSync(path.join(COCKPIT, 'lib', 'citations.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Un repli recopié dans le JS, sous quelque forme que ce soit, ramènerait l'écart : le
  // seul repli autorisé ici est celui que le filtre décrit.
  assert.ok(!/normalize\('NF/.test(code),
    'repli maison revenu dans citations.js : la table du filtre doit rester la seule');
  assert.ok(!/\[œŒ\]|\[æÆ\]|\/ß\//.test(code),
    'ligatures repliées à la main dans citations.js : elles sont dans le filtre');
});

// ---- forme des chemins Windows ----

// La faute qui a tué le repli « toolkit installé » pendant un temps : `'C:\ProgramData\SZH'`
// avec des contre-obliques SIMPLES. En JavaScript, `\P` et `\S` ne sont pas des échappements
// reconnus — la chaîne valait « C:ProgramDataSZH », un chemin relatif au lecteur C: qui ne
// mène nulle part. Rien ne le signalait : le littéral se lit comme un chemin correct, et
// tous les contrôles passaient parce que le dépôt répond avant. Sur un poste de rédaction,
// où l'extension vit sous .vscode-oss et non dans le dépôt, c'est le seul emplacement qui
// mène quelque part — le repli était mort là où il est seul à servir.
//
// Deux verrous, parce qu'un seul ne suffit pas : la valeur produite (découpée en segments,
// donc indépendante de la plate-forme), et la FORME des littéraux dans la source, où la
// faute est visible avant même d'être exécutée.

// Les segments d'un chemin, quel que soit le séparateur : « C:ProgramDataSZH » n'en donne
// qu'un, là où « C:\ProgramData\SZH » en donne trois.
function segments(chemin) { return String(chemin).split(/[\\/]+/); }

// Les littéraux de chaîne qui commencent par une lettre de lecteur, avec leur ligne.
function litterauxWindows(fichier) {
  const src = fs.readFileSync(fichier, 'utf8');
  const trouves = [];
  const motif = /(['"])([A-Za-z]:[^'"\n]*)\1/g;
  let m;
  while ((m = motif.exec(src)) !== null) {
    trouves.push({ ligne: src.slice(0, m.index).split('\n').length, brut: m[2] });
  }
  return trouves;
}

test('chemins : l’emplacement du toolkit installé garde ses séparateurs', () => {
  const emplacements = cit.emplacementsDuFiltre();
  assert.strictEqual(emplacements.length, 2,
    'deux emplacements attendus : le dépôt, puis le toolkit installé');
  // Le dépôt d'abord — c'est lui qui sert en développement, et c'est aussi lui qui masquait
  // la faute du second.
  assert.strictEqual(emplacements[0], FILTRE);
  // Puis le toolkit installé, segment par segment : « C:ProgramDataSZH » n'en rendrait
  // qu'un au lieu de trois, et le contrôle tombe là où la lecture ne voyait rien.
  assert.deepStrictEqual(segments(emplacements[1]),
    ['C:', 'ProgramData', 'SZH', 'toolkit', 'pipeline', 'filters', 'szh-citations.lua'],
    'le chemin du toolkit installé a perdu ses séparateurs : contre-obliques simples ?');
});

test('chemins : tout littéral Windows du cockpit double ses contre-obliques', () => {
  // Le cockpit entier, pas seulement citations.js : la même faute peut renaître ailleurs,
  // et elle s'y verra aussi peu. lib/archivage.js et lib/wsl.js portent les mêmes chemins.
  const fichiers = [path.join(COCKPIT, 'extension.js')];
  const lib = path.join(COCKPIT, 'lib');
  const empiler = (base) => {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory()) { empiler(path.join(base, e.name)); }
      else if (e.name.endsWith('.js')) { fichiers.push(path.join(base, e.name)); }
    }
  };
  empiler(lib);
  empiler(path.join(COCKPIT, 'media'));
  const fautes = [];
  let vus = 0;
  for (const fichier of fichiers) {
    for (const trouve of litterauxWindows(fichier)) {
      vus++;
      // Chaque paire « \\ » retirée, il ne doit plus rester une seule contre-oblique :
      // celle qui reste est simple, donc avalée par l'analyseur JavaScript.
      const sansPaires = trouve.brut.split('\\\\').join('');
      if (sansPaires.indexOf('\\') !== -1) {
        fautes.push(path.relative(COCKPIT, fichier) + ':' + trouve.ligne
          + ' « ' + trouve.brut + ' » — contre-oblique simple');
        continue;
      }
      // Et la valeur obtenue reste un chemin absolu : un « C:… » qui perd son séparateur
      // devient relatif au lecteur, ce qu'aucun de ces chemins n'a jamais voulu être.
      const valeur = trouve.brut.split('\\\\').join('\\');
      if (segments(valeur).length < 2 || segments(valeur)[0].length !== 2) {
        fautes.push(path.relative(COCKPIT, fichier) + ':' + trouve.ligne
          + ' « ' + trouve.brut + ' » — chemin relatif au lecteur');
      }
    }
  }
  assert.ok(vus >= 4, 'aucun chemin Windows trouvé : le balayage ne balaie plus rien');
  assert.deepStrictEqual(fautes, [], 'chemins Windows mal échappés :\n' + fautes.join('\n'));
});

// ---- toolkit en retard sur le cockpit ----

// Le format des tables a changé une fois (REPLI -> REPLI_BLOCS) : il changera encore. Un
// poste peut porter l'extension et un toolkit d'avant — c'est arrivé, un VSIX livré avec un
// toolkit en retard d'un commit. Le cockpit lit alors un filtre qu'il ne comprend pas, et le
// rédacteur ne doit pas y lire un nom de table Lua.
function filtreDUnAutreFormat() {
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const f = path.join(TRAVAIL, 'szh-citations-ancien.lua');
  // Le filtre tel qu'il était : une table REPLI de 50 octets, aucun REPLI_BLOCS.
  fs.writeFileSync(f, [
    'local REPLI = {',
    "  -- la table courte d'avant, clée par octets ; ce qui compte ici est son nom.",
    "  ['A']='a',['E']='e',['OE']='oe',",
    '}',
    'function Pandoc(doc) return doc end'
  ].join('\n'), 'utf8');
  return f;
}

function avecFiltre(chemin, faire) {
  const avant = process.env.SZH_FILTRE_CITATIONS;
  process.env.SZH_FILTRE_CITATIONS = chemin;
  cit.oublierTables();
  try {
    faire();
  } finally {
    if (avant === undefined) { delete process.env.SZH_FILTRE_CITATIONS; }
    else { process.env.SZH_FILTRE_CITATIONS = avant; }
    cit.oublierTables();
  }
}

test('ancrages : toolkit absent et toolkit discordant sont deux pannes distinctes', () => {
  // Absent : le poste n'a pas d'outil de composition du tout.
  avecFiltre(path.join(TRAVAIL, 'ce-fichier-n-existe-pas.lua'), () => {
    assert.throws(() => cit.nomPourId('Đurić'), (e) => {
      assert.strictEqual(e.szhRepli, 'absent');
      assert.strictEqual(e.messageCle, 'cit.toolkit.absent');
      return true;
    });
  });
  // Discordant : l'outil est là, mais d'un format que ce cockpit ne lit pas.
  avecFiltre(filtreDUnAutreFormat(), () => {
    assert.throws(() => cit.nomPourId('Đurić'), (e) => {
      assert.strictEqual(e.szhRepli, 'discordant');
      assert.strictEqual(e.messageCle, 'cit.toolkit.discordant');
      assert.match(e.message, /REPLI_BLOCS absente de/);
      return true;
    });
  });
  // Et le repli marche de nouveau dès que le vrai filtre est là : rien n'est resté coincé.
  assert.strictEqual(cit.nomPourId('Đurić'), 'duric');
});

// Dernier de ce fichier : activerHote() accroche Module._load pour tout le processus.
test('ancrages : un toolkit discordant se dit en clair au rédacteur, sans exception', async () => {
  const { revueDEssai, activerHote } = require('./hote-factice');
  const revue = revueDEssai();
  const hote = activerHote(revue);
  const { T, TL } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  // L'hôte factice n'attend pas le démarrage asynchrone qui pose la racine ; sans elle la
  // commande répondrait « hors article » et ne toucherait jamais aux tables de repli.
  hote.arbre().definirRacine(revue);
  // Les informations sont recueillies aussi : partir dans la mauvaise branche doit se voir.
  const infos = [];
  hote.stub.window.showInformationMessage = (m) => { infos.push(m); return Promise.resolve(); };
  const article = path.join(revue, 'articles', '01-essai', '01-essai.md');
  const md = ['On le lit chez Zieliński (2019).', '', '# Références', '',
    'Zieliński, T. (2019). Edukacja. Wydawnictwo.'].join('\n');
  hote.stub.window.activeTextEditor = {
    document: { uri: { fsPath: article }, getText: () => md, lineAt: () => ({ text: md }) },
    selection: { isEmpty: true, active: { line: 0, character: 20 } }
  };
  const avant = process.env.SZH_FILTRE_CITATIONS;
  process.env.SZH_FILTRE_CITATIONS = filtreDUnAutreFormat();
  cit.oublierTables();
  try {
    // Si la commande laissait remonter l'exception, cet await la relèverait ici : passer
    // cette ligne est la preuve qu'elle est attrapée.
    await hote.executer('szh.lierReference');
  } finally {
    if (avant === undefined) { delete process.env.SZH_FILTRE_CITATIONS; }
    else { process.env.SZH_FILTRE_CITATIONS = avant; }
    cit.oublierTables();
  }
  const dit = hote.erreurs.join('\n');
  assert.deepStrictEqual(infos, [], 'la commande a répondu autre chose : '
    + infos.join(' | '));
  assert.strictEqual(hote.erreurs.length, 1, 'un seul message attendu, reçu : ' + dit);
  assert.strictEqual(hote.erreurs[0], T('cit.toolkit.discordant'));
  // Ce que le rédacteur lit : une cause et un geste, aucun jargon. Et pas de sens : le
  // cockpit ne sait pas laquelle des deux moitiés est en avance, donc il ne le dit pas.
  assert.match(dit, /ne sont pas de la même version/);
  assert.match(dit, /Mettez le logiciel à jour/);
  assert.ok(!/plus ancien|plus récent/.test(dit),
    'le message prétend savoir qui est en avance : ' + dit);
  assert.ok(!/REPLI|\.lua|szh-citations|table/.test(dit),
    'le message montre de la plomberie au rédacteur : ' + dit);
  // L'allemand dit la même chose, et pas davantage de plomberie : la revue germanophone
  // est la moitié du lectorat de cet outil.
  const de = TL('de', 'cit.toolkit.discordant');
  assert.match(de, /nicht die gleiche Version/);
  assert.match(de, /Aktualisieren Sie die Software/);
  assert.ok(!/älter|neuer/.test(de), 'le message allemand prétend savoir qui est en avance');
  assert.ok(!/REPLI|\.lua|szh-citations/.test(de), 'plomberie dans le message allemand');
});
