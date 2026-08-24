// Les encadrés « ce qu'un lecteur d'écran reçoit » de l'aperçu HTML.
//
//   node --test "test/js/*.test.js"
//
// Ce que ces contrôles gardent, et pourquoi chacun :
//
//   * Le PDF publié ne doit porter AUCUNE trace de ces encadrés. La garantie n'est pas
//     une relecture attentive, c'est que le fichier qui les fabrique n'est pas même OUVERT
//     hors de l'aperçu : szh-numerotation.lua ne le charge que sous SZH_APERCU=1. Un
//     `dofile` sorti de cette garde, ou une règle de ces encadrés glissée dans print.css —
//     que l'aperçu PARTAGE avec le PDF —, et la promesse tombe. C'est ce que le premier
//     bloc de tests refuse.
//   * Aucune couleur nouvelle n'entre par cette porte. test/apca-check.py mesure les hex
//     de couleurs.css et de print.css, pas ceux d'une feuille écrite dans un filtre : la
//     seule discipline qui tienne est de n'employer ici que des couleurs déjà déclarées et
//     déjà argumentées dans print.css. Le test le vérifie hex par hex.
//   * Un seul cas est signalé en rouge, et c'est le même que celui que l'export OJS
//     refuse : image sans texte alternatif, sans légende de repli et sans déclaration
//     « décorative ». Tout le reste — un tableau sans en-tête, une description longue non
//     renseignée, une image déclarée décorative — est une absence LÉGITIME, montrée sans
//     couleur d'alerte. Un jour où quelqu'un ajouterait un second encadré rouge, ce test
//     l'arrête et lui fait relire cette phrase.
//   * Tout ce que lit un rédacteur existe en français ET en allemand (orthographe suisse :
//     « ss », jamais « ß »), plus l'italien et l'anglais, comme les libellés de figure.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');
const MODULE = path.join(FILTRES, 'szh-apercu-lecteur-ecran.lua');
const NUMEROTATION = path.join(FILTRES, 'szh-numerotation.lua');
const PRINT_CSS = path.join(RACINE, 'pipeline', 'styles', 'print.css');

const lire = (p) => fs.readFileSync(p, 'utf8');

// Lignes de commentaire retirées : ces filtres sont très commentés, et les commentaires
// CITENT le code (« chargé par dofile », « aucune balise en <table »). Compter dedans, ce
// serait compter deux fois et voir des fautes dans les phrases qui les interdisent.
// Seules les lignes ENTIÈREMENT en commentaire partent : un « -- » de fin de ligne
// couperait « var(--c-rule) » dans la feuille de style.
const sansCommentaires = (lua) => lua.split('\n')
  .filter((ligne) => !/^\s*--/.test(ligne)).join('\n');

const source = sansCommentaires(lire(MODULE));
const numerotation = sansCommentaires(lire(NUMEROTATION));
const printCss = lire(PRINT_CSS);

// Les marques que ces encadrés posent dans le HTML. Aucune ne doit exister ailleurs.
const CLASSES = ['szh-lecteur-ecran', 'szh-le-entete', 'szh-le-ligne', 'szh-le-tag',
                 'szh-le-note', 'szh-le-absent', 'szh-le-vide', 'szh-le-manque'];

// ---- Le PDF n'en porte aucune trace ----

test('le module des encadrés n’est chargé que sous SZH_APERCU', () => {
  assert.match(numerotation, /local APERCU = \(os\.getenv\('SZH_APERCU'\) or ''\) ~= ''/,
    'szh-numerotation.lua doit lire SZH_APERCU comme szh-citations.lua');
  // Le dofile vit dans le `if APERCU then`, et nulle part ailleurs.
  const garde = numerotation.match(/if APERCU then[\s\S]*?\nend\n/);
  assert.ok(garde, 'aucun bloc « if APERCU then » dans szh-numerotation.lua');
  assert.match(garde[0], /dofile/, 'le chargement du module doit être dans la garde');
  const dofiles = numerotation.match(/dofile/g) || [];
  assert.strictEqual(dofiles.length, 1,
    'un seul dofile : un second pourrait s’exécuter hors de la garde');
  assert.match(garde[0], /szh-apercu-lecteur-ecran\.lua/);
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
  // de l’encadré qui commencerait par ces lettres (<tableau…>) lui repasserait sous le nez.
  const balises = source.match(/<[a-zA-Z][a-zA-Z0-9-]*/g) || [];
  for (const b of balises) {
    assert.ok(!/^<table/i.test(b), 'balise interdite : ' + b);
  }
});

// ---- Aucune couleur nouvelle ----

test('les couleurs de l’encadré sont toutes déjà déclarées dans print.css', () => {
  // print.css est lu par test/apca-check.py ; une feuille écrite dans un filtre ne l’est
  // pas. On n’emploie donc ici que des hex qui existent déjà là-bas, avec leur mesure.
  const hex = [...new Set((source.match(/#[0-9A-Fa-f]{3,6}/g) || [])
    .map((h) => h.toLowerCase()))];
  assert.ok(hex.length > 0, 'aucune couleur trouvée : le test ne contrôle plus rien');
  const cssMinuscule = printCss.toLowerCase();
  for (const h of hex) {
    assert.ok(cssMinuscule.includes(h),
      h + ' n’existe pas dans print.css : une couleur qu’aucune mesure APCA ne couvre. '
      + 'Reprendre un hex déjà argumenté là-bas, ou faire mesurer celui-ci.');
  }
  // Les variables de palette employées doivent exister aussi.
  for (const v of new Set(source.match(/var\((--[\w-]+)/g) || [])) {
    const nom = v.slice(4);
    assert.ok(printCss.includes(nom + ':'), nom + ' n’est pas un jeton de print.css');
  }
});

test('le texte de l’encadré d’alerte est à l’encre, jamais au rouge', () => {
  // Mesuré avec pipeline/apca.py : #b3261e sur #fdecea ne vaut que Lc 71,7 — sous le
  // seuil de 90 de tout texte de cette maquette. L’encre y vaut 95,6. Le rouge ne porte
  // donc que le filet et l’aplat, qui ne sont pas du texte (seuil 30).
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
  // Un seul APPEL au témoin d’alerte : sa définition ne compte pas.
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
  // lib/references.js : imagesSansAlternative() = pas d’attribut alt ET pas de légende de
  // repli. L’encadré montre exactement ce cas, beaucoup plus tôt. Si le contrat change
  // là-bas, il faut revenir ici.
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
  // Le corpus d’accessibilité explique en commentaire qu’« aucun <th scope> n’existe » :
  // sans ce retrait, le compte trouvait un en-tête dans la phrase qui dit qu’il n’y en a
  // pas, et un tableau parfaitement conforme se voyait reprocher une portée manquante.
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
  // ALT= et DESCRIPTION= nomment la CASE du formulaire où la valeur a été saisie ; les
  // traduire les couperait de lib/i18n.js, où le rédacteur lit « Texte alternatif » /
  // « Alternativtext » au-dessus du même champ. Toute la prose, elle, est traduite.
  assert.match(source, /etiq\('ALT='\)/);
  assert.match(source, /etiq\('DESCRIPTION='\)/);
  const t = tables();
  for (const langue of Object.keys(t)) {
    assert.ok(!t[langue].texte.includes('ALT='),
      'ALT= ne doit pas être traduit (' + langue + ')');
  }
});
