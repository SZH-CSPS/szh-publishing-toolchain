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
    'section-articles': 'szh.vueArticles',
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
});

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Les trois sections dans l'ordre du travail, et saillantes : le TreeView natif n'offre ni
// gras ni taille de police, ce sont les majuscules et la couleur de l'icône qui font
// l'en-tête. « Traductions » monte en deuxième position mais arrive toujours repliée.
test('l’arbre : sections dans l’ordre Articles / Traductions / Word, en majuscules et en couleur', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  assert.deepStrictEqual(racine.map((it) => it.contextValue),
    ['section-articles', 'section-traductions', 'section-word'],
    'l’ordre des sections n’est pas celui du travail');
  assert.strictEqual(racine[0].collapsibleState, 2, '« Articles » devrait arriver ouverte');
  assert.strictEqual(racine[1].collapsibleState, 1, '« Traductions » devrait arriver repliée');
  assert.strictEqual(racine[2].collapsibleState, 2, '« Word » devrait arriver ouverte');
  // Majuscules dans les deux langues — dans le dictionnaire, pas seulement au rendu.
  const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  for (const cle of ['arbre.articles', 'arbre.traductions', 'arbre.word']) {
    for (const langue of ['fr', 'de']) {
      const texte = String(i18n.TEXTES_COCKPIT[langue][cle]);
      assert.strictEqual(texte, texte.toLocaleUpperCase(langue),
        'en-tête de section sans majuscules (' + langue + ') : ' + texte);
    }
  }
  assert.strictEqual(racine[0].label, i18n.TEXTES_COCKPIT.fr['arbre.articles'],
    'le libellé rendu n’est pas celui du dictionnaire');
  // Une couleur par section, et pas deux fois la même.
  const couleurs = racine.map((it) => it.iconPath && it.iconPath.color && it.iconPath.color.id);
  racine.forEach((it, i) => assert.ok(couleurs[i], 'icône sans couleur : ' + it.label));
  assert.strictEqual(new Set(couleurs).size, racine.length,
    'deux sections partagent la même couleur : ' + couleurs.join(', '));
  // Les compteurs restent en description : le Word en attente se compte sans déplier.
  assert.match(String(racine[2].description), /^\(\d+\)$/,
    'le compteur des Word en attente a disparu de la description');
});

// Chaque article se distingue de ses voisins : une icône colorée dit son avancement —
// cercle vide (rien), disque bleu (en cours), coche verte (tout est fait) — et la
// description « slug · n/m tâches » reste. Aucun faux item séparateur.
test('l’arbre : chaque article porte l’icône colorée de son avancement', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const section = racine.find((it) => it.contextValue === 'section-articles');
  const articles = (await arbre.getChildren(section))
    .filter((it) => it.contextValue === 'article');
  assert.ok(articles.length >= 2, 'les articles d’essai manquent');
  // Rien de coché : cercle vide, sans couleur — et plus l'icône de fichier du thème.
  for (const it of articles) {
    assert.ok(it.iconPath && it.iconPath.id, 'article sans icône : ' + it.label);
    assert.strictEqual(it.iconPath.id, 'circle-large-outline',
      'icône inattendue sur un article non commencé : ' + it.iconPath.id);
    assert.ok(!it.iconPath.color, 'une couleur sur un article non commencé');
  }
  // La liste des tâches vient des mêmes modules que l'hôte : le test coche ce que la
  // configuration du poste — ou le jeu de départ — définit vraiment.
  const art = require(path.join(COCKPIT, 'lib', 'articles.js'));
  const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
  const taches = art.tachesRevue(archivage.lireConfigPoste(), 'revue');
  assert.ok(taches.length > 0, 'aucune tâche définie, même par défaut');
  const fichier = path.join(REVUE, 'articles', '01-essai', '01-essai.taches.yaml');

  // Une partie cochée : le disque bleu de l'« en cours ».
  if (taches.length > 1) {
    fs.writeFileSync(fichier, art.serialiserTachesFaites({ faites: [taches[0].id] }));
    const it = (await arbre.getChildren(section)).find((x) => x.slug === '01-essai');
    assert.strictEqual(it.iconPath.id, 'circle-filled');
    assert.strictEqual(it.iconPath.color && it.iconPath.color.id, 'charts.blue');
  }

  // Tout coché : la coche verte, et le compteur toujours dans la description.
  fs.writeFileSync(fichier,
    art.serialiserTachesFaites({ faites: taches.map((t) => t.id) }));
  const fait = (await arbre.getChildren(section)).find((x) => x.slug === '01-essai');
  assert.strictEqual(fait.iconPath.id, 'pass-filled');
  assert.strictEqual(fait.iconPath.color && fait.iconPath.color.id, 'charts.green');
  assert.match(String(fait.description), /^01-essai · /,
    'la description « slug · n/m tâches » a disparu');
  fs.unlinkSync(fichier);
});

