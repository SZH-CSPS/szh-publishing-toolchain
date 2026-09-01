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
  assert.strictEqual(champ(cartes[2]).value, '–');
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

// ---- La langue de l'article pilote les champs (lot A, 25.08.2026) ----
//
// Trois règles, chacune avec son moyen de casser en silence :
//  1. l'ORDRE des colonnes suit l'article — sa langue d'abord, la langue par défaut de la
//     revue ensuite — et non plus la langue du numéro pour tout le monde ;
//  2. les CASES sont dynamiques : une par langue manquante de {fr, de, it}, cochée
//     d'office quand la fiche porte déjà des contenus dans cette langue ;
//  3. changer la langue PERMUTE les contenus entre l'ancienne et la nouvelle langue —
//     mots-clés compris — et la collecte repart fidèle : rien ne se perd.

function pageFiches(articles, langueNumero) {
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: langueNumero,
                 licences: LICENCES, licenceDefaut: LICENCE_DEFAUT, filtre: null });
  return page;
}

function ficheDe(texte) {
  const valeurs = analyserMeta(texte);
  delete valeurs._inconnues;
  return valeurs;
}

// Le texte d'un élément dont les enfants portent les mots : les libellés des cases sont
// des nœuds texte à côté de la coche, pas un textContent posé d'un bloc.
function texteProfond(el) {
  let t = el._texte || '';
  for (const c of el.enfants || []) { t += texteProfond(c); }
  return t;
}

const carteDe = (page, slug) => page.conteneur().querySelectorAll('[data-slug="' + slug + '"]')[0];
const champsTextes = (carte) => carte.querySelectorAll('.champs-textes input')
  .concat(carte.querySelectorAll('.champs-textes textarea'));
const langsTitres = (carte) => champsTextes(carte)
  .filter((i) => i.dataset.cle === 'title').map((i) => i.dataset.langue);
const casesDe = (carte) => carte.querySelectorAll('.case-langue');
const champDe = (carte, cle, lg) => champsTextes(carte)
  .find((x) => x.dataset.cle === cle && x.dataset.langue === lg);

test('métadonnées : la langue de l’article ouvre la carte, les cases offrent les manquantes', () => {
  const page = pageFiches([
    { slug: '01-de', valeurs: ficheDe('lang: de\ntitle:\n  de: "Titel"\n') },
    { slug: '02-it', valeurs: ficheDe('lang: it\n') },
    { slug: '03-fr', valeurs: ficheDe('lang: fr\n') },
    { slug: '04-herite', valeurs: ficheDe('lang: fr\ntitle:\n  it: "Titolo"\n') }
  ], 'fr');

  // Article DE dans une revue FR : colonnes DE puis FR, champs DE hors traduction, une
  // seule case — « + Italien ».
  const de = carteDe(page, '01-de');
  assert.deepStrictEqual(langsTitres(de), ['de', 'fr', 'it']);
  assert.ok(de.classes.has('avec-de') && de.classes.has('avec-fr') && !de.classes.has('avec-it'),
    'les classes avec-<lang> ne suivent pas les langues de la carte');
  assert.ok(!champDe(de, 'title', 'de').classes.has('champ-trad'),
    'la langue de l’article est passée en traduction : la carte s’ouvrirait vide');
  assert.ok(champDe(de, 'title', 'fr').classes.has('champ-trad'));
  assert.deepStrictEqual(casesDe(de).map((c) => c.querySelector('input').dataset.langue), ['it']);
  assert.strictEqual(casesDe(de)[0].querySelector('input').checked, false);
  assert.ok(texteProfond(casesDe(de)[0]).indexOf(T('fiches.ajout.it')) !== -1,
    'le libellé de la case n’est pas celui de l’hôte');

  // Article IT dans la Revue : IT d'abord, une seule case — « + Allemand (champs DE) ».
  const it = carteDe(page, '02-it');
  assert.deepStrictEqual(langsTitres(it), ['it', 'fr', 'de']);
  assert.deepStrictEqual(casesDe(it).map((c) => c.querySelector('input').dataset.langue), ['de']);
  assert.ok(texteProfond(casesDe(it)[0]).indexOf(T('fiches.ajout.de')) !== -1);

  // Langue de l'article = langue de la revue : une seule colonne de base, deux cases.
  const fr = carteDe(page, '03-fr');
  assert.deepStrictEqual(langsTitres(fr), ['fr', 'de', 'it']);
  assert.deepStrictEqual(casesDe(fr).map((c) => c.querySelector('input').dataset.langue), ['de', 'it']);
  assert.ok(fr.classes.has('avec-fr') && !fr.classes.has('avec-de') && !fr.classes.has('avec-it'));

  // Héritage : des contenus IT existants cochent la case d'office et révèlent la colonne.
  const herite = carteDe(page, '04-herite');
  const caseIt = casesDe(herite).map((c) => c.querySelector('input'))
    .find((i) => i.dataset.langue === 'it');
  assert.strictEqual(caseIt.checked, true, 'les contenus italiens existants ne cochent pas la case');
  assert.ok(herite.classes.has('avec-it'));
});

test('métadonnées : dans la Zeitschrift, un article DE offre « + Français » et « + Italien »', () => {
  const page = pageFiches([{ slug: '01-de', valeurs: ficheDe('lang: de\n') }], 'de');
  const de = carteDe(page, '01-de');
  assert.deepStrictEqual(langsTitres(de), ['de', 'fr', 'it']);
  assert.deepStrictEqual(casesDe(de).map((c) => c.querySelector('input').dataset.langue),
    ['fr', 'it'], 'les deux langues manquantes doivent avoir chacune leur case');
});

test('métadonnées : changer la langue permute les contenus, mots-clés compris', () => {
  const page = pageFiches([{ slug: '01-a', valeurs: ficheDe([
    'lang: de',
    'title:', '  de: "Titel"', '  fr: "Titre"',
    'subtitle:', '  de: "Untertitel"',
    'resume:', '  de: "Zusammenfassung"', '  fr: "Résumé"',
    'keywords:', '  de:', '  - "Diagnose"', '  fr:', '  - "diagnostic"', ''
  ].join('\n')) }], 'fr');
  const carte = carteDe(page, '01-a');
  const sel = carte.querySelector('select[data-cle=lang]');
  assert.strictEqual(sel.value, 'de');
  assert.deepStrictEqual(langsTitres(carte), ['de', 'fr', 'it']);

  // DE -> IT : les contenus s'échangent, rien ne se perd, les colonnes se réordonnent.
  sel.value = 'it';
  sel.dispatchEvent({ type: 'input' });
  assert.deepStrictEqual(langsTitres(carte), ['it', 'fr', 'de'],
    'les colonnes ne suivent pas la nouvelle langue de l’article');
  assert.strictEqual(champDe(carte, 'title', 'it').value, 'Titel');
  assert.strictEqual(champDe(carte, 'title', 'de').value, '');
  assert.strictEqual(champDe(carte, 'title', 'fr').value, 'Titre', 'le français n’avait pas à bouger');
  assert.strictEqual(champDe(carte, 'subtitle', 'it').value, 'Untertitel');
  assert.strictEqual(champDe(carte, 'resume', 'it').value, 'Zusammenfassung');
  assert.strictEqual(champDe(carte, 'resume', 'fr').value, 'Résumé');
  assert.ok(!champDe(carte, 'title', 'it').classes.has('champ-trad'),
    'la nouvelle langue de l’article reste marquée traduction');
  assert.ok(champDe(carte, 'title', 'de').classes.has('champ-trad'));
  assert.ok(carte.classes.has('modifie'), 'la permutation ne marque pas la carte modifiée');
  // Les cases recalculées : l'allemand est la langue manquante, décochée — il ne reste
  // rien sous DE après l'échange.
  assert.deepStrictEqual(casesDe(carte).map((c) => c.querySelector('input').dataset.langue), ['de']);
  assert.strictEqual(casesDe(carte)[0].querySelector('input').checked, false);
  assert.ok(!carte.classes.has('avec-de'));

  // La collecte après permutation est fidèle : le bouton envoie l'état permuté, les
  // trois langues comprises — c'est cet envoi que l'hôte écrit dans le .meta.yaml.
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.ok(envoi, 'aucun message d’enregistrement');
  const envoyee = envoi.articles['01-a'];
  // L'envoi vient d'un autre realm (vm) : on compare les valeurs, pas les prototypes.
  const plat = (o) => JSON.parse(JSON.stringify(o));
  assert.strictEqual(envoyee.lang, 'it');
  assert.deepStrictEqual(plat(envoyee.title), { it: 'Titel', fr: 'Titre', de: '' });
  assert.deepStrictEqual(plat(envoyee.subtitle), { it: 'Untertitel', fr: '', de: '' });
  assert.deepStrictEqual(plat(envoyee.resume), { it: 'Zusammenfassung', fr: 'Résumé', de: '' });
  assert.deepStrictEqual(plat(envoyee.keywords), { it: ['Diagnose'], fr: ['diagnostic'], de: [] });

  // Et le retour IT -> DE rend tout : la permutation est sans perte, dans les deux sens.
  sel.value = 'de';
  sel.dispatchEvent({ type: 'input' });
  assert.strictEqual(champDe(carte, 'title', 'de').value, 'Titel');
  assert.strictEqual(champDe(carte, 'title', 'it').value, '');
  assert.deepStrictEqual(langsTitres(carte), ['de', 'fr', 'it']);
});

