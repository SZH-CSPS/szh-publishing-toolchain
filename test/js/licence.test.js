// La licence d'un article : la clé `licence` de <slug>.meta.yaml, son choix dans le
// formulaire, et les trois endroits qui la disent.
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici est un seul, vu de trois côtés. « Cet article est sous licence
// Creative Commons CC-BY 4.0 » était écrit en dur dans szh-maquette.lua, l'adresse du
// lien en dur dans le gabarit HTML, et une troisième copie de cette adresse en dur dans
// lib/export-ojs.js. Aucun champ de fiche ne pouvait les contredire : un article reprenant
// une figure « © Getty » sortait avec ce crédit sous l'image ET la mention CC-BY 4.0 sur
// sa couverture, et partait ainsi dans OJS.
//
// Ce que ce fichier tient :
//   * une fiche sans `licence` sort exactement comme avant que le champ existe ;
//   * les trois consommateurs lisent la même table, et cette table n'a plus de jumelle ;
//   * « droits réservés » ne fabrique aucune adresse, nulle part ;
//   * le champ survit à un aller-retour par le formulaire — la carte de la webview ne
//     porte pas tout, et c'est ecrireCartesArticles() qui relit du fichier le reste.
//
// Le rendu lui-même se vérifie en compilant (voir le rapport de ce chantier) ; ici on
// garde ce qui se recopie d'un fichier à l'autre, plus le formulaire réellement exécuté
// et l'hôte réellement activé.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');

// Langue des messages fixée : hors de l'éditeur elle vient de l'environnement.
process.env.SZH_LANGUE = 'fr';

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));
const { TEXTES_COCKPIT } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const MAQUETTE = lire('pipeline', 'filters', 'szh-maquette.lua');
const GABARIT = lire('pipeline', 'templates', 'szh-article.html');
const FICHES = lire('vscodium-extension', 'szh-cockpit', 'media', '_fiches.js');
const COMMUN = lire('vscodium-extension', 'szh-cockpit', 'media', '_commun.js');
const OJS_SRC = lire('vscodium-extension', 'szh-cockpit', 'lib', 'export-ojs.js');
const LF = '\n';

// ---- La fiche d'article ----

test('fiche d’article : la licence est lue et réécrite telle quelle', () => {
  for (const l of yaml.LICENCES_ARTICLE) {
    const src = 'type: article' + LF + 'licence: ' + l.cle + LF + 'title:' + LF + '  fr: "T"' + LF;
    const relu = yaml.analyserMeta(src);
    assert.strictEqual(relu.licence, l.cle);
    assert.strictEqual(yaml.analyserMeta(yaml.serialiserMeta(relu)).licence, l.cle);
  }
});

test('fiche d’article : sans licence, rien n’est écrit et rien ne change', () => {
  // C'est le cas de tous les articles des numéros en cours. La fiche doit ressortir
  // caractère pour caractère, et la licence appliquée être celle de la revue.
  const src = 'type: article' + LF + 'lang: fr' + LF + 'title:' + LF + '  fr: "T"' + LF;
  const relu = yaml.analyserMeta(src);
  assert.strictEqual(relu.licence, '');
  assert.strictEqual(yaml.serialiserMeta(relu), src, 'la fiche a bougé sans qu’on y touche');
  assert.strictEqual(yaml.licenceArticle(relu.licence).cle, yaml.LICENCE_DEFAUT);
  assert.strictEqual(yaml.LICENCE_DEFAUT, 'cc-by-4.0', 'la licence par défaut de la revue a changé');
});

test('fiche d’article : une licence hors liste vaut « non déclarée »', () => {
  // Une valeur inattendue ne doit jamais s'imprimer : la couverture retombe sur la
  // licence de la revue, comme pour une fiche muette.
  for (const brute of ['cc-by', 'cc0', 'CC-BY-5.0', 'domaine public', '', 'http://x']) {
    assert.strictEqual(yaml.normaliserLicence(brute), '',
      'valeur acceptée à tort : ' + JSON.stringify(brute));
  }
  assert.strictEqual(yaml.analyserMeta('licence: cc0' + LF).licence, '');
  assert.strictEqual(yaml.licenceArticle('cc0').cle, yaml.LICENCE_DEFAUT);
  // La casse et les espaces, eux, se pardonnent : c'est la même licence.
  assert.strictEqual(yaml.normaliserLicence('  CC-BY-NC-ND-4.0 '), 'cc-by-nc-nd-4.0');
});

