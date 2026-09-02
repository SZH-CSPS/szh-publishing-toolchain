// Le panneau de Documentation vu depuis un ARTICLE ORDINAIRE (szh.ressourcesArticle),
// réellement activé — même esprit que hote.test.js, mais un fichier à part pour ne pas
// alourdir le sien : le panneau des médias y a déjà de nombreux contrôles, ceux-ci portent
// spécifiquement sur le moteur générique de lib/ressources.js et son câblage dans
// extension.js.
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
const ressources = require(path.join(COCKPIT_LIB, 'ressources.js'));
const reserve = require(path.join(COCKPIT_LIB, 'reserve.js'));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const { T } = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));

async function ouvrir() {
  await HOTE.executer('szh.ressourcesArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhDocumentation');
  assert.ok(p, 'panneau de Documentation absent');
  await p._recepteur({ type: 'pret' });
  return p;
}

test('ouverture : la charge porte les six types, avec les champs complets voulus', async () => {
  const p = await ouvrir();
  const charge = p.messages.filter((m) => m.type === 'charger').pop();
  assert.ok(charge, 'aucune charge « charger »');
  assert.deepStrictEqual(charge.ressources, [], 'l’article ne porte encore aucune fiche');
  // Un article ordinaire n'a pas de rubriques : c'est la seule différence entre les deux
  // usages du panneau (voir l'en-tête du fichier).
  assert.deepStrictEqual(charge.typesRubrique, []);
  assert.deepStrictEqual(charge.rubriques, []);
  const types = {};
  for (const t of charge.typesConfig) { types[t.valeur] = t; }
  assert.deepStrictEqual(Object.keys(types).sort(),
    ['agenda', 'film', 'intervention', 'livre', 'recherche', 'reprise']);
  assert.deepStrictEqual(types.livre.champs.map((c) => c.cle), ['auteurs', 'annee', 'editeur']);
  assert.deepStrictEqual(types.film.champs.map((c) => c.cle),
    ['realisateur', 'annee', 'genre', 'pays']);
  assert.deepStrictEqual(types.intervention.champs.map((c) => c.cle),
    ['canton', 'categorie', 'numero', 'date']);
  assert.deepStrictEqual(types.recherche.champs.map((c) => c.cle), ['institutions', 'debut', 'fin']);
  assert.deepStrictEqual(types.reprise.champs.map((c) => c.cle),
    ['auteurs', 'revue', 'reference', 'doi']);
  // Livre et film portent une image ; intervention, recherche et reprise n'en portent
  // jamais — c'est ce booléen, et lui seul, que la webview lit pour ne pas afficher de zone
  // de dépôt.
  assert.strictEqual(types.livre.avecImage, true);
  assert.strictEqual(types.film.avecImage, true);
  assert.strictEqual(types.intervention.avecImage, false);
  assert.strictEqual(types.recherche.avecImage, false);
  assert.strictEqual(types.reprise.avecImage, false);
  assert.strictEqual(types.agenda.avecImage, false);
  assert.deepStrictEqual(types.agenda.champs.map((c) => c.cle),
    ['evenement', 'debut', 'fin', 'lieu', 'organisateur']);
  // Chaque champ a un libellé traduit — jamais une clé i18n crue affichée au rédacteur.
  for (const t of charge.typesConfig) {
    assert.ok(t.libelleSection, 'section sans libellé : ' + t.valeur);
    assert.ok(t.libelleAjouter, 'bouton d’ajout sans libellé : ' + t.valeur);
    for (const c of t.champs) { assert.ok(c.libelle, 'champ sans libellé : ' + t.valeur + '.' + c.cle); }
  }
});

// ⚠ Ce que ce harnais ne peut pas vérifier : la MUTATION RÉELLE du .md. WorkspaceEdit est
// un faux sans effet dans hote-factice.js (« que ce harnais ne rejoue pas », voir son
// commentaire au-dessus de `openTextDocument`) — déjà vrai pour le gestionnaire des médias,
// dont le test « le remplacement offre de poser… à côté » vérifie le fichier BINAIRE (écrit
// par fs, hors WorkspaceEdit) mais renvoie explicitement à contrats.test.js pour le texte.
// L'exactitude de ce qui est ÉCRIT est donc prouvée directement dans ressources.test.js
// (ajouterRessource / ecrireRessource / retirerRessource, sans hôte factice) ; ce qui suit
// prouve le CÂBLAGE : quelles fiches l'hôte accepte d'écrire, lesquelles il rejette
// silencieusement, et ce qu'il annonce dans les deux cas — observable ici par le seul
// canal qui traverse vraiment ce faux : la barre d'état (statutsDits) et les messages
// postés à la webview.

test('enregistrer : une fiche complète est acceptée et annoncée dans la barre d’état', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-livre-1', type: 'livre', valeurs: {
      titre: 'Le silence des bêtes', auteurs: 'Jean Dupont', annee: '2019',
      editeur: 'Éditions XYZ', lien: 'https://exemple.org/livre',
      descriptif: 'Un texte qui présente l’ouvrage.', image: 'x.png'
    } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'aucune confirmation reçue');
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1,
    'aucune annonce dans la barre d’état pour une fiche complète');
});