test('métadonnées : une fiche sans langue permute depuis la langue du numéro', () => {
  // Une fiche sans `lang` s'affiche sous la langue du numéro — c'est là que ses contenus
  // sont montrés. Déclarer une autre langue permute donc depuis elle : le geste cohérent,
  // le titre suit la langue qu'on vient de déclarer.
  const page = pageFiches([{ slug: '01-sans', valeurs: ficheDe('title:\n  fr: "Titre"\n') }], 'fr');
  const carte = carteDe(page, '01-sans');
  const sel = carte.querySelector('select[data-cle=lang]');
  assert.strictEqual(sel.value, 'fr', 'une fiche sans langue s’ouvre sur la langue du numéro');
  sel.value = 'de';
  sel.dispatchEvent({ type: 'input' });
  assert.strictEqual(champDe(carte, 'title', 'de').value, 'Titre');
  assert.strictEqual(champDe(carte, 'title', 'fr').value, '');
  assert.deepStrictEqual(langsTitres(carte), ['de', 'fr', 'it']);
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

// ---- Gestionnaire des médias : une carte par FIGURE, repliée ----
//
// La refonte du 29.08.2026. L'unité de la liste n'est plus le fichier mais la figure : une
// image seule, ou toutes les images d'une même grille. Repliée, une carte ne montre que
// ses aperçus et la zone « Ajouter une image à côté » ; le clic sur un aperçu déplie le
// formulaire de CETTE image, sous la rangée entière. Ce qui se casse en silence, et que
// ces contrôles tiennent :
//   * un formulaire par image empilé revient (l'ancienne carte), et la page redevient
//     illisible sans qu'aucune erreur ne soit levée ;
//   * deux formulaires s'ouvrent dans la même figure, ou le clic n'en referme aucun ;
//   * la légende de la figure quitte l'accordéon du groupe, ou reparaît sur les images
//     suivantes, qui n'en portent pas ;
//   * l'ancre de « Ajouter une image à côté » glisse d'une image à l'autre : le geste
//     part alors sur la mauvaise figure ;
//   * un défaut — basse résolution, image muette, doublon — n'est plus visible tant que le
//     formulaire est replié, c'est-à-dire jamais.
const MEDIAS_TXT = () => libellesHote(RACINE, ['textesMedias', 'textesAuteur']);

// Le corpus des figures : une image seule et très insérée, une grille de trois, et une
// image jamais insérée qui cumule les défauts. Un portrait en pied, comme la vraie page.
function pageMedias(txt, focus) {
  const page = ouvrir({
    racine: RACINE, page: 'medias-article',
    cssPartage: ['_design.css', '_auteurs.css'], jsPartage: ['_auteurs.js'], txt: txt
  });
  const media = (relatif, o) => Object.assign({
    relatif: relatif, description: '2000 × 620 · 5 Ko', apercu: null,
    occurrences: 1, doublons: [], sansAlternative: false,
    largeur: 2000, hauteur: 620, grille: null, rangGrille: -1,
    qualite: { famille: 'figure', niveau: 'ok', mesure: 2000, min: 1000, conseille: 2000 },
    valeurs: { legende: '', alt: 'desc', altDefini: true, copyright: '', source: '', horsFigure: false }
  }, o || {});
  page.envoyer({
    type: 'charger', slug: 'figures', focus: focus || '', i18n: txt,
    grilleMax: 6, grilleAuto: 'auto',
    dispositions: { 2: ['2', '1-1'], 3: ['3', '2-1', '1-2', '1-1-1'] },
    grilles: [{ disposition: '2-1', auto: '3',
                membres: ['fig-02.png', 'fig-03.png', 'fig-04.png'] }],
    medias: [
      media('fig-01.png', { occurrences: 2, doublons: ['fig-09.png'],
        valeurs: { legende: 'Vue générale', alt: 'Trois bandes', altDefini: true,
                   copyright: '© SZH', source: 'ESA', horsFigure: false } }),
      media('fig-02.png', { grille: 0, rangGrille: 0,
        valeurs: { legende: 'Les trois moments', alt: 'desc', altDefini: true,
                   copyright: '', source: '', horsFigure: false } }),
      // Ni alternatif ni légende : c'est l'image muette, et la vignette doit le dire.
      media('fig-03.png', { grille: 0, rangGrille: 1,
        valeurs: { legende: '', alt: '', altDefini: false, copyright: '', source: '', horsFigure: false } }),
      media('fig-04.png', { grille: 0, rangGrille: 2 }),
      media('fig-09.png', { occurrences: 0, doublons: ['fig-01.png'],
        description: '413 × 619 · 44 Ko', largeur: 413, hauteur: 619,
        qualite: { famille: 'figure', niveau: 'insuffisant', mesure: 413, min: 1000, conseille: 2000 } })
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
  return page;
}
// L'aperçu cliquable d'une image, et le formulaire qu'il commande. Les deux portent le
// chemin relatif : c'est le seul lien stable entre une image et ce qui la concerne.
const vignetteDe = (page, r) => page.conteneur().querySelectorAll('button[data-relatif=' + r + ']')[0];
const formDe = (page, r) => page.conteneur().querySelectorAll('div[data-relatif=' + r + ']')[0];
const champId = (page, id) => page.conteneur().querySelectorAll('input').filter((e) => e.id === id);

test('médias : une carte par figure, tout replié sauf les aperçus et l’ajout', () => {
  const page = pageMedias(MEDIAS_TXT());
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  // Cinq images, trois figures : l'image seule, la grille de trois, l'image jamais insérée.
  assert.strictEqual(page.compter('.carte-figure'), 3, 'une carte par figure, pas par fichier');
  assert.strictEqual(page.compter('.vignette'), 5, 'un aperçu cliquable par image');
  assert.strictEqual(page.compter('.media-form'), 5, 'un formulaire par image');
  assert.strictEqual(page.compter('.carte-media'), 0, 'l’ancienne carte par fichier est revenue');
  assert.strictEqual(page.compter('.carte-corps'), 0, 'les deux colonnes de l’ancienne carte sont revenues');
  // Replié veut dire replié : aucun formulaire ouvert au chargement.
  const formulaires = page.conteneur().querySelectorAll('.media-form');
  assert.ok(formulaires.every((f) => f.hidden === true), 'un formulaire est déplié au chargement');
  assert.ok(page.conteneur().querySelectorAll('.vignette')
    .every((v) => v.getAttribute('aria-expanded') === 'false'),
    'une vignette s’annonce dépliée alors que son formulaire est replié');
  // « Ajouter une image à côté » : une seule par figure, et toujours visible.
  assert.strictEqual(page.compter('.depot-acote'), 3, 'une zone d’ajout par figure, pas par image');
  assert.ok(page.conteneur().querySelectorAll('.depot-acote')
    .every((d) => d.closest('.media-form') === null),
    'la zone d’ajout est enfermée dans un formulaire replié : on ne la verrait jamais');
  // « Remplacer cette image » n'apparaît qu'au dépliement : elle vit DANS le formulaire.
  assert.strictEqual(page.compter('.media-form .depot'), 5,
    '« Remplacer cette image » doit vivre dans le formulaire de chaque image');
  assert.strictEqual(page.compter('.depot'), 8, 'zones de dépôt attendues : 5 remplacements + 3 ajouts');
  // L'accordéon du groupe n'existe que pour la grille, et il est replié.
  assert.strictEqual(page.compter('.figure-groupe'), 1, 'accordéon de groupe attendu sur la seule grille');
  assert.strictEqual(page.compter('.groupe-corps'), 1);
  assert.strictEqual(page.conteneur().querySelectorAll('.groupe-corps')[0].hidden, true,
    'l’accordéon du groupe s’ouvre au chargement');
  assert.strictEqual(page.conteneur().querySelectorAll('.groupe-tete')[0].getAttribute('aria-expanded'), 'false');
  // Les portraits ne changent pas : la fiche partagée, et la modale d'agrandissement.
  assert.strictEqual(page.compter('.carte-portrait'), 1);
  assert.strictEqual(page.compter('.auteur-fiche'), 1, 'fiche d’auteur·e absente du portrait');
  assert.strictEqual(page.compterPage('.szh-modale'), 1, 'modale d’agrandissement non construite');
});

test('médias : le clic sur un aperçu déplie ce seul formulaire, et le referme', () => {
  const page = pageMedias(MEDIAS_TXT());
  const ouverts = () => page.conteneur().querySelectorAll('.media-form')
    .filter((f) => f.hidden === false).map((f) => f.dataset.relatif);
  const marquees = () => page.conteneur().querySelectorAll('.vignette--ouverte')
    .map((v) => v.dataset.relatif);

  vignetteDe(page, 'fig-03.png').dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(ouverts(), ['fig-03.png'], 'le clic n’ouvre pas le formulaire de l’image cliquée');
  assert.deepStrictEqual(marquees(), ['fig-03.png'], 'l’image ouverte n’est pas marquée');
  assert.strictEqual(vignetteDe(page, 'fig-03.png').getAttribute('aria-expanded'), 'true');

  // Une autre image de la MÊME grille : la première se referme, une seule reste ouverte.
  vignetteDe(page, 'fig-04.png').dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(ouverts(), ['fig-04.png'], 'deux formulaires ouverts dans la même figure');
  assert.deepStrictEqual(marquees(), ['fig-04.png']);
  assert.strictEqual(vignetteDe(page, 'fig-03.png').getAttribute('aria-expanded'), 'false');

  // Une figure voisine ne se referme pas : les cartes sont indépendantes.
  vignetteDe(page, 'fig-01.png').dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(ouverts().sort(), ['fig-01.png', 'fig-04.png'],
    'ouvrir une figure referme la voisine');

  // L'aperçu est une bascule : le même clic referme.
  vignetteDe(page, 'fig-04.png').dispatchEvent({ type: 'click' });
  assert.deepStrictEqual(ouverts(), ['fig-01.png'], 'l’aperçu ne referme pas ce qu’il a ouvert');
  assert.strictEqual(vignetteDe(page, 'fig-04.png').getAttribute('aria-expanded'), 'false');
});

test('médias : l’accordéon du groupe porte les réglages de la grille, et elle seule', () => {
  const txt = MEDIAS_TXT();
  const page = pageMedias(txt);
  const tete = page.conteneur().querySelectorAll('.groupe-tete')[0];
  const corps = page.conteneur().querySelectorAll('.groupe-corps')[0];
  tete.dispatchEvent({ type: 'click' });
  assert.strictEqual(corps.hidden, false, 'l’accordéon ne s’ouvre pas');
  assert.strictEqual(tete.getAttribute('aria-expanded'), 'true');
  // Le menu de disposition : « Automatique » plus les quatre dispositions de trois images,
  // une seule fois — c'est un réglage de la figure, pas de chaque image.
  assert.strictEqual(page.compter('.groupe-corps select'), 1, 'un seul menu de disposition par grille');
  assert.strictEqual(page.compter('.groupe-corps select option'), 5, 'le menu de disposition n’est pas peuplé');
  const dedans = corps.textContent;
  assert.ok(dedans.indexOf('fig-02.png · fig-03.png · fig-04.png') !== -1, 'les membres ne sont pas nommés');
  assert.ok(dedans.indexOf('3 sur une ligne') !== -1,
    'le mode automatique ne nomme pas la disposition qu’il choisirait');
  assert.ok(dedans.indexOf('2 + 1') !== -1, 'la disposition « 2-1 » n’est pas libellée');
  // La légende de la figure appartient au groupe : elle est dans l'accordéon, portée par
  // l'ancre (fig-02.png, deuxième média reçu), et nulle part ailleurs.
  assert.strictEqual(page.compter('.groupe-corps input'), 1, 'la légende de la figure n’est pas dans l’accordéon');
  assert.strictEqual(corps.querySelectorAll('input')[0].id, 'ch-legende-1');
  assert.ok(dedans.indexOf(txt.grilleLegende) !== -1, 'l’intitulé ne dit pas que la légende vaut pour la grille');
  assert.strictEqual(corps.querySelectorAll('input')[0].value, 'Les trois moments');
  // Les images suivantes n'ont plus de champ légende du tout : la figure n'en porte qu'une.
  assert.strictEqual(champId(page, 'ch-legende-2').length, 0, 'une image suivante garde un champ légende');
  assert.strictEqual(champId(page, 'ch-legende-3').length, 0, 'une image suivante garde un champ légende');
  // Une image seule garde la sienne dans son propre formulaire : sa figure, c'est elle.
  assert.strictEqual(champId(page, 'ch-legende-0').length, 1);
  // Le formulaire de l'image seule porte sa légende ; celui d'un membre de grille, non.
  assert.ok(formDe(page, 'fig-01.png').querySelectorAll('input').some((e) => e.id === 'ch-legende-0'));
  assert.ok(formDe(page, 'fig-02.png').querySelectorAll('input').every((e) => e.id !== 'ch-legende-1'),
    'la légende de la figure est restée dans le formulaire de l’ancre');
});

test('médias : l’ancien bloc de grille et sa notification de suiveuse ont disparu', () => {
  const page = pageMedias(MEDIAS_TXT());
  assert.strictEqual(page.compter('.grille'), 0, 'l’ancien fieldset de grille est encore là');
  const textes = page.textes().join(' | ');
  assert.strictEqual(textes.indexOf('Dans la grille de'), -1,
    'la notification de suiveuse n’a plus lieu d’être : la légende vit dans l’accordéon');
});

// Les deux sorties d'une grille agissent sur UNE image : elles restent donc dans le
// formulaire de cette image-là. Un booléen inversé, et « sortir de la grille » effacerait
// l'insertion au lieu de la déplacer — sans que rien à l'écran ne change.
test('médias : les deux sorties de grille vivent dans le formulaire, et postent le bon geste', () => {
  const txt = MEDIAS_TXT();
  const page = pageMedias(txt);
  assert.strictEqual(page.compter('.grille-sorties'), 3, 'les sorties manquent à un membre de la grille');
  assert.strictEqual(page.compter('.media-form .grille-sorties'), 3,
    'les sorties doivent vivre dans le formulaire de l’image, pas dans l’accordéon du groupe');
  assert.strictEqual(page.compter('.groupe-corps .grille-sorties'), 0);
  const sorties = formDe(page, 'fig-03.png').querySelectorAll('.grille-sorties button');
  assert.strictEqual(sorties.length, 2, 'il faut deux sorties par image de grille');
  assert.strictEqual(sorties[0].textContent, txt.grilleRetirer);
  assert.strictEqual(sorties[1].textContent, txt.grilleOter);
  page.messages.length = 0;
  sorties[0].dispatchEvent({ type: 'click' });     // « Sortir de la grille »
  sorties[1].dispatchEvent({ type: 'click' });     // « Retirer de la figure »
  const gestes = page.messages.filter((m) => m.type === 'grille-retirer');
  assert.strictEqual(gestes.length, 2, 'les sorties n’envoient pas leur message');
  assert.strictEqual(gestes[0].garder, true, '« sortir de la grille » doit garder l’image dans le texte');
  assert.strictEqual(gestes[1].garder, false, '« retirer de la figure » doit ôter l’insertion');
  assert.strictEqual(gestes[0].relatif, 'fig-03.png', 'la sortie part sur la mauvaise image');
});

// L'ancre d'une figure, c'est sa première image. Une zone d'ajout ancrée ailleurs ferait
// partir le geste sur une autre figure — ou, pour une image jamais insérée, sur rien.
test('médias : la zone d’ajout d’une grille est ancrée sur sa première image', () => {
  const page = pageMedias(MEDIAS_TXT());
  const carte = page.conteneur().querySelectorAll('.carte-figure')
    .filter((s) => s.dataset.figure === 'fig-02.png')[0];
  assert.ok(carte, 'la carte de la grille ne porte pas le chemin de son ancre');
  assert.strictEqual(carte.querySelectorAll('.depot-acote').length, 1);
  // « Une image de l'article… » : le choix se déplie, ne propose que les candidates, et
  // l'ajout part sur l'ancre. fig-01.png est insérée deux fois : elle n'est pas candidate.
  const boutons = carte.querySelectorAll('.depot-acote button');
  const article = boutons.filter((b) => b.textContent === (MEDIAS_TXT().grilleDeposerArticle))[0];
  assert.ok(article, 'le bouton « Une image de l’article… » manque à la zone d’ajout');
  article.dispatchEvent({ type: 'click' });
  const sel = carte.querySelectorAll('.grille-choix select')[0];
  assert.strictEqual(sel.enfants.length, 1, 'les candidates ne sont pas celles attendues');
  assert.strictEqual(sel.enfants[0].value, 'fig-09.png');
  sel.value = 'fig-09.png';
  page.messages.length = 0;
  carte.querySelectorAll('.grille-choix-actions button')[0].dispatchEvent({ type: 'click' });
  const ajout = page.messages.filter((m) => m.type === 'grille-ajouter');
  assert.strictEqual(ajout.length, 1, 'l’ajout n’envoie pas son message');
  assert.strictEqual(ajout[0].relatif, 'fig-02.png', 'l’ajout n’est pas ancré sur la première image');
  assert.strictEqual(ajout[0].ajout, 'fig-09.png');
});

// Un défaut caché par un pli est un défaut qu'on ne corrige pas : ce qui ne va pas se lit
// sur la vignette, formulaire replié. Le verdict complet, lui, reste dans le formulaire.
test('médias : l’état d’une image se lit sur son aperçu, formulaire replié', () => {
  const page = pageMedias(MEDIAS_TXT());
  const etat = (r) => vignetteDe(page, r).textContent;
  assert.ok(etat('fig-01.png').indexOf('2 insertions') !== -1, 'le nombre d’insertions ne se voit pas');
  assert.ok(etat('fig-09.png').indexOf('jamais insérée') !== -1, '« jamais insérée » ne se voit pas');
  assert.ok(etat('fig-09.png').indexOf('doublon') !== -1, 'le doublon ne se voit pas');
  assert.ok(etat('fig-09.png').indexOf('basse résolution') !== -1,
    'une image trop petite ne se signale plus tant que son formulaire est replié');
  assert.ok(etat('fig-03.png').indexOf('image muette') !== -1,
    'une image sans alternative ni légende ne se signale plus tant que son formulaire est replié');
  assert.strictEqual(etat('fig-01.png').indexOf('image muette'), -1,
    'une image pourvue d’une alternative est dite muette');
  // Le nom du fichier reste lisible sans rien déplier : c'est par lui qu'on la retrouve.
  assert.ok(etat('fig-09.png').indexOf('fig-09.png') !== -1, 'le nom du fichier a quitté l’aperçu');
  // Le verdict entier, le jumeau nommé et l'avis d'insertion : dans le formulaire.
  const forme = formDe(page, 'fig-09.png').textContent;
  assert.ok(forme.indexOf('413 px de large') !== -1, 'avis de qualité muet dans le formulaire');
  assert.ok(forme.indexOf('fig-01.png') !== -1, 'le doublon ne nomme pas le fichier jumeau');
  // Trois avis « attention » : la qualité de l'image insuffisante et les deux doublons.
  assert.strictEqual(page.compter('.szh-notif--attention'), 3, 'avis attendus : qualité et deux doublons');
  // La pastille « en grille » n'a plus de sens : les images d'une grille sont dans la
  // même carte, on le voit.
  assert.strictEqual(page.textes().join(' | ').indexOf('en grille'), -1,
    'la pastille « en grille » survit alors que le groupement se voit');
});

// La corbeille et l'agrandissement quittent la tête de carte — il n'y en a plus — pour
// l'en-tête du formulaire : deux gestes qui portent sur UNE image, à côté de son nom.
test('médias : corbeille et agrandissement sont dans l’en-tête du formulaire', () => {
  const page = pageMedias(MEDIAS_TXT());
  assert.ok(page.conteneur().querySelectorAll('.szh-tete')
    .every((t) => t.closest('.carte-figure') === null),
    'la tête grise de l’ancienne carte survit dans une carte de figure');
  assert.strictEqual(page.compter('.form-tete'), 5, 'un en-tête par formulaire d’image');
  const tete = formDe(page, 'fig-09.png').querySelectorAll('.form-tete')[0];
  assert.ok(tete.textContent.indexOf('fig-09.png') !== -1, 'le formulaire ne redit pas de quelle image il est');
  assert.ok(tete.textContent.indexOf('413 × 619 · 44 Ko') !== -1, 'les dimensions ont disparu');
  const icones = tete.querySelectorAll('.szh-ico');
  assert.strictEqual(icones.length, 2, 'agrandir et supprimer : deux icônes attendues dans l’en-tête');
  // Un nom d'icône inconnu ne lève pas : SZH.icone rend un <svg> vide, et le bouton devient
  // un carré blanc que personne ne remarque avant de l'avoir sous les yeux.
  for (const b of icones) {
    const formes = b.querySelectorAll('path').length + b.querySelectorAll('circle').length
      + b.querySelectorAll('rect').length;
    assert.ok(formes > 0, 'picto vide dans l’en-tête : nom d’icône inconnu');
  }
  page.messages.length = 0;
  icones[1].dispatchEvent({ type: 'click' });
  const retraits = page.messages.filter((m) => m.type === 'retirer');
  assert.strictEqual(retraits.length, 1, 'la corbeille n’envoie pas son message');
  assert.strictEqual(retraits[0].relatif, 'fig-09.png');
  // Les saisies en cours voyagent avec : une suppression dans une grille fait recharger le
  // formulaire côté hôte, qui les écraserait sans cela.
  assert.ok(Array.isArray(retraits[0].medias), '« retirer » n’emporte pas les saisies en cours');
});

// Un aperçu qui commande un pli doit se voir comme tel : sans repère, la vignette passe
// pour une image de plus, et le formulaire replié pour un formulaire absent. Le chevron
// est le même signe que celui de l'accordéon du groupe, et il pivote pareil.
test('médias : l’aperçu et l’accordéon portent le même chevron, et il pivote', () => {
  const page = pageMedias(MEDIAS_TXT());
  const chevron = (e) => e.querySelectorAll('svg');
  assert.strictEqual(chevron(vignetteDe(page, 'fig-01.png')).length, 1,
    'la vignette ne dit pas qu’elle commande un pli');
  assert.ok(page.conteneur().querySelectorAll('.vignette').every((v) => chevron(v).length === 1),
    'une vignette est sans chevron');
  // Le chevron de l'accordéon vient AVANT son intitulé : à l'autre bout d'un bouton pleine
  // largeur, il ne se rattache plus à rien.
  const tete = page.conteneur().querySelectorAll('.groupe-tete')[0];
  assert.strictEqual(tete.enfants[0].balise, 'svg',
    'le chevron de l’accordéon doit précéder son intitulé');
});

// La légende d'une figure est le champ le plus utilisé d'une grille, et elle vit désormais
// dans un accordéon replié. L'en-tête la redit donc telle quelle : on la lit sans ouvrir, et
// on voit du premier coup d'œil laquelle des figures n'en a pas.
test('médias : l’en-tête de l’accordéon redit la légende de la figure, et la suit', () => {
  const txt = MEDIAS_TXT();
  const page = pageMedias(txt);
  const tete = page.conteneur().querySelectorAll('.groupe-tete')[0];
  const corps = page.conteneur().querySelectorAll('.groupe-corps')[0];
  assert.strictEqual(corps.hidden, true, 'l’en-tête ne sert à rien si l’accordéon est ouvert');
  assert.ok(tete.textContent.indexOf(txt.grilleSection) !== -1, 'l’intitulé de l’accordéon a disparu');
  assert.ok(tete.textContent.indexOf('Les trois moments') !== -1,
    'la légende de la figure ne se lit pas sans ouvrir l’accordéon');
  // Elle suit la frappe : un en-tête qui ment est pire qu'un en-tête muet.
  const champ = corps.querySelectorAll('input')[0];
  champ.value = 'Trois vues du dispositif';
  champ.dispatchEvent({ type: 'input' });
  assert.ok(tete.textContent.indexOf('Trois vues du dispositif') !== -1,
    'l’en-tête garde l’ancienne légende après la frappe');
  assert.strictEqual(tete.textContent.indexOf('Les trois moments'), -1);
  // Sans légende, l'en-tête le dit : c'est le manque qu'on veut voir de loin.
  champ.value = '';
  champ.dispatchEvent({ type: 'input' });
  assert.ok(tete.textContent.indexOf(txt.grilleLegendeAbsente) !== -1,
    'une figure sans légende ne se signale pas');
  assert.ok(String(txt.grilleLegendeAbsente || '').length > 0,
    'libellé « sans légende » absent de l’hôte');
});

// Ce qui suit le premier rendu : les trois réponses ciblées de l'hôte, et l'ouverture sur
// une image visée. Elles étaient sûres tant qu'une carte valait un fichier ; avec des
// cartes de figure elles visent maintenant trois nœuds différents — la vignette, le
// formulaire, la carte — et se trompent de cible sans lever la moindre erreur.

// Ctrl+Alt+F insère une image puis ouvre le formulaire SUR elle. Replié par défaut, le
// formulaire doit s'ouvrir : sinon le geste dépose le rédacteur devant une carte fermée,
// avec la légende à écrire cachée derrière un clic qu'il ne sait pas devoir faire.
test('médias : l’ouverture sur une image visée déplie son formulaire', () => {
  const page = pageMedias(MEDIAS_TXT(), 'fig-04.png');
  const ouverts = () => page.conteneur().querySelectorAll('.media-form')
    .filter((f) => f.hidden === false).map((f) => f.dataset.relatif);
  assert.deepStrictEqual(ouverts(), ['fig-04.png'],
    'le formulaire de l’image visée reste replié : il n’y a rien où écrire');
  assert.strictEqual(vignetteDe(page, 'fig-04.png').getAttribute('aria-expanded'), 'true');
  // Panneau déjà ouvert : l'hôte ne recharge pas — il perdrait les saisies — il demande
  // seulement d'amener cette image-ci à l'écran. Celle d'avant se referme.
  page.envoyer({ type: 'focaliser', relatif: 'fig-03.png' });
  assert.deepStrictEqual(ouverts(), ['fig-03.png'], '« focaliser » n’ouvre pas l’image visée');
});

// Un fichier remplacé : l'aperçu, le poids et le verdict changent. Trois écritures, sur
// trois nœuds qui ne sont plus dans la même carte qu'avant.
test('médias : une image remplacée refait son aperçu, son poids et son verdict', () => {
  const page = pageMedias(MEDIAS_TXT());
  assert.strictEqual(page.compter('.szh-notif--attention'), 3);
  assert.ok(vignetteDe(page, 'fig-09.png').textContent.indexOf('basse résolution') !== -1);
  page.envoyer({ type: 'media-remplace', relatif: 'fig-09.png',
    description: '2400 × 1600 · 900 Ko', apercu: 'data:image/png;base64,AAAA',
    qualite: { famille: 'figure', niveau: 'ok', mesure: 2400, min: 1000, conseille: 2000 } });
  const images = vignetteDe(page, 'fig-09.png').querySelectorAll('img');
  assert.strictEqual(images.length, 1, 'l’aperçu de la vignette n’a pas été refait');
  assert.strictEqual(images[0].src, 'data:image/png;base64,AAAA');
  assert.ok(formDe(page, 'fig-09.png').textContent.indexOf('2400 × 1600 · 900 Ko') !== -1,
    'le poids affiché est resté celui du fichier remplacé');
  assert.strictEqual(vignetteDe(page, 'fig-09.png').textContent.indexOf('basse résolution'), -1,
    'la pastille de basse résolution survit à un remplacement qui la corrige');
  assert.strictEqual(page.compter('.szh-notif--attention'), 2,
    'le verdict de qualité n’a pas été reposé');
});

// La zone occupée pendant un dépôt : la classe se pose et se retire au même endroit, sinon
// les deux zones de dépôt de la figure restent grisées pour toujours, sans rien dire.
test('médias : « occupé » se pose et se retire sur la carte de figure', () => {
  const page = pageMedias(MEDIAS_TXT());
  const carte = page.conteneur().querySelectorAll('.carte-figure')
    .filter((s) => s.dataset.figure === 'fig-01.png')[0];
  carte.classList.add('occupe');
  page.envoyer({ type: 'media-annulee', relatif: 'fig-01.png' });
  assert.strictEqual(carte.classList.contains('occupe'), false,
    'la carte reste occupée après un dépôt annulé : ses zones de dépôt sont mortes');
});

// Une image supprimée quitte la page sans rechargement. Sa vignette, son formulaire, et sa
// carte si elle était seule dedans.
test('médias : une image retirée emporte sa vignette, son formulaire et sa carte vide', () => {
  const page = pageMedias(MEDIAS_TXT());
  page.envoyer({ type: 'media-retire', relatif: 'fig-01.png' });
  assert.strictEqual(page.compter('.carte-figure'), 2, 'la carte vidée de son image est restée');
  assert.strictEqual(page.compter('.vignette'), 4, 'la vignette de l’image retirée est restée');
  assert.strictEqual(page.compter('.media-form'), 4, 'le formulaire de l’image retirée est resté');
  // Le jumeau survivant n'est plus le doublon de rien : il ne doit plus nommer un fichier
  // qui n'existe plus.
  assert.strictEqual(vignetteDe(page, 'fig-09.png').textContent.indexOf('doublon'), -1,
    'le jumeau garde sa pastille de doublon alors que l’autre a disparu');
  // Une image d'une grille de trois : la carte reste, avec deux vignettes.
  page.envoyer({ type: 'media-retire', relatif: 'fig-03.png' });
  assert.strictEqual(page.compter('.carte-figure'), 2);
  assert.strictEqual(page.compter('.vignette'), 3);
  assert.strictEqual(page.compter('.media-form'), 3);
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

// Le clic droit sur la POIGNÉE de la 2e ligne doit offrir « les 2 premières lignes en
// en-tête » : l'ancien sensEntete exigeait une sélection partant de la ligne 1, et la
// 2e rangée d'un en-tête à deux niveaux était indéfinissable depuis son propre menu.
// On rejoue le geste entier : menu, libellé chiffré, opération postée, grille rechargée.
test('éditeur de tableau : la 2e ligne se définit en en-tête depuis son clic droit', () => {
  const table = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'table-model.js'));
  const page = ouvrir({ racine: RACINE, page: 'table-editor', cssPartage: ['_design.css'] });
  let modele = table.analyserTable('<table><tr><td colspan="3">Identité</td></tr>'
    + '<tr><td>Nom</td><td>Prénom</td><td>ORCID</td></tr>'
    + '<tr><td>a</td><td>b</td><td>c</td></tr></table>');
  page.envoyer({ type: 'charger', modele: modele, disposition: table.disposition(modele),
                 accent: '', teintes: {}, presets: [], i18n: libellesTable() });
  // Le DOM factice ne convertit pas dataset en chaînes : on compare en nombre.
  const poignee = page.parId.zone.querySelectorAll('[data-prow]').find((e) => +e.dataset.prow === 1);
  assert.ok(poignee, 'poignée de la 2e ligne introuvable');
  poignee.dispatchEvent({ type: 'contextmenu', clientX: 0, clientY: 0 });
  const items = page.document.body.querySelectorAll('.ctxitem');
  const attendu = T('table.entete.lignes').split('{0}').join('2');
  const item = items.find((e) => e.textContent === attendu);
  assert.ok(item, 'entrée « ' + attendu + ' » absente du menu : '
    + items.map((e) => e.textContent).join(' | '));
  item.dispatchEvent({ type: 'click' });
  const opMsg = page.messages.find((m) => m.type === 'operation' && m.nom === 'entete');
  assert.ok(opMsg, 'aucune opération en-tête postée à l’hôte');
  assert.strictEqual(opMsg.args.sens, 'lignes');
  assert.strictEqual(opMsg.args.n, 2);
  // Rejoue l'hôte : opération appliquée puis grille rechargée -> 4 cellules <th>
  // (la fusion et les trois titres), et le fichier porte le balisage complexe.
  modele = table.appliquerOperationTable('entete', opMsg.modele, opMsg.args);
  page.envoyer({ type: 'charger', modele: modele, disposition: table.disposition(modele) });
  assert.strictEqual(page.parId.zone.querySelectorAll('th.cell').length, 4,
    'les deux rangées d’en-tête ne rendent pas leurs <th>');
});

// Le titre de section se pose et se retire depuis le clic droit d'une rangée du corps ;
// l'hôte est rejoué entre les deux pour vérifier l'aller complet menu -> modèle -> grille.
test('éditeur de tableau : le clic droit pose et retire un titre de section', () => {
  const table = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'table-model.js'));
  const page = ouvrir({ racine: RACINE, page: 'table-editor', cssPartage: ['_design.css'] });
  let modele = table.analyserTable('<table><tr><th>P1</th><th>P2</th></tr>'
    + '<tr><td>a1</td><td>b1</td></tr>'
    + '<tr><td>Suite 2026</td><td></td></tr>'
    + '<tr><td>a2</td><td>b2</td></tr></table>');
  page.envoyer({ type: 'charger', modele: modele, disposition: table.disposition(modele),
                 accent: '', teintes: {}, presets: [], i18n: libellesTable() });
  const poignee = (r) => page.parId.zone.querySelectorAll('[data-prow]').find((e) => +e.dataset.prow === r);
  // Les deux premières rangées sont la zone d'en-tête : pas de titre de section là.
  poignee(1).dispatchEvent({ type: 'contextmenu', clientX: 0, clientY: 0 });
  assert.ok(!page.document.body.querySelectorAll('.ctxitem')
    .some((e) => e.textContent === T('table.sectionTitre')),
    'le titre de section ne doit pas être proposé sur la 2e ligne');
  poignee(2).dispatchEvent({ type: 'contextmenu', clientX: 0, clientY: 0 });
  let item = page.document.body.querySelectorAll('.ctxitem')
    .find((e) => e.textContent === T('table.sectionTitre'));
  assert.ok(item, 'entrée « titre de section » absente du menu de la 3e ligne');
  item.dispatchEvent({ type: 'click' });
  const opMsg = page.messages.find((m) => m.type === 'operation' && m.nom === 'section');
  assert.ok(opMsg, 'aucune opération section postée');
  assert.strictEqual(opMsg.args.r, 2);
  assert.strictEqual(opMsg.args.actif, true);
  modele = table.appliquerOperationTable('section', opMsg.modele, opMsg.args);
  page.envoyer({ type: 'charger', modele: modele, disposition: table.disposition(modele) });
  // La rangée fusionnée est rendue en <th> (2 du thead + 1 de section) et le menu
  // propose désormais le retrait.
  assert.strictEqual(page.parId.zone.querySelectorAll('th.cell').length, 3,
    'le titre de section ne rend pas son <th>');
  poignee(2).dispatchEvent({ type: 'contextmenu', clientX: 0, clientY: 0 });
  assert.ok(page.document.body.querySelectorAll('.ctxitem')
    .some((e) => e.textContent === T('table.sectionTitreRetirer')),
    'le retrait du titre de section n’est pas proposé');
});

// Ctrl+C sans sélection de texte : la cellule part au presse-papiers (texte plat +
// balisage en text/html) ; une plage part en TSV + <table> minimal — ce que le collage
// de l'éditeur et Excel savent relire.
test('éditeur de tableau : Ctrl+C copie la cellule, ou la plage en TSV', () => {
  const table = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'table-model.js'));
  const page = ouvrir({ racine: RACINE, page: 'table-editor', cssPartage: ['_design.css'] });
  const modele = table.analyserTable('<table><tr><td>Alpha</td><td><strong>Beta</strong></td></tr>'
    + '<tr><td>Gamma</td><td>Delta</td></tr></table>');
  page.envoyer({ type: 'charger', modele: modele, disposition: table.disposition(modele),
                 accent: '', teintes: {}, presets: [], i18n: libellesTable() });
  const cells = page.parId.zone.querySelectorAll('.cell');
  const cellA = (r, c) => cells.find((e) => +e.dataset.r0 === r && +e.dataset.c0 === c);
  cellA(0, 1).dispatchEvent({ type: 'mousedown', button: 0 });
  const seul = {};
  page.parId.zone.dispatchEvent({ type: 'copy', clipboardData: { setData: (t, v) => { seul[t] = v; } } });
  assert.strictEqual(seul['text/plain'], 'Beta', 'le texte plat de la cellule n’est pas copié');
  assert.strictEqual(seul['text/html'], '<strong>Beta</strong>', 'le balisage de la cellule est perdu');
  // Plage 2 x 2 par Maj+clic : TSV + <table> minimal.
  cellA(0, 0).dispatchEvent({ type: 'mousedown', button: 0 });
  cellA(1, 1).dispatchEvent({ type: 'mousedown', button: 0, shiftKey: true });
  const plage = {};
  page.parId.zone.dispatchEvent({ type: 'copy', clipboardData: { setData: (t, v) => { plage[t] = v; } } });
  assert.strictEqual(plage['text/plain'], 'Alpha\tBeta\nGamma\tDelta');
  assert.ok(/^<table><tr><td>Alpha<\/td><td><strong>Beta<\/strong><\/td><\/tr>/.test(plage['text/html']),
    'la plage doit partir en <table> minimal : ' + plage['text/html']);
});

// ---- Autocomplétion des auteur·e·s publiés (media/_auteurs.js, lot 9) ----
//
// L'hôte envoie « auteurs-connus » avec les valeurs ; la modale suggère à la frappe dans
// prénom ou nom, insensible à la casse et aux accents, pilotable au clavier comme au clic,
// et ne remplit QUE prénom et nom. Sans liste reçue : aucune UI.

function pageAvecModaleAuteur() {
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  page.envoyer({ type: 'valeurs', articles: [{ slug: '01-essai', valeurs: analyserMeta('') }],
                 types: TYPES, langue: 'fr', licences: LICENCES,
                 licenceDefaut: LICENCE_DEFAUT, filtre: null });
  return page;
}

// La modale s’ouvre par le bouton « Ajouter » de la zone des auteur·e·s (fiche vide, un
// seul bouton). Les champs se prennent dans l'ordre de construction — NOM d'abord, puis
// prénom : c'est par le nom qu'on cherche et qu'on désigne quelqu'un.
function ouvrirModaleAuteur(page) {
  page.conteneur().querySelector('.auteurs button').click();
  const champs = page.document.body.querySelectorAll('.auteur-grille input');
  assert.ok(champs.length >= 7, 'champs de la modale introuvables');
  return {
    nom: champs[0], prenom: champs[1], fonction: champs[2],
    affiliation: champs[3], ror: champs[4], orcid: champs[5], email: champs[6]
  };
}

function taper(champ, texte) {
  champ.value = texte;
  champ.dispatchEvent({ type: 'input' });
}

// Le texte des suggestions, dans l'ordre affiché, et la part mise en gras de chacune.
function suggestions(page) {
  return page.document.body.querySelectorAll('.auteur-sugg').map((b) => ({
    texte: b.textContent,
    gras: b.enfants.filter((e) => e.balise === 'strong').map((e) => e.textContent).join('|')
  }));
}

test('modale auteur : le nom est à gauche, le prénom à droite, et le ROR a son champ', () => {
  const page = pageAvecModaleAuteur();
  const champs = ouvrirModaleAuteur(page);
  assert.strictEqual(champs.nom.id, 'auteur-nom', 'le premier champ n’est pas le nom');
  assert.strictEqual(champs.prenom.id, 'auteur-prenom', 'le second champ n’est pas le prénom');
  assert.strictEqual(champs.ror.id, 'auteur-ror', 'le champ ROR manque à la modale');
});

test('modale auteur : suggestions à la frappe, clavier et clic', () => {
  const page = pageAvecModaleAuteur();
  page.envoyer({ type: 'auteurs-connus', auteurs: [
    { prenom: 'Robin', nom: 'Morand' },
    { prenom: 'Hilary', nom: 'Wood de Wilde' },
    { prenom: 'María', nom: 'Núñez' }
  ] });
  const champs = ouvrirModaleAuteur(page);

  // Moins de deux caractères : rien. Deux : la liste, filtrée sans casse ni accents.
  taper(champs.nom, 'm');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 0, 'suggestion sur un seul caractère');
  taper(champs.nom, 'mor');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 1);
  assert.strictEqual(suggestions(page)[0].texte, 'Robin Morand');
  // « nunez » sans accents trouve « Núñez ».
  taper(champs.nom, 'nunez');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 1);
  // Le début de CHAQUE MOT compte : sans cela « wilde » ne trouverait pas « Wood de Wilde »,
  // et nos particules — « de », « von », « van » — rendraient la moitié des noms
  // introuvables autrement qu'en tapant la particule.
  taper(champs.nom, 'wilde');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 1, 'le début de mot ne compte pas');
  // La saisie de plusieurs mots cherche à travers prénom ET nom.
  taper(champs.nom, 'hilary wood');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 1, 'l’ordre « prénom nom » ne trouve pas');
  // Aucune correspondance : la boîte disparaît, pas d'UI parasite.
  taper(champs.nom, 'zzzz');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 0);
  assert.strictEqual(page.compterPage('.auteur-suggestions'), 0, 'boîte vide restée accrochée');

  // Clavier : flèche pour armer, Entrée pour choisir.
  taper(champs.nom, 'mor');
  champs.nom.dispatchEvent({ type: 'keydown', key: 'ArrowDown' });
  assert.strictEqual(page.compterPage('.auteur-sugg.actif'), 1, 'la flèche n’arme aucune ligne');
  champs.nom.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.strictEqual(champs.prenom.value, 'Robin');
  assert.strictEqual(champs.nom.value, 'Morand');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 0, 'liste restée ouverte après le choix');

  // Clic : la frappe dans PRÉNOM suggère aussi, et le clic remplit les deux champs.
  taper(champs.prenom, 'hila');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 1);
  page.document.body.querySelector('.auteur-sugg').click();
  assert.strictEqual(champs.prenom.value, 'Hilary');
  assert.strictEqual(champs.nom.value, 'Wood de Wilde');

  // Échap ferme la LISTE et coupe la propagation : la modale, elle, reste ouverte.
  taper(champs.nom, 'mor');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 1);
  let propagationCoupee = false;
  champs.nom.dispatchEvent({ type: 'keydown', key: 'Escape',
    stopPropagation: () => { propagationCoupee = true; } });
  assert.strictEqual(page.compterPage('.auteur-sugg'), 0, 'Échap n’a pas fermé la liste');
  assert.ok(propagationCoupee, 'Échap fermerait la modale entière avec la liste');
  assert.strictEqual(page.compterPage('.voile-auteur')
    - page.document.body.querySelectorAll('.voile-auteur').filter((v) => v.hidden).length,
    1, 'la modale ne devrait pas se fermer avec la liste');
});

