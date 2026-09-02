// lib/rubriques.js : les rubriques de texte riche d'un article (dossier-references,
// dossier-liens, tour-horizon, ressources, podcasts), et la garantie que sa liste
// TYPES_RUBRIQUE ne diverge pas de la table TITRES recopiée dans
// pipeline/filters/szh-rubrique.lua — même discipline que ressources.test.js pour
// lib/ressources.js / szh-ressource.lua.
//
//   node --test test/js/rubriques.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
// Le saut de ligne, nommé : ces tests construisent du markdown multiligne.
const NL = String.fromCharCode(10);
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const rub = require(path.join(COCKPIT, 'lib', 'rubriques.js'));
const res = require(path.join(COCKPIT, 'lib', 'ressources.js'));

// ---- Table des types ----

test('types : les cinq jetons de prose, dans l’ordre d’affichage du formulaire', () => {
  assert.deepStrictEqual(rub.TYPES_RUBRIQUE, [
    'dossier-references', 'dossier-liens', 'tour-horizon', 'ressources', 'podcasts'
  ]);
  for (const t of rub.TYPES_RUBRIQUE) { assert.strictEqual(rub.typeValide(t), true, t + ' devrait être valide'); }
});

test('types : typesConnus() rend une copie, pas la table elle-même', () => {
  const copie = rub.typesConnus();
  assert.deepStrictEqual(copie, rub.TYPES_RUBRIQUE);
  assert.notStrictEqual(copie, rub.TYPES_RUBRIQUE, 'typesConnus() doit rendre une COPIE du tableau');
  copie.push('intrus');
  assert.strictEqual(rub.TYPES_RUBRIQUE.length, 5, 'muter la copie a muté la table d’origine');
});

// L'agenda a QUITTÉ les rubriques le 02.09.2026 pour devenir un type de fiche
// (lib/ressources.js, TYPES.agenda) : « Agenda et formation doit devenir un champ structuré
// (date / plage de date / type d'événement…) ». Ce qui compte ici est la dégradation : un
// ancien bloc de prose laissé dans un .md se relit encore et se retire encore — ce module ne
// valide pas le type qu'on lui passe — mais il n'est plus COMPLET, donc plus proposé, et le
// filtre ne lui donne plus de titre. Rien ne se perd, rien ne s'imprime en double.
test('agenda : plus une rubrique, mais un ancien bloc reste lisible et retirable', () => {
  assert.strictEqual(rub.typeValide('agenda'), false, 'l’agenda n’est plus un type de rubrique');
  assert.deepStrictEqual(rub.champsManquants('agenda', 'Un texte pourtant présent.'), ['contenu'],
    'un type qui n’est plus proposé ne peut plus être complet');
  const ancien = '::: {#vieux .szh-rubrique type="agenda"}' + NL + 'Colloque à Berne.' + NL + ':::' + NL;
  const lues = rub.lireRubriques(ancien);
  assert.strictEqual(lues.length, 1, 'le bloc doit rester lisible');
  assert.strictEqual(lues[0].contenu, 'Colloque à Berne.');
  const r = rub.retirerRubrique(ancien, 'vieux');
  assert.strictEqual(r.ok, true, 'et restera retirable');
});

test('types : un jeton inconnu (ou absent) n’est pas valide', () => {
  assert.strictEqual(rub.typeValide('inconnu'), false);
  assert.strictEqual(rub.typeValide(''), false);
  assert.strictEqual(rub.typeValide(undefined), false);
  assert.strictEqual(rub.typeValide(null), false);
});

// ---- Complétude ----

test('complétude : une rubrique est complète dès que son contenu n’est pas vide', () => {
  assert.deepStrictEqual(rub.champsManquants('podcasts', ''), ['contenu']);
  assert.deepStrictEqual(rub.champsManquants('podcasts', '   \n  '), ['contenu']);
  assert.deepStrictEqual(rub.champsManquants('podcasts', undefined), ['contenu']);
  assert.deepStrictEqual(rub.champsManquants('podcasts', 'Un texte.'), []);
  assert.strictEqual(rub.rubriqueComplete('podcasts', ''), false);
  assert.strictEqual(rub.rubriqueComplete('podcasts', 'Un texte.'), true);
});