test('enregistrer : une intervention parlementaire complète, sans image, est acceptée', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-intervention-1', type: 'intervention', valeurs: {
      titre: 'Renforcer la formation spécialisée', canton: 'Berne', categorie: 'Motion',
      numero: '26.118', date: '12.03.2026',
      descriptif: 'Le Conseil fédéral est chargé de…', image: ''
    } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'aucune confirmation reçue');
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1,
    'une intervention sans image, par ailleurs complète, n’a pas été comptée comme enregistrée');
});

// Renversement du 02.09.2026 : une fiche incomplète s'ENREGISTRE. Elle était refusée, et le
// rédacteur perdait sa saisie en quittant le formulaire ; c'est désormais une pastille
// « non complet » dans l'en-tête de sa carte qui dit ce qui manque (media/documentation.js).
test('enregistrer : une fiche incomplète est acceptée, et comptée comme les autres', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-incomplete', type: 'livre',
      valeurs: { titre: 'Sans image', descriptif: 'D', image: '' } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'));
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant + 1,
    'une fiche incomplète devrait maintenant s’enregistrer');
});

// La seule fiche encore refusée : celle qu'un clic sur « Ajouter » vient de créer et que
// personne n'a remplie. L'écrire ne donnerait qu'un bloc sans une seule valeur.
test('enregistrer : une carte jamais remplie n’est pas écrite', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-vide', type: 'livre', valeurs: { titre: '  ', descriptif: '', image: '' } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'));
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant,
    'une carte entièrement vide a été comptée comme enregistrée');
});

test('enregistrer : un type inconnu du moteur n’est pas compté', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('bloc').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-x', type: 'bande-dessinee',
      valeurs: { titre: 'T', descriptif: 'D', image: 'x.png' } }]
  });
  assert.strictEqual(HOTE.statutsDits('bloc').length, avant,
    'un type inconnu du moteur a été compté comme enregistré');
});

// « retirer » n'a pas d'accusé de réception dédié (la carte quitte déjà l'écran côté
// webview, avant même le message) : ce test vérifie seulement qu'un identifiant connu ou
// disparu ne fait pas planter l'hôte — l'effet réel (le bloc ôté, les autres intacts) est
// prouvé par lib/ressources.js (retirerRessource) dans ressources.test.js.
test('retirer : un identifiant connu ou disparu ne fait pas planter l’hôte', async () => {
  const p = await ouvrir();
  const oter = (id, famille) => p._recepteur({ type: 'retirer', famille: famille, id: id });
  await assert.doesNotReject(oter('r-livre-1', 'fiche'));
  await assert.doesNotReject(oter('jamais-vu', 'fiche'));
  await assert.doesNotReject(oter('', 'fiche'));
  // La famille manquante retombe sur les fiches : un message d'une version antérieure du
  // formulaire ne doit pas faire lever l'hôte.
  await assert.doesNotReject(p._recepteur({ type: 'retirer', id: 'r-livre-1' }));
  await assert.doesNotReject(oter('b-inconnu', 'rubrique'));
});

// ---- Réserve : mettre de côté, et envoyer à traduire dans l'autre revue ----
//
// Ces deux gestes écrivent hors du numéro (lib/reserve.js, un dossier `_reserve/` du dossier
// PARENT), donc par `fs` — le seul canal que l'hôte factice laisse vraiment passer. Le
// retrait du bloc dans le .md, lui, passe par WorkspaceEdit et n'est pas rejoué ici : c'est
// ressources.test.js qui prouve retirerRessource().
test('détacher : la fiche part dans la réserve de la revue ouverte', async () => {
  const p = await ouvrir();
  const md = path.join(REVUE, 'articles', '01-essai', '01-essai.md');
  const avant = fs.readFileSync(md, 'utf8');
  fs.writeFileSync(md, avant + '\n' + ressources.blocRessource('r-detache', 'livre', {
    titre: 'À mettre de côté', auteurs: 'Jean Dupont', annee: '2019', editeur: 'XYZ',
    descriptif: 'Un descriptif.', image: ''
  }) + '\n');
  try {
    await p._recepteur({ type: 'detacher', id: 'r-detache' });
    const enReserve = reserve.lister(REVUE, 'revue');
    assert.strictEqual(enReserve.length, 1, 'rien n’est arrivé dans la réserve de la revue');
    assert.strictEqual(enReserve[0].fiche.aTraduire, false,
      'une fiche mise de côté chez soi n’est pas à traduire');
    assert.strictEqual(enReserve[0].fiche.origine, 'revue');
    const relue = ressources.lireRessources(enReserve[0].fiche.bloc);
    assert.strictEqual(relue.length, 1, 'le bloc déposé n’est pas relisible comme une fiche');
    assert.strictEqual(relue[0].valeurs.titre, 'À mettre de côté');
    reserve.retirer(enReserve[0].chemin);
  } finally { fs.writeFileSync(md, avant); }
});

