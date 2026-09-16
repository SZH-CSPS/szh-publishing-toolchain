// La grille de mots-clés (media/_commun.js, SZH.motsCles) et son autocomplétion edudoc.ch
// (media/_fiches.js, attacherAutocompletionMotsCles) : le thésaurus comme chemin par défaut
// de la saisie, un second rideau pour ce qu'il ne connaît pas, et la pastille qui dit à
// l'avance ce que l'export fera d'une case.
//
//   node --test "test/js/*.test.js"
//
// Le point le plus fragile n'est pas visible à l'oeil : la pastille promet « ce mot-clé ne
// partira pas à l'export » — si sa règle de reconnaissance divergeait de celle de
// lib/mots-cles-edudoc.js (apparierDescripteurs, qui décide réellement de l'export), elle
// mentirait. Le test « accord pastille / export », plus bas, compare les deux sur un corpus
// de cas coriaces plutôt que de faire confiance à une seule réimplémentation.
//
// Le harnais (test/js/dom-minimal.js) ne fait pas bouillonner les événements comme un vrai
// navigateur, alors que _fiches.js pose son écoute EN DÉLÉGATION sur le conteneur de la
// grille (elle survit ainsi à toute reconstruction de SZH.motsCles.rendre()). `taper()` et
// consorts, plus bas, redéclenchent donc l'événement à la racine de la délégation, `target`
// pointé sur le champ — exactement ce qu'un vrai bouillonnement ferait remonter.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { analyserMeta, LICENCES_ARTICLE, LICENCE_DEFAUT } =
  chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));
const { T } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));
const motsClesEdudoc = require(path.join(COCKPIT, 'lib', 'mots-cles-edudoc.js'));

const LICENCES = LICENCES_ARTICLE.map((l) => ({ valeur: l.cle, libelle: T('licence.' + l.cle) }));
const TYPES = [{ valeur: 'article', libelle: 'Article' }];

// Une carte, un article, une grille de mots-clés. Par défaut les trois langues sont déjà
// visibles (une case vide chacune) : la plupart des tests n'ont pas besoin de cocher « +
// Allemand »/« + Italien » ni de cliquer « Ajouter un mot-clé » pour obtenir un champ où taper.
function pageAvecCarte(keywords) {
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  const valeurs = analyserMeta('');
  valeurs.keywords = keywords || { fr: [''], de: [''], it: [''] };
  page.envoyer({
    type: 'valeurs', articles: [{ slug: 'a', valeurs: valeurs }],
    types: TYPES, langue: 'fr', licences: LICENCES, licenceDefaut: LICENCE_DEFAUT, filtre: null
  });
  return page;
}

// L'hôte réel envoie « valeurs » AVANT « mots-cles-connus » (envoyerValeurs puis
// envoyerMotsClesConnus, lib/metadonnees-hote.js) : les cartes existent déjà quand le
// thésaurus arrive. C'est cet ordre-là, le plus exigeant pour les marqueurs, qu'on rejoue ici
// par défaut plutôt que l'ordre confortable où le thésaurus précéderait les cartes.
function envoyerThesaurus(page, liste) {
  page.envoyer({ type: 'mots-cles-connus', motsCles: liste });
}

function carteDe(page) { return page.conteneur().querySelectorAll('.carte')[0]; }

// `input[data-langue]` seul trouverait aussi le titre, le sous-titre et le résumé, qui
// portent la même marque par langue : on reste sous « .mc », le conteneur propre à la grille.
function champsMc(carte, langue) { return carte.querySelectorAll('.mc input[data-langue="' + langue + '"]'); }
function champMc(carte, langue, rang) { return champsMc(carte, langue)[rang || 0]; }
function rangeeMc(champ) { return champ.closest('.mc-rangee'); }
// Une rangée porte plusieurs cases (une par langue) : sans le filtre par langue, compter les
// pastilles de la rangée mélangerait celle du français et celle de l'allemand. Le sélecteur
// combiné classe+attribut n'est pas de ceux que dom-minimal reconnaît (voir son en-tête) :
// on filtre donc en JS plutôt qu'en CSS.
function marques(champ) {
  return rangeeMc(champ).querySelectorAll('.mc-hors-thesaurus')
    .filter((m) => m.dataset.langue === champ.dataset.langue);
}
function grilleMc(champ) { return champ.closest('.mc').parent; }   // editeurMots.element

