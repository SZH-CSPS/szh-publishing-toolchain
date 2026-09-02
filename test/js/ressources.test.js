// lib/ressources.js : les fiches de « ressources » (livres, films, …) d'un article, et la
// garantie que sa table TYPES ne diverge pas de celle recopiée dans
// pipeline/filters/szh-ressource.lua — même discipline que contrats.test.js pour les
// grilles (lib/references.js / szh-grille.lua).
//
//   node --test test/js/ressources.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
// Le saut de ligne, nommé : ces tests construisent du markdown multiligne.
const NL = String.fromCharCode(10);
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const res = require(path.join(COCKPIT, 'lib', 'ressources.js'));

const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// ---- Table des types : lecture ----

test('types : livre et film portent les champs complets voulus par le cahier des charges', () => {
  assert.deepStrictEqual(res.champsBiblio('livre'), ['auteurs', 'annee', 'editeur']);
  assert.deepStrictEqual(res.champsBiblio('film'), ['realisateur', 'annee', 'genre', 'pays']);
  assert.deepStrictEqual(res.typesConnus().sort(),
    ['agenda', 'film', 'intervention', 'livre', 'recherche', 'reprise']);
  assert.deepStrictEqual(res.tousLesChamps('livre'),
    ['titre', 'auteurs', 'annee', 'editeur', 'lien', 'descriptif', 'image']);
});

test('types : intervention parlementaire et recherche en cours portent les champs constatés dans le corpus', () => {
  assert.deepStrictEqual(res.champsBiblio('intervention'), ['canton', 'categorie', 'numero', 'date']);
  assert.deepStrictEqual(res.champsBiblio('recherche'), ['institutions', 'debut', 'fin']);
});

// « D'une revue à l'autre » / « Blick in die Revue » : la reprise d'un article paru dans la
// revue sœur, relevée dans les deux revues sur les numéros 2024-2026. Son jeton est un mot
// simple, sans trait d'union — voir le commentaire de la table TYPES de lib/ressources.js :
// `revue-soeur = {…}` n'est pas une clé Lua valide, et les deux tests de non-divergence plus
// bas reconstruisent la ligne Lua attendue sous la forme `<type> = { … }`.
test('types : la reprise d’un article de la revue sœur porte sa référence bibliographique', () => {
  assert.deepStrictEqual(res.champsBiblio('reprise'), ['auteurs', 'revue', 'reference', 'doi']);
  assert.ok(!res.typeAvecImage('reprise'), 'une reprise ne porte pas d’image');
  assert.deepStrictEqual(res.champsManquants('reprise', { titre: 'X', descriptif: 'Y' }), [],
    'sans image, une reprise est complète dès qu’elle a titre et descriptif');
});

// ---- La fiche « agenda » : ce que l'enquête du 02.09.2026 a trouvé --------------------
//
// Demande de Robin : « Agenda et formation doit devenir un champ structuré (date / plage de
// date / type d'événement, etc.) — parcours nos éléments dans cette rubrique et détermine
// les champs pertinents. » L'enquête a montré que la rubrique IMPRIMÉE des trois derniers
// numéros contrôlés ne contient qu'un LIEN vers szh.ch / csps.ch, et que les vraies entrées
// vivent sur le site — dont le formulaire d'annonce (« Annoncer une formation continue ou
// une manifestation » / « Kurse und Veranstaltungen melden ») donne la structure exacte :
// titre, début, fin, lieu, adresse de contact, lien, plus un texte libre. Ce sont ces
// champs-là, et rien de plus : ni prix, ni public cible, ni délai d'inscription, aucun
// n'existant dans le corpus.
test('agenda : les champs du formulaire d’annonce de szh.ch, et pas un de plus', () => {
  assert.deepStrictEqual(res.champsBiblio('agenda'),
    ['evenement', 'debut', 'fin', 'lieu', 'organisateur']);
  assert.ok(!res.typeAvecImage('agenda'), 'une manifestation ne porte pas d’image');
  // Le descriptif tient le rôle du champ « Message » du formulaire de szh.ch : les dates
  // disjointes d'une formation modulaire y sont précisées en clair, faute d'un champ
  // répétable — c'est ce que fait le site lui-même.
  assert.deepStrictEqual(res.tousLesChamps('agenda'),
    ['titre', 'evenement', 'debut', 'fin', 'lieu', 'organisateur', 'lien', 'descriptif', 'image']);
});

