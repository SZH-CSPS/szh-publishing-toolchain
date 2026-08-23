// L'hôte, réellement activé.
//
//   node --test "test/js/*.test.js"
//
// contrats.test.js lit la source, webviews.test.js rend les pages. Restait l'entre-deux :
// l'extension qui s'active, l'arbre qu'elle construit, les panneaux qu'elle ouvre. Deux
// pannes y sont passées sans qu'aucun contrôle les voie — une fonction supprimée avec ses
// voisines, un `it.command` posé après le `return` de sa méthode — et se voyaient toutes
// deux à la première activation.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

// Une seule activation par processus : le crochet de Module._load ne se défait pas.
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

test('l’extension s’active et enregistre ses commandes', () => {
  const ids = HOTE.commandes();
  assert.ok(ids.length > 30, 'trop peu de commandes enregistrées : ' + ids.length);
  for (const attendue of ['szh.vueTraductions', 'szh.vueWord', 'szh.mediasArticle',
    'szh.apercuMetadonnees', 'szh.traduction']) {
    assert.ok(ids.indexOf(attendue) !== -1, 'commande absente : ' + attendue);
  }
});

// L'onglet d'une section doit porter la commande qui ouvre sa vue d'ensemble. Le contrôle
// lit la ligne construite, et non la source : la commande avait été posée après le
// `return`, ce qui se relit sans rien voir.
test('les onglets de section portent la commande de leur vue d’ensemble', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre, 'aucun fournisseur d’arbre enregistré');
  const racine = await arbre.getChildren();
  const parContexte = {};
  for (const it of racine) { parContexte[it.contextValue] = it; }
  const attendu = {
    'section-traductions': 'szh.vueTraductions',
    'section-word': 'szh.vueWord'
  };
  for (const contexte of Object.keys(attendu)) {
    const it = parContexte[contexte];
    assert.ok(it, 'section absente de l’arbre : ' + contexte);
    assert.ok(it.command, 'section sans commande : ' + contexte);
    assert.strictEqual(it.command.command, attendu[contexte],
      'commande inattendue sur ' + contexte);
  }
  // Les articles n'ont pas de vue d'ensemble : leur onglet ne doit rien déclencher.
  assert.ok(!parContexte['section-articles'].command,
    'la section des articles ne devrait pas porter de commande');
});

// Ouvrir un panneau touche à tout : lecture du disque, assemblage du HTML, première charge
// utile. Une seule référence manquante et l'utilisateur voit un panneau vide, ou rien.
test('chaque panneau s’ouvre, s’assemble et envoie sa première charge', async () => {
  const panneaux = [
    ['szh.apercuMetadonnees', undefined, 'valeurs'],
    ['szh.metadonnees', undefined, 'valeurs'],
    ['szh.reglages', undefined, 'valeurs'],
    ['szh.vueTraductions', undefined, 'valeurs'],
    ['szh.vueWord', undefined, 'valeurs'],
    ['szh.mediasArticle', { slug: '01-essai' }, 'charger'],
    ['szh.traduction', { slug: '01-essai' }, 'valeurs']
  ];
  for (const [commande, argument, premier] of panneaux) {
    const avant = HOTE.panneaux.length;
    await HOTE.executer(commande, argument);
    assert.ok(HOTE.panneaux.length > avant, 'aucun panneau ouvert par ' + commande);
    const p = HOTE.dernierPanneau();
    assert.ok(p.html && p.html.length > 5000, 'HTML absent ou tronqué : ' + commande);
    assert.ok(p.html.indexOf('%%SZH:') === -1, 'libellé non résolu dans ' + commande);
    assert.ok(p._recepteur, 'aucun récepteur de message : ' + commande);
    await p._recepteur({ type: 'pret' });
    const types = p.messages.map((m) => m.type);
    assert.ok(types.indexOf(premier) !== -1,
      commande + ' : message « ' + premier + ' » attendu, reçu ' + JSON.stringify(types));
  }
});

// La vue d'ensemble des traductions dit ce que l'arbre disait, et propose les commandes
// globales qui vivaient dans sa marge.
test('la vue d’ensemble des traductions liste les articles et ses commandes', async () => {
  await HOTE.executer('szh.vueTraductions');
  const p = HOTE.panneauDeType('szhVueTraductions');
  assert.ok(p, 'panneau des traductions absent');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.ok(charge, 'aucune charge utile');
  assert.strictEqual(charge.lignes.length, 2, 'un article par ligne attendu');
  const ids = charge.boutons.map((b) => b.id);
  assert.deepStrictEqual(ids, ['tout-traduction', 'tout-relecture', 'tout-finalise', 'envoyer']);
  for (const b of charge.boutons) {
    assert.ok(b.libelle && b.libelle.length > 0, 'bouton sans libellé : ' + b.id);
    assert.ok(b.icone, 'bouton sans pictogramme : ' + b.id);
  }
  // Chaque état porte sa couleur et son pictogramme : une liste se lit d'un coup d'œil,
  // pas en déchiffrant quatre libellés qui se ressemblent.
  for (const l of charge.lignes) {
    for (const past of l.pastilles) {
      assert.ok(past.icone, 'pastille sans pictogramme : ' + past.texte);
      assert.ok(['', 'info', 'attention', 'ok', 'danger', 'accent'].indexOf(past.ton) !== -1,
        'ton de pastille inconnu : ' + past.ton);
    }
  }
});