test('fiche d’article : la licence est un jeton nu, entre la source et le DOI', () => {
  // szh-maquette.lua relit cette ligne hors pandoc, avec un `^licence:%s*(.*)$` : la
  // valeur doit rester un jeton nu au premier niveau du fichier.
  const sortie = yaml.serialiserMeta({
    type: 'article', lang: 'de', source: 'A B.docx', licence: 'cc-by-nd-4.0',
    doi: '10.57161/z2026-03-05', title: { de: 'T' }
  });
  assert.match(sortie, /^licence: cc-by-nd-4\.0$/m);
  assert.ok(sortie.indexOf('source: ') < sortie.indexOf('licence: '), 'la source passe avant la licence');
  assert.ok(sortie.indexOf('licence: ') < sortie.indexOf('doi: '), 'la licence passe après le DOI');
});

// ---- Ce qui se recopie d'un fichier à l'autre ----

// La table de licences de szh-maquette.lua, relue depuis la source du filtre.
function licencesDuLua() {
  const debut = MAQUETTE.indexOf('local LICENCES = {');
  assert.notStrictEqual(debut, -1, 'table LICENCES introuvable dans szh-maquette.lua');
  const bloc = MAQUETTE.slice(debut, MAQUETTE.indexOf(LF + '}', debut));
  const res = [];
  const re = /\['([a-z0-9.-]+)'\]\s*=\s*\{ nom = '([^']*)',\s*url = '([^']*)' \}/g;
  let m;
  while ((m = re.exec(bloc)) !== null) { res.push({ cle: m[1], nom: m[2], url: m[3] }); }
  return res;
}

test('licences : une seule table, deux fichiers', () => {
  // lib/yaml.js décide, szh-maquette.lua imprime. Une table qui diverge, et le formulaire
  // offrirait une licence dont la couverture ne saurait rien dire — ou l'inverse.
  assert.deepStrictEqual(licencesDuLua(), yaml.LICENCES_ARTICLE.map((l) => ({
    cle: l.cle, nom: l.nom, url: l.url
  })));
  const mDefaut = MAQUETTE.match(/local LICENCE_DEFAUT = '([^']+)'/);
  assert.ok(mDefaut, 'LICENCE_DEFAUT introuvable dans szh-maquette.lua');
  assert.strictEqual(mDefaut[1], yaml.LICENCE_DEFAUT);
  // Six licences Creative Commons 4.0 — la suite complète — et le cas des droits réservés.
  assert.strictEqual(yaml.LICENCES_ARTICLE.length, 7);
  assert.strictEqual(yaml.LICENCES_ARTICLE.filter((l) => l.url !== '').length, 6);
});

test('couverture : la mention par défaut n’a pas bougé d’un caractère', () => {
  // Ce que trois numéros déjà publiés portent. La phrase est maintenant composée du
  // gabarit localisé et du sigle ; le résultat doit rester identique.
  const attendu = {
    de: 'Dieser Artikel steht unter der Lizenz Creative Commons CC-BY 4.0',
    fr: 'Cet article est sous licence Creative Commons CC-BY 4.0',
    it: 'Questo articolo è pubblicato sotto licenza Creative Commons CC-BY 4.0'
  };
  const bloc = MAQUETTE.slice(MAQUETTE.indexOf('local MENTION_CC = {'));
  for (const langue of Object.keys(attendu)) {
    const m = bloc.match(new RegExp('^  ' + langue + " = '([^']*)',$", 'm'));
    assert.ok(m, 'phrase Creative Commons absente en ' + langue);
    assert.strictEqual(m[1].replace('%s', 'CC-BY 4.0'), attendu[langue]);
  }
  // « Droits réservés » n'est pas une licence Creative Commons : sa mention est à part,
  // dans les trois langues, et l'allemand de la maison s'écrit en « ss ».
  const reserve = MAQUETTE.slice(MAQUETTE.indexOf('local MENTION_RESERVE = {'));
  for (const langue of ['de', 'fr', 'it']) {
    const m = reserve.match(new RegExp('^  ' + langue + " = '([^']*)',$", 'm'));
    assert.ok(m && m[1].trim() !== '', 'mention « droits réservés » absente en ' + langue);
    assert.ok(m[1].indexOf('Creative Commons') === -1,
      'la mention « droits réservés » ' + langue + ' se présente comme une licence CC');
  }
  assert.ok(reserve.slice(0, reserve.indexOf('}')).indexOf('ß') === -1, 'ß dans la mention allemande');
});

