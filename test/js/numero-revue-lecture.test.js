// Le nom de la revue dans le formulaire « Métadonnées du numéro » : affiché, pas saisi.
//
// Un numéro appartient à l'une des deux revues dès sa création (windows/new-revue.ps1 écrit
// `revue:`) ; l'ISSN, la langue par défaut, le volume, la couleur annuelle et le lanceur qui
// liste le numéro en découlent. Changer la revue après coup déplacerait le numéro sans que le
// reste suive : le champ est donc un texte (media/_numero.js, champLecture), jamais renvoyé à
// l'hôte.
//
// Contrôles : le nom complet de la revue s'affiche, une valeur vide ou hors liste affiche un
// tiret cadratin, et le formulaire n'envoie pas la clé `revue` à l'hôte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { T } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

// lib/metadonnees-hote.js ne se charge pas par chargerAvecVscodeFactice : il tire
// lib/cycle-vie.js, qui construit un vscode.EventEmitter au chargement, absent du faux vscode
// de dom-minimal.js (workspace/env seulement). libellesHote() n'extrait que les libellés
// écrits « nom: T(...) » ; `libelles`, la table par clé i18n que lit media/_numero.js (lib()),
// est construite par une boucle sur LIBELLES_NUMERO et échappe à cette extraction (voir la
// liste TABLES de contrats.test.js). On la reconstruit ici avec les clés de LIBELLES_NUMERO
// (lib/metadonnees-hote.js), celles que CHAMPS (media/_numero.js) résout par
// lib(champ.libelle).
const LIBELLES_NUMERO = ['meta.title', 'meta.revue', 'meta.revue.zeitschrift', 'meta.revue.revue',
  'meta.volume', 'meta.numero', 'meta.date', 'meta.langue', 'meta.langue.aucune',
  'meta.langue.fr', 'meta.langue.de', 'meta.langue.en', 'meta.langue.it',
  'meta.couleur', 'meta.entete.condensee'];

function txtNumero() {
  const txt = libellesHote(RACINE, ['textesNumero']);
  const libelles = {};
  for (const cle of LIBELLES_NUMERO) { libelles[cle] = T(cle); }
  txt.libelles = libelles;
  return txt;
}

function ouvrirNumero() {
  return ouvrir({
    racine: RACINE, page: 'metadata-issue',
    cssPartage: ['_design.css', '_numero.css'], jsPartage: ['_messages.js', '_numero.js'],
    txt: txtNumero()
  });
}

// Le formulaire vit dans <div id="numero">, que ce harnais ne rattache pas à <body> (voir
// ouvrir() dans dom-minimal.js : racineDom() ne connaît que cartes/sections/corps/lignes). On
// le prend par son identifiant, comme la page.
function conteneurNumero(page) { return page.parId.numero; }

test('la page s’annonce et son formulaire est en place', () => {
  const page = ouvrirNumero();
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'], 'la page ne s’annonce pas');
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'revue', title: 'Un dossier' } });
  assert.ok(conteneurNumero(page).enfants.length > 0, 'le formulaire n’a rien posé dans #numero');
});

test('revue: zeitschrift affiche le nom complet de la Zeitschrift, sans aucun bouton radio', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'zeitschrift', title: 'Un dossier' } });
  const conteneur = conteneurNumero(page);
  assert.strictEqual(conteneur.querySelectorAll('input[type="radio"]').length, 0,
    'un bouton radio subsiste : le nom de la revue reste saisissable');
  assert.ok(conteneur.textContent.indexOf(T('meta.revue.zeitschrift')) !== -1,
    'le nom complet de la Zeitschrift n’est pas dans le texte de la page');
  assert.strictEqual(conteneur.textContent.indexOf(T('meta.revue.revue')), -1,
    'le nom de l’autre revue apparaît alors que le jeton dit « zeitschrift »');
});

test('revue: revue affiche l’autre nom complet', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'revue', title: 'Un dossier' } });
  const conteneur = conteneurNumero(page);
  assert.strictEqual(conteneur.querySelectorAll('input[type="radio"]').length, 0,
    'un bouton radio subsiste : le nom de la revue reste saisissable');
  assert.ok(conteneur.textContent.indexOf(T('meta.revue.revue')) !== -1,
    'le nom complet de la Revue n’est pas dans le texte de la page');
  assert.strictEqual(conteneur.textContent.indexOf(T('meta.revue.zeitschrift')), -1,
    'le nom de l’autre revue apparaît alors que le jeton dit « revue »');
});