// Le rapport de la dernière conversion ne vivait que dans le terminal d'une tâche : la vue
// le relit, et chaque ligne prend le ton de ce qu'elle raconte.
test('la vue d’ensemble des Word montre le rapport de conversion', async () => {
  await HOTE.executer('szh.vueWord');
  const p = HOTE.panneauDeType('szhVueWord');
  assert.ok(p, 'panneau des Word absent');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  const tons = charge.lignes.map((l) => (l.pastilles[0] || {}).ton);
  assert.ok(tons.indexOf('ok') !== -1, 'aucune conversion réussie signalée');
  assert.ok(tons.indexOf('attention') !== -1, 'aucun fichier ignoré signalé');
  assert.ok(tons.indexOf('danger') !== -1, 'aucun échec signalé');
  // Le bilan compte les échecs : il ne doit pas se faire prendre pour l'un d'eux.
  const bilan = charge.lignes.filter((l) => /termin/i.test(l.titre))[0];
  assert.ok(bilan, 'ligne de bilan absente');
  assert.strictEqual((bilan.pastilles[0] || {}).ton, '', 'le bilan est classé comme un échec');
  // Le Word en attente, et le bouton qui vide la liste.
  assert.ok(charge.lignes.some((l) => l.titre === '9_Essai.docx'), 'le Word en attente manque');
  assert.deepStrictEqual(charge.boutons.map((b) => b.id), ['convertir', 'vider']);
});

// Deux pièges du rapport : un .docx dont le nom porte des espaces, et un autre dont le nom
// contient « terminé » — son échec se déguisait en ligne de bilan, c'est-à-dire en rien.
test('le rapport de conversion nomme les fichiers à espaces et n’excuse aucun échec', async () => {
  const journal = path.join(REVUE, 'articles-word', '.import.log');
  const LF = String.fromCharCode(10);
  fs.writeFileSync(journal, [
    '[import] converti : Mon article de fond.docx -> articles/04-mon-article/04-mon-article.md',
    '[import] ⚠ échec sur : Dossier terminé 2026.docx (le fichier reste dans articles-word/)',
    '[import] terminé : 1 converti(s), 0 ignoré(s), 1 échec(s).', ''].join(LF));
  await HOTE.executer('szh.vueWord');
  const p = HOTE.panneauDeType('szhVueWord');
  await p._recepteur({ type: 'pret' });
  const charge = p.messages.filter((m) => m.type === 'valeurs').pop();
  const rapport = charge.lignes.filter((l) => /conversion/i.test(l.groupe || ''));
  assert.strictEqual(rapport[0].titre, 'Mon article de fond.docx',
    'nom de fichier tronqué aux espaces');
  assert.strictEqual(rapport[1].titre, 'Dossier terminé 2026.docx');
  assert.strictEqual((rapport[1].pastilles[0] || {}).ton, 'danger',
    'un échec s’est déguisé en bilan à cause du nom du fichier');
  assert.strictEqual((rapport[2].pastilles[0] || {}).ton, '', 'le bilan est mal classé');
});

// La fiche d'auteur·e du gestionnaire des médias écrit un seul rang du meta.yaml, et refuse
// d'écrire si ce rang ne porte plus la photo que l'appelant croyait.
test('la fiche d’auteur·e écrit son rang, et refuse un rang décalé', async () => {
  await HOTE.executer('szh.mediasArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhMedias');
  assert.ok(p, 'panneau des médias absent');
  await p._recepteur({ type: 'pret' });
  const fiche = path.join(REVUE, 'articles', '01-essai', '01-essai.meta.yaml');

  await p._recepteur({
    type: 'auteur-enregistrer', slug: '01-essai', index: 0,
    photoAttendue: 'portraits/anne-dupont.sans-fond.png',
    auteur: { prenom: 'Anne', nom: 'Dupont-Vidal', fonction: 'Logopédiste',
      affiliation: '', orcid: '', email: 'anne@example.ch',
      photo: 'portraits/anne-dupont.sans-fond.png' }
  });
  let texte = fs.readFileSync(fiche, 'utf8');
  assert.match(texte, /Dupont-Vidal/, 'la fiche n’a pas été réécrite');
  assert.match(texte, /portraits\/anne-dupont\.sans-fond\.png/, 'la photo a été perdue');
  assert.ok(p.messages.some((m) => m.type === 'auteur-enregistre'), 'aucune confirmation');

  // Témoin d'identité : la fiche a pu bouger dans un autre panneau depuis l'ouverture.
  await p._recepteur({
    type: 'auteur-enregistrer', slug: '01-essai', index: 0,
    photoAttendue: 'portraits/quelquun-dautre.sans-fond.png',
    auteur: { prenom: 'Pirate', nom: 'Ecraseur' }
  });
  texte = fs.readFileSync(fiche, 'utf8');
  assert.doesNotMatch(texte, /Pirate/, 'un rang décalé a été écrit');
  assert.ok(p.messages.some((m) => m.type === 'auteur-erreur'), 'aucun refus signalé');
});
