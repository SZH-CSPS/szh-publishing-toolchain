// La section « Actualité » de l'arbre, et la page de Documentation du numéro : rubriques
// (documentation.<lang>.txt, propres au numéro) et fiches (bibliothèque partagée
// _NewsUndActu\Fiches\, lib/kirby-contenu.js) dans un seul formulaire.
//
// Ce que ce fichier fixe :
//   - la page de Documentation ne se liste PLUS dans l'arbre. Cliquer l'en-tête
//     « ACTUALITÉ » ouvre son formulaire, et la crée si le numéro n'en a pas encore ;
//   - la section a cinq enfants FIXES (23.09.2026, révisé le même jour — toute la navigation
//     passe par l'arbre, la page n'a plus de barre d'onglets) : « Documentation du numéro »
//     (elle-même dépliable), « Traductions à faire », « Réservoir », « Archive », puis
//     « Publier sur le site web » grisée (pas de commande, jamais cliquable) ;
//   - le badge de l'en-tête compte les fiches rattachées au numéro et les rubriques non
//     vides ; les compteurs de Documentation du numéro/Traductions/Réservoir reprennent les
//     mêmes fonctions que les anciens badges d'onglet du formulaire, l'Archive reprend le
//     dernier compte connu d'un panneau qui a chargé cet onglet (rien tant qu'aucun ne l'a
//     fait — jamais une lecture de la bibliothèque de PRODUCTION depuis l'arbre) ;
//   - « Documentation du numéro » se déplie sur « Rubriques » (les 4 champs de texte long)
//     puis une entrée par type de fiche du contrat, avec son compte ;
//   - cliquer une entrée ouvre le formulaire de Documentation DIRECTEMENT sur cette vue
//     (szh.ouvrirActualite), et bascule un panneau déjà ouvert plutôt que d'en rouvrir un ;
//   - un seul formulaire porte rubriques, fiches, traductions à faire, réservoir et
//     orphelines (media/documentation.js), une seule catégorie affichée à la fois.
//
// kirby-contenu.js écrit par fs direct, sans passer par vscode.workspace/WorkspaceEdit (faux
// sans effet dans ce harnais, voir hote-factice.js) — les mutations d'« enregistrer » sont
// donc RÉELLES ici.
//
//   node --test test/js/actualite.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const LF = '\n';
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const COCKPIT_DOC = path.join(COCKPIT, 'lib', 'documentation-hote.js');
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

// Le nom de dossier que le cockpit donne à la page qu'il crée (SLUG_DOCUMENTATION).
const SLUG_DOC = 'documentation';
const DOSSIER_DOC = path.join(REVUE, 'articles', SLUG_DOC);
const TXT_DOC = path.join(DOSSIER_DOC, 'documentation.fr.txt');
// La bibliothèque des fiches vit à la racine de l'arbre — ici le parent du dossier factice,
// qui ne porte aucun des noms reconnus (Revue, Zeitschrift…) : racineArbre() dégrade sur ce
// parent, exactement comme documentation-hote.js le calcule pour ce même numéro.
const RACINE_ARBRE = kirby.racineArbre(REVUE);
function ausgabeId() { return yaml.idNumero(REVUE); }

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

test('les commandes du lot sont enregistrées, la réserve a disparu', () => {
  assert.ok(HOTE.commandes().includes('szh.documentation'), 'commande non enregistrée : szh.documentation');
  assert.ok(!HOTE.commandes().includes('szh.reserve'), 'szh.reserve devrait avoir disparu avec lib/reserve.js');
  assert.ok(!HOTE.commandes().includes('szh.rubriquesArticle'),
    'szh.rubriquesArticle devrait avoir disparu avec le formulaire séparé');
  assert.ok(!HOTE.commandes().includes('szh.ressourcesArticle'),
    'szh.ressourcesArticle devrait avoir disparu : les fiches ne vivent plus que sur la Documentation');
});

