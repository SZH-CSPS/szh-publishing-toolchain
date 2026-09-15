// La feuille « Vérifier les méta (print) » : lib/verif-meta.js et son gabarit
// print-templates/verification-meta.twig.
//
// Ce qui est tenu ici :
//   — TOUT champ du formulaire figure sur la feuille. C'est la demande d'origine, et la
//     liste des champs se prend dans yaml.js (CHAMPS_AUTEUR), pas dans une copie : un
//     huitième champ d'auteur·e ajouté au formulaire fera tomber ce banc.
//   — un champ vide s'imprime, marqué LEER. Une feuille de contrôle qui tait un champ
//     absent ne sert à rien : personne ne relève ce qu'il ne voit pas.
//   — le HTML est échappé. Le moteur de gabarits ne le fait pas tout seul ; un titre
//     contenant « < » doit rester du texte.
//   — un article ne partage jamais sa feuille avec un autre.
//
//   node --test test/js/verif-meta.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const verif = require(path.join(COCKPIT, 'lib', 'verif-meta'));
const { CHAMPS_AUTEUR } = require(path.join(COCKPIT, 'lib', 'yaml'));
const GABARIT = fs.readFileSync(
  path.join(COCKPIT, 'print-templates', 'verification-meta.twig'), 'utf8');

const TEXTES = {
  titrePage: 'Vérification', article: 'article', consigne: 'Consigne',
  noteMachine: 'Note', legende: 'Légende', verifiePar: 'Vérifié par', empreinte: 'empreinte',
  sectionIdentification: 'Identification', sectionTextes: 'Textes',
  sectionMotsCles: 'Mots-clés', sectionAuteurs: 'Auteurs', sectionAuteur: 'Auteur',
  doiCalcule: 'calculé', doiManuel: 'saisi à la main',
  type: 'Type', langue: 'Langue', licence: 'Licence', doi: 'DOI',
  titre: 'Titre', sousTitre: 'Sous-titre', resume: 'Résumé',
  prenom: 'Prénom', nom: 'Nom', fonction: 'Fonction', affiliation: 'Affiliation',
  courriel: 'Courriel', orcid: 'ORCID', ror: 'ROR'
};

const LIBELLES = {
  types: { dossier: 'Article du dossier' },
  licences: { ccby: 'CC BY 4.0' },
  langues: { fr: 'Français', de: 'Allemand', it: 'Italien' }
};

function article(valeurs, slug) {
  return { slug: slug || '01-essai', doiCalcule: '', valeurs: valeurs || {} };
}

function feuille(articles, extra) {
  const modele = verif.construireModele(articles,
    Object.assign({ numero: 'R2026-03', horodatage: '15.09.2026 14:22', libelles: LIBELLES, textes: TEXTES }, extra || {}));
  return verif.rendre(GABARIT, modele);
}

const COMPLET = {
  type: 'dossier', lang: 'fr', licence: 'ccby', doi: '',
  title: { fr: 'Un titre', de: 'Ein Titel' },
  subtitle: { fr: 'Un sous-titre', de: '' },
  resume: { fr: 'Corps du resume francais', de: 'Rumpf der deutschen Zusammenfassung' },
  keywords: { fr: ['école'], de: ['Schule'] },
  author: [{
    prenom: 'Marie', nom: 'Dupont', fonction: 'Professeure', affiliation: 'HEP',
    ror: 'https://ror.org/01swzsf04', orcid: 'https://orcid.org/0000-0002-1825-0097',
    email: 'marie.dupont@hepl.ch', photo: 'marie-dupont.jpg'
  }]
};

// ---- Le contrat d'origine : tout le formulaire est sur la feuille ------------------

