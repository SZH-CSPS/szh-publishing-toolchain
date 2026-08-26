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
const {
  analyserMeta, LICENCES_ARTICLE, LICENCE_DEFAUT
} = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));
const { T } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

// Les licences offertes, exactement comme licencesTraduites() de l'hôte les envoie : la
// liste vient de lib/yaml.js, les libellés de lib/i18n.js. Sans elle, le sélecteur de
// licence des cartes se construisait vide dans ce harnais, et le contrôle passait quand
// même — un harnais doit rendre ce que rend l'hôte, ou il ne prouve rien.
const LICENCES = LICENCES_ARTICLE.map((l) => ({ valeur: l.cle, libelle: T('licence.' + l.cle) }));

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
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  // Les objets viennent d'un autre realm (vm) : on compare les types, pas les prototypes.
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: 'fr',
                 licences: LICENCES, licenceDefaut: LICENCE_DEFAUT, filtre: null });
  assert.strictEqual(page.compter('.carte'), articles.length);
  // Le choix de licence doit être peuplé : une carte par article, sept licences chacune.
  assert.strictEqual(page.compter('[data-cle="licence"] option'),
    articles.length * LICENCES.length, 'sélecteur de licence rendu vide');
  // Traductions cachées par défaut : les champs des autres langues sont construits et
  // marqués, et le conteneur porte la classe qui les masque. Le CSS n'est pas évalué ici,
  // c'est donc le marquage que l'on contrôle — sans lui, le bouton n'a rien à révéler.
  assert.ok(page.conteneur().classes.has('sans-trad'), 'les traductions ne sont pas cachées au départ');
  assert.ok(page.compter('.champ-trad') >= articles.length * 4,
    'champs de traduction non marqués : le bouton ne peut rien afficher');
  // Les auteur·e·s ne sont plus six champs par personne mais une fiche affichée, la même
  // que dans le gestionnaire des médias. Sans elle, la carte perdrait ses auteur·e·s sans
  // rien dire.
  assert.ok(page.compter('.auteur-fiche') >= 2, 'fiches d’auteur·e absentes des cartes');
  assert.ok(page.textes().join(' | ').indexOf('Morand') !== -1,
    'nom d’auteur·e absent du rendu');
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

test('métadonnées : le DOI est verrouillé sur le calculé, et l’échappatoire passe par l’hôte', () => {
  // Trois cartes, trois états : une fiche neuve (verrouillée sur le calculé), un héritage
  // (doi déjà dans la fiche : mode manuel d'office, rien ne se perd), un article dont le
  // DOI est incalculable ou refusé (« — »).
  const articles = [
    { slug: '01-neuf', valeurs: analyserMeta(''), doiCalcule: '10.57161/r2026-03-01' },
    { slug: '02-manuel', valeurs: analyserMeta('doi: "10.57161/r2024-01-05"\n'),
      doiCalcule: '10.57161/r2026-03-02' },
    { slug: '03-sans', valeurs: analyserMeta(''), doiCalcule: '' }
  ];
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: 'fr',
                 licences: LICENCES, licenceDefaut: LICENCE_DEFAUT, filtre: null });
  const cartes = page.conteneur().querySelectorAll('.carte');
  assert.strictEqual(cartes.length, 3);
  const champ = (c) => c.querySelector('[data-cle="doi"]');
  const coche = (c) => c.querySelector('[data-cle="doi-manuel"]');
  // Fiche neuve : champ en lecture seule montrant le DOI calculé, case décochée, et une
  // infobulle qui explique pourquoi il n'y a rien à saisir.
  assert.strictEqual(champ(cartes[0]).readOnly, true, 'le champ DOI n’est pas verrouillé');
  assert.strictEqual(champ(cartes[0]).value, '10.57161/r2026-03-01');
  assert.strictEqual(coche(cartes[0]).checked, false);
  assert.ok(String(champ(cartes[0]).title || '').length > 0, 'infobulle du champ verrouillé absente');
  // Héritage : la fiche portait déjà un doi — case cochée d'office, champ éditable, la
  // valeur de la fiche intacte.
  assert.strictEqual(champ(cartes[1]).readOnly, false, 'le doi hérité n’est plus éditable');
  assert.strictEqual(champ(cartes[1]).value, '10.57161/r2024-01-05', 'le doi hérité est perdu');
  assert.strictEqual(coche(cartes[1]).checked, true, 'la case ne dit pas le mode manuel hérité');
  // Incalculable ou sans DOI : le champ le dit par « — », pas par un DOI à trous.
  assert.strictEqual(champ(cartes[2]).value, '—');
  assert.strictEqual(champ(cartes[2]).readOnly, true);
  // L'accord de l'hôte (avertissement modal confirmé) ouvre le champ, prérempli du
  // calculé : le point de départ raisonnable d'une correction.
  page.envoyer({ type: 'doi-manuel-reponse', slug: '01-neuf', sens: 'activer', ok: true });
  assert.strictEqual(coche(cartes[0]).checked, true);
  assert.strictEqual(champ(cartes[0]).readOnly, false, 'l’accord n’ouvre pas le champ');
  assert.strictEqual(champ(cartes[0]).value, '10.57161/r2026-03-01', 'le champ ne part pas du calculé');
  // Le retrait accordé efface le doi manuel : retour au calculé, verrouillé.
  page.envoyer({ type: 'doi-manuel-reponse', slug: '02-manuel', sens: 'retirer', ok: true });
  assert.strictEqual(coche(cartes[1]).checked, false);
  assert.strictEqual(champ(cartes[1]).readOnly, true);
  assert.strictEqual(champ(cartes[1]).value, '10.57161/r2026-03-02', 'le calculé ne reprend pas sa place');
  // Un refus ne change rien : la case était déjà revenue en arrière.
  page.envoyer({ type: 'doi-manuel-reponse', slug: '03-sans', sens: 'activer', ok: false });
  assert.strictEqual(coche(cartes[2]).checked, false);
  assert.strictEqual(champ(cartes[2]).readOnly, true);
});