test('complétude : un type inconnu n’est jamais complet, même rempli', () => {
  assert.deepStrictEqual(rub.champsManquants('bd', 'Un texte.'), ['contenu']);
  assert.strictEqual(rub.rubriqueComplete('bd', 'Un texte.'), false);
});

// ---- Aller-retour du contenu : le point le plus important du module ----

test('bloc : un contenu riche (italique, gras, lien, liste, plusieurs paragraphes) fait l’aller-retour au caractère près', () => {
  const contenu = [
    'Barreyre, J. (2019). *Les personnes en situation de handicap complexe*. Alter, 13-3, 207-217.',
    '',
    'Bürli, A. (2024). **Inklusion weltweit**. Edition SZH/CSPS.',
    '',
    'Voir aussi [le site de la revue](https://exemple.org/revue) pour aller plus loin.',
    '',
    '- Premier lien de la liste',
    '- Second lien, avec un mot en *italique* et un en **gras**',
    '  - Sous-lien indenté de deux espaces',
    '- Troisième lien'
  ].join('\n');
  const texte = rub.ajouterRubrique('', 'b1', 'dossier-references', contenu);
  const liste = rub.lireRubriques(texte);
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].id, 'b1');
  assert.strictEqual(liste[0].type, 'dossier-references');
  assert.strictEqual(liste[0].contenu, contenu,
    'le contenu n’a pas survécu à l’aller-retour au caractère près');
});

test('bloc : seules les lignes vides de tête et de queue sont ôtées, les lignes vides intérieures restent', () => {
  const coeur = 'Premier paragraphe.\n\nSecond paragraphe, avec une ligne vide au-dessus.';
  const texte = rub.ajouterRubrique('', 'b2', 'podcasts', '\n\n' + coeur + '\n\n\n');
  const liste = rub.lireRubriques(texte);
  assert.strictEqual(liste[0].contenu, coeur);
});

test('bloc : une tabulation à l’intérieur du contenu n’est pas altérée', () => {
  // À la différence du descriptif d’une fiche de ressource (lib/ressources.js,
  // blocRessource), dont les tabulations sont collapsées en un espace : ici le contenu
  // n’est PAS un champ de formulaire, c’est la rubrique elle-même, et rien n’a le droit
  // d’y toucher au-delà des blancs de tête et de queue (voir l’en-tête du module).
  const contenu = 'Colonne1\tColonne2\nAutre\tligne';
  const texte = rub.ajouterRubrique('', 'b3', 'podcasts', contenu);
  assert.strictEqual(rub.lireRubriques(texte)[0].contenu, contenu);
});

test('bloc : un contenu vide s’écrit et se relit comme une chaîne vide, jamais undefined', () => {
  const texte = rub.ajouterRubrique('', 'b4', 'podcasts', '');
  const liste = rub.lireRubriques(texte);
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].contenu, '');
});

// ---- Les six types ----

test('bloc : les six types font l’aller-retour, contenu et type inchangés', () => {
  for (const type of rub.TYPES_RUBRIQUE) {
    const contenu = 'Un contenu pour ' + type + '.\n\nUn second paragraphe.';
    const texte = rub.ajouterRubrique('', 'x-' + type, type, contenu);
    const liste = rub.lireRubriques(texte);
    assert.strictEqual(liste.length, 1, 'type ' + type);
    assert.strictEqual(liste[0].type, type);
    assert.strictEqual(liste[0].contenu, contenu);
  }
});

test('bloc : un type inconnu se lit et s’écrit sans casser (dégradation propre)', () => {
  const texte = rub.ajouterRubrique('', 'z1', 'bd', 'Un contenu.');
  const liste = rub.lireRubriques(texte);
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].type, 'bd');
  assert.strictEqual(liste[0].contenu, 'Un contenu.');
  assert.strictEqual(rub.typeValide('bd'), false);
});

// ---- Un bloc qui n'est pas une rubrique, ou laissé ouvert, ne trompe pas la lecture ----

