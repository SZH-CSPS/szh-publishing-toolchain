// Le panneau « Ressources d'un article » (szh.ressourcesArticle), réellement activé —
// même esprit que hote.test.js, mais un fichier à part pour ne pas alourdir le sien : le
// panneau des médias y a déjà de nombreux contrôles, ceux-ci portent spécifiquement sur le
// moteur générique de lib/ressources.js et son câblage dans extension.js.
//
//   node --test test/js/ressources-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const { T } = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));

async function ouvrir() {
  await HOTE.executer('szh.ressourcesArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhRessources');
  assert.ok(p, 'panneau des ressources absent');
  await p._recepteur({ type: 'pret' });
  return p;
}

test('ouverture : la charge porte livre et film, avec les champs complets voulus', async () => {
  const p = await ouvrir();
  const charge = p.messages.filter((m) => m.type === 'charger').pop();
  assert.ok(charge, 'aucune charge « charger »');
  assert.deepStrictEqual(charge.ressources, [], 'l’article ne porte encore aucune fiche');
  const types = {};
  for (const t of charge.typesConfig) { types[t.valeur] = t; }
  assert.deepStrictEqual(Object.keys(types).sort(), ['film', 'livre']);
  assert.deepStrictEqual(types.livre.champs.map((c) => c.cle), ['auteurs', 'annee', 'editeur']);
  assert.deepStrictEqual(types.film.champs.map((c) => c.cle),
    ['realisateur', 'annee', 'genre', 'pays']);
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
  const avant = HOTE.statutsDits('enregistrée').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-livre-1', type: 'livre', valeurs: {
      titre: 'Le silence des bêtes', auteurs: 'Jean Dupont', annee: '2019',
      editeur: 'Éditions XYZ', lien: 'https://exemple.org/livre',
      descriptif: 'Un texte qui présente l’ouvrage.', image: 'x.png'
    } }]
  });
  assert.ok(p.messages.some((m) => m.type === 'enregistre'), 'aucune confirmation reçue');
  assert.strictEqual(HOTE.statutsDits('enregistrée').length, avant + 1,
    'aucune annonce dans la barre d’état pour une fiche complète');
});

test('enregistrer : une fiche incomplète (sans image) n’est pas comptée, et rien ne l’annonce', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('enregistrée').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-incomplete', type: 'livre',
      valeurs: { titre: 'Sans image', descriptif: 'D', image: '' } }]
  });
  // La confirmation part quand même (rien n'a échoué), mais sans annonce de compte : voir
  // ressources.test.js pour la preuve que champsManquants()/ressourceComplete() la rejettent.
  assert.ok(p.messages.some((m) => m.type === 'enregistre'));
  assert.strictEqual(HOTE.statutsDits('enregistrée').length, avant,
    'une fiche incomplète a été comptée comme enregistrée');
});

test('enregistrer : un type inconnu du moteur n’est pas compté', async () => {
  const p = await ouvrir();
  p.messages.length = 0;
  const avant = HOTE.statutsDits('enregistrée').length;
  await p._recepteur({
    type: 'enregistrer', auto: false,
    ressources: [{ id: 'r-x', type: 'bande-dessinee',
      valeurs: { titre: 'T', descriptif: 'D', image: 'x.png' } }]
  });
  assert.strictEqual(HOTE.statutsDits('enregistrée').length, avant,
    'un type inconnu du moteur a été compté comme enregistré');
});

// « retirer » n'a pas d'accusé de réception dédié (la carte quitte déjà l'écran côté
// webview, avant même le message) : ce test vérifie seulement qu'un identifiant connu ou
// disparu ne fait pas planter l'hôte — l'effet réel (le bloc ôté, les autres intacts) est
// prouvé par lib/ressources.js (retirerRessource) dans ressources.test.js.
test('retirer : un identifiant connu ou disparu ne fait pas planter l’hôte', async () => {
  const p = await ouvrir();
  await assert.doesNotReject(p._recepteur({ type: 'retirer', id: 'r-livre-1' }));
  await assert.doesNotReject(p._recepteur({ type: 'retirer', id: 'jamais-vu' }));
  await assert.doesNotReject(p._recepteur({ type: 'retirer', id: '' }));
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
// ouvrirGestionRessources ne fait que si son entrée a bien été retirée de panneauxRessources
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
