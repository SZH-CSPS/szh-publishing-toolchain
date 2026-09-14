// Mode « Trad » : le clic détourné, l'index qui retrouve la clé d'un texte, et le dossier
// où atterrissent les suggestions sur les libellés de l'outil.
//
//   node --test "test/js/*.test.js"
//
// Ce que ce fichier garde :
//   * LE PIÈGE. Un mode qui détourne TOUS les clics peut s'enfermer : allumé, si la page des
//     réglages détournait les siens, on ne pourrait plus l'éteindre — plus aucun bouton ne
//     répondrait, dans aucun panneau, et il faudrait éditer C:\ProgramData\SZH\config.json à
//     la main. C'est LE défaut à empêcher, et il ne se voit sur aucune capture d'écran : la
//     page a l'air normale, elle ne répond simplement plus. Trois contrôles le gardent — les
//     réglages ne détournent jamais, ils ne demandent même pas l'index, et le formulaire de
//     suggestion non plus.
//   * LE MODE QUI NE SE VOIT PAS. Un outil dont plus aucun bouton ne répond, sans un mot,
//     passe pour cassé. Le bandeau et son bouton de sortie sont éprouvés ici, dans la vraie
//     page : c'est le défaut vécu la veille avec la pastille du vérificateur — module juste,
//     tests verts, et rien à l'écran.
//   * LE MODE ÉTEINT QUI DÉTOURNE QUAND MÊME, et son inverse : sans message de l'hôte, aucun
//     clic ne doit changer de sens. Une clé absente ne doit jamais allumer le mode.
//   * L'INDEX. Un texte à trou retrouvé par son motif, un texte partagé par deux libellés qui
//     rend DEUX candidates (l'outil ne tranche pas à la place de la personne), et un texte
//     inconnu qui ouvre quand même le formulaire — c'est justement celui-là qu'un mainteneur
//     veut voir. Et la copie de la recherche qui vit dans media/_commun.js doit rendre
//     exactement ce que rend le module : deux réponses différentes seraient invisibles.
//   * LE CHAMP `cible` ABSENT. Il est apparu APRÈS les premiers fichiers de suggestion : un
//     fichier qui n'en porte pas doit se relire « article », sans quoi le schéma /1 aurait
//     menti en restant /1 — même règle que `geste`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const ix = require(path.join(COCKPIT, 'lib', 'index-textes.js'));
const sugg = require(path.join(COCKPIT, 'lib', 'suggestion-traduction.js'));
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');
const { TEXTES_COCKPIT } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

// Le config.json factice posé par dom-minimal, à remettre après chaque contrôle qui détourne
// SZH_CONFIG_OJS vers le sien. Sans cette remise, lib/i18n.js irait lire le config.json DU
// POSTE : sur une machine réglée en allemand, toutes les pages rendues ensuite seraient en
// allemand et les contrôles qui comparent à un libellé français tomberaient — pour une
// raison qui n'a rien à voir avec eux.
const CONFIG_HARNAIS = process.env.SZH_CONFIG_OJS;

// ---- L'index ----------------------------------------------------------------------

test('index : un texte affiché tel quel retrouve sa clé', () => {
  const index = ix.construireIndex({ 'a.titre': 'Métadonnées du numéro', 'b.x': 'Annuler' });
  assert.deepStrictEqual(ix.trouverCles(index, 'Métadonnées du numéro'), ['a.titre']);
  // Les espaces du HTML ne comptent pas : un libellé posé sur deux lignes dans un gabarit
  // arrive à l'écran avec des retours et de l'indentation, et l'insécable des libellés du
  // cockpit n'est pas l'espace que le DOM rend.
  assert.deepStrictEqual(ix.trouverCles(index, '  Métadonnées\n  du numéro '), ['a.titre']);
});

test('index : un texte à trou est retrouvé par son MOTIF', () => {
  const index = ix.construireIndex({ 'statut.build.de': 'Compilation de « {0} »…' });
  assert.strictEqual(index.motifs.length, 1, 'le motif n’a pas été retenu');
  assert.deepStrictEqual(index.motifs[0].parts, ['Compilation de « ', ' »…']);
  assert.deepStrictEqual(ix.trouverCles(index, 'Compilation de « mon-article »…'),
    ['statut.build.de'], 'le texte rempli ne retrouve pas son gabarit');
  // Le trou vaut AU MOINS un caractère : sinon le motif reconnaîtrait le gabarit amputé,
  // qui est un autre texte.
  assert.deepStrictEqual(ix.trouverCles(index, 'Compilation de «  »…'), []);
  // Et il ne reconnaît pas ce qui ne commence ni ne finit comme lui.
  assert.deepStrictEqual(ix.trouverCles(index, 'Compilation de « x » terminée'), []);
});

