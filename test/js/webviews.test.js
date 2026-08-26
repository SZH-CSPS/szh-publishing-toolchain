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