// L'id du numéro (ausgabe.yaml#id) doit être posé à l'OUVERTURE DU NUMÉRO — l'activation du
// cockpit sur ce dossier (extension.js#majContexte, poserIdNumeroEtAvertirDoublon) — jamais
// seulement à l'ouverture du formulaire de Documentation : le pipeline refuse désormais de
// compiler une Documentation sans id, et un numéro dont on n'ouvre jamais la Documentation à
// la main doit quand même pouvoir compiler. demarrageSeTait() laisse le démarrage asynchrone
// (demarrageInitial -> majContexte, jamais attendu par activate()) aller à son terme.
test('id du numéro : posé à l’ouverture du numéro, sans jamais ouvrir la Documentation', async () => {
  await demarrageSeTait(HOTE);
  assert.match(yaml.idNumero(REVUE), /^[A-Za-z0-9]{16}$/,
    'l’id doit exister dès l’activation du cockpit sur ce numéro');
});

// Avant toute création de la page de Documentation : l'en-tête n'a pas de badge (l'id posé
// au test précédent n'y change rien : aucune fiche n'est encore rattachée à ce numéro), mais
// ses cinq entrées sont déjà là — elles ne dépendent pas de l'existence de la page.
test('sans page de Documentation, l’en-tête ACTUALITÉ n’a pas de badge, ses cinq entrées oui', async () => {
  const e = await entete();
  assert.strictEqual(e.description, undefined, 'aucun bloc à compter : pas de badge — ' + e.description);
  const enfants = await enfantsDe('section-actualite');
  assert.strictEqual(enfants.length, 5, 'les cinq entrées doivent exister même sans page de Documentation');
  for (const it of enfants) { assert.strictEqual(it.description, undefined, 'rien à compter encore : ' + it.label); }
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

test('la page créée n’apparaît NI dans ARTICLES, NI dans ACTUALITÉ (qui garde ses cinq entrées)', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre.listerArticles().includes(SLUG_DOC), 'la page doit rester une unité du numéro : c’est elle que la chaîne compile');
  const articles = await enfantsDe('section-articles');
  assert.ok(!articles.some((it) => it.slug === SLUG_DOC), 'la page de Documentation ne doit pas retomber dans ARTICLES');
  assert.ok(articles.some((it) => it.slug === '01-essai'), 'un article ordinaire a disparu de ARTICLES');
  const actualite = await enfantsDe('section-actualite');
  assert.ok(!actualite.some((it) => it.slug === SLUG_DOC), 'ACTUALITÉ ne liste jamais la page elle-même');
  assert.strictEqual(actualite.length, 5, 'toujours les cinq entrées, rien d’autre');
});

test('le badge de l’en-tête compte les fiches et les rubriques non vides', async () => {
  assert.strictEqual((await entete()).description, undefined, 'rien encore écrit : pas de badge');
  // Une fiche et une rubrique, écrites directement par le module pur — c'est ce que le
  // formulaire ferait, sans passer par le faux WorkspaceEdit de ce harnais. L'id du numéro
  // a déjà été posé à l'ouverture du numéro (voir le test dédié, plus haut).
  assert.ok(ausgabeId(), 'l’id de numéro devrait déjà exister');
  kirby.ecrirePage(DOSSIER_DOC, 'fr', {
    title: 'Actualité et ressources',
    rubriques: { podcasts: 'Un podcast.' }
  });
  kirby.creerFiche(RACINE_ARBRE, 'fr', 'livre', {
    categorie: 'manuel', title: 'Un livre', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D'
  }, ausgabeId());
  kirby.reordonnerNumero(RACINE_ARBRE, 'fr', ausgabeId());
  assert.strictEqual(String((await entete()).description), '(2)',
    'le badge devrait compter la rubrique ET la fiche');
});