test('index : un motif à part fixe trop courte n’entre pas dans l’index', () => {
  // « {0} : {1} » reconnaîtrait toute ligne à deux points de toute l'interface : le motif
  // est écarté, plutôt que d'attraper n'importe quoi.
  const index = ix.construireIndex({ 'x.court': '{0} : {1}', 'x.long': 'Volume {0} de la revue' });
  assert.deepStrictEqual(index.motifs.map((m) => m.cle), ['x.long']);
  assert.deepStrictEqual(ix.trouverCles(index, 'Titre : valeur'), []);
  assert.deepStrictEqual(ix.trouverCles(index, 'Volume 44 de la revue'), ['x.long']);
  assert.strictEqual(ix.MIN_FIXE, 8, 'le seuil a changé sans que ce contrôle le dise');
});

test('index : un texte partagé par deux clés rend DEUX candidates', () => {
  const index = ix.construireIndex({ 'a.titre': 'Titre', 'b.titre': 'Titre', 'c.x': 'Annuler' });
  assert.deepStrictEqual(ix.trouverCles(index, 'Titre'), ['a.titre', 'b.titre'],
    'l’outil a tranché à la place de la personne');
  assert.deepStrictEqual(ix.trouverCles(index, 'Annuler'), ['c.x']);
});

test('index : un texte inconnu rend une liste vide, sans lever', () => {
  const index = ix.construireIndex({ 'a.x': 'Annuler' });
  assert.deepStrictEqual(ix.trouverCles(index, 'Texte que personne n’a jamais écrit'), []);
  assert.deepStrictEqual(ix.trouverCles(index, ''), []);
  assert.deepStrictEqual(ix.trouverCles(null, 'Annuler'), []);
  // Un libellé qui vaudrait « constructor » ne doit pas rendre une fonction héritée.
  const piege = ix.construireIndex({ 'a.y': 'constructor' });
  assert.deepStrictEqual(ix.trouverCles(piege, 'constructor'), ['a.y']);
  assert.deepStrictEqual(ix.trouverCles(piege, 'toString'), []);
});

test('index : la vraie table du cockpit se laisse indexer, et l’exact prime le motif', () => {
  const index = ix.construireIndex(TEXTES_COCKPIT.fr);
  const total = Object.keys(TEXTES_COCKPIT.fr).length;
  let cles = 0;
  for (const texte of Object.keys(index.exact)) { cles += index.exact[texte].length; }
  assert.ok(cles > total / 2, 'moins de la moitié des libellés sont retrouvables à l’identique');
  assert.ok(index.motifs.length > 100, 'les libellés à trou ne sont pas indexés');
  // Un libellé réel, pris dans la table plutôt que recopié ici.
  assert.deepStrictEqual(ix.trouverCles(index, TEXTES_COCKPIT.fr['sugg.annuler']).length > 0, true);
  // L'index part dans un postMessage : il doit survivre à un aller-retour JSON, ce qu'une
  // RegExp ou une Map ne feraient pas.
  const relu = JSON.parse(JSON.stringify(index));
  assert.deepStrictEqual(ix.trouverCles(relu, 'Compilation de « mon-article »…'),
    ix.trouverCles(index, 'Compilation de « mon-article »…'));
});

// ---- Le réglage du poste ------------------------------------------------------------
//
// SZH_CONFIG_OJS détourne la lecture : aucun test ne touche C:\ProgramData\SZH\config.json.

function archivageSur(config) {
  const chemin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-trad-')), 'config.json');
  if (config !== null) { fs.writeFileSync(chemin, JSON.stringify(config, null, 2)); }
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  return { archivage: require(path.join(COCKPIT, 'lib', 'archivage.js')), chemin: chemin };
}

test('lireModeTrad rend faux par défaut, et lit un JSON écrit à la main', () => {
  const cas = [
    [null, false, 'aucune configuration'],
    [{}, false, 'clé absente'],
    [{ modeTrad: true }, true, 'booléen vrai'],
    [{ modeTrad: 'true' }, true, 'chaîne « true »'],
    [{ modeTrad: 'false' }, false, 'chaîne « false »'],
    [{ modeTrad: 'peut-être' }, false, 'valeur incompréhensible : éteint']
  ];
  try {
    for (const [config, attendu, quoi] of cas) {
      assert.strictEqual(archivageSur(config).archivage.lireModeTrad(), attendu, quoi);
    }
    // Les deux modes sont indépendants : allumer l'un n'allume pas l'autre.
    const { archivage } = archivageSur({ verifTraduction: true });
    assert.strictEqual(archivage.lireModeTrad(), false,
      'le vérificateur de traduction allume le mode « Trad »');
  } finally { process.env.SZH_CONFIG_OJS = CONFIG_HARNAIS; }
});

test('ecrireModeTrad pose un booléen propre sans toucher au reste de config.json', () => {
  try {
    const { archivage, chemin } = archivageSur({ emplacementRevues: 'production', modeTrad: 'true' });
    assert.strictEqual(archivage.ecrireModeTrad(false), null, 'écriture en échec');
    const relu = JSON.parse(fs.readFileSync(chemin, 'utf8'));
    assert.strictEqual(relu.modeTrad, false, 'la chaîne n’a pas été normalisée en booléen');
    assert.strictEqual(relu.emplacementRevues, 'production', 'le reste de config.json a été perdu');
  } finally { process.env.SZH_CONFIG_OJS = CONFIG_HARNAIS; }
});

