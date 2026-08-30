// Contrats du profil d'ouvrage : ce qui distingue un numéro de revue d'un livre, et ce
// qui doit rester identique entre les deux.
//
//   node --test test/js/profil.test.js
//
// Aucun de ces contrôles ne touche au disque : `detecter` reçoit un prédicat d'existence
// injecté. Une table de vérité se vérifie contre elle-même, pas contre un dossier qui
// pourrait avoir été rangé autrement sur le poste où tourne le test.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const profil = require(path.join(COCKPIT, 'lib', 'profil.js'));

// Un faux disque : la liste des fichiers qui existent.
function disque(chemins) {
  const jeu = new Set(chemins.map((c) => path.normalize(c)));
  return (p) => jeu.has(path.normalize(p));
}

test('profil : un dossier avec ausgabe.yaml est une revue', () => {
  const existe = disque(['/w/2026-03/ausgabe.yaml']);
  const p = profil.detecter('/w/2026-03', { existe });
  assert.equal(p && p.cle, 'revue');
  assert.equal(p.unites.dossier, 'articles');
  assert.equal(p.cible, 'all');
});

test('profil : un dossier avec buch.yaml est un livre', () => {
  const existe = disque(['/w/2026-B330/buch.yaml']);
  const p = profil.detecter('/w/2026-B330', { existe });
  assert.equal(p && p.cle, 'livre');
  assert.equal(p.unites.dossier, 'chapitres');
  assert.equal(p.unites.mot, 'chapitre');
  assert.equal(p.cible, 'livre');
});

test('profil : un dossier sans configuration n’est pas une publication', () => {
  const existe = disque(['/w/ailleurs/notes.md']);
  assert.equal(profil.detecter('/w/ailleurs', { existe }), null);
  assert.equal(profil.detecter(null, { existe }), null);
});

// Le cas qui décide de la cohérence entre l'éditeur et la chaîne. Le Makefile teste
// buch.yaml AVANT de lire le profil d'ausgabe.yaml : si le cockpit tranchait dans l'autre
// sens, il montrerait des chapitres pendant que la compilation produirait des articles.
test('profil : les deux fichiers présents — le livre gagne, comme dans le Makefile', () => {
  const existe = disque(['/w/hybride/ausgabe.yaml', '/w/hybride/buch.yaml']);
  assert.equal(profil.detecter('/w/hybride', { existe }).cle, 'livre');
  assert.equal(profil.ORDRE_DETECTION[0], 'livre');
});

test('profil : la racine est le premier dossier du workspace qui en est une', () => {
  const existe = disque(['/w/b/buch.yaml']);
  const trouve = profil.racineDepuis(
    [{ uri: { fsPath: '/w/a' } }, { uri: { fsPath: '/w/b' } }], { existe });
  assert.equal(trouve.racine, '/w/b');
  assert.equal(trouve.profil.cle, 'livre');
  assert.equal(profil.racineDepuis([], { existe }), null);
  assert.equal(profil.racineDepuis(null, { existe }), null);
});

test('profil : une chaîne de chemin est acceptée comme un dossier de workspace', () => {
  const existe = disque(['/w/r/ausgabe.yaml']);
  assert.equal(profil.racineDepuis(['/w/r'], { existe }).profil.cle, 'revue');
});

test('profil : on remonte d’un fichier jusqu’à sa publication', () => {
  const existe = disque(['/w/livre/buch.yaml']);
  const trouve = profil.remonterVers('/w/livre/chapitres/01-x/01-x.md', { existe });
  // La racine est rendue telle que `path.dirname` l'a produite, séparateurs compris : la
  // fonction ne normalise pas ce qu'on lui a donné, elle ne fait que remonter.
  assert.equal(trouve.racine, '/w/livre');
  assert.equal(trouve.profil.cle, 'livre');
});

