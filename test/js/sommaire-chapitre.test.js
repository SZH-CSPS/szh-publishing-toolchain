// Case « Ne pas afficher ce chapitre dans la table des matières » (formulaire des fiches,
// livre seulement) : la clé `sommaire: non` de <slug>.meta.yaml, sa case dans le
// formulaire, et pourquoi un article n'en montre jamais rien.
//
//   node --test test/js/sommaire-chapitre.test.js
//
// pipeline/profils/livre.mk (CHAPITRES_HORS_SOMMAIRE) accepte déjà `non` et `false` lus à
// la main dans le fichier ; ce lot ajoute la case qui écrit ce que la chaîne sait déjà lire.
// Ce que ce fichier tient :
//   * une fiche sans `sommaire` sort exactement comme avant que ce champ existe ;
//   * cochée -> `sommaire: non` ; décochée -> la clé est RETIRÉE, jamais `sommaire: oui` ;
//   * les autres clés (picto-entete, les champs d'un auteur de collectif) ne bougent pas ;
//   * la case n'existe dans le DOM que pour un livre, jamais pour un article.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');
const yaml = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));
const { TEXTES_COCKPIT } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

const LF = String.fromCharCode(10);

// ---- lib/yaml.js : lecture/écriture de la clé `sommaire:` ----

test('estHorsSommaire : « non » et « false » seuls valent hors sommaire', () => {
  for (const v of ['non', 'NON', ' non ', 'false', 'FALSE', '  False  ']) {
    assert.strictEqual(yaml.estHorsSommaire(v), true, 'devrait être hors sommaire : ' + JSON.stringify(v));
  }
  for (const v of ['oui', 'true', '', 'peut-être', undefined, null, 'non-mais-pas-vraiment']) {
    assert.strictEqual(yaml.estHorsSommaire(v), false, 'ne devrait pas être hors sommaire : ' + JSON.stringify(v));
  }
});

test('analyserMeta : sommaire non/false lit horsSommaire=true, absente lit false', () => {
  assert.strictEqual(yaml.analyserMeta('sommaire: non' + LF).horsSommaire, true);
  assert.strictEqual(yaml.analyserMeta('sommaire: false' + LF).horsSommaire, true);
  assert.strictEqual(yaml.analyserMeta('sommaire: oui' + LF).horsSommaire, false,
    '« oui » n’a jamais été une forme valide, il ne doit pas se lire comme hors sommaire');
  assert.strictEqual(yaml.analyserMeta('lang: fr' + LF).horsSommaire, false);
  assert.strictEqual(yaml.analyserMeta('').horsSommaire, false);
});

test('serialiserMeta : seul « non » s’écrit, jamais « sommaire: oui »', () => {
  const avecCle = yaml.serialiserMeta({ lang: 'fr', horsSommaire: true, title: { fr: 'T' } });
  assert.match(avecCle, /^sommaire: non$/m);
  assert.ok(!/oui/.test(avecCle), 'un « oui » est apparu quelque part dans la fiche');
  const sansCle = yaml.serialiserMeta({ lang: 'fr', horsSommaire: false, title: { fr: 'T' } });
  assert.ok(!/^sommaire:/m.test(sansCle),
    'une case décochée ne doit écrire aucune clé sommaire, jamais « sommaire: oui »');
});

test('aller-retour : cocher écrit la clé, décocher la retire — pas de doublon', () => {
  const m = yaml.analyserMeta('lang: fr' + LF);
  assert.strictEqual(m.horsSommaire, false, 'une fiche sans clé doit se lire comme « au sommaire »');
  m.horsSommaire = true;
  const avecCle = yaml.serialiserMeta(m);
  assert.match(avecCle, /^sommaire: non$/m);
  assert.strictEqual((avecCle.match(/^sommaire:/gm) || []).length, 1, 'la clé sommaire s’est dupliquée');
  const relu = yaml.analyserMeta(avecCle);
  assert.strictEqual(relu.horsSommaire, true);
  relu.horsSommaire = false;
  const sansCle = yaml.serialiserMeta(relu);
  assert.ok(sansCle.indexOf('sommaire') === -1, 'la clé sommaire n’a pas été retirée : ' + sansCle);
});