test('agenda : les deux dates se saisissent en ISO, les années d’une recherche non', () => {
  assert.strictEqual(res.saisieChamp('agenda', 'debut'), 'date');
  assert.strictEqual(res.saisieChamp('agenda', 'fin'), 'date');
  // `debut` et `fin` sont partagés avec la recherche en cours, où ce sont des ANNÉES : le
  // mode de saisie est déclaré par (type, champ) et non par champ seul, faute de quoi une
  // recherche « 2024 » se retrouverait avec un sélecteur de jour.
  assert.strictEqual(res.saisieChamp('recherche', 'debut'), '');
  assert.strictEqual(res.saisieChamp('recherche', 'fin'), '');
  assert.strictEqual(res.saisieChamp('livre', 'annee'), '');
});

test('agenda : le type d’événement est une liste fermée, le canton une autre', () => {
  assert.strictEqual(res.listeChamp('agenda', 'evenement'), 'evenement');
  assert.strictEqual(res.listeChamp('intervention', 'canton'), 'canton');
  assert.strictEqual(res.listeChamp('livre', 'auteurs'), '', 'un auteur ne se choisit pas dans une liste');
  assert.deepStrictEqual(res.valeursListe('evenement'),
    ['colloque', 'congres', 'journee', 'cours', 'webinaire', 'formation']);
  // Des JETONS, jamais des libellés : c'est ce qui permet à « Colloque » de sortir
  // « Tagung » côté allemand sans qu'on ait rien à ressaisir.
  for (const v of res.valeursListe('evenement')) {
    assert.match(v, /^[a-z]+$/, 'jeton non conforme : ' + v);
  }
});

test('agenda : les manifestations se rangent par date de début, donc chronologiquement', () => {
  const md = [
    '::: {#a1 .szh-ressource type="agenda" titre="B" debut="2026-11-30"}', 'x', ':::', '',
    '::: {#a2 .szh-ressource type="agenda" titre="A" debut="2026-01-05"}', 'y', ':::'
  ].join(NL);
  const range = res.reordonnerRessources(md, 'fr');
  const ordre = res.lireRessources(range).map((r) => r.valeurs.titre);
  assert.deepStrictEqual(ordre, ['A', 'B'],
    'l’agenda doit se ranger par date et non par titre : c’est tout l’intérêt de la date ISO');
});

// Le champ « type d'intervention » (Motion, Postulat, Interpellation…) ne peut PAS s'appeler
// `type` : cet attribut est déjà pris par le type DE LA FICHE (type="intervention") sur le
// même bloc ; deux attributs `type=` sur un seul bloc {…} se recouvriraient silencieusement,
// et un des deux sens serait perdu à la relecture. C'est le piège que ce lot devait éviter,
// pas une préférence de nommage — d'où `categorie` à la place. Contrôle générique, pour
// qu'aucun type futur ne retombe dans le même piège.
test('types : aucun champ bibliographique d’aucun type ne s’appelle « type » (collision avec l’attribut de type de fiche)', () => {
  for (const t of res.typesConnus()) {
    assert.ok(!res.champsBiblio(t).includes('type'), 'le type ' + t + ' porte un champ nommé « type »');
  }
});

test('types : un type inconnu ne porte aucun champ bibliographique, et n’est pas valide', () => {
  assert.deepStrictEqual(res.champsBiblio('inconnu'), []);
  assert.strictEqual(res.typeValide('inconnu'), false);
  assert.strictEqual(res.typeValide('livre'), true);
  assert.strictEqual(res.typeValide('film'), true);
});

// ---- Champs requis ----

