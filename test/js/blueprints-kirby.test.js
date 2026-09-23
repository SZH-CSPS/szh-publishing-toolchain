// Éprouve kirby/generer-blueprints.js : les blueprints committés dans
// kirby/site/blueprints/{pages,files}/ égalent la génération depuis le contrat unique
// pipeline/kirby/champs-documentation.json, et les garanties structurelles tenues par le
// générateur : chaque liste a ses deux langues ; aucun nom de champ hors a-z0-9_, aucun champ
// nommé `image` (TODO_KirbyCMS.md §10) ; un champ `files` référence un gabarit files/<cle>.yml
// réel, sans `alt` (décoratif) ; translate:false pour tout champ commun (pas traduire:true
// dans le JSON), rien pour les traduisibles, et par sous-champ dans le structure `suivi` ;
// ausgabe/ordre présents en hidden traduisibles sur chaque fiche ; plus de blueprint de
// rubriques (elles restent dans le numéro, jamais sur Kirby) ; chaque type a sa page parente
// (le dossier types[].dossier, ex. buecher\ — depuis 8e89548), en minuscules ASCII [a-z]+, et
// actualites.yml liste désormais ces sept pages dossier au lieu des fiches directement ; la
// saisie `liste_multiple` (genre/pays du film, 23.09.2026) génère un champ `multiselect`,
// mêmes options traduites qu'un select, séparateur ", " fixé explicitement.
//
//   node --test test/js/blueprints-kirby.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const gen = require(path.join(RACINE, 'kirby', 'generer-blueprints.js'));

const contrat = gen.chargerContrat();

// ---- Les blueprints committés égalent la génération -------------------------------------

test('blueprints committés : identiques octet pour octet à la génération', () => {
  const attendus = gen.genererContenus(contrat);
  const noms = Object.keys(attendus);
  assert.ok(noms.length > 0, 'aucun blueprint généré');
  for (const nom of noms) {
    const chemin = path.join(gen.DOSSIER_BLUEPRINTS, nom);
    assert.ok(fs.existsSync(chemin), 'blueprint absent du dépôt : ' + nom
      + ' (lancer node kirby/generer-blueprints.js)');
    const surDisque = fs.readFileSync(chemin, 'utf8');
    assert.strictEqual(surDisque, attendus[nom],
      nom + ' diffère de la génération — relancer node kirby/generer-blueprints.js');
  }
});

// Les deux sous-dossiers connus (pages/, files/) — pas de troisième famille de blueprint
// aujourd'hui, mais on ne va pas chercher plus loin que ce que construireTous() peut produire.
function fichiersYamlSurDisque(sousDossier) {
  const dossier = path.join(gen.DOSSIER_BLUEPRINTS, sousDossier);
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier).filter((f) => f.endsWith('.yml')).map((f) => sousDossier + '/' + f);
}

test('blueprints committés : aucun fichier en trop dans pages/ ou files/', () => {
  const attendus = new Set(Object.keys(gen.genererContenus(contrat)));
  const surDisque = [...fichiersYamlSurDisque('pages'), ...fichiersYamlSurDisque('files')];
  assert.ok(surDisque.length > 0, 'aucun .yml trouvé sur le disque');
  for (const f of surDisque) {
    assert.ok(attendus.has(f), f + ' n’a plus de source dans le JSON — à retirer');
  }
});

test('--verifier : sort en code 0 quand le dépôt est à jour', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath,
    [path.join(RACINE, 'kirby', 'generer-blueprints.js'), '--verifier'],
    { encoding: 'utf8', cwd: RACINE });
  assert.strictEqual(r.status, 0, 'sortie : ' + r.stdout + r.stderr);
});

// ---- Chaque liste du JSON a toutes ses options en fr et en de ---------------------------

test('listes : chaque jeton a un libellé fr et de non vides', () => {
  for (const [nomListe, items] of Object.entries(contrat.listes)) {
    assert.ok(Array.isArray(items) && items.length > 0, 'liste vide : ' + nomListe);
    for (const it of items) {
      assert.ok(it.jeton, 'jeton manquant dans la liste ' + nomListe);
      assert.strictEqual(typeof it.fr, 'string', nomListe + '.' + it.jeton + ' sans fr');
      assert.notStrictEqual(it.fr.trim(), '', nomListe + '.' + it.jeton + ' : fr vide');
      assert.strictEqual(typeof it.de, 'string', nomListe + '.' + it.jeton + ' sans de');
      assert.notStrictEqual(it.de.trim(), '', nomListe + '.' + it.jeton + ' : de vide');
    }
  }
});