// Le tri demandé : on cherche presque toujours par nom de famille. Les noms passent donc
// devant, un filet les sépare des prénoms, et chaque groupe est trié dans l'alphabet.
test('modale auteur : noms de famille d’abord, filet, puis prénoms — la part trouvée en gras', () => {
  const page = pageAvecModaleAuteur();
  page.envoyer({ type: 'auteurs-connus', auteurs: [
    { prenom: 'Fabrice', nom: 'Morand' },
    { prenom: 'Anne', nom: 'Favre' },
    { prenom: 'Marc', nom: 'Fabre' },
    { prenom: 'Fanny', nom: 'Blanc' },
    { prenom: 'Chloé', nom: 'Fasel' }
  ] });
  const champs = ouvrirModaleAuteur(page);
  taper(champs.nom, 'fa');
  const vues = suggestions(page);
  assert.deepStrictEqual(vues.map((v) => v.texte),
    ['Marc Fabre', 'Chloé Fasel', 'Anne Favre', 'Fabrice Morand', 'Fanny Blanc'],
    'les noms de famille doivent passer devant, chaque groupe dans l’alphabet');
  assert.strictEqual(page.compterPage('.auteur-sugg-filet'), 1, 'le filet de séparation manque');
  // Le gras porte sur la part trouvée, et sur elle seule.
  assert.deepStrictEqual(vues.map((v) => v.gras), ['Fa', 'Fa', 'Fa', 'Fa', 'Fa']);

  // Un seul groupe : pas de filet orphelin.
  taper(champs.nom, 'blan');
  assert.strictEqual(page.compterPage('.auteur-sugg-filet'), 0, 'filet posé sans second groupe');
});