test('requis : titre, descriptif et image manquent tant qu’ils sont vides', () => {
  assert.deepStrictEqual(res.champsManquants('livre', {}), ['titre', 'descriptif', 'image']);
  assert.deepStrictEqual(res.champsManquants('livre',
    { titre: 'X', descriptif: 'Y', image: 'z.png' }), []);
  assert.strictEqual(res.ressourceComplete('livre', { titre: 'X', descriptif: 'Y', image: 'z.png' }), true);
  // La bibliographie et le lien ne bloquent jamais l’écriture : recommandés, pas requis.
  assert.strictEqual(res.ressourceComplete('livre',
    { titre: 'X', descriptif: 'Y', image: 'z.png', auteurs: '', annee: '', editeur: '', lien: '' }), true);
});

// Demande de Robin du 02.09.2026 : une fiche incomplète doit pouvoir s'enregistrer, une
// pastille disant ce qui manque. La complétude ne commande donc plus l'écriture — c'est
// ressourceEcrivable() qui la commande, et il ne refuse que deux choses : un type inconnu,
// et une carte entièrement vide (celle que « Ajouter » vient de créer).
test('écrivable : une fiche incomplète s’écrit, une fiche entièrement vide non', () => {
  assert.strictEqual(res.ressourceEcrivable('livre', { titre: 'Le silence des bêtes' }), true,
    'un titre seul suffit à écrire la fiche : le reste se complète plus tard');
  assert.strictEqual(res.ressourceComplete('livre', { titre: 'Le silence des bêtes' }), false,
    'elle reste incomplète pour autant, et la pastille le dira');
  assert.strictEqual(res.ressourceEcrivable('livre', { descriptif: 'Rien que ceci.' }), true);
  assert.strictEqual(res.ressourceEcrivable('livre', {}), false);
  assert.strictEqual(res.ressourceEcrivable('livre', { titre: '   ', descriptif: NL, lien: '' }), false,
    'des blancs ne sont pas un contenu');
  assert.strictEqual(res.ressourceEcrivable('inconnu', { titre: 'X' }), false);
  // Un champ bibliographique seul suffit aussi : on note parfois la date avant le titre.
  assert.strictEqual(res.ressourceEcrivable('agenda', { debut: '2026-01-05' }), true);
});

test('requis : un type inconnu manque toujours de tout, même rempli', () => {
  assert.deepStrictEqual(res.champsManquants('bd', { titre: 'X', descriptif: 'Y', image: 'z.png' }),
    ['titre', 'descriptif', 'image']);
});

// ---- Types sans image (intervention, recherche) : REQUIS ne leur exige pas d'image ----

test('typeAvecImage : livre et film en portent une, intervention et recherche jamais', () => {
  assert.strictEqual(res.typeAvecImage('livre'), true);
  assert.strictEqual(res.typeAvecImage('film'), true);
  assert.strictEqual(res.typeAvecImage('intervention'), false);
  assert.strictEqual(res.typeAvecImage('recherche'), false);
  assert.strictEqual(res.typeAvecImage('inconnu'), false, 'un type invalide n’« a » pas d’image non plus');
});

test('requis : une intervention complète sans image ne manque de rien', () => {
  assert.deepStrictEqual(res.champsManquants('intervention', { titre: 'X', descriptif: 'Y' }), []);
  assert.strictEqual(res.ressourceComplete('intervention', { titre: 'X', descriptif: 'Y' }), true);
  // Le titre et le descriptif restent, eux, requis même sans image à fournir.
  assert.deepStrictEqual(res.champsManquants('intervention', {}), ['titre', 'descriptif']);
});

test('requis : une recherche complète sans image ne manque de rien', () => {
  assert.deepStrictEqual(res.champsManquants('recherche', { titre: 'X', descriptif: 'Y' }), []);
  assert.strictEqual(res.ressourceComplete('recherche', { titre: 'X', descriptif: 'Y' }), true);
});

// ---- Aller-retour bloc ----