test('lecture : un fenced div d’un autre genre est ignoré', () => {
  const texte = '::: {.szh-grille disposition="2-2"}\n![](media/a.png)\n![](media/b.png)\n:::\n';
  assert.deepStrictEqual(rub.lireRubriques(texte), []);
});

test('lecture : un bloc laissé ouvert (pas de fermeture) n’est pas lu', () => {
  const texte = '::: {.szh-rubrique type="podcasts"}\nTexte sans fermeture\n';
  assert.deepStrictEqual(rub.lireRubriques(texte), []);
});

test('lecture : un identifiant absent reçoit un repli stable pour la durée d’une lecture', () => {
  const texte = '::: {.szh-rubrique type="podcasts"}\nUn texte sans identifiant.\n:::\n';
  const liste = rub.lireRubriques(texte);
  assert.strictEqual(liste.length, 1);
  assert.ok(liste[0].id, 'aucun identifiant de repli');
  assert.strictEqual(rub.lireRubriques(texte)[0].id, liste[0].id,
    'le repli doit être stable pour un même texte relu à l’identique');
});

// ---- Cohabitation avec .szh-ressource dans le même .md ----

test('cohabitation : un .szh-rubrique et un .szh-ressource côte à côte ne se voient jamais l’un l’autre', () => {
  let texte = '';
  texte = res.ajouterRessource(texte, 'r1', 'livre', { titre: 'Un livre', descriptif: 'd', image: 'i.png' });
  texte = rub.ajouterRubrique(texte, 'b1', 'podcasts', 'Une brève d’actualité.');

  const rubriques = rub.lireRubriques(texte);
  const ressources = res.lireRessources(texte);
  assert.strictEqual(rubriques.length, 1, 'lireRubriques a vu le bloc .szh-ressource');
  assert.strictEqual(ressources.length, 1, 'lireRessources a vu le bloc .szh-rubrique');
  assert.strictEqual(rubriques[0].id, 'b1');
  assert.strictEqual(ressources[0].id, 'r1');

  // Retirer l’une des familles ne dérange pas l’autre.
  const apresRetraitRubrique = rub.retirerRubrique(texte, 'b1');
  assert.strictEqual(apresRetraitRubrique.ok, true);
  assert.strictEqual(res.lireRessources(apresRetraitRubrique.texte).length, 1,
    'retirer une rubrique a emporté la ressource voisine');
  assert.strictEqual(rub.lireRubriques(apresRetraitRubrique.texte).length, 0);

  const apresRetraitRessource = res.retirerRessource(texte, 'r1');
  assert.strictEqual(apresRetraitRessource.ok, true);
  assert.strictEqual(rub.lireRubriques(apresRetraitRessource.texte).length, 1,
    'retirer une ressource a emporté la rubrique voisine');
});

// ---- Plusieurs rubriques : ordre, identité, écriture ciblée, retrait ----