// ---- Les suggestions sur les textes de l'outil ---------------------------------------

function dossierEssai() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-sugg-int-'));
}

test('une suggestion d’interface s’écrit et se relit, sans numéro ni article', () => {
  const dossier = dossierEssai();
  const res = sugg.ecrireSuggestionInterface(dossier, {
    auteur: 'Robin', cle: 'regl.titre', cles: ['regl.titre', 'autre.titre'], langue: 'fr',
    actuel: 'Réglages', propose: 'Préférences', commentaire: 'Le mot de la maison.'
  });
  assert.ok(res.ok, 'écriture refusée : ' + JSON.stringify(res));
  const relues = sugg.listerSuggestionsInterface(dossier);
  assert.strictEqual(relues.length, 1);
  const s = relues[0];
  assert.strictEqual(s.cible, 'interface');
  assert.strictEqual(s.cle, 'regl.titre');
  assert.deepStrictEqual(s.cles, ['regl.titre', 'autre.titre']);
  assert.strictEqual(s.langue, 'fr');
  assert.strictEqual(s.actuel, 'Réglages');
  assert.strictEqual(s.propose, 'Préférences');
  assert.strictEqual(s.geste, 'remplacer');
  // Le nom dit la clé et la langue : un dossier se lit sans rien ouvrir.
  assert.match(s.fichier, /^\d{8}-\d{6}-regl\.titre-fr\.json$/);
  // Ce qu'elle ne porte PAS : une suggestion d'interface ne concerne aucun numéro.
  const brut = JSON.parse(fs.readFileSync(s.chemin, 'utf8'));
  for (const absent of ['produit', 'numero', 'article', 'champ']) {
    assert.ok(!(absent in brut), 'champ d’article dans une suggestion d’interface : ' + absent);
  }
  // Et le mode d'emploi est posé à côté, pour qui tombe sur ce dossier.
  assert.ok(fs.existsSync(path.join(dossier, 'LISEZ-MOI.txt')), 'dossier sans mode d’emploi');
  assert.strictEqual(sugg.compterSuggestionsInterface(dossier), 1,
    'le LISEZ-MOI a été compté comme une suggestion');
});

test('un texte non identifié s’enregistre quand même, sans clé', () => {
  const dossier = dossierEssai();
  const res = sugg.ecrireSuggestionInterface(dossier, {
    auteur: 'Robin', cle: '', cles: [], langue: 'de',
    actuel: 'Ein Text', propose: 'Ein besserer Text', commentaire: ''
  });
  assert.ok(res.ok, 'une suggestion sans clé a été refusée : ' + JSON.stringify(res));
  const s = sugg.listerSuggestionsInterface(dossier)[0];
  assert.strictEqual(s.cle, null, 'la clé absente n’est pas dite « null »');
  assert.deepStrictEqual(s.cles, []);
  assert.match(s.fichier, /^\d{8}-\d{6}-sans-cle-de\.json$/);
});

test('une suggestion d’interface qui ne dit rien est refusée', () => {
  const dossier = dossierEssai();
  const res = sugg.ecrireSuggestionInterface(dossier, {
    cle: 'a.b', langue: 'fr', actuel: 'Annuler', propose: 'Annuler', commentaire: ''
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.raison, 'vide');
  // Une SUPPRESSION, elle, n'a jamais de texte proposé : elle passe.
  assert.ok(sugg.ecrireSuggestionInterface(dossier, {
    cle: 'a.b', langue: 'fr', geste: 'supprimer', actuel: 'Annuler', propose: '', commentaire: ''
  }).ok, 'une proposition de suppression a été prise pour un formulaire vide');
});

test('un fichier écrit avant le champ « cible » se relit « article »', () => {
  // Un fichier de la première version du format, mot pour mot : pas de clé « cible ».
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-cible-'));
  const dossier = path.join(racine, 'traduction');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, '20260901-080000-mon-article-title-de.json'),
    JSON.stringify({
      schema: 'szh-suggestion-traduction/1', horodatage: '2026-09-01T08:00:00+02:00',
      auteur: 'Robin', produit: 'revue', numero: '2026-03', article: 'mon-article',
      champ: 'title', langue: 'de', geste: 'remplacer',
      actuel: 'Alter Titel', propose: 'Neuer Titel', commentaire: ''
    }, null, 2) + '\n');
  const relues = sugg.listerSuggestions(racine);
  assert.strictEqual(relues.length, 1);
  assert.strictEqual(relues[0].cible, 'article',
    'un fichier sans le champ ne se relit plus comme avant : le schéma /1 aurait menti');
  assert.strictEqual(sugg.normaliserCible(undefined), 'article');
  assert.strictEqual(sugg.normaliserCible('cible-inventée'), 'article');
  assert.strictEqual(sugg.normaliserCible(' interface '), 'interface');
});