// Corollaire côté blueprint généré : les options select ET multiselect portent aussi les
// deux langues (même après le suffixe canton ajouté pour les instruments `local: true`).
test('blueprints générés : les options select et multiselect ont toutes fr et de', () => {
  const docs = gen.construireTous(contrat);
  const walker = (fields) => {
    for (const [nomChamp, config] of Object.entries(fields)) {
      if (config.type === 'select' || config.type === 'multiselect') {
        for (const [jeton, libelles] of Object.entries(config.options)) {
          assert.ok(libelles.fr, nomChamp + '.' + jeton + ' : fr manquant');
          assert.ok(libelles.de, nomChamp + '.' + jeton + ' : de manquant');
        }
      }
      if (config.type === 'structure') { walker(config.fields); }
    }
  };
  for (const arbre of Object.values(docs)) { if (arbre.fields) { walker(arbre.fields); } }
});

// ---- saisie `liste_multiple` -> champ Kirby `multiselect` --------------------------------
//
// Vérifié sur getkirby.com/docs/reference/panel/fields/multiselect (23.09.2026) : mêmes
// options traduites qu'un select (un objet par jeton, une clé par langue), stockage en
// liste séparée par `separator` (fixé ici à ', ' — virgule + espace — pour matcher la
// convention « jeton1, jeton2 » du contrat, jamais le défaut Kirby ','). `genre` et `pays`
// (type film) sont les deux seuls champs `liste_multiple` du contrat (23.09.2026) ; `pays`
// est la liste ISO 3166-1 complète (250 jetons), chacun avec fr et de.
test('liste_multiple : genre et pays (film) génèrent un champ multiselect, séparateur ", ", translate:false', () => {
  const docs = gen.construireTous(contrat);
  const champsFilm = docs['pages/film.yml'].fields;
  for (const cle of ['genre', 'pays']) {
    const champJson = contrat.types.film.champs.find((c) => c.cle === cle);
    assert.strictEqual(champJson.saisie, 'liste_multiple', 'précondition : ' + cle + ' doit rester liste_multiple dans le JSON');
    const config = champsFilm[cle];
    assert.ok(config, 'film.' + cle + ' absent du blueprint généré');
    assert.strictEqual(config.type, 'multiselect', 'film.' + cle + ' doit être un champ multiselect');
    assert.strictEqual(config.separator, ', ', 'film.' + cle + ' : séparateur attendu ", " (convention du contrat)');
    assert.strictEqual(config.translate, false, 'film.' + cle + ' : champ commun, doit porter translate:false');
    const options = config.options;
    const attendues = contrat.listes[champJson.liste];
    assert.strictEqual(Object.keys(options).length, attendues.length,
      'film.' + cle + ' : ' + attendues.length + ' options attendues, ' + Object.keys(options).length + ' générées');
    for (const it of attendues) {
      assert.ok(options[it.jeton], 'film.' + cle + '.' + it.jeton + ' absent des options générées');
      assert.strictEqual(options[it.jeton].fr, it.fr, 'film.' + cle + '.' + it.jeton + ' : fr divergent');
      assert.strictEqual(options[it.jeton].de, it.de, 'film.' + cle + '.' + it.jeton + ' : de divergent');
    }
  }
  // pays : la liste ISO 3166-1 complète (plus Kosovo), 250 jetons — un décompte fixe pour
  // détecter tout de suite une liste tronquée ou dupliquée à la génération.
  assert.strictEqual(Object.keys(champsFilm.pays.options).length, 250,
    '250 options pays attendues (ISO 3166-1 + Kosovo)');
});

// ---- Champs `files` : uploads pointe vers un gabarit de fichier réellement généré,
// décoratif (pas de champ `alt`) -----------------------------------------------------------

