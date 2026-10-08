// Les encadrés « ce qu'un lecteur d'écran reçoit » de l'aperçu HTML.
//
//   node --test test/js/apercu-lecteur-ecran.test.js
//
// Ce que ces contrôles vérifient :
//
//   * Le PDF ne porte aucune trace de ces encadrés : le fichier qui les fabrique n'est
//     chargé par szh-numerotation.lua que sous SZH_APERCU=1, et aucune de leurs règles
//     n'est dans print.css, que l'aperçu partage avec le PDF.
//   * Aucune couleur nouvelle : test/apca-check.py mesure les hex de couleurs.css et de
//     print.css, pas ceux d'une feuille écrite dans un filtre. Les encadrés n'emploient
//     donc que des couleurs déjà déclarées dans print.css.
//   * Un seul cas est signalé en rouge, celui que l'export OJS refuse : image sans texte
//     alternatif, sans légende de repli et sans déclaration « décorative ». Un tableau sans
//     en-tête, une description longue vide ou une image décorative sont des absences
//     légitimes, montrées sans couleur d'alerte.
//   * Tout ce que lit un rédacteur existe en français et en allemand (orthographe suisse :
//     « ss », pas « ß »), plus l'italien et l'anglais, comme les libellés de figure.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { sansPandoc } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');
const MODULE = path.join(FILTRES, 'szh-apercu-lecteur-ecran.lua');
const NUMEROTATION = path.join(FILTRES, 'szh-numerotation.lua');
// La feuille du PDF tient en trois fichiers : socle.css (polices et variables),
// partage-filtres.css (balisage des filtres communs au livre), print.css (mise en page de la
// revue). Les contrôles les lisent comme une seule feuille, dans l'ordre du Makefile.
const FEUILLES_PDF = ['socle.css', 'partage-filtres.css', 'print.css']
  .map((n) => path.join(RACINE, 'pipeline', 'styles', n));

const lire = (p) => fs.readFileSync(p, 'utf8');

// Retire les lignes de commentaire, qui citent le code (« chargé par dofile ») et
// fausseraient les comptes. Seules les lignes entièrement en commentaire partent : couper
// à « -- » casserait « var(--c-rule) » dans la feuille de style.
const sansCommentaires = (lua) => lua.split('\n')
  .filter((ligne) => !/^\s*--/.test(ligne)).join('\n');

const source = sansCommentaires(lire(MODULE));
const numerotation = sansCommentaires(lire(NUMEROTATION));
const printCss = FEUILLES_PDF.map(lire).join('\n');

// Les marques que ces encadrés posent dans le HTML, propres à eux.
const CLASSES = ['szh-lecteur-ecran', 'szh-le-entete', 'szh-le-ligne', 'szh-le-tag',
                 'szh-le-note', 'szh-le-absent', 'szh-le-vide', 'szh-le-manque'];

// ---- Le PDF n'en porte aucune trace ----

test('le module des encadrés n’est chargé que sous SZH_APERCU, le module commun toujours', () => {
  assert.match(numerotation, /local APERCU = \(os\.getenv\('SZH_APERCU'\) or ''\) ~= ''/,
    'szh-numerotation.lua doit lire SZH_APERCU comme szh-citations.lua');
  // Le dofile de l'aperçu est dans le `if APERCU then`.
  const garde = numerotation.match(/if APERCU then[\s\S]*?\nend\n/);
  assert.ok(garde, 'aucun bloc « if APERCU then » dans szh-numerotation.lua');
  assert.match(garde[0], /dofile/, 'le chargement du module doit être dans la garde');
  assert.match(garde[0], /szh-apercu-lecteur-ecran\.lua/);
  // Deux dofile en tout : celui de l'aperçu ci-dessus et celui de szh-commun.lua, chargé
  // pour toute compilation.
  const dofiles = numerotation.match(/dofile/g) || [];
  assert.strictEqual(dofiles.length, 2,
    'deux dofile attendus : celui de l’aperçu (sous garde) et celui de szh-commun.lua');
  assert.ok(numerotation.indexOf("dofile, dossier_ce_fichier() .. 'szh-commun.lua'") !== -1,
    'szh-numerotation.lua ne charge plus szh-commun.lua par dofile, nommé');
});

