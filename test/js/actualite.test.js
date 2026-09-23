// La section « Actualité » de l'arbre, et la page de Documentation du numéro — devenue une
// arborescence Kirby (lib/kirby-contenu.js) : documentation.<lang>.txt pour les rubriques,
// un dossier <n>_<slug>/ par fiche. Il n'y a plus de <slug>.md pour cette page.
//
// Ce que ce fichier fixe encore, inchangé depuis le lot du 02.09.2026 :
//   - la page de Documentation ne se liste PLUS dans l'arbre. Cliquer l'en-tête
//     « ACTUALITÉ » ouvre son formulaire, et la crée si le numéro n'en a pas encore ;
//   - la section ne contient donc que l'entrée « Réserve » ;
//   - le badge de l'en-tête compte les blocs de la page (fiches et rubriques non vides) ;
//   - un seul formulaire porte les deux familles (media/documentation.js).
//
// Ce qui change avec l'arborescence Kirby : kirby-contenu.js écrit par fs direct, sans
// passer par vscode.workspace/WorkspaceEdit (faux sans effet dans ce harnais, voir
// hote-factice.js) — les mutations d'« enregistrer » sont donc RÉELLES ici, à la différence
// de l'ancien harnais bloc-dans-un-.md.
//
//   node --test test/js/actualite.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const LF = '\n';
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const COCKPIT_DOC = path.join(COCKPIT, 'lib', 'documentation-hote.js');
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

// Le nom de dossier que le cockpit donne à la page qu'il crée (SLUG_DOCUMENTATION).
const SLUG_DOC = 'documentation';
const DOSSIER_DOC = path.join(REVUE, 'articles', SLUG_DOC);
const TXT_DOC = path.join(DOSSIER_DOC, 'documentation.fr.txt');

async function sections() {
  return await HOTE.arbre().getChildren();
}
async function enfantsDe(contextValue) {
  const s = (await sections()).find((it) => it.contextValue === contextValue);
  assert.ok(s, 'section absente : ' + contextValue);
  return await HOTE.arbre().getChildren(s);
}
async function entete() {
  const e = (await sections()).find((it) => it.contextValue === 'section-actualite');
  assert.ok(e, 'en-tête ACTUALITÉ absent');
  return e;
}
// Un seul panneau de Documentation possible désormais (les fiches et les rubriques
// n'existent plus que sur cette page) : plus besoin de le distinguer d'un panneau ouvert
// sur un article ordinaire, qui n'existe plus.
function dernierPanneauDoc() {
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation').pop();
  assert.ok(p, 'panneau de Documentation absent');
  return p;
}
async function panneau() {
  const p = dernierPanneauDoc();
  await p._recepteur({ type: 'pret' });
  return p;
}
function charge(p) {
  const m = p.messages.filter((x) => x.type === 'charger').pop();
  assert.ok(m, 'aucune charge « charger »');
  return m;
}

test('les commandes du lot sont enregistrées', () => {
  for (const cmd of ['szh.documentation', 'szh.reserve']) {
    assert.ok(HOTE.commandes().includes(cmd), 'commande non enregistrée : ' + cmd);
  }
  // Les fiches et les rubriques n'existent plus que sur la page de Documentation
  // (décision de Robin) : les deux anciennes commandes par article ont disparu.
  assert.ok(!HOTE.commandes().includes('szh.rubriquesArticle'),
    'szh.rubriquesArticle devrait avoir disparu avec le formulaire séparé');
  assert.ok(!HOTE.commandes().includes('szh.ressourcesArticle'),
    'szh.ressourcesArticle devrait avoir disparu : les fiches ne vivent plus que sur la Documentation');
});