// ---- Les cinq entrées de ACTUALITÉ (23.09.2026, révisé le même jour) -------------------
test('arbre : les cinq entrées de ACTUALITÉ, dans l’ordre voulu par Robin, avec leurs commandes et leurs compteurs', async () => {
  // Rien n'a encore été écrit côté traductions/réservoir à ce point du fichier : leurs
  // compteurs sont donc à 0 — recalculés ici plutôt qu'écrits en dur, pour ne pas dépendre de
  // l'ordre des tests. « Documentation du numéro » reprend l'état posé par le test précédent
  // (une rubrique, une fiche). L'Archive n'a encore jamais été lue par aucun panneau : pas de
  // badge du tout (compteArchiveConnu() rend undefined).
  const nTraductions = kirby.listerTraductionsATraire(RACINE_ARBRE, 'fr').length;
  const nReservoir = kirby.listerReservoir(RACINE_ARBRE, 'fr', { avecIgnorees: false }).length
    + kirby.listerOrphelines(RACINE_ARBRE, 'fr').length;
  const page = kirby.lirePage(DOSSIER_DOC, 'fr');
  const nRubriques = Object.keys(page.rubriques).filter((c) => String(page.rubriques[c] || '').trim() !== '').length;
  const nFiches = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).length;
  const nBlocs = nRubriques + nFiches;
  assert.strictEqual(nTraductions, 0);
  assert.strictEqual(nReservoir, 0);
  assert.strictEqual(nBlocs, 2, 'fixture attendue à ce point du fichier : une rubrique et une fiche');

  const entrees = await enfantsDe('section-actualite');
  assert.strictEqual(entrees.length, 5);
  assert.deepStrictEqual(entrees.map((it) => it.command && it.command.command),
    ['szh.ouvrirActualite', 'szh.ouvrirActualite', 'szh.ouvrirActualite', 'szh.ouvrirActualite', undefined],
    '« Publier sur le site web » ne porte AUCUNE commande : jamais cliquable');
  assert.deepStrictEqual(entrees.slice(0, 4).map((it) => it.command.arguments),
    [['numero', 'rubriques'], ['traductions'], ['reservoir'], ['archive']],
    '« Documentation du numéro » ouvre sur « Rubriques » par défaut');
  assert.deepStrictEqual(entrees.map((it) => it.label),
    [T('doc.onglet.numero'), T('doc.onglet.traductions'), T('doc.onglet.reservoir'), T('doc.onglet.archive'),
      T('arbre.actualite.publier')],
    'les quatre premiers libellés reprennent ceux des anciens onglets, mot pour mot');
  assert.strictEqual(entrees[0].description, '(' + nBlocs + ')', 'Documentation du numéro');
  assert.strictEqual(entrees[1].description, undefined, 'aucune traduction à faire : pas de badge');
  assert.strictEqual(entrees[2].description, undefined, 'réservoir vide : pas de badge');
  assert.strictEqual(entrees[3].description, undefined,
    'l’Archive n’a pas encore été lue par un panneau : aucun badge, jamais une lecture depuis l’arbre');
  assert.strictEqual(entrees[4].description, undefined, 'Publier sur le site web : rien à compter');
  assert.strictEqual(entrees[4].contextValue, 'actualite-entree-desactivee');
  for (const it of entrees) {
    assert.ok(it.tooltip, 'info-bulle absente : ' + it.label);
    assert.ok(it.iconPath && it.iconPath.id, 'icône absente : ' + it.label);
  }
  // Aucune entrée ne se déplie : les catégories sont dans la barre du formulaire.
  for (const it of entrees) { assert.strictEqual(it.collapsibleState, 0, it.label + ' ne doit pas être dépliable'); }
});

// ---- « Documentation du numéro » ne se déplie plus (24.09.2026) ------------------------
// Les catégories vivent dans la barre du formulaire (media/documentation.js) ; l'arbre n'en
// garde qu'un raccourci. Le libellé court du cockpit reste celui du contrat.
test('libellé court du cockpit : « Agenda », distinct du titre imprimé', () => {
  assert.strictEqual(kirby.libelleCockpitType('agenda', 'fr'), 'Agenda');
  assert.notStrictEqual(kirby.libelleCockpitType('agenda', 'fr'), kirby.libelleType('agenda', 'fr'));
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
  const fiches = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).filter((f) => f.type === 'film');
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
  const avant = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-vide', type: 'livre', valeurs: { title: '', descriptif: '' } }],
    rubriques: []
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'la confirmation part quand même');
  assert.strictEqual(kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).length, avant,
    'un clic sur « Ajouter » suivi de rien ne doit rien écrire');
});

