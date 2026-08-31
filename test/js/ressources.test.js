// lib/ressources.js : les fiches de « ressources » (livres, films, …) d'un article, et la
// garantie que sa table TYPES ne diverge pas de celle recopiée dans
// pipeline/filters/szh-ressource.lua — même discipline que contrats.test.js pour les
// grilles (lib/references.js / szh-grille.lua).
//
//   node --test test/js/ressources.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const res = require(path.join(COCKPIT, 'lib', 'ressources.js'));

const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// ---- Table des types : lecture ----

test('types : livre et film portent les champs complets voulus par le cahier des charges', () => {
  assert.deepStrictEqual(res.champsBiblio('livre'), ['auteurs', 'annee', 'editeur']);
  assert.deepStrictEqual(res.champsBiblio('film'), ['realisateur', 'annee', 'genre', 'pays']);
  assert.deepStrictEqual(res.typesConnus().sort(), ['film', 'livre']);
  assert.deepStrictEqual(res.tousLesChamps('livre'),
    ['titre', 'auteurs', 'annee', 'editeur', 'lien', 'descriptif', 'image']);
});

test('types : un type inconnu ne porte aucun champ bibliographique, et n’est pas valide', () => {
  assert.deepStrictEqual(res.champsBiblio('inconnu'), []);
  assert.strictEqual(res.typeValide('inconnu'), false);
  assert.strictEqual(res.typeValide('livre'), true);
  assert.strictEqual(res.typeValide('film'), true);
});

// ---- Champs requis ----

test('requis : titre, descriptif et image manquent tant qu’ils sont vides', () => {
  assert.deepStrictEqual(res.champsManquants('livre', {}), ['titre', 'descriptif', 'image']);
  assert.deepStrictEqual(res.champsManquants('livre',
    { titre: 'X', descriptif: 'Y', image: 'z.png' }), []);
  assert.strictEqual(res.ressourceComplete('livre', { titre: 'X', descriptif: 'Y', image: 'z.png' }), true);
  // La bibliographie et le lien ne bloquent jamais l’écriture : recommandés, pas requis.
  assert.strictEqual(res.ressourceComplete('livre',
    { titre: 'X', descriptif: 'Y', image: 'z.png', auteurs: '', annee: '', editeur: '', lien: '' }), true);
});

test('requis : un type inconnu manque toujours de tout, même rempli', () => {
  assert.deepStrictEqual(res.champsManquants('bd', { titre: 'X', descriptif: 'Y', image: 'z.png' }),
    ['titre', 'descriptif', 'image']);
});

// ---- Aller-retour bloc ----

test('bloc : écrire puis relire une fiche livre rend les mêmes valeurs', () => {
  const valeurs = {
    titre: 'Le silence des bêtes', auteurs: 'Jean Dupont, Marie Martin',
    annee: '2019', editeur: 'Éditions XYZ', lien: 'https://exemple.org/livre',
    descriptif: 'Un texte qui présente l’ouvrage.', image: 'couverture-x.jpg'
  };
  const texte = res.ajouterRessource('', 'r1', 'livre', valeurs);
  const liste = res.lireRessources(texte);
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].id, 'r1');
  assert.strictEqual(liste[0].type, 'livre');
  assert.deepStrictEqual(liste[0].valeurs, valeurs);
});

test('bloc : un titre à guillemets fait l’aller-retour ; une accolade y est ôtée', () => {
  // Même règle que normaliserValeurFigure (lib/references.js), réutilisée ici : une
  // accolade dans un attribut casserait silencieusement le bloc {…} qui le porte, comme un
  // copyright ou une source de figure. Le titre et la bibliographie n'échappent pas à
  // cette règle, faute de quoi une fiche pourrait devenir illisible pour le filtre Lua.
  const valeurs = {
    titre: 'Titre avec « guillemets » et accolades', auteurs: 'A "surnommé" B',
    annee: '2020', editeur: 'X & Y', lien: '',
    descriptif: 'Une description sur\nplusieurs lignes, avec des "guillemets".',
    image: 'x.png'
  };
  const texte = res.ajouterRessource('', 'r2', 'livre', valeurs);
  const relu = res.lireRessources(texte)[0].valeurs;
  assert.strictEqual(relu.titre, valeurs.titre);
  assert.strictEqual(relu.auteurs, valeurs.auteurs);
  assert.strictEqual(relu.descriptif, valeurs.descriptif);
});