test('plusieurs rubriques : ajoutées à la suite, dans l’ordre de saisie', () => {
  let texte = '';
  texte = rub.ajouterRubrique(texte, 'a', 'dossier-references', 'Premier contenu.');
  texte = rub.ajouterRubrique(texte, 'b', 'tour-horizon', 'Second contenu.');
  texte = rub.ajouterRubrique(texte, 'c', 'podcasts', 'Troisième contenu.');
  const liste = rub.lireRubriques(texte);
  assert.deepStrictEqual(liste.map((r) => r.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(liste.map((r) => r.contenu),
    ['Premier contenu.', 'Second contenu.', 'Troisième contenu.']);
});

test('ajouter : n’abîme pas le texte qui suit déjà dans l’article', () => {
  const avant = '# Documentation\n\nUn paragraphe avant.\n';
  const texte = rub.ajouterRubrique(avant, 'a', 'podcasts', 'Un texte.');
  assert.match(texte, /Un paragraphe avant\./);
  assert.match(texte, /szh-rubrique/);
});

test('écriture ciblée : ecrireRubrique ne touche qu’une seule rubrique parmi plusieurs', () => {
  let texte = '';
  texte = rub.ajouterRubrique(texte, 'a', 'podcasts', 'Un.');
  texte = rub.ajouterRubrique(texte, 'b', 'podcasts', 'Deux.');
  const r = rub.ecrireRubrique(texte, 'b', 'podcasts', 'Deux modifié.');
  assert.strictEqual(r.ok, true);
  const liste = rub.lireRubriques(r.texte);
  assert.strictEqual(liste[0].contenu, 'Un.', 'la première rubrique a bougé');
  assert.strictEqual(liste[1].contenu, 'Deux modifié.');
});

test('écriture ciblée : ecrireRubrique peut aussi changer le type', () => {
  const texte = rub.ajouterRubrique('', 'a', 'podcasts', 'Un texte.');
  const r = rub.ecrireRubrique(texte, 'a', 'podcasts', 'Un texte.');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(rub.lireRubriques(r.texte)[0].type, 'podcasts');
});

test('écriture ciblée : ecrireRubrique sur un identifiant disparu échoue proprement', () => {
  const texte = rub.ajouterRubrique('', 'a', 'podcasts', 'Un.');
  const r = rub.ecrireRubrique(texte, 'disparu', 'podcasts', 'X');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.texte, texte, 'le texte ne doit pas bouger en cas d’échec');
});

test('retrait : retirerRubrique ôte la rubrique visée et garde les autres et leur ordre', () => {
  let texte = '';
  texte = rub.ajouterRubrique(texte, 'a', 'podcasts', 'Un.');
  texte = rub.ajouterRubrique(texte, 'b', 'podcasts', 'Deux.');
  texte = rub.ajouterRubrique(texte, 'c', 'podcasts', 'Trois.');
  const r = rub.retirerRubrique(texte, 'b');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(rub.lireRubriques(r.texte).map((x) => x.id), ['a', 'c']);
  assert.doesNotMatch(r.texte, /Deux\./);
  // Pas de double ligne vide laissée par la coupe.
  assert.doesNotMatch(r.texte, /\n\n\n/);
});

test('retrait : un identifiant disparu échoue sans toucher au texte', () => {
  const texte = rub.ajouterRubrique('', 'a', 'podcasts', 'Un.');
  const r = rub.retirerRubrique(texte, 'zzz');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.texte, texte);
});

// ---- Non-divergence avec pipeline/filters/szh-rubrique.lua ----
//
// Le formulaire ne doit jamais proposer un jeton que le rendu ne sait pas titrer, ni
// l'inverse : TYPES_RUBRIQUE (ici) et la table TITRES (szh-rubrique.lua) doivent porter
// exactement les mêmes jetons, dans le même ordre — même discipline que
// ressources.test.js pour lib/ressources.js / szh-ressource.lua. La table Lua est écrite
// par un autre agent en parallèle : si le fichier n'existe pas encore, ce test se
// contente de le signaler (skip) plutôt que d'échouer.

test('szh-rubrique.lua : la table TITRES porte exactement les jetons de TYPES_RUBRIQUE, dans le même ordre', (t) => {
  const cheminLua = path.join(RACINE, 'pipeline', 'filters', 'szh-rubrique.lua');
  if (!fs.existsSync(cheminLua)) {
    t.skip('pipeline/filters/szh-rubrique.lua n’existe pas encore (écrit par un autre agent en parallèle)');
    return;
  }
  const lua = fs.readFileSync(cheminLua, 'utf8');
  const bloc = (lua.match(/local\s+TITRES\s*=\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  assert.notStrictEqual(bloc, '', 'aucune table locale TITRES trouvée dans szh-rubrique.lua');
  const jetons = Array.from(bloc.matchAll(/\[\s*['"]([a-zA-Z0-9_-]+)['"]\s*\]\s*=/g)).map((m) => m[1]);
  assert.deepStrictEqual(jetons, rub.TYPES_RUBRIQUE,
    'la table TITRES de szh-rubrique.lua diverge de TYPES_RUBRIQUE (jetons manquants, en trop, ou mal ordonnés)');
});