// ---- supprimerFicheNumero : effacement définitif depuis une carte du numéro (23.09.2026) --
//
// Geste DISTINCT de RETIRER (qui ne fait que détacher) : confirmation modale native, puis
// effacement réel. Si l'autre langue existe, elle survit ; sinon le dossier entier part.
test('supprimerFicheNumero : sans réponse la fiche reste ; confirmé, seule la langue du numéro part si l’autre existe', async () => {
  const { uuid, slug } = kirby.creerFiche(RACINE_ARBRE, 'fr', 'film',
    { title: 'Fiche bilingue', realisateur: 'X', annee: '2026', descriptif: 'D' }, ausgabeId());
  kirby.traduireDansNumero(RACINE_ARBRE, slug, 'de', '');   // même slug, autre langue, orpheline
  const p = await panneau();
  const avant = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).length;

  // Aucune réponse en file -> Annuler (hote-factice.js) : rien ne doit disparaître.
  await p._recepteur({ type: 'supprimerFicheNumero', id: uuid });
  assert.ok(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr'), 'annulé : la fiche doit rester');

  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await p._recepteur({ type: 'supprimerFicheNumero', id: uuid });
  assert.strictEqual(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr'), null,
    'confirmé : la version française doit disparaître');
  assert.ok(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'de'), 'la version allemande doit rester');
  assert.strictEqual(kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).length, avant - 1);
});

test('supprimerFicheNumero : sans version dans l’autre langue, le dossier entier part et l’ordre du numéro se recalcule', async () => {
  kirby.creerFiche(RACINE_ARBRE, 'fr', 'film',
    { title: 'Une autre fiche', realisateur: 'Y', annee: '2026', descriptif: 'D' }, ausgabeId());
  const { uuid, slug } = kirby.creerFiche(RACINE_ARBRE, 'fr', 'film',
    { title: 'Fiche seule', realisateur: 'X', annee: '2026', descriptif: 'D' }, ausgabeId());
  const p = await panneau();
  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await p._recepteur({ type: 'supprimerFicheNumero', id: uuid });
  assert.strictEqual(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr'), null);
  assert.ok(!fs.existsSync(kirby.cheminFiche(RACINE_ARBRE, 'film', slug)), 'le dossier entier doit disparaître');
  // reordonnerNumero() a été rejoué : la fiche restante a un rang, la fiche effacée n'y
  // figure plus (ce numéro porte déjà d'autres fiches, posées par les tests précédents —
  // pas d'hypothèse sur le rang absolu, seulement sur la présence/absence).
  const restantes = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId());
  const restante = restantes.filter((f) => f.valeurs.title === 'Une autre fiche');
  assert.strictEqual(restante.length, 1);
  assert.strictEqual(typeof restante[0].ordre, 'number');
  assert.ok(!restantes.some((f) => f.valeurs.title === 'Fiche seule'), 'la fiche effacée ne doit plus figurer dans le numéro');
});

test('supprimerFicheNumero : un id inconnu ne fait rien et ne lève pas', async () => {
  const p = await panneau();
  const avantModales = HOTE.modales.length;
  await p._recepteur({ type: 'supprimerFicheNumero', id: 'jamais-vu' });
  // Aucune exception, aucune modale (rien à confirmer sur une carte introuvable).
  assert.strictEqual(HOTE.modales.length, avantModales);
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
// rejoindre le dossier de la fiche et quitter le dépôt provisoire (hors bibliothèque,
// os.tmpdir() — lib/kirby-contenu.js), pas y traîner à côté.
test('le dépôt provisoire d’image est vidé pour une carte dont la fiche vient d’être enregistrée', async () => {
  const p = await panneau();
  await p._recepteur({
    type: 'deposer-image', id: 'carte-avec-image', nomFichier: 'couverture.png',
    donneesBase64: Buffer.from('png').toString('base64')
  });
  assert.ok(kirby.imageProvisoire('carte-avec-image'), 'l’image n’a pas été mise de côté');
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'carte-avec-image', type: 'livre', valeurs: {
      categorie: 'manuel', title: 'Avec image', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D'
    } }]
  });
  assert.strictEqual(kirby.imageProvisoire('carte-avec-image'), null,
    'l’image déposée traîne encore dans le dépôt provisoire après l’enregistrement de sa fiche');
  const fiche = kirby.listerFichesNumero(RACINE_ARBRE, 'fr', ausgabeId()).find((f) => f.valeurs.title === 'Avec image');
  assert.ok(fiche, 'la fiche n’a pas été écrite');
  assert.strictEqual(fiche.valeurs.couverture, 'couverture.png');
});