test('profil : la remontée s’arrête plutôt que de boucler', () => {
  const existe = disque([]);
  assert.equal(profil.remonterVers('/w/a/b/c/d.md', { existe }), null);
  // Une limite basse ne doit pas jeter : elle rend null, comme une absence.
  assert.equal(profil.remonterVers('/w/a/b/c/d.md', { existe }, 1), null);
});

// Les chemins d'une unité. C'est cette fonction qui remplace les path.join littéraux
// semés dans extension.js : si elle ment, tout ce qui l'appelle ment avec elle.
test('profil : les chemins d’un article', () => {
  const c = profil.chemins('revue', '/w/2026-03', 'mon-article');
  assert.equal(c.md, path.join('/w/2026-03', 'articles', 'mon-article', 'mon-article.md'));
  assert.equal(c.meta, path.join('/w/2026-03', 'articles', 'mon-article', 'mon-article.meta.yaml'));
  assert.equal(c.media, path.join('/w/2026-03', 'articles', 'mon-article', 'media'));
  assert.equal(c.depot, path.join('/w/2026-03', 'articles-word'));
  assert.equal(c.config, path.join('/w/2026-03', 'ausgabe.yaml'));
});

test('profil : les chemins d’un chapitre', () => {
  const c = profil.chemins('livre', '/w/2026-B330', '01-einleitung');
  assert.equal(c.md, path.join('/w/2026-B330', 'chapitres', '01-einleitung', '01-einleitung.md'));
  assert.equal(c.tables, path.join('/w/2026-B330', 'chapitres', '01-einleitung', 'tables'));
  assert.equal(c.depot, path.join('/w/2026-B330', 'chapitres-word'));
  assert.equal(c.config, path.join('/w/2026-B330', 'buch.yaml'));
});

// La différence de sortie est la seule qui compte vraiment : un article a son PDF, un
// chapitre n'a qu'un fragment — le PDF est celui du livre entier.
test('profil : un article a son dossier de sortie, un chapitre n’a qu’un fragment', () => {
  assert.equal(profil.chemins('revue', '/w/r', 'a').outUnite, path.join('/w/r', 'out', 'a'));
  assert.equal(profil.chemins('livre', '/w/l', 'a').outUnite,
               path.join('/w/l', 'out', 'chapitres', 'a.frag.html'));
});

test('profil : sans slug, seuls les chemins du dossier sont rendus', () => {
  const c = profil.chemins('livre', '/w/l');
  assert.equal(c.unites, path.join('/w/l', 'chapitres'));
  assert.equal(c.md, undefined);
});

test('profil : un profil inconnu jette au lieu de deviner', () => {
  assert.throws(() => profil.chemins('brochure', '/w/x', 'y'), TypeError);
  assert.throws(() => profil.cleLibelle('brochure'), TypeError);
  assert.equal(profil.profilPour('brochure'), null);
});

test('profil : la clé de libellé suit le mot du profil', () => {
  assert.equal(profil.cleLibelle('revue'), 'unite.article');
  assert.equal(profil.cleLibelle('livre'), 'unite.chapitre');
  assert.equal(profil.cleLibelle('livre', 'supprimer'), 'unite.chapitre.supprimer');
});

// Une fenêtre qui passe d'une revue à un livre doit voir la clé de l'autre RETOMBER, sinon
// les deux vues latérales s'affichent en même temps.
test('profil : les clés de contexte s’excluent', () => {
  const rev = profil.contextes('revue');
  assert.equal(rev['szh.estRevue'], true);
  assert.equal(rev['szh.estLivre'], false);
  const liv = profil.contextes('livre');
  assert.equal(liv['szh.estRevue'], false);
  assert.equal(liv['szh.estLivre'], true);
  const aucun = profil.contextes(null);
  assert.equal(aucun['szh.estRevue'], false);
  assert.equal(aucun['szh.estLivre'], false);
});