test('plus une seule adresse de licence en dur hors de la table', () => {
  // Le défaut d'origine : la même URL recopiée dans trois fichiers, dont deux ne
  // pouvaient plus être corrigés depuis la fiche.
  assert.ok(GABARIT.indexOf('creativecommons') === -1,
    'le gabarit HTML écrit encore une adresse de licence en dur');
  assert.ok(OJS_SRC.indexOf('creativecommons') === -1,
    'lib/export-ojs.js écrit encore une adresse de licence en dur');
  assert.ok(OJS_SRC.indexOf('URL_LICENCE') === -1, 'la constante URL_LICENCE est revenue');
  // Le gabarit prend l'adresse de l'article, et sait s'en passer.
  assert.match(GABARIT, /\$if\(licence-url\)\$/, 'le gabarit ne teste pas l’absence d’adresse');
  assert.match(GABARIT, /<a href="\$licence-url\$">\$licence-texte\$<\/a>/);
  // ⚠ PDF/UA-1 7.18.5 : le <a> ne contient que du texte, la flèche reste dehors. Et la
  // branche sans lien n'a ni <a> ni flèche.
  const sansLien = GABARIT.slice(GABARIT.indexOf('$else$', GABARIT.indexOf('$if(licence-url)$')),
    GABARIT.indexOf('$endif$', GABARIT.indexOf('$if(licence-url)$')));
  assert.match(sansLien, /<span class="szh-licence">\$licence-texte\$<\/span>/);
  assert.ok(sansLien.indexOf('<a ') === -1 && sansLien.indexOf('szh-arrow') === -1,
    'une mention sans adresse porte encore un lien ou sa flèche');
});

test('szh-maquette : la licence est lue dans la fiche de l’article, pas dans le numéro', () => {
  // Par la même porte que la langue : la fusion de pandoc ne dit pas de quel fichier une
  // clé vient, et une `licence:` posée dans ausgabe.yaml s'appliquerait à tout le numéro.
  assert.match(MAQUETTE, /lire_cle\(slug \.\. '\.meta\.yaml', 'licence'\)/);
  assert.ok(MAQUETTE.indexOf("meta['licence-url']") !== -1, 'le filtre ne pose pas l’adresse');
  assert.match(MAQUETTE, /licence_url ~= '' and pandoc\.MetaString\(licence_url\) or nil/,
    'une adresse vide n’est pas remise à nil : le gabarit imprimerait un lien creux');
});

test('licences : un libellé par entrée, en français et en allemand', () => {
  for (const langue of ['fr', 'de']) {
    assert.ok(TEXTES_COCKPIT[langue]['fiches.licence'],
      'intitulé du choix de licence absent en ' + langue);
    for (const l of yaml.LICENCES_ARTICLE) {
      const libelle = TEXTES_COCKPIT[langue]['licence.' + l.cle];
      assert.ok(libelle && libelle.length > 3, 'libellé absent en ' + langue + ' : ' + l.cle);
      assert.ok(libelle.indexOf('ß') === -1, 'ß dans le libellé allemand de ' + l.cle);
    }
  }
  assert.ok(TEXTES_COCKPIT.de['fiches.licence'].indexOf('ß') === -1, 'ß dans l’intitulé allemand');
  for (const langue of ['fr', 'de']) {
    for (const cle of ['ojs.avert.licence.reserves', 'ojs.avert.licence.figure']) {
      assert.ok(TEXTES_COCKPIT[langue][cle], 'avertissement ' + cle + ' absent en ' + langue);
    }
  }
});

