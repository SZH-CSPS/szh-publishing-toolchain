// Le panneau de Documentation vu depuis un ARTICLE ORDINAIRE (szh.ressourcesArticle),
// réellement activé — même esprit que hote.test.js, mais un fichier à part pour ne pas
// alourdir le sien. Depuis que la Documentation est une arborescence Kirby
// (lib/kirby-contenu.js), ces fiches vivent dans des dossiers <n>_<slug>/ sous
// articles/01-essai/, à côté du .md de l'article — et les mutations passent par fs direct
// (kirby-contenu.js), donc RÉELLES même dans ce harnais (WorkspaceEdit, lui, reste un faux
// sans effet, mais rien ici n'y passe plus).
//
// Le versant RUBRIQUES du même panneau, et la page de Documentation du numéro, sont dans
// test/js/actualite.test.js : sur un article ordinaire, il n'y a pas de rubriques.
//
//   node --test test/js/ressources-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');
const COCKPIT_LIB = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib');
const kirby = require(path.join(COCKPIT_LIB, 'kirby-contenu.js'));
const reserve = require(path.join(COCKPIT_LIB, 'reserve.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const { T } = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));

const DOSSIER_ARTICLE = path.join(REVUE, 'articles', '01-essai');

async function ouvrir() {
  await HOTE.executer('szh.ressourcesArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhDocumentation');
  assert.ok(p, 'panneau de Documentation absent');
  await p._recepteur({ type: 'pret' });
  return p;
}

test('ouverture : la charge porte les sept types du contrat, avec les champs complets voulus', async () => {
  const p = await ouvrir();
  const charge = p.messages.filter((m) => m.type === 'charger').pop();
  assert.ok(charge, 'aucune charge « charger »');
  assert.deepStrictEqual(charge.ressources, [], 'l’article ne porte encore aucune fiche');
  assert.deepStrictEqual(charge.typesRubrique, []);
  assert.deepStrictEqual(charge.rubriques, []);
  const types = {};
  for (const t of charge.typesConfig) { types[t.valeur] = t; }
  assert.deepStrictEqual(Object.keys(types).sort(), kirby.typesConnus().slice().sort());
  assert.deepStrictEqual(types.livre.champs.map((c) => c.cle),
    kirby.champsDuType('livre').map((c) => c.cle));
  assert.deepStrictEqual(types.film.champs.map((c) => c.cle),
    kirby.champsDuType('film').map((c) => c.cle));
  // Livre et film portent une image ; intervention, recherche et reprise n'en portent
  // jamais — c'est ce booléen, et lui seul, que la webview lit pour ne pas afficher de zone
  // de dépôt.
  assert.strictEqual(types.livre.avecImage, true);
  assert.strictEqual(types.film.avecImage, true);
  assert.strictEqual(types.intervention.avecImage, false);
  assert.strictEqual(types.recherche.avecImage, false);
  assert.strictEqual(types.reprise.avecImage, false);
  assert.strictEqual(types.agenda.avecImage, false);
  // Chaque champ a un libellé traduit — jamais une clé i18n crue affichée au rédacteur.
  for (const t of charge.typesConfig) {
    assert.ok(t.libelleSection, 'section sans libellé : ' + t.valeur);
    assert.ok(t.libelleAjouter, 'bouton d’ajout sans libellé : ' + t.valeur);
    for (const c of t.champs) { assert.ok(c.libelle, 'champ sans libellé : ' + t.valeur + '.' + c.cle); }
  }
});

test('enregistrer : une fiche complète est acceptée, écrite sur le disque, et annoncée dans la barre d’état', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-livre-1', type: 'livre', valeurs: {
      categorie: 'manuel', title: 'Le silence des bêtes', auteurs: 'Jean Dupont', annee: '2019',
      editeur: 'Éditions XYZ', lien: 'https://exemple.org/livre',
      descriptif: 'Un texte qui présente l’ouvrage.'
    } }]
  });
  const enr = p.messages.filter((m) => m.type === 'enregistre').pop();
  assert.ok(enr, 'aucune confirmation reçue');
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1);
  assert.strictEqual(enr.correspondances.length, 1, 'la fiche neuve doit recevoir un Uuid');
  const fiches = kirby.listerFiches(DOSSIER_ARTICLE, 'fr');
  assert.strictEqual(fiches.length, 1);
  assert.strictEqual(fiches[0].valeurs.title, 'Le silence des bêtes');
  assert.strictEqual(fiches[0].uuid, enr.correspondances[0].apres);
});