test('la fiche garde ses autres clés : picto-entete et les champs d’un auteur de collectif', () => {
  // Le gabarit réel de livre-template/chapitres/01-exemple/01-exemple.meta.yaml : une
  // fiche de chapitre en ouvrage collectif, avec un picto d'en-tête déjà posé.
  const src = [
    'picto-entete: ecouter', 'lang: fr', 'title:', '  fr: "Chapitre d’exemple"',
    'author:', '- prenom: "Prénom"', '  nom: "Nom"', '  fonction: "Rédacteur ou rédactrice"',
    '  affiliation: "SZH/CSPS"', ''
  ].join(LF);
  const relu = yaml.analyserMeta(src);
  assert.strictEqual(relu.horsSommaire, false);
  relu.horsSommaire = true;
  const sortie = yaml.serialiserMeta(relu);
  assert.ok(sortie.indexOf('picto-entete: ecouter') !== -1,
    'picto-entete a disparu de la fiche : ' + sortie);
  assert.match(sortie, /^sommaire: non$/m);
  assert.ok(sortie.indexOf('affiliation: "SZH/CSPS"') !== -1, 'un champ de l’auteur a disparu');
  assert.ok(sortie.indexOf('fonction: "Rédacteur ou rédactrice"') !== -1);
  // Décoche à son tour : la fiche revient à son état d’avant, picto-entete et auteur compris.
  const relu2 = yaml.analyserMeta(sortie);
  relu2.horsSommaire = false;
  const revenu = yaml.serialiserMeta(relu2);
  assert.ok(revenu.indexOf('sommaire') === -1, 'la clé sommaire traîne encore : ' + revenu);
  assert.ok(revenu.indexOf('picto-entete: ecouter') !== -1);
  assert.ok(revenu.indexOf('affiliation: "SZH/CSPS"') !== -1);
});

// ---- Les textes fr/de ----

test('la case et sa ligne d’aide ont un texte en français et en allemand', () => {
  for (const langue of ['fr', 'de']) {
    const libelle = TEXTES_COCKPIT[langue]['fiches.sommaire'];
    const aide = TEXTES_COCKPIT[langue]['fiches.sommaire.aide'];
    assert.ok(libelle && libelle.length > 5, 'libellé de la case absent en ' + langue);
    assert.ok(aide && aide.length > 5, 'ligne d’aide absente en ' + langue);
  }
  assert.match(TEXTES_COCKPIT.fr['fiches.sommaire'], /table des matières/);
  assert.match(TEXTES_COCKPIT.de['fiches.sommaire'], /Inhaltsverzeichnis/);
});

// ---- Le formulaire des fiches (media/_fiches.js), livre et revue ----

const TYPES = [{ valeur: 'chapitre', libelle: 'Chapitre', groupe: '' }];

function licencesHote() {
  return yaml.LICENCES_ARTICLE.map((l) => ({
    valeur: l.cle, libelle: TEXTES_COCKPIT.fr['licence.' + l.cle]
  }));
}

function ouvrirFiches(articles, estLivre) {
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  page.envoyer({
    type: 'valeurs', articles: articles, types: TYPES, langue: 'fr', filtre: null,
    estLivre: estLivre === true,
    licences: licencesHote(), licenceDefaut: yaml.LICENCE_DEFAUT
  });
  return page;
}

test('livre : chaque carte offre la case « hors sommaire », cochée selon la fiche', () => {
  const page = ouvrirFiches([
    { slug: '01-ouverture', valeurs: { horsSommaire: true, title: { fr: 'T' } } },
    { slug: '02-suite', valeurs: { horsSommaire: false, title: { fr: 'T' } } }
  ], true);
  const cocheOuverture = page.conteneur()
    .querySelectorAll('[data-slug="01-ouverture"] [data-cle="sommaire"]')[0];
  assert.ok(cocheOuverture, 'la case hors sommaire est absente d’une carte de chapitre');
  assert.strictEqual(cocheOuverture.balise, 'input');
  assert.strictEqual(cocheOuverture.type, 'checkbox');
  assert.strictEqual(cocheOuverture.checked, true, 'la case ne reprend pas horsSommaire=true de la fiche');
  const cocheSuite = page.conteneur()
    .querySelectorAll('[data-slug="02-suite"] [data-cle="sommaire"]')[0];
  assert.strictEqual(cocheSuite.checked, false, 'la case ne reprend pas horsSommaire=false de la fiche');
  // Le libellé et la ligne d'aide sont bien du texte de l'hôte (i18n), pas codés en dur ici.
  const texte = page.textes();
  assert.ok(texte.indexOf(TEXTES_COCKPIT.fr['fiches.sommaire']) !== -1, 'libellé de la case absent du DOM');
  assert.ok(texte.indexOf(TEXTES_COCKPIT.fr['fiches.sommaire.aide']) !== -1, 'ligne d’aide absente du DOM');
});