test('un seul sélecteur pour la langue et pour la licence', () => {
  // La règle que le propriétaire répète : aucune duplication de composant. Le <select> de
  // la langue a été généralisé, il n'a pas été recopié.
  assert.match(COMMUN, /function choixFerme\(opts\)/, 'le sélecteur partagé a disparu');
  assert.strictEqual((COMMUN.match(/document\.createElement\('select'\)/g) || []).length, 1,
    'un second <select> est fabriqué à la main dans _commun.js');
  assert.ok(FICHES.indexOf("document.createElement('select')") !== -1,
    'le <select> du type d’article a bougé : ce compte n’a plus de sens');
  for (const champ of ["cle: 'lang'", "cle: 'licence'"]) {
    assert.ok(COMMUN.indexOf(champ) !== -1 || FICHES.indexOf(champ) !== -1,
      'champ non branché sur choixFerme : ' + champ);
  }
});

test('les deux formulaires de cartes recoivent la liste des licences', () => {
  // « Métadonnées des articles » et « Vérification de l'import » partagent le même
  // fragment de carte : un panneau qui oublierait la liste afficherait un <select> vide,
  // sans erreur et sans qu'aucune page ne s'en plaigne.
  const ext = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const envois = ext.split("types: typesTraduits(langue)").slice(1);
  assert.strictEqual(envois.length, 2, 'le nombre d’envois de cartes a changé');
  for (const suite of envois) {
    assert.match(suite.slice(0, 200), /licences: licencesTraduites\(\), licenceDefaut: LICENCE_DEFAUT/,
      'un panneau de cartes n’envoie pas la liste des licences');
  }
});

// ---- Le formulaire ----

const TYPES = [{ valeur: 'article', libelle: 'Article', groupe: 'Dossier' }];

// Les licences telles que l'hôte les envoie : licencesTraduites() dans extension.js.
function licencesHote() {
  return yaml.LICENCES_ARTICLE.map((l) => ({
    valeur: l.cle, libelle: TEXTES_COCKPIT.fr['licence.' + l.cle]
  }));
}

function ouvrirFiches(articles) {
  const page = ouvrir({
    racine: RACINE, page: 'metadata-articles',
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_auteurs.js', '_fiches.js'],
    txt: libellesHote(RACINE, ['textesCarteArticle', 'textesAuteur', 'htmlApercuMetadonnees'])
  });
  page.envoyer({
    type: 'valeurs', articles: articles, types: TYPES, langue: 'fr', filtre: null,
    licences: licencesHote(), licenceDefaut: yaml.LICENCE_DEFAUT
  });
  return page;
}

function selectLicence(page, slug) {
  const cartes = page.conteneur().querySelectorAll('[data-slug="' + slug + '"]');
  assert.strictEqual(cartes.length, 1, 'carte introuvable : ' + slug);
  const champs = cartes[0].querySelectorAll('[data-cle="licence"]');
  assert.strictEqual(champs.length, 1, 'un seul choix de licence par carte : ' + slug);
  return champs[0];
}

test('métadonnées des articles : chaque carte offre le choix de la licence', () => {
  const page = ouvrirFiches([
    { slug: 'article-reserve', valeurs: { licence: 'droits-reserves', title: { fr: 'T' } } },
    { slug: 'article-sans', valeurs: { title: { fr: 'T' } } }
  ]);
  const declare = selectLicence(page, 'article-reserve');
  assert.strictEqual(declare.balise, 'select');
  assert.deepStrictEqual(declare.enfants.map((o) => o.value),
    yaml.LICENCES_ARTICLE.map((l) => l.cle));
  assert.strictEqual(declare.value, 'droits-reserves', 'la licence de la fiche n’est pas reprise');
  // Fiche muette : le formulaire montre la licence par défaut, celle qui s'imprimera.
  assert.strictEqual(selectLicence(page, 'article-sans').value, yaml.LICENCE_DEFAUT);
  // Les libellés sont ceux de l'hôte, et l'intitulé est apparié au champ.
  for (const opt of declare.enfants) {
    assert.ok(opt.textContent && opt.textContent.length > 3, 'option sans libellé : ' + opt.value);
  }
  const intitule = page.textes().filter((t) => t === TEXTES_COCKPIT.fr['fiches.licence']);
  assert.strictEqual(intitule.length, 2, 'l’intitulé du champ manque sur une carte');
  assert.ok(declare.getAttribute('id'), 'le <select> n’a pas d’identifiant à apparier');
});

