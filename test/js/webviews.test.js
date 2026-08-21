// Les webviews du cockpit, réellement exécutées.
//
//   node --test "test/js/*.test.js"
//
// contrats.test.js vérifie que les libellés existent et que les tables de protocole ne
// mentent pas. Il ne construit aucune page : une erreur au rendu passait donc inaperçue —
// la webview garde son titre, sa note et son bouton, les cartes n'arrivent jamais, et rien
// ne le dit. C'est arrivé deux fois, dont une où `motsCles(...)` était appelé sans son
// préfixe `SZH.` et levait une ReferenceError à chaque carte.
//
// Ici, chaque formulaire est chargé dans le DOM minimal de dom-minimal.js, reçoit le
// message que l'hôte lui envoie, et doit rendre ce qu'on attend. Toute exception remonte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { analyserMeta } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));

// Les fiches du corpus de rendu : de vraies métadonnées, deux langues, mots-clés, auteurs.
function articlesDuCorpus() {
  const base = path.join(RACINE, 'test', 'articles');
  return fs.readdirSync(base)
    .filter((slug) => fs.existsSync(path.join(base, slug, slug + '.meta.yaml')))
    .map((slug) => {
      const valeurs = analyserMeta(fs.readFileSync(path.join(base, slug, slug + '.meta.yaml'), 'utf8'));
      delete valeurs._inconnues;                   // l'hôte ne les envoie pas non plus
      return { slug: slug, valeurs: valeurs };
    });
}

const TYPES = [
  { valeur: 'article', libelle: 'Article', groupe: 'Dossier' },
  { valeur: 'editorial', libelle: 'Éditorial', groupe: 'Hors dossier' }
];

test('métadonnées des articles : une carte remplie par article', () => {
  const articles = articlesDuCorpus();
  assert.ok(articles.length >= 2, 'corpus de fiches trop maigre pour le contrôle');
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_fiches.css'], jsPartage: ['_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'htmlApercuMetadonnees'])
  });
  // Les objets viennent d'un autre realm (vm) : on compare les types, pas les prototypes.
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: 'fr', filtre: null });
  assert.strictEqual(page.compter('.carte'), articles.length);
  // Traductions cachées par défaut : les champs des autres langues sont construits et
  // marqués, et le conteneur porte la classe qui les masque. Le CSS n'est pas évalué ici,
  // c'est donc le marquage que l'on contrôle — sans lui, le bouton n'a rien à révéler.
  assert.ok(page.conteneur().classes.has('sans-trad'), 'les traductions ne sont pas cachées au départ');
  assert.ok(page.compter('.champ-trad') >= articles.length * 4,
    'champs de traduction non marqués : le bouton ne peut rien afficher');
  // Une carte muette est le symptôme exact du défaut qu'on garde : on exige des champs.
  assert.ok(page.compter('input') > 10, 'cartes sans champ : le rendu s’est arrêté en route');
  // Les valeurs du corpus doivent arriver dans les champs : titre, résumé, mots-clés.
  // C'est la grille de mots-clés qui levait, et elle est construite en dernier.
  const valeurs = page.valeurs();
  for (const article of articles) {
    const titre = (article.valeurs.title || {}).fr;
    if (titre) { assert.ok(valeurs.indexOf(titre) !== -1, 'titre absent du rendu : ' + article.slug); }
    const motCle = ((article.valeurs.keywords || {}).fr || [])[0];
    if (motCle) { assert.ok(valeurs.indexOf(motCle) !== -1, 'mot-clé absent du rendu : ' + motCle); }
  }
});

