// Ancrages de références : le cockpit et le pipeline doivent produire le même identifiant.
// Les deux implémentations sont exécutées sur les mêmes entrées.
//
//   node --test test/js/ancrages.test.js
//
// Le cockpit pose des liens « [(Shaw, 2023)](#ref-shaw-2023) » ; le pipeline pose les ancres
// correspondantes. Si les deux replient les accents différemment (« ref-zielinski » contre
// « ref-zieliski »), le lien est mort dans le PDF sans autre signe qu'une ligne sur stderr.
//
// Entrées : noms accentués, tout le latin point de code par point de code, titres de
// bibliographie, règles de continuation, et l'identifiant complet d'une liste de références
// passée dans pandoc.
//
// Le Lua tourne dans la WSL. S'il est introuvable, les contrôles à deux côtés sont sautés en
// le disant ; SZH_WSL_OBLIGATOIRE en fait des échecs, comme en CI.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const cit = require(path.join(COCKPIT, 'lib', 'citations.js'));
const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
const { cheminVersWsl } = require(path.join(COCKPIT, 'lib', 'portraits.js'));

const FILTRE = path.join(RACINE, 'pipeline', 'filters', 'szh-citations.lua');
const TRAVAIL = path.join(os.tmpdir(), 'szh-ancrages');

// Noms polonais, turcs, croates, roumains, serbes, allemands, français et quelques cas
// simples.
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

// Tout le latin, les marques combinantes, et un échantillon de caractères sans base ASCII :
// chaque caractère est replié, ou signalé, de la même façon des deux côtés.
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

// Petit programme qui charge le filtre et appelle ses fonctions, exposées dans SZH_CITATIONS
// pour que le test éprouve le comportement plutôt que le texte.
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

// Saut bruyant : le contrôle n'est pas vert, il est déclaré non fait.
// SZH_WSL_OBLIGATOIRE via gardes.js en fait un échec au chargement du module.
function sauterSansLua(t, raison) {
  console.warn('\n*** Lua non vérifié : ' + raison + ' — les ancrages du pipeline ne sont '
    + 'PAS comparés ***\n');
  sauter.wsl(t);
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
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
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
  // NFD ne décompose pas Đ : la table du filtre le replie.
  assert.strictEqual(lua.get('Đurić').nomPourId, 'duric');
  assert.strictEqual(lua.get('Ðordević').nomPourId, 'dordevic');
});

test('ancrages : tout le latin se replie de la même façon des deux côtés', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
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
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  // Côté pipeline : stderr, où le journal de compilation le montre au rédacteur.
  const err = resultatsLua().stderr;
  // On cherche le code du constat (« caractere-sans-repli »), pas sa phrase, que l'on peut
  // reformuler.
  assert.match(err, /caractere-sans-repli[\s\S]*U\+03A9/,
    'le filtre a retiré Ω sans le dire : ' + err);
  assert.match(err, /U\+4E2D/, 'le filtre a retiré 中 sans le dire : ' + err);
});

test("ancrages : titres de bibliographie et suites d’entrée, mêmes réponses", (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
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
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
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
  // Ce sont les identifiants attendus, repli compris.
  assert.deepStrictEqual(posees.slice(0, 5), ['ref-zielinski-2019', 'ref-sahin-2021',
    'ref-duric-2020', 'ref-dordevic-2018', 'ref-olmez-2022']);
});

