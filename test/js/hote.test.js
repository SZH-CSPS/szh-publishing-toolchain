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

// L'en-tête d'une section doit porter la commande qui la déplie (l'accordéon) et rouvre
// sa vue d'ensemble. Le contrôle lit la ligne construite, et non la source : une commande
// avait déjà été posée après un `return`, ce qui se relit sans rien voir.
test('les en-têtes de section basculent leur section (accordéon)', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre, 'aucun fournisseur d’arbre enregistré');
  const racine = await arbre.getChildren();
  assert.strictEqual(racine.length, 3, 'trois sections attendues');
  for (const it of racine) {
    assert.ok(it.command, 'section sans commande : ' + it.contextValue);
    assert.strictEqual(it.command.command, 'szh.ouvrirSection',
      'commande inattendue sur ' + it.contextValue);
    assert.deepStrictEqual(it.command.arguments, [it.categorie],
      'l’en-tête doit viser sa propre section : ' + it.contextValue);
  }
});

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Les trois sections dans l'ordre du travail, et saillantes : le TreeView natif n'offre ni
// gras ni taille de police, ce sont les majuscules et la couleur de l'icône qui font
// l'en-tête. L'accordéon n'en déplie qu'une : « Articles » au départ.
test('l’arbre : sections dans l’ordre Articles / Traductions / Word, en majuscules et en couleur', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  assert.deepStrictEqual(racine.map((it) => it.contextValue),
    ['section-articles', 'section-traductions', 'section-word'],
    'l’ordre des sections n’est pas celui du travail');
  assert.strictEqual(racine[0].collapsibleState, 2, '« Articles » devrait arriver ouverte');
  assert.strictEqual(racine[1].collapsibleState, 1, '« Traductions » devrait arriver repliée');
  assert.strictEqual(racine[2].collapsibleState, 1, '« Word » devrait arriver repliée (accordéon)');
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

// L'accordéon par la commande du clic : déplier « Traductions » replie « Articles » et
// ouvre la vue d'ensemble des traductions ; recliquer l'en-tête ouvert ne replie PAS —
// la section active reste ouverte, seule la vue se rouvre. L'id des en-têtes change avec
// l'état — c'est lui qui force VS Code à suivre, contre sa mémoire de pli par élément.
test('accordéon : une seule section dépliée, et l’id des en-têtes suit l’état', async () => {
  const arbre = HOTE.arbre();
  await HOTE.executer('szh.ouvrirSection', 'traductions');
  let racine = await arbre.getChildren();
  assert.deepStrictEqual(racine.map((it) => it.collapsibleState), [1, 2, 1],
    'déplier « Traductions » doit replier les autres');
  assert.strictEqual(racine[1].id, 'section:traductions:ouvert');
  assert.strictEqual(racine[0].id, 'section:articles:ferme');
  assert.ok(HOTE.panneauDeType('szhVueTraductions'),
    'le clic sur l’en-tête doit aussi ouvrir la vue d’ensemble');
  // Recliquer l'en-tête ouvert : la section active reste dépliée, la colonne ne saute pas.
  await HOTE.executer('szh.ouvrirSection', 'traductions');
  racine = await arbre.getChildren();
  assert.deepStrictEqual(racine.map((it) => it.collapsibleState), [1, 2, 1],
    'recliquer l’en-tête ouvert ne doit pas replier la section active');
  // Retour à l'état de départ pour la suite du fichier.
  await HOTE.executer('szh.ouvrirSection', 'articles');
  racine = await arbre.getChildren();
  assert.strictEqual(racine[0].collapsibleState, 2);
  fermerVuesEnsemble();   // les panneaux sont des singletons : le test des panneaux veut les créer
});

// Referme les vues d'ensemble ouvertes par un geste d'accordéon : les panneaux sont des
// singletons, et le test « chaque panneau s'ouvre » contrôle justement leur création.
function fermerVuesEnsemble() {
  for (const type of ['szhVueArticles', 'szhVueTraductions', 'szhVueWord']) {
    const p = HOTE.panneauDeType(type);   // le dernier du type, panneaux détruits compris
    if (p && !p._detruit) { p.dispose(); p._detruit = true; }
  }
}

// Le chevron reste un geste valable : l'accordéon tient aussi par lui, et il ouvre la
// même vue d'ensemble que le clic sur le titre.
test('accordéon : déplier par le chevron replie les autres sections', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  HOTE.deplierElement(racine.find((it) => it.contextValue === 'section-word'));
  const apres = await arbre.getChildren();
  assert.deepStrictEqual(apres.map((it) => it.collapsibleState), [1, 1, 2],
    'le chevron n’a pas replié les autres sections');
  assert.ok(HOTE.panneauDeType('szhVueWord'),
    'le dépliage au chevron doit aussi ouvrir la vue d’ensemble');
  // Replier par le chevron : l'état suit, sans reconstruction forcée.
  HOTE.replierElement(apres.find((it) => it.contextValue === 'section-word'));
  const fin = await arbre.getChildren();
  assert.deepStrictEqual(fin.map((it) => it.collapsibleState), [1, 1, 1],
    'replier par le chevron doit libérer l’accordéon');
  await HOTE.executer('szh.ouvrirSection', 'articles');   // état de départ
  fermerVuesEnsemble();
});