test('chaque champ d’auteur·e du formulaire porte son intitulé sur la feuille', () => {
  const html = feuille([article(COMPLET)]);
  // `photo` est le seul champ du formulaire qui ne se relit pas sur papier : une image
  // ne se vérifie pas en lisant. Tous les autres doivent être là.
  const attendus = {
    prenom: TEXTES.prenom, nom: TEXTES.nom, fonction: TEXTES.fonction,
    affiliation: TEXTES.affiliation, ror: TEXTES.ror, orcid: TEXTES.orcid,
    email: TEXTES.courriel
  };
  for (const champ of CHAMPS_AUTEUR) {
    if (champ === 'photo') { continue; }
    assert.ok(attendus[champ], 'champ d’auteur·e sans intitulé sur la feuille : ' + champ);
    assert.ok(html.indexOf('>' + attendus[champ] + '<') !== -1,
      'intitulé absent de la feuille : ' + attendus[champ]);
  }
});

test('les valeurs d’auteur·e s’impriment toutes', () => {
  const html = feuille([article(COMPLET)]);
  for (const attendu of ['Marie', 'Dupont', 'Professeure', 'HEP']) {
    assert.ok(html.indexOf(attendu) !== -1, 'valeur absente : ' + attendu);
  }
  assert.ok(html.indexOf('marie.dupont') !== -1);
  assert.ok(html.indexOf('0000') !== -1);
});

test('les champs du numéro et les textes traduisibles y sont aussi', () => {
  const html = feuille([article(COMPLET)]);
  for (const attendu of [TEXTES.type, TEXTES.langue, TEXTES.licence, TEXTES.doi,
    TEXTES.titre, TEXTES.sousTitre]) {
    assert.ok(html.indexOf('>' + attendu + '<') !== -1, 'intitulé absent : ' + attendu);
  }
  // Le résumé ouvre un bloc pleine largeur : son intitulé est suivi de sa langue.
  assert.ok(html.indexOf('>' + TEXTES.resume + ' — ') !== -1, 'intitulé du résumé absent');
  assert.ok(html.indexOf('Article du dossier') !== -1, 'le type est rendu en clair');
  assert.ok(html.indexOf('CC BY 4.0') !== -1, 'la licence est rendue en clair');
});

// ---- Textes empilés, mots-clés en colonnes ------------------------------------------

test('un champ traduisible s’empile : une ligne par langue, la langue nommée', () => {
  const fiche = verif.construireFiche(article(COMPLET), { libelles: LIBELLES, textes: TEXTES }, 1, 1);
  // Trois champs (titre, sous-titre, résumé) x deux langues.
  assert.equal(fiche.textes.length, 6);
  assert.equal(fiche.textes[0].libelle, TEXTES.titre);
  assert.equal(fiche.textes[0].debutChamp, true);
  assert.equal(fiche.textes[0].langueLibelle, LIBELLES.langues.fr);
  // La deuxième ligne du même champ ne répète pas l’intitulé, et ouvre pas un champ.
  assert.equal(fiche.textes[1].libelle, '');
  assert.equal(fiche.textes[1].debutChamp, false);
  assert.equal(fiche.textes[1].langueLibelle, LIBELLES.langues.de);
  assert.equal(fiche.textes[2].libelle, TEXTES.sousTitre);
  assert.equal(fiche.textes[2].debutChamp, true);
});

test('les deux langues d’un même champ se suivent, elles ne sont pas côte à côte', () => {
  const html = feuille([article(COMPLET)]);
  const iFr = html.indexOf('Un titre');
  const iDe = html.indexOf('Ein Titel');
  assert.ok(iFr !== -1 && iDe !== -1);
  // Une ligne de tableau les sépare : c’est ce qui distingue l’empilement des colonnes.
  assert.ok(html.slice(iFr, iDe).indexOf('<tr') !== -1,
    'les deux langues sont dans la même rangée — elles devraient être empilées');
});

test('les mots-clés restent en COLONNES : c’est leur appariement qui se vérifie', () => {
  const html = feuille([article(COMPLET)]);
  const iFr = html.indexOf('école');
  const iDe = html.indexOf('Schule');
  assert.ok(iFr !== -1 && iDe !== -1);
  assert.ok(html.slice(iFr, iDe).indexOf('<tr') === -1,
    'les mots-clés appariés ont été séparés en deux rangées');
});