test('enregistrer : une intervention parlementaire complète, sans image, est acceptée, curia recalculé', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-intervention-1', type: 'intervention', valeurs: {
      title: 'Renforcer la formation spécialisée', canton: 'BE', categorie: 'motion',
      numero: '26.118', date: '2026-03-12', source: 'curia',
      descriptif: 'Le Conseil fédéral est chargé de…'
    } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'aucune confirmation reçue');
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1);
  const fiche = kirby.listerFiches(DOSSIER_ARTICLE, 'fr').find((f) => f.type === 'intervention');
  assert.strictEqual(fiche.valeurs.curia, '5', 'curia doit être recalculé depuis la catégorie, jamais saisi');
});

test('enregistrer : une fiche incomplète est acceptée, et comptée comme les autres', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-incomplete', type: 'livre', valeurs: { title: 'Sans image', descriptif: 'D' } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'));
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1,
    'une fiche incomplète devrait s’enregistrer');
});

test('enregistrer : une carte jamais remplie n’est pas écrite', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-vide', type: 'livre', valeurs: { title: '  ', descriptif: '' } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'));
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant,
    'une carte entièrement vide a été comptée comme enregistrée');
});

test('enregistrer : un type inconnu du contrat n’est pas compté', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-x', type: 'bande-dessinee', valeurs: { title: 'T', descriptif: 'D' } }]
  });
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant,
    'un type inconnu du contrat a été compté comme enregistré');
});

test('retirer : un identifiant connu ou disparu ne fait pas planter l’hôte', async () => {
  const p = await ouvrir();
  const oter = (id, famille) => p._recepteur({ type: 'retirer', famille: famille, id: id });
  await assert.doesNotReject(oter('jamais-vu', 'fiche'));
  await assert.doesNotReject(oter('', 'fiche'));
  await assert.doesNotReject(p._recepteur({ type: 'retirer', id: 'jamais-vu' }));
  await assert.doesNotReject(oter('b-inconnu', 'rubrique'));
});

test('retirer : une fiche existante disparaît du disque', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-a-retirer', type: 'film', valeurs: { title: 'À retirer' } }]
  });
  const enr = p.messages.find((m) => m.type === 'enregistre');
  const uuid = enr.correspondances[0].apres;
  await p._recepteur({ type: 'retirer', famille: 'fiche', id: uuid });
  assert.ok(!kirby.listerFiches(DOSSIER_ARTICLE, 'fr').some((f) => f.uuid === uuid));
});

// ---- Réserve : mettre de côté, et envoyer à traduire dans l'autre revue ----
//
// Ces deux gestes écrivent hors du numéro (lib/reserve.js, un dossier `_reserve/` du dossier
// PARENT) — comme le retrait/l'ajout dans l'article, tout passe désormais par fs direct
// (kirby-contenu.js), donc réel dans ce harnais.
test('détacher : la fiche part dans la réserve de la revue ouverte, et sort de l’article', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-detache', type: 'livre', valeurs: {
      categorie: 'manuel', title: 'À mettre de côté', auteurs: 'Jean Dupont', annee: '2019',
      editeur: 'XYZ', descriptif: 'Un descriptif.'
    } }]
  });
  const uuid = p.messages.find((m) => m.type === 'enregistre').correspondances[0].apres;
  const dejaLa = reserve.lister(REVUE, 'revue').length;
  await p._recepteur({ type: 'detacher', id: uuid });
  const enReserve = reserve.lister(REVUE, 'revue');
  assert.strictEqual(enReserve.length, dejaLa + 1, 'rien n’est arrivé dans la réserve de la revue');
  assert.strictEqual(enReserve[0].fiche.aTraduire, false, 'une fiche mise de côté chez soi n’est pas à traduire');
  assert.strictEqual(enReserve[0].fiche.origine, 'revue');
  assert.strictEqual(enReserve[0].fiche.titre, 'À mettre de côté');
  assert.ok(!kirby.listerFiches(DOSSIER_ARTICLE, 'fr').some((f) => f.uuid === uuid),
    'détacher doit retirer la fiche de l’article');
  reserve.retirer(enReserve[0].chemin);
});

test('envoyer : une COPIE part dans la réserve de l’autre revue, marquée à traduire, et la fiche RESTE', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-envoye', type: 'livre', valeurs: {
      categorie: 'manuel', title: 'À traduire', auteurs: 'Jean Dupont', annee: '2019',
      editeur: 'XYZ', descriptif: 'Un descriptif.'
    } }]
  });
  const uuid = p.messages.find((m) => m.type === 'enregistre').correspondances[0].apres;
  const dejaChezElle = reserve.lister(REVUE, 'revue').length;
  const dejaChezLautre = reserve.lister(REVUE, 'zeitschrift').length;
  await p._recepteur({ type: 'envoyer', id: uuid });
  const chezElle = reserve.lister(REVUE, 'revue');
  const chezLautre = reserve.lister(REVUE, 'zeitschrift');
  assert.strictEqual(chezElle.length, dejaChezElle, 'une copie envoyée ne doit pas rester chez soi');
  assert.strictEqual(chezLautre.length, dejaChezLautre + 1, 'la copie n’est pas arrivée dans l’autre réserve');
  assert.strictEqual(chezLautre[0].fiche.aTraduire, true, 'la copie devrait être à traduire');
  assert.strictEqual(chezLautre[0].fiche.origine, 'revue');
  assert.strictEqual(chezLautre[0].fiche.langue, 'de', 'la copie doit porter le fichier de contenu de l’autre langue');
  // Et la fiche RESTE dans l'article : « envoyer » ne retire rien.
  assert.ok(kirby.listerFiches(DOSSIER_ARTICLE, 'fr').some((f) => f.uuid === uuid),
    '« envoyer » a retiré la fiche de l’article alors qu’il devait la laisser');
  reserve.retirer(chezLautre[0].chemin);
});