// ---- L'interception, dans les vraies pages -------------------------------------------
//
// Éprouver un module ne dit RIEN de ce qu'une page fait : entre le réglage sur le disque et
// un clic détourné il y a cinq relais — l'hôte lit le réglage, la page le demande, l'hôte
// répond avec l'index, le socle branche son écoute, et le clic repart. Un seul relais muet,
// et le mode ne fait rien sans qu'une ligne de code n'ait l'air fausse.

const INDEX_ESSAI = ix.construireIndex({
  'a.titre': 'Titre',
  'b.titre': 'Titre',                                  // deux clés, le même texte
  'c.ouvrir': 'Ouvrir l’article',
  'd.build': 'Compilation de « {0} »…'
});
const TEXTES_ESSAI = { bandeau: 'Mode « Trad » actif.', eteindre: 'Éteindre le mode' };

function allumer(page) {
  page.envoyer({ type: 'modeTrad', actif: true, index: INDEX_ESSAI, textes: TEXTES_ESSAI });
}

// La vue d'ensemble : la plus simple des pages qui détournent, et elle n'attend aucun
// libellé de l'hôte.
function ouvrirVue() {
  return ouvrir({
    racine: RACINE, page: 'vue-ensemble',
    cssPartage: ['_design.css', '_liste.css'], jsPartage: ['_messages.js']
  });
}

// Un clic tel que le navigateur le rend : capté sur <body>, en capture, avec sa cible.
function cliquer(page, cible) {
  page.document.body.dispatchEvent({ type: 'click', target: cible });
}

function poserBouton(page, texte) {
  const b = page.document.createElement('button');
  b.textContent = texte;
  page.document.body.appendChild(b);
  return b;
}

const detournes = (page) => page.messages.filter((m) => m.type === 'suggererInterface');
// La demande du mode voyage avec le « pret » : une page qui ne la porte pas ne recevra
// jamais l'index.
const demande = (page) => page.messages.some((m) => m.type === 'pret' && m.modeTrad === true);
// Les clés postées, recopiées : la page les fabrique dans son propre contexte, et un
// postMessage réel les sérialiserait de toute façon.
const clesDe = (message) => Array.from(message.cles);

test('un panneau demande le mode à l’ouverture, et l’hôte seul décide', () => {
  const page = ouvrirVue();
  assert.ok(demande(page),
    'la page ne demande jamais l’état du mode : l’hôte ne lui enverra donc jamais l’index');
  // La demande ne s'ajoute pas au protocole de la page : elle voyage sur son « pret ».
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'],
    'un message de plus à l’ouverture ; messages : ' + JSON.stringify(page.messages));
});

test('mode allumé : le clic est détourné, et porte le texte et ses clés', () => {
  const page = ouvrirVue();
  allumer(page);
  const bouton = poserBouton(page, 'Ouvrir l’article');
  cliquer(page, bouton);
  const vus = detournes(page);
  assert.strictEqual(vus.length, 1,
    'le clic n’a pas été détourné ; messages : ' + JSON.stringify(page.messages));
  assert.strictEqual(vus[0].texte, 'Ouvrir l’article');
  assert.deepStrictEqual(clesDe(vus[0]), ['c.ouvrir']);
  // La recherche de la page doit rendre exactement ce que rend le module : deux réponses
  // différentes seraient invisibles à l'écran.
  assert.deepStrictEqual(clesDe(vus[0]), ix.trouverCles(INDEX_ESSAI, 'Ouvrir l’article'));
});

test('mode allumé : l’action normale est empêchée', () => {
  const page = ouvrirVue();
  allumer(page);
  const bouton = poserBouton(page, 'Ouvrir l’article');
  let agi = false;
  bouton.addEventListener('click', function () { agi = true; });
  let arrete = false;
  page.document.body.dispatchEvent({
    type: 'click', target: bouton, stopPropagation: function () { arrete = true; }
  });
  assert.ok(arrete, 'le clic continue sa route : le bouton fera son action habituelle');
  assert.ok(!agi || arrete, 'l’action normale n’a pas été empêchée');
});

test('mode éteint : aucun clic ne change de sens', () => {
  // Sans message de l'hôte d'abord — c'est l'état normal d'un poste.
  const muet = ouvrirVue();
  cliquer(muet, poserBouton(muet, 'Ouvrir l’article'));
  assert.strictEqual(detournes(muet).length, 0, 'un panneau détourne sans que le mode soit allumé');
  // Puis avec un « éteint » explicite : une clé absente ne doit jamais allumer le mode.
  const eteint = ouvrirVue();
  eteint.envoyer({ type: 'modeTrad', actif: false });
  cliquer(eteint, poserBouton(eteint, 'Ouvrir l’article'));
  assert.strictEqual(detournes(eteint).length, 0, 'le mode éteint détourne quand même');
  const sansCle = ouvrirVue();
  sansCle.envoyer({ type: 'modeTrad', index: INDEX_ESSAI });
  cliquer(sansCle, poserBouton(sansCle, 'Ouvrir l’article'));
  assert.strictEqual(detournes(sansCle).length, 0, 'un message sans « actif » allume le mode');
});