// Une parenthèse de prose allemande devant un millésime ressemble à un appel APA, car tout nom
// commun y prend une majuscule (« Werte » comme « Bovey »). Sans virgule devant le millésime,
// seul l'appariement à la bibliographie tranche : « (Bovey 2022) » s'apparie et reste lié ;
// « (Tabelle 3 zeigt die Werte für 2019) » ne s'apparie à rien et n'est pas signalé. Contrepartie :
// un vrai appel sans virgule dont la référence manque n'est pas signalé non plus, mais cette
// forme est hors norme APA.
test('ancrages : sans virgule devant le millésime, seule la bibliographie fait l’appel',
  (t) => {
    if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
    const md = [
      'T01 On le sait (Bovey, 2022).',
      '',
      'T02 On le sait aussi (Bundesamt für Statistik, 2021).',
      '',
      'T03 Vu ailleurs (von der Heide, 2020).',
      '',
      'T04 Vu encore (Kunz, 2016).',
      '',
      'T05 Et sans virgule cette fois (Bovey 2022).',
      '',
      'F01 Der Austausch ist geplant (mindestens fünf Treffen pro Tandem zwischen Juli 2026 '
        + 'und Oktober 2027).',
      '',
      'F02 Die Umsetzung erfolgte (Das Projekt läuft von 2020 bis 2024).',
      '',
      'F03 Laut Bericht (Die Erhebung erfolgte im Schuljahr 2021/2022).',
      '',
      'F04 Laut Plan (Der Workshop endet im Dezember 2027).',
      '',
      'F05 (Tabelle 3 zeigt die Werte für 2019).',
      '',
      '# Références',
      '',
      'Bovey, L. (2022). Ein Titel. Verlag.',
      '',
      'Bundesamt für Statistik (2021). Ein Titel. BFS.',
      '',
      'von der Heide, M. (2020). Ein Titel. Verlag.',
      '',
      'Kunz, A. (2016). Ein Titel. Verlag.'
    ].join('\n');
    fs.mkdirSync(TRAVAIL, { recursive: true });
    const source = path.join(TRAVAIL, 'prose-allemande.md');
    fs.writeFileSync(source, md, 'utf8');
    const r = wsl(['pandoc', '--from=markdown', '--to=html',
      '--lua-filter=' + cheminVersWsl(FILTRE), cheminVersWsl(source)]);
    assert.ok(!r.error, 'pandoc : ' + (r.error && r.error.message));
    assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
    const err = String(r.stderr);
    assert.doesNotMatch(err, /appel-sans-reference/,
      'une parenthèse de prose allemande est encore prise pour un appel :\n' + err);
    const posees = [...String(r.stdout).matchAll(/href="#(ref-[^"]+)"/g)].map((m) => m[1]);
    // Cinq liens : Bovey deux fois (avec et sans virgule, même référence), les trois autres
    // une fois. « Tabelle 3 zeigt die Werte für 2019 » n'en ajoute aucun.
    assert.strictEqual(posees.length, 5,
      'nombre de liens inattendu : ' + posees.join(' '));
    assert.deepStrictEqual([...new Set(posees)].sort(), ['ref-bovey-2022', 'ref-bundesamt-2021',
      'ref-kunz-2016', 'ref-von-2020'].sort(),
      'les quatre références légitimes doivent toutes être liées : ' + posees.join(' '));
  });

// Le point de « al. » ressemble à une fin de phrase, qui borne la recherche du nom devant un
// appel narratif (« Selon Capurso et al. (2025) »). Même chose pour « u. a. » et « et coll. ».
// Le filtre neutralise ces points d'abréviation avant de chercher la frontière : voir
// neutraliser_abreviations_dauteur().
test('ancrages : les appels narratifs avec « et al. »/« u. a. » sont liés', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  const md = [
    'Selon Capurso et al. (2025), les résultats sont là.',
    '',
    'Laut Capurso u. a. (2025) ist das Ergebnis eindeutig.',
    '',
    'Selon Bovey (2022), le constat est net.',
    '',
    '# Références',
    '',
    'Capurso, M., Rossi, P., & Bianchi, L. (2025). Ein Titel. Verlag.',
    '',
    'Bovey, L. (2022). Ein Titel. Verlag.'
  ].join('\n');
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const source = path.join(TRAVAIL, 'narratif-et-al.md');
  fs.writeFileSync(source, md, 'utf8');
  const r = wsl(['pandoc', '--from=markdown', '--to=html',
    '--lua-filter=' + cheminVersWsl(FILTRE), cheminVersWsl(source)]);
  assert.ok(!r.error, 'pandoc : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
  const posees = [...String(r.stdout).matchAll(/href="#(ref-[^"]+)"/g)].map((m) => m[1]);
  // Trois appels, trois liens : les deux formes « et al. »/« u. a. » vers Capurso, et
  // l'appel narratif simple vers Bovey.
  assert.strictEqual(posees.length, 3,
    'les trois appels narratifs ne sont pas tous liés : ' + posees.join(' ') + '\n' + r.stderr);
  assert.deepStrictEqual([...new Set(posees)].sort(),
    ['ref-bovey-2022', 'ref-capurso-2025'].sort(),
    'les deux références doivent être liées : ' + posees.join(' '));
});

