// La section « Actualité » de l'arbre, et la page de Documentation du numéro.
//
// Ce que le lot du 02.09.2026 a changé, et que ces tests fixent :
//   - la page de Documentation ne se liste PLUS dans l'arbre. Cliquer l'en-tête
//     « ACTUALITÉ » ouvre son formulaire, et la crée si le numéro n'en a pas encore :
//     « Supprime le fichier .md de la documentation, il n'est pas nécessaire. Lorsque l'on
//     clique sur "Actualité" affiche directement la liste des rubriques » ;
//   - la section ne contient donc que l'entrée « Réserve » ;
//   - le badge de l'en-tête compte les BLOCS de la page (fiches et rubriques), et non plus
//     les articles — il n'y en a qu'un ;
//   - un seul formulaire porte les deux familles (media/documentation.js).
//
// La fixture n'a AUCUNE page de Documentation au départ : le premier test la fait créer, et
// tous les suivants travaillent sur celle-là. C'est le seul moyen d'éprouver la création
// dans ce harnais, où l'hôte ne s'active qu'une fois par processus.
//
// Pourquoi un fichier à part de hote.test.js : celui-ci contrôle l'arbre d'un numéro
// ORDINAIRE et son jeu d'assertions positionnelles est déjà dense.
//
//   node --test test/js/actualite.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const LF = '\n';
const COCKPIT_DOC = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit',
  'lib', 'documentation-hote.js');
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

// Le nom de dossier que le cockpit donne à la page qu'il crée (SLUG_DOCUMENTATION).
const SLUG_DOC = 'documentation';
const DOSSIER_DOC = path.join(REVUE, 'articles', SLUG_DOC);
const MD_DOC = path.join(DOSSIER_DOC, SLUG_DOC + '.md');

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
// Le panneau fusionné, chargé. Deux panneaux du même type peuvent coexister — celui de la
// page de Documentation et celui d'un article ordinaire — et panneauDeType() rendrait le
// dernier créé : on les distingue donc par leur titre, qui porte le slug pour un article
// et le titre imprimé de la page pour la Documentation.
function panneauDont(predicat) {
  const p = HOTE.panneaux.filter((x) => x.type === 'szhDocumentation' && predicat(String(x.title || ''))).pop();
  assert.ok(p, 'panneau de Documentation absent');
  return p;
}
async function panneau() {
  const p = panneauDont((t) => t.indexOf('01-essai') === -1);
  await p._recepteur({ type: 'pret' });
  return p;
}
function charge(p) {
  const m = p.messages.filter((x) => x.type === 'charger').pop();
  assert.ok(m, 'aucune charge « charger »');
  return m;
}

test('les commandes du lot sont enregistrées', () => {
  for (const cmd of ['szh.documentation', 'szh.reserve', 'szh.ressourcesArticle']) {
    assert.ok(HOTE.commandes().includes(cmd), 'commande non enregistrée : ' + cmd);
  }
  // Le formulaire des rubriques n'existe plus séparément : sa commande a disparu avec lui.
  assert.ok(!HOTE.commandes().includes('szh.rubriquesArticle'),
    'szh.rubriquesArticle devrait avoir disparu avec le formulaire séparé');
});

// Avant toute création : la section existe déjà, et ne porte que la réserve.
test('sans page de Documentation, la section porte la réserve et aucun badge', async () => {
  const e = await entete();
  assert.strictEqual(e.description, undefined,
    'aucun bloc à compter : pas de badge — ' + e.description);
  const enfants = await enfantsDe('section-actualite');
  assert.deepStrictEqual(enfants.map((it) => it.contextValue), ['reserve'],
    'la section ne doit contenir que la réserve');
  assert.ok(enfants[0].command && enfants[0].command.command === 'szh.reserve',
    'l’entrée de réserve doit ouvrir la réserve au clic');
  assert.strictEqual(enfants[0].description, undefined,
    'une réserve vide ne doit pas porter de compteur');
});