test('mode allumé : un texte à trou est retrouvé par son motif, jusque dans la page', () => {
  const page = ouvrirVue();
  allumer(page);
  cliquer(page, poserBouton(page, 'Compilation de « mon-article »…'));
  assert.deepStrictEqual(clesDe(detournes(page)[0]), ['d.build'],
    'le texte rempli n’a pas retrouvé son gabarit depuis la page');
});

test('mode allumé : un texte partagé rend DEUX candidates, un texte inconnu aucune', () => {
  const page = ouvrirVue();
  allumer(page);
  cliquer(page, poserBouton(page, 'Titre'));
  assert.deepStrictEqual(clesDe(detournes(page)[0]), ['a.titre', 'b.titre']);
  cliquer(page, poserBouton(page, 'Un texte que personne n’a écrit'));
  const dernier = detournes(page)[1];
  assert.ok(dernier, 'un texte inconnu n’ouvre rien : c’est pourtant celui-là qu’on veut voir');
  assert.strictEqual(dernier.texte, 'Un texte que personne n’a écrit');
  assert.deepStrictEqual(clesDe(dernier), []);
});

test('mode allumé : le texte pris est celui de l’élément le plus proche, pas le panneau', () => {
  const page = ouvrirVue();
  allumer(page);
  // Une ligne qui porte son texte et un pictogramme : on clique le pictogramme, qui ne dit
  // rien, et c'est le texte de la ligne qu'on relit — pas celui de toute la page.
  const ligne = page.document.createElement('p');
  ligne.appendChild(page.document.createTextNode('Ouvrir l’article'));
  const icone = page.document.createElement('i');
  ligne.appendChild(icone);
  page.document.body.appendChild(ligne);
  cliquer(page, icone);
  assert.strictEqual(detournes(page)[0].texte, 'Ouvrir l’article');
});

test('mode allumé : les textes qui ne sont pas du texte — invite, infobulle, valeur', () => {
  const page = ouvrirVue();
  allumer(page);
  const champ = page.document.createElement('input');
  champ.type = 'text';
  champ.placeholder = 'Titre';
  page.document.body.appendChild(champ);
  cliquer(page, champ);
  assert.strictEqual(detournes(page)[0].texte, 'Titre', 'l’invite d’un champ n’est pas relisible');

  const muet = page.document.createElement('span');
  muet.setAttribute('title', 'Ouvrir l’article');
  page.document.body.appendChild(muet);
  cliquer(page, muet);
  assert.strictEqual(detournes(page)[1].texte, 'Ouvrir l’article', 'une infobulle n’est pas relisible');

  // Ce que le rédacteur a tapé n'est PAS un libellé de l'outil : la valeur d'un champ de
  // saisie ne doit jamais partir en suggestion.
  const saisi = page.document.createElement('input');
  saisi.type = 'text';
  saisi.value = 'mon titre à moi';
  page.document.body.appendChild(saisi);
  cliquer(page, saisi);
  assert.ok(!detournes(page).some((m) => m.texte === 'mon titre à moi'),
    'le texte saisi par le rédacteur est parti comme un libellé de l’outil');
});

// ---- Le mode se voit, et se quitte ---------------------------------------------------

const bandeaux = (page) => page.compterPage('.szh-trad-bandeau');

test('le mode pose un bandeau qui dit ce qu’il fait et comment sortir', () => {
  const page = ouvrirVue();
  assert.strictEqual(bandeaux(page), 0, 'un bandeau alors que le mode est éteint');
  allumer(page);
  assert.strictEqual(bandeaux(page), 1,
    'aucun bandeau : le panneau ne répond plus et rien ne dit pourquoi');
  const textes = page.document.body.querySelectorAll('.szh-trad-bandeau')[0].textContent;
  assert.ok(textes.includes(TEXTES_ESSAI.bandeau), 'le bandeau ne dit pas ce qu’un clic va faire');
  assert.ok(textes.includes(TEXTES_ESSAI.eteindre), 'le bandeau n’offre pas de sortie');
  // Éteint, il s'en va.
  page.envoyer({ type: 'modeTrad', actif: false });
  assert.strictEqual(bandeaux(page), 0, 'le bandeau reste alors que le mode est éteint');
});

test('le bouton du bandeau éteint le mode, et le dit à l’hôte', () => {
  const page = ouvrirVue();
  allumer(page);
  const sortie = page.document.body.querySelectorAll('button.szh-trad-sortie')[0];
  assert.ok(sortie, 'le bandeau n’a pas de bouton de sortie');
  sortie.dispatchEvent({ type: 'click' });
  assert.ok(page.messages.some((m) => m.type === 'modeTrad' && m.actif === false),
    'la sortie ne prévient pas l’hôte : le réglage resterait allumé');
  // Et le panneau redevient cliquable tout de suite, sans attendre la réponse de l'hôte.
  cliquer(page, poserBouton(page, 'Titre'));
  assert.strictEqual(detournes(page).length, 0, 'les clics sont encore détournés après la sortie');
});

