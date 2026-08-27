// Le portrait d'auteur·e : une image décorative, sans texte alternatif, et qui n'est
// PAS un <img>.
//
//   node --test "test/js/*.test.js"
//
// Deux décisions sont gardées ici, et elles tiennent ensemble :
//
//   * Pas de texte alternatif. Le filtre en fabriquait un depuis le nom de la personne
//     (« Portrait de X », « Porträt von X »), quel qu'en soit le contenu réel du fichier :
//     un logo, une photo de groupe ou une photo appariée à la mauvaise personne faisaient
//     affirmer une identité fausse à un lecteur d'écran. Et le nom est déjà écrit à côté,
//     dans le bloc « Autrices et auteurs » : un alt qui le répète est du bruit.
//   * Donc pas d'<img>. WeasyPrint 69 balise tout <img> en /Figure, même avec
//     role="presentation", même avec aria-hidden="true" (mesuré par cas minimal) : une
//     /Figure sans /Alt viole PDF/UA-1 7.3, et `make verifier-ua` la refuse. Le portrait
//     est donc un <span> vide à fond CSS, comme l'image décorative d'article.
//
// Mesuré sur un numéro à un auteur et un numéro à quatre, portraits réels : /Figure
// passe de 1 et 4 à 0, /Alt de 1 et 4 à 0, le rendu PNG est identique au pixel sur les
// 15 pages, et les deux PDF restent conformes PDF/UA-1.
//
// Ce qui se casserait sans ces contrôles : quelqu'un « simplifie » le balisage en
// remettant un <img>, ce qui est déjà arrivé deux fois, et la porte PDF/UA se referme sur
// le premier numéro à portraits.
//
// ⚠ Le bloc auteurs a quitté le gabarit : c'est filters/szh-auteurs.lua qui l'écrit
//   désormais, pour pouvoir l'insérer DEVANT la bibliographie — un gabarit ne sait rien
//   intercaler. Les contrôles de balisage lisent donc le filtre ; seul le <style> des
//   portraits est resté dans l'en-tête du gabarit, et il y est contrôlé à part.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

const MAQUETTE = lire('pipeline', 'filters', 'szh-maquette.lua');
const GABARIT = lire('pipeline', 'templates', 'szh-article.html');
const AUTEURS = lire('pipeline', 'filters', 'szh-auteurs.lua');
const CSS = lire('pipeline', 'styles', 'print.css');

// Le code du filtre qui ÉCRIT le balisage, en-tête de commentaires exclu : ces
// commentaires parlent d'<img> et d'alt pour dire de ne pas les remettre, et les
// contrôles ci-dessous les prendraient pour le retour en arrière qu'ils interdisent.
const BLOC_AUTEURS = (() => {
  const d = AUTEURS.indexOf('local function bloc_auteur');
  assert.ok(d > 0, 'bloc_auteur a disparu de szh-auteurs.lua : plus rien n’écrit le bloc');
  return AUTEURS.slice(d);
})();

// Et le gabarit ne doit plus l'écrire : les deux ensemble donneraient le bloc en double.
test('portrait : le gabarit n’écrit plus le bloc auteurs', () => {
  assert.doesNotMatch(GABARIT, /<section class="szh-auteurs">/,
    'le bloc auteurs est revenu dans le gabarit : il s’imprimerait deux fois, et celui du gabarit repasserait après la bibliographie');
});

// ---- Aucun texte alternatif n'est fabriqué ----

test('portrait : le filtre ne fabrique plus de texte alternatif', () => {
  assert.doesNotMatch(MAQUETTE, /ALT_PORTRAIT/,
    'ALT_PORTRAIT est revenu : le portrait affirmerait de nouveau une identité que le fichier ne garantit pas');
  assert.doesNotMatch(MAQUETTE, /photo-alt/,
    'la clé photo-alt est revenue dans szh-maquette.lua');
  assert.doesNotMatch(MAQUETTE, /Portrait de |Porträt von |Ritratto di /,
    'un préfixe de texte alternatif de portrait subsiste dans szh-maquette.lua');
  assert.doesNotMatch(MAQUETTE, /elision_fr|VOYELLES_ACCENTUEES/,
    'l’élision française ne servait qu’au texte alternatif du portrait : elle doit partir avec lui');
});

test('portrait : ni le gabarit ni le filtre ne portent d’alt de portrait', () => {
  assert.doesNotMatch(GABARIT, /photo-alt/,
    'le gabarit lit encore author.photo-alt, que plus rien n’écrit');
  assert.doesNotMatch(BLOC_AUTEURS, /alt=/,
    'un attribut alt est réapparu dans le bloc auteurs');
});

// ---- Le portrait n'est pas un <img> ----