// Avant toute création : la section existe déjà, et ne porte que la réserve.
test('sans page de Documentation, la section porte la réserve et aucun badge', async () => {
  const e = await entete();
  assert.strictEqual(e.description, undefined, 'aucun bloc à compter : pas de badge — ' + e.description);
  const enfants = await enfantsDe('section-actualite');
  assert.deepStrictEqual(enfants.map((it) => it.contextValue), ['reserve'],
    'la section ne doit contenir que la réserve');
  assert.ok(enfants[0].command && enfants[0].command.command === 'szh.reserve',
    'l’entrée de réserve doit ouvrir la réserve au clic');
  assert.strictEqual(enfants[0].description, undefined, 'une réserve vide ne doit pas porter de compteur');
});

test('cliquer l’en-tête ACTUALITÉ crée la page de Documentation (arborescence Kirby) et ouvre son formulaire', async () => {
  const e = await entete();
  assert.ok(e.command && e.command.command === 'szh.ouvrirSection', 'l’en-tête doit passer par szh.ouvrirSection');
  assert.ok(!fs.existsSync(DOSSIER_DOC), 'la fixture ne devrait pas déjà porter la page');

  await HOTE.executer('szh.ouvrirSection', 'actualite');

  assert.ok(fs.existsSync(TXT_DOC), 'documentation.fr.txt n’a pas été créé');
  const page = kirby.lirePage(DOSSIER_DOC, 'fr');
  assert.match(page.title, /Actualité et ressources/, 'la page doit naître avec son titre imprimé');
  assert.match(page.uuid, /^[A-Za-z0-9]{16}$/, 'la page doit porter un Uuid Kirby');
  for (const cle of Object.keys(page.rubriques)) {
    assert.strictEqual(page.rubriques[cle], '', 'rubrique non vide dès la création : ' + cle);
  }
  const meta = fs.readFileSync(path.join(DOSSIER_DOC, SLUG_DOC + '.meta.yaml'), 'utf8');
  assert.match(meta, /^type: documentation$/m, 'la fiche doit porter le type documentation');
  assert.match(meta, /Actualité et ressources/, 'la page doit naître avec son titre imprimé, dans la langue du numéro');
  assert.ok(HOTE.statutsDits('Documentation créée').length > 0, 'la création doit se dire dans la barre d’état');
  assert.ok(HOTE.panneauDeType('szhDocumentation'), 'le formulaire ne s’est pas ouvert');
});

test('la page créée n’apparaît NI dans ARTICLES, NI dans ACTUALITÉ', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre.listerArticles().includes(SLUG_DOC), 'la page doit rester une unité du numéro : c’est elle que la chaîne compile');
  const articles = await enfantsDe('section-articles');
  assert.ok(!articles.some((it) => it.slug === SLUG_DOC), 'la page de Documentation ne doit pas retomber dans ARTICLES');
  assert.ok(articles.some((it) => it.slug === '01-essai'), 'un article ordinaire a disparu de ARTICLES');
  const actualite = await enfantsDe('section-actualite');
  assert.deepStrictEqual(actualite.map((it) => it.contextValue), ['reserve'], 'ACTUALITÉ ne liste plus la page elle-même');
});

test('le badge de l’en-tête compte les fiches et les rubriques non vides', async () => {
  assert.strictEqual((await entete()).description, undefined, 'rien encore écrit : pas de badge');
  // Une fiche et une rubrique, écrites directement par le module pur — c'est ce que le
  // formulaire ferait, sans passer par le faux WorkspaceEdit de ce harnais.
  kirby.ecrirePage(DOSSIER_DOC, 'fr', {
    title: 'Actualité et ressources',
    rubriques: { podcasts: 'Un podcast.' }
  });
  kirby.ajouterFiche(DOSSIER_DOC, 'fr', 'livre', {
    categorie: 'manuel', title: 'Un livre', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D'
  });
  kirby.reordonnerFiches(DOSSIER_DOC, 'fr');
  assert.strictEqual(String((await entete()).description), '(2)',
    'le badge devrait compter la rubrique ET la fiche');
});