test('vérification de l’import : les mêmes cartes, badges et section des images', () => {
  const articles = articlesDuCorpus().map((a) => Object.assign({}, a, {
    images: [{ relatif: 'fig-01.png', description: '2000 × 620 · 5 Ko' }]
  }));
  const page = ouvrir({
    racine: RACINE, page: 'import-verif',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlImportVerif'])
  });
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: 'fr',
                 licences: LICENCES, licenceDefaut: LICENCE_DEFAUT });
  assert.strictEqual(page.compter('.carte'), articles.length);
  assert.strictEqual(page.compter('[data-cle="licence"] option'),
    articles.length * LICENCES.length, 'sélecteur de licence rendu vide');
  assert.ok(page.compter('.badge') > 5, 'badges « détecté / à compléter » absents');
  assert.strictEqual(page.compter('.image-ligne'), articles.length, 'section des images absente');
  // Le DOI ne compte plus dans les champs vides : il est calculé, il n'y a rien à
  // compléter — donc plus de badge sur son intitulé non plus.
  assert.strictEqual(page.compter('[data-champ="doi"]'), 0,
    'un badge « à compléter » subsiste sur le DOI calculé');
});

test('gestionnaire des médias : cartes, encadrés et versions de portrait', () => {
  const page = ouvrir({
    racine: RACINE, page: 'medias-article',
    cssPartage: ['_design.css', '_auteurs.css'], jsPartage: ['_auteurs.js'],
    txt: libellesHote(RACINE, ['textesMedias', 'textesAuteur'])
  });
  // Les objets viennent d'un autre realm (vm) : on compare les types, pas les prototypes.
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  page.envoyer({
    type: 'charger', slug: 'figures', focus: '',
    i18n: libellesHote(RACINE, ['textesMedias', 'textesAuteur']),
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
        index: 0, rattache: true,
        auteurFiche: { prenom: 'Anne', nom: 'Dupont', fonction: 'Logopédiste',
          affiliation: 'HEP Vaud', orcid: '', email: 'anne@example.ch',
          photo: 'portraits/anne-dupont.sans-fond.png' },
        disponibles: { original: true, 'avec-fond': true, 'sans-fond': true },
        versionActuelle: 'sans-fond', version: 'Version utilisée : …',
        description: 'Original : 1200 × 1600 · 340 Ko', apercu: null,
        qualite: { famille: 'portrait', niveau: 'ok', mesure: 1200, min: 400, conseille: 1000 } }
    ]
  });
  assert.strictEqual(page.compter('.carte-media'), 2);
  assert.strictEqual(page.compter('.carte-portrait'), 1);
  // Deux avis « attention », et deux seulement : la qualité de l'image insuffisante, et le
  // doublon de la première. Le jumeau doit être nommé dans la carte, et pas seulement dans
  // l'infobulle d'une pastille, qu'aucun lecteur d'écran ne lit.
  assert.strictEqual(page.compter('.szh-notif--attention'), 2, 'avis attendus : qualité et doublon');
  // Le remplacement est sous chaque image ; une photo se remplace dans la modale de sa
  // fiche d'auteur·e, et ne porte donc pas de dépôt ici.
  assert.strictEqual(page.compter('.depot'), 2, 'zone de remplacement absente sous une image');
  assert.strictEqual(page.compter('.szh-ico'), 2, 'corbeille absente de la tête des cartes');
  assert.strictEqual(page.compterPage('.szh-modale'), 1, 'modale d’agrandissement non construite');
  // Le portrait montre la fiche d'auteur·e partagée : c'est elle qui porte l'édition, la
  // photo et le choix de version, ici comme dans le formulaire des métadonnées.
  assert.strictEqual(page.compter('.auteur-fiche'), 1, 'fiche d’auteur·e absente du portrait');
  const textes = page.textes().join(' | ');
  assert.ok(textes.indexOf('figures-fig-01.png') !== -1, 'nom de fichier absent du rendu');
  assert.ok(textes.indexOf('320 px de large') !== -1, 'avis de qualité muet');
  assert.ok(textes.indexOf('figures-fig-09.png') !== -1,
    'le doublon ne nomme pas le fichier jumeau');
  // L'état se lit dans la tête : deux insertions d'un côté, jamais insérée de l'autre.
  assert.ok(textes.indexOf('2 insertions') !== -1, 'pastille du nombre d’insertions absente');
  assert.ok(textes.indexOf('jamais insérée') !== -1, 'pastille « jamais insérée » absente');
  // Les coordonnées de la fiche, telles que le formulaire des métadonnées les montre.
  assert.ok(textes.indexOf('Anne Dupont') !== -1, 'nom de l’auteur·e absent de sa fiche');
  assert.ok(textes.indexOf('anne@example.ch') !== -1, 'coordonnées absentes de la fiche');
});

