// La couleur annuelle d'un numéro : elle avance d'un cran chaque année, dans l'ordre
// alphabétique de COULEURS_NUMERO, et boucle sur les six teintes.
//
//   node --test "test/js/*.test.js"
//
// couleurAnnuelle() (lib/yaml.js) est la seule source de vérité côté cockpit ; elle a un
// miroir en PowerShell (Get-SzhCouleurPour, windows/szh-produits.ps1) que new-revue.ps1
// utilise à la création d'un numéro. Les deux tables d'ancres doivent dire la même chose —
// le dernier contrôle ci-dessous les compare en lisant le fichier PowerShell en texte, sans
// recopier ses valeurs à la main : une copie qui ne se vérifie pas finit par dormir.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

const HEX = {};
for (const c of yaml.COULEURS_NUMERO) { HEX[c.cle] = c.hex; }

// ---- Les deux ancres de la rédaction ----

test('2026 : Zeitschrift bleu acier, Revue poireau', () => {
  assert.strictEqual(yaml.couleurAnnuelle('zeitschrift', 2026), HEX.bleuacier,
    'l’ancre de la Zeitschrift (vol. 32, réellement paru) ne rend pas le bleu acier');
  assert.strictEqual(yaml.couleurAnnuelle('revue', 2026), HEX.poireau,
    'l’ancre de la Revue (vol. 16, réellement paru) ne rend pas le poireau');
});

// ---- L'année suivante ----

test('2027 : Zeitschrift capucine, Revue rouge', () => {
  assert.strictEqual(yaml.couleurAnnuelle('zeitschrift', 2027), HEX.capucine,
    'la couleur n’avance pas d’un cran pour la Zeitschrift');
  assert.strictEqual(yaml.couleurAnnuelle('revue', 2027), HEX.rouge,
    'la couleur n’avance pas d’un cran pour la Revue');
});

// ---- Le bouclage ----

test('2032 = 2026 + six ans : retour à la couleur de l’ancre, pour les deux revues', () => {
  assert.strictEqual(yaml.couleurAnnuelle('zeitschrift', 2032), HEX.bleuacier,
    'six ans plus tard, la Zeitschrift ne revient pas à sa couleur de départ');
  assert.strictEqual(yaml.couleurAnnuelle('revue', 2032), HEX.poireau,
    'six ans plus tard, la Revue ne revient pas à sa couleur de départ');
});

// ---- Avant l'ancre : le piège du modulo négatif ----

test('2025 : la couleur précédente, pas un modulo négatif qui sort de la palette', () => {
  assert.strictEqual(yaml.couleurAnnuelle('zeitschrift', 2025), HEX.rouge,
    'l’année qui précède l’ancre de la Zeitschrift devrait rendre rouge (le cran juste avant bleuacier)');
  assert.strictEqual(yaml.couleurAnnuelle('revue', 2025), HEX.moutarde,
    'l’année qui précède l’ancre de la Revue devrait rendre moutarde (le cran juste avant poireau)');
});

// ---- Revue ou année illisibles ----

test('revue inconnue ou année illisible : jamais une couleur au hasard', () => {
  assert.strictEqual(yaml.couleurAnnuelle('livre', 2026), '', 'une revue hors zeitschrift/revue devrait rendre une chaîne vide');
  assert.strictEqual(yaml.couleurAnnuelle('', 2026), '', 'une revue vide devrait rendre une chaîne vide');
  assert.strictEqual(yaml.couleurAnnuelle('revue', NaN), '', 'une année NaN devrait rendre une chaîne vide');
  assert.strictEqual(yaml.couleurAnnuelle('revue', 'abc'), '', 'une année illisible devrait rendre une chaîne vide');
});

// ---- L'ordre de la palette, prouvé par le tri lui-même ----

test('COULEURS_NUMERO est trié par ordre alphabétique de sa clé', () => {
  const cles = yaml.COULEURS_NUMERO.map((c) => c.cle);
  const triees = cles.slice().sort((a, b) => a.localeCompare(b, 'fr'));
  assert.deepStrictEqual(cles, triees,
    'l’ordre de COULEURS_NUMERO ne suit plus l’ordre alphabétique de ses clés');
});

// ---- Plus de bouton « (aucune) » ----

test('lib/i18n.js ne porte plus aucune clé meta.couleur.aucune', () => {
  const texte = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  assert.doesNotMatch(texte, /meta\.couleur\.aucune/,
    'la clé du bouton « (aucune) » traîne encore dans lib/i18n.js');
});

// ---- Les noms de couleurs ne se traduisent pas ----

test('les six meta.couleur.<cle> valent la même chose en français et en allemand', () => {
  const texte = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  const blocs = texte.split(/^\s*(fr|de):\s*\{/m);
  // blocs[0] = avant « fr: { » ; blocs[1] = 'fr' ; blocs[2] = contenu jusqu'à 'de: {' ; etc.
  const trouverBloc = (langue) => {
    const i = blocs.indexOf(langue);
    assert.ok(i !== -1, 'bloc « ' + langue + ': { » introuvable dans lib/i18n.js');
    return blocs[i + 1];
  };
  const extraireCouleurs = (bloc) => {
    const table = {};
    const re = /'meta\.couleur\.([a-z]+)':\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(bloc)) !== null) { table[m[1]] = m[2]; }
    return table;
  };
  const fr = extraireCouleurs(trouverBloc('fr'));
  const de = extraireCouleurs(trouverBloc('de'));
  assert.deepStrictEqual(Object.keys(fr).sort(), yaml.COULEURS_NUMERO.map((c) => c.cle).slice().sort(),
    'le bloc fr ne porte pas exactement les six clés de couleur attendues');
  assert.deepStrictEqual(fr, de,
    'les noms de couleurs diffèrent encore entre le français et l’allemand');
});

// ---- La table PowerShell dit la même chose que la table JS ----

test('Get-SzhCouleurPour (windows/szh-produits.ps1) porte les mêmes ancres que couleurAnnuelle (lib/yaml.js)', () => {
  const ps = lire('windows', 'szh-produits.ps1');
  const m = ps.match(/\$script:SzhCouleurAnneeAncre\s*=\s*@\{([\s\S]*?)\n\}/);
  assert.ok(m, 'table $script:SzhCouleurAnneeAncre introuvable dans windows/szh-produits.ps1');
  const corps = m[1];
  const ancres = {};
  const re = /(zeitschrift|revue)\s*=\s*@\{\s*annee\s*=\s*(\d+);\s*cle\s*=\s*'([a-z]+)'\s*\}/g;
  let mm;
  while ((mm = re.exec(corps)) !== null) { ancres[mm[1]] = { annee: Number(mm[2]), cle: mm[3] }; }
  assert.deepStrictEqual(Object.keys(ancres).sort(), ['revue', 'zeitschrift'],
    'les deux revues ne sont pas toutes deux ancrées côté PowerShell');
  for (const revue of ['zeitschrift', 'revue']) {
    const ancre = ancres[revue];
    assert.strictEqual(yaml.couleurAnnuelle(revue, ancre.annee), HEX[ancre.cle],
      'l’ancre PowerShell de ' + revue + ' (' + ancre.annee + ' = ' + ancre.cle + ') ' +
      'ne correspond pas à ce que rend couleurAnnuelle côté cockpit — les deux tables ont divergé');
  }
});