// Une image déposée pour une fiche encore neuve (jamais enregistrée) se met de côté dans le
// dépôt provisoire — voir lib/kirby-contenu.js. Si la carte est retirée avant sauvegarde, ou
// si le formulaire se ferme sans enregistrer, ce dépôt doit être vidé : un fichier orphelin
// ne doit pas s'accumuler indéfiniment sur le poste.
test('le dépôt provisoire d’image est vidé quand le formulaire se ferme sans avoir enregistré la fiche', async () => {
  const p = await panneau();
  await p._recepteur({
    type: 'deposer-image', id: 'carte-jamais-enregistree', nomFichier: 'couverture.png',
    donneesBase64: Buffer.from('png').toString('base64')
  });
  const depotAvantFermeture = kirby.imageProvisoire('carte-jamais-enregistree');
  assert.ok(depotAvantFermeture, 'l’image n’a pas été mise de côté : rien à vider ne prouverait rien');

  // Fermeture sans enregistrer : la fiche jamais sauvegardée n'a donc jamais réclamé son image.
  await p._recepteur({ type: 'retourArticle', modifie: false, ressources: [], rubriques: [] });

  assert.strictEqual(kirby.imageProvisoire('carte-jamais-enregistree'), null,
    'le dépôt provisoire aurait dû être vidé à la fermeture du formulaire');
});

// ---- szh.ouvrirActualite : ouverture sur un onglet, bascule d'un panneau déjà ouvert ----
//
// Le panneau est fermé à ce point du fichier (le test précédent l'a refermé par
// retourArticle) : un terrain propre pour vérifier l'ouverture initiale, PUIS la bascule
// d'un panneau qui reste ouvert d'un test à l'autre.
test('szh.ouvrirActualite : ouvre le formulaire directement sur l’onglet demandé', async () => {
  // panneaux n'oublie jamais un panneau (même disposé) : ce que prouve « un panneau neuf »,
  // c'est que la longueur grandit — exactement le contrat du test « retour » plus haut.
  const avant = HOTE.panneaux.length;

  await HOTE.executer('szh.ouvrirActualite', 'reservoir');
  assert.strictEqual(HOTE.panneaux.length, avant + 1, 'un panneau neuf doit s’ouvrir');

  const p = await panneau();   // envoie « pret », lit la réponse « charger »
  const m = charge(p);
  assert.deepStrictEqual(m.vueInitiale, { onglet: 'reservoir', categorie: undefined },
    'le tout premier chargement doit porter la vue demandée (media/documentation.js la lit une fois)');
});

test('szh.ouvrirActualite : un panneau déjà ouvert se met au premier plan et bascule, sans se recharger', async () => {
  const p = dernierPanneauDoc();
  p.messages.length = 0;
  const avant = HOTE.panneaux.length;

  await HOTE.executer('szh.ouvrirActualite', 'numero', 'livre');

  assert.strictEqual(HOTE.panneaux.length, avant, 'aucun panneau neuf : celui déjà ouvert est réutilisé');
  assert.ok(p.messages.some((msg) => msg.type === 'ongletActiver' && msg.cle === 'numero' && msg.categorie === 'livre'),
    'le panneau déjà ouvert doit recevoir le message de bascule, onglet ET catégorie');
  assert.ok(!p.messages.some((msg) => msg.type === 'charger'),
    'basculer de vue sur un panneau déjà ouvert ne doit jamais redéclencher un chargement complet');
});

