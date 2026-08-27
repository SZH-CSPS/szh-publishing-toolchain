// Le socle CSS : une variable se déclare à un seul endroit.
//
//   node --test "test/js/*.test.js"
//
// pipeline/styles/socle.css porte les polices et les jetons :root ; print.css ne porte plus
// que de la mise en page. La maquette web lira le même socle. Ce qui se casserait sans ces
// contrôles, et qui se casse toujours de la même façon :
//
//   * quelqu'un redéclare un jeton dans print.css « pour aller vite ». Deux définitions,
//     dont une seule est lue par test/apca-check.py — et la maquette web hérite de l'autre ;
//   * l'empilement des --css change d'ordre. out/.szh-accent.css surcharge les replis gris
//     du socle : empilé avant lui, il n'a aucun effet et tout un numéro s'imprime en gris,
//     sans qu'aucune erreur ne soit levée ;
//   * le socle devient surchargeable par revue, comme print.css l'est. Un dossier qui porte
//     son propre socle dérive en silence de la maquette, et personne ne le voit avant
//     l'impression.
//
// Vérifié à l'extraction : les 38 pages du banc et de la mini-revue de test rendent des PNG
// identiques au pixel, avant et après le déplacement.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

const SOCLE = lire('pipeline', 'styles', 'socle.css');
const PRINT = lire('pipeline', 'styles', 'print.css');
const MAKEFILE = lire('pipeline', 'Makefile');

// Commentaires retirés : ces feuilles sont très commentées, et leurs commentaires citent
// des noms de jetons et des règles qui seraient pris pour des déclarations.
const sansCommentaires = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SOCLE_NU = sansCommentaires(SOCLE);
const PRINT_NU = sansCommentaires(PRINT);

// ---- Ce que le socle porte ----

test('socle : les polices et les jetons y sont, et le corps de la maquette avec', () => {
  assert.match(SOCLE_NU, /@font-face/, 'les @font-face ont quitté le socle');
  assert.match(SOCLE_NU, /:root\s*\{/, 'le bloc :root a quitté le socle');
  // Un échantillon des jetons dont dépendent la mise en page ET les mesures APCA. Chacun
  // est lu ailleurs : --body-size et --leading par la typographie, les encres par
  // apca-check.py, --c-annual par accent-css.py, qui les surcharge.
  for (const jeton of ['--font-sans', '--title-family', '--body-size', '--leading',
                       '--c-ink', '--c-ink2', '--c-ink3', '--c-rule', '--c-nuit',
                       '--c-annual', '--c-annual-ui']) {
    assert.ok(SOCLE_NU.includes(jeton + ':'), jeton + ' n’est plus déclaré dans le socle');
  }
});

test('socle : les chemins de polices restent relatifs au dossier styles/', () => {
  // src: url("../fonts/…") se résout par rapport au FICHIER CSS. socle.css vit dans le même
  // dossier que print.css, donc les chemins d'origine tombent juste — mais déplacer le
  // fichier d'un cran les casserait toutes, en silence : WeasyPrint composerait en police
  // de repli sans rien dire.
  assert.match(SOCLE_NU, /url\("\.\.\/fonts\//,
    'les @font-face ne pointent plus sur ../fonts/ : socle.css a-t-il changé de dossier ?');
});

// ---- Ce que print.css ne doit plus porter ----

test('print.css ne redéclare ni police ni jeton :root', () => {
  assert.doesNotMatch(PRINT_NU, /@font-face/,
    'un @font-face est revenu dans print.css : la police serait déclarée deux fois, et la maquette web hériterait de l’autre');
  assert.doesNotMatch(PRINT_NU, /(^|[\s},])\:root\s*\{/,
    'un bloc :root est revenu dans print.css : c’est exactement la duplication que le socle existe pour éviter');
});

// ---- L'empilement, dont l'ordre est porteur ----

test('le Makefile empile socle, puis la feuille de sortie, puis l’accent annuel', () => {
  const empilements = MAKEFILE.match(/--css="[^\n]*/g) || [];
  assert.strictEqual(empilements.length, 2,
    'le nombre de chaînes qui empilent des feuilles a changé : PDF et aperçu, il en faut deux');
  for (const ligne of empilements) {
    const rangSocle = ligne.indexOf('SOCLE_ABS');
    const rangStyle = ligne.indexOf('STYLE_ABS');
    const rangAccent = ligne.indexOf('ACCENT_ABS');
    assert.ok(rangSocle !== -1, 'une chaîne n’empile pas le socle : ses jetons seraient absents');
    assert.ok(rangSocle < rangStyle,
      'le socle passe après la feuille de sortie : celle-ci lirait des jetons pas encore déclarés');
    assert.ok(rangStyle < rangAccent,
      'l’accent annuel n’est plus en dernier : il ne surchargerait plus les replis gris, et le numéro s’imprimerait en gris sans un mot');
  }
});

test('le socle vient du toolkit, jamais du dossier de revue', () => {
  // print.css, lui, est surchargeable par revue (firstword d'un wildcard local). Pas le
  // socle : une revue qui redéfinirait les jetons dériverait de la maquette en silence.
  assert.match(MAKEFILE, /SOCLE\s*:=\s*\$\(PIPELINE_DIR\)\/styles\/socle\.css/,
    'le socle est devenu surchargeable par revue, ou a changé de chemin');
  assert.doesNotMatch(MAKEFILE, /wildcard styles\/socle\.css/,
    'un socle local de revue est désormais accepté : c’est la porte ouverte à une maquette par dossier');
});

test('changer le socle recompile les articles', () => {
  // Sans ce prérequis, retoucher une encre ou une taille ne déclencherait rien : make
  // trouverait les .html à jour, et le numéro sortirait avec l’ancienne maquette.
  const prerequis = MAKEFILE.match(/^\$\(OUT\)\/%\.(html|apercu\.html):[^\n]*/gm) || [];
  assert.strictEqual(prerequis.length, 2, 'les deux rendus HTML ne sont plus reconnaissables');
  for (const ligne of prerequis) {
    assert.ok(ligne.includes('$(SOCLE)'),
      'un rendu HTML n’a pas le socle en prérequis : le modifier ne recompilerait rien');
  }
});