// Ouvrir un panneau touche à tout : lecture du disque, assemblage du HTML, première charge
// utile. Une seule référence manquante et l'utilisateur voit un panneau vide, ou rien.
test('chaque panneau s’ouvre, s’assemble et envoie sa première charge', async () => {
  const panneaux = [
    ['szh.apercuMetadonnees', undefined, 'valeurs'],
    ['szh.metadonnees', undefined, 'valeurs'],
    ['szh.reglages', undefined, 'valeurs'],
    ['szh.vueTraductions', undefined, 'valeurs'],
    ['szh.vueArticles', undefined, 'valeurs'],
    ['szh.vueWord', undefined, 'valeurs'],
    ['szh.mediasArticle', { slug: '01-essai' }, 'charger'],
    ['szh.traduction', { slug: '01-essai' }, 'valeurs'],
    ['szh.editerTable', {
      slug: '01-essai',
      cheminAsset: path.join(REVUE, 'articles', '01-essai', 'tables', 'table-01.html')
    }, 'charger']
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

// Les trois boutons d'état sont côte à côte : ils doivent se comporter pareil. « À
// traduire » se dérobait dès qu'un état était déjà posé — il ne promouvait que ce qui
// n'avait pas commencé — et semblait donc ne rien faire.
test('les trois états de masse écrivent, même à rebours du flux', async () => {
  const suivi = path.join(REVUE, 'articles', '01-essai', '01-essai.traduction.yaml');
  await HOTE.executer('szh.vueTraductions');
  const p = HOTE.panneauDeType('szhVueTraductions');
  const etats = ['tout-finalise', 'tout-traduction', 'tout-relecture'];
  const attendus = ['finalise', 'pret-traduction', 'pret-relecture'];
  for (let i = 0; i < etats.length; i++) {
    HOTE.repondreModale('Appliquer');            // les trois écrivent partout : confirmés
    await p._recepteur({ type: 'action', id: etats[i] });
    const texte = fs.readFileSync(suivi, 'utf8');
    assert.match(texte, new RegExp(attendus[i]),
      etats[i] + ' n’a pas écrit son état (état précédent : ' + (attendus[i - 1] || 'aucun') + ')');
    assert.doesNotMatch(texte, new RegExp(attendus[i - 1] || 'zzz'),
      etats[i] + ' a laissé l’état précédent en place');
  }
  // Annuler la modale ne doit rien écrire.
  HOTE.repondreModale(undefined);
  await p._recepteur({ type: 'action', id: 'tout-finalise' });
  assert.match(fs.readFileSync(suivi, 'utf8'), /pret-relecture/,
    'un refus de confirmation a tout de même écrit');
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

// La liste des auteur·e·s publiés (cache OAI, lib/auteurs-ojs.js) part avec la charge de
// chaque vue qui porte la modale d'auteur·e. Le harnais a posé un cache FRAIS avant
// l'activation (hote-factice.js) : c'est aussi ce qui garantit qu'aucun test ne déclenche
// le moissonnage réseau du rafraîchissement d'activation.
test('la liste des auteur·e·s publiés part vers le panneau des médias', async () => {
  await HOTE.executer('szh.mediasArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhMedias');
  assert.ok(p, 'panneau des médias absent');
  await p._recepteur({ type: 'pret' });
  const msg = p.messages.filter((m) => m.type === 'auteurs-connus').pop();
  assert.ok(msg, 'aucun message auteurs-connus après la charge');
  assert.deepStrictEqual(msg.auteurs.map((a) => a.nom).sort(), ['Dupont', 'Morand']);
  // Seuls prénom et nom voyagent : OAI-PMH n'offre rien d'autre, et la webview ne doit
  // pas croire le contraire (ni recevoir les dates, qui ne servent qu'à la fusion).
  for (const a of msg.auteurs) {
    assert.deepStrictEqual(Object.keys(a).sort(), ['nom', 'prenom']);
  }
});