test('champs files : `uploads` a son gabarit files/<cle>.yml, sans champ alt (décoratif)', () => {
  const docs = gen.construireTous(contrat);
  let vus = 0;
  const walker = (fields) => {
    for (const config of Object.values(fields)) {
      if (config.type === 'files') {
        vus++;
        assert.ok(config.uploads, 'champ files sans `uploads`');
        const cheminGabarit = 'files/' + config.uploads + '.yml';
        assert.ok(docs[cheminGabarit], 'gabarit ' + cheminGabarit + ' non généré pour uploads: ' + config.uploads);
        assert.ok(!('accept' in config), 'accept ne doit plus vivre sur le champ files lui-même : ' + JSON.stringify(config));
        assert.ok(!docs[cheminGabarit].fields, cheminGabarit + ' ne doit pas avoir de champ (donc pas de `alt`) : image décorative');
      }
      if (config.type === 'structure') { walker(config.fields); }
    }
  };
  for (const arbre of Object.values(docs)) { if (arbre.fields) { walker(arbre.fields); } }
  assert.ok(vus > 0, 'aucun champ files trouvé dans les blueprints générés');
});

// ---- Traductibilité : translate:false pour tout champ commun, rien pour les traduisibles --
//
// docs/FORMAT-DOCUMENTATION-KIRBY.md : « Champs traduisibles (traduire:true du JSON) …
// propres à chaque fichier de langue. Tous les autres champs … sont COMMUNS ». Un champ
// `structure` lui-même (ex. `suivi`) n'a pas de translate propre : sa traductibilité se règle
// sous-champ par sous-champ, donc on descend récursivement au lieu de le contrôler lui-même.

function verifierTraduction(champsJson, fieldsYaml, origine) {
  for (const champ of champsJson) {
    const config = fieldsYaml[champ.cle];
    assert.ok(config, origine + '.' + champ.cle + ' absent du blueprint généré');
    if (champ.cle === 'title') {
      assert.ok(!('translate' in config),
        origine + '.title : traduisible par défaut, ne doit pas porter `translate`');
    } else if (champ.saisie === 'structure') {
      assert.ok(!('translate' in config),
        origine + '.' + champ.cle + ' (structure) : pas de `translate` au niveau du champ lui-même');
      verifierTraduction(champ.champs, config.fields, origine + '.' + champ.cle);
    } else if (champ.traduire) {
      assert.ok(!('translate' in config),
        origine + '.' + champ.cle + ' : traduire:true dans le JSON, ne doit pas porter `translate`');
    } else {
      assert.strictEqual(config.translate, false,
        origine + '.' + champ.cle + ' : commun (pas traduire:true dans le JSON), doit porter translate: false');
    }
  }
}

test('translate : tout champ non traduisible reçoit translate:false, les traduisibles n’en portent pas', () => {
  const docs = gen.construireTous(contrat);
  for (const cleType of Object.keys(contrat.types)) {
    verifierTraduction(contrat.types[cleType].champs, docs['pages/' + cleType + '.yml'].fields, cleType);
  }
});

// ---- Champs système (ausgabe, ordre) : hidden, traduisibles, sur chaque fiche -----------

test('champs système : ausgabe et ordre en hidden, translate:true, sur chaque blueprint de fiche', () => {
  const docs = gen.construireTous(contrat);
  for (const cleType of Object.keys(contrat.types)) {
    const fields = docs['pages/' + cleType + '.yml'].fields;
    for (const cle of ['ausgabe', 'ordre']) {
      assert.ok(fields[cle], cleType + '.' + cle + ' absent');
      assert.strictEqual(fields[cle].type, 'hidden', cleType + '.' + cle + ' devrait être hidden');
      assert.strictEqual(fields[cle].translate, true,
        cleType + '.' + cle + ' devrait être traduisible (translate: true), propre à chaque fichier de langue');
    }
  }
});

// ---- Plus de blueprint pour les rubriques : elles restent dans le numéro -----------------

test('actualites.yml : pas de champ `fields` (rubriques restées dans le numéro), une section listant les sept dossiers de type', () => {
  const docs = gen.construireTous(contrat);
  const actualites = docs['pages/actualites.yml'];
  assert.ok(actualites, 'pages/actualites.yml non généré');
  assert.ok(!actualites.fields, 'actualites.yml ne devrait plus avoir de champ (rubriques hors Kirby)');
  assert.ok(!docs['pages/documentation.yml'], 'pages/documentation.yml ne devrait plus être généré');
  for (const rubrique of contrat.rubriques) {
    for (const [nomFichier, arbre] of Object.entries(docs)) {
      if (arbre.fields) {
        assert.ok(!(rubrique.cle in arbre.fields),
          nomFichier + ' porte encore un champ de rubrique ' + rubrique.cle);
      }
    }
  }
  const dossiers = Object.keys(actualites.sections);
  assert.deepStrictEqual(dossiers, ['dossiers'], 'actualites.yml : une seule section, listant les pages dossier');
  const section = actualites.sections.dossiers;
  assert.strictEqual(section.sortable, false);
  const attendus = contrat.ordreTypes.map((cleType) => contrat.types[cleType].dossier.toLowerCase());
  assert.deepStrictEqual(section.templates, attendus,
    'actualites.yml : `templates` doit lister les sept dossiers de type, dans l’ordre ordreTypes');
  assert.ok(!('template' in section), 'actualites.yml : plusieurs gabarits -> `templates` (pluriel), pas `template`');
});