test('bloc : une accolade dans le titre ne casse pas la ligne d’ouverture du bloc', () => {
  const texte = res.ajouterRessource('', 'r2b', 'livre',
    { titre: 'Un titre { cassant }', descriptif: 'd', image: 'i.png' });
  assert.strictEqual(res.lireRessources(texte).length, 1, 'le bloc n’a pas pu être relu');
});

test('bloc : le lien facultatif, absent, ne laisse aucun attribut lien=', () => {
  const texte = res.ajouterRessource('', 'r3', 'livre',
    { titre: 'T', descriptif: 'D', image: 'i.png', auteurs: '', annee: '', editeur: '', lien: '' });
  assert.ok(!/lien=/.test(texte.split('\n')[0]), 'lien="" écrit malgré une valeur vide');
});

test('bloc : film porte réalisateur, année, genre et pays', () => {
  const valeurs = {
    titre: 'Un film', realisateur: 'Jeanne Réal', annee: '2021', genre: 'Documentaire',
    pays: 'Suisse', lien: 'https://exemple.org/bande-annonce',
    descriptif: 'Descriptif du film.', image: 'affiche.jpg'
  };
  const texte = res.ajouterRessource('', 'f1', 'film', valeurs);
  const relu = res.lireRessources(texte)[0];
  assert.strictEqual(relu.type, 'film');
  assert.deepStrictEqual(relu.valeurs, valeurs);
});

test('bloc : image toujours écrite avec alt="" — décorative par construction', () => {
  const texte = res.ajouterRessource('', 'r4', 'livre',
    { titre: 'T', descriptif: 'D', image: 'couv.png' });
  assert.match(texte, /!\[\]\(media\/couv\.png\)\{alt=""\}/);
});

// ---- Plusieurs fiches : ordre, identité, écriture ciblée ----