test('le résumé passe en pleine largeur : étiquette sur sa ligne, texte dessous', () => {
  const fiche = verif.construireFiche(article(COMPLET), { libelles: LIBELLES, textes: TEXTES }, 1, 1);
  const resumes = fiche.textes.filter((r) => r.pleineLargeur);
  assert.equal(resumes.length, 2, 'les deux langues du résumé, et elles seules');
  // Chaque bloc porte l’intitulé du champ ET sa langue : il se lit seul.
  for (const r of resumes) { assert.equal(r.libelle, TEXTES.resume); }
  assert.equal(resumes[0].langueLibelle, LIBELLES.langues.fr);
  assert.equal(resumes[1].langueLibelle, LIBELLES.langues.de);
});

test('le titre et le sous-titre restent en ligne : ils tiennent sur une ligne', () => {
  const fiche = verif.construireFiche(article(COMPLET), { libelles: LIBELLES, textes: TEXTES }, 1, 1);
  const enLigne = fiche.textes.filter((r) => !r.pleineLargeur);
  assert.equal(enLigne.length, 4);
  for (const r of enLigne) { assert.ok(r.pleineLargeur === false); }
});

test('le texte du résumé prend toute la largeur, sous son étiquette', () => {
  const html = feuille([article(COMPLET)]);
  const i = html.indexOf('Corps du resume francais');
  assert.ok(i !== -1);
  // La cellule qui le porte enjambe les colonnes d’intitulé et de langue.
  const avant = html.slice(0, i);
  assert.ok(avant.lastIndexOf('texte-bloc') > avant.lastIndexOf('col-langue-ligne'),
    'le résumé est resté dans la colonne des valeurs');
  assert.ok(html.indexOf('class="texte-bloc" colspan="3"') !== -1, 'aucune cellule pleine largeur');
});

// ---- Quatre yeux ---------------------------------------------------------------------

test('chaque ligne à vérifier porte DEUX cases : une par relecteur', () => {
  const html = feuille([article(COMPLET)]);
  const paire = '<td class="col-case"><span class="case"></span><span class="case"></span></td>';
  const paires = html.split(paire).length - 1;
  const cases = html.split('<span class="case">').length - 1;
  assert.ok(paires > 10, 'trop peu de rangées à cocher : ' + paires);
  // Aucune case orpheline : toutes vont par deux. La ligne de texte d'un bloc pleine
  // largeur n'en porte aucune — c'est son étiquette, juste au-dessus, qui se coche.
  assert.equal(cases, paires * 2, 'des cases isolées : ' + cases + ' pour ' + paires + ' paires');
});

// ---- Ce qui a été retiré de la feuille ------------------------------------------------

test('la feuille ne porte ni note d’en-tête, ni légende, ni ligne de signature', () => {
  const html = feuille([article(COMPLET)]);
  for (const classe of ['tete-note', 'legende', 'signature', 'ligne-sign', 'auteur-titre']) {
    assert.ok(html.indexOf(classe) === -1, 'reste de l’ancienne maquette : ' + classe);
  }
});

test('un seul titre pour toute la section des auteur·e·s', () => {
  const deux = Object.assign({}, COMPLET, {
    author: [{ prenom: 'Marie', nom: 'Dupont' }, { prenom: 'Jean', nom: 'Muster' }]
  });
  const html = feuille([article(deux)]);
  assert.equal(html.split(TEXTES.sectionAuteurs).length - 1, 1,
    'le titre de section est répété — il ne doit y en avoir qu’un');
  // Et un filet sépare les deux fiches.
  assert.equal(html.split('class="auteur"').length - 1, 2);
});

// ---- Un champ vide s'imprime -------------------------------------------------------

test('un champ vide porte la marque LEER, il ne disparaît pas', () => {
  const html = feuille([article(COMPLET)]);
  // Le sous-titre allemand est vide dans COMPLET : sa cellule doit le dire.
  assert.ok(html.indexOf('LEER') !== -1);
  assert.equal(verif.MARQUE_VIDE, 'LEER');
});