// ---- Chaque type a sa page parente (le dossier types[].dossier, ex. buecher\) ------------
//
// docs/FORMAT-DOCUMENTATION-KIRBY.md (8e89548) : une fiche vit sous
// `_NewsUndActu\Fiches\<dossier du type>\<slug>\`. Ce dossier est une page Kirby à part, entre
// la bibliothèque (actualites.yml) et les fiches : elle doit exister pour chaque type, avec le
// libellé du type et une section listant les fiches de ce type.

test('types[].dossier : minuscules ASCII [a-z]+ pour chaque type (segment d’adresse du site)', () => {
  for (const [cleType, type] of Object.entries(contrat.types)) {
    assert.ok(type.dossier, cleType + ' : types[].dossier manquant');
    assert.match(type.dossier, /^[a-z]+$/, cleType + '.dossier hors minuscules ASCII [a-z]+ : ' + type.dossier);
  }
});

test('chaque type a sa page parente (dossier en minuscules) : titre du type, une section pages sur le gabarit de la fiche', () => {
  const docs = gen.construireTous(contrat);
  for (const [cleType, type] of Object.entries(contrat.types)) {
    const nomFichier = 'pages/' + type.dossier.toLowerCase() + '.yml';
    const doc = docs[nomFichier];
    assert.ok(doc, cleType + ' : page parente ' + nomFichier + ' non générée');
    assert.ok(!doc.fields, nomFichier + ' : une page dossier n’a pas de champ, seulement des fiches enfants');
    assert.deepStrictEqual(doc.title, { fr: type.libelle.fr, de: type.libelle.de },
      nomFichier + ' : titre attendu = types[].libelle');
    const noms = Object.keys(doc.sections);
    assert.strictEqual(noms.length, 1, nomFichier + ' : une seule section attendue');
    const section = doc.sections[noms[0]];
    assert.strictEqual(section.type, 'pages');
    assert.strictEqual(section.template, cleType,
      nomFichier + ' : la section doit lister les enfants du gabarit de fiche ' + cleType);
    assert.strictEqual(section.sortable, false);
  }
  // Pas de collision entre le nom de gabarit d’un dossier et celui d’une fiche : deux pages
  // différentes (parent/enfant) doivent avoir deux gabarits différents.
  const nomsDossier = new Set(Object.values(contrat.types).map((t) => t.dossier.toLowerCase()));
  for (const cleType of Object.keys(contrat.types)) {
    assert.ok(!nomsDossier.has(cleType),
      'collision : le dossier d’un type ne doit pas porter le même nom que la clé d’un type (' + cleType + ')');
  }
});

// ---- Aucun nom de champ hors [a-z0-9_], aucun champ nommé `image` -----------------------

test('blueprints générés : noms de champ en a-z0-9_ uniquement, jamais `image`', () => {
  const docs = gen.construireTous(contrat);
  const CLE_SIMPLE = /^[a-z0-9_]+$/;
  const walker = (fields, origine) => {
    for (const [nomChamp, config] of Object.entries(fields)) {
      assert.match(nomChamp, CLE_SIMPLE, origine + ' : nom de champ hors a-z0-9_ : ' + nomChamp);
      assert.notStrictEqual(nomChamp, 'image',
        origine + ' : champ nommé `image` — méthode réservée de Kirby (TODO_KirbyCMS.md §10)');
      if (config && config.type === 'structure') { walker(config.fields, origine + '.' + nomChamp); }
    }
  };
  for (const [nomFichier, arbre] of Object.entries(docs)) {
    if (arbre.fields) { walker(arbre.fields, nomFichier); }
  }
});