test('bloc : écrire puis relire une fiche livre rend les mêmes valeurs', () => {
  const valeurs = {
    titre: 'Le silence des bêtes', auteurs: 'Jean Dupont, Marie Martin',
    annee: '2019', editeur: 'Éditions XYZ', lien: 'https://exemple.org/livre',
    descriptif: 'Un texte qui présente l’ouvrage.', image: 'couverture-x.jpg'
  };
  const texte = res.ajouterRessource('', 'r1', 'livre', valeurs);
  const liste = res.lireRessources(texte);
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].id, 'r1');
  assert.strictEqual(liste[0].type, 'livre');
  assert.deepStrictEqual(liste[0].valeurs, valeurs);
});

test('bloc : un titre à guillemets fait l’aller-retour ; une accolade y est ôtée', () => {
  // Même règle que normaliserValeurFigure (lib/references.js), réutilisée ici : une
  // accolade dans un attribut casserait silencieusement le bloc {…} qui le porte, comme un
  // copyright ou une source de figure. Le titre et la bibliographie n'échappent pas à
  // cette règle, faute de quoi une fiche pourrait devenir illisible pour le filtre Lua.
  const valeurs = {
    titre: 'Titre avec « guillemets » et accolades', auteurs: 'A "surnommé" B',
    annee: '2020', editeur: 'X & Y', lien: '',
    descriptif: 'Une description sur\nplusieurs lignes, avec des "guillemets".',
    image: 'x.png'
  };
  const texte = res.ajouterRessource('', 'r2', 'livre', valeurs);
  const relu = res.lireRessources(texte)[0].valeurs;
  assert.strictEqual(relu.titre, valeurs.titre);
  assert.strictEqual(relu.auteurs, valeurs.auteurs);
  assert.strictEqual(relu.descriptif, valeurs.descriptif);
});

test('bloc : une accolade dans le titre ne casse pas la ligne d’ouverture du bloc', () => {
  const texte = res.ajouterRessource('', 'r2b', 'livre',
    { titre: 'Un titre { cassant }', descriptif: 'd', image: 'i.png' });
  assert.strictEqual(res.lireRessources(texte).length, 1, 'le bloc n’a pas pu être relu');
});

test('bloc : le lien facultatif, absent, ne laisse aucun attribut lien=', () => {
  const texte = res.ajouterRessource('', 'r3', 'livre',
    { titre: 'T', descriptif: 'D', image: 'i.png', auteurs: '', annee: '', editeur: '', lien: '' });
  assert.ok(!/lien=/.test(texte.split('\n')[0]), 'lien="" écrit malgré une valeur vide');
});

test('bloc : film porte réalisateur, année, genre et pays', () => {
  const valeurs = {
    titre: 'Un film', realisateur: 'Jeanne Réal', annee: '2021', genre: 'Documentaire',
    pays: 'Suisse', lien: 'https://exemple.org/bande-annonce',
    descriptif: 'Descriptif du film.', image: 'affiche.jpg'
  };
  const texte = res.ajouterRessource('', 'f1', 'film', valeurs);
  const relu = res.lireRessources(texte)[0];
  assert.strictEqual(relu.type, 'film');
  assert.deepStrictEqual(relu.valeurs, valeurs);
});

test('bloc : intervention parlementaire fait l’aller-retour, sans image, et « type » n’est pas écrasé', () => {
  const valeurs = {
    titre: 'Renforcer la formation spécialisée', canton: 'Berne', categorie: 'Motion',
    numero: '26.118', date: '12.03.2026', lien: '',
    descriptif: 'Le Conseil fédéral est chargé de…', image: ''
  };
  const texte = res.ajouterRessource('', 'i1', 'intervention', valeurs);
  const liste = res.lireRessources(texte);
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].type, 'intervention',
    'l’attribut type= de la fiche a été écrasé par le champ categorie');
  assert.deepStrictEqual(liste[0].valeurs, valeurs);
  // Le bloc écrit ne porte qu'un seul attribut `type=`, jamais deux (la ligne d'ouverture
  // est la seule à porter des attributs clé=valeur).
  const ouverture = texte.split('\n').find((l) => l.trim().startsWith(':::'));
  assert.strictEqual((ouverture.match(/\btype=/g) || []).length, 1,
    'plus d’un attribut type= dans la ligne d’ouverture : ' + ouverture);
  // Sans image : aucune ligne ![…] parasite dans le bloc écrit.
  assert.doesNotMatch(texte, /!\[/);
});