// Le gras se calcule sur le texte plié (sans accents) mais s'applique à l'original : les
// deux n'ont pas toujours la même longueur, et un découpage naïf glisserait.
test('modale auteur : le gras retombe juste sur un nom accentué', () => {
  const page = pageAvecModaleAuteur();
  page.envoyer({ type: 'auteurs-connus', auteurs: [{ prenom: 'María', nom: 'Núñez' }] });
  const champs = ouvrirModaleAuteur(page);
  taper(champs.nom, 'nun');
  const vue = suggestions(page)[0];
  assert.strictEqual(vue.texte, 'María Núñez', 'le texte affiché doit rester l’original accentué');
  assert.strictEqual(vue.gras, 'Núñ', 'le gras a glissé sur les accents');
});

// Règle du remplissage : le nom et le prénom sont écrasés, le reste ne remplit que du vide.
test('modale auteur : une suggestion remplit le vide et n’efface aucune correction', () => {
  const page = pageAvecModaleAuteur();
  page.envoyer({ type: 'auteurs-connus', auteurs: [{
    prenom: 'Géraldine', nom: 'Ayer', fonction: 'Collaboratrice scientifique',
    affiliation: 'SZH/CSPS', ror: 'https://ror.org/00w9q2c06',
    orcid: 'https://orcid.org/0000-0002-1825-0097', email: 'geraldine.ayer@csps.ch'
  }] });
  const champs = ouvrirModaleAuteur(page);
  // Une fonction déjà corrigée à la main : la personne a changé de poste depuis.
  champs.fonction.value = 'Directrice';
  taper(champs.nom, 'ayer');
  page.document.body.querySelector('.auteur-sugg').click();
  assert.strictEqual(champs.nom.value, 'Ayer');
  assert.strictEqual(champs.prenom.value, 'Géraldine');
  assert.strictEqual(champs.fonction.value, 'Directrice', 'la correction tapée a été écrasée');
  assert.strictEqual(champs.affiliation.value, 'SZH/CSPS');
  assert.strictEqual(champs.ror.value, 'https://ror.org/00w9q2c06');
  assert.strictEqual(champs.email.value, 'geraldine.ayer@csps.ch');
  assert.strictEqual(champs.orcid.value, 'https://orcid.org/0000-0002-1825-0097');
});