test('la page de Documentation déplie ACTUALITÉ, un article ordinaire déplie ARTICLES', () => {
  const arbre = HOTE.arbre();
  assert.strictEqual(arbre.categorieDeSlug(SLUG_DOC), 'actualite');
  assert.strictEqual(arbre.categorieDeSlug('01-essai'), 'articles');
  assert.strictEqual(arbre.slugDocumentation(), SLUG_DOC);
});

test('elementArticle ignore la page de Documentation sans lever', () => {
  const arbre = HOTE.arbre();
  assert.strictEqual(arbre.elementArticle(SLUG_DOC), null);
  assert.ok(arbre.elementArticle('01-essai'), 'article ordinaire introuvable');
  assert.strictEqual(arbre.elementArticle('jamais-vu'), null);
});

// ---- Le formulaire fusionné -----------------------------------------------------------

test('le formulaire porte les quatre rubriques ET les sept types de fiches du contrat', async () => {
  const p = await panneau();
  const m = charge(p);
  assert.deepStrictEqual(m.typesRubrique.map((t) => t.valeur),
    kirby.rubriquesPourRevue('revue').map((r) => r.cle),
    'les rubriques de la Revue, dans l’ordre du contrat');
  assert.deepStrictEqual(m.typesConfig.map((t) => t.valeur), kirby.typesConnus(),
    'les sept types de fiche, dans l’ordre ordreTypes du contrat');
  for (const t of m.typesRubrique) {
    assert.ok(t.libelleSection, 'rubrique sans titre : ' + t.valeur);
    assert.strictEqual(t.libelleAjouter, undefined,
      'une rubrique ne doit plus porter de libellé d’ajout : ' + t.valeur);
  }
  // Le bloc déjà présent sur le disque (écrit par le test précédent) est relu, et la fiche aussi.
  assert.deepStrictEqual(m.rubriques.filter((r) => r.contenu !== '').map((r) => r.type), ['podcasts']);
  assert.deepStrictEqual(m.ressources.map((r) => r.type), ['livre']);
});

test('le canton et les instruments sont des listes fermées du contrat, l’agenda se saisit en dates', async () => {
  const m = charge(await panneau());
  const parType = {};
  for (const t of m.typesConfig) { parType[t.valeur] = t; }
  const canton = parType.intervention.champs.find((c) => c.cle === 'canton');
  assert.strictEqual(canton.options.length, 27, '26 cantons et la Confédération : ' + canton.options.length);
  assert.ok(canton.options.some((o) => o.valeur === 'CH' && /Conf|Bund/.test(o.libelle)));
  assert.ok(canton.options.some((o) => o.valeur === 'ZH'), 'la valeur stockée doit être le code');

  const categorie = parType.intervention.champs.find((c) => c.cle === 'categorie');
  assert.ok(categorie.dependDe === 'canton', 'le menu des instruments doit dépendre du canton choisi');
  assert.ok(categorie.optionsParCanton && categorie.optionsParCanton.BS,
    'une table d’options par canton doit accompagner ce champ');
  // À Bâle-Ville, « Anzug » (local, propre à BS) doit passer avant un instrument qu’on n’y
  // observe pas (l’initiative cantonale, cantons: []).
  const jetonsBS = categorie.optionsParCanton.BS.map((o) => o.valeur);
  assert.ok(jetonsBS.indexOf('anzug') < jetonsBS.indexOf('initiative-cantonale'));
  assert.match(categorie.optionsParCanton.BS.find((o) => o.valeur === 'anzug').libelle, /\(BS\)$/,
    'un instrument local doit porter ses cantons entre parenthèses dans son libellé');

  const curia = parType.intervention.champs.find((c) => c.cle === 'curia');
  assert.strictEqual(curia.saisie, 'derive');
  assert.strictEqual(curia.table.motion, '5');

  const agenda = parType.agenda.champs;
  assert.strictEqual(agenda.find((c) => c.cle === 'debut').saisie, 'date');
  assert.strictEqual(agenda.find((c) => c.cle === 'fin').saisie, 'date');
  const evenement = agenda.find((c) => c.cle === 'evenement');
  assert.strictEqual(evenement.options.length, 6, 'les six types d’événement du contrat');
  for (const o of evenement.options) {
    assert.ok(o.libelle && o.libelle !== o.valeur, 'le jeton ' + o.valeur + ' doit être traduit pour la saisie');
  }
  // Une date_partielle (recherche) n'est PAS une date ISO stricte : le mode de saisie suit
  // le contrat, pas le nom du champ.
  assert.strictEqual(parType.recherche.champs.find((c) => c.cle === 'debut').saisie, 'date_partielle');
});

