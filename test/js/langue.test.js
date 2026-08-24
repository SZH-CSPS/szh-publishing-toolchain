// La langue d'un article : la clé `lang` de <slug>.meta.yaml, son choix dans le
// formulaire, et les règles que les filtres Lua doivent tenir.
//
//   node --test "test/js/*.test.js"
//
// Trois défauts sont gardés ici, et c'est le même vu de trois côtés :
//   * un article ne pouvait pas déclarer sa langue — la revue décidait pour lui, si bien
//     qu'un article allemand d'un numéro français sortait avec `/Lang (fr)` ;
//   * un titre vide dans la langue de l'article laissait imprimer celui d'une autre
//     langue, sans un mot, sous le mauvais `lang=` ;
//   * la marque « TO BE TRANSLATED » d'un mot-clé non traduit devenait une puce de la
//     couverture publiée.
//
// Le rendu lui-même se vérifie en compilant (voir le rapport de ce chantier) ; ici on
// garde ce qui se recopie d'un fichier à l'autre, plus le formulaire réellement exécuté.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));
const { TEXTES_COCKPIT } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const MAQUETTE = lire('pipeline', 'filters', 'szh-maquette.lua');
const NUMEROTATION = lire('pipeline', 'filters', 'szh-numerotation.lua');

// ---- La fiche d'article ----

test('fiche d’article : la langue est lue et réécrite telle quelle', () => {
  for (const langue of yaml.LANGUES_ARTICLE) {
    const src = 'type: article\nlang: ' + langue + '\ntitle:\n  fr: "T"\n';
    const relu = yaml.analyserMeta(src);
    assert.strictEqual(relu.lang, langue);
    assert.strictEqual(yaml.analyserMeta(yaml.serialiserMeta(relu)).lang, langue);
  }
});

test('fiche d’article : sans langue, la clé est vide et ne se réécrit pas', () => {
  const relu = yaml.analyserMeta('type: article\ntitle:\n  fr: "T"\n');
  assert.strictEqual(relu.lang, '');
  assert.ok(!/^lang:/m.test(yaml.serialiserMeta(relu)), 'une langue vide ne doit pas être écrite');
});

test('fiche d’article : une langue hors revue vaut « non déclarée »', () => {
  // Une valeur inattendue ne doit pas s'imprimer : la maquette n'a ni libellé de résumé
  // ni mention de licence hors fr/de/it. Elle est relue comme absente, donc le numéro
  // reprend la main, avec l'avertissement du filtre.
  for (const brute of ['en', 'EN', 'rm', 'de-CH ', '']) {
    assert.strictEqual(yaml.normaliserLangueArticle(brute), brute.trim().slice(0, 2).toLowerCase() === 'de' ? 'de' : '',
      'valeur mal normalisée : ' + JSON.stringify(brute));
  }
  assert.strictEqual(yaml.analyserMeta('lang: en\n').lang, '');
});

test('fiche d’article : la langue est un jeton nu, lisible ligne par ligne', () => {
  // szh-maquette.lua relit cette ligne hors pandoc, avec un `^lang:%s*(.*)$` : la valeur
  // doit rester un jeton nu et rester au premier niveau du fichier.
  const sortie = yaml.serialiserMeta({ type: 'article', lang: 'de', title: { de: 'T' } });
  assert.match(sortie, /^lang: de$/m);
  assert.ok(sortie.indexOf('lang: de') < sortie.indexOf('title:'), 'la langue doit précéder les titres');
});

test('fiche d’article : les clés inconnues survivent à un aller-retour avec la langue', () => {
  const src = 'type: article\nlang: de\nmaison: "à garder"\ntitle:\n  de: "T"\n';
  const sortie = yaml.serialiserMeta(yaml.analyserMeta(src));
  assert.match(sortie, /^maison: "à garder"$/m);
  assert.match(sortie, /^lang: de$/m);
});

// ---- Ce qui se recopie d'un fichier à l'autre ----