function taper(champ, texte) {
  champ.value = texte;
  grilleMc(champ).dispatchEvent({ type: 'input', target: champ });
}
function quitterChamp(champ) {
  grilleMc(champ).dispatchEvent({ type: 'focusout', target: champ });
}

const THESAURUS_SIMPLE = [{ de: 'Sonderpädagogik', fr: 'pédagogie spécialisée' }];

test('mots-clés : une saisie qui correspond à un descripteur affiche des suggestions, sans marqueur', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champ = champMc(carte, 'fr', 0);
  taper(champ, 'pédagogie spécialisée');
  assert.strictEqual(carte.querySelectorAll('.szh-sugg-item').length, 1,
    'aucune suggestion pour un descripteur pourtant connu');
  assert.strictEqual(carte.querySelectorAll('.szh-sugg-item--hors-thesaurus').length, 0,
    'le second rideau est apparu alors qu’une vraie suggestion existe');
  assert.strictEqual(marques(champ).length, 0, 'un descripteur connu ne doit pas se marquer');
});

test('mots-clés : une saisie inconnue montre « ajouter hors thésaurus » après un filet, et marque la case', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champ = champMc(carte, 'fr', 0);
  taper(champ, 'un terme jamais vu');
  const items = carte.querySelectorAll('.szh-sugg-item');
  assert.strictEqual(items.length, 1, 'une seule entrée attendue : le second rideau, rien d’autre');
  assert.ok(items[0].classList.contains('szh-sugg-item--hors-thesaurus'),
    'l’entrée du second rideau n’est pas visuellement distincte');
  assert.strictEqual(carte.querySelectorAll('.szh-sugg-filet').length, 1, 'le filet manque');
  assert.ok(items[0].textContent.indexOf('un terme jamais vu') !== -1,
    'le texte tapé ne se retrouve pas dans le libellé : ' + items[0].textContent);
  assert.strictEqual(marques(champ).length, 1, 'la case aurait dû se marquer hors thésaurus');
});

test('mots-clés : la valeur tapée survit quand on quitte le champ sans rien confirmer', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champ = champMc(carte, 'fr', 0);
  const saisie = 'un terme jamais vu, jamais confirmé';
  taper(champ, saisie);
  quitterChamp(champ);
  // La contrainte absolue posée par Robin : rien ne gate jamais une frappe, quoi qu'il
  // arrive à la boîte de suggestions.
  assert.strictEqual(champ.value, saisie, 'la frappe a été perdue au départ du champ');
  assert.strictEqual(carte.querySelectorAll('.szh-sugg').length, 0,
    'la boîte de suggestions reste accrochée après le départ du champ');
});

test('mots-clés : confirmer « hors thésaurus » éteint le marqueur, sans toucher à la valeur', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champ = champMc(carte, 'fr', 0);
  const saisie = 'inclusion scolaire';
  taper(champ, saisie);
  assert.strictEqual(marques(champ).length, 1, 'la case n’est pas encore marquée');
  const bouton = carte.querySelector('.szh-sugg-item--hors-thesaurus');
  assert.ok(bouton, 'le second rideau ne s’est pas ouvert');
  bouton.click();
  assert.strictEqual(champ.value, saisie, 'la confirmation a changé la valeur tapée');
  assert.strictEqual(marques(champ).length, 0,
    'le marqueur n’a pas disparu après la confirmation « hors thésaurus »');
});