test('plusieurs fiches : ajoutées à la suite, dans l’ordre de saisie', () => {
  let texte = '';
  texte = res.ajouterRessource(texte, 'a', 'livre', { titre: 'Premier', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'b', 'film', { titre: 'Second', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'c', 'livre', { titre: 'Troisième', descriptif: 'd', image: 'i.png' });
  const liste = res.lireRessources(texte);
  assert.deepStrictEqual(liste.map((r) => r.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(liste.map((r) => r.valeurs.titre), ['Premier', 'Second', 'Troisième']);
});

test('plusieurs fiches : ajouter n’abîme pas le texte qui suit déjà dans l’article', () => {
  const avant = '# Documentation\n\nUn paragraphe avant.\n';
  const texte = res.ajouterRessource(avant, 'a', 'livre', { titre: 'T', descriptif: 'd', image: 'i.png' });
  assert.match(texte, /Un paragraphe avant\./);
  assert.match(texte, /szh-ressource/);
});

test('écriture ciblée : ecrireRessource ne touche qu’une seule fiche parmi plusieurs', () => {
  let texte = '';
  texte = res.ajouterRessource(texte, 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'b', 'livre', { titre: 'Deux', descriptif: 'd', image: 'i.png' });
  const r = res.ecrireRessource(texte, 'b', 'livre', { titre: 'Deux modifié', descriptif: 'd2', image: 'i2.png' });
  assert.strictEqual(r.ok, true);
  const liste = res.lireRessources(r.texte);
  assert.strictEqual(liste[0].valeurs.titre, 'Un', 'la première fiche a bougé');
  assert.strictEqual(liste[1].valeurs.titre, 'Deux modifié');
  assert.strictEqual(liste[1].valeurs.image, 'i2.png');
});

test('écriture ciblée : ecrireRessource sur un identifiant disparu échoue proprement', () => {
  const texte = res.ajouterRessource('', 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  const r = res.ecrireRessource(texte, 'disparu', 'livre', { titre: 'X', descriptif: 'd', image: 'i.png' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.texte, texte, 'le texte ne doit pas bouger en cas d’échec');
});

test('retrait : retirerRessource ôte la fiche visée et garde les autres et leur ordre', () => {
  let texte = '';
  texte = res.ajouterRessource(texte, 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'b', 'livre', { titre: 'Deux', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'c', 'livre', { titre: 'Trois', descriptif: 'd', image: 'i.png' });
  const r = res.retirerRessource(texte, 'b');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(res.lireRessources(r.texte).map((x) => x.id), ['a', 'c']);
  assert.doesNotMatch(r.texte, /Deux/);
  // Pas de double ligne vide laissée par la coupe.
  assert.doesNotMatch(r.texte, /\n\n\n/);
});

test('retrait : un identifiant disparu échoue sans toucher au texte', () => {
  const texte = res.ajouterRessource('', 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  const r = res.retirerRessource(texte, 'zzz');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.texte, texte);
});

// ---- Un bloc qui n'est pas une ressource, ou laissé ouvert, ne trompe pas la lecture ----

test('lecture : un fenced div d’un autre genre est ignoré', () => {
  const texte = '::: {.szh-grille disposition="2-2"}\n![](media/a.png)\n![](media/b.png)\n:::\n';
  assert.deepStrictEqual(res.lireRessources(texte), []);
});

test('lecture : un bloc laissé ouvert (pas de fermeture) n’est pas lu', () => {
  const texte = '::: {.szh-ressource type="livre" titre="X"}\nDescriptif sans fermeture\n';
  assert.deepStrictEqual(res.lireRessources(texte), []);
});

test('lecture : un identifiant absent reçoit un repli stable pour la durée d’une lecture', () => {
  const texte = '::: {.szh-ressource type="livre" titre="Sans id"}\nD\n\n![](media/i.png){alt=""}\n:::\n';
  const liste = res.lireRessources(texte);
  assert.strictEqual(liste.length, 1);
  assert.ok(liste[0].id, 'aucun identifiant de repli');
});

// ---- Non-divergence avec pipeline/filters/szh-ressource.lua ----
//
// Le formulaire ne doit jamais écrire un champ que le rendu ignore, ni l’inverse : les deux
// tables (lib/ressources.js TYPES, szh-ressource.lua TYPES) doivent rester identiques, comme
// szh-grille.lua pour les dispositions (voir contrats.test.js). La table Lua est recopiée à
// la main ; ce test la relit comme un texte et vérifie qu’elle porte, mot pour mot, ce que
// la table JS décrit.

test('szh-ressource.lua : la table TYPES est la même que dans lib/ressources.js', () => {
  const lua = lire('pipeline', 'filters', 'szh-ressource.lua');
  for (const type of res.typesConnus()) {
    const champs = res.champsBiblio(type);
    const attendu = type + ' = { ' + champs.map((c) => "'" + c + "'").join(', ') + ' },';
    assert.ok(lua.includes(attendu),
      'szh-ressource.lua ne porte pas la même ligne pour le type ' + type + ' : ' + attendu);
  }
  assert.ok(lua.includes("local CLASSE = '" + res.CLASSE + "'"),
    'szh-ressource.lua ne connaît pas la classe ' + res.CLASSE);
});

test('szh-ressource.lua : aucun type de lib/ressources.js n’est absent de la table Lua, et réciproquement', () => {
  const lua = lire('pipeline', 'filters', 'szh-ressource.lua');
  const bloc = (lua.match(/local TYPES = \{([\s\S]*?)\n\}/) || [])[1] || '';
  const typesLua = Array.from(bloc.matchAll(/^\s*([a-zA-Z_][\w]*)\s*=/gm)).map((m) => m[1]);
  assert.deepStrictEqual(typesLua.sort(), res.typesConnus().sort(),
    'les types déclarés dans szh-ressource.lua et lib/ressources.js divergent');
});

test('szh-ressource.lua : branché avant szh-numerotation (l’image doit lui arriver nue)', () => {
  const makefile = lire('pipeline', 'Makefile');
  const lignes = makefile.split('\n');
  const rang = (nom) => lignes.reduce((acc, l, i) => (l.includes('filters/' + nom) ? acc.concat(i) : acc), []);
  const ressource = rang('szh-ressource.lua');
  const numerotation = rang('szh-numerotation.lua');
  assert.strictEqual(ressource.length, 2, 'szh-ressource.lua n’est pas branché dans les deux chaînes');
  assert.strictEqual(numerotation.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.ok(ressource[i] < numerotation[i],
      'szh-ressource.lua doit précéder szh-numerotation.lua : l’image décorative doit lui arriver nue');
  }
});

test('print.css : les règles de mise en page des fiches sont posées', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  for (const regle of ['.szh-ressource-corps', '.szh-ressource-texte', '.szh-ressource-image',
    '.szh-ressource-titre']) {
    assert.ok(css.includes(regle), 'règle absente de print.css : ' + regle);
  }
  // L’image doit rester au quart de la largeur : la formule auto-générée par
  // szh-numerotation.lua (en_decor) pour une figure pleine colonne doit être annulée ici,
  // pas dans socle.css ni livre/base.css (hors périmètre de ce lot).
  assert.match(css, /\.szh-ressource-image\s*>?\s*\.szh-decor/,
    'la largeur du décor n’est pas reprise en main pour le quart de colonne');
});