test('Échap éteint le mode depuis n’importe quel panneau', () => {
  const page = ouvrirVue();
  allumer(page);
  page.document.body.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.ok(page.messages.some((m) => m.type === 'modeTrad' && m.actif === false),
    'Échap ne sort pas du mode');
  assert.strictEqual(bandeaux(page), 0);
});

// ---- LE GARDE-FOU : les réglages ne se détournent JAMAIS -------------------------------

function ouvrirReglages() {
  return ouvrir({
    racine: RACINE, page: 'settings',
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    txt: libellesHote(RACINE, ['REGL_LIBELLES'])
  });
}

test('réglages : la page ne détourne rien, mode allumé compris', () => {
  const page = ouvrirReglages();
  // Elle ne demande même pas l'état du mode : l'hôte n'a rien à lui envoyer.
  assert.ok(!demande(page),
    'la page des réglages demande l’index : elle pourrait donc détourner ses clics');
  // Et même si un message arrivait quand même, elle ne s'y met pas.
  allumer(page);
  assert.strictEqual(bandeaux(page), 0, 'la page des réglages se croit en mode « Trad »');
  const radios = page.parId.zones.querySelectorAll('input');
  assert.ok(radios.length > 0, 'la page des réglages n’a pas rendu ses groupes');
  cliquer(page, radios[0]);
  assert.strictEqual(detournes(page).length, 0,
    'ON NE PEUT PLUS ÉTEINDRE LE MODE : la page des réglages détourne ses propres clics');
});

test('réglages : le mode s’allume et s’éteint depuis un vrai bouton radio', () => {
  const page = ouvrirReglages();
  const choix = page.parId.zones.querySelectorAll('input').filter((i) => i.name === 'modeTrad');
  assert.strictEqual(choix.length, 2,
    'le mode « Trad » n’a pas de réglage : il ne s’allumerait nulle part');
  choix[0].dispatchEvent({ type: 'change' });
  assert.ok(page.messages.some((m) => m.type === 'regler' && m.cle === 'modeTrad' && m.valeur === 'actif'),
    'le choix ne part pas à l’hôte ; messages : ' + JSON.stringify(page.messages));
});

test('réglages : les suggestions d’interface se comptent et leur dossier s’ouvre', () => {
  const page = ouvrirReglages();
  const libelle = TEXTES_COCKPIT.fr['regl.suggInterface.ouvrir'];
  const boutons = page.parId.zones.querySelectorAll('button').filter((b) => b.textContent === libelle);
  assert.strictEqual(boutons.length, 1,
    'aucun bouton pour ouvrir le dossier : les suggestions seraient écrites et jamais relues');
  boutons[0].dispatchEvent({ type: 'click' });
  assert.ok(page.messages.some((m) => m.type === 'suggestionsInterface'),
    'le bouton est muet ; messages : ' + JSON.stringify(page.messages));
  // Le compte arrive avec les valeurs, et se lit en toutes lettres.
  page.envoyer({ type: 'valeurs', valeurs: {}, suggInterface: 3 });
  const dit = TEXTES_COCKPIT.fr['regl.suggInterface'].split('{0}').join('3');
  assert.ok(page.parId.zones.textContent.includes(dit),
    'le compte des suggestions ne s’affiche pas : ' + JSON.stringify(dit));
});

// ---- LE GARDE-FOU : le formulaire de suggestion non plus --------------------------------

function ouvrirFormulaire() {
  return ouvrir({
    racine: RACINE, page: 'suggestion',
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    txt: libellesHote(RACINE, ['textesSuggestion'])
  });
}

test('formulaire : il ne détourne jamais ses propres clics', () => {
  const page = ouvrirFormulaire();
  assert.ok(!demande(page),
    'le formulaire demande l’index : « Enregistrer » deviendrait inatteignable');
  allumer(page);
  assert.strictEqual(bandeaux(page), 0);
  cliquer(page, page.parId.enregistrer);
  assert.strictEqual(detournes(page).length, 0,
    'le formulaire s’intercepte lui-même : on ne pourrait plus enregistrer');
});

test('formulaire : une cible « interface » montre la clé, et l’envoie', () => {
  const page = ouvrirFormulaire();
  page.envoyer({
    type: 'valeurs', cible: 'interface', cles: ['a.titre'], langue: 'fr',
    libelles: { langue: 'Français' }, actuel: 'Titre'
  });
  const tete = page.parId.quoi.textContent;
  assert.ok(tete.includes('a.titre'), 'la clé retrouvée ne s’affiche pas : ' + JSON.stringify(tete));
  assert.ok(tete.includes(TEXTES_COCKPIT.fr['sugg.cible.interface']),
    'rien ne dit qu’on relit un texte de l’outil');
  page.parId.propose.value = 'Intitulé';
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer')[0];
  assert.ok(envoi, 'rien n’est envoyé ; messages : ' + JSON.stringify(page.messages));
  assert.strictEqual(envoi.cible, 'interface');
  assert.strictEqual(envoi.cle, 'a.titre');
  assert.strictEqual(envoi.propose, 'Intitulé');
  assert.strictEqual(envoi.slug, undefined, 'une suggestion d’interface emporte un article');
  assert.strictEqual(envoi.champ, undefined, 'une suggestion d’interface emporte un champ');
});