test('modale auteur : sans liste reçue, aucune UI — et une liste difforme ne casse rien', () => {
  const page = pageAvecModaleAuteur();
  const champs = ouvrirModaleAuteur(page);
  taper(champs.nom, 'morand');
  assert.strictEqual(page.compterPage('.auteur-suggestions'), 0, 'UI parasite sans liste');
  // Une liste hostile — entrées vides, types faux — est filtrée sans exception.
  page.envoyer({ type: 'auteurs-connus', auteurs: [
    null, {}, { prenom: '', nom: '' }, { prenom: 42, nom: ['x'] }, { prenom: ' Anne ', nom: ' Dupont ' }
  ] });
  taper(champs.nom, 'dupo');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 1, 'l’entrée valide devrait survivre au tri');
  assert.strictEqual(suggestions(page)[0].texte, 'Anne Dupont');
  // Dix suggestions au plus : une liste de trente homonymes ne fait pas un menu d'un mètre.
  const beaucoup = [];
  for (let i = 0; i < 30; i++) { beaucoup.push({ prenom: 'P' + i, nom: 'Morand' }); }
  page.envoyer({ type: 'auteurs-connus', auteurs: beaucoup });
  taper(champs.nom, 'morand');
  assert.strictEqual(page.compterPage('.auteur-sugg'), 10, 'plafond de suggestions absent');
});