// Le premier clic tenait la sélection… jusqu'à la reconstruction qui suivait : l'élément
// recréé (id nouveau) n'était plus sélectionné, et le surlignage s'éteignait. Le clic
// resélectionne désormais l'article — sans voler le focus — et la section « Articles »
// suit (accordéon), d'où que vienne le geste.
test('ouvrir un article resélectionne son élément sans voler le focus', async () => {
  await HOTE.executer('szh.ouvrirSection', 'traductions');   // partir d'ailleurs
  await HOTE.executer('szh.ouvrirArticle', '01-essai');
  const r = HOTE.revelations[HOTE.revelations.length - 1];
  assert.ok(r, 'aucun reveal() après le clic');
  assert.strictEqual(r.element && r.element.slug, '01-essai',
    'le reveal ne vise pas l’article cliqué');
  assert.strictEqual(r.options && r.options.select, true, 'reveal sans sélection');
  assert.strictEqual(r.options && r.options.focus, false,
    'le focus doit rester à l’éditeur');
  const racine = await HOTE.arbre().getChildren();
  assert.strictEqual(racine[0].collapsibleState, 2,
    'la section « Articles » doit suivre le clic');
  // Décision B : le dépliage que VS Code signale au reveal (sectionDeployee déjà posé)
  // ne doit PAS rouvrir la vue d'ensemble Articles par-dessus le texte.
  const vueArt = HOTE.panneauDeType('szhVueArticles');
  const messagesAvant = vueArt ? vueArt.messages.length : 0;
  HOTE.deplierElement(racine.find((it) => it.contextValue === 'section-articles'));
  const vueApres = HOTE.panneauDeType('szhVueArticles');
  assert.strictEqual(vueApres ? vueApres.messages.length : 0, messagesAvant,
    'le dépliage venu du reveal a rouvert la vue Articles (décision B)');
  fermerVuesEnsemble();
});

