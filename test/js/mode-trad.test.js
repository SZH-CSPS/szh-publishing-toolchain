// Mode « Trad » : le clic détourné, l'index qui retrouve la clé d'un texte, et le dossier où
// vont les suggestions sur les libellés de l'outil.
//
// Ce que ce fichier vérifie :
//   * Le mode ne peut pas s'enfermer. Il détourne tous les clics : si l'onglet Paramètres de
//     l'Accueil détournait les siens, on ne pourrait plus l'éteindre qu'en éditant
//     C:\ProgramData\SZH\config.json, et aucune capture d'écran ne le montrerait. La barre
//     d'onglets de l'Accueil et l'onglet Paramètres sont exemptés (data-trad-exempt), le
//     reste de l'Accueil détourne, et le formulaire de suggestion ne détourne jamais.
//   * Le mode se voit : un bandeau et son bouton de sortie, vérifiés dans la vraie page.
//     Sinon un outil dont aucun bouton ne répond passe pour cassé.
//   * Sans message de l'hôte, aucun clic ne change de sens ; une clé absente n'allume pas le
//     mode.
//   * L'index : un texte à trou retrouvé par son motif, un texte partagé par deux libellés
//     qui rend deux candidates (l'outil ne tranche pas), et un texte inconnu qui ouvre quand
//     même le formulaire. La copie de la recherche dans media/_commun.js rend exactement ce
//     que rend le module.
//   * Un fichier de suggestion sans champ `cible` se relit « article », comme pour `geste` :
//     le schéma reste /1.
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

// Le config.json factice posé par dom-minimal, à remettre après chaque test qui détourne
// SZH_CONFIG_OJS. Sinon lib/i18n.js lirait le config.json du poste : réglé en allemand, il
// ferait échouer les tests qui comparent à un libellé français.
const CONFIG_HARNAIS = process.env.SZH_CONFIG_OJS;

// ---- L'index ----------------------------------------------------------------------

test('index : un texte affiché tel quel retrouve sa clé', () => {
  const index = ix.construireIndex({ 'a.titre': 'Métadonnées du numéro', 'b.x': 'Annuler' });
  assert.deepStrictEqual(ix.trouverCles(index, 'Métadonnées du numéro'), ['a.titre']);
  // Les espaces du HTML ne comptent pas : un libellé sur deux lignes dans un gabarit arrive à
  // l'écran avec des retours et de l'indentation, et l'insécable des libellés n'est pas
  // l'espace que le DOM rend.
  assert.deepStrictEqual(ix.trouverCles(index, '  Métadonnées\n  du numéro '), ['a.titre']);
});

test('index : un texte à trou est retrouvé par son MOTIF', () => {
  const index = ix.construireIndex({ 'statut.build.de': 'Compilation de « {0} »…' });
  assert.strictEqual(index.motifs.length, 1, 'le motif n’a pas été retenu');
  assert.deepStrictEqual(index.motifs[0].parts, ['Compilation de « ', ' »…']);
  assert.deepStrictEqual(ix.trouverCles(index, 'Compilation de « mon-article »…'),
    ['statut.build.de'], 'le texte rempli ne retrouve pas son gabarit');
  // Le trou vaut au moins un caractère : sinon le motif reconnaîtrait le gabarit amputé, qui
  // est un autre texte.
  assert.deepStrictEqual(ix.trouverCles(index, 'Compilation de «  »…'), []);
  // Il ne reconnaît pas ce qui ne commence ni ne finit comme lui.
  assert.deepStrictEqual(ix.trouverCles(index, 'Compilation de « x » terminée'), []);
});

test('index : un motif à part fixe trop courte n’entre pas dans l’index', () => {
  // « {0} : {1} » reconnaîtrait toute ligne à deux-points de l'interface : ce motif est écarté.
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
  // Un libellé réel, pris dans la table.
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
  // Le nom du fichier dit la clé et la langue.
  assert.match(s.fichier, /^\d{8}-\d{6}-regl\.titre-fr\.json$/);
  // Une suggestion d'interface ne concerne aucun numéro.
  const brut = JSON.parse(fs.readFileSync(s.chemin, 'utf8'));
  for (const absent of ['produit', 'numero', 'article', 'champ']) {
    assert.ok(!(absent in brut), 'champ d’article dans une suggestion d’interface : ' + absent);
  }
  // Un mode d'emploi est posé dans le dossier.
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
  // Une suppression n'a pas de texte proposé : elle passe.
  assert.ok(sugg.ecrireSuggestionInterface(dossier, {
    cle: 'a.b', langue: 'fr', geste: 'supprimer', actuel: 'Annuler', propose: '', commentaire: ''
  }).ok, 'une proposition de suppression a été prise pour un formulaire vide');
});