test('langues de la revue : une seule liste, trois fichiers', () => {
  // yaml.js décide, _commun.js propose, szh-maquette.lua tranche au rendu. Une liste qui
  // diverge, et le formulaire offrirait une langue que la maquette refuse.
  const commun = lire('vscodium-extension', 'szh-cockpit', 'media', '_commun.js');
  const mCommun = commun.match(/var LANGUES_CHOIX = \[([^\]]*)\]/);
  assert.ok(mCommun, 'LANGUES_CHOIX introuvable dans _commun.js');
  const duCommun = mCommun[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  assert.deepStrictEqual(duCommun, yaml.LANGUES_ARTICLE.slice());

  const mLua = MAQUETTE.match(/local LANGUES = \{([^}]*)\}/);
  assert.ok(mLua, 'table LANGUES introuvable dans szh-maquette.lua');
  const duLua = (mLua[1].match(/([a-z]{2}) = true/g) || []).map((s) => s.slice(0, 2));
  assert.deepStrictEqual(duLua.slice().sort(), yaml.LANGUES_ARTICLE.slice().sort());
});

test('les deux filtres lisent la langue dans la fiche de l’article', () => {
  // szh-numerotation tourne aussi dans la chaîne d'aperçu, où szh-maquette n'est pas
  // branché : sans cette lecture, l'aperçu dirait « Figure » et le PDF « Abbildung ».
  for (const [nom, src] of [['szh-maquette', MAQUETTE], ['szh-numerotation', NUMEROTATION]]) {
    assert.match(src, /\.meta\.yaml/, nom + ' ne lit pas la fiche de l’article');
    assert.match(src, /PANDOC_STATE/, nom + ' ne sait pas quel article il compose');
    assert.ok(src.indexOf('function langue_fiche') !== -1,
      nom + ' ne résout plus la langue depuis la fiche');
  }
  // Et la langue de l'article passe devant le jeton de revue, dans les deux filtres.
  assert.match(MAQUETTE, /lire_cle\(slug \.\. '\.meta\.yaml', 'lang'\)/);
  assert.ok(NUMEROTATION.indexOf('local fiche = langue_fiche()') <
    NUMEROTATION.indexOf("revue:find('zeitschrift')"),
    'szh-numerotation : le jeton de revue passe encore devant la langue de l’article');
});

test('szh-maquette : plus de repli silencieux sur une autre langue', () => {
  // C'était l'ancien `local ordre = { lang, 'de', 'fr', 'it' }` : un titre allemand vide
  // faisait imprimer le titre français sous lang="de".
  assert.ok(!/\{\s*lang,\s*'de',\s*'fr',\s*'it'\s*\}/.test(MAQUETTE),
    'la suite de replis est revenue');
  assert.ok(MAQUETTE.indexOf('function champ_localise') !== -1,
    'champ_localise a disparu : rien ne garde plus la langue des champs porteurs');
  // title obligatoire, subtitle et resume facultatifs mais jamais dans une autre langue.
  assert.match(MAQUETTE, /champ_localise\(meta\.title, lang, 'title', true/);
  assert.match(MAQUETTE, /champ_localise\(meta\.subtitle, lang, 'subtitle', false/);
  assert.match(MAQUETTE, /champ_localise\(meta\.resume, lang, 'resume', false/);
});

test('szh-maquette : la marque de traduction arrête la compilation', () => {
  const marque = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'traduction.js')).MARQUE_A_TRADUIRE;
  assert.match(MAQUETTE, new RegExp('local MARQUE = \'' + marque + '\''),
    'la marque du cockpit et celle du filtre ont divergé');
  assert.ok(MAQUETTE.indexOf('function verifier_marque') !== -1, 'le contrôle de la marque a disparu');
});

test('szh-maquette : chaque message nomme l’article, le champ et le geste', () => {
  // Le panneau de compilation est lu par des rédacteurs : un message qui ne dit pas quoi
  // faire ne vaut pas mieux que le silence d'avant.
  for (const langue of ['fr', 'de']) {
    const bloc = MAQUETTE.slice(MAQUETTE.indexOf('  ' + langue + ' = {', MAQUETTE.indexOf('local MESSAGES')));
    for (const cle of ['sans_langue', 'langue_inconnue', 'champ_vide', 'marque_motcle', 'marque_champ']) {
      assert.ok(bloc.indexOf(cle + ' = function') !== -1,
        'message « ' + cle + ' » absent en ' + langue);
    }
  }
  // L'allemand de la maison s'écrit en « ss ».
  const debutDe = MAQUETTE.indexOf('  de = {', MAQUETTE.indexOf('local MESSAGES'));
  const finDe = MAQUETTE.indexOf('\n}', debutDe);
  assert.ok(MAQUETTE.slice(debutDe, finDe).indexOf('ß') === -1, 'ß dans les messages allemands');
});

// ---- Le corpus de rendu ----

test('corpus de rendu : chaque fiche déclare sa langue', () => {
  const base = path.join(RACINE, 'test', 'articles');
  const slugs = fs.readdirSync(base)
    .filter((s) => fs.existsSync(path.join(base, s, s + '.meta.yaml')));
  assert.ok(slugs.length >= 3, 'corpus de rendu trop maigre');
  for (const slug of slugs) {
    const valeurs = yaml.analyserMeta(fs.readFileSync(path.join(base, slug, slug + '.meta.yaml'), 'utf8'));
    assert.ok(yaml.LANGUES_ARTICLE.indexOf(valeurs.lang) !== -1,
      'langue absente ou inconnue dans la fiche de ' + slug + ' : ' + JSON.stringify(valeurs.lang));
    // Le titre doit exister dans cette langue, sans quoi la compilation s'arrête.
    assert.ok(String((valeurs.title || {})[valeurs.lang] || '').trim() !== '',
      slug + ' : pas de titre dans sa propre langue');
  }
});

// ---- Le formulaire ----

const TYPES = [{ valeur: 'article', libelle: 'Article', groupe: 'Dossier' }];

function ouvrirFiches(articles, langueNumero) {
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: langueNumero, filtre: null });
  return page;
}