test('collecter() rend la licence, et ne rend pas la source', () => {
  // La carte que la webview renvoie est reconstruite, elle ne relit pas le fichier : ce
  // qu'elle ne porte pas, c'est ecrireCartesArticles() qui le rapatrie. Le contrôle
  // suivant en dépend.
  const bloc = FICHES.slice(FICHES.indexOf('function collecter(carte)'));
  const corps = bloc.slice(0, bloc.indexOf(LF + '    }'));
  assert.match(corps, /select\[data-cle=licence\]/, 'collecter() ne relit pas la licence');
  assert.ok(corps.indexOf('source') === -1,
    'collecter() renvoie maintenant la source : le rapatriement de l’hôte est à revoir');
});

// ---- L'aller-retour par le formulaire, hôte réellement activé ----

test('la fiche garde sa licence et sa source après un enregistrement du formulaire', async () => {
  const { revueDEssai, activerHote } = require('./hote-factice');
  const revue = revueDEssai();
  const hote = activerHote(revue);
  const fichier = path.join(revue, 'articles', '01-essai', '01-essai.meta.yaml');
  const nomWord = 'Inklusive Bildung – Teil 1.docx';
  fs.writeFileSync(fichier, [
    'type: article', 'lang: fr', 'source: "' + nomWord + '"', 'licence: cc-by-nc-nd-4.0',
    'doi: "10.57161/r2026-03-05"', 'title:', '  fr: "Titre"',
    'author:', '- prenom: "Anne"', '  nom: "Dupont"', ''].join(LF));

  // L'arbre d'abord : c'est son premier parcours qui donne sa racine au fournisseur, et
  // sans racine le panneau ne s'ouvre pas.
  await hote.arbre().getChildren();
  await hote.executer('szh.apercuMetadonnees');
  const p = hote.panneauDeType('szhApercuMetadonnees');
  assert.ok(p, 'panneau des métadonnées absent');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.ok(charge, 'aucune valeur envoyée au panneau');
  // L'hôte envoie la liste fermée et la valeur par défaut : sans elles, le <select>
  // s'afficherait vide et n'offrirait aucune licence.
  assert.deepStrictEqual((charge.licences || []).map((l) => l.valeur),
    yaml.LICENCES_ARTICLE.map((l) => l.cle));
  assert.strictEqual(charge.licenceDefaut, yaml.LICENCE_DEFAUT);
  const carteEnvoyee = charge.articles.filter((a) => a.slug === '01-essai')[0];
  assert.strictEqual(carteEnvoyee.valeurs.licence, 'cc-by-nc-nd-4.0');

  // Ce que la webview renvoie : la forme exacte de collecter() dans media/_fiches.js —
  // pas de `source`, pas de `_inconnues`. C'est le piège : un champ promu en clé de
  // première classe sans être rapatrié ici se perd à chaque enregistrement.
  await p._recepteur({
    type: 'enregistrer', auto: true,
    articles: {
      '01-essai': {
        type: 'article', lang: 'fr', licence: 'cc-by-sa-4.0', doi: '10.57161/r2026-03-05',
        title: { fr: 'Titre' }, subtitle: {}, resume: {}, keywords: {},
        author: [{ prenom: 'Anne', nom: 'Dupont' }]
      }
    }
  });
  const apres = fs.readFileSync(fichier, 'utf8');
  assert.match(apres, /^licence: cc-by-sa-4\.0$/m, 'la licence choisie n’a pas été écrite');
  assert.ok(apres.indexOf('source: "' + nomWord + '"') !== -1,
    'la source du Word a été perdue par le formulaire');
  assert.strictEqual(yaml.analyserMeta(apres).licence, 'cc-by-sa-4.0');
  // Et une carte muette sur la licence repart sans la clé, donc sous celle de la revue.
  await p._recepteur({
    type: 'enregistrer', auto: true,
    articles: { '01-essai': { type: 'article', lang: 'fr', title: { fr: 'Titre' } } }
  });
  const nu = fs.readFileSync(fichier, 'utf8');
  assert.ok(!/^licence:/m.test(nu), 'une carte sans licence en a écrit une');
  assert.ok(nu.indexOf('source: "' + nomWord + '"') !== -1, 'la source a été perdue');
});