// L'en-tête de section ouvre un FORMULAIRE, et non une vue d'ensemble : c'est le seul
// en-tête dans ce cas, et c'est ce que « affiche directement la liste des rubriques » veut
// dire — il n'y a qu'une page de Documentation par numéro.
test('cliquer l’en-tête ACTUALITÉ crée la page de Documentation et ouvre son formulaire', async () => {
  const e = await entete();
  assert.ok(e.command && e.command.command === 'szh.ouvrirSection',
    'l’en-tête doit passer par szh.ouvrirSection');
  assert.ok(!fs.existsSync(DOSSIER_DOC), 'la fixture ne devrait pas déjà porter la page');

  await HOTE.executer('szh.ouvrirSection', 'actualite');

  assert.ok(fs.existsSync(MD_DOC), 'le .md de la page n’a pas été créé');
  assert.strictEqual(fs.readFileSync(MD_DOC, 'utf8'), '',
    'le .md naît VIDE : ce n’est plus un texte à écrire, seulement un magasin de blocs');
  const meta = fs.readFileSync(path.join(DOSSIER_DOC, SLUG_DOC + '.meta.yaml'), 'utf8');
  assert.match(meta, /^type: documentation$/m, 'la fiche doit porter le type documentation');
  assert.match(meta, /Actualité et ressources/,
    'la page doit naître avec son titre imprimé, dans la langue du numéro');
  assert.ok(HOTE.statutsDits('Documentation créée').length > 0,
    'la création doit se dire dans la barre d’état');
  assert.ok(HOTE.panneauDeType('szhDocumentation'), 'le formulaire ne s’est pas ouvert');
});

test('la page créée n’apparaît NI dans ARTICLES, NI dans ACTUALITÉ', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre.listerArticles().includes(SLUG_DOC),
    'la page doit rester une unité du numéro : c’est elle que la chaîne compile');
  const articles = await enfantsDe('section-articles');
  assert.ok(!articles.some((it) => it.slug === SLUG_DOC),
    'la page de Documentation ne doit pas retomber dans ARTICLES');
  assert.ok(articles.some((it) => it.slug === '01-essai'),
    'un article ordinaire a disparu de ARTICLES');
  const actualite = await enfantsDe('section-actualite');
  assert.deepStrictEqual(actualite.map((it) => it.contextValue), ['reserve'],
    'ACTUALITÉ ne liste plus la page elle-même');
});

test('le badge de l’en-tête compte les blocs de la page, pas les articles', async () => {
  // Le .md est vide : rien à compter, donc pas de badge.
  assert.strictEqual((await entete()).description, undefined);
  // Deux blocs écrits à la main dans le magasin : le badge doit les voir tous les deux,
  // qu'ils soient fiche ou rubrique.
  fs.writeFileSync(MD_DOC, [
    '::: {#b1 .szh-rubrique type="tour-horizon"}', 'Une brève.', ':::', '',
    '::: {#r1 .szh-ressource type="livre" titre="Un livre"}', 'Un descriptif.', ':::', ''
  ].join(LF));
  assert.strictEqual(String((await entete()).description), '(2)',
    'le badge devrait compter la rubrique ET la fiche');
});

// reveal() remonte d'un article vers l'en-tête de SA section. La page de Documentation n'a
// plus d'item, mais categorieDeSlug reste utile : ouvrir son formulaire déplie ACTUALITÉ, et
// non ARTICLES — l'accordéon n'ouvre qu'une section à la fois.
test('la page de Documentation déplie ACTUALITÉ, un article ordinaire déplie ARTICLES', () => {
  const arbre = HOTE.arbre();
  assert.strictEqual(arbre.categorieDeSlug(SLUG_DOC), 'actualite');
  assert.strictEqual(arbre.categorieDeSlug('01-essai'), 'articles');
  assert.strictEqual(arbre.slugDocumentation(), SLUG_DOC);
});

// elementArticle() sert à resélectionner un article après reconstruction de l'arbre : sans
// item, il n'y a rien à resélectionner, et c'est sans conséquence — mais il ne doit pas
// lever pour autant.
test('elementArticle ignore la page de Documentation sans lever', () => {
  const arbre = HOTE.arbre();
  assert.strictEqual(arbre.elementArticle(SLUG_DOC), null);
  assert.ok(arbre.elementArticle('01-essai'), 'article ordinaire introuvable');
  assert.strictEqual(arbre.elementArticle('jamais-vu'), null);
});

// ---- Le formulaire fusionné -----------------------------------------------------------