test('un fichier écrit avant le champ « cible » se relit « article »', () => {
  // Un fichier de la première version du format : pas de clé « cible ».
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
// Entre le réglage sur le disque et un clic détourné, il y a cinq relais : l'hôte lit le
// réglage, la page le demande, l'hôte répond avec l'index, la page branche son écoute, le clic
// repart. Un seul relais muet et le mode ne fait rien ; seul un test sur la page le voit.

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

// La vue d'ensemble : la plus simple des pages qui détournent, sans libellé attendu de l'hôte.
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
// La demande du mode voyage avec le « pret » : une page qui ne la porte pas ne reçoit pas
// l'index.
const demande = (page) => page.messages.some((m) => m.type === 'pret' && m.modeTrad === true);
// Les clés postées, recopiées : la page les fabrique dans son propre contexte.
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
  // La recherche de la page rend exactement ce que rend le module.
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
  // D'abord sans message de l'hôte : l'état normal d'un poste.
  const muet = ouvrirVue();
  cliquer(muet, poserBouton(muet, 'Ouvrir l’article'));
  assert.strictEqual(detournes(muet).length, 0, 'un panneau détourne sans que le mode soit allumé');
  // Puis avec un « éteint » explicite : une clé absente n'allume pas le mode.
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
  // Une ligne avec son texte et un pictogramme : on clique le pictogramme, et c'est le texte
  // de la ligne qu'on relit, pas celui de toute la page.
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

  // La valeur d'un champ de saisie n'est pas un libellé de l'outil : elle ne part pas en
  // suggestion.
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
  // Éteint, le bandeau disparaît.
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
  // Le panneau redevient cliquable tout de suite, sans attendre la réponse de l'hôte.
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

// ---- Les réglages restent toujours cliquables ------------------------------------------

// L'Accueil détourne ses clics, sauf sa barre d'onglets et l'onglet Paramètres
// (data-trad-exempt) : on peut toujours éteindre le mode.
const { ouvrirReglages: ouvrirParametres } = require('./page-reglages');

test('accueil : la barre d’onglets et l’onglet Paramètres ne détournent rien, mode allumé compris', () => {
  const p = ouvrirParametres();
  const page = p.page;
  // L'Accueil demande l'état du mode comme tout panneau : c'est l'hôte qui décide.
  assert.ok(demande(page), 'l’Accueil ne demande pas l’état du mode : l’index ne lui viendrait jamais');
  allumer(page);
  assert.strictEqual(bandeaux(page), 1, 'aucun bandeau dans l’Accueil : il ne dit pas qu’il est détourné');
  const radios = p.tous('input');
  assert.ok(radios.length > 0, 'l’onglet Paramètres n’a pas rendu ses groupes');
  cliquer(page, radios[0]);
  assert.strictEqual(detournes(page).length, 0,
    'ON NE PEUT PLUS ÉTEINDRE LE MODE : l’onglet Paramètres détourne ses propres clics');
  // La barre d'onglets non plus : sinon on ne pourrait pas rejoindre Paramètres.
  cliquer(page, p.parId('onglet-reglages'));
  assert.strictEqual(detournes(page).length, 0,
    'ON NE PEUT PLUS REJOINDRE LES PARAMÈTRES : la barre d’onglets détourne ses clics');
  // Le reste de l'Accueil est détourné.
  cliquer(page, poserBouton(page, 'Ouvrir l’article'));
  assert.strictEqual(detournes(page).length, 1,
    'hors barre d’onglets et Paramètres, l’Accueil ne détourne pas ses clics');
});

test('réglages : le mode s’allume et s’éteint depuis un vrai bouton radio', () => {
  const p = ouvrirParametres();
  const choix = p.tous('input').filter((i) => i.name === 'modeTrad');
  assert.strictEqual(choix.length, 2,
    'le mode « Trad » n’a pas de réglage : il ne s’allumerait nulle part');
  const actif = choix.filter((i) => i.value === 'actif')[0];
  assert.ok(actif, 'pas d’option « actif » pour le mode « Trad »');
  actif.checked = true;
  actif.dispatchEvent({ type: 'change' });
  assert.ok(p.messages.some((m) => m.type === 'regler' && m.cle === 'modeTrad' && m.valeur === 'actif'),
    'le choix ne part pas à l’hôte ; messages : ' + JSON.stringify(p.messages));
});

test('réglages : les suggestions d’interface se comptent et leur dossier s’ouvre', () => {
  const p = ouvrirParametres();
  const libelle = TEXTES_COCKPIT.fr['regl.suggInterface.ouvrir'];
  const boutons = p.tous('button').filter((b) => b.textContent === libelle);
  assert.strictEqual(boutons.length, 1,
    'aucun bouton pour ouvrir le dossier : les suggestions seraient écrites et jamais relues');
  boutons[0].dispatchEvent({ type: 'click' });
  assert.ok(p.messages.some((m) => m.type === 'suggestionsInterface'),
    'le bouton est muet ; messages : ' + JSON.stringify(p.messages));
  // Le compte arrive avec les valeurs et s'affiche en toutes lettres.
  p.envoyer({ type: 'valeurs', valeurs: {}, suggInterface: 3 });
  const dit = TEXTES_COCKPIT.fr['accueil.regl.sugg.plus'].split('{0}').join('3');
  assert.ok(p.panneau.textContent.includes(dit),
    'le compte des suggestions ne s’affiche pas : ' + JSON.stringify(dit));
});

// ---- Le formulaire de suggestion ne détourne pas non plus ------------------------------

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
  // Un hôte plus ancien, ou un relais qui oublierait la clé, ne doit pas faire passer une
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

// ---- Le mode est-il branché partout ? ----------------------------------------------
// Contrôle statique sur les sources de l'hôte. Un panneau sans garde répond normalement,
// mode allumé, et la personne croit le mode en panne ; aucun test de comportement ne le
// voit. Ce contrôle retrouve tous les gestionnaires de messages de panneau et exige la garde
// en tête de chacun, sauf ceux nommés ci-dessous. Un nouveau panneau entre dans la liste
// tout seul.

// Les seuls gestionnaires qui ne détournent jamais, nommés par leur fonction d'accueil.
const PANNEAUX_SANS_MODE_TRAD = {
  montrerPanneauSuggestion:
    'le formulaire de suggestion : c’est lui que le mode ouvre. Le détourner le rendrait ' +
    'incapable de recevoir la suggestion qu’il demande.',
  montrerNouveautes:
    '« Quoi de neuf » : son texte ne vient pas de l’i18n mais de nouveautes.json, livré ' +
    'avec le toolkit. Une suggestion de traduction prise ici n’aurait aucune clé où ' +
    'aller. La page n’a d’ailleurs aucun libellé cliquable — elle se lit, et son seul ' +
    'message vers l’hôte est « je suis prête ».'
};

// Les sources de l'hôte : extension.js et lib/. media/ est le côté page, contrôlé plus bas.
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

// Chaque `webview.onDidReceiveMessage(` ou `panneauUnique({` d'un fichier, avec le nom de la
// fonction de premier niveau qui l'entoure. Ce nom sert d'identité : le viewType n'est pas
// toujours une chaîne littérale (ouvrirVueEnsemble passe `def.id`).
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
        // La garde se pose en tête, après le `if (!msg)` et son commentaire de deux lignes :
        // six lignes laissent la marge.
        garde: /repondreModeTrad\(panneau, msg\)\) \{ return; \}/.test(lignes.slice(i, i + 6).join('\n'))
      });
    }
    // Un panneau de la fabrique (lib/webviews/panneau.js) : la garde est son option
    // `modeTrad`, traitée avant tout autre message. Les options s'arrêtent à la ligne qui
    // referme l'appel, à la même indentation.
    if (/panneauUnique\(\{/.test(lignes[i])) {
      const retrait = /^\s*/.exec(lignes[i])[0];
      let fin = i + 1;
      while (fin < lignes.length && !lignes[fin].startsWith(retrait + '}')) { fin++; }
      trouves.push({
        fichier: path.relative(COCKPIT, chemin).replace(/\\\\/g, '/'),
        fonction: fonction,
        ligne: i + 1,
        garde: /^\s*modeTrad: \(panneau, msg\) => (ctx\.)?repondreModeTrad\(panneau, msg\),?$/m
          .test(lignes.slice(i, fin).join('\n'))
      });
    }
  }
  return trouves;
}