// ---- L'export OJS ----

const CONFIG_ESSAI = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lic-cfg-')), 'config.json');
process.env.SZH_CONFIG_OJS = CONFIG_ESSAI;
const ojs = require(path.join(COCKPIT, 'lib', 'export-ojs.js'));
const MAINTENANT = new Date(2026, 7, 21, 9, 30, 0);

const CONFIG_OJS = {
  revues: {
    fr: { genreFichier: "Texte de l'article", groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: '' },
    de: { genreFichier: 'Artikeltext', groupeAuteur: 'Autor/in', televerseur: 'redaktion', paysAuteur: '' }
  }
};

// Un numéro d'une seule pièce, monté depuis le vrai revue-template/ausgabe.yaml.
//   opts.licence  ligne `licence:` de la fiche, ou null pour n'en pas mettre
//   opts.figures  attributs des insertions d'image du .md
//   opts.auteur   nom de famille de l'unique auteur
function monter(opts) {
  opts = opts || {};
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lic-'));
  const gabarit = lire('revue-template', 'ausgabe.yaml');
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'),
    yaml.serialiserAusgabe(gabarit, { revue: 'revue', lang: 'fr', date: '2026-09-08' }));
  fs.writeFileSync(path.join(racine, 'couverture.jpg'), Buffer.from('JPEG'));
  const slug = '01-article';
  const dossier = path.join(racine, 'articles', slug);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'), [
    'type: article', 'lang: fr'].concat(opts.licence ? ['licence: ' + opts.licence] : []).concat([
    'doi: "10.57161/r2026-02-01"',
    'title:', '  fr: "Un titre"', 'subtitle:', '  fr: "Un sous-titre"',
    'resume:', '  fr: "Un résumé."', 'keywords:', '  fr:', '  - "un mot"',
    'author:', '- prenom: "Anne"', '  nom: "' + (opts.auteur || 'Dupont') + '"',
    '  email: "anne@example.ch"', '']).join(LF));
  const figures = (opts.figures || []).map((attrs, i) =>
    '![Une légende](media/f-0' + (i + 1) + '.png){alt="desc" ' + attrs + '}');
  fs.writeFileSync(path.join(dossier, slug + '.md'),
    ['# Un titre', ''].concat(figures).concat(['', '## Références', '',
      'Shaw, A. (2023). *Enseigner autrement*. Editions SZH/CSPS.', '']).join(LF));
  const sortie = path.join(racine, 'out', slug);
  fs.mkdirSync(sortie, { recursive: true });
  for (const ext of ['pdf', 'html', 'docx']) {
    fs.writeFileSync(path.join(sortie, slug + '.' + ext), Buffer.from(ext));
  }
  return racine;
}

function exporter(opts) {
  const res = ojs.genererExportOjs(monter(opts), { maintenant: MAINTENANT, config: CONFIG_OJS });
  return { xml: fs.readFileSync(res.chemin, 'utf8'), avertissements: res.avertissements };
}

// Les avertissements qui parlent de licence, et eux seuls.
function avertsLicence(sortie) {
  return sortie.avertissements.filter((a) => /licence|droits réservés/i.test(a));
}