test('vérification de l’import : les mêmes cartes, badges et section des images', () => {
  const articles = articlesDuCorpus().map((a) => Object.assign({}, a, {
    images: [{ relatif: 'fig-01.png', description: '2000 × 620 · 5 Ko' }]
  }));
  const page = ouvrir({
    racine: RACINE, page: 'import-verif',
    cssPartage: ['_fiches.css'], jsPartage: ['_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'htmlImportVerif'])
  });
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: 'fr' });
  assert.strictEqual(page.compter('.carte'), articles.length);
  assert.ok(page.compter('.badge') > 5, 'badges « détecté / à compléter » absents');
  assert.strictEqual(page.compter('.image-ligne'), articles.length, 'section des images absente');
});

test('gestionnaire des médias : cartes, encadrés et versions de portrait', () => {
  const page = ouvrir({
    racine: RACINE, page: 'medias-article',
    txt: libellesHote(RACINE, ['textesMedias'])
  });
  // Les objets viennent d'un autre realm (vm) : on compare les types, pas les prototypes.
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  page.envoyer({
    type: 'charger', slug: 'figures', focus: '',
    i18n: libellesHote(RACINE, ['textesMedias']),
    medias: [
      { relatif: 'figures-fig-01.png', description: '2000 × 620 · 5 Ko', apercu: null,
        occurrences: 2, doublons: ['figures-fig-09.png'], sansAlternative: false,
        qualite: { famille: 'figure', niveau: 'ok', mesure: 2000, min: 1000, conseille: 2000 },
        valeurs: { legende: 'Une légende', alt: 'desc', altDefini: true, copyright: '© SZH', source: '', horsFigure: false } },
      { relatif: 'figures-fig-05.png', description: '320 × 200 · 1 Ko', apercu: null,
        occurrences: 0, doublons: [], sansAlternative: false,
        qualite: { famille: 'figure', niveau: 'insuffisant', mesure: 320, min: 1000, conseille: 2000 },
        valeurs: { legende: '', alt: '', altDefini: false, copyright: '', source: '', horsFigure: true } }
    ],
    portraits: [
      { base: 'anne-dupont', nom: 'anne-dupont.sans-fond.png', auteur: 'Anne Dupont',
        disponibles: { original: true, 'avec-fond': true, 'sans-fond': true },
        versionActuelle: 'sans-fond', rattache: true, version: 'Version utilisée : …',
        description: 'Original : 1200 × 1600 · 340 Ko', apercu: null,
        qualite: { famille: 'portrait', niveau: 'ok', mesure: 1200, min: 400, conseille: 1000 } }
    ]
  });
  assert.strictEqual(page.compter('.carte-media'), 2);
  assert.strictEqual(page.compter('.carte-portrait'), 1);
  // L'avis de qualité ne s'allume que sur l'image insuffisante : c'est le seul ton
  // « attention » de la page.
  assert.strictEqual(page.compter('.szh-notif--attention'), 1, 'un seul avis de qualité attendu');
  // Le remplacement est sous chaque visuel, portraits compris ; la corbeille ne concerne
  // que les images, un portrait se retirant depuis la fiche de son auteur·e.
  assert.strictEqual(page.compter('.depot'), 3, 'zone de remplacement absente sous un visuel');
  assert.strictEqual(page.compter('.szh-ico'), 2, 'corbeille absente de la tête des cartes');
  assert.strictEqual(page.compterPage('.szh-modale'), 1, 'modale d’agrandissement non construite');
  // Trois versions offertes pour le portrait rattaché.
  assert.ok(page.compter('input') >= 3, 'boutons de version du portrait absents');
  const textes = page.textes().join(' | ');
  assert.ok(textes.indexOf('figures-fig-01.png') !== -1, 'nom de fichier absent du rendu');
  assert.ok(textes.indexOf('Attention qualité') !== -1, 'avis de qualité muet');
  // L'état se lit dans la tête : deux insertions d'un côté, jamais insérée de l'autre.
  assert.ok(textes.indexOf('2 insertions') !== -1, 'pastille du nombre d’insertions absente');
  assert.ok(textes.indexOf('jamais insérée') !== -1, 'pastille « jamais insérée » absente');
});