test('mode trad : tout panneau détourne ses clics, sauf ceux que le mode exclut', () => {
  const tous = [];
  for (const chemin of sourcesHote()) { tous.push(...gestionnairesDe(chemin)); }

  assert.ok(tous.length >= 12,
    `seulement ${tous.length} gestionnaires de panneau trouvés : le balayage ne lit plus les sources`);

  const manquants = [];
  const detournentATort = [];
  for (const g of tous) {
    const garde = g.garde;
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

  // Chaque dispense correspond à un panneau réel : une fonction renommée laisserait une
  // dispense muette, et le panneau passerait sans garde.
  const noms = new Set(tous.map((g) => g.fonction));
  for (const nom of Object.keys(PANNEAUX_SANS_MODE_TRAD)) {
    assert.ok(noms.has(nom),
      `${nom} ne crée plus de panneau : sa dispense ne protège plus rien, retirez-la ou corrigez le nom`);
  }
});

test('mode trad : les modules de lib/ prennent la garde à lib/traduction-hote.js', () => {
  // Les modules de lib/ ne voient pas extension.js : leur rappel repondreModeTrad est par
  // défaut celui de lib/traduction-hote.js.
  for (const f of ['metadonnees-hote.js', 'documentation-hote.js', 'medias-hote.js', 'table-hote.js', 'apercu.js', 'vue-articles-hote.js']) {
    const src = fs.readFileSync(path.join(COCKPIT, 'lib', f), 'utf8');
    assert.match(src, /repondreModeTrad: require\('\.\/traduction-hote'\)\.repondreModeTrad/,
      `lib/${f} : la garde ne vient pas de lib/traduction-hote.js`);
    assert.match(src, /ctx\.repondreModeTrad\(panneau, msg\)/,
      `lib/${f} : la garde n’appelle pas le rappel du ctx`);
  }
  // L'hôte ne les relaie pas par une lambda : la garde est celle du module.
  const ext = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  const relais = ext.match(/^ {2}repondreModeTrad: \(panneau, msg\) => repondreModeTrad\(panneau, msg\)$/gm) || [];
  assert.strictEqual(relais.length, 0, 'extension.js relaie encore repondreModeTrad à un module de lib/');
});
