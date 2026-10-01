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

test('print.css ne redéclare aucun jeton du socle', () => {
  assert.doesNotMatch(PRINT_NU, /@font-face/,
    'un @font-face est revenu dans print.css : la police serait déclarée deux fois, et la maquette web hériterait de l’autre');
  // print.css porte désormais son propre :root (09.09.2026) : la géométrie PAGINÉE — marges
  // de @page, hero — qui n'a justement pas sa place au socle (« une boîte, une marge, un
  // @page… appartiennent à la feuille de leur média », socle.css §0). Le contrat n'est donc
  // plus « aucun :root ici », qui interdirait cette séparation légitime, mais « aucun jeton
  // du socle n'y est REDÉCLARÉ » : c'est précisément la duplication que le socle existe
  // pour éviter, et elle se juge au nom du jeton, pas à la présence du sélecteur.
  const jetonsDe = (css) => {
    const jetons = new Set();
    for (const bloc of css.match(/:root\s*\{[^}]*\}/g) || []) {
      for (const m of bloc.matchAll(/(--[\w-]+)\s*:/g)) jetons.add(m[1]);
    }
    return jetons;
  };
  const jetonsSocle = jetonsDe(SOCLE_NU);
  const doublons = [...jetonsDe(PRINT_NU)].filter((j) => jetonsSocle.has(j));
  assert.deepStrictEqual(doublons, [],
    'jeton(s) du socle redéclaré(s) dans le :root de print.css : ' + doublons.join(', '));
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

// Marqueurs de liste : de vrais ::marker, que WeasyPrint balise en /Lbl (30.09.2026). Un
// ::before laissait des /LI sans /Lbl. Le marqueur extérieur se colle au bord gauche du <li>
// à sa largeur naturelle : le retrait se partage donc entre la liste (largeur du marqueur) et
// l'élément (le reste), et la somme doit rester le retrait du texte d'avant.
test('listes : marqueurs ::marker, et retraits qui se somment à 1,5 em et 1,7 em', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  assert.ok(!/(^|[\s,])(ul|ol)\s*>\s*li::before/m.test(css), 'un marqueur de liste en ::before est revenu');
  assert.match(css, /ul > li::marker\s*\{/);
  assert.match(css, /ol > li::marker\s*\{/);
  const em = (sel, prop) => {
    // Les règles dont le sélecteur est exactement `sel`, en début de ligne : la première qui
    // déclare `prop` (li en a plusieurs).
    const tete = '\n' + sel + ' {';
    for (let i = css.indexOf(tete); i !== -1; i = css.indexOf(tete, i + 1)) {
      const corps = css.slice(i + tete.length, css.indexOf('}', i));
      const v = corps.match(new RegExp(prop + ':\\s*(-?[\\d.]+)em'));
      if (v) return parseFloat(v[1]);
    }
    return assert.fail(prop + ' introuvable dans une règle « ' + sel + ' »');
  };
  const somme = (a, b) => Math.round((a + b) * 1e6) / 1e6;
  assert.strictEqual(somme(em('ul', 'padding-left'), em('li', 'padding-left')), 1.5);
  assert.strictEqual(somme(em('ol', 'padding-left'), em('ol > li', 'padding-left')), 1.7);
  assert.strictEqual(somme(em('blockquote ol', 'padding-left'), em('blockquote ol > li', 'padding-left')), 1.7);
});

// Point médian entre auteur·e·s : un FOND, jamais un caractère (30.09.2026). Écrit en
// `content`, il entrait dans l'arbre de structure et se lisait entre deux noms ; un fond est
// un artefact. Le fill du SVG doit rester la couleur que test/apca-check.py mesure.
test('point médian des auteur·e·s : un fond, et du même gris que celui que mesure apca-check', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  const regle = css.match(/\n\.szh-authors li \+ li::before \{([^}]*)\}/);
  assert.ok(regle, 'règle .szh-authors li + li::before introuvable');
  const contenu = regle[1].match(/content:\s*"([^"]*)"/);
  assert.ok(contenu, 'content introuvable');
  assert.ok(!/\\B7|·/i.test(contenu[1]), 'le point médian est redevenu un caractère : ' + contenu[1]);
  const couleur = regle[1].match(/color:\s*(#[0-9A-Fa-f]{6})/);
  const fill = regle[1].match(/fill='%23([0-9A-Fa-f]{6})'/);
  assert.ok(couleur && fill, 'couleur ou fill introuvable');
  assert.strictEqual('#' + fill[1].toUpperCase(), couleur[1].toUpperCase());
});