test('la rubrique « ressources » n’est proposée qu’à la Revue', async () => {
  const m = charge(await panneau());
  assert.ok(m.typesRubrique.some((t) => t.valeur === 'ressources'));
});

// Les mutations passent maintenant par kirby-contenu.js, en fs direct : contrairement à
// l'ancien harnais bloc-dans-un-.md (WorkspaceEdit, faux sans effet ici), le résultat sur
// le disque est réel et peut être contrôlé directement.
test('enregistrer : une rubrique remplie et une fiche incomplète comptent toutes deux, et s’écrivent réellement', async () => {
  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-neuf', type: 'film', valeurs: { title: 'Titre seul' } }],
    rubriques: [{ id: 'dossier_liens', type: 'dossier_liens', contenu: 'Un lien.' }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'aucune confirmation reçue');
  const enr = p.messages.find((m) => m.type === 'enregistre');
  assert.strictEqual(enr.correspondances.length, 1, 'la fiche neuve doit recevoir un Uuid');
  const fiches = kirby.listerFiches(DOSSIER_DOC, 'fr').filter((f) => f.type === 'film');
  assert.strictEqual(fiches.length, 1, 'la fiche sans descriptif ni image doit s’écrire quand même');
  assert.strictEqual(fiches[0].valeurs.title, 'Titre seul');
  const page = kirby.lirePage(DOSSIER_DOC, 'fr');
  assert.strictEqual(page.rubriques.dossier_liens, 'Un lien.');
});

test('enregistrer : une rubrique vidée sort du fichier de page', async () => {
  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({
    type: 'enregistrer', auto: false, ressources: [],
    rubriques: [{ id: 'podcasts', type: 'podcasts', contenu: '   ' }]
  });
  const page = kirby.lirePage(DOSSIER_DOC, 'fr');
  assert.strictEqual(page.rubriques.podcasts, '', 'une rubrique vidée doit sortir du fichier de page');
});

test('enregistrer : une carte de fiche jamais remplie ne s’écrit pas', async () => {
  const p = await panneau();
  p.messages.length = 0;
  const avant = kirby.listerFiches(DOSSIER_DOC, 'fr').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-vide', type: 'livre', valeurs: { title: '', descriptif: '' } }],
    rubriques: []
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'la confirmation part quand même');
  assert.strictEqual(kirby.listerFiches(DOSSIER_DOC, 'fr').length, avant,
    'un clic sur « Ajouter » suivi de rien ne doit rien écrire');
});

test('retour : la page de Documentation se referme et libère son slug', async () => {
  const p = await panneau();
  const avant = HOTE.panneaux.length;
  await p._recepteur({ type: 'retourArticle', modifie: false, ressources: [], rubriques: [] });
  await HOTE.executer('szh.documentation');
  assert.strictEqual(HOTE.panneaux.length, avant + 1,
    'rouvrir après un retour n’a pas créé un panneau neuf : la table des panneaux n’a pas été libérée à la fermeture');
});