test('revue : la case « hors sommaire » n’existe jamais, même si la fiche portait la clé', () => {
  const page = ouvrirFiches([
    { slug: '01-article', valeurs: { horsSommaire: true, title: { fr: 'T' } } }
  ], false);
  assert.strictEqual(page.compter('[data-cle="sommaire"]'), 0,
    'la case hors sommaire est apparue sur un article de revue/Zeitschrift');
  const texte = page.textes();
  assert.strictEqual(texte.indexOf(TEXTES_COCKPIT.fr['fiches.sommaire']), -1,
    'le libellé de la case apparaît quand même dans le DOM d’un article');
});

// ---- type, licence, DOI, mots-clés : absents pour un chapitre -----------------------
//
// Aucun sens pour un livre : pas de taxonomie d'article, pas de licence par chapitre, pas
// d'export OJS (donc pas de DOI), pas de classification thématique edudoc/thésaurus.

test('livre : la fiche n’offre ni type, ni licence, ni DOI, ni mots-clés', () => {
  const page = ouvrirFiches([
    { slug: '01-ouverture', valeurs: { type: 'article', licence: 'droits-reserves',
      doi: '10.57161/x', keywords: { fr: ['inclusion'] }, title: { fr: 'T' } } }
  ], true);
  const carte = page.conteneur().querySelectorAll('[data-slug="01-ouverture"]')[0];
  assert.strictEqual(carte.querySelectorAll('[data-cle="type"]').length, 0,
    'le champ type apparaît sur une carte de chapitre');
  assert.strictEqual(carte.querySelectorAll('[data-cle="licence"]').length, 0,
    'le champ licence apparaît sur une carte de chapitre');
  assert.strictEqual(carte.querySelectorAll('[data-cle="doi"]').length, 0,
    'le champ DOI apparaît sur une carte de chapitre');
  assert.strictEqual(carte.querySelectorAll('[data-cle="doi-manuel"]').length, 0,
    'la case DOI manuel apparaît sur une carte de chapitre');
  assert.strictEqual(carte.querySelectorAll('[data-cle="keywords"]').length, 0,
    'la grille de mots-clés apparaît sur une carte de chapitre');
});

test('revue : type, licence, DOI et mots-clés restent offerts (non-régression)', () => {
  const page = ouvrirFiches([
    { slug: '01-article', valeurs: { type: 'article', licence: 'droits-reserves', title: { fr: 'T' } } }
  ], false);
  const carte = page.conteneur().querySelectorAll('[data-slug="01-article"]')[0];
  assert.strictEqual(carte.querySelectorAll('[data-cle="type"]').length, 1,
    'le champ type a disparu d’une carte d’article');
  assert.strictEqual(carte.querySelectorAll('[data-cle="licence"]').length, 1,
    'le champ licence a disparu d’une carte d’article');
  assert.strictEqual(carte.querySelectorAll('[data-cle="doi"]').length, 1,
    'le champ DOI a disparu d’une carte d’article');
  assert.strictEqual(carte.querySelectorAll('[data-cle="keywords"]').length, 1,
    'la grille de mots-clés a disparu d’une carte d’article');
});

// changerLangue() lit `editeurMots` sans garde suffisante avant ce lot : absent pour un
// chapitre (ESTLIVRE), il fallait vérifier que changer la langue de la fiche ne lève
// toujours rien — compterMotsClesLangue() le tolérait déjà, changerLangue() non.
test('livre : changer la langue de la fiche d’un chapitre ne lève rien sans grille de mots-clés', () => {
  const page = ouvrirFiches([
    { slug: '01-ouverture', valeurs: { lang: 'fr', title: { fr: 'T' } } }
  ], true);
  const carte = page.conteneur().querySelectorAll('[data-slug="01-ouverture"]')[0];
  const select = carte.querySelectorAll('[data-cle="lang"]')[0];
  assert.ok(select, 'le sélecteur de langue est absent d’une carte de chapitre');
  assert.doesNotThrow(() => {
    select.value = 'de';
    select.dispatchEvent({ type: 'input' });
  });
});

test('cocher la case puis enregistrer envoie horsSommaire=true à l’hôte', () => {
  const page = ouvrirFiches([
    { slug: '01-ouverture', valeurs: { horsSommaire: false, title: { fr: 'T' } } }
  ], true);
  const carte = page.conteneur().querySelectorAll('[data-slug="01-ouverture"]')[0];
  const coche = carte.querySelectorAll('[data-cle="sommaire"]')[0];
  assert.strictEqual(coche.checked, false);
  coche.checked = true;
  coche.dispatchEvent({ type: 'change' });
  assert.ok(carte.classList.contains('modifie'), 'cocher la case ne marque pas la carte modifiée');
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.ok(envoi, 'aucun message enregistrer envoyé ; messages : ' + JSON.stringify(page.messages));
  assert.strictEqual(envoi.articles['01-ouverture'].horsSommaire, true,
    'la case cochée ne part pas dans le message enregistrer');
});