test('une valeur vide ou hors liste affiche un demi-cadratin, pas un champ muet', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: '', title: 'Un dossier' } });
  const champ = conteneurNumero(page).querySelectorAll('[data-cle="revue"]')[0];
  assert.ok(champ, 'le champ revue (lecture) est introuvable');
  assert.strictEqual(champ.textContent, '–', 'une revue vide n’affiche pas le demi-cadratin attendu');

  const page2 = ouvrirNumero();
  page2.envoyer({ type: 'valeurs', valeurs: { revue: 'quelquechose-hors-liste', title: 'Un dossier' } });
  const champ2 = conteneurNumero(page2).querySelectorAll('[data-cle="revue"]')[0];
  assert.strictEqual(champ2.textContent, '–',
    'une revue hors liste n’affiche pas le demi-cadratin attendu');
});

// ---- Le formulaire ne renvoie jamais le jeton ----

test('le formulaire n’envoie jamais la clé revue à l’hôte, même après avoir touché un autre champ', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'zeitschrift', title: 'Un dossier' } });
  const conteneur = conteneurNumero(page);

  // On modifie un autre champ, pour que l'enregistrement ait quelque chose à envoyer.
  const champTitre = conteneur.querySelectorAll('input[data-cle="title"]')[0];
  assert.ok(champTitre, 'le champ titre est introuvable');
  champTitre.value = 'Un autre titre';
  champTitre.dispatchEvent({ type: 'input' });

  const bouton = page.parId.enregistrer;
  assert.ok(bouton, 'le bouton « Enregistrer » est introuvable');
  bouton.dispatchEvent({ type: 'click' });

  const envois = page.messages.filter((m) => m.type === 'enregistrer');
  assert.strictEqual(envois.length, 1, 'l’enregistrement n’a pas été envoyé');
  assert.ok(!('revue' in envois[0].modifies),
    'la clé revue est repartie vers l’hôte : le jeton reste modifiable en pratique');
  assert.strictEqual(envois[0].modifies.title, 'Un autre titre', 'le champ touché, lui, n’est pas parti');
});

// « numero » reçoit le focus des constats qui en portent un (meta/champ-vide, sans-langue…) :
// le champ visé reçoit le curseur, comme pour la fiche (focaliser(), media/_numero.js). Un
// focus qui ne correspond à aucune clé de CHAMPS ne fait rien, sans erreur.
test('focus amène le champ visé à l’écran et lui pose le curseur', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'revue', title: 'Un dossier' }, focus: 'title' });
  const champ = conteneurNumero(page).querySelectorAll('[data-cle="title"]')[0];
  assert.ok(champ, 'le champ titre est introuvable');
  assert.strictEqual(champ._focused, true, 'le champ titre n’a pas reçu le curseur');
  assert.strictEqual(champ._scrolled, true, 'le champ titre n’a pas été amené à l’écran');
});

test('un focus qui ne correspond à aucune clé ne focalise rien, sans lever', () => {
  const page = ouvrirNumero();
  // « pièce »/« chapitre » : focusChamp du formulaire du livre-dans-un-numéro
  // (livre/liminaire-introuvable, livre/chapitre-introuvable), absents de CHAMPS.
  assert.doesNotThrow(() => page.envoyer({
    type: 'valeurs', valeurs: { revue: 'revue', title: 'Un dossier' }, focus: 'pièce'
  }));
  const rien = conteneurNumero(page).querySelectorAll('input, select, textarea')
    .every((e) => !e._focused);
  assert.ok(rien, 'un focus inconnu a quand même focalisé un champ du formulaire du numéro');
});

test('aucun élément du formulaire ne porte un contrôle modifiable pour la revue', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'revue', title: 'Un dossier' } });
  const conteneur = conteneurNumero(page);
  // Ni <input> ni <select> : le seul élément data-cle="revue" est le <p> posé par
  // champLecture, sans value ni gestionnaire de saisie.
  const controles = conteneur.querySelectorAll(
    'input[data-cle="revue"], select[data-cle="revue"], textarea[data-cle="revue"]');
  assert.strictEqual(controles.length, 0, 'un contrôle de saisie porte encore data-cle="revue"');
});