// L'image est mise de côté (.depot-images/ de l'article) tant que la fiche n'a pas de
// dossier ; elle rejoint son dossier définitif au premier enregistrement (voir le test
// suivant).
test('déposer une image : mise de côté, l’aperçu et le nom reviennent à la carte', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  await p._recepteur({
    type: 'deposer-image', id: 'r-image-1', nomFichier: 'Couverture (1).PNG',
    donneesBase64: Buffer.from('donnees-image').toString('base64')
  });
  const depose = p.messages.filter((m) => m.type === 'image-deposee').pop();
  assert.ok(depose, 'aucune confirmation de dépôt reçue');
  assert.strictEqual(depose.id, 'r-image-1');
  assert.match(depose.image, /^[a-z0-9-]+\.png$/, 'le nom du fichier n’a pas été assaini');
  const source = kirby.imageProvisoire(DOSSIER_ARTICLE, 'r-image-1');
  assert.ok(source, 'l’image n’a pas été mise de côté');
  assert.strictEqual(fs.readFileSync(source, 'utf8'), 'donnees-image');
});

test('enregistrer une fiche neuve avec image déposée : l’image rejoint son dossier', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  await p._recepteur({
    type: 'deposer-image', id: 'r-avec-image', nomFichier: 'couverture.png',
    donneesBase64: Buffer.from('png').toString('base64')
  });
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-avec-image', type: 'livre', valeurs: {
      categorie: 'manuel', title: 'Avec image', auteurs: 'A', annee: '2026', editeur: 'E', descriptif: 'D'
    } }]
  });
  const fiche = kirby.listerFiches(DOSSIER_ARTICLE, 'fr').find((f) => f.valeurs.title === 'Avec image');
  assert.ok(fiche, 'la fiche n’a pas été écrite');
  assert.strictEqual(fiche.valeurs.couverture, 'couverture.png');
  assert.ok(fs.existsSync(path.join(DOSSIER_ARTICLE, fiche.dossier, 'couverture.png')));
});

test('déposer une image trop volumineuse : refusée, rien n’est mis de côté', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  await p._recepteur({
    type: 'deposer-image', id: 'r-trop-gros', nomFichier: 'gros.png',
    donneesBase64: Buffer.alloc(60 * 1024 * 1024).toString('base64')
  });
  const erreur = p.messages.filter((m) => m.type === 'image-erreur').pop();
  assert.ok(erreur, 'aucun refus signalé');
  assert.strictEqual(erreur.id, 'r-trop-gros');
  assert.strictEqual(kirby.imageProvisoire(DOSSIER_ARTICLE, 'r-trop-gros'), null);
});

test('quitter sans enregistrer : la confirmation offre bien d’enregistrer d’abord', async () => {
  const p = await ouvrir();
  HOTE.modales.length = 0;
  HOTE.repondreModale(T('form.enregistrer'));
  await p._recepteur({
    type: 'retourArticle', modifie: true,
    ressources: [{ id: 'r-quitter', type: 'film',
      valeurs: { title: 'Un film', realisateur: 'R', annee: '2020', categorie: 'documentaire', descriptif: 'd' } }]
  });
  assert.strictEqual(HOTE.modales.length, 1, 'aucune confirmation demandée');
  assert.strictEqual(HOTE.modales[0].options.modal, true);
  assert.deepStrictEqual(HOTE.modales[0].boutons, [T('form.enregistrer'), T('table.quitter.sansEnregistrer')]);
});

test('quitter sans modification : ferme le panneau, qui peut être rouvert', async () => {
  const p = await ouvrir();
  const avant = HOTE.panneaux.length;
  await p._recepteur({ type: 'retourArticle', modifie: false, ressources: [] });
  await HOTE.executer('szh.ressourcesArticle', { slug: '01-essai' });
  assert.strictEqual(HOTE.panneaux.length, avant + 1,
    'réouvrir après un retour sans modification n’a pas créé un panneau neuf : ' +
    'panneauxRessources n’a pas été libéré à la fermeture');
});