test('chaque appel au module est gardé par « if lecteur_ecran »', () => {
  const appels = numerotation.match(/lecteur_ecran\.\w+/g) || [];
  const gardes = numerotation.match(/if lecteur_ecran then/g) || [];
  assert.ok(appels.length >= 2, 'le module doit être appelé (encadrés + feuille de style)');
  assert.strictEqual(appels.length, gardes.length,
    'autant de gardes que d’appels : un appel de plus, et la chaîne du PDF tomberait sur '
    + 'un lecteur_ecran à nil — ou, pire, poserait des encadrés dans le document publié');
  assert.ok(numerotation.indexOf('if lecteur_ecran then')
            < numerotation.indexOf('lecteur_ecran.'),
    'la première garde doit précéder le premier appel');
  assert.match(numerotation, /local lecteur_ecran = nil/,
    'le module vaut nil hors aperçu : un appel non gardé doit échouer bruyamment');
});

test('print.css ne connaît aucune de ces classes — sa feuille part avec le PDF', () => {
  for (const classe of CLASSES) {
    assert.ok(!printCss.includes(classe),
      classe + ' est dans print.css, que l’aperçu partage avec le PDF : '
      + 'la règle partirait aussi dans la feuille du document publié');
  }
});

test('aucun autre filtre ne produit ni ne style ces encadrés', () => {
  for (const nom of fs.readdirSync(FILTRES)) {
    if (!nom.endsWith('.lua') || nom === 'szh-apercu-lecteur-ecran.lua') { continue; }
    const texte = lire(path.join(FILTRES, nom));
    for (const classe of CLASSES) {
      assert.ok(!texte.includes(classe), nom + ' contient ' + classe);
    }
  }
});

test('aucune balise du module ne commence par « <table »', () => {
  // szh-numerotation.lua reconnaît un tableau réinjecté au motif « <table…> » : une balise
  // de l’encadré qui commencerait ainsi (<tableau…>) serait prise pour un tableau.
  const balises = source.match(/<[a-zA-Z][a-zA-Z0-9-]*/g) || [];
  for (const b of balises) {
    assert.ok(!/^<table/i.test(b), 'balise interdite : ' + b);
  }
});

// ---- Aucune couleur nouvelle ----