test('szh.documentation (en-tête « ACTUALITÉ ») n’impose aucune vue : pas de bascule sur un panneau déjà ouvert', async () => {
  const p = dernierPanneauDoc();
  p.messages.length = 0;
  const avant = HOTE.panneaux.length;

  await HOTE.executer('szh.documentation');

  assert.strictEqual(HOTE.panneaux.length, avant, 'le panneau déjà ouvert est réutilisé, pas recréé');
  assert.ok(!p.messages.some((msg) => msg.type === 'ongletActiver'),
    'sans vue demandée, aucune bascule ne doit partir');
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
// Idem pour les pays (liste_multiple `pays` d'un film, ISO 3166-1, 250 jetons, 23.09.2026) :
// beaucoup de noms sont identiques en français et en allemand (« Monaco », « Pakistan »…),
// un fait linguistique et non une traduction manquante — pas de liste figée ici (250 entrées,
// contrairement aux 26 cantons) : on l'accepte pour toute la liste, robuste à son évolution.
for (const p of kirby.valeursListe('pays')) { if (p.fr === p.de) { IDENTIQUES_ADMISES.add(p.fr); } }

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

// ---- Traductions à faire / Réservoir / Mes orphelines : le protocole de bout en bout ----
//
// Ce numéro (REVUE) est en français. Une fiche écrite directement en allemand, hors de ce
// numéro, joue le rôle d'une fiche reçue de la Zeitschrift.

test('traduire dans ce numéro : crée le fichier français, pré-rempli, rattaché à ce numéro', async () => {
  const { uuid, slug } = kirby.creerFiche(RACINE_ARBRE, 'de', 'livre',
    { categorie: 'manuel', title: 'Ein Buch', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, '');
  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({ type: 'traduireDansNumero', slug: slug });
  const fr = kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr');
  assert.ok(fr, 'le fichier français n’a pas été créé');
  assert.strictEqual(fr.uuid, uuid, 'même Uuid des deux côtés');
  assert.strictEqual(fr.ausgabe, ausgabeId(), 'rattachée à ce numéro');
  assert.strictEqual(fr.valeurs.title, 'Ein Buch', 'point de départ : reprise telle quelle, à réécrire');
});

test('tirer dans ce numéro : rattache une de mes orphelines', async () => {
  const { slug } = kirby.creerFiche(RACINE_ARBRE, 'fr', 'film',
    { title: 'Film orphelin', realisateur: 'X', annee: '2026', descriptif: 'D' }, '');
  const p = await panneau();
  await p._recepteur({ type: 'tirerDansNumero', slug: slug });
  const f = kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr');
  assert.strictEqual(f.ausgabe, ausgabeId());
});

test('supprimer une orpheline : refuse sans confirmation, efface après confirmation', async () => {
  const { slug } = kirby.creerFiche(RACINE_ARBRE, 'fr', 'film',
    { title: 'À supprimer', realisateur: 'X', annee: '2026', descriptif: 'D' }, '');
  const p = await panneau();
  // Aucune réponse en file -> Annuler (voir hote-factice.js) : rien ne doit disparaître.
  await p._recepteur({ type: 'supprimer', slug: slug });
  assert.ok(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr'), 'annulé : la fiche doit rester');

  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await p._recepteur({ type: 'supprimer', slug: slug });
  assert.strictEqual(kirby.lireFicheSlugLangue(RACINE_ARBRE, slug, 'fr'), null, 'confirmé : la fiche doit être effacée');
});

test('réservoir : marquer à traduire, ignorer, puis annuler la décision', async () => {
  const { uuid } = kirby.creerFiche(RACINE_ARBRE, 'de', 'livre',
    { categorie: 'manuel', title: 'Reserviert', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, ausgabeId());
  const p = await panneau();
  await p._recepteur({ type: 'marquerATraduire', uuid: uuid });
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuid).statut, 'a-traduire');

  await p._recepteur({ type: 'ignorerTraduction', uuid: uuid });
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuid).statut, 'ignore');

  await p._recepteur({ type: 'annulerDecisionTraduction', uuid: uuid });
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuid), null);
});

// ---- Sélection multiple du réservoir : un seul message, un tableau d'uuid --------------
test('réservoir en lot : « uuids » écrit le statut de toutes les fiches en un seul passage', async () => {
  const { uuid: uuidA } = kirby.creerFiche(RACINE_ARBRE, 'de', 'livre',
    { categorie: 'manuel', title: 'Lot A', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, ausgabeId());
  const { uuid: uuidB } = kirby.creerFiche(RACINE_ARBRE, 'de', 'film',
    { title: 'Lot B', realisateur: 'X', annee: '2026', descriptif: 'D' }, ausgabeId());
  const { uuid: uuidC } = kirby.creerFiche(RACINE_ARBRE, 'de', 'horizon',
    { portee: 'national', title: 'Lot C', descriptif: 'D' }, ausgabeId());
  const p = await panneau();
  p.messages.length = 0;

  await p._recepteur({ type: 'marquerATraduire', uuids: [uuidA, uuidB] });
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidA).statut, 'a-traduire');
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidB).statut, 'a-traduire');
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidC), null, 'hors du lot : pas touchée');
  // Un seul rechargement pour tout le lot — pas un « charger » par fiche.
  assert.strictEqual(p.messages.filter((m) => m.type === 'charger').length, 1);

  await p._recepteur({ type: 'ignorerTraduction', uuids: [uuidA, uuidC] });
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidA).statut, 'ignore');
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidC).statut, 'ignore');
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidB).statut, 'a-traduire', 'hors du lot : pas touchée');

  await p._recepteur({ type: 'annulerDecisionTraduction', uuids: [uuidA, uuidB, uuidC] });
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidA), null);
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidB), null);
  assert.strictEqual(kirby.lireStatutFiche(RACINE_ARBRE, 'fr', uuidC), null);
});