test('portrait : ce n’est pas un <img>, mais un <span> à fond CSS', () => {
  assert.doesNotMatch(BLOC_AUTEURS, /<img/,
    'le portrait est redevenu un <img> : WeasyPrint le baliserait /Figure, sans /Alt, et la porte PDF/UA le refuserait');
  assert.match(BLOC_AUTEURS,
    /<span class="szh-auteur-photo szh-auteur-photo-%s" role="presentation"><\/span>/,
    'le <span> du portrait n’est plus celui que print.css et szh-maquette.lua attendent');
  assert.match(BLOC_AUTEURS, /a\['photo-rang'\]/,
    'le filtre n’utilise plus le rang calculé par szh-maquette.lua : deux portraits partageraient une règle CSS');
});

test('portrait : le filtre numérote les portraits pour nommer leur règle CSS', () => {
  assert.match(MAQUETTE, /a\['photo-rang'\] = pandoc\.MetaString\(tostring\(rang_photo\)\)/,
    'szh-maquette.lua n’écrit plus photo-rang : le gabarit produirait des classes vides');
  assert.match(MAQUETTE, /local rang_photo = 0/,
    'le compteur de portraits a disparu');
  // Le rang ne se compte que sur les auteurs qui ont une photo : sinon deux auteurs
  // se partageraient une règle, ou une règle serait écrite pour personne.
  assert.match(MAQUETTE, /if S\(a\.photo\) ~= '' then\s*\n\s*rang_photo = rang_photo \+ 1/,
    'le rang n’est plus incrémenté sous la seule condition d’une photo');
});

// ---- L'URL passe par un <style>, seul endroit où --embed-resources la réécrit ----

test('portrait : l’URL de la photo passe par un <style>, pas par un attribut style', () => {
  assert.match(GABARIT,
    /<style>\s*\n\$for\(author\)\$\s*\n\$if\(author\.photo\)\$\s*\n\s*\.szh-auteur-photo-\$author\.photo-rang\$ \{ background-image: url\("\$author\.photo\$"\); \}/,
    'le <style> qui porte les portraits a changé de forme : --embed-resources ne réécrit url() que là');
  assert.doesNotMatch(BLOC_AUTEURS, /style=/,
    'la photo est passée dans un attribut style : --embed-resources n’y touche pas (mesuré), et le galley partirait avec un chemin relatif mort');
  // En-tête et non corps : le reader html de pandoc ignore <head>, donc les règles CSS
  // ne réapparaissent pas en texte clair dans le galley DOCX.
  const tete = GABARIT.slice(0, GABARIT.indexOf('</head>'));
  assert.match(tete, /szh-auteur-photo-\$author\.photo-rang\$/,
    'le <style> des portraits a quitté l’en-tête : ses règles se liraient en clair dans le galley DOCX');
});

// ---- La géométrie, qui doit rendre exactement le même dessin ----

test('portrait : le fond CSS reproduit l’object-fit de l’ancien <img>', () => {
  const regle = CSS.match(/\.szh-auteur-photo \{[^}]*\}/);
  assert.ok(regle, '.szh-auteur-photo a disparu de print.css');
  const r = regle[0];
  assert.match(r, /width: 28mm; height: 28mm;/, 'le portrait a changé de taille');
  assert.match(r, /background-size: cover/, 'sans `cover`, une source non carrée serait déformée');
  assert.match(r, /background-position: center/, 'sans `center`, le recadrage ne serait plus celui de object-fit');
  assert.match(r, /background-repeat: no-repeat/, 'sans `no-repeat`, une source plus petite se répéterait');
  assert.match(r, /display: block/, 'un <span> hors contexte flex serait de taille nulle');
  assert.match(r, /flex-shrink: 0/, 'le portrait se laisserait écraser par un texte long');
  assert.doesNotMatch(r, /object-fit/, 'object-fit ne s’applique qu’à un <img> : sa présence signale un retour en arrière');
});

test('portrait : print.css dit pourquoi ce n’est pas un <img>', () => {
  // Cette phrase est le seul garde-fou contre la « simplification » qui a déjà eu lieu
  // deux fois. Un commentaire qu’on peut supprimer sans rien casser finit supprimé.
  const i = CSS.indexOf('.szh-auteur-photo {');
  const avant = CSS.slice(Math.max(0, i - 1600), i);
  assert.match(avant, /\/Figure/, 'la raison (WeasyPrint balise tout <img> en /Figure) n’est plus écrite près de la règle');
  assert.match(avant, /PDF\/UA-1 7\.3/, 'la règle PDF/UA violée n’est plus nommée');
  assert.match(avant, /role="presentation"/,
    'il n’est plus dit que role="presentation" ne suffit pas — c’est pourtant la première chose qu’on réessaie');
});