// Le point de l'article ouvert : posé sur le .md de l'article auquel appartient le
// fichier actif (bibliographie comprise), éteint hors des articles, gardé quand le focus
// va à un aperçu ou à un panneau (plus d'éditeur actif).
test('le marqueur « article ouvert » suit l’éditeur actif', async () => {
  const md = path.join(REVUE, 'articles', '01-essai', '01-essai.md');
  const autre = path.join(REVUE, 'articles', '02-sans-fiche', '02-sans-fiche.md');
  await HOTE.executer('szh.ouvrirArticle', '01-essai');
  const deco = HOTE.decorationDe(md);
  assert.ok(deco && deco.badge, 'pas de point sur l’article ouvert');
  assert.ok(deco.tooltip, 'le point doit s’expliquer (tooltip i18n)');
  assert.ok(!HOTE.decorationDe(autre), 'le point marque un article fermé');
  // La bibliographie du même article ne déplace pas le point…
  HOTE.activerEditeur(path.join(REVUE, 'articles', '01-essai', '01-essai.biblio.md'));
  assert.ok(HOTE.decorationDe(md), 'la bibliographie a déplacé le point hors du .md');
  // … un autre article le prend…
  HOTE.activerEditeur(autre);
  assert.ok(HOTE.decorationDe(autre), 'le point n’a pas suivi le nouvel article');
  assert.ok(!HOTE.decorationDe(md), 'le point est resté sur l’ancien article');
  // … hors des articles il s'éteint…
  HOTE.activerEditeur(path.join(REVUE, 'ausgabe.yaml'));
  assert.ok(!HOTE.decorationDe(autre) && !HOTE.decorationDe(md),
    'le point survit hors des articles');
  // … et sans éditeur actif (aperçu, panneau), il reste où il était.
  HOTE.activerEditeur(autre);
  HOTE.activerEditeur(null);
  assert.ok(HOTE.decorationDe(autre),
    'perdre l’éditeur actif (aperçu, panneau) a éteint le point');
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
  // Les six champs que la modale sait remplir, et EUX SEULS : ni `datePublication` ni
  // `source`, qui ne servent qu'à la fusion côté cache. Une clé de plus qui partirait vers
  // la webview y serait du bruit qu'aucun champ ne reçoit.
  for (const a of msg.auteurs) {
    assert.deepStrictEqual(Object.keys(a).sort(),
      ['affiliation', 'email', 'fonction', 'nom', 'orcid', 'prenom', 'ror']);
  }
});