test('une fiche entièrement vide imprime quand même toutes ses rangées', () => {
  const html = feuille([article({})]);
  for (const attendu of [TEXTES.type, TEXTES.langue, TEXTES.licence, TEXTES.doi,
    TEXTES.titre, TEXTES.sousTitre]) {
    assert.ok(html.indexOf('>' + attendu + '<') !== -1, 'intitulé perdu sur fiche vide : ' + attendu);
  }
  assert.ok(html.indexOf('>' + TEXTES.resume + ' — ') !== -1, 'le résumé a disparu d’une fiche vide');
  const leer = html.split('LEER').length - 1;
  assert.ok(leer >= 6, 'une fiche vide doit afficher LEER partout, vu ' + leer + ' fois');
});

test('sans auteur·e, la section le dit au lieu de manquer', () => {
  const html = feuille([article({ author: [] })]);
  assert.ok(html.indexOf(TEXTES.sectionAuteurs) !== -1);
});

// ---- Échappement -------------------------------------------------------------------

test('un titre qui contient du HTML reste du texte', () => {
  const html = feuille([article({ title: { fr: '<script>alert(1)</script> & co' } })]);
  assert.ok(html.indexOf('<script>alert(1)</script>') === -1, 'balise injectée dans la page');
  assert.ok(html.indexOf('&lt;script&gt;') !== -1);
  assert.ok(html.indexOf('&amp; co') !== -1);
});

test('un slug et un courriel biscornus sont échappés eux aussi', () => {
  const html = feuille([article({ author: [{ email: 'a<b>@c.ch' }] }, '01-<x>')]);
  assert.ok(html.indexOf('01-<x>') === -1);
  assert.ok(html.indexOf('a&lt;b&gt;') !== -1);
});

// ---- Découpage des identifiants ----------------------------------------------------

test('un courriel se découpe au dernier @ puis à chaque point du domaine', () => {
  const r = verif.baliserIdentifiant('marie.dupont@hep-vd.ch', 'courriel');
  assert.ok(r.html.indexOf('>marie.dupont<') !== -1, 'la partie locale reste entière');
  assert.ok(r.html.indexOf('>@<') !== -1);
  assert.ok(r.html.indexOf('>hep-vd<') !== -1);
  assert.ok(r.html.indexOf('>ch<') !== -1);
});

test('un courriel à plusieurs @ se coupe au DERNIER, celui qui sépare le domaine', () => {
  const r = verif.baliserIdentifiant('a@b@szh.ch', 'courriel');
  assert.ok(r.html.indexOf('>a@b<') !== -1);
});

test('un ORCID perd son adresse en tête et garde ses groupes de quatre', () => {
  const r = verif.baliserIdentifiant('https://orcid.org/0000-0002-1825-0097', 'orcid');
  assert.ok(r.html.indexOf('orcid.org') === -1, 'l’adresse en tête n’est pas relue');
  for (const groupe of ['0000', '0002', '1825', '0097']) {
    assert.ok(r.html.indexOf('>' + groupe + '<') !== -1, 'groupe absent : ' + groupe);
  }
  assert.ok(r.html.indexOf('>-<') !== -1, 'le trait d’union est un caractère réel, il reste visible');
});

test('un ORCID nu (sans adresse) se découpe pareil', () => {
  const r = verif.baliserIdentifiant('0000-0002-1825-0097', 'orcid');
  assert.ok(r.html.indexOf('>1825<') !== -1);
});

test('un DOI se coupe à la PREMIÈRE barre : préfixe d’un côté, suffixe de l’autre', () => {
  const r = verif.baliserIdentifiant('10.57161/r2026-03-08', 'doi');
  assert.ok(r.html.indexOf('>10.57161<') !== -1);
  assert.ok(r.html.indexOf('>r2026-03-08<') !== -1);
});