test('le formulaire porte les cinq rubriques ET les six catégories de fiches', async () => {
  const p = await panneau();
  const m = charge(p);
  assert.deepStrictEqual(m.typesRubrique.map((t) => t.valeur),
    ['dossier-references', 'dossier-liens', 'tour-horizon', 'ressources', 'podcasts'],
    'les cinq rubriques de prose, dans l’ordre d’affichage');
  assert.deepStrictEqual(m.typesConfig.map((t) => t.valeur),
    ['livre', 'film', 'intervention', 'recherche', 'reprise', 'agenda'],
    'les six catégories de fiches, dans l’ordre de lib/ressources.js');
  for (const t of m.typesRubrique) {
    assert.ok(t.libelleSection, 'rubrique sans titre : ' + t.valeur);
    // Une rubrique n'a plus de bouton « Ajouter » : elle n'a qu'un bloc, toujours présent.
    assert.strictEqual(t.libelleAjouter, undefined,
      'une rubrique ne doit plus porter de libellé d’ajout : ' + t.valeur);
  }
  // Le bloc déjà présent dans le magasin est relu, et la fiche aussi.
  assert.deepStrictEqual(m.rubriques.map((r) => r.type), ['tour-horizon']);
  assert.strictEqual(m.rubriques[0].contenu, 'Une brève.');
  assert.deepStrictEqual(m.ressources.map((r) => r.type), ['livre']);
});

test('le canton se choisit dans une liste, l’agenda se saisit en dates', async () => {
  const m = charge(await panneau());
  const parType = {};
  for (const t of m.typesConfig) { parType[t.valeur] = t; }
  const canton = parType.intervention.champs.find((c) => c.cle === 'canton');
  assert.ok(canton.options && canton.options.length === 27,
    '26 cantons et la Confédération : ' + (canton.options || []).length);
  assert.match(canton.options[0].libelle, /\([A-Z]{2}\)$/,
    'le libellé doit porter le nom complet et l’abréviation entre parenthèses');
  // Ordre alphabétique du NOM, et non du code — c'est la consigne de saisie.
  const noms = canton.options.map((o) => o.libelle);
  assert.deepStrictEqual(noms, noms.slice().sort((a, b) => a.localeCompare(b, 'fr')),
    'la liste déroulante doit être rangée par ordre alphabétique');
  assert.ok(canton.options.some((o) => o.valeur === 'ZH'),
    'la valeur stockée doit être le code, c’est lui qui s’imprime');

  const agenda = parType.agenda.champs;
  assert.deepStrictEqual(agenda.map((c) => c.cle),
    ['evenement', 'debut', 'fin', 'lieu', 'organisateur']);
  assert.strictEqual(agenda.find((c) => c.cle === 'debut').saisie, 'date');
  assert.strictEqual(agenda.find((c) => c.cle === 'fin').saisie, 'date');
  const evenement = agenda.find((c) => c.cle === 'evenement');
  assert.ok(evenement.options && evenement.options.length === 6,
    'les six types d’événement du corpus');
  for (const o of evenement.options) {
    assert.ok(o.libelle && o.libelle !== o.valeur,
      'le jeton ' + o.valeur + ' doit être traduit pour la saisie');
  }
  // Une année de recherche n'est PAS une date : le mode de saisie suit le type, pas le nom.
  assert.strictEqual(parType.recherche.champs.find((c) => c.cle === 'debut').saisie, undefined);
});

// ⚠ Ce que ce harnais ne peut pas vérifier : la MUTATION RÉELLE du .md. WorkspaceEdit est un
// faux sans effet dans hote-factice.js. L'exactitude de ce qui est ÉCRIT est prouvée
// directement dans ressources.test.js et rubriques.test.js ; ce qui suit prouve le CÂBLAGE,
// par le seul canal qui traverse le faux : la barre d'état et les messages postés.
test('enregistrer : une rubrique remplie et une fiche incomplète comptent toutes deux', async () => {
  const p = await panneau();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-neuf', type: 'livre', valeurs: { titre: 'Titre seul' } }],
    rubriques: [{ id: 'b-neuf', type: 'podcasts', contenu: 'Un podcast.' }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'aucune confirmation reçue');
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1,
    'une fiche sans descriptif ni image doit désormais s’enregistrer, avec la rubrique');
});

test('enregistrer : une rubrique vidée est retirée du magasin', async () => {
  const p = await panneau();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  // b1 existe dans le .md (écrit plus haut) : vidée, elle doit en sortir.
  await p._recepteur({
    type: 'enregistrer', auto: false, ressources: [],
    rubriques: [{ id: 'b1', type: 'tour-horizon', contenu: '   ' }]
  });
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1,
    'le retrait d’une rubrique vidée est un bloc traité, et doit se dire');
});

test('enregistrer : une carte de fiche jamais remplie ne compte pas', async () => {
  const p = await panneau();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-vide', type: 'livre', valeurs: { titre: '', descriptif: '', image: '' } }],
    rubriques: []
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'la confirmation part quand même');
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant,
    'un clic sur « Ajouter » suivi de rien ne doit rien écrire');
});