test('réservoir en lot : un tableau vide, ou absent, ne fait rien et ne lève pas', async () => {
  const p = await panneau();
  p.messages.length = 0;
  await p._recepteur({ type: 'marquerATraduire', uuids: [] });
  await p._recepteur({ type: 'ignorerTraduction' });
  assert.strictEqual(p.messages.filter((m) => m.type === 'charger').length, 0,
    'un lot vide ne doit provoquer aucun rechargement');
});

test('charger() porte les traductions à faire, le réservoir et mes orphelines', async () => {
  const { uuid: uuidReservoir } = kirby.creerFiche(RACINE_ARBRE, 'de', 'livre',
    { categorie: 'manuel', title: 'Au réservoir', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, ausgabeId());
  const { uuid: uuidATraire } = kirby.creerFiche(RACINE_ARBRE, 'de', 'livre',
    { categorie: 'manuel', title: 'À traduire', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D' }, ausgabeId());
  kirby.ecrireStatutFiche(RACINE_ARBRE, 'fr', uuidATraire, 'a-traduire');
  kirby.creerFiche(RACINE_ARBRE, 'fr', 'film',
    { title: 'Mon orpheline', realisateur: 'X', annee: '2026', descriptif: 'D' }, '');

  const p = await panneau();
  const m = charge(p);
  assert.ok(m.traductions.some((t) => t.titre === 'À traduire'), 'la traduction à faire est absente de charger()');
  assert.ok(m.reservoir.some((r) => r.titre === 'Au réservoir'), 'l’entrée du réservoir est absente de charger()');
  assert.ok(!m.reservoir.some((r) => r.titre === 'À traduire'), 'une fiche à traduire ne doit plus être dans le réservoir');
  assert.ok(m.orphelines.some((o) => o.titre === 'Mon orpheline'), 'l’orpheline est absente de charger()');
  // reservoirNumeros liste les numéros de l'AUTRE revue en scannant l'arbre réel
  // (kirby.listerNumeros) : ce fixture n'a pas de dossier Zeitschrift\ à côté de REVUE, donc
  // la liste est vide ici — son contenu sur un arbre complet est éprouvé par
  // test/js/kirby-contenu.test.js (« listerNumeros »).
  assert.ok(Array.isArray(m.reservoirNumeros));
  void uuidReservoir;
});

// ---- Bouton « Aperçu du PDF » (23.09.2026) ---------------------------------------------
//
// Même mécanisme que l'aperçu d'un article (extension.js#compilerPuisAfficher, lancerBuild,
// la tâche « Aperçu / Export PDF ») — mais la Documentation n'a pas de .md source à comparer
// à un aperçu existant : un clic recompile TOUJOURS avant d'afficher (jamais une supposition
// d'obsolescence). L'état du bouton n'est jamais tenu par la page : il vient de l'hôte, qui
// le lit sur l'état RÉEL (session.panneauApercuHtml()/apercuCourantSlug()) à chaque geste.
const NOM_BUILD_APERCU = 'Aperçu / Export PDF';
const tickApercu = () => new Promise((r) => setImmediate(r));

test('Aperçu du PDF : un clic recompile puis ouvre le panneau HTML, l’état revient « ouvert »', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD_APERCU }]);
  try {
    const p = await panneau();
    p.messages.length = 0;
    const promesse = p._recepteur({ type: 'apercuBasculer' });
    await tickApercu();
    await HOTE.finirTache(NOM_BUILD_APERCU, 0);
    await promesse;

    assert.ok(HOTE.panneauDeType('szhApercuHtml'), 'le panneau d’aperçu HTML aurait dû s’ouvrir');
    const etat = p.messages.filter((m) => m.type === 'apercuEtat').pop();
    assert.ok(etat, 'aucun « apercuEtat » renvoyé après la bascule');
    assert.strictEqual(etat.ouvert, true);
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('Aperçu du PDF : un second clic ferme l’aperçu, sans recompiler (aucune tâche demandée)', async () => {
  const p = dernierPanneauDoc();
  p.messages.length = 0;
  const avantTaches = HOTE.commandesJouees().length;
  await p._recepteur({ type: 'apercuBasculer' });   // fermeture : synchrone, aucune tâche
  const etat = p.messages.filter((m) => m.type === 'apercuEtat').pop();
  assert.ok(etat);
  assert.strictEqual(etat.ouvert, false);
  void avantTaches;
});

test('Aperçu du PDF : « charger() » (au premier « pret ») reflète l’état réel, ouvert ou fermé', async () => {
  // Fermé à ce point (test précédent) : un nouveau « pret » doit le redire.
  const p = dernierPanneauDoc();
  await p._recepteur({ type: 'pret' });
  assert.strictEqual(charge(p).apercuOuvert, false);

  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD_APERCU }]);
  try {
    const promesse = p._recepteur({ type: 'apercuBasculer' });
    await tickApercu();
    await HOTE.finirTache(NOM_BUILD_APERCU, 0);
    await promesse;
    await p._recepteur({ type: 'pret' });
    assert.strictEqual(charge(p).apercuOuvert, true, 'apercuOuvert doit suivre l’aperçu réellement ouvert');
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('Aperçu du PDF : « Enregistrer » relance une compilation quand l’aperçu est ouvert, jamais sinon', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD_APERCU }]);
  const origExecute = HOTE.stub.tasks.executeTask;
  let appels = 0;
  HOTE.stub.tasks.executeTask = (t) => { appels++; return origExecute(t); };
  try {
    const p = dernierPanneauDoc();
    // L'aperçu est déjà ouvert (test précédent) : enregistrer quelque chose doit relancer
    // une compilation, sans qu'on l'attende (fire-and-forget côté hôte).
    p.messages.length = 0;
    await p._recepteur({
      type: 'enregistrer', auto: false,
      ressources: [{ id: 'r-apercu', type: 'film', valeurs: { title: 'Pour l’aperçu' } }], rubriques: []
    });
    await tickApercu();
    assert.strictEqual(appels, 1, 'enregistrer avec l’aperçu ouvert doit relancer UNE compilation');
    await HOTE.finirTache(NOM_BUILD_APERCU, 0);
    await tickApercu();

    // Fermer l'aperçu, puis enregistrer à nouveau : plus aucune compilation ne doit partir.
    await p._recepteur({ type: 'apercuBasculer' });
    appels = 0;
    await p._recepteur({
      type: 'enregistrer', auto: false,
      ressources: [{ id: 'r-apercu-2', type: 'film', valeurs: { title: 'Sans aperçu' } }], rubriques: []
    });
    await tickApercu();
    assert.strictEqual(appels, 0, 'enregistrer sans aperçu ouvert ne doit relancer aucune compilation');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('Aperçu du PDF : fermé « à la croix », le panneau redevenu actif redit l’état à jour', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD_APERCU }]);
  try {
    const p = dernierPanneauDoc();
    p.messages.length = 0;
    const promesse = p._recepteur({ type: 'apercuBasculer' });   // rouvre
    await tickApercu();
    await HOTE.finirTache(NOM_BUILD_APERCU, 0);
    await promesse;
    assert.strictEqual(p.messages.filter((m) => m.type === 'apercuEtat').pop().ouvert, true);

    // L'utilisateur ferme l'aperçu lui-même (la croix de SON panneau) : rien ne le dit à
    // la Documentation tant que son propre panneau ne redevient pas actif.
    const panneauApercu = HOTE.panneauDeType('szhApercuHtml');
    assert.ok(panneauApercu, 'témoin manquant : le panneau d’aperçu aurait dû être ouvert');
    panneauApercu.dispose();

    p.messages.length = 0;
    p.onDidChangeViewState.emettre({ webviewPanel: { active: true } });
    const etat = p.messages.filter((m) => m.type === 'apercuEtat').pop();
    assert.ok(etat, 'le panneau Documentation redevenu actif doit recevoir l’état à jour');
    assert.strictEqual(etat.ouvert, false, 'l’aperçu fermé à la croix doit se refléter sans qu’on ait cliqué le bouton');
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});