test('un ROR se groupe par trois, et le signale : ce blanc-là n’existe pas dans la valeur', () => {
  const r = verif.baliserIdentifiant('https://ror.org/01swzsf04', 'ror');
  assert.equal(r.visuel, true);
  for (const groupe of ['01s', 'wzs', 'f04']) {
    assert.ok(r.html.indexOf('>' + groupe + '<') !== -1, 'groupe absent : ' + groupe);
  }
});

test('un identifiant vide est vide, pas une suite de groupes vides', () => {
  const r = verif.baliserIdentifiant('', 'orcid');
  assert.equal(r.vide, true);
  assert.equal(r.html, '');
});

// ---- Une page par article ----------------------------------------------------------

test('un article ne partage jamais sa feuille avec un autre', () => {
  const html = feuille([article(COMPLET, '01-un'), article(COMPLET, '02-deux')]);
  assert.equal(html.split('class="fiche"').length - 1, 2);
  assert.ok(/\.fiche\s*\{[^}]*break-after:\s*page/.test(html), 'la coupure de page est posée');
  assert.ok(html.indexOf('size: A4') !== -1);
});

test('la fiche porte son rang dans le numéro', () => {
  const html = feuille([article(COMPLET, '01-un'), article(COMPLET, '02-deux')]);
  assert.ok(html.indexOf('2 / 2') !== -1);
});

test('la consigne longue ne s’imprime pas', () => {
  const html = feuille([article(COMPLET)]);
  assert.ok(/@media print\s*\{\s*\.consigne\s*\{\s*display:\s*none/.test(html));
});

// ---- L'italien n'apparaît que s'il porte quelque chose ------------------------------

test('la colonne italienne reste absente tant que rien n’y est saisi', () => {
  const sansIt = verif.construireFiche(article(COMPLET), { libelles: LIBELLES, textes: TEXTES }, 1, 1);
  assert.deepEqual(sansIt.langues.map((l) => l.code), ['fr', 'de']);
});

test('un seul mot-clé italien suffit à ouvrir la colonne', () => {
  const valeurs = Object.assign({}, COMPLET, { keywords: { fr: ['a'], de: ['b'], it: ['c'] } });
  const fiche = verif.construireFiche(article(valeurs), { libelles: LIBELLES, textes: TEXTES }, 1, 1);
  assert.deepEqual(fiche.langues.map((l) => l.code), ['fr', 'de', 'it']);
});

test('les mots-clés restent appariés d’une langue à l’autre', () => {
  const valeurs = Object.assign({}, COMPLET, { keywords: { fr: ['un', 'deux'], de: ['eins'] } });
  const fiche = verif.construireFiche(article(valeurs), { libelles: LIBELLES, textes: TEXTES }, 1, 1);
  assert.equal(fiche.motsCles.length, 2, 'autant de rangées que la plus longue liste');
  assert.equal(fiche.motsCles[1].cellules[1].vide, true, 'la traduction manquante se voit');
});

// ---- L'empreinte -------------------------------------------------------------------

test('l’empreinte ne dépend pas de l’ordre des clés', () => {
  const a = verif.empreinte({ title: { fr: 'x' }, type: 'dossier' });
  const b = verif.empreinte({ type: 'dossier', title: { fr: 'x' } });
  assert.equal(a, b);
});

test('l’empreinte change dès qu’une valeur change : une feuille signée périme', () => {
  const avant = verif.empreinte({ title: { fr: 'x' } });
  const apres = verif.empreinte({ title: { fr: 'y' } });
  assert.notEqual(avant, apres);
});

test('l’empreinte s’imprime en pied de page', () => {
  const fiche = verif.construireFiche(article(COMPLET), { libelles: LIBELLES, textes: TEXTES }, 1, 1);
  const html = feuille([article(COMPLET)]);
  assert.ok(html.indexOf(fiche.empreinte) !== -1);
});

// ---- Le gabarit reste rendable -----------------------------------------------------

test('le gabarit livré rend son bloc « contenu », et le dit s’il le perd', () => {
  assert.throws(() => verif.rendre('{% block autre %}x{% endblock %}', verif.construireModele([], {})),
    /bloc « contenu » absent/);
});