// Sur la page de Documentation, « Retour » ne rouvre AUCUN .md : son texte n'est plus une
// pièce à relire (« Supprime le fichier .md de la documentation »). Observable comme dans
// ressources-hote.test.js, sans dépendre de WorkspaceEdit : le panneau se ferme et libère
// son slug, donc rouvrir en crée un NEUF.
test('retour : la page de Documentation se referme et libère son slug', async () => {
  const p = await panneau();
  const avant = HOTE.panneaux.length;
  await p._recepteur({ type: 'retourArticle', modifie: false, ressources: [], rubriques: [] });
  await HOTE.executer('szh.documentation');
  assert.strictEqual(HOTE.panneaux.length, avant + 1,
    'rouvrir après un retour n’a pas créé un panneau neuf : la table des panneaux n’a pas ' +
    'été libérée à la fermeture');
});

// Le même panneau sert un article ordinaire, sans ses rubriques : un article peut relever un
// livre, il ne tient pas le « Tour d'horizon » du numéro. Ce test vient en dernier parce
// qu'il ouvre un SECOND panneau du même type, ce qui brouillerait la sélection des tests
// précédents.
test('un article ordinaire reçoit les fiches, mais aucune rubrique', async () => {
  await HOTE.executer('szh.ressourcesArticle', { slug: '01-essai' });
  const p = panneauDont((t) => t.indexOf('01-essai') !== -1);
  await p._recepteur({ type: 'pret' });
  const m = p.messages.filter((x) => x.type === 'charger').pop();
  assert.deepStrictEqual(m.typesRubrique, [],
    'un article ordinaire ne tient pas le « Tour d’horizon » du numéro');
  assert.deepStrictEqual(m.rubriques, []);
  assert.strictEqual(m.typesConfig.length, 6,
    'il garde en revanche toutes ses catégories de fiches');
});

// ---- Aucun libellé français ne traîne dans le formulaire allemand ----
//
// Le symptôme rapporté le 08.09.2026 : sur un poste dont l'interface était en allemand, les
// champs d'ACTUALITÉ restaient en français. Deux causes possibles, et il faut les séparer,
// car elles ne se réparent pas au même endroit.
//
//   1. Le cockpit parlait français alors que les menus parlaient allemand. Ce n'est pas une
//      traduction manquante : les menus viennent de package.nls*.json (langue d'affichage de
//      l'éditeur) et les formulaires de lib/i18n.js (cascade de sourceLangue). Cette cause-là
//      est gardée par test/js/langue-interface.test.js, et se lit sur un poste par
//      windows/diagnostic.ps1.
//
//   2. Un libellé écrit en dur, ou traduit en français dans la table allemande. La parité des
//      clés (contrats.test.js) ne l'attrape pas : une clé PRÉSENTE en allemand mais dont la
//      valeur est restée française passe, et un littéral français dans
//      lib/documentation-hote.js passe aussi. C'est ce que ce contrôle-ci attrape, en
//      construisant les libellés du formulaire dans les DEUX langues et en exigeant qu'ils
//      diffèrent.
//
// Les seuls libellés autorisés à être identiques : ce qui n'est pas un mot de langue. La
// liste est courte et explicite — l'allonger doit être un geste réfléchi, pas un réflexe pour
// faire passer le contrôle.
const IDENTIQUES_ADMISES = new Set([
  'https://…',   // le gabarit d'une adresse Internet
  '–',           // le tiret de l'option vide d'une liste déroulante
  'DOI',         // sigle
  'Genre',       // s'écrit ainsi dans les deux langues
  'Liste'        // idem
]);

// Les cantons, eux, ne s'inscrivent pas à la main sur cette liste : quatre d'entre eux
// portent le même nom dans les deux langues (Jura, Neuchâtel, Tessin, Uri) et la table de
// lib/cantons.js le dit déjà. On la relit plutôt que de recopier les quatre noms, qui
// deviendraient faux le jour où la table changerait d'avis — sans cesser de faire passer
// le contrôle, ce qui est le pire des deux mondes.
for (const c of require(path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit',
  'lib', 'cantons.js')).CANTONS) {
  if (c.fr === c.de) { IDENTIQUES_ADMISES.add(c.fr + ' (' + c.code + ')'); }
}