// Le pendant du test suivant : quand la fiche EST enregistrée, l'image déposée doit
// rejoindre le dossier de la fiche et quitter .depot-images/, pas y traîner à côté.
test('.depot-images/ est vidé pour une carte dont la fiche vient d’être enregistrée', async () => {
  const p = await panneau();
  await p._recepteur({
    type: 'deposer-image', id: 'carte-avec-image', nomFichier: 'couverture.png',
    donneesBase64: Buffer.from('png').toString('base64')
  });
  assert.ok(kirby.imageProvisoire(DOSSIER_DOC, 'carte-avec-image'), 'l’image n’a pas été mise de côté');
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'carte-avec-image', type: 'livre', valeurs: {
      categorie: 'manuel', title: 'Avec image', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D'
    } }]
  });
  assert.strictEqual(kirby.imageProvisoire(DOSSIER_DOC, 'carte-avec-image'), null,
    'l’image déposée traîne encore dans .depot-images/ après l’enregistrement de sa fiche');
  const fiche = kirby.listerFiches(DOSSIER_DOC, 'fr').find((f) => f.valeurs.title === 'Avec image');
  assert.ok(fiche, 'la fiche n’a pas été écrite');
  assert.strictEqual(fiche.valeurs.couverture, 'couverture.png');
});

// Une image déposée pour une fiche encore neuve (jamais enregistrée) se met de côté dans
// .depot-images/ — voir lib/kirby-contenu.js. Si la carte est retirée avant sauvegarde, ou
// si le formulaire se ferme sans enregistrer, ce dépôt doit être vidé : un .txt ou une
// image orpheline dans l'arborescence serait lu comme contenu par le site Kirby.
test('.depot-images/ est vidé quand le formulaire se ferme sans avoir enregistré la fiche', async () => {
  const p = await panneau();
  await p._recepteur({
    type: 'deposer-image', id: 'carte-jamais-enregistree', nomFichier: 'couverture.png',
    donneesBase64: Buffer.from('png').toString('base64')
  });
  const depotAvantFermeture = kirby.imageProvisoire(DOSSIER_DOC, 'carte-jamais-enregistree');
  assert.ok(depotAvantFermeture, 'l’image n’a pas été mise de côté : rien à vider ne prouverait rien');
  assert.ok(fs.existsSync(path.join(DOSSIER_DOC, kirby.NOM_DEPOT_IMAGES)));

  // Fermeture sans enregistrer : la fiche jamais sauvegardée n'a donc jamais réclamé son image.
  await p._recepteur({ type: 'retourArticle', modifie: false, ressources: [], rubriques: [] });

  assert.ok(!fs.existsSync(path.join(DOSSIER_DOC, kirby.NOM_DEPOT_IMAGES)),
    '.depot-images/ aurait dû être vidé à la fermeture du formulaire');
  assert.strictEqual(kirby.imageProvisoire(DOSSIER_DOC, 'carte-jamais-enregistree'), null);
});

// ---- Aucun libellé français ne traîne dans le formulaire allemand ----
const IDENTIQUES_ADMISES = new Set([
  'https://…', '–', 'DOI', 'Genre', 'Liste',
  // Termes fédéraux et sigles, identiques dans les deux langues par nature — le contrat
  // (pipeline/kirby/champs-documentation.json) les porte tels quels.
  'International', 'National', 'Varia', 'Motion', 'Postulat', 'Interpellation', 'Anzug',
  'Curia Vista', 'IDES',
  // Les deux titres de revue : mêmes noms officiels des deux côtés de la langue.
  'Revue suisse de pédagogie spécialisée', 'Schweizerische Zeitschrift für Heilpädagogik'
]);
const CANTONS_IDENTIQUES = new Set();
for (const c of kirby.valeursListe('canton')) {
  if (c.fr === c.de) { CANTONS_IDENTIQUES.add(c.fr); }
}
// Le contrat écrit « Neuenburg » côté allemand (JSON.listes.canton) là où lib/cantons.js
// portait « Neuchâtel » des deux côtés : les deux tables ne sont plus tenues à jour
// ensemble, et c'est le contrat qui fait foi ici — NE n'est donc plus de la liste.
assert.deepStrictEqual([...CANTONS_IDENTIQUES].sort(),
  ['Jura', 'Tessin', 'Uri'].sort(),
  'la liste des cantons au nom identique dans les deux langues a changé : ' + [...CANTONS_IDENTIQUES].sort().join(', '));