test('bloc : recherche en cours fait l’aller-retour, avec institutions et une durée en début/fin', () => {
  const valeurs = {
    titre: 'Inclusion scolaire et transitions', institutions: 'Université de Berne, HfH Zürich',
    debut: '2024', fin: '2027', lien: 'https://exemple.org/recherche',
    descriptif: 'Étude longitudinale sur…', image: ''
  };
  const texte = res.ajouterRessource('', 'c1', 'recherche', valeurs);
  const liste = res.lireRessources(texte);
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].type, 'recherche');
  assert.deepStrictEqual(liste[0].valeurs, valeurs);
  assert.doesNotMatch(texte, /!\[/, 'aucune image ne doit être écrite pour ce type');
});

test('bloc : image toujours écrite avec alt="" — décorative par construction', () => {
  const texte = res.ajouterRessource('', 'r4', 'livre',
    { titre: 'T', descriptif: 'D', image: 'couv.png' });
  assert.match(texte, /!\[\]\(media\/couv\.png\)\{alt=""\}/);
});

// ---- Plusieurs fiches : ordre, identité, écriture ciblée ----

test('plusieurs fiches : ajoutées à la suite, dans l’ordre de saisie', () => {
  let texte = '';
  texte = res.ajouterRessource(texte, 'a', 'livre', { titre: 'Premier', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'b', 'film', { titre: 'Second', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'c', 'livre', { titre: 'Troisième', descriptif: 'd', image: 'i.png' });
  const liste = res.lireRessources(texte);
  assert.deepStrictEqual(liste.map((r) => r.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(liste.map((r) => r.valeurs.titre), ['Premier', 'Second', 'Troisième']);
});

test('plusieurs fiches : ajouter n’abîme pas le texte qui suit déjà dans l’article', () => {
  const avant = '# Documentation\n\nUn paragraphe avant.\n';
  const texte = res.ajouterRessource(avant, 'a', 'livre', { titre: 'T', descriptif: 'd', image: 'i.png' });
  assert.match(texte, /Un paragraphe avant\./);
  assert.match(texte, /szh-ressource/);
});

test('écriture ciblée : ecrireRessource ne touche qu’une seule fiche parmi plusieurs', () => {
  let texte = '';
  texte = res.ajouterRessource(texte, 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'b', 'livre', { titre: 'Deux', descriptif: 'd', image: 'i.png' });
  const r = res.ecrireRessource(texte, 'b', 'livre', { titre: 'Deux modifié', descriptif: 'd2', image: 'i2.png' });
  assert.strictEqual(r.ok, true);
  const liste = res.lireRessources(r.texte);
  assert.strictEqual(liste[0].valeurs.titre, 'Un', 'la première fiche a bougé');
  assert.strictEqual(liste[1].valeurs.titre, 'Deux modifié');
  assert.strictEqual(liste[1].valeurs.image, 'i2.png');
});

test('écriture ciblée : ecrireRessource sur un identifiant disparu échoue proprement', () => {
  const texte = res.ajouterRessource('', 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  const r = res.ecrireRessource(texte, 'disparu', 'livre', { titre: 'X', descriptif: 'd', image: 'i.png' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.texte, texte, 'le texte ne doit pas bouger en cas d’échec');
});

test('retrait : retirerRessource ôte la fiche visée et garde les autres et leur ordre', () => {
  let texte = '';
  texte = res.ajouterRessource(texte, 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'b', 'livre', { titre: 'Deux', descriptif: 'd', image: 'i.png' });
  texte = res.ajouterRessource(texte, 'c', 'livre', { titre: 'Trois', descriptif: 'd', image: 'i.png' });
  const r = res.retirerRessource(texte, 'b');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(res.lireRessources(r.texte).map((x) => x.id), ['a', 'c']);
  assert.doesNotMatch(r.texte, /Deux/);
  // Pas de double ligne vide laissée par la coupe.
  assert.doesNotMatch(r.texte, /\n\n\n/);
});

test('retrait : un identifiant disparu échoue sans toucher au texte', () => {
  const texte = res.ajouterRessource('', 'a', 'livre', { titre: 'Un', descriptif: 'd', image: 'i.png' });
  const r = res.retirerRessource(texte, 'zzz');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.texte, texte);
});

// ---- Un bloc qui n'est pas une ressource, ou laissé ouvert, ne trompe pas la lecture ----

test('lecture : un fenced div d’un autre genre est ignoré', () => {
  const texte = '::: {.szh-grille disposition="2-2"}\n![](media/a.png)\n![](media/b.png)\n:::\n';
  assert.deepStrictEqual(res.lireRessources(texte), []);
});

test('lecture : un bloc laissé ouvert (pas de fermeture) n’est pas lu', () => {
  const texte = '::: {.szh-ressource type="livre" titre="X"}\nDescriptif sans fermeture\n';
  assert.deepStrictEqual(res.lireRessources(texte), []);
});

test('lecture : un identifiant absent reçoit un repli stable pour la durée d’une lecture', () => {
  const texte = '::: {.szh-ressource type="livre" titre="Sans id"}\nD\n\n![](media/i.png){alt=""}\n:::\n';
  const liste = res.lireRessources(texte);
  assert.strictEqual(liste.length, 1);
  assert.ok(liste[0].id, 'aucun identifiant de repli');
});

// ---- Non-divergence avec pipeline/filters/szh-ressource.lua ----
//
// Le formulaire ne doit jamais écrire un champ que le rendu ignore, ni l’inverse : les deux
// tables (lib/ressources.js TYPES, szh-ressource.lua TYPES) doivent rester identiques, comme
// szh-grille.lua pour les dispositions (voir contrats.test.js). La table Lua est recopiée à
// la main ; ce test la relit comme un texte et vérifie qu’elle porte, mot pour mot, ce que
// la table JS décrit.

test('szh-ressource.lua : la table TYPES est la même que dans lib/ressources.js', () => {
  const lua = lire('pipeline', 'filters', 'szh-ressource.lua');
  for (const type of res.typesConnus()) {
    const champs = res.champsBiblio(type);
    const attendu = type + ' = { ' + champs.map((c) => "'" + c + "'").join(', ') + ' },';
    assert.ok(lua.includes(attendu),
      'szh-ressource.lua ne porte pas la même ligne pour le type ' + type + ' : ' + attendu);
  }
  assert.ok(lua.includes("local CLASSE = '" + res.CLASSE + "'"),
    'szh-ressource.lua ne connaît pas la classe ' + res.CLASSE);
});

test('szh-ressource.lua : aucun type de lib/ressources.js n’est absent de la table Lua, et réciproquement', () => {
  const lua = lire('pipeline', 'filters', 'szh-ressource.lua');
  const bloc = (lua.match(/local TYPES = \{([\s\S]*?)\n\}/) || [])[1] || '';
  const typesLua = Array.from(bloc.matchAll(/^\s*([a-zA-Z_][\w]*)\s*=/gm)).map((m) => m[1]);
  assert.deepStrictEqual(typesLua.sort(), res.typesConnus().sort(),
    'les types déclarés dans szh-ressource.lua et lib/ressources.js divergent');
});

// La liste fermée `evenement` vit en trois endroits, chacun avec son métier : les JETONS
// dans lib/ressources.js, les libellés de SAISIE dans lib/i18n.js, les libellés IMPRIMÉS
// dans szh-ressource.lua. Un jeton ajouté d'un côté et oublié de l'autre s'imprimerait tel
// quel dans le PDF — dégradation propre, mais silencieuse : d'où ce contrôle.
test('szh-ressource.lua : la liste fermée du type d’événement porte les mêmes jetons', () => {
  const lua = lire('pipeline', 'filters', 'szh-ressource.lua');
  const bloc = (lua.match(/local EVENEMENTS = \{([\s\S]*?)\n\}/) || [])[1] || '';
  const jetonsLua = Array.from(bloc.matchAll(/^\s*([a-z]+)\s*=/gm)).map((m) => m[1]);
  assert.deepStrictEqual(jetonsLua.sort(), res.valeursListe('evenement').sort(),
    'les jetons de LISTES.evenement et ceux de la table EVENEMENTS du filtre divergent');
  for (const j of jetonsLua) {
    assert.match(bloc, new RegExp(j + '\\s*=\\s*\\{ fr = .+ de = .+ \\}'),
      'le jeton ' + j + ' n’a pas ses deux langues dans szh-ressource.lua');
  }
});

test('szh-ressource.lua : branché avant szh-numerotation (l’image doit lui arriver nue)', () => {
  const makefile = lire('pipeline', 'Makefile');
  const lignes = makefile.split('\n');
  const rang = (nom) => lignes.reduce((acc, l, i) => (l.includes('filters/' + nom) ? acc.concat(i) : acc), []);
  const ressource = rang('szh-ressource.lua');
  const numerotation = rang('szh-numerotation.lua');
  assert.strictEqual(ressource.length, 2, 'szh-ressource.lua n’est pas branché dans les deux chaînes');
  assert.strictEqual(numerotation.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.ok(ressource[i] < numerotation[i],
      'szh-ressource.lua doit précéder szh-numerotation.lua : l’image décorative doit lui arriver nue');
  }
});

test('print.css : les règles de mise en page des fiches sont posées', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  for (const regle of ['.szh-ressource-corps', '.szh-ressource-texte', '.szh-ressource-image',
    '.szh-ressource-titre']) {
    assert.ok(css.includes(regle), 'règle absente de print.css : ' + regle);
  }
  // L’image doit rester au quart de la largeur : la formule auto-générée par
  // szh-numerotation.lua (en_decor) pour une figure pleine colonne doit être annulée ici,
  // pas dans socle.css ni livre/base.css (hors périmètre de ce lot).
  assert.match(css, /\.szh-ressource-image\s*>?\s*\.szh-decor/,
    'la largeur du décor n’est pas reprise en main pour le quart de colonne');
});

test('print.css : une fiche sans image (intervention, recherche) a son rendu compact dédié', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  assert.ok(css.includes('.szh-ressource-sans-image'),
    'règle absente de print.css : .szh-ressource-sans-image');
});

test('szh-ressource.lua : pose .szh-ressource-sans-image quand le bloc n’a pas d’image, sans nommer de type', () => {
  const lua = lire('pipeline', 'filters', 'szh-ressource.lua');
  assert.match(lua, /CLASSE\s*\.\.\s*'-sans-image'/,
    'la classe compacte doit être dérivée génériquement (absence d’image), pas listée par type');
});

// ---- Tri des fiches : le .md lui-même se range ----------------------------------------
//
// Demande de Robin (01.09.2026). Le formulaire affiche la POSITION de chaque fiche dans
// l'en-tête de son accordéon : le tri doit donc porter sur le document, pas sur le seul
// affichage. Une position montrée que le .md ne respecterait pas mentirait sur l'ordre du
// PDF — l'écart silencieux que ce projet traque partout ailleurs.

// Un document d'essai : deux sections, chacune sous son intertitre, fiches en désordre.
function mdDeuxSections() {
  return [
    '## Livres', '',
    ':::  {#r1 .szh-ressource type="livre" titre="Zebre"}', 'desc Z', ':::', '',
    '::: {#r2 .szh-ressource type="livre" titre="École"}', 'desc E', ':::', '',
    '::: {#r3 .szh-ressource type="livre" titre="Alpha"}', 'desc A', ':::', '',
    '## Films', '',
    '::: {#r4 .szh-ressource type="film" titre="Zorro"}', 'desc Zo', ':::', '',
    '::: {#r5 .szh-ressource type="film" titre="Avatar"}', 'desc Av', ':::', ''
  ].join('\n');
}

test('tri : les livres se rangent par titre, accents à leur place alphabétique', () => {
  const out = res.reordonnerRessources(mdDeuxSections(), 'fr');
  const titres = res.lireRessources(out).filter((f) => f.type === 'livre').map((f) => f.valeurs.titre);
  assert.deepStrictEqual(titres, ['Alpha', 'École', 'Zebre'],
    '« École » doit se ranger avec les E — un tri par octets le mettrait après « Zebre »');
});

test('tri : le bloc entier suit, descriptif compris', () => {
  const out = res.reordonnerRessources(mdDeuxSections(), 'fr');
  const paire = res.lireRessources(out).map((f) => f.valeurs.titre + '=' + f.valeurs.descriptif);
  assert.deepStrictEqual(paire,
    ['Alpha=desc A', 'École=desc E', 'Zebre=desc Z', 'Avatar=desc Av', 'Zorro=desc Zo'],
    'un descriptif s’est détaché de sa fiche : ce sont les blocs qui permutent, pas les en-têtes');
});

test('tri : aucune fiche ne franchit un intertitre ni ne change de section', () => {
  const out = res.reordonnerRessources(mdDeuxSections(), 'fr');
  const avantFilms = out.split('## Films')[0];
  assert.ok(!/type="film"/.test(avantFilms),
    'un film a migré dans la section des livres : le tri doit s’arrêter aux intertitres');
  assert.ok(out.includes('## Livres') && out.includes('## Films'),
    'un intertitre a disparu : seuls les blocs de fiches permutent, jamais le reste');
});

test('tri : les interventions se rangent par canton, le titre départageant', () => {
  const md = [
    '::: {#i1 .szh-ressource type="intervention" titre="Bravo" canton="Zurich"}', 'd', ':::', '',
    '::: {#i2 .szh-ressource type="intervention" titre="Zoulou" canton="Argovie"}', 'd', ':::', '',
    '::: {#i3 .szh-ressource type="intervention" titre="Alpha" canton="Zurich"}', 'd', ':::', ''
  ].join('\n');
  const rangees = res.lireRessources(res.reordonnerRessources(md, 'de'))
    .map((f) => f.valeurs.canton + '/' + f.valeurs.titre);
  assert.deepStrictEqual(rangees, ['Argovie/Zoulou', 'Zurich/Alpha', 'Zurich/Bravo'],
    'deux fiches d’un même canton doivent être départagées par le titre, sinon leur ordre '
    + 'dépend de la saisie et change à chaque enregistrement');
});

test('tri : un texte que rien ne fait bouger revient identique au caractère près', () => {
  const seule = '::: {#s1 .szh-ressource type="livre" titre="Seul"}\nd\n:::\n';
  assert.strictEqual(res.reordonnerRessources(seule, 'fr'), seule, 'une fiche unique');
  assert.strictEqual(res.reordonnerRessources('# Rien\n\ndu texte\n', 'fr'), '# Rien\n\ndu texte\n',
    'un document sans aucune fiche');
  const trie = res.reordonnerRessources(mdDeuxSections(), 'fr');
  assert.strictEqual(res.reordonnerRessources(trie, 'fr'), trie, 'un document déjà rangé');
});

test('tri : écrire une fiche la remet à sa place, sans langue il ne se passe rien', () => {
  const md = mdDeuxSections();
  const avecLangue = res.ecrireRessource(md, 'r1', 'livre', { titre: 'Aaa', descriptif: 'desc Z' }, 'fr');
  assert.ok(avecLangue.ok);
  assert.strictEqual(res.lireRessources(avecLangue.texte)[0].valeurs.titre, 'Aaa',
    'renommée « Aaa », la fiche doit passer en tête de sa section');

  const sansLangue = res.ecrireRessource(md, 'r1', 'livre', { titre: 'Aaa', descriptif: 'desc Z' });
  assert.strictEqual(res.lireRessources(sansLangue.texte)[0].valeurs.titre, 'Aaa',
    'sans langue, la fiche est réécrite en place et le document garde son ordre de saisie');
  assert.strictEqual(res.lireRessources(sansLangue.texte)[1].valeurs.titre, 'École');
});