// Ce contrôle-ci garde la cohérence avec la CHAÎNE : les noms que le cockpit emploie
// doivent être ceux que pipeline/profils/livre.mk emploie. Deux tables qui divergent, et
// l'éditeur écrit dans un dossier que la compilation ne lit pas.
test('profil : les noms de dossier concordent avec le moteur livre', () => {
  const fs = require('fs');
  const mk = fs.readFileSync(path.join(RACINE, 'pipeline', 'profils', 'livre.mk'), 'utf8');
  assert.match(mk, /^CONFIG_LIVRE\s*:=\s*buch\.yaml$/m);
  assert.match(mk, /^CH_DIR\s*:=\s*chapitres$/m);
  assert.equal(profil.PROFILS.livre.config, 'buch.yaml');
  assert.equal(profil.PROFILS.livre.unites.dossier, 'chapitres');
});

// Ce contrôle-ci garde une DÉCISION, pas une valeur : la numérotation des figures et des
// tableaux est continue sur tout le volume, et elle ne peut l'être que si les chapitres se
// compilent dans l'ordre — chacun lit le report du précédent. Les deux lignes qui
// l'imposent (la chaîne de prérequis et SZH_COMPTEURS) sont faciles à retirer par
// inadvertance en réorganisant le fichier, et leur absence ne se voit pas : le livre sort,
// avec deux « Abbildung 1 ».
test('livre : la chaîne d’ordre des chapitres et le report des compteurs sont posés', () => {
  const fs = require('fs');
  const mk = fs.readFileSync(path.join(RACINE, 'pipeline', 'profils', 'livre.mk'), 'utf8');
  assert.match(mk, /\$\(foreach f,\$\(FRAGMENTS\),\$\(eval \$\(f\): \$\(PRECEDENT\)\)/,
    'la chaîne de prérequis entre fragments a disparu : l’ordre n’est plus garanti');
  assert.match(mk, /SZH_COMPTEURS="\$\(abspath \$\(COMPTEURS_DIR\)\)/,
    'SZH_COMPTEURS n’est plus posé : szh-numerotation.lua renumérotera par chapitre');
  const filtre = fs.readFileSync(
    path.join(RACINE, 'pipeline', 'filters', 'szh-numerotation.lua'), 'utf8');
  assert.ok(filtre.includes('SZH_COMPTEURS'),
    'szh-numerotation.lua ne lit plus le report des chapitres précédents');
});

// ⚠ `analyserAusgabe` FILTRE sur une liste blanche de clés : une clé qui n'y figure pas est
//   lue comme absente, sans erreur ni avertissement. `ordre-chapitres` en manquait — un
//   livre pouvait donc porter un ordre parfaitement écrit dans buch.yaml, que le cockpit
//   lisait vide, et l'arbre retombait sur l'ordre alphabétique des dossiers. Un ordre
//   plausible : c'est ce qui rend le défaut invisible.
test('livre : ordre-chapitres traverse le parseur, et comme une liste', () => {
  const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
  assert.ok(yaml.CLES_METADONNEES.indexOf('ordre-chapitres') !== -1,
    'ordre-chapitres est filtré par la liste blanche : il sera lu comme absent');
  assert.ok(yaml.CLES_LISTES.indexOf('ordre-chapitres') !== -1,
    'ordre-chapitres n’est pas déclaré porteur de liste : il sera lu comme un scalaire');
  // La clé que le cockpit ira chercher est bien celle que la table nomme, et celle que le
  // moteur livre écrit dans buch.yaml.
  assert.equal(profil.PROFILS.livre.unites.ordre, 'ordre-chapitres');
  const valeurs = yaml.analyserAusgabe('title: Essai\nordre-chapitres: ["02-b", "01-a"]\n');
  assert.deepStrictEqual(yaml.listeYamlEnLigne(valeurs['ordre-chapitres']), ['02-b', '01-a'],
    'l’ordre relu ne rend pas les deux chapitres dans l’ordre écrit');
});