// L'éditeur de tableau ne reçoit pas ses libellés par gabarit mais dans le message
// « charger », déjà dépouillés de leur préfixe « table. ». On rejoue ici textesTable()
// depuis sa liste de clés, relue dans extension.js — comme libellesHote, pour parler
// exactement la langue de l'hôte sans recopier une liste qui divergerait.
function libellesTable() {
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  const i = src.indexOf('function textesTable');
  assert.notStrictEqual(i, -1, 'fonction de libellés introuvable : textesTable');
  const bloc = src.slice(i, src.indexOf('\n}', i));
  const txt = {};
  for (const m of bloc.matchAll(/'(table\.[A-Za-z0-9_.]+)'/g)) {
    txt[m[1].slice('table.'.length)] = T(m[1]);
  }
  return txt;
}

test('éditeur de tableau : grille, champs et texte d’aide de la description', () => {
  const { analyserTable, disposition } =
    chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'table-model.js'));
  const page = ouvrir({ racine: RACINE, page: 'table-editor', cssPartage: ['_design.css'] });
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  const modele = analyserTable(
    '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
  page.envoyer({ type: 'charger', modele: modele, disposition: disposition(modele),
                 accent: '', teintes: {}, presets: [], i18n: libellesTable() });
  // La page accroche ses morceaux à #champs et #zone, jamais à <body> : on les prend par
  // leur identifiant, comme la page elle-même.
  const boite = page.parId.champs;
  const inputs = boite.querySelectorAll('input');
  assert.strictEqual(inputs.length, 4, 'champs du tableau absents (légende, crédits, alt)');
  // Le texte d'aide sous la description : rendu, traduit — pas la clé brute que T() rend
  // quand la traduction manque — et relié au champ pour les lecteurs d'écran.
  const aides = boite.querySelectorAll('.szh-notif--discret');
  assert.strictEqual(aides.length, 1, 'texte d’aide de la description absent');
  assert.strictEqual(aides[0].textContent, T('table.alt.aide'));
  assert.ok(aides[0].textContent.indexOf('table.alt.aide') === -1, 'clé i18n rendue brute');
  assert.ok(inputs.some((e) => e.getAttribute('aria-describedby') === 'aide-alt'),
    'le champ de description n’est pas relié à son aide');
  assert.strictEqual(page.parId.zone.querySelectorAll('.cell').length, 4, 'grille non rendue');
});