test('formulaire : deux candidates se choisissent, une absente n’empêche rien', () => {
  const page = ouvrirFormulaire();
  page.envoyer({
    type: 'valeurs', cible: 'interface', cles: ['a.titre', 'b.titre'], langue: 'fr',
    libelles: { langue: 'Français' }, actuel: 'Titre'
  });
  const choix = page.parId.quoi.querySelectorAll('select');
  assert.strictEqual(choix.length, 1, 'deux candidates, et rien pour les départager');
  assert.deepStrictEqual(choix[0].options.map((o) => o.value), ['a.titre', 'b.titre']);
  choix[0].value = 'b.titre';
  page.parId.propose.value = 'Intitulé';
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  assert.strictEqual(page.messages.filter((m) => m.type === 'enregistrer')[0].cle, 'b.titre',
    'la candidate choisie n’est pas celle qui part');

  // Aucune candidate : le formulaire s'ouvre quand même, le dit, et enregistre sans clé.
  const sansCle = ouvrirFormulaire();
  sansCle.envoyer({
    type: 'valeurs', cible: 'interface', cles: [], langue: 'fr',
    libelles: { langue: 'Français' }, actuel: 'Un texte non identifié'
  });
  assert.ok(sansCle.parId.quoi.textContent.includes(TEXTES_COCKPIT.fr['sugg.cle.inconnue']),
    'rien ne dit que la clé n’a pas été retrouvée');
  assert.strictEqual(sansCle.parId['cle-aide'].hidden, false,
    'aucune explication : le relecteur croira à une panne');
  sansCle.parId.propose.value = 'Un texte identifié';
  sansCle.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = sansCle.messages.filter((m) => m.type === 'enregistrer')[0];
  assert.ok(envoi, 'un texte non identifié ne s’enregistre pas : c’est pourtant celui-là qui compte');
  assert.strictEqual(envoi.cle, '');
});

test('formulaire : une cible absente reste le geste d’avant, sur un article', () => {
  // Un hôte plus ancien — ou un relais qui oublierait la clé — ne doit pas faire passer une
  // suggestion d'article pour une suggestion d'interface.
  const page = ouvrirFormulaire();
  page.envoyer({
    type: 'valeurs', slug: 'mon-article', champ: 'title', langue: 'de',
    libelles: { champ: 'Titre', langue: 'Allemand' }, actuel: 'Alter Titel'
  });
  assert.ok(page.parId.quoi.textContent.includes('mon-article'), 'l’article ne s’affiche plus');
  page.parId.propose.value = 'Neuer Titel';
  page.parId.enregistrer.dispatchEvent({ type: 'click' });
  const envoi = page.messages.filter((m) => m.type === 'enregistrer')[0];
  assert.strictEqual(envoi.slug, 'mon-article');
  assert.strictEqual(envoi.champ, 'title');
  assert.strictEqual(envoi.geste, 'remplacer');
});

// ---- Le mode est-il branché PARTOUT ? ----------------------------------------------
// Contrôle statique, sur les sources de l'hôte : c'est le défaut qu'on vient de réparer.
// Cinq panneaux détournaient leurs clics, quatre fichiers ne le faisaient pas — non par
// choix, mais parce que personne n'avait relu la liste. Rien ne cassait : les panneaux
// oubliés répondaient normalement, mode allumé, et la personne croyait le mode en panne.
// Aucun test de comportement n'aurait pu le voir, puisqu'il ne manquait rien à ce qui
// était branché. Ce contrôle-ci lit le code, retrouve TOUS les gestionnaires de messages
// de panneau, et exige la garde en tête de chacun — sauf les deux qui sont nommés ici,
// avec leur raison. Un panneau neuf entre donc dans la liste tout seul, et ce test tombe
// tant que sa garde n'est pas posée.

// Les deux seuls gestionnaires qui ne détournent JAMAIS, nommés par leur fonction d'accueil.
// Ce n'est pas une dispense de confort : c'est le garde-fou du mode lui-même.
const PANNEAUX_SANS_MODE_TRAD = {
  ouvrirReglages:
    'les réglages : c’est là qu’on éteint le mode. S’ils détournaient leurs clics, on ' +
    'allumerait le mode sans pouvoir l’éteindre.',
  montrerPanneauSuggestion:
    'le formulaire de suggestion : c’est lui que le mode ouvre. Le détourner le rendrait ' +
    'incapable de recevoir la suggestion qu’il demande.'
};