test('mots-clés : choisir une suggestion pose la forme canonique et complète l’autre langue quand elle est vide', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champFr = champMc(carte, 'fr', 0);
  taper(champFr, 'pedago');
  const item = carte.querySelector('.szh-sugg-item');
  assert.ok(item, 'aucune suggestion pour « pedago »');
  item.click();
  assert.strictEqual(champFr.value, 'pédagogie spécialisée', 'la forme canonique n’a pas été posée');
  const champDe = champMc(carte, 'de', 0);
  assert.strictEqual(champDe.value, 'Sonderpädagogik', 'l’allemand n’a pas été complété');
  assert.strictEqual(marques(champFr).length, 0, 'un descripteur choisi reste marqué');
});

test('mots-clés : choisir une suggestion remplace une saisie manuelle déjà présente dans l’autre langue', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champFr = champMc(carte, 'fr', 0);
  const champDe = champMc(carte, 'de', 0);
  taper(champDe, 'une saisie tapée à la main');
  taper(champFr, 'pedago');
  const item = carte.querySelector('.szh-sugg-item');
  assert.ok(item, 'aucune suggestion pour « pedago »');
  item.click();
  assert.strictEqual(champDe.value, 'Sonderpädagogik',
    'la saisie manuelle de l’allemand aurait dû être remplacée par l’équivalent du thésaurus');
});

test('mots-clés : choisir une suggestion remplace aussi un autre descripteur du thésaurus déjà posé', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_CORIACE);
  const carte = carteDe(page);
  const champFr = champMc(carte, 'fr', 0);
  const champDe = champMc(carte, 'de', 0);
  // L'allemand porte déjà un AUTRE descripteur reconnu du thésaurus (une rangée mal remplie
  // au départ, ou héritée d'un ancien choix) : il doit céder la place lui aussi.
  taper(champDe, 'Übergänge (CSPS)');
  taper(champFr, 'inclusion');
  const item = carte.querySelector('.szh-sugg-item');
  assert.ok(item, 'aucune suggestion pour « inclusion »');
  item.click();
  assert.strictEqual(champFr.value, 'inclusion (SZH)', 'la forme canonique n’a pas été posée en français');
  assert.strictEqual(champDe.value, 'Inklusion (SZH)',
    'l’ancien descripteur allemand aurait dû être remplacé par l’équivalent de la nouvelle paire');
});

test('mots-clés : une paire incomplète du thésaurus ne touche pas à l’autre langue (rien à effacer)', () => {
  // Le thésaurus edudoc.ch peut manquer une langue pour un descripteur : côté hôte c'est le
  // champ `manque`, ici on l'imite en envoyant un fr vide. La case allemande, elle, garde
  // ce que Robin y a tapé — l'écraser par du vide serait une perte pure.
  const THESAURUS_INCOMPLET = [{ de: 'Barrierefreiheit (szh)', fr: '' }];
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_INCOMPLET);
  const carte = carteDe(page);
  const champDe = champMc(carte, 'de', 0);
  const champFr = champMc(carte, 'fr', 0);
  const saisieFr = 'une saisie française qui doit survivre';
  taper(champFr, saisieFr);
  taper(champDe, 'Barrierefreiheit');
  const item = carte.querySelector('.szh-sugg-item');
  assert.ok(item, 'aucune suggestion pour « Barrierefreiheit »');
  item.click();
  assert.strictEqual(champDe.value, 'Barrierefreiheit (szh)', 'la forme canonique n’a pas été posée en allemand');
  assert.strictEqual(champFr.value, saisieFr,
    'le français a été touché alors que le thésaurus n’a pas d’équivalent pour cette paire');
});