test('décocher la case puis enregistrer envoie horsSommaire=false', () => {
  const page = ouvrirFiches([
    { slug: '01-ouverture', valeurs: { horsSommaire: true, title: { fr: 'T' } } }
  ], true);
  const carte = page.conteneur().querySelectorAll('[data-slug="01-ouverture"]')[0];
  const coche = carte.querySelectorAll('[data-cle="sommaire"]')[0];
  assert.strictEqual(coche.checked, true);
  coche.checked = false;
  coche.dispatchEvent({ type: 'change' });
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer').pop();
  assert.ok(envoi, 'aucun message enregistrer envoyé');
  assert.strictEqual(envoi.articles['01-ouverture'].horsSommaire, false,
    'la case décochée ne part pas comme horsSommaire=false');
});

// ---- L'hôte : gate côté nettoyerCarte et écriture réelle sur disque ----

const { livreDEssai, activerHote } = require('./hote-factice');
const fs = require('fs');

test('livre : l’aller-retour complet écrit « sommaire: non », préserve picto-entete', async () => {
  const livre = livreDEssai();
  const hote = activerHote(livre);
  const fichierMeta = path.join(livre, 'chapitres', '01-ouverture', '01-ouverture.meta.yaml');
  fs.writeFileSync(fichierMeta, [
    'picto-entete: ecouter', 'lang: fr', 'title:', '  fr: "Ouverture"', ''
  ].join(LF));

  await hote.arbre().getChildren();
  await hote.executer('szh.apercuMetadonnees');
  const p = hote.panneauDeType('szhApercuMetadonnees');
  assert.ok(p, 'panneau des métadonnées absent pour un livre');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.ok(charge, 'aucune valeur envoyée au panneau');
  assert.strictEqual(charge.estLivre, true, 'le panneau ne se sait pas ouvert sur un livre');
  const carteEnvoyee = charge.articles.filter((a) => a.slug === '01-ouverture')[0];
  assert.strictEqual(carteEnvoyee.valeurs.horsSommaire, false, 'la fiche d’essai ne doit pas déjà être hors sommaire');

  await p._recepteur({
    type: 'enregistrer', auto: true,
    articles: {
      '01-ouverture': {
        type: '', lang: 'fr', licence: '', doi: '', horsSommaire: true,
        title: { fr: 'Ouverture' }, subtitle: {}, resume: {}, keywords: {}, author: []
      }
    }
  });
  const apres = fs.readFileSync(fichierMeta, 'utf8');
  assert.match(apres, /^sommaire: non$/m, 'la case cochée n’a pas écrit « sommaire: non »');
  assert.ok(apres.indexOf('picto-entete: ecouter') !== -1, 'picto-entete a été perdu à l’enregistrement');
  assert.strictEqual(yaml.analyserMeta(apres).horsSommaire, true);

  // Décoche : la clé disparaît, picto-entete reste.
  await p._recepteur({
    type: 'enregistrer', auto: true,
    articles: {
      '01-ouverture': {
        type: '', lang: 'fr', licence: '', doi: '', horsSommaire: false,
        title: { fr: 'Ouverture' }, subtitle: {}, resume: {}, keywords: {}, author: []
      }
    }
  });
  const revenu = fs.readFileSync(fichierMeta, 'utf8');
  assert.ok(!/^sommaire:/m.test(revenu), 'la clé sommaire n’a pas été retirée par la décoche');
  assert.ok(revenu.indexOf('picto-entete: ecouter') !== -1, 'picto-entete a été perdu au retrait de la clé');
});

// La préservation de type/licence/doi/keywords hérités sur une fiche de chapitre, et la
// non-régression du même geste côté revue, vivent respectivement dans hote-livre.test.js
// et hote.test.js : chacun d'eux a déjà son propre activerHote() de tout le fichier — « un
// seul activerHote() par processus » (hote-factice.js) interdit d'en ajouter un ici.

// Le repli hors livre de nettoyerCarte() (defense en profondeur, même si la webview
// fournissait horsSommaire pour un article) vit dans son propre fichier : ce test-ci vient
// d'appeler activerHote(), qui pose déjà le profil 'livre' pour tout le processus — voir
// test/js/sommaire-chapitre-revue.test.js.
