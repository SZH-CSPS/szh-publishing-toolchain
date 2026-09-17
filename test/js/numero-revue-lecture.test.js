// Le nom de la revue, dans le formulaire « Métadonnées du numéro » : affiché, plus saisi.
//
//   node --test "test/js/*.test.js"
//
// Un numéro est créé dans l'une ou l'autre des deux revues — windows/new-revue.ps1 écrit le
// jeton `revue:` à la création, et l'ISSN, la langue par défaut, le volume, la couleur
// annuelle et le lanceur qui listera le numéro en découlent. Le formulaire offrait un choix
// entre les deux (deux boutons radio) : le changer après coup déplaçait un numéro d'une
// revue à l'autre sans que rien d'autre ne suive. Le champ est donc devenu un texte
// (media/_numero.js, champLecture), et ne repart plus jamais à l'hôte.
//
// Ce que ce fichier garde : le nom complet de la revue s'affiche, une valeur vide ou hors
// liste affiche un tiret cadratin plutôt qu'un champ muet, et surtout — c'est le contrôle
// qui compte — le formulaire ne peut plus envoyer la clé `revue` à l'hôte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ouvrir, libellesHote, chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { T } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));

// lib/metadonnees-hote.js ne se charge pas par chargerAvecVscodeFactice tel quel : il tire
// lib/cycle-vie.js, qui construit un vscode.EventEmitter au chargement du module — plus que
// ce que le faux « vscode » minimal de dom-minimal.js fournit (voir son commentaire :
// workspace/env seulement). libellesHote() n'en tire que les libellés PLATS (« nom: T(...) »
// littéral) d'une fonction ; `libelles`, la table indexée par clé i18n que lit
// media/_numero.js (fonction lib()), est un objet CONSTRUIT par une boucle
// (`for (const cle of LIBELLES_NUMERO) { libelles[cle] = T(cle); }`) et n'est donc pas vu
// par cette extraction textuelle — contrats.test.js le documente aussi (liste TABLES). On la
// reconstruit ici à la main, avec exactement les clés de LIBELLES_NUMERO
// (lib/metadonnees-hote.js) : les mêmes que celles que CHAMPS (media/_numero.js) résout par
// lib(champ.libelle) pour le formulaire du numéro.
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

// Le formulaire vit dans <div id="numero">, jamais rattaché à <body> dans ce harnais (voir
// dom-minimal.js, ouvrir() : racineDom() ne connaît que cartes/sections/corps/lignes). On le
// prend donc par son identifiant, comme la page elle-même (document.getElementById('numero')).
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

// ---- Le contrôle qui compte : le formulaire ne renvoie plus jamais le jeton ----

test('le formulaire n’envoie jamais la clé revue à l’hôte, même après avoir touché un autre champ', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'zeitschrift', title: 'Un dossier' } });
  const conteneur = conteneurNumero(page);

  // On touche un autre champ, pour que l'enregistrement ait quelque chose à envoyer — un
  // formulaire qui n'a rien à dire ne prouverait rien sur ce qu'il tairait le cas échéant.
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

test('aucun élément du formulaire ne porte un contrôle modifiable pour la revue', () => {
  const page = ouvrirNumero();
  page.envoyer({ type: 'valeurs', valeurs: { revue: 'revue', title: 'Un dossier' } });
  const conteneur = conteneurNumero(page);
  // Ni <input>, ni <select> : le seul élément portant data-cle="revue" est le <p> de lecture
  // posé par champLecture, qui ne porte ni value ni gestionnaire de saisie.
  const controles = conteneur.querySelectorAll(
    'input[data-cle="revue"], select[data-cle="revue"], textarea[data-cle="revue"]');
  assert.strictEqual(controles.length, 0, 'un contrôle de saisie porte encore data-cle="revue"');
});