test('mots-clés : après remplacement, la pastille « hors thésaurus » de l’autre case s’éteint', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champFr = champMc(carte, 'fr', 0);
  const champDe = champMc(carte, 'de', 0);
  taper(champDe, 'un mot jamais vu en allemand');
  assert.strictEqual(marques(champDe).length, 1, 'la case allemande aurait dû se marquer hors thésaurus');
  taper(champFr, 'pedago');
  const item = carte.querySelector('.szh-sugg-item');
  assert.ok(item, 'aucune suggestion pour « pedago »');
  item.click();
  assert.strictEqual(champDe.value, 'Sonderpädagogik', 'l’allemand n’a pas reçu l’équivalent canonique');
  assert.strictEqual(marques(champDe).length, 0,
    'la pastille hors thésaurus de l’allemand aurait dû s’éteindre après le remplacement');
});

test('mots-clés : un choix fait en FR ou en DE ne touche jamais la colonne italienne', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champFr = champMc(carte, 'fr', 0);
  const champIt = champMc(carte, 'it', 0);
  const saisieIt = 'una parola italiana già scritta';
  taper(champIt, saisieIt);
  taper(champFr, 'pedago');
  const itemFr = carte.querySelector('.szh-sugg-item');
  assert.ok(itemFr, 'aucune suggestion pour « pedago »');
  itemFr.click();
  assert.strictEqual(champIt.value, saisieIt, 'la colonne italienne a été touchée par un choix fait en français');

  const champDe = champMc(carte, 'de', 0);
  taper(champIt, saisieIt);
  taper(champDe, 'Sonderpadagogik');
  const itemDe = carte.querySelector('.szh-sugg-item');
  assert.ok(itemDe, 'aucune suggestion pour « Sonderpadagogik »');
  itemDe.click();
  assert.strictEqual(champIt.value, saisieIt, 'la colonne italienne a été touchée par un choix fait en allemand');
});

test('mots-clés : un mot-clé hérité hors thésaurus est marqué dès l’ouverture de la fiche', () => {
  // « valeurs » arrive avant « mots-cles-connus » (voir pageAvecCarte/envoyerThesaurus) :
  // c'est justement cet ordre qui expose un marqueur posé avant que le thésaurus n'existe.
  const page = pageAvecCarte({ fr: ['mot totalement inconnu'], de: ['Unbekanntes Wort'] });
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champFr = champMc(carte, 'fr', 0);
  const champDe = champMc(carte, 'de', 0);
  assert.strictEqual(champFr.value, 'mot totalement inconnu');
  assert.strictEqual(marques(champFr).length, 1, 'le mot-clé hérité (FR) n’est pas marqué');
  assert.strictEqual(marques(champDe).length, 1, 'le mot-clé hérité (DE) n’est pas marqué');
});

test('mots-clés : une case vide n’est jamais marquée', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  for (const langue of ['fr', 'de', 'it']) {
    const champ = champMc(carte, langue, 0);
    assert.strictEqual(champ.value, '');
    assert.strictEqual(marques(champ).length, 0, 'la case ' + langue + ' vide est marquée');
  }
});

test('mots-clés : l’italien n’a ni suggestion ni marqueur', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  const champIt = champMc(carte, 'it', 0);
  taper(champIt, 'un termine mai visto in italiano');
  assert.strictEqual(carte.querySelectorAll('.szh-sugg').length, 0, 'une boîte s’est ouverte en italien');
  assert.strictEqual(marques(champIt).length, 0, 'l’italien a été marqué hors thésaurus');
});

// ---- L'accord pastille / export : le point qui compte le plus dans ce lot ----
//
// Le thésaurus ci-dessous réunit les cas coriaces demandés : un qualificatif — (SZH), (na),
// (CSPS) — en casses mélangées, des accents, une apostrophe courbe dans le thésaurus lui-même
// et une apostrophe droite (ou l'autre courbe, U+2018) côté saisie, des espaces multiples.
// Si la pastille et apparierDescripteurs (l'export réel) divergent sur UN SEUL cas, le test
// échoue : c'est la garantie que ce lot devait livrer.
const THESAURUS_CORIACE = [
  { de: 'Inklusion (SZH)', fr: 'inclusion (SZH)' },
  { de: 'Sonderpädagogik', fr: 'pédagogie spécialisée' },
  { de: 'Elternrechte (na)', fr: 'droits des parents (na)' },
  { de: 'Übergänge (CSPS)', fr: 'transitions (CSPS)' },
  { de: 'Kinderrechte (na)', fr: 'droits de l’enfant (na)' }
];