test('envoyer : une COPIE part dans la réserve de l’autre revue, marquée à traduire', async () => {
  const p = await ouvrir();
  const md = path.join(REVUE, 'articles', '01-essai', '01-essai.md');
  const avant = fs.readFileSync(md, 'utf8');
  fs.writeFileSync(md, avant + '\n' + ressources.blocRessource('r-envoye', 'livre', {
    titre: 'À traduire', auteurs: 'Jean Dupont', annee: '2019', editeur: 'XYZ',
    descriptif: 'Un descriptif.', image: ''
  }) + '\n');
  try {
    await p._recepteur({ type: 'envoyer', id: 'r-envoye' });
    // La fixture est une Revue : la copie va donc chez la Zeitschrift, et nulle part ailleurs.
    const chezElle = reserve.lister(REVUE, 'revue');
    const chezLautre = reserve.lister(REVUE, 'zeitschrift');
    assert.strictEqual(chezElle.length, 0, 'une copie envoyée ne doit pas rester chez soi');
    assert.strictEqual(chezLautre.length, 1, 'la copie n’est pas arrivée dans l’autre réserve');
    assert.strictEqual(chezLautre[0].fiche.aTraduire, true, 'la copie devrait être à traduire');
    assert.strictEqual(chezLautre[0].fiche.origine, 'revue');
    // Et le bloc RESTE dans l'article : « envoyer » ne retire rien.
    assert.ok(fs.readFileSync(md, 'utf8').indexOf('r-envoye') !== -1,
      '« envoyer » a retiré le bloc de l’article alors qu’il devait le laisser');
    reserve.retirer(chezLautre[0].chemin);
  } finally { fs.writeFileSync(md, avant); }
});

test('déposer une image : le fichier arrive dans media/, l’aperçu et le nom reviennent à la carte', async () => {
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
  const chemin = path.join(REVUE, 'articles', '01-essai', 'media', depose.image);
  assert.ok(fs.existsSync(chemin), 'le fichier n’a pas été écrit dans media/');
  assert.strictEqual(fs.readFileSync(chemin, 'utf8'), 'donnees-image');
});

test('déposer une image trop volumineuse : refusée, rien n’est écrit', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = fs.readdirSync(path.join(REVUE, 'articles', '01-essai', 'media')).sort();
  await p._recepteur({
    type: 'deposer-image', id: 'r-trop-gros', nomFichier: 'gros.png',
    donneesBase64: Buffer.alloc(60 * 1024 * 1024).toString('base64')
  });
  const erreur = p.messages.filter((m) => m.type === 'image-erreur').pop();
  assert.ok(erreur, 'aucun refus signalé');
  assert.strictEqual(erreur.id, 'r-trop-gros');
  assert.deepStrictEqual(
    fs.readdirSync(path.join(REVUE, 'articles', '01-essai', 'media')).sort(), avant);
});

// Le bon libellé de bouton, et le bon choix de boutons : « Enregistrer » et « Ne pas
// enregistrer » (table.quitter.sansEnregistrer), comme le gestionnaire des médias — même
// garde, même vocabulaire.
test('quitter sans enregistrer : la confirmation offre bien d’enregistrer d’abord', async () => {
  const p = await ouvrir();
  HOTE.modales.length = 0;
  HOTE.repondreModale(T('form.enregistrer'));
  await p._recepteur({
    type: 'retourArticle', modifie: true,
    ressources: [{ id: 'r-quitter', type: 'film',
      valeurs: { titre: 'Un film', realisateur: 'R', annee: '2020', genre: 'G', pays: 'CH',
        descriptif: 'd', image: 'i.png' } }]
  });
  assert.strictEqual(HOTE.modales.length, 1, 'aucune confirmation demandée');
  assert.strictEqual(HOTE.modales[0].options.modal, true);
  assert.deepStrictEqual(HOTE.modales[0].boutons,
    [T('form.enregistrer'), T('table.quitter.sansEnregistrer')]);
});

// Sans modification, quitter ne demande rien : le panneau se ferme et libère son slug.
// Observable sans dépendre de WorkspaceEdit : rouvrir le MÊME article crée un panneau NEUF
// (donc un nouvel appel à createWebviewPanel) plutôt que de révéler l'ancien, ce que
// ouvrirDocumentation ne fait que si son entrée a bien été retirée de panneauxDocumentation
// au moment du dispose().
test('quitter sans modification : ferme le panneau, qui peut être rouvert', async () => {
  const p = await ouvrir();
  const avant = HOTE.panneaux.length;
  await p._recepteur({ type: 'retourArticle', modifie: false, ressources: [] });
  await HOTE.executer('szh.ressourcesArticle', { slug: '01-essai' });
  assert.strictEqual(HOTE.panneaux.length, avant + 1,
    'réouvrir après un retour sans modification n’a pas créé un panneau neuf : ' +
    'panneauxRessources n’a pas été libéré à la fermeture');
});