for (const libelle of CANTONS_IDENTIQUES) { IDENTIQUES_ADMISES.add(libelle); }

function libellesActualite(langue) {
  const doc = require(COCKPIT_DOC);
  process.env.SZH_LANGUE = langue;
  try {
    const plat = {};
    const textes = doc._libelles.textesDocumentation('Zeitschrift');
    for (const cle of Object.keys(textes)) { plat['texte.' + cle] = String(textes[cle]); }
    for (const type of doc._libelles.typesRessourceConfig(langue)) {
      plat['fiche.' + type.valeur + '.section'] = String(type.libelleSection);
      plat['fiche.' + type.valeur + '.ajouter'] = String(type.libelleAjouter);
      plat['fiche.' + type.valeur + '.ajouter.tip'] = String(type.libelleAjouterTip);
      for (const champ of type.champs) {
        plat['champ.' + type.valeur + '.' + champ.cle] = String(champ.libelle);
        for (const option of (champ.options || [])) {
          plat['option.' + champ.cle + '.' + option.valeur] = String(option.libelle);
        }
      }
    }
    for (const type of doc._libelles.typesRubriqueConfig('revue', langue)) {
      plat['rubrique.' + type.valeur] = String(type.libelleSection);
    }
    return plat;
  } finally { delete process.env.SZH_LANGUE; }
}

test('ACTUALITÉ : le formulaire allemand ne garde aucun libellé français', () => {
  const fr = libellesActualite('fr');
  const de = libellesActualite('de');
  assert.ok(Object.keys(fr).length > 60, 'trop peu de libellés relevés (' + Object.keys(fr).length + ') : le relevé ne prouve rien');
  assert.deepStrictEqual(Object.keys(de).sort(), Object.keys(fr).sort(), 'les deux langues ne proposent pas les mêmes champs');
  const suspects = [];
  for (const cle of Object.keys(fr)) {
    assert.notStrictEqual(fr[cle], '', 'libellé vide : ' + cle);
    assert.notStrictEqual(fr[cle], 'undefined', 'libellé non fourni par l’hôte : ' + cle);
    if (fr[cle] === de[cle] && !IDENTIQUES_ADMISES.has(fr[cle])) { suspects.push(cle + ' = ' + JSON.stringify(fr[cle])); }
  }
  assert.deepStrictEqual(suspects, [],
    'libellés identiques dans les deux langues — écrits en dur, ou non traduits :' + LF + suspects.join(LF));
  for (const cle of Object.keys(de)) {
    assert.strictEqual(de[cle].indexOf('ß'), -1, 'eszett dans le libellé allemand : ' + cle);
  }
});

test('ACTUALITÉ : les libellés suivent la langue du cockpit, pas celle du numéro', () => {
  const de = libellesActualite('de');
  assert.strictEqual(de['fiche.livre.section'], 'Bücher');
  assert.strictEqual(de['champ.intervention.canton'], 'Kanton');
  assert.strictEqual(de['rubrique.podcasts'], 'Dokumentarfilme und Podcasts');
  const cantons = Object.keys(de).filter((c) => c.indexOf('option.canton.') === 0);
  assert.ok(cantons.length >= 27, 'la liste des cantons est incomplète : ' + cantons.length);
  assert.strictEqual(de['option.canton.BL'], 'Basel-Landschaft');
  assert.strictEqual(libellesActualite('fr')['option.canton.BL'], 'Bâle-Campagne');
});