// Un point qui ferme une vraie phrase reste une frontière. « Meier » et « Bovey » ont ici le
// même millésime : si la recherche du nom franchissait le point, Bovey deviendrait ambigu ou
// Meier recevrait le lien à sa place.
test('ancrages : une frontière de phrase reste une frontière pour l’appel narratif', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  const md = [
    'Il cite Meier dans son propos. Bovey (2022) affirme autre chose.',
    '',
    '# Références',
    '',
    'Meier, K. (2022). Ein Titel. Verlag.',
    '',
    'Bovey, L. (2022). Ein Titel. Verlag.'
  ].join('\n');
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const source = path.join(TRAVAIL, 'frontiere-phrase.md');
  fs.writeFileSync(source, md, 'utf8');
  const r = wsl(['pandoc', '--from=markdown', '--to=html',
    '--lua-filter=' + cheminVersWsl(FILTRE), cheminVersWsl(source)]);
  assert.ok(!r.error, 'pandoc : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
  const posees = [...String(r.stdout).matchAll(/href="#(ref-[^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(posees, ['ref-bovey-2022'],
    'le point après « propos » n’arrête plus la remontée : ' + posees.join(' ')
    + '\n' + r.stderr);
});

// Le champ « reference » d'un constat reference-orpheline sert au cockpit à retrouver le
// passage dans le .md par recherche littérale : il ne porte donc pas d'ellipse « … », même
// au-delà de 70 caractères. Les phrases fr/de, elles, peuvent en porter.
test('ancrages : le champ « reference » d’un constat orphelin ne porte pas d’ellipse ajoutée',
  (t) => {
    if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
    const md = [
      'On le sait grâce à Dupont (2020).',
      '',
      '# Références',
      '',
      'Dupont, J. (2020). Un titre. Verlag.',
      '',
      'Abernathy, Q. R., Blackwood, S. T., & Chesterfield, V. W. (2024). Un titre '
        + 'extremement long qui depasse largement soixante-dix caracteres pour de vrai. '
        + 'Editeur.'
    ].join('\n');
    fs.mkdirSync(TRAVAIL, { recursive: true });
    const source = path.join(TRAVAIL, 'reference-sans-ellipse.md');
    fs.writeFileSync(source, md, 'utf8');
    const r = wsl(['pandoc', '--from=markdown', '--to=html',
      '--lua-filter=' + cheminVersWsl(FILTRE), cheminVersWsl(source)]);
    assert.ok(!r.error, 'pandoc : ' + (r.error && r.error.message));
    assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
    const err = String(r.stderr);
    const ligne = err.split('\n').find((l) => l.includes('reference-orpheline'));
    assert.ok(ligne, 'aucun constat reference-orpheline dans stderr :\n' + err);
    // Les champs sont séparés par « | » (sans_barre() l'ôte des champs) : « reference » est
    // le troisième.
    const champs = ligne.split(' | ');
    const champReference = champs[2];
    assert.match(champReference, /^reference « (.*) »$/, 'forme inattendue : ' + champReference);
    const interieur = champReference.match(/^reference « (.*) »$/)[1];
    assert.ok(!interieur.includes('…'),
      'le champ reference porte encore une ellipse ajoutée : ' + interieur);
    assert.ok(md.includes(interieur),
      'le champ reference n’est pas une sous-chaîne littérale du markdown source : '
      + JSON.stringify(interieur));
  });

// Le libellé d'un appel narratif (« Selon Lefebvre et al. (2019) ») porte le nom et la
// parenthèse, pas la parenthèse seule. Il sert deux fois : dans le constat que lit le
// rédacteur, et comme cible de la flèche « Vers l'article » du cockpit, qui le cherche mot pour
// mot dans le .md ; « (2019) » seul tomberait sur la première parenthèse d'année venue.
test('ancrages : le libellé d’un appel narratif couvre le nom et la parenthèse', (t) => {
  if (sansPandocWsl) { sauterSansLua(t, sansPandocWsl); return; }
  const md = [
    'Selon Lefebvre et al. (2019), les résultats sont là.',
    '',
    'Laut Lefebvre u. a. (2019) ist das Ergebnis eindeutig.',
    '',
    'Selon Lefebvre (2019), le constat est net.',
    '',
    '# Références',
    '',
    'Bovey, L. (2022). Ein Titel. Verlag.'
  ].join('\n');
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const source = path.join(TRAVAIL, 'libelle-narratif.md');
  fs.writeFileSync(source, md, 'utf8');
  const r = wsl(['pandoc', '--from=markdown', '--to=html',
    '--lua-filter=' + cheminVersWsl(FILTRE), cheminVersWsl(source)]);
  assert.ok(!r.error, 'pandoc : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
  const err = String(r.stderr);
  const lignes = err.split('\n').filter((l) => l.includes('appel-sans-reference'));
  assert.strictEqual(lignes.length, 3,
    'trois appels sans référence attendus (Lefebvre n’est jamais dans la liste) :\n' + err);
  // Champs séparés par « | » : « appel » est le troisième. Les guillemets posés par constat()
  // encadrent le texte d'une espace insécable (U+00A0), que \s reconnaît.
  const libelles = lignes.map((l) => {
    const champs = l.split(' | ');
    const m = champs[2] && champs[2].match(/^appel\s*«\s*([\s\S]*?)\s*»$/);
    assert.ok(m, 'forme de constat inattendue : ' + l);
    return m[1];
  });
  // Le nom et la parenthèse, sans « Selon »/« Laut ».
  assert.deepStrictEqual(libelles.sort(),
    ['Lefebvre (2019)', 'Lefebvre et al. (2019)', 'Lefebvre u. a. (2019)'].sort(),
    'libellés narratifs inattendus : ' + JSON.stringify(libelles));
  // Chacun reste une sous-chaîne littérale du .md, que la flèche « Vers l'article » retrouve.
  for (const l of libelles) {
    assert.ok(md.includes(l),
      'libellé absent du markdown source, la flèche du cockpit le manquerait : ' + l);
  }
});

test('ancrages : le cockpit lit la table du filtre au lieu d’en tenir une copie', () => {
  assert.strictEqual(cit.cheminDuFiltre(), FILTRE,
    'le cockpit doit lire szh-citations.lua du dépôt quand il est là');
  // Sans les commentaires : on interroge le code.
  const code = fs.readFileSync(path.join(COCKPIT, 'lib', 'citations.js'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Le seul repli est celui que décrit le filtre : une copie dans le JS finirait par diverger.
  assert.ok(!/normalize\('NF/.test(code),
    'repli maison revenu dans citations.js : la table du filtre doit rester la seule');
  assert.ok(!/\[œŒ\]|\[æÆ\]|\/ß\//.test(code),
    'ligatures repliées à la main dans citations.js : elles sont dans le filtre');
});

// ---- forme des chemins Windows ----

// Piège : en JavaScript, `'C:\ProgramData\SZH'` avec des contre-obliques simples vaut
// « C:ProgramDataSZH » (`\P` et `\S` ne sont pas des échappements), un chemin relatif au
// lecteur C:. En développement, le dépôt répond avant et masque la faute ; sur un poste de
// rédaction, le toolkit installé est le seul emplacement utile.
//
// Deux contrôles : la valeur produite, découpée en segments (indépendante de la plate-forme),
// et la forme des littéraux dans la source.

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
  // Le dépôt d'abord : c'est lui qui sert en développement.
  assert.strictEqual(emplacements[0], FILTRE);
  // Puis le toolkit installé, segment par segment : « C:ProgramDataSZH » n'en rendrait
  // qu'un au lieu de trois.
  assert.deepStrictEqual(segments(emplacements[1]),
    ['C:', 'ProgramData', 'SZH', 'toolkit', 'pipeline', 'filters', 'szh-citations.lua'],
    'le chemin du toolkit installé a perdu ses séparateurs : contre-obliques simples ?');
});

test('chemins : tout littéral Windows du cockpit double ses contre-obliques', () => {
  // Tout le cockpit : lib/archivage.js et lib/wsl.js portent aussi des chemins Windows.
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
      // Une fois les paires « \\ » retirées, il ne reste aucune contre-oblique : une
      // contre-oblique simple serait avalée par l'analyseur JavaScript.
      const sansPaires = trouve.brut.split('\\\\').join('');
      if (sansPaires.indexOf('\\') !== -1) {
        fautes.push(path.relative(COCKPIT, fichier) + ':' + trouve.ligne
          + ' « ' + trouve.brut + ' » — contre-oblique simple');
        continue;
      }
      // La valeur reste un chemin absolu : un « C:… » sans séparateur devient relatif au
      // lecteur.
      const valeur = trouve.brut.split('\\\\').join('\\');
      if (segments(valeur).length < 2 || segments(valeur)[0].length !== 2) {
        fautes.push(path.relative(COCKPIT, fichier) + ':' + trouve.ligne
          + ' « ' + trouve.brut + ' » — chemin relatif au lecteur');
      }
    }
  }
  // Témoin : les deux chemins par défaut de lib/poste.js doivent être trouvés.
  const vusPoste = litterauxWindows(path.join(lib, 'poste.js')).map((t) => t.brut);
  assert.ok(vus >= 3 && vusPoste.indexOf('C:\\\\ProgramData\\\\SZH') !== -1
    && vusPoste.indexOf('C:\\\\Windows') !== -1,
    'aucun chemin Windows trouvé : le balayage ne balaie plus rien');
  assert.deepStrictEqual(fautes, [], 'chemins Windows mal échappés :\n' + fautes.join('\n'));
});

// ---- toolkit en retard sur le cockpit ----

// Le format des tables du filtre peut changer (REPLI, puis REPLI_BLOCS). Un poste peut
// porter une extension et un toolkit de versions différentes : le cockpit lit alors un filtre
// qu'il ne comprend pas, et le message au rédacteur ne doit pas nommer de table Lua.
function filtreDUnAutreFormat() {
  fs.mkdirSync(TRAVAIL, { recursive: true });
  const f = path.join(TRAVAIL, 'szh-citations-ancien.lua');
  // Un filtre à l'ancien format : une table REPLI de 50 octets, pas de REPLI_BLOCS.
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
  // Le repli refonctionne dès que le vrai filtre est là.
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
  // Les messages d'information sont recueillis aussi, pour voir une mauvaise branche.
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
    // Si la commande laissait remonter l'exception, cet await la relèverait ici.
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
  // Le rédacteur lit une cause et une action, sans jargon. Le cockpit ne sait pas laquelle
  // des deux moitiés est en avance : le message ne le dit pas.
  assert.match(dit, /ne sont pas de la même version/);
  assert.match(dit, /Mettez le logiciel à jour/);
  assert.ok(!/plus ancien|plus récent/.test(dit),
    'le message prétend savoir qui est en avance : ' + dit);
  assert.ok(!/REPLI|\.lua|szh-citations|table/.test(dit),
    'le message montre de la plomberie au rédacteur : ' + dit);
  // L'allemand dit la même chose, sans plus de détails techniques.
  const de = TL('de', 'cit.toolkit.discordant');
  assert.match(de, /nicht die gleiche Version/);
  assert.match(de, /Aktualisieren Sie die Software/);
  assert.ok(!/älter|neuer/.test(de), 'le message allemand prétend savoir qui est en avance');
  assert.ok(!/REPLI|\.lua|szh-citations/.test(de), 'plomberie dans le message allemand');
});