test('les couleurs de l’encadré sont toutes déjà déclarées dans la feuille du PDF', () => {
  // test/apca-check.py lit socle.css et print.css, pas une feuille écrite dans un filtre :
  // seuls des hex déjà mesurés là-bas sont admis.
  const hex = [...new Set((source.match(/#[0-9A-Fa-f]{3,6}/g) || [])
    .map((h) => h.toLowerCase()))];
  assert.ok(hex.length > 0, 'aucune couleur trouvée : le test ne contrôle plus rien');
  const cssMinuscule = printCss.toLowerCase();
  for (const h of hex) {
    assert.ok(cssMinuscule.includes(h),
      h + ' n’existe ni dans socle.css ni dans print.css : une couleur qu’aucune mesure APCA ne couvre. '
      + 'Reprendre un hex déjà argumenté là-bas, ou faire mesurer celui-ci.');
  }
  // Les variables de palette employées doivent exister aussi.
  for (const v of new Set(source.match(/var\((--[\w-]+)/g) || [])) {
    const nom = v.slice(4);
    assert.ok(printCss.includes(nom + ':'), nom + ' n’est un jeton ni du socle ni de print.css');
  }
});

test('le texte de l’encadré d’alerte est à l’encre, jamais au rouge', () => {
  // Selon pipeline/apca.py, #b3261e sur #fdecea vaut Lc 71,7, sous le seuil de 90 du texte
  // de cette maquette ; l’encre y vaut 95,6. Le rouge ne porte donc que le filet et l’aplat,
  // qui ne sont pas du texte (seuil 30).
  const regle = source.match(/\.szh-le-manque\{([^}]*)\}/);
  assert.ok(regle, 'la règle de l’encadré d’alerte a disparu');
  assert.match(regle[1], /border:[^;]*#b3261e/, 'le filet rouge fait l’alerte');
  assert.match(regle[1], /background:\s*#fdecea/, 'l’aplat rose fait l’alerte');
  assert.ok(!/\bcolor:\s*#b3261e/.test(regle[1]),
    'le rouge ne doit pas porter de texte : Lc 71,7 sur le rose');
});

// ---- Un seul cas rouge ----

test('un seul encadré est signalé en rouge', () => {
  const rouges = source.match(/,\s*true\)/g) || [];
  const calmes = source.match(/,\s*false\)/g) || [];
  assert.strictEqual(rouges.length, 1,
    'un second encadré rouge est apparu : une absence légitime — tableau sans en-tête, '
    + 'description longue facultative, image déclarée décorative — ne se signale pas '
    + 'comme un défaut. L’encadré montre, il n’accuse pas.');
  assert.ok(calmes.length >= 4, 'les cas calmes ont disparu');
  // Un seul appel au témoin d’alerte ; sa définition ne compte pas.
  const alertes = (source.match(/alerte\(l\)/g) || []).length
                - (source.match(/function alerte\(l\)/g) || []).length;
  assert.strictEqual(alertes, 1, 'un seul appel au témoin d’alerte');
});

test('les absences légitimes se disent en note, sans alerte', () => {
  for (const cle of ['sans_entete', 'desc_absente', 'decor']) {
    const usages = source.split('\n').filter((x) => x.includes('l.' + cle)
      && !x.includes(cle + ' ='));
    assert.ok(usages.length >= 1, 'aucun usage de l.' + cle);
    for (const u of usages) {
      assert.match(u, /note\(/, 'l.' + cle + ' doit passer par note() : ' + u.trim());
    }
  }
});

test('le cas rouge est le même que celui que l’export OJS refuse', () => {
  // L’encadré montre le cas de imagesSansAlternative() (lib/references.js) : ni attribut
  // alt, ni légende de repli. Les deux définitions vont ensemble.
  const references = lire(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib',
                                    'references.js'));
  assert.match(references, /!i\.altDefini && i\.legende\.trim\(\) === ''/,
    'le contrat de imagesSansAlternative a changé : relire encadre_image()');
  // Côté Lua : l’alerte n’est atteinte qu’après les deux replis (attribut, puis légende).
  const corps = source.match(/local function encadre_image[\s\S]*?\nend\n/);
  assert.ok(corps, 'encadre_image introuvable');
  assert.ok(corps[0].indexOf('legende ~=') < corps[0].indexOf('alerte(l)'),
    'le repli sur la légende doit être essayé AVANT de crier au vide');
});

test('les commentaires HTML sont retirés avant de compter les en-têtes', () => {
  // Le corpus d’accessibilité dit en commentaire qu’« aucun <th scope> n’existe » : sans ce
  // retrait, le compte trouverait un en-tête dans cette phrase.
  const i = source.indexOf("gsub('<!%-%-.-%-%->', '')");
  const j = source.indexOf("gmatch('<[tT][hH]");
  assert.ok(i > 0, 'le retrait des commentaires HTML a disparu');
  assert.ok(j > 0, 'le compte des en-têtes a disparu');
  assert.ok(i < j, 'les commentaires doivent être retirés AVANT le compte');
});

// ---- Français, allemand, et les deux autres langues de la chaîne ----

function tables() {
  const res = {};
  // Chaque bloc « xx = { … }, » de la table L.
  const re = /\n  (fr|de|it|en) = \{([\s\S]*?)\n  \},/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const cles = [];
    for (const ligne of m[2].split('\n')) {
      const c = ligne.match(/^\s*(\w+)\s*=/);
      if (c) { cles.push(c[1]); }
    }
    res[m[1]] = { cles: cles, texte: m[2] };
  }
  return res;
}

test('les quatre langues déclarent exactement les mêmes libellés', () => {
  const t = tables();
  assert.deepStrictEqual(Object.keys(t).sort(), ['de', 'en', 'fr', 'it'],
    'les libellés de figure existent en fr/de/it/en : ceux-ci aussi');
  const attendu = t.fr.cles.slice().sort();
  assert.ok(attendu.length >= 10, 'la table des libellés a maigri : ' + attendu.length);
  for (const langue of Object.keys(t)) {
    assert.deepStrictEqual(t[langue].cles.slice().sort(), attendu,
      'libellé manquant ou en trop en « ' + langue + ' » : un rédacteur verrait du '
      + 'français dans un article qui ne l’est pas');
  }
});

test('aucun libellé n’est vide, et l’allemand est en orthographe suisse', () => {
  const t = tables();
  for (const langue of Object.keys(t)) {
    assert.ok(!/=\s*''/.test(t[langue].texte), 'libellé vide en « ' + langue + ' »');
  }
  assert.ok(!source.includes('ß'),
    'orthographe suisse : « ss », jamais « ß »');
});

test('les étiquettes techniques restent en clair et non traduites', () => {
  // ALT= et DESCRIPTION= nomment le champ du formulaire où la valeur a été saisie, sous le
  // libellé « Texte alternatif » / « Alternativtext » de lib/i18n.js : ils restent tels
  // quels. Toute la prose est traduite.
  assert.match(source, /etiq\('ALT='\)/);
  assert.match(source, /etiq\('DESCRIPTION='\)/);
  const t = tables();
  for (const langue of Object.keys(t)) {
    assert.ok(!t[langue].texte.includes('ALT='),
      'ALT= ne doit pas être traduit (' + langue + ')');
  }
});

// ---- Exécution réelle : les quatre cas d'image, un seul encadré rouge ----
//
// Ce qui précède lit le source du filtre. Ici, il tourne sous pandoc, avec SZH_APERCU=1, sur
// les quatre états que distingue encadre_image() : alt renseigné, décoratif (alt=""), alt
// absent avec légende (repli), alt absent sans légende (le seul cas rouge). Deux petits
// fichiers Lua, écrits dans un dossier jetable :
//   1. pose l'attribut alt de deux images, comme szh-legendes.lua dans la vraie chaîne ;
//   2. charge le module par dofile et l'applique au document, comme szh-numerotation.lua
//      sous SZH_APERCU.
// Ce sont deux --lua-filter séparés : une modification d'attribut faite par un filtre ne
// survit pas à la traversée manuelle d'un autre filtre du même fichier, seulement à la
// traversée de pandoc entre deux fichiers.
test('exécution réelle : sur les quatre cas d’image, un seul encadré est rouge, et c’est le bon',
  { skip: sansPandoc }, () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-apercu-le-'));
    try {
      const marqueur = [
        "function Image(img)",
        "  if img.src == 'a.png' then img.attributes['alt'] = 'Alt complet'",
        "  elseif img.src == 'b.png' then img.attributes['alt'] = '' end",
        "  return img",
        "end",
        ""
      ].join('\n');
      const applique = [
        'local M = dofile(' + JSON.stringify(MODULE) + ')',
        'function Pandoc(doc)',
        "  doc.blocks = M.blocs(doc.blocks, 'fr')",
        '  local style = M.style()',
        '  if style then doc.blocks:insert(style) end',
        '  return doc',
        'end',
        ''
      ].join('\n');
      const fMarqueur = path.join(dossier, 'marqueur.lua');
      const fApplique = path.join(dossier, 'applique.lua');
      fs.writeFileSync(fMarqueur, marqueur, 'utf8');
      fs.writeFileSync(fApplique, applique, 'utf8');

      // Ordre d'encadre_image() : alt renseigné, décoratif, repli sur la légende, puis le
      // seul cas rouge (ni alt ni légende).
      const entree = ['![Alt complet](a.png)', '', '![](b.png)', '',
        '![Une legende](c.png)', '', '![](d.png)', ''].join('\n');
      const r = cp.spawnSync('pandoc',
        ['--from=markdown', '--to=html', '--lua-filter=' + fMarqueur, '--lua-filter=' + fApplique],
        { input: entree, encoding: 'utf8',
          env: Object.assign({}, process.env, { SZH_APERCU: '1' }) });
      assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
      const html = r.stdout;

      const encadres = html.split('<div class="szh-lecteur-ecran').slice(1);
      assert.strictEqual(encadres.length, 4,
        'les quatre cas n’ont pas chacun leur encadré : ' + html);
      const estRouge = (e) => e.slice(0, e.indexOf('>')).indexOf('szh-le-manque') !== -1;
      const rouges = encadres.filter(estRouge);
      assert.strictEqual(rouges.length, 1,
        'un nombre d’encadrés rouges différent de un : ' + html);
      // Compter ne suffit pas (une permutation garderait le compte) : on vérifie la
      // position, celle du cas sans alt ni légende (d.png).
      assert.ok(!estRouge(encadres[0]), 'alt="Alt complet" (a.png) est rouge à tort');
      assert.ok(!estRouge(encadres[1]), 'alt="" décoratif (b.png) est rouge à tort');
      assert.ok(!estRouge(encadres[2]), 'le repli sur la légende (c.png) est rouge à tort');
      assert.ok(estRouge(encadres[3]),
        'le seul cas sans alt ni légende (d.png) n’est pas signalé en rouge');
    } finally {
      fs.rmSync(dossier, { recursive: true, force: true });
    }
  });