function selectLangue(page, slug) {
  const cartes = page.conteneur().querySelectorAll('[data-slug="' + slug + '"]');
  assert.strictEqual(cartes.length, 1, 'carte introuvable : ' + slug);
  const champs = cartes[0].querySelectorAll('[data-cle="lang"]');
  assert.strictEqual(champs.length, 1, 'un seul choix de langue par carte : ' + slug);
  return champs[0];
}

test('métadonnées des articles : chaque carte offre le choix de la langue', () => {
  const page = ouvrirFiches([
    { slug: 'article-de', valeurs: { lang: 'de', title: { de: 'Titel' } } },
    { slug: 'article-sans', valeurs: { title: { fr: 'Titre' } } }
  ], 'fr');
  const declare = selectLangue(page, 'article-de');
  assert.strictEqual(declare.balise, 'select');
  assert.deepStrictEqual(declare.enfants.map((o) => o.value), yaml.LANGUES_ARTICLE.slice());
  assert.strictEqual(declare.value, 'de', 'la langue de la fiche n’est pas reprise');
  // Fiche sans langue : le formulaire montre celle du numéro, exactement le repli que
  // fait la maquette. Montrer autre chose que ce qui s'imprimera serait le pire des cas.
  assert.strictEqual(selectLangue(page, 'article-sans').value, 'fr');
});

test('métadonnées des articles : le choix suit la langue du numéro', () => {
  const page = ouvrirFiches([{ slug: 'article-sans', valeurs: {} }], 'de');
  assert.strictEqual(selectLangue(page, 'article-sans').value, 'de');
});

test('métadonnées des articles : les langues sont nommées, en français et en allemand', () => {
  const page = ouvrirFiches([{ slug: 'a', valeurs: { lang: 'it' } }], 'fr');
  const noms = selectLangue(page, 'a').enfants.map((o) => o.textContent);
  for (const nom of noms) { assert.ok(nom && nom.length > 2, 'option sans libellé : ' + JSON.stringify(noms)); }
  for (const langue of ['fr', 'de']) {
    assert.ok(TEXTES_COCKPIT[langue]['fiches.langue.article'],
      'intitulé du choix de langue absent en ' + langue);
    for (const code of yaml.LANGUES_ARTICLE) {
      assert.ok(TEXTES_COCKPIT[langue]['meta.langue.' + code],
        'nom de la langue ' + code + ' absent en ' + langue);
    }
  }
  assert.ok(TEXTES_COCKPIT.de['fiches.langue.article'].indexOf('ß') === -1, 'ß dans le libellé allemand');
});