// Tous les libellés du formulaire d'ACTUALITÉ dans une langue donnée, mis à plat : les
// textes de la page, les sections et les champs de chaque type de fiche, et les titres des
// rubriques. On passe par la vraie fonction de l'hôte, pas par la table de traduction : un
// libellé écrit en dur dans lib/documentation-hote.js doit tomber ici.
function libellesActualite(langue) {
  const doc = require(COCKPIT_DOC);
  process.env.SZH_LANGUE = langue;
  try {
    const plat = {};
    const textes = doc._libelles.textesDocumentation('Zeitschrift');
    for (const cle of Object.keys(textes)) { plat['texte.' + cle] = String(textes[cle]); }
    for (const type of doc._libelles.typesRessourceConfig()) {
      plat['fiche.' + type.valeur + '.section'] = String(type.libelleSection);
      plat['fiche.' + type.valeur + '.ajouter'] = String(type.libelleAjouter);
      plat['fiche.' + type.valeur + '.ajouter.tip'] = String(type.libelleAjouterTip);
      for (const champ of type.champs) {
        plat['champ.' + champ.cle] = String(champ.libelle);
        for (const option of (champ.options || [])) {
          plat['option.' + champ.cle + '.' + option.valeur] = String(option.libelle);
        }
      }
    }
    for (const type of doc._libelles.typesRubriqueConfig()) {
      plat['rubrique.' + type.valeur] = String(type.libelleSection);
    }
    return plat;
  } finally { delete process.env.SZH_LANGUE; }
}

test('ACTUALITÉ : le formulaire allemand ne garde aucun libellé français', () => {
  const fr = libellesActualite('fr');
  const de = libellesActualite('de');
  assert.ok(Object.keys(fr).length > 60,
    'trop peu de libellés relevés (' + Object.keys(fr).length + ') : le relevé ne prouve rien');
  // Triés : les listes déroulantes se rangent par ordre alphabétique DANS leur langue —
  // « Bâle-Campagne » avant « Berne », « Basel-Landschaft » après « Bern » — et l'ordre des
  // clés diffère donc légitimement d'une langue à l'autre. Ce sont les champs offerts qui
  // doivent être les mêmes, pas leur rang.
  assert.deepStrictEqual(Object.keys(de).sort(), Object.keys(fr).sort(),
    'les deux langues ne proposent pas les mêmes champs');
  const suspects = [];
  for (const cle of Object.keys(fr)) {
    assert.notStrictEqual(fr[cle], '', 'libellé vide : ' + cle);
    assert.notStrictEqual(fr[cle], 'undefined', 'libellé non fourni par l’hôte : ' + cle);
    if (fr[cle] === de[cle] && !IDENTIQUES_ADMISES.has(fr[cle])) {
      suspects.push(cle + ' = ' + JSON.stringify(fr[cle]));
    }
  }
  assert.deepStrictEqual(suspects, [],
    'libellés identiques dans les deux langues — écrits en dur, ou non traduits :' + LF
      + suspects.join(LF));
  // Et l'allemand de la maison s'écrit en « ss ».
  for (const cle of Object.keys(de)) {
    assert.strictEqual(de[cle].indexOf('ß'), -1, 'eszett dans le libellé allemand : ' + cle);
  }
});

test('ACTUALITÉ : les libellés suivent la langue du cockpit, pas celle du numéro', () => {
  // La règle en vigueur, écrite noir sur blanc pour qu'un changement d'avis soit un geste
  // délibéré : ce formulaire est une interface, il parle donc la langue de la personne qui
  // s'en sert. La fixture est une Revue française ; les libellés doivent pourtant sortir en
  // allemand dès que le cockpit est en allemand.
  const de = libellesActualite('de');
  assert.strictEqual(de['fiche.livre.section'], 'Bücher');
  assert.strictEqual(de['champ.canton'], 'Kanton');
  assert.strictEqual(de['rubrique.tour-horizon'], 'Rundschau');
  // Les cantons aussi, jusque dans les options de la liste déroulante.
  const cantons = Object.keys(de).filter((c) => c.indexOf('option.canton.') === 0);
  assert.ok(cantons.length >= 27, 'la liste des cantons est incomplète : ' + cantons.length);
  // Le code suit le nom : c'est lui qui s'écrit dans la fiche (canton="BL"), et le voir à
  // la saisie évite d'avoir à deviner lequel des vingt-six a été retenu.
  assert.strictEqual(de['option.canton.BL'], 'Basel-Landschaft (BL)');
  assert.strictEqual(libellesActualite('fr')['option.canton.BL'], 'Bâle-Campagne (BL)');
});