test('export OJS : sans champ `licence`, le licenseUrl est celui d’avant, au caractère près', () => {
  const sortie = exporter({ licence: null });
  assert.ok(sortie.xml.indexOf(
    '        <licenseUrl>https://creativecommons.org/licenses/by/4.0</licenseUrl>' + LF) !== -1,
    'le licenseUrl des numéros en cours a bougé');
  assert.deepStrictEqual(avertsLicence(sortie), [], 'un avertissement est apparu sans raison');
});

test('export OJS : la licence de l’article arrive dans le licenseUrl', () => {
  for (const l of yaml.LICENCES_ARTICLE.filter((x) => x.url !== '')) {
    const sortie = exporter({ licence: l.cle });
    // Sans barre finale : c'est la forme de l'export de référence de la maison.
    assert.ok(sortie.xml.indexOf('<licenseUrl>' + l.url.replace(/\/$/, '') + '</licenseUrl>') !== -1,
      'licenseUrl absent ou faux pour ' + l.cle);
    assert.deepStrictEqual(avertsLicence(sortie), [], 'avertissement inattendu pour ' + l.cle);
  }
});

test('export OJS : en droits réservés, aucune adresse n’est fabriquée', () => {
  const sortie = exporter({ licence: 'droits-reserves' });
  assert.ok(sortie.xml.indexOf('licenseUrl') === -1,
    'un <licenseUrl> est parti pour un article en droits réservés');
  // Le copyright reste porté par copyrightHolder et copyrightYear, qui ne changent pas.
  assert.match(sortie.xml, /<copyrightHolder locale="fr">Anne Dupont<\/copyrightHolder>/);
  const dits = avertsLicence(sortie);
  assert.strictEqual(dits.length, 1, 'l’omission n’est pas signalée : ' + JSON.stringify(dits));
  assert.match(dits[0], /licenseUrl/, 'l’avertissement ne dit pas ce qui est omis');
});

test('export OJS : un crédit de figure tiers sous licence CC est nommé, sans bloquer', () => {
  // Le cas d'origine : « © Getty » sous l'image, CC-BY 4.0 sur la couverture. Ce lien
  // n'est pas vérifiable par la machine — c'est un avertissement, jamais un refus.
  const sortie = exporter({
    licence: null,
    figures: ['copyright="© Getty Images" source="Getty"', 'copyright="© SZH"']
  });
  const dits = avertsLicence(sortie);
  assert.strictEqual(dits.length, 1, 'la figure sous droits n’est pas signalée : ' + JSON.stringify(dits));
  assert.match(dits[0], /f-01\.png/, 'l’avertissement ne nomme pas la figure');
  assert.match(dits[0], /© Getty Images/, 'l’avertissement ne cite pas le crédit');
  assert.match(dits[0], /CC-BY 4\.0/, 'l’avertissement ne dit pas quelle licence est annoncée');
  assert.ok(dits[0].indexOf('f-02.png') === -1, 'un crédit de la maison a été signalé');
  // Et l'export a bien abouti.
  assert.match(sortie.xml, /<licenseUrl>/);
});

test('export OJS : les crédits de la maison et des auteur·e·s ne disent rien', () => {
  for (const credit of ['© SZH', '© CSPS', '(c) szh/csps', '© SZH/CSPS 2026', '© A. Dupont']) {
    const sortie = exporter({ licence: null, figures: ['copyright="' + credit + '"'] });
    assert.deepStrictEqual(avertsLicence(sortie), [],
      'crédit signalé à tort : ' + credit);
  }
  // Une figure sans crédit du tout ne pose évidemment aucune question.
  assert.deepStrictEqual(avertsLicence(exporter({ licence: null, figures: ['alt="rien"'] })), []);
});

test('export OJS : en droits réservés, le crédit de figure ne se plaint plus', () => {
  // La contradiction a disparu : l'article ne promet plus rien qu'une figure démente.
  const sortie = exporter({
    licence: 'droits-reserves', figures: ['copyright="© Getty Images"']
  });
  const dits = avertsLicence(sortie);
  assert.strictEqual(dits.length, 1, 'un second avertissement est apparu : ' + JSON.stringify(dits));
  assert.match(dits[0], /licenseUrl/);
});