// Les sources de l'hôte : extension.js et lib/. media/ est le côté page, il a ses propres
// contrôles plus bas ; node_modules n'est pas à nous.
function sourcesHote() {
  const liste = [];
  for (const f of fs.readdirSync(COCKPIT)) {
    if (f.endsWith('.js')) { liste.push(path.join(COCKPIT, f)); }
  }
  const lib = path.join(COCKPIT, 'lib');
  for (const f of fs.readdirSync(lib)) {
    if (f.endsWith('.js')) { liste.push(path.join(lib, f)); }
  }
  return liste;
}

// Chaque `webview.onDidReceiveMessage(` d'un fichier, avec le nom de la fonction de premier
// niveau qui l'entoure (c'est ce nom qui sert d'identité : le viewType du panneau n'est pas
// toujours une chaîne littérale — ouvrirVueEnsemble passe `def.id`).
function gestionnairesDe(chemin) {
  const lignes = fs.readFileSync(chemin, 'utf8').split('\n');
  const trouves = [];
  let fonction = '(hors fonction)';
  for (let i = 0; i < lignes.length; i++) {
    const m = /^(?:async )?function ([A-Za-z0-9_$]+)/.exec(lignes[i]);
    if (m) { fonction = m[1]; }
    if (/webview\.onDidReceiveMessage\(/.test(lignes[i])) {
      trouves.push({
        fichier: path.relative(COCKPIT, chemin).replace(/\\\\/g, '/'),
        fonction: fonction,
        ligne: i + 1,
        // La garde se pose en tête : après le `if (!msg)` et son commentaire de deux
        // lignes, jamais plus loin. Six lignes laissent la marge, pas un traitement.
        tete: lignes.slice(i, i + 6).join('\n')
      });
    }
  }
  return trouves;
}

test('mode trad : tout panneau détourne ses clics, sauf les deux gardiens du mode', () => {
  const tous = [];
  for (const chemin of sourcesHote()) { tous.push(...gestionnairesDe(chemin)); }

  assert.ok(tous.length >= 12,
    `seulement ${tous.length} gestionnaires de panneau trouvés : le balayage ne lit plus les sources`);

  const manquants = [];
  const detournentATort = [];
  for (const g of tous) {
    const garde = /repondreModeTrad\(panneau, msg\)\) \{ return; \}/.test(g.tete);
    const exclu = Object.prototype.hasOwnProperty.call(PANNEAUX_SANS_MODE_TRAD, g.fonction);
    if (exclu && garde) { detournentATort.push(`${g.fichier}:${g.ligne} (${g.fonction})`); }
    if (!exclu && !garde) { manquants.push(`${g.fichier}:${g.ligne} (${g.fonction})`); }
  }

  assert.deepStrictEqual(manquants, [],
    'ces panneaux ne détournent pas leurs clics : mode allumé, ils répondront normalement et ' +
    'la personne croira le mode en panne. Posez la garde en tête du gestionnaire, ou nommez le ' +
    'panneau dans PANNEAUX_SANS_MODE_TRAD avec sa raison.');

  assert.deepStrictEqual(detournentATort, [],
    'un panneau dispensé détourne quand même ses clics : c’est le garde-fou du mode qui saute.');

  // Les deux dispenses doivent encore correspondre à un panneau réel : une fonction renommée
  // laisserait une dispense muette, et le vrai panneau passerait sans garde ni alerte.
  const noms = new Set(tous.map((g) => g.fonction));
  for (const nom of Object.keys(PANNEAUX_SANS_MODE_TRAD)) {
    assert.ok(noms.has(nom),
      `${nom} ne crée plus de panneau : sa dispense ne protège plus rien, retirez-la ou corrigez le nom`);
  }
});

test('mode trad : un module non configuré ne détourne rien', () => {
  // Les modules de lib/ ne voient pas extension.js : ils reçoivent repondreModeTrad par
  // configurer(). Le défaut doit rendre faux — sans quoi un test qui require un module seul
  // se mettrait à détourner des clics, et l'hôte réel qui oublie de le configurer aussi.
  for (const f of ['metadonnees-hote.js', 'documentation-hote.js', 'medias-hote.js', 'apercu.js']) {
    const src = fs.readFileSync(path.join(COCKPIT, 'lib', f), 'utf8');
    assert.match(src, /repondreModeTrad: \(\) => false/,
      `lib/${f} : pas de défaut repondreModeTrad, un module non configuré détournerait`);
    assert.match(src, /ctx\.repondreModeTrad\(panneau, msg\)/,
      `lib/${f} : la garde n’appelle pas le rappel du ctx`);
  }
  // Et l'hôte les configure tous les quatre.
  const ext = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  const branchements = ext.match(/^ {2}repondreModeTrad: \(panneau, msg\) => repondreModeTrad\(panneau, msg\)$/gm) || [];
  assert.strictEqual(branchements.length, 4,
    'extension.js ne pose pas le rappel dans les quatre configurer() : un module resterait muet');
});