const CAS_CORIACES = [
  'inclusion (SZH)', 'inclusion', 'INCLUSION', '  inclusion   (szh)  ', 'Inclusion (Szh)',
  'Sonderpädagogik', 'sonderpadagogik', 'SONDERPÄDAGOGIK',
  'pedagogie specialisee', 'Pédagogie Spécialisée',
  'droits des parents (na)', 'droits des parents', 'droits des parents (NA)',
  'Übergänge', 'ubergange', 'transitions', 'transitions (csps)', 'Transitions (CSPS)',
  "droits de l'enfant (na)", "droits de l'enfant", 'droits de l’enfant', 'droits de l‘enfant',
  'mot totalement inconnu', '   ', ''
];

test('mots-clés : la pastille dit exactement ce que l’export ferait (apparierDescripteurs)', () => {
  const page = pageAvecCarte();
  envoyerThesaurus(page, THESAURUS_CORIACE);
  const carte = carteDe(page);
  const champ = champMc(carte, 'fr', 0);
  const index = motsClesEdudoc.indexerThesaurus(THESAURUS_CORIACE);

  for (const saisie of CAS_CORIACES) {
    taper(champ, saisie);
    const { descripteurs, nonReconnus } = motsClesEdudoc.apparierDescripteurs([saisie], [], index);
    const reconnuParExport = descripteurs.length === 1 && nonReconnus.length === 0;
    const attenduMarque = saisie.trim() !== '' && !reconnuParExport;
    const marqueParPastille = marques(champ).length > 0;
    assert.strictEqual(marqueParPastille, attenduMarque,
      'désaccord pastille/export sur « ' + saisie + ' » : pastille=' + marqueParPastille
      + ', export=' + reconnuParExport);
  }
});

test('mots-clés : ajouter puis retirer une rangée laisse des marqueurs justes après reconstruction', () => {
  const page = pageAvecCarte({ fr: ['mot totalement inconnu'], de: ['Unbekanntes Wort'] });
  envoyerThesaurus(page, THESAURUS_SIMPLE);
  const carte = carteDe(page);
  assert.strictEqual(marques(champMc(carte, 'fr', 0)).length, 1,
    'la rangée d’origine devrait déjà être marquée');

  // Ajouter une rangée reconstruit tout le DOM interne de la grille (SZH.motsCles.rendre()) :
  // le marqueur de la première rangée doit survivre, et la nouvelle — un descripteur connu —
  // ne doit pas se marquer.
  const bouton = carte.querySelector('.mc-pied button');
  assert.ok(bouton, 'bouton « Ajouter un mot-clé » introuvable');
  bouton.click();
  const champFr1 = champMc(carte, 'fr', 1);
  assert.ok(champFr1, 'la rangée ajoutée n’existe pas');
  taper(champFr1, 'pédagogie spécialisée');
  assert.strictEqual(marques(champMc(carte, 'fr', 0)).length, 1,
    'la première rangée a perdu son marqueur après l’ajout d’une rangée');
  assert.strictEqual(marques(champFr1).length, 0,
    'un descripteur connu s’est marqué sur la rangée ajoutée');

  // Retirer cette même rangée reconstruit le DOM une seconde fois : la première rangée doit
  // encore porter son marqueur.
  const retirer = rangeeMc(champFr1).querySelector('.mc-retirer');
  assert.ok(retirer, 'bouton de retrait introuvable sur la rangée ajoutée');
  retirer.click();
  assert.strictEqual(champsMc(carte, 'fr').length, 1, 'la rangée n’a pas été retirée');
  assert.strictEqual(marques(champMc(carte, 'fr', 0)).length, 1,
    'le marqueur de la première rangée n’a pas survécu au retrait de la seconde');
});