// Le geste le plus destructeur du formulaire, et sa sortie de secours. Un fichier lâché
// sur « Remplacer » écrase l'image sans retour possible : quand ce n'était pas l'intention,
// le dialogue doit offrir de la poser À CÔTÉ plutôt que par-dessus. Ce contrôle porte sur
// les DEUX moitiés de la promesse — le bouton est bien offert, et le choisir ne touche pas
// à l'octet de l'image existante.
test('médias : le remplacement offre de poser la nouvelle à côté, et n’écrase alors rien', async () => {
  // Les libellés des boutons viennent d'où l'hôte les tire : le crochet de Module._load
  // posé par l'activation est encore en place, donc i18n.js se charge tel quel.
  const { T } = require(path.join(__dirname, '..', '..',
    'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));
  const md = path.join(REVUE, 'articles', '01-essai', '01-essai.md');
  const image = path.join(REVUE, 'articles', '01-essai', 'media', 'a.png');
  const avant = fs.readFileSync(image);

  await HOTE.executer('szh.mediasArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhMedias');
  await p._recepteur({ type: 'pret' });

  // Deux dialogues d'affilée : celui du remplacement, puis celui de la pose à côté.
  HOTE.modales.length = 0;
  HOTE.repondreModale(T('modale.remplacer.bouton.acote'));
  HOTE.repondreModale(T('modale.acote.bouton'));
  await p._recepteur({
    type: 'remplacer', relatif: 'a.png', nomFichier: 'Photo de l’Atelier (2).PNG',
    donneesBase64: Buffer.from('nouvelle image').toString('base64'), medias: []
  });

  // Les deux dialogues, dans l'ordre, chacun offrant l'issue de l'autre — c'est cette
  // symétrie qui rattrape le fichier lâché sur la mauvaise zone, dans les deux sens.
  assert.strictEqual(HOTE.modales.length, 2,
    'deux dialogues attendus, vus : ' + JSON.stringify(HOTE.modales.map((d) => d.boutons)));
  const [remplacement, aCote] = HOTE.modales;
  assert.strictEqual(remplacement.options.modal, true, 'le dialogue n’est pas modal');
  assert.deepStrictEqual(remplacement.boutons,
    [T('modale.remplacer.bouton'), T('modale.remplacer.bouton.acote')],
    'le dialogue de remplacement n’offre pas de poser la nouvelle à côté');
  assert.deepStrictEqual(aCote.boutons,
    [T('modale.acote.bouton'), T('modale.remplacer.bouton')],
    'le dialogue « à côté » n’offre pas de remplacer après tout');

  // Rien n'a été écrasé : c'est toute la raison d'être de ce bouton.
  assert.deepStrictEqual(fs.readFileSync(image), avant, 'l’image existante a été écrasée');
  // Le fichier déposé est entré sous un nom NEUF et assaini — accents, espaces,
  // parenthèses et majuscule d'extension ne traversent ni un lien markdown ni WSL.
  const nouvelles = fs.readdirSync(path.join(REVUE, 'articles', '01-essai', 'media'))
    .filter((n) => n !== 'a.png');
  assert.strictEqual(nouvelles.length, 1, 'le fichier déposé n’est pas arrivé : ' + nouvelles);
  assert.match(nouvelles[0], /^[a-z0-9-]+\.png$/,
    'le nom du fichier déposé n’a pas été assaini : ' + nouvelles[0]);
  assert.strictEqual(fs.readFileSync(path.join(REVUE, 'articles', '01-essai', 'media',
    nouvelles[0]), 'utf8'), 'nouvelle image');
  // Le geste est allé jusqu'au bout : la barre d'état nomme les deux images. L'écriture du
  // .md elle-même passe par un WorkspaceEdit, que ce harnais ne rejoue pas — c'est
  // `poserDansGrille` qui la porte, éprouvée dans contrats.test.js.
  assert.strictEqual(HOTE.statutsDits(nouvelles[0]).length, 1,
    'la barre d’état ne dit pas que l’image a été posée à côté : ' + JSON.stringify(HOTE.statuts));
  assert.ok(fs.existsSync(md), 'le .md de l’article a disparu');
});

// Le geste qui échoue à mi-chemin. Le fichier est écrit AVANT que la référence puisse
// l'être — c'est lui qui fixe le nom qu'elle doit citer — et un refus de la pose laissait
// donc dans media/ une image que rien n'insère : invisible dans le rendu, jamais nommée
// par une erreur, et retrouvée des mois plus tard. Elle doit être reprise.
test('médias : « à côté » refusé ne laisse pas d’image orpheline dans le dossier', async () => {
  const { T } = require(path.join(__dirname, '..', '..',
    'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));
  const dossier = path.join(REVUE, 'articles', '01-essai');
  const md = path.join(dossier, '01-essai.md');
  const avant = fs.readFileSync(md, 'utf8');
  // L'insertion n'est plus seule sur sa ligne : l'envelopper couperait la phrase en deux,
  // et `poserDansGrille` refuse. C'est le refus le plus probable en vrai.
  fs.writeFileSync(md, avant.replace('![Une legende](media/a.png){alt="desc"}',
    'Au fil du texte ![Une legende](media/a.png){alt="desc"} et la suite.'));
  const medias = () => fs.readdirSync(path.join(dossier, 'media')).sort();
  const dejaLa = medias();

  await HOTE.executer('szh.mediasArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhMedias');
  await p._recepteur({ type: 'pret' });
  p.messages.length = 0;
  HOTE.repondreModale(T('modale.acote.bouton'));
  await p._recepteur({
    type: 'ajouter-a-cote', relatif: 'a.png', nomFichier: 'orpheline.png',
    donneesBase64: Buffer.from('rien').toString('base64'), medias: []
  });

  assert.deepStrictEqual(medias(), dejaLa,
    'un fichier est resté dans media/ alors que la pose a été refusée');
  const erreur = p.messages.filter((m) => m.type === 'media-erreur').pop();
  assert.ok(erreur, 'le refus n’est pas signalé à la carte');
  assert.ok(String(erreur.message).indexOf('a.png') !== -1,
    'le refus ne nomme pas l’image en cause : ' + erreur.message);
  fs.writeFileSync(md, avant);
});