// ---- Le compteur de caractères du résumé (media/_fiches.js, seuilResume) ----
//
// La mise en page bascule un résumé en page 2 selon un seuil PAR PALIER : ~830 caractères
// jusqu'à 5 mots-clés, ~730 dès le sixième — la même langue que le résumé, puisque c'est ce
// qui s'imprime avec lui. Le compteur affiché reste prudemment en deçà (750, puis 700), et
// c'est cette seule marche — le passage du 5e au 6e mot-clé — qui peut se tromper en
// silence : un seuil qui resterait figé à 750 se tromperait de cent caractères sans qu'aucun
// autre contrôle ne le remarque.

function compteurResume(carte, langue) {
  return carte.querySelectorAll('.compteur-resume').find((el) => el.dataset.langue === langue);
}

test('compteur du résumé : le seuil bascule de 750 à 700 au sixième mot-clé, par langue', () => {
  const resumeFr = 'x'.repeat(720);
  const resumeDe = 'y'.repeat(720);
  const articles = [{
    slug: '01-essai',
    valeurs: {
      lang: 'fr',
      resume: { fr: resumeFr, de: resumeDe },
      // FR : 5 mots-clés -> seuil 750 au départ. DE : déjà 6 -> seuil 700 dès le rendu,
      // pour prouver que le calcul est bien PAR LANGUE et non un seuil unique de carte.
      keywords: {
        fr: ['un', 'deux', 'trois', 'quatre', 'cinq'],
        de: ['eins', 'zwei', 'drei', 'vier', 'fuenf', 'sechs']
      }
    }
  }];
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  page.envoyer({ type: 'valeurs', articles: articles, types: TYPES, langue: 'fr',
                 licences: LICENCES, licenceDefaut: LICENCE_DEFAUT, filtre: null });
  const carte = page.conteneur().querySelectorAll('.carte')[0];
  assert.ok(carte, 'carte absente');

  // Deux résumés (fr, de hérité car ses mots-clés portent déjà du contenu), deux
  // compteurs indépendants — chacun avec SON seuil, pas celui de l'autre langue.
  const cFr = compteurResume(carte, 'fr');
  const cDe = compteurResume(carte, 'de');
  assert.ok(cFr, 'compteur du résumé français absent');
  assert.ok(cDe, 'compteur du résumé allemand absent');
  assert.match(cFr.textContent, /720/, 'le compteur ne compte pas les caractères saisis');
  assert.match(cFr.textContent, /750/, 'le seuil à 5 mots-clés ou moins doit être 750');
  assert.ok(cFr.classes.has('compteur-resume--proche'),
    '720/750 est proche du seuil : le signal progressif est absent');
  assert.ok(!cFr.classes.has('compteur-resume--depasse'), '720 < 750 : pas encore dépassé');
  assert.match(cDe.textContent, /700/, 'le compteur allemand ignore ses 6 mots-clés (devrait afficher 700)');
  assert.ok(cDe.classes.has('compteur-resume--depasse'),
    '720 caractères avec 6 mots-clés (seuil 700) doivent se lire comme dépassés');

  // Le compteur suit aussi la frappe EN DIRECT dans le résumé lui-même, espaces
  // comprises, sans toucher aux mots-clés : dix caractères de plus doivent se lire
  // aussitôt, avant même que quoi que ce soit ne soit enregistré.
  const champResumeFr = carte.querySelectorAll('.champs-textes textarea')
    .find((t) => t.dataset.cle === 'resume' && t.dataset.langue === 'fr');
  assert.ok(champResumeFr, 'champ du résumé français introuvable');
  champResumeFr.value = resumeFr + '0123456789';
  champResumeFr.dispatchEvent({ type: 'input' });
  assert.match(cFr.textContent, /730/, 'le compteur ne suit pas la frappe dans le résumé');

  // Le basculement du seuil au sixième mot-clé lui-même : la grille de mots-clés est
  // UNE SEULE grille par article, dont l'absorption des cases vers le modèle (_commun.js)
  // n'est pas rejouable dans ce DOM minimal (son sélecteur « :not() » n'y est pas
  // implémenté, voir dom-minimal.js) — on rejoue donc l'arrivée d'une fiche à 6 mots-clés
  // français exactement comme l'hôte la renverrait après un enregistrement, plutôt que de
  // simuler la frappe case par case. Le calcul exercé (seuilResume, compterMotsClesLangue)
  // est le même dans les deux cas.
  const article6 = {
    slug: '01-essai',
    valeurs: {
      lang: 'fr',
      resume: { fr: resumeFr, de: resumeDe },
      keywords: {
        fr: ['un', 'deux', 'trois', 'quatre', 'cinq', 'six'],
        de: ['eins', 'zwei', 'drei', 'vier', 'fuenf', 'sechs']
      }
    }
  };
  page.envoyer({ type: 'valeurs', articles: [article6], types: TYPES, langue: 'fr',
                 licences: LICENCES, licenceDefaut: LICENCE_DEFAUT, filtre: null });
  const carte6 = page.conteneur().querySelectorAll('.carte')[0];
  const cFr6 = compteurResume(carte6, 'fr');
  const cDe6 = compteurResume(carte6, 'de');
  // Le sixième mot-clé français fait basculer SEULEMENT le seuil français à 700 — celui
  // de l'allemand, déjà à 6 mots-clés avant comme après, ne bouge pas.
  assert.match(cFr6.textContent, /700/,
    'le seuil français ne suit pas son sixième mot-clé : ' + cFr6.textContent);
  assert.ok(cFr6.classes.has('compteur-resume--depasse'),
    '720 ≥ 700 : le compteur français doit maintenant se lire comme dépassé');
  assert.ok(!cFr6.classes.has('compteur-resume--proche'),
    'la classe « proche » aurait dû céder la place à « dépassé »');
  assert.match(cDe6.textContent, /700/);
  assert.ok(cDe6.classes.has('compteur-resume--depasse'));
});
